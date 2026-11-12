import React, { useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Menu } from "@dynatrace/strato-components/navigation";
import { NumberInputV2 } from "@dynatrace/strato-components/forms";
import {
  ArrowSmallUpIcon,
  ArrowSmallDownIcon,
  CheckmarkIcon,
  ChevronDownIcon,
  PlusIcon,
  XmarkIcon,
} from "@dynatrace/strato-icons";
import { MAX_COLOR_RULES, OP_SYMBOL, RULE_OPS } from "./submapRules";
import type { ColorRule, RuleColor, RuleOp, SubmapMetric } from "./submapRules";
import { useT } from "../i18n";

// ── Reglas de color (inspiradas en el panel "Colors" de los tableros) ────────
// Una fila por regla: muestra de color + operador + valor, con botones para
// reordenar y quitar. Los desplegables reusan el patrón `mapa-roledd` que ya
// usan los Ajustes (frecuencia, glow, idioma) para no meter un look nuevo.
//
// Los tres colores son los del contrato de estado de la app; se pintan con las
// mismas variables que el resto del lienzo para que respeten el tema.
const COLOR_VAR: Record<RuleColor, string> = {
  0: "var(--sev-ok)",
  1: "var(--sev-warn)",
  2: "var(--sev-err)",
};

const Swatch = ({ color }: { color: RuleColor }) => (
  <span className="mapa-crule-swatch" style={{ background: COLOR_VAR[color] }} aria-hidden="true" />
);

type Props = {
  metric: SubmapMetric;
  rules: ColorRule[];
  readOnly?: boolean;
  onMetricChange: (m: SubmapMetric) => void;
  onRulesChange: (rules: ColorRule[]) => void;
};

