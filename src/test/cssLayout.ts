// Un mini intérprete de `styles.css` para las pruebas del diseño (solo lo que esas pruebas necesitan): junta las
// declaraciones que valen a un ancho de pantalla, las ordena como el navegador (!important, especificidad, orden) y
// resuelve `var(--x)` y los px. No es CSS completo: lo que no sabe calcular (`calc`, `max()`, `%`) da NaN y la prueba
// que lo use falla en voz alta en vez de adivinar. jsdom no hace diseño; esto calcula desde los valores del CSS, no desde
// el texto de la hoja, así que un cambio de margen o de ancho mueve el resultado.

export interface Decl {
  selector: string;
  prop: string;
  value: string;
  important: boolean;
  spec: number;
  order: number;
}

/** Parte `text` por `sep` sin cortar adentro de paréntesis ni de comillas (las imágenes `url("data:…;base64")`). */
function splitTop(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === sep && depth === 0) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(text.slice(from));
  return parts;
}

/** Los lados de un valor de cuatro lados (`padding: 1px 2px`), en el orden de CSS: arriba, derecha, abajo, izquierda. */
function sides(value: string): [string, string, string, string] {
  const v = splitTop(value.trim().replace(/\s+/g, ' '), ' ');
  if (v.length === 1) return [v[0], v[0], v[0], v[0]];
  if (v.length === 2) return [v[0], v[1], v[0], v[1]];
  if (v.length === 3) return [v[0], v[1], v[2], v[1]];
  return [v[0], v[1], v[2], v[3]];
}

/** Las propiedades largas que cubre una abreviada (solo las que necesitan las pruebas). */
function expand(prop: string, value: string): Array<[string, string]> {
  if (prop === 'padding') {
    const [t, r, b, l] = sides(value);
    return [
      ['padding-top', t],
      ['padding-right', r],
      ['padding-bottom', b],
      ['padding-left', l],
    ];
  }
  if (prop === 'padding-inline') {
    const [a, b] = sides(value);
    return [
      ['padding-left', a],
      ['padding-right', b],
    ];
  }
  if (prop === 'border') {
    const width = value.trim().split(/\s+/)[0];
    return [['border-width', /^\d/.test(width) ? width : '1px']];
  }
  return [[prop, value]];
}

/** La especificidad de un selector simple: `button` (1), `.clase` (10 cada una), `:root` (10). Los demás no se usan. */
function specificity(selector: string): number {
  const classes = (selector.match(/\.[\w-]+/g) ?? []).length;
  const tag = /^[a-z]/i.test(selector) ? 1 : 0;
  return classes * 10 + tag + (selector.startsWith(':root') ? 10 : 0);
}

/** Todas las declaraciones de la hoja que valen con `width` px de pantalla (`@media (max-width: Npx)` con `N >= width`). */
export function parseCss(css: string, width: number): Decl[] {
  const text = css.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Decl[] = [];
  let order = 0;

  const walk = (src: string) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) break;
      const head = src.slice(i, open).trim();
      let depth = 1;
      let quote = '';
      let j = open + 1;
      for (; j < src.length && depth > 0; j++) {
        const c = src[j];
        if (quote) {
          if (c === quote) quote = '';
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '{') depth++;
        else if (c === '}') depth--;
      }
      const body = src.slice(open + 1, j - 1);
      i = j;
      if (head.startsWith('@')) {
        const m = /^@media \(max-width:\s*(\d+)px\)$/.exec(head);
        if (m && width <= Number(m[1])) walk(body);
        continue; // otros @media (hover, min-width…), @keyframes y @font-face: no se tienen en cuenta
      }
      for (const selector of head.split(',').map((s) => s.trim())) {
        for (const raw of splitTop(body, ';')) {
          const colon = raw.indexOf(':');
          if (colon < 0 || !raw.trim()) continue;
          const prop = raw.slice(0, colon).trim();
          let value = raw.slice(colon + 1).trim();
          const important = /\s*!important$/.test(value);
          value = value.replace(/\s*!important$/, '');
          for (const [p, v] of expand(prop, value)) {
            out.push({ selector, prop: p, value: v, important, spec: specificity(selector), order: order++ });
          }
        }
      }
    }
  };
  walk(text);
  return out;
}

/** Los estilos que le tocan a un elemento simple (`tag` y `classes`), ya en cascada: propiedad -> valor sin resolver. */
export function styleOf(decls: Decl[], tag: string, classes: string[]): Map<string, string> {
  const matching = decls.filter((d) => d.selector === tag || classes.some((c) => d.selector === `.${c}`));
  matching.sort((a, b) => Number(a.important) - Number(b.important) || a.spec - b.spec || a.order - b.order);
  const style = new Map<string, string>();
  for (const d of matching) style.set(d.prop, d.value);
  return style;
}

/** El valor de `prop` en la regla exacta `selector` (para los descendientes, como `.comment-count svg`): la última que vale. */
export function ruleValue(decls: Decl[], selector: string, prop: string): string | undefined {
  return decls.filter((d) => d.selector === selector && d.prop === prop).at(-1)?.value;
}

/** Las variables de `:root` (la pantalla del teléfono las redefine adentro de su `@media`). */
export function rootVars(decls: Decl[]): Map<string, string> {
  const vars = new Map<string, string>();
  const rootDecls = decls.filter((d) => d.selector === ':root' && d.prop.startsWith('--'));
  rootDecls.sort((a, b) => Number(a.important) - Number(b.important) || a.order - b.order);
  for (const d of rootDecls) vars.set(d.prop, d.value);
  return vars;
}

/** Un valor en px, con `var(--x)` resuelto: `20px`, `0` y `var(--gutter)` valen; lo demás (`calc`, `max()`) da NaN. */
export function px(value: string | undefined, vars: Map<string, string>): number {
  if (value === undefined) return NaN;
  let v = value.trim();
  for (let n = 0; n < 5 && /var\(/.test(v); n++) {
    v = v.replace(/var\((--[\w-]+)\)/g, (_, name: string) => vars.get(name) ?? 'NaN');
  }
  const m = /^(-?\d+(?:\.\d+)?)(?:px)?$/.exec(v);
  return m ? Number(m[1]) : NaN;
}
