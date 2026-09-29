import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { toLines, tokenize } from './highlight';
import type { Edge } from '../shared/types';
import { readFile, writeFile } from './api';
import { applyKey, initialState, lineEnd, lineOf, lineStart, startOfLine, wordAt, type VimState } from './vim';

interface Props {
  /** Ruta relativa dentro del proyecto. */
  file: string;
  fontSize: number;
  wrap: boolean;
  /** Simbolos que exporta este mismo fichero. */
  exports: string[];
  /** Importaciones: marcan de dónde viene cada nombre y alimentan `gf`. */
  imports: Edge[];
  onClose: () => void;
  /** Avisa si hay cambios sin guardar, para marcarlo en el título. */
  onDirty: (dirty: boolean) => void;
  onOpenFile: (id: string) => void;
  /** `gt` / `gT`: pasar a otra ventana. */
  onWindow: (dir: 'next' | 'prev') => void;
}

interface Origin {
  file: string;
  name: string;
}

const MODE_LABEL: Record<VimState['mode'], string> = {
  normal: 'NORMAL',
  insert: 'INSERT',
  visual: 'VISUAL',
  'visual-line': 'V-LINE',
  command: 'COMANDO',
};

/**
 * Editor con teclas de vim. Todas las teclas se atienden acá y se cancela el
 * comportamiento del navegador, así que Ctrl+R, Ctrl+S, Ctrl+P, Ctrl+F, Ctrl+D
 * y Ctrl+U son del editor, no del escritorio.
 */
