// ── Rol «Analista»: núcleo puro (sin SDK en tiempo de ejecución) ─────────────
// Analista = lector + causa raíz. Por debajo tiene permiso de EDICIÓN en el
// Document service (para poder guardar el análisis y que lo vean todos), pero la
// app lo trata como solo lectura: lo único que escribe es `settings.rootCause`.
//
// Quién es analista vive en las LABELS del documento (metadata, no contenido):
// así no lo pisan el «último que escribe gana» del guardado de un editor, el
// deshacer, duplicar ni descargar, y el listado lo trae sin consultas extra.
//   • Formato: «an:<sso-id>;<sso-id>» — dos personas por label (76 de los 80
//     caracteres permitidos). La plataforma admite 25 labels → 50 analistas.
//   • El dueño NUNCA es analista.
//
// Este archivo no importa nada en tiempo de ejecución: se prueba tal cual con
// `node --test tests/` (Node ≥ 23 corre TypeScript sin compilar). Por eso solo
// usa sintaxis de TypeScript «borrable» (nada de enum/namespace).

// Interruptor de la OPCIÓN «Analista» en Compartir. La protección del analista
// (solo lectura + causa raíz) queda SIEMPRE activa aunque esto esté apagado.
export const ANALYST_ROLE_ENABLED = true;

export const ANALYST_LABEL_PREFIX = "an:";
export const ANALYST_SEP = ";";
export const MAX_LABELS = 25;
export const MAX_LABEL_LEN = 80;
export const ANALYSTS_PER_LABEL = 2;
export const MAX_ANALYSTS = MAX_LABELS * ANALYSTS_PER_LABEL;

// Id SSO (uuid de 36): solo caracteres válidos en una label y sin el separador.
// El tope de 36 garantiza que dos ids empacados quepan en 80 caracteres.
const ID_RE = /^[A-Za-z0-9-]{1,36}$/;

export type AnalystLabelErrorCode = "tooMany" | "badId";
export class AnalystLabelError extends Error {
  code: AnalystLabelErrorCode;
  constructor(code: AnalystLabelErrorCode, message: string) {
    super(message);
    this.name = "AnalystLabelError";
    this.code = code;
  }
}

