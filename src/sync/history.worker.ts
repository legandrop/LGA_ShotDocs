// El Web Worker del historial de versiones (Docs/Doc_Historial.md, sección 8): arma el historial de una página fuera
// del hilo de la pantalla. Lo crea `historyClient.ts`, uno por historial abierto, y lo cierra al salir.
//
// Mensajes: recibe `{ id, req }` (historyCore.ts) y contesta `{ id, ok: true, reply }` o `{ id, ok: false, error }`.
// Al arrancar manda `{ ready: true }`.

import { HistoryCore, transferables, type HistoryRequest } from './historyCore';

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<{ id: number; req: HistoryRequest }>) => void): void;
}

const scope = self as unknown as WorkerScope;
const core = new HistoryCore();

scope.addEventListener('message', (event) => {
  const { id, req } = event.data;
  try {
    const reply = core.handle(req);
    // La evidencia de recuperación siempre se copia; nunca se detacha su fuente.
    scope.postMessage({ id, ok: true, reply }, req.op === 'recover-line' ? [] : transferables(reply));
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

scope.postMessage({ ready: true });
