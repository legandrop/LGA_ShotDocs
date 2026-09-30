// @vitest-environment jsdom
import type { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { TextSelection } from '@tiptap/pm/state';
import { ySyncPluginKey } from 'y-prosemirror';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { buildSeed } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import {
  caretAt,
  connect,
  editors,
  mountEditor,
  pmText,
  press,
  sameDocs,
  seeded,
  selectNode,
  showsDoc,
  tick,
  typeAt,
  undoManager,
  unmountAll,
  view,
  yText,
} from './collabHarness';
import { redrawFromYjs } from './editorRecovery';

// Pérdidas de texto reales al editar a la vez con el editor real (BlockNote + y-prosemirror + Yjs), que se
// arreglaron en v0.054 (Docs/Doc_Colaboracion.md). Cada prueba fallaba antes del arreglo:
// - el parche de y-prosemirror (patches/): elegir un bloque entero y recibir un cambio de otro tiraba un error
//   adentro del editor, que se quedaba mostrando lo de antes y en la próxima tecla deshacía el cambio para
//   todos; y dos dispositivos escribiendo en el mismo párrafo vacío perdían texto;
// - la semilla con texto (structure.ts): lo mismo en el primer párrafo de cada página nueva;
// - la reparación de bloques (structure.ts): dos cambios de tipo, o dos sangrías, del mismo bloque a la vez
//   hacían que el editor borrara el bloque entero;
// - volver a dibujar el editor si igual falla (docs.ts, editorRecovery.ts).

const devices: Device[] = [];

afterEach(() => {
  unmountAll();
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
  }
});

const three: PartialBlock[] = [
  { id: 'p1', type: 'paragraph', content: 'alpha' },
  { id: 'p2', type: 'paragraph', content: 'beta' },
  { id: 'p3', type: 'paragraph', content: 'gamma' },
] as never;

/** Una página con tres párrafos abierta en dos dispositivos, por el camino de la app. */
async function sharedPage() {
  const server = new FakeServer();
  const a = await makeDevice(server);
  const b = await makeDevice(server);
  devices.push(a, b);
  const pageId = await a.tree.create(null, 'Escena');
  await a.engine.syncNow();
  await b.engine.syncNow();
  const docA = await a.docs.open(pageId, { seed: true });
  const A = mountEditor(docA, 'a');
  A.replaceBlocks(A.document, three as never);
  await a.docs.flush(pageId);
  await a.docs.pushPage(pageId, a.remote);
  const docB = await b.docs.open(pageId);
  await b.docs.pullPage(pageId, b.remote);
  const B = mountEditor(docB, 'b');
  await tick();
  const sync = async (from: Device, to: Device) => {
    await from.docs.flush(pageId);
    await from.docs.pushPage(pageId, from.remote);
    await to.docs.pullPage(pageId, to.remote);
  };
  return { server, a, b, pageId, A, B, docA, docB, sync };
}

/** Dos editores conectados sin la app, con tres párrafos. */
async function twoEditors() {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const net = connect(docA, docB, 'async');
  const A = mountEditor(docA, 'a');
  const B = mountEditor(docB, 'b');
  A.replaceBlocks(A.document, three as never);
  net.flush();
  await tick();
  return { docA, docB, net, A, B };
}

