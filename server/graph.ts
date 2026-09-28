import fs from 'node:fs';
import path from 'node:path';
import type { Edge, Graph, TreeNode } from '../shared/types.ts';
import { allAnalyzers, analyzerFor } from './analysis/registry.ts';
import type { AnalyzedSource } from './analysis/types.ts';
import { registerBuiltinLanguages } from './languages/index.ts';
import { scan } from './scan.ts';

registerBuiltinLanguages();

const toPosix = (p: string) => p.split(path.sep).join('/');

interface DirDraft {
  name: string;
  dirs: Map<string, DirDraft>;
  files: TreeNode[];
}

function emptyDir(name: string): DirDraft {
  return { name, dirs: new Map(), files: [] };
}

/**
 * Colapsa cadenas de directorios con un unico hijo (`src/main/java/com/foo`)
 * en un solo nodo. Sin esto el anidamiento se come todo el espacio util.
 */
function collapseChain(draft: DirDraft): DirDraft {
  while (draft.files.length === 0 && draft.dirs.size === 1) {
    const [child] = draft.dirs.values();
    draft = { name: `${draft.name}/${child.name}`, dirs: child.dirs, files: child.files };
  }
  for (const [key, child] of draft.dirs) {
    draft.dirs.set(key, collapseChain(child));
  }
  return draft;
}

function toTree(draft: DirDraft, parentId: string): TreeNode {
  // Los ids de directorio van con prefijo para no chocar nunca con los de fichero,
  // que son la ruta relativa cruda porque las aristas los referencian asi.
  const id = parentId ? `${parentId}/${draft.name}` : `dir:${draft.name}`;
  const children: TreeNode[] = [];
  for (const child of draft.dirs.values()) children.push(toTree(child, id));
  children.push(...draft.files);
  children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const weight = children.reduce((sum, c) => sum + c.weight, 0);
  return { id, name: draft.name, kind: 'dir', weight: Math.max(weight, 1), children };
}

/**
 * Analiza el arbol de `root` y devuelve el grafo listo para dibujar.
 *
 * El núcleo no sabe de lenguajes: reparte los ficheros entre los analizadores
 * registrados, les pide los hechos de cada uno (fase 1) y después las aristas
 * (fase 2). Sumar un lenguaje no toca nada de esta función.
 */
export function buildGraph(root: string): Graph {
  const started = Date.now();
  const rootAbs = path.resolve(root);
  const { files, dirs, skipped } = scan(rootAbs);

  const relOf = (abs: string) => toPosix(path.relative(rootAbs, abs));

  // --- fase 1: hechos por fichero ---
  const allSources = new Map<string, AnalyzedSource>();
  const byAnalyzer = new Map<string, Map<string, AnalyzedSource>>();
  let unreadable = 0;

  for (const abs of files) {
    const analyzer = analyzerFor(abs);
    if (!analyzer) continue;
    let text: string;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      unreadable++;
      continue;
    }
    const source: AnalyzedSource = {
      abs,
      rel: relOf(abs),
      text,
      facts: { loc: 0, exports: [], externals: [] },
    };
    try {
      source.facts = analyzer.parse(source);
    } catch {
      // Un fichero que no parsea no debe tumbar el análisis del proyecto.
      unreadable++;
      continue;
    }
    allSources.set(source.rel, source);
    let bucket = byAnalyzer.get(analyzer.id);
    if (!bucket) {
      bucket = new Map();
      byAnalyzer.set(analyzer.id, bucket);
    }
    bucket.set(source.rel, source);
  }

  // --- fase 2: aristas, con el proyecto entero ya indexado ---
  const edges: Edge[] = [];
  for (const analyzer of allAnalyzers()) {
    const bucket = byAnalyzer.get(analyzer.id);
    if (!bucket?.size) continue;
    let links;
    try {
      links = analyzer.link({ root: rootAbs, files: bucket, allFiles: allSources });
    } catch {
      continue;
    }
    for (const link of links) {
      if (link.from === link.to) continue;
      edges.push({
        from: link.from,
        to: link.to,
        symbols: link.symbols,
        uses: link.symbols.reduce((sum, s) => sum + s.uses, 0),
      });
    }
  }

  // --- arbol ---
  const rootDraft = emptyDir(path.basename(rootAbs) || rootAbs);
  let totalLoc = 0;

  for (const source of allSources.values()) {
    totalLoc += source.facts.loc;
    const node: TreeNode = {
      id: source.rel,
      name: path.basename(source.abs),
      kind: 'file',
      weight: Math.max(source.facts.loc, 1),
      file: {
        exports: source.facts.exports,
        externals: source.facts.externals,
        loc: source.facts.loc,
        lang: analyzerFor(source.abs)?.id ?? 'unknown',
      },
    };

    const segments = source.rel.split('/');
    let cursor = rootDraft;
    for (const segment of segments.slice(0, -1)) {
      let next = cursor.dirs.get(segment);
      if (!next) {
        next = emptyDir(segment);
        cursor.dirs.set(segment, next);
      }
      cursor = next;
    }
    cursor.files.push(node);
  }

  const tree = toTree(collapseChain(rootDraft), '');

  return {
    root: rootAbs,
    tree,
    edges,
    stats: {
      files: allSources.size,
      dirs: dirs.length,
      edges: edges.length,
      loc: totalLoc,
      skipped: skipped + unreadable,
      ms: Date.now() - started,
      languages: [...byAnalyzer.entries()]
        .map(([id, bucket]) => ({
          id,
          label: allAnalyzers().find((a) => a.id === id)?.label ?? id,
          files: bucket.size,
        }))
        .sort((a, b) => b.files - a.files),
    },
  };
}
