// Enlace ABSOLUTO a un mapa de esta misma app (…/map/<id>), para abrirlo en una
// pestaña nueva. La app corre dentro de un iframe con su propio origen, así que
// una ruta relativa no sirve: se arma desde `window.location`.
//
// La raíz de rutas es el basename del router ("ui", ver ui/main.tsx): todo lo
// que hay hasta ese segmento es la base, y de ahí cuelga "map/<id>". Se deriva
// de la ubicación REAL en vez de armar la URL de plataforma a mano porque es la
// misma forma que ya usa la sincronización mapa↔URL (react-router) y no depende
// de suponer cómo la plataforma monta la app.
const ROUTER_BASENAME = "ui";

export const mapHref = (id: string): string => {
  if (typeof id !== "string" || !id.trim()) return "";
  try {
    const { origin, pathname } = window.location;
    const seg = `/${ROUTER_BASENAME}`;
    const at = pathname.indexOf(`${seg}/`);
    const base = pathname.endsWith(seg) ? pathname : at >= 0 ? pathname.slice(0, at + seg.length) : seg;
    return `${origin}${base}/map/${encodeURIComponent(id.trim())}`;
  } catch {
    return "";
  }
};
