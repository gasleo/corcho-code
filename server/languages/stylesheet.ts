import path from 'node:path';
import type { SymbolRef } from '../../shared/types.ts';
import type { FileFacts, FileLink, LanguageAnalyzer, LinkContext, SourceFile } from '../analysis/types.ts';
import { Resolver } from '../resolve.ts';

/** Extensiones de hoja de estilo; las mismas que compila el preview. */
export const STYLE_EXTS = ['.css', '.scss', '.sass', '.less', '.styl'];

/** Sintaxis por indentacion: no hay llaves, manda la columna. */
const INDENTED = new Set(['.sass', '.styl']);

/** `//` es comentario en todas menos en CSS puro. */
const hasLineComments = (ext: string) => ext !== '.css';

interface StyleImport {
  /** Especificador tal como esta escrito, sin comillas. */
  specifier: string;
  kind: 'use' | 'forward' | 'import' | 'composes';
  /** Prefijo con el que se accede a lo importado (`@use 'a' as b` -> `b`). */
  namespace?: string;
  /** Nombres pedidos explicitamente: `composes: a b from './x.css'`. */
  names?: string[];
}

interface StyleData {
  imports: StyleImport[];
  /** Nombre con su sigilo (`$gap`, `--brand`, `card()`) -> veces que se usa. */
  usage: [string, number][];
  /** Namespace de un `@use` -> miembros que se le piden, con su cuenta. */
  members: [string, [string, number][]][];
}

/**
 * At-rules conocidas. Sirven para no confundirlas con las variables de Less,
 * que se escriben igual (`@brand`).
 */
const AT_RULES = new Set([
  'apply', 'at-root', 'charset', 'config', 'container', 'content', 'counter-style', 'custom-media',
  'custom-selector', 'debug', 'each', 'else', 'error', 'extend', 'font-face', 'font-feature-values',
  'for', 'forward', 'function', 'if', 'import', 'include', 'keyframes', 'layer', 'media', 'mixin',
  'namespace', 'page', 'plugin', 'property', 'require', 'return', 'screen', 'source', 'supports',
  'tailwind', 'theme', 'use', 'utility', 'value', 'variants', 'warn', 'while',
]);

/** Especificadores que nunca son un fichero del proyecto. */
const NON_FILE = /^(?:https?:|\/\/|data:|sass:|#)/;

/**
 * Deja los comentarios en blanco conservando la longitud, sin tocar las
 * cadenas: de ahi salen los especificadores de `@import` y `@use`. El `//` de
 * dentro de una URL no cuenta, y en CSS puro no cuenta nunca.
 */
function stripComments(src: string, lineComments: boolean): string {
  const out = src.split('');
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < out.length; i++) {
      if (out[i] !== '\n') out[i] = ' ';
    }
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (lineComments && c === '/' && src[i + 1] === '/' && src[i - 1] !== ':') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? src.length : end;
      blank(i, stop);
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
      i = j;
      continue;
    }
    i++;
  }

  return out.join('');
}

/** Cadenas en blanco: un nombre dentro de un literal no es un uso. */
function blankStrings(src: string): string {
  const out = src.split('');
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c !== '"' && c !== "'") {
      i++;
      continue;
    }
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
    for (let k = i + 1; k < j - 1 && k < out.length; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
    i = j;
  }
  return out.join('');
}

