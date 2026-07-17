import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { workflowsClient, executionsClient } from "@dynatrace-sdk/client-automation";
import { getCurrentUserDetails } from "@dynatrace-sdk/app-environment";
import { buildNodeProblemIdsQuery } from "./copilotExplain";
import { dqlQuote } from "./entityModel";

// ── Análisis de causa raíz ───────────────────────────────────────────────────
// Flujo: la app junta los problemas activos de cada nodo (con los permisos del
// usuario) → ejecuta el workflow "Causa raíz" (Dynatrace Intelligence, acción
// agéntica) → espera el resultado → lo traduce a causas raíz numeradas, con sus
// efectos y los nodos del mapa donde aparece cada uno. El resultado se guarda en
// el mapa (settings.rootCause) para que todos vean el mismo análisis.
// Fuente del workflow: carpeta `workflow/` del repo. Ids por app (staging/prod).
// PRODUCCIÓN: id del workflow «Mapas de Servicios V2 - Causa raíz» del tenant
// (creado el 20-oct-2026). Si se recrea, actualizar aquí y en workflow/build-workflow.py.
export const RC_WORKFLOW_ID = "22a757f2-fdae-4a59-8dcb-78bad4b98d94";

const MAX_PROBLEMS = 60; // el workflow tampoco analiza más
// Además de los ACTIVOS, entran los problemas CERRADOS en los últimos N minutos
// (oct-2026): un problema corto que se cerró poco antes de analizar puede ser el
// efecto o la causa de otro que sigue activo (caso real: P-261052380 duró 4 min y
// se cerró un minuto antes del primer análisis, así que nunca entró). Los activos
// van primero en la prioridad.
export const RC_CLOSED_WINDOW_MIN = 15; // 60 al principio; el cliente pidió 15 (22-oct)
const RC_WINDOW_FILTER = `event.status == "ACTIVE" or (event.status == "CLOSED" and event.end >= now() - ${RC_CLOSED_WINDOW_MIN}m)`;
// ¿El workflow deja el pre-análisis como comentario en cada problema? Escribe en
// problemas REALES (los ve todo el que abra el problema): se enciende con OK del
// usuario tras la primera prueba controlada.
export const RC_COMMENT_PROBLEMS = true;
const POLL_MS = 4000;
const MAX_WAIT_MS = 10 * 60_000;

export type RcConfidence = "alta" | "media" | "baja";
export type RcProblem = {
  problemId: string; // event.id
  displayId?: string; // P-…
  name?: string;
  category?: string;
  severity?: number;
  start?: string;
  nodeIds: string[];
  // Solo en efectos: evidencia verificable de su relación con la causa.
  proof?: RcEvidence;
};
export type RcSignal = "topologia" | "orden" | "raizDavis" | "eventos" | "entorno" | "conexionMapa";
export type RcEvidence = {
  score: number;
  total: number;
  level: RcConfidence;
  contradiction: boolean;
  signals: Partial<Record<RcSignal, boolean | null>>;
};
export type RcCause = RcProblem & {
  n: number; // número que se pinta en el mapa (1 = el más importante)
  verdict?: string; // una frase accionable (va primero en el modal y el comentario)
  reason: string;
  recommendations?: string[]; // «Qué hacer»
  // Confianza CALCULADA con evidencia verificable (promedio de sus efectos);
  // null = causa aislada (no explica otros problemas). `confidence` es la que se
  // puso la IA (dato secundario).
  evidenceLevel?: RcConfidence | null;
  confidence: RcConfidence;
  evidence: string[];
  effects: RcProblem[];
};
// Lo que se persiste en settings.rootCause.
export type RcAnalysis = {
  v: 1;
  at: string; // ISO
  by?: string;
  executionId: string;
  problemCount: number; // analizados
  totalProblems?: number; // activos en el mapa (si es mayor, se analizaron los más graves)
  causes: RcCause[];
  unclassified: RcProblem[];
  summary?: string;
  // Mapas Padre: nombres de los nodos de los HIJOS («Hijo › nodo», sus ids son
  // compuestos, ver RC_SUB) y a qué mapa apunta cada nodo sub-mapa del padre.
  nodeNames?: Record<string, string>;
  submaps?: Record<string, { mapId: string; name: string }>;
};

