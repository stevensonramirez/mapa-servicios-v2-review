import React, { useEffect, useState } from "react";
import { Modal } from "@dynatrace/strato-components/overlays";
import { ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon, LocationMarkerIcon } from "@dynatrace/strato-icons";
import { useT } from "../i18n";
import { problemLink } from "./copilotExplain";
import type { RcAnalysis, RcCause, RcProblem } from "./rootCause";
import { rcOnNode } from "./rootCause";
import { rcAgo } from "./RootCauseLegend";

// ── Modal de una causa raíz ──────────────────────────────────────────────────
// Pensado para RECORRER con clics, no para leer un bloque de texto:
//   - Causa: nombre + link al problema + botón «Ir al nodo» (centra el mapa en
//     el nodo y lo resalta).
//   - Efectos: tarjetas, cada una con link a su problema y «Ir al nodo».
//   - Razón corta; evidencia plegada.
// Si se abrió desde un nodo EFECTO, un aviso arriba lo dice y lleva al nodo causa.

const hhmm = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "";

type Props = {
  analysis?: RcAnalysis;
  cause: RcCause | null;
  focusNodeId?: string | null;
  nodeName: (id: string) => string;
  closed?: Set<string>; // event.id ya cerrados (estado vivo)
  onFocusNode: (id: string) => void;
  onClose: () => void;
};

const ProblemLink = ({ p, label }: { p: RcProblem; label: string }) => {
  const href = problemLink(p.problemId);
  if (!href) return null;
  return (
    <a className="mapa-rc-plink" href={href} target="_blank" rel="noopener noreferrer" title={label}>
      {p.displayId || label}
      <ExternalLinkIcon size={12} />
    </a>
  );
};

const NodeButtons = ({
  ids,
  nodeName,
  onFocusNode,
  title,
}: {
  ids: string[];
  nodeName: (id: string) => string;
  onFocusNode: (id: string) => void;
  title: string;
}) => (
  <>
    {ids.map((id) => (
      <button key={id} type="button" className="mapa-rc-nodebtn" onClick={() => onFocusNode(id)} title={title}>
        <LocationMarkerIcon size={13} />
        <span>{nodeName(id) || id}</span>
      </button>
    ))}
  </>
);

