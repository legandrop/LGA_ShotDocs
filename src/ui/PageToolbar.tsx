import type { Dictionary } from '@blocknote/core';
import {
  blockTypeSelectItems,
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useEditorState,
  usePortalElement,
  type BlockTypeSelectItem,
} from '@blocknote/react';
import { NodeSelection } from '@tiptap/pm/state';
import { useMemo, type JSX, type ReactNode } from 'react';
import { useT, type Translate } from '../i18n';
import '../i18n/lazy/editor';
import { selectWholeBlock } from './blockHandle';
import { headingItems } from './collapseMenus';
import { CommentToolbarButton, paragraphVariantItems } from './EditorComments';
import { SCRIPT_PROP } from './editorSchema';
import { ScriptIcon } from './icons';
import { ImageBlockBar, useChosenImageBlock } from './MediaBar';

const FILE_ITEMS = new Set(['fileCaptionButton', 'replaceFileButton', 'fileRenameButton', 'fileDeleteButton', 'fileDownloadButton', 'filePreviewButton']);
import { onlyPhotosSelected, selectedPhotos } from './inlinePhotoSize';
import { PhotoSizeButtons } from './PhotoToolbar';

// La barra de formato de la página (PageEditor.tsx). Aparece al elegir texto y también al hacer clic en los
// puntos de un bloque (BlockSideMenu.tsx, el bloque entero elegido): ahí trae además los colores del bloque (los
// que antes estaban en el menú del tirador, así se pueden sacar con "Default") y no trae "Link" (BlockNote pondría
// el link sobre otra parte del texto: toma el principio de la selección y el largo del texto).

type AnyEditor = ReturnType<typeof useBlockNoteEditor>;

// Script es un párrafo con `script: true` (ver editorSchema.ts), y una pregunta, uno con `question: true`
// (EditorComments.tsx). Cada ítem del selector pide las dos propiedades, así el selector distingue uno de
// otro y volver a párrafo saca la marca. El nombre ("Script", en castellano "Guion") es solo la etiqueta.
export function scriptTypeItem(tr: Translate): BlockTypeSelectItem {
  return {
    name: tr('editor.script'),
    type: 'paragraph',
    props: { [SCRIPT_PROP]: true },
    icon: ScriptIcon as unknown as BlockTypeSelectItem['icon'],
  };
}

/** Los tipos de bloque del selector de la barra ("Turn into"). */
export function pageToolbarItems(dictionary: Dictionary, tr: Translate): BlockTypeSelectItem[] {
  return paragraphVariantItems(headingItems(blockTypeSelectItems(dictionary)), scriptTypeItem(tr), tr);
}

/** El bloque elegido entero (los puntos), o nada. */
function chosenBlockId(editor: AnyEditor): string | null {
  const sel = editor.prosemirrorState.selection;
  if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'blockContainer') return null;
  return String(sel.node.attrs.id ?? '') || null;
}

/** Lo de adentro no se muestra con el bloque entero elegido. */
function HideOnBlockSelection({ children }: { children: ReactNode }) {
  const editor = useBlockNoteEditor();
  const chosen = useEditorState({ editor, selector: ({ editor: e }) => chosenBlockId(e as AnyEditor) !== null });
  return chosen ? null : <>{children}</>;
}

