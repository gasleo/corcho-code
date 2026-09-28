export interface FileStyle {
  color: string;
  label: string;
}

/**
 * Paleta plana de tipo cartoon: colores saturados pero suaves, pensados para
 * llevar encima un contorno negro grueso y texto oscuro.
 */
const FILE_STYLES: Record<string, FileStyle> = {
  '.ts': { color: '#6ba4ff', label: 'TS' },
  '.mts': { color: '#6ba4ff', label: 'TS' },
  '.cts': { color: '#6ba4ff', label: 'TS' },
  '.tsx': { color: '#5fd8d2', label: 'TSX' },
  '.js': { color: '#ffd23f', label: 'JS' },
  '.mjs': { color: '#ffd23f', label: 'MJS' },
  '.cjs': { color: '#ffd23f', label: 'CJS' },
  '.jsx': { color: '#ffab5e', label: 'JSX' },
  '.json': { color: '#b6d97a', label: '{}' },
  '.css': { color: '#c9aef5', label: 'CSS' },
  '.scss': { color: '#f49ac1', label: 'SCSS' },
  '.sass': { color: '#f49ac1', label: 'SASS' },
  '.less': { color: '#8fb0e8', label: 'LESS' },
  '.styl': { color: '#b9e07a', label: 'STYL' },
  '.html': { color: '#ff9478', label: '<>' },
  '.md': { color: '#cdd3dc', label: 'MD' },
  '.cs': { color: '#a78bfa', label: 'C#' },
};

const FOLDER_BODY = '#f0b429';
const FOLDER_FLAP = '#ffd469';

export function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

export function fileStyle(name: string): FileStyle {
  const ext = extOf(name);
  return FILE_STYLES[ext] ?? { color: '#c3c6cc', label: (ext.slice(1, 4) || '?').toUpperCase() };
}

/** Grosor del contorno: firme, pero sin engordar cuando hacés mucho zoom. */
const strokeWidth = (r: number) => Math.max(1, Math.min(2.4, r * 0.13));

/**
 * Carpeta cerrada: pestaña arriba y cuerpo macizo.
 * Carpeta abierta: la tapa delantera se inclina y deja ver el interior.
 */
export function drawFolder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  open: boolean,
  ink: string,
) {
  const w = r * 2;
  const h = r * 1.55;
  const left = x - w / 2;
  const top = y - h / 2;
  const tabW = w * 0.44;
  const tabH = h * 0.26;
  const line = strokeWidth(r);

  ctx.lineJoin = 'round';
  ctx.strokeStyle = ink;
  ctx.lineWidth = line;

  ctx.beginPath();
  ctx.roundRect(left, top - tabH, tabW, tabH + 6, [3, 3, 0, 0]);
  ctx.fillStyle = FOLDER_BODY;
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.roundRect(left, top, w, h, 3);
  ctx.fillStyle = FOLDER_BODY;
  ctx.fill();
  ctx.stroke();

  if (!open) return;

  const lean = w * 0.17;
  ctx.beginPath();
  ctx.moveTo(left + lean, top + h * 0.3);
  ctx.lineTo(left + w + lean * 0.4, top + h * 0.3);
  ctx.lineTo(left + w, top + h);
  ctx.lineTo(left, top + h);
  ctx.closePath();
  ctx.fillStyle = FOLDER_FLAP;
  ctx.fill();
  ctx.stroke();
}

