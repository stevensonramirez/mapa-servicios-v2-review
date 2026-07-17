import { useEffect, useMemo, useState } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import type { EntityType, EntityRef } from "./entityModel";
import { dqlQuote, entityClassicPrefix, SMARTSCAPE_TYPE_ARG } from "./entityModel";

// ── Búsqueda de entidades para el selector (EntityPicker) ────────────────────
// Consulta GRATIS sobre `smartscapeNodes` (storage NUEVO de Smartscape). OJO:
// el modelo nuevo RENOMBRÓ tipos e ids (PROCESS_GROUP_INSTANCE→PROCESS,
// APPLICATION→FRONTEND, KUBERNETES_CLUSTER→K8S_CLUSTER, cloud_application→
// varios tipos K8s) — ver SMARTSCAPE_TYPE_ARG en entityModel.ts. El puente de
// vuelta al mundo clásico es el campo `id_classic` de cada nodo: la app guarda
// SIEMPRE el id clásico (es el que entienden Davis y los mapas ya guardados) y
// el id nuevo va aparte como `sid`. Tres formas de consulta según el tipo:
//   1. Tipo con equivalente 1:1 → `smartscapeNodes "<TIPO_NUEVO>"`.
//   2. Sin equivalente 1:1 (cloud app, BD) → `smartscapeNodes "*"` filtrado por
//      `startsWith(id_classic, "<PREFIJO_CLASICO>-")`.
//   3. Grupo de procesos (YA NO es nodo en el modelo nuevo) → se deriva de los
//      PROCESS por `dt.process_group.id`/`.detected_name` con summarize (el
//      `dt.process_group.id` ES el id clásico "PROCESS_GROUP-…").
// Filtro por nombre: contains case-insensitive, con debounce (300ms) para no
// disparar una consulta por tecla. Verificado en vivo (no adivinado).
//
// scope: storage:smartscape:read (sin costo de Grail — confirmado scannedBytes=0).

const DEBOUNCE_MS = 300;
// Tope de filas. Un tope NUNCA resuelve homónimos (hay nombres con 299
// servicios iguales): lo que los resuelve es buscar también por contexto e id
// (ver abajo). Cuando se llega al tope, se cuenta el total con una segunda
// consulta (solo en ese caso) para avisar "Mostrando 200 de N".
const RESULT_LIMIT = 200;

// Fila del catálogo: el EntityRef que se persiste + `ctx`, un texto de CONTEXTO
// solo para mostrar en el selector (NO se guarda en el nodo). Sirve para
// distinguir servicios homónimos (p. ej. decenas de "AutorecoveringChannel$2"):
// K8s → "namespace / workload"; sin K8s → grupo de procesos; si no, host.
export type EntityCatalogItem = EntityRef & { ctx?: string };

// Contexto de un SERVICE por Smartscape (3 lookups sobre aristas, sin costo de
// Grail). Verificado en vivo: cada servicio "belongs_to" 1 K8S_DEPLOYMENT y
// 1 K8S_NAMESPACE, y "runs_on" N PROCESS (se toma el primero).
const SERVICE_CONTEXT_LOOKUPS = `
| lookup [
    smartscapeEdges "belongs_to"
    | filter source_type == "SERVICE" and target_type == "K8S_DEPLOYMENT"
    | lookup [smartscapeNodes "K8S_DEPLOYMENT" | fields id, name], sourceField: target_id, lookupField: id, fields: {wl = name}
    | fields source_id, wl
  ], sourceField: id, lookupField: source_id, fields: {wl}
| lookup [
    smartscapeEdges "belongs_to"
    | filter source_type == "SERVICE" and target_type == "K8S_NAMESPACE"
    | lookup [smartscapeNodes "K8S_NAMESPACE" | fields id, name], sourceField: target_id, lookupField: id, fields: {ns = name}
    | fields source_id, ns
  ], sourceField: id, lookupField: source_id, fields: {ns}
| lookup [
    smartscapeEdges "runs_on"
    | filter source_type == "SERVICE" and target_type == "PROCESS"
    | lookup [smartscapeNodes "PROCESS" | fields id, pg = dt.process_group.detected_name, host.name], sourceField: target_id, lookupField: id, fields: {pg, host.name}
    | summarize pg = takeFirst(pg), host = takeFirst(host.name), by: {source_id}
  ], sourceField: id, lookupField: source_id, fields: {pg, host}`;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

const contextOf = (r: Record<string, unknown>): string | undefined => {
  const wl = str(r.wl);
  const ns = str(r.ns);
  if (wl && ns) return `${ns} / ${wl}`;
  if (wl || ns) return wl ?? ns;
  return str(r.pg) ?? str(r.host);
};

export type EntityCatalogResult = {
  entities: EntityCatalogItem[];
  isLoading: boolean;
  error?: string;
  // Total real de coincidencias cuando la lista quedó truncada al tope
  // (undefined = no truncada, o aún contando).
  total?: number;
  truncated: boolean;
};

