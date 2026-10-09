import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { t as tGlobal, useT, type Translate } from '../i18n';
import { navigate, pagePath } from '../router';
import { useServices, useSyncStatus, useTree, type Services } from '../services';
import { Permissions } from '../sync/access';
import { notify } from '../ui/notice';
import { existingRelationsSession } from '../ui/relationsUi';
import { assignHeading, assignMention, assignMentionEverywhere, undoAssign, undoAssignEverywhere, unlinkPage, type AssignResult } from './assign';
import { createDepsFrom, createEntity, createGuard, freshSync, undoCreate, type CreateResult, type CreateWant, type GuardResult } from './createEntity';
import { sceneTitleOf } from './dayLive';
import { Ic } from './LiveHeader';
import { nearEpisodes, searchScenes, type SceneOption } from './sceneSearch';

// Los botones de *Create* y *Assign* (Docs/Doc_Relaciones.md, sección 15; E7): el mismo en el adelanto de un pendiente,
// la cabecera del día y *Map › Pending*, con las mismas guardas (`createEntity.ts`) y la misma escritura (`assign.ts`).
// Cuando no se puede crear, en vez del botón va un rótulo apagado con el motivo en el tooltip (D519).

type CreateFail = Extract<GuardResult, { ok: false }>;

/** Por qué no se puede crear, en palabras (UI en inglés; castellano en la app en castellano). */
export function reasonText(tr: Translate, r: CreateFail, want: CreateWant, title: (id: string) => string | undefined): string {
  const named = r.pageId ? (title(r.pageId) ?? '') : '';
  switch (r.reason) {
    case 'partial':
      return tr('create.why.partial');
    case 'reading':
      return tr('create.why.reading');
    case 'offline':
      return tr('create.why.offline');
    case 'exists':
      return tr('create.why.exists', { title: named });
    case 'trash':
      return tr('create.why.trash', { title: named });
    case 'archived':
      return tr('create.why.archived', { title: named });
    case 'letter':
      return tr('create.why.letter', { other: r.other ?? '' });
    case 'base':
      return tr('create.why.base', { other: r.other ?? '' });
    case 'noFolder':
      return tr(want.kind === 'scene' ? 'create.why.noFolderScene' : 'create.why.noFolderLocation');
    case 'twoFolders':
      return tr('create.why.twoFolders');
    case 'cantCreate':
      return tr('create.why.cantCreate', { title: named });
    default:
      return tr('create.why.invalid');
  }
}

export interface CreateEnv {
  projectId: string;
  /** Las guardas ahora (para dibujar el botón o el ítem del `/`). */
  guard(want: CreateWant): GuardResult;
  /** Crea (con las guardas, una sincronización y las guardas otra vez). */
  create(want: CreateWant): Promise<CreateResult>;
}

/** El entorno de crear con los servicios de la app: permisos, foto del índice y estado de la sincronización, al momento. */
export function createEnv(services: Pick<Services, 'tree' | 'docs' | 'engine' | 'access' | 'user'>, projectId: string, lang: string): CreateEnv {
  const perms = () => new Permissions(services.tree, services.access.get(), services.user.id);
  const snap = () => existingRelationsSession(services)?.relations.snapshot(projectId) ?? null;
  const deps = createDepsFrom(services, { projectId, lang, perms, snap });
  return {
    projectId,
    guard: (want) => createGuard(deps.context(), want),
    create: (want) => createEntity(deps, want),
  };
}

/**
 * Crea y avisa: «Created scene 105_120 in «105 | Episodio 5»» con *Open* y *Undo* (D518). `inPage` es la página donde
 * se escribió el número (el `/`): *Undo* también le saca el link a la página creada, que vuelve a leerse como pendiente.
 * `onCreated` corre antes del aviso (el `/` vuelve link lo que escribió).
 */
