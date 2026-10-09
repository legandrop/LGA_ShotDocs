import type * as Y from 'yjs';
import type { PageDocs } from '../sync/docs';
import type { LocalDb } from '../sync/localDb';
import type { PageTree } from '../sync/tree';
import { findUnknownContent } from '../ui/unknownContent';
import { freshSync } from './createEntity';
import { readPointer, type MergeBlock } from './merge';
import { copyIntoDoc, planCopy, separatorBlock, separatorId, undoCopyInDoc, type CopyRecord } from './mergeWrite';
import { isArriving } from './prepareDay';

// El trabajo de *Merge* (E16, alcance reducido, C3): todo en el dispositivo que une, sin funciones nuevas en la base, en
// un orden fijo y repetible que queda anotado en el dispositivo (`meta`, `mergeJob:<B>`) para seguir si la app se cierra
// o se va la red a mitad:
//
//   guardas → mover las subpáginas de B a A → copiar B al final de A → A subida entera (`hasOwnUnsent(A)` en falso) →
//   los usos de las fotos copiadas confirmados en A → una última sincronización y volver a mirar (A viva y sin puntero,
//   B viva y sin unir, sin comentarios) → el puntero en B con el `seq` copiado → B a la papelera.
//
// B nunca va a la papelera antes de que A tenga todo en el servidor. Cada paso se puede repetir sin duplicar (mover lo que
// sigue en B, copiar si A no tiene el separador). Si en el último momento B tiene un comentario (C7), no se termina: A
// queda con la copia y B sigue viva y repetida, sin perder nada.

/** Cuánto se espera, como mucho, a que A suba entera y a que se confirmen los usos de sus fotos. */
export const MERGE_WAIT_MS = 8000;

export const JOB_PREFIX = 'mergeJob:';

export type MergeStep = 'started' | 'moved' | 'copied' | 'uploaded' | 'pointer';
const ORDER: MergeStep[] = ['started', 'moved', 'copied', 'uploaded', 'pointer'];
const after = (job: MergeJob, step: MergeStep) => ORDER.indexOf(job.step) >= ORDER.indexOf(step);

/** Lo que queda anotado en el dispositivo para seguir. */
export interface MergeJob {
  v: 1;
  /** La que se va (B) y la que queda (A). */
  from: string;
  into: string;
  projectId: string;
  /** El texto del título separador (en el idioma de la app al unir). */
  text: string;
  /**
   * Un id propio de esta unión: el del separador y los ids derivados salen de `B:nonce`, así retomar no duplica y unir
   * otra vez la misma página (restaurada y con algo nuevo) sí copia (D684).
   */
  nonce: string;
  /** Los ids de B que A ya tenía al empezar (van con un id derivado, C4). */
  remap: string[];
  /** Las subpáginas vivas de B, en su orden. */
  children: string[];
  /** B no agrega nada (D646): no se copia nada. */
  nothing: boolean;
  /**
   * Las fotos de B (las que la copia lleva a A), anotadas antes de copiar: confirmar sus usos en A no depende de qué
   * corrida copió (D687).
   */
  photos?: string[];
  /** El `seq` del contenido de B que se copió. */
  seq: number;
  step: MergeStep;
  copy?: CopyRecord;
  at: string;
}

export type MergeFailure = MergeBlock | 'perms' | 'arriving' | 'missing' | 'unknown' | 'unsent' | 'commentsUnknown' | 'merging';

export type MergeOutcome =
  | { status: 'done'; job: MergeJob }
  /** Se cortó (sin red, sin subir a tiempo): queda anotado y sigue solo al volver la red, o con *Finish*. */
  | { status: 'pending'; job: MergeJob }
  /** No se empezó: nada cambió. */
  | { status: 'blocked'; reason: MergeFailure }
  /** Se frenó antes de la papelera: A tiene la copia y B sigue viva (un comentario nuevo en B, A o B que ya no están). */
  | { status: 'stopped'; job: MergeJob; reason: 'comments' | 'into' | 'from' };

export interface MergeStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

