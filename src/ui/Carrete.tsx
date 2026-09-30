import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import type { MediaKind } from '../media/probe';
import {
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
} from './carrete';
import { isOffline, type CarreteLoader, type Full } from './carreteLoader';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, DownloadIcon } from './icons';

// El carrete (paso 7 de Docs/Plan_Workspaces.md; Docs/Doc_Carrete.md): todas las fotos y videos de la
// página a pantalla completa, en orden, empezando por la que se tocó. Anterior/siguiente con las flechas,
// los botones o deslizando; cerrar con Escape, el botón o deslizando hacia abajo; zoom con pellizco,
// rueda y doble toque. Primero se ve la miniatura y después lo grande (la copia del dispositivo o el
// archivo con un pase del portero). La lógica (orden, límites, zoom, gestos) está en `carrete.ts`.

/** Separación entre un elemento y el siguiente mientras se desliza. */
const GAP = 24;
/** Abajo del video están sus controles: arrastrar ahí no cambia de elemento. */
const VIDEO_CONTROLS = 72;

type FullState = 'idle' | 'loading' | 'ready' | 'offline' | 'failed' | 'unsupported';

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
}

const EMPTY_VIEW: View = { kind: null, name: '', preview: null, full: null, state: 'idle', error: null, natural: null, fullShown: false };

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
}

