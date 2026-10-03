import { language, translate, type Key } from '../i18n';
import type { Language } from '../prefs';
import { IS_MAC, shortcutLabel } from './shortcuts';

// Los tooltips que nombran un gesto o un atajo (D226, Lega 2026-10-03; Docs/Doc_Decisiones.md): un renglón por
// acción, «gesto o atajo: acción». Lo que va en negrita (el tooltip lo pinta en blanco, Tooltip.tsx) es solo el gesto
// y el atajo; la acción va en el gris normal:
//
//   **Click or ⌘⌥↩**: collapse just for you
//   **Shift+click or ⌘⌥⇧↩**: for everyone
//
// Los atajos salen del registro (shortcuts.ts) con su forma de cada plataforma (⌘ en la Mac, Ctrl en el resto),
// nunca escritos a mano. En una pantalla táctil no hay atajos de teclado ni gestos de mouse que no existen ahí
// (Shift+clic, doble clic, la rueda): esos renglones no salen, y si no queda ninguno no hay tooltip. Quien no puede
// hacer una acción no ve su renglón: el que arma el tooltip no lo pasa (o pasa `false`).
//
// Una prueba (tipFormat.test.ts) recorre los tooltips de la app y falla si alguno nombra un gesto o un atajo fuera
// de este formato, o con un atajo escrito a mano.

/** Los gestos de mouse (o de dedo) que puede nombrar un renglón. */
export type Gesture =
  | 'click'
  | 'shiftClick'
  | 'altClick'
  | 'modClick'
  | 'doubleClick'
  | 'drag'
  | 'shiftDrag'
  | 'altDrag'
  | 'scroll'
  | 'pinch';

/** Los gestos que existen en una pantalla táctil (tocar es el clic; pellizcar). Arrastrar, solo si el renglón lo dice. */
const TOUCH_GESTURES = new Set<Gesture>(['click', 'pinch']);

export interface TipRow {
  /** El gesto (Click, Shift+click, Drag…). */
  gesture?: Gesture;
  /** Una tecla del registro que se mantiene apretada mientras se hace el gesto (Space+drag). */
  hold?: string;
  /** El atajo del registro (su `id`): se escribe con la forma de la plataforma. */
  shortcut?: string;
  /** Lo que hace, en minúscula y sin punto final ("collapse just for you"). */
  action: string;
  /** El gesto también existe en una pantalla táctil (arrastrar un tirador, por ejemplo). */
  touch?: boolean;
}

export interface TipEnv {
  /** Pantalla táctil: sin atajos de teclado ni gestos de mouse. Por defecto, la del dispositivo. */
  touch?: boolean;
  /** La Mac (⌘) o el resto (Ctrl). Por defecto, la del dispositivo. */
  mac?: boolean;
  /** El idioma de los gestos y de los nombres de algunas teclas (Inicio, Fin, Espacio). Por defecto, el de ahora. */
  lang?: Language;
}

/** Una pantalla táctil (el dedo es el puntero principal): la misma cuenta que el triángulo de colapsar. */
export function touchScreen(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/** El modificador de un gesto: en la Mac ⌥ y ⌘; en el resto Alt y Ctrl. Shift se escribe igual en los dos. */
function modName(mod: 'Shift' | 'Alt' | 'Mod', mac: boolean): string {
  if (mod === 'Shift') return 'Shift';
  if (mod === 'Alt') return mac ? '⌥' : 'Alt';
  return mac ? '⌘' : 'Ctrl';
}

/** El rótulo de un gesto: "Click", "Shift+click", "⌥+drag", "Space+drag". */
export function gestureLabel(gesture: Gesture, env: TipEnv = {}, hold?: string): string {
  const mac = env.mac ?? IS_MAC;
  const lang = env.lang ?? language();
  const tr = (key: Key) => translate(lang, key);
  const mod = (m: 'Shift' | 'Alt' | 'Mod', key: Key) => `${modName(m, mac)}+${tr(key)}`;
  const base = (() => {
    switch (gesture) {
      case 'click':
        return tr('tip.click');
      case 'shiftClick':
        return mod('Shift', 'tip.clickMod');
      case 'altClick':
        return mod('Alt', 'tip.clickMod');
      case 'modClick':
        return mod('Mod', 'tip.clickMod');
      case 'doubleClick':
        return tr('tip.doubleClick');
      case 'drag':
        return hold ? tr('tip.dragMod') : tr('tip.drag');
      case 'shiftDrag':
        return mod('Shift', 'tip.dragMod');
      case 'altDrag':
        return mod('Alt', 'tip.dragMod');
      case 'scroll':
        return tr('tip.scroll');
      case 'pinch':
        return tr('tip.pinch');
    }
  })();
  return hold ? `${shortcutLabel(hold, mac, lang)}+${base}` : base;
}

/** Un renglón «**gesto o atajo**: acción», o `null` si en este dispositivo no queda ni gesto ni atajo. */
export function tipRow(row: TipRow, env: TipEnv = {}): string | null {
  const touch = env.touch ?? touchScreen();
  const mac = env.mac ?? IS_MAC;
  const lang = env.lang ?? language();
  const gesture = row.gesture && (!touch || row.touch || TOUCH_GESTURES.has(row.gesture)) ? gestureLabel(row.gesture, { mac, lang }, row.hold) : null;
  const shortcut = row.shortcut && !touch ? shortcutLabel(row.shortcut, mac, lang) : null;
  const label = gesture && shortcut ? `${gesture} ${translate(lang, 'tip.or')} ${shortcut}` : (gesture ?? shortcut);
  return label ? `**${label}**: ${row.action}` : null;
}

/**
 * El tooltip entero: un renglón por acción. Un texto suelto va tal cual (una aclaración que no nombra gestos ni
 * atajos); `false`, `null` o `undefined` no van (la acción que esa persona no puede hacer). Devuelve `undefined`
 * si no queda ningún renglón con gesto o atajo (por ejemplo, en una pantalla táctil): sin tooltip.
 */
export function tipRows(rows: (TipRow | string | false | null | undefined)[], env: TipEnv = {}): string | undefined {
  const lines: string[] = [];
  let any = false;
  for (const row of rows) {
    if (!row) continue;
    if (typeof row === 'string') {
      lines.push(row);
      continue;
    }
    const line = tipRow(row, env);
    if (line) {
      lines.push(line);
      any = true;
    }
  }
  return any ? lines.join('\n') : undefined;
}

/**
 * El nombre de un botón como acción de un renglón: en minúscula y sin los puntos suspensivos de un ítem de menú que
 * abre una ventana ("Assistant…" → "assistant"). Una sigla (PDF, ZIP) queda como está.
 */
export function asAction(label: string): string {
  const text = label.trim().replace(/(…|\.\.\.)$/, '');
  if (text.length > 1 && text[1] === text[1].toUpperCase() && text[1] !== text[1].toLowerCase()) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}
