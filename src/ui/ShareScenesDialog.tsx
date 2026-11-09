import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from 'react';
import { useT, type Key } from '../i18n';
import '../i18n/lazy/teamDialogs';
import { usePermissions, useServices, useSyncStatus, useTree } from '../services';
import { LEVEL_LABELS } from '../sync/access';
import type { SceneVendor, SceneVendorsList, VendorLevel, VendorOp } from '../sync/remote';
import { ColorPicker } from './ColorPicker';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  CommentIcon,
  EyeIcon,
  HistoryIcon,
  InfoIcon,
  LockIcon,
  MailIcon,
  MembersIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  UndoIcon,
  WarningIcon,
} from './icons';
import { inviteAndCopy, useInviteLink } from './MembersDialog';
import { outsideReadersStore } from './outsideReaders';
import { loadRecentColors, PROJECT_PRESETS, rememberRecentColor } from './projectColor';
import { isMarkedScene, markScenes as markAndWait, MARKS_PENDING, projectSceneItems, type SceneItem } from './projectScenes';
import { existingRelationsSession } from './relationsUi';
import { ShareGateNotes, UNSYNCED_BEFORE_SHARE, useShareGate } from './shareGate';
import { filterRows, optionsOf, sceneRows, sortRows, type RowFacts, type RowStatus, type Sort, type SortKey, type View } from './shareScenesTable';
import { teamErrorText } from './teamText';

// *Share scenes of “<proyecto>”* (Docs/Doc_Compartir_Escenas.md, sección 11, D852): los vendors del proyecto y sus
// escenas. A la izquierda la lista de vendors (y *All vendors*, el reparto completo); arriba, la ficha del vendor elegido
// (color, nombre, código, Ver o Comentar, correos); abajo, la tabla de la v0.330 con la columna *Vendors*. Marcar una fila
// asigna esa escena al vendor elegido; un vendor sin correos es solo planificación y no comparte nada. Cada correo de un
// vendor ve todas sus escenas y lo de adentro. Un solo *Save* manda todo junto (`save_scene_vendors`, todo o nada).
// Antes: la marca de escena en las que entran y no la tienen (solo quien edita; si no, la fila queda apagada) y la
// compuerta de lo borrado sin *Share anyway* para lo que empieza a verse. Después: las bases de lo reiniciado (quien
// edita), la marca del árbol y, si hay correos nuevos de afuera, el link de invitación copiado (uno sirve para todos).
// La base vuelve a controlar todo: esto arma el pedido y lo explica. La manejan el dueño o un admin que comparte el
// proyecto y quien tiene *Can share scenes* (hasta su propio nivel).

const EMAIL = /^[^@\s]+@[^@\s]+$/;
const noSubscribe = () => () => undefined;

/** Un vendor como se edita en la ventana, antes de guardar. */
interface WorkVendor {
  /** El id del vendor, o `new:<n>` si todavía no existe. */
  key: string;
  id: string | null;
  name: string;
  code: string;
  color: string;
  level: VendorLevel;
  emails: string[];
  scenes: string[];
  deleted: boolean;
}

const fromServer = (v: SceneVendor): WorkVendor => ({
  key: v.id,
  id: v.id,
  name: v.name,
  code: v.code,
  color: v.color,
  level: v.level,
  emails: v.emails.map((e) => e.email),
  scenes: v.scenes.map((s) => s.page_id),
  deleted: false,
});

/** El código que se ve: el propio o, sin código, las primeras letras del nombre. */
export function vendorCode(v: { code: string; name: string }): string {
  if (v.code) return v.code;
  const words = v.name.trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return (words.length > 1 ? words.map((w) => w[0]).join('') : words[0]).slice(0, 3);
}

/** Las columnas; las de `details` solo con el índice del proyecto, y *Status* solo con un vendor elegido. */
const COLUMNS: { key: SortKey; label: Key; details?: true; vendor?: true }[] = [
  { key: 'code', label: 'scenes.share.colCode' },
  { key: 'name', label: 'scenes.share.colName' },
  { key: 'location', label: 'scenes.share.colLocation', details: true },
  { key: 'set', label: 'scenes.share.colSet', details: true },
  { key: 'intExt', label: 'scenes.share.colIntExt', details: true },
  { key: 'vendors', label: 'scenes.share.colVendors' },
  { key: 'status', label: 'scenes.share.colStatus', vendor: true },
];

const MAIL_STATE: Record<'joined' | 'invited' | 'expired' | 'new' | 'again' | 'removed', Key> = {
  joined: 'scenes.share.emailJoined',
  invited: 'scenes.share.emailInvited',
  expired: 'scenes.share.emailExpired',
  new: 'scenes.share.emailNew',
  again: 'scenes.share.emailNew',
  removed: 'scenes.share.emailRemoved',
};

