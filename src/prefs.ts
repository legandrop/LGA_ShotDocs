import type { SupabaseClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { toRemoteError } from './sync/remote';

export type Theme = 'system' | 'light' | 'dark';
export type Font = 'default' | 'editorial';
export type TextSize = 'small' | 'normal' | 'large';
export type PageWidth = 'normal' | 'wide';

/** Preferencias de la cuenta: siguen al usuario en todos sus dispositivos. */
export interface Prefs {
  theme: Theme;
  font: Font;
  textSize: TextSize;
  pageWidth: PageWidth;
}

export const DEFAULT_PREFS: Prefs = { theme: 'system', font: 'default', textSize: 'normal', pageWidth: 'normal' };

const CHOICES: { [K in keyof Prefs]: readonly Prefs[K][] } = {
  theme: ['system', 'light', 'dark'],
  font: ['default', 'editorial'],
  textSize: ['small', 'normal', 'large'],
  pageWidth: ['normal', 'wide'],
};

/** Lo que llega de otro dispositivo o de una versión futura se filtra: un valor desconocido no rompe nada. */
export function cleanPrefs(raw: unknown): Prefs {
  const out: Prefs = { ...DEFAULT_PREFS };
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

  constructor() {
    darkQuery?.addEventListener('change', () => this.emit());
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => void this.push());
    // Otra pestaña cambió las preferencias: esta las toma.
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY) return;
      this.state = readStored();
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
   * la cuenta. Otro usuario en el mismo dispositivo arranca de fábrica: nunca hereda ni sube las
   * preferencias del anterior. Sin red se sigue con la copia local.
   */
  async attach(client: SupabaseClient, userId: string): Promise<void> {
    this.client = client;
    if (this.state.userId !== userId) {
      this.state = { userId, prefs: { ...DEFAULT_PREFS }, dirty: false };
      this.revision++;
      this.emit();
    }
    this.save();
    if (this.state.dirty) return this.push();
    const revision = this.revision;
    const { data, error } = await client.from('user_settings').select('prefs').eq('user_id', userId).maybeSingle();
    if (error || this.revision !== revision || this.state.userId !== userId || !data) return;
    this.state = { ...this.state, prefs: cleanPrefs(data.prefs) };
    this.save();
    this.emit();
  }

  detach(): void {
    this.client = null;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }

  private async push(): Promise<void> {
    const client = this.client;
    const userId = this.state.userId;
    if (!client || !userId || !this.state.dirty || this.pushing) return;
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
