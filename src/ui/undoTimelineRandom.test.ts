// @vitest-environment jsdom
// La línea de tiempo al azar con el editor real (P.26, entrega 1; Docs/Doc_Deshacer.md, sección 12): tres páginas,
// escribir, renglones nuevos, borrar tramos, borrar bloques enteros, cambiar de página (el editor se desmonta y se monta otro), ⌘Z y ⌘⇧Z
// por la línea de tiempo en el medio; al final, deshacer todo (cada página vuelve a lo de antes) y rehacer todo (vuelve a
// lo último). Con otra persona escribiendo y borrando en las tres a la vez: nada suyo se va por un deshacer y los dos
// terminan iguales. Con `replace` (entrega 2), también reemplazar en las tres (el motor de verdad, con su registro y las
// anclas en las páginas sin historia) y, con `panel`, el *Undo* del panel fuera de orden (DH10). Cuántas semillas:
// `TIMELINE_SEEDS` (por defecto, pocas: la medición grande va en el informe).
import { appendFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { connect, mountEditor, seeded, undoManager, unmountAll, view, yText, type Editor } from './collabHarness';
import { para } from './photoHarness';
import { UndoTimeline, type TimelineDocs } from './undoTimeline';
import { createUndoRunner } from './undoTimelineUi';
import { ySyncPluginKey } from 'y-prosemirror';
import { ProjectReplace, type ReplaceDocs, type ReplaceMeta, type ReplaceTree } from '../search/projectReplace';
import type { PageRow } from '../sync/types';

afterEach(unmountAll);

const SEEDS = Number(process.env.TIMELINE_SEEDS ?? 12);
const OTHER = '0123456789';

/** Con `TIMELINE_OUT`, los números de la corrida van a ese archivo (para el informe de una medición grande). */
function report(name: string, tally: object): void {
  if (process.env.TIMELINE_OUT) appendFileSync(process.env.TIMELINE_OUT, `${name} ${JSON.stringify(tally)}
`);
}

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

/** El motor de reemplazar sobre los documentos de la prueba (sin base: `meta` en memoria, todo guardado al instante). */
function replaceEngine(docOf: (id: string) => Y.Doc, timeline: UndoTimeline): ProjectReplace {
  const store = new Map<string, unknown>();
  const meta: ReplaceMeta = {
    get: async (k) => (store.has(k) ? structuredClone(store.get(k)) : undefined),
    put: async (k, v) => void store.set(k, structuredClone(v)),
    delete: async (k) => void store.delete(k),
    keys: async (prefix) => [...store.keys()].filter((k) => k.startsWith(prefix)),
  };
  const tree: ReplaceTree = {
    get: (id) => ({ id, workspace_id: 'P', update_seq: 0 }) as unknown as PageRow,
    isTrashed: () => false,
    hasUnsentCreate: () => false,
  };
  const docs: ReplaceDocs = {
    edit: async (id, fn) => fn(docOf(id)),
    applyLocal: (_id, doc, origin, apply) => {
      doc.transact(apply, origin);
      return true;
    },
    flush: async () => undefined,
    isSaved: () => true,
    peek: (id) => docOf(id),
    indexSnapshot: async () => {
      throw new Error('no hace falta');
    },
    stateOf: async () => undefined,
  };
  return new ProjectReplace({ tree, docs, meta, perms: () => ({ known: true, canEditPage: () => true }), online: () => true, history: timeline });
}

/** Lo que reemplaza la prueba al azar: ida y vuelta, también borrar (reemplazo vacío). */
const REPLACES: [string, string][] = [
  ['camara', 'Camera'],
  ['camera', 'cámara'],
  ['camara', ''],
  ['roja', 'ROJA'],
  ['wk', 'Wk'],
  ['renglon', 'fila'],
  ['x', ''],
];

async function run(seed: number, { blocks = false, withOther = false, replace = false, panel = false } = {}) {
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
  const engine = replace ? replaceEngine((id) => pages.find((p) => p.id === id)!.doc, timeline) : null;
  const ops: string[] = [];
  let replaces = 0;
  let panelUndos = 0;
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
    replace: engine ? (kind, opId) => (kind === 'undo' ? engine.undo(opId, { inOrder: true }) : engine.redo(opId)) : undefined,
  });
  let failed = 0;
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (String(args[0]).startsWith('Deshacer: Yjs no pudo')) failed++;
    else warn(...args);
  };
  // Lo del otro que se fue por un deshacer propio (nunca tiene que pasar): sus letras (sus items, de otro autor) vivas
  // antes de un ⌘Z y borradas después. Aparte se cuentan sus letras que vos borraste y volviste a poner con ⌘Z: Yjs las
  // vuelve a escribir como copias tuyas, y si después deshacés hasta antes de crear ese renglón, se van con él.
  let otherLost = 0;
  let copiesLost = 0;
  const otherItems = () =>
    new Set(
      pages.flatMap((p) =>
        [...p.doc.store.clients]
          .filter(([c]) => c >= 100)
          .flatMap(([, structs]) =>
            (structs as unknown as { deleted: boolean; length: number; content: { str?: string }; id: { client: number; clock: number } }[])
              .filter((it) => !it.deleted && it.content?.str)
              // Una clave por letra: Yjs junta y parte items, las letras no cambian de id.
              .flatMap((it) => Array.from({ length: it.length }, (_, k) => `${p.id}:${it.id.client}:${it.id.clock + k}`)),
          ),
      ),
    );
  const otherChars = () => pages.reduce((n, p) => n + count(yText(p.doc), OTHER), 0);
  const step = async (kind: 'undo' | 'redo') => {
    const before = otherChars();
    const alive = kind === 'undo' ? otherItems() : null;
    await runner.run(kind);
    // Rehacer vuelve a hacer un borrado propio, que pudo llevarse letras del otro que estaban en el tramo (como al
    // borrarlo la primera vez); deshacer nunca se lleva nada suyo.
    if (alive) {
      const now = otherItems();
      const gone = [...alive].filter((k) => !now.has(k)).length;
      otherLost += gone;
      copiesLost += Math.max(0, before - otherChars() - gone);
    }
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
      if (engine && rnd() < 0.1) {
        // Reemplazar en las tres, o (con `panel`) el *Undo* del panel de uno que ya no es lo último.
        if (panel && ops.length > 0 && rnd() < 0.35) {
          const op = pick(ops);
          const before = otherChars();
          const alive = otherItems();
          await engine.undo(op, { inOrder: timeline.replaceIsNext(op, 'undo') });
          const now = otherItems();
          const gone = [...alive].filter((k) => !now.has(k)).length;
          otherLost += gone;
          copiesLost += Math.max(0, before - otherChars() - gone);
          ops.splice(ops.indexOf(op), 1);
          panelUndos++;
        } else {
          const [query, replacement] = pick(REPLACES);
          const result = await engine.run({ projectId: 'P', pageIds: pages.map((p) => p.id), query, replacement, options: {} });
          if (result.opId) {
            ops.push(result.opId);
            replaces++;
          }
        }
        undoManager(current!.E).stopCapturing();
        continue;
      }
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
    if (process.env.TIMELINE_DEBUG && (afterRedo.some((s, i) => s !== last[i]) || afterUndo.some((s, i) => strip(s) !== initial[i]))) console.log(seed, JSON.stringify({ last, afterRedo, afterUndo, initial }, null, 1));
    return {
      undoExact: afterUndo.every((s, i) => strip(s) === initial[i]),
      undoLess: afterUndo.some((s, i) => missing(initial[i], strip(s)).length > 0),
      undoMore: afterUndo.some((s, i) => strip(s).replace(/ \| /g, '').length > initial[i].replace(/ \| /g, '').length),
      redoExact: afterRedo.every((s, i) => s === last[i]),
      otherLost,
      copiesLost,
      failed,
      converged: pages.every((p) => !p.other || yText(p.other) === yText(p.doc)),
      replaces,
      panelUndos,
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
    report('texto', tally);
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
    report('bloques', tally);
    // El resto de 16.4 (1 de 300 con el editor): en pocas semillas, ninguno.
    expect(tally.undoLess).toBeLessThanOrEqual(Math.ceil(SEEDS / 100));
  });

  it(`${SEEDS} semillas con reemplazos en las tres (entrega 2): deshacer todo vuelve exacto y rehacer todo a lo último`, { timeout: 30_000 + SEEDS * 2500 }, async () => {
    const results = [];
    for (let s = 1; s <= SEEDS; s++) results.push(await run(3000 + s, { replace: true }));
    const tally = {
      undoExact: results.filter((r) => r.undoExact).length,
      undoLess: results.filter((r) => r.undoLess).length,
      undoMore: results.filter((r) => r.undoMore).length,
      redoExact: results.filter((r) => r.redoExact).length,
      failed: results.reduce((n, r) => n + r.failed, 0),
      replaces: results.reduce((n, r) => n + r.replaces, 0),
    };
    report('reemplazos', tally);
    expect(tally.replaces).toBeGreaterThan(SEEDS);
    expect(tally.undoLess).toBe(0);
    expect(tally.undoMore).toBe(0);
    expect(tally.undoExact).toBe(SEEDS);
    expect(tally.redoExact).toBe(SEEDS);
  });

  it(`${SEEDS} semillas con reemplazos, el Undo del panel fuera de orden y otra persona: nada suyo se va y los dos iguales`, { timeout: 30_000 + SEEDS * 2500 }, async () => {
    const results = [];
    for (let s = 1; s <= SEEDS; s++) results.push(await run(4000 + s, { replace: true, panel: true, withOther: true }));
    const tally = {
      otherLost: results.reduce((n, r) => n + r.otherLost, 0),
      copiesLost: results.reduce((n, r) => n + r.copiesLost, 0),
      converged: results.filter((r) => r.converged).length,
      failed: results.reduce((n, r) => n + r.failed, 0),
      replaces: results.reduce((n, r) => n + r.replaces, 0),
      panelUndos: results.reduce((n, r) => n + r.panelUndos, 0),
      redoExact: results.filter((r) => r.redoExact).length,
    };
    report('reemplazos, panel y el otro', tally);
    expect(tally.otherLost).toBe(0);
    expect(tally.converged).toBe(SEEDS);
  });

  it(`${SEEDS} semillas con otra persona escribiendo y borrando en las tres: nada suyo se va y los dos iguales`, { timeout: 30_000 + SEEDS * 1500 }, async () => {
    const results = [];
    for (let s = 1; s <= SEEDS; s++) results.push(await run(2000 + s, { withOther: true }));
    const tally = {
      otherLost: results.reduce((n, r) => n + r.otherLost, 0),
      copiesLost: results.reduce((n, r) => n + r.copiesLost, 0),
      converged: results.filter((r) => r.converged).length,
      failed: results.reduce((n, r) => n + r.failed, 0),
      undoLess: results.filter((r) => r.undoLess).length,
    };
    report('con el otro', tally);
    expect(tally.otherLost).toBe(0);
    expect(tally.converged).toBe(SEEDS);
  });
});
