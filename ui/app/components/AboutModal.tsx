import React from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Modal } from "@dynatrace/strato-components/overlays";
import { Paragraph } from "@dynatrace/strato-components/typography";
import { getAppVersion } from "@dynatrace-sdk/app-environment";
import { useT } from "../i18n";

type Props = {
  show: boolean;
  onClose: () => void;
};

// Modal "Acerca de" — información de la app y versión.
export const AboutModal = ({ show, onClose }: Props) => {
  const t = useT();
  // Versión real desde el manifiesto (app.config.json) — no se queda obsoleta al
  // subir la versión. Si el runtime no está, el SDK devuelve "dt.missing.app.version".
  const rawVersion = getAppVersion();
  const APP_VERSION = rawVersion && !rawVersion.startsWith("dt.missing") ? rawVersion : "";

  const footer = (
    <Flex gap={8}>
      <Button variant="emphasized" onClick={onClose}>
        {t("common.done")}
      </Button>
    </Flex>
  );

  return (
    <Modal
      title={t("about.title")}
      show={show}
      size="small"
      onDismiss={onClose}
      footer={footer}
    >
      <Flex flexDirection="column" gap={12}>
        {APP_VERSION && (
          <Paragraph>
            <strong>{t("about.versionLabel")}:</strong> {APP_VERSION}
          </Paragraph>
        )}
        <Paragraph>
          {t("about.what")}
        </Paragraph>
        <Paragraph style={{ fontStyle: "italic", opacity: 0.75 }}>
          {t("about.note")}
        </Paragraph>
        <Paragraph style={{ fontSize: 12, opacity: 0.6 }}>
          2026 · stevenson.ramirez@dynatrace.com
        </Paragraph>
      </Flex>
    </Modal>
  );
};
