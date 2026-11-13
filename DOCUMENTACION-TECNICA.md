# Mapas de Servicios V2 — Documentación técnica

App de Dynatrace AppEngine (`my.mapaservicios.v2`, v0.9.2) para mapas curados de servicios con estado
en vivo. Este documento es para el equipo que va a **mantener y evolucionar** la app: cómo está hecha,
dónde está cada cosa y qué consideraciones no son obvias. La guía funcional está en
[GUIA-USUARIO.md](GUIA-USUARIO.md) y la implementación en un tenant nuevo, en [README.md](README.md).

---

## Índice

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
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Stack y arquitectura en una hoja

- **Plataforma**: Dynatrace AppEngine (app custom, corre en iframe sandbox dentro del tenant).
  Tenant: el de `environmentUrl` en `app.config.json`.
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
  true`; el viejo `aiInsights` ya no se lee) y `assistPrompt?: string` (plantilla personalizada del prompt de Assist;
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

Las tres IAs **conviven**: **Davis CoPilot** en la burbuja, botones de **Dynatrace Assist** y **análisis de
causa raíz**.

| `copilotOff` | Qué muestra la burbuja |
|---|---|
| sin valor (default, todos los mapas) | Estado + problemas + análisis de **Davis CoPilot** + «Investigar a fondo» + botones de **Assist** + «Analizar causa raíz del mapa». |
| `true` (alguien lo apagó en Ajustes) | Igual, sin la tarjeta de Davis CoPilot ni «Investigar a fondo». |

### Davis CoPilot (dentro de la app)

`copilotExplain.ts` arma el prompt con la **evidencia real** (problemas Davis activos o filas crudas
del DQL + el contrato de estado) y pide una explicación corta. Principio de diseño: **la IA solo habla
cuando hay evidencia**; sin evidencia, la UI lo dice honestamente y ofrece «Investigar a fondo»
(nl2dql). El análisis de causa raíz del mapa usa aparte la acción de workflow **«Prompt Agentic AI»**
(Dynatrace Intelligence), ejecutada desde la app con `@dynatrace-sdk/client-automation` (ver
[Análisis de causa raíz por workflow](#análisis-de-causa-raíz-por-workflow-v070)).

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
  del mapa». El botón «Analizar con Dynatrace Assist», el ✨ por problema, Davis CoPilot e «Investigar a fondo»
  conviven con la causa raíz.
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
5. Commit en git con un mensaje descriptivo.
6. Si cambiaron **scopes**: avisar a los usuarios que deben re-autorizar.

### Instalar en otro tenant sin CLI (ZIP)

`npx dt-app deploy --dry-run` construye el paquete instalable **sin desplegar** y lo deja en
`out/artifact.zip`. Ese ZIP se sube directo en **Manage apps → Upload app** del tenant destino (no
necesita el código fuente ni el CLI allá; el usuario consiente los scopes al abrirla). Los mapas no
viajan con la app (son documentos por tenant), usar Exportar/Importar JSON para mover un mapa.

### Workflow de causa raíz
- El botón «Causa raíz» ejecuta el workflow cuyo id está en `RC_WORKFLOW_ID`
  (`ui/app/components/rootCause.ts`). Mientras diga `PENDIENTE-…`, el botón avisa que el workflow no está
  configurado. Cómo crearlo: [README.md](README.md), paso 5.
- Actualizar el workflow: editar las fuentes de `workflow/` → `python3 workflow/build-workflow.py prod --id <id>`
  → `dtctl apply -f workflow/causa-raiz.prod.workflow.json --context <contexto>` (con el id actualiza, no duplica).
- Dueño y actor recomendados: un grupo como dueño y un usuario de servicio como actor. Los comentarios en
  los problemas salen a nombre del actor.
- Usuarios del mapa: IAM `automation:workflows:run` y `automation:workflows:read`. Actor del workflow:
  Dynatrace Intelligence, lectura de Grail/Smartscape y escritura de eventos (comentarios).
- La burbuja conserva el análisis con **Davis CoPilot** (ajuste «Análisis con IA en la burbuja»): convive
  con el análisis de causa raíz, igual que los botones de Dynatrace Assist (restaurados en 0.7.1).

### Rol Analista: interruptor
- `ANALYST_ROLE_ENABLED` (`analystRole.ts`) muestra u oculta la opción «Analista» en Compartir. La protección
  del analista no depende del interruptor.
- Antes de publicar una versión que no tenga el rol, pasar a Solo lectura a los analistas: sin el rol, la app
  no lee las labels y los trataría como editores.

## 11. Troubleshooting

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
| Link «abrir en Smartscape» cae al mapa general | Se rompió el formato del deep-link (ver el comentario en `entityModel.ts`) | Restaurar formato `all-topology` + `now%28%29` |
| Mapa borrado por accidente |, | Papelera (30 días) o historial de versiones |
| Analista: «El análisis quedó solo en tu pantalla…» | `saveAnalysis` no pudo guardar: cambió su rol, el mapa no es válido, superó el tamaño, 3 conflictos seguidos o perdió el permiso (el motivo sale en el mensaje) | Según el motivo: recargar, revisar el acceso en Compartir o volver a correr el análisis |
| «Este mapa ya tiene el máximo de 50 analistas» | Tope de 25 labels por documento (2 analistas por label) | Pasar a alguien a Solo lectura o a Edición |
