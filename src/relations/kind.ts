import type { PageTree } from '../sync/tree';
import type { PageRow } from '../sync/types';
import { dateAtStart, dayInTitle, dayReportsMark, isDayReportFolder, isReportPage } from '../templates/dayReport';
import { isTemplatePage, isTemplatesFolder } from '../templates/own';

// Qué ES cada página (Docs/Doc_Estructura_Proyecto.md, «Tipo de página»): una escena, una locación, un día de rodaje,
// «parte de» una de esas (las fichas adentro de una escena, el scouting adentro de su locación, el planning adentro de su
// día) o nada. Solo lee el árbol: no escribe nada (lo que escribe las marcas está en `entitySync.ts`).
//
// De dónde sale, en orden:
// 1. La marca de la página (`settings.entity`): la pone la carpeta al crearla o al marcarla, una plantilla (*Scene*,
//    *Location*) o la persona (*Type* en el menú). Llega con la fila: la ve también un invitado que ve la página sin su
//    carpeta. `false` dice «no es nada de eso» y gana sobre la carpeta.
// 2. Sin marca, la carpeta que la contiene (`holdsOf`): todo lo de su primer nivel es de ese tipo. Adentro de una carpeta
//    de escenas, una subcarpeta de episodio (`101`, `EP 101`, `101 | Episode 1`) es un grupo, y lo de adentro del grupo
//    es escena; en una de días, lo que no tiene fecha ni número de día en el título (`Bloque 2`) es un grupo, y lo de
//    adentro es día solo si es un reporte o tiene fecha y número de día (`2026-02-19 | Día 59`). Una subcarpeta marcada
//    con su propio tipo manda adentro suyo.
// 3. Si no, «parte de» la entidad más cercana hacia arriba. Las fichas `ERSO_105_027_010` tienen un número en el título
//    pero están adentro de su escena: son parte de ella, nunca otra escena.
// Nada de lo de la carpeta *Templates* (ni una plantilla marcada en otro lado) es una entidad.
//
// Los días de rodaje usan la carpeta de reportes del día (Docs/Doc_Plantillas.md, 6.2): una carpeta de reportes, marcada
// o deducida por sus reportes, contiene días; y marcar una carpeta como de días la vuelve carpeta de reportes
// (`markFolderHolds` en `entitySync.ts`). Una sola fuente de verdad: `settings.dayReports`.
//
// Un visitante de un link público recibe solo `header` y `format` de los ajustes (`plink_tree`): para él todo es «nada».

export type EntityKind = 'scene' | 'location' | 'day';
export const ENTITY_KINDS: readonly EntityKind[] = ['scene', 'location', 'day'];

/** Lo que es una página. `folder`: la carpeta que le da el tipo (aunque la marca sea de la página), o `null`. */
export type PageKind =
  | { kind: EntityKind; code: string | null; source: 'page' | 'folder'; folder: string | null }
  | { kind: 'part'; of: string; ofKind: EntityKind; code: string | null }
  | { kind: 'none' };

/** Lo que hace falta del árbol (el de la app: `PageTree`). */
export type KindTree = Pick<PageTree, 'get' | 'children' | 'isTrashed'>;

/** La marca de la página leída: `null` sin marca; `'other'` es de una versión más nueva (un tipo que esta no conoce). */
export type EntityMarkRead = { kind: EntityKind; code?: string } | false | 'other' | null;

/** Número canónico de escena: episodio de 3 cifras, guion bajo, escena de 3 cifras y hasta dos letras en mayúscula. */
// En un proyecto sin episodios, la escena sola de 3 cifras con su letra (`074`, `069A`; D383).
export const SCENE_CODE = /^(?:\d{3}_)?\d{3}[A-Z]{0,2}$/;

const isEntityKind = (v: unknown): v is EntityKind => v === 'scene' || v === 'location' || v === 'day';

/** `settings.entity` de la fila, con su forma comprobada (algo de otra versión no se toma por escena). */
export function entityMark(row: PageRow | undefined): EntityMarkRead {
  const value: unknown = row?.settings?.entity;
  if (value === false) return false;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { kind, code } = value as { kind?: unknown; code?: unknown };
  if (!isEntityKind(kind)) return 'other';
  return kind === 'scene' && typeof code === 'string' && SCENE_CODE.test(code) ? { kind, code } : { kind };
}

