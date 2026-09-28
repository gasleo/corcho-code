import path from 'node:path';
import ts from 'typescript';

export interface Binding {
  /** Nombre exportado por el modulo destino: `default`, `*` o el nombre real. */
  imported: string;
  /** Nombre con el que se usa en este fichero. */
  local: string;
}

export interface ParsedImport {
  specifier: string;
  bindings: Binding[];
  /** `import()` o `require()` en vez de una declaracion estatica. */
  dynamic: boolean;
}

export interface ParsedFile {
  imports: ParsedImport[];
  exports: string[];
  loc: number;
  /** Cuantas veces aparece cada identificador fuera de las lineas de import. */
  usage: Map<string, number>;
}

function scriptKind(file: string): ts.ScriptKind {
  switch (path.extname(file)) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function isStringLiteral(node: ts.Node | undefined): node is ts.StringLiteralLike {
  return !!node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
}

/** Nombres declarados por un patron de binding (`const { a, b: c } = ...`). */
function bindingNames(name: ts.BindingName, out: string[]) {
  if (ts.isIdentifier(name)) {
    out.push(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) bindingNames(element.name, out);
  }
}

function hasExportModifier(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function hasDefaultModifier(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
}

/**
 * Parsea un fichero sin construir un Program completo: solo sintaxis.
 * Alcanza para saber que importa, que exporta y que simbolos importados usa,
 * y es un orden de magnitud mas rapido que hacer chequeo de tipos.
 */
export function parseFile(file: string, text: string): ParsedFile {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));

  const imports: ParsedImport[] = [];
  const exports = new Set<string>();
  const usage = new Map<string, number>();

  const addImport = (specifier: string, bindings: Binding[], dynamic: boolean) => {
    imports.push({ specifier, bindings, dynamic });
  };

  const collectImportClause = (clause: ts.ImportClause | undefined): Binding[] => {
    const bindings: Binding[] = [];
    if (!clause) return bindings;
    if (clause.name) bindings.push({ imported: 'default', local: clause.name.text });
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) {
      bindings.push({ imported: '*', local: named.name.text });
    } else if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        bindings.push({
          imported: (el.propertyName ?? el.name).text,
          local: el.name.text,
        });
      }
    }
    return bindings;
  };

  /** `skipUsage` evita contar como uso los identificadores de las propias lineas de import. */
  const visit = (node: ts.Node, skipUsage: boolean) => {
    if (ts.isImportDeclaration(node)) {
      if (isStringLiteral(node.moduleSpecifier)) {
        addImport(node.moduleSpecifier.text, collectImportClause(node.importClause), false);
      }
      return;
    }

    if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference) && isStringLiteral(node.moduleReference.expression)) {
        addImport(node.moduleReference.expression.text, [{ imported: '*', local: node.name.text }], false);
      }
      return;
    }

    if (ts.isExportDeclaration(node)) {
      const clause = node.exportClause;
      const bindings: Binding[] = [];
      if (clause && ts.isNamedExports(clause)) {
        for (const el of clause.elements) {
          const imported = (el.propertyName ?? el.name).text;
          bindings.push({ imported, local: el.name.text });
          exports.add(el.name.text);
        }
      } else if (clause && ts.isNamespaceExport(clause)) {
        bindings.push({ imported: '*', local: clause.name.text });
        exports.add(clause.name.text);
      } else if (!clause) {
        bindings.push({ imported: '*', local: '*' });
      }
      if (isStringLiteral(node.moduleSpecifier)) {
        addImport(node.moduleSpecifier.text, bindings, false);
        return;
      }
      // `export { a, b }` sin origen: los identificadores si cuentan como uso.
      ts.forEachChild(node, (child) => visit(child, skipUsage));
      return;
    }

    if (ts.isExportAssignment(node)) {
      exports.add('default');
      ts.forEachChild(node, (child) => visit(child, skipUsage));
      return;
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      if ((isRequire || isDynamicImport) && isStringLiteral(node.arguments[0])) {
        addImport((node.arguments[0] as ts.StringLiteralLike).text, [], true);
      }
    }

    if (hasExportModifier(node)) {
      if (hasDefaultModifier(node)) {
        exports.add('default');
      }
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isEnumDeclaration(node) ||
          ts.isModuleDeclaration(node)) &&
        node.name &&
        ts.isIdentifier(node.name)
      ) {
        exports.add(node.name.text);
      } else if (ts.isVariableStatement(node)) {
        const names: string[] = [];
        for (const decl of node.declarationList.declarations) bindingNames(decl.name, names);
        for (const n of names) exports.add(n);
      }
    }

    if (!skipUsage && ts.isIdentifier(node)) {
      const parent = node.parent;
      const isMemberName = parent && ts.isPropertyAccessExpression(parent) && parent.name === node;
      const isPropertyKey =
        parent && (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node;
      if (!isMemberName && !isPropertyKey) {
        usage.set(node.text, (usage.get(node.text) ?? 0) + 1);
      }
    }

    ts.forEachChild(node, (child) => visit(child, skipUsage));
  };

  ts.forEachChild(source, (child) => visit(child, false));

  let loc = 0;
  for (const line of text.split('\n')) {
    if (line.trim()) loc++;
  }

  return { imports, exports: [...exports], loc, usage };
}
