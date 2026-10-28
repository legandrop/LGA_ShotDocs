import { useMemo, useSyncExternalStore } from 'react';
import { useT } from '../i18n';
import { useLinkMode } from '../linkMode';
import { useServices, useTree } from '../services';
import type { PageTree } from '../sync/tree';
import type { PageRow } from '../sync/types';
import { useCurrentProject } from '../ui/project';
import { existingRelationsSession } from '../ui/relationsUi';
import { episodeOf, isEpisodeTitle, kindReader, type KindReader, type KindTree } from './kind';
import type { Registration } from './register';
import type { Registry } from './reader';

// Dónde vive cada página en la barra lateral (Plan_Fichas_Cuaderno.md, parte 1; D813): las fichas (la página de cada
// escena, locación y decorado que el *Overview* lista) viven en el *Overview*, con todo lo de adentro; *Pages* es el
// cuaderno y no las dibuja. *Pages* esconde solo lo que el *Overview* muestra: una escena sin número, la segunda página
// con el mismo número o lo que está fuera de las relaciones siguen en *Pages* donde están, y una carpeta de tipo (o un
// episodio) se esconde solo cuando todo lo de adentro ya está en el *Overview*. No escribe nada: es dónde se dibuja.

/** La parte del *Overview* donde va una ficha. */
export type FichaPart = 'scenes' | 'locations' | 'sets';

export interface Ficha {
  part: FichaPart;
  /** El episodio de una escena (`'105'`, o `''` sin episodio); `null` en las demás partes. */
  ep: string | null;
}

export interface OverviewPlaces {
  /** Las fichas, por página: lo que el *Overview* lista en *Scenes*, *Locations* y *Sets*. */
  fichas: ReadonlyMap<string, Ficha>;
  /** Lo que *Pages* no dibuja: las fichas y las carpetas de tipo o de episodio con todo lo de adentro en el *Overview*. */
  hidden: ReadonlySet<string>;
  /**
   * Las carpetas escondidas de cada parte (la de escenas, la de locaciones…) y de cada episodio (`'105'`): se llega a ellas
   * con el ⋯ de su parte o de su episodio en el *Overview* (*Type*, *Share*, *Leave out of relations*).
   */
  folders: ReadonlyMap<FichaPart, readonly string[]>;
  episodes: ReadonlyMap<string, string>;
}

/** Lo que hace falta de la foto de las relaciones. */
export interface PlacesSnap {
  registry: Pick<Registry, 'scenes' | 'locations'>;
  registration: Pick<Registration, 'sets'>;
}

type PlacesTree = KindTree & Pick<PageTree, 'get' | 'children' | 'isTrashed'>;

/** Las fichas y lo que *Pages* esconde, con el árbol de ahora (la foto puede venir un poco atrasada). */
export function overviewPlaces(snap: PlacesSnap, tree: PlacesTree): OverviewPlaces {
  const fichas = new Map<string, Ficha>();
  const add = (pageId: string | null, ficha: Ficha) => {
    if (!pageId || fichas.has(pageId) || !tree.get(pageId) || tree.isTrashed(pageId)) return;
    fichas.set(pageId, ficha);
  };
  for (const s of snap.registry.scenes.values()) add(s.pageId, { part: 'scenes', ep: s.ep ?? '' });
  for (const l of snap.registry.locations.values()) add(l.pageId, { part: 'locations', ep: null });
  for (const s of snap.registration.sets) add(s.pageId, { part: 'sets', ep: null });

  // Las carpetas que se pueden esconder: la de un tipo de ficha y, adentro de una de escenas, la de un episodio.
  const kinds = kindReader(tree);
  const container = (id: string) => isFichaFolder(tree, id, kinds);
  const up = (id: string): string[] => {
    const ids: string[] = [];
    const seen = new Set<string>([id]);
    for (let p = tree.get(id)?.parent_id; p && !seen.has(p); p = tree.get(p)?.parent_id) {
      seen.add(p);
      ids.push(p);
    }
    return ids;
  };
  // Cada carpeta con su profundidad, para mirarlas de la más honda a la más alta.
  const depth = new Map<string, number>();
  for (const id of fichas.keys()) for (const p of up(id)) if (!depth.has(p) && container(p)) depth.set(p, up(p).length);
  const hidden = new Set<string>(fichas.keys());
  const deepFirst = [...depth].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  for (const id of deepFirst) {
    const kids = tree.children(id);
    if (kids.length > 0 && kids.every((c) => hidden.has(c.id))) hidden.add(id);
  }
  // Cada carpeta escondida se alcanza con el ⋯ de su parte o de su episodio: una por parte y una por episodio. Las que
  // sobran (dos carpetas de escenas, dos grupos `105`, un grupo sin número) quedan en *Pages*, y con ellas las de arriba.
  const PART = { scene: 'scenes', location: 'locations', set: 'sets' } as const;
  const partOf = (id: string): FichaPart | null => {
    const holds = kinds.holdsOf(id);
    return holds === 'scene' || holds === 'location' || holds === 'set' ? PART[holds] : null;
  };
  const epOf = (id: string): string | null =>
    episodeOf(tree.get(id)?.title) ?? tree.children(id).map((c) => fichas.get(c.id)?.ep).find((ep): ep is string => !!ep) ?? null;
  const perPart = new Map<FichaPart, number>();
  const perEp = new Map<string, number>();
  for (const id of deepFirst) {
    if (!hidden.has(id)) continue;
    const part = partOf(id);
    if (part) perPart.set(part, (perPart.get(part) ?? 0) + 1);
    else {
      const ep = epOf(id);
      if (ep !== null) perEp.set(ep, (perEp.get(ep) ?? 0) + 1);
    }
  }
  for (const id of deepFirst) {
    if (!hidden.has(id)) continue;
    const part = partOf(id);
    const ep = part ? null : epOf(id);
    const alone = part ? perPart.get(part) === 1 : ep !== null && perEp.get(ep) === 1;
    // Lo de más abajo ya se miró: una carpeta con algo que se ve adentro tampoco se esconde.
    if (!alone || tree.children(id).some((c) => !hidden.has(c.id))) hidden.delete(id);
  }
  const folders = new Map<FichaPart, string[]>();
  const episodes = new Map<string, string>();
  for (const id of deepFirst) {
    if (!hidden.has(id)) continue;
    const part = partOf(id);
    if (part) folders.set(part, [id]);
    else episodes.set(epOf(id)!, id);
  }
  return { fichas, hidden, folders, episodes };
}

