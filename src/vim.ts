export type Mode = 'normal' | 'insert' | 'visual' | 'visual-line' | 'command';

/** Última búsqueda de carácter en la línea (`f`, `F`, `t`, `T`), para `;` y `,`. */
export interface Find {
  kind: 'f' | 'F' | 't' | 'T';
  char: string;
}

export interface VimState {
  text: string;
  /** Posición del cursor como offset dentro del texto. */
  cursor: number;
  /** Extremo fijo de la selección en modo visual. */
  anchor: number;
  mode: Mode;
  /** Teclas a medio comando: `2d`, `g`, `r`, `di`, `f`… */
  pending: string;
  /** Línea que se está escribiendo tras `:`, `/` o `?`. */
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
  lastFind: Find | null;
  /** Teclas del último cambio, para repetirlo con `.`. */
  lastChange: KeyEvent[] | null;
  /** Teclas del cambio en curso y el texto antes de empezarlo. */
  seq: KeyEvent[];
  seqText: string | null;
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
  quitWithoutSaving?: boolean;
  /** `gt` / `gT`: pasar a la ventana siguiente o anterior. */
  window?: 'next' | 'prev';
  /** `gd`: ir a la definición (en otro fichero si viene de ahí). `gD`: solo en este. */
  definition?: 'any' | 'local';
  /** `K`: contar qué es el símbolo bajo el cursor. */
  hover?: boolean;
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
    lastFind: null,
    lastChange: null,
    seq: [],
    seqText: null,
  };
}

const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);
const isSpace = (c: string) => /\s/.test(c);
/** Clase de carácter para `w`: espacio, palabra o puntuación. */
const wordClass = (c: string | undefined) => (c === undefined || isSpace(c) ? 0 : isWord(c) ? 1 : 2);
/** Clase para `W`: solo importa si es espacio o no. */
const bigClass = (c: string | undefined) => (c === undefined || isSpace(c) ? 0 : 1);

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

function nextWord(text: string, pos: number, big = false): number {
  const cls = big ? bigClass : wordClass;
  let i = pos;
  const start = cls(text[i]);
  while (i < text.length && start !== 0 && cls(text[i]) === start) i++;
  while (i < text.length && isSpace(text[i])) i++;
  return Math.min(i, text.length);
}

function prevWord(text: string, pos: number, big = false): number {
  const cls = big ? bigClass : wordClass;
  let i = pos - 1;
  while (i > 0 && isSpace(text[i])) i--;
  const target = cls(text[i]);
  while (i > 0 && target !== 0 && cls(text[i - 1]) === target) i--;
  return Math.max(0, i);
}

function wordEnd(text: string, pos: number, big = false): number {
  const cls = big ? bigClass : wordClass;
  let i = pos + 1;
  while (i < text.length && isSpace(text[i])) i++;
  const target = cls(text[i]);
  while (i + 1 < text.length && target !== 0 && cls(text[i + 1]) === target) i++;
  return Math.min(i, Math.max(0, text.length - 1));
}

/** `f`, `F`, `t`, `T` dentro de la línea. `again` es la repetición con `;`. */
function findChar(text: string, cursor: number, find: Find, count: number, again = false): number | null {
  const start = lineStart(text, cursor);
  const end = lineEnd(text, cursor);
  let pos = cursor;
  for (let n = 0; n < count; n++) {
    // Repetir un `t` desde justo antes del carácter no avanzaría: se salta uno.
    const skip = (find.kind === 't' || find.kind === 'T') && (again || n > 0) ? 2 : 1;
    if (find.kind === 'f' || find.kind === 't') {
      const idx = text.indexOf(find.char, pos + skip);
      if (idx < 0 || idx >= end) return null;
      pos = find.kind === 't' ? idx - 1 : idx;
    } else {
      const from = pos - skip;
      if (from < start) return null;
      const idx = text.lastIndexOf(find.char, from);
      if (idx < start) return null;
      pos = find.kind === 'T' ? idx + 1 : idx;
    }
  }
  return pos;
}

