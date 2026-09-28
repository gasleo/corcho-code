import type { TreeNode } from '../shared/types';

export interface LayoutNode {
  id: string;
  node: TreeNode;
  parent: LayoutNode | null;
  children: LayoutNode[];
  depth: number;
  r: number;
  /** Posicion que le toca por el layout, antes de arrastrarlo. */
  bx: number;
  by: number;
  x: number;
  y: number;
  /** Texto a mostrar: el nombre en el arbol, la ruta entera en un subespacio. */
  label: string;
  /** De que lado del icono va la etiqueta. */
  labelSide: 'left' | 'right';
  /** Segunda linea, mas chica: la carpeta del pivote en el subespacio. */
  sublabel?: string;
}

/** Banda que agrupa en una columna a los ficheros de un mismo directorio. */
export interface LayoutGroup {
  label: string;
  side: 'left' | 'right';
  x: number;
  y0: number;
  y1: number;
}

export interface Layout {
  nodes: LayoutNode[];
  byId: Map<string, LayoutNode>;
  root: LayoutNode;
  groups: LayoutGroup[];
  bounds: { x: number; y: number; w: number; h: number };
}

export interface Offset {
  dx: number;
  dy: number;
}

/** Separacion entre niveles y entre filas, en unidades de mundo. */
export const COLUMN = 215;
export const ROW = 52;

function radiusOf(node: TreeNode): number {
  if (node.kind === 'dir') return 17;
  return 12 + Math.min(7, Math.sqrt(node.file?.loc ?? 1) * 0.35);
}

/**
 * Arbol ordenado al estilo explorador: una columna por nivel, las hojas ocupan
 * filas consecutivas y cada carpeta queda centrada respecto de sus hijos. Es
 * determinista — mismo proyecto, mismo dibujo — y por construccion no hay dos
 * nodos encima del otro, que es lo que arruinaba el layout radial.
 */
export function layoutTree(
  tree: TreeNode,
  open: Set<string>,
  offsets: Map<string, Offset>,
  /** Si viene, solo se dibujan estos ids (el filtro de la barra). */
  filter?: Set<string> | null,
): Layout {
  const byId = new Map<string, LayoutNode>();
  const nodes: LayoutNode[] = [];
  let cursor = 0;

  /**
   * `carried` es el desplazamiento que el nodo hereda de sus ancestros movidos.
   * Sin esto, arrastrabas una carpeta cerrada a otro lado, la abrías, y sus
   * hijos aparecían en el sitio viejo, lejísimos de la carpeta.
   */
  const place = (
    node: TreeNode,
    parent: LayoutNode | null,
    depth: number,
    carried: Offset = { dx: 0, dy: 0 },
  ): LayoutNode => {
    const own = offsets.get(node.id);
    const total: Offset = { dx: carried.dx + (own?.dx ?? 0), dy: carried.dy + (own?.dy ?? 0) };

    const layout: LayoutNode = {
      id: node.id,
      node,
      parent,
      children: [],
      depth,
      r: radiusOf(node),
      bx: depth * COLUMN,
      by: 0,
      x: 0,
      y: 0,
      label: node.kind === 'dir' ? `${node.name}/` : node.name,
      labelSide: 'right',
    };
    byId.set(node.id, layout);
    nodes.push(layout);

    const all = node.kind === 'dir' && open.has(node.id) ? node.children ?? [] : [];
    const kids = filter ? all.filter((kid) => filter.has(kid.id)) : all;
    for (const kid of kids) layout.children.push(place(kid, layout, depth + 1, total));

    if (layout.children.length) {
      const first = layout.children[0];
      const last = layout.children[layout.children.length - 1];
      layout.by = (first.by + last.by) / 2;
    } else {
      layout.by = cursor;
      cursor += ROW;
    }

    // `by` sale de los hijos, así que el desplazamiento se aplica al final.
    layout.x = layout.bx + total.dx;
    layout.y = layout.by + total.dy;
    return layout;
  };

  const root = place(tree, null, 0);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.r);
    minY = Math.min(minY, node.y - node.r - 10);
    // A la derecha del icono va la etiqueta, hay que reservarle sitio.
    maxX = Math.max(maxX, node.x + node.r + 150);
    maxY = Math.max(maxY, node.y + node.r + 10);
  }
  if (!nodes.length) {
    minX = minY = 0;
    maxX = maxY = 100;
  }

  return { nodes, byId, root, groups: [], bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}

/** Mapa id -> id del padre para todo el arbol, incluidos los nodos no visibles. */
export function parentIndex(tree: TreeNode): Map<string, string | null> {
  const map = new Map<string, string | null>();
  const walk = (node: TreeNode, parent: string | null) => {
    map.set(node.id, parent);
    node.children?.forEach((child) => walk(child, node.id));
  };
  walk(tree, null);
  return map;
}