const isAnalystLabel = (l: unknown): l is string => typeof l === "string" && l.startsWith(ANALYST_LABEL_PREFIX);
const isPlainObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// Ids de analista que traen las labels (sin repetidos, en orden de aparición).
export function readAnalysts(labels: readonly unknown[] | null | undefined): string[] {
  const out: string[] = [];
  if (!Array.isArray(labels)) return out;
  for (const l of labels) {
    if (!isAnalystLabel(l)) continue;
    for (const raw of l.slice(ANALYST_LABEL_PREFIX.length).split(ANALYST_SEP)) {
      const id = raw.trim();
      if (id && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

// Labels nuevas con ESTOS analistas: conserva intactas (y en su orden) las labels
// ajenas y re-empaca las «an:» de a dos. Falla (sin escribir nada) si no cabe.
export function writeAnalysts(labels: readonly unknown[] | null | undefined, ids: readonly string[]): string[] {
  // Labels ajenas sin repetidas (el servidor rechaza duplicados con 400).
  const foreign: string[] = [];
  if (Array.isArray(labels)) {
    for (const l of labels) if (typeof l === "string" && !isAnalystLabel(l) && !foreign.includes(l)) foreign.push(l);
  }
  const uniq: string[] = [];
  for (const raw of ids) {
    const id = String(raw ?? "").trim();
    if (!id) continue;
    if (!ID_RE.test(id)) throw new AnalystLabelError("badId", `Id no válido para una label: ${id}`);
    if (!uniq.includes(id)) uniq.push(id);
  }
  const packed: string[] = [];
  for (let i = 0; i < uniq.length; i += ANALYSTS_PER_LABEL) {
    packed.push(ANALYST_LABEL_PREFIX + uniq.slice(i, i + ANALYSTS_PER_LABEL).join(ANALYST_SEP));
  }
  if (foreign.length + packed.length > MAX_LABELS) {
    throw new AnalystLabelError("tooMany", `Máximo ${MAX_LABELS} labels por documento`);
  }
  return [...foreign, ...packed];
}

// ¿Las labels ya están limpias? Sin repetidas, cada «an:» con 1 o 2 ids válidos,
// ningún id en dos labels y empacadas de a dos (como las deja siempre la app: así
// no se desperdicia capacidad del tope de 50).
const labelsClean = (labels: readonly unknown[]): boolean => {
  const seenLabels = new Set<string>();
  const seenIds = new Set<string>();
  let anCount = 0;
  for (const l of labels) {
    if (typeof l !== "string" || seenLabels.has(l)) return false;
    seenLabels.add(l);
    if (!isAnalystLabel(l)) continue;
    anCount++;
    const ids = l.slice(ANALYST_LABEL_PREFIX.length).split(ANALYST_SEP);
    if (ids.length > ANALYSTS_PER_LABEL) return false;
    for (const id of ids) {
      if (!ID_RE.test(id) || seenIds.has(id)) return false;
      seenIds.add(id);
    }
  }
  return anCount === Math.ceil(seenIds.size / ANALYSTS_PER_LABEL);
};

// Agrega (on=true) o quita (on=false) a UNA persona. Idempotente: si la persona
// ya está (o ya no está) y las labels están limpias, devuelve las MISMAS labels
// sin re-empacar — toda escritura sube la versión del documento, así que «sin
// cambios» debe ser «nada que escribir». Al re-empacar se descartan los ids mal
// formados que hubiera.
export function withAnalyst(labels: readonly unknown[] | null | undefined, uid: string, on: boolean): string[] {
  const id = String(uid ?? "").trim();
  const cur = readAnalysts(labels).filter((x) => ID_RE.test(x));
  if (cur.includes(id) === on && Array.isArray(labels) && labelsClean(labels)) return labels.map(String);
  const next = on ? (cur.includes(id) ? cur : [...cur, id]) : cur.filter((x) => x !== id);
  return writeAnalysts(labels, next);
}

// ¿Dos arreglos tienen las MISMAS labels? El Document service las devuelve
// ordenadas (orden ASCII, no el de escritura), así que se comparan como conjunto.
// Sirve para no escribir de más: toda escritura sube la versión del documento,
// aunque las labels no cambien (verificado en el tenant, 28-oct-2026).
export const sameLabels = (a: readonly unknown[] | null | undefined, b: readonly unknown[] | null | undefined): boolean => {
  const x = Array.isArray(a) ? a.map(String).sort() : [];
  const y = Array.isArray(b) ? b.map(String).sort() : [];
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

// ── Rol de la persona actual sobre un mapa ───────────────────────────────────
export type MapRole = "owner" | "editor" | "analyst" | "viewer";
export type RoleInput = {
  access?: readonly string[] | null;
  owner?: string | null;
  labels?: readonly unknown[] | null;
};

// Mismo criterio que la app desde siempre: si `access` no viene, se asume
// escribible (el guardado con 401/403 sigue de red).
export const hasWriteAccess = (access: unknown): boolean => !Array.isArray(access) || access.includes("write");

export function resolveRole(meta: RoleInput, me: string | null | undefined): MapRole {
  if (!hasWriteAccess(meta.access)) return "viewer";
  const uid = String(me ?? "").trim();
  if (uid && meta.owner === uid) return "owner";
  if (uid && readAnalysts(meta.labels).includes(uid)) return "analyst";
  return "editor";
}

// La app trata al analista como lector (todo bloqueado salvo la causa raíz).
export const isReadOnlyRole = (r: MapRole): boolean => r === "viewer" || r === "analyst";

// ── Cambios de rol al compartir ──────────────────────────────────────────────
// Estado de UNA persona frente a los 2 «cubos» de shares y las labels.
export type ShareLevel = "none" | "viewer" | "analyst" | "editor";
export const LEVEL_RANK: Record<ShareLevel, number> = { none: 0, viewer: 1, analyst: 2, editor: 3 };
export type ShareState = { inRead: boolean; inWrite: boolean; labeled: boolean };

// Nivel EFECTIVO: con edición, la label lo vuelve analista; sin edición, la
// label no da nada (una label vieja suelta es inofensiva).
export function effectiveLevel(s: ShareState): ShareLevel {
  if (s.inWrite) return s.labeled ? "analyst" : "editor";
  return s.inRead ? "viewer" : "none";
}

export type RoleOp = "addLabel" | "removeLabel" | "grantRead" | "grantWrite" | "removeRead" | "removeWrite";
export type RoleStep = { op: RoleOp; must: boolean };

// Pasos ORDENADOS para llevar a la persona de su estado actual al nivel pedido.
// Regla: al subir, primero lo que restringe (label) y luego el permiso; al bajar,
// primero se quita el permiso y luego la label. Así, si cualquier paso falla a
// mitad de camino, la persona nunca queda con más permisos que el origen o el
// destino. `must` = si falla, se para y se reporta; si no, se sigue (limpieza).
export function planRoleChange(cur: ShareState, to: ShareLevel): RoleStep[] {
  const steps: RoleStep[] = [];
  const add = (op: RoleOp, must: boolean, when: boolean) => {
    if (when) steps.push({ op, must });
  };
  switch (to) {
    case "none":
      add("removeWrite", true, cur.inWrite);
      add("removeRead", true, cur.inRead);
      add("removeLabel", false, cur.labeled);
      break;
    case "viewer":
      add("grantRead", true, !cur.inRead);
      add("removeWrite", true, cur.inWrite);
      add("removeLabel", false, cur.labeled);
      break;
    case "analyst":
      add("addLabel", true, !cur.labeled);
      add("grantWrite", true, !cur.inWrite);
      add("removeRead", false, cur.inRead);
      break;
    case "editor":
      add("removeLabel", true, cur.labeled);
      add("grantWrite", true, !cur.inWrite);
      add("removeRead", false, cur.inRead);
      break;
  }
  return steps;
}

// Estado de partida con el que Compartir planea un cambio: los cubos se tratan
// IGUAL QUE ANTES de existir el rol (siempre se concede el cubo pedido y siempre
// se intenta sacar del otro; las dos cosas son idempotentes) y la label sí se
// mira de verdad. Así, Solo lectura / Edición / Quitar hacen las mismas llamadas
// de siempre, más quitar la label solo si la persona la tiene.
export const shareStartState = (to: ShareLevel, labeled: boolean): ShareState => ({
  inRead: to !== "viewer",
  inWrite: to === "viewer" || to === "none",
  labeled,
});

export type RoleOps = Record<RoleOp, () => Promise<void>>;
export type RoleChangeResult =
  | { ok: true; skipped: RoleOp[] }
  | { ok: false; failedOp: RoleOp; error: unknown; skipped: RoleOp[] };

// Ejecuta los pasos en orden: un paso obligatorio que falla detiene todo; uno de
// limpieza que falla se anota en `skipped` y se sigue.
export async function runRoleChange(steps: readonly RoleStep[], ops: RoleOps): Promise<RoleChangeResult> {
  const skipped: RoleOp[] = [];
  for (const s of steps) {
    try {
      await ops[s.op]();
    } catch (error) {
      if (s.must) return { ok: false, failedOp: s.op, error, skipped };
      skipped.push(s.op);
    }
  }
  return { ok: true, skipped };
}

// ── Guardar el análisis siendo analista ──────────────────────────────────────
// Se parcha el JSON CRUDO del mapa: solo cambia `settings.rootCause`; todo lo
// demás (incluido el orden de las claves) queda tal cual estaba en el servidor.
export type RcPatch = { kind: "set"; analysis: unknown } | { kind: "clear"; executionId?: string };
export type PatchResult = { next: Record<string, unknown> } | { skip: "notMap" | "absent" | "newer" };

export function patchRootCause(raw: unknown, patch: RcPatch): PatchResult {
  if (!isPlainObj(raw)) return { skip: "notMap" };
  if (raw.settings !== undefined && !isPlainObj(raw.settings)) return { skip: "notMap" };
  const settings = isPlainObj(raw.settings) ? raw.settings : undefined;
  if (patch.kind === "set") {
    return { next: { ...raw, settings: { ...(settings ?? {}), rootCause: patch.analysis } } };
  }
  const cur = settings?.rootCause;
  if (cur === undefined) return { skip: "absent" };
  // «Limpiar» solo borra el análisis que la persona está viendo: si alguien ya
  // lo reemplazó por uno más nuevo, ese no se toca.
  const curExec = isPlainObj(cur) ? cur.executionId : undefined;
  if (patch.executionId !== undefined && curExec !== patch.executionId) return { skip: "newer" };
  const rest: Record<string, unknown> = { ...settings };
  delete rest.rootCause;
  return { next: { ...raw, settings: rest } };
}

// Estado HTTP de un error del SDK (o undefined si no trae).
export const httpStatus = (e: unknown): number | undefined => {
  if (!isPlainObj(e) && !(e instanceof Error)) return undefined;
  const o = e as unknown as Record<string, unknown>;
  if (typeof o.status === "number") return o.status;
  const resp = o.response;
  if (isPlainObj(resp) && typeof resp.status === "number") return resp.status;
  return undefined;
};

export type SaveDoc = {
  text: string;
  version: string;
  access?: readonly string[] | null;
  owner?: string | null;
  labels?: readonly unknown[] | null;
};
export type SaveDeps = {
  getDocument: (id: string) => Promise<SaveDoc>;
  updateContent: (id: string, version: string, text: string) => Promise<{ version: string }>;
  validate: (parsed: unknown) => unknown; // null/undefined = válido (validateMapContent)
  isConflict: (e: unknown) => boolean;
  isForbidden: (e: unknown) => boolean;
  maxBytes?: number;
  maxAttempts?: number;
};
export type SaveFail = "role" | "invalid" | "tooBig" | "conflict" | "forbidden" | "error";
export type SaveResult =
  | { ok: true; written: true; version: string; text: string }
  | { ok: true; written: false; reason: "absent" | "newer"; version: string; current: unknown }
  | { ok: false; reason: SaveFail; error?: unknown };

// Lee la ÚLTIMA versión, confirma que la persona sigue siendo analista, parcha
// solo el análisis, valida el resultado y escribe con bloqueo optimista. Si otro
// escribió en el medio (conflicto), relee y reintenta: nunca pisa cambios ajenos.
export async function saveAnalysisWith(deps: SaveDeps, id: string, me: string, patch: RcPatch): Promise<SaveResult> {
  const attempts = Math.max(1, deps.maxAttempts ?? 3);
  for (let i = 0; i < attempts; i++) {
    let doc: SaveDoc;
    try {
      doc = await deps.getDocument(id);
    } catch (error) {
      return { ok: false, reason: deps.isForbidden(error) ? "forbidden" : "error", error };
    }
    if (resolveRole(doc, me) !== "analyst") return { ok: false, reason: "role" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(doc.text);
    } catch {
      return { ok: false, reason: "invalid" };
    }
    if (deps.validate(parsed) != null) return { ok: false, reason: "invalid" };
    const r = patchRootCause(parsed, patch);
    if ("skip" in r) {
      if (r.skip === "notMap") return { ok: false, reason: "invalid" };
      const s = isPlainObj(parsed) && isPlainObj(parsed.settings) ? parsed.settings : undefined;
      return { ok: true, written: false, reason: r.skip, version: doc.version, current: s?.rootCause };
    }
    // Nunca se escribe un mapa que la app no podría volver a abrir.
    if (deps.validate(r.next) != null) return { ok: false, reason: "invalid" };
    const text = JSON.stringify(r.next);
    if (deps.maxBytes !== undefined && text.length > deps.maxBytes) return { ok: false, reason: "tooBig" };
    try {
      const res = await deps.updateContent(id, doc.version, text);
      return { ok: true, written: true, version: res.version, text };
    } catch (error) {
      if (deps.isConflict(error)) continue; // otro escribió en el medio: releer y reintentar
      return { ok: false, reason: deps.isForbidden(error) ? "forbidden" : "error", error };
    }
  }
  return { ok: false, reason: "conflict" };
}
