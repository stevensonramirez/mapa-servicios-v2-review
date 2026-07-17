import { useEffect, useMemo, useRef } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import type { Severity } from "./SeverityNode";
import type { EntityRef } from "./entityModel";
import { dqlQuote } from "./entityModel";

// Rastrea si YA se completó una carga para el set de ids/consulta actual (evita
// falso-verde / falso-"retirado" antes del primer resultado: mientras no esté
// `isReady`, el llamador debe mostrar "unknown" en vez de asumir 0 o ausente).
const useIsReady = (key: string, isLoading: boolean, hasData: boolean): boolean => {
  const loadedForKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (key && !isLoading && hasData) loadedForKeyRef.current = key;
  }, [key, isLoading, hasData]);
  return loadedForKeyRef.current === key;
};

// ── Estado por Davis (problemas activos) para nodos atados a una entidad ──────
// UNA sola consulta batcheada sobre dt.davis.problems (from: now()-2h,
// event.status=="ACTIVE"), expande affected_entity_ids y filtra a la lista de
// ids atados en el mapa. Rankea 1|2 por categoría (AVAILABILITY/ERROR → error;
// SLOWDOWN/RESOURCE/CUSTOM → warning). Refresca ~90s y se pausa con opts.paused.
//
// Esta ES la consulta con costo de Grail (dt.davis.problems no es gratis). Se
// hace UNA por mapa (batch sobre todos los ids), no una por nodo.

const REFRESH_MS = 90_000;

// Categorías que consideramos "error" (2): AVAILABILITY / ERROR. El resto de
// problemas activos → warning (1). El ranking se hace en el DQL (max/if) para no
// traer una fila por problema; ver la consulta más abajo.

export type DavisStatus = {
  // Severidad por entidad (id → 0|1|2). Sin problema activo → 0 (ok).
  // Solo confiable cuando `isReady` es true (ver abajo).
  byEntity: Record<string, Severity>;
  // Cantidad de problemas activos por entidad (para la burbuja/tooltip).
  problemsByEntity: Record<string, number>;
  isLoading: boolean;
  // false hasta que la consulta batcheada haya devuelto al menos una vez para el
  // set de ids actual — antes de eso, byEntity NO debe usarse (mostrar "unknown").
  isReady: boolean;
};

export const useDavisStatus = (
  entityIds: string[],
  // `refreshIntervalMs` sustituye la cadencia por defecto (un Mapa Padre actualiza
  // TODO a su propia cadencia; 0 = solo a mano). `refreshToken` fuerza una
  // relectura inmediata al cambiar (botón "Actualizar ahora").
  opts?: { paused?: boolean; refreshIntervalMs?: number; refreshToken?: number },
): DavisStatus => {
  const paused = opts?.paused ?? false;
  const interval = opts?.refreshIntervalMs ?? REFRESH_MS;
  const refreshToken = opts?.refreshToken;
  // Lista ordenada y única → clave estable de la consulta (no re-ejecuta por reorden).
  const ids = useMemo(() => [...new Set(entityIds.filter(Boolean))].sort(), [entityIds]);

  const query = useMemo(() => {
    if (ids.length === 0) return "";
    const list = ids.map((id) => dqlQuote(id)).join(", ");
    // Sin duplicados: un problema fusionado por Davis en otro no debe pintar el nodo.
    return `fetch dt.davis.problems, from: now()-2h
| filter event.status == "ACTIVE"
| filter isNull(dt.davis.is_duplicate) or dt.davis.is_duplicate == false
| expand affected_entity_ids
| filter in(affected_entity_ids, { ${list} })
| summarize
    { worst = max(if(in(event.category, {"AVAILABILITY","ERROR"}), 2, else: 1)),
      count = count() },
    by: { entityId = affected_entity_ids }`;
  }, [ids]);

  const enabled = query.length > 0 && !paused;
  const { data, isLoading, forceRefetch } = useDql(query, {
    enabled,
    refetchInterval: enabled && interval > 0 ? interval : undefined,
  });
  const isReady = useIsReady(ids.join(","), isLoading, data !== undefined);
  // Refresco a mano: el primer valor del token es el de montaje y NO debe
  // disparar una consulta extra encima de la inicial.
  const seenTokenRef = useRef<number | undefined>(refreshToken);
  useEffect(() => {
    if (refreshToken === undefined || seenTokenRef.current === refreshToken) return;
    seenTokenRef.current = refreshToken;
    if (!enabled) return;
    void forceRefetch();
  }, [refreshToken, enabled, forceRefetch]);

  const result = useMemo<DavisStatus>(() => {
    const byEntity: Record<string, Severity> = {};
    const problemsByEntity: Record<string, number> = {};
    // Todos los ids atados arrancan en ok (0); los que tengan problema se suben.
    // OJO: solo confiable si `isReady` — mientras no lo esté, el llamador debe
    // ignorar este 0 por defecto y mostrar "unknown" (anti-falso-verde).
    for (const id of ids) {
      byEntity[id] = 0;
      problemsByEntity[id] = 0;
    }
    const recs = (data?.records ?? []) as Array<Record<string, unknown>>;
    for (const r of recs) {
      const id = r.entityId;
      if (typeof id !== "string" || !(id in byEntity)) continue;
      const worst = Number(r.worst);
      const cnt = Number(r.count);
      byEntity[id] = worst >= 2 ? 2 : worst >= 1 ? 1 : 0;
      problemsByEntity[id] = Number.isFinite(cnt) ? cnt : 0;
    }
    return { byEntity, problemsByEntity, isLoading, isReady };
  }, [data, ids, isLoading, isReady]);

  return result;
};

