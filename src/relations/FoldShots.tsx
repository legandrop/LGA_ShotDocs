import { useRef, useState, useSyncExternalStore } from 'react';
import { useT, type Translate } from '../i18n';
import { usePermissions, useServices, useTree, type Services } from '../services';
import type { Permissions } from '../sync/access';
import { getPublicLink } from '../sync/publicLinks';
import { notify } from '../ui/notice';
import { useCurrentProject } from '../ui/project';
import { existingRelationsSession } from '../ui/relationsUi';
import { sceneLive, type LiveSource, type SceneLive } from './liveView';
import { canMergeWith, depsFor, PendingRow } from './MergeAction';
import type { MergeFailure, MergeOutcome } from './mergeJob';

// *Bring shots into this page* (Docs/Doc_Relaciones.md, sección 23; D785, D786): las fichas que una escena tiene como
// subpáginas (lo que dejó la importación de una tabla de Coda) entran en la página de la escena, una debajo de la otra,
// cada una con su título 2 adentro de un título 1 «Planos». Cada ficha pasa por *Merge* (`runFold`): las mismas guardas, la
// copia en una transacción, la escena subida entera y los usos de las fotos confirmados antes de que la ficha vaya a la
// papelera, con un puntero al plano (un link a la ficha lleva ahí). Una ficha con comentarios, o compartida aparte, queda
// como está. Desde la cabecera de la escena (sus fichas) y desde *Overview › Pending* (todas las escenas del proyecto).

export interface FoldCard {
  pageId: string;
  /** El título 2 del plano. */
  title: string;
}

export interface FoldTally {
  done: number;
  /** Quedaron como subpáginas: con comentarios, compartidas aparte, o por otra guarda. */
  comments: number;
  shared: number;
  other: number;
  /** Empezaron y siguen solas al volver la red (o con *Finish* en *Pending*). */
  pending: number;
}

const emptyTally = (): FoldTally => ({ done: 0, comments: 0, shared: 0, other: 0, pending: 0 });

/**
 * Las fichas que se traen (`keep`: hijas directas de la escena y no un documento marcado, `foldable`) con el título de su
 * plano: el título entero de la ficha (lo que dice y no está adentro no se pierde), o el nombre del plano si no tiene; si se
 * repite (en Coda, las sub-filas de un plano llevan el mismo nombre) o ya está adentro de la página, «· 2», «· 3».
 */
export function foldCards(v: SceneLive, keep: (pageId: string) => boolean = () => true): FoldCard[] {
  const used = new Map<string, number>();
  for (const s of v.shots) if (s.pageId === v.pageId) used.set(s.title, (used.get(s.title) ?? 0) + 1);
  const out: FoldCard[] = [];
  for (const c of v.cards) {
    if (!keep(c.pageId)) continue;
    const base = c.title.trim() || v.shots.find((s) => s.pageId === c.pageId)?.title || c.title;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    out.push({ pageId: c.pageId, title: n > 1 ? `${base} · ${n}` : base });
  }
  return out;
}

/**
 * Se puede traer: una subpágina directa de la escena que no es un documento de una etapa (un reporte de prueba, un scouting
 * o un plan adentro de la escena siguen en su renglón). Las subpáginas de una ficha suben a la escena con ella y no se traen
 * en la misma corrida (la lista se arma al empezar).
 */
export function foldable(services: Pick<Services, 'tree'>, snap: LiveSource['snap'] | null | undefined, scene: string) {
  return (pageId: string) => services.tree.get(pageId)?.parent_id === scene && !snap?.registration.roles.get(pageId)?.doc;
}

/** La ficha está directamente adentro de la escena; las dos vivas; quien lo hace puede unir las dos (M1); con red. */
function foldCheck(services: Services, canMerge: (id: string) => boolean) {
  return (scene: string, card: string): MergeFailure | null => {
    const { tree } = services;
    if (scene === card || !tree.get(scene) || !tree.get(card) || tree.isTrashed(scene) || tree.isTrashed(card)) return 'gone';
    if (tree.get(card)!.parent_id !== scene) return 'gone';
    if (!canMerge(scene) || !canMerge(card)) return 'perms';
    const sync = services.engine.getStatus();
    if (!sync.online || sync.lastSyncAt === null) return 'offline';
    return null;
  };
}

/**
 * La ficha tiene permisos propios o un link público propio: alguien la ve sin ver la escena, y adentro de la escena dejaría de
 * verla. Queda como subpágina. Sin poder saberlo, tampoco.
 */
