import { useEffect, useRef, useState } from 'react';
import { useT, type Translate } from '../i18n';
import { useLinkMode } from '../linkMode';
import { navigate, pagePath } from '../router';
import { usePermissions, useServices, type Services } from '../services';
import { notify } from '../ui/notice';
import { locationOptions, type LocationOption } from './aliasAction';
import type { Registry } from './reader';

// *Link to a location…* (Docs/Doc_Relaciones.md, sección 17; D539): en la cabecera de un día sin lugar y en *Map › Days*.
// Abre un selector de locaciones (las que se parecen al título del día, primero: la regla solo ordena, D532) y, al elegir,
// escribe el texto del título en «Otros nombres» de esa locación (`addAliasesToPage`: primero en el dispositivo, anda sin
// red si la página ya está bajada). El aviso trae *Open* y *Undo*; deshacer saca solo lo agregado y solo si sigue igual.

type Deps = Pick<Services, 'docs' | 'engine'>;

/** Escribe y avisa (para el botón y las pruebas). */
export async function linkFragment(services: Deps, tr: Translate, loc: { name: string; pageId: string }, fragment: string): Promise<void> {
  // Escribir carga el editor sin pantalla (`aliasWrite.ts`): se baja recién al usarlo, no con la primera carga.
  const { addAliasesToPage, undoAddedAliases } = await import('./aliasWrite');
  let res: Awaited<ReturnType<typeof addAliasesToPage>>;
  try {
    res = await addAliasesToPage(services, loc.pageId, [fragment], tr('linkLoc.label'));
  } catch (err) {
    console.warn('[otros nombres] no se pudo escribir', err);
    notify(tr('linkLoc.failed'));
    return;
  }
  if (res.status === 'missing') return notify(tr('linkLoc.missing', { name: loc.name }));
  if (res.status === 'unknown') return notify(tr('linkLoc.unknown', { name: loc.name }));
  if (res.status !== 'ok') return;
  const open = { label: tr('create.open'), run: () => navigate(pagePath(loc.pageId)) };
  if (!res.added.length || !res.undo) return notify(tr('linkLoc.already', { alias: fragment, name: loc.name }), open);
  const undo = res.undo;
  notify(tr('linkLoc.added', { alias: fragment, name: loc.name }), open, {
    label: tr('create.undo'),
    run: () => {
      void undoAddedAliases(services, loc.pageId, undo)
        .then((out) => notify(tr(out === 'removed' ? 'linkLoc.undone' : 'linkLoc.undoChanged', { alias: fragment, name: loc.name })))
        .catch(() => notify(tr('linkLoc.failed')));
    },
  });
}

/** El selector: el buscador arriba y la lista, con «similar» en las que se parecen al título. */
function LocationPicker({ R, fragment, can, onPick, onClose }: { R: Registry; fragment: string; can: (id: string) => boolean; onPick: (o: LocationOption) => void; onClose: () => void }) {
  const tr = useT();
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.('.rel-linkloc')) return;
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [onClose]);
  const options = locationOptions(R, fragment, q, can);
  return (
    <div className="lh-picker" ref={box} role="dialog" aria-label={tr('linkLoc.button')}>
      <input
        autoFocus
        value={q}
        placeholder={tr('linkLoc.placeholder')}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && options[0]) onPick(options[0]);
        }}
      />
      <div className="lh-picker-list">
        {options.length ? (
          options.map((o) => (
            <button key={o.pageId} onClick={() => onPick(o)}>
              <span className="t">{o.name}</span>
              {o.similar && <span className="k">{tr('linkLoc.similar')}</span>}
            </button>
          ))
        ) : (
          <span className="lh-none">{tr('linkLoc.none')}</span>
        )}
      </div>
    </div>
  );
}

/**
 * El botón «Link to a location…» para el texto de lugar de un título de día que no nombra ninguna locación. Solo si la
 * persona puede editar alguna locación del proyecto; nunca con un link público.
 */
export function LinkLocationButton({ R, fragment, className }: { R: Registry; fragment: string; className?: string }) {
  const tr = useT();
  const link = useLinkMode();
  const services = useServices();
  const perms = usePermissions();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const can = (pageId: string) => perms.canEditPage(pageId);
  if (link || !fragment || ![...R.locations.values()].some((l) => l.pageId && can(l.pageId))) return null;
  return (
    <span className="lh-addwrap">
      <button
        className={`lh-tbtn rel-linkloc ${className ?? ''}`}
        disabled={busy}
        aria-expanded={open}
        data-tip={tr('linkLoc.tip', { fragment })}
        onClick={() => setOpen(!open)}
      >
        {tr('linkLoc.button')}
      </button>
      {open && (
        <LocationPicker
          R={R}
          fragment={fragment}
          can={can}
          onClose={() => setOpen(false)}
          onPick={(o) => {
            setOpen(false);
            setBusy(true);
            void linkFragment(services, tr, o, fragment).finally(() => setBusy(false));
          }}
        />
      )}
    </span>
  );
}
