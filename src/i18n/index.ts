import { createElement, Fragment, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { prefs, type Language } from '../prefs';
import { strings } from './strings';
import type { Entry } from './types';

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
// momento. Nada de esto toca lo guardado en los documentos: los nombres de los tipos de texto (Script,
// Question) son solo etiquetas.

export type { Entry, Plural } from './types';
export type Key = keyof typeof strings;
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
  const pair = strings[key] as { en: Entry; es: Entry } | undefined;
  if (!pair) return key;
  const text = pick(pair[lang] ?? pair.en, params);
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? String(params[name]) : all));
}

function translateRich(lang: Language, key: Key, params: Record<string, ReactNode>): ReactNode {
  const pair = strings[key] as { en: Entry; es: Entry } | undefined;
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
