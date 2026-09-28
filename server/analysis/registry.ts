import path from 'node:path';
import type { LanguageAnalyzer } from './types.ts';

const analyzers: LanguageAnalyzer[] = [];
const byExtension = new Map<string, LanguageAnalyzer>();

/**
 * Registro de plugins. El primero que reclama una extensión se la queda, así
 * que el orden de registro define la precedencia.
 */
export function register(analyzer: LanguageAnalyzer): void {
  if (analyzers.some((a) => a.id === analyzer.id)) return;
  analyzers.push(analyzer);
  for (const ext of analyzer.extensions) {
    if (!byExtension.has(ext)) byExtension.set(ext, analyzer);
  }
}

export function analyzerFor(file: string): LanguageAnalyzer | null {
  return byExtension.get(path.extname(file).toLowerCase()) ?? null;
}

export function allAnalyzers(): LanguageAnalyzer[] {
  return [...analyzers];
}

export function knownExtensions(): string[] {
  return [...byExtension.keys()];
}

export function extraIgnoredDirs(): string[] {
  return analyzers.flatMap((a) => a.ignoredDirs ?? []);
}

/** Un fichero cuenta si alguien reclama su extensión y no lo descarta. */
export function isAnalyzable(file: string): boolean {
  const analyzer = analyzerFor(file);
  if (!analyzer) return false;
  return !analyzer.skip?.(file);
}
