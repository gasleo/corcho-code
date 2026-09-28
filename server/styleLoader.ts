import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const OWN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Extensiones de hoja de estilo que este plugin atiende. */
const STYLE_FILTER = /\.(css|scss|sass|less|styl)$/;

/** `algo.module.scss` exporta un mapa de clases; `algo.scss` solo inyecta CSS. */
const isCssModule = (file: string) => /\.module\.[a-z]+$/.test(file);

interface SassApi {
  compile(file: string, options?: unknown): { css: string };
}

/**
 * El compilador de Sass del proyecto, o el nuestro como respaldo. Se prefiere el
 * del proyecto para respetar su versión y sus `@use` internos.
 */
function loadSass(root: string): SassApi | null {
  for (const from of [path.join(root, 'package.json'), path.join(OWN_ROOT, 'package.json')]) {
    try {
      const api = createRequire(from)('sass') as SassApi;
      if (typeof api.compile === 'function') return api;
    } catch {
      // seguimos con el siguiente origen
    }
  }
  return null;
}

/** Nombres de clase que declara una hoja ya compilada. */
function classNames(css: string): string[] {
  const names = new Set<string>();
  for (const match of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) names.add(match[1]);
  return [...names];
}

/**
 * Módulo JS equivalente a una hoja de estilo: inyecta el CSS en el documento y
 * exporta el mapa de clases. Se hace así, y no con el loader `css` de esbuild,
 * porque un `import styles from './x.module.scss'` necesita las dos cosas a la
 * vez — el CSS aplicado y el objeto con los nombres.
 *
 * Las clases no se renombran: el preview monta un componente solo, no hay
 * colisiones que valga la pena evitar, y el CSS resultante se lee igual que el
 * del proyecto.
 */
function styleModule(css: string, withMap: boolean): string {
  const map = withMap
    ? Object.fromEntries(classNames(css).map((name) => [name, name]))
    : {};
  return `
const css = ${JSON.stringify(css)};
if (typeof document !== 'undefined' && css) {
  const style = document.createElement('style');
  style.setAttribute('data-corcho', 'style');
  style.textContent = css;
  document.head.appendChild(style);
}
const classes = ${JSON.stringify(map)};
export default new Proxy(classes, {
  // Una clase que el preview no encontró no debe romper el render.
  get(target, prop) {
    if (typeof prop !== 'string') return undefined;
    return prop in target ? target[prop] : prop;
  },
});
export { classes };
`;
}

export interface StylePluginOptions {
  root: string;
  /** Avisa de las hojas que no se pudieron compilar, con el motivo. */
  onFailure: (file: string, reason: string) => void;
}

/**
 * Da soporte a CSS, Sass y CSS Modules en el preview. esbuild no trae Sass, así
 * que sin esto cualquier proyecto con `.scss` moría con "No loader is
 * configured for .scss files".
 */
export function stylePlugin({ root, onFailure }: StylePluginOptions): esbuild.Plugin {
  return {
    name: 'corcho-styles',
    setup(build) {
      const sass = loadSass(root);

      build.onLoad({ filter: STYLE_FILTER, namespace: 'file' }, (args) => {
        const ext = path.extname(args.path).toLowerCase();
        const withMap = isCssModule(args.path);

        try {
          if (ext === '.scss' || ext === '.sass') {
            if (!sass) {
              onFailure(args.path, 'no hay compilador de Sass disponible');
              return { contents: styleModule('', withMap), loader: 'js' };
            }
            const result = sass.compile(args.path, {
              // Los `@use "variables"` del proyecto se buscan donde los busca él.
              loadPaths: [path.dirname(args.path), path.join(root, 'src'), root, path.join(root, 'node_modules')],
              style: 'expanded',
              silenceDeprecations: ['import', 'global-builtin', 'mixed-decls', 'legacy-js-api'],
              quietDeps: true,
            });
            return { contents: styleModule(result.css, withMap), loader: 'js' };
          }

          if (ext === '.less' || ext === '.styl') {
            // Sin compilador: el componente se ve sin estos estilos, pero se ve.
            onFailure(args.path, `no se compilan ficheros ${ext}`);
            return { contents: styleModule('', withMap), loader: 'js' };
          }

          return { contents: styleModule(fs.readFileSync(args.path, 'utf8'), withMap), loader: 'js' };
        } catch (err) {
          onFailure(args.path, err instanceof Error ? err.message.split('\n')[0] : String(err));
          return { contents: styleModule('', withMap), loader: 'js' };
        }
      });
    },
  };
}
