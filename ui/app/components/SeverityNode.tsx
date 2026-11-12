import React, { useEffect, useMemo, useRef, useState } from "react";
import { Handle, Position, NodeToolbar, useInternalNode, useViewport, useStore } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { Menu } from "@dynatrace/strato-components/navigation";
import { EditIcon, DuplicateIcon, DotMenuIcon, DescriptionIcon, WorkflowSimpleIcon, ExternalLinkIcon } from "@dynatrace/strato-icons";
import { AppIcon } from "./iconCatalog";
import { TrashIcon } from "./TrashIcon";
import { useMapSettings } from "./mapSettings";
import type { GlowLevel } from "./mapSettings";
import { usePopUi } from "./popUi";
import { useT } from "../i18n";
import type { EntityRef } from "./entityModel";
import { openEntity } from "./entityModel";
import { mapHref } from "./mapLink";
import { evalRules, sanitizeRules, submapMetricOf } from "./submapRules";
import type { ColorRule, SubmapMetric } from "./submapRules";

// Severidad por el CONTRATO del DQL: 0=Ok, 1=Warning, 2=Error,
// "unknown" = sin datos / DQL vacío / error.
export type Severity = 0 | 1 | 2 | "unknown";

// Tamaño visual del nodo. "md" = el de siempre (por defecto).
export type NodeSize = "sm" | "md" | "lg";

// Forma visual del nodo: rectangular (horizontal) o cuadrada.
export type NodeShape = "rect" | "square";

