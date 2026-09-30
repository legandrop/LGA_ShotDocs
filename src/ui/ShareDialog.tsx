import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { usePermissions, useServices, useTree } from '../services';
import { GRANT_LEVELS, LEVEL_LABELS, ROLE_LABELS, levelValue, type GrantLevel, type Role } from '../sync/access';
import type { AccessRow, MemberRow } from '../sync/remote';
import { copyInvite, useInviteLink } from './MembersDialog';
import { teamErrorText } from './teamText';

// "Share…" en el menú de la página y en el del proyecto: quién tiene acceso y con qué nivel, cambiarlo,
// quitarlo y sumar a alguien (un miembro, o un correo nuevo con una invitación y su link). Solo lo ve quien
// puede compartir (`private.can_share`).

export type ShareTarget = { projectId: string } | { pageId: string };

interface Person {
  userId: string;
  email: string;
  role: Role;
  /** El más alto de todos sus orígenes. */
  level: GrantLevel;
  /** El permiso puesto justo acá (sobre esta página o este proyecto), si hay: se cambia y se quita. */
  direct: AccessRow | null;
  /** De dónde viene si no es directo: creador, el proyecto o una página de arriba. */
  via: string | null;
}

export function ShareDialog({ target, onClose }: { target: ShareTarget; onClose: () => void }) {
  const { remote } = useServices();
  const tree = useTree();
  const perms = usePermissions();
  const makeLink = useInviteLink();
  const isProject = 'projectId' in target;
  const targetId = isProject ? target.projectId : target.pageId;
  const title = isProject
    ? (tree.project(target.projectId)?.name ?? 'this project')
    : tree.get(target.pageId)?.title || 'Untitled';

  const [rows, setRows] = useState<AccessRow[] | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [email, setEmail] = useState('');
  const [level, setLevel] = useState<GrantLevel>('edit');
  const [role, setRole] = useState<'member' | 'guest'>('guest');
  const [manualLink, setManualLink] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    setError(null);
    remote.listAccess(target).then(
      (list) => live && setRows(list),
      (err: unknown) => live && setError(teamErrorText(err)),
    );
    // La lista de miembros completa la ven el dueño y los admins; los demás, solo su fila.
    remote.listMembers().then(
      (list) => live && setMembers(list.filter((m) => !m.removed_at)),
      () => undefined,
    );
    return () => {
      live = false;
    };
    // `target` cambia de identidad en cada render: alcanza con el id.
  }, [remote, targetId, reload]);

  const people = useMemo<Person[]>(() => {
    const byUser = new Map<string, AccessRow[]>();
    for (const r of rows ?? []) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
    return [...byUser.values()].map((list) => {
      const best = list.reduce((a, b) => (levelValue(b.level) > levelValue(a.level) ? b : a));
      const direct = list.find((r) => r.grant_id && (isProject ? r.source === 'project' : r.source === 'page')) ?? null;
      const from = direct && levelValue(direct.level) >= levelValue(best.level) ? null : best;
      const via =
        from === null
          ? null
          : from.source === 'creator'
            ? 'created the project'
            : from.source === 'project'
              ? 'from the project'
              : `from “${(from.page_id && tree.get(from.page_id)?.title) || 'a page above'}”`;
      return { userId: best.user_id, email: best.email, role: best.role, level: best.level, direct, via };
    });
  }, [rows, isProject, tree]);

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

  const knownByEmail = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.email.toLowerCase(), m.user_id);
    for (const r of rows ?? []) map.set(r.email.toLowerCase(), r.user_id);
    return map;
  }, [members, rows]);

  const address = email.trim().toLowerCase();
  const knownUser = knownByEmail.get(address);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!address) return;
    if (knownUser) {
      await run('add', async () => {
        await remote.share(knownUser, target, level);
        setEmail('');
      });
      return;
    }
    if (!perms.canInvite) {
      setError('Only the owner or an admin can invite someone new. Ask them to invite this person first.');
      return;
    }
    const grant = isProject ? { project_id: target.projectId, level } : { page_id: target.pageId, level };
    await run('add', async () => {
      await remote.createInvitation(address, role, [grant]);
      setEmail('');
      setManualLink(await copyInvite(makeLink(targetId)));
    });
  }

  const suggestions = members.filter((m) => !people.some((p) => p.userId === m.user_id && p.direct));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal team-dialog" role="dialog" aria-label="Share" onClick={(e) => e.stopPropagation()}>
        <h2>Share “{title}”</h2>
        <p className="muted team-lead">
          {isProject
            ? 'Access to a project covers every page in it.'
            : 'Access to a page covers the pages inside it, never the ones above.'}
        </p>

        <form className="team-invite" onSubmit={(e) => void add(e)}>
          <div className="team-invite-row">
            <input
              type="email"
              required
              list="share-members"
              placeholder="name@example.com or pick a member"
              aria-label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <select aria-label="Access" value={level} onChange={(e) => setLevel(e.target.value as GrantLevel)}>
              {GRANT_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {LEVEL_LABELS[l]}
                </option>
              ))}
            </select>
          </div>
          <datalist id="share-members">
            {suggestions.map((m) => (
              <option key={m.user_id} value={m.email} />
            ))}
          </datalist>
          {address && !knownUser && perms.canInvite && (
            <label className="team-check">
              <span>New to the workspace: invite as</span>
              <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as 'member' | 'guest')}>
                <option value="guest">{ROLE_LABELS.guest}</option>
                <option value="member">{ROLE_LABELS.member}</option>
              </select>
            </label>
          )}
          <div className="team-invite-actions">
            <span className="muted">
              {address && !knownUser ? 'The app copies an invitation link for you to send.' : ''}
            </span>
            <button className="primary" disabled={busy !== null || !address}>
              {busy === 'add' ? 'Sharing…' : address && !knownUser ? 'Invite and copy link' : 'Share'}
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

        <span className="pref-label">Who has access</span>
        <ul className="team-list" aria-label="Who has access">
          {rows === null && !error && <li className="muted">Loading…</li>}
          {rows !== null && people.length === 0 && <li className="muted">Nobody yet.</li>}
          {people.map((p) => (
            <li key={p.userId}>
              <span className="team-who">
                <span className="team-email" data-tip={p.email} data-tip-plain data-tip-overflow>
                  {p.email}
                </span>
                <span className="mono-label">
                  {ROLE_LABELS[p.role] ?? p.role}
                  {p.via ? ` · ${LEVEL_LABELS[p.level]} ${p.via}` : ''}
                </span>
              </span>
              {p.direct ? (
                <select
                  aria-label={`Access of ${p.email}`}
                  value={p.direct.level}
                  disabled={busy !== null}
                  onChange={(e) => {
                    const next = e.target.value as GrantLevel;
                    void run(`level:${p.userId}`, async () => void (await remote.share(p.userId, target, next)));
                  }}
                >
                  {GRANT_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {LEVEL_LABELS[l]}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="team-role">{LEVEL_LABELS[p.level]}</span>
              )}
              {p.direct?.grant_id ? (
                <button
                  className="link danger"
                  disabled={busy !== null}
                  onClick={() => void run(`unshare:${p.userId}`, () => remote.unshare(p.direct!.grant_id!))}
                >
                  Remove
                </button>
              ) : (
                <span className="team-spacer" />
              )}
            </li>
          ))}
        </ul>

        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
