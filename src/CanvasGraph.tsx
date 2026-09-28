import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Graph, TreeNode } from '../shared/types';
import { drawFile, drawFolder } from './icons';
import type { EdgeShape } from './settings';
import { corkPattern } from './cork';
import type { CanvasPalette } from './theme';
import {
  layoutSubspace,
  layoutTree,
  parentIndex,
  subtreeIds,
  type LayoutNode,
  type Offset,
  type Subspace,
} from './treeLayout';

export type EdgeMode = 'selection' | 'all' | 'none';

export interface CanvasHandle {
  fit: () => void;
  focus: (id: string) => void;
  reorganize: () => void;
}

interface Props {
  graph: Graph;
  open: Set<string>;
  selectedId: string | null;
  matches: Set<string>;
  /** Ids que sobreviven al filtro; null cuando no hay filtro activo. */
  filter: Set<string> | null;
  edgeMode: EdgeMode;
  /** Si viene, el canvas dibuja el subespacio en vez del arbol. */
  focus: Subspace | null;
  /** Colores del tema activo: el lienzo no lee variables CSS. */
  palette: CanvasPalette;
  /** Trazo de las dependencias: curvo o en ángulo recto. */
  edgeShape: EdgeShape;
  onSelect: (id: string | null) => void;
  onToggleOpen: (id: string) => void;
  onHover: (id: string | null) => void;
  /** Doble clic sobre un fichero. */
  onOpenCode: (id: string) => void;
  /** Clic derecho: id del nodo bajo el cursor, o null si fue sobre el fondo. */
  onContextMenu: (id: string | null, clientX: number, clientY: number) => void;
}

interface VisibleEdge {
  a: LayoutNode;
  b: LayoutNode;
  uses: number;
  count: number;
}

const LABEL_ROOM = 150;

