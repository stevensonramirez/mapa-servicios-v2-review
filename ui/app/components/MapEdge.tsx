import React from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useInternalNode, Position } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import { slotOffset } from "./edgeRouting";
import { useT } from "../i18n";
import { usePopUi } from "./popUi";
import { formatValue } from "./nodeStatus";

// Raya con anclaje LATERAL por PUERTOS + DIRECCIONAL.
//  - Lateral: SALE por un COSTADO (izq/der) del nodo, nunca del medio (arriba/abajo).
//  - Puertos: cuando varias rayas tocan el MISMO costado de un nodo, se reparten en
//    abanico a lo largo de ese lado (no se amontonan todas en el centro). El reparto
//    (qué lado y qué ranura le toca a cada raya) se calcula en MapCanvas y llega por
//    `data.port` (índice/total por extremo), para que sea coherente entre todas.
//  - Direccional: flechitas marchan en el SENTIDO del flujo (ida →, regreso ←).
//  - Estado propio: si la raya tiene DQL PROPIO (no hereda del nodo de origen),
//    lleva el texto "DQL" en línea apenas sale del nodo (la raya se "abre" y el
//    rótulo va en el hueco, como la etiqueta de un cable), del color de su estado.
//  - Chip de valor: si la raya tiene un DQL de VALOR activo, un chip en la mitad
//    muestra el número (+ etiqueta y sufijo), todo del color del estado. Clic →
//    abre el editor de la raya (solo en modo edición).

type IN = NonNullable<ReturnType<typeof useInternalNode>>;
type Side = "left" | "right";
type PortInfo = {
  sSide: Side;
  tSide: Side;
  sIndex: number;
  sCount: number;
  tIndex: number;
  tCount: number;
};

// Centro absoluto + tamaño del nodo (a partir de su posición absoluta y medida).
function box(node: IN): { cx: number; cy: number; w: number; h: number; x: number; y: number } {
  const w = node.measured?.width ?? 0;
  const h = node.measured?.height ?? 0;
  const x = node.internals.positionAbsolute.x;
  const y = node.internals.positionAbsolute.y;
  return { cx: x + w / 2, cy: y + h / 2, w, h, x, y };
}

// Ruta de evasión (cuando la raya debe rodear un nodo): se calcula en MapCanvas y
// llega por data.route con los anclajes + los 2 controles de la curva cúbica.
type RouteInfo = { sx: number; sy: number; tx: number; ty: number; c1x: number; c1y: number; c2x: number; c2y: number };

// Pequeña flecha ">" apuntando +x; con rotate="auto" se orienta según la marcha.
const CHEVRON = "M-3 -3 L1.5 0 L-3 3";
const FLOW_DUR = 2.2; // s — paso de la marcha (calmado)
const FLOW_COUNT = 3; // nº de flechitas repartidas a lo largo de la raya
// Centro del rótulo "DQL": ESTE tanto hacia afuera del nodo, sobre la raya (justo
// en el borde lo taparían el handle y el propio nodo, capa HTML encima).
const ORIGIN_OFFSET = 26;
const DQL_TAG_W = 26;
const DQL_TAG_H = 12;

// Flechitas que marchan en el sentido del flujo (ida →, regreso ←). Usan el
// atributo `path` de <animateMotion> (no mpath) para que sigan la curva actual
// aunque cambie al mover los nodos. rotate="auto" las orienta según el camino.
const ChevronFlow = ({ path, color }: { path: string; color: string }) => (
  <g
    className="mapa-edge-flow"
    fill="none"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    pointerEvents="none"
    style={{ stroke: color }}
  >
    {Array.from({ length: FLOW_COUNT }, (_, i) => (
      <path key={i} d={CHEVRON}>
        <animateMotion
          path={path}
          rotate="auto"
          dur={`${FLOW_DUR}s`}
          begin={`${(-FLOW_DUR / FLOW_COUNT) * i}s`}
          repeatCount="indefinite"
        />
      </path>
    ))}
  </g>
);

