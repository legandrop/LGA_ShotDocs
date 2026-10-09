import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t as tGlobal, useT, type Translate } from '../i18n';
import { navigate, pagePath } from '../router';
import { usePermissions, useServices, useSyncStatus, useTree, type Services } from '../services';
import { Permissions } from '../sync/access';
import type { CommentRemote } from '../sync/comments';
import { SupabaseCommentRemote } from '../sync/commentsRemote';
import { getPublicLink } from '../sync/publicLinks';
import { notify } from '../ui/notice';
import { useCurrentProject } from '../ui/project';
import { existingRelationsSession } from '../ui/relationsUi';
import { addsNothing, restorePage, audienceOk, canOffer, contentCounts, defaultKeep, mergeGuard, mergeRows, type AudienceInfo, type MergeBlock, type MergeRow } from './merge';
import type { MergeDeps, MergeFailure, MergeJob, MergeOutcome } from './mergeJob';
import './merge.css';

// *Merge…* (E16, alcance reducido; Docs/Doc_Relaciones.md, sección 20): el botón en *Map › Pending* y en la cabecera viva
// de las dos páginas, el adelanto con las dos, el aviso con *Open* y *Undo*, y los renglones de *Pending* de después (lo
// que llegó tarde a la página unida, una unión a una página que está en la papelera, una unión que no terminó en este
// dispositivo). La escritura (`mergeJob.ts`, `mergeWrite.ts`) se baja recién al unir.

/** Dos páginas de la misma escena (`code`) o dos reportes del mismo día (`kind: 'day'`, `code` es el título). */
export interface MergePair {
  code: string;
  pageIds: string[];
  kind?: 'day';
}

/** M1: nivel 4 en la página, nunca un invitado ni quien recibe base limpia, nunca con un link. */
export function canMergeWith(perms: Pick<Permissions, 'canManagePage' | 'role' | 'viaLink'>, services: Pick<Services, 'engine'> | { engine: { isBaseReader(pageId: string): boolean } }) {
  return (pageId: string) => perms.canManagePage(pageId) && perms.role !== 'guest' && !perms.viaLink && !services.engine.isBaseReader(pageId);
}

/** Los comentarios se leen de la base (`comments_view`, también los borrados y resueltos). */
function commentSource(services: Services): Pick<CommentRemote, 'fetchComments'> {
  // Las pruebas montan la app con el servidor en memoria, que también contesta los comentarios.
  const r = services.remote as unknown as Partial<CommentRemote>;
  return typeof r.fetchComments === 'function' ? (r as CommentRemote) : new SupabaseCommentRemote(services.client);
}

/** Quién ve una página más allá de su carpeta (C6): permisos de página propios (en ella o arriba) y un link público. */
async function audienceOf(services: Services, pageId: string): Promise<AudienceInfo | null> {
  try {
    const [rows, link] = await Promise.all([services.remote.listAccess({ pageId }), getPublicLink(services.client, pageId)]);
    return { ownGrants: rows.some((r) => r.source === 'page' || r.source === 'parent_page'), publicLink: !!(link?.link || link?.above) };
  } catch {
    return null;
  }
}

/** Las dependencias del trabajo con los servicios de la app. */
async function depsFor(services: Services, check: MergeDeps['check']): Promise<MergeDeps> {
  const { mergeDepsFrom } = await import('./mergeJob');
  return mergeDepsFrom(services, { comments: commentSource(services), check });
}

const BLOCK_KEYS: Record<MergeBlock | Exclude<MergeFailure, MergeBlock>, Parameters<Translate>[0]> = {
  gone: 'merge.why.gone',
  inside: 'merge.why.inside',
  offline: 'merge.why.offline',
  audience: 'merge.why.audience',
  comments: 'merge.why.comments',
  bothComments: 'merge.why.bothComments',
  perms: 'merge.why.perms',
  arriving: 'merge.why.arriving',
  missing: 'merge.why.missing',
  unknown: 'merge.why.unknown',
  unsent: 'merge.why.unsent',
  commentsUnknown: 'merge.why.commentsUnknown',
  merging: 'merge.why.merging',
};

