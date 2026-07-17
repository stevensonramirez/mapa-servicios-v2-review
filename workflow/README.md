# Workflow «Causa raíz» (Mapas de Servicios V2)

Workflow de Dynatrace que ejecuta la app con el botón **Causa raíz**. Recibe los nodos, conexiones y
problemas del mapa (los activos y los cerrados hace pocos minutos: `RC_CLOSED_WINDOW_MIN` en
`rootCause.ts`, hoy 15), y devuelve cuáles problemas son **causa raíz** (independientes entre sí)
y cuáles son **efectos**, con la razón y la evidencia. Todo es de solo lectura.

## Archivos

| Archivo | Qué es |
|---|---|
| `contexto.js` | Tarea 1 (Run JavaScript). Lee el input, trae por DQL el detalle de los problemas (sin duplicados de Davis), sus eventos y la topología real de las entidades (clúster, namespace, host y relaciones de Smartscape). Tope de 90k caracteres. Enmascara IPs, correos y URLs con `[ip]`, `[correo]`, `[url]` antes de la IA y devuelve aparte `nombresReales` (nombre enmascarado → real, NO va a la IA) para restaurar los nombres de nodo en el resultado y los comentarios. |
| `prompt.md` | Prompt de la tarea 2 (Dynatrace Intelligence, acción `prompt-agentic-ai`). |
| `output-schema.json` | JSON Schema de la respuesta de la IA. |
| `resultado.js` | Tarea 3 (Run JavaScript). Valida la respuesta: solo ids que estaban en el contexto, cada problema en un solo lugar. Es lo que lee la app. |
| `build-workflow.py` | Arma `causa-raiz.<staging|prod>.workflow.json` a partir de los archivos anteriores. |

## Workflows en el tenant

| Ambiente | Id | Dueño |
|---|---|---|
| staging | `aa1df053-2598-473f-968c-79bc0fe32b0f` | usuario (temporal, luego un grupo) |
| prod | `22a757f2-fdae-4a59-8dcb-78bad4b98d94` | usuario (temporal, luego un grupo) |

## Cambiar y publicar

```bash
python3 build-workflow.py staging
dtctl apply -f causa-raiz.staging.workflow.json --context my-env
```

El JSON lleva el `id`, así que `apply` actualiza el workflow existente en vez de crear otro.

## Probar a mano

```bash
dtctl exec workflow aa1df053-2598-473f-968c-79bc0fe32b0f --input "$(cat input.json)" --wait --show-results --context my-env
```

### Entrada (la manda la app)

```json
{ "mapId": "…", "mapName": "…", "requestedBy": "…",
  "nodes": [{ "id": "n1", "name": "…", "state": "err|warn|ok", "entityId": "SERVICE-…", "problemIds": ["<event.id>"] }],
  "edges": [{ "from": "n4", "to": "n1" }] }
```

`from -> to` es el sentido del flujo de la petición. `problemIds` son `event.id` de Davis, no `display_id`.

### Salida (tarea `resultado`)

```json
{ "ok": true, "version": 1, "generadoEn": "…",
  "causasRaiz": [{ "problemId": "…", "razon": "…", "confianza": "alta|media|baja", "efectos": ["…"], "evidencia": ["…"] }],
  "sinClasificar": ["…"], "resumen": "…", "descartados": 0 }
```

La app lee el resultado con `executionsClient.getTaskExecutionResult({ executionId, id: "resultado" })`.

## Lecciones de las pruebas

- **El orden temporal no basta.** En la primera prueba la IA culpó, con confianza «alta», a un host de
  otro clúster por los problemas de dos deployments. Por eso el contexto incluye la topología real y el
  prompt exige una relación verificable antes de marcar un efecto.
- La acción vigente es `dynatrace.davis.workflow.actions:prompt-agentic-ai`. La de
  `dynatrace.davis.copilot.workflow.actions:agent-operator` está marcada como obsoleta.
