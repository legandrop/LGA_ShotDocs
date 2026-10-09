import type { SupabaseClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { toRemoteError } from './sync/remote';

export type Theme = 'system' | 'light' | 'dark';
export type Font = 'default' | 'editorial';
export type TextSize = 'small' | 'normal' | 'large';
export type PageWidth = 'normal' | 'wide';
export type Language = 'en' | 'es';
export type PhoneImages = 'rows' | 'stacked';
/** El contraste del texto del documento (Docs/Doc_Contraste.md): sin jerarquía, con jerarquía o más marcada. */
export type Contrast = 'none' | 'contrast' | 'more';

/** Preferencias de la cuenta: siguen al usuario en todos sus dispositivos. */
export interface Prefs {
  theme: Theme;
  font: Font;
  textSize: TextSize;
  pageWidth: PageWidth;
  /**
   * El idioma de la interfaz (D-16). Una versión de la app anterior a los dos idiomas no conoce la clave:
   * `cleanPrefs` la descarta al leer y, si esa versión sube sus preferencias, la borra de la cuenta (sube el
   * objeto entero). No pasa nada grave: los dispositivos con esta versión siguen con el idioma que tenían
   * (ver `read` y `readStored`) y uno nuevo arranca con el del navegador.
   */
  language: Language;
  /**
   * En el teléfono (pantallas angostas), las fotos y videos en fila (Docs/Doc_Imagenes.md) se ven en fila,
   * como en la computadora, o uno debajo del otro. Solo cambia cómo se ven: lo guardado y el PDF, igual.
   * Una versión anterior no conoce la clave (igual que `language`).
   */
  phoneImages: PhoneImages;
  /**
   * El contraste del texto con el color por defecto (Docs/Doc_Contraste.md): encabezados, negrita y texto común en
   * tres tonos (`contrast`, de fábrica), más marcados (`more`) o todos iguales (`none`). Solo cambia cómo se ve: el
   * documento guardado no cambia. Una versión anterior no conoce la clave (igual que `language`): la descarta al leer y,
   * si sube sus preferencias, la borra de la cuenta; los dispositivos con esta versión siguen con la que tenían.
   */
  contrast: Contrast;
  /** Expande el nivel de la página elegida en el árbol; no abre recursivamente toda la rama. */
  expandSubpages: 'manual' | 'onClick';
}

/** El idioma de fábrica: castellano si el navegador está en castellano (`es`, `es-AR`…); si no, inglés. */
export function detectLanguage(): Language {
  if (typeof navigator === 'undefined') return 'en';
  const first = navigator.languages?.[0] ?? navigator.language ?? '';
  return /^es\b/i.test(first) ? 'es' : 'en';
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  font: 'default',
  textSize: 'normal',
  pageWidth: 'normal',
  language: detectLanguage(),
  phoneImages: 'rows',
  contrast: 'contrast',
  expandSubpages: 'onClick',
};

const CHOICES: { [K in keyof Prefs]: readonly Prefs[K][] } = {
  theme: ['system', 'light', 'dark'],
  font: ['default', 'editorial'],
  textSize: ['small', 'normal', 'large'],
  pageWidth: ['normal', 'wide'],
  language: ['en', 'es'],
  phoneImages: ['rows', 'stacked'],
  contrast: ['none', 'contrast', 'more'],
  expandSubpages: ['manual', 'onClick'],
};

/**
 * Lo que llega de otro dispositivo o de una versión futura se filtra: un valor desconocido no rompe nada.
 * Lo que falta o no se entiende toma el valor de `base` (de fábrica, si no se pasa otra cosa).
 */
export function cleanPrefs(raw: unknown, base: Prefs = DEFAULT_PREFS): Prefs {
  const out: Prefs = { ...base };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(CHOICES) as (keyof Prefs)[]) {
    const value = (raw as Record<string, unknown>)[key];
    if ((CHOICES[key] as readonly unknown[]).includes(value)) (out as unknown as Record<string, unknown>)[key] = value;
  }
  return out;
}

const STORAGE_KEY = 'shotdocs-prefs';

type PrefKey = keyof Prefs;
const KEYS = Object.keys(CHOICES) as PrefKey[];

/**
 * Copia local: se aplica antes de que cargue nada y sirve sin red. `dirtyKeys`: las claves cambiadas en este
 * dispositivo que todavía no subieron (solo esas le ganan a la cuenta al leerla). `dirty` se sigue
 * guardando para las versiones de la app que no conocen `dirtyKeys` (es "hay algo sin subir").
 */