export const CanvasGraph = forwardRef<CanvasHandle, Props>(function CanvasGraph(props, ref) {
  const {
    graph,
    open,
    selectedId,
    matches,
    filter,
    edgeMode,
    focus,
    palette,
    edgeShape,
    onSelect,
    onToggleOpen,
    onHover,
    onOpenCode,
    onContextMenu,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const sizeRef = useRef({ w: 1, h: 1 });
  const hoverRef = useRef<LayoutNode | null>(null);
  const dragRef = useRef<{ node: LayoutNode; startX: number; startY: number; baseDx: number; baseDy: number } | null>(
    null,
  );
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const pendingRef = useRef(false);
  const drawRef = useRef<() => void>(() => {});
  const treeOffsetsRef = useRef(new Map<string, Offset>());
  const subOffsetsRef = useRef(new Map<string, Offset>());
  const [version, setVersion] = useState(0);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string; flip?: boolean } | null>(null);

  const parents = useMemo(() => parentIndex(graph.tree), [graph]);
  const treeById = useMemo(() => {
    const map = new Map<string, TreeNode>();
    const walk = (node: TreeNode) => {
      map.set(node.id, node);
      node.children?.forEach(walk);
    };
    walk(graph.tree);
    return map;
  }, [graph]);

  // Cada vista recuerda por separado los nodos que moviste a mano.
  const offsets = focus ? subOffsetsRef.current : treeOffsetsRef.current;

  // `version` fuerza el recalculo cuando se arrastra un nodo o se reordena.
  const layout = useMemo(
    () => (focus ? layoutSubspace(focus, offsets) : layoutTree(graph.tree, open, offsets, filter)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, open, version, focus, offsets, filter],
  );

  const edges = useMemo(() => {
    const owner = (id: string): LayoutNode | null => {
      let cursor: string | null = id;
      while (cursor) {
        const node = layout.byId.get(cursor);
        if (node) return node;
        cursor = parents.get(cursor) ?? null;
      }
      return null;
    };
    const agg = new Map<string, VisibleEdge>();
    for (const edge of graph.edges) {
      const a = owner(edge.from);
      const b = owner(edge.to);
      if (!a || !b || a === b) continue;
      const key = `${a.id} ${b.id}`;
      const item = agg.get(key);
      if (item) {
        item.uses += edge.uses;
        item.count++;
      } else {
        agg.set(key, { a, b, uses: edge.uses, count: 1 });
      }
    }
    return [...agg.values()];
  }, [graph, layout, parents]);

  const schedule = useCallback(() => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    const run = () => {
      if (!pendingRef.current) return;
      pendingRef.current = false;
      drawRef.current();
    };
    requestAnimationFrame(run);
    // requestAnimationFrame no corre en pestanas ocultas: sin este respaldo el
    // canvas se queda en blanco hasta volver a primer plano.
    window.setTimeout(run, 120);
  }, []);

  const toWorld = (px: number, py: number) => {
    const { scale, tx, ty } = viewRef.current;
    return { x: (px - tx) / scale, y: (py - ty) / scale };
  };

  const fit = useCallback(() => {
    const { w, h } = sizeRef.current;
    const b = layout.bounds;
    const scale = Math.min(w / Math.max(b.w, 1), h / Math.max(b.h, 1)) * 0.92;
    const clamped = Math.min(1.6, Math.max(0.04, scale));
    viewRef.current = {
      scale: clamped,
      tx: w / 2 - (b.x + b.w / 2) * clamped,
      ty: h / 2 - (b.y + b.h / 2) * clamped,
    };
    schedule();
  }, [layout, schedule]);

  // Ojo: `focus` (la prop) es el subespacio; esto mueve la camara a un nodo.
  const focusOn = useCallback(
    (id: string) => {
      const node = layout.byId.get(id);
      if (!node) return;
      const { w, h } = sizeRef.current;
      const scale = Math.max(viewRef.current.scale, 0.8);
      viewRef.current = {
        scale,
        tx: w / 2 - (node.x + LABEL_ROOM / 2) * scale,
        ty: h / 2 - node.y * scale,
      };
      schedule();
    },
    [layout, schedule],
  );

  const reorganize = useCallback(() => {
    if (focus) subOffsetsRef.current = new Map();
    else treeOffsetsRef.current = new Map();
    setVersion((v) => v + 1);
  }, [focus]);

  useImperativeHandle(ref, () => ({ fit, focus: focusOn, reorganize }), [fit, focusOn, reorganize]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const { w: vw, h: vh } = sizeRef.current;
    const { scale, tx, ty } = viewRef.current;

    if (canvas.width !== Math.round(vw * dpr) || canvas.height !== Math.round(vh * dpr)) {
      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = palette.texture === 'cork' ? corkPattern(ctx, palette.bg) : palette.bg;
    ctx.fillRect(0, 0, vw, vh);

    const sx = (x: number) => x * scale + tx;
    const sy = (y: number) => y * scale + ty;

    // Al arrastrar, el subárbol entero viaja con el nodo: se marca para que
    // se vea qué se está moviendo antes de soltar.
    const draggingId = dragRef.current?.node.id ?? null;
    const draggingNode = draggingId ? treeById.get(draggingId) : null;
    const draggingTree = draggingNode ? subtreeIds(draggingNode) : null;

    const active =
      hoverRef.current ??
      (selectedId ? layout.byId.get(selectedId) ?? null : null) ??
      (focus ? layout.byId.get(focus.pivot.id) ?? null : null);
    const activeTree = active ? subtreeIds(treeById.get(active.id) ?? active.node) : null;
    // Quien queda a plena luz: el subarbol activo y lo que se conecta con el.
    const related = new Set<string>();
    if (activeTree) {
      for (const id of activeTree) related.add(id);
      for (const edge of edges) {
        if (activeTree.has(edge.a.id)) related.add(edge.b.id);
        else if (activeTree.has(edge.b.id)) related.add(edge.a.id);
      }
    }

    /** Recorta un texto con puntos suspensivos para que entre en `room` px. */
    const fitText = (text: string, room: number) => {
      if (ctx.measureText(text).width <= room) return text;
      let cut = text;
      while (cut.length > 1 && ctx.measureText(cut + '…').width > room) cut = cut.slice(0, -1);
      return cut + '…';
    };

    // --- grupos por directorio (solo en el subespacio) ---
    for (const group of layout.groups) {
      const top = sy(group.y0 - 20);
      const bottom = sy(group.y1 + 20);
      const left = sx(group.side === 'left' ? group.x - LABEL_ROOM - 24 : group.x - 26);
      const right = sx(group.side === 'left' ? group.x + 26 : group.x + LABEL_ROOM + 24);
      ctx.beginPath();
      ctx.roundRect(left, top, right - left, bottom - top, 8);
      ctx.fillStyle = palette.groupFill;
      ctx.fill();
      ctx.strokeStyle = palette.groupStroke;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      const size = Math.min(12, Math.max(8, 11 * scale));
      ctx.font = `700 ${size}px ${palette.font}`;
      ctx.fillStyle = palette.groupText;
      ctx.textAlign = group.side === 'left' ? 'right' : 'left';
      ctx.fillText(fitText(group.label, right - left - 12), group.side === 'left' ? right - 8 : left + 8, top - 5);
      ctx.textAlign = 'left';
    }

    // --- conectores de jerarquia: recto, en angulo, estilo explorador ---
    ctx.lineWidth = 2;
    for (const node of layout.nodes) {
      if (!node.children.length) continue;
      const moving = !!draggingTree && draggingTree.has(node.id);
      ctx.strokeStyle = moving ? palette.edgeOut : palette.link;
      ctx.lineWidth = moving ? 2.5 : 2;
      // La linea baja (o sube) por debajo del icono, nunca por la etiqueta.
      const bus = sx(node.x);
      const py = sy(node.y);
      const half = node.r * scale;
      for (const child of node.children) {
        const cx = sx(child.x) - child.r * scale;
        const cy = sy(child.y);
        const startY = cy < py ? py - half : py + half;
        const radius = Math.min(9, Math.abs(cy - startY) / 2, Math.abs(cx - bus) / 2);
        ctx.beginPath();
        ctx.moveTo(bus, startY);
        if (radius > 0.5) {
          ctx.arcTo(bus, cy, cx, cy, radius);
          ctx.lineTo(cx, cy);
        } else {
          ctx.lineTo(bus, cy);
          ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }
    }

    // --- imports ---
    const showAll = focus ? true : edgeMode === 'all';
    if (focus || edgeMode !== 'none') {
      /**
      * Cada nodo origen recibe su propio carril vertical. Sin esto todas las
      * aristas ortogonales bajaban por la misma columna y se tapaban entre sí:
      * se veían tres líneas donde había quince.
      */
      const lanes = new Map<string, number>();
      const sources = [...new Set(edges.map((e) => e.a.id))].sort((x, y) => {
        const a = layout.byId.get(x);
        const b = layout.byId.get(y);
        return (a?.x ?? 0) - (b?.x ?? 0) || (a?.y ?? 0) - (b?.y ?? 0);
      });
      sources.forEach((id, index) => lanes.set(id, index % 7));

      const paint = (edge: VisibleEdge, mode: 'out' | 'in' | null) => {
        const ax = sx(edge.a.x);
        const ay = sy(edge.a.y);
        const bx = sx(edge.b.x);
        const by = sy(edge.b.y);
        const ra = edge.a.r * scale;
        const rb = edge.b.r * scale;
        let endX: number;
        let ang: number;

        ctx.beginPath();
        if (edgeShape === 'orthogonal') {
          // Tramos rectos por un canal vertical. Si origen y destino están casi
          // en la misma columna, el canal se corre a la derecha de los dos para
          // que la línea no caiga encima de los iconos.
          const gap = bx - ax;
          // El carril separa las calles; la vuelta atrás usa media calle más
          // para no montarse sobre la ida entre el mismo par de nodos.
          const lane = (lanes.get(edge.a.id) ?? 0) + (bx < ax ? 0.5 : 0);
          const spread = (26 + lane * 15) * Math.min(1.6, Math.max(0.4, scale));
          const channel =
            Math.abs(gap) < 80 * scale ? Math.max(ax, bx) + spread : ax + gap * 0.5 + lane * 9 * scale;
          const startX = channel > ax ? ax + ra : ax - ra;
          endX = channel > bx ? bx + rb : bx - rb;
          ang = endX < channel ? Math.PI : 0;
          const radius = Math.min(
            10,
            Math.abs(by - ay) / 2,
            Math.abs(channel - startX) / 2,
            Math.abs(endX - channel) / 2,
          );
          ctx.moveTo(startX, ay);
          if (radius > 1) {
            ctx.arcTo(channel, ay, channel, by, radius);
            ctx.arcTo(channel, by, endX, by, radius);
            ctx.lineTo(endX, by);
          } else {
            ctx.lineTo(channel, ay);
            ctx.lineTo(channel, by);
            ctx.lineTo(endX, by);
          }
        } else {
          const lane = lanes.get(edge.a.id) ?? 0;
          const bulge =
            Math.max(60, Math.abs(by - ay) * 0.35) *
            Math.min(1.4, Math.max(0.35, scale)) *
            (1 + lane * 0.1);
          const forward = bx >= ax;
          const c1x = ax + bulge;
          const c2x = forward ? bx - bulge : bx + bulge;
          endX = forward ? bx - rb : bx + rb;
          ang = forward ? 0 : Math.PI;
          ctx.moveTo(ax + ra, ay);
          ctx.bezierCurveTo(c1x, ay, c2x, by, endX, by);
        }
        ctx.lineWidth = Math.min(4, 1.4 + Math.log2(1 + edge.uses) * 0.45);
        if (mode === 'out') ctx.strokeStyle = palette.edgeOut;
        else if (mode === 'in') ctx.strokeStyle = palette.edgeIn;
        else ctx.strokeStyle = palette.edge;
        // Solo las resaltadas: la sombra en canvas es cara y son pocas.
        const lifted = !!mode && !!palette.stringShadow;
        if (lifted) {
          ctx.shadowColor = palette.stringShadow!;
          ctx.shadowOffsetY = 1.5;
          ctx.shadowBlur = 2;
        }
        ctx.lineCap = 'round';
        ctx.stroke();
        if (lifted) {
          ctx.shadowColor = 'transparent';
          ctx.shadowOffsetY = 0;
          ctx.shadowBlur = 0;
        }

        if (mode) {
          const size = 8;
          ctx.beginPath();
          ctx.moveTo(endX, by);
          ctx.lineTo(endX - size * Math.cos(ang - 0.42), by - size * Math.sin(ang - 0.42));
          ctx.lineTo(endX - size * Math.cos(ang + 0.42), by - size * Math.sin(ang + 0.42));
          ctx.closePath();
          ctx.fillStyle = ctx.strokeStyle as string;
          ctx.fill();
        }
      };

      const hot: { edge: VisibleEdge; mode: 'out' | 'in' }[] = [];
      for (const edge of edges) {
        let mode: 'out' | 'in' | null = null;
        if (activeTree) {
          if (activeTree.has(edge.a.id)) mode = 'out';
          else if (activeTree.has(edge.b.id)) mode = 'in';
        }
        if (mode) hot.push({ edge, mode });
        else if (showAll) paint(edge, null);
      }
      for (const { edge, mode } of hot) paint(edge, mode);
    }

    // --- nodos ---
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const node of layout.nodes) {
      const x = sx(node.x);
      const y = sy(node.y);
      const r = node.r * scale;
      if (x + r < -LABEL_ROOM * scale || y + r < -30 || x - r > vw + 30 || y - r > vh + 30) continue;

      const dim = related.size > 0 && !related.has(node.id);
      ctx.globalAlpha = dim ? 0.42 : 1;

      if (node.node.kind === 'dir') drawFolder(ctx, x, y, r, open.has(node.id), palette.ink);
      else drawFile(ctx, x, y, r, node.node.name, palette.ink);

      if (node.id === selectedId || node === active || matches.has(node.id)) {
        ctx.beginPath();
        ctx.arc(x, y, r * 1.5, 0, Math.PI * 2);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = matches.has(node.id) ? palette.match : palette.ring;
        ctx.stroke();
      }
      if (offsets.has(node.id)) {
        if (palette.pushpin) drawPushpin(ctx, x + r * 0.15, y - r * 1.05, Math.max(3, r * 0.3), palette.pin);
        else {
          ctx.beginPath();
          ctx.arc(x + r, y - r, Math.max(2, r * 0.18), 0, Math.PI * 2);
          ctx.fillStyle = palette.pin;
          ctx.fill();
        }
      }

      const fontSize = Math.min(13, Math.max(8, r * 0.72));
      if (r > 5) {
        ctx.font = `${node.node.kind === 'dir' ? '700 ' : ''}${fontSize}px ${palette.font}`;
        ctx.fillStyle = dim ? palette.labelDim : palette.label;
        const room = LABEL_ROOM * scale;
        /** Escribe la etiqueta, sobre un papelito si el tema lo pide. */
        const write = (text: string, tx: number, ty: number, align: CanvasTextAlign, color: string) => {
          ctx.textAlign = align;
          if (palette.labelTag) {
            const w = ctx.measureText(text).width;
            const h = fontSize + 6;
            const left = align === 'right' ? tx - w - 4 : align === 'center' ? tx - w / 2 - 4 : tx - 4;
            ctx.beginPath();
            ctx.roundRect(left, ty - h / 2, w + 8, h, 3);
            ctx.fillStyle = palette.labelTag;
            ctx.fill();
            if (palette.labelTagEdge) {
              ctx.strokeStyle = palette.labelTagEdge;
              ctx.lineWidth = 1;
              ctx.stroke();
            }
          }
          ctx.fillStyle = color;
          ctx.fillText(text, tx, ty);
        };

        const color = dim ? palette.labelDim : palette.label;
        if (node.sublabel) {
          // El pivote lleva el nombre debajo del icono: a los costados le entran
          // las flechas y el texto quedaria tachado.
          write(fitText(node.label, room), x, y + r * 1.5 + fontSize * 0.6, 'center', color);
          ctx.font = `${fontSize * 0.82}px ${palette.font}`;
          write(fitText(node.sublabel, room), x, y + r * 1.5 + fontSize * 1.9, 'center', palette.labelMuted);
        } else {
          const side = node.labelSide === 'left';
          write(fitText(node.label, room), side ? x - r * 1.35 : x + r * 1.35, y, side ? 'right' : 'left', color);
        }
        ctx.textAlign = 'left';
      }
      ctx.globalAlpha = 1;
    }
    ctx.textBaseline = 'alphabetic';
  }, [layout, edges, treeById, open, matches, selectedId, edgeMode, focus, offsets, palette, edgeShape]);

  drawRef.current = draw;

  useEffect(() => {
    schedule();
  }, [draw, schedule]);

  useEffect(() => {
    fit();
    // Al cambiar de proyecto o al entrar/salir del subespacio. Abrir carpetas
    // no debe mover la camara.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Tambien al filtrar: el arbol cambia de tamano y hay que reencuadrar.
  }, [graph, focus, filter]);

  // `fit` se recrea con cada layout nuevo. Si este efecto dependiera de ella,
  // arrastrar un nodo lo re-suscribiria en cada frame y volveria a encuadrar:
  // la vista pegaba un salto de zoom mientras movias el nodo.
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const measuredRef = useRef(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      sizeRef.current = { w: Math.max(1, rect.width), h: Math.max(1, rect.height) };
      // Solo la primerisima medida encuadra; las demas se limitan a repintar.
      if (!measuredRef.current) {
        measuredRef.current = true;
        fitRef.current();
      } else {
        schedule();
      }
    };
    // Medimos ya mismo: el ResizeObserver tarda un frame, y en una pestana
    // oculta puede no llegar nunca, dejando el canvas del tamano por defecto.
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [schedule]);

  const localPoint = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { x, y } = localPoint(e);
      const view = viewRef.current;
      const next = Math.min(20, Math.max(0.03, view.scale * Math.exp(-e.deltaY * 0.0015)));
      const k = next / view.scale;
      viewRef.current = { scale: next, tx: x - (x - view.tx) * k, ty: y - (y - view.ty) * k };
      schedule();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [schedule]);

  /** Nodo bajo el cursor: cuenta el icono y la etiqueta que va a su derecha. */
  const nodeAt = (wx: number, wy: number): LayoutNode | null => {
    for (const node of layout.nodes) {
      if (wy < node.y - node.r || wy > node.y + node.r) continue;
      const left = node.x - node.r - (node.labelSide === 'left' ? LABEL_ROOM : 0);
      const right = node.x + node.r + (node.labelSide === 'right' ? LABEL_ROOM : 0);
      if (wx < left || wx > right) continue;
      return node;
    }
    return null;
  };

  const handleMove = (e: React.MouseEvent) => {
    const { x, y } = localPoint(e);

    const drag = dragRef.current;
    if (drag) {
      const world = toWorld(x, y);
      offsets.set(drag.node.id, {
        dx: drag.baseDx + (world.x - drag.startX),
        dy: drag.baseDy + (world.y - drag.startY),
      });
      movedRef.current = true;
      setTooltip(null);
      setVersion((v) => v + 1);
      return;
    }

    const pan = panRef.current;
    if (pan) {
      viewRef.current = {
        ...viewRef.current,
        tx: viewRef.current.tx + (x - pan.x),
        ty: viewRef.current.ty + (y - pan.y),
      };
      panRef.current = { x, y };
      movedRef.current = true;
      setTooltip(null);
      schedule();
      return;
    }

    const world = toWorld(x, y);
    const node = nodeAt(world.x, world.y);
    if (canvasRef.current) canvasRef.current.style.cursor = node ? 'grab' : 'default';
    if (node !== hoverRef.current) {
      hoverRef.current = node;
      onHover(node?.node.id ?? null);
      schedule();
    }
    if (node) {
      const info = node.node;
      const detail =
        info.kind === 'file'
          ? `${info.file?.loc ?? 0} LOC · ${info.file?.exports.length ?? 0} exports`
          : `${info.children?.length ?? 0} elementos · ${open.has(info.id) ? 'abierta' : 'cerrada'}`;
      // Cerca del borde derecho el tooltip se ancla al otro lado del cursor.
      setTooltip({ x, y, flip: x > sizeRef.current.w - 260, text: `${info.kind === 'dir' ? info.name + '/' : info.id}\n${detail}` });
    } else {
      setTooltip(null);
    }
  };

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
        onMouseDown={(e) => {
          const { x, y } = localPoint(e);
          const world = toWorld(x, y);
          const node = nodeAt(world.x, world.y);
          movedRef.current = false;
          if (node) {
            if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
            const offset = offsets.get(node.id);
            dragRef.current = {
              node,
              startX: world.x,
              startY: world.y,
              baseDx: offset?.dx ?? 0,
              baseDy: offset?.dy ?? 0,
            };
          } else {
            panRef.current = { x, y };
          }
        }}
        onMouseMove={handleMove}
        onMouseUp={() => {
          const drag = dragRef.current;
          dragRef.current = null;
          panRef.current = null;
          if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
          // Repintar sin el resaltado de arrastre.
          if (drag && movedRef.current) setVersion((v) => v + 1);
          if (movedRef.current || !drag) return;
          if (drag.node.node.kind === 'dir') onToggleOpen(drag.node.id);
          else onSelect(drag.node.id);
        }}
        onMouseLeave={() => {
          dragRef.current = null;
          panRef.current = null;
          setTooltip(null);
          if (hoverRef.current) {
            hoverRef.current = null;
            onHover(null);
            schedule();
          }
        }}
        onDoubleClick={(e) => {
          const { x, y } = localPoint(e);
          const world = toWorld(x, y);
          const node = nodeAt(world.x, world.y);
          if (!node) return;
          // Doble clic sobre un fichero: se abre su codigo. Sobre una carpeta,
          // el nodo movido vuelve a su sitio en el arbol.
          if (node.node.kind === 'file') onOpenCode(node.id);
          else if (offsets.delete(node.id)) setVersion((v) => v + 1);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const { x, y } = localPoint(e);
          const world = toWorld(x, y);
          const node = nodeAt(world.x, world.y);
          if (node) onSelect(node.node.kind === 'file' ? node.id : null);
          onContextMenu(node?.id ?? null, e.clientX, e.clientY);
        }}
      />
      {tooltip && (
        <div
          className="tooltip"
          style={
            tooltip.flip
              ? { right: sizeRef.current.w - tooltip.x + 14, top: tooltip.y + 14 }
              : { left: tooltip.x + 14, top: tooltip.y + 14 }
          }
        >
          {tooltip.text.split('\n').map((line, i) => (
            <div key={i} className={i ? 'tooltip-sub' : 'tooltip-main'}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

/** Chinche vista desde arriba: sombra corrida, cabeza de color y un brillo. */
function drawPushpin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.beginPath();
  ctx.ellipse(x + r * 0.35, y + r * 0.45, r, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(40, 20, 5, 0.35)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.strokeStyle = 'rgba(40, 10, 5, 0.6)';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.fill();
}