/** `settings.holds` de la fila: `null` sin marca, `false` «nada» a mano, `'other'` un tipo que esta versión no conoce. */
export function holdsMark(row: PageRow | undefined): EntityKind | false | 'other' | null {
  const value: unknown = row?.settings?.holds;
  if (value === undefined || value === null) return null;
  if (value === false) return false;
  return isEntityKind(value) ? value : 'other';
}

/**
 * Qué contiene la carpeta (lo que se crea adentro es de ese tipo), o `null`. Los días: la carpeta de reportes del día
 * (marcada o deducida por sus reportes, `isDayReportFolder`); `holds: 'day'` cuenta igual salvo que la carpeta se haya
 * dejado de usar para reportes (`dayReports: false`).
 */
export function holdsOf(tree: KindTree, id: string): EntityKind | null {
  const row = tree.get(id);
  if (!row || isTemplatesFolder(row)) return null;
  const reports = dayReportsMark(row);
  if (reports === 'on') return 'day';
  const holds = holdsMark(row);
  if (holds === 'scene' || holds === 'location') return holds;
  if (holds === 'day') return reports === 'off' ? null : 'day';
  if (holds !== null) return null;
  return reports === null && isDayReportFolder(tree as PageTree, id) ? 'day' : null;
}

// --- Títulos -----------------------------------------------------------------------------------------------------------

const EP_WORD = String.raw`(?:ep|episode|episodio|cap[ií]tulo|cap|chapter)\.?(?!\p{L})`;
const EP_BARE = /^\s*(\d{3})\s*$/;
const EP_NAMED = new RegExp(String.raw`^\s*${EP_WORD}\s*(\d{1,3})(?!\d)`, 'iu');
const EP_CODED = new RegExp(String.raw`^\s*(\d{3})\s*[|·:\-–]\s*${EP_WORD}`, 'iu');

/**
 * El título es de una carpeta de episodio: `101`, `EP 101`, `Episodio 5`, `101 | Episode 1`, `105 · Episodio 5`. Un
 * título de escena (`074 | Llegan al…`) no lo es: la segunda parte no nombra un episodio.
 */
export function isEpisodeTitle(title: string): boolean {
  return EP_BARE.test(title) || EP_NAMED.test(title) || EP_CODED.test(title);
}

/** El número de episodio (3 cifras) de un título de carpeta de episodio, o `null` (`Episodio 5` no lo dice entero). */
export function episodeOf(title: string | null | undefined): string | null {
  const text = title ?? '';
  const m = EP_BARE.exec(text) ?? EP_CODED.exec(text) ?? EP_NAMED.exec(text);
  return m && m[1].length === 3 ? m[1] : null;
}

/**
 * Un número completo al principio de la primera parte del título (`101_074 | …`, `101-074 Llegan`, `Escena 101_069A`).
 * Más adelante no cuenta: «Persecución, sigue en 105_076» nombra otra escena (auditoría de E2, B2).
 */
const FULL_AT_START = /^(?:(?:escena|esc|scene|sc)\.?\s*)?(\d{3})[_-](\d{3})([A-Za-z]{0,2})(?![A-Za-z0-9_])/i;
/** La última parte del título es entera un número completo: la forma `074 | título | 101-074`. */
const FULL_EXACT = /^(?:(?:escena|esc|scene|sc)\.?\s*)?(\d{3})[_-](\d{3})([A-Za-z]{0,2})$/i;
/** El pedazo entero es un número corto de escena: `074`, `74`, `069A`, `Escena 74`, `Sc. 074b`. */
const SHORT_CODE = /^(?:(?:escena|esc|scene|sc)\.?\s*)?(\d{1,3})([A-Za-z]{0,2})$/i;
/**
 * Sin episodio (un largo, D383, D391): 3 cifras (`074`, `120A`), o 1–3 con «Escena/Sc» delante (`Escena 74`). Nunca
 * una letra pegada a 1–2 cifras sola: «3D | Tracking» o «4K | Plates» no son escenas.
 */
const FLAT_CODE = /^(?:(?:escena|esc|scene|sc)\.?\s*(\d{1,3})|(\d{3}))([A-Za-z]{0,2})$/i;