interface Stored {
  userId: string | null;
  prefs: Prefs;
  dirty: boolean;
  dirtyKeys: PrefKey[];
}

/**
 * Las claves cambiadas de una copia guardada. Una copia de una versión vieja no tiene `dirtyKeys`: si decía
 * `dirty`, cuenta como cambiado lo que trae (y el idioma no, porque no lo conocía: así no se sube el del
 * navegador sin haber leído la cuenta).
 */
function storedDirtyKeys(raw: { prefs?: unknown; dirty?: unknown; dirtyKeys?: unknown }): PrefKey[] {
  if (Array.isArray(raw.dirtyKeys)) return KEYS.filter((k) => (raw.dirtyKeys as unknown[]).includes(k));
  if (raw.dirty !== true || !raw.prefs || typeof raw.prefs !== 'object') return [];
  return KEYS.filter((k) => k in (raw.prefs as object));
}

/**
 * La copia del usuario actual. Lo que falta en ella (el idioma, si la escribió una pestaña con una versión
 * vieja de la app) sale de `base`, o de la copia aparte de ese usuario, o de fábrica.
 */
function readStored(base?: Prefs): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as
      | { userId?: string | null; prefs?: unknown; dirty?: unknown; dirtyKeys?: unknown }
      | null;
    if (raw && typeof raw === 'object') {
      const userId = raw.userId ?? null;
      const fallback = base ?? (userId ? readOthers()[userId]?.prefs : undefined) ?? DEFAULT_PREFS;
      const dirtyKeys = storedDirtyKeys(raw);
      return { userId, prefs: cleanPrefs(raw.prefs, fallback), dirty: dirtyKeys.length > 0, dirtyKeys };
    }
  } catch {
    // Sin copia local se arranca con lo de fábrica.
  }
  return { userId: null, prefs: { ...DEFAULT_PREFS }, dirty: false, dirtyKeys: [] };
}

// Una copia por usuario del dispositivo (otra cuenta, u otro workspace: cada uno tiene su usuario), también
// la del actual. `shotdocs-prefs` sigue siendo la del usuario actual, con el nombre de siempre; esta es una
// clave aparte para que cambiar de workspace (o tener dos pestañas con workspaces distintos) no pierda un
// cambio sin subir ni vuelva a lo de fábrica sin red.
const OTHERS_KEY = 'shotdocs-prefs-others';
const MAX_OTHERS = 20;

type Others = Record<string, { prefs: Prefs; dirty: boolean; dirtyKeys: PrefKey[] }>;

