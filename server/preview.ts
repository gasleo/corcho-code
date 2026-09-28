import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { stylePlugin } from './styleLoader.ts';

const localRequire = createRequire(import.meta.url);
/** Raíz de Corcho: de acá sale el runtime que prestamos al proyecto. */
const OWN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWN_MODULES = path.join(OWN_ROOT, 'node_modules');

/** Resuelve un paquete desde el proyecto abierto. */
function resolveFrom(root: string, id: string): string | null {
  try {
    return createRequire(path.join(root, 'package.json')).resolve(id);
  } catch {
    return null;
  }
}

/** Resuelve un paquete desde Corcho: el runtime que ponemos nosotros. */
function ownPackage(id: string): string | null {
  try {
    return localRequire.resolve(id);
  } catch {
    return null;
  }
}

/** Error de preparación: no es un fallo de compilación, es que no se puede. */
export class PreviewUnsupported extends Error {}

/** Contextos que el preview provee por su cuenta, sin que el proyecto haga nada. */
interface AppShell {
  router: boolean;
}

export interface PreviewBundle {
  js: string;
  css: string;
  /** Envoltorios automaticos que se aplicaron (MemoryRouter, etc.). */
  shell?: string[];
  /** Módulos que se reemplazaron por un sustituto para poder renderizar. */
  stubs: string[];
  /** Se recurrió a aislar todas las dependencias externas. */
  isolated: boolean;
  /** Hojas de estilo que no se pudieron compilar, con su motivo. */
  styleWarnings?: string[];
  /** Por qué falló el intento fiel, cuando hubo que aislar. */
  isolatedReason?: string;
}

/** Los assets no deben romper el build: se meten inline o se ignoran. */
const LOADERS: Record<string, esbuild.Loader> = {
  // Muchos proyectos meten JSX en ficheros .js; esbuild no lo asume solo.
  '.js': 'jsx',
  // Audio y vídeo no aportan nada al preview y romperían el build.
  '.wav': 'empty',
  '.mp3': 'empty',
  '.mp4': 'empty',
  '.png': 'dataurl',
  '.jpg': 'dataurl',
  '.jpeg': 'dataurl',
  '.gif': 'dataurl',
  '.webp': 'dataurl',
  '.svg': 'dataurl',
  '.woff': 'dataurl',
  '.woff2': 'dataurl',
  '.ttf': 'dataurl',
  '.otf': 'dataurl',
};

/**
 * Paquetes que sabemos que no compilan ni corren en un navegador: envoltorios
 * de módulos nativos, SDKs de plataforma y librerías publicadas con sintaxis
 * Flow sin transpilar.
 */
const NATIVE_PATTERNS = [
  /^react-native-/,
  /^@react-native(-community)?\//,
  /^@react-native-firebase\//,
  /^rn-/,
  /^@notifee\//,
  /^@cometchat\//,
  /^@bam\.tech\//,
  /^@gorhom\//,
  /^@shopify\/react-native/,
  // Navegación e i18n dependen del armazón de la app: sin su provider revientan.
  new RegExp("^@react-navigation/"),
  new RegExp("^react-i18next$"),
  new RegExp("^i18next"),
  /native-?modules?$/,
];

const isNativePackage = (spec: string) => NATIVE_PATTERNS.some((re) => re.test(spec));
const isBare = (spec: string) => !spec.startsWith('.') && !path.isAbsolute(spec);

/**
 * El runtime que hace de React Native en el navegador: el nuestro o el que
 * traiga el proyecto. Lo que pida desde adentro se resuelve normal —
 * `@react-native/normalize-colors` es una dependencia suya, no un módulo
 * nativo, y sustituirla deja al preview sin poder interpretar un color.
 */
function isRuntimeImporter(importer: string): boolean {
  if (importer.startsWith(OWN_MODULES)) return true;
  const posix = importer.split(path.sep).join('/');
  return posix.includes('/node_modules/react-native-web/');
}

/**
 * Sustituye módulos que no se pueden cargar por un doble permisivo: cualquier
 * componente que exporten se dibuja como una caja con su nombre, cualquier hook
 * devuelve un objeto que responde a todo, y cualquier función es un no-op.
 *
 * Es lo que hace posible previsualizar una pantalla de React Native: el JSX, los
 * estilos y los textos son los de verdad; lo nativo queda marcado como hueco.
 */