/** Todos los ids que cuelgan de un nodo, el propio incluido. */
export function subtreeIds(node: TreeNode): Set<string> {
  const out = new Set<string>();
  const walk = (current: TreeNode) => {
    out.add(current.id);
    current.children?.forEach(walk);
  };
  walk(node);
  return out;
}

/** Separacion entre las tres columnas del subespacio. */
export const SUB_COLUMN = 360;
const SUB_ROW = 46;
/** Aire entre un grupo y el siguiente: tiene que entrar la cabecera. */
const GROUP_GAP = 62;

export interface Subspace {
  pivot: TreeNode;
  /** Ficheros que importan al pivote. */
  incoming: TreeNode[];
  /** Ficheros que el pivote importa. */
  outgoing: TreeNode[];
}

function dirOf(id: string): string {
  const slash = id.lastIndexOf('/');
  return slash < 0 ? './' : `${id.slice(0, slash)}/`;
}

/** Agrupa por directorio y ordena: primero las carpetas, dentro por nombre. */
function byDirectory(files: TreeNode[]): { dir: string; files: TreeNode[] }[] {
  const map = new Map<string, TreeNode[]>();
  for (const file of files) {
    const dir = dirOf(file.id);
    const list = map.get(dir);
    if (list) list.push(file);
    else map.set(dir, [file]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dir, list]) => ({ dir, files: list.sort((a, b) => a.name.localeCompare(b.name)) }));
}

/**
 * Subespacio: saca al fichero elegido de su carpeta y lo pone en el centro, con
 * quien lo usa a la izquierda y lo que usa a la derecha. Cada columna va
 * agrupada por directorio — que es como uno piensa las dependencias — en vez de
 * una lista suelta de rutas largas. No toca el arbol: al salir todo vuelve a
 * estar como estaba.
 */
export function layoutSubspace(space: Subspace, offsets: Map<string, Offset>): Layout {
  const byId = new Map<string, LayoutNode>();
  const nodes: LayoutNode[] = [];
  const groups: LayoutGroup[] = [];

  const radiusOfFile = (node: TreeNode) =>
    node.kind === 'dir' ? 17 : 12 + Math.min(7, Math.sqrt(node.file?.loc ?? 1) * 0.35);

  const add = (node: TreeNode, x: number, y: number, side: 'left' | 'right', label: string): LayoutNode => {
    const layout: LayoutNode = {
      id: node.id,
      node,
      parent: null,
      children: [],
      depth: 0,
      r: radiusOfFile(node),
      bx: x,
      by: y,
      x: 0,
      y: 0,
      label,
      labelSide: side,
    };
    const offset = offsets.get(node.id);
    layout.x = layout.bx + (offset?.dx ?? 0);
    layout.y = layout.by + (offset?.dy ?? 0);
    byId.set(node.id, layout);
    nodes.push(layout);
    return layout;
  };

  /** Coloca una columna entera y la deja centrada en el eje del pivote. */
  const column = (files: TreeNode[], x: number, side: 'left' | 'right') => {
    if (!files.length) return;
    const blocks = byDirectory(files);
    const placed: { node: LayoutNode; y: number }[] = [];
    const marks: LayoutGroup[] = [];
    let y = 0;
    for (const block of blocks) {
      const y0 = y;
      for (const file of block.files) {
        placed.push({ node: add(file, x, y, side, file.name), y });
        y += SUB_ROW;
      }
      marks.push({ label: block.dir, side, x, y0, y1: y - SUB_ROW });
      y += GROUP_GAP;
    }
    const height = y - GROUP_GAP;
    const shift = -height / 2;
    for (const item of placed) {
      item.node.by += shift;
      item.node.y += shift;
    }
    for (const mark of marks) {
      groups.push({ ...mark, y0: mark.y0 + shift, y1: mark.y1 + shift });
    }
  };

  column(space.incoming, -SUB_COLUMN, 'left');
  const pivot = add(space.pivot, 0, 0, 'right', space.pivot.name);
  pivot.sublabel = dirOf(space.pivot.id);
  column(space.outgoing, SUB_COLUMN, 'right');

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const left = node.labelSide === 'left' ? 150 : 0;
    const right = node.labelSide === 'right' ? 150 : 0;
    minX = Math.min(minX, node.x - node.r - left);
    minY = Math.min(minY, node.y - node.r - 30);
    maxX = Math.max(maxX, node.x + node.r + right);
    maxY = Math.max(maxY, node.y + node.r + 16);
  }

  return { nodes, byId, root: pivot, groups, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}
