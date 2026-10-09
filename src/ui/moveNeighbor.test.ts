// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { blockReorderExtension } from './blockReorder';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { appendFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { findRemovedWriting } from '../sync/removedWriting';
import { connect, editors, posOf, sameDocs, showsDoc, tick, unmountAll, view } from './collabHarness';
import { collapseExtension } from './collapseEditor';
import { schema } from './editorSchema';

// E20: mover un bloque sin red mientras otro borra el bloque movido (o el vecino). y-prosemirror
// (`updateYFragment`) no mueve: reescribe en su lugar los contenedores que cambiaron de orden, así que el borrado del
// otro cae en un contenedor que ya lleva OTRO bloque. Camino real: el editor de la página (BlockNote + y-prosemirror,
// con el teclado de la app: collapseExtension), dos Y.Doc, sin red entre medio.

afterEach(unmountAll);

function mountWith(doc: Y.Doc): BlockNoteEditor {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema,
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
      extensions: [collapseExtension({}), blockReorderExtension],
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return editor;
}

type Kind = 'image' | 'paragraph' | 'heading' | 'bullet' | 'mixed' | 'nested';
const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];

function page(kind: Kind): PartialBlock[] {
  return WORDS.map((w, i) => {
    const id = `b${i}`;
    if (kind === 'image') return { id, type: 'image', props: { url: `sdmedia://f${i}`, name: `${w}.jpg` } };
    if (kind === 'heading') return { id, type: 'heading', props: { level: 2 }, content: w };
    if (kind === 'bullet') return { id, type: 'bulletListItem', content: w };
    if (kind === 'mixed') return i % 2 ? { id, type: 'heading', props: { level: 2 }, content: w } : { id, type: 'paragraph', content: w };
    if (kind === 'nested' && i === 1) return { id, type: 'paragraph', content: w, children: [{ id: 'c1', type: 'paragraph', content: 'kid' }] };
    return { id, type: 'paragraph', content: w };
  }) as never;
}

/** Lo que hay en el Y.Doc: cada bloque como `id:texto-o-url`, en orden de documento (con los anidados). */
function blocks(d: Y.Doc): string[] {
  const out: string[] = [];
  const walk = (t: Y.XmlElement | Y.XmlFragment) => {
    for (const c of t.toArray()) {
      if (!(c instanceof Y.XmlElement)) continue;
      if (c.nodeName === 'blockContainer') {
        const content = c.toArray()[0] as Y.XmlElement | undefined;
        const label = content?.nodeName === 'image' ? String(content.getAttribute('url')).replace('sdmedia://', '') : (content?.toArray() ?? []).map((x) => (x instanceof Y.XmlText ? x.toString() : '')).join('');
        out.push(`${c.getAttribute('id')}:${label}`);
      }
      walk(c);
    }
  };
  walk(d.getXmlFragment(CONTENT_FRAGMENT));
  return out;
}

/** Elige el bloque como en la app: una foto con un clic (el nodo de la foto), un renglón con el cursor. */
function pick(E: BlockNoteEditor, id: string): void {
  const v = view(E);
  const p = posOf(E, id);
  const content = v.state.doc.nodeAt(p)!.firstChild!;
  if (content.type.name === 'image') v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, p + 1)));
  else v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, p + 2)));
}

const key = (E: BlockNoteEditor, k: string, init: KeyboardEventInit = {}) =>
  view(E).dom.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

