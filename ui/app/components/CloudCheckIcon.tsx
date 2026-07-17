import React from "react";

// Nubesita con un check dentro: indicador de "mapa guardado" en la barra.
// Strato no trae un ícono de nube, así que se dibuja a mano (mismo patrón que
// los demás íconos propios del proyecto).
export const CloudCheckIcon = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    role="img"
    aria-label="Guardado"
  >
    <title>Guardado</title>
    {/* Nube */}
    <path d="M7.3 18.3a4.1 4.1 0 0 1-.5-8.18 5.5 5.5 0 0 1 10.66-1.3A3.85 3.85 0 0 1 16.7 18.3H7.3z" />
    {/* Check dentro de la nube */}
    <path d="M9.4 13.7l1.9 1.9 3.5-3.8" />
  </svg>
);
