import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { locale, t, useT } from '../i18n';
import '../i18n/lazy/teamDialogs';
import { copyWhenReady, inviteLink } from '../invite';
import { usePermissions, useServices, useSyncStatus, useTree } from '../services';
import { GRANT_LEVELS, LEVEL_LABELS, ROLE_LABELS, type GrantLevel, type Role } from '../sync/access';
import type { InvitationGrant, InvitationRow, MemberRow } from '../sync/remote';
import { notify } from './notice';
import { useCurrentProject } from './project';
import { ShareGateNotes, UNSYNCED_BEFORE_SHARE, useShareGate } from './shareGate';
import { teamErrorText } from './teamText';

// "Members" en el menú de la cuenta (dueño y admins): quién está en el workspace, invitar, cambiar el rol y
// sacar a alguien. Un modal rápido, nunca una página nueva (paso 9 de Docs/Plan_Workspaces.md).


/** Arma el link de invitación del workspace abierto, hacia una página o un proyecto. */
export function useInviteLink(): (target?: string) => string {
  const { workspace } = useServices();
  const status = useSyncStatus();
  const { url, publishableKey, localKey } = workspace.config;
  const key = status.workspaceLocalKey ?? localKey;
  // El nombre va para que quien lo abre vea "Join <nombre> at <host>?" (paso 12).
  const name = status.workspaceName ?? workspace.config.name;
  return useCallback(
    (target?: string) => inviteLink(location.origin, { u: url, k: publishableKey, l: key, p: target, n: name || undefined }),
    [url, publishableKey, key, name],
  );
}

/**
 * Crea la invitación y copia su link. Se llama dentro del gesto (el envío del formulario), sin esperar nada
 * antes: así Safari deja copiar aunque el link llegue después. Devuelve el link si no se pudo copiar (se
 * muestra para copiarlo a mano), o `null` si se copió (y avisa). Si la invitación falla, rechaza.
 */
export async function inviteAndCopy(link: Promise<string>): Promise<string | null> {
  const copied = copyWhenReady(link);
  const text = await link;
  if (await copied) {
    notify(t('team.linkCopied'));
    return null;
  }
  return text;
}

type InviteRole = Exclude<Role, 'owner'>;

