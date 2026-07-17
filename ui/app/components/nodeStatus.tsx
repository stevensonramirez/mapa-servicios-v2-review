import { useEffect, useRef, useState } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import type { Severity } from "./SeverityNode";

// ¿La pestaña está visible? Cuando el usuario se va a otra pestaña/ventana, los
// probes se pausan para no seguir consultando Grail "en el fondo" sin que nadie
// mire (el grueso del gasto). Al volver, se reanudan.
export const usePageVisible = (): boolean => {
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onChange = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
};

// Escalonado: en vez de que todos los probes disparen su primera consulta en el
// mismo instante (pico de carga al abrir el mapa), se reparte el arranque en una
// ventana corta. El retardo es DETERMINISTA por DQL (hash) para que no cambie ni
// remonte al añadir/quitar nodos.
const STAGGER_WINDOW_MS = 2400;
const STAGGER_BUCKETS = 24;
const staggerDelay = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % STAGGER_BUCKETS) * (STAGGER_WINDOW_MS / STAGGER_BUCKETS);
};

// DQL semilla para nodos nuevos: devuelve status = 0 (ok). El usuario lo
// reemplaza por su propia consulta sobre cualquier entidad.
export const DEFAULT_NODE_DQL = `fetch events, from: now()-2h
| limit 1
| fieldsAdd status = 0
| fields status`;

// CONTRATO genérico (cualquier entidad): el DQL debe devolver una columna
// `status` numérica. Interpretación tolerante (peor número = peor estado):
//   <= 0  → ok (0)
//   == 1  → warning (1)
//   >= 2  → error (2, 3, … cualquier valor crítico)
// Sin columna `status` explícita / sin filas / valor no numérico/no finito →
// "unknown" (gris). NO adivinamos con "el primer número del registro": eso
// dependía del orden de las claves y podía pintar un nodo en rojo por un
// count()/timestamp ajeno al estado. El gris es el comportamiento seguro.
export const recordsToSeverity = (records?: Array<Record<string, unknown>>): Severity => {
  const rec = records?.[0];
  if (!rec) return "unknown";
  const raw: unknown = rec.status;
  if (raw == null) return "unknown";
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return "unknown";
  if (n >= 2) return 2;
  if (n >= 1) return 1;
  return 0;
};

// DQL semilla del chip de VALOR: problemas activos (dt.davis.problems no consume
// Grail y SIEMPRE devuelve un número, aunque sea 0). El usuario lo reemplaza.
export const DEFAULT_VALUE_DQL = `fetch dt.davis.problems, from: now()-2h
| filter event.status == "ACTIVE"
| filter isNull(dt.davis.is_duplicate) or dt.davis.is_duplicate == false
| summarize value = countDistinctExact(display_id)`;

// CONTRATO de VALOR (chip en las rayas): el DQL debe devolver UN solo número.
// Se mira la primera fila: primero un campo llamado `value`; si no, el primer
// campo numérico (se saltan `timeframe`/`interval`, que trae todo `timeseries`).
// Si el campo es un arreglo (serie de `timeseries`) se toma el ÚLTIMO punto no
// nulo = "el valor actual". null → no hay valor válido (chip en "—").
const toNum = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const fieldValue = (v: unknown): number | null => {
  if (Array.isArray(v)) {
    for (let i = v.length - 1; i >= 0; i--) {
      const n = toNum(v[i]);
      if (n !== null) return n;
    }
    return null;
  }
  return toNum(v);
};
export const recordsToValue = (records?: Array<Record<string, unknown>>): number | null => {
  const rec = records?.[0];
  if (!rec) return null;
  if ("value" in rec) {
    const n = fieldValue(rec.value);
    if (n !== null) return n;
  }
  for (const key of Object.keys(rec)) {
    if (key === "value" || key === "timeframe" || key === "interval") continue;
    const n = fieldValue(rec[key]);
    if (n !== null) return n;
  }
  return null;
};

