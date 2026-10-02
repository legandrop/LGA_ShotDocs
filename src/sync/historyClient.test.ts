import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createHistoryEngine, type HistoryEngine, type WorkerLike } from './historyClient';
import { HistoryCore, transferables, type HistoryRequest } from './historyCore';
import { readMarks, simulate, visible } from './historyTesting';

// El historial se arma en un Web Worker y, si no se puede, en la página (Docs/Doc_Historial.md, sección 8). Las dos
// formas tienen que dar lo mismo. El Worker de la prueba hace lo mismo que history.worker.ts (HistoryCore con
// mensajes), con los mensajes copiados como los copia el navegador (`structuredClone`) y de forma asíncrona.

class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { preventDefault?: () => void; message?: string }) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;
  private core = new HistoryCore();
  terminated = false;
  handled = 0;
  constructor(
    private readonly opts: { failAtStart?: boolean; crashAfter?: number } = {},
  ) {
    setTimeout(() => {
      if (this.opts.failAtStart) this.onerror?.({ preventDefault: () => undefined, message: 'no se pudo bajar el script' });
      else this.onmessage?.({ data: { ready: true } });
    }, 0);
  }
  postMessage(message: unknown): void {
    const { id, req } = structuredClone(message) as { id: number; req: HistoryRequest };
    setTimeout(() => {
      if (this.terminated || this.opts.failAtStart) return;
      if (this.opts.crashAfter !== undefined && this.handled >= this.opts.crashAfter) {
        this.onerror?.({ preventDefault: () => undefined, message: 'falta de memoria' });
        return;
      }
      this.handled++;
      try {
        const reply = this.core.handle(req);
        transferables(reply);
        this.onmessage?.({ data: structuredClone({ id, ok: true, reply }) });
      } catch (err) {
        this.onmessage?.({ data: { id, ok: false, error: (err as Error).message } });
      }
    }, 1);
  }
  terminate(): void {
    this.terminated = true;
  }
}

const docOf = (update: Uint8Array) => {
  const d = new Y.Doc();
  Y.applyUpdate(d, update);
  return d;
};

/** Todo lo que muestra la pantalla de cada versión, para comparar dos formas de calcularlo. */
async function everything(engine: HistoryEngine, rows: ReturnType<typeof simulate>, pageId: string) {
  const half = Math.floor(rows.length * 0.8);
  const first = await engine.load(rows.slice(0, half), pageId);
  const summary = await engine.append(rows.slice(half));
  const out: unknown[] = [first, summary];
  for (const s of summary.sessions) {
    const v = await engine.version(s.seq);
    const c = await engine.changes(s.seq);
    const union = docOf(c.update);
    out.push({ seq: s.seq, version: visible(docOf(v.update)), orphans: v.orphans, union: visible(union), marks: readMarks(union, c.marks) });
  }
  return out;
}

describe('el Worker y la página dan lo mismo', () => {
  const rows = simulate(400, 3);

  it('con el Worker y sin él (navegador sin Worker): las mismas versiones, uniones y marcas', async () => {
    const withWorker = createHistoryEngine(() => new FakeWorker());
    const onPage = createHistoryEngine(() => null);
    expect(withWorker.kind()).toBe('worker');
    expect(onPage.kind()).toBe('main');
    const a = await everything(withWorker, rows, 'p');
    const b = await everything(onPage, rows, 'p');
    expect(a.length).toBeGreaterThan(4);
    expect(a).toEqual(b);
    expect(withWorker.kind()).toBe('worker');
    withWorker.destroy();
    onPage.destroy();
  });

  it('si el script del Worker no arranca, lo hace la página (con los pedidos que ya estaban hechos)', async () => {
    const failing = createHistoryEngine(() => new FakeWorker({ failAtStart: true }));
    const onPage = createHistoryEngine(() => null);
    const a = await everything(failing, rows, 'p');
    expect(failing.kind()).toBe('main');
    expect(a).toEqual(await everything(onPage, rows, 'p'));
    failing.destroy();
    onPage.destroy();
  });

  it('si el Worker se cae en el medio, la página vuelve a armar lo que tenía y sigue', async () => {
    const crashing = createHistoryEngine(() => new FakeWorker({ crashAfter: 3 }));
    const onPage = createHistoryEngine(() => null);
    const a = await everything(crashing, rows, 'p');
    expect(crashing.kind()).toBe('main');
    expect(a).toEqual(await everything(onPage, rows, 'p'));
    crashing.destroy();
    onPage.destroy();
  });

  it('una versión que ya no está en la lista se rechaza (no se inventa otra)', async () => {
    const engine = createHistoryEngine(() => new FakeWorker());
    await engine.load(rows, 'p');
    await expect(engine.version(-5)).rejects.toThrow('version_gone');
    engine.destroy();
    await expect(engine.version(1)).rejects.toThrow('cancelled');
  });
});
