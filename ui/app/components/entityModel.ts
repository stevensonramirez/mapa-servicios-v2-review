import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";

// ── Modelo de entidad (binding a Smartscape / topología real) ────────────────
// Un nodo del mapa puede "atarse" a una entidad real de Dynatrace (un servicio,
// un host, etc.). Con esa atadura el estado del nodo lo puede llevar Davis
// (problemas activos) en vez de un DQL a mano, y la topología (calls/called_by)
// permite sugerir conexiones reales entre nodos.

// Tipos de entidad soportados. Se mantiene una unión cerrada para el selector.
export type EntityType =
  | "dt.entity.service"
  | "dt.entity.host"
  | "dt.entity.process_group"
  | "dt.entity.process_group_instance"
  | "dt.entity.application"
  | "dt.entity.mobile_application"
  | "dt.entity.kubernetes_cluster"
  | "dt.entity.kubernetes_service"
  | "dt.entity.cloud_application"
  | "dt.entity.cloud_application_namespace"
  | "dt.entity.relational_database_service";

// Referencia mínima a una entidad, tal como se persiste en el nodo.
export type EntityRef = {
  // Id CLÁSICO (p. ej. "SERVICE-…", "PROCESS_GROUP_INSTANCE-…"). Es el id
  // canónico de la app: es el que usan Davis (`affected_entity_ids`) y los
  // mapas ya guardados.
  id: string;
  type: EntityType;
  // Nombre "congelado" al momento de atar (etiqueta legible). El nombre EN VIVO
  // se resuelve aparte (useEntityMetadata) para detectar renombrados/bajas.
  name?: string;
  // Id del modelo NUEVO de Smartscape cuando difiere del clásico (p. ej.
  // "PROCESS-…" para una instancia de proceso; para hosts/servicios ambos
  // coinciden y se omite). Lo usan los deep-links y `smartscapeEdges`, que
  // hablan en ids nuevos. Persiste con el nodo (spread), es solo un caché.
  sid?: string;
};

// Todos los tipos, en el orden que se muestran en el selector.
export const ENTITY_TYPES: EntityType[] = [
  "dt.entity.service",
  "dt.entity.host",
  "dt.entity.process_group",
  "dt.entity.process_group_instance",
  "dt.entity.application",
  "dt.entity.mobile_application",
  "dt.entity.kubernetes_cluster",
  "dt.entity.kubernetes_service",
  "dt.entity.cloud_application",
  "dt.entity.cloud_application_namespace",
  "dt.entity.relational_database_service",
];

// Etiqueta legible por tipo (para el select y las filas de resultados).
const ENTITY_LABELS: Record<EntityType, string> = {
  "dt.entity.service": "Servicio",
  "dt.entity.host": "Host",
  "dt.entity.process_group": "Grupo de procesos",
  "dt.entity.process_group_instance": "Instancia de proceso",
  "dt.entity.application": "Aplicación",
  "dt.entity.mobile_application": "Aplicación móvil",
  "dt.entity.kubernetes_cluster": "Clúster de Kubernetes",
  "dt.entity.kubernetes_service": "Servicio de Kubernetes",
  "dt.entity.cloud_application": "Cloud application",
  "dt.entity.cloud_application_namespace": "Namespace de Kubernetes",
  "dt.entity.relational_database_service": "Servicio de base de datos",
};

export const entityTypeLabel = (type: EntityType): string => ENTITY_LABELS[type] ?? type;

// Deriva el tipo de entidad a partir de su id (los ids de Dynatrace llevan el
// prefijo del tipo, p. ej. SERVICE-ABC…, HOST-123…). "" si no reconoce.
const PREFIX_TO_TYPE: Record<string, EntityType> = {
  SERVICE: "dt.entity.service",
  HOST: "dt.entity.host",
  PROCESS_GROUP: "dt.entity.process_group",
  PROCESS_GROUP_INSTANCE: "dt.entity.process_group_instance",
  APPLICATION: "dt.entity.application",
  MOBILE_APPLICATION: "dt.entity.mobile_application",
  KUBERNETES_CLUSTER: "dt.entity.kubernetes_cluster",
  KUBERNETES_SERVICE: "dt.entity.kubernetes_service",
  CLOUD_APPLICATION: "dt.entity.cloud_application",
  CLOUD_APPLICATION_NAMESPACE: "dt.entity.cloud_application_namespace",
  RELATIONAL_DATABASE_SERVICE: "dt.entity.relational_database_service",
};

export const entityTypeOf = (id: unknown): EntityType | undefined => {
  if (typeof id !== "string") return undefined;
  const dash = id.lastIndexOf("-");
  if (dash <= 0) return undefined;
  return PREFIX_TO_TYPE[id.slice(0, dash)];
};