// ── Metadata de entidades (existencia / nombre en vivo) ──────────────────────
// Consulta GRATIS (0 bytes) sobre `smartscapeNodes` para: (1) resolver el nombre
// EN VIVO (detecta renombrados), (2) detectar entidades DADAS DE BAJA (el id
// atado ya no aparece → `retired`), y (3) traducir el id clásico al id del
// modelo NUEVO (`sid`, el campo `id` del nodo) para deep-links y smartscapeEdges.
//
// La app guarda ids CLÁSICOS ("SERVICE-…", "PROCESS_GROUP_INSTANCE-…"); el
// modelo nuevo los expone en el campo `id_classic` (string plano, comparable
// con `==` directo — verificado en vivo; el campo `id` en cambio es
// `smartscape_id` y NO compara con strings crudos). Caso especial: los GRUPOS
// DE PROCESOS ya no son nodos en el modelo nuevo — existen solo como campo
// `dt.process_group.id` (id clásico "PROCESS_GROUP-…") de cada PROCESS, así que
// se resuelven por ese campo en la MISMA consulta y se dedupe en cliente.

export type EntityMeta = {
  // id (clásico) → nombre en vivo. Si el id NO aparece → no está aquí (baja).
  liveName: Record<string, string>;
  // Ids (clásicos) que SÍ existen actualmente (para detectar bajas).
  // Solo confiable cuando `isReady` — mientras no lo esté, NO tratar como baja.
  existing: Set<string>;
  // id clásico → id del modelo nuevo (solo cuando difieren; hosts/servicios no
  // aparecen porque coinciden). Los grupos de procesos no tienen id nuevo.
  sidByClassic: Record<string, string>;
  isLoading: boolean;
  isReady: boolean;
};

const PG_PREFIX = "PROCESS_GROUP-";

export const useEntityMetadata = (
  refs: EntityRef[],
  opts?: { paused?: boolean },
): EntityMeta => {
  const paused = opts?.paused ?? false;

  // Ids únicos y ordenados → clave estable de la consulta (no re-ejecuta por reorden).
  const ids = useMemo(() => {
    const list = refs.filter((r) => r?.id).map((r) => r.id);
    return [...new Set(list)].sort();
  }, [refs]);

  // OR encadenado (`in {…}` con valores computados no parsea — verificado).
  // Grupos de procesos van por `dt.process_group.id`; el resto por `id_classic`.
  // OJO: "PROCESS_GROUP_INSTANCE-…" NO hace startsWith("PROCESS_GROUP-") (el
  // separador es "-", no "_"), así que la distinción por prefijo es segura.
  // El limit acota el caso PG (un grupo puede tener muchas instancias).
  const query = useMemo(() => {
    if (ids.length === 0) return "";
    const cond = ids
      .map((id) =>
        id.startsWith(PG_PREFIX)
          ? `dt.process_group.id == ${dqlQuote(id)}`
          : `id_classic == ${dqlQuote(id)}`,
      )
      .join(" or ");
    return `smartscapeNodes "*"
| filter ${cond}
| fields id, id_classic, name, pg_id = dt.process_group.id, pg_name = dt.process_group.detected_name
| limit 500`;
  }, [ids]);

  const enabled = query.length > 0 && !paused;
  const { data, isLoading } = useDql(query, { enabled, refetchInterval: enabled ? REFRESH_MS : undefined });
  const isReady = useIsReady(ids.join(","), isLoading, data !== undefined);

  return useMemo<EntityMeta>(() => {
    const liveName: Record<string, string> = {};
    const existing = new Set<string>();
    const sidByClassic: Record<string, string> = {};
    const wanted = new Set(ids);
    const recs = (data?.records ?? []) as Array<Record<string, unknown>>;
    for (const r of recs) {
      const classic = r.id_classic;
      if (typeof classic === "string" && classic && wanted.has(classic)) {
        existing.add(classic);
        if (typeof r.name === "string" && r.name) liveName[classic] = r.name;
        if (typeof r.id === "string" && r.id && r.id !== classic) sidByClassic[classic] = r.id;
      }
      // Un mismo PROCESS puede resolver, además, a su grupo de procesos atado.
      const pg = r.pg_id;
      if (typeof pg === "string" && pg && wanted.has(pg)) {
        existing.add(pg);
        if (!liveName[pg] && typeof r.pg_name === "string" && r.pg_name) liveName[pg] = r.pg_name;
      }
    }
    return { liveName, existing, sidByClassic, isLoading, isReady };
  }, [data, ids, isLoading, isReady]);
};
