import { publicClient } from "@dynatrace-sdk/client-davis-copilot";
import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";

// Análisis en lenguaje natural de la causa del estado de un nodo, vía la IA de
// Dynatrace (Davis CoPilot — Generative AI API, en preview). La skill `conversations`
// NO es agéntica: solo razona sobre lo que le damos (confirmado con la doc). El
// Assist multi-agéntico (que corre sus propias queries) NO es invocable desde una
// app. Por eso ENRIQUECEMOS el contexto nosotros: además del DQL del nodo y sus
// filas, le pasamos los PROBLEMAS DE DAVIS activos de las entidades involucradas
// (los traemos con una query aparte). Así CoPilot ve "Pod Eviction / OOMKill / …"
// en vez de un escueto `status=2`. Scope: davis-copilot:conversations:execute.

export type CopilotSource = { title?: string; url?: string };
export type CopilotResult = { text: string; sources: CopilotSource[] };

// ── Detección de entidades para enriquecer ───────────────────────────────────
// Id de entidad Dynatrace: PREFIJO-16HEX (p. ej. CLOUD_APPLICATION-FEEA872A70BD9F9F,
// HOST-..., SERVICE-...). Lo buscamos tanto en el TEXTO del DQL (el usuario suele
// filtrar por el id) como en los VALORES de las filas devueltas.
const ENTITY_RE = /[A-Z][A-Z0-9_]*-[0-9A-F]{16}/g;
const ENTITY_EXACT = /^[A-Z][A-Z0-9_]*-[0-9A-F]{16}$/;

export const collectEntityIds = (
  dql: string,
  records: Array<Record<string, unknown>>,
): string[] => {
  const ids = new Set<string>();
  const scan = (s: string) => {
    const m = s.match(ENTITY_RE);
    if (m) for (const x of m) ids.add(x);
  };
  scan(dql);
  for (const r of records.slice(0, 50)) {
    for (const v of Object.values(r)) {
      if (typeof v === "string") scan(v);
      else if (Array.isArray(v)) for (const x of v) if (typeof x === "string") scan(x);
    }
  }
  return [...ids].slice(0, 10);
};

// ── Filtros por TAG de entidad (entity_tags) ─────────────────────────────────
// Caso real del cliente: el DQL del nodo filtra dt.davis.problems por
// `matchesValue(entity_tags, "...")` (o `matchesPhrase`) y no menciona ningún id de entidad (salvo,
// por accidente, en una línea comentada). En vez de depender de ese comentario,
// extraemos los filtros de tags del DQL VIGENTE (sin comentarios) y los
// reusamos en la consulta de problemas activos: la evidencia queda alineada
// 1:1 con la población que el DQL de estado está contando.

