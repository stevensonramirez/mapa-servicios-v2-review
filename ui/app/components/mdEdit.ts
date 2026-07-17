// Operaciones de inserción/envoltura de markdown para la toolbar del editor de
// títulos. Cada operación recibe el texto y el rango seleccionado (start,end) del
// textarea y devuelve el nuevo texto + dónde dejar el cursor/selección.

export type MdOp =
  // Envuelve la selección entre `before`/`after` (negrita, itálica, código…).
  | { kind: "wrap"; before: string; after: string }
  // Antepone un prefijo al inicio de la línea actual (encabezado, cita, listas…).
  | { kind: "prefix"; prefix: string }
  // Inserta un bloque en su propia línea (code block, divisor, tabla). `cursor`:
  // offset dentro del texto insertado donde dejar el caret (opcional).
  | { kind: "block"; text: string; cursor?: number }
  // Inserta un link markdown, seleccionando el placeholder a reemplazar.
  | { kind: "link" };

export type MdResult = { value: string; selStart: number; selEnd: number };

export const applyMd = (op: MdOp, value: string, start: number, end: number): MdResult => {
  const sel = value.slice(start, end);

  if (op.kind === "wrap") {
    const v = value.slice(0, start) + op.before + sel + op.after + value.slice(end);
    if (sel.length === 0) {
      const p = start + op.before.length;
      return { value: v, selStart: p, selEnd: p };
    }
    return { value: v, selStart: start + op.before.length, selEnd: end + op.before.length };
  }

  if (op.kind === "prefix") {
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const v = value.slice(0, lineStart) + op.prefix + value.slice(lineStart);
    return { value: v, selStart: start + op.prefix.length, selEnd: end + op.prefix.length };
  }

  if (op.kind === "link") {
    if (sel.length === 0) {
      const inserted = "[texto](url)";
      const v = value.slice(0, start) + inserted + value.slice(end);
      // Selecciona "texto" para reemplazarlo de una.
      return { value: v, selStart: start + 1, selEnd: start + 6 };
    }
    const v = value.slice(0, start) + "[" + sel + "](url)" + value.slice(end);
    const urlStart = start + 1 + sel.length + 2; // tras "[sel]("
    return { value: v, selStart: urlStart, selEnd: urlStart + 3 }; // selecciona "url"
  }

  // block: asegura que quede en su propia línea (newline antes/después si hace falta).
  const needNlBefore = start > 0 && value[start - 1] !== "\n";
  const needNlAfter = end < value.length && value[end] !== "\n";
  const pre = needNlBefore ? "\n" : "";
  const post = needNlAfter ? "\n" : "";
  const inserted = pre + op.text + post;
  const v = value.slice(0, start) + inserted + value.slice(end);
  const caret = op.cursor != null ? start + pre.length + op.cursor : start + inserted.length;
  return { value: v, selStart: caret, selEnd: caret };
};
