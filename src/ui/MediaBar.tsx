import { ScreenReaderOnlySubmit, useBlockNoteEditor, useComponentsContext, useEditorState, usePortalElement } from '@blocknote/react';
import { BarButton, BarSep } from './BarButton';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { t, useT } from '../i18n';
import '../i18n/lazy/editor';
import '../i18n/lazy/folders';
import { mediaIdOf } from '../media/queue';
import { useServices } from '../services';
import { isAttachment } from './attachments';
import { carreteSourceOf } from './carreteModel';
import { isOffline, startDownload } from './carreteLoader';
import { commentOnBlock } from './commentsUi';
import { asAction, tipRows } from './tipRows';
import { currentTarget, openCaption } from '../assistant/assistantUi';
import type { PhotoRef } from '../assistant/photoRef';
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon, AnnotateIcon, AssistantIcon, CommentIcon, DownloadIcon, RenameIcon, ReplaceIcon, ShareIcon, TrashIcon } from './icons';
import { canShareFiles, saveToRollOffered, shareFile, shareFileOf, touchDevice } from './camera';
import { porteroDownload } from './sharpImages';
import { ImageSizeButtons, OriginalDownloadButton, ViewIcon } from './MediaToolbarButtons';
import { notify } from './notice';
import { useLinkMode } from '../linkMode';
import type { EditorView } from '@tiptap/pm/view';
import { liveView } from './inlinePhotoCreate';

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
  /** *Download all* de la carpeta de ese bloque (P.9, entrega 2): abre su visor con la descarga. */
  onDownloadAll?: (blockId: string) => void;
  /** Abre el anotador en esa foto del Drive (P.20, entrega 2); sin esto (no se puede editar), no hay *Annotate*. */
  onAnnotate?: (url: string, name: string) => void;
  /** Ofrece la hoja anotada para la foto actual; false conserva la descarga original. */
  onPhotoExport?: (key: string, trigger: HTMLElement | null) => boolean;
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

// --- Qué es: foto, video o adjunto (los nombres de los botones lo dicen) ---------------------------------------

export type MediaKind = 'image' | 'video' | 'file';

/** Qué es lo que muestra esa dirección: del Drive, lo que dice la cola; si no, por la extensión del nombre. */
export function useMediaKind(url: string | null, name: string): MediaKind {
  const { media } = useServices();
  const id = mediaIdOf(url);
  const info = id ? media.fileInfo(id) : null;
  if (info) return info.kind === 'video' ? 'video' : info.kind === 'file' ? 'file' : 'image';
  if (id && isAttachment(media, id, name)) return 'file';
  return /\.(mp4|m4v|mov|webm|ogv|mkv)$/i.test(name || url || '') ? 'video' : 'image';
}

/** El nombre de un botón según lo que es. */
export function kindLabel(kind: MediaKind, image: string, video: string, file: string): string {
  return kind === 'video' ? video : kind === 'file' ? file : image;
}

// --- Botones -----------------------------------------------------------------------------------------------

export function ViewButton({ url, attachment = false, onView }: { url: string | null; attachment?: boolean; onView: () => void }) {
  const tr = useT();
  if (!url || !carreteSourceOf(url)) return null;
  // Un adjunto (Docs/Doc_Adjuntos.md) no va al carrete: *Open* lo abre en otra pestaña o lo baja.
  const name = attachment ? tr('attachment.open') : tr('mediaButton.view');
  // Con el atajo (D226): el renglón «**Espacio**: ver» y debajo lo que hace; sin atajo (táctil), el nombre.
  const tip = attachment
    ? `${name}\n${tr('attachment.openTip')}`
    : (tipRows([{ shortcut: 'photoOpen', action: asAction(name) }, tr('photoTip.view')]) ?? `${name}\n${tr('photoTip.view')}`);
  return <BarButton label={name} tip={tip} icon={<ViewIcon />} test="mediaView" onClick={onView} />;
}

/**
 * *Annotate* (P.20, Docs/Doc_Anotar_Fotos.md): solo una foto del Drive (`sdmedia://`; no videos ni adjuntos) y solo con
 * la página editable (sin `onAnnotate`, no está).
 */
export function AnnotateButton({ url, name, kind }: { url: string | null; name: string; kind: MediaKind }) {
  const actions = useMediaActions();
  const tr = useT();
  if (!url || kind !== 'image' || !mediaIdOf(url) || !actions?.onAnnotate) return null;
  const label = tr('photoBar.annotate');
  return <BarButton label={label} tip={`${label}
${tr('photoTip.annotate')}`} icon={<AnnotateIcon size={18} />} test="mediaAnnotate" onClick={() => actions.onAnnotate!(url, name)} />;
}

