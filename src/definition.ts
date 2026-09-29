/**
 * Dónde se declara un nombre dentro de un fichero, para `gd` y `K`. No es un
 * analizador: son las formas de declarar de cada lenguaje, probadas en orden
 * de la más a la menos segura. Alcanza para saltar al lugar correcto casi
 * siempre, sin cargar el compilador en el navegador.
 */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function patternsFor(name: string, file: string): RegExp[] {
  const n = escape(name);
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();

  if (['.css', '.scss', '.sass', '.less', '.styl'].includes(ext)) {
    return [
      new RegExp(`\\$${n}\\s*:`, 'gm'),
      new RegExp(`--${n}\\s*:`, 'gm'),
      new RegExp(`@mixin\\s+${n}\\b`, 'gm'),
      new RegExp(`@function\\s+${n}\\b`, 'gm'),
      new RegExp(`%${n}\\b`, 'gm'),
      new RegExp(`\\.${n}\\b`, 'gm'),
    ];
  }

  if (ext === '.cs') {
    return [
      new RegExp(`\\b(?:class|interface|struct|enum|record)\\s+${n}\\b`, 'gm'),
      new RegExp(`^[ \\t]*(?:(?:public|private|protected|internal|static|async|override|virtual|abstract|sealed|partial|readonly)\\s+)*[\\w<>\\[\\],.? ]+\\s+${n}\\s*(?:<[^>]*>)?\\s*\\(`, 'gm'),
      new RegExp(`^[ \\t]*(?:(?:public|private|protected|internal|static|readonly|const)\\s+)*[\\w<>\\[\\],.? ]+\\s+${n}\\s*[{=;]`, 'gm'),
    ];
  }

  return [
    new RegExp(`\\b(?:function\\*?|class|interface|type|enum|namespace)\\s+${n}\\b`, 'gm'),
    new RegExp(`\\b(?:const|let|var)\\s+${n}\\b`, 'gm'),
    // Desestructuración: const { a, b: nombre } = …
    new RegExp(`\\b(?:const|let|var)\\s*[{[][^}\\]]*\\b${n}\\b[^}\\]]*[}\\]]\\s*=`, 'gm'),
    // Métodos de clase y de objeto literal.
    new RegExp(`^[ \\t]*(?:(?:async|static|public|private|protected|readonly|override|get|set)\\s+)*${n}\\s*(?:<[^>]*>)?\\s*\\([^)]*\\)\\s*[:{]`, 'gm'),
    // Propiedades de objeto o de clase.
    new RegExp(`^[ \\t]*(?:(?:static|public|private|protected|readonly)\\s+)*${n}\\s*[?!]?\\s*[:=]`, 'gm'),
    new RegExp(`\\bexport\\s*\\{[^}]*\\b${n}\\b`, 'gm'),
    // Traído de otro lado: el import es su "declaración" en este fichero.
    new RegExp(`\\bimport\\b[^;]*?\\b${n}\\b[^;]*?\\bfrom\\b`, 'gm'),
  ];
}

/** Offset del nombre declarado, o null si no se encontró. */
export function findDefinition(text: string, name: string, file: string): number | null {
  if (name === 'default') {
    const m = /\bexport\s+default\s+(?:async\s+)?(?:function\*?|class)?\s*([A-Za-z_$][\w$]*)?/.exec(text);
    if (!m) return null;
    return m[1] ? m.index + m[0].lastIndexOf(m[1]) : m.index;
  }
  if (name === '*') return 0;
  const exact = new RegExp(`(?<![\\w$])${escape(name)}(?![\\w$])`);
  for (const pattern of patternsFor(name, file)) {
    const m = pattern.exec(text);
    if (!m) continue;
    const at = m[0].search(exact);
    return m.index + Math.max(0, at);
  }
  return null;
}

/** La línea donde está el offset, sin sangría y recortada, para mostrarla en la barra. */
export function lineAt(text: string, offset: number, max = 90): { line: number; text: string } {
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  const endIdx = text.indexOf('\n', offset);
  const raw = text.slice(start, endIdx < 0 ? text.length : endIdx).trim();
  let line = 0;
  for (let i = 0; i < start; i++) if (text[i] === '\n') line++;
  return { line: line + 1, text: raw.length > max ? `${raw.slice(0, max - 1)}…` : raw };
}