export async function runCreate(
  services: Pick<Services, 'tree' | 'docs' | 'engine' | 'access' | 'user'>,
  env: CreateEnv,
  want: CreateWant,
  opts: { tr: Translate; inPage?: string; onCreated?: (pageId: string) => void } = { tr: tGlobal as unknown as Translate },
): Promise<CreateResult> {
  const { tr } = opts;
  let res: CreateResult;
  try {
    res = await env.create(want);
  } catch (err) {
    console.warn('[crear] no se pudo crear', want, err);
    notify(tr('create.failed'));
    return { ok: false, reason: 'invalid' };
  }
  const title = (id: string) => services.tree.get(id)?.title;
  if (!res.ok) {
    notify(reasonText(tr, res, want, title));
    return res;
  }
  const created = res;
  opts.onCreated?.(created.pageId);
  const { pageSignature } = await import('./createWrite');
  const signature = await pageSignature(services.docs, created.pageId).catch(() => null);
  const folder = title(created.parentId) ?? '';
  const message = want.kind === 'scene' ? tr('create.createdScene', { code: want.code, folder }) : tr('create.createdLocation', { name: created.title, folder });
  notify(
    message,
    { label: tr('create.open'), run: () => navigate(pagePath(created.pageId)) },
    {
      label: tr('create.undo'),
      run: () => {
        void (async () => {
          const out = await undoCreate(
            services.tree,
            created,
            async () => signature !== null && (await pageSignature(services.docs, created.pageId)) === signature,
            () => freshSync(services.engine),
          );
          if (out === 'offline') {
            notify(tr('create.undoOffline', { title: created.title }));
            return;
          }
          if (out === 'changed') {
            notify(tr('create.undoChanged', { title: created.title }));
            return;
          }
          if (out === 'trashed' && opts.inPage) await unlinkPage(services, opts.inPage, created.pageId).catch(() => 0);
          if (out === 'trashed') notify(tr('create.undone', { title: created.title }));
        })();
      },
    },
  );
  return res;
}

const noSubscribe = () => () => undefined;
const zero = () => 0;

/** Re-renderiza con cada foto nueva del índice (para que el botón cambie apenas termina de leer). */
function useRelationsRevision(services: Services): void {
  const session = existingRelationsSession(services);
  useSyncExternalStore(session?.relations.subscribe ?? noSubscribe, session?.relations.getRevision ?? zero);
}

/**
 * *Create scene 105_120* (o *Create location «…»*) con las guardas: si no pasan, un rótulo apagado con el motivo en el
 * tooltip. `onDone` corre al terminar (bien o mal).
 */
export function CreateEntityButton({ want, projectId, className, onDone }: { want: CreateWant; projectId: string; className?: string; onDone?: (res: CreateResult) => void }) {
  const tr = useT();
  const services = useServices();
  const tree = useTree();
  useSyncStatus();
  useRelationsRevision(services);
  const [busy, setBusy] = useState(false);
  const env = createEnv(services, projectId, tr.lang);
  const guard = env.guard(want);
  const label = want.kind === 'scene' ? tr('create.scene', { code: want.code }) : tr('create.location', { name: want.name });
  if (!guard.ok) {
    const why = reasonText(tr, guard, want, (id) => tree.get(id)?.title);
    // En la papelera: el motivo a la vista y un link a la papelera para restaurarla (O4 de la auditoría de E7).
    if (guard.reason === 'trash') {
      return (
        <button className="rel-cant trash" data-tip={why} onClick={() => navigate('/trash')}>
          {tr('create.inTrash')}
        </button>
      );
    }
    return (
      <span className="rel-cant" data-tip={why} tabIndex={0}>
        <Ic name="plus" small />
        {label}
      </span>
    );
  }
  const folder = tree.get(guard.parentId)?.title ?? '';
  return (
    <button
      className={`rel-create ${className ?? ''}`}
      disabled={busy}
      data-tip={guard.ok && guard.generic ? `${tr('create.in', { folder })} · ${tr('create.generic')}` : tr('create.in', { folder })}
      onClick={() => {
        setBusy(true);
        void runCreate(services, env, want, { tr }).then((res) => {
          setBusy(false);
          onDone?.(res);
        });
      }}
    >
      <Ic name="plus" small />
      {label}
    </button>
  );
}

// --- Elegir una escena (Assign, Add scene de Tomorrow) ----------------------------------------------------------------

/**
 * El selector de escenas: filtra con `searchScenes` (el mismo de la lupa y el `/`: `029`, `5029`, `105-029`, el título).
 * Vacío, las de `near` primero. Solo escenas con una página que la persona ve.
 */
