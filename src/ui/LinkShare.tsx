import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/teamDialogs';
import { copyText, copyWhenReady } from '../invite';
import { publicLinkUrl } from '../linkMode';
import { navigate, pagePath } from '../router';
import { useServices, useSyncStatus } from '../services';
import {
  createPublicLink,
  deletePublicLinkComments,
  expiryFor,
  getPublicLink,
  LINK_DRIVE_WARN_BYTES,
  LINK_SCHEMA_VERSION,
  resetPublicLink,
  revokePublicLink,
  setPublicLink,
  setPublicLinkExpiry,
  type ExpiryChoice,
  type LinkLevel,
  type PublicLink,
  type PublicLinkInfo,
} from '../sync/publicLinks';
import { LinkAsideList } from './LinkAsideList';
import { LinkFilesList } from './LinkFilesList';
import { notify } from './notice';
import { ShareGateNotes, UNSYNCED_BEFORE_SHARE, useShareGate } from './shareGate';
import { teamErrorText } from './teamText';

// "General access" en Share de una página (Docs/Doc_Link_Publico.md, 3.11): Restricted o Anyone with the link (Can
// view, que comenta), copiar, vencer (D30: Never por defecto), Reset link, el uso de hoy y quitarlo. Solo se ve con la
// base en la versión de los links; crear pide el interruptor de D14 (D33: si está apagado, la opción se ve apagada con
// la línea que lo explica). Con la versión 19, Can edit (entrega 2a, E2.8): apagado con su línea si el interruptor de
// Can edit no está prendido; prendido, la línea de cómo llega lo que escribe el link y sus números.

function megabytes(bytes: number): string {
  return (bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0);
}

/** Lo subido al Drive: en MB, o en GB desde 1 GB (*1.2 GB*). */
export function driveSize(bytes: number): string {
  return bytes >= 1_073_741_824 ? `${(bytes / 1_073_741_824).toFixed(1)} GB` : `${megabytes(bytes)} MB`;
}

/** El fin del día elegido (hora local), o `null` si no es una fecha futura. */
export function endOfDay(date: string, now = Date.now()): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
  return end.getTime() > now ? end.toISOString() : null;
}