export interface MergeDeps {
  tree: Pick<PageTree, 'get' | 'children' | 'move' | 'trash' | 'restore' | 'setSetting' | 'isTrashed' | 'hasUnsentCreate'>;
  docs: Pick<PageDocs, 'open' | 'close' | 'flush' | 'indexSnapshot' | 'hasOwnUnsent'>;
  engine: {
    syncNow(): Promise<void>;
    getStatus(): { online: boolean; lastSyncAt: number | null };
    isMissingContent(pageId: string): Promise<boolean>;
    prefetchPage(pageId: string, timeoutMs?: number): Promise<boolean>;
    syncMedia?(): Promise<void>;
  };
  /** Cuántos comentarios tiene la página en la base (cualquier estado) más los de este dispositivo sin subir; `null`: no se sabe. */
  comments(pageId: string): Promise<number | null>;
  /** Los archivos que la base tiene usados en la página; `null` si este dispositivo no lleva los usos de archivos. */
  uses(pageId: string): Promise<Set<string> | null>;
  store: MergeStore;
  /** Las guardas que se miran sin red (M1, M4, M8) con lo de ahora: `null` si se puede. */
  check(keep: string, gone: string): MergeFailure | null;
  /** Arma el separador (con el editor); las pruebas sin DOM pasan otro. */
  separator?: (text: string, id: string) => Y.XmlElement;
  waitMs?: number;
  /** Pruebas: corre después de anotar cada paso (cortar la app ahí). */
  afterStep?(step: MergeStep, job: MergeJob): void | Promise<void>;
}

const keyOf = (from: string) => `${JOB_PREFIX}${from}`;

/**
 * El candado de este dispositivo (D687): una sola corrida por página que se va, sea la del adelanto (`runMerge`), la del
 * vigía (`MergeResumer`) o *Finish*. Sin esto el vigía arrancaba, durante cada unión normal, una segunda corrida del mismo
 * trabajo (lo anotado no tenía la copia y no esperaba las fotos: B podía ir a la papelera sin sus usos en A, y avisaba
 * «B queda» con B ya en la papelera).
 */
const runningByDevice = new WeakMap<object, Map<string, Promise<MergeOutcome>>>();

/** Las corridas de un dispositivo (sus documentos: en las pruebas, varios dispositivos comparten el módulo). */
function runningOf(deps: Pick<MergeDeps, 'docs'>): Map<string, Promise<MergeOutcome>> {
  let map = runningByDevice.get(deps.docs);
  if (!map) runningByDevice.set(deps.docs, (map = new Map()));
  return map;
}

/** Una unión de esa página corre ahora en este dispositivo (*Pending* no ofrece *Finish* mientras tanto). */
export const isMergeRunning = (docs: object, from: string): boolean => runningOf({ docs } as Pick<MergeDeps, 'docs'>).has(from);

function locked(deps: Pick<MergeDeps, 'docs'>, from: string, run: () => Promise<MergeOutcome>): Promise<MergeOutcome> {
  const running = runningOf(deps);
  const job = run().finally(() => {
    running.delete(from);
    changed();
  });
  running.set(from, job);
  changed();
  return job;
}

/** La clave de la copia de una unión (de ella salen el id del separador y los derivados). */
export const copyKey = (job: Pick<MergeJob, 'from' | 'nonce'>) => `${job.from}:${job.nonce ?? ''}`;

// Quien muestra *Pending* se entera de los trabajos que empiezan y terminan.
const listeners = new Set<() => void>();
export function subscribeMergeJobs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = () => listeners.forEach((fn) => fn());

async function save(deps: MergeDeps, job: MergeJob, step?: MergeStep): Promise<void> {
  if (step) job.step = step;
  await deps.store.put(keyOf(job.from), job);
  changed();
  if (step) await deps.afterStep?.(step, job);
}

async function forget(deps: MergeDeps, job: MergeJob): Promise<void> {
  await deps.store.delete(keyOf(job.from));
  changed();
}

