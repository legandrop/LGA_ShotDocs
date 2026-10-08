import { useEffect, useRef } from 'react';
import { useT, type Key } from '../i18n';
import { useTree } from '../services';
import { ArrowLeftIcon, CheckIcon, TypeIcon } from '../ui/icons';
import { markFolderHolds, setPageType } from './entitySync';
import { entityMark, kindReader, type EntityKind } from './kind';

// *Type* en el menú de la página (Docs/Doc_Estructura_Proyecto.md, «Tipo de página»): qué es esta página (escena,
// locación, día de rodaje o nada) y qué es lo que se crea adentro (la carpeta da el tipo). Se abre en el mismo menú, en
// lugar de sus ítems; *Back* vuelve. Solo con permiso para cambiar la fila (`canEditRow`): lo mismo que el título.

const PAGE_LABEL: Record<EntityKind, Key> = { scene: 'type.scene', location: 'type.location', day: 'type.day' };
const HOLDS_LABEL: Record<EntityKind, Key> = { scene: 'type.scenes', location: 'type.locations', day: 'type.days' };

/** El renglón del menú: «Type» y, a la derecha, lo que es la página o lo que guarda la carpeta. */
export function TypeMenuItem({ pageId, onOpen }: { pageId: string; onOpen: () => void }) {
  const tree = useTree();
  const tr = useT();
  const reader = kindReader(tree);
  const kind = reader.kindOf(pageId);
  const holds = reader.holdsOf(pageId);
  const now =
    kind.kind === 'scene' || kind.kind === 'location' || kind.kind === 'day'
      ? tr(PAGE_LABEL[kind.kind])
      : holds
        ? tr(HOLDS_LABEL[holds])
        : kind.kind === 'part'
          ? tr('type.part')
          : '';
  return (
    <button role="menuitem" aria-haspopup="menu" data-tip={tr('type.tip')} onClick={onOpen}>
      <TypeIcon />
      {tr('type.menu')}
      {now && <span className="check">{now}</span>}
    </button>
  );
}

/** Lo que reemplaza a los ítems del menú mientras se elige el tipo. */
export function TypeSubmenu({ pageId, onBack, onClose }: { pageId: string; onBack: () => void; onClose: () => void }) {
  const tree = useTree();
  const tr = useT();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus({ preventScroll: true }), []);
  const reader = kindReader(tree);
  const kind = reader.kindOf(pageId);
  const holds = reader.holdsOf(pageId);
  const mark = entityMark(tree.get(pageId));
  const pageKind = kind.kind === 'scene' || kind.kind === 'location' || kind.kind === 'day' ? kind : null;
  const pick = (run: () => Promise<void>) => {
    onClose();
    void run().catch((err: unknown) => console.warn('[tipo] no se pudo cambiar', err));
  };

  const pageItem = (value: EntityKind | null) => {
    const checked = value === null ? !pageKind && (mark === false || kind.kind !== 'part') : pageKind?.kind === value;
    // La escena muestra su número; lo que da la carpeta sin marca en la página, «by folder».
    const note = !checked ? '' : pageKind?.kind === 'scene' && pageKind.code ? pageKind.code : pageKind?.source === 'folder' ? tr('type.byFolder') : '';
    return (
      <button
        key={value ?? 'none'}
        role="menuitemradio"
        aria-checked={checked}
        onClick={() => pick(() => setPageType(tree, pageId, value))}
      >
        <span className="type-mark">{checked && <CheckIcon size={16} />}</span>
        {tr(value ? PAGE_LABEL[value] : 'type.none')}
        {note && <span className="check">{note}</span>}
      </button>
    );
  };

  const holdsItem = (value: EntityKind | null) => {
    const checked = holds === value;
    return (
      <button
        key={value ?? 'nothing'}
        role="menuitemradio"
        aria-checked={checked}
        data-tip={value ? tr(value === 'scene' ? 'sidebar.holdsScenes' : value === 'location' ? 'sidebar.holdsLocations' : 'sidebar.holdsDays') : undefined}
        onClick={() => pick(() => markFolderHolds(tree, pageId, value))}
      >
        <span className="type-mark">{checked && <CheckIcon size={16} />}</span>
        {tr(value ? HOLDS_LABEL[value] : 'type.nothing')}
      </button>
    );
  };

  return (
    <>
      <button ref={first} role="menuitem" className="type-back" aria-label={tr('type.back')} onClick={onBack}>
        <ArrowLeftIcon />
        {tr('type.menu')}
      </button>
      <hr />
      <p className="menu-label mono-label">{tr('type.thisPage')}</p>
      {(['scene', 'location', 'day', null] as const).map(pageItem)}
      <hr />
      <p className="menu-label mono-label">{tr('type.inside')}</p>
      {(['scene', 'location', 'day', null] as const).map(holdsItem)}
    </>
  );
}