export const useEntityCatalog = (type: EntityType, term: string): EntityCatalogResult => {
  // Debounce del término de búsqueda: solo cuando el usuario deja de escribir.
  const [debounced, setDebounced] = useState(term);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(term), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [term]);

  // `base` = fuente + filtro (sin sort/limit). De ahí salen la lista y el conteo.
  const { query, countQuery } = useMemo(() => {
    const trimmed = debounced.trim().toLowerCase();
    const q = dqlQuote(trimmed);

    // Caso 3: grupos de procesos, derivados de sus instancias (PROCESS).
    if (type === "dt.entity.process_group") {
      const nameFilter = trimmed
        ? `\n| filter contains(lower(dt.process_group.detected_name), ${q})`
        : "";
      // OJO: `summarize` EXIGE al menos una agregación (sin ella →
      // TOO_FEW_PARAMETERS_FOR_COMMAND en el tenant real) — el count() es solo
      // para cumplirla y se descarta con `fields`.
      const base = `smartscapeNodes "PROCESS"${nameFilter}
| summarize cuenta = count(), by: { id = dt.process_group.id, name = dt.process_group.detected_name }
| filter isNotNull(id)`;
      return {
        query: `${base}
| fields id, name
| sort name asc
| limit ${RESULT_LIMIT}`,
        countQuery: `${base}
| summarize total = count()`,
      };
    }

    // Caso 1 (tipo nuevo conocido) o caso 2 (sin tipo nuevo → "*").
    // En AMBOS se filtra por el prefijo del id CLÁSICO: hay tipos nuevos que
    // agrupan varios clásicos (FRONTEND = APPLICATION + MOBILE_APPLICATION) y
    // el prefijo es lo que separa las categorías del selector.
    const arg = SMARTSCAPE_TYPE_ARG[type];
    const source = `smartscapeNodes ${arg ? dqlQuote(arg) : '"*"'}
| filter startsWith(id_classic, ${dqlQuote(`${entityClassicPrefix(type)}-`)})`;
    let base: string;
    if (type === "dt.entity.service") {
      // Servicios: los lookups de contexto van ANTES del filtro, para que la
      // búsqueda también encuentre por namespace, workload, grupo de procesos e
      // id (`id_classic`, que es string; `id` es un smartscape id y `lower()`
      // se queja). Verificado en vivo sobre ~3.500 servicios: ~2 s, 0 bytes de
      // Grail. Es lo que permite escoger entre cientos de homónimos.
      const filter = trimmed
        ? `\n| filter contains(lower(name), ${q}) or contains(lower(ns), ${q}) or contains(lower(wl), ${q}) or contains(lower(pg), ${q}) or contains(lower(id_classic), ${q})`
        : "";
      base = `${source}${SERVICE_CONTEXT_LOOKUPS}${filter}`;
    } else {
      const nameFilter = trimmed ? `\n| filter contains(lower(name), ${q})` : "";
      base = `${source}${nameFilter}`;
    }
    return {
      query: `${base}
| fields id, id_classic, name, ns, wl, pg, host
| sort name asc
| limit ${RESULT_LIMIT}`,
      countQuery: `${base}
| summarize total = count()`,
    };
  }, [type, debounced]);

  const { data, isLoading, error } = useDql(query, { enabled: query.trim().length > 0 });
  // Conteo total SOLO cuando la lista llegó al tope (si no, no hace falta).
  const truncated = (data?.records?.length ?? 0) >= RESULT_LIMIT;
  const countQ = useDql(countQuery, { enabled: truncated });
  const total = useMemo(() => {
    const rec = (countQ.data?.records ?? [])[0] as Record<string, unknown> | undefined;
    const n = rec ? Number(rec.total) : NaN;
    return truncated && Number.isFinite(n) ? n : undefined;
  }, [countQ.data, truncated]);

  const entities = useMemo<EntityCatalogItem[]>(() => {
    const recs = (data?.records ?? []) as Array<Record<string, unknown>>;
    const out: EntityCatalogItem[] = [];
    for (const r of recs) {
      const sid = typeof r.id === "string" && r.id ? r.id : undefined;
      // El id canónico de la app es el CLÁSICO; si no viene (grupos de procesos,
      // que ya lo traen clásico en `id`), se usa `id` tal cual.
      const classic = typeof r.id_classic === "string" && r.id_classic ? r.id_classic : sid;
      if (!classic) continue;
      const name = typeof r.name === "string" ? r.name : undefined;
      const item: EntityCatalogItem = sid && sid !== classic ? { id: classic, type, name, sid } : { id: classic, type, name };
      const ctx = contextOf(r);
      if (ctx) item.ctx = ctx;
      out.push(item);
    }
    return out;
  }, [data, type]);

  const errMsg = (error as { message?: string } | undefined)?.message;
  return { entities, isLoading, error: errMsg, total, truncated };
};
