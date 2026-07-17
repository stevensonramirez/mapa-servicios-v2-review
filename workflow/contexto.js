// Tarea 1 del workflow "Análisis de causa raíz" (Mapas de Servicios V2).
// Entrada (input de la ejecución, la manda la app):
//   { mapId, mapName, requestedBy,
//     nodes: [{ id, name, state: "err"|"warn"|"ok", entityId?, problemIds: [event.id…] }],
//     edges: [{ from, to }] }            // "A -> B" = sentido del flujo de la petición
// Salida: { ok, problemIds, problemCount, nodeCount, contextJson, chars, recortado }
// Arma el contexto COMPACTO para la IA: detalle de cada problema (sin duplicados
// de Davis), un resumen de sus eventos y el grafo del mapa. Todo es lectura.
import { execution } from "@dynatrace-sdk/automation-utils";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";

const MAX_NODES = 300;
const MAX_EDGES = 1000;
const MAX_PROBLEMS = 60;
const MAX_EVENTS_PER_PROBLEM = 15;
const MAX_CHARS = 90000; // lección del payload de CoPilot (~100k chars)
const ID_RE = /^[A-Za-z0-9_\-:.]{1,120}$/;

const str = (v, max = 400) =>
  typeof v === "string" ? v.slice(0, max) : v == null ? undefined : String(v).slice(0, max);
const arr = (v) => (Array.isArray(v) ? v : []);

// Horas en hora de Colombia ANTES de pasarlas a la IA: si le llegan en UTC, a
// veces las etiqueta "hora Colombia" sin convertirlas (visto en vivo). Formato
// "2026-10-20 03:47" (24 h, America/Bogota). Acepta Date o texto ISO (con nanos).
const enCol = (v) => {
  if (v == null || v === "") return undefined;
  const d = v instanceof Date ? v : new Date(String(v).replace(/\.(\d{3})\d+Z$/, ".$1Z"));
  if (Number.isNaN(d.getTime())) return undefined;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
};