/** El aviso de cómo salió, con *Open* y *Undo* si unió. */
export function mergeNotice(tr: Translate, services: Services, out: MergeOutcome, title: (id: string) => string): void {
  if (out.status === 'blocked') {
    notify(tr(BLOCK_KEYS[out.reason], { title: '' }));
    return;
  }
  const job = out.job;
  const names = { from: title(job.from), into: title(job.into) };
  if (out.status === 'pending') {
    notify(tr('merge.pendingNotice', names));
    return;
  }
  if (out.status === 'stopped') {
    notify(tr(out.reason === 'comments' ? 'merge.stoppedComments' : 'merge.stopped', names));
    return;
  }
  const parts = [tr(job.nothing ? 'merge.doneNothing' : 'merge.done', names)];
  const skipped = job.copy?.markupSkipped.length ?? 0;
  if (skipped) parts.push(tr('merge.notesStay', { count: skipped, from: names.from }));
  notify(parts.join(' · '), { label: tr('merge.open'), run: () => navigate(pagePath(job.into)) }, { label: tr('merge.undo'), run: () => void runUndo(tr, services, job, names) });
}

async function runUndo(tr: Translate, services: Services, job: MergeJob, names: { from: string; into: string }): Promise<void> {
  try {
    const { undoMerge } = await import('./mergeJob');
    const out = await undoMerge(services, job);
    if (out.status === 'undone') notify(out.kept ? tr('merge.undoneKept', { count: out.kept, into: names.into }) : tr('merge.undone', names));
    else notify(out.status === 'offline' ? tr('merge.undoOffline') : tr('merge.undoGone', names));
  } catch (err) {
    console.warn('[unir] no se pudo deshacer', err);
    notify(tr('merge.undoOffline'));
  }
}

/** *Merge…*: solo para quien puede unir las dos (nivel 4, no invitado). Abre el adelanto. */
export function MergeButton({ pair, className, label }: { pair: MergePair; className?: string; label?: string }) {
  const tr = useT();
  const services = useServices();
  const perms = usePermissions();
  const [open, setOpen] = useState(false);
  const ids = pair.pageIds.slice(0, 2);
  if (ids.length < 2 || !canOffer({ canMerge: canMergeWith(perms, services) }, ids)) return null;
  return (
    <>
      <button className={`lh-tbtn rel-merge ${className ?? ''}`} data-tip={tr('merge.buttonTip')} onClick={() => setOpen(true)}>
        {label ?? tr('merge.button')}
      </button>
      {open && <MergeDialog pair={{ ...pair, pageIds: ids }} onClose={() => setOpen(false)} />}
    </>
  );
}

const noSubscribe = () => () => undefined;
const zero = () => 0;

