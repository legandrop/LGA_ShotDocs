import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import type * as Y from 'yjs';
import { t as current, useT, type Translate } from '../i18n';
import '../i18n/lazy/carrete';
import { extensionLabel } from '../media/attachments';
import { formatSize } from '../media/fileTrash';
import type { MediaKind } from '../media/probe';
import { openInNewTab } from './attachmentOpen';
import {
  clampZoom,
  classifyDrag,
  counterText,
  dismissResult,
  fitSize,
  isDoubleTap,
  isZoomed,
  neighbors,
  NO_ZOOM,
  panBy,
  pinchZoom,
  resistEdges,
  stepIndex,
  swipeResult,
  toggleZoom,
  wheelScale,
  zoomAt,
  type CarreteItem,
  type Gesture,
  type Point,
  type Size,
  type Zoom,
} from './carreteModel';
import { downloadProps, isOffline, type AttachmentView, type CarreteLoader, type Full } from './carreteLoader';
import { CarreteMarkup, useHasMarkup } from './CarreteMarkup';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, DownloadIcon, EyeIcon, EyeOffIcon, OpenIcon } from './icons';
import { shortcutLabel } from './shortcuts';

// El carrete (paso 7 de Docs/Plan_Workspaces.md; Docs/Doc_Carrete.md): todas las fotos y videos de la
// página a pantalla completa, en orden, empezando por la que se tocó. Anterior/siguiente con las flechas,
// los botones o deslizando; cerrar con Escape, el botón o deslizando hacia abajo; zoom con pellizco,
// rueda y doble toque. Primero se ve la miniatura y después lo grande (la copia del dispositivo o el
// archivo con un pase del portero). La lógica (orden, límites, zoom, gestos) está en `carreteModel.ts`.
// Un adjunto (un PDF, un zip…; Docs/Doc_Adjuntos.md, entrega 2) se ve en grande: su vista previa (la primera
// página de un PDF) o su tarjeta, el tipo y el peso, y *Open* (si el navegador lo sabe mostrar) y *Download*.

/** Separación entre un elemento y el siguiente mientras se desliza. */
const GAP = 24;
/** Abajo del video están sus controles: arrastrar ahí no cambia de elemento. */
const VIDEO_CONTROLS = 72;

/**
 * `unsupported`: el original del dispositivo no se puede mostrar (el navegador no abre el formato);
 * `unplayable`: lo que vino del portero no se pudo mostrar, y no se sabe si fue la red o el formato (se
 * puede reintentar con un pase nuevo); `failed`: no se pudo pedir (error del portero).
 */
type FullState = 'idle' | 'loading' | 'ready' | 'offline' | 'failed' | 'unsupported' | 'unplayable';

interface View {
  kind: MediaKind | null;
  name: string;
  preview: string | null;
  full: Full | null;
  state: FullState;
  error: string | null;
  /** Medidas de la foto (de la miniatura o de la grande: la proporción es la misma). */
  natural: Size | null;
  /** La foto grande ya se dibujó: la miniatura queda tapada. */
  fullShown: boolean;
  /** La vista previa es la versión grande guardada en el dispositivo (para el aviso sin red). */
  large: boolean;
  /** Es un adjunto (ver `AttachmentView`), o `null`. */
  file: AttachmentView | null;
  /** La dirección para abrir el adjunto en otra pestaña: `undefined` mientras se prepara, `null` si no se puede. */
  openUrl?: string | null;
}

const EMPTY_VIEW: View = {
  kind: null,
  name: '',
  preview: null,
  full: null,
  state: 'idle',
  error: null,
  natural: null,
  fullShown: false,
  large: false,
  file: null,
};

/** Formatos de foto que muchos navegadores no abren. */
const RARE_PHOTO = /\.(heic|heif|dng|tiff?|raw|cr2|cr3|nef|arw)$/i;

interface DragState {
  gesture: Gesture | 'pending' | 'pinch';
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  /** Para la velocidad al soltar. */
  samples: { t: number; x: number; y: number }[];
  startZoom: Zoom;
  pinch?: { distance: number; mid: Point };
}

