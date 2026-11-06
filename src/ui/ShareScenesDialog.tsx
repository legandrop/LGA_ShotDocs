import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/teamDialogs';
import { sceneLabel } from '../relations/reader';
import { usePermissions, useServices, useSyncStatus, useTree } from '../services';
import { LEVEL_LABELS, ROLE_LABELS, type GrantLevel } from '../sync/access';
import type { InvitationRow, MemberRow, PageShareRow, PageSharesResult } from '../sync/remote';
import { inviteAndCopy, useInviteLink } from './MembersDialog';
import { outsideReadersStore } from './outsideReaders';
import { markScenes as markAndWait, MARKS_PENDING, projectSceneItems, type SceneItem } from './projectScenes';
import { ShareGateNotes, UNSYNCED_BEFORE_SHARE, useShareGate, type ShareScope } from './shareGate';
import { teamErrorText } from './teamText';

// *Share scenes of “<proyecto>”* (Docs/Doc_Compartir_Escenas.md, B-1, D843): las escenas del proyecto que ve una persona
// de afuera (un vendor). Una persona por guardado; las escenas salen del registro de este dispositivo (quien comparte ve
// el proyecto entero: dueño o admin) y cada una se comparte con Ver o Comentar sobre su página, que vale para ella y las
// de adentro (sus fichas). Antes de guardar se escribe la marca de escena a las que no la tienen (el vendor no ve la
// carpeta: sin la marca no la reconoce) y se espera que suba, y se pasa por la compuerta de lo borrado sin *Share anyway*.
// La base vuelve a controlar todo (`set_page_shares`): esto solo arma el pedido y lo explica. Una escena con otra
// entidad adentro (otra escena, una locación, un día, un decorado, algo con forma de escena: un episodio que el registro
// tomó por escena) no se puede compartir: la fila queda apagada con el motivo, sin opción para seguir.

const EMAIL = /^[^@\s]+@[^@\s]+$/;
const MAX_PAGES = 200;

const isOutsideRow = (r: PageShareRow) => r.role === 'guest' || r.level === 'view' || r.level === 'comment';

