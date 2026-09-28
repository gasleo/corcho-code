import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

export interface ProjectStyles {
  css: string;
  /** Hojas de estilo que se aplicaron, en rutas relativas al proyecto. */
  files: string[];
  /** Con qué se compiló: importa para explicar por qué falta algo. */
  engine: 'tailwind4' | 'postcss' | 'css' | 'none';
  /** Hojas externas del index.html (fuentes, iconos) que se enlazan tal cual. */
  links: string[];
  error?: string;
}

const CSS_ENTRY_FALLBACKS = [
  'src/index.css',
  'src/main.css',
  'src/styles.css',
  'src/App.css',
  'src/app.css',
];

const ENTRY_FALLBACKS = [
  'src/main.tsx',
  'src/main.jsx',
  'src/main.ts',
  'src/main.js',
  'src/index.tsx',
  'src/index.jsx',
];

/** Resuelve un paquete desde el proyecto, aguantando el layout de pnpm. */
function resolveFrom(fromFile: string, id: string): string | null {
  try {
    return createRequire(fromFile).resolve(id);
  } catch {
    return null;
  }
}

function resolveDeep(root: string, id: string, through: string[]): string | null {
  const anchor = path.join(root, 'package.json');
  const direct = resolveFrom(anchor, id);
  if (direct) return direct;
  // pnpm no expone las dependencias transitivas: se entra por quien las usa.
  for (const pkg of through) {
    const host = resolveFrom(anchor, pkg);
    if (host) {
      const nested = resolveFrom(host, id);
      if (nested) return nested;
    }
  }
  return null;
}