// ── Nodos de mapas hijos (Mapa Padre) ────────────────────────────────────────
// En un Mapa Padre el análisis también mira DENTRO de cada mapa hijo (un nivel).
// Los nodos del hijo viajan con id compuesto «<nodo sub-mapa del padre>::<nodo
// del hijo>»: así el padre pinta la marca sobre el nodo sub-mapa que lo contiene
// y «Ir al nodo» sabe a qué hijo entrar. Un mapa solo se incrusta una vez por
// padre, así que el nodo sub-mapa identifica al hijo sin ambigüedad.
export const RC_SUB = "::";
export const rcSubId = (hostId: string, childNodeId: string) => `${hostId}${RC_SUB}${childNodeId}`;
// { host, child } si es un id compuesto; null si es un nodo propio del mapa.
export const rcSplitId = (id: string): { host: string; child: string } | null => {
  const i = id.indexOf(RC_SUB);
  return i > 0 ? { host: id.slice(0, i), child: id.slice(i + RC_SUB.length) } : null;
};
// Nodo DONDE se pinta en este mapa: el propio o el nodo sub-mapa que lo contiene.
export const rcLocalId = (id: string) => rcSplitId(id)?.host ?? id;
// ¿Alguno de estos ids cae en el nodo `nodeId` de este mapa (directo o dentro del hijo)?
export const rcOnNode = (ids: string[], nodeId: string) => ids.some((id) => rcLocalId(id) === nodeId);

// Vista del análisis de un padre DENTRO de uno de sus hijos (al entrar con «Ir
// al nodo»): los nodos de ese hijo pierden el prefijo para pintarse ahí; los
// demás (del padre o de otros hijos) quedan igual y se resuelven por nombre.
export const rcChildView = (a: RcAnalysis, hostId: string): RcAnalysis => {
  const map = (ids: string[]) => ids.map((id) => {
    const sp = rcSplitId(id);
    return sp && sp.host === hostId ? sp.child : id;
  });
  const names: Record<string, string> = { ...(a.nodeNames ?? {}) };
  for (const [id, name] of Object.entries(a.nodeNames ?? {})) {
    const sp = rcSplitId(id);
    if (sp && sp.host === hostId) names[sp.child] = name;
  }
  return {
    ...a,
    nodeNames: names,
    causes: a.causes.map((c) => ({
      ...c,
      nodeIds: map(c.nodeIds),
      effects: c.effects.map((e) => ({ ...e, nodeIds: map(e.nodeIds) })),
    })),
    unclassified: a.unclassified.map((u) => ({ ...u, nodeIds: map(u.nodeIds) })),
  };
};

export type RcNodeInput = {
  id: string;
  name: string;
  state?: "err" | "warn" | "ok";
  entityId?: string; // nodos atados a Davis
  dql?: string; // nodos con DQL propio
};
export type RcEdgeInput = { from: string; to: string };

export type RcStage = "collecting" | "running";
export class RcError extends Error {
  constructor(
    public code: "noProblems" | "invalid" | "failed" | "timeout" | "forbidden" | "aiLimit" | "aiEmpty" | "aiFailed",
    detail?: string,
  ) {
    super(detail || code);
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      rej(new DOMException("aborted", "AbortError"));
    });
  });

async function runDql(query: string, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
  const start = await queryExecutionClient.queryExecute({
    body: { query, requestTimeoutMilliseconds: 30_000, maxResultRecords: 5000 },
  });
  if (start.result) return (start.result.records ?? []) as Array<Record<string, unknown>>;
  for (let i = 0; i < 60; i++) {
    signal?.throwIfAborted();
    const r = await queryExecutionClient.queryPoll({
      requestToken: start.requestToken!,
      requestTimeoutMilliseconds: 5000,
    });
    if (r.state === "SUCCEEDED") return (r.result?.records ?? []) as Array<Record<string, unknown>>;
    if (r.state === "FAILED" || r.state === "CANCELLED") throw new Error(`DQL ${r.state}`);
  }
  throw new Error("DQL sin respuesta");
}

