import { ScreenReaderOnlySubmit, useBlockNoteEditor, useComponentsContext, useEditorState, usePortalElement } from '@blocknote/react';
import { BarButton, BarSep } from './BarButton';
import { createContext, useCallback, useContext, useState, type ChangeEvent, type ReactNode } from 'react';
import { t, useT } from '../i18n';
import '../i18n/lazy/editor';
import { mediaIdOf } from '../media/queue';
import { useServices } from '../services';
import { isAttachment } from './attachments';
import { carreteSourceOf } from './carreteModel';
import { isOffline, startDownload } from './carreteLoader';
import { COMMENT_SHORTCUT_LABEL, commentOnBlock } from './commentsUi';
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon, CommentIcon, DownloadIcon, RenameIcon, ReplaceIcon, TrashIcon } from './icons';
import { ImageSizeButtons, OriginalDownloadButton, ViewIcon } from './MediaToolbarButtons';
import { notify } from './notice';

// La barra de una foto (Docs/Decisiones D-24): la misma para la foto-bloque y para la foto en línea, por sectores con
// un separador entre ellos:
//   [ver, bajar] | [tamaños 1/1 1/2 1/3 1/4 y "Arrange in rows"] | [alinear] | [comentar] | [reemplazar, renombrar, borrar]
// Sin "Edit caption" (D-24: una leyenda que ya existe se sigue viendo; no hay botón para crearla) ni "Toggle preview".
// Todos los botones miden lo mismo (styles.css, `.sd-bar-button`). Los tooltips son `data-tip` (Tooltip.tsx): el
// nombre del botón (un ícono no lo dice) y, si lo hay, el atajo o lo que agrega.

type AnyEditor = ReturnType<typeof useBlockNoteEditor>;

/** Lo que la barra necesita de la página (PageEditor.tsx): guardar un archivo, qué acepta, abrir el carrete. */
export interface MediaActions {
  /** Guarda un archivo (con su aviso si falla) y da su dirección. */
  store: (file: File) => Promise<string>;
  /** Qué ofrece el selector al reemplazar una foto en línea (fotos y videos) o una foto-bloque (con portero, cualquier archivo). */
  accept: { inline: string; block: string };
  canComment: boolean;
  /** Abre el carrete en esa foto (la clave: el id del bloque o `<bloque>#<n>`). */
  onView: (key: string) => void;
}

export const MediaActionsContext = createContext<MediaActions | null>(null);

export const useMediaActions = () => useContext(MediaActionsContext);

/** Junta los sectores que tienen algo, con un separador entre cada dos. */
export function Sectors({ children }: { children: (ReactNode | null | false)[] }) {
  const parts = children.filter((c): c is ReactNode => !!c);
  return (
    <>
      {parts.map((part, i) => (
        <span className="sd-bar-sector" key={i}>
          {i > 0 && <BarSep />}
          {part}
        </span>
      ))}
    </>
  );
}

// --- Botones -----------------------------------------------------------------------------------------------

export function ViewButton({ url, label, onView }: { url: string | null; label?: string; onView: () => void }) {
  const tr = useT();
  if (!url || !carreteSourceOf(url)) return null;
  const name = label ?? tr('mediaButton.view');
  return <BarButton label={name} tip={`**${name}**\n${tr('mediaButton.space')}`} icon={<ViewIcon />} test="mediaView" onClick={onView} />;
}

/**
 * Bajar: una foto del Drive, su original (OriginalDownloadButton); otra (`sdfile://`, `https`), lo que resuelve el
 * editor, con su nombre.
 */
export function DownloadButton({ url, name }: { url: string | null; name: string }) {
  const editor = useBlockNoteEditor();
  const tr = useT();
  const id = mediaIdOf(url);
  if (!url) return null;
  if (id) return <OriginalDownloadButton key={id} fileId={id} />;
  const label = tr('mediaButton.download');
  const download = () => {
    const resolve = (editor as unknown as { resolveFileUrl?: (u: string) => Promise<string> }).resolveFileUrl;
    (resolve ? resolve(url) : Promise.resolve(url)).then(
      (href) => startDownload({ url: href, local: href.startsWith('blob:') || href.startsWith('data:') }, name || 'image'),
      (err: unknown) => notify(isOffline(err) ? t('mediaButton.offline') : t('mediaButton.failed')),
    );
  };
  return <BarButton label={label} icon={<DownloadIcon size={18} />} test="mediaDownload" onClick={download} />;
}

export type Alignment = 'left' | 'center' | 'right';

export function AlignButtons({ current, onAlign }: { current: Alignment | null; onAlign: (a: Alignment) => void }) {
  const tr = useT();
  const items: [Alignment, string, ReactNode][] = [
    ['left', tr('photoBar.alignLeft'), <AlignLeftIcon key="l" />],
    ['center', tr('photoBar.alignCenter'), <AlignCenterIcon key="c" />],
    ['right', tr('photoBar.alignRight'), <AlignRightIcon key="r" />],
  ];
  return (
    <>
      {items.map(([a, label, ic]) => (
        <BarButton key={a} label={label} icon={ic} selected={current === a} test={`align-${a}`} onClick={() => onAlign(a)} />
      ))}
    </>
  );
}

export function CommentButton({ blockId }: { blockId: string | null }) {
  const tr = useT();
  const label = tr('comments.comment');
  return <BarButton label={label} tip={`**${label}**\n${COMMENT_SHORTCUT_LABEL}`} icon={<CommentIcon size={18} />} test="mediaComment" onClick={() => commentOnBlock(blockId)} />;
}

