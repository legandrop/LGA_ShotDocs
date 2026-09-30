// @vitest-environment jsdom
import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, it } from 'vitest';
import * as Y from '@y/y';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { caretAt, editors, mk, pmMatchesY, text, tick, view, yText } from './yh';

const devices: Device[] = [];
afterEach(() => { for (const e of editors.splice(0)) e.unmount(); for (const d of devices.splice(0)) { d.engine.stop(); d.db.close(); } });
const posOf = (e: any, id: string) => { let pos = -1; view(e).state.doc.descendants((n, p) => { if (n.type.name === 'blockContainer' && n.attrs.id === id) pos = p; return pos < 0; }); return pos; };

async function setup() {
  const server = new FakeServer();
  const a = await makeDevice(server); const b = await makeDevice(server); devices.push(a, b);
  const pageId = await a.tree.create(null, 'Escena');
  await a.engine.syncNow(); await b.engine.syncNow();
  const docA = await a.docs.open(pageId, { seed: true });
  const A = mk(docA, 'a');
  A.replaceBlocks(A.document, [
    { id: 'p1', type: 'paragraph', content: 'alpha' },
    { id: 'p2', type: 'paragraph', content: 'beta' },
    { id: 'p3', type: 'paragraph', content: 'gamma' },
  ] as never);
  await a.docs.flush(pageId); await a.docs.pushPage(pageId, a.remote);
  const docB = await b.docs.open(pageId);
  await b.docs.pullPage(pageId, b.remote);
  const B = mk(docB, 'b');
  await tick();
  return { server, a, b, pageId, A, B, docA, docB };
}

it('APP1 real sync path: remote change while A has a block node-selected, then A types', async () => {
  const { a, b, pageId, A, B, docA, docB } = await setup();
  console.log('start A:', text(A), '| B:', text(B));
  // A clicks on block p3 (NodeSelection of its blockContent, as clicking an image does)
  view(A).dispatch(view(A).state.tr.setSelection(NodeSelection.create(view(A).state.doc, posOf(A, 'p3') + 1)));
  // B types in p1 and deletes p3, then syncs
  caretAt(B, 'p1', 'end'); B.insertInlineContent(' BBB');
  B.removeBlocks(['p3']);
  await b.docs.flush(pageId); await b.docs.pushPage(pageId, b.remote);
  let err = '';
  try { await a.docs.pullPage(pageId, a.remote); } catch (e) { err = String(e).slice(0, 80); }
  console.log('A pull err:', err || '-', '| PM A==Y', pmMatchesY(A, docA), '| PM A:', text(A), '| Y A:', yText(docA));
  // A keeps typing elsewhere and syncs
  caretAt(A, 'p2', 'end'); A.insertInlineContent(' AAA');
  await a.docs.flush(pageId); await a.docs.pushPage(pageId, a.remote);
  await b.docs.pullPage(pageId, b.remote);
  console.log('FINAL A:', text(A), '| B:', text(B), '| Y B:', yText(docB));
});
