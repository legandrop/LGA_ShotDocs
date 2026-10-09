// El lector de escenas y locaciones de las relaciones en vivo (Docs/Doc_Relaciones.md, sección 2). Puro: sin Yjs,
// sin React y sin el árbol. Recibe qué escenas y locaciones existen (`buildRegistry`) y un texto, y devuelve dónde se
// nombra cada una. Es la gramática medida sobre todo ERSO (139 de 139 secciones de reporte a su escena exacta, 0 de
// más, 83 de 83 escenas en los planning, 0 pendientes falsos):
//
// - Una escena con letra propia (`101_069A`) es su propia escena y nunca se pliega a la base; la letra queda como
//   «parte» (`1074C` → `101_074`, parte C) solo si esa escena con letra no existe.
// - Formas: nombre de plano (`ERSO_105_027_010`), canónica (`105_027`, `105-027`, `105_027b`), compacta (`5027b`,
//   `H1067`, `2065A_PD`), con cero (`0116B`, solo en títulos), corta (`5-27A`), «Esc 27» dentro de su episodio;
//   continuaciones «+ 029B», «/46», «+C», «+14» y rangos «105_70-72».
// - El dígito de la forma compacta sale de los episodios que existen en el proyecto (101…109 → 1…9, también 201…);
//   si dos episodios terminan igual, la forma compacta se apaga (salvo con el episodio de la página).
// - En un título, una forma compacta o corta cuenta solo si es lo primero del título o va después de «Escena/Sc».
//   En el texto, solo con «Escena/Sc/plano/toma» delante, con letra pegada, con H delante o con «plano» después: los
//   años, las direcciones y las cantidades de 4 cifras quedan afuera.
// - Proyectos sin episodios (un largo, escenas 1–120; D383): la escena se escribe con 3 cifras y su letra
//   (`074`, `069A`). Cuenta con «Escena/Esc./Sc/Scene» delante (en el texto o en un título) o como lo primero de un
//   título si tiene 3 cifras con ceros (`074`, `074A`), 3 cifras con «|», «-», «:», «.» o nada después (`120 |
//   Plaza`), o lo sigue INT/EXT (`12 - INT. COCINA`; D391). Nunca una letra pegada a 1–2 cifras («3D Tracking»,
//   «4K Plates»), una lista numerada («1. General») ni un número suelto.
// - Locaciones: por nombre o alias, palabra entera, sin tildes ni mayúsculas; los genéricos («Estudio», «Casa»…)
//   y los alias de menos de 4 letras que no van en mayúsculas no se reconocen solos.

export type HitKind = 'scene' | 'pending' | 'loc';
export type HitForm = 'shot' | 'canonical' | 'compact' | 'zero' | 'short' | 'episode' | 'flat' | 'list' | 'range' | 'name';

export interface Hit {
  /** Dónde está, en posiciones del texto recibido. */
  s: number;
  e: number;
  kind: HitKind;
  /** La escena (`101_074`, `074`), el pendiente o el nombre de la locación. */
  ref: string;
  /** La letra que nombra una parte de la escena (`1074C` sin escena `101_074C`): `C`. */
  part: string;
  form: HitForm;
  /** Lo nombra sin dibujarse aparte (las escenas del medio de un rango, o encimadas con otra). */
  hidden?: boolean;
}

export interface ScanContext {
  /** El texto es un título (cambia la regla de los números sueltos). */
  heading?: boolean;
  /** El episodio de la página (la de una escena o lo que está adentro de una): «Esc 27» → `105_027`. */
  ep?: string | null;
  /** El texto es el título de un día de rodaje (su lugar, D398): valen también los alias solo de título (D417). */
  dayTitle?: boolean;
}

export interface SceneInput {
  /** El código como venga (`101_074`, `101-074`, `101_69a`, `74`): se pasa a la forma canónica. */
  code: string;
  pageId?: string | null;
}

export interface LocationInput {
  name: string;
  aliases?: string[];
  /** Alias que valen solo en el título de un día de rodaje (D417): «Inquilinato» de `Inquilinato (Cachi 247)`. */
  dayTitleAliases?: string[];
  pageId?: string | null;
}

