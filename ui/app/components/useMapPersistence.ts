import { useCallback, useEffect, useRef, useState } from "react";
import { validateMapContent } from "./mapValidation";
import type { InvalidMap } from "./mapValidation";
import { documentsClient, trashClient, directSharesClient } from "@dynatrace-sdk/client-document";
import type { Edge, Node } from "@xyflow/react";
import type { MapSettings } from "./mapSettings";
import { DEFAULT_SETTINGS, DEFAULT_GLOW } from "./mapSettings";
import { corexDql } from "./mapSeed";

// Biblioteca de mapas sobre el Document service. Cada mapa = UN documento
// privado (type "mapa-servicios-v2", el contenido es el MapSnapshot JSON). El
// usuario es dueño; nadie más lo ve por defecto. Operaciones: listar, abrir,
// crear (también al importar), renombrar y enviar a la papelera (recuperable).
//
// Notas de seguridad/concurrencia:
// - Guardado con debounce + dedupe por contenido (no escribe en cada refresco
//   de severidad). Optimistic locking con reintento ante conflicto de versión.
// - Al cambiar de mapa se cancela el guardado pendiente y se bloquea guardar
//   durante el cambio, para no escribir el contenido de un mapa en otro.
// - Puntero "último mapa abierto" en localStorage (best-effort, sin scope extra).

// OJO: DOC_TYPE es el identificador interno con el que se guardan TODOS los mapas
// en el Document service. NO cambiarlo: si se cambia, los mapas ya guardados (con
// type "mapa-servicios-v2") dejarían de aparecer. Es invisible para el usuario.
const DOC_TYPE = "mapa-servicios-v2";
const SAVE_DEBOUNCE_MS = 1200;
// Reintento tras un guardado fallido (error transitorio de red): sin esto el
// cambio pendiente quedaba varado hasta la próxima edición o cambio de mapa.
const SAVE_RETRY_MS = 30_000;
const LAST_MAP_KEY = "mapa-servicios-v2:lastMapId";
// Límite duro del Document service: 50 MB por documento. Validamos ANTES de
// escribir para dar un error claro en vez de tragarnos el fallo del backend.
// Margen de seguridad: 48 MB (deja espacio a metadata/encoding).
export const MAX_DOC_BYTES = 48 * 1024 * 1024;

// Tipo de mapa, elegido AL CREARLO y ya no modificable:
//   "normal" → Mapa de Servicio (el de siempre)
//   "parent" → Mapa Padre (además puede incrustar Mapas de Servicio como nodos)
// Los documentos anteriores a esta función no traen el campo = Mapa de Servicio.
export type MapType = "normal" | "parent";

// `invalid`: el contenido guardado NO tiene el formato de la app (ver
// mapValidation.ts). Transitorio, nunca se persiste: el mapa no se dibuja, la app
// muestra el aviso y el documento no se toca (queda en solo lectura).
export type MapSnapshot = { nodes: Node[]; edges: Edge[]; settings?: MapSettings; mapType?: MapType; invalid?: InvalidMap };
export type SaveState = "idle" | "saving" | "saved" | "error" | "readonly";
// `readOnly`: el usuario NO tiene permiso de escritura sobre el documento (un
// mapa compartido en "solo lectura"). Sale del campo `access` del Document service.
export type MapMeta = { id: string; name: string; version: string; mapType: MapType; readOnly: boolean };

// El tipo CANÓNICO vive en el contenido del documento (el snapshot). Se espeja
// además en el `type` del documento: los Mapas Padre se crean con DOC_TYPE_PARENT.
// Es el ÚNICO metadato fiable para la lista — listar documentos devuelve metadata
// SIN contenido y SIN `description` (verificado con la documentación oficial), así
// que sin este espejo la barra lateral tendría que descargar todos los documentos
// solo para pintar un ícono. El type se fija al crear y no cambia después.
const DOC_TYPE_PARENT = `${DOC_TYPE}.parent`;

export const snapshotMapType = (snap: { mapType?: unknown } | null | undefined): MapType =>
  snap?.mapType === "parent" ? "parent" : "normal";
// Mapa en la papelera. La plataforma conserva los borrados 30 días y luego los
// purga automáticamente (doc. oficial del Document service).
export type TrashedMap = { id: string; name: string; deletedTime: string };
export const TRASH_RETENTION_DAYS = 30;

// ¿Es `src` un data: URL de imagen embebida (lo único que produce esta app)?
// Cualquier otra cosa (http(s):, javascript:, blob:, file:) se rechaza: evita
// que un JSON importado/alterado haga que el origen privilegiado de la app
// pida una URL remota (SSRF / beacon de rastreo) al renderizar la imagen.
export const isDataImageSrc = (s: unknown): s is string =>
  typeof s === "string" && /^data:image\/[a-z.+-]+;base64,/i.test(s);

