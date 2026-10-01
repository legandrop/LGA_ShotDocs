import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/offline';
import { formatSize } from '../media/fileTrash';

// La medición del iPhone casi lleno (Docs/Doc_Copias_Locales.md, sección 9.1): qué dicen `estimate()` y
// `persisted()`, y hasta dónde se puede escribir antes de que el navegador diga que no hay lugar. Escribe en una base
// aparte (`shotdocs-storage-test`), nunca en las de la app, y "Clean up" la borra entera. Se abre desde "Storage on
// this device" (también en la app instalada, que no tiene barra de direcciones) o en `/storage-test`.

const DB = 'shotdocs-storage-test';
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
  useEffect(() => {
    void refresh();
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
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
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
          <button className="primary danger" disabled={word.trim().toLowerCase() !== 'fill' || state === 'cleaning'} onClick={() => void fill()}>
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
