export type Mode = 'normal' | 'insert' | 'visual' | 'visual-line' | 'command';

export interface VimState {
  text: string;
  /** Posición del cursor como offset dentro del texto. */
  cursor: number;
  /** Extremo fijo de la selección en modo visual. */
  anchor: number;
  mode: Mode;
  /** Teclas a medio comando: `2d`, `g`, `r`… */
  pending: string;
  /** Línea que se está escribiendo tras `:` o `/`. */
  command: string;
  register: string;
  registerLinewise: boolean;
  undo: Snapshot[];
  redo: Snapshot[];
  message: string;
  search: string;
  dirty: boolean;
  /** Columna deseada al subir y bajar, como en vim. */
  wantCol: number | null;
}

interface Snapshot {
  text: string;
  cursor: number;
}

export interface KeyEvent {
  key: string;
  ctrl: boolean;
  shift: boolean;
}

/** Lo que la aplicación tiene que hacer fuera del buffer. */
export interface VimAction {
  save?: boolean;
  close?: boolean;
  /** `gf`: abrir el fichero del que viene el símbolo bajo el cursor. */
  openUnderCursor?: boolean;
  /** Mensaje para la línea de estado. */
  quitWithoutSaving?: boolean;
}

export interface VimResult {
  state: VimState;
  action?: VimAction;
}

export function initialState(text: string): VimState {
  return {
    text,
    cursor: 0,
    anchor: 0,
    mode: 'normal',
    pending: '',
    command: '',
    register: '',
    registerLinewise: false,
    undo: [],
    redo: [],
    message: '',
    search: '',
    dirty: false,
    wantCol: null,
  };
}

const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);
const isSpace = (c: string) => /\s/.test(c);

export function lineStart(text: string, pos: number): number {
  return text.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
}

export function lineEnd(text: string, pos: number): number {
  const idx = text.indexOf('\n', pos);
  return idx < 0 ? text.length : idx;
}

export function lineOf(text: string, pos: number): number {
  let line = 0;
  for (let i = 0; i < pos; i++) if (text[i] === '\n') line++;
  return line;
}

export function startOfLine(text: string, line: number): number {
  if (line <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      seen++;
      if (seen === line) return i + 1;
    }
  }
  return text.length;
}

export function totalLines(text: string): number {
  return text.split('\n').length;
}

const clampNormal = (text: string, pos: number) => {
  const start = lineStart(text, pos);
  const end = lineEnd(text, pos);
  return Math.max(start, Math.min(pos, Math.max(start, end - 1)));
};

function firstNonBlank(text: string, pos: number): number {
  const start = lineStart(text, pos);
  const end = lineEnd(text, pos);
  let i = start;
  while (i < end && isSpace(text[i])) i++;
  return i;
}

function nextWord(text: string, pos: number): number {
  let i = pos;
  const cls = (c: string) => (isSpace(c) ? 0 : isWord(c) ? 1 : 2);
  const start = cls(text[i] ?? ' ');
  while (i < text.length && cls(text[i]) === start && start !== 0) i++;
  while (i < text.length && isSpace(text[i])) i++;
  return Math.min(i, text.length);
}

function prevWord(text: string, pos: number): number {
  let i = pos - 1;
  while (i > 0 && isSpace(text[i])) i--;
  const cls = (c: string) => (isSpace(c) ? 0 : isWord(c) ? 1 : 2);
  const target = cls(text[i] ?? ' ');
  while (i > 0 && cls(text[i - 1]) === target && !isSpace(text[i - 1])) i--;
  return Math.max(0, i);
}

function wordEnd(text: string, pos: number): number {
  let i = pos + 1;
  while (i < text.length && isSpace(text[i])) i++;
  const cls = (c: string) => (isSpace(c) ? 0 : isWord(c) ? 1 : 2);
  const target = cls(text[i] ?? ' ');
  while (i + 1 < text.length && cls(text[i + 1]) === target && target !== 0) i++;
  return Math.min(i, Math.max(0, text.length - 1));
}