// Limpia los campos volátiles antes de persistir: la severidad se recalcula del
// DQL y los flags selected/dragging/measured no son topología. Los `settings`
// (ajustes por mapa) sí se guardan. Exportado: el mismo formato limpio que se
// guarda es el JSON portable que se exporta/importa (cero conversión).
export const cleanSnapshot = ({ nodes, edges, settings, mapType }: MapSnapshot): MapSnapshot => ({
  nodes: nodes.map((n) => {
    // Defensa en profundidad: data podría venir null/no-objeto de un doc viejo
    // o alterado. Normalizamos a objeto para no romper el render de severidad.
    const safeData = n.data && typeof n.data === "object" ? n.data : {};
    const data = n.type === "severity" ? { ...safeData, severity: "unknown" } : safeData;
    const base: Node = { id: n.id, type: n.type, position: n.position, data };
    if (n.draggable !== undefined) base.draggable = n.draggable;
    // Pertenencia a un nodo AGRUPADOR (subflujo de React Flow): sin esto, al
    // recargar los miembros salían sueltos y su `position` (que es RELATIVA al
    // marco) se leería como absoluta → todos amontonados en la esquina.
    if (typeof n.parentId === "string" && n.parentId) base.parentId = n.parentId;
    // Los nodos image conservan su tamaño (width/height) para que el NodeResizer
    // round-tripee correctamente al recargar. Para severity/label suelen ser
    // undefined y no se incluyen, evitando ruido en el JSON guardado.
    if (typeof n.width === "number") base.width = n.width;
    if (typeof n.height === "number") base.height = n.height;
    return base;
  }),
  edges: edges.map((e) => {
    // La raya guarda su DQL propio (estado independiente de los nodos) y el
    // booleano "heredar del nodo origen". Persistimos un data mínimo y saneado.
    // Lo volátil (color/animación, que se deriva del dql) NO se guarda.
    const base: Edge = { id: e.id, source: e.source, target: e.target };
    const d = e.data as
      | { dql?: unknown; inheritStatus?: unknown; topologyIgnored?: unknown; valueEnabled?: unknown; valueDql?: unknown; valueLabel?: unknown; valueShowLabel?: unknown; valueUnit?: unknown }
      | undefined;
    const data: Record<string, unknown> = {};
    if (d && typeof d.dql === "string") data.dql = d.dql;
    if (d && typeof d.inheritStatus === "boolean") data.inheritStatus = d.inheritStatus;
    // Chip de VALOR de la raya (segundo DQL). Lista blanca: sin esto se perdería al recargar.
    if (d && d.valueEnabled === true) data.valueEnabled = true;
    if (d && typeof d.valueDql === "string" && d.valueDql.trim()) data.valueDql = d.valueDql;
    if (d && typeof d.valueLabel === "string" && d.valueLabel.trim()) data.valueLabel = d.valueLabel;
    if (d && typeof d.valueUnit === "string" && d.valueUnit.trim()) data.valueUnit = d.valueUnit;
    if (d && d.valueShowLabel === true) data.valueShowLabel = true;
    // "Ignorar" una raya sin respaldo de topología: no se vuelve a listar en el
    // popover "Relacionados". Se persiste solo cuando es true (para no ensuciar).
    if (d && d.topologyIgnored === true) data.topologyIgnored = true;
    if (Object.keys(data).length > 0) base.data = data;
    return base;
  }),
  ...(settings ? { settings } : {}),
  // Solo se escribe en los Mapas Padre: así un documento viejo (sin el campo)
  // round-tripea idéntico y no se re-escribe solo por abrirlo.
  ...(mapType === "parent" ? { mapType } : {}),
});

const serialize = (snap: MapSnapshot): string => JSON.stringify(cleanSnapshot(snap));

// ORDEN que exige React Flow v12 en los subflujos: la imagen de fondo primero
// (comparte capa con los agrupadores y debe quedar debajo), luego los nodos
// AGRUPADORES y de últimas todo lo demás — un nodo padre SIEMPRE debe ir antes
// que sus hijos en el arreglo o el render se rompe. Es un orden ESTABLE (dentro
// de cada grupo se conserva el orden original) y, si el mapa no tiene ningún
// agrupador, devuelve el MISMO arreglo: los mapas viejos no cambian en nada.
export const orderNodesForFlow = (nodes: Node[]): Node[] => {
  if (!nodes.some((n) => n.type === "group")) return nodes;
  const rank = (n: Node) => (n.type === "image" ? 0 : n.type === "group" ? 1 : 2);
  const out = [...nodes];
  // Sort estable (garantizado por la especificación de Array.prototype.sort).
  out.sort((a, b) => rank(a) - rank(b));
  return out;
};