const REVERSE: Record<Find['kind'], Find['kind']> = { f: 'F', F: 'f', t: 'T', T: 't' };

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', ')': '(', ']': '[', '}': '{' };

/** `%`: el par del primer paréntesis, corchete o llave desde el cursor. */
function matchPair(text: string, cursor: number): number | null {
  const end = lineEnd(text, cursor);
  let i = cursor;
  while (i < end && !(text[i] in PAIRS)) i++;
  if (i >= end) return null;
  const c = text[i];
  const other = PAIRS[c];
  const forward = '([{'.includes(c);
  let depth = 0;
  for (let j = i; forward ? j < text.length : j >= 0; j += forward ? 1 : -1) {
    if (text[j] === c) depth++;
    else if (text[j] === other && --depth === 0) return j;
  }
  return null;
}

/** `}` y `{`: la próxima línea en blanco después (o antes) del párrafo. */
function paragraph(text: string, cursor: number, dir: 1 | -1, count: number): number {
  const lines = text.split('\n');
  const blank = (l: number) => /^\s*$/.test(lines[l] ?? '');
  const last = lines.length - 1;
  let line = lineOf(text, cursor);
  for (let n = 0; n < count; n++) {
    line += dir;
    while (line > 0 && line < last && blank(line)) line += dir;
    while (line > 0 && line < last && !blank(line)) line += dir;
  }
  line = Math.max(0, Math.min(last, line));
  return startOfLine(text, line);
}

const BRACKETS: Record<string, [string, string]> = {
  '(': ['(', ')'],
  ')': ['(', ')'],
  b: ['(', ')'],
  '[': ['[', ']'],
  ']': ['[', ']'],
  '{': ['{', '}'],
  '}': ['{', '}'],
  B: ['{', '}'],
  '<': ['<', '>'],
  '>': ['<', '>'],
};

/**
 * Objetos de texto: `iw`, `aw`, `iW`, `i"`, `a'`, `` i` ``, `i(`, `a{`, `i[`,
 * `i<`… Devuelve el rango [desde, hasta) o null si no hay objeto acá.
 */
function textObject(text: string, cursor: number, kind: 'i' | 'a', obj: string): [number, number] | null {
  const start = lineStart(text, cursor);
  const end = lineEnd(text, cursor);

  if (obj === 'w' || obj === 'W') {
    const cls = obj === 'W' ? bigClass : wordClass;
    const target = cls(text[cursor]);
    let from = cursor;
    let to = Math.min(cursor + 1, end);
    while (from > start && cls(text[from - 1]) === target) from--;
    while (to < end && cls(text[to]) === target) to++;
    if (kind === 'a') {
      if (target === 0) {
        // Sobre espacios, `aw` es el espacio más la palabra que sigue.
        const next = cls(text[to]);
        while (to < end && next !== 0 && cls(text[to]) === next) to++;
      } else {
        let trail = to;
        while (trail < end && isSpace(text[trail])) trail++;
        if (trail > to) to = trail;
        else while (from > start && isSpace(text[from - 1])) from--;
      }
    }
    return [from, to];
  }

  if (obj === '"' || obj === "'" || obj === '`') {
    const quotes: number[] = [];
    for (let i = start; i < end; i++) if (text[i] === obj && text[i - 1] !== '\\') quotes.push(i);
    const pairs: [number, number][] = [];
    for (let p = 0; p + 1 < quotes.length; p += 2) pairs.push([quotes[p], quotes[p + 1]]);
    const pair = pairs.find(([a, b]) => cursor >= a && cursor <= b) ?? pairs.find(([a]) => a > cursor);
    if (!pair) return null;
    return kind === 'i' ? [pair[0] + 1, pair[1]] : [pair[0], pair[1] + 1];
  }

  const bracket = BRACKETS[obj];
  if (!bracket) return null;
  const [open, close] = bracket;
  let depth = 0;
  let from = -1;
  for (let i = cursor; i >= 0; i--) {
    if (text[i] === close && i !== cursor) depth++;
    else if (text[i] === open) {
      if (depth === 0) {
        from = i;
        break;
      }
      depth--;
    }
  }
  if (from < 0) return null;
  depth = 0;
  let to = -1;
  for (let i = from; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) {
      to = i;
      break;
    }
  }
  if (to < 0) return null;
  if (kind === 'a') return [from, to + 1];
  let inner = from + 1;
  let innerEnd = to;
  // Bloque de varias líneas: `di{` borra las líneas de adentro y deja las llaves en su lugar.
  if (text[inner] === '\n') inner++;
  const lastBreak = text.lastIndexOf('\n', innerEnd - 1);
  if (lastBreak >= inner && /^\s*$/.test(text.slice(lastBreak + 1, innerEnd))) innerEnd = lastBreak + 1;
  return [inner, Math.max(inner, innerEnd)];
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

/** Entrar a inserción guarda un punto de deshacer: `u` deshace todo lo tipeado de una vez. */
function enterInsert(state: VimState, cursor: number): VimState {
  return {
    ...state,
    undo: [...state.undo.slice(-200), snapshot(state)],
    redo: [],
    mode: 'insert',
    cursor,
    pending: '',
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
    case 'W':
      return { to: repeat(cursor, count, (p) => nextWord(text, p, key === 'W')) };
    case 'b':
    case 'B':
      return { to: repeat(cursor, count, (p) => prevWord(text, p, key === 'B')) };
    case 'e':
    case 'E':
      return { to: repeat(cursor, count, (p) => wordEnd(text, p, key === 'E')), inclusive: true };
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
    case '}':
      return { to: paragraph(text, cursor, 1, count) };
    case '{':
      return { to: paragraph(text, cursor, -1, count) };
    case '%': {
      const to = matchPair(text, cursor);
      return to === null ? null : { to, inclusive: true };
    }
    case ';':
    case ',': {
      if (!state.lastFind) return null;
      const find = key === ';' ? state.lastFind : { ...state.lastFind, kind: REVERSE[state.lastFind.kind] };
      const to = findChar(text, cursor, find, count, true);
      return to === null ? null : { to, inclusive: find.kind === 'f' || find.kind === 't' };
    }
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

/** Sangra (`>`) o desangra (`<`) las líneas que toca el rango [start, end). */
function indent(state: VimState, start: number, end: number, dir: 1 | -1): VimState {
  const first = lineOf(state.text, start);
  const last = lineOf(state.text, Math.max(start, end - 1));
  const lines = state.text.split('\n');
  for (let l = first; l <= last && l < lines.length; l++) {
    if (dir > 0) lines[l] = lines[l].length ? `  ${lines[l]}` : lines[l];
    else lines[l] = lines[l].replace(/^( {1,2}|\t)/, '');
  }
  const text = lines.join('\n');
  return { ...withEdit(state, text, firstNonBlank(text, startOfLine(text, first))), mode: 'normal', pending: '' };
}

function applyOperator(state: VimState, op: string, from: number, to: number, linewise: boolean): VimState {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  if (op === '>' || op === '<') return indent(state, start, end, op === '>' ? 1 : -1);
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
  const idx = forward ? state.text.indexOf(pattern, Math.max(0, from)) : from < 0 ? -1 : state.text.lastIndexOf(pattern, from);
  const wrapped = idx < 0 ? (forward ? state.text.indexOf(pattern) : state.text.lastIndexOf(pattern)) : idx;
  if (wrapped < 0) return { ...state, message: `patrón no encontrado: ${pattern}` };
  return { ...state, cursor: wrapped, search: pattern, message: '' };
}

/** `Ctrl+A` / `Ctrl+X`: suma al primer número desde el cursor, en la misma línea. */
function increment(state: VimState, delta: number): VimState {
  const start = lineStart(state.text, state.cursor);
  const end = lineEnd(state.text, state.cursor);
  const line = state.text.slice(start, end);
  const re = /-?\d+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const from = start + m.index;
    const to = from + m[0].length;
    if (to <= state.cursor) continue;
    const value = String(parseInt(m[0], 10) + delta);
    const text = state.text.slice(0, from) + value + state.text.slice(to);
    return withEdit(state, text, from + value.length - 1);
  }
  return state;
}

function toggleCase(state: VimState, from: number, to: number, cursor: number): VimState {
  const chunk = state.text.slice(from, to);
  const flipped = [...chunk].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('');
  return withEdit(state, state.text.slice(0, from) + flipped + state.text.slice(to), cursor);
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
    case 'tabn':
    case 'tabnext':
    case 'bn':
      return { state: base, action: { window: 'next' } };
    case 'tabp':
    case 'tabprevious':
    case 'bp':
      return { state: base, action: { window: 'prev' } };
    default:
      return { state: { ...base, message: `no se reconoce :${cmd}` } };
  }
}

/**
 * Motor de vim: recibe una tecla y devuelve el estado nuevo. Es una función
 * pura, así que se puede probar sin DOM y el componente solo dibuja.
 *
 * Por encima de `step` lleva la cuenta del último cambio para que `.` lo
 * repita: se graban las teclas desde que arranca un comando en modo normal
 * hasta que se vuelve a él, y si el texto cambió, esa es la receta.
 */
export function applyKey(state: VimState, event: KeyEvent): VimResult {
  if (state.mode === 'normal' && !state.pending && event.key === '.' && !event.ctrl) {
    if (!state.lastChange) return { state };
    let current: VimState = { ...state, seq: [], seqText: null };
    let action: VimAction | undefined;
    for (const key of state.lastChange) {
      const result = step(current, key);
      current = result.state;
      action = result.action ?? action;
    }
    if (current.mode === 'insert') current = step(current, { key: 'Escape', ctrl: false, shift: false }).state;
    return { state: { ...current, lastChange: state.lastChange, seq: [], seqText: null }, action };
  }

  const starting = state.mode === 'normal' && !state.pending && state.seq.length === 0;
  const seq = starting ? [event] : [...state.seq, event];
  const seqText = starting ? state.text : state.seqText;
  const result = step(state, event);
  let next = result.state;

  if (next.mode === 'normal' && !next.pending) {
    const first = seq[0];
    const undoing = first.key === 'u' || (first.ctrl && first.key === 'r');
    const changed = seqText !== null && next.text !== seqText && !undoing;
    next = { ...next, seq: [], seqText: null, lastChange: changed ? seq : next.lastChange };
  } else if ((next.mode === 'insert' || next.pending) && seqText !== null) {
    next = { ...next, seq, seqText };
  } else {
    // Visual y la línea de comandos no se graban: `.` repite cambios de modo normal.
    next = { ...next, seq: [], seqText: null };
  }
  return { state: next, action: result.action };
}

function step(state: VimState, event: KeyEvent): VimResult {
  const { key, ctrl, shift } = event;

  // --- línea de comandos (:, / y ?) ---
  if (state.mode === 'command') {
    if (key === 'Escape') return { state: { ...state, mode: 'normal', command: '' } };
    if (key === 'Enter') {
      const line = state.command;
      if (line.startsWith('/') || line.startsWith('?')) {
        const base = { ...state, mode: 'normal' as Mode, command: '' };
        return { state: runSearch(base, line.slice(1) || state.search, line.startsWith('/')) };
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
      // La línea nueva conserva la sangría de la actual.
      const lead = /^[ \t]*/.exec(state.text.slice(lineStart(state.text, state.cursor), state.cursor))![0];
      const text = `${state.text.slice(0, state.cursor)}\n${lead}${state.text.slice(state.cursor)}`;
      return { state: { ...state, text, cursor: state.cursor + 1 + lead.length, dirty: true } };
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
    if (ctrl && key === 'w') {
      // Ctrl+W en inserción borra la palabra anterior, como en vim.
      const from = prevWord(state.text, state.cursor);
      const text = state.text.slice(0, from) + state.text.slice(state.cursor);
      return { state: { ...state, text, cursor: from, dirty: true } };
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

  const visual = state.mode === 'visual' || state.mode === 'visual-line';

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
      return { state: verticalMove(state, key === 'd' ? 1 : -1, 12) };
    }
    if ((key === 'a' || key === 'x') && !visual) {
      const count = parseInt(state.pending, 10) || 1;
      return { state: { ...increment(state, key === 'a' ? count : -count), pending: '' } };
    }
    return { state };
  }

  // Pendiente: [cuenta][operador][cuenta][sufijo], como en `2d3w`, `di(`, `ct,`.
  const parsed = /^(\d*)([dcy<>]?)(\d*)([fFtTiagr]?)$/.exec(state.pending);
  if (!parsed) return { state: { ...state, pending: '' } };
  const [, countA, op, countB, suffix] = parsed;
  const explicitCount = !!(countA || countB);
  const count = (parseInt(countA, 10) || 1) * (parseInt(countB, 10) || 1);
  const reset = { ...state, pending: '' };

  // r{char}: reemplazar caracteres
  if (suffix === 'r') {
    if (key.length !== 1) return { state: reset };
    const end = state.cursor + count;
    if (end > lineEnd(state.text, state.cursor)) return { state: reset };
    const text = state.text.slice(0, state.cursor) + key.repeat(count) + state.text.slice(end);
    return { state: { ...withEdit(state, text, end - 1), pending: '' } };
  }

  // f/F/t/T{char}: buscar en la línea, sola o como movimiento de un operador.
  if (suffix === 'f' || suffix === 'F' || suffix === 't' || suffix === 'T') {
    if (key.length !== 1) return { state: reset };
    const find: Find = { kind: suffix, char: key };
    const to = findChar(state.text, state.cursor, find, count);
    const remembered = { ...reset, lastFind: find };
    if (to === null) return { state: remembered };
    if (op) {
      const forward = suffix === 'f' || suffix === 't';
      const [from, end] = forward ? [state.cursor, to + 1] : [to, state.cursor];
      return { state: applyOperator(remembered, op, from, end, false) };
    }
    return { state: { ...remembered, cursor: to, wantCol: null } };
  }

  // Objetos de texto: `diw`, `ci"`, `ya(`, `vi{`…
  if (suffix === 'i' || suffix === 'a') {
    const range = textObject(state.text, state.cursor, suffix, key);
    if (!range || range[1] <= range[0]) return { state: reset };
    if (op) return { state: applyOperator(state, op, range[0], range[1], false) };
    if (visual) return { state: { ...reset, mode: 'visual', anchor: range[0], cursor: range[1] - 1 } };
    return { state: reset };
  }

  if (suffix === 'g') {
    if (key === 'f') return { state: reset, action: { openUnderCursor: true } };
    if (key === 'd') return { state: reset, action: { definition: 'any' } };
    if (key === 'D') return { state: reset, action: { definition: 'local' } };
    if (key === 't') return { state: reset, action: { window: 'next' } };
    if (key === 'T') return { state: reset, action: { window: 'prev' } };
    if (key === 'g') {
      const target = startOfLine(state.text, explicitCount ? count - 1 : 0);
      return { state: { ...reset, cursor: target, wantCol: null } };
    }
    return { state: reset };
  }

  const digit = /^[1-9]$/.test(key) || (key === '0' && /\d$/.test(state.pending));
  if (digit) return { state: { ...state, pending: state.pending + key } };

  // Operador pendiente (d, c, y, >, <): esta tecla es el movimiento.
  if (op) {
    if ('fFtTia'.includes(key)) return { state: { ...state, pending: state.pending + key } };
    if (key === op) {
      const last = startOfLine(state.text, lineOf(state.text, state.cursor) + count - 1);
      const [from, to] = lineRange(state.text, state.cursor, last);
      return { state: applyOperator(state, op, from, to, true) };
    }
    let motion: Motion | null;
    if (op === 'c' && (key === 'w' || key === 'W') && !isSpace(state.text[state.cursor] ?? ' ')) {
      // `cw` sobre una palabra se comporta como `ce`: no se come el espacio de después.
      const big = key === 'W';
      const cls = big ? bigClass : wordClass;
      const text = state.text;
      let to = state.cursor;
      for (let n = 0; n < count; n++) {
        to = n === 0 && cls(text[to + 1]) !== cls(text[to]) ? to : wordEnd(text, to, big);
      }
      motion = { to, inclusive: true };
    } else {
      motion = motionFor(state, key, count, explicitCount);
    }
    if (!motion) return { state: reset };
    if (motion.linewise) {
      const [from, end] = lineRange(state.text, state.cursor, motion.to);
      return { state: applyOperator(state, op, from, end, true) };
    }
    let from = state.cursor;
    let to = motion.to;
    if (motion.inclusive) {
      if (to >= from) to += 1;
      else from += 1;
    }
    return { state: applyOperator(state, op, from, to, false) };
  }

  // En visual, `i` y `a` abren un objeto de texto en vez de insertar.
  if (visual && (key === 'i' || key === 'a')) return { state: { ...state, pending: state.pending + key } };

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

  const selection = (): [number, number] =>
    state.mode === 'visual-line'
      ? lineRange(state.text, state.anchor, state.cursor)
      : [Math.min(state.anchor, state.cursor), Math.max(state.anchor, state.cursor) + 1];

  switch (key) {
    case 'i':
      return { state: enterInsert(state, state.cursor) };
    case 'a':
      return { state: enterInsert(state, Math.min(lineEnd(state.text, state.cursor), state.cursor + 1)) };
    case 'I':
      return { state: enterInsert(state, firstNonBlank(state.text, state.cursor)) };
    case 'A':
      return { state: enterInsert(state, lineEnd(state.text, state.cursor)) };
    case 'o':
    case 'O': {
      if (visual) {
        // En visual, `o` salta al otro extremo de la selección.
        return { state: { ...state, anchor: state.cursor, cursor: state.anchor, pending: '' } };
      }
      const lead = /^[ \t]*/.exec(state.text.slice(lineStart(state.text, state.cursor)))![0];
      const at = key === 'o' ? lineEnd(state.text, state.cursor) : lineStart(state.text, state.cursor);
      const text =
        key === 'o'
          ? `${state.text.slice(0, at)}\n${lead}${state.text.slice(at)}`
          : `${state.text.slice(0, at)}${lead}\n${state.text.slice(at)}`;
      const cursor = key === 'o' ? at + 1 + lead.length : at + lead.length;
      return { state: { ...withEdit(state, text, cursor), mode: 'insert', pending: '' } };
    }
    case 'x': {
      if (visual) {
        const [from, to] = selection();
        return { state: { ...applyOperator(state, 'd', from, to, state.mode === 'visual-line'), mode: 'normal' } };
      }
      const end = Math.min(lineEnd(state.text, state.cursor), state.cursor + count);
      return { state: { ...applyOperator(state, 'd', state.cursor, end, false), pending: '' } };
    }
    case 'X': {
      const from = Math.max(lineStart(state.text, state.cursor), state.cursor - count);
      return { state: applyOperator(state, 'd', from, state.cursor, false) };
    }
    case 'D':
      return { state: applyOperator(state, 'd', state.cursor, lineEnd(state.text, state.cursor), false) };
    case 'C':
      return { state: applyOperator(state, 'c', state.cursor, lineEnd(state.text, state.cursor), false) };
    case 'Y': {
      const last = startOfLine(state.text, lineOf(state.text, state.cursor) + count - 1);
      const [from, to] = lineRange(state.text, state.cursor, last);
      return { state: applyOperator(state, 'y', from, to, true) };
    }
    case 's':
      return { state: applyOperator(state, 'c', state.cursor, Math.min(lineEnd(state.text, state.cursor), state.cursor + count), false) };
    case 'S':
      return { state: applyOperator(state, 'c', firstNonBlank(state.text, state.cursor), lineEnd(state.text, state.cursor), false) };
    case '~': {
      if (visual) {
        const [from, to] = selection();
        return { state: { ...toggleCase(state, from, to, from), mode: 'normal', pending: '' } };
      }
      const end = Math.min(lineEnd(state.text, state.cursor), state.cursor + count);
      if (end <= state.cursor) return { state: reset };
      const toggled = toggleCase(state, state.cursor, end, end);
      return { state: { ...toggled, cursor: clampNormal(toggled.text, end), pending: '' } };
    }
    case 'J': {
      const end = lineEnd(state.text, state.cursor);
      if (end >= state.text.length) return { state: reset };
      const trimmed = state.text.slice(end + 1).replace(/^\s*/, '');
      const text = `${state.text.slice(0, end)} ${trimmed}`;
      return { state: { ...withEdit(state, text, end), pending: '' } };
    }
    case 'p':
    case 'P': {
      if (visual) {
        // Pegar sobre una selección la reemplaza.
        const [from, to] = selection();
        const { register, registerLinewise } = state;
        const cut = applyOperator(state, 'd', from, to, state.mode === 'visual-line');
        // Se pega donde empezaba la selección, no donde quedó el cursor al cortar.
        return { state: { ...paste({ ...cut, cursor: from, register, registerLinewise }, false, 1), mode: 'normal', pending: '' } };
      }
      return { state: { ...paste(state, key === 'p', count), pending: '' } };
    }
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
          mode: 'normal',
          dirty: true,
        },
      };
    }
    case 'v':
      return { state: { ...state, mode: state.mode === 'visual' ? 'normal' : 'visual', anchor: visual ? state.anchor : state.cursor, pending: '' } };
    case 'V':
      return { state: { ...state, mode: state.mode === 'visual-line' ? 'normal' : 'visual-line', anchor: visual ? state.anchor : state.cursor, pending: '' } };
    case 'd':
    case 'c':
    case 'y':
    case '>':
    case '<': {
      if (visual) {
        const [from, to] = selection();
        const applied = applyOperator(state, key, from, to, state.mode === 'visual-line');
        return { state: { ...applied, mode: key === 'c' ? 'insert' : 'normal' } };
      }
      return { state: { ...state, pending: state.pending + key } };
    }
    case 'f':
    case 'F':
    case 't':
    case 'T':
    case 'g':
    case 'r':
      return { state: { ...state, pending: state.pending + key } };
    case ':':
      return { state: { ...state, mode: 'command', command: ':', pending: '' } };
    case '/':
    case '?':
      return { state: { ...state, mode: 'command', command: key, pending: '' } };
    case '*':
    case '#': {
      const word = wordAt(state.text, state.cursor);
      if (!word) return { state: { ...reset, message: 'no hay palabra bajo el cursor' } };
      return { state: { ...runSearch(state, word, key === '*'), pending: '' } };
    }
    case 'K':
      return { state: reset, action: { hover: true } };
    case 'n':
      return { state: runSearch(state, state.search, !shift) };
    case 'N':
      return { state: runSearch(state, state.search, false) };
    default:
      return { state: reset };
  }
}

function arrow(state: VimState, key: string): VimState {
  if (key === 'ArrowLeft') return { ...state, cursor: Math.max(0, state.cursor - 1), wantCol: null };
  if (key === 'ArrowRight') return { ...state, cursor: Math.min(state.text.length, state.cursor + 1), wantCol: null };
  return verticalMove(state, key === 'ArrowDown' ? 1 : -1, 1);
}

/** Palabra bajo el cursor, para `gf`, `*` y para resaltar. */
export function wordAt(text: string, pos: number): string {
  const wordChar = (c: string | undefined) => !!c && /[A-Za-z0-9_$]/.test(c);
  if (!wordChar(text[pos])) return '';
  let from = pos;
  let to = pos;
  while (from > 0 && wordChar(text[from - 1])) from--;
  while (to + 1 < text.length && wordChar(text[to + 1])) to++;
  return text.slice(from, to + 1);
}
