import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu, type Block } from '@blocknote/core';
import '@blocknote/core/fonts/inter.css';
import { withCollaboration } from '@blocknote/core/yjs';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import {
  blockTypeSelectItems,
  FormattingToolbar,
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  getFormattingToolbarItems,
  SuggestionMenuController,
  useCreateBlockNote,
  type BlockTypeSelectItem,
  type DefaultReactSuggestionItem,
} from '@blocknote/react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import type * as Y from 'yjs';
import { usePermissions, useServices, useSyncStatus } from '../services';
import { FileRejected, isAllowedImage } from '../sync/files';
import { isMediaFile, MEDIA_SCHEME, mediaIdOf } from '../media/queue';
import { Carrete } from './Carrete';
import { blockIdOf, collectCarrete, startIndex, type BlockLike, type CarreteItem } from './carrete';
import { createCarreteLoader, type CarreteLoader } from './carreteLoader';
import { MediaDownloadButton, MediaViewButton } from './MediaToolbarButtons';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { schema, SCRIPT_PROP, setVideosAccepted } from './editorSchema';
import { findUnknownContent } from './unknownContent';
import {
  CommentMargin,
  CommentSideMenuController,
  CommentToolbarButton,
  paragraphVariantItems,
  questionSlashItem,
  useBlockSourceRegistration,
  withParagraphVariants,
} from './EditorComments';
import { useCommentAccess } from './CommentsPanel';
import { ScriptIcon } from './icons';
import { notify } from './notice';
import { useScheme } from '../prefs';

// Script es un párrafo con `script: true` (ver editorSchema.ts), y una pregunta, uno con `question: true`
// (EditorComments.tsx). Cada ítem del selector pide las dos propiedades, así el selector distingue uno de
// otro y volver a párrafo saca la marca.
const scriptTypeItem: BlockTypeSelectItem = {
  name: 'Script',
  type: 'paragraph',
  props: { [SCRIPT_PROP]: true },
  icon: ScriptIcon as unknown as BlockTypeSelectItem['icon'],
};

type Opening =
  | { state: 'loading' }
  | { state: 'ready'; doc: Y.Doc; complete: boolean }
  /** La página trae algo que esta versión del editor no conoce: abrirla lo borraría. */
  | { state: 'unsupported'; what: string };

