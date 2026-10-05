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
  __brand?: T;
}

interface DurableObjectNamespace<T> {
  newUniqueId(): DurableObjectId;
  idFromString(id: string): DurableObjectId;
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub<T>;
}

interface DurableObjectId { toString(): string }
