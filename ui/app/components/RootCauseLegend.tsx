import React, { useState } from "react";
import { AiIcon, ChevronDownIcon, ChevronUpIcon, InformationIcon } from "@dynatrace/strato-icons";
import { useT } from "../i18n";
import type { RcAnalysis, RcStage } from "./rootCause";

// ── Leyenda "Causas raíz" (arriba a la derecha del lienzo) ───────────────────
// Lista las causas raíz del último análisis guardado en el mapa (numeradas como
// los círculos rojos de los nodos). Clic en una fila → modal con la razón.
// Mientras corre el análisis muestra el estado; si falla, el motivo.

export const rcAgo = (iso: string, t: ReturnType<typeof useT>): string => {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (!Number.isFinite(min) || min < 1) return t("rca.agoNow");
  if (min < 60) return t("rca.agoMin", { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return t("rca.agoHour", { n: h });
  return new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
};

type Props = {
  analysis?: RcAnalysis;
  busy: RcStage | null;
  error: string | null;
  canRun: boolean;
  canClear?: boolean; // editores: «Limpiar» quita el análisis guardado (se puede deshacer)
  cleared?: boolean; // todo el análisis ya se resolvió → los nodos quedaron sin marcas
  onClear?: () => void;
  nodeName: (id: string) => string;
  closed?: Set<string>; // event.id ya cerrados (estado vivo)
  newRed?: number; // nodos en rojo que no estaban en el análisis
  onOpen: (n: number) => void;
  onRerun: () => void;
};

export const RootCauseLegend = ({
  analysis,
  busy,
  error,
  canRun,
  canClear,
  cleared,
  onClear,
  nodeName,
  closed,
  newRed = 0,
  onOpen,
  onRerun,
}: Props) => {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [info, setInfo] = useState(false);
  if (!analysis && !busy && !error) return null;
  // Activas primero (en su orden de gravedad) y las ya resueltas al final.
  const isDone = (id: string) => !!closed?.has(id);
  const causes = [...(analysis?.causes ?? [])].sort((a, b) => Number(isDone(a.problemId)) - Number(isDone(b.problemId)));
  const activas = causes.filter((c) => !isDone(c.problemId)).length;

  return (
    <div className="mapa-rc-legend nowheel nodrag" role="region" aria-label={t("rca.title")}>
      <div className="mapa-rc-head">
        <span className="mapa-rc-title">{t("rca.title")}</span>
        {!busy && analysis && <span className={`mapa-rc-count${activas === 0 ? " mapa-rc-count-ok" : ""}`}>{activas}</span>}
        <button
          type="button"
          className="mapa-rc-iconbtn"
          onClick={() => setInfo((v) => !v)}
          aria-expanded={info}
          aria-label={t("rca.infoLabel")}
          title={t("rca.infoLabel")}
        >
          <InformationIcon size={14} />
        </button>
        <span className="mapa-rc-spacer" />
        <button
          type="button"
          className="mapa-rc-iconbtn"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? t("rca.collapse") : t("rca.expand")}
          title={open ? t("rca.collapse") : t("rca.expand")}
        >
          {open ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
        </button>
      </div>
      {info && <p className="mapa-rc-info">{t("rca.info")}</p>}
      {open && (
        <>
          {busy ? (
            <div className="mapa-rc-busy">
              <AiIcon size={16} />
              <p>{busy === "collecting" ? t("rca.busyCollecting") : t("rca.busyRunning")}</p>
              <div className="mapa-rc-skel" style={{ width: "85%" }} />
              <div className="mapa-rc-skel" style={{ width: "60%" }} />
            </div>
          ) : error ? (
            <div className="mapa-rc-error" role="alert">
              {error}
            </div>
          ) : causes.length === 0 ? (
            <div className="mapa-rc-empty">{t("rca.noCauses")}</div>
          ) : (
            <>
            {activas === 0 && <div className="mapa-rc-allok">{t("rca.allResolved")}</div>}
            {cleared && <div className="mapa-rc-cleared">{t("rca.cleared")}</div>}
            {newRed > 0 && (
              <div className="mapa-rc-stale">
                {t("rca.newRed", { n: newRed })}
                {canRun && (
                  <button type="button" className="mapa-rc-link" onClick={onRerun}>
                    {t("rca.rerun")}
                  </button>
                )}
              </div>
            )}
            <ul className="mapa-rc-list">
              {causes.map((c) => {
                const where = c.nodeIds.map(nodeName).filter(Boolean);
                return (
                  <li key={c.problemId}>
                    <button
                      type="button"
                      className={`mapa-rc-row${isDone(c.problemId) ? " mapa-rc-row-done" : ""}`}
                      onClick={() => onOpen(c.n)}
                    >
                      <span className={`mapa-rc-num${isDone(c.problemId) ? " mapa-rc-num-ok" : ""}`}>
                        {isDone(c.problemId) ? "✓" : c.n}
                      </span>
                      <span className="mapa-rc-rowtxt">
                        {c.displayId && <span className="mapa-rc-pid">{c.displayId}</span>}
                        <span className="mapa-rc-name">
                          {c.name || c.problemId}
                          {isDone(c.problemId) && <span className="mapa-rc-donepill">{t("rca.resolved")}</span>}
                        </span>
                        <span className="mapa-rc-meta">
                          {[where[0] ?? "", where.length > 1 ? `+${where.length - 1}` : ""].filter(Boolean).join(" ")}
                          {where.length ? " · " : ""}
                          {c.effects.length === 1 ? t("rca.explainsOne") : t("rca.explains", { n: c.effects.length })}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            </>
          )}
          {analysis && !busy && (
            <div className="mapa-rc-foot">
              <span>
                {t("rca.analyzed", { when: rcAgo(analysis.at, t) })}
                {analysis.by ? ` · ${analysis.by}` : ""}
                {(analysis.totalProblems ?? 0) > analysis.problemCount && (
                  <>
                    <br />
                    {t("rca.partial", { n: analysis.problemCount, total: analysis.totalProblems ?? 0 })}
                  </>
                )}
                {analysis.unclassified.length > 0 && (
                  <>
                    <br />
                    {analysis.unclassified.length === 1
                      ? t("rca.unclassifiedOne")
                      : t("rca.unclassified", { n: analysis.unclassified.length })}
                  </>
                )}
              </span>
              <span className="mapa-rc-footbtns">
                {canClear && onClear && (
                  <button type="button" className="mapa-rc-link mapa-rc-link-muted" onClick={onClear} title={t("rca.clearTip")}>
                    {t("rca.clear")}
                  </button>
                )}
                {canRun && (
                  <button type="button" className="mapa-rc-link" onClick={onRerun}>
                    {t("rca.rerun")}
                  </button>
                )}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
};
