// Lo primero que corre en el documento de práctica (tour.html): lo aísla de la app de verdad, que comparte el mismo
// origen (y por lo tanto el mismo `localStorage`, `sessionStorage` e IndexedDB). Va en su propio módulo, importado antes
// que cualquier otro, porque los `import` se evalúan antes que el cuerpo del archivo que los pide.
//
// - `localStorage` y `sessionStorage` pasan a ser unos en memoria: la app de práctica anota ahí lo de siempre (el último
//   proyecto, la página abierta, lo plegado, el historial de la pestaña) sin pisar lo de la app de verdad. Arrancan con
//   una copia del `localStorage` de verdad (tema, letra, idioma) menos las sesiones de Supabase, que acá no se usan.
// - Los de verdad quedan en `__shotdocsRealStorage` / `__shotdocsRealSession`: solo los usan el progreso de los
//   recorridos (src/tour/progress.ts) y la marca para volver si se recarga (src/tour/reload.ts).
// - IndexedDB lo pisa después `fake-indexeddb/auto` (lo importa src/sync/testing.ts): la base de este dispositivo no se
//   abre. Acá se guarda la de verdad solo para poder comprobarlo (`__shotdocsRealIndexedDB`).

class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length(): number {
    return this.items.size;
  }
  clear(): void {
    this.items.clear();
  }
  getItem(key: string): string | null {
    return this.items.get(String(key)) ?? null;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.items.delete(String(key));
  }
  setItem(key: string, value: string): void {
    this.items.set(String(key), String(value));
  }
}

const realLocal = window.localStorage;
const realSession = window.sessionStorage;
Object.assign(globalThis, { __shotdocsRealStorage: realLocal, __shotdocsRealSession: realSession, __shotdocsRealIndexedDB: window.indexedDB });

const local = new MemoryStorage();
try {
  for (let i = 0; i < realLocal.length; i++) {
    const key = realLocal.key(i);
    if (key && !key.startsWith('sb-')) local.setItem(key, realLocal.getItem(key) ?? '');
  }
} catch {
  // Sin almacenamiento de verdad, la práctica arranca con los valores de fábrica.
}
const session = new MemoryStorage();
Object.defineProperty(window, 'localStorage', { configurable: true, get: () => local });
Object.defineProperty(window, 'sessionStorage', { configurable: true, get: () => session });

export {};