function readOthers(): Others {
  try {
    const raw = JSON.parse(localStorage.getItem(OTHERS_KEY) ?? '{}') as Record<
      string,
      { prefs?: unknown; dirty?: unknown; dirtyKeys?: unknown }
    >;
    const out: Others = {};
    for (const [id, value] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
      if (value && typeof value === 'object') {
        const dirtyKeys = storedDirtyKeys(value);
        out[id] = { prefs: cleanPrefs(value.prefs), dirty: dirtyKeys.length > 0, dirtyKeys };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeOthers(others: Others): void {
  try {
    // Si hay demasiados, se van primero los más viejos que no tienen nada sin subir.
    const ids = Object.keys(others);
    for (const id of ids) {
      if (Object.keys(others).length <= MAX_OTHERS) break;
      if (!others[id].dirty) delete others[id];
    }
    localStorage.setItem(OTHERS_KEY, JSON.stringify(others));
  } catch {
    // Sin almacenamiento, el otro usuario vuelve a lo guardado en su cuenta.
  }
}

const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

const RETRY_MIN_MS = 15_000;
const RETRY_MAX_MS = 10 * 60_000;

/** Lo de `prefs` en las claves `keys`. */
function pick(prefs: Prefs, keys: PrefKey[]): Partial<Prefs> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = prefs[k];
  return out as Partial<Prefs>;
}

class PrefsStore {
  private state = readStored();
  private listeners = new Set<() => void>();
  private client: SupabaseClient | null = null;
  private pushing = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  /** El usuario de `attach`: solo sus preferencias se suben con ese cliente. */
  private attachedUser: string | null = null;
  /**
   * Ya se leyó la cuenta en esta sesión (desde el último `attach`). Hasta entonces no se sube nada: subir el
   * objeto entero antes de leer pisaría la cuenta con lo de fábrica de este dispositivo.
   */
  private loaded = false;
  private loading: Promise<void> | null = null;

  constructor() {
    darkQuery?.addEventListener('change', () => this.emit());
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => void this.push());
    // Otra pestaña cambió las preferencias: esta las toma, solo si son del mismo usuario. Otra pestaña con
    // otro workspace (otro usuario) no se mezcla: esta sigue con las suyas y nunca sube las de la otra. Lo que
    // la otra no escribió (una pestaña con una versión vieja no conoce el idioma) sigue como estaba acá.
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY) return;
      const next = readStored(this.state.prefs);
      if (next.userId !== this.state.userId) return;
      this.state = next;
      this.emit();
    });
  }

  get(): Prefs {
    return this.state.prefs;
  }

  /** El tema que se ve: `system` se resuelve con el del sistema. */
  scheme(): 'light' | 'dark' {
    const theme = this.state.prefs.theme;
    if (theme !== 'system') return theme;
    return darkQuery?.matches ? 'dark' : 'light';
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  set(patch: Partial<Prefs>): void {
    const prefs = cleanPrefs({ ...this.state.prefs, ...patch }, this.state.prefs);
    const changed = KEYS.filter((k) => k in patch);
    const dirtyKeys = [...new Set([...this.state.dirtyKeys, ...changed])];
    this.state = { ...this.state, prefs, dirty: dirtyKeys.length > 0, dirtyKeys };
    this.failures = 0;
    this.save();
    this.emit();
    void this.push();
  }

  /**
   * Al entrar: se lee la cuenta y se fusiona con lo de este dispositivo, donde solo ganan las claves
   * cambiadas acá y todavía sin subir (`dirtyKeys`); después, si quedó algo, se sube. Otro usuario en el
   * mismo dispositivo nunca hereda ni sube las preferencias del anterior: las del anterior (con lo que tenga
   * sin subir) quedan guardadas aparte, y el nuevo sigue con su propia copia si ya había entrado en este
   * dispositivo, o de fábrica. Sin red se sigue con la copia local y se vuelve a leer cuando vuelve.
   */
  async attach(client: SupabaseClient, userId: string): Promise<void> {
    this.client = client;
    this.attachedUser = userId;
    this.loaded = false;
    this.loading = null;
    if (this.state.userId !== userId) {
      // La copia aparte de cada usuario se mantiene al día en cada `save` (también la del actual): así otra
      // pestaña con otro usuario que pisó `shotdocs-prefs` no le hace perder nada a este.
      const others = readOthers();
      if (this.state.userId) others[this.state.userId] = { prefs: this.state.prefs, dirty: this.state.dirty, dirtyKeys: this.state.dirtyKeys };
      const mine = others[userId];
      writeOthers(others);
      this.state = mine
        ? { userId, prefs: mine.prefs, dirty: mine.dirty, dirtyKeys: mine.dirtyKeys }
        : { userId, prefs: { ...DEFAULT_PREFS }, dirty: false, dirtyKeys: [] };
      this.emit();
    }
    this.save();
    await this.load();
    return this.push();
  }

  /** Lee la cuenta una vez por sesión y la fusiona (un pedido a la vez). */
  private load(): Promise<void> {
    this.loading ??= this.read().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async read(): Promise<void> {
    const client = this.client;
    const userId = this.attachedUser;
    if (!client || !userId || this.loaded) return;
    try {
      const { data, error } = await client.from('user_settings').select('prefs').eq('user_id', userId).maybeSingle();
      if (error || this.client !== client || this.attachedUser !== userId || this.state.userId !== userId) return;
      // Con lo que haya ahora (lo cambiado mientras se esperaba la respuesta está en `dirtyKeys`). Lo que la
      // cuenta no tiene (el idioma, si lo borró una versión vieja de la app al subir las suyas) sigue como
      // estaba en este dispositivo en vez de volver a lo de fábrica.
      const merged = { ...cleanPrefs((data as { prefs?: unknown } | null)?.prefs, this.state.prefs), ...pick(this.state.prefs, this.state.dirtyKeys) };
      this.loaded = true;
      this.state = { ...this.state, prefs: merged };
      this.save();
      this.emit();
    } catch {
      // Sin red: se vuelve a intentar al volver la red o con el próximo cambio.
    }
  }

  /** Hay un cambio de preferencias del usuario actual que todavía no subió. */
  hasUnsynced(): boolean {
    return this.state.dirty;
  }

  detach(): void {
    this.client = null;
    this.attachedUser = null;
    this.loaded = false;
    this.loading = null;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }

  private schedule(): void {
    if (this.retry) clearTimeout(this.retry);
    const delay = Math.min(RETRY_MIN_MS * 2 ** Math.max(0, this.failures - 1), RETRY_MAX_MS);
    this.retry = setTimeout(() => void this.push(), delay);
  }

  private async push(): Promise<void> {
    const client = this.client;
    const userId = this.attachedUser;
    // Solo lo del usuario de `attach`, con su cliente: nunca las de otro usuario en la cuenta equivocada.
    if (!client || !userId || this.state.userId !== userId || !this.state.dirty || this.pushing) return;
    // Primero leer la cuenta (y fusionar); si no se pudo, se reintenta más tarde sin subir nada.
    if (!this.loaded) {
      await this.load();
      if (!this.loaded) {
        if (this.client === client) {
          this.failures++;
          this.schedule();
        }
        return;
      }
      if (this.client !== client || this.attachedUser !== userId) return;
    }
    if (this.pushing || !this.state.dirty) return;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.pushing = true;
    const sent = this.state.prefs;
    let permanent = false;
    let again = false;
    let ok = false;
    try {
      const update = await client.from('user_settings').update({ prefs: sent }).eq('user_id', userId).select('user_id');
      let error = update.error ? toRemoteError(update.error, update.status) : null;
      if (!error && update.data?.length === 0) {
        const insert = await client.from('user_settings').insert({ user_id: userId, prefs: sent });
        // Otro dispositivo creó la fila al mismo tiempo: se vuelve a intentar con un update.
        if (insert.error?.code === '23505') again = true;
        else if (insert.error) error = toRemoteError(insert.error, insert.status);
      }
      if (error) {
        permanent = error.permanent;
        this.failures++;
      } else if (!again && this.state.userId === userId) {
        ok = true;
        // Quedan sin subir solo las claves que cambiaron mientras se subía.
        const dirtyKeys = this.state.dirtyKeys.filter((k) => this.state.prefs[k] !== sent[k]);
        this.state = { ...this.state, dirty: dirtyKeys.length > 0, dirtyKeys };
        this.failures = 0;
        this.save();
      }
    } catch {
      // Sin red: se reintenta.
      this.failures++;
    } finally {
      this.pushing = false;
    }
    if (!this.state.dirty || !this.client) return;
    // Si cambió algo mientras se subía, se sube ya. Si falló por algo que reintentar no arregla (permisos,
    // una base sin la tabla), se espera al próximo cambio o al próximo inicio; si no, cada vez más tarde.
    if (again || ok || this.state.prefs !== sent) void this.push();
    else if (!permanent) this.schedule();
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      if (this.state.userId) {
        const others = readOthers();
        others[this.state.userId] = { prefs: this.state.prefs, dirty: this.state.dirty, dirtyKeys: this.state.dirtyKeys };
        writeOthers(others);
      }
    } catch {
      // Sin almacenamiento, las preferencias duran lo que dure la pestaña.
    }
  }

  private emit(): void {
    applyToDocument(this.state.prefs, this.scheme());
    for (const fn of this.listeners) fn();
  }

  /** Aplica lo guardado al documento; se llama una vez al arrancar. */
  init(): void {
    applyToDocument(this.state.prefs, this.scheme());
  }
}

const THEME_COLORS = { light: '#FBFAF8', dark: '#171716' };

function applyToDocument(prefs: Prefs, scheme: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = scheme;
  root.dataset.font = prefs.font;
  root.dataset.textSize = prefs.textSize;
  root.dataset.pageWidth = prefs.pageWidth;
  root.lang = prefs.language;
  root.dataset.phoneImages = prefs.phoneImages;
  root.dataset.contrast = prefs.contrast;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = THEME_COLORS[scheme];
    meta.removeAttribute('media');
  }
}

export const prefs = new PrefsStore();

export function usePrefs(): Prefs {
  return useSyncExternalStore(prefs.subscribe, () => prefs.get());
}

export function useScheme(): 'light' | 'dark' {
  return useSyncExternalStore(prefs.subscribe, () => prefs.scheme());
}