function verticalMove(state: VimState, delta: number, count: number): VimState {
  const line = lineOf(state.text, state.cursor);
  const col = state.wantCol ?? state.cursor - lineStart(state.text, state.cursor);
  const target = Math.max(0, Math.min(totalLines(state.text) - 1, line + delta * count));
  const start = startOfLine(state.text, target);
  const end = lineEnd(state.text, start);
  return { ...state, cursor: Math.min(start + col, Math.max(start, end - (state.mode === 'insert' ? 0 : 1))), wantCol: col };
}

function snapshot(state: VimState): Snapshot {
  return { text: state.text, cursor: state.cursor };
}

function withEdit(state: VimState, text: string, cursor: number): VimState {
  return {
    ...state,
    undo: [...state.undo.slice(-200), snapshot(state)],
    redo: [],
    text,
    cursor: Math.max(0, Math.min(cursor, text.length)),
    dirty: true,
    wantCol: null,
  };
}

interface Motion {
  to: number;
  linewise?: boolean;
  /** El carácter de destino entra en el rango (como `e`). */
  inclusive?: boolean;
}

function motionFor(state: VimState, key: string, count: number, explicit = false): Motion | null {
  const { text, cursor } = state;
  switch (key) {
    case 'h':
      return { to: Math.max(lineStart(text, cursor), cursor - count) };
    case 'l':
      return { to: Math.min(lineEnd(text, cursor), cursor + count) };
    case 'w':
      return { to: repeat(cursor, count, (p) => nextWord(text, p)) };
    case 'b':
      return { to: repeat(cursor, count, (p) => prevWord(text, p)) };
    case 'e':
      return { to: repeat(cursor, count, (p) => wordEnd(text, p)), inclusive: true };
    case '0':
      return { to: lineStart(text, cursor) };
    case '^':
      return { to: firstNonBlank(text, cursor) };
    case '$':
      return { to: lineEnd(text, cursor), inclusive: false };
    case 'G':
      // "5G" va a la linea 5; "G" sin numero, a la ultima.
      return {
        to: startOfLine(text, explicit ? Math.max(0, count - 1) : totalLines(text) - 1),
        linewise: true,
      };
    case 'j':
      return { to: startOfLine(text, lineOf(text, cursor) + count), linewise: true };
    case 'k':
      return { to: startOfLine(text, Math.max(0, lineOf(text, cursor) - count)), linewise: true };
    default:
      return null;
  }
}

const repeat = (from: number, count: number, step: (p: number) => number) => {
  let pos = from;
  for (let i = 0; i < count; i++) pos = step(pos);
  return pos;
};

/** Rango de líneas completas que cubre [a,b], incluyendo el salto final. */
function lineRange(text: string, a: number, b: number): [number, number] {
  const from = lineStart(text, Math.min(a, b));
  const endLine = lineEnd(text, Math.max(a, b));
  return [from, Math.min(text.length, endLine + 1)];
}

function applyOperator(state: VimState, op: string, from: number, to: number, linewise: boolean): VimState {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const removed = state.text.slice(start, end);
  const next = { ...state, register: removed, registerLinewise: linewise, message: '' };

  if (op === 'y') {
    return { ...next, cursor: start, mode: 'normal', pending: '' };
  }
  const text = state.text.slice(0, start) + state.text.slice(end);
  const edited = withEdit(next, text, start);
  if (op === 'c') return { ...edited, mode: 'insert', pending: '' };
  return { ...edited, cursor: linewise ? firstNonBlank(text, Math.min(start, text.length)) : clampNormal(text, start), mode: 'normal', pending: '' };
}

function paste(state: VimState, after: boolean, count: number): VimState {
  if (!state.register) return state;
  const chunk = state.register.repeat(count);
  if (state.registerLinewise) {
    const at = after ? Math.min(state.text.length, lineEnd(state.text, state.cursor) + 1) : lineStart(state.text, state.cursor);
    const piece = chunk.endsWith('\n') ? chunk : `${chunk}\n`;
    const text = state.text.slice(0, at) + piece + state.text.slice(at);
    return withEdit(state, text, firstNonBlank(text, at));
  }
  const at = after ? Math.min(state.text.length, state.cursor + 1) : state.cursor;
  const text = state.text.slice(0, at) + chunk + state.text.slice(at);
  return withEdit(state, text, at + chunk.length - 1);
}

