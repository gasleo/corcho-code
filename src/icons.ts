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