/** El módulo de entrada de la app, que es donde se importa el CSS global. */
function entryModule(root: string): string | null {
  const html = path.join(root, 'index.html');
  if (fs.existsSync(html)) {
    const match = fs.readFileSync(html, 'utf8').match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/);
    if (match) {
      const abs = path.join(root, match[1].replace(/^\//, ''));
      if (fs.existsSync(abs)) return abs;
    }
  }
  for (const candidate of ENTRY_FALLBACKS) {
    const abs = path.join(root, candidate);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

/** Hojas externas (Google Fonts, Material Icons) declaradas en el index.html. */
function externalLinks(root: string): string[] {
  const html = path.join(root, 'index.html');
  if (!fs.existsSync(html)) return [];
  const text = fs.readFileSync(html, 'utf8');
  const links: string[] = [];
  for (const match of text.matchAll(/<link[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>/g)) {
    if (/stylesheet/.test(match[0])) links.push(match[1]);
  }
  return links;
}

function globalCssFiles(root: string): string[] {
  const found: string[] = [];
  const entry = entryModule(root);
  if (entry) {
    const text = fs.readFileSync(entry, 'utf8');
    for (const match of text.matchAll(/import\s+["']([^"']+\.css)["']/g)) {
      const spec = match[1];
      const abs = spec.startsWith('.')
        ? path.resolve(path.dirname(entry), spec)
        : resolveFrom(path.join(root, 'package.json'), spec);
      if (abs && fs.existsSync(abs)) found.push(abs);
    }
  }
  if (!found.length) {
    for (const candidate of CSS_ENTRY_FALLBACKS) {
      const abs = path.join(root, candidate);
      if (fs.existsSync(abs)) found.push(abs);
    }
  }
  return found;
}

const looksTailwind = (css: string) =>
  /@import\s+["']tailwindcss/.test(css) || /@tailwind\s/.test(css) || /@theme\b/.test(css);

/**
 * Compila con el Tailwind v4 del propio proyecto. Sin esto las clases
 * utilitarias no existen en ningún lado y el componente sale sin estilos.
 */
async function compileTailwind4(root: string, cssFile: string, source: string): Promise<string | null> {
  const nodeApi = resolveDeep(root, '@tailwindcss/node', ['@tailwindcss/vite', '@tailwindcss/postcss']);
  const oxide = resolveDeep(root, '@tailwindcss/oxide', ['@tailwindcss/vite', '@tailwindcss/postcss']);
  if (!nodeApi || !oxide) return null;

  const { compile } = await import(pathToFileURL(nodeApi).href);
  const { Scanner } = await import(pathToFileURL(oxide).href);

  const compiler = await compile(source, {
    base: path.dirname(cssFile),
    onDependency() {},
  });

  // Si la hoja no declara @source, se escanea el código del proyecto: es lo
  // que hace el plugin de Vite con los módulos que va transformando.
  const sources =
    compiler.sources?.length > 0
      ? compiler.sources
      : [{ base: fs.existsSync(path.join(root, 'src')) ? path.join(root, 'src') : root, pattern: '**/*', negated: false }];

  const candidates: string[] = new Scanner({ sources }).scan();
  return compiler.build(candidates);
}

/** Tailwind v3 y compañía: se pasa por el postcss del proyecto. */
async function compilePostcss(root: string, cssFile: string, source: string): Promise<string | null> {
  const hasConfig = ['postcss.config.js', 'postcss.config.cjs', 'postcss.config.mjs', 'tailwind.config.js']
    .some((name) => fs.existsSync(path.join(root, name)));
  if (!hasConfig) return null;

  const postcssPath = resolveDeep(root, 'postcss', ['vite']);
  const tailwindPath = resolveDeep(root, 'tailwindcss', ['@tailwindcss/postcss']);
  if (!postcssPath || !tailwindPath) return null;

  const postcss = (await import(pathToFileURL(postcssPath).href)).default;
  const tailwind = (await import(pathToFileURL(tailwindPath).href)).default;
  const result = await postcss([tailwind]).process(source, { from: cssFile });
  return result.css;
}

/** Último recurso: empaquetar el CSS tal cual, resolviendo @import y url(). */
async function bundleCss(root: string, cssFile: string): Promise<string> {
  const result = await esbuild.build({
    entryPoints: [cssFile],
    bundle: true,
    write: false,
    absWorkingDir: root,
    logLevel: 'silent',
    loader: {
      '.png': 'dataurl',
      '.jpg': 'dataurl',
      '.gif': 'dataurl',
      '.svg': 'dataurl',
      '.woff': 'dataurl',
      '.woff2': 'dataurl',
      '.ttf': 'dataurl',
    },
  });
  return result.outputFiles?.map((f) => f.text).join('\n') ?? '';
}

interface CacheEntry {
  key: string;
  value: ProjectStyles;
}
const cache = new Map<string, CacheEntry>();

const mtimeKey = (files: string[]) =>
  files
    .map((f) => {
      try {
        return `${f}:${fs.statSync(f).mtimeMs}`;
      } catch {
        return f;
      }
    })
    .join('|');

/**
 * Estilos globales del proyecto, compilados como los compila el proyecto.
 * Es lo que hace que un componente con clases de Tailwind se vea de verdad.
 */
export async function projectStyles(root: string): Promise<ProjectStyles> {
  const files = globalCssFiles(root);
  const links = externalLinks(root);
  if (!files.length) return { css: '', files: [], engine: 'none', links };

  const key = mtimeKey(files);
  const hit = cache.get(root);
  if (hit && hit.key === key) return hit.value;

  let css = '';
  let engine: ProjectStyles['engine'] = 'css';
  let error: string | undefined;

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    try {
      if (looksTailwind(source)) {
        const built = (await compileTailwind4(root, file, source)) ?? (await compilePostcss(root, file, source));
        if (built) {
          css += `\n${built}`;
          engine = 'tailwind4';
          continue;
        }
      }
      css += `\n${await bundleCss(root, file)}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      // Una hoja que falla no debe tirar abajo al resto.
      try {
        css += `\n${source}`;
      } catch {
        // nada que agregar
      }
    }
  }

  const value: ProjectStyles = {
    css,
    files: files.map((f) => path.relative(root, f).split(path.sep).join('/')),
    engine,
    links,
    error,
  };
  cache.set(root, { key, value });
  return value;
}
