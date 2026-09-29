import { PIN_LAYER, type WindowState } from './CodeWindow';

/** Altura del conector: el centro de la barra de título. */
export const PORT_Y = 20;
/** Por encima de cualquier ventana, fijadas incluidas. */
const ABOVE_ALL = 1_000_000;

const visible = (w: WindowState | undefined): w is WindowState => !!w && !w.docked && !w.focused;

interface Thread {
  id: string;
  d: string;
  hot: boolean;
}

/**
 * Hilos entre ventanas: cada ventana abierta desde otra (Ctrl+clic o `gf`)
 * queda atada a su origen. El hilo sale por la derecha de la que abrió y
 * entra por la izquierda de la abierta, así se lee de izquierda a derecha
 * quién llevó a quién. Una ventana con las conexiones apagadas no dibuja
 * ninguno de sus hilos.
 */
function threadsOf(windows: WindowState[], active: string | null): Thread[] {
  const byId = new Map(windows.map((w) => [w.id, w]));
  return windows.flatMap((child) => {
    const parent = child.openedFrom ? byId.get(child.openedFrom) : undefined;
    if (!visible(parent) || !visible(child)) return [];
    if (parent.threads === false || child.threads === false) return [];
    const ax = parent.x + parent.w;
    const ay = parent.y + PORT_Y;
    const bx = child.x;
    const by = child.y + PORT_Y;
    // Tramos horizontales en las dos puntas: aunque la hija quede a la
    // izquierda de la madre, el hilo sale hacia afuera y da la vuelta.
    const reach = Math.max(60, Math.abs(bx - ax) * 0.5, Math.abs(by - ay) * 0.25);
    const d = `M ${ax} ${ay} C ${ax + reach} ${ay}, ${bx - reach} ${by}, ${bx} ${by}`;
    return [{ id: `${parent.id}→${child.id}`, d, hot: active === child.id || active === parent.id }];
  });
}

function ThreadPaths({ threads }: { threads: Thread[] }) {
  return (
    <>
      {threads.map((t) => (
        <g key={t.id} className={`window-thread${t.hot ? ' hot' : ''}`}>
          <path className="thread-shadow" d={t.d} />
          <path className="thread-line" d={t.d} />
          <path className="thread-strands" d={t.d} />
        </g>
      ))}
    </>
  );
}

/**
 * Dos capas: los hilos de las demás van por debajo de las ventanas; los de
 * la ventana activa, por encima de todo, para seguirlos aunque crucen otras.
 */
export function WindowThreads({ windows, active }: { windows: WindowState[]; active: string | null }) {
  const threads = threadsOf(windows, active);
  if (!threads.length) return null;
  const hot = threads.filter((t) => t.hot);
  const rest = threads.filter((t) => !t.hot);
  return (
    <>
      {rest.length > 0 && (
        <svg className="window-threads" aria-hidden="true">
          <ThreadPaths threads={rest} />
        </svg>
      )}
      {hot.length > 0 && (
        <svg className="window-threads" style={{ zIndex: ABOVE_ALL }} aria-hidden="true">
          <ThreadPaths threads={hot} />
        </svg>
      )}
    </>
  );
}

/**
 * Conectores en el borde de cada ventana: a la izquierda si la abrió otra, a
 * la derecha si ella abrió alguna. Son también el interruptor para mostrar u
 * ocultar sus conexiones. Viven fuera de la ventana porque ella recorta lo
 * que se sale de sus bordes.
 */
export function WindowPorts({
  windows,
  active,
  onToggle,
}: {
  windows: WindowState[];
  active: string | null;
  onToggle: (id: string) => void;
}) {
  const ids = new Set(windows.map((w) => w.id));
  const parents = new Set(windows.filter((w) => w.openedFrom && ids.has(w.openedFrom)).map((w) => w.openedFrom!));
  return (
    <>
      {windows.filter(visible).flatMap((w) => {
        const sides: ('in' | 'out')[] = [];
        if (w.openedFrom && ids.has(w.openedFrom)) sides.push('in');
        if (parents.has(w.id)) sides.push('out');
        const on = w.threads !== false;
        const z = w.id === active ? ABOVE_ALL + 1 : w.z + (w.pinned ? PIN_LAYER : 0) + 1;
        return sides.map((side) => (
          <button
            key={`${w.id}:${side}`}
            className={`window-port ${side}${on ? ' on' : ''}`}
            style={{ left: side === 'in' ? w.x : w.x + w.w, top: w.y + PORT_Y, zIndex: z }}
            title={`${on ? 'Ocultar' : 'Mostrar'} las conexiones de esta ventana`}
            aria-pressed={on}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onToggle(w.id)}
          />
        ));
      })}
    </>
  );
}
