// El Web Worker del CRC32 de "Download all" (crc32.ts, Docs/Doc_Carpetas.md, sección 9). Lleva un CRC por id:
// `{ id, data }` suma un pedazo; `{ id, end: true }` contesta `{ id, crc }` y lo olvida. Los mensajes llegan en
// orden, así que el resultado incluye todo lo que se mandó antes.

import { crc32Update } from './crc32';

interface WorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<{ id: number; data?: Uint8Array; end?: boolean }>) => void): void;
}

const scope = self as unknown as WorkerScope;
const running = new Map<number, number>();

scope.addEventListener('message', (event) => {
  const { id, data, end } = event.data;
  try {
    if (data) running.set(id, crc32Update(running.get(id) ?? 0, data));
    if (end) {
      scope.postMessage({ id, crc: running.get(id) ?? 0 });
      running.delete(id);
    }
  } catch (err) {
    running.delete(id);
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
});
