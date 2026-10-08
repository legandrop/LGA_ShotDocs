import type { PageRow } from '../sync/types';
import { kindReader, type EntityKind, type PageKind } from './kind';
import { fold, sceneCode as canonicalCode, type LocationInput, type SceneInput } from './reader';

// Qué escenas, locaciones y días existen en el proyecto y qué es cada página para las relaciones (Docs/Doc_Relaciones.md,
// sección 4). El tipo de cada página es de `src/relations/kind.ts` (`kindReader(tree).kindOf`: la marca de la página, la
// carpeta con tipo, los grupos de episodio y de días, «parte de»; D368, D369). Esto le suma, por página, a qué escena o
// locación se refiere, su episodio, su etapa y si está fuera de las relaciones: `settings.graph === false` en la página o
// en una carpeta de arriba (D387), o una plantilla.

export type { EntityKind };

/** Lo que `registerProject` necesita del tipo de las páginas: lo que da `kindReader(tree)`. */
export interface KindSource {
  kindOf(id: string): PageKind;
  /** Una plantilla o lo de adentro de *Templates*: nunca es una entidad. */
  excluded(id: string): boolean;
}

export type Stage = 'breakdown' | 'scouting' | 'shoot' | 'location' | 'other';

export interface PageRole {
  /** La página es una entidad: la escena (su código), la locación (su nombre) o el día (su id). */
  entity: { kind: EntityKind; ref: string | null } | null;
  /** La página está adentro de una entidad (la más cercana). */
  partOf: { kind: EntityKind; ref: string | null; pageId: string } | null;
  /** El episodio de su escena (para «Esc 27»). */
  ep: string | null;
  /** Fuera de las relaciones (`graph: false` en ella o en una carpeta de arriba, o una plantilla). */
  excluded: boolean;
  /** De qué etapa son sus menciones: desglose (escenas y lo de adentro), scouting (lo de adentro de una locación), rodaje (días). */
  stage: Stage;
}

export interface Registration {
  scenes: SceneInput[];
  locations: LocationInput[];
  roles: Map<string, PageRole>;
  /** Escenas con el mismo código en dos páginas (gana la primera en el orden de la barra lateral). */
  duplicates: { code: string; pageIds: string[] }[];
}

export interface RegisterTree {
  get(id: string): PageRow | undefined;
  roots(projectId: string): PageRow[];
  children(parentId: string | null): PageRow[];
  isTrashed(id: string): boolean;
}

/**
 * El nombre y los alias de una locación por su título: el título entero y, si lo parten ` / ` o ` | `, cada parte
 * («Aysa / Planta Bernal» → Aysa, Planta Bernal). Lo de adentro de un paréntesis nunca es alias (D416): en ERSO,
 * `Europa (plates)` volvía locación a la palabra «plates» de cualquier reporte y cinco «… (Europa)» compartían «Europa».
 * El nombre sin el paréntesis lo suma `registerProject`, que ve todas las locaciones (`bareLocationName`).
 */
export function locationFromTitle(title: string): { name: string; aliases: string[] } {
  const name = title.trim();
  const aliases = new Set<string>([name]);
  for (const part of name.split(/\s+[|/]\s+/)) if (part.trim() && !/^\d+$/.test(part.trim())) aliases.add(part.trim());
  return { name, aliases: [...aliases].filter((a) => fold(a).trim().length > 0) };
}

/**
 * El nombre sin el paréntesis, si puede ser alias (D416): de dos palabras o más («La Arenera» de `La Arenera (estudio)`,
 * «Bar Berlin» de `Bar Berlin (Claridge)`). Una sola palabra suele ser la ciudad o el sustantivo que el guion usa para la
 * historia («Lübben» de `Lübben (Europa)`: «un auto que viene de Berlín hacia Lübben» es el decorado, no donde se
 * filmó), y no cuenta. Además, `registerProject` lo descarta si lo comparte otra locación.
 */
export function bareLocationName(name: string): string | null {
  const bare = withoutParens(name);
  return bare && bare !== name.trim() && bare.split(' ').length >= 2 ? bare : null;
}

