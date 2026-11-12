// Tarea 4 del workflow "Análisis de causa raíz": ARMA los comentarios (markdown)
// que la tarea 5 ("anotar", acción oficial «Annotate & Link» de la app Problems)
// publica en cada problema. Así quien abra el problema en la app Problems ya ve
// el pre-análisis:
//   - Causa raíz → el mismo contenido del modal de la app.
//   - Efecto → nota que apunta a su causa raíz.
// Un comentario por problema y por mapa: se actualiza en cada análisis
// (mismo `annotationId`).
// Solo corre si la app lo pide (input.comentar === true). Nunca hace fallar el
// workflow. Prueba controlada: `comentarSoloIds` limita a esos problemas.
import { execution } from "@dynatrace-sdk/automation-utils";
import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";

const MAX_CHARS = 4800;
const arr = (v) => (Array.isArray(v) ? v : []);
const enCol = (iso) => {
  try {
    return new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" });
  } catch {
    return "";
  }
};

export default async function ({ execution_id }) {
  try {
    const ex = await execution(execution_id);
    const inp = { ...(ex.params || {}), ...(ex.input || {}) };
    if (inp.comentar !== true) return { ok: true, omitido: "comentarios-apagados", lista: [] };
    const res = await ex.result("resultado").catch(() => null);
    const ctx = await ex.result("contexto").catch(() => null);
    // Metadatos de cada problema: del resultado o, si el análisis falló, del contexto.
    let P = res?.problemas || {};
    if (!res?.ok) {
      P = {};
      // Sin resultado: los nombres vienen del contexto enmascarado → restaurarlos.
      const reales = Object.entries(ctx?.nombresReales || {}).sort((a, b) => b[0].length - a[0].length);
      const real = (t) => reales.reduce((acc, [m, r]) => acc.split(m).join(r), t);
      try {
        for (const p of JSON.parse(ctx?.contextJson || "{}").problemas || []) {
          P[String(p.id)] = { displayId: p.displayId, nombre: p.nombre, nodos: arr(p.nodosDelMapa).map(String).map(real) };
        }
      } catch {
        /* sin metadatos */
      }
    }
    const mapa = String(inp.mapName || "sin nombre").slice(0, 120);
    // Se ve en la app como «via …» y sirve para reconocer los comentarios de este mapa.
    // Quién pidió el análisis (lo manda la app). El autor del comentario en
    // Problems es siempre el actor del workflow; por eso el nombre va en el texto.
    const quien = String(inp.requestedBy || "").trim().slice(0, 80);
    const fuente = `Mapas de Servicios V2 · ${mapa}${quien ? ` · ${quien}` : ""}`.slice(0, 150);
    const cuando = enCol(res?.generadoEn || new Date().toISOString());
    // Primera línea de todos los comentarios: quién lo solicitó y cuándo.
    const cabeza = quien ? `👤 **Solicitado por:** ${quien} · ${cuando}` : `🕘 **Análisis:** ${cuando}`;
    // Prueba controlada: si viene `comentarSoloIds`, solo se comentan esos problemas.
    const solo = arr(inp.comentarSoloIds).map(String);
    const permitido = (id) => !solo.length || solo.includes(id);
    let base = "";
    try {
      base = getEnvironmentUrl().replace(/\/$/, "");
    } catch {
      base = "";
    }
    const link = (id) => {
      const etiqueta = `**${P[id]?.displayId || id}**`;
      return base ? `[${etiqueta}](${base}/ui/apps/dynatrace.davis.problems/problem/${encodeURIComponent(id)})` : etiqueta;
    };
    const nodos = (id) => arr(P[id]?.nodos).join(", ");
    const datos = (id) =>
      [`**Mapa:** ${mapa}`, nodos(id) ? `**Nodo:** ${nodos(id)}` : ""].filter(Boolean).join(" · ");
    const conf = { alta: "🟢 Alta", media: "🟡 Media", baja: "🟠 Baja" };
    const SENAL = {
      topologia: "Relación en Smartscape",
      orden: "Orden en el tiempo",
      raizDavis: "Raíz según Davis",
      eventos: "Eventos compartidos",
      entorno: "Mismo clúster o host",
      conexionMapa: "Conexión del mapa",
    };
    const evDe = (c, id) => arr(c.evidenciaCalc).find((x) => x.efecto === id);
    const confTxt = (c) =>
      c.confianzaCalc === null
        ? "⚪ Causa aislada (no explica otros problemas del mapa)"
        : c.confianzaCalc
          ? `${conf[c.confianzaCalc]} · calculada con evidencia verificable`
          : conf[c.confianza] || c.confianza;
    const senalesTxt = (x) =>
      Object.entries(SENAL)
        .filter(([k]) => x.senales?.[k] === true || x.senales?.[k] === false)
        .map(([k, nombre]) => `${x.senales[k] ? "✔" : "✖"} ${nombre}`)
        .join(" · ");
    const pie = "_Pre-análisis generado por Dynatrace Intelligence desde Mapas de Servicios V2. Se actualiza en cada análisis del mapa._";

    const mensajes = new Map();
    // Análisis fallido: cada problema recibe el motivo (reemplaza su «⏳»).
    if (!res?.ok) {
      const motivos = {
        "ia-tope-herramientas": "la IA alcanzó su tope de consultas antes de terminar",
        "ia-sin-respuesta": "la IA no devolvió respuesta",
        "ia-error": `la IA falló${res?.detalle ? ` (${res.detalle})` : ""}`,
        "respuesta-invalida": "la respuesta de la IA no fue válida",
      };
      for (const id of arr(ctx?.problemIds).map(String)) {
        if (!permitido(id)) continue;
        mensajes.set(
          id,
          [
            cabeza,
            "",
            "### ⚠️ Análisis de causa raíz sin resultado",
            datos(id),
            "",
            `El análisis no pudo completarse: ${motivos[res?.reason] || "error inesperado"}. Vuelve a analizar desde el mapa.`,
            "",
            "---",
            pie,
          ].join("\n"),
        );
      }
    }
    for (const c of arr(res?.causasRaiz)) {
      const efectos = arr(c.efectos);
      // Orden: veredicto → por qué → qué hacer → efectos → evidencia.
      const l = [cabeza, "", "### 🔴 Causa raíz", datos(c.problemId), ""];
      if (c.veredicto) l.push(`> **${c.veredicto}**`, "");
      l.push("#### Por qué es causa raíz", c.razon, "", `**Confianza:** ${confTxt(c)} · _la IA la calificó: ${c.confianza}_`);
      if (arr(c.recomendaciones).length) {
        l.push("", "#### Qué hacer");
        arr(c.recomendaciones).forEach((r, i) => l.push(`${i + 1}. ${r}`));
      }
      if (efectos.length) {
        l.push("", `#### Efectos que explica (${efectos.length})`);
        for (const e of efectos) {
          const x = evDe(c, e);
          l.push(`- ${link(e)} · ${P[e]?.nombre || "problema"}${nodos(e) ? ` · nodo _${nodos(e)}_` : ""}${x ? ` · evidencia ${x.puntaje}/${x.total}` : ""}`);
        }
      }
      if (arr(c.evidencia).length) {
        l.push("", "#### Evidencia");
        for (const v of c.evidencia) l.push(`- ${v}`);
      }
      l.push("", "---", pie);
      if (permitido(c.problemId)) mensajes.set(c.problemId, l.join("\n"));
      for (const e of efectos) {
        if (!permitido(e)) continue;
        mensajes.set(
          e,
          [
            cabeza,
            "",
            "### 🔗 Efecto de otra causa raíz",
            datos(e),
            "",
            `> Este problema es **consecuencia** de ${link(c.problemId)} · ${P[c.problemId]?.nombre || "problema"}${nodos(c.problemId) ? ` (nodo _${nodos(c.problemId)}_)` : ""}. **Atiende primero la causa raíz:** su comentario tiene el detalle y qué hacer.`,
            "",
            ...(evDe(c, e)
              ? [`**Evidencia de la relación (${evDe(c, e).puntaje} de ${evDe(c, e).total}):** ${senalesTxt(evDe(c, e))}`, ""]
              : []),
            ...(c.veredicto ? ["#### Qué pasó en la causa raíz", c.veredicto, ""] : []),
            "#### Por qué este problema es efecto",
            c.razon,
            "",
            "---",
            pie,
          ].join("\n"),
        );
      }
    }

    // Sin clasificar: nota breve (reemplaza su «⏳»).
    for (const id of arr(res?.sinClasificar).map(String)) {
      if (!permitido(id) || mensajes.has(id)) continue;
      mensajes.set(
        id,
        [
          cabeza,
            "",
            "### ⚪ Sin clasificar",
          datos(id),
          "",
          "El análisis del mapa no encontró evidencia suficiente para saber si este problema es causa raíz o efecto de otro. Revísalo por separado.",
          "",
          "---",
          pie,
        ].join("\n"),
      );
    }

    // `annotationId` fijo por mapa y problema: «Annotate & Link» con el mismo id
    // ACTUALIZA el comentario en vez de crear otro (patrón del workflow oficial
    // «SRE Agent»). Así cada análisis del mapa reemplaza al anterior.
    const mapKey = String(inp.mapId || mapa).replace(/[^A-Za-z0-9-]/g, "").slice(0, 40);
    const items = [];
    for (const [problemId, texto] of mensajes) {
      items.push({ problemId, annotationId: `mapas-v2-${mapKey}-${problemId}`, source: fuente, text: texto.slice(0, MAX_CHARS) });
    }
    const omitidos = 0;
    return { ok: true, lista: items, omitidos };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e).slice(0, 300), lista: [] };
  }
}