export interface CarreteProps {
  items: CarreteItem[];
  start: number;
  /** Lo crea y lo suelta (`dispose`) quien abre el carrete. */
  loader: CarreteLoader;
  /** Hay red (para volver a pedir lo grande cuando vuelve). */
  online: boolean;
  onClose: () => void;
  /**
   * Las anotaciones de las fotos de la página (P.20, el mapa `photoMarkup` de su documento): se dibujan encima de cada
   * foto anotada. Sin esto (las fotos de una carpeta), no hay anotaciones.
   */
  markup?: Y.Map<unknown> | null;
}

export function Carrete({ items, start, loader, online, onClose, markup = null }: CarreteProps) {
  const count = items.length;
  const tr = useT();
  const [index, setIndex] = useState(() => stepIndex(start, 0, count));
  const [views, setViews] = useState<Record<string, View>>({});
  const [zoom, setZoom] = useState<Zoom>(NO_ZOOM);
  const [zoomAnim, setZoomAnim] = useState(false);
  const [track, setTrack] = useState<{ x: number; anim: boolean }>({ x: 0, anim: false });
  const [dismissY, setDismissY] = useState(0);
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 });
  /** Sube con "Retry": vuelve a pedir lo grande del elemento actual. */
  const [attempt, setAttempt] = useState(0);
  /** *Hide annotations* (AN9): solo para quien mira, mientras el carrete está abierto; no se guarda. */
  const [markupHidden, setMarkupHidden] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewsRef = useRef(views);
  viewsRef.current = views;
  const drag = useRef<DragState | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  /** Con qué se usó el carrete por última vez (al cerrar con el dedo, el foco no vuelve al editor). */
  const lastPointerType = useRef<string>(typeof matchMedia === 'function' && matchMedia('(hover: none)').matches ? 'touch' : 'mouse');
  const preloaded = useRef(new Set<string>());
  const mounted = useRef(true);
  /** Marca de la entrada del historial que abre el carrete ("atrás" lo cierra). */
  const historyToken = useRef(`carrete-${Math.random().toString(36).slice(2)}`);
  const closing = useRef(false);

  // La lista puede cambiar con el carrete abierto (llegó la respuesta de qué era un archivo: una carpeta sale). Se
  // sigue en el mismo elemento; si era el que salió, en el que quedó en su lugar.
  const shownItems = useRef(items);
  if (shownItems.current !== items) {
    const was = shownItems.current[index]?.key;
    shownItems.current = items;
    const at = items.findIndex((it) => it.key === was);
    const next = at >= 0 ? at : Math.min(index, Math.max(0, items.length - 1));
    if (next !== index) setIndex(next);
  }

  const item = items[Math.min(index, items.length - 1)];
  const view = settled((item && views[item.url]) ?? EMPTY_VIEW);
  const fit = view.natural ? fitSize(view.natural, stage) : null;
  const zoomable = view.kind === 'image' && !!view.preview;
  /** La foto que se ve tiene anotaciones (el botón para ocultarlas solo aparece entonces). */
  const annotated = useHasMarkup(markup, view.kind === 'image' && !view.file ? (item?.mediaId ?? null) : null);

  // Lo que los manejadores nativos (rueda, teclado) necesitan leer sin volver a registrarse.
  const live = useRef({ index, zoom, fit, stage, zoomable, count });
  live.current = { index, zoom, fit, stage, zoomable, count };

  const patch = useCallback((url: string, changes: Partial<View>) => {
    if (!mounted.current) return;
    setViews((all) => ({ ...all, [url]: { ...(all[url] ?? EMPTY_VIEW), ...changes } }));
  }, []);

  // --- abrir y cerrar -----------------------------------------------------------------------------

  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    // Lo de atrás (la app) queda inerte: ni el foco ni los lectores de pantalla llegan ahí.
    const dialog = dialogRef.current;
    const inerted = [...document.body.children].filter((el) => el !== dialog && !el.hasAttribute('inert') && !el.contains(dialog));
    for (const el of inerted) el.setAttribute('inert', '');
    dialog?.focus({ preventScroll: true });
    return () => {
      mounted.current = false;
      root.style.overflow = overflow;
      for (const el of inerted) el.removeAttribute('inert');
      // Vuelve el foco a donde estaba. Con el dedo, no al editor: abriría el teclado.
      if (previous?.isConnected && !(lastPointerType.current !== 'mouse' && previous.isContentEditable)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Al girar el teléfono (o cambiar la ventana) la foto ampliada se vuelve a encuadrar.
  useEffect(() => {
    if (fit) setZoom((z) => clampZoom(z, fit, stage));
    // Solo cuando cambia el escenario.
  }, [stage.width, stage.height]); // eslint-disable-line react-hooks/exhaustive-deps

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // "Atrás" (Android, el navegador) cierra el carrete: al abrir se suma una entrada al historial, con la
  // misma dirección. Cerrar con la X, Escape o deslizando la saca (`history.back()`), sin salir de la
  // página. Si el navegador no avisa la vuelta, se cierra igual al rato.
  useEffect(() => {
    const token = historyToken.current;
    const state = history.state as { carrete?: string } | null;
    if (state?.carrete !== token) history.pushState({ ...(state ?? {}), carrete: token }, '');
    const onPop = () => {
      if ((history.state as { carrete?: string } | null)?.carrete !== token) onCloseRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const requestClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if ((history.state as { carrete?: string } | null)?.carrete === historyToken.current) {
      history.back();
      setTimeout(() => mounted.current && onCloseRef.current(), 400);
    } else onCloseRef.current();
  }, []);

  // --- navegación ---------------------------------------------------------------------------------

  const go = useCallback(
    (delta: number, fromX = 0) => {
      const { index: at, count: total, stage: size } = live.current;
      const next = stepIndex(at, delta, total);
      if (next === at) {
        setTrack({ x: 0, anim: true });
        return;
      }
      videoRef.current?.pause();
      setIndex(next);
      setZoom(NO_ZOOM);
      setDismissY(0);
      lastTap.current = null;
      // El nuevo elemento arranca donde estaba (al costado, o bajo el dedo) y se desliza a su lugar.
      const dir = next > at ? 1 : -1;
      setTrack({ x: fromX + dir * (size.width + GAP), anim: false });
      requestAnimationFrame(() => requestAnimationFrame(() => mounted.current && setTrack({ x: 0, anim: true })));
    },
    [],
  );

  const goTo = useCallback((target: number) => go(target - live.current.index), [go]);

  // Teclado: en captura, para que los atajos de la app no actúen debajo del carrete.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      let handled = true;
      if (e.key === 'Escape') requestClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Home') goTo(0);
      else if (e.key === 'End') goTo(live.current.count - 1);
      else if (e.key === 'Tab') {
        trapTab(dialog, e);
        e.stopPropagation();
        return;
      } else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      } else if (e.ctrlKey || e.metaKey) {
        e.stopPropagation();
      }
    };
    // Si el foco sale del carrete (un clic en algo de afuera), vuelve.
    const onFocus = (e: FocusEvent) => {
      const dialog = dialogRef.current;
      if (dialog && e.target instanceof Node && !dialog.contains(e.target)) dialog.focus({ preventScroll: true });
    };
    // Safari (iPhone) hace zoom de la página con el pellizco aunque no deba.
    const noPageZoom = (e: Event) => {
      if (dialogRef.current?.contains(e.target as Node)) e.preventDefault();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('gesturestart', noPageZoom);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('gesturestart', noPageZoom);
    };
  }, [go, goTo, requestClose]);

  // --- cargar lo que se ve ------------------------------------------------------------------------

  // Las miniaturas del elemento y de sus vecinos (se ven mientras se desliza).
  useEffect(() => {
    for (const i of [index, ...neighbors(index, count)]) {
      const it = items[i];
      const known = viewsRef.current[it.url];
      if (known?.preview && (known.kind || known.file)) continue;
      void loader.preview(it).then((p) => patch(it.url, { kind: p.kind, name: p.name, preview: p.preview, large: !!p.large, file: p.file ?? null }));
    }
  }, [index, count, items, loader, patch, online]);

  // Un adjunto que se puede abrir: la dirección se prepara apenas se lo ve (Safari no deja abrir una pestaña
  // después de esperar), y otra vez si vuelve la red.
  const canOpenNow = !!view.file?.canOpen;
  useEffect(() => {
    const it = items[index];
    const known = it ? viewsRef.current[it.url] : undefined;
    if (!it || !canOpenNow || !loader.open || known?.openUrl) return;
    void loader
      .open(it)
      .catch(() => null)
      .then((url) => patch(it.url, { openUrl: url }));
  }, [index, items, loader, patch, online, canOpenNow, attempt]);

  // Lo grande del elemento actual; si no se pudo por la red, se vuelve a pedir cuando vuelve.
  useEffect(() => {
    const it = items[index];
    if (!it) return;
    const known = viewsRef.current[it.url];
    if (known && (known.state === 'loading' || known.state === 'ready' || known.state === 'unsupported' || known.state === 'unplayable')) return;
    if (known?.full && known.state !== 'failed' && known.state !== 'offline') return;
    patch(it.url, { state: 'loading', error: null });
    loader.full(it).then(
      // Una foto queda lista al dibujarse (`onFullLoad`); un video, ya con la dirección (ver `settled`).
      (full) => patch(it.url, { full, state: 'loading' }),
      (err: unknown) => patch(it.url, { state: isOffline(err) ? 'offline' : 'failed', error: err instanceof Error ? err.message : String(err) }),
    );
  }, [index, items, loader, patch, online, attempt]);

  /** Otra vez, con un pase nuevo: lo que vino del portero no se pudo mostrar. */
  const retry = () => {
    const it = items[index];
    if (!it) return;
    loader.retry(it);
    patch(it.url, { state: 'idle', full: null, fullShown: false, error: null });
    setAttempt((n) => n + 1);
  };

  // Con el actual listo, se precargan las fotos de al lado (nunca videos). Sin gastar de más: solo los
  // dos vecinos, y nada si el navegador pide ahorrar datos.
  const currentSettled = view.state !== 'loading' && view.state !== 'idle';
  useEffect(() => {
    if (!currentSettled || !online || saveData()) return;
    for (const i of neighbors(index, count)) {
      const it = items[i];
      void loader
        .preview(it)
        .then(async (p) => {
          // Ni videos ni formatos que muchos navegadores no abren (HEIC, DNG, TIFF): serían megas para nada.
          if (p.kind !== 'image' || RARE_PHOTO.test(p.name)) return;
          const full = await loader.full(it);
          if (preloaded.current.has(full.url)) return;
          preloaded.current.add(full.url);
          const img = new Image();
          img.decoding = 'async';
          img.src = full.url;
        })
        .catch(() => undefined);
    }
  }, [currentSettled, index, count, items, loader, online]);

  // --- lo que pasa con la foto o el video ---------------------------------------------------------

  const onNatural = (url: string) => (e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth > 0 && img.naturalHeight > 0 && !viewsRef.current[url]?.natural) {
      patch(url, { natural: { width: img.naturalWidth, height: img.naturalHeight } });
    }
  };

  const onFullLoad = (url: string) => (e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    patch(url, {
      state: 'ready',
      fullShown: true,
      natural: img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : viewsRef.current[url]?.natural ?? null,
    });
  };

  // Lo del dispositivo que no se muestra es el formato; lo del portero puede ser el formato, la red o un
  // pase vencido: no se sabe, y se ofrece reintentar.
  const brokenState = (v: View): FullState => {
    if (!v.full?.local && typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
    return v.full?.local ? 'unsupported' : 'unplayable';
  };

  const onFullError = (it: CarreteItem, v: View) => () => patch(it.url, { state: brokenState(v) });

  const onVideoError = (it: CarreteItem, v: View) => () => patch(it.url, { state: brokenState(v), error: null });

  // Un video que el navegador abre pero no sabe decodificar (HEVC en algunos) queda sin imagen: sin
  // ancho ni alto. Se trata como no reproducible.
  const onVideoMeta = (it: CarreteItem, v: View) => (e: SyntheticEvent<HTMLVideoElement>) => {
    const el = e.currentTarget;
    if (el.videoWidth === 0 && el.videoHeight === 0) patch(it.url, { state: brokenState(v) });
  };

  // Al desmontar o cambiar el video se suelta del todo (pausar no corta la descarga).
  const videoRefCb = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (!el) return;
    return () => {
      if (videoRef.current === el) videoRef.current = null;
      el.pause();
      el.removeAttribute('src');
      el.load();
    };
  }, []);

  // --- gestos -------------------------------------------------------------------------------------

  const pointFrom = (clientX: number, clientY: number): Point => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, .carrete-notice')) return;
    // Los controles del video son suyos: con el mouse no se arrastra sobre el video, y con el dedo solo
    // por arriba de sus controles.
    if (target instanceof HTMLVideoElement) {
      if (e.pointerType === 'mouse') return;
      const rect = target.getBoundingClientRect();
      if (e.clientY > rect.bottom - VIDEO_CONTROLS) return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && live.current.zoomable) {
      const [a, b] = [...pointers.current.values()];
      drag.current = {
        gesture: 'pinch',
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        samples: [],
        startZoom: live.current.zoom,
        pinch: { distance: Math.hypot(a.x - b.x, a.y - b.y), mid: pointFrom((a.x + b.x) / 2, (a.y + b.y) / 2) },
      };
      setTrack({ x: 0, anim: true });
      setDismissY(0);
      capture(e.currentTarget, [...pointers.current.keys()]);
      return;
    }
    if (pointers.current.size > 1) return;
    drag.current = {
      gesture: 'pending',
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      samples: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }],
      startZoom: live.current.zoom,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const { fit: f, stage: size, index: at, count: total } = live.current;

    if (d.gesture === 'pinch') {
      if (pointers.current.size < 2 || !d.pinch || !f) return;
      const [a, b] = [...pointers.current.values()];
      setZoomAnim(false);
      setZoom(pinchZoom(d.startZoom, d.pinch.distance, d.pinch.mid, Math.hypot(a.x - b.x, a.y - b.y), pointFrom((a.x + b.x) / 2, (a.y + b.y) / 2), f, size));
      return;
    }
    if (e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    d.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    if (d.samples.length > 6) d.samples.shift();

    if (d.gesture === 'pending') {
      const g = classifyDrag(dx, dy, isZoomed(live.current.zoom));
      if (g === 'none') return;
      d.gesture = g;
      capture(e.currentTarget, [e.pointerId]);
    }
    if (d.gesture === 'swipe') setTrack({ x: resistEdges(dx, at, total), anim: false });
    else if (d.gesture === 'dismiss') setDismissY(Math.max(0, dy));
    else if (d.gesture === 'pan' && f) {
      // El movimiento se calcula ya: `d` cambia antes de que React aplique la actualización.
      const mx = e.clientX - d.lastX;
      const my = e.clientY - d.lastY;
      setZoomAnim(false);
      setZoom((z) => panBy(z, mx, my, f, size));
    }
    d.lastX = e.clientX;
    d.lastY = e.clientY;
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const was = pointers.current.delete(e.pointerId);
    if (!d || !was) return;
    const { stage: size, index: at, count: total, fit: f, zoomable: canZoom } = live.current;

    if (d.gesture === 'pinch') {
      // Queda un dedo: sigue moviendo la foto ampliada con ese.
      const rest = [...pointers.current.entries()][0];
      if (rest) {
        drag.current = { ...d, gesture: 'pan', pointerId: rest[0], lastX: rest[1].x, lastY: rest[1].y, samples: [] };
      } else drag.current = null;
      return;
    }
    if (e.pointerId !== d.pointerId) return;
    drag.current = null;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const v = velocity(d.samples, e.timeStamp);

    if (d.gesture === 'swipe') {
      const r = e.type === 'pointercancel' ? 0 : swipeResult(dx, v.x, size.width, at, total);
      if (r) go(r, resistEdges(dx, at, total));
      else setTrack({ x: 0, anim: true });
    } else if (d.gesture === 'dismiss') {
      if (e.type !== 'pointercancel' && dismissResult(dy, v.y, size.height)) requestClose();
      else setDismissY(0);
    } else if (d.gesture === 'pending' && e.type === 'pointerup') {
      // Un toque. Dos seguidos (o doble clic) sobre una foto: amplía ahí, o vuelve a la foto entera.
      const tap = { at: e.timeStamp, x: e.clientX, y: e.clientY };
      if (canZoom && f && isDoubleTap(lastTap.current, tap)) {
        lastTap.current = null;
        setZoomAnim(true);
        const at = pointFrom(e.clientX, e.clientY);
        setZoom((z) => toggleZoom(z, at, f, size));
      } else lastTap.current = tap;
    }
  };

  // La rueda (y el pellizco del trackpad, que llega como rueda con Ctrl) amplía donde está el cursor. En
  // Safari de la Mac el pellizco llega como `gesturechange`.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { zoom: z, fit: f, stage: size, zoomable: canZoom } = live.current;
      if (!canZoom || !f) return;
      setZoomAnim(false);
      setZoom(zoomAt(z, wheelScale(z, e.deltaY, e.deltaMode, e.ctrlKey), pointFrom(e.clientX, e.clientY), f, size));
    };
    let gestureStart: Zoom | null = null;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureStart = live.current.zoom;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      // En el iPhone el pellizco ya llega como dos dedos (pointer events).
      if (pointers.current.size >= 2 || !gestureStart) return;
      const g = e as Event & { scale?: number; clientX?: number; clientY?: number };
      const { fit: f, stage: size, zoomable: canZoom } = live.current;
      if (!canZoom || !f || !g.scale) return;
      setZoomAnim(false);
      const at = g.clientX !== undefined && g.clientY !== undefined ? pointFrom(g.clientX, g.clientY) : { x: 0, y: 0 };
      setZoom(zoomAt(gestureStart, gestureStart.scale * g.scale, at, f, size));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
    };
  }, []);

  // --- pantalla -----------------------------------------------------------------------------------

  if (!item) return null;
  const name = view.name || item.name;
  const download = view.full ?? (item.source === 'web' ? { url: item.url, local: item.url.startsWith('data:') } : null);
  const fade = stage.height > 0 ? Math.max(0.25, 1 - dismissY / stage.height) : 1;
  const zoomed = isZoomed(zoom);

  const downloadLink = (className: string, label: boolean) =>
    download ? (
      <a className={className} {...downloadProps(download, name)} aria-label={tr('carrete.downloadNamed', { name })}>
        <DownloadIcon size={20} />
        {label && <span className="carrete-btn-label">{tr('carrete.download')}</span>}
      </a>
    ) : (
      <button className={className} disabled aria-label={tr('carrete.downloadOffline', { name })}>
        <DownloadIcon size={20} />
        {label && <span className="carrete-btn-label">{tr('carrete.download')}</span>}
      </button>
    );

  const renderSlot = (i: number) => {
    const it = items[i];
    const offset = i - index;
    const current = offset === 0;
    const v = settled(views[it.url] ?? EMPTY_VIEW);
    const f = v.natural ? fitSize(v.natural, stage) : null;
    const sized = f && f.width > 0 ? { width: f.width, height: f.height } : undefined;
    const style = {
      transform: `translate3d(calc(${offset * 100}% + ${offset * GAP}px), ${current ? dismissY : 0}px, 0)`,
    };
    const alt = it.caption || v.name || it.name;
    let body;
    if (v.file) {
      body = fileBody(it, v, current, alt);
    } else if (current && v.kind === 'video' && v.full && v.state !== 'unsupported' && v.state !== 'unplayable' && v.state !== 'offline') {
      body = (
        <video
          key={v.full.url}
          ref={videoRefCb}
          className="carrete-video"
          src={v.full.url}
          poster={v.preview ?? undefined}
          controls
          playsInline
          preload="metadata"
          aria-label={alt}
          onError={onVideoError(it, v)}
          onLoadedMetadata={onVideoMeta(it, v)}
        />
      );
    } else {
      const showFull =
        current && v.kind !== 'video' && v.full && v.state !== 'unsupported' && v.state !== 'unplayable' && v.state !== 'offline';
      body = (
        <div
          className="carrete-media"
          style={{
            ...sized,
            transform: current ? `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})` : undefined,
          }}
          data-anim={current && zoomAnim ? '' : undefined}
        >
          {v.preview && !(showFull && v.fullShown) && (
            <img className="carrete-preview" src={v.preview} alt={showFull ? '' : alt} draggable={false} onLoad={onNatural(it.url)} />
          )}
          {showFull && (
            <img
              className="carrete-full"
              data-shown={v.fullShown ? '' : undefined}
              src={v.full!.url}
              alt={alt}
              draggable={false}
              onLoad={onFullLoad(it.url)}
              onError={onFullError(it, v)}
            />
          )}
          {/* Las anotaciones, en la misma caja que la foto (ya tiene su proporción y su zoom); nunca sobre la tarjeta
              de la cola (un SVG `data:`: sin copia en el dispositivo, borrada), salvo que ya se vea el original. */}
          {markup && it.mediaId && sized && v.preview && v.kind === 'image' && !markupHidden &&
            (!v.preview.startsWith('data:image/svg') || (showFull && v.fullShown)) && (
            <CarreteMarkup map={markup} fileId={it.mediaId} size={sized} />
          )}
        </div>
      );
    }
    return (
      <div key={it.url + ':' + i} className="carrete-slot" style={style} aria-hidden={current ? undefined : true}>
        {body}
      </div>
    );
  };

  /** Un adjunto en grande: la vista previa (o la tarjeta), el tipo y el peso, y abrir y bajar. */
  const fileBody = (it: CarreteItem, v: View, current: boolean, alt: string) => {
    const file = v.file!;
    const meta = [extensionLabel(v.name || it.name, file.mime), file.size ? formatSize(file.size) : ''].filter(Boolean).join(' · ');
    const inline = current ? noticeFor(v, v.name || it.name, tr) : null;
    return (
      <div className="carrete-file" data-card={file.card ? '' : undefined}>
        {v.preview && <img className="carrete-file-preview" src={v.preview} alt={alt} draggable={false} />}
        {!file.card && meta && <p className="carrete-file-meta">{meta}</p>}
        {current && (
          <div className="carrete-file-actions">
            {file.canOpen && (
              <button
                className="carrete-notice-btn carrete-file-open"
                disabled={!v.openUrl}
                onClick={() => v.openUrl && openInNewTab(v.openUrl)}
              >
                <OpenIcon size={18} />
                <span>{v.openUrl === undefined && online ? tr('carrete.preparing') : tr('carrete.open')}</span>
              </button>
            )}
            {downloadLink('carrete-notice-btn', true)}
          </div>
        )}
        {inline && (
          <p className="carrete-file-note" role="status">
            {inline}
          </p>
        )}
        {inline && v.state === 'failed' && (
          <button className="carrete-notice-btn" onClick={retry}>
            {tr('common.retry')}
          </button>
        )}
      </div>
    );
  };

  // Un adjunto dice lo suyo adentro de su tarjeta grande.
  const notice = view.file ? null : noticeFor(view, name, tr);

  return createPortal(
    <div
      ref={dialogRef}
      className="carrete"
      role="dialog"
      aria-modal="true"
      aria-label={tr('carrete.label')}
      tabIndex={-1}
      style={{ ['--carrete-fade' as string]: String(fade) }}
      onPointerDownCapture={(e) => {
        lastPointerType.current = e.pointerType;
      }}
    >
      <div className="carrete-bar">
        <span className="carrete-count" aria-live="polite" aria-atomic="true">
          {counterText(index, count)}
        </span>
        <span className="carrete-name" data-tip={name} data-tip-plain data-tip-overflow>
          {name}
        </span>
        {annotated && (
          <button
            className="carrete-btn carrete-markup-toggle"
            aria-label={tr(markupHidden ? 'carrete.showMarkup' : 'carrete.hideMarkup')}
            aria-pressed={markupHidden}
            onClick={() => setMarkupHidden((h) => !h)}
          >
            {markupHidden ? <EyeIcon size={20} /> : <EyeOffIcon size={20} />}
            <span className="carrete-btn-label">{tr(markupHidden ? 'carrete.showMarkup' : 'carrete.hideMarkup')}</span>
          </button>
        )}
        {downloadLink('carrete-btn', true)}
        <button className="carrete-btn" aria-label={tr('common.close')} data-tip={tr('carrete.keyboard', { key: shortcutLabel('carreteClose') })} onClick={requestClose}>
          <CloseIcon size={22} />
        </button>
      </div>

      <div
        ref={stageRef}
        className="carrete-stage"
        data-zoomed={zoomed ? '' : undefined}
        data-zoomable={zoomable ? '' : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onDragStart={(e) => e.preventDefault()}
      >
        <div className="carrete-track" style={{ transform: `translate3d(${track.x}px, 0, 0)` }} data-anim={track.anim ? '' : undefined}>
          {[index - 1, index, index + 1].filter((i) => i >= 0 && i < count).map(renderSlot)}
        </div>

        {view.state === 'loading' && view.preview && <span className="carrete-spinner" role="status" aria-label={tr('common.loading')} />}

        {/* Con las anotaciones ocultas, una marca chica en la esquina avisa que la foto las tiene (AN9). */}
        {annotated && markupHidden && (
          <span className="carrete-markup-mark" role="img" aria-label={tr('carrete.markupHidden')}>
            <EyeOffIcon size={16} />
          </span>
        )}

        {notice && (
          <div className="carrete-notice" role="status">
            <p>{notice}</p>
            {(view.state === 'unplayable' || view.state === 'failed') && (
              <button className="carrete-notice-btn" onClick={retry}>
                {tr('common.retry')}
              </button>
            )}
            {(view.state === 'unsupported' || view.state === 'unplayable' || view.state === 'failed') &&
              download &&
              downloadLink('carrete-notice-btn', true)}
          </div>
        )}

        {count > 1 && (
          <>
            <button
              className="carrete-nav carrete-prev"
              aria-label={tr('carrete.previous')}
              data-tip={tr('carrete.keyboard', { key: shortcutLabel('carretePrev') })}
              disabled={index === 0} onClick={() => go(-1)}>
              <ChevronLeftIcon size={26} />
            </button>
            <button
              className="carrete-nav carrete-next"
              aria-label={tr('carrete.next')}
              data-tip={tr('carrete.keyboard', { key: shortcutLabel('carreteNext') })}
              disabled={index === count - 1}
              onClick={() => go(1)}
            >
              <ChevronRightIcon size={26} />
            </button>
          </>
        )}
      </div>

      {item.caption && <p className="carrete-caption">{item.caption}</p>}
    </div>,
    document.body,
  );
}