export function ScenePicker({
  src,
  have = [],
  near = [],
  ep = null,
  onPick,
  onClose,
  label,
  inline = false,
}: {
  src: Parameters<typeof searchScenes>[0];
  have?: string[];
  near?: readonly string[];
  ep?: string | null;
  onPick: (scene: { code: string; pageId: string }) => void;
  onClose: () => void;
  label: string;
  /**
   * En el flujo de lo que lo contiene (el adelanto: la tarjeta recorta lo que sale de ella, B1 de la auditoría de E7), con
   * el campo arriba y la lista con su propio alto. Si no, flotando debajo de su botón, corrido para no salirse de la
   * pantalla (O3).
   */
  inline?: boolean;
}) {
  const tr = useT();
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement | null>(null);
  const [shift, setShift] = useState(0);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      // Su propio botón lo abre y lo cierra (si no, cerrar acá y el clic lo volvía a abrir).
      if ((e.target as Element | null)?.closest?.('.rel-assign')) return;
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [onClose]);
  // Flotando: si se sale por un costado de la pantalla, se corre lo justo (con 12 px de margen).
  const shiftRef = useRef(0);
  useLayoutEffect(() => {
    if (inline) return;
    const fit = () => {
      if (!box.current) return;
      // Dónde estaría sin correrlo (lo de antes se descuenta): así se puede volver a medir después de que la fila se acomoda.
      const r = box.current.getBoundingClientRect();
      const left = r.left - shiftRef.current;
      const right = r.right - shiftRef.current;
      const room = Math.min(document.documentElement.clientWidth, innerWidth) - 12;
      const next = right > room ? Math.max(12 - left, room - right) : left < 12 ? 12 - left : 0;
      if (next !== shiftRef.current) {
        shiftRef.current = next;
        setShift(next);
      }
    };
    fit();
    const frame = requestAnimationFrame(fit);
    addEventListener('resize', fit);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('resize', fit);
    };
  }, [inline]);
  const options = pickerOptions(src, q, { have, near, ep });
  return (
    <div className={`lh-picker${inline ? ' inline' : ''}`} ref={box} role="dialog" aria-label={label} style={shift ? { transform: `translateX(${shift}px)` } : undefined}>
      <input
        autoFocus
        value={q}
        placeholder={tr('day.pickerPlaceholder')}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && options[0]?.pageId) onPick({ code: options[0].code, pageId: options[0].pageId });
        }}
      />
      <div className="lh-picker-list">
        {options.length ? (
          options.map((o) => (
            <button key={o.code} onClick={() => o.pageId && onPick({ code: o.code, pageId: o.pageId })}>
              <span className="k">{o.code}</span>
              <span className="t">{o.title}</span>
            </button>
          ))
        ) : (
          <span className="lh-none">{tr('day.noMatch')}</span>
        )}
      </div>
    </div>
  );
}