// Normaliza un snapshot recién leído (de un doc propio, compartido o importado)
// al modelo ACTUAL, de forma idempotente, ANTES de fijar la línea base de
// guardado. Así abrir un mapa "viejo" no dispara una re-escritura automática
// (la línea base ya coincide con lo que el lienzo va a mostrar):
//  - Migra el modelo viejo (guardianName) → DQL CoreX si el nodo no tiene dql.
//  - Mezcla settings con los defaults (incl. glow) para que mapas sin glow
//    queden en "medium" sin contar como cambio.
const normalizeSnapshot = (snap: MapSnapshot): MapSnapshot => {
  // Agrupadores que existen de verdad: un `parentId` colgando (el marco se
  // perdió en un rescate parcial o en un JSON alterado a mano) dejaría al nodo
  // con su posición RELATIVA leída como absoluta y sin padre que la corrija.
  const groupIds = new Set(snap.nodes.filter((n) => n.type === "group").map((n) => n.id));
  const nodes = snap.nodes.map((rawNode) => {
    // `extent` NUNCA se respeta al cargar: una versión intermedia (v0.10.30)
    // guardó `extent: "parent"` en los miembros y ese campo confina el arrastre
    // (impide sacar el nodo del marco con el gesto del umbral). Se limpia SIEMPRE.
    const rawClean = rawNode.extent !== undefined ? { ...rawNode, extent: undefined } : rawNode;
    let n = rawClean.parentId && !groupIds.has(rawClean.parentId)
      ? { ...rawClean, parentId: undefined }
      : rawClean;
    // Agrupadores de la primera versión: el tamaño vivía en `data.w`/`data.h`.
    // Ahora la ÚNICA fuente de verdad es `width`/`height` en la raíz del nodo
    // (lo que dimensiona el contenedor y lo que escribe la manija de resize).
    if (n.type === "group") {
      const gd: Record<string, unknown> = n.data && typeof n.data === "object" ? n.data : {};
      if (typeof gd.w === "number" || typeof gd.h === "number") {
        const { w, h, ...rest } = gd;
        n = {
          ...n,
          width: typeof n.width === "number" ? n.width : typeof w === "number" ? w : undefined,
          height: typeof n.height === "number" ? n.height : typeof h === "number" ? h : undefined,
          data: rest,
        };
      }
    }
    // Defensa en profundidad al LEER (cleanSnapshot ya lo hace al guardar): un
    // documento alterado por fuera puede traer data null/no-objeto y eso
    // reventaría la hidratación/render (`d.dql`, `data.severity`, `data.text`).
    const safe = n.data && typeof n.data === "object" ? n : { ...n, data: {} };
    if (safe.type !== "severity") return safe;
    const d = safe.data as { dql?: string; guardianName?: string } & Record<string, unknown>;
    if ((!d.dql || !d.dql.trim()) && typeof d.guardianName === "string" && d.guardianName.trim()) {
      return { ...safe, data: { ...d, dql: corexDql(d.guardianName) } };
    }
    return safe;
  });
  const raw = (snap.settings ?? {}) as Partial<MapSettings>;
  const settings: MapSettings = {
    ...DEFAULT_SETTINGS,
    ...raw,
    glow: { ...DEFAULT_GLOW, ...(raw.glow ?? {}) },
  };
  return {
    // Agrupadores antes que sus miembros: el orden es un requisito de render de
    // React Flow y aquí es donde se fija la línea base de guardado, así que
    // ordenar en este punto evita una re-escritura al abrir el mapa.
    nodes: orderNodesForFlow(nodes),
    edges: snap.edges,
    settings,
    ...(snapshotMapType(snap) === "parent" ? { mapType: "parent" as const } : {}),
  };
};

// Mapa vacío: se usa solo como respaldo si el contenido de un documento no se
// puede leer. Al ENTRAR sin mapas NO se muestra nada (estado vacío en la UI).
const EMPTY_SNAPSHOT: MapSnapshot = { nodes: [], edges: [], settings: DEFAULT_SETTINGS };

// Semilla de un mapa NUEVO/vacío: solo un título con el nombre dado.
const blankSeed = (name: string, mapType: MapType): MapSnapshot => ({
  nodes: [{ id: "title", type: "label", position: { x: 24, y: -40 }, data: { text: name, size: 30 }, draggable: true }],
  edges: [],
  settings: DEFAULT_SETTINGS,
  ...(mapType === "parent" ? { mapType } : {}),
});

// ── Validación de forma de mapa (importar JSON externo o leer un doc/compartido
// posiblemente alterado) ─────────────────────────────────────────────────────
// No basta con que nodes/edges sean arrays: cada nodo necesita id (string) y
// position {x,y} finitos, o ReactFlow revienta al leer node.position.x; un nodo
// image con src que no sea data:image abriría una petición remota desde el
// origen de la app. Validamos POR ELEMENTO para no crashear ni inyectar basura.
const isValidNode = (n: unknown): n is Node => {
  if (!n || typeof n !== "object") return false;
  const o = n as Record<string, unknown>;
  if (typeof o.id !== "string") return false;
  const p = o.position as Record<string, unknown> | undefined;
  if (!p || typeof p !== "object") return false;
  if (typeof p.x !== "number" || !Number.isFinite(p.x)) return false;
  if (typeof p.y !== "number" || !Number.isFinite(p.y)) return false;
  // Un nodo image solo es válido con un data: URL de imagen embebida.
  if (o.type === "image") {
    const d = o.data as Record<string, unknown> | undefined;
    if (!d || !isDataImageSrc(d.src)) return false;
  }
  return true;
};

const isValidEdge = (e: unknown): e is Edge => {
  if (!e || typeof e !== "object") return false;
  const o = e as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.source === "string" && typeof o.target === "string";
};

// Valida que un objeto tenga forma de mapa, validando CADA nodo y arista.
export const isMapSnapshot = (v: unknown): v is MapSnapshot => {
  if (!v || typeof v !== "object") return false;
  const s = v as { nodes?: unknown; edges?: unknown };
  return (
    Array.isArray(s.nodes) &&
    s.nodes.every(isValidNode) &&
    Array.isArray(s.edges) &&
    s.edges.every(isValidEdge)
  );
};

