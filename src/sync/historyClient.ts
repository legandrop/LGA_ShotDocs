import type { HistoryRow } from './history';
import { HistoryCore, type HistoryCut, type RecoveryReply, type HistoryReply, type HistoryRequest, type HistorySummary, type VersionPayload } from './historyCore';
import type { VersionChanges } from './historyDiff';

// La pantalla del historial habla con esto (Docs/Doc_Historial.md, sección 8). Arma el historial en un Web Worker
// (history.worker.ts) y, si el navegador no deja crearlo, o su script no arranca, o se cae, lo arma en la página con
// el mismo código (`HistoryCore`): da lo mismo (lo comprueba historyClient.test.ts), solo que traba la pantalla
// mientras calcula. Al pasar a la página, vuelve a mandar las filas que ya tenía el Worker: no se pierde ningún pedido.

export interface HistoryEngine {
  /** Dónde se calcula ahora. */
  readonly kind: () => 'worker' | 'main';
  load(rows: HistoryRow[], pageId: string): Promise<HistorySummary>;
  /** Suma filas nuevas (el historial abierto que se actualiza solo). */
  append(rows: HistoryRow[]): Promise<HistorySummary>;
  /** Corta las sesiones en las versiones con nombre y las restauraciones (`versionBreaks`). */
  breaks(after: number[], before: number[]): Promise<HistorySummary>;
  /** La versión que termina en la fila `seq`. */
  version(seq: number): Promise<VersionPayload>;
  /** Sus cambios contra la anterior de la lista. */
  changes(seq: number): Promise<VersionChanges>;
  epoch(): string;
  recoverLine(liveUpdate: Uint8Array, scope: string, intent: number): Promise<RecoveryReply>;
  destroy(): void;
}

/** Lo que tiene que tener un Worker (para probar con uno falso). */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { preventDefault?: () => void; message?: string }) => void) | null;
  onmessageerror?: ((event: unknown) => void) | null;
}

/** Cuánto se espera que el Worker arranque (que baje su script) antes de calcular en la página. */
const READY_TIMEOUT_MS = 10_000;

function defaultWorker(): WorkerLike | null {
  if (typeof Worker === 'undefined') return null;
  return new Worker(new URL('./history.worker.ts', import.meta.url), { type: 'module', name: 'history' }) as unknown as WorkerLike;
}

interface Pending {
  id: number;
  req: HistoryRequest;
  resolve: (reply: HistoryReply) => void;
  reject: (err: Error) => void;
}

