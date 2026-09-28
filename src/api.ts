/**
 * Cliente de la API. El proyecto abierto viaja en cada pedido en vez de vivir
 * solo en la memoria del servidor: si el server se reinicia (o se abren dos
 * pestañas), las ventanas de código y los previews siguen funcionando.
 */
let root = '';

export function setApiRoot(value: string): void {
  root = value;
}

const withRoot = (params: Record<string, string>) => {
  const query = new URLSearchParams(params);
  if (root) query.set('root', root);
  return query.toString();
};

export async function readFile(path: string): Promise<string> {
  const res = await fetch(`/api/file?${withRoot({ path })}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'No se pudo leer el fichero');
  return data.text as string;
}

export async function writeFile(path: string, text: string): Promise<void> {
  const res = await fetch('/api/file', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, text, root }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'No se pudo guardar');
}

export async function fetchComponents(path: string): Promise<unknown> {
  const res = await fetch(`/api/components?${withRoot({ path })}`);
  return res.json();
}

export async function fetchPreview(path: string, name: string): Promise<unknown> {
  const res = await fetch(`/api/preview?${withRoot({ path, name })}`);
  return res.json();
}
