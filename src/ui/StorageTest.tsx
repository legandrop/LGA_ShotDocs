import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/offline';
import { formatSize } from '../media/fileTrash';
import { PENDING_PREFIX, STORAGE_TEST_DB } from '../services';

// La medición del iPhone casi lleno (Docs/Doc_Copias_Locales.md, sección 9.1): qué dicen `estimate()` y
// `persisted()`, y hasta dónde se puede escribir antes de que el navegador diga que no hay lugar. Escribe en una base
// aparte (`shotdocs-storage-test`), nunca en las de la app, y "Clean up" la borra entera. Se abre desde "Storage on
// this device" (también en la app instalada, que no tiene barra de direcciones) o en `/storage-test`.

const DB = STORAGE_TEST_DB;

/** Lo que falta subir en todos los workspaces de este dispositivo (lo anota cada uno al sincronizar). */
function pendingOnDevice(): number | null {
  try {
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PENDING_PREFIX)) n += Number(localStorage.getItem(key)) || 0;
    }
    return n;
  } catch {
    return null;
  }
}

function deleteTestDb(): Promise<void> {
  return new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
const PART = 16 * 1024 * 1024;

function openTestDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('parts');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 16 MiB que no se pueden comprimir (el navegador podría guardar ceros en menos lugar). */
function noise(bytes: number): Blob {
  const chunk = new Uint8Array(64 * 1024);
  const parts: Uint8Array[] = [];
  for (let at = 0; at < bytes; at += chunk.length) {
    crypto.getRandomValues(chunk);
    parts.push(chunk.slice());
  }
  return new Blob(parts as BlobPart[]);
}

function put(db: IDBDatabase, key: number, value: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('parts', 'readwrite');
    tx.objectStore('parts').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('aborted', 'AbortError'));
  });
}

export function StorageTest() {
  const tr = useT();
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [written, setWritten] = useState(0);
  const [state, setState] = useState<'idle' | 'filling' | 'stopped' | 'cleaning'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [word, setWord] = useState('');
  const stop = useRef(false);
  const standalone = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;

  const refresh = async () => {
    setEstimate((await navigator.storage?.estimate?.().catch(() => null)) ?? null);
    setPersisted((await navigator.storage?.persisted?.().catch(() => null)) ?? null);
  };
  const [pending] = useState(pendingOnDevice);
  useEffect(() => {
    // Lo que haya quedado de una medición cortada se borra al abrir.
    void deleteTestDb().then(refresh);
  }, []);

  async function fill() {
    stop.current = false;
    setError(null);
    setState('filling');
    const db = await openTestDb();
    let n = 0;
    try {
      for (;;) {
        if (stop.current) break;
        await put(db, n++, noise(PART));
        setWritten(n * PART);
        if (n % 4 === 0) await refresh();
      }
      setState('stopped');
    } catch (err) {
      setError(err instanceof DOMException ? `${err.name}: ${err.message}` : String(err));
      setState('stopped');
    } finally {
      db.close();
      await refresh();
    }
  }

  async function clean() {
    stop.current = true;
    setState('cleaning');
    await deleteTestDb();
    setWritten(0);
    setState('idle');
    await refresh();
  }

  return (
    <main className="legal storage-test">
      <h1>{tr('storageTest.title')}</h1>
      <p>{tr('storageTest.intro')}</p>
      <ul>
        <li>{tr('storageTest.quota', { size: estimate?.quota ? formatSize(estimate.quota, tr.lang) : '—' })}</li>
        <li>{tr('storageTest.usage', { size: estimate?.usage !== undefined ? formatSize(estimate.usage, tr.lang) : '—' })}</li>
        <li>{tr('storageTest.persisted', { value: persisted === null ? '—' : String(persisted) })}</li>
        <li>{tr('storageTest.standalone', { value: String(standalone) })}</li>
        <li>{tr('storageTest.written', { size: formatSize(written, tr.lang) })}</li>
      </ul>
      {error && <p className="error">{tr('storageTest.stoppedWith', { error })}</p>}
      {pending !== 0 && <p className="error">{tr('storageTest.pending', { count: pending ?? '?' })}</p>}
      {persisted === false && <p className="muted">{tr('offlineDialog.notPersisted')}</p>}
      {state === 'filling' ? (
        <button className="secondary" onClick={() => (stop.current = true)}>
          {tr('offlineDialog.stop')}
        </button>
      ) : (
        <>
          <label>
            {tr('storageTest.typeFill')}{' '}
            <input value={word} autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(e) => setWord(e.target.value)} />
          </label>{' '}
          <button className="primary danger" disabled={word.trim().toLowerCase() !== 'fill' || state === 'cleaning' || pending !== 0} onClick={() => void fill()}>
            {tr('storageTest.fill')}
          </button>
        </>
      )}{' '}
      <button className="secondary" disabled={state === 'cleaning'} onClick={() => void clean()}>
        {tr('storageTest.clean')}
      </button>
      <p>
        <a href="/">{tr('storageTest.back')}</a>
      </p>
    </main>
  );
}
