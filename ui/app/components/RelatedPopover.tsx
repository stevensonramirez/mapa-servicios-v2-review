import React, { useMemo } from "react";
import { NodeToolbar, Position } from "@xyflow/react";
import type { Node, Edge } from "@xyflow/react";
import { PlusIcon, DeleteIcon, XmarkIcon, WorkflowSimpleIcon } from "@dynatrace/strato-icons";
import { useT } from "../i18n";
import type { SeverityNodeData } from "./SeverityNode";
import type { EntityRef } from "./entityModel";
import { entityTypeLabel, entityTypeOf, openEntity } from "./entityModel";
import type { EntityRelations } from "./useEntityRelations";

// ── Popover "Entidades Relacionadas" de un nodo atado a una entidad ──────────
// Cruza las relaciones REALES (smartscapeEdges type=calls) de la entidad del
// nodo con los nodos/conexiones del mapa, y arma 4 secciones:
//  1. Ya conectado          → NO se lista (se resalta en el lienzo; el dim lo hace el padre)
//  2. No conectado          → ícono "+" (conexión en el sentido correcto, inheritStatus)
//  3. No está en el mapa    → ícono "+" (crea nodo + conexión)
//  4. Conexiones sin respaldo → "Ignorar" / "Quitar"
// Se renderiza como un NodeToolbar independiente del de "Editar" (posición Right).

type RelatedRow =
  | { kind: "notConnected"; nodeId: string; name: string; entity: EntityRef; direction: "calls" | "calledBy" }
  | { kind: "notInMap"; ref: EntityRef; name: string; direction: "calls" | "calledBy" }
  | { kind: "unbacked"; edgeId: string; name: string };

type Props = {
  node: Node<SeverityNodeData>;
  nodes: Node[];
  edges: Edge[];
  relations: EntityRelations;
  // Nombre EN VIVO por id de entidad (incluye las que aún no son nodo del mapa),
  // para no mostrar el id crudo (ilegible) en la sección "No está en el mapa".
  liveNames: Record<string, string>;
  onConnectExisting: (thisNodeId: string, otherNodeId: string, direction: "calls" | "calledBy") => void;
  onAddAndConnect: (thisNodeId: string, ref: EntityRef, direction: "calls" | "calledBy") => void;
  onIgnoreEdge: (edgeId: string) => void;
  onRemoveEdge: (edgeId: string) => void;
  onClose: () => void;
};

