import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import * as Y from 'yjs';
import { t, useT } from '../i18n';
import '../i18n/lazy/history';
import { mediaIdsInDoc } from '../media/usage';
import { isDeletedRow } from '../media/queue';
import { ServicesContext, usePermissions, useServices, useSyncStatus, useTree } from '../services';
import { loadPageHistory, MAX_RESTORE_BYTES, PageHistory, versionBytes, type HistoryRow, type HistorySession } from '../sync/history';
import type { HistoryRemote, MediaRemote } from '../sync/remote';
import { errorMessage, isNetworkError, RemoteError } from '../sync/types';
import { Permissions } from '../sync/access';
import { versionNode } from './historyRestore';
import { historyServices } from './historyServices';
import { closeHistory, requestRestore } from './historyUi';
import { dismissNotice, notify } from './notice';
import { BlockEditor } from './PageEditor';
import type { FindEditor } from './FindBar';
import type { Schema } from '@tiptap/pm/model';
import { mm, pageFormat, SHEET_MARGIN_MM, sheetSize } from './pageFormat';
import { findUnknownContent } from './unknownContent';
import './history.css';

// El historial de versiones de una página (P.18, Docs/Doc_Historial.md, entrega 1): la lista de versiones agrupadas
// por sesión de edición con quién y cuándo, ver una versión tal como era (el editor de verdad, en solo lectura, sobre
// un documento en memoria) y restaurarla (una edición nueva por el editor de la página, que se deshace).
//
// Todo se calcula acá, en el dispositivo, con las filas de `page_history`. Nada de esta pantalla escribe en la base
// local, en el servidor ni en el Drive: lo único que escribe es restaurar, y lo hace el editor de la página.

/** Cuánto antes de restaurar se avisa que otra persona estuvo editando. */
const RECENT_OTHERS_MS = 2 * 60_000;

type Loading =
  | { state: 'loading'; count: number }
  | { state: 'ready'; history: PageHistory; emails: Map<string, string> }
  | { state: 'offline' }
  | { state: 'denied' }
  | { state: 'trash' }
  | { state: 'failed'; reason: string };

/** Por qué no se puede restaurar (las claves enteras: la prueba del diccionario las busca literales). */
type Blocker =
  | 'history.why.offline'
  | 'history.why.pending'
  | 'history.why.missing'
  | 'history.why.shape'
  | 'history.why.unknown'
  | 'history.why.size'
  | 'history.why.outdated'
  | 'history.why.cantEdit'
  | 'history.why.notOpen';