describe('un bloque elegido entero mientras llega un cambio de otro (parche de y-prosemirror)', () => {
  it('APP1: por el camino de la app, el editor muestra el cambio y la próxima tecla no lo deshace', async () => {
    const { a, b, pageId, A, B, docA, docB, sync } = await sharedPage();
    // A toca el bloque p3 (queda elegido entero, como al tocar una imagen).
    selectNode(A, 'p3', true);
    // B escribe en p1 y borra p3.
    typeAt(B, 'p1', 'end', ' BBB');
    B.removeBlocks(['p3']);
    await b.docs.flush(pageId);
    await b.docs.pushPage(pageId, b.remote);
    await expect(a.docs.pullPage(pageId, a.remote)).resolves.toBeGreaterThan(0);
    expect(showsDoc(A, docA)).toBe(true);
    expect(pmText(A)).toBe('alpha BBB | beta');
    // A sigue escribiendo en otro lado y sincroniza.
    typeAt(A, 'p2', 'end', ' AAA');
    await sync(a, b);
    for (const doc of [docA, docB]) expect(yText(doc)).toBe('alpha BBB | beta AAA');
    expect(pmText(B)).toBe('alpha BBB | beta AAA');
  });

  const remoteOps: Record<string, (B: BlockNoteEditor, id: string) => void> = {
    'borra el bloque': (B, id) => B.removeBlocks([id]),
    'borra el de arriba': (B, id) => id !== 'p1' && B.removeBlocks([`p${Number(id[1]) - 1}`]),
    'borra el de abajo': (B, id) => id !== 'p3' && B.removeBlocks([`p${Number(id[1]) + 1}`]),
    'le cambia el tipo': (B, id) => B.updateBlock(id, { type: 'heading', props: { level: 2 } } as never),
    'le cambia el color': (B, id) => B.updateBlock(id, { props: { textColor: 'red' } } as never),
    'escribe en él': (B, id) => typeAt(B, id, 'end', 'Z'),
    'lo sangra': (B, id) => {
      caretAt(B, id, 'start');
      press(B, 'Tab');
    },
    'lo sube': (B, id) => {
      caretAt(B, id, 'start');
      (B as unknown as { moveBlocksUp: () => void }).moveBlocksUp();
    },
    'borra todos los demás': (B, id) => B.removeBlocks(['p1', 'p2', 'p3'].filter((x) => x !== id)),
  };

  // R1 y R4 de la investigación: cada bloque, elegido con o sin sus hijos, contra cada cambio del otro.
  for (const id of ['p1', 'p2', 'p3']) {
    for (const inner of [false, true]) {
      it(`R1/R4: A elige ${id} ${inner ? '(el contenido)' : '(el bloque)'}; B hace de todo`, async () => {
        const failures: string[] = [];
        for (const [name, op] of Object.entries(remoteOps)) {
          const { docA, docB, net, A, B } = await twoEditors();
          selectNode(A, id, inner);
          op(B, id);
          const expected = yText(docB);
          try {
            net.flush();
          } catch (err) {
            failures.push(`${name}: ${String(err)}`);
          }
          if (!showsDoc(A, docA)) failures.push(`${name}: A shows an old document`);
          // A sigue escribiendo: lo de B no se deshace.
          typeAt(A, [...['p1', 'p2', 'p3']].reverse().find((x) => A.getBlock(x)) ?? 'p1', 'end', ' AAA');
          net.flush();
          await tick();
          if (!sameDocs(docA, docB)) failures.push(`${name}: A and B differ`);
          if (yText(docA).replace(' AAA', '') !== expected)
            failures.push(`${name}: expected "${expected}" + AAA, got "${yText(docA)}"`);
          unmountAll();
        }
        expect(failures).toEqual([]);
      });
    }
  }

  it('R2: deshacer con un bloque elegido entero funciona y no deja el editor viejo', async () => {
    {
      const { docA, docB, net, A } = await twoEditors();
      undoManager(A).clear();
      undoManager(A).stopCapturing();
      A.insertBlocks([{ id: 'n1', type: 'paragraph', content: 'new' } as never], 'p2', 'after');
      undoManager(A).stopCapturing();
      selectNode(A, 'n1');
      A.undo();
      net.flush();
      expect(showsDoc(A, docA)).toBe(true);
      expect(yText(docA)).toBe('alpha | beta | gamma');
      expect(yText(docB)).toBe('alpha | beta | gamma');
      unmountAll();
    }
    {
      const { docA, docB, net, A } = await twoEditors();
      undoManager(A).clear();
      typeAt(A, 'p2', 'end', 'X');
      undoManager(A).stopCapturing();
      selectNode(A, 'p3');
      A.undo();
      net.flush();
      expect(showsDoc(A, docA)).toBe(true);
      expect(yText(docB)).toBe('alpha | beta | gamma');
    }
  });

  it('R3: un lote de cambios de otro (como los baja la app) con el contenido de un bloque elegido', async () => {
    for (const withRetype of [true, false]) {
      const { docA, docB, net, A, B } = await twoEditors();
      selectNode(A, 'p2', true);
      net.offline();
      const before = Y.encodeStateVector(docA);
      typeAt(B, 'p1', 'end', ' BBB');
      if (withRetype) B.updateBlock('p2', { type: 'heading', props: { level: 2 } } as never);
      Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB, before), 'remote');
      expect(pmText(A)).toBe('alpha BBB | beta | gamma');
      net.online();
      typeAt(A, 'p3', 'end', ' AAA');
      net.flush();
      await tick();
      expect(yText(docA)).toBe('alpha BBB | beta | gamma AAA');
      expect(pmText(B)).toBe('alpha BBB | beta | gamma AAA');
      expect(B.getBlock('p2')?.type).toBe(withRetype ? 'heading' : 'paragraph');
      unmountAll();
    }
  });
});

