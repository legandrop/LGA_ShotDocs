import { generateKeyBetween } from 'fractional-indexing';
import type { LocalDb } from './localDb';
import type { FailedOp, PagePatch, PageRow, QueuedOp, TreeOp } from './types';

export function compareSiblings(a: PageRow, b: PageRow): number {
  if (a.sort_key !== b.sort_key) return a.sort_key < b.sort_key ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Clave entre dos vecinos. Si dos dispositivos generaron la misma clave, igual devuelve una válida. */
export function keyBetween(before: string | null, after: string | null): string {
  try {
    return generateKeyBetween(before, after);
  } catch {
    return generateKeyBetween(before, null);
  }
}

function applyOp(pages: Map<string, PageRow>, op: TreeOp, now: string): void {
  if (op.kind === 'create') {
    if (pages.has(op.page.id)) return;
    pages.set(op.page.id, {
      ...op.page,
      icon: null,
      update_seq: 0,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    });
  } else {
    const current = pages.get(op.id);
    if (current) pages.set(op.id, { ...current, ...op.patch, updated_at: now });
  }
}

/**
 * El árbol que se ve es la última copia que mandó el servidor más los cambios locales que todavía están
 * en la cola de salida. Cuando el servidor confirma un cambio, sale de la cola y pasa a la copia.
 */
export class PageTree {
  private snapshot = new Map<string, PageRow>();
  private ops: QueuedOp[] = [];
  private failed: FailedOp[] = [];
  private view = new Map<string, PageRow>();
  private childrenIndex = new Map<string | null, PageRow[]>();
  private listeners = new Set<() => void>();
  private revision = 0;

  /** Se llama cuando entra un cambio local a la cola. */
  onQueued?: () => void;

  constructor(
    private readonly db: LocalDb,
    readonly workspaceId: string,
  ) {}

  async load(): Promise<void> {
    const [rows, ops, failed] = await Promise.all([
      this.db.getAll('pages'),
      this.db.getAll('ops'),
      this.db.getAll('failedOps'),
    ]);
    this.snapshot = new Map(rows.filter((r) => r.workspace_id === this.workspaceId).map((r) => [r.id, r]));
    this.ops = ops;
    this.failed = failed;
    this.recompute();
  }

  // --- lectura -------------------------------------------------------------------------------------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getRevision = (): number => this.revision;

  get(id: string): PageRow | undefined {
    return this.view.get(id);
  }

  /** Hijas de una página (o raíces con `null`), ordenadas. Sin las que están en la papelera. */
  children(parentId: string | null): PageRow[] {
    return (this.childrenIndex.get(parentId) ?? []).filter((p) => !p.deleted_at);
  }

  /** Está en la papelera ella o alguno de sus ancestros. */
  isTrashed(id: string): boolean {
    for (let p = this.view.get(id); p; p = p.parent_id ? this.view.get(p.parent_id) : undefined) {
      if (p.deleted_at) return true;
    }
    return false;
  }

  /** Páginas enviadas a la papelera directamente (no las que están adentro de otra borrada). */
  trashed(): PageRow[] {
    return [...this.view.values()]
      .filter((p) => p.deleted_at && !(p.parent_id && this.isTrashed(p.parent_id)))
      .sort((a, b) => (a.deleted_at! < b.deleted_at! ? 1 : -1));
  }

  /** De la raíz hasta la página, sin incluirla. */
  ancestors(id: string): PageRow[] {
    const out: PageRow[] = [];
    const seen = new Set<string>();
    for (let p = this.view.get(id); p?.parent_id && !seen.has(p.parent_id); ) {
      seen.add(p.parent_id);
      p = this.view.get(p.parent_id);
      if (p) out.unshift(p);
    }
    return out;
  }

  isDescendant(id: string, ofId: string): boolean {
    return this.ancestors(id).some((p) => p.id === ofId);
  }

  pendingOps(): QueuedOp[] {
    return [...this.ops];
  }

  failedOps(): FailedOp[] {
    return [...this.failed];
  }

  hasPendingCreate(pageId: string): boolean {
    return this.ops.some((o) => o.op.kind === 'create' && o.op.page.id === pageId);
  }

  // --- cambios locales -----------------------------------------------------------------------------

  async create(parentId: string | null, title = ''): Promise<string> {
    const siblings = this.childrenIndex.get(parentId) ?? [];
    const last = siblings.at(-1)?.sort_key ?? null;
    const id = crypto.randomUUID();
    await this.enqueue({
      kind: 'create',
      page: { id, workspace_id: this.workspaceId, parent_id: parentId, title, sort_key: keyBetween(last, null) },
    });
    return id;
  }

  async rename(id: string, title: string): Promise<void> {
    if (this.view.get(id)?.title === title) return;
    await this.enqueue({ kind: 'update', id, patch: { title } });
  }

  /** Mueve `id` adentro de `parentId`, en la posición `index` entre sus hermanas (al final si falta). */
  async move(id: string, parentId: string | null, index?: number): Promise<void> {
    if (parentId === id || (parentId && this.isDescendant(parentId, id))) {
      throw new Error('Una página no puede ir adentro de sí misma.');
    }
    const siblings = (this.childrenIndex.get(parentId) ?? []).filter((p) => p.id !== id);
    const at = Math.max(0, Math.min(index ?? siblings.length, siblings.length));
    const sortKey = keyBetween(siblings[at - 1]?.sort_key ?? null, siblings[at]?.sort_key ?? null);
    await this.enqueue({ kind: 'update', id, patch: { parent_id: parentId, sort_key: sortKey } });
  }

  async trash(id: string): Promise<void> {
    await this.enqueue({ kind: 'update', id, patch: { deleted_at: new Date().toISOString() } });
  }

  async restore(id: string): Promise<void> {
    await this.enqueue({ kind: 'update', id, patch: { deleted_at: null } });
  }

  async setPatch(id: string, patch: PagePatch): Promise<void> {
    await this.enqueue({ kind: 'update', id, patch });
  }

  private async enqueue(op: TreeOp): Promise<void> {
    const queued: QueuedOp = { opId: crypto.randomUUID(), op, createdAt: Date.now() };
    queued.seq = await this.db.add('ops', queued);
    this.ops.push(queued);
    this.recompute();
    this.onQueued?.();
  }

  // --- sincronización ------------------------------------------------------------------------------

  /** El servidor confirmó el cambio: sale de la cola y queda en la copia local. */
  async ackOp(op: QueuedOp): Promise<void> {
    applyOp(this.snapshot, op.op, new Date().toISOString());
    const tx = this.db.transaction(['ops', 'pages'], 'readwrite');
    await tx.objectStore('ops').delete(op.seq!);
    const row =
      op.op.kind === 'create' ? this.snapshot.get(op.op.page.id) : this.snapshot.get(op.op.id);
    if (row) await tx.objectStore('pages').put(row);
    await tx.done;
    this.ops = this.ops.filter((o) => o.seq !== op.seq);
    this.recompute();
  }

  /** El servidor rechazó el cambio para siempre (por ejemplo, un movimiento que armaba un ciclo). */
  async failOp(op: QueuedOp, error: string): Promise<void> {
    const failed: FailedOp = { op: op.op, error, failedAt: Date.now() };
    const tx = this.db.transaction(['ops', 'failedOps'], 'readwrite');
    await tx.objectStore('ops').delete(op.seq!);
    failed.seq = await tx.objectStore('failedOps').add(failed);
    await tx.done;
    this.ops = this.ops.filter((o) => o.seq !== op.seq);
    this.failed.push(failed);
    this.recompute();
  }

  async dismissFailed(): Promise<void> {
    await this.db.clear('failedOps');
    this.failed = [];
    this.recompute();
  }

  /** Reemplaza la copia local por el árbol completo que mandó el servidor. */
  async setSnapshot(rows: PageRow[]): Promise<void> {
    const tx = this.db.transaction('pages', 'readwrite');
    await tx.store.clear();
    await Promise.all(rows.map((r) => tx.store.put(r)));
    await tx.done;
    this.snapshot = new Map(rows.map((r) => [r.id, r]));
    this.recompute();
  }

  private recompute(): void {
    const view = new Map(this.snapshot);
    const now = new Date().toISOString();
    for (const op of this.ops) applyOp(view, op.op, now);

    const children = new Map<string | null, PageRow[]>();
    for (const page of view.values()) {
      // Una página cuyo padre no existe (todavía) se muestra en la raíz para no perderla de vista.
      const parent = page.parent_id && view.has(page.parent_id) ? page.parent_id : null;
      const list = children.get(parent);
      if (list) list.push(page);
      else children.set(parent, [page]);
    }
    for (const list of children.values()) list.sort(compareSiblings);

    this.view = view;
    this.childrenIndex = children;
    this.revision++;
    for (const fn of this.listeners) fn();
  }
}
