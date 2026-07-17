# Mapas de Servicios V2 — Guía de usuario
App de Dynatrace (`my.mapaservicios.v2`) para dibujar **mapas curados de servicios**: diagramas de la
arquitectura *como el negocio la entiende*, donde cada nodo y cada conexión se ilumina en vivo según el
estado real del ambiente.   
Esta guía asume que ya conoces Dynatrace (Smartscape, Davis, DQL, Notebooks).

---

## 📑 Índice
1. [¿Para qué sirve esta app?](#1-para-qué-sirve-esta-app)
2. [Conceptos en 1 minuto](#2-conceptos-en-1-minuto)
3. [Gestión de mapas](#3-gestión-de-mapas)
4. [Nodos: crear y editar](#4-nodos-crear-y-editar)
5. [El estado de un nodo: Entidad Smartscape vs DQL](#5-el-estado-de-un-nodo-entidad-smartscape-vs-dql)
6. [Conexiones y su estado](#6-conexiones-entre-nodos-y-su-estado)
7. [Topología real: Entidades Relacionadas y Sugerir conexiones](#7-topología-real-entidades-relacionadas-y-sugerir-conexiones)
8. [La burbuja «¿Por qué está así?»](#8-la-burbuja-por-qué-está-así)
   - [Análisis de causa raíz del mapa](#análisis-de-causa-raíz-del-mapa-)
9. [Compartir, URLs e historial de versiones](#9-compartir-urls-e-historial-de-versiones)
10. [Ajustes, apariencia e idiomas](#10-ajustes-apariencia-e-idiomas)
11. [Consumo de Grail (costo)](#11-consumo-de-grail-costo)
12. [Escenarios de uso completos](#12-escenarios-de-uso-completos)
13. [Preguntas frecuentes](#13-preguntas-frecuentes)

---

## 1. ¿Para qué sirve esta app?
Smartscape muestra **toda** la topología descubierta automáticamente de forma inmutable
para el usuario. Esta app resuelve el caso contrario: un mapa **dibujado a mano, a la medida del negocio** (por ejemplo, el flujo de un canal, una cadena de pagos, la arquitectura de un dominio), donde:
- Cada nodo representa lo que TÚ decidas (un servicio, un host, una base de datos, un tercero, un
  concepto de negocio) con el ícono y el nombre que el negocio reconoce.
- El **color de cada nodo es estado real en vivo**: verde (ok), amarillo (advertencia), rojo (error) 
  derivado de los problemas activos de Davis o de una consulta DQL propia.
- Las conexiones también pueden tener estado propio o heredar el del nodo de origen.
- El mapa se mantiene **alineado con la topología real** de Smartscape sin volverse automático: la app
  te sugiere qué conexiones faltan o sobran, y tú decides.
En corto: **un tablero de guerra curado, con datos de Dynatrace  detrás de cada figura.**
## 2. Conceptos en 1 minuto
| Concepto                 | Qué es                                                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mapa**                 | Un lienzo con nodos y conexiones. Puedes tener muchos; cada uno se guarda solo (autoguardado).                                                                   |
| **Nodo de estado**       | Figura con ícono + título que se colorea por su estado (0 ok · 1 advertencia · 2 error).                                                                         |
| **Nodo de texto**        | Bloque de texto Markdown libre (títulos, listas, negritas) para anotar el lienzo.                                                                                |
| **Entidad Smartscape**   | Un nodo puede "atarse" a una entidad real de Dynatrace (servicio, host, etc.). Con eso su estado lo llevan los problemas de Davis automáticamente y se habilita toda la topología. |
| **Conexión**             | Línea direccional entre dos nodos. Puede tener DQL propio, heredar el estado del origen, o no tener estado.                                                      |
| **Modo edición / vista** | El candado de la toolbar alterna entre editar y solo visualización.                                                                                              |
| **Mapa Padre**           | Tipo de mapa que, además de nodos y conexiones, incrusta Mapas de Servicio como nodos (ver §3).                                                                  |
| **Nodo sub-mapa**        | Nodo que representa un Mapa de Servicio incrustado dentro de un Mapa Padre, con su porcentaje de salud.                                                          |
## 3. Gestión de mapas
- **Barra lateral**: lista de mapas. Crear (`+`), renombrar, **duplicar**, borrar.
- **Borrar = papelera**: los mapas borrados van a la papelera de Dynatrace por **30 días** y se pueden
  restaurar desde el modal de papelera.
- **Autoguardado**: cada cambio se guarda solo (con un pequeño retraso para agrupar ediciones). El
  ícono de nube de la toolbar confirma el estado del guardado.
- **Deshacer / rehacer**: botones en la toolbar (o los atajos usuales), con historial por mapa.
- **Vista recordada por mapa**: el navegador recuerda el paneo y el zoom de **cada** mapa, así que
  vuelves justo donde lo dejaste. Un mapa que abres sin vista recordada se encuadra solo para mostrar
  todo su contenido.
- **Exportar / importar**: cada mapa se puede exportar a JSON y volverse a importar (respaldo manual o
  para moverlo entre ambientes). El JSON conserva el tipo de mapa. **Solo se importan mapas descargados
  desde la app**: si el archivo no tiene el formato de la app (por ejemplo, uno armado por fuera), no se
  importa y sale el aviso **«El contenido del mapa no es válido»** con el motivo. Si un mapa guardado no
  tiene el formato, no se abre: en su lugar sale ese mismo aviso y se puede enviar a la papelera desde
  el menú ⋮ de la lista.

### Tipos de mapa 🗺️
Al crear un mapa, un modal pregunta de qué tipo es:
- **Mapa de Servicio**: el mapa normal, con nodos y conexiones.
- **Mapa Padre**: tiene todo lo de un Mapa de Servicio y además puede incrustar Mapas de Servicio como
  nodos.
El tipo se elige al crear. En la barra lateral cada mapa lleva el ícono de su tipo,
y el del Mapa Padre va con color de acento para distinguirlo a simple vista.

Un Mapa de Servicio se puede **convertir en Mapa Padre** después de creado: la opción **«Convertir en
Mapa Padre»** está en el menú ⋮ del mapa (tanto en la barra de título como en la barra lateral). La
conversión es **en un solo sentido y no se puede deshacer** (tampoco restaurando una versión anterior
del historial); el mapa conserva su URL, sus permisos compartidos y su historial de versiones. Si el
mapa estaba incrustado como sub-mapa en otro Mapa Padre, ese nodo deja de funcionar (un Mapa Padre no
se puede incrustar).

### Mapa Padre: mapas dentro de un mapa 👨‍👦
Un Mapa Padre reúne varios Mapas de Servicio en un solo lienzo usando **nodos sub-mapa**:
- **Agregar un sub-mapa**: arrastra el mapa desde la barra lateral hasta el lienzo, o abre el editor de
  un nodo y elige la fuente de estado **«Mapa»**.
- **Reglas de la jerarquía**: un mismo mapa se incrusta una sola vez; un Mapa Padre no puede incrustar
  otro Mapa Padre (la jerarquía es de máximo dos niveles); un Mapa de Servicio no acepta sub-mapas.
- **Qué muestra el nodo**: una **pastilla con el porcentaje** de salud del mapa incrustado, y el nombre
  del nodo como enlace que abre ese mapa en una pestaña nueva. Si no tienes acceso al mapa incrustado,
  el nodo lo indica en vez de mostrar un estado inventado.

#### Reglas de color del nodo sub-mapa 🎨
El color del nodo sub-mapa lo definen **reglas de color** (hasta 3 filas), cada una con color de
severidad + operador + valor. Se evalúan en orden y gana la primera que se cumple; si ninguna aplica,
el nodo queda neutro.
- La métrica es configurable: **«% de nodos sanos»** (por defecto) o **«cantidad de nodos afectados»**.
- Valores por defecto: verde = 100, amarillo ≥ 50, rojo < 50.

#### Actualización del Mapa Padre ⏱️
La cadencia se configura en **Ajustes**: cada **10 minutos** (por defecto), cada **5 minutos** o
**Manual**. La barra muestra «Actualizado hace X» y el botón de actualizar está siempre disponible.
Los DQL de los mapas incrustados se ejecutan con esa cadencia, así que la cadencia también define su
consumo de Grail (ver §11).
## 4. Nodos: crear y editar
**Crear**: botón `+` de la toolbar → elige el tipo:
- **Nodo de estado** (el normal): ícono + título + estado.
- **Cuadrado**: variante de forma para agrupar visualmente.
- **Texto**: bloque Markdown editable en el lienzo (estilo Notebooks). Al seleccionarlo, la barra trae
  **A−** / **A+** para agrandar o achicar TODO el bloque (50 % a 300 %, de a 25 %) sin tocar el Markdown:
  un `# Título` al 200 % sirve de rótulo grande de sección. El tamaño se guarda por bloque.
- **Imagen**: sube una imagen (≤ 5 MB) como figura o como **fondo del mapa**.
- **Agrupador**: un marco contenedor para reunir nodos (ver abajo).

### El Agrupador: nodos dentro de un marco 🗃️
Un **Agrupador** es un marco que contiene nodos de estado y se colorea con el **peor estado de sus
miembros** (borde y fondo suaves; sin miembros queda neutro). No ejecuta ninguna consulta propia: el
color sale de los estados que el mapa ya calcula.
- **Meter un nodo**: arrástralo adentro del marco. Mientras lo llevas encima, el marco completo se
  resalta para indicar que lo va a recibir; al soltarlo, el marco destella y acomoda sus miembros en
  una cuadrícula (creciendo si le hace falta).
- **Sacar un nodo**: arrástralo hacia afuera. Hay un **umbral**: si lo empujas poco, el marco lo
  **devuelve animado** al punto más cercano de adentro (mientras tanto el borde se ve firme, en color
  de acento); si lo empujas más allá del umbral (el borde del marco pasa a punteado), al soltarlo
  queda libre. Un nodo nunca queda montado sobre la línea del marco: termina adentro completo o
  despejado por fuera.
- **Mover el marco** mueve a todos sus miembros. La **manija de la esquina inferior derecha**
  (aparece al pasar el mouse o al seleccionarlo) lo agranda o achica a gusto, alto y ancho por
  separado; nunca por debajo del espacio que ocupan sus miembros.
- **Nombre**: doble clic en la píldora del título para renombrar. Puede quedar **vacío** (la píldora
  desaparece y queda un chip `+` para reponerlo).
- **Conexiones**: el marco acepta conexiones como cualquier nodo (incluido heredar su estado, que es
  el peor de sus miembros). Las conexiones de un nodo NO cambian por meterlo o sacarlo del marco, y
  un miembro no se puede conectar con su propio marco.
- **Eliminar** (papelera de la esquina superior derecha del marco): se va SOLO el marco; los nodos
  quedan sueltos en su sitio.
- No hay agrupadores anidados, y los nodos de Texto y la Imagen no se agrupan.
**Editar**: haz clic en un nodo → aparece el botón **Editar** → se abre el editor en dos pestañas:
- **Contenido**: el **nombre** y el **subtítulo** del nodo, la **fuente del estado** (se elige con
  botones segmentados, ver §5), el **bloque de esa fuente** (el selector de entidad o el editor de
  DQL, según lo que elijas) y las **Notas** (texto libre que se despliega desde un ícono en el nodo,
  visible solo en modo edición). Cada cosa va en su propia sección, en ese orden.
- **Links y aspecto**: los **links del nodo** (ver abajo), el **ícono** (galería de íconos de
  Dynatrace + logos de marcas conocidas), la **forma** y el **tamaño**, cada uno en su fila.

La **Salud de conexiones** no es una pestaña: es un **checkbox** (con su umbral) dentro del bloque de
la **Entidad Smartscape**, y solo aparece cuando esa es la fuente del estado (ver §5).

### Links del nodo 🔗

Un nodo puede tener **varios links** (cada uno con su título y su URL), administrados en la pestaña
«Links y aspecto»: escribes el **título** y el **link** en la misma línea y el botón `+` lo añade a la
lista; cada link añadido muestra una **✕** a la derecha para quitarlo.
- Con **un** link, el título del nodo se vuelve un enlace (azul) que lo abre directo en pestaña nueva.
- Con **dos o más**, el clic sobre el título abre un **popup** con la lista de títulos: tocas uno y se
  abre en pestaña nueva mientras el popup se cierra solo (también se cierra al hacer clic por fuera).
- Funciona igual en modo edición y en modo vista/compartido.
- Los nodos que tenían la URL única de versiones anteriores la ven convertida automáticamente en el
  **primer link** de la lista al abrir el editor (el título queda editable).
## 5. El estado de un nodo: Entidad Smartscape vs DQL
Cada nodo de estado elige **una** de dos fuentes, con los botones segmentados de la pestaña
«Contenido»:
### Opción A — Entidad Smartscape (recomendada) 🟢
En el editor del nodo, busca y selecciona una entidad real del ambiente. Tipos soportados: **servicio,
host, grupo de procesos, instancia de proceso, aplicación, clúster de Kubernetes, cloud application y
servicio de base de datos**.
- **Cómo se busca**: eliges el tipo, escribes en la barra de búsqueda y los resultados salen en un
  **desplegable flotante** debajo de la barra, filtrados en vivo mientras escribes. Al elegir una, la
  entidad atada queda como un **chip** con su nombre y su **ID**, y un botón **«Abrir en Dynatrace»**
  para verla aislada en Smartscape.
- **Servicios con el mismo nombre**: para el tipo **servicio**, cada resultado trae tres columnas:
  **nombre | contexto | ID**. El contexto es el `namespace / workload` de Kubernetes donde corre el
  servicio (si no está en Kubernetes, su grupo de procesos o su host), y el ID es el `SERVICE-…` de
  Dynatrace. Así se distingue cuál es cuál entre servicios homónimos (por ejemplo, decenas de
  `AutorecoveringChannel$2`). Si el desplegable queda angosto, el contexto se oculta y quedan
  nombre e ID. En el mapa, al pasar el mouse sobre un nodo atado a una entidad se ve su ID.
- **La búsqueda también encuentra por contexto e ID** (solo servicios): escribe el namespace, el
  workload, parte del grupo de procesos o los últimos caracteres del `SERVICE-…` y la lista se
  reduce a esos. Es la forma de escoger uno entre cientos de homónimos. La lista muestra hasta
  **200** resultados; si hay más, la cabecera avisa *"Mostrando 200 de N, afina la búsqueda"*.
- El estado lo derivan los **problemas activos de Davis** sobre esa entidad: problemas de
  disponibilidad o error → **rojo**; los demás (lentitud, recursos, custom) → **amarillo**; sin
  problemas → **verde**.
- El **nombre en vivo** de la entidad se resuelve solo (si la renombran en Dynatrace, lo verás), y si
  la entidad **desaparece del ambiente** (dada de baja), el nodo lo marca como *retirado*.
- No escribes ni una línea de DQL, y las consultas de topología/metadata **no consumen Grail** (la
  única con costo es la de problemas de Davis, una sola por mapa, no por nodo).
### Opción B — DQL propio
Escribe una consulta DQL cuyo resultado cumpla el **contrato de estado**: la primera fila debe traer un
campo con valor `0` (ok), `1` (advertencia) o `2` (error). Ejemplo típico:
```dql
timeseries errores = sum(dt.service.request.failure_count),
  filter: { dt.entity.service == "SERVICE-XXXX" }
| fields status = if(arrayLast(errores) > 100, 2, else: if(arrayLast(errores) > 10, 1, else: 0))
```
Sirve para cualquier cosa que Davis no cubra: umbrales de negocio, logs, business events, métricas
custom, lookups, etc. **Ojo**: el DQL corre con el timeframe que tú escribas en la consulta, tal cual.
> Un mismo mapa puede mezclar las dos opciones sin problema.
> En un Mapa Padre existe además la fuente **«Mapa»**, la de los nodos sub-mapa (ver §3).
### Salud de Conexiones (pill encima del nodo) 💊
Para nodos con fuente **Entidad Smartscape** (opción A), el bloque de la entidad en el editor permite
activar un **pill encima del nodo** con el porcentaje de salud de sus conexiones **reales de
Smartscape** (quién la llama y a quién llama), estén o no dibujadas en el mapa. Si la entidad tiene
100 conexiones y 20 tienen algún problema activo de Davis, el pill muestra **80%**.
- Viene **desactivado por defecto**; se activa con un checkbox por nodo, junto al selector de la
  entidad. Con fuente DQL el bloque no aparece (el dato existe solo con entidad atada).
- **Umbral de rojo (%)** (por defecto 80): si la salud llega a ese porcentaje o menos, el **nodo se
  pone rojo por la regla** (y sus conexiones con herencia de estado también). Al abrir la burbuja «?»
  se explica que el rojo viene de la **regla de salud de conexiones**, con las cifras exactas. En ese
  caso no se consulta a Davis ni a la IA.
- Sin conexiones en Smartscape → pill gris **«N.A.»**; mientras calcula → «…». Si la consulta de
  conexiones falla, el pill se queda en «…» y el tooltip lo dice (se reintenta solo en el siguiente
  refresco): «N.A.» significa siempre **cero relaciones `calls` en Smartscape**, nunca un error.
- **Condiciones para ver un porcentaje**: la entidad debe existir en el Smartscape nuevo (un grupo
  de procesos no es nodo ahí → «N.A.») y tener al menos una relación `calls` en algún sentido; los
  vecinos sin id clásico no cuentan. Entidades sin tráfico en la ventana de la topología dan «N.A.»
  legítimo.
- **Clic en el pill** → abre la entidad **aislada en Smartscape** (pestaña nueva) para ver esas
  conexiones; el tooltip muestra el detalle (cuántas tienen problemas activos).
- Las conexiones se leen de Smartscape (consultas que no consumen Grail); la salud de los vecinos va
  en **una** consulta batcheada adicional de problemas de Davis por mapa (ver §11).
## 6. Conexiones entre nodos y su estado
- **Crear**: en modo edición, arrastra desde el borde de un nodo hasta otro. Las conexiones son flotantes:
  eligen solas el mejor lado de anclaje, evitan pasar por encima de nodos y se reparten en carriles
  cuando hay varias entre los mismos nodos.
- **Dirección**: las flechitas sobre la conexión indican el sentido; el botón **Invertir** del editor lo
  cambia.
- **Estado de la conexión** (clic en la conexión → Editar):
  - **Heredar del nodo de origen** (por defecto, activado): la conexión se colorea igual que el nodo del
    que sale.  No ejecuta ninguna consulta adicional.
  - **DQL propio**: mismo contrato 0/1/2 que los nodos, para cuando la conexión tiene su propia
    semántica (por ejemplo, el estado de una cola entre dos sistemas). Se reconoce a simple vista: la
    conexión lleva el rótulo **`DQL`** en línea, justo donde sale del nodo.
  - Sin estado: conexión neutra.
- **Valor calculado por DQL** (chip en la mitad de la conexión): en el editor, activa **«Mostrar un
  valor calculado por DQL»** (viene apagado). Se despliega un segundo DQL, independiente del estado,
  cuyo resultado se pinta en un chip del color del estado de la conexión: por ejemplo la latencia o las
  transacciones por minuto entre dos sistemas.
  - **Contrato**: la consulta debe devolver **un solo número**: la primera fila y su campo `value` (o el
    primer campo numérico). Si es una serie (`timeseries`), se toma el **último punto**. Ejemplo:
    `timeseries value = avg(dt.service.request.response_time) | fieldsAdd value = arrayLast(value)`.
  - **Nombre valor** y **Sufijo** (`ms`, `%`, `req/s`): el sufijo acompaña al número; el nombre va en el
    tooltip del chip y, solo si activas **«Mostrar el nombre dentro del chip»**, también dentro de él.
  - **Probar** muestra el chip tal como quedará. El chip abre el editor de la conexión con un clic.
  - Cada valor activo suma una consulta por ciclo (entra en la leyenda de consumo, ver §11).
- **Reorganizar**: el botón de la toolbar reacomoda automáticamente el mapa por capas
  (origen → destino), incluso con ciclos.
## 7. Topología real: Entidades Relacionadas y Sugerir conexiones
### Entidades Relacionadas (por nodo)
Selecciona un nodo **atado a una entidad** → botón de topología junto a «Editar» → se abre el panel
**Entidades Relacionadas**, que compara las relaciones reales (`calls` de Smartscape) contra lo que hay
dibujado y muestra tres listas:
1. **Relacionadas ya conectadas**: no hay nada que hacer (van implícitas, no aparecen).
2. **Relacionadas que están en el mapa pero sin conexión** → botón **`+`** crea la conexión en la
   dirección correcta (quién llama a quién), con herencia de estado activada.
3. **Relacionadas que NO están en el mapa** → botón **`+`** crea el nodo (ya atado a esa entidad, con
   estado por Davis) **y** la conexión, en una sola acción.
4. **Conexiones sin respaldo**: conexión que dibujaste pero que la topología real no confirma → puedes
   **Ignorar** (es intencional, no vuelve a avisar) o **Quitar** (borrar la conexión).
Cada entidad de la lista trae además un ícono para **abrirla en el Smartscape nuevo, aislada con sus
relaciones**, en otra pestaña.
### Sugerir conexiones (global)
Botón de la toolbar (aparece cuando hay nodos atados): revisa **todo el mapa**  y sugiere las
conexiones que existen entre tus nodos atados y no están dibujadas. Las que aceptes se
crean con herencia de estado.
> **Escenario típico**: el cliente despliega un microservicio nuevo en la cadena. En vez de que
> alguien "se acuerde" de actualizar el diagrama, abres el nodo vecino → Entidades Relacionadas → el
> servicio nuevo aparece en la lista → un clic y queda en el mapa, ya monitoreado por Davis.
## 8. La burbuja «¿Por qué está así?»
Cuando un nodo está amarillo o rojo, muestra un ícono **(?)**. Al abrirlo, la burbuja muestra:
- El **estado del nodo** (qué severidad tiene y de dónde sale).
- La **lista de problemas activos de Davis** relacionados, con scroll: de cada uno ves el **ID**, el
  **título**, la **categoría** como chip y un **ícono para abrirlo en Dynatrace**.
  - **Muestra hasta 12 problemas** y el contador dice el **total real**: por ejemplo *«(179,
    mostrando 12)»*.
  - **No incluye problemas duplicados.** Cuando Davis fusiona varios problemas en uno (por ejemplo,
    un *«Multiple service problems»*), los problemas individuales quedan marcados como duplicados: ya
    están contenidos en el principal, así que no se listan ni pintan nodos.
  - **En nodos con DQL sobre problemas de Davis** (`fetch dt.davis.problems…`), la lista sale de
    **ese mismo DQL**: ves exactamente los problemas que ese DQL devolvería en un notebook.
- Una **fila de acciones** al cierre: **«Analizar con Dynatrace Assist»** y **«Abrir la entidad en
  Dynatrace»** (esta última en nodos con Entidad Smartscape).

### Conexión con el análisis de causa raíz
- Si el mapa tiene un **análisis de causa raíz** guardado, cada problema de la burbuja muestra su papel:
  **«🔴 Causa raíz N»** o **«🔗 Efecto de N»**. Al tocarlo se abre ese análisis.
- Si el mapa todavía no tiene análisis y eres editor, la burbuja ofrece **«Analizar causa raíz del mapa»**.
- El **análisis con IA dentro de la burbuja (Davis CoPilot)** sigue igual: se activa en Ajustes y convive con
  el análisis de causa raíz. Los botones de **Dynatrace Assist** («Analizar con Dynatrace Assist» y el
  ✨ de cada problema) también siguen disponibles: todas las funciones de IA conviven con el análisis
  de causa raíz.

### Análisis con IA dentro de la burbuja 🤖
El ajuste **«Análisis con IA en la burbuja»** (Ajustes → General, **encendido en todos los mapas**) cambia quién
hace el análisis:
- **Apagado**: la burbuja muestra el estado, los problemas y los botones de Dynatrace Assist, y **no
  hace ninguna llamada a la IA** por su cuenta.
- **Encendido**: además, **Davis CoPilot** redacta el análisis de causa dentro de la propia burbuja y
  habilita **«Investigar a fondo»** (genera una consulta DQL de investigación lista para ejecutar).
- Los botones de **Dynatrace Assist** («Analizar con Dynatrace Assist» y el ✨ de cada problema) y
  **«Analizar causa raíz del mapa»** están **siempre** disponibles, con el ajuste encendido o apagado.

Otros casos:
- Si el nodo está rojo por la **regla de salud de conexiones** (ver §5), la burbuja muestra esa
  explicación con las cifras de la regla, sin consultar a Davis ni a la IA.
- En nodos con **DQL propio**, la burbuja encuentra los problemas relacionados de dos formas: por los
  **ids de entidad** que aparezcan en la consulta o en sus filas, y por los **filtros del propio DQL**
  sobre `entity_tags`, `event.name`, `event.category`, `event.description` y `k8s.namespace.name`
  (`matchesValue`, `matchesPhrase`, `in` o igualdad `==`). Los filtros se reusan con su misma lógica: si en el DQL van unidos con `or`
  (por ejemplo, dos tags alternativos), la burbuja también los combina con `or`. Con esos filtros no
  hace falta poner ningún id en la consulta: la burbuja lista los
  problemas activos de **la misma población** que el DQL de estado está contando.
  Se respetan todos los filtros del DQL, también los que van después de un `| fields …`.
- En la lista, los problemas que afectan **varias entidades** aparecen de primeros (suelen ser los que
  Davis correlaciona como causa común); dentro de cada grupo, el más reciente arriba.
El **análisis con IA en la burbuja** requiere que el tenant tenga las capacidades de IA generativa
(Davis CoPilot) habilitadas.
### Análisis de causa raíz del mapa 🧭
Con un clic, **Dynatrace Intelligence** revisa los problemas del mapa —los activos y los que se cerraron en
los **últimos 15 minutos**— y los separa en **causas raíz**, que son independientes entre sí, y **efectos**,
para saber qué arreglar primero.

**Cómo se usa**
1. En un mapa con nodos en amarillo o rojo (Mapa de Servicio o Mapa Padre), presiona **✨ Causa raíz** en la barra.
2. El análisis tarda uno o dos minutos y puedes seguir usando el mapa mientras tanto.
3. Al terminar aparecen:
   - La leyenda **«Causas raíz»** arriba a la derecha. Al tocar una causa, el mapa viaja a su nodo y
     abre el análisis.
   - Un **número rojo** en el nodo de cada causa raíz. Si un nodo tiene varias, se ven las 3 primeras y
     **«+N»** con el resto (por ejemplo, **1·2·3 +4**); al pasar el mouse se ven todas.
   - La marca punteada **«Efecto de N»** en los nodos cuyos problemas son consecuencia de la causa N. Si
     el problema del efecto ya se cerró, la marca se ve en verde como **«✓ Efecto de N»**, para que la
     relación se siga viendo.
4. Las causas raíz están numeradas **de la más grave a la menos grave** (severidad, luego categoría:
   disponibilidad y error primero, luego nodos y entidades afectadas, luego la más antigua). Los efectos de
   cada causa siguen el mismo orden, y la lista de problemas de la burbuja también.
5. El análisis de cada causa muestra, en este orden: el **veredicto** en una frase, **por qué es
   causa raíz**, **qué hacer**, los **efectos que explica** (cada uno con link al problema y botón
   «Ir al nodo») y la evidencia (plegada).

**En un Mapa Padre** el análisis revisa los nodos propios del padre **y también los nodos de cada mapa
hijo** (un nivel). Los nodos del hijo aparecen con su ruta, por ejemplo **«Pagos › gw-pagos»**, en la
leyenda, el análisis y los comentarios. En el padre, el número o la marca de efecto salen sobre el
**nodo sub-mapa** que contiene el problema. Con **«Ir al nodo»** sobre un nodo del hijo, la app **abre ese
mapa hijo** y viaja hasta el nodo; arriba a la izquierda aparece el aviso *«Viendo el análisis de causa
raíz de …»* con **«← Volver al mapa padre»**. Esas marcas en el hijo son solo de la visita: no cambian el
mapa hijo ni su propio análisis.

**El análisis se mantiene al día.** El análisis guardado es una foto del momento en que se corrió, pero el
mapa revisa si sus problemas siguen activos (cada 2 minutos; si el análisis tiene más de un día, cada 15): una
causa ya resuelta pasa al final de la leyenda como **«✅ Resuelta»** y su nodo muestra un ✓ verde; un efecto
resuelto pasa a **«✓ Efecto de N»** en verde. Si aparecen nodos en rojo que no estaban en el análisis, la
leyenda lo avisa para volver a analizar.

**Cuando todo pasa, el mapa se limpia solo.** Si **todos** los problemas del análisis ya se cerraron, los nodos
quedan **sin marcas** y la leyenda lo dice («el mapa quedó sin marcas»); el análisis sigue disponible en la
leyenda por si quieres revisarlo. Para quitarlo del todo, los editores tienen el botón **«Limpiar»** en el pie
de la leyenda: borra el análisis y sus marcas para todos (se puede deshacer con ↶). Los comentarios que ya se
publicaron en *Problems* se conservan.

**Confianza calculada.** La confianza no es la que se pone la IA. Por cada relación causa → efecto se
revisan seis señales verificables: relación en Smartscape, orden en el tiempo, raíz según Davis,
eventos compartidos, mismo clúster o host y conexión del mapa. Con 4 o más la confianza es **Alta**,
con 2 o 3 **Media** y con 1 o menos **Baja**. Si la causa empezó después del efecto, es **Baja**.

**Comentarios en los problemas.** El análisis también queda como comentario en la app **Problems**,
en *Comments and insights*: «⏳ en curso» mientras analiza, y luego **🔴 Causa raíz**, **🔗 Efecto**
(con link a su causa), **⚪ Sin clasificar** o **⚠️ sin resultado**. Hay un comentario por problema y
por mapa, y cada análisis lo actualiza. Cada comentario empieza con **quién solicitó el análisis** y
cuándo (👤 *Solicitado por*), y ese nombre también aparece junto al mapa en el «via…» del comentario.

**Condiciones de uso**
- Solo los **editores** ejecutan el análisis; quien tiene el mapa en lectura ve el último guardado.
- Aplica a **Mapas de Servicio** y **Mapas Padre** (en el padre, con un nivel de hijos; los hijos sin acceso
  para quien analiza no aportan problemas).
- Se analizan **problemas de Davis sin duplicados**, **activos o cerrados en los últimos 15 minutos**, de
  nodos atados a una entidad o con DQL sobre `dt.davis.problems`. Los cerrados entran porque un problema
  corto que se cerró justo antes de analizar puede ser la causa o el efecto de otro que sigue activo. Un
  nodo en rojo por un DQL de métricas no aporta problemas.
- Las **conexiones del mapa** cuentan como pista de dependencia (A → B significa que A depende de B).
- Hasta 60 problemas por análisis: si el mapa tiene más, se analizan **los más graves** (primero los activos;
  luego severidad, categoría, nodos que toca, entidades afectadas y antigüedad) y la leyenda avisa «Se analizaron N de M». El resultado
  puede variar entre corridas; por eso se guarda el último.
- Todas las horas están en hora de Colombia. Antes de enviar datos a la IA se enmascaran IPs, correos y URLs;
  en el análisis y en los comentarios los nombres de los nodos se muestran completos.
- Los usuarios necesitan los permisos `automation:workflows:run` y `automation:workflows:read`.

## 9. Compartir, URLs e historial de versiones
- **Compartir**: botón «Compartir» → busca una **persona** (por nombre o correo) o un **grupo** de
  Dynatrace (por nombre; aparece con la etiqueta «Grupo») → elige **lectura** o **lectura y edición**.
  Al compartir con un grupo, el mapa les aparece en la lista a **todos sus miembros**. Por debajo usa
  los permisos nativos de documentos de Dynatrace; también puedes ver y revocar accesos existentes.
  Para que la búsqueda de grupos muestre resultados, quien comparte necesita permiso para ver los
  grupos del account (lo define el administrador de Dynatrace).
- **Qué ve quien recibe un mapa en lectura**: el mapa en modo **vista**. Puede hacer zoom, desplazarse,
  ver los estados en vivo y la burbuja «¿Por qué está así?», pero nada más: sin «+», sin arrastrar ni
  conectar, sin popup «Editar», sin abrir el editor de un nodo (tampoco su DQL), sin menú ⋮ (renombrar,
  duplicar, descargar, convertir, eliminar), sin Compartir ni historial. La app lo sabe desde que abre el
  mapa (candado en la barra), no al intentar guardar.
- **URL por mapa**: cada mapa tiene su URL propia (`…/map/<id>`). Compártela y, si la persona tiene
  acceso, abre directo ese mapa; si no lo tiene, ve un aviso claro (el acceso se otorga con
  «Compartir»).
- **Historial de versiones**: la app toma **fotos automáticas cada ~3 minutos** mientras editas (y
  puedes crear una manual con nombre). Desde el menú de historial puedes ver la lista, **previsualizar**
  una versión y **restaurarla**. Es el seguro contra "alguien dañó el mapa".
## 10. Ajustes, apariencia e idiomas
El modal de **Ajustes** (por mapa) viene en **dos pestañas**, con la etiqueta a la izquierda y el
control a la derecha en cada fila:

**General**
- **Frecuencia de actualización** (cadencia del Mapa Padre, en mapas de ese tipo): cada 10 minutos,
  cada 5 minutos o Manual.
- **Análisis con IA en la burbuja**: encendido en todos los mapas; se puede apagar por mapa (ver §8).
- **Prompt de Dynatrace Assist**: la plantilla de la pregunta que se copia al usar «Analizar con
  Dynatrace Assist». Admite las variables **`{problems}`** (los problemas detectados), **`{name}`**
  (el nombre del nodo), **`{entity}`** (la entidad de Dynatrace) y **`{state}`** (el estado). El texto
  que escribas se guarda en el documento del mapa y **manda sobre el idioma de la interfaz**; el botón
  **«Restaurar el prompt por defecto»** lo devuelve al texto del idioma activo. Se puede editar siempre,
  porque los botones de Assist se ven con o sin «Análisis con IA en la burbuja».

**Apariencia**
- **Glow**: resplandor animado alrededor de los nodos según su estado.
- **Logos de marca a color**: íconos a color o monocromos.
- **Mostrar consumo estimado**: la leyenda de consumo de Grail (ver §11).
- **Idioma**: español, inglés, francés o alemán (aplica a toda la UI).

Otros controles:
- **Imagen de fondo** del lienzo (desde el menú de la toolbar).
- **Modo vista** (candado): el mapa es de solo lectura para ti (compartido sin edición). Se bloquea
  toda edición: la toolbar de edición se oculta y los nodos no abren editor (ver §9).
- **Acerca de**: versión de la app .
## 11. Consumo de Grail (costo)
La app es deliberadamente frugal con Grail:
- Consultas a **Smartscape** (búsqueda de entidades, nombres en vivo, relaciones, sugerencias).
- Estado por **Davis**: una sola consulta batcheada a `dt.davis.problems` por mapa (con costo, pero
  una, no una por nodo), refrescada cada ~90 s.
- **Salud de Conexiones** (si está activada en algún nodo): una consulta batcheada adicional a
  `dt.davis.problems` por mapa para los vecinos, separada de la principal.
- **DQL propios** de nodos/conexión: cuestan lo que cueste cada consulta, con su propio timeframe.
- En un **Mapa Padre**, los DQL de los mapas incrustados corren con la cadencia de actualización
  configurada en Ajustes (10 min, 5 min o Manual), así que esa cadencia gobierna su consumo.
- Conexiónes con **herencia de estado**
La **leyenda de consumo** (esquina inferior) muestra el consumo real por hora de los DQL del mapa,
leído de los eventos de ejecución del propio Grail,  no un estimado. Úsala para decidir si un DQL
caro amerita optimizarse o cambiarse por atadura a entidad.
## 12. Escenarios de uso completos
### A) Tablero del flujo de un canal (monitoreo diario)
1. Crea el mapa «Canal X», agrega los nodos del flujo con los íconos de cada tecnología.
2. Ata cada nodo a su servicio/host real → estado por Davis, sin DQL.
3. Conecta con «Sugerir conexiones» y ajusta a mano lo que falte (terceros, conceptos de negocio).
4. Activa el glow, pon el candado en modo vista y proyéctalo en la pantalla del equipo.
### B) Triage de un incidente
1. Un nodo se pone rojo → clic en la burbuja **(?)**.
2. Revisa la lista de problemas activos y abre en Dynatrace el que corresponda; si quieres el análisis
   de causa, usa **«Analizar con Dynatrace Assist»** (o enciende «Análisis con IA en la burbuja» en
   Ajustes para que Davis CoPilot lo redacte ahí mismo).
3. Si el impacto viene de una dependencia, las conexiónes heredadas muestran por dónde se propaga.
### C) La arquitectura cambió
1. Abres el nodo del servicio que cambió → **Entidades Relacionadas**.
2. Conectas lo nuevo (`+`), quitas o marcas como intencional lo que quedó **sin respaldo**.
3. El mapa vuelve a reflejar la realidad, sin perder la curaduría.
### D) Estado de negocio
1. Nodo «Aprobación de créditos» sin entidad: usa un **DQL propio** sobre business events con umbrales
   del negocio (contrato 0/1/2).
2. Revisa en la leyenda de Grail cuánto cuesta esa consulta por hora y ajusta el timeframe si hace falta.
### E) Entregar el mapa a otro equipo
1. «Compartir» → el grupo del equipo (o las personas una a una), con lectura o edición según el caso.
2. Envíales la **URL del mapa**.
3. Si se quiere restaurar otra versión, restauras desde el **historial de versiones**; si se borra el mapa, se recupera
   de la **papelera** (30 días).
## 13. Preguntas frecuentes

**¿Puedo mezclar nodos atados a entidad y nodos con DQL en el mismo mapa?**
Sí, es el uso esperado: entidades para lo técnico, DQL para lo de negocio.

**¿Qué pasa si dan de baja una entidad atada?**
El nodo se marca como *retirado*, no se pone verde en falso ni desaparece; tú decides si lo quitas o
lo re-atas.

**El nodo aparece gris / «desconocido».**
Todavía no llega el primer resultado de su consulta (o está pausada porque la pestaña estuvo en
segundo plano). Es intencional: la app nunca muestra verde sin evidencia.

**«Sin entidades» al buscar en el selector.**
Revisa que estés buscando en el tipo correcto y que el término coincida con parte del nombre (la
búsqueda es por contenido, sin distinguir mayúsculas).

**¿La app modifica algo en Dynatrace?**
No. Todos los permisos sobre el ambiente son de **lectura**; lo único que escribe son sus propios
documentos (los mapas) y los permisos de compartirlos.