/**
 * El número canónico de escena que trae un título (`101_074`, siempre con guion bajo y la letra en mayúscula), o `null`.
 * En orden: un número completo al principio de la primera parte (`101_074 | título`); un número corto que es toda la
 * primera parte, con el episodio de la carpeta (`074 | título` adentro de `101`); una última parte que es entera un
 * número completo (`074 | título | 101-074`, la forma de Doc_Estructura_Proyecto.md). Un número en el medio del texto
 * nombra otra escena y no cuenta. Sin episodio de contexto, al final, un número de 3 cifras es la escena de un proyecto
 * sin episodios (`074`, D383); `flat: false` lo apaga (la carpeta de escenas de una serie: «100 | Notas» no es una
 * escena; auditoría de E1, O9).
 */
export function sceneCode(title: string | null | undefined, episode: string | null = null, flat = true): string | null {
  const parts = (title ?? '').split('|').map((p) => p.trim());
  const code = (m: RegExpExecArray | null) => (m ? `${m[1]}_${m[2]}${m[3].toUpperCase()}` : null);
  const first = code(FULL_AT_START.exec(parts[0]));
  if (first) return first;
  const short = episode ? SHORT_CODE.exec(parts[0]) : null;
  if (short) return `${episode}_${short[1].padStart(3, '0')}${short[2].toUpperCase()}`;
  const last = parts.length > 1 ? code(FULL_EXACT.exec(parts.at(-1)!)) : null;
  if (last) return last;
  // Sin episodio de contexto, al final: la escena de un proyecto sin episodios (`074 | título` → `074`, D383).
  const m = episode || !flat ? null : FLAT_CODE.exec(parts[0]);
  const n = m ? (m[1] ?? m[2]) : null;
  return m && n && +n > 0 ? `${n.padStart(3, '0')}${m[3].toUpperCase()}` : null;
}

/**
 * La página, adentro de una carpeta con tipo, es un grupo y no una entidad: una subcarpeta de episodio (escenas) o una
 * página sin fecha ni número de día en el título (días: `Bloque 2`, `Semana 3`). Una página sin título todavía no es
 * grupo: se está creando.
 */
function shapeGroup(row: PageRow, holds: EntityKind): boolean {
  const title = row.title.trim();
  if (!title) return false;
  if (holds === 'scene') return isEpisodeTitle(title);
  if (holds === 'day') return dateAtStart(title) === null && dayInTitle(title) === null;
  return false;
}

// --- El lector -------------------------------------------------------------------------------------------------------

type Own = { kind: EntityKind; code: string | null; source: 'page' | 'folder'; folder: string | null };
type Context = { holds: EntityKind; folder: string; episode: string | null; series: boolean };

/**
 * Un lector con memoria para una pasada sobre el árbol (el motor de relaciones lee todas las páginas de un proyecto): la
 * memoria vale mientras el árbol no cambie. Para una página suelta, `pageKind`.
 */
