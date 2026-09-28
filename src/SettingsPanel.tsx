import type { ThemeName } from './theme';
import { COLOR_KEYS, currentColor, type EdgeShape, type Settings } from './settings';

interface Props {
  settings: Settings;
  theme: ThemeName;
  onChange: (next: Settings) => void;
  onToggleTheme: () => void;
  onClose: () => void;
}

const SHAPES: { value: EdgeShape; label: string; hint: string }[] = [
  { value: 'curve', label: 'curvas', hint: 'Trazo curvo, más suelto entre nodos lejanos' },
  { value: 'orthogonal', label: 'ortogonales', hint: 'Tramos rectos en ángulo, como un diagrama' },
];

/** Panel de preferencias: se aplica en vivo y se guarda en el navegador. */
export function SettingsPanel({ settings, theme, onChange, onToggleTheme, onClose }: Props) {
  const overrides = settings.colors[theme];

  const setColor = (key: string, value: string | null) => {
    const next = { ...overrides };
    if (value) next[key] = value;
    else delete next[key];
    onChange({ ...settings, colors: { ...settings.colors, [theme]: next } });
  };

  const resetColors = () =>
    onChange({ ...settings, colors: { ...settings.colors, [theme]: {} } });

  const touched = Object.keys(overrides).length;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">configuración</span>
          <button className="btn btn-icon" onClick={onClose} title="Cerrar (Esc)">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <section>
            <h4>aristas</h4>
            <p className="modal-hint">Cómo se dibujan las dependencias entre ficheros.</p>
            <div className="segmented-group">
              {SHAPES.map((shape) => (
                <button
                  key={shape.value}
                  className={settings.edgeShape === shape.value ? 'on' : ''}
                  onClick={() => onChange({ ...settings, edgeShape: shape.value })}
                  title={shape.hint}
                >
                  {shape.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h4>
              colores · tema {theme === 'dark' ? 'oscuro' : 'claro'}
              <button className="btn" onClick={onToggleTheme} title="Cambiar de tema (t)">
                {theme === 'dark' ? '☀ claro' : '☾ oscuro'}
              </button>
            </h4>
            <p className="modal-hint">
              Cada tema guarda sus propios colores. Lo que no toques sigue el tema.
            </p>

            {COLOR_KEYS.map((spec) => {
              const value = currentColor(spec.key, theme, overrides);
              const custom = !!overrides[spec.key];
              return (
                <div className="color-row" key={spec.key}>
                  <input
                    type="color"
                    value={value}
                    onChange={(e) => setColor(spec.key, e.target.value)}
                    title={spec.hint}
                  />
                  <span className="color-name">
                    {spec.label}
                    <em>{spec.hint}</em>
                  </span>
                  <input
                    className="color-hex"
                    value={value}
                    spellCheck={false}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      if (/^#[0-9a-fA-F]{6}$/.test(raw)) setColor(spec.key, raw);
                    }}
                  />
                  <button
                    className="btn"
                    disabled={!custom}
                    onClick={() => setColor(spec.key, null)}
                    title="Volver al color del tema"
                  >
                    ↺
                  </button>
                </div>
              );
            })}

            <div className="modal-actions">
              <button className="btn" onClick={resetColors} disabled={!touched}>
                restablecer los {touched || ''} colores
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
