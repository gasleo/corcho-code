import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentInfo, PropInfo } from '../shared/types';
import { fetchComponents, fetchPreview } from './api';

const NEWLINE = String.fromCharCode(10);

interface Bundle {
  js: string;
  css: string;
  error?: string;
  unsupported?: boolean;
  /** Módulos reemplazados por un sustituto para poder renderizar. */
  stubs?: string[];
  /** Hojas de estilo que no se pudieron compilar. */
  styleWarnings?: string[];
  /** Envoltorios que el preview puso por su cuenta. */
  shell?: string[];
  isolated?: boolean;
  isolatedReason?: string;
  styles?: ProjectStyles;
}

interface ProjectStyles {
  css: string;
  files: string[];
  engine: 'tailwind4' | 'postcss' | 'css' | 'none';
  links: string[];
  error?: string;
}

interface Props {
  /** Ruta relativa del fichero dentro del proyecto. */
  file: string;
}

type Values = Record<string, unknown>;

/** Qué control conviene para cada prop, mirando el texto del tipo. */
function controlOf(prop: PropInfo): 'select' | 'boolean' | 'number' | 'text' | 'json' | 'skip' {
  if (prop.options?.length) return 'select';
  const type = prop.type.replace(/\s/g, '');
  if (/^boolean$/.test(type)) return 'boolean';
  if (/^number$/.test(type)) return 'number';
  if (/^string$/.test(type)) return 'text';
  if (/^React\.ReactNode$|^ReactNode$|^React\.ReactElement$/.test(type)) return 'text';
  if (/=>/.test(type) || /^Function$/.test(type)) return 'skip';
  return 'json';
}