const AT_IMPORT = /@(use|forward|import|require)\b([^;{}]*)/g;
const SPEC_IN_TAIL = /["']([^"'\n]+)["']|url\(\s*([^)'"\s]+)\s*\)/g;
const NAMESPACE_AS = /\bas\s+([\w$*-]+)/;
const COMPOSES = /composes\s*:\s*([^;{}]+?)\s+from\s+["']([^"'\n]+)["']/g;
const VALUE_FROM = /@value\s+([^;]+?)\s+from\s+["']([^"'\n]+)["']/g;

/** `@use 'a/b/_vars.scss'` se accede como `vars.`: base, sin `_` ni extension. */
function defaultNamespace(spec: string): string {
  const base = spec.split(/[\\/]/).pop() ?? spec;
  return base.replace(/\.[a-z]+$/i, '').replace(/^_/, '');
}

function collectImports(text: string): StyleImport[] {
  const imports: StyleImport[] = [];

  for (const at of text.matchAll(AT_IMPORT)) {
    const kind = at[1] === 'require' ? 'import' : (at[1] as StyleImport['kind']);
    const tail = at[2] ?? '';
    const explicit = NAMESPACE_AS.exec(tail)?.[1];
    for (const spec of tail.matchAll(SPEC_IN_TAIL)) {
      const specifier = (spec[1] ?? spec[2] ?? '').trim();
      if (!specifier) continue;
      const namespace =
        kind === 'use'
          ? explicit && explicit !== '*'
            ? explicit
            : defaultNamespace(specifier)
          : undefined;
      imports.push({ specifier, kind, namespace });
    }
  }

  // CSS Modules: `composes` y `@value` nombran lo que traen, no hay que deducirlo.
  for (const match of text.matchAll(COMPOSES)) {
    const names = match[1].trim().split(/\s+/).filter((n) => n && n !== 'global');
    imports.push({ specifier: match[2], kind: 'composes', names });
  }
  for (const match of text.matchAll(VALUE_FROM)) {
    const names = match[1]
      .split(',')
      .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    imports.push({ specifier: match[2], kind: 'composes', names });
  }

  return imports;
}

/**
 * Trozos de texto que estan en posicion de selector. Con llaves es lo que va
 * antes de cada `{`; por indentacion, la linea que no es una declaracion.
 */
function selectorChunks(clean: string, indented: boolean): string[] {
  if (indented) {
    return clean
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('@') && (!line.includes(':') || /^[.#%&>]/.test(line)));
  }

  const chunks: string[] = [];
  let start = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '{') {
      chunks.push(clean.slice(start, i));
      start = i + 1;
    } else if (c === '}' || c === ';') {
      start = i + 1;
    }
  }
  return chunks.map((chunk) => chunk.trim()).filter((chunk) => chunk && !chunk.startsWith('@'));
}

const VAR_DECL = /(?:^|[\s;{(,])\$([\w-]+)\s*:/g;
const LESS_VAR_DECL = /(?:^|[\s;{])@([\w-]+)\s*:/g;
const CUSTOM_DECL = /(?:^|[\s;{])(--[\w-]+)\s*:/g;
const MIXIN_DECL = /@(?:mixin|function)\s+([\w-]+)/g;
const CLASS_IN_SELECTOR = /\.(-?[_a-zA-Z][\w-]*)/g;
const PLACEHOLDER_IN_SELECTOR = /%([\w-]+)/g;

/** Lo que la hoja le ofrece al resto: variables, mixins, clases, custom props. */
function declaredNames(clean: string, ext: string): string[] {
  const names = new Set<string>();

  for (const match of clean.matchAll(VAR_DECL)) names.add(`$${match[1]}`);
  for (const match of clean.matchAll(CUSTOM_DECL)) names.add(match[1]);
  for (const match of clean.matchAll(MIXIN_DECL)) names.add(`${match[1]}()`);
  if (ext === '.less') {
    for (const match of clean.matchAll(LESS_VAR_DECL)) {
      if (!AT_RULES.has(match[1])) names.add(`@${match[1]}`);
    }
  }

  for (const chunk of selectorChunks(clean, INDENTED.has(ext))) {
    for (const match of chunk.matchAll(CLASS_IN_SELECTOR)) names.add(`.${match[1]}`);
    for (const match of chunk.matchAll(PLACEHOLDER_IN_SELECTOR)) names.add(`%${match[1]}`);
  }

  return [...names].sort();
}

const VAR_USE = /\$([\w-]+)(?!\s*:)/g;
const CUSTOM_USE = /var\(\s*(--[\w-]+)/g;
const INCLUDE_USE = /@include\s+([\w.$-]+)/g;
const EXTEND_USE = /@extend\s+([.%][\w-]+)/g;
const LESS_VAR_USE = /@([\w-]+)(?!\s*[:(])/g;
const NS_MEMBER = /\b([A-Za-z_][\w-]*)\.(\$?[\w-]+)/g;

interface Usage {
  /** Nombre con sigilo -> veces. */
  global: Map<string, number>;
  /** Namespace -> miembro -> veces. */
  byNamespace: Map<string, Map<string, number>>;
}

/** Que nombres consume la hoja. Es la otra mitad de la arista. */
function collectUsage(clean: string, ext: string, namespaces: Set<string>): Usage {
  const global = new Map<string, number>();
  const byNamespace = new Map<string, Map<string, number>>();

  const bump = (map: Map<string, number>, name: string) => map.set(name, (map.get(name) ?? 0) + 1);

  for (const match of clean.matchAll(VAR_USE)) bump(global, `$${match[1]}`);
  for (const match of clean.matchAll(CUSTOM_USE)) bump(global, match[1]);
  for (const match of clean.matchAll(EXTEND_USE)) bump(global, match[1]);
  for (const match of clean.matchAll(INCLUDE_USE)) {
    const name = match[1].split('.').pop() ?? match[1];
    bump(global, `${name}()`);
  }
  if (ext === '.less') {
    for (const match of clean.matchAll(LESS_VAR_USE)) {
      if (!AT_RULES.has(match[1])) bump(global, `@${match[1]}`);
    }
  }

  if (namespaces.size) {
    for (const match of clean.matchAll(NS_MEMBER)) {
      if (!namespaces.has(match[1])) continue;
      let members = byNamespace.get(match[1]);
      if (!members) {
        members = new Map();
        byNamespace.set(match[1], members);
      }
      bump(members, match[2]);
    }
  }

  return { global, byNamespace };
}

/** El token que se ve en el editor, sin los parentesis del mixin ni el punto. */
function localOf(name: string): string {
  if (name.endsWith('()')) return name.slice(0, -2);
  if (name.startsWith('.')) return name.slice(1);
  return name;
}

/**
 * Sass acepta `~pkg` (webpack) y rutas sin `./`. Un especificador suelto
 * —`variables`, `src/styles/mixins`— se resuelve contra las loadPaths, que
 * viven en la config del bundler y no se leen: la convencion es que cuelgan de
 * la raiz del paquete, asi que se prueba cada directorio desde el fichero que
 * lo pide hacia arriba, que es tambien el orden de cercania correcto.
 */
function resolveStyle(resolver: Resolver, root: string, spec: string, fromFile: string): string | null {
  if (NON_FILE.test(spec)) return null;
  const clean = spec.replace(/^~/, '').replace(/[?#].*$/, '');
  if (!clean) return null;

  if (clean.startsWith('.') || path.isAbsolute(clean)) return resolver.resolve(clean, fromFile);

  const stop = path.resolve(root);
  let dir = path.dirname(fromFile);
  for (;;) {
    const hit = resolver.resolve(path.join(dir, clean), fromFile);
    if (hit) return hit;
    const parent = path.dirname(dir);
    if (dir === stop || parent === dir) break;
    dir = parent;
  }

  // Los `paths` del tsconfig, si el proyecto los comparte con los estilos.
  const alias = resolver.resolve(clean, fromFile);
  if (alias) return alias;

  // Y las carpetas de estilos de siempre, que no son ancestros del fichero.
  for (const base of [path.join(root, 'src', 'styles'), path.join(root, 'styles')]) {
    const hit = resolver.resolve(path.join(base, clean), fromFile);
    if (hit) return hit;
  }
  return null;
}

/**
 * Hojas de estilo: CSS, Sass/SCSS, Less y Stylus.
 *
 * Una hoja depende de otras (`@use`, `@forward`, `@import`, el `composes` de
 * CSS Modules) y a la vez es dependencia de los modulos que la importan —de eso
 * se encarga el analizador de JS/TS, que resuelve `./x.css` contra el proyecto
 * entero—. Los simbolos de la arista salen de cruzar lo que la hoja destino
 * ofrece (variables, mixins, clases, custom properties) con lo que la hoja
 * origen usa: `@use` no nombra lo que trae, asi que hay que deducirlo.
 */
export const stylesheetAnalyzer: LanguageAnalyzer = {
  id: 'stylesheet',
  label: 'CSS / Sass',
  extensions: STYLE_EXTS,
  ignoredDirs: ['node_modules', 'bower_components'],

  // Una hoja minificada es un artefacto de build: ni se lee ni aporta.
  skip: (file) => /\.min\.(css|less)$/i.test(file),

  parse(file: SourceFile): FileFacts {
    const ext = path.extname(file.abs).toLowerCase();
    const withStrings = stripComments(file.text, hasLineComments(ext));
    const clean = blankStrings(withStrings);

    const imports = collectImports(withStrings);
    const namespaces = new Set(imports.map((i) => i.namespace).filter((n): n is string => !!n));
    const usage = collectUsage(clean, ext, namespaces);

    let loc = 0;
    for (const line of file.text.split('\n')) if (line.trim()) loc++;

    const data: StyleData = {
      imports,
      usage: [...usage.global],
      members: [...usage.byNamespace].map(([ns, members]) => [ns, [...members]]),
    };
    return { loc, exports: declaredNames(clean, ext), externals: [], data };
  },

  link({ root, files }: LinkContext): FileLink[] {
    const resolver = new Resolver(
      root,
      [...files.values()].map((f) => f.abs),
      { extensions: STYLE_EXTS, swaps: {}, partials: true },
    );
    const relOf = new Map<string, string>();
    for (const file of files.values()) relOf.set(path.normalize(file.abs), file.rel);

    /** Destinos ya resueltos de cada fichero: la resolucion se hace una sola vez. */
    const resolved = new Map<string, { imp: StyleImport; to: string }[]>();
    const forwards = new Map<string, string[]>();

    for (const file of files.values()) {
      const data = file.facts.data as StyleData | undefined;
      if (!data) continue;
      const hits: { imp: StyleImport; to: string }[] = [];
      const externals = new Set<string>();

      for (const imp of data.imports) {
        const target = resolveStyle(resolver, root, imp.specifier, file.abs);
        const targetRel = target ? relOf.get(path.normalize(target)) : undefined;
        if (!targetRel) {
          externals.add(imp.specifier);
          continue;
        }
        if (targetRel === file.rel) continue;
        hits.push({ imp, to: targetRel });
        if (imp.kind === 'forward') {
          const list = forwards.get(file.rel);
          if (list) list.push(targetRel);
          else forwards.set(file.rel, [targetRel]);
        }
      }

      file.facts.externals = [...externals].sort();
      resolved.set(file.rel, hits);
    }

    // Un `_index.scss` que solo hace `@forward` ofrece lo de los otros. Sin
    // propagarlo, quien lo usa estaria importando un fichero que no exporta nada.
    const offered = new Map<string, Set<string>>();
    for (const file of files.values()) offered.set(file.rel, new Set(file.facts.exports));
    for (let pass = 0; pass < 10; pass++) {
      let changed = false;
      for (const [from, targets] of forwards) {
        const own = offered.get(from);
        if (!own) continue;
        for (const to of targets) {
          for (const name of offered.get(to) ?? []) {
            if (!own.has(name)) {
              own.add(name);
              changed = true;
            }
          }
        }
      }
      if (!changed) break;
    }
    for (const file of files.values()) {
      const own = offered.get(file.rel);
      if (own && own.size !== file.facts.exports.length) file.facts.exports = [...own].sort();
    }

    const links: FileLink[] = [];

    for (const file of files.values()) {
      const data = file.facts.data as StyleData | undefined;
      if (!data) continue;
      const usage = new Map(data.usage);
      const members = new Map(data.members.map(([ns, list]) => [ns, new Map(list)] as const));
      const bySource = new Map<string, Map<string, SymbolRef>>();

      for (const { imp, to } of resolved.get(file.rel) ?? []) {
        let symbols = bySource.get(to);
        if (!symbols) {
          symbols = new Map();
          bySource.set(to, symbols);
        }
        const wanted = offered.get(to) ?? new Set<string>();

        const add = (name: string, uses: number) => {
          const previous = symbols.get(name);
          if (previous) previous.uses = Math.max(previous.uses, uses);
          else symbols.set(name, { name, local: localOf(name), uses });
        };

        if (imp.names?.length) {
          // `composes`/`@value`: el nombre viene escrito, no hay que deducirlo.
          for (const raw of imp.names) add(wanted.has(`.${raw}`) ? `.${raw}` : raw, 1);
        }

        if (imp.namespace) {
          for (const [member, uses] of members.get(imp.namespace) ?? []) {
            for (const candidate of [member, `${member}()`, `.${member}`]) {
              if (wanted.has(candidate)) add(candidate, uses);
            }
          }
        }

        for (const [name, uses] of usage) {
          if (wanted.has(name)) add(name, uses);
        }

        if (symbols.size === 0) {
          // Una hoja que solo se incluye igual es una dependencia real.
          symbols.set('*side-effect*', { name: `@${imp.kind}`, local: '', uses: 0 });
        }
      }

      for (const [to, symbols] of bySource) {
        links.push({
          from: file.rel,
          to,
          symbols: [...symbols.values()].sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name)),
        });
      }
    }

    return links;
  },
};