export const RelatedPopover = ({
  node,
  nodes,
  edges,
  relations,
  liveNames,
  onConnectExisting,
  onAddAndConnect,
  onIgnoreEdge,
  onRemoveEdge,
  onClose,
}: Props) => {
  const t = useT();
  const thisNodeId = node.id;
  const thisEntityId = node.data.entity?.id;

  const rows = useMemo(() => {
    const notConnected: RelatedRow[] = [];
    const notInMap: RelatedRow[] = [];
    const unbacked: RelatedRow[] = [];
    if (!thisEntityId) return { notConnected, notInMap, unbacked };

    const rel = relations.byEntity[thisEntityId];
    const callsSet = new Set(rel?.calls ?? []);
    const calledBySet = new Set(rel?.calledBy ?? []);

    // Índices: entidad → nodo del mapa (con fuente davis) y su nombre.
    const nodeByEntity = new Map<string, Node>();
    nodes.forEach((n) => {
      if (n.type !== "severity") return;
      const d = n.data as SeverityNodeData;
      const source = d.statusSource ?? (d.entity ? "davis" : "dql");
      if (source === "davis" && d.entity?.id) nodeByEntity.set(d.entity.id, n);
    });
    const nameOfNode = (n: Node): string => (n.data as SeverityNodeData).name || n.id;

    // ¿Hay raya entre este nodo y otro (cualquier sentido)?
    const hasEdge = (otherNodeId: string): boolean =>
      edges.some(
        (e) =>
          (e.source === thisNodeId && e.target === otherNodeId) ||
          (e.source === otherNodeId && e.target === thisNodeId),
      );

    // Todas las entidades relacionadas (calls ∪ called_by), con su dirección.
    const relatedEntities = new Map<string, "calls" | "calledBy">();
    callsSet.forEach((id) => relatedEntities.set(id, "calls"));
    // calledBy solo si no está ya como calls (calls tiene prioridad de dirección).
    calledBySet.forEach((id) => {
      if (!relatedEntities.has(id)) relatedEntities.set(id, "calledBy");
    });

    relatedEntities.forEach((direction, entityId) => {
      if (entityId === thisEntityId) return;
      const mapped = nodeByEntity.get(entityId);
      if (mapped) {
        // Está en el mapa: si ya hay conexión → sección 1 (no se lista); si no → sección 2.
        if (!hasEdge(mapped.id)) {
          const mappedEntity = (mapped.data as SeverityNodeData).entity;
          if (mappedEntity) {
            notConnected.push({
              kind: "notConnected",
              nodeId: mapped.id,
              name: nameOfNode(mapped),
              entity: mappedEntity,
              direction,
            });
          }
        }
      } else {
        // No está en el mapa → sección 3. Preferimos el nombre EN VIVO (resuelto
        // por MapCanvas vía useEntityMetadata); si todavía no cargó, mostramos el
        // tipo en vez del id crudo (ilegible) mientras tanto.
        const type = entityTypeOf(entityId);
        if (!type) return;
        const ref: EntityRef = { id: entityId, type };
        const label = liveNames[entityId] ?? entityTypeLabel(type);
        notInMap.push({ kind: "notInMap", ref, name: label, direction });
      }
    });

    // Sección 4 — Rayas de ESTE nodo hacia otro nodo atado cuya entidad NO tiene
    // relación real con la de este nodo (y que no se haya "ignorado" ya).
    edges.forEach((e) => {
      const ed = e.data as { topologyIgnored?: unknown } | undefined;
      if (ed?.topologyIgnored === true) return;
      let otherNodeId: string | null = null;
      if (e.source === thisNodeId) otherNodeId = e.target;
      else if (e.target === thisNodeId) otherNodeId = e.source;
      if (!otherNodeId) return;
      const other = nodes.find((n) => n.id === otherNodeId);
      if (!other || other.type !== "severity") return;
      const otherEntity = (other.data as SeverityNodeData).entity?.id;
      // Sin entidad atada en el otro extremo → no podemos juzgar la topología: lo
      // dejamos fuera (no es una raya "sin respaldo" verificable).
      if (!otherEntity) return;
      const backed = callsSet.has(otherEntity) || calledBySet.has(otherEntity);
      if (!backed) {
        unbacked.push({ kind: "unbacked", edgeId: e.id, name: nameOfNode(other) });
      }
    });

    return { notConnected, notInMap, unbacked };
  }, [thisNodeId, thisEntityId, nodes, edges, relations, liveNames]);

  const isEmpty =
    rows.notConnected.length === 0 && rows.notInMap.length === 0 && rows.unbacked.length === 0;

  return (
    <NodeToolbar nodeId={node.id} isVisible position={Position.Right} align="start" offset={12}>
      <div className="mapa-related-pop nodrag nopan nowheel">
        <div className="mapa-related-head">
          <span className="mapa-related-title">{t("related.title")}</span>
          <button
            type="button"
            className="mapa-related-close"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <XmarkIcon size={14} />
          </button>
        </div>

        {relations.isLoading && isEmpty ? (
          <div className="mapa-related-msg">{t("related.loading")}</div>
        ) : isEmpty ? (
          <div className="mapa-related-msg">{t("related.empty")}</div>
        ) : (
          <div className="mapa-related-body">
            {rows.notConnected.length > 0 && (
              <div className="mapa-related-section">
                <div className="mapa-related-shead">{t("related.notConnected")}</div>
                {rows.notConnected.map((r) =>
                  r.kind === "notConnected" ? (
                    <div className="mapa-related-row mapa-related-row-inline" key={`nc-${r.nodeId}`}>
                      <span className="mapa-related-name" title={r.name}>
                        {r.name}
                      </span>
                      <div className="mapa-related-icons">
                        <button
                          type="button"
                          className="mapa-related-icon-btn"
                          title={t("why.openEntity")}
                          aria-label={t("why.openEntity")}
                          onClick={() => openEntity(r.entity)}
                        >
                          <WorkflowSimpleIcon size={13} />
                        </button>
                        <button
                          type="button"
                          className="mapa-related-icon-btn"
                          title={t("related.connect")}
                          aria-label={t("related.connect")}
                          onClick={() => onConnectExisting(thisNodeId, r.nodeId, r.direction)}
                        >
                          <PlusIcon size={13} />
                        </button>
                      </div>
                    </div>
                  ) : null,
                )}
              </div>
            )}

            {rows.notInMap.length > 0 && (
              <div className="mapa-related-section">
                <div className="mapa-related-shead">{t("related.notInMap")}</div>
                {rows.notInMap.map((r) =>
                  r.kind === "notInMap" ? (
                    <div className="mapa-related-row mapa-related-row-inline" key={`nm-${r.ref.id}`}>
                      <span className="mapa-related-name" title={r.name}>
                        {r.name}
                      </span>
                      <div className="mapa-related-icons">
                        <button
                          type="button"
                          className="mapa-related-icon-btn"
                          title={t("why.openEntity")}
                          aria-label={t("why.openEntity")}
                          onClick={() => openEntity(r.ref)}
                        >
                          <WorkflowSimpleIcon size={13} />
                        </button>
                        <button
                          type="button"
                          className="mapa-related-icon-btn"
                          title={t("related.addAndConnect")}
                          aria-label={t("related.addAndConnect")}
                          onClick={() => onAddAndConnect(thisNodeId, r.ref, r.direction)}
                        >
                          <PlusIcon size={13} />
                        </button>
                      </div>
                    </div>
                  ) : null,
                )}
              </div>
            )}

            {rows.unbacked.length > 0 && (
              <div className="mapa-related-section">
                <div className="mapa-related-shead">{t("related.unbacked")}</div>
                {rows.unbacked.map((r) =>
                  r.kind === "unbacked" ? (
                    <div className="mapa-related-row" key={`ub-${r.edgeId}`}>
                      <span className="mapa-related-name" title={r.name}>
                        {r.name}
                      </span>
                      <div className="mapa-related-actions">
                        <button
                          type="button"
                          className="mapa-related-action"
                          onClick={() => onIgnoreEdge(r.edgeId)}
                        >
                          <span>{t("related.ignore")}</span>
                        </button>
                        <button
                          type="button"
                          className="mapa-related-action mapa-related-action-danger"
                          onClick={() => onRemoveEdge(r.edgeId)}
                        >
                          <DeleteIcon size={12} />
                          <span>{t("related.remove")}</span>
                        </button>
                      </div>
                    </div>
                  ) : null,
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </NodeToolbar>
  );
};
