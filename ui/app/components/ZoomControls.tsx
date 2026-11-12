import React from "react";
import { useReactFlow, useViewport } from "@xyflow/react";
import { ZoomInIcon, ZoomOutIcon, ZoomToFitIcon } from "@dynatrace/strato-icons";
import { useT } from "../i18n";

// Controles de zoom para la barra superior (reemplazan el <Controls> flotante de
// reactflow). Usan los íconos nativos de zoom de Dynatrace (Strato) para que se
// sientan parte de la plataforma. Componente aislado: useViewport re-renderiza en
// cada paneo/zoom, así que solo este pedacito se actualiza, no todo el lienzo.
export const ZoomControls = () => {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();
  const t = useT();
  return (
    <div className="mapa-zoom" role="group" aria-label={t("zoom.group")}>
      <button
        type="button"
        className="mapa-zoom-btn"
        onClick={() => void zoomOut({ duration: 200 })}
        title={t("zoom.out")}
        aria-label={t("zoom.out")}
      >
        <ZoomOutIcon size={16} />
      </button>
      <span className="mapa-zoom-pct">{Math.round(zoom * 100)}%</span>
      <button
        type="button"
        className="mapa-zoom-btn"
        onClick={() => void zoomIn({ duration: 200 })}
        title={t("zoom.in")}
        aria-label={t("zoom.in")}
      >
        <ZoomInIcon size={16} />
      </button>
      <button
        type="button"
        className="mapa-zoom-btn"
        onClick={() => void fitView({ padding: 0.2, duration: 300 })}
        title={t("zoom.fit")}
        aria-label={t("zoom.fit")}
      >
        <ZoomToFitIcon size={16} />
      </button>
    </div>
  );
};