/** Hoja con la esquina doblada y el tipo de fichero escrito encima. */
export function drawFile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  name: string,
  ink: string,
) {
  const style = fileStyle(name);
  const w = r * 1.5;
  const h = r * 1.95;
  const left = x - w / 2;
  const top = y - h / 2;
  const fold = Math.max(4, w * 0.34);
  const line = strokeWidth(r);

  ctx.lineJoin = 'round';
  ctx.strokeStyle = ink;
  ctx.lineWidth = line;

  ctx.beginPath();
  ctx.moveTo(left, top + 3);
  ctx.quadraticCurveTo(left, top, left + 3, top);
  ctx.lineTo(left + w - fold, top);
  ctx.lineTo(left + w, top + fold);
  ctx.lineTo(left + w, top + h - 3);
  ctx.quadraticCurveTo(left + w, top + h, left + w - 3, top + h);
  ctx.lineTo(left + 3, top + h);
  ctx.quadraticCurveTo(left, top + h, left, top + h - 3);
  ctx.closePath();
  ctx.fillStyle = style.color;
  ctx.fill();
  ctx.stroke();

  // La esquina doblada: mismo color, apenas velado, y el pliegue dibujado.
  ctx.beginPath();
  ctx.moveTo(left + w - fold, top);
  ctx.lineTo(left + w - fold, top + fold);
  ctx.lineTo(left + w, top + fold);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fill();
  ctx.stroke();

  const fontSize = h * 0.29;
  if (fontSize >= 5.5) {
    ctx.font = `700 ${fontSize}px 'Cascadia Mono', ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    ctx.fillText(style.label, x, y + h * 0.17);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }
}

/* ------------------------------------------------------------------------ */
/* Tema corcho: fichas de papel y carpetas manila clavadas con una chinche.  */
/* ------------------------------------------------------------------------ */

const PAPER = '#fffaf0';
const MANILA = '#e8c98a';
const MANILA_BACK = '#d4ae68';
const MANILA_FRONT = '#f1dcaa';
const PAPER_SHADOW = 'rgba(40, 20, 5, 0.38)';

/**
 * Inclinación de cada ficha, en radianes. Sale del id y no del azar para que
 * cada nodo quede siempre igual de torcido: si cambiara al repintar, el
 * tablero temblaría.
 */
export function tiltOf(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return (((hash >>> 0) % 1000) / 1000 - 0.5) * 0.14;
}

/** Dónde queda la chinche respecto del centro del nodo, ya con la inclinación. */
export function pinOffset(id: string, r: number): { dx: number; dy: number } {
  const t = tiltOf(id);
  const d = r * 0.66;
  return { dx: Math.sin(t) * d, dy: -Math.cos(t) * d };
}

/** Chinche vista desde arriba: sombra corrida, cabeza de color y un brillo. */
export function drawPushpin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.beginPath();
  ctx.ellipse(x + r * 0.35, y + r * 0.45, r, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(40, 20, 5, 0.35)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.strokeStyle = 'rgba(40, 10, 5, 0.6)';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.fill();
}

/** Rellena el trazo actual con la sombra del papel apoyado sobre el corcho. */
function fillLifted(ctx: CanvasRenderingContext2D, color: string, r: number) {
  ctx.save();
  ctx.shadowColor = PAPER_SHADOW;
  ctx.shadowBlur = Math.min(6, r * 0.35);
  ctx.shadowOffsetX = Math.min(3, r * 0.14);
  ctx.shadowOffsetY = Math.min(4, r * 0.2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/** Ficha de papel: franja superior con el color del tipo, renglones y la etiqueta del tipo. */
export function drawPinnedFile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  id: string,
  name: string,
  ink: string,
  pinColor: string,
) {
  const style = fileStyle(name);
  const w = r * 1.6;
  const h = r * 1.9;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tiltOf(id));
  const left = -w / 2;
  const top = -h / 2;

  ctx.beginPath();
  ctx.rect(left, top, w, h);
  fillLifted(ctx, PAPER, r);

  const band = h * 0.3;
  ctx.fillStyle = style.color;
  ctx.fillRect(left, top, w, band);

  // Renglones celestes, como los de una ficha de verdad.
  if (r > 7) {
    ctx.strokeStyle = 'rgba(31, 78, 140, 0.22)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const ly = top + band + ((h - band) * i) / 4;
      ctx.beginPath();
      ctx.moveTo(left + w * 0.1, ly);
      ctx.lineTo(left + w * 0.9, ly);
      ctx.stroke();
    }
  }

  ctx.beginPath();
  ctx.rect(left, top, w, h);
  ctx.lineWidth = strokeWidth(r) * 0.75;
  ctx.strokeStyle = ink;
  ctx.stroke();

  const fontSize = h * 0.26;
  if (fontSize >= 5.5) {
    ctx.font = '700 ' + fontSize + "px 'Cascadia Mono', ui-monospace, monospace";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    ctx.fillText(style.label, 0, h * 0.16);
  }
  ctx.restore();

  const pin = pinOffset(id, r);
  drawPushpin(ctx, x + pin.dx, y + pin.dy, Math.max(2.5, r * 0.26), pinColor);
}

/**
 * Carpeta manila. Abierta, la tapa de adelante baja y asoma una hoja: se lee
 * como una carpeta de expediente, no como el icono de un sistema operativo.
 */
export function drawPinnedFolder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  id: string,
  open: boolean,
  ink: string,
  pinColor: string,
) {
  const w = r * 2;
  const h = r * 1.55;
  const tabW = w * 0.42;
  const tabH = h * 0.22;
  const line = strokeWidth(r) * 0.75;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tiltOf(id));
  const left = -w / 2;
  const top = -h / 2;
  ctx.lineJoin = 'round';

  // Pestaña y cuerpo en un solo contorno, para que la sombra sea una sola.
  ctx.beginPath();
  ctx.moveTo(left, top + h);
  ctx.lineTo(left, top - tabH + 2);
  ctx.quadraticCurveTo(left, top - tabH, left + 2, top - tabH);
  ctx.lineTo(left + tabW - tabH * 0.6, top - tabH);
  ctx.lineTo(left + tabW, top);
  ctx.lineTo(left + w, top);
  ctx.lineTo(left + w, top + h);
  ctx.closePath();
  fillLifted(ctx, open ? MANILA_BACK : MANILA, r);
  ctx.lineWidth = line;
  ctx.strokeStyle = ink;
  ctx.stroke();

  if (open) {
    // La hoja que asoma y, encima, la tapa delantera inclinada.
    ctx.beginPath();
    ctx.rect(left + w * 0.12, top - h * 0.08, w * 0.72, h * 0.6);
    ctx.fillStyle = PAPER;
    ctx.fill();
    ctx.lineWidth = line * 0.8;
    ctx.stroke();

    const lean = w * 0.12;
    ctx.beginPath();
    ctx.moveTo(left + lean, top + h * 0.34);
    ctx.lineTo(left + w + lean * 0.3, top + h * 0.34);
    ctx.lineTo(left + w, top + h);
    ctx.lineTo(left, top + h);
    ctx.closePath();
    ctx.fillStyle = MANILA_FRONT;
    ctx.fill();
    ctx.lineWidth = line;
    ctx.stroke();
  } else {
    // El pliegue de la tapa, apenas marcado.
    ctx.beginPath();
    ctx.moveTo(left + w * 0.06, top + h * 0.2);
    ctx.lineTo(left + w * 0.94, top + h * 0.2);
    ctx.strokeStyle = 'rgba(90, 60, 20, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();

  const pin = pinOffset(id, r);
  drawPushpin(ctx, x + pin.dx, y + pin.dy, Math.max(2.5, r * 0.26), pinColor);
}