describe('dos dispositivos escribiendo en el mismo párrafo vacío (parche y semilla con texto)', () => {
  /**
   * Una agenda al azar (yempty3 de la investigación): escribir al principio o al final de un bloque (T),
   * Enter (E), y entregar lo pendiente de un lado al otro (d). Devuelve lo que se perdió o quedó dos veces.
   */
  function schedule(ops: string[], fromSeed: boolean, pick: () => number) {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    if (fromSeed) {
      const seed = buildSeed('page-1');
      Y.applyUpdate(docA, seed);
      Y.applyUpdate(docB, seed);
    }
    const out = { A: [] as Uint8Array[], B: [] as Uint8Array[] };
    docA.on('update', (u: Uint8Array, o: unknown) => o !== 'remote' && out.A.push(u));
    docB.on('update', (u: Uint8Array, o: unknown) => o !== 'remote' && out.B.push(u));
    const A = mountEditor(docA, 'a');
    const B = mountEditor(docB, 'b');
    if (!fromSeed) {
      // El párrafo vacío lo arma el editor (no la semilla).
      A.replaceBlocks(A.document, [{ id: 'p1', type: 'paragraph', content: '' }] as never);
      for (const u of out.A.splice(0)) Y.applyUpdate(docB, u, 'remote');
      out.B.length = 0;
    }
    const typed: string[] = [];
    ops.forEach((op, n) => {
      const who = op[1] as 'A' | 'B';
      if (op[0] === 'd') {
        for (const u of out[who].splice(0)) Y.applyUpdate(who === 'A' ? docB : docA, u, 'remote');
        return;
      }
      const E = who === 'A' ? A : B;
      const v = view(E);
      const ends: number[] = [];
      v.state.doc.descendants((nd, p) => {
        if (!nd.isTextblock) return true;
        ends.push(p + 1, p + 1 + nd.content.size);
        return false;
      });
      const block = Math.floor(pick() * (ends.length / 2));
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, ends[2 * block + (op[2] === 's' ? 0 : 1)])));
      if (op[0] === 'E') press(E, 'Enter');
      else {
        const t = `{${who}${n}}`;
        typed.push(t);
        E.insertInlineContent(t);
      }
    });
    for (let i = 0; i < 3; i++) {
      for (const u of out.A.splice(0)) Y.applyUpdate(docB, u, 'remote');
      for (const u of out.B.splice(0)) Y.applyUpdate(docA, u, 'remote');
    }
    const final = yText(docA);
    const result = {
      lost: typed.filter((t) => !final.includes(t)),
      twice: typed.filter((t) => final.split(t).length > 2),
      same: sameDocs(docA, docB),
      final,
    };
    unmountAll();
    return result;
  }

  for (const fromSeed of [true, false]) {
    it(`agendas al azar, ${fromSeed ? 'en el párrafo de la semilla (página nueva)' : 'en un párrafo vacío hecho por el editor'}`, () => {
      const rand = seeded(fromSeed ? 12345 : 54321);
      const ops = ['TAe', 'TAs', 'TBe', 'TBs', 'EAe', 'EBe', 'EAs', 'dA', 'dB', 'dA', 'dB'];
      const problems: string[] = [];
      for (let i = 0; i < Number(process.env.COLLAB_SCHEDULES ?? 120); i++) {
        const len = 6 + Math.floor(rand() * 14);
        const sch = Array.from({ length: len }, () => ops[Math.floor(rand() * ops.length)]);
        const r = schedule(sch, fromSeed, seeded(Math.floor(rand() * 1e9)));
        if (r.lost.length || r.twice.length || !r.same)
          problems.push(`${sch.join(' ')} => lost ${r.lost} twice ${r.twice} same ${r.same} "${r.final}"`);
      }
      expect(problems).toEqual([]);
    }, 120_000);
  }

  it('la agenda mínima de la investigación: A escribe, B escribe, se cruzan, y los dos siguen', () => {
    const r = schedule(['TAe', 'TBe', 'dA', 'TAe', 'dB', 'TBe', 'dA', 'dB'], true, () => 0);
    expect(r.lost).toEqual([]);
    expect(r.twice).toEqual([]);
  });
});