function stubPlugin(options: {
  root: string;
  isolate: boolean;
  keep: Set<string>;
  onStub: (spec: string) => void;
}): esbuild.Plugin {
  const { root, isolate, keep, onStub } = options;
  const EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs'];

  /**
   * Muchos proyectos (sobre todo React Native) usan alias de babel con raíz en
   * `src`, que esbuild no conoce: `components/ui/Button` es un fichero del
   * proyecto, no un paquete. Antes de sustituirlo, se busca ahí.
   */
  const asProjectModule = (spec: string): string | null => {
    for (const base of [path.join(root, 'src'), root]) {
      const candidate = path.join(base, spec);
      for (const ext of ['', ...EXTS]) {
        const file = candidate + ext;
        if (ext && fs.existsSync(file) && fs.statSync(file).isFile()) return file;
      }
      for (const ext of EXTS) {
        const index = path.join(candidate, 'index' + ext);
        if (fs.existsSync(index)) return index;
      }
    }
    return null;
  };
  return {
    name: 'corcho-stubs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        if (args.kind === 'entry-point') return null;
        if (args.namespace === 'corcho-stub') return null;
        // build.resolve() vuelve a pasar por este mismo hook: sin la marca, la
        // resolución se llama a sí misma para siempre.
        if ((args.pluginData as { ccResolved?: boolean } | undefined)?.ccResolved) return null;
        const spec = args.path;
        if (keep.has(spec) || [...keep].some((k) => spec.startsWith(`${k}/`))) return null;

        // Lo que venga del runtime se resuelve normal: aislar las dependencias
        // del proyecto no debe descuartizar react-native-web.
        if (isRuntimeImporter(args.importer)) return null;

        const bare = isBare(spec);
        if (bare && !isNativePackage(spec)) {
          const own = asProjectModule(spec);
          if (own) return { path: own };
        }
        if (bare && (isNativePackage(spec) || isolate)) {
          onStub(spec);
          return { path: spec, namespace: 'corcho-stub' };
        }

        // Lo que el bundler no logra resolver (alias de babel, assets que no
        // están) también se sustituye en vez de tumbar el build.
        const resolved = await build.resolve(spec, {
          kind: args.kind,
          importer: args.importer,
          resolveDir: args.resolveDir,
          pluginData: { ccResolved: true },
        });
        if (resolved.errors.length) {
          onStub(spec);
          return { path: spec, namespace: 'corcho-stub' };
        }
        // Hay paquetes que apuntan a ficheros que solo existen en Node (el
        // clásico `./util.inspect`): resuelven, pero no se pueden leer.
        if (resolved.path && !resolved.namespace && !fs.existsSync(resolved.path)) {
          onStub(spec);
          return { path: spec, namespace: 'corcho-stub' };
        }
        return resolved;
      });

      build.onLoad({ filter: /.*/, namespace: 'corcho-stub' }, (args) => ({
        contents: stubSource(args.path),
        loader: 'js',
        resolveDir: options.root,
      }));

      // Red de seguridad: un fichero que se resolvió pero no se puede leer
      // (paquetes que apuntan a builtins de Node, como object-inspect con su
      // './util.inspect') tumbaría el build entero. Se sustituye y sigue.
      build.onLoad({ filter: /.*/, namespace: 'file' }, async (args) => {
        try {
          await fs.promises.access(args.path);
          return null;
        } catch {
          onStub(path.basename(args.path));
          return { contents: stubSource(path.basename(args.path)), loader: 'js' };
        }
      });
    },
  };
}

/** El módulo sustituto. Es CJS para que cualquier import con nombre funcione. */
function stubSource(name: string): string {
  return `
const React = require('react');
const MODULE = ${JSON.stringify(name)};

// Valor comodín: se puede llamar, recorrer y leer sin romper nada.
function permissive() {
  const target = function () {};
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive || prop === 'toString') return () => '';
      if (prop === Symbol.iterator) return function* () {};
      if (prop === 'then') return undefined;
      if (prop === 'length') return 0;
      if (prop === 'map' || prop === 'filter' || prop === 'forEach' || prop === 'slice') return () => [];
      return permissive();
    },
    apply(_t, _this, args) {
      // Devolver el primer argumento de texto hace que t('clave') pinte la
      // clave, en vez de un valor que React no sabe renderizar.
      const first = args && args[0];
      if (typeof first === 'string' || typeof first === 'number') return first;
      return permissive();
    },
  });
}

function placeholder(label) {
  const Component = React.forwardRef(function Stub(props, ref) {
    const children = props && props.children;
    return React.createElement(
      'div',
      {
        ref: ref,
        'data-stub': label,
        style: {
          border: '1px dashed #b3b3b3',
          borderRadius: 4,
          padding: children ? 6 : '4px 8px',
          margin: 2,
          font: '11px ui-monospace, monospace',
          color: '#8a8a8a',
          display: 'inline-block',
        },
      },
      children ? [React.createElement('span', { key: 'l', style: { opacity: 0.7 } }, label), children] : label,
    );
  });
  Component.displayName = label;
  return Component;
}

const cache = new Map();
function valueFor(prop) {
  if (typeof prop !== 'string') return permissive();
  if (prop === '__esModule') return true;
  if (cache.has(prop)) return cache.get(prop);
  let value;
  if (/^[A-Z]/.test(prop)) value = placeholder(MODULE + '.' + prop);
  else if (/^use[A-Z]/.test(prop)) value = () => permissive();
  else value = permissive();
  cache.set(prop, value);
  return value;
}

// esbuild copia las claves propias del módulo al hacer la interoperabilidad,
// y un Proxy sobre un objeto vacío no tiene ninguna: los imports con nombre
// llegaban como undefined. Con el catch-all en el prototipo, la copia se
// queda con el objeto pero cualquier lectura desconocida cae igual acá.
const catchAll = new Proxy(Object.create(null), {
  get(_target, prop) {
    return valueFor(prop);
  },
});

const stub = Object.create(catchAll);
stub.__esModule = true;
stub.default = placeholder(MODULE);
module.exports = stub;
`;
}

