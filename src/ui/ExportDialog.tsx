import { useEffect, useMemo, useRef, useState } from 'react';
import { t, useT } from '../i18n';
import { notify } from './notice';
import '../i18n/lazy/exportPdf';
import '../i18n/lazy/exportZip';
import { appComments } from '../export/exportComments';
import { ExportCancelled, ExportEditor } from '../export/exportEditor';
import { deviceImages, PhotoLimitError } from '../export/exportImages';
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

// La ventana *Export* (P.22, Docs/Doc_Exportar.md, sección 7; entrega 1: el PDF; entrega 2: el zip, en ExportZip.tsx).
// Desde el menú de una página (esta página, o con las de adentro) o desde el de un proyecto (el proyecto entero). Arma la vista del PDF
// (src/export/exportPdf.ts) con avance y *Cancel*, y abre el diálogo de imprimir, donde se elige *Save as PDF*. La
// vista queda armada mientras la ventana está abierta (se puede volver a abrir el diálogo) y se suelta al cerrarla.
// Exportar nunca escribe nada: lee copias de lo guardado en el dispositivo.

export type ExportTarget = { kind: 'page' | 'project'; id: string };

type Scope = 'page' | 'branch' | 'project';

type Phase =
  | { name: 'choose' }
  | { name: 'working'; progress: ExportProgress | null }
  | { name: 'ready'; book: PdfBook }
  | { name: 'tooBig'; reason: 'pages' | 'photos' }
  | { name: 'failed' };

/** Las páginas de una elección (la raíz sola, la rama o el proyecto). */
function planFor(tree: PageTree, target: ExportTarget, scope: Scope): ExportPlanPage[] {
  if (target.kind === 'project') return exportPlan(tree, 'project', target.id);
  const branch = exportPlan(tree, 'page', target.id);
  return scope === 'page' ? branch.slice(0, 1) : branch;
}

/** Las partes más chicas para ofrecer si no entra: las del primer nivel de lo elegido, con su cantidad de páginas. */
function smallerParts(tree: PageTree, plan: ExportPlanPage[], target: ExportTarget): { id: string; title: string; pages: number }[] {
  const level = target.kind === 'project' ? 0 : 1;
  return plan
    .filter((p) => p.depth === level)
    .map((p) => ({ id: p.id, title: p.title, pages: exportPlan(tree, 'page', p.id).length }));
}