// Quita comentarios DQL (`// …` y `/* … */`) SIN tocar el interior de strings
// entre comillas dobles (una URL "https://…" dentro de un string no es un
// comentario). Escáner por caracteres con estado (string/bloque).
export const stripDqlComments = (dql: string): string => {
  let out = "";
  let inStr = false;
  let inBlock = false;
  for (let i = 0; i < dql.length; i++) {
    const c = dql[i];
    const next = dql[i + 1];
    if (inBlock) {
      if (c === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inStr) {
      out += c;
      if (c === "\\" && next !== undefined) {
        out += next;
        i++;
      } else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < dql.length && dql[i] !== "\n") i++;
      i--; // el \n lo procesa la vuelta normal del for
      continue;
    }
    if (c === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    out += c;
  }
  return out;
};

// String DQL "seguro": el grupo (?:[^"\\]|\\.)* garantiza que adentro no hay
// comillas sin escapar → re-embeberlo entre comillas no puede romper/inyectar.
const DQL_STR = `"((?:[^"\\\\]|\\\\.)*)"`;
// Campos del DQL del nodo cuyas condiciones se reusan para identificar la
// población de problemas: tags de entidad Y TAMBIÉN event.name/event.category/
// event.description y k8s.namespace.name (pedidos del cliente: sus DQL filtran
// por nombre/categoría/descripción del problema y, en los problemas de pods,
// por el namespace de Kubernetes).
const COND_FIELDS = `(entity_tags|event\\.name|event\\.category|event\\.description|k8s\\.namespace\\.name)`;
const TAG_MATCHES_RE = new RegExp(
  `(matchesValue|matchesPhrase)\\(\\s*${COND_FIELDS}\\s*,\\s*${DQL_STR}\\s*\\)`,
  "g",
);
const TAG_IN_RE = new RegExp(`in\\(\\s*${COND_FIELDS}\\s*,\\s*\\{([^}]*)\\}\\s*\\)`, "g");
// Igualdad directa (`event.name == "..."`, `k8s.namespace.name == "..."`, etc.),
// muy común en los DQL del cliente. entity_tags es array: ahí == no aplica.
const EQ_RE = new RegExp(
  `(event\\.name|event\\.category|event\\.description|k8s\\.namespace\\.name)\\s*==\\s*${DQL_STR}`,
  "g",
);
const TAG_STR_RE = new RegExp(DQL_STR, "g");

// Divide el DQL (ya sin comentarios) en etapas del pipeline por `|`, sin partir
// dentro de strings (un "|" dentro de comillas no separa etapas).
const splitStages = (dql: string): string[] => {
  const stages: string[] = [];
  let cur = "";
  let inStr = false;
  for (let i = 0; i < dql.length; i++) {
    const c = dql[i];
    if (inStr) {
      cur += c;
      if (c === "\\" && dql[i + 1] !== undefined) {
        cur += dql[i + 1];
        i++;
      } else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      cur += c;
      continue;
    }
    if (c === "|") {
      stages.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  stages.push(cur);
  return stages;
};

// Condiciones DQL sobre entity_tags / event.name / event.category extraídas del
// DQL SIN comentarios, ya reconstruidas de partes validadas. Se procesan POR
// ETAPA del pipeline: dentro de una misma etapa se respeta el conector real —
// si aparece un `or` van en OR (era el bug: unir en AND dos tags alternativos
// no matchea ningún problema); si no, AND (los `| filter` encadenados clásicos).
// Etapas distintas entre sí = AND. Con lógica mixta and/or en una etapa se opta
// por OR: la evidencia puede traer de más pero nunca dejar por fuera el problema.
// Tope de 8 grupos por sanidad.
export const collectTagConditions = (dql: string): string[] => {
  const clean = stripDqlComments(dql);
  const groups: string[] = [];
  for (const stage of splitStages(clean)) {
    // SOLO etapas `filter` (`\b` deja por fuera `filterOut`, cuyas condiciones van
    // negadas). Antes se leían también `fieldsAdd status = if(event.category == …)`
    // y `summarize … countIf(…)`, que NO filtran: la lista terminaba trayendo todos
    // los problemas del tenant en esas categorías.
    if (!/^\s*filter\b/i.test(stage)) continue;
    const conds: string[] = [];
    for (const m of stage.matchAll(TAG_MATCHES_RE)) {
      conds.push(`${m[1]}(${m[2]}, "${m[3]}")`);
    }
    for (const m of stage.matchAll(TAG_IN_RE)) {
      const vals = [...m[2].matchAll(TAG_STR_RE)].map((s) => `"${s[1]}"`);
      if (vals.length) conds.push(`in(${m[1]}, { ${vals.join(", ")} })`);
    }
    for (const m of stage.matchAll(EQ_RE)) {
      conds.push(`${m[1]} == "${m[2]}"`);
    }
    const uniq = [...new Set(conds)].slice(0, 8);
    if (!uniq.length) continue;
    if (uniq.length === 1) {
      groups.push(uniq[0]);
      continue;
    }
    // El conector se detecta con los strings en blanco (un tag que contenga
    // " or " en su texto no debe cambiar la lógica).
    const blanked = stage.replace(TAG_STR_RE, '""');
    const conn = /\bor\b/i.test(blanked) ? "or" : "and";
    groups.push(`(${uniq.join(` ${conn} `)})`);
  }
  return [...new Set(groups)].slice(0, 8);
};

// Query (SOLO LECTURA) que trae los problemas de Davis ACTIVOS de esas entidades
// y/o de los tags extraídos del DQL del nodo. Los ids se validan contra el patrón
// exacto antes de embeberlos (anti-inyección); las condiciones de tag vienen ya
// reconstruidas por collectTagConditions. Ids y tags se combinan con OR (cada
// camino aporta su evidencia); los grupos de tags (uno por etapa del pipeline,
// con su conector or/and interno ya resuelto) van en AND entre sí.
// "" si no hay ni ids ni tags → no se consulta.
// Tope de filas de la lista del modal (y del contexto de CoPilot). Si la lista
// llega al tope, el modal cuenta el total real con buildActiveProblemsCountQuery.
export const ACTIVE_PROBLEMS_LIMIT = 12;

// Base común (fuente + filtros) de la lista y del conteo. Excluye los problemas
// DUPLICADOS: Davis abre problemas individuales y luego los FUSIONA en uno (p. ej.
// "Multiple service problems"), dejando los individuales vivos un rato con
// `dt.davis.is_duplicate = true`. No son problemas aparte (verificado en vivo:
// sus eventos están contenidos en el problema principal). Se usa `isNull(...) or
// == false` y no `not(...)`: en DQL un null en el filtro descarta la fila.
const activeProblemsBase = (entityIds: string[], tagConditions: string[] = []): string => {
  const safe = entityIds.filter((id) => ENTITY_EXACT.test(id));
  const tagCond = tagConditions.length ? tagConditions.join(" and ") : "";
  if (!safe.length && !tagCond) return "";
  const list = safe.map((id) => `"${id}"`).join(", ");
  const idsCond = safe.length ? `in(affected_entity_ids, { ${list} })` : "";
  const cond = idsCond && tagCond ? `(${idsCond}) or (${tagCond})` : idsCond || `(${tagCond})`;
  // Ventana de 2h: equilibra cobertura y footprint de Grail (validado: trae los
  // problemas activos típicos; 24h escanea ~4x más). Solo corre al abrir el (i).
  // `event.description` trae el DETALLE real del problema (la descripción que Davis
  // arma del síntoma, p. ej. eventos con razón BackOff en los pods) + el nombre del
  // workload → le da a CoPilot el desglose tipo Assist. Mismo costo (1 campo más).
  // `event.id` = UUID interno del problema → lo usamos para el deep-link a la
  // vista del problema (ver `problemLink`). `display_id` es el "P-..." legible.
  // Orden: del más GRAVE al menos grave, igual que el análisis de causa raíz:
  // severidad (sin severidad = SEV-3) → categoría (disponibilidad, error,
  // lentitud, recursos, resto) → más entidades afectadas → el más antiguo.
  return `fetch dt.davis.problems, from:now()-2h
| filter event.status == "ACTIVE"
| filter isNull(dt.davis.is_duplicate) or dt.davis.is_duplicate == false
| filter ${cond}`;
};

export const buildActiveProblemsQuery = (entityIds: string[], tagConditions: string[] = []): string => {
  const base = activeProblemsBase(entityIds, tagConditions);
  if (!base) return "";
  return `${base}
| fieldsAdd mapa_afectadas = arraySize(affected_entity_ids)
| fieldsAdd mapa_cat = if(event.category == "AVAILABILITY", 0, else: if(event.category == "ERROR", 1, else: if(event.category == "SLOWDOWN", 2, else: if(event.category == "RESOURCE_CONTENTION", 3, else: 4))))
| fieldsAdd mapa_sev = coalesce(event.severity, 3)
| sort mapa_sev asc, mapa_cat asc, mapa_afectadas desc, event.start asc
| fields display_id, event.id, event.name, event.description, event.category, root_cause_entity_name, event.start
| limit ${ACTIVE_PROBLEMS_LIMIT}`;
};

// ── Lista acotada al DQL del nodo ─────────────────────────────────────────────
// Si el DQL del nodo CONSULTA problemas de Davis (`fetch dt.davis.problems…`), la
// lista sale de ESE MISMO DQL. Caso real del cliente: sus DQL filtran problemas,
// agregan `status`, hacen `append [data record(status = 0)]` y `summarize` (con lo
// que se pierde el event.id). Por eso se toma la POBLACIÓN de problemas: el DQL
// hasta ANTES de la primera etapa que agrega filas o colapsa/proyecta campos
// (summarize, append, fields, fieldsKeep, fieldsRemove, makeTimeseries). Sobre
// esa población: filas con event.id, sin duplicados de Davis y una fila por
// problema (`dedup`). Las etapas se cortan solo en `|` de nivel superior (no
// dentro de strings, [ ], ( ) ni { }), porque `append [ … | … ]` lleva pipes.
const DAVIS_PROBLEMS_SOURCE_RE = /^\s*fetch\s+dt\.davis\.problems\b/i;
// Se corta SOLO en etapas que cambian las FILAS. Las que solo proyectan columnas
// (fields, fieldsKeep, fieldsRemove) NO se cortan: se saltan, porque muchos DQL
// del equipo ponen `| fields …` ANTES del filtro real (p. ej. `fields event.name,
// … | filter matchesPhrase(event.name, "RabbitMQ")`). Cortar ahí perdía el
// filtro y el nodo se quedaba con TODOS los problemas del ambiente (21-oct,
// IM - Canal_Negocios: Rabbit MQ, Redis y DynamoDB con las 22 causas encima).
const POPULATION_CUT_RE = /^\s*(summarize|append|makeTimeseries)\b/i;
const PROJECTION_RE = /^\s*(fields|fieldsKeep|fieldsRemove)\b/i;
// Ítems de nivel superior de una etapa (separados por comas fuera de ( ) [ ] { } y strings).
const splitTopLevelItems = (s: string): string[] => {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      cur += c;
      if (c === "\\" && s[i + 1] !== undefined) {
        cur += s[i + 1];
        i++;
      } else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if ((c === ")" || c === "]" || c === "}") && depth > 0) depth--;
    else if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
};
// Una etapa de proyección se SALTA; si `fields` define alias calculados
// (`fields x = …`), esos alias se conservan como `fieldsAdd` por si un filtro
// posterior los usa. Devuelve null cuando la etapa se descarta entera.
const keepProjection = (stage: string): string | null => {
  const m = /^\s*fields\b([\s\S]*)$/i.exec(stage);
  if (!m || /^\s*fields(Keep|Remove)\b/i.test(stage)) return null;
  const aliases = splitTopLevelItems(m[1]).filter((it) => /^[A-Za-z_][\w.]*\s*=(?!=)/.test(it));
  return aliases.length ? `fieldsAdd ${aliases.join(", ")}` : null;
};

const splitTopLevelStages = (dql: string): string[] => {
  const stages: string[] = [];
  let cur = "";
  let inStr = false;
  let depth = 0;
  for (let i = 0; i < dql.length; i++) {
    const c = dql[i];
    if (inStr) {
      cur += c;
      if (c === "\\" && dql[i + 1] !== undefined) {
        cur += dql[i + 1];
        i++;
      } else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "[" || c === "(" || c === "{") depth++;
    else if ((c === "]" || c === ")" || c === "}") && depth > 0) depth--;
    else if (c === "|" && depth === 0) {
      stages.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  stages.push(cur);
  return stages;
};

// Población de problemas del DQL del nodo ("" si el DQL no consulta dt.davis.problems).
export const nodeProblemsPopulation = (dql: string): string => {
  const clean = stripDqlComments(dql).trim();
  if (!DAVIS_PROBLEMS_SOURCE_RE.test(clean)) return "";
  const stages = splitTopLevelStages(clean);
  const cut = stages.findIndex((st, i) => i > 0 && POPULATION_CUT_RE.test(st));
  const kept = (cut === -1 ? stages : stages.slice(0, cut))
    .map((st, i) => (i > 0 && PROJECTION_RE.test(st) ? keepProjection(st) : st))
    .filter((st): st is string => st !== null)
    .map((st) => st.trim())
    .filter(Boolean);
  return kept.join("\n| ");
};

// Solo para el análisis de causa raíz: amplía el filtro de estado del DQL del
// nodo («solo activos») a «activos o cerrados hace menos de N minutos». Cubre las
// dos formas que usan los mapas: `event.status == "ACTIVE"` y
// `event.status != "CLOSED"`. La burbuja NO lo usa: sigue mostrando solo activos.
export const widenActiveFilter = (pop: string, closedWithinMin: number): string =>
  pop
    .replace(
      /event\.status\s*==\s*"ACTIVE"/g,
      `(event.status == "ACTIVE" or (event.status == "CLOSED" and event.end >= now() - ${closedWithinMin}m))`,
    )
    .replace(/event\.status\s*!=\s*"CLOSED"/g, `(event.status != "CLOSED" or event.end >= now() - ${closedWithinMin}m)`);

const nodeProblemsBase = (dql: string, closedWithinMin?: number): string => {
  const pop0 = nodeProblemsPopulation(dql);
  if (!pop0) return "";
  const pop = closedWithinMin ? widenActiveFilter(pop0, closedWithinMin) : pop0;
  return `${pop}
| filter isNotNull(event.id)
| filter isNull(dt.davis.is_duplicate) or dt.davis.is_duplicate == false`;
};

export const buildNodeProblemsQuery = (dql: string): string => {
  const base = nodeProblemsBase(dql);
  if (!base) return "";
  return `${base}
| dedup event.id
| fieldsAdd mapa_afectadas = arraySize(affected_entity_ids)
| fieldsAdd mapa_cat = if(event.category == "AVAILABILITY", 0, else: if(event.category == "ERROR", 1, else: if(event.category == "SLOWDOWN", 2, else: if(event.category == "RESOURCE_CONTENTION", 3, else: 4))))
| fieldsAdd mapa_sev = coalesce(event.severity, 3)
| sort mapa_sev asc, mapa_cat asc, mapa_afectadas desc, event.start asc
| fields display_id, event.id, event.name, event.description, event.category, root_cause_entity_name, event.start
| limit ${ACTIVE_PROBLEMS_LIMIT}`;
};

// Solo los event.id de la población (para el análisis de causa raíz). Con
// `closedWithinMin`, también los cerrados hace menos de esos minutos.
export const buildNodeProblemIdsQuery = (dql: string, limit = 50, closedWithinMin?: number): string => {
  const base = nodeProblemsBase(dql, closedWithinMin);
  if (!base) return "";
  return `${base}
| dedup event.id
| fields event.id
| limit ${limit}`;
};

export const buildNodeProblemsCountQuery = (dql: string): string => {
  const base = nodeProblemsBase(dql);
  if (!base) return "";
  return `${base}
| summarize total = countDistinctExact(event.id)`;
};

// Total real de problemas activos (misma base que la lista). Solo se ejecuta
// cuando la lista llegó al tope, para el contador "N, mostrando 12".
export const buildActiveProblemsCountQuery = (entityIds: string[], tagConditions: string[] = []): string => {
  const base = activeProblemsBase(entityIds, tagConditions);
  if (!base) return "";
  return `${base}
| summarize total = countDistinctExact(event.id)`;
};

// Deep-link a la vista de UN problema en la app nativa "Problems" de Dynatrace.
// URL DIRECTA (el intent no enrutaba a la vista del problema). Formato real
// (verificado por el usuario con un link en vivo):
//   {envUrl}/ui/apps/dynatrace.davis.problems/problem/{event.id}?from=now()-2h&to=now()
// `event.id` = UUID interno del problema (NO el display_id "P-…"); va tal cual en
// la ruta. La base la da `getEnvironmentUrl()` (la app corre en iframe sandbox →
// una ruta relativa apuntaría al origen equivocado). "" si no hay event.id.
export const problemLink = (eventId: unknown): string => {
  if (typeof eventId !== "string" || !eventId.trim()) return "";
  const base = getEnvironmentUrl().replace(/\/+$/, "");
  const qs = new URLSearchParams({ from: "now()-2h", to: "now()" }).toString();
  return `${base}/ui/apps/dynatrace.davis.problems/problem/${encodeURIComponent(eventId.trim())}?${qs}`;
};

// ── Status declarado (literal) ───────────────────────────────────────────────
// ¿El DQL fija el `status` a un número literal (p. ej. `fieldsAdd status = 2`) en
// vez de derivarlo de los datos (`status = if(...)`)? Si es así, el estado es
// DECLARADO: no hay una causa que extraer de los datos.
export const isDeclaredStatus = (dql: string): boolean =>
  /\bstatus\s*=\s*\d+\s*(\||\n|$)/i.test(dql);

// ── Recuperación de evidencia ────────────────────────────────────────────────
// Quita la agregación final del DQL del nodo (`summarize`/`makeTimeseries`/la
// proyección a `status`) y re-corre el "cuerpo" (`fetch ... | filter ...`) con un
// limit, para recuperar los REGISTROS CRUDOS que dispararon el estado (las líneas
// de log/eventos reales). "" si no aplica (no es un `fetch` de registros, p. ej.
// timeseries/metric/load/data). Heurística best-effort: con DQL muy complejos
// (subconsultas, varios summarize) puede no recuperar lo ideal → se cae a "".
export const buildEvidenceQuery = (dql: string): string => {
  const trimmed = dql.trim();
  const m = /^fetch\s+([a-z0-9_.]+)/i.exec(trimmed);
  if (!m) return ""; // timeseries / load / data → sin registros de detalle
  if (m[1].toLowerCase() === "metric") return ""; // métricas: sin "filas" de detalle
  const markers = /\|\s*(summarize|makeTimeseries|fieldsAdd\s+status\b|fields\s+status\b)/i;
  const idx = trimmed.search(markers);
  let body = (idx >= 0 ? trimmed.slice(0, idx) : trimmed).trim();
  body = body.replace(/\|\s*limit\s+\d+\s*$/i, "").trim(); // quita un limit final
  if (!body || !/^fetch\b/i.test(body)) return "";
  return `${body}\n| limit 20`;
};

// ── Investigación a fondo (nl2dql) ───────────────────────────────────────────
// Pide a la IA (skill nl2dql) que GENERE una consulta de investigación a partir
// de lenguaje natural. La app la ejecuta aparte (solo lectura) y luego pasa los
// resultados al recommender. Scope: davis-copilot:nl2dql:execute. Experimental.
export const generateInvestigationDql = async (args: {
  prompt: string;
  abortSignal?: AbortSignal;
}): Promise<string> => {
  const res = await publicClient.nl2dql({ body: { text: args.prompt }, abortSignal: args.abortSignal });
  const dql = res.dql?.trim() ?? "";
  // status FAILED o sin DQL → surfaceamos el MOTIVO real (la skill lo reporta en
  // metadata.notifications) en vez de un escueto "nl2dql FAILED".
  if (res.status === "FAILED" || !dql) {
    const notes = (res.metadata?.notifications ?? [])
      .map((n) => n.message)
      .filter((m): m is string => typeof m === "string" && m.trim().length > 0)
      .join(" · ");
    throw new Error(notes ? `nl2dql: ${notes}` : "nl2dql FAILED");
  }
  return dql;
};

// ── Caché de respuestas (módulo) ─────────────────────────────────────────────
// La respuesta de la IA se cachea por (nodo + DQL). Si tiene menos de `maxAgeMs`,
// se reutiliza sin volver a llamar (el usuario puede forzar refresco a mano).
type CacheEntry = { ts: number; result: CopilotResult };
const RESP_CACHE = new Map<string, CacheEntry>();

export const explainCacheKey = (nodeId: string, dql: string): string => `${nodeId}::${dql}`;

export const getCachedExplain = (key: string, maxAgeMs: number): CacheEntry | null => {
  const e = RESP_CACHE.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > maxAgeMs) return null;
  return e;
};

export const setCachedExplain = (key: string, result: CopilotResult): number => {
  const ts = Date.now();
  RESP_CACHE.set(key, { ts, result });
  return ts;
};

// La API de CoPilot a veces ANEXA un aviso ("Dynatrace Assist está oficialmente
// soportado solo en inglés…") cuando se le pide responder en otro idioma. No es
// parte del análisis → lo quitamos. Elimina el párrafo que menciona "Assist" junto
// con idioma/soporte (multilingüe), sin tocar el resto del texto.
const stripAssistDisclaimer = (text: string): string =>
  text
    .split(/\n{2,}/)
    .filter(
      (p) =>
        !(
          /\bassist\b/i.test(p) &&
          /(ingl[eé]s|english|anglais|englisch|soportad|support|prise en charge|unterst)/i.test(p)
        ),
    )
    .join("\n\n")
    .trim();

// ── Llamada a Davis CoPilot ──────────────────────────────────────────────────
export const explainNodeStatus = async (args: {
  // Pregunta y directiva de salida (ya localizadas por el llamador).
  question: string;
  instruction: string;
  // Contexto del nodo y su consulta.
  nodeName: string;
  nodeKind: string;
  stateLabel: string;
  dql: string;
  records: Array<Record<string, unknown>>;
  // Problemas de Davis activos de las entidades involucradas (enriquecimiento).
  problems?: Array<Record<string, unknown>>;
  // Registros crudos recuperados (las filas que dispararon el estado: logs/eventos).
  detailRows?: Array<Record<string, unknown>>;
  abortSignal?: AbortSignal;
}): Promise<CopilotResult> => {
  const { question, instruction, nodeName, nodeKind, stateLabel, dql, records, problems, detailRows, abortSignal } =
    args;

  // Tope por CAMPO además del tope por filas: los registros crudos (logs con
  // stacktraces) pueden traer valores de decenas de KB → el body del
  // recommender se iba a cientos de KB. 500 chars por valor bastan para que
  // la IA entienda el contexto. Aplica también a arrays/objetos
  // (affected_entity_ids / entity_tags pueden traer decenas de entradas).
  const truncVal = (v: unknown): unknown => {
    if (typeof v === "string") return v.length > 500 ? `${v.slice(0, 500)}…` : v;
    if (v !== null && typeof v === "object") {
      const s = JSON.stringify(v) ?? "";
      return s.length > 500 ? `${s.slice(0, 500)}…` : v;
    }
    return v;
  };
  const truncRows = (rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
    rows.map((r) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, truncVal(v)])),
    );

  const sample = truncRows(records.slice(0, 20));
  // Etiquetas en inglés a propósito: es contexto técnico para el LLM (NO se muestra
  // al usuario). El idioma de la RESPUESTA lo fija `instruction`.
  // Nodo atado a Davis (sin DQL propio): el estado NO sale de una consulta, sale de
  // los problemas activos de la entidad — se lo aclaramos al modelo en vez de
  // mostrarle un bloque de "DQL" vacío/engañoso.
  const dqlBlock = dql
    ? `DQL query that evaluates the state (read-only):\n${dql}\n\n` +
      `Rows returned by the query (the first row determines the state):\n` +
      `${JSON.stringify(sample, null, 2)}\n\n` +
      `State contract: the "status" field means 0 = OK, 1 = warning, 2 or more = error.\n`
    : `State is derived directly from the active Davis problems for this entity (no custom query is involved) — use the problems list below as the sole source of truth for the root cause.\n`;
  const problemsBlock =
    problems && problems.length
      ? `\n\nActive Davis problems affecting the involved entities (fetched separately, authoritative — use these for the root cause):\n${JSON.stringify(
          truncRows(problems.slice(0, 25)),
          null,
          2,
        )}`
      : "";
  const detailBlock =
    detailRows && detailRows.length
      ? `\n\nSample of the underlying records that triggered the state (recovered by re-running the query without its final aggregation — these are the actual logs/events behind the status):\n${JSON.stringify(
          truncRows(detailRows.slice(0, 20)),
          null,
          2,
        )}`
      : "";
  // La API del recommender rechaza context values de más de 102.500 chars
  // (PAYLOAD_BODY constraint) → tope duro total, recortando por el final
  // (la evidencia menos crítica, detailBlock, es lo último).
  const CONTEXT_MAX = 100_000;
  const supplementaryFull =
    `Service/node name: ${nodeName}${nodeKind ? ` (${nodeKind})` : ""}\n` +
    `Current state: ${stateLabel}\n\n` +
    dqlBlock +
    problemsBlock +
    detailBlock;
  const supplementary =
    supplementaryFull.length > CONTEXT_MAX
      ? `${supplementaryFull.slice(0, CONTEXT_MAX)}\n…[evidence truncated]`
      : supplementaryFull;

  const res = await publicClient.recommenderConversation({
    abortSignal,
    body: {
      text: question,
      context: [
        { type: "supplementary", value: supplementary },
        { type: "instruction", value: instruction },
      ],
    },
  });

  // Respuesta sin streaming → ConversationResponse (objeto). El arreglo es el modo
  // de eventos (ndjson); lo manejamos por robustez tomando el evento "end".
  if (Array.isArray(res)) {
    const end = res.find(
      (e) => "event" in e && (e as { event?: string }).event === "end",
    ) as { data?: { answer?: string; sources?: CopilotSource[] } } | undefined;
    return { text: stripAssistDisclaimer(end?.data?.answer ?? ""), sources: end?.data?.sources ?? [] };
  }

  if (res.status === "FAILED") {
    throw new Error(res.text || "FAILED");
  }
  return { text: stripAssistDisclaimer(res.text), sources: res.metadata?.sources ?? [] };
};