type Op = (E: BlockNoteEditor) => void;
/** Ctrl+Shift+↑/↓ (el atajo de la app; sin nada colapsado lo hace BlockNote). */
const kb = (id: string, dir: 'up' | 'down'): Op => (E) => {
  pick(E, id);
  key(E, dir === 'up' ? 'ArrowUp' : 'ArrowDown', { ctrlKey: true, shiftKey: true });
};
/** Lo que hace ProseMirror al soltar un bloque arrastrado con los puntos: una transacción que saca e inserta. */
const drag = (id: string, beforeId: string): Op => (E) => {
  const v = view(E);
  const from = posOf(E, id);
  const node = v.state.doc.nodeAt(from)!;
  const target = posOf(E, beforeId);
  const tr = v.state.tr.delete(from, from + node.nodeSize);
  tr.insert(tr.mapping.map(target), node);
  v.dispatch(tr);
};
/** Cortar y pegar: dos transacciones (sacar, después insertar una copia arriba de otro). */
const cutPaste = (id: string, beforeId: string): Op => (E) => {
  const v = view(E);
  const from = posOf(E, id);
  const node = v.state.doc.nodeAt(from)!;
  v.dispatch(v.state.tr.delete(from, from + node.nodeSize));
  v.dispatch(v.state.tr.insert(posOf(E, beforeId), node));
};
/** Borrar como en la app: el bloque elegido entero y Retroceso. */
const del = (id: string): Op => (E) => {
  const v = view(E);
  v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, posOf(E, id))));
  key(E, 'Backspace');
};
const delApi = (id: string): Op => (E) => void E.removeBlocks([id]);
const write = (id: string): Op => (E) => {
  const v = view(E);
  const p = posOf(E, id);
  const content = v.state.doc.nodeAt(p)!.firstChild!;
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, p + 2 + content.content.size)));
  E.insertInlineContent('ZZZ');
};

async function run(kind: Kind, b: Op, a: Op | null) {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const net = connect(docA, docB);
  const A = mountWith(docA);
  const B = mountWith(docB);
  A.replaceBlocks(A.document, page(kind) as never);
  net.flush();
  await tick();
  const start = blocks(docB);
  const initialSV = Y.encodeStateVector(docB);
  net.offline();
  b(B);
  await tick();
  const moved = blocks(docB);
  if (a) a(A);
  await tick();
  // Escribir no cuenta como borrar el contenido inicial: el vecino original también debe sobrevivir.
  const remainingIds = new Set(blocks(docA).map((x) => x.split(':')[0]));
  const removedByA = start.filter((x) => !remainingIds.has(x.split(':')[0]));
  // Inspección ANTES de entregar: la misma función pura que usa el motor de B.16. Las pruebas del motor
  // cubren por separado la persistencia del aviso y el caso de cerrar y volver a abrir la sesión.
  const incomingB = Y.encodeStateAsUpdate(docB, initialSV);
  const incomingA = Y.encodeStateAsUpdate(docA, initialSV);
  const noticeA = findRemovedWriting([Y.encodeStateAsUpdate(docA)], incomingB, new Set([docA.clientID]));
  const noticeB = findRemovedWriting([Y.encodeStateAsUpdate(docB)], incomingA, new Set([docB.clientID]));
  net.online();
  net.flush();
  await tick();
  net.flush();
  await tick();
  const final = blocks(docA);
  const ids = (xs: string[]) => xs.map((x) => x.split(':')[0]);
  const labels = (xs: string[]) => xs.map((x) => x.split(':')[1]);
  // Lo que nadie borró y no está (por su contenido: el id puede haber viajado con otro contenido).
  const clean = (xs: string[]) => labels(xs).map((l) => l.replace('ZZZ', ''));
  const lost = labels(start).filter((l) => !labels(removedByA).includes(l) && !clean(final).includes(l));
  const resurrected = labels(removedByA).filter((l) => clean(final).includes(l));
  // Dónde terminó lo que escribió A (o null: no escribió, o se perdió).
  const wrote = final.find((x) => x.includes('ZZZ')) ?? null;
  // Pares id↔contenido que cambiaron (un id con el contenido de otro).
  const swapped = final.filter((x) => start.some((s) => ids([s])[0] === ids([x])[0] && s !== x && !x.includes('ZZZ')));
  return { start, moved, removedByA, final, lost, resurrected, swapped, wrote, noticeA, noticeB,
    same: sameDocs(docA, docB), shows: showsDoc(A, docA) && showsDoc(B, docB) };
}

const LOG = process.env.E20_LOG;