export type SeverityNodeData = {
  name: string;
  kind: string;
  severity: Severity;
  // DQL (solo lectura) cuyo resultado `status` (0/1/2) colorea el nodo.
  dql?: string;
  // Id del ícono en el catálogo (ver iconCatalog).
  icon?: string;
  // Tamaño del nodo (sm/md/lg); por defecto "md".
  size?: NodeSize;
  // Forma del nodo (rect/square); por defecto "rect".
  shape?: NodeShape;
  // URL única LEGADA (versiones viejas). Ya no se edita: al abrir el editor se
  // migra como primer elemento de `links` y al guardar queda en undefined.
  url?: string;
  // Links del nodo (título + URL). Con 1 link el clic sobre el texto lo abre
  // directo; con 2+ abre un popup con la lista de títulos. Funciona en edición
  // y en solo lectura. Se editan en la pestaña "Links y Aspecto".
  links?: NodeLink[];
  // Nota libre del autor. Se muestra como un ícono desplegable en el nodo
  // SOLO en modo edición (pop.enabled); no aparece en solo lectura/compartido.
  note?: string;

  // ── Atadura a una entidad real (topología / estado por Davis) ──────────────
  // PERSISTIDO. Entidad de Dynatrace a la que este nodo está atado (servicio,
  // host, …). Habilita el estado por Davis y la topología (calls/called_by).
  entity?: EntityRef;
  // PERSISTIDO. Motor que determina la severidad del nodo:
  //   "davis" → problemas activos de la entidad atada (requiere `entity`)
  //   "dql"   → el DQL propio del nodo (comportamiento clásico)
  //   "map"   → salud de un Mapa de Servicio incrustado (requiere `mapRef`)
  // Sin valor, el default se decide en render: entity ? "davis" : "dql".
  statusSource?: StatusSource;

  // ── Mapa incrustado (solo dentro de un Mapa Padre) ──────────────────────────
  // PERSISTIDO. Mapa de Servicio que este nodo representa: su salud sale en un
  // pill sobre el nodo y el color lo deciden las reglas de abajo. El nombre se
  // guarda para poder mostrarlo sin descargar el documento.
  mapRef?: { id: string; name: string };
  // PERSISTIDO. Métrica del mapa incrustado sobre la que evalúan las reglas
  // ("% de nodos sanos" por defecto) y las reglas de color en ORDEN (máx. 3).
  // Sin valor → los defaults de submapRules.
  mapMetric?: SubmapMetric;
  mapRules?: ColorRule[];

  // ── Salud de conexiones (pill encima del nodo) ──────────────────────────────
  // PERSISTIDO. Muestra un pill con el % de entidades CONECTADAS a esta en
  // Smartscape (calls/called_by reales, estén o no dibujadas en el mapa) sin
  // problemas activos de Davis. Solo aplica con fuente "davis"; default: off.
  connHealth?: boolean;
  // PERSISTIDO. Umbral de rojo: si la salud llega a este % o menos, el nodo se
  // pone rojo por la REGLA de salud de conexiones (no por Davis). Default 80.
  connHealthRedAt?: number;

  // ── Campos TRANSITORIOS (inyectados solo al renderizar; NO se persisten) ────
  // Entidad dada de baja: atada pero ausente en su tabla → aviso visual.
  retired?: boolean;
  // Nombre EN VIVO de la entidad (detecta renombrados desde que se ató).
  liveName?: string;
  // Cantidad de problemas activos de Davis sobre la entidad (para el tooltip).
  problems?: number;
  // Ids de entidad "en juego" para el resaltado de "Relacionados" (transitorio).
  displayIds?: string[];
  // Salud de conexiones (transitorios; los calcula MapCanvas):
  //   connPct: % 0-100 · null = sin conexiones (N.A.) · undefined = cargando.
  //   connBad/connTotal: conexiones con problema / total (tooltip del pill).
  //   connRule: true si el nodo está ROJO por la regla (pct ≤ umbral).
  connPct?: number | null;
  connBad?: number;
  connTotal?: number;
  connRule?: boolean;
  // TRANSITORIO: falló la consulta de relaciones (pill "…" con tooltip de error).
  connErr?: boolean;
  // Mapa incrustado (transitorios; los calcula MapCanvas vía useSubmapStatus):
  //   mapPct: % de nodos sanos 0-100 · null = el hijo no tiene nodos con fuente
  //           de estado · undefined = evaluando.
  //   mapOk/mapAffected/mapTotal: sanos / afectados / nodos con fuente de estado.
  //   mapError: el documento del hijo no se pudo leer (sin acceso o borrado).
  mapPct?: number | null;
  mapOk?: number;
  mapAffected?: number;
  mapTotal?: number;
  mapError?: boolean;
  // TRANSITORIO (no se persiste): marcas del último análisis de causa raíz.
  // rcRoots = números de causa raíz que están en este nodo; rcEffects = números de
  // las causas de las que este nodo es EFECTO (sin repetir las de rcRoots).
  rcRoots?: number[];
  rcResolved?: number[]; // causas raíz de este nodo que YA se resolvieron (✓ verde)
  rcEffects?: number[];
  rcEffectsResolved?: number[]; // efectos de N cuyos problemas YA se cerraron («✓ Efecto de N»)
};

// Motor que decide la severidad de un nodo.
export type StatusSource = "davis" | "dql" | "map";

// Fuente de estado EFECTIVA de un nodo: normaliza el valor persistido contra lo
// que el nodo realmente tiene atado. Sin entidad no hay Davis y sin mapa atado no
// hay mapa incrustado → en ambos casos cae al DQL propio (clásico).
// Causas raíz a la vista en la marca de un nodo: las RC_MAX_NS primeras (en orden)
// y cuántas más hay («+N»). La lista completa queda en el tooltip.
const RC_MAX_NS = 3;
const rcCompact = (ns: number[]): { shown: number[]; rest: number } => {
  const sorted = [...ns].sort((a, b) => a - b);
  return { shown: sorted.slice(0, RC_MAX_NS), rest: Math.max(0, sorted.length - RC_MAX_NS) };
};

export const nodeStatusSource = (d: SeverityNodeData): StatusSource => {
  if (d.statusSource === "map") return d.mapRef?.id ? "map" : "dql";
  if (d.statusSource === "dql") return "dql";
  return d.entity?.id ? "davis" : "dql";
};

// Ícono por defecto de un nodo de mapa incrustado: que se note de una qué es.
export const SUBMAP_ICON_ID = "dt:WorldmapIcon";

