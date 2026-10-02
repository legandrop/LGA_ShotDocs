// Un Supabase falso para la tabla `assistant_key_sync`, solo para las pruebas (no lo importa la app): la misma forma
// de consulta que usa keySyncRemote.ts y lo que hace la base (migración 20261023120000_clave_sincronizada.sql): cada
// sesión ve y cambia solo su fila, el id lo pone la base, el trigger sube `generation` y la hora, y la base sin la
// tabla o sin red contestan como las de verdad. Varios "dispositivos" comparten un `KeySyncStore`.

export interface StoredRow {
  user_id: string;
  format: number;
  salt: string;
  iv: string;
  ciphertext: string;
  generation: number;
  updated_at: string;
  /** Lo que un dueño malicioso agregue a mano (las pruebas de los mutantes). */
  [extra: string]: unknown;
}

export class KeySyncStore {
  rows = new Map<string, StoredRow>();
  online = true;
  /** Una base sin la migración. */
  missing = false;
  /** Se llama justo antes de cada escritura (para simular otro dispositivo que escribe en el medio). */
  beforeWrite?: () => void;
  /** La política del asistente del workspace (`workspace_settings.assistant_policy`). */
  policy: 'on' | 'local_only' | 'off' = 'on';
  /** Todo lo que salió hacia la base, tal cual (para buscar texto en claro). */
  sent: string[] = [];
  private clock = 0;

  now(): string {
    this.clock += 1;
    return new Date(Date.UTC(2026, 9, 2, 12, 0, this.clock)).toISOString();
  }

  /** El cliente de una sesión (la persona `userId`). */
  client(userId: string): FakeKeySyncClient {
    return new FakeKeySyncClient(this, userId);
  }
}

type Err = { code?: string; message: string } | null;
type Res = { data: unknown; error: Err };

const COLUMNS = new Set(['format', 'salt', 'iv', 'ciphertext']);

class Query implements PromiseLike<Res> {
  private filters: [string, unknown][] = [];
  private returning: string[] | null = null;
  private mode: 'many' | 'maybe' | 'single' = 'many';

  constructor(
    private store: KeySyncStore,
    private userId: string,
    private op: 'select' | 'insert' | 'update' | 'delete',
    private values: Record<string, unknown> | null,
    columns?: string,
  ) {
    if (columns) this.returning = columns.split(',').map((c) => c.trim());
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }
  select(columns: string): this {
    this.returning = columns.split(',').map((c) => c.trim());
    return this;
  }
  maybeSingle(): this {
    this.mode = 'maybe';
    return this;
  }
  single(): this {
    this.mode = 'single';
    return this;
  }

  then<A = Res, B = never>(ok?: ((v: Res) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.execute())
      .then(ok, fail);
  }

  private pick(row: StoredRow): Record<string, unknown> {
    if (!this.returning || this.returning.includes('*')) return { ...row };
    return Object.fromEntries(this.returning.map((c) => [c, row[c]]));
  }

  private shape(rows: StoredRow[]): Res {
    const out = rows.map((r) => this.pick(r));
    if (this.mode === 'many') return { data: out, error: null };
    if (out.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows' } };
    if (this.mode === 'single' && out.length === 0) return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    return { data: out[0] ?? null, error: null };
  }

  /** Las filas que ve esta sesión (Row Level Security: solo la suya) y que pasan los filtros. */
  private visible(): StoredRow[] {
    const mine = this.store.rows.get(this.userId);
    if (!mine) return [];
    return this.filters.every(([c, v]) => mine[c] === v) ? [mine] : [];
  }

  private execute(): Res {
    const s = this.store;
    if (this.values) s.sent.push(JSON.stringify(this.values));
    s.sent.push(JSON.stringify(this.filters));
    if (!s.online) throw new TypeError('Failed to fetch');
    if (s.missing) return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.assistant_key_sync' in the schema cache" } };
    if (this.op !== 'select') s.beforeWrite?.();
    if (this.values && Object.keys(this.values).some((k) => !COLUMNS.has(k))) {
      return { data: null, error: { code: '42501', message: 'permission denied for table assistant_key_sync' } };
    }
    switch (this.op) {
      case 'select':
        return this.shape(this.visible());
      case 'insert': {
        if (s.rows.has(this.userId)) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        const row = { ...(this.values as object), user_id: this.userId, generation: 1, updated_at: s.now() } as StoredRow;
        s.rows.set(this.userId, row);
        return this.shape([row]);
      }
      case 'update': {
        const hit = this.visible();
        for (const r of hit) {
          const next = { ...r, ...(this.values as object), user_id: r.user_id, generation: r.generation + 1, updated_at: s.now() } as StoredRow;
          s.rows.set(r.user_id, next);
        }
        return this.shape(hit.map((r) => s.rows.get(r.user_id)!));
      }
      case 'delete': {
        const hit = this.visible();
        for (const r of hit) s.rows.delete(r.user_id);
        return { data: null, error: null };
      }
    }
  }
}

export class FakeKeySyncClient {
  readonly auth = {
    signOutCalls: [] as unknown[],
    signOut: async (options?: unknown) => {
      this.auth.signOutCalls.push(options);
      return { error: null };
    },
  };

  constructor(
    readonly store: KeySyncStore,
    readonly userId: string,
  ) {}

  from(table: string) {
    if (table === 'workspace_settings') {
      return { select: () => ({ maybeSingle: async () => ({ data: { assistant_policy: this.store.policy }, error: null }) }) };
    }
    if (table !== 'assistant_key_sync') throw new Error(`tabla inesperada: ${table}`);
    return {
      select: (columns: string) => new Query(this.store, this.userId, 'select', null, columns),
      insert: (values: Record<string, unknown>) => new Query(this.store, this.userId, 'insert', values),
      update: (values: Record<string, unknown>) => new Query(this.store, this.userId, 'update', values),
      delete: () => new Query(this.store, this.userId, 'delete', null),
    };
  }
}
