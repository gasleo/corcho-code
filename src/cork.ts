/**
 * Textura de corcho generada, no una imagen: una baldosa con base cálida y
 * miles de gránulos claros y oscuros, que el lienzo repite como patrón.
 *
 * Usa un generador con semilla fija para que el corcho sea siempre el mismo:
 * si cambiara en cada recarga, el fondo "temblaría" al volver a la app.
 */
const TILE = 220;
let tile: HTMLCanvasElement | null = null;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildTile(base: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(0xc0c0);

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TILE, TILE);

  // Gránulos: la mayoría chicos y oscuros, algunos claros que dan el brillo.
  const specks: [string, number, number][] = [
    ['rgba(92, 58, 26, 0.35)', 1400, 1.4],
    ['rgba(70, 42, 16, 0.5)', 500, 1.0],
    ['rgba(255, 236, 200, 0.28)', 600, 1.2],
    ['rgba(130, 82, 38, 0.3)', 90, 3.2],
  ];
  for (const [color, count, size] of specks) {
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const x = rand() * TILE;
      const y = rand() * TILE;
      const rx = (0.4 + rand()) * size;
      const ry = (0.4 + rand()) * size * 0.8;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
      // Lo que asoma por un borde se repite del otro: la baldosa no se nota.
      if (x < size * 2) {
        ctx.beginPath();
        ctx.ellipse(x + TILE, y, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (y < size * 2) {
        ctx.beginPath();
        ctx.ellipse(x, y + TILE, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return canvas;
}

/** Patrón de corcho listo para `fillStyle`. La baldosa se genera una vez. */
export function corkPattern(ctx: CanvasRenderingContext2D, base: string): CanvasPattern | string {
  if (!tile) tile = buildTile(base);
  return ctx.createPattern(tile, 'repeat') ?? base;
}
