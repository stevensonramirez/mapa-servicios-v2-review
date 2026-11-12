import { useEffect, useMemo, useRef, useState } from "react";
import type { Node } from "@xyflow/react";
import type { MapSnapshot } from "./useMapPersistence";
import type { Severity, SeverityNodeData } from "./SeverityNode";
import { nodeStatusSource } from "./SeverityNode";
import { useDavisStatus } from "./useDavisStatus";
import { loadMapDoc } from "./submapDocs";

// ── Salud agregada de un Mapa de Servicio incrustado en un Mapa Padre ────────
// Un nodo de un Mapa Padre puede representar OTRO mapa del usuario. Este hook:
// (1) descarga el documento del hijo, (2) le extrae las fuentes de estado de sus
// nodos, (3) las evalúa con la MISMA maquinaria del padre y (4) agrega el
// resultado (sanos / afectados / % de sanos). El COLOR no se decide aquí: lo
// deciden las reglas configuradas por nodo (ver submapRules).
//
// Reparto del trabajo, para no montar un motor paralelo:
//  - DQL: el hook NO ejecuta nada; devuelve la lista `dqls` que el padre suma a
//    sus propios probes (mismo dedupe, mismo escalonado, misma pausa por
//    pestaña oculta, misma frecuencia de refresco y misma leyenda de consumo).
//    El estado ya resuelto vuelve por `sevOfDql`.
//  - Davis: una consulta batcheada extra (useDavisStatus) con las entidades de
//    los hijos, aparte de la del mapa padre.
//
// ANTI-CICLO: solo se evalúa UN nivel. Si el mapa hijo tiene a su vez nodos
// sub-mapa, esos se EXCLUYEN por completo (no cuentan en el denominador y no se
// descarga su documento). Así un mapa que se referencie a sí mismo, o dos mapas
// que se referencien entre sí, no producen recursión infinita.

export type SubmapHealth = {
  // % de nodos sanos sobre los EVALUADOS. null = el hijo no tiene nodos con
  // fuente de estado. undefined = todavía sin ninguna evaluación (cargando).
  pct: number | null | undefined;
  // Sanos (status 0) y afectados (status >= 1) entre los ya evaluados, y total de
  // nodos del hijo con fuente de estado. `affected` es undefined mientras no haya
  // ninguna evaluación: un 0 ahí se leería como "todo bien" sin serlo.
  ok: number;
  affected: number | undefined;
  total: number;
  // El documento del hijo no se pudo leer (sin acceso, borrado): estado neutro.
  error: boolean;
};

// Fuentes de estado extraídas de un mapa hijo (ya sin nodos sub-mapa).
type ChildSources = { dqls: string[]; entityIds: string[] };

// Recorre los nodos del hijo y separa sus fuentes de estado. Se excluyen los
// nodos sin fuente (texto/imagen, o de severidad con el DQL vacío) y los nodos
// sub-mapa (anti-ciclo, ver arriba).
const extractSources = (snap: MapSnapshot): ChildSources => {
  const dqls = new Set<string>();
  const entityIds = new Set<string>();
  snap.nodes.forEach((n: Node) => {
    if (n.type !== "severity") return;
    const d = (n.data && typeof n.data === "object" ? n.data : {}) as SeverityNodeData;
    const source = nodeStatusSource(d);
    if (source === "map") return;
    if (source === "davis") {
      if (d.entity?.id) entityIds.add(d.entity.id);
      return;
    }
    if (typeof d.dql === "string" && d.dql.trim()) dqls.add(d.dql);
  });
  return { dqls: [...dqls], entityIds: [...entityIds] };
};

