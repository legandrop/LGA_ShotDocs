import { useSyncExternalStore } from 'react';

// La entrada `/dictate` para un Atajo de iOS con el botón de acción (Docs/Doc_Dictado.md, entrega V4): Siri dicta en el
// teléfono y el Atajo abre `https://<la app>/dictate#<el texto>`. El texto va en el fragmento (lo de después de `#`),
// que el navegador no manda al servidor. Al arrancar, la app lo toma, lo saca de la dirección (`/dictate` pasa a ser
// el inicio, que abre la última página del proyecto) y, cuando hay una página abierta con su editor, *Dictate to
// report* se abre con ese texto en el campo. **No manda nada solo:** la persona revisa la nota y toca *Place*.
//
// Mientras espera una página (sin sesión, o en el inicio sin páginas), el texto queda en `sessionStorage` de esa pestaña:
// sobrevive a una recarga (entrar con el código) y se va al cerrarla. Va en la primera carga y es chico.

export const DICTATE_PATH = '/dictate';
const KEY = 'shotdocs-dictate-link';
/** Lo que entra en el campo de la nota. */
export const MAX_LINK_TEXT = 2000;

let pending: string | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    pending = storage()?.getItem(KEY) || null;
  } catch {
    pending = null;
  }
}

function store(value: string | null): void {
  pending = value;
  loaded = true;
  try {
    if (value) storage()?.setItem(KEY, value);
    else storage()?.removeItem(KEY);
  } catch {
    // Sin almacenamiento: queda solo en memoria (alcanza si no se recarga).
  }
  emit();
}

/** El texto de un fragmento: `#texto` o `#text=texto`, con `%20` y compañía; vacío si no hay o no se puede leer. */
export function textOfHash(hash: string): string {
  let raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (/^text=/i.test(raw)) raw = raw.slice(5);
  let text: string;
  try {
    text = decodeURIComponent(raw);
  } catch {
    text = raw;
  }
  return text.replace(/\r\n?/g, '\n').trim().slice(0, MAX_LINK_TEXT);
}

/**
 * Al arrancar (antes de dibujar nada): si la dirección es `/dictate`, toma el texto del fragmento, lo guarda para la
 * hoja y deja la dirección en el inicio, sin el fragmento. Devuelve si era `/dictate`.
 */
export function captureDictateLink(loc: Pick<Location, 'pathname' | 'hash'> = location, hist: Pick<History, 'replaceState'> = history): boolean {
  const path = loc.pathname.replace(/\/+$/, '') || '/';
  if (path !== DICTATE_PATH) return false;
  const text = textOfHash(loc.hash);
  // Sin texto (un Atajo que solo abre la app) también abre la hoja, con el campo vacío.
  store(text || ' ');
  hist.replaceState(null, '', '/');
  return true;
}

/** Hay un texto del Atajo esperando una página. */
export function peekDictateLink(): string | null {
  load();
  return pending;
}

/** La hoja toma el texto (y lo borra). `''` si el Atajo no traía texto. */
export function takeDictateLink(): string | null {
  load();
  const value = pending;
  if (value === null) return null;
  store(null);
  return value.trim();
}

export function useDictateLink(): string | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    peekDictateLink,
  );
}

/** Para las pruebas. */
export function resetDictateLink(): void {
  pending = null;
  loaded = false;
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nada.
  }
}