/** Las opciones del selector (pura, para las pruebas): con algo escrito, `searchScenes`; vacío, `near` y por número. */
export function pickerOptions(
  src: Parameters<typeof searchScenes>[0],
  q: string,
  { have = [], near = [], ep = null, limit = 8 }: { have?: string[]; near?: readonly string[]; ep?: string | null; limit?: number } = {},
): SceneOption[] {
  const usable = (o: SceneOption) => !!o.pageId && !have.includes(o.code);
  if (q.trim()) return searchScenes(src, q, { ep, near, limit: limit + have.length, loose: true }).filter(usable).slice(0, limit);
  const R = src.snap.registry;
  // Primero las cercanas, en su orden (el plan del día, lo que nombra la página); después las del episodio de la página o,
  // sin episodio (un día), las de los episodios de las cercanas (D570); después el resto, por número.
  const order = new Map(near.map((c, i) => [c, i]));
  const eps = nearEpisodes(R, ep, near);
  const codes = [...R.scenes.keys()].sort((a, b) => {
    const rank = (c: string) => (order.has(c) ? 0 : eps.has(R.scenes.get(c)?.ep ?? '') ? 1 : 2);
    return rank(a) - rank(b) || (order.get(a) ?? 0) - (order.get(b) ?? 0) || (a < b ? -1 : a > b ? 1 : 0);
  });
  const out: SceneOption[] = [];
  for (const code of codes) {
    const e = R.scenes.get(code)!;
    const title = e.pageId ? src.title(e.pageId) : undefined;
    if (title === undefined) continue;
    const o: SceneOption = { code, pageId: e.pageId, title: sceneTitleOf(title), episode: e.ep || null, why: 'number' };
    if (usable(o)) out.push(o);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * El aviso de cómo salió *Assign*. Si escribió, con *Undo* (D566): `undo` deshace solo lo agregado y solo si sigue igual;
 * si cambió, no toca nada y lo dice.
 */
export function assignNotice(tr: Translate, res: AssignResult, done: string, kind: 'heading' | 'mention', undo?: () => Promise<'undone' | 'changed' | 'partial'>): void {
  if (res.status === 'ok') notify(done, undo ? undoAction(tr, undo) : undefined);
  else if (res.status === 'unknown') notify(tr('assign.unknown'));
  else if (res.status === 'missing') notify(tr('assign.missing'));
  else notify(tr(kind === 'heading' ? 'assign.changed' : 'assign.changedMention'));
}

/** El botón *Undo* del aviso de *Assign*, con el aviso de cómo salió. */
export function undoAction(tr: Translate, undo: () => Promise<'undone' | 'changed' | 'partial'>) {
  return {
    label: tr('assign.undo'),
    run: () => {
      void undo().then(
        (out) => notify(tr(out === 'undone' ? 'assign.undone' : out === 'partial' ? 'assign.undonePartial' : 'assign.undoChanged')),
        (err) => {
          console.warn('[asignar] no se pudo deshacer', err);
          notify(tr('assign.undoChanged'));
        },
      );
    },
  };
}

/**
 * *Assign* (D521, D522): el botón abre el selector; al elegir, agrega la escena al título de la sección (`heading`) o pone
 * la marca sobre el número pendiente (`mention`), directo en el documento de esa página.
 */
export function AssignButton({
  src,
  pageId,
  target,
  near,
  ep,
  className,
  onPick,
}: {
  src: Parameters<typeof searchScenes>[0];
  /** La página donde se escribe (`heading` y `mention`; con `everywhere`, cada lugar trae la suya). */
  pageId?: string;
  target:
    | { kind: 'heading'; blockId: string; text: string }
    | { kind: 'mention'; blockId: string; pending: string; ep: string | null }
    /** Un número que no existe, en todos los lugares que lo nombran y la persona puede editar (*Map › Pending*, D567). */
    | { kind: 'everywhere'; pending: string; places: { pageId: string; blockIds: string[]; ep: string | null }[] };
  near?: readonly string[];
  ep?: string | null;
  className?: string;
  /** En vez de escribir en el documento: el adelanto, que tiene el editor abierto, pone la marca por el editor (⌘Z). */
  onPick?: (scene: { code: string; pageId: string }) => void;
}) {
  const tr = useT();
  const services = useServices();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pick = async (scene: { code: string; pageId: string }) => {
    setOpen(false);
    if (onPick) return onPick(scene);
    setBusy(true);
    try {
      if (target.kind === 'everywhere') {
        const out = await assignMentionEverywhere(services, target.places, target.pending, scene, src.snap.registry);
        const name = (id: string) => services.tree.get(id)?.title ?? '';
        if (!out.added) {
          notify(tr(out.failed.some((f) => f.status === 'missing') ? 'assign.missing' : out.failed.some((f) => f.status === 'unknown') ? 'assign.unknown' : 'assign.changedMention'));
          return;
        }
        const parts = [tr('assign.doneEverywhere', { pending: target.pending, code: scene.code, count: out.done.length })];
        if (out.failed.length) parts.push(tr('assign.notIn', { pages: out.failed.map((f) => `«${name(f.pageId)}»`).join(', '), count: out.failed.length }));
        notify(parts.join(' · '), undoAction(tr, () => undoAssignEverywhere(services, out.done)));
        return;
      }
      const at = pageId!;
      const res =
        target.kind === 'heading'
          ? await assignHeading(services, at, target.blockId, target.text, scene)
          : await assignMention(services, at, target.blockId, target.pending, scene, { registry: src.snap.registry, ep: target.ep });
      const done = target.kind === 'heading' ? tr('assign.done', { code: scene.code, title: target.text }) : tr('assign.doneMention', { pending: target.pending, code: scene.code });
      const spans = res.status === 'ok' ? res.undo : [];
      assignNotice(tr, res, done, target.kind, () => undoAssign(services, at, spans));
    } catch (err) {
      console.warn('[asignar] no se pudo', err);
      notify(tr('assign.failed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="lh-addwrap">
      <button
        className={`lh-tbtn rel-assign ${className ?? ''}`}
        disabled={busy}
        aria-expanded={open}
        data-tip={tr(target.kind === 'heading' ? 'assign.headingTip' : target.kind === 'everywhere' ? 'assign.everywhereTip' : 'assign.pendingTip')}
        onClick={() => setOpen(!open)}
      >
        {tr('assign.button')}
      </button>
      {open && <ScenePicker src={src} near={near} ep={ep} label={tr('assign.button')} onClose={() => setOpen(false)} onPick={(s) => void pick(s)} />}
    </span>
  );
}
