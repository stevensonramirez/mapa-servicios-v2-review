import { createContext, useContext } from "react";

// Contexto de UI para el popup flotante de "Editar" que aparece al pasar el mouse
// (hover) o seleccionar un nodo de servicio. Inyecta la acción de abrir el editor
// sin meter funciones en el `data` del nodo (no se persisten). `enabled` apaga el
// popup en modos donde no aplica (solo lectura, edición de imagen, vista previa).
export type PopUi = {
  enabled: boolean;
  onEditNode: (id: string) => void;
  onDuplicateNode: (id: string) => void;
  onRequestDeleteNode: (id: string) => void;
  // ¿Se puede abrir la burbuja "¿Por qué?" (detalle del estado)? Disponible
  // también en solo lectura (es informativa); solo se apaga en edición de imagen
  // y vista previa.
  explainEnabled: boolean;
  onExplainNode: (id: string) => void;
  // ¿Se puede abrir el popover "Relacionados"? Solo aplica en un mapa editable
  // (crea/quita rayas). Se apaga en solo lectura / edición de imagen / vista previa.
  relatedEnabled: boolean;
  // Abre/cierra el popover "Relacionados" de un nodo atado a una entidad. Al
  // abrir, `id` = el nodo; al cerrar, `id` = null (para resaltar en el lienzo).
  onToggleRelated: (id: string | null) => void;
  // Id del nodo cuyo popover "Relacionados" está abierto (para el estado del botón).
  relatedNodeId: string | null;
  // Renombrar un nodo AGRUPADOR (doble clic en la píldora de su título). Solo
  // aplica en modo edición (`enabled`).
  onRenameGroup: (id: string, name: string) => void;
  // Abrir el editor de una RAYA (clic en su chip de valor). Solo en modo edición.
  onEditEdge: (id: string) => void;
  // Abrir el modal de una CAUSA RAÍZ (clic en el número rojo o en «Efecto de N»
  // de un nodo). Informativo: disponible también en solo lectura.
  onRootCause: (n: number, nodeId: string) => void;
};

export const PopUiContext = createContext<PopUi>({
  enabled: true,
  onEditNode: () => {},
  onDuplicateNode: () => {},
  onRequestDeleteNode: () => {},
  explainEnabled: true,
  onExplainNode: () => {},
  relatedEnabled: true,
  onToggleRelated: () => {},
  relatedNodeId: null,
  onRenameGroup: () => {},
  onEditEdge: () => {},
  onRootCause: () => {},
});

export const usePopUi = () => useContext(PopUiContext);