/**
 * La carpeta de un tipo de ficha (escenas, locaciones, decorados) o, adentro de una de escenas, la de un episodio: lo que
 * se crea o se mueve ahí adentro recibe la marca de ese tipo (`placedEntity` en `entitySync.ts`).
 */
export function isFichaFolder(tree: KindTree, id: string, kinds: Pick<KindReader, 'holdsOf'> = kindReader(tree)): boolean {
  const holds = kinds.holdsOf(id);
  if (holds === 'scene' || holds === 'location' || holds === 'set') return true;
  const row = tree.get(id);
  return !!row?.parent_id && kinds.holdsOf(row.parent_id) === 'scene' && isEpisodeTitle(row.title);
}

/**
 * Dónde está en el *Overview* una carpeta escondida (la de una parte o la de un episodio), o `null`: abierta (por la
 * búsqueda, un link) se marca su parte o su episodio.
 */
export function folderPlace(places: OverviewPlaces | null, pageId: string | null): { part: FichaPart; ep: string | null } | null {
  if (!places || !pageId || places.fichas.has(pageId) || !places.hidden.has(pageId)) return null;
  for (const [part, ids] of places.folders) if (ids.includes(pageId)) return { part, ep: null };
  for (const [ep, id] of places.episodes) if (id === pageId) return { part: 'scenes', ep };
  return null;
}

/** La ficha que contiene a la página (ella misma o la más cercana hacia arriba), o `null` si vive en *Pages*. */
export function fichaOf(places: OverviewPlaces | null, tree: Pick<PageTree, 'get'>, pageId: string | null): string | null {
  if (!places || !pageId) return null;
  const seen = new Set<string>();
  for (let p: string | null | undefined = pageId; p && !seen.has(p); p = tree.get(p)?.parent_id) {
    seen.add(p);
    if (places.fichas.has(p)) return p;
  }
  return null;
}

/** Las madres de la página adentro de su ficha (de la ficha hacia abajo, sin la página), o `[]`. */
export function fichaBranch(tree: Pick<PageTree, 'ancestors'>, ficha: string, pageId: string): string[] {
  if (ficha === pageId) return [];
  const ids = tree.ancestors(pageId).map((p) => p.id);
  const at = ids.indexOf(ficha);
  return at < 0 ? [] : ids.slice(at);
}

// Una sola cuenta por foto y por árbol, para la barra y el *Overview*; y si lo que sale es lo mismo que antes, el mismo
// objeto (no se vuelve a dibujar la barra mientras el índice lee y nada cambia de lugar).
const memo = new WeakMap<object, { revision: number; tree: object; places: OverviewPlaces }>();
let last: { key: string; places: OverviewPlaces } | null = null;