export function ExportDialog(props: { target: ExportTarget; onClose: () => void }) {
  const tree = useTree();
  const { docs, media, comments, commentsDb, user, engine } = useServices();
  const status = useSyncStatus();
  const tr = useT();
  const [target, setTarget] = useState<ExportTarget>(props.target);
  const inside = target.kind === 'page' ? Math.max(0, exportPlan(tree, 'page', target.id).length - 1) : 0;
  const [scope, setScope] = useState<Scope>(target.kind === 'project' ? 'project' : inside > 0 ? 'branch' : 'page');
  const [sharp, setSharp] = useState(false);
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
  const unprint = useRef<(() => void) | null>(null);
  const touch = useMemo(() => touchDevice(), []);
  const named = useMemo(() => keepsPageSizes(), []);
  const limits = useMemo(() => deviceLimits(touch), [touch]);

  const plan = useMemo(() => planFor(tree, target, scope), [tree, target, scope]);
  const title = target.kind === 'project' ? (tree.project(target.id)?.name ?? '') : (tree.get(target.id)?.title ?? '');
  const shownTitle = title.trim() || tr('common.untitled');
  const tooMany = format === 'pdf' && plan.length > limits.pages;
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

  async function run() {
    if (plan.length === 0 || tooMany) return;
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ name: 'working', progress: null });
    let editor: ExportEditor | null = null;
    try {
      const withMedia = media.enabled;
      editor = await ExportEditor.create({
        lang: tr.lang,
        resolveFileUrl: withMedia ? (url, pageId) => media.resolve(url, pageId) : undefined,
        media: withMedia ? media : null,
      });
      const states = await docs.states();
      const result = await buildPdf({
        // Una rama nunca nombra el proyecto (regla 2): el índice empieza en su página.
        title,
        plan,
        source: docs,
        editor,
        gap: (id) => {
          const row = tree.get(id);
          if (!row || tree.hasUnsentCreate(id)) return null;
          return tree.contentGap(row, states.get(id)?.cursor ?? 0);
        },
        images: withMedia ? deviceImages(media, { download: sharp && online ? porteroDownload(media) : null, maxDownloads: limits.sharp }) : null,
        comments: withComments ? appComments(comments, commentsDb, { id: user.id, email: user.email }) : null,
        named,
        limits,
        lastSync: engine.getStatus().lastSyncAt,
        signal: controller.signal,
        onProgress: (progress) => setPhase({ name: 'working', progress }),
      });
      if (controller.signal.aborted) {
        result.destroy();
        return;
      }
      book.current = result;
      setPhase({ name: 'ready', book: result });
      // En la computadora el diálogo se abre solo; en un táctil hace falta un toque (lo pide el navegador).
      if (!touch) openPrint(result);
    } catch (err) {
      if (err instanceof ExportCancelled || controller.signal.aborted) {
        setPhase({ name: 'choose' });
      } else if (err instanceof PhotoLimitError) {
        setPhase({ name: 'tooBig', reason: 'photos' });
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

  /** Cambiar a una parte más chica: tira lo armado. */
  function pick(id: string) {
    book.current?.destroy();
    book.current = null;
    setTarget({ kind: 'page', id });
    setScope('branch');
    setPhase({ name: 'choose' });
  }

  const parts = tooMany || phase.name === 'tooBig' ? smallerParts(tree, plan, target) : [];
  const rootSize = plan[0] ? sizeLabel(plan[0].format.size === 'free' ? 'A4' : plan[0].format.size, tr) : 'A4';
  const pages = phase.name === 'ready' ? phase.book.pages : [];
  const count = (which: (p: PdfBook['pages'][number]) => boolean) => pages.filter(which).length;

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

        {(phase.name === 'choose' || phase.name === 'tooBig' || phase.name === 'failed') && (
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
                    <label data-tip={tr('exportDialog.sharpTip')}>
                      <input type="checkbox" checked={sharp && online} disabled={!online} onChange={(e) => setSharp(e.target.checked)} />
                      {tr('exportDialog.sharp')}
                    </label>
                  )}
                  <label data-tip={tr('exportDialog.commentsTip')}>
                    <input type="checkbox" checked={withComments} onChange={(e) => setWithComments(e.target.checked)} />
                    {tr('exportDialog.comments')}
                  </label>
                </div>
                {!named && <p className="muted">{tr('exportDialog.oneSize', { size: rootSize })}</p>}
                <p className="muted">{tr('exportDialog.margins')}</p>
                {plan.length === 0 && <p className="error">{tr('exportDialog.empty')}</p>}
                {phase.name === 'failed' && <p className="error">{tr('exportDialog.failed')}</p>}
                {(tooMany || phase.name === 'tooBig') && (
                  <div className="export-too-big">
                    <p className="error">
                      {tooMany ? tr('exportDialog.tooManyPages', { count: plan.length, limit: limits.pages }) : tr('exportDialog.tooManyPhotos')}
                    </p>
                    <ul>
                      {parts.map((p) => (
                        <li key={p.id}>
                          <button className="link" onClick={() => pick(p.id)}>
                            {tr('exportDialog.branch', { title: p.title.trim() || tr('common.untitled'), count: p.pages })}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="modal-actions">
                  <button onClick={props.onClose}>{tr('common.cancel')}</button>
                  <button className="primary" disabled={plan.length === 0 || tooMany} onClick={() => void run()}>
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
                  : tr('exportDialog.preparing', {
                      done: Math.min((phase.progress?.done ?? 0) + 1, phase.progress?.total ?? plan.length),
                      total: phase.progress?.total ?? plan.length,
                      // Antes del primer aviso, la primera página (no "Untitled").
                      title: (phase.progress ? phase.progress.title : (plan[0]?.title ?? '')).trim() || tr('common.untitled'),
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
              <strong>{tr('exportDialog.ready', { count: phase.book.sheets })}</strong> {tr('exportDialog.saveAsPdf')}
            </p>
            {count((p) => p.imagesTimedOut) > 0 && <p className="muted">{tr('exportDialog.missingPhotos', { count: count((p) => p.imagesTimedOut) })}</p>}
            {count((p) => p.outdated) > 0 && <p className="muted">{tr('exportDialog.outdatedPages', { count: count((p) => p.outdated) })}</p>}
            {count((p) => p.unknown) > 0 && <p className="muted">{tr('exportDialog.unknownPages', { count: count((p) => p.unknown) })}</p>}
            {phase.book.commentsStale > 0 && <p className="muted">{tr('exportDialog.commentsStale', { count: phase.book.commentsStale })}</p>}
            {count((p) => p.failed) > 0 && <p className="error">{tr('exportDialog.failedPages', { count: count((p) => p.failed) })}</p>}
            <p className="muted">{tr('exportDialog.margins')}</p>
            <div className="modal-actions">
              <button onClick={props.onClose}>{tr('common.close')}</button>
              <button className="primary" onClick={() => openPrint(phase.book)}>
                {tr('exportDialog.print')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
