// Ruteo de rayas: reparto de PUERTOS (ranuras por costado) + EVASIÓN de nodos
// (curvar la raya para rodear el nodo que estorba). Todo es cálculo barato y se
// invoca SOLO cuando cambia la firma de layout (un nodo cruza de celda), no en
// cada frame del arrastre — para no poner lento el lienzo.

export type Pt = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number; cx: number; cy: number };
export type Side = "left" | "right";

// Reparto vertical de las rayas que comparten un costado (puerto): centra el abanico
// en el medio del lado y separa cada raya GAP px, sin pasarse del alto del nodo.
// Separación entre rayas del mismo costado (puerto). Amplia a propósito: dos rayas
// muy juntas se leen como UNA y se pierde el color de alerta de cada una. Para 2-3
// rayas el abanico usa GAP (carriles paralelos, planos, claramente separados); con
// MUCHAS se comprime al alto del nodo (cap de abajo) — limitación de una tarjeta corta.
export const GAP = 40; // px entre rayas en un mismo costado
export const PAD = 10; // margen para que el abanico no toque las esquinas del nodo
export function slotOffset(index: number, count: number, h: number): number {
  if (count <= 1) return 0;
  const step = Math.min(GAP, (h - PAD) / (count - 1));
  return (index - (count - 1) / 2) * step;
}

// Punto de anclaje en el costado izq/der del nodo (con la ranura del puerto en Y).
export function sideAnchor(b: Box, side: Side, dy: number): Pt {
  return { x: side === "right" ? b.x + b.w : b.x, y: b.cy + dy };
}

export type Bend = { c1x: number; c1y: number; c2x: number; c2y: number };

const CLEAR = 16; // px de margen al rodear un nodo
const SAMPLES = 18; // muestreo de la recta para detectar choque con una caja
const CURVE_SAMPLES = 22; // muestreo de la curva para VALIDAR que de verdad libra
const MAX_BULGE = 300; // tope al desvío (evita arcos gigantes en casos raros)
const GROW_STEPS = 8; // intentos de crecer el desvío hasta que la curva quede libre

// Punto de una bezier cúbica en t.
function cubicAt(S: Pt, c: Bend, E: Pt, t: number): Pt {
  const m = 1 - t;
  const a = m * m * m;
  const b = 3 * m * m * t;
  const cc = 3 * m * t * t;
  const d = t * t * t;
  return { x: a * S.x + b * c.c1x + cc * c.c2x + d * E.x, y: a * S.y + b * c.c1y + cc * c.c2y + d * E.y };
}
function insideInflated(x: number, y: number, b: Box): boolean {
  return x >= b.x - CLEAR && x <= b.x + b.w + CLEAR && y >= b.y - CLEAR && y <= b.y + b.h + CLEAR;
}
// ¿La CURVA (no la recta) entra en alguna caja inflada? Valida el resultado real.
function curveHitsAny(S: Pt, ctrls: Bend, E: Pt, boxes: Box[]): boolean {
  for (let i = 1; i < CURVE_SAMPLES; i++) {
    const p = cubicAt(S, ctrls, E, i / CURVE_SAMPLES);
    for (const b of boxes) if (insideInflated(p.x, p.y, b)) return true;
  }
  return false;
}
function controlsFor(S: Pt, dx: number, dy: number, px: number, py: number, push: number): Bend {
  return {
    c1x: S.x + dx * 0.33 + px * push,
    c1y: S.y + dy * 0.33 + py * push,
    c2x: S.x + dx * 0.66 + px * push,
    c2y: S.y + dy * 0.66 + py * push,
  };
}

// ¿La recta S→E cruza alguna caja-obstáculo? Si sí, devuelve los DOS controles de
// una curva cúbica que rodea SIN tocar ningún nodo: prueba el lado con menos desvío
// primero, CRECE el desvío hasta que la curva (validada contra TODOS los nodos, no
// solo los de la recta) quede libre, y si ese lado no cede prueba el otro. Si en
// ningún caso logra una curva limpia (maraña densa, nodos a ambos lados), devuelve
// null → la raya sale recta (mejor una recta clara que un arco que igual choca).
// Es una heurística barata; corre solo al cambiar la firma de layout, no por frame.
export function computeBend(S: Pt, E: Pt, obstacles: Box[]): Bend | null {
  const dx = E.x - S.x;
  const dy = E.y - S.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const px = -dy / len; // perpendicular unitaria
  const py = dx / len;

  // Cajas que estorban en la RECTA: infladas por CLEAR; choque por muestreo.
  const blocking: Box[] = [];
  for (const b of obstacles) {
    for (let i = 1; i < SAMPLES; i++) {
      const x = S.x + dx * (i / SAMPLES);
      const y = S.y + dy * (i / SAMPLES);
      if (insideInflated(x, y, b)) {
        blocking.push(b);
        break;
      }
    }
  }
  if (!blocking.length) return null;

  // Desvío inicial estimado a cada lado (esquinas infladas de las cajas que bloquean).
  let needPlus = 0;
  let needMinus = 0;
  for (const b of blocking) {
    const corners: Pt[] = [
      { x: b.x - CLEAR, y: b.y - CLEAR },
      { x: b.x + b.w + CLEAR, y: b.y - CLEAR },
      { x: b.x - CLEAR, y: b.y + b.h + CLEAR },
      { x: b.x + b.w + CLEAR, y: b.y + b.h + CLEAR },
    ];
    for (const c of corners) {
      const off = (c.x - S.x) * px + (c.y - S.y) * py;
      if (off > needPlus) needPlus = off;
      if (-off > needMinus) needMinus = -off;
    }
  }

  // Probar el lado con menos desvío primero; en cada lado crecer el desvío y VALIDAR
  // la curva contra TODOS los nodos hasta que quede limpia.
  const order = needPlus <= needMinus ? [1, -1] : [-1, 1];
  for (const sign of order) {
    const base = Math.max(CLEAR, sign === 1 ? needPlus : needMinus);
    for (let k = 0; k <= GROW_STEPS; k++) {
      const bulge = Math.min(MAX_BULGE, base + ((MAX_BULGE - base) * k) / GROW_STEPS);
      const ctrls = controlsFor(S, dx, dy, px, py, (bulge / 0.75) * sign);
      if (!curveHitsAny(S, ctrls, E, obstacles)) return ctrls;
    }
  }
  // Ningún lado logró librar del todo → recta (no dibujamos un arco que igual choca).
  return null;
}
