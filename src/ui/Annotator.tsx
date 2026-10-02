import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import * as Y from 'yjs';
import { t as current, useT, type Key } from '../i18n';
import '../i18n/lazy/annotator';
import {
  addShape,
  deleteShape,
  MARKUP_FORMAT_VERSION,
  MAX_TEXT,
  markupOrigin,
  parseMarkupKey,
  PHOTO_MARKUP_MAP,
  readFrame,
  readShape,
  touchedFileIds,
  updateShape,
  type MarkupFrame,
  type MarkupShape,
  type ShapeFields,
} from '../media/markup';
import {
  boxShape,
  controlsOf,
  dragLine,
  dragRect,
  fromFrame,
  handleFields,
  handlesOf,
  hitTest,
  lineShape,
  MAX_FONT,
  MAX_WIDTH,
  MIN_FONT,
  moved,
  moveFields,
  newShapeId,
  nextNumber,
  numberShape,
  PALETTE,
  pushRecent,
  restyleFields,
  roughMeasure,
  shapeBounds,
  shapesInRect,
  simplify,
  SLIDER_MAX_WIDTH,
  strokeShape,
  styleOfShape,
  textEdit,
  textShape,
  toFrame,
  toolOf,
  TOOL_LETTERS,
  TOOLS,
  topZ,
  unionBounds,
  type DrawTool,
  type Handle,
  type Measure,
  type Point,
  type Tool,
  type ToolStyle,
} from '../media/markupEdit';
import { limitState, measureLimits, type MarkupLimits } from '../media/markupLimits';
import { annotatorKey, type AnnotatorAction } from './annotatorKeys';
import { loadPrefs, savePrefs, type AnnotatorPrefs } from './annotatorStyles';
import { fitSize, NO_ZOOM, panBy, wheelScale, zoomAt, type Size, type Zoom } from './carreteModel';
import { isOffline, type CarreteLoader } from './carreteLoader';
import type { CarreteItem } from './carreteModel';
import {
  ArrowToolIcon,
  EllipseToolIcon,
  FitIcon,
  LineToolIcon,
  MarkerToolIcon,
  NumberToolIcon,
  PencilToolIcon,
  RectToolIcon,
  RedoIcon,
  SelectToolIcon,
  TextToolIcon,
  TrashIcon,
  UndoIcon,
} from './icons';
import { drawMarkup, MARKUP_FONT, markupMeasure } from './markupSvg';
import { notify } from './notice';
import { IS_MAC, shortcutLabel } from './shortcuts';

// El anotador de fotos en la compu (P.20, entrega 2; Docs/Doc_Anotar_Fotos.md, sección 2). A pantalla completa, como
// el carrete: arriba las nueve herramientas de FrameRev (con sus letras), deshacer, rehacer y *Done*; debajo, la franja
// de propiedades de la herramienta o de lo elegido; en el medio la foto con sus anotaciones.
//
// Las reglas que manda el diseño:
//   - Todo va al mapa `photoMarkup` del documento de la página (media/markup.ts), con UNA CLAVE POR FORMA y una
//     propiedad por clave: mover escribe `posX`/`posY`, cambiar el color escribe el color. Nada de bloques nuevos.
//   - Se escribe AL SOLTAR, nunca en cada cuadro de un arrastre: mientras se arrastra, la forma vive solo en esta
//     pantalla (`draft` y `patches`). Lo pisado deja huecos para siempre en la base limpia (sección 10).
//   - Deshacer es de esta foto en esta sesión: un `Y.UndoManager` que sigue solo el origen `sd-markup:<fileId>` (lo de
//     otro, el texto de la página y la poda no se deshacen acá).
//   - Topes en bytes codificados (markupLimits.ts): al tope, las herramientas de crear se apagan.
//   - Solo lo abre quien puede editar la página (PageEditor.tsx); un marco de una versión más nueva lo abre en solo
//     lectura.

const TOOL_LABELS: Record<Tool, Key> = {
  select: 'annotate.select',
  rectangle: 'annotate.rectangle',
  ellipse: 'annotate.ellipse',
  arrow: 'annotate.arrow',
  line: 'annotate.line',
  pencil: 'annotate.pencil',
  marker: 'annotate.marker',
  text: 'annotate.text',
  number: 'annotate.number',
};

const TOOL_SHORTCUTS: Record<Tool, string> = {
  select: 'annotateSelect',
  rectangle: 'annotateRectangle',
  ellipse: 'annotateEllipse',
  arrow: 'annotateArrow',
  line: 'annotateLine',
  pencil: 'annotatePencil',
  marker: 'annotateMarker',
  text: 'annotateText',
  number: 'annotateNumber',
};

const TOOL_ICONS: Record<Tool, (p: { size?: number }) => ReactNode> = {
  select: SelectToolIcon,
  rectangle: RectToolIcon,
  ellipse: EllipseToolIcon,
  arrow: ArrowToolIcon,
  line: LineToolIcon,
  pencil: PencilToolIcon,
  marker: MarkerToolIcon,
  text: TextToolIcon,
  number: NumberToolIcon,
};

/** En píxeles de pantalla: cuánto se acepta errarle a una forma, un tirador, y cuánto hay que mover para arrastrar. */
const HIT_PX = 6;
const HANDLE_PX = 9;
const SLOP_PX = 3;

type Drag =
  | { mode: 'draw'; tool: 'rectangle' | 'ellipse' | 'arrow' | 'line'; pointerId: number; start: Point; current: Point; shift: boolean; alt: boolean }
  | { mode: 'stroke'; tool: 'pencil' | 'marker'; pointerId: number; points: number[] }
  | { mode: 'number'; pointerId: number; at: Point }
  | { mode: 'move'; pointerId: number; ids: string[]; start: Point; current: Point; hit: string; shift: boolean }
  | { mode: 'handle'; pointerId: number; id: string; handle: Handle; current: Point; shift: boolean }
  | { mode: 'band'; pointerId: number; start: Point; current: Point; add: boolean }
  | { mode: 'pan'; pointerId: number; lastX: number; lastY: number };

