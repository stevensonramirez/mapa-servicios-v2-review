import { useMemo } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import type { EntityRef } from "./entityModel";
import { dqlQuote } from "./entityModel";

// ── Relaciones de topología real (Smartscape) por entidad ────────────────────
// Consultas GRATIS sobre el storage NUEVO de Smartscape (scannedBytes=0,
// scope storage:smartscape:read). OJO: `smartscapeEdges` habla en ids del
// modelo NUEVO ("PROCESS-…", "K8S_CLUSTER-…"), NO en los clásicos que guarda la
// app — para hosts/servicios ambos coinciden (por eso "parecía" funcionar),
// para el resto NO (verificado en vivo). Por eso el hook trabaja en 3 pasos,
// todos gratis, y hacia afuera habla SOLO en ids clásicos:
//   1. Traducir los ids clásicos atados → ids nuevos (`id_classic` → `id`).
//   2. Consultar las aristas `type=="calls"` con los ids nuevos.
//   3. Traducir los ids nuevos de los VECINOS de vuelta a clásicos (y capturar
//      su id nuevo como `sid` para deep-links).
// Los grupos de procesos ya no son nodos en el modelo nuevo → sin relaciones
// (el paso 1 simplemente no los resuelve).
//
// `source_id`/`target_id`/`id` son de tipo `smartscape_id`: comparar con `==`
// contra un string crudo SIEMPRE da falso — hay que envolver con
// `toSmartscapeId()`. `id_classic` sí es string plano (== directo).

const REFRESH_MS = 90_000;
// Tope de registros por consulta. Sin esto aplica el default de la API (1000):
// en un mapa con muchas entidades atadas, las aristas que caían fuera del tope
// desaparecían en silencio para algunas entidades → pill en "N.A." o un % con
// menos vecinos de los reales, distinto en cada refresco.
const MAX_RECORDS = 5000;
// "Sin datos aún": la consulta está habilitada pero todavía no respondió ni
// falló. Cuenta como cargando (hay un render entre que termina un paso y arranca
// el siguiente en que `isLoading` aún es false → antes parpadeaba "N.A.").
const pending = (q: { data?: unknown; error?: unknown }, enabled: boolean): boolean =>
  enabled && q.data === undefined && !q.error;

export type EntityRelation = {
  // Ids (clásicos) de entidades a las que ESTA entidad llama.
  calls: string[];
  // Ids (clásicos) de entidades que llaman a ESTA entidad.
  calledBy: string[];
};

export type EntityRelations = {
  // Clave: id clásico de cada entidad atada.
  byEntity: Record<string, EntityRelation>;
  // id clásico → id del modelo nuevo, para las entidades atadas Y sus vecinos
  // (solo cuando difieren). Sirve para armar EntityRef.sid de los candidatos.
  sids: Record<string, string>;
  isLoading: boolean;
  // Alguna de las consultas falló: el llamador NO debe leer "sin relaciones" como
  // un N.A. real (antes el error se tragaba en silencio y salía N.A. falso).
  hasError: boolean;
};

