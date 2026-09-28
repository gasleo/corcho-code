export type TokenKind =
  | 'text'
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'ident'
  | 'punct'
  | 'regex'
  /** Solo en hojas de estilo: selector y nombre de propiedad. */
  | 'selector'
  | 'prop';

export interface Token {
  kind: TokenKind;
  value: string;
}

const KEYWORDS = new Set([
  'abstract', 'any', 'as', 'asserts', 'async', 'await', 'boolean', 'break', 'case', 'catch', 'class',
  'const', 'constructor', 'continue', 'debugger', 'declare', 'default', 'delete', 'do', 'else', 'enum',
  'export', 'extends', 'false', 'finally', 'for', 'from', 'function', 'get', 'if', 'implements', 'import',
  'in', 'infer', 'instanceof', 'interface', 'is', 'keyof', 'let', 'namespace', 'never', 'new', 'null',
  'number', 'of', 'private', 'protected', 'public', 'readonly', 'return', 'satisfies', 'set', 'static',
  'string', 'super', 'switch', 'symbol', 'this', 'throw', 'true', 'try', 'type', 'typeof', 'undefined',
  'unique', 'unknown', 'var', 'void', 'while', 'yield',
]);

const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c);
const isIdentPart = (c: string) => /[\w$]/.test(c);
const isDigit = (c: string) => c >= '0' && c <= '9';

/**
 * Tokenizador propio para JS/TS. No pretende ser un parser: alcanza para
 * colorear y, sobre todo, para saber que trozos son identificadores y poder
 * marcar los que vienen de otro fichero.
 */
function tokenizeScript(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  /** Ultimo token que decide si un `/` abre una regex o es una division. */
  let previous: Token | null = null;

  const push = (kind: TokenKind, value: string) => {
    if (!value) return;
    out.push({ kind, value });
    if (kind !== 'text' && kind !== 'comment') previous = out[out.length - 1];
  };

  const regexAllowed = () => {
    if (!previous) return true;
    if (previous.kind === 'keyword') return previous.value !== 'this' && previous.value !== 'super';
    if (previous.kind === 'punct') return !')]}'.includes(previous.value);
    return false;
  };

  while (i < src.length) {
    const c = src[i];

    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? src.length : end;
      push('comment', src.slice(i, stop));
      i = stop;
      continue;
    }

    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      push('comment', src.slice(i, stop));
      i = stop;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === c) {
          j++;
          break;
        }
        // Solo las plantillas pueden cruzar saltos de linea.
        if (src[j] === '\n' && c !== '`') break;
        j++;
      }
      push('string', src.slice(i, j));
      i = j;
      continue;
    }

    if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < src.length) {
        const d = src[j];
        if (d === '\\') {
          j += 2;
          continue;
        }
        if (d === '\n') break;
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) {
          j++;
          closed = true;
          break;
        }
        j++;
      }
      if (closed) {
        while (j < src.length && /[a-z]/.test(src[j])) j++;
        push('regex', src.slice(i, j));
        i = j;
        continue;
      }
    }

    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      let j = i;
      while (j < src.length && /[\w.]/.test(src[j])) j++;
      push('number', src.slice(i, j));
      i = j;
      continue;
    }

    if (isIdentStart(c)) {
      let j = i;
      while (j < src.length && isIdentPart(src[j])) j++;
      const word = src.slice(i, j);
      push(KEYWORDS.has(word) ? 'keyword' : 'ident', word);
      i = j;
      continue;
    }

    if (/\s/.test(c)) {
      let j = i;
      while (j < src.length && /\s/.test(src[j])) j++;
      push('text', src.slice(i, j));
      i = j;
      continue;
    }

    push('punct', c);
    i++;
  }

  return out;
}

/** Reparte los tokens en lineas, cortando los que abarcan varias. */
export function toLines(tokens: Token[]): Token[][] {
  const lines: Token[][] = [[]];
  for (const token of tokens) {
    const parts = token.value.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ kind: token.kind, value: part });
    });
  }
  return lines;
}

/** At-rules conocidas: lo demás que empiece con `@` es una variable de Less. */
const AT_RULES = new Set([
  'apply', 'at-root', 'charset', 'container', 'content', 'debug', 'each', 'else', 'error', 'extend',
  'font-face', 'for', 'forward', 'function', 'if', 'import', 'include', 'keyframes', 'layer', 'media',
  'mixin', 'namespace', 'page', 'plugin', 'property', 'require', 'return', 'screen', 'supports',
  'tailwind', 'theme', 'use', 'value', 'variants', 'warn', 'while',
]);

const isNameStart = (c: string) => /[A-Za-z_-]/.test(c);
const isNamePart = (c: string) => /[\w-]/.test(c);

/**
 * Tokenizador de hojas de estilo: CSS, Sass/SCSS, Less y Stylus.
 *
 * El tokenizador de JS no sirve acá —`url(/img/a.png)` se le vuelve una regex y
 * se come media hoja—, y además hay que emitir `$gap`, `--brand` o `@brand`
 * como **un** token: son los nombres que el editor cruza con lo que la hoja
 * importa para poder saltar al fichero donde están definidos.
 *
 * Para separar un selector de una declaración alcanza con mirar cómo termina:
 * lo que llega a `;` o `}` antes que a `{` es una declaración (`color: red`), y
 * lo que llega a `{` es un selector (`a:hover {`).
 */
