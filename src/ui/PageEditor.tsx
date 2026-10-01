import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu, type Block } from '@blocknote/core';
import '@blocknote/core/fonts/inter.css';
import { withCollaboration } from '@blocknote/core/yjs';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import {
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from '@blocknote/react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import type * as Y from 'yjs';
import { localize, t, useT } from '../i18n';
import '../i18n/lazy/editor';
import '../i18n/lazy/folders';
import { usePermissions, useServices, useSyncStatus } from '../services';
import { FileRejected, isAllowedImage } from '../sync/files';
import { isMediaFile, MEDIA_SCHEME, mediaIdOf } from '../media/queue';
import { collectCarrete, inlinePhotosOf, parsePhotoKey, photoKeyOf, photoPropsIn, startIndex, type BlockLike, type CarreteItem } from './carreteModel';
import { createCarreteLoader, type CarreteLoader } from './carreteLoader';
import { porteroDownload, sharpenImages } from './sharpImages';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { editorSchemaOptions, SCRIPT_PROP, setVideosAccepted } from './editorSchema';
import { dropTarget, insertFiles, isEmptyParagraph, isFilesTransfer, takeFiles, type FileEditor, type InsertAt } from './fileDrop';
import { addFiles, dropPos, inlinePhotoSpotsExtension, pickFiles, type AddFilesOptions, type PhotoEditor } from './inlinePhotoCreate';
import { readFolder, summarize, takeDrop, type FolderSource } from '../media/folderRead';
import { FolderAskDialog, FolderProgressDialog } from './FolderDialog';
import { FolderViewer } from './FolderViewer';
import { renameConvertedHeic } from './heicNames';
import { isAttachment, markAttachments } from './attachments';
import { openAttachmentNow, prepareAttachment } from './attachmentOpen';
import { AttachmentSheet } from './AttachmentSheet';
import { editorDictionary } from './editorLocale';
import { findUnknownContent } from './unknownContent';
import { editorLinkClick, followInternalLink } from './internalLinks';
import { redrawFromYjs } from './editorRecovery';
import {
  CommentMargin,
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
import type { HeadingRecord } from './collapse';
import { collapseExtension, collapseSupported, headingBackspaceExtension, headingCounts, revealBlock, setAllCollapsed } from './collapseEditor';
import { setCollapseControl } from './collapseControl';
import { collapseSaver, loadCollapse } from './collapseStore';
import { CollapseToggles } from './CollapseToggles';
import { BlockSideMenuController } from './BlockSideMenu';
import { PageFormattingToolbar, PageFormattingToolbarController, pageToolbarItems } from './PageToolbar';
import { PhotoToolbarController } from './PhotoToolbar';
import { MediaActionsContext, type MediaActions } from './MediaBar';
import { undoGuardExtension } from './undoGuard';
import { BACKGROUND_META } from './editorMeta';
import { notToggleHeading } from './collapseMenus';
import { clickOpens, mousePressOpens, shiftSelects } from './carreteClick';
import { FindBar, type FindEditor } from './FindBar';
import { findExtension } from './findEditor';
import { inlinePhotoExtensions, selectedPhotoKey, spacePhotoKey } from './inlinePhotoEditor';
import { closeFindBar, isFindShortcut, openFindBar, openFindBarAt, takesFindShortcut } from './findUi';
import { searchSession } from './projectSearchUi';

// El carrete se baja aparte, la primera vez que se abre (roadmap B.4).
const Carrete = lazyPart(() => import('./Carrete').then((m) => m.Carrete));

type Opening =
  | { state: 'loading' }
  | { state: 'ready'; doc: Y.Doc; complete: boolean; collapse: Map<string, HeadingRecord> }
  /** La página trae algo que esta versión del editor no conoce: abrirla lo borraría. */
  | { state: 'unsupported'; what: string };

/** En pantallas táctiles no se lleva el foco a la barra al ir a un resultado: el teclado taparía la página. */
const coarsePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export function PageEditor({ pageId }: { pageId: string }) {
  const services = useServices();
  const { docs, engine, db } = services;
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
  // El editor que usa la barra de buscar (Docs/Doc_Buscar.md). La barra y lo buscado viven acá, arriba del
  // editor: el editor se vuelve a montar (al terminar de bajar, al cambiar el permiso o el idioma) y la
  // búsqueda sigue.
  const [findEditor, setFindEditor] = useState<FindEditor | null>(null);
  // Se suma si el editor no se pudo volver a dibujar después de un error (editorRecovery.ts): se monta de nuevo.
  const [remounts, setRemounts] = useState(0);
  const remount = useCallback(() => setRemounts((n) => n + 1), []);

  // Ctrl/⌘+F abre la barra de la app; con el foco en la barra, se deja pasar al navegador (la segunda vez).
  // Solo con el documento abierto: mientras carga (o si no se puede mostrar) queda la del navegador.
  const ready = opening.state === 'ready';
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || !isFindShortcut(e) || !takesFindShortcut(e.target)) return;
      e.preventDefault();
      openFindBar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ready]);
  // Al salir de la página, la barra se cierra (lo buscado queda para la próxima).
  useEffect(() => () => closeFindBar(), []);

  // Ir a un resultado de la búsqueda del proyecto (Docs/Doc_Buscar.md, sección 8, y corrección 6): el pedido se
  // toma cuando el editor de esta página está listo, o enseguida si ya lo estaba (un resultado de la misma
  // página: la dirección no cambia). Abre la barra con la palabra que coincidió, en esa coincidencia; un
  // resultado del título, la página arriba y sin barra.
  const search = searchSession(services);
  useEffect(() => {
    if (!findEditor) return;
    const take = () => {
      const request = search.takeRequest(pageId);
      if (!request) return;
      if (request.term) {
        const target = request.blockId ? { pageId, blockId: request.blockId, occurrence: request.occurrence ?? 0 } : null;
        openFindBarAt(request.term, target, { focus: !coarsePointer() });
      } else {
        closeFindBar();
        findEditor.prosemirrorView?.dom.closest('.main')?.scrollTo?.({ top: 0, left: 0 });
      }
    };
    take();
    return search.subscribe(take);
  }, [findEditor, pageId, search]);

  // Si el servidor tiene contenido de esta página que el dispositivo todavía no bajó, se muestra lo que
  // hay en solo lectura: editar sobre un documento a medio bajar arma una estructura paralela. Cuando
  // llega lo que falta, se vuelve a abrir para editar.
  useEffect(() => {
    let cancelled = false;
    let opened = false;
    void engine.prefetchPage(pageId).then(async (complete) => {
      if (cancelled) return;
      // Lo colapsado para vos (P.11) se lee junto con la página: el editor se crea ya colapsado.
      const [doc, collapse] = await Promise.all([docs.open(pageId, { seed: complete && canSeed }), loadCollapse(db, pageId)]);
      opened = true;
      if (cancelled) return docs.close(pageId);
      const unknown = findUnknownContent(doc);
      if (unknown) setOpening({ state: 'unsupported', what: unknown });
      else setOpening({ state: 'ready', doc, complete, collapse });
    });
    return () => {
      cancelled = true;
      if (opened) docs.close(pageId);
      setOpening({ state: 'loading' });
    };
  }, [docs, engine, db, pageId, attempt, canSeed]);

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

  // La barra sigue montada mientras el editor se vuelve a abrir (terminó de bajar, cambió el permiso): no se
  // pierde el aviso del último reemplazo ni se vuelve a montar.
  if (opening.state === 'loading') {
    return (
      <>
        <FindBar editor={null} editable={false} pageId={pageId} />
        <div className="editor-placeholder" />
      </>
    );
  }
  if (opening.state === 'unsupported') return <UnsupportedPage />;
  return (
    <>
      <FindBar editor={findEditor} editable={opening.complete && canEdit} complete={opening.complete} pageId={pageId} />
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
        key={`${pageId}:${opening.complete}:${canEdit}:${tr.lang}:${remounts}`}
        doc={opening.doc}
        collapse={opening.collapse}
        pageId={pageId}
        editable={opening.complete && canEdit}
        canComment={canComment}
        onEditor={setFindEditor}
        onBroken={remount}
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

/** Sin portero solo se guardan imágenes (a Supabase): para cualquier otro archivo hace falta el Drive. */
function acceptedText(): string {
  return t('editor.attachNeedsDrive');
}

function BlockEditor({
  doc,
  collapse,
  pageId,
  editable,
  canComment,
  onEditor,
  onBroken,
}: {
  doc: Y.Doc;
  /** Lo colapsado para vos (P.11): se actualiza en el lugar, así un editor que se vuelve a crear lo conserva. */
  collapse: Map<string, HeadingRecord>;
  pageId: string;
  editable: boolean;
  canComment: boolean;
  onEditor?: (editor: FindEditor | null) => void;
  /** El editor no se pudo volver a dibujar después de un error: hay que montarlo de nuevo. */
  onBroken?: () => void;
}) {
  const { docs, files, media, user, db, folders } = useServices();
  const scheme = useScheme();
  const tr = useT();
  const editorRef = useRef<{ removeBlocks: (ids: string[]) => unknown; transact: (fn: (tr: { setMeta: (k: string, v: unknown) => unknown }) => void) => void } | null>(null);
  /** Si la página se puede editar ahora (lo leen las funciones que el editor guarda al crearse). */
  const editableRef = useRef(editable);
  const [carrete, setCarrete] = useState<OpenCarrete | null>(null);
  /** El adjunto con su hoja abierta (Docs/Doc_Adjuntos.md). */
  const [sheet, setSheet] = useState<string | null>(null);
  /** Carpetas soltadas que esperan "Subir" (P.9, Docs/Doc_Carpetas.md), dónde se soltaron. */
  const [folderAsk, setFolderAsk] = useState<{ sources: FolderSource[]; at: InsertAt | null } | null>(null);
  /** La carpeta abierta en el visor, y la que muestra cómo va su subida. */
  const [folderView, setFolderView] = useState<{ id: string; name: string } | null>(null);
  const [folderUpload, setFolderUpload] = useState<string | null>(null);
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

  // Con portero, cualquier archivo va al Drive del dueño (`sdmedia://`, primero en el dispositivo): fotos,
  // videos y adjuntos (Docs/Doc_Adjuntos.md). Sin portero, las imágenes a Supabase como siempre (`sdfile://`).
  const store = (file: Blob & { name?: string }): Promise<string> => {
    if (media.enabled) return media.add(pageId, file);
    if (!isAllowedImage(file.type)) return Promise.reject(new FileRejected(acceptedText()));
    return files.add(pageId, file);
  };
  // Una imagen embebida en HTML pegado (`data:`): solo fotos y videos, nunca un adjunto (un SVG pegado no se
  // vuelve una tarjeta).
  const storeEmbedded = (blob: Blob): Promise<string> => {
    if (media.enabled && isMediaFile(blob)) return media.add(pageId, blob);
    if (!isAllowedImage(blob.type)) return Promise.reject(new FileRejected(t(media.enabled ? 'editor.embeddedOnlyMedia' : 'editor.onlyImages')));
    return files.add(pageId, blob);
  };

  // Pegar, soltar o elegir archivos (inlinePhotoCreate.ts): qué va en el renglón, cómo se guarda y dónde van los
  // adjuntos. Sin portero, solo imágenes (a Supabase); con portero, fotos y videos en el renglón y lo demás como
  // tarjeta.
  const fileOptions = (target: FileEditor): AddFilesOptions => ({
    isInline: (file) => (media.enabled ? isMediaFile(file) : isAllowedImage(file.type)),
    store: (file) =>
      store(file).catch((err: unknown) => {
        notify(err instanceof FileRejected ? err.message : t('editor.fileNotSaved'));
        throw err;
      }),
    insertAttachments: (list, at) => void insertFiles(target, list, at),
  });

  // Los eventos de soltar ya procesados (el menú lateral del editor reenvía el mismo al soltar cerca).
  const handledDrops = useMemo(() => new WeakSet<DataTransfer>(), []);

  // Pegar un link de Drive ofrece dejarlo como link, como texto o como tarjeta (paso 13, drivePaste.ts).
  const drivePaste = useMemo(() => createDrivePaste(), []);

  // Lo colapsado para vos (P.11, Docs/Doc_Colapsar.md): se guarda en la base local con una pausa, y lo que
  // falte se escribe al cerrar la página.
  const collapseSave = useMemo(() => collapseSaver(db, pageId), [db, pageId]);
  // Un navegador sin `:has()` no puede esconder: sin colapsar (collapseEditor.ts, `collapseSupported`).
  const canCollapse = useMemo(collapseSupported, []);
  useEffect(() => {
    // Lo pendiente se escribe al cerrar la página, y también si se va la pestaña o la app queda de fondo (el
    // teléfono puede cerrarla sin avisar).
    const flush = () => void collapseSave.flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [collapseSave]);

  const editor = useCreateBlockNote(
    withCollaboration({
      ...editorSchemaOptions,
      dictionary: editorDictionary(tr.lang),
      // Un link a otra página de la app la abre en esta pestaña (internalLinks.ts).
      links: { onClick: (event) => editorLinkClick(event) },
      // Pegar archivos: las fotos y los videos en el renglón, donde está el cursor (fotos en línea,
      // inlinePhotoCreate.ts); con portero, cualquier otro archivo, un bloque debajo (fileDrop.ts).
      pasteHandler: (ctx) => {
        const dt = ctx.event.clipboardData;
        if (!isFilesTransfer(dt)) return drivePaste.pasteHandler(ctx);
        const { files: taken, folders } = takeFiles(dt!);
        if (folders > 0) notify(t('editor.foldersNotSupported'));
        void addFiles(ctx.editor as unknown as PhotoEditor, taken, null, fileOptions(ctx.editor as unknown as FileEditor));
        return true;
      },
      uploadFile: (file: File, blockId?: string) =>
        store(file).catch((err: unknown) => {
          notify(err instanceof FileRejected ? err.message : t('editor.fileNotSaved'));
          // El editor ya insertó el bloque de la imagen: se quita para que no quede vacío.
          if (blockId) {
            setTimeout(() => {
              try {
                const current = editorRef.current;
                current?.transact((tr) => {
                  tr.setMeta(BACKGROUND_META, true);
                  current.removeBlocks([blockId]);
                });
              } catch {
                // El bloque ya no está.
              }
            });
          }
          throw err;
        }),
      // Con la página: una foto de otro proyecto se ve con su marcador (papelera de archivos, paso 11).
      // Un adjunto (Docs/Doc_Adjuntos.md) se ve como tarjeta: su imagen lleva la clase `sd-attachment` (el CSS
      // le da tamaño fijo). Se pone en la imagen, adentro de la vista de BlockNote, que ProseMirror no mira.
      resolveFileUrl: (url: string) => {
        const id = mediaIdOf(url);
        if (!id) return files.resolve(url);
        return media.resolve(url, pageId).then((src) => {
          setTimeout(() => {
            markAttachments(editorRef.current as never, id, media);
            // Una foto que se agregó como HEIC y ya es un JPEG: el bloque pasa a decir `.jpg` (heicNames.ts).
            if (editableRef.current) renameConvertedHeic(editorRef.current as never, media, id);
          });
          return src;
        });
      },
      collaboration: {
        fragment: doc.getXmlFragment(CONTENT_FRAGMENT),
        user: { name: user.email, color: '#2383e2' },
      },
      // Buscar y reemplazar en la página (findEditor.ts) y colapsar secciones (collapseEditor.ts): las dos con
      // decoraciones, sin tocar el documento. Colapsar, solo si el navegador puede esconder (`:has()`).
      extensions: [
        // Las fotos en línea (Docs/Doc_Fotos_En_Linea.md): sus filas, la marca de la selección y su teclado.
        ...inlinePhotoExtensions,
        // El lugar (y la marca de espera) de las fotos que se están guardando (inlinePhotoCreate.ts).
        inlinePhotoSpotsExtension,
        findExtension,
        // Cada borrado es un solo Ctrl+Z, y el deshacer del navegador nunca edita la página (undoGuard.ts).
        undoGuardExtension(),
        // Retroceso al principio de un título "sube la línea", en todos los navegadores (también sin colapsar).
        headingBackspaceExtension,
        ...(canCollapse
          ? [
              collapseExtension({
                initial: collapse,
                save: (records: ReadonlyMap<string, HeadingRecord>) => {
                  collapse.clear();
                  for (const [id, r] of records) collapse.set(id, r);
                  collapseSave.save(records);
                },
              }),
            ]
          : []),
      ],
    }),
    [doc],
  );

  // El menú de la página ("Colapsar todo / Abrir todo") y "Ir al bloque" de los comentarios llegan acá.
  useEffect(() => {
    if (!canCollapse) return;
    return setCollapseControl({
      pageId,
      counts: () => headingCounts(editor.prosemirrorState),
      setAll: (collapsed) => {
        const view = editor.prosemirrorView;
        if (view) setAllCollapsed(view, collapsed);
      },
      reveal: (blockId) => {
        const view = editor.prosemirrorView;
        return view ? revealBlock(view, blockId) : false;
      },
    });
  }, [editor, pageId, canCollapse]);

  editorRef.current = editor as unknown as NonNullable<typeof editorRef.current>;
  editableRef.current = editable;

  // Un cambio de otro dispositivo que el editor no pudo dibujar (docs.ts, `subscribeRenderFailed`): se vuelve
  // a dibujar todo desde el documento en el momento, antes de la próxima tecla. Si ni eso anda, el editor
  // queda en solo lectura y se monta de nuevo.
  useEffect(
    () =>
      docs.subscribeRenderFailed((id) => {
        if (id === pageId && !redrawFromYjs(editor as never)) onBroken?.();
      }),
    [docs, editor, pageId, onBroken],
  );

  // La barra de buscar (arriba, en PageEditor) usa este editor mientras esté montado.
  useEffect(() => {
    onEditor?.(editor as unknown as FindEditor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

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
            .then((blob) => storeEmbedded(blob))
            .then((stored) => {
              // Un cambio de la app, no de la persona: no abre una sección colapsada (Doc_Colapsar.md).
              if (editor.getBlock(block.id)) {
                editor.transact((tr) => {
                  tr.setMeta(BACKGROUND_META, true);
                  editor.updateBlock(block.id, { props: { url: stored } } as never);
                });
              }
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
    // Los bloques `image` y las fotos en línea del texto de cada bloque.
    const collect = (blocks: Block[]) =>
      flatten(blocks).flatMap((b) => {
        const urls = b.type === 'image' ? [(b.props as { url?: string }).url] : inlinePhotosOf(b.content).map((p) => p.url as string);
        return urls.flatMap((url) => mediaIdOf(url) ?? []);
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
          // Los bloques `image` y las fotos en línea (`.sd-photo`, con la misma `data-url`).
          for (const el of editor.domElement?.querySelectorAll<HTMLElement>('[data-content-type="image"], .sd-photo[data-url]') ?? []) {
            if (mediaIdOf(el.getAttribute('data-url')) !== id) continue;
            const img = el.querySelector<HTMLImageElement>(el.classList.contains('sd-photo') ? ':scope > img.bn-visual-media' : 'img.bn-visual-media');
            if (img) img.src = src;
          }
          // Llegó lo que faltaba saber de un archivo: si es un adjunto, su tarjeta con tamaño fijo.
          markAttachments(editor as never, id, media);
          // Un HEIC que se acaba de pasar a JPEG: el bloque pasa a decir `.jpg`.
          if (editableRef.current) renameConvertedHeic(editor as never, media, id);
        });
      }),
    [editor, media, pageId],
  );

  // Fotos nítidas (Docs/Doc_Imagenes.md, "Calidad en la página"): una foto que se ve más grande que su
  // miniatura pasa a una imagen de hasta 2048 px hecha en este dispositivo, del original local o bajado una vez
  // con un pase del portero. Solo en pantalla: el documento no cambia.
  useEffect(() => {
    let stop: (() => void) | null = null;
    const start = () => {
      stop?.();
      const root = editor.domElement;
      stop = root ? sharpenImages(root, media, { download: porteroDownload(media) }) : null;
    };
    if (editor.domElement) start();
    const offMount = editor.onMount(start);
    const offUnmount = editor.onUnmount(() => {
      stop?.();
      stop = null;
    });
    return () => {
      offMount();
      offUnmount();
      stop?.();
    };
  }, [editor, media]);

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
    // Sin los "encabezados plegables" de BlockNote: todos los títulos se colapsan (P.11, Doc_Colapsar.md).
    const items = getDefaultReactSlashMenuItems(editor)
      .filter(notToggleHeading)
      .map((item) =>
      (item as { key?: string }).key === 'paragraph' || item.title === editor.dictionary.slash_menu.paragraph.title
        ? {
            ...item,
            onItemClick: () =>
              insertOrUpdateBlockForSlashMenu(editor, { type: 'paragraph', props: { [SCRIPT_PROP]: false } }),
          }
        : (item as { key?: string }).key === 'image'
          ? {
              ...item,
              // "/Image": el selector de archivos del sistema; lo elegido entra en el renglón, donde estaba el cursor
              // (fotos en línea, inlinePhotoCreate.ts). Con portero, también videos y adjuntos (estos, como tarjeta).
              subtext: tr('editor.imageHint'),
              onItemClick: () =>
                pickFiles(
                  editor as unknown as PhotoEditor,
                  media.enabled ? 'image/*,video/*,*/*' : 'image/*',
                  fileOptions(editor as unknown as FileEditor),
                ),
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
  }, [editor, tr, media]);

  const toolbarItems = useMemo(
    () => pageToolbarItems(editor.dictionary, tr),
    [editor, tr],
  );

  // Comentarios (paso 10): el panel sabe qué dice cada bloque; el margen se dibuja sobre el editor.
  useBlockSourceRegistration(editor, pageId);
  const host = useRef<HTMLDivElement>(null);

  // Sin portero, pegar o soltar un archivo que no es una imagen haría que el editor intente crear un bloque
  // que no existe en el esquema: se corta antes, con un aviso.
  const rejectOtherFiles = (e: ClipboardEvent | DragEvent, data: DataTransfer | null) => {
    if (media.enabled) return;
    const list = Array.from(data?.files ?? []);
    if (list.length === 0 || list.every((f) => isAllowedImage(f.type))) return;
    e.preventDefault();
    e.stopPropagation();
    notify(acceptedText());
  };

  // Soltar archivos en la página: las fotos y los videos en el renglón, entre las letras donde se soltaron (o en un
  // renglón nuevo al lado del bloque, si ahí no pueden ir); con portero, los demás archivos como bloques, en orden,
  // donde se soltaron (fileDrop.ts).
  const dropFiles = (e: React.DragEvent) => {
    const dt = e.nativeEvent.dataTransfer;
    if (!media.enabled) {
      rejectOtherFiles(e.nativeEvent, dt);
      if (e.nativeEvent.defaultPrevented) return;
    }
    const root = editor.domElement;
    if (!editable || !dt || !isFilesTransfer(dt) || handledDrops.has(dt) || !root?.contains(e.target as Node)) return;
    handledDrops.add(dt);
    e.preventDefault();
    e.stopPropagation();
    const { files: taken, folders: dirs, supported } = takeDrop(dt);
    let at: InsertAt | null = dropTarget(root, e.clientX, e.clientY);
    // Los archivos sueltos van primero (las fotos y videos al renglón, los adjuntos como bloques); las carpetas del
    // mismo soltar, después de los adjuntos (el párrafo vacío donde se soltó ya no está).
    if (taken.length > 0) {
      void addFiles(
        editor as unknown as PhotoEditor,
        taken,
        { pos: dropPos(editor.prosemirrorView, e.clientX, e.clientY), block: at },
        {
          ...fileOptions(editor as unknown as FileEditor),
          insertAttachments: (list, where) =>
            void insertFiles(editor as unknown as FileEditor, list, where, (ids) => {
              const last = ids[ids.length - 1];
              if (last) at = { blockId: last, placement: 'after' };
            }),
        },
      );
    }
    if (dirs.length === 0) return;
    // Sin forma de leer carpetas (P.9): se sigue pidiendo comprimirlas.
    if (!supported || !folders) return notify(t('editor.foldersNotSupported'));
    void Promise.all(dirs.map((d) => readFolder(d)))
      .then((sources) => {
        // Soltada sobre la tarjeta de una carpeta que quedó a medias (se cerró la pestaña): se retoma.
        const target = at ? folderIn(at.blockId) : null;
        if (target && sources.length === 1 && folders.progress(target.id)?.state === 'missing') {
          const found = folders.resumeWith(target.id, sources[0]!);
          notify(found > 0 ? t('folders.matched', { count: found }) : t('folders.noMatch'));
          return;
        }
        setFolderAsk({ sources, at });
      })
      .catch(() => notify(t('editor.fileNotSaved')));
  };

  /** Sube las carpetas confirmadas: registra cada una, pone su bloque donde se soltó y empieza a subir. */
  const uploadFolders = async (sources: FolderSource[], at: InsertAt | null) => {
    setFolderAsk(null);
    // Si el bloque donde se soltó ya no está (otro dispositivo lo borró mientras se confirmaba), después del cursor.
    let ref = at && editor.getBlock(at.blockId) ? at : { blockId: editor.getTextCursorPosition().block.id, placement: 'after' as const };
    for (const source of sources) {
      try {
        const { id, url } = await media.addFolder(pageId, source.name, summarize(source).bytes);
        const refBlock = editor.getBlock(ref.blockId);
        const [block] = editor.insertBlocks([{ type: 'image', props: { url, name: source.name } }] as never, ref.blockId, ref.placement);
        // Como al soltar archivos: un párrafo vacío donde se soltó se reemplaza.
        if (isEmptyParagraph(refBlock as never)) {
          try {
            editor.removeBlocks([ref.blockId]);
          } catch {
            // Ya no estaba.
          }
        }
        if (block) ref = { blockId: block.id, placement: 'after' };
        await folders?.start(id, pageId, source);
        if (sources.length === 1) setFolderUpload(id);
      } catch (err) {
        notify(t('folders.notSaved', { reason: localizeError(err) }));
      }
    }
  };

  /** La carpeta (P.9) de un bloque `image`, o `null`. */
  const folderIn = (blockId: string): { id: string; name: string } | null => {
    const block = editor.getBlock(blockId) as BlockLike | undefined;
    if (block?.type !== 'image') return null;
    const props = (block.props ?? {}) as { url?: string; name?: string };
    const id = mediaIdOf(props.url);
    return id && media.isFolder(id) ? { id, name: typeof props.name === 'string' ? props.name : '' } : null;
  };

  /** Abre una carpeta: cómo va su subida si se está subiendo desde acá, o el visor. */
  const openFolder = (folder: { id: string; name: string }) => {
    const p = folders?.progress(folder.id);
    if (p && p.state !== 'done') setFolderUpload(folder.id);
    else setFolderView(folder);
  };

  // Un archivo soltado afuera del editor (o en solo lectura) no abre el archivo en la pestaña en lugar de la app.
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', guard);
    window.addEventListener('drop', guard);
    return () => {
      window.removeEventListener('dragover', guard);
      window.removeEventListener('drop', guard);
    };
  }, []);

  // El carrete (paso 7): abre todas las fotos y videos de la página, empezando por el tocado
  // (Docs/Doc_Carrete.md, Docs/Doc_Imagenes.md). Con el mouse, el primer clic en una foto solo la elige (el
  // borde, los tiradores y su barra: ver, reemplazar, leyenda, nombre, bajar, borrar) y el segundo clic, o
  // un doble clic, la abre; con ⌘/Ctrl no abre (ese clic elige el bloque de afuera). En solo lectura, un
  // clic abre. Se decide al apretar (`notePress`), antes de que el editor elija la foto al soltar. Al
  // cerrar con Escape o el mouse, el foco vuelve al editor y la foto queda elegida. Los tiradores para
  // cambiar el tamaño y el de arrastrar el bloque son otros elementos: nunca abren el carrete. Con el dedo,
  // al cerrar el foco no vuelve al editor (abriría el teclado); para editar, se toca otra vez la foto: si está elegida y el editor tiene el foco,
  // o el toque anterior fue en esa misma foto (sin tocar otra cosa en el medio), ese toque muestra la barra
  // en vez de abrir el carrete. Con el teclado: la barra espaciadora sobre la foto elegida, o "View".
  // Una foto en línea (Docs/Doc_Fotos_En_Linea.md) se comporta igual; como dos de un mismo párrafo comparten el
  // id del bloque, cada foto se identifica por su clave (`photoKeyOf`: el bloque más su lugar).
  useEffect(() => {
    // En burbuja: corre después de `notePress`. Lo que se toca adentro del carrete no cuenta.
    const onDown = (e: globalThis.PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.('.carrete')) return;
      lastPress.current = target?.closest?.('img.bn-visual-media') ? photoKeyOf(target) : null;
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  const notePress = (e: PointerEvent) => {
    const target = e.target as HTMLElement;
    // Sobre un adjunto, se prepara ya la dirección para abrirlo o bajarlo (el clic la usa en el acto).
    const pressed = target.closest?.('img.bn-visual-media') ? photoKeyOf(target) : null;
    const attachment = pressed ? attachmentOf(pressed) : null;
    if (attachment) void prepareAttachment(media, attachment);
    pressKind.current = e.pointerType;
    mouseOpens.current =
      e.pointerType === 'mouse' &&
      !!target.closest?.('img.bn-visual-media') &&
      // Shift+clic en una foto en línea elige texto hasta ella (inlinePhotoEditor.ts): no abre.
      !shiftSelects({ editable, shiftKey: e.shiftKey, inlinePhoto: !!target.closest?.('.sd-photo') }) &&
      mousePressOpens({ editable, focused: editor.isFocused(), selectedId: selectedKey(), targetId: photoKeyOf(target) });
    pressedSelected.current =
      editable &&
      e.pointerType !== 'mouse' &&
      !!target.closest?.('img.bn-visual-media') &&
      !!target.closest('.ProseMirror-selectednode') &&
      (editor.isFocused() || lastPress.current === photoKeyOf(target));
  };

  /** `key`: la foto (`photoKeyOf`), o el id de un bloque `image` (la barra de la foto: "View"). */
  const openAt = (key: string | null, kind = pressKind.current) => {
    // Una carpeta (P.9) abre su visor (o cómo va su subida).
    const folder = key ? folderIn(parsePhotoKey(key).blockId) : null;
    if (folder) {
      openFolder(folder);
      return true;
    }
    // Un adjunto se abre o se baja (con el mouse, en el acto si ya está preparado; si no, o con el dedo, su hoja).
    const attachment = key ? attachmentOf(key) : null;
    if (attachment) {
      // Con el mouse o el teclado (un gesto del usuario), en el acto si ya está preparado.
      const direct = kind === 'mouse' || kind === 'keyboard';
      if (!direct || !openAttachmentNow(media, attachment)) setSheet(attachment);
      return true;
    }
    const items = collectCarrete(editor.document as unknown as BlockLike[], (id, name) => isAttachment(media, id, name));
    const start = startIndex(items, key);
    if (start < 0) return false;
    setCarrete({ items, start, loader: createCarreteLoader({ media, files }) });
    return true;
  };

  /** El archivo de una foto (su clave) si es un adjunto (no una foto ni un video), o `null`. */
  const attachmentOf = (key: string): string | null => {
    const props = photoPropsIn(editor.getBlock(parsePhotoKey(key).blockId) as BlockLike | undefined, key);
    const id = props ? mediaIdOf(props.url as string | undefined) : null;
    // Una carpeta no es un adjunto que se abre o se baja con un pase: tiene su visor.
    if (id && media.isFolder(id)) return null;
    return id && isAttachment(media, id, typeof props?.name === 'string' ? props.name : '') ? id : null;
  };

  /**
   * La foto elegida en el editor (selección de la foto misma, no un texto), o `null`: su clave. No el bloque de
   * afuera, que se elige con ⌘/Ctrl+clic o al arrastrar el bloque.
   */
  const selectedKey = (): string | null => {
    const view = editor.prosemirrorView;
    return view ? selectedPhotoKey(view.state) : null;
  };

  const openCarrete = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.matches('img.bn-visual-media')) return;
    const opens = clickOpens({
      kind: pressKind.current,
      mouseOpens: mouseOpens.current,
      pressedSelected: pressedSelected.current,
      detail: e.detail,
      modifier: e.metaKey || e.ctrlKey || shiftSelects({ editable, shiftKey: e.shiftKey, inlinePhoto: !!target.closest('.sd-photo') }),
    });
    // El próximo clic sin `pointerdown` (uno sintético) no usa lo de este.
    const kind = pressKind.current;
    pressKind.current = '';
    if (opens) openAt(photoKeyOf(target), kind);
  };

  // La barra espaciadora con una foto elegida la abre (como la vista rápida de la Mac). Con una foto-bloque
  // elegida la barra no escribe nada, y Enter sigue creando un párrafo debajo. Con una foto en línea elegida,
  // también abre; Enter y las letras pasan el cursor a la derecha de la foto y siguen (inlinePhotoEditor.ts).
  const openWithKeyboard = (e: KeyboardEvent) => {
    if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !editor.isFocused()) return;
    // Con varias fotos en línea elegidas, en la primera (y la barra espaciadora no las reemplaza).
    const view = editor.prosemirrorView;
    const key = view ? spacePhotoKey(view.state) : null;
    if (!key) return;
    if (openAt(key, 'keyboard')) {
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
    () => <PageFormattingToolbar items={toolbarItems} canComment={canComment} />,
    [toolbarItems, canComment],
  );
  // Lo que usan las barras de las fotos (MediaBar.tsx, PhotoToolbar.tsx): guardar al reemplazar, qué acepta el
  // selector, comentar y abrir el carrete (siempre con el último `openAt`).
  const mediaActions = useMemo<MediaActions>(
    () => ({
      store: (file) => fileOptions(editor as unknown as FileEditor).store(file),
      accept: {
        inline: media.enabled ? 'image/*,video/*' : 'image/*',
        block: media.enabled ? 'image/*,video/*,*/*' : 'image/*',
      },
      canComment,
      onView: (key) => void openAtRef.current(key),
    }),
    [editor, media, canComment],
  );

  return (
    <div
      ref={host}
      className="editor-host"
      onPasteCapture={(e) => rejectOtherFiles(e.nativeEvent, e.clipboardData)}
      onDropCapture={dropFiles}
      onPointerDownCapture={notePress}
      onKeyDownCapture={openWithKeyboard}
      onClickCapture={(e) => !editable && followInternalLink(e.nativeEvent)}
      onClick={openCarrete}
    >
      <MediaActionsContext.Provider value={mediaActions}>
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
        <PageFormattingToolbarController formattingToolbar={formattingToolbar} />
        {/* La barra de la foto en línea elegida (PhotoToolbar.tsx). */}
        {editable && <PhotoToolbarController />}
        {/* Los tres puntos de cada bloque: arrastrar lo mueve, un clic lo elige y abre la barra de formato. */}
        <BlockSideMenuController />
      </BlockNoteView>
      </MediaActionsContext.Provider>
      <CommentMargin editor={editor} pageId={pageId} canComment={canComment} host={host} />
      {/* El triángulo de cada título (P.11): una capa encima, como el margen. */}
      {canCollapse && <CollapseToggles editor={editor} host={host} editable={editable} />}
      {/* Dónde empieza cada hoja (solo una capa encima; roadmap B.7). */}
      <SheetBreaks pageId={pageId} host={host} />
      {editable && <DrivePasteMenu paste={drivePaste} editor={editor} />}
      {carrete && <CarreteHost {...carrete} onClose={() => setCarrete(null)} />}
      {sheet && <AttachmentSheet fileId={sheet} onClose={() => setSheet(null)} />}
      {folderAsk && (
        <FolderAskDialog sources={folderAsk.sources} onCancel={() => setFolderAsk(null)} onConfirm={(sources) => void uploadFolders(sources, folderAsk.at)} />
      )}
      {folderUpload && (
        <FolderProgressDialog
          id={folderUpload}
          onClose={() => setFolderUpload(null)}
          onOpen={() => {
            const block = folderUpload;
            setFolderUpload(null);
            setFolderView({ id: block, name: folders?.progress(block)?.name ?? '' });
          }}
        />
      )}
      {folderView && (
        <FolderViewer
          fileId={folderView.id}
          name={folderView.name}
          onClose={() => setFolderView(null)}
          onShowUpload={() => {
            setFolderUpload(folderView.id);
            setFolderView(null);
          }}
        />
      )}
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

function localizeError(err: unknown): string {
  return localize(err instanceof Error ? err.message : String(err));
}

function flatten(blocks: Block[]): Block[] {
  return blocks.flatMap((b) => [b, ...flatten(b.children as Block[])]);
}