function runSearch(state: VimState, pattern: string, forward: boolean): VimState {
  if (!pattern) return state;
  const from = forward ? state.cursor + 1 : state.cursor - 1;
  const idx = forward
    ? state.text.indexOf(pattern, Math.max(0, from))
    : state.text.lastIndexOf(pattern, Math.max(0, from));
  const wrapped = idx < 0 ? (forward ? state.text.indexOf(pattern) : state.text.lastIndexOf(pattern)) : idx;
  if (wrapped < 0) return { ...state, message: `patrón no encontrado: ${pattern}` };
  return { ...state, cursor: wrapped, search: pattern, message: '' };
}

function runExCommand(state: VimState, line: string): VimResult {
  const cmd = line.trim();
  const base = { ...state, mode: 'normal' as Mode, command: '', pending: '' };

  if (/^\d+$/.test(cmd)) {
    const target = Math.max(0, Math.min(totalLines(state.text) - 1, Number(cmd) - 1));
    return { state: { ...base, cursor: startOfLine(state.text, target) } };
  }
  switch (cmd) {
    case 'w':
      return { state: { ...base, message: 'guardando…' }, action: { save: true } };
    case 'wq':
    case 'x':
      return { state: { ...base, message: 'guardando…' }, action: { save: true, close: true } };
    case 'q':
      return state.dirty
        ? { state: { ...base, message: 'hay cambios sin guardar (usá :q! o :wq)' } }
        : { state: base, action: { close: true } };
    case 'q!':
      return { state: base, action: { close: true, quitWithoutSaving: true } };
    case 'noh':
    case 'nohl':
    case 'nohlsearch':
      return { state: { ...base, search: '', message: '' } };
    default:
      return { state: { ...base, message: `no se reconoce :${cmd}` } };
  }
}

/**
 * Motor de vim: recibe una tecla y devuelve el estado nuevo. Es una función
 * pura, así que se puede probar sin DOM y el componente solo dibuja.
 *
 * Cubre lo que se usa a diario: movimientos, operadores con conteo, visual,
 * registros, deshacer/rehacer, búsqueda y unos pocos comandos de dos puntos.
 */
