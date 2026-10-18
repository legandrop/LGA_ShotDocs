// Entrada del Worker. Lo guardado (la conexión con el Drive del dueño, las subidas en curso) vive en un solo
// Durable Object con almacenamiento SQLite, que el plan gratis de Workers incluye: no hace falta crear
// nada a mano en Cloudflare. Toda la lógica está en core.ts.
import { DurableObject } from 'cloudflare:workers';
import { LockTable, Portero, type Env as PorteroEnv, type LockRow, type Store as PorteroStore } from './core';
export { NvidiaRequestOwner } from './nvidiaRequestOwner';

/** Las claves de los candados en el almacenamiento del objeto (ninguna clave del portero empieza así). */
const LOCK_PREFIX = 'candado:';

export class Store extends DurableObject {
  async read(key: string): Promise<unknown> {
    return this.ctx.storage.get(key);
  }

  async write(key: string, value: unknown): Promise<void> {
    await this.ctx.storage.put(key, value);
  }

  async remove(key: string): Promise<void> {
    await this.ctx.storage.delete(key);
  }

  /**
   * El candado entre instancias del Worker (v0.264, `LockTable` en core.ts), guardado en el almacenamiento del objeto
   * con la API KV sincrónica de SQLite (claves `candado:<clave>`): sobrevive a que el objeto hiberne, se desaloje o se
   * reinicie con una publicación (la memoria se descarta). Métodos nuevos de la misma clase, que ya es SQLite desde su
   * migración `v1`: no hace falta ninguna migración.
   */
  private readonly locks = new LockTable({
    get: (key) => this.ctx.storage.kv.get(`${LOCK_PREFIX}${key}`) as LockRow | undefined,
    put: (key, row) => this.ctx.storage.kv.put(`${LOCK_PREFIX}${key}`, row),
    delete: (key) => void this.ctx.storage.kv.delete(`${LOCK_PREFIX}${key}`),
    list: () =>
      [...this.ctx.storage.kv.list({ prefix: LOCK_PREFIX })].map(([key, row]) => [key.slice(LOCK_PREFIX.length), row as LockRow]),
  });

  async claim(key: string, holder: string, staleMs: number): Promise<boolean> {
    return this.locks.claim(key, holder, staleMs);
  }

  async release(key: string, holder: string): Promise<void> {
    this.locks.release(key, holder);
  }
}

interface Env extends PorteroEnv {
  STORE: DurableObjectNamespace<Store>;
  NVIDIA_REQUESTS: DurableObjectNamespace<unknown>;
}

/**
 * La llave de lo que el portero recuerda en la memoria de la instancia (las subcarpetas ya comprobadas de una
 * carpeta, P.9): la misma para todos los pedidos. El stub del Durable Object, en cambio, se crea en cada pedido:
 * en Cloudflare queda atado al pedido que lo creó y usarlo desde otro tira "Cannot perform I/O on behalf of a
 * different request" (un 500 desde el segundo pedido de la instancia).
 */
const memoryKey = {};

function storeFor(env: Env): PorteroStore {
  const stub = env.STORE.get(env.STORE.idFromName('main'));
  return {
    memoryKey,
    get: async <T>(key: string) => (await stub.read(key)) as T | undefined,
    put: (key, value) => stub.write(key, value),
    delete: (key) => stub.remove(key),
    claim: (key, holder, staleMs) => stub.claim(key, holder, staleMs),
    release: (key, holder) => stub.release(key, holder),
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return new Portero(env, storeFor(env)).handle(req);
  },
};
