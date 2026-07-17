import { createContext, useContext } from "react";

// Contexto para las acciones de UI del nodo de título (markdown). Se inyecta desde
// MapCanvas y lo consume LabelNode, evitando meter funciones en `data` (que se
// serializa/persiste). Mismo patrón que MapSettingsContext.
export type LabelUi = {
  // Id del título que está actualmente en modo edición (o null).
  editingId: string | null;
  // En mapas de solo lectura no se puede editar: ocultamos la toolbar.
  readOnly: boolean;
  onStartEdit: (id: string) => void;
  onDone: () => void;
  onChange: (id: string, text: string) => void;
  // Escala del bloque (A− / A+): se guarda en data.scale del nodo.
  onScale: (id: string, scale: number) => void;
  onDuplicate: (id: string) => void;
  onRequestDelete: (id: string) => void;
};

const noop = () => {};

export const LabelUiContext = createContext<LabelUi>({
  editingId: null,
  readOnly: false,
  onStartEdit: noop,
  onDone: noop,
  onChange: noop,
  onScale: noop,
  onDuplicate: noop,
  onRequestDelete: noop,
});

export const useLabelUi = () => useContext(LabelUiContext);