export function MembersDialog({ onClose }: { onClose: () => void }) {
  const { remote, user } = useServices();
  const perms = usePermissions();
  const tree = useTree();
  const projectId = useCurrentProject();
  const tr = useT();
  const projectName = tree.project(projectId)?.name ?? tr('project.thisProject');
  const makeLink = useInviteLink();
  const myRole = perms.role;
  const isOwner = myRole === 'owner';

  const [members, setMembers] = useState<MemberRow[] | null>(null);
  // Las invitaciones sin usar; `null` si la base no tiene `list_invitations` (la sección no se muestra).
  const [invitations, setInvitations] = useState<InvitationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('member');
  const [withProject, setWithProject] = useState(false);
  const [level, setLevel] = useState<GrantLevel>('edit');
  const [manualLink, setManualLink] = useState<string | null>(null);
  const canGiveProject = perms.projectLevel(projectId) >= 4;
  // Privacidad de lo borrado: con Ver, Comentar o a un invitado, lo del proyecto sube antes y se prepara después.
  const gate = useShareGate();
  const formReader = withProject && canGiveProject && (role === 'guest' || level === 'view' || level === 'comment');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    setError(null);
    remote.listMembers().then(
      (rows) => live && setMembers(rows),
      (err: unknown) => live && setError(teamErrorText(err)),
    );
    remote.listInvitations().then(
      (rows) => live && setInvitations(rows),
      () => live && setInvitations(null),
    );
    return () => {
      live = false;
    };
  }, [remote, reload]);

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await work();
      setReload((n) => n + 1);
    } catch (err) {
      setError(teamErrorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    await send(false);
  }

  /** Invita; `anyway`: sin esperar a que suba lo pendiente (el aviso de shareGate.tsx). */
  async function send(anyway: boolean) {
    const address = email.trim().toLowerCase();
    if (!address) return;
    const grants: InvitationGrant[] = withProject && canGiveProject ? [{ project_id: projectId, level }] : [];
    const reader = formReader;
    const scope = { projectId };
    if (anyway) gate.clearBlocked();
    // Sin nada que espere antes del pedido del portapapeles: se pide en el mismo gesto (el link llega después).
    const copying = inviteAndCopy(
      (anyway ? Promise.resolve(true) : gate.ready(scope, reader, () => void send(false), () => void send(true)))
        .then((ok) => {
          if (!ok) throw UNSYNCED_BEFORE_SHARE;
          return remote.createInvitation(address, role, grants);
        })
        .then(() => makeLink(grants.length ? projectId : undefined)),
    );
    await run('invite', async () => {
      let manual: string | null;
      try {
        manual = await copying;
      } catch (err) {
        if (err === UNSYNCED_BEFORE_SHARE) return;
        throw err;
      }
      setEmail('');
      setManualLink(manual);
      gate.after(scope, reader, address);
    });
  }

  function canChangeRole(m: MemberRow): boolean {
    if (m.removed_at || m.role === 'owner' || m.user_id === user.id) return false;
    return isOwner || m.role !== 'admin';
  }

  function remove(m: MemberRow) {
    const ok = confirm(t('members.removeConfirm', { email: m.email }));
    if (ok) void run(`remove:${m.user_id}`, async () => void (await remote.removeMember(m.user_id)));
  }

  const roleChoices: InviteRole[] = isOwner ? ['admin', 'member', 'guest'] : ['member', 'guest'];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal team-dialog" role="dialog" aria-label={tr('members.title')} onClick={(e) => e.stopPropagation()}>
        <h2>{tr('members.title')}</h2>

        <form className="team-invite" onSubmit={(e) => void invite(e)}>
          <span className="pref-label">{tr('members.invite')}</span>
          <div className="team-invite-row">
            <input
              type="email"
              required
              placeholder={tr('team.emailPlaceholder')}
              aria-label={tr('team.email')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <select aria-label={tr('team.role')} value={role} onChange={(e) => setRole(e.target.value as InviteRole)}>
              {roleChoices.map((r) => (
                <option key={r} value={r}>
                  {tr(ROLE_LABELS[r])}
                </option>
              ))}
            </select>
          </div>
          {canGiveProject && (
            <label className="team-check">
              <input type="checkbox" checked={withProject} onChange={(e) => setWithProject(e.target.checked)} />
              <span>{tr('members.giveAccess', { name: projectName })}</span>
              {withProject && (
                <select aria-label={tr('team.access')} value={level} onChange={(e) => setLevel(e.target.value as GrantLevel)}>
                  {GRANT_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {tr(LEVEL_LABELS[l])}
                    </option>
                  ))}
                </select>
              )}
            </label>
          )}
          <div className="team-invite-actions">
            <span className="muted">{tr('members.inviteHint')}</span>
            <button className="primary" disabled={busy !== null || !email.trim()}>
              {busy === 'invite' ? tr('team.inviting') : tr('team.inviteAndCopy')}
            </button>
          </div>
          {manualLink && (
            <div className="team-link">
              <span className="muted">{tr('team.copyManually')}</span>
              <input readOnly value={manualLink} onFocus={(e) => e.currentTarget.select()} aria-label={tr('team.inviteLink')} />
            </div>
          )}
          <ShareGateNotes gate={gate} reader={formReader || gate.blocked !== null} />
        </form>

        {error && <p className="error">{error}</p>}

        <ul className="team-list" aria-label={tr('members.people')}>
          {members === null && !error && <li className="muted">{tr('common.loading')}</li>}
          {members?.map((m) => (
            <li key={m.user_id} className={m.removed_at ? 'removed' : undefined}>
              <span className="team-who">
                <span className="team-email" data-tip={m.email} data-tip-plain data-tip-overflow>
                  {m.email}
                  {m.user_id === user.id && <span className="muted"> {tr('members.you')}</span>}
                </span>
                <span className="mono-label">
                  {m.removed_at
                    ? tr('members.removedOn', { date: new Date(m.removed_at).toLocaleDateString(locale(tr.lang)) })
                    : tr('members.active')}
                </span>
              </span>
              {canChangeRole(m) ? (
                <select
                  aria-label={tr('members.roleOf', { email: m.email })}
                  value={m.role}
                  disabled={busy !== null}
                  onChange={(e) => {
                    const next = e.target.value as InviteRole;
                    void run(`role:${m.user_id}`, () => remote.setMemberRole(m.user_id, next));
                  }}
                >
                  {(isOwner ? (['admin', 'member', 'guest'] as InviteRole[]) : (['member', 'guest'] as InviteRole[])).map((r) => (
                    <option key={r} value={r}>
                      {tr(ROLE_LABELS[r])}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="team-role">{ROLE_LABELS[m.role] ? tr(ROLE_LABELS[m.role]) : m.role}</span>
              )}
              {canChangeRole(m) ? (
                <button className="link danger" disabled={busy !== null} onClick={() => remove(m)}>
                  {tr('members.remove')}
                </button>
              ) : (
                <span className="team-spacer" />
              )}
            </li>
          ))}
        </ul>

        {invitations && invitations.length > 0 && (
          <>
            <span className="pref-label">{tr('members.invitations')}</span>
            <ul className="team-list" aria-label={tr('members.invitations')}>
              {invitations.map((inv) => {
                const canRevoke = isOwner || inv.invited_by === user.id;
                return (
                  <li key={inv.id}>
                    <span className="team-who">
                      <span className="team-email" data-tip={inv.email} data-tip-plain data-tip-overflow>
                        {inv.email}
                      </span>
                      <span className="mono-label">
                        {inv.invited_by_email ? tr('members.invitedBy', { email: inv.invited_by_email }) : tr('members.invited')}
                        {inv.expires_at
                          ? ` · ${tr('members.until', { date: new Date(inv.expires_at).toLocaleDateString(locale(tr.lang)) })}`
                          : ''}
                      </span>
                    </span>
                    <span className="team-role">{ROLE_LABELS[inv.role] ? tr(ROLE_LABELS[inv.role]) : inv.role}</span>
                    {canRevoke ? (
                      <button
                        className="link danger"
                        disabled={busy !== null}
                        onClick={() => {
                          if (confirm(t('members.revokeConfirm', { email: inv.email }))) {
                            void run(`revoke:${inv.id}`, () => remote.revokeInvitation(inv.id));
                          }
                        }}
                      >
                        {tr('members.revoke')}
                      </button>
                    ) : (
                      <span className="team-spacer" />
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>{tr('common.close')}</button>
        </div>
      </div>
    </div>
  );
}
