import { useEffect, useState } from 'react';
import { useT, type Key } from '../i18n';
import '../i18n/lazy/teamDialogs';
import { useServices, useSyncStatus, useTree } from '../services';
import { LEVEL_LABELS } from '../sync/access';
import type { VendorTeam } from '../sync/remote';
import { CheckIcon, CloseIcon, CommentIcon, EyeIcon, HistoryIcon, LockIcon, PlusIcon, UndoIcon, WarningIcon } from './icons';
import { inviteAndCopy, useInviteLink } from './MembersDialog';
import { teamErrorText } from './teamText';

// *Share all scenes of “<vendor>”* (Docs/Doc_Compartir_Escenas.md, sección 12, D854): quien es del equipo de un vendor
// suma gente al equipo. Cada correo del equipo ve todas las escenas del vendor y puede repartirlas entre artistas. El
// nivel lo decide el proyecto; lo que sumó el proyecto lleva candado (solo el proyecto lo saca), y uno no se saca a sí
// mismo. Si un correo ya tiene acceso al proyecto por otro lado, la base no dice dónde (`email_in_use`). Un solo *Save*
// manda todo (`save_vendor_team`, todo o nada) y, con correos nuevos, copia el link de invitación.

const EMAIL = /^[^@\s]+@[^@\s]+$/;

const SAVE_ERRORS: Record<string, Key> = {
  email_in_use: 'scenes.team.emailInUse',
  email_exists: 'scenes.team.already',
  email_locked: 'scenes.team.emailLocked',
  own_email: 'scenes.team.ownEmail',
  clean_off: 'scenes.share.cleanOff',
  not_allowed: 'scenes.team.gone',
  vendor_changed: 'scenes.team.changed',
};

