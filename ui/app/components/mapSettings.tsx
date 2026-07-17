import type { RcAnalysis } from "./rootCause";
import { createContext, useContext } from "react";

// Ajustes POR MAPA (viajan dentro del documento del mapa). Pensado para que más
// adelante cada mapa abierto tenga su propia configuración independiente.
export type BrandIconStyle = "color" | "mono";

// Nivel de glow para cada estado de severidad.
export type GlowLevel = "none" | "medium" | "high";
export type GlowSettings = { ok: GlowLevel; warn: GlowLevel; err: GlowLevel };

export type MapSettings = {
  // Cómo se pintan los logos de marca (nube/devops): a color real o monocromo
  // de línea (coherente con el tema claro/oscuro de Dynatrace).
  brandIconStyle: BrandIconStyle;
  // Cada cuánto se re-ejecutan los DQL de los nodos (ms). 0 = manual (sin auto).
  refreshIntervalMs: number;
  // Cadencia de un MAPA PADRE (ms): 5 min, 10 min o 0 = manual. Un mapa padre NO
  // usa `refreshIntervalMs`: todo su contenido (DQL, Davis y la evaluación de los
  // Mapas de Servicio incrustados) se actualiza de una sola vez a esta cadencia.
  // En un Mapa de Servicio el campo se ignora.
  parentRefreshMs?: number;
  // Nivel de glow animado por estado (ninguno / medio / alto). Por defecto: medio.
  glow?: GlowSettings;
  // Mostrar la leyenda de consumo estimado de Grail (abajo-derecha del lienzo).
  // Por defecto: true. Los mapas viejos sin el campo se tratan como true.
  showQueryCost?: boolean;
  // OBSOLETO (hasta oct-2026): análisis con IA de la burbuja, apagado por
  // defecto. Muchos mapas lo tienen guardado en `false` solo porque era el
  // default, así que YA NO SE LEE: lo reemplaza `copilotOff`.
  aiInsights?: boolean;
  // Análisis con IA dentro de la burbuja (tarjeta de Davis CoPilot e «Investigar
  // a fondo»). ENCENDIDO en todos los mapas (oct-2026: el cliente usa las 3 IAs
  // —CoPilot, Assist y causa raíz— y decidirá más adelante si retira alguna).
  // Solo `copilotOff === true` lo apaga, y solo si alguien lo apaga a propósito.
  copilotOff?: boolean;
  // Plantilla PERSONALIZADA del prompt que se copia al abrir Dynatrace Assist
  // (variables {problems}/{name}/{entity}/{state}). Sin valor (o en blanco) se
  // usa el default del idioma activo; el texto personalizado manda sobre el
  // idioma de la interfaz.
  assistPrompt?: string;
  // Último ANÁLISIS DE CAUSA RAÍZ (botón «Causa raíz»): se guarda en el mapa para
  // que todos vean el mismo resultado sin volver a ejecutar la IA. Lo escribe solo
  // un editor; en solo lectura se muestra tal cual.
  rootCause?: RcAnalysis;
};

// Opciones de frecuencia de actualización ofrecidas en Ajustes.
export const REFRESH_OPTIONS: { value: number; label: string }[] = [
  { value: 10_000, label: "10 s" },
  { value: 30_000, label: "30 s" },
  { value: 60_000, label: "1 min" },
  { value: 300_000, label: "5 min" },
  { value: 0, label: "Manual" },
];

// Cadencias ofrecidas a un mapa padre. El mínimo son 5 min a propósito: un padre
// consulta de golpe lo suyo MÁS lo de cada mapa incrustado.
export const DEFAULT_PARENT_REFRESH_MS = 600_000;
export const PARENT_REFRESH_OPTIONS: number[] = [300_000, 600_000, 0];

// Saneo del valor persistido (puede venir corrupto de un JSON importado o de una
// versión futura): fuera del catálogo → el default de 10 min.
export const clampParentRefresh = (v: unknown): number =>
  typeof v === "number" && PARENT_REFRESH_OPTIONS.includes(v) ? v : DEFAULT_PARENT_REFRESH_MS;

export const DEFAULT_GLOW: GlowSettings = { ok: "medium", warn: "medium", err: "medium" };

export const DEFAULT_SETTINGS: MapSettings = {
  brandIconStyle: "color",
  refreshIntervalMs: 60_000,
  parentRefreshMs: DEFAULT_PARENT_REFRESH_MS,
  glow: DEFAULT_GLOW,
  showQueryCost: true,
};

export const MapSettingsContext = createContext<MapSettings>(DEFAULT_SETTINGS);
export const useMapSettings = () => useContext(MapSettingsContext);
