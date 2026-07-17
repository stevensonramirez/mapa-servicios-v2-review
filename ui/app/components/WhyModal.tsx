import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Markdown } from "@dynatrace/strato-components/content";
import { Modal } from "@dynatrace/strato-components/overlays";
import {
  AiIcon,
  RefreshIcon,
  UnavailableIcon,
  ExternalLinkIcon,
  WorkflowSimpleIcon,
} from "@dynatrace/strato-icons";
import { useDql } from "@dynatrace-sdk/react-hooks";
import type { Node } from "@xyflow/react";
import type { SeverityNodeData } from "./SeverityNode";
import { recordsToSeverity } from "./nodeStatus";
import {
  explainNodeStatus,
  collectEntityIds,
  collectTagConditions,
  buildActiveProblemsQuery,
  buildActiveProblemsCountQuery,
  buildNodeProblemsQuery,
  buildNodeProblemsCountQuery,
  ACTIVE_PROBLEMS_LIMIT,
  buildEvidenceQuery,
  isDeclaredStatus,
  generateInvestigationDql,
  problemLink,
  explainCacheKey,
  getCachedExplain,
  setCachedExplain,
  type CopilotSource,
} from "./copilotExplain";
import { useT, useLang } from "../i18n";
import { openEntity } from "./entityModel";
import { useMapSettings } from "./mapSettings";
import { usePopUi } from "./popUi";
import { openAssistWithPrompt } from "./assistIntent";

// Tope de problemas que viajan dentro del prompt del Assist: con más el prompt
// se vuelve interminable (y la lista completa igual se ve en la burbuja).
const ASSIST_MAX_PROBLEMS = 10;

const CACHE_MS = 60_000;

const SEV_COLOR: Record<string, string> = {
  "0": "#0caf66",
  "1": "#dd8f00",
  "2": "#e0314a",
  unknown: "#8e9ab4",
};

const fmtVal = (v: unknown): string => {
  if (v == null) return "—";
  if (typeof v === "string") return v.length ? v : "—";
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  try {
    return JSON.stringify(v) ?? "—";
  } catch {
    return "…";
  }
};

const msgOf = (e: unknown): string => (e as { message?: string }).message ?? String(e);

// Estado del análisis principal. Además de la IA, incluye los dos veredictos
// HONESTOS cuando el motor decide NO llamar a la IA (sin evidencia real).
type AiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; text: string; sources: CopilotSource[]; at: number }
  | { status: "error"; msg: string }
  | { status: "declared" } // status fijo en la consulta + sin entidad
  | { status: "none" }; // sin evidencia: no se pudo identificar la causa

// Investigación a fondo (opt-in): nl2dql → ejecutar → recommender.
type DeepState =
  | { status: "off" }
  | { status: "gen" }
  | { status: "run" }
  | { status: "explain" }
  | { status: "done"; text: string; sources: CopilotSource[] }
  | { status: "noresults" } // la consulta generada no devolvió filas → NO se llama a la IA
  | { status: "error"; msg: string };

// Detalle de la REGLA de salud de conexiones cuando ella (y no Davis) puso el
// nodo en rojo. Lo calcula MapCanvas con datos que YA tiene (gratis).
export type ConnRuleInfo = { pct: number; bad: number; total: number; threshold: number };

type Props = {
  node: Node<SeverityNodeData> | null;
  // Si viene, el nodo está rojo por la regla de salud de conexiones: la burbuja
  // muestra SOLO esa explicación y NO ejecuta ninguna consulta ni invoca a la IA.
  connRule?: ConnRuleInfo | null;
  onClose: () => void;
  // Análisis de causa raíz del mapa: ¿se puede lanzar desde aquí? (editor, Mapa
  // de Servicio, hay problemas y no hay uno corriendo) y la acción de lanzarlo.
  rcCanRun?: boolean;
  onRunRootCause?: () => void;
};