const readLastId = (): string | null => {
  try {
    return localStorage.getItem(LAST_MAP_KEY);
  } catch {
    return null;
  }
};
const writeLastId = (id: string) => {
  try {
    localStorage.setItem(LAST_MAP_KEY, id);
  } catch {
    /* sandbox sin localStorage: no pasa nada, caemos al más reciente */
  }
};

const blob = (json: string) => new Blob([json], { type: "application/json" });

// ── Clasificación de errores del SDK (para no reintentar a ciegas) ───────────
const errStatus = (e: unknown): number | undefined => {
  if (!e || typeof e !== "object") return undefined;
  const o = e as Record<string, unknown>;
  if (typeof o.status === "number") return o.status;
  const resp = o.response as Record<string, unknown> | undefined;
  if (resp && typeof resp.status === "number") return resp.status;
  return undefined;
};
// Sin permiso de escritura (mapa compartido en SOLO LECTURA, o se perdió el acceso).
const isForbidden = (e: unknown): boolean => {
  const s = errStatus(e);
  if (s === 401 || s === 403) return true;
  const msg = (e as { message?: string } | null)?.message ?? "";
  return /forbidden|not allowed|access denied|permission/i.test(msg);
}

// ¿El usuario puede escribir este documento? `access` viene en el listado y en la
// metadata (["read"] = compartido en solo lectura; el dueño trae read/write/delete).
// Si el campo no viniera, se asume escribible: el guardado con 403 sigue de red.
function hasWrite(access: unknown): boolean {
  return !Array.isArray(access) || access.includes("write");
};

// Cadencia de versiones: tras ~3 min SIN cambios después de editar, se crea UN
// snapshot (versión) del estado actual. Da ~una versión por sesión de trabajo, sin
// inundar de versiones por cada clic. El Document service versiona nativo.
const SNAPSHOT_IDLE_MS = 180_000;

