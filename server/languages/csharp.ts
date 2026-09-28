import type { SymbolRef } from '../../shared/types.ts';
import type { FileFacts, FileLink, LanguageAnalyzer, LinkContext, SourceFile } from '../analysis/types.ts';

interface CSharpData {
  namespace: string;
  /** `using` del fichero, ya sin `static` ni alias. */
  usings: string[];
  /** Tipos declarados acá: son los que este fichero le ofrece al resto. */
  declared: string[];
  /** Nombre de tipo -> veces que aparece en el cuerpo. */
  usage: [string, number][];
}

/**
 * Quita comentarios y literales reemplazándolos por espacios. Se conserva la
 * longitud para no desalinear nada, y sobre todo se evita que un `//` dentro de
 * un string o un identificador dentro de un comentario cuenten como uso.
 */
function stripNoise(src: string): string {
  const out = src.split('');
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < out.length; i++) {
      if (out[i] !== '\n') out[i] = ' ';
    }
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (c === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      blank(i, end < 0 ? src.length : end);
      i = end < 0 ? src.length : end;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    // Verbatim: @"..." donde "" es una comilla escapada.
    if (c === '@' && next === '"') {
      let j = i + 2;
      while (j < src.length) {
        if (src[j] === '"' && src[j + 1] === '"') {
          j += 2;
          continue;
        }
        if (src[j] === '"') {
          j++;
          break;
        }
        j++;
      }
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
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
        if (src[j] === '\n') break;
        j++;
      }
      blank(i, j);
      i = j;
      continue;
    }
    i++;
  }

  return out.join('');
}

const DECLARATION = /\b(?:class|interface|struct|enum|record)(?:\s+(?:class|struct))?\s+([A-Za-z_][A-Za-z0-9_]*)/g;
const USING = /^[ \t]*(?:global[ \t]+)?using[ \t]+(?:static[ \t]+)?(?:([A-Za-z_]\w*)[ \t]*=[ \t]*)?([A-Za-z_][\w.]*)[ \t]*;/gm;
const NAMESPACE = /^[ \t]*namespace[ \t]+([A-Za-z_][\w.]*)/m;
/** En C# los tipos son PascalCase por convención: es el mejor candidato. */
const TYPE_LIKE = /\b[A-Z][A-Za-z0-9_]*\b/g;

/**
 * C# / .NET.
 *
 * Acá no hay imports que apunten a un fichero: `using Foo.Bar` nombra un
 * espacio de nombres que puede estar repartido en muchos ficheros, y dos tipos
 * del mismo namespace no necesitan `using` entre ellos. Por eso la dependencia
 * se deduce al revés que en JS: primero se indexa qué tipo declara cada
 * fichero, y después se mira qué tipos usa cada uno. La arista sale de ahí.
 */
export const csharpAnalyzer: LanguageAnalyzer = {
  id: 'csharp',
  label: 'C# / .NET',
  extensions: ['.cs'],
  ignoredDirs: ['bin', 'obj', '.vs', 'packages', 'TestResults', 'Build'],

  skip: (file) => /\.(Designer|g|g\.i|AssemblyInfo)\.cs$/i.test(file),

  parse(file: SourceFile): FileFacts {
    const clean = stripNoise(file.text);

    const namespace = clean.match(NAMESPACE)?.[1] ?? '';

    const usings: string[] = [];
    for (const match of clean.matchAll(USING)) usings.push(match[2]);

    const declared: string[] = [];
    for (const match of clean.matchAll(DECLARATION)) {
      if (!declared.includes(match[1])) declared.push(match[1]);
    }

    const usage = new Map<string, number>();
    for (const match of clean.matchAll(TYPE_LIKE)) {
      usage.set(match[0], (usage.get(match[0]) ?? 0) + 1);
    }

    let loc = 0;
    for (const line of file.text.split('\n')) if (line.trim()) loc++;

    const data: CSharpData = { namespace, usings, declared, usage: [...usage] };
    return { loc, exports: declared, externals: [], data };
  },

  link({ files }: LinkContext): FileLink[] {
    /** Tipo -> ficheros que lo declaran (varios si es `partial`). */
    const declaredIn = new Map<string, string[]>();
    const namespaces = new Set<string>();

    for (const file of files.values()) {
      const data = file.facts.data as CSharpData | undefined;
      if (!data) continue;
      if (data.namespace) namespaces.add(data.namespace);
      for (const type of data.declared) {
        const list = declaredIn.get(type);
        if (list) list.push(file.rel);
        else declaredIn.set(type, [file.rel]);
      }
    }

    const isProjectNamespace = (ns: string) => {
      for (const known of namespaces) {
        if (known === ns || known.startsWith(`${ns}.`) || ns.startsWith(`${known}.`)) return true;
      }
      return false;
    };

    const links: FileLink[] = [];

    for (const file of files.values()) {
      const data = file.facts.data as CSharpData | undefined;
      if (!data) continue;

      // Un `using` que no cae en ningún namespace del proyecto es externo:
      // el framework, un NuGet, otra solución.
      file.facts.externals = [...new Set(data.usings.filter((ns) => !isProjectNamespace(ns)))].sort();

      const own = new Set(data.declared);
      const bySource = new Map<string, Map<string, SymbolRef>>();

      for (const [name, uses] of data.usage) {
        if (own.has(name)) continue;
        const declarers = declaredIn.get(name);
        if (!declarers) continue;
        for (const target of declarers) {
          if (target === file.rel) continue;
          let symbols = bySource.get(target);
          if (!symbols) {
            symbols = new Map();
            bySource.set(target, symbols);
          }
          symbols.set(name, { name, local: name, uses });
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