export interface SceneEntry {
  code: string;
  /** El episodio (`101`), o '' en un proyecto sin episodios. */
  ep: string;
  /** El número con 3 cifras (`074`). */
  n: string;
  letter: string;
  pageId: string | null;
}

export interface LocationEntry {
  name: string;
  aliases: string[];
  pageId: string | null;
}

export interface Registry {
  scenes: Map<string, SceneEntry>;
  /** Los episodios que existen (`101`, `102`…). */
  eps: Set<string>;
  /** Las bases (sin letra) de todas las escenas, también de las que solo existen con letra. */
  bases: Set<string>;
  /** El dígito de la forma compacta → su episodio; `null` si es ambiguo (101 y 201). */
  epByDigit: Map<string, string | null>;
  /** El proyecto tiene escenas sin episodio (D383). */
  flat: boolean;
  locations: Map<string, LocationEntry>;
  /** Alias de locación ya normalizados, del más largo al más corto. */
  locAlias: { f: string; name: string }[];
  /** Los mismos más los que valen solo en el título de un día (D417), del más largo al más corto. */
  locDayTitleAlias: { f: string; name: string }[];
  /** Cambia cuando cambia lo que se reconoce (para no volver a leer de más). */
  signature: string;
}

export const pad3 = (n: string | number): string => String(n).padStart(3, '0');

/** Sin tildes ni mayúsculas. */
export function fold(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Como `fold`, pero con el mismo largo que el original (las posiciones de lo encontrado tienen que caer en el texto
 * original). Si alguna letra cambia de largo al normalizar (el coreano se descompone), va letra por letra.
 */
export function foldSameLength(s: string): string {
  const f = fold(s);
  if (f.length === s.length) return f;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    // Una mitad de un par sustituto queda como está.
    const g = /[\uD800-\uDFFF]/.test(c) ? c : fold(c);
    out += g.length === 1 ? g : c;
  }
  return out;
}

const CODE_EP = /^(\d{3})\s?[-_]\s?(\d{1,3})([A-Za-z])?$/;
const CODE_FLAT = /^(\d{1,3})([A-Za-z])?$/;

/** La forma canónica de un código de escena (`101-74a` → `101_074A`, `74` → `074`), o `null` si no es uno. */
export function sceneCode(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  let m = CODE_EP.exec(s);
  if (m) return `${m[1]}_${pad3(m[2])}${(m[3] ?? '').toUpperCase()}`;
  m = CODE_FLAT.exec(s);
  if (m && +m[1] > 0) return `${pad3(m[1])}${(m[2] ?? '').toUpperCase()}`;
  return null;
}

function splitCode(code: string): { ep: string; n: string; letter: string } {
  const m = /^(?:(\d{3})_)?(\d{3})([A-Z]?)$/.exec(code)!;
  return { ep: m[1] ?? '', n: m[2], letter: m[3] };
}

/** Las locaciones con estos nombres no se reconocen solas: son palabras comunes. */
const GENERIC = new Set(['estudio', 'europa', 'abril', 'centro', 'casa']);

/**
 * Si un nombre o alias de locación se reconoce solo en el texto: no es una palabra común (`Estudio`, `Casa`) ni tiene
 * menos de 4 letras salvo en mayúsculas (`CABA` sí, `Bar` no). Lo usa también *Create location* (D525) para avisar.
 */
export function recognizedAlone(alias: string): boolean {
  const f = fold(alias).trim();
  return !!f && !GENERIC.has(f) && !(f.length < 4 && alias !== alias.toUpperCase());
}