// React.memo: con la firma de layout estable, las rayas NO conectadas al nodo que
// se arrastra reciben las MISMAS props y no se vuelven a renderizar (evita recrear
// los <animateMotion> de las flechitas en cada frame). Las conectadas igual se
// actualizan en vivo porque useInternalNode las re-renderiza al mover sus nodos.
const MapEdgeBase = ({
  id,
  source,
  target,
  markerEnd,
  style,
  data,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) => {
  const t = useT();
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const pop = usePopUi();
  const ed = data as
    | {
        dql?: unknown;
        inheritStatus?: unknown;
        valueOn?: boolean;
        value?: number | null;
        valueName?: string; // nombre (siempre en el tooltip)
        valueLabel?: string; // nombre DENTRO del chip (solo si se habilitó)
        valueUnit?: string;
      }
    | undefined;
  const valueOn = ed?.valueOn === true;
  // Punto MEDIO de la raya (para el chip de valor).
  let mx = (sourceX + targetX) / 2;
  let my = (sourceY + targetY) / 2;
  const ownDql = ed?.inheritStatus === false && typeof ed.dql === "string" && ed.dql.trim() !== "";
  // Punto donde NACE la raya (para la anilla de estado propio).
  let ox = sourceX;
  let oy = sourceY;
  const port = (data as { port?: PortInfo } | undefined)?.port;
  const route = (data as { route?: RouteInfo } | undefined)?.route;

  let path: string;
  if (route) {
    // Ruta de EVASIÓN: curva cúbica que rodea el/los nodo(s) que estorban. Los
    // extremos y controles los calculó MapCanvas (coherentes con los puertos).
    path = `M ${route.sx},${route.sy} C ${route.c1x},${route.c1y} ${route.c2x},${route.c2y} ${route.tx},${route.ty}`;
    ox = route.sx + (Math.sign(route.c1x - route.sx) || 1) * ORIGIN_OFFSET;
    oy = route.sy;
    // Punto de la cúbica en t = 0.5.
    mx = 0.125 * route.sx + 0.375 * route.c1x + 0.375 * route.c2x + 0.125 * route.tx;
    my = 0.125 * route.sy + 0.375 * route.c1y + 0.375 * route.c2y + 0.125 * route.ty;
  } else {
    // Camino despejado: anclaje por COSTADO + ranura del puerto, con curva bezier.
    // Por defecto usamos los puntos de los handles; si ambos nodos ya están medidos,
    // recalculamos los extremos en vivo.
    let sx = sourceX;
    let sy = sourceY;
    let tx = targetX;
    let ty = targetY;
    let sp = sourcePosition;
    let tp = targetPosition;

    if (sourceNode?.measured?.width && targetNode?.measured?.width) {
      const s = box(sourceNode);
      const t = box(targetNode);
      // Lado de cada extremo: lo decide el reparto de MapCanvas (coherente entre
      // todas las rayas). Sin reparto aún (transitorio): se calcula por geometría.
      let sSide: Side;
      let tSide: Side;
      if (port) {
        sSide = port.sSide;
        tSide = port.tSide;
      } else {
        const dxc = t.cx - s.cx;
        const goingRight = dxc !== 0 ? dxc > 0 : t.cy < s.cy;
        sSide = goingRight ? "right" : "left";
        tSide = goingRight ? "left" : "right";
      }
      sp = sSide === "right" ? Position.Right : Position.Left;
      tp = tSide === "right" ? Position.Right : Position.Left;
      sx = sSide === "right" ? s.x + s.w : s.x;
      tx = tSide === "right" ? t.x + t.w : t.x;
      // Ranura del puerto: separa verticalmente las rayas del mismo costado.
      sy = s.cy + slotOffset(port?.sIndex ?? 0, port?.sCount ?? 1, s.h);
      ty = t.cy + slotOffset(port?.tIndex ?? 0, port?.tCount ?? 1, t.h);
    }

    ox = sx + (sp === Position.Right ? 1 : -1) * ORIGIN_OFFSET;
    oy = sy;
    [path, mx, my] = getBezierPath({
      sourceX: sx,
      sourceY: sy,
      sourcePosition: sp,
      targetX: tx,
      targetY: ty,
      targetPosition: tp,
    });
  }

  const color = style?.stroke ?? "var(--sev-unk)";

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {ownDql && (
        <g className="mapa-edge-dql" transform={`translate(${ox},${oy})`}>
          <title>{t("edge.ownDqlTip")}</title>
          {/* Hueco en la raya (fondo del lienzo) + texto encima. */}
          <rect x={-DQL_TAG_W / 2} y={-DQL_TAG_H / 2} width={DQL_TAG_W} height={DQL_TAG_H} />
          <text y={3.2} style={{ fill: color }}>
            DQL
          </text>
        </g>
      )}
      <ChevronFlow path={path} color={color} />
      {valueOn && (
        <EdgeLabelRenderer>
          <div
            className={`mapa-edge-chip nodrag nopan${pop.enabled ? " mapa-edge-chip-clickable" : ""}`}
            style={{ transform: `translate(-50%, -50%) translate(${mx}px, ${my}px)`, "--chip-color": color } as React.CSSProperties}
            title={
              ed?.value === null
                ? t("edge.valueInvalid")
                : ed?.valueName
                  ? `${ed.valueName} · ${t("edge.valueChipTip")}`
                  : t("edge.valueChipTip")
            }
            role={pop.enabled ? "button" : undefined}
            onClick={
              pop.enabled
                ? (e) => {
                    e.stopPropagation();
                    pop.onEditEdge(id);
                  }
                : undefined
            }
          >
            {ed?.valueLabel && <span className="mapa-edge-chip-label">{ed.valueLabel}</span>}
            <span className="mapa-edge-chip-value">
              {ed?.value === undefined ? "…" : ed.value === null ? "—" : formatValue(ed.value)}
            </span>
            {ed?.valueUnit && typeof ed.value === "number" && <span className="mapa-edge-chip-unit">{ed.valueUnit}</span>}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

export const MapEdge = React.memo(MapEdgeBase);