/** Envuelve el render para que un fallo se vea explicado y no en blanco. */
/**
 * `corcho.preview.tsx` en la raíz: ahí el proyecto pone sus proveedores. El
 * nombre viejo, `code-canvas.preview.tsx`, se sigue aceptando por si alguien lo
 * creó antes del renombre; si están los dos, manda el nuevo.
 */
function decoratorFile(root: string): string | null {
  const names = [
    'corcho.preview.tsx',
    'corcho.preview.jsx',
    'corcho.preview.ts',
    'corcho.preview.js',
    'code-canvas.preview.tsx',
    'code-canvas.preview.jsx',
    'code-canvas.preview.ts',
    'code-canvas.preview.js',
  ];
  for (const name of names) {
    const file = path.join(root, name);
    if (fs.existsSync(file)) return file.split(path.sep).join('/');
  }
  return null;
}

function entrySource(
  importPath: string,
  exportName: string,
  decorator: string | null,
  shell: AppShell,
): string {
  return `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import * as mod from ${JSON.stringify(importPath)};
${shell.router ? "import { MemoryRouter } from 'react-router-dom';" : ''}
${decorator ? `import * as decoration from ${JSON.stringify(decorator)};` : 'const decoration = {};'}
const Providers = decoration.Providers ?? decoration.default ?? ((props) => props.children);

// Armazon minimo de la app: un componente que usa useLocation, Link o
// useNavigate revienta si no hay Router arriba, y eso no dice nada del
// componente, es contexto que en la app real pone el arranque.
const withShell = (node) =>
  ${shell.router ? 'React.createElement(MemoryRouter, { initialEntries: ["/"] }, node)' : 'node'};

const Component = mod[${JSON.stringify(exportName)}] ?? mod.default;
const BR = String.fromCharCode(10);
const HAS_DECORATOR = ${decorator ? 'true' : 'false'};
const root = createRoot(document.getElementById('preview-root'));

class Boundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error: error };
  }
  render() {
    if (this.state.error) {
      return React.createElement(
        'pre',
        { style: { font: '12px ui-monospace, monospace', color: '#b3261e', whiteSpace: 'pre-wrap' } },
        'El componente falló al renderizar:' + BR + BR +
          String(this.state.error && this.state.error.message) +
          (HAS_DECORATOR
            ? ''
            : BR + BR +
              'Suele pasar cuando el componente necesita el contexto de la app' + BR +
              '(store, i18n, tema). Creá corcho.preview.tsx en la raíz del' + BR +
              'proyecto exportando Providers, y el preview lo usa para envolverlo:' + BR + BR +
              'export function Providers({ children }) {' + BR +
              '  return <StoreProvider>{children}</StoreProvider>;' + BR +
              '}'),
      );
    }
    return this.props.children;
  }
}

window.__render = (props) => {
  if (!Component) {
    root.render(React.createElement('pre', null, 'No se encontró el export ${exportName}'));
    return;
  }
  root.render(
    React.createElement(
      Boundary,
      { key: JSON.stringify(props || {}) },
      withShell(React.createElement(Providers, null, React.createElement(Component, props))),
    ),
  );
};
`;
}