export function buildRegistry(input: { scenes: SceneInput[]; locations: LocationInput[] }): Registry {
  const scenes = new Map<string, SceneEntry>();
  for (const s of input.scenes) {
    const code = sceneCode(s.code);
    if (!code || scenes.has(code)) continue;
    scenes.set(code, { code, ...splitCode(code), pageId: s.pageId ?? null });
  }
  const eps = new Set<string>();
  const bases = new Set<string>();
  let flat = false;
  for (const s of scenes.values()) {
    if (s.ep) eps.add(s.ep);
    else flat = true;
    bases.add(s.ep ? `${s.ep}_${s.n}` : s.n);
  }
  const epByDigit = new Map<string, string | null>();
  for (const ep of eps) {
    const d = String(+ep.slice(1));
    if (d.length !== 1) continue;
    epByDigit.set(d, epByDigit.has(d) ? null : ep);
  }
  const locations = new Map<string, LocationEntry>();
  for (const l of input.locations) {
    const name = l.name.trim();
    if (!name || locations.has(name)) continue;
    locations.set(name, { name, aliases: l.aliases?.length ? l.aliases : [name], pageId: l.pageId ?? null });
  }
  const usable = (a: string) => (recognizedAlone(a) ? fold(a).trim() : null);
  const longestFirst = (a: { f: string }, b: { f: string }) => b.f.length - a.f.length || (a.f < b.f ? -1 : a.f > b.f ? 1 : 0);
  const locAlias: Registry['locAlias'] = [];
  const locDayTitleAlias: Registry['locDayTitleAlias'] = [];
  for (const l of locations.values()) {
    for (const a of new Set([l.name, ...l.aliases])) {
      const f = usable(a);
      if (f) locAlias.push({ f, name: l.name });
    }
  }
  for (const l of input.locations) {
    const name = l.name.trim();
    for (const a of l.dayTitleAliases ?? []) {
      const f = usable(a);
      if (f && locations.has(name) && !locAlias.some((x) => x.f === f)) locDayTitleAlias.push({ f, name });
    }
  }
  locAlias.sort(longestFirst);
  locDayTitleAlias.push(...locAlias);
  locDayTitleAlias.sort(longestFirst);
  const signature = [
    [...scenes.keys()].sort().join(','),
    locAlias.map((a) => `${a.f}=${a.name}`).join(','),
    locDayTitleAlias.map((a) => `${a.f}=${a.name}`).join(','),
  ].join('|');
  return { scenes, eps, bases, epByDigit, flat, locations, locAlias, locDayTitleAlias, signature };
}

