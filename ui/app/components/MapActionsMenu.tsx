import React from "react";
import { Menu } from "@dynatrace/strato-components/navigation";
import { DotMenuIcon, EditIcon, DuplicateIcon, DownloadIcon, DeleteIcon, ShareIcon, QueryTreeIcon } from "@dynatrace/strato-icons";
import { useT } from "../i18n";

type Props = {
  onRename: () => void;
  onDuplicate: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onShare?: () => void;
  // Solo mapas normales: convertir en Mapa Padre (irreversible, confirma el caller).
  onConvert?: () => void;
  triggerClassName?: string;
  ariaLabel?: string;
  onOpenChange?: (open: boolean) => void;
};

// Menú de acciones de un mapa (⋮), NATIVO (Strato Menu: se porta fuera del overflow
// de la lista y evita colisiones). Mismas acciones que en Notebooks.
export function MapActionsMenu({
  onRename,
  onDuplicate,
  onDownload,
  onDelete,
  onShare,
  onConvert,
  triggerClassName = "mapa-iconbtn",
  ariaLabel,
  onOpenChange,
}: Props) {
  const t = useT();
  return (
    <Menu onOpenChange={onOpenChange}>
      <Menu.Trigger>
        <button type="button" className={triggerClassName} aria-label={ariaLabel ?? t("toolbar.mapActions")}>
          <DotMenuIcon size={16} />
        </button>
      </Menu.Trigger>
      <Menu.Content>
        {onShare && (
          <Menu.Item onSelect={onShare}>
            <Menu.Prefix>
              <ShareIcon />
            </Menu.Prefix>
            {t("actions.share")}
          </Menu.Item>
        )}
        <Menu.Item onSelect={onRename}>
          <Menu.Prefix>
            <EditIcon />
          </Menu.Prefix>
          {t("actions.rename")}
        </Menu.Item>
        <Menu.Item onSelect={onDuplicate}>
          <Menu.Prefix>
            <DuplicateIcon />
          </Menu.Prefix>
          {t("actions.duplicate")}
        </Menu.Item>
        <Menu.Item onSelect={onDownload}>
          <Menu.Prefix>
            <DownloadIcon />
          </Menu.Prefix>
          {t("actions.download")}
        </Menu.Item>
        {onConvert && (
          <Menu.Item onSelect={onConvert}>
            <Menu.Prefix>
              <QueryTreeIcon />
            </Menu.Prefix>
            {t("actions.convertParent")}
          </Menu.Item>
        )}
        <Menu.Item onSelect={onDelete}>
          <Menu.Prefix>
            <DeleteIcon />
          </Menu.Prefix>
          {t("actions.trash")}
        </Menu.Item>
      </Menu.Content>
    </Menu>
  );
}