const DUP = "| filter isNull(dt.davis.is_duplicate) or dt.davis.is_duplicate == false";

// Problemas (event.id) de cada nodo —activos o cerrados hace menos de
// RC_CLOSED_WINDOW_MIN—, con la misma lógica que la burbuja: nodos Davis →
// problemas que afectan su entidad; nodos con DQL sobre dt.davis.problems → la
// población de problemas de ese DQL (su filtro de «ACTIVE» se amplía a la misma
// ventana, solo para el análisis). Otros nodos: ninguno.
export async function collectMapProblems(
  nodes: RcNodeInput[],
  signal?: AbortSignal,
): Promise<Map<string, string[]>> {
  const byNode = new Map<string, string[]>();
  const entityNodes = nodes.filter((n) => n.entityId);
  const tasks: Array<Promise<void>> = [];
  if (entityNodes.length) {
    const list = [...new Set(entityNodes.map((n) => n.entityId!))].map(dqlQuote).join(", ");
    tasks.push(
      runDql(
        `fetch dt.davis.problems, from: now()-2h
| filter ${RC_WINDOW_FILTER}
${DUP}
| expand affected_entity_ids
| filter in(affected_entity_ids, { ${list} })
| fields event.id, affected_entity_ids
| limit 2000`,
        signal,
      ).then((rows) => {
        const byEntity = new Map<string, Set<string>>();
        for (const r of rows) {
          const e = String(r.affected_entity_ids ?? "");
          const id = String(r["event.id"] ?? "");
          if (!e || !id) continue;
          if (!byEntity.has(e)) byEntity.set(e, new Set());
          byEntity.get(e)!.add(id);
        }
        for (const n of entityNodes) byNode.set(n.id, [...(byEntity.get(n.entityId!) ?? [])]);
      }),
    );
  }
  for (const n of nodes) {
    if (n.entityId || !n.dql) continue;
    const q = buildNodeProblemIdsQuery(n.dql, 50, RC_CLOSED_WINDOW_MIN);
    if (!q) continue;
    tasks.push(
      runDql(q, signal)
        .then((rows) => {
          byNode.set(
            n.id,
            rows.map((r) => String(r["event.id"] ?? "")).filter(Boolean),
          );
        })
        // DQL del nodo con error (p. ej. de sintaxis): ese nodo no aporta problemas.
        .catch(() => undefined),
    );
  }
  await Promise.all(tasks);
  return byNode;
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
// El SDK de consultas convierte los campos `timestamp` en Date (la API cruda los
// manda como texto ISO): se aceptan ambos y se guarda siempre ISO.
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : undefined);
const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v));