// Lo que va antes de un número para que cuente en el texto: «Escena», «Esc.», «Sc», «Scene», «plano», «toma»…
// Palabra entera (no el final de «disc» ni de «kiosc»; D385).
const CTX_BEFORE = /(?<![\p{L}\p{N}])(escena|esc\.?|sc\.?|scene|plano|planos|shot|seq|toma)\s*[:#nº°]?\s*\(?$/iu;
// Lo mismo, solo con las palabras que dicen «escena» (proyectos sin episodios: «plano 12» no es la escena 12).
// «Esc» sin punto solo con un número de 2 cifras o más: «Presioná Esc 2 veces» es la tecla (D392).
const SCENE_WORD = '(?<![\\p{L}\\p{N}])(?:escena|esc\\.|esc(?=\\s*[:#nº°]?\\s*\\d{2})|sc\\.?|scene)\\s*[:#nº°]?\\s*';
// Lo que puede seguir al número: una letra (con un dígito o «Ins» pegados: `1016A1`, `101_033AIns`) o «Ins».
const SUF = '((?:[A-Za-z](?:\\d|Ins|ins|INS)?)|Ins|ins)?';
// Continuaciones: «+14», «+ 029B», «/46», «+C», rango «-72»; «, 23» e «y 23» solo con 2-3 cifras.
const CONT = /^(\s*(?:[+/]|,|y|-)\s*)(\d{1,4}|[A-Za-z])([A-Za-z]?)(?=\W|_|$)/;
const MASK = /https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+\.[\w.]+/g;

const RE_SHOT = /\b[A-Z]{2,6}_(\d{3})_(\d{1,3})([A-Za-z]?)(?=_|\b)(?:_\d{2,3})?/g;
const RE_CAN = new RegExp(`(?<![\\w/=.:])(\\d{3})\\s?[-_]\\s?(\\d{1,3})${SUF}(?=_|\\b)`, 'g');
const RE_CMP = new RegExp(`(?<![\\w./:=#-])[hH]?([1-9])(\\d{3})${SUF}(?=_|\\b)(?![.,]\\d|-\\d)`, 'g');
const RE_ZERO = new RegExp(`(?<![\\w./:=#-])0([1-9])(\\d{2})${SUF}(?=_|\\b)`, 'g');
const RE_SHORT = /(?<![\w/.:=-])[hH]?([1-9])-(\d{1,3})([A-Za-z]?)\b(?![-/.]\d)/g;
const RE_EP = new RegExp(`${SCENE_WORD}(\\d{1,3})${SUF}(?=_|\\b)`, 'giu');
// Sin episodios (D383).
const RE_FLAT_WORD = new RegExp(`${SCENE_WORD}(\\d{1,3})${SUF}(?=_|\\b)`, 'giu');
const RE_FLAT_HEAD = /^([\s(\[«"'·•:–-]*)(\d{1,3})([A-Za-z]?)(?=$|[^\w])/;
const RE_FLAT_SHOT = /\b[A-Z]{2,6}_(\d{3})([A-Za-z]?)_\d{2,4}\b/g;

/**
 * Dónde nombra un texto escenas, pendientes (escenas que no existen) y locaciones. Sin encimarse: gana lo que empieza
 * antes y, a igual inicio, lo más largo; lo encimado que nombra otra escena queda como `hidden`.
 */
export function scan(R: Registry, text: string, ctx: ScanContext = {}): Hit[] {
  const masked = text.replace(MASK, (m) => ' '.repeat(m.length));
  const out: Hit[] = [];
  const taken: [number, number][] = [];
  const free = (s: number, e: number) => !taken.some(([a, b]) => s < b && e > a);
  const before = (i: number) => masked.slice(Math.max(0, i - 16), i);
  const firstInHeading = (i: number) => /^[\s(\[«"'·•:–-]*$/.test(masked.slice(0, i));
  const key = (ep: string, n: string) => (ep ? `${ep}_${n}` : n);
  const resolve = (ep: string, num: string, letter: string | undefined): { id: string; part: string } | null => {
    const n = pad3(+num);
    const L = (letter ?? '').charAt(0).toUpperCase();
    if (L && R.scenes.has(key(ep, n) + L)) return { id: key(ep, n) + L, part: '' };
    if (R.scenes.has(key(ep, n))) return { id: key(ep, n), part: L };
    return null;
  };
  const epOf = (d: string): string | null => {
    const e = R.epByDigit.get(d);
    if (e) return e;
    if (ctx.ep && String(+ctx.ep.slice(1)) === d) return ctx.ep;
    return null;
  };
  const push = (s: number, e: number, ep: string, num: string, letter: string | undefined, form: HitForm, strong: boolean) => {
    const r = resolve(ep, num, letter);
    if (r) {
      out.push({ s, e, kind: 'scene', ref: r.id, part: r.part, form });
      return r;
    }
    // Pendiente: solo formas fuertes, con un episodio que existe (o en un proyecto sin episodios), y si no existe ni la
    // base ni una variante con letra.
    const n = pad3(+num);
    if (strong && (ep ? R.eps.has(ep) : R.flat) && !R.bases.has(key(ep, n))) {
      out.push({ s, e, kind: 'pending', ref: key(ep, n), part: (letter ?? '').charAt(0).toUpperCase(), form });
    }
    return null;
  };
  const cont = (end: number, ep: string, num: string, digit?: string) => {
    let at = end;
    let last = +num;
    for (let k = 0; k < 5; k++) {
      const c = CONT.exec(masked.slice(at));
      if (!c) break;
      const sep = c[1].trim();
      const e = at + c[0].length;
      const s = at + c[1].length;
      let ok = false;
      let value = c[2];
      if (/^[A-Za-z]$/.test(value)) {
        if (sep === '+' || sep === '/') {
          const r = resolve(ep, String(last), value);
          if (r) {
            out.push({ s, e, kind: 'scene', ref: r.id, part: r.part, form: 'list' });
            ok = true;
          }
        }
      } else {
        // «1013 + 1014», «5055+5058»: la forma compacta entera, con el mismo dígito de episodio.
        if (value.length === 4) {
          if (!digit || value[0] !== digit) break;
          value = value.slice(1);
        }
        const n = +value;
        if (sep === '-') {
          if (n > last && n - last <= 5) {
            for (let q = last + 1; q <= n; q++) {
              const r = resolve(ep, String(q), q === n ? c[3] : '');
              if (r) {
                out.push({ s, e, kind: 'scene', ref: r.id, part: r.part, form: 'range', hidden: q !== n });
                ok = true;
              }
            }
          }
        } else if (!((sep === ',' || sep === 'y') && value.length < 2)) {
          const r = resolve(ep, value, c[3]);
          if (r) {
            out.push({ s, e, kind: 'scene', ref: r.id, part: r.part, form: 'list' });
            ok = true;
          }
        }
        last = n;
      }
      if (!ok) break;
      taken.push([at, e]);
      at = e;
    }
  };
  let m: RegExpExecArray | null;
  if (R.eps.size > 0) {
    // 1) Nombre de plano: ERSO_105_027_010.
    RE_SHOT.lastIndex = 0;
    while ((m = RE_SHOT.exec(masked))) {
      const s = m.index;
      const e = s + m[0].length;
      if (!R.eps.has(m[1]) || !free(s, e)) continue;
      taken.push([s, e]);
      push(s, e, m[1], m[2], m[3], 'shot', false);
    }
    // 2) Canónica: 105_027, 105-027, 105_027b, 103_045/46, 105_70-72.
    RE_CAN.lastIndex = 0;
    while ((m = RE_CAN.exec(masked))) {
      const s = m.index;
      const e = s + m[0].length;
      if (!R.eps.has(m[1]) || !free(s, e)) continue;
      // Una fecha (2025-11-26) o un plate (105_52-02-09).
      if (/^-\d{2}-\d/.test(masked.slice(e - 3)) || /\d{4}-\d{2}-\d{2}/.test(masked.slice(Math.max(0, s - 2), e + 3))) continue;
      taken.push([s, e]);
      const r = push(s, e, m[1], m[2], m[3], 'canonical', m[2].length === 3);
      if (r || R.bases.has(`${m[1]}_${pad3(+m[2])}`)) cont(e, m[1], m[2]);
    }
    // 3) Compacta: 5027, 5027b, H1067, 2065A_PD.
    RE_CMP.lastIndex = 0;
    while ((m = RE_CMP.exec(masked))) {
      const s = m.index;
      const e = s + m[0].length;
      if (!free(s, e)) continue;
      const ep = epOf(m[1]);
      if (!ep) continue;
      const ctxOk = CTX_BEFORE.test(before(s));
      const plano = /^\s+plano/i.test(masked.slice(e));
      // En el texto, una letra pegada alcanza, salvo las de una unidad («1080p», «1080i», «4050K», «2030h»: la auditoría
      // de la v0.237, para el subrayado) si no existe la escena con esa letra.
      const unit = !!m[3] && /^[pikh]$/i.test(m[3]) && !/^[hH]/.test(m[0]) && !R.scenes.has(key(ep, pad3(+m[2])) + m[3].toUpperCase());
      const ok = ctx.heading ? firstInHeading(s) || ctxOk : ctxOk || plano || (!!m[3] && !unit) || /^[hH]/.test(m[0]);
      if (!ok) continue;
      taken.push([s, e]);
      const r = push(s, e, ep, m[2], m[3], 'compact', ctxOk);
      if (r) cont(e, ep, m[2], m[1]);
    }
    // 4) Con cero, solo en títulos: 0116B, 0168.
    if (ctx.heading) {
      RE_ZERO.lastIndex = 0;
      while ((m = RE_ZERO.exec(masked))) {
        const s = m.index;
        const e = s + m[0].length;
        if (!free(s, e)) continue;
        const ep = epOf(m[1]);
        if (!ep || !(firstInHeading(s) || CTX_BEFORE.test(before(s)))) continue;
        taken.push([s, e]);
        push(s, e, ep, m[2], m[3], 'zero', false);
      }
    }
    // 5) Corta: 5-27, 5-27A, 4-5A (en un título como primera palabra, o con «Escena» delante).
    RE_SHORT.lastIndex = 0;
    while ((m = RE_SHORT.exec(masked))) {
      const s = m.index;
      const e = s + m[0].length;
      if (!free(s, e)) continue;
      const ep = epOf(m[1]);
      if (!ep) continue;
      if (!(CTX_BEFORE.test(before(s)) || (ctx.heading && firstInHeading(s)))) continue;
      taken.push([s, e]);
      const r = push(s, e, ep, m[2], m[3], 'short', false);
      if (r) cont(e, ep, m[2], m[1]);
    }
    // 6) Dentro de un episodio: «Esc 74» → 105_074.
    if (ctx.ep && R.eps.has(ctx.ep)) {
      RE_EP.lastIndex = 0;
      while ((m = RE_EP.exec(masked))) {
        const e = m.index + m[0].length;
        const s = e - (m[1] + (m[2] ?? '')).length;
        if (!free(s, e)) continue;
        taken.push([s, e]);
        push(s, e, ctx.ep, m[1], m[2], 'episode', true);
      }
    }
  }
  if (R.flat && R.eps.size === 0) {
    // Sin episodios (D383). Nombre de plano: ABC_074_010 (la escena y el plano).
    RE_FLAT_SHOT.lastIndex = 0;
    while ((m = RE_FLAT_SHOT.exec(masked))) {
      const s = m.index;
      const e = s + m[0].length;
      if (!free(s, e)) continue;
      taken.push([s, e]);
      push(s, e, '', m[1], m[2], 'shot', false);
    }
    // «Escena 74», «Sc. 74A», «escena 074», en el texto o en un título.
    RE_FLAT_WORD.lastIndex = 0;
    while ((m = RE_FLAT_WORD.exec(masked))) {
      const e = m.index + m[0].length;
      const s = e - (m[1] + (m[2] ?? '')).length;
      if (!free(s, e)) continue;
      taken.push([s, e]);
      const r = push(s, e, '', m[1], m[2], 'flat', true);
      if (r || R.bases.has(pad3(+m[1]))) cont(e, '', m[1]);
    }
    // Lo primero de un título (D391): con 3 cifras y ceros (`074`, `074A`), con 3 cifras y un separador o nada
    // (`120 | Plaza`), o seguido de INT/EXT/I/E (`12 - INT. COCINA`). Nunca una letra pegada a 1–2 cifras («3D
    // Tracking», «4K Plates») ni una lista numerada («1. General»).
    if (ctx.heading) {
      const h = RE_FLAT_HEAD.exec(masked);
      if (h) {
        const s = h[1].length;
        const e = s + h[2].length + h[3].length;
        const rest = masked.slice(e);
        const three = h[2].length === 3;
        const padded = three && h[2][0] === '0';
        const separated = /^\s*(?:$|\||[-–—:.]\s|[-–—:.]$)/.test(rest);
        const intExt = /^\s*(?:[-–—:.|]\s*)?(?:int|ext|i\/e)\b/i.test(rest);
        const ok = three ? padded || separated || intExt : !h[3] && intExt;
        if (ok && free(s, e)) {
          taken.push([s, e]);
          const r = push(s, e, '', h[2], h[3], 'flat', false);
          if (r) cont(e, '', h[2]);
        }
      }
    }
  }
  // 7) Locaciones por nombre o alias (palabra entera, sin tildes).
  const aliases = ctx.dayTitle ? R.locDayTitleAlias : R.locAlias;
  if (aliases.length > 0) {
    const f = foldSameLength(masked);
    for (const a of aliases) {
      let i = 0;
      while ((i = f.indexOf(a.f, i)) >= 0) {
        const j = i + a.f.length;
        const okL = i === 0 || !/[\p{L}\p{N}]/u.test(f[i - 1]);
        const okR = j >= f.length || !/[\p{L}\p{N}]/u.test(f[j]);
        if (okL && okR && free(i, j)) out.push({ s: i, e: j, kind: 'loc', ref: a.name, part: '', form: 'name' });
        i = j;
      }
    }
  }
  // Para dibujar sin superposiciones: gana el que empieza antes; a igual inicio, el más largo.
  out.sort((a, b) => a.s - b.s || b.e - b.s - (a.e - a.s) || Number(a.kind === 'loc') - Number(b.kind === 'loc'));
  const res: Hit[] = [];
  let end = -1;
  for (const x of out) {
    if (x.s < end || x.hidden) {
      const prev = res[res.length - 1];
      if (x.kind !== 'loc' && (!prev || x.ref !== prev.ref)) res.push({ ...x, hidden: true });
      continue;
    }
    res.push(x);
    end = x.e;
  }
  return res;
}