const STATUS_WORD: Record<Exclude<RowStatus, 'none'>, Key> = {
  adding: 'scenes.share.stAdding',
  removing: 'scenes.share.stRemoving',
  shared: 'scenes.share.stShared',
  planned: 'scenes.share.stPlanned',
  blocked: 'scenes.share.stBlocked',
};

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

  const [list, setList] = useState<SceneVendorsList | null>(null);
  const [work, setWork] = useState<WorkVendor[]>([]);
  const [reinvite, setReinvite] = useState<ReadonlySet<string>>(new Set());
  const [reload, setReload] = useState(0);
  const [sel, setSel] = useState<string>('all');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { pending: number }>(null);
  const [manualLink, setManualLink] = useState<string | null>(null);
  const [mailText, setMailText] = useState('');
  const [mailError, setMailError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [picking, setPicking] = useState<null | { before: string }>(null);
  const [sort, setSort] = useState<Sort>({ key: 'code', dir: 1 });
  const [view, setView] = useState<View>('all');
  const [location, setLocation] = useState('');
  const [set, setSet] = useState('');
  const anchor = useRef<string | null>(null);
  const headCheck = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const focusName = useRef(false);
  const counter = useRef(0);
  // Después de guardar, el vendor elegido sigue elegido (uno nuevo cambia `new:<n>` por su id).
  const keepSelected = useRef<string | null>(null);

  // El índice de relaciones del proyecto abierto (locación, decorado, INT/EXT). Con otro proyecto no hay.
  const session = existingRelationsSession(services);
  const subscribe = useCallback((fn: () => void) => (session ? session.relations.subscribe(fn) : noSubscribe()), [session]);
  const relRevision = useSyncExternalStore(subscribe, () => session?.relations.getRevision() ?? 0);
  const snap = session?.relations.snapshot(projectId) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (picking) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, picking]);

  useEffect(() => {
    let live = true;
    setLoadError(null);
    remote.sceneVendorsList(projectId).then(
      (got) => {
        if (!live) return;
        setList(got);
        setWork(got.vendors.map(fromServer));
        setReinvite(new Set());
        const keep = keepSelected.current;
        keepSelected.current = null;
        setSel((cur) => {
          const want = keep ?? cur;
          return want !== 'all' && got.vendors.some((v) => v.id === want) ? want : 'all';
        });
      },
      (err: unknown) => live && setLoadError(teamErrorText(err)),
    );
    return () => {
      live = false;
    };
  }, [remote, projectId, reload]);

  // Las escenas del proyecto, en orden de número, con lo de adentro (se arma con el árbol de este dispositivo).
  const scenes = useMemo<SceneItem[]>(
    () => projectSceneItems(tree, engine, projectId),
    [tree, tree.getRevision(), projectId, engine], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const tableRows = useMemo(
    () => sceneRows(scenes, snap && session ? { snap, title: (id) => tree.get(id)?.title, content: (id) => session.index.content(id) } : null),
    [scenes, snap, session, relRevision, tree], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const details = snap !== null;
  const locations = useMemo(() => optionsOf(tableRows, 'locations'), [tableRows]);
  const sets = useMemo(() => optionsOf(tableRows, 'sets'), [tableRows]);

  const cap = list?.cap ?? 0;
  const orig = useMemo(() => new Map((list?.vendors ?? []).map((v) => [v.id, v])), [list]);
  const live = work.filter((v) => !v.deleted);
  const current = sel === 'all' ? null : (live.find((v) => v.key === sel) ?? null);
  // Un vendor con Comentar y quien guarda llega solo a Ver: no le puede sumar escenas ni correos (la base lo rechaza
  // con `level_not_allowed`); sacar y bajarle el nivel, sí.
  const overCap = !!current && current.level === 'comment' && cap < 2;
  const origScenes = (v: WorkVendor) => (v.id ? (orig.get(v.id)?.scenes.map((s) => s.page_id) ?? []) : []);
  const origEmails = (v: WorkVendor) => (v.id ? (orig.get(v.id)?.emails ?? []) : []);

  /** Cambia un vendor del borrador. */
  const patch = (key: string, change: Partial<WorkVendor> | ((v: WorkVendor) => Partial<WorkVendor>)) =>
    setWork((all) => all.map((v) => (v.key === key ? { ...v, ...(typeof change === 'function' ? change(v) : change) } : v)));

  // Lo que se ve en la tabla: qué vendors tiene cada escena, cuántos con correo la ven, y el estado para el elegido.
  const byScene = useMemo(() => {
    const out = new Map<string, WorkVendor[]>();
    for (const v of live) for (const id of v.scenes) out.set(id, [...(out.get(id) ?? []), v]);
    return out;
  }, [live]);
  // Las que un vendor tenía y se le sacan: el chip queda tachado hasta guardar.
  const leaving = useMemo(() => {
    const out = new Map<string, WorkVendor[]>();
    for (const v of live) for (const id of origScenes(v)) if (!v.scenes.includes(id)) out.set(id, [...(out.get(id) ?? []), v]);
    return out;
  }, [live, orig]); // eslint-disable-line react-hooks/exhaustive-deps
  const seenBy = (id: string) => (byScene.get(id) ?? []).filter((v) => v.emails.length > 0);

  // Una escena sin la marca: la escribe quien edita al guardar; si no, no se puede asignar.
  const needsMark = (id: string) => !isMarkedScene(tree.get(id)) && perms.pageLevel(id) < 3;
  // Bloqueadas: las que la app ve con otra entidad adentro, y las que la base dice que hoy no se pueden dar (`ok` falso
  // en algún vendor: le sacaron la marca o le movieron algo adentro mientras el vendor no tenía correos).
  const blockedIds = useMemo(() => {
    const out = new Set(scenes.filter((s) => s.blocked).map((s) => s.pageId));
    for (const v of orig.values()) for (const s of v.scenes) if (!s.ok) out.add(s.page_id);
    return out;
  }, [scenes, orig]);
  const statusOf = (id: string): RowStatus => {
    if (!current) return 'none';
    const now = current.scenes.includes(id);
    const before = origScenes(current).includes(id);
    if (now && !before) return 'adding';
    if (!now && before) return 'removing';
    // Asignada pero no se da (la base no se la da a sus correos): se ve bloqueada, y se puede sacar.
    if (now && blockedIds.has(id)) return 'blocked';
    if (now) return current.emails.length > 0 ? 'shared' : 'planned';
    if (blockedIds.has(id) || needsMark(id)) return 'blocked';
    return 'none';
  };
  /** Se puede tocar: lo que tiene (o tenía) siempre; si no, que no esté bloqueada. */
  const editable = (id: string) => {
    if (!current) return false;
    if (current.scenes.includes(id) || origScenes(current).includes(id)) return true;
    return !overCap && !blockedIds.has(id) && !needsMark(id);
  };
  const facts: RowFacts = {
    status: statusOf,
    vendors: (id) => (byScene.get(id) ?? []).map(vendorCode).join(' '),
    seenBy: (id) => seenBy(id).length,
    mine: (id) => !!current?.scenes.includes(id),
  };
  const pickedLocation = details && locations.includes(location) ? location : '';
  const pickedSet = details && sets.includes(set) ? set : '';
  const currentView: View = view === 'mine' && !current ? 'all' : view;
  const shown = sortRows(filterRows(tableRows, { text: filter, view: currentView, location: pickedLocation, set: pickedSet }, facts), sort, facts);
  const columns = COLUMNS.filter((c) => (details || !c.details) && (current || !c.vendor));
  const shownEditable = shown.filter((s) => editable(s.pageId));
  const isOn = (id: string) => !!current?.scenes.includes(id);
  const allShown = shownEditable.length > 0 && shownEditable.every((s) => isOn(s.pageId));
  const someShown = shownEditable.some((s) => isOn(s.pageId));

  /** Asigna o saca varias al vendor elegido. */
  const setMany = (ids: string[], value: boolean) => {
    if (!current) return;
    const touch = ids.filter((id) => editable(id));
    patch(current.key, (v) => ({
      scenes: value ? [...v.scenes, ...touch.filter((id) => !v.scenes.includes(id))] : v.scenes.filter((id) => !touch.includes(id)),
    }));
  };
  /** Una fila; con Shift, el rango desde la última tocada (en el orden que se ve), al mismo valor. */
  const toggle = (id: string, shift = false) => {
    const value = !isOn(id);
    const from = shift && anchor.current ? shown.findIndex((s) => s.pageId === anchor.current) : -1;
    const to = shown.findIndex((s) => s.pageId === id);
    anchor.current = id;
    if (from < 0 || to < 0) return setMany([id], value);
    const [a, b] = from < to ? [from, to] : [to, from];
    setMany(shown.slice(a, b + 1).map((s) => s.pageId), value);
  };
  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  useEffect(() => {
    if (headCheck.current) headCheck.current.indeterminate = someShown && !allShown;
  });
  useEffect(() => {
    if (focusName.current && nameInput.current) {
      focusName.current = false;
      nameInput.current.focus();
    }
  });

  // Otro vendor elegido: lo del correo y el borrar eran del de antes.
  useEffect(() => {
    setMailText('');
    setMailError(null);
    setConfirmDelete(false);
    setPicking(null);
    anchor.current = null;
  }, [sel]);

  /** Las operaciones que manda *Save*: lo nuevo, lo cambiado y lo borrado. */
  const ops = useMemo<VendorOp[]>(() => {
    const out: VendorOp[] = [];
    for (const v of work) {
      if (!v.id) {
        if (v.deleted) continue;
        out.push({ op: 'create', key: v.key, name: v.name.trim(), code: v.code, color: v.color, level: v.level, add_scenes: v.scenes, add_emails: v.emails });
        continue;
      }
      if (v.deleted) {
        out.push({ op: 'delete', id: v.id });
        continue;
      }
      const o = orig.get(v.id);
      if (!o) continue;
      const before = o.scenes.map((s) => s.page_id);
      const mails = o.emails.map((e) => e.email);
      const op: VendorOp = { op: 'update', id: v.id };
      if (v.name.trim() !== o.name) op.name = v.name.trim();
      if (v.code !== o.code) op.code = v.code;
      if (v.color !== o.color) op.color = v.color;
      if (v.level !== o.level) op.level = v.level;
      const addScenes = v.scenes.filter((id) => !before.includes(id));
      const removeScenes = before.filter((id) => !v.scenes.includes(id));
      const addEmails = v.emails.filter((e) => !mails.includes(e));
      const removeEmails = mails.filter((e) => !v.emails.includes(e));
      const again = v.emails.filter((e) => mails.includes(e) && reinvite.has(`${v.key}:${e}`));
      if (addScenes.length) op.add_scenes = addScenes;
      if (removeScenes.length) op.remove_scenes = removeScenes;
      if (addEmails.length) op.add_emails = addEmails;
      if (removeEmails.length) op.remove_emails = removeEmails;
      if (again.length) op.reinvite = again;
      if (Object.keys(op).length > 2) out.push(op);
    }
    return out;
  }, [work, orig, reinvite]);

  // Lo que cambia en cada vendor, para la lista y el pie.
  const changesOf = (v: WorkVendor) => {
    const before = origScenes(v);
    const mails = origEmails(v).map((e) => e.email);
    return {
      add: v.scenes.filter((id) => !before.includes(id)).length,
      remove: before.filter((id) => !v.scenes.includes(id)).length,
      invites: v.emails.filter((e) => !mails.includes(e)).length + v.emails.filter((e) => reinvite.has(`${v.key}:${e}`)).length,
      isNew: !v.id,
    };
  };
  const invites = live.reduce((n, v) => n + changesOf(v).invites, 0);
  const unnamed = live.some((v) => !v.name.trim());

  const cleanOn = status.cleanOn;
  const canSave = !busy && cleanOn && list !== null && ops.length > 0 && !unnamed;

  /** Una vendor nuevo, elegido y con el nombre para escribir. */
  function addVendor() {
    const used = new Set(live.map((v) => v.color));
    const color = PROJECT_PRESETS.find((c) => !used.has(c)) ?? PROJECT_PRESETS[live.length % PROJECT_PRESETS.length];
    const key = `new:${++counter.current}`;
    setWork((all) => [...all, { key, id: null, name: '', code: '', color, level: cap >= 2 ? 'comment' : 'view', emails: [], scenes: [], deleted: false }]);
    focusName.current = true;
    setSel(key);
    if (view === 'mine') setView('all');
  }

  /** Suma el correo escrito al vendor elegido (uno por vendor del proyecto). */
  function addEmail() {
    if (!current) return;
    const email = mailText.trim().toLowerCase();
    if (!email) return;
    if (overCap) return setMailError(tr('scenes.share.levelNotAllowed'));
    if (!EMAIL.test(email) || email.length > 320) return setMailError(tr('scenes.share.emailInvalid'));
    const other = live.find((v) => v.emails.includes(email));
    if (other) return setMailError(other.key === current.key ? tr('scenes.share.emailHere') : tr('scenes.share.emailOther', { name: other.name || tr('scenes.share.unnamed') }));
    patch(current.key, (v) => ({ emails: [...v.emails, email] }));
    setMailText('');
    setMailError(null);
  }

  /** Saca un correo (o deshace sacarlo, si estaba guardado). */
  function toggleEmail(email: string) {
    if (!current) return;
    if (current.emails.includes(email)) patch(current.key, (v) => ({ emails: v.emails.filter((e) => e !== email) }));
    else {
      const other = live.find((v) => v.emails.includes(email));
      if (other) return setMailError(tr('scenes.share.emailOther', { name: other.name || tr('scenes.share.unnamed') }));
      patch(current.key, (v) => ({ emails: [...v.emails, email] }));
    }
    setReinvite((r) => {
      const next = new Set(r);
      next.delete(`${current.key}:${email}`);
      return next;
    });
  }

  function deleteVendor() {
    if (!current) return;
    if (!current.id) setWork((all) => all.filter((v) => v.key !== current.key));
    else patch(current.key, { deleted: true });
    setSel('all');
  }

  /** Guarda todo (en el gesto: el link de invitación se copia sin esperar nada antes). */
  function save() {
    if (!canSave) return;
    const sending = ops;
    // Lo que empieza a verse: lo que entra a un vendor con correos, y todo lo de un vendor que suma correos.
    const exposing = new Set<string>();
    const entering = new Set<string>();
    for (const v of live) {
      const before = origScenes(v);
      const mails = origEmails(v).map((e) => e.email);
      const added = v.scenes.filter((id) => !before.includes(id));
      for (const id of added) entering.add(id);
      if (v.emails.length > 0) for (const id of added) exposing.add(id);
      if (v.emails.some((e) => !mails.includes(e) || reinvite.has(`${v.key}:${e}`))) for (const id of v.scenes) exposing.add(id);
    }
    const scope = { pageIds: [...exposing] };
    const editor = perms.projectLevel(projectId) >= 3;
    setError(null);
    setDone(null);
    setManualLink(null);
    gate.clearBlocked();
    let pending = 0;
    const work = (async () => {
      if (editor) await markAndWait(tree, engine, [...entering]);
      // Sin *Share anyway*: con un vendor no se comparte sin haber subido lo pendiente (M4).
      if (exposing.size > 0 && !(await gate.ready(scope, true, () => latestSave.current(), null))) throw UNSYNCED_BEFORE_SHARE;
      const result = await remote.saveSceneVendors(projectId, sending);
      pending = result.pending.length;
      return result;
    })();
    setBusy(true);
    void (async () => {
      try {
        let manual: string | null = null;
        if (invites > 0) manual = await inviteAndCopy(work.then(() => makeLink(projectId)));
        const result = await work;
        setManualLink(manual);
        setDone({ pending });
        if (editor && result.reset.length > 0) gate.after({ pageIds: result.reset }, true, projectName);
        void outsideReadersStore(services)?.invalidate(projectId);
        keepSelected.current = sel.startsWith('new:') ? (result.keys[sel] ?? null) : sel;
        setReload((n) => n + 1);
      } catch (err) {
        if (err === UNSYNCED_BEFORE_SHARE) return;
        const message = err instanceof Error ? err.message : String(err);
        const known: Record<string, Key> = {
          page_invalid: 'scenes.share.pageInvalid',
          scene_contains_entities: 'scenes.share.containsEntities',
          email_in_other_vendor: 'scenes.share.inOtherVendor',
          level_not_allowed: 'scenes.share.levelNotAllowed',
          own_email: 'scenes.share.ownEmail',
          vendor_invalid: 'scenes.share.vendorInvalid',
          clean_off: 'scenes.share.cleanOff',
        };
        setError(err === MARKS_PENDING ? tr('scenes.share.marksPending') : known[message] ? tr(known[message]) : teamErrorText(err));
      } finally {
        setBusy(false);
      }
    })();
  }
  const latestSave = useRef(save);
  latestSave.current = save;

  const levelLabel = (l: VendorLevel) => tr(LEVEL_LABELS[l]);
  const others = list?.others ?? new Map<string, number>();
  const othersCount = scenes.filter((s) => (others.get(s.pageId) ?? 0) > 0).length;
  const nMine = current ? current.scenes.length : 0;
  const nNone = tableRows.filter((r) => !byScene.has(r.pageId)).length;
  const nMulti = tableRows.filter((r) => seenBy(r.pageId).length >= 2).length;

  // Las escenas del elegido que también ven otros vendors con correo (se ven entre sí).
  const crossed = current && current.emails.length > 0 ? scenes.filter((s) => current.scenes.includes(s.pageId) && seenBy(s.pageId).length >= 2) : [];
  const crossedWith = [...new Set(crossed.flatMap((s) => seenBy(s.pageId).filter((v) => v.key !== current?.key).map((v) => v.name || tr('scenes.share.unnamed'))))];

  const chip = (v: WorkVendor, id: string, gone = false) => {
    const added = !gone && !origScenes(v).includes(id);
    const cls = ['share-vchip', v.emails.length === 0 ? 'plan' : '', added ? 'add' : '', gone ? 'rm' : ''].filter(Boolean).join(' ');
    return (
      <span key={`${v.key}${gone ? ':gone' : ''}`} className={cls} style={{ '--vc': v.color } as CSSProperties} data-tip={v.name || tr('scenes.share.unnamed')}>
        <i />
        {vendorCode(v)}
      </span>
    );
  };

  const railItem = (v: WorkVendor) => {
    const ch = changesOf(v);
    const n = v.scenes.length;
    return (
      <button
        key={v.key}
        type="button"
        className="share-vitem"
        style={{ '--vc': v.color } as CSSProperties}
        aria-current={sel === v.key}
        onClick={() => setSel(v.key)}
      >
        <span className="bar" />
        <span className="nm">
          <span className="nm-text">{v.name || tr('scenes.share.unnamed')}</span>
          <span className="cd mono">{vendorCode(v)}</span>
          {v.level === 'view' ? <EyeIcon size={13} /> : <CommentIcon size={13} />}
        </span>
        <span className="pend mono">
          {ch.add > 0 && <span className="plus">+{ch.add}</span>}
          {ch.remove > 0 && <span className="minus"> −{ch.remove}</span>}
        </span>
        <span className="meta">
          <span>{tr('scenes.share.sceneCount', { count: n })}</span>
          <span aria-hidden>·</span>
          {v.emails.length > 0 ? <span>{tr('scenes.share.emailCount', { count: v.emails.length })}</span> : <span className="nomail">{tr('scenes.share.noEmailShort')}</span>}
        </span>
      </button>
    );
  };

  const emailRows = current
    ? [
        ...current.emails.map((e) => {
          const was = origEmails(current).find((x) => x.email === e);
          const again = reinvite.has(`${current.key}:${e}`);
          const state: keyof typeof MAIL_STATE = !was ? 'new' : again ? 'again' : was.state;
          return { email: e, state, removed: false };
        }),
        ...origEmails(current)
          .filter((x) => !current.emails.includes(x.email))
          .map((x) => ({ email: x.email, state: 'removed' as const, removed: true })),
      ]
    : [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal team-dialog share-scenes share-vendors" role="dialog" aria-label={tr('scenes.share.label')} onClick={(e) => e.stopPropagation()}>
        <div className="share-vendors-head">
          <div>
            <h2>{tr('scenes.share.title', { name: projectName })}</h2>
            <p className="muted team-lead">{tr('scenes.share.lead')}</p>
          </div>
          <button type="button" className="icon-button" aria-label={tr('common.close')} onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </div>
        {!cleanOn && (
          <p className="warn small team-lead" role="alert">
            {tr('scenes.share.cleanOff')}
          </p>
        )}

        <div className="share-vendors-grid">
          <aside className="share-vendors-rail" aria-label={tr('scenes.share.vendors')}>
            <div className="share-vendors-rail-head">
              <span>{tr('scenes.share.vendorsCount', { count: live.length })}</span>
            </div>
            <div className="share-vendors-rail-list">
              <button type="button" className="share-vitem all" aria-current={sel === 'all'} onClick={() => setSel('all')}>
                <span className="bar" />
                <span className="nm">
                  <span className="nm-text">{tr('scenes.share.allVendors')}</span>
                </span>
                <span />
                <span className="meta">{tr('scenes.share.allVendorsMeta')}</span>
              </button>
              {live.map(railItem)}
            </div>
            <button type="button" className="share-vendors-add" onClick={addVendor} disabled={list === null}>
              <PlusIcon size={14} />
              {tr('scenes.share.newVendor')}
            </button>
          </aside>

          <div className={`share-vendors-main${current ? '' : ' overview'}`}>
            {current ? (
              <div className="share-vendor-edit">
                <div className="share-vendor-row">
                  <span className="share-vendor-swatch-wrap">
                    <button
                      type="button"
                      className="share-vendor-swatch"
                      style={{ '--vc': current.color } as CSSProperties}
                      aria-label={tr('scenes.share.vendorColor')}
                      aria-expanded={!!picking}
                      onClick={() => setPicking(picking ? null : { before: current.color })}
                    >
                      <i />
                    </button>
                    {picking && (
                      <div className="share-vendor-pop" role="dialog" aria-label={tr('scenes.share.vendorColor')}>
                        <ColorPicker
                          initial={current.color}
                          defaultColor={picking.before}
                          presets={PROJECT_PRESETS}
                          recents={loadRecentColors()}
                          onChange={(color) => patch(current.key, { color })}
                          onCancel={() => {
                            patch(current.key, { color: picking.before });
                            setPicking(null);
                          }}
                          onAccept={(color) => {
                            rememberRecentColor(color);
                            patch(current.key, { color });
                            setPicking(null);
                          }}
                        />
                      </div>
                    )}
                  </span>
                  <input
                    ref={nameInput}
                    className="share-vendor-name"
                    value={current.name}
                    maxLength={80}
                    placeholder={tr('scenes.share.vendorName')}
                    aria-label={tr('scenes.share.vendorName')}
                    onChange={(e) => patch(current.key, { name: e.target.value })}
                  />
                  <input
                    className="share-vendor-code mono"
                    value={current.code}
                    maxLength={4}
                    placeholder={vendorCode({ code: '', name: current.name })}
                    aria-label={tr('scenes.share.vendorCode')}
                    data-tip={tr('scenes.share.vendorCodeTip')}
                    onChange={(e) => patch(current.key, { code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) })}
                  />
                  <div className="segmented share-scenes-level" role="group" aria-label={tr('team.access')}>
                    {(['view', 'comment'] as const).map((l) => {
                      // Con Ver sobre el proyecto, Comentar no se da (sí se puede bajar un vendor que ya comenta).
                      const locked = l === 'comment' && cap < 2 && current.level !== 'comment';
                      return (
                        <button
                          key={l}
                          type="button"
                          aria-pressed={current.level === l}
                          disabled={locked}
                          data-tip={locked ? tr('scenes.share.levelNotAllowed') : undefined}
                          onClick={() => patch(current.key, { level: l })}
                        >
                          {l === 'view' ? <EyeIcon size={14} /> : <CommentIcon size={14} />}
                          {levelLabel(l)}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    className="icon-button danger"
                    aria-label={tr('scenes.share.deleteVendor')}
                    data-tip={tr('scenes.share.deleteTip')}
                    onClick={() => setConfirmDelete(true)}
                  >
                    <TrashIcon size={15} />
                  </button>
                </div>
                <div className="share-vendor-mails">
                  <MailIcon size={15} />
                  {emailRows.map((m) => (
                    <span key={m.email} className={`share-vendor-mail ${m.state}`}>
                      <span className="e">{m.email}</span>
                      <span className="s">
                        {m.state === 'joined' && <CheckIcon size={12} />}
                        {m.state === 'invited' && <HistoryIcon size={12} />}
                        {tr(MAIL_STATE[m.state])}
                      </span>
                      {m.state === 'expired' && !overCap && (
                        <button
                          type="button"
                          className="link"
                          onClick={() => setReinvite((r) => new Set(r).add(`${current.key}:${m.email}`))}
                        >
                          {tr('scenes.share.reinvite')}
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={tr(m.removed ? 'scenes.share.undoRemove' : 'scenes.share.removeEmail', { email: m.email })}
                        onClick={() => toggleEmail(m.email)}
                      >
                        {m.removed ? <UndoIcon size={13} /> : <CloseIcon size={13} />}
                      </button>
                    </span>
                  ))}
                  <form
                    className="share-vendor-addmail"
                    onSubmit={(e) => {
                      // Enter en el campo suma el correo (el formulario lo manda solo, sin comparar teclas).
                      e.preventDefault();
                      addEmail();
                    }}
                  >
                    <PlusIcon size={13} />
                    <input
                      type="email"
                      value={mailText}
                      maxLength={320}
                      placeholder={tr('scenes.share.addEmail')}
                      aria-label={tr('scenes.share.addEmail')}
                      onChange={(e) => {
                        setMailText(e.target.value);
                        setMailError(null);
                      }}
                      onBlur={() => mailText.trim() && addEmail()}
                    />
                  </form>
                </div>
                {mailError && (
                  <p className="share-vendor-hint err" role="alert">
                    <WarningIcon size={14} />
                    <span>{mailError}</span>
                  </p>
                )}
                {current.emails.length === 0 && (
                  <p className="share-vendor-hint">
                    <InfoIcon size={14} />
                    <span>{tr('scenes.share.noEmail')}</span>
                  </p>
                )}
                {confirmDelete && (
                  <div className="share-vendor-confirm" role="alert">
                    <span>{tr('scenes.share.confirmDelete', { name: current.name || tr('scenes.share.unnamed') })}</span>
                    <button type="button" onClick={() => setConfirmDelete(false)}>
                      {tr('common.cancel')}
                    </button>
                    <button type="button" className="danger" onClick={deleteVendor}>
                      {tr('scenes.share.deleteVendor')}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p className="share-vendors-overview">
                <MembersIcon size={16} />
                <span>{tr(live.length > 0 ? 'scenes.share.overview' : 'scenes.share.overviewEmpty')}</span>
              </p>
            )}

            <div className="share-scenes-tools">
              <label className="share-scenes-search">
                <SearchIcon size={15} />
                <input
                  type="search"
                  placeholder={tr('scenes.share.search')}
                  aria-label={tr('scenes.share.search')}
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
            </div>
            <div className="share-scenes-views" role="group" aria-label={tr('scenes.share.views')}>
              {(
                [
                  ['all', tr('scenes.share.viewAll'), scenes.length],
                  ...(current ? [['mine', tr('scenes.share.viewMine', { name: current.name || tr('scenes.share.unnamed') }), nMine] as const] : []),
                  ['none', tr('scenes.share.viewNone'), nNone],
                  ['multi', tr('scenes.share.viewMulti'), nMulti],
                  ['blocked', tr('scenes.share.viewBlocked'), blockedIds.size],
                ] as const
              )
                .filter(([v, , n]) => n > 0 || v === 'all' || v === 'mine' || currentView === v)
                .map(([v, label, n]) => (
                  <button
                    key={v}
                    type="button"
                    className={`share-scenes-view${v === 'multi' ? ' outside' : ''}`}
                    aria-pressed={currentView === v}
                    onClick={() => setView(currentView === v && v !== 'all' ? 'all' : v)}
                  >
                    {label}
                    <span className="mono">{n}</span>
                  </button>
                ))}
            </div>
            {othersCount > 0 && (
              <p className="share-scenes-outside">
                <MembersIcon size={16} />
                <span>{tr('scenes.share.othersSummary', { count: othersCount })}</span>
              </p>
            )}

            <div className="share-scenes-table-wrap">
              <table className={`share-scenes-table share-vendors-table${details ? ' with-details' : ''}${current ? '' : ' overview'}`} aria-label={tr('scenes.share.list')}>
                <colgroup>
                  {current && <col className="c-check" />}
                  {columns.map((c) => (
                    <col key={c.key} className={`c-${c.key}`} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {current && (
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
                    )}
                    {columns.map((c) => (
                      <th key={c.key} className={`c-${c.key}`} aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                        <button type="button" onClick={() => sortBy(c.key)}>
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
                    const canTouch = editable(s.pageId);
                    const seen = seenBy(s.pageId);
                    const pick = (e: MouseEvent) => {
                      if (canTouch) toggle(s.pageId, e.shiftKey);
                    };
                    const why = s.blocked ? tr('scenes.share.blocked') : current && needsMark(s.pageId) && !isOn(s.pageId) ? tr('scenes.share.needsMark') : null;
                    return (
                      <tr
                        key={s.pageId}
                        data-scene={s.pageId}
                        className={[st, isOn(s.pageId) ? 'checked' : '', st === 'adding' || st === 'removing' ? 'changed' : ''].filter(Boolean).join(' ')}
                        onClick={current ? pick : undefined}
                        onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                      >
                        {current && (
                          <td className="c-check">
                            <input
                              type="checkbox"
                              aria-label={`${s.label} ${s.name}`.trim()}
                              checked={isOn(s.pageId)}
                              disabled={!canTouch}
                              onChange={() => undefined}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (canTouch) toggle(s.pageId, e.shiftKey);
                              }}
                            />
                          </td>
                        )}
                        <td className="c-code mono share-scenes-code">{s.label}</td>
                        <td className="c-name">
                          <span className="share-scenes-title">{s.name || s.title}</span>
                          {details && (s.locations.length > 0 || s.sets.length > 0) && (
                            <span className="share-scenes-meta">{[...s.locations, ...s.sets].join(' · ')}</span>
                          )}
                          {why && <span className="share-scenes-why">{why}</span>}
                        </td>
                        {details && (
                          <>
                            <td className="c-location">{s.locations.join(', ')}</td>
                            <td className="c-set">{s.sets.join(', ')}</td>
                            <td className="c-intExt mono">{s.intExt.join(', ')}</td>
                          </>
                        )}
                        <td className="c-vendors">
                          <span className="share-vchips">
                            {(byScene.get(s.pageId) ?? []).map((v) => chip(v, s.pageId))}
                            {(leaving.get(s.pageId) ?? []).map((v) => chip(v, s.pageId, true))}
                            {seen.length >= 2 && (
                              <span
                                className="share-vboth"
                                role="img"
                                aria-label={tr('scenes.share.bothTip', { list: seen.map((v) => v.name || tr('scenes.share.unnamed')).join(', ') })}
                                data-tip={tr('scenes.share.bothTip', { list: seen.map((v) => v.name || tr('scenes.share.unnamed')).join(', ') })}
                              >
                                <WarningIcon size={14} />
                              </span>
                            )}
                            {(others.get(s.pageId) ?? 0) > 0 && (
                              <span
                                className="share-scenes-out"
                                role="img"
                                aria-label={tr('scenes.share.othersTip', { count: others.get(s.pageId) ?? 0 })}
                                data-tip={tr('scenes.share.othersTip', { count: others.get(s.pageId) ?? 0 })}
                              >
                                <MembersIcon size={13} />
                                {others.get(s.pageId)}
                              </span>
                            )}
                          </span>
                        </td>
                        {current && (
                          <td className="c-status">
                            {st !== 'none' && (
                              <span className={`share-scenes-st ${st}`}>
                                {st === 'blocked' ? <LockIcon size={13} /> : <i />}
                                {tr(STATUS_WORD[st])}
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {crossed.length > 0 && (
              <p className="share-vendor-cross" role="note">
                <WarningIcon size={15} />
                <span>
                  {tr('scenes.share.cross', {
                    count: crossed.length,
                    name: current?.name || tr('scenes.share.unnamed'),
                    list: crossedWith.join(', '),
                    codes: crossed.map((s) => sceneRowsLabel(tableRows, s.pageId)).join(', '),
                  })}
                </span>
              </p>
            )}
            <p className="share-vendors-legend">
              <span>
                <span className="share-vchip legend">
                  <i />
                  AB
                </span>
                {tr('scenes.share.legendSeen')}
              </span>
              <span>
                <span className="share-vchip legend plan">
                  <i />
                  AB
                </span>
                {tr('scenes.share.legendPlan')}
              </span>
              <span>
                <span className="share-vboth">
                  <WarningIcon size={14} />
                </span>
                {tr('scenes.share.legendBoth')}
              </span>
            </p>
          </div>
        </div>

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
            {done.pending > 0 ? tr('scenes.share.donePending', { count: done.pending }) : tr('scenes.share.done')}
          </p>
        )}
        <p className="share-scenes-limits">
          <InfoIcon size={15} />
          <span>{tr('scenes.share.limits')}</span>
        </p>

        <div className="team-invite-actions share-scenes-footer">
          <span className="share-scenes-sum">
            {live.some((v) => {
              const c = changesOf(v);
              return c.add || c.remove || c.isNew;
            }) || ops.length > 0 ? (
              <>
                {live.map((v) => {
                  const c = changesOf(v);
                  const edited = ops.some((o) => o.op !== 'create' && o.id === v.id);
                  if (!c.add && !c.remove && !c.isNew && !edited) return null;
                  return (
                    <span key={v.key} className="share-vendors-sum-item">
                      <span className="share-vchip" style={{ '--vc': v.color } as CSSProperties}>
                        <i />
                        {vendorCode(v)}
                      </span>
                      {c.add > 0 && <span className="plus">+{c.add}</span>}
                      {c.remove > 0 && <span className="minus">−{c.remove}</span>}
                      {c.isNew && <span className="muted">{tr('scenes.share.vendorNew')}</span>}
                      {!c.isNew && !c.add && !c.remove && <span className="muted">{tr('scenes.share.vendorEdited')}</span>}
                    </span>
                  );
                })}
                {work
                  .filter((v) => v.deleted && v.id)
                  .map((v) => (
                    <span key={v.key} className="share-vendors-sum-item">
                      <span className="share-vchip rm" style={{ '--vc': v.color } as CSSProperties}>
                        <i />
                        {vendorCode(v)}
                      </span>
                      <span className="minus">{tr('scenes.share.vendorDeleted')}</span>
                    </span>
                  ))}
                {invites > 0 && (
                  <span className="muted share-vendors-sum-item">
                    <MailIcon size={14} />
                    {tr('scenes.share.invites', { count: invites })}
                  </span>
                )}
              </>
            ) : (
              <span className="muted">{tr('scenes.share.noChanges')}</span>
            )}
            {unnamed && <span className="warn">{tr('scenes.share.nameMissing')}</span>}
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

/** El número de una escena como se ve en la tabla. */
function sceneRowsLabel(rows: { pageId: string; label: string }[], id: string): string {
  return rows.find((r) => r.pageId === id)?.label ?? '';
}