export function ShareScenesDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const services = useServices();
  const { remote, engine } = services;
  const tree = useTree();
  const perms = usePermissions();
  const status = useSyncStatus();
  const makeLink = useInviteLink();
  const tr = useT();
  const gate = useShareGate();
  const projectName = tree.project(projectId)?.name ?? tr('project.thisProject');

  const [rows, setRows] = useState<PageShareRow[] | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [reload, setReload] = useState(0);
  const [email, setEmail] = useState('');
  const [level, setLevel] = useState<'view' | 'comment'>('view');
  const [filter, setFilter] = useState('');
  // Lo que se tocó, sobre lo que la persona ya tiene: `true` agregar, `false` sacar.
  const [picked, setPicked] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [done, setDone] = useState<(PageSharesResult & { email: string }) | null>(null);
  const [manualLink, setManualLink] = useState<string | null>(null);
  // Lo agregado en el último guardado: *Same scenes for another email…* lleva solo eso.
  const [lastAdded, setLastAdded] = useState<string[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    setLoadError(null);
    remote.projectPageShares(projectId).then(
      (list) => live && setRows(list),
      (err: unknown) => live && setLoadError(teamErrorText(err)),
    );
    remote.listMembers().then(
      (list) => live && setMembers(list.filter((m) => !m.removed_at)),
      () => undefined,
    );
    remote.listInvitations().then(
      (list) => live && setInvitations(list ?? []),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [remote, projectId, reload]);

  // Las escenas del proyecto, en orden de número, con lo de adentro (se arma con el árbol de este dispositivo).
  const scenes = useMemo<SceneItem[]>(
    () => projectSceneItems(tree, engine, projectId),
    // El árbol cambia de revisión, no de identidad: `useTree` vuelve a dibujar y esto se rearma con cada cambio.
    [tree, tree.getRevision(), projectId, engine], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const sceneIds = useMemo(() => new Set(scenes.map((s) => s.pageId)), [scenes]);

  // La persona: un miembro activo, o alguien a invitar (con o sin una invitación pendiente).
  const address = email.trim().toLowerCase();
  const valid = EMAIL.test(address) && address.length <= 320;
  const member = valid ? members.find((m) => m.email.toLowerCase() === address) : undefined;
  const memberId = member?.user_id ?? rows?.find((r) => r.user_id && r.email.toLowerCase() === address)?.user_id ?? null;
  const pending = valid && !memberId ? invitations.find((i) => i.email === address) : undefined;
  const mine = useMemo(
    () => (rows ?? []).filter((r) => (memberId ? r.user_id === memberId : valid && !!r.invitation_id && r.email.toLowerCase() === address)),
    [rows, memberId, valid, address],
  );
  const has = useMemo(() => new Map(mine.filter((r) => r.page_id).map((r) => [r.page_id!, r.level] as const)), [mine]);
  // Lo que tiene sobre páginas en la papelera (ella o una de arriba): no está en la lista de escenas; se muestra aparte
  // para poder sacarlo (`in_trash`).
  const trashed = useMemo(
    () => (memberId ? mine.filter((r) => r.page_id && r.in_trash && r.grant_id && (r.level === 'view' || r.level === 'comment')) : []),
    [mine, memberId],
  );
  const blockedIds = useMemo(() => new Set(scenes.filter((s) => s.blocked).map((s) => s.pageId)), [scenes]);
  const wholeProject = mine.find((r) => !r.page_id) ?? null;
  const personKey = valid ? `${memberId ?? 'new'}:${address}` : '';

  // Otra persona: lo sacado no pasa (sería sacarle algo a quien no se eligió); lo agregado, sí («las mismas escenas»).
  useEffect(() => {
    setPicked((prev) => (prev.size === 0 || [...prev.values()].every(Boolean) ? prev : new Map([...prev].filter(([, v]) => v))));
  }, [personKey]);

  const isChecked = (id: string) => picked.get(id) ?? has.has(id);
  /** Se puede tocar: un Editar no se cambia acá, y a una invitación pendiente solo se le suma. */
  const editable = (id: string) => {
    const lvl = has.get(id);
    if (!lvl) return !blockedIds.has(id);
    if (lvl !== 'view' && lvl !== 'comment') return false;
    return !!memberId;
  };
  const adds = scenes.filter((s) => isChecked(s.pageId) && !has.has(s.pageId) && !s.blocked).map((s) => s.pageId);
  const removes = memberId
    ? [
        ...scenes.filter((s) => !isChecked(s.pageId) && editable(s.pageId) && has.has(s.pageId)).map((s) => s.pageId),
        ...trashed.filter((r) => !isChecked(r.page_id!)).map((r) => r.page_id!),
      ]
    : [];
  const total = adds.length + removes.length;

  // Lo que la persona ya tiene acá además de las escenas (otras páginas compartidas): se nombra, sin tocarlo.
  const extras = mine.filter((r) => r.page_id && !r.in_trash && !sceneIds.has(r.page_id));
  // Quién más de afuera ve cada escena (por ella, por una de arriba o por el proyecto entero).
  const othersOf = (id: string): string[] => {
    const chain = new Set([id, ...tree.ancestors(id).map((p) => p.id)]);
    const list = (rows ?? []).filter(
      (r) => isOutsideRow(r) && r.email.toLowerCase() !== address && (r.page_id === null || chain.has(r.page_id)),
    );
    return [...new Set(list.map((r) => r.email))];
  };

  // Las sugerencias: primero quien ya tiene páginas compartidas acá (con cuántas), después miembros e invitados.
  const suggestions = useMemo(() => {
    const out = new Map<string, string>();
    const pagesBy = new Map<string, number>();
    for (const r of rows ?? []) if (r.page_id) pagesBy.set(r.email.toLowerCase(), (pagesBy.get(r.email.toLowerCase()) ?? 0) + 1);
    for (const [who, n] of pagesBy) out.set(who, tr('scenes.share.suggestPages', { count: n }));
    for (const m of members) if (!out.has(m.email.toLowerCase())) out.set(m.email.toLowerCase(), tr(ROLE_LABELS[m.role]));
    for (const i of invitations) if (!out.has(i.email)) out.set(i.email, tr('scenes.share.suggestInvited'));
    return [...out];
  }, [rows, members, invitations, tr]);

  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? scenes.filter((s) => s.code.toLowerCase().includes(needle) || sceneLabel(s.code).toLowerCase().includes(needle) || s.title.toLowerCase().includes(needle))
    : scenes;
  const setMany = (value: boolean) =>
    setPicked((prev) => {
      const next = new Map(prev);
      for (const s of shown) if (editable(s.pageId)) next.set(s.pageId, value);
      return next;
    });
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Map(prev);
      const value = !isChecked(id);
      // Volver a lo que ya tenía deja de ser un cambio.
      if (value === has.has(id)) next.delete(id);
      else next.set(id, value);
      return next;
    });

  // Otro correo, otras escenas u otro nivel: el aviso de lo pendiente (y su *Retry*) era del pedido de antes.
  useEffect(() => {
    gate.clearBlocked();
    // Solo cuando cambia lo que se manda.
  }, [address, picked, level]); // eslint-disable-line react-hooks/exhaustive-deps

  const cleanOn = status.cleanOn;
  const canSave = !busy && cleanOn && valid && rows !== null && perms.canInvite && total > 0 && total <= MAX_PAGES;

  /** La marca de escena en las elegidas que no la tienen, y esperar a que suba (si no, la base las rechaza). */
  const markScenes = (ids: string[]) => markAndWait(tree, engine, ids);

  /** Guarda (en el gesto: el link de una invitación se copia sin esperar nada antes). */
  function save(e?: FormEvent) {
    e?.preventDefault();
    if (!canSave) return;
    const who = address;
    const add = adds;
    const remove = removes;
    const lvl = level;
    const inviting = !memberId;
    const scope: ShareScope = { pageIds: add };
    setError(null);
    setDone(null);
    setManualLink(null);
    gate.clearBlocked();
    let result: PageSharesResult | null = null;
    const work = (async () => {
      await markScenes(add);
      // Sin *Share anyway*: con un vendor no se comparte sin haber subido lo pendiente (M4).
      // *Retry* manda el formulario de ese momento (no el de este pedido): si se cambió algo, el aviso ya no está.
      if (add.length > 0 && !(await gate.ready(scope, true, () => latestSave.current(), null))) throw UNSYNCED_BEFORE_SHARE;
      result = await remote.setPageShares(projectId, who, add, remove, lvl);
      return result;
    })();
    setBusy(true);
    void (async () => {
      try {
        let manual: string | null = null;
        if (inviting) manual = await inviteAndCopy(work.then(() => makeLink(projectId)));
        else await work;
        setManualLink(manual);
        if (result) setDone({ ...(result as PageSharesResult), email: who });
        setLastAdded(add);
        setPicked(new Map());
        if (add.length > 0) gate.after(scope, true, who);
        setReload((n) => n + 1);
        void outsideReadersStore(services)?.invalidate(projectId);
      } catch (err) {
        // Quedó el aviso de lo pendiente (con Retry): no es un error.
        if (err === UNSYNCED_BEFORE_SHARE) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(
          err === MARKS_PENDING
            ? tr('scenes.share.marksPending')
            : message === 'page_invalid'
              ? tr('scenes.share.pageInvalid')
              : message === 'scene_contains_entities'
                ? tr('scenes.share.containsEntities')
                : message === 'invitation_exists' && !inviting
                  ? tr('scenes.share.memberInvitation')
                  : teamErrorText(err),
        );
      } finally {
        setBusy(false);
      }
    })();
  }

  const latestSave = useRef(save);
  latestSave.current = save;

  /** «Las mismas escenas para otro correo»: lo agregado en el último guardado (como para agregar) y se pide otro correo. */
  function another() {
    setPicked(new Map(lastAdded.filter((id) => sceneIds.has(id)).map((id) => [id, true])));
    setDone(null);
    setManualLink(null);
    setEmail('');
  }

  const levelLabel = (l: GrantLevel) => tr(LEVEL_LABELS[l]);
  const checkedCount = scenes.filter((s) => isChecked(s.pageId)).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal team-dialog share-scenes" role="dialog" aria-label={tr('scenes.share.label')} onClick={(e) => e.stopPropagation()}>
        <h2>{tr('scenes.share.title', { name: projectName })}</h2>
        <p className="muted team-lead">{tr('scenes.share.lead')}</p>
        {!cleanOn && (
          <p className="warn small team-lead" role="alert">
            {tr('scenes.share.cleanOff')}
          </p>
        )}

        <form className="team-invite" onSubmit={save}>
          <div className="team-invite-row">
            <input
              type="email"
              required
              list="share-scenes-people"
              maxLength={320}
              placeholder={tr('scenes.share.emailPlaceholder')}
              aria-label={tr('team.email')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <select aria-label={tr('team.access')} value={level} onChange={(e) => setLevel(e.target.value as 'view' | 'comment')}>
              <option value="view">{levelLabel('view')}</option>
              <option value="comment">{levelLabel('comment')}</option>
            </select>
          </div>
          <datalist id="share-scenes-people">
            {suggestions.map(([who, label]) => (
              <option key={who} value={who} label={label} />
            ))}
          </datalist>
          {valid && (
            <p className="muted small team-lead share-scenes-person">
              {memberId
                ? tr('scenes.share.member', { role: tr(ROLE_LABELS[member?.role ?? mine[0]?.role ?? 'member']) })
                : pending
                  ? tr('scenes.share.pending')
                  : tr('scenes.share.newPerson')}
            </p>
          )}
          {wholeProject && (
            <p className="warn small team-lead">
              {tr('scenes.share.wholeProject', { level: levelLabel(wholeProject.level), name: projectName })}
            </p>
          )}
          {extras.length > 0 && (
            <p className="muted small team-lead">
              {tr('scenes.share.alsoHas', {
                list: extras.map((r) => `“${tree.get(r.page_id!)?.title || tr('common.untitled')}” (${levelLabel(r.level)})`).join(', '),
              })}
            </p>
          )}

          <div className="share-scenes-tools">
            <input type="search" placeholder={tr('scenes.share.filter')} aria-label={tr('scenes.share.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button type="button" className="link" onClick={() => setMany(true)} disabled={shown.length === 0}>
              {tr('scenes.share.all')}
            </button>
            <button type="button" className="link" onClick={() => setMany(false)} disabled={shown.length === 0}>
              {tr('scenes.share.none')}
            </button>
            <span className="muted small">{tr('scenes.share.count', { checked: checkedCount, total: scenes.length })}</span>
          </div>
          <ul className="share-scenes-list" aria-label={tr('scenes.share.list')}>
            {scenes.length === 0 && <li className="muted">{tr('scenes.share.noScenes')}</li>}
            {scenes.length > 0 && shown.length === 0 && <li className="muted">{tr('scenes.share.noMatch')}</li>}
            {shown.map((s) => {
              const checked = isChecked(s.pageId);
              const changed = checked !== has.has(s.pageId);
              const lvl = has.get(s.pageId);
              const others = othersOf(s.pageId);
              return (
                <li key={s.pageId} className={changed ? 'changed' : undefined} data-scene={s.pageId}>
                  <label>
                    <input type="checkbox" checked={checked} disabled={!editable(s.pageId)} onChange={() => toggle(s.pageId)} />
                    <span className="mono share-scenes-code">{sceneLabel(s.code)}</span>
                    <span className="share-scenes-title">{s.title}</span>
                    {s.inside > 0 && <span className="muted small">{tr('scenes.share.inside', { count: s.inside })}</span>}
                    {lvl && lvl !== 'view' && lvl !== 'comment' && (
                      <span className="muted small">{tr('scenes.share.higher', { level: levelLabel(lvl) })}</span>
                    )}
                  </label>
                  {s.blocked && <span className="warn small share-scenes-note">{tr('scenes.share.blocked')}</span>}
                  {others.length > 0 && (
                    <span className="warn small share-scenes-note">{tr('scenes.share.others', { list: others.join(', ') })}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {trashed.length > 0 && (
            <>
              <p className="muted small team-lead">{tr('scenes.share.trashLead')}</p>
              <ul className="share-scenes-list share-scenes-trash" aria-label={tr('scenes.share.trashList')}>
                {trashed.map((r) => {
                  const id = r.page_id!;
                  const checked = isChecked(id);
                  return (
                    <li key={id} className={checked ? undefined : 'changed'} data-scene={id}>
                      <label>
                        <input type="checkbox" checked={checked} onChange={() => toggle(id)} />
                        <span className="share-scenes-title">{tree.get(id)?.title || tr('common.untitled')}</span>
                        <span className="muted small">{tr('scenes.share.inTrash', { level: levelLabel(r.level) })}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <div className="team-invite-actions">
            <span className="muted">
              {total > MAX_PAGES ? tr('scenes.share.tooMany') : total > 0 ? tr('scenes.share.changes', { add: adds.length, remove: removes.length }) : ''}
            </span>
            <button className="primary" disabled={!canSave}>
              {busy ? tr('scenes.share.saving') : valid && !memberId && adds.length > 0 ? tr('team.inviteAndCopy') : tr('scenes.share.save')}
            </button>
          </div>
          {manualLink && (
            <div className="team-link">
              <span className="muted">{tr('team.copyManually')}</span>
              <input readOnly value={manualLink} onFocus={(e) => e.currentTarget.select()} aria-label={tr('team.inviteLink')} />
            </div>
          )}
          <ShareGateNotes gate={gate} reader />
        </form>

        {(error || loadError) && <p className="error">{error ?? loadError}</p>}
        {done && (
          <p className="muted team-lead" role="status">
            {tr(done.result === 'invited' ? 'scenes.share.doneInvited' : 'scenes.share.doneMember', { email: done.email, count: done.pages })}{' '}
            <button type="button" className="link" onClick={another}>
              {tr('scenes.share.another')}
            </button>
          </p>
        )}
        <p className="muted small team-lead">{tr('scenes.share.limits')}</p>

        <div className="modal-actions">
          <button onClick={onClose}>{tr('common.close')}</button>
        </div>
      </div>
    </div>
  );
}