export function Carrete({ items, start, loader, online, onClose }: CarreteProps) {
  const count = items.length;
  const [index, setIndex] = useState(() => stepIndex(start, 0, count));
  const [views, setViews] = useState<Record<string, View>>({});
  const [zoom, setZoom] = useState<Zoom>(NO_ZOOM);
  const [zoomAnim, setZoomAnim] = useState(false);
  const [track, setTrack] = useState<{ x: number; anim: boolean }>({ x: 0, anim: false });
  const [dismissY, setDismissY] = useState(0);
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 });

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

  const item = items[index];
  const view = settled((item && views[item.url]) ?? EMPTY_VIEW);
  const fit = view.natural ? fitSize(view.natural, stage) : null;
  const zoomable = view.kind === 'image' && !!view.preview;

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
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      mounted.current = false;
      root.style.overflow = overflow;
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
      if (e.key === 'Escape') onClose();
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
  }, [go, goTo, onClose]);

  // --- cargar lo que se ve ------------------------------------------------------------------------

  // Las miniaturas del elemento y de sus vecinos (se ven mientras se desliza).
  useEffect(() => {
    for (const i of [index, ...neighbors(index, count)]) {
      const it = items[i];
      const known = viewsRef.current[it.url];
      if (known?.preview && known.kind) continue;
      void loader.preview(it).then((p) => patch(it.url, { kind: p.kind, name: p.name, preview: p.preview }));
    }
  }, [index, count, items, loader, patch, online]);

  // Lo grande del elemento actual; si no se pudo por la red, se vuelve a pedir cuando vuelve.
  useEffect(() => {
    const it = items[index];
    if (!it) return;
    const known = viewsRef.current[it.url];
    if (known && (known.state === 'loading' || known.state === 'ready' || known.state === 'unsupported')) return;
    if (known?.full && known.state !== 'failed' && known.state !== 'offline') return;
    patch(it.url, { state: 'loading', error: null });
    loader.full(it).then(
      // Una foto queda lista al dibujarse (`onFullLoad`); un video, ya con la dirección (ver `settled`).
      (full) => patch(it.url, { full, state: 'loading' }),
      (err: unknown) => patch(it.url, { state: isOffline(err) ? 'offline' : 'failed', error: err instanceof Error ? err.message : String(err) }),
    );
  }, [index, items, loader, patch, online]);

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
          if (p.kind !== 'image') return;
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

  const onFullError = (it: CarreteItem, v: View) => () => {
    if (!v.full?.local && typeof navigator !== 'undefined' && navigator.onLine === false) patch(it.url, { state: 'offline' });
    else patch(it.url, { state: 'unsupported' });
  };

  const onVideoError = (url: string) => (e: SyntheticEvent<HTMLVideoElement>) => {
    const code = e.currentTarget.error?.code;
    if (code === 2 /* MEDIA_ERR_NETWORK */) {
      patch(url, { state: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'failed', error: null });
    } else patch(url, { state: 'unsupported' });
  };

  // Un video que el navegador abre pero no sabe decodificar (HEVC en algunos) queda sin imagen: sin
  // ancho ni alto. Se trata como no reproducible.
  const onVideoMeta = (url: string) => (e: SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    if (v.videoWidth === 0 && v.videoHeight === 0) patch(url, { state: 'unsupported' });
  };

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
      if (e.type !== 'pointercancel' && dismissResult(dy, v.y, size.height)) onClose();
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
      <a
        className={className}
        href={download.url}
        download={name}
        // Un archivo de otro sitio (el portero) no se baja con su nombre: se abre en otra pestaña.
        {...(download.local ? {} : { target: '_blank', rel: 'noreferrer' })}
        aria-label={`Download ${name}`}
      >
        <DownloadIcon size={20} />
        {label && <span className="carrete-btn-label">Download</span>}
      </a>
    ) : (
      <button className={className} disabled aria-label={`Download ${name} (not available offline)`}>
        <DownloadIcon size={20} />
        {label && <span className="carrete-btn-label">Download</span>}
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
    if (current && v.kind === 'video' && v.full && v.state !== 'unsupported' && v.state !== 'offline') {
      body = (
        <video
          key={v.full.url}
          ref={videoRef}
          className="carrete-video"
          src={v.full.url}
          poster={v.preview ?? undefined}
          controls
          playsInline
          preload="metadata"
          aria-label={alt}
          onError={onVideoError(it.url)}
          onLoadedMetadata={onVideoMeta(it.url)}
        />
      );
    } else {
      const showFull = current && v.kind !== 'video' && v.full && v.state !== 'unsupported' && v.state !== 'offline';
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
        </div>
      );
    }
    return (
      <div key={it.url + ':' + i} className="carrete-slot" style={style} aria-hidden={current ? undefined : true}>
        {body}
      </div>
    );
  };

  const notice = noticeFor(view, name);

  return createPortal(
    <div
      ref={dialogRef}
      className="carrete"
      role="dialog"
      aria-modal="true"
      aria-label="Photos and videos"
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
        {downloadLink('carrete-btn', true)}
        <button className="carrete-btn" aria-label="Close" data-tip="**Keyboard:** Esc" onClick={onClose}>
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

        {view.state === 'loading' && view.preview && <span className="carrete-spinner" role="status" aria-label="Loading" />}

        {notice && (
          <div className="carrete-notice" role="status">
            <p>{notice}</p>
            {(view.state === 'unsupported' || view.state === 'failed') && download && downloadLink('carrete-notice-btn', true)}
          </div>
        )}

        {count > 1 && (
          <>
            <button className="carrete-nav carrete-prev" aria-label="Previous" data-tip="**Keyboard:** ←" disabled={index === 0} onClick={() => go(-1)}>
              <ChevronLeftIcon size={26} />
            </button>
            <button
              className="carrete-nav carrete-next"
              aria-label="Next"
              data-tip="**Keyboard:** →"
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

/** Un video está listo apenas tiene dirección: el reproductor muestra su propia carga. */
function settled(v: View): View {
  return v.kind === 'video' && v.full && v.state === 'loading' ? { ...v, state: 'ready' } : v;
}

/** El aviso bajo la foto o el video, si hace falta uno. */
export function noticeFor(view: Pick<View, 'kind' | 'state' | 'preview' | 'error'>, name: string): string | null {
  const video = view.kind === 'video';
  switch (view.state) {
    case 'offline':
      if (!view.kind && !view.preview) return "You're offline, and this file isn't on this device yet.";
      return video
        ? "You're offline. The video plays when you're back online."
        : "You're offline: this is the thumbnail. The full photo loads when you're back online.";
    case 'unsupported':
      if (video) return "This video can't be played in this browser.";
      return RARE_PHOTO.test(name) ? "This browser can't show this photo's format." : "The full photo couldn't be shown.";
    case 'failed':
      return `${video ? "The video couldn't be loaded" : "The full photo couldn't be loaded"}${view.error ? `: ${view.error}` : '.'}`;
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
