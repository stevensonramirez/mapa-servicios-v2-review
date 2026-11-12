import React from "react";
import { NodeResizer } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";

// Nodo de imagen de fondo del mapa (una sola imagen por mapa).
// No tiene handles; solo se puede mover/redimensionar en modo edición.
export type ImageNodeData = {
  src: string;
  opacity?: number;
  // Flags transitorios (NO se persisten: se inyectan en displayNodes, no en nodes).
  editing?: boolean;
  keepAspect?: boolean;
};

export type ImageNodeType = Node<ImageNodeData, "image">;

// Solo renderizamos imágenes embebidas (data:image). Cualquier otra cosa
// (http(s):, blob:, file:, javascript:) se ignora: evita que el origen
// privilegiado de la app pida una URL remota desde un mapa importado/alterado.
const isDataImage = (s: unknown): s is string =>
  typeof s === "string" && /^data:image\/[a-z.+-]+;base64,/i.test(s);

export const ImageNode = ({ data, width, height }: NodeProps<ImageNodeType>) => (
  <div style={{ position: "relative", width: "100%", height: "100%" }}>
    {/* NodeResizer solo aparece cuando el nodo está en modo edición */}
    {data.editing && (
      <NodeResizer
        keepAspectRatio={data.keepAspect ?? true}
        minWidth={60}
        minHeight={60}
        isVisible
      />
    )}
    {isDataImage(data.src) && (
      <img
        src={data.src}
        draggable={false}
        alt=""
        style={{
          width: "100%",
          height: "100%",
          objectFit: "fill",
          opacity: data.opacity ?? 1,
          pointerEvents: "none",
          display: "block",
          borderRadius: 6,
        }}
      />
    )}
    {/* Suprime advertencia de TypeScript sobre width/height no usados en JSX */}
    {(width ?? height) !== undefined ? null : null}
  </div>
);
