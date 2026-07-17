import React, { useLayoutEffect, useRef, useState } from "react";
import { Handle, Position, NodeResizeControl } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { TrashIcon } from "./TrashIcon";
import { usePopUi } from "./popUi";
import { useT } from "../i18n";
import type { Severity } from "./SeverityNode";

// Nodo AGRUPADOR: un marco contenedor. Los nodos que se arrastran adentro se
// vuelven sus miembros (parentId de React Flow) y el marco se colorea con el
// PEOR estado de todos ellos. El marco NO calcula nada: la severidad y los
// mínimos de redimensionado le llegan ya resueltos por `data` desde MapCanvas.
//
// TAMAÑO — una sola fuente de verdad: `width`/`height` en la RAÍZ del nodo (lo
// que lee React Flow para dimensionar el contenedor, lo que escribe el resize y
// lo que ya persistía cleanSnapshot). Aquí el marco solo se estira al 100%.
export type GroupNodeData = {
  // Nombre visible en la píldora de arriba-izquierda (doble clic → renombrar).
  name: string;
  // TRANSITORIO (no se persiste): peor severidad de los miembros, inyectada por
  // displayNodes. Sin miembros (o todos neutros) → "unknown".
  severity?: Severity;
  // TRANSITORIO: destello al adoptar/liberar un miembro.
  flash?: boolean;
  // TRANSITORIO: hay un nodo arrastrándose encima y este marco lo va a recibir.
  hover?: boolean;
  // TRANSITORIO: un miembro propio se está arrastrando hacia afuera — "hold" =
  // sigue dentro del umbral (el marco lo devolverá), "free" = lo va a soltar.
  pull?: "hold" | "free";
  // TRANSITORIO: mínimos del redimensionado — el tope general y, si es mayor, el
  // rectángulo que ocupan los miembros actuales (para no dejarlos por fuera).
  minW?: number;
  minH?: number;
};

export type GroupNodeType = Node<GroupNodeData, "group">;

// Tamaño con el que NACE un agrupador.
export const GROUP_DEFAULT_W = 360;
export const GROUP_DEFAULT_H = 220;
// Tope de achicado: ni el resize ni el acomodo interno bajan de aquí.
export const GROUP_MIN_W = 200;
export const GROUP_MIN_H = 140;

const GROUP_SEV_CLASS: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, {
  "0": "mapa-group-ok",
  "1": "mapa-group-warn",
  "2": "mapa-group-err",
  unknown: "mapa-group-unknown",
});

export const GroupNode = ({ id, data, selected }: NodeProps<GroupNodeType>) => {
  const t = useT();
  const pop = usePopUi();
  // Renombrar en línea (solo en modo edición): doble clic en la píldora del título.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Escape cancela: marca para que el blur que dispara el propio Escape NO confirme.
  const cancelledRef = useRef(false);

  const name = typeof data.name === "string" ? data.name : "";
  const sevCls = GROUP_SEV_CLASS[String(data.severity ?? "unknown")] ?? "mapa-group-unknown";

  useLayoutEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Si el mapa deja de ser editable mientras se renombra, salir de la edición.
  useLayoutEffect(() => {
    if (!pop.enabled) setEditing(false);
  }, [pop.enabled]);

  const commit = () => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      setEditing(false);
      return;
    }
    const next = draft.trim();
    setEditing(false);
    // El nombre vacío es VÁLIDO (el usuario puede querer un marco sin rótulo):
    // se guarda "" y la píldora desaparece; queda el chip "+" para reponerlo.
    if (next !== name) pop.onRenameGroup(id, next);
  };

  const cls = [
    "mapa-group",
    sevCls,
    data.flash ? "mapa-group-flash" : "",
    data.hover ? "mapa-group-hover" : "",
    data.pull === "hold" ? "mapa-group-pull-hold" : "",
    data.pull === "free" ? "mapa-group-pull-free" : "",
    selected ? "mapa-group-selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      {/* Eliminar: botón fantasma DENTRO del marco (esquina superior derecha),
          visible al pasar el mouse o con el grupo seleccionado. No va en un
          NodeToolbar: al ser un portal, el mousedown deseleccionaba el nodo y la
          toolbar se desmontaba antes de que el click llegara al botón. Al borrar,
          los miembros quedan sueltos (renombrar vive en el doble clic del título). */}
      {pop.enabled && (
        <button
          type="button"
          className="mapa-group-trash nodrag nopan"
          aria-label={t("group.deleteLabel")}
          title={t("group.deleteLabel")}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            pop.onRequestDeleteNode(id);
          }}
        >
          <TrashIcon label={t("group.deleteLabel")} />
        </button>
      )}

      {/* Manija de redimensionado: UNA sola, en la esquina inferior derecha, sin
          relación de aspecto (libre) y solo en modo edición. Los mínimos los
          calcula MapCanvas para que el marco nunca deje miembros por fuera. */}
      {pop.enabled && (
        <NodeResizeControl
          position="bottom-right"
          minWidth={data.minW ?? GROUP_MIN_W}
          minHeight={data.minH ?? GROUP_MIN_H}
          className="mapa-group-resize"
        >
          <span className="mapa-group-resize-grip" aria-hidden="true" />
        </NodeResizeControl>
      )}

      <Handle type="target" position={Position.Left} className="sev-handle" />

      {editing ? (
        <input
          ref={inputRef}
          className="mapa-group-input nodrag nopan"
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") {
              cancelledRef.current = true;
              setEditing(false);
            }
          }}
          onBlur={commit}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      ) : name ? (
        <div
          className={`mapa-group-title${pop.enabled ? " mapa-group-title-edit" : ""}`}
          title={pop.enabled ? t("group.renameTip") : name}
          onDoubleClick={(e) => {
            if (!pop.enabled) return;
            e.stopPropagation();
            setDraft(name);
            setEditing(true);
          }}
        >
          {name}
        </div>
      ) : pop.enabled ? (
        <button
          type="button"
          className="mapa-group-addname nodrag nopan"
          aria-label={t("group.renameTip")}
          title={t("group.renameTip")}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setDraft("");
            setEditing(true);
          }}
        >
          +
        </button>
      ) : null}

      <Handle type="source" position={Position.Right} className="sev-handle" />
    </div>
  );
};
