import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TextInput } from "@dynatrace/strato-components/forms";
import { Menu } from "@dynatrace/strato-components/navigation";
import { ChevronDownIcon, CheckmarkIcon } from "@dynatrace/strato-icons";
import { useT } from "../i18n";
import type { EntityType, EntityRef } from "./entityModel";
import { ENTITY_TYPES, entityTypeLabel } from "./entityModel";
import { useEntityCatalog } from "./useEntityCatalog";
import type { EntityCatalogItem } from "./useEntityCatalog";

// ── Selector de entidad ──────────────────────────────────────────────────────
// Tipo (desplegable) + búsqueda por nombre (debounced en el hook). Los
// resultados salen en un DESPLEGABLE FLOTANTE anclado bajo la barra (estilo de
// los valores sugeridos de los filtros de Dynatrace), no en una caja con scroll
// embebida en el modal. El popup vive en un portal (document.body) con posición
// fija para que no lo recorte el modal ni la pestaña (mismo patrón que
// IconPicker). Al elegir una fila se emite el EntityRef y el popup se cierra.

type Props = {
  value?: EntityRef;
  onChange: (ref: EntityRef) => void;
};

const TypeDropdown = ({
  value,
  onChange,
  onMenuToggle,
}: {
  value: EntityType;
  onChange: (t: EntityType) => void;
  onMenuToggle?: (open: boolean) => void;
}) => {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Menu
      onOpenChange={(o) => {
        setOpen(o);
        onMenuToggle?.(o);
      }}
    >
      <Menu.Trigger>
        <button type="button" className="mapa-roledd mapa-roledd-md" aria-label={t("entity.typeLabel")}>
          <span className="mapa-roledd-label">{entityTypeLabel(value)}</span>
          <span className={`mapa-roledd-caret${open ? " mapa-roledd-caret-open" : ""}`}>
            <ChevronDownIcon size={12} />
          </span>
        </button>
      </Menu.Trigger>
      <Menu.Content>
        {ENTITY_TYPES.map((et) => (
          <Menu.Item
            key={et}
            className={`mapa-roledd-item${et === value ? " mapa-roledd-item-on" : ""}`}
            onSelect={() => {
              if (et !== value) onChange(et);
            }}
          >
            {entityTypeLabel(et)}
            {et === value && (
              <Menu.Suffix>
                <CheckmarkIcon size={14} />
              </Menu.Suffix>
            )}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu>
  );
};

export const EntityPicker = ({ value, onChange }: Props) => {
  const t = useT();
  const [type, setType] = useState<EntityType>(value?.type ?? "dt.entity.service");
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const { entities, isLoading, error, total, truncated } = useEntityCatalog(type, term);

  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<
    { left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null
  >(null);

  // Posición del popup a partir del rect de la fila de controles (coords de
  // viewport → position: fixed). Abre hacia abajo; si no cabe, hacia arriba.
  const computePos = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    const spaceBelow = window.innerHeight - r.bottom - margin;
    const spaceAbove = r.top - margin;
    if (spaceBelow < 220 && spaceAbove > spaceBelow) {
      setPos({ left: r.left, width: r.width, bottom: window.innerHeight - r.top + 6, maxHeight: spaceAbove - 6 });
    } else {
      setPos({ left: r.left, width: r.width, top: r.bottom + 6, maxHeight: spaceBelow - 6 });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    computePos();
    const onMove = () => computePos();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, computePos]);

  // Cierra al hacer clic fuera (controles o popup en portal).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (popRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Se emite SOLO el EntityRef: `ctx` es decoración del selector, no se persiste.
  const pick = (e: EntityCatalogItem) => {
    const { ctx: _ctx, ...ref } = e;
    onChange(ref);
    setOpen(false);
  };

  return (
    <div className="mapa-entpicker">
      <div
        className="mapa-entpicker-controls"
        ref={anchorRef}
        // Abre al entrar a la barra de búsqueda (solo el input, no el botón del
        // tipo — ese ya abre su propio menú) y cierra con Escape.
        onFocusCapture={(e) => {
          if (e.target instanceof HTMLInputElement) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <TypeDropdown
          value={type}
          onChange={(et) => {
            setType(et);
            setOpen(true);
          }}
          // Mientras el menú de categorías está desplegado, el popup de
          // resultados se esconde (si no, quedan dos flotantes encimados).
          onMenuToggle={(o) => {
            if (o) setOpen(false);
          }}
        />
        <TextInput
          value={term}
          onChange={setTerm}
          placeholder={t("entity.searchPlaceholder")}
        />
      </div>

      {open && pos &&
        createPortal(
          <div
            className="mapa-entpicker-pop"
            ref={popRef}
            style={{
              position: "fixed",
              left: pos.left,
              width: pos.width,
              top: pos.top,
              bottom: pos.bottom,
              maxHeight: pos.maxHeight,
              zIndex: 9999,
            }}
          >
            {/* Al llegar al tope se avisa cuántas hay en total: que nadie crea
                que "eso es todo" — hay que afinar la búsqueda (contexto o id). */}
            <div className={`mapa-entpicker-pophead${truncated ? " mapa-entpicker-pophead-warn" : ""}`}>
              {truncated && total !== undefined
                ? t("entity.truncated", { shown: entities.length, total })
                : t("entity.listHeader")}
            </div>
            <div className="mapa-entpicker-poplist nowheel">
              {isLoading ? (
                <div className="mapa-entpicker-msg">{t("entity.searching")}</div>
              ) : error ? (
                <div className="mapa-entpicker-msg">{t("entity.searchError", { msg: error })}</div>
              ) : entities.length === 0 ? (
                <div className="mapa-entpicker-msg">{t("entity.noResults")}</div>
              ) : (
                entities.map((e) => (
                  <button
                    type="button"
                    key={e.id}
                    className={`mapa-entpicker-row${e.id === value?.id ? " mapa-entpicker-row-on" : ""}`}
                    onClick={() => pick(e)}
                  >
                    {/* Columnas: nombre | contexto (namespace / workload…) | id.
                        El tipo NO se repite: ya está elegido en el desplegable. */}
                    <span className="mapa-entpicker-name" title={e.name || e.id}>{e.name || e.id}</span>
                    <span className="mapa-entpicker-ctx" title={e.ctx}>{e.ctx ?? ""}</span>
                    <span className="mapa-entpicker-id" title={e.id}>{e.id}</span>
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};
