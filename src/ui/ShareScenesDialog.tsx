import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type MouseEvent } from 'react';
import { useT, type Key } from '../i18n';
import '../i18n/lazy/teamDialogs';
import { usePermissions, useServices, useSyncStatus, useTree } from '../services';
import { LEVEL_LABELS, ROLE_LABELS, type GrantLevel } from '../sync/access';
import type { InvitationRow, MemberRow, PageShareRow, PageSharesResult } from '../sync/remote';
import { ChevronDownIcon, ChevronUpIcon, CommentIcon, EyeIcon, InfoIcon, LockIcon, MailIcon, MembersIcon, SearchIcon } from './icons';
import { inviteAndCopy, useInviteLink } from './MembersDialog';
import { outsideReadersStore } from './outsideReaders';
import { markScenes as markAndWait, MARKS_PENDING, projectSceneItems, type SceneItem } from './projectScenes';
import { existingRelationsSession } from './relationsUi';
import { ShareGateNotes, UNSYNCED_BEFORE_SHARE, useShareGate, type ShareScope } from './shareGate';
import { filterRows, optionsOf, sceneRows, sortRows, type RowFacts, type RowStatus, type Sort, type SortKey, type View } from './shareScenesTable';
import { teamErrorText } from './teamText';

// *Share scenes of “<proyecto>”* (Docs/Doc_Compartir_Escenas.md, B-1, D843): las escenas del proyecto que ve una persona
// de afuera (un vendor). Una persona por guardado; las escenas salen del registro de este dispositivo (quien comparte ve
// el proyecto entero: dueño o admin) y cada una se comparte con Ver o Comentar sobre su página, que vale para ella y las
// de adentro (sus fichas). Antes de guardar se escribe la marca de escena a las que no la tienen (el vendor no ve la
// carpeta: sin la marca no la reconoce) y se espera que suba, y se pasa por la compuerta de lo borrado sin *Share anyway*.
// La base vuelve a controlar todo (`set_page_shares`): esto solo arma el pedido y lo explica. Una escena con otra
// entidad adentro (otra escena, una locación, un día, un decorado, algo con forma de escena: un episodio que el registro
// tomó por escena) no se puede compartir: la fila queda apagada con el motivo, sin opción para seguir.
// Desde la v0.330 la lista es una tabla (`shareScenesTable.ts`): número, nombre, locación, decorado, INT/EXT, páginas de
// adentro, cuántos de afuera ya la ven y el estado para la persona elegida; se ordena con un clic en el título de cada
// columna, se filtra con el buscador, los desplegables y las vistas, y Shift+clic marca un rango. Quién más la ve de
// afuera se dice una vez arriba de la tabla (antes se repetía en cada fila).

const EMAIL = /^[^@\s]+@[^@\s]+$/;
const MAX_PAGES = 200;

const isOutsideRow = (r: PageShareRow) => r.role === 'guest' || r.level === 'view' || r.level === 'comment';
const noSubscribe = () => () => undefined;

