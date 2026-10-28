# Mapas de Servicios V2 — Arquitectura y prácticas

Documento de arquitectura de **Mapas de Servicios V2** (`my.mapaservicios.v2`), una app nativa de
**Dynatrace AppEngine** para modelar mapas de servicios curados con estado vivo. Describe el stack
técnico, las decisiones de diseño, el modelo de escalabilidad y las prácticas con las que se
desarrolla y mantiene. Versión de referencia: **0.9.1** (28 de octubre de 2026; rol Analista al compartir; barra superior con prioridad a los botones; validación estricta del contenido de los mapas; las 3 IAs —CoPilot, Assist y causa raíz— encendidas en todos los mapas, causa raíz también en Mapas Padre, con los problemas cerrados en los últimos 15 minutos y limpieza del mapa cuando todo se resuelve).

---

## 📑 Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Arquitectura en una hoja](#2-arquitectura-en-una-hoja)
3. [Stack técnico](#3-stack-técnico)
4. [Decisiones de arquitectura y su porqué](#4-decisiones-de-arquitectura-y-su-porqué)
5. [Escalabilidad](#5-escalabilidad)
6. [Gobierno del consumo (Grail)](#6-gobierno-del-consumo-grail)
7. [Mantenibilidad](#7-mantenibilidad)
8. [Seguridad](#8-seguridad)
9. [Límites conocidos y mitigaciones](#9-límites-conocidos-y-mitigaciones)
10. [Operación: deploy, versiones y rollback](#10-operación-deploy-versiones-y-rollback)
11. [Appendix · Contexto para agentes de IA](#appendix--contexto-para-agentes-de-ia)

---

## 1. Resumen ejecutivo

| Dato | Valor |
|---|---|
| Tipo de app | 100% Dynatrace AppEngine (frontend puro, sin backend propio ni app functions) |
| Código | ~12.400 líneas TypeScript/TSX en ~30 módulos |
| UI | React 18 + Strato Design System + @xyflow/react (lienzo de grafos) |
| Persistencia | Document service de Dynatrace (1 documento JSON por mapa) |
| Estado vivo | Grail (DQL) y problemas de Davis, con contrato único 0/1/2 |
| Topología | Smartscape (modelo nuevo: `smartscapeNodes` / `smartscapeEdges`) |
| IA | Davis CoPilot (nl2dql y conversaciones), puente a Dynatrace Assist en modo agéntico y análisis de causa raíz por workflow, los tres disponibles en todos los mapas; siempre bajo demanda y con evidencia real |
| Idiomas | Español, inglés, francés, alemán |
| Ciclo de vida | App espejo de staging aislada, luego pase a producción con patch exacto, git + GitHub |

La app corre entera dentro de la plataforma Dynatrace: no hay servidores propios, ni base de datos
externa, ni llamadas a servicios de terceros. Todo lo que consume (datos, persistencia, identidad,
IA) son servicios de la plataforma vía los SDK oficiales. De esa decisión se derivan la mayoría de
las propiedades de escalabilidad y seguridad que se describen más adelante.

## 2. Arquitectura en una hoja

```
┌────────────────────────────────────────────────────────────────────┐
│  Navegador (iframe sandbox de AppEngine)                           │
│                                                                    │
│  React 18 + Strato ─── @xyflow/react (lienzo del mapa)             │
│        │                                                           │
│        │  @dynatrace-sdk/react-hooks + client SDKs                 │
│        ▼                                                           │
├────────────────────────────────────────────────────────────────────┤
│  Plataforma Dynatrace (tenant)                                     │
│                                                                    │
│  Grail (DQL) ── estado por DQL propio, evidencia de problemas,     │
│    │            consumo real (dt.system.events)                    │
│  Smartscape ── catálogo de entidades, relaciones calls/calledBy    │
│    │            (sin costo de Grail)                               │
│  Davis ─────── problemas activos por entidad (dt.davis.problems)   │
│  Document ──── mapas (1 doc c/u), snapshots nativos, papelera,     │
│    │            direct-shares (compartir read / read-write)        │
│  IAM ───────── resolución de usuarios/grupos para compartir        │
│  CoPilot ───── explicación en lenguaje natural (bajo demanda)      │
│  Assist ────── análisis agéntico, en su propio panel del tenant    │
└────────────────────────────────────────────────────────────────────┘
```

Un mapa es un documento JSON (nodos + conexiones + ajustes). El **estado** (verde/amarillo/rojo)
nunca se persiste: se **deriva en render** a partir de las consultas vivas. Eso garantiza que lo
que se ve siempre refleja el dato actual y elimina toda una clase de bugs de sincronización.

## 3. Stack técnico

La app parte del scaffolding oficial del **Dynatrace App Toolkit** (`dt-app`) y se construye sobre
las piezas estándar del ecosistema; el código propio es la lógica de dominio (mapas, estado,
evidencia), no infraestructura.

| Capa | Tecnología | Versión |
|---|---|---|
| Lenguaje | TypeScript (modo estricto) | 5.9 |
| UI | React + React Router | 18.3 / 6.22 |
| Design system | Strato (`strato-components`, `-preview`, `-design-tokens`, `-icons`), el mismo de las apps nativas de la plataforma | 3.3 |
| Lienzo de grafos | `@xyflow/react` (React Flow), la librería de referencia para editores de nodos en React | 12.11 |
| SDKs de plataforma | `@dynatrace-sdk/react-hooks`, `client-query`, `client-document`, `client-davis-copilot`, `app-environment`, `navigation`, `user-preferences` | actuales |
| Toolchain | `dt-app` (dev server con hot reload, build, deploy, type-checker del manifiesto) | 1.10.2 |
| Calidad | ESLint 9 (typescript-eslint, react-hooks, y plugins de seguridad: `@microsoft/eslint-plugin-sdl`, `security`, `no-secrets`, `no-unsanitized`) | 9.37 |
| Íconos de marcas | `simple-icons` (solo data, sin red) | 16 |

### Qué resuelve cada capacidad (y qué no se construyó a mano)

| Capacidad | Resuelta por | Código propio |
|---|---|---|
| Autenticación y sesión | AppEngine (la app hereda la identidad del usuario) | Ninguno |
| Autorización sobre datos | Scopes del manifiesto + IAM del usuario | Ninguno |
| Persistencia de mapas | Document service | Capa fina de carga/guardado (`useMapPersistence`) |
| Historial de versiones | Snapshots nativos del Document service | UI del historial |
| Papelera / restaurar | Papelera nativa del Document service (30 días) | UI |
| Compartir con permisos | Direct-shares del Document service (read / read-write) | UI + resolución de destinatarios vía IAM |
| Consulta de datos | Grail vía `useDql` / `client-query` | Los DQL de dominio |
| Inventario y topología | Smartscape (`smartscapeNodes` / `smartscapeEdges`) | Mapeo de tipos y catálogo |
| Detección de problemas | Davis (`dt.davis.problems`) | Contrato 0/1/2 y batcheo |
| Medición de consumo | `dt.system.events` de la plataforma | La leyenda que lo muestra |
| Explicación en lenguaje natural | Davis CoPilot (SDK oficial) | El motor de evidencia previo |
| Análisis agéntico de causa raíz | Dynatrace Assist (app del tenant, modo Agentic) | El armado de la pregunta con el contexto del nodo |
| Render del grafo | React Flow (drag, zoom, viewport, selección) | Nodos/conexiones custom y ruteo |
| Componentes de UI | Strato (modales, tablas, forms, tabs, toolbars) | Composición |

En resumen: versionado, permisos, identidad, almacenamiento, detección de anomalías y generación
con IA vienen de la plataforma; el lienzo viene de React Flow; la app aporta el modelo de dominio
y la experiencia de usuario encima de eso.

## 4. Decisiones de arquitectura y su porqué

1. **Frontend puro, sin backend propio.** No hay app functions ni servicios externos. Menos
   superficie de ataque, menos partes que operar, y el modelo de permisos queda 100% en manos de
   la plataforma (scopes + IAM del usuario que usa la app).
2. **Un documento por mapa** (Document service). Aísla el blast radius (un mapa corrupto no toca
   los demás), habilita compartir por documento con permisos read/read-write, y da versionado e
   historial usando los **snapshots nativos** del servicio (sin reinventar versionado).
3. **Contrato de estado único 0/1/2.** Toda fuente de estado (DQL propio, Davis por entidad, regla
   de salud de conexiones) converge al mismo contrato: `0 = ok`, `1 = advertencia`, `2 = error`.
   El render solo conoce ese contrato; agregar una fuente nueva no toca el render.
4. **Dos fuentes de estado por nodo, a elección.** Nodos "atados" a una entidad real usan problemas
   de Davis (cero DQL que mantener); nodos avanzados usan un DQL propio del usuario. La app corre
   ese DQL tal cual, sin reescrituras, para que lo que el usuario valida en un notebook sea
   exactamente lo que corre en el mapa.
5. **Modelo nuevo de Smartscape** (`smartscapeNodes` / `smartscapeEdges`) para catálogo y
   topología, con el campo `id_classic` como puente hacia los ids clásicos que usan Davis y los
   mapas guardados. Consultas de inventario y relaciones sin costo de Grail.
6. **La severidad se deriva, nunca se guarda.** El documento persiste configuración (qué vigilar);
   el estado sale de las consultas en vivo. Sin estados "pegados" ni migraciones de estado.
7. **IA con evidencia primero.** La burbuja de explicación ("¿por qué está así?")
   arma primero evidencia determinista (problemas activos de Davis relacionados por id de entidad o
   por filtros del propio DQL sobre `entity_tags`, `event.name` y `event.category`) y la muestra tal
   cual, con los problemas que afectan varias entidades de primeros: estado del nodo y lista
   completa de problemas con enlace a Dynatrace. El análisis con IA dentro de la burbuja está
   **encendido en todos los mapas** (se puede apagar por mapa); Davis CoPilot solo redacta cuando hay
   evidencia real y solo al abrir la burbuja. Nunca corre IA en segundo plano.
8. **Jerarquía de mapas de dos niveles.** Hay dos tipos de mapa: **Mapa de
   Servicio** y **Mapa Padre**; el Padre incrusta Mapas de Servicio como nodos sub-mapa (un mapa una
   sola vez, sin Padre dentro de Padre). El tope de dos niveles es deliberado: acota el fan-out de
   consultas y mantiene la agregación entendible. El tipo canónico (`mapType`) vive en el contenido
   del documento y se **espeja en el `type` del documento** porque el listado del Document service no
   devuelve la descripción, así el sidebar y la papelera distinguen el tipo sin abrir cada documento.
   El tipo se elige al crear; un Mapa de Servicio puede además **convertirse en Mapa Padre** desde el
   menú del mapa, previa confirmación. La conversión es de **un solo sentido** y ocurre sobre el mismo
   documento (conserva id, URL, permisos e historial); al cargar un mapa, el `type` del documento
   manda sobre el contenido, de modo que restaurar una versión anterior del historial no revierte el
   tipo.
9. **Color del sub-mapa por reglas declarativas.** El nodo sub-mapa no hereda un contrato 0/1/2 del
   hijo: se colorea con hasta 3 reglas (color de severidad + operador + valor) evaluadas en orden
   sobre una métrica configurable (% de nodos sanos o cantidad de nodos afectados). El criterio de
   "cuándo un mapa está mal" lo define el negocio, no la app.
10. **El análisis agéntico se delega a Dynatrace Assist, no se reimplementa.** La app arma la pregunta
    con el contexto del nodo (problemas activos, entidad afectada, estado), la deja en el portapapeles
    y abre el panel de Assist del propio tenant, donde el usuario la pega y activa el modo Agentic.
    La app no orquesta agentes ni guarda conversaciones: aporta el contexto y entrega el caso a la
    herramienta de la plataforma que ya lo hace bien. La plantilla de esa pregunta es **editable por
    mapa** (variables `{problems}`, `{name}`, `{entity}`, `{state}`), así cada equipo la adapta a su
    forma de investigar sin tocar código.
11. **Las herramientas de IA conviven.** Davis CoPilot en la burbuja (opcional por mapa), los botones de
    Dynatrace Assist (siempre visibles) y el análisis de causa raíz del mapa están disponibles a la vez.
    Antes Assist se ocultaba con CoPilot encendido («un solo analista por modo»), pero los equipos lo
    usan a diario y no lo encontraban; cada respuesta indica de qué herramienta salió.

### Análisis de causa raíz (v0.7.0; Mapas Padre desde v0.8.0; cerrados recientes desde v0.8.4)
- **Estado vivo y limpieza:** el estado de los problemas del análisis se revisa desde la hora del análisis;
  cuando todos están cerrados, el mapa queda sin marcas y se deja de consultar (un problema cerrado no se
  reabre; el navegador lo recuerda para no repetir la consulta). Los editores pueden borrar el análisis con
  «Limpiar».
- **Ventana de cerrados:** además de los problemas activos, el análisis toma los cerrados en los últimos
  15 minutos (activos primero). Un problema corto que se cierra justo antes de analizar puede ser la causa
  o el efecto de otro que sigue activo; la burbuja y el color de los nodos siguen mostrando solo activos.
- **Mapas Padre:** el análisis incluye los nodos de cada mapa hijo (un nivel), reutilizando los
  documentos que el padre ya descarga para el color de sus sub-mapas. Las marcas se pintan en el nodo
  sub-mapa y «Ir al nodo» abre el hijo con las marcas del análisis solo durante la visita.
- **Decisión:** la IA corre en un **workflow** del tenant (acción oficial *Prompt agentic AI* de Dynatrace
  Intelligence), no en el navegador. La app solo recolecta los problemas con los permisos del usuario,
  ejecuta el workflow y guarda el resultado en el mapa.
- **Confiabilidad:** la confianza que se muestra es **calculada con evidencia verificable** (6 señales),
  no la que se pone la IA; los ids que devuelve la IA se validan contra el contexto (anti-alucinación).
- **Consumo:** cada análisis = 1 ejecución de workflow + 1 consulta a la IA agéntica + consultas DQL
  pequeñas (`dt.davis.problems`, `dt.davis.events`, Smartscape). Solo corre cuando un editor o un
  analista lo pide.
- **Seguridad:** IPs y correos se enmascaran antes de la IA; el workflow corre con su actor (grupo del
  cliente); los comentarios en los problemas los ve cualquiera que abra el problema.

### Rol Analista (v0.9.0)
- **Necesidad:** operadores que revisan errores sin modificar el mapa, que corren la causa raíz y cuyo
  análisis ven todos (para no repetirlo). El rol lo asigna quien comparte (dueño o editor), sin
  administración de IAM.
- **Diseño:** el analista recibe el share `read-write` y una **label** del documento (`an:<sso-id>;<sso-id>`,
  dos personas por label). La app resuelve el rol al abrir el mapa (`access` + `owner` + `labels`) y trata al
  analista como lector: lo único que escribe es `settings.rootCause`, con bloqueo optimista (relee, confirma el
  rol, parcha, valida y reintenta ante conflicto), así nunca pisa cambios de un editor.
- **Por qué labels:** no crean documentos adicionales; viven en la metadata, así que no las alteran el autosave
  del contenido, deshacer, duplicar, descargar ni restaurar una versión (verificado en el tenant); y el listado
  las trae sin consultas extra.
- **Por persona:** la app resuelve el rol por persona; las APIs de IAM disponibles para la app buscan usuarios y
  grupos, sin listar membresías.
- **Calidad:** el núcleo (`analystRole.ts`) es código puro con 341 pruebas automáticas (transiciones de rol con
  fallos simulados en cada paso, guardado contra un Document service simulado) y se verificó contra el
  Document service real antes de producción.

## 5. Escalabilidad

### Por número de nodos de un mapa

- **Nodos atados a entidad (Davis):** el número de consultas no crece con los nodos. Todos los
  nodos Davis de un mapa se agrupan en una sola consulta batcheada
  (`in(affected_entity_ids, {…})`) por ciclo de refresco: 5 nodos o 50 nodos = 1 consulta.
- **Salud de conexiones:** los vecinos Smartscape de los nodos que la activan van en una segunda
  consulta batcheada, separada de la principal, de modo que un nodo con muchas conexiones no
  afecta el ciclo de estado del resto del mapa.
- **Conexiones entre nodos:** heredan el estado del nodo origen sin consulta adicional (opción por
  defecto). Solo consultan si el usuario les asigna un DQL propio.
- **Nodos con DQL propio:** cada uno corre su consulta (es el contrato: el DQL del usuario corre
  tal cual). El crecimiento aquí es lineal y gobernado (ver §6 y §9).

### Por número de mapas y usuarios

- Carga perezosa: solo el mapa activo consulta; los demás son documentos en reposo.
- **Mapa Padre:** los DQL de los mapas incrustados corren con una **cadencia configurable** (10 min
  por defecto, 5 min o Manual), no con el ciclo del mapa activo. Es la palanca directa para gobernar
  el costo de agregar varios mapas en un solo tablero, con actualización manual siempre disponible.
- La jerarquía de dos niveles acota el fan-out: un Mapa Padre consulta sus hijos, y ningún hijo abre
  otro nivel de consultas.
- El Document service es multiusuario nativo: compartir es por documento, con detección de
  solo-lectura en la app (los editores de un lector quedan bloqueados de verdad, no solo ocultos).
- Snapshots con cadencia de 3 minutos de inactividad, pensados para no pisar el trabajo de un
  colaborador concurrente.
- La **vista (paneo y zoom) se recuerda por mapa** en el navegador, no en el documento: es preferencia
  local de quien mira, no contenido compartido, y así no genera escrituras ni conflictos entre
  colaboradores. Un mapa sin vista recordada se encuadra solo al abrirlo.

### Por rendimiento de render

- Animaciones de estado (glow) compuestas por **GPU** (`opacity`/`transform` en un pseudoelemento),
  no por propiedades que fuerzan repintado.
- Memoización del layout de conexiones (`layoutSig`) para no recalcular puertos y abanicos en cada
  render.
- El historial de undo/redo **deduplica la imagen de fondo** (referencia por hash en vez de repetir
  el base64 en cada paso): un mapa con imagen no multiplica su peso en memoria por cada edición.
- Pausa automática de todos los ciclos de refresco cuando la pestaña no está visible
  (`pageVisible`): cero consultas de mapas que nadie está mirando.
- El **Agrupador** (marco que reúne nodos) es un subflujo nativo de React Flow: su color es el peor
  estado de sus miembros, **derivado en render** (cero consultas adicionales), y la pertenencia se
  gobierna por un gesto con umbral, no por confinamiento duro (que rompía el arrastre).

## 6. Gobierno del consumo (Grail)

El consumo de datos de la app es visible desde la propia app.

- La app muestra una **leyenda de consumo por hora**: lee `dt.system.events`
  (`QUERY_EXECUTION_EVENT`) por `query_id` y suma `scanned_bytes.on_demand`. Es el dato medido por
  la plataforma para cada consulta de la app, no una estimación.
- Las consultas de Smartscape (catálogo, relaciones) y de metadatos de entidad **no consumen
  Grail** (0 bytes escaneados, verificado).
- Lo que sí consume (DQL propios de los nodos y de las conexiones, evidencia de problemas) está
  acotado por: cadencia de refresco, pausa por visibilidad, herencia de estado en conexiones, y la
  evidencia de la burbuja corre **solo al abrirla**, no en segundo plano.
- El **chip de valor** de una conexión (un segundo DQL que muestra una métrica, p. ej. latencia) viene
  **apagado por defecto**, se deduplica por texto igual que los DQL de estado y entra en la misma
  leyenda de consumo: activarlo es una decisión visible y medida, nunca un costo escondido.
- El análisis con IA en la burbuja corre **solo al abrirla** (encendido por defecto, apagable por mapa), y el
  puente a Dynatrace Assist no ejecuta consultas desde la app: el trabajo pesado ocurre en la herramienta de destino.
- En un **Mapa Padre**, los DQL de los mapas incrustados corren con la cadencia elegida en Ajustes
  (10 min, 5 min o Manual) y su consumo aparece en la misma leyenda.
- Existe además un DQL de reporte (documentado en el README) para calcular el costo por documento
  con la tarifa vigente, consulta por consulta.

## 7. Mantenibilidad

### Código

- TypeScript **estricto** + ESLint 9 con reglas de hooks y 4 plugins de seguridad. `tsc` y lint
  corren antes de cada deploy.
- Módulos por responsabilidad única. Los puntos de extensión están concentrados: agregar un tipo de
  entidad al selector es tocar **una lista** en `entityModel.ts` (el resto se deriva); agregar una
  fuente de estado es producir el contrato 0/1/2.
- Sin estado global improvisado: el estado del mapa vive en el lienzo; lo transversal (biblioteca
  de mapas, idioma) va en contexts puntuales.

### Ciclo de vida de cambios

- **Staging primero:** existe una app espejo (`my.mapaservicios.v2.staging`) aislada por tipo de
  documento, prefijo de `localStorage` y clave de idioma propios. Toda feature se prueba ahí con
  datos reales del tenant antes de tocar producción.
- **Pase a producción por patch exacto:** `git diff` del rango probado en staging (excluyendo la
  identidad de la app), `git apply --check`, bump de versión, `tsc` + lint, deploy. Lo que llega a
  producción es byte a byte lo que se probó.
- **Git + GitHub** (repo privado) con historia completa; cada versión desplegada corresponde a un
  commit. Rollback = volver al commit y redesplegar.
- **Auditorías de estabilidad** periódicas con revisores independientes por subsistema
  (persistencia, render, compartir, DQL); los hallazgos se verifican contra el código antes de
  arreglarse.

### Documentación

Tres documentos en el repo, cada uno con su audiencia: `README.md` (técnico, para quien mantiene),
`GUIA-USUARIO.md` (usuario final) y este `ARQUITECTURA.md` (revisión de arquitectura). Todos con
copia sincronizada en el vault de conocimiento del equipo.

## 8. Seguridad

- **Scopes explícitos y de solo lectura sobre datos:** todos los `storage:*` son `:read`. Los
  únicos permisos de escritura son del Document service (los mapas propios de la app y sus
  compartidos) y la ejecución de CoPilot. IAM solo se lee (`iam:users:read`, `iam:groups:read`)
  para resolver destinatarios al compartir.
- **Anti-inyección DQL en todo insumo del usuario:** valores interpolados pasan por `dqlQuote`
  (escape de comillas y backslash); los ids de entidad se validan contra su patrón exacto antes de
  embeberse; los filtros de tags se extraen con un regex de "string seguro" que garantiza que no
  hay comillas sin escapar, y se reconstruyen de partes validadas (nunca se copia texto libre del
  usuario dentro de una consulta).
- **Sanitización de enlaces:** toda URL de nodo pasa por `safeHref` (esquemas permitidos) antes de
  renderizarse como enlace.
- **Imágenes de fondo:** solo PNG/JPG, tope duro de 5 MB, siempre como data URI local (nunca se
  descarga nada de una URL externa).
- **Sin secretos ni endpoints propios:** no hay tokens en el código (lint `no-secrets` lo vigila),
  no hay llamadas de red fuera de los SDK de la plataforma, y la app hereda el sandbox de iframe de
  AppEngine.
- **Permisos de mapas por la plataforma:** compartir usa direct-shares del Document service con
  cubos read / read-write (personas o grupos). La app **conoce el rol al abrir el mapa** (`access`,
  `owner` y `labels` del documento, en el listado y en la metadata) y aplica un modo de **vista pura**
  para quien solo tiene lectura y para el analista: sin edición, duplicado, descarga, compartir ni
  acceso al DQL de los nodos. Un 403 al guardar sigue siendo la red de seguridad si `access` no viniera.
- **Analista:** la restricción la aplica la app (por debajo tiene escritura para poder guardar el
  análisis). Solo escribe `settings.rootCause`, valida el mapa antes de escribir y usa bloqueo optimista;
  Compartir y toda la edición quedan deshabilitados para él.

## 9. Límites conocidos y mitigaciones

Estado actual de los límites de diseño y cómo se manejan.

| Límite | Detalle | Mitigación actual |
|---|---|---|
| Nodos con DQL propio | N nodos con DQL = N consultas por ciclo | Cadencia + pausa por visibilidad + leyenda de consumo real; el diseño empuja a preferir nodos atados a Davis (1 consulta batcheada) |
| Tamaño del documento | Un mapa con imagen de fondo pesa lo que pese su base64 (tope 5 MB) | Tope duro al subir + dedup en memoria; guardado con debounce |
| Timeframe de los DQL propios | El DQL del usuario corre tal cual, con el timeframe que traiga escrito | Documentado en la guía; la leyenda de consumo lo hace visible |
| Custom devices en el catálogo | El modelo nuevo de Smartscape del tenant aún no expone las custom devices de extensiones | Su estado sí es representable hoy por DQL propio; el binding por catálogo clásico está diseñado como extensión futura |
| Jerarquía de mapas | Máximo dos niveles: un Mapa Padre incrusta Mapas de Servicio, y un mapa se incrusta una sola vez | Restricción de diseño validada al agregar el sub-mapa; acota el fan-out de consultas y mantiene la lectura del tablero |
| Rutas de conexiones en mapas muy densos | La evasión de nodos es heurística (no A*) | Suficiente para mapas curados típicos; A* identificado como mejora si aparece la necesidad |
| Rol Analista | La restricción la aplica la app: por API, un analista podría editar el documento | Decisión consciente para que su análisis lo vean todos; desde la app solo escribe `settings.rootCause`, con validación y bloqueo optimista |
| Analistas por mapa | Máximo 50 (25 labels × 2 personas) y solo personas | Compartir avisa al llegar al tope; para grupos están Solo lectura y Edición |
| Ediciones simultáneas del contenido | Rige «el último que escribe gana»: un editor con el mapa abierto desde antes de un análisis puede reemplazarlo al guardar | El análisis también queda como comentario en Problems y se puede volver a correr |
| Entrada al modo agéntico de Dynatrace Assist | La plataforma no expone un deep-link al panel de Assist ni una vía de API que preserve el modo Agentic | Puente por portapapeles + ventana nueva: la app copia la pregunta con el contexto y abre el panel; el usuario pega, activa Agentic y envía. Si el navegador niega el portapapeles, la ventana se abre igual con el aviso correspondiente |

## 10. Operación: deploy, versiones y rollback

```bash
# Verificar (siempre antes de desplegar)
npx tsc --noEmit -p ui/tsconfig.json && npx eslint ui/app && node --no-warnings --test tests/

# Desplegar (dt-app usa app.config.json: id, versión, scopes)
npm run deploy

# Rollback: volver al commit de la versión anterior y redesplegar
git log --oneline          # cada versión desplegada = un commit
git checkout <commit> -- . && npm run deploy
```

- La versión visible en la app ("Acerca de") sale de `app.config.json`; **cada deploy exige bump**
  (la plataforma rechaza redesplegar el mismo número con otro contenido).
- Apps del ciclo: `my.mapaservicios.v2` (producción) y `my.mapaservicios.v2.staging` (pruebas),
  ambas en el mismo tenant, totalmente aisladas en datos.
- **Rol Analista:** kit de rollback en `rollback/` (procedimiento en `rollback/README.md`). Nivel 1 apaga
  la opción en Compartir (`ANALYST_ROLE_ENABLED`); nivel 2 publica el código de la v0.8.7 con una versión
  nueva, después de pasar a Solo lectura a los analistas (la v0.8.7 no lee las labels). Los dos scripts se
  ensayan con `--probar` sin publicar.

---

## Appendix · Contexto para agentes de IA

Para hacer cambios sin redescubrir el proyecto. Complementa el mapa de archivos completo del
`README.md` (§ mapa de archivos).

### Stack y restricciones

- App AppEngine pura: NO agregar backend, ni fetch a dominios externos, ni dependencias con red.
- Importar Strato SIEMPRE desde el subpath (`@dynatrace/strato-components/layouts`), nunca la raíz.
- Todo texto visible pasa por `i18n.tsx` (4 idiomas, es como fallback).

### Mapa de archivos (los que concentran los cambios)

| Archivo | Qué es |
|---|---|
| `ui/app/components/MapCanvas.tsx` | Orquestador: lienzo, estado derivado, refrescos, undo/redo |
| `ui/app/components/useMapPersistence.ts` | Document service: cargar/guardar/papelera (`DOC_TYPE` aísla staging) |
| `ui/app/components/SeverityNode.tsx` | El nodo: tipos persistidos (`SeverityNodeData`), pill, links, notas |
| `ui/app/components/entityModel.ts` | Tipos de entidad (lista única), prefijos, deep-link a Smartscape |
| `ui/app/components/useDavisStatus.ts` | Consulta batcheada de problemas por entidad |
| `ui/app/components/copilotExplain.ts` | Evidencia de la burbuja: ids + tags del DQL, anti-inyección |
| `ui/app/components/WhyModal.tsx` | Burbuja "¿por qué está así?": estado + problemas activos con scroll + acciones; CoPilot encendido salvo `copilotOff` |
| `ui/app/components/assistIntent.ts` | Puente a Dynatrace Assist: copia la pregunta y abre el panel del tenant (sin scope adicional) |
| `ui/app/components/SettingsModal.tsx` + `mapSettings.tsx` | Ajustes por mapa en 2 pestañas (General / Apariencia); `copilotOff` y `assistPrompt` viven en el documento |
| `ui/app/components/NodeEditorModal.tsx` | Editor de nodo en 2 pestañas (Contenido / Links y aspecto); la salud de conexiones va dentro del bloque de Entidad Smartscape |
| `ui/app/components/useSubmapStatus.ts` | Estado del nodo sub-mapa: métrica del mapa incrustado y ejecución de sus DQL con la cadencia del Padre |
| `ui/app/components/submapDocs.ts` | Caché de documentos hijos + validación de la jerarquía (una vez por mapa, sin Padre dentro de Padre) |
| `ui/app/components/submapRules.ts` + `ColorRules.tsx` | Motor de reglas de color (hasta 3 filas, primera que se cumple) y su editor |
| `ui/app/components/MapPicker.tsx` + `mapLink.ts` | Selector del mapa a incrustar y enlace al mapa hijo |
| `ui/app/components/NewMapModal.tsx` | Modal de creación con el tipo de mapa (fijo al crear) |
| `ui/app/components/analystRole.ts` | Rol Analista, núcleo puro: labels `an:`, regla de rol, plan de cambios de rol, guardado del análisis con bloqueo optimista, interruptor `ANALYST_ROLE_ENABLED` |
| `ui/app/components/useMapShare.ts` + `ShareModal.tsx` | Compartir con 3 roles (Solo lectura / Analista / Edición) y la ℹ️ de los roles |
| `tests/` | 341 pruebas del núcleo del rol Analista (`node --no-warnings --test tests/`) |
| `rollback/` | Kit de rollback del rol Analista (nivel 1 y 2, listado de analistas) |
| `ui/app/i18n.tsx` | Diccionarios es/en/fr/de |

### Gotchas verificados (no redescubrir)

- El modelo nuevo de Smartscape **renombró tipos e ids**: `PROCESS_GROUP_INSTANCE→PROCESS`,
  `APPLICATION→FRONTEND`, `KUBERNETES_CLUSTER→K8S_CLUSTER` (sufijo hex distinto). El puente es el
  campo `id_classic`. `FRONTEND` agrupa DOS tipos clásicos (apps web y móviles): el catálogo filtra
  SIEMPRE por `startsWith(id_classic, "<PREFIJO>-")`.
- En el modelo nuevo de Smartscape, `process_group` no es un nodo: se deriva de los PROCESS con `summarize` (y
  `summarize` exige al menos una agregación).
- Deep-link a una entidad aislada: vista `all-topology` con `isolate=<id>`; `from`/`to` van
  codificados a mano (`now%28%29`) porque `encodeURIComponent` no escapa paréntesis.
- El listado del Document service **no devuelve `description`**: por eso el tipo de mapa (`mapType`)
  se espeja en el `type` del documento (`<DOC_TYPE>.parent`) y el sidebar y la papelera consultan los
  dos types.
- Al Assist agéntico **no se llega por Intent**: con `execute: true` la conversación nace por la vía
  clásica y el toggle Agentic queda bloqueado, y sin `execute` sale deshabilitado igual. Solo una
  conversación abierta como la abre el usuario puede ser agéntica; de ahí el portapapeles + ventana
  nueva (el detalle completo está en el comentario de `assistIntent.ts`).
- El id canónico persistido es SIEMPRE el clásico (es el que entienden Davis y los mapas viejos);
  el id nuevo va aparte como `sid`.
- Labels del Document service: el listado solo las trae con `addFields: "labels"`; el servidor las devuelve
  ordenadas (se comparan como conjunto); repetidas → 400; toda escritura sube la versión aunque no cambien
  (por eso no se escriben si son las mismas); `restoreSnapshot` no las revierte. Los errores traen el código
  en `e.response.status` (no en `e.status`).
- Los mapas tienen `isReshareable: true`: quien tiene Edición puede compartir con cualquier rol.
- Staging se aísla por `DOC_TYPE`, prefijo de `localStorage` y `LANG_KEY` (`mapa-v2-staging*`); su
  git NO tiene remoto (nunca hacer push desde staging).
- Flujo de cambio: editar en staging → `tsc` + lint → deploy staging → prueba del usuario → patch
  exacto a producción (`git diff <último-portado>..HEAD -- . ':(exclude)app.config.json'`) → bump
  → deploy → commit + push.