export function LinkShare({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const { client, workspace } = useServices();
  const status = useSyncStatus();
  const tr = useT();
  const gate = useShareGate();
  const [info, setInfo] = useState<PublicLinkInfo | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<ExpiryChoice | 'date'>('never');
  const [level, setLevel] = useState<LinkLevel>('comment');
  const [date, setDate] = useState('');
  const [reload, setReload] = useState(0);

  const supported = (status.schemaVersion ?? 0) >= LINK_SCHEMA_VERSION;

  useEffect(() => {
    if (!supported) return;
    let live = true;
    getPublicLink(client, pageId).then(
      (data) => live && setInfo(data),
      (err: unknown) => live && setError(teamErrorText(err)),
    );
    return () => {
      live = false;
    };
  }, [client, pageId, reload, supported]);

  if (!supported || info === null) return null;

  const link = info?.link ?? null;
  const urlOf = (l: Pick<PublicLink, 'token'>) =>
    publicLinkUrl(location.origin, {
      u: workspace.config.url,
      k: workspace.config.publishableKey,
      l: status.workspaceLocalKey ?? workspace.config.localKey,
      t: l.token ?? '',
    });

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await work();
      setReload((n) => n + 1);
    } catch (err) {
      if (err !== UNSYNCED_BEFORE_SHARE) setError(teamErrorText(err));
    } finally {
      setBusy(null);
    }
  }

  /** Copia el link que todavía se está creando (en el mismo gesto, para Safari); si no se pudo, lo muestra. */
  async function copyCreated(created: Promise<PublicLink>) {
    const text = created.then(urlOf);
    const copied = copyWhenReady(text);
    const url = await text;
    if (await copied) {
      notify(tr('share.link.copied'));
      setManual(null);
    } else setManual(url);
  }

  function expiresValue(): string | null | undefined {
    if (expiry !== 'date') return expiryFor(expiry);
    return endOfDay(date) ?? undefined;
  }

  /** Anyone with the link: antes sube lo pendiente de la rama; después arma las bases (D14), y copia el link. */
  function turnOn(anyway = false) {
    const expires = expiresValue();
    if (expires === undefined) {
      setError(tr('share.link.badDate'));
      return;
    }
    if (anyway) gate.clearBlocked();
    const scope = { pageId };
    const created = (anyway ? Promise.resolve(true) : gate.ready(scope, true, () => turnOn(), () => turnOn(true))).then((ok) => {
      if (!ok) throw UNSYNCED_BEFORE_SHARE;
      return createPublicLink(client, pageId, expires, level);
    });
    void run('on', async () => {
      await copyCreated(created);
      gate.after(scope, true, tr('share.link.visitors'));
    });
  }

  const usage = link?.usage_today ?? {};
  const opens = usage.open?.n ?? 0;
  const commentsToday = usage.comment?.n ?? 0;
  const editOn = info?.edit_on === true;
  const linkLevel: LinkLevel = link?.level === 'edit' ? 'edit' : 'comment';
  const shownLevel: LinkLevel = link ? linkLevel : level;
  // Lo que llegó al Drive (O3 de la auditoría de la 2b): lo registrado que no subió no cuenta. Una base sin el dato, lo registrado.
  const inDrive = link?.files ? (link.files.drive_bytes ?? link.files.bytes) : 0;

  return (
    <section className="link-share" aria-label={tr('share.link.general')}>
      <span className="pref-label">{tr('share.link.general')}</span>
      {info === undefined && !error && <p className="muted small">{tr('common.loading')}</p>}
      {info?.above && !link && (
        <p className="muted small team-lead">
          {tr('share.link.above', { title: info.above.title || tr('share.via.pageAbove') })}{' '}
          {info.above.title !== null && (
            <button
              type="button"
              className="link"
              onClick={() => {
                onClose();
                navigate(pagePath(info.above!.page_id));
              }}
            >
              {tr('share.link.goAbove')}
            </button>
          )}
        </p>
      )}
      {info && (
        <div className="link-share-row">
          <select
            aria-label={tr('share.link.general')}
            value={link ? 'anyone' : 'restricted'}
            disabled={busy !== null || (!link && !info.clean_on)}
            onChange={(e) => {
              if (e.target.value === 'anyone') turnOn();
              else void run('off', () => revokePublicLink(client, pageId));
            }}
          >
            <option value="restricted">{tr('share.link.restricted')}</option>
            <option value="anyone">{tr('share.link.anyone')}</option>
          </select>
          {/* Can edit solo con su interruptor; uno que ya es Can edit se puede bajar a Can view igual. */}
          <select
            aria-label={tr('share.link.canEdit')}
            value={shownLevel}
            disabled={busy !== null || (!editOn && shownLevel === 'comment')}
            onChange={(e) => {
              const next = e.target.value as LinkLevel;
              if (!link) return setLevel(next);
              void run('level', async () => void (await setPublicLink(client, pageId, next, link.expires_at)));
            }}
          >
            <option value="comment">{tr('share.link.canView')}</option>
            <option value="edit" disabled={!editOn}>
              {tr('share.link.canEdit')}
            </option>
          </select>
        </div>
      )}
      {info && info.clean_on && info.edit_on === false && <p className="muted small team-lead">{tr('share.link.editOff')}</p>}
      {info && shownLevel === 'edit' && <p className="muted small team-lead">{tr('share.link.editHint')}</p>}
      {info && !link && !info.clean_on && <p className="muted small team-lead">{tr('share.link.cleanOff')}</p>}
      {info && !link && info.clean_on && (
        <>
          <p className="muted small team-lead">{tr('share.link.restrictedHint')}</p>
          <label className="team-check">
            <span>{tr('share.link.expires')}</span>
            <ExpirySelect value={expiry} onChange={setExpiry} />
            {expiry === 'date' && <input type="date" value={date} aria-label={tr('share.link.date')} onChange={(e) => setDate(e.target.value)} />}
          </label>
        </>
      )}
      {link && (
        <>
          <p className="muted small team-lead">{tr('share.link.anyoneHint')}</p>
          {/* Los PDF exportados con este link lo llevan en sus links a archivos (P.30, LF18). */}
          <p className="muted small team-lead">{tr('share.link.pdfHint')}</p>
          {!link.alive && <p className="warn small team-lead">{tr('share.link.notAlive')}</p>}
          <div className="team-invite-actions link-share-actions">
            <button
              type="button"
              className="primary"
              disabled={busy !== null || !link.token}
              onClick={() =>
                void copyText(urlOf(link)).then((ok) => {
                  if (ok) notify(tr('share.link.copied'));
                  else setManual(urlOf(link));
                })
              }
            >
              {tr('share.link.copy')}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                if (!confirm(tr('share.link.resetConfirm'))) return;
                void run('reset', () => copyCreated(resetPublicLink(client, pageId)));
              }}
            >
              {tr('share.link.reset')}
            </button>
          </div>
          <label className="team-check">
            <span>{tr('share.link.expires')}</span>
            <span className="muted small">
              {link.expires_at ? tr('share.link.expiresOn', { date: new Date(link.expires_at).toLocaleDateString() }) : tr('share.link.never')}
            </span>
            <ExpirySelect
              value={null}
              disabled={busy !== null}
              onChange={(choice) => {
                if (choice === 'date') {
                  const asked = prompt(tr('share.link.datePrompt'), new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
                  const at = asked ? endOfDay(asked.trim()) : null;
                  if (asked && !at) return setError(tr('share.link.badDate'));
                  if (at) void run('expiry', async () => void (await setPublicLinkExpiry(client, pageId, at, linkLevel)));
                  return;
                }
                void run('expiry', async () => void (await setPublicLinkExpiry(client, pageId, expiryFor(choice), linkLevel)));
              }}
            />
          </label>
          <p className="muted small team-lead">
            {tr('share.link.usage', { opens, comments: commentsToday, mb: megabytes(usage.pull?.bytes ?? 0) })}
          </p>
          {link.edits && (link.level === 'edit' || link.edits.waiting + link.edits.held + link.edits.aside + link.edits.admitted_today > 0) && (
            <p className="muted small team-lead">
              {tr('share.link.edits', {
                added: link.edits.admitted_today,
                waiting: link.edits.waiting,
                aside: link.edits.aside,
                held: link.edits.held,
              })}
            </p>
          )}
          {/* Lo que subió al Drive del dueño (entrega 2b): el uso y, desde 1 GB, el aviso. */}
          {link.files && (link.level === 'edit' || link.files.total > 0) && (
            <p className="muted small team-lead">
              {tr('share.link.files', { today: usage.file?.n ?? 0, total: link.files.total, size: driveSize(inDrive) })}
            </p>
          )}
          {link.files && inDrive > LINK_DRIVE_WARN_BYTES && (
            <p className="warn small team-lead">{tr('share.link.filesBig', { size: driveSize(inDrive) })}</p>
          )}
          {link.limited && <p className="warn small team-lead">{tr('share.link.limited')}</p>}
          {link.comments > 0 && (
            <button
              type="button"
              className="link danger"
              disabled={busy !== null}
              onClick={() => {
                if (!confirm(tr('share.link.deleteCommentsConfirm', { count: link.comments }))) return;
                void run('comments', async () => void (await deletePublicLinkComments(client, link.id)));
              }}
            >
              {tr('share.link.deleteComments', { count: link.comments })}
            </button>
          )}
        </>
      )}
      {manual && (
        <div className="team-link">
          <span className="muted">{tr('team.copyManually')}</span>
          <input readOnly value={manual} onFocus={(e) => e.currentTarget.select()} aria-label={tr('share.link.copy')} />
        </div>
      )}
      {/* Lo apartado de los links de esta página (también de los anteriores), para leerlo y bajarlo (entrega 2c). */}
      {info && <LinkAsideList pageId={pageId} linkId={link?.id ?? null} />}
      {/* Los archivos que subieron los links de esta página, también los de lo apartado (entrega 2b, decisión de Lega). */}
      {info && <LinkFilesList pageId={pageId} linkId={link?.id ?? null} />}
      <ShareGateNotes gate={gate} reader={!link && !!info?.clean_on} />
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function ExpirySelect({
  value,
  onChange,
  disabled,
}: {
  value: ExpiryChoice | 'date' | null;
  onChange: (choice: ExpiryChoice | 'date') => void;
  disabled?: boolean;
}) {
  const tr = useT();
  return (
    <select
      aria-label={tr('share.link.expires')}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => e.target.value && onChange(e.target.value as ExpiryChoice | 'date')}
    >
      {value === null && <option value="">{tr('share.link.change')}</option>}
      <option value="never">{tr('share.link.never')}</option>
      <option value="1">{tr('share.link.days', { count: 1 })}</option>
      <option value="7">{tr('share.link.days', { count: 7 })}</option>
      <option value="30">{tr('share.link.days', { count: 30 })}</option>
      <option value="date">{tr('share.link.onDate')}</option>
    </select>
  );
}
