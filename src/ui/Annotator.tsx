import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal, flushSync } from 'react-dom';
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
  styleFields,
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
import { fitSize, isDoubleTap, NO_ZOOM, panBy, pinchZoom, wheelScale, zoomAt, type Size, type Zoom } from './carreteModel';
import { inputOf, movePoints, routeDown, TOLERANCES, twoFingers, type InputType } from './annotatorTouch';
import { isOffline, type CarreteLoader } from './carreteLoader';
import type { CarreteItem } from './carreteModel';
import {
  ArrowToolIcon,
  EllipseToolIcon,
  CloseIcon,
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
import { IS_MAC } from './shortcuts';
import { asAction, tipRows, touchScreen } from './tipRows';
import { popMarkupStep, protectMarkupOthers } from './undoTimeline';

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
//     otro, el texto de la página y la poda no se deshacen acá; tampoco se borra una forma tuya que otro cambió,
//     `protectMarkupOthers`). Al cerrarse, lo que quedó en su pila pasa a la línea de tiempo de la página como UN paso
//     (`onUndoSteps`; Docs/Doc_Deshacer.md, entrega 3): ⌘Z en la página lo deshace entero.
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

/** En píxeles de pantalla, con el mouse: cuánto se acepta errarle a una forma y a un tirador (con el dedo, más). */
const HIT_PX = TOLERANCES.mouse.hit;
const HANDLE_PX = TOLERANCES.mouse.handle;

/**
 * La pantalla del teléfono y del iPad (entrega 3): las herramientas en una tira abajo y el estilo en una hoja. Va con el
 * dedo como puntero principal o con la ventana angosta; los gestos, en cambio, dependen de con qué se toca (dedo, lápiz o
 * mouse), no de esto.
 */
const COMPACT_QUERY = '(pointer: coarse), (max-width: 760px)';

function useCompact(): boolean {
  const query = typeof matchMedia === 'function' ? matchMedia(COMPACT_QUERY) : null;
  const [compact, setCompact] = useState(() => !!query?.matches);
  useEffect(() => {
    if (!query) return;
    const onChange = () => setCompact(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return compact;
}

type Drag =
  | { mode: 'draw'; tool: 'rectangle' | 'ellipse' | 'arrow' | 'line'; pointerId: number; start: Point; current: Point; shift: boolean; alt: boolean }
  | { mode: 'stroke'; tool: 'pencil' | 'marker'; pointerId: number; points: number[] }
  | { mode: 'number'; pointerId: number; at: Point }
  | { mode: 'move'; pointerId: number; ids: string[]; start: Point; current: Point; hit: string; shift: boolean }
  | { mode: 'handle'; pointerId: number; id: string; handle: Handle; start: Point; current: Point; shift: boolean }
  | { mode: 'band'; pointerId: number; start: Point; current: Point; add: boolean }
  | { mode: 'pan'; pointerId: number; lastX: number; lastY: number }
  // Dos dedos: amplían y mueven la foto (nunca dibujan). `mid` en el escenario, como el carrete.
  | { mode: 'pinch'; pointerId: number; ids: [number, number]; startZoom: Zoom; distance: number; mid: Point }
  // Un toque con el dedo o el lápiz que se decide al soltar: empezar un texto, o terminar el que se escribe (`commit`).
  // Al apoyar no se hace nada, así el primer dedo de un pellizco no abre el teclado ni cierra el texto.
  | { mode: 'tap'; pointerId: number; at: Point; clientX: number; clientY: number; commit: boolean };

interface TextEditing {
  /** La forma que se edita, o `null`: un texto nuevo. */
  id: string | null;
  /** Dónde empieza la primera letra (en el marco). */
  at: Point;
  value: string;
  /** El texto al empezar (para no volver a crear uno que otro borró si no se cambió nada). */
  original: string;
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
  /**
   * La medida del archivo (`files.width/height`, ya girada): del registro del dispositivo, también sin red. Es el marco
   * de la primera anotación de la foto (auditoría B1). Sin esto, el del original cuando carga.
   */
  size?: () => Promise<{ width: number; height: number } | null>;
  onClose: () => void;
  /**
   * Al cerrarse (o desmontarse), si se escribió algo: los pasos que quedaron en su deshacer, los de abajo primero (la
   * línea de tiempo de la página los toma como un solo paso; vacío si se deshizo todo adentro).
   */
  onUndoSteps?: (steps: Y.UndoManager['undoStack'], map: Y.Map<unknown>) => void;
}

interface ImageState {
  preview: string | null;
  /** Ya se pidió la vista previa (y vino lo que hay). */
  previewTried: boolean;
  full: string | null;
  /** El original no se pudo pedir o mostrar. */
  fullFailed: boolean;
  /** La medida de lo que se ve (para mostrarlo; puede ser la vista previa). */
  natural: Size | null;
  /** La medida del original cargado (la del archivo). */
  fullNatural: Size | null;
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

export function Annotator({ doc, fileId, name, item, loader, size, onClose, onUndoSteps }: AnnotatorProps) {
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
  const [image, setImage] = useState<ImageState>({ preview: null, previewTried: false, full: null, fullFailed: false, natural: null, fullNatural: null, fullShown: false, offline: false });
  /** La medida del archivo, si el dispositivo la sabe (`undefined` mientras se pregunta). */
  const [fileSize, setFileSize] = useState<Size | null | undefined>(undefined);
  /** No hay nada de la foto en el dispositivo (ni miniatura ni original): no se puede anotar. */
  const missing = image.previewTried && !image.preview && image.fullFailed;
  const [stacks, setStacks] = useState({ undo: false, redo: false });
  const [limits, setLimits] = useState<MarkupLimits | null>(null);
  const [text, setText] = useState<TextEditing | null>(null);
  const [numberEdit, setNumberEdit] = useState<{ id: string; value: string } | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [panning, setPanning] = useState(false);
  const compact = useCompact();
  /** La hoja de propiedades del teléfono (color, grosor, opacidad…), abierta. */
  const [sheet, setSheet] = useState(false);
  /** Se usó un lápiz en esta sesión (muestra *Only the pencil draws* en la hoja). */
  const [penSeen, setPenSeen] = useState(false);
  /** Lo que se escribe en la caja del teléfono, para dibujarlo en la foto mientras tanto. */
  const [draftText, setDraftText] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const shapesRef = useRef<SVGSVGElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  /** Lo último escrito en el texto que se edita. */
  const typed = useRef<string | null>(null);
  /** Guardar el texto a medio escribir si el anotador se desmonta (ver `commitText`). */
  const commitOnExit = useRef<(() => void) | null>(null);
  const drag = useRef<Drag | null>(null);
  /** Con qué se apoyó lo que se arrastra ahora (el lápiz manda sobre el dedo; la palma no dibuja). */
  const dragInput = useRef<InputType | null>(null);
  /** Los dedos apoyados en la foto (en la pantalla), para los gestos de dos dedos. */
  const touches = useRef(new Map<number, { x: number; y: number }>());
  /** El último toque (para el doble toque en un texto o un número, con Select). */
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  /** Con qué se tocó por última vez (un doble toque no se cuenta dos veces si el navegador también manda `dblclick`). */
  const lastInput = useRef<InputType>('mouse');
  const undo = useRef<Y.UndoManager | null>(null);
  const spaceHeld = useRef(false);
  const measureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measure: Measure = useMemo(() => markupMeasure() ?? roughMeasure, []);

  // --- el marco, las formas y los topes ------------------------------------------------------------------

  const stored = readFrame(map.get(fileId));
  // El marco que se puede ESCRIBIR (auditoría B1): el guardado; si no hay, la medida del archivo; si no se sabe, la del
  // original cargado. NUNCA la de la vista previa: dos que anotan por primera vez la misma foto a la vez (uno con la
  // miniatura, sin red) escribirían marcos distintos, gana uno, y las formas del otro quedarían corridas y achicadas.
  const sizeFrame = fileSize ?? image.fullNatural;
  const realFrame: MarkupFrame | null = stored ?? (sizeFrame ? { v: MARKUP_FORMAT_VERSION, w: sizeFrame.width, h: sizeFrame.height } : null);
  // El de la pantalla: el real o, mientras tanto, la proporción de lo que se ve (solo para mostrar la foto).
  const frame: MarkupFrame | null = realFrame ?? (image.natural ? { v: MARKUP_FORMAT_VERSION, w: image.natural.width, h: image.natural.height } : null);
  /** Sin la medida de la foto no se puede crear nada (se ve la foto, con el aviso). */
  const noSize = !realFrame && fileSize !== undefined && image.fullFailed;
  const readOnly = !!stored && stored.v > MARKUP_FORMAT_VERSION;
  // `version` cambia con cada cambio de las formas de esta foto: las vuelve a leer.
  const shapes = useMemo(() => (frame ? readShapes(map, fileId, frame, patches) : []), [map, fileId, frame?.w, frame?.h, patches, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(shapes.map((s) => [s.id, s])), [shapes]);
  const selected = useMemo(() => selection.map((id) => byId.get(id)).filter((s): s is MarkupShape => !!s), [selection, byId]);
  const limit = limits ? limitState(limits) : { state: 'ok' as const, which: null };
  const canCreate = !readOnly && !!realFrame && !missing && limit.state !== 'full';
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

  // Deshacer propio de esta foto en esta sesión. Al irse, lo que quedó en la pila pasa a la línea de tiempo de la página.
  const onUndoStepsRef = useRef(onUndoSteps);
  onUndoStepsRef.current = onUndoSteps;
  useEffect(() => {
    const um = new Y.UndoManager(map, { trackedOrigins: new Set([origin]), captureTimeout: 0 });
    protectMarkupOthers(um, map);
    /** Se escribió algo en esta vez (aunque después se haya deshecho): para la línea de tiempo es algo nuevo. */
    let wrote = false;
    const update = () => setStacks({ undo: um.undoStack.length > 0, redo: um.redoStack.length > 0 });
    const added = () => {
      wrote = true;
      update();
    };
    um.on('stack-item-added', added);
    um.on('stack-item-popped', update);
    um.on('stack-cleared', update);
    undo.current = um;
    return () => {
      // Un texto a medio escribir se guarda antes (si no, quedaría fuera del paso).
      commitOnExit.current?.();
      undo.current = null;
      um.off('stack-item-added', added);
      um.off('stack-item-popped', update);
      um.off('stack-cleared', update);
      // Lo deshecho y no rehecho se olvida (su lugar en la memoria también); lo hecho, a la línea de tiempo.
      um.clear(false, true);
      const steps = um.undoStack;
      um.undoStack = [];
      um.destroy();
      if (wrote) onUndoStepsRef.current?.(steps, map);
    };
  }, [map, origin]);

  /**
   * ⌘Z / ⌘⇧Z del anotador: un paso por vez (`popMarkupStep`: así no se lleva lo de otro). Los botones se vuelven a mirar
   * después (mientras deshace, los pasos de abajo se sacan un momento de la pila).
   */
  const stepUndo = (kind: 'undo' | 'redo') => {
    const um = undo.current;
    if (!um) return;
    popMarkupStep(um, kind);
    setStacks({ undo: um.undoStack.length > 0, redo: um.redoStack.length > 0 });
  };

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

  // La medida del archivo (registro del dispositivo; con red, la base).
  useEffect(() => {
    let alive = true;
    if (!size) {
      setFileSize(null);
      return;
    }
    size().then(
      (s) => alive && setFileSize(s && s.width > 0 && s.height > 0 ? { width: s.width, height: s.height } : null),
      () => alive && setFileSize(null),
    );
    return () => {
      alive = false;
    };
  }, [size]);

  // Sin marco guardado, la medida de lo que se ve hace falta antes de mostrarlo (la caja de dibujo tiene su proporción);
  // la del original, además, es el marco si el archivo no dice la suya.
  useEffect(() => {
    if (stored) return;
    const url = !image.fullNatural && image.full ? image.full : !image.natural ? image.preview : null;
    if (!url) return;
    let alive = true;
    const probe = new Image();
    probe.onload = () => {
      if (!alive) return;
      onNatural({ currentTarget: probe }, url === image.full);
    };
    probe.src = url;
    return () => {
      alive = false;
    };
  }, [!!stored, image.natural, image.fullNatural, image.full, image.preview]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Una imagen cargó: su medida (la del original, aparte) y si ya se ve el original. */
  function onNatural(e: { currentTarget: HTMLImageElement }, full: boolean) {
    const img = e.currentTarget;
    if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) return;
    const natural = { width: img.naturalWidth, height: img.naturalHeight };
    setImage((s) => ({
      ...s,
      natural: full || !s.natural ? natural : s.natural,
      fullNatural: full ? natural : s.fullNatural,
      fullShown: s.fullShown || (full && img instanceof HTMLImageElement && img.isConnected),
    }));
  }

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

  /**
   * Solo los campos que de verdad cambian: escribir un valor igual deja un hueco más para siempre en la base limpia
   * (sección 10), por ejemplo al tocar el mismo color dos veces.
   */
  const changed = (id: string, fields: ShapeFields): ShapeFields => {
    const raw = map.get(`${fileId}/${id}`);
    if (!(raw instanceof Y.Map)) return {};
    const out: ShapeFields = {};
    for (const [k, v] of Object.entries(fields)) if (JSON.stringify(raw.get(k)) !== JSON.stringify(v)) out[k] = v;
    return out;
  };
  /** Cambia los campos de varias formas en un solo paso de deshacer (nada, si nada cambia). */
  const update = (edits: [string, ShapeFields][]) => {
    const real = edits.map(([id, f]) => [id, changed(id, f)] as const).filter(([, f]) => Object.keys(f).length > 0);
    if (real.length > 0) write(() => real.forEach(([id, f]) => updateShape(doc, fileId, id, f)));
  };

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

  /** Agrega una forma (con el marco, si es la primera de la foto: siempre el real, nunca el de lo que se ve). */
  const add = (fields: ShapeFields) => {
    if (!realFrame || !canCreate) return;
    const id = newShapeId();
    write(() => addShape(doc, fileId, id, fields, { w: realFrame.w, h: realFrame.h }));
    return id;
  };

  /** Termina el texto que se está escribiendo: lo guarda (vacío, borra el que había). */
  const commitText = () => {
    // Lo escrito: del campo, o lo último que se escribió (al cerrarse solo, el campo ya no está).
    const typedNow = textRef.current?.value ?? typed.current;
    const t = text && typedNow !== null ? { ...text, value: typedNow } : text;
    typed.current = null;
    setDraftText(null);
    // Una sola vez: cerrar con *Done* o Esc no lo vuelve a guardar al desmontarse.
    commitOnExit.current = null;
    setText(null);
    if (!t || !frame) return;
    const value = t.value.replace(/\s+$/, '');
    // Lo que se editaba sigue ahí: se cambia. Si otro lo borró mientras tanto, lo escrito no se pierde: se crea de nuevo.
    const was = t.id ? byId.get(t.id) : undefined;
    if (t.id && map.get(`${fileId}/${t.id}`) instanceof Y.Map) {
      if (!value.trim()) write(() => deleteShape(doc, fileId, t.id!));
      else if (was?.type === 'text' && was.text !== value) update([[t.id, textEdit(value, was.fontSize, measure, `${was.fontSize}px ${MARKUP_FONT}`)]]);
      return;
    }
    if (t.id && value.trim() && value !== t.original) {
      const font = `${t.fontSize}px ${MARKUP_FONT}`;
      const box = textEdit(value, t.fontSize, measure, font);
      add({
        ...styleFields('text', { ...prefsRef.current.styles.text, color: t.color, fill: t.fill }, frame),
        ...box,
        type: 'text',
        zValue: topZ(shapes),
        posX: t.at.x - (box.padding as number),
        posY: t.at.y - (box.padding as number),
        fontSize: t.fontSize,
      });
      return;
    }
    if (t.id) return;
    if (!value.trim()) return;
    const style = prefsRef.current.styles.text;
    const fontSize = toFrame(style.fontSize, frame);
    add(textShape(t.at, value, style, frame, topZ(shapes), measure, `${fontSize}px ${MARKUP_FONT}`));
  };

  // Si el anotador se cierra solo (cambió el permiso, se fue de la página) con un texto a medio escribir, se guarda.
  commitOnExit.current = text ? commitText : null;
  useEffect(() => () => commitOnExit.current?.(), []);

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
      update(selected.map((s) => [s.id, restyleFields(s, patch, frame)]));
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
        stepUndo('undo');
        return;
      case 'redo':
        stepUndo('redo');
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

  const capture = (el: HTMLElement, ids: number[]) => {
    for (const id of ids) {
      try {
        el.setPointerCapture(id);
      } catch {
        // El puntero ya no está.
      }
    }
  };

  /** Empieza a escribir un texto. Con el dedo, el foco va ya (dentro del toque): si no, el iPhone no abre el teclado. */
  const beginText = (next: TextEditing, now: boolean) => {
    setDraftText(null);
    if (!now) {
      setText(next);
      return;
    }
    flushSync(() => setText(next));
    textRef.current?.focus({ preventScroll: true });
  };

  /** Se usó un lápiz: desde ahora (y en este dispositivo) el lápiz dibuja y el dedo mueve, salvo que se haya elegido. */
  const notePen = () => {
    if (!penSeen) setPenSeen(true);
    const p = prefsRef.current;
    if (!p.penOnly && !p.penSet) persist({ ...p, penOnly: true });
  };

  /** Dos dedos: lo que el primero dibujaba se deja (no se escribió nada) y se amplía y mueve la foto. */
  const startPinch = (el: HTMLElement) => {
    if (drag.current?.mode === 'pinch') return;
    const [[ia, a], [ib, b]] = [...touches.current.entries()];
    const f = twoFingers(a, b);
    drag.current = { mode: 'pinch', pointerId: ib, ids: [ia, ib], startZoom: liveZoom.current, distance: f.distance, mid: stagePoint(f.mid.x, f.mid.y) };
    dragInput.current = 'touch';
    capture(el, [ia, ib]);
    setHover(null);
    redraw();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Las cajas de texto y de número son suyas (elegir letras, mover el cursor).
    if ((e.target as HTMLElement).closest('.annotator-text, .annotator-number, .annotator-textpanel')) return;
    const input = inputOf(e.pointerType);
    lastInput.current = input;
    if (input === 'touch') touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (input === 'pen') notePen();
    // La hoja de propiedades abierta: tocar la foto la cierra (y no dibuja).
    if (sheet) {
      setSheet(false);
      return;
    }
    const busy = drag.current && drag.current.mode !== 'pinch' && drag.current.mode !== 'pan' ? dragInput.current : null;
    const route = routeDown({ input, penOnly: prefsRef.current.penOnly, touches: touches.current.size, drawing: busy });
    if (route === 'ignore') return;
    if (route === 'pinch') {
      startPinch(e.currentTarget);
      return;
    }
    if (route === 'pan') {
      if (drag.current) return;
      drag.current = { mode: 'pan', pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
      dragInput.current = 'touch';
      return;
    }
    if (drag.current) {
      // El lápiz manda: lo que hacían los dedos (mover la foto, un dibujo a medias del dedo) se deja.
      if (input !== 'pen' || dragInput.current !== 'touch') return;
      drag.current = null;
      redraw();
    }
    const el = e.currentTarget;
    const captureIt = () => capture(el, [e.pointerId]);
    const begin = (next: Drag) => {
      drag.current = next;
      dragInput.current = input;
    };
    // La rueda apretada o la barra espaciadora: mover la foto ampliada.
    if (e.button === 1 || (e.button === 0 && spaceHeld.current)) {
      e.preventDefault();
      begin({ mode: 'pan', pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY });
      captureIt();
      return;
    }
    if (e.button !== 0) return;
    const raw = toFramePoint(e.clientX, e.clientY);
    if (!raw || !frame) return;
    const touchy = input !== 'mouse';
    // Un clic afuera termina el texto (y no empieza otra cosa). Con el dedo, al soltar: un pellizco no lo cierra.
    if (text) {
      e.preventDefault();
      if (touchy) begin({ mode: 'tap', pointerId: e.pointerId, at: raw, clientX: e.clientX, clientY: e.clientY, commit: true });
      else commitText();
      return;
    }
    if (numberEdit) {
      setNumberEdit(null);
      return;
    }
    const tol = TOLERANCES[input].hit / pxPerUnit;
    if (tool === 'select') {
      if (!canEdit) return;
      // Un tirador de la forma elegida.
      if (selected.length === 1) {
        const handles = handlesOf(selected[0]);
        const reach = handleReach(handles, input) / pxPerUnit;
        const handle = handles.find((h) => Math.hypot(h.at.x - raw.x, h.at.y - raw.y) <= reach);
        if (handle) {
          begin({ mode: 'handle', pointerId: e.pointerId, id: selected[0].id, handle: handle.handle, start: raw, current: raw, shift: e.shiftKey });
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
        begin({ mode: 'move', pointerId: e.pointerId, ids, start: raw, current: raw, hit: hit.id, shift: false });
        captureIt();
        return;
      }
      if (!e.shiftKey) setSelection([]);
      begin({ mode: 'band', pointerId: e.pointerId, start: raw, current: raw, add: e.shiftKey });
      captureIt();
      return;
    }
    if (!canCreate) return;
    const p = inside(raw);
    if (tool === 'text') {
      e.preventDefault();
      // Con el dedo o el lápiz, el texto empieza al soltar (dentro del toque, para que el teléfono abra el teclado).
      if (touchy) {
        begin({ mode: 'tap', pointerId: e.pointerId, at: raw, clientX: e.clientX, clientY: e.clientY, commit: false });
        captureIt();
        return;
      }
      startTextAt(raw, false);
      return;
    }
    if (tool === 'number') begin({ mode: 'number', pointerId: e.pointerId, at: p });
    else if (tool === 'pencil' || tool === 'marker') begin({ mode: 'stroke', tool, pointerId: e.pointerId, points: [p.x, p.y] });
    else begin({ mode: 'draw', tool, pointerId: e.pointerId, start: p, current: p, shift: e.shiftKey, alt: e.altKey });
    captureIt();
    redraw();
  };

  /**
   * Hasta dónde toma un tirador, en píxeles de pantalla. Con el dedo, 22 px; pero en una forma chica las esquinas taparían
   * todo y no se podría moverla (auditoría O2): nunca más de un tercio de la distancia entre dos tiradores (ni menos que
   * con el mouse).
   */
  const handleReach = (handles: { at: Point }[], input: InputType): number => {
    const full = TOLERANCES[input].handle;
    let gap = Infinity;
    for (let i = 0; i < handles.length; i++) {
      for (let j = i + 1; j < handles.length; j++) gap = Math.min(gap, Math.hypot(handles[i].at.x - handles[j].at.x, handles[i].at.y - handles[j].at.y) * pxPerUnit);
    }
    return Math.min(full, Math.max(TOLERANCES.mouse.handle, gap / 3));
  };

  /** Con Text: un texto nuevo en ese punto, o editar el texto que hay ahí. */
  const startTextAt = (raw: Point, now: boolean) => {
    if (!frame || !canCreate) return;
    const hit = hitTest(shapes, raw, TOLERANCES[lastInput.current].hit / pxPerUnit, measure);
    if (hit?.type === 'text') {
      startTextEdit(hit, now);
      return;
    }
    const style = prefs.styles.text;
    beginText({ id: null, at: inside(raw), value: '', original: '', fontSize: toFrame(style.fontSize, frame), color: style.color, fill: style.fill }, now);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const input = inputOf(e.pointerType);
    if (input === 'touch' && touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const raw = toFramePoint(e.clientX, e.clientY);
    // El cursor de pincel sigue al mouse y al lápiz que flota; debajo del dedo no hace falta.
    if (raw && input !== 'touch' && (tool === 'pencil' || tool === 'marker' || tool === 'select')) setHover(raw);
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'pinch') {
      if (!d.ids.includes(e.pointerId)) return;
      const a = touches.current.get(d.ids[0]);
      const b = touches.current.get(d.ids[1]);
      if (!a || !b) return;
      const f = twoFingers(a, b);
      setZoom(pinchZoom(d.startZoom, d.distance, d.mid, f.distance, stagePoint(f.mid.x, f.mid.y), liveFit.current, liveStage.current));
      return;
    }
    if (d.pointerId !== e.pointerId) return;
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
        // Todos los puntos que el navegador juntó en este evento (el lápiz del iPad manda 240 por segundo): el trazo
        // sale suave, y al soltar se simplifica igual (los bytes no dependen de cuántos llegaron).
        for (const c of movePoints(e.nativeEvent as PointerEvent)) {
          const q = toFramePoint(c.x, c.y);
          if (!q) continue;
          const p = inside(q);
          const n = d.points.length;
          // Puntos repetidos no suman nada; el tope de puntos de un trazo (un mapa malicioso tampoco lo pasa).
          if ((d.points[n - 2] !== p.x || d.points[n - 1] !== p.y) && n < 2 * 5000) d.points.push(p.x, p.y);
        }
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
    const input = inputOf(e.pointerType);
    touches.current.delete(e.pointerId);
    if (input === 'touch') setHover(null);
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'pinch') {
      if (!d.ids.includes(e.pointerId)) return;
      // Queda un dedo: sigue moviendo la foto con ese (nunca dibuja), como el carrete.
      const rest = [...touches.current.entries()][0];
      drag.current = rest ? { mode: 'pan', pointerId: rest[0], lastX: rest[1].x, lastY: rest[1].y } : null;
      if (!rest) dragInput.current = null;
      redraw();
      return;
    }
    if (d.pointerId !== e.pointerId) return;
    drag.current = null;
    dragInput.current = null;
    const cancelled = e.type === 'pointercancel';
    if (cancelled || !frame) {
      redraw();
      return;
    }
    const slop = TOLERANCES[input].slop / pxPerUnit;
    const z = topZ(shapes);
    const styles = prefsRef.current.styles;
    switch (d.mode) {
      case 'tap': {
        if (Math.hypot(e.clientX - d.clientX, e.clientY - d.clientY) > TOLERANCES[input].slop * 2) break;
        if (d.commit) commitText();
        else startTextAt(d.at, true);
        break;
      }
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
          update(list.map((s) => [s.id, moveFields(s, dx, dy)]));
        } else {
          if (d.ids.length > 1) setSelection([d.hit]);
          tapped(e, input, d.hit);
        }
        break;
      }
      case 'handle': {
        const s = byId.get(d.id);
        // Tocar un tirador sin moverlo no cambia nada (con el dedo, los tiradores son grandes y tapan la forma).
        if (!moved(d.start, d.current, slop)) tapped(e, input, d.id);
        else if (s) update([[s.id, handleFields(s, d.handle, d.current, { shift: d.shift, alt: false })]]);
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

  /** Con el dedo o el lápiz no hay doble clic: dos toques seguidos en un texto lo editan, en un número lo renumeran. */
  const tapped = (e: { timeStamp: number; clientX: number; clientY: number }, input: InputType, id: string) => {
    if (input === 'mouse') return;
    const tap = { at: e.timeStamp, x: e.clientX, y: e.clientY };
    if (!isDoubleTap(lastTap.current, tap)) {
      lastTap.current = tap;
      return;
    }
    lastTap.current = null;
    const hit = byId.get(id);
    if (hit) editShape(hit, true);
  };

  const startTextEdit = (s: MarkupShape, now = false) => {
    if (s.type !== 'text' || !frame || !canEdit) return;
    const pad = s.rect ? s.padding : 0;
    setSelection([]);
    beginText(
      {
        id: s.id,
        at: { x: s.posX + (s.rect?.x ?? 0) + pad, y: s.posY + (s.rect?.y ?? 0) + pad },
        value: s.text,
        original: s.text,
        fontSize: s.fontSize,
        color: s.strokeColor,
        fill: s.fillMode === 3 || s.fillMode === 2,
      },
      now,
    );
  };

  /** Editar un texto o renumerar un número (doble clic, o dos toques con el dedo). */
  const editShape = (hit: MarkupShape, now: boolean) => {
    if (hit.type === 'text') startTextEdit(hit, now);
    else if (hit.type === 'numbered_marker') {
      setSelection([hit.id]);
      setNumberEdit({ id: hit.id, value: String(hit.number) });
    }
  };

  const onDoubleClick = (e: ReactMouseEvent) => {
    // Con el dedo, el doble toque ya lo vio `onPointerUp` (el navegador puede mandar también un `dblclick`).
    if (tool !== 'select' || !canEdit || lastInput.current !== 'mouse') return;
    const p = toFramePoint(e.clientX, e.clientY);
    if (!p) return;
    const hit = hitTest(shapes, p, HIT_PX / pxPerUnit, measure);
    if (hit) editShape(hit, false);
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

  // Safari: el pellizco llega además como `gesture*`. Se frena en todo el anotador (en el iPhone ampliaría la página de
  // atrás); en la Mac, el del trackpad amplía la foto (en el iPhone ya llega como dos dedos).
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    let start: Zoom | null = null;
    const onStart = (e: Event) => {
      e.preventDefault();
      start = liveZoom.current;
    };
    const onChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale?: number; clientX?: number; clientY?: number };
      const f = liveFit.current;
      if (touches.current.size >= 2 || !start || !g.scale || !(f.width > 0)) return;
      const at = g.clientX !== undefined && g.clientY !== undefined ? stagePoint(g.clientX, g.clientY) : { x: 0, y: 0 };
      setZoom(zoomAt(start, start.scale * g.scale, at, f, liveStage.current));
    };
    const onEnd = (e: Event) => {
      e.preventDefault();
      start = null;
    };
    el.addEventListener('gesturestart', onStart);
    el.addEventListener('gesturechange', onChange);
    el.addEventListener('gestureend', onEnd);
    return () => {
      el.removeEventListener('gesturestart', onStart);
      el.removeEventListener('gesturechange', onChange);
      el.removeEventListener('gestureend', onEnd);
    };
  }, []);
  const liveFit = useRef(fit);
  liveFit.current = fit;
  const liveStage = useRef(stage);
  liveStage.current = stage;
  const liveZoom = useRef(zoom);
  liveZoom.current = zoom;

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
  // En el teléfono se escribe en una caja de texto común (arriba, con letra legible); lo escrito se ve en la foto.
  if (!draft && text && compact && frame) {
    const value = (draftText ?? typed.current ?? text.value).replace(/\s+$/, '');
    if (value.trim()) {
      const font = `${text.fontSize}px ${MARKUP_FONT}`;
      const raw = text.id ? map.get(`${fileId}/${text.id}`) : null;
      draft =
        raw instanceof Y.Map
          ? { ...(raw.toJSON() as ShapeFields), ...textEdit(value, text.fontSize, measure, font) }
          : textShape(text.at, value, { ...prefs.styles.text, color: text.color, fill: text.fill }, frame, 1e9, measure, font);
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
      : noSize
        ? tr('annotate.noSize')
        : limitText ?? (image.fullFailed && !image.fullShown && image.preview ? tr('annotate.preview') : null);

  // Los tooltips con atajo (D226, tipRows.ts): sin atajos en una pantalla táctil. Lo decide el tipo de puntero y no el
  // ancho: una ventana angosta con mouse sigue con sus atajos (auditoría de D226, O4).
  const touch = touchScreen();
  const tipEnv = { touch };
  const cursor = panning ? 'grab' : tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair';
  const boxStyle = { width: fit.width, height: fit.height, transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})` };
  const pct = (p: Point): Record<string, string> => (frame ? { left: `${(p.x / frame.w) * 100}%`, top: `${(p.y / frame.h) * 100}%` } : {});
  /** Píxeles de la caja (antes del zoom) por unidad del marco: el tamaño de la letra de la caja de texto. */
  const boxPx = frame && fit.width > 0 ? fit.width / frame.w : 1;

  const toolButtons = TOOLS.map((t) => {
    const Icon = TOOL_ICONS[t];
    const label = tr(TOOL_LABELS[t]);
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
        // En una pantalla táctil no hay teclado ni Shift: sin renglones, sin globito (el nombre ya está en el ícono).
        data-tip={tipRows(
          [
            { shortcut: TOOL_SHORTCUTS[t], action: asAction(label) },
            modifiers && { gesture: 'shiftDrag', action: tr('annotate.shiftDragAct') },
            modifiers && { gesture: 'altDrag', action: tr('annotate.altDragAct') },
          ],
          tipEnv,
        )}
        onClick={() => setTool(t)}
      >
        <Icon size={20} />
      </button>
    );
  });
  const tools = (
    <div className="annotator-tools" role="toolbar" aria-label={tr('annotate.tools')}>
      {toolButtons}
    </div>
  );
  const strip = target && canEdit ? <StyleStrip tool={target.tool} style={target.style} recent={prefs.recent} onChange={changeStyle} /> : null;
  /** *Only the pencil draws* (AN8): se ve cuando en este dispositivo ya se usó un lápiz. */
  const penToggle =
    penSeen || prefs.penOnly || prefs.penSet ? (
      <label className="annotator-check annotator-pen" data-tip={tr('annotate.penOnlyTip')}>
        <input
          type="checkbox"
          checked={prefs.penOnly}
          onChange={(e) => persist({ ...prefsRef.current, penOnly: e.currentTarget.checked, penSet: true })}
        />
        <span>{tr('annotate.penOnly')}</span>
      </label>
    ) : null;

  return createPortal(
    <div
      ref={dialogRef}
      className="annotator"
      data-compact={compact ? '' : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={tr('annotate.label', { name })}
      tabIndex={-1}
    >
      <div className="annotator-bar">
        {!compact && (
          <>
            {tools}
            <span className="annotator-sep" />
          </>
        )}
        <button className="annotator-btn" aria-label={tr('annotate.undo')} data-tip={tipRows([{ shortcut: 'annotateUndo', action: tr('annotate.undoAct') }], tipEnv)} disabled={!stacks.undo} onClick={() => stepUndo('undo')}>
          <UndoIcon size={20} />
        </button>
        <button className="annotator-btn" aria-label={tr('annotate.redo')} data-tip={tipRows([{ shortcut: 'annotateRedo', action: asAction(tr('annotate.redo')) }], tipEnv)} disabled={!stacks.redo} onClick={() => stepUndo('redo')}>
          <RedoIcon size={20} />
        </button>
        <button
          className="annotator-btn"
          aria-label={tr('annotate.delete')}
          data-tip={tipRows([{ shortcut: 'annotateDelete', action: tr('annotate.deleteAct') }], tipEnv)}
          disabled={selection.length === 0 || !canEdit}
          onClick={deleteSelected}
        >
          <TrashIcon size={20} />
        </button>
        <button
          className="annotator-btn"
          aria-label={tr('annotate.fit')}
          // En el teléfono: tocar encuadra y dos dedos amplían; con el mouse, la tecla, la rueda y Espacio+arrastrar.
          data-tip={tipRows(
            [
              { gesture: touch ? 'click' : undefined, shortcut: 'annotateFit', action: tr('annotate.fitAct') },
              { gesture: 'scroll', action: tr('annotate.zoomAct') },
              touch && { gesture: 'pinch', action: tr('annotate.zoomAct') },
              { gesture: 'drag', hold: 'annotatePan', action: tr('annotate.panAct') },
            ],
            tipEnv,
          )}
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

      {!compact && (
        <div className="annotator-props">
          {strip ?? <span className="annotator-hint">{tool === 'select' && canEdit ? tr('annotate.selectHint') : ' '}</span>}
          {penToggle}
        </div>
      )}

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
        onContextMenu={(e) => {
          // Un dedo apoyado un rato abre el menú del sistema sobre la foto: con el anotador, nunca.
          if (lastInput.current !== 'mouse') e.preventDefault();
        }}
      >
        {compact && text && (
          // En el teléfono, el texto se escribe en una caja común arriba (letra de 16 px: el iPhone no amplía la página al
          // tocarla, y no la tapa el teclado); en la foto se ve cómo queda.
          <div className="annotator-textpanel">
            <textarea
              ref={textRef}
              className="annotator-textfield"
              // Lo ya escrito (auditoría O1): si la pantalla cambió de la compu al teléfono con la caja abierta, la caja
              // nueva sigue con lo escrito en la otra.
              defaultValue={typed.current ?? text.value}
              maxLength={MAX_TEXT}
              rows={2}
              aria-label={tr('annotate.text')}
              placeholder={tr('annotate.textHintTouch')}
              onInput={(e) => {
                typed.current = e.currentTarget.value;
                setDraftText(e.currentTarget.value);
              }}
            />
            <button className="annotator-done" onClick={commitText}>
              {tr('annotate.textDone')}
            </button>
          </div>
        )}
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
            {text && !compact && (
              <textarea
                ref={textRef}
                className="annotator-text"
                data-fill={text.fill ? '' : undefined}
                // Lo ya escrito, también si se escribió en la caja del teléfono (la ventana se agrandó: auditoría O1).
                defaultValue={typed.current ?? text.value}
                maxLength={MAX_TEXT}
                aria-label={tr('annotate.text')}
                placeholder={tr('annotate.textHint')}
                rows={Math.max(1, (typed.current ?? text.value).split('\n').length)}
                style={{
                  ...pct(text.at),
                  fontSize: `${text.fontSize * boxPx}px`,
                  color: text.color,
                  fontFamily: MARKUP_FONT,
                }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  typed.current = el.value;
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
                  if (Number.isFinite(n) && byId.get(id)) update([[id, { number: Math.trunc(Math.max(-99999, Math.min(99999, n))) }]]);
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

      {compact && (
        <div className="annotator-bottom">
          {sheet && (
            // La hoja de propiedades: lo de la franja de la compu, con controles grandes. Se cierra tocando la foto.
            <div className="annotator-sheet" role="group" aria-label={tr('annotate.style')}>
              <div className="annotator-sheet-head">
                <span>{target ? tr(TOOL_LABELS[target.tool]) : tr('annotate.style')}</span>
                <button className="annotator-btn" aria-label={tr('annotate.closeStyle')} onClick={() => setSheet(false)}>
                  <CloseIcon size={18} />
                </button>
              </div>
              {strip ?? <span className="annotator-hint">{tr('annotate.styleNothing')}</span>}
              {penToggle}
            </div>
          )}

          {/* La tira de abajo: las herramientas (se desliza si no entran) y el punto de color, que abre la hoja. */}
          <div className="annotator-dock">
            {tools}
            <span className="annotator-sep" />
            <button
              className="annotator-btn annotator-dot"
              aria-label={tr('annotate.style')}
              aria-expanded={sheet}
              disabled={!canEdit}
              onClick={() => setSheet((open) => !open)}
            >
              <span className="annotator-dot-color" style={{ background: target?.style.color ?? 'transparent' }} data-empty={target ? undefined : ''} />
              {target && controlsOf(target.tool).width && <span className="annotator-dot-width">{target.style.width}</span>}
            </button>
          </div>
        </div>
      )}
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
  // En una pantalla táctil, el tooltip del grosor va sin atajos (D226; por el puntero, no por el ancho).
  const tipEnv = { touch: touchScreen() };
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
        onBlur={(e) => onChange({ [key]: Number(e.currentTarget.value) }, true)}
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
        <label className="annotator-custom" data-tip={tr('annotate.customColor')}>
          <input ref={colorRef} type="color" value={style.color.toLowerCase()} aria-label={tr('annotate.customColor')} onChange={(e) => onChange({ color: e.currentTarget.value.toUpperCase() }, false)} />
        </label>
      </div>
      {show.width && (
        <>
          {range(tr('annotate.width'), style.width, SLIDER_MAX_WIDTH, 'width', tipRows(
            [
              tr('annotate.widthNote'),
              { shortcut: 'annotateWidth', action: tr('annotate.widthKeyAct') },
              { shortcut: 'annotateWidthNext', action: tr('annotate.widthNextAct') },
            ],
            tipEnv,
          ))}
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
