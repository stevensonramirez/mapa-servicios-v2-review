import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  ConnectionMode,
  EdgeLabelRenderer,
  useInternalNode,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from "@xyflow/react";
import type { Connection, Edge, Node, Viewport, IsValidConnection } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { format, units } from "@dynatrace-sdk/units";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { Button } from "@dynatrace/strato-components/buttons";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import {
  CloseSidebarIcon,
  OpenSidebarIcon,
  SettingIcon,
  UndoIcon,
  RedoIcon,
  WorkflowSimpleIcon,
  LockIcon,
  PlusIcon,
  UploadIcon,
  EditIcon,
  CheckmarkIcon,
  DeleteIcon,
  SyncIcon,
  AiIcon,
  WarningIcon,
} from "@dynatrace/strato-icons";
import { CloudCheckIcon } from "./CloudCheckIcon";
import {
  SeverityNode,
  DEFAULT_CONN_RED_AT,
  clampConnRedAt,
  nodeStatusSource,
  submapSeverity,
  SUBMAP_ICON_ID,
} from "./SeverityNode";
import { DEFAULT_SUBMAP_METRIC, DEFAULT_SUBMAP_RULES } from "./submapRules";
import type { SeverityNodeData, Severity } from "./SeverityNode";
import { useSubmapStatus } from "./useSubmapStatus";
import { LabelNode } from "./LabelNode";
import type { LabelNodeData } from "./LabelNode";
import { ImageNode } from "./ImageNode";
import type { ImageNodeData } from "./ImageNode";
import { GroupNode, GROUP_DEFAULT_W, GROUP_DEFAULT_H, GROUP_MIN_W, GROUP_MIN_H } from "./GroupNode";
import type { GroupNodeData } from "./GroupNode";
import { NodeEditorModal } from "./NodeEditorModal";
import { WhyModal } from "./WhyModal";
import { EdgeEditorModal } from "./EdgeEditorModal";
import type { EdgeData } from "./EdgeEditorModal";
import { MapEdge } from "./MapEdge";
import { sideAnchor, slotOffset, computeBend } from "./edgeRouting";
import type { Box } from "./edgeRouting";
import { LabelUiContext } from "./labelUi";
import { PopUiContext } from "./popUi";
import { ConfirmDialog } from "./ConfirmDialog";
import { SettingsModal } from "./SettingsModal";
import { ZoomControls } from "./ZoomControls";
import { MapSidebar, SUBMAP_DND_MIME } from "./MapSidebar";
import { loadMapDoc, isNestableChild } from "./submapDocs";
import { VersionHistory } from "./VersionHistory";
import { MapActionsMenu } from "./MapActionsMenu";
import { AddMenu } from "./AddMenu";
import { TrashModal } from "./TrashModal";
import { ShareModal } from "./ShareModal";
import { ExportModal } from "./ExportModal";
import { NodeStatusProbe, DEFAULT_NODE_DQL, usePageVisible, DqlValueProbe } from "./nodeStatus";
import { useDavisStatus, useEntityMetadata } from "./useDavisStatus";
import { useEntityRelations } from "./useEntityRelations";
import { TopologyModal } from "./TopologyModal";
import type { TopologySuggestion } from "./TopologyModal";
import { RelatedPopover } from "./RelatedPopover";
import type { EntityRef } from "./entityModel";
import { entityTypeOf } from "./entityModel";
import { cleanSnapshot, snapshotMapType, orderNodesForFlow } from "./useMapPersistence";
import type { MapSnapshot, MapType } from "./useMapPersistence";
import { useMapLibraryContext } from "./mapLibraryContext";
import { corexDql } from "./mapSeed";
import { MapSettingsContext, DEFAULT_SETTINGS, DEFAULT_GLOW, clampParentRefresh } from "./mapSettings";
import type { MapSettings } from "./mapSettings";
import "./map.css";
import { useT } from "../i18n";
import { RootCauseLegend } from "./RootCauseLegend";
import { invalidReasonText } from "./invalidMapText";
import { RootCauseModal } from "./RootCauseModal";
import { analyzeRootCause, rcMarksByNode, rcProblemIds, RcError, rcSubId, rcSplitId, rcLocalId, rcChildView } from "./rootCause";
import type { RcStage, RcNodeInput, RcEdgeInput, RcAnalysis } from "./rootCause";

// nodeTypes estable (constante de módulo): evita que reactflow desmonte/remonte
// los nodos en cada render.
const nodeTypes = { severity: SeverityNode, label: LabelNode, image: ImageNode, group: GroupNode };

// edgeTypes estable (constante de módulo): raya custom FLOTANTE — se ancla al borde
// del nodo que mira al otro, así no pasa por detrás de los nodos que conecta.
const edgeTypes = { severity: MapEdge };

// Popup flotante "Editar" para una RAYA: aparece al SELECCIONAR la conexión (clic),
// no en hover. Pulsar "Editar" abre el editor de la raya. Se renderiza dentro de
// <ReactFlow> vía EdgeLabelRenderer (capa transformada con el viewport), posicionado
// en el punto medio entre los centros de los nodos origen/destino (se recalcula al
// arrastrar). No toca MapEdge (preserva su React.memo y la perf del arrastre).
const EdgePopup = ({
  edge,
  onEdit,
  label,
}: {
  edge: Edge;
  onEdit: (id: string) => void;
  label: string;
}) => {
  const s = useInternalNode(edge.source);
  const tn = useInternalNode(edge.target);
  if (!s || !tn) return null;
  const sx = s.internals.positionAbsolute.x + (s.measured?.width ?? 0) / 2;
  const sy = s.internals.positionAbsolute.y + (s.measured?.height ?? 0) / 2;
  const tx = tn.internals.positionAbsolute.x + (tn.measured?.width ?? 0) / 2;
  const ty = tn.internals.positionAbsolute.y + (tn.measured?.height ?? 0) / 2;
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  return (
    <EdgeLabelRenderer>
      <div
        className="mapa-edge-popup nodrag nopan nowheel"
        style={{ transform: `translate(-50%, -50%) translate(${mx}px, ${my}px)` }}
      >
        <div className="mapa-label-toolbar">
          <button type="button" className="mapa-label-editbtn" onClick={() => onEdit(edge.id)}>
            <EditIcon size={14} />
            <span>{label}</span>
          </button>
        </div>
      </div>
    </EdgeLabelRenderer>
  );
};

// Historial deshacer/rehacer: misma serialización limpia que usa la persistencia
// (sin color volátil), para que un refresco de severidad no cuente como cambio.
const serializeSnap = (s: MapSnapshot): string => JSON.stringify(cleanSnapshot(s));
const HISTORY_LIMIT = 60;
const HISTORY_DEBOUNCE_MS = 600;

// Ancho de la barra lateral (ajustable, persistido). Y umbral para pasar la
// barra de controles a modo solo-íconos cuando hay poco espacio.
const SIDEBAR_WIDTH_KEY = "mapa-servicios-v2:sidebarWidth";
const SIDEBAR_MIN = 210;
const SIDEBAR_MAX = 520;
const SIDEBAR_DEFAULT = 280;
const TOOLBAR_COMPACT_BELOW = 720;

// Tope de probes de DQL ACTIVOS a la vez (red de seguridad contra mapas enormes
// importados: cientos de DQL únicos = cientos de useDql en polling, que queman
// budget de Grail y congelan el navegador). Cuenta DQL ÚNICOS, no nodos; si
// varios nodos comparten DQL, cuenta como uno. Lo que pasa del tope queda en gris
// con un aviso. Subir/bajar SOLO aquí. La pausa por pestaña oculta y el arranque
// escalonado viven en nodeStatus.tsx.
const MAX_ACTIVE_PROBES = 80;

const readSidebarWidth = (): number => {
  try {
    const v = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return v >= SIDEBAR_MIN && v <= SIDEBAR_MAX ? v : SIDEBAR_DEFAULT;
  } catch {
    return SIDEBAR_DEFAULT;
  }
};

// Vista inicial anclada al borde superior-izquierdo y límite de paneo: solo se
// puede bajar / ir a la derecha, nunca por encima ni a la izquierda del inicio.
const DEFAULT_VIEWPORT = { x: 24, y: 80, zoom: 0.8 };
// Límites del área navegable (pan). Amplios a propósito: fitView ("Ajustar a la
// vista") es un cambio PROGRAMÁTICO de viewport y NO respeta este extent (d3-zoom
// solo restringe los gestos del usuario) — con el límite apretado de antes
// ([-30,-100]→[6000,4000]), tras "Ajustar a la vista" el viewport quedaba FUERA
// del área permitida y el siguiente gesto (arrastrar/panear) lo "corregía" de
// golpe → salto violento de toda la vista (bug real reportado con la imagen de
// fondo). Se mantiene finito (no Infinity) solo como red para no perderse
// paneando al vacío; debe ser MUY holgado respecto a cualquier encuadre posible.
const TRANSLATE_EXTENT: [[number, number], [number, number]] = [
  [-8000, -8000],
  [24000, 16000],
];

// Rejilla del lienzo: el paso de los punticos del fondo = el paso al que se
// "encajan" las cajitas al arrastrarlas (snap), para que todo quede alineado y
// evitar mapas desordenados. Un solo valor para que dots y snap nunca se separen.
const GRID_SIZE = 24;
const SNAP_GRID: [number, number] = [GRID_SIZE, GRID_SIZE];

// Zoom/encuadre: se recuerda el último viewport (x, y, zoom) POR MAPA en
// localStorage (best-effort, sin scope extra). Antes la llave era GLOBAL y al
// recargar se aplicaba el paneo del último mapa visitado, dejando el contenido
// del mapa abierto fuera de cuadro. Sin viewport recordado para el mapa → se
// encuadra el contenido con fitView (ver la hidratación).
const VIEWPORT_KEY = "mapa-servicios-v2:viewport";
const viewportKey = (mapId: string) => `${VIEWPORT_KEY}:${mapId}`;
const readViewport = (mapId: string | null): Viewport | null => {
  try {
    const raw = mapId ? localStorage.getItem(viewportKey(mapId)) : null;
    if (raw) {
      const v = JSON.parse(raw) as Partial<Viewport>;
      if (typeof v.x === "number" && typeof v.y === "number" && typeof v.zoom === "number" && v.zoom > 0) {
        return { x: v.x, y: v.y, zoom: v.zoom };
      }
    }
  } catch {
    /* sandbox sin localStorage o JSON inválido → sin viewport recordado */
  }
  return null;
};
const writeViewport = (mapId: string, v: Viewport) => {
  try {
    localStorage.setItem(viewportKey(mapId), JSON.stringify(v));
  } catch {
    /* sandbox sin localStorage */
  }
};

// Análisis de causa raíz ya vistos como TODO resuelto en este navegador (por
// executionId). Un problema cerrado no se reabre en Davis, así que no hace falta
// volver a consultar su estado: la consulta va desde la hora del análisis y se
// encarece con los días (~150 MB por día de antigüedad). Misma raíz de llave que
// el viewport, así staging y prod no se mezclan.
const RC_RESOLVED_KEY = VIEWPORT_KEY.replace(/:viewport$/, ":rcResolved");
const readRcResolved = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(RC_RESOLVED_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return []; // sandbox sin localStorage o JSON inválido → se consulta normal
  }
};
const rememberRcResolved = (executionId: string) => {
  try {
    const cur = readRcResolved().filter((x) => x !== executionId);
    cur.push(executionId);
    localStorage.setItem(RC_RESOLVED_KEY, JSON.stringify(cur.slice(-200)));
  } catch {
    /* sandbox sin localStorage */
  }
};

// ¿El arrastre trae un mapa de la lista? (MIME propio, ver MapSidebar.)
const dragHasMap = (e: React.DragEvent): boolean =>
  Array.from(e.dataTransfer.types).includes(SUBMAP_DND_MIME);

const sevColor = (s: Severity): string =>
  s === 2 ? "var(--sev-err)" : s === 1 ? "var(--sev-warn)" : s === 0 ? "var(--sev-ok)" : "var(--sev-unk)";

// ── Nodo AGRUPADOR (marco contenedor) ────────────────────────────────────────
// Medidas del acomodo automático de los miembros dentro del marco.
const GROUP_PAD = 24; // margen interno (izq/der/abajo)
const GROUP_TOP = 40; // margen superior: deja aire para la píldora del título
const GROUP_GAP = 16; // separación entre miembros
// Tamaño supuesto de un nodo que ReactFlow todavía no ha medido (recién creado).
const NODE_FALLBACK_W = 214;
const NODE_FALLBACK_H = 64;

// Ancho/alto de un nodo tal como se ve en el lienzo. Para el agrupador, el
// tamaño vive en `width`/`height` en la RAÍZ del nodo: es lo que React Flow usa
// para dimensionar el contenedor, lo que escribe la manija de redimensionado y
// lo que persiste cleanSnapshot. UNA sola fuente de verdad.
const nodeSize = (n: Node): { w: number; h: number } => {
  if (n.type === "group") {
    return {
      w: n.measured?.width ?? n.width ?? GROUP_DEFAULT_W,
      h: n.measured?.height ?? n.height ?? GROUP_DEFAULT_H,
    };
  }
  return { w: n.measured?.width ?? NODE_FALLBACK_W, h: n.measured?.height ?? NODE_FALLBACK_H };
};

// Rectángulo que ocupan los miembros de un agrugador, en coordenadas del marco
// (relativas). Es el piso del redimensionado: achicar por debajo de esto dejaría
// nodos por fuera del marco.
const membersExtent = (nds: Node[], groupId: string): { w: number; h: number } => {
  let w = 0;
  let h = 0;
  nds.forEach((n) => {
    if (n.parentId !== groupId) return;
    const s = nodeSize(n);
    w = Math.max(w, n.position.x + s.w);
    h = Math.max(h, n.position.y + s.h);
  });
  return { w: w > 0 ? w + GROUP_PAD : 0, h: h > 0 ? h + GROUP_PAD : 0 };
};

// Posición ABSOLUTA de cada nodo. Los miembros de un agrupador guardan su
// posición RELATIVA al marco (regla de los subflujos de React Flow), así que
// para cualquier cálculo geométrico (puertos de las rayas, evasión, adopción)
// hay que sumarles la del padre. Los agrupadores nunca se anidan y van SIEMPRE
// antes que sus miembros en el arreglo, así que una sola pasada alcanza.
const absolutePositions = (nodes: Node[]): Map<string, { x: number; y: number }> => {
  const out = new Map<string, { x: number; y: number }>();
  nodes.forEach((n) => {
    const p = n.parentId ? out.get(n.parentId) : undefined;
    out.set(n.id, p ? { x: p.x + n.position.x, y: p.y + n.position.y } : n.position);
  });
  return out;
};

// Acomodo AUTOMÁTICO de los miembros de un agrupador: cuadrícula simple, filas de
// izquierda a derecha, y el marco crece lo necesario para contenerlos (nunca por
// debajo del tamaño por defecto). Función PURA y DETERMINISTA: el orden de las
// celdas es el orden actual de los nodos en el arreglo. Devuelve el MISMO arreglo
// si no hay nada que mover (evita re-renders y pasos de deshacer vacíos).
const layoutGroupMembers = (nds: Node[], groupId: string): Node[] => {
  const group = nds.find((n) => n.id === groupId);
  if (!group || group.type !== "group") return nds;
  const members = nds.filter((n) => n.parentId === groupId);
  const cur = nodeSize(group);
  // Ancho útil de una fila: el del marco tal como está hoy (si el usuario lo
  // ensanchó a mano, caben más por fila), o el del miembro más ancho si alguno
  // no cabe (un nodo nunca se recorta).
  const innerW = members.reduce((m, n) => Math.max(m, nodeSize(n).w), cur.w - GROUP_PAD * 2);
  const pos = new Map<string, { x: number; y: number }>();
  let rowX = 0;
  let rowY = 0;
  let rowH = 0;
  let widest = 0;
  members.forEach((m) => {
    const { w, h } = nodeSize(m);
    if (rowX > 0 && rowX + w > innerW) {
      rowY += rowH + GROUP_GAP;
      rowX = 0;
      rowH = 0;
    }
    pos.set(m.id, { x: GROUP_PAD + rowX, y: GROUP_TOP + rowY });
    rowX += w + GROUP_GAP;
    rowH = Math.max(rowH, h);
    widest = Math.max(widest, rowX - GROUP_GAP);
  });
  // El marco solo CRECE: nunca se achica por debajo de su tamaño actual (respeta
  // lo que el usuario haya fijado con la manija) ni del tope mínimo.
  const w = Math.max(GROUP_MIN_W, cur.w, widest + GROUP_PAD * 2);
  const h = Math.max(GROUP_MIN_H, cur.h, GROUP_TOP + rowY + rowH + GROUP_PAD);
  let changed = false;
  const next = nds.map((n) => {
    if (n.id === groupId) {
      if (n.width === w && n.height === h) return n;
      changed = true;
      return { ...n, width: w, height: h };
    }
    const p = pos.get(n.id);
    if (!p || (n.position.x === p.x && n.position.y === p.y)) return n;
    changed = true;
    return { ...n, position: p };
  });
  return changed ? next : nds;
};

