import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useT } from '../i18n';
import { usePermissions, useServices, useTree } from '../services';
import { GRANT_LEVELS, LEVEL_LABELS, ROLE_LABELS, levelValue, type GrantLevel, type Role } from '../sync/access';
import type { AccessRow, MemberRow } from '../sync/remote';
import { inviteAndCopy, useInviteLink } from './MembersDialog';
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
  const tr = useT();
  const title = isProject
    ? (tree.project(target.projectId)?.name ?? tr('project.thisProject'))
    : tree.get(target.pageId)?.title || tr('common.untitled');

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
            ? tr('share.via.creator')
            : from.source === 'project'
              ? tr('share.via.project')
              : tr('share.via.page', { title: (from.page_id && tree.get(from.page_id)?.title) || tr('share.via.pageAbove') });
      return { userId: best.user_id, email: best.email, role: best.role, level: best.level, direct, via };
    });
  }, [rows, isProject, tree, tr]);

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
      setError(tr('share.cannotInvite', { email: email.trim() }));
      return;
    }
    const grant = isProject ? { project_id: target.projectId, level } : { page_id: target.pageId, level };
    // Sin nada que espere antes: el portapapeles se pide en el mismo gesto.
    const copying = inviteAndCopy(remote.createInvitation(address, role, [grant]).then(() => makeLink(targetId)));
    await run('add', async () => {
      const manual = await copying;
      setEmail('');
      setManualLink(manual);
    });
  }

  const suggestions = members.filter((m) => !people.some((p) => p.userId === m.user_id && p.direct));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal team-dialog" role="dialog" aria-label={tr('share.label')} onClick={(e) => e.stopPropagation()}>
        <h2>{tr('share.title', { title })}</h2>
        <p className="muted team-lead">{isProject ? tr('share.projectScope') : tr('share.pageScope')}</p>
        {!perms.canInvite && <p className="muted team-lead">{tr('share.creatorOnly')}</p>}

        <form className="team-invite" onSubmit={(e) => void add(e)}>
          <div className="team-invite-row">
            <input
              type="email"
              required
              list="share-members"
              placeholder={perms.canInvite ? tr('share.emailOrMember') : tr('share.emailListed')}
              aria-label={tr('team.email')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <select aria-label={tr('team.access')} value={level} onChange={(e) => setLevel(e.target.value as GrantLevel)}>
              {GRANT_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {tr(LEVEL_LABELS[l])}
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
              <span>{tr('share.inviteAs')}</span>
              <select aria-label={tr('team.role')} value={role} onChange={(e) => setRole(e.target.value as 'member' | 'guest')}>
                <option value="guest">{tr(ROLE_LABELS.guest)}</option>
                <option value="member">{tr(ROLE_LABELS.member)}</option>
              </select>
            </label>
          )}
          <div className="team-invite-actions">
            <span className="muted">
              {address && !knownUser ? tr('members.inviteHint') : ''}
            </span>
            <button className="primary" disabled={busy !== null || !address}>
              {busy === 'add' ? tr('share.sharing') : address && !knownUser ? tr('team.inviteAndCopy') : tr('share.share')}
            </button>
          </div>
          {manualLink && (
            <div className="team-link">
              <span className="muted">{tr('team.copyManually')}</span>
              <input readOnly value={manualLink} onFocus={(e) => e.currentTarget.select()} aria-label={tr('team.inviteLink')} />
            </div>
          )}
        </form>

        {error && <p className="error">{error}</p>}

        <span className="pref-label">{tr('share.who')}</span>
        <ul className="team-list" aria-label={tr('share.who')}>
          {rows === null && !error && <li className="muted">{tr('common.loading')}</li>}
          {rows !== null && people.length === 0 && <li className="muted">{tr('share.nobody')}</li>}
          {people.map((p) => (
            <li key={p.userId}>
              <span className="team-who">
                <span className="team-email" data-tip={p.email} data-tip-plain data-tip-overflow>
                  {p.email}
                </span>
                <span className="mono-label">
                  {ROLE_LABELS[p.role] ? tr(ROLE_LABELS[p.role]) : p.role}
                  {p.via ? ` · ${tr(LEVEL_LABELS[p.level])} ${p.via}` : ''}
                </span>
              </span>
              {p.direct ? (
                <select
                  aria-label={tr('share.accessOf', { email: p.email })}
                  value={p.direct.level}
                  disabled={busy !== null}
                  onChange={(e) => {
                    const next = e.target.value as GrantLevel;
                    void run(`level:${p.userId}`, async () => void (await remote.share(p.userId, target, next)));
                  }}
                >
                  {GRANT_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {tr(LEVEL_LABELS[l])}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="team-role">{tr(LEVEL_LABELS[p.level])}</span>
              )}
              {p.direct?.grant_id ? (
                <button
                  className="link danger"
                  disabled={busy !== null}
                  onClick={() => void run(`unshare:${p.userId}`, () => remote.unshare(p.direct!.grant_id!))}
                >
                  {tr('members.remove')}
                </button>
              ) : (
                <span className="team-spacer" />
              )}
            </li>
          ))}
        </ul>

        <div className="modal-actions">
          <button onClick={onClose}>{tr('common.close')}</button>
        </div>
      </div>
    </div>
  );
}