export const RootCauseModal = ({ analysis, cause, focusNodeId, nodeName, closed, onFocusNode, onClose }: Props) => {
  const t = useT();
  const [showEv, setShowEv] = useState(false);
  useEffect(() => setShowEv(false), [cause?.problemId]);
  const total = analysis?.causes.length ?? 0;
  // ¿Se abrió desde un nodo que es EFECTO (no causa) de esta causa raíz?
  const fromEffect =
    !!cause && !!focusNodeId && !rcOnNode(cause.nodeIds, focusNodeId) && cause.effects.some((e) => rcOnNode(e.nodeIds, focusNodeId));

  return (
    <Modal
      title={cause ? t("rca.modalTitle", { n: cause.n, total }) : t("rca.title")}
      show={!!cause}
      size="medium"
      onDismiss={onClose}
    >
      {cause && (
        <div className="mapa-rc-modal">
          {closed?.has(cause.problemId) && <div className="mapa-rc-donebanner">{t("rca.causeResolved")}</div>}
          {fromEffect && (
            <div className="mapa-rc-banner">
              <span>{t("rca.fromEffect", { node: nodeName(focusNodeId!) })}</span>
              {cause.nodeIds[0] && (
                <button type="button" className="mapa-rc-nodebtn mapa-rc-nodebtn-strong" onClick={() => onFocusNode(cause.nodeIds[0])}>
                  <LocationMarkerIcon size={13} />
                  <span>{t("rca.goCauseNode")}</span>
                </button>
              )}
            </div>
          )}

          {/* Causa */}
          <div className="mapa-rc-causecard">
            <span className="mapa-rc-num mapa-rc-num-lg">{cause.n}</span>
            <div className="mapa-rc-causebody">
              <div className="mapa-rc-mname">{cause.name || cause.problemId}</div>
              <div className="mapa-rc-chips">
                {cause.category && <span className="mapa-rc-chip mapa-rc-chip-crit">{cause.category}</span>}
                {cause.severity != null && <span className="mapa-rc-chip">SEV-{cause.severity}</span>}
                {cause.start && <span className="mapa-rc-chip">{t("rca.started", { t: hhmm(cause.start) })}</span>}
                <ProblemLink p={cause} label={t("rca.openProblem")} />
              </div>
              {cause.nodeIds.length > 0 && (
                <div className="mapa-rc-where">
                  <NodeButtons ids={cause.nodeIds} nodeName={nodeName} onFocusNode={onFocusNode} title={t("rca.goNode")} />
                </div>
              )}
            </div>
          </div>

          {cause.verdict && <p className="mapa-rc-verdict">{cause.verdict}</p>}

          <section className="mapa-rc-sec">
            <div className="mapa-rc-sechead">
              <span className="mapa-why-sectitle">{t("rca.why")}</span>
              {cause.evidenceLevel === null ? (
                <span className="mapa-rc-confpill" title={t("rca.aiConf", { c: t(`rca.conf.${cause.confidence}`) })}>
                  {t("rca.isolated")}
                </span>
              ) : cause.evidenceLevel ? (
                <span
                  className={`mapa-rc-confpill mapa-rc-conf-${cause.evidenceLevel}`}
                  title={t("rca.aiConf", { c: t(`rca.conf.${cause.confidence}`) })}
                >
                  {t("rca.confCalc")}: {t(`rca.conf.${cause.evidenceLevel}`)}
                </span>
              ) : (
                <span className={`mapa-rc-confpill mapa-rc-conf-${cause.confidence}`}>
                  {t("rca.confidence")}: {t(`rca.conf.${cause.confidence}`)}
                </span>
              )}
            </div>
            <p className="mapa-rc-reason">{cause.reason}</p>
          </section>

          {cause.recommendations && cause.recommendations.length > 0 && (
            <section className="mapa-rc-sec">
              <div className="mapa-why-sectitle">{t("rca.todo")}</div>
              <ol className="mapa-rc-todo">
                {cause.recommendations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ol>
            </section>
          )}

          <section className="mapa-rc-sec">
            <div className="mapa-why-sectitle">{t("rca.effects", { n: cause.effects.length })}</div>
            {cause.effects.length === 0 ? (
              <div className="mapa-rc-mutedline">{t("rca.noEffects")}</div>
            ) : (
              <ul className="mapa-rc-fx">
                {cause.effects.map((e) => (
                  <li
                    key={e.problemId}
                    className={`mapa-rc-fxitem${focusNodeId && rcOnNode(e.nodeIds, focusNodeId) ? " mapa-rc-fxitem-on" : ""}`}
                  >
                    <div className="mapa-rc-fxtop">
                      <span className="mapa-rc-fxbadge">{t("rca.effect")}</span>
                      <span className="mapa-rc-fxname">{e.name || e.problemId}</span>
                      {closed?.has(e.problemId) ? (
                        <span className="mapa-rc-donepill">{t("rca.effResolved")}</span>
                      ) : (
                        e.start && <span className="mapa-rc-time">{hhmm(e.start)}</span>
                      )}
                    </div>
                    {e.proof && (
                      <div className="mapa-rc-sigs">
                        <span className={`mapa-rc-sigscore mapa-rc-conf-${e.proof.level}`}>
                          {t("rca.sigScore", { n: e.proof.score, total: e.proof.total })}
                        </span>
                        {(["topologia", "orden", "raizDavis", "eventos", "entorno", "conexionMapa"] as const).map((k) => {
                          const v = e.proof!.signals[k];
                          if (v === null || v === undefined) return null;
                          return (
                            <span key={k} className={`mapa-rc-sig ${v ? "mapa-rc-sig-ok" : "mapa-rc-sig-no"}`}>
                              {v ? "✔" : "✖"} {t(`rca.sig.${k}`)}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    <div className="mapa-rc-fxactions">
                      <ProblemLink p={e} label={t("rca.openProblem")} />
                      <NodeButtons ids={e.nodeIds} nodeName={nodeName} onFocusNode={onFocusNode} title={t("rca.goNode")} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {cause.evidence.length > 0 && (
            <section className="mapa-rc-sec">
              <button type="button" className="mapa-rc-evtoggle" onClick={() => setShowEv((v) => !v)} aria-expanded={showEv}>
                {showEv ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
                {showEv ? t("rca.hideEvidence") : t("rca.showEvidence", { n: cause.evidence.length })}
              </button>
              {showEv && (
                <ul className="mapa-rc-ev">
                  {cause.evidence.map((ev, i) => (
                    <li key={i}>{ev}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <div className="mapa-rc-mfoot">
            <span>
              {t("rca.footer", { when: analysis ? rcAgo(analysis.at, t) : "" })}
              {analysis?.by ? ` · ${analysis.by}` : ""}
            </span>
          </div>
        </div>
      )}
    </Modal>
  );
};
