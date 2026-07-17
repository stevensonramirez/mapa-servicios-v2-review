import React from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Modal } from "@dynatrace/strato-components/overlays";
import { useT } from "../i18n";

// ── Modal global "Sugerir conexiones" (topología real) ───────────────────────
// Cruza los nodos atados a una entidad con las relaciones calls/called_by reales
// de Smartscape y propone rayas que faltan (pares con relación real y sin raya).
// Muestra la cobertura (boundCount/totalCount) y una lista de sugerencias con su
// origen→destino. "Agregar todas" crea todas las rayas de una.

export type TopologySuggestion = {
  // Ids de nodos del mapa (no de entidad): source llama a target.
  source: string;
  target: string;
  // Nombres legibles para la fila.
  sourceName: string;
  targetName: string;
};

type Props = {
  show: boolean;
  suggestions: TopologySuggestion[];
  boundCount: number;
  totalCount: number;
  onAdd: (suggestions: TopologySuggestion[]) => void;
  onClose: () => void;
};

export const TopologyModal = ({ show, suggestions, boundCount, totalCount, onAdd, onClose }: Props) => {
  const t = useT();

  const footer = (
    <Flex gap={8}>
      <Button onClick={onClose}>{t("common.close")}</Button>
      <Button
        variant="emphasized"
        onClick={() => onAdd(suggestions)}
        disabled={suggestions.length === 0}
      >
        {t("topology.addAll", { n: suggestions.length })}
      </Button>
    </Flex>
  );

  return (
    <Modal title={t("topology.title")} show={show} size="medium" onDismiss={onClose} footer={footer}>
      <Flex flexDirection="column" gap={12}>
        <div className="mapa-topology-coverage">
          {t("topology.coverage", { bound: boundCount, total: totalCount })}
        </div>

        {suggestions.length === 0 ? (
          <div className="mapa-topology-empty">{t("topology.none")}</div>
        ) : (
          <div className="mapa-topology-list nowheel">
            {suggestions.map((s) => (
              <div className="mapa-topology-row" key={`${s.source}->${s.target}`}>
                <span className="mapa-topology-src">{s.sourceName}</span>
                <span className="mapa-topology-arrow" aria-hidden="true">→</span>
                <span className="mapa-topology-tgt">{s.targetName}</span>
              </div>
            ))}
          </div>
        )}
      </Flex>
    </Modal>
  );
};