// Valor de la MÉTRICA sobre la que evalúan las reglas de color de un nodo de mapa
// incrustado. null = todavía no hay nada que evaluar (cargando, sin acceso, o el
// hijo no tiene nodos con fuente de estado) → el nodo queda neutro.
export const submapMetricValue = (d: SeverityNodeData): number | null => {
  if (d.mapError) return null;
  if (submapMetricOf(d.mapMetric) === "affectedCount") {
    return typeof d.mapAffected === "number" ? d.mapAffected : null;
  }
  return typeof d.mapPct === "number" ? d.mapPct : null;
};

// Severidad de un nodo de mapa incrustado: la primera regla que se cumpla sobre
// su métrica. Sin métrica evaluable → "unknown" (gris, sin glow): nunca un verde
// falso mientras carga o si no hay acceso al documento.
export const submapSeverity = (d: SeverityNodeData): Severity => {
  const value = submapMetricValue(d);
  if (value === null) return "unknown";
  return evalRules(sanitizeRules(d.mapRules), value);
};

// Umbral de rojo por defecto para la regla de salud de conexiones, y su
// saneo (persistido → puede venir corrupto de un import): entero 0..100.
export const DEFAULT_CONN_RED_AT = 80;
export const clampConnRedAt = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_CONN_RED_AT;
  return Math.min(100, Math.max(0, Math.round(n)));
};

// Devuelve la URL http(s) normalizada si `raw` es una URL válida; si no, "".
// Solo http/https (para abrir con seguridad en pestaña nueva). Si el usuario
// no escribe el esquema pero parece un dominio, se intenta con https://.
export const safeHref = (raw: unknown): string => {
  if (typeof raw !== "string") return "";
  const s = raw.trim();
  if (!s) return "";
  const parse = (v: string): string => {
    try {
      const u = new URL(v);
      return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
    } catch {
      return "";
    }
  };
  const direct = parse(s);
  if (direct) return direct;
  // Sin esquema: si parece un dominio (tiene punto y no tiene espacios) probamos https://.
  if (!/\s/.test(s) && /\./.test(s)) return parse(`https://${s}`);
  return "";
};

// Un link del nodo: título visible + URL. En el popup se muestra SOLO el
// título; al tocarlo se abre la URL en pestaña nueva.
export type NodeLink = { title: string; url: string };

// Links VIGENTES de un nodo, ya saneados (solo http/https vía safeHref) y con
// título de respaldo (la propia URL si el título vino vacío). Si el nodo aún no
// tiene lista `links`, la URL única LEGADA se migra al vuelo como primer link.
export const nodeLinks = (data: SeverityNodeData): NodeLink[] => {
  const raw = Array.isArray(data.links) ? data.links : [];
  const out: NodeLink[] = [];
  for (const l of raw) {
    const href = safeHref((l as NodeLink | undefined)?.url);
    if (!href) continue;
    const t = typeof l?.title === "string" && l.title.trim() ? l.title.trim() : href;
    out.push({ title: t, url: href });
  }
  if (out.length === 0) {
    const legacy = safeHref(data.url);
    if (legacy) out.push({ title: legacy, url: legacy });
  }
  return out;
};

export type SeverityNodeType = Node<SeverityNodeData, "severity">;

// PROTOTIPO NULO en los lookups por dato persistido: con objetos planos, un
// valor corrupto tipo "constructor" devolvería el miembro heredado (truthy) y
// esquivaría el fallback `??` (className/props basura). Ver ICON_BY_ID.
const nullRec = <T,>(o: Record<string, T>): Record<string, T> =>
  Object.assign(Object.create(null) as Record<string, T>, o);

const SEV_CLASS: Record<string, string> = nullRec({
  "0": "sev-ok",
  "1": "sev-warn",
  "2": "sev-err",
  unknown: "sev-unknown",
});

// Símbolo compacto que reemplaza el texto en la badge del nodo.
const SEV_SYMBOL: Record<string, string> = nullRec({
  "0": "✓",
  "1": "!",
  "2": "✕",
  unknown: "?",
});

const SIZE_CLASS: Record<string, string> = nullRec({ sm: "sev-sm", md: "sev-md", lg: "sev-lg" });
const ICON_PX: Record<string, number> = nullRec({ sm: 14, md: 17, lg: 27 });

