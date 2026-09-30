// Lo mínimo de los tipos de Cloudflare Workers que usa index.ts.
declare module 'cloudflare:workers' {
  export abstract class DurableObject {
    protected ctx: {
      storage: {
        get(key: string): Promise<unknown>;
        put(key: string, value: unknown): Promise<void>;
        delete(key: string): Promise<boolean>;
      };
    };
    constructor(ctx: unknown, env: unknown);
  }
}

interface DurableObjectStub<T> {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  __brand?: T;
}

interface DurableObjectNamespace<T> {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub<T>;
}