export function VimEditor({ file, fontSize, wrap, exports, imports, onClose, onDirty, onOpenFile, onWindow }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);
  /**
   * El estado vive en una ref y el render se fuerza a mano. Con `useState`,
   * varias teclas en el mismo tick leían todas el estado previo (React agrupa
   * las actualizaciones) y se perdían pulsaciones al escribir rápido.
   */
  const stateRef = useRef<VimState | null>(null);
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const state = stateRef.current;

  /** Nombre local -> fichero del que viene. */
  const origins = useMemo(() => {
    const map = new Map<string, Origin>();
    for (const edge of imports) {
      for (const symbol of edge.symbols) {
        if (symbol.local) map.set(symbol.local, { file: edge.to, name: symbol.name });
      }
    }
    return map;
  }, [imports]);

  const exported = useMemo(() => new Set(exports), [exports]);

  const update = useCallback((next: VimState) => {
    stateRef.current = next;
    bump();
  }, []);

  useEffect(() => {
    let alive = true;
    readFile(file)
      .then((text) => {
        if (!alive) return;
        stateRef.current = initialState(text);
        bump();
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [file]);

  useEffect(() => {
    onDirty(!!stateRef.current?.dirty);
  }, [version, onDirty]);

  const save = useCallback(
    async (then?: () => void) => {
      const current = stateRef.current;
      if (!current) return;
      try {
        await writeFile(file, current.text);
        if (stateRef.current) {
          stateRef.current = { ...stateRef.current, dirty: false, message: `"${file}" guardado` };
          bump();
        }
        then?.();
      } catch (err) {
        if (stateRef.current) {
          stateRef.current = {
            ...stateRef.current,
            message: err instanceof Error ? err.message : String(err),
          };
          bump();
        }
      }
    },
    [file],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const current = stateRef.current;
      if (!current) return;
      // Nada llega al navegador: ni recargar, ni buscar, ni imprimir.
      if (e.key !== 'F5' && e.key !== 'F12') e.preventDefault();
      e.stopPropagation();

      const { state: next, action } = applyKey(current, {
        key: e.key,
        ctrl: e.ctrlKey || e.metaKey,
        shift: e.shiftKey,
      });
      update(next);
      if (action?.window) {
        onWindow(action.window);
        return;
      }
      if (action?.openUnderCursor) {
        // `gf`: el símbolo bajo el cursor sabe de qué fichero viene.
        const word = wordAt(next.text, next.cursor);
        const origin = word ? origins.get(word) : undefined;
        if (origin) onOpenFile(origin.file);
        else update({ ...next, message: word ? `${word} no viene de otro fichero` : 'no hay símbolo acá' });
        return;
      }
      if (action?.save) void save(action.close ? onClose : undefined);
      else if (action?.close) onClose();
    },
    [save, onClose, update, origins, onOpenFile, onWindow],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lines = useMemo(() => (state ? toLines(tokenize(state.text, file)) : []), [version, state?.text, file]);

  /**
   * Traduce dónde soltaste el mouse a un offset del buffer. Cada línea lleva su
   * índice en `data-line`, y dentro se suman los nodos de texto hasta el punto
   * del clic — salteando el relleno del cursor, que no es texto del fichero.
   */
  const offsetFromPoint = useCallback(
    (node: Node, nodeOffset: number): number | null => {
      const current = stateRef.current;
      if (!current) return null;
      const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
      const line = element?.closest('.cw-line') as HTMLElement | null;
      if (!line) return null;
      const index = Number(line.dataset.line ?? '0');
      const textEl = line.querySelector('.cw-text');
      if (!textEl) return null;

      let column = 0;
      if (node.nodeType === Node.TEXT_NODE) {
        const walker = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT);
        let found = false;
        let cursorNode: Node | null = walker.nextNode();
        while (cursorNode) {
          const holder = cursorNode.parentElement;
          const filler = holder?.dataset.filler === 'true';
          if (cursorNode === node) {
            column += filler ? 0 : nodeOffset;
            found = true;
            break;
          }
          if (!filler) column += cursorNode.textContent?.length ?? 0;
          cursorNode = walker.nextNode();
        }
        if (!found) column = textEl.textContent?.length ?? 0;
      } else {
        // Clic más allá del final de la línea: el cursor va al último carácter.
        column = textEl.textContent?.length ?? 0;
      }

      const start = startOfLine(current.text, index);
      const end = lineEnd(current.text, start);
      return Math.min(start + column, end);
    },
    [],
  );

  /** Un clic mueve el cursor; arrastrar deja la selección en modo visual. */
  const syncFromSelection = useCallback(() => {
    const current = stateRef.current;
    if (!current) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const from = offsetFromPoint(range.startContainer, range.startOffset);
    const to = offsetFromPoint(range.endContainer, range.endOffset);
    if (from === null || to === null) return;

    if (from === to) {
      update({ ...current, mode: current.mode === 'insert' ? 'insert' : 'normal', cursor: from, wantCol: null });
    } else {
      update({ ...current, mode: 'visual', anchor: from, cursor: Math.max(from, to - 1), wantCol: null });
    }
    // La selección nativa se va: a partir de acá manda el resaltado de vim.
    selection.removeAllRanges();
    hostRef.current?.focus();
  }, [offsetFromPoint, update]);

  const cursorLine = state ? lineOf(state.text, state.cursor) : 0;
  const cursorCol = state ? state.cursor - lineStart(state.text, state.cursor) : 0;

  // El cursor se mantiene a la vista al moverse.
  useEffect(() => {
    cursorRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [cursorLine, cursorCol]);

  const selection = useMemo(() => {
    if (!state || (state.mode !== 'visual' && state.mode !== 'visual-line')) return null;
    const from = Math.min(state.anchor, state.cursor);
    const to = Math.max(state.anchor, state.cursor);
    return { from: lineOf(state.text, from), to: lineOf(state.text, to) };
  }, [state]);

  if (error) return <div className="cw-error">{error}</div>;
  if (!state) return <div className="cw-loading">cargando…</div>;

  return (
    <div className="vim">
      <div
        className={`vim-body${wrap ? ' wrap' : ''}${focused ? '' : ' blurred'}`}
        style={{ fontSize }}
        tabIndex={0}
        ref={hostRef}
        onKeyDown={onKeyDown}
        onMouseUp={syncFromSelection}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        {lines.map((tokens, index) => {
          const inSelection = selection && index >= selection.from && index <= selection.to;
          return (
            <div className={`cw-line${inSelection ? ' selected' : ''}`} key={index} data-line={index}>
              <span className="cw-num">{index + 1}</span>
              <span className="cw-text">
                {index === cursorLine ? (
                  <LineWithCursor tokens={tokens} col={cursorCol} mode={state.mode} cursorRef={cursorRef} />
                ) : (
                  tokens.map((token, ti) => (
                    <Token
                      key={ti}
                      token={token}
                      origins={origins}
                      exported={exported}
                      onOpenFile={onOpenFile}
                    />
                  ))
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className="vim-status">
        <span className={`vim-mode vim-${state.mode}`}>{MODE_LABEL[state.mode]}</span>
        <span className="vim-file">
          {file}
          {state.dirty ? ' [+]' : ''}
        </span>
        <span className="vim-cmd">{state.mode === 'command' ? state.command : state.message}</span>
        <span className="vim-pos">
          {cursorLine + 1}:{cursorCol + 1}
        </span>
        <span className="vim-pending">{state.pending}</span>
        {!focused && <span className="vim-hint">clic para escribir</span>}
      </div>
    </div>
  );
}

/** Redibuja la línea del cursor partiendo el token justo donde está. */
function LineWithCursor({
  tokens,
  col,
  mode,
  cursorRef,
}: {
  tokens: { kind: string; value: string }[];
  col: number;
  mode: VimState['mode'];
  cursorRef: React.RefObject<HTMLSpanElement>;
}) {
  const out: JSX.Element[] = [];
  let offset = 0;
  let placed = false;

  const cursorSpan = (char: string, key: string) => (
    <span
      key={key}
      className={`vim-cursor vim-cursor-${mode}`}
      ref={cursorRef}
      data-filler={char ? undefined : 'true'}
    >
      {char || ' '}
    </span>
  );

  tokens.forEach((token, ti) => {
    const start = offset;
    const end = offset + token.value.length;
    if (!placed && col >= start && col < end) {
      const at = col - start;
      if (at > 0) out.push(<span key={`${ti}a`} className={`tok-${token.kind}`}>{token.value.slice(0, at)}</span>);
      out.push(cursorSpan(token.value[at], `${ti}c`));
      out.push(<span key={`${ti}b`} className={`tok-${token.kind}`}>{token.value.slice(at + 1)}</span>);
      placed = true;
    } else {
      out.push(<span key={ti} className={`tok-${token.kind}`}>{token.value}</span>);
    }
    offset = end;
  });

  if (!placed) out.push(cursorSpan('', 'end'));
  return <>{out}</>;
}

/** Un token, marcando los que vienen de otro fichero o los que se exportan. */
function Token({
  token,
  origins,
  exported,
  onOpenFile,
}: {
  token: { kind: string; value: string };
  origins: Map<string, Origin>;
  exported: Set<string>;
  onOpenFile: (id: string) => void;
}) {
  if (token.kind === 'ident') {
    const origin = origins.get(token.value);
    if (origin) {
      return (
        <span
          className="tok-link"
          title={`${origin.name} — de ${origin.file} (Ctrl+clic o gf para abrirlo)`}
          onMouseDown={(e) => {
            // Clic normal = mover el cursor. Ctrl/Cmd + clic abre el fichero,
            // igual que en cualquier editor; con el teclado, `gf`.
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            e.stopPropagation();
            onOpenFile(origin.file);
          }}
        >
          {token.value}
        </span>
      );
    }
    if (exported.has(token.value)) {
      return (
        <span className="tok-export" title="lo exporta este fichero">
          {token.value}
        </span>
      );
    }
  }
  return <span className={`tok-${token.kind}`}>{token.value}</span>;
}
