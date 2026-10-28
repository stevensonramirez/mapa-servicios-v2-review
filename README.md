# Mapas de Servicios V2 — Documentación técnica

App de Dynatrace AppEngine (`my.mapaservicios.v2`, v0.9.1) para mapas curados de servicios con estado
en vivo. Este documento es para el equipo que va a **mantener y evolucionar** la app: cómo está hecha,
dónde está cada cosa y qué consideraciones no son obvias. La guía funcional está en
[GUIA-USUARIO.md](GUIA-USUARIO.md).

---

## 📑 Índice

1. [Stack y arquitectura en una hoja](#1-stack-y-arquitectura-en-una-hoja)
2. [Requisitos y comandos](#2-requisitos-y-comandos)
3. [Configuración de la app y scopes](#3-configuración-de-la-app-y-scopes)
4. [Mapa de archivos](#4-mapa-de-archivos)
5. [Modelo de datos y persistencia](#5-modelo-de-datos-y-persistencia)
6. [El motor de estado](#6-el-motor-de-estado)
7. [Integración con Smartscape (topología)](#7-integración-con-smartscape-topología)
8. [IA: Davis CoPilot y Dynatrace Assist](#8-ia-davis-copilot-y-dynatrace-assist)
9. [i18n](#9-i18n)
10. [Workflow de cambios y deploy](#10-workflow-de-cambios-y-deploy)
11. [Gotchas, léelos antes de tocar código](#11-gotchas--léelos-antes-de-tocar-código)
12. [Troubleshooting](#12-troubleshooting)
13. [Appendix · Contexto para agentes de IA](#13-appendix--contexto-para-agentes-de-ia)

---

## 1. Stack y arquitectura en una hoja

- **Plataforma**: Dynatrace AppEngine (app custom, corre en iframe sandbox dentro del tenant).
  Tenant actual: `lqy04258.apps.dynatrace.com`.
- **Frontend**: React 18 + TypeScript. **Sin backend propio**, todo son consultas DQL y SDKs de
  Dynatrace desde el cliente.
- **Lienzo**: [`@xyflow/react`](https://reactflow.dev) v12 (React Flow) para nodos/conexiones/viewport.
- **UI**: Strato Design System (`@dynatrace/strato-components[-preview]`, tokens, íconos) +
  `simple-icons` para logos de marcas.
- **Datos**:
  - Estado/consulta: `@dynatrace-sdk/react-hooks` (`useDql`) y `@dynatrace-sdk/client-query`.
  - Persistencia: **Document service** (`@dynatrace-sdk/client-document`), 1 documento JSON por mapa,
    con snapshots nativos (historial) y papelera.
  - Compartir: `document:direct-shares` + IAM (búsqueda de personas por nombre/correo y de grupos por nombre).
  - IA: `@dynatrace-sdk/client-davis-copilot` (conversación + nl2dql).
- **Ruteo**: `react-router-dom` (URL por mapa `…/map/<id>`).
- **Tooling**: `dt-app` CLI 1.10.2 (build/dev/deploy), ESLint 9 con plugins de seguridad.

```
┌────────────────────────── App (iframe, solo cliente) ──────────────────────────┐
│  MapCanvas.tsx (orquestador)                                                   │
│   ├─ React Flow: SeverityNode / LabelNode / ImageNode / MapEdge                │
│   ├─ Motor de estado:                                                          │
│   │    · DQL por nodo/conexión (contrato 0/1/2)          → Grail (con costo)       │
│   │    · useDavisStatus (1 query dt.davis.problems)  → Grail (con costo, 1/mapa)│
│   │    · useEntityMetadata / useEntityRelations /                              │
│   │      useEntityCatalog (smartscapeNodes/Edges)    → sin costo (0 bytes)        │
│   ├─ useMapPersistence → Document service (1 doc/mapa, autosave debounced)     │
│   ├─ useMapVersions    → snapshots nativos del Document service                │
│   ├─ useMapShare       → direct-shares + IAM                                   │
│   ├─ WhyModal / copilotExplain → Davis CoPilot (on salvo `copilotOff`, gen-AI ON)│
│   └─ assistIntent → Dynatrace Assist (portapapeles + ventana nueva)           │
└────────────────────────────────────────────────────────────────────────────────┘
```

## 2. Requisitos y comandos

- Node.js **24** (el CLI advierte con otras versiones), npm.
- Acceso al tenant con permisos para desplegar apps (el deploy abre login SSO en el navegador).

```bash
npm install          # dependencias
npm run lint         # ESLint (incluye reglas de seguridad)
npm run build        # dt-app build (compila y valida el manifiesto)
npm start            # dt-app dev, servidor local contra el tenant real
npm run deploy       # dt-app deploy, publica al tenant de app.config.json
```

## 3. Configuración de la app y scopes

Todo vive en [`app.config.json`](app.config.json): `environmentUrl` (tenant destino), `app.id`
(**define la URL final**, el prefijo `my.` es obligatorio para apps custom), `version`, y la lista de
`scopes` **comentada uno a uno** (cada scope dice qué feature lo necesita, mantener esos comentarios).

Puntos no obvios:

- `storage:smartscape:read` es **distinto** de `storage:entities:read`: `smartscapeNodes`/
  `smartscapeEdges` exigen el primero; sin él la consulta falla con `NOT_AUTHORIZED_FOR_TABLE`.
- `storage:files:read` (para `load "/lookups/..."` en DQL de usuario) tiene **dos capas**: el scope de
  la app **y** una política IAM del usuario. Si falla tras re-autorizar, falta la IAM.
- Los dos scopes `davis-copilot:*` requieren además que el tenant tenga las capacidades de **IA
  generativa habilitadas**; si no, la burbuja «¿Por qué?» degrada con un mensaje honesto. Solo entran
  en juego con Davis CoPilot en la burbuja (encendido salvo `copilotOff`); **el puente a Dynatrace Assist no necesita scope**
  (es portapapeles + `window.open`).
- **Al agregar/cambiar scopes**: tras el deploy, cada usuario debe **re-autorizar** la app (Dynatrace
  vuelve a pedir consentimiento).

## 4. Mapa de archivos

Todo el código de UI está en `ui/app/` (entrada `App.tsx`, páginas en `pages/`, resto en
`components/`).

| Archivo | Qué hace |
|---|---|
| `MapCanvas.tsx` | **El orquestador** (~110 KB). React Flow, toolbar, wiring de todos los hooks, `displayNodes` (inyección de estado en render), undo/redo, reorganizar, acciones del popover de relacionados. Casi cualquier feature pasa por aquí. |
| `SeverityNode.tsx` | El nodo de estado: render, `SeverityNodeData` (el tipo central del nodo), toolbars (Editar/Notas/Relacionados), glow, pill de salud de conexiones, links del nodo (`NodeLink`/`nodeLinks` + popup con 2+). |
| `LabelNode.tsx` / `ImageNode.tsx` | Nodo de texto Markdown (con escala del bloque `data.scale` 0.5–3, botones A−/A+ en la toolbar en reposo; se aplica como `zoom` sobre `.mapa-md`) / nodo-imagen. |
| `GroupNode.tsx` | Nodo **Agrupador**: marco contenedor (subflujo de React Flow, `parentId`). Miembros por arrastre con umbral de salida (dentro del umbral el marco devuelve el nodo animado; pasado, lo libera), acomodo automático en cuadrícula, color por el **peor estado de los miembros** (derivado en `displayNodes`, cero consultas), manija de resize (esquina inferior derecha, visible en hover/selección), título renombrable (vacío = chip `+`), papelera propia (borra SOLO el marco). |
| `MapEdge.tsx` + `edgeRouting.ts` | Render de conexiones: anclaje flotante, chevrones, evasión de nodos, carriles paralelos, puertos en abanico. Rótulo `DQL` en línea (hueco en la raya con `--mapa-bg-solid`) cuando `inheritStatus=false` y hay DQL; **chip de valor** en el punto medio vía `EdgeLabelRenderer` (clic → `popUi.onEditEdge`). |
| `NodeEditorModal.tsx` | Editor de nodo en **2 pestañas** (`Tabs`/`Tab` de Strato): **Contenido** (nombre, subtítulo, fuente del estado con botones segmentados, el bloque de esa fuente y Notas, cada uno en su sección) y **Links y aspecto** (links, ícono, forma, tamaño, en filas). La salud de conexiones es un checkbox + umbral DENTRO del bloque de Entidad Smartscape, no una pestaña. |
| `EdgeEditorModal.tsx` | Editor de conexión: DQL propio, **heredar estado** (`inheritStatus`), invertir dirección, y el bloque **valor por DQL** (`valueEnabled/valueDql/valueLabel/valueShowLabel/valueUnit`, despliegue animado `.mapa-reveal`, Probar con vista previa del chip). Exporta el tipo `EdgeData`. |
| `entityModel.ts` | Modelo de entidad: `EntityType` (11 tipos), `EntityRef`, prefijo↔tipo, `dqlQuote`, `entityIntentLink`/`openEntity` (deep-link a Smartscape). |
| `useEntityCatalog.ts` | Búsqueda de entidades para el picker (`smartscapeNodes "<TIPO>"`, debounce 300 ms, tope 200). Para **servicios** añade 3 lookups de Smartscape ANTES del filtro (`belongs_to` K8S_DEPLOYMENT/K8S_NAMESPACE, `runs_on` PROCESS), el filtro busca en nombre + `ns` + `wl` + `pg` + `id_classic`, y arma `ctx` = `namespace / workload` → grupo de procesos → host (`ctx` es solo del selector, NO se persiste). Si la lista llega al tope, dispara una 2.ª consulta de conteo (`total`) para el aviso "Mostrando 200 de N". |
| `useDavisStatus.ts` | `useDavisStatus` (severidad por Davis, 1 query batcheada) + `useEntityMetadata` (nombre en vivo / detección de baja) + `useIsReady` (anti-falso-verde). |
| `useEntityRelations.ts` | Relaciones reales (`smartscapeEdges "*"` filtrado a `type == "calls"`). |
| `RelatedPopover.tsx` | Panel «Entidades Relacionadas»: 3 listas (conectar / agregar y conectar / conexiones sin respaldo). |
| `TopologyModal.tsx` | «Sugerir conexiones» global. |
| `EntityPicker.tsx` | Selector de Entidad Smartscape: tipo + barra de búsqueda con **dropdown flotante** de resultados (filtrado en vivo) en tres columnas **nombre \| contexto \| id** (el tipo no se repite: ya está en el desplegable; con container query angosto se oculta el contexto), y la entidad atada como **chip** con nombre + id y botón «Abrir en Dynatrace». |
| `WhyModal.tsx` + `copilotExplain.ts` | Burbuja «¿Por qué está así?»: estado del nodo + lista de problemas activos con scroll (id, título, chip de categoría, link a Dynatrace) + fila de acciones. Motor de evidencia; con CoPilot encendido (todos los mapas salvo `copilotOff`), explicación por Davis CoPilot + «Investigar a fondo» (nl2dql). Rutas separadas para nodos con entidad y nodos DQL. **Lista de problemas** (tope `ACTIVE_PROBLEMS_LIMIT` = 12, sin duplicados de Davis): primero sale del **mismo DQL del nodo** si consulta `dt.davis.problems` (`buildNodeProblemsQuery`); si ese DQL no deja `event.id` (resume con `summarize`) o falla, cae a la extracción por ids/tags (`collectTagConditions`, **solo etapas `filter`**). Al llegar al tope, una consulta de conteo da el total real («N, mostrando 12»). |
| `rootCause.ts` | **Análisis de causa raíz**: recolecta los problemas activos de cada nodo (Davis por entidad + población del DQL del nodo, sin duplicados), ejecuta el workflow (`RC_WORKFLOW_ID`, `workflowsClient.runWorkflow` con `input`), espera (`getExecution` cada 4 s, tope 10 min), lee la tarea `resultado` y arma `RcAnalysis` (causas numeradas, efectos con evidencia verificable). `RC_COMMENT_PROBLEMS` enciende los comentarios en los problemas. |
| `RootCauseLegend.tsx` / `RootCauseModal.tsx` | Leyenda «Causas raíz» (arriba-derecha) y modal recorrible (veredicto → por qué → qué hacer → efectos con link e «Ir al nodo» → evidencia plegada). |
| `workflow/` | Fuente del workflow de Dynatrace del análisis (`contexto.js`, `prompt.md`, `output-schema.json`, `resultado.js`, `progreso.js`, `comentar.js`, `build-workflow.py`). Ver `workflow/README.md`. |
| `assistIntent.ts` | Puente a **Dynatrace Assist** (`dynatrace.davis.copilot`): `openAssistWithPrompt` copia la pregunta al portapapeles y abre la app en ventana nueva (el App Shell levanta el panel con Agentic activable). Lee el comentario del archivo antes de tocarlo: los intentos por Intent están documentados ahí. |
| `nodeStatus.tsx` | Contrato de severidad DQL (0/1/2) y conversión filas→severidad (`NodeStatusProbe`); contrato de **valor** (`recordsToValue`: campo `value` o primer numérico, arreglo → último punto; `formatValue` compacto; `DqlValueProbe`, mismo dedupe/escalonado/pausa). |
| `useMapPersistence.ts` | Persistencia completa: Document service, autosave debounced, multi-mapa, papelera, import/export, validación ESTRICTA al cargar (`mapValidation.ts`, sin rescates) y normalización. Read-only real por mapa: sale del rol (`resolveRole` de `analystRole.ts` con `access`, `owner` y `labels` del documento; el listado pide `addFields: "labels"`), no de un 403 al guardar; `MapMeta.readOnly`/`MapMeta.analyst` lo llevan a la lista. El analista es `readOnly` y solo escribe por `saveAnalysis` (únicamente `settings.rootCause`). |
| `analystRole.ts` | **Rol Analista**, núcleo puro sin SDK (se prueba con `node --test`): labels `an:<sso>;<sso>` (`readAnalysts`/`writeAnalysts`/`withAnalyst`, tope 50), `resolveRole`, plan de cambios de rol en orden seguro (`planRoleChange`/`runRoleChange`/`shareStartState`), guardado del análisis con bloqueo optimista (`patchRootCause`/`saveAnalysisWith`) e interruptor `ANALYST_ROLE_ENABLED` (solo la opción en Compartir). |
| `useMapVersions.ts` + `VersionHistory.tsx` | Historial: snapshots nativos (cadencia ~3 min de inactividad + manual), listar/preview/restaurar. |
| `useMapShare.ts` + `ShareModal.tsx` | Compartir con personas (IAM users, por nombre/correo) y con grupos (IAM groups, por nombre; etiqueta «Grupo») con 3 roles: Solo lectura (share `read`), Analista (share `read-write` + label, solo personas) y Edición (share `read-write`). Cada cambio de rol corre los pasos de `planRoleChange` (ver §5). `searchUsers` consulta usuarios y grupos en paralelo con try/catch independientes; los destinatarios viajan como `SsoEntity {id, type: "user" \| "group"}`. Si quien abre el modal es analista del mapa, no puede cambiar nada. |
| `tests/` | Pruebas del núcleo del rol Analista con el runner de Node (`node --no-warnings --test tests/`, Node ≥ 23, sin dependencias): transiciones de rol con fallos simulados en cada paso, guardado contra un Document service simulado con bloqueo optimista, labels y paridad de Compartir. |
| `rollback/` | Kit de rollback del rol Analista: `apagar-analista.sh` (nivel 1), `volver-v087.sh` (nivel 2), `listar-analistas.js` (consola del navegador, solo lectura) y su `README.md`. |
| `mapLibraryContext.tsx` / `MapSidebar.tsx` / `TrashModal.tsx` | Biblioteca de mapas, sidebar (ícono por tipo de mapa, acento en el Mapa Padre, arrastre de un mapa al lienzo), papelera (30 días). |
| `NewMapModal.tsx` | Modal de creación: elige el tipo del mapa (Mapa de Servicio o Mapa Padre). Un Mapa de Servicio puede convertirse en Mapa Padre después (menú ⋮, un solo sentido). |
| `useSubmapStatus.ts` | Estado de los nodos sub-mapa: evalúa la salud del mapa incrustado (ejecuta sus DQL con la cadencia del Mapa Padre) y produce la métrica de la pastilla. |
| `submapDocs.ts` | Caché de los documentos hijos y validación anti-anidamiento (un mapa una sola vez, sin Mapa Padre dentro de Mapa Padre). |
| `submapRules.ts` + `ColorRules.tsx` | Motor de reglas de color (hasta 3 filas: severidad + operador + valor, primera que se cumple gana) y su editor. |
| `MapPicker.tsx` / `mapLink.ts` | Selector del mapa a incrustar (fuente de estado «Mapa») y armado del enlace al mapa hijo. |
| `iconCatalog.tsx` / `IconPicker.tsx` | Galería de íconos (Strato + simple-icons + marcas a mano). |
| `SettingsModal.tsx` / `mapSettings.tsx` | Ajustes por mapa en **2 pestañas**: **General** (frecuencia de actualización / cadencia del Mapa Padre, `copilotOff`, `assistPrompt` + restaurar por defecto) y **Apariencia** (glow, logos de marca a color, mostrar consumo estimado, idioma). Filas con etiqueta a la izquierda y control a la derecha. |
| `i18n.tsx` | TODOS los textos, 4 idiomas (es/en/fr/de). ~94 KB. |
| `map.css` | Estilos (variables CSS por paleta, glow GPU vía `::after`, clases del popover). |
| `mapSeed.ts` | Mapa inicial de ejemplo. |
| `clipboard.ts`, `mdEdit.ts`, `popUi.tsx`, `labelUi.tsx`, `ConfirmDialog.tsx`, `AddMenu.tsx`, `Header.tsx`, `ZoomControls.tsx`, `AboutModal.tsx`, `ExportModal.tsx`, `MapActionsMenu.tsx` | Utilidades y piezas menores de UI. |

## 5. Modelo de datos y persistencia

- **1 documento por mapa** en el Document service, con un `DOC_TYPE` propio de esta app (aislado de la
  V1 de producción; igual el prefijo de `localStorage` y la clave de idioma, **no** unificar con V1,
  es a propósito para que puedan convivir en la misma sesión de navegador).
- **Tipo de mapa (`mapType`)**: el valor canónico vive en el **contenido** del documento y se **espeja
  en el `type` del documento** (`<DOC_TYPE>.parent` para los Mapas Padre), porque el listado del
  Document service **no devuelve `description`** y hace falta conocer el tipo sin abrir cada
  documento. Por eso la lista de mapas y la papelera consultan **los dos types**. El tipo se define
  al crear; el export/import JSON lo conserva. Un Mapa de Servicio puede **convertirse en Mapa Padre**
  (`convertToParent`, menú ⋮ del mapa, previa confirmación): la conversión actualiza el snapshot y el
  espejo del `type` sobre el **mismo documento** (conserva id, URL, compartidos e historial) y es de
  **un solo sentido**. Como candado, al cargar un mapa el `type` del documento manda sobre el
  contenido: restaurar una versión del historial anterior a la conversión no revierte el tipo.
- El snapshot del mapa serializa nodos, conexiones, viewport y ajustes. `cleanSnapshot` usa **spread** (no
  whitelist): cualquier campo nuevo en `data` de nodos/conexiones **persiste solo**, sin tocar la
  persistencia. Por eso `entity`, `statusSource`, `inheritStatus`, `topologyIgnored`, etc. viajan
  sin trabajo adicional.
- Campos **transitorios** (severidad calculada, nombre en vivo, `retired`, contadores de problemas) se
  inyectan **solo en render** (`displayNodes` en `MapCanvas.tsx`) y jamás se persisten.
- **Autosave debounced** con guardas para no escribir el mapa A en el documento B al cambiar de mapa
  (bug real ya arreglado, cuidado al tocar esa zona).
- **Historial**: snapshots nativos del Document service (`createSnapshot`/`listSnapshots`/
  `restoreSnapshot`), disparados por inactividad (~3 min) solo cuando hubo cambios.
- **Imágenes**: base64 dentro del doc (límite 5 MB, solo PNG/JPG). En el historial de undo/redo las
  imágenes se **dedupican** por hash (`histEncode`/`histDecode` con refs `@img:<hash>`) para no
  multiplicar MB por paso.
- **Ajustes por mapa** (`MapSettings` en `mapSettings.tsx`) viajan dentro del documento. Los dos de
  esta versión: `copilotOff?: boolean` (análisis con IA en la burbuja **encendido** salvo `copilotOff:
  true`; el viejo `aiInsights` ya no se lee, ver gotcha 15) y `assistPrompt?: string` (plantilla personalizada del prompt de Assist;
  sin valor o en blanco se usa el default del idioma activo, y el valor personalizado **manda sobre el
  idioma** de la interfaz).
- **Rol Analista (labels del documento)**: quién es analista vive en las **labels** del documento, no en el
  contenido: `an:<sso-id>;<sso-id>`, dos ids por label (76 de los 80 caracteres permitidos; la plataforma
  admite 25 labels, así que el tope es 50 analistas). Al estar en la metadata, ni el autosave de un editor
  (último que escribe gana sobre el contenido), ni deshacer, duplicar, descargar o restaurar una versión las
  tocan. Rol efectivo (`resolveRole`): sin `write` → lector; dueño → dueño (nunca analista); id en una label
  `an:` → analista; si no → editor. El analista tiene share `read-write` por debajo; la app lo trata como
  `readOnly` y solo escribe `settings.rootCause` con `saveAnalysis`: relee el documento, confirma que sigue
  siendo analista, parcha el JSON crudo, valida con `validateMapContent` y escribe con
  `optimisticLockingVersion`; ante un 409 relee y reintenta (hasta 3 veces), así nunca pisa a un editor.
- **Cambios de rol al compartir** (`planRoleChange`): al subir a Analista, primero la label y luego el permiso;
  al bajar o quitar, primero el permiso y luego la label. Ningún fallo a mitad de camino deja a la persona con
  más permisos que el origen o el destino. Solo lectura, Edición y Quitar hacen las mismas llamadas de
  siempre (conceder el cubo pedido e intentar sacar del otro), más quitar la label si la persona la tiene.
- **Viewport por mapa**: el paneo/zoom NO va en el documento; se guarda en `localStorage` con clave
  `…:viewport:<mapId>` (debounce 300 ms). El id del mapa se captura **en el evento**, no al escribir,
  para que un paneo pendiente no se atribuya al mapa al que acabas de cambiar. Sin viewport recordado
  para ese mapa, la hidratación hace `fitView`.

### Tipos centrales

- `SeverityNodeData` (en `SeverityNode.tsx`): título, `dql?`, `entity?: EntityRef`,
  `statusSource?: "davis" | "dql"`, `links?: NodeLink[]`, notas, apariencia, y la configuración de
  salud de conexiones (`connHealth?: boolean`, `connHealthRedAt?: number`, default 80 vía
  `clampConnRedAt`).
- `NodeLink` (en `SeverityNode.tsx`): `{ title, url }`. El helper `nodeLinks(data)` devuelve los links
  VIGENTES saneados (`safeHref`, título de respaldo = la URL) y **migra al vuelo** el campo legado
  `url` de nodos viejos como primer link; al guardar, el editor escribe `links` y deja `url` en
  `undefined` (migración definitiva). Con 1 link el título del nodo es un `<a>` directo; con 2+ es un
  botón que abre el popup de títulos (cierre al clic por fuera con listener `mousedown` en captura).
- `EntityRef` (en `entityModel.ts`): `{ id, type, name?, sid? }`, `name` es el nombre "congelado" al
  atar; el vivo se resuelve aparte; `sid` es el id del modelo nuevo de Smartscape cuando difiere.
- Contrato de estado DQL: primera fila, campo numérico `0 | 1 | 2` (ver `nodeStatus.tsx`).
- Contrato de valor DQL (chip de las conexiones): un solo número; `value` o primer campo numérico de la
  primera fila, y si es arreglo (`timeseries`) el último punto no nulo. `null` → chip en «—».

## 6. El motor de estado

Tres fuentes, resueltas en `MapCanvas.tsx` al construir `displayNodes`:

1. **Entidad Smartscape** (nodo con `entity` y `statusSource === "davis"`, el valor persistido no
   cambió): `useDavisStatus` corre **una** consulta
   batcheada sobre `dt.davis.problems` (ACTIVE, últimas 2 h, `expand affected_entity_ids`, ranking
   AVAILABILITY/ERROR→2, resto→1), refresco 90 s, pausada si la pestaña no es visible.
2. **DQL** (nodo/conexión con consulta propia): cada DQL corre tal cual (su timeframe manda) y se convierte
   a severidad por el contrato 0/1/2.
3. **Herencia** (conexiones con `inheritStatus`): copia la severidad del nodo origen, cero consultas.
4. **Sub-mapa** (nodos de un Mapa Padre, fuente de estado «Mapa»): `useSubmapStatus` evalúa el mapa
   incrustado y el color sale de las reglas de color, no del contrato 0/1/2 directo (ver abajo).

**Regla anti-falso-verde (`useIsReady`)**: hasta que la primera respuesta llegue para el set de ids
vigente, la severidad es «desconocida» (gris), nunca se asume 0 ni se marca una entidad como retirada
sin datos. Si tocas `useDavisStatus`/`useEntityMetadata`, **conserva ese gating**.

### Salud de conexiones (pill + regla de rojo)

Para nodos con `connHealth` activo (solo fuente Davis), `MapCanvas.tsx` calcula por entidad vigilada el
porcentaje de vecinos reales de Smartscape (`calls` ∪ `calledBy`, de `useEntityRelations`) **sin**
problemas Davis activos (`connInfoByEntity`). La salud de esos vecinos va en una **segunda** llamada a
`useDavisStatus(connNeighborIds)`, separada de la principal a propósito: un nodo con cientos de
conexiones no debe arriesgar (por tamaño o fallo de la consulta) el estado del resto del mapa.

- Si `pct ≤ connHealthRedAt` → el nodo pasa a severidad **2 por la REGLA** (en `displayNodes` y también
  en `sevBySource`, para que las conexiones con herencia se coloreen igual).
- La burbuja «?» recibe `connRule` (prop de `WhyModal`) cuando la regla disparó: muestra la tarjeta
  determinista con las cifras y **no ejecuta ninguna consulta ni llama a la IA** en ese caso.
- Transitorios `connPct/connBad/connTotal/connRule` solo en `displayNodes` (no se persisten);
  `relations.byEntity` arranca con listas vacías antes de cargar, así que «N.A.» (sin conexiones) solo
  se decide cuando `relations.isLoading` es falso. `isLoading` incluye el estado "habilitada sin datos ni
  error" (cierra el render entre pasos en que nada cargaba y salía «N.A.» un instante).
- `useEntityRelations` expone `hasError`: si alguna de sus 3 consultas falla, el pill muestra «…» con
  `connErr` (tooltip `connhealth.errorTitle`), NUNCA «N.A.» — antes el error se tragaba en silencio y
  salía «N.A.» falso hasta el siguiente refresco. Las 3 consultas van con `maxResultRecords: 5000`
  (`useDql({ query, maxResultRecords })`): con el tope por defecto de la API (1000) las aristas de
  mapas grandes se truncaban y algunas entidades quedaban sin vecinos.
- El pill es clickeable: abre la entidad aislada en Smartscape con `openEntity` (mismo deep-link de §7).

### Nodos sub-mapa (Mapa Padre)

Un **Mapa Padre** tiene las mismas capacidades de un Mapa de Servicio y además incrusta Mapas de
Servicio como nodos. El sub-mapa se agrega arrastrando el mapa desde el sidebar al lienzo o desde el
editor del nodo (fuente de estado «Mapa», selector `MapPicker.tsx`).

- `submapDocs.ts` cachea los documentos hijos y valida la jerarquía: un mapa se incrusta **una sola
  vez**, un Mapa Padre **no** puede incrustar otro Mapa Padre (máximo dos niveles) y un Mapa de
  Servicio no acepta sub-mapas.
- `useSubmapStatus.ts` calcula la métrica del mapa hijo (**% de nodos sanos**, por defecto, o
  **cantidad de nodos afectados**) y la expone en la pastilla del nodo. El nombre del nodo es un enlace
  (`mapLink.ts`) que abre el mapa hijo en pestaña nueva. Sin acceso al documento hijo, el nodo lo
  indica en vez de derivar un estado.
- `submapRules.ts` evalúa las **reglas de color** (hasta 3 filas: color de severidad + operador +
  valor, editadas en `ColorRules.tsx`) en orden, gana la primera que se cumple; sin regla aplicable el
  nodo queda neutro. Defaults: verde = 100, amarillo ≥ 50, rojo < 50.
- **Cadencia** configurable en Ajustes: 10 min (default), 5 min o Manual, con «Actualizado hace X» y
  botón de actualizar siempre disponible en la barra. Los DQL de los mapas incrustados corren con esa
  cadencia, así que la cadencia gobierna su costo de Grail (leyenda de consumo).

## 7. Integración con Smartscape (topología)

Toda la topología usa el storage de Smartscape (`smartscapeNodes` / `smartscapeEdges`). El clásico
`fetch dt.entity.<tipo>` está deprecado (Dynatrace emite `DEPRECATED_ENTITY_DATAOBJECT`) y **no se
usa en ningún archivo**, no introducirlo.

Sintaxis verificada en vivo contra el tenant (no asumida):

```dql
// Búsqueda por tipo (el argumento es el MISMO prefijo del id de la entidad):
smartscapeNodes "HOST"
| filter contains(lower(name), "web")
| fields id, name | sort name asc | limit 25

// Lookup multi-id, id es de tipo smartscape_id: comparar con string crudo SIEMPRE da falso.
// `in { … }` con toSmartscapeId NO parsea (PARSE_ERROR). El patrón correcto es OR encadenado:
smartscapeNodes "*"
| filter id == toSmartscapeId("HOST-XXX") or id == toSmartscapeId("SERVICE-YYY")
| fields id, name

// Relaciones (cubre CUALQUIER tipo de entidad, no solo servicios):
smartscapeEdges "*"
| filter source_id == toSmartscapeId("HOST-XXX") or target_id == toSmartscapeId("HOST-XXX")
| filter type == "calls"
| filter source_id != target_id
| fields source_id, target_id
```

- Los 11 tipos soportados y el mapeo prefijo↔tipo viven en `entityModel.ts` (`PREFIX_TO_TYPE` y su
  inverso derivado, **una sola lista**, no duplicar). Ojo: el tipo de base de datos es
  `dt.entity.relational_database_service` (`dt.entity.database_service` **no existe** como tabla).
- Ojo con los tipos del modelo de Smartscape que agrupan varios clásicos (`FRONTEND` = `APPLICATION` +
  `MOBILE_APPLICATION`): el catálogo filtra SIEMPRE por `startsWith(id_classic, "<PREFIJO>-")`, en
  los dos caminos, para que las categorías del selector no se mezclen.
- Todas estas consultas **no consumen Grail** (0 bytes escaneados), se pueden refrescar sin miedo al costo.
- Deep-link a una entidad aislada en Smartscape: ver `entityIntentLink` en `entityModel.ts`. El formato
  (vista `all-topology`, id en la **ruta** y en `isolate=` del hash) fue copiado del botón nativo
  «Isolate», los 3 intentos anteriores que NO funcionan están documentados en el comentario del
  código; no los repitas.

## 8. IA: Davis CoPilot y Dynatrace Assist

Las tres IAs **conviven** (oct-2026, pedido del cliente: harán un cambio progresivo y luego decidirán si
retiran Assist o CoPilot): **Davis CoPilot** en la burbuja, botones de **Dynatrace Assist** y **análisis de
causa raíz**.

| `copilotOff` | Qué muestra la burbuja |
|---|---|
| sin valor (default, todos los mapas) | Estado + problemas + análisis de **Davis CoPilot** + «Investigar a fondo» + botones de **Assist** + «Analizar causa raíz del mapa». |
| `true` (alguien lo apagó en Ajustes) | Igual, sin la tarjeta de Davis CoPilot ni «Investigar a fondo». |

### Davis CoPilot (dentro de la app)

`copilotExplain.ts` arma el prompt con la **evidencia real** (problemas Davis activos o filas crudas
del DQL + el contrato de estado) y pide una explicación corta. Principio de diseño: **la IA solo habla
cuando hay evidencia**; sin evidencia, la UI lo dice honestamente y ofrece «Investigar a fondo»
(nl2dql). Actualización oct-2026: el tenant ya tiene la acción de workflow **«Prompt Agentic AI»**
(Dynatrace Intelligence, Preview), invocable desde la app ejecutando un workflow con
`@dynatrace-sdk/client-automation`. Integrarla es la feature planeada de **análisis de causa raíz por
workflow** (pendiente); hasta entonces, DQL determinista + CoPilot solo para redactar.

### Dynatrace Assist (fuera de la app, modo agéntico)

`assistIntent.ts` → `openAssistWithPrompt(prompt)`: **copia la pregunta al portapapeles** y abre
`{getEnvironmentUrl()}/ui/apps/dynatrace.davis.copilot` en ventana nueva; el App Shell levanta el
**panel lateral** de Assist con una conversación nueva donde el toggle **Agentic** sí queda activable,
y el usuario pega (Cmd+V), lo activa y envía. Devuelve si la copia funcionó (sin permiso de
portapapeles la ventana se abre igual y se avisa al usuario).

- **Por qué así y no con Intent** (probado en vivo, está en el comentario del archivo, no lo repitas):
  con el intent `ask-question` + `execute: true` la conversación nace por la vía clásica y Agentic
  queda bloqueado («isn't available for older conversations»); sin `execute` el prompt llega
  pre-cargado pero el toggle sale deshabilitado igual. **No existe deep-link oficial al panel**; solo
  una conversación iniciada como la inicia el usuario puede ser agéntica.
- **El prompt** sale de `why.assistPrompt` (i18n, 4 idiomas) o de `settings.assistPrompt` del mapa si
  el usuario lo personalizó (el personalizado manda sobre el idioma). Variables: `{problems}`,
  `{name}`, `{entity}`, `{state}`. Cada problema de la lista tiene además su botón ✨ que usa
  `why.assistProblemPrompt` para preguntar **solo por ese problema**.

### Cómo encuentra los problemas relacionados (nodos con DQL propio)

La consulta de «problemas activos detectados» (`buildActiveProblemsQuery`) combina DOS caminos con OR:

1. **Ids de entidad**: `collectEntityIds` regex-escanea el TEXTO del DQL (comentarios incluidos, a
   propósito: hay usuarios que dependen de un id en una línea comentada) y los valores de las filas.
   Filtra por `in(affected_entity_ids, {…})`.
2. **Condiciones del DQL**: `collectTagConditions` extrae del DQL **sin comentarios** (`stripDqlComments`,
   escáner con estado que respeta strings) los filtros `matchesValue`/`matchesPhrase`/`in` sobre
   `entity_tags`, `event.name`, `event.category`, `event.description` y `k8s.namespace.name`, más las
   igualdades `==` sobre esos mismos campos (salvo `entity_tags`, que es un arreglo), y los reusa
   respetando el conector real de cada etapa del pipeline:
   dentro de una misma etapa `| filter`, si las condiciones van unidas con `or` se conservan en OR
   (con lógica mixta and/or también se usa OR, para no dejar problemas por fuera); etapas distintas
   van en AND entre sí (tope 8 grupos). Así un DQL que cuenta
   problemas por tag, por nombre o por categoría (caso típico: custom devices Iseries etiquetados)
   obtiene en la burbuja exactamente la misma población que su `status` está contando, sin necesidad
   de ids quemados. La consulta de problemas ordena con los que afectan varias entidades primero
   (`arraySize(affected_entity_ids)` descendente) y dentro de cada grupo por inicio del problema.

Las condiciones de tag se reconstruyen de partes validadas por regex (el grupo `(?:[^"\\]|\\.)*`
garantiza que no hay comillas sin escapar) antes de embeberse, misma disciplina anti-inyección que los
ids con `ENTITY_EXACT`.

### Análisis de causa raíz por workflow (v0.7.0)

La app **no** llama a la IA directo: ejecuta un **workflow** del tenant y lee su resultado.

```
Botón «Causa raíz» (editores y analistas, Mapas de Servicio y Mapas Padre, nodos en amarillo/rojo;
                   el analista guarda el resultado con saveAnalysis, ver §5)
  → rootCause.collectMapProblems: event.id por nodo, activos o cerrados hace ≤ RC_CLOSED_WINDOW_MIN (15)
       (permisos del usuario; el filtro ACTIVE del DQL del nodo se amplía solo aquí)
  → workflowsClient.runWorkflow({ id: RC_WORKFLOW_ID, body: { input } })
       contexto (JS)  → detalle de problemas, eventos, topología Smartscape; horas en hora de Colombia;
                        IPs/correos enmascarados (si no, la IA rechaza: SENSITIVE_CONTENT_REFUSED_ERROR)
       progreso_items/progreso → comentario «⏳ en curso» (Annotate & Link)
       analisis       → dynatrace.davis.workflow.actions:prompt-agentic-ai (JSON con outputFormat)
       resultado (JS) → valida ids (anti-alucinación), confianza CALCULADA (6 señales), fallas de la IA
       comentar/anotar → comentarios finales en la app Problems (mismo annotationId = actualiza)
  → executionsClient.getTaskExecutionResult("resultado") → settings.rootCause (se guarda en el mapa)
```

- **Comentarios:** la app Problems nueva guarda comentarios como eventos `CUSTOM_ANNOTATION` en Grail. Se
  escriben con la acción oficial `dynatrace.davis.problems:annotate-and-link`
  (`problemId`, `annotationId`, `annotationSource`, `eventName`, `eventDescription` en markdown). Los de la
  API clásica (`/api/v2/problems/{id}/comments`) **solo** se ven en Problems Classic.
- **Confianza calculada** (`resultado.js`): por relación causa → efecto, señales `topologia`, `orden`,
  `raizDavis`, `eventos`, `entorno`, `conexionMapa`; ≥4 alta, 2–3 media, ≤1 baja; causa que empieza
  >5 min después del efecto → baja. La de la IA (`confianza`) queda como dato secundario.
- **Priorización:** si el mapa tiene más de 60 problemas, `rootCause.ts` los ordena (severidad → categoría
  → nodos del mapa → entidades afectadas → antigüedad), manda los 60 primeros y su orden en `input.prioridad`;
  `contexto.js` recorta desde el final de ese orden si se pasa de tamaño. La leyenda avisa «N de M».
- **Estado vivo:** `MapCanvas` consulta cada 2 min el `event.status` de los problemas del análisis guardado
  (`rcProblemIds` + `dedup event.id`); `rcMarksByNode(a, closed)` separa causas activas (número rojo),
  resueltas (✓ verde, `rcResolved`) y omite efectos cerrados. La leyenda pone las resueltas al final y avisa
  nodos en rojo que no estaban en el análisis (`rcNewRed`).
- **Orden único (más grave primero)** en la leyenda (numeración de causas), en los efectos de cada causa y
  en la lista de la burbuja: severidad (sin severidad = SEV-3) → categoría (AVAILABILITY, ERROR, SLOWDOWN,
  RESOURCE_CONTENTION, resto) → nodos del mapa → entidades afectadas → antigüedad (`cmpPrio` en
  `rootCause.ts`; `sort mapa_sev, mapa_cat, mapa_afectadas, event.start` en `copilotExplain.ts`).
- **Burbuja:** muestra el papel de cada problema según `settings.rootCause` y ofrece «Analizar causa raíz
  del mapa». El botón «Analizar con Dynatrace Assist» y el ✨ por problema se retiraron en 0.7.0 y se
  **restauraron en 0.7.1** porque el cliente los usa a diario: TODAS las funciones de IA previas (Assist,
  Davis CoPilot, «Investigar a fondo») conviven con la causa raíz. No retirar ninguna sin pedirlo el usuario.
- **Patrones tomados de los workflows oficiales** («SRE Agent»): veredicto en una frase, recomendaciones,
  comentario de progreso que se reemplaza, detección del tope de 20 herramientas y de respuesta vacía.

## 9. i18n

- `i18n.tsx` contiene todas las claves en **4 idiomas (es/en/fr/de)**. Regla dura: **ningún texto
  visible hardcodeado en componentes**, siempre `t("clave")`, y toda clave nueva se agrega en los 4
  idiomas a la vez.
- El idioma se guarda en `localStorage` con clave propia de esta app.

## 10. Workflow de cambios y deploy

1. Editar → `npm run lint && npm run build` y `node --no-warnings --test tests/` (todo verde antes de
   cualquier deploy).
2. Probar contra el tenant real con `npm start` (no hay mocks, la app siempre habla con Dynatrace).
3. **Bump de versión** en `app.config.json` (semver; la versión se muestra en «Acerca de»).
4. `npm run deploy` → abre SSO en el navegador si la sesión OAuth expiró (los tokens del CLI caducan
   ~10 días sin uso; el detalle de errores queda en `.dt-app/logs/<fecha>_log.txt`).
5. Commit en git con mensaje descriptivo (la historia del repo documenta *por qué* se hizo cada cosa,
   mantener esa disciplina).
6. Si cambiaron **scopes**: avisar a los usuarios que deben re-autorizar.

### Instalar en otro tenant sin CLI (ZIP)

`npx dt-app deploy --dry-run` construye el paquete instalable **sin desplegar** y lo deja en
`out/artifact.zip`. Ese ZIP se sube directo en **Manage apps → Upload app** del tenant destino (no
necesita el código fuente ni el CLI allá; el usuario consiente los scopes al abrirla). Los mapas no
viajan con la app (son documentos por tenant), usar Exportar/Importar JSON para mover un mapa.

### Paso a producción del análisis de causa raíz (hecho el 20-oct-2026, v0.7.0)
- Workflow de prod: **«Mapas de Servicios V2 - Causa raíz»** `22a757f2-fdae-4a59-8dcb-78bad4b98d94`
  (staging: `aa1df053-2598-473f-968c-79bc0fe32b0f`). Ids en `workflow/build-workflow.py` (`IDS`) y en
  `RC_WORKFLOW_ID` de `ui/app/components/rootCause.ts`.
- Actualizar el workflow: editar las fuentes de `workflow/` → `python3 build-workflow.py prod` →
  `dtctl apply -f causa-raiz.prod.workflow.json --context my-env` (lleva el id: actualiza, no duplica).
- Dueño actual: usuario (temporal). **Pendiente:** transferirlo al grupo que defina el cliente.
- Usuarios del mapa: IAM `automation:workflows:run` y `automation:workflows:read`. Dueño del workflow:
  Dynatrace Intelligence, lectura de Grail/Smartscape y escritura de eventos (comentarios).
- La burbuja conserva el análisis con **Davis CoPilot** (ajuste «Análisis con IA en la burbuja»): convive
  con el análisis de causa raíz, igual que los botones de Dynatrace Assist (restaurados en 0.7.1).

### Rol Analista: despliegue y rollback (28-oct-2026, v0.9.0 → v0.9.1)
- Se publicó en dos pasos: v0.9.0 con `ANALYST_ROLE_ENABLED = false` (código nuevo, opción oculta) y v0.9.1
  con la opción encendida. La protección del analista no depende del interruptor.
- Rollback en `rollback/` (procedimiento en `rollback/README.md`): **nivel 1** `apagar-analista.sh <versión>`
  (vuelve a ocultar la opción) y **nivel 2** `volver-v087.sh <versión>` (código de la v0.8.7 con una versión
  mayor que la instalada). Antes del nivel 2 hay que pasar a Solo lectura a los analistas: la v0.8.7 no lee
  las labels y los vería como editores (`listar-analistas.js` los encuentra). Los dos scripts se ensayan con
  `--probar` sin publicar.

## 11. Gotchas, léelos antes de tocar código

1. **`smartscape_id` no compara con strings**: siempre `toSmartscapeId("…")`; un `==` contra string
   crudo evalúa falso silenciosamente (sin error). Y `in { … }` con valores computados no parsea.
2. **`encodeURIComponent` NO escapa `(` `)`**: los deep-links con `now()` en el hash deben llevar
   `now%28%29` escrito a mano, o Dynatrace interpreta mal el fragmento (bug real: el link a Smartscape
   caía siempre al mapa general).
3. **`<NodeToolbar>` fuera del componente del nodo** (p. ej. renderizado desde `MapCanvas`) necesita el
   prop `nodeId` explícito; sin él, falla silenciosamente (no se ancla ni se ve).
4. **Anti-falso-verde**: cualquier consumidor de `useDavisStatus`/`useEntityMetadata` debe respetar
   `isReady` antes de tratar «sin fila» como ok/retirado.
5. **DQL de usuario corre con su timeframe tal cual**, no hay timeframe global que lo recorte. Los DQL
   de nodo son la única fuente de costo de Grail controlada por el usuario.
6. **Interpolar valores en DQL solo con `dqlQuote`** (escapa comillas y backslash), nunca template
   string directo.
7. **`cleanSnapshot` es spread, no whitelist**: campos nuevos persisten solos… incluidos los que NO
   quieres persistir. Estado calculado va solo en `displayNodes`.
8. **Aislamiento vs V1**: `DOC_TYPE`, prefijo de `localStorage` y `LANG_KEY` son distintos de la app de
   producción a propósito. No los unifiques.
9. **Íconos con nombres peligrosos**: hubo un crash real por un ícono llamado `constructor`
   (colisión con `Object.prototype`), el catálogo ya lo maneja; cuidado con lookups `obj[nombre]`.
10. **Perf del lienzo**: el glow es un `::after` animado por GPU (opacity/scale), NO `box-shadow`
    animado; los puertos en abanico de las conexiones usan una firma de layout memoizada (`layoutSig`).
    Cambios de render en nodos/conexiones se sienten con 50+ nodos, medir antes y después.
11. **Documentación externa de DQL**: varias sintaxis "documentadas" resultaron falsas en la práctica.
    Ante la duda, **verificar la consulta en un Notebook contra el tenant real** antes de
    implementarla.
12. **El listado del Document service no devuelve `description`**: por eso el tipo de mapa se espeja en
    el `type` del documento (`<DOC_TYPE>.parent`) y tanto la lista como la papelera consultan **los dos
    types**. Si agregas un tipo de mapa, agrégalo también en esas dos consultas.
13. **La app corre en iframe sandbox**: enlaces externos necesitan URL absoluta
    (`getEnvironmentUrl()`), no rutas relativas, y `window.open(..., "noopener,noreferrer")`.
14. **Dynatrace Assist agéntico solo por portapapeles + ventana nueva**: los Intents no llegan al modo
    Agentic y no hay deep-link oficial al panel (ver §8 y el comentario de `assistIntent.ts`). Y el
    `navigator.clipboard` puede fallar por permisos: la ventana debe abrirse igual, con aviso.
15. **CoPilot en la burbuja: `copilotOff`, NO `aiInsights`.** Hasta v0.8.0 era opt-in con `aiInsights`
    (default `false`), y como los ajustes se guardan completos, muchos mapas tienen `aiInsights: false`
    guardado sin que nadie lo apagara. Por eso en v0.8.1 se cambió de campo: CoPilot queda **encendido**
    salvo `copilotOff: true`, y `aiInsights` ya no se lee. Los botones de Assist no dependen de ninguno.
16. **El viewport se guarda por mapa** (`…:viewport:<mapId>` en `localStorage`) y el id se toma **en el
    evento** de paneo, no al escribir; si tocas esa zona, cuida que un paneo con debounce pendiente no
    quede atribuido al mapa siguiente.
17. **"group" es un tipo de nodo INTEGRADO de React Flow** con estilos propios (`.react-flow__node-group`:
    150px de ancho, padding, borde y fondo) que hay que anular en CSS, y los subflujos exigen que el nodo
    padre vaya ANTES que sus hijos en el arreglo (`orderNodesForFlow`) con la `position` de los hijos
    RELATIVA al marco. No usar `extent: "parent"` en los miembros: confina el arrastre en el borde y
    rompe el gesto del umbral para sacarlos (la hidratación lo limpia si aparece). Y no anular
    `pointer-events` del contenedor del marco: desconecta el drag del nodo y el arrastre panea el lienzo.
18. **El `data` de las conexiones se persiste por LISTA BLANCA** (`cleanSnapshot` en `useMapPersistence.ts`):
    todo campo nuevo de una raya (como los `value*` del chip) hay que añadirlo ahí o se pierde al recargar.
    Los nodos, en cambio, persisten su `data` completo. Y en el editor de raya el bloque desplegable usa
    el truco `grid-template-rows: 0fr → 1fr` con el envoltorio siempre montado (si se monta junto con el
    contenido no hay transición).
19. **El contexto del selector de entidades (`ctx`) no debe llegar al nodo.** `EntityPicker.pick` lo
    quita antes de emitir el `EntityRef`; si se añaden más campos "solo para mostrar" al catálogo,
    quitarlos ahí también. Los lookups de contexto van **antes** del filtro (para poder buscar por
    namespace/workload/PG/id) y solo para `dt.entity.service`; verificado en vivo sobre ~3.500
    servicios: ~2 s, 0 bytes de Grail. Un tope NUNCA resuelve homónimos (hay nombres con 299
    servicios iguales): la solución es la búsqueda por contexto, el tope 200 es solo el techo de la
    lista. En el filtro usar `id_classic` (string), no `id` (smartscape id: `lower()` se queja).
20. **Problemas de Davis: excluir SIEMPRE los duplicados** (`isNull(dt.davis.is_duplicate) or
    dt.davis.is_duplicate == false`; no `not(...)`, porque en DQL un null en el filtro descarta la
    fila). Davis abre problemas individuales y luego los fusiona en uno; los individuales quedan vivos
    un rato marcados como duplicados (verificado: sus eventos están dentro del principal). Aplica a la
    lista de la burbuja, al color de nodos Davis (`useDavisStatus`) y al DQL semilla del chip. Y la
    extracción de condiciones del DQL del nodo (`collectTagConditions`) lee **solo etapas `filter`**:
    leer `fieldsAdd status = if(event.category == …)` la convertía en filtro y la lista traía el top
    del tenant.

21. **Causa raíz: comentarios = Annotate & Link, no la API clásica.** Mismo `annotationId`
    (`mapas-v2-<mapId>-<problemId>`) en progreso y resultado, o se duplican. El texto va en markdown.
    **Autor:** Problems muestra como autor (`annotation.user_id`) al **actor del workflow**, nunca a quien
    oprimió el botón (un workflow no puede correr como el usuario que lo lanza). Por eso la app manda
    `requestedBy` (`getCurrentUserDetails().name`) y `progreso.js`/`comentar.js` lo ponen en la primera
    línea («👤 Solicitado por: … · fecha») y en `annotationSource` (`Mapas de Servicios V2 · <mapa> · <nombre>`).
    Ojo: quien edite el workflow pasa a ser su actor, salvo que el actor sea un service user.
22. **La IA del workflow rechaza datos con IPs y falla con URLs** (filtro de seguridad): `contexto.js`
    enmascara IPv4/IPv6, hostnames `ip-a-b-c-d`, correos y **URLs completas** antes de enviar, con
    `[ip]`, `[correo]` y `[url]` (NO `<ip>`: el markdown de Problems lo toma como etiqueta HTML y lo borra;
    así salía «Netty on :*»). `contexto.js` devuelve aparte `nombresReales` (nombre de nodo enmascarado →
    real; NO va a la IA) y `resultado.js`/`comentar.js` restauran los nombres reales en el análisis y los
    comentarios. NO desenmascarar `0:0:0:0:0:0:0:0` para la IA: la acción rechaza la entrada.
    Las URLs se agregaron el 21-oct: en el mapa *IM - Canal_Negocios* (monitores sintéticos con endpoints
    internos `https://gw-…bancolombia.corp/…`) la acción agéntica fallaba en segundos con «technical
    error»; el workflow igual sale SUCCESS, la tarea `analisis` devuelve `{}` y la app muestra «La IA no
    devolvió respuesta». El error real solo se ve en `dtctl logs wfe <id> --task analisis`. Probado: 10
    problemas con URLs → falla; los mismos sin URLs → 5 causas; los 60 → 26 causas en 3 min 22 s.
23. **Horas: convertir ANTES de la IA.** Si recibe UTC, a veces las etiqueta como hora Colombia sin
    convertir. `contexto.js` (`enCol`) y `resultado.js` (`toCol`) lo resuelven.
24. **El SDK de consultas entrega los campos `timestamp` como `Date`** (la API cruda los manda como texto):
    aceptar ambos (`iso()` en `rootCause.ts`).
25. **Causa raíz en Mapa Padre (v0.8.0): ids compuestos `«nodo sub-mapa»::«nodo del hijo»`** (`RC_SUB`,
    `rcSubId`/`rcSplitId`/`rcLocalId` en `rootCause.ts`). `runRootCause` (MapCanvas) arma los nodos de cada
    hijo con `loadMapDoc` (misma caché que el color del sub-mapa; un nivel, sin sub-mapas anidados) y los
    nombra «Hijo › nodo». El análisis guarda `nodeNames` (nombres de los nodos de hijos) y `submaps`
    (nodo sub-mapa → `mapId`). `rcMarksByNode` pinta los ids compuestos sobre el nodo sub-mapa. «Ir al
    nodo» de un id compuesto abre el hijo con `rcVisit` (marcas de paso con `rcChildView`, aviso
    `.mapa-rc-visit`, «← Volver»), y el viaje pendiente espera a que `nodes` sea el del mapa nuevo
    (`rcPendingRef`). El workflow acepta ids de hasta 160 caracteres (`contexto.js`) y manda primero los
    nodos con problemas (tope de 300 nodos).
26. **Población de problemas de un nodo DQL (`nodeProblemsPopulation`, `copilotExplain.ts`): cortar SOLO en
    etapas que cambian filas** (`summarize`, `append`, `makeTimeseries`). Las proyecciones (`fields`,
    `fieldsKeep`, `fieldsRemove`) se SALTAN (alias calculados `fields x = …` → `fieldsAdd`). Hasta v0.8.1
    también se cortaba en `fields`, y los DQL del equipo que hacen `| fields …` ANTES del filtro real
    perdían el filtro: el nodo se quedaba con todos los problemas activos del ambiente (21-oct, *IM -
    Canal_Negocios*: Rabbit MQ y DynamoDB con 243 problemas en vez de 0; el análisis salió con 21 causas
    para un mapa con 1 problema real). Afecta la burbuja y el análisis de causa raíz.
27. **Marcas de causa raíz compactas (v0.8.3):** `rcCompact` en `SeverityNode.tsx` muestra máximo
    `RC_MAX_NS` (3) números y «+N» (`.sev-rc-more`); la lista completa va en el `title`. `.sev-rc` es
    `inline-flex` (con `grid` el «+N» se apilaba debajo).
28. **Causa raíz: también problemas CERRADOS recientes (v0.8.4).** `RC_CLOSED_WINDOW_MIN = 15` en
    `rootCause.ts` (empezó en 60; el cliente pidió 15). Tres puntos que deben ir juntos: (1) la consulta de
    nodos con entidad usa `RC_WINDOW_FILTER` (`ACTIVE` o `CLOSED` con `event.end` dentro de la ventana);
    (2) los nodos DQL pasan por `widenActiveFilter` (`copilotExplain.ts`), que amplía `event.status ==
    "ACTIVE"` y `event.status != "CLOSED"` SOLO para el análisis —la burbuja sigue con activos—; (3) un
    post-filtro uniforme por `event.status`/`event.end` del detalle, para que un DQL sin filtro de estado no
    meta cerrados viejos. Los activos van primero en `cmpPrio`. Efectos cerrados: `rcMarksByNode` devuelve
    `effectsResolved` → `rcEffectsResolved` → «✓ Efecto de N» verde (`.sev-rcfx-ok`). Caso real: P-261052380
    duró 4 min (9:01–9:05) y el primer análisis fue a las 9:06, así que nunca entraba. El workflow ya
    aceptaba cerrados (busca por id en 24 h); el prompt dice «cerrados hace pocos minutos» sin número.
29. **Estado vivo del análisis (v0.8.5): consultar DESDE la hora del análisis, no «últimas 24 h».** Antes,
    `rcStatusDql` usaba `from: now()-24h`: pasado un día ya no encontraba los registros de cierre (en
    `dt.davis.problems` queda el último registro de cada problema, con la hora del cierre) y las marcas volvían
    a rojo (reporte del 26-oct, *IM - Mi Bancolombia*). Ahora `from` = `analysis.at` − 30 min (cubre los
    cerrados que entraron por `RC_CLOSED_WINDOW_MIN`). Como un problema cerrado no se reabre: (a) cuando todos
    los del análisis están cerrados se deja de consultar (`rcPollStop`) y el `executionId` se recuerda en
    `localStorage` (`<prefijo>:rcResolved`, derivado de `VIEWPORT_KEY`, máx. 200) para no volver a consultar
    al abrir; (b) análisis de más de 24 h → cada 15 min, reciente → cada 2 min. Costo medido: ~150 MB por día
    de antigüedad del análisis por consulta (la versión anterior: ~170 MB cada 2 min con el mapa abierto).
    Limpieza: `rcAllResolved` (todos los ids cerrados) → `rcMarksByNode(undefined)` = nodos sin marcas y la
    leyenda muestra `rca.cleared`; «Limpiar» (`rcClear`, editores, no en visita a hijo) pone
    `settings.rootCause = undefined` (entra al historial: ↶ lo devuelve).
30. **Validación ESTRICTA del contenido (v0.8.6, `mapValidation.ts`): ni se repara ni se tolera.** Decisión
    del usuario: un mapa exportado desde la app debe funcionar; uno armado por fuera que no cumpla el formato
    NO sirve y punto (no se quiere incentivar mapas hechos con scripts). `validateMapContent` revisa nodos
    (solo `severity|label|group|image`, ids únicos, posición finita, `data` objeto, `parentId` a un grupo
    existente, tipos de los campos de `data` que la app lee), conexiones (ids únicos, origen/destino
    existentes) y ajustes (`brandIconStyle` color|mono, `rootCause` ausente o análisis con `causes`/
    `unclassified`/`at`, etc.). Importar: si falla → modal «El contenido del mapa no es válido» + UNA línea
    de motivo (`invalidMapText.ts`), sin diagnóstico. Abrir: `fetchSnapshot` devuelve un snapshot vacío con
    `invalid` → `applyActive` lo deja en solo lectura (NUNCA se re-escribe el doc), `hasMap` = false y el
    lienzo muestra el aviso; la lista sigue usable y el ⋮ permite mandarlo a la papelera. Se retiró
    `salvageSnapshot`. Caso real (28-oct): JSON generado por script con `settings.rootCause: false` y nodo
    `type: "text"` → `WhyModal` (`rootCause?.causes.length`) tumbaba la app entera. Antes de desplegar se
    validaron los 80 mapas de prod: solo falló ese. Si se agrega un campo/tipo nuevo a la app, agregarlo
    también al validador o los mapas nuevos se verán como inválidos.
31. **Barra superior en pantallas angostas (v0.8.7, `MapCanvas.tsx` + `map.css`).** Los botones no se encogen
    (`flex-shrink: 0`); ceden primero `.mapa-refreshinfo` («Actualizado hace…», con «…») y el nombre del mapa.
    El modo solo-íconos (`compact`) se activa por umbral (`TOOLBAR_COMPACT_BELOW`) **o** por contenido
    (`scrollWidth > clientWidth`), medido en `useLayoutEffect` (sin parpadeo). Para salir de `compact` exige
    el ancho que pedía la barra completa + 16 px (histéresis, sin rebote), y `topbarLayoutKey` (mapa, tipo,
    solo lectura, edición de imagen, vista previa) obliga a re-medir al cambiar de mapa. En `compact` el
    nombre se oculta y la hora de actualización va en el tooltip de «Actualizar».
32. **Labels del Document service (verificado en el tenant el 28-oct-2026).** El listado solo las trae con
    `addFields: "labels"`; `getDocumentMetadata` y `getDocument` las traen siempre (`[]` si no hay). El
    servidor las devuelve **ordenadas** (orden ASCII), así que se comparan como conjunto (`sameLabels`).
    Labels repetidas → 400. **Toda escritura sube la versión aunque las labels no cambien**: por eso
    `withAnalyst` devuelve las mismas labels si la membresía no cambia (no re-empaca) y `setAnalystLabel` no
    escribe si `sameLabels`. `restoreSnapshot` revierte contenido y nombre, pero **no** las labels. El SDK
    envía las labels unidas por comas: una label con coma se partiría (los ids SSO no tienen).
33. **Errores del Document service:** `e.status` no existe; el código viene en `e.response.status` (409
    conflicto de versión, 403 sin permiso, 400 validación). `httpStatus` de `analystRole.ts` lo lee así.
34. **Re-compartir:** los mapas tienen `isReshareable: true` (verificado en prod), así que quien tiene
    Edición puede compartir con cualquier rol. El analista también tiene escritura por debajo; la app le
    deshabilita Compartir y bloquea el modal (`locked`), pero la protección es de la app, no de la plataforma.

## 12. Troubleshooting

| Síntoma | Causa probable | Arreglo |
|---|---|---|
| `NOT_AUTHORIZED_FOR_TABLE` en consultas de Smartscape | Falta `storage:smartscape:read` o el usuario no re-autorizó tras un cambio de scopes | Verificar scope en `app.config.json`; pedir re-autorización |
| `load "/lookups/…"` falla con permisos aunque el scope está | Falta la **política IAM** del usuario (2.ª capa) | Que un admin asigne la política IAM de files |
| `npm run deploy` se queda colgado | Sesión OAuth del CLI expirada, espera login SSO en el navegador | Completar el SSO; revisar `.dt-app/logs/` |
| Burbuja «¿Por qué?» no explica nada | «Análisis con IA en la burbuja» apagado en ese mapa, IA generativa deshabilitada en el tenant, o scopes `davis-copilot:*` sin re-autorizar | Encender el ajuste en Ajustes → General; habilitar gen-AI / re-autorizar |
| «Analizar con Dynatrace Assist» no aparece | Versión anterior a 0.8.0 en caché (antes se ocultaba con CoPilot encendido) | Recargar la página |
| La pregunta no llega copiada al Assist | El navegador negó el permiso de portapapeles | La ventana se abre igual: la app lo avisa y el usuario escribe la pregunta a mano |
| Nodo atado siempre gris | Primera respuesta aún no llega, pestaña en background (queries pausadas), o la entidad no existe | Esperar/foco a la pestaña; verificar la entidad en Smartscape |
| El selector no encuentra una entidad que existe | Tipo equivocado en el selector, o el nombre no contiene el término | Cambiar tipo / término |
| Link «abrir en Smartscape» cae al mapa general | Se rompió el formato del deep-link (ver gotcha #2 y comentario en `entityModel.ts`) | Restaurar formato `all-topology` + `now%28%29` |
| Mapa borrado por accidente |, | Papelera (30 días) o historial de versiones |
| Analista: «El análisis quedó solo en tu pantalla…» | `saveAnalysis` no pudo guardar: cambió su rol, el mapa no es válido, superó el tamaño, 3 conflictos seguidos o perdió el permiso (el motivo sale en el mensaje) | Según el motivo: recargar, revisar el acceso en Compartir o volver a correr el análisis |
| «Este mapa ya tiene el máximo de 50 analistas» | Tope de 25 labels por documento (2 analistas por label) | Pasar a alguien a Solo lectura o a Edición |

## 13. Appendix · Contexto para agentes de IA

Para que una IA haga cambios sin redescubrir el proyecto:

- **Dónde tocar según el cambio**:
  - Feature visual del lienzo / toolbar / wiring de datos → `MapCanvas.tsx` (buscar por sección: es un
    archivo grande pero organizado por bloques con comentarios).
  - Aspecto/comportamiento del nodo → `SeverityNode.tsx` (+ `map.css`).
  - Nueva fuente de datos de entidad → hooks `useEntity*` / `useDavisStatus.ts`; el modelo en
    `entityModel.ts`.
  - Persistir un campo nuevo → agregarlo al `data` del nodo/conexión y listo (spread); si es calculado, a
    `displayNodes`, no al doc.
  - Texto nuevo → `i18n.tsx`, 4 idiomas, siempre.
  - Burbuja «¿Por qué?», Assist o el ajuste de IA → `WhyModal.tsx` + `assistIntent.ts` +
    `SettingsModal.tsx`/`mapSettings.tsx` (las 3 IAs conviven: no ocultar ninguna sin pedido
    explícito del usuario).
- **Convenciones**: comentarios del código en español (explican *por qué*, incluyendo callejones sin
  salida ya probados, leerlos antes de "simplificar"); textos por `t()`; valores a DQL por
  `dqlQuote`; colores por variables CSS de `map.css`; semver + comentario por scope en
  `app.config.json`.
- **Verificación mínima de cualquier cambio**: `npm run lint && npm run build` verdes; si tocó
  consultas, validar el DQL en un Notebook del tenant real antes de codificarlo; si tocó persistencia,
  probar cambio-de-mapa rápido (guardas anti-cruce) e import/export.
- **Cosas que NO hacer**: reintroducir `fetch dt.entity.*` clásico; quitar el gating `isReady`;
  animar `box-shadow`; unificar claves de storage con la V1; confiar en sintaxis DQL no verificada;
  usar Intents del SDK para abrir entidades (abre un diálogo nativo «Abrir con», ya se probó).
- **Relación con V1**: esta app nació como clon de la V1 de producción (`my.mapaservicios`) + los
  módulos de entidad/Davis/topología. Comparten casi toda la base; los diffs propios de V2 son
  `entityModel.ts`, `useEntity*`, `useDavisStatus.ts`, `EntityPicker.tsx`, `RelatedPopover.tsx`,
  `TopologyModal.tsx` y su wiring en `MapCanvas.tsx`/`NodeEditorModal.tsx`/`WhyModal.tsx`.
