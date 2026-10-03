import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translate, type Entry, type Key } from '../i18n';
import { annotator } from '../i18n/lazy/annotator';
import { assistant } from '../i18n/lazy/assistant';
import { carrete } from '../i18n/lazy/carrete';
import { commentsPanel } from '../i18n/lazy/commentsPanel';
import { dictation } from '../i18n/lazy/dictation';
import { drive } from '../i18n/lazy/drive';
import { editor } from '../i18n/lazy/editor';
import { exportPdf } from '../i18n/lazy/exportPdf';
import { exportZip } from '../i18n/lazy/exportZip';
import { folders } from '../i18n/lazy/folders';
import { history } from '../i18n/lazy/history';
import { importArchive } from '../i18n/lazy/importArchive';
import { importCoda } from '../i18n/lazy/importCoda';
import { installDialog } from '../i18n/lazy/install';
import { oauthConsent } from '../i18n/lazy/oauthConsent';
import { offline } from '../i18n/lazy/offline';
import { projectStates } from '../i18n/lazy/projectStates';
import { search } from '../i18n/lazy/search';
import { teamDialogs } from '../i18n/lazy/teamDialogs';
import { templates } from '../i18n/lazy/templates';
import { strings } from '../i18n/strings';
import { renderTip } from './Tooltip';
import { shortcutLabel } from './shortcuts';
import { asAction, gestureLabel, tipRows } from './tipRows';

// D226 (Lega, 2026-10-03; Docs/Doc_Decisiones.md): todo tooltip que nombra un gesto o un atajo va en renglones
// «**gesto o atajo**: acción», armados por tipRows.ts con los atajos del registro. Esta prueba lo controla hacia
// adelante: recorre el código de la app buscando lo que termina en un `data-tip` y falla si un texto de tooltip (del
// diccionario o escrito en el código) nombra un gesto o una tecla por su cuenta, o si un atajo se pone sin tipRows.

const SRC = resolve(__dirname, '..');

/** Los archivos de la app (sin las pruebas, los diccionarios ni la ayuda, que describe los atajos en prosa). */
function sourceFiles(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== 'i18n' && name !== 'fixtures') walk(path);
      } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
        out.set(path, readFileSync(path, 'utf8'));
      }
    }
  };
  walk(SRC);
  return out;
}

/** Lo que nombra un gesto o una tecla, en inglés o en castellano. */
const GESTURE_WORDS =
  /\b(click|clic|double[- ]click|doble clic|drag|dragging|arrastr\w*|scroll|pinch\w*|pellizc\w*|keyboard|teclado|arrow keys|hold)\b/i;
const KEY_NAMES = /\b(Shift|Alt|Ctrl|Cmd|Command|Option|Esc|Escape|Enter|Space|Espacio|Backspace|Retroceso|Supr|Tab|F3)\b|\{(key|shortcut|pan|next|alt)\}/;
const KEY_SYMBOLS = /[⌘⌥⇧⌃↩⌫⇥←→↑↓]/;
const namesGestureOrKey = (text: string) => GESTURE_WORDS.test(text) || KEY_NAMES.test(text) || KEY_SYMBOLS.test(text);

/**
 * Las expresiones que terminan en un tooltip: `data-tip={…}`, `'data-tip': …`, `dataset.tip = …`,
 * `setAttribute('data-tip', …)` y el `tip` de un botón de la barra (`tip={…}`, `const tip = …`).
 */
