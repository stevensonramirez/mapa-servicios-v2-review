import React, { useEffect, useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Modal } from "@dynatrace/strato-components/overlays";
import { Paragraph } from "@dynatrace/strato-components/typography";
import { useT } from "../i18n";
import { copyTextToClipboard } from "./clipboard";

type Props = {
  show: boolean;
  json: string | null;
  filename: string;
  onClose: () => void;
};

// Modal "Exportar JSON". En Safari/WebKit la descarga directa de archivos no es
// posible dentro del iframe de la app (WebKit ignora el atributo `download` e
// intenta navegar al archivo; el CSP de la plataforma lo bloquea y no es
// configurable por la app). Por eso mostramos el JSON listo para copiar o
// seleccionar a mano. En Chrome/Firefox la descarga es directa y este modal no
// aparece. El campo va sin truncar para que la copia/selección manual sea íntegra.
export const ExportModal = ({ show, json, filename, onClose }: Props) => {
  const t = useT();
  const [copied, setCopied] = useState(false);

  // Reiniciar el estado "Copiado" cada vez que se abre el modal.
  useEffect(() => {
    if (show) setCopied(false);
  }, [show]);

  const onCopy = async () => {
    const ok = await copyTextToClipboard(json ?? "");
    setCopied(ok);
  };

  // No se cierra al copiar: si el portapapeles fallara, queda el campo para
  // seleccionar y copiar a mano. Solo cierra con "Listo".
  const footer = (
    <Flex gap={8}>
      <Button variant="emphasized" onClick={() => void onCopy()}>
        {copied ? t("export.copied") : t("export.copy")}
      </Button>
      <Button onClick={onClose}>{t("common.done")}</Button>
    </Flex>
  );

  return (
    <Modal title={t("export.title")} show={show} size="large" onDismiss={onClose} footer={footer}>
      <Flex flexDirection="column" gap={12}>
        <Paragraph>{t("export.hint", { filename })}</Paragraph>
        <textarea
          readOnly
          value={json ?? ""}
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.currentTarget.select()}
          spellCheck={false}
          aria-label={t("export.title")}
          style={{
            width: "100%",
            minHeight: 320,
            resize: "vertical",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: 12,
            lineHeight: 1.5,
            padding: 12,
            borderRadius: 4,
            border: "1px solid var(--dt-colors-border-neutral-default, #d0d0d0)",
            background: "var(--dt-colors-background-container-neutral-default, #f6f6f6)",
            color: "var(--dt-colors-text-neutral-default, inherit)",
            boxSizing: "border-box",
            whiteSpace: "pre",
            overflow: "auto",
          }}
        />
      </Flex>
    </Modal>
  );
};
