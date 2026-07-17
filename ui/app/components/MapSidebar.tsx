import React, { useRef, useState } from "react";
import { DeleteIcon, GroupIcon, QueryTreeIcon, WorkflowSimpleIcon } from "@dynatrace/strato-icons";
import { MapActionsMenu } from "./MapActionsMenu";
import type { MapMeta } from "./useMapPersistence";
import { useT } from "../i18n";

// MIME propio del arrastre "mapa → lienzo" (crea un nodo de mapa incrustado
// donde se suelte). Es propio para no chocar con otros drops (texto, archivos,
// imagen de fondo); el payload va como JSON {id, name, mapType}.
export const SUBMAP_DND_MIME = "application/x-mapa-submap";

type Props = {
  maps: MapMeta[];
  activeId: string | null;
  sharedIds: Set<string>;
  width: number;
  onResizeStart: (e: React.MouseEvent) => void;
  onOpen: (id: string) => void;
  onDuplicate: (id: string, name: string) => void;
  onRename: (id: string, name: string) => void;
  onDownload: (id: string, name: string) => void;
  onShare: (id: string, name: string) => void;
  onConvert: (id: string, name: string) => void;
  onRequestDelete: (id: string) => void;
  onOpenTrash: () => void;
};

// Barra lateral de mapas, al estilo de los Notebooks de Dynatrace: ancho
// ajustable (arrastrando el borde), "Nuevo"/"Importar" junto al título, y por
// cada mapa un menú ⋮ (Renombrar / Duplicar / Descargar / Mover a la papelera).
export const MapSidebar = ({
  maps,
  activeId,
  sharedIds,
  width,
  onResizeStart,
  onOpen,
  onDuplicate,
  onRename,
  onDownload,
  onShare,
  onConvert,
  onRequestDelete,
  onOpenTrash,
}: Props) => {
  const t = useT();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // Enter confirma y desmonta el input, lo que dispara su onBlur → commitEdit se
  // llamaría dos veces (dos renombrados de red). Este flag corta el segundo.
  const committedRef = useRef(false);

  const startEdit = (m: MapMeta) => {
    committedRef.current = false;
    setEditingId(m.id);
    setDraft(m.name);
  };
  const commitEdit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    if (editingId && draft.trim()) onRename(editingId, draft.trim());
    setEditingId(null);
  };
  const cancelEdit = () => {
    committedRef.current = true;
    setEditingId(null);
  };

  return (
    <aside
      className="mapa-sidebar"
      aria-label={t("sidebar.title")}
      style={{ width, flexGrow: 0, flexShrink: 0, flexBasis: width }}
    >
      <div className="mapa-sidebar-head">
        <span className="mapa-sidebar-title">{t("sidebar.title")}</span>
      </div>

      <div className="mapa-sidebar-list">
        {maps.length === 0 && <div className="mapa-sidebar-empty">{t("sidebar.empty")}</div>}

        {maps.map((m) => {
          const active = m.id === activeId;
          const menuOpen = openMenuId === m.id;
          if (editingId === m.id) {
            return (
              <div key={m.id} className="mapa-maprow mapa-maprow-editing">
                <input
                  className="mapa-rename-input"
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") cancelEdit();
                  }}
                />
              </div>
            );
          }
          return (
            <div key={m.id} className={`mapa-maprow${active ? " mapa-maprow-on" : ""}`}>
              {/* Arrastrable al lienzo: al soltarlo dentro de un Mapa Padre se
                  crea allí un nodo atado a ESTE mapa. El clic normal (abrir) y el
                  doble clic (renombrar) siguen funcionando igual: el navegador
                  solo arranca el arrastre cuando de verdad se arrastra. */}
              <button
                type="button"
                className="mapa-maprow-name"
                title={m.name}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    SUBMAP_DND_MIME,
                    JSON.stringify({ id: m.id, name: m.name, mapType: m.mapType }),
                  );
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onOpen(m.id)}
                onDoubleClick={() => startEdit(m)}
              >
                {/* Todos los mapas llevan ícono (alineación pareja); el del
                    Mapa Padre además va con color de acento para notarlo. */}
                <span
                  className={`mapa-maprow-type${m.mapType === "parent" ? " mapa-maprow-type-parent" : ""}`}
                  title={t(m.mapType === "parent" ? "sidebar.parentTitle" : "sidebar.serviceTitle")}
                  aria-label={t(m.mapType === "parent" ? "sidebar.parentTitle" : "sidebar.serviceTitle")}
                >
                  {/* Mismos íconos que el modal de "Nuevo mapa". */}
                  {m.mapType === "parent" ? <QueryTreeIcon size={14} /> : <WorkflowSimpleIcon size={14} />}
                </span>
                <span className="mapa-maprow-text">{m.name}</span>
              </button>
              {sharedIds.has(m.id) && (
                <span
                  className="mapa-maprow-shared"
                  title={t("sidebar.sharedTitle")}
                  aria-label={t("sidebar.sharedLabel")}
                >
                  <GroupIcon size={15} />
                </span>
              )}
              {/* Mapa compartido en SOLO LECTURA: sin menú ⋮ (renombrar, duplicar,
                  descargar, convertir y eliminar son acciones que no le corresponden). */}
              {!m.readOnly && (
              <span className={`mapa-maprow-actions${menuOpen ? " mapa-maprow-actions-open" : ""}`}>
                <MapActionsMenu
                  triggerClassName="mapa-maprow-btn"
                  ariaLabel={t("sidebar.mapActions", { name: m.name })}
                  onOpenChange={(open) => setOpenMenuId(open ? m.id : null)}
                  onRename={() => startEdit(m)}
                  onShare={() => onShare(m.id, m.name)}
                  onDuplicate={() => onDuplicate(m.id, m.name)}
                  onDownload={() => onDownload(m.id, m.name)}
                  onConvert={m.mapType === "parent" ? undefined : () => onConvert(m.id, m.name)}
                  onDelete={() => onRequestDelete(m.id)}
                />
              </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mapa-sidebar-foot">
        <button type="button" className="mapa-sidebar-foot-btn" onClick={onOpenTrash}>
          <DeleteIcon size={15} />
          <span>{t("sidebar.trash")}</span>
        </button>
      </div>

      {/* Tirador para ajustar el ancho (se queda donde lo dejes). */}
      <div
        className="mapa-sidebar-resize"
        role="separator"
        aria-label={t("sidebar.resizeLabel")}
        aria-orientation="vertical"
        onMouseDown={onResizeStart}
      />
    </aside>
  );
};