function dayLabel(iso: string, lang: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return t('history.today');
  if (days === 1) return t('history.yesterday');
  if (days > 1 && days < 7) return d.toLocaleDateString(lang, { weekday: 'long' });
  return d.toLocaleDateString(lang, { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

function timeLabel(iso: string, lang: string): string {
  return new Date(iso).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
}

/** La fecha y la hora de una versión, para el aviso y la barra. */
export function whenLabel(iso: string, lang: string): string {
  return `${dayLabel(iso, lang)}, ${timeLabel(iso, lang)}`;
}

/**
 * Quién (que no sea `me`) cambió la página en los últimos 2 minutos (con el reloj del dispositivo; `undefined` si nadie).
 * Es el aviso de antes de confirmar; lo que de verdad ataja es volver a mirar el servidor al confirmar (`restore`): si
 * llegó algo de otra persona desde que se abrió el historial, se vuelve a preguntar.
 */
export function recentOther(rows: readonly HistoryRow[], me: string, now = Date.now()): string | null | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (now - Date.parse(row.createdAt) >= RECENT_OTHERS_MS) break;
    if (row.createdBy !== me) return row.createdBy;
  }
  return undefined;
}

export function HistoryPanel({ pageId }: { pageId: string }) {
  const services = useServices();
  const { remote, engine, docs, user } = services;
  const status = useSyncStatus();
  const perms = usePermissions();
  const tree = useTree();
  const tr = useT();
  const lang = tr.lang === 'es' ? 'es' : 'en';
  const [loading, setLoading] = useState<Loading>({ state: 'loading', count: 0 });
  const [attempt, setAttempt] = useState(0);
  /** La versión elegida, por el `seq` de su última fila (sobrevive a volver a bajar el historial). */
  const [chosen, setChosen] = useState<number | null>(null);
  /** En el teléfono: la lista o la versión. */
  const [pane, setPane] = useState<'list' | 'version'>('list');
  const [unsynced, setUnsynced] = useState(false);
  const [missing, setMissing] = useState(false);
  /** El esquema de ProseMirror del editor de la versión (para la ida y vuelta). */
  const [pmSchema, setPmSchema] = useState<Schema | null>(null);
  const [confirm, setConfirm] = useState<{ photos: number; others: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const previewServices = useMemo(() => historyServices(services), [services]);
  const historyRemote = remote as unknown as HistoryRemote & MediaRemote;

  // Bajar el historial (solo con red). Las filas no cambian nunca: se bajan una vez por apertura.
  useEffect(() => {
    let cancelled = false;
    if (!engine.getStatus().online) {
      setLoading({ state: 'offline' });
      return;
    }
    setLoading({ state: 'loading', count: 0 });
    loadPageHistory(historyRemote, pageId, (count) => !cancelled && setLoading({ state: 'loading', count }), () => cancelled).then(
      ({ rows, emails }) => {
        if (cancelled) return;
        const history = new PageHistory(rows);
        setLoading({ state: 'ready', history, emails });
      },
      (err: unknown) => {
        if (cancelled) return;
        if (err instanceof RemoteError && err.message === 'page_not_found') setLoading({ state: 'denied' });
        else if (err instanceof RemoteError && err.message === 'page_in_trash') setLoading({ state: 'trash' });
        else if (isNetworkError(err)) setLoading({ state: 'offline' });
        else setLoading({ state: 'failed', reason: errorMessage(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [historyRemote, engine, pageId, attempt]);

  // Volver la red reintenta si estaba sin red (lo ya bajado no se vuelve a pedir); lo demás, con "Reintentar".
  const waitingNetwork = loading.state === 'offline';
  useEffect(() => {
    if (waitingNetwork && status.online) setAttempt((n) => n + 1);
  }, [waitingNetwork, status.online]);

  useEffect(() => () => (loading.state === 'ready' ? loading.history.destroy() : undefined), [loading]);

  // Lo de este dispositivo que todavía no subió no está en el historial (y restaurar lo pide subido).
  useEffect(() => {
    let live = true;
    void docs.unsyncedPages().then((pages) => live && setUnsynced(pages.includes(pageId)));
    void engine.isMissingContent(pageId).then((m) => live && setMissing(m));
    return () => {
      live = false;
    };
  }, [docs, engine, pageId, status.lastSyncAt, status.pendingPages]);

  const ready = loading.state === 'ready' ? loading : null;
  const sessions = ready?.history.sessions ?? [];
  const index = useMemo(() => {
    if (!sessions.length) return -1;
    const found = chosen === null ? -1 : sessions.findIndex((s) => s.seq === chosen);
    return found >= 0 ? found : sessions.length - 1;
  }, [sessions, chosen]);
  const session: HistorySession | null = index >= 0 ? sessions[index] : null;
  const isCurrent = index === sessions.length - 1;

  // El documento de la versión elegida: en memoria, nunca se guarda ni se sube.
  const version = useMemo<Y.Doc | null>(() => (ready && index >= 0 ? ready.history.version(index) : null), [ready, index]);
  // Lo que se muestra es una copia: el editor (y-prosemirror) puede tocar el documento que muestra, y la versión tiene
  // que quedar intacta para comprobarla y restaurarla.
  const shown = useMemo(() => {
    if (!version) return null;
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(version));
    return copy;
  }, [version]);
  useEffect(() => () => version?.destroy(), [version]);
  useEffect(() => () => shown?.destroy(), [shown]);
  const unknown = useMemo(() => (version ? findUnknownContent(version) : null), [version]);
  const tooBig = useMemo(() => (version ? versionBytes(version) > MAX_RESTORE_BYTES : false), [version]);
  // La ida y vuelta (Doc_Historial.md, 6.1): con el esquema del editor que muestra la versión (está desde que se
  // crea, antes de montarse). `null` mientras no se sabe.
  const onPreviewEditor = useCallback((editor: FindEditor | null) => {
    const ed = editor as unknown as { pmSchema?: Schema; prosemirrorView?: { state: { schema: Schema } } } | null;
    const schema = ed?.pmSchema ?? ed?.prosemirrorView?.state.schema;
    if (schema) setPmSchema(schema);
  }, []);
  const shapeOk = useMemo(() => (version && pmSchema ? versionNode(version, pmSchema).complete : null), [version, pmSchema]);

  // Las personas, con su nombre (el correo; "Vos") y su color (por orden de aparición en el historial de la página).
  const people = useMemo(() => ready?.history.people() ?? [], [ready]);
  const nameOf = (id: string | null) =>
    id === user.id ? tr('history.you') : id ? (ready?.emails.get(id) ?? tr('history.formerMember')) : tr('history.formerMember');
  const colorOf = (id: string | null) => `var(--hist-${(people.indexOf(id) % 8) + 1})`;

  const blocker: Blocker | null = (() => {
    if (!status.online) return 'history.why.offline';
    if (!perms.canEditPage(pageId)) return 'history.why.cantEdit';
    if (status.outdated) return 'history.why.outdated';
    if (unknown) return 'history.why.unknown';
    if (shapeOk === false) return 'history.why.shape';
    if (tooBig) return 'history.why.size';
    if (unsynced) return 'history.why.pending';
    if (missing) return 'history.why.missing';
    return null;
  })();
  const blockerText: Record<Blocker, string> = {
    'history.why.offline': tr('history.why.offline'),
    'history.why.pending': tr('history.why.pending'),
    'history.why.missing': tr('history.why.missing'),
    'history.why.shape': tr('history.why.shape'),
    'history.why.unknown': tr('history.why.unknown'),
    'history.why.size': tr('history.why.size'),
    'history.why.outdated': tr('history.why.outdated'),
    'history.why.cantEdit': tr('history.why.cantEdit'),
    'history.why.notOpen': tr('history.why.notOpen'),
  };

  // Mientras está abierto, el teclado no puede llegar a la página escondida (B3 de la auditoría): el foco pasa a la
  // pantalla del historial y lo demás de la app queda `inert`. Al cerrar, todo vuelve y el foco a donde estaba.
  const screenRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const screen = screenRef.current;
    if (!screen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const shell = screen.closest('.shell') ?? document.body;
    const hidden = [...shell.children].filter((el): el is HTMLElement => el instanceof HTMLElement && !el.contains(screen) && !el.hasAttribute('inert'));
    for (const el of hidden) el.setAttribute('inert', '');
    screen.focus({ preventScroll: true });
    return () => {
      for (const el of hidden) el.removeAttribute('inert');
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  // Escape cierra (primero la confirmación).
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('.carrete')) return;
      e.preventDefault();
      if (confirmRef.current) setConfirm(null);
      else closeHistory();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Antes de confirmar: cuántas fotos de la versión ya no están en Drive y si otra persona estuvo editando. */
  async function askRestore() {
    if (!ready || !version) return;
    setMessage(null);
    let photos = 0;
    const ids = [...mediaIdsInDoc(version)];
    if (ids.length) {
      try {
        photos = (await historyRemote.fetchMediaFiles(ids)).filter((row) => isDeletedRow(row)).length;
      } catch {
        photos = 0;
      }
    }
    const other = recentOther(ready.history.rows, user.id);
    setConfirm({ photos, others: other === undefined ? null : nameOf(other) });
  }

  /** Restaurar (Doc_Historial.md, sección 6.1): sincronizar, comprobar de nuevo y pedírselo al editor de la página. */
  async function restore() {
    if (!version || !session) return;
    setConfirm(null);
    setBusy(true);
    setMessage(tr('history.syncing'));
    try {
      await engine.syncNow();
      // Lo que llegó al servidor desde que se abrió el historial (O1 de la auditoría): si otra persona cambió la página
      // mientras tanto, se suma a la lista y se vuelve a preguntar, con el aviso de quién.
      if (ready) {
        const known = ready.history.rows;
        const fresh: HistoryRow[] = [];
        for (;;) {
          const after = fresh.length ? fresh[fresh.length - 1].seq : (known[known.length - 1]?.seq ?? 0);
          const batch = await historyRemote.pageHistory(pageId, after, 500);
          fresh.push(...batch);
          if (batch.length < 500) break;
        }
        if (fresh.some((row) => row.createdBy !== user.id)) {
          const rows = [...known, ...fresh];
          setLoading({ state: 'ready', history: new PageHistory(rows), emails: await historyRemote.pageHistoryAuthors(pageId).then((list) => new Map(list.map((a) => [a.user_id, a.email])), () => ready.emails) });
          const other = fresh.filter((row) => row.createdBy !== user.id).pop()!.createdBy;
          setMessage(null);
          setConfirm({ photos: 0, others: nameOf(other) });
          return;
        }
      }
      const [pages, stillMissing] = await Promise.all([docs.unsyncedPages(), engine.isMissingContent(pageId)]);
      const why: Blocker | null = !engine.getStatus().online
        ? 'history.why.offline'
        : pages.includes(pageId)
          ? 'history.why.pending'
          : stillMissing
            ? 'history.why.missing'
            : // Los permisos recién bajados (pueden haber cambiado con el historial abierto).
              !new Permissions(tree, services.access.get(), user.id).canEditPage(pageId)
              ? 'history.why.cantEdit'
              : engine.getStatus().outdated
                ? 'history.why.outdated'
                : null;
      if (why) {
        setMessage(tr('history.restoreFailed', { reason: blockerText[why] }));
        return;
      }
      const outcome = requestRestore(pageId, version);
      if (!outcome.ok) {
        const reason: Blocker = outcome.reason === 'shape' ? 'history.why.shape' : 'history.why.notOpen';
        setMessage(tr('history.restoreFailed', { reason: blockerText[reason] }));
        return;
      }
      const key = `history:${pageId}:${session.seq}:${Date.now()}`;
      const date = whenLabel(session.end, lang);
      closeHistory();
      notify(t('history.restored', { date }), {
        key,
        label: t('history.undo'),
        run: () => {
          if (outcome.undo()) notify(t('history.undone'));
        },
      });
      // El **Undo** del aviso deshace solo la restauración: con la próxima edición, el aviso se va.
      const off = outcome.onEdit(() => {
        dismissNotice(key);
        off();
      });
    } catch (err) {
      setMessage(tr('history.restoreFailed', { reason: errorMessage(err) }));
    } finally {
      setBusy(false);
    }
  }

  const format = pageFormat(tree, pageId);
  const sheet = sheetSize(format);
  const restoreButton = session && !isCurrent && (
    <button
      className="primary history-restore"
      disabled={!!blocker || busy || shapeOk === null}
      data-tip={blocker ? blockerText[blocker] : undefined}
      onClick={() => void askRestore()}
    >
      <span className="history-wide">{tr('history.restore')}</span>
      <span className="history-narrow">{tr('history.restoreShort')}</span>
    </button>
  );

  return (
    <div ref={screenRef} tabIndex={-1} className={`history-screen pane-${pane}`} role="dialog" aria-modal="true" aria-label={tr('history.title')}>
      <header className="history-bar">
        <button
          className="link history-back"
          onClick={() => {
            if (pane === 'version' && window.matchMedia?.('(max-width: 760px)').matches) setPane('list');
            else closeHistory();
          }}
        >
          ← <span className="history-back-page">{tr('history.back')}</span>
          <span className="history-back-list">{tr('history.versions')}</span>
        </button>
        <h1 className="history-title">
          <span className="history-heading">{tr('history.title')}</span>
          {session && <span className="history-when">{whenLabel(session.end, lang)}</span>}
        </h1>
        {restoreButton}
      </header>
      {/* En el teléfono no hay tooltip: el motivo de que no se pueda restaurar, en una línea (O4 de la auditoría). */}
      {session && !isCurrent && blocker && !message && <p className="history-why">{blockerText[blocker]}</p>}
      {message && (
        <p className="history-message" role="status">
          {message}
        </p>
      )}
      <div className="history-body">
        <section className="history-preview" aria-label={session ? whenLabel(session.end, lang) : tr('history.title')}>
          {loading.state === 'loading' && (
            <p className="muted history-state">
              {loading.count ? tr('history.loadingCount', { count: loading.count }) : tr('history.loading')}
            </p>
          )}
          {loading.state === 'offline' && <p className="muted history-state">{tr('history.offline')}</p>}
          {loading.state === 'denied' && <p className="muted history-state">{tr('history.denied')}</p>}
          {loading.state === 'trash' && <p className="muted history-state">{tr('history.inTrash')}</p>}
          {loading.state === 'failed' && (
            <p className="history-state">
              {tr('history.failed', { reason: loading.reason })}{' '}
              <button className="link" onClick={() => setAttempt((n) => n + 1)}>
                {tr('common.tryAgain')}
              </button>
            </p>
          )}
          {ready && sessions.length === 0 && <p className="muted history-state">{tr('history.empty')}</p>}
          {ready && ready.history.unreadable.length > 0 && (
            <p className="banner">{tr('history.unreadable', { count: ready.history.unreadable.length })}</p>
          )}
          {unsynced && <p className="banner">{tr('history.unsynced')}</p>}
          {(unknown || shapeOk === false) && <p className="banner">{tr('history.partial')}</p>}
          {version && !unknown && (
            <article
              className={`page history-page${sheet ? ' sheet' : ''}`}
              style={
                sheet
                  ? ({
                      '--sheet-width': `${sheet.width}px`,
                      '--sheet-height': `${sheet.height}px`,
                      '--gutter': `${mm(SHEET_MARGIN_MM)}px`,
                    } as CSSProperties)
                  : undefined
              }
              data-format={format.size}
              data-page-id={pageId}
            >
              <ServicesContext.Provider value={previewServices}>
                <BlockEditor
                  key={`${session?.seq}:${tr.lang}`}
                  doc={shown!}
                  collapse={new Map()}
                  pageId={pageId}
                  editable={false}
                  permsKnown
                  canComment={false}
                  onEditor={onPreviewEditor}
                  preview
                />
              </ServicesContext.Provider>
            </article>
          )}
        </section>
        <aside className="history-list" aria-label={tr('history.versions')}>
          <SessionList
            sessions={sessions}
            index={index}
            lang={lang}
            nameOf={nameOf}
            colorOf={colorOf}
            onPick={(i) => {
              setChosen(sessions[i].seq);
              setMessage(null);
              setPane('version');
            }}
          />
        </aside>
      </div>
      {confirm && (
        <div className="modal-backdrop history-confirm-backdrop" onClick={() => setConfirm(null)}>
          <div className="modal history-confirm" role="alertdialog" aria-modal="true" aria-label={tr('history.confirmTitle')} onClick={(e) => e.stopPropagation()}>
            <h2>{tr('history.confirmTitle')}</h2>
            <p>{tr('history.confirmText')}</p>
            {confirm.photos > 0 && <p>{tr('history.confirmPhotos', { count: confirm.photos })}</p>}
            {confirm.others && <p>{tr('history.othersEditing', { name: confirm.others })}</p>}
            <div className="modal-actions">
              <button className="secondary" onClick={() => setConfirm(null)}>
                {tr('common.cancel')}
              </button>
              <button className="primary" autoFocus onClick={() => void restore()}>
                {tr('history.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** La lista de versiones: por día y, adentro, una por sesión de edición (la más nueva arriba). */
function SessionList({
  sessions,
  index,
  lang,
  nameOf,
  colorOf,
  onPick,
}: {
  sessions: HistorySession[];
  index: number;
  lang: string;
  nameOf: (id: string | null) => string;
  colorOf: (id: string | null) => string;
  onPick: (index: number) => void;
}) {
  const tr = useT();
  const order = sessions.map((s, i) => ({ s, i })).reverse();
  let lastDay = '';
  return (
    <ol className="history-sessions">
      {order.map(({ s, i }) => {
        const day = dayLabel(s.end, lang);
        const header = day !== lastDay;
        lastDay = day;
        return (
          <li key={s.seq}>
            {header && <h2 className="history-day">{day}</h2>}
            <button className="history-session" aria-current={i === index ? 'true' : undefined} onClick={() => onPick(i)}>
              <span className="history-time" data-tip={tr('history.serverTimeTip')}>
                {timeLabel(s.end, lang)}
              </span>
              {i === sessions.length - 1 && <span className="history-current">{tr('history.current')}</span>}
              <span className="history-people">
                {s.authors.map((a) => (
                  <span key={a ?? 'former'} className="history-person">
                    <span className="history-dot" style={{ background: colorOf(a) }} aria-hidden="true" />
                    {nameOf(a)}
                  </span>
                ))}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
