import type { MentionRef } from '../sync/comments';

// El texto de las menciones (Docs/Doc_Menciones.md, 2.1, 2.2 y 3.1). El comentario guarda texto plano (`@lega fijate
// la toma 12`); quién es `@lega` lo dice `comment_mentions`. Acá: dónde se está escribiendo una mención (para abrir la
// lista del `@`), qué menciones elegidas siguen escritas en el texto (solo esas se mandan) y cómo se parte el texto
// para pintarlas. También las menciones que vinieron de Coda (`@[Nombre](superhuman://users/123)`), que se muestran
// como `@Nombre` sin tocar lo guardado.

/** Lo que puede seguir a un rótulo para que cuente como mención: el final, un espacio o un signo (no una letra). */
const WORD = /[\p{L}\p{N}_]/u;
/** Lo que no puede tener lo que se escribe después del `@` (lo mismo que el rótulo). */
const BREAK = /[\s@]/u;
/** El largo máximo de un rótulo (como la base). */
const MAX_LABEL = 64;

/** Una mención de Coda guardada tal cual vino: `@[Nombre](superhuman://users/<número>)` (también `coda://`). */
const CODA = /@\[([^\]\n]{1,100})\]\((?:superhuman|coda):\/\/users\/[^)\s]{0,80}\)/gu;

/**
 * La mención que se está escribiendo con el cursor en `caret`: el `@` va al comienzo o después de un espacio (en
 * `ana@wanka.tv` no abre nada) y lo de después, hasta el cursor, no tiene espacios ni otra `@`. `null` si no hay.
 */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/u.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > MAX_LABEL || BREAK.test(query)) return null;
  return { start: at, query };
}

/** Pone `@rótulo ` en lugar de lo que se estaba escribiendo. Devuelve el texto nuevo y dónde queda el cursor. */
export function insertMention(text: string, start: number, caret: number, label: string): { text: string; caret: number } {
  const after = text.slice(caret);
  const insert = `@${label}${after.startsWith(' ') ? '' : ' '}`;
  return { text: text.slice(0, start) + insert + after, caret: start + insert.length + (after.startsWith(' ') ? 1 : 0) };
}

/** Dónde aparece `@rótulo` como mención: no pegado a una palabra antes ni seguido de una letra. */
function occurrences(text: string, label: string): number[] {
  const out: number[] = [];
  const needle = `@${label}`;
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
    const prev = i > 0 ? text[i - 1] : '';
    const next = text[i + needle.length] ?? '';
    if ((prev === '' || !WORD.test(prev)) && (next === '' || !WORD.test(next))) out.push(i);
  }
  return out;
}

/**
 * Las menciones elegidas que siguen escritas en el texto (`@rótulo` seguido de un espacio, un signo o el final), sin
 * repetir a nadie: borrar el `@rótulo` saca la mención. Escribir el rótulo a mano sin elegirlo no está acá.
 */
export function activeMentions(text: string, picked: MentionRef[]): MentionRef[] {
  const seen = new Set<string>();
  const out: MentionRef[] = [];
  for (const m of picked) {
    if (seen.has(m.userId) || !m.label || occurrences(text, m.label).length === 0) continue;
    seen.add(m.userId);
    out.push(m);
  }
  return out;
}

export type Segment =
  | { text: string }
  | { text: string; mention: MentionRef }
  /** Una mención de Coda: se pinta, sin tooltip ni aviso. */
  | { text: string; coda: true };

/**
 * El texto partido para pintarlo: cada `@rótulo` de una mención activa (el rótulo más largo gana si dos se pisan) y,
 * con `coda`, cada mención de Coda como `@Nombre`. Lo demás queda tal cual.
 */
export function mentionSegments(text: string, mentions: MentionRef[], coda = false): Segment[] {
  const marks: { start: number; end: number; seg: Segment }[] = [];
  if (coda) {
    for (const m of text.matchAll(CODA)) {
      marks.push({ start: m.index!, end: m.index! + m[0].length, seg: { text: `@${m[1]}`, coda: true } });
    }
  }
  const byLength = [...mentions].sort((a, b) => b.label.length - a.label.length);
  for (const m of byLength) {
    if (!m.label) continue;
    for (const start of occurrences(text, m.label)) {
      const end = start + m.label.length + 1;
      if (marks.some((x) => start < x.end && end > x.start)) continue;
      marks.push({ start, end, seg: { text: text.slice(start, end), mention: m } });
    }
  }
  if (marks.length === 0) return text ? [{ text }] : [];
  marks.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let at = 0;
  for (const x of marks) {
    if (x.start > at) out.push({ text: text.slice(at, x.start) });
    out.push(x.seg);
    at = x.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** El texto de un comentario con las menciones de Coda como `@Nombre` (para el comienzo en la campana). */
export function plainCoda(text: string): string {
  return text.replace(CODA, (_all, name: string) => `@${name}`);
}