/**
 * Empaqueta el componente para el navegador.
 *
 * Para React Native el runtime lo pone Corcho: se redirige `react-native`
 * a su propio `react-native-web` y `react`/`react-dom` a una única copia, para
 * no terminar con dos Reacts y los hooks rotos. Si aun así el build falla, se
 * reintenta aislando **todas** las dependencias externas: se pierde lo que
 * aporten las librerías, pero el JSX y los estilos del componente siguen
 * siendo los de verdad.
 */
export async function bundleComponent(
  root: string,
  absFile: string,
  exportName: string,
): Promise<PreviewBundle> {
  const importPath = absFile.split(path.sep).join('/');
  const shell: AppShell = { router: !!resolveFrom(root, 'react-router-dom') };
  const entry = entrySource(importPath, exportName, decoratorFile(root), shell);
  const shellNames = shell.router ? ['MemoryRouter'] : [];

  const isNative = !!resolveFrom(root, 'react-native');
  const ownReact = ownPackage('react');
  const ownReactDom = ownPackage('react-dom');
  const rnw = resolveFrom(root, 'react-native-web') ?? ownPackage('react-native-web');

  if (!isNative && !resolveFrom(root, 'react-dom') && !ownReactDom) {
    throw new PreviewUnsupported('No se encontró react-dom para montar el componente.');
  }
  if (isNative && !rnw) {
    throw new PreviewUnsupported('Este proyecto es React Native y no hay react-native-web disponible.');
  }

  const alias: Record<string, string> = {};
  // Si el proyecto no trae React (o es nativo), se le presta el nuestro.
  if (!resolveFrom(root, 'react') && ownReact) alias.react = path.dirname(ownReact);
  if (!resolveFrom(root, 'react-dom') && ownReactDom) alias['react-dom'] = path.dirname(ownReactDom);
  if (isNative) {
    // Una sola copia de React manda: la del proyecto y la de react-native-web
    // tienen que ser la misma o los hooks explotan.
    if (ownReact) alias.react = path.dirname(ownReact);
    if (ownReactDom) alias['react-dom'] = path.dirname(ownReactDom);
    alias['react-native'] = path.dirname(rnw!);
  }

  const keep = new Set(['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', 'react-native', 'react-native-web']);

  const attempt = async (isolate: boolean) => {
    const stubs = new Set<string>();
    const styleWarnings = new Set<string>();
    const result = await esbuild.build({
      stdin: {
        contents: entry,
        resolveDir: path.dirname(absFile),
        sourcefile: 'corcho-preview.tsx',
        loader: 'tsx',
      },
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      target: 'es2020',
      jsx: 'automatic',
      absWorkingDir: root,
      logLevel: 'silent',
      alias: Object.keys(alias).length ? alias : undefined,
      tsconfig: fs.existsSync(path.join(root, 'tsconfig.json'))
        ? path.join(root, 'tsconfig.json')
        : undefined,
      define: { 'process.env.NODE_ENV': '"development"', global: 'window', __DEV__: 'true' },
      loader: LOADERS,
      plugins: [
        // El de estilos va primero: reclama .scss/.css antes que la red de
        // seguridad genérica del otro.
        stylePlugin({
          root,
          onFailure: (file, reason) => styleWarnings.add(`${path.relative(root, file)} — ${reason}`),
        }),
        stubPlugin({ root, isolate, keep, onStub: (s) => stubs.add(s) }),
      ],
    });

    let js = '';
    let css = '';
    for (const file of result.outputFiles ?? []) {
      if (file.path.endsWith('.css')) css += file.text;
      else js += file.text;
    }
    return {
      js,
      css,
      stubs: [...stubs].sort(),
      isolated: isolate,
      styleWarnings: [...styleWarnings].sort(),
      shell: shellNames,
    };
  };

  try {
    return await attempt(false);
  } catch (err) {
    if (!isNative) throw err;
    // Segunda pasada: fuera todo lo externo. Es la diferencia entre ver la
    // pantalla con huecos marcados y no ver nada.
    const reason = formatBuildError(err).split(String.fromCharCode(10)).slice(0, 4).join(String.fromCharCode(10));
    const bundle = await attempt(true);
    return { ...bundle, isolatedReason: reason };
  }
}

/** Mensaje de error de esbuild en texto plano, listo para mostrar. */
export function formatBuildError(err: unknown): string {
  const build = err as { errors?: esbuild.Message[] };
  if (build?.errors?.length) {
    return build.errors
      .map((e) => {
        const where = e.location ? `${e.location.file}:${e.location.line}:${e.location.column}` : '';
        return [where, e.text].filter(Boolean).join(' — ');
      })
      .join('\n');
  }
  return err instanceof Error ? err.message : String(err);
}
