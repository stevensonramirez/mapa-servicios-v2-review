// Tarea 3 del workflow "Análisis de causa raíz": valida la respuesta de la IA.
// - Solo acepta ids de problemas que estaban en el contexto (anti-alucinación).
// - Cada problema queda en UN solo lugar: causa raíz, efecto de una causa, o sin clasificar.
// Salida: { ok, version, generadoEn, causasRaiz:[{problemId, razon, confianza, efectos, evidencia}],
//           sinClasificar, resumen, descartados,
//           problemas: { [event.id]: { displayId, nombre, categoria, inicio, nodos } } }
// ← esto es lo que lee la app (con `problemas` pinta la leyenda y el modal sin consultar nada más).
import { execution } from "@dynatrace-sdk/automation-utils";
import { executionsClient } from "@dynatrace-sdk/client-automation";

// Mensaje fijo de la plataforma cuando el agente agota su tope de llamadas a
// herramientas (lo reporta como SUCCESS con este texto; patrón del workflow
// oficial «SRE Agent»).
const TOPE_HERRAMIENTAS = "maximum number of tool calls has been reached";

const arr = (v) => (Array.isArray(v) ? v : []);
// Horas "HH:MM UTC" (o "HH:MM:SS UTC") → hora de Colombia (UTC-5), sin "UTC".
// La IA no siempre las convierte; esto lo hace de forma determinista.
const toCol = (t) =>
  t.replace(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*UTC\b/g, (_, h, m) => `${String((Number(h) + 19) % 24).padStart(2, "0")}:${m}`);
const txt = (v, max = 1500) => (typeof v === "string" ? toCol(v.trim()).slice(0, max) : "");

const parse = (v) => {
  if (v && typeof v === "object") return v;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(s);
  } catch {
    const i = s.indexOf("{");
    const j = s.lastIndexOf("}");
    if (i >= 0 && j > i) {
      try {
        return JSON.parse(s.slice(i, j + 1));
      } catch {
        /* sigue */
      }
    }
    return null;
  }
};


// ── Confianza CALCULADA (no la que se pone la IA) ────────────────────────────
// Por cada relación causa → efecto propuesta, se revisan 6 señales comprobables
// con datos del contexto. null = no hay datos para evaluarla (no cuenta).
//   topologia     relación real en Smartscape entre sus entidades (o comparten entidad)
//   orden         la causa empezó antes o a la vez (±5 min); si empezó DESPUÉS → contradicción
//   raizDavis     la entidad raíz que Davis da al efecto es una entidad de la causa
//   eventos       los dos problemas comparten eventos de Davis
//   entorno       mismo clúster+namespace o mismo host
//   conexionMapa  en el mapa, el nodo del efecto apunta (depende) al nodo de la causa
// Nivel: ≥4 → alta, 2–3 → media, ≤1 → baja; con contradicción de orden → baja.
const SENALES = ["topologia", "orden", "raizDavis", "eventos", "entorno", "conexionMapa"];
const minutos = (s) => {
  const t = typeof s === "string" ? Date.parse(s.replace(" ", "T") + ":00Z") : NaN;
  return Number.isNaN(t) ? null : t / 60000;
};
const evidencia = (C, ctx) => {
  const P = new Map(arr(C.problemas).map((p) => [String(p.id), p]));
  const ent = C.entidades || {};
  const rel = new Set(arr(C.relacionesSmartscape));
  const conex = new Set(arr(C.mapa?.conexiones));
  const evs = ctx.eventosPorProblema || {};
  const ents = (p) => new Set([...arr(p?.entidadesAfectadas), p?.entidadRaizDavis?.id].filter(Boolean).map(String));
  const relacionadas = (A, B) => {
    for (const a of A) {
      if (B.has(a)) return true;
      for (const b of B) {
        for (const r of rel) {
          if ((r.startsWith(a + " ") && r.endsWith(" " + b)) || (r.startsWith(b + " ") && r.endsWith(" " + a))) return true;
        }
      }
    }
    return false;
  };
  const entorno = (A, B) => {
    const k = (id) => {
      const e = ent[id];
      return e ? [e.cluster && e.namespace ? `ns:${e.cluster}/${e.namespace}` : null, e.host ? `h:${e.host}` : null].filter(Boolean) : [];
    };
    const ka = new Set([...A].flatMap(k));
    const kb = [...B].flatMap(k);
    if (!ka.size || !kb.length) return null;
    return kb.some((x) => ka.has(x));
  };
  return (causaId, efectoId) => {
    const c = P.get(causaId);
    const e = P.get(efectoId);
    const A = ents(c);
    const B = ents(e);
    const tc = minutos(c?.inicio);
    const te = minutos(e?.inicio);
    const contradice = tc != null && te != null && tc > te + 5;
    const evC = new Set(arr(evs[causaId]));
    const evE = arr(evs[efectoId]);
    const nC = arr(c?.nodosDelMapa);
    const nE = arr(e?.nodosDelMapa);
    const senales = {
      topologia: A.size && B.size ? relacionadas(A, B) : null,
      orden: tc != null && te != null ? !contradice : null,
      raizDavis: e?.entidadRaizDavis?.id ? A.has(String(e.entidadRaizDavis.id)) : null,
      eventos: evC.size && evE.length ? evE.some((x) => evC.has(x)) : null,
      entorno: entorno(A, B),
      conexionMapa: nC.length && nE.length ? nE.some((x) => nC.some((y) => conex.has(`${x} -> ${y}`))) : null,
    };
    const evaluadas = SENALES.filter((k) => senales[k] !== null);
    const puntaje = evaluadas.filter((k) => senales[k] === true).length;
    const nivel = contradice ? "baja" : puntaje >= 4 ? "alta" : puntaje >= 2 ? "media" : "baja";
    return { puntaje, total: evaluadas.length, nivel, contradice, senales };
  };
};

