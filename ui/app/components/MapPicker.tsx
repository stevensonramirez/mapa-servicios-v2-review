import React, { useMemo, useState } from "react";
import { TextInput } from "@dynatrace/strato-components/forms";
import { useT } from "../i18n";
import { useMapLibraryContext } from "./mapLibraryContext";
import { loadMapDoc, isNestableChild } from "./submapDocs";

// ── Selector de Mapa de Servicio (nodo de mapa incrustado) ───────────────────
// Misma fuente de datos que la barra lateral (la biblioteca de mapas) y el mismo
// estilo del selector de entidad: filtro por nombre + lista. Se excluyen el mapa
// ABIERTO (auto-referencia) y los Mapas Padre: un Mapa Padre solo incrusta Mapas
// de Servicio.
//
// Al ELEGIR se revalida contra el documento: el tipo de la lista sale de la
// metadata, y un documento viejo o importado podría traer mapas incrustados sin
// estar marcado como padre. Se valida SOLO el candidato — pre-descargar todos los
// documentos para filtrar la lista costaría tiempo y datos por mapas que el
// usuario ni va a mirar. La descarga queda cacheada y la reusa la evaluación.

type MapRef = { id: string; name: string };

type Props = {
  value?: MapRef;
  excludeId: string | null;
  // Mapas ya incrustados en otros nodos del padre: no se ofrecen de nuevo.
  usedIds?: string[];
  onChange: (ref: MapRef) => void;
};

export const MapPicker = ({ value, excludeId, usedIds, onChange }: Props) => {
  const t = useT();
  const { maps, loadSnapshot } = useMapLibraryContext();
  const [term, setTerm] = useState("");
  // Id del mapa que se está validando (para el estado "validando…") y mensaje
  // del último rechazo (Mapa Padre o documento ilegible).
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);

  const results = useMemo(() => {
    const q = term.trim().toLowerCase();
    return maps.filter(
      (m) =>
        m.id !== excludeId &&
        m.mapType !== "parent" &&
        !usedIds?.includes(m.id) &&
        (!q || m.name.toLowerCase().includes(q)),
    );
  }, [maps, excludeId, usedIds, term]);

  const pick = (m: MapRef) => {
    setRejected(null);
    setCheckingId(m.id);
    void loadMapDoc(m.id, loadSnapshot)
      .then((snap) => {
        if (!isNestableChild(snap)) {
          setRejected(t("submap.nestedRejected"));
          return;
        }
        onChange({ id: m.id, name: m.name });
      })
      .catch(() => setRejected(t("submap.checkFailed")))
      .finally(() => setCheckingId(null));
  };

  return (
    <div className="mapa-entpicker">
      <div className="mapa-entpicker-controls">
        <TextInput value={term} onChange={setTerm} placeholder={t("submap.searchPlaceholder")} />
      </div>

      {value?.id && <div className="mapa-entpicker-current">{t("submap.current", { name: value.name || value.id })}</div>}
      {rejected && <div className="mapa-entpicker-current">{rejected}</div>}

      <div className="mapa-entpicker-list nowheel">
        {results.length === 0 ? (
          <div className="mapa-entpicker-msg">{t("submap.noMaps")}</div>
        ) : (
          results.map((m) => (
            <button
              type="button"
              key={m.id}
              className={`mapa-entpicker-row${m.id === value?.id ? " mapa-entpicker-row-on" : ""}`}
              disabled={checkingId !== null}
              onClick={() => pick(m)}
            >
              <span className="mapa-entpicker-name">{m.name}</span>
              {checkingId === m.id && <span className="mapa-entpicker-type">{t("submap.checking")}</span>}
            </button>
          ))
        )}
      </div>
    </div>
  );
};
