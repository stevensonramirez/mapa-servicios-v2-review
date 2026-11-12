// DQL de ejemplo para los nodos sembrados/migrados (CoreX). Vive en su propio
// módulo para que tanto MapCanvas como la persistencia lo usen sin ciclos de
// importación (este módulo no importa nada en runtime).

// Escapa un valor antes de interpolarlo dentro de un literal de cadena DQL
// ("..."): neutraliza comillas, barras invertidas y saltos de línea para que un
// guardianName proveniente de un mapa importado/alterado no pueda romper ni
// alterar la consulta (DQL es de solo lectura, pero igual no se inyecta).
const escapeDqlString = (s: string): string =>
  s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ");

// DQL de ejemplo: devuelve status 0/1/2 a partir del último veredicto del
// guardian. Es solo un ejemplo del contrato genérico — cualquier nodo puede
// apuntar a cualquier entidad con su propio DQL.
export const corexDql = (srgName: string): string =>
  `fetch events, from: now()-2h
| filter event.kind == "SDLC_EVENT" and event.provider == "dynatrace.site.reliability.guardian" and event.type == "validation"
| filter dt.srg.name == "${escapeDqlString(srgName)}"
| sort timestamp desc
| limit 1
| fieldsAdd status = if(validation.result == "pass", 0, else: if(validation.result == "warning", 1, else: 2))
| fields status`;
