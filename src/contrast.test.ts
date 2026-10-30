import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COLORS_DARK_MODE_DEFAULT, COLORS_DEFAULT } from '@blocknote/core';
import { describe, expect, it } from 'vitest';

// El contraste del texto (Docs/Doc_Contraste.md): los tokens de styles.css, resueltos con una cascada mínima (las
// reglas que definen `--ink-heading`, `--ink-bold` y `--ink-body`, por especificidad y orden), para cada modo y nivel,
// en la pantalla (`:root`) y en el PDF (`.print-view`). Cada tono tiene que llegar a 4,5:1 contra su fondo (WCAG AA).

const CSS = readFileSync(resolve(__dirname, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

type Mode = 'light' | 'dark';
type Level = 'none' | 'contrast' | 'more';
type Target = 'root' | 'print';
const LEVELS: Level[] = ['none', 'contrast', 'more'];
const INKS = ['--ink-heading', '--ink-bold', '--ink-body'] as const;

/** Los fondos donde va el texto del documento: la página y la hoja (`--bg`), y lo blanco (`--surface`, el papel). */
const BACKGROUNDS: Record<Mode, string[]> = { light: ['#fbfaf8', '#ffffff'], dark: ['#171716', '#1f1e1c'] };

interface Rule {
  selectors: string[];
  decls: Map<string, string>;
  order: number;
}

function rules(): Rule[] {
  const out: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(CSS))) {
    const decls = new Map<string, string>();
    for (const d of m[2].split(';')) {
      const at = d.indexOf(':');
      if (at > 0) decls.set(d.slice(0, at).trim(), d.slice(at + 1).trim());
    }
    if (![...decls.keys()].some((k) => k.startsWith('--ink-'))) continue;
    out.push({ selectors: m[1].split(',').map((s) => s.trim()), decls, order: out.length });
  }
  return out;
}

/** Los atributos de `:root` de un compuesto como `:root[data-theme='dark'][data-contrast='more']`, o null. */
function rootAttrs(compound: string): Record<string, string> | null {
  if (!compound.startsWith(':root')) return null;
  const attrs: Record<string, string> = {};
  const rest = compound.slice(':root'.length).replace(/\[([\w-]+)='([^']*)'\]/g, (_, k: string, v: string) => {
    attrs[k] = v;
    return '';
  });
  return rest === '' ? attrs : null;
}

/** La especificidad (sin ids ni etiquetas: acá solo hay clases, atributos y `:root`). */
function specificity(selector: string): number {
  return (selector.match(/:root|\.[\w-]+|\[[^\]]+\]/g) ?? []).length;
}

function matches(selector: string, target: Target, attrs: Record<string, string>): boolean {
  const parts = selector.split(/\s+/);
  const own = (compound: string) => {
    const a = rootAttrs(compound);
    return !!a && Object.entries(a).every(([k, v]) => attrs[k] === v);
  };
  if (target === 'root') return parts.length === 1 && own(parts[0]);
  if (parts.length === 1) return parts[0] === '.print-view';
  return parts.length === 2 && parts[1] === '.print-view' && own(parts[0]);
}

/** El valor de cada tono para la pantalla o el PDF con esos atributos en `:root` (con la herencia de `:root`). */
function resolveInks(target: Target, attrs: Record<string, string>): Record<(typeof INKS)[number], string> {
  const all = rules();
  const raw = new Map<string, string>();
  const cascade = (t: Target) => {
    const winners = new Map<string, { spec: number; order: number; value: string }>();
    for (const r of all) {
      for (const s of r.selectors) {
        if (!matches(s, t, attrs)) continue;
        const spec = specificity(s);
        for (const [k, v] of r.decls) {
          const prev = winners.get(k);
          if (!prev || spec > prev.spec || (spec === prev.spec && r.order >= prev.order)) winners.set(k, { spec, order: r.order, value: v });
        }
      }
    }
    return winners;
  };
  for (const [k, v] of cascade('root')) raw.set(k, v.value);
  if (target === 'print') for (const [k, v] of cascade('print')) raw.set(k, v.value);
  const value = (v: string, depth = 0): string => {
    const ref = /^var\((--[\w-]+)\)$/.exec(v);
    if (!ref) return v.toLowerCase();
    if (depth > 5 || !raw.has(ref[1])) throw new Error(`Sin valor para ${ref[1]}`);
    return value(raw.get(ref[1])!, depth + 1);
  };
  return Object.fromEntries(INKS.map((k) => [k, value(raw.get(k) ?? 'var(--missing)')])) as Record<(typeof INKS)[number], string>;
}

