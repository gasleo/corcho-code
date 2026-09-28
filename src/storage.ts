/** Prefijo de todo lo que la app guarda en el navegador. */
export const STORAGE_PREFIX = 'corcho:';

/** Nombre con el que la app guardaba sus claves antes de llamarse Corcho. */
const LEGACY_PREFIX = 'code-canvas:';

/**
 * Copia las claves del nombre viejo al nuevo, una sola vez. Sin esto, el
 * renombre te dejaba sin tema, sin colores propios, sin la disposición de los
 * paneles y sin las ventanas abiertas de cada proyecto. Una clave nueva que ya
 * existe no se pisa, y las viejas se borran recién después de copiarlas.
 */
export function migrateLegacyStorage(): void {
  try {
    const legacy: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LEGACY_PREFIX)) legacy.push(key);
    }
    for (const key of legacy) {
      const renamed = STORAGE_PREFIX + key.slice(LEGACY_PREFIX.length);
      const value = localStorage.getItem(key);
      if (value !== null && localStorage.getItem(renamed) === null) {
        localStorage.setItem(renamed, value);
      }
      localStorage.removeItem(key);
    }
  } catch {
    // Sin localStorage (modo privado, cuota llena) no hay nada que migrar.
  }
}
