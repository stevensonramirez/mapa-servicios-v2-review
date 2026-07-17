// ── Validación ESTRICTA del contenido de un mapa ─────────────────────────────
// Un mapa solo se abre o se importa si tiene EXACTAMENTE el formato que escribe
// esta app. No se repara ni se tolera nada: un JSON armado por fuera (con un
// script, a mano) que no cumpla el formato no sirve, y el usuario ve un aviso
// claro con UNA línea de motivo (sin diagnóstico técnico, a propósito: no se
// quiere incentivar que armen mapas por fuera de la app).
// Caso que lo motivó (28-oct-2026): un JSON generado por script traía
// `settings.rootCause: false` y la app entera caía al abrir el mapa.

export type InvalidCode = "notMap" | "badNode" | "badNodeType" | "badEdge" | "badSetting";
export type InvalidMap = { code: InvalidCode; detail?: string };

const NODE_TYPES = new Set(["severity", "label", "group", "image"]);
const STATUS_SOURCES = new Set(["davis", "dql", "map"]);
const BRAND_STYLES = new Set(["color", "mono"]);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const optType = (v: unknown, t: "string" | "number" | "boolean") => v === undefined || typeof v === t;
const optArr = (v: unknown) => v === undefined || Array.isArray(v);
const optObjWithId = (v: unknown) => v === undefined || (isObj(v) && typeof v.id === "string");

// Campos de los nodos que la app lee con operaciones de texto o de lista: si
// vienen con otro tipo, el mapa no es de esta app.
const severityDataOk = (d: Record<string, unknown>): boolean =>
  optType(d.name, "string") &&
  optType(d.kind, "string") &&
  optType(d.dql, "string") &&
  optType(d.note, "string") &&
  optType(d.url, "string") &&
  optType(d.icon, "string") &&
  (d.statusSource === undefined || STATUS_SOURCES.has(String(d.statusSource))) &&
  optObjWithId(d.entity) &&
  optObjWithId(d.mapRef) &&
  optArr(d.links) &&
  optArr(d.mapRules);

const settingsBad = (s: unknown): string | null => {
  if (s === undefined) return null;
  if (!isObj(s)) return "settings";
  if (s.brandIconStyle !== undefined && !BRAND_STYLES.has(String(s.brandIconStyle))) return "brandIconStyle";
  if (s.refreshIntervalMs !== undefined && !isNum(s.refreshIntervalMs)) return "refreshIntervalMs";
  if (s.parentRefreshMs !== undefined && !isNum(s.parentRefreshMs)) return "parentRefreshMs";
  if (s.glow !== undefined && !isObj(s.glow)) return "glow";
  for (const k of ["showQueryCost", "aiInsights", "copilotOff"]) if (!optType(s[k], "boolean")) return k;
  if (!optType(s.assistPrompt, "string")) return "assistPrompt";
  // El análisis de causa raíz solo lo escribe la app: o no viene, o es un análisis.
  const rc = s.rootCause;
  if (rc !== undefined && !(isObj(rc) && Array.isArray(rc.causes) && Array.isArray(rc.unclassified) && typeof rc.at === "string")) {
    return "rootCause";
  }
  return null;
};

// null = válido. Si no, el PRIMER problema encontrado (una sola línea de motivo).
export const validateMapContent = (v: unknown): InvalidMap | null => {
  if (!isObj(v) || !Array.isArray(v.nodes) || !Array.isArray(v.edges)) return { code: "notMap" };
  if (v.mapType !== undefined && v.mapType !== "parent") return { code: "badSetting", detail: "mapType" };

  const ids = new Set<string>();
  const groups = new Set<string>();
  for (const n of v.nodes) {
    if (!isObj(n) || typeof n.id !== "string" || !n.id || ids.has(n.id)) return { code: "badNode" };
    if (!NODE_TYPES.has(String(n.type))) return { code: "badNodeType", detail: String(n.type) };
    ids.add(n.id);
    if (n.type === "group") groups.add(n.id);
  }
  for (const n of v.nodes as Array<Record<string, unknown>>) {
    const p = n.position;
    if (!isObj(p) || !isNum(p.x) || !isNum(p.y)) return { code: "badNode" };
    if (!isObj(n.data)) return { code: "badNode" };
    if (n.parentId !== undefined && !(typeof n.parentId === "string" && groups.has(n.parentId))) return { code: "badNode" };
    if ((n.width !== undefined && !isNum(n.width)) || (n.height !== undefined && !isNum(n.height))) return { code: "badNode" };
    const d = n.data as Record<string, unknown>;
    if (n.type === "severity" && !severityDataOk(d)) return { code: "badNode" };
    if (n.type === "label" && !(optType(d.text, "string") && optType(d.size, "number"))) return { code: "badNode" };
    if (n.type === "image" && !(typeof d.src === "string" && /^data:image\/[a-z.+-]+;base64,/i.test(d.src))) {
      return { code: "badNode" };
    }
  }

  const edgeIds = new Set<string>();
  for (const e of v.edges) {
    if (!isObj(e) || typeof e.id !== "string" || !e.id || edgeIds.has(e.id)) return { code: "badEdge" };
    edgeIds.add(e.id);
    if (typeof e.source !== "string" || typeof e.target !== "string" || !ids.has(e.source) || !ids.has(e.target)) {
      return { code: "badEdge" };
    }
    if (e.data !== undefined && !(isObj(e.data) && optType(e.data.dql, "string"))) return { code: "badEdge" };
  }

  const bad = settingsBad(v.settings);
  return bad ? { code: "badSetting", detail: bad } : null;
};