/** El adelanto (D643): las dos páginas, cuál queda, qué va a pasar y por qué no se puede, si no se puede. */
export function MergeDialog({ pair, onClose }: { pair: MergePair; onClose: () => void }) {
  const tr = useT();
  const services = useServices();
  const tree = useTree();
  const perms = usePermissions();
  const status = useSyncStatus();
  const projectId = useCurrentProject();
  const session = existingRelationsSession(services);
  useSyncExternalStore(session?.relations.subscribe ?? noSubscribe, session?.relations.getRevision ?? zero);
  const [first, second] = pair.pageIds as [string, string];
  const title = (id: string) => tree.get(id)?.title || tr('common.untitled');
  // Dos reportes con el mismo título: «… · 1» y «… · 2» (el orden de las tarjetas), así se sabe cuál es cuál.
  const label = (id: string) => (title(first) === title(second) ? `${title(id)} · ${id === first ? 1 : 2}` : title(id));
  const content = (id: string) => session?.index.content(id);
  const [comments, setComments] = useState<Record<string, number | null> | null>(null);
  const [audience, setAudience] = useState<{ a: AudienceInfo | null; b: AudienceInfo | null } | null | 'same'>(null);
  const [keep, setKeep] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  // Los comentarios de las dos, con la base (M9), y quién las ve si no están en la misma carpeta (C6).
  useEffect(() => {
    let live = true;
    const source = commentSource(services);
    void Promise.all(
      [first, second].map((id) =>
        source.fetchComments(id).then(
          (rows) => rows.length + (services.comments.pendingPageIds().includes(id) ? 1 : 0),
          () => null,
        ),
      ),
    ).then(([a, b]) => live && setComments({ [first]: a, [second]: b }));
    if ((tree.get(first)?.parent_id ?? null) === (tree.get(second)?.parent_id ?? null)) setAudience('same');
    else void Promise.all([audienceOf(services, first), audienceOf(services, second)]).then(([a, b]) => live && setAudience({ a, b }));
    return () => {
      live = false;
    };
  }, [services, first, second, tree]);

  const nothing = (from: string, into: string) => {
    const a = content(into);
    const b = content(from);
    return !!a && !!b && tree.children(from).length === 0 && addsNothing(a, b);
  };
  const proposed = comments ? defaultKeep([first, second], { comments: (id) => comments[id] ?? 0, nothing }) : first;
  const kept = keep ?? proposed ?? first;
  const gone = kept === first ? second : first;
  const counts = { [first]: contentCounts(content(first)), [second]: contentCounts(content(second)) };

  const canMerge = canMergeWith(perms, services);
  const block: MergeBlock | 'commentsUnknown' | 'checking' | null = (() => {
    const guard = mergeGuard({ tree, canMerge, sync: status }, kept, gone);
    if (guard) return guard;
    if (!comments || audience === null) return 'checking';
    if ((comments[first] ?? 0) > 0 && (comments[second] ?? 0) > 0) return 'bothComments';
    if (comments[gone] === null) return 'commentsUnknown';
    if (comments[gone]! > 0) return 'comments';
    if (audience !== 'same' && !audienceOk(tree, perms.role, kept, gone, audience)) return 'audience';
    return null;
  })();

  const run = async () => {
    setBusy(true);
    setWhy(null);
    try {
      const deps = await depsFor(services, (k, g) => {
        if (!canMerge(k) || !canMerge(g)) return 'perms';
        return mergeGuard({ tree, canMerge, sync: services.engine.getStatus() }, k, g);
      });
      const { runMerge } = await import('./mergeJob');
      const text = tr(pair.kind === 'day' ? 'merge.separatorDay' : 'merge.separator');
      const out = await runMerge(deps, { keep: kept, gone, projectId, text });
      if (out.status === 'blocked') {
        setWhy(tr(BLOCK_KEYS[out.reason], { title: title(gone) }));
        return;
      }
      onClose();
      mergeNotice(tr, services, out, title);
    } catch (err) {
      console.warn('[unir] no se pudo', err);
      setWhy(tr('merge.failed'));
    } finally {
      setBusy(false);
    }
  };

  const card = (id: string, i: number) => {
    const c = counts[id];
    const n = comments?.[id];
    const sub = tree.children(id).length;
    const parent = tree.get(id)?.parent_id;
    return (
      <label key={id} className={`merge-card${kept === id ? ' on' : ''}`}>
        <span className="merge-top">
          <input type="radio" name="merge-keep" checked={kept === id} disabled={busy} onChange={() => setKeep(id)} />
          <span className="merge-keep">{tr('merge.keepThis')}</span>
          {i === 0 && pair.kind !== 'day' && <span className="merge-tag">{tr('merge.usedByRelations')}</span>}
        </span>
        <b className="merge-title">{label(id)}</b>
        {parent && <span className="merge-folder">{title(parent)}</span>}
        <span className="merge-sum">
          {[
            tr('merge.blocks', { count: c.blocks }),
            c.photos ? tr('merge.photos', { count: c.photos }) : '',
            sub ? tr('merge.subpages', { count: sub }) : '',
            n === null ? tr('merge.commentsUnknown') : n ? tr('merge.comments', { count: n }) : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </label>
    );
  };

  const names = { from: label(gone), into: label(kept) };
  const goneSubs = tree.children(gone).length;
  const lines = [
    nothing(gone, kept) ? tr('merge.whatNothing', names) : tr(pair.kind === 'day' ? 'merge.whatCopyDay' : 'merge.whatCopy', names),
    goneSubs ? tr('merge.whatSubpages', { count: goneSubs, into: names.into }) : '',
    tr('merge.whatTrash', names),
  ].filter(Boolean);
  const blockText = block === 'checking' ? tr('merge.checking') : block ? tr(BLOCK_KEYS[block], { title: names.from }) : null;

  // Afuera de donde está el botón (la cabecera viva tiene sus propios estilos de botones y recorta lo que sale de ella).
  return createPortal(
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal merge-dialog" role="dialog" aria-label={tr('merge.aria')} onClick={(e) => e.stopPropagation()}>
        <h2>{pair.kind === 'day' ? tr('merge.titleDay', { title: pair.code }) : tr('merge.title', { code: pair.code })}</h2>
        <div className="merge-cards">{[first, second].map(card)}</div>
        <div className="merge-what">
          <b>{tr('merge.what')}</b>
          <ul>
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
        {(blockText || why) && <p className="merge-why">{why ?? blockText}</p>}
        <div className="modal-actions merge-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {tr('common.cancel')}
          </button>
          <button type="button" className="primary" disabled={busy || !!block} onClick={() => void run()}>
            {busy ? tr('merge.merging') : tr('merge.into', { title: names.into })}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// --- Lo que *Pending* lista después ---------------------------------------------------------------------------------

/** Una fila de *Pending*, igual que `PendingRow` de `MapView.tsx` (acá aparte para no importar el mapa desde la cabecera). */
function PendingRow({ head, children, actions }: { head: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mp-pcard">
      <div className="mp-ph">
        {head}
        <span className="mp-pact">{actions}</span>
      </div>
      {children}
    </div>
  );
}

/** Las filas de *Pending* de las uniones de este proyecto (también cuántas, para el número de la pestaña y de *Map*). */
export function useMergeRows(): MergeRow[] {
  const tree = useTree();
  const projectId = useCurrentProject();
  return mergeRows(tree, projectId);
}

/** Los trabajos de unir que quedaron a mitad en este dispositivo. */
function useMergeJobs(): MergeJob[] {
  const services = useServices();
  const [jobs, setJobs] = useState<MergeJob[]>([]);
  useEffect(() => {
    let live = true;
    let stop: (() => void) | null = null;
    void import('./mergeJob').then(({ pendingMerges, metaStore, subscribeMergeJobs, isMergeRunning }) => {
      // Una unión que corre ahora no se ofrece para terminar (D687): solo la que quedó a mitad.
      const load = () => void pendingMerges(metaStore(services.db)).then((list) => live && setJobs(list.filter((j) => !isMergeRunning(services.docs, j.from))), () => undefined);
      load();
      if (live) stop = subscribeMergeJobs(load);
    });
    return () => {
      live = false;
      stop?.();
    };
  }, [services]);
  return jobs;
}

export function MergePendingRows() {
  const tr = useT();
  const services = useServices();
  const tree = useTree();
  const perms = usePermissions();
  const rows = useMergeRows();
  const jobs = useMergeJobs();
  const title = (id: string) => tree.get(id)?.title || tr('common.untitled');
  const [busy, setBusy] = useState<string | null>(null);
  const finish = async (from: string) => {
    setBusy(from);
    try {
      const deps = await depsFor(services, () => null);
      const { resumeMerges } = await import('./mergeJob');
      for (const out of await resumeMerges(deps, from)) mergeNotice(tr, services, out, title);
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      {jobs.map((j) => (
        <PendingRow
          key={`job:${j.from}`}
          head={<span>{tr('merge.rowUnfinished', { from: title(j.from), into: title(j.into) })}</span>}
          actions={
            <button className="mp-btn" disabled={busy === j.from} onClick={() => void finish(j.from)}>
              {tr('merge.finish')}
            </button>
          }
        />
      ))}
      {rows.map((r) => (
        <PendingRow
          key={`merge:${r.from}`}
          head={<span>{tr(r.kind === 'changed' ? 'merge.rowChanged' : 'merge.rowIntoTrashed', { from: title(r.from), into: title(r.into) })}</span>}
          actions={
            r.kind === 'changed' ? (
              <>
                <button className="mp-btn" onClick={() => navigate(pagePath(r.from))}>
                  {tr('merge.open')}
                </button>
                {perms.canEditRow(r.from) && (
                  <button
                    className="mp-btn"
                    data-tip={tr('merge.dismissTip')}
                    onClick={() => {
                      const row = tree.get(r.from);
                      const p = row?.settings?.merged;
                      if (!row || !p) return;
                      void tree.setSetting(r.from, 'merged', { ...p, seq: row.update_seq, kids: tree.children(r.from).map((c) => c.id) });
                    }}
                  >
                    {tr('merge.dismiss')}
                  </button>
                )}
              </>
            ) : (
              perms.canManagePage(r.from) && (
                <button className="mp-btn" onClick={() => void restorePage(tree, r.from)}>
                  {tr('merge.restore', { from: title(r.from) })}
                </button>
              )
            )
          }
        >
          {r.kind === 'changed' && <div className="mp-pnote">{tr('merge.rowChangedNote', { from: title(r.from) })}</div>}
        </PendingRow>
      ))}
    </>
  );
}

/** «Also in «…» · Merge…»: en la cabecera viva de cada una de las páginas repetidas (con tres o más, de a dos). */
export function TwinLine({ pageId, pair }: { pageId: string; pair: MergePair }) {
  const tr = useT();
  const tree = useTree();
  if (!pair.pageIds.includes(pageId) || pair.pageIds.length < 2) return null;
  // La de esta página con la primera (o, si esta es la primera, con la segunda): en el orden del árbol.
  const ids = pair.pageIds[0] === pageId ? [pageId, pair.pageIds[1]] : [pair.pageIds[0], pageId];
  const other = ids[0] === pageId ? ids[1] : ids[0];
  return (
    <section className="lh closed lh-out lh-twin" aria-label={tr('merge.twinAria')}>
      <div className="lh-out-line" data-tip={tr(pair.kind === 'day' ? 'merge.twinDayTip' : 'merge.twinTip')}>
        <span>{tr('merge.alsoIn')}</span>
        <button className="lh-out-by" onClick={() => navigate(pagePath(other))}>
          «{tree.get(other)?.title || tr('common.untitled')}»
        </button>
        <MergeButton pair={{ ...pair, pageIds: ids }} className="lh-twin-merge" />
      </div>
    </section>
  );
}

/** Al volver la red (y al abrir el proyecto), los trabajos de unir que quedaron a mitad siguen solos. */
export function MergeResumer(): null {
  const services = useServices();
  const status = useSyncStatus();
  useEffect(() => {
    if (!status.online || status.lastSyncAt === null) return;
    void (async () => {
      const { pendingMerges, metaStore, resumeMerges } = await import('./mergeJob');
      if (!(await pendingMerges(metaStore(services.db))).length) return;
      const deps = await depsFor(services, () => null);
      for (const out of await resumeMerges(deps)) {
        if (out.status !== 'pending') mergeNotice(tGlobal as unknown as Translate, services, out, (id) => services.tree.get(id)?.title ?? '');
      }
    })().catch((err) => console.warn('[unir] no se pudo seguir', err));
  }, [services, status.online, status.lastSyncAt]);
  return null;
}
