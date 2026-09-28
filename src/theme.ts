import { STORAGE_PREFIX } from './storage';

export type ThemeName = 'dark' | 'light' | 'corkboard';

/** Orden en que el botón de la barra (y la tecla t) recorre los temas. */
export const THEMES: { id: ThemeName; label: string; glyph: string }[] = [
  { id: 'corkboard', label: 'corcho', glyph: '⊕' },
  { id: 'dark', label: 'oscuro', glyph: '☾' },
  { id: 'light', label: 'claro', glyph: '☀' },
];

export const themeInfo = (id: ThemeName) => THEMES.find((t) => t.id === id) ?? THEMES[0];

export function nextTheme(id: ThemeName): ThemeName {
  const index = THEMES.findIndex((t) => t.id === id);
  return THEMES[(index + 1) % THEMES.length].id;
}

/**
 * El canvas no puede leer variables CSS mientras pinta, así que el tema vive
 * dos veces: en `styles.css` para el DOM y acá para el lienzo. Los nombres son
 * los mismos a propósito.
 *
 * Estética: terminal (todo monoespaciado, trazo firme), cartoon (contornos
 * gruesos, colores planos, cero degradados) y mínima (una sola familia de
 * acentos, mucho aire). El tema corcho es el mismo idioma sobre un tablero:
 * fondo de corcho, etiquetas de papel, hilos de lana y chinches.
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
  /** Textura de fondo en vez de color liso. */
  texture?: 'cork';
  /** Papelito detrás de cada etiqueta, para que se lea sobre un fondo con textura. */
  labelTag?: string;
  labelTagEdge?: string;
  /** Los nodos movidos a mano se marcan con una chinche en vez de un punto. */
  pushpin?: boolean;
  /** Fichas de papel y carpetas manila clavadas, en lugar de los iconos planos. */
  icons?: 'pinned';
  /** Cabeza de la chinche de los nodos que no se movieron. */
  pinHead?: string;
  /** Las aristas curvas se dibujan como hilo que cuelga entre chinches. */
  yarn?: boolean;
  /** Conectores del árbol: trazo cortado y grosor propios del tema. */
  linkDash?: number[];
  linkWidth?: number;
  /** Sombra de las aristas resaltadas: el hilo se despega del tablero. */
  stringShadow?: string;
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
  corkboard: {
    bg: '#c49a6c',
    ink: '#2a1c10',
    // Hilo de atar: la jerarquía se lee como piolín entre fichas.
    link: 'rgba(58, 36, 16, 0.55)',
    groupFill: 'rgba(255, 250, 238, 0.72)',
    groupStroke: 'rgba(58, 36, 16, 0.5)',
    groupText: '#3b2a1a',
    edge: 'rgba(150, 32, 32, 0.32)',
    // Lana roja para lo que importa, azul para quién lo importa: el tablero de
    // detective de siempre, sin perder la distinción de sentido.
    edgeOut: '#c62828',
    edgeIn: '#1f4e8c',
    label: '#23170c',
    labelMuted: '#5a4632',
    labelDim: 'rgba(35, 23, 12, 0.45)',
    ring: '#23170c',
    match: '#e0a800',
    pin: '#d32f2f',
    font: MONO,
    texture: 'cork',
    labelTag: '#fffaf0',
    labelTagEdge: 'rgba(58, 36, 16, 0.35)',
    pushpin: true,
    icons: 'pinned',
    pinHead: '#efe6d2',
    yarn: true,
    linkDash: [5, 4],
    linkWidth: 1.5,
    stringShadow: 'rgba(40, 20, 5, 0.4)',
  },
};

const STORAGE_KEY = `${STORAGE_PREFIX}theme`;

/** Sin elección guardada, arranca en corcho: es el tablero que le da nombre a la app. */
export function readTheme(): ThemeName {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && THEMES.some((t) => t.id === saved)) return saved as ThemeName;
  return 'corkboard';
}

export function persistTheme(theme: ThemeName) {
  localStorage.setItem(STORAGE_KEY, theme);
  document.documentElement.dataset.theme = theme;
}
