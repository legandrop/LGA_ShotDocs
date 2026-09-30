import { useEffect, useState } from 'react';
import { useTree } from '../services';
import { ownFormat, PAGE_SIZES, pageFormat, type PageSize } from './pageFormat';

const SIZES: { value: PageSize; label: string }[] = [
  { value: 'free', label: 'Free' },
  ...(Object.keys(PAGE_SIZES) as (keyof typeof PAGE_SIZES)[]).map((k) => ({ value: k, label: PAGE_SIZES[k].label })),
];

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
        aria-label="Page size"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Page size</h2>
        <div className="pref">
          <span className="pref-label" id="format-size">
            Size
          </span>
          <div className="segmented" role="group" aria-labelledby="format-size">
            {SIZES.map((s) => (
              <button
                key={s.value}
                autoFocus={format.size === s.value}
                aria-pressed={format.size === s.value}
                onClick={() => save(s.value, format.landscape)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {format.size !== 'free' && (
          <div className="pref">
            <span className="pref-label" id="format-orientation">
              Orientation
            </span>
            <div className="segmented" role="group" aria-labelledby="format-orientation">
              <button aria-pressed={!format.landscape} onClick={() => save(format.size, false)}>
                Portrait
              </button>
              <button aria-pressed={format.landscape} onClick={() => save(format.size, true)}>
                Landscape
              </button>
            </div>
          </div>
        )}
        {branch.length > 1 && (
          <div className="pref">
            <label className="pref-label" htmlFor="format-target">
              Save for
            </label>
            <select id="format-target" value={target} onChange={(e) => setChosen(e.target.value)}>
              {branch.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === pageId ? 'This page' : `“${p.title || 'Untitled'}”`} and the pages inside
                </option>
              ))}
            </select>
          </div>
        )}
        <p className="muted">
          {format.from
            ? `Set on ${format.from.id === pageId ? 'this page' : `“${format.from.title || 'Untitled'}”`}; pages inside can set their own.`
            : 'Free: the page follows the width of the window.'}{' '}
          Export PDF / Print is in the page menu (free pages print on A4).
        </p>
        <div className="modal-actions">
          {ownFormat(tree, pageId) && (
            <button className="link" onClick={() => void tree.setSetting(pageId, 'format', undefined)}>
              {inheritsFrom ? `Use the size from “${inheritsFrom.title || 'Untitled'}”` : 'Remove (back to Free)'}
            </button>
          )}
          <button onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
