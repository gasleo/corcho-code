import { STORAGE_PREFIX } from './storage';
export type ThemeName = 'dark' | 'light';

/**
 * El canvas no puede leer variables CSS mientras pinta, así que el tema vive
 * dos veces: en `styles.css` para el DOM y acá para el lienzo. Los nombres son
 * los mismos a propósito.
 *
 * Estética: terminal (todo monoespaciado, trazo firme), cartoon (contornos
 * gruesos, colores planos, cero degradados) y mínima (una sola familia de
 * acentos, mucho aire).
 */
export interface CanvasPalette {
  bg: string;
  /** Contorno negro de los iconos: igual en ambos temas, como una viñeta. */
  ink: string;
  /** Conectores de la jerarquía. */
  link: string;
  groupFill: string;
  groupStroke: string;
  groupText: string;
  /** Import sin resaltar. */
  edge: string;
  /** Lo que el nodo activo importa. */
  edgeOut: string;
  /** Quién importa al nodo activo. */
  edgeIn: string;
  label: string;
  labelMuted: string;
  labelDim: string;
  ring: string;
  match: string;
  pin: string;
  /** Tipografía del lienzo: la misma mono que el resto de la interfaz. */
  font: string;
}

const MONO = "'Cascadia Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace";

export const CANVAS_THEME: Record<ThemeName, CanvasPalette> = {
  dark: {
    bg: '#14161c',
    ink: '#0a0b0f',
    link: 'rgba(233,231,222,0.32)',
    groupFill: 'rgba(233,231,222,0.04)',
    groupStroke: 'rgba(233,231,222,0.28)',
    groupText: '#8d8f98',
    edge: 'rgba(233,231,222,0.18)',
    edgeOut: '#3ddad7',
    edgeIn: '#ff6b9d',
    label: '#e9e7de',
    labelMuted: '#8d8f98',
    labelDim: '#4b4f5a',
    ring: '#e9e7de',
    match: '#ffc24b',
    pin: '#3ddad7',
    font: MONO,
  },
  light: {
    bg: '#f4f1e8',
    ink: '#14161a',
    link: 'rgba(20,22,26,0.42)',
    groupFill: 'rgba(20,22,26,0.035)',
    groupStroke: 'rgba(20,22,26,0.3)',
    groupText: '#6b6d75',
    edge: 'rgba(20,22,26,0.22)',
    edgeOut: '#0f8f8c',
    edgeIn: '#d63d75',
    label: '#14161a',
    labelMuted: '#6b6d75',
    labelDim: '#9b998f',
    ring: '#14161a',
    match: '#b06a00',
    pin: '#0f8f8c',
    font: MONO,
  },
};

const STORAGE_KEY = `${STORAGE_PREFIX}theme`;

export function readTheme(): ThemeName {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function persistTheme(theme: ThemeName) {
  localStorage.setItem(STORAGE_KEY, theme);
  document.documentElement.dataset.theme = theme;
}