/**
 * *Suggest caption* (Docs/Doc_Asistente.md, entrega A3): abre el panel del asistente con el pedido de esa foto. Solo una
 * foto (no videos ni adjuntos) y solo en el editor de la página abierta (no en una versión del historial ni en la
 * práctica). La barra ya sale solo con la página editable. `photo` se calcula al tocar (la foto de ese momento).
 */
export function SuggestCaptionButton({ kind, photo }: { kind: MediaKind; photo: () => PhotoRef | null }) {
  const editor = useBlockNoteEditor();
  const tr = useT();
  const view = currentTarget()?.view();
  if (kind !== 'image' || !view || view !== editor.prosemirrorView) return null;
  const label = tr('photoBar.caption');
  return (
    <BarButton
      label={label}
      tip={`${label}
${tr('photoTip.caption')}`}
      icon={<AssistantIcon size={18} />}
      test="mediaCaption"
      onClick={() => {
        const ref = photo();
        if (ref) openCaption(ref);
      }}
    />
  );
}

/**
 * Bajar: una foto del Drive, su original (OriginalDownloadButton); otra (`sdfile://`, `https`), lo que resuelve el
 * editor, con su nombre.
 */
export function DownloadButton({ url, name, blockId, photoKey }: { url: string | null; name: string; blockId?: string; photoKey?: string | null }) {
  const editor = useBlockNoteEditor();
  const { media } = useServices();
  const actions = useMediaActions();
  const link = useLinkMode();
  const tr = useT();
  const kind = useMediaKind(url, name);
  const id = mediaIdOf(url);
  const label = kindLabel(kind, tr('mediaButton.download'), tr('photoBar.downloadVideo'), tr('photoBar.downloadFile'));
  if (!url) return null;
  // Una carpeta (P.9): *Download all* abre su visor con la descarga (FolderDownload.tsx).
  if (id && media.isFolder(id)) {
    if (!blockId || !actions?.onDownloadAll) return null;
    const all = tr('folders.downloadAll');
    return (
      <BarButton
        label={all}
        tip={`${all}\n${tr('folders.downloadAllTip')}`}
        icon={<DownloadIcon size={18} />}
        test="mediaDownloadAll"
        onClick={() => actions.onDownloadAll!(blockId)}
      />
    );
  }
  if (id) return <OriginalDownloadButton key={id} fileId={id} label={label} onOpen={!link && kind === 'image' && photoKey && actions?.onPhotoExport ? (trigger) => actions.onPhotoExport!(photoKey, trigger) : undefined} />;
  const download = () => {
    const resolve = (editor as unknown as { resolveFileUrl?: (u: string) => Promise<string> }).resolveFileUrl;
    (resolve ? resolve(url) : Promise.resolve(url)).then(
      (href) => startDownload({ url: href, local: href.startsWith('blob:') || href.startsWith('data:') }, name || 'image'),
      (err: unknown) => notify(isOffline(err) ? t('mediaButton.offline') : t('mediaButton.failed')),
    );
  };
  return <BarButton label={label} tip={`${label}\n${tr('photoTip.download')}`} icon={<DownloadIcon size={18} />} test="mediaDownload" onClick={download} />;
}

/**
 * *Save to camera roll* (camera.ts): la hoja de compartir del sistema con el original, donde la persona elige
 * "Guardar imagen" o "Guardar video". Solo en un dispositivo de toque con un navegador que comparte archivos, y
 * nunca para un adjunto. El original del dispositivo se prepara apenas se elige la foto (el toque abre la hoja en el
 * acto); uno que hay que bajar se baja con el toque y, si el navegador ya no deja abrir la hoja, queda listo para el
 * siguiente toque.
 */
