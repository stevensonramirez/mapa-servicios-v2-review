import React, { useState } from "react";
import { AppHeader, HelpMenu } from "@dynatrace/strato-components-preview/layouts";
import { PlusIcon, UploadIcon } from "@dynatrace/strato-icons";
import { useMapLibraryContext } from "./mapLibraryContext";
import { AboutModal } from "./AboutModal";
import { useT } from "../i18n";

// Header conforme al AppHeader Experience Standard (app sin tabs):
// logo automático + HelpMenu obligatorio. Las acciones de la biblioteca de mapas
// (Nuevo / Importar) van como ActionItems junto al nombre de la app, igual que
// "+ Notebook" / "Upload" en la app de Notebooks.
export const Header = () => {
  const { onNewMap, onImportClick } = useMapLibraryContext();
  const t = useT();
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <>
      <AppHeader>
        {/* AppHeader.ActionItems alinea su contenido a la DERECHA (justify-content:
            flex-end hardcodeado en dos niveles de Flex). La className propia lo fuerza
            a la IZQUIERDA por CSS, pegado al logo, como "+ Notebook"/"Upload" en Notebooks. */}
        <AppHeader.ActionItems className="mapa-headeractions">
          <AppHeader.ActionButton className="mapa-newmap-btn" prefixIcon={<PlusIcon />} onClick={onNewMap}>
            {t("header.newMap")}
          </AppHeader.ActionButton>
          <AppHeader.ActionButton className="mapa-import-btn" prefixIcon={<UploadIcon />} onClick={onImportClick}>
            {t("header.import")}
          </AppHeader.ActionButton>
        </AppHeader.ActionItems>
        <AppHeader.Menus>
          <HelpMenu
            entries={{
              documentation: [
                {
                  label: "Dynatrace Developer",
                  href: "https://developer.dynatrace.com",
                },
              ],
              about: { onSelect: () => setAboutOpen(true) },
            }}
          />
        </AppHeader.Menus>
      </AppHeader>
      <AboutModal show={aboutOpen} onClose={() => setAboutOpen(false)} />
    </>
  );
};