export function createHistoryEngine(makeWorker: () => WorkerLike | null = defaultWorker): HistoryEngine {
  let worker: WorkerLike | null = null;
  let core: HistoryCore | null = null;
  let nextId = 1;
  let destroyed = false;
  let generation = 0, revision = 0, confirmed: HistoryCut | null = null, acknowledged = -1;
  const pending = new Map<number, Pending>();
  /** Lo que armó el historial (cargar, sumar filas, los cortes), para volver a armarlo en la página si el Worker se cae. */
  const log: { id: number; req: HistoryRequest }[] = [];
  let readyTimer: ReturnType<typeof setTimeout> | null = null;

  const onMain = () => {
    if (core) return core;
    generation++;
    confirmed = null;
    core = new HistoryCore();
    if (worker) {
      try {
        worker.terminate();
      } catch {
        // ya cerrado
      }
      worker = null;
    }
    if (readyTimer) clearTimeout(readyTimer);
    // Lo que el Worker ya tenía (sin lo que todavía no contestó: eso se hace abajo, en orden).
    for (const entry of log) if (!pending.has(entry.id)) {
      const reply = core.handle(entry.req);
      if ('cut' in reply && reply.cut) confirmed = reply.cut;
    }
    const left = [...pending.values()].sort((a, b) => a.id - b.id);
    if (!left.some(p => p.req.op === 'load' || p.req.op === 'append' || p.req.op === 'breaks')) acknowledged = revision;
    pending.clear();
    for (const p of left) {
      if (p.req.op === 'recover-line') p.reject(new Error('selection_changed')); else run(p);
    }
    return core;
  };

  const run = (p: Pending) => {
    // En la página: un momento después, así la pantalla alcanza a dibujar "Cargando…".
    setTimeout(() => {
      if (destroyed) return p.reject(new Error('cancelled'));
      try {
        p.resolve(core!.handle(p.req));
      } catch (err) {
        p.reject(err instanceof Error ? err : new Error(String(err)));
      }
    }, 0);
  };

  try {
    worker = makeWorker();
  } catch {
    worker = null;
  }
  if (!worker) core = new HistoryCore();
  else {
    const w = worker;
    w.onmessage = (event) => {
      if (worker !== w || destroyed) return;
      const data = event.data as { ready?: boolean; id?: number; ok?: boolean; reply?: HistoryReply; error?: string };
      if (data.ready) {
        if (readyTimer) clearTimeout(readyTimer);
        readyTimer = null;
        return;
      }
      const p = data.id === undefined ? undefined : pending.get(data.id);
      if (!p) return;
      pending.delete(p.id);
      if (data.ok) p.resolve(data.reply!);
      else p.reject(new Error(data.error ?? 'history_failed'));
    };
    // El script no arrancó (sin red y sin guardar) o el Worker se cayó (falta de memoria): se sigue en la página.
    w.onerror = (event) => {
      event.preventDefault?.();
      if (!destroyed) onMain();
    };
    w.onmessageerror = () => {
      if (!destroyed) onMain();
    };
    readyTimer = setTimeout(() => {
      if (!destroyed && worker) onMain();
    }, READY_TIMEOUT_MS);
  }

  const send = <T extends HistoryReply>(req: HistoryRequest): Promise<T> => {
    if (destroyed) return Promise.reject(new Error('cancelled'));
    const id = nextId++;
    if (req.op === 'load' || req.op === 'append' || req.op === 'breaks') { revision++; confirmed = null; }
    const issued = revision, handle = generation;
    if (req.op === 'load' || req.op === 'append' || req.op === 'breaks') log.push({ id, req });
    return new Promise<T>((resolve, reject) => {
      const p: Pending = { id, req, resolve: resolve as (r: HistoryReply) => void, reject };
      if (core) return run(p);
      pending.set(id, p);
      try {
        worker!.postMessage({ id, req });
      } catch {
        onMain();
      }
    }).then(reply => {
      if (req.op === 'recover-line' && (handle !== generation || issued !== revision)) throw new Error('selection_changed');
      if ('cut' in reply && reply.cut && issued === revision && (handle === generation || req.op !== 'recover-line')) { confirmed = reply.cut; acknowledged = revision; }
      return reply;
    });
  };

  return {
    kind: () => (core ? 'main' : 'worker'),
    load: (rows, pageId) => {
      // Cargar de nuevo reemplaza todo: lo de antes ya no hace falta para volver a armarlo.
      log.length = 0;
      return send<HistorySummary>({ op: 'load', rows, pageId });
    },
    append: (rows) => send<HistorySummary>({ op: 'append', rows }),
    breaks: (after, before) => send<HistorySummary>({ op: 'breaks', after, before }),
    version: (seq) => send<VersionPayload>({ op: 'version', seq }),
    changes: (seq) => send<VersionChanges>({ op: 'changes', seq }),
    epoch: () => `${generation}:${revision}:${acknowledged}:${confirmed?.generation ?? ''}:${confirmed?.revision ?? -1}`,
    recoverLine: (liveUpdate, scope, intent) => confirmed && acknowledged === revision
      ? send<RecoveryReply>({ op: 'recover-line', liveUpdate: liveUpdate.slice(), scope, intent, cut: { ...confirmed, snapshot: confirmed.snapshot.slice() } })
      : Promise.reject(new Error('history_pending')),
    destroy: () => {
      destroyed = true;
      generation++;
      confirmed = null;
      if (readyTimer) clearTimeout(readyTimer);
      for (const p of pending.values()) p.reject(new Error('cancelled'));
      pending.clear();
      worker?.terminate();
      worker = null;
      core?.destroy();
      core = null;
    },
  };
}