export const WhyModal = ({ node, connRule, onClose, rcCanRun, onRunRootCause }: Props) => {
  const t = useT();
  const { lang } = useLang();
  // Ajuste POR MAPA: el análisis con IA (tarjeta de Davis CoPilot + "Investigar
  // a fondo") viene APAGADO. Apagado, la burbuja no llama a la IA en absoluto;
  // el resto (estado, problemas activos, Dynatrace Assist) funciona igual.
  const mapSettings = useMapSettings();
  const pop = usePopUi();
  // Papel de cada problema (por event.id) en el último análisis de causa raíz.
  const rcRoles = useMemo(() => {
    const m = new Map<string, { kind: "root" | "effect"; n: number }>();
    for (const c of mapSettings.rootCause?.causes ?? []) {
      m.set(c.problemId, { kind: "root", n: c.n });
      for (const e of c.effects) if (!m.has(e.problemId)) m.set(e.problemId, { kind: "effect", n: c.n });
    }
    return m;
  }, [mapSettings.rootCause]);
  const rcHasAnalysis = (mapSettings.rootCause?.causes.length ?? 0) > 0;
  const aiOn = mapSettings.copilotOff !== true; // encendido salvo que el mapa lo apague
  // Plantilla personalizada del prompt de Assist (Ajustes). En blanco = default
  // del idioma activo. Se interpola aquí con las mismas variables del default.
  const customAssist = (mapSettings.assistPrompt ?? "").trim();
  const nodeName = node?.data.name?.trim() ?? "";
  const nodeKind = node?.data.kind?.trim() ?? "";
  const open = node !== null;

  // Nodo atado a una entidad con fuente "davis": su estado NO lo decide un DQL
  // (el `dql` que trae el nodo es solo la plantilla por defecto que se guardó al
  // crearlo, irrelevante aquí) — lo decide Davis. Ignoramos el DQL heredado para
  // que TODA la maquinaria de abajo (declarado/evidencia/investigar a fondo, que
  // sí depende de un DQL real) quede desactivada, y usamos la rama Davis dedicada
  // (ver `davisProblemsDql` más abajo) en su lugar.
  const entity = node?.data.entity;
  const statusSource = node?.data.statusSource ?? (entity ? "davis" : "dql");
  // Rojo por la REGLA de salud de conexiones → cortocircuito total: sin DQL, sin
  // rama Davis, sin CoPilot. Todas las consultas de abajo quedan deshabilitadas
  // (dql = "" y davisProblemsDql = "") y el render usa la tarjeta de la regla.
  const connRuleActive = connRule != null;
  const isDavisSourced = !connRuleActive && statusSource === "davis" && !!entity?.id;
  const dql = connRuleActive || isDavisSourced ? "" : (node?.data.dql?.trim() ?? "");

  const { data, error, isLoading } = useDql(dql, { enabled: open && dql.length > 0 });
  const records = (data?.records ?? []) as Array<Record<string, unknown>>;
  const sev = data ? recordsToSeverity(records) : undefined;
  const sevStr = sev === undefined ? "unknown" : String(sev);

  // ── Recolección de evidencia ────────────────────────────────────────────────
  // declared: el status es literal en el DQL → no hay causa que extraer de datos.
  const declared = useMemo(() => isDeclaredStatus(dql), [dql]);
  // entidades referidas (texto del DQL + filas) → para traer problemas de Davis.
  const entityIds = useMemo(
    () => (data ? collectEntityIds(dql, records) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, dql],
  );
  // Filtros por tag de entidad extraídos del DQL VIGENTE (sin comentarios):
  // permiten encontrar los problemas aunque el DQL no mencione ningún id de
  // entidad (caso custom devices por entity_tags). Se combinan con los ids.
  const tagConds = useMemo(() => (dql ? collectTagConditions(dql) : []), [dql]);
  const problemsDql = useMemo(
    () => buildActiveProblemsQuery(entityIds, tagConds),
    [entityIds, tagConds],
  );
  // recuperación de evidencia: solo si el status NO es literal (si es literal, las
  // filas no son evidencia del estado).
  const evidenceDql = useMemo(() => (declared ? "" : buildEvidenceQuery(dql)), [declared, dql]);

  // PRIMERO la lista desde el MISMO DQL del nodo (si consulta dt.davis.problems):
  // es lo que vería un notebook. Solo si no deja filas con event.id (p. ej. el DQL
  // resume con summarize) o falla, se cae a la extracción por ids/tags.
  const nodeProblemsDql = useMemo(() => (dql ? buildNodeProblemsQuery(dql) : ""), [dql]);
  const nodeQ = useDql(nodeProblemsDql, { enabled: open && nodeProblemsDql.length > 0 });
  const nodeProblems = (nodeQ.data?.records ?? []) as Array<Record<string, unknown>>;
  const nodeDone = nodeProblemsDql.length === 0 || nodeQ.data !== undefined || nodeQ.error != null;
  const fromNode = nodeProblems.length > 0;

  const needsProblems = problemsDql.length > 0 && nodeDone && !fromNode;
  const needsEvidence = evidenceDql.length > 0;
  const enrich = useDql(problemsDql, { enabled: open && needsProblems });
  const evidence = useDql(evidenceDql, { enabled: open && needsEvidence });
  const problems = fromNode
    ? nodeProblems
    : ((enrich.data?.records ?? []) as Array<Record<string, unknown>>);
  const problemsDone =
    nodeDone && (fromNode || !needsProblems || enrich.data !== undefined || enrich.error != null);
  const evidenceDone = !needsEvidence || evidence.data !== undefined || evidence.error != null;
  const gatherDone = !!data && problemsDone && evidenceDone;

  // ── Rama Davis (nodo atado a una entidad, sin DQL propio) ────────────────────
  // Auto-contenida, igual criterio que la rama DQL de arriba: trae los problemas
  // ACTIVOS de la entidad (misma consulta que usa la burbuja para enriquecer al
  // CoPilot) y deriva la severidad de ahí — NUNCA de un DQL heredado/placeholder.
  const davisProblemsDql = useMemo(
    () => (isDavisSourced && entity?.id ? buildActiveProblemsQuery([entity.id]) : ""),
    [isDavisSourced, entity],
  );
  const davisQ = useDql(davisProblemsDql, { enabled: open && davisProblemsDql.length > 0 });
  const davisProblems = (davisQ.data?.records ?? []) as Array<Record<string, unknown>>;

  // Contador honesto: la lista trae hasta ACTIVE_PROBLEMS_LIMIT problemas. Solo si
  // llega al tope se cuenta el total real (misma base, sin duplicados).
  const problemsCountDql = useMemo(
    () => (fromNode ? buildNodeProblemsCountQuery(dql) : buildActiveProblemsCountQuery(entityIds, tagConds)),
    [fromNode, dql, entityIds, tagConds],
  );
  const problemsCountQ = useDql(problemsCountDql, {
    enabled: open && problemsCountDql.length > 0 && problems.length >= ACTIVE_PROBLEMS_LIMIT,
  });
  const davisCountDql = useMemo(
    () => (isDavisSourced && entity?.id ? buildActiveProblemsCountQuery([entity.id]) : ""),
    [isDavisSourced, entity],
  );
  const davisCountQ = useDql(davisCountDql, {
    enabled: open && davisCountDql.length > 0 && davisProblems.length >= ACTIVE_PROBLEMS_LIMIT,
  });
  const davisGatherDone = !isDavisSourced || davisQ.data !== undefined || davisQ.error != null;
  const davisSevStr = !isDavisSourced
    ? "unknown"
    : davisQ.data === undefined
      ? "unknown"
      : davisProblems.some((p) => ["AVAILABILITY", "ERROR"].includes(String(p["event.category"])))
        ? "2"
        : davisProblems.length > 0
          ? "1"
          : "0";

  const effectiveSevStr = isDavisSourced ? davisSevStr : sevStr;
  // "Ya tenemos un veredicto que mostrar" — la fila del DQL en un caso, la consulta
  // de problemas de Davis resuelta en el otro (0 problemas SÍ cuenta como veredicto).
  const deciding = isDavisSourced ? davisQ.data !== undefined : !!records[0];
  const isFailing = effectiveSevStr === "1" || effectiveSevStr === "2";
  const effectiveProblems = isDavisSourced ? davisProblems : problems;
  const countRec = ((isDavisSourced ? davisCountQ : problemsCountQ).data?.records ?? [])[0] as
    | Record<string, unknown>
    | undefined;
  const totalProblems = countRec ? Number(countRec.total) : NaN;
  const problemsCountLabel =
    Number.isFinite(totalProblems) && totalProblems > effectiveProblems.length
      ? t("why.problemsShowing", { total: totalProblems, shown: effectiveProblems.length })
      : String(effectiveProblems.length);
  const sevWord = effectiveSevStr === "2" ? t("node.badgeErr") : t("node.badgeWarn");

  const verdict =
    effectiveSevStr === "2"
      ? t("why.verdictErr")
      : effectiveSevStr === "1"
        ? t("why.verdictWarn")
        : effectiveSevStr === "0"
          ? t("why.verdictOk")
          : t("why.verdictUnknown");

  // ── Análisis principal ──────────────────────────────────────────────────────
  const [ai, setAi] = useState<AiState>({ status: "idle" });
  const [nonce, setNonce] = useState(0);
  const aiAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!aiOn) return; // análisis con IA apagado en los ajustes del mapa
    if (!open || !gatherDone || ai.status !== "idle") return;
    const recs = (data?.records ?? []) as Array<Record<string, unknown>>;
    if (recs.length === 0) return;
    const s = recordsToSeverity(recs);
    if (s !== 1 && s !== 2) return;
    const label = s === 1 ? t("sev.warn") : t("sev.err");
    const probRecs = (enrich.data?.records ?? []) as Array<Record<string, unknown>>;
    const detRecs = (evidence.data?.records ?? []) as Array<Record<string, unknown>>;
    const hasEvidence = probRecs.length > 0 || detRecs.length > 0;

    // Sin evidencia real → NO se llama a la IA: veredicto honesto.
    if (!hasEvidence) {
      if (declared && entityIds.length === 0) setAi({ status: "declared" });
      else setAi({ status: "none" });
      return;
    }

    // La llave incluye nombre + idioma: los ids de nodo se repiten ENTRE mapas
    // (n1, n2…), así que id+DQL solos podían devolver la respuesta cacheada de
    // OTRO mapa (nombrando el nodo equivocado) o en el idioma anterior.
    const key = explainCacheKey(`${node?.id ?? ""}::${nodeName}::${lang}`, dql);
    if (nonce === 0) {
      const cached = getCachedExplain(key, CACHE_MS);
      if (cached) {
        setAi({ status: "done", text: cached.result.text, sources: cached.result.sources, at: cached.ts });
        return;
      }
    }
    const ctrl = new AbortController();
    aiAbort.current = ctrl;
    setAi({ status: "loading" });
    explainNodeStatus({
      question: t("why.aiQuestion", { name: nodeName, state: label }),
      instruction: t("why.aiInstruction"),
      nodeName,
      nodeKind,
      stateLabel: label,
      dql,
      records: recs,
      problems: probRecs,
      detailRows: detRecs,
      abortSignal: ctrl.signal,
    })
      .then((r) => {
        if (ctrl.signal.aborted) return;
        const at = setCachedExplain(key, r);
        setAi({ status: "done", text: r.text, sources: r.sources, at });
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setAi({ status: "error", msg: msgOf(e) });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiOn, open, gatherDone, ai.status, nonce, dql, nodeName, nodeKind, declared, enrich.data, evidence.data]);

  // Misma máquina de estados (`ai`/`nonce`), rama Davis: evidencia = los problemas
  // activos reales de la entidad (no hay DQL/registros que recuperar aparte).
  useEffect(() => {
    if (!aiOn) return; // análisis con IA apagado en los ajustes del mapa
    if (!isDavisSourced || !open || !davisGatherDone || ai.status !== "idle") return;
    if (davisSevStr !== "1" && davisSevStr !== "2") return;
    const label = davisSevStr === "1" ? t("sev.warn") : t("sev.err");

    // Sin problemas reales (no debería pasar si davisSevStr ya es 1/2, pero por las
    // dudas) → veredicto honesto en vez de alucinar.
    if (davisProblems.length === 0) {
      setAi({ status: "none" });
      return;
    }

    const key = explainCacheKey(`${node?.id ?? ""}::${nodeName}::${lang}`, `davis:${entity?.id ?? ""}`);
    if (nonce === 0) {
      const cached = getCachedExplain(key, CACHE_MS);
      if (cached) {
        setAi({ status: "done", text: cached.result.text, sources: cached.result.sources, at: cached.ts });
        return;
      }
    }
    const ctrl = new AbortController();
    aiAbort.current = ctrl;
    setAi({ status: "loading" });
    explainNodeStatus({
      question: t("why.aiQuestion", { name: nodeName, state: label }),
      instruction: t("why.aiInstruction"),
      nodeName,
      nodeKind,
      stateLabel: label,
      dql: "",
      records: [],
      problems: davisProblems,
      abortSignal: ctrl.signal,
    })
      .then((r) => {
        if (ctrl.signal.aborted) return;
        const at = setCachedExplain(key, r);
        setAi({ status: "done", text: r.text, sources: r.sources, at });
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setAi({ status: "error", msg: msgOf(e) });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiOn, isDavisSourced, open, davisGatherDone, ai.status, nonce, davisSevStr, nodeName, nodeKind, entity, davisQ.data]);

  const refreshAi = () => {
    setNonce((n) => n + 1);
    setAi({ status: "idle" });
  };

  // ── Investigación a fondo (nl2dql → ejecutar → recommender) ──────────────────
  const [deep, setDeep] = useState<DeepState>({ status: "off" });
  const [deepDql, setDeepDql] = useState("");
  const deepAbort = useRef<AbortController | null>(null);
  const deepRun = useDql(deepDql, { enabled: open && deepDql.trim().length > 0 });

  const startDeep = () => {
    deepAbort.current?.abort();
    const ctrl = new AbortController();
    deepAbort.current = ctrl;
    setDeepDql("");
    setDeep({ status: "gen" });
    const ent = entityIds[0] ? ` (Dynatrace entity ${entityIds[0]})` : "";
    // nl2dql es experimental y SOLO soporta inglés → prompt EN INGLÉS y concreto
    // ("fetch error logs/events…"), no una petición meta en español (que hacía
    // fallar la skill). La respuesta al usuario sigue en su idioma: la redacta el
    // recommender más abajo con `why.aiInstruction`.
    const prompt =
      `The following read-only DQL evaluates the health of the service "${nodeName}"${ent}: ${dql}. ` +
      `Generate a read-only DQL query that fetches the underlying error logs or recent events ` +
      `from the last 2 hours that would explain why this service is in an alerting state. ` +
      `Sort newest first and limit to 20 rows.`;
    generateInvestigationDql({ prompt, abortSignal: ctrl.signal })
      .then((gen) => {
        if (ctrl.signal.aborted) return;
        setDeepDql(gen);
        setDeep({ status: "run" });
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setDeep({ status: "error", msg: msgOf(e) });
      });
  };

  // Cuando la consulta generada termina de ejecutarse, pásala al recommender.
  useEffect(() => {
    if (deep.status !== "run") return;
    if (deepRun.isLoading) return;
    if (deepRun.error) {
      setDeep({ status: "error", msg: msgOf(deepRun.error) });
      return;
    }
    if (deepRun.data === undefined) return;
    const rows = (deepRun.data.records ?? []) as Array<Record<string, unknown>>;
    // Sin filas → NO llamamos a la IA (si no, alucina una causa). Honesto.
    if (rows.length === 0) {
      setDeep({ status: "noresults" });
      return;
    }
    const s = recordsToSeverity(data?.records ?? []);
    const label = s === 1 ? t("sev.warn") : t("sev.err");
    const ctrl = new AbortController();
    deepAbort.current = ctrl;
    setDeep({ status: "explain" });
    explainNodeStatus({
      question: t("why.aiQuestion", { name: nodeName, state: label }),
      instruction: t("why.aiInstruction"),
      nodeName,
      nodeKind,
      stateLabel: label,
      dql: deepDql,
      records: rows,
      detailRows: rows,
      abortSignal: ctrl.signal,
    })
      .then((r) => {
        if (!ctrl.signal.aborted) setDeep({ status: "done", text: r.text, sources: r.sources });
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setDeep({ status: "error", msg: msgOf(e) });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deep.status, deepRun.isLoading, deepRun.data, deepRun.error]);

  // Abortar llamadas en vuelo al cerrar/desmontar.
  useEffect(
    () => () => {
      aiAbort.current?.abort();
      deepAbort.current?.abort();
    },
    [],
  );

  // ── Dynatrace Assist (portapapeles + app limpia → pestaña nueva) ─────────────
  // El prompt sale de i18n (idioma actual de la app) e incluye el contexto que ya
  // tenemos a la mano: nombre del nodo, entidad atada, estado y los problemas
  // activos. Va por el PORTAPAPELES (ver assistIntent.ts: el intent bloquea el
  // modo Agentic). No consume Grail ni CoPilot desde acá.
  const entityPart = entity?.id ? t("why.assistEntity", { id: entity.id }) : "";
  // En la rama de la regla de conexiones el nodo está en ROJO por regla, pero
  // `effectiveSevStr` es "unknown" → el estado del prompt se fija a Error.
  const assistState = connRuleActive ? t("node.badgeErr") : sevWord;

  const [assistNote, setAssistNote] = useState<"" | "copied" | "nocopy">("");
  const askAssist = (prompt: string) => {
    void openAssistWithPrompt(prompt).then((ok) => setAssistNote(ok ? "copied" : "nocopy"));
  };

  const assistPrompt = useMemo(() => {
    const list = effectiveProblems
      .slice(0, ASSIST_MAX_PROBLEMS)
      .map((p) => {
        const did = typeof p["display_id"] === "string" ? p["display_id"] : "";
        const nm = fmtVal(p["event.name"]);
        return did ? `${did} (${nm})` : nm;
      })
      .filter((s) => s && s !== "—")
      .join("; ");
    const problemsPart = list ? t("why.assistProblems", { list }) : t("why.assistNoProblems");
    const vars = {
      name: nodeName,
      entity: entityPart,
      state: assistState,
      problems: problemsPart,
    };
    if (customAssist) {
      // Misma interpolación que useT: reemplazo por función para que un valor
      // con $$ / $& no se interprete como patrón de replace().
      let out = customAssist;
      Object.entries(vars).forEach(([k, v]) => {
        out = out.replace(new RegExp(`\\{${k}\\}`, "g"), () => String(v));
      });
      return out;
    }
    return t("why.assistPrompt", vars);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveProblems, nodeName, entityPart, assistState, customAssist, lang]);

  // Prompt del botón pequeño de cada fila: pregunta SOLO por ese problema.
  const problemAssistPrompt = (p: Record<string, unknown>): string => {
    const did = typeof p["display_id"] === "string" ? p["display_id"] : "";
    const nm = fmtVal(p["event.name"]);
    if (!did && (!nm || nm === "—")) return "";
    return t("why.assistProblemPrompt", {
      id: did || nm,
      name: nm,
      node: nodeName,
      entity: entityPart,
    });
  };

  // Botón principal: con el nodo en advertencia/error, SIEMPRE (también con el
  // análisis con IA encendido). Antes se ocultaba con Davis CoPilot activo («un
  // solo analista por modo»), pero el cliente usa Assist a diario y en esos
  // mapas no lo veía: desde oct-2026 conviven Assist, CoPilot y la causa raíz.
  // (En v0.7.0 se retiró por error y se restauró en v0.7.1; no volver a quitarlo.)
  const assistBtn = assistPrompt ? (
    <button
      type="button"
      className="mapa-why-assist"
      onClick={() => askAssist(assistPrompt)}
      title={t("why.assistBtnTitle")}
    >
      <AiIcon size={16} />
      <span>{t("why.assistBtn")}</span>
    </button>
  ) : null;

  const footer = <Button onClick={onClose}>{t("common.close")}</Button>;

  // Bloque de "Investigar a fondo", compartido por las dos tarjetas honestas.
  const deepBlock = (
    <>
      {deep.status === "off" && (
        <Button onClick={startDeep}>{t("why.deepBtn")}</Button>
      )}
      {(deep.status === "gen" || deep.status === "run" || deep.status === "explain") && (
        <p className="mapa-why-msg">
          {deep.status === "gen"
            ? t("why.deepGenerating")
            : deep.status === "run"
              ? t("why.deepRunning")
              : t("why.deepExplaining")}
        </p>
      )}
      {deep.status === "done" && (
        <div className="mapa-why-ai" style={{ marginTop: 4 }}>
          <div className="mapa-why-ai-head">
            <AiIcon size={16} />
            <span>{t("why.aiTitle")}</span>
          </div>
          <div className="mapa-why-ai-text">
            <Markdown>{deep.text}</Markdown>
          </div>
          <div className="mapa-why-ai-note">{t("why.deepNote")}</div>
        </div>
      )}
      {deep.status === "noresults" && (
        <p className="mapa-why-msg">{t("why.deepNoResults")}</p>
      )}
      {deep.status === "error" && (
        <div className="mapa-why-ai-errwrap">
          <p className="mapa-why-msg mapa-why-errmsg">{t("why.deepError", { msg: deep.msg })}</p>
          <Button onClick={startDeep}>{t("why.aiRetry")}</Button>
        </div>
      )}
    </>
  );

  return (
    <Modal
      title={nodeName || t("why.title")}
      show={open}
      size="medium"
      onDismiss={onClose}
      footer={footer}
    >
      {connRuleActive ? (
        // ── Rojo por la REGLA de salud de conexiones ─────────────────────────
        // Explicación determinística con los datos ya calculados por el mapa:
        // aquí NO se consulta Grail, NO se llama a Davis ni al CoPilot.
        <Flex flexDirection="column" gap={16}>
          <div className="mapa-why-verdict">
            <span className="mapa-why-dot" style={{ background: SEV_COLOR["2"] }} />
            <span className="mapa-why-verdict-text">{t("why.connVerdict")}</span>
          </div>
          <div className="mapa-why-card">
            <div className="mapa-why-card-head">
              <WorkflowSimpleIcon size={16} />
              <span>{t("why.connRuleTitle")}</span>
            </div>
            <p className="mapa-why-msg">
              {t("why.connRuleText", {
                pct: String(connRule.pct),
                threshold: String(connRule.threshold),
                bad: String(connRule.bad),
                total: String(connRule.total),
              })}
            </p>
          </div>
          {entity && (
            <button type="button" className="mapa-why-entity-link" onClick={() => openEntity(entity)}>
              <ExternalLinkIcon size={14} />
              <span>{t("why.openEntity")}</span>
            </button>
          )}
          {assistBtn}
        </Flex>
      ) : !isDavisSourced && dql.length === 0 ? (
        <p className="mapa-why-msg">{t("why.noDql")}</p>
      ) : (isDavisSourced ? davisQ.isLoading : isLoading) ? (
        <p className="mapa-why-msg">{t("why.loading")}</p>
      ) : (isDavisSourced ? davisQ.error : error) ? (
        <p className="mapa-why-msg mapa-why-errmsg">
          {t("why.error", {
            msg: ((isDavisSourced ? davisQ.error : error) as { message?: string }).message ?? "",
          })}
        </p>
      ) : (
        <Flex flexDirection="column" gap={16}>
          {/* Veredicto */}
          <div className="mapa-why-verdict">
            <span className="mapa-why-dot" style={{ background: SEV_COLOR[effectiveSevStr] }} />
            <span className="mapa-why-verdict-text">{verdict}</span>
          </div>

          {/* Caja IA (cuando hay evidencia y se llamó al recommender). Solo si el
              análisis con IA está ENCENDIDO en los ajustes del mapa. */}
          {aiOn &&
            deciding &&
            isFailing &&
            (ai.status === "loading" || ai.status === "done" || ai.status === "error") && (
              <div className="mapa-why-ai">
                <div className="mapa-why-ai-head">
                  <AiIcon size={16} />
                  <span>{t("why.aiTitle")}</span>
                  <span className="mapa-why-ai-spacer" />
                  {(ai.status === "done" || ai.status === "error") && (
                    <button
                      type="button"
                      className="mapa-why-refresh"
                      onClick={refreshAi}
                      title={t("why.aiRefresh")}
                      aria-label={t("why.aiRefresh")}
                    >
                      <RefreshIcon size={13} />
                    </button>
                  )}
                </div>
                {ai.status === "loading" && (
                  <p className="mapa-why-msg mapa-why-ai-loading">{t("why.aiLoading")}</p>
                )}
                {ai.status === "done" &&
                  (ai.text.trim() ? (
                    <div className="mapa-why-ai-text">
                      <Markdown>{ai.text}</Markdown>
                    </div>
                  ) : (
                    <p className="mapa-why-msg">{t("why.aiEmpty")}</p>
                  ))}
                {ai.status === "error" && (
                  <div className="mapa-why-ai-errwrap">
                    <p className="mapa-why-msg mapa-why-errmsg">{t("why.aiError", { msg: ai.msg })}</p>
                    <Button onClick={refreshAi}>{t("why.aiRetry")}</Button>
                  </div>
                )}
                {ai.status === "done" && (
                  <div className="mapa-why-ai-age">
                    {t("why.aiUpdatedAgo", {
                      secs: Math.max(0, Math.round((Date.now() - ai.at) / 1000)),
                    })}
                  </div>
                )}
                <div className="mapa-why-ai-note">{t("why.aiNote")}</div>
              </div>
            )}

          {/* Tarjetas HONESTAS (sin evidencia → sin IA) + investigación a fondo.
              Todo este bloque pertenece al análisis con IA: si está apagado en
              los ajustes del mapa, ni siquiera se evalúa (los efectos de arriba
              dejan `ai.status` en "idle"). */}
          {aiOn && deciding && isFailing && (ai.status === "declared" || ai.status === "none") && (
            <div className="mapa-why-card">
              <div className="mapa-why-card-head">
                <UnavailableIcon size={16} />
                <span>
                  {ai.status === "declared"
                    ? t("why.declaredCard", { sev: sevWord })
                    : t("why.noneCard")}
                </span>
              </div>
              {/* "Investigar a fondo" (nl2dql) solo aplica a nodos con DQL propio:
                  un nodo atado a Davis no tiene consulta sobre la que investigar,
                  ya se muestran sus problemas reales abajo. */}
              {ai.status === "none" && !isDavisSourced && deepBlock}
            </div>
          )}

          {/* Problemas de Davis activos detectados (evidencia determinística) */}
          {isFailing && effectiveProblems.length > 0 && (
            <div>
              <div className="mapa-why-sectitle">
                {t("why.problemsTitle")} ({problemsCountLabel})
              </div>
              <div className="mapa-why-problems">
                {effectiveProblems.map((p, i) => {
                  const link = problemLink(p["event.id"]);
                  const did = typeof p["display_id"] === "string" ? p["display_id"] : "";
                  const inner = (
                    <>
                      {did && <span className="mapa-why-problem-id">{did}</span>}
                      <span className="mapa-why-problem-name">{fmtVal(p["event.name"])}</span>
                      {p["event.category"] != null && (
                        <span className="mapa-why-problem-cat">{fmtVal(p["event.category"])}</span>
                      )}
                      {link && <ExternalLinkIcon size={14} />}
                    </>
                  );
                  // Con event.id → fila CLICKEABLE que abre el problema en Dynatrace
                  // (pestaña nueva, para no perder el mapa). Sin id → fila plana.
                  // Al lado, un botón pequeño que abre Dynatrace Assist preguntando
                  // SOLO por este problema (va FUERA del enlace: un <a> dentro de
                  // otro <a> no es HTML válido).
                  // El ✨ por problema sigue la misma regla que el botón grande:
                  // siempre visible.
                  const askPrompt = problemAssistPrompt(p); // ✨ siempre, con o sin CoPilot
                  // Papel del problema según el último análisis de causa raíz del mapa.
                  const eid = String(p["event.id"] ?? "");
                  const role = rcRoles.get(eid);
                  return (
                    <div key={i} className="mapa-why-problem-row">
                      {link ? (
                        <a
                          className="mapa-why-problem mapa-why-problem-link"
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={t("why.problemOpen")}
                        >
                          {inner}
                        </a>
                      ) : (
                        <div className="mapa-why-problem">{inner}</div>
                      )}
                      {role && (
                        <button
                          type="button"
                          className={`mapa-why-rcchip${role.kind === "root" ? " mapa-why-rcchip-root" : ""}`}
                          title={t("why.rcTip")}
                          onClick={() => {
                            onClose();
                            if (node) pop.onRootCause(role.n, node.id);
                          }}
                        >
                          {role.kind === "root" ? t("why.rcRoot", { n: role.n }) : t("why.rcEffect", { n: role.n })}
                        </button>
                      )}
                      {askPrompt && (
                        <button
                          type="button"
                          className="mapa-why-assist-mini"
                          onClick={() => askAssist(askPrompt)}
                          title={t("why.assistProblemBtn")}
                          aria-label={t("why.assistProblemBtn")}
                        >
                          <AiIcon size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!isDavisSourced && (
            <details className="mapa-why-details">
              <summary>{t("why.queryLabel")}</summary>
              <pre className="mapa-why-dql">{dql}</pre>
            </details>
          )}

          {/* Cierre de la burbuja: las acciones en UNA fila — Assist (primario,
              lleva TODO el contexto; solo con el nodo en advertencia/error y
              sin depender del ajuste de IA) + abrir la entidad en Dynatrace. */}
          {((isFailing && (assistBtn || (rcCanRun && !rcHasAnalysis && onRunRootCause))) || (isDavisSourced && entity)) && (
            <div className="mapa-why-actions">
              {isFailing && assistBtn}
              {isFailing && rcCanRun && !rcHasAnalysis && onRunRootCause && (
                <button
                  type="button"
                  className="mapa-why-assist"
                  onClick={() => {
                    onClose();
                    onRunRootCause();
                  }}
                >
                  <AiIcon size={16} />
                  <span>{t("why.rcRun")}</span>
                </button>
              )}
              {isDavisSourced && entity && (
                <button type="button" className="mapa-linebtn" onClick={() => openEntity(entity)}>
                  <ExternalLinkIcon size={14} />
                  <span>{t("why.openEntity")}</span>
                </button>
              )}
            </div>
          )}
          {assistNote && (
            <div className="mapa-why-assistnote">
              {t(assistNote === "copied" ? "why.assistCopied" : "why.assistCopyFailed")}
            </div>
          )}
        </Flex>
      )}
    </Modal>
  );
};
