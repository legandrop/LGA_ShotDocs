import { useEffect, useMemo, useRef, useState } from 'react';
import { t, useT } from '../i18n';
import { notify } from './notice';
import '../i18n/lazy/exportPdf';
import '../i18n/lazy/exportZip';
import { appComments } from '../export/exportComments';
import { ExportCancelled, ExportEditor } from '../export/exportEditor';
import { deviceImages } from '../export/exportImages';
import { exportPlan, type ExportPlanPage, type ExportProgress } from '../export/exportPages';
import { buildPdf, deviceLimits, printBook, type PdfBook } from '../export/exportPdf';
import { keepsPageSizes, touchDevice } from '../export/printSupport';
import { usePermissions, useServices, useSyncStatus, useTree } from '../services';
import type { PageTree } from '../sync/tree';
import { isPrintShortcut } from './printPage';
import { sizeLabel } from './pageFormat';
import { zipAllowed } from '../export/exportZip';
import { ExportZipPanel } from './ExportZip';
import { detectPlatform, isMobilePlatform } from './install';
import { porteroDownload } from './sharpImages';
import { navigate, pagePath } from '../router';
import { loadFileLinks, type FileLinkPlan } from '../export/exportLinks';
import { fileHref, linkHash } from '../fileLink';
import { useLinkMode } from '../linkMode';
import { mediaLinkSource } from './mediaLinks';
import { FileLinksNotice, fileLinksTickedByDefault } from './FileLinksNotice';

// La ventana *Export* (P.22, Docs/Doc_Exportar.md, sección 7; entrega 1: el PDF; entrega 2: el zip, en ExportZip.tsx).
// Desde el menú de una página (esta página, o con las de adentro) o desde el de un proyecto (el proyecto entero). Arma la vista del PDF
// (src/export/exportPdf.ts) con avance y *Cancel*, y abre el diálogo de imprimir, donde se elige *Save as PDF*. La
// vista queda armada mientras la ventana está abierta (se puede volver a abrir el diálogo) y se suelta al cerrarla.
// Exportar nunca escribe nada: lee copias de lo guardado en el dispositivo.
//
// Entrega 1b (Lega 2026-10-02): las fotos van en resolución completa salvo con *Smaller file* (D85); si lo elegido no
// entra en un PDF de este dispositivo, sale en partes, una por vez (D84: la siguiente se arma al pedirla, soltando la
// anterior); y al terminar, la lista de las páginas que fallaron, cada una con su link y *Export again* (D88).

export type ExportTarget = { kind: 'page' | 'project'; id: string };

type Scope = 'page' | 'branch' | 'project';

type Phase =
  | { name: 'choose' }
  | { name: 'working'; progress: ExportProgress | null; part: number; first?: string }
  | { name: 'ready'; book: PdfBook }
  | { name: 'failed' };

/** Una página que no se pudo exportar (D88): se juntan las de todas las partes. */
type Failure = { id: string; title: string; reason: 'error' | 'photos' | 'timeout' };

/** Las páginas de una elección (la raíz sola, la rama o el proyecto). */
function planFor(tree: PageTree, target: ExportTarget, scope: Scope): ExportPlanPage[] {
  if (target.kind === 'project') return exportPlan(tree, 'project', target.id);
  const branch = exportPlan(tree, 'page', target.id);
  return scope === 'page' ? branch.slice(0, 1) : branch;
}

/** El HEIC a JPEG con el convertidor de la app (se baja aparte, solo si hace falta). */
const convertHeic = async (blob: Blob) => (await import('../media/heicConvert')).convertHeic(blob);

