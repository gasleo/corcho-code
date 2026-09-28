import { register } from '../analysis/registry.ts';
import { csharpAnalyzer } from './csharp.ts';
import { stylesheetAnalyzer } from './stylesheet.ts';
import { typescriptAnalyzer } from './typescript.ts';

/**
 * Único punto donde el núcleo se entera de qué lenguajes existen. Para sumar
 * uno nuevo: implementar `LanguageAnalyzer` y agregarlo a esta lista.
 */
export function registerBuiltinLanguages(): void {
  register(typescriptAnalyzer);
  register(csharpAnalyzer);
  register(stylesheetAnalyzer);
}
