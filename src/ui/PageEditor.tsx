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
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import type * as Y from 'yjs';
import { t, useT, type Translate } from '../i18n';
import '../i18n/lazy/editor';
import { usePermissions, useServices, useSyncStatus } from '../services';
import { FileRejected, isAllowedImage } from '../sync/files';
import { isMediaFile, MEDIA_SCHEME, mediaIdOf } from '../media/queue';
import { blockIdOf, collectCarrete, startIndex, type BlockLike, type CarreteItem } from './carrete';
import { createCarreteLoader, type CarreteLoader } from './carreteLoader';
import { ImageSizeButtons, MediaDownloadButton, MediaViewButton } from './MediaToolbarButtons';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { editorSchemaOptions, SCRIPT_PROP, setVideosAccepted } from './editorSchema';
import { editorDictionary } from './editorLocale';
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
import { useCommentAccess } from './CommentsToggle';
import { ScriptIcon } from './icons';
import { notify } from './notice';
import { useScheme } from '../prefs';
import { createDrivePaste } from './drivePaste';
import { DrivePasteMenu } from './DrivePasteMenu';
import { lazyPart, Part, preloadWhenIdle } from './lazyPart';
import { SheetBreaks } from './SheetBreaks';
import { clickOpens, mousePressOpens } from './carreteClick';

// El carrete se baja aparte, la primera vez que se abre (roadmap B.4).
const Carrete = lazyPart(() => import('./Carrete').then((m) => m.Carrete));

