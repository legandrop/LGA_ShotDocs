// @vitest-environment jsdom
// La línea de tiempo al azar con el editor real (P.26, entrega 1; Docs/Doc_Deshacer.md, sección 12): tres páginas,
// escribir, renglones nuevos, borrar tramos, borrar bloques enteros, cambiar de página (el editor se desmonta y se monta otro), ⌘Z y ⌘⇧Z
// por la línea de tiempo en el medio; al final, deshacer todo (cada página vuelve a lo de antes) y rehacer todo (vuelve a
// lo último). Con otra persona escribiendo y borrando en las tres a la vez: nada suyo se va por un deshacer y los dos
// terminan iguales. Cuántas semillas: `TIMELINE_SEEDS` (por defecto, pocas: la medición grande va en el informe).
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { connect, mountEditor, seeded, undoManager, unmountAll, view, yText, type Editor } from './collabHarness';
import { para } from './photoHarness';
import { UndoTimeline, type TimelineDocs } from './undoTimeline';
import { createUndoRunner } from './undoTimelineUi';
import { ySyncPluginKey } from 'y-prosemirror';

afterEach(unmountAll);

const SEEDS = Number(process.env.TIMELINE_SEEDS ?? 12);
const OTHER = '0123456789';

interface Page {
  id: string;
  doc: Y.Doc;
  other: Y.Doc | null;
}

/** Las letras que faltan de `want` en `got` (contando repetidas). */
function missing(want: string, got: string): string {
  const left = new Map<string, number>();
  for (const ch of got) left.set(ch, (left.get(ch) ?? 0) + 1);
  let out = '';
  for (const ch of want) {
    const n = left.get(ch) ?? 0;
    if (n > 0) left.set(ch, n - 1);
    else out += ch;
  }
  return out;
}

const count = (s: string, set: string) => [...s].filter((c) => set.includes(c)).length;

async function run(seed: number, { blocks = false, withOther = false } = {}) {
  const rnd = seeded(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const pages: Page[] = [];
  for (let i = 0; i < 3; i++) {
    const doc = new Y.Doc();
    doc.clientID = 10 + i;
    const E = mountEditor(doc, 'a');
    E.replaceBlocks(E.document, [para(`p${i}a`, ['la cámara roja']), para(`p${i}b`, ['segundo renglón']), para(`p${i}c`, ['tercero'])] as never);
    E.unmount();
    let other: Y.Doc | null = null;
    if (withOther) {
      other = new Y.Doc();
      other.clientID = 100 + i;
      Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
      connect(doc, other, 'sync', { repair: false });
    }
    pages.push({ id: `page-${i}`, doc, other });
  }
  const initial = pages.map((p) => yText(p.doc));
  const docs: TimelineDocs = {
    open: async (id) => pages.find((p) => p.id === id)!.doc,
    close: () => undefined,
    subscribeUnsupported: () => () => undefined,
  };
  const timeline = new UndoTimeline({ docs, projectOf: () => 'P' });
  let current: { page: Page; E: Editor; detach: () => void } | null = null;
  const go = (id: string) => {
    if (current) {
      current.detach();
      current.E.unmount();
    }
    const page = pages.find((p) => p.id === id)!;
    const E = mountEditor(page.doc, 'a');
    const v = view(E);
    const binding = (ySyncPluginKey.getState(v.state as never) as { binding: object }).binding;
    current = { page, E, detach: timeline.attach(id, page.doc, undoManager(E), { binding, editable: () => true, dom: v.dom }) };
  };
  const runner = createUndoRunner({
    timeline,
    currentPage: () => current?.page.id ?? null,
    currentProject: () => 'P',
    title: (id) => id,
    blocked: () => null,
    go,
    notify: () => undefined,
  });
  let failed = 0;
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (String(args[0]).startsWith('Deshacer: Yjs no pudo')) failed++;
    else warn(...args);
  };
  // Lo del otro que se fue por un deshacer propio (nunca tiene que pasar).
  let otherLost = 0;
  const otherChars = () => pages.reduce((n, p) => n + count(yText(p.doc), OTHER), 0);
  const step = async (kind: 'undo' | 'redo') => {
    const before = otherChars();
    await runner.run(kind);
    // Rehacer vuelve a hacer un borrado propio, que pudo llevarse letras del otro que estaban en el tramo (como al
    // borrarlo la primera vez); deshacer nunca se lleva nada suyo.
    if (kind === 'undo') otherLost += Math.max(0, before - otherChars());
  };
  try {
    go(pages[0].id);
    for (let i = 0; i < 40; i++) {
      const E = current!.E;
      const v = view(E);
      const positions: number[] = [];
      v.state.doc.descendants((n, p) => {
        if (n.isTextblock) for (let k = 0; k <= n.content.size; k++) positions.push(p + 1 + k);
        return true;
      });
      const r = rnd();
      if (r < 0.3) {
        v.dispatch(v.state.tr.insertText(pick(['x', 'yz', 'wk', 'vhp']), pick(positions)));
      } else if (r < 0.37) {
        // Un renglón nuevo (Enter y escribir): el otro puede escribir adentro (B1 de la auditoría).
        const ids = E.document.map((b) => b.id);
        E.insertBlocks([{ type: 'paragraph', content: pick(['wk', 'vhp']) }] as never, pick(ids), 'after');
      } else if (r < 0.45) {
        const from = pick(positions);
        const to = Math.min(from + 1 + Math.floor(rnd() * 4), v.state.doc.content.size);
        const $a = v.state.doc.resolve(from);
        const $b = v.state.doc.resolve(to);
        if ($a.parent === $b.parent && to > from) v.dispatch(v.state.tr.delete(from, to));
      } else if (r < 0.52 && blocks) {
        const ids = E.document.map((b) => b.id);
        if (ids.length > 1) E.removeBlocks([pick(ids)]);
      } else if (r < 0.62) {
        go(pick(pages).id);
      } else if (r < 0.8) {
        await step('undo');
      } else {
        await step('redo');
      }
      undoManager(current!.E).stopCapturing();
      if (withOther && rnd() < 0.35) {
        // El otro escribe o borra algo suyo en cualquier página.
        const p = pick(pages);
        const texts: Y.XmlText[] = [];
        const walk = (n: Y.XmlElement | Y.XmlFragment | Y.XmlText) => {
          if (n instanceof Y.XmlText) texts.push(n);
          else n.toArray().forEach((c) => walk(c as never));
        };
        walk(p.other!.getXmlFragment(CONTENT_FRAGMENT));
        const t = texts.length ? pick(texts) : null;
        if (t) {
          if (rnd() < 0.7 || t.length === 0) t.insert(Math.floor(rnd() * (t.length + 1)), pick([...OTHER]));
          else t.delete(Math.floor(rnd() * t.length), 1);
        }
      }
    }
    // Lo último, con lo que quedaba para rehacer (rehacer todo después de deshacer todo vuelve a esto).
    for (let guard = 0; guard < 2000 && timeline.peek('P', 'redo'); guard++) await step('redo');
    const last = pages.map((p) => yText(p.doc));
    // Deshacer todo.
    for (let guard = 0; guard < 2000 && timeline.peek('P', 'undo'); guard++) await step('undo');
    const afterUndo = pages.map((p) => yText(p.doc));
    // Rehacer todo.
    for (let guard = 0; guard < 2000 && timeline.peek('P', 'redo'); guard++) await step('redo');
    const afterRedo = pages.map((p) => yText(p.doc));
    const strip = (s: string) => [...s].filter((c) => !OTHER.includes(c)).join('');
    if (process.env.TL_DEBUG) console.log('SEED', seed, JSON.stringify({ initial, last, afterUndo, afterRedo, otherLost, failed }));
    return {
      undoExact: afterUndo.every((s, i) => strip(s) === initial[i]),
      undoLess: afterUndo.some((s, i) => missing(initial[i], strip(s)).length > 0),
      undoMore: afterUndo.some((s, i) => strip(s).replace(/ \| /g, '').length > initial[i].replace(/ \| /g, '').length),
      redoExact: afterRedo.every((s, i) => s === last[i]),
      otherLost,
      failed,
      converged: pages.every((p) => !p.other || yText(p.other) === yText(p.doc)),
    };
  } finally {
    console.warn = warn;
    if (current) (current as { E: Editor }).E.unmount();
  }
}

