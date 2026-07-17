import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Modal } from "@dynatrace/strato-components/overlays";
import { Paragraph } from "@dynatrace/strato-components/typography";
import { useMapLibrary, cleanSnapshot, MAX_DOC_BYTES } from "./useMapPersistence";
import type { MapSnapshot } from "./useMapPersistence";
import { validateMapContent } from "./mapValidation";
import type { InvalidMap } from "./mapValidation";
import { invalidReasonText } from "./invalidMapText";
import type { MapType } from "./useMapPersistence";
import { NewMapModal } from "./NewMapModal";
import { useT } from "../i18n";

// Proveedor de la BIBLIOTECA de mapas. Sube `useMapLibrary` por encima de la
// página para que tanto el header global (botones "Nuevo mapa" / "Importar",
// estilo Notebooks) como el lienzo (MapCanvas) compartan el MISMO estado: una
// sola carga, un solo mapa activo. Además centraliza la importación (input
// oculto + validación) y los avisos (modal), que antes vivían en MapCanvas.

type MapLibrary = ReturnType<typeof useMapLibrary>;
type MapLibraryContextValue = MapLibrary & {
  onNewMap: () => void;
  onImportClick: () => void;
  setNotice: (msg: string | null) => void;
};

const MapLibraryContext = createContext<MapLibraryContextValue | null>(null);

export const useMapLibraryContext = (): MapLibraryContextValue => {
  const ctx = useContext(MapLibraryContext);
  if (!ctx) throw new Error("useMapLibraryContext debe usarse dentro de <MapLibraryProvider>");
  return ctx;
};

export const MapLibraryProvider = ({ children }: { children: React.ReactNode }) => {
  const t = useT();
  const lib = useMapLibrary();
  const { maps, createMap } = lib;
  const [notice, setNotice] = useState<string | null>(null);
  // Archivo importado con contenido que NO tiene el formato de la app → aviso.
  const [invalidImport, setInvalidImport] = useState<InvalidMap | null>(null);
  // Modal de "¿qué tipo de mapa?": el tipo se fija al crear y ya no cambia.
  const [newMapOpen, setNewMapOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  // Errores de operaciones de la biblioteca (borrar/renombrar/duplicar/abrir):
  // antes iban a `loadError` y NADIE los mostraba — el usuario confirmaba
  // "mover a la papelera" y no pasaba nada, sin mensaje. Los surfaceamos aquí.
  // Se omite el error de la carga inicial (esa ya tiene su estado vacío propio).
  const lastErrRef = useRef<unknown>(null);
  useEffect(() => {
    if (lib.loadError == null || lib.loadError === lastErrRef.current) return;
    lastErrRef.current = lib.loadError;
    if (lib.loading) return; // fallo de la carga inicial: lo cubre el estado vacío
    setNotice(t("lib.opFail"));
  }, [lib.loadError, lib.loading, t]);

  // Nuevo mapa: primero se pregunta el tipo (Mapa de Servicio o Mapa Padre) y
  // luego se crea en blanco (queda activo; se puede renombrar desde la lista).
  const onNewMap = useCallback(() => setNewMapOpen(true), []);
  const onCreateTyped = useCallback(
    (type: MapType) => {
      setNewMapOpen(false);
      void createMap(t("lib.newMapName", { n: maps.length + 1 }), undefined, type);
    },
    [createMap, maps.length, t],
  );

  const onImportClick = useCallback(() => importInputRef.current?.click(), []);

  // Importar: lee un JSON, valida la forma y crea un mapa NUEVO con ese contenido
  // (no pisa el mapa actual). Resetea severidades vía cleanSnapshot.
  const onImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // permite reimportar el mismo archivo
      if (!file) return;
      // Tope de tamaño ANTES de leer: un archivo gigante (elegido por error)
      // congelaría la pestaña en file.text() + JSON.parse, y el backend igual
      // lo rechazaría (límite del Document service).
      if (file.size > MAX_DOC_BYTES) {
        setNotice(t("lib.importTooBig"));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        parsed = undefined;
      }
      // Validación ESTRICTA: solo entra un mapa con el formato exacto de la app
      // (lo que produce «Descargar»). Sin reparar nada: si no cuadra, no sirve.
      const invalid = validateMapContent(parsed);
      if (invalid) {
        setInvalidImport(invalid);
        return;
      }
      try {
        // Si ya existe un mapa con ese nombre, agregamos "(copia)" — y "(copia 2)",
        // "(copia 3)"… si también chocan — para no confundir dos mapas homónimos.
        const base = file.name.replace(/\.json$/i, "") || t("lib.importedName");
        const taken = new Set(maps.map((m) => m.name));
        let name = base;
        if (taken.has(name)) {
          const word = t("persist.copySuffix");
          name = `${base} (${word})`;
          let k = 2;
          while (taken.has(name)) name = `${base} (${word} ${k++})`;
        }
        const id = await createMap(name, cleanSnapshot(parsed as MapSnapshot));
        if (!id) setNotice(t("lib.importFail"));
      } catch {
        setNotice(t("lib.importFail"));
      }
    },
    [createMap, maps, t],
  );

  const value: MapLibraryContextValue = { ...lib, onNewMap, onImportClick, setNotice };

  return (
    <MapLibraryContext.Provider value={value}>
      {children}
      {/* Input de importación oculto (lo dispara el botón "Importar" del header). */}
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={(e) => void onImportFile(e)}
      />
      <NewMapModal show={newMapOpen} onCreate={onCreateTyped} onClose={() => setNewMapOpen(false)} />
      <Modal
        title={t("invalid.title")}
        show={invalidImport !== null}
        size="small"
        onDismiss={() => setInvalidImport(null)}
        footer={
          <Button variant="emphasized" onClick={() => setInvalidImport(null)}>
            {t("invalid.ok")}
          </Button>
        }
      >
        <Paragraph>{t("invalid.importText")}</Paragraph>
        {invalidImport && <Paragraph>{t("invalid.reason", { reason: invalidReasonText(t, invalidImport) })}</Paragraph>}
      </Modal>
      <Modal
        title={t("lib.notice")}
        show={notice !== null}
        size="small"
        onDismiss={() => setNotice(null)}
        footer={
          <Button variant="emphasized" onClick={() => setNotice(null)}>
            {t("common.close")}
          </Button>
        }
      >
        <Paragraph>{notice}</Paragraph>
      </Modal>
    </MapLibraryContext.Provider>
  );
};
