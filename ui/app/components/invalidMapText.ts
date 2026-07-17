import type { useT } from "../i18n";
import type { InvalidMap } from "./mapValidation";

// UNA línea de motivo para el aviso de «contenido no válido» (importar o abrir).
// Breve a propósito: dice qué no cuadra, sin diagnóstico técnico.
export const invalidReasonText = (t: ReturnType<typeof useT>, inv: InvalidMap): string => {
  switch (inv.code) {
    case "badNodeType":
      return t("invalid.reason.badNodeType", { type: inv.detail ?? "" });
    case "badSetting":
      return t("invalid.reason.badSetting", { name: inv.detail ?? "" });
    case "badNode":
      return t("invalid.reason.badNode");
    case "badEdge":
      return t("invalid.reason.badEdge");
    default:
      return t("invalid.reason.notMap");
  }
};
