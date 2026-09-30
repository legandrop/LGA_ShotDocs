// @vitest-environment jsdom
import type { PartialBlock } from '@blocknote/core';
import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, it } from 'vitest';
import * as Y from '@y/y';
import { caretAt, editors, mk, net, pmMatchesY, tick, yText, view, text, yConverged, um , seeded } from './yh';
afterEach(() => { for (const e of editors.splice(0)) e.unmount(); document.body.replaceChildren(); });
const initial = [
  { id: 'p1', type: 'paragraph', content: 'alpha' },
  { id: 'p2', type: 'paragraph', content: 'beta' },
  { id: 'p3', type: 'paragraph', content: 'gamma' },
] as PartialBlock[];
const posOf = (e: any, id: string) => { let pos = -1; view(e).state.doc.descendants((n, p) => { if (n.type.name === 'blockContainer' && n.attrs.id === id) pos = p; return pos < 0; }); return pos; };
const selectNode = (e: any, id: string, inner = false) => { const v = view(e); v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, posOf(e, id) + (inner ? 1 : 0)))); };

it('R1 remote delete of the block A has node-selected', async () => {
  for (const inner of [false, true]) for (const remoteOp of ['delete p2', 'delete p1', 'retype p2', 'type p1']) {
    const docA = seeded(), docB = seeded();
    const nw = net(docA, docB, 'async');
    const A = mk(docA, 'a'), B = mk(docB, 'b');
    A.replaceBlocks(A.document, initial as never); nw.flush(); await tick();
    selectNode(A, 'p2', inner);
    if (remoteOp === 'delete p2') B.removeBlocks(['p2']);
    if (remoteOp === 'delete p1') B.removeBlocks(['p1']);
    if (remoteOp === 'retype p2') B.updateBlock('p2', { type: 'heading', props: { level: 2 } } as never);
    if (remoteOp === 'type p1') { caretAt(B, 'p1', 'end'); B.insertInlineContent(' BBB'); }
    let err = '';
    try { nw.flush(); } catch (e) { err = String(e).slice(0, 90); }
    const stale = !pmMatchesY(A, docA);
    // A keeps working: types somewhere
    let err2 = '';
    try { caretAt(A, 'p3', 'end'); A.insertInlineContent(' AAA'); nw.flush(); } catch (e) { err2 = String(e).slice(0, 90); }
    await tick();
    console.log(`R1 [${inner ? 'blockContent' : 'blockContainer'} selected] remote ${remoteOp}: applyUpdate err=${err || '-'} | PM A stale=${stale} | after A types: Y=${yText(docA)} | B sees ${text(B)} | conv=${yConverged(docA, docB)} ${err2}`);
  }
});

it('R2 undo with node selection', async () => {
  for (const variant of ['del-then-undo-selected', 'type-then-select-other-undo']) {
    const docA = seeded(), docB = seeded();
    const nw = net(docA, docB, 'async');
    const A = mk(docA, 'a'), B = mk(docB, 'b');
    A.replaceBlocks(A.document, initial as never); nw.flush(); await tick(); um(A).clear();
    let err = '';
    try {
      if (variant === 'del-then-undo-selected') { um(A).stopCapturing(); A.insertBlocks([{ id: 'n1', type: 'paragraph', content: 'new' } as never], 'p2', 'after'); um(A).stopCapturing(); selectNode(A, 'n1'); A.undo(); }
      else { caretAt(A, 'p2', 'end'); A.insertInlineContent('X'); um(A).stopCapturing(); selectNode(A, 'p3'); A.undo(); }
      nw.flush();
    } catch (e) { err = String(e).slice(0, 100); }
    console.log(`R2 ${variant}: err=${err || '-'} PM A==Y ${pmMatchesY(A, docA)} A=${text(A)} Y=${yText(docA)} B=${text(B)}`);
  }
});

it('R3 app-like merged remote batch while A has a blockContent node selected', async () => {
  for (const withRetype of [true, false]) {
    const docA = seeded(), docB = seeded();
    const nw = net(docA, docB, 'async');
    const A = mk(docA, 'a'), B = mk(docB, 'b');
    A.replaceBlocks(A.document, initial as never); nw.flush(); await tick();
    selectNode(A, 'p2', true);
    nw.offline();
    const svA = Y.encodeStateVector(docA);
    caretAt(B, 'p1', 'end'); B.insertInlineContent(' BBB');
    if (withRetype) B.updateBlock('p2', { type: 'heading', props: { level: 2 } } as never);
    // like pullPage: all of B's new updates merged into one and applied once
    const batch = Y.encodeStateAsUpdate(docB, svA);
    let err = '';
    try { Y.applyUpdate(docA, batch, 'remote'); } catch (e) { err = String(e).slice(0, 70); }
    const staleText = text(A);
    nw.online();
    caretAt(A, 'p3', 'end'); A.insertInlineContent(' AAA'); nw.flush(); await tick();
    console.log(`R3 retype=${withRetype}: err=${err || '-'} | PM A right after remote: ${staleText} | after A types, Y: ${yText(docA)} | B: ${text(B)} | B p2 type: ${B.getBlock('p2')?.type}`);
  }
});

it('R4 matrix', async () => {
  const ops: Record<string, (B: any, id: string) => void> = {
    'delete self': (B, id) => B.removeBlocks([id]),
    'delete prev': (B, id) => { const i = ['p1','p2','p3'].indexOf(id); if (i > 0) B.removeBlocks([['p1','p2','p3'][i-1]]); },
    'delete next': (B, id) => { const i = ['p1','p2','p3'].indexOf(id); if (i < 2) B.removeBlocks([['p1','p2','p3'][i+1]]); },
    'retype self': (B, id) => B.updateBlock(id, { type: 'heading', props: { level: 2 } }),
    'prop self': (B, id) => B.updateBlock(id, { props: { textColor: 'red' } }),
    'text self': (B, id) => { caretAt(B, id, 'end'); B.insertInlineContent('Z'); },
    'indent self': (B, id) => { caretAt(B, id, 'start'); B.prosemirrorView.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); },
    'move self up': (B, id) => { caretAt(B, id, 'start'); B.moveBlocksUp(); },
    'delete all but self': (B, id) => B.removeBlocks(['p1','p2','p3'].filter((x) => x !== id)),
  };
  const rows: string[] = [];
  for (const id of ['p1', 'p2', 'p3']) for (const inner of [false, true]) for (const [name, op] of Object.entries(ops)) {
    const docA = seeded(), docB = seeded();
    const nw = net(docA, docB, 'async');
    const A = mk(docA, 'a'), B = mk(docB, 'b');
    A.replaceBlocks(A.document, initial as never); nw.flush(); await tick();
    selectNode(A, id, inner);
    try { op(B, id); } catch (e) { rows.push(`skip ${name}: ${e}`); continue; }
    let err = '';
    try { nw.flush(); } catch (e) { err = String(e).slice(0, 60); }
    if (err) rows.push(`THROWS: select ${id} ${inner ? 'blockContent' : 'blockContainer'} / remote ${name}: ${err}`);
    for (const e of editors.splice(0)) e.unmount();
  }
  console.log(rows.join('\n'));
});