export const useMapLibrary = () => {
  const [maps, setMaps] = useState<MapMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeName, setActiveName] = useState<string>("");
  const [activeSnapshot, setActiveSnapshot] = useState<MapSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  // El mapa activo es de SOLO LECTURA (un compartido sin permiso de escritura).
  // Se sabe DESDE QUE SE ABRE (campo `access` del documento) y la UI bloquea toda
  // edición; como red, un guardado con 401/403 también lo enciende.
  const [readOnly, setReadOnly] = useState(false);
  // Ids de los mapas que están compartidos con alguien (para marcarlos en la lista).
  const [sharedIds, setSharedIds] = useState<Set<string>>(new Set());

  const activeIdRef = useRef<string | null>(null); // espejo de activeId para timeouts/closures
  const versionRef = useRef<string | null>(null); // optimistic locking del mapa activo
  const lastSavedRef = useRef<string | null>(null); // último contenido persistido del activo
  const pendingJsonRef = useRef<string | null>(null); // último contenido encolado (debounce)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshotTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // cadencia de versiones
  const snapshotPendingRef = useRef(false); // hubo cambios desde el último snapshot
  const switchingRef = useRef(false); // bloquea guardar mientras se cambia/crea mapa
  const openSeqRef = useRef(0); // secuencia de openMap: con aperturas en paralelo gana la última
  const readyRef = useRef(false); // solo se guarda tras una carga inicial exitosa
  const readOnlyRef = useRef(false); // espejo de readOnly para closures de guardado

  // Aplica un mapa como activo: fija versión/contenido base (para dedupe) y estado.
  const applyActive = useCallback((id: string | null, name: string, snap: MapSnapshot, version: string | null, roIn = false) => {
    // Mapa con contenido inválido: solo lectura SIEMPRE (no se guarda nada encima).
    const ro = roIn || !!snap.invalid;
    activeIdRef.current = id;
    versionRef.current = version;
    lastSavedRef.current = serialize(snap);
    pendingJsonRef.current = null;
    // Cancela el timer del debounce del mapa ANTERIOR: si quedara vivo, su
    // closure persistiría el contenido viejo sobre el documento nuevo (P0).
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    readOnlyRef.current = ro;
    // Reinicia la cadencia de versiones al cambiar de mapa (el timer del mapa
    // anterior no debe disparar un snapshot sobre el nuevo).
    if (snapshotTimer.current) clearTimeout(snapshotTimer.current);
    snapshotPendingRef.current = false;
    setReadOnly(ro);
    if (ro) setSaveState("readonly"); // candado en la barra desde el primer momento
    setActiveId(id);
    setActiveName(name);
    setActiveSnapshot(snap);
    if (id) writeLastId(id);
  }, []);

  const listMaps = useCallback(async (): Promise<MapMeta[]> => {
    // Paginado: con >100 mapas (propios + compartidos) los más viejos
    // desaparecían de la lista (y el "último abierto" fuera de página se perdía).
    // Dos pasadas (una por type) porque el tipo de mapa vive en el `type` del
    // documento; se mezclan y reordenan por última modificación aquí.
    const all: Array<MapMeta & { ts: number }> = [];
    for (const [docType, mapType] of [
      [DOC_TYPE, "normal"],
      [DOC_TYPE_PARENT, "parent"],
    ] as const) {
      let pageKey: string | undefined;
      do {
        const list = await documentsClient.listDocuments({
          filter: `type == '${docType}'`,
          sort: "-modificationInfo.lastModifiedTime",
          pageSize: 100,
          pageKey,
        });
        for (const d of list.documents) {
          const lm: unknown = d.modificationInfo?.lastModifiedTime;
          const ts = lm instanceof Date ? lm.getTime() : typeof lm === "string" ? Date.parse(lm) : 0;
          all.push({ id: d.id, name: d.name, version: d.version, mapType, readOnly: !hasWrite(d.access), ts });
        }
        pageKey = list.nextPageKey ?? undefined;
      } while (pageKey);
    }
    return all
      .sort((a, b) => b.ts - a.ts)
      .map((e) => ({ id: e.id, name: e.name, version: e.version, mapType: e.mapType, readOnly: e.readOnly }));
  }, []);

  const refreshList = useCallback(async () => {
    try {
      setMaps(await listMaps());
    } catch {
      /* lista best-effort: si falla, conservamos la anterior */
    }
  }, [listMaps]);

  // ¿Qué mapas están compartidos con alguien? Una sola llamada lista TODOS mis
  // direct-shares; marcamos los documentId con al menos un destinatario (usuario
  // o grupo). Best-effort: si falla (p. ej. sin scope), no marcamos nada.
  const refreshShares = useCallback(async () => {
    try {
      const ids = new Set<string>();
      let pageKey: string | undefined;
      do {
        const res = await directSharesClient.listDirectShares({ pageSize: 1000, pageKey });
        for (const s of res["direct-shares"] ?? []) {
          if ((s.userCount ?? 0) + (s.groupCount ?? 0) > 0) ids.add(s.documentId);
        }
        pageKey = res.nextPageKey;
      } while (pageKey);
      setSharedIds(ids);
    } catch {
      /* sin permiso o error transitorio: no marcamos compartidos */
    }
  }, []);

  const fetchSnapshot = useCallback(async (id: string): Promise<MapSnapshot> => {
    const res = await documentsClient.getDocument({ id });
    const text = res.content ? await res.content.get("text") : "";
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = undefined;
    }
    // Validación ESTRICTA (sin rescates ni reparaciones): si el contenido no
    // tiene el formato de la app, el mapa NO se dibuja y la app muestra el aviso
    // (applyActive lo deja en solo lectura: nunca se re-escribe el documento).
    const invalid = validateMapContent(parsed);
    if (invalid) return { ...EMPTY_SNAPSHOT, invalid };
    // Normaliza al modelo actual (migración + glow) para que la línea base de
    // guardado coincida con lo que se mostrará y NO se re-escriba al abrir.
    let snap: MapSnapshot = normalizeSnapshot(parsed as MapSnapshot);
    // El `type` del DOCUMENTO manda sobre el contenido: la conversión a Mapa
    // Padre es de un solo sentido, y restaurar una versión del historial
    // anterior a la conversión traería el tipo viejo dentro del snapshot —
    // sería un "deshacer" por accidente. Aquí se refuerza el tipo vigente.
    if (res.metadata?.type === DOC_TYPE_PARENT && snapshotMapType(snap) !== "parent") {
      return { ...snap, mapType: "parent" };
    }
    return snap;
  }, []);

  // ── Carga inicial: listar mapas → abrir el recordado o el más reciente ──────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listMaps();
        if (cancelled) return;
        setMaps(list);
        void refreshShares(); // marca en la lista los mapas ya compartidos
        if (list.length === 0) {
          // Sin mapas: NO mostramos ningún mapa (ni uno de ejemplo). La UI enseña
          // el estado vacío con la acción de crear el primero; no se auto-crea nada.
          setActiveSnapshot(null);
          setActiveName("");
        } else {
          const remembered = readLastId();
          const pick = (remembered && list.find((m) => m.id === remembered)) || list[0];
          const snap = await fetchSnapshot(pick.id);
          if (cancelled) return;
          applyActive(pick.id, pick.name, snap, pick.version, pick.readOnly);
        }
        readyRef.current = true; // a partir de aquí se habilita el guardado
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        // Falla de carga: estado vacío (no inventamos un mapa de ejemplo).
        setLoadError(err);
        setActiveSnapshot(null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Carga única al montar (sin dependencias).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Cadencia de versiones: crea un SNAPSHOT del estado actual ────────────────
  // Reusa el último contenido persistido + la versión actual (optimistic locking).
  // `config.createSnapshot` hace que el Document service guarde una VERSIÓN nativa.
  const snapshotSave = useCallback(async () => {
    const id = activeIdRef.current;
    const version = versionRef.current;
    const json = lastSavedRef.current;
    if (!id || !version || !json) return;
    if (readOnlyRef.current) return;
    if (!snapshotPendingRef.current) return; // nada nuevo que versionar
    snapshotPendingRef.current = false;
    const content = blob(json);
    try {
      const r = await documentsClient.updateDocument({
        id,
        optimisticLockingVersion: version,
        body: { content },
        createSnapshot: true,
      });
      if (activeIdRef.current === id) versionRef.current = r.documentMetadata.version;
    } catch {
      try {
        const meta = await documentsClient.getDocumentMetadata({ id });
        // Si la versión avanzó, OTRO cliente escribió después de nosotros (mapa
        // compartido). Nuestro contenido ya es viejo: NO lo re-imponemos (antes
        // este reintento pisaba el trabajo del colaborador sin que nadie tocara
        // nada). El snapshot queda pendiente y saldrá del próximo guardado.
        if (meta.version !== version) {
          snapshotPendingRef.current = true;
          return;
        }
        // Misma versión → el fallo fue transitorio: reintento UNA vez.
        const r = await documentsClient.updateDocument({
          id,
          optimisticLockingVersion: meta.version,
          body: { content },
          createSnapshot: true,
        });
        if (activeIdRef.current === id) versionRef.current = r.documentMetadata.version;
      } catch {
        // Si no se pudo, queda pendiente para el próximo asentamiento.
        snapshotPendingRef.current = true;
      }
    }
  }, []);

  // ── Persistencia del mapa activo (solo UPDATE con optimistic locking) ───────
  // Los mapas se crean de forma EXPLÍCITA ("Crear un mapa" / Importar). Aquí solo
  // se actualiza el activo: sin id+versión no hay nada que guardar (no se auto-crea).
  const persist = useCallback(async (json: string) => {
    const id = activeIdRef.current;
    const version = versionRef.current;
    if (!id || !version) return;
    if (readOnlyRef.current) return; // mapa de solo lectura: no insistir
    // Tope de tamaño del documento: avisamos en vez de tragarnos el fallo backend.
    if (json.length > MAX_DOC_BYTES) {
      if (activeIdRef.current === id) setSaveState("error");
      return;
    }
    setSaveState("saving");
    const content = blob(json);
    try {
      try {
        const r = await documentsClient.updateDocument({
          id,
          optimisticLockingVersion: version,
          body: { content },
        });
        if (activeIdRef.current === id) versionRef.current = r.documentMetadata.version;
      } catch (inner) {
        // Sin permiso de escritura: no reintentar (es un mapa de solo lectura).
        if (isForbidden(inner)) throw inner;
        // Conflicto de versión u otro error transitorio: refrescamos versión y
        // reintentamos UNA vez (último-en-escribir gana).
        const meta = await documentsClient.getDocumentMetadata({ id });
        const r = await documentsClient.updateDocument({
          id,
          optimisticLockingVersion: meta.version,
          body: { content },
        });
        if (activeIdRef.current === id) versionRef.current = r.documentMetadata.version;
      }
      // Solo confirmamos el guardado si el mapa SIGUE siendo el activo: evita
      // marcar "guardado" o pisar la línea base de OTRO mapa al que ya cambiamos.
      if (activeIdRef.current === id) {
        lastSavedRef.current = json;
        if (pendingJsonRef.current === json) pendingJsonRef.current = null;
        setSaveState("saved");
        // Cadencia de versiones: marca cambios y reinicia el timer de "asentamiento"
        // (3 min sin cambios → 1 snapshot del estado actual).
        snapshotPendingRef.current = true;
        if (snapshotTimer.current) clearTimeout(snapshotTimer.current);
        snapshotTimer.current = setTimeout(() => void snapshotSave(), SNAPSHOT_IDLE_MS);
      }
    } catch (err) {
      if (isForbidden(err)) {
        // Mapa de solo lectura: dejamos de intentar y avisamos (no rojo de error).
        readOnlyRef.current = true;
        if (activeIdRef.current === id) {
          setReadOnly(true);
          setSaveState("readonly");
        }
      } else if (activeIdRef.current === id) {
        setSaveState("error");
        // Reintento automático: antes el contenido pendiente quedaba varado
        // (solo se rescataba con otra edición o cambiando de mapa). Reintenta
        // a los 30 s mientras el mapa siga activo y el cambio siga pendiente.
        if (!timerRef.current && pendingJsonRef.current) {
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            const pj = pendingJsonRef.current;
            if (pj && activeIdRef.current === id && !readOnlyRef.current) void persist(pj);
          }, SAVE_RETRY_MS);
        }
      }
    }
  }, [snapshotSave]);

  // Vacía cualquier guardado encolado ANTES de cambiar de mapa, para no perder
  // el último cambio del mapa que se está dejando (el timer se cancelaría si no).
  const flushPending = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pj = pendingJsonRef.current;
    // No vaciamos pendingJsonRef aquí: persist lo limpia SOLO si logró escribir.
    // Si falla, el contenido queda referenciado (reintento) y el estado de error
    // no se pierde en silencio.
    if (pj && pj !== lastSavedRef.current && !readOnlyRef.current) {
      await persist(pj);
    }
  }, [persist]);

  // ── API pública: guardar (debounced + dedupe por contenido) ─────────────────
  const save = useCallback(
    (snap: MapSnapshot) => {
      if (!readyRef.current || switchingRef.current) return;
      if (!activeIdRef.current) return; // sin mapa activo no se persiste (se crean explícitamente)
      if (readOnlyRef.current) return; // mapa de solo lectura: no se guarda
      const json = serialize(snap);
      if (json === lastSavedRef.current) return; // nada cambió en la topología
      pendingJsonRef.current = json;
      if (timerRef.current) clearTimeout(timerRef.current);
      // Ata el guardado al mapa que lo originó: si al disparar el timer el mapa
      // activo ya es OTRO, se descarta (evita escribir A dentro de B).
      const idAtSchedule = activeIdRef.current;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (activeIdRef.current !== idAtSchedule) return;
        void persist(json);
      }, SAVE_DEBOUNCE_MS);
    },
    [persist],
  );

  // ── Abrir otro mapa ─────────────────────────────────────────────────────────
  // Devuelve true si el mapa se abrió; false si falló (p. ej. un enlace a un mapa
  // sin acceso o inexistente) — el llamador puede así avisar. Los llamadores que
  // ignoran el valor siguen funcionando igual.
  const openMap = useCallback(
    async (id: string): Promise<boolean> => {
      if (id === activeIdRef.current) return true;
      // Bloquea nuevos guardados YA: durante el await del flush el usuario aún
      // puede editar y eso encolaría un save del mapa viejo que dispararía
      // DESPUÉS del cambio (escribiría A dentro de B).
      switchingRef.current = true;
      // Token de secuencia: con dos clics rápidos gana el ÚLTIMO mapa pedido
      // (antes podía "ganar" el fetch lento del primero y pisar al segundo).
      const seq = ++openSeqRef.current;
      try {
        await flushPending(); // guarda el último cambio del mapa actual antes de salir
        const meta = await documentsClient.getDocumentMetadata({ id });
        const snap = await fetchSnapshot(id);
        if (seq !== openSeqRef.current) return true; // llegó otro openMap: ese manda
        const ro = !hasWrite(meta.access);
        applyActive(id, meta.name, snap, meta.version, ro);
        setSaveState(ro ? "readonly" : "idle");
        return true;
      } catch (err) {
        setLoadError(err);
        return false;
      } finally {
        if (seq === openSeqRef.current) switchingRef.current = false;
      }
    },
    [applyActive, fetchSnapshot, flushPending],
  );

  // ── Crear un mapa (nuevo en blanco o desde import) y dejarlo activo ──────────
  // `mapType` solo aplica a los mapas en blanco; al importar/duplicar, el tipo lo
  // manda el contenido (el tipo viaja dentro del snapshot y no se puede cambiar).
  const createMap = useCallback(
    async (name: string, content?: MapSnapshot, mapType: MapType = "normal"): Promise<string | null> => {
      // Igual que en openMap: bloquear guardados ANTES del await del flush
      // (cierra la ventana en que un save del mapa viejo caería en el nuevo).
      switchingRef.current = true;
      try {
        await flushPending(); // no pierdas el cambio pendiente del mapa actual
        // Normaliza el contenido (import/duplicado) para que la línea base coincida.
        const snap = content ? normalizeSnapshot(content) : blankSeed(name, mapType);
        const type = snapshotMapType(snap);
        const json = serialize(snap);
        const r = await documentsClient.createDocument({
          body: {
            name,
            // Espejo del tipo en el `type` del documento (ver DOC_TYPE_PARENT):
            // es lo que lee la lista para pintar el ícono de Mapa Padre.
            type: type === "parent" ? DOC_TYPE_PARENT : DOC_TYPE,
            content: blob(json),
          },
        });
        readyRef.current = true;
        applyActive(r.id, name, snap, r.version);
        // Aparición optimista en la lista: cierra la ventana entre crear y refreshList
        // (evita que dos importaciones rápidas del mismo nombre no se "vean" entre sí
        // y salgan ambas sin sufijo "(copia)"). refreshList luego reconcilia.
        setMaps((prev) =>
          prev.some((m) => m.id === r.id)
            ? prev
            : [{ id: r.id, name, version: r.version, mapType: type, readOnly: false }, ...prev],
        );
        await refreshList();
        return r.id;
      } catch (err) {
        setLoadError(err);
        return null;
      } finally {
        switchingRef.current = false;
      }
    },
    [applyActive, refreshList, flushPending],
  );

  // ── Renombrar (metadata, sin tocar contenido) ───────────────────────────────
  const renameMap = useCallback(
    async (id: string, name: string) => {
      const clean = name.trim();
      if (!clean) return;
      try {
        const meta = await documentsClient.getDocumentMetadata({ id });
        const r = await documentsClient.updateDocument({
          id,
          optimisticLockingVersion: meta.version,
          body: { name: clean },
        });
        if (id === activeIdRef.current) {
          versionRef.current = r.documentMetadata.version;
          setActiveName(clean);
        }
        await refreshList();
      } catch (err) {
        setLoadError(err);
      }
    },
    [refreshList],
  );

  // ── Convertir un mapa normal en Mapa Padre (UN solo sentido, irreversible) ──
  // Cambia el tipo DENTRO del snapshot (el canónico) y su espejo en el `type`
  // del documento, sobre el MISMO documento: conserva id, URL, compartidos e
  // historial. No hay conversión de vuelta por diseño; fetchSnapshot refuerza
  // el tipo del documento sobre el contenido para que restaurar una versión
  // vieja no "des-convierta" el mapa.
  const convertToParent = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        // Asienta lo pendiente del mapa activo antes de releer su contenido.
        if (activeIdRef.current === id) await flushPending();
        const snap = await fetchSnapshot(id);
        if (snapshotMapType(snap) === "parent") return true; // ya es padre
        const next: MapSnapshot = { ...snap, mapType: "parent" };
        const json = serialize(next);
        const meta = await documentsClient.getDocumentMetadata({ id });
        const r = await documentsClient.updateDocument({
          id,
          optimisticLockingVersion: meta.version,
          body: { type: DOC_TYPE_PARENT, content: blob(json) },
        });
        setMaps((prev) =>
          prev.map((m) => (m.id === id ? { ...m, mapType: "parent", version: r.documentMetadata.version } : m)),
        );
        if (activeIdRef.current === id) {
          versionRef.current = r.documentMetadata.version;
          lastSavedRef.current = json;
          pendingJsonRef.current = null;
          setActiveSnapshot(next); // re-hidrata el lienzo ya como Mapa Padre
        }
        return true;
      } catch {
        // Sin permiso de escritura (mapa compartido en solo lectura) o conflicto:
        // el caller muestra el aviso; no se cambia nada local.
        return false;
      }
    },
    [fetchSnapshot, flushPending],
  );

  // ── Enviar a la papelera (recuperable; siempre tras confirmación en la UI) ───
  const deleteMap = useCallback(
    async (id: string) => {
      try {
        const meta = await documentsClient.getDocumentMetadata({ id });
        await documentsClient.deleteDocument({ id, optimisticLockingVersion: meta.version });
        const remaining = await listMaps();
        setMaps(remaining);
        if (id === activeIdRef.current) {
          if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
          }
          pendingJsonRef.current = null;
          if (remaining.length > 0) {
            await openMap(remaining[0].id);
          } else {
            // No quedan mapas: estado vacío (no recreamos un mapa de ejemplo).
            activeIdRef.current = null;
            versionRef.current = null;
            lastSavedRef.current = null;
            readOnlyRef.current = false;
            setReadOnly(false);
            setActiveId(null);
            setActiveName("");
            setActiveSnapshot(null);
          }
        }
      } catch (err) {
        setLoadError(err);
      }
    },
    [listMaps, openMap],
  );

  // ── Duplicar: clona el contenido de un mapa en uno nuevo (queda activo) ──────
  const duplicateMap = useCallback(
    async (id: string, newName: string): Promise<string | null> => {
      try {
        const snap = await fetchSnapshot(id);
        return await createMap(newName, snap);
      } catch (err) {
        setLoadError(err);
        return null;
      }
    },
    [fetchSnapshot, createMap],
  );

  // ── Papelera: listar mapas borrados (la plataforma los conserva 30 días) ─────
  const loadTrash = useCallback(async (): Promise<TrashedMap[]> => {
    // Dos types (ver DOC_TYPE_PARENT): la papelera cubre ambos.
    const lists = await Promise.all(
      [DOC_TYPE, DOC_TYPE_PARENT].map((docType) =>
        trashClient.listTrashedDocuments({ filter: `type == '${docType}'`, pageSize: 100 }),
      ),
    );
    return lists
      .flatMap((l) => l.documents)
      .map((d) => {
        const dt: unknown = d.deletionInfo?.deletedTime;
        const deletedTime = dt instanceof Date ? dt.toISOString() : typeof dt === "string" ? dt : "";
        return { id: d.id, name: d.name, deletedTime };
      })
      .sort((a, b) => b.deletedTime.localeCompare(a.deletedTime)); // más recientes primero
  }, []);

  // Restaurar un mapa de la papelera → reaparece en la lista con sus accesos.
  const restoreMap = useCallback(
    async (id: string) => {
      await trashClient.restoreTrashedDocument({ id });
      await refreshList();
    },
    [refreshList],
  );

  // Descarta el guardado encolado (timer + contenido pendiente) SIN escribirlo.
  // Se usa antes de Restaurar una versión: un autosave en cola con el contenido
  // pre-restauración dispararía después y desharía la restauración.
  const cancelPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingJsonRef.current = null;
  }, []);

  // Re-hidrata el mapa activo desde el backend (tras Restaurar una versión, que
  // cambia el documento del lado del servidor). Salta el guard de "mismo id" de openMap.
  const reloadActive = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id) return;
    const snap = await fetchSnapshot(id);
    const meta = await documentsClient.getDocumentMetadata({ id });
    applyActive(id, meta.name, snap, meta.version, !hasWrite(meta.access));
  }, [fetchSnapshot, applyActive]);

  // Limpieza de timers pendientes al desmontar.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (snapshotTimer.current) clearTimeout(snapshotTimer.current);
    },
    [],
  );

  return {
    maps,
    activeId,
    activeName,
    activeSnapshot,
    loading,
    loadError,
    saveState,
    readOnly,
    sharedIds,
    refreshShares,
    save,
    openMap,
    createMap,
    duplicateMap,
    renameMap,
    convertToParent,
    deleteMap,
    loadTrash,
    restoreMap,
    reloadActive,
    cancelPending,
    loadSnapshot: fetchSnapshot,
  };
};