function attrsOf(mode: Mode, level: Level | null): Record<string, string> {
  const a: Record<string, string> = { 'data-theme': mode };
  if (level) a['data-contrast'] = level;
  return a;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** La peor razón de un color contra los fondos de su modo. */
const worst = (color: string, mode: Mode) => Math.min(...BACKGROUNDS[mode].map((bg) => contrastRatio(color, bg)));

describe('tokens del contraste del texto', () => {
  it('la cuenta de WCAG da lo conocido (negro sobre blanco 21:1, gris medio 4,5:1)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
  });

  it('sin el atributo (antes de que carguen las preferencias) vale Contrast', () => {
    for (const mode of ['light', 'dark'] as Mode[]) {
      expect(resolveInks('root', attrsOf(mode, null))).toEqual(resolveInks('root', attrsOf(mode, 'contrast')));
    }
  });

  for (const mode of ['light', 'dark'] as Mode[]) {
    for (const level of LEVELS) {
      it(`${mode} · ${level}: todos los tonos llegan a 4,5:1 y la jerarquía va en orden`, () => {
        const inks = resolveInks('root', attrsOf(mode, level));
        const r = INKS.map((k) => worst(inks[k], mode));
        for (const ratio of r) expect(ratio).toBeGreaterThanOrEqual(4.5);
        if (level === 'none') {
          expect(new Set(Object.values(inks)).size).toBe(1);
        } else {
          // Encabezado > negrita > texto común, con un paso de verdad entre cada uno.
          expect(r[0] - r[1]).toBeGreaterThan(0);
          expect(r[1] - r[2]).toBeGreaterThan(1);
        }
      });
    }

    it(`${mode}: el encabezado es el de siempre (--text) y More contrast marca más que Contrast`, () => {
      const text = mode === 'light' ? '#1b1a17' : '#ece9e2';
      const c = resolveInks('root', attrsOf(mode, 'contrast'));
      const m = resolveInks('root', attrsOf(mode, 'more'));
      const n = resolveInks('root', attrsOf(mode, 'none'));
      expect([c['--ink-heading'], m['--ink-heading'], n['--ink-heading'], n['--ink-body']]).toEqual([text, text, text, text]);
      expect(worst(m['--ink-body'], mode)).toBeLessThan(worst(c['--ink-body'], mode));
      expect(worst(m['--ink-bold'], mode)).toBeGreaterThan(worst(c['--ink-bold'], mode));
    });
  }

  it('el texto común también llega a 4,5:1 sobre las marcas de Script (lugar, día, noche, hora dorada)', () => {
    const marks: Record<Mode, string[]> = {
      light: ['#dfe7dc', '#fbe7a1', '#cfe0fa', '#ffd9b8'],
      dark: ['#2c3a2d', '#4a3e16', '#1f3353', '#53331a'],
    };
    // Los fondos salen de styles.css: si cambian, esta lista también.
    for (const c of [...marks.light, ...marks.dark]) expect(CSS).toContain(`background: ${c};`);
    for (const mode of ['light', 'dark'] as Mode[]) {
      for (const level of LEVELS) {
        const ordinary = resolveInks('root', attrsOf(mode, level))['--ink-body'];
        const body = mode === 'dark' && level === 'more' ? '#b0aba1' : ordinary;
        if (body !== ordinary) {
          expect(CSS).toContain(":root[data-theme='dark'][data-contrast='more'] { --ink-script: #b0aba1; }");
          expect(CSS).toContain(".script-mark { color: var(--ink-script); }");
        }
        for (const bg of marks[mode]) expect(contrastRatio(body, bg), `${mode} ${level} ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('el PDF usa siempre los tonos del modo claro, en cada nivel y con la app en oscuro', () => {
    for (const level of LEVELS) {
      const light = resolveInks('root', attrsOf('light', level));
      expect(resolveInks('print', attrsOf('dark', level))).toEqual(light);
      expect(resolveInks('print', attrsOf('light', level))).toEqual(light);
      for (const k of INKS) expect(contrastRatio(light[k], '#ffffff')).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('reglas del editor', () => {
  const GATE = ":root:not([data-contrast='none'])";
  const block = (selector: string) => {
    const at = CSS.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThan(-1);
    return CSS.slice(at, CSS.indexOf('}', at));
  };
  /** Los selectores de una lista, separados solo por las comas de afuera de los paréntesis. */
  const topLevel = (list: string) => {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of list) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  /** La regla (selector y cuerpo) que empieza en `head`, con los espacios y saltos de renglón juntados en uno. */
  const FLAT = CSS.replace(/\s+/g, ' ');
  const ruleAt = (head: string) => {
    const at = FLAT.indexOf(head);
    expect(at, head).toBeGreaterThan(-1);
    return FLAT.slice(at, FLAT.indexOf('}', at));
  };

  it('el texto común, los encabezados y la negrita usan su tono; la negrita de un encabezado, el del encabezado', () => {
    expect(block('.bn-container .bn-default-styles')).toContain('color: var(--ink-body)');
    expect(block(`${GATE} .bn-container .bn-default-styles [data-content-type='heading']`)).toContain('color: var(--ink-heading)');
    expect(block(`${GATE} .bn-container .bn-default-styles strong`)).toContain('color: var(--ink-bold)');
    expect(block(`${GATE} .bn-container .bn-default-styles [data-content-type='heading'] strong`)).toContain('color: inherit');
  });

  it('No contrast es lo de siempre: ninguna regla con el tono del encabezado o la negrita corre, y el común es --text', () => {
    // Toda regla que pinta con `--ink-heading` o `--ink-bold` está apagada con *No contrast*; la única que queda es la del
    // texto común, que con *No contrast* resuelve a `--text` (el valor de antes): así nada cambia (ni la negrita de una
    // cita, que hereda su gris).
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    let painted = 0;
    while ((m = re.exec(CSS))) {
      if (!/(^|;|\s)color:\s*var\(--ink-(heading|bold)\)/.test(m[2])) continue;
      painted++;
      for (const sel of topLevel(m[1])) expect(sel.startsWith(GATE), sel).toBe(true);
    }
    expect(painted).toBe(3);
    for (const mode of ['light', 'dark'] as Mode[]) {
      const text = mode === 'light' ? '#1b1a17' : '#ece9e2';
      expect(resolveInks('root', attrsOf(mode, 'none'))['--ink-body']).toBe(text);
      expect(resolveInks('print', attrsOf(mode, 'none'))['--ink-body']).toBe('#1b1a17');
    }
  });

  it('todo lo que pone su propio color cambia los tonos por el color heredado (un color elegido, la cita)', () => {
    const rule = ruleAt('.bn-container .bn-default-styles :is(');
    for (const s of [
      "[data-style-type='textColor']",
      "[data-text-color]:not([data-text-color='default'])",
      ".bn-block:has(> .bn-block-content[data-text-color]:not([data-text-color='default']))",
      'blockquote,',
      '.hist-del',
    ]) {
      expect(rule, s).toContain(s);
    }
    // El link ya no pone color propio (D796): toma el del texto que lo rodea, y su negrita sigue con su tono.
    expect(rule).not.toContain(' a,');
    expect(rule).toContain('--ink-heading: currentColor');
    expect(rule).toContain('--ink-bold: currentColor');
  });

  it('un resaltado queda afuera de la jerarquía (tinta plena, también su negrita), salvo con un color de texto elegido', () => {
    const rule = ruleAt(`${GATE} .bn-container .bn-default-styles :is( [data-style-type='backgroundColor']`);
    for (const s of [
      "[data-background-color]:not([data-background-color='default'])",
      ".bn-block:has(> .bn-block-content[data-background-color]:not([data-background-color='default']))",
      "):not( [data-text-color]:not([data-text-color='default']),",
      ".bn-block:has(> .bn-block-content[data-text-color]:not([data-text-color='default'])) ) {",
      'color: var(--ink-heading);',
      '--ink-bold: var(--ink-heading);',
    ]) {
      expect(rule, s).toContain(s);
    }
  });

  // La paleta de la app (D827): un bloque por esquema que redefine las 18 variables de BlockNote (texto y fondo de cada
  // uno de los nueve colores).
  const NAMES = ['gray', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'];
  const palette = (mode: Mode) => {
    const rule = ruleAt(`.bn-root[data-color-scheme='${mode}'] {`);
    const read = (name: string, kind: 'text' | 'background') =>
      new RegExp(`--bn-colors-highlights-${name}-${kind}: (#[0-9a-f]{6});`, 'i').exec(rule)?.[1].toLowerCase();
    return Object.fromEntries(NAMES.map((n) => [n, { text: read(n, 'text'), background: read(n, 'background') }]));
  };

  it('cada color se lee sobre el fondo del mismo color, sobre la página, y el texto por defecto sobre cada fondo (D827)', () => {
    for (const mode of ['light', 'dark'] as Mode[]) {
      const colors = palette(mode);
      for (const name of NAMES) {
        const { text, background } = colors[name];
        expect(text, `${mode} ${name}`).toMatch(/^#[0-9a-f]{6}$/);
        expect(background, `${mode} ${name}`).toMatch(/^#[0-9a-f]{6}$/);
        // Un texto verde sobre un fondo verde (lo que traía Coda): se lee.
        expect(contrastRatio(text!, background!), `${mode} ${name} sobre su fondo`).toBeGreaterThanOrEqual(4.5);
        expect(worst(text!, mode), `${mode} ${name} sobre la página`).toBeGreaterThanOrEqual(4.5);
        // El texto por defecto sobre un resaltado va con la tinta del encabezado, igual en los tres niveles.
        for (const level of LEVELS) {
          const ink = resolveInks('root', attrsOf(mode, level))['--ink-heading'];
          expect(contrastRatio(ink, background!), `${mode} ${level} tinta sobre ${name}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('una escena, una locación o un decorado reconocidos se leen sobre cada fondo de la paleta (D828)', () => {
    // Los tonos de las entidades (styles.css): el primero de cada uno es el del claro, el segundo el del oscuro.
    const entity = (name: string) => [...CSS.matchAll(new RegExp(`^  --${name}-fg: (#[0-9a-f]{6});`, 'gim'))].map((m) => m[1]);
    for (const name of ['scene', 'loc', 'set']) {
      const [light, dark] = entity(name);
      expect(dark, name).toBeDefined();
      for (const [mode, fg] of [['light', light], ['dark', dark]] as [Mode, string][]) {
        for (const c of NAMES) expect(contrastRatio(fg, palette(mode)[c].background!), `${mode} ${name} sobre ${c}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('el verde es verde y el azul es azul: el matiz de cada uno, no el gris azulado de BlockNote (D827)', () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      if (d === 0) return -1;
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    for (const mode of ['light', 'dark'] as Mode[]) {
      const colors = palette(mode);
      for (const kind of ['text', 'background'] as const) {
        expect(hue(colors.green[kind]!), `${mode} verde ${kind}`).toBeGreaterThan(110);
        expect(hue(colors.green[kind]!), `${mode} verde ${kind}`).toBeLessThan(160);
        expect(hue(colors.blue[kind]!), `${mode} azul ${kind}`).toBeGreaterThan(195);
        expect(hue(colors.blue[kind]!), `${mode} azul ${kind}`).toBeLessThan(225);
      }
    }
    // Ya no es el de BlockNote.
    expect(palette('light').green.text).not.toBe(COLORS_DEFAULT.green.text);
    expect(palette('dark').green.background).not.toBe(COLORS_DARK_MODE_DEFAULT.green.background);
  });

  it('la paleta cuelga solo del esquema (claro u oscuro), nunca de la vista de impresión: el PDF usa la del claro', () => {
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    let found = 0;
    while ((m = re.exec(CSS))) {
      if (!/--bn-colors-highlights-[a-z]+-(background|text)/.test(m[2])) continue;
      found++;
      const sels = topLevel(m[1]);
      for (const sel of sels) expect(sel, sel).toMatch(/\[data-color-scheme='(light|dark)'\]/);
      // También la raíz donde BlockNote dibuja la barra de formato del teléfono (sin `.bn-container`).
      expect(sels.some((sel) => sel.startsWith('.bn-root['))).toBe(true);
    }
    expect(found).toBe(2);
    expect(CSS).not.toMatch(/\.print-view[^{}]*--bn-colors-highlights/);
  });
});

// Los links del texto y el botón principal (D787): la raya turquesa del link llega a 3:1 contra el papel (lo que pide un
// elemento que no es texto) y el texto del botón delineado del modo oscuro, a 4,5:1.
describe('links y botón principal', () => {
  const token = (block: RegExp, name: string) => {
    const body = block.exec(CSS)?.[1] ?? '';
    return new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(body)?.[1] ?? 'falta';
  };
  const LIGHT = /:root \{([^}]*)\}/;
  const DARK = /:root\[data-theme='dark'\] \{([^}]*--btn-primary-bg[^}]*)\}/;
  it('el link tiene el color del texto que lo rodea: lo único que cambia es la raya (D796)', () => {
    const rule = /\n\.editor a \{([^}]*)\}/.exec(CSS)?.[1] ?? 'falta';
    expect(rule).toContain('color: inherit');
    expect(rule).toContain('text-decoration-color: var(--link-line)');
  });
  it('la raya del link', () => {
    expect(worst(token(LIGHT, '--link-line'), 'light')).toBeGreaterThanOrEqual(3);
    expect(worst(token(DARK, '--link-line'), 'dark')).toBeGreaterThanOrEqual(3);
  });
  it('el texto del botón principal en oscuro (turquesa de texto)', () => {
    expect(worst(token(DARK, '--accent-text'), 'dark')).toBeGreaterThanOrEqual(4.5);
  });
});
