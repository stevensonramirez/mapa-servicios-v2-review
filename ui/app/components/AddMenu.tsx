import React from "react";
import { Menu } from "@dynatrace/strato-components/navigation";
import { PlusIcon, NodeIcon, LabelIcon, ImageIcon, GroupIcon } from "@dynatrace/strato-icons";
import { useT } from "../i18n";

type Props = {
  onAddNode: () => void;
  onAddLabel: () => void;
  onAddImage: () => void;
  onAddGroup: () => void;
};

// Botón "+" (solo ícono) con submenú para añadir cosas al mapa (Nodo / Título /
// Imagen / Agrupador), agrupando las acciones de "añadir" en un solo control.
// Trigger propio y Strato Menu nativo para el desplegable.
export const AddMenu = ({ onAddNode, onAddLabel, onAddImage, onAddGroup }: Props) => {
  const t = useT();
  return (
    <Menu>
      <Menu.Trigger>
        <button type="button" className="mapa-addbtn" aria-label={t("toolbar.addToMap")} title={t("toolbar.add")}>
          <PlusIcon size={18} />
        </button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item onSelect={onAddNode}>
          <Menu.Prefix>
            <NodeIcon />
          </Menu.Prefix>
          {t("addmenu.node")}
        </Menu.Item>
        <Menu.Item onSelect={onAddLabel}>
          <Menu.Prefix>
            <LabelIcon />
          </Menu.Prefix>
          {t("addmenu.label")}
        </Menu.Item>
        <Menu.Item onSelect={onAddImage}>
          <Menu.Prefix>
            <ImageIcon />
          </Menu.Prefix>
          {t("addmenu.image")}
        </Menu.Item>
        <Menu.Item onSelect={onAddGroup}>
          <Menu.Prefix>
            <GroupIcon />
          </Menu.Prefix>
          {t("addmenu.group")}
        </Menu.Item>
      </Menu.Content>
    </Menu>
  );
};