export const useEntityRelations = (
  refs: EntityRef[],
  opts?: { paused?: boolean },
): EntityRelations => {
  const paused = opts?.paused ?? false;

  // Ids únicos y ordenados → clave estable de la consulta (no re-ejecuta por reorden).
  const ids = useMemo(() => {
    const list = refs.filter((r) => r?.id).map((r) => r.id);
    return [...new Set(list)].sort();
  }, [refs]);

  // Paso 1: clásico → nuevo. OR encadenado (`in {…}` con computados no parsea).
  const resolveQuery = useMemo(() => {
    if (ids.length === 0) return "";
    const cond = ids.map((id) => `id_classic == ${dqlQuote(id)}`).join(" or ");
    return `smartscapeNodes "*"
| filter ${cond}
| fields id, id_classic`;
  }, [ids]);
  const resolveEnabled = resolveQuery.length > 0 && !paused;
  const resolveQ = useDql({ query: resolveQuery, maxResultRecords: MAX_RECORDS }, {
    enabled: resolveEnabled,
    refetchInterval: resolveEnabled ? REFRESH_MS : undefined,
  });

  // Mapas clásico↔nuevo de las entidades ATADAS.
  const bound = useMemo(() => {
    const sidOf: Record<string, string> = {};
    const classicOf: Record<string, string> = {};
    const recs = (resolveQ.data?.records ?? []) as Array<Record<string, unknown>>;
    for (const r of recs) {
      const sid = r.id;
      const classic = r.id_classic;
      if (typeof sid !== "string" || !sid || typeof classic !== "string" || !classic) continue;
      sidOf[classic] = sid;
      classicOf[sid] = classic;
    }
    return { sidOf, classicOf };
  }, [resolveQ.data]);

  // Paso 2: aristas "calls" en ids nuevos.
  const edgesQuery = useMemo(() => {
    const sids = Object.values(bound.sidOf).sort();
    if (sids.length === 0) return "";
    const cond = sids
      .map((sid) => dqlQuote(sid))
      .map((q) => `source_id == toSmartscapeId(${q}) or target_id == toSmartscapeId(${q})`)
      .join(" or ");
    return `smartscapeEdges "*"
| filter ${cond}
| filter type == "calls"
| filter source_id != target_id
| fields source_id, target_id`;
  }, [bound]);
  const edgesEnabled = edgesQuery.length > 0 && !paused;
  const edgesQ = useDql({ query: edgesQuery, maxResultRecords: MAX_RECORDS }, {
    enabled: edgesEnabled,
    refetchInterval: edgesEnabled ? REFRESH_MS : undefined,
  });

  // Aristas en ids nuevos + set de vecinos que aún no sabemos traducir.
  const edges = useMemo(() => {
    const pairs: Array<{ source: string; target: string }> = [];
    const foreign = new Set<string>();
    const recs = (edgesQ.data?.records ?? []) as Array<Record<string, unknown>>;
    for (const r of recs) {
      const source = r.source_id;
      const target = r.target_id;
      if (typeof source !== "string" || typeof target !== "string" || source === target) continue;
      pairs.push({ source, target });
      if (!(source in bound.classicOf)) foreign.add(source);
      if (!(target in bound.classicOf)) foreign.add(target);
    }
    return { pairs, foreign: [...foreign].sort() };
  }, [edgesQ.data, bound]);

  // Paso 3: vecinos nuevos → clásicos (aquí `id` es smartscape_id → toSmartscapeId).
  const foreignQuery = useMemo(() => {
    if (edges.foreign.length === 0) return "";
    const cond = edges.foreign.map((sid) => `id == toSmartscapeId(${dqlQuote(sid)})`).join(" or ");
    return `smartscapeNodes "*"
| filter ${cond}
| fields id, id_classic`;
  }, [edges.foreign]);
  const foreignEnabled = foreignQuery.length > 0 && !paused;
  const foreignQ = useDql({ query: foreignQuery, maxResultRecords: MAX_RECORDS }, {
    enabled: foreignEnabled,
    refetchInterval: foreignEnabled ? REFRESH_MS : undefined,
  });

  return useMemo<EntityRelations>(() => {
    const classicOf: Record<string, string> = { ...bound.classicOf };
    const sids: Record<string, string> = {};
    for (const [classic, sid] of Object.entries(bound.sidOf)) {
      if (sid !== classic) sids[classic] = sid;
    }
    const recs = (foreignQ.data?.records ?? []) as Array<Record<string, unknown>>;
    for (const r of recs) {
      const sid = r.id;
      const classic = r.id_classic;
      if (typeof sid !== "string" || !sid || typeof classic !== "string" || !classic) continue;
      classicOf[sid] = classic;
      if (sid !== classic) sids[classic] = sid;
    }

    const byEntity: Record<string, EntityRelation> = {};
    for (const id of ids) byEntity[id] = { calls: [], calledBy: [] };
    for (const { source, target } of edges.pairs) {
      // Vecino sin traducción todavía (paso 3 en vuelo o entidad sin id clásico)
      // → se omite esta arista; el refetch la trae cuando esté completa.
      const srcClassic = classicOf[source];
      const tgtClassic = classicOf[target];
      if (!srcClassic || !tgtClassic) continue;
      if (srcClassic in byEntity) byEntity[srcClassic].calls.push(tgtClassic);
      if (tgtClassic in byEntity) byEntity[tgtClassic].calledBy.push(srcClassic);
    }

    const isLoading =
      resolveQ.isLoading ||
      edgesQ.isLoading ||
      foreignQ.isLoading ||
      pending(resolveQ, resolveEnabled) ||
      pending(edgesQ, edgesEnabled) ||
      pending(foreignQ, foreignEnabled);
    const hasError = Boolean(resolveQ.error || edgesQ.error || foreignQ.error);
    return { byEntity, sids, isLoading, hasError };
  }, [
    ids,
    bound,
    edges,
    foreignQ.data,
    resolveQ.isLoading,
    edgesQ.isLoading,
    foreignQ.isLoading,
    resolveQ.data,
    edgesQ.data,
    resolveQ.error,
    edgesQ.error,
    foreignQ.error,
    resolveEnabled,
    edgesEnabled,
    foreignEnabled,
  ]);
};
