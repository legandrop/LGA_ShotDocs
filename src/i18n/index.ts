import { createElement, Fragment, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { prefs, type Language } from '../prefs';
import type { assistant } from './lazy/assistant';
import type { carrete } from './lazy/carrete';
import type { commentsPanel } from './lazy/commentsPanel';
import type { drive } from './lazy/drive';
import type { editor } from './lazy/editor';
import type { exportPdf } from './lazy/exportPdf';
import type { exportZip } from './lazy/exportZip';
import type { help } from './lazy/help';
import type { folders } from './lazy/folders';
import type { history } from './lazy/history';
import type { importCoda } from './lazy/importCoda';
import type { installDialog } from './lazy/install';
import type { offline } from './lazy/offline';
import type { projectStates } from './lazy/projectStates';
import type { search } from './lazy/search';
import type { teamDialogs } from './lazy/teamDialogs';
import type { templates } from './lazy/templates';
import type { tutorial } from './lazy/tutorial';
import { strings } from './strings';
import type { Dict, Entry } from './types';

// Los textos de la interfaz en inglés y en castellano (D-16). Cada clave tiene los dos idiomas juntos (ver
// `strings.ts`); el idioma es una preferencia de la cuenta (`prefs.language`). Sin librerías: interpolación
// con `{nombre}` y plurales con `{ one, other }` según `count`.
//
//   const t = useT();              // en un componente: se vuelve a dibujar al cambiar el idioma
//   t('trash.title')               // "Trash" / "Papelera"
//   t('sync.pending', { count })   // "3 changes" / "3 cambios"
//   t.rich('x', { link: <a/> })    // con partes que no son texto (links, negritas)
//
// Fuera de un componente (avisos, errores, confirmaciones) se usa `t()` directo: lee el idioma en el
// momento. Los textos de las partes que se bajan aparte (el editor, el carrete, los diálogos, el panel de
// comentarios) están en `lazy/` y viajan con esas partes: cada archivo que los usa importa su parte, que se
// suma al diccionario al cargarse (`register`). Una prueba revisa que ningún otro archivo use esas claves. Nada de esto toca lo guardado en los documentos: los nombres de los tipos de texto (Script,
// Question) son solo etiquetas.

export type { Entry, Plural } from './types';
type LazyStrings = typeof assistant &
  typeof carrete &
  typeof commentsPanel &
  typeof drive &
  typeof editor &
  typeof exportPdf &
  typeof exportZip &
  typeof help &
  typeof folders &
  typeof history &
  typeof importCoda &
  typeof installDialog &
  typeof offline &
  typeof projectStates &
  typeof search &
  typeof teamDialogs &
  typeof templates &
  typeof tutorial;
export type Key = keyof typeof strings | keyof LazyStrings;

/** Todas las claves cargadas hasta ahora: las de la primera carga y las de las partes ya bajadas. */
const registry: Record<string, { en: Entry; es: Entry }> = { ...strings };

/** Suma los textos de una parte que se bajó aparte. */
export function register(dict: Dict): void {
  Object.assign(registry, dict);
  patterns = null;
}
export type Params = Record<string, string | number>;

export interface Translate {
  (key: Key, params?: Params): string;
  /** Igual, pero los valores pueden ser elementos (un link, un `<strong>`): devuelve nodos de React. */
  rich: (key: Key, params: Record<string, ReactNode>) => ReactNode;
  lang: Language;
}

function pick(entry: Entry, params?: Record<string, unknown>): string {
  if (typeof entry === 'string') return entry;
  const count = Number(params?.count);
  return count === 1 ? entry.one : entry.other;
}

/** El texto de una clave en un idioma, con los `{valores}` puestos. */
export function translate(lang: Language, key: Key, params?: Params): string {
  const pair = registry[key];
  if (!pair) return key;
  const text = pick(pair[lang] ?? pair.en, params);
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? String(params[name]) : all));
}

