import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Edge, Graph, TreeNode } from '../shared/types';
import { CanvasGraph, type CanvasHandle, type EdgeMode } from './CanvasGraph';
import { Explorer } from './Explorer';
import { CodeWindow, MAX_FONT, MIN_FONT, type WindowState } from './CodeWindow';
import { Inspector } from './Inspector';
import { SettingsPanel } from './SettingsPanel';
import { STORAGE_PREFIX } from './storage';
import { setApiRoot } from './api';
import { applyColors, loadSettings, paletteFor, saveSettings, type Settings } from './settings';
import { nextTheme, persistTheme, readTheme, themeInfo, type ThemeName } from './theme';
import { parentIndex, type Subspace } from './treeLayout';

interface SavedUI {
  open: string[];
  windows: WindowState[];
  edgeMode: EdgeMode;
}

const uiKey = (root: string) => `${STORAGE_PREFIX}ui:${root}`;
const PANELS_KEY = `${STORAGE_PREFIX}panels`;

interface PanelsState {
  /** true = el explorador pasa a la derecha y el inspector a la izquierda. */
  swapped: boolean;
  explorer: boolean;
  inspector: boolean;
}

function loadPanels(): PanelsState {
  try {
    const raw = localStorage.getItem(PANELS_KEY);
    if (raw) return { swapped: false, explorer: false, inspector: false, ...JSON.parse(raw) };
  } catch {
    // sin localStorage: valores por defecto
  }
  return { swapped: false, explorer: false, inspector: false };
}

/** Estado de la sesión anterior para este proyecto, si sigue siendo válido. */
function loadUI(root: string): SavedUI | null {
  try {
    const raw = localStorage.getItem(uiKey(root));
    if (!raw) return null;
    const data = JSON.parse(raw) as SavedUI;
    if (!Array.isArray(data.open) || !Array.isArray(data.windows)) return null;
    return data;
  } catch {
    return null;
  }
}

interface MenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

type MenuEntry = MenuItem | 'sep';

interface Menu {
  x: number;
  y: number;
  items: MenuEntry[];
}

function indexNodes(tree: TreeNode): Map<string, TreeNode> {
  const map = new Map<string, TreeNode>();
  const walk = (node: TreeNode) => {
    map.set(node.id, node);
    node.children?.forEach(walk);
  };
  walk(tree);
  return map;
}

const EDGE_MODES: { value: EdgeMode; label: string; title: string }[] = [
  { value: 'selection', label: 'activo', title: 'Solo los imports del nodo bajo el cursor o seleccionado' },
  { value: 'all', label: 'todos', title: 'Dibujar todos los imports a la vez' },
  { value: 'none', label: 'ninguno', title: 'Ocultar los imports' },
];

const baseName = (id: string) => id.slice(id.lastIndexOf('/') + 1);

