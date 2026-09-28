import type { Edge, TreeNode } from '../shared/types';

interface Props {
  node: TreeNode | null;
  outgoing: Edge[];
  incoming: Edge[];
  onSelect: (id: string) => void;
  /** Si viene, se ofrece abrir el subespacio de este fichero. */
  onSubspace?: (id: string) => void;
  /** Si viene, se ofrece abrir el código en una ventana. */
  onOpenCode?: (id: string) => void;
}

/** Ruta en dos tonos: la carpeta apagada, el fichero destacado. */
function Path({ id }: { id: string }) {
  const slash = id.lastIndexOf('/');
  if (slash < 0) return <>{id}</>;
  return (
    <>
      <span className="dir">{id.slice(0, slash + 1)}</span>
      {id.slice(slash + 1)}
    </>
  );
}

function SymbolList({ edge }: { edge: Edge }) {
  return (
    <div className="symbols">
      {edge.symbols.map((s) => (
        <span
          key={s.local || s.name}
          className={s.uses > 0 ? 'sym' : 'sym sym-unused'}
          title={s.uses > 0 ? `${s.uses} uso(s)` : 'importado pero sin usos detectados'}
        >
          {s.name === '*' ? '* (namespace)' : s.name}
          {s.local && s.local !== s.name ? ` as ${s.local}` : ''}
          {s.uses > 0 ? <em>×{s.uses}</em> : null}
        </span>
      ))}
    </div>
  );
}

export function Inspector({ node, outgoing, incoming, onSelect, onSubspace, onOpenCode }: Props) {
  if (!node) {
    return (
      <div className="inspector empty">
        <p>Clic en un fichero para ver sus conexiones.</p>
        <ul className="hints">
          <li>Clic en una carpeta: abrirla o cerrarla</li>
          <li>«subespacio»: solo ese fichero y lo que se relaciona con él</li>
          <li>«código»: ventana con el fuente, redimensionable</li>
          <li>Arrastrá un nodo para moverlo de sitio</li>
          <li>Doble clic en un nodo movido: lo devuelve al árbol</li>
          <li>Rueda: zoom · arrastrar el fondo: pan</li>
        </ul>
      </div>
    );
  }

  return (
    <div className="inspector">
      <div className="inspector-head">
        <h2 title={node.id}>{node.name}</h2>
        <div className="path">
          <Path id={node.id} />
        </div>
        {node.file && (
          <div className="meta">
            {node.file.loc} LOC · importa {outgoing.length} · lo usan {incoming.length}
          </div>
        )}
        <div className="inspector-actions">
          {onOpenCode && (
            <button className="btn" onClick={() => onOpenCode(node.id)}>
              código
            </button>
          )}
          {onSubspace && (
            <button className="btn" onClick={() => onSubspace(node.id)}>
              subespacio
            </button>
          )}
        </div>
      </div>

      {node.file && node.file.exports.length > 0 && (
        <section>
          <h3>exporta</h3>
          <div className="symbols">
            {node.file.exports.map((e) => (
              <span key={e} className="sym sym-export">
                {e}
              </span>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3>importa de ({outgoing.length})</h3>
        {outgoing.length === 0 && <p className="none">Nada dentro del proyecto.</p>}
        {outgoing.map((edge) => (
          <div key={edge.to} className="dep">
            <button className="link" onClick={() => onSelect(edge.to)} title={edge.to}>
              <Path id={edge.to} />
            </button>
            <SymbolList edge={edge} />
          </div>
        ))}
      </section>

      <section>
        <h3>lo usan ({incoming.length})</h3>
        {incoming.length === 0 && <p className="none">Nadie lo importa.</p>}
        {incoming.map((edge) => (
          <div key={edge.from} className="dep">
            <button className="link" onClick={() => onSelect(edge.from)} title={edge.from}>
              <Path id={edge.from} />
            </button>
            <SymbolList edge={edge} />
          </div>
        ))}
      </section>

      {node.file && node.file.externals.length > 0 && (
        <section>
          <h3>externos ({node.file.externals.length})</h3>
          <div className="symbols">
            {node.file.externals.map((e) => (
              <span key={e} className="sym sym-external">
                {e}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