describe('E20: mover sin red mientras el otro borra (camino real del editor)', () => {
  const kinds: Kind[] = ['image', 'paragraph', 'heading', 'bullet', 'mixed', 'nested'];
  const moves: [string, Op][] = [
    ['teclado ↑ b2', kb('b2', 'up')],
    ['teclado ↓ b1', kb('b1', 'down')],
    ['arrastrar b3 arriba de b0', drag('b3', 'b0')],
    ['cortar b2 y pegar arriba de b1', cutPaste('b2', 'b1')],
  ];
  const others: [string, (moved: string) => Op | null][] = [
    ['nadie', () => null],
    ['A borra el movido (Retroceso)', (m) => del(m)],
    ['A borra el movido (removeBlocks)', (m) => delApi(m)],
    ['A borra el vecino b1/b2', (m) => del(m === 'b2' ? 'b1' : m === 'b1' ? 'b2' : 'b0')],
    ['A escribe en el vecino', (m) => write(m === 'b2' ? 'b1' : m === 'b1' ? 'b2' : 'b0')],
    ['A escribe en el movido', (m) => write(m)],
  ];
  for (const kind of kinds) {
    for (const [mName, mOp] of moves) {
      for (const [oName, oOp] of others) {
        const movedId = mName.match(/b\d/)![0];
        if (kind === 'image' && oName.startsWith('A escribe')) continue;
        if (kind !== 'paragraph' && kind !== 'image' && mName.startsWith('cortar')) continue;
        it(`${kind} | ${mName} | ${oName}`, async () => {
          const r = await run(kind, mOp, oOp(movedId));
          if (LOG) appendFileSync(LOG, `${kind} | ${mName} | ${oName} | perdido ${JSON.stringify(r.lost)} | vuelve ${JSON.stringify(r.resurrected)} | escrito en ${r.wrote ?? '-'} | movido ${r.moved.join(',')} | final ${r.final.join(',')}\n`);
          expect(r.same).toBe(true);
          expect(r.shows).toBe(true);
          const inherent = kind === 'nested' && mName === 'teclado ↑ b2' && oName === 'A borra el vecino b1/b2';
          // D725: b2 entra en los hijos de b1; el borrado concurrente de b1 gana sobre los hijos nuevos.
          // Este límite está cerrado por un aviso, no por aceptar cualquier pérdida en la matriz.
          expect(r.lost).toEqual(inherent ? ['charlie'] : []);
          if (inherent) expect(r.noticeB?.text).toContain('charlie');
          if (oName.startsWith('A escribe')) {
            const expectedId = oName === 'A escribe en el movido' ? movedId : movedId === 'b2' ? 'b1' : movedId === 'b1' ? 'b2' : 'b0';
            const written = r.final.filter((x) => x.includes('ZZZ'));
            for (const block of written) expect(block.split(':')[0]).toBe(expectedId);
            if (written.length === 0) expect(r.noticeA?.text).toContain('ZZZ');
          }
        });
      }
    }
  }
});

describe('E20: deshacer un mover (Ctrl+Z) mientras el otro borra', () => {
  for (const kind of ['image', 'paragraph'] as Kind[]) {
    it(`${kind}: B mueve b2 arriba (se sube), después sin red deshace; A borra b2`, async () => {
      const docA = new Y.Doc();
      const docB = new Y.Doc();
      const net = connect(docA, docB);
      const A = mountWith(docA);
      const B = mountWith(docB);
      A.replaceBlocks(A.document, page(kind) as never);
      net.flush();
      await tick();
      const start = blocks(docB);
      kb('b2', 'up')(B);
      net.flush();
      await tick(600);
      const moved = blocks(docA);
      net.offline();
      key(B, 'z', { ctrlKey: true });
      await tick();
      const undone = blocks(docB);
      del('b2')(A);
      await tick();
      net.online();
      net.flush();
      await tick();
      net.flush();
      await tick();
      const final = blocks(docA);
      if (LOG) appendFileSync(LOG, `deshacer ${kind} | movido ${moved.join(',')} | deshecho ${undone.join(',')} | final ${final.join(',')}\n`);
      expect(undone).toEqual(start);
      expect(sameDocs(docA, docB)).toBe(true);
      // b1 nadie lo borró.
      expect(final.map((x) => x.split(':')[1])).toContain(start[1].split(':')[1]);
    });
  }
});
