import { useSyncExternalStore } from 'react';

// Lo que la persona ajustó a mano en la lista de *Tomorrow* (Docs/Doc_Relaciones.md, sección 11): escenas sumadas y
// sacadas, por reporte (el del día siguiente), en este dispositivo. Se guarda como diferencia con lo que dice el plan
// (la página *Plan* o el desglose): si el plan cambia, lo ajustado se sigue aplicando encima. Es una comodidad: no va al
// documento ni a la base, y sin almacenamiento vale hasta recargar.

export interface PlanAdjust {
  add: string[];
  remove: string[];
}

const KEY = 'shotdocs.tomorrow';
const EVENT = 'shotdocs:tomorrow';
const NONE: PlanAdjust = { add: [], remove: [] };
/** Cuántos reportes se recuerdan (los más recientes). */
const MAX_DAYS = 40;

type Store = Record<string, PlanAdjust>;

let memory: Store = {};
let cached: string | null | undefined;
let snapshot: Store = {};

function readStore(): Store {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return memory;
  }
  if (raw === cached) return snapshot;
  cached = raw;
  try {
    const parsed = JSON.parse(raw ?? '{}') as unknown;
    const out: Store = {};
    if (parsed && typeof parsed === 'object') {
      for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
        const a = v as Partial<PlanAdjust> | null;
        const list = (x: unknown) => (Array.isArray(x) ? x.filter((c): c is string => typeof c === 'string') : []);
        if (a && typeof a === 'object') out[id] = { add: list(a.add), remove: list(a.remove) };
      }
    }
    snapshot = out;
  } catch {
    snapshot = {};
  }
  return snapshot;
}

function writeStore(next: Store): void {
  const ids = Object.keys(next);
  const kept: Store = {};
  for (const id of ids.slice(-MAX_DAYS)) kept[id] = next[id];
  memory = kept;
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // Sin almacenamiento: queda en memoria hasta recargar.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function planAdjust(dayId: string): PlanAdjust {
  return readStore()[dayId] ?? NONE;
}

/** La lista de mañana: la del plan, sin las sacadas, con las sumadas al final. */
export function adjustedPlan(source: readonly string[], adj: PlanAdjust): string[] {
  const out = source.filter((c) => !adj.remove.includes(c));
  for (const c of adj.add) if (!out.includes(c)) out.push(c);
  return out;
}

export function addToPlan(dayId: string, code: string): void {
  const store = { ...readStore() };
  const cur = store[dayId] ?? NONE;
  delete store[dayId];
  store[dayId] = { add: cur.add.includes(code) ? cur.add : [...cur.add, code], remove: cur.remove.filter((c) => c !== code) };
  writeStore(store);
}

export function removeFromPlan(dayId: string, code: string): void {
  const store = { ...readStore() };
  const cur = store[dayId] ?? NONE;
  delete store[dayId];
  store[dayId] = { add: cur.add.filter((c) => c !== code), remove: cur.remove.includes(code) ? cur.remove : [...cur.remove, code] };
  writeStore(store);
}

function subscribe(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  window.addEventListener('storage', fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener('storage', fn);
  };
}

export function usePlanAdjust(dayId: string | null): PlanAdjust {
  return useSyncExternalStore(subscribe, () => (dayId ? planAdjust(dayId) : NONE));
}

/**
 * Lo ajustado para un reporte que todavía no existía (la tarjeta *Tomorrow* de un día sin día siguiente, D573) pasa al
 * reporte recién creado: si después se vuelve a abrir su tarjeta, la lista es la misma.
 */
export function movePlan(from: string, to: string): void {
  const store = { ...readStore() };
  const cur = store[from];
  if (!cur) return;
  delete store[from];
  store[to] = cur;
  writeStore(store);
}
