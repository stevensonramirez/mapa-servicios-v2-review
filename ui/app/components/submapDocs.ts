import type { MapSnapshot } from "./useMapPersistence";
import { snapshotMapType } from "./useMapPersistence";
import type { SeverityNodeData } from "./SeverityNode";

// ── Documentos de mapas incrustados ──────────────────────────────────────────
// Caché por id COMPARTIDA entre las dos cosas que necesitan el documento de un
// mapa hijo: (1) la validación al incrustarlo (editor / soltar desde la lista) y
// (2) la primera evaluación de su salud (useSubmapStatus). Así incrustar un mapa
// no descarga el mismo documento dos veces seguidas.
//
// Se guarda la PROMESA (no el resultado) para que dos llamados simultáneos
// compartan una sola descarga. Si falla, la entrada se descarta: un fallo
// transitorio o un permiso recién concedido no debe quedar cacheado para
// siempre.
const cache = new Map<string, Promise<MapSnapshot>>();

export const loadMapDoc = (
  id: string,
  loader: (id: string) => Promise<MapSnapshot>,
): Promise<MapSnapshot> => {
  const hit = cache.get(id);
  if (hit) return hit;
  const p = loader(id).catch((err: unknown) => {
    cache.delete(id);
    throw err;
  });
  cache.set(id, p);
  return p;
};

// ¿Este candidato NO se puede incrustar? Un Mapa Padre solo admite Mapas de
// Servicio: la jerarquía es de máximo 2 niveles. Se mira el TIPO del documento y,
// como red de seguridad, si trae nodos de mapa incrustado (un documento viejo o
// importado podría saltarse la regla del tipo). La evaluación sigue excluyendo
// esos nodos aparte, por si aun así se cuela uno.
export const isNestableChild = (snap: MapSnapshot): boolean =>
  snapshotMapType(snap) !== "parent" && !hasSubmapNodes(snap);

export const hasSubmapNodes = (snap: MapSnapshot): boolean =>
  snap.nodes.some(
    (n) => n.type === "severity" && Boolean((n.data as SeverityNodeData | undefined)?.mapRef?.id),
  );