function tokenizeStyles(src: string, lineComments: boolean): Token[] {
  const out: Token[] = [];
  /** Dentro del valor de una declaración: ahí `#fff` es un color, no un id. */
  let inValue = false;
  /** Dentro de una at-rule: `@include card` nombra un mixin, no un selector. */
  let inAtRule = false;

  const push = (kind: TokenKind, value: string) => {
    if (value) out.push({ kind, value });
  };

  const readWhile = (from: number, ok: (c: string) => boolean) => {
    let j = from;
    while (j < src.length && ok(src[j])) j++;
    return j;
  };

  /** `:` de declaración (cierra en `;` o `}`) o de pseudoclase (cierra en `{`). */
  const declaration = (colon: number) => {
    // `https://x`: el `:` de un esquema de URL no abre ningun valor.
    if (src[colon + 1] === '/') return false;
    for (let j = colon + 1; j < src.length; j++) {
      if (src[j] === '{') return false;
      if (src[j] === ';' || src[j] === '}') return true;
    }
    return true;
  };

  /** El nombre que empieza en `at` está seguido de un `:` de declaración. */
  const declares = (end: number) => {
    const j = readWhile(end, (c) => c === ' ' || c === '\t');
    return src[j] === ':' && declaration(j);
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      push('comment', src.slice(i, stop));
      i = stop;
      continue;
    }

    // En CSS puro `//` no es comentario, y en las demás no lo es dentro de una
    // URL (`https://`), que es el único sitio donde aparece detrás de dos puntos.
    if (lineComments && c === '/' && next === '/' && src[i - 1] !== ':') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? src.length : end;
      push('comment', src.slice(i, stop));
      i = stop;
      continue;
    }

    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === c || src[j] === '\n') {
          j++;
          break;
        }
        j++;
      }
      push('string', src.slice(i, j));
      i = j;
      continue;
    }

    if (c === '@' && next && isNameStart(next)) {
      const end = readWhile(i + 1, isNamePart);
      const word = src.slice(i + 1, end);
      // `@brand: #fff` es una variable de Less; `@media` es una at-rule.
      const atRule = AT_RULES.has(word);
      if (atRule) inAtRule = true;
      push(atRule ? 'keyword' : declares(end) ? 'prop' : 'ident', src.slice(i, end));
      i = end;
      continue;
    }

    if (c === '$' && next && isNamePart(next)) {
      const end = readWhile(i + 1, isNamePart);
      push(declares(end) ? 'prop' : 'ident', src.slice(i, end));
      i = end;
      continue;
    }

    if (c === '-' && next === '-' && src[i + 2] && isNamePart(src[i + 2])) {
      const end = readWhile(i + 2, isNamePart);
      push(declares(end) ? 'prop' : 'ident', src.slice(i, end));
      i = end;
      continue;
    }

    if (inValue && c === '#' && /[0-9a-fA-F]/.test(next ?? '')) {
      const end = readWhile(i + 1, (d) => /[0-9a-fA-F]/.test(d));
      push('number', src.slice(i, end));
      i = end;
      continue;
    }

    // Un sigilo pegado a un nombre dentro de una at-rule no abre un selector:
    // en `@include a.card` el punto separa el namespace del mixin.
    const member = inAtRule && isNamePart(src[i - 1] ?? ' ');
    if (!inValue && !member && (c === '.' || c === '#' || c === '%') && next && /[A-Za-z_-]/.test(next)) {
      const end = readWhile(i + 1, isNamePart);
      push('selector', src.slice(i, end));
      i = end;
      continue;
    }

    if (!inValue && c === '&') {
      push('selector', c);
      i++;
      continue;
    }

    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(next ?? ''))) {
      let end = readWhile(i, (d) => /[0-9.]/.test(d));
      // La unidad va pegada al número: `12px`, `1.5rem`, `50%`.
      end = readWhile(end, (d) => /[A-Za-z%]/.test(d));
      push('number', src.slice(i, end));
      i = end;
      continue;
    }

    if (c === '!' && next && isNameStart(next)) {
      const end = readWhile(i + 1, isNamePart);
      push('keyword', src.slice(i, end));
      i = end;
      continue;
    }

    if (isNameStart(c)) {
      const end = readWhile(i, isNamePart);
      push(declares(end) ? 'prop' : inValue || inAtRule ? 'ident' : 'selector', src.slice(i, end));
      i = end;
      continue;
    }

    if (/\s/.test(c)) {
      const end = readWhile(i, (d) => /\s/.test(d));
      push('text', src.slice(i, end));
      i = end;
      continue;
    }

    // Se entra al valor con el `:` de una declaracion; se sale con `;` o con
    // la llave. Un `:` de mas adentro (`url(https://…)`) no cambia nada.
    if (c === ':' && declaration(i)) inValue = true;
    else if (c === ';' || c === '{' || c === '}') {
      inValue = false;
      inAtRule = false;
    }

    push('punct', c);
    i++;
  }

  return out;
}

const STYLE_FILE = /\.(css|scss|sass|less|styl)$/i;

/**
 * Tokeniza según el fichero: las hojas de estilo tienen su propio léxico, y
 * pasarlas por el de JS no sale gratis (una `/` suelta le parece una regex).
 */
export function tokenize(src: string, file = ''): Token[] {
  if (!STYLE_FILE.test(file)) return tokenizeScript(src);
  return tokenizeStyles(src, !/\.css$/i.test(file));
}