export function VendorTeamDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { remote } = useServices();
  const tree = useTree();
  const status = useSyncStatus();
  const makeLink = useInviteLink();
  const tr = useT();
  const projectName = tree.project(projectId)?.name ?? tr('project.thisProject');

  const [team, setTeam] = useState<VendorTeam | null>(null);
  const [reload, setReload] = useState(0);
  const [added, setAdded] = useState<string[]>([]);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [reinvite, setReinvite] = useState<ReadonlySet<string>>(new Set());
  const [text, setText] = useState('');
  const [mailError, setMailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { pending: number }>(null);
  const [manualLink, setManualLink] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    setError(null);
    remote.vendorTeamGet(projectId).then(
      (got) => {
        if (!live) return;
        setTeam(got);
        setAdded([]);
        setRemoved(new Set());
        setReinvite(new Set());
      },
      (err: unknown) => {
        if (!live) return;
        const gone = err instanceof Error && err.message === 'not_allowed';
        setError(gone ? tr('scenes.team.gone') : teamErrorText(err));
      },
    );
    return () => {
      live = false;
    };
  }, [remote, projectId, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const vendor = team?.vendor ?? null;
  const sceneCount = vendor ? vendor.scenes.filter((s) => s.alive).length : 0;
  const invites = added.length + reinvite.size;
  const changes = added.length + removed.size + reinvite.size;
  const canSave = !busy && status.cleanOn && team !== null && changes > 0;

  function add() {
    if (!team || !vendor) return;
    const email = text.trim().toLowerCase();
    if (!email) return;
    if (!EMAIL.test(email) || email.length > 320) return setMailError(tr('scenes.share.emailInvalid'));
    if (email === team.me) return setMailError(tr('scenes.team.ownEmail'));
    if (added.includes(email) || vendor.emails.some((e) => e.email === email && !removed.has(email))) {
      return setMailError(tr('scenes.team.already'));
    }
    const artist = team.artists.find((a) => a.emails.some((e) => e.email === email));
    if (artist) return setMailError(tr('scenes.team.isArtist', { name: artist.name }));
    // Sacado y vuelto a sumar en la misma pasada: queda como estaba.
    if (removed.has(email)) {
      setRemoved((s) => {
        const next = new Set(s);
        next.delete(email);
        return next;
      });
    } else setAdded((list) => [...list, email]);
    setText('');
    setMailError(null);
  }

  function save() {
    if (!canSave) return;
    const op = {
      op: 'team' as const,
      ...(added.length ? { add_emails: added } : {}),
      ...(removed.size ? { remove_emails: [...removed] } : {}),
      ...(reinvite.size ? { reinvite: [...reinvite] } : {}),
    };
    setError(null);
    setDone(null);
    setManualLink(null);
    // En el gesto: el link se copia sin esperar nada antes (Safari).
    const work = remote.saveVendorTeam(projectId, [op], vendor?.id);
    setBusy(true);
    void (async () => {
      try {
        const manual = invites > 0 ? await inviteAndCopy(work.then(() => makeLink(projectId))) : null;
        const result = await work;
        setManualLink(manual);
        // «El link ya está copiado» solo si este guardado invitó a alguien y el link se copió.
        setDone({ pending: invites > 0 && !manual ? result.pending.length : 0 });
        setReload((n) => n + 1);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(SAVE_ERRORS[message] ? tr(SAVE_ERRORS[message]) : teamErrorText(err));
      } finally {
        setBusy(false);
      }
    })();
  }

  const rows = vendor
    ? [
        ...vendor.emails.map((e) => ({
          email: e.email,
          state: removed.has(e.email) ? ('removed' as const) : reinvite.has(e.email) ? ('again' as const) : e.state,
          byTeam: !!e.by_team,
        })),
        ...added.map((email) => ({ email, state: 'new' as const, byTeam: true })),
      ]
    : [];
  const stateWord: Record<(typeof rows)[number]['state'], Key> = {
    joined: 'scenes.share.emailJoined',
    invited: 'scenes.share.emailInvited',
    expired: 'scenes.share.emailExpired',
    new: 'scenes.share.emailNew',
    again: 'scenes.share.emailNew',
    removed: 'scenes.share.emailRemoved',
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal team-dialog vendor-team" role="dialog" aria-label={tr('project.vendorTeamItem')} onClick={(e) => e.stopPropagation()}>
        <div className="share-vendors-head">
          <div>
            <h2>{tr('scenes.team.title', { name: vendor?.name ?? projectName })}</h2>
            {vendor && <p className="muted team-lead">{tr('scenes.team.lead', { name: vendor.name, count: sceneCount })}</p>}
          </div>
          <button type="button" className="icon-button" aria-label={tr('common.close')} onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </div>
        {!status.cleanOn && (
          <p className="warn small team-lead" role="alert">
            {tr('scenes.share.cleanOff')}
          </p>
        )}

        {vendor && (
          <>
            <p className="share-vendor-hint vendor-team-level">
              {vendor.level === 'view' ? <EyeIcon size={14} /> : <CommentIcon size={14} />}
              <span>{tr('scenes.team.level', { level: tr(LEVEL_LABELS[vendor.level]), project: projectName })}</span>
            </p>
            <div className="vendor-team-label">{tr('scenes.team.members', { name: vendor.name.toUpperCase(), count: rows.filter((r) => r.state !== 'removed').length })}</div>
            <ul className="vendor-team-list">
              {rows.map((r) => {
                const me = r.email === team?.me;
                const locked = !r.byTeam;
                return (
                  <li key={r.email} className={`vendor-team-row ${r.state}`}>
                    <span className="vendor-team-avatar" aria-hidden>
                      {r.email[0]?.toUpperCase()}
                    </span>
                    <span className="vendor-team-who">
                      <b>
                        {r.email}
                        {me && <span className="muted"> · {tr('scenes.team.you')}</span>}
                      </b>
                      <span className="vendor-team-meta">
                        <span className={`s ${r.state}`}>
                          {r.state === 'joined' && <CheckIcon size={12} />}
                          {r.state === 'invited' && <HistoryIcon size={12} />}
                          {tr(stateWord[r.state])}
                        </span>
                        <span aria-hidden>·</span>
                        <span>{tr('scenes.team.addedBy', { name: locked ? projectName : vendor.name })}</span>
                        {r.state === 'expired' && !locked && (
                          <button type="button" className="link" onClick={() => setReinvite((s) => new Set(s).add(r.email))}>
                            {tr('scenes.share.reinvite')}
                          </button>
                        )}
                      </span>
                    </span>
                    {locked ? (
                      <span
                        className="vendor-team-lock"
                        role="img"
                        aria-label={tr('scenes.team.lockedTip', { name: projectName })}
                        data-tip={tr('scenes.team.lockedTip', { name: projectName })}
                      >
                        <LockIcon size={15} />
                      </span>
                    ) : me ? (
                      <span />
                    ) : (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={tr(r.state === 'removed' ? 'scenes.share.undoRemove' : 'scenes.share.removeEmail', { email: r.email })}
                        onClick={() => {
                          if (r.state === 'new') return setAdded((list) => list.filter((x) => x !== r.email));
                          setRemoved((s) => {
                            const next = new Set(s);
                            if (next.has(r.email)) next.delete(r.email);
                            else next.add(r.email);
                            return next;
                          });
                          setReinvite((s) => {
                            const next = new Set(s);
                            next.delete(r.email);
                            return next;
                          });
                        }}
                      >
                        {r.state === 'removed' ? <UndoIcon size={15} /> : <CloseIcon size={15} />}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <form
              className="vendor-team-add"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <input
                type="email"
                value={text}
                maxLength={320}
                placeholder={tr('scenes.team.addEmail')}
                aria-label={tr('scenes.team.addEmail')}
                onChange={(e) => {
                  setText(e.target.value);
                  setMailError(null);
                }}
              />
              <button type="submit">
                <PlusIcon size={14} />
                {tr('scenes.team.add')}
              </button>
            </form>
            {mailError && (
              <p className="share-vendor-hint err" role="alert">
                <WarningIcon size={14} />
                <span>{mailError}</span>
              </p>
            )}
          </>
        )}

        {manualLink && (
          <div className="team-link">
            <span className="muted">{tr('team.copyManually')}</span>
            <input readOnly value={manualLink} onFocus={(e) => e.currentTarget.select()} aria-label={tr('team.inviteLink')} />
          </div>
        )}
        {error && <p className="error">{error}</p>}
        {done && (
          <p className="muted team-lead" role="status">
            {done.pending > 0 ? tr('scenes.share.donePending', { count: done.pending }) : tr('scenes.share.done')}
          </p>
        )}

        <div className="team-invite-actions share-scenes-footer">
          <span className="share-scenes-sum">
            {changes > 0 ? (
              <>
                {added.length > 0 && <span className="plus">+{added.length}</span>}
                {removed.size > 0 && <span className="minus">−{removed.size}</span>}
                {invites > 0 && <span className="muted">{tr('scenes.share.invites', { count: invites })}</span>}
              </>
            ) : (
              <span className="muted">{tr('scenes.share.noChanges')}</span>
            )}
          </span>
          <button type="button" onClick={onClose}>
            {tr('common.close')}
          </button>
          <button type="button" className="primary" disabled={!canSave} onClick={save}>
            {busy ? tr('scenes.share.saving') : invites > 0 ? tr('scenes.share.inviteAndSave') : tr('scenes.share.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