export const SeverityNode = ({ id, data, selected }: NodeProps<SeverityNodeType>) => {
  const settings = useMapSettings();
  const t = useT();
  const pop = usePopUi();
  // Nota del nodo: se abre/cierra al hacer clic en su ícono (solo en edición).
  const [noteOpen, setNoteOpen] = useState(false);
  // Popup "Editar" flotante: aparece SOLO al seleccionar el nodo (clic), no en hover.
  // El clic lo selecciona y muestra el popup; el editor de DQL no se abre hasta pulsar
  // "Editar". Se oculta al mover varios a la vez.
  const multiSelected = useStore((s) => {
    let count = 0;
    s.nodeLookup.forEach((n) => {
      if (n.selected) count++;
    });
    return count > 1;
  });
  // Colocación para que el popup NO se recorte contra el borde del lienzo
  // (overflow:hidden): si el nodo está muy arriba lo mostramos ABAJO, y según el
  // costado alineamos al inicio/fin en vez de centrado.
  const vp = useViewport();
  const internal = useInternalNode(id);
  const paneW = useStore((s) => s.width);
  const placement = useMemo<{ position: Position; align: "start" | "center" | "end" }>(() => {
    const p = internal?.internals.positionAbsolute;
    if (!p) return { position: Position.Top, align: "center" };
    const w = internal?.measured?.width ?? 0;
    const screenTop = p.y * vp.zoom + vp.y;
    const centerX = (p.x + w / 2) * vp.zoom + vp.x;
    const half = 60; // semiancho aproximado del popup
    const position = screenTop < 56 ? Position.Bottom : Position.Top;
    let align: "start" | "center" | "end" = "center";
    if (centerX - half < 8) align = "start";
    else if (centerX + half > paneW - 8) align = "end";
    return { position, align };
  }, [internal, vp.x, vp.y, vp.zoom, paneW]);
  const sev = String(data.severity ?? "unknown");
  const cls = SEV_CLASS[sev] ?? "sev-unknown";
  const SEV_LABEL: Record<string, string> = {
    "0": t("node.badgeOk"),
    "1": t("node.badgeWarn"),
    "2": t("node.badgeErr"),
    unknown: t("sev.nodeNoData"),
  };
  const label = SEV_LABEL[sev] ?? t("sev.nodeNoData");
  const symbol = SEV_SYMBOL[sev] ?? "?";
  const size = data.size ?? "md";
  const sizeCls = SIZE_CLASS[size] ?? "sev-md";
  const shape = data.shape ?? "rect";
  // Nivel de glow por estado (ajuste por mapa). "unknown" no lleva glow.
  const glowKey = sev === "0" ? "ok" : sev === "1" ? "warn" : sev === "2" ? "err" : null;
  const glowLevel: GlowLevel = glowKey ? (settings.glow?.[glowKey] ?? "medium") : "medium";
  const glowCls = glowKey ? ` mapa-glow-${glowLevel}` : "";

  // ¿El nodo está atado a una entidad real? Habilita el botón "Relacionados".
  const hasEntity = Boolean(data.entity?.id);
  // Pill de salud de conexiones: solo si el usuario lo activó Y la fuente del
  // estado es Davis con entidad atada (con DQL el dato no existe).
  const statusSrc = nodeStatusSource(data);
  const showConnPill = Boolean(data.connHealth) && statusSrc === "davis" && hasEntity;
  // ── Mapa incrustado: pill con su métrica, coloreado por las reglas ──────────
  // El color del pill es el MISMO que decidieron las reglas para el nodo (no una
  // escala aparte): si ninguna regla se cumple, el pill queda gris igual que el
  // nodo, y el tooltip lo dice de frente en vez de inventar un estado.
  const isSubmap = statusSrc === "map";
  const mapPct = data.mapPct;
  const mapMetric = submapMetricOf(data.mapMetric);
  const mapValue = submapMetricValue(data);
  const submapPillCls =
    mapValue === null || sev === "unknown"
      ? "sev-connpill-na"
      : sev === "0"
        ? "sev-connpill-ok"
        : sev === "1"
          ? "sev-connpill-warn"
          : "sev-connpill-bad";
  const submapPillText = data.mapError
    ? "—"
    : mapPct === null
      ? "N.A."
      : mapValue === null
        ? "…"
        : mapMetric === "affectedCount"
          ? t("submap.pillCount", { n: String(mapValue) })
          : `${mapValue}%`;
  const submapPillTitle = data.mapError
    ? t("submap.noAccess")
    : mapPct === null
      ? t("submap.noMonitored")
      : mapValue === null
        ? t("submap.loadingTitle")
        : sev === "unknown"
          ? t("submap.noRuleMatched")
          : t("submap.pillTitle", {
              pct: String(mapPct ?? 0),
              ok: String(data.mapOk ?? 0),
              total: String(data.mapTotal ?? 0),
            });
  const connPct = data.connPct;
  const connPillCls =
    connPct == null ? "sev-connpill-na" : data.connRule ? "sev-connpill-bad" : "sev-connpill-ok";
  const connPillText =
    connPct === null ? t("connhealth.na") : connPct === undefined ? "…" : `${connPct}%`;
  const connPillTitle =
    connPct === null
      ? t("connhealth.naTitle")
      : connPct === undefined
        ? data.connErr
          ? t("connhealth.errorTitle")
          : t("connhealth.loadingTitle")
        : t("connhealth.pillTitle", {
            pct: String(connPct),
            bad: String(data.connBad ?? 0),
            total: String(data.connTotal ?? 0),
          });
  // ¿El popover "Relacionados" de ESTE nodo está abierto? (Estado en MapCanvas,
  // que es quien tiene los nodos/rayas del mapa para construir las secciones.)
  const relatedOpen = pop.relatedNodeId === id;

  // Links del nodo (incluye la URL legada migrada al vuelo). Con 1 → el texto
  // abre directo; con 2+ → el texto abre un popup con la lista de títulos.
  // Funciona en edición y en solo lectura.
  // Un nodo sub-mapa antepone el enlace a su mapa hijo (…/map/<id>): con eso, el
  // TEXTO del nodo abre el mapa en una pestaña nueva, igual en edición y en solo
  // lectura. Si además tiene links propios, el hijo queda de primero en el popup.
  const links = useMemo(() => {
    const own = nodeLinks(data);
    if (!isSubmap) return own;
    const href = mapHref(data.mapRef?.id ?? "");
    if (!href) return own;
    return [{ title: data.mapRef?.name || data.name, url: href }, ...own];
  }, [data, isSubmap]);
  const [linksOpen, setLinksOpen] = useState(false);
  // Si la lista baja de 2 (se editó el nodo), el popup ya no aplica: cerrarlo
  // para que no se re-abra solo al volver a haber varios links.
  useEffect(() => {
    if (links.length < 2) setLinksOpen(false);
  }, [links.length]);
  const openLink = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
    setLinksOpen(false);
  };
  // Clic POR FUERA del popup (o del propio texto del nodo) → cerrarlo. Listener
  // en fase de CAPTURA sobre document: corre antes que cualquier stopPropagation
  // del lienzo, y el popup vive en un portal (NodeToolbar) pero sigue dentro del
  // mismo document, así que `contains` lo cubre.
  const linksPopRef = useRef<HTMLDivElement | null>(null);
  const linksBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!linksOpen) return;
    const onDown = (e: MouseEvent) => {
      // OJO: `HTMLElement`, no `Node` — aquí `Node` es el tipo de @xyflow/react.
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (linksPopRef.current?.contains(target) || linksBtnRef.current?.contains(target)) return;
      setLinksOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [linksOpen]);
  // Nota: ícono desplegable SOLO en modo edición (pop.enabled) y si hay texto.
  const noteText = typeof data.note === "string" ? data.note.trim() : "";
  const showNote = pop.enabled && noteText.length > 0;
  // Si la nota deja de mostrarse (se borró, o el mapa pasó a un modo sin edición),
  // cerrarla: si `noteOpen` quedara en true, el popover se re-abriría SOLO al
  // volver a haber nota, sin clic del usuario.
  useEffect(() => {
    if (!showNote) setNoteOpen(false);
  }, [showNote]);

  return (
    <div
      className={`sev-node ${sizeCls} ${cls}${shape === "square" ? " sev-square" : ""}${glowCls}${selected ? " sev-selected" : ""}`}
    >
      <NodeToolbar
        isVisible={pop.enabled && !multiSelected && selected}
        position={placement.position}
        align={placement.align}
        offset={8}
      >
        <div className="mapa-label-toolbar nodrag nopan">
          <button type="button" className="mapa-label-editbtn" onClick={() => pop.onEditNode(id)}>
            <EditIcon size={14} />
            <span>{t("label.edit")}</span>
          </button>
          {/* "Relacionados": solo si el nodo está atado a una entidad. Reusa el
              patrón del ícono de nota (stopPropagation en mousedown/click) y
              delega el popover a MapCanvas (necesita los nodos/rayas del mapa). */}
          {hasEntity && pop.relatedEnabled && (
            <>
              <span className="mapa-label-tb-sep" />
              <button
                type="button"
                className={`mapa-label-tb-btn${relatedOpen ? " mapa-label-tb-btn-on" : ""}`}
                aria-label={t("related.title")}
                title={t("related.title")}
                aria-expanded={relatedOpen}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  pop.onToggleRelated(relatedOpen ? null : id);
                }}
              >
                <WorkflowSimpleIcon size={16} />
              </button>
            </>
          )}
          <span className="mapa-label-tb-sep" />
          <Menu>
            <Menu.Trigger>
              <button type="button" className="mapa-label-tb-btn" aria-label={t("label.more")} title={t("label.more")}>
                <DotMenuIcon size={16} />
              </button>
            </Menu.Trigger>
            <Menu.Content>
              <Menu.Item onSelect={() => pop.onDuplicateNode(id)}>
                <Menu.Prefix>
                  <DuplicateIcon />
                </Menu.Prefix>
                {t("node.duplicateLabel")}
              </Menu.Item>
              <Menu.Item onSelect={() => pop.onRequestDeleteNode(id)}>
                <Menu.Prefix>
                  <TrashIcon label={t("node.deleteLabel")} />
                </Menu.Prefix>
                {t("node.deleteLabel")}
              </Menu.Item>
            </Menu.Content>
          </Menu>
        </div>
      </NodeToolbar>

      <Handle type="target" position={Position.Left} className="sev-handle" />

      {/* Pill de salud de conexiones: flotando ENCIMA del nodo (lado derecho,
          a la izquierda de donde sale la burbujita "?"). Gris "N.A." si la
          entidad no tiene conexiones; rojo si la salud llegó al umbral.
          CLIC → abre la entidad AISLADA en Smartscape (vista all-topology, el
          mismo deep-link verificado de openEntity) para ver esas conexiones.
          stopPropagation para no seleccionar/arrastrar el nodo. */}
      {showConnPill && (
        <button
          type="button"
          className={`sev-connpill ${connPillCls} nodrag nopan`}
          title={`${connPillTitle} — ${t("connhealth.openSmartscape")}`}
          aria-label={`${connPillTitle} — ${t("connhealth.openSmartscape")}`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            openEntity(data.entity);
          }}
        >
          {connPillText}
        </button>
      )}

      {/* Pill del sub-mapa: misma estética que la de salud de conexiones, pero
          informativa (el enlace al mapa hijo va sobre el TEXTO del nodo). Gris
          si no hay acceso al documento o si el hijo no tiene nodos con fuente
          de estado — nunca verde falso. */}
      {isSubmap && (
        <span className={`sev-connpill sev-mappill ${submapPillCls}`} title={submapPillTitle}>
          {submapPillText}
        </span>
      )}

      <div className="sev-row">
        <span className="sev-icon">
          <AppIcon id={data.icon} size={ICON_PX[size] ?? 17} />
        </span>
        {/* Tooltip con el id de la entidad atada: distingue homónimos al pasar el mouse. */}
        <div className="sev-body" title={data.entity?.id}>
          {links.length === 1 ? (
            // UN link: como siempre — el texto es un enlace directo. stopPropagation
            // en mousedown/click para no seleccionar ni arrastrar el nodo.
            <a
              className="sev-name sev-name-link nodrag nopan"
              href={links[0].url}
              target="_blank"
              rel="noopener noreferrer"
              title={t("node.openUrl")}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {data.name}
            </a>
          ) : links.length >= 2 ? (
            // VARIOS links: el texto abre/cierra el popup con la lista de títulos.
            <button
              type="button"
              ref={linksBtnRef}
              className="sev-name sev-name-link sev-name-btn nodrag nopan"
              title={t("node.openLinks")}
              aria-expanded={linksOpen}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setLinksOpen((v) => !v);
              }}
            >
              {data.name}
            </button>
          ) : (
            <div className="sev-name">{data.name}</div>
          )}
          {(data.kind || data.retired || (isSubmap && data.mapError)) && (
            <div className="sev-kind">
              {data.kind}
              {/* Entidad dada de baja (atada pero ausente en su tabla): aviso. */}
              {data.retired && (
                <span className="sev-retired" title={t("related.retiredEntity")}>
                  {" "}
                  · {t("related.retired")}
                </span>
              )}
              {/* Sub-mapa ilegible (sin acceso o borrado): se dice, no se pinta verde. */}
              {isSubmap && data.mapError && (
                <span className="sev-retired" title={t("submap.noAccess")}>
                  {" "}
                  · {t("submap.noAccessShort")}
                </span>
              )}
            </div>
          )}
        </div>
        <span className="sev-badge" title={label} aria-label={label}>
          {symbol}
        </span>
        {/* Números compactos: máximo RC_MAX_NS a la vista y «+N» con el resto (la
            lista completa va en el tooltip). Antes un nodo con muchas causas
            mostraba «1·2·3·…·22» y tapaba el mapa. */}
        {/* Análisis de causa raíz: número rojo = aquí está la causa raíz N;
            «Efecto de N» (punteado) = sus problemas son consecuencia de la causa N.
            Clic → modal con la razón. nodrag/nopan + stopPropagation. */}
        {data.rcRoots && data.rcRoots.length > 0 && (
          <button
            type="button"
            className="sev-rc nodrag nopan"
            title={t("rca.nodeRootTip", { n: data.rcRoots.join(", ") })}
            aria-label={t("rca.nodeRootTip", { n: data.rcRoots.join(", ") })}
            onClick={(e) => {
              e.stopPropagation();
              pop.onRootCause(data.rcRoots![0], id);
            }}
          >
            {rcCompact(data.rcRoots).shown.join("·")}
            {rcCompact(data.rcRoots).rest > 0 && <span className="sev-rc-more">+{rcCompact(data.rcRoots).rest}</span>}
          </button>
        )}
        {data.rcResolved && data.rcResolved.length > 0 && !(data.rcRoots && data.rcRoots.length > 0) && (
          <button
            type="button"
            className="sev-rc sev-rc-ok nodrag nopan"
            title={t("rca.nodeResolvedTip", { n: data.rcResolved.join(", ") })}
            aria-label={t("rca.nodeResolvedTip", { n: data.rcResolved.join(", ") })}
            onClick={(e) => {
              e.stopPropagation();
              pop.onRootCause(data.rcResolved![0], id);
            }}
          >
            ✓{rcCompact(data.rcResolved).shown.join("·")}
            {rcCompact(data.rcResolved).rest > 0 && <span className="sev-rc-more">+{rcCompact(data.rcResolved).rest}</span>}
          </button>
        )}
        {data.rcEffects && data.rcEffects.length > 0 && (
          <button
            type="button"
            className="sev-rcfx nodrag nopan"
            title={t("rca.nodeEffectTip", { n: data.rcEffects.join(", ") })}
            aria-label={t("rca.nodeEffectTip", { n: data.rcEffects.join(", ") })}
            onClick={(e) => {
              e.stopPropagation();
              pop.onRootCause(data.rcEffects![0], id);
            }}
          >
            {t("rca.effectOf")}
            {rcCompact(data.rcEffects).shown.map((n) => (
              <span key={n} className="sev-rcfx-n">
                {n}
              </span>
            ))}
            {rcCompact(data.rcEffects).rest > 0 && (
              <span className="sev-rcfx-n sev-rc-more">+{rcCompact(data.rcEffects).rest}</span>
            )}
          </button>
        )}
        {/* Efecto ya resuelto: la relación se sigue viendo, atenuada y con ✓. Solo
            si el nodo no tiene efectos activos (esos mandan). */}
        {data.rcEffectsResolved && data.rcEffectsResolved.length > 0 && !(data.rcEffects && data.rcEffects.length > 0) && (
          <button
            type="button"
            className="sev-rcfx sev-rcfx-ok nodrag nopan"
            title={t("rca.nodeEffectResolvedTip", { n: data.rcEffectsResolved.join(", ") })}
            aria-label={t("rca.nodeEffectResolvedTip", { n: data.rcEffectsResolved.join(", ") })}
            onClick={(e) => {
              e.stopPropagation();
              pop.onRootCause(data.rcEffectsResolved![0], id);
            }}
          >
            ✓ {t("rca.effectOf")}
            {rcCompact(data.rcEffectsResolved).shown.map((n) => (
              <span key={n} className="sev-rcfx-n">
                {n}
              </span>
            ))}
            {rcCompact(data.rcEffectsResolved).rest > 0 && (
              <span className="sev-rcfx-n sev-rc-more">+{rcCompact(data.rcEffectsResolved).rest}</span>
            )}
          </button>
        )}
        {/* Botón "(i)": solo en advertencia/error. Abre la burbuja con el detalle
            legible de POR QUÉ está así (re-ejecuta el DQL del nodo). nodrag/nopan +
            stopPropagation para que el clic NO seleccione ni arrastre el nodo.
            En un nodo sub-mapa no aplica: su estado no sale de un DQL propio sino
            del % de salud del mapa hijo (que ya explica el pill). */}
        {(sev === "1" || sev === "2") && pop.explainEnabled && !isSubmap && (
          <button
            type="button"
            className="sev-why nodrag nopan"
            title={t("why.iconTitle")}
            aria-label={t("why.iconTitle")}
            onClick={(e) => {
              e.stopPropagation();
              pop.onExplainNode(id);
            }}
          >
            <span className="sev-why-q" aria-hidden="true">?</span>
          </button>
        )}
        {/* Ícono de nota: solo en edición y si hay nota. Al hacer clic despliega
            el texto (NodeToolbar en portal → no lo recorta el lienzo).
            nodrag/nopan + stopPropagation para no seleccionar/arrastrar. */}
        {showNote && (
          <button
            type="button"
            className={`sev-note nodrag nopan${noteOpen ? " sev-note-on" : ""}`}
            title={t("node.noteShow")}
            aria-label={t("node.noteShow")}
            aria-expanded={noteOpen}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setNoteOpen((v) => !v);
            }}
          >
            <DescriptionIcon size={13} />
          </button>
        )}
      </div>

      <NodeToolbar isVisible={showNote && noteOpen} position={Position.Bottom} align="center" offset={8}>
        <div className="mapa-note-pop nodrag nopan nowheel">{noteText}</div>
      </NodeToolbar>

      {/* Popup de links (2+): lista de títulos anclada al nodo (NodeToolbar va
          en portal → no lo recorta el lienzo). Clic en un título → abre la URL
          en pestaña nueva y el popup se cierra. */}
      <NodeToolbar isVisible={links.length >= 2 && linksOpen} position={Position.Bottom} align="center" offset={8}>
        <div className="mapa-links-pop nodrag nopan nowheel" ref={linksPopRef}>
          {links.map((l, i) => (
            <button
              key={i}
              type="button"
              className="mapa-links-item"
              title={l.url}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                openLink(l.url);
              }}
            >
              <span className="mapa-links-item-title">{l.title}</span>
              <ExternalLinkIcon size={13} />
            </button>
          ))}
        </div>
      </NodeToolbar>

      <Handle type="source" position={Position.Right} className="sev-handle" />
    </div>
  );
};
