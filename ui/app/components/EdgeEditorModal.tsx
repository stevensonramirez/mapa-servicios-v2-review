import React, { useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Checkbox, FormField, Label, Switch, TextInput } from "@dynatrace/strato-components/forms";
import { Paragraph } from "@dynatrace/strato-components/typography";
import { Modal } from "@dynatrace/strato-components/overlays";
import { DQLEditor } from "@dynatrace/strato-components/editors";
import { useDql } from "@dynatrace-sdk/react-hooks";
import type { Edge } from "@xyflow/react";
import { CheckmarkIcon, CopyIcon, RepeatIcon } from "@dynatrace/strato-icons";
import { TrashIcon } from "./TrashIcon";
import { recordsToSeverity, recordsToValue, formatValue, DEFAULT_NODE_DQL, DEFAULT_VALUE_DQL } from "./nodeStatus";
import { copyTextToClipboard } from "./clipboard";
import { useT } from "../i18n";

const SEV_VIEW: Record<string, { color: string }> = {
  "0": { color: "#0caf66" },
  "1": { color: "#dd8f00" },
  "2": { color: "#e0314a" },
  unknown: { color: "#8e9ab4" },
};

// Datos persistidos de una raya. `value*`: chip con un VALOR calculado por un
// segundo DQL (independiente del estado): apagado por defecto.
export type EdgeData = {
  dql?: string;
  inheritStatus?: boolean;
  valueEnabled?: boolean;
  valueDql?: string;
  valueLabel?: string;
  // ¿El nombre se pinta DENTRO del chip? Por defecto no (solo en el tooltip), para
  // que el chip ocupe lo mínimo; se habilita explícitamente con el toggle.
  valueShowLabel?: boolean;
  valueUnit?: string;
};
const VALUE_LABEL_MAX = 24;
const VALUE_UNIT_MAX = 8;

type Props = {
  edge: Edge | null;
  // ¿Se puede invertir? false si ya existe una raya en el sentido contrario.
  canFlip: boolean;
  // Mapa de SOLO LECTURA: el editor abre para VER el DQL, sin mutaciones
  // (sin Guardar/Eliminar/Invertir; campos deshabilitados).
  readOnly?: boolean;
  onSave: (id: string, patch: EdgeData) => void;
  onFlip: (id: string) => void;
  onRequestDelete: (id: string) => void;
  onClose: () => void;
};

