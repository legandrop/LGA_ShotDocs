// Lo mínimo de los tipos de Cloudflare Workers que usa index.ts.
declare module 'cloudflare:workers' {
  export abstract class DurableObject {
    protected ctx: {
      storage: {
        get(key: string): Promise<unknown>;
        put(key: string, value: unknown): Promise<void>;
        delete(key: string): Promise<boolean>;
        sync(): Promise<void>;
        getAlarm(): Promise<number | null>;
        setAlarm(time: number | Date): Promise<void>;
        deleteAlarm(): Promise<void>;
        // La API KV sincrónica de los objetos con SQLite (los candados entre instancias, v0.264).
        kv: {
          get(key: string): unknown;
          put(key: string, value: unknown): void;
          delete(key: string): boolean;
          list(options?: { prefix?: string }): Iterable<[string, unknown]>;
        };
      };
      blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
      id: DurableObjectId;
    };
    constructor(ctx: unknown, env: unknown);
  }
}

interface DurableObjectStub<T> {
  fetch(request: Request): Promise<Response>;
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  // El candado entre instancias (v0.264).
  claim(key: string, holder: string, staleMs: number): Promise<boolean>;
  release(key: string, holder: string): Promise<void>;
  __brand?: T;
}

interface DurableObjectNamespace<T> {
  newUniqueId(): DurableObjectId;
  idFromString(id: string): DurableObjectId;
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub<T>;
}

interface DurableObjectId { toString(): string }
