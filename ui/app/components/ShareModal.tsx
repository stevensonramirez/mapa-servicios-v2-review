import React, { useEffect, useRef, useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Modal } from "@dynatrace/strato-components/overlays";
import { Menu } from "@dynatrace/strato-components/navigation";
import {
  ViewIcon,
  EditIcon,
  InformationIcon,
  ChevronDownIcon,
  CheckmarkIcon,
  AccountIcon,
  AiIcon,
} from "@dynatrace/strato-icons";
import { useMapShare } from "./useMapShare";
import type { ShareRole, FoundUser } from "./useMapShare";
import { ANALYST_ROLE_ENABLED } from "./analystRole";
import { useT } from "../i18n";

type Props = {
  show: boolean;
  documentId: string | null;
  mapName: string;
  onClose: () => void;
};

const ROLE_META: Record<ShareRole, { icon: React.ReactNode }> = {
  read: { icon: <ViewIcon size={14} /> },
  analyst: { icon: <AiIcon size={14} /> },
  "read-write": { icon: <EditIcon size={14} /> },
};

// Selector de rol como DESPLEGABLE (igual que el "Can view / Can edit" de
// Notebooks): el ítem activo va en violeta con un checkmark.
const RoleSelect = ({
  value,
  onChange,
  onRemove,
  disabled,
  allowAnalyst = false,
  size = "md",
}: {
  value: ShareRole;
  onChange: (r: ShareRole) => void;
  onRemove?: () => void; // si se pasa, agrega la opción "Quitar acceso" al menú
  disabled?: boolean;
  allowAnalyst?: boolean; // ofrecer «Analista» (solo personas y con el interruptor encendido)
  size?: "md" | "sm";
}) => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const cur = ROLE_META[value];

  const roleLabel = (r: ShareRole): string =>
    r === "read" ? t("share.readOnly") : r === "analyst" ? t("share.analyst") : t("share.readWrite");

  const option = (r: ShareRole) => (
    <Menu.Item
      className={`mapa-roledd-item${value === r ? " mapa-roledd-item-on" : ""}`}
      onSelect={() => {
        if (r !== value) onChange(r);
      }}
    >
      <Menu.Prefix>{ROLE_META[r].icon}</Menu.Prefix>
      {roleLabel(r)}
      {value === r && (
        <Menu.Suffix>
          <CheckmarkIcon size={14} />
        </Menu.Suffix>
      )}
    </Menu.Item>
  );
  return (
    <Menu onOpenChange={setOpen}>
      <Menu.Trigger>
        <button
          type="button"
          className={`mapa-roledd mapa-roledd-${size}`}
          disabled={disabled}
          aria-label={t("share.accessLevel")}
        >
          {cur.icon}
          <span className="mapa-roledd-label">{roleLabel(value)}</span>
          <span className={`mapa-roledd-caret${open ? " mapa-roledd-caret-open" : ""}`}>
            <ChevronDownIcon size={12} />
          </span>
        </button>
      </Menu.Trigger>
      <Menu.Content>
        {option("read")}
        {(allowAnalyst || value === "analyst") && option("analyst")}
        {option("read-write")}
        {onRemove && (
          <Menu.Item className="mapa-roledd-remove" onSelect={onRemove}>
            {t("share.removeAccess")}
          </Menu.Item>
        )}
      </Menu.Content>
    </Menu>
  );
};

