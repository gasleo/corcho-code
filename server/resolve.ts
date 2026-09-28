import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { SOURCE_EXTS } from './languages/typescript.ts';

/** Equivalencias del estilo ESM-TS: `./foo.js` en el codigo apunta a `./foo.ts` en disco. */
const JS_TO_TS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx', '.js', '.jsx'],
  '.jsx': ['.tsx', '.jsx'],
  '.mjs': ['.mts', '.mjs'],
  '.cjs': ['.cts', '.cjs'],
};

interface PathAlias {
  /** Prefijo antes del `*`, o el patron completo si no tiene comodin. */
  prefix: string;
  suffix: string;
  wildcard: boolean;
  targets: string[];
}

export interface ResolverOptions {
  /** Extensiones que se prueban cuando el especificador no trae ninguna. */
  extensions?: string[];
  /** Equivalencias de extension: `./foo.js` -> `foo.ts`. */
  swaps?: Record<string, string[]>;
  /** Nombres que hacen de indice de un directorio. */
  indexNames?: string[];
  /**
   * Parciales al estilo Sass: `@use './vars'` encuentra `_vars.scss`, y
   * `@use './tema'` encuentra `tema/_index.scss`.
   */
  partials?: boolean;
}

/**
 * Resuelve especificadores de import a ficheros concretos del arbol escaneado.
 * Solo mira el conjunto de ficheros que ya escaneamos: si un import cae fuera
 * (un paquete de node_modules, por ejemplo) se considera externo.
 *
 * Las reglas de que probar son del lenguaje que lo usa: JS/TS prueba `.ts` e
 * `index.ts`, las hojas de estilo prueban `.scss` y `_parcial.scss`. Lo que no
 * cambia —rutas relativas, `baseUrl` y los `paths` del tsconfig— vive aca.
 */
export class Resolver {
  private readonly files: Set<string>;
  private readonly root: string;
  private readonly extensions: string[];
  private readonly swaps: Record<string, string[]>;
  private readonly indexNames: string[];
  private readonly partials: boolean;
  private baseUrl: string | null = null;
  private aliases: PathAlias[] = [];

  constructor(root: string, files: string[], opts: ResolverOptions = {}) {
    this.root = root;
    this.files = new Set(files.map((f) => path.normalize(f)));
    this.extensions = opts.extensions ?? SOURCE_EXTS;
    this.swaps = opts.swaps ?? JS_TO_TS;
    this.indexNames = opts.indexNames ?? ['index'];
    this.partials = opts.partials ?? false;
    this.loadConfig();
  }

  /** Devuelve la ruta absoluta del fichero destino, o null si el import es externo. */
  resolve(spec: string, fromFile: string): string | null {
    if (!spec || spec.startsWith('\0')) return null;

    if (spec.startsWith('.')) {
      return this.tryPath(path.resolve(path.dirname(fromFile), spec));
    }
    if (path.isAbsolute(spec)) {
      return this.tryPath(spec);
    }
    for (const target of this.expandAlias(spec)) {
      const hit = this.tryPath(target);
      if (hit) return hit;
    }
    if (this.baseUrl) {
      const hit = this.tryPath(path.resolve(this.baseUrl, spec));
      if (hit) return hit;
    }
    return null;
  }

  private expandAlias(spec: string): string[] {
    const out: string[] = [];
    for (const alias of this.aliases) {
      if (alias.wildcard) {
        if (!spec.startsWith(alias.prefix) || !spec.endsWith(alias.suffix)) continue;
        const stem = spec.slice(alias.prefix.length, spec.length - alias.suffix.length);
        for (const target of alias.targets) out.push(target.replace('*', stem));
      } else if (spec === alias.prefix) {
        out.push(...alias.targets);
      }
    }
    return out;
  }

  /** `dir/nombre` y, si hay parciales, tambien `dir/_nombre`. */
  private stems(base: string): string[] {
    if (!this.partials) return [base];
    const name = path.basename(base);
    if (name.startsWith('_')) return [base];
    return [base, path.join(path.dirname(base), `_${name}`)];
  }

  /** Prueba el candidato tal cual, con extensiones, y como directorio con index. */
  private tryPath(candidate: string): string | null {
    const base = path.normalize(candidate);

    const ext = path.extname(base);
    if (ext) {
      for (const stem of this.stems(base)) {
        if (this.files.has(stem)) return stem;
      }
      const swaps = this.swaps[ext];
      if (swaps) {
        const stem = base.slice(0, -ext.length);
        for (const alt of swaps) {
          if (this.files.has(stem + alt)) return stem + alt;
        }
      }
    }

    for (const stem of this.stems(base)) {
      for (const e of this.extensions) {
        if (this.files.has(stem + e)) return stem + e;
      }
    }
    for (const index of this.indexNames) {
      for (const stem of this.stems(path.join(base, index))) {
        for (const e of this.extensions) {
          if (this.files.has(stem + e)) return stem + e;
        }
      }
    }
    return null;
  }

  /** Lee baseUrl y paths del tsconfig/jsconfig del root, si existe. */
  private loadConfig() {
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const file = path.join(this.root, name);
      if (!fs.existsSync(file)) continue;
      let options: ts.CompilerOptions;
      try {
        const parsed = ts.parseConfigFileTextToJson(file, fs.readFileSync(file, 'utf8'));
        if (parsed.error || !parsed.config) continue;
        options = (parsed.config.compilerOptions ?? {}) as ts.CompilerOptions;
      } catch {
        continue;
      }
      const configDir = path.dirname(file);
      if (typeof options.baseUrl === 'string') {
        this.baseUrl = path.resolve(configDir, options.baseUrl);
      }
      const paths = options.paths as Record<string, string[]> | undefined;
      if (paths) {
        const aliasBase = this.baseUrl ?? configDir;
        for (const [pattern, targets] of Object.entries(paths)) {
          const star = pattern.indexOf('*');
          this.aliases.push({
            prefix: star >= 0 ? pattern.slice(0, star) : pattern,
            suffix: star >= 0 ? pattern.slice(star + 1) : '',
            wildcard: star >= 0,
            targets: targets.map((t) => path.resolve(aliasBase, t)),
          });
        }
      }
      return;
    }
  }
}