describe('dos cambios de estructura del mismo bloque a la vez (reparación de bloques)', () => {
  const retype = (E: BlockNoteEditor, id: string, level: number) =>
    void E.updateBlock(id, { type: 'heading', props: { level } } as never);
  const indent = (E: BlockNoteEditor, id: string) => {
    caretAt(E, id, 'start');
    press(E, 'Tab');
  };

  for (const mode of ['sync', 'async'] as const) {
    it(`S8: los dos le cambian el tipo al mismo párrafo (${mode}): queda uno, con su texto`, async () => {
      const docA = new Y.Doc();
      const docB = new Y.Doc();
      const net = connect(docA, docB, mode);
      const A = mountEditor(docA, 'a');
      const B = mountEditor(docB, 'b');
      A.replaceBlocks(A.document, three as never);
      net.flush();
      await tick();
      net.offline();
      retype(A, 'p1', 2);
      retype(B, 'p1', 3);
      net.online();
      net.flush();
      await tick();
      expect(yText(docA)).toBe('alpha | beta | gamma');
      expect(sameDocs(docA, docB)).toBe(true);
      expect(showsDoc(A, docA) && showsDoc(B, docB)).toBe(true);
      expect(A.getBlock('p1')?.type).toBe('heading');
    });

    it(`S9b: los dos sangran el mismo bloque (${mode}): queda una vez, adentro del de arriba`, async () => {
      const docA = new Y.Doc();
      const docB = new Y.Doc();
      const net = connect(docA, docB, mode);
      const A = mountEditor(docA, 'a');
      const B = mountEditor(docB, 'b');
      A.replaceBlocks(A.document, three as never);
      net.flush();
      await tick();
      net.offline();
      indent(A, 'p2');
      indent(B, 'p2');
      net.online();
      net.flush();
      await tick();
      expect(yText(docA)).toBe('alpha | beta | gamma');
      expect(sameDocs(docA, docB)).toBe(true);
      expect(showsDoc(A, docA) && showsDoc(B, docB)).toBe(true);
      expect(A.getBlock('p1')?.children.map((c) => c.id)).toEqual(['p2']);
    });

    it(`S9b con hijos: si el de arriba ya tenía hijos, el bloque puede quedar dos veces, nunca se pierde (${mode})`, async () => {
      const docA = new Y.Doc();
      const docB = new Y.Doc();
      const net = connect(docA, docB, mode);
      const A = mountEditor(docA, 'a');
      const B = mountEditor(docB, 'b');
      A.replaceBlocks(A.document, [
        { id: 'p1', type: 'paragraph', content: 'alpha', children: [{ id: 'c1', type: 'paragraph', content: 'child' }] },
        ...three.slice(1),
      ] as never);
      net.flush();
      await tick();
      net.offline();
      indent(A, 'p2');
      indent(B, 'p2');
      net.online();
      net.flush();
      await tick();
      // El id repetido lo arregla el editor con la próxima transacción (Docs/Doc_Colaboracion.md): se entrega.
      net.flush();
      await tick();
      // Los dos agregan su copia al mismo grupo de hijos: es válido para el editor y nadie la borra.
      expect(['alpha | child | beta | gamma', 'alpha | child | beta | beta | gamma']).toContain(yText(docA));
      expect(sameDocs(docA, docB)).toBe(true);
      expect(showsDoc(A, docA) && showsDoc(B, docB)).toBe(true);
    });
  }

  it('S8 por el camino de la app (PageDocs): la reparación va en la misma transacción y se sube', async () => {
    const { a, b, pageId, A, B, docA, docB, sync } = await sharedPage();
    a.engine.stop();
    retype(A, 'p1', 2);
    retype(B, 'p1', 3);
    await a.docs.flush(pageId);
    await b.docs.flush(pageId);
    await a.docs.pushPage(pageId, a.remote);
    await b.docs.pushPage(pageId, b.remote);
    await a.docs.pullPage(pageId, a.remote);
    await b.docs.pullPage(pageId, b.remote);
    await sync(a, b);
    await sync(b, a);
    await tick();
    for (const doc of [docA, docB]) expect(yText(doc)).toBe('alpha | beta | gamma');
    expect(sameDocs(docA, docB)).toBe(true);
    expect(showsDoc(A, docA) && showsDoc(B, docB)).toBe(true);
    expect(pmText(A)).toBe('alpha | beta | gamma');
  });
});

