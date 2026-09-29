import { useCallback, useEffect, useRef, useState } from 'react';
import type { Edge } from '../shared/types';
import { PreviewPane } from './PreviewPane';
import { VimEditor } from './VimEditor';

export interface WindowState {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  /** Pantalla completa. */
  focused: boolean;
  /** Guardada en la barra de abajo. */
  docked: boolean;
  /** Fijada: se queda por encima de las demás aunque hagas clic en otra. */
  pinned: boolean;
  wrap: boolean;
  fontSize: number;
  /** El código se edita con vim; la otra vista es el componente renderizado. */
  view: 'code' | 'preview';
  /** Ventana desde la que se abrió esta (Ctrl+clic o `gf`): se unen con un hilo. */
  openedFrom?: string;
  /** Mostrar sus hilos. Sin valor, se muestran. */
  threads?: boolean;
}

/** Las ventanas fijadas viven en una capa por encima de las normales. */
export const PIN_LAYER = 5000;
export const MIN_FONT = 9;
export const MAX_FONT = 24;

interface Props {
  state: WindowState;
  /** Simbolos que exporta este mismo fichero. */
  exports: string[];
  /** Importaciones del fichero: sirven para marcar de dónde viene cada nombre. */
  imports: Edge[];
  /** Rectángulo de la barra de ventanas, para soltar la ventana ahí. */
  dockRect: () => DOMRect | null;
  onChange: (next: WindowState) => void;
  /** Actualización funcional: el zoom llega más rápido que los re-renders. */
  onPatch: (id: string, patch: (current: WindowState) => WindowState) => void;
  onClose: (id: string) => void;
  onRaise: (id: string) => void;
  /** Abrir otro fichero desde esta ventana: `from` es el id de esta. */
  onOpenFile: (id: string, from: string) => void;
  /** Pasar a la ventana siguiente o anterior. */
  onWindow: (dir: 'next' | 'prev', from: string) => void;
  onDockHint: (over: boolean) => void;
  onMenu: (id: string, x: number, y: number) => void;
}

