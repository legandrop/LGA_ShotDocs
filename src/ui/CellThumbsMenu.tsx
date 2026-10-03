import { useBlockNoteEditor, useComponentsContext, useEditorState, usePortalElement } from '@blocknote/react';
import { NodeSelection } from '@tiptap/pm/state';
import { useT } from '../i18n';
import '../i18n/lazy/editor';
import { BarButton } from './BarButton';
import { setThumbHeight, tableHasPhotos, THUMB_HEIGHT_PROP, THUMB_HEIGHTS, thumbHeightOf, type ThumbHeight } from './cellThumbs';

// El alto de las miniaturas de una tabla (Docs/Doc_Fotos_En_Linea.md, "Alto de las miniaturas (D27 → B)"): *Thumbnail
// size* con *Small*, *Medium* y *Large* (64, 96 y 160 px), en la barra de una foto de una celda (PhotoToolbar.tsx) y en la
// barra de la tabla elegida entera con sus puntos (PageToolbar.tsx). Vale para todas las miniaturas de esa tabla.

const SIZE_KEYS: Record<ThumbHeight, 'cellThumbs.small' | 'cellThumbs.medium' | 'cellThumbs.large'> = {
  64: 'cellThumbs.small',
  96: 'cellThumbs.medium',
  160: 'cellThumbs.large',
};

/** Dos miniaturas de distinto alto entre las líneas de una fila. */
function ThumbSizeIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" aria-hidden="true">
      <path d="M2 3h16M2 17h16" />
      <path d="M3.5 10.5h4.5v4H3.5z" />
      <path d="M10.5 5.5h6v9h-6z" />
    </svg>
  );
}

interface ThumbHeightMenuProps {
  /** Las posiciones de las tablas (el nodo `table`). */
  tables: readonly number[];
  /** El alto que tienen todas, o `null` si no es el mismo. */
  current: ThumbHeight | null;
}

/** *Thumbnail size*: el botón de la barra y su menú con los tres altos, el actual marcado. */
export function ThumbHeightMenu({ tables, current }: ThumbHeightMenuProps) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const portal = usePortalElement();
  const tr = useT();
  const view = editor.prosemirrorView;
  if (!view || tables.length === 0) return null;
  const label = tr('cellThumbs.size');
  return (
    <Components.Generic.Menu.Root portalElement={portal}>
      <Components.Generic.Menu.Trigger>
        <BarButton test="cellThumbs-size" label={label} tip={`${label}\n${tr(tables.length > 1 ? 'cellThumbs.tipAll' : 'cellThumbs.tip')}`} icon={<ThumbSizeIcon />} />
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown className="bn-menu-dropdown sd-thumb-size-menu">
        <Components.Generic.Menu.Label>{label}</Components.Generic.Menu.Label>
        {THUMB_HEIGHTS.map((h) => (
          <Components.Generic.Menu.Item
            key={h}
            data-test={`cellThumbs-${h}`}
            checked={current === h}
            onClick={() => {
              // Cambia solo el atributo de la tabla: la selección (la foto o la tabla elegida) queda como estaba.
              setThumbHeight(view, tables, h);
              view.focus();
            }}
          >
            {tr(SIZE_KEYS[h])}
          </Components.Generic.Menu.Item>
        ))}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}

/**
 * Con una tabla con fotos elegida entera (sus puntos), *Thumbnail size* en la barra de formato. `pos:alto` de la tabla
 * (un texto, así la barra no se vuelve a dibujar en cada cambio), o `null`.
 */
function chosenTable(state: { selection: unknown }): string | null {
  const sel = state.selection;
  if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'blockContainer') return null;
  const content = sel.node.firstChild;
  if (content?.type.name !== 'table' || !tableHasPhotos(content)) return null;
  return `${sel.from + 1}:${thumbHeightOf(content.attrs[THUMB_HEIGHT_PROP])}`;
}

export function TableThumbsButton() {
  const editor = useBlockNoteEditor();
  const chosen = useEditorState({
    editor,
    selector: ({ editor: e }) => (e.isEditable ? chosenTable(e.prosemirrorState) : null),
  });
  if (!chosen) return null;
  const [pos, h] = chosen.split(':').map(Number);
  return <ThumbHeightMenu tables={[pos]} current={thumbHeightOf(h)} />;
}
