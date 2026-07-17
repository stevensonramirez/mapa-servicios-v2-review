import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";

// ─────────────────────────────────────────────────────────────────────────────
// Puente hacia "Dynatrace Assist" (la app `dynatrace.davis.copilot` del tenant).
//
// LECCIÓN (probado en vivo, jul 2026): el intent `ask-question` NO sirve para
// llegar al modo agéntico. Con `execute: true` la conversación nace por la vía
// clásica y el toggle "Agentic" queda bloqueado ("isn't available for older
// conversations"); sin `execute`, el prompt llega pre-cargado pero el toggle
// sale igual deshabilitado ("contact your administrator"), aunque el MISMO
// usuario abriendo el Assist a mano sí lo tiene disponible. Es decir: solo una
// conversación iniciada como la inicia el usuario (app abierta limpia) puede
// ser agéntica.
//
// Además, la app está OCULTA para acceso directo por URL ("This application is
// not available for direct access")… PERO al abrir esa URL el App Shell levanta
// el PANEL LATERAL de Assist con una conversación nueva donde Agentic SÍ queda
// activable (verificado en vivo). No existe deep-link oficial al panel
// (confirmado en la documentación), así que ese comportamiento es el único
// camino para "levantar" el Assist agéntico desde una app.
//
// Mecanismo final: copiar la pregunta al portapapeles Y abrir esa URL en
// ventana nueva → el usuario pega en el panel, activa Agentic y envía.
// ─────────────────────────────────────────────────────────────────────────────

export const ASSIST_APP_ID = "dynatrace.davis.copilot";

// Copia la pregunta y abre el Assist (panel lateral en ventana nueva).
// Devuelve si la copia funcionó (sin permiso de portapapeles igual se abre).
export const openAssistWithPrompt = async (prompt: string): Promise<boolean> => {
  const q = prompt.trim();
  if (!q) return false;
  let copied = false;
  try {
    await navigator.clipboard.writeText(q);
    copied = true;
  } catch {
    /* sin permiso de portapapeles: se abre igual y el usuario escribe a mano */
  }
  const base = getEnvironmentUrl().replace(/\/+$/, "");
  window.open(`${base}/ui/apps/${ASSIST_APP_ID}`, "_blank", "noopener,noreferrer");
  return copied;
};