const MapCanvasInner = () => {
  const t = useT();
  const theme = useCurrentTheme();
  // ¿Pestaña visible? Si no, los probes de DQL se pausan (cuida budget de Grail).
  const pageVisible = usePageVisible();
  // Instancia de ReactFlow: fitView (tras "Reorganizar") + setViewport (resetear la
  // vista a la esquina superior izquierda al crear/abrir un mapa vacío).
  const { fitView, setViewport, screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  // Editor abierto: el nodo / la raya cuyo modal de edición está visible. Ya NO se
  // abre con un clic directo, sino con el botón "Editar" del popup flotante.
  const [editorNodeId, setEditorNodeId] = useState<string | null>(null);
  // Nodo cuya burbuja "¿Por qué?" (detalle del estado) está abierta. null = cerrada.
  const [whyNodeId, setWhyNodeId] = useState<string | null>(null);
  // Análisis de causa raíz: etapa en curso (null = quieto), error visible y causa
  // abierta en el modal ({ n, nodeId } del nodo desde el que se abrió, si aplica).
  const [rcBusy, setRcBusy] = useState<RcStage | null>(null);
  const [rcError, setRcError] = useState<string | null>(null);
  const [rcOpen, setRcOpen] = useState<{ n: number; nodeId?: string } | null>(null);
  const rcAbortRef = useRef<AbortController | null>(null);
  // Nodo resaltado por «Ir al nodo» (modal de causa raíz): pulso de ~3 s.
  const [rcFocusId, setRcFocusId] = useState<string | null>(null);
  // Visita a un mapa HIJO desde el análisis de un Mapa Padre («Ir al nodo» sobre
  // un nodo que vive dentro del hijo): mientras dure, el hijo muestra las marcas
  // del análisis del padre (de paso, no se guardan en el hijo) y un aviso con
  // «← Volver». `pending` = nodo al que hay que viajar cuando cargue el mapa.
  const [rcVisit, setRcVisit] = useState<{
    parentId: string;
    parentName: string;
    host: string; // nodo sub-mapa del padre que representa al hijo
    childId: string;
    analysis: RcAnalysis; // análisis ORIGINAL del padre
  } | null>(null);
  const rcPendingRef = useRef<{ mapId: string; nodeId: string } | null>(null);
  const [editorEdgeId, setEditorEdgeId] = useState<string | null>(null);
  // Raya "fijada" (seleccionada con un clic): controla el popup flotante de "Editar"
  // de las conexiones. Los nodos usan su propio `selected`.
  const [pinnedEdgeId, setPinnedEdgeId] = useState<string | null>(null);
  // Título (label) que está en modo edición markdown (UI efímera, no se persiste).
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "node" | "edge" | "map"; id: string } | null>(null);
  // Mapa a convertir en Mapa Padre (confirmación aparte: no es un borrado).
  const [convertTarget, setConvertTarget] = useState<{ id: string; name: string } | null>(null);
  const [settings, setSettings] = useState<MapSettings>(DEFAULT_SETTINGS);
  // Tipo del mapa abierto. Se fija al crearlo y NO se puede cambiar; aquí solo se
  // hidrata del documento para que viaje de vuelta en cada guardado.
  const [mapType, setMapType] = useState<MapType>("normal");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [trashOpen, setTrashOpen] = useState(false);
  // Vista previa de una versión del historial: carga esa versión en el lienzo SIN
  // guardar (previewRef bloquea el autosave). Al salir, se re-hidrata el mapa real.
  const [previewLabel, setPreviewLabel] = useState<string | null>(null);
  const previewRef = useRef(false);

  // Exportar JSON en Safari/WebKit: como el iframe no descarga archivos, abrimos un
  // modal con el JSON para copiar/seleccionar. null = cerrado. Ver downloadSnapshot.
  const [exportData, setExportData] = useState<{ json: string; filename: string } | null>(null);
  const [shareTarget, setShareTarget] = useState<{ id: string; name: string } | null>(null);
  // Modal global "Sugerir conexiones" (topología real): abierto/cerrado.
  const [topologyOpen, setTopologyOpen] = useState(false);
  // Nodo cuyo popover "Relacionados" está abierto. null = cerrado. Al estar
  // abierto, se resaltan en el lienzo los nodos ya conectados por topología real.
  const [relatedNodeId, setRelatedNodeId] = useState<string | null>(null);
  // Agrupador que acaba de adoptar/liberar un nodo: su marco destella un momento.
  const [flashGroupId, setFlashGroupId] = useState<string | null>(null);
  // Agrupador sobre el que está pasando el nodo que se arrastra: se resalta el
  // marco COMPLETO para que se vea claro quién lo va a recibir. null = ninguno.
  const [hoverGroupId, setHoverGroupId] = useState<string | null>(null);
  // "Tira y afloje" al arrastrar un MIEMBRO hacia afuera de su marco: dentro del
  // umbral el marco lo retiene (y al soltar lo devuelve al borde más cercano);
  // pasado el umbral, lo suelta. `mode` alimenta el feedback visual del marco.
  const [pullState, setPullState] = useState<{ id: string; mode: "hold" | "free" } | null>(null);
  // Cajas de los agrupadores, calculadas UNA vez al empezar el arrastre. onNodeDrag
  // dispara en cada frame: aquí no se recorre el arreglo de nodos ni se recalcula
  // nada, solo se prueba el centro contra estas cajas ya listas.
  const dragBoundsRef = useRef<Array<{ id: string; x: number; y: number; w: number; h: number }>>([]);
  // Miembros que están "aterrizando" en su celda: transición suave del transform.
  const [settleIds, setSettleIds] = useState<string[]>([]);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Animación de adopción/liberación: destello del marco (~600 ms) + llegada suave
  // de los miembros a su celda (~250 ms). Las clases son TEMPORALES: se quitan al
  // terminar para no interferir con el arrastre normal (ReactFlow mueve por transform).
  const pulseGroup = useCallback((groupId: string, memberIds: string[]) => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    setFlashGroupId(groupId);
    setSettleIds(memberIds);
    flashTimerRef.current = setTimeout(() => setFlashGroupId(null), 600);
    settleTimerRef.current = setTimeout(() => setSettleIds([]), 320);
  }, []);

  // Modo edición de imagen de fondo: permite mover y redimensionar la imagen.
  const [imageEditMode, setImageEditMode] = useState(false);
  // Bloqueo de relación de aspecto al redimensionar (activo por defecto).
  const [keepAspect, setKeepAspect] = useState(true);
  // Ref del input file oculto para seleccionar imagen.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const counter = useRef(0);
  // Señal: tras "Reorganizar" hay que reencuadrar el lienzo en el próximo render
  // (cuando los nodos ya tienen su nueva posición). Ver el efecto más abajo.
  const fitAfterOrganizeRef = useRef(false);
  // Viewport recordado POR MAPA: se restaura en la hidratación y se persiste,
  // con debounce, en cada paneo/zoom (rueda, arrastre o botones de zoom). El id
  // del mapa se captura EN EL EVENTO (no al escribir): un paneo pendiente de un
  // mapa no se atribuye al mapa al que acabas de cambiar.
  const vpMapIdRef = useRef<string | null>(null);
  const vpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onViewportChange = useCallback((vp: Viewport) => {
    if (vpTimer.current) clearTimeout(vpTimer.current);
    const id = vpMapIdRef.current;
    if (!id) return;
    vpTimer.current = setTimeout(() => writeViewport(id, vp), 300);
  }, []);
  // Severidad por DQL: un probe corre cada DQL único y reporta aquí su estado.
  const [statusByDql, setStatusByDql] = useState<Record<string, Severity>>({});
  const onStatus = useCallback((dql: string, sev: Severity) => {
    setStatusByDql((prev) => (prev[dql] === sev ? prev : { ...prev, [dql]: sev }));
  }, []);
  // queryId de la última ejecución de cada DQL (de data.metadata.grail.queryId).
  // Con esos ids se busca en la tabla de billing (dt.system.events) cuántos bytes
  // facturó realmente cada consulta. Solo se llena cuando un probe trae un
  // resultado real (guard `if (data)` en NodeStatusProbe).
  const [queryIdByDql, setQueryIdByDql] = useState<Record<string, string>>({});
  const onQueryId = useCallback((dql: string, qid: string | undefined) => {
    if (!qid) return;
    setQueryIdByDql((prev) => (prev[dql] === qid ? prev : { ...prev, [dql]: qid }));
  }, []);
  // VALOR por DQL (chip de las rayas): un probe por DQL de valor único. undefined =
  // aún sin resultado; null = corrió pero no devolvió un número (chip en "—").
  const [valueByDql, setValueByDql] = useState<Record<string, number | null>>({});
  const onValue = useCallback((dql: string, v: number | null) => {
    setValueByDql((prev) => (prev[dql] === v ? prev : { ...prev, [dql]: v }));
  }, []);
  // Ref espejo de statusByDql: al deshacer/rehacer reaplicamos el color actual
  // sin esperar al siguiente refresco de los probes.
  const statusByDqlRef = useRef(statusByDql);
  useEffect(() => {
    statusByDqlRef.current = statusByDql;
  }, [statusByDql]);

  const {
    maps,
    activeId,
    activeName,
    activeSnapshot,
    loading,
    readOnly,
    sharedIds,
    refreshShares,
    save,
    saveState,
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
    loadSnapshot,
    onNewMap,
    onImportClick,
    setNotice,
  } = useMapLibraryContext();
  // Hay un mapa abierto cuando existe como documento (tiene id). Si no, mostramos
  // el estado vacío (entrada por primera vez, o tras borrar el último mapa).
  // Mapa con contenido que NO tiene el formato de la app (validación estricta al
  // leer, ver mapValidation.ts): no se dibuja ni se edita; en su lugar sale el
  // aviso en el área del lienzo y la lista de mapas sigue disponible.
  const mapInvalid = activeSnapshot?.invalid ?? null;
  const hasMap = activeId !== null && !mapInvalid;
  const hydratedSnapRef = useRef<MapSnapshot | null>(null);

  // ── Cadencia de un Mapa Padre ───────────────────────────────────────────────
  // Un Mapa Padre no vive del refresco continuo de un Mapa de Servicio: consulta
  // lo suyo MÁS lo de cada mapa incrustado, así que TODO (DQL de nodos, Davis y
  // la evaluación de los mapas incrustados) se relee de una sola vez cada 5/10
  // minutos, o solo cuando el usuario lo pide. El disparo es este token: los
  // sondeos automáticos de useDql quedan apagados y cada relectura sale de aquí,
  // que es lo que permite mostrar un "Actualizado hace…" que no miente.
  const isParentMap = mapType === "parent";
  const parentRefreshMs = clampParentRefresh(settings.parentRefreshMs);
  const [refreshToken, setRefreshToken] = useState(0);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const refreshNow = useCallback(() => {
    setRefreshToken((v) => v + 1);
    setLastRefreshAt(Date.now());
  }, []);
  // La primera lectura la hacen los hooks al montarse con el mapa: la hora se
  // marca ahí, no en un ciclo que todavía no ha ocurrido.
  useEffect(() => {
    setLastRefreshAt(isParentMap && activeId ? Date.now() : null);
  }, [isParentMap, activeId]);
  // Ciclo automático. Con la pestaña oculta no corre (no se consulta a Grail sin
  // que nadie esté mirando) y en modo Manual no existe.
  useEffect(() => {
    if (!isParentMap || parentRefreshMs <= 0 || !pageVisible) return;
    const id = setInterval(refreshNow, parentRefreshMs);
    return () => clearInterval(id);
  }, [isParentMap, parentRefreshMs, pageVisible, refreshNow]);
  // Reloj del indicador "Actualizado hace X min" (se muestra en minutos, así que
  // repintar cada medio minuto sobra).
  const [refreshClock, setRefreshClock] = useState(() => Date.now());
  useEffect(() => {
    if (!isParentMap) return;
    setRefreshClock(Date.now());
    const id = setInterval(() => setRefreshClock(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [isParentMap, lastRefreshAt]);
  const lastRefreshLabel = useMemo(() => {
    if (lastRefreshAt === null) return t("parent.updatedNever");
    const mins = Math.floor(Math.max(0, refreshClock - lastRefreshAt) / 60_000);
    return mins < 1 ? t("parent.updatedNow") : t("parent.updatedAgo", { n: mins });
  }, [lastRefreshAt, refreshClock, t]);
  // Cadencia efectiva de los sondeos: en un Mapa Padre, 0 (nada automático; todo
  // sale del token de arriba). En un Mapa de Servicio, su ajuste de siempre.
  const probeRefreshMs = isParentMap ? 0 : settings.refreshIntervalMs;
  // Token que se pasa a los hooks: solo tiene sentido en un Mapa Padre.
  const probeToken = isParentMap ? refreshToken : undefined;

  // ── URL por mapa (enlace compartible) ────────────────────────────────────────
  // Cada mapa tiene su propia URL: …/my.mapaservicios/map/<id>. Sincronización en
  // dos sentidos: (1) al abrir/cambiar de mapa, reflejamos su id en la barra de
  // direcciones (para copiar el enlace y enviarlo); (2) al abrir un enlace
  // .../map/<id>, abrimos ESE mapa (aunque el "último abierto" local sea otro). Si
  // no hay acceso → aviso. El permiso lo sigue dando "Compartir" (el enlace es solo
  // el atajo). Guardamos el id ya manejado para no reabrir en bucle.
  const { id: urlMapId } = useParams();
  const navigate = useNavigate();
  const urlHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    // URL → estado: si el enlace trae un id que aún no manejamos, ábrelo.
    if (urlMapId && urlHandledRef.current !== urlMapId) {
      urlHandledRef.current = urlMapId;
      if (urlMapId !== activeId) {
        void openMap(urlMapId).then((ok) => {
          if (!ok) {
            setNotice(t("url.noAccess"));
            // No dejar la URL "mentirosa" apuntando a un mapa que no se abrió,
            // y permitir REINTENTAR el mismo enlace más tarde (p. ej. cuando
            // le den acceso) sin tener que recargar la app.
            urlHandledRef.current = null;
            navigate(activeId ? `/map/${activeId}` : "/", { replace: true });
          }
        });
      }
      return;
    }
    // estado → URL: refleja el mapa activo (o vuelve a "/" en el estado vacío).
    if (activeId) {
      if (urlMapId !== activeId) navigate(`/map/${activeId}`, { replace: true });
    } else if (urlMapId) {
      navigate("/", { replace: true });
    }
  }, [loading, urlMapId, activeId, openMap, navigate, setNotice, t]);

  // Ancho ajustable de la barra lateral (se persiste y se queda donde lo dejes).
  const [sidebarWidth, setSidebarWidth] = useState<number>(readSidebarWidth);
  const sidebarWidthRef = useRef(sidebarWidth);
  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);
  // Limpieza de un arrastre de la barra lateral en curso (por si el componente
  // se desmonta a mitad del drag): guarda el "quitar listeners" para el unmount.
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidthRef.current;
    const onMove = (ev: MouseEvent) =>
      setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + (ev.clientX - startX))));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      dragCleanupRef.current = null;
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidthRef.current));
      } catch {
        /* sandbox sin localStorage */
      }
    };
    dragCleanupRef.current = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // Barra de controles en modo solo-íconos cuando hay poco ancho.
  const topbarRef = useRef<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = topbarRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setCompact(w > 0 && w < TOOLBAR_COMPACT_BELOW);
    });
    ro.observe(el);
    return () => ro.disconnect();
    // Reattach cuando la barra (re)aparece al abrir/crear un mapa.
  }, [hasMap]);

  // Renombrar el mapa activo desde la barra (clic en el nombre).
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  // Enter confirma y el blur posterior re-dispararía commitName (renombrado de
  // red duplicado): este flag corta el segundo disparo.
  const nameCommittedRef = useRef(false);
  const startNameEdit = useCallback(() => {
    if (!activeId) return;
    nameCommittedRef.current = false;
    setNameDraft(activeName);
    setNameEditing(true);
  }, [activeId, activeName]);
  const commitName = useCallback(() => {
    if (nameCommittedRef.current) return;
    nameCommittedRef.current = true;
    const clean = nameDraft.trim();
    if (activeId && clean && clean !== activeName) void renameMap(activeId, clean);
    setNameEditing(false);
  }, [activeId, activeName, nameDraft, renameMap]);

  // ── Historial deshacer/rehacer ──────────────────────────────────────────────
  const histPastRef = useRef<string[]>([]);
  const histFutureRef = useRef<string[]>([]);
  const histBaseRef = useRef<string | null>(null); // último estado confirmado
  const travelingRef = useRef(false); // viajando en el historial (undo/redo/hidratar)
  const recordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Dedup de la imagen de fondo en el historial: la imagen se guarda como base64
  // (hasta ~6.8 MB) dentro del snapshot; sin esto, cada uno de los 60 pasos de
  // deshacer retenía una copia completa (~cientos de MB + jank al serializar).
  // Guardamos cada `src` DISTINTO una sola vez en un mapa lateral de sesión y en
  // el historial dejamos solo una referencia `@img:<hash>`. Típicamente 1–2 srcs.
  const imgSrcMapRef = useRef<Map<string, string>>(new Map());
  // histEncode: como serializeSnap pero reemplazando el src de la imagen por una
  // referencia liviana (registra hash→src). histDecode repone el src real.
  const histEncode = useCallback((snap: MapSnapshot): string => {
    const cleaned = cleanSnapshot(snap);
    const nodes = cleaned.nodes.map((n) => {
      if (n.type !== "image") return n;
      const d = n.data as { src?: unknown } | undefined;
      if (!d || typeof d.src !== "string" || d.src.startsWith("@img:")) return n;
      const src = d.src;
      // Hash barato (no-cripto) + longitud: dos imágenes distintas no colisionan.
      let h = 0;
      for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) | 0;
      const key = `@img:${(h >>> 0).toString(36)}:${src.length}`;
      imgSrcMapRef.current.set(key, src);
      return { ...n, data: { ...d, src: key } };
    });
    return JSON.stringify({ ...cleaned, nodes });
  }, []);
  const histDecode = useCallback((ser: string): string => {
    let snap: MapSnapshot;
    try {
      snap = JSON.parse(ser) as MapSnapshot;
    } catch {
      return ser;
    }
    const nodes = snap.nodes.map((n) => {
      if (n.type !== "image") return n;
      const d = n.data as { src?: unknown } | undefined;
      if (!d || typeof d.src !== "string" || !d.src.startsWith("@img:")) return n;
      const real = imgSrcMapRef.current.get(d.src);
      return real ? { ...n, data: { ...d, src: real } } : n; // sin hash: degradación segura
    });
    return JSON.stringify({ ...snap, nodes });
  }, []);

  // Aplica un estado serializado al lienzo, reponiendo el color actual por DQL.
  const applySerialized = useCallback(
    (ser: string) => {
      let snap: MapSnapshot;
      try {
        snap = JSON.parse(ser) as MapSnapshot;
      } catch {
        return;
      }
      const sev = statusByDqlRef.current;
      const withSev = snap.nodes.map((n) => {
        if (n.type !== "severity") return n;
        const d = n.data as SeverityNodeData;
        return { ...n, data: { ...d, severity: d.dql ? sev[d.dql] ?? "unknown" : "unknown" } };
      });
      // Agrupadores antes que sus miembros (requisito de render de React Flow).
      setNodes(orderNodesForFlow(withSev));
      setEdges(snap.edges);
      // Merge profundo de glow: mapas viejos sin .glow quedan en "medium" para los tres estados.
      const rawSettings = (snap.settings ?? {}) as Partial<MapSettings>;
      setSettings({
        ...DEFAULT_SETTINGS,
        ...rawSettings,
        glow: { ...DEFAULT_GLOW, ...(rawSettings.glow ?? {}) },
        parentRefreshMs: clampParentRefresh(rawSettings.parentRefreshMs),
      });
    },
    [setNodes, setEdges],
  );

  const undo = useCallback(() => {
    if (!histPastRef.current.length) return;
    if (recordTimerRef.current) clearTimeout(recordTimerRef.current);
    // Asienta el cambio AÚN no registrado (el debounce de 600 ms no ha corrido):
    // sin esto, deshacer justo después de editar saltaba DOS estados y el último
    // cambio del usuario no quedaba ni en past ni en future (irrecuperable).
    const cur = histEncode({ nodes, edges, settings });
    if (histBaseRef.current !== null && cur !== histBaseRef.current) {
      histPastRef.current.push(histBaseRef.current);
      if (histPastRef.current.length > HISTORY_LIMIT) histPastRef.current.shift();
      histBaseRef.current = cur;
    }
    const prev = histPastRef.current.pop() as string;
    if (histBaseRef.current) histFutureRef.current.push(histBaseRef.current);
    travelingRef.current = true;
    histBaseRef.current = prev;
    // Repone el src real de la imagen antes de aplicar (el historial guarda solo la referencia).
    applySerialized(histDecode(prev));
    setCanUndo(histPastRef.current.length > 0);
    setCanRedo(true);
  }, [applySerialized, histEncode, histDecode, nodes, edges, settings]);

  const redo = useCallback(() => {
    if (!histFutureRef.current.length) return;
    if (recordTimerRef.current) clearTimeout(recordTimerRef.current);
    const next = histFutureRef.current.pop() as string;
    if (histBaseRef.current) histPastRef.current.push(histBaseRef.current);
    travelingRef.current = true;
    histBaseRef.current = next;
    applySerialized(histDecode(next));
    setCanUndo(true);
    setCanRedo(histFutureRef.current.length > 0);
  }, [applySerialized, histDecode]);

  // Hidrata el lienzo cada vez que cambia el mapa activo (carga inicial y al
  // abrir/crear/importar otro mapa). Dedupe por referencia del snapshot.
  useEffect(() => {
    if (!activeSnapshot) {
      // Sin mapa activo (se borró el último): limpiar el lienzo de verdad. Antes
      // los nodos del mapa borrado quedaban en el estado y sus probes seguían
      // consultando Grail indefinidamente detrás del estado vacío.
      if (hydratedSnapRef.current !== null) {
        hydratedSnapRef.current = null;
        travelingRef.current = true;
        histPastRef.current = [];
        histFutureRef.current = [];
        histBaseRef.current = null;
        if (recordTimerRef.current) clearTimeout(recordTimerRef.current);
        setCanUndo(false);
        setCanRedo(false);
        setNodes([]);
        setEdges([]);
        previewRef.current = false;
        setPreviewLabel(null);
        setImageEditMode(false);
      }
      return;
    }
    if (hydratedSnapRef.current === activeSnapshot) return;
    hydratedSnapRef.current = activeSnapshot;
    // La vista previa de una versión NO sobrevive al cambio de mapa: si quedara
    // activa, el mapa nuevo abriría "bloqueado" con el banner de otro mapa y sus
    // ediciones NO se guardarían (previewRef bloquea el autosave) sin señal.
    previewRef.current = false;
    setPreviewLabel(null);
    // Cambiar de mapa NO es un paso deshacer: reseteamos el historial con el
    // contenido cargado como nueva línea base.
    travelingRef.current = true;
    histPastRef.current = [];
    histFutureRef.current = [];
    histBaseRef.current = histEncode(activeSnapshot);
    if (recordTimerRef.current) clearTimeout(recordTimerRef.current);
    setCanUndo(false);
    setCanRedo(false);
    // Migración: mapas guardados con el modelo viejo (guardianName) → DQL CoreX,
    // para que sigan coloreando tras pasar al contrato genérico por DQL.
    const migrated = orderNodesForFlow(
      activeSnapshot.nodes.map((n) => {
        if (n.type !== "severity") return n;
        const d = n.data as SeverityNodeData & { guardianName?: string };
        if ((!d.dql || !d.dql.trim()) && typeof d.guardianName === "string" && d.guardianName.trim()) {
          return { ...n, data: { ...d, dql: corexDql(d.guardianName) } };
        }
        return n;
      }),
    );
    setNodes(migrated);
    setEdges(activeSnapshot.edges);
    // Merge profundo de glow: mapas viejos sin .glow quedan en "medium" para los tres estados.
    const rawSnap = (activeSnapshot.settings ?? {}) as Partial<MapSettings>;
    setSettings({
      ...DEFAULT_SETTINGS,
      ...rawSnap,
      glow: { ...DEFAULT_GLOW, ...(rawSnap.glow ?? {}) },
      parentRefreshMs: clampParentRefresh(rawSnap.parentRefreshMs),
    });
    setMapType(snapshotMapType(activeSnapshot));
    // El contador de ids arranca por encima del mayor sufijo numérico cargado.
    // Contempla prefijos n/l/img para no reusar ids al crear nuevos nodos.
    counter.current = activeSnapshot.nodes.reduce((m, n) => {
      const num = Number(String(n.id).replace(/^\D+/, ""));
      return Number.isFinite(num) ? Math.max(m, num) : m;
    }, activeSnapshot.nodes.length);
    // Salir del modo edición de imagen al cambiar de mapa.
    setImageEditMode(false);
    // Cerrar el popover "Relacionados" y el modal de topología al cambiar de mapa
    // (sus ids/sugerencias son de OTRO mapa).
    setRelatedNodeId(null);
    setTopologyOpen(false);
    // Viewport: a partir de aquí los paneos/zooms se atribuyen a ESTE mapa.
    vpMapIdRef.current = activeId;
    const savedVp = readViewport(activeId);
    if (savedVp) {
      // Vista recordada de este mapa (recarga o vuelta desde otro mapa).
      void setViewport(savedVp);
    } else if (migrated.length === 0) {
      // Mapa nuevo/vacío → esquina superior izquierda.
      void setViewport(DEFAULT_VIEWPORT);
    } else {
      // Con contenido y sin vista recordada → encuadrar TODO el grafo (rAF:
      // ReactFlow debe medir/posicionar los nodos recién seteados antes).
      requestAnimationFrame(() => {
        void fitView({ padding: 0.2, minZoom: 0.05, maxZoom: 1.5 });
      });
    }
  }, [activeSnapshot, activeId, setNodes, setEdges, setViewport, fitView, histEncode]);

  // Guarda la topología + ajustes (debounced) en cada cambio. El hook ignora
  // los cambios que no alteran lo persistido (p. ej. severidad).
  useEffect(() => {
    if (previewRef.current) return; // en vista previa de una versión NO se guarda
    // El tipo va SIEMPRE en el snapshot: sin él, el primer guardado del mapa lo
    // borraría del documento y un Mapa Padre pasaría a ser un Mapa de Servicio.
    save({ nodes, edges, settings, mapType });
  }, [nodes, edges, settings, mapType, save]);

  // Mapa de SOLO LECTURA (compartido sin permiso de edición): `readOnly` llega
  // desde persistencia al abrir el mapa (campo `access` del documento). Es VISTA
  // PURA: zoom y desplazamiento, nada más — sin popups, sin "+", sin arrastrar,
  // sin menú ⋮, sin duplicar/descargar, sin editor de nodo. Ver `locked` abajo.

  // Registra cambios del lienzo en el historial (debounced: un arrastre = 1 paso).
  // Si venimos de deshacer/rehacer/hidratar, solo fija la nueva línea base.
  useEffect(() => {
    if (travelingRef.current) {
      travelingRef.current = false;
      histBaseRef.current = histEncode({ nodes, edges, settings });
      if (recordTimerRef.current) clearTimeout(recordTimerRef.current);
      return;
    }
    if (recordTimerRef.current) clearTimeout(recordTimerRef.current);
    recordTimerRef.current = setTimeout(() => {
      const ser = histEncode({ nodes, edges, settings });
      if (histBaseRef.current === null) {
        histBaseRef.current = ser;
        return;
      }
      if (ser === histBaseRef.current) return;
      histPastRef.current.push(histBaseRef.current);
      if (histPastRef.current.length > HISTORY_LIMIT) histPastRef.current.shift();
      histBaseRef.current = ser;
      histFutureRef.current = [];
      setCanUndo(true);
      setCanRedo(false);
    }, HISTORY_DEBOUNCE_MS);
  }, [nodes, edges, settings, histEncode]);

  // Limpieza al desmontar (p. ej. la app se cierra/cambia de ruta): cancela los
  // timers pendientes (viewport, historial) y cualquier listener de arrastre de
  // la barra lateral que hubiera quedado activo. Evita trabajo y setState tras
  // el desmontaje. Solo corre al desmontar (deps []).
  useEffect(
    () => () => {
      if (vpTimer.current) clearTimeout(vpTimer.current);
      if (recordTimerRef.current) clearTimeout(recordTimerRef.current);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      dragCleanupRef.current?.();
    },
    [],
  );

  const updateSettings = useCallback(
    (patch: Partial<MapSettings>) => setSettings((s) => ({ ...s, ...patch })),
    [],
  );

  // Severidad MOSTRADA: se DERIVA del DQL en cada render (no se guarda en el nodo).
  // Así, al cambiar de mapa, los colores ya conocidos aparecen de inmediato —sin
  // parpadeo ni esperar a un efecto— y los aún desconocidos se pintan cuando el
  // probe responde. (Antes la severidad vivía en el nodo y un efecto la reaplicaba
  // solo cuando cambiaba statusByDql → al cambiar de mapa quedaba gris hasta el
  // siguiente refresco; recargar la página lo "arreglaba" por casualidad.)
  const sevOfDql = useCallback(
    (dql?: string): Severity => (dql ? statusByDql[dql] ?? "unknown" : "unknown"),
    [statusByDql],
  );

  // ── Nodos sub-mapa (jerarquía de mapas) ──────────────────────────────────────
  // Ids de los mapas HIJOS referenciados por nodos de este mapa. El hook descarga
  // cada documento, le saca las fuentes de estado y las agrega a un % de salud;
  // los DQL de los hijos vuelven aquí para correr con los MISMOS probes del padre
  // (mismo refresco, misma pausa por pestaña oculta, misma leyenda de consumo).
  const submapIds = useMemo(() => {
    const out = new Set<string>();
    nodes.forEach((n) => {
      if (n.type !== "severity") return;
      const d = n.data as SeverityNodeData;
      if (nodeStatusSource(d) === "map" && d.mapRef?.id) out.add(d.mapRef.id);
    });
    return [...out];
  }, [nodes]);
  const submap = useSubmapStatus(submapIds, {
    paused: !pageVisible,
    sevOfDql,
    loadSnapshot,
    refreshIntervalMs: probeRefreshMs,
    refreshToken: probeToken,
  });

  // Lista de DQL únicos a consultar (dedupe: nodos o rayas con el mismo DQL = 1 probe).
  const uniqueDqls = useMemo(() => {
    const set = new Set<string>();
    nodes.forEach((n) => {
      if (n.type === "severity") {
        const d = n.data as SeverityNodeData;
        // Nodo cuyo estado lo lleva Davis (entidad atada) o un sub-mapa: NO corre
        // su propio DQL (su color sale de la consulta batch / del mapa hijo).
        const source = nodeStatusSource(d);
        if (source !== "dql") return;
        const dql = d.dql;
        if (dql && dql.trim()) set.add(dql);
      }
    });
    // Los DQL de los mapas HIJOS entran al mismo pote de probes que los propios.
    submap.dqls.forEach((q) => set.add(q));
    // Las rayas también tienen DQL propio: se consultan igual que los nodos (y
    // cuentan en la leyenda de consumo). Dedupe compartido entre nodos y rayas.
    edges.forEach((e) => {
      const ed = e.data as { dql?: unknown; inheritStatus?: unknown } | undefined;
      // Raya que HEREDA el estado del nodo de origen (default) → NO consulta su
      // propio DQL: su color sale del nodo source, que ya tiene su probe.
      if ((ed?.inheritStatus ?? true) === true) return;
      const dql = ed?.dql;
      if (typeof dql === "string" && dql.trim()) set.add(dql);
    });
    return [...set];
  }, [nodes, edges, submap.dqls]);
  // DQL de VALOR de las rayas (chip): solo las que tienen el chip activado.
  const uniqueValueDqls = useMemo(() => {
    const set = new Set<string>();
    edges.forEach((e) => {
      const ed = e.data as { valueEnabled?: unknown; valueDql?: unknown } | undefined;
      if (ed?.valueEnabled !== true) return;
      if (typeof ed.valueDql === "string" && ed.valueDql.trim()) set.add(ed.valueDql);
    });
    return [...set];
  }, [edges]);
  useEffect(() => {
    const live = new Set(uniqueValueDqls);
    setValueByDql((prev) => {
      const keys = Object.keys(prev);
      if (keys.every((k) => live.has(k))) return prev;
      const next: Record<string, number | null> = {};
      for (const k of keys) if (live.has(k)) next[k] = prev[k];
      return next;
    });
  }, [uniqueValueDqls]);

  // Poda de cachés de sesión: statusByDql/queryIdByDql acumulaban una entrada por
  // cada DQL editado en la sesión y NO se limpiaban nunca. Al cambiar el set de
  // DQL vigentes (cambiar de mapa, borrar/editar nodos) descartamos las entradas
  // que ya no corresponden a ningún nodo/raya del mapa activo. El guard de
  // igualdad devuelve la MISMA referencia si no hay nada que podar → sin re-render.
  useEffect(() => {
    const live = new Set(uniqueDqls);
    const prune = <T,>(m: Record<string, T>): Record<string, T> => {
      const keys = Object.keys(m);
      if (keys.every((k) => live.has(k))) return m;
      const next: Record<string, T> = {};
      for (const k of keys) if (live.has(k)) next[k] = m[k];
      return next;
    };
    setStatusByDql((prev) => prune(prev));
    setQueryIdByDql((prev) => prune(prev));
  }, [uniqueDqls]);

  // ── Entidades atadas (estado por Davis + topología) ──────────────────────────
  // Nodos con estado por Davis: los que traen una entidad atada Y su fuente de
  // estado es "davis" (por defecto, tener entidad → davis). Se deduplica por
  // entity.id (varios nodos pueden apuntar a la misma entidad → 1 sola consulta).
  const boundEntities = useMemo<EntityRef[]>(() => {
    const seen = new Set<string>();
    const out: EntityRef[] = [];
    nodes.forEach((n) => {
      if (n.type !== "severity") return;
      const d = n.data as SeverityNodeData;
      const ent = d.entity;
      if (!ent?.id) return;
      const source = nodeStatusSource(d);
      if (source !== "davis") return;
      if (seen.has(ent.id)) return;
      seen.add(ent.id);
      out.push(ent);
    });
    return out;
  }, [nodes]);
  const boundEntityIds = useMemo(() => boundEntities.map((e) => e.id), [boundEntities]);

  // UNA consulta por mapa para cada cosa (batch), pausadas cuando la pestaña está
  // oculta (igual criterio que los probes de DQL, para cuidar el budget de Grail):
  //  - Davis: severidad por problemas activos (esta SÍ cuesta Grail).
  //  - metadata: nombre en vivo + existencia (gratis; detecta bajas/renombrados).
  //  - relaciones: calls/called_by de Smartscape (gratis; para topología).
  const davis = useDavisStatus(boundEntityIds, {
    paused: !pageVisible,
    refreshIntervalMs: isParentMap ? probeRefreshMs : undefined,
    refreshToken: probeToken,
  });
  const relations = useEntityRelations(boundEntities, { paused: !pageVisible });
  // Entidades relacionadas que AÚN no son nodo del mapa (candidatas del popover
  // "Relacionados", sección "No está en el mapa"): también les resolvemos el
  // nombre en vivo (si no, el popover solo puede mostrar el id crudo, ilegible).
  const relatedCandidateEntities = useMemo<EntityRef[]>(() => {
    const boundIds = new Set(boundEntities.map((e) => e.id));
    const seen = new Set<string>();
    const out: EntityRef[] = [];
    Object.values(relations.byEntity).forEach((rel) => {
      [...rel.calls, ...rel.calledBy].forEach((id) => {
        if (boundIds.has(id) || seen.has(id)) return;
        const type = entityTypeOf(id);
        if (!type) return;
        seen.add(id);
        // `sid` = id del modelo nuevo de Smartscape (para el deep-link de la
        // entidad candidata); las relaciones ya lo traen resuelto.
        const sid = relations.sids[id];
        out.push(sid ? { id, type, sid } : { id, type });
      });
    });
    return out;
  }, [relations, boundEntities]);
  const entityMeta = useEntityMetadata([...boundEntities, ...relatedCandidateEntities], {
    paused: !pageVisible,
  });

  // ── Salud de conexiones (pill encima del nodo) ───────────────────────────────
  // Entidades "vigiladas": las de nodos con el pill activo (connHealth) y fuente
  // davis. Su universo de conexiones = calls ∪ calledBy REALES de Smartscape (ya
  // resueltos gratis por useEntityRelations, estén o no dibujados en el mapa).
  const connWatchedIds = useMemo(() => {
    const out = new Set<string>();
    nodes.forEach((n) => {
      if (n.type !== "severity") return;
      const d = n.data as SeverityNodeData;
      if (!d.connHealth || !d.entity?.id) return;
      const source = nodeStatusSource(d);
      if (source !== "davis") return;
      out.add(d.entity.id);
    });
    return out;
  }, [nodes]);
  // Vecinos (ids clásicos) de TODAS las entidades vigiladas, deduplicados: son
  // los ids cuya salud hay que consultar en Davis.
  const connNeighborIds = useMemo(() => {
    const out = new Set<string>();
    connWatchedIds.forEach((id) => {
      const rel = relations.byEntity[id];
      if (!rel) return;
      rel.calls.forEach((nid) => out.add(nid));
      rel.calledBy.forEach((nid) => out.add(nid));
    });
    return [...out].sort();
  }, [connWatchedIds, relations]);
  // SEGUNDA consulta batcheada de Davis, SOLO para los vecinos del pill y solo
  // cuando hay al menos un pill activo. Va separada de la principal a propósito:
  // un nodo con cientos de conexiones no debe arriesgar (por tamaño/fallo de la
  // consulta) el estado de los nodos del mapa.
  const connDavis = useDavisStatus(connNeighborIds, {
    paused: !pageVisible,
    refreshIntervalMs: isParentMap ? probeRefreshMs : undefined,
    refreshToken: probeToken,
  });
  // Salud por entidad vigilada: pct = % de vecinos SIN problema activo.
  //   pct null  → sin conexiones (pill gris "N.A.")
  //   sin entrada → todavía cargando (pill "…")
  //   err       → falló la consulta de relaciones (pill "…" con tooltip de error,
  //                NUNCA "N.A.": no sabemos si hay conexiones)
  const connInfoByEntity = useMemo(() => {
    const m = new Map<string, { pct: number | null | undefined; bad: number; total: number; err?: boolean }>();
    connWatchedIds.forEach((id) => {
      const rel = relations.byEntity[id];
      if (!rel) return;
      const neigh = [...new Set([...rel.calls, ...rel.calledBy])];
      const total = neigh.length;
      if (total === 0) {
        // byEntity arranca con listas vacías ANTES de que lleguen las aristas:
        // solo es un "N.A." real cuando las consultas de relaciones ya cargaron.
        if (relations.hasError) m.set(id, { pct: undefined, bad: 0, total: 0, err: true });
        else if (!relations.isLoading) m.set(id, { pct: null, bad: 0, total: 0 });
        return;
      }
      if (!connDavis.isReady) return; // aún sin respuesta de Davis → cargando
      let bad = 0;
      neigh.forEach((nid) => {
        const s = connDavis.byEntity[nid];
        if (s === 1 || s === 2) bad++;
      });
      m.set(id, { pct: Math.round(((total - bad) / total) * 100), bad, total });
    });
    return m;
  }, [connWatchedIds, relations, connDavis]);

  // Solo consultamos los primeros MAX_ACTIVE_PROBES DQL únicos; el resto queda en
  // gris (sin probe). Red de seguridad contra mapas enormes (ver constante arriba).
  const activeDqls = useMemo(() => uniqueDqls.slice(0, MAX_ACTIVE_PROBES), [uniqueDqls]);
  const activeValueDqls = useMemo(() => uniqueValueDqls.slice(0, MAX_ACTIVE_PROBES), [uniqueValueDqls]);
  // Todo lo que consulta Grail por ciclo (estado + valor): base de la leyenda de consumo.
  const costDqls = useMemo(() => [...activeDqls, ...activeValueDqls], [activeDqls, activeValueDqls]);
  const overCap = uniqueDqls.length > MAX_ACTIVE_PROBES;
  // Avisamos UNA vez por mapa cuando se supera el tope (no en cada render).
  const capNotifiedRef = useRef<string | null>(null);
  useEffect(() => {
    const key = overCap ? activeId : null;
    if (key && capNotifiedRef.current !== key) {
      capNotifiedRef.current = key;
      setNotice(t("probe.capNotice", { shown: MAX_ACTIVE_PROBES, total: uniqueDqls.length }));
    }
  }, [overCap, activeId, uniqueDqls.length, setNotice, t]);

  // ── Consumo de querys (leyenda abajo-derecha) ────────────────────────────────
  // Muestra los bytes FACTURABLES que las consultas del mapa escanearon, leídos de
  // dt.system.events / QUERY_EXECUTION_EVENT por query_id: cada probe reporta su
  // queryId y aquí se suma su `scanned_bytes.on_demand` (la parte que se cobra;
  // `...included` sería la gratis). Las consultas gratis (problems, métricas,
  // system, smartscape) traen on_demand = 0 → no suman. El evento se emite al
  // instante (al terminar cada query). Consultar esa tabla NO consume (scope
  // storage:system:read; 0 bytes). Formateo con la unidad de datos del SDK.
  const fmtBytes = useCallback((n: number): string => {
    try {
      return format(n, { input: units.data.byte, maximumFractionDigits: 1 });
    } catch {
      return `${Math.round(n)} B`;
    }
  }, []);
  // queryIds de las consultas activas del mapa que ya corrieron.
  const activeQids = useMemo(() => {
    const ids: string[] = [];
    for (const d of costDqls) {
      const q = queryIdByDql[d];
      if (q) ids.push(q);
    }
    return ids;
  }, [costDqls, queryIdByDql]);
  // ASENTAMIENTO de los qids (2.5 s): cada refresco de cada probe cambia su
  // queryId → sin esto, el billingDql era un string nuevo por cada qid que
  // llegaba y useDql re-ejecutaba la consulta N veces por ciclo (mini-tormenta
  // contra dt.system.events). Con el debounce se consulta una vez por tanda.
  const [settledQids, setSettledQids] = useState<string[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettledQids((prev) => {
        if (prev.length === activeQids.length && prev.every((v, i) => v === activeQids[i])) return prev;
        return activeQids;
      });
    }, 2500);
    return () => clearTimeout(timer);
  }, [activeQids]);
  // Lookup de consumo: bytes FACTURABLES por cada query_id (GRATIS). Se usa
  // QUERY_EXECUTION_EVENT (se emite al instante, al terminar cada query) y su campo
  // `scanned_bytes.on_demand` = la parte que se cobra (`...included` sería la
  // gratis). Las consultas gratis (problems, métricas, system, smartscape) traen
  // on_demand = 0. Antes se usaba el evento de uso/billing, pero ese evento llega
  // tarde o no aparece para algunas queries → daba "sin consumo" en falso.
  const billingDql = useMemo(() => {
    if (settledQids.length === 0) return "";
    const list = settledQids.map((id) => `"${id}"`).join(", ");
    return `fetch dt.system.events, from:now()-15m
| filter event.kind == "QUERY_EXECUTION_EVENT"
| filter in(query_id, { ${list} })
| summarize billed = sum(scanned_bytes.on_demand), by:{query_id}`;
  }, [settledQids]);
  const billing = useDql(billingDql, {
    enabled: billingDql.length > 0 && pageVisible,
    refetchInterval: 5000,
  });
  const billedByQid = useMemo(() => {
    const m: Record<string, number> = {};
    const recs = (billing.data?.records ?? []) as Array<Record<string, unknown>>;
    for (const r of recs) {
      const qid = r["query_id"];
      const b = r["billed"];
      if (typeof qid === "string") {
        const n = typeof b === "number" ? b : Number(b);
        m[qid] = Number.isFinite(n) ? n : 0;
      }
    }
    return m;
  }, [billing.data]);
  const queryCost = useMemo(() => {
    const withQid = costDqls.filter((d) => queryIdByDql[d]);
    let bytesPerCycle = 0;
    let consuming = 0;
    for (const d of withQid) {
      const b = billedByQid[queryIdByDql[d]] ?? 0;
      bytesPerCycle += b;
      if (b > 0) consuming++;
    }
    // En un Mapa Padre el ciclo lo manda su cadencia propia, no `refreshIntervalMs`.
    const interval = isParentMap ? parentRefreshMs : settings.refreshIntervalMs;
    const cyclesPerHour = interval > 0 ? 3_600_000 / interval : 0;
    return {
      uniqueCount: costDqls.length,
      consumingCount: consuming,
      bytesPerCycle,
      cyclesPerHour,
      manual: interval <= 0,
    };
  }, [costDqls, queryIdByDql, billedByQid, settings.refreshIntervalMs, isParentMap, parentRefreshMs]);

  // El número de billing llega con un pequeño retraso (~1-2s tras la query).
  // "Settled" = ya esperamos lo suficiente para confiar en el valor; antes se
  // muestra "calculando…". Se reinicia al cambiar de mapa.
  const [costSettled, setCostSettled] = useState(false);
  useEffect(() => {
    setCostSettled(false);
  }, [activeId]);
  useEffect(() => {
    if (costSettled || billing.data === undefined) return;
    const id = setTimeout(() => setCostSettled(true), 6000);
    return () => clearTimeout(id);
  }, [costSettled, billing.data]);
  // Último valor confiable: suaviza la rotación de queryIds (cada refresco de los
  // probes genera ids nuevos; mientras llega el billing del nuevo ciclo se conserva
  // el último valor en vez de parpadear).
  const [lastGoodBytes, setLastGoodBytes] = useState<number | null>(null);
  useEffect(() => {
    if (billing.data !== undefined) setLastGoodBytes(queryCost.bytesPerCycle);
  }, [billing.data, queryCost.bytesPerCycle]);

  const showCost = settings.showQueryCost !== false && activeDqls.length > 0;
  const costBytesPerCycle =
    billing.data !== undefined ? queryCost.bytesPerCycle : (lastGoodBytes ?? 0);
  const costBytesPerHour = costBytesPerCycle * queryCost.cyclesPerHour;
  // Error solo si NUNCA cuajó (si ya había un valor, se conserva).
  const costFailed = billing.error != null && !costSettled;
  const costCalculating = !costFailed && (!costSettled || activeQids.length === 0);
  const costMain = costFailed
    ? t("cost.error")
    : costCalculating
      ? t("cost.calculating")
      : costBytesPerCycle <= 0
        ? t("cost.allFree")
        : queryCost.manual
          ? t("cost.perRun", { value: fmtBytes(costBytesPerCycle) })
          : t("cost.perHour", { value: fmtBytes(costBytesPerHour) });

  // ¿Tiene el mapa activo una imagen de fondo?
  const hasImage = useMemo(() => nodes.some((n) => n.type === "image"), [nodes]);

  // displayNodes: proyecta los nodos al estado visual para ReactFlow.
  // - Nodos severity: severidad derivada del DQL (no persistida).
  // - Nodo image: flags transitorios de edición (editing/keepAspect/draggable/selectable)
  //   inyectados SOLO aquí para que NO se persistan en el documento.
  // - Otros nodos: en modo imageEditMode se atenúan (className mapa-node-dim).
  // Marcas del último análisis de causa raíz por nodo (número rojo / "Efecto de").
  // ESTADO VIVO del análisis guardado: el análisis es una foto; se revisa qué
  // problemas ya se cerraron (para no seguir marcando como causa raíz algo
  // resuelto). La consulta mira DESDE la hora del análisis (antes: últimas 24 h;
  // pasado un día ya no veía los cierres y las marcas volvían a rojo, 26-oct).
  // Un problema cerrado no se reabre en Davis: cuando TODOS están cerrados se deja
  // de consultar y el mapa queda sin marcas (limpieza automática).
  // Análisis que se pinta: el del mapa o, de visita en un hijo, el del padre.
  const rcVisiting = rcVisit !== null && rcVisit.childId === activeId;
  const rcShown = useMemo<RcAnalysis | undefined>(
    () => (rcVisit && rcVisit.childId === activeId ? rcChildView(rcVisit.analysis, rcVisit.host) : settings.rootCause),
    [rcVisit, activeId, settings.rootCause],
  );
  const rcIds = useMemo(() => rcProblemIds(rcShown), [rcShown]);
  // ¿Este navegador ya vio este análisis TODO resuelto? → ni se consulta.
  const rcExecId = rcShown?.executionId;
  const rcKnownResolved = useMemo(() => !!rcExecId && readRcResolved().includes(rcExecId), [rcExecId]);
  // Desde 30 min antes del análisis: también cubre los cerrados que entraron por
  // la ventana de RC_CLOSED_WINDOW_MIN (su registro de cierre puede ser anterior).
  const rcSinceMs = rcShown?.at ? Date.parse(rcShown.at) - 30 * 60_000 : NaN;
  const rcStatusDql = useMemo(
    () =>
      rcIds.length && !rcKnownResolved
        ? `fetch dt.davis.problems, from: ${Number.isNaN(rcSinceMs) ? "now()-24h" : `"${new Date(rcSinceMs).toISOString()}"`}
| filter in(event.id, { ${rcIds.map((id) => `"${id.replace(/["\\]/g, "")}"`).join(", ")} })
| sort timestamp desc
| dedup event.id
| fields event.id, event.status`
        : "",
    [rcIds, rcSinceMs, rcKnownResolved],
  );
  // Se deja de consultar cuando todo está cerrado (rcPollStop, abajo). Análisis de
  // más de un día: cada 15 min (la ventana ya es larga); reciente: cada 2 min.
  const [rcPollStop, setRcPollStop] = useState(false);
  const rcPollMs = !Number.isNaN(rcSinceMs) && Date.now() - rcSinceMs > 24 * 3_600_000 ? 900_000 : 120_000;
  const rcStatusQ = useDql(rcStatusDql, {
    enabled: rcStatusDql.length > 0,
    refetchInterval: rcStatusDql.length > 0 && !rcPollStop ? rcPollMs : undefined,
  });
  const rcClosed = useMemo(() => {
    if (rcKnownResolved) return new Set(rcIds);
    const m = new Set<string>();
    for (const r of (rcStatusQ.data?.records ?? []) as Array<Record<string, unknown>>) {
      if (r["event.status"] === "CLOSED") m.add(String(r["event.id"]));
    }
    return m;
  }, [rcStatusQ.data, rcKnownResolved, rcIds]);
  // Limpieza automática: si TODOS los problemas del análisis (causas, efectos y
  // sin clasificar) ya se cerraron, los nodos quedan sin marcas; la leyenda
  // conserva el análisis con «✅ resueltas» y «Volver a analizar».
  const rcAllResolved = rcIds.length > 0 && rcIds.every((id) => rcClosed.has(id));
  useEffect(() => {
    setRcPollStop(rcAllResolved);
    if (rcAllResolved && rcExecId && !rcKnownResolved) rememberRcResolved(rcExecId);
  }, [rcAllResolved, rcExecId, rcKnownResolved]);
  const rcMarks = useMemo(
    () => rcMarksByNode(rcAllResolved ? undefined : rcShown, rcClosed),
    [rcShown, rcClosed, rcAllResolved],
  );

  const displayNodes = useMemo(() => {
    const projected: Node[] = nodes.map((n) => {
        if (n.type === "image") {
          const d = n.data as ImageNodeData;
          // zIndex -1 SIEMPRE re-inyectado aquí (cleanSnapshot no lo persiste):
          // sin esto, tras recargar la imagen volvía a la capa de nodos (z 0,
          // encima de las rayas) y las tapaba.
          if (imageEditMode) {
            return {
              ...n,
              zIndex: -1,
              draggable: true,
              selectable: true,
              data: { ...d, editing: true, keepAspect },
            };
          }
          // Fuera del modo edición: imagen estática, no editable.
          return {
            ...n,
            zIndex: -1,
            draggable: false,
            selectable: false,
            data: { ...d, editing: false },
          };
        }
        // Nodos severity: la severidad se deriva del motor elegido (Davis, sub-mapa o DQL).
        if (n.type === "severity") {
          const d = n.data as SeverityNodeData;
          const source = nodeStatusSource(d);
          const davisBound = source === "davis" && d.entity?.id;
          // Mapa incrustado: agregado del mapa hijo. Sin acceso al documento →
          // "unknown" (neutro, sin glow); nunca verde falso.
          const subInfo = source === "map" ? submap.byMap.get(d.mapRef!.id) : undefined;
          const mapPct = source === "map" ? subInfo?.pct : undefined;
          const mapOk = source === "map" ? subInfo?.ok : undefined;
          const mapAffected = source === "map" ? subInfo?.affected : undefined;
          const mapTotal = source === "map" ? subInfo?.total : undefined;
          const mapError = source === "map" ? Boolean(subInfo?.error) : false;
          // Severidad: por Davis (entidad atada), por las REGLAS de color del
          // mapa incrustado, o por el DQL propio del nodo. Anti-falso-verde:
          // mientras Davis no haya cargado (isReady), "unknown" (gris) — nunca
          // asumir 0 (ok) ni "sin baja" antes de la 1a respuesta real.
          const sevBase: Severity = davisBound
            ? davis.isReady
              ? (davis.byEntity[d.entity!.id] ?? "unknown")
              : "unknown"
            : source === "map"
              ? submapSeverity({ ...d, mapPct, mapAffected, mapError })
              : sevOfDql(d.dql);
          // Campos TRANSITORIOS solo para nodos atados a Davis (no se persisten):
          // baja (entidad ausente), nombre en vivo y cantidad de problemas.
          const retired = davisBound ? entityMeta.isReady && !entityMeta.existing.has(d.entity!.id) : false;
          const liveName = davisBound ? entityMeta.liveName[d.entity!.id] : undefined;
          const problems = davisBound ? (davis.problemsByEntity[d.entity!.id] ?? 0) : undefined;
          // Salud de conexiones (pill): % de vecinos reales de Smartscape sin
          // problemas. Si llega al umbral, la REGLA pone el nodo en rojo (2)
          // por encima de lo que diga Davis del nodo mismo.
          const connOn = Boolean(davisBound && d.connHealth);
          const connInfo = connOn ? connInfoByEntity.get(d.entity!.id) : undefined;
          const connPct = connOn ? (connInfo ? connInfo.pct : undefined) : undefined;
          const connBad = connInfo?.bad;
          const connTotal = connInfo?.total;
          const connErr = connInfo?.err === true;
          const connRule =
            connOn && typeof connPct === "number" && connPct <= clampConnRedAt(d.connHealthRedAt ?? DEFAULT_CONN_RED_AT);
          const sev: Severity = connRule ? 2 : sevBase;
          const rcRoots = rcMarks.roots.get(n.id);
          const rcResolved = rcMarks.resolved.get(n.id);
          const rcEffects = rcMarks.effects.get(n.id);
          const rcEffectsResolved = rcMarks.effectsResolved.get(n.id);
          // Reconstruimos data solo si algo cambia (evita re-render innecesario).
          const same =
            (d.rcRoots ?? []).join() === (rcRoots ?? []).join() &&
            (d.rcEffects ?? []).join() === (rcEffects ?? []).join() &&
            (d.rcEffectsResolved ?? []).join() === (rcEffectsResolved ?? []).join() &&
            (d.rcResolved ?? []).join() === (rcResolved ?? []).join() &&
            d.severity === sev &&
            (d.retired ?? false) === retired &&
            d.liveName === liveName &&
            d.problems === problems &&
            d.connPct === connPct &&
            d.connBad === connBad &&
            d.connTotal === connTotal &&
            (d.connRule ?? false) === connRule &&
            (d.connErr ?? false) === connErr &&
            d.mapPct === mapPct &&
            d.mapOk === mapOk &&
            d.mapAffected === mapAffected &&
            d.mapTotal === mapTotal &&
            (d.mapError ?? false) === mapError;
          const sevNode = same
            ? n
            : {
                ...n,
                data: {
                  ...d,
                  severity: sev,
                  retired,
                  liveName,
                  problems,
                  connPct,
                  connBad,
                  connTotal,
                  connRule,
                  connErr,
                  mapPct,
                  mapOk,
                  mapAffected,
                  mapTotal,
                  mapError,
                  rcRoots,
                  rcResolved,
                  rcEffects,
                  rcEffectsResolved,
                },
              };
          if (imageEditMode) {
            return { ...sevNode, draggable: false, selectable: false, className: "mapa-node-dim" };
          }
          return n.id === rcFocusId ? { ...sevNode, className: "mapa-rc-focus" } : sevNode;
        }
        // Nodos label y otros.
        if (imageEditMode) {
          return { ...n, draggable: false, selectable: false, className: "mapa-node-dim" };
        }
        // El título en edición no se arrastra (evita moverlo al escribir/seleccionar).
        if (n.type === "label" && editingLabelId === n.id) {
          return { ...n, draggable: false };
        }
        return n;
    });

    // 2a pasada — AGRUPADORES: el marco se pinta con el PEOR estado de sus
    // miembros (0 ok < 1 warn < 2 err; los neutros/gris no cuentan). Es cálculo
    // puro sobre las severidades que ya se resolvieron arriba: CERO consultas
    // nuevas a Grail. Si el mapa no tiene agrupadores, se devuelve tal cual.
    if (!projected.some((n) => n.type === "group")) return projected;
    const worst = new Map<string, 0 | 1 | 2>();
    projected.forEach((n) => {
      if (n.type !== "severity" || !n.parentId) return;
      const s = (n.data as SeverityNodeData).severity;
      if (s !== 0 && s !== 1 && s !== 2) return;
      const cur = worst.get(n.parentId);
      if (cur === undefined || s > cur) worst.set(n.parentId, s);
    });
    return projected.map((n) => {
      if (n.type !== "group") return n;
      const d = n.data as GroupNodeData;
      const sev: Severity = worst.get(n.id) ?? "unknown";
      const flash = flashGroupId === n.id;
      // Resaltado mientras se arrastra un nodo encima de ESTE marco.
      const hover = hoverGroupId === n.id;
      // Tira y afloje de un miembro propio (retiene / suelta).
      const pull = pullState?.id === n.id ? pullState.mode : undefined;
      // Mínimos de la manija: el tope general o, si es mayor, el rectángulo que
      // ocupan los miembros (achicar más los dejaría por fuera del marco).
      const ext = membersExtent(projected, n.id);
      const minW = Math.max(GROUP_MIN_W, ext.w);
      const minH = Math.max(GROUP_MIN_H, ext.h);
      // zIndex re-inyectado aquí SIEMPRE (cleanSnapshot no lo persiste): el marco
      // vive por DEBAJO para que sus miembros se vean encima de él.
      if (
        n.zIndex === -1 &&
        d.severity === sev &&
        (d.flash ?? false) === flash &&
        (d.hover ?? false) === hover &&
        d.pull === pull &&
        d.minW === minW &&
        d.minH === minH
      ) {
        return n;
      }
      return { ...n, zIndex: -1, data: { ...d, severity: sev, flash, hover, pull, minW, minH } };
    });
  }, [
    nodes,
    sevOfDql,
    imageEditMode,
    keepAspect,
    editingLabelId,
    davis,
    entityMeta,
    connInfoByEntity,
    submap,
    flashGroupId,
    hoverGroupId,
    pullState,
    rcMarks,
    rcFocusId,
  ]);

  // ── Análisis de causa raíz ──────────────────────────────────────────────────
  // ¿Hay algo que analizar? Algún nodo de servicio en advertencia o error.
  const rcHasProblems = useMemo(
    () =>
      displayNodes.some((n) => {
        if (n.type !== "severity") return false;
        // String(): la severidad puede llegar como número o como texto.
        const sv = String((n.data as SeverityNodeData).severity);
        return sv === "1" || sv === "2";
      }),
    [displayNodes],
  );
  // Nodos en rojo/amarillo que NO estaban en el análisis guardado → «problemas nuevos».
  const rcNewRed = useMemo(() => {
    const a = rcShown;
    if (!a || rcVisiting) return 0;
    const inA = new Set<string>(
      [
        ...a.causes.flatMap((c) => [...c.nodeIds, ...c.effects.flatMap((e) => e.nodeIds)]),
        ...a.unclassified.flatMap((u) => u.nodeIds),
      ].map(rcLocalId),
    );
    return displayNodes.filter((n) => {
      if (n.type !== "severity" || inA.has(n.id)) return false;
      const sv = String((n.data as SeverityNodeData).severity);
      return sv === "1" || sv === "2";
    }).length;
  }, [rcShown, rcVisiting, displayNodes]);
  // Nombre de un nodo del análisis: el del mapa abierto o, si es de un mapa
  // hijo (o del padre, estando de visita), el que quedó guardado en el análisis.
  const rcNodeName = useCallback(
    (id: string) => {
      const n = displayNodes.find((x) => x.id === id);
      if (n && n.type === "severity") {
        const d = n.data as SeverityNodeData;
        return (d.liveName || d.name || "").trim();
      }
      const saved = rcShown?.nodeNames?.[id];
      if (saved) return saved;
      // De visita en un hijo: un nodo PROPIO del padre se nombra con el padre.
      if (rcVisiting && rcVisit && !rcSplitId(id)) return `${rcVisit.parentName} › …`;
      return "";
    },
    [displayNodes, rcShown, rcVisiting, rcVisit],
  );
  const runRootCause = useCallback(async () => {
    rcAbortRef.current?.abort();
    const ac = new AbortController();
    rcAbortRef.current = ac;
    setRcError(null);
    const sevNodes = displayNodes.filter((n) => n.type === "severity");
    const ids = new Set(sevNodes.map((n) => n.id));
    const input: RcNodeInput[] = sevNodes.map((n) => {
      const d = n.data as SeverityNodeData;
      const src = nodeStatusSource(d);
      return {
        id: n.id,
        name: (d.liveName || d.name || n.id).trim(),
        state: ({ "2": "err", "1": "warn", "0": "ok" } as const)[String(d.severity) as "0" | "1" | "2"],
        entityId: src === "davis" && d.entity?.id ? d.entity.id : undefined,
        dql: src === "dql" && d.dql ? d.dql : undefined,
      };
    });
    const rcEdges = edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ from: e.source, to: e.target }));
    // Mapa Padre: también se analiza DENTRO de cada hijo (un nivel). Se usan los
    // documentos ya descargados para el color de los sub-mapas (misma caché).
    const children = isParentMap
      ? async () => {
          const outNodes: RcNodeInput[] = [];
          const outEdges: RcEdgeInput[] = [];
          const submaps: Record<string, { mapId: string; name: string }> = {};
          await Promise.all(
            sevNodes.map(async (host) => {
              const hd = host.data as SeverityNodeData;
              if (nodeStatusSource(hd) !== "map" || !hd.mapRef?.id) return;
              const hostName = (hd.liveName || hd.name || "").trim() || hd.mapRef.id;
              submaps[host.id] = { mapId: hd.mapRef.id, name: hostName };
              let snap;
              try {
                snap = await loadMapDoc(hd.mapRef.id, loadSnapshot);
              } catch {
                return; // hijo sin acceso o borrado: no aporta problemas
              }
              const childIds = new Set<string>();
              for (const cn of snap.nodes) {
                if (cn.type !== "severity") continue;
                const cd = cn.data as SeverityNodeData;
                const src = nodeStatusSource(cd);
                if (src === "map") continue; // un solo nivel (anti-ciclo)
                childIds.add(cn.id);
                outNodes.push({
                  id: rcSubId(host.id, cn.id),
                  name: `${hostName} › ${(cd.name || cn.id).trim()}`,
                  entityId: src === "davis" && cd.entity?.id ? cd.entity.id : undefined,
                  dql: src === "dql" && cd.dql ? cd.dql : undefined,
                });
              }
              for (const ce of snap.edges) {
                if (childIds.has(ce.source) && childIds.has(ce.target)) {
                  outEdges.push({ from: rcSubId(host.id, ce.source), to: rcSubId(host.id, ce.target) });
                }
              }
            }),
          );
          return { nodes: outNodes, edges: outEdges, submaps };
        }
      : undefined;
    try {
      const result = await analyzeRootCause(activeId || "", activeName || "", input, rcEdges, setRcBusy, ac.signal, children);
      if (ac.signal.aborted) return;
      // Se guarda en el mapa (ajustes) → lo ven todos los que lo abran.
      setSettings((s) => ({ ...s, rootCause: result }));
    } catch (e) {
      if (ac.signal.aborted || (e as Error)?.name === "AbortError") return;
      const code = e instanceof RcError ? e.code : "failed";
      setRcError(t(`rca.err.${code}`, { msg: ((e as Error)?.message ?? "").slice(0, 300) }));
    } finally {
      if (rcAbortRef.current === ac) {
        rcAbortRef.current = null;
        setRcBusy(null);
      }
    }
  }, [displayNodes, edges, activeId, activeName, t, isParentMap, loadSnapshot]);
  // «Limpiar análisis» (editores): quita el análisis guardado y sus marcas para
  // todos. Va al historial del mapa, así que ↶ lo devuelve. Los comentarios ya
  // publicados en Problems se quedan (son historia del incidente).
  const rcClear = useCallback(() => {
    setRcOpen(null);
    setRcError(null);
    setSettings((s) => ({ ...s, rootCause: undefined }));
  }, []);
  // Al cambiar de mapa se cancela el análisis en curso y se limpia el estado.
  // La visita a un hijo se conserva solo mientras se esté en ese hijo.
  useEffect(() => {
    rcAbortRef.current?.abort();
    rcAbortRef.current = null;
    setRcBusy(null);
    setRcError(null);
    setRcOpen(null);
    setRcVisit((v) => (v && v.childId === activeId ? v : null));
  }, [activeId]);
  // «Ir al nodo»: cierra el modal, centra el mapa en el nodo y lo resalta.
  // Viaje + pulso a un nodo que SÍ está en el mapa abierto.
  const rcPulse = useCallback(
    (id: string, duration = 500) => {
      setRcFocusId(id);
      void fitView({ nodes: [{ id }], padding: 0.9, duration, maxZoom: 1.2 });
      window.setTimeout(() => setRcFocusId((cur) => (cur === id ? null : cur)), 3200);
    },
    [fitView],
  );
  // Abre otro mapa y, cuando cargue, viaja a `nodeId` (ver efecto de abajo).
  const rcGoToMap = useCallback(
    (mapId: string, nodeId: string) => {
      rcPendingRef.current = { mapId, nodeId };
      void openMap(mapId).then((ok) => {
        if (!ok) {
          rcPendingRef.current = null;
          setRcVisit(null);
          setNotice(t("url.noAccess"));
        }
      });
    },
    [openMap, setNotice, t],
  );
  // «Ir al nodo». Tres casos: (1) el nodo está en este mapa → viaja; (2) estamos
  // en un Mapa Padre y el nodo vive DENTRO de un hijo → entra al hijo de visita;
  // (3) estamos de visita y el nodo es del padre (u otro hijo) → vuelve al padre.
  const rcFocusNode = useCallback(
    (id: string) => {
      setRcOpen(null);
      if (nodes.some((x) => x.id === id)) {
        rcPulse(id);
        return;
      }
      if (rcVisiting && rcVisit) {
        const back = rcVisit;
        setRcVisit(null);
        // Si es un nodo del MISMO hijo con id compuesto, ya estaría en `nodes`;
        // aquí es del padre o de otro hijo: el padre resuelve el resto.
        rcGoToMap(back.parentId, id);
        return;
      }
      const sp = rcSplitId(id);
      const sub = sp ? settings.rootCause?.submaps?.[sp.host] : undefined;
      if (sp && sub && activeId && settings.rootCause) {
        setRcVisit({
          parentId: activeId,
          parentName: activeName || "",
          host: sp.host,
          childId: sub.mapId,
          analysis: settings.rootCause,
        });
        rcGoToMap(sub.mapId, sp.child);
        return;
      }
      // Ni en el mapa ni en un hijo conocido: al menos el nodo que lo contiene.
      if (nodes.some((x) => x.id === rcLocalId(id))) rcPulse(rcLocalId(id));
    },
    [nodes, rcPulse, rcVisiting, rcVisit, rcGoToMap, settings.rootCause, activeId, activeName],
  );
  // Llegada a un mapa abierto por «Ir al nodo»: cuando ya cargaron sus nodos, se
  // hace el viaje pendiente (si el nodo es de un hijo, se repite la lógica).
  // Se espera a que `nodes` sea el del mapa nuevo (al cambiar, por un instante
  // siguen los del anterior): solo se consume cuando el destino ya está.
  useEffect(() => {
    const p = rcPendingRef.current;
    if (!p || p.mapId !== activeId) return;
    const id = p.nodeId;
    const here = nodes.some((x) => x.id === id);
    const host = rcSplitId(id) ? nodes.some((x) => x.id === rcLocalId(id)) : false;
    if (!here && !host) return;
    rcPendingRef.current = null;
    const tmr = window.setTimeout(() => {
      if (here) rcPulse(id, 600);
      else rcFocusNode(id);
    }, 350);
    return () => window.clearTimeout(tmr);
  }, [activeId, nodes, rcPulse, rcFocusNode]);
  const rcBackToParent = useCallback(() => {
    if (!rcVisit) return;
    const back = rcVisit;
    setRcVisit(null);
    rcGoToMap(back.parentId, back.host);
  }, [rcVisit, rcGoToMap]);
  // Clic en una causa de la LEYENDA: primero viaja a su nodo (acercamiento +
  // pulso) y, cuando termina la animación, abre el panel del análisis.
  const rcOpenFromLegend = useCallback(
    (n: number) => {
      const c = rcShown?.causes.find((x) => x.n === n);
      // Nodo propio o, si la causa vive dentro de un hijo, el nodo sub-mapa.
      const nid = c?.nodeIds.map(rcLocalId).find((id) => nodes.some((x) => x.id === id));
      if (!nid) {
        setRcOpen({ n });
        return;
      }
      setRcFocusId(nid);
      void fitView({ nodes: [{ id: nid }], padding: 0.9, duration: 600, maxZoom: 1.2 });
      window.setTimeout(() => setRcOpen({ n }), 750);
      window.setTimeout(() => setRcFocusId((cur) => (cur === nid ? null : cur)), 3200);
    },
    [rcShown, nodes, fitView],
  );
  const rcOpenCause = useMemo(
    () => (rcOpen ? (rcShown?.causes.find((c) => c.n === rcOpen.n) ?? null) : null),
    [rcOpen, rcShown],
  );

  // Firma de layout: cadena con el centro (redondeado) de cada nodo de severidad.
  // Solo CAMBIA cuando un nodo cruza de celda — como las posiciones van "snapped" a
  // la rejilla (24px), durante un arrastre fluido la firma se queda IGUAL casi
  // siempre. La usamos como dependencia estable del reparto de puertos para NO
  // recalcular (ni reconstruir TODAS las rayas) en cada frame del arrastre — solo
  // cuando el orden de los puertos puede cambiar de verdad. (El reanclado en vivo de
  // las rayas conectadas lo hace MapEdge por su cuenta vía useInternalNode.)
  const layoutSig = useMemo(() => {
    const abs = absolutePositions(nodes);
    return nodes
      .filter((n) => n.type === "severity" || n.type === "group")
      .map((n) => {
        const { w, h } = nodeSize(n);
        const p = abs.get(n.id) ?? n.position;
        return `${n.id}:${Math.round(p.x + w / 2)}:${Math.round(p.y + h / 2)}`;
      })
      .sort()
      .join("|");
  }, [nodes]);

  // Reparto de PUERTOS: cuando varias rayas tocan el mismo costado de un nodo, no
  // pueden anclarse todas al mismo punto (se amontonan). Para cada raya se decide el
  // costado de cada extremo (izq/der, según hacia dónde va) y su RANURA en ese lado
  // (índice/total), repartiendo las que comparten costado y ordenándolas por la
  // altura del OTRO extremo (reduce cruces). MapEdge las abre en abanico con esto.
  // Las recíprocas (A→B y B→A) caen en el mismo grupo de un costado → ranuras
  // distintas (ya no hace falta el viejo "separate").
  const edgePorts = useMemo(() => {
    const NB = new Map<string, { cx: number; cy: number }>();
    // Agrupadores incluidos: son un nodo más y aceptan conexiones. Posiciones
    // ABSOLUTAS (un miembro guarda la suya relativa al marco).
    const absPos = absolutePositions(nodes);
    nodes.forEach((n) => {
      if (n.type !== "severity" && n.type !== "group") return;
      const { w, h } = nodeSize(n);
      const p = absPos.get(n.id) ?? n.position;
      NB.set(n.id, { cx: p.x + w / 2, cy: p.y + h / 2 });
    });
    type P = { sSide: "left" | "right"; tSide: "left" | "right"; sIndex: number; sCount: number; tIndex: number; tCount: number };
    const ports = new Map<string, P>();
    const groups = new Map<string, { id: string; otherCy: number; end: "s" | "t" }[]>();
    const push = (key: string, v: { id: string; otherCy: number; end: "s" | "t" }) => {
      const arr = groups.get(key);
      if (arr) arr.push(v);
      else groups.set(key, [v]);
    };
    edges.forEach((e) => {
      const a = NB.get(e.source);
      const b = NB.get(e.target);
      if (!a || !b) return;
      const dxc = b.cx - a.cx;
      const goingRight = dxc !== 0 ? dxc > 0 : b.cy < a.cy;
      const sSide = goingRight ? "right" : "left";
      const tSide = goingRight ? "left" : "right";
      ports.set(e.id, { sSide, tSide, sIndex: 0, sCount: 1, tIndex: 0, tCount: 1 });
      push(e.source + "|" + sSide, { id: e.id, otherCy: b.cy, end: "s" });
      push(e.target + "|" + tSide, { id: e.id, otherCy: a.cy, end: "t" });
    });
    groups.forEach((arr) => {
      arr.sort((x, y) => x.otherCy - y.otherCy || (x.id < y.id ? -1 : 1));
      arr.forEach((item, i) => {
        const p = ports.get(item.id);
        if (!p) return;
        if (item.end === "s") {
          p.sIndex = i;
          p.sCount = arr.length;
        } else {
          p.tIndex = i;
          p.tCount = arr.length;
        }
      });
    });
    return ports;
    // Depende de `layoutSig` (proxy ESTABLE de las posiciones) en vez de `nodes`:
    // así NO se recalcula en cada frame del arrastre, solo cuando el orden de los
    // puertos puede cambiar. `nodes` se lee adentro pero a propósito no es dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutSig, edges]);

  // EVASIÓN de nodos: para cada raya, si la recta entre sus anclajes cruza algún
  // OTRO nodo, se calcula una curva que lo rodea (computeBend). Igual que el reparto
  // de puertos, se ata a `layoutSig` (estable): se recalcula SOLO cuando un nodo
  // cruza de celda, no en cada frame → no afecta la fluidez. Las rayas con camino
  // despejado no entran aquí (las dibuja MapEdge con su bezier en vivo).
  const edgeRoutes = useMemo(() => {
    const NB = new Map<string, Box>();
    // Agrupadores: valen como EXTREMO de una raya, pero NO como obstáculo — son
    // marcos grandes y rodearlos volvería un arco cualquier raya que los cruce
    // (incluidas las de sus propios miembros).
    const groupIds = new Set(nodes.filter((n) => n.type === "group").map((n) => n.id));
    const absPos = absolutePositions(nodes);
    nodes.forEach((n) => {
      if (n.type !== "severity" && n.type !== "group") return;
      const { w, h } = nodeSize(n);
      const p = absPos.get(n.id) ?? n.position;
      NB.set(n.id, { x: p.x, y: p.y, w, h, cx: p.x + w / 2, cy: p.y + h / 2 });
    });
    const routes = new Map<string, { sx: number; sy: number; tx: number; ty: number; c1x: number; c1y: number; c2x: number; c2y: number }>();
    // Red de seguridad: en mapas enormes no corremos la evasión (cuida el footprint).
    if (NB.size > 70) return routes;
    edges.forEach((e) => {
      const a = NB.get(e.source);
      const b = NB.get(e.target);
      const p = edgePorts.get(e.id);
      if (!a || !b || !p) return;
      const S = sideAnchor(a, p.sSide, slotOffset(p.sIndex, p.sCount, a.h));
      const E = sideAnchor(b, p.tSide, slotOffset(p.tIndex, p.tCount, b.h));
      const obstacles: Box[] = [];
      NB.forEach((bx, id) => {
        if (id !== e.source && id !== e.target && !groupIds.has(id)) obstacles.push(bx);
      });
      const bend = computeBend(S, E, obstacles);
      if (bend) routes.set(e.id, { sx: S.x, sy: S.y, tx: E.x, ty: E.y, ...bend });
    });
    return routes;
    // Igual que edgePorts: depende de la firma estable, no de `nodes`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutSig, edges, edgePorts]);

  // Color/animación de cada raya: se DERIVA de SU PROPIO DQL (independiente de los
  // nodos que une). Sin DQL → gris (unknown). La raya tiene estado propio (ver
  // EdgeEditorModal). data.port abre en abanico (RECTO/plano) las rayas que comparten
  // costado; las recíprocas (ida+regreso) quedan en carriles paralelos (arriba/abajo),
  // sin cruzarse. data.route (si existe) hace que la raya rodee los nodos que estorban.
  // TODAS las rayas marchan punteadas (animated) — solo cambia el color por severidad.
  // Mapa id-de-nodo → su DQL, para las rayas que HEREDAN el estado de su origen.
  // Memoizado por FIRMA (ids + DQLs): NO cambia al arrastrar un nodo (solo cambia
  // su posición, no su DQL) → displayEdges no recalcula en cada frame del arrastre.
  const srcDqlSig = nodes
    .map((n) => {
      // Un agrupador hereda el peor estado de sus miembros: la firma tiene que
      // cambiar cuando cambia la pertenencia (`parentId`), no solo los DQL.
      if (n.type === "group") return `${n.id}=group`;
      if (n.type !== "severity") return "";
      const d = n.data as SeverityNodeData;
      // La firma incluye DQL + entidad + fuente + regla de salud de conexiones:
      // si cambia el motor de estado del nodo de origen (o su regla de rojo),
      // las rayas que heredan deben recolorearse.
      return `${n.id}=${d.dql ?? ""}~${d.entity?.id ?? ""}~${d.statusSource ?? ""}~${d.mapRef?.id ?? ""}~${d.mapMetric ?? ""}~${JSON.stringify(d.mapRules ?? "")}~${d.connHealth ? 1 : 0}~${d.connHealthRedAt ?? ""}~${n.parentId ?? ""}`;
    })
    .join("|");
  // Severidad EFECTIVA de un nodo de origen (para las rayas que heredan su estado):
  // por Davis si está atado a esa fuente, por la salud de su sub-mapa, o por su
  // DQL propio. Igual criterio que displayNodes, para que la conexión herede el
  // color REAL del nodo.
  const sevBySource = useMemo(() => {
    const m = new Map<string, Severity>();
    nodes.forEach((n) => {
      if (n.type !== "severity") return;
      const d = n.data as SeverityNodeData;
      const source = nodeStatusSource(d);
      if (source === "davis" && d.entity?.id) {
        // Regla de salud de conexiones: si al nodo lo puso en rojo la regla,
        // las rayas que heredan también deben ir en rojo (igual que displayNodes).
        const info = d.connHealth ? connInfoByEntity.get(d.entity.id) : undefined;
        const ruled =
          typeof info?.pct === "number" && info.pct <= clampConnRedAt(d.connHealthRedAt ?? DEFAULT_CONN_RED_AT);
        if (ruled) m.set(n.id, 2);
        else m.set(n.id, davis.isReady ? (davis.byEntity[d.entity.id] ?? "unknown") : "unknown");
      } else if (source === "map" && d.mapRef?.id) {
        // Igual criterio que displayNodes (las mismas reglas del nodo), para que
        // la conexión herede el color REAL del mapa incrustado.
        const info = submap.byMap.get(d.mapRef.id);
        m.set(
          n.id,
          submapSeverity({
            ...d,
            mapPct: info?.pct,
            mapAffected: info?.affected,
            mapError: !info || Boolean(info.error),
          }),
        );
      } else m.set(n.id, sevOfDql(d.dql));
    });
    // AGRUPADORES: mismo criterio que displayNodes — el PEOR estado de sus
    // miembros (los neutros no cuentan). Así una raya que sale de un marco y
    // hereda el estado del origen lleva el color real del agrupador.
    const worst = new Map<string, 0 | 1 | 2>();
    nodes.forEach((n) => {
      if (!n.parentId) return;
      const s = m.get(n.id);
      if (s !== 0 && s !== 1 && s !== 2) return;
      const cur = worst.get(n.parentId);
      if (cur === undefined || s > cur) worst.set(n.parentId, s);
    });
    nodes.forEach((n) => {
      if (n.type === "group") m.set(n.id, worst.get(n.id) ?? "unknown");
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcDqlSig, davis, sevOfDql, connInfoByEntity, submap]);

  // ── Índices de topología (nodo ↔ entidad, aristas existentes) ────────────────
  // Nodo severity → id de entidad atada (con fuente davis). Y el inverso: por cada
  // id de entidad, el/los nodos del mapa que la representan (normalmente 1).
  const nodeEntityIndex = useMemo(() => {
    const nodeToEntity = new Map<string, string>();
    const entityToNodes = new Map<string, string[]>();
    nodes.forEach((n) => {
      if (n.type !== "severity") return;
      const d = n.data as SeverityNodeData;
      const source = nodeStatusSource(d);
      if (source !== "davis" || !d.entity?.id) return;
      nodeToEntity.set(n.id, d.entity.id);
      const arr = entityToNodes.get(d.entity.id) ?? [];
      arr.push(n.id);
      entityToNodes.set(d.entity.id, arr);
    });
    return { nodeToEntity, entityToNodes };
  }, [nodes]);

  // Firma de aristas existentes (para memos que dependen de "hay raya A→B / B→A").
  const edgePairSig = useMemo(
    () => edges.map((e) => `${e.source}>${e.target}`).sort().join("|"),
    [edges],
  );
  // ¿Existe una raya entre A y B en CUALQUIER sentido?
  const hasEdgeBetween = useCallback(
    (a: string, b: string) =>
      edges.some((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edgePairSig],
  );

  // Sugerencias globales de topología: pares de nodos atados con una relación
  // `calls` real (source llama a target) y SIN raya entre ellos todavía. Se toma
  // solo la dirección `calls` (la de `called_by` la aporta el nodo destino cuando
  // ES el origen de la llamada) para no duplicar la sugerencia.
  const topologySuggestions = useMemo<TopologySuggestion[]>(() => {
    const { nodeToEntity, entityToNodes } = nodeEntityIndex;
    const nameOf = (nodeId: string): string => {
      const n = nodes.find((x) => x.id === nodeId);
      return n ? (n.data as SeverityNodeData).name : nodeId;
    };
    const out: TopologySuggestion[] = [];
    const seen = new Set<string>();
    nodeToEntity.forEach((entityId, nodeId) => {
      const rel = relations.byEntity[entityId];
      if (!rel) return;
      rel.calls.forEach((targetEntity) => {
        const targetNodes = entityToNodes.get(targetEntity);
        if (!targetNodes) return;
        targetNodes.forEach((targetNode) => {
          if (targetNode === nodeId) return;
          if (hasEdgeBetween(nodeId, targetNode)) return;
          const key = `${nodeId}->${targetNode}`;
          if (seen.has(key)) return;
          seen.add(key);
          out.push({ source: nodeId, target: targetNode, sourceName: nameOf(nodeId), targetName: nameOf(targetNode) });
        });
      });
    });
    return out;
  }, [nodeEntityIndex, relations, nodes, hasEdgeBetween]);

  // ¿Hay al menos un nodo atado a Davis? Controla la visibilidad del botón de
  // topología en la barra de herramientas.
  const hasBoundNodes = boundEntities.length > 0;

  // Resaltado del popover "Relacionados": cuando está abierto, se atenúan todos
  // los nodos MENOS el seleccionado y sus vecinos "ya conectados" (relación real
  // + raya existente). null = popover cerrado (sin atenuar nada).
  const relatedHighlight = useMemo<Set<string> | null>(() => {
    if (!relatedNodeId) return null;
    const { nodeToEntity, entityToNodes } = nodeEntityIndex;
    const thisEntity = nodeToEntity.get(relatedNodeId);
    const keep = new Set<string>([relatedNodeId]);
    if (thisEntity) {
      const rel = relations.byEntity[thisEntity];
      const relatedIds = new Set<string>([...(rel?.calls ?? []), ...(rel?.calledBy ?? [])]);
      relatedIds.forEach((entId) => {
        (entityToNodes.get(entId) ?? []).forEach((nid) => {
          if (nid !== relatedNodeId && hasEdgeBetween(relatedNodeId, nid)) keep.add(nid);
        });
      });
    }
    return keep;
  }, [relatedNodeId, nodeEntityIndex, relations, hasEdgeBetween]);

  // Nodos que se ENTREGAN a ReactFlow: displayNodes + el atenuado del popover
  // "Relacionados" (reusa la clase mapa-node-dim de la edición de imagen). Sin
  // popover abierto es la MISMA referencia que displayNodes (sin coste extra).
  const renderNodes = useMemo(() => {
    let base = displayNodes;
    // Llegada suave del/los miembro(s) a su celda del agrupador (clase temporal).
    if (settleIds.length) {
      const settling = new Set(settleIds);
      base = base.map((n) =>
        settling.has(n.id)
          ? { ...n, className: `${n.className ? `${n.className} ` : ""}mapa-node-settle` }
          : n,
      );
    }
    if (!relatedHighlight) return base;
    return base.map((n) => {
      // El seleccionado y sus vecinos ya conectados quedan resaltados; el resto
      // se atenúa. El nodo abierto lleva además una clase de foco.
      if (relatedHighlight.has(n.id)) {
        const focus = n.id === relatedNodeId ? " mapa-node-related-focus" : "";
        const base = n.className ? `${n.className}${focus}` : focus.trim();
        return base ? { ...n, className: base } : n;
      }
      return { ...n, className: `${n.className ? `${n.className} ` : ""}mapa-node-dim` };
    });
  }, [displayNodes, relatedHighlight, relatedNodeId, settleIds]);

  const displayEdges = useMemo(() => {
    return edges.map((e) => {
      const ed = e.data as EdgeData | undefined;
      const inherit = (ed?.inheritStatus ?? true) === true;
      // Chip de valor: activo solo con el chulo puesto Y un DQL de valor escrito.
      const valueOn = ed?.valueEnabled === true && typeof ed.valueDql === "string" && ed.valueDql.trim() !== "";
      // Heredar → severidad EFECTIVA del nodo de origen (Davis o DQL); si no → la
      // del DQL propio de la raya.
      const sev = inherit
        ? (sevBySource.get(e.source) ?? "unknown")
        : sevOfDql(typeof ed?.dql === "string" ? ed.dql : undefined);
      return {
        ...e,
        type: "severity",
        animated: true,
        data: {
          ...e.data,
          port: edgePorts.get(e.id),
          route: edgeRoutes.get(e.id),
          valueOn,
          value: valueOn ? valueByDql[ed!.valueDql!] : undefined,
          valueName: valueOn ? ed?.valueLabel : undefined,
          valueLabel: valueOn && ed?.valueShowLabel === true ? ed?.valueLabel : undefined,
          valueUnit: valueOn ? ed?.valueUnit : undefined,
        },
        style: { stroke: sevColor(sev), strokeWidth: 2, opacity: 0.75 },
      };
    });
  }, [edges, sevBySource, sevOfDql, edgePorts, edgeRoutes, valueByDql]);

  const onConnect = useCallback(
    // Las rayas nuevas arrancan con el DQL por defecto (verde), igual que los nodos;
    // su estado es independiente y se edita haciendo clic en la raya.
    // Sí permitimos la inversa (A→B y B→A) y varias salidas/retornos a distintos
    // nodos; solo evitamos DUPLICAR una conexión que ya existe en la misma dirección.
    // El id se genera AQUÍ garantizando unicidad: el determinista de xyflow
    // (xy-edge__A-B) chocaba tras "Invertir dirección" (la raya invertida conserva
    // su id original) + volver a trazar la misma conexión → dos rayas con el MISMO
    // id (editar/borrar afectaba a ambas y el duplicado se persistía).
    (connection: Connection) =>
      setEdges((eds) => {
        if (eds.some((e) => e.source === connection.source && e.target === connection.target)) return eds;
        const taken = new Set(eds.map((e) => e.id));
        const base = `xy-edge__${connection.source}-${connection.target}`;
        let id = base;
        let k = 2;
        while (taken.has(id)) id = `${base}#${k++}`;
        return [
          ...eds,
          { id, source: connection.source, target: connection.target, data: { dql: DEFAULT_NODE_DQL } },
        ];
      }),
    [setEdges],
  );

  // Índice nodo → agrupador que lo contiene. Vive en un ref para que
  // `isValidConnection` (que ReactFlow guarda) no se recree en cada arrastre.
  const parentByNodeRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const m = new Map<string, string>();
    nodes.forEach((n) => {
      if (n.parentId) m.set(n.id, n.parentId);
    });
    parentByNodeRef.current = m;
  }, [nodes]);

  // Conexión válida: cualquier nodo con cualquier nodo, en cualquier dirección y
  // desde cualquier costado (modo "loose"). Bloqueamos el lazo a sí mismo y la
  // conexión de un miembro con SU PROPIO agrupador (en cualquier sentido): sería
  // una raya de un nodo a su propio marco, que no dice nada.
  const isValidConnection = useCallback<IsValidConnection>((c) => {
    if (c.source === c.target) return false;
    const parents = parentByNodeRef.current;
    if (parents.get(c.source) === c.target || parents.get(c.target) === c.source) return false;
    return true;
  }, []);

  // ── Crear rayas por TOPOLOGÍA (heredan el estado del origen, sin Grail) ──────
  // A diferencia de onConnect (raya con DQL propio verde), las rayas de topología
  // se crean con `data: { inheritStatus: true }`: heredan el color del nodo de
  // origen y NO gastan Grail. Reusa el patrón de id de onConnect (xy-edge__A-B con
  // sufijo #N si choca) y respeta el "no duplicar en la misma dirección".
  const connectInherit = useCallback(
    (pairs: Array<{ source: string; target: string }>) =>
      setEdges((eds) => {
        const taken = new Set(eds.map((e) => e.id));
        const additions: Edge[] = [];
        const pending = new Set<string>();
        for (const { source, target } of pairs) {
          if (source === target) continue;
          const dirKey = `${source}>${target}`;
          if (pending.has(dirKey)) continue;
          if (eds.some((e) => e.source === source && e.target === target)) continue;
          pending.add(dirKey);
          const base = `xy-edge__${source}-${target}`;
          let id = base;
          let k = 2;
          while (taken.has(id)) id = `${base}#${k++}`;
          taken.add(id);
          additions.push({ id, source, target, data: { inheritStatus: true } });
        }
        return additions.length > 0 ? [...eds, ...additions] : eds;
      }),
    [setEdges],
  );

  // "Agregar todas" del modal de topología: crea todas las rayas sugeridas.
  const addTopologyEdges = useCallback(
    (suggestions: TopologySuggestion[]) => {
      connectInherit(suggestions.map((s) => ({ source: s.source, target: s.target })));
      setTopologyOpen(false);
    },
    [connectInherit],
  );

  // ── Acciones del popover "Relacionados" ──────────────────────────────────────
  // Marca una raya como "sin respaldo ignorada": no se vuelve a listar en el
  // popover. Se persiste (topologyIgnored va en la whitelist de cleanSnapshot).
  const ignoreEdge = useCallback(
    (id: string) =>
      setEdges((eds) =>
        eds.map((e) => (e.id === id ? { ...e, data: { ...(e.data ?? {}), topologyIgnored: true } } : e)),
      ),
    [setEdges],
  );
  // Quita una raya (borrado directo, sin confirmación: es una acción puntual del
  // popover sobre una raya que el usuario ya identificó como sobrante).
  const removeEdge = useCallback(
    (id: string) => setEdges((eds) => eds.filter((e) => e.id !== id)),
    [setEdges],
  );

  // Crea un nodo NUEVO atado a una entidad (misma mecánica que addNode: contador
  // de ids n<N>), posicionado cerca de un nodo de referencia, y devuelve su id.
  const addEntityNodeNear = useCallback(
    (ref: EntityRef, nearNodeId: string): string => {
      counter.current += 1;
      const id = `n${counter.current}`;
      setNodes((nds) => {
        const near = nds.find((n) => n.id === nearNodeId);
        const base = near ? near.position : { x: 240, y: 144 };
        return nds.concat({
          id,
          type: "severity",
          position: { x: base.x + 200, y: base.y + 40 },
          data: {
            name: ref.name || ref.id,
            kind: "",
            severity: "unknown",
            icon: "shield",
            dql: DEFAULT_NODE_DQL,
            size: "md",
            entity: ref,
            statusSource: "davis",
          },
        });
      });
      return id;
    },
    [setNodes],
  );

  // "Agregar y conectar" (caso 3): crea el nodo de la entidad relacionada y traza
  // la raya en el sentido correcto (calls → this→other; calledBy → other→this).
  const addAndConnect = useCallback(
    (thisNodeId: string, ref: EntityRef, direction: "calls" | "calledBy") => {
      const newId = addEntityNodeNear(ref, thisNodeId);
      const pair =
        direction === "calls"
          ? { source: thisNodeId, target: newId }
          : { source: newId, target: thisNodeId };
      connectInherit([pair]);
    },
    [addEntityNodeNear, connectInherit],
  );

  // "Conectar" (caso 2): raya entre dos nodos YA en el mapa, en el sentido correcto
  // (calls → this→other; calledBy → other→this), heredando el estado del origen.
  const connectExisting = useCallback(
    (thisNodeId: string, otherNodeId: string, direction: "calls" | "calledBy") => {
      const pair =
        direction === "calls"
          ? { source: thisNodeId, target: otherNodeId }
          : { source: otherNodeId, target: thisNodeId };
      connectInherit([pair]);
    },
    [connectInherit],
  );

  // Exportar un snapshot como JSON (data propia del usuario, en el navegador).
  //
  // OJO con Safari/WebKit: dentro del iframe de App Engine IGNORA el atributo
  // `download` y, en vez de descargar, intenta NAVEGAR a la URL del archivo; el CSP
  // de la plataforma rechaza tanto `blob:` como `data:` ("Refused to load …
  // frame-src") y la app NO puede ampliar `frame-src` (el manifiesto solo deja
  // font/img/media/script/style-src). Chrome/Firefox sí respetan `download` y bajan
  // el archivo. Como en WebKit no hay descarga viable desde el iframe, abrimos el
  // modal "Exportar JSON" (Strato + portapapeles, que NO lo gobierna el CSP).
  const downloadSnapshot = useCallback(
    (snap: MapSnapshot, name: string) => {
      const json = JSON.stringify(cleanSnapshot(snap), null, 2);
      const safe = (name || "mapa").replace(/[^\w.-]+/g, "_").slice(0, 60) || "mapa";
      const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
      const isWebKit = /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|OPR|CriOS|FxiOS/.test(ua);

      if (isWebKit) {
        setExportData({ json, filename: safe });
        return;
      }

      // Chrome/Firefox/Edge: descarga real. MIME genérico (octet-stream → "guardar",
      // no "mostrar"), <a> en el DOM, clic sincrónico dentro del gesto del usuario,
      // y limpieza diferida (revocar el objectURL de inmediato cancela la descarga).
      const url = URL.createObjectURL(new Blob([json], { type: "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safe}.json`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 10_000);
    },
    [setExportData],
  );

  // Descargar el mapa activo (estado actual) o cualquier otro de la lista (por id).
  const downloadMap = useCallback(
    async (id: string, name: string) => {
      if (id === activeId) {
        downloadSnapshot({ nodes, edges, settings, mapType }, name);
        return;
      }
      try {
        downloadSnapshot(await loadSnapshot(id), name);
      } catch {
        setNotice(t("lib.downloadFail"));
      }
    },
    [activeId, nodes, edges, settings, mapType, loadSnapshot, downloadSnapshot, setNotice, t],
  );

  // ── Historial de versiones: handlers del control VersionHistory ──────────────
  // Preview: carga la versión en el lienzo SIN guardar (previewRef bloquea el save)
  // y la encuadra. Salir/Restaurar re-hidratan el mapa real.
  const onPreviewVersion = useCallback(
    (snap: MapSnapshot, label: string) => {
      previewRef.current = true;
      setPreviewLabel(label);
      // La preview NO es un paso de deshacer: sin esto, el efecto de historial
      // registraba el contenido de la versión previsualizada como paso de undo.
      travelingRef.current = true;
      applySerialized(serializeSnap(snap));
      requestAnimationFrame(() => void fitView({ padding: 0.2, duration: 400, minZoom: 0.05, maxZoom: 1.5 }));
    },
    [applySerialized, fitView],
  );
  // Salir de la preview: NO levantamos el bloqueo de guardado hasta que la
  // recarga del mapa real RESUELVA. Si falla (red), el lienzo seguiría mostrando
  // la versión vieja y cualquier edición la persistiría como contenido real.
  const exitPreview = useCallback(() => {
    void reloadActive()
      .then(() => {
        previewRef.current = false;
        setPreviewLabel(null);
      })
      .catch(() => setNotice(t("ver.actionError")));
  }, [reloadActive, setNotice, t]);
  const onRestoredVersion = useCallback(() => {
    void reloadActive()
      .then(() => {
        previewRef.current = false;
        setPreviewLabel(null);
      })
      .catch(() => setNotice(t("ver.actionError")));
  }, [reloadActive, setNotice, t]);
  const onDuplicateVersion = useCallback(
    (snap: MapSnapshot) => void createMap(t("persist.copyOf", { name: activeName }), snap),
    [createMap, activeName, t],
  );
  const onDownloadVersion = useCallback(
    (snap: MapSnapshot, label: string) => downloadSnapshot(snap, `${activeName} ${label}`),
    [downloadSnapshot, activeName],
  );
  const requestDeleteMap = useCallback((id: string) => setConfirm({ kind: "map", id }), []);

  const addNode = useCallback(() => {
    counter.current += 1;
    const i = counter.current;
    const id = `n${i}`;
    setNodes((nds) =>
      nds.concat({
        id,
        type: "severity",
        position: { x: 240 + (i % 5) * GRID_SIZE, y: 144 + (i % 5) * GRID_SIZE },
        data: { name: t("node.defaultName", { i }), kind: "", severity: "unknown", icon: "shield", dql: DEFAULT_NODE_DQL, size: "md" },
      }),
    );
    // Un nodo nuevo abre directo su editor (para escribir el DQL enseguida).
    setEditorNodeId(id);
  }, [setNodes, t]);

  // ── Agrupador: crear el marco ───────────────────────────────────────────────
  // Misma mecánica que addNode (contador de ids + posición escalonada), pero el
  // nodo se inserta AL PRINCIPIO del arreglo: en los subflujos de React Flow el
  // padre debe ir siempre antes que sus hijos.
  const addGroup = useCallback(() => {
    counter.current += 1;
    const i = counter.current;
    const id = `g${i}`;
    setNodes((nds) =>
      orderNodesForFlow([
        {
          id,
          type: "group",
          position: { x: 240 + (i % 5) * GRID_SIZE, y: 144 + (i % 5) * GRID_SIZE },
          width: GROUP_DEFAULT_W,
          height: GROUP_DEFAULT_H,
          data: { name: t("group.defaultName", { i }) },
        },
        ...nds,
      ]),
    );
  }, [setNodes, t]);

  // Renombrar el agrupador (doble clic en la píldora de su título).
  const renameGroup = useCallback(
    (id: string, name: string) =>
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data: { ...(n.data as GroupNodeData), name } } : n)),
      ),
    [setNodes],
  );

  // ── Adopción / liberación por arrastre ──────────────────────────────────────
  // Al soltar un nodo de servicio: si su CENTRO cayó dentro de un agrupador, el
  // marco lo adopta (parentId + posición relativa); si estaba adentro y su centro
  // quedó afuera, lo libera (posición absoluta, sin parentId). En ambos casos se
  // reacomoda el contenido del marco y se anima. El guardado y el deshacer salen
  // solos del cambio de `nodes` (flujo normal de la app).
  // Umbral del "tira y afloje" (px que el CENTRO del miembro debe cruzar más
  // allá del borde de su marco para que el marco lo suelte al caer).
  const PULL_THRESHOLD = 72;
  // Distancia (Chebyshev) del centro al rect del marco: 0 = adentro.
  const outDistance = (cx: number, cy: number, b: { x: number; y: number; w: number; h: number }) =>
    Math.max(b.x - cx, cx - (b.x + b.w), b.y - cy, cy - (b.y + b.h), 0);

  // Al ARRANCAR el arrastre: se congelan las cajas de los agrupadores (posición
  // absoluta + tamaño). Es lo único que hace falta para el resaltado en vivo.
  const onNodeDragStart = useCallback(
    (_event: MouseEvent | TouchEvent, node: Node) => {
      if (readOnly || imageEditMode || previewRef.current || node.type !== "severity") {
        dragBoundsRef.current = [];
        return;
      }
      const abs = absolutePositions(nodes);
      dragBoundsRef.current = nodes
        .filter((n) => n.type === "group")
        .map((g) => {
          const p = abs.get(g.id) ?? g.position;
          const s = nodeSize(g);
          return { id: g.id, x: p.x, y: p.y, w: s.w, h: s.h };
        });
    },
    [nodes, readOnly, imageEditMode],
  );

  // Durante el arrastre: se resalta el marco que recibiría al nodo. Se dispara
  // MUCHÍSIMO, así que solo se prueba el centro contra las cajas congeladas y
  // solo hay setState cuando CAMBIA el marco objetivo (no en cada frame).
  const onNodeDrag = useCallback(
    (_event: MouseEvent | TouchEvent, node: Node) => {
      const boxes = dragBoundsRef.current;
      if (!boxes.length) return;
      // Posición absoluta del nodo arrastrado: si es miembro de un marco, su
      // `position` es relativa (React Flow la reporta así durante el arrastre).
      let x = node.position.x;
      let y = node.position.y;
      if (node.parentId) {
        const parent = boxes.find((b) => b.id === node.parentId);
        if (parent) {
          x += parent.x;
          y += parent.y;
        }
      }
      const s = nodeSize(node);
      const cx = x + s.w / 2;
      const cy = y + s.h / 2;
      let over: string | null = null;
      for (const b of boxes) {
        if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) {
          over = b.id;
          break;
        }
      }
      // El marco al que YA pertenece no se resalta: no lo va a "recibir".
      if (over === node.parentId) over = null;
      setHoverGroupId((prev) => (prev === over ? prev : over));
      // Tira y afloje con el marco PROPIO: mientras el centro esté afuera pero
      // dentro del umbral, el marco "lo retiene"; más allá, "lo suelta".
      let pull: { id: string; mode: "hold" | "free" } | null = null;
      if (node.parentId) {
        const own = boxes.find((b) => b.id === node.parentId);
        if (own) {
          const d = outDistance(cx, cy, own);
          if (d > 0) pull = { id: own.id, mode: d <= PULL_THRESHOLD ? "hold" : "free" };
        }
      }
      setPullState((prev) => (prev?.id === pull?.id && prev?.mode === pull?.mode ? prev : pull));
    },
    [],
  );

  const onNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, node: Node) => {
      dragBoundsRef.current = [];
      setHoverGroupId(null);
      setPullState(null);
      // Solo en modo edición y solo nodos de servicio: los títulos, la imagen de
      // fondo y otros agrupadores NO se agrupan (no hay agrupadores anidados).
      if (readOnly || imageEditMode || previewRef.current) return;
      if (node.type !== "severity") return;
      const abs = absolutePositions(nodes);
      const cur = nodes.find((n) => n.id === node.id);
      if (!cur) return;
      const { w, h } = nodeSize(cur);
      const p = abs.get(cur.id) ?? cur.position;
      const cx = p.x + w / 2;
      const cy = p.y + h / 2;
      // Primer agrupador que contenga el centro (en la práctica no se solapan).
      const target = nodes.find((g) => {
        if (g.type !== "group") return false;
        const gp = abs.get(g.id) ?? g.position;
        const gs = nodeSize(g);
        return cx >= gp.x && cx <= gp.x + gs.w && cy >= gp.y && cy <= gp.y + gs.h;
      });
      const prevParent = typeof cur.parentId === "string" ? cur.parentId : undefined;
      // Tira y afloje: un miembro que quedó AFUERA de su marco pero sin cruzar el
      // umbral NO se libera — regresa animado al punto más cercano de adentro.
      if (prevParent) {
        const own = nodes.find((g) => g.id === prevParent);
        if (own) {
          const gp = abs.get(own.id) ?? own.position;
          const gs = nodeSize(own);
          const d = outDistance(cx, cy, { x: gp.x, y: gp.y, w: gs.w, h: gs.h });
          if (d > 0 && d <= PULL_THRESHOLD) {
            // Punto más cercano DENTRO del marco (con margen y sin pisar el título).
            const relX = Math.min(Math.max(p.x - gp.x, 12), Math.max(gs.w - w - 12, 12));
            const relY = Math.min(Math.max(p.y - gp.y, 32), Math.max(gs.h - h - 12, 32));
            setNodes((nds) =>
              nds.map((n) => (n.id === cur.id ? { ...n, position: { x: relX, y: relY } } : n)),
            );
            pulseGroup(prevParent, [cur.id]); // destello del marco + regreso suave
            return;
          }
        }
      }
      const nextParent = target?.id;
      if (prevParent === nextParent && (prevParent !== undefined || !nodes.some((g) => {
        if (g.type !== "group") return false;
        const gp = abs.get(g.id) ?? g.position;
        const gs = nodeSize(g);
        return p.x < gp.x + gs.w && p.x + w > gp.x && p.y < gp.y + gs.h && p.y + h > gp.y;
      }))) {
        // Sin cambio de pertenencia. Pero un nodo NUNCA queda montado sobre la
        // línea del marco: si sigue siendo miembro y sobresale, se mete completo.
        if (prevParent && target) {
          const gp = abs.get(target.id) ?? target.position;
          const gs = nodeSize(target);
          const relX = Math.min(Math.max(p.x - gp.x, 12), Math.max(gs.w - w - 12, 12));
          const relY = Math.min(Math.max(p.y - gp.y, 32), Math.max(gs.h - h - 12, 32));
          if (Math.abs(relX - (p.x - gp.x)) > 0.5 || Math.abs(relY - (p.y - gp.y)) > 0.5) {
            setNodes((nds) =>
              nds.map((n) => (n.id === cur.id ? { ...n, position: { x: relX, y: relY } } : n)),
            );
            pulseGroup(prevParent, [cur.id]);
          }
        }
        return;
      }
      // Al LIBERARSE (o al caer suelto rozando un marco), el nodo tampoco queda
      // sobre la línea: se corre hacia el lado por el que salió hasta despejar
      // el borde (con un margen de 12px).
      const clearOfGroup = (pos: { x: number; y: number }, gid: string): { x: number; y: number } => {
        const g = nodes.find((n) => n.id === gid);
        if (!g) return pos;
        const gp = abs.get(gid) ?? g.position;
        const gs = nodeSize(g);
        const overlaps = pos.x < gp.x + gs.w && pos.x + w > gp.x && pos.y < gp.y + gs.h && pos.y + h > gp.y;
        if (!overlaps) return pos;
        const dl = gp.x - cx;
        const dr = cx - (gp.x + gs.w);
        const dt = gp.y - cy;
        const db = cy - (gp.y + gs.h);
        const m = Math.max(dl, dr, dt, db);
        if (m === dl) return { x: gp.x - w - 12, y: pos.y };
        if (m === dr) return { x: gp.x + gs.w + 12, y: pos.y };
        if (m === dt) return { x: pos.x, y: gp.y - h - 12 };
        return { x: pos.x, y: gp.y + gs.h + 12 };
      };
      // Marco contra el que hay que despejar: el que suelta al nodo o, si el nodo
      // venía suelto, cualquiera cuyo borde haya quedado pisando.
      const clearAgainst = prevParent ?? nodes.find((g) => {
        if (g.type !== "group") return false;
        const gp = abs.get(g.id) ?? g.position;
        const gs = nodeSize(g);
        return p.x < gp.x + gs.w && p.x + w > gp.x && p.y < gp.y + gs.h && p.y + h > gp.y;
      })?.id;
      const freePos = !target && clearAgainst ? clearOfGroup({ x: p.x, y: p.y }, clearAgainst) : null;
      setNodes((nds) => {
        const absNow = absolutePositions(nds);
        const moved = nds.map((n) => {
          if (n.id !== cur.id) return n;
          const a = absNow.get(n.id) ?? n.position;
          if (!target) return { ...n, parentId: undefined, extent: undefined, position: freePos ?? a };
          const gp = absNow.get(target.id) ?? target.position;
          return { ...n, parentId: target.id, extent: undefined, position: { x: a.x - gp.x, y: a.y - gp.y } };
        });
        // Reacomodo del marco que lo suelta y del que lo recibe.
        let out = orderNodesForFlow(moved);
        if (prevParent) out = layoutGroupMembers(out, prevParent);
        if (nextParent) out = layoutGroupMembers(out, nextParent);
        return out;
      });
      // Destello del marco afectado; al adoptar, además, los miembros llegan suave.
      // Al liberar/despejar, el propio nodo también llega suave a su sitio final.
      const flashId = nextParent ?? prevParent ?? (freePos ? clearAgainst : undefined);
      if (flashId) {
        pulseGroup(
          flashId,
          nextParent
            ? nodes.filter((n) => n.parentId === nextParent).map((n) => n.id).concat(cur.id)
            : freePos
              ? [cur.id]
              : [],
        );
      }
    },
    [nodes, readOnly, imageEditMode, setNodes, pulseGroup],
  );

  // Borrar un agrupador: se va SOLO el marco. Sus miembros quedan sueltos en el
  // lienzo, en el mismo sitio donde se veían (posición relativa → absoluta).
  const deleteGroup = useCallback(
    (id: string) => {
      setNodes((nds) => {
        const g = nds.find((n) => n.id === id);
        if (!g) return nds;
        return nds
          .filter((n) => n.id !== id)
          .map((n) =>
            n.parentId === id
              ? {
                  ...n,
                  parentId: undefined,
                  position: { x: g.position.x + n.position.x, y: g.position.y + n.position.y },
                }
              : n,
          );
      });
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    },
    [setNodes, setEdges],
  );

  // ── Soltar un mapa de la lista sobre el lienzo → nodo de mapa incrustado ─────
  // Crea el nodo YA atado al mapa hijo, con las reglas de color por defecto, en la
  // posición donde se soltó. No abre el editor (el nodo queda listo); el usuario
  // puede afinar reglas y métrica con "Editar".
  const addSubmapNode = useCallback(
    (ref: { id: string; name: string }, position: { x: number; y: number }) => {
      counter.current += 1;
      const id = `n${counter.current}`;
      setNodes((nds) =>
        nds.concat({
          id,
          type: "severity",
          position,
          data: {
            name: ref.name,
            kind: "",
            severity: "unknown",
            icon: SUBMAP_ICON_ID,
            dql: DEFAULT_NODE_DQL,
            size: "md",
            statusSource: "map",
            mapRef: ref,
            mapMetric: DEFAULT_SUBMAP_METRIC,
            mapRules: DEFAULT_SUBMAP_RULES,
          },
        }),
      );
    },
    [setNodes],
  );

  const onCanvasDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!hasMap || readOnly || previewRef.current || imageEditMode) return;
      if (!dragHasMap(e)) return;
      e.preventDefault();
      // En un Mapa de Servicio no se puede soltar un mapa: el cursor lo dice
      // antes de soltarlo, y al soltar sale el aviso del porqué.
      e.dataTransfer.dropEffect = isParentMap ? "copy" : "none";
    },
    [hasMap, readOnly, imageEditMode, isParentMap],
  );

  const onCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      if (!hasMap || readOnly || previewRef.current || imageEditMode) return;
      if (!dragHasMap(e)) return;
      e.preventDefault();
      // Solo un Mapa Padre acepta mapas incrustados.
      if (!isParentMap) {
        setNotice(t("submap.dropNotParent"));
        return;
      }
      const raw = e.dataTransfer.getData(SUBMAP_DND_MIME);
      // La posición se calcula YA (con las coordenadas del evento), antes de
      // cualquier await: después el evento ya no sirve.
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      let ref: { id: string; name: string } | null = null;
      let draggedType: unknown;
      try {
        const parsed = JSON.parse(raw) as { id?: unknown; name?: unknown; mapType?: unknown };
        draggedType = parsed.mapType;
        if (typeof parsed.id === "string" && parsed.id) {
          ref = { id: parsed.id, name: typeof parsed.name === "string" ? parsed.name : parsed.id };
        }
      } catch {
        /* payload ajeno o corrupto: se ignora el drop */
      }
      if (!ref) return;
      // Auto-referencia: un mapa no puede contenerse a sí mismo.
      if (ref.id === activeId) {
        setNotice(t("submap.dropSelf"));
        return;
      }
      // Un Mapa Padre no se puede incrustar (jerarquía de máximo 2 niveles). Se
      // corta ya con el tipo que trae el arrastre, y luego se revalida contra el
      // documento por si viene de una versión vieja o de un import.
      if (draggedType === "parent") {
        setNotice(t("submap.nestedRejected"));
        return;
      }
      // Un mismo mapa solo puede estar UNA vez dentro del padre.
      if (submapIds.includes(ref.id)) {
        setNotice(t("submap.dropDuplicate"));
        return;
      }
      const target = ref;
      // La descarga queda cacheada y la reusa la evaluación del estado.
      void loadMapDoc(target.id, loadSnapshot)
        .then((snap) => {
          if (!isNestableChild(snap)) {
            setNotice(t("submap.nestedRejected"));
            return;
          }
          addSubmapNode(target, position);
        })
        .catch(() => setNotice(t("submap.checkFailed")));
    },
    [
      hasMap,
      readOnly,
      imageEditMode,
      isParentMap,
      screenToFlowPosition,
      activeId,
      submapIds,
      loadSnapshot,
      addSubmapNode,
      setNotice,
      t,
    ],
  );

  const addLabel = useCallback(() => {
    counter.current += 1;
    const id = `l${counter.current}`;
    setNodes((nds) =>
      nds.concat({ id, type: "label", position: { x: 168, y: 24 }, data: { text: "" }, draggable: true }),
    );
    // Un título nuevo entra directo en modo edición (textarea con placeholder).
    setEditingLabelId(id);
  }, [setNodes]);

  // Duplica un título: clon con id nuevo, desplazado un poco; queda seleccionado.
  const duplicateLabel = useCallback(
    (sourceId: string) => {
      setNodes((nds) => {
        const src = nds.find((n) => n.id === sourceId);
        if (!src) return nds;
        counter.current += 1;
        const id = `l${counter.current}`;
        const data = { ...(src.data as LabelNodeData) };
        return nds.concat({
          id,
          type: "label",
          position: { x: src.position.x + 24, y: src.position.y + 24 },
          data,
          draggable: true,
        });
      });
    },
    [setNodes],
  );

  // Duplica un nodo de servicio: clon con id nuevo, desplazado un poco. Conserva
  // su DQL/ícono/forma; la severidad se recalcula sola con el probe.
  const duplicateNode = useCallback(
    (sourceId: string) => {
      setNodes((nds) => {
        const src = nds.find((n) => n.id === sourceId);
        if (!src || src.type !== "severity") return nds;
        counter.current += 1;
        const id = `n${counter.current}`;
        const data = { ...(src.data as SeverityNodeData) };
        return nds.concat({
          id,
          type: "severity",
          position: { x: src.position.x + 24, y: src.position.y + 24 },
          data,
          // Si el original es miembro de un agrupador, el clon nace en el mismo
          // marco: su `position` es RELATIVA y afuera caería en un sitio errado.
          ...(src.parentId ? { parentId: src.parentId } : {}),
        });
      });
    },
    [setNodes],
  );

  // Abrir el selector de archivo para elegir una imagen de fondo.
  const addImage = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Pipeline de inserción de imagen: downscale → re-encode → tope 5 MB → nodo único.
  const onPickImage = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Permite re-subir la misma imagen
      e.target.value = "";
      // Solo PNG/JPG (aunque el input ya lo filtra, validamos por si arrastran otro).
      const isPng = file.type === "image/png";
      const isJpg = file.type === "image/jpeg";
      if (!isPng && !isJpg) {
        window.alert(t("image.badType"));
        return;
      }
      // Tope DURO de 5 MB sobre el archivo ORIGINAL: si pesa más, avisamos y NO lo
      // aceptamos (no lo encogemos a la fuerza). 5 MB ya es bastante para un fondo.
      if (file.size > 5 * 1024 * 1024) {
        window.alert(t("image.tooBig"));
        return;
      }
      const reader = new FileReader();
      // El archivo no se pudo leer (disco/permiso): avisamos en vez de quedar mudo.
      reader.onerror = () => window.alert(t("image.readError"));
      reader.onload = () => {
        const dataURL = reader.result as string;
        const img = new Image();
        // El archivo no decodifica como imagen (corrupto, truncado o no es imagen).
        img.onerror = () => window.alert(t("image.decodeError"));
        img.onload = () => {
          // 1. Downscale: ajusta al máximo de 1920px en el lado mayor.
          const MAX_DIM = 1920;
          const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.round(img.naturalWidth * scale);
          const h = Math.round(img.naturalHeight * scale);
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            window.alert(t("image.decodeError"));
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);

          // 2. Re-encode y tope 5 MB.
          const MAX_BYTES = 5 * 1024 * 1024;
          const estimatedBytes = (dataUrl: string) => {
            const b64 = dataUrl.split(",")[1] ?? "";
            return Math.ceil((b64.length * 3) / 4);
          };

          let finalDataUrl = "";
          // PNG: intentamos conservar PNG; pero el canvas re-codifica a 32-bit RGBA,
          // así que un PNG indexado/optimizado puede CRECER por encima del tope aunque
          // el original pesara menos. Si pasa, caemos a JPEG (es un fondo opaco, no
          // necesita alfa) en vez de rechazar una imagen válida con un mensaje confuso.
          if (isPng) {
            const png = canvas.toDataURL("image/png");
            if (estimatedBytes(png) <= MAX_BYTES) finalDataUrl = png;
          }
          if (!finalDataUrl) {
            // JPEG: baja la calidad hasta caber en el tope (siempre encoge).
            for (const q of [0.85, 0.8, 0.7, 0.6, 0.5]) {
              finalDataUrl = canvas.toDataURL("image/jpeg", q);
              if (estimatedBytes(finalDataUrl) <= MAX_BYTES) break;
            }
            if (estimatedBytes(finalDataUrl) > MAX_BYTES) {
              window.alert(t("image.tooBig"));
              return;
            }
          }

          // 3. Tamaño de despliegue en el lienzo: encajar en ~640px de lado mayor.
          const MAX_CANVAS = 640;
          const dispScale = Math.min(1, MAX_CANVAS / Math.max(w, h));
          const dispW = Math.round(w * dispScale);
          const dispH = Math.round(h * dispScale);

          // 4. Una sola imagen por mapa: elimina la existente y añade la nueva.
          counter.current += 1;
          const id = `img${counter.current}`;
          setNodes((nds) => {
            const withoutImage = nds.filter((n) => n.type !== "image");
            const imageNode: Node = {
              id,
              type: "image",
              position: { x: 40, y: 40 },
              width: dispW,
              height: dispH,
              zIndex: -1,
              draggable: false,
              selectable: false,
              connectable: false,
              data: { src: finalDataUrl, opacity: 1 },
            };
            return [imageNode, ...withoutImage];
          });
          // La imagen recién subida queda DIRECTO en modo edición (mover/redimensionar
          // de una, sin tener que darle a "Editar imagen" aparte).
          setImageEditMode(true);
        };
        img.src = dataURL;
      };
      reader.readAsDataURL(file);
    },
    [setNodes, t],
  );

  // "Re-Organizar": ordena los nodos de severidad en columnas por nivel de flujo
  // (longest-path) y dentro de cada columna los reparte UNIFORME (como antes), pero
  // SIN reubicar el grupo: cada columna se centra en el PROMEDIO de las alturas
  // actuales de sus nodos (no en una línea fija), así no se sube ni se baja todo.
  // Conserva el orden vertical actual y deja todo encajado en la rejilla.
  const autoOrganize = useCallback(() => {
    // Señalamos que, una vez aplicadas las nuevas posiciones, hay que reencuadrar
    // el lienzo (el efecto de abajo lo hace cuando ya cambió `nodes`).
    fitAfterOrganizeRef.current = true;
    setNodes((nds) => {
      // Participan en el layout global los nodos de servicio SUELTOS y los
      // AGRUPADORES (cada marco cuenta como UN bloque). Los miembros de un
      // agrupador quedan fuera: conservan su posición relativa y se mueven con
      // su marco.
      const sevIds = new Set(
        nds.filter((n) => (n.type === "severity" || n.type === "group") && !n.parentId).map((n) => n.id),
      );
      // Capas por longest-path, pero CICLO-SEGURO. Las rayas recíprocas (A→B y B→A)
      // —y cualquier ciclo— hacían que el longest-path iterativo "ratcheteara" las
      // capas hasta el tope de iteraciones, mandando esos nodos larguísimo a la
      // derecha (justo lo de ALB ↔ Base de Datos). Solución: primero quitamos las
      // back-edges (las que cierran un ciclo) con un DFS y dejamos un DAG; sobre ese
      // DAG el longest-path converge sin dispararse.
      const adj: Record<string, string[]> = {};
      sevIds.forEach((id) => (adj[id] = []));
      edges.forEach((e) => {
        if (sevIds.has(e.source) && sevIds.has(e.target) && e.source !== e.target) {
          adj[e.source].push(e.target);
        }
      });
      const WHITE = 0;
      const GRAY = 1;
      const BLACK = 2;
      const visit: Record<string, number> = {};
      sevIds.forEach((id) => (visit[id] = WHITE));
      const dag: Array<[string, string]> = [];
      sevIds.forEach((root) => {
        if (visit[root] !== WHITE) return;
        // DFS ITERATIVO (sin recursión, para no reventar el stack en mapas grandes).
        const stack: Array<{ u: string; i: number }> = [{ u: root, i: 0 }];
        visit[root] = GRAY;
        while (stack.length) {
          const top = stack[stack.length - 1];
          const nbrs = adj[top.u];
          if (top.i < nbrs.length) {
            const v = nbrs[top.i];
            top.i += 1;
            if (visit[v] === GRAY) continue; // back-edge (cierra un ciclo) → ignorar
            dag.push([top.u, v]); // arista válida del DAG (forward/cross)
            if (visit[v] === WHITE) {
              visit[v] = GRAY;
              stack.push({ u: v, i: 0 });
            }
          } else {
            visit[top.u] = BLACK;
            stack.pop();
          }
        }
      });
      const layer: Record<string, number> = {};
      sevIds.forEach((id) => (layer[id] = 0));
      for (let k = 0; k < sevIds.size; k++) {
        let changed = false;
        dag.forEach(([u, v]) => {
          if (layer[v] < layer[u] + 1) {
            layer[v] = layer[u] + 1;
            changed = true;
          }
        });
        if (!changed) break;
      }
      // Pasos VARIABLES solo si el mapa tiene agrupadores: un marco es mucho más
      // grande que un nodo y con el paso fijo se encimaría con la columna/fila de
      // al lado. Sin agrupadores se usan GX/GY tal cual, así que un mapa de los de
      // siempre se reorganiza EXACTAMENTE igual que antes.
      const hasGroups = nds.some((n) => n.type === "group");
      const GX = 336; // paso horizontal entre columnas (múltiplo de la rejilla)
      const GY = 144; // paso vertical uniforme dentro de la columna (múltiplo de la rejilla)
      const X0 = 48;
      const COL_SEP = 48; // aire entre el nodo más ancho de una columna y la siguiente
      const ROW_SEP = 48; // aire entre un nodo y el de abajo en la misma columna
      const snap = (v: number) => Math.round(v / GRID_SIZE) * GRID_SIZE;
      // Agrupar por columna con la posición y el TAMAÑO actuales de cada nodo.
      const cols: Record<number, { id: string; y: number; w: number; h: number }[]> = {};
      nds.forEach((n) => {
        if (!sevIds.has(n.id)) return;
        const { w, h } = nodeSize(n);
        (cols[layer[n.id]] = cols[layer[n.id]] || []).push({ id: n.id, y: n.position.y, w, h });
      });
      const newPos: Record<string, { x: number; y: number }> = {};
      let x = X0;
      Object.keys(cols)
        .map(Number)
        .sort((a, b) => a - b)
        .forEach((L) => {
          const arr = cols[L];
          arr.sort((a, b) => a.y - b.y); // respeta el orden vertical actual
          // Paso hacia el siguiente nodo de la columna: el de siempre, o el alto
          // real del nodo si es más grande (un agrupador).
          const steps = arr.map((it) => (hasGroups ? Math.max(GY, snap(it.h + ROW_SEP)) : GY));
          const span = steps.slice(0, -1).reduce((s, v) => s + v, 0);
          const avg = arr.reduce((s, it) => s + it.y, 0) / arr.length; // centro = promedio actual
          let y = snap(avg - span / 2); // reparto alrededor del promedio
          arr.forEach((it, i) => {
            newPos[it.id] = { x, y };
            y += steps[i];
          });
          const colW = arr.reduce((m, it) => Math.max(m, it.w), 0);
          x += hasGroups ? Math.max(GX, snap(colW + COL_SEP)) : GX;
        });
      return nds.map((n) => (newPos[n.id] ? { ...n, position: newPos[n.id] } : n));
    });
  }, [setNodes, edges]);

  // Reencuadre tras "Reorganizar": cuando `nodes` ya trae las nuevas posiciones,
  // hacemos fitView para que TODO el grafo quede a la vista. Esto es lo que RESCATA
  // los nodos "perdidos" de un mapa que ya sufrió el bug: autoOrganize recalcula la X
  // de cada nodo desde cero (48 + nivel·336), así que un nodo que estaba en x=9000
  // vuelve a una X sana, y este fitView lo trae a cuadro.
  // `minZoom: 0.05` es CLAVE: permite que el encuadre se abra todo lo necesario para
  // que entren hasta los mapas muy anchos (con el minZoom normal 0.2 no alcanzaba y
  // los extremos seguían quedando fuera). Gated por el ref → solo tras reorganizar.
  // requestAnimationFrame: esperamos a que ReactFlow mida/posicione antes de encuadrar.
  useEffect(() => {
    if (!fitAfterOrganizeRef.current) return;
    fitAfterOrganizeRef.current = false;
    const id = requestAnimationFrame(() => {
      void fitView({ padding: 0.2, duration: 500, minZoom: 0.05, maxZoom: 1.5 });
    });
    return () => cancelAnimationFrame(id);
  }, [nodes, fitView]);

  const updateNode = useCallback(
    (id: string, patch: Partial<SeverityNodeData>) =>
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data: { ...(n.data as SeverityNodeData), ...patch } } : n)),
      ),
    [setNodes],
  );

  const updateLabel = useCallback(
    (id: string, patch: Partial<LabelNodeData>) =>
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data: { ...(n.data as LabelNodeData), ...patch } } : n)),
      ),
    [setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    },
    [setNodes, setEdges],
  );

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      // En modo edición de imagen no abrimos el editor de nodos/etiquetas.
      if (imageEditMode) return;
      // Con Cmd/Ctrl/Shift se está MULTI-seleccionando (para mover varios a la vez):
      // dejamos que reactflow maneje la selección y NO mostramos popup ni editor.
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      // Si había un título en edición y se hace clic en otro nodo, salimos de edición.
      if (editingLabelId && editingLabelId !== node.id) setEditingLabelId(null);
      setPinnedEdgeId(null);
      // El clic ya NO abre el editor: solo selecciona (reactflow) y deja fijo el popup
      // "Editar" del nodo. En SOLO LECTURA no hay popup ni editor (ni siquiera para
      // ver el DQL): el destinatario solo ve el mapa.
    },
    [imageEditMode, editingLabelId],
  );

  // Clic en una conexión: la fija (popup "Editar") sin abrir el editor. En solo
  // lectura no hace nada.
  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      setEditingLabelId(null);
      if (readOnly) return;
      setPinnedEdgeId(edge.id);
    },
    [readOnly],
  );

  // Clic en el lienzo vacío: deselecciona todo y cierra el popup/edición de título.
  const onPaneClick = useCallback(() => {
    setPinnedEdgeId(null);
    setEditingLabelId(null);
  }, []);

  // Cierra el editor y abre el diálogo de confirmación de borrado.
  const requestDeleteNode = useCallback((id: string) => {
    setEditorNodeId(null);
    setEditingLabelId(null);
    setConfirm({ kind: "node", id });
  }, []);

  // Edición de la raya (su DQL propio) y borrado desde el editor de la raya.
  const updateEdge = useCallback(
    (id: string, patch: EdgeData) =>
      setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, data: { ...(e.data ?? {}), ...patch } } : e))),
    [setEdges],
  );
  // Invertir el sentido de la raya (intercambia origen↔destino): garantiza poder
  // dejar una conexión de ida o de regreso sin importar desde qué costado se trazó.
  // No se invierte si ya existe una raya en el sentido contrario (evita duplicar).
  const flipEdge = useCallback(
    (id: string) =>
      setEdges((eds) => {
        const e = eds.find((x) => x.id === id);
        if (!e || eds.some((x) => x.source === e.target && x.target === e.source)) return eds;
        return eds.map((x) =>
          x.id === id
            ? { ...x, source: x.target, target: x.source, sourceHandle: x.targetHandle ?? null, targetHandle: x.sourceHandle ?? null }
            : x,
        );
      }),
    [setEdges],
  );
  const requestDeleteEdge = useCallback((id: string) => {
    setEditorEdgeId(null);
    setPinnedEdgeId(null);
    setConfirm({ kind: "edge", id });
  }, []);

  const confirmDelete = useCallback(() => {
    if (!confirm) return;
    if (confirm.kind === "edge") {
      setEdges((eds) => eds.filter((e) => e.id !== confirm.id));
    } else if (confirm.kind === "map") {
      void deleteMap(confirm.id);
    } else {
      // Si se elimina el nodo imagen, salir del modo edición de imagen.
      const target = nodes.find((n) => n.id === confirm.id);
      if (target?.type === "image") setImageEditMode(false);
      // Un agrupador se borra SOLO como marco: sus miembros quedan sueltos.
      if (target?.type === "group") deleteGroup(confirm.id);
      else deleteNode(confirm.id);
    }
    setConfirm(null);
  }, [confirm, deleteNode, deleteGroup, deleteMap, setEdges, nodes]);

  const confirmMessage = useMemo(() => {
    if (!confirm) return "";
    if (confirm.kind === "edge") return t("confirm.deleteEdge");
    if (confirm.kind === "map") {
      const m = maps.find((x) => x.id === confirm.id);
      return t("confirm.deleteMap", { name: m?.name ?? "" });
    }
    const n = nodes.find((x) => x.id === confirm.id);
    if (n?.type === "label") {
      // El texto es markdown; mostramos un fragmento corto (1ª línea, sin marcas).
      const raw = (n.data as LabelNodeData).text ?? "";
      const firstLine = raw.split("\n").find((l) => l.trim()) ?? "";
      const clean = firstLine.replace(/^[#>\-*\s`]+/, "").trim().slice(0, 40);
      return t("confirm.deleteLabel", { name: clean });
    }
    if (n?.type === "image") return t("confirm.deleteImage");
    if (n?.type === "group") return t("confirm.deleteGroup");
    const nm = n ? (n.data as SeverityNodeData).name : "";
    return t("confirm.deleteNode", { name: nm });
  }, [confirm, nodes, maps, t]);

  const confirmLabel = confirm?.kind === "map" ? t("confirm.trashMap") : t("confirm.delete");

  const editorNode = nodes.find((n) => n.id === editorNodeId) ?? null;
  const selSeverity = editorNode?.type === "severity" ? editorNode : null;
  // Nodo de la burbuja "¿Por qué?" (solo nodos de severidad tienen DQL/estado).
  const whyNodeRaw = whyNodeId ? (nodes.find((n) => n.id === whyNodeId) ?? null) : null;
  const whyNode = whyNodeRaw?.type === "severity" ? whyNodeRaw : null;
  // ¿El nodo de la burbuja está ROJO por la regla de salud de conexiones? Si sí,
  // la burbuja lo explica con la regla (dato ya calculado, gratis) y NO invoca
  // Davis ni al CoPilot. (whyNode viene de `nodes`, sin transitorios → se
  // recalcula aquí con la misma fuente que displayNodes.)
  const whyConnRule = useMemo(() => {
    if (!whyNode) return null;
    const d = whyNode.data as SeverityNodeData;
    if (!d.connHealth || !d.entity?.id) return null;
    const source = nodeStatusSource(d);
    if (source !== "davis") return null;
    const info = connInfoByEntity.get(d.entity.id);
    if (!info || typeof info.pct !== "number") return null;
    const threshold = clampConnRedAt(d.connHealthRedAt ?? DEFAULT_CONN_RED_AT);
    return info.pct <= threshold ? { pct: info.pct, bad: info.bad, total: info.total, threshold } : null;
  }, [whyNode, connInfoByEntity]);
  const selectedEdge = edges.find((e) => e.id === editorEdgeId) ?? null;

  // Valor del contexto de UI del título (lo consume LabelNode: editar/duplicar/borrar).
  const labelUi = useMemo(
    () => ({
      editingId: editingLabelId,
      readOnly,
      onStartEdit: (id: string) => {
        setPinnedEdgeId(null);
        setEditingLabelId(id);
      },
      onDone: () => setEditingLabelId(null),
      onChange: (id: string, txt: string) => updateLabel(id, { text: txt }),
      onScale: (id: string, scale: number) => updateLabel(id, { scale }),
      onDuplicate: duplicateLabel,
      onRequestDelete: requestDeleteNode,
    }),
    [editingLabelId, readOnly, updateLabel, duplicateLabel, requestDeleteNode],
  );
  // No se puede invertir si ya existe una raya en el sentido contrario (sería un
  // duplicado): en ese caso el botón "Invertir dirección" se muestra deshabilitado.
  const canFlipSelected = selectedEdge
    ? !edges.some((x) => x.source === selectedEdge.target && x.target === selectedEdge.source)
    : false;
  const dotColor = theme === "light" ? "#DADBE3" : "#3B3B50";

  // El popup flotante "Editar" (nodos y rayas) solo aplica cuando el mapa es editable
  // y no estamos en edición de imagen ni en vista previa de una versión.
  const popupsEnabled = !readOnly && !imageEditMode && !previewLabel;
  // Nodo del popover "Relacionados": solo si existe, es de severidad, tiene
  // entidad atada y el popover está permitido (mapa editable, sin previa/imagen).
  const relatedNodeRaw = relatedNodeId ? (nodes.find((n) => n.id === relatedNodeId) ?? null) : null;
  const relatedNode =
    popupsEnabled &&
    relatedNodeRaw?.type === "severity" &&
    (relatedNodeRaw.data as SeverityNodeData).entity?.id
      ? relatedNodeRaw
      : null;
  // Si el popover deja de aplicar (se borró el nodo, se le quitó la entidad, o el
  // mapa pasó a un modo no editable), cerrarlo para no dejar el lienzo atenuado.
  useEffect(() => {
    if (relatedNodeId && !relatedNode) setRelatedNodeId(null);
  }, [relatedNodeId, relatedNode]);
  // La burbuja "¿Por qué?" es informativa (solo lectura): se permite también en
  // modo solo-lectura; solo se apaga al editar imagen o en vista previa.
  const explainEnabled = !imageEditMode && !previewLabel;
  // En vista previa de una versión, la toolbar de EDICIÓN se bloquea: lo que se
  // hiciera ahí se descartaba en silencio al salir (previewRef bloquea el guardado).
  const previewing = previewLabel !== null;
  // Lienzo BLOQUEADO para edición: vista previa de una versión o mapa de solo
  // lectura. Apaga toolbar de edición, "+", arrastre, conexiones y selección.
  const locked = previewing || readOnly;
  // Contexto del popup de nodos (lo consume SeverityNode): abrir su editor.
  const popUi = useMemo(
    () => ({
      enabled: popupsEnabled,
      onEditNode: (id: string) => {
        setPinnedEdgeId(null);
        setEditorEdgeId(null);
        setEditorNodeId(id);
      },
      onDuplicateNode: duplicateNode,
      onRequestDeleteNode: requestDeleteNode,
      explainEnabled,
      onExplainNode: (id: string) => setWhyNodeId(id),
      relatedEnabled: popupsEnabled,
      onToggleRelated: (id: string | null) => setRelatedNodeId(id),
      relatedNodeId,
      onRenameGroup: renameGroup,
      onEditEdge: (id: string) => {
        setPinnedEdgeId(null);
        setEditorEdgeId(id);
      },
      onRootCause: (n: number, nodeId: string) => setRcOpen({ n, nodeId }),
    }),
    [popupsEnabled, duplicateNode, requestDeleteNode, explainEnabled, relatedNodeId, renameGroup],
  );
  // Raya cuyo popup "Editar" se muestra: la fijada con un clic. Apagado en modos no
  // editables (solo lectura / edición de imagen / vista previa).
  const popupEdgeId = popupsEnabled ? pinnedEdgeId : null;
  const popupEdge = popupEdgeId ? (edges.find((e) => e.id === popupEdgeId) ?? null) : null;

  return (
    <MapSettingsContext.Provider value={settings}>
    <LabelUiContext.Provider value={labelUi}>
    <PopUiContext.Provider value={popUi}>
    <div className={`mapa-shell mapa--${theme === "light" ? "light" : "dark"}`}>
      {/* Barra lateral de mapas: a la izquierda, alto completo (estilo Notebooks). */}
      {sidebarOpen && (
        <MapSidebar
          maps={maps}
          activeId={activeId}
          sharedIds={sharedIds}
          width={sidebarWidth}
          onResizeStart={onResizeStart}
          onOpen={(id) => void openMap(id)}
          onDuplicate={(id, name) => void duplicateMap(id, t("persist.copyOf", { name }))}
          onRename={(id, name) => void renameMap(id, name)}
          onDownload={(id, name) => void downloadMap(id, name)}
          onShare={(id, name) => setShareTarget({ id, name })}
          onConvert={(id, name) => setConvertTarget({ id, name })}
          onRequestDelete={requestDeleteMap}
          onOpenTrash={() => setTrashOpen(true)}
        />
      )}

      <div className="mapa-main">
        {/* Controles DEL MAPA: viven sobre el lienzo, no cruzan la barra lateral.
            Solo aparecen con un mapa abierto; en el estado vacío no hay barra. */}
        {hasMap && (
        <div className={`mapa-topbar${compact ? " mapa-topbar-compact" : ""}`} ref={topbarRef}>
          <button
            type="button"
            className="mapa-iconbtn"
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? t("toolbar.hideSidebar") : t("toolbar.showSidebar")}
            aria-label={t("toolbar.toggleSidebar")}
          >
            {sidebarOpen ? <CloseSidebarIcon size={18} /> : <OpenSidebarIcon size={18} />}
          </button>

          {/* Nombre del mapa: clic para renombrar; ⋮ con las acciones (Notebooks). */}
          <span className="mapa-mapname-wrap">
            {nameEditing ? (
              <input
                className="mapa-name-input"
                value={nameDraft}
                autoFocus
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitName();
                  if (e.key === "Escape") {
                    nameCommittedRef.current = true;
                    setNameEditing(false);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className={`mapa-mapname${readOnly ? " mapa-mapname-static" : ""}`}
                title={activeId && !readOnly ? t("toolbar.renameTip", { name: activeName }) : activeName}
                onClick={readOnly ? undefined : startNameEdit}
              >
                {activeName}
              </button>
            )}
            {/* SOLO LECTURA: sin menú ⋮ (todas sus acciones editan, copian o borran). */}
            {!readOnly && (
            <MapActionsMenu
              triggerClassName="mapa-iconbtn mapa-iconbtn-sm"
              ariaLabel={t("toolbar.mapActions")}
              onRename={startNameEdit}
              onDuplicate={() => {
                if (activeId) void duplicateMap(activeId, t("persist.copyOf", { name: activeName }));
              }}
              onDownload={() => downloadSnapshot({ nodes, edges, settings, mapType }, activeName)}
              onConvert={
                activeId && !isParentMap && !readOnly
                  ? () => setConvertTarget({ id: activeId, name: activeName })
                  : undefined
              }
              onDelete={() => {
                if (activeId) requestDeleteMap(activeId);
              }}
            />
            )}
          </span>

          {/* Indicador de guardado: indicador-ícono junto a los 3 punticos.
              Sin borde ni fondo de botón — es un indicador visual, no una acción.
              saving → SyncIcon girando; saved/idle → nubesita con check; error → nubesita en rojo. */}
          <button
            type="button"
            className={`mapa-savebtn${saveState === "saving" ? " mapa-saving-spin" : ""}`}
            style={saveState === "error" ? { color: "var(--dt-colors-text-critical-default, var(--sev-err))" } : undefined}
            title={
              saveState === "saving"
                ? t("toolbar.saving")
                : saveState === "error"
                  ? t("toolbar.saveError")
                  : saveState === "readonly"
                    ? t("toolbar.readonly")
                    : t("toolbar.saved")
            }
            aria-label={
              saveState === "saving"
                ? t("toolbar.saving")
                : saveState === "error"
                  ? t("toolbar.saveError")
                  : saveState === "readonly"
                    ? t("toolbar.readonly")
                    : t("toolbar.saved")
            }
          >
            {saveState === "saving" ? (
              <SyncIcon size={18} />
            ) : saveState === "readonly" ? (
              <LockIcon size={18} />
            ) : (
              <CloudCheckIcon size={18} />
            )}
          </button>

          {/* Compartir el mapa activo (estilo botón "Share" de Notebooks). Solo
              cuando el mapa ya existe como documento (tiene id). */}
          <Button
            className="mapa-share-btn"
            onClick={() => {
              if (activeId) setShareTarget({ id: activeId, name: activeName });
            }}
            disabled={!activeId || readOnly}
            aria-label={t("toolbar.share")}
            title={activeId ? t("toolbar.shareMap") : t("toolbar.shareDisabled")}
          >
            <Button.Prefix>
              <LockIcon />
            </Button.Prefix>
            {!compact && t("toolbar.share")}
          </Button>

          {/* Historial + deshacer/rehacer: grupo a la IZQUIERDA, SIN separador
              tras "Compartir". El historial viaja con deshacer/rehacer. */}
          <VersionHistory
            mapId={activeId}
            disabled={!activeId || readOnly}
            onBeforeRestore={cancelPending}
            onRestored={onRestoredVersion}
            onPreview={onPreviewVersion}
            onDuplicate={onDuplicateVersion}
            onDownload={onDownloadVersion}
          />
          <span className="mapa-undo" role="group" aria-label={t("toolbar.undoRedo")}>
            <button
              type="button"
              className="mapa-undo-btn"
              onClick={undo}
              disabled={!canUndo || locked}
              title={t("toolbar.undo")}
              aria-label={t("toolbar.undo")}
            >
              <UndoIcon size={16} />
            </button>
            <button
              type="button"
              className="mapa-undo-btn"
              onClick={redo}
              disabled={!canRedo || locked}
              title={t("toolbar.redo")}
              aria-label={t("toolbar.redo")}
            >
              <RedoIcon size={16} />
            </button>
          </span>

          {/* Botón "Editar imagen" / "Listo" — solo visible cuando hay imagen de fondo.
              En modo edición muestra CheckmarkIcon + label "Listo"; fuera: EditIcon + "Editar imagen".
              Oculto en vista previa (no se edita una versión vieja). */}
          {hasImage && !locked && (
            <>
              {/* Separador: va DETRÁS (a la izquierda) del botón "Listo", solo en
                  modo edición, para dividir el grupo de imagen del resto de la toolbar. */}
              {imageEditMode && <span className="mapa-topbar-sep" />}
              <Button
                variant={imageEditMode ? "emphasized" : "default"}
                onClick={() => setImageEditMode((v) => !v)}
                aria-label={imageEditMode ? t("toolbar.doneImage") : t("toolbar.editImage")}
                title={imageEditMode ? t("toolbar.doneImage") : t("toolbar.editImage")}
              >
                <Button.Prefix>
                  {imageEditMode ? <CheckmarkIcon /> : <EditIcon />}
                </Button.Prefix>
                {!compact && (imageEditMode ? t("common.done") : t("toolbar.editImageBtn"))}
              </Button>
              {/* Sub-controles visibles solo en modo edición de imagen.
                  Orden: separador, luego opacidad (slider + %), bloqueo de aspecto y eliminar. */}
              {imageEditMode && (
                <>
                  {/* Opacidad de la imagen de fondo */}
                  <label
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, whiteSpace: "nowrap" }}
                    title={t("toolbar.opacity")}
                  >
                    {!compact && <span>{t("toolbar.opacity")}</span>}
                    <input
                      type="range"
                      className="mapa-range"
                      min={10}
                      max={100}
                      style={{ width: compact ? 60 : 80 }}
                      value={Math.round(
                        ((nodes.find((n) => n.type === "image")?.data as ImageNodeData | undefined)?.opacity ?? 1) * 100
                      )}
                      onChange={(e) => {
                        const pct = Number(e.target.value);
                        setNodes((nds) =>
                          nds.map((n) =>
                            n.type === "image"
                              ? { ...n, data: { ...(n.data as ImageNodeData), opacity: pct / 100 } }
                              : n,
                          ),
                        );
                      }}
                    />
                    <span style={{ fontSize: 11, minWidth: 30 }}>
                      {Math.round(
                        ((nodes.find((n) => n.type === "image")?.data as ImageNodeData | undefined)?.opacity ?? 1) * 100
                      )}%
                    </span>
                  </label>
                  {/* Bloqueo de relación de aspecto — a la derecha del slider */}
                  <label
                    className="mapa-aspect-label"
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", whiteSpace: "nowrap" }}
                    title={t("toolbar.lockAspect")}
                  >
                    <input
                      type="checkbox"
                      checked={keepAspect}
                      onChange={(e) => setKeepAspect(e.target.checked)}
                      style={{ cursor: "pointer" }}
                    />
                    {!compact && t("toolbar.lockAspect")}
                  </label>
                  {/* Eliminar imagen: solo el ícono, sin borde ni texto. */}
                  <button
                    type="button"
                    className="mapa-imgdelbtn"
                    title={t("toolbar.deleteImage")}
                    aria-label={t("toolbar.deleteImage")}
                    onClick={() => {
                      const imgNode = nodes.find((n) => n.type === "image");
                      if (imgNode) setConfirm({ kind: "node", id: imgNode.id });
                    }}
                  >
                    <DeleteIcon size={18} />
                  </button>
                </>
              )}
            </>
          )}

          <span className="mapa-topbar-spacer" />
          {/* Mapa Padre: cuándo se leyó por última vez + refresco a mano. El botón
              está SIEMPRE disponible (en modo Manual es la única forma). */}
          {isParentMap && (
            <>
              <span className="mapa-refreshinfo" title={t("parent.updatedTip")}>
                {lastRefreshLabel}
              </span>
              <button
                type="button"
                className="mapa-ghostbtn"
                onClick={refreshNow}
                aria-label={t("parent.refresh")}
                title={t("parent.refresh")}
              >
                <SyncIcon size={16} />
                {!compact && <span>{t("parent.refresh")}</span>}
              </button>
              <span className="mapa-topbar-sep" />
            </>
          )}
          {/* Causa raíz: ejecuta el workflow de Dynatrace Intelligence sobre los
              problemas activos del mapa (en un Mapa Padre, también los de sus
              hijos). Solo editores y solo si hay nodos en advertencia o error.
              De visita en un hijo no se ofrece: el análisis visible es del padre. */}
          {!locked && !rcVisiting && (
            <button
              type="button"
              className="mapa-ghostbtn mapa-rc-btn"
              onClick={runRootCause}
              disabled={!rcHasProblems || !!rcBusy}
              aria-label={t("rca.button")}
              title={rcBusy ? t("rca.busyShort") : rcHasProblems ? t("rca.buttonTip") : t("rca.noProblems")}
            >
              {rcBusy ? <span className="mapa-rc-spin" aria-hidden="true" /> : <AiIcon size={16} />}
              {!compact && <span>{rcBusy ? t("rca.busyShort") : t("rca.button")}</span>}
            </button>
          )}
          {/* Topología: sugerir conexiones reales (calls/called_by de Smartscape)
              entre nodos atados a una entidad. Solo aparece si hay ≥1 nodo atado. */}
          {hasBoundNodes && !locked && (
            <button
              type="button"
              className="mapa-ghostbtn"
              onClick={() => setTopologyOpen(true)}
              aria-label={t("topology.button")}
              title={t("topology.button")}
            >
              <WorkflowSimpleIcon size={16} />
              {!compact && <span>{t("topology.button")}</span>}
            </button>
          )}
          {/* Re-organizar: ahora a la DERECHA y en estilo "ghost" (transparente,
              sin pre-sombreado). El único botón pre-sombreado es "Compartir". */}
          <button
            type="button"
            className="mapa-ghostbtn"
            onClick={autoOrganize}
            disabled={locked}
            aria-label={t("toolbar.reorganize")}
            title={t("toolbar.reorganize")}
          >
            <WorkflowSimpleIcon size={16} />
            {!compact && <span>{t("toolbar.reorganize")}</span>}
          </button>
          <ZoomControls />
          {/* Input file oculto para seleccionar imagen de fondo */}
          <input
            type="file"
            accept="image/png,image/jpeg"
            hidden
            ref={fileInputRef}
            onChange={onPickImage}
          />
          <span className="mapa-topbar-sep" />
          <button
            type="button"
            className="mapa-iconbtn"
            onClick={() => setSettingsOpen(true)}
            disabled={locked}
            title={t("toolbar.mapSettings")}
            aria-label={t("toolbar.mapSettings")}
          >
            <SettingIcon size={18} />
          </button>

        </div>
        )}

        {/* Zona del lienzo: la "ventana" del mapa + el gutter gris a los lados.
            El "+" flota en el gutter izquierdo (estilo Notebooks). */}
        <div className="mapa-stage">
        {hasMap && !locked && (
          <div className="mapa-gutter-add">
            <AddMenu onAddNode={addNode} onAddLabel={addLabel} onAddImage={addImage} onAddGroup={addGroup} />
          </div>
        )}
        {/* Zona de soltado: arrastrar un mapa desde la lista y soltarlo aquí crea
            un nodo sub-mapa en ese punto (solo en modo edición). */}
        <div className="mapa-canvas" onDragOver={onCanvasDragOver} onDrop={onCanvasDrop}>
          {hasMap ? (
            <>
            {previewLabel && (
              <div className="mapa-preview-banner">
                <span className="mapa-preview-text">{t("ver.previewBanner", { label: previewLabel })}</span>
                <button type="button" className="mapa-preview-exit" onClick={exitPreview}>
                  {t("ver.exitPreview")}
                </button>
              </div>
            )}
            <ReactFlow
              nodes={renderNodes}
              edges={displayEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              connectionMode={ConnectionMode.Loose}
              isValidConnection={isValidConnection}
              onNodeClick={onNodeClick}
              onNodeDragStart={onNodeDragStart}
              onNodeDrag={onNodeDrag}
              onNodeDragStop={onNodeDragStop}
              onEdgeClick={onEdgeClick}
              onPaneClick={onPaneClick}
              deleteKeyCode={null}
              multiSelectionKeyCode={["Meta", "Control"]}
              selectionKeyCode={"Shift"}
              snapToGrid
              snapGrid={SNAP_GRID}
              connectionRadius={170}
              defaultViewport={DEFAULT_VIEWPORT}
              onViewportChange={onViewportChange}
              translateExtent={TRANSLATE_EXTENT}
              minZoom={0.4}
              nodesDraggable={!locked}
              nodesConnectable={!locked}
              elementsSelectable={!locked}
              elevateNodesOnSelect={false}
              attributionPosition="bottom-left"
            >
              <Background variant={BackgroundVariant.Dots} gap={GRID_SIZE} size={1.5} color={dotColor} />
              {popupEdge && (
                <EdgePopup
                  edge={popupEdge}
                  label={t("label.edit")}
                  onEdit={(eid) => {
                    setPinnedEdgeId(null);
                    setEditorNodeId(null);
                    setEditorEdgeId(eid);
                  }}
                />
              )}
              {/* Popover "Relacionados" del nodo atado (topología real). Se ancla
                  al nodo (NodeToolbar) y usa los nodos/rayas/relaciones del mapa. */}
              {relatedNode && (
                <RelatedPopover
                  node={relatedNode as Node<SeverityNodeData>}
                  nodes={nodes}
                  edges={edges}
                  relations={relations}
                  liveNames={entityMeta.liveName}
                  onConnectExisting={connectExisting}
                  onAddAndConnect={addAndConnect}
                  onIgnoreEdge={ignoreEdge}
                  onRemoveEdge={removeEdge}
                  onClose={() => setRelatedNodeId(null)}
                />
              )}
            </ReactFlow>
            {/* De visita en un mapa hijo con el análisis del padre: aviso + volver. */}
            {rcVisiting && rcVisit && (
              <div className="mapa-rc-visit" role="status">
                <span>{t("rca.visit", { parent: rcVisit.parentName })}</span>
                <button type="button" className="mapa-rc-nodebtn mapa-rc-nodebtn-strong" onClick={rcBackToParent}>
                  {t("rca.visitBack")}
                </button>
              </div>
            )}
            {/* Leyenda de causas raíz (arriba-derecha): último análisis guardado
                (de visita en un hijo: el del padre, sin «Analizar de nuevo»). */}
            {(
              <RootCauseLegend
                analysis={rcShown}
                busy={rcBusy}
                error={rcError}
                canRun={!locked && !rcVisiting && rcHasProblems && !rcBusy}
                canClear={!locked && !rcVisiting && !rcBusy && !!settings.rootCause}
                cleared={rcAllResolved}
                onClear={rcClear}
                nodeName={rcNodeName}
                closed={rcClosed}
                newRed={rcNewRed}
                onOpen={rcOpenFromLegend}
                onRerun={runRootCause}
              />
            )}
            {/* Leyenda de consumo estimado de Grail (discreta, abajo-derecha).
                Desactivable desde Ajustes. El detalle (hover) muestra el costo por
                ejecución y el nº de consultas únicas. */}
            {showCost && (
              <div className="mapa-cost-legend" role="status" tabIndex={0} aria-label={costMain}>
                <span className="mapa-cost-main">
                  {costCalculating && (
                    <span className="mapa-cost-spin mapa-saving-spin" aria-hidden="true">
                      <SyncIcon size={11} />
                    </span>
                  )}
                  {costMain}
                </span>
                {!costFailed && (
                  <div className="mapa-cost-tip" role="tooltip">
                    <div>{t("cost.detailPerRun", { value: fmtBytes(costBytesPerCycle) })}</div>
                    <div>
                      {t("cost.detailQueries", {
                        consuming: queryCost.consumingCount,
                        total: queryCost.uniqueCount,
                      })}
                    </div>
                    <div className="mapa-cost-freenote">{t("cost.freeNote")}</div>
                  </div>
                )}
              </div>
            )}
            </>
          ) : mapInvalid ? (
            <div className="mapa-empty" role="alert">
              <div className="mapa-empty-card">
                <span className="mapa-empty-icon mapa-invalid-icon">
                  <WarningIcon size={26} />
                </span>
                <div className="mapa-empty-title">{t("invalid.title")}</div>
                <div className="mapa-empty-sub">
                  {t("invalid.openText", { name: activeName })}
                  <br />
                  {t("invalid.reason", { reason: invalidReasonText(t, mapInvalid) })}
                </div>
              </div>
            </div>
          ) : loading ? null : (
            // Estado vacío: sin ningún mapa abierto (primera vez, o tras borrar el
            // último). En vez de un mapa de ejemplo, invitamos a crear el primero.
            <div className="mapa-empty">
              <div className="mapa-empty-card">
                <span className="mapa-empty-icon">
                  <WorkflowSimpleIcon size={26} />
                </span>
                <div className="mapa-empty-title">{t("empty.title")}</div>
                <div className="mapa-empty-sub">
                  {t("empty.sub")}
                </div>
                <div className="mapa-empty-actions">
                  <Button variant="emphasized" onClick={onNewMap}>
                    <Button.Prefix>
                      <PlusIcon />
                    </Button.Prefix>
                    {t("empty.create")}
                  </Button>
                  <Button onClick={onImportClick}>
                    <Button.Prefix>
                      <UploadIcon />
                    </Button.Prefix>
                    {t("empty.import")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      <NodeEditorModal
        key={`n-${editorNodeId ?? "none"}`}
        node={selSeverity as Node<SeverityNodeData> | null}
        isParentMap={isParentMap}
        usedMapIds={submapIds.filter(
          (id) => id !== (selSeverity as Node<SeverityNodeData> | null)?.data.mapRef?.id,
        )}
        readOnly={readOnly}
        onSave={updateNode}
        onClose={() => setEditorNodeId(null)}
      />
      <RootCauseModal
        analysis={rcShown}
        cause={rcOpenCause}
        focusNodeId={rcOpen?.nodeId ?? null}
        closed={rcClosed}
        nodeName={rcNodeName}
        onFocusNode={rcFocusNode}
        onClose={() => setRcOpen(null)}
      />
      <WhyModal
        key={`why-${whyNodeId ?? "none"}`}
        node={whyNode as Node<SeverityNodeData> | null}
        connRule={whyConnRule}
        onClose={() => setWhyNodeId(null)}
        rcCanRun={!locked && !rcVisiting && rcHasProblems && !rcBusy}
        onRunRootCause={runRootCause}
      />
      <EdgeEditorModal
        key={`e-${editorEdgeId ?? "none"}`}
        edge={selectedEdge}
        canFlip={canFlipSelected}
        readOnly={readOnly}
        onSave={updateEdge}
        onFlip={flipEdge}
        onRequestDelete={requestDeleteEdge}
        onClose={() => setEditorEdgeId(null)}
      />
      <ConfirmDialog
        show={confirm !== null}
        message={confirmMessage}
        confirmLabel={confirmLabel}
        onConfirm={confirmDelete}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        show={convertTarget !== null}
        title={t("convert.title")}
        message={t("convert.message", { name: convertTarget?.name ?? "" })}
        confirmLabel={t("convert.confirm")}
        onConfirm={() => {
          const target = convertTarget;
          setConvertTarget(null);
          if (!target) return;
          void convertToParent(target.id).then((ok) => {
            if (!ok) setNotice(t("convert.error"));
          });
        }}
        onCancel={() => setConvertTarget(null)}
      />
      <SettingsModal
        show={settingsOpen}
        isParentMap={isParentMap}
        settings={settings}
        onChange={updateSettings}
        onClose={() => setSettingsOpen(false)}
      />
      <TrashModal
        show={trashOpen}
        onClose={() => setTrashOpen(false)}
        loadTrash={loadTrash}
        onRestore={restoreMap}
      />
      <ShareModal
        show={shareTarget !== null}
        documentId={shareTarget?.id ?? null}
        mapName={shareTarget?.name ?? ""}
        onClose={() => {
          setShareTarget(null);
          void refreshShares(); // refresca el ícono de "compartido" en la lista
        }}
      />

      <ExportModal
        show={exportData !== null}
        json={exportData?.json ?? null}
        filename={exportData?.filename ?? "mapa"}
        onClose={() => setExportData(null)}
      />

      {/* Modal global de topología: sugerencias de conexión (calls) entre nodos
          atados y sin raya. "Agregar todas" crea rayas que heredan el estado. */}
      <TopologyModal
        show={topologyOpen}
        suggestions={topologySuggestions}
        boundCount={boundEntities.length}
        totalCount={nodes.filter((n) => n.type === "severity").length}
        onAdd={addTopologyEdges}
        onClose={() => setTopologyOpen(false)}
      />

      {/* Probes ocultos: 1 por DQL único; ejecutan en solo lectura y reportan estado.
          La frecuencia de refresco es un ajuste por mapa. Se pausan cuando la
          pestaña está oculta y se limitan a MAX_ACTIVE_PROBES para cuidar Grail. */}
      {activeDqls.map((dql) => (
        <NodeStatusProbe
          key={dql}
          dql={dql}
          onStatus={onStatus}
          onQueryId={onQueryId}
          refreshIntervalMs={probeRefreshMs}
          paused={!pageVisible}
          refreshToken={probeToken}
        />
      ))}
      {activeValueDqls.map((dql) => (
        <DqlValueProbe
          key={`v:${dql}`}
          dql={dql}
          onValue={onValue}
          onQueryId={onQueryId}
          refreshIntervalMs={probeRefreshMs}
          paused={!pageVisible}
          refreshToken={probeToken}
        />
      ))}
    </div>
    </PopUiContext.Provider>
    </LabelUiContext.Provider>
    </MapSettingsContext.Provider>
  );
};

// ReactFlowProvider envuelve todo para que la barra superior (fuera del lienzo)
// pueda usar useReactFlow/useViewport en los controles de zoom.
export const MapCanvas = () => (
  <ReactFlowProvider>
    <MapCanvasInner />
  </ReactFlowProvider>
);
