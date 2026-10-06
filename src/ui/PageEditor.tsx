import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu, type Block } from '@blocknote/core';
import '@blocknote/core/fonts/inter.css';
import { withCollaboration } from '@blocknote/core/yjs';
import { BlockNoteView } from '@blocknote/mantine';
import { createPortal } from 'react-dom';
import './photoAnnotatedExports.css';
import '@blocknote/mantine/style.css';
import {
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from '@blocknote/react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import type * as Y from 'yjs';
import { localize, t, useT } from '../i18n';
import '../i18n/lazy/editor';
import '../i18n/lazy/folders';
import { usePermissions, useServices, useSyncStatus } from '../services';
import { FileRejected, isAllowedImage } from '../sync/files';
import { isMediaFile, MEDIA_SCHEME, mediaIdOf } from '../media/queue';
import { carreteItemsOf, collectCarrete, inlinePhotosOf, parsePhotoKey, photoKeyOf, photoPropsIn, startIndex, type BlockLike, type CarreteItem } from './carreteModel';
import { createCarreteLoader, type CarreteLoader } from './carreteLoader';
import { porteroDownload, sharpenImages } from './sharpImages';
import { attachMarkupOverlay } from './markupOverlay';
import { PHOTO_MARKUP_MAP, readPhotoMarkup } from '../media/markup';
import { linkEditUnavailable, useLinkMode } from '../linkMode';
import { LEVEL_VIEW, Permissions } from '../sync/access';
import { startMarkupPrune } from '../media/markupPrune';
import { clipScope, MARKUP_PASTE_ORIGIN, writeReplacementMarkup } from '../media/markupClipboard';
import { markupClipboardExtension, pasteWithMarkup, trackMarkupInUndo } from './markupClipboardEditor';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { editorSchemaOptions, insertPageBreakForSlashMenu, SCRIPT_PROP, setVideosAccepted } from './editorSchema';
import { dropTarget, insertFiles, isEmptyParagraph, isFilesTransfer, takeFiles, type FileEditor, type InsertAt } from './fileDrop';
import { addFiles, dropPos, pickFiles, type AddFilesOptions, type PhotoEditor, type PickExtra } from './inlinePhotoCreate';
import { CAMERA_ACCEPT, CAMERA_FACING, cameraKinds, capturePhone, registerPageCamera, type CameraKind } from './camera';
import { readFolder, summarize, takeDrop, type FolderSource } from '../media/folderRead';
import { FolderAskDialog, FolderGlyph, FolderProgressDialog } from './FolderDialog';
import { folderSlashOffer, pickFolder } from './folderPick';
import { FolderViewer } from './FolderViewer';
import { renameConvertedHeic } from './heicNames';
import { isAttachment, markAttachments } from './attachments';
import { openAttachmentNow, prepareAttachment } from './attachmentOpen';
import { AttachmentSheet } from './AttachmentSheet';
import { editorDictionary } from './editorLocale';
import { findUnknownContent } from './unknownContent';
import { editorLinkClick, followInternalLink } from './internalLinks';
import { pageLinkViewExtension } from './pageLinkView';
import { useLeaveGuard } from './WorkspaceMenu';
import { redrawFromYjs } from './editorRecovery';
import {
  CommentMargin,
  questionSlashItem,
  useBlockSourceRegistration,
  withParagraphVariants,
} from './EditorComments';
import { useCommentAccess } from './CommentsToggle';
import { CameraIcon, PageBreakIcon, ScriptIcon, VideoIcon } from './icons';
import { notify } from './notice';
import { useScheme } from '../prefs';
import { createDrivePaste } from './drivePaste';
import { DrivePasteMenu } from './DrivePasteMenu';
import { lazyPart, Part, preloadWhenIdle } from './lazyPart';
import { SheetBreaks } from './SheetBreaks';
import type { HeadingRecord } from './collapse';
import { collapseSupported, headingCounts, revealBlock, setAllCollapsed, SHARED_COLLAPSE_MAP } from './collapseEditor';
import { pageEditorExtensions } from './editorExtensions';
import { setCollapseControl } from './collapseControl';
import { collapseSaver, loadCollapse } from './collapseStore';
import { CollapseToggles } from './CollapseToggles';
import { BlockSideMenuController } from './BlockSideMenu';
import { PageFormattingToolbar, PageFormattingToolbarController, pageToolbarItems } from './PageToolbar';
import { PageLinkToolbarController } from './toolbarTips';
import { PhotoToolbarController } from './PhotoToolbar';
import { MediaActionsContext, type MediaActions } from './MediaBar';
import { OriginalDownloadButton } from './MediaToolbarButtons';
import { BACKGROUND_META } from './editorMeta';
import { notToggleHeading } from './collapseMenus';
import { clickOpens, mousePressOpens, shiftSelects } from './carreteClick';
import { FindBar, type FindEditor } from './FindBar';
import { photoKeyAtPos, selectedPhotoKey, spacePhotoKey } from './inlinePhotoEditor';
import { selectedPhotos } from './inlinePhotoSize';
import { shortcutLabel, slashBadge } from './shortcuts';
import { closeFindBar, isFindShortcut, openFindBar, openFindBarAt, takesFindShortcut } from './findUi';
import { searchSession, type ResultRequest } from './projectSearchUi';
import { normalize, normalizeQuery, searchNormalized } from '../search/normalize';
import '../i18n/lazy/search';
import { registerRestoreTarget } from './historyUi';
import { historyMarksExtension, type HistoryMarksInput } from './historyMarks';
import { editorUndo, restoreInEditor } from './historyRestore';
import { RemovedWritingBanner } from './RemovedWritingBanner';
import { registerAssistantTarget, type AssistantEditor } from '../assistant/assistantUi';
import { TemplateHost } from '../templates/TemplateHost';
import { ySyncPluginKey, yUndoPluginKey } from 'y-prosemirror';
import type { Node as PMNode } from '@tiptap/pm/model';
import { undoTimelineFor } from './undoTimeline';
import { revealChange, revealPhoto } from './undoReveal';
import { revealSelectionCell } from './tableScroll';
import { liveView, trackSpot, takeSpot, spotsOf } from './inlinePhotoCreate';
import type { ReplacePick } from './photoReplaceIntent';
import { startPhotoReplacement } from './photoReplace';
import { PhotoReplaceSheet, type PhotoReplacement } from './PhotoReplaceSheet';

// El carrete se baja aparte, la primera vez que se abre (roadmap B.4).
const Carrete = lazyPart(() => import('./Carrete').then((m) => m.Carrete));
// El anotador de fotos (P.20, entrega 2), también aparte: solo lo abre quien puede editar.
const Annotator = lazyPart(() => import('./Annotator').then((m) => m.Annotator));
const PhotoAnnotatedExports = lazyPart(() => import('./PhotoAnnotatedExports').then((m) => m.PhotoAnnotatedExports));

/** Debe montarse como hijo de BlockNoteView: el portal conserva sus providers. */
export function PhotoAnnotatedSheet({ item, map, loader, onClose, trigger, isCurrent }: { item: CarreteItem; map: Y.Map<unknown>; loader: CarreteLoader; onClose: () => void; trigger?: HTMLElement; isCurrent?: () => boolean }) {
  const tr = useT(), sheet = useRef<HTMLDivElement>(null), closeButton = useRef<HTMLButtonElement>(null), focused = useRef<HTMLElement | null>(null), [viewport, setViewport] = useState({ width: innerWidth, height: innerHeight });
  useEffect(() => {
    const resize = () => setViewport({ width: innerWidth, height: innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    const previous = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    sheet.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [trigger]);
  useEffect(() => {
    const root = sheet.current;
    if (!root) return;
    // Preparar retira o deshabilita su botón: conservar foco y Escape, sin tomar foco externo.
    const observer = new MutationObserver(() => {
      const previous = focused.current;
      if (previous && (!root.contains(previous) || (previous instanceof HTMLButtonElement && previous.disabled)) && (document.activeElement === document.body || document.activeElement === previous)) closeButton.current?.focus();
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    return () => observer.disconnect();
  }, []);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    if (event.key !== 'Tab') return;
    const buttons = [...(sheet.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const edge = event.shiftKey ? buttons[0] : buttons.at(-1);
    if (document.activeElement === edge) { event.preventDefault(); (event.shiftKey ? buttons.at(-1) : buttons[0])?.focus(); }
  };
  const anchor = trigger?.getBoundingClientRect();
  const left = Math.max(12, Math.min(anchor?.left ?? (viewport.width - 420) / 2, viewport.width - Math.min(420, viewport.width - 24) - 12));
  const top = Math.max(12, Math.min(anchor?.bottom ?? 60, viewport.height - 360));
  return createPortal(<div className="photo-export-backdrop" onClick={onClose}>
    <div ref={sheet} className="photo-export-sheet" role="dialog" aria-modal="true" aria-label={tr('mediaButton.download')} style={{ left, top, maxHeight: viewport.height - top - 12 }} onClick={(event) => event.stopPropagation()} onKeyDown={keyDown} onFocusCapture={(event) => { focused.current = event.target; }}>
      <header><h2>{tr('mediaButton.download')}</h2><span className="photo-export-name">{item.name}</span></header>
      <div className="photo-export-original"><OriginalDownloadButton fileId={item.mediaId!} label={tr('photoExport.original')} isCurrent={isCurrent} /></div>
      <div className="photo-export-content"><Part fallback={<p role="status">{tr('common.preparing')}</p>}><PhotoAnnotatedExports item={item} map={map} loader={loader} onClose={onClose} /></Part></div>
      <footer><button ref={closeButton} onClick={onClose}>{tr('common.close')}</button></footer>
    </div>
  </div>, document.body);
}

type Opening =
  | { state: 'loading' }
  | { state: 'ready'; doc: Y.Doc; complete: boolean; collapse: Map<string, HeadingRecord> }
  /** La página trae algo que esta versión del editor no conoce: abrirla lo borraría. */
  | { state: 'unsupported'; what: string };

/** En pantallas táctiles no se lleva el foco a la barra al ir a un resultado: el teclado taparía la página. */
const coarsePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

type AnnotationNavigator = { editor: FindEditor; open(request: ResultRequest, isCurrent: () => boolean): void };

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
  // La página tiene contenido pero ningún editor armó todavía la base limpia que le toca a esta persona
  // (Docs/Doc_Privacidad_Borrado.md, 4.3): no hay nada que bajar, hay que esperar a que la preparen.
  const [preparing, setPreparing] = useState(false);
  const tr = useT();
  // El editor que usa la barra de buscar (Docs/Doc_Buscar.md). La barra y lo buscado viven acá, arriba del
  // editor: el editor se vuelve a montar (al terminar de bajar, al cambiar el permiso o el idioma) y la
  // búsqueda sigue.
  const [findEditor, setFindEditor] = useState<FindEditor | null>(null);
  const [annotationNavigator, setAnnotationNavigator] = useState<AnnotationNavigator | null>(null);
  const registerAnnotationNavigator = useCallback((next: AnnotationNavigator | null, own?: AnnotationNavigator) => {
    setAnnotationNavigator((current) => next ?? (current === own ? null : current));
  }, []);
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
      if (search.peekRequest()?.annotation && annotationNavigator?.editor !== findEditor) return;
      const request = search.takeRequest(pageId);
      if (!request) return;
      if (request.annotation) {
        closeFindBar();
        annotationNavigator?.open(request, search.requestValidity());
      } else if (request.term) {
        const target = request.blockId ? { pageId, blockId: request.blockId, occurrence: request.occurrence ?? 0 } : null;
        openFindBarAt(request.term, target, { focus: !coarsePointer(), ...request.options });
      } else {
        closeFindBar();
        findEditor.prosemirrorView?.dom.closest('.main')?.scrollTo?.({ top: 0, left: 0 });
      }
    };
    take();
    return search.subscribe(take);
  }, [findEditor, annotationNavigator, pageId, search]);

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
    }).catch((err: unknown) => {
      // El editor ya se desmontó y la apertura que quedó en camino falló (la base se cerró al salir del workspace): no
      // hay nada que mostrar ni que cerrar. Con el editor a la vista, el error sigue saliendo como antes.
      if (!cancelled) throw err;
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
      void Promise.all([engine.isMissingContent(pageId), engine.contentGap(pageId)]).then(([missing, gap]) => {
        if (cancelled) return;
        setPreparing(gap === 'preparing');
        if (!missing) setAttempt((n) => n + 1);
      });
    check();
    // Con la app vieja para el workspace no se baja contenido: no llega nada hasta actualizar (o hasta que bajen la
    // mínima, que se ve en un ciclo). Se mira solo con cada sincronización, sin leer la base cada segundo.
    const timer = status.outdated ? null : setInterval(check, 1000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [engine, pageId, incomplete, status.lastSyncAt, status.outdated]);

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
      <RemovedWritingBanner docs={docs} pageId={pageId} />
      {!opening.complete && (
        <p className="muted editor-missing">
          {!status.online
            ? tr('editor.missingOffline')
            : status.outdated
              ? tr('editor.missingOutdated')
              : preparing
                ? tr('editor.preparing')
                : tr('editor.missingOnline')}
        </p>
      )}
      {!canEdit && perms.known && (
        <p className="muted editor-missing">
          {/* Quien entró con un link no tiene a quién pedirle permiso desde la app: se le dice qué pedir. */}
          {perms.viaLink
            ? tr(linkEditUnavailable(services.remote) ? 'link.readOnlyEditOff' : 'link.readOnly')
            : canComment
              ? tr('editor.commentOnly')
              : tr('page.viewOnly')}
        </p>
      )}
      {/* Las plantillas (Docs/Doc_Plantillas.md): la tira de la página vacía y la ventana *Templates*. */}
      <TemplateHost
        pageId={pageId}
        doc={opening.doc}
        editor={findEditor}
        editable={opening.complete && canEdit}
        complete={opening.complete}
      />
      {/* Cambiar el idioma vuelve a abrir el editor (sus textos se eligen al crearlo); el documento es el mismo. */}
      <BlockEditor
        key={`${pageId}:${opening.complete}:${canEdit}:${tr.lang}:${remounts}`}
        doc={opening.doc}
        collapse={opening.collapse}
        pageId={pageId}
        editable={opening.complete && canEdit}
        permsKnown={perms.known}
        canComment={canComment}
        onEditor={setFindEditor}
        onAnnotationNavigator={registerAnnotationNavigator}
        onBroken={remount}
        inTimeline
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

/**
 * El editor de una página. Lo usan la página (arriba) y la página de práctica (tutorial/PracticeView.tsx), que lo
 * monta con sus servicios en memoria.
 */
export function BlockEditor({
  doc,
  collapse,
  pageId,
  editable,
  permsKnown,
  canComment,
  onEditor,
  onAnnotationNavigator,
  onBroken,
  filesNotice,
  preview = false,
  marks,
  inTimeline = false,
}: {
  doc: Y.Doc;
  /** Lo colapsado para vos (P.11): se actualiza en el lugar, así un editor que se vuelve a crear lo conserva. */
  collapse: Map<string, HeadingRecord>;
  pageId: string;
  editable: boolean;
  /** Los permisos se conocen (colapsar para todos solo con ellos; Doc_Colapsar.md, corrección 9). */
  permsKnown: boolean;
  canComment: boolean;
  onEditor?: (editor: FindEditor | null) => void;
  onAnnotationNavigator?: (next: AnnotationNavigator | null, own?: AnnotationNavigator) => void;
  /** El editor no se pudo volver a dibujar después de un error: hay que montarlo de nuevo. */
  onBroken?: () => void;
  /**
   * La página de práctica: soltar o pegar cualquier archivo avisa esto y no hace nada (Docs/Doc_Tutorial.md,
   * corrección 13).
   */
  filesNotice?: string;
  /**
   * Una versión del historial (P.18, HistoryPanel.tsx): en solo lectura, sobre un documento en memoria. No se anota
   * como el editor de la página (colapsar desde el menú, los bloques de los comentarios) ni muestra comentarios.
   */
  preview?: boolean;
  /**
   * Las marcas de "Show changes" de una versión del historial (historyMarks.ts): decoraciones, sin tocar el esquema ni
   * el documento. Van con el documento que se muestra (el editor se crea de nuevo con cada uno).
   */
  marks?: HistoryMarksInput;
  /**
   * La página de verdad (no la práctica ni una versión del historial): su pila de deshacer va a la línea de tiempo del
   * proyecto (P.26, undoTimeline.ts), que la guarda al irse y se la devuelve al volver.
   */
  inTimeline?: boolean;
}) {
  const services = useServices();
  const { docs, files, media, user, db, folders, tree: pageTree, workspace } = services;
  const link = useLinkMode();
  const scheme = useScheme();
  const tr = useT();
  const host = useRef<HTMLDivElement>(null);
  const leave = useLeaveGuard();
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  const linkScope = useMemo(() => ({ live: true, origin: Object.freeze({
    appOrigin: location.origin, localKey: link?.entry.localKey ?? workspace.config.localKey,
  }), publicMode: !!link, publicEntry: link?.entry }), [doc, services, workspace, user, pageId, link?.entry.id]);
  const linkScopeRef = useRef(linkScope);
  linkScopeRef.current = linkScope;
  useEffect(() => { linkScope.live = true; return () => { linkScope.live = false; }; }, [linkScope]);
  const linkContext = useMemo(() => ({
    origin: linkScope.origin, publicMode: linkScope.publicMode,
    root: () => editor.domElement ?? null,
    current: () => linkScope.live && linkScopeRef.current === linkScope,
    leave: (action: () => void, current: () => boolean) => leaveRef.current(action, current),
  }), [linkScope]);
  const linkContextRef = useRef(linkContext);
  linkContextRef.current = linkContext;
  const editorRef = useRef<{ removeBlocks: (ids: string[]) => unknown; transact: (fn: (tr: { setMeta: (k: string, v: unknown) => unknown }) => void) => void } | null>(null);
  /** Si la página se puede editar ahora (lo leen las funciones que el editor guarda al crearse). */
  const editableRef = useRef(editable);
  /** Si se puede colapsar o abrir para todos (Shift+clic): con permiso de editar, conocido. */
  const canShare = editable && permsKnown;
  const canShareRef = useRef(canShare);
  const [carrete, setCarrete] = useState<OpenCarrete | null>(null);
  /** La foto abierta en el anotador (P.20, Docs/Doc_Anotar_Fotos.md). */
  const [annotating, setAnnotating] = useState<OpenAnnotator | null>(null);
  /** *Annotate* desde el carrete: se abre cuando el carrete termina de cerrarse. */
  const annotateAfterCarrete = useRef<CarreteItem | null>(null);
  /** El adjunto con su hoja abierta (Docs/Doc_Adjuntos.md). */
  const [sheet, setSheet] = useState<string | null>(null);
  /** Carpetas soltadas que esperan "Subir" (P.9, Docs/Doc_Carpetas.md), dónde se soltaron. */
  const [folderAsk, setFolderAsk] = useState<{ sources: FolderSource[]; at: InsertAt | null; resumes: (string | null)[] } | null>(null);
  /** La carpeta abierta en el visor, y la que muestra cómo va su subida. */
  const [folderView, setFolderView] = useState<{ id: string; name: string; download?: boolean } | null>(null);
  const [folderUpload, setFolderUpload] = useState<string | null>(null);
  // Con el editor ya abierto, el carrete se baja cuando el navegador está libre: tocar una foto no espera.
  useEffect(() => preloadWhenIdle(Carrete), []);
  // El anotador también, para quien puede editar (así anda sin red aunque nunca se haya abierto).
  useEffect(() => (editable ? preloadWhenIdle(Annotator) : undefined), [editable]);
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
    if (filesNotice) return Promise.reject(new FileRejected(filesNotice));
    if (media.enabled) return media.add(pageId, file);
    if (!isAllowedImage(file.type)) return Promise.reject(new FileRejected(acceptedText()));
    return files.add(pageId, file);
  };
  // Una imagen embebida en HTML pegado (`data:`): solo fotos y videos, nunca un adjunto (un SVG pegado no se
  // vuelve una tarjeta).
  const storeEmbedded = (blob: Blob): Promise<string> => {
    if (filesNotice) return Promise.reject(new FileRejected(filesNotice));
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

  // Copiar y pegar una foto con sus anotaciones (D46, markupClipboardEditor.ts): viajan solo dentro del mismo workspace
  // y del mismo proyecto (en otro proyecto la foto se ve como "de otro proyecto" y sus notas no tendrían dónde verse).
  // En la vista de una versión del historial se puede copiar (lleva las de esa versión), nunca pegar.
  const markupScope = () => clipScope(workspace?.config?.localKey, pageTree?.get(pageId)?.workspace_id);
  const markupScopeRef = useRef(markupScope);
  markupScopeRef.current = markupScope;

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
      links: { onClick: (event) => editorLinkClick(event, linkContextRef.current) },
      // Pegar archivos: las fotos y los videos en el renglón, donde está el cursor (fotos en línea,
      // inlinePhotoCreate.ts); con portero, cualquier otro archivo, un bloque debajo (fileDrop.ts).
      pasteHandler: (ctx) => {
        const dt = ctx.event.clipboardData;
        if (!isFilesTransfer(dt))
          return pasteWithMarkup({
            data: dt,
            view: ctx.editor.prosemirrorView,
            doc,
            scope: markupScopeRef.current(),
            run: () => drivePaste.pasteHandler(ctx),
            onLimit: () => notify(t('editor.markupPasteTooMany')),
          });
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
                  // Lo hizo la app, no la persona: no entra en la pila de deshacer (P.26, Doc_Deshacer.md, 3.4).
                  tr.setMeta('addToHistory', false);
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
      // Las extensiones de la página (editorExtensions.ts): fotos en línea, buscar, deshacer, títulos y colapsar.
      extensions: [
        pageLinkViewExtension(linkScope.origin, linkScope.publicEntry),
        ...pageEditorExtensions(
          canCollapse
            ? {
                initial: collapse,
                // Lo colapsado para todos, en el mismo documento que el contenido (entrega 2).
                shared: doc.getMap(SHARED_COLLAPSE_MAP),
                canShare: () => canShareRef.current,
                save: (records: ReadonlyMap<string, HeadingRecord>) => {
                  collapse.clear();
                  for (const [id, r] of records) collapse.set(id, r);
                  collapseSave.save(records);
                },
              }
            : null,
        ),
        ...(marks ? [historyMarksExtension(marks)] : []),
        markupClipboardExtension({ doc, scope: () => markupScopeRef.current() }),
      ],
    }),
    [doc],
  );

  // El menú de la página ("Colapsar todo / Abrir todo") y "Ir al bloque" de los comentarios llegan acá.
  useEffect(() => {
    if (!canCollapse || preview) return;
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
  }, [editor, pageId, canCollapse, preview]);

  editorRef.current = editor as unknown as NonNullable<typeof editorRef.current>;
  editableRef.current = editable;
  canShareRef.current = canShare;

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

  // Deshacer en el orden en que editaste (P.26, Docs/Doc_Deshacer.md, 3.2): al montarse la vista, la pila de deshacer de
  // este editor toma lo que la línea de tiempo guardó de esta página (antes de que se pueda escribir); al irse, se la
  // deja. Sin tocar y-prosemirror: su `UndoManager` usa las listas que se le pasan.
  useEffect(() => {
    if (!inTimeline || preview || filesNotice) return;
    const timeline = undoTimelineFor(services);
    let detach: (() => void) | null = null;
    const start = () => {
      detach?.();
      detach = null;
      const view = editor.prosemirrorView;
      if (!view) return;
      const um = (yUndoPluginKey.getState(view.state as never) as { undoManager?: Y.UndoManager } | undefined)?.undoManager;
      if (!um) return;
      const binding = (ySyncPluginKey.getState(view.state as never) as { binding?: object | null } | undefined)?.binding ?? null;
      // La pila que llega de un editor anterior puede tener un pegado con anotaciones (D46): su `UndoManager` sumaba el
      // mapa de anotaciones al pegar, y este no lo tiene. Sin él, rehacer ese pegado traía la foto sin sus flechas
      // (auditoría de la entrega 3 de Doc_Deshacer.md, F1). Se suma desde el principio (solo el origen de lo pegado).
      trackMarkupInUndo(view.state, doc);
      detach = timeline.attach(pageId, doc, um, {
        binding,
        editable: () => editableRef.current && view.editable,
        dom: view.dom,
        snapshot: () => view.state.doc,
        reveal: (before, opts) => revealChange(view, before as PMNode, opts),
        showPhoto: (fileId) => revealPhoto(view, fileId, mediaIdOf),
      });
    };
    if (editor.domElement) start();
    const offMount = editor.onMount(start);
    const offUnmount = editor.onUnmount(() => {
      detach?.();
      detach = null;
    });
    return () => {
      offMount();
      offUnmount();
      detach?.();
      detach = null;
    };
  }, [editor, doc, pageId, inTimeline, preview, filesNotice, services]);

  // El historial de versiones (P.18, Docs/Doc_Historial.md, sección 6): restaurar es una edición por este editor, solo
  // mientras se pueda editar (y la página esté completa: `editable` ya lo dice).
  useEffect(() => {
    if (!editable) return;
    return registerRestoreTarget(pageId, (version, _schema, context) => {
      const view = editor.prosemirrorView;
      if (!view) return { ok: false, reason: 'notEditable' };
      return restoreInEditor(view, version, (fn) => editor.onChange(() => fn(), false), context ? { ...context, timeline: undoTimelineFor(services), pageId } : undefined);
    }, () => {
      const view = editor.prosemirrorView, manager = view && editorUndo(view);
      return view && manager && editableRef.current && linkScope.live ? { doc, view, schema: view.state.schema, manager } : null;
    });
  }, [editor, doc, pageId, editable, services, linkScope]);

  // El asistente (Docs/Doc_Asistente.md, A1) usa este editor: lo elegido, la guarda y aplicar. No una versión del
  // historial ni la página de práctica.
  useEffect(() => {
    if (preview || filesNotice) return;
    return registerAssistantTarget({
      pageId,
      view: () => editor.prosemirrorView ?? null,
      editable: () => editableRef.current,
      editor: () => editor as unknown as AssistantEditor,
    });
  }, [editor, pageId, preview, filesNotice]);

  // Sacar una foto o filmar (camera.ts): el selector con `capture`, por el mismo camino que "/Image". Solo en un
  // teléfono; el video, con portero.
  const cameraOffer = useMemo(() => cameraKinds({ phone: capturePhone(), videos: media.enabled }), [media.enabled]);
  const openCamera = (kind: CameraKind, extra: PickExtra = {}) => {
    if (!editable || !cameraKinds({ phone: capturePhone(), videos: media.enabled }).includes(kind)) return;
    pickFiles(editor as unknown as PhotoEditor, CAMERA_ACCEPT[kind], fileOptions(editor as unknown as FileEditor), {
      capture: CAMERA_FACING,
      ...extra,
    });
  };
  const openCameraRef = useRef(openCamera);
  openCameraRef.current = openCamera;
  // "Folder" del menú "/" (folderPick.ts): elegir una carpeta con el selector del sistema, en vez de arrastrarla.
  const folderOffer = folderSlashOffer({ editable, practice: !!filesNotice, portero: media.enabled, noFolders: !!media.noFolders, queue: !!folders });
  const chooseFolderRef = useRef<() => void>(() => undefined);
  // Si la persona puso el cursor en la página en esta visita: si no, lo del menú de la página va al final.
  const cursorPlaced = useRef(false);
  useEffect(() => {
    if (!editable || cameraOffer.length === 0) return;
    return registerPageCamera(pageId, {
      kinds: cameraOffer,
      open: (kind) => {
        if (cursorPlaced.current) return openCameraRef.current(kind);
        const last = editor.document[editor.document.length - 1];
        if (!last) return openCameraRef.current(kind);
        // Un renglón vacío al final la recibe; si no, va en un renglón nuevo después del último bloque.
        if (isEmptyParagraph(last as never)) {
          editor.setTextCursorPosition(last.id, 'end');
          return openCameraRef.current(kind);
        }
        openCameraRef.current(kind, { at: { blockId: last.id, placement: 'after' } });
      },
    });
  }, [editor, pageId, editable, cameraOffer]);

  // La barra de buscar (arriba, en PageEditor) usa este editor mientras esté montado.
  useEffect(() => {
    onEditor?.(editor as unknown as FindEditor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  // Una tabla que se desplaza de costado (pantalla angosta): la celda con el cursor entra entera (tableScroll.ts).
  useEffect(() => editor.onSelectionChange(() => void revealSelectionCell()), [editor]);

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
                  // Lo hizo la app, no la persona: no entra en la pila de deshacer (P.26, Doc_Deshacer.md, 3.4).
                  tr.setMeta('addToHistory', false);
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

  // Las anotaciones de las fotos (P.20, Docs/Doc_Anotar_Fotos.md): un mapa del documento de la página, afuera del
  // contenido. Su dibujo va encima de cada foto anotada, montado siempre (así sale también en el PDF).
  const markupMap = useMemo(() => doc.getMap<unknown>(PHOTO_MARKUP_MAP), [doc]);
  const [photoExport, setPhotoExport] = useState<{ item: CarreteItem; loader: CarreteLoader; trigger?: HTMLElement; isCurrent: () => boolean; dispose: () => void } | null>(null);
  const exportRef = useRef(photoExport);
  exportRef.current = photoExport;
  const exportContext = useRef({ services, workspace, user, pageId, doc, editable, link });
  exportContext.current = { services, workspace, user, pageId, doc, editable, link };
  const [photoReplacement, setPhotoReplacement] = useState<PhotoReplacement | null>(null);
  const replacementClose = useRef<(() => void) | null>(null);
  const replacementCancels = useRef(new Set<() => void>());
  const exportSelection = () => {
    const state = editor.prosemirrorView?.state;
    if (!state) return null;
    const inline = selectedPhotos(state);
    if (inline.length) return inline.length === 1 ? photoKeyAtPos(state.doc, inline[0]) : null;
    const node = selectedPhotoKey(state);
    if (node) return node;
    const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
    return blocks.length === 1 && blocks[0].type === 'image' ? blocks[0].id : null;
  };
  // Además de la clave ordinal, conservar el nodo real: dos apariciones del mismo UUID no son la misma foto.
  const exportNode = (key: string) => {
    const pm = editor.prosemirrorView?.state.doc;
    let found: PMNode | null = null;
    pm?.descendants((node, pos, parent) => {
      if ((node.type.name === 'photo' && photoKeyAtPos(pm, pos) === key) || (node.type.name === 'image' && parent?.attrs.id === key)) found = node;
    });
    return found;
  };
  const prepareReplace = (key: string, trigger: HTMLElement | null): ReplacePick | null | undefined => {
    const context = exportContext.current, view = liveView(editor as never);
    const permitted = () => new Permissions(services.tree, services.access.get(), user.id).canEditPage(pageId);
    const contextCurrent = () => {
      const now = exportContext.current;
      return !!view && liveView(editor as never) === view && now.services === context.services && now.workspace === context.workspace && now.user === context.user && now.pageId === context.pageId && now.doc === context.doc && now.editable && !now.link && editor.isEditable && permitted();
    };
    if (!contextCurrent() || exportSelection() !== key) return null;
    const item = collectCarrete(editor.document as unknown as BlockLike[]).find((entry) => entry.key === key), id = item?.mediaId;
    const info = id ? media.fileInfo(id) : null;
    if (!item || !id || media.isFolder(id) || (info ? info.kind !== 'image' : isAttachment(media, id, item.name) || /\.(mp4|m4v|mov|webm|ogv|mkv)$/i.test(item.name)) || ![...markupMap.keys()].some((entry) => entry === id || entry.startsWith(`${id}/`))) return undefined;
    const atKey = () => {
      const matches: { node: PMNode; pos: number }[] = [];
      view!.state.doc.descendants((node, pos, parent) => {
        if ((node.type.name === 'photo' && photoKeyAtPos(view!.state.doc, pos) === key) || (node.type.name === 'image' && parent?.attrs.id === key)) matches.push({ node, pos });
      });
      return matches.length === 1 ? matches[0] : null;
    };
    // Leer la identidad que ya mantiene el binding; nunca modificarlo ni aceptar un mapping ambiguo.
    const mapping = () => ySyncPluginKey.getState(view!.state)?.binding?.mapping as Map<unknown, PMNode | PMNode[]> | undefined;
    const captured = atKey(), identities = captured ? [...(mapping() ?? [])].filter(([, node]) => node === captured.node).map(([identity]) => identity) : [];
    if (identities.length !== 1) return null;
    const identity = identities[0];
    const isCurrent = () => {
      if (!contextCurrent() || exportSelection() !== key || media.isFolder(id) || isAttachment(media, id, item.name) || media.fileInfo(id)?.kind === 'video') return false;
      const current = atKey(), map = mapping();
      return !!current && current.node.attrs.url === item.url && map?.get(identity) === current.node && [...map.values()].filter((node) => node === current.node).length === 1;
    };
    return { isCurrent, receive: (file, intent) => {
      if (!isCurrent() || !intent.isCurrent()) { intent.release(); return; }
      const spot = captured!.node.type.name === 'photo' ? trackSpot(view!, atKey()!.pos, false) : null;
      let ownClose: (() => void) | null = null;
      startPhotoReplacement({ file, intent, trigger, doc, oldId: id, map: markupMap, isCurrent: () => isCurrent() && (spot === null || spotsOf(view!.state).find((entry) => entry.id === spot)?.pos === atKey()?.pos),
        dimensions: () => info?.kind === 'image' ? media.dimensions(id) : Promise.resolve(null), store: fileOptions(editor).store,
        inContent: (candidate) => collectCarrete(editor.document as unknown as BlockLike[]).some((entry) => entry.mediaId === candidate),
        isPhoto: (candidate) => media.fileInfo(candidate)?.kind === 'image' && !media.isFolder(candidate),
        prepare: (url, name) => {
          if (!isCurrent()) return null;
          const current = atKey()!;
          const transaction = view!.state.tr.setNodeMarkup(current.pos, undefined, { ...current.node.attrs, url, name });
          return view!.state.applyTransaction(transaction).transactions.length ? transaction : null;
        },
        commit: (transaction, candidate, plan) => {
          let written = false;
          undoTimelineFor(services).compose(pageId, MARKUP_PASTE_ORIGIN, () => {
            view!.dispatch(transaction);
            if (!view!.state.doc.eq(transaction.doc)) return;
            if (plan) writeReplacementMarkup(markupMap, candidate, plan);
            written = true;
          });
          return written;
        },
        watch: (check, cancel) => {
          ownClose = cancel; replacementClose.current = cancel; replacementCancels.current.add(cancel);
          const change = editor.onChange(check, false), selection = editor.onSelectionChange(check), access = services.access.subscribe(check), tree = services.tree.subscribe(check);
          const auth = services.client.auth.onAuthStateChange((event) => { if (event !== 'INITIAL_SESSION') cancel(); });
          return () => { change(); selection(); access(); tree(); auth.data.subscription.unsubscribe(); replacementCancels.current.delete(cancel); };
        },
        show: (state) => { if (replacementClose.current !== ownClose) return; if (!state) replacementClose.current = null; setPhotoReplacement(state); },
        cleanup: () => { if (spot !== null) takeSpot(view!, spot); }, canReturnFocus: contextCurrent,
      });
    } };
  };
  const prepareReplaceRef = useRef(prepareReplace);
  prepareReplaceRef.current = prepareReplace;
  useEffect(() => { for (const cancel of replacementCancels.current) cancel(); }, [services, workspace, user, pageId, doc, editable, link]);
  useEffect(() => () => { for (const cancel of replacementCancels.current) cancel(); }, [editor]);
  const closePhotoExport = () => {
    exportRef.current?.dispose(); exportRef.current = null; setPhotoExport(null);
  };
  const openPhotoExport = (key: string, trigger: HTMLElement | null): boolean => {
    const context = exportContext.current;
    const permitted = () => new Permissions(services.tree, services.access.get(), user.id).canEditPage(pageId);
    if (!context.editable || context.link || !editor.isEditable || !permitted() || exportSelection() !== key) return true;
    const item = collectCarrete(editor.document as unknown as BlockLike[]).find((entry) => entry.key === key);
    if (!item) return true;
    const id = item.mediaId, info = id ? media.fileInfo(id) : null;
    if (!id || media.isFolder(id) || (info ? info.kind !== 'image' : isAttachment(media, id, item.name) || /\.(mp4|m4v|mov|webm|ogv|mkv)$/i.test(item.name)) || ![...markupMap.keys()].some((entry) => entry.startsWith(`${id}/`))) return false;
    const node = exportNode(key);
    if (!node) return true;
    closePhotoExport();
    const base = createCarreteLoader({ media, files });
    let disposed = false;
    const isCurrent = () => {
      const now = exportContext.current;
      if (disposed || !now.editable || now.link || !editor.isEditable || !permitted() || now.services !== context.services || now.workspace !== context.workspace || now.user !== context.user || now.pageId !== context.pageId || now.doc !== context.doc || exportSelection() !== key || exportNode(key) !== node) return false;
      const present = collectCarrete(editor.document as unknown as BlockLike[]).find((entry) => entry.key === key);
      return present?.url === item.url && present.mediaId === id && !media.isFolder(id) && media.fileInfo(id)?.kind !== 'video' && !isAttachment(media, id, present.name);
    };
    const dispose = () => { if (!disposed) { disposed = true; base.dispose(); } };
    const loader: CarreteLoader = { ...base, annotatedOriginal: async (...args) => {
      if (!isCurrent()) throw new Error('La foto elegida cambió');
      const source = await base.annotatedOriginal!(...args);
      return { ...source, isCurrent: () => isCurrent() && source.isCurrent() };
    } };
    exportRef.current = { item, loader, trigger: trigger ?? undefined, isCurrent, dispose };
    setPhotoExport(exportRef.current);
    return true;
  };
  const openPhotoExportRef = useRef(openPhotoExport);
  openPhotoExportRef.current = openPhotoExport;
  useEffect(() => {
    const check = () => { if (exportRef.current && !exportRef.current.isCurrent()) closePhotoExport(); };
    const change = editor.onChange(check, false), selection = editor.onSelectionChange(check);
    return () => { change(); selection(); closePhotoExport(); };
  }, [editor]);
  useEffect(() => {
    if (!photoExport) return;
    const check = () => { if (exportRef.current && !exportRef.current.isCurrent()) closePhotoExport(); };
    const access = services.access.subscribe(check), tree = services.tree.subscribe(check);
    const auth = services.client.auth.onAuthStateChange((event) => { if (event !== 'INITIAL_SESSION') closePhotoExport(); });
    return () => { access(); tree(); auth.data.subscription.unsubscribe(); closePhotoExport(); };
  }, [services, photoExport]);
  useEffect(() => { if (photoExport && !photoExport.isCurrent()) closePhotoExport(); }, [services, workspace, user, pageId, doc, editable, link, photoExport]);
  useEffect(() => () => photoExport?.dispose(), [photoExport]);
  useEffect(() => {
    let overlay: ReturnType<typeof attachMarkupOverlay> | null = null;
    const start = () => {
      overlay?.stop();
      const root = editor.domElement;
      overlay = root ? attachMarkupOverlay(root, markupMap) : null;
    };
    if (editor.domElement) start();
    const offMount = editor.onMount(start);
    const offUnmount = editor.onUnmount(() => {
      overlay?.stop();
      overlay = null;
    });
    return () => {
      offMount();
      offUnmount();
      overlay?.stop();
    };
  }, [editor, markupMap]);

  // La poda de las anotaciones de las fotos sacadas (AN11, media/markupPrune.ts): solo un dispositivo que edita, con la
  // página entera (`editable` ya lo dice), abierta y SINCRONIZADA (con red, nada sin subir ni sin bajar: sin red no ve
  // que otro volvió a poner la foto, auditoría B2); cada minuto. Nunca en la vista de una versión.
  const { engine: syncEngine } = useServices();
  useEffect(
    () =>
      startMarkupPrune({
        doc,
        editable,
        permsKnown,
        preview,
        synced: async () =>
          syncEngine.getStatus().online && !(await docs.unsyncedPages()).includes(pageId) && !(await syncEngine.isMissingContent(pageId)),
      }),
    [doc, editable, permsKnown, preview, docs, syncEngine, pageId],
  );

  /** Abre el anotador en una foto del Drive de la página (solo quien edita). */
  const openAnnotator = (item: CarreteItem) => {
    if (!editableRef.current || !item.mediaId) return;
    const id = item.mediaId;
    // La medida del archivo: el marco de la primera anotación (auditoría B1).
    setAnnotating({ item, loader: createCarreteLoader({ media, files }), size: () => media.dimensions(id) });
  };
  const openAnnotatorRef = useRef(openAnnotator);
  openAnnotatorRef.current = openAnnotator;
  // Lo creado para el anotador (los originales en memoria) se suelta al cerrarlo.
  useEffect(() => () => annotating?.loader.dispose(), [annotating]);

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
      badge: shortcutLabel('script'),
      icon: <ScriptIcon size={18} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'paragraph', props: { [SCRIPT_PROP]: true } }),
    };
    // "/Paragraph" en una línea Script también le saca la marca de guion.
    // Sin los "encabezados plegables" de BlockNote: todos los títulos se colapsan (P.11, Doc_Colapsar.md).
    const items = getDefaultReactSlashMenuItems(editor)
      .filter(notToggleHeading)
      // Los rótulos de los atajos, del registro (shortcuts.ts): el mismo formato que el resto de la app, y sin el
      // ⌘⌥C de "Bloque de código", que en esta versión de BlockNote no existe.
      .map((item) => ({ ...item, badge: slashBadge((item as { key?: string }).key) }))
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
    // El salto de hoja (Docs/Doc_Hojas_PDF.md): un párrafo con `pageBreak`, nunca un tipo de bloque nuevo.
    const pageBreak: DefaultReactSuggestionItem = {
      title: tr('editor.pageBreak'),
      subtext: tr('editor.pageBreakHint'),
      aliases: ['salto', 'salto de hoja', 'salto de pagina', 'salto de página', 'page break', 'pagebreak', 'break', 'hoja nueva', 'new page', 'new sheet'],
      group: basic,
      badge: shortcutLabel('pageBreak'),
      icon: <PageBreakIcon size={18} />,
      onItemClick: () => insertPageBreakForSlashMenu(editor),
    };
    const extra = [withParagraphVariants(script, editor, 'script'), questionSlashItem(editor, tr, basic), pageBreak];
    // "Take photo" y "Record video" (camera.ts), en el grupo de "Image", después de ella.
    const imageAt = variants.findIndex((i) => (i as { key?: string }).key === 'image');
    const camera: DefaultReactSuggestionItem[] = cameraOffer.map((kind) => ({
      title: tr(kind === 'photo' ? 'camera.takePhoto' : 'camera.recordVideo'),
      subtext: tr(kind === 'photo' ? 'camera.takePhotoHint' : 'camera.recordVideoHint'),
      aliases: kind === 'photo' ? ['camera', 'cámara', 'camara', 'foto', 'photo', 'sacar foto', 'picture'] : ['video', 'filmar', 'grabar', 'record', 'camera', 'cámara'],
      group: imageAt >= 0 ? variants[imageAt].group : basic,
      icon: kind === 'photo' ? <CameraIcon size={18} /> : <VideoIcon size={18} />,
      onItemClick: () => openCameraRef.current(kind),
    }));
    // "Folder" (P.9): la carpeta entera al Drive, después de "Image" y de la cámara.
    const folder: DefaultReactSuggestionItem[] = folderOffer
      ? [
          {
            title: tr('editor.folder'),
            subtext: tr('editor.folderHint'),
            aliases: ['folder', 'carpeta', 'directory', 'directorio', 'drive', 'upload', 'subir'],
            group: imageAt >= 0 ? variants[imageAt].group : basic,
            icon: <FolderGlyph size={18} />,
            onItemClick: () => chooseFolderRef.current(),
          },
        ]
      : [];
    const added = [...camera, ...folder];
    const withCamera = imageAt >= 0 ? [...variants.slice(0, imageAt + 1), ...added, ...variants.slice(imageAt + 1)] : [...variants, ...added];
    return (query: string) =>
      Promise.resolve(filterSuggestionItems([...withCamera.slice(0, at), ...extra, ...withCamera.slice(at)], query));
  }, [editor, tr, media, cameraOffer, folderOffer]);

  const toolbarItems = useMemo(
    () => pageToolbarItems(editor.dictionary, tr),
    [editor, tr],
  );

  // Comentarios (paso 10): el panel sabe qué dice cada bloque; el margen se dibuja sobre el editor.
  useBlockSourceRegistration(editor, pageId, !preview);

  // Sin portero, pegar o soltar un archivo que no es una imagen haría que el editor intente crear un bloque
  // que no existe en el esquema: se corta antes, con un aviso.
  const rejectOtherFiles = (e: ClipboardEvent | DragEvent, data: DataTransfer | null) => {
    if (filesNotice) {
      // La práctica no guarda archivos: ni fotos.
      if (!data?.files.length) return;
      e.preventDefault();
      e.stopPropagation();
      notify(filesNotice);
      return;
    }
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
    // Por un link, carpetas no (LE7): se avisa sin leerlas.
    if (media.noFolders) return notify(t('link.edit.noFolders'));
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
        // La misma carpeta a medio subir en esta página (mismo nombre, algún archivo en común): se ofrece seguir.
        const resumes = sources.map((s) => sameUpload(s));
        setFolderAsk({ sources, at, resumes });
      })
      .catch(() => notify(t('editor.fileNotSaved')));
  };

  /** Una subida a medias de esta página que parece la misma carpeta: mismo nombre y algún archivo con la misma ruta. */
  const sameUpload = (source: FolderSource): string | null => {
    const paths = new Set(source.files.map((f) => f.path));
    const match = (folders?.all() ?? []).find(
      (p) => p.pageId === pageId && p.name === source.name && p.state !== 'done' && folders!.hasAnyPath(p.id, paths),
    );
    return match?.id ?? null;
  };

  // "Folder" del menú "/": lo elegido en el selector abre la misma ventana que una carpeta soltada, y su bloque va
  // después del renglón donde estaba el cursor (un renglón vacío se reemplaza, como al soltar).
  chooseFolderRef.current = () => {
    const view = editor.prosemirrorView;
    if (!folderOffer || !view) return;
    const at: InsertAt = { blockId: editor.getTextCursorPosition().block.id, placement: 'after' };
    pickFolder(
      (sources) => {
        if (sources.length === 0) return notify(t('editor.folderNoFiles'));
        setFolderAsk({ sources, at, resumes: sources.map((source) => sameUpload(source)) });
      },
      () => !view.isDestroyed,
    );
  };

  /** Sube las carpetas confirmadas: registra cada una, pone su bloque donde se soltó y empieza a subir. */
  const uploadFolders = async (sources: FolderSource[], at: InsertAt | null, resumes: (string | null)[] = []) => {
    setFolderAsk(null);
    // Si el bloque donde se soltó ya no está (otro dispositivo lo borró mientras se confirmaba), después del cursor.
    let ref = at && editor.getBlock(at.blockId) ? at : { blockId: editor.getTextCursorPosition().block.id, placement: 'after' as const };
    for (const [n, source] of sources.entries()) {
      const again = resumes[n];
      if (again && folders) {
        const found = folders.resumeWith(again, source);
        notify(found > 0 ? t('folders.matched', { count: found }) : t('folders.noMatch'));
        if (sources.length === 1) setFolderUpload(again);
        continue;
      }
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

  const annotationContext = useRef({ services, workspace, user, pageId, doc, editor });
  annotationContext.current = { services, workspace, user, pageId, doc, editor };
  const annotationPending = useRef<(() => void) | null>(null);
  const openAnnotationResult = (request: ResultRequest, requestCurrent: () => boolean) => {
    annotationPending.current?.();
    const target = request.annotation;
    if (!target || !request.term || request.pageId !== pageId) return;
    const context = annotationContext.current;
    let cancelled = false;
    let published = false;
    const loader = createCarreteLoader({ media, files });
    const cancel = () => {
      cancelled = true;
      if (!published) loader.dispose();
      if (annotationPending.current === cancel) annotationPending.current = null;
    };
    annotationPending.current = cancel;
    const contextCurrent = () => {
      const now = annotationContext.current;
      const row = services.tree.get(pageId);
      return !cancelled && requestCurrent()
        && now.services === context.services && now.workspace === context.workspace && now.user === context.user
        && now.pageId === context.pageId && now.doc === context.doc && now.editor === context.editor
        && !!row && row.workspace_id === target.projectId && !services.tree.isTrashed(pageId)
        && new Permissions(services.tree, services.access.get(), user.id).pageLevel(pageId) >= LEVEL_VIEW;
    };
    const shapeMatches = () => {
      const shape = readPhotoMarkup(markupMap, target.fileId)?.shapes.find((s) => s.id === target.shapeId);
      return !!shape && shape.type === 'text' && searchNormalized(shape.text, normalize(shape.text), normalizeQuery(request.term!)).length > 0;
    };
    const resolve = () => {
      if (!contextCurrent()) return null;
      const items = collectCarrete(editor.document as unknown as BlockLike[], (id) => media.isFolder(id));
      const info = media.fileInfo(target.fileId);
      if (info && info.kind !== 'image') return null;
      const start = items.findIndex((item) => item.mediaId === target.fileId && item.blockId === request.blockId);
      const fallback = start >= 0 ? start : items.findIndex((item) => item.mediaId === target.fileId);
      return fallback >= 0 ? { items, start: fallback, loader } : null;
    };
    const changed = () => { if (contextCurrent()) notify(t('search.annotationChanged')); cancel(); };
    if (!resolve() || !shapeMatches()) { changed(); return; }
    void carreteItemsOf(editor.document as unknown as BlockLike[], media, {
      onLate: () => {
        const current = resolve();
        if (!current || !shapeMatches()) return;
        setCarrete((open) => open?.loader === loader ? current : open);
      },
    }).then(() => {
      const current = resolve();
      // La forma y el texto se releen después de preparar; nunca aceptar la foto por su ordinal anterior.
      if (!current || !shapeMatches()) { changed(); return; }
      published = true;
      setCarrete(current);
    }).catch(changed);
  };
  const openAnnotationResultRef = useRef(openAnnotationResult);
  openAnnotationResultRef.current = openAnnotationResult;
  useEffect(() => {
    if (!onAnnotationNavigator || preview) return;
    const own: AnnotationNavigator = { editor: editor as unknown as FindEditor, open: (request, current) => openAnnotationResultRef.current(request, current) };
    onAnnotationNavigator(own);
    return () => { annotationPending.current?.(); onAnnotationNavigator(null, own); };
  }, [editor, onAnnotationNavigator, preview]);

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
    // Los adjuntos entran (se ven en grande, con abrir y bajar: Docs/Doc_Adjuntos.md, entrega 2); las carpetas no
    // (tienen su visor). Si de algún archivo no se sabe qué es (una carpeta de otro dispositivo que la página no llegó
    // a dibujar), se averigua antes de abrir (`carreteItemsOf`); casi siempre ya se sabe y abre en el acto.
    const blocks = editor.document as unknown as BlockLike[];
    if (startIndex(collectCarrete(blocks, (id) => media.isFolder(id)), key) < 0) return false;
    // Con una red que no contesta se espera como mucho 1,5 s y se abre con lo que se sabe; si la respuesta llega
    // después y saca algo (una carpeta), el carrete abierto se actualiza.
    const loader = createCarreteLoader({ media, files });
    void carreteItemsOf(blocks, media, {
      onLate: (items) => setCarrete((open) => (open && open.loader === loader ? { ...open, items } : open)),
    }).then((items) => {
      const start = startIndex(items, key);
      if (start >= 0) setCarrete({ items, start, loader });
    });
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
  const folderInRef = useRef(folderIn);
  folderInRef.current = folderIn;
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
      onPhotoExport: editable && !link ? (key, trigger) => openPhotoExportRef.current(key, trigger) : undefined,
      onReplacePick: editable && !link ? (key, trigger) => prepareReplaceRef.current(key, trigger) : undefined,
      // Anotar (P.20): solo con la página editable; la barra de la foto ya solo se ve así.
      onAnnotate: editable
        ? (url, name) => {
            const mediaId = mediaIdOf(url);
            if (mediaId) openAnnotatorRef.current({ key: '', blockId: '', at: null, url, source: 'media', mediaId, name, caption: '' });
          }
        : undefined,
      // *Download all* de una carpeta (P.9, entrega 2): su visor, con la descarga abierta.
      onDownloadAll: (blockId) => {
        const folder = folderInRef.current(blockId);
        if (folder) setFolderView({ ...folder, download: true });
      },
    }),
    [editor, media, canComment, editable, link],
  );

  return (
    <div
      ref={host}
      className="editor-host"
      // El rótulo de la línea de los saltos de hoja (styles.css lo pone con `content`), en el idioma de la app.
      style={{ '--sd-page-break-label': JSON.stringify(tr('editor.pageBreak')) } as CSSProperties}
      onPasteCapture={(e) => rejectOtherFiles(e.nativeEvent, e.clipboardData)}
      onDropCapture={dropFiles}
      onPointerDownCapture={notePress}
      onFocusCapture={(e) => {
        if (editor.domElement?.contains(e.target as Node)) cursorPlaced.current = true;
      }}
      onKeyDownCapture={openWithKeyboard}
      onClickCapture={(e) => followInternalLink(e.nativeEvent, linkContext)}
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
        linkToolbar={false}
        sideMenu={false}
      >
        <SuggestionMenuController triggerCharacter="/" getItems={slashItems} />
        <PageFormattingToolbarController formattingToolbar={formattingToolbar} />
        {/* La barra de los links (Edit link, Open in new tab, Remove link) con los tooltips de la app (toolbarTips.tsx). */}
        <PageLinkToolbarController />
        {/* La barra de la foto en línea elegida (PhotoToolbar.tsx). */}
        {editable && <PhotoToolbarController />}
        {/* Los tres puntos de cada bloque: arrastrar lo mueve, un clic lo elige y abre la barra de formato. */}
        <BlockSideMenuController />
        {photoExport && <PhotoAnnotatedSheet item={photoExport.item} map={markupMap} loader={photoExport.loader} trigger={photoExport.trigger} isCurrent={photoExport.isCurrent} onClose={closePhotoExport} />}
        {photoReplacement && <PhotoReplaceSheet attempt={photoReplacement} />}
      </BlockNoteView>
      </MediaActionsContext.Provider>
      {!preview && <CommentMargin editor={editor} pageId={pageId} canComment={canComment} host={host} />}
      {/* El triángulo de cada título (P.11): una capa encima, como el margen. */}
      {canCollapse && <CollapseToggles editor={editor} host={host} editable={editable} canShare={canShare} />}
      {/* Dónde empieza cada hoja (solo una capa encima; roadmap B.7). */}
      <SheetBreaks pageId={pageId} host={host} />
      {editable && <DrivePasteMenu paste={drivePaste} editor={editor} />}
      {carrete && (
        <CarreteHost
          {...carrete}
          markup={markupMap}
          onAnnotate={editable ? (item) => (annotateAfterCarrete.current = item) : undefined}
          onClose={() => {
            setCarrete(null);
            const item = annotateAfterCarrete.current;
            annotateAfterCarrete.current = null;
            if (item) openAnnotatorRef.current(item);
          }}
        />
      )}
      {annotating && editable && (
        <Part onClose={() => setAnnotating(null)}>
          <Annotator
            doc={doc}
            fileId={annotating.item.mediaId!}
            name={annotating.item.name}
            item={annotating.item}
            loader={annotating.loader}
            size={annotating.size}
            onClose={() => setAnnotating(null)}
            onUndoSteps={
              inTimeline && !preview && !filesNotice
                ? (steps, map) => undoTimelineFor(services).pushMarkup(pageId, map, annotating.item.mediaId!, steps)
                : undefined
            }
          />
        </Part>
      )}
      {sheet && <AttachmentSheet fileId={sheet} onClose={() => setSheet(null)} />}
      {folderAsk && (
        <FolderAskDialog
          sources={folderAsk.sources}
          resumes={folderAsk.resumes}
          onCancel={() => setFolderAsk(null)}
          onConfirm={(sources, resume) => void uploadFolders(sources, folderAsk.at, resume ? folderAsk.resumes : [])}
        />
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
          startDownload={!!folderView.download}
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

interface OpenAnnotator {
  item: CarreteItem;
  loader: CarreteLoader;
  size: () => Promise<{ width: number; height: number } | null>;
}

/** El carrete con el estado de la red (aparte, para que el editor no se vuelva a dibujar con cada cambio). */
function CarreteHost(props: OpenCarrete & { onClose: () => void; markup: Y.Map<unknown>; onAnnotate?: (item: CarreteItem) => void }) {
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
