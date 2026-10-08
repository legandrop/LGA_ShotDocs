import { useSyncExternalStore } from 'react';

// Si la cabecera viva está plegada en un renglón, por tipo de página (escena, locación), en este dispositivo
// (Docs/Doc_Relaciones.md, sección 10). Plegarla en una escena la pliega en todas las escenas, no en las locaciones.
// Mientras la persona no eligió, en el teléfono arranca plegada (el documento queda arriba) y en la computadora abierta.

export type FoldKind = 'scene' | 'location';

const KEY = 'shotdocs.liveHeader.open';
const EVENT = 'shotdocs:live-fold';
const PHONE = '(max-width: 760px)';

function read(): Partial<Record<FoldKind, boolean>> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const out: Partial<Record<FoldKind, boolean>> = {};
    for (const k of ['scene', 'location'] as const) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === 'boolean') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

let cached: string | null = null;
let snapshot: Partial<Record<FoldKind, boolean>> = {};

function current(): Partial<Record<FoldKind, boolean>> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (raw !== cached) {
    cached = raw;
    snapshot = read();
  }
  return snapshot;
}

const isPhone = (): boolean => typeof matchMedia === 'function' && matchMedia(PHONE).matches;

/** Abierta o plegada: lo elegido para ese tipo, o lo de fábrica (plegada en el teléfono). */
export function liveOpen(kind: FoldKind, phone = isPhone()): boolean {
  return current()[kind] ?? !phone;
}

export function setLiveOpen(kind: FoldKind, open: boolean): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...current(), [kind]: open }));
  } catch {
    // Recordarlo es una comodidad: sin almacenamiento, vale hasta recargar.
    snapshot = { ...snapshot, [kind]: open };
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  window.addEventListener('storage', fn);
  const mq = typeof matchMedia === 'function' ? matchMedia(PHONE) : null;
  mq?.addEventListener?.('change', fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener('storage', fn);
    mq?.removeEventListener?.('change', fn);
  };
}

export function useLiveOpen(kind: FoldKind): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(subscribe, () => liveOpen(kind));
  return [open, (next) => setLiveOpen(kind, next)];
}