export function applyKey(state: VimState, event: KeyEvent): VimResult {
  const { key, ctrl, shift } = event;

  // --- línea de comandos (: y /) ---
  if (state.mode === 'command') {
    if (key === 'Escape') return { state: { ...state, mode: 'normal', command: '' } };
    if (key === 'Enter') {
      const line = state.command;
      if (line.startsWith('/')) {
        return { state: { ...runSearch({ ...state, mode: 'normal', command: '' }, line.slice(1), true) } };
      }
      return runExCommand(state, line.slice(1));
    }
    if (key === 'Backspace') {
      const next = state.command.slice(0, -1);
      return { state: next ? { ...state, command: next } : { ...state, mode: 'normal', command: '' } };
    }
    if (key.length === 1) return { state: { ...state, command: state.command + key } };
    return { state };
  }

  // --- inserción ---
  if (state.mode === 'insert') {
    if (key === 'Escape') {
      return { state: { ...state, mode: 'normal', cursor: clampNormal(state.text, Math.max(0, state.cursor - 1)), wantCol: null } };
    }
    if (key === 'Enter') {
      const text = `${state.text.slice(0, state.cursor)}\n${state.text.slice(state.cursor)}`;
      return { state: { ...state, text, cursor: state.cursor + 1, dirty: true } };
    }
    if (key === 'Tab') {
      const text = `${state.text.slice(0, state.cursor)}  ${state.text.slice(state.cursor)}`;
      return { state: { ...state, text, cursor: state.cursor + 2, dirty: true } };
    }
    if (key === 'Backspace') {
      if (!state.cursor) return { state };
      const text = state.text.slice(0, state.cursor - 1) + state.text.slice(state.cursor);
      return { state: { ...state, text, cursor: state.cursor - 1, dirty: true } };
    }
    if (key === 'Delete') {
      const text = state.text.slice(0, state.cursor) + state.text.slice(state.cursor + 1);
      return { state: { ...state, text, dirty: true } };
    }
    if (key.length === 1 && !ctrl) {
      const text = state.text.slice(0, state.cursor) + key + state.text.slice(state.cursor);
      return { state: { ...state, text, cursor: state.cursor + 1, dirty: true } };
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
      return { state: arrow(state, key) };
    }
    return { state };
  }

  // --- normal y visual ---
  if (key === 'Escape') {
    return { state: { ...state, mode: 'normal', pending: '', message: '', wantCol: null } };
  }

  if (ctrl) {
    if (key === 'r') {
      const last = state.redo[state.redo.length - 1];
      if (!last) return { state: { ...state, message: 'nada que rehacer' } };
      return {
        state: {
          ...state,
          text: last.text,
          cursor: last.cursor,
          redo: state.redo.slice(0, -1),
          undo: [...state.undo, snapshot(state)],
          dirty: true,
        },
      };
    }
    if (key === 'd' || key === 'u') {
      const step = Math.max(1, Math.floor(12));
      return { state: verticalMove(state, key === 'd' ? 1 : -1, step) };
    }
    return { state };
  }

  const digit = /^[1-9]$/.test(key) || (key === '0' && /\d$/.test(state.pending));
  if (digit) return { state: { ...state, pending: state.pending + key } };

  const countMatch = state.pending.match(/^(\d*)/);
  const explicitCount = !!(countMatch && countMatch[1]);
  const count = explicitCount ? parseInt(countMatch![1], 10) : 1;
  const rest = state.pending.replace(/^\d*/, '');

  // r{char}: reemplazar un carácter
  if (rest === 'r') {
    if (key.length !== 1) return { state: { ...state, pending: '' } };
    const text = state.text.slice(0, state.cursor) + key + state.text.slice(state.cursor + 1);
    return { state: { ...withEdit(state, text, state.cursor), pending: '' } };
  }

  if (rest === 'g') {
    if (key === 'f') {
      return { state: { ...state, pending: '' }, action: { openUnderCursor: true } };
    }
    if (key === 'g') {
      const target = startOfLine(state.text, count > 1 ? count - 1 : 0);
      return { state: { ...state, cursor: target, pending: '', wantCol: null } };
    }
    return { state: { ...state, pending: '' } };
  }

  // Operador pendiente (d, c, y): esta tecla es el movimiento.
  if (rest === 'd' || rest === 'c' || rest === 'y') {
    const op = rest;
    if (key === op) {
      const [from, to] = lineRange(state.text, state.cursor, startOfLine(state.text, lineOf(state.text, state.cursor) + count - 1));
      return { state: applyOperator(state, op, from, to, true) };
    }
    const motion = motionFor(state, key, count, explicitCount);
    if (!motion) return { state: { ...state, pending: '' } };
    const to = motion.inclusive ? motion.to + 1 : motion.to;
    if (motion.linewise) {
      const [from, end] = lineRange(state.text, state.cursor, to);
      return { state: applyOperator(state, op, from, end, true) };
    }
    return { state: applyOperator(state, op, state.cursor, to, false) };
  }

  const visual = state.mode === 'visual' || state.mode === 'visual-line';

  // Movimientos simples
  const motion = motionFor(state, key, count, explicitCount);
  if (motion && !'jk'.includes(key)) {
    return { state: { ...state, cursor: visual ? motion.to : clampNormal(state.text, motion.to), pending: '', wantCol: null } };
  }
  if (key === 'j' || key === 'k') {
    return { state: { ...verticalMove(state, key === 'j' ? 1 : -1, count), pending: '' } };
  }
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
    return { state: { ...arrow(state, key), pending: '' } };
  }

  switch (key) {
    case 'i':
      return { state: { ...state, mode: 'insert', pending: '' } };
    case 'a':
      return { state: { ...state, mode: 'insert', cursor: Math.min(state.text.length, state.cursor + 1), pending: '' } };
    case 'I':
      return { state: { ...state, mode: 'insert', cursor: firstNonBlank(state.text, state.cursor), pending: '' } };
    case 'A':
      return { state: { ...state, mode: 'insert', cursor: lineEnd(state.text, state.cursor), pending: '' } };
    case 'o': {
      const at = lineEnd(state.text, state.cursor);
      const text = `${state.text.slice(0, at)}\n${state.text.slice(at)}`;
      return { state: { ...withEdit(state, text, at + 1), mode: 'insert', pending: '' } };
    }
    case 'O': {
      const at = lineStart(state.text, state.cursor);
      const text = `${state.text.slice(0, at)}\n${state.text.slice(at)}`;
      return { state: { ...withEdit(state, text, at), mode: 'insert', pending: '' } };
    }
    case 'x': {
      if (visual) {
        const [from, to] = state.mode === 'visual-line'
          ? lineRange(state.text, state.anchor, state.cursor)
          : [Math.min(state.anchor, state.cursor), Math.max(state.anchor, state.cursor) + 1];
        return { state: { ...applyOperator(state, 'd', from, to, state.mode === 'visual-line'), mode: 'normal' } };
      }
      const end = Math.min(lineEnd(state.text, state.cursor), state.cursor + count);
      return { state: { ...applyOperator(state, 'd', state.cursor, end, false), pending: '' } };
    }
    case 'D': {
      return { state: applyOperator(state, 'd', state.cursor, lineEnd(state.text, state.cursor), false) };
    }
    case 'C': {
      return { state: applyOperator(state, 'c', state.cursor, lineEnd(state.text, state.cursor), false) };
    }
    case 's': {
      return { state: applyOperator(state, 'c', state.cursor, Math.min(lineEnd(state.text, state.cursor), state.cursor + count), false) };
    }
    case 'J': {
      const end = lineEnd(state.text, state.cursor);
      if (end >= state.text.length) return { state: { ...state, pending: '' } };
      const rest2 = state.text.slice(end + 1);
      const trimmed = rest2.replace(/^\s*/, '');
      const text = `${state.text.slice(0, end)} ${trimmed}`;
      return { state: { ...withEdit(state, text, end), pending: '' } };
    }
    case 'p':
      return { state: { ...paste(state, true, count), pending: '' } };
    case 'P':
      return { state: { ...paste(state, false, count), pending: '' } };
    case 'u': {
      const last = state.undo[state.undo.length - 1];
      if (!last) return { state: { ...state, message: 'nada que deshacer', pending: '' } };
      return {
        state: {
          ...state,
          text: last.text,
          cursor: last.cursor,
          undo: state.undo.slice(0, -1),
          redo: [...state.redo, snapshot(state)],
          pending: '',
          dirty: true,
        },
      };
    }
    case 'v':
      return { state: { ...state, mode: visual ? 'normal' : 'visual', anchor: state.cursor, pending: '' } };
    case 'V':
      return { state: { ...state, mode: visual ? 'normal' : 'visual-line', anchor: state.cursor, pending: '' } };
    case 'd':
    case 'c':
    case 'y': {
      if (visual) {
        const [from, to] = state.mode === 'visual-line'
          ? lineRange(state.text, state.anchor, state.cursor)
          : [Math.min(state.anchor, state.cursor), Math.max(state.anchor, state.cursor) + 1];
        const applied = applyOperator(state, key, from, to, state.mode === 'visual-line');
        return { state: { ...applied, mode: key === 'c' ? 'insert' : 'normal' } };
      }
      return { state: { ...state, pending: state.pending + key } };
    }
    case 'g':
    case 'r':
      return { state: { ...state, pending: state.pending + key } };
    case ':':
      return { state: { ...state, mode: 'command', command: ':', pending: '' } };
    case '/':
      return { state: { ...state, mode: 'command', command: '/', pending: '' } };
    case 'n':
      return { state: runSearch(state, state.search, !shift) };
    case 'N':
      return { state: runSearch(state, state.search, false) };
    default:
      return { state: { ...state, pending: '' } };
  }
}

function arrow(state: VimState, key: string): VimState {
  if (key === 'ArrowLeft') return { ...state, cursor: Math.max(0, state.cursor - 1), wantCol: null };
  if (key === 'ArrowRight') return { ...state, cursor: Math.min(state.text.length, state.cursor + 1), wantCol: null };
  return verticalMove(state, key === 'ArrowDown' ? 1 : -1, 1);
}

/** Palabra bajo el cursor, para `gf` y para resaltar. */
export function wordAt(text: string, pos: number): string {
  const wordChar = (c: string | undefined) => !!c && /[A-Za-z0-9_$]/.test(c);
  if (!wordChar(text[pos])) return '';
  let from = pos;
  let to = pos;
  while (from > 0 && wordChar(text[from - 1])) from--;
  while (to + 1 < text.length && wordChar(text[to + 1])) to++;
  return text.slice(from, to + 1);
}
