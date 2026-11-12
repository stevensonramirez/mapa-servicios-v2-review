import React, { useEffect, useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Modal } from "@dynatrace/strato-components/overlays";
import { QueryTreeIcon, WorkflowSimpleIcon } from "@dynatrace/strato-icons";
import type { MapType } from "./useMapPersistence";
import { useT } from "../i18n";

// ── Tipo del mapa al crearlo ─────────────────────────────────────────────────
// El tipo NO se puede cambiar después (define qué puede contener el mapa y cómo
// se refresca), así que se pregunta de frente antes de crear el documento.

type Props = {
  show: boolean;
  onCreate: (type: MapType) => void;
  onClose: () => void;
};

export const NewMapModal = ({ show, onCreate, onClose }: Props) => {
  const t = useT();
  const [type, setType] = useState<MapType>("normal");
  // El modal no se desmonta al cerrarlo: sin esto, un "Mapa Padre" elegido y
  // cancelado quedaba preseleccionado la próxima vez que se abriera.
  useEffect(() => {
    if (show) setType("normal");
  }, [show]);

  const OPTIONS: { value: MapType; title: string; desc: string; icon: React.ReactNode }[] = [
    {
      value: "normal",
      title: t("newmap.normalTitle"),
      desc: t("newmap.normalDesc"),
      icon: <WorkflowSimpleIcon size={20} />,
    },
    {
      value: "parent",
      title: t("newmap.parentTitle"),
      desc: t("newmap.parentDesc"),
      icon: <QueryTreeIcon size={20} />,
    },
  ];

  return (
    <Modal
      title={t("newmap.title")}
      show={show}
      size="small"
      onDismiss={onClose}
      footer={
        <Flex gap={8}>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="emphasized" onClick={() => onCreate(type)}>
            {t("newmap.create")}
          </Button>
        </Flex>
      }
    >
      <div className="mapa-typecards" role="radiogroup" aria-label={t("newmap.title")}>
        {OPTIONS.map((o) => (
          <button
            type="button"
            key={o.value}
            role="radio"
            aria-checked={type === o.value}
            className={`mapa-typecard${type === o.value ? " mapa-typecard-on" : ""}`}
            onClick={() => setType(o.value)}
          >
            <span className="mapa-typecard-icon">{o.icon}</span>
            <span className="mapa-typecard-body">
              <span className="mapa-typecard-title">{o.title}</span>
              <span className="mapa-typecard-desc">{o.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
};