describe('la línea de tiempo al azar con el editor', () => {
  it(`${SEEDS} semillas: deshacer todo vuelve exacto a lo de antes y rehacer todo a lo último`, { timeout: 30_000 + SEEDS * 1500 }, async () => {
    const results = [];
    for (let s = 1; s <= SEEDS; s++) results.push(await run(s));
    const tally = {
      undoExact: results.filter((r) => r.undoExact).length,
      undoLess: results.filter((r) => r.undoLess).length,
      undoMore: results.filter((r) => r.undoMore).length,
      redoExact: results.filter((r) => r.redoExact).length,
      failed: results.reduce((n, r) => n + r.failed, 0),
    };
    if (process.env.TIMELINE_SEEDS) console.log('texto', JSON.stringify(tally));
    expect(tally.undoLess).toBe(0);
    expect(tally.undoMore).toBe(0);
    expect(tally.undoExact).toBe(SEEDS);
    expect(tally.redoExact).toBe(SEEDS);
  });

  it(`${SEEDS} semillas borrando bloques enteros: nada de letras de antes de menos más allá del resto conocido de Yjs`, { timeout: 30_000 + SEEDS * 1500 }, async () => {
    const results = [];
    for (let s = 1; s <= SEEDS; s++) results.push(await run(1000 + s, { blocks: true }));
    const tally = {
      undoExact: results.filter((r) => r.undoExact).length,
      undoLess: results.filter((r) => r.undoLess).length,
      redoExact: results.filter((r) => r.redoExact).length,
      failed: results.reduce((n, r) => n + r.failed, 0),
    };
    if (process.env.TIMELINE_SEEDS) console.log('bloques', JSON.stringify(tally));
    // El resto de 16.4 (1 de 300 con el editor): en pocas semillas, ninguno.
    expect(tally.undoLess).toBeLessThanOrEqual(Math.ceil(SEEDS / 100));
  });

  it(`${SEEDS} semillas con otra persona escribiendo y borrando en las tres: nada suyo se va y los dos iguales`, { timeout: 30_000 + SEEDS * 1500 }, async () => {
    const results = [];
    for (let s = 1; s <= SEEDS; s++) results.push(await run(2000 + s, { withOther: true }));
    const tally = {
      otherLost: results.reduce((n, r) => n + r.otherLost, 0),
      converged: results.filter((r) => r.converged).length,
      failed: results.reduce((n, r) => n + r.failed, 0),
      undoLess: results.filter((r) => r.undoLess).length,
    };
    if (process.env.TIMELINE_SEEDS) console.log('con el otro', JSON.stringify(tally));
    expect(tally.otherLost).toBe(0);
    expect(tally.converged).toBe(SEEDS);
  });
});
