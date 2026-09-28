import { CANVAS_THEME, type CanvasPalette, type ThemeName } from './theme';
import { STORAGE_PREFIX } from './storage';

export type EdgeShape = 'curve' | 'orthogonal';

/** Colores que el usuario puede tocar, con dónde impacta cada uno. */
export interface ColorSpec {
  key: string;
  label: string;
  hint: string;
  /** Variables CSS que pinta. */
  vars: string[];
}

export const COLOR_KEYS: ColorSpec[] = [
  { key: 'accent', label: 'acento', hint: 'botones, enlaces y las aristas de «importa»', vars: ['--accent'] },
  { key: 'in', label: 'lo importan', hint: 'aristas entrantes y su leyenda', vars: ['--in'] },
  { key: 'bg', label: 'fondo', hint: 'lienzo y fondo del código', vars: ['--bg'] },
  { key: 'surface', label: 'paneles', hint: 'barras, paneles y ventanas', vars: ['--surface'] },
  { key: 'text', label: 'texto', hint: 'texto general y etiquetas del lienzo', vars: ['--text'] },
  { key: 'ok', label: 'exports', hint: 'símbolos que el fichero exporta', vars: ['--ok'] },
  { key: 'warn', label: 'coincidencias', hint: 'resultados del filtro', vars: ['--warn'] },
];

export type ColorOverrides = Partial<Record<string, string>>;

export interface Settings {
  edgeShape: EdgeShape;
  /** Un juego de colores por tema: lo que va bien en oscuro no va en claro. */
  colors: Record<ThemeName, ColorOverrides>;
}

export const DEFAULT_SETTINGS: Settings = {
  edgeShape: 'curve',
  colors: { dark: {}, light: {} },
};

const KEY = `${STORAGE_PREFIX}settings`;

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const saved = JSON.parse(raw) as Partial<Settings>;
    return {
      edgeShape: saved.edgeShape === 'orthogonal' ? 'orthogonal' : 'curve',
      colors: {
        dark: saved.colors?.dark ?? {},
        light: saved.colors?.light ?? {},
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // sin localStorage se sigue trabajando igual
  }
}

/**
 * Pinta las variables CSS del documento. Lo que no está tocado se borra en vez
 * de escribirse, así vuelve a mandar la hoja de estilos y el tema sigue vivo.
 */
export function applyColors(overrides: ColorOverrides): void {
  const style = document.documentElement.style;
  for (const spec of COLOR_KEYS) {
    const value = overrides[spec.key];
    for (const cssVar of spec.vars) {
      if (value) style.setProperty(cssVar, value);
      else style.removeProperty(cssVar);
    }
  }
}

/**
 * El lienzo no lee variables CSS, así que los mismos colores se vuelcan a mano
 * sobre la paleta del tema.
 */
export function paletteFor(theme: ThemeName, overrides: ColorOverrides): CanvasPalette {
  const base = CANVAS_THEME[theme];
  const merged: CanvasPalette = { ...base };
  if (overrides.bg) merged.bg = overrides.bg;
  if (overrides.accent) {
    merged.edgeOut = overrides.accent;
    merged.pin = overrides.accent;
  }
  if (overrides.in) merged.edgeIn = overrides.in;
  if (overrides.text) {
    merged.label = overrides.text;
    merged.ring = overrides.text;
  }
  if (overrides.warn) merged.match = overrides.warn;
  return merged;
}

/** Valor de arranque de cada selector: el override o el color del tema. */
export function currentColor(key: string, theme: ThemeName, overrides: ColorOverrides): string {
  if (overrides[key]) return overrides[key]!;
  const palette = CANVAS_THEME[theme];
  switch (key) {
    case 'accent':
      return palette.edgeOut;
    case 'in':
      return palette.edgeIn;
    case 'bg':
      return palette.bg;
    case 'text':
      return palette.label;
    case 'warn':
      return palette.match;
    case 'surface':
      return theme === 'dark' ? '#1b1e26' : '#fffdf6';
    case 'ok':
      return theme === 'dark' ? '#8fd694' : '#1f7a3d';
    default:
      return '#888888';
  }
}
