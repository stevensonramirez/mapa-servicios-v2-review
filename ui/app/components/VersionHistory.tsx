import React, { useCallback, useEffect, useRef, useState } from "react";
import { Menu } from "@dynatrace/strato-components/navigation";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Modal } from "@dynatrace/strato-components/overlays";
import { Paragraph } from "@dynatrace/strato-components/typography";
import {
  HistoryIcon,
  ChevronRightIcon,
  ViewIcon,
  UndoIcon,
  DuplicateIcon,
  DownloadIcon,
  DeleteIcon,
} from "@dynatrace/strato-icons";
import { useT } from "../i18n";
import { ConfirmDialog } from "./ConfirmDialog";
import { useMapVersions } from "./useMapVersions";
import type { VersionItem } from "./useMapVersions";
import type { MapSnapshot } from "./useMapPersistence";

// Control de toolbar para el historial de versiones de un mapa.
// Botón HistoryIcon → dropdown agrupado por fecha → menú de acciones por versión.
// Modal "Ver todas" con lista completa paginada.

// ── Tipos exportados ──────────────────────────────────────────────────────────
export interface VersionHistoryProps {
  mapId: string | null;
  disabled?: boolean;
  // Descarta el autosave encolado ANTES de restaurar: un guardado en cola con el
  // contenido pre-restauración dispararía después y desharía la restauración.
  onBeforeRestore?: () => void;
  onRestored: () => void;
  onPreview: (snapshot: MapSnapshot, label: string) => void;
  onDuplicate: (snapshot: MapSnapshot) => void;
  onDownload: (snapshot: MapSnapshot, label: string) => void;
}

// ── Componente de avatar circular con iniciales ───────────────────────────────
const Avatar = ({ initials, title }: { initials: string; title?: string }) => (
  <span className="ver-avatar" aria-hidden="true" title={title}>
    {initials}
  </span>
);

// ── Menú de acciones por versión (Strato Menu) ────────────────────────────────
// La fila entera actúa como trigger implícito: el botón ChevronRight es el
// trigger oficial de Strato Menu para que el menú se abra al hacer clic.
interface VersionMenuProps {
  item: VersionItem;
  onPreview: (item: VersionItem) => Promise<void>;
  onRestoreConfirm: (item: VersionItem) => void;
  onDuplicate: (item: VersionItem) => Promise<void>;
  onDownload: (item: VersionItem) => Promise<void>;
  onDeleteConfirm: (item: VersionItem) => void;
}

const VersionItemRow = ({
  item,
  onPreview,
  onRestoreConfirm,
  onDuplicate,
  onDownload,
  onDeleteConfirm,
}: VersionMenuProps) => {
  const t = useT();

  return (
    <div className="ver-row" role="listitem">
      {/* Área de texto (info de la versión) — solo visual */}
      <div className="ver-row-info">
        <div className="ver-row-main">
          <strong className="ver-row-time">{item.timeLabel}</strong>
          <span className="ver-row-dash">{" – "}</span>
          <span className="ver-row-label">{item.label}</span>
        </div>
        <div className="ver-row-user">
          <Avatar initials={item.userInitials} title={item.userName} />
          <span className="ver-name">{item.userName}</span>
        </div>
      </div>

      {/* Trigger del menú de acciones: el botón ChevronRight a la derecha */}
      <Menu>
        <Menu.Trigger>
          <button
            type="button"
            className="mapa-iconbtn ver-row-chevron-btn"
            aria-label={`${t("toolbar.mapActions")} ${item.label}`}
            title={item.label}
          >
            <ChevronRightIcon size={14} />
          </button>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Group>
            <Menu.Item onSelect={() => { void onPreview(item); }}>
              <Menu.Prefix><ViewIcon /></Menu.Prefix>
              {t("ver.preview")}
            </Menu.Item>
            <Menu.Item onSelect={() => onRestoreConfirm(item)}>
              <Menu.Prefix><UndoIcon /></Menu.Prefix>
              {t("ver.restore")}
            </Menu.Item>
            <Menu.Item onSelect={() => { void onDuplicate(item); }}>
              <Menu.Prefix><DuplicateIcon /></Menu.Prefix>
              {t("ver.duplicate")}
            </Menu.Item>
            <Menu.Item onSelect={() => { void onDownload(item); }}>
              <Menu.Prefix><DownloadIcon /></Menu.Prefix>
              {t("ver.download")}
            </Menu.Item>
          </Menu.Group>
          <Menu.Group>
            <Menu.Item onSelect={() => onDeleteConfirm(item)}>
              <Menu.Prefix><DeleteIcon /></Menu.Prefix>
              {t("ver.delete")}
            </Menu.Item>
          </Menu.Group>
        </Menu.Content>
      </Menu>
    </div>
  );
};