export function CodeWindow({
  state,
  exports,
  imports,
  dockRect,
  onChange,
  onPatch,
  onClose,
  onRaise,
  onOpenFile,
  onWindow,
  onDockHint,
  onMenu,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [dirty, setDirty] = useState(false);

  // Arrastre de la ventana. Si se suelta sobre la barra de abajo, se guarda ahí.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dock = dockRect();
      onDockHint(!!dock && e.clientY >= dock.top && e.clientX >= dock.left && e.clientX <= dock.right);
      onChange({
        ...stateRef.current,
        x: Math.max(0, drag.ox + e.clientX - drag.x),
        y: Math.max(0, drag.oy + e.clientY - drag.y),
      });
    };
    const up = (e: MouseEvent) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      const dock = dockRect();
      const over = !!dock && e.clientY >= dock.top && e.clientX >= dock.left && e.clientX <= dock.right;
      onDockHint(false);
      if (over) onChange({ ...stateRef.current, docked: true });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [onChange, dockRect, onDockHint]);

  // La ventana se estira con el resize nativo de CSS; esto devuelve el tamano
  // al estado para que un re-render no lo pise.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const current = stateRef.current;
      if (current.focused || current.docked) return;
      const rect = el.getBoundingClientRect();
      // Al minimizar, el elemento sale del DOM y se lee 0×0: eso no es un tamaño.
      if (!el.isConnected || rect.width < 1 || rect.height < 1) return;
      if (Math.abs(rect.width - current.w) > 1 || Math.abs(rect.height - current.h) > 1) {
        onChange({ ...current, w: Math.round(rect.width), h: Math.round(rect.height) });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
    // Al volver de la barra el elemento es otro: hay que observar el nuevo.
  }, [onChange, state.docked]);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      if (state.focused || e.button !== 0) return;
      dragRef.current = { x: e.clientX, y: e.clientY, ox: state.x, oy: state.y };
    },
    [state.focused, state.x, state.y],
  );

  const zoom = (delta: number) =>
    onPatch(state.id, (w) => ({
      ...w,
      fontSize: Math.min(MAX_FONT, Math.max(MIN_FONT, w.fontSize + delta)),
    }));

  if (state.docked) return null;

  const name = state.id.slice(state.id.lastIndexOf('/') + 1);
  const previewable = /\.(tsx|jsx)$/.test(state.id);

  return (
    <div
      ref={rootRef}
      className={`code-window${state.focused ? ' focused' : ''}`}
      data-window={state.id}
      style={
        state.focused
          ? { zIndex: state.z + (state.pinned ? PIN_LAYER : 0) }
          : {
              left: state.x,
              top: state.y,
              width: state.w,
              height: state.h,
              zIndex: state.z + (state.pinned ? PIN_LAYER : 0),
            }
      }
      onMouseDown={() => onRaise(state.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(state.id, e.clientX, e.clientY);
      }}
    >
      <div className={`cw-title${state.pinned ? ' pinned' : ''}`} onMouseDown={startDrag}>
        {/* Semáforo a la izquierda, como en macOS: cerrar, minimizar, ampliar. */}
        <span className="cw-lights" onMouseDown={(e) => e.stopPropagation()}>
          <button className="light close" onClick={() => onClose(state.id)} title="Cerrar">
            <span>✕</span>
          </button>
          <button
            className="light min"
            onClick={() => onChange({ ...state, docked: true })}
            title="Minimizar a la barra"
          >
            <span>–</span>
          </button>
          <button
            className="light zoom"
            onClick={() => onChange({ ...state, focused: !state.focused })}
            title={state.focused ? 'Restaurar' : 'Pantalla completa'}
          >
            <span>{state.focused ? '❐' : '⤢'}</span>
          </button>
        </span>

        <strong>
          {name}
          {dirty ? ' •' : ''}
        </strong>

        <span className="cw-tabs" onMouseDown={(e) => e.stopPropagation()}>
          <button className={state.view === 'code' ? 'on' : ''} onClick={() => onChange({ ...state, view: 'code' })}>
            código
          </button>
          <button
            className={state.view === 'preview' ? 'on' : ''}
            onClick={() => onChange({ ...state, view: 'preview' })}
            disabled={!previewable}
            title={previewable ? 'Renderizar el componente' : 'Solo para ficheros .tsx / .jsx'}
          >
            preview
          </button>
        </span>

        <span className="cw-path" title={state.id}>
          {state.id}
        </span>

        <span className="cw-zoom" title="Tamaño de la letra (Ctrl + rueda)" onMouseDown={(e) => e.stopPropagation()}>
          <button onClick={() => zoom(-1)} disabled={state.fontSize <= MIN_FONT}>
            A−
          </button>
          <b>{state.fontSize}</b>
          <button onClick={() => zoom(1)} disabled={state.fontSize >= MAX_FONT}>
            A+
          </button>
        </span>

        <label className="cw-check" title="Cortar las líneas largas" onMouseDown={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={state.wrap}
            onChange={(e) => onChange({ ...state, wrap: e.target.checked })}
          />
          wrap
        </label>

        {/* Fijar, a la derecha del todo. */}
        <button
          className={`cw-pin${state.pinned ? ' on' : ''}`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => onChange({ ...state, pinned: !state.pinned })}
          title={state.pinned ? 'Soltar: vuelve al orden normal' : 'Fijar arriba de todo'}
        >
          {state.pinned ? '◉' : '◎'}
        </button>
      </div>

      {state.view === 'preview' && previewable ? (
        <PreviewPane file={state.id} />
      ) : (
        <VimEditor
          key={state.id}
          file={state.id}
          fontSize={state.fontSize}
          wrap={state.wrap}
          exports={exports}
          imports={imports}
          onClose={() => onClose(state.id)}
          onDirty={setDirty}
          onOpenFile={(target) => onOpenFile(target, state.id)}
          onWindow={(dir) => onWindow(dir, state.id)}
        />
      )}
    </div>
  );
}
