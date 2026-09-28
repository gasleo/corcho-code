import path from 'node:path';
import type { SymbolRef } from '../../shared/types.ts';
import type { FileFacts, FileLink, LanguageAnalyzer, LinkContext, SourceFile } from '../analysis/types.ts';
import { parseFile, type ParsedImport } from '../analyze.ts';
import { Resolver } from '../resolve.ts';

interface TsData {
  imports: ParsedImport[];
  usage: [string, number][];
}

/** Extensiones del lenguaje; el resolvedor las usa para probar candidatos. */
export const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];

/**
 * JS y TypeScript. La resolución es por ruta: cada especificador apunta a un
 * fichero concreto, así que la fase de enlace solo necesita el índice de rutas
 * para poder seguir `./foo`, `index`, `baseUrl` y los `paths` del tsconfig.
 */
export const typescriptAnalyzer: LanguageAnalyzer = {
  id: 'typescript',
  label: 'JS / TypeScript',
  extensions: SOURCE_EXTS,
  ignoredDirs: ['node_modules', '.next', '.nuxt', '.turbo'],

  skip: (file) => file.endsWith('.d.ts'),

  parse(file: SourceFile): FileFacts {
    const parsed = parseFile(file.abs, file.text);
    const data: TsData = { imports: parsed.imports, usage: [...parsed.usage] };
    return {
      loc: parsed.loc,
      exports: parsed.exports,
      externals: [],
      data,
    };
  },

  link({ root, files, allFiles }: LinkContext): FileLink[] {
    // El indice es el proyecto entero y no solo el JS/TS: asi un
    // `import './App.css'` enlaza con la hoja de estilo en vez de quedar como
    // externo. Las extensiones que se prueban a ciegas siguen siendo las suyas.
    const resolver = new Resolver(
      root,
      [...allFiles.values()].map((f) => f.abs),
    );
    const relOf = new Map<string, string>();
    for (const file of allFiles.values()) relOf.set(path.normalize(file.abs), file.rel);

    const links: FileLink[] = [];

    for (const file of files.values()) {
      const data = file.facts.data as TsData | undefined;
      if (!data) continue;
      const usage = new Map(data.usage);
      const bySource = new Map<string, Map<string, SymbolRef>>();
      const externals = new Set<string>();

      for (const imp of data.imports) {
        const target = resolver.resolve(imp.specifier, file.abs);
        const targetRel = target ? relOf.get(path.normalize(target)) : undefined;
        if (!targetRel) {
          externals.add(imp.specifier);
          continue;
        }
        if (targetRel === file.rel) continue;

        let symbols = bySource.get(targetRel);
        if (!symbols) {
          symbols = new Map();
          bySource.set(targetRel, symbols);
        }
        for (const binding of imp.bindings) {
          const previous = symbols.get(binding.local);
          const uses = usage.get(binding.local) ?? 0;
          if (previous) previous.uses = Math.max(previous.uses, uses);
          else symbols.set(binding.local, { name: binding.imported, local: binding.local, uses });
        }
        if (imp.bindings.length === 0 && !symbols.has('*side-effect*')) {
          symbols.set('*side-effect*', {
            name: imp.dynamic ? 'dynamic' : 'side-effect',
            local: '',
            uses: 0,
          });
        }
      }

      // Los externos se conocen recién acá, cuando falló la resolución.
      file.facts.externals = [...externals].sort();

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