/** Un video está listo apenas tiene dirección: el reproductor muestra su propia carga. Un adjunto, también. */
function settled(v: View): View {
  return (v.kind === 'video' || v.file) && v.full && v.state === 'loading' ? { ...v, state: 'ready' } : v;
}

/** El aviso bajo la foto o el video, si hace falta uno. */
export function noticeFor(
  view: Pick<View, 'kind' | 'state' | 'preview' | 'error'> & { large?: boolean; file?: AttachmentView | null },
  name: string,
  tr: Translate = current,
): string | null {
  const video = view.kind === 'video';
  if (view.file) {
    if (view.state === 'offline') return tr('carrete.offlineFile');
    if (view.state === 'failed') return view.error ? tr('carrete.failedFileReason', { reason: view.error }) : tr('carrete.failedFile');
    return null;
  }
  switch (view.state) {
    case 'offline':
      if (!view.kind && !view.preview) return tr('carrete.offlineMissing');
      if (video) return tr('carrete.offlineVideo');
      // Sin red se ve lo que hay en el dispositivo: la versión grande (la nítida guardada) o la miniatura.
      return tr(view.large ? 'carrete.offlinePhotoLarge' : 'carrete.offlinePhoto');
    case 'unplayable':
      return video ? tr('carrete.unplayableVideo') : tr('carrete.unplayablePhoto');
    case 'unsupported':
      if (video) return tr('carrete.unsupportedVideo');
      return RARE_PHOTO.test(name) ? tr('carrete.rarePhoto') : tr('carrete.unsupportedPhoto');
    case 'failed':
      if (view.error) return tr(video ? 'carrete.failedVideoReason' : 'carrete.failedPhotoReason', { reason: view.error });
      return video ? tr('carrete.failedVideo') : tr('carrete.failedPhoto');
    default:
      return null;
  }
}

/** Velocidad (px/ms) de los últimos movimientos. */
function velocity(samples: { t: number; x: number; y: number }[], now: number): Point {
  const recent = samples.filter((s) => now - s.t < 120);
  if (recent.length < 2) return { x: 0, y: 0 };
  const a = recent[0];
  const b = recent[recent.length - 1];
  const dt = Math.max(1, b.t - a.t);
  return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
}

function capture(el: HTMLElement, ids: number[]): void {
  for (const id of ids) {
    try {
      el.setPointerCapture(id);
    } catch {
      // El puntero ya no está.
    }
  }
}

function saveData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

const FOCUSABLE = 'button:not([disabled]), a[href], video[controls], [tabindex]:not([tabindex="-1"])';

/** Tab y Shift+Tab dan la vuelta adentro del carrete. */
function trapTab(dialog: HTMLElement, e: KeyboardEvent): void {
  const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[aria-hidden="true"]'));
  if (items.length === 0) {
    e.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}
