import React, { useLayoutEffect, useMemo, useRef } from "react";
import { NodeToolbar, Position, useInternalNode, useViewport, useStore } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { Markdown } from "@dynatrace/strato-components/content";
import { Menu } from "@dynatrace/strato-components/navigation";
import {
  Heading1Icon,
  FormatBoldIcon,
  FormatItalicIcon,
  StrikethroughSIcon,
  FormatQuoteIcon,
  CodeIcon,
  CodeblockIcon,
  ListIcon,
  FormatListNumberedIcon,
  LinkIcon,
  TableIcon,
  EditIcon,
  CheckmarkIcon,
  DuplicateIcon,
  DotMenuIcon,
} from "@dynatrace/strato-icons";
import type { SvgIconProps } from "@dynatrace/strato-icons";
import { TrashIcon } from "./TrashIcon";
import { useT } from "../i18n";
import { useLabelUi } from "./labelUi";
import { applyMd } from "./mdEdit";
import type { MdOp } from "./mdEdit";

// Nodo-título: ahora es un bloque de MARKDOWN. En reposo se renderiza con el
// componente Markdown de Strato; al editar muestra un textarea con la fuente
// markdown y una toolbar flotante de formato. El color del texto lo da el tema
// (Strato), no es configurable.
export type LabelNodeData = {
  // Fuente markdown del título.
  text: string;
  // Escala del bloque renderizado (1 = normal). Botones A− / A+ de la toolbar en
  // reposo: agranda TODO el bloque (títulos, párrafos, listas) sin tocar el
  // markdown — un `# Título` al 200 % hace de "H0". Ausente = 1.
  scale?: number;
};

// Rango y paso de la escala (50 % … 300 %, de a 25 %).
const LABEL_SCALE_MIN = 0.5;
const LABEL_SCALE_MAX = 3;
const LABEL_SCALE_STEP = 0.25;
// Zoom base del markdown renderizado: DEBE coincidir con `.mapa-md { zoom }` en map.css.
const MD_BASE_ZOOM = 1.15;
const clampScale = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(LABEL_SCALE_MAX, Math.max(LABEL_SCALE_MIN, v)) : 1;
const stepScale = (s: number, dir: 1 | -1): number =>
  clampScale(Math.round((s + dir * LABEL_SCALE_STEP) * 100) / 100);

export type LabelNodeType = Node<LabelNodeData, "label">;

type MdButton = {
  key: string;
  Icon: React.ComponentType<SvgIconProps>;
  op: MdOp;
  // Inserta un separador visual antes de este botón (agrupación).
  group?: boolean;
};

// Orden/íconos como en Notebooks. Sin inserción de imagen (ya existe aparte).
const MD_BUTTONS: MdButton[] = [
  { key: "h1", Icon: Heading1Icon, op: { kind: "prefix", prefix: "# " } },
  { key: "bold", Icon: FormatBoldIcon, op: { kind: "wrap", before: "**", after: "**" }, group: true },
  { key: "italic", Icon: FormatItalicIcon, op: { kind: "wrap", before: "*", after: "*" } },
  { key: "strike", Icon: StrikethroughSIcon, op: { kind: "wrap", before: "~~", after: "~~" } },
  { key: "quote", Icon: FormatQuoteIcon, op: { kind: "prefix", prefix: "> " }, group: true },
  { key: "code", Icon: CodeIcon, op: { kind: "wrap", before: "`", after: "`" } },
  { key: "codeblock", Icon: CodeblockIcon, op: { kind: "block", text: "```\n\n```", cursor: 4 } },
  { key: "bulleted", Icon: ListIcon, op: { kind: "prefix", prefix: "- " }, group: true },
  { key: "numbered", Icon: FormatListNumberedIcon, op: { kind: "prefix", prefix: "1. " } },
  { key: "link", Icon: LinkIcon, op: { kind: "link" }, group: true },
  { key: "table", Icon: TableIcon, op: { kind: "block", text: "|  | Header2 |\n| --- | --- |\n| content2 | content2 |" } },
];

