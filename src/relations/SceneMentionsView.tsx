import { useState, type MouseEvent } from 'react';
import { useT, type Key } from '../i18n';
import '../i18n/lazy/map';
import { mapPath, navigate, pagePath } from '../router';
import type { Place } from './liveView';
import type { SceneGroupId, SceneMentionList, ScenePage } from './sceneMentions';

// La lista de las páginas que hablan de una escena (Docs/Doc_Relaciones.md, sección 21): la usan la vista de una escena
// (`/map/scenes?scene=<código>`, a la que lleva la sección *Scenes* de la barra lateral) y cada fila de *Map › Scenes* al
// desplegar «N pages». Cada página lleva a su página y cada lugar a la sección o al bloque exacto, resaltado. Solo lee.

/** Cuántos lugares de una página se muestran antes de «N more». */
const PLACES_SHOWN = 3;

const GROUP_LABEL: Record<SceneGroupId, Key> = {
  scene: 'map.sceneGroupScene',
  location: 'map.sceneGroupLocation',
  shoot: 'map.sceneGroupShoot',
  other: 'map.sceneGroupOther',
  index: 'map.sceneGroupIndex',
};

function PageRow({ page, onPlace }: { page: ScenePage; onPlace: (place: Place) => void }) {
  const tr = useT();
  const [all, setAll] = useState(false);
  const shown = all ? page.places : page.places.slice(0, PLACES_SHOWN);
  const more = page.places.length - shown.length;
  return (
    <li className="mp-smp">
      <div className="mp-smt">
        <a
          className="mp-link"
          href={pagePath(page.pageId)}
          data-tip={page.label !== page.title ? page.title : undefined}
          onClick={(e: MouseEvent) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            navigate(pagePath(page.pageId));
          }}
        >
          {page.label || tr('common.untitled')}
        </a>
        {page.self && <span className="mp-tag">{tr('map.sceneSelf')}</span>}
        {page.twin && (
          <span className="mp-tag warn" data-tip={tr('map.sceneTwinTip')}>
            {tr('map.sceneTwin')}
          </span>
        )}
        {page.date && page.label !== page.title && !page.title.startsWith(page.date) && <span className="mp-smd mono">{page.date}</span>}
      </div>
      {shown.length > 0 && (
        <ul className="mp-smpl">
          {shown.map((p) => (
            <li key={p.blockId}>
              <button className="mp-plink" onClick={() => onPlace({ pageId: page.pageId, blockId: p.blockId, ...(p.endBlockId !== undefined ? { endBlockId: p.endBlockId } : {}) })}>
                {p.label ? `§ ${p.label}` : p.quote ? `«${p.quote}»` : tr('map.sceneBlock')}
              </button>
              {p.label && p.quote && <span className="mp-q"> — {p.quote}</span>}
              {p.label && p.photos > 0 && <span className="mp-smph"> · {tr('map.photos', { count: p.photos })}</span>}
            </li>
          ))}
          {more > 0 && (
            <li>
              <button className="mp-smmore" onClick={() => setAll(true)}>
                {tr('map.sceneMore', { count: more })}
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

/**
 * Las páginas de una escena, por grupo. `complete`: todo leído (si no, al pie «Reading…» y nunca «ninguna»). `partial`:
 * quien ve una parte del proyecto lee «you can see» (D401).
 */
export function SceneMentionsView({ list, complete, partial, onPlace }: { list: SceneMentionList; complete: boolean; partial: boolean; onPlace: (place: Place) => void }) {
  const tr = useT();
  const main = list.groups.filter((g) => g.id !== 'index');
  const index = list.groups.find((g) => g.id === 'index');
  // Solo la escena misma (o nada): ninguna otra página la nombra todavía. Mientras lee, no se afirma (D402).
  const others = main.reduce((n, g) => n + g.pages.filter((p) => !p.self).length, 0);
  return (
    <div className="mp-sm">
      {list.scenePages > 1 && (
        // La escena está en dos páginas o más: las relaciones usan la primera; se resuelve en Pending (D747).
        <p className="mp-smtwins">
          {tr('map.sceneTwins', { count: list.scenePages })}{' '}
          <a
            className="mp-plink"
            href={mapPath('pending')}
            onClick={(e: MouseEvent) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              navigate(mapPath('pending'));
            }}
          >
            {tr('map.sceneTwinsGo')}
          </a>
        </p>
      )}
      {main.map((g) => (
        <section key={g.id} className="mp-smg">
          <h3 className="mp-smh">
            {tr(GROUP_LABEL[g.id])} <b>{g.pages.length}</b>
          </h3>
          <ul className="mp-sml">
            {g.pages.map((p) => (
              <PageRow key={p.pageId} page={p} onPlace={onPlace} />
            ))}
          </ul>
        </section>
      ))}
      {others === 0 && <p className="mp-smnone">{complete ? tr(partial ? 'map.sceneNoneSeen' : 'map.sceneNone') : tr('live.reading')}</p>}
      {index && (
        // Las páginas índice nombran muchas escenas a la vez (BD Main, un plan general): aparte y cerradas, así no tapan lo útil.
        <details className="mp-smidx">
          <summary data-tip={tr('map.sceneIndexTip')}>
            {tr(GROUP_LABEL.index)} <b>{index.pages.length}</b>
          </summary>
          <ul className="mp-sml">
            {index.pages.map((p) => (
              <PageRow key={p.pageId} page={p} onPlace={onPlace} />
            ))}
          </ul>
        </details>
      )}
      {!complete && others > 0 && (
        <p className="mp-smnone" data-tip={tr('live.readingTip')}>
          {tr('live.reading')}
        </p>
      )}
    </div>
  );
}
