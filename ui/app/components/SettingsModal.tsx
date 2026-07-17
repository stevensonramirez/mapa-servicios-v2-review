import React, { useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex, Divider } from "@dynatrace/strato-components/layouts";
import { Switch, FormField, Label, TextArea } from "@dynatrace/strato-components/forms";
import { Modal } from "@dynatrace/strato-components/overlays";
import { Menu, Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { Paragraph } from "@dynatrace/strato-components/typography";
import { ChevronDownIcon, CheckmarkIcon } from "@dynatrace/strato-icons";
import { REFRESH_OPTIONS, PARENT_REFRESH_OPTIONS, DEFAULT_GLOW, clampParentRefresh } from "./mapSettings";
import type { MapSettings, GlowLevel } from "./mapSettings";
import { useT, useLang, LANGS } from "../i18n";
import type { Lang } from "../i18n";

type Props = {
  show: boolean;
  // El mapa abierto es un Mapa Padre: su cadencia propia sustituye a la
  // frecuencia de refresco de siempre (que ahí no aplica).
  isParentMap?: boolean;
  settings: MapSettings;
  onChange: (patch: Partial<MapSettings>) => void;
  onClose: () => void;
};

// Selector de frecuencia como DESPLEGABLE (mismo aspecto que el de rol del modal
// de permisos): botón compacto + chevron, ítem activo en violeta con checkmark.
const RefreshSelect = ({ value, onChange }: { value: number; onChange: (v: number) => void }) => {
  const t = useT();
  const [open, setOpen] = useState(false);

  const refreshLabel = (v: number): string => {
    const map: Record<number, string> = {
      10000:  t("refresh.10s"),
      30000:  t("refresh.30s"),
      60000:  t("refresh.1min"),
      300000: t("refresh.5min"),
      0:      t("refresh.manual"),
    };
    // Un intervalo fuera del catálogo (JSON importado/editado a mano) se muestra
    // con su valor REAL en segundos — antes el trigger "mentía" mostrando 1 min
    // mientras el sondeo corría al valor de verdad.
    return map[v] ?? `${Math.round(v / 1000)} s`;
  };

  return (
    <Menu onOpenChange={setOpen}>
      <Menu.Trigger>
        <button type="button" className="mapa-roledd mapa-roledd-md" aria-label={t("settings.refreshTrigger")}>
          <span className="mapa-roledd-label">{refreshLabel(value)}</span>
          <span className={`mapa-roledd-caret${open ? " mapa-roledd-caret-open" : ""}`}>
            <ChevronDownIcon size={12} />
          </span>
        </button>
      </Menu.Trigger>
      <Menu.Content>
        {REFRESH_OPTIONS.map((o) => (
          <Menu.Item
            key={o.value}
            className={`mapa-roledd-item${o.value === value ? " mapa-roledd-item-on" : ""}`}
            onSelect={() => {
              if (o.value !== value) onChange(o.value);
            }}
          >
            {refreshLabel(o.value)}
            {o.value === value && (
              <Menu.Suffix>
                <CheckmarkIcon size={14} />
              </Menu.Suffix>
            )}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu>
  );
};

// Cadencia de un Mapa Padre (5 min / 10 min / Manual), mismo patrón visual que
// RefreshSelect. Va aparte porque el catálogo y el sentido son otros: aquí el
// valor rige TODO el contenido del mapa de una sola vez, no solo los DQL.
const ParentRefreshSelect = ({ value, onChange }: { value: number; onChange: (v: number) => void }) => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const label = (v: number): string =>
    v === 0 ? t("refresh.manual") : v === 300_000 ? t("refresh.5min") : t("refresh.10min");
  return (
    <Menu onOpenChange={setOpen}>
      <Menu.Trigger>
        <button type="button" className="mapa-roledd mapa-roledd-md" aria-label={t("settings.parentRefreshTrigger")}>
          <span className="mapa-roledd-label">{label(value)}</span>
          <span className={`mapa-roledd-caret${open ? " mapa-roledd-caret-open" : ""}`}>
            <ChevronDownIcon size={12} />
          </span>
        </button>
      </Menu.Trigger>
      <Menu.Content>
        {PARENT_REFRESH_OPTIONS.map((v) => (
          <Menu.Item
            key={v}
            className={`mapa-roledd-item${v === value ? " mapa-roledd-item-on" : ""}`}
            onSelect={() => {
              if (v !== value) onChange(v);
            }}
          >
            {label(v)}
            {v === value && (
              <Menu.Suffix>
                <CheckmarkIcon size={14} />
              </Menu.Suffix>
            )}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu>
  );
};

// Selector de idioma, mismo patrón que RefreshSelect.
const LangSelect = ({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const cur = LANGS.find((l) => l.value === lang) ?? LANGS[0];
  return (
    <Menu onOpenChange={setOpen}>
      <Menu.Trigger>
        <button type="button" className="mapa-roledd mapa-roledd-md" aria-label={t("settings.langTrigger")}>
          <span className="mapa-roledd-label">{cur.label}</span>
          <span className={`mapa-roledd-caret${open ? " mapa-roledd-caret-open" : ""}`}>
            <ChevronDownIcon size={12} />
          </span>
        </button>
      </Menu.Trigger>
      <Menu.Content>
        {LANGS.map((l) => (
          <Menu.Item
            key={l.value}
            className={`mapa-roledd-item${l.value === lang ? " mapa-roledd-item-on" : ""}`}
            onSelect={() => {
              if (l.value !== lang) onChange(l.value);
            }}
          >
            {l.label}
            {l.value === lang && (
              <Menu.Suffix>
                <CheckmarkIcon size={14} />
              </Menu.Suffix>
            )}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu>
  );
};

// Selector de nivel de glow para un estado, mismo patrón que RefreshSelect.
const GlowSelect = ({ value, onChange }: { value: GlowLevel; onChange: (v: GlowLevel) => void }) => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const OPTS: { value: GlowLevel; label: string }[] = [
    { value: "none", label: t("glow.none") },
    { value: "medium", label: t("glow.medium") },
    { value: "high", label: t("glow.high") },
  ];
  const cur = OPTS.find((o) => o.value === value) ?? OPTS[1];
  return (
    <Menu onOpenChange={setOpen}>
      <Menu.Trigger>
        <button type="button" className="mapa-roledd mapa-roledd-md" aria-label={t("settings.glowTitle")}>
          <span className="mapa-roledd-label">{cur.label}</span>
          <span className={`mapa-roledd-caret${open ? " mapa-roledd-caret-open" : ""}`}>
            <ChevronDownIcon size={12} />
          </span>
        </button>
      </Menu.Trigger>
      <Menu.Content>
        {OPTS.map((o) => (
          <Menu.Item
            key={o.value}
            className={`mapa-roledd-item${o.value === value ? " mapa-roledd-item-on" : ""}`}
            onSelect={() => {
              if (o.value !== value) onChange(o.value);
            }}
          >
            {o.label}
            {o.value === value && (
              <Menu.Suffix>
                <CheckmarkIcon size={14} />
              </Menu.Suffix>
            )}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu>
  );
};

// Ajustes de ESTE mapa (se guardan dentro del documento del mapa).
export const SettingsModal = ({ show, isParentMap = false, settings, onChange, onClose }: Props) => {
  const t = useT();
  const { lang, setLang } = useLang();
  const color = settings.brandIconStyle === "color";
  return (
    <Modal
      title={t("settings.title")}
      show={show}
      size="small"
      onDismiss={onClose}
      footer={
        <Flex gap={8}>
          <Button variant="emphasized" onClick={onClose}>
            {t("common.done")}
          </Button>
        </Flex>
      }
    >
      <Tabs defaultIndex={0}>
        {/* Pestaña 1 — lo importante: cadencia + IA + prompt de Assist.
            TODAS las filas siguen el patrón de Settings de Dynatrace:
            etiqueta a la izquierda, control a la derecha. */}
        <Tab title={t("settings.tabMain")} keepMounted>
          <Flex flexDirection="column" gap={16} marginTop={12}>
            {isParentMap ? (
              <Flex flexDirection="column" gap={4}>
                <div className="mapa-set-row">
                  <span className="mapa-set-rowlabel">{t("settings.parentRefreshLabel")}</span>
                  <ParentRefreshSelect
                    value={clampParentRefresh(settings.parentRefreshMs)}
                    onChange={(v) => onChange({ parentRefreshMs: v })}
                  />
                </div>
                <Paragraph>{t("settings.parentRefreshDesc")}</Paragraph>
              </Flex>
            ) : (
              <Flex flexDirection="column" gap={4}>
                <div className="mapa-set-row">
                  <span className="mapa-set-rowlabel">{t("settings.refreshLabel")}</span>
                  <RefreshSelect
                    value={settings.refreshIntervalMs}
                    onChange={(v) => onChange({ refreshIntervalMs: v })}
                  />
                </div>
                <Paragraph>{t("settings.refreshDesc")}</Paragraph>
              </Flex>
            )}

            <Divider />

            {/* Análisis con IA en la burbuja "¿Por qué está así?". APAGADO por
                defecto: sin esto la burbuja no llama a Davis CoPilot (ni el
                análisis ni "Investigar a fondo"), solo muestra estado, problemas
                activos y los botones de Dynatrace Assist. */}
            <Flex flexDirection="column" gap={4}>
              <div className="mapa-set-row">
                <span className="mapa-set-rowlabel">{t("settings.aiLabel")}</span>
                <Switch
                  value={settings.copilotOff !== true}
                  onChange={(checked) => onChange({ copilotOff: !checked })}
                />
              </div>
              <Paragraph>{t("settings.aiDesc")}</Paragraph>
            </Flex>

            <Divider />

            {/* Plantilla del prompt de Dynatrace Assist. El texto personalizado
                se guarda en el mapa y manda sobre el idioma; "Restaurar" vuelve
                al default del idioma activo (assistPrompt queda sin valor).
                Editable siempre: los botones de Assist se ven con o sin el
                análisis con IA (oct-2026). */}
            <FormField>
              <Label>{t("settings.assistLabel")}</Label>
              <TextArea
                value={settings.assistPrompt ?? t("why.assistPrompt")}
                onChange={(v: string) => onChange({ assistPrompt: v })}
                rows={4}
                width="full"
                resize="vertical"
              />
              <Paragraph>{t("settings.assistDesc")}</Paragraph>
              <Flex justifyContent="flex-end">
                <button
                  type="button"
                  className="mapa-assist-restore"
                  disabled={settings.assistPrompt === undefined}
                  onClick={() => onChange({ assistPrompt: undefined })}
                >
                  {t("settings.assistRestore")}
                </button>
              </Flex>
            </FormField>
          </Flex>
        </Tab>

        {/* Pestaña 2 — apariencia: glow, logos, consumo e idioma. Mismo patrón
            de filas uniformes; sin vista previa de logos (era decoración) y
            dots de severidad planos, sin brillo. */}
        <Tab title={t("settings.tabLook")} keepMounted>
          <Flex flexDirection="column" gap={16} marginTop={12}>
            <FormField>
              <Label>{t("settings.glowTitle")}</Label>
              <div className="mapa-set-rows">
                {([
                  { k: "ok", sev: "sev.ok", color: "#0caf66" },
                  { k: "warn", sev: "sev.warn", color: "#dd8f00" },
                  { k: "err", sev: "sev.err", color: "#e0314a" },
                ] as const).map(({ k, sev, color }) => (
                  <div className="mapa-set-row" key={k}>
                    <span className="mapa-set-rowlabel">
                      <span className="mapa-glow-dot" style={{ color }} />
                      {t(sev)}
                    </span>
                    <GlowSelect
                      value={settings.glow?.[k] ?? "medium"}
                      onChange={(v) => onChange({ glow: { ...(settings.glow ?? DEFAULT_GLOW), [k]: v } })}
                    />
                  </div>
                ))}
              </div>
            </FormField>

            <Divider />

            <div className="mapa-set-row">
              <span className="mapa-set-rowlabel">{t("settings.brandColor")}</span>
              <Switch
                value={color}
                onChange={(checked) => onChange({ brandIconStyle: checked ? "color" : "mono" })}
              />
            </div>

            <Divider />

            <div className="mapa-set-row">
              <span className="mapa-set-rowlabel">{t("settings.costLabel")}</span>
              <Switch
                value={settings.showQueryCost !== false}
                onChange={(checked) => onChange({ showQueryCost: checked })}
              />
            </div>

            <Divider />

            <div className="mapa-set-row">
              <span className="mapa-set-rowlabel">{t("settings.language")}</span>
              <LangSelect lang={lang} onChange={setLang} />
            </div>
          </Flex>
        </Tab>
      </Tabs>
    </Modal>
  );
};