/** Reemplazar: el selector de archivos del sistema (uno); lo elegido se guarda y pasa a ser la foto. */
export function ReplaceButton({ accept, onFile }: { accept: string; onFile: (file: File) => void }) {
  const tr = useT();
  const pick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    const done = () => input.remove();
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      done();
      if (file) onFile(file);
    });
    input.addEventListener('cancel', done);
    document.body.append(input);
    input.click();
  };
  return <BarButton label={tr('photoBar.replace')} icon={<ReplaceIcon />} test="mediaReplace" onClick={pick} />;
}

/** Renombrar: un campo en un globo, como el de BlockNote; cada letra cambia el nombre. */
export function RenameButton({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const portal = usePortalElement();
  const tr = useT();
  const [open, setOpenState] = useState(false);
  const setOpen = useCallback(
    (next: boolean) => {
      if (!next) editor.focus();
      setOpenState(next);
    },
    [editor],
  );
  const label = tr('photoBar.rename');
  return (
    <Components.Generic.Popover.Root open={open} onOpenChange={setOpen} portalElement={portal}>
      <Components.Generic.Popover.Trigger>
        <BarButton label={label} icon={<RenameIcon />} test="mediaRename" onClick={() => setOpen(!open)} />
      </Components.Generic.Popover.Trigger>
      <Components.Generic.Popover.Content className="bn-popover-content bn-form-popover" variant="form-popover">
        <Components.Generic.Form.Root onSubmit={() => setOpen(false)} submitButton={<ScreenReaderOnlySubmit />}>
          <Components.Generic.Form.TextInput
            name="file-name"
            icon={<RenameIcon />}
            value={name}
            autoFocus
            placeholder={tr('photoBar.renamePlaceholder')}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onRename(e.currentTarget.value)}
          />
        </Components.Generic.Form.Root>
      </Components.Generic.Popover.Content>
    </Components.Generic.Popover.Root>
  );
}

export function DeleteButton({ many, onDelete }: { many: boolean; onDelete: () => void }) {
  const tr = useT();
  const label = many ? tr('photoBar.deleteMany') : tr('photoBar.delete');
  return <BarButton label={label} tip={`**${label}**\n${tr('photoBar.deleteKeys')}`} icon={<TrashIcon />} test="mediaDelete" onClick={onDelete} />;
}

// --- La barra de la foto-bloque ---------------------------------------------------------------------------

interface ChosenBlock {
  id: string;
  url: string;
  name: string;
  align: Alignment;
}

/** El bloque `image` elegido (uno solo), o `undefined`. */
export function useChosenImageBlock(): ChosenBlock | undefined {
  const editor = useBlockNoteEditor();
  return useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e.isEditable) return undefined;
      const blocks = e.getSelection()?.blocks ?? [e.getTextCursorPosition().block];
      if (blocks.length !== 1 || blocks[0].type !== 'image') return undefined;
      const props = blocks[0].props as { url?: unknown; name?: unknown; textAlignment?: unknown };
      const align = props.textAlignment === 'center' || props.textAlignment === 'right' ? props.textAlignment : 'left';
      return { id: blocks[0].id, url: typeof props.url === 'string' ? props.url : '', name: typeof props.name === 'string' ? props.name : '', align };
    },
    equalityFn: (a, b) => a?.id === b?.id && a?.url === b?.url && a?.name === b?.name && a?.align === b?.align,
  });
}

/** La barra de una foto-bloque (también un video o un adjunto: la misma, sin tamaños para un adjunto). */
export function ImageBlockBar() {
  const editor = useBlockNoteEditor() as AnyEditor;
  const Components = useComponentsContext()!;
  const actions = useMediaActions();
  const { media } = useServices();
  const tr = useT();
  const block = useChosenImageBlock();
  if (!block) return null;
  const id = mediaIdOf(block.url);
  const attachment = !!id && isAttachment(media, id, block.name);
  const update = (props: Record<string, unknown>) => editor.updateBlock(block.id, { props } as never);
  const replace = (file: File) => {
    if (!actions) return;
    actions.store(file).then(
      (url) => {
        if (editor.getBlock(block.id)) update({ url, name: file.name || 'file' });
      },
      () => undefined,
    );
  };
  return (
    <Components.FormattingToolbar.Root className="bn-toolbar bn-formatting-toolbar sd-media-bar">
      <Sectors>
        {[
          (carreteSourceOf(block.url) || block.url) && (
            <>
              <ViewButton url={block.url} label={attachment ? tr('attachment.open') : undefined} onView={() => actions?.onView(block.id)} />
              <DownloadButton url={block.url} name={block.name} />
            </>
          ),
          !attachment && <ImageSizeButtons />,
          <AlignButtons current={block.align} onAlign={(a) => update({ textAlignment: a })} />,
          actions?.canComment && <CommentButton blockId={block.id} />,
          <>
            {actions && <ReplaceButton accept={actions.accept.block} onFile={replace} />}
            {/* Un archivo del Drive no se renombra (la tarjeta y la descarga usan el nombre del archivo). */}
            {!id && <RenameButton name={block.name} onRename={(name) => update({ name })} />}
            <DeleteButton many={false} onDelete={() => editor.removeBlocks([block.id])} />
          </>,
        ]}
      </Sectors>
    </Components.FormattingToolbar.Root>
  );
}
