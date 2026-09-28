/** Tipos compartidos entre el analizador (server) y el canvas (src). */

export type NodeKind = 'dir' | 'file';

export interface SymbolRef {
  /** Nombre tal como lo exporta el modulo destino (`default` para el export por defecto). */
  name: string;
  /** Nombre local en el fichero que importa, si fue renombrado. */
  local: string;
  /** Cuantas veces se usa ese simbolo en el cuerpo del fichero. */
  uses: number;
}

export interface FileInfo {
  /** Simbolos que el fichero exporta. */
  exports: string[];
  /** Especificadores que no se pudieron resolver dentro del arbol (paquetes, aliases raros). */
  externals: string[];
  loc: number;
  /** Id del analizador que lo procesó: 'typescript', 'csharp'… */
  lang: string;
}

export interface PropInfo {
  name: string;
  /** Texto del tipo tal como está escrito en el fichero. */
  type: string;
  optional: boolean;
  /** Si el tipo es una unión de literales, sus valores. */
  options?: string[];
  /** Valor por defecto del destructuring, tal cual está escrito. */
  default?: string;
}

export interface ComponentInfo {
  name: string;
  props: PropInfo[];
  isDefault: boolean;
}

export interface TreeNode {
  /** Ruta relativa al root, en formato posix. Es el id estable de todo el grafo. */
  id: string;
  name: string;
  kind: NodeKind;
  /** Peso para el treemap: LOC en ficheros, suma de hijos en directorios. */
  weight: number;
  children?: TreeNode[];
  file?: FileInfo;
}

export interface Edge {
  from: string;
  to: string;
  symbols: SymbolRef[];
  /** Suma de usos de todos los simbolos; 0 significa import sin uso detectado. */
  uses: number;
}

export interface Graph {
  root: string;
  tree: TreeNode;
  edges: Edge[];
  stats: {
    files: number;
    dirs: number;
    edges: number;
    loc: number;
    skipped: number;
    ms: number;
    /** Qué lenguajes aparecieron y con cuántos ficheros cada uno. */
    languages: { id: string; label: string; files: number }[];
  };
}

export interface ScanRequest {
  path: string;
}
