import { useEffect, useState } from 'react';
import { useT, type Translate } from '../i18n';
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
import { linkLabelsStore } from './linkLabels';
import { linkPagesStore } from './linkPages';
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

/** La fecha local de dentro de `days` días, como la escribe un `<input type="date">`. */
export function dateInDays(days: number, now = Date.now()): string {
  const d = new Date(now + days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Los errores propios del link, en palabras (los demás, como los del equipo). `link_not_found`: el link se apagó o se
 * renovó en otro lado mientras esta ventana estaba abierta; `page_in_trash`: la página fue a la papelera (su link ya no
 * anda, y vuelve a andar al restaurarla); `link_invalid`: una fecha que ya pasó si se estaba mandando una (`dated`), y
 * si no, un pedido que la base no aceptó (un id repetido al crear o renovar): se prueba de nuevo.
 */
export function linkErrorText(tr: Translate, err: unknown, dated = false): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'link_not_found') return tr('share.link.error.gone');
  if (message === 'page_in_trash') return tr('share.link.error.trash');
  if (message === 'clean_off') return tr('share.link.cleanOff');
  if (message === 'edit_off') return tr('share.link.editOff');
  if (message === 'link_invalid') return tr(dated ? 'share.link.badDate' : 'share.link.error.invalid');
  return teamErrorText(err);
}

export function LinkShare({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const services = useServices();
  const { client, workspace } = services;
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
  // La fecha que se está eligiendo para un link que ya existe (`null`: el campo no se muestra).
  const [newDate, setNewDate] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const supported = (status.schemaVersion ?? 0) >= LINK_SCHEMA_VERSION;

  useEffect(() => {
    if (!supported) return;
    let live = true;
    getPublicLink(client, pageId).then(
      (data) => {
        if (!live) return;
        setInfo(data);
        // El ícono del árbol de esta página cambia con lo que la base acaba de decir, sin esperar su próxima vuelta.
        linkPagesStore(services)?.learn(pageId, data);
        // Y el rótulo de los comentarios hechos por un link (si el panel los está mostrando): se apagó, se renovó o
        // cambió de nivel recién, y lo recordado quedó viejo.
        linkLabelsStore(services)?.stale();
      },
      (err: unknown) => live && setError(linkErrorText(tr, err)),
    );
    return () => {
      live = false;
    };
    // `services` y `tr` cambian de identidad sin que cambie a quién se le pregunta: alcanza con el cliente y la página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, pageId, reload, supported]);

  const link = info?.link ?? null;
  // El campo de fecha es de un link: si ese link se apaga, se renueva o se crea otro, se cierra (no reaparece, con la
  // fecha que se estaba eligiendo para el anterior, al volver a *Anyone with the link*).
  const linkId = link?.id ?? null;
  useEffect(() => setNewDate(null), [linkId]);

  if (!supported || info === null) return null;

  const urlOf = (l: Pick<PublicLink, 'token'>) =>
    publicLinkUrl(location.origin, {
      u: workspace.config.url,
      k: workspace.config.publishableKey,
      l: status.workspaceLocalKey ?? workspace.config.localKey,
      t: l.token ?? '',
    });

  /** `dated`: lo que se manda lleva una fecha elegida a mano (para decir bien un `link_invalid`). */
  async function run(label: string, work: () => Promise<void>, dated = false) {
    setBusy(label);
    setError(null);
    try {
      await work();
      setReload((n) => n + 1);
    } catch (err) {
      if (err !== UNSYNCED_BEFORE_SHARE) setError(linkErrorText(tr, err, dated));
      // El link ya no está como lo mostraba esta ventana (lo cambiaron en otro lado): se vuelve a leer.
      if (err instanceof Error && err.message === 'link_not_found') setReload((n) => n + 1);
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
    void run(
      'on',
      async () => {
        await copyCreated(created);
        gate.after(scope, true, tr('share.link.visitors'));
      },
      expiry === 'date',
    );
  }

  /** Pone el vencimiento en la fecha elegida (*Set date*, o Enter en el campo: es un formulario); una fecha pasada o vacía avisa y no manda nada. */
  function confirmDate() {
    if (newDate === null || busy !== null) return;
    const at = endOfDay(newDate);
    if (!at) return setError(tr('share.link.badDate'));
    setNewDate(null);
    void run('expiry', async () => void (await setPublicLinkExpiry(client, pageId, at, linkLevel)), true);
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
          {tr(info.above.level === 'edit' ? 'share.link.aboveEdit' : 'share.link.above', { title: info.above.title || tr('share.via.pageAbove') })}{' '}
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
              // Apagarlo deja sin efecto el link para siempre (prenderlo de nuevo crea otro): se confirma, como *Reset link*.
              else if (confirm(tr('share.link.resetConfirm'))) void run('off', () => revokePublicLink(client, pageId));
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
          {/* Qué link es: quién lo creó y cuándo (el link deja de andar si esa persona ya no puede compartir la página). */}
          <p className="muted small team-lead" data-link-created>
            {link.created_by_name
              ? tr('share.link.createdBy', { name: link.created_by_name, date: new Date(link.created_at).toLocaleDateString() })
              : tr('share.link.created', { date: new Date(link.created_at).toLocaleDateString() })}
          </p>
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
                  setError(null);
                  setNewDate(dateInDays(7));
                  return;
                }
                setNewDate(null);
                void run('expiry', async () => void (await setPublicLinkExpiry(client, pageId, expiryFor(choice), linkLevel)));
              }}
            />
          </label>
          {newDate !== null && (
            // Un formulario: Enter en el campo lo manda el navegador, igual que *Set date*. Sin la validación del
            // navegador (`min`), para que una fecha pasada la avise la ventana con sus palabras.
            <form
              className="link-share-row"
              data-link-expiry="date"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                confirmDate();
              }}
            >
              <input type="date" value={newDate} min={dateInDays(0)} aria-label={tr('share.link.date')} disabled={busy !== null} onChange={(e) => setNewDate(e.target.value)} />
              <button type="submit" className="primary" disabled={busy !== null}>
                {tr('share.link.setDate')}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  setError(null);
                  setNewDate(null);
                }}
              >
                {tr('common.cancel')}
              </button>
            </form>
          )}
          <p className="muted small team-lead">
            {tr('share.link.usage', {
              opens: tr('share.link.usageOpens', { count: opens }),
              comments: tr('share.link.usageComments', { count: commentsToday }),
              mb: megabytes(usage.pull?.bytes ?? 0),
            })}
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
