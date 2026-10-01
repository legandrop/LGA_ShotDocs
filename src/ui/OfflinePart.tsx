import { useEffect, useMemo, useRef, useState } from 'react';
import { locale, localize, useT, type Translate } from '../i18n';
import '../i18n/lazy/offline';
import { formatSize } from '../media/fileTrash';
import { IOS_OFFLINE_TOTAL_MAX, LIMIT_CHOICES, reserveFor, type MarkView, type PlanState } from '../media/offline';
import { selectedTotal, type RowKey } from '../media/offlinePlan';
import { DEFAULT_OPTIONS, type OfflineOptions } from '../media/offlineStore';
import { deviceTraits, useOffline, useServices, useTree } from '../services';
import { notify } from './notice';

// "Available offline" y "Storage on this device" (P.10, Docs/Doc_Copias_Locales.md, secciones 3.4 y 6). Se bajan
// aparte (lazyPart): no hacen falta para la primera pantalla.

/** El indicador circular de "calculando" (por fila y en el total). */
function Spinner({ label }: { label: string }) {
  return <span className="offline-spinner" role="status" aria-label={label} />;
}

/** "hace 5 minutos", "ayer" (con el idioma de la app). */
function ago(at: number, lang: 'en' | 'es'): string {
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: 'auto' });
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 60) return rtf.format(-Math.max(0, minutes), 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.round(hours / 24), 'day');
}

function useEstimate(): { estimate: StorageEstimate | null; persisted: boolean | null } {
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    void storage
      ?.estimate?.()
      .then((e) => live && setEstimate(e))
      .catch(() => undefined);
    void storage
      ?.persisted?.()
      .then((p) => live && setPersisted(p))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return { estimate, persisted };
}

/** La línea de estado de una marca. */
export function markStatus(mark: MarkView, tr: Translate): string {
  if (mark.state === 'downloading' && mark.total > 0) {
    return tr('offlineDialog.progress', {
      done: mark.done,
      total: mark.total,
      bytesDone: formatSize(mark.bytesDone, tr.lang),
      bytesTotal: formatSize(mark.bytesTotal, tr.lang),
    });
  }
  if (mark.state === 'noSpace') return localize(mark.error ?? '') || tr('offlineDialog.waiting');
  if (mark.state === 'offline') return tr('offlineDialog.offlineState');
  if (mark.state === 'ready' && mark.readyAt) return tr('offlineDialog.readyAt', { when: ago(mark.readyAt, tr.lang) });
  if (mark.error) return localize(mark.error);
  if (mark.waitingPages > 0) return tr('offlineDialog.waitingPages', { count: mark.waitingPages });
  if (mark.needsUpdate > 0) return tr('offlineDialog.needsUpdate', { count: mark.needsUpdate });
  if (mark.waitingFiles > 0) return tr('offlineDialog.stillUploading', { count: mark.waitingFiles });
  return tr('offlineDialog.waiting');
}

const ROW_LABELS: Record<RowKey, Parameters<Translate>[0]> = {
  sharp: 'offlineDialog.sharp',
  originals: 'offlineDialog.originals',
  attachments: 'offlineDialog.attachments',
  videos: 'offlineDialog.videos',
};

/**
 * La ventana de marcar (sección 3.4): las casillas con su peso (de todo, también lo destildado), el total de lo
 * elegido, lo que el navegador le deja a la app, el tope y lo ya marcado, y el progreso hasta "listo".
 */
