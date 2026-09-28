import { useEffect, useRef } from 'react';
import type { TreeNode } from '../shared/types';
import { fileStyle } from './icons';

interface Props {
  tree: TreeNode;
  open: Set<string>;
  /** Ids que sobreviven al filtro; null cuando no hay filtro activo. */
  filter: Set<string> | null;
  selectedId: string | null;
  matches: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onOpenCode: (id: string) => void;
  onMenu: (id: string, clientX: number, clientY: number) => void;
}

/**
 * Árbol de directorios de toda la vida. Comparte el estado de carpetas abiertas
 * con el lienzo: lo que desplegás acá se despliega allá, y al revés.
 */
export function Explorer({
  tree,
  open,
  filter,
  selectedId,
  matches,
  onToggle,
  onSelect,
  onOpenCode,
  onMenu,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Si la selección viene del lienzo, se trae la fila a la vista.
  useEffect(() => {
    if (!selectedId || !rootRef.current) return;
    const row = rootRef.current.querySelector(`[data-id="${CSS.escape(selectedId)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const rows: JSX.Element[] = [];

  const walk = (node: TreeNode, depth: number) => {
    const isDir = node.kind === 'dir';
    const isOpen = isDir && open.has(node.id);
    const style = isDir ? null : fileStyle(node.name);

    rows.push(
      <div
        key={node.id}
        data-id={node.id}
        className={`ex-row${node.id === selectedId ? ' on' : ''}${matches.has(node.id) ? ' match' : ''}`}
        style={{ paddingLeft: 6 + depth * 13 }}
        title={node.id.replace(/^dir:/, '')}
        onClick={() => (isDir ? onToggle(node.id) : onSelect(node.id))}
        onDoubleClick={() => !isDir && onOpenCode(node.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!isDir) onSelect(node.id);
          onMenu(node.id, e.clientX, e.clientY);
        }}
      >
        <span className="ex-caret">{isDir ? (isOpen ? '▾' : '▸') : ''}</span>
        {isDir ? (
          <span className="ex-folder">{isOpen ? '▤' : '▥'}</span>
        ) : (
          <i className="ex-dot" style={{ background: style!.color }} />
        )}
        <span className="ex-name">{node.name}</span>
        {!isDir && <span className="ex-loc">{node.file?.loc ?? 0}</span>}
      </div>,
    );

    if (!isOpen) return;
    const kids = node.children ?? [];
    for (const kid of filter ? kids.filter((k) => filter.has(k.id)) : kids) walk(kid, depth + 1);
  };

  walk(tree, 0);

  return (
    <div className="explorer" ref={rootRef}>
      {rows}
      {filter && matches.size === 0 && <div className="ex-empty">sin coincidencias</div>}
    </div>
  );
}