export default function App() {
  const [pathInput, setPathInput] = useState('');
  const [graph, setGraph] = useState<Graph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [edgeMode, setEdgeMode] = useState<EdgeMode>('selection');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [windows, setWindows] = useState<WindowState[]>([]);
  const [theme, setTheme] = useState<ThemeName>('corkboard');
  const [dockHot, setDockHot] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [panels, setPanels] = useState<PanelsState>(() => loadPanels());
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [showSettings, setShowSettings] = useState(false);
  const topZ = useRef(10);
  const canvasRef = useRef<CanvasHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const initial = readTheme();
    setTheme(initial);
    persistTheme(initial);
  }, []);

  // Los colores propios se aplican al documento y se guardan en el navegador.
  useEffect(() => {
    applyColors(settings.colors[theme]);
    saveSettings(settings);
  }, [settings, theme]);

  useEffect(() => {
    try {
      localStorage.setItem(PANELS_KEY, JSON.stringify(panels));
    } catch {
      // sin localStorage se sigue trabajando igual
    }
  }, [panels]);

  const collapsePanel = useCallback((which: 'explorer' | 'inspector') => {
    setPanels((prev) => ({ ...prev, [which]: !prev[which] }));
  }, []);

  const swapPanels = useCallback(() => setPanels((prev) => ({ ...prev, swapped: !prev.swapped })), []);

  const selectTheme = useCallback((next: ThemeName) => {
    persistTheme(next);
    setTheme(next);
  }, []);

  /** El botón y la tecla t recorren corcho → oscuro → claro. */
  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = nextTheme(prev);
      persistTheme(next);
      return next;
    });
  }, []);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((info) => setPathInput((prev) => prev || info.cwd))
      .catch(() => undefined);
  }, []);

  const scan = useCallback(
    async (fresh = false) => {
      const target = pathInput.trim();
      if (!target) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/scan${fresh ? '?fresh=1' : ''}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: target }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Fallo el analisis');
        const next = data as Graph;
        // Todas las llamadas siguientes viajan con el proyecto a cuestas.
        setApiRoot(next.root);
        const known = indexNodes(next.tree);
        const saved = loadUI(next.root);
        setGraph(next);
        setSelectedId(null);
        setFocusId(null);
        setSearch('');
        // Se descarta lo que ya no existe: los ficheros se mueven entre sesiones.
        setWindows(
          (saved?.windows ?? [])
            .filter((w) => known.get(w.id)?.kind === 'file')
            // Antes 'code' era solo lectura y 'edit' el editor: ahora son lo mismo.
            .map((w) => ({ ...w, view: w.view === 'preview' ? 'preview' : 'code' })),
        );
        topZ.current = Math.max(10, ...(saved?.windows ?? []).map((w) => w.z));
        setEdgeMode(saved?.edgeMode ?? 'selection');
        const restored = (saved?.open ?? []).filter((id) => known.get(id)?.kind === 'dir');
        // Sin nada guardado arranca plegado: solo la raiz, con su primer nivel.
        setOpen(new Set(restored.length ? [next.tree.id, ...restored] : [next.tree.id]));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setGraph(null);
      } finally {
        setLoading(false);
      }
    },
    [pathInput],
  );

  const nodes = useMemo(() => (graph ? indexNodes(graph.tree) : new Map<string, TreeNode>()), [graph]);

  // Carpetas abiertas, ventanas y modo de aristas sobreviven al refresco.
  useEffect(() => {
    if (!graph) return;
    try {
      const data: SavedUI = { open: [...open], windows, edgeMode };
      localStorage.setItem(uiKey(graph.root), JSON.stringify(data));
    } catch {
      // Sin localStorage (modo privado, cuota llena) se sigue trabajando igual.
    }
  }, [graph, open, windows, edgeMode]);

  const { outgoing, incoming } = useMemo(() => {
    const out = new Map<string, Edge[]>();
    const inc = new Map<string, Edge[]>();
    const push = (map: Map<string, Edge[]>, key: string, edge: Edge) => {
      const list = map.get(key);
      if (list) list.push(edge);
      else map.set(key, [edge]);
    };
    for (const edge of graph?.edges ?? []) {
      push(out, edge.from, edge);
      push(inc, edge.to, edge);
    }
    const sort = (list: Edge[]) => list.sort((a, b) => b.uses - a.uses);
    out.forEach(sort);
    inc.forEach(sort);
    return { outgoing: out, incoming: inc };
  }, [graph]);

  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    const found = new Set<string>();
    if (!query) return found;
    for (const [id, node] of nodes) {
      if (node.kind === 'file' && id.toLowerCase().includes(query)) found.add(id);
    }
    return found;
  }, [search, nodes]);

  /**
   * Con el filtro activo el canvas muestra solo los ficheros que coinciden y
   * las carpetas que llevan hasta ellos. No se toca `open`: al borrar el filtro
   * el árbol vuelve exactamente a como estaba.
   */
  const filter = useMemo(() => {
    if (!graph || !search.trim()) return null;
    const parents = parentIndex(graph.tree);
    const allowed = new Set<string>([graph.tree.id]);
    for (const id of matches) {
      allowed.add(id);
      let cursor = parents.get(id) ?? null;
      while (cursor) {
        allowed.add(cursor);
        cursor = parents.get(cursor) ?? null;
      }
    }
    return allowed;
  }, [graph, search, matches]);

  /** Con filtro se abre todo lo que haga falta para ver las coincidencias. */
  const effectiveOpen = useMemo(() => {
    if (!filter) return open;
    const dirs = new Set<string>();
    for (const id of filter) if (nodes.get(id)?.kind === 'dir') dirs.add(id);
    return dirs;
  }, [filter, open, nodes]);

  const toggleOpen = useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Abre una carpeta y todo lo que cuelga de ella. */
  const openRecursive = useCallback(
    (id: string) => {
      const root = nodes.get(id);
      if (!root) return;
      const ids: string[] = [];
      const walk = (node: TreeNode) => {
        if (node.kind !== 'dir') return;
        ids.push(node.id);
        node.children?.forEach(walk);
      };
      walk(root);
      setOpen((prev) => new Set([...prev, ...ids]));
    },
    [nodes],
  );

  /** Abre toda la cadena de carpetas que lleva hasta un nodo. */
  const revealPath = useCallback(
    (id: string) => {
      if (!graph) return;
      const chain: string[] = [];
      const walk = (node: TreeNode, trail: string[]): boolean => {
        if (node.id === id) {
          chain.push(...trail);
          return true;
        }
        return (node.children ?? []).some((child) => walk(child, [...trail, node.id]));
      };
      walk(graph.tree, []);
      if (chain.length) setOpen((prev) => new Set([...prev, ...chain]));
    },
    [graph],
  );

  const collapseAll = useCallback(() => {
    if (graph) setOpen(new Set([graph.tree.id]));
  }, [graph]);



  /** Abre el fichero en una ventana, o trae al frente la que ya estaba. */
  const openCode = useCallback((id: string, view: 'code' | 'preview' = 'code') => {
    setWindows((prev) => {
      topZ.current += 1;
      const z = topZ.current;
      if (prev.some((w) => w.id === id)) {
        return prev.map((w) => (w.id === id ? { ...w, z, docked: false, view } : w));
      }
      const step = prev.length % 6;
      return [
        ...prev,
        {
          id,
          x: 70 + step * 32,
          y: 60 + step * 30,
          w: 640,
          h: 440,
          z,
          focused: false,
          docked: false,
          pinned: false,
          wrap: false,
          fontSize: 12,
          view,
        },
      ];
    });
  }, []);

  const closeCode = useCallback((id: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const raiseCode = useCallback((id: string) => {
    setWindows((prev) => {
      if (prev.length < 2) return prev;
      topZ.current += 1;
      const z = topZ.current;
      return prev.map((w) => (w.id === id ? { ...w, z } : w));
    });
  }, []);

  const updateWindow = useCallback((next: WindowState) => {
    setWindows((prev) => prev.map((w) => (w.id === next.id ? next : w)));
  }, []);

  const patchWindow = useCallback((id: string, patch: (current: WindowState) => WindowState) => {
    setWindows((prev) => prev.map((w) => (w.id === id ? patch(w) : w)));
  }, []);

  const dockRect = useCallback(() => dockRef.current?.getBoundingClientRect() ?? null, []);

  /**
   * Arrastre de las fichas de la barra: de costado las reordena, hacia arriba
   * saca la ventana de la barra y la deja donde soltaste.
   */
  const chipDragRef = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const drag = chipDragRef.current;
      if (!drag) return;
      if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 5) drag.moved = true;

      const bar = dockRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();

      if (e.clientY < rect.top - 40) {
        chipDragRef.current = null;
        topZ.current += 1;
        const z = topZ.current;
        // Las ventanas se posicionan dentro de su capa, no del viewport, y hay
        // que dejarlas dentro de la vista aunque sueltes cerca de un borde.
        const layer = layerRef.current?.getBoundingClientRect();
        const clamp = (v: number, max: number) => Math.max(0, Math.min(v, Math.max(0, max)));
        setWindows((prev) =>
          prev.map((w) =>
            w.id === drag.id
              ? {
                  ...w,
                  docked: false,
                  z,
                  x: clamp(e.clientX - (layer?.left ?? 0) - 120, (layer?.width ?? 0) - 160),
                  y: clamp(e.clientY - (layer?.top ?? 0) - 16, (layer?.height ?? 0) - 80),
                }
              : w,
          ),
        );
        return;
      }

      const chips = [...bar.querySelectorAll<HTMLElement>('.dock-chip')];
      let target = -1;
      chips.forEach((chip, i) => {
        const box = chip.getBoundingClientRect();
        if (e.clientX > box.left + box.width / 2) target = i;
      });
      setWindows((prev) => {
        const from = prev.findIndex((w) => w.id === drag.id);
        const to = Math.max(0, Math.min(prev.length - 1, target));
        if (from < 0 || from === to) return prev;
        const next = [...prev];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        return next;
      });
    };
    const up = () => {
      chipDragRef.current = null;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  /**
   * El subespacio no toca `open`: es una vista aparte con el fichero y sus
   * relaciones directas, asi que al salir el arbol sigue como estaba.
   */
  const focus = useMemo<Subspace | null>(() => {
    if (!focusId) return null;
    const pivot = nodes.get(focusId);
    if (!pivot || pivot.kind !== 'file') return null;
    const pick = (ids: string[]) =>
      ids.map((id) => nodes.get(id)).filter((n): n is TreeNode => !!n && n.kind === 'file');
    return {
      pivot,
      incoming: pick((incoming.get(focusId) ?? []).map((e) => e.from)),
      outgoing: pick((outgoing.get(focusId) ?? []).map((e) => e.to)),
    };
  }, [focusId, nodes, incoming, outgoing]);

  const enterSubspace = useCallback((id: string) => {
    setFocusId(id);
    setSelectedId(id);
  }, []);

  const copyPath = useCallback((id: string) => {
    navigator.clipboard?.writeText(id.replace(/^dir:/, '')).catch(() => undefined);
  }, []);

  /** Menú del lienzo: cambia según haya debajo un fichero, una carpeta o nada. */
  const canvasMenu = useCallback(
    (id: string | null, x: number, y: number) => {
      const node = id ? nodes.get(id) : null;
      const items: MenuEntry[] = [];
      if (node?.kind === 'file') {
        items.push({ label: 'ver código', onClick: () => openCode(node.id) });
        if (/.(tsx|jsx)$/.test(node.id)) {
          items.push({ label: 'ver preview del componente', onClick: () => openCode(node.id, 'preview') });
        }
        items.push({ label: 'ver en subespacio', onClick: () => enterSubspace(node.id) });
        items.push({ label: 'seleccionar', onClick: () => setSelectedId(node.id) });
        items.push('sep');
        items.push({ label: 'centrar', onClick: () => canvasRef.current?.focus(node.id) });
        items.push({ label: 'copiar ruta', onClick: () => copyPath(node.id) });
      } else if (node?.kind === 'dir') {
        items.push({
          label: open.has(node.id) ? 'cerrar carpeta' : 'abrir carpeta',
          onClick: () => toggleOpen(node.id),
        });
        items.push({ label: 'abrir todo lo de dentro', onClick: () => openRecursive(node.id) });
        items.push('sep');
        items.push({ label: 'centrar', onClick: () => canvasRef.current?.focus(node.id) });
        items.push({ label: 'copiar ruta', onClick: () => copyPath(node.id) });
      } else {
        items.push({ label: 'encuadrar', onClick: () => canvasRef.current?.fit() });
        items.push({ label: 'colapsar todo', onClick: collapseAll, disabled: !!focus });
        items.push({ label: 'reordenar nodos movidos', onClick: () => canvasRef.current?.reorganize() });
        if (focus) {
          items.push('sep');
          items.push({ label: 'salir del subespacio', onClick: () => setFocusId(null) });
        }
      }
      setMenu({ x, y, items });
    },
    [nodes, open, focus, openCode, enterSubspace, toggleOpen, openRecursive, collapseAll, copyPath],
  );

  /** Menú de una ventana de código. */
  const windowMenu = useCallback(
    (id: string, x: number, y: number) => {
      const win = windows.find((w) => w.id === id);
      if (!win) return;
      const items: MenuEntry[] = [
        { label: 'minimizar a la barra', onClick: () => updateWindow({ ...win, docked: true }) },
        {
          label: win.focused ? 'salir de pantalla completa' : 'pantalla completa',
          onClick: () => updateWindow({ ...win, focused: !win.focused }),
        },
        { label: win.wrap ? 'quitar wrap' : 'activar wrap', onClick: () => updateWindow({ ...win, wrap: !win.wrap }) },
        {
          label: win.pinned ? 'soltar (dejar de fijar)' : 'fijar arriba de todo',
          onClick: () => updateWindow({ ...win, pinned: !win.pinned }),
        },
        'sep',
        {
          label: 'letra más grande',
          disabled: win.fontSize >= MAX_FONT,
          onClick: () => updateWindow({ ...win, fontSize: Math.min(MAX_FONT, win.fontSize + 1) }),
        },
        {
          label: 'letra más chica',
          disabled: win.fontSize <= MIN_FONT,
          onClick: () => updateWindow({ ...win, fontSize: Math.max(MIN_FONT, win.fontSize - 1) }),
        },
        'sep',
        { label: 'ver en el canvas', onClick: () => { setSelectedId(id); revealPath(id); } },
        { label: 'copiar ruta', onClick: () => copyPath(id) },
        { label: 'cerrar', onClick: () => closeCode(id) },
        {
          label: 'cerrar las demás',
          disabled: windows.length < 2,
          onClick: () => setWindows((prev) => prev.filter((w) => w.id === id)),
        },
      ];
      setMenu({ x, y, items });
    },
    [windows, updateWindow, closeCode, copyPath, revealPath],
  );

  const selected = selectedId ? nodes.get(selectedId) ?? null : null;
  const hovered = hoverId ? nodes.get(hoverId) ?? null : null;
  const panelNode = selected ?? (hovered?.kind === 'file' ? hovered : null);
  const canAct = !!selected && selected.kind === 'file';

  /** Atajos: la mano no tiene que ir al mouse para lo que se usa todo el rato. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if (e.key === 'Escape') {
        if (showSettings) {
          setShowSettings(false);
          return;
        }
        if (menu) {
          setMenu(null);
          return;
        }
        const full = windows.find((w) => w.focused && !w.docked);
        if (full) {
          updateWindow({ ...full, focused: false });
          return;
        }
        if (focusId) {
          setFocusId(null);
          return;
        }
        if (typing) target?.blur();
        else setSelectedId(null);
        return;
      }

      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === 'f') canvasRef.current?.fit();
      else if (e.key === 'c') collapseAll();
      else if (e.key === 'r') canvasRef.current?.reorganize();
      else if (e.key === 't') toggleTheme();
      else if (e.key === 'o' && canAct && selectedId) openCode(selectedId);
      else if (e.key === 's' && canAct && selectedId) enterSubspace(selectedId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    windows,
    focusId,
    menu,
    showSettings,
    collapseAll,
    toggleTheme,
    canAct,
    selectedId,
    openCode,
    enterSubspace,
    updateWindow,
  ]);

  const explorerPane = (
    <Pane
      key="explorer"
      title="explorador"
      side={panels.swapped ? 'right' : 'left'}
      collapsed={panels.explorer}
      onCollapse={() => collapsePanel('explorer')}
      onSwap={swapPanels}
    >
      {graph ? (
        <Explorer
          tree={graph.tree}
          open={effectiveOpen}
          filter={filter}
          selectedId={selectedId}
          matches={matches}
          onToggle={toggleOpen}
          onSelect={setSelectedId}
          onOpenCode={openCode}
          onMenu={canvasMenu}
        />
      ) : (
        <div className="ex-empty">abrí un proyecto para ver su árbol</div>
      )}
    </Pane>
  );

  const inspectorPane = (
    <Pane
      key="inspector"
      title="detalle"
      side={panels.swapped ? 'left' : 'right'}
      collapsed={panels.inspector}
      onCollapse={() => collapsePanel('inspector')}
      onSwap={swapPanels}
    >
      <Inspector
        node={panelNode}
        outgoing={panelNode ? outgoing.get(panelNode.id) ?? [] : []}
        incoming={panelNode ? incoming.get(panelNode.id) ?? [] : []}
        onSelect={(id) => {
          setSelectedId(id);
          if (focus) {
            enterSubspace(id);
            return;
          }
          revealPath(id);
          // El nodo puede aparecer recien tras abrir su carpeta: esperamos un tick.
          setTimeout(() => canvasRef.current?.focus(id), 60);
        }}
        onSubspace={panelNode?.kind === 'file' ? enterSubspace : undefined}
        onOpenCode={panelNode?.kind === 'file' ? openCode : undefined}
      />
    </Pane>
  );

  const [firstPane, lastPane] = panels.swapped
    ? [inspectorPane, explorerPane]
    : [explorerPane, inspectorPane];

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">corcho</span>
        <input
          className="path-input"
          value={pathInput}
          placeholder="C:\ruta\a\tu\proyecto"
          spellCheck={false}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void scan();
          }}
        />
        <button className="btn btn-primary" onClick={() => void scan()} disabled={loading}>
          {loading ? 'analizando…' : 'abrir'}
        </button>
        <button
          className="btn btn-icon"
          onClick={() => void scan(true)}
          disabled={loading || !graph}
          title="Re-analizar desde disco"
        >
          ↻
        </button>

        <span className="divider" />

        <div className="search-box">
          <input
            ref={searchRef}
            className="search"
            value={search}
            placeholder="filtrar ficheros…"
            spellCheck={false}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') canvasRef.current?.fit();
              if (e.key === 'Escape') setSearch('');
            }}
          />
          {search.trim() ? (
            <button className="search-clear" onClick={() => setSearch('')} title="Limpiar el filtro (Esc)">
              {matches.size} ✕
            </button>
          ) : (
            <span className="search-count">/</span>
          )}
        </div>

        <span className="divider" />

        <div className="segmented" title="Qué importaciones se dibujan">
          imports
          <div className="segmented-group">
            {EDGE_MODES.map((mode) => (
              <button
                key={mode.value}
                className={edgeMode === mode.value ? 'on' : ''}
                onClick={() => setEdgeMode(mode.value)}
                title={mode.title}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        <button className="btn" onClick={() => canvasRef.current?.fit()} disabled={!graph} title="Encuadrar (f)">
          encuadrar
        </button>
        <button
          className="btn"
          onClick={collapseAll}
          disabled={!graph || !!focus}
          title="Cerrar todas las carpetas (c)"
        >
          colapsar
        </button>
        <button
          className="btn"
          onClick={() => canvasRef.current?.reorganize()}
          disabled={!graph}
          title="Devolver los nodos movidos a su sitio (r)"
        >
          reordenar
        </button>

        <span className="divider" />

        <button
          className="btn btn-icon"
          onClick={toggleTheme}
          title={`Tema ${themeInfo(theme).label} · cambiar a ${themeInfo(nextTheme(theme)).label} (t)`}
        >
          {themeInfo(nextTheme(theme)).glyph}
        </button>
        <button
          className="btn btn-icon"
          onClick={() => setShowSettings(true)}
          title="Configuración: colores y trazo de las aristas"
        >
          ⚙
        </button>
      </header>

      {focus && (
        <div className="focus-bar">
          <span>
            subespacio · <b>{focus.pivot.id}</b> — {focus.incoming.length} lo usan · {focus.outgoing.length} usa
          </span>
          <span className="focus-hint">clic derecho en un vecino para saltar a su subespacio</span>
          <button className="btn" onClick={() => setFocusId(null)}>
            salir ✕
          </button>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <main className="body">
        {firstPane}

        {graph ? (
          <CanvasGraph
            ref={canvasRef}
            graph={graph}
            open={effectiveOpen}
            selectedId={selectedId}
            matches={matches}
            filter={filter}
            edgeMode={edgeMode}
            focus={focus}
            palette={paletteFor(theme, settings.colors[theme])}
            edgeShape={settings.edgeShape}
            onSelect={setSelectedId}
            onToggleOpen={toggleOpen}
            onHover={setHoverId}
            onOpenCode={openCode}
            onContextMenu={canvasMenu}
          />
        ) : (
          <div className="placeholder">
            <div className="empty-state">
              <h1>
                {loading ? 'analizando el proyecto…' : 'abrí un proyecto'}
                <span className="caret" />
              </h1>
              <p>
                {loading
                  ? 'Leyendo imports y resolviendo dependencias.'
                  : 'Escribí la ruta de la carpeta arriba y pulsá abrir. Se analiza en el momento y no se modifica nada en disco.'}
              </p>
              {!loading && (
                <div className="empty-keys">
                  <span>
                    <kbd>f</kbd> encuadrar
                  </span>
                  <span>
                    <kbd>c</kbd> colapsar
                  </span>
                  <span>
                    <kbd>/</kbd> buscar
                  </span>
                  <span>
                    <kbd>o</kbd> código
                  </span>
                  <span>
                    <kbd>s</kbd> subespacio
                  </span>
                  <span>
                    <kbd>t</kbd> tema
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
        {lastPane}

        <div className="windows-layer" ref={layerRef}>
          {windows.map((w) => (
            <CodeWindow
              key={w.id}
              state={w}
              exports={nodes.get(w.id)?.file?.exports ?? []}
              imports={outgoing.get(w.id) ?? []}
              dockRect={dockRect}
              onChange={updateWindow}
              onPatch={patchWindow}
              onClose={closeCode}
              onRaise={raiseCode}
              onOpenFile={openCode}
              onDockHint={setDockHot}
              onMenu={windowMenu}
            />
          ))}
        </div>
      </main>

      <div className={`dock${dockHot ? ' hot' : ''}${windows.length ? '' : ' empty'}`} ref={dockRef}>
        <span className="dock-label">ventanas</span>
        {windows.map((w) => (
          <span
            key={w.id}
            className={`dock-chip${w.docked ? '' : ' live'}${w.pinned ? ' pinned' : ''}`}
            title={`${w.id}\n${w.docked ? 'clic para restaurar' : 'clic para traer al frente'} · arrastrá para mover`}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              chipDragRef.current = { id: w.id, startX: e.clientX, startY: e.clientY, moved: false };
            }}
            onMouseUp={() => {
              const drag = chipDragRef.current;
              chipDragRef.current = null;
              if (drag?.moved) return;
              topZ.current += 1;
              updateWindow({ ...w, docked: false, z: topZ.current });
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              windowMenu(w.id, e.clientX, e.clientY);
            }}
          >
            <i className="chip-dot" />
            {baseName(w.id)}
            <button
              className="chip-x"
              title="Cerrar"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => closeCode(w.id)}
            >
              ✕
            </button>
          </span>
        ))}
        <span className="dock-hint">
          {windows.length ? 'arrastrá una ventana hasta acá para guardarla' : 'las ventanas de código se guardan acá'}
        </span>
      </div>

      <footer className="statusbar">
        {graph ? (
          <>
            <span>
              {graph.stats.files} ficheros · {graph.stats.edges} dependencias ·{' '}
              {graph.stats.loc.toLocaleString()} LOC · {graph.stats.ms} ms
            </span>
            {(graph.stats.languages ?? []).map((lang) => (
              <span key={lang.id} title={`${lang.files} ficheros analizados con ${lang.label}`}>
                {lang.label}: {lang.files}
              </span>
            ))}
            <span className="legend">
              <i className="swatch out" /> importa
            </span>
            <span className="legend">
              <i className="swatch in" /> lo importan
            </span>
            <span style={{ marginLeft: 'auto' }}>
              doble clic: código · clic derecho: menú · <kbd>f</kbd> <kbd>c</kbd> <kbd>/</kbd> <kbd>o</kbd>{' '}
              <kbd>s</kbd> <kbd>t</kbd> <kbd>Esc</kbd>
            </span>
          </>
        ) : (
          <span>sin proyecto abierto</span>
        )}
      </footer>

      {showSettings && (
        <SettingsPanel
          settings={settings}
          theme={theme}
          onChange={setSettings}
          onSelectTheme={selectTheme}
          onClose={() => setShowSettings(false)}
        />
      )}

      {menu && (
        <div
          className="ctx-backdrop"
          onMouseDown={() => setMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu(null);
          }}
        >
          <div
            className="ctx"
            style={{
              left: Math.min(menu.x, window.innerWidth - 230),
              top: Math.min(menu.y, window.innerHeight - menu.items.length * 26 - 20),
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {menu.items.map((item, i) =>
              item === 'sep' ? (
                <hr key={i} />
              ) : (
                <button
                  key={i}
                  disabled={item.disabled}
                  onClick={() => {
                    item.onClick();
                    setMenu(null);
                  }}
                >
                  {item.label}
                </button>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Envoltorio de los paneles laterales: se colapsan a un riel angosto y se
 * pueden intercambiar de lado entre ellos.
 */
function Pane({
  title,
  side,
  collapsed,
  onCollapse,
  onSwap,
  children,
}: {
  title: string;
  side: 'left' | 'right';
  collapsed: boolean;
  onCollapse: () => void;
  onSwap: () => void;
  children: React.ReactNode;
}) {
  if (collapsed) {
    return (
      <div className={`rail rail-${side}`}>
        <button className="rail-btn" onClick={onCollapse} title={`Desplegar ${title}`}>
          {side === 'left' ? '›' : '‹'}
        </button>
        <span className="rail-label">{title}</span>
      </div>
    );
  }
  return (
    <aside className={`pane pane-${side}`}>
      <div className="pane-head">
        <span className="pane-title">{title}</span>
        <button onClick={onSwap} title="Intercambiar los paneles de lado">
          ⇄
        </button>
        <button onClick={onCollapse} title={`Colapsar ${title}`}>
          {side === 'left' ? '‹' : '›'}
        </button>
      </div>
      <div className="pane-body">{children}</div>
    </aside>
  );
}