export function SaveToRollButton({ url, name }: { url: string | null; name: string }) {
  const editor = useBlockNoteEditor();
  const { media } = useServices();
  const tr = useT();
  const kind = useMediaKind(url, name);
  const [able] = useState(() => ({ touch: touchDevice(), share: canShareFiles() }));
  const ready = useRef<File | null>(null);
  const busy = useRef(false);
  const id = mediaIdOf(url);
  const offered = !!url && saveToRollOffered({ kind, ...able }) && !(id && media.isFolder(id));
  useEffect(() => {
    ready.current = null;
    if (!offered || !id) return;
    let alive = true;
    media.source(id).then(
      (src) => {
        if (alive && src.original) ready.current = shareFileOf(src.original, src.name || name, src.mime);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [offered, media, id, name]);
  if (!offered || !url) return null;

  // El original: el del dispositivo, o bajado con un pase del portero; sin Drive (`sdfile://`), lo que da el editor.
  const original = async (): Promise<File> => {
    if (id) {
      const src = await media.source(id);
      const blob = src.original ?? (await porteroDownload(media)(id));
      return shareFileOf(blob, src.name || name, src.mime);
    }
    const resolve = (editor as unknown as { resolveFileUrl?: (u: string) => Promise<string> }).resolveFileUrl;
    const res = await fetch(resolve ? await resolve(url) : url);
    if (!res.ok) throw new Error(`download ${res.status}`);
    return shareFileOf(await res.blob(), name);
  };
  const share = async (file: File) => {
    const result = await shareFile(file);
    if (result === 'again') notify(t('camera.saveAgain'));
    else if (result === 'unsupported') notify(t('camera.saveUnsupported'));
    else if (result === 'failed') notify(t('attachment.shareFailed'));
  };
  const onClick = () => {
    if (ready.current) return void share(ready.current);
    if (busy.current) return;
    busy.current = true;
    original()
      .then(
        (file) => {
          ready.current = file;
          return share(file);
        },
        (err: unknown) => notify(isOffline(err) ? t('mediaButton.offline') : t('mediaButton.failed')),
      )
      .finally(() => (busy.current = false));
  };
  const label = kind === 'video' ? tr('camera.saveVideo') : tr('camera.save');
  return <BarButton label={label} tip={`${label}
${tr('camera.saveTip')}`} icon={<ShareIcon size={18} />} test="mediaSaveToRoll" onClick={onClick} />;
}

export type Alignment = 'left' | 'center' | 'right';

export function AlignButtons({ current, inline = false, onAlign }: { current: Alignment | null; inline?: boolean; onAlign: (a: Alignment) => void }) {
  const tr = useT();
  // En línea alinea el renglón; la foto-bloque va a un costado o al centro.
  const what = (a: Alignment) => (inline ? tr('photoTip.alignLine') : a === 'center' ? tr('photoTip.alignCenter') : tr('photoTip.alignSide'));
  const items: [Alignment, string, ReactNode][] = [
    ['left', tr('photoBar.alignLeft'), <AlignLeftIcon key="l" />],
    ['center', tr('photoBar.alignCenter'), <AlignCenterIcon key="c" />],
    ['right', tr('photoBar.alignRight'), <AlignRightIcon key="r" />],
  ];
  return (
    <>
      {items.map(([a, label, ic]) => (
        <BarButton key={a} label={label} tip={`${label}\n${what(a)}`} icon={ic} selected={current === a} test={`align-${a}`} onClick={() => onAlign(a)} />
      ))}
    </>
  );
}

export function CommentButton({ blockId }: { blockId: string | null }) {
  const tr = useT();
  const label = tr('comments.comment');
  const tip = tipRows([{ shortcut: 'comment', action: asAction(label) }, tr('photoTip.comment')]) ?? `${label}\n${tr('photoTip.comment')}`;
  return <BarButton label={label} tip={tip} icon={<CommentIcon size={18} />} test="mediaComment" onClick={() => commentOnBlock(blockId)} />;
}

/** Reemplazar: el selector de archivos del sistema (uno); lo elegido se guarda y pasa a ser la foto. */
export function ReplaceButton({ accept, kind = 'image', onFile }: { accept: string; kind?: MediaKind; onFile: (file: File) => void }) {
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
  const label = kindLabel(kind, tr('photoBar.replace'), tr('photoBar.replaceVideo'), tr('photoBar.replaceFile'));
  return <BarButton label={label} tip={`${label}\n${tr('photoTip.replace')}`} icon={<ReplaceIcon />} test="mediaReplace" onClick={pick} />;
}

/** Renombrar: un campo en un globo, como el de BlockNote; cada letra cambia el nombre. */
export function RenameButton({ name, kind = 'image', onRename }: { name: string; kind?: MediaKind; onRename: (name: string) => void }) {
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
  const label = kind === 'video' ? tr('photoBar.renameVideo') : tr('photoBar.rename');
  return (
    <Components.Generic.Popover.Root open={open} onOpenChange={setOpen} portalElement={portal}>
      <Components.Generic.Popover.Trigger>
        <BarButton label={label} tip={`${label}\n${tr('photoTip.rename')}`} icon={<RenameIcon />} test="mediaRename" onClick={() => setOpen(!open)} />
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

export function DeleteButton({ many, kind = 'image', onDelete }: { many: boolean; kind?: MediaKind; onDelete: () => void }) {
  const tr = useT();
  const label = many ? tr('photoBar.deleteMany') : kindLabel(kind, tr('photoBar.delete'), tr('photoBar.deleteVideo'), tr('photoBar.deleteFile'));
  const what = many ? tr('photoTip.deleteMany') : tr('photoTip.delete');
  const tip = tipRows([{ shortcut: 'photoDelete', action: asAction(label) }, what]) ?? `${label}\n${what}`;
  return <BarButton label={label} tip={tip} icon={<TrashIcon />} test="mediaDelete" onClick={onDelete} />;
}

// --- La barra de la foto-bloque ---------------------------------------------------------------------------

// La elección pendiente pertenece a la vista y al bloque: ocultar la barra no reinicia su prioridad.
const pendingReplacements = new WeakMap<EditorView, Map<string, symbol>>();

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
  const block = useChosenImageBlock();
  const kind = useMediaKind(block?.url ?? null, block?.name ?? '');
  if (!block) return null;
  const id = mediaIdOf(block.url);
  const attachment = !!id && isAttachment(media, id, block.name);
  const update = (props: Record<string, unknown>) => editor.updateBlock(block.id, { props } as never);
  const replace = (file: File) => {
    const view = liveView(editor as never);
    if (!actions || !view || !editor.isEditable) return;
    const token = Symbol();
    let pending = pendingReplacements.get(view);
    if (!pending) pendingReplacements.set(view, (pending = new Map()));
    pending.set(block.id, token);
    const release = () => {
      const current = pendingReplacements.get(view);
      if (current?.get(block.id) !== token) return;
      current.delete(block.id);
      if (!current.size) pendingReplacements.delete(view);
    };
    let stored: Promise<string>;
    try {
      stored = actions.store(file);
    } catch (error) {
      release();
      throw error;
    }
    stored.then(
      (url) => {
        try {
          if (pendingReplacements.get(view)?.get(block.id) !== token) return;
          if (liveView(editor as never) !== view || !editor.isEditable) return;
          const current = editor.getBlock(block.id);
          if (current?.type !== 'image' || (current.props as { url?: unknown }).url !== block.url) return;
          update({ url, name: file.name || 'file' });
        } finally {
          release();
        }
      },
      release,
    );
  };
  return (
    <Components.FormattingToolbar.Root className="bn-toolbar bn-formatting-toolbar sd-media-bar">
      <Sectors>
        {[
          (carreteSourceOf(block.url) || block.url) && (
            <>
              <ViewButton url={block.url} attachment={attachment} onView={() => actions?.onView(block.id)} />
              <DownloadButton url={block.url} name={block.name} blockId={block.id} photoKey={block.id} />
              {!attachment && <SaveToRollButton url={block.url} name={block.name} />}
              {!attachment && <AnnotateButton url={block.url} name={block.name} kind={kind} />}
              {!attachment && (
                <SuggestCaptionButton kind={kind} photo={() => ({ kind: 'block', blockId: block.id, index: 0, url: block.url, name: block.name })} />
              )}
            </>
          ),
          !attachment && <ImageSizeButtons />,
          <AlignButtons current={block.align} onAlign={(a) => update({ textAlignment: a })} />,
          actions?.canComment && <CommentButton blockId={block.id} />,
          <>
            {actions && <ReplaceButton accept={actions.accept.block} kind={kind} onFile={replace} />}
            {/* Un archivo del Drive no se renombra (la tarjeta y la descarga usan el nombre del archivo). */}
            {!id && <RenameButton name={block.name} kind={kind} onRename={(name) => update({ name })} />}
            <DeleteButton many={false} kind={kind} onDelete={() => {
                editor.removeBlocks([block.id]);
                // La barra se va con el bloque y el foco quedaba en ningún lado: Ctrl/⌘+Z no deshacía hasta un clic.
                editor.focus();
              }}
            />
          </>,
        ]}
      </Sectors>
    </Components.FormattingToolbar.Root>
  );
}