async function sharedApart(services: Services, card: string): Promise<boolean> {
  try {
    const [rows, link] = await Promise.all([services.remote.listAccess({ pageId: card }), getPublicLink(services.client, card)]);
    return rows.some((r) => r.source === 'page') || !!link?.link;
  } catch {
    return true;
  }
}

/** Las fichas de una escena, una por una y en orden (los planos quedan en el orden del árbol). */
export async function foldScene(
  services: Services,
  perms: Pick<Permissions, 'canManagePage' | 'role' | 'viaLink'>,
  req: { projectId: string; scene: string; cards: FoldCard[]; shots: string },
  onCard?: (done: number) => void,
  stop?: () => boolean,
): Promise<FoldTally> {
  const tally = emptyTally();
  const deps = await depsFor(services, foldCheck(services, canMergeWith(perms, services)));
  const { runFold, resumeMerges } = await import('./mergeJob');
  let i = 0;
  for (const card of req.cards) {
    if (stop?.()) break;
    if (await sharedApart(services, card.pageId)) tally.shared++;
    else {
      let out: MergeOutcome = await runFold(deps, { scene: req.scene, card: card.pageId, projectId: req.projectId, title: card.title, shots: req.shots }).catch((err) => {
        console.warn('[planos] no se pudo traer la ficha', card.pageId, err);
        return { status: 'blocked', reason: 'unknown' } as const;
      });
      // La escena no terminó de subir (o de confirmar sus fotos) a tiempo: se sigue desde ese paso, unas veces más, antes
      // de pasar a la próxima (si no, quedaría para *Finish*). Lo copiado no se repite.
      for (let again = 0; out.status === 'pending' && again < 3 && !stop?.(); again++) {
        out = (await resumeMerges(deps, card.pageId).catch(() => []))[0] ?? out;
      }
      console.info('[planos] resultado', card.pageId, out.status, 'reason' in out ? out.reason : '', 'job' in out ? out.job.step : '');
      if (out.status === 'done') tally.done++;
      else if (out.status === 'pending') tally.pending++;
      else if (out.status === 'stopped') tally[out.reason === 'comments' ? 'comments' : 'other']++;
      else tally[out.reason === 'comments' ? 'comments' : 'other']++;
      // Sin red, las que siguen tampoco van a poder: se corta acá.
      if (out.status === 'blocked' && out.reason === 'offline') break;
    }
    onCard?.(++i);
  }
  return tally;
}

/** El aviso de cómo salió: cuántas entraron y por qué quedaron las otras. */
export function foldNotice(tr: Translate, t: FoldTally, total: number): void {
  const parts = [t.done ? tr('fold.done', { count: t.done }) : tr('fold.noneDone')];
  if (t.comments) parts.push(tr('fold.stayedComments', { count: t.comments }));
  if (t.shared) parts.push(tr('fold.stayedShared', { count: t.shared }));
  if (t.pending) parts.push(tr('fold.pending', { count: t.pending }));
  const other = total - t.done - t.comments - t.shared - t.pending;
  if (other > 0) parts.push(tr('fold.stayedOther', { count: other }));
  notify(parts.join(' · '));
}

/** El renglón de la cabecera de la escena: «3 shots are subpages · Bring them into this page». */
export function FoldShotsLine({ v, sceneId }: { v: SceneLive; sceneId: string }) {
  const tr = useT();
  const services = useServices();
  const perms = usePermissions();
  const projectId = useCurrentProject();
  const [state, setState] = useState<'idle' | 'confirm' | 'running'>('idle');
  const [done, setDone] = useState(0);
  const snap = existingRelationsSession(services)?.relations.snapshot(projectId);
  const list = foldCards(v, foldable(services, snap, sceneId));
  const n = list.length;
  if (!n || !canMergeWith(perms, services)(sceneId)) return null;
  const run = async () => {
    setState('running');
    setDone(0);
    try {
      const cards = list;
      const t = await foldScene(services, perms, { projectId, scene: sceneId, cards, shots: tr('fold.shotsHeading') }, setDone);
      foldNotice(tr, t, cards.length);
    } finally {
      setState('idle');
    }
  };
  return (
    <div className="lh-fold" role="group" aria-label={tr('fold.aria')}>
      {state === 'running' ? (
        <span>{tr('fold.running', { done, count: n })}</span>
      ) : state === 'confirm' ? (
        <>
          <span>{tr('fold.confirm', { count: n })}</span>
          <span className="lh-fold-act">
            <button className="lh-tbtn primary" onClick={() => void run()}>
              {tr('fold.go')}
            </button>
            <button className="lh-tbtn" onClick={() => setState('idle')}>
              {tr('common.cancel')}
            </button>
          </span>
        </>
      ) : (
        <>
          <span>{tr('fold.line', { count: n })}</span>
          <span className="lh-fold-act">
            <button className="lh-tbtn" onClick={() => setState('confirm')} data-tip={tr('fold.tip')}>
              {tr('fold.bring')}
            </button>
          </span>
        </>
      )}
    </div>
  );
}