/** Valor inicial: el default escrito en el código, si se puede interpretar. */
function initialValue(prop: PropInfo): unknown {
  if (prop.default) {
    try {
      return JSON.parse(prop.default);
    } catch {
      return prop.default.replace(/^['"`]|['"`]$/g, '');
    }
  }
  switch (controlOf(prop)) {
    case 'boolean':
      return false;
    case 'number':
      return 0;
    case 'select':
      return prop.options?.[0] ?? '';
    case 'text':
      return prop.optional ? '' : prop.name;
    default:
      return undefined;
  }
}

/** Hay texto pero todavía no es JSON válido: se marca sin estorbar. */
function draftInvalid(raw: string | undefined): boolean {
  if (!raw || !raw.trim()) return false;
  try {
    JSON.parse(raw);
    return false;
  } catch {
    return true;
  }
}

export function PreviewPane({ file }: Props) {
  const [components, setComponents] = useState<ComponentInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [values, setValues] = useState<Values>({});
  /**
   * Texto crudo de los campos JSON. Sin esto el input se re-serializaba en cada
   * tecla (`abc` -> `"abc"` -> `"\"abc\""`) y borrar terminaba agregando
   * comillas y barras en vez de sacar caracteres.
   */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [dark, setDark] = useState(false);
  const [styles, setStyles] = useState<ProjectStyles | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  /** Los estilos globales se pueden apagar para ver el componente pelado. */
  const [useStyles, setUseStyles] = useState(true);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    setComponents(null);
    setError(null);
    fetchComponents(file)
      .then((raw) => {
        const data = raw as { components?: ComponentInfo[] };
        if (!alive) return;
        const list = (data.components ?? []) as ComponentInfo[];
        setComponents(list);
        setSelected(list[0]?.name ?? null);
      })
      .catch((err) => alive && setError(String(err)));
    return () => {
      alive = false;
    };
  }, [file]);

  const current = useMemo(
    () => components?.find((c) => c.name === selected) ?? null,
    [components, selected],
  );

  // Al cambiar de componente se rearman los valores desde sus defaults.
  useEffect(() => {
    if (!current) return;
    const next: Values = {};
    const nextDrafts: Record<string, string> = {};
    for (const prop of current.props) {
      const value = initialValue(prop);
      if (value !== undefined) next[prop.name] = value;
      if (controlOf(prop) === 'json') {
        nextDrafts[prop.name] = value === undefined ? '' : JSON.stringify(value);
      }
    }
    setValues(next);
    setDrafts(nextDrafts);
  }, [current]);

  const build = useCallback(async () => {
    if (!selected) return;
    setBuilding(true);
    setError(null);
    try {
      const data = (await fetchPreview(file, selected)) as Bundle;
      setStyles(data.styles ?? null);
      setBundle(data);
      if (data.error) {
        setError(data.error);
        return;
      }
      // La página va como Blob: así el bundle no tiene que escapar nada.
      const page = new Blob(
        [
          `<!doctype html><html><head><meta charset="utf-8">`,
          // Fuentes e iconos que la app carga en su index.html.
          useStyles ? (data.styles?.links ?? []).map((href) => `<link rel="stylesheet" href="${href}">`).join('') : '',
          `<style>html,body{margin:0;padding:16px}</style><style>`,
          useStyles ? data.styles?.css ?? '' : '',
          `</style><style>`,
          data.css,
          `</style></head><body><div id="preview-root"></div><script>`,
          data.js,
          `</script><script>
            window.addEventListener('message', (e) => {
              if (e.data && e.data.type === 'props') { try { window.__render(e.data.props); } catch (err) { document.body.innerHTML = '<pre>' + err + '</pre>'; } }
              if (e.data && e.data.type === 'bg') { document.body.style.background = e.data.value; document.body.style.color = e.data.fg; }
            });
            window.parent.postMessage({ type: 'ready' }, '*');
          </script></body></html>`,
        ],
        { type: 'text/html' },
      );
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(page);
      if (frameRef.current) frameRef.current.src = urlRef.current;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBuilding(false);
    }
  }, [file, selected, useStyles]);

  useEffect(() => {
    void build();
  }, [build]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const push = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({ type: 'props', props: values }, '*');
    frameRef.current?.contentWindow?.postMessage(
      { type: 'bg', value: dark ? '#14161c' : '#ffffff', fg: dark ? '#e9e7de' : '#14161a' },
      '*',
    );
  }, [values, dark]);

  // El iframe avisa cuando el bundle terminó de montar.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'ready') push();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [push]);

  useEffect(() => {
    push();
  }, [push]);

  const setValue = (name: string, value: unknown) => setValues((prev) => ({ ...prev, [name]: value }));

  if (components && components.length === 0) {
    return <div className="pv-empty">No se detectaron componentes exportados en este fichero.</div>;
  }

  return (
    <div className="preview">
      <div className="pv-bar">
        <select value={selected ?? ''} onChange={(e) => setSelected(e.target.value)}>
          {(components ?? []).map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
              {c.isDefault ? ' (default)' : ''}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => void build()} disabled={building}>
          {building ? 'compilando…' : 'recompilar'}
        </button>
        <button className="btn" onClick={() => setDark((d) => !d)} title="Fondo del lienzo">
          {dark ? 'fondo oscuro' : 'fondo claro'}
        </button>
        <label className="cw-check" title="Aplicar el CSS global del proyecto">
          <input type="checkbox" checked={useStyles} onChange={(e) => setUseStyles(e.target.checked)} />
          estilos
        </label>
        {!!bundle?.shell?.length && (
          <span
            className="pv-styles"
            title={
              'El preview envuelve el componente en estos contextos porque el proyecto los usa:' +
              NEWLINE + NEWLINE + bundle.shell.join(NEWLINE)
            }
          >
            {bundle.shell.join(' · ')}
          </span>
        )}
        {!!bundle?.styleWarnings?.length && (
          <span
            className="pv-styles pv-warn"
            title={'Hojas de estilo que no se aplicaron:' + NEWLINE + NEWLINE + bundle.styleWarnings.join(NEWLINE)}
          >
            {bundle.styleWarnings.length} hoja(s) sin compilar
          </span>
        )}
        {!!bundle?.stubs?.length && (
          <span className="pv-styles" title={stubTitle(bundle)}>
            {bundle.stubs.length} sustituido(s){bundle.isolated ? ' · aislado' : ''}
          </span>
        )}
        {styles && (
          <span
            className="pv-styles"
            title={
              styles.files.length
                ? `${styles.files.join(', ')}${styles.error ? `
${styles.error}` : ''}`
                : 'No se encontró CSS global en el proyecto'
            }
          >
            {styles.engine === 'none' ? 'sin css global' : `${styles.engine} · ${styles.files.length} hoja(s)`}
          </span>
        )}
      </div>

      <div className="pv-stage">
        {error ? <pre className="pv-error">{error}</pre> : <iframe ref={frameRef} title="preview" />}
      </div>

      <div className="pv-props">
        <h4>props</h4>
        {!current?.props.length && <p className="pv-none">Sin props declaradas.</p>}
        {current?.props.map((prop) => {
          const control = controlOf(prop);
          if (control === 'skip') {
            return (
              <label key={prop.name} className="pv-row">
                <span className="pv-name">
                  {prop.name}
                  {prop.optional ? '?' : ''}
                </span>
                <em className="pv-skip">{prop.type}</em>
              </label>
            );
          }
          const value = values[prop.name];
          return (
            <label key={prop.name} className="pv-row" title={prop.type}>
              <span className="pv-name">
                {prop.name}
                {prop.optional ? '?' : ''}
              </span>
              {control === 'boolean' && (
                <input
                  type="checkbox"
                  checked={!!value}
                  onChange={(e) => setValue(prop.name, e.target.checked)}
                />
              )}
              {control === 'number' && (
                <input
                  type="number"
                  value={String(value ?? '')}
                  onChange={(e) => setValue(prop.name, e.target.value === '' ? undefined : Number(e.target.value))}
                />
              )}
              {control === 'text' && (
                <input
                  type="text"
                  value={String(value ?? '')}
                  onChange={(e) => setValue(prop.name, e.target.value)}
                />
              )}
              {control === 'select' && (
                <select value={String(value ?? '')} onChange={(e) => setValue(prop.name, e.target.value)}>
                  {prop.options?.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              )}
              {control === 'json' && (
                <input
                  type="text"
                  placeholder="JSON"
                  className={draftInvalid(drafts[prop.name]) ? 'bad' : ''}
                  value={drafts[prop.name] ?? ''}
                  onChange={(e) => {
                    // El input muestra siempre lo que escribiste; el valor que
                    // recibe el componente sale de intentar parsearlo.
                    const raw = e.target.value;
                    setDrafts((prev) => ({ ...prev, [prop.name]: raw }));
                    if (!raw.trim()) {
                      setValue(prop.name, undefined);
                      return;
                    }
                    try {
                      setValue(prop.name, JSON.parse(raw));
                    } catch {
                      // Todavía no es JSON válido: se pasa como texto.
                      setValue(prop.name, raw);
                    }
                  }}
                />
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

/** Detalle de qué se reemplazó, para el tooltip. */
function stubTitle(bundle: Bundle): string {
  const br = String.fromCharCode(10);
  const head = bundle.isolated
    ? 'Se aislaron todas las dependencias externas.' + br + (bundle.isolatedReason ?? '')
    : 'Módulos nativos o sin resolver, dibujados como huecos:';
  return head + br + br + (bundle.stubs ?? []).join(br);
}
