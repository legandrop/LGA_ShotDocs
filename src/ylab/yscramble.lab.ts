// @vitest-environment jsdom
// Diff ambiguity: typing text that repeats its neighbour is written to Yjs at a different anchor than the caret,
// so a concurrent insert by the other device lands inside it.
import { afterEach, it } from 'vitest';
import * as Y from '@y/y';
import { caretAt, editors, mk, net, text, tick, seeded } from './yh';
afterEach(() => { for (const e of editors.splice(0)) e.unmount(); document.body.replaceChildren(); });
it('scramble', async () => {
  const cases: [string, number, string, number, string][] = [
    ['cantar', 0, 'can', 3, 'X'],
    ['de la casa', 0, 'de ', 3, 'toda '],
    ['el plano', 3, 'plano ', 3, 'primer '],
  ];
  for (const [base, atA, sA, atB, sB] of cases) {
    const a = seeded(), b = seeded();
    const nw = net(a, b, 'async');
    const A = mk(a, 'a'), B = mk(b, 'b');
    A.replaceBlocks(A.document, [{ id: 'p1', type: 'paragraph', content: base }] as never);
    nw.flush(); await tick();
    nw.offline();
    caretAt(A, 'p1', atA); A.insertInlineContent(sA);
    caretAt(B, 'p1', atB); B.insertInlineContent(sB);
    const offA = text(A), offB = text(B);
    nw.online(); nw.flush(); await tick();
    console.log(`base "${base}": A offline "${offA}", B offline "${offB}" -> merged "${text(A)}" (B sees "${text(B)}") clientIDs A=${a.clientID} B=${b.clientID}`);
    for (const e of editors.splice(0)) e.unmount();
  }
});
