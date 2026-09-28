import path from 'node:path';
import ts from 'typescript';
import type { ComponentInfo, PropInfo } from '../shared/types.ts';

const PREVIEWABLE = new Set(['.tsx', '.jsx']);

export const isPreviewable = (file: string) => PREVIEWABLE.has(path.extname(file));

/** `Foo`, `MyCard`: por convención, un componente empieza en mayúscula. */
const looksLikeComponent = (name: string) => /^[A-Z]/.test(name);

function scriptKind(file: string): ts.ScriptKind {
  return path.extname(file) === '.jsx' ? ts.ScriptKind.JSX : ts.ScriptKind.TSX;
}

/** Union de literales de texto -> lista de opciones para un desplegable. */
function literalOptions(type: ts.TypeNode | undefined): string[] | undefined {
  if (!type || !ts.isUnionTypeNode(type)) return undefined;
  const options: string[] = [];
  for (const member of type.types) {
    if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) options.push(member.literal.text);
    else return undefined;
  }
  return options.length ? options : undefined;
}

function fromMembers(members: ts.NodeArray<ts.TypeElement>, source: ts.SourceFile): PropInfo[] {
  const props: PropInfo[] = [];
  for (const member of members) {
    if (!ts.isPropertySignature(member) || !member.name) continue;
    const name = ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) ? member.name.text : null;
    if (!name) continue;
    props.push({
      name,
      type: member.type ? member.type.getText(source) : 'unknown',
      optional: !!member.questionToken,
      options: literalOptions(member.type),
    });
  }
  return props;
}

function membersOf(type: ts.TypeNode | undefined, source: ts.SourceFile): PropInfo[] {
  if (!type) return [];

  // `({ a }: { a: string })`
  if (ts.isTypeLiteralNode(type)) return fromMembers(type.members, source);

  // `({ a }: Props)` -> se busca la interfaz o el alias en el mismo fichero.
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const name = type.typeName.text;
    for (const statement of source.statements) {
      if (ts.isInterfaceDeclaration(statement) && statement.name.text === name) {
        return fromMembers(statement.members, source);
      }
      if (
        ts.isTypeAliasDeclaration(statement) &&
        statement.name.text === name &&
        ts.isTypeLiteralNode(statement.type)
      ) {
        return fromMembers(statement.type.members, source);
      }
    }
  }
  return [];
}

/** Sin tipos (JSX puro) al menos sacamos los nombres y sus valores por defecto. */
function fromBindingPattern(param: ts.ParameterDeclaration, source: ts.SourceFile): PropInfo[] {
  if (!ts.isObjectBindingPattern(param.name)) return [];
  const props: PropInfo[] = [];
  for (const element of param.name.elements) {
    const key = element.propertyName ?? element.name;
    if (!ts.isIdentifier(key)) continue;
    props.push({
      name: key.text,
      type: 'unknown',
      optional: !!element.initializer,
      default: element.initializer ? element.initializer.getText(source) : undefined,
    });
  }
  return props;
}

function propsOf(params: ts.NodeArray<ts.ParameterDeclaration>, source: ts.SourceFile): PropInfo[] {
  const first = params[0];
  if (!first) return [];
  const typed = membersOf(first.type, source);
  if (typed.length) return typed;
  return fromBindingPattern(first, source);
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === kind);
}

/** `observer(X)`, `memo(forwardRef(X))`: se desenvuelve hasta llegar al nombre. */
function unwrapToIdentifier(expr: ts.Expression): string | null {
  let current: ts.Expression | undefined = expr;
  for (let depth = 0; current && depth < 6; depth++) {
    if (ts.isIdentifier(current)) return current.text;
    if (ts.isCallExpression(current)) {
      current = current.arguments[0];
      continue;
    }
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    return null;
  }
  return null;
}

/**
 * Busca componentes exportados y sus props. Es análisis sintáctico: no resuelve
 * tipos importados de otro fichero, así que de esos solo se sabe el nombre.
 *
 * Se indexan primero **todas** las declaraciones del fichero y recién después se
 * mira qué se exporta. Hace falta porque el patrón habitual en React Native y en
 * media app con mobx o redux es declarar el componente suelto y exportarlo al
 * final envuelto: `const Screen = () => …` + `export default observer(Screen)`.
 */
export function findComponents(file: string, text: string): ComponentInfo[] {
  if (!isPreviewable(file)) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));

  /** Nombre local -> props, esté exportado o no. */
  const declared = new Map<string, PropInfo[]>();
  /** Nombre local -> cómo se exporta. */
  const exported = new Map<string, { isDefault: boolean }>();

  const declare = (name: string, props: PropInfo[]) => {
    if (looksLikeComponent(name) && !declared.has(name)) declared.set(name, props);
  };

  for (const statement of source.statements) {
    // --- declaraciones ---
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      declare(statement.name.text, propsOf(statement.parameters, source));
      if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
        exported.set(statement.name.text, { isDefault: hasModifier(statement, ts.SyntaxKind.DefaultKeyword) });
      }
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      const isExported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        let init = decl.initializer;
        // `memo(...)`, `forwardRef(...)`, `observer(...)`: el componente va dentro.
        while (init && (ts.isCallExpression(init) || ts.isParenthesizedExpression(init))) {
          init = ts.isCallExpression(init) ? init.arguments[0] : init.expression;
        }
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          declare(decl.name.text, propsOf(init.parameters, source));
        } else {
          declare(decl.name.text, []);
        }
        if (isExported) exported.set(decl.name.text, { isDefault: false });
      }
      continue;
    }

    // --- exportaciones sueltas ---
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      // `export default X` o `export default observer(X)`
      const name = unwrapToIdentifier(statement.expression);
      if (name) exported.set(name, { isDefault: true });
      continue;
    }

    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause) {
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          // `export { Card }` y `export { Card as Tarjeta }`
          const local = (element.propertyName ?? element.name).text;
          exported.set(local, { isDefault: element.name.text === 'default' });
        }
      }
    }
  }

  const found: ComponentInfo[] = [];
  for (const [name, info] of exported) {
    const props = declared.get(name);
    if (!props) continue;
    found.push({ name, props, isDefault: info.isDefault });
  }
  return found;
}
