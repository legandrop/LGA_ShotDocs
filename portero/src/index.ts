// Entrada del Worker. Lo guardado (la conexión con el Drive del dueño, las subidas en curso) vive en un solo
// Durable Object con almacenamiento SQLite, que el plan gratis de Workers incluye: no hace falta crear
// nada a mano en Cloudflare. Toda la lógica está en core.ts.
import { DurableObject } from 'cloudflare:workers';
import { Portero, type Env as PorteroEnv, type Store as PorteroStore } from './core';

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
}

interface Env extends PorteroEnv {
  STORE: DurableObjectNamespace<Store>;
}

/**
 * El mismo `Store` para todos los pedidos de la instancia: lo que el portero recuerda en memoria (las subcarpetas
 * ya comprobadas de una carpeta, P.9) va por `Store`. Lo guardado vive siempre en el Durable Object.
 */
let shared: { ns: DurableObjectNamespace<Store>; store: PorteroStore } | null = null;

function storeFor(env: Env): PorteroStore {
  if (shared?.ns === env.STORE) return shared.store;
  const stub = env.STORE.get(env.STORE.idFromName('main'));
  const store: PorteroStore = {
    get: async <T>(key: string) => (await stub.read(key)) as T | undefined,
    put: (key, value) => stub.write(key, value),
    delete: (key) => stub.remove(key),
  };
  shared = { ns: env.STORE, store };
  return store;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return new Portero(env, storeFor(env)).handle(req);
  },
};