interface TextEditing {
  /** La forma que se edita, o `null`: un texto nuevo. */
  id: string | null;
  /** Dónde empieza la primera letra (en el marco). */
  at: Point;
  value: string;
  fontSize: number;
  color: string;
  fill: boolean;
}

export interface AnnotatorProps {
  doc: Y.Doc;
  fileId: string;
  /** El nombre de la foto (para el rótulo). */
  name: string;
  /** La foto como la ve el carrete (para pedir la miniatura y la grande). */
  item: CarreteItem;
  loader: Pick<CarreteLoader, 'preview' | 'full'>;
  onClose: () => void;
}

interface ImageState {
  preview: string | null;
  /** Ya se pidió la vista previa (y vino lo que hay). */
  previewTried: boolean;
  full: string | null;
  /** El original no se pudo pedir o mostrar. */
  fullFailed: boolean;
  natural: Size | null;
  fullShown: boolean;
  /** Sin red, se ve la vista previa (el original no está en el dispositivo). */
  offline: boolean;
}

/** Las formas de la foto, con lo que se está arrastrando encima (sin escribir). */
function readShapes(map: Y.Map<unknown>, fileId: string, frame: MarkupFrame, patches: ReadonlyMap<string, ShapeFields>): MarkupShape[] {
  const out: MarkupShape[] = [];
  const prefix = `${fileId}/`;
  map.forEach((value, key) => {
    if (!key.startsWith(prefix)) return;
    const parsed = parseMarkupKey(key);
    if (!parsed?.shapeId) return;
    const patch = patches.get(parsed.shapeId);
    const raw = patch ? { ...(value instanceof Y.Map ? (value.toJSON() as Record<string, unknown>) : (value as Record<string, unknown>)), ...patch } : value;
    const shape = readShape(parsed.shapeId, raw, frame);
    if (shape) out.push(shape);
  });
  return out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function Annotator({ doc, fileId, name, item, loader, onClose }: AnnotatorProps) {
  const tr = useT();
  const map = useMemo(() => doc.getMap<unknown>(PHOTO_MARKUP_MAP), [doc]);
  const origin = markupOrigin(fileId);
  const [prefs, setPrefs] = useState<AnnotatorPrefs>(() => loadPrefs());
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [tool, setToolState] = useState<Tool>(() => prefs.tool);
  /** La última herramienta de dibujar (la que cambian `[` `]` con Select y nada elegido). */
  const lastDraw = useRef<DrawTool>(prefs.tool === 'select' ? 'arrow' : prefs.tool);
  const [selection, setSelection] = useState<string[]>([]);
  const [version, setVersion] = useState(0);
  const [patches, setPatches] = useState<Map<string, ShapeFields>>(() => new Map());
  const [, setTick] = useState(0);
  const [zoom, setZoom] = useState<Zoom>(NO_ZOOM);
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 });
  const [image, setImage] = useState<ImageState>({ preview: null, previewTried: false, full: null, fullFailed: false, natural: null, fullShown: false, offline: false });
  /** No hay nada de la foto en el dispositivo (ni miniatura ni original): no se puede anotar. */
  const missing = image.previewTried && !image.preview && image.fullFailed;
  const [stacks, setStacks] = useState({ undo: false, redo: false });
  const [limits, setLimits] = useState<MarkupLimits | null>(null);
  const [text, setText] = useState<TextEditing | null>(null);
  const [numberEdit, setNumberEdit] = useState<{ id: string; value: string } | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [panning, setPanning] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const shapesRef = useRef<SVGSVGElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<Drag | null>(null);
  const undo = useRef<Y.UndoManager | null>(null);
  const spaceHeld = useRef(false);
  const measureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measure: Measure = useMemo(() => markupMeasure() ?? roughMeasure, []);

  // --- el marco, las formas y los topes ------------------------------------------------------------------

  const stored = readFrame(map.get(fileId));
  const frame: MarkupFrame | null = stored ?? (image.natural ? { v: MARKUP_FORMAT_VERSION, w: image.natural.width, h: image.natural.height } : null);
  const readOnly = !!stored && stored.v > MARKUP_FORMAT_VERSION;
  // `version` cambia con cada cambio de las formas de esta foto: las vuelve a leer.
  const shapes = useMemo(() => (frame ? readShapes(map, fileId, frame, patches) : []), [map, fileId, frame?.w, frame?.h, patches, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(shapes.map((s) => [s.id, s])), [shapes]);
  const selected = useMemo(() => selection.map((id) => byId.get(id)).filter((s): s is MarkupShape => !!s), [selection, byId]);
  const limit = limits ? limitState(limits) : { state: 'ok' as const, which: null };
  const canCreate = !readOnly && !!frame && !missing && limit.state !== 'full';
  const canEdit = !readOnly && !!frame;

  const fit = frame ? fitSize({ width: frame.w, height: frame.h }, stage) : { width: 0, height: 0 };
  /** Píxeles de pantalla por unidad del marco (con el zoom). */
  const pxPerUnit = frame && fit.width > 0 ? (fit.width * zoom.scale) / frame.w : 1;

  const remeasure = useCallback(() => {
    if (measureTimer.current) clearTimeout(measureTimer.current);
    measureTimer.current = setTimeout(() => {
      measureTimer.current = null;
      setLimits(measureLimits(doc, fileId));
    }, 0);
  }, [doc, fileId]);

  useEffect(() => {
    setLimits(measureLimits(doc, fileId));
    return () => {
      if (measureTimer.current) clearTimeout(measureTimer.current);
    };
  }, [doc, fileId]);

  // Los cambios de esta foto (propios, de otro editor, de deshacer) se vuelven a leer.
  useEffect(() => {
    const onChange = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
      if (touchedFileIds(events, map).has(fileId)) setVersion((n) => n + 1);
    };
    map.observeDeep(onChange);
    return () => map.unobserveDeep(onChange);
  }, [map, fileId]);

  // Lo elegido que ya no está (lo borró otro, se deshizo) deja de estar elegido.
  useEffect(() => {
    if (selection.some((id) => !byId.has(id))) setSelection((sel) => sel.filter((id) => byId.has(id)));
  }, [byId, selection]);

  // Deshacer propio de esta foto en esta sesión.
  useEffect(() => {
    const um = new Y.UndoManager(map, { trackedOrigins: new Set([origin]), captureTimeout: 0 });
    const update = () => setStacks({ undo: um.undoStack.length > 0, redo: um.redoStack.length > 0 });
    um.on('stack-item-added', update);
    um.on('stack-item-popped', update);
    um.on('stack-cleared', update);
    undo.current = um;
    return () => {
      undo.current = null;
      um.destroy();
    };
  }, [map, origin]);

  // --- la foto ------------------------------------------------------------------------------------------

  useEffect(() => {
    let alive = true;
    loader.preview(item).then(
      (p) => alive && setImage((s) => ({ ...s, preview: p.preview, previewTried: true })),
      () => alive && setImage((s) => ({ ...s, previewTried: true })),
    );
    loader.full(item).then(
      (f) => alive && setImage((s) => ({ ...s, full: f.url })),
      // Sin el original: se anota sobre la vista previa (las coordenadas son las del marco, no las de lo que se ve).
      (err: unknown) => alive && setImage((s) => ({ ...s, fullFailed: true, offline: isOffline(err) || s.offline })),
    );
    return () => {
      alive = false;
    };
  }, [loader, item]);

  const onNatural = (e: { currentTarget: HTMLImageElement }, full: boolean) => {
    const img = e.currentTarget;
    if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) return;
    const natural = { width: img.naturalWidth, height: img.naturalHeight };
    setImage((s) => ({ ...s, natural: full || !s.natural ? natural : s.natural, fullShown: s.fullShown || full }));
  };

  // --- abrir y cerrar (como el carrete: lo de atrás inerte, el foco adentro y de vuelta al cerrar) ---------------

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    const dialog = dialogRef.current;
    const inerted = [...document.body.children].filter((el) => el !== dialog && !el.hasAttribute('inert') && !el.contains(dialog));
    for (const el of inerted) el.setAttribute('inert', '');
    dialog?.focus({ preventScroll: true });
    return () => {
      root.style.overflow = overflow;
      for (const el of inerted) el.removeAttribute('inert');
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measureStage = () => setStage({ width: el.clientWidth, height: el.clientHeight });
    measureStage();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureStage);
      return () => window.removeEventListener('resize', measureStage);
    }
    const observer = new ResizeObserver(measureStage);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // --- escribir -----------------------------------------------------------------------------------------

  /** Una escritura del anotador: una transacción con el origen de la foto (un paso de deshacer). */
  const write = useCallback(
    (fn: () => void) => {
      if (readOnly) return;
      doc.transact(fn, origin);
      remeasure();
    },
    [doc, origin, readOnly, remeasure],
  );

  const persist = (next: AnnotatorPrefs) => {
    prefsRef.current = next;
    setPrefs(next);
    savePrefs(next);
  };

  const setTool = (next: Tool) => {
    setToolState(next);
    if (next !== 'select') {
      lastDraw.current = next;
      setSelection([]);
    }
    persist({ ...prefsRef.current, tool: next });
  };

  /** Agrega una forma (con el marco, si es la primera de la foto). */
  const add = (fields: ShapeFields) => {
    if (!frame || !canCreate) return;
    const id = newShapeId();
    write(() => addShape(doc, fileId, id, fields, { w: frame.w, h: frame.h }));
    return id;
  };

  /** Termina el texto que se está escribiendo: lo guarda (vacío, borra el que había). */
  const commitText = () => {
    const t = textRef.current ? { ...text!, value: textRef.current.value } : text;
    setText(null);
    if (!t || !frame) return;
    const value = t.value.replace(/\s+$/, '');
    if (t.id) {
      const was = byId.get(t.id);
      if (!value.trim()) write(() => deleteShape(doc, fileId, t.id!));
      else if (was?.type === 'text' && was.text !== value) write(() => updateShape(doc, fileId, t.id!, textEdit(value, was.fontSize, measure, `${was.fontSize}px ${MARKUP_FONT}`)));
      return;
    }
    if (!value.trim()) return;
    const style = prefsRef.current.styles.text;
    const fontSize = toFrame(style.fontSize, frame);
    add(textShape(t.at, value, style, frame, topZ(shapes), measure, `${fontSize}px ${MARKUP_FONT}`));
  };

  const close = () => {
    if (text) commitText();
    onClose();
  };

  const deleteSelected = () => {
    if (!canEdit || selection.length === 0) return;
    const ids = [...selection];
    setSelection([]);
    write(() => ids.forEach((id) => deleteShape(doc, fileId, id)));
  };

  // --- el estilo ----------------------------------------------------------------------------------------

  /** A qué se aplica la franja: lo elegido (su herramienta) o la herramienta de dibujar. */
  const target: { tool: DrawTool; style: ToolStyle } | null =
    selected.length > 0 && frame
      ? { tool: toolOf(selected[0].type), style: styleOfShape(selected[0], frame) }
      : tool !== 'select'
        ? { tool, style: prefs.styles[tool] }
        : null;

  /**
   * Cambia el estilo. Con formas elegidas, se ven cambiar ya y se escriben recién con `commit` (al soltar la barra);
   * y lo cambiado queda como el estilo de su herramienta para la próxima (como FrameRev).
   */
  const changeStyle = (patch: Partial<ToolStyle>, commit: boolean) => {
    if (!target) return;
    const styleTool = target.tool;
    const nextStyle = { ...prefsRef.current.styles[styleTool], ...patch };
    const recent = patch.color && commit ? pushRecent(prefsRef.current.recent, patch.color) : prefsRef.current.recent;
    const nextPrefs = { ...prefsRef.current, styles: { ...prefsRef.current.styles, [styleTool]: nextStyle }, recent };
    if (commit) persist(nextPrefs);
    else setPrefs(nextPrefs);
    if (selected.length === 0 || !frame || !canEdit) return;
    if (commit) {
      setPatches(new Map());
      write(() => {
        for (const s of selected) {
          const fields = restyleFields(s, patch, frame);
          if (Object.keys(fields).length > 0) updateShape(doc, fileId, s.id, fields);
        }
      });
    } else {
      const next = new Map(patches);
      for (const s of selected) next.set(s.id, { ...(next.get(s.id) ?? {}), ...restyleFields(s, patch, frame) });
      setPatches(next);
    }
  };

  /** `[` y `]`: lo elegido si el cursor está encima; si no (o con Ctrl/⌘), la próxima forma. */
  const changeWidth = (delta: number, next: boolean) => {
    const box = unionBounds(selected, measure);
    const pad = HANDLE_PX / pxPerUnit;
    const over = !!box && !!hover && hover.x >= box.x - pad && hover.x <= box.x + box.w + pad && hover.y >= box.y - pad && hover.y <= box.y + box.h + pad;
    if (!next && over && frame && canEdit) {
      const first = selected[0];
      const value = Math.min(MAX_WIDTH, Math.max(0, fromFrame(first.strokeWidth, frame) + delta));
      changeStyle({ width: value }, true);
      return;
    }
    const styleTool: DrawTool = tool !== 'select' ? tool : lastDraw.current;
    const style = prefsRef.current.styles[styleTool];
    const value = Math.min(MAX_WIDTH, Math.max(0, style.width + delta));
    persist({ ...prefsRef.current, styles: { ...prefsRef.current.styles, [styleTool]: { ...style, width: value } } });
  };

  // --- teclado ------------------------------------------------------------------------------------------

  const act = (action: AnnotatorAction) => {
    switch (action.kind) {
      case 'tool':
        if (action.tool === 'select' || canCreate) setTool(action.tool);
        return;
      case 'width':
        changeWidth(action.delta, action.next);
        return;
      case 'undo':
        undo.current?.undo();
        return;
      case 'redo':
        undo.current?.redo();
        return;
      case 'delete':
        deleteSelected();
        return;
      case 'escape':
        if (text) commitText();
        else if (numberEdit) setNumberEdit(null);
        else if (selection.length > 0) setSelection([]);
        else close();
        return;
      case 'fit':
        setZoom(NO_ZOOM);
        return;
      case 'save':
        notify(current('annotate.saved'));
        return;
      case 'pan':
        spaceHeld.current = true;
        setPanning(true);
        return;
    }
  };
  const actRef = useRef(act);
  actRef.current = act;

  // En la captura de `window`: nada de la página actúa debajo (sus atajos, el ⌘[ "atrás" del navegador).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);
      // Las barras y números de la franja: las flechas y las letras son suyas.
      const action = annotatorKey(e, IS_MAC, typing && !(target instanceof HTMLInputElement && target.type === 'range'));
      if (!action) {
        if (e.ctrlKey || e.metaKey) e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      actRef.current(action);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        spaceHeld.current = false;
        setPanning(false);
      }
    };
    const onBlur = () => {
      spaceHeld.current = false;
      setPanning(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // --- el mouse -----------------------------------------------------------------------------------------

  /** Un punto de la pantalla en el marco (los píxeles de la foto). */
  const toFramePoint = (clientX: number, clientY: number): Point | null => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box || !frame || !(box.width > 0) || !(box.height > 0)) return null;
    return { x: ((clientX - box.left) / box.width) * frame.w, y: ((clientY - box.top) / box.height) * frame.h };
  };
  /** Adentro de la foto (una forma nueva no empieza afuera). */
  const inside = (p: Point): Point => (frame ? { x: Math.min(frame.w, Math.max(0, p.x)), y: Math.min(frame.h, Math.max(0, p.y)) } : p);

  const stagePoint = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  };

  const redraw = () => setTick((n) => n + 1);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) return;
    const el = e.currentTarget;
    const captureIt = () => {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // El puntero ya no está.
      }
    };
    // La rueda apretada o la barra espaciadora: mover la foto ampliada.
    if (e.button === 1 || (e.button === 0 && spaceHeld.current)) {
      e.preventDefault();
      drag.current = { mode: 'pan', pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
      captureIt();
      return;
    }
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.annotator-text, .annotator-number')) return;
    const raw = toFramePoint(e.clientX, e.clientY);
    if (!raw || !frame) return;
    // Un clic afuera termina el texto (y no empieza otra cosa).
    if (text) {
      e.preventDefault();
      commitText();
      return;
    }
    if (numberEdit) {
      setNumberEdit(null);
      return;
    }
    const tol = HIT_PX / pxPerUnit;
    if (tool === 'select') {
      if (!canEdit) return;
      // Un tirador de la forma elegida.
      if (selected.length === 1) {
        const handle = handlesOf(selected[0]).find((h) => Math.hypot(h.at.x - raw.x, h.at.y - raw.y) <= HANDLE_PX / pxPerUnit);
        if (handle) {
          drag.current = { mode: 'handle', pointerId: e.pointerId, id: selected[0].id, handle: handle.handle, current: raw, shift: e.shiftKey };
          captureIt();
          return;
        }
      }
      const hit = hitTest(shapes, raw, tol, measure);
      if (hit) {
        if (e.shiftKey) {
          setSelection((sel) => (sel.includes(hit.id) ? sel.filter((id) => id !== hit.id) : [...sel, hit.id]));
          return;
        }
        const ids = selection.includes(hit.id) ? selection : [hit.id];
        setSelection(ids);
        drag.current = { mode: 'move', pointerId: e.pointerId, ids, start: raw, current: raw, hit: hit.id, shift: false };
        captureIt();
        return;
      }
      if (!e.shiftKey) setSelection([]);
      drag.current = { mode: 'band', pointerId: e.pointerId, start: raw, current: raw, add: e.shiftKey };
      captureIt();
      return;
    }
    if (!canCreate) return;
    const p = inside(raw);
    if (tool === 'text') {
      e.preventDefault();
      const hit = hitTest(shapes, raw, tol, measure);
      if (hit?.type === 'text') startTextEdit(hit);
      else {
        const style = prefs.styles.text;
        setText({ id: null, at: p, value: '', fontSize: toFrame(style.fontSize, frame), color: style.color, fill: style.fill });
      }
      return;
    }
    if (tool === 'number') drag.current = { mode: 'number', pointerId: e.pointerId, at: p };
    else if (tool === 'pencil' || tool === 'marker') drag.current = { mode: 'stroke', tool, pointerId: e.pointerId, points: [p.x, p.y] };
    else drag.current = { mode: 'draw', tool, pointerId: e.pointerId, start: p, current: p, shift: e.shiftKey, alt: e.altKey };
    captureIt();
    redraw();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const raw = toFramePoint(e.clientX, e.clientY);
    if (raw && (tool === 'pencil' || tool === 'marker' || tool === 'select')) setHover(raw);
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (d.mode === 'pan') {
      const dx = e.clientX - d.lastX;
      const dy = e.clientY - d.lastY;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      setZoom((z) => panBy(z, dx, dy, fit, stage));
      return;
    }
    if (!raw) return;
    switch (d.mode) {
      case 'draw':
        d.current = inside(raw);
        d.shift = e.shiftKey;
        d.alt = e.altKey;
        break;
      case 'stroke': {
        const p = inside(raw);
        const n = d.points.length;
        // Puntos repetidos no suman nada; el tope de puntos de un trazo (un mapa malicioso tampoco lo pasa).
        if ((d.points[n - 2] !== p.x || d.points[n - 1] !== p.y) && n < 2 * 5000) d.points.push(p.x, p.y);
        break;
      }
      case 'move':
      case 'band':
        d.current = raw;
        break;
      case 'handle':
        d.current = raw;
        d.shift = e.shiftKey;
        break;
      default:
        return;
    }
    redraw();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    const cancelled = e.type === 'pointercancel';
    if (cancelled || !frame) {
      redraw();
      return;
    }
    const slop = SLOP_PX / pxPerUnit;
    const z = topZ(shapes);
    const styles = prefsRef.current.styles;
    switch (d.mode) {
      case 'draw': {
        if (d.tool === 'rectangle' || d.tool === 'ellipse') {
          const r = dragRect(d.start, d.current, { shift: d.shift, alt: d.alt });
          if (r.w > slop || r.h > slop) add(boxShape(d.tool, r, styles[d.tool], frame, z));
        } else {
          const { start, end } = dragLine(d.start, d.current, { shift: d.shift, alt: d.alt });
          if (moved(start, end, slop)) add(lineShape(d.tool, start, end, styles[d.tool], frame, z));
        }
        break;
      }
      case 'stroke':
        add(strokeShape(d.tool, simplify(d.points, 0.5 / pxPerUnit), styles[d.tool], frame, z));
        break;
      case 'number':
        add(numberShape(d.at, nextNumber(shapes), styles.number, frame, z));
        break;
      case 'move': {
        const dx = d.current.x - d.start.x;
        const dy = d.current.y - d.start.y;
        if (moved(d.start, d.current, slop)) {
          const list = d.ids.map((id) => byId.get(id)).filter((s): s is MarkupShape => !!s);
          write(() => list.forEach((s) => updateShape(doc, fileId, s.id, moveFields(s, dx, dy))));
        } else if (d.ids.length > 1) setSelection([d.hit]);
        break;
      }
      case 'handle': {
        const s = byId.get(d.id);
        if (s) write(() => updateShape(doc, fileId, s.id, handleFields(s, d.handle, d.current, { shift: d.shift, alt: false })));
        break;
      }
      case 'band': {
        const r = dragRect(d.start, d.current, { shift: false, alt: false });
        const found = shapesInRect(shapes, r, measure).map((s) => s.id);
        setSelection((sel) => (d.add ? [...new Set([...sel, ...found])] : found));
        break;
      }
      default:
        break;
    }
    redraw();
  };

  const startTextEdit = (s: MarkupShape) => {
    if (s.type !== 'text' || !frame || !canEdit) return;
    const pad = s.rect ? s.padding : 0;
    setSelection([]);
    setText({
      id: s.id,
      at: { x: s.posX + (s.rect?.x ?? 0) + pad, y: s.posY + (s.rect?.y ?? 0) + pad },
      value: s.text,
      fontSize: s.fontSize,
      color: s.strokeColor,
      fill: s.fillMode === 3 || s.fillMode === 2,
    });
  };

  const onDoubleClick = (e: ReactMouseEvent) => {
    if (tool !== 'select' || !canEdit) return;
    const p = toFramePoint(e.clientX, e.clientY);
    if (!p) return;
    const hit = hitTest(shapes, p, HIT_PX / pxPerUnit, measure);
    if (hit?.type === 'text') startTextEdit(hit);
    else if (hit?.type === 'numbered_marker') {
      setSelection([hit.id]);
      setNumberEdit({ id: hit.id, value: String(hit.number) });
    }
  };

  // La rueda (y el pellizco del trackpad, que llega como rueda con Ctrl) amplía donde está el cursor.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const f = liveFit.current;
      if (!(f.width > 0)) return;
      const at = stagePoint(e.clientX, e.clientY);
      setZoom((z) => zoomAt(z, wheelScale(z, e.deltaY, e.deltaMode, e.ctrlKey), at, f, liveStage.current));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const liveFit = useRef(fit);
  liveFit.current = fit;
  const liveStage = useRef(stage);
  liveStage.current = stage;

  // Lo que se texto se edita, con el foco al aparecer.
  useEffect(() => {
    if (text) textRef.current?.focus({ preventScroll: true });
  }, [text?.id, text?.at.x, text?.at.y]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- el dibujo ----------------------------------------------------------------------------------------

  /** La forma que se está dibujando (sin escribir todavía). */
  const d = drag.current;
  let draft: ShapeFields | null = null;
  let moving: { ids: Set<string>; dx: number; dy: number } | null = null;
  let handlePatch: { id: string; fields: ShapeFields } | null = null;
  if (d && frame) {
    const styles = prefs.styles;
    if (d.mode === 'draw') {
      if (d.tool === 'rectangle' || d.tool === 'ellipse') draft = boxShape(d.tool, dragRect(d.start, d.current, d), styles[d.tool], frame, 1e9);
      else {
        const { start, end } = dragLine(d.start, d.current, d);
        draft = lineShape(d.tool, start, end, styles[d.tool], frame, 1e9);
      }
    } else if (d.mode === 'stroke') draft = strokeShape(d.tool, d.points, styles[d.tool], frame, 1e9);
    else if (d.mode === 'move') moving = { ids: new Set(d.ids), dx: d.current.x - d.start.x, dy: d.current.y - d.start.y };
    else if (d.mode === 'handle') {
      const s = byId.get(d.id);
      if (s) handlePatch = { id: d.id, fields: handleFields(s, d.handle, d.current, { shift: d.shift, alt: false }) };
    }
  }

  const visible = useMemo(() => {
    let list = shapes;
    if (text?.id) list = list.filter((s) => s.id !== text.id);
    return list;
  }, [shapes, text?.id]);

  useLayoutEffect(() => {
    const svg = shapesRef.current;
    if (!svg || !frame) return;
    let list: MarkupShape[] = visible;
    if (moving) {
      const m = moving;
      list = list.map((s) => (m.ids.has(s.id) ? { ...s, posX: s.posX + m.dx, posY: s.posY + m.dy } : s));
    }
    if (handlePatch) {
      const hp = handlePatch;
      list = list.map((s) => {
        if (s.id !== hp.id) return s;
        const raw = map.get(`${fileId}/${s.id}`);
        const merged = { ...(raw instanceof Y.Map ? (raw.toJSON() as Record<string, unknown>) : {}), ...(patches.get(s.id) ?? {}), ...hp.fields };
        return readShape(s.id, merged, frame) ?? s;
      });
    }
    if (draft) {
      const s = readShape('draft', draft, frame);
      if (s) list = [...list, s];
    }
    drawMarkup(svg, { fileId, frame, shapes: list, newer: false }, { minStroke: 1 / pxPerUnit, measure });
  });

  // --- la pantalla --------------------------------------------------------------------------------------

  const ui = frame ? renderUi() : null;

  function renderUi() {
    if (!frame) return null;
    const k = 1 / pxPerUnit;
    const parts: ReactNode[] = [];
    // Lo elegido: la caja de cada forma y los tiradores de una sola.
    for (const s of selected) {
      let b = shapeBounds(s, measure);
      if (moving?.ids.has(s.id)) b = { ...b, x: b.x + moving.dx, y: b.y + moving.dy };
      parts.push(<rect key={`sel-${s.id}`} className="annotator-selection" x={b.x - 3 * k} y={b.y - 3 * k} width={b.w + 6 * k} height={b.h + 6 * k} />);
    }
    if (selected.length === 1 && !moving && !handlePatch) {
      for (const h of handlesOf(selected[0])) {
        parts.push(<rect key={`h-${h.handle}`} className="annotator-handle" x={h.at.x - 4 * k} y={h.at.y - 4 * k} width={8 * k} height={8 * k} />);
      }
    }
    if (d?.mode === 'band') {
      const r = dragRect(d.start, d.current, { shift: false, alt: false });
      parts.push(<rect key="band" className="annotator-band" x={r.x} y={r.y} width={r.w} height={r.h} />);
    }
    // El cursor de pincel del lápiz y el marcador, con el diámetro real (como FrameRev).
    if (hover && (tool === 'pencil' || tool === 'marker') && canCreate) {
      const r = Math.max(toFrame(prefs.styles[tool].width, frame) / 2, 2 * k);
      parts.push(<circle key="brush" className="annotator-brush" cx={hover.x} cy={hover.y} r={r} />);
    }
    return parts;
  }

  const limitText =
    limit.which === 'photo'
      ? tr(limit.state === 'full' ? 'annotate.photoFull' : 'annotate.photoWarn')
      : limit.which === 'page'
        ? tr(limit.state === 'full' ? 'annotate.pageFull' : 'annotate.pageWarn')
        : limit.which === 'base'
          ? tr(limit.state === 'full' ? 'annotate.baseFull' : 'annotate.pageWarn')
          : null;
  const status = readOnly
    ? tr('annotate.newer')
    : missing && !image.preview
      ? tr('annotate.missing')
      : limitText ?? (image.fullFailed && !image.fullShown && image.preview ? tr('annotate.preview') : null);

  const altName = IS_MAC ? '⌥' : 'Alt';
  const cursor = panning ? 'grab' : tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair';
  const boxStyle = { width: fit.width, height: fit.height, transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})` };
  const pct = (p: Point): Record<string, string> => (frame ? { left: `${(p.x / frame.w) * 100}%`, top: `${(p.y / frame.h) * 100}%` } : {});
  /** Píxeles de la caja (antes del zoom) por unidad del marco: el tamaño de la letra de la caja de texto. */
  const boxPx = frame && fit.width > 0 ? fit.width / frame.w : 1;

  return createPortal(
    <div ref={dialogRef} className="annotator" role="dialog" aria-modal="true" aria-label={tr('annotate.label', { name })} tabIndex={-1}>
      <div className="annotator-bar">
        <div className="annotator-tools" role="toolbar" aria-label={tr('annotate.tools')}>
          {TOOLS.map((t) => {
            const Icon = TOOL_ICONS[t];
            const label = tr(TOOL_LABELS[t]);
            const key = shortcutLabel(TOOL_SHORTCUTS[t]);
            const modifiers = t === 'rectangle' || t === 'ellipse' || t === 'arrow' || t === 'line';
            return (
              <button
                key={t}
                className="annotator-btn"
                aria-label={label}
                aria-pressed={tool === t}
                data-tool={t}
                data-letter={TOOL_LETTERS[t]}
                disabled={t !== 'select' && !canCreate}
                data-tip={modifiers ? tr('annotate.toolTipModifiers', { name: label, key, alt: altName }) : tr('annotate.toolTip', { name: label, key })}
                onClick={() => setTool(t)}
              >
                <Icon size={20} />
              </button>
            );
          })}
        </div>
        <span className="annotator-sep" />
        <button className="annotator-btn" aria-label={tr('annotate.undo')} data-tip={tr('annotate.undoTip', { key: shortcutLabel('annotateUndo') })} disabled={!stacks.undo} onClick={() => undo.current?.undo()}>
          <UndoIcon size={20} />
        </button>
        <button className="annotator-btn" aria-label={tr('annotate.redo')} data-tip={tr('annotate.redoTip', { key: shortcutLabel('annotateRedo') })} disabled={!stacks.redo} onClick={() => undo.current?.redo()}>
          <RedoIcon size={20} />
        </button>
        <button
          className="annotator-btn"
          aria-label={tr('annotate.delete')}
          data-tip={tr('annotate.deleteTip', { key: shortcutLabel('annotateDelete') })}
          disabled={selection.length === 0 || !canEdit}
          onClick={deleteSelected}
        >
          <TrashIcon size={20} />
        </button>
        <button
          className="annotator-btn"
          aria-label={tr('annotate.fit')}
          data-tip={tr('annotate.fitTip', { key: shortcutLabel('annotateFit'), pan: shortcutLabel('annotatePan') })}
          onClick={() => setZoom(NO_ZOOM)}
        >
          <FitIcon size={20} />
        </button>
        <span className="annotator-name" data-tip={name} data-tip-plain data-tip-overflow>
          {name}
        </span>
        {status && (
          <span className="annotator-status" role="status">
            {status}
          </span>
        )}
        <button className="annotator-done" data-tip={tr('annotate.doneTip')} onClick={close}>
          {tr('annotate.done')}
        </button>
      </div>

      <div className="annotator-props">
        {target && canEdit ? (
          <StyleStrip
            tool={target.tool}
            style={target.style}
            recent={prefs.recent}
            onChange={changeStyle}
          />
        ) : (
          <span className="annotator-hint">{tool === 'select' && canEdit ? tr('annotate.selectHint') : ' '}</span>
        )}
      </div>

      <div
        ref={stageRef}
        className="annotator-stage"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={onDoubleClick}
        onDragStart={(e) => e.preventDefault()}
      >
        {frame ? (
          <div ref={boxRef} className="annotator-box" style={boxStyle}>
            {image.preview && !image.fullShown && <img className="annotator-photo" src={image.preview} alt="" draggable={false} onLoad={(e) => onNatural(e, false)} />}
            {image.full && (
              <img
                className="annotator-photo"
                data-shown={image.fullShown ? '' : undefined}
                src={image.full}
                alt=""
                draggable={false}
                onLoad={(e) => onNatural(e, true)}
                onError={() => setImage((s) => ({ ...s, full: null, fullFailed: true }))}
              />
            )}
            <svg ref={shapesRef} className="sd-markup annotator-shapes" aria-hidden="true" focusable="false" />
            <svg className="annotator-ui" viewBox={`0 0 ${frame.w} ${frame.h}`} aria-hidden="true" focusable="false">
              {ui}
            </svg>
            {text && (
              <textarea
                ref={textRef}
                className="annotator-text"
                data-fill={text.fill ? '' : undefined}
                defaultValue={text.value}
                maxLength={MAX_TEXT}
                aria-label={tr('annotate.text')}
                placeholder={tr('annotate.textHint')}
                rows={Math.max(1, text.value.split('\n').length)}
                style={{
                  ...pct(text.at),
                  fontSize: `${text.fontSize * boxPx}px`,
                  color: text.color,
                  fontFamily: MARKUP_FONT,
                }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.rows = Math.max(1, el.value.split('\n').length);
                  el.style.width = `${Math.max(4, ...el.value.split('\n').map((l) => l.length + 2))}ch`;
                }}
              />
            )}
            {numberEdit && (
              <NumberEditor
                value={numberEdit.value}
                style={(() => {
                  const s = byId.get(numberEdit.id);
                  return s ? pct({ x: s.posX, y: s.posY }) : {};
                })()}
                onDone={(value) => {
                  const id = numberEdit.id;
                  setNumberEdit(null);
                  const n = Number(value);
                  if (Number.isFinite(n) && byId.get(id)) write(() => updateShape(doc, fileId, id, { number: Math.trunc(Math.max(-99999, Math.min(99999, n))) }));
                }}
              />
            )}
          </div>
        ) : (
          <span className="annotator-loading" role="status">
            {missing ? tr('annotate.missing') : tr('annotate.loading')}
          </span>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** El número de un marcador, en una caja chica encima (doble clic con Select). */
function NumberEditor({ value, style, onDone }: { value: string; style: Record<string, string>; onDone: (value: string) => void }) {
  const tr = useT();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onDone(ref.current?.value ?? value);
  };
  return (
    <form className="annotator-number" style={style} onSubmit={submit}>
      <input ref={ref} type="number" defaultValue={value} aria-label={tr('annotate.numberValue')} onBlur={(e) => onDone(e.currentTarget.value)} />
    </form>
  );
}

/** La franja de propiedades: color, grosor, opacidad, relleno, punta de flecha y tamaño de letra. */
function StyleStrip({
  tool,
  style,
  recent,
  onChange,
}: {
  tool: DrawTool;
  style: ToolStyle;
  recent: string[];
  onChange: (patch: Partial<ToolStyle>, commit: boolean) => void;
}) {
  const tr = useT();
  const show = controlsOf(tool);
  /** Los recientes que no están entre los 8 de siempre. */
  const extra = recent.filter((c) => !(PALETTE as readonly string[]).includes(c)).slice(0, 6);
  const [widthText, setWidthText] = useState(String(style.width));
  useEffect(() => setWidthText(String(style.width)), [style.width]);
  const colorRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // El selector del sistema avisa cada paso (`input`) y al cerrarse (`change`): se ve en vivo y se escribe al final.
  useEffect(() => {
    const el = colorRef.current;
    if (!el) return;
    const done = () => onChangeRef.current({ color: el.value.toUpperCase() }, true);
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, []);
  const swatch = (c: string, recentOne = false) => (
    <button
      key={`${recentOne ? 'r' : 'p'}${c}`}
      className="annotator-swatch"
      style={{ background: c }}
      aria-label={tr('annotate.colorNamed', { color: c })}
      aria-pressed={style.color.toUpperCase() === c.toUpperCase()}
      onClick={() => onChange({ color: c }, true)}
    />
  );
  /** Una barra: se ve en vivo y se escribe al soltar. */
  const range = (label: string, value: number, max: number, key: keyof ToolStyle, tip?: string) => (
    <label className="annotator-field" data-tip={tip}>
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={max}
        value={Math.min(max, value)}
        onChange={(e) => onChange({ [key]: Number(e.currentTarget.value) }, false)}
        onPointerUp={(e) => onChange({ [key]: Number(e.currentTarget.value) }, true)}
        onKeyUp={(e) => onChange({ [key]: Number(e.currentTarget.value) }, true)}
      />
    </label>
  );
  return (
    <div className="annotator-strip">
      <div className="annotator-colors" role="group" aria-label={tr('annotate.color')}>
        {PALETTE.map((c) => swatch(c))}
        {extra.length > 0 && (
          <span className="annotator-colors" role="group" aria-label={tr('annotate.recent')}>
            <span className="annotator-sep" />
            {extra.map((c) => swatch(c, true))}
          </span>
        )}
        <label className="annotator-custom" data-tip={`**${tr('annotate.customColor')}**`}>
          <input ref={colorRef} type="color" value={style.color.toLowerCase()} aria-label={tr('annotate.customColor')} onChange={(e) => onChange({ color: e.currentTarget.value.toUpperCase() }, false)} />
        </label>
      </div>
      {show.width && (
        <>
          {range(tr('annotate.width'), style.width, SLIDER_MAX_WIDTH, 'width', tr('annotate.widthTip', { key: shortcutLabel('annotateWidth'), next: shortcutLabel('annotateWidthNext') }))}
          <input
            className="annotator-number-field"
            type="number"
            min={0}
            max={MAX_WIDTH}
            value={widthText}
            aria-label={tr('annotate.width')}
            onChange={(e) => setWidthText(e.currentTarget.value)}
            onBlur={() => {
              const n = Math.min(MAX_WIDTH, Math.max(0, Number(widthText) || 0));
              if (n !== style.width) onChange({ width: n }, true);
            }}
            onKeyUp={(e) => {
              if ((e.target as HTMLInputElement).validity.valid) setWidthText(e.currentTarget.value);
            }}
          />
        </>
      )}
      {range(tr('annotate.opacity'), style.opacity, 100, 'opacity')}
      {show.fill && (
        <label className="annotator-check" data-tip={show.fill === 'box' ? tr('annotate.backgroundTip') : undefined}>
          <input type="checkbox" checked={style.fill} onChange={(e) => onChange({ fill: e.currentTarget.checked }, true)} />
          <span>{show.fill === 'box' ? tr('annotate.background') : tr('annotate.fill')}</span>
        </label>
      )}
      {show.fill === 'shape' && style.fill && range(tr('annotate.fillOpacity'), style.fillOpacity, 100, 'fillOpacity')}
      {show.arrow && (
        <>
          <label className="annotator-check">
            <input type="checkbox" checked={style.headStyle === 1} onChange={(e) => onChange({ headStyle: e.currentTarget.checked ? 1 : 0 }, true)} />
            <span>{tr('annotate.headOpen')}</span>
          </label>
          <label className="annotator-check">
            <input type="checkbox" checked={style.headPosition === 1} onChange={(e) => onChange({ headPosition: e.currentTarget.checked ? 1 : 2 }, true)} />
            <span>{tr('annotate.headBoth')}</span>
          </label>
        </>
      )}
      {show.font && (
        <label className="annotator-field">
          <span>{tr('annotate.fontSize')}</span>
          <input
            className="annotator-number-field"
            type="number"
            min={MIN_FONT}
            max={MAX_FONT}
            defaultValue={style.fontSize}
            key={`${tool}-${style.fontSize}`}
            onBlur={(e) => {
              const n = Math.min(MAX_FONT, Math.max(MIN_FONT, Number(e.currentTarget.value) || style.fontSize));
              if (n !== style.fontSize) onChange({ fontSize: n }, true);
            }}
          />
        </label>
      )}
    </div>
  );
}
