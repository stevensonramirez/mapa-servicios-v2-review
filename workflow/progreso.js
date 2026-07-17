// Tarea del workflow "Análisis de causa raíz": comentario de PROGRESO.
// Apenas se arma el contexto, cada problema del mapa recibe «⏳ Análisis en
// curso». Al terminar, la tarea "anotar" lo REEMPLAZA (mismo annotationId) por
// el resultado: causa raíz, efecto, sin clasificar o el motivo de la falla.
// Patrón del workflow oficial «SRE Agent». Solo si input.comentar === true.
import { execution } from "@dynatrace-sdk/automation-utils";

const arr = (v) => (Array.isArray(v) ? v : []);

export default async function ({ execution_id }) {
  try {
    const ex = await execution(execution_id);
    const inp = { ...(ex.params || {}), ...(ex.input || {}) };
    if (inp.comentar !== true) return { lista: [] };
    const ctx = await ex.result("contexto");
    if (!ctx?.ok) return { lista: [] };
    const mapa = String(inp.mapName || "sin nombre").slice(0, 120);
    // MISMOS fuente y annotationId que en comentar.js (si no, no se reemplaza).
    const quien = String(inp.requestedBy || "").trim().slice(0, 80);
    const fuente = `Mapas de Servicios V2 · ${mapa}${quien ? ` · ${quien}` : ""}`.slice(0, 150);
    const cuando = new Date().toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" });
    const mapKey = String(inp.mapId || mapa).replace(/[^A-Za-z0-9-]/g, "").slice(0, 40);
    const solo = arr(inp.comentarSoloIds).map(String);
    const texto = [
      quien ? `👤 **Solicitado por:** ${quien} · ${cuando}` : `🕘 **Análisis:** ${cuando}`,
      "",
      "### ⏳ Análisis de causa raíz en curso",
      `**Mapa:** ${mapa}`,
      "",
      "Dynatrace Intelligence está analizando los problemas de este mapa. Este comentario se actualizará con el resultado en uno o dos minutos.",
      "",
      "---",
      "_Mapas de Servicios V2_",
    ].join("\n");
    const items = arr(ctx.problemIds)
      .map(String)
      .filter((id) => !solo.length || solo.includes(id))
      .map((problemId) => ({ problemId, annotationId: `mapas-v2-${mapKey}-${problemId}`, source: fuente, text: texto }));
    return { lista: items };
  } catch {
    return { lista: [] };
  }
}