// El filtro de seguridad de Dynatrace Intelligence RECHAZA la entrada si detecta
// datos sensibles (visto en vivo: SENSITIVE_CONTENT_REFUSED_ERROR por la "IP"
// '0:0:0:0:0:0:0:0' del nombre de un servicio Netty). Se enmascaran IPs (v4, v6
// completa, hostnames tipo ip-10-1-2-3) y correos en el contexto. Las horas
// (hh:mm:ss, solo 2 ":") y los ids de problemas/eventos no coinciden con estos patrones.
// Marcas con corchetes ([ip], [correo], [url]): con «<ip>» el markdown de la app
// Problems lo tomaba como etiqueta HTML y lo borraba (salía «Netty on :*»). Los
// nombres de nodo enmascarados se RESTAURAN después de la IA (ver nombresReales).
const sanitize = (s) =>
  s
    .replace(/\b(?:[0-9A-Fa-f]{1,4}:){4,7}[0-9A-Fa-f]{1,4}\b/g, "[ip]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]")
    .replace(/\bip-\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}\b/g, "ip-[ip]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[correo]")
    // URLs completas (monitores sintéticos, endpoints internos): con ellas la IA
    // falla con «technical error» y devuelve vacío (21-oct, mapa IM - Canal_Negocios).
    .replace(/https?:\/\/[^\s"|)]+/g, "[url]");

async function dql(query) {
  const start = await queryExecutionClient.queryExecute({
    body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: 5000 },
  });
  if (start.result) return start.result.records ?? [];
  for (let i = 0; i < 120; i++) {
    const r = await queryExecutionClient.queryPoll({
      requestToken: start.requestToken,
      requestTimeoutMilliseconds: 5000,
    });
    if (r.state === "SUCCEEDED") return r.result?.records ?? [];
    if (r.state === "FAILED" || r.state === "CANCELLED") throw new Error(`DQL ${r.state}`);
  }
  throw new Error("DQL sin respuesta");
}

export default async function ({ execution_id }) {
  const ex = await execution(execution_id);
  const inp = { ...(ex.params || {}), ...(ex.input || {}) };

  const nodes = arr(inp.nodes)
    .slice(0, MAX_NODES)
    .map((n) => ({
      id: str(n?.id, 160), // los nodos de mapas hijos traen id compuesto «sub::nodo»
      name: str(n?.name, 120),
      state: ["err", "warn", "ok"].includes(n?.state) ? n.state : undefined,
      entityId: str(n?.entityId, 120),
      problemIds: arr(n?.problemIds)
        .filter((id) => typeof id === "string" && ID_RE.test(id))
        .slice(0, MAX_PROBLEMS),
    }))
    .filter((n) => n.id);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = arr(inp.edges)
    .map((e) => ({ from: str(e?.from, 160), to: str(e?.to, 160) }))
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
    .slice(0, MAX_EDGES);

  const allIds = [...new Set(nodes.flatMap((n) => n.problemIds))].slice(0, MAX_PROBLEMS);
  if (!allIds.length) {
    return { ok: false, reason: "sin-problemas", problemIds: [], problemCount: 0, nodeCount: nodes.length, contextJson: "" };
  }

  // Detalle de los problemas (último estado de cada uno, sin duplicados de Davis).
  const probs = await dql(`fetch dt.davis.problems, from: now()-24h
| filter in(event.id, { ${allIds.map((id) => JSON.stringify(id)).join(", ")} })
| filter isNull(dt.davis.is_duplicate) or dt.davis.is_duplicate == false
| sort timestamp desc
| dedup event.id
| fields event.id, display_id, event.name, event.category, event.severity, event.status, event.start, event.end,
    root_cause_entity_id, root_cause_entity_name, affected_entity_ids, event.description, dt.davis.event_ids`);

  // Resumen de los eventos que agrupa cada problema.
  const evIds = [
    ...new Set(
      probs.flatMap((p) => arr(p["dt.davis.event_ids"]).slice(0, MAX_EVENTS_PER_PROBLEM).map(String)),
    ),
  ]
    .filter((id) => ID_RE.test(id))
    .slice(0, 900);
  const events = evIds.length
    ? await dql(`fetch dt.davis.events, from: now()-24h
| filter in(event.id, { ${evIds.map((id) => JSON.stringify(id)).join(", ")} })
| sort timestamp desc
| dedup event.id
| fields event.id, event.name, event.category, event.start, dt.source_entity, dt.source_entity.type`)
    : [];
  const evById = new Map(events.map((e) => [String(e["event.id"]), e]));

  // Topología REAL de las entidades involucradas (Smartscape): clúster, namespace y
  // host de cada una, y las relaciones directas entre ellas. Sin esto la IA solo
  // tiene el orden temporal y atribuye efectos entre entidades que no se tocan
  // (prueba 20-oct: culpó a un host de un clúster distinto al de los deployments).
  const classicIds = [
    ...new Set([
      ...probs.flatMap((p) => arr(p.affected_entity_ids).slice(0, 30)),
      ...probs.map((p) => p.root_cause_entity_id),
      ...nodes.map((n) => n.entityId),
    ]),
  ]
    .filter((id) => typeof id === "string" && ID_RE.test(id))
    .slice(0, 400);
  let entNodes = [];
  let entEdges = [];
  try {
    entNodes = classicIds.length
      ? await dql(`smartscapeNodes "*"
| filter in(id_classic, { ${classicIds.map((id) => JSON.stringify(id)).join(", ")} })
| fields id, id_classic, name, type, k8s.cluster.name, k8s.namespace.name, host.name`)
      : [];
    const newIds = entNodes.map((n) => String(n.id)).filter((id) => ID_RE.test(id));
    if (newIds.length > 1) {
      const list = newIds.map((id) => `toSmartscapeId(${JSON.stringify(id)})`).join(", ");
      entEdges = await dql(`smartscapeEdges "*"
| filter in(source_id, { ${list} }) and in(target_id, { ${list} }) and source_id != target_id
| fields type, source_id, target_id
| limit 2000`);
    }
  } catch (e) {
    // La topología enriquece pero no es obligatoria: si falla, el análisis sigue.
    entNodes = entNodes.length ? entNodes : [];
  }
  const classicOf = new Map(entNodes.map((n) => [String(n.id), String(n.id_classic)]));
  const entidades = {};
  for (const n of entNodes) {
    entidades[String(n.id_classic)] = {
      nombre: str(n.name, 160),
      tipo: n.type,
      cluster: n["k8s.cluster.name"] ?? undefined,
      namespace: n["k8s.namespace.name"] ?? undefined,
      host: n["host.name"] ?? undefined,
    };
  }
  const relaciones = [
    ...new Set(
      entEdges
        .map((e) => {
          const a = classicOf.get(String(e.source_id));
          const b = classicOf.get(String(e.target_id));
          return a && b ? `${a} ${e.type} ${b}` : null;
        })
        .filter(Boolean),
    ),
  ].slice(0, 400);

  // A la IA NO se le mandan los ids internos de los nodos (n1, rc3…): solo
  // nombres (si se repiten, con sufijo " (2)", " (3)"). Así no los cita en la razón.
  const label = new Map();
  const seenNames = new Map();
  for (const n of nodes) {
    const base = (n.name || "Nodo sin nombre").trim();
    const k = (seenNames.get(base) ?? 0) + 1;
    seenNames.set(base, k);
    label.set(n.id, k > 1 ? `${base} (${k})` : base);
  }
  // Nombre enmascarado → nombre real de cada nodo (NO va a la IA). resultado.js
  // y comentar.js lo usan para mostrar el nombre real en el análisis y en los
  // comentarios (p. ej. «Netty on 0:0:0:0:0:0:0:0:*», que la IA rechaza).
  const nombresReales = {};
  for (const lbl of label.values()) {
    const masked = sanitize(lbl);
    if (masked !== lbl) nombresReales[masked] = lbl;
  }
  const nodesOf = (pid) => nodes.filter((n) => n.problemIds.includes(pid)).map((n) => label.get(n.id));
  const problemas = probs.map((p) => {
    const pid = String(p["event.id"]);
    const seen = new Set();
    const eventos = [];
    for (const id of arr(p["dt.davis.event_ids"]).map(String)) {
      const e = evById.get(id);
      if (!e) continue;
      const key = `${e["event.name"]}|${e["dt.source_entity"]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      eventos.push({
        nombre: str(e["event.name"], 160),
        categoria: e["event.category"],
        inicio: enCol(e["event.start"]),
        entidad: e["dt.source_entity"],
        tipoEntidad: e["dt.source_entity.type"],
      });
      if (eventos.length >= MAX_EVENTS_PER_PROBLEM) break;
    }
    return {
      id: pid,
      displayId: p.display_id,
      nombre: str(p["event.name"], 160),
      categoria: p["event.category"],
      severidad: p["event.severity"],
      estado: p["event.status"],
      inicio: enCol(p["event.start"]),
      fin: enCol(p["event.end"]),
      entidadRaizDavis: { id: p.root_cause_entity_id, nombre: str(p.root_cause_entity_name, 160) },
      entidadesAfectadas: arr(p.affected_entity_ids).slice(0, 30),
      totalEventos: arr(p["dt.davis.event_ids"]).length,
      descripcion: str(p["event.description"], 1200),
      nodosDelMapa: nodesOf(pid),
      eventos,
    };
  });

  // Orden de PRIORIDAD que manda la app (más graves primero): si hay que recortar
  // por tamaño, se quitan desde el final, es decir, los menos importantes.
  const prioridad = arr(inp.prioridad).map(String);
  if (prioridad.length) {
    const pos = new Map(prioridad.map((id, i) => [id, i]));
    problemas.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  }
  const valid = new Set(problemas.map((p) => p.id));
  const ctx = {
    mapa: {
      nombre: str(inp.mapName, 120),
      nodos: nodes.map((n) => ({
        nombre: label.get(n.id),
        estado: n.state,
        entidad: n.entityId,
        problemas: n.problemIds.filter((id) => valid.has(id)),
      })),
      conexiones: edges.map((e) => `${label.get(e.from)} -> ${label.get(e.to)}`),
    },
    problemas,
    entidades,
    relacionesSmartscape: relaciones,
  };

  // Recorte progresivo si el contexto se pasa del tope (siempre enmascarado).
  const toJson = () => sanitize(JSON.stringify(ctx));
  let recortado = false;
  let json = toJson();
  if (json.length > MAX_CHARS) {
    recortado = true;
    for (const p of ctx.problemas) {
      p.descripcion = str(p.descripcion, 300);
      p.eventos = p.eventos.slice(0, 5);
    }
    json = toJson();
  }
  while (json.length > MAX_CHARS && ctx.problemas.length > 1) {
    ctx.problemas.pop();
    json = toJson();
  }

  return {
    ok: true,
    problemIds: ctx.problemas.map((p) => p.id),
    problemCount: ctx.problemas.length,
    nodeCount: nodes.length,
    contextJson: json,
    chars: json.length,
    recortado,
    nombresReales,
    // Para el puntaje de evidencia (NO va a la IA): eventos de cada problema.
    eventosPorProblema: Object.fromEntries(
      probs.map((p) => [String(p["event.id"]), arr(p["dt.davis.event_ids"]).map(String).slice(0, 300)]),
    ),
  };
}
