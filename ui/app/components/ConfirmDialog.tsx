import React from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Modal } from "@dynatrace/strato-components/overlays";
import { Paragraph } from "@dynatrace/strato-components/typography";
import { useT } from "../i18n";

type Props = {
  show: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

// Diálogo de confirmación reutilizable para acciones destructivas (borrar nodo,
// conexión o título). El borrado NUNCA ocurre sin pasar por aquí.
export const ConfirmDialog = ({
  show,
  title,
  message,
  confirmLabel = "Eliminar",
  onConfirm,
  onCancel,
}: Props) => {
  const t = useT();
  return (
    <Modal
      title={title ?? t("confirm.title")}
      show={show}
      size="small"
      onDismiss={onCancel}
      footer={
        <Flex gap={8}>
          <Button onClick={onCancel}>{t("common.cancel")}</Button>
          <Button variant="emphasized" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </Flex>
      }
    >
      <Paragraph>{message}</Paragraph>
    </Modal>
  );
};