export async function analyzeRootCause(
  mapId: string,
  mapName: string,
  nodes: RcNodeInput[],
  edges: RcEdgeInput[],
  onStage: (s: RcStage) => void,
  signal?: AbortSignal,
  // Mapa Padre: nodos y conexiones de los hijos (ids compuestos) y el mapa de
  // cada nodo sub-mapa. Se recolectan aquí, durante «collecting».
  children?: () => Promise<{ nodes: RcNodeInput[]; edges: RcEdgeInput[]; submaps: Record<string, { mapId: string; name: string }> }>,
): Promise<RcAnalysis> {
  onStage("collecting");
  let submaps: Record<string, { mapId: string; name: string }> | undefined;
  if (children) {
    const ch = await children();
    nodes = [...nodes, ...ch.nodes];
    edges = [...edges, ...ch.edges];
    submaps = ch.submaps;
  }
  const byNode = await collectMapProblems(nodes, signal);
  const candidatos = [...new Set([...byNode.values()].flat())];
  if (!candidatos.length) throw new RcError("noProblems");
  const nodesOf = new Map<string, string[]>();
  for (const [nid, ids] of byNode) {
    for (const id of ids) {
      if (!nodesOf.has(id)) nodesOf.set(id, []);
      nodesOf.get(id)!.push(nid);
    }
  }

  // Detalle de TODOS los candidatos: sirve para PRIORIZAR (si hay más de
  // MAX_PROBLEMS) y luego para pintar (id P-…, nombre, categoría, severidad, inicio).
  const rows = await runDql(
    `fetch dt.davis.problems, from: now()-24h
| filter in(event.id, { ${candidatos.slice(0, 500).map(dqlQuote).join(", ")} })
| sort timestamp desc
| dedup event.id
| fields event.id, display_id, event.name, event.category, event.severity, event.status, event.start, event.end, afectadas = arraySize(affected_entity_ids)`,
    signal,
  ).catch(() => [] as Array<Record<string, unknown>>);
  const det = new Map(rows.map((r) => [String(r["event.id"]), r]));

  // Ventana UNIFORME para todas las fuentes: activos + cerrados hace menos de
  // RC_CLOSED_WINDOW_MIN (un DQL de nodo sin filtro de estado podría traer
  // cerrados de horas atrás). Sin detalle no se puede saber: el problema se deja.
  const cutoff = Date.now() - RC_CLOSED_WINDOW_MIN * 60_000;
  const isClosed = (id: string) => String(det.get(id)?.["event.status"] ?? "") === "CLOSED";
  const vigentes = candidatos.filter((id) => {
    if (!isClosed(id)) return true;
    const end = Date.parse(iso(det.get(id)?.["event.end"]) ?? "");
    return !Number.isNaN(end) && end >= cutoff;
  });
  if (!vigentes.length) throw new RcError("noProblems");

  // Prioridad: activos antes que cerrados → severidad (SEV-1 primero) → categoría
  // (disponibilidad y error primero) → nodos del mapa que toca → entidades
  // afectadas → el más antiguo.
  // Se analizan los MAX_PROBLEMS primeros; el workflow recorta (si hace falta)
  // desde el final de esta misma lista.
  const CAT: Record<string, number> = { AVAILABILITY: 0, ERROR: 1, SLOWDOWN: 2, RESOURCE_CONTENTION: 3, CUSTOM_ALERT: 4 };
  const clave = (id: string): number[] => {
    const r = det.get(id);
    const t = Date.parse(iso(r?.["event.start"]) ?? "");
    return [
      isClosed(id) ? 1 : 0, // los activos primero
      num(r?.["event.severity"]) ?? 3, // sin severidad → nivel habitual (SEV-3), no al final
      CAT[String(r?.["event.category"] ?? "")] ?? 5,
      -(nodesOf.get(id)?.length ?? 0),
      -(num(r?.afectadas) ?? 0),
      Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t,
    ];
  };
  const cmpPrio = (a: string, b: string): number => {
    const ka = clave(a);
    const kb = clave(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
  };
  const ordenados = [...vigentes].sort(cmpPrio);
  const allIds = ordenados.slice(0, MAX_PROBLEMS);
  const keep = new Set(allIds);

  signal?.throwIfAborted();
  onStage("running");
  let user: string | undefined;
  try {
    user = getCurrentUserDetails().name;
  } catch {
    user = undefined;
  }
  const input = {
    mapName,
    mapId,
    comentar: RC_COMMENT_PROBLEMS,
    // Orden de prioridad: el workflow recorta (si hace falta) desde el final.
    prioridad: allIds,
    requestedBy: user ?? "",
    // Nodos con problemas primero: el workflow acepta un máximo de nodos y un
    // padre con varios hijos puede pasarlo; los que sobran son los sanos.
    nodes: nodes
      .map((n) => ({
        id: n.id,
        name: n.name,
        state: n.state,
        entityId: n.entityId,
        problemIds: (byNode.get(n.id) ?? []).filter((id) => keep.has(id)),
      }))
      .sort((a, b) => Number(b.problemIds.length > 0) - Number(a.problemIds.length > 0)),
    edges,
  };
  if (RC_WORKFLOW_ID.startsWith("PENDIENTE")) {
    throw new RcError("failed", "el workflow de producción aún no está configurado");
  }
  let execId: string;
  try {
    const ex = await workflowsClient.runWorkflow({ id: RC_WORKFLOW_ID, body: { input } });
    execId = ex.id;
  } catch (e) {
    const msg = (e as { message?: string })?.message ?? "";
    if (/403|forbidden|permission|not authorized/i.test(msg)) throw new RcError("forbidden", msg);
    throw new RcError("failed", msg);
  }

  // Espera a que termine (la IA suele tardar 1–2 min).
  const t0 = Date.now();
  let state = "RUNNING";
  let info = "";
  while (Date.now() - t0 < MAX_WAIT_MS) {
    await sleep(POLL_MS, signal);
    const ex = await executionsClient.getExecution({ id: execId });
    state = String(ex.state);
    info = ex.stateInfo ?? "";
    if (state === "SUCCESS" || state === "ERROR" || state === "CANCELLED") break;
  }
  if (state === "RUNNING" || state === "PAUSED" || state === "UNKNOWN") throw new RcError("timeout");
  if (state !== "SUCCESS") throw new RcError("failed", info);

  // Resultado validado por el workflow (tarea "resultado").
  let res: Record<string, unknown>;
  try {
    res = (await executionsClient.getTaskExecutionResult({ executionId: execId, id: "resultado" })) as Record<string, unknown>;
  } catch {
    throw new RcError("invalid");
  }
  if (!res || res.ok !== true) {
    if (res?.reason === "sin-problemas") throw new RcError("noProblems");
    if (res?.reason === "ia-tope-herramientas") throw new RcError("aiLimit");
    if (res?.reason === "ia-sin-respuesta") throw new RcError("aiEmpty");
    if (res?.reason === "ia-error") throw new RcError("aiFailed", str(res?.detalle));
    throw new RcError("invalid", str(res?.reason));
  }

  const prob = (id: string): RcProblem => {
    const r = det.get(id);
    return {
      problemId: id,
      displayId: str(r?.display_id),
      name: str(r?.["event.name"]),
      category: str(r?.["event.category"]),
      severity: num(r?.["event.severity"]),
      start: iso(r?.["event.start"]),
      nodeIds: nodesOf.get(id) ?? [],
    };
  };

  type RawCause = {
    problemId: string;
    veredicto?: string;
    razon?: string;
    confianza?: string;
    recomendaciones?: string[];
    efectos?: string[];
    evidencia?: string[];
    confianzaCalc?: RcConfidence | null;
    evidenciaCalc?: Array<{
      efecto: string;
      puntaje: number;
      total: number;
      nivel: RcConfidence;
      contradice: boolean;
      senales: Partial<Record<RcSignal, boolean | null>>;
    }>;
  };
  const raw = (Array.isArray(res.causasRaiz) ? res.causasRaiz : []) as RawCause[];
  const causes = raw
    .map((c) => ({
      ...prob(String(c.problemId)),
      verdict: c.veredicto || undefined,
      reason: c.razon ?? "",
      recommendations: Array.isArray(c.recomendaciones) ? c.recomendaciones.map(String) : [],
      confidence: (["alta", "media", "baja"].includes(String(c.confianza)) ? c.confianza : "baja") as RcConfidence,
      evidence: Array.isArray(c.evidencia) ? c.evidencia.map(String) : [],
      evidenceLevel: c.confianzaCalc === undefined ? undefined : c.confianzaCalc,
      effects: (Array.isArray(c.efectos) ? c.efectos : []).map((id) => {
        const e = (c.evidenciaCalc ?? []).find((x) => x.efecto === String(id));
        return {
          ...prob(String(id)),
          proof: e
            ? { score: e.puntaje, total: e.total, level: e.nivel, contradiction: e.contradice, signals: e.senales }
            : undefined,
        };
      }),
      n: 0,
    }))
    // Orden: del más GRAVE al menos grave, con el MISMO criterio de la selección
    // (severidad → categoría → nodos → entidades → antigüedad); empate: la que
    // explica más efectos. La causa 1 es siempre la más grave.
    .map((c) => ({ ...c, effects: [...c.effects].sort((a, b) => cmpPrio(a.problemId, b.problemId)) }))
    .sort((a, b) => cmpPrio(a.problemId, b.problemId) || b.effects.length - a.effects.length)
    .map((c, i) => ({ ...c, n: i + 1 }));

  return {
    v: 1,
    at: new Date().toISOString(),
    by: user,
    executionId: execId,
    problemCount: allIds.length,
    totalProblems: vigentes.length,
    causes,
    unclassified: (Array.isArray(res.sinClasificar) ? res.sinClasificar : []).map((id) => prob(String(id))),
    summary: str(res.resumen),
    ...(submaps
      ? {
          submaps,
          nodeNames: Object.fromEntries(nodes.filter((n) => rcSplitId(n.id)).map((n) => [n.id, n.name])),
        }
      : {}),
  };
}

// Todos los problemas del análisis (para consultar su estado vivo).
export const rcProblemIds = (a: RcAnalysis | undefined): string[] =>
  a
    ? [
        ...new Set([
          ...a.causes.flatMap((c) => [c.problemId, ...c.effects.map((e) => e.problemId)]),
          ...a.unclassified.map((u) => u.problemId),
        ]),
      ]
    : [];

// Marcas por nodo para pintar, con el ESTADO VIVO de los problemas (`closed` =
// event.id ya cerrados): causa activa → número rojo; causa resuelta → ✓ verde;
// efecto activo → «Efecto de N»; efecto resuelto → «✓ Efecto de N» atenuado
// (desde oct-2026 el análisis incluye cerrados recientes: la relación se ve).
export const rcMarksByNode = (a: RcAnalysis | undefined, closed: Set<string> = new Set()) => {
  const roots = new Map<string, number[]>();
  const resolved = new Map<string, number[]>();
  const effects = new Map<string, number[]>();
  const effectsResolved = new Map<string, number[]>();
  if (!a) return { roots, resolved, effects, effectsResolved };
  const add = (m: Map<string, number[]>, nid: string, n: number) => {
    const cur = m.get(nid) ?? [];
    if (!cur.includes(n)) m.set(nid, [...cur, n]);
  };
  // Ids de hijos (compuestos) se marcan sobre el nodo sub-mapa que los contiene.
  for (const c of a.causes) {
    const target = closed.has(c.problemId) ? resolved : roots;
    for (const nid of c.nodeIds) add(target, rcLocalId(nid), c.n);
    for (const e of c.effects) {
      const fx = closed.has(e.problemId) ? effectsResolved : effects;
      for (const nid of e.nodeIds) add(fx, rcLocalId(nid), c.n);
    }
  }
  // Un nodo que es causa raíz de N no se marca además como efecto de N; y un
  // efecto resuelto de N no se repite si el nodo tiene otro efecto ACTIVO de N.
  for (const [nid, ns] of effects) {
    const r = [...(roots.get(nid) ?? []), ...(resolved.get(nid) ?? [])];
    const rest = ns.filter((n) => !r.includes(n));
    if (rest.length) effects.set(nid, rest);
    else effects.delete(nid);
  }
  for (const [nid, ns] of effectsResolved) {
    const r = [...(roots.get(nid) ?? []), ...(resolved.get(nid) ?? []), ...(effects.get(nid) ?? [])];
    const rest = ns.filter((n) => !r.includes(n));
    if (rest.length) effectsResolved.set(nid, rest);
    else effectsResolved.delete(nid);
  }
  return { roots, resolved, effects, effectsResolved };
};
