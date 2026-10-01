import { translate } from '../i18n';
import type { Language } from '../prefs';
import { normalize } from '../search/normalize';
import { shortcutLabel } from '../ui/shortcuts';
import { entryShortcuts, HELP_SECTIONS, type HelpEntry } from './entries';
import { SHORTCUT_TEXTS } from './shortcutTexts';

// Buscar en la ayuda (Docs/Doc_Tutorial.md, sección 5): en el dispositivo, sin mayúsculas ni tildes (la misma
// normalización que buscar en la página), en los títulos, los textos y los atajos de cada entrada, con los
// rótulos de las dos plataformas: "ctrl f", "⌘F", "carrete", "pdf" o "filas" encuentran lo suyo. También en el
// otro idioma (con la app en inglés, "carrete" o "papelera" encuentran igual).

const plain = (text: string) => normalize(text).text;
/** Sin nada que no sea letra o número: "Ctrl+F", "ctrl f" y "⌘F" se comparan como "ctrlf" y "f". */
const compact = (text: string) => plain(text).replace(/[^\p{L}\p{N}]+/gu, '');

/** Los rótulos de un atajo en la Mac y en el resto, con su texto. */
function shortcutWords(id: string, lang: Language): string[] {
  const text = SHORTCUT_TEXTS[id];
  return [shortcutLabel(id, false, lang), shortcutLabel(id, true, lang), ...(text ? [translate(lang, text)] : [])];
}

export interface HelpHit {
  entry: HelpEntry;
  score: number;
}

/** Las entradas que coinciden con lo buscado, las mejores primero. Sin nada escrito, ninguna. */
export function searchHelp(entries: HelpEntry[], query: string, lang: Language): HelpHit[] {
  const words = plain(query).split(/[\s+]+/).filter(Boolean);
  if (words.length === 0) return [];
  const whole = compact(query);
  const hits: HelpHit[] = [];
  for (const entry of entries) {
    const ids = entryShortcuts(entry);
    const params = Object.fromEntries(Object.entries(entry.keys ?? {}).map(([name, id]) => [name, shortcutLabel(id, false, lang)]));
    const title = plain(translate(lang, entry.title));
    const section = HELP_SECTIONS.find((s) => s.id === entry.section);
    const labels = ids.flatMap((id) => shortcutWords(id, lang));
    const other: Language = lang === 'es' ? 'en' : 'es';
    const haystack = [
      title,
      plain(translate(lang, entry.text, params)),
      section ? plain(translate(lang, section.title)) : '',
      ...labels.map(plain),
      plain(translate(other, entry.title)),
      plain(translate(other, entry.text, params)),
    ].join(' ');
    // Cada palabra tiene que estar (en cualquier orden).
    if (!words.every((w) => haystack.includes(w))) continue;
    let score = 1;
    // Lo escrito es justo un atajo ("ctrl f", "⌘⌥M"): esa entrada primero.
    if (whole && ids.some((id) => [shortcutLabel(id, false, lang), shortcutLabel(id, true, lang)].some((l) => l.split(' / ').some((one) => compact(one) === whole)))) {
      score += 100;
    }
    if (words.every((w) => title.includes(w))) score += 10;
    hits.push({ entry, score });
  }
  return hits.sort((a, b) => b.score - a.score);
}
