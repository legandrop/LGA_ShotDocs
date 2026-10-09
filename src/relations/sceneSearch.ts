import { sceneTitleOf } from './dayLive';
import { fold, pad3, scan, type Registry } from './reader';

// Buscar una escena o una locación por lo que se escribe (Docs/Doc_Relaciones.md, sección 12; Docs/Doc_Buscar.md,
// «Escenas y locaciones primero»). Puro y con el mismo lector que el texto (`scan`): ninguna gramática nueva. Lo usan la
// lupa ⌘K (`findEntities`) y, desde E7, el `/`, *Add scene* de *Tomorrow* y *Assign* (`searchScenes`,
// `searchLocations`). Solo con lo que existe en el registro, que es lo que la persona ve.
//
// Orden de `searchScenes`:
// 1. **Exacto, por el lector:** lo escrito leído como un título (`101_074`, `101-074`, `1074`, `5027b`, `H1067`,
//    `1033B+C`) y con «Escena» delante dentro del episodio de la página (`Escena 27`, `27`); si no hay episodio o no
//    existe ahí, en todos los episodios (el de la página primero). Si la escena existe solo con letra (`101_069A`),
//    sus variantes.
// 2. **Por los dígitos** (si `loose`): los códigos cuya forma compacta o entera contiene los dígitos escritos (`02`).
// 3. **Por el título** (si `loose`): el título sin tildes que contiene lo escrito (`cami`).
// En 2 y 3, primero las de `near` (las del día) y las del episodio de la página, después por código.

export interface SearchSource {
  snap: { registry: Registry };
  /** El título de una página que la persona ve (o `undefined`). */
  title(pageId: string): string | undefined;
}

export interface SceneOption {
  code: string;
  /** Su página, si la persona la ve. */
  pageId: string | null;
  /** Su título sin el número. */
  title: string;
  episode: string | null;
  /** Cómo coincidió. */
  why: 'number' | 'episode' | 'digits' | 'title';
}

export interface LocationOption {
  name: string;
  pageId: string | null;
  why: 'name' | 'prefix' | 'contains';
}

export interface EntityHit {
  kind: 'scene' | 'loc' | 'pending';
  ref: string;
  pageId: string | null;
  /** El título de la escena sin su número, o vacío. */
  title: string;
  episode: string | null;
  why: SceneOption['why'] | LocationOption['why'];
}