// ── Componente principal ──────────────────────────────────────────────────────
export function VersionHistory({
  mapId,
  disabled = false,
  onBeforeRestore,
  onRestored,
  onPreview,
  onDuplicate,
  onDownload,
}: VersionHistoryProps): React.JSX.Element {
  const t = useT();
  const {
    groups,
    totalCount,
    loading,
    error,
    refresh,
    fetchMore,
    hasMore,
    getContent,
    restoreServer,
    deleteServer,
  } = useMapVersions(mapId);

  // Dropdown principal
  const [dropdownOpen, setDropdownOpen] = useState(false);
  // Modal "Ver todas"
  const [allOpen, setAllOpen] = useState(false);
  // Confirmación pendiente
  const [confirmItem, setConfirmItem] = useState<VersionItem | null>(null);
  const [confirmKind, setConfirmKind] = useState<"restore" | "delete" | null>(null);
  // Prevención de doble clic en acciones async
  const [actionBusy, setActionBusy] = useState(false);
  // Error de la ÚLTIMA acción (restaurar/eliminar/preview/…): antes un fallo era
  // totalmente mudo (try/finally sin catch → rechazo no manejado) y el usuario
  // creía que la acción se había hecho.
  const [actionError, setActionError] = useState(false);

  // Referencia al dropdown para cerrar al hacer clic afuera
  const dropdownRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Cierra el dropdown al hacer clic afuera o presionar Escape
  useEffect(() => {
    if (!dropdownOpen) return;
    // El menú de acciones (Strato Menu = Radix DropdownMenu) renderiza su
    // contenido en un PORTAL a document.body, FUERA de este dropdown. Si
    // tratáramos ese clic como "afuera", cerraríamos el dropdown y
    // desmontaríamos el menú en el mousedown, ANTES de que su onSelect (click)
    // alcance a dispararse → las acciones no harían nada. Por eso ignoramos los
    // clics que caen dentro de cualquier capa flotante de Radix.
    const inFloatingLayer = (target: Node): boolean => {
      const el = target instanceof Element ? target : target.parentElement;
      return !!el?.closest('[data-radix-popper-content-wrapper], [role="menu"]');
    };
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (inFloatingLayer(target)) return;
      const inDropdown = dropdownRef.current?.contains(target) ?? false;
      const inBtn = btnRef.current?.contains(target) ?? false;
      if (!inDropdown && !inBtn) setDropdownOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Si hay un menú flotante abierto, que Escape lo cierre a él primero.
      if (document.querySelector('[role="menu"]')) return;
      setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dropdownOpen]);

  // ── Acciones async (preview / duplicar / descargar) ───────────────────────
  const handlePreview = useCallback(
    async (item: VersionItem): Promise<void> => {
      if (actionBusy) return;
      setActionBusy(true);
      setActionError(false);
      setDropdownOpen(false);
      try {
        const snap = await getContent(item.snapshotVersion);
        onPreview(snap, item.label);
      } catch {
        setActionError(true);
        setDropdownOpen(true); // reabre para que el error sea visible
      } finally {
        setActionBusy(false);
      }
    },
    [actionBusy, getContent, onPreview],
  );

  const handleDuplicate = useCallback(
    async (item: VersionItem): Promise<void> => {
      if (actionBusy) return;
      setActionBusy(true);
      setActionError(false);
      setDropdownOpen(false);
      setAllOpen(false);
      try {
        const snap = await getContent(item.snapshotVersion);
        onDuplicate(snap);
      } catch {
        setActionError(true);
        setDropdownOpen(true);
      } finally {
        setActionBusy(false);
      }
    },
    [actionBusy, getContent, onDuplicate],
  );

  const handleDownload = useCallback(
    async (item: VersionItem): Promise<void> => {
      if (actionBusy) return;
      setActionBusy(true);
      setActionError(false);
      setDropdownOpen(false);
      try {
        const snap = await getContent(item.snapshotVersion);
        onDownload(snap, item.label);
      } catch {
        setActionError(true);
        setDropdownOpen(true);
      } finally {
        setActionBusy(false);
      }
    },
    [actionBusy, getContent, onDownload],
  );

  // ── Confirmaciones ────────────────────────────────────────────────────────
  const handleRestoreConfirm = useCallback((item: VersionItem) => {
    setConfirmItem(item);
    setConfirmKind("restore");
    setDropdownOpen(false);
  }, []);

  const handleDeleteConfirm = useCallback((item: VersionItem) => {
    setConfirmItem(item);
    setConfirmKind("delete");
    setDropdownOpen(false);
  }, []);

  const handleConfirmOk = useCallback(async () => {
    if (!confirmItem || !confirmKind || actionBusy) return;
    const item = confirmItem;
    const kind = confirmKind;
    setConfirmItem(null);
    setConfirmKind(null);
    setActionBusy(true);
    setActionError(false);
    try {
      if (kind === "restore") {
        // Descarta el autosave encolado: si quedara vivo, dispararía DESPUÉS de
        // restaurar y re-escribiría el contenido pre-restauración sobre lo
        // restaurado ("Restaurar no hizo nada").
        onBeforeRestore?.();
        await restoreServer(item.snapshotVersion);
        setAllOpen(false);
        onRestored();
      } else {
        await deleteServer(item.snapshotVersion);
        refresh();
      }
    } catch {
      setActionError(true);
      setDropdownOpen(true);
    } finally {
      setActionBusy(false);
    }
  }, [confirmItem, confirmKind, actionBusy, onBeforeRestore, restoreServer, deleteServer, onRestored, refresh]);

  const handleConfirmCancel = useCallback(() => {
    setConfirmItem(null);
    setConfirmKind(null);
  }, []);

  // ── Versiones del dropdown (primeras MAX_INLINE) ──────────────────────────
  const MAX_INLINE = 4;
  const inlineItems: VersionItem[] = [];
  for (const g of groups) {
    for (const item of g.items) {
      if (inlineItems.length >= MAX_INLINE) break;
      inlineItems.push(item);
    }
    if (inlineItems.length >= MAX_INLINE) break;
  }

  // Texto y etiqueta del diálogo de confirmación
  const confirmMessage =
    confirmKind === "restore" && confirmItem
      ? t("ver.confirmRestore", { label: confirmItem.label })
      : confirmKind === "delete" && confirmItem
        ? t("ver.confirmDelete", { label: confirmItem.label })
        : "";
  const confirmLabel =
    confirmKind === "restore" ? t("ver.restore") : t("ver.delete");

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Botón de historial */}
      <div className="ver-root">
        <button
          ref={btnRef}
          type="button"
          className={`mapa-iconbtn${dropdownOpen ? " ver-btn-active" : ""}`}
          aria-label={t("ver.history")}
          title={t("ver.history")}
          disabled={disabled || !mapId}
          onClick={() => setDropdownOpen((v) => !v)}
          aria-expanded={dropdownOpen}
          aria-haspopup="true"
        >
          <HistoryIcon size={16} />
        </button>

        {/* Dropdown principal */}
        {dropdownOpen && (
          <div
            ref={dropdownRef}
            className="ver-dropdown"
            role="dialog"
            aria-label={t("ver.history")}
          >
            {/* Cargando */}
            {loading && groups.length === 0 && (
              <div className="ver-state">{t("ver.loading")}</div>
            )}

            {/* Error de permisos */}
            {error && (
              <div className="ver-state ver-state-error">{t("ver.noAccess")}</div>
            )}

            {/* Error de la última acción (restaurar/eliminar/preview/…) */}
            {actionError && (
              <div className="ver-state ver-state-error">{t("ver.actionError")}</div>
            )}

            {/* Vacío */}
            {!loading && !error && groups.length === 0 && (
              <div className="ver-state">{t("ver.empty")}</div>
            )}

            {/* Lista agrupada por fecha (solo las primeras MAX_INLINE) */}
            {inlineItems.length > 0 && (() => {
              // Re-agrupa los ítems inline por dateLabel para mostrar los encabezados.
              const inlineGroups = new Map<string, VersionItem[]>();
              for (const item of inlineItems) {
                const existing = inlineGroups.get(item.dateLabel);
                if (existing) {
                  existing.push(item);
                } else {
                  inlineGroups.set(item.dateLabel, [item]);
                }
              }
              return Array.from(inlineGroups.entries()).map(([dateLabel, items]) => (
                <div key={dateLabel} className="ver-group">
                  <div className="ver-date">{dateLabel}</div>
                  <div role="list">
                    {items.map((item) => (
                      <VersionItemRow
                        key={item.snapshotVersion}
                        item={item}
                        onPreview={handlePreview}
                        onRestoreConfirm={handleRestoreConfirm}
                        onDuplicate={handleDuplicate}
                        onDownload={handleDownload}
                        onDeleteConfirm={handleDeleteConfirm}
                      />
                    ))}
                  </div>
                </div>
              ));
            })()}

            {/* "Ver todas" si hay más versiones que MAX_INLINE */}
            {totalCount > MAX_INLINE && !error && (
              <>
                <hr className="ver-divider" />
                <button
                  type="button"
                  className="ver-showall"
                  onClick={() => {
                    setDropdownOpen(false);
                    setAllOpen(true);
                  }}
                >
                  {t("ver.showAll")} ({totalCount})
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Modal "Ver todas" */}
      <Modal
        title={t("ver.allTitle")}
        show={allOpen}
        size="small"
        onDismiss={() => setAllOpen(false)}
      >
        <div className="ver-all-body">
          {loading && groups.length === 0 && (
            <Paragraph>{t("ver.loading")}</Paragraph>
          )}
          {error && (
            <Paragraph>{t("ver.noAccess")}</Paragraph>
          )}
          {!loading && !error && groups.length === 0 && (
            <Paragraph>{t("ver.empty")}</Paragraph>
          )}
          {groups.map((group) => (
            <div key={group.dateLabel} className="ver-group">
              <div className="ver-date">{group.dateLabel}</div>
              <div role="list">
                {group.items.map((item) => (
                  <VersionItemRow
                    key={item.snapshotVersion}
                    item={item}
                    onPreview={handlePreview}
                    onRestoreConfirm={handleRestoreConfirm}
                    onDuplicate={handleDuplicate}
                    onDownload={handleDownload}
                    onDeleteConfirm={handleDeleteConfirm}
                  />
                ))}
              </div>
            </div>
          ))}
          {hasMore && (
            <Flex justifyContent="center" paddingTop={8}>
              <Button
                variant="default"
                onClick={() => void fetchMore()}
                disabled={loading || actionBusy}
              >
                {loading ? t("ver.loading") : t("ver.loadMore")}
              </Button>
            </Flex>
          )}
        </div>
      </Modal>

      {/* Diálogo de confirmación */}
      <ConfirmDialog
        show={confirmItem !== null}
        title={confirmKind === "restore" ? t("ver.restore") : t("ver.delete")}
        message={confirmMessage}
        confirmLabel={confirmLabel}
        onConfirm={() => void handleConfirmOk()}
        onCancel={handleConfirmCancel}
      />
    </>
  );
}