describe('si el editor igual no puede dibujar un cambio, se vuelve a dibujar (docs.ts, editorRecovery.ts)', () => {
  it('el cambio se ve, la bajada no falla y la próxima tecla no lo deshace', async () => {
    const { a, b, pageId, A, docA, docB, sync } = await sharedPage();
    a.docs.subscribeRenderFailed((id) => {
      if (id === pageId) redrawFromYjs(A as never);
    });
    // El próximo cambio remoto que el editor intente mostrar tira un error (como el de restoreRelativeSelection).
    const v = view(A);
    const dispatch = v.dispatch.bind(v);
    let failed = 0;
    v.dispatch = (tr) => {
      const meta = tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined;
      if (meta?.isChangeOrigin && failed === 0) {
        failed++;
        v.dispatch = dispatch;
        throw new Error('render failed');
      }
      dispatch(tr);
    };
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      const B = editors[1];
      typeAt(B, 'p1', 'end', ' BBB');
      await b.docs.flush(pageId);
      await b.docs.pushPage(pageId, b.remote);
      await expect(a.docs.pullPage(pageId, a.remote)).resolves.toBeGreaterThan(0);
    } finally {
      console.warn = warn;
    }
    expect(failed).toBe(1);
    expect(showsDoc(A, docA)).toBe(true);
    typeAt(A, 'p2', 'end', ' AAA');
    await sync(a, b);
    expect(yText(docB)).toBe('alpha BBB | beta AAA | gamma');
    expect(yText(docA)).toBe('alpha BBB | beta AAA | gamma');
  });

  it('si ni eso anda, el editor queda en solo lectura (y la página lo vuelve a montar)', () => {
    const warn = console.warn;
    console.warn = () => undefined;
    const editor = { prosemirrorView: null, isEditable: true };
    try {
      expect(redrawFromYjs(editor)).toBe(false);
    } finally {
      console.warn = warn;
    }
    expect(editor.isEditable).toBe(false);
  });
});