export const ColorRules = ({ metric, rules, readOnly = false, onMetricChange, onRulesChange }: Props) => {
  const t = useT();
  const [openColorAt, setOpenColorAt] = useState<number | null>(null);
  const [openOpAt, setOpenOpAt] = useState<number | null>(null);

  const COLOR_LABEL: Record<RuleColor, string> = {
    0: t("sev.ok"),
    1: t("sev.warn"),
    2: t("sev.err"),
  };

  const METRICS: { value: SubmapMetric; label: string }[] = [
    { value: "healthyPct", label: t("rules.metricPct") },
    { value: "affectedCount", label: t("rules.metricCount") },
  ];

  const patch = (i: number, next: Partial<ColorRule>) =>
    onRulesChange(rules.map((r, k) => (k === i ? { ...r, ...next } : r)));

  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= rules.length) return;
    const next = [...rules];
    [next[i], next[j]] = [next[j], next[i]];
    onRulesChange(next);
  };

  const remove = (i: number) => onRulesChange(rules.filter((_, k) => k !== i));

  // La fila nueva copia la última para que el usuario solo tenga que ajustar lo
  // que le interese (y nunca arranque con un valor sin sentido).
  const add = () => {
    if (rules.length >= MAX_COLOR_RULES) return;
    const last = rules[rules.length - 1];
    onRulesChange([...rules, last ? { ...last } : { color: 2, op: "lt", value: 50 }]);
  };

  return (
    <div className="mapa-crules">
      {/* Métrica que evalúan TODAS las reglas del nodo. */}
      <div className="size-seg">
        {METRICS.map((m) => (
          <button
            type="button"
            key={m.value}
            className={`size-opt${m.value === metric ? " size-opt-on" : ""}`}
            onClick={() => onMetricChange(m.value)}
            disabled={readOnly}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="mapa-crule-list">
        {rules.map((r, i) => (
          <div className="mapa-crule-row" key={i}>
            <Menu onOpenChange={(o) => setOpenColorAt(o ? i : null)}>
              <Menu.Trigger>
                <button
                  type="button"
                  className="mapa-roledd mapa-roledd-sm mapa-crule-dd"
                  disabled={readOnly}
                  aria-label={t("rules.colorLabel")}
                >
                  <Swatch color={r.color} />
                  <span className="mapa-roledd-label">{COLOR_LABEL[r.color]}</span>
                  <span className={`mapa-roledd-caret${openColorAt === i ? " mapa-roledd-caret-open" : ""}`}>
                    <ChevronDownIcon size={12} />
                  </span>
                </button>
              </Menu.Trigger>
              <Menu.Content>
                {([0, 1, 2] as RuleColor[]).map((c) => (
                  <Menu.Item
                    key={c}
                    className={`mapa-roledd-item${c === r.color ? " mapa-roledd-item-on" : ""}`}
                    onSelect={() => patch(i, { color: c })}
                  >
                    <Menu.Prefix>
                      <Swatch color={c} />
                    </Menu.Prefix>
                    {COLOR_LABEL[c]}
                    {c === r.color && (
                      <Menu.Suffix>
                        <CheckmarkIcon size={14} />
                      </Menu.Suffix>
                    )}
                  </Menu.Item>
                ))}
              </Menu.Content>
            </Menu>

            <Menu onOpenChange={(o) => setOpenOpAt(o ? i : null)}>
              <Menu.Trigger>
                <button
                  type="button"
                  className="mapa-roledd mapa-roledd-sm mapa-crule-op"
                  disabled={readOnly}
                  aria-label={t("rules.opLabel")}
                >
                  <span className="mapa-roledd-label">{OP_SYMBOL[r.op]}</span>
                  <span className={`mapa-roledd-caret${openOpAt === i ? " mapa-roledd-caret-open" : ""}`}>
                    <ChevronDownIcon size={12} />
                  </span>
                </button>
              </Menu.Trigger>
              <Menu.Content>
                {RULE_OPS.map((op: RuleOp) => (
                  <Menu.Item
                    key={op}
                    className={`mapa-roledd-item${op === r.op ? " mapa-roledd-item-on" : ""}`}
                    onSelect={() => patch(i, { op })}
                  >
                    {OP_SYMBOL[op]}
                    {op === r.op && (
                      <Menu.Suffix>
                        <CheckmarkIcon size={14} />
                      </Menu.Suffix>
                    )}
                  </Menu.Item>
                ))}
              </Menu.Content>
            </Menu>

            <span className="mapa-crule-value">
              <NumberInputV2
                value={r.value}
                // El input deja el campo en null mientras se borra: se conserva el
                // valor anterior para no persistir una regla sin número.
                onChange={(v) => patch(i, { value: typeof v === "number" ? v : r.value })}
                min={0}
                disabled={readOnly}
              />
            </span>

            {!readOnly && (
              <span className="mapa-crule-actions">
                <button
                  type="button"
                  className="mapa-iconbtn mapa-iconbtn-sm"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  title={t("rules.up")}
                  aria-label={t("rules.up")}
                >
                  <ArrowSmallUpIcon size={13} />
                </button>
                <button
                  type="button"
                  className="mapa-iconbtn mapa-iconbtn-sm"
                  onClick={() => move(i, 1)}
                  disabled={i === rules.length - 1}
                  title={t("rules.down")}
                  aria-label={t("rules.down")}
                >
                  <ArrowSmallDownIcon size={13} />
                </button>
                <button
                  type="button"
                  className="mapa-iconbtn mapa-iconbtn-sm"
                  onClick={() => remove(i)}
                  disabled={rules.length <= 1}
                  title={t("rules.remove")}
                  aria-label={t("rules.remove")}
                >
                  <XmarkIcon size={13} />
                </button>
              </span>
            )}
          </div>
        ))}
      </div>

      {!readOnly && rules.length < MAX_COLOR_RULES && (
        <div>
          <Button onClick={add} aria-label={t("rules.add")}>
            <Button.Prefix>
              <PlusIcon />
            </Button.Prefix>
            {t("rules.add")}
          </Button>
        </div>
      )}

      <div className="mapa-field-hint">{t("rules.hint")}</div>
    </div>
  );
};