export function PageEditor({ pageId }: { pageId: string }) {
  const { docs, engine } = useServices();
  const status = useSyncStatus();
  // Sin "Edit" (nivel 3) la página se abre en solo lectura (paso 9): el servidor rechazaría lo escrito.
  const perms = usePermissions();
  const canEdit = perms.canEditPage(pageId);
  // La estructura inicial es un cambio: solo con los permisos ya conocidos y "Edit". Si cambian, la página
  // se vuelve a abrir (así se siembra, o se descarta una reparación hecha solo en memoria).
  const canSeed = perms.canSeed(pageId);
  // Con "Comment" (nivel 2) se comenta y se contesta aunque el editor quede en solo lectura (paso 10).
  const { canComment } = useCommentAccess(pageId);
  const [opening, setOpening] = useState<Opening>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const incomplete = opening.state === 'ready' && !opening.complete;

  // Si el servidor tiene contenido de esta página que el dispositivo todavía no bajó, se muestra lo que
  // hay en solo lectura: editar sobre un documento a medio bajar arma una estructura paralela. Cuando
  // llega lo que falta, se vuelve a abrir para editar.
  useEffect(() => {
    let cancelled = false;
    let opened = false;
    void engine.prefetchPage(pageId).then(async (complete) => {
      if (cancelled) return;
      const doc = await docs.open(pageId, { seed: complete && canSeed });
      opened = true;
      if (cancelled) return docs.close(pageId);
      const unknown = findUnknownContent(doc);
      if (unknown) setOpening({ state: 'unsupported', what: unknown });
      else setOpening({ state: 'ready', doc, complete });
    });
    return () => {
      cancelled = true;
      if (opened) docs.close(pageId);
      setOpening({ state: 'loading' });
    };
  }, [docs, engine, pageId, attempt, canSeed]);

  // Si llega del servidor algo que esta versión no conoce, el editor se cierra antes de que lo vea.
  useEffect(
    () =>
      docs.subscribeUnsupported((id) => {
        if (id === pageId) setAttempt((n) => n + 1);
      }),
    [docs, pageId],
  );

  // Mientras falte contenido, cada sincronización se fija si ya llegó; recién entonces se reabre, para
  // no mover la vista de quien está leyendo.
  useEffect(() => {
    if (!incomplete) return;
    let cancelled = false;
    void engine.isMissingContent(pageId).then((missing) => {
      if (!cancelled && !missing) setAttempt((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [engine, pageId, incomplete, status.lastSyncAt]);

  if (opening.state === 'loading') return <div className="editor-placeholder" />;
  if (opening.state === 'unsupported') return <UnsupportedPage />;
  return (
    <>
      {!opening.complete && (
        <p className="muted editor-missing">
          {status.online
            ? 'Part of this page is still downloading. It opens for editing as soon as it arrives.'
            : 'Part of this page has not been downloaded to this device yet. You can read what is here; connect to the internet to edit it.'}
        </p>
      )}
      {!canEdit && perms.known && (
        <p className="muted editor-missing">
          {canComment
            ? 'You can comment on this page and answer its questions. Ask for edit access to change it.'
            : 'You can view this page. Ask for edit access to change it.'}
        </p>
      )}
      <BlockEditor
        key={`${pageId}:${opening.complete}:${canEdit}`}
        doc={opening.doc}
        pageId={pageId}
        editable={opening.complete && canEdit}
        canComment={canComment}
      />
    </>
  );
}

/** La página tiene algo hecho con una versión más nueva de la app. Nada se borra: está guardado. */
function UnsupportedPage() {
  return (
    <div className="banner unsupported-page" role="status">
      <p>
        <strong>This page was edited with a newer version of the app.</strong> This version can't show all of it
        without losing part, so it stays closed. Nothing is lost.
      </p>
      <button className="link" onClick={() => window.location.reload()}>
        Update the app
      </button>
    </div>
  );
}

/** Lo que se puede agregar hoy, para el aviso. */
function acceptedText(withMedia: boolean): string {
  return withMedia
    ? 'Only photos and videos can be added.'
    : 'Only images can be added for now (JPEG, PNG, GIF, WebP, AVIF or HEIC). Videos need the workspace media server (Google Drive).';
}

function BlockEditor({ doc, pageId, editable, canComment }: { doc: Y.Doc; pageId: string; editable: boolean; canComment: boolean }) {
  const { files, media, user } = useServices();
  const scheme = useScheme();
  const editorRef = useRef<{ removeBlocks: (ids: string[]) => unknown } | null>(null);
  const [carrete, setCarrete] = useState<OpenCarrete | null>(null);
  /** El toque empezó sobre una foto que ya estaba elegida (ver `openCarrete`). */
  const pressedSelected = useRef(false);
  /** El bloque de la última foto tocada (`null` si el último toque fue en otro lado; ver `notePress`). */
  const lastPress = useRef<string | null>(null);

  // Con portero, las fotos y los videos van al Drive del dueño (`sdmedia://`, primero en el dispositivo);
  // sin portero, las imágenes a Supabase como siempre (`sdfile://`).
  const store = (file: Blob & { name?: string }): Promise<string> => {
    if (media.enabled && isMediaFile(file)) return media.add(pageId, file);
    if (!isAllowedImage(file.type)) return Promise.reject(new FileRejected(acceptedText(media.enabled)));
    return files.add(pageId, file);
  };

  const editor = useCreateBlockNote(
    withCollaboration({
      schema,
      uploadFile: (file: File, blockId?: string) =>
        store(file).catch((err: unknown) => {
          notify(err instanceof FileRejected ? err.message : 'This file could not be saved on this device.');
          // El editor ya insertó el bloque de la imagen: se quita para que no quede vacío.
          if (blockId) {
            setTimeout(() => {
              try {
                editorRef.current?.removeBlocks([blockId]);
              } catch {
                // El bloque ya no está.
              }
            });
          }
          throw err;
        }),
      resolveFileUrl: (url: string) => (mediaIdOf(url) ? media.resolve(url) : files.resolve(url)),
      tables: { splitCells: true, cellBackgroundColor: true, cellTextColor: true, headers: true },
      collaboration: {
        fragment: doc.getXmlFragment(CONTENT_FRAGMENT),
        user: { name: user.email, color: '#2383e2' },
      },
    }),
    [doc],
  );

  editorRef.current = editor as unknown as { removeBlocks: (ids: string[]) => unknown };

  useEffect(() => {
    const focus = () => editor.focus();
    window.addEventListener('shotdocs:focus-editor', focus);
    return () => window.removeEventListener('shotdocs:focus-editor', focus);
  }, [editor]);

  // Una imagen pegada dentro de HTML puede venir embebida (`data:`): se pasa a archivo para que el
  // documento no cargue megas y la imagen se sincronice como las demás. Solo lo hace el dispositivo que la
  // pegó (cambios locales), así no se sube una copia por cada dispositivo que abre la página.
  useEffect(() => {
    if (!editable) return;
    const converting = new Set<string>();
    return editor.onChange((_, { getChanges }) => {
      for (const change of getChanges()) {
        if (change.type === 'delete' || change.type === 'move') continue;
        for (const block of flatten([change.block as Block])) {
          const url = (block.props as { url?: string }).url;
          if (block.type !== 'image' || !url?.startsWith('data:') || converting.has(block.id)) continue;
          converting.add(block.id);
          void fetch(url)
            .then((r) => r.blob())
            .then((blob) => store(blob))
            .then((stored) => {
              if (editor.getBlock(block.id)) editor.updateBlock(block.id, { props: { url: stored } } as never);
            })
            .catch((err: unknown) =>
              notify(
                err instanceof FileRejected
                  ? `A pasted image stays embedded in the page: ${err.message}`
                  : 'A pasted image could not be saved as a file; it stays embedded in the page.',
              ),
            )
            .finally(() => converting.delete(block.id));
        }
      }
    }, false);
  }, [editor, files, pageId, editable]);

  // Qué páginas usan cada foto o video: un `sdmedia://` que llega a esta página (se copió o se pegó de
  // otra) se registra para ella. Al abrir y con cada cambio hecho acá; lo ya visto no se vuelve a pedir.
  useEffect(() => {
    if (!editable) return;
    const collect = (blocks: Block[]) =>
      flatten(blocks).flatMap((b) => {
        const id = b.type === 'image' ? mediaIdOf((b.props as { url?: string }).url) : null;
        return id ? [id] : [];
      });
    const link = (ids: string[]) => {
      if (ids.length > 0) void media.ensureLinks(pageId, ids).catch(() => undefined);
    };
    link(collect(editor.document as Block[]));
    return editor.onChange((_, { getChanges }) => {
      link(collect(getChanges().filter((c) => c.type === 'insert' || c.type === 'update').map((c) => c.block as Block)));
    }, false);
  }, [editor, media, pageId, editable]);

  // BlockNote resuelve la dirección de una imagen una sola vez. Si la miniatura llega después (se está
  // haciendo en este dispositivo, o la subió otro), se cambia la imagen en pantalla sin tocar el documento.
  useEffect(
    () =>
      media.subscribeThumbs((id) => {
        void media.resolve(MEDIA_SCHEME + id).then((src) => {
          for (const el of editor.domElement?.querySelectorAll<HTMLElement>('[data-content-type="image"]') ?? []) {
            if (mediaIdOf(el.getAttribute('data-url')) !== id) continue;
            const img = el.querySelector<HTMLImageElement>('img.bn-visual-media');
            if (img) img.src = src;
          }
        });
      }),
    [editor, media],
  );

  // El selector del bloque `image` ofrece videos solo si el workspace tiene portero.
  setVideosAccepted(media.enabled);

  const slashItems = useMemo(() => {
    const script: DefaultReactSuggestionItem = {
      title: 'Script',
      subtext: 'Screenplay text: INT/EXT, DAY, NIGHT marked',
      aliases: ['guion', 'guión', 'screenplay', 'escena', 'scene'],
      group: 'Basic blocks',
      icon: <ScriptIcon size={18} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'paragraph', props: { [SCRIPT_PROP]: true } }),
    };
    // "/Paragraph" en una línea Script también le saca la marca de guion.
    const items = getDefaultReactSlashMenuItems(editor).map((item) =>
      (item as { key?: string }).key === 'paragraph' || item.title === editor.dictionary.slash_menu.paragraph.title
        ? {
            ...item,
            onItemClick: () =>
              insertOrUpdateBlockForSlashMenu(editor, { type: 'paragraph', props: { [SCRIPT_PROP]: false } }),
          }
        : item,
    );
    const at = items.findIndex((i) => i.group !== 'Headings' && i.group !== 'Basic blocks');
    // Script, Question y Paragraph se sacan la marca uno al otro (nunca Script y pregunta juntos).
    const variants = items.map((i) =>
      (i as { key?: string }).key === 'paragraph' || i.title === editor.dictionary.slash_menu.paragraph.title
        ? withParagraphVariants(i, editor, 'paragraph')
        : i,
    );
    const extra = [withParagraphVariants(script, editor, 'script'), questionSlashItem(editor)];
    return (query: string) =>
      Promise.resolve(filterSuggestionItems([...variants.slice(0, at), ...extra, ...variants.slice(at)], query));
  }, [editor]);

  const toolbarItems = useMemo(() => paragraphVariantItems(blockTypeSelectItems(editor.dictionary), scriptTypeItem), [editor]);

  // Comentarios (paso 10): el panel sabe qué dice cada bloque; el margen se dibuja sobre el editor.
  useBlockSourceRegistration(editor, pageId);
  const host = useRef<HTMLDivElement>(null);

  // Pegar o soltar un archivo que no se puede guardar haría que el editor intente crear un bloque que no
  // existe en el esquema: se corta antes, con un aviso.
  const rejectOtherFiles = (e: ClipboardEvent | DragEvent, data: DataTransfer | null) => {
    const files = Array.from(data?.files ?? []);
    const ok = (f: File) => isAllowedImage(f.type) || (media.enabled && isMediaFile(f));
    if (files.length === 0 || files.every(ok)) return;
    e.preventDefault();
    e.stopPropagation();
    notify(acceptedText(media.enabled));
  };

  // El carrete (paso 7): un clic o un toque en una foto o un video abre todas las de la página, empezando
  // por esa (Docs/Doc_Carrete.md). El editor igual elige el bloque debajo (el evento no se corta): al
  // cerrar con Escape o el mouse, el foco vuelve al editor y la foto queda elegida con su barra (ver,
  // reemplazar, leyenda, nombre, bajar, borrar). Los tiradores para cambiar el tamaño y el de arrastrar el
  // bloque son otros elementos: nunca abren el carrete. Con el dedo, al cerrar el foco no vuelve al editor
  // (abriría el teclado); para editar, se toca otra vez la foto: si está elegida y el editor tiene el foco,
  // o el toque anterior fue en esa misma foto (sin tocar otra cosa en el medio), ese toque muestra la barra
  // en vez de abrir el carrete. Con el teclado: la barra espaciadora sobre la foto elegida, o "View".
  useEffect(() => {
    // En burbuja: corre después de `notePress`. Lo que se toca adentro del carrete no cuenta.
    const onDown = (e: globalThis.PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.('.carrete')) return;
      lastPress.current = target?.closest?.('img.bn-visual-media') ? blockIdOf(target) : null;
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  const notePress = (e: PointerEvent) => {
    const target = e.target as HTMLElement;
    pressedSelected.current =
      editable &&
      e.pointerType !== 'mouse' &&
      !!target.closest?.('img.bn-visual-media') &&
      !!target.closest('.ProseMirror-selectednode') &&
      (editor.isFocused() || lastPress.current === blockIdOf(target));
  };

  const openAt = (blockId: string | null) => {
    const items = collectCarrete(editor.document as unknown as BlockLike[]);
    const start = startIndex(items, blockId);
    if (start < 0) return false;
    setCarrete({ items, start, loader: createCarreteLoader({ media, files }) });
    return true;
  };

  const openCarrete = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.matches('img.bn-visual-media') || pressedSelected.current) return;
    openAt(blockIdOf(target));
  };

  // La barra espaciadora con una foto elegida la abre (como la vista rápida de la Mac). Con una foto
  // elegida la barra no escribe nada, y Enter sigue creando un párrafo debajo.
  const openWithKeyboard = (e: KeyboardEvent) => {
    if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !editor.isFocused()) return;
    const nodeSelected = editor.transact((tr) => 'node' in tr.selection);
    const block = editor.getTextCursorPosition().block;
    if (!nodeSelected || block.type !== 'image') return;
    if (openAt(block.id)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // Lo creado para el carrete (los originales en memoria) se suelta al cerrarlo o al salir de la página.
  useEffect(() => () => carrete?.loader.dispose(), [carrete]);

  return (
    <div
      ref={host}
      className="editor-host"
      onPasteCapture={(e) => rejectOtherFiles(e.nativeEvent, e.clipboardData)}
      onDropCapture={(e) => rejectOtherFiles(e.nativeEvent, e.dataTransfer)}
      onPointerDownCapture={notePress}
      onKeyDownCapture={openWithKeyboard}
      onClick={openCarrete}
    >
      <BlockNoteView
        editor={editor}
        editable={editable}
        theme={scheme}
        className="editor"
        slashMenu={false}
        formattingToolbar={false}
        sideMenu={false}
      >
        <SuggestionMenuController triggerCharacter="/" getItems={slashItems} />
        <FormattingToolbarController
          formattingToolbar={() => (
            <FormattingToolbar blockTypeSelectItems={toolbarItems}>
              {getFormattingToolbarItems(toolbarItems).flatMap((item) =>
                // Para las fotos y videos del Drive, "Download" baja el original (no la miniatura), y
                // "View" abre el carrete.
                item.key === 'fileDownloadButton'
                  ? [<MediaViewButton key="mediaViewButton" onView={openAt} />, <MediaDownloadButton key="fileDownloadButton" />]
                  : [item],
              )}
              {canComment && <CommentToolbarButton key="comment" />}
            </FormattingToolbar>
          )}
        />
        <CommentSideMenuController />
      </BlockNoteView>
      <CommentMargin editor={editor} pageId={pageId} canComment={canComment} host={host} />
      {carrete && <CarreteHost {...carrete} onClose={() => setCarrete(null)} />}
    </div>
  );
}

interface OpenCarrete {
  items: CarreteItem[];
  start: number;
  loader: CarreteLoader;
}

/** El carrete con el estado de la red (aparte, para que el editor no se vuelva a dibujar con cada cambio). */
function CarreteHost(props: OpenCarrete & { onClose: () => void }) {
  const { online } = useSyncStatus();
  return <Carrete {...props} online={online} />;
}

function flatten(blocks: Block[]): Block[] {
  return blocks.flatMap((b) => [b, ...flatten(b.children as Block[])]);
}