export function kindReader(tree: KindTree) {
  const holdsMemo = new Map<string, EntityKind | null>();
  const ownMemo = new Map<string, Own | null>();
  const kindMemo = new Map<string, PageKind>();
  const excludedMemo = new Map<string, boolean>();

  const holds = (id: string): EntityKind | null => {
    if (!holdsMemo.has(id)) holdsMemo.set(id, holdsOf(tree, id));
    return holdsMemo.get(id)!;
  };

  /** La carpeta de escenas es de una serie: tiene alguna carpeta de episodio adentro (auditoría de E1, O9). */
  const seriesMemo = new Map<string, boolean>();
  const series = (folderId: string): boolean => {
    // Un título de solo 3 cifras sin nada adentro todavía no dice que es una serie (puede ser el grupo de un largo).
    const episode = (c: PageRow) => isEpisodeTitle(c.title) && (!EP_BARE.test(c.title) || tree.children(c.id).length > 0);
    if (!seriesMemo.has(folderId)) seriesMemo.set(folderId, tree.children(folderId).some(episode));
    return seriesMemo.get(folderId)!;
  };

  const isGroupedDay = (row: PageRow): boolean =>
    isReportPage(row, tree as PageTree) || (dateAtStart(row.title) !== null && dayInTitle(row.title) !== null);

  const parentOf = (row: PageRow): PageRow | undefined => (row.parent_id ? tree.get(row.parent_id) : undefined);

  /** Una plantilla, o algo adentro de la carpeta *Templates* o de una plantilla. */
  const excluded = (row: PageRow): boolean => {
    const known = excludedMemo.get(row.id);
    if (known !== undefined) return known;
    excludedMemo.set(row.id, false); // un ciclo (no debería haber) corta acá
    const parent = parentOf(row);
    const value = isTemplatesFolder(row) || isTemplatePage(tree, row.id) || (!!parent && excluded(parent));
    excludedMemo.set(row.id, value);
    return value;
  };

  /** La carpeta que le daría el tipo a la página (sin mirar su marca), o `null`. */
  const context = (row: PageRow): Context | null => {
    const parent = parentOf(row);
    if (!parent) return null;
    const direct = holds(parent.id);
    if (direct) {
      // Una subcarpeta con su propio tipo, o un grupo (episodio, bloque), no es una entidad.
      if (holds(row.id) || shapeGroup(row, direct)) return null;
      return { holds: direct, folder: parent.id, episode: direct === 'scene' ? episodeOf(parent.title) : null, series: direct === 'scene' && series(parent.id) };
    }
    const grand = parentOf(parent);
    if (!grand) return null;
    const above = holds(grand.id);
    if (!above || entityMark(parent) !== null || !shapeGroup(parent, above)) return null;
    // Adentro de un grupo: sin grupos dentro de grupos; y un día es un reporte, o tiene fecha Y número de día
    // (`2026-02-19 | Día 59`): «Call sheets › 2026-02-19 | Call sheet» no es un día (auditoría de E2, O2).
    if (holds(row.id) || shapeGroup(row, above)) return null;
    if (above === 'day' && !isGroupedDay(row)) return null;
    return { holds: above, folder: grand.id, episode: above === 'scene' ? (episodeOf(parent.title) ?? episodeOf(grand.title)) : null, series: true };
  };

  /** El código del título de una escena, con el episodio de su carpeta si la ve. */
  const titleCode = (row: PageRow): string | null => {
    const ctx = context(row);
    const parent = parentOf(row);
    return sceneCode(row.title, ctx?.episode ?? episodeOf(parent?.title), !ctx?.series);
  };

  /** Lo que la página es por sí misma (su marca o su carpeta), sin «parte de». */
  const own = (row: PageRow): Own | null => {
    if (ownMemo.has(row.id)) return ownMemo.get(row.id)!;
    ownMemo.set(row.id, null);
    let value: Own | null = null;
    if (!excluded(row)) {
      const mark = entityMark(row);
      if (mark && mark !== 'other') {
        const ctx = context(row);
        const code = mark.kind === 'scene' ? (mark.code ?? titleCode(row)) : null;
        value = { kind: mark.kind, code, source: 'page', folder: ctx && ctx.holds === mark.kind ? ctx.folder : null };
      } else if (mark === null) {
        const ctx = context(row);
        if (ctx) value = { kind: ctx.holds, code: ctx.holds === 'scene' ? sceneCode(row.title, ctx.episode, !ctx.series) : null, source: 'folder', folder: ctx.folder };
      }
    }
    ownMemo.set(row.id, value);
    return value;
  };

  const kindOf = (id: string): PageKind => {
    const known = kindMemo.get(id);
    if (known) return known;
    const row = tree.get(id);
    let value: PageKind = { kind: 'none' };
    if (row) {
      const mine = own(row);
      if (mine) value = { ...mine };
      else if (!excluded(row)) {
        const seen = new Set<string>([row.id]);
        for (let p = parentOf(row); p && !seen.has(p.id); p = parentOf(p)) {
          seen.add(p.id);
          const above = own(p);
          if (above) {
            value = { kind: 'part', of: p.id, ofKind: above.kind, code: above.code };
            break;
          }
        }
      }
    }
    kindMemo.set(id, value);
    return value;
  };

  return {
    /** Lo que es la página. */
    kindOf,
    /** Qué contiene la carpeta, o `null`. */
    holdsOf: holds,
    /** El código de escena que trae el título de la página (con el episodio de su carpeta), o `null`. */
    titleCode: (id: string): string | null => {
      const row = tree.get(id);
      return row ? titleCode(row) : null;
    },
    /** La carpeta que le da el tipo a la página (sin mirar su marca): de qué tipo, cuál y con qué episodio. */
    contextOf: (id: string): Context | null => {
      const row = tree.get(id);
      return row ? context(row) : null;
    },
    /** La página es una plantilla o está adentro de *Templates*: nunca es una entidad. */
    excluded: (id: string): boolean => {
      const row = tree.get(id);
      return !!row && excluded(row);
    },
  };
}

export type KindReader = ReturnType<typeof kindReader>;

/** Lo que es una página (una sola: para muchas, `kindReader`). */
export function pageKind(tree: KindTree, id: string): PageKind {
  return kindReader(tree).kindOf(id);
}