// Inverso de PREFIX_TO_TYPE: el prefijo CLÁSICO del id por tipo (para armar
// filtros `startsWith(id_classic, "<PREFIJO>-")`). Se deriva en vez de duplicar
// la lista para que no se puedan desincronizar.
const TYPE_TO_PREFIX = Object.fromEntries(
  Object.entries(PREFIX_TO_TYPE).map(([prefix, type]) => [type, prefix]),
) as Record<EntityType, string>;

export const entityClassicPrefix = (type: EntityType): string => TYPE_TO_PREFIX[type];

// Argumento de tipo para `smartscapeNodes "<ARG>"` en el modelo NUEVO de
// Smartscape. OJO: NO coincide con el prefijo clásico en varios tipos — el
// modelo nuevo RENOMBRÓ tipos e ids (verificado en vivo con
// `smartscapeNodes "*" | summarize by:{ ctype = prefijo(id_classic), type }`):
//   PROCESS_GROUP_INSTANCE → PROCESS · APPLICATION → FRONTEND ·
//   KUBERNETES_CLUSTER → K8S_CLUSTER (¡con sufijo hex DISTINTO!).
// Los tipos SIN entrada aquí no tienen un tipo nuevo 1:1:
//   - cloud_application se partió en varios tipos K8s (K8S_DEPLOYMENT,
//     K8S_REPLICASET, K8S_JOB, …) → se busca por startsWith(id_classic, …).
//   - relational_database_service no se pudo verificar como tipo nuevo → ídem.
//   - process_group YA NO ES un nodo en el modelo nuevo: solo existe como campo
//     `dt.process_group.id`/`.detected_name` de cada PROCESS → se deriva con
//     summarize (caso especial en useEntityCatalog).
export const SMARTSCAPE_TYPE_ARG: Partial<Record<EntityType, string>> = {
  "dt.entity.service": "SERVICE",
  "dt.entity.host": "HOST",
  "dt.entity.process_group_instance": "PROCESS",
  "dt.entity.application": "FRONTEND",
  // OJO: FRONTEND agrupa DOS tipos clásicos (APPLICATION y MOBILE_APPLICATION);
  // el filtro por prefijo clásico del catálogo es el que separa las categorías.
  "dt.entity.mobile_application": "FRONTEND",
  "dt.entity.kubernetes_cluster": "K8S_CLUSTER",
  "dt.entity.kubernetes_service": "K8S_SERVICE",
  "dt.entity.cloud_application_namespace": "K8S_NAMESPACE",
};

// Escapa un valor para interpolarlo dentro de un string DQL entre comillas dobles.
// Evita romper la consulta (o inyectar) si un id/nombre trajera comillas.
export const dqlQuote = (v: string): string => `"${String(v).replace(/["\\]/g, "\\$&")}"`;

// Enlace a la vista de la entidad en Smartscape, aislada con sus relaciones
// (vista "all-topology": el id va en la RUTA además de en `isolate=` del hash).
// URL DEFINITIVA — copiada EXACTA de lo que deja el botón nativo "Isolate" de
// Dynatrace sobre una entidad real (no un patrón adivinado ni sacado de otra
// vista). Antes se probaron 3 caminos que NO sirvieron para este propósito:
// (1) ruta armada a mano `/ui/entity/<id>` (no existe → cae al home); (2) Intent
// del SDK `sendIntent`/`getIntentLink` (abría el diálogo nativo "Abrir con" del
// navegador); (3) la vista "smartscape-on-grail" con `isolate=<id>` en el hash
// (con el mismo id, formato y encoding correctos, SEGUÍA cayendo al mapa
// general — la vista correcta para aislar una entidad es "all-topology", no
// "smartscape-on-grail"). La app corre en iframe sandbox → URL absoluta desde
// `getEnvironmentUrl()`, no una ruta relativa.
// OJO: `encodeURIComponent` de JS NO escapa `(`/`)` — `from`/`to` se escriben ya
// codificados a mano (`now%28%29`) en vez de pasarlos por `encodeURIComponent`.
// Se prefiere `sid` (id del modelo nuevo) porque la app de Smartscape nueva
// habla en esos ids; para hosts/servicios sid==id y no hay diferencia.
// "" si no hay id.
export const entityIntentLink = (ref: EntityRef | undefined): string => {
  const id = ref?.sid ?? ref?.id;
  if (typeof id !== "string" || !id.trim()) return "";
  const base = getEnvironmentUrl().replace(/\/+$/, "");
  const idEnc = encodeURIComponent(id.trim());
  const hash = `from=now%28%29-2h&to=now%28%29&isolate=${idEnc}`;
  return `${base}/ui/apps/dynatrace.smartscape/view/dynatrace.smartscape.all-topology/${idEnc}#${hash}`;
};

// Abre la entidad en una pestaña nueva (si el enlace es válido).
export const openEntity = (ref: EntityRef | undefined): void => {
  const href = entityIntentLink(ref);
  if (!href) return;
  window.open(href, "_blank", "noopener,noreferrer");
};
