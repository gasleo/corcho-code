import fs from 'node:fs';
import path from 'node:path';
import { extraIgnoredDirs, isAnalyzable } from './analysis/registry.ts';

/** Directorios que no aportan en ningún lenguaje. */
const IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'coverage',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  'vendor',
  'target',
  '.idea',
  '.vscode',
]);

export interface ScanResult {
  /** Rutas absolutas de los ficheros que algún analizador reclama. */
  files: string[];
  /** Rutas absolutas de todos los directorios visitados (incluye el root). */
  dirs: string[];
  /** Ficheros que quedaron fuera por el limite o por ser demasiado grandes. */
  skipped: number;
}

export interface ScanOptions {
  maxFiles?: number;
  /** Ficheros mas grandes que esto se cuentan como skipped: parsearlos no aporta. */
  maxFileBytes?: number;
}

/** Recorre el arbol a partir de `root` y devuelve los ficheros analizables. */
export function scan(root: string, opts: ScanOptions = {}): ScanResult {
  const maxFiles = opts.maxFiles ?? 6000;
  const maxFileBytes = opts.maxFileBytes ?? 1_500_000;
  // Cada lenguaje suma los directorios que a él no le sirven (node_modules,
  // bin, obj…): el núcleo no tiene por qué conocerlos.
  const ignored = new Set([...IGNORED_DIRS, ...extraIgnoredDirs()]);

  const files: string[] = [];
  const dirs: string[] = [];
  let skipped = 0;

  const walk = (dir: string) => {
    dirs.push(dir);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        // 'dist-ui', 'dist-server'...: variantes de carpeta de build.
        if (ignored.has(entry.name) || entry.name.startsWith('dist-')) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isAnalyzable(full)) continue;
      if (files.length >= maxFiles) {
        skipped++;
        continue;
      }
      try {
        if (fs.statSync(full).size > maxFileBytes) {
          skipped++;
          continue;
        }
      } catch {
        skipped++;
        continue;
      }
      files.push(full);
    }
  };

  walk(root);
  return { files, dirs, skipped };
}