const COLORS = ['default', 'gray', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as const;

function ColorSwatch({ text, background, size }: { text?: string; background?: string; size: number }) {
  return (
    <div
      className="bn-color-icon"
      data-text-color={text || 'default'}
      data-background-color={background || 'default'}
      style={{ pointerEvents: 'none', fontSize: `${size * 0.75}px`, height: size, lineHeight: `${size}px`, textAlign: 'center', width: size }}
    >
      A
    </div>
  );
}

interface BlockColors {
  id: string;
  textColor?: string;
  backgroundColor?: string;
}

/**
 * Los colores del bloque entero (sus propiedades `textColor` y `backgroundColor`, no las del texto), con el bloque
 * elegido con los puntos. Lo que hacía "Colors" del menú del tirador de BlockNote (`BlockColorsItem`).
 */
export function BlockColorButton() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const dict = useDictionary();
  const portal = usePortalElement();
  const tr = useT();
  const colors = useEditorState({
    editor,
    selector: ({ editor: e }): BlockColors | undefined => {
      const id = chosenBlockId(e as AnyEditor);
      if (!id || !e.isEditable) return undefined;
      const block = e.getBlock(id);
      if (!block) return undefined;
      const props = block.props as Record<string, unknown>;
      const hasText = 'textColor' in props;
      const hasBackground = 'backgroundColor' in props;
      if (!hasText && !hasBackground) return undefined;
      return {
        id,
        textColor: hasText ? String(props.textColor || 'default') : undefined,
        backgroundColor: hasBackground ? String(props.backgroundColor || 'default') : undefined,
      };
    },
  });
  if (!colors) return null;
  const set = (prop: 'textColor' | 'backgroundColor', color: string) => {
    editor.updateBlock(colors.id, { props: { [prop]: color } } as never);
    // Sigue elegido el bloque (y la barra abierta) para cambiar el otro color o seguir.
    const view = editor.prosemirrorView;
    if (view) selectWholeBlock(view, colors.id);
  };
  const list = (prop: 'textColor' | 'backgroundColor', current: string, title: string) => (
    <>
      <Components.Generic.Menu.Label>{title}</Components.Generic.Menu.Label>
      {COLORS.map((c) => (
        <Components.Generic.Menu.Item
          key={`${prop}-${c}`}
          data-test={`block-${prop === 'textColor' ? 'text' : 'background'}-color-${c}`}
          onClick={() => set(prop, c)}
          icon={prop === 'textColor' ? <ColorSwatch text={c} size={16} /> : <ColorSwatch background={c} size={16} />}
          checked={current === c}
        >
          {dict.color_picker.colors[c]}
        </Components.Generic.Menu.Item>
      ))}
    </>
  );
  return (
    <Components.Generic.Menu.Root portalElement={portal}>
      <Components.Generic.Menu.Trigger>
        <Components.FormattingToolbar.Button
          className="bn-button sd-block-colors"
          data-test="blockColors"
          label={tr('block.colors')}
          mainTooltip={tr('block.colors')}
          icon={<ColorSwatch text={colors.textColor} background={colors.backgroundColor} size={20} />}
        />
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown className="bn-menu-dropdown bn-color-picker-dropdown">
        {colors.textColor !== undefined && list('textColor', colors.textColor, dict.color_picker.text_title)}
        {colors.backgroundColor !== undefined && list('backgroundColor', colors.backgroundColor, dict.color_picker.background_title)}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}

/**
 * Con una foto en línea elegida, o solo fotos elegidas, la barra es la propia de la foto (PhotoToolbar.tsx): esta no
 * se muestra. Con texto y fotos elegidos, suma los tamaños y "Arrange in rows" de las fotos.
 */
function usePhotoSelection(): 'only' | 'mixed' | null {
  const editor = useBlockNoteEditor();
  return useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const state = (e as AnyEditor).prosemirrorState;
      if (onlyPhotosSelected(state)) return 'only';
      return selectedPhotos(state).length > 0 ? 'mixed' : null;
    },
  });
}

/**
 * El controlador de BlockNote para la barra de formato, que no se abre con una foto en línea elegida o solo fotos
 * elegidas (ahí va la barra propia, PhotoToolbar.tsx). No alcanza con no dibujar su contenido: su contenedor
 * flotante igual aparece un instante al soltar el clic (arriba a la izquierda, antes de ubicarse) y se queda con el
 * clic en otra foto (medido en Chromium: el clic en la foto vecina no la elegía).
 */
export function PageFormattingToolbarController({ formattingToolbar }: { formattingToolbar: () => JSX.Element }) {
  const photos = usePhotoSelection();
  const closed = useMemo(() => ({ useFloatingOptions: { open: false } }), []);
  return <FormattingToolbarController formattingToolbar={formattingToolbar} floatingUIOptions={photos === 'only' ? closed : undefined} />;
}

/** La barra de formato de la página. Con una foto-bloque elegida, la barra de la foto (MediaBar.tsx, D-24). */
export function PageFormattingToolbar({ items, canComment }: { items: BlockTypeSelectItem[]; canComment: boolean }) {
  const photos = usePhotoSelection();
  const imageBlock = useChosenImageBlock();
  if (photos === 'only') return null;
  if (imageBlock) return <ImageBlockBar />;
  return (
    <FormattingToolbar blockTypeSelectItems={items}>
      {getFormattingToolbarItems(items).flatMap((item) =>
        // Los botones de archivo (leyenda, reemplazar, renombrar, borrar, bajar, vista previa) son de la barra de la
        // foto; acá no van (D-24: sin leyenda).
        FILE_ITEMS.has(String(item.key))
          ? []
          : item.key === 'createLinkButton'
              ? [<HideOnBlockSelection key="createLinkButton">{item}</HideOnBlockSelection>]
              : item.key === 'colorStyleButton'
                ? [item, <BlockColorButton key="blockColorButton" />]
                : [item],
      )}
      {photos === 'mixed' && <PhotoSizeButtons key="photoSizeButtons" />}
      {canComment && <CommentToolbarButton key="comment" />}
    </FormattingToolbar>
  );
}