function translateRich(lang: Language, key: Key, params: Record<string, ReactNode>): ReactNode {
  const pair = registry[key];
  if (!pair) return key;
  const text = pick(pair[lang] ?? pair.en, params as Record<string, unknown>);
  const parts = text.split(/\{(\w+)\}/);
  return createElement(
    Fragment,
    null,
    ...parts.map((part, i) => (i % 2 === 1 ? createElement(Fragment, { key: i }, part in params ? params[part] : `{${part}}`) : part)),
  );
}

function make(lang: Language): Translate {
  const fn = ((key: Key, params?: Params) => translate(lang, key, params)) as Translate;
  fn.rich = (key, params) => translateRich(lang, key, params);
  fn.lang = lang;
  return fn;
}

const cache: Partial<Record<Language, Translate>> = {};
function translator(lang: Language): Translate {
  return (cache[lang] ??= make(lang));
}

// --- Textos guardados ------------------------------------------------------------------------------------
//
// Lo que se guarda en el dispositivo (el motivo de una subida detenida en IndexedDB, un aviso del arranque)
// va en inglés, como siempre: una versión vieja de la app lo sigue mostrando bien. Al mostrarlo, `localize`
// reconoce el texto de una clave (también con `{valores}`, que a su vez pueden ser textos de otra clave) y lo
// pasa al idioma de ahora; lo que no reconoce (un mensaje del servidor) queda tal cual.

/** El texto para guardar: siempre en inglés (ver `localize`). */
export function stored(key: Key, params?: Params): string {
  return translate('en', key, params);
}

let patterns: { key: Key; names: string[]; re: RegExp }[] | null = null;

function compile() {
  const out: NonNullable<typeof patterns> = [];
  for (const [key, pair] of Object.entries(registry) as [Key, { en: Entry }][]) {
    const forms = typeof pair.en === 'string' ? [pair.en] : [pair.en.one, pair.en.other];
    for (const text of forms) {
      const names: string[] = [];
      const source = text
        .split(/(\{\w+\})/)
        .map((part) => {
          const m = /^\{(\w+)\}$/.exec(part);
          if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          names.push(m[1]);
          return m[1] === 'count' ? '(\\d+)' : '([\\s\\S]*?)';
        })
        .join('');
      out.push({ key, names, re: new RegExp(`^${source}$`) });
    }
  }
  // Primero los más largos: un texto con valores no se confunde con uno más corto.
  return out.sort((a, b) => b.re.source.length - a.re.source.length);
}

/** Un texto guardado en inglés, en el idioma de ahora (o tal cual, si no es de ninguna clave). */
export function localize(text: string, depth = 0): string {
  if (!text || language() === 'en' || depth > 2) return text;
  patterns ??= compile();
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (!m) continue;
    const params: Params = {};
    p.names.forEach((name, i) => {
      params[name] = name === 'count' ? Number(m[i + 1]) : localize(m[i + 1], depth + 1);
    });
    return translate(language(), p.key, params);
  }
  // Varios avisos seguidos (" "): se prueba cortar entre dos oraciones.
  for (let at = text.indexOf('. '); at >= 0; at = text.indexOf('. ', at + 1)) {
    const left = text.slice(0, at + 1);
    const right = text.slice(at + 2);
    const a = localize(left, depth + 1);
    const b = localize(right, depth + 1);
    if (a !== left && b !== right) return `${a} ${b}`;
  }
  return text;
}

/** El idioma de la interfaz ahora. */
export function language(): Language {
  return prefs.get().language;
}

/** Traduce con el idioma de ahora (para avisos, errores y todo lo que no es un componente). */
export const t = ((key: Key, params?: Params) => translate(language(), key, params)) as Translate;
t.rich = (key, params) => translateRich(language(), key, params);
Object.defineProperty(t, 'lang', { get: language });

export function useLanguage(): Language {
  return useSyncExternalStore(prefs.subscribe, language);
}

/** Los textos en el idioma de la cuenta; el componente se vuelve a dibujar si cambia. */
export function useT(): Translate {
  const lang = useLanguage();
  return useMemo(() => translator(lang), [lang]);
}

/** La convención de fechas y números del idioma (castellano de Argentina: "30 sept", "1.234"). */
export function locale(lang: Language = language()): string {
  return lang === 'es' ? 'es-AR' : 'en-US';
}
