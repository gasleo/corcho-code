import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Graph, ScanRequest } from '../shared/types.ts';
import { findComponents, isPreviewable } from './components.ts';
import { buildGraph } from './graph.ts';
import { bundleComponent, formatBuildError, PreviewUnsupported } from './preview.ts';
import { projectStyles } from './styles.ts';

const PORT = Number(process.env.PORT ?? 5174);

const app = express();
app.use(express.json({ limit: '1mb' }));

/** Ultimo root analizado: acota que ficheros puede leer /api/file. */
let currentRoot: string | null = null;
const cache = new Map<string, Graph>();

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, cwd: process.cwd(), home: os.homedir() });
});

app.post('/api/scan', (req, res) => {
  const body = req.body as ScanRequest;
  const target = (body?.path ?? '').trim();
  if (!target) {
    res.status(400).json({ error: 'Falta el campo "path".' });
    return;
  }
  const abs = path.resolve(target);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    res.status(404).json({ error: `No existe la ruta: ${abs}` });
    return;
  }
  if (!stat.isDirectory()) {
    res.status(400).json({ error: `No es un directorio: ${abs}` });
    return;
  }

  const fresh = req.query.fresh === '1';
  if (!fresh) {
    const hit = cache.get(abs);
    if (hit) {
      currentRoot = abs;
      res.json(hit);
      return;
    }
  }

  try {
    const graph = buildGraph(abs);
    cache.set(abs, graph);
    currentRoot = abs;
    console.log(
      `[scan] ${abs} -> ${graph.stats.files} ficheros, ${graph.stats.edges} aristas, ${graph.stats.ms}ms`,
    );
    res.json(graph);
  } catch (err) {
    console.error('[scan] fallo', err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/file', (req, res) => {
  const rel = String(req.query.path ?? '');
  const abs = insideRoot(rel, req.query.root);
  if (!abs) {
    res.status(400).json({ error: 'No hay proyecto abierto o la ruta está fuera de él.' });
    return;
  }
  try {
    res.json({ path: rel, text: fs.readFileSync(abs, 'utf8') });
  } catch {
    res.status(404).json({ error: 'No se pudo leer el fichero.' });
  }
});

/**
 * Ruta absoluta dentro del proyecto, o null si intenta escaparse. El root puede
 * venir en el pedido: así el cliente no depende de que el server recuerde cuál
 * fue el último escaneo (se reinicia, o hay dos pestañas abiertas).
 */
function insideRoot(rel: string, requested?: unknown): string | null {
  const base = typeof requested === 'string' && requested ? path.resolve(requested) : currentRoot;
  if (!base || !rel) return null;
  if (!cache.has(base) && base !== currentRoot) return null;
  const abs = path.resolve(base, rel);
  const check = path.relative(base, abs);
  if (check.startsWith('..') || path.isAbsolute(check)) return null;
  return abs;
}

app.put('/api/file', (req, res) => {
  const body = req.body as { path?: string; text?: string; root?: string };
  const abs = insideRoot(String(body?.path ?? ''), body?.root);
  if (!abs || typeof body.text !== 'string') {
    res.status(400).json({ error: 'Falta la ruta o el contenido.' });
    return;
  }
  if (!fs.existsSync(abs)) {
    res.status(404).json({ error: 'El fichero ya no existe.' });
    return;
  }
  try {
    fs.writeFileSync(abs, body.text, 'utf8');
    console.log(`[write] ${abs} (${body.text.length} bytes)`);
    res.json({ ok: true, bytes: body.text.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/components', (req, res) => {
  const rel = String(req.query.path ?? '');
  const abs = insideRoot(rel, req.query.root);
  if (!abs) {
    res.status(400).json({ error: 'Ruta inválida.' });
    return;
  }
  if (!isPreviewable(abs)) {
    res.json({ components: [] });
    return;
  }
  try {
    res.json({ components: findComponents(abs, fs.readFileSync(abs, 'utf8')) });
  } catch {
    res.status(404).json({ error: 'No se pudo leer el fichero.' });
  }
});

app.get('/api/preview', async (req, res) => {
  const rel = String(req.query.path ?? '');
  const name = String(req.query.name ?? '');
  const abs = insideRoot(rel, req.query.root);
  if (!abs || !name) {
    res.status(400).json({ error: 'Falta el fichero o el componente.' });
    return;
  }
  try {
    const projectRoot = typeof req.query.root === 'string' && req.query.root ? path.resolve(req.query.root) : currentRoot!;
    const [bundle, styles] = await Promise.all([
      bundleComponent(projectRoot, abs, name),
      projectStyles(projectRoot),
    ]);
    res.json({ ...bundle, styles });
  } catch (err) {
    // Distinguir "no se puede" de "falló el build": el mensaje es distinto.
    const message = err instanceof PreviewUnsupported ? err.message : formatBuildError(err);
    res.status(200).json({ js: '', css: '', error: message, unsupported: err instanceof PreviewUnsupported });
  }
});

// Se escucha en 127.0.0.1 explícitamente: con el host por defecto el proxy de
// Vite en Windows puede ir a parar a ::1 y fallar con ENOBUFS.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`corcho escuchando en http://127.0.0.1:${PORT}`);
});