function tipExpressions(code: string): string[] {
  const out: string[] = [];
  const starts = /data-tip=\{|['"]data-tip['"]\s*:\s*|dataset\.tip\s*=\s*|setAttribute\(\s*['"]data-tip['"]\s*,\s*|\btip=\{|\b(?:const|let)\s+tip\s*=\s*/g;
  for (const m of code.matchAll(starts)) {
    const begin = m.index! + m[0].length;
    // Lo abierto: paréntesis y llaves del código, y `${` de una plantilla (al cerrarse se vuelve a la plantilla).
    const stack: string[] = m[0].endsWith('{') ? ['{'] : [];
    const opened = stack.length > 0;
    let quote: string | null = null;
    let i = begin;
    for (; i < code.length; i++) {
      const c = code[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = null;
        else if (quote === '`' && c === '$' && code[i + 1] === '{') {
          stack.push('${');
          quote = null;
          i++;
        }
        continue;
      }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{' || c === '(' || c === '[') stack.push(c);
      else if (c === '}' || c === ')' || c === ']') {
        if (stack.length === 0) break;
        const top = stack.pop();
        if (top === '${') quote = '`';
        if (opened && stack.length === 0) break;
      } else if (!opened && stack.length === 0 && (c === ';' || c === ',')) break;
    }
    out.push(code.slice(begin, i));
  }
  return out;
}

/** Los textos escritos en el código (comillas y plantillas, sin lo de `${…}`). */
function literals(expr: string): string[] {
  const out: string[] = [];
  // El nombre de un gesto de tipRows (`gesture: 'click'`) no es un texto: lo traduce tipRows.
  // Ni la clave de un texto del diccionario (`tr('block.handleDrag')`): su texto se revisa aparte.
  expr = expr.replace(/\bgesture:\s*[^,}]+/g, '').replace(/\b(?:tr|t)\(\s*'[\w.]+'/g, '');
  for (const m of expr.matchAll(/'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`]*)`/g)) {
    const text = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
    out.push(text);
  }
  return out;
}

/** Las claves del diccionario que usa una expresión (`tr('x')`, `t('x')`). */
const keysOf = (expr: string) => [...expr.matchAll(/\b(?:tr|t)\(\s*'([\w.]+)'/g)].map((m) => m[1]);

const DICT = Object.assign(
  {},
  strings,
  annotator,
  assistant,
  carrete,
  commentsPanel,
  dictation,
  drive,
  editor,
  exportPdf,
  exportZip,
  folders,
  history,
  importArchive,
  importCoda,
  installDialog,
  oauthConsent,
  offline,
  projectStates,
  search,
  teamDialogs,
  templates,
) as Record<string, { en: Entry; es: Entry }>;
const forms = (e: Entry): string[] => (typeof e === 'string' ? [e] : [e.one, e.other]);

/**
 * Textos de tooltip que nombran algo parecido a un gesto o una tecla sin serlo. Cada uno con su motivo; agregar acá
 * solo si de verdad no es un gesto ni un atajo.
 */
const NOT_GESTURES: Record<string, string> = {
  // "Your finger moves and zooms the photo": explica qué hace el interruptor, no es un renglón de gesto.
  'annotate.penOnlyTip': 'explica el interruptor Only the pencil draws',
};

/** Los tooltips de la barra de formato son de BlockNote (su propio globo, con su forma de escribir los atajos). */
const BLOCKNOTE_TOOLTIPS = /\b(?:mainTooltip|secondaryTooltip)=/;

describe('tooltips con gesto o atajo (D226): un renglón por acción, «gesto o atajo: acción»', () => {
  const files = sourceFiles();
  const found = [...files].flatMap(([path, code]) => tipExpressions(code).map((expr) => ({ file: basename(path), expr })));

  it('el recorrido encuentra los tooltips de la app', () => {
    // Si el recorrido se rompe (encuentra pocos), la prueba no controlaría nada.
    expect(found.length).toBeGreaterThan(120);
    expect(found.some((f) => f.file === 'CollapseToggles.tsx' && f.expr.includes('toggleTip'))).toBe(true);
    expect(found.some((f) => f.file === 'inlinePhoto.ts' && f.expr.includes('tipRows'))).toBe(true);
    expect(found.some((f) => f.file === 'MediaBar.tsx' && f.expr.includes('tipRows'))).toBe(true);
  });

  it('ningún tooltip pone un atajo por su cuenta: van con tipRows, que los saca del registro', () => {
    const loose = found.filter((f) => /\b(?:shortcutLabel|keyLabel)\(/.test(f.expr)).map((f) => `${f.file}: ${f.expr.slice(0, 90)}`);
    expect(loose).toEqual([]);
  });

  it('ningún texto de tooltip escrito en el código nombra un gesto o una tecla', () => {
    const wrong = found.flatMap((f) => literals(f.expr).filter(namesGestureOrKey).map((text) => `${f.file}: ${text}`));
    expect(wrong).toEqual([]);
  });

  it('ningún texto de tooltip del diccionario nombra un gesto o una tecla (el gesto lo pone tipRows)', () => {
    const keys = new Set(found.flatMap((f) => keysOf(f.expr)));
    // También las claves con nombre de tooltip, aunque se armen en una variable con otro nombre.
    for (const key of Object.keys(DICT)) if (/(?:Tip|\.tip)(?:$|[A-Z.])/.test(key) && !key.startsWith('tip.')) keys.add(key);
    expect(keys.size).toBeGreaterThan(80);
    const wrong: string[] = [];
    for (const key of keys) {
      if (key.startsWith('tip.') || key in NOT_GESTURES) continue;
      const pair = DICT[key];
      expect(pair, `${key} no está en el diccionario`).toBeTruthy();
      for (const lang of ['en', 'es'] as const) {
        for (const text of forms(pair[lang])) if (namesGestureOrKey(text)) wrong.push(`${key} (${lang}): ${text}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('los tooltips de BlockNote (barra de formato) son los únicos fuera de tipRows, y solo en sus botones', () => {
    const files2 = [...files].filter(([, code]) => BLOCKNOTE_TOOLTIPS.test(code)).map(([path]) => basename(path)).sort();
    expect(files2).toEqual(['AssistantButton.tsx', 'EditorComments.tsx', 'PageToolbar.tsx']);
  });

  it('cada clave de NOT_GESTURES existe y se usa en un tooltip', () => {
    const keys = new Set(found.flatMap((f) => keysOf(f.expr)));
    for (const key of Object.keys(NOT_GESTURES)) {
      expect(DICT[key], key).toBeTruthy();
      expect(keys.has(key), key).toBe(true);
    }
  });
});

describe('tipRows: los renglones', () => {
  const row = /^\*\*[^*]+\*\*: [^*]+$/;
  it('«**gesto o atajo**: acción», con el atajo del registro en la forma de cada plataforma', () => {
    const rows = [
      { gesture: 'click' as const, shortcut: 'collapse', action: 'collapse just for you' },
      { gesture: 'shiftClick' as const, shortcut: 'collapseEveryone', action: 'for everyone' },
    ];
    expect(tipRows(rows, { mac: true, lang: 'en', touch: false })!.split('\n')).toEqual([
      '**Click or ⌘⌥↩**: collapse just for you',
      '**Shift+click or ⌘⌥⇧↩**: for everyone',
    ]);
    expect(tipRows(rows, { mac: false, lang: 'en', touch: false })!.split('\n')).toEqual([
      '**Click or Ctrl+Alt+Enter**: collapse just for you',
      '**Shift+click or Ctrl+Alt+Shift+Enter**: for everyone',
    ]);
    expect(tipRows(rows, { mac: true, lang: 'es', touch: false })!.split('\n')).toEqual([
      '**Clic o ⌘⌥↩**: collapse just for you',
      '**Shift+clic o ⌘⌥⇧↩**: for everyone',
    ]);
    for (const line of tipRows(rows, { mac: false, touch: false })!.split('\n')) expect(line).toMatch(row);
    // El atajo es exactamente el del registro.
    expect(tipRows([{ shortcut: 'findPrev', action: 'previous match' }], { mac: false, lang: 'en', touch: false })).toBe(
      `**${shortcutLabel('findPrev', false)}**: previous match`,
    );
  });

  it('los modificadores de un gesto: ⌥ y ⌘ en la Mac, Alt y Ctrl en el resto; la tecla que se mantiene, del registro', () => {
    expect(gestureLabel('altDrag', { mac: true, lang: 'en' })).toBe('⌥+drag');
    expect(gestureLabel('altDrag', { mac: false, lang: 'en' })).toBe('Alt+drag');
    expect(gestureLabel('modClick', { mac: true, lang: 'en' })).toBe('⌘+click');
    expect(gestureLabel('modClick', { mac: false, lang: 'es' })).toBe('Ctrl+clic');
    expect(gestureLabel('shiftDrag', { mac: true, lang: 'es' })).toBe('Shift+arrastrar');
    expect(gestureLabel('drag', { mac: false, lang: 'en' }, 'annotatePan')).toBe('Space+drag');
    expect(gestureLabel('drag', { mac: false, lang: 'es' }, 'annotatePan')).toBe('Espacio+arrastrar');
    expect(gestureLabel('doubleClick', { lang: 'es' })).toBe('Doble clic');
  });

  it('en una pantalla táctil: sin atajos ni gestos de mouse; sin renglones, sin tooltip', () => {
    const touch = { touch: true, mac: true, lang: 'en' as const };
    expect(tipRows([{ gesture: 'click', shortcut: 'collapse', action: 'collapse' }], touch)).toBe('**Click**: collapse');
    expect(tipRows([{ shortcut: 'find', action: 'find in page' }], touch)).toBeUndefined();
    expect(tipRows([{ gesture: 'shiftClick', action: 'for everyone' }, { gesture: 'doubleClick', action: 'reset' }, { gesture: 'scroll', action: 'zoom' }], touch)).toBeUndefined();
    // Una aclaración sola no es un tooltip de gesto: sin renglones, nada.
    expect(tipRows(['Pixels with the photo’s long side at 1920', { shortcut: 'annotateWidth', action: 'x' }], touch)).toBeUndefined();
    // Arrastrar solo si el renglón dice que existe con el dedo; pellizcar, siempre.
    expect(tipRows([{ gesture: 'drag', action: 'move it' }], touch)).toBeUndefined();
    expect(tipRows([{ gesture: 'drag', action: 'resize', touch: true }], touch)).toBe('**Drag**: resize');
    expect(tipRows([{ gesture: 'pinch', action: 'zoom' }], touch)).toBe('**Pinch**: zoom');
  });

  it('quien no puede hacer una acción no ve su renglón (`false`), y una aclaración va tal cual', () => {
    const canShare = false;
    expect(
      tipRows([{ gesture: 'click', action: 'expand' }, canShare && { gesture: 'shiftClick', action: 'expand for everyone' }], { touch: false, mac: true, lang: 'en' }),
    ).toBe('**Click**: expand');
    expect(tipRows([{ shortcut: 'photoOpen', action: 'view' }, 'Opens it full screen'], { touch: false, mac: true, lang: 'en' })).toBe('**Space**: view\nOpens it full screen');
  });

  it('se dibuja con el gesto y el atajo en negrita (blanco) y la acción en el gris del tooltip', () => {
    const text = tipRows([{ gesture: 'click', shortcut: 'collapse', action: 'collapse just for you' }], { mac: true, lang: 'en', touch: false })!;
    const nodes = renderTip(text) as { props: { children: { type: unknown; props: { children: string } }[] } }[];
    const parts = nodes[0].props.children.filter((p) => p.props.children !== '');
    expect(parts[0].type).toBe('strong');
    expect(parts[0].props.children).toBe('Click or ⌘⌥↩');
    expect(parts[1].type).not.toBe('strong');
    expect(parts[1].props.children).toBe(': collapse just for you');
  });

  it('asAction: el nombre de un botón como acción', () => {
    expect(asAction('Discard')).toBe('discard');
    expect(asAction('Assistant…')).toBe('assistant');
    expect(asAction('PDF export')).toBe('PDF export');
    expect(asAction(translate('es', 'common.close' as Key))).toBe('cerrar');
  });
});