const withoutParens = (name: string): string => name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Suma a cada locación su nombre sin el paréntesis cuando ninguna otra locación lo comparte (como nombre o igual). De
 * dos palabras o más es alias en todos lados (D416); de una sola, solo en el título de un día de rodaje (D417):
 * «2026-03-11 | Día 73 | Inquilinato» es el lugar del día, «…hacia Lübben» en un párrafo no nombra a `Lübben (Europa)`.
 */
function withBareNames(locations: LocationInput[]): LocationInput[] {
  const uses = new Map<string, number>();
  const count = (s: string) => uses.set(fold(s).trim(), (uses.get(fold(s).trim()) ?? 0) + 1);
  for (const l of locations) {
    count(l.name);
    const bare = withoutParens(l.name);
    if (bare && bare !== l.name) count(bare);
  }
  return locations.map((l) => {
    const bare = withoutParens(l.name);
    if (!bare || bare === l.name.trim() || uses.get(fold(bare).trim()) !== 1) return l;
    if (bareLocationName(l.name)) return { ...l, aliases: [...new Set([...(l.aliases ?? [l.name]), bare])] };
    return { ...l, dayTitleAliases: [bare] };
  });
}

const stageOf = (kind: EntityKind | undefined, own: boolean): Stage =>
  kind === 'scene' ? 'breakdown' : kind === 'day' ? 'shoot' : kind === 'location' ? (own ? 'location' : 'scouting') : 'other';

/** Qué es cada página del proyecto que se ve (las de la papelera y lo de adentro no cuentan). */
export function registerProject(tree: RegisterTree, projectId: string, kinds: KindSource = kindReader(tree)): Registration {
  const scenes: SceneInput[] = [];
  const locations: LocationInput[] = [];
  const roles = new Map<string, PageRole>();
  const byCode = new Map<string, string[]>();
  const refOf = (id: string, kind: EntityKind, code: string | null): string | null => {
    if (kind === 'scene') return code ? (canonicalCode(code) ?? code) : null;
    if (kind === 'location') return locationFromTitle(tree.get(id)?.title ?? '').name || null;
    return id;
  };
  const seen = new Set<string>();
  const visit = (page: PageRow, graphOff: boolean) => {
    if (seen.has(page.id) || tree.isTrashed(page.id)) return;
    seen.add(page.id);
    const off = graphOff || page.settings?.graph === false;
    const excluded = off || kinds.excluded(page.id);
    const k = kinds.kindOf(page.id);
    let role: PageRole;
    if (k.kind === 'none') {
      role = { entity: null, partOf: null, ep: null, excluded, stage: 'other' };
    } else if (k.kind === 'part') {
      const ref = refOf(k.of, k.ofKind, k.code);
      role = { entity: null, partOf: { kind: k.ofKind, ref, pageId: k.of }, ep: epOf(k.ofKind === 'scene' ? ref : null), excluded, stage: stageOf(k.ofKind, false) };
    } else {
      const ref = refOf(page.id, k.kind, k.code);
      role = { entity: { kind: k.kind, ref }, partOf: null, ep: epOf(k.kind === 'scene' ? ref : null), excluded, stage: stageOf(k.kind, true) };
      if (!excluded && ref && k.kind === 'scene') {
        const list = byCode.get(ref) ?? [];
        list.push(page.id);
        byCode.set(ref, list);
        if (list.length === 1) scenes.push({ code: ref, pageId: page.id });
      }
      if (!excluded && ref && k.kind === 'location' && !locations.some((x) => x.name === ref)) {
        locations.push({ ...locationFromTitle(page.title ?? ''), pageId: page.id });
      }
    }
    roles.set(page.id, role);
    for (const child of tree.children(page.id)) visit(child, off);
  };
  for (const root of tree.roots(projectId)) visit(root, false);
  const duplicates = [...byCode].filter(([, ids]) => ids.length > 1).map(([code, pageIds]) => ({ code, pageIds }));
  return { scenes, locations: withBareNames(locations), roles, duplicates };
}

const epOf = (code: string | null): string | null => (code && /^\d{3}_/.test(code) ? code.slice(0, 3) : null);