function signature(p: OverviewPlaces): string {
  const folders = [...p.folders].map(([part, ids]) => `${part}=${ids.join('+')}`).join(',');
  const eps = [...p.episodes].map(([ep, id]) => `${ep}=${id}`).join(',');
  return [...p.fichas].map(([id, f]) => `${id}:${f.part}:${f.ep ?? ''}`).join(',') + '|' + [...p.hidden].join(',') + '|' + folders + '|' + eps;
}

/** Las de la foto `snap` con el árbol de ahora, contadas una vez. */
export function placesFor(snap: PlacesSnap & object, tree: PlacesTree & Pick<PageTree, 'getRevision'>): OverviewPlaces {
  const revision = tree.getRevision();
  const known = memo.get(snap);
  if (known && known.revision === revision && known.tree === tree) return known.places;
  let places = overviewPlaces(snap, tree);
  const key = signature(places);
  if (last && last.key === key) places = last.places;
  else last = { key, places };
  memo.set(snap, { revision, tree, places });
  return places;
}

const noSubscribe = () => () => undefined;

/**
 * Dónde vive cada página en la barra, o `null` mientras no hay foto de las relaciones (al arrancar *Pages* muestra todo,
 * como antes: si no, las fichas no se verían en ningún lado hasta que llegue) y con un link público (sin *Overview*).
 */
export function useOverviewPlaces(): OverviewPlaces | null {
  const services = useServices();
  const tree = useTree();
  const projectId = useCurrentProject();
  const session = useLinkMode() ? null : existingRelationsSession(services);
  const read = () => {
    const snap = session?.relations.snapshot(projectId) ?? null;
    return snap ? placesFor(snap, tree) : null;
  };
  return useSyncExternalStore(session?.relations.subscribe ?? noSubscribe, read);
}

/** Un paso de la ruta de una página: una página, o el *Overview* (`part: null`) o una de sus partes. */
export type RouteStep = { page: PageRow } | { part: FichaPart | null };

/**
 * La ruta de una página, de lo más lejano a lo más cercano (sin la página): sus madres en *Pages* o, en una ficha,
 * «Overview › Scenes» y sus madres adentro de la ficha (D813). Es lo que dicen el encabezado de la página, las migas de
 * arriba y la búsqueda: una ficha no dice las carpetas de *Pages* donde está guardada.
 */
export function routeOf(tree: Pick<PageTree, 'get' | 'ancestors'>, places: OverviewPlaces | null, pageId: string): RouteStep[] {
  const ficha = fichaOf(places, tree, pageId);
  const info = ficha ? places?.fichas.get(ficha) : undefined;
  if (!ficha || !info) return tree.ancestors(pageId).map((page) => ({ page }));
  const inside = fichaBranch(tree, ficha, pageId)
    .map((id) => tree.get(id))
    .filter((p): p is PageRow => !!p)
    .map((page) => ({ page }));
  return [{ part: null }, { part: info.part }, ...inside];
}

/** Para exportar (D813): dónde vive cada página y cómo se llaman el *Overview* y sus partes en el idioma de la app. */
export interface ExportRoute {
  places: OverviewPlaces | null;
  partLabel: (part: FichaPart | null) => string;
}

export function useExportRoute(): ExportRoute {
  const places = useOverviewPlaces();
  const tr = useT();
  return useMemo(() => ({ places, partLabel: (part: FichaPart | null) => routeLabel({ part }, tr) }), [places, tr]);
}

/**
 * El nombre con que se ve una página donde se elige dónde guardar un ajuste (formato, encabezado): la carpeta escondida
 * de una parte se llama como la parte («Scenes»), porque en *Pages* no está (D813).
 */
export function placeName(places: OverviewPlaces | null, page: { id: string; title: string }, tr: Parameters<typeof routeLabel>[1]): string {
  for (const [part, ids] of places?.folders ?? []) if (ids.includes(page.id)) return routeLabel({ part }, tr);
  return page.title || tr('common.untitled');
}

/** Lo que dice un paso de la ruta: el título de la página o el nombre del *Overview* o de su parte. */
export function routeLabel(step: RouteStep, tr: (key: 'sidebar.map' | 'sidebar.scenes' | 'sidebar.locations' | 'sidebar.sets' | 'common.untitled') => string): string {
  if ('page' in step) return step.page.title || tr('common.untitled');
  return tr(step.part === 'scenes' ? 'sidebar.scenes' : step.part === 'locations' ? 'sidebar.locations' : step.part === 'sets' ? 'sidebar.sets' : 'sidebar.map');
}
