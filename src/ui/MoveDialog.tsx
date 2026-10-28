import { useEffect, useMemo, useState } from 'react';
import { locale, useT } from '../i18n';
import { isEpisodeTitle, kindReader } from '../relations/kind';
import { notify } from './notice';
import { isFichaFolder, routeLabel, useOverviewPlaces, type FichaPart } from '../relations/overviewPlaces';
import { usePermissions, useTree } from '../services';
import type { PageRow } from '../sync/types';

/** El orden de las partes del *Overview* en la lista de destinos. */
const PART_ORDER: readonly FichaPart[] = ['scenes', 'locations', 'sets'];

export function MoveDialog({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const tree = useTree();
  const perms = usePermissions();
  const places = useOverviewPlaces();
  const [filter, setFilter] = useState('');
  const page = tree.get(pageId);
  const tr = useT();

  // Los destinos en dos grupos, como en la barra (D813): *Pages* y, en el *Overview*, las fichas con lo de adentro
  // (meter una página adentro de una la vuelve parte de ella). La carpeta de un tipo o un episodio, solo para una página
  // de ese tipo (cambiar una escena de episodio): una nota que entra ahí recibe la marca del tipo y, sin número ni
  // nombre, quedaría como una escena rota. Nunca lo que está adentro de la página que se mueve.
  const options = useMemo(() => {
    // `head`: el rótulo del grupo de cada destino del *Overview* («Overview › Scenes › Episode 101»), para que dos
    // escenas 008 de distintos episodios no se confundan.
    const out: { page: PageRow; depth: number; group: 'pages' | 'overview'; head?: string }[] = [];
    const kinds = kindReader(tree);
    const hidden = places?.hidden;
    const PART = { scene: 'scenes', location: 'locations', set: 'sets' } as const;
    const kindNow = kinds.kindOf(pageId).kind;
    // Una página suelta cuyo título ya es una escena («002 | Persecución»): la carpeta de escenas también es su destino,
    // porque ahí entra como la escena que su título dice (lo encontró la simulación de D813: no había cómo meterla).
    const mine: FichaPart | null =
      kindNow === 'scene' || kindNow === 'location' || kindNow === 'set' ? PART[kindNow] : kindNow === 'none' && kinds.titleCode(pageId) ? 'scenes' : null;
    /** La parte de una carpeta de tipo o de un episodio (`null` si no es una). */
    const folderPart = (id: string): FichaPart | null => {
      const holds = kinds.holdsOf(id);
      if (holds === 'scene' || holds === 'location' || holds === 'set') return PART[holds];
      const row = tree.get(id);
      return row?.parent_id && kinds.holdsOf(row.parent_id) === 'scene' && isEpisodeTitle(row.title) ? 'scenes' : null;
    };
    // Una página suelta con un número sin episodio («074 | …») en una serie: solo los episodios. En la carpeta de escenas
    // quedaría como una escena sin número (auditoría de v0.305).
    const looseCode = kindNow === 'none' ? kinds.titleCode(pageId) : null;
    const onlyEpisodes = !!looseCode && !looseCode.includes('_') && !!places && places.episodes.size > 0;
    const target = (id: string) =>
      !isFichaFolder(tree, id, kinds) || (!!mine && folderPart(id) === mine && !(onlyEpisodes && kinds.holdsOf(id) === 'scene'));
    const kids = (id: string) => tree.children(id).filter((p) => !hidden?.has(p.id));
    const walk = (list: PageRow[], depth: number, group: 'pages' | 'overview', head?: string) => {
      for (const p of list) {
        if (p.id === pageId || tree.isDescendant(p.id, pageId)) continue;
        if (target(p.id)) out.push({ page: p, depth, group, head });
        walk(kids(p.id), depth + 1, group, head);
      }
    };
    if (page) walk(tree.roots(page.workspace_id).filter((p) => !hidden?.has(p.id)), 0, 'pages');
    if (places) {
      const by = (a: string, b: string) => a.localeCompare(b, locale(), { numeric: true });
      const label = (part: FichaPart, ep?: string | null) =>
        [routeLabel({ part: null }, tr), routeLabel({ part }, tr), ...(ep ? [tr('live.episode', { ep })] : [])].join(' › ');
      // La carpeta escondida de su tipo (y los episodios), para una escena, locación o decorado.
      if (mine) {
        const folders = [...(onlyEpisodes ? [] : (places.folders.get(mine) ?? [])), ...(mine === 'scenes' ? [...places.episodes.values()] : [])];
        for (const id of folders) {
          const row = tree.get(id);
          if (row && id !== pageId && !tree.isDescendant(id, pageId)) out.push({ page: row, depth: 0, group: 'overview', head: label(mine) });
        }
      }
      const fichas = [...places.fichas]
        .map(([id, f]) => ({ row: tree.get(id), ...f }))
        .filter((f): f is { row: PageRow } & typeof f => !!f.row && f.row.workspace_id === page?.workspace_id)
        .sort((a, b) => PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(b.part) || by(a.ep ?? '', b.ep ?? '') || by(a.row.title, b.row.title));
      for (const f of fichas) walk([f.row], 0, 'overview', label(f.part, f.ep));
    }
    return out;
  }, [tree, pageId, page, places, tr]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const needle = filter.trim().toLowerCase();
  // Mover pide "Edit & create pages" en la página y en el destino: los demás destinos no se ofrecen.
  const allowed = options.filter((o) => perms.canMove(pageId, o.page.id));
  const visible = needle ? allowed.filter((o) => o.page.title.toLowerCase().includes(needle)) : allowed;
  // El rótulo de cada grupo, solo si hay fichas (sin relaciones, la lista de siempre).
  const groups = !!places && visible.some((o) => o.group === 'overview');

  const moveTo = async (parentId: string | null) => {
    try {
      await tree.move(pageId, parentId);
    } catch (err) {
      // El árbol lo rechaza (adentro de sí misma, otro proyecto): se dice y el diálogo queda.
      console.warn('[mover] no se pudo mover', pageId, parentId, err);
      notify(err instanceof Error ? err.message : String(err));
      return;
    }
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={tr('move.label')} onClick={(e) => e.stopPropagation()}>
        <h2>{tr('move.title', { title: page?.title || tr('common.untitled') })}</h2>
        <input autoFocus placeholder={tr('move.search')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <ul className="move-list">
          {groups && visible[0]?.group === 'pages' && <li className="move-group">{tr('sidebar.pages')}</li>}
          {!needle && page?.parent_id && perms.canMove(pageId, null) && (
            <li>
              <button onClick={() => void moveTo(null)}>{tr('move.top')}</button>
            </li>
          )}
          {visible.map(({ page: p, depth, head }, i) => (
            <li key={p.id}>
              {groups && head && visible[i - 1]?.head !== head && <div className="move-group">{head}</div>}
              <button
                style={{ paddingLeft: 10 + (needle ? 0 : depth * 14) }}
                disabled={p.id === page?.parent_id}
                onClick={() => void moveTo(p.id)}
              >
                {p.title || tr('common.untitled')}
              </button>
            </li>
          ))}
          {visible.length === 0 && <li className="muted">{tr('move.noMatch')}</li>}
        </ul>
        <div className="modal-actions">
          <button onClick={onClose}>{tr('common.cancel')}</button>
        </div>
      </div>
    </div>
  );
}