// Menú de compartir un mapa, parecido al de Notebooks pero acotado a nuestro
// caso: compartir escribiendo el CORREO de la persona y elegir Solo lectura o
// Edición. Quien comparte usa sus propios permisos (Forma A).
export const ShareModal = ({ show, documentId, mapName, onClose }: Props) => {
  const t = useT();
  const { owner, recipients, loading, busy, error, info, locked, searchUsers, assignAccess, revoke } = useMapShare(
    show ? documentId : null,
  );

  const [query, setQuery] = useState("");
  const [role, setRole] = useState<ShareRole>("read");
  const [notify, setNotify] = useState(true);
  const [rolesInfo, setRolesInfo] = useState(false); // ℹ️ qué hace cada rol
  const [results, setResults] = useState<FoundUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Al cerrar/abrir, limpiar el buscador.
  useEffect(() => {
    if (!show) {
      setQuery("");
      setResults([]);
      setOpen(false);
    }
  }, [show]);

  // Búsqueda con debounce (mínimo 3 caracteres).
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (query.trim().length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    // Guarda contra resultados viejos: si la query cambia (o el modal se cierra)
    // mientras searchUsers está en vuelo, no pintamos su respuesta.
    let cancelled = false;
    setSearching(true);
    timer.current = setTimeout(() => {
      void (async () => {
        const found = await searchUsers(query);
        if (cancelled) return;
        setResults(found);
        setSearching(false);
        setOpen(true);
      })();
    }, 350);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, searchUsers]);

  const pick = async (u: FoundUser) => {
    setQuery("");
    setResults([]);
    setOpen(false);
    await assignAccess(u, role, notify);
  };

  return (
    <Modal
      title={t("share.title", { name: mapName })}
      show={show}
      size="small"
      onDismiss={onClose}
      footer={
        <Button variant="emphasized" onClick={onClose}>
          {t("common.done")}
        </Button>
      }
    >
      <Flex flexDirection="column" gap={16}>
        {/* ── Añadir personas por correo ─────────────────────────────── */}
        <div className="mapa-share-add">
          <div className="mapa-share-addrow">
            <div className="mapa-share-search">
              <input
                className="mapa-share-input"
                type="text"
                value={query}
                disabled={locked}
                placeholder={t("share.addEmail")}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => results.length > 0 && setOpen(true)}
                aria-label={t("share.emailLabel")}
              />
              {open && (
                <div className="mapa-share-results" role="listbox">
                  {searching && <div className="mapa-share-result-empty">{t("common.searching")}</div>}
                  {!searching && results.length === 0 && (
                    <div className="mapa-share-result-empty">{t("share.noMatch", { query: query.trim() })}</div>
                  )}
                  {!searching &&
                    results.map((u) => (
                      <button
                        type="button"
                        key={u.uid}
                        className="mapa-share-result"
                        onClick={() => void pick(u)}
                        role="option"
                      >
                        <span className="mapa-share-ico">
                          <AccountIcon size={20} />
                        </span>
                        <span className="mapa-share-id">
                          <span className="mapa-share-nameline">
                            <span className="mapa-share-name">{u.name}</span>
                            {u.type === "group" && <span className="mapa-share-grouptag">{t("share.groupTag")}</span>}
                          </span>
                          {u.email && <span className="mapa-share-email">{u.email}</span>}
                        </span>
                      </button>
                    ))}
                </div>
              )}
            </div>
            <RoleSelect value={role} onChange={setRole} disabled={busy || locked} allowAnalyst={ANALYST_ROLE_ENABLED} />
          </div>
          <label className="mapa-share-notify">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            {t("share.notify")}
          </label>
        </div>

        {locked && <div className="mapa-share-info">{t("share.analystLocked")}</div>}
        {error && <div className="mapa-share-error">{error}</div>}
        {info && <div className="mapa-share-info">{info}</div>}

        {/* ── Quién tiene acceso ─────────────────────────────────────── */}
        <div className="mapa-share-section">
          <span className="mapa-share-section-title mapa-share-title-row">
            {t("share.people")}
            {/* ℹ️ qué puede hacer cada rol (la explicación no queda fija en la UI) */}
            <button
              type="button"
              className="mapa-share-infobtn"
              onClick={() => setRolesInfo((v) => !v)}
              aria-expanded={rolesInfo}
              aria-label={t("share.rolesInfoTip")}
              title={t("share.rolesInfoTip")}
            >
              <InformationIcon size={14} />
            </button>
          </span>
          {rolesInfo && (
            <div className="mapa-share-note">
              <InformationIcon size={16} />
              <span>{t("share.rolesInfo")}</span>
            </div>
          )}

          {/* Propietario (tú) */}
          <div className="mapa-share-row">
            <span className="mapa-share-ico">
              <AccountIcon size={20} />
            </span>
            <span className="mapa-share-id">
              <span className="mapa-share-name">{owner.name}</span>
              <span className="mapa-share-email">{owner.email}</span>
            </span>
            <span className="mapa-share-ownertag">{t("share.owner")}</span>
          </div>

          {loading && <div className="mapa-share-result-empty">{t("common.loading")}</div>}
          {!loading && recipients.length === 0 && (
            <div className="mapa-share-hint">{t("share.noShared")}</div>
          )}
          {/* Mientras carga NO se renderizan filas: podían ser las del mapa
              ANTERIOR y un clic en su selector de rol concedía acceso en el
              documento equivocado. */}
          {!loading && recipients.map((r) => (
            <div key={r.uid} className="mapa-share-row">
              <span className="mapa-share-ico">
                <AccountIcon size={20} />
              </span>
              <span className="mapa-share-id">
                <span className="mapa-share-nameline">
                  <span className="mapa-share-name">{r.name}</span>
                  {r.type === "group" && <span className="mapa-share-grouptag">{t("share.groupTag")}</span>}
                </span>
                {r.email && <span className="mapa-share-email">{r.email}</span>}
              </span>
              <RoleSelect
                size="sm"
                value={r.role}
                disabled={busy || locked}
                allowAnalyst={ANALYST_ROLE_ENABLED && r.type !== "group"}
                onChange={(nr) => {
                  if (nr !== r.role) void assignAccess({ uid: r.uid, name: r.name, email: r.email, type: r.type === "group" ? "group" : "user" }, nr, false);
                }}
                onRemove={locked ? undefined : () => void revoke(r.uid)}
              />
            </div>
          ))}
        </div>

        {/* ── Nota: los nodos usan los permisos de datos de cada persona ── */}
        <div className="mapa-share-note">
          <InformationIcon size={16} />
          <span>{t("share.dqlNote")}</span>
        </div>
      </Flex>
    </Modal>
  );
};
