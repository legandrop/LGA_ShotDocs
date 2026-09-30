// @vitest-environment jsdom
import { afterEach, it } from 'vitest';
import * as Y from '@y/y';
import { buildSeed } from '../sync/structure';
import { caretAt, editors, mk, net, text, tick, um, yText, yXml } from './yh';
afterEach(() => { for (const e of editors.splice(0)) e.unmount(); document.body.replaceChildren(); });
it('seeded: no write on mount, basic sync + undo', async () => {
  const a = new Y.Doc(), b = new Y.Doc();
  Y.applyUpdate(a, buildSeed('page-1')); Y.applyUpdate(b, buildSeed('page-1'));
  let writes = 0; a.on('update', (_u: Uint8Array, o: unknown) => { if (o !== 'remote') writes++; });
  const nw = net(a, b, 'async');
  const A = mk(a, 'a'); const B = mk(b, 'b');
  await tick();
  console.log('writes on mount (A):', writes, 'Y:', yXml(a), 'PM ids', A.document.map((x) => x.id));
  A.replaceBlocks(A.document, [{ id: 'p1', type: 'paragraph', content: 'alpha' }, { id: 'p2', type: 'heading', content: 'beta' }] as never);
  nw.flush(); await tick();
  console.log('A:', text(A), '| B:', text(B), '| yText B', yText(b));
  caretAt(B, 'p1', 'end'); B.insertInlineContent(' BBB'); nw.flush(); await tick();
  console.log('after B types A:', text(A));
  um(B).stopCapturing();
  B.undo(); nw.flush(); await tick();
  console.log('after B undo A:', text(A), '| B:', text(B));
});
it('unseeded init race: both devices open an empty page offline, both type, merge', async () => {
  const a = new Y.Doc(), b = new Y.Doc();
  const nw = net(a, b, 'async');
  nw.offline();
  const A = mk(a, 'a'); const B = mk(b, 'b');
  caretAt(A, A.document[0].id, 'end'); A.insertInlineContent('from A');
  caretAt(B, B.document[0].id, 'end'); B.insertInlineContent('from B');
  nw.online(); nw.flush(); await tick();
  console.log('RACE Y:', yText(a), '| A:', text(A), '| B:', text(B));
});
it('seeded race: both devices open a seeded page offline, both type, merge', async () => {
  const a = new Y.Doc(), b = new Y.Doc();
  Y.applyUpdate(a, buildSeed('page-1')); Y.applyUpdate(b, buildSeed('page-1'));
  const nw = net(a, b, 'async');
  nw.offline();
  const A = mk(a, 'a'); const B = mk(b, 'b');
  caretAt(A, A.document[0].id, 'end'); A.insertInlineContent('from A');
  caretAt(B, B.document[0].id, 'end'); B.insertInlineContent('from B');
  nw.online(); nw.flush(); await tick();
  console.log('SEEDED RACE Y:', yText(a), '| A:', text(A), '| B:', text(B));
});