/** Los trabajos que quedaron a mitad en este dispositivo. */
export async function pendingMerges(store: MergeStore): Promise<MergeJob[]> {
  const out: MergeJob[] = [];
  for (const key of await store.keys(JOB_PREFIX)) {
    const job = (await store.get(key)) as MergeJob | undefined;
    if (job && job.v === 1 && typeof job.from === 'string' && typeof job.into === 'string') out.push(job);
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Une `gone` (B) en `keep` (A). */
export function runMerge(deps: MergeDeps, req: { keep: string; gone: string; projectId: string; text: string }): Promise<MergeOutcome> {
  // Tomado desde antes de la primera guarda: el vigía no puede empezar a mitad (D687).
  const running = runningOf(deps);
  if (running.has(req.gone) || running.has(req.keep)) return Promise.resolve({ status: 'blocked', reason: 'merging' });
  return locked(deps, req.gone, () => runMergeNow(deps, req));
}

async function runMergeNow(deps: MergeDeps, req: { keep: string; gone: string; projectId: string; text: string }): Promise<MergeOutcome> {
  const { keep, gone } = req;
  // Con red y una sincronización buena en el momento (D653): lo último de otro dispositivo tiene que estar acá.
  if (!(await freshSync(deps.engine))) return { status: 'blocked', reason: 'offline' };
  const reason = deps.check(keep, gone);
  if (reason) return { status: 'blocked', reason };
  if ((await deps.store.get(keyOf(gone))) || (await deps.store.get(keyOf(keep)))) return { status: 'blocked', reason: 'gone' };
  // M6: la que se va recién creada en otro dispositivo y todavía sin su contenido (D579): se copiaría nada y lo suyo
  // llegaría a la papelera. La que queda puede estar llegando: lo suyo se junta con la copia (Yjs, `mergeRootGroups`).
  if (await isArriving(deps, gone)) return { status: 'blocked', reason: 'arriving' };
  // M9: la que se va no tiene comentarios (ninguna fila, en cualquier estado). Se mira con la base.
  const comments = await deps.comments(gone);
  if (comments === null) return { status: 'blocked', reason: 'commentsUnknown' };
  if (comments > 0) return { status: 'blocked', reason: 'comments' };
  for (const id of [keep, gone]) {
    const missing = (await deps.engine.isMissingContent(id).catch(() => true)) && !(await deps.engine.prefetchPage(id, MERGE_WAIT_MS).catch(() => false));
    if (missing) return { status: 'blocked', reason: 'missing' };
  }
  // Lo de B escrito en este dispositivo, primero arriba (y en la copia).
  if (await deps.docs.hasOwnUnsent(gone)) {
    await deps.engine.syncNow().catch(() => undefined);
    if (await deps.docs.hasOwnUnsent(gone)) return { status: 'blocked', reason: 'unsent' };
  }
  const plan = await readPlan(deps, keep, gone);
  if (typeof plan === 'string') return { status: 'blocked', reason: plan };
  const job: MergeJob = {
    v: 1,
    from: gone,
    into: keep,
    projectId: req.projectId,
    text: req.text,
    nonce: crypto.randomUUID(),
    remap: plan.remap,
    children: deps.tree.children(gone).map((c) => c.id),
    nothing: plan.nothing,
    photos: plan.photos,
    seq: plan.seq,
    step: 'started',
    at: new Date().toISOString(),
  };
  await save(deps, job, 'started');
  return continueMerge(deps, job);
}

/** B leída sin abrirla en el editor (abrirla podría escribirle una reparación) y A abierta: qué copiar. */
async function readPlan(deps: MergeDeps, keep: string, gone: string): Promise<{ remap: string[]; nothing: boolean; photos: string[]; seq: number } | 'unknown' | 'missing'> {
  const b = await deps.docs.indexSnapshot(gone);
  try {
    if (findUnknownContent(b.doc)) return 'unknown';
    const seq = b.state?.cursor ?? 0;
    if ((deps.tree.get(gone)?.update_seq ?? 0) > seq) return 'missing';
    const a = await deps.docs.open(keep);
    try {
      if (findUnknownContent(a)) return 'unknown';
      return { ...planCopy(a, b.doc), seq };
    } finally {
      deps.docs.close(keep);
    }
  } finally {
    b.doc.destroy();
  }
}

/** Sigue un trabajo desde el paso que falte (también uno anotado de antes). */
export async function continueMerge(deps: MergeDeps, job: MergeJob): Promise<MergeOutcome> {
  const { tree } = deps;
  const wait = deps.waitMs ?? MERGE_WAIT_MS;
  if (!after(job, 'moved')) {
    // Las subpáginas de B al final de las de A, en su orden (D650). Lo que ya se movió no se mueve otra vez.
    for (const id of job.children) {
      const row = tree.get(id);
      if (row && row.parent_id === job.from && !row.deleted_at) await tree.move(id, job.into);
    }
    await save(deps, job, 'moved');
  }
  if (!after(job, 'copied')) {
    if (!job.nothing) {
      const b = await deps.docs.indexSnapshot(job.from);
      try {
        if (findUnknownContent(b.doc)) return stop(deps, job, 'from');
        const a = await deps.docs.open(job.into);
        try {
          if (findUnknownContent(a)) return stop(deps, job, 'into');
          const build = deps.separator ?? separatorBlock;
          const key = copyKey(job);
          const out = copyIntoDoc(a, b.doc, { from: key, remap: job.remap, separator: () => build(job.text, separatorId(key)) });
          if (typeof out !== 'string') {
            job.copy = out;
            job.photos = [...new Set([...(job.photos ?? []), ...out.photos])];
            job.seq = b.state?.cursor ?? job.seq;
          }
          await deps.docs.flush(job.into);
        } finally {
          deps.docs.close(job.into);
        }
      } finally {
        b.doc.destroy();
      }
    }
    await save(deps, job, 'copied');
  }
  if (!after(job, 'uploaded')) {
    // A entera en el servidor (C3): lo copiado no puede quedar solo en este dispositivo con B en la papelera.
    const end = Date.now() + wait;
    while (await deps.docs.hasOwnUnsent(job.into)) {
      if (Date.now() > end) return pending(deps, job);
      await deps.engine.syncNow().catch(() => undefined);
      if (await deps.docs.hasOwnUnsent(job.into)) await sleep(300);
    }
    // Los usos de las fotos copiadas, confirmados en A (`link_page_file`).
    const photos = job.nothing ? [] : (job.photos ?? job.copy?.photos ?? []);
    if (photos.length) {
      let uses = await deps.uses(job.into).catch(() => undefined);
      while (uses !== null && (uses === undefined || photos.some((p) => !uses!.has(p)))) {
        if (Date.now() > end) return pending(deps, job);
        await deps.engine.syncNow().catch(() => undefined);
        await deps.engine.syncMedia?.().catch(() => undefined);
        uses = await deps.uses(job.into).catch(() => undefined);
        if (uses && photos.some((p) => !uses!.has(p))) await sleep(300);
      }
    }
    await save(deps, job, 'uploaded');
  }
  if (!after(job, 'pointer')) {
    // La última mirada, con el árbol recién bajado.
    if (!(await freshSync(deps.engine))) return pending(deps, job);
    // Un puntero de antes de esta unión, en una página viva, no cuenta (una versión vieja la restauró: D684); uno nuevo
    // dice que otro dispositivo la está uniendo (a otra página, o A a otra).
    const fresh = (id: string) => {
      const p = readPointer(tree.get(id));
      return p && p.at > job.at ? p : null;
    };
    const into = tree.get(job.into);
    if (!into || tree.isTrashed(job.into) || fresh(job.into)) return stop(deps, job, 'into');
    const from = tree.get(job.from);
    const other = fresh(job.from);
    if (!from || tree.isTrashed(job.from) || (other && other.into !== job.into)) return stop(deps, job, 'from');
    // Una subpágina que sigue en B (el movimiento no llegó o lo deshizo otro): se mueve de nuevo y se sigue después.
    const left = job.children.filter((id) => tree.get(id)?.parent_id === job.from && !tree.get(id)?.deleted_at);
    if (left.length) {
      job.step = 'started';
      return pending(deps, job);
    }
    // C7: un comentario que apareció en el medio frena antes de la papelera.
    const comments = await deps.comments(job.from);
    if (comments === null) return pending(deps, job);
    if (comments > 0) return stop(deps, job, 'comments');
    await tree.setSetting(job.from, 'merged', { into: job.into, seq: job.seq, at: new Date().toISOString() });
    await save(deps, job, 'pointer');
  }
  // La papelera, recién ahora: A tiene todo en el servidor.
  if (!tree.isTrashed(job.from)) await tree.trash(job.from);
  await forget(deps, job);
  void deps.engine.syncNow().catch(() => undefined);
  return { status: 'done', job };
}

async function pending(deps: MergeDeps, job: MergeJob): Promise<MergeOutcome> {
  await save(deps, job);
  return { status: 'pending', job };
}

async function stop(deps: MergeDeps, job: MergeJob, reason: 'comments' | 'into' | 'from'): Promise<MergeOutcome> {
  console.warn('[unir] se frenó antes de la papelera', job.from, job.into, reason);
  await forget(deps, job);
  return { status: 'stopped', job, reason };
}

/** Sigue los trabajos que quedaron a mitad (al volver la red, al abrir la app o con *Finish*). Uno a la vez por página. */
export async function resumeMerges(deps: MergeDeps, only?: string): Promise<MergeOutcome[]> {
  const out: MergeOutcome[] = [];
  for (const job of await pendingMerges(deps.store)) {
    if (only && job.from !== only) continue;
    // Una corrida de esa página en curso (la del adelanto, otra del vigía): esta no corre ni avisa nada.
    if (runningOf(deps).has(job.from)) continue;
    const run = locked(deps, job.from, () => continueMerge(deps, job));
    out.push(await run.catch((err) => {
      console.warn('[unir] no se pudo seguir', job.from, err);
      return { status: 'pending', job } as MergeOutcome;
    }));
  }
  return out;
}

/**
 * *Undo* desde el aviso (C5): B vuelve de la papelera sin el puntero, sus subpáginas vuelven a B en su orden y de A sale
 * solo lo copiado que nadie tocó. Con red (lo de otro dispositivo tiene que estar acá antes de mirar). `kept`: bloques
 * copiados que quedaron en A porque alguien los tocó.
 */
export async function undoMerge(deps: Pick<MergeDeps, 'tree' | 'docs' | 'engine'>, job: MergeJob): Promise<{ status: 'undone'; kept: number } | { status: 'offline' | 'gone' }> {
  if (!(await freshSync(deps.engine))) return { status: 'offline' };
  const { tree } = deps;
  const from = tree.get(job.from);
  if (!from) return { status: 'gone' };
  if (from.deleted_at) await tree.restore(job.from);
  if (readPointer(from)) await tree.setSetting(job.from, 'merged', undefined);
  for (const id of job.children) {
    const row = tree.get(id);
    if (row && row.parent_id === job.into && !row.deleted_at) await tree.move(id, job.from);
  }
  let kept = 0;
  if (job.copy) {
    const a = await deps.docs.open(job.into);
    try {
      if (!findUnknownContent(a)) kept = undoCopyInDoc(a, job.copy).kept;
      await deps.docs.flush(job.into);
    } finally {
      deps.docs.close(job.into);
    }
  }
  void deps.engine.syncNow().catch(() => undefined);
  return { status: 'undone', kept };
}

/** Lo anotado de los trabajos, en la base local del dispositivo (`meta`). */
export function metaStore(db: Pick<LocalDb, 'get' | 'put' | 'delete' | 'getAllKeys'>): MergeStore {
  return {
    get: (key) => db.get('meta', key),
    put: async (key, value) => {
      await db.put('meta', value, key);
    },
    delete: (key) => db.delete('meta', key),
    keys: async (prefix) => (await db.getAllKeys('meta', IDBKeyRange.bound(prefix, `${prefix}\uffff`))).map(String),
  };
}

/** Las dependencias de *Merge* con los servicios de la app (o un dispositivo de las pruebas). */
export function mergeDepsFrom(
  s: {
    tree: MergeDeps['tree'];
    docs: MergeDeps['docs'];
    engine: MergeDeps['engine'];
    db: Pick<LocalDb, 'get' | 'put' | 'delete' | 'getAllKeys'>;
    media: { readonly tracksUsage: boolean; serverUses(pageIds: string[]): Promise<Map<string, Map<string, unknown>>> };
    comments: { pendingPageIds(): string[] };
  },
  o: { comments: { fetchComments(pageId: string): Promise<unknown[]> }; check: MergeDeps['check'] },
): MergeDeps {
  return {
    tree: s.tree,
    docs: s.docs,
    engine: s.engine,
    store: metaStore(s.db),
    check: o.check,
    comments: async (pageId) => {
      try {
        // Los de la base, también los borrados y resueltos (`comments_view` los trae a todos), y los de acá sin subir.
        const rows = await o.comments.fetchComments(pageId);
        return rows.length + (s.comments.pendingPageIds().includes(pageId) ? 1 : 0);
      } catch {
        return null;
      }
    },
    uses: async (pageId) => (s.media.tracksUsage ? new Set((await s.media.serverUses([pageId])).get(pageId)?.keys() ?? []) : null),
  };
}
