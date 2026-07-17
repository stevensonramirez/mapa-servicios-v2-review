import React, { useEffect, useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Modal } from "@dynatrace/strato-components/overlays";
import { Paragraph } from "@dynatrace/strato-components/typography";
import { TRASH_RETENTION_DAYS } from "./useMapPersistence";
import type { TrashedMap } from "./useMapPersistence";
import { useT } from "../i18n";

type Props = {
  show: boolean;
  onClose: () => void;
  loadTrash: () => Promise<TrashedMap[]>;
  onRestore: (id: string) => Promise<void>;
};

const fmtDate = (iso: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

// Días que faltan para la purga automática (retención fija de la plataforma).
const daysLeft = (iso: string): number | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const since = (Date.now() - d.getTime()) / 86_400_000;
  return Math.max(0, Math.ceil(TRASH_RETENTION_DAYS - since));
};

// Papelera de mapas: usa la papelera nativa del Document service. Restaurar es
// aditivo (el mapa vuelve a la lista). NO hay borrado permanente desde aquí.
export const TrashModal = ({ show, onClose, loadTrash, onRestore }: Props) => {
  const t = useT();
  const [items, setItems] = useState<TrashedMap[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    setItems(null);
    setError(null);
    void (async () => {
      try {
        const list = await loadTrash();
        if (!cancelled) setItems(list);
      } catch {
        if (!cancelled) setError(t("trash.loadError"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [show, loadTrash, t]);

  const restore = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await onRestore(id);
      setItems((prev) => (prev ? prev.filter((m) => m.id !== id) : prev));
    } catch {
      setError(t("trash.restoreError"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title={t("trash.title")}
      show={show}
      size="medium"
      onDismiss={onClose}
      footer={
        <Button variant="emphasized" onClick={onClose}>
          {t("common.close")}
        </Button>
      }
    >
      <Flex flexDirection="column" gap={12}>
        <Paragraph>
          {t("trash.retention", { days: String(TRASH_RETENTION_DAYS) })}
        </Paragraph>
        {items === null && !error && <Paragraph>{t("trash.loading")}</Paragraph>}
        {error && <Paragraph>{error}</Paragraph>}
        {items && items.length === 0 && <Paragraph>{t("trash.empty")}</Paragraph>}
        {items && items.length > 0 && (
          <div className="mapa-trash-list">
            {items.map((m) => {
              const left = daysLeft(m.deletedTime);
              return (
                <div key={m.id} className="mapa-trash-row">
                  <div className="mapa-trash-info">
                    <span className="mapa-trash-name">{m.name}</span>
                    <span className="mapa-trash-meta">
                      {t("trash.deletedAt", { date: fmtDate(m.deletedTime) })}
                      {left !== null && " " + (left === 1 ? t("trash.daysLeft", { days: left }) : t("trash.daysLeftPl", { days: left }))}
                    </span>
                  </div>
                  <Button onClick={() => void restore(m.id)} disabled={busy === m.id}>
                    {busy === m.id ? t("common.restoring") : t("common.restore")}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Flex>
    </Modal>
  );
};
