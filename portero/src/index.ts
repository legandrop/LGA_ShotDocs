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
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return new Portero(env, storeFor(env)).handle(req);
  },
};