const SCENE_WORD = /^(?:escena|esc\.?|sc\.?|scene)\s*[:#nº°]?\s*/i;
const BARE = /^(\d{1,3})([a-z]?)$/i;
// Como la canónica del lector, y también con un espacio («105 027»).
const CANON = /^(\d{3})\s*[-_\s]\s*(\d{1,3})([a-z]?)$/i;
const COMPACT = /^[hH]?([1-9])(\d{3})([a-z]?)$/;

const visible = (src: SearchSource, pageId: string | null | undefined) => (pageId && src.title(pageId) !== undefined ? pageId : null);

function option(src: SearchSource, code: string, why: SceneOption['why']): SceneOption {
  const e = src.snap.registry.scenes.get(code);
  const pageId = visible(src, e?.pageId);
  return { code, pageId, title: pageId ? sceneTitleOf(src.title(pageId)) : '', episode: e?.ep || null, why };
}

/** Lo que el lector entiende exacto en lo escrito: escenas (en orden) y números que no existen (pendientes). */
function exact(R: Registry, q: string, ep: string | null): { scenes: { code: string; why: SceneOption['why'] }[]; pending: string[] } {
  const scenes: { code: string; why: SceneOption['why'] }[] = [];
  const pending: string[] = [];
  const add = (code: string, why: SceneOption['why']) => {
    if (!scenes.some((x) => x.code === code)) scenes.push({ code, why });
  };
  // Leído como el título de una sección: así cuenta una forma compacta suelta («1074», «5027b»).
  const hits = scan(R, q, { heading: true, ep });
  for (const h of hits) {
    if (h.kind === 'scene') add(h.ref, h.form === 'episode' ? 'episode' : 'number');
    else if (h.kind === 'pending' && !pending.includes(h.ref)) pending.push(h.ref);
  }
  if (scenes.length) return { scenes, pending };
  // Un número suelto («27», «Escena 27»), o una escena que existe solo con letra (`101_074` → `101_074A`).
  const rest = q.replace(SCENE_WORD, '');
  const bases: { ep: string; n: string; L: string }[] = [];
  const bare = BARE.exec(rest);
  const canon = CANON.exec(rest);
  const compact = COMPACT.exec(rest);
  if (bare) {
    const eps = R.eps.size ? [...(ep ? [ep] : []), ...[...R.eps].sort().filter((e) => e !== ep)] : [''];
    for (const e of eps) bases.push({ ep: e, n: pad3(+bare[1]), L: bare[2].toUpperCase() });
  } else if (canon && R.eps.has(canon[1])) {
    bases.push({ ep: canon[1], n: pad3(+canon[2]), L: canon[3].toUpperCase() });
  } else if (compact) {
    const e = R.epByDigit.get(compact[1]) ?? (ep && String(+ep.slice(1)) === compact[1] ? ep : null);
    if (e) bases.push({ ep: e, n: compact[2], L: compact[3].toUpperCase() });
  }
  for (const { ep: e, n, L } of bases) {
    const base = e ? `${e}_${n}` : n;
    const why = e && e === ep ? 'episode' : 'number';
    if (L && R.scenes.has(base + L)) add(base + L, why);
    else if (R.scenes.has(base)) add(base, why);
    else for (const code of [...R.scenes.keys()].filter((c) => c.startsWith(base) && /^[A-Z]$/.test(c.slice(base.length))).sort()) add(code, why);
  }
  return { scenes, pending };
}

/** Las escenas que coinciden con lo escrito (ver el orden arriba). */
export function searchScenes(
  src: SearchSource,
  query: string,
  options: { ep?: string | null; near?: readonly string[]; limit?: number; loose?: boolean } = {},
): SceneOption[] {
  const R = src.snap.registry;
  const q = query.trim();
  const limit = options.limit ?? 7;
  if (!q || R.scenes.size === 0) return [];
  const ep = options.ep && R.eps.has(options.ep) ? options.ep : null;
  const out: SceneOption[] = exact(R, q, ep).scenes.map((x) => option(src, x.code, x.why));
  if (options.loose === false || out.length >= limit) return out.slice(0, limit);
  const near = new Set(options.near ?? []);
  const rank = (code: string) => (near.has(code) ? 0 : ep && code.startsWith(`${ep}_`) ? 1 : 2);
  const byRank = (a: string, b: string) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
  const taken = new Set(out.map((o) => o.code));
  const all = [...R.scenes.keys()].sort(byRank);
  // 2. Los dígitos, en la forma entera (105027) o compacta (5027).
  const digits = q.replace(/\D/g, '');
  if (digits.length > 0 && /^[\s\d_\-a-z]*$/i.test(q)) {
    for (const code of all) {
      if (taken.has(code)) continue;
      const e = R.scenes.get(code)!;
      const flat = `${e.ep}${e.n}`;
      const short = e.ep ? `${String(+e.ep.slice(1))}${e.n}` : e.n;
      if (flat.includes(digits) || short.includes(digits)) {
        out.push(option(src, code, 'digits'));
        taken.add(code);
      }
    }
  }
  // 3. El título.
  const fq = fold(q);
  if (fq.length >= 2 && /\p{L}/u.test(fq)) {
    for (const code of all) {
      if (taken.has(code)) continue;
      const o = option(src, code, 'title');
      if (o.title && fold(o.title).includes(fq)) {
        out.push(o);
        taken.add(code);
      }
    }
  }
  return out.slice(0, limit);
}

/** Las locaciones: lo que el lector reconoce (palabra entera, alias), después las que empiezan y las que contienen. */
export function searchLocations(src: SearchSource, query: string, options: { limit?: number } = {}): LocationOption[] {
  const R = src.snap.registry;
  const q = query.trim();
  if (!q || R.locations.size === 0) return [];
  const out: LocationOption[] = [];
  const add = (name: string, why: LocationOption['why']) => {
    if (!out.some((o) => o.name === name)) out.push({ name, pageId: visible(src, R.locations.get(name)?.pageId), why });
  };
  // Quien busca en la lupa busca un lugar: los nombres de una palabra («Arenera VA») y los genéricos como parte entera
  // cuentan como en el título de un día (D536, B1 de la auditoría de E10).
  for (const h of scan(R, q, { heading: true, dayTitle: true })) if (h.kind === 'loc') add(h.ref, 'name');
  const fq = fold(q);
  // Desde 3 letras: con «la» o «de» subían media lista de locaciones arriba de las páginas (O5 de la auditoría). Por el
  // principio del nombre, y después por el principio de una de sus palabras («alv» → Hotel Alvear).
  if (fq.length >= 3 && /\p{L}/u.test(fq)) {
    const names = [...R.locations.values()];
    const forms = (l: (typeof names)[number]) => [l.name, ...l.aliases].map(fold);
    for (const l of names) if (forms(l).some((a) => a.startsWith(fq))) add(l.name, 'prefix');
    for (const l of names) if (forms(l).some((a) => a.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(fq)))) add(l.name, 'contains');
  }
  return out.slice(0, options.limit ?? 7);
}

/**
 * Para la lupa ⌘K: las escenas que nombra lo escrito (solo exacto, por el lector: el título de una escena ya sale en
 * las páginas), los números que no existen y alguna página nombra (`named`: los de *Map › Pending*) y las locaciones.
 * Van antes que las páginas.
 */
export function findEntities(
  src: SearchSource,
  query: string,
  options: { ep?: string | null; limit?: number; named?: ReadonlySet<string> } = {},
): EntityHit[] {
  const R = src.snap.registry;
  const q = query.trim();
  if (!q || (R.scenes.size === 0 && R.locations.size === 0)) return [];
  const ep = options.ep && R.eps.has(options.ep) ? options.ep : null;
  const out: EntityHit[] = searchScenes(src, q, { ep, loose: false, limit: 8 }).map((s) => ({
    kind: 'scene',
    ref: s.code,
    pageId: s.pageId,
    title: s.title,
    episode: s.episode,
    why: s.why,
  }));
  for (const code of exact(R, q, ep).pending.filter((c) => options.named?.has(c))) out.push({ kind: 'pending', ref: code, pageId: null, title: '', episode: code.includes('_') ? code.slice(0, 3) : null, why: 'number' });
  for (const l of searchLocations(src, q)) out.push({ kind: 'loc', ref: l.name, pageId: l.pageId, title: '', episode: null, why: l.why });
  return out.slice(0, options.limit ?? 8);
}