// Editor de una CONEXIÓN (raya). La raya tiene su PROPIO estado por DQL,
// independiente de los nodos que une. Se monta con key={selectedEdgeId} en el
// padre: el DQL inicial sale de la raya al abrir y se conserva mientras se edita.
export const EdgeEditorModal = ({ edge, canFlip, readOnly = false, onSave, onFlip, onRequestDelete, onClose }: Props) => {
  const t = useT();
  const SEV_LABELS: Record<string, string> = {
    "0": t("sev.ok"),
    "1": t("sev.warn"),
    "2": t("sev.err"),
    unknown: t("sev.unknown"),
  };

  const initialDql = (edge?.data as EdgeData | undefined)?.dql ?? DEFAULT_NODE_DQL;
  const [dql, setDql] = useState(initialDql);

  // ¿La raya HEREDA el estado de su nodo de origen? Por DEFAULT sí (chulo activado).
  // Si se desactiva, se usa el DQL propio de la raya (aparece el editor + Probar).
  const initialInherit = (edge?.data as EdgeData | undefined)?.inheritStatus ?? true;
  const [inherit, setInherit] = useState(initialInherit);

  // Chip de VALOR: segundo DQL cuyo resultado (un número) se pinta en la mitad de
  // la raya. Apagado por defecto; al activarlo se despliega su bloque.
  const ed = edge?.data as EdgeData | undefined;
  const [valueOn, setValueOn] = useState(ed?.valueEnabled === true);
  // Semilla: igual que al apagar "Heredar", el bloque abre con un DQL VÁLIDO
  // (problemas activos) y una etiqueta, para que Probar funcione de una.
  const [valueDql, setValueDql] = useState(ed?.valueDql?.trim() ? ed.valueDql : DEFAULT_VALUE_DQL);
  const [valueLabel, setValueLabel] = useState(ed?.valueLabel ?? (ed?.valueDql?.trim() ? "" : t("edge.valueDefaultLabel")));
  const [valueUnit, setValueUnit] = useState(ed?.valueUnit ?? "");
  const [valueShowLabel, setValueShowLabel] = useState(ed?.valueShowLabel === true);
  const [valueTestQuery, setValueTestQuery] = useState("");
  const valueTest = useDql(valueTestQuery, { enabled: valueTestQuery.trim().length > 0 });
  const valueTestResult = valueTest.data ? recordsToValue(valueTest.data.records) : undefined;
  const valueTestError = valueTest.error as { message?: string } | undefined;
  const changeValueDql = (v: string) => {
    setValueDql(v);
    if (valueTestQuery && v !== valueTestQuery) setValueTestQuery("");
  };

  // "Probar": corre el DQL escrito (solo lectura) y muestra el estado resultante.
  const [testQuery, setTestQuery] = useState("");
  const test = useDql(testQuery, { enabled: testQuery.trim().length > 0 });
  const testSev = test.data ? recordsToSeverity(test.data.records) : undefined;
  const testError = test.error as { message?: string } | undefined;

  // Botón de copiar DQL: ícono CopyIcon → CheckmarkIcon por ~1 s. Con respaldo
  // execCommand y sin rechazo mudo (la Clipboard API puede estar restringida).
  const [copied, setCopied] = useState(false);
  const handleCopyDql = () => {
    void copyTextToClipboard(dql).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    });
  };

  // Invalida el resultado de "Probar" al editar el DQL (evita confiar en el
  // resultado del texto anterior).
  const changeDql = (v: string) => {
    setDql(v);
    if (testQuery && v !== testQuery) setTestQuery("");
  };

  const save = () => {
    if (!edge || readOnly) return;
    onSave(edge.id, {
      dql,
      inheritStatus: inherit,
      valueEnabled: valueOn,
      valueDql: valueDql.trim(),
      valueLabel: valueLabel.trim().slice(0, VALUE_LABEL_MAX),
      valueUnit: valueUnit.trim().slice(0, VALUE_UNIT_MAX),
      valueShowLabel,
    });
    onClose();
  };

  const footer = edge ? (
    <Flex gap={8}>
      {readOnly ? (
        <Button variant="emphasized" onClick={onClose}>
          {t("common.close")}
        </Button>
      ) : (
        <>
          <Button onClick={() => onRequestDelete(edge.id)} aria-label={t("edge.deleteLabel")}>
            <TrashIcon label={t("edge.deleteLabel")} />
          </Button>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="emphasized" onClick={save}>
            {t("common.save")}
          </Button>
        </>
      )}
    </Flex>
  ) : undefined;

  return (
    <Modal title={t("edge.editTitle")} show={edge !== null} size="medium" onDismiss={onClose} footer={footer}>
      <Flex flexDirection="column" gap={16}>
        {/* Invertir el sentido (ida ↔ regreso): intercambia origen y destino.
            Se deshabilita si ya existe una raya en el sentido contrario (duplicado)
            o si el mapa es de solo lectura. */}
        {!readOnly && (
          <Flex flexDirection="column" gap={4} alignItems="flex-start">
            <Button
              onClick={() => edge && onFlip(edge.id)}
              disabled={!canFlip}
              aria-label={t("edge.flip")}
              title={canFlip ? t("edge.flipHint") : t("edge.flipBlocked")}
            >
              <Button.Prefix>
                <RepeatIcon />
              </Button.Prefix>
              {t("edge.flip")}
            </Button>
            <span className="gmatch-muted">{canFlip ? t("edge.flipHint") : t("edge.flipBlocked")}</span>
          </Flex>
        )}

        {/* Heredar el estado del NODO DE ORIGEN (chulo activado por default): la raya
            toma el color del nodo de donde sale, sin DQL propio. Al desactivarlo
            aparece el editor de DQL (con su leyenda y el botón Probar). */}
        <Flex flexDirection="column" gap={4} alignItems="flex-start">
          <Checkbox value={inherit} onChange={(checked) => setInherit(checked === true)} disabled={readOnly}>
            {t("edge.inherit")}
          </Checkbox>
          <span className="gmatch-muted">{t("edge.inheritHint")}</span>
        </Flex>

        {!inherit && (
          <>
        <Paragraph>{t("edge.intro")}</Paragraph>

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

        {/* Mismo contrato de estado que los nodos (reusa las claves node.dqlHelp*). */}
        <div className="mapa-dqlhelp">
          <div className="mapa-dqlhelp-title">{t("node.dqlHelpTitle")}</div>
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
          </>
        )}

        {/* ── VALOR calculado por DQL (chip en la mitad de la raya) ── */}
        <div className="mapa-edge-section">
          <Flex flexDirection="column" gap={4} alignItems="flex-start">
            <Checkbox
              value={valueOn}
              onChange={(checked) => {
                const on = checked === true;
                setValueOn(on);
                if (on && valueDql.trim() === "") setValueDql(DEFAULT_VALUE_DQL);
              }}
              disabled={readOnly}
            >
              {t("edge.valueEnable")}
            </Checkbox>
            <span className="gmatch-muted">{t("edge.valueHint")}</span>
          </Flex>
          {/* Despliegue animado: el envoltorio existe siempre (0fr → 1fr al activar). */}
          <div className={`mapa-reveal${valueOn ? " mapa-reveal-open" : ""}`} aria-hidden={!valueOn}>
            <div>
              {valueOn && (
                <Flex flexDirection="column" gap={12} className="mapa-reveal-inner">
                  <FormField>
                    <Label>{t("edge.valueDql")}</Label>
                    <DQLEditor
                      value={valueDql}
                      onChange={changeValueDql}
                      placeholder={t("edge.valuePlaceholder")}
                      readOnly={readOnly}
                    />
                    <span className="mapa-fieldhint">{t("edge.valueContract")}</span>
                    <Flex gap={8} alignItems="center">
                      <Button
                        variant="emphasized"
                        onClick={() => setValueTestQuery(valueDql)}
                        disabled={valueDql.trim().length === 0}
                      >
                        {t("node.test")}
                      </Button>
                      {valueTestQuery.trim() !== "" && (
                        <span className="gmatch">
                          {valueTest.isLoading ? (
                            <span className="gmatch-muted">{t("node.testing")}</span>
                          ) : valueTestError ? (
                            <span className="gmatch-muted">
                              {t("node.testError", { msg: valueTestError.message ?? t("node.testInvalid") })}
                            </span>
                          ) : valueTestResult === null ? (
                            <span className="gmatch-muted">{t("edge.valueInvalid")}</span>
                          ) : valueTestResult !== undefined ? (
                            <span className="mapa-edge-chip mapa-edge-chip-static">
                              {valueShowLabel && valueLabel.trim() && (
                                <span className="mapa-edge-chip-label">{valueLabel.trim()}</span>
                              )}
                              <span className="mapa-edge-chip-value">{formatValue(valueTestResult)}</span>
                              {valueUnit.trim() && <span className="mapa-edge-chip-unit">{valueUnit.trim()}</span>}
                            </span>
                          ) : null}
                        </span>
                      )}
                    </Flex>
                  </FormField>
                  <Flex gap={12} className="mapa-edge-valuemeta">
                    <FormField>
                      <Label>{t("edge.valueLabelField")}</Label>
                      <TextInput
                        value={valueLabel}
                        onChange={(v) => setValueLabel(v.slice(0, VALUE_LABEL_MAX))}
                        placeholder={t("edge.valueLabelPh")}
                        disabled={readOnly}
                      />
                    </FormField>
                    <FormField>
                      <Label>{t("edge.valueUnitField")}</Label>
                      <TextInput
                        value={valueUnit}
                        onChange={(v) => setValueUnit(v.slice(0, VALUE_UNIT_MAX))}
                        placeholder={t("edge.valueUnitPh")}
                        disabled={readOnly}
                      />
                    </FormField>
                  </Flex>
                  {/* El nombre va en el tooltip del chip; DENTRO del chip solo si se pide. */}
                  <Switch value={valueShowLabel} onChange={(checked) => setValueShowLabel(checked)} disabled={readOnly}>
                    {t("edge.valueShowLabel")}
                  </Switch>
                </Flex>
              )}
            </div>
          </div>
        </div>
      </Flex>
    </Modal>
  );
};