// Script es un párrafo con `script: true` (ver editorSchema.ts), y una pregunta, uno con `question: true`
// (EditorComments.tsx). Cada ítem del selector pide las dos propiedades, así el selector distingue uno de
// otro y volver a párrafo saca la marca. El nombre ("Script", en castellano "Guion") es solo la etiqueta.
function scriptTypeItem(tr: Translate): BlockTypeSelectItem {
  return {
    name: tr('editor.script'),
    type: 'paragraph',
    props: { [SCRIPT_PROP]: true },
    icon: ScriptIcon as unknown as BlockTypeSelectItem['icon'],
  };
}

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
  // La estructura inicial (la semilla) se pone siempre que el editor quede editable, también sin datos de
  // permisos: queda solo en memoria hasta la primera edición. Si los permisos cambian, la página se vuelve
  // a abrir (así se siembra, o se descarta una semilla o una reparación hecha solo en memoria).
  const canSeed = perms.canSeed(pageId);
  // Con "Comment" (nivel 2) se comenta y se contesta aunque el editor quede en solo lectura (paso 10).
  const { canComment } = useCommentAccess(pageId);
  const [opening, setOpening] = useState<Opening>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const incomplete = opening.state === 'ready' && !opening.complete;
  const tr = useT();

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

  // Mientras falte contenido, se fija si ya llegó con cada sincronización y, además, cada segundo: la
  // bajada que empezó al abrir sigue después de los 4 s de espera y puede terminar entre dos ciclos (que
  // son cada 10 s). Recién entonces se reabre, para no mover la vista de quien está leyendo. Mientras
  // tanto el editor está en solo lectura, así que conviene que dure poco.
  useEffect(() => {
    if (!incomplete) return;
    let cancelled = false;
    const check = () =>
      void engine.isMissingContent(pageId).then((missing) => {
        if (!cancelled && !missing) setAttempt((n) => n + 1);
      });
    check();
    const timer = setInterval(check, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [engine, pageId, incomplete, status.lastSyncAt]);

  if (opening.state === 'loading') return <div className="editor-placeholder" />;
  if (opening.state === 'unsupported') return <UnsupportedPage />;
  return (
    <>
      {!opening.complete && (
        <p className="muted editor-missing">
          {status.online ? tr('editor.missingOnline') : tr('editor.missingOffline')}
        </p>
      )}
      {!canEdit && perms.known && (
        <p className="muted editor-missing">
          {canComment ? tr('editor.commentOnly') : tr('page.viewOnly')}
        </p>
      )}
      {/* Cambiar el idioma vuelve a abrir el editor (sus textos se eligen al crearlo); el documento es el mismo. */}
      <BlockEditor
        key={`${pageId}:${opening.complete}:${canEdit}:${tr.lang}`}
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
  const tr = useT();
  return (
    <div className="banner unsupported-page" role="status">
      <p>
        <strong>{tr('editor.unsupportedTitle')}</strong> {tr('editor.unsupported')}
      </p>
      <button className="link" onClick={() => window.location.reload()}>
        {tr('editor.updateApp')}
      </button>
    </div>
  );
}

/** Lo que se puede agregar hoy, para el aviso. */
function acceptedText(withMedia: boolean): string {
  return withMedia ? t('media.onlyPhotosVideos') : t('editor.onlyImages');
}

function BlockEditor({ doc, pageId, editable, canComment }: { doc: Y.Doc; pageId: string; editable: boolean; canComment: boolean }) {
  const { files, media, user } = useServices();
  const scheme = useScheme();
  const tr = useT();
  const editorRef = useRef<{ removeBlocks: (ids: string[]) => unknown } | null>(null);
  const [carrete, setCarrete] = useState<OpenCarrete | null>(null);
  // Con el editor ya abierto, el carrete se baja cuando el navegador está libre: tocar una foto no espera.
  useEffect(() => preloadWhenIdle(Carrete), []);
  /** El toque empezó sobre una foto que ya estaba elegida (ver `openCarrete`). */
  const pressedSelected = useRef(false);
  /** Con el mouse: el clic empezó sobre la foto ya elegida (o en solo lectura), así que la abre. */
  const mouseOpens = useRef(false);
  /** Con qué empezó el último clic o toque (`mouse`, `touch`, `pen`). */
  const pressKind = useRef('');
  /** El bloque de la última foto tocada (`null` si el último toque fue en otro lado; ver `notePress`). */
  const lastPress = useRef<string | null>(null);

  // Con portero, las fotos y los videos van al Drive del dueño (`sdmedia://`, primero en el dispositivo);
  // sin portero, las imágenes a Supabase como siempre (`sdfile://`).
  const store = (file: Blob & { name?: string }): Promise<string> => {
    if (media.enabled && isMediaFile(file)) return media.add(pageId, file);
    if (!isAllowedImage(file.type)) return Promise.reject(new FileRejected(acceptedText(media.enabled)));
    return files.add(pageId, file);
  };

  // Pegar un link de Drive ofrece dejarlo como link, como texto o como tarjeta (paso 13, drivePaste.ts).
  const drivePaste = useMemo(() => createDrivePaste(), []);

  const editor = useCreateBlockNote(
    withCollaboration({
      ...editorSchemaOptions,
      dictionary: editorDictionary(tr.lang),
      pasteHandler: drivePaste.pasteHandler,
      uploadFile: (file: File, blockId?: string) =>
        store(file).catch((err: unknown) => {
          notify(err instanceof FileRejected ? err.message : t('editor.fileNotSaved'));
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
      // Con la página: una foto de otro proyecto se ve con su marcador (papelera de archivos, paso 11).
      resolveFileUrl: (url: string) => (mediaIdOf(url) ? media.resolve(url, pageId) : files.resolve(url)),
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
                  ? t('editor.pastedEmbedded', { reason: err.message })
                  : t('editor.pastedNotSaved'),
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
        void media.resolve(MEDIA_SCHEME + id, pageId).then((src) => {
          for (const el of editor.domElement?.querySelectorAll<HTMLElement>('[data-content-type="image"]') ?? []) {
            if (mediaIdOf(el.getAttribute('data-url')) !== id) continue;
            const img = el.querySelector<HTMLImageElement>('img.bn-visual-media');
            if (img) img.src = src;
          }
        });
      }),
    [editor, media, pageId],
  );

  // El selector del bloque `image` ofrece videos solo si el workspace tiene portero.
  setVideosAccepted(media.enabled);

  const slashItems = useMemo(() => {
    // Los grupos del menú llevan el nombre del idioma del editor: Script y Question van con los básicos.
    const basic = editor.dictionary.slash_menu.paragraph.group;
    const headings = editor.dictionary.slash_menu.heading.group;
    const script: DefaultReactSuggestionItem = {
      title: tr('editor.script'),
      subtext: tr('editor.scriptHint'),
      aliases: ['guion', 'guión', 'screenplay', 'script', 'escena', 'scene'],
      group: basic,
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
    const at = items.findIndex((i) => i.group !== headings && i.group !== basic);
    // Script, Question y Paragraph se sacan la marca uno al otro (nunca Script y pregunta juntos).
    const variants = items.map((i) =>
      (i as { key?: string }).key === 'paragraph' || i.title === editor.dictionary.slash_menu.paragraph.title
        ? withParagraphVariants(i, editor, 'paragraph')
        : i,
    );
    const extra = [withParagraphVariants(script, editor, 'script'), questionSlashItem(editor, tr, basic)];
    return (query: string) =>
      Promise.resolve(filterSuggestionItems([...variants.slice(0, at), ...extra, ...variants.slice(at)], query));
  }, [editor, tr]);

  const toolbarItems = useMemo(
    () => paragraphVariantItems(blockTypeSelectItems(editor.dictionary), scriptTypeItem(tr), tr),
    [editor, tr],
  );

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

  // El carrete (paso 7): abre todas las fotos y videos de la página, empezando por el tocado
  // (Docs/Doc_Carrete.md, Docs/Doc_Imagenes.md). Con el mouse, el primer clic en una foto solo la elige (el
  // borde, los tiradores y su barra: ver, reemplazar, leyenda, nombre, bajar, borrar) y el segundo clic, o
  // un doble clic, la abre; con ⌘/Ctrl no abre (ese clic elige el bloque de afuera). En solo lectura, un
  // clic abre. Se decide al apretar (`notePress`), antes de que el editor elija la foto al soltar. Al
  // cerrar con Escape o el mouse, el foco vuelve al editor y la foto queda elegida. Los tiradores para
  // cambiar el tamaño y el de arrastrar el bloque son otros elementos: nunca abren el carrete. Con el dedo, al cerrar el foco no vuelve al editor
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
    pressKind.current = e.pointerType;
    mouseOpens.current =
      e.pointerType === 'mouse' &&
      !!target.closest?.('img.bn-visual-media') &&
      mousePressOpens({ editable, focused: editor.isFocused(), selectedId: selectedImageId(), targetId: blockIdOf(target) });
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

  /** La foto elegida en el editor (selección del bloque entero, no un texto), o `null`. */
  const selectedImageId = (): string | null => {
    const nodeSelected = editor.transact((tr) => 'node' in tr.selection);
    const block = editor.getTextCursorPosition().block;
    return nodeSelected && block.type === 'image' ? block.id : null;
  };

  const openCarrete = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.matches('img.bn-visual-media')) return;
    const opens = clickOpens({
      kind: pressKind.current,
      mouseOpens: mouseOpens.current,
      pressedSelected: pressedSelected.current,
      detail: e.detail,
      modifier: e.metaKey || e.ctrlKey,
    });
    if (opens) openAt(blockIdOf(target));
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

  // BlockNote usa la barra de formato como componente: tiene que ser siempre la misma función. Escrita en
  // línea, cada vez que la página se vuelve a dibujar (con cada cambio del estado de sincronización, 1,2 s
  // después de escribir o cada 10 s) la barra se desmontaba y se cerraba el menú que estuviera abierto
  // ("Turn into"). `openAt` cambia en cada dibujo: la barra usa siempre el último.
  const openAtRef = useRef(openAt);
  openAtRef.current = openAt;
  const formattingToolbar = useCallback(
    () => (
      <FormattingToolbar blockTypeSelectItems={toolbarItems}>
        {getFormattingToolbarItems(toolbarItems).flatMap((item) =>
          // Para las fotos y videos del Drive, "Download" baja el original (no la miniatura), y
          // "View" abre el carrete.
          item.key === 'fileDownloadButton'
            ? [
                <MediaViewButton key="mediaViewButton" onView={(id) => openAtRef.current(id)} />,
                <MediaDownloadButton key="fileDownloadButton" />,
                <ImageSizeButtons key="imageSizeButtons" />,
              ]
            : [item],
        )}
        {canComment && <CommentToolbarButton key="comment" />}
      </FormattingToolbar>
    ),
    [toolbarItems, canComment],
  );

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
        <FormattingToolbarController formattingToolbar={formattingToolbar} />
        <CommentSideMenuController canComment={canComment} />
      </BlockNoteView>
      <CommentMargin editor={editor} pageId={pageId} canComment={canComment} host={host} />
      {/* Dónde empieza cada hoja (solo una capa encima; roadmap B.7). */}
      <SheetBreaks pageId={pageId} host={host} />
      {editable && <DrivePasteMenu paste={drivePaste} editor={editor} />}
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
  return (
    <Part onClose={props.onClose}>
      <Carrete {...props} online={online} />
    </Part>
  );
}

function flatten(blocks: Block[]): Block[] {
  return blocks.flatMap((b) => [b, ...flatten(b.children as Block[])]);
}