export const useSubmapStatus = (
  mapIds: string[],
  opts: {
    paused?: boolean;
    // Severidad ya resuelta de un DQL (la del motor de probes del padre).
    sevOfDql: (dql?: string) => Severity;
    // Descarga del documento de un mapa (el mismo de la biblioteca: ya valida,
    // rescata y normaliza el snapshot). Rechaza si no hay acceso.
    loadSnapshot: (id: string) => Promise<MapSnapshot>;
    // Cadencia de la consulta de Davis de los hijos (la manda el Mapa Padre) y
    // token que fuerza una relectura inmediata (botón "Actualizar ahora").
    refreshIntervalMs?: number;
    refreshToken?: number;
  },
): { dqls: string[]; byMap: Map<string, SubmapHealth> } => {
  const { paused = false, sevOfDql, loadSnapshot, refreshIntervalMs, refreshToken } = opts;
  const ids = useMemo(() => [...new Set(mapIds.filter(Boolean))].sort(), [mapIds]);

  // Caché por id: las fuentes del hijo (o null si el documento no se pudo leer).
  // El contenido de un mapa cambia poco; lo que corre "en vivo" es la EVALUACIÓN
  // de sus fuentes, así que basta con descargarlo una vez por sesión.
  const [sources, setSources] = useState<Record<string, ChildSources | null>>({});
  const inFlightRef = useRef<Set<string>>(new Set());
  // "Vivo" por MONTAJE, no por ejecución del efecto: el efecto vuelve a correr
  // cada vez que llega una descarga (cambia `sources`), y una bandera por
  // ejecución cancelaría las descargas que siguen en vuelo → se volverían a
  // pedir en bucle.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    ids.forEach((id) => {
      if (id in sources || inFlightRef.current.has(id)) return;
      inFlightRef.current.add(id);
      void loadMapDoc(id, loadSnapshot)
        .then((snap) => {
          if (aliveRef.current) setSources((prev) => ({ ...prev, [id]: extractSources(snap) }));
        })
        .catch(() => {
          if (aliveRef.current) setSources((prev) => ({ ...prev, [id]: null }));
        })
        .finally(() => inFlightRef.current.delete(id));
    });
  }, [ids, sources, loadSnapshot]);

  // DQL de TODOS los hijos, deduplicados: el padre los añade a sus probes.
  const dqls = useMemo(() => {
    const set = new Set<string>();
    ids.forEach((id) => sources[id]?.dqls.forEach((q) => set.add(q)));
    return [...set];
  }, [ids, sources]);

  // Entidades Davis de TODOS los hijos: una sola consulta batcheada extra.
  const entityIds = useMemo(() => {
    const set = new Set<string>();
    ids.forEach((id) => sources[id]?.entityIds.forEach((e) => set.add(e)));
    return [...set];
  }, [ids, sources]);
  const davis = useDavisStatus(entityIds, { paused, refreshIntervalMs, refreshToken });

  const byMap = useMemo(() => {
    const out = new Map<string, SubmapHealth>();
    ids.forEach((id) => {
      const src = sources[id];
      if (src === null) {
        out.set(id, { pct: undefined, ok: 0, affected: undefined, total: 0, error: true });
        return;
      }
      if (src === undefined) {
        out.set(id, { pct: undefined, ok: 0, affected: undefined, total: 0, error: false });
        return;
      }
      const { dqls: qs, entityIds: es } = src;
      const total = qs.length + es.length;
      if (total === 0) {
        out.set(id, { pct: null, ok: 0, affected: undefined, total: 0, error: false });
        return;
      }
      // Solo entran al cálculo las fuentes con un estado YA conocido: contar las
      // "unknown" como sanas pintaría verde en falso, y como afectadas pintaría
      // rojo mientras carga. Si aún no hay ninguna evaluada → cargando.
      let ok = 0;
      let evaluated = 0;
      const tally = (sev: Severity) => {
        if (sev === "unknown") return;
        evaluated++;
        if (sev === 0) ok++;
      };
      qs.forEach((q) => tally(sevOfDql(q)));
      es.forEach((e) => tally(davis.isReady ? (davis.byEntity[e] ?? "unknown") : "unknown"));
      out.set(id, {
        pct: evaluated === 0 ? undefined : Math.round((ok / evaluated) * 100),
        ok,
        affected: evaluated === 0 ? undefined : evaluated - ok,
        total,
        error: false,
      });
    });
    return out;
  }, [ids, sources, sevOfDql, davis]);

  // Referencia ESTABLE mientras no cambien sus partes: el resultado entra como
  // dependencia de los memos del lienzo (displayNodes/sevBySource), y un objeto
  // nuevo por render los haría recalcular en cada render.
  return useMemo(() => ({ dqls, byMap }), [dqls, byMap]);
};