/** Las escenas del proyecto que tienen fichas como subpáginas directas: la escena y sus fichas, en el orden del árbol. */
function scenesWithCards(src: LiveSource, tree: Pick<Services['tree'], 'get'>): { code: string; pageId: string; cards: number }[] {
  const by = new Map<string, { code: string; pageId: string; cards: number }>();
  for (const [id, role] of src.snap.registration.roles) {
    const ref = role.partOf?.kind === 'scene' ? role.partOf.ref : null;
    if (role.excluded || role.doc || !ref) continue;
    const scene = src.snap.registry.scenes.get(ref);
    if (!scene?.pageId || tree.get(id)?.parent_id !== scene.pageId || src.title(id) === undefined) continue;
    const e = by.get(scene.pageId) ?? { code: ref, pageId: scene.pageId, cards: 0 };
    e.cards++;
    by.set(scene.pageId, e);
  }
  return [...by.values()];
}

/**
 * *Overview › Pending*: «N scenes still have their shots as subpages · Bring them all in» (D786). Solo dueño o admin. Va
 * escena por escena (cada una, ficha por ficha); se puede parar entre una ficha y la otra.
 */
export function FoldPendingRow() {
  const tr = useT();
  const services = useServices();
  const tree = useTree();
  const perms = usePermissions();
  const projectId = useCurrentProject();
  const session = existingRelationsSession(services);
  const revision = useSyncExternalStore(session?.relations.subscribe ?? noSub, session?.relations.getRevision ?? zero);
  const [run, setRun] = useState<{ scenes: number; at: number; done: number } | null>(null);
  // Parar: lo lee el bucle entre ficha y ficha (la ficha que está entrando termina).
  const stopRef = useRef(false);
  void revision;
  const snap = session?.relations.snapshot(projectId);
  if (!session || !snap || (perms.role !== 'owner' && perms.role !== 'admin')) return null;
  const src: LiveSource = { snap, title: (id) => tree.get(id)?.title, content: (id) => session.index.content(id) };
  const list = scenesWithCards(src, tree);
  if (!list.length && !run) return null;
  const total = list.reduce((n, s) => n + s.cards, 0);
  const start = async () => {
    const state = { scenes: list.length, at: 0, done: 0 };
    stopRef.current = false;
    setRun({ ...state });
    const sum = emptyTally();
    let cards = 0;
    try {
      for (const s of list) {
        if (stopRef.current) break;
        // Lo leído al momento de cada escena (la anterior ya cambió el índice).
        const now = session.relations.snapshot(projectId);
        if (!now) break;
        const v = sceneLive({ snap: now, title: (id) => tree.get(id)?.title, content: (id) => session.index.content(id) }, s.code);
        if (v.pageId !== s.pageId) continue;
        const fc = foldCards(v, foldable(services, now, s.pageId));
        cards += fc.length;
        const t = await foldScene(services, perms, { projectId, scene: s.pageId, cards: fc, shots: tr('fold.shotsHeading') }, undefined, () => stopRef.current);
        for (const k of Object.keys(sum) as (keyof FoldTally)[]) sum[k] += t[k];
        state.at++;
        state.done = sum.done;
        setRun({ ...state });
        if (!services.engine.getStatus().online) break;
      }
    } finally {
      setRun(null);
      foldNotice(tr, sum, cards);
    }
  };
  return (
    <PendingRow
      head={<span>{run ? tr('fold.allRunning', { at: run.at, scenes: run.scenes, count: run.done }) : tr('fold.allRow', { scenes: list.length, count: total })}</span>}
      actions={
        run ? (
          <button className="mp-btn" onClick={() => (stopRef.current = true)}>
            {tr('fold.stop')}
          </button>
        ) : (
          <button className="mp-btn" data-tip={tr('fold.allTip')} onClick={() => void start()}>
            {tr('fold.bringAll')}
          </button>
        )
      }
    />
  );
}

const noSub = () => () => undefined;
const zero = () => 0;