/** Las columnas de la tabla; las de `details` solo con el índice del proyecto (locación, decorado, INT/EXT). */
const COLUMNS: { key: SortKey; label: Key; tip?: Key; details?: true }[] = [
  { key: 'code', label: 'scenes.share.colCode' },
  { key: 'name', label: 'scenes.share.colName' },
  { key: 'location', label: 'scenes.share.colLocation', details: true },
  { key: 'set', label: 'scenes.share.colSet', details: true },
  { key: 'intExt', label: 'scenes.share.colIntExt', details: true },
  { key: 'pages', label: 'scenes.share.colPages', tip: 'scenes.share.colPagesTip' },
  { key: 'outside', label: 'scenes.share.colOutside', tip: 'scenes.share.colOutsideTip' },
  { key: 'status', label: 'scenes.share.colStatus' },
];

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
  // La tabla: el orden, la vista y la locación o el decorado elegidos; y la última fila tocada (Shift+clic marca el rango).
  const [sort, setSort] = useState<Sort>({ key: 'code', dir: 1 });
  const [view, setView] = useState<View>('all');
  const [location, setLocation] = useState('');
  const [set, setSet] = useState('');
  const anchor = useRef<string | null>(null);
  const headCheck = useRef<HTMLInputElement>(null);

  // El índice de relaciones del proyecto abierto (la locación, el decorado y el INT/EXT de cada escena). Con otro
  // proyecto no hay: `snapshot` es solo del abierto.
  const session = existingRelationsSession(services);
  const subscribe = useCallback((fn: () => void) => (session ? session.relations.subscribe(fn) : noSubscribe()), [session]);
  const relRevision = useSyncExternalStore(subscribe, () => session?.relations.getRevision() ?? 0);
  const snap = session?.relations.snapshot(projectId) ?? null;

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
  // Las filas de la tabla: lo de arriba más el nombre sin el número y, con el índice, locación, decorado e INT/EXT.
  const tableRows = useMemo(
    () => sceneRows(scenes, snap && session ? { snap, title: (id) => tree.get(id)?.title, content: (id) => session.index.content(id) } : null),
    [scenes, snap, session, relRevision, tree], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const details = snap !== null;
  const locations = useMemo(() => optionsOf(tableRows, 'locations'), [tableRows]);
  const sets = useMemo(() => optionsOf(tableRows, 'sets'), [tableRows]);

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

  // Quién más de afuera ve cada escena, una vez por dibujo (lo usan la columna, el orden, la vista y el aviso de arriba).
  const others = useMemo(() => new Map(scenes.map((s) => [s.pageId, othersOf(s.pageId)])), [scenes, rows, address, tree.getRevision()]); // eslint-disable-line react-hooks/exhaustive-deps
  const outsideAll = [...new Set([...others.values()].flat())];
  const outsideScenes = scenes.filter((s) => (others.get(s.pageId)?.length ?? 0) > 0).length;

  // Lo que la persona ya tiene manda sobre lo bloqueado: una escena que quedó bloqueada después de compartirla se puede
  // sacar, y la fila tiene que decir que se saca.
  const statusOf = (id: string): RowStatus => {
    const lvl = has.get(id);
    if (lvl && lvl !== 'view' && lvl !== 'comment') return 'higher';
    const checked = isChecked(id);
    if (lvl) return checked ? 'shared' : 'removing';
    if (blockedIds.has(id)) return 'blocked';
    return checked ? 'adding' : 'none';
  };
  const facts: RowFacts = { status: statusOf, outside: (id) => others.get(id)?.length ?? 0 };
  // La locación o el decorado elegidos valen solo si siguen entre las opciones (otro dispositivo los pudo renombrar, o el
  // índice no está): si no, un filtro que no se ve dejaría la tabla vacía.
  const pickedLocation = details && locations.includes(location) ? location : '';
  const pickedSet = details && sets.includes(set) ? set : '';
  const shown = sortRows(filterRows(tableRows, { text: filter, view, location: pickedLocation, set: pickedSet }, isChecked, facts), sort, facts);
  const columns = COLUMNS.filter((c) => details || !c.details);
  const shownEditable = shown.filter((s) => editable(s.pageId));
  const allShown = shownEditable.length > 0 && shownEditable.every((s) => isChecked(s.pageId));
  const someShown = shownEditable.some((s) => isChecked(s.pageId));

  /** Marca o desmarca varias; volver a lo que ya tenía deja de ser un cambio. */
  const setMany = (ids: string[], value: boolean) =>
    setPicked((prev) => {
      const next = new Map(prev);
      for (const id of ids) {
        if (!editable(id)) continue;
        if (value === has.has(id)) next.delete(id);
        else next.set(id, value);
      }
      return next;
    });
  /** Una fila; con Shift, el rango desde la última tocada (en el orden que se ve), al mismo valor. */
  const toggle = (id: string, shift = false) => {
    const value = !isChecked(id);
    const from = shift && anchor.current ? shown.findIndex((s) => s.pageId === anchor.current) : -1;
    const to = shown.findIndex((s) => s.pageId === id);
    anchor.current = id;
    if (from < 0 || to < 0) return setMany([id], value);
    const [a, b] = from < to ? [from, to] : [to, from];
    setMany(shown.slice(a, b + 1).map((s) => s.pageId), value);
  };
  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  // La casilla de los títulos queda a medias si están marcadas algunas de las que se ven.
  useEffect(() => {
    if (headCheck.current) headCheck.current.indeterminate = someShown && !allShown;
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

        <form className="share-scenes-form" onSubmit={save}>
          <div className="share-scenes-who">
            <label className="share-scenes-field">
              <MailIcon size={16} />
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
            </label>
            <div className="segmented share-scenes-level" role="group" aria-label={tr('team.access')}>
              {(['view', 'comment'] as const).map((l) => (
                <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(l)}>
                  {l === 'view' ? <EyeIcon size={16} /> : <CommentIcon size={16} />}
                  {levelLabel(l)}
                </button>
              ))}
            </div>
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
            <label className="share-scenes-search">
              <SearchIcon size={15} />
              <input
                type="search"
                placeholder={tr(details ? 'scenes.share.search' : 'scenes.share.searchShort')}
                aria-label={tr(details ? 'scenes.share.search' : 'scenes.share.searchShort')}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
            {details && locations.length > 0 && (
              <select className="share-scenes-pick" aria-label={tr('scenes.share.colLocation')} value={pickedLocation} onChange={(e) => setLocation(e.target.value)}>
                <option value="">{tr('scenes.share.anyLocation')}</option>
                {locations.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            )}
            {details && sets.length > 0 && (
              <select className="share-scenes-pick" aria-label={tr('scenes.share.colSet')} value={pickedSet} onChange={(e) => setSet(e.target.value)}>
                <option value="">{tr('scenes.share.anySet')}</option>
                {sets.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            )}
            <span className="share-scenes-gap" />
            <button type="button" className="share-scenes-bulk" onClick={() => setMany(shown.map((s) => s.pageId), true)} disabled={shownEditable.length === 0}>
              {tr('scenes.share.selectShown')}
            </button>
            <button type="button" className="share-scenes-bulk" onClick={() => setMany(shown.map((s) => s.pageId), false)} disabled={shownEditable.length === 0}>
              {tr('scenes.share.clearShown')}
            </button>
          </div>
          <div className="share-scenes-views" role="group" aria-label={tr('scenes.share.views')}>
            {(
              [
                ['all', 'scenes.share.viewAll', scenes.length],
                ['selected', 'scenes.share.viewSelected', checkedCount],
                ['unselected', 'scenes.share.viewUnselected', scenes.length - checkedCount],
                ['outside', 'scenes.share.viewOutside', outsideScenes],
                ['blocked', 'scenes.share.viewBlocked', blockedIds.size],
              ] as const
            )
              // Las de afuera y las que no se pueden, solo si hay alguna (o si están elegidas: que no desaparezca el botón).
              .filter(([v, , n]) => n > 0 || v === 'all' || v === 'selected' || v === 'unselected' || view === v)
              .map(([v, label, n]) => (
                <button key={v} type="button" className={`share-scenes-view${v === 'outside' ? ' outside' : ''}`} aria-pressed={view === v} onClick={() => setView(v)}>
                  {tr(label)}
                  <span className="mono">{n}</span>
                </button>
              ))}
          </div>
          {outsideAll.length > 0 && (
            <p className="share-scenes-outside">
              <MembersIcon size={16} />
              <span>{tr('scenes.share.outsideSummary', { count: outsideScenes, list: outsideAll.join(', ') })}</span>
            </p>
          )}

          <div className="share-scenes-table-wrap">
            <table className={`share-scenes-table${details ? ' with-details' : ''}`} aria-label={tr('scenes.share.list')}>
              <colgroup>
                <col className="c-check" />
                {columns.map((c) => (
                  <col key={c.key} className={`c-${c.key}`} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="c-check">
                    <input
                      ref={headCheck}
                      type="checkbox"
                      aria-label={tr('scenes.share.selectShown')}
                      checked={allShown}
                      disabled={shownEditable.length === 0}
                      onChange={() => setMany(shown.map((s) => s.pageId), !allShown)}
                    />
                  </th>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className={`c-${c.key}`}
                      aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
                    >
                      <button type="button" onClick={() => sortBy(c.key)} data-tip={c.tip ? tr(c.tip) : undefined}>
                        {tr(c.label)}
                        {sort.key === c.key && (sort.dir === 1 ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scenes.length === 0 && (
                  <tr className="share-scenes-empty">
                    <td colSpan={columns.length + 1}>{tr('scenes.share.noScenes')}</td>
                  </tr>
                )}
                {scenes.length > 0 && shown.length === 0 && (
                  <tr className="share-scenes-empty">
                    <td colSpan={columns.length + 1}>{tr('scenes.share.noMatch')}</td>
                  </tr>
                )}
                {shown.map((s) => {
                  const st = statusOf(s.pageId);
                  const lvl = has.get(s.pageId);
                  const out = others.get(s.pageId) ?? [];
                  const canTouch = editable(s.pageId);
                  const pick = (e: MouseEvent) => {
                    if (canTouch) toggle(s.pageId, e.shiftKey);
                  };
                  return (
                    <tr
                      key={s.pageId}
                      data-scene={s.pageId}
                      className={[st, isChecked(s.pageId) ? 'checked' : '', st === 'adding' || st === 'removing' ? 'changed' : ''].filter(Boolean).join(' ')}
                      onClick={pick}
                      // Shift+clic no elige el texto de las filas (eso pasa al apretar, no en el clic: frenar el clic de
                      // una casilla la devuelve a como estaba y React queda desfasado).
                      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                    >
                      <td className="c-check">
                        <input
                          type="checkbox"
                          aria-label={`${s.label} ${s.name}`.trim()}
                          checked={isChecked(s.pageId)}
                          disabled={!canTouch}
                          onChange={() => undefined}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (canTouch) toggle(s.pageId, e.shiftKey);
                          }}
                        />
                      </td>
                      <td className="c-code mono share-scenes-code">{s.label}</td>
                      <td className="c-name">
                        <span className="share-scenes-title">{s.name || s.title}</span>
                        {details && (s.locations.length > 0 || s.sets.length > 0) && (
                          <span className="share-scenes-meta">{[...s.locations, ...s.sets].join(' · ')}</span>
                        )}
                        {s.blocked && <span className="share-scenes-why">{tr('scenes.share.blocked')}</span>}
                      </td>
                      {details && (
                        <>
                          <td className="c-location">{s.locations.join(', ')}</td>
                          <td className="c-set">{s.sets.join(', ')}</td>
                          <td className="c-intExt mono">{s.intExt.join(', ')}</td>
                        </>
                      )}
                      <td className="c-pages mono">{s.inside || ''}</td>
                      <td className="c-outside">
                        {out.length > 0 && (
                          <span
                            className="share-scenes-out"
                            role="img"
                            data-tip={tr('scenes.share.othersTip', { list: out.join(', ') })}
                            aria-label={tr('scenes.share.othersTip', { list: out.join(', ') })}
                          >
                            <MembersIcon size={14} />
                            {out.length}
                          </span>
                        )}
                      </td>
                      <td className="c-status">
                        {st === 'blocked' ? (
                          <span className="share-scenes-st blocked">
                            <LockIcon size={13} />
                            {tr('scenes.share.stBlocked')}
                          </span>
                        ) : st === 'higher' ? (
                          <span className="share-scenes-st higher">{tr('scenes.share.higher', { level: levelLabel(lvl!) })}</span>
                        ) : st !== 'none' ? (
                          <span className={`share-scenes-st ${st}`}>
                            {st === 'shared' ? tr('scenes.share.stShared', { level: levelLabel(lvl ?? level) }) : tr(st === 'adding' ? 'scenes.share.stAdding' : 'scenes.share.stRemoving')}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {trashed.length > 0 && (
            <div className="share-scenes-trash-box">
              <p className="muted small">{tr('scenes.share.trashLead')}</p>
              <ul className="share-scenes-trash" aria-label={tr('scenes.share.trashList')}>
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
            </div>
          )}

          {manualLink && (
            <div className="team-link">
              <span className="muted">{tr('team.copyManually')}</span>
              <input readOnly value={manualLink} onFocus={(e) => e.currentTarget.select()} aria-label={tr('team.inviteLink')} />
            </div>
          )}
          <ShareGateNotes gate={gate} reader />
          {(error || loadError) && <p className="error">{error ?? loadError}</p>}
          {done && (
            <p className="muted team-lead" role="status">
              {tr(done.result === 'invited' ? 'scenes.share.doneInvited' : 'scenes.share.doneMember', { email: done.email, count: done.pages })}{' '}
              <button type="button" className="link" onClick={another}>
                {tr('scenes.share.another')}
              </button>
            </p>
          )}
          <p className="share-scenes-limits">
            <InfoIcon size={15} />
            <span>{tr('scenes.share.limits')}</span>
          </p>

          <div className="team-invite-actions share-scenes-footer">
            <span className="share-scenes-sum">
              {total > MAX_PAGES ? (
                <span className="warn">{tr('scenes.share.tooMany')}</span>
              ) : total > 0 ? (
                <span className="share-scenes-diff">
                  <span className="add">+{adds.length}</span> <span className="remove">−{removes.length}</span>
                </span>
              ) : null}
              <span className="muted">
                {valid ? tr('scenes.share.count', { checked: checkedCount, total: scenes.length }) : tr('scenes.share.pickPerson')}
              </span>
            </span>
            <button type="button" onClick={onClose}>
              {tr('common.close')}
            </button>
            <button className="primary" disabled={!canSave}>
              {busy ? tr('scenes.share.saving') : valid && !memberId && adds.length > 0 ? tr('team.inviteAndCopy') : tr('scenes.share.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