export function OfflineDialog(props: { kind: 'page' | 'project'; target: string; onClose: () => void; onStorage?: () => void }) {
  const { offline, engine } = useServices();
  const snapshot = useOffline();
  const tree = useTree();
  const tr = useT();
  const { estimate, persisted } = useEstimate();
  const traits = useMemo(() => deviceTraits(), []);
  const own = snapshot.marks.find((m) => m.kind === props.kind && m.target === props.target) ?? null;
  const covering = own ? null : offline.markFor(props.kind, props.target);
  const [options, setOptions] = useState<OfflineOptions>(own?.options ?? DEFAULT_OPTIONS);
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeCopies, setRemoveCopies] = useState(true);
  const [started, setStarted] = useState(false);
  const online = engine.getStatus().online;
  const title = props.kind === 'project' ? (tree.project(props.target)?.name ?? '') : tree.get(props.target)?.title || tr('common.untitled');

  useEffect(() => {
    const controller = new AbortController();
    void offline.plan(props.kind, props.target, (state) => setPlan(state), controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [offline, props.kind, props.target, own?.state]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props]);

  // En el teléfono, mientras la ventana muestra la bajada, que la pantalla no se apague (sin la app abierta no baja
  // nada). `navigator.wakeLock` no existe en todos lados (en la app instalada del iPhone, desde iOS 18.4).
  const downloading = own?.state === 'downloading';
  useEffect(() => {
    if (!traits.phone || !downloading) return;
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    let lock: { release(): Promise<void> } | null = null;
    let live = true;
    void nav.wakeLock
      ?.request('screen')
      .then((l) => (live ? (lock = l) : void l.release()))
      .catch(() => undefined);
    return () => {
      live = false;
      void lock?.release().catch(() => undefined);
    };
  }, [traits.phone, downloading]);

  // El aviso de "listo" cuando la ventana se cerró con la bajada en curso lo da `SpaceHost` (siempre montado).
  const total = plan ? selectedTotal(plan.weights, options) : null;
  const quota = estimate?.quota ?? 0;
  const available = quota > 0 ? quota - (estimate?.usage ?? 0) : null;
  const reserve = quota > 0 ? reserveFor(quota) : 0;
  const freeable = snapshot.usage?.freeable ?? 0;
  const needed = total?.missing ?? 0;
  const fits = available === null || needed <= available - reserve;
  const fitsFreeing = !fits && available !== null && needed <= available - reserve + freeable;
  const iosUsed = snapshot.usage?.offline ?? 0;
  const iosFits = !traits.ios || iosUsed + needed <= IOS_OFFLINE_TOTAL_MAX;
  const changed = !own || JSON.stringify(own.options) !== JSON.stringify(options);
  const ready = plan?.remote === true && online && (fits || fitsFreeing) && iosFits && !busy && changed;
  const standalone = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;

  async function start() {
    if (!ready) return;
    setBusy(true);
    try {
      if (fitsFreeing) await offline.freeUp('all');
      await offline.mark(props.kind, props.target, options);
      setStarted(true);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!own) return;
    await offline.unmark(own.id, removeCopies);
    props.onClose();
  }

  const row = (key: RowKey, checked: boolean, toggle: (on: boolean) => void) => {
    const w = plan?.weights.rows[key];
    const loading = !plan || (!plan.remote && (w?.unknown ?? 1) > 0);
    const count =
      key === 'videos'
        ? tr('offlineDialog.videoCount', { count: w?.count ?? 0 })
        : key === 'attachments'
          ? tr('offlineDialog.files', { count: w?.count ?? 0 })
          : tr('offlineDialog.photos', { count: w?.count ?? 0 });
    const prefix = key === 'sharp' ? '≈' : '';
    return (
      <div className="offline-row" key={key}>
        <label>
          <input type="checkbox" checked={checked} onChange={(e) => toggle(e.target.checked)} />
          <span className="offline-row-label">{tr(ROW_LABELS[key])}</span>
        </label>
        <span className="offline-row-count">{w ? count : ''}</span>
        <span className="offline-row-size">
          {loading ? <Spinner label={tr('offlineDialog.calculating')} /> : `${prefix}${formatSize(w?.missing ?? 0, tr.lang)}`}
        </span>
        {w && w.present > 0 && <span className="offline-row-note">{tr('offlineDialog.present', { size: formatSize(w.present, tr.lang) })}</span>}
        {w && key === 'attachments' && w.over.count > 0 && <span className="offline-row-note">{tr('offlineDialog.over', { count: w.over.count })}</span>}
        {w && key === 'originals' && !options.originals && w.own.count > 0 && (
          <span className="offline-row-note">{tr('offlineDialog.ownUnkept', { count: w.own.count, size: formatSize(w.own.bytes, tr.lang) })}</span>
        )}
        {w && key === 'sharp' && w.cantLarge > 0 && <span className="offline-row-note">{tr('offlineDialog.cantLarge', { count: w.cantLarge })}</span>}
      </div>
    );
  };

  const mark = own;
  const showProgress = started || (mark && (mark.state === 'downloading' || mark.state === 'ready'));
  const limit = snapshot.limit;
  const kept = snapshot.usage?.kept ?? 0;
  const subtitle =
    props.kind === 'project'
      ? tr('offlineDialog.project', { title, count: plan?.pages ?? 0 })
      : tr('offlineDialog.page', { title, count: Math.max(0, (plan?.pages ?? 1) - 1) });

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div
        className="modal offline-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={tr('offlineDialog.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{tr('offlineDialog.title')}</h2>
        <p className="muted offline-subtitle">{subtitle}</p>
        {covering && <p className="muted">{tr('offlineDialog.coveredBy', { title: covering.title })}</p>}
        <div className="offline-rows">
          {row('sharp', options.sharp, (on) => setOptions({ ...options, sharp: on }))}
          {row('originals', options.originals, (on) => setOptions({ ...options, originals: on }))}
          {row('attachments', options.attachments, (on) => setOptions({ ...options, attachments: on }))}
          {row('videos', options.videos, (on) => setOptions({ ...options, videos: on }))}
          <div className="offline-row extras">
            <span className="offline-row-label">{tr('offlineDialog.extras')}</span>
            <span className="offline-row-size">
              {plan ? formatSize(plan.weights.extras.bytes, tr.lang) : <Spinner label={tr('offlineDialog.calculating')} />}
            </span>
          </div>
        </div>
        {plan && plan.waitingPages > 0 && <p className="muted">{tr('offlineDialog.pagesWaiting', { count: plan.waitingPages })}</p>}
        {plan && plan.needsUpdate > 0 && <p className="muted">{tr('offlineDialog.needsUpdate', { count: plan.needsUpdate })}</p>}
        <div className="offline-total">
          {total && plan?.remote ? (
            <strong>
              {tr('offlineDialog.selected', { size: `≈${formatSize(total.missing, tr.lang)}`, network: `≈${formatSize(total.network, tr.lang)}` })}
            </strong>
          ) : (
            <span>
              <Spinner label={tr('offlineDialog.calculating')} /> {tr('offlineDialog.calculating')}
            </span>
          )}
          {available !== null && <span>{tr('offlineDialog.available', { size: formatSize(available, tr.lang) })}</span>}
          <span>
            {tr('offlineDialog.offlineNow', {
              now: formatSize(snapshot.usage?.offline ?? 0, tr.lang),
              after: formatSize((snapshot.usage?.offline ?? 0) + needed, tr.lang),
            })}
          </span>
          <span>
            {limit === null
              ? tr('offlineDialog.keptNoLimit', { kept: formatSize(kept, tr.lang) })
              : tr('offlineDialog.kept', { kept: formatSize(kept, tr.lang), limit: formatSize(limit, tr.lang) })}{' '}
            {props.onStorage && (
              <button className="link" onClick={props.onStorage}>
                {tr('space.changeLimit')}
              </button>
            )}
          </span>
        </div>
        {persisted === false && !traits.ios && <p className="muted">{tr('offlineDialog.notPersisted')}</p>}
        {traits.ios && !standalone && <p className="delete-project-warning">{tr('offlineDialog.installFirst')}</p>}
        {traits.phone && <p className="muted">{tr('offlineDialog.keepOpen')}</p>}
        {!online && <p className="muted">{tr('offlineDialog.connect')}</p>}
        {plan?.remote && online && !fits && !fitsFreeing && available !== null && (
          <p className="error">
            {tr('offlineDialog.needsRoom', {
              needed: formatSize(needed, tr.lang),
              available: formatSize(Math.max(0, available), tr.lang),
              reserve: formatSize(reserve, tr.lang),
            })}
          </p>
        )}
        {!iosFits && (
          <p className="error">
            {tr('offlineDialog.iosRoom', { limit: formatSize(IOS_OFFLINE_TOTAL_MAX, tr.lang), used: formatSize(iosUsed, tr.lang) })}
          </p>
        )}
        {showProgress && mark && (
          <div className="offline-progress">
            {mark.state === 'ready' ? (
              <strong>{tr('offlineDialog.ready')}</strong>
            ) : (
              <>
                <progress max={Math.max(1, mark.total)} value={mark.done} />
                <span>{markStatus(mark, tr)}</span>
              </>
            )}
            {mark.unavailable > 0 && <span className="muted">{tr('offlineDialog.unavailable', { count: mark.unavailable })}</span>}
            {mark.waitingFiles > 0 && <span className="muted">{tr('offlineDialog.stillUploading', { count: mark.waitingFiles })}</span>}
          </div>
        )}
        {mark && !showProgress && <p className="muted">{markStatus(mark, tr)}</p>}
        {removing && mark ? (
          <div className="offline-remove">
            <p>
              <strong>{tr('offlineDialog.removeTitle', { title: mark.title })}</strong>
            </p>
            <p>{tr('offlineDialog.removeText', { size: formatSize(mark.bytes, tr.lang) })}</p>
            <label>
              <input type="checkbox" checked={removeCopies} onChange={(e) => setRemoveCopies(e.target.checked)} />{' '}
              {tr('offlineDialog.removeCopies')}
            </label>
            <div className="welcome-actions">
              <button className="primary danger" onClick={() => void remove()}>
                {tr('offlineDialog.remove')}
              </button>
              <button className="link" onClick={() => setRemoving(false)}>
                {tr('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="welcome-actions">
            {(!mark || changed) && (
              <button className="primary" disabled={!ready} onClick={() => void start()}>
                {mark ? tr('offlineDialog.save') : fitsFreeing ? tr('offlineDialog.freeAndMake', { size: formatSize(Math.max(0, needed - (available ?? 0) + reserve), tr.lang) }) : tr('offlineDialog.make')}
              </button>
            )}
            {mark && !changed && (
              <button className="secondary" disabled={!online} onClick={() => void offline.update(mark.id)}>
                {mark.state === 'noSpace' ? tr('offlineDialog.tryAgain') : tr('offlineDialog.updateNow')}
              </button>
            )}
            {mark && (
              <button className="secondary" onClick={() => (mark.state === 'downloading' ? void offline.unmark(mark.id, true).then(props.onClose) : setRemoving(true))}>
                {mark.state === 'downloading' ? tr('offlineDialog.stop') : tr('offlineDialog.remove')}
              </button>
            )}
            <button className="link" onClick={props.onClose}>
              {mark && mark.state === 'downloading' ? tr('offlineDialog.hide') : tr('common.close')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * "Storage on this device" (sección 6): lo que usa la app, lo guardado automáticamente con su tope (elegible),
 * *Free up space*, lo marcado sin conexión (actualizar, editar, sacar) y las copias que pueden ser las únicas.
 */
export function StorageDialog(props: { onClose: () => void; onEdit: (mark: MarkView) => void }) {
  const { offline, media } = useServices();
  const snapshot = useOffline();
  const tr = useT();
  const { estimate, persisted } = useEstimate();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [goneConfirm, setGoneConfirm] = useState(false);
  const saveLink = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    void offline.refresh().catch(() => undefined);
  }, [offline]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props]);

  const usage = snapshot.usage;
  const limit = snapshot.limit;
  const quota = estimate?.quota ?? 0;
  const counted = (usage?.kept ?? 0) + (usage?.offline ?? 0) + (usage?.gone.bytes ?? 0);
  const other = Math.max(0, (estimate?.usage ?? 0) - counted);
  const share = limit && usage ? Math.min(1, usage.kept / limit) : 0;

  async function freeAll() {
    setBusy(true);
    try {
      const freed = await offline.freeUp('all');
      notify(tr('space.freed', { size: formatSize(freed, tr.lang) }));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  async function saveGone() {
    for (const id of usage?.gone.ids ?? []) {
      const blob = await offline.goneCopy(id);
      if (!blob || !saveLink.current) continue;
      const info = media.fileInfo(id);
      const url = URL.createObjectURL(blob);
      saveLink.current.href = url;
      saveLink.current.download = info?.name || id;
      saveLink.current.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div
        className="modal storage-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={tr('storage.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{tr('storage.title')}</h2>
        {estimate?.usage !== undefined && quota > 0 && (
          <p className="muted">
            {tr('storage.uses', { usage: formatSize(estimate.usage ?? 0, tr.lang), available: formatSize(quota - (estimate.usage ?? 0), tr.lang) })}
          </p>
        )}
        {persisted === true && <p className="muted">{tr('storage.persisted')}</p>}
        {persisted === false && <p className="muted">{tr('offlineDialog.notPersisted')}</p>}

        <section className="storage-section">
          <div className="storage-head">
            <strong>{tr('storage.kept')}</strong>
            <span>
              {usage
                ? limit === null
                  ? formatSize(usage.kept, tr.lang)
                  : tr('storage.keptOf', { kept: formatSize(usage.kept, tr.lang), limit: formatSize(limit, tr.lang) })
                : ''}
            </span>
          </div>
          {limit !== null && <progress className="storage-bar" max={1} value={share} />}
          <p className="muted">{tr('storage.keptHelp')}</p>
          <label className="storage-limit">
            {tr('storage.limit')}{' '}
            <select
              value={limit === null ? 'none' : String(limit)}
              onChange={(e) => void offline.setLimit(e.target.value === 'none' ? null : Number(e.target.value))}
            >
              {[...new Set([...LIMIT_CHOICES, limit])].map((choice) => (
                <option key={String(choice)} value={choice === null ? 'none' : String(choice)}>
                  {choice === null ? tr('storage.noLimit') : formatSize(choice, tr.lang)}
                </option>
              ))}
            </select>
          </label>
          {limit !== null && quota > 0 && limit > quota / 2 && <p className="muted">{tr('storage.limitOverHalf')}</p>}
          {usage && usage.waitingCount > 0 && (
            <p className="muted">{tr('storage.waiting', { size: formatSize(usage.waiting, tr.lang), count: usage.waitingCount })}</p>
          )}
          <p className="muted">{tr('storage.ownLater')}</p>
          {confirming ? (
            <div className="offline-remove">
              <p>{tr('storage.freeConfirm', { size: formatSize(usage?.freeable ?? 0, tr.lang) })}</p>
              <div className="welcome-actions">
                <button className="primary" disabled={busy} onClick={() => void freeAll()}>
                  {tr('space.freeUp')}
                </button>
                <button className="link" onClick={() => setConfirming(false)}>
                  {tr('common.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button className="secondary" disabled={!usage || usage.freeable <= 0} onClick={() => setConfirming(true)}>
              {tr('storage.freeUp')}
            </button>
          )}
          {usage && usage.freeable <= 0 && <p className="muted">{tr('storage.nothingToFree')}</p>}
        </section>

        <section className="storage-section">
          <div className="storage-head">
            <strong>{tr('storage.offline')}</strong>
            <span>{usage ? formatSize(usage.offline, tr.lang) : ''}</span>
          </div>
          {snapshot.marks.length === 0 && <p className="muted">{tr('storage.noMarks')}</p>}
          <ul className="storage-marks">
            {snapshot.marks.map((m) => (
              <li key={m.id}>
                <span className="storage-mark-title">{m.title}</span>
                <span className="muted">{markStatus(m, tr)}</span>
                <span className="storage-mark-actions">
                  {menuFor === m.id ? (
                    <>
                      <button className="link" onClick={() => void offline.update(m.id)}>
                        {m.state === 'noSpace' ? tr('offlineDialog.tryAgain') : tr('offlineDialog.updateNow')}
                      </button>
                      <button className="link" onClick={() => props.onEdit(m)}>
                        {tr('storage.edit')}
                      </button>
                      <button className="link danger" onClick={() => void offline.unmark(m.id, true)}>
                        {tr('offlineDialog.remove')}
                      </button>
                    </>
                  ) : (
                    <button className="link" aria-label={tr('storage.edit')} onClick={() => setMenuFor(m.id)}>
                      ⋯
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {usage && usage.gone.count > 0 && (
          <section className="storage-section">
            <div className="storage-head">
              <strong>{tr('storage.gone')}</strong>
              <span>{formatSize(usage.gone.bytes, tr.lang)}</span>
            </div>
            <p className="muted">{tr('storage.goneHelp', { count: usage.gone.count })}</p>
            <div className="welcome-actions">
              <button className="secondary" onClick={() => void saveGone()}>
                {tr('storage.saveCopy')}
              </button>
              {goneConfirm ? (
                <>
                  <span>{tr('storage.removeGoneConfirm')}</span>
                  <button className="primary danger" onClick={() => void offline.removeGone(usage.gone.ids).then(() => setGoneConfirm(false))}>
                    {tr('storage.removeGone')}
                  </button>
                </>
              ) : (
                <button className="link danger" onClick={() => setGoneConfirm(true)}>
                  {tr('storage.removeGone')}
                </button>
              )}
            </div>
            <a ref={saveLink} hidden />
          </section>
        )}

        {quota > 0 && <p className="muted">{tr('storage.other', { size: formatSize(other, tr.lang) })}</p>}
        <div className="welcome-actions">
          <a className="link" href="/storage-test">
            {tr('storage.measure')}
          </a>
          <button className="link" onClick={props.onClose}>
            {tr('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
