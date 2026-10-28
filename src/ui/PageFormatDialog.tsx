import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { useTree } from '../services';
import { ownFormat, PAGE_SIZES, pageFormat, sizeLabel, type PageSize } from './pageFormat';

const SIZES: PageSize[] = ['free', ...(Object.keys(PAGE_SIZES) as (keyof typeof PAGE_SIZES)[])];

/** Elegir el tamaño de hoja de una página y de las de adentro (se guarda en la página elegida de la rama). */
export function PageFormatDialog({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const tree = useTree();
  const page = tree.get(pageId);
  const format = pageFormat(tree, pageId);
  // Igual que el encabezado: se puede guardar en esta página o en un contenedor, hasta la página que ya
  // define el formato (más arriba no cambiaría nada acá).
  const chain = [page, ...tree.ancestors(pageId).reverse()].filter((p): p is NonNullable<typeof p> => !!p);
  const branch = format.from ? chain.slice(0, chain.findIndex((p) => p.id === format.from!.id) + 1) : chain;
  const [chosen, setChosen] = useState(format.from?.id ?? pageId);
  const target = branch.some((p) => p.id === chosen) ? chosen : (format.from?.id ?? pageId);
  // Lo que quedaría si esta página deja de definir su tamaño.
  const parentId = page?.parent_id;
  const inheritsFrom = parentId && tree.get(parentId) ? pageFormat(tree, parentId).from : null;
  const tr = useT();
  const titled = (p: { title: string }) => p.title || tr('common.untitled');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = (size: PageSize, landscape: boolean) =>
    void tree.setSetting(target, 'format', size === 'free' ? { size } : { size, landscape });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal format-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={tr('pageMenu.pageSize')}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{tr('pageMenu.pageSize')}</h2>
        <div className="pref">
          <span className="pref-label" id="format-size">
            {tr('pageFormat.size')}
          </span>
          <div className="segmented" role="group" aria-labelledby="format-size">
            {SIZES.map((s) => (
              <button
                key={s}
                autoFocus={format.size === s}
                aria-pressed={format.size === s}
                onClick={() => save(s, format.landscape)}
              >
                {sizeLabel(s, tr)}
              </button>
            ))}
          </div>
        </div>
        {format.size !== 'free' && (
          <div className="pref">
            <span className="pref-label" id="format-orientation">
              {tr('pageFormat.orientation')}
            </span>
            <div className="segmented" role="group" aria-labelledby="format-orientation">
              <button aria-pressed={!format.landscape} onClick={() => save(format.size, false)}>
                {tr('pageFormat.portrait')}
              </button>
              <button aria-pressed={format.landscape} onClick={() => save(format.size, true)}>
                {tr('pageFormat.landscape')}
              </button>
            </div>
          </div>
        )}
        {branch.length > 1 && (
          <div className="pref">
            <label className="pref-label" htmlFor="format-target">
              {tr('pageFormat.saveFor')}
            </label>
            <select id="format-target" value={target} onChange={(e) => setChosen(e.target.value)}>
              {branch.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === pageId ? tr('pageFormat.thisBranch') : tr('pageFormat.branch', { title: titled(p) })}
                </option>
              ))}
            </select>
          </div>
        )}
        <p className="muted">
          {format.from
            ? format.from.id === pageId
              ? tr('pageFormat.setHere')
              : tr('pageFormat.setOn', { title: titled(format.from) })
            : tr('pageFormat.freeHint')}{' '}
          {tr('pageFormat.printHint')}
        </p>
        <div className="modal-actions">
          {ownFormat(tree, pageId) && (
            <button className="link" onClick={() => void tree.setSetting(pageId, 'format', undefined)}>
              {inheritsFrom ? tr('pageFormat.useFrom', { title: titled(inheritsFrom) }) : tr('pageFormat.remove')}
            </button>
          )}
          <button onClick={onClose}>{tr('common.done')}</button>
        </div>
      </div>
    </div>
  );
}