// Formato compacto para el chip: 1234 → "1.23k", 0.4567 → "0.46", 12.34 → "12.3".
const trimNum = (x: number): string => {
  const a = Math.abs(x);
  const r = a >= 100 ? x.toFixed(0) : a >= 10 ? x.toFixed(1) : x.toFixed(2);
  return r.includes(".") ? r.replace(/\.?0+$/, "") : r;
};
export const formatValue = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${trimNum(n / 1e9)}G`;
  if (a >= 1e6) return `${trimNum(n / 1e6)}M`;
  if (a >= 1e3) return `${trimNum(n / 1e3)}k`;
  return trimNum(n);
};

// Probe de VALOR: igual que NodeStatusProbe (dedupe, escalonado, pausa con la
// pestaña oculta, refresco manual) pero reporta un número (o null) en vez de
// una severidad. Uno por DQL de valor único (rayas con el chip activado).
export const DqlValueProbe = ({
  dql,
  onValue,
  onQueryId,
  refreshIntervalMs = 60_000,
  paused = false,
  refreshToken,
}: {
  dql: string;
  onValue: (dql: string, value: number | null) => void;
  onQueryId?: (dql: string, queryId: string | undefined) => void;
  refreshIntervalMs?: number;
  paused?: boolean;
  refreshToken?: number;
}) => {
  const hasDql = dql.trim().length > 0;
  const [started, setStarted] = useState(() => staggerDelay(dql) === 0);
  useEffect(() => {
    if (started) return;
    const id = setTimeout(() => setStarted(true), staggerDelay(dql));
    return () => clearTimeout(id);
  }, [dql, started]);
  const enabled = hasDql && started && !paused;
  const { data, forceRefetch } = useDql(dql, {
    refetchInterval: enabled && refreshIntervalMs > 0 ? refreshIntervalMs : undefined,
    enabled,
  });
  const seenTokenRef = useRef<number | undefined>(refreshToken);
  useEffect(() => {
    if (refreshToken === undefined || seenTokenRef.current === refreshToken) return;
    seenTokenRef.current = refreshToken;
    if (!enabled) return;
    void forceRefetch();
  }, [refreshToken, enabled, forceRefetch]);
  useEffect(() => {
    if (!hasDql || !enabled || !data) return; // sin resultado real: conserva el último valor
    onValue(dql, recordsToValue(data.records));
    onQueryId?.(dql, data.metadata?.grail?.queryId);
  }, [data, dql, hasDql, enabled, onValue, onQueryId]);
  return null;
};

// Probe oculto: ejecuta (SOLO LECTURA) un DQL y reporta la severidad resultante.
// Se monta uno por DQL ÚNICO (dedupe en el padre) para no repetir consultas.
// - `paused`: la pestaña no está visible → no se consulta (se conserva el último
//   color conocido, sin parpadeo a gris).
// - escalonado interno: arranca tras un pequeño retardo por DQL para no disparar
//   todas las consultas a la vez.
export const NodeStatusProbe = ({
  dql,
  onStatus,
  onQueryId,
  refreshIntervalMs = 60_000,
  paused = false,
  refreshToken,
}: {
  dql: string;
  onStatus: (dql: string, severity: Severity) => void;
  // Reporta el queryId de la ÚLTIMA ejecución de este DQL
  // (data.metadata.grail.queryId). Con ese id se busca en la tabla de billing
  // (dt.system.events) cuántos bytes facturó realmente esa consulta.
  onQueryId?: (dql: string, queryId: string | undefined) => void;
  // Cada cuánto re-ejecutar el DQL. 0 = manual (sin auto-refresco).
  refreshIntervalMs?: number;
  // La pestaña está oculta: pausar el polling para cuidar el budget de Grail.
  paused?: boolean;
  // Refresco a mano (Mapa Padre): al cambiar de valor, se re-ejecuta el DQL YA,
  // sin esperar la cadencia ni tumbar el color actual mientras llega.
  refreshToken?: number;
}) => {
  const hasDql = dql.trim().length > 0;
  // Arranque escalonado: el probe queda "dormido" hasta su retardo por DQL.
  const [started, setStarted] = useState(() => staggerDelay(dql) === 0);
  useEffect(() => {
    if (started) return;
    const id = setTimeout(() => setStarted(true), staggerDelay(dql));
    return () => clearTimeout(id);
  }, [dql, started]);

  const enabled = hasDql && started && !paused;
  const { data, forceRefetch } = useDql(dql, {
    refetchInterval: enabled && refreshIntervalMs > 0 ? refreshIntervalMs : undefined,
    enabled,
  });
  // Refresco a mano: el valor inicial del token es el de montaje y NO cuenta como
  // pulsación (la consulta inicial ya la hace useDql por su cuenta).
  const seenTokenRef = useRef<number | undefined>(refreshToken);
  useEffect(() => {
    if (refreshToken === undefined || seenTokenRef.current === refreshToken) return;
    seenTokenRef.current = refreshToken;
    if (!enabled) return;
    void forceRefetch();
  }, [refreshToken, enabled, forceRefetch]);
  useEffect(() => {
    // Sin DQL → gris explícito. Pausado o aún sin arrancar → NO reportamos (se
    // conserva el último color conocido). Activo → severidad de los datos.
    if (!hasDql) {
      onStatus(dql, "unknown");
      return;
    }
    if (!enabled) return;
    onStatus(dql, recordsToSeverity(data?.records));
    // Solo cuando hay un resultado real (data definido): reportamos el queryId
    // para luego buscar su consumo facturado en la tabla de billing.
    if (data) onQueryId?.(dql, data.metadata?.grail?.queryId);
  }, [data, dql, hasDql, enabled, onStatus, onQueryId]);
  return null;
};
