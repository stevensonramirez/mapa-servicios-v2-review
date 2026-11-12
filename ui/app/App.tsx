import { Page } from "@dynatrace/strato-components-preview/layouts";
import React from "react";
import { Route, Routes } from "react-router-dom";
import { Header } from "./components/Header";
import { Home } from "./pages/Home";
import { MapLibraryProvider } from "./components/mapLibraryContext";
import { LanguageProvider } from "./i18n";

export const App = () => {
  return (
    // LanguageProvider es el proveedor MÁS EXTERNO: todos los componentes
    // (header, sidebar, lienzo y modales) leen el idioma desde aquí.
    <LanguageProvider>
      {/* La biblioteca de mapas se comparte entre el header (botones Nuevo/Importar)
          y el lienzo, así que el proveedor envuelve toda la página. */}
      <MapLibraryProvider>
        <Page>
          <Page.Header>
            <Header />
          </Page.Header>
          <Page.Main className="mapa-page-main">
            <Routes>
              {/* Cada mapa tiene su propia URL (…/map/<id>) para poder copiar el
                  enlace y compartirlo. Ambas rutas montan el MISMO <Home /> (no se
                  remonta al pasar de "/" a "/map/:id"). */}
              <Route path="/" element={<Home />} />
              <Route path="/map/:id" element={<Home />} />
            </Routes>
          </Page.Main>
        </Page>
      </MapLibraryProvider>
    </LanguageProvider>
  );
};
