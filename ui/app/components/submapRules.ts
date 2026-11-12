import type { Severity } from "./SeverityNode";

// ── Reglas de color de un nodo de mapa incrustado ────────────────────────────
// Al estilo del panel "Colors" de los tableros de Dynatrace: una lista corta de
// reglas (color + operador + valor) que se evalúan EN ORDEN sobre una métrica del
// mapa hijo. Gana la PRIMERA que se cumpla; si ninguna se cumple, el nodo queda
// en estado neutro (gris, sin glow) — nunca se inventa un verde.

// Los colores disponibles son exactamente los del contrato de estado de la app
// (0=Ok verde, 1=Advertencia amarillo, 2=Error rojo): así el color del nodo, el
// glow y la herencia de estado de las conexiones siguen hablando el mismo idioma.
export type RuleColor = 0 | 1 | 2;

export type RuleOp = "gt" | "lt" | "gte" | "lte" | "eq" | "ne";

export type ColorRule = { color: RuleColor; op: RuleOp; value: number };

// Métrica sobre la que evalúan las reglas de un nodo de mapa incrustado.
//   "healthyPct"    → % de nodos sanos (status 0) sobre los evaluados
//   "affectedCount" → cantidad de nodos afectados (status >= 1)
export type SubmapMetric = "healthyPct" | "affectedCount";

export const MAX_COLOR_RULES = 3;

export const RULE_OPS: RuleOp[] = ["gt", "lt", "gte", "lte", "eq", "ne"];

// Símbolo que se pinta en el desplegable. No se traduce: los operadores
// matemáticos son iguales en los cuatro idiomas.
export const OP_SYMBOL: Record<RuleOp, string> = {
  gt: ">",
  lt: "<",
  gte: "≥",
  lte: "≤",
  eq: "=",
  ne: "≠",
};

// Reglas por defecto al crear un nodo de mapa incrustado: verde si todo está
// sano, amarillo de la mitad para arriba, rojo por debajo de la mitad.
export const DEFAULT_SUBMAP_RULES: ColorRule[] = [
  { color: 0, op: "eq", value: 100 },
  { color: 1, op: "gte", value: 50 },
  { color: 2, op: "lt", value: 50 },
];

export const DEFAULT_SUBMAP_METRIC: SubmapMetric = "healthyPct";

export const submapMetricOf = (v: unknown): SubmapMetric =>
  v === "affectedCount" ? "affectedCount" : DEFAULT_SUBMAP_METRIC;

// Saneo de lo PERSISTIDO (puede venir de un JSON importado o editado a mano):
// se descarta cualquier fila que no tenga color/operador/valor utilizables y se
// recorta al máximo de filas. Sin reglas válidas → los defaults, para que el nodo
// no quede mudo por un documento corrupto.
export const sanitizeRules = (v: unknown): ColorRule[] => {
  if (!Array.isArray(v)) return DEFAULT_SUBMAP_RULES;
  const out: ColorRule[] = [];
  for (const r of v) {
    if (!r || typeof r !== "object") continue;
    const o = r as { color?: unknown; op?: unknown; value?: unknown };
    const color = o.color === 0 || o.color === 1 || o.color === 2 ? o.color : null;
    const op = typeof o.op === "string" && (RULE_OPS as string[]).includes(o.op) ? (o.op as RuleOp) : null;
    const value = typeof o.value === "number" && Number.isFinite(o.value) ? o.value : null;
    if (color === null || op === null || value === null) continue;
    out.push({ color, op, value });
    if (out.length === MAX_COLOR_RULES) break;
  }
  return out.length > 0 ? out : DEFAULT_SUBMAP_RULES;
};

const matches = (op: RuleOp, left: number, right: number): boolean => {
  switch (op) {
    case "gt":
      return left > right;
    case "lt":
      return left < right;
    case "gte":
      return left >= right;
    case "lte":
      return left <= right;
    case "eq":
      return left === right;
    case "ne":
      return left !== right;
  }
};

// Evalúa las reglas en orden sobre `value`. Ninguna se cumple → "unknown"
// (neutro): el nodo no miente con un color que el usuario no configuró.
export const evalRules = (rules: ColorRule[], value: number): Severity => {
  for (const r of rules) {
    if (matches(r.op, value, r.value)) return r.color;
  }
  return "unknown";
};
