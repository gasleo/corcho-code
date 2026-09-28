import type { SymbolRef } from '../../shared/types.ts';

/**
 * Contrato de análisis por lenguaje (interfaz separada): lo define el núcleo,
 * que es quien lo consume, y cada lenguaje vive en su propio módulo sin que
 * `graph.ts` sepa nada de él. Para sumar un lenguaje alcanza con implementar
 * esto y registrarlo.
 *
 * El análisis va en dos fases a propósito. En JS/TS una dependencia se resuelve
 * mirando un solo fichero (`./db` es una ruta), pero en C# o Java no: `using
 * Foo.Bar` nombra un espacio de nombres que puede estar repartido en muchos
 * ficheros, y hay que tener el proyecto entero indexado para saber dónde vive
 * cada tipo. La fase 1 saca hechos de cada fichero por separado; la fase 2 ve
 * todos los hechos juntos y recién ahí produce las aristas.
 */
export interface SourceFile {
  abs: string;
  /** Ruta relativa al root, en posix. Es el id del nodo en el grafo. */
  rel: string;
  text: string;
}

export interface FileFacts {
  loc: number;
  /** Símbolos que este fichero ofrece al resto del proyecto. */
  exports: string[];
  /** Dependencias que quedaron fuera del proyecto (paquetes, framework). */
  externals: string[];
  /** Lo que el plugin necesite recordar para la fase de enlace. */
  data?: unknown;
}

export interface AnalyzedSource extends SourceFile {
  facts: FileFacts;
}

export interface LinkContext {
  root: string;
  /** Ficheros de este mismo lenguaje, por ruta relativa. */
  files: Map<string, AnalyzedSource>;
  /** Todos los del proyecto, por si un lenguaje cruza fronteras. */
  allFiles: Map<string, AnalyzedSource>;
}

export interface FileLink {
  from: string;
  to: string;
  symbols: SymbolRef[];
}

export interface LanguageAnalyzer {
  /** Identificador estable; aparece en el nodo del grafo. */
  id: string;
  /** Nombre legible para la interfaz. */
  label: string;
  /** Extensiones que reclama, con el punto. */
  extensions: string[];
  /** Directorios propios del lenguaje que no vale la pena recorrer. */
  ignoredDirs?: string[];
  /** Ficheros que se descartan aunque tengan una extensión reclamada. */
  skip?(file: string): boolean;

  /** Fase 1: hechos de un fichero, sin mirar a los demás. */
  parse(file: SourceFile): FileFacts;

  /** Fase 2: con todo indexado, las aristas entre ficheros. */
  link(context: LinkContext): FileLink[];
}