export const LabelNode = ({ id, data, selected }: NodeProps<LabelNodeType>) => {
  const t = useT();
  const scale = clampScale(data.scale);
  const pct = Math.round(scale * 100);
  const ui = useLabelUi();
  const editing = ui.editingId === id;
  // ¿Hay más de un nodo seleccionado? (al disponerse a mover varios). En ese caso
  // NO mostramos el popup de Editar: solo cuando hay UNO seleccionado.
  const multiSelected = useStore((s) => {
    let count = 0;
    s.nodeLookup.forEach((n) => {
      if (n.selected) count++;
    });
    return count > 1;
  });
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  // Selección pendiente a restaurar tras una inserción de la toolbar (el value
  // cambió por props, así que reponemos el caret en el layout effect).
  const pendingSel = useRef<[number, number] | null>(null);

  const text = data.text ?? "";

  // Auto-tamaño del editor: ancho = línea más larga, alto = nº de líneas. La fuente
  // del textarea es MONOESPACIADA, así que `cols`/`rows` calzan exacto con el texto.
  // Antes el textarea tenía ancho FIJO (320px) y recortaba títulos largos; ahora
  // crece con el contenido y se rompe SOLO donde el usuario mete un salto de línea
  // (`wrap="off"` evita el reajuste suave que "cortaba" líneas). El alto mínimo es 1
  // fila. Cap de 120 columnas para que un pegado enorme no estire el nodo sin fin.
  const srcLines = text.split("\n");
  const longestLine = srcLines.reduce((m, l) => Math.max(m, l.length), 0);
  const placeholderLen = t("label.placeholder").length;
  const editorCols = Math.min(120, Math.max(18, (text.length ? longestLine : placeholderLen) + 1));
  const editorRows = Math.max(1, srcLines.length);

  // Al entrar en edición: enfoca el textarea y deja el caret al final.
  useLayoutEffect(() => {
    if (editing && taRef.current) {
      const el = taRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  // Tras una inserción de la toolbar, repone la selección calculada.
  useLayoutEffect(() => {
    if (editing && pendingSel.current && taRef.current) {
      const [s, e] = pendingSel.current;
      pendingSel.current = null;
      taRef.current.focus();
      taRef.current.setSelectionRange(s, e);
    }
  }, [text, editing]);

  const runOp = (op: MdOp) => {
    const el = taRef.current;
    if (!el) return;
    const r = applyMd(op, el.value, el.selectionStart, el.selectionEnd);
    pendingSel.current = [r.selStart, r.selEnd];
    ui.onChange(id, r.value);
  };

  // Colocación de la toolbar para que NO se recorte contra el borde del lienzo
  // (que tiene overflow:hidden): si el título está muy arriba la mostramos ABAJO,
  // y si está pegado a un costado alineamos al inicio/fin en vez de centrada.
  const vp = useViewport();
  const internal = useInternalNode(id);
  const paneW = useStore((s) => s.width);
  const placement = useMemo<{ position: Position; align: "start" | "center" | "end" }>(() => {
    const pos = internal?.internals.positionAbsolute;
    if (!pos) return { position: Position.Top, align: "center" };
    const w = internal?.measured?.width ?? 0;
    const screenTop = pos.y * vp.zoom + vp.y;
    const centerX = (pos.x + w / 2) * vp.zoom + vp.x;
    const half = editing ? 250 : 90; // semiancho aproximado de cada toolbar
    const position = screenTop < 64 ? Position.Bottom : Position.Top;
    let align: "start" | "center" | "end" = "center";
    if (centerX - half < 8) align = "start";
    else if (centerX + half > paneW - 8) align = "end";
    return { position, align };
  }, [internal, vp.x, vp.y, vp.zoom, paneW, editing]);

  return (
    <>
      {/* Toolbar en reposo (al seleccionar): Editar + menú ⋮. Oculta en solo lectura. */}
      <NodeToolbar isVisible={selected && !multiSelected && !editing && !ui.readOnly} position={placement.position} align={placement.align} offset={8}>
        <div className="mapa-label-toolbar nodrag nopan">
          <button type="button" className="mapa-label-editbtn" onClick={() => ui.onStartEdit(id)}>
            <EditIcon size={14} />
            <span>{t("label.edit")}</span>
          </button>
          <span className="mapa-label-tb-sep" />
          {/* Tamaño del bloque: va en la toolbar en REPOSO (no en la de edición)
              porque aquí se ve el markdown renderizado y el cambio se aprecia al tiro. */}
          <button
            type="button"
            className="mapa-label-tb-btn mapa-label-scalebtn"
            aria-label={t("label.scaleDown", { pct: String(pct) })}
            title={t("label.scaleDown", { pct: String(pct) })}
            disabled={scale <= LABEL_SCALE_MIN}
            onClick={() => ui.onScale(id, stepScale(scale, -1))}
          >
            A−
          </button>
          <button
            type="button"
            className="mapa-label-tb-btn mapa-label-scalebtn"
            aria-label={t("label.scaleUp", { pct: String(pct) })}
            title={t("label.scaleUp", { pct: String(pct) })}
            disabled={scale >= LABEL_SCALE_MAX}
            onClick={() => ui.onScale(id, stepScale(scale, 1))}
          >
            A+
          </button>
          <span className="mapa-label-tb-sep" />
          <Menu>
            <Menu.Trigger>
              <button type="button" className="mapa-label-tb-btn" aria-label={t("label.more")} title={t("label.more")}>
                <DotMenuIcon size={16} />
              </button>
            </Menu.Trigger>
            <Menu.Content>
              <Menu.Item onSelect={() => ui.onDuplicate(id)}>
                <Menu.Prefix>
                  <DuplicateIcon />
                </Menu.Prefix>
                {t("label.duplicate")}
              </Menu.Item>
              <Menu.Item onSelect={() => ui.onRequestDelete(id)}>
                <Menu.Prefix>
                  <TrashIcon label={t("label.deleteTitle")} />
                </Menu.Prefix>
                {t("label.deleteTitle")}
              </Menu.Item>
            </Menu.Content>
          </Menu>
        </div>
      </NodeToolbar>

      {/* Toolbar de edición: formato + Listo. */}
      <NodeToolbar isVisible={editing} position={placement.position} align={placement.align} offset={8}>
        <div className="mapa-label-toolbar nodrag nopan">
          {MD_BUTTONS.map((b) => (
            <React.Fragment key={b.key}>
              {b.group && <span className="mapa-label-tb-sep" />}
              <button
                type="button"
                className="mapa-label-tb-btn"
                aria-label={t(`label.md.${b.key}`)}
                title={t(`label.md.${b.key}`)}
                // No robar el foco al textarea (preserva la selección al insertar).
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runOp(b.op)}
              >
                <b.Icon size={16} />
              </button>
            </React.Fragment>
          ))}
          <span className="mapa-label-tb-sep" />
          <button type="button" className="mapa-label-donebtn" onClick={() => ui.onDone()}>
            <CheckmarkIcon size={14} />
            <span>{t("label.done")}</span>
          </button>
        </div>
      </NodeToolbar>

      {/* Cuerpo: editor (textarea con la fuente markdown) o markdown renderizado. */}
      <div className={`mapa-label${selected ? " sev-selected" : ""}${editing ? " mapa-label-editing" : ""}`}>
        {editing ? (
          <textarea
            ref={taRef}
            className="mapa-label-textarea nodrag nopan nowheel"
            value={text}
            placeholder={t("label.placeholder")}
            spellCheck={false}
            wrap="off"
            cols={editorCols}
            rows={editorRows}
            onChange={(e) => ui.onChange(id, e.target.value)}
            // Evita que las teclas (flechas, etc.) lleguen al lienzo de ReactFlow.
            onKeyDown={(e) => e.stopPropagation()}
            // Sin estos, arrastrar dentro del editor mueve el mapa y el doble-clic
            // (seleccionar palabra) hace zoom del lienzo.
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          />
        ) : text.trim() ? (
          <div className="mapa-md" style={scale !== 1 ? { zoom: MD_BASE_ZOOM * scale } : undefined}>
            <Markdown>{text}</Markdown>
          </div>
        ) : (
          <span className="mapa-label-empty">{t("label.placeholder")}</span>
        )}
      </div>
    </>
  );
};