export function ExportDialog(props: { target: ExportTarget; onClose: () => void }) {
  const tree = useTree();
  const { docs, media, comments, commentsDb, user, engine, client, workspace } = useServices();
  const linkMode = useLinkMode();
  const status = useSyncStatus();
  const tr = useT();
  const target = props.target;
  const inside = target.kind === 'page' ? Math.max(0, exportPlan(tree, 'page', target.id).length - 1) : 0;
  const [scope, setScope] = useState<Scope>(target.kind === 'project' ? 'project' : inside > 0 ? 'branch' : 'page');
  /** *Smaller file* (D85): las fotos achicadas a su tamaño impreso; destildada, en resolución completa. */
  const [smaller, setSmaller] = useState(false);
  const [withComments, setWithComments] = useState(false);
  /** Para qué (EX1): el PDF para compartir o el zip para archivar. */
  const [format, setFormat] = useState<'pdf' | 'zip'>('pdf');
  /** El zip está trabajando: no se cierra ni se cambia qué se exporta. */
  const [zipBusy, setZipBusy] = useState(false);
  const perms = usePermissions();
  // El zip (D60, D63: Lega 2026-10-02): solo el dueño y los admins, y nunca desde un teléfono o una tableta (el mismo
  // criterio que el tope de *Download all*: iPhone, iPad y Android, instalada o en el navegador). El PDF, siempre.
  const phone = useMemo(() => isMobilePlatform(detectPlatform()), []);
  const zipBlocked = phone ? tr('exportZip.notOnPhone') : !zipAllowed(perms) ? tr('exportZip.adminsOnly') : null;
  const [phase, setPhase] = useState<Phase>({ name: 'choose' });
  const abort = useRef<AbortController | null>(null);
  const book = useRef<PdfBook | null>(null);
  /** Los comentarios: uno por ventana, así las partes no vuelven a bajar los de las páginas ya bajadas. */
  const commentSource = useRef<ReturnType<typeof appComments> | null>(null);
  const unprint = useRef<(() => void) | null>(null);
  const touch = useMemo(() => touchDevice(), []);
  const named = useMemo(() => keepsPageSizes(), []);
  const limits = useMemo(() => deviceLimits(touch), [touch]);

  const plan = useMemo(() => planFor(tree, target, scope), [tree, target, scope]);
  // Los links públicos que pueden usar los links a los archivos (P.30, LF17 y LF18): solo con una cuenta y con red.
  const [fileLinks, setFileLinks] = useState<FileLinkPlan | null>(null);
  /** La casilla: tildada si todos los links son *Can view*, destildada si alguno es *Can edit*. */
  const [useFileLinks, setUseFileLinks] = useState(true);
  /**
   * La persona tocó la casilla para lo elegido ahora: volver a pedir los links (la red se cortó y volvió) no la pisa (un
   * *Can view* destildado a mano no vuelve a salir con el token). Cambiar qué se exporta la vuelve a su valor de fábrica.
   */
  const fileLinksTouched = useRef<{ plan: ExportPlanPage[]; touched: boolean }>({ plan, touched: false });
  if (fileLinksTouched.current.plan !== plan) fileLinksTouched.current = { plan, touched: false };
  const chooseFileLinks = (checked: boolean) => {
    fileLinksTouched.current = { plan, touched: true };
    setUseFileLinks(checked);
  };
  useEffect(() => {
    setFileLinks(null);
    if (linkMode || !media.enabled || !status.online || plan.length === 0) return;
    let live = true;
    const parentOf = (id: string) => tree.get(id)?.parent_id ?? null;
    const titleOf = (id: string) => tree.get(id)?.title?.trim() || t('common.untitled');
    void loadFileLinks(client, plan.map((p) => p.id), parentOf, titleOf).then((found) => {
      if (!live) return;
      setFileLinks(found);
      if (!fileLinksTouched.current.touched) setUseFileLinks(fileLinksTickedByDefault(found));
    });
    return () => {
      live = false;
    };
  }, [plan, linkMode, media.enabled, status.online, client, tree]);
  const title = target.kind === 'project' ? (tree.project(target.id)?.name ?? '') : (tree.get(target.id)?.title ?? '');
  const shownTitle = title.trim() || tr('common.untitled');
  const [failures, setFailures] = useState<Failure[]>([]);
  /** El diálogo de imprimir ya se abrió para el PDF listo (en un táctil no se abre solo: hasta entonces, nada lo suelta). */
  const [printed, setPrinted] = useState(false);
  const online = status.online && (typeof navigator === 'undefined' || navigator.onLine !== false);
  const working = phase.name === 'working' || zipBusy;

  // Al cerrar: cancela lo que está armando, deja la impresión como estaba y suelta la vista.
  useEffect(
    () => () => {
      abort.current?.abort();
      unprint.current?.();
      book.current?.destroy();
      book.current = null;
    },
    [],
  );

  const close = () => {
    if (working) return;
    props.onClose();
  };

  function openPrint(current: PdfBook) {
    unprint.current?.();
    setPrinted(true);
    try {
      unprint.current = printBook(current, { touch, onDone: () => (unprint.current = null) });
    } catch {
      unprint.current = null;
      notify(t('exportDialog.dialogFailed'));
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !working) {
        props.onClose();
        return;
      }
      // Ctrl/⌘+P con el PDF listo: este PDF, no la página de atrás (printPage.ts mira `defaultPrevented`). Mientras
      // arma, nada (el libro a medio armar no se imprime).
      if ((phase.name === 'ready' || phase.name === 'working') && isPrintShortcut(e)) {
        e.preventDefault();
        if (phase.name === 'ready') openPrint(phase.book);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  /**
   * Arma un PDF: lo elegido desde la página `from` (una parte), o una sola página (`only`, *Export again*). Antes suelta
   * lo armado (nunca dos partes en la memoria).
   */
  async function run(from = 0, part = 1, only: ExportPlanPage | null = null) {
    const what = only ? [{ ...only, depth: 0, parent: null }] : plan;
    if (what.length === 0) return;
    unprint.current?.();
    // Los originales ya traídos de la página que no entró en la parte anterior (D84: no se bajan dos veces).
    const carry = !only && from > 0 && book.current?.to === from ? book.current.carry : null;
    book.current?.destroy();
    book.current = null;
    setPrinted(false);
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ name: 'working', progress: null, part: only ? 1 : part, first: what[only ? 0 : from]?.title });
    if (from === 0 && !only) setFailures([]);
    let editor: ExportEditor | null = null;
    try {
      const withMedia = media.enabled;
      // Con un link público tildado, sus archivos van con el token del link; los demás, con la dirección de siempre.
      const source = mediaLinkSource();
      const chosen = useFileLinks && fileLinks && fileLinks.links.length > 0 ? fileLinks : null;
      const config = workspace.config;
      editor = await ExportEditor.create({
        lang: tr.lang,
        mediaHref: chosen
          ? (id, pageId) => {
              const link = chosen.byPage.get(pageId);
              if (!link) return source ? source.href(id) : null;
              return fileHref(location.origin, config.localKey, id, linkHash({ u: config.url, k: config.publishableKey, l: config.localKey, t: link.token }));
            }
          : undefined,
        resolveFileUrl: withMedia ? (url, pageId) => media.resolve(url, pageId) : undefined,
        media: withMedia ? media : null,
      });
      const states = await docs.states();
      const full = withMedia && !smaller;
      const result = await buildPdf({
        // Una rama nunca nombra el proyecto (regla 2): el índice empieza en su página.
        title: only ? only.title : title,
        plan: what,
        from: only ? 0 : from,
        part: only ? 1 : part,
        carry,
        source: docs,
        editor,
        gap: (id) => {
          const row = tree.get(id);
          if (!row || tree.hasUnsentCreate(id)) return null;
          return tree.contentGap(row, states.get(id)?.cursor ?? 0);
        },
        images: withMedia
          ? deviceImages(media, {
              // *Smaller file*: la nítida (2048) pedida al Drive si el dispositivo no la tiene. Resolución completa: el
              // original de cada foto, del dispositivo o bajado entero por el portero.
              download: smaller && online ? porteroDownload(media) : null,
              maxDownloads: limits.sharp,
              originals: full && online ? porteroDownload(media) : null,
            })
          : null,
        full,
        convertHeic: full ? convertHeic : null,
        comments: withComments ? (commentSource.current ??= appComments(comments, commentsDb, { id: user.id, email: user.email })) : null,
        named,
        limits,
        lastSync: engine.getStatus().lastSyncAt,
        signal: controller.signal,
        onProgress: (progress) => setPhase({ name: 'working', progress, part: only ? 1 : part, first: undefined }),
      });
      if (controller.signal.aborted) {
        result.destroy();
        return;
      }
      book.current = result;
      // Las que fallaron, juntas (D88): las de esta parte se suman; la reexportada sola sale de la lista si salió bien.
      // También las que salieron con alguna foto cuyo original no llegó a tiempo: *Export again* lo vuelve a intentar.
      const failedNow: Failure[] = result.pages
        .filter((p) => p.failed || p.timedOut > 0)
        .map((p) => ({ id: p.id, title: p.title, reason: p.failed ? (p.failReason ?? 'error') : 'timeout' }));
      setFailures((list) => {
        const rest = list.filter((f) => !result.pages.some((p) => p.id === f.id));
        return [...rest, ...failedNow];
      });
      setPhase({ name: 'ready', book: result });
      // En la computadora el diálogo se abre solo; en un táctil hace falta un toque (lo pide el navegador).
      if (!touch) openPrint(result);
    } catch (err) {
      if (err instanceof ExportCancelled || controller.signal.aborted) {
        setPhase({ name: 'choose' });
      } else {
        console.warn('[exportar] no se pudo armar el PDF', err);
        setPhase({ name: 'failed' });
      }
    } finally {
      editor?.destroy();
      if (abort.current === controller) abort.current = null;
    }
  }

  function cancel() {
    abort.current?.abort();
  }

  /** Ir a una página que falló: cierra la ventana (Ctrl/⌘ o la rueda la abren en otra pestaña, como cualquier link). */
  function goTo(e: React.MouseEvent, id: string) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (working) return;
    props.onClose();
    navigate(pagePath(id));
  }

  /** *Export again*: esa página sola, en un PDF aparte. */
  function retry(id: string) {
    const page = exportPlan(tree, 'page', id)[0];
    if (page) void run(0, 1, page);
  }
  const rootSize = plan[0] ? sizeLabel(plan[0].format.size === 'free' ? 'A4' : plan[0].format.size, tr) : 'A4';
  const pages = phase.name === 'ready' ? phase.book.pages : [];
  const count = (which: (p: PdfBook['pages'][number]) => boolean) => pages.filter(which).length;
  const lowRes = pages.reduce((sum, p) => sum + (p.shrunkToFit ? 0 : p.lowRes), 0);
  /** Terminó todo lo elegido (la última parte, o el único PDF): ahí va la lista de las que fallaron (D88). */
  const finished = phase.name === 'ready' && phase.book.to >= phase.book.total;
  /** En un táctil, lo listo se suelta solo después de abrir su diálogo (si no, se perdería sin guardar). */
  const mustPrintFirst = touch && phase.name === 'ready' && !printed;

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={tr('exportDialog.title', { title: shownTitle })}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{tr('exportDialog.title', { title: shownTitle })}</h2>

        {(phase.name === 'choose' || phase.name === 'failed') && (
          <>
            {zipBusy ? null : target.kind === 'page' && inside > 0 ? (
              <fieldset className="export-what">
                <legend className="sr-only">{tr('exportDialog.what')}</legend>
                <label>
                  <input type="radio" name="export-what" checked={scope === 'page'} onChange={() => setScope('page')} />
                  {tr('exportDialog.thisPage')}
                </label>
                <label>
                  <input type="radio" name="export-what" checked={scope === 'branch'} onChange={() => setScope('branch')} />
                  {tr('exportDialog.withInside', { count: inside })}
                </label>
              </fieldset>
            ) : (
              <p className="muted export-subtitle">
                {target.kind === 'project' ? tr('exportDialog.project', { count: plan.length }) : tr('exportDialog.thisPage')}
              </p>
            )}
            {!zipBusy && (
              <fieldset className="export-what">
                <legend className="sr-only">{tr('exportZip.format')}</legend>
                <label>
                  <input type="radio" name="export-format" checked={format === 'pdf'} onChange={() => setFormat('pdf')} />
                  <strong>{tr('exportDialog.pdf')}</strong>
                </label>
                <label {...(zipBlocked ? { 'data-tip': zipBlocked, 'aria-disabled': true } : {})}>
                  <input type="radio" name="export-format" checked={format === 'zip' && !zipBlocked} disabled={!!zipBlocked} onChange={() => setFormat('zip')} />
                  <strong>{tr('exportZip.zip')}</strong>
                </label>
              </fieldset>
            )}
            {format === 'zip' && !zipBlocked ? (
              <ExportZipPanel
                plan={plan}
                kind={target.kind}
                project={target.kind === 'project' ? { id: target.id, name: title } : null}
                title={title}
                onBusy={setZipBusy}
                onClose={props.onClose}
              />
            ) : (
              <>
                <p className="export-format">
                  <span className="muted">{tr('exportDialog.pdfNote')}</span>
                </p>
                <div className="export-options">
                  {media.enabled && (
                    <label data-tip={tr('exportDialog.smallerTip')}>
                      <input type="checkbox" checked={smaller} onChange={(e) => setSmaller(e.target.checked)} />
                      {tr('exportDialog.smaller')}
                    </label>
                  )}
                  <label data-tip={tr('exportDialog.commentsTip')}>
                    <input type="checkbox" checked={withComments} onChange={(e) => setWithComments(e.target.checked)} />
                    {tr('exportDialog.comments')}
                  </label>
                </div>
                {media.enabled && !smaller && !online && <p className="muted">{tr('exportDialog.offlineOriginals')}</p>}
                <FileLinksNotice plan={fileLinks} checked={useFileLinks} onChange={chooseFileLinks} />
                {!named && <p className="muted">{tr('exportDialog.oneSize', { size: rootSize })}</p>}
                <p className="muted">{tr('exportDialog.margins')}</p>
                {plan.length === 0 && <p className="error">{tr('exportDialog.empty')}</p>}
                {phase.name === 'failed' && <p className="error">{tr('exportDialog.failed')}</p>}
                <div className="modal-actions">
                  <button onClick={props.onClose}>{tr('common.cancel')}</button>
                  <button className="primary" disabled={plan.length === 0} onClick={() => void run()}>
                    {tr('exportDialog.export')}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {phase.name === 'working' && (
          <>
            <div className="export-progress" role="status">
              <progress max={Math.max(1, phase.progress?.total ?? plan.length)} value={phase.progress?.done ?? 0} />
              <span>
                {phase.progress?.step === 'comments'
                  ? tr('exportDialog.fetchingComments', {
                      done: Math.min(phase.progress.done + 1, phase.progress.total),
                      total: phase.progress.total,
                    })
                  : tr(phase.part > 1 ? 'exportDialog.preparingPart' : 'exportDialog.preparing', {
                      part: phase.part,
                      done: Math.min((phase.progress?.done ?? 0) + 1, phase.progress?.total ?? plan.length),
                      total: phase.progress?.total ?? plan.length,
                      // Antes del primer aviso, la página donde empieza (no "Untitled").
                      title: (phase.progress ? phase.progress.title : (phase.first ?? '')).trim() || tr('common.untitled'),
                    })}
              </span>
            </div>
            <div className="modal-actions">
              <button onClick={cancel}>{tr('common.cancel')}</button>
            </div>
          </>
        )}

        {phase.name === 'ready' && (
          <>
            <p>
              <strong>
                {phase.book.part === null
                  ? tr('exportDialog.ready', { count: phase.book.sheets })
                  : tr('exportDialog.partReady', { part: phase.book.part, first: phase.book.from + 1, last: phase.book.to, total: phase.book.total, count: phase.book.sheets })}
              </strong>{' '}
              {tr('exportDialog.saveAsPdf')}
            </p>
            {phase.book.part !== null && (
              <p className="muted">{phase.book.to < phase.book.total ? tr('exportDialog.nextPartNote') : tr('exportDialog.lastPart')}</p>
            )}
            {lowRes > 0 && <p className="muted">{tr('exportDialog.lowRes', { count: lowRes })}</p>}
            {count((p) => p.shrunkToFit) > 0 && <p className="muted">{tr('exportDialog.shrunkPages', { count: count((p) => p.shrunkToFit) })}</p>}
            {count((p) => p.imagesTimedOut) > 0 && <p className="muted">{tr('exportDialog.missingPhotos', { count: count((p) => p.imagesTimedOut) })}</p>}
            {count((p) => p.outdated) > 0 && <p className="muted">{tr('exportDialog.outdatedPages', { count: count((p) => p.outdated) })}</p>}
            {count((p) => p.unknown) > 0 && <p className="muted">{tr('exportDialog.unknownPages', { count: count((p) => p.unknown) })}</p>}
            {phase.book.commentsStale > 0 && <p className="muted">{tr('exportDialog.commentsStale', { count: phase.book.commentsStale })}</p>}
            {count((p) => p.failed) > 0 && !finished && <p className="error">{tr('exportDialog.failedPages', { count: count((p) => p.failed) })}</p>}
            {finished && failures.length > 0 && (
              <div className="export-failed" role="group" aria-label={tr('exportDialog.failedList')}>
                <p className="error">{tr('exportDialog.failedList')}</p>
                <ul>
                  {failures.map((f) => {
                    const shown = f.title.trim() || tr('common.untitled');
                    return (
                      <li key={f.id}>
                        <a href={pagePath(f.id)} onClick={(e) => goTo(e, f.id)}>
                          {shown}
                        </a>
                        {f.reason === 'photos' && <span className="muted small">{tr('exportDialog.failedTooBig')}</span>}
                        {f.reason === 'timeout' && <span className="muted small">{tr('exportDialog.failedTimeout')}</span>}
                        <button
                          className="small"
                          aria-label={tr('exportDialog.retryLabel', { title: shown })}
                          disabled={mustPrintFirst}
                          {...(mustPrintFirst ? { 'data-tip': tr('exportDialog.printFirst') } : {})}
                          onClick={() => retry(f.id)}
                        >
                          {tr('exportDialog.retry')}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <p className="muted">{tr('exportDialog.margins')}</p>
            <div className="modal-actions">
              <button onClick={props.onClose}>{tr('common.close')}</button>
              {phase.book.to < phase.book.total ? (
                <>
                  {/* En un táctil el diálogo no se abrió solo: lo primero es abrirlo y guardar esta parte. */}
                  <button className={touch ? 'primary' : ''} onClick={() => openPrint(phase.book)}>
                    {tr('exportDialog.print')}
                  </button>
                  <button
                    className={touch ? '' : 'primary'}
                    disabled={mustPrintFirst}
                    {...(mustPrintFirst ? { 'data-tip': tr('exportDialog.printFirst') } : {})}
                    onClick={() => void run(phase.book.to, (phase.book.part ?? 1) + 1, null)}
                  >
                    {tr('exportDialog.nextPart', { part: (phase.book.part ?? 1) + 1 })}
                  </button>
                </>
              ) : (
                <button className="primary" onClick={() => openPrint(phase.book)}>
                  {tr('exportDialog.print')}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
