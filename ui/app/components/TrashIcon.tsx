import React from "react";

// Ícono de papelera para los botones de eliminar (nodo, título, conexión).
// `label` (traducido) para el nombre accesible; el botón que lo envuelve ya
// suele aportar su propio aria-label, así que es opcional.
export const TrashIcon = ({ size = 16, label = "Eliminar" }: { size?: number; label?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    role="img"
    aria-label={label}
  >
    <title>{label}</title>
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);
