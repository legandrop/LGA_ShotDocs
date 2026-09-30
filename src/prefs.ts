import type { SupabaseClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { toRemoteError } from './sync/remote';

export type Theme = 'system' | 'light' | 'dark';
export type Font = 'default' | 'editorial';
export type TextSize = 'small' | 'normal' | 'large';
export type PageWidth = 'normal' | 'wide';
export type Language = 'en' | 'es';

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
   * (ver `attach`) y uno nuevo arranca con el del navegador.
   */
  language: Language;
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
};

const CHOICES: { [K in keyof Prefs]: readonly Prefs[K][] } = {
  theme: ['system', 'light', 'dark'],
  font: ['default', 'editorial'],
  textSize: ['small', 'normal', 'large'],
  pageWidth: ['normal', 'wide'],
  language: ['en', 'es'],
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

/** Copia local: se aplica antes de que cargue nada y sirve sin red. `dirty`: cambios sin subir. */
interface Stored {
  userId: string | null;
  prefs: Prefs;
  dirty: boolean;
}

function readStored(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Stored> | null;
    if (raw) return { userId: raw.userId ?? null, prefs: cleanPrefs(raw.prefs), dirty: !!raw.dirty };
  } catch {
    // Sin copia local se arranca con lo de fábrica.
  }
  return { userId: null, prefs: { ...DEFAULT_PREFS }, dirty: false };
}

// Una copia por usuario del dispositivo (otra cuenta, u otro workspace: cada uno tiene su usuario), también
// la del actual. `shotdocs-prefs` sigue siendo la del usuario actual, con el nombre de siempre; esta es una
// clave aparte para que cambiar de workspace (o tener dos pestañas con workspaces distintos) no pierda un
// cambio sin subir ni vuelva a lo de fábrica sin red.
const OTHERS_KEY = 'shotdocs-prefs-others';
const MAX_OTHERS = 20;

type Others = Record<string, { prefs: Prefs; dirty: boolean }>;

function readOthers(): Others {
  try {
    const raw = JSON.parse(localStorage.getItem(OTHERS_KEY) ?? '{}') as Record<string, { prefs?: unknown; dirty?: unknown }>;
    const out: Others = {};
    for (const [id, value] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
      if (value && typeof value === 'object') out[id] = { prefs: cleanPrefs(value.prefs), dirty: value.dirty === true };
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

class PrefsStore {
  private state = readStored();
  private listeners = new Set<() => void>();
  private client: SupabaseClient | null = null;
  private pushing = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  /** Sube con cada cambio local: una respuesta que salió antes de un cambio no lo pisa. */
  private revision = 0;
  /** El usuario de `attach`: solo sus preferencias se suben con ese cliente. */
  private attachedUser: string | null = null;

  constructor() {
    darkQuery?.addEventListener('change', () => this.emit());
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => void this.push());
    // Otra pestaña cambió las preferencias: esta las toma, solo si son del mismo usuario. Otra pestaña con
    // otro workspace (otro usuario) no se mezcla: esta sigue con las suyas y nunca sube las de la otra.
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY) return;
      const next = readStored();
      if (next.userId !== this.state.userId) return;
      this.state = next;
      this.revision++;
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
    this.state = { ...this.state, prefs: cleanPrefs({ ...this.state.prefs, ...patch }), dirty: true };
    this.revision++;
    this.failures = 0;
    this.save();
    this.emit();
    void this.push();
  }

  /**
   * Al entrar: si hay cambios de este usuario sin subir, ganan y se suben; si no, manda lo guardado en
   * la cuenta. Otro usuario en el mismo dispositivo nunca hereda ni sube las preferencias del anterior:
   * las del anterior (con lo que tenga sin subir) quedan guardadas aparte, y el nuevo sigue con su propia
   * copia si ya había entrado en este dispositivo, o de fábrica. Sin red se sigue con la copia local.
   */
  async attach(client: SupabaseClient, userId: string): Promise<void> {
    this.client = client;
    this.attachedUser = userId;
    if (this.state.userId !== userId) {
      // La copia aparte de cada usuario se mantiene al día en cada `save` (también la del actual): así otra
      // pestaña con otro usuario que pisó `shotdocs-prefs` no le hace perder nada a este.
      const others = readOthers();
      if (this.state.userId) others[this.state.userId] = { prefs: this.state.prefs, dirty: this.state.dirty };
      const mine = others[userId];
      writeOthers(others);
      this.state = { userId, prefs: mine ? mine.prefs : { ...DEFAULT_PREFS }, dirty: mine?.dirty ?? false };
      this.revision++;
      this.emit();
    }
    this.save();
    if (this.state.dirty) return this.push();
    const revision = this.revision;
    const { data, error } = await client.from('user_settings').select('prefs').eq('user_id', userId).maybeSingle();
    if (error || this.revision !== revision || this.state.userId !== userId || !data) return;
    // Lo que la cuenta no tiene (el idioma, si lo borró una versión vieja de la app al subir las suyas) sigue
    // como estaba en este dispositivo en vez de volver a lo de fábrica.
    this.state = { ...this.state, prefs: cleanPrefs(data.prefs, this.state.prefs) };
    this.save();
    this.emit();
  }

  /** Hay un cambio de preferencias del usuario actual que todavía no subió. */
  hasUnsynced(): boolean {
    return this.state.dirty;
  }

  detach(): void {
    this.client = null;
    this.attachedUser = null;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }

  private async push(): Promise<void> {
    const client = this.client;
    const userId = this.attachedUser;
    // Solo lo del usuario de `attach`, con su cliente: nunca las de otro usuario en la cuenta equivocada.
    if (!client || !userId || this.state.userId !== userId || !this.state.dirty || this.pushing) return;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.pushing = true;
    const sent = this.state.prefs;
    let permanent = false;
    let again = false;
    try {
      const update = await client.from('user_settings').update({ prefs: sent }).eq('user_id', userId).select('user_id');
      let error = update.error ? toRemoteError(update.error, update.status) : null;
      if (!error && update.data?.length === 0) {
        const insert = await client.from('user_settings').insert({ user_id: userId, prefs: sent });
        // Otro dispositivo creó la fila al mismo tiempo: se vuelve a intentar con un update.
        if (insert.error?.code === '23505') again = true;
        else if (insert.error) error = toRemoteError(insert.error, insert.status);
      }
      if (error) permanent = error.permanent;
      else if (!again && this.state.userId === userId && this.state.prefs === sent) {
        this.state = { ...this.state, dirty: false };
        this.failures = 0;
        this.save();
      }
      if (error) this.failures++;
    } catch {
      // Sin red: se reintenta.
      this.failures++;
    } finally {
      this.pushing = false;
    }
    if (!this.state.dirty || !this.client) return;
    // Si cambió algo mientras se subía, se sube ya. Si falló por algo que reintentar no arregla (permisos,
    // una base sin la tabla), se espera al próximo cambio o al próximo inicio; si no, cada vez más tarde.
    if (again || this.state.prefs !== sent) void this.push();
    else if (!permanent) {
      const delay = Math.min(RETRY_MIN_MS * 2 ** Math.max(0, this.failures - 1), RETRY_MAX_MS);
      this.retry = setTimeout(() => void this.push(), delay);
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      if (this.state.userId) {
        const others = readOthers();
        others[this.state.userId] = { prefs: this.state.prefs, dirty: this.state.dirty };
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
