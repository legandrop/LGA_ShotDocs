import type { LocalDb } from '../sync/localDb';
import type { HeadingRecord } from './collapse';

// Una sola pestaña usa la base local a la vez (`acquireTabLock` en services.ts): no hay dos pestañas escribiendo
// lo colapsado de la misma página al mismo tiempo. Si otra pestaña toma la base, esta deja de usarla.
//
// Lo colapsado de cada persona (P.11, Docs/Doc_Colapsar.md, corrección 6): en la base local del dispositivo,
// en `meta` con la clave `collapse:<página>` (sin cambiar la versión de la base: las versiones anteriores solo
// leen `meta` por clave). Se lee antes de crear el editor (así la página se abre ya colapsada, sin parpadeo)
// y se borra con la base local cuando se saca el workspace del dispositivo. Se guardan las páginas usadas
// más recientemente.

export const COLLAPSE_PREFIX = 'collapse:';
export const MAX_PAGES = 300;

interface SavedPage {
  used: number;
  h: Record<string, HeadingRecord>;
}

function clean(value: unknown): Map<string, HeadingRecord> {
  const out = new Map<string, HeadingRecord>();
  const h = (value as Partial<SavedPage> | null | undefined)?.h;
  if (!h || typeof h !== 'object') return out;
  for (const [id, raw] of Object.entries(h)) {
    const r = raw as Partial<HeadingRecord> | null;
    if (!r || typeof r !== 'object' || typeof r.c !== 'boolean') continue;
    const record: HeadingRecord = { c: r.c, g: typeof r.g === 'string' ? r.g : null };
    if (typeof r.e === 'string' && r.e) record.e = r.e;
    out.set(id, record);
  }
  return out;
}

/**
 * Lo guardado de una página (vacío si no hay nada, si está dañado o si la base no se puede leer). Abrirla la
 * cuenta como usada (las que se conservan son las usadas más recientemente, no las cambiadas).
 */
export async function loadCollapse(db: LocalDb | null | undefined, pageId: string, now = Date.now()): Promise<Map<string, HeadingRecord>> {
  if (!db) return new Map();
  try {
    const key = COLLAPSE_PREFIX + pageId;
    const saved = await db.get('meta', key);
    const records = clean(saved);
    if (records.size > 0) void db.put('meta', { used: now, h: Object.fromEntries(records) } satisfies SavedPage, key).catch(() => undefined);
    return records;
  } catch {
    return new Map();
  }
}

/** Guarda lo colapsado de una página (nada colapsado: se borra la clave). */
export async function saveCollapse(
  db: LocalDb | null | undefined,
  pageId: string,
  records: ReadonlyMap<string, HeadingRecord>,
  now = Date.now(),
): Promise<void> {
  if (!db) return;
  const key = COLLAPSE_PREFIX + pageId;
  try {
    if (records.size === 0) {
      await db.delete('meta', key);
      return;
    }
    const isNew = (await db.getKey('meta', key)) === undefined;
    await db.put('meta', { used: now, h: Object.fromEntries(records) } satisfies SavedPage, key);
    if (isNew) await prune(db);
  } catch {
    // Sin lugar o sin base: queda solo en memoria (es la vista de una persona, no contenido).
  }
}

/** Deja las `MAX_PAGES` páginas usadas más recientemente. */
async function prune(db: LocalDb): Promise<void> {
  const range = IDBKeyRange.bound(COLLAPSE_PREFIX, `${COLLAPSE_PREFIX}￿`);
  const keys = await db.getAllKeys('meta', range);
  if (keys.length <= MAX_PAGES) return;
  const values = await db.getAll('meta', range);
  const byAge = keys
    .map((key, i) => ({ key, used: Number((values[i] as Partial<SavedPage> | undefined)?.used) || 0 }))
    .sort((a, b) => a.used - b.used);
  const tx = db.transaction('meta', 'readwrite');
  for (const { key } of byAge.slice(0, keys.length - MAX_PAGES)) void tx.store.delete(key);
  await tx.done;
}

/**
 * Guarda con una pausa (colapsar varias veces seguidas escribe una vez); `flush` escribe lo pendiente (al
 * cerrar la página).
 */
export function collapseSaver(db: LocalDb | null | undefined, pageId: string, delayMs = 300) {
  let pending: ReadonlyMap<string, HeadingRecord> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const records = pending;
    pending = null;
    return records ? saveCollapse(db, pageId, records) : Promise.resolve();
  };
  return {
    save(records: ReadonlyMap<string, HeadingRecord>) {
      pending = records;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), delayMs);
    },
    flush,
  };
}
