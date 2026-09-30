import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { copyWhenReady, inviteLink } from '../invite';
import { usePermissions, useServices, useSyncStatus, useTree } from '../services';
import { GRANT_LEVELS, LEVEL_LABELS, ROLE_LABELS, type GrantLevel, type Role } from '../sync/access';
import type { InvitationGrant, InvitationRow, MemberRow } from '../sync/remote';
import { notify } from './notice';
import { useCurrentProject } from './project';
import { teamErrorText } from './teamText';

// "Members" en el menú de la cuenta (dueño y admins): quién está en el workspace, invitar, cambiar el rol y
// sacar a alguien. Un modal rápido, nunca una página nueva (paso 9 de Docs/Plan_Workspaces.md).

export const LINK_COPIED = 'Link copied — send it by email or WhatsApp';

/** Arma el link de invitación del workspace abierto, hacia una página o un proyecto. */
export function useInviteLink(): (target?: string) => string {
  const { workspace } = useServices();
  const status = useSyncStatus();
  const { url, publishableKey, localKey } = workspace.config;
  const key = status.workspaceLocalKey ?? localKey;
  return useCallback(
    (target?: string) => inviteLink(location.origin, { u: url, k: publishableKey, l: key, p: target }),
    [url, publishableKey, key],
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
    notify(LINK_COPIED);
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
  const projectName = tree.project(projectId)?.name ?? 'this project';
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
    const address = email.trim().toLowerCase();
    if (!address) return;
    const grants: InvitationGrant[] = withProject && canGiveProject ? [{ project_id: projectId, level }] : [];
    // Sin nada que espere antes: el portapapeles se pide en el mismo gesto.
    const copying = inviteAndCopy(
      remote.createInvitation(address, role, grants).then(() => makeLink(grants.length ? projectId : undefined)),
    );
    await run('invite', async () => {
      const manual = await copying;
      setEmail('');
      setManualLink(manual);
    });
  }

  function canChangeRole(m: MemberRow): boolean {
    if (m.removed_at || m.role === 'owner' || m.user_id === user.id) return false;
    return isOwner || m.role !== 'admin';
  }

  function remove(m: MemberRow) {
    const ok = confirm(
      `Remove ${m.email} from the workspace?\n\n` +
        'They lose access right away, on every device. Projects they shared with others move to an admin, ' +
        'and their private projects stay hidden. Nothing is deleted. Their app offers to keep any changes ' +
        'that were not uploaded yet.',
    );
    if (ok) void run(`remove:${m.user_id}`, async () => void (await remote.removeMember(m.user_id)));
  }

  const roleChoices: InviteRole[] = isOwner ? ['admin', 'member', 'guest'] : ['member', 'guest'];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal team-dialog" role="dialog" aria-label="Members" onClick={(e) => e.stopPropagation()}>
        <h2>Members</h2>

        <form className="team-invite" onSubmit={(e) => void invite(e)}>
          <span className="pref-label">Invite someone</span>
          <div className="team-invite-row">
            <input
              type="email"
              required
              placeholder="name@example.com"
              aria-label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as InviteRole)}>
              {roleChoices.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          {canGiveProject && (
            <label className="team-check">
              <input type="checkbox" checked={withProject} onChange={(e) => setWithProject(e.target.checked)} />
              <span>Give access to “{projectName}”</span>
              {withProject && (
                <select aria-label="Access" value={level} onChange={(e) => setLevel(e.target.value as GrantLevel)}>
                  {GRANT_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {LEVEL_LABELS[l]}
                    </option>
                  ))}
                </select>
              )}
            </label>
          )}
          <div className="team-invite-actions">
            <span className="muted">The app copies an invitation link for you to send.</span>
            <button className="primary" disabled={busy !== null || !email.trim()}>
              {busy === 'invite' ? 'Inviting…' : 'Invite and copy link'}
            </button>
          </div>
          {manualLink && (
            <div className="team-link">
              <span className="muted">Copy this link and send it:</span>
              <input readOnly value={manualLink} onFocus={(e) => e.currentTarget.select()} aria-label="Invitation link" />
            </div>
          )}
        </form>

        {error && <p className="error">{error}</p>}

        <ul className="team-list" aria-label="People in the workspace">
          {members === null && !error && <li className="muted">Loading…</li>}
          {members?.map((m) => (
            <li key={m.user_id} className={m.removed_at ? 'removed' : undefined}>
              <span className="team-who">
                <span className="team-email" data-tip={m.email} data-tip-plain data-tip-overflow>
                  {m.email}
                  {m.user_id === user.id && <span className="muted"> (you)</span>}
                </span>
                <span className="mono-label">{m.removed_at ? `Removed ${new Date(m.removed_at).toLocaleDateString()}` : 'Active'}</span>
              </span>
              {canChangeRole(m) ? (
                <select
                  aria-label={`Role of ${m.email}`}
                  value={m.role}
                  disabled={busy !== null}
                  onChange={(e) => {
                    const next = e.target.value as InviteRole;
                    void run(`role:${m.user_id}`, () => remote.setMemberRole(m.user_id, next));
                  }}
                >
                  {(isOwner ? (['admin', 'member', 'guest'] as InviteRole[]) : (['member', 'guest'] as InviteRole[])).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="team-role">{ROLE_LABELS[m.role] ?? m.role}</span>
              )}
              {canChangeRole(m) ? (
                <button className="link danger" disabled={busy !== null} onClick={() => remove(m)}>
                  Remove
                </button>
              ) : (
                <span className="team-spacer" />
              )}
            </li>
          ))}
        </ul>

        {invitations && invitations.length > 0 && (
          <>
            <span className="pref-label">Invitations not used yet</span>
            <ul className="team-list" aria-label="Invitations not used yet">
              {invitations.map((inv) => {
                const canRevoke = isOwner || inv.invited_by === user.id;
                return (
                  <li key={inv.id}>
                    <span className="team-who">
                      <span className="team-email" data-tip={inv.email} data-tip-plain data-tip-overflow>
                        {inv.email}
                      </span>
                      <span className="mono-label">
                        {inv.invited_by_email ? `Invited by ${inv.invited_by_email}` : 'Invited'}
                        {inv.expires_at ? ` · until ${new Date(inv.expires_at).toLocaleDateString()}` : ''}
                      </span>
                    </span>
                    <span className="team-role">{ROLE_LABELS[inv.role] ?? inv.role}</span>
                    {canRevoke ? (
                      <button
                        className="link danger"
                        disabled={busy !== null}
                        onClick={() => {
                          if (confirm(`Revoke the invitation for ${inv.email}? They can no longer join with it; nothing else changes.`)) {
                            void run(`revoke:${inv.id}`, () => remote.revokeInvitation(inv.id));
                          }
                        }}
                      >
                        Revoke
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
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
