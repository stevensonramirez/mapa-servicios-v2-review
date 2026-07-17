import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TextInput } from "@dynatrace/strato-components/forms";
import {
  AppIcon,
  ICON_BY_ID,
  ICON_CATEGORIES,
  ALL_CATEGORY,
  DEFAULT_ICON_ID,
  iconsByCategory,
  searchIcons,
  useCategoryLabel,
} from "./iconCatalog";
import type { IconEntry } from "./iconCatalog";
import { useT } from "../i18n";

type Props = {
  value?: string;
  onChange: (id: string) => void;
  // Ítem 9: cuando se pasa un chevron, reemplaza el ícono de lápiz + texto "Cambiar".
  chevron?: React.ReactNode;
  // Solo lectura: se ve el ícono actual pero no se abre el selector.
  disabled?: boolean;
};

const MAX_RESULTS = 300;

export const IconPicker = ({ value, onChange, chevron, disabled = false }: Props) => {
  const t = useT();
  const catLabel = useCategoryLabel();
  // Etiqueta localizada de un ícono (básicos traen labelKey; las marcas, no).
  const iconLabel = (e?: IconEntry): string | undefined => (e?.labelKey ? t(e.labelKey) : e?.label);
  const current = ICON_BY_ID[value ?? DEFAULT_ICON_ID] ?? ICON_BY_ID[DEFAULT_ICON_ID];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState(ALL_CATEGORY);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // El popup se renderiza en un portal (document.body) con posición fija para que
  // NO lo recorte el modal ni la pestaña (overflow). Aquí guardamos su posición.
  const [pos, setPos] = useState<
    { left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null
  >(null);

  // Cierra el popup al hacer clic fuera del selector (trigger o popup en portal).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (popRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Calcula la posición del popup a partir del rect del trigger (coords de
  // viewport → position: fixed). Abre hacia abajo; si no cabe, hacia arriba.
  const computePos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 320;
    const margin = 8;
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));
    const spaceBelow = window.innerHeight - r.bottom - margin;
    const spaceAbove = r.top - margin;
    if (spaceBelow < 260 && spaceAbove > spaceBelow) {
      setPos({ left, width, bottom: window.innerHeight - r.top + 6, maxHeight: spaceAbove - 6 });
    } else {
      setPos({ left, width, top: r.bottom + 6, maxHeight: spaceBelow - 6 });
    }
  }, []);

  // Recalcula al abrir y mientras esté abierto ante scroll/resize (captura para
  // atrapar también el scroll interno del modal).
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

  const { results, total } = useMemo<{ results: IconEntry[]; total: number }>(() => {
    const list = query.trim() ? searchIcons(query) : iconsByCategory(cat);
    return { results: list.slice(0, MAX_RESULTS), total: list.length };
  }, [query, cat]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="iconpk" ref={ref}>
      <button
        type="button"
        ref={triggerRef}
        className="iconpk-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={t("node.changeIcon")}
        disabled={disabled}
      >
        <span className="iconpk-current">
          <AppIcon id={current?.id} size={22} />
        </span>
        <span className="iconpk-current-name">{iconLabel(current) ?? t("iconpk.defaultIcon")}</span>
        {chevron ? (
          // Ítem 9: flechita hacia abajo en vez del ícono de lápiz + "Cambiar"
          <span className="iconpk-edit">{chevron}</span>
        ) : (
          <span className="iconpk-edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20h4L19 9l-4-4L4 16v4z" />
              <path d="M14 6l4 4" />
            </svg>
            {t("iconpk.change")}
          </span>
        )}
      </button>

      {open && pos &&
        createPortal(
          <div
            className="iconpk-pop"
            role="dialog"
            ref={popRef}
            style={{
              position: "fixed",
              left: pos.left,
              width: pos.width,
              top: pos.top,
              bottom: pos.bottom,
              maxHeight: pos.maxHeight,
              overflowY: "auto",
              zIndex: 9999,
            }}
          >
          <div className="iconpk-search">
            <TextInput value={query} onChange={setQuery} placeholder={t("iconpk.search")} />
          </div>

          {!query.trim() && (
            <div className="iconpk-tabs">
              {ICON_CATEGORIES.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`iconpk-tab${c === cat ? " iconpk-tab-on" : ""}`}
                  onClick={() => setCat(c)}
                >
                  {catLabel(c)}
                </button>
              ))}
            </div>
          )}

          <div className="iconpk-grid">
            {results.map((ic) => (
              <button
                type="button"
                key={ic.id}
                className={`iconpk-cell${ic.id === current?.id ? " iconpk-cell-on" : ""}`}
                title={iconLabel(ic)}
                onClick={() => pick(ic.id)}
              >
                <AppIcon id={ic.id} size={24} />
              </button>
            ))}
            {results.length === 0 && <div className="iconpk-empty">{t("iconpk.noResults")}</div>}
          </div>

          {total > results.length && (
            <div className="iconpk-note">{t("iconpk.showing", { count: results.length, total })}</div>
          )}
          </div>,
          document.body,
        )}
    </div>
  );
};
