import React, { useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex, Divider } from "@dynatrace/strato-components/layouts";
import { FormField, Label, TextInput, TextArea, Checkbox, NumberInputV2 } from "@dynatrace/strato-components/forms";
import { Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { Modal } from "@dynatrace/strato-components/overlays";
import { DQLEditor } from "@dynatrace/strato-components/editors";
import { useDql } from "@dynatrace-sdk/react-hooks";
import type { Node } from "@xyflow/react";
import { ChevronDownIcon, CheckmarkIcon, CopyIcon, ExternalLinkIcon, PlusIcon, XmarkIcon } from "@dynatrace/strato-icons";
import type { SeverityNodeData, NodeSize, NodeShape, NodeLink, StatusSource } from "./SeverityNode";
import { safeHref, DEFAULT_CONN_RED_AT, clampConnRedAt, nodeStatusSource, SUBMAP_ICON_ID } from "./SeverityNode";
import { MapPicker } from "./MapPicker";
import { ColorRules } from "./ColorRules";
import { DEFAULT_SUBMAP_RULES, sanitizeRules, submapMetricOf } from "./submapRules";
import type { ColorRule, SubmapMetric } from "./submapRules";
import { useMapLibraryContext } from "./mapLibraryContext";
import { IconPicker } from "./IconPicker";
import { recordsToSeverity, DEFAULT_NODE_DQL } from "./nodeStatus";
import { copyTextToClipboard } from "./clipboard";
import { EntityPicker } from "./EntityPicker";
import { openEntity } from "./entityModel";
import type { EntityRef } from "./entityModel";
import { useT } from "../i18n";

const SEV_VIEW: Record<string, { color: string }> = {
  "0": { color: "#0caf66" },
  "1": { color: "#dd8f00" },
  "2": { color: "#e0314a" },
  unknown: { color: "#8e9ab4" },
};

type Props = {
  node: Node<SeverityNodeData> | null;
  // El mapa abierto es un Mapa Padre: solo ahí se ofrece incrustar un Mapa de
  // Servicio como fuente del estado.
  isParentMap?: boolean;
  // Mapas ya incrustados en otros nodos del padre (para no repetirlos).
  usedMapIds?: string[];
  // Mapa de SOLO LECTURA: el editor abre para VER (el DQL, la URL, la nota),
  // con los campos deshabilitados y sin botón Guardar.
  readOnly?: boolean;
  onSave: (id: string, patch: Partial<SeverityNodeData>) => void;
  onClose: () => void;
};

// Se monta con key={selectedId} en el padre: el estado inicial sale del nodo
// al abrir y se conserva mientras se edita. (Eliminar/duplicar viven en el menú ⋮
// del popup del nodo, no aquí.)
// Filas del textarea de Notas según el texto: cada línea cuenta al menos 1 y las
// largas suman renglones (≈90 caracteres por renglón al ancho del modal).
const NOTE_ROWS_MIN = 3;
const NOTE_ROWS_MAX = 14;
const NOTE_COLS = 90;
const noteRows = (text: string): number => {
  const lines = text.split("\n").reduce((acc, l) => acc + Math.max(1, Math.ceil(l.length / NOTE_COLS)), 0);
  return Math.min(NOTE_ROWS_MAX, Math.max(NOTE_ROWS_MIN, lines));
};

export const NodeEditorModal = ({ node, isParentMap = false, usedMapIds, readOnly = false, onSave, onClose }: Props) => {
  const t = useT();
  // Mapa abierto: se excluye del selector de sub-mapa (auto-referencia).
  const { activeId } = useMapLibraryContext();

  const SIZE_OPTIONS: { value: NodeSize; label: string }[] = [
    { value: "sm", label: t("node.sizeSm") },
    { value: "md", label: t("node.sizeMd") },
    { value: "lg", label: t("node.sizeLg") },
  ];

  const SHAPE_OPTIONS: { value: NodeShape; label: string }[] = [
    { value: "rect",   label: t("node.shapeRect") },
    { value: "square", label: t("node.shapeSquare") },
  ];

  const SEV_LABELS: Record<string, string> = {
    "0": t("sev.ok"),
    "1": t("sev.warn"),
    "2": t("sev.err"),
    "unknown": t("sev.unknown"),
  };

  const [name, setName] = useState(node?.data.name ?? "");
  const [kind, setKind] = useState(node?.data.kind ?? "");
  const [note, setNote] = useState(node?.data.note ?? "");
  const [icon, setIcon] = useState(node?.data.icon ?? "shield");
  const [size, setSize] = useState<NodeSize>(node?.data.size ?? "md");
  const [shape, setShape] = useState<NodeShape>(node?.data.shape ?? "rect");
  const [dql, setDql] = useState(node?.data.dql ?? DEFAULT_NODE_DQL);
  // Atadura a entidad + motor de estado. El default se decide como en el render:
  // con entidad atada → Davis; sin ella → DQL clásico.
  const [entity, setEntity] = useState<EntityRef | undefined>(node?.data.entity);
  const [statusSource, setStatusSource] = useState<StatusSource>(() => {
    const src = node ? nodeStatusSource(node.data) : "dql";
    // Un Mapa de Servicio no admite nodos de mapa incrustado: si un documento
    // importado trae uno, el editor lo muestra como DQL en vez de ofrecer una
    // opción que ahí no existe.
    return src === "map" && !isParentMap ? "dql" : src;
  });
  // Mapa incrustado: el nodo representa un Mapa de Servicio del usuario.
  const [mapRef, setMapRef] = useState<{ id: string; name: string } | undefined>(node?.data.mapRef);
  const [mapMetric, setMapMetric] = useState<SubmapMetric>(submapMetricOf(node?.data.mapMetric));
  // Las reglas de un nodo que aún no es de mapa arrancan en los defaults; las de
  // uno que ya lo es se sanean por si el documento viene alterado.
  const [mapRules, setMapRules] = useState<ColorRule[]>(() =>
    node?.data.mapRules ? sanitizeRules(node.data.mapRules) : DEFAULT_SUBMAP_RULES,
  );
  // Salud de conexiones (pestaña propia): pill encima del nodo + umbral de rojo.
  // Solo tiene sentido con fuente "davis" (con DQL el checkbox va gris/inactivo).
  const [connHealth, setConnHealth] = useState(Boolean(node?.data.connHealth));
  const [connRedAt, setConnRedAt] = useState<number | null>(
    typeof node?.data.connHealthRedAt === "number" ? clampConnRedAt(node.data.connHealthRedAt) : DEFAULT_CONN_RED_AT,
  );

  // ── Links del nodo (pestaña "Links y Aspecto") ──────────────────────────────
  // Lista editable de {título, url}. La URL única LEGADA de nodos viejos entra
  // como primer link (título = la URL, editable); al guardar, `url` queda en
  // undefined y la lista pasa a ser la única fuente.
  const [links, setLinks] = useState<NodeLink[]>(() => {
    // Guard Array.isArray: `links` viene de un documento persistido (puede
    // llegar corrupto de un import) — nunca iterar sin validar.
    const maybe = node?.data.links;
    const raw = Array.isArray(maybe) ? maybe : [];
    const out: NodeLink[] = [];
    for (const l of raw) {
      if (!l || typeof l.url !== "string" || !l.url.trim()) continue;
      const title = typeof l.title === "string" && l.title.trim() ? l.title.trim() : l.url.trim();
      out.push({ title, url: l.url.trim() });
    }
    if (out.length === 0) {
      const legacy = (node?.data.url ?? "").trim();
      if (legacy) out.push({ title: legacy, url: legacy });
    }
    return out;
  });
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  // ¿La URL escrita no es válida? (para el aviso bajo el campo). Vacío = sin aviso.
  const linkUrlInvalid = linkUrl.trim().length > 0 && safeHref(linkUrl) === "";
  const canAddLink = !readOnly && linkUrl.trim().length > 0 && !linkUrlInvalid;
  const addLink = () => {
    if (!canAddLink) return;
    const u = linkUrl.trim();
    setLinks((ls) => [...ls, { title: linkTitle.trim() || u, url: u }]);
    setLinkTitle("");
    setLinkUrl("");
  };
  const removeLink = (idx: number) => setLinks((ls) => ls.filter((_, i) => i !== idx));
  // La leyenda del contrato de estado se colapsa (flechita) para no ocupar de más.
  const [helpOpen, setHelpOpen] = useState(false);

  // "Probar": corre el DQL escrito (solo lectura) y muestra el estado resultante.
  const [testQuery, setTestQuery] = useState("");
  const test = useDql(testQuery, { enabled: testQuery.trim().length > 0 });
  const testSev = test.data ? recordsToSeverity(test.data.records) : undefined;
  const testError = test.error as { message?: string } | undefined;

  // Botón de copiar DQL: ícono CopyIcon → CheckmarkIcon por ~1 s. Con respaldo
  // execCommand y sin rechazo mudo (la Clipboard API puede estar restringida en
  // el iframe de App Engine).
  const [copied, setCopied] = useState(false);
  const handleCopyDql = () => {
    void copyTextToClipboard(dql).then((ok) => {
      if (!ok) return; // sin permiso de portapapeles: no fingimos el checkmark
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    });
  };

  // Invalida el resultado de "Probar" al editar el DQL: si no, el punto verde
  // seguía mostrando el resultado del texto ANTERIOR y se guardaba confiado.
  const changeDql = (v: string) => {
    setDql(v);
    if (testQuery && v !== testQuery) setTestQuery("");
  };

  const save = () => {
    if (!node || readOnly) return;
    // Sin nombre visible el nodo queda "mudo" (y el enlace de la URL sin área
    // clicable): si lo dejaron vacío, conservamos el nombre anterior.
    const nm = name.trim() || node.data.name;
    // El motor de estado guardado es coherente con lo elegido: "davis" solo si
    // hay una entidad atada y "map" solo si hay un mapa hijo; si no, cae a "dql".
    const src: StatusSource =
      statusSource === "davis" && entity?.id
        ? "davis"
        : statusSource === "map" && mapRef?.id && isParentMap
          ? "map"
          : "dql";
    // El pill de salud de conexiones solo aplica con fuente davis: si el nodo
    // terminó en dql, se guarda apagado (coherente con el checkbox inactivo).
    const ch = src === "davis" ? connHealth : false;
    // Un nodo que pasa a ser sub-mapa y todavía trae el ícono por defecto adopta
    // el de mapa, para que se note de una qué representa (si el usuario ya eligió
    // otro ícono, se respeta).
    const ic = src === "map" && icon === "shield" ? SUBMAP_ICON_ID : icon;
    onSave(node.id, {
      name: nm, kind, note, icon: ic, size, shape, dql, entity, statusSource: src,
      mapRef: src === "map" ? mapRef : undefined,
      mapMetric: src === "map" ? mapMetric : undefined,
      mapRules: src === "map" ? mapRules : undefined,
      // La lista es la única fuente de links; la URL legada queda migrada
      // (undefined la borra del documento al persistir).
      links,
      url: undefined,
      connHealth: ch,
      connHealthRedAt: clampConnRedAt(connRedAt ?? DEFAULT_CONN_RED_AT),
    });
    onClose();
  };

  const footer = node ? (
    <Flex gap={8}>
      {readOnly ? (
        <Button variant="emphasized" onClick={onClose}>
          {t("common.close")}
        </Button>
      ) : (
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="emphasized" onClick={save}>
            {t("common.save")}
          </Button>
        </>
      )}
    </Flex>
  ) : undefined;

  return (
    <Modal title={t("node.editTitle")} show={node !== null} size="medium" onDismiss={onClose} footer={footer}>
      {/* Editor en pestañas para no crecer de más: "Contenido" (lo principal:
          nombre, subtítulo, URL, notas y DQL) y "Apariencia" (ícono, forma,
          tamaño). keepMounted en Contenido conserva el editor de DQL al cambiar
          de pestaña. */}
      <Tabs defaultIndex={0}>
        <Tab title={t("node.tabContent")} keepMounted>
          <Flex flexDirection="column" gap={16} className="mapa-node-tab">
            <FormField>
              <Label>{t("node.name")}</Label>
              <TextInput value={name} onChange={setName} placeholder={t("node.namePlaceholder")} disabled={readOnly} />
            </FormField>
            <FormField>
              <Label>{t("node.kind")}</Label>
              <TextInput value={kind} onChange={setKind} placeholder={t("node.kindPlaceholder")} disabled={readOnly} />
            </FormField>

            <Divider />

            {/* Fuente del estado (el corazón del nodo, por eso va antes que las
                notas): segmented como Forma/Tamaño — mismo lenguaje visual en
                todo el modal, sin radios. */}
            <FormField>
              <Label>{t("node.statusSource")}</Label>
              <div className="size-seg">
                {([
                  { value: "davis" as StatusSource, label: t("node.statusSourceDavis") },
                  ...(isParentMap ? [{ value: "map" as StatusSource, label: t("node.statusSourceMap") }] : []),
                  { value: "dql" as StatusSource, label: t("node.statusSourceDql") },
                ]).map((o) => (
                  <button
                    type="button"
                    key={o.value}
                    className={`size-opt${o.value === statusSource ? " size-opt-on" : ""}`}
                    onClick={() => setStatusSource(o.value)}
                    disabled={readOnly}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </FormField>

            {/* Mapa incrustado: el nodo toma la salud de un Mapa de Servicio.
                El mapa abierto y los Mapas Padre se excluyen de la lista. */}
            {statusSource === "map" && isParentMap && (
              <>
                <FormField>
                  <Label>{t("submap.picker")}</Label>
                  {readOnly ? (
                    <div className="mapa-field-hint">{mapRef?.name || mapRef?.id || t("submap.none")}</div>
                  ) : (
                    <MapPicker value={mapRef} excludeId={activeId} usedIds={usedMapIds} onChange={setMapRef} />
                  )}
                  <div className="mapa-field-hint">{t("submap.hint")}</div>
                </FormField>

                {/* Reglas de color: qué color toma el nodo según la métrica del
                    mapa incrustado (estilo umbrales de los tableros). */}
                <FormField>
                  <Label>{t("rules.section")}</Label>
                  <ColorRules
                    metric={mapMetric}
                    rules={mapRules}
                    readOnly={readOnly}
                    onMetricChange={setMapMetric}
                    onRulesChange={setMapRules}
                  />
                </FormField>
              </>
            )}

            {/* Entidad Smartscape: selector + entidad atada como chip con su
                botón "Abrir en Dynatrace" (botón de verdad, no link), y la
                salud de conexiones aquí mismo — es un ajuste del binding, no
                una pestaña aparte. */}
            {statusSource === "davis" && (
              <>
                <FormField>
                  <Label>{t("node.entity")}</Label>
                  {!readOnly && <EntityPicker value={entity} onChange={setEntity} />}
                  {entity?.id ? (
                    <div className="mapa-entchip-row">
                      <span className="mapa-entchip" title={entity.id}>
                        {entity.name || entity.id}
                        {entity.name && <span className="mapa-entchip-id">{entity.id}</span>}
                      </span>
                      <button type="button" className="mapa-linebtn" onClick={() => openEntity(entity)}>
                        <ExternalLinkIcon size={14} />
                        {t("node.openInDynatrace")}
                      </button>
                    </div>
                  ) : (
                    readOnly && <div className="mapa-field-hint">{t("entity.noneBound")}</div>
                  )}
                </FormField>

                <FormField>
                  <Checkbox value={connHealth} onChange={setConnHealth} disabled={readOnly}>
                    {t("connhealth.enable")}
                  </Checkbox>
                  <div className="mapa-field-hint">{t("connhealth.enableHint")}</div>
                </FormField>
                {connHealth && (
                  <FormField>
                    <Label>{t("connhealth.threshold")}</Label>
                    <NumberInputV2
                      value={connRedAt}
                      onChange={setConnRedAt}
                      min={0}
                      max={100}
                      disabled={readOnly}
                    />
                    <div className="mapa-field-hint">{t("connhealth.thresholdHint")}</div>
                  </FormField>
                )}
              </>
            )}

            {/* DQL avanzado: el editor clásico, solo cuando esa es la fuente. */}
            {statusSource === "dql" && (
            <>
            {/* Ítem 8 — Botón copiar DQL + label de sección en la misma fila */}
            <FormField>
              <Flex justifyContent="space-between" alignItems="center">
                <Label>{t("node.dqlStatus")}</Label>
                <button
                  type="button"
                  className="mapa-iconbtn mapa-iconbtn-sm"
                  title={copied ? t("node.copied") : t("node.copyDql")}
                  aria-label={copied ? t("node.copied") : t("node.copyDql")}
                  onClick={handleCopyDql}
                >
                  {copied ? <CheckmarkIcon size={14} /> : <CopyIcon size={14} />}
                </button>
              </Flex>
              <DQLEditor value={dql} onChange={changeDql} placeholder={t("node.dqlPlaceholder")} readOnly={readOnly} />

              {/* Ítem 7 — Resultado del test JUNTO al botón "Probar" (misma fila, sin spacer a la derecha) */}
              <Flex gap={8} alignItems="center">
                <Button variant="emphasized" onClick={() => setTestQuery(dql)} disabled={dql.trim().length === 0}>
                  {t("node.test")}
                </Button>
                {testQuery.trim() !== "" && (
                  <span className="gmatch">
                    {test.isLoading ? (
                      <span className="gmatch-muted">{t("node.testing")}</span>
                    ) : testError ? (
                      <span className="gmatch-muted">{t("node.testError", { msg: testError.message ?? t("node.testInvalid") })}</span>
                    ) : testSev !== undefined ? (
                      <>
                        <span className="gmatch-dot" style={{ background: SEV_VIEW[String(testSev)].color }} />
                        {SEV_LABELS[String(testSev)] ?? SEV_LABELS["unknown"]}
                      </>
                    ) : null}
                  </span>
                )}
              </Flex>
            </FormField>

            {/* Explicación del contrato de estado: colapsable con una flechita
                para no ocupar espacio de más al fondo de la pestaña. */}
            <div className="mapa-dqlhelp">
              <button
                type="button"
                className="mapa-dqlhelp-toggle"
                onClick={() => setHelpOpen((v) => !v)}
                aria-expanded={helpOpen}
              >
                <span className={`mapa-dqlhelp-chev${helpOpen ? " mapa-dqlhelp-chev-open" : ""}`}>
                  <ChevronDownIcon size={14} />
                </span>
                <span className="mapa-dqlhelp-title">{t("node.dqlHelpTitle")}</span>
              </button>
              {helpOpen && (
                <div className="mapa-dqlhelp-body">
                  <div>
                    {t("node.dqlHelpDesc")} <strong>{t("node.dqlHelpStatus")}</strong> {t("node.dqlHelpNumeric")}
                  </div>
                  <ul className="mapa-dqlhelp-list">
                    <li>
                      <span className="mapa-dqlhelp-dot" style={{ background: SEV_VIEW["0"].color }} />
                      <strong>0</strong> {t("node.dqlHelpOk")}
                    </li>
                    <li>
                      <span className="mapa-dqlhelp-dot" style={{ background: SEV_VIEW["1"].color }} />
                      <strong>1</strong> {t("node.dqlHelpWarn")}
                    </li>
                    <li>
                      <span className="mapa-dqlhelp-dot" style={{ background: SEV_VIEW["2"].color }} />
                      <strong>2 {t("node.dqlOrGreater")}</strong> {t("node.dqlHelpErr")}
                    </li>
                  </ul>
                  <div>
                    {t("node.dqlHelpGray")} <strong>{t("node.dqlHelpStatus")}</strong> {t("node.dqlHelpGray2")}
                  </div>
                </div>
              )}
            </div>
            </>
            )}

            <Divider />

            {/* Notas: contenido secundario → al final. El alto se calcula por el
                texto (mín. 3 filas, máx. 14, contando líneas y renglones envueltos)
                para que una nota larga se vea completa sin arrastrar; el agarre
                sigue permitiendo agrandarlo a mano (.mapa-notes en map.css). */}
            <div className="mapa-notes">
            <FormField>
              <Label>{t("node.note")}</Label>
              <TextArea
                value={note}
                onChange={setNote}
                placeholder={t("node.notePlaceholder")}
                rows={noteRows(note)}
                width="full"
                resize="vertical"
                disabled={readOnly}
              />
            </FormField>
            </div>
          </Flex>
        </Tab>

        <Tab title={t("node.tabAppearance")}>
          <Flex flexDirection="column" gap={16} className="mapa-node-tab">
            {/* ── Links del nodo ─────────────────────────────────────────────
                Título + Link con botón "+" a la derecha para añadir; debajo, la
                lista de links añadidos con una ✕ para quitar cada uno. Con 1
                link el texto del nodo lo abre directo; con 2+ sale el popup. */}
            <FormField>
              <Label>{t("links.section")}</Label>
              {!readOnly && (
                <>
                  {/* Título (angosto) + Link (ancho) en la MISMA línea, con el
                      botón de añadir a la derecha. */}
                  <Flex gap={8} alignItems="center">
                    <Flex flexDirection="column" style={{ flex: "0 0 34%" }}>
                      <TextInput
                        value={linkTitle}
                        onChange={setLinkTitle}
                        placeholder={t("links.titlePlaceholder")}
                      />
                    </Flex>
                    <Flex flexGrow={1} flexDirection="column">
                      <TextInput
                        value={linkUrl}
                        onChange={setLinkUrl}
                        placeholder={t("links.urlPlaceholder")}
                      />
                    </Flex>
                    <Button variant="emphasized" onClick={addLink} disabled={!canAddLink} aria-label={t("links.add")}>
                      <Button.Prefix>
                        <PlusIcon />
                      </Button.Prefix>
                    </Button>
                  </Flex>
                  {linkUrlInvalid && <div className="mapa-field-hint">{t("node.urlInvalidHint")}</div>}
                </>
              )}
              {links.length === 0 ? (
                <div className="mapa-field-hint">{t("links.empty")}</div>
              ) : (
                <div className="mapa-linklist">
                  {links.map((l, i) => (
                    <div className="mapa-linkrow" key={`${l.url}-${i}`}>
                      <span className="mapa-linkrow-title" title={l.title}>{l.title}</span>
                      <span className="mapa-linkrow-url" title={l.url}>{l.url}</span>
                      {!readOnly && (
                        <button
                          type="button"
                          className="mapa-iconbtn mapa-iconbtn-sm"
                          title={t("links.remove")}
                          aria-label={t("links.remove")}
                          onClick={() => removeLink(i)}
                        >
                          <XmarkIcon size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </FormField>

            <div className="mapa-links-sep" />

            {/* Apariencia en filas etiqueta-izq / control-der (mismo patrón de
                Ajustes): borde derecho alineado, la mitad de altura que los
                tres bloques apilados de antes. */}
            <div className="mapa-set-rows mapa-set-rows-roomy">
              <div className="mapa-set-row">
                <span className="mapa-set-rowlabel">{t("node.icon")}</span>
                <IconPicker value={icon} onChange={setIcon} chevron={<ChevronDownIcon size={13} />} disabled={readOnly} />
              </div>
              <div className="mapa-set-row">
                <span className="mapa-set-rowlabel">{t("node.shape")}</span>
                <div className="size-seg">
                  {SHAPE_OPTIONS.map((o) => (
                    <button
                      type="button"
                      key={o.value}
                      className={`size-opt${o.value === shape ? " size-opt-on" : ""}`}
                      onClick={() => setShape(o.value)}
                      disabled={readOnly}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mapa-set-row">
                <span className="mapa-set-rowlabel">{t("node.size")}</span>
                <div className="size-seg">
                  {SIZE_OPTIONS.map((o) => (
                    <button
                      type="button"
                      key={o.value}
                      className={`size-opt${o.value === size ? " size-opt-on" : ""}`}
                      onClick={() => setSize(o.value)}
                      disabled={readOnly}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Flex>
        </Tab>
      </Tabs>
    </Modal>
  );
};