export default async function ({ execution_id }) {
  const ex = await execution(execution_id);
  const ctx = await ex.result("contexto");
  if (!ctx?.ok) return { ok: false, reason: ctx?.reason || "sin-contexto" };
  const valid = new Set(arr(ctx.problemIds).map(String));
  // Nombres reales de los nodos que se enmascararon para la IA (ver contexto.js):
  // se devuelven en el texto final (app y comentarios), nunca a la IA.
  const reales = Object.entries(ctx.nombresReales || {}).sort((a, b) => b[0].length - a[0].length);
  const real = (t) => (typeof t === "string" ? reales.reduce((acc, [m, r]) => acc.split(m).join(r), t) : t);

  // Fallas de la IA con motivo claro (en vez de "respuesta inválida"):
  // la tarea falló, agotó el tope de herramientas o respondió vacío.
  let ai = null;
  try {
    ai = await ex.result("analisis");
  } catch {
    ai = null;
  }
  if (!ai) {
    let detalle = "";
    try {
      const t = await executionsClient.getTaskExecution({ executionId: execution_id, id: "analisis" });
      detalle = t.stateInfo || "";
    } catch {
      /* sin detalle */
    }
    return { ok: false, reason: "ia-error", detalle: String(detalle).slice(0, 300) };
  }
  const texto = typeof ai.text === "string" ? ai.text : "";
  if (texto.includes(TOPE_HERRAMIENTAS)) return { ok: false, reason: "ia-tope-herramientas" };
  if (!ai.jsonOutput && !texto.trim()) return { ok: false, reason: "ia-sin-respuesta" };
  const out = parse(ai?.jsonOutput ?? ai?.output ?? ai?.text ?? ai);
  if (!out || !Array.isArray(out.causasRaiz)) {
    return { ok: false, reason: "respuesta-invalida", llaves: Object.keys(ai || {}), muestra: JSON.stringify(ai).slice(0, 1500) };
  }

  const roots = [];
  const isRoot = new Set();
  let descartados = 0;
  for (const c of out.causasRaiz) {
    const id = String(c?.problemId ?? "");
    if (!valid.has(id) || isRoot.has(id)) {
      descartados++;
      continue;
    }
    isRoot.add(id);
    roots.push({
      problemId: id,
      veredicto: real(txt(c.veredicto, 400)),
      razon: real(txt(c.razon)),
      recomendaciones: arr(c.recomendaciones).map((r) => real(txt(r, 300))).filter(Boolean).slice(0, 5),
      confianza: ["alta", "media", "baja"].includes(c?.confianza) ? c.confianza : "baja",
      efectos: arr(c.efectos).map(String),
      evidencia: arr(c.evidencia).map((e) => real(txt(e, 400))).filter(Boolean).slice(0, 8),
    });
  }
  const asignado = new Set();
  for (const r of roots) {
    const ef = r.efectos.filter((id) => valid.has(id) && !isRoot.has(id) && !asignado.has(id));
    descartados += r.efectos.length - ef.length;
    ef.forEach((id) => asignado.add(id));
    r.efectos = ef;
  }
  const sinClasificar = [...valid].filter((id) => !isRoot.has(id) && !asignado.has(id));
  // Datos de presentación de cada problema, tomados del MISMO contexto que vio la IA.
  const problemas = {};
  try {
    for (const p of JSON.parse(ctx.contextJson || "{}").problemas || []) {
      problemas[String(p.id)] = {
        displayId: p.displayId,
        nombre: p.nombre,
        categoria: p.categoria,
        inicio: p.inicio,
        nodos: arr(p.nodosDelMapa).map(String).map(real),
      };
    }
  } catch {
    /* sin metadatos: la app muestra el id */
  }
  // Confianza calculada por cada causa (promedio de sus relaciones con efectos).
  let C = {};
  try {
    C = JSON.parse(ctx.contextJson || "{}");
  } catch {
    C = {};
  }
  const ev = evidencia(C, ctx);
  const orden = { baja: 0, media: 1, alta: 2 };
  for (const r of roots) {
    const rels = r.efectos.map((id) => ({ efecto: id, ...ev(r.problemId, id) }));
    r.evidenciaCalc = rels;
    if (!rels.length) r.confianzaCalc = null; // causa aislada: no explica otros problemas
    else {
      const prom = rels.reduce((a, x) => a + orden[x.nivel], 0) / rels.length;
      r.confianzaCalc = prom >= 1.5 ? "alta" : prom >= 0.75 ? "media" : "baja";
    }
  }

  return {
    ok: true,
    version: 1,
    generadoEn: new Date().toISOString(),
    causasRaiz: roots,
    sinClasificar,
    resumen: real(txt(out.resumen, 800)),
    descartados,
    problemas,
  };
}
