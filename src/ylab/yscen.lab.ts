// @vitest-environment jsdom
import type { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { afterEach, it } from 'vitest';
import * as Y from '@y/y';
import { caretAt, editors, mk, net, outline, pmMatchesY, press, text, tick, yConverged, yText , seeded } from './yh';

afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  document.body.replaceChildren();
});

const initial: PartialBlock[] = [
  { id: 'h1', type: 'heading', props: { level: 1 }, content: 'Title' },
  { id: 'p1', type: 'paragraph', content: 'alpha beta' },
  { id: 'p2', type: 'paragraph', content: 'gamma delta' },
  { id: 'p3', type: 'paragraph', content: 'epsilon' },
] as never;

type Op = (A: BlockNoteEditor, B: BlockNoteEditor) => void | Promise<void>;
const typeAt = (e: BlockNoteEditor, id: string, where: 'start' | 'end' | number, s: string) => {
  caretAt(e, id, where);
  e.insertInlineContent(s);
};

async function scenario(name: string, opA: Op, opB: Op, mode: 'sync' | 'async' = 'sync') {
  const docA = seeded();
  const docB = seeded();
  const nw = net(docA, docB, mode);
  const A = mk(docA, 'a');
  const B = mk(docB, 'b');
  A.replaceBlocks(A.document, initial as never);
  nw.flush();
  await tick();
  nw.offline();
  const errs: string[] = [];
  try { await opA(A, B); } catch (e) { errs.push('A:' + String(e).slice(0, 120)); }
  try { await opB(A, B); } catch (e) { errs.push('B:' + String(e).slice(0, 120)); }
  const beforeA = text(A);
  const beforeB = text(B);
  const pure = new Y.Doc();
  Y.applyUpdate(pure, Y.encodeStateAsUpdate(docA));
  Y.applyUpdate(pure, Y.encodeStateAsUpdate(docB));
  const sa = nw.n.sentA, sb = nw.n.sentB;
  nw.online();
  nw.flush();
  await tick();
  const pmEq = JSON.stringify(view(A).state.doc.toJSON()) === JSON.stringify(view(B).state.doc.toJSON());
  console.log(
    `### ${name} [${mode}]\n  A offline: ${beforeA}\n  B offline: ${beforeB}\n  pure CRDT: ${yText(pure)}\n  merged Y : ${yText(docA)}   (post-merge writes A=${nw.n.sentA - sa} B=${nw.n.sentB - sb})\n  PM A     : ${text(A)}\n  PM B     : ${text(B)}\n` +
      `  Y converged=${yConverged(docA, docB)}  PM A==Y ${pmMatchesY(A, docA)}  PM B==Y ${pmMatchesY(B, docB)}  PM A==PM B ${pmEq} ${errs.join(' ')}\n` +
      (process.env.OUTLINE ? outline(A) + '\n--\n' + outline(B) + '\n' : ''),
  );
}
const view = (e: BlockNoteEditor) => e.prosemirrorView!;

it('collateral', async () => {
  const tab = (E: BlockNoteEditor, id: string) => { caretAt(E, id, 'start'); press(E, 'Tab'); };
  const join = (E: BlockNoteEditor, id: string) => { caretAt(E, id, 'start'); press(E, 'Backspace'); };
  await scenario('C1 A indents p2, B joins p3 into p2', (A) => tab(A, 'p2'), (_, B) => join(B, 'p3'), 'async');
  await scenario('C3 A retypes p2, B joins p3 into p2', (A) => void A.updateBlock('p2', { type: 'heading', props: { level: 2 } } as never), (_, B) => join(B, 'p3'), 'async');
  await scenario('C4 A indents p3 under p2, B retypes p2', (A) => tab(A, 'p3'), (_, B) => void B.updateBlock('p2', { type: 'heading', props: { level: 2 } } as never), 'async');
  await scenario('C5 A moves p2 down, B indents p3', (A) => { caretAt(A, 'p2', 'start'); (A as any).moveBlocksDown(); }, (_, B) => tab(B, 'p3'), 'async');
  await scenario('C6 A indents p3 under p2, B indents p2 under p1', (A) => tab(A, 'p3'), (_, B) => tab(B, 'p2'), 'async');
  await scenario('C7 A joins p2 into p1, B joins p3 into p2', (A) => join(A, 'p2'), (_, B) => join(B, 'p3'), 'async');
  await scenario('C8 A retypes p1, B retypes p1 same type', (A) => void A.updateBlock('p1', { type: 'heading', props: { level: 2 } } as never), (_, B) => void B.updateBlock('p1', { type: 'heading', props: { level: 2 } } as never), 'async');
  await scenario('C9 A changes p1 heading level? (h1 level 2), B types in h1', (A) => void A.updateBlock('h1', { props: { level: 2 } } as never), (_, B) => typeAt(B, 'h1', 'end', ' BBB'), 'async');
}, 120000);

it('scenarios', async () => {
  const modes: ('sync' | 'async')[] = ['sync', 'async'];
  for (const m of modes) {
    await scenario('S1 both type in same paragraph', (A) => typeAt(A, 'p1', 'end', ' AAA'), (_, B) => typeAt(B, 'p1', 'start', 'BBB '), m);
    await scenario('S2 A types in p1, B deletes p1', (A) => typeAt(A, 'p1', 'end', ' AAA'), (_, B) => void B.removeBlocks(['p1']), m);
    await scenario('S3 A types in p1, B turns p1 into heading', (A) => typeAt(A, 'p1', 'end', ' AAA'), (_, B) => void B.updateBlock('p1', { type: 'heading', props: { level: 2 } } as never), m);
    await scenario('S4 A types in p2, B indents p2 (Tab)', (A) => typeAt(A, 'p2', 'end', ' AAA'), (_, B) => { caretAt(B, 'p2', 'start'); press(B, 'Tab'); }, m);
    await scenario('S5 A types in p2, B joins p2 into p1 (Backspace at start)', (A) => typeAt(A, 'p2', 'end', ' AAA'), (_, B) => { caretAt(B, 'p2', 'start'); press(B, 'Backspace'); }, m);
    await scenario('S6 A types at end of p2, B splits p2 (Enter mid)', (A) => typeAt(A, 'p2', 'end', ' AAA'), (_, B) => { caretAt(B, 'p2', 5); press(B, 'Enter'); }, m);
    await scenario('S6b A types at start of p2, B splits p2 (Enter mid)', (A) => typeAt(A, 'p2', 'start', 'AAA '), (_, B) => { caretAt(B, 'p2', 5); press(B, 'Enter'); }, m);
    await scenario('S7 A types in p1, B replaces p1 content (updateBlock)', (A) => typeAt(A, 'p1', 'end', ' AAA'), (_, B) => void B.updateBlock('p1', { content: 'BBB' } as never), m);
    await scenario('S8 both retype p1', (A) => void A.updateBlock('p1', { type: 'heading', props: { level: 2 } } as never), (_, B) => void B.updateBlock('p1', { type: 'heading', props: { level: 3 } } as never), m);
    await scenario('S9 A indents p2, B indents p3 -> both under p1?', (A) => { caretAt(A, 'p2', 'start'); press(A, 'Tab'); }, (_, B) => { caretAt(B, 'p3', 'start'); press(B, 'Tab'); }, m);
    await scenario('S9b A indents p2 under p1, B indents p2 too', (A) => { caretAt(A, 'p2', 'start'); press(A, 'Tab'); }, (_, B) => { caretAt(B, 'p2', 'start'); press(B, 'Tab'); }, m);
    await scenario('S10 A types in p3, B moves p3 up', (A) => typeAt(A, 'p3', 'end', ' AAA'), (_, B) => { caretAt(B, 'p3', 'start'); (B as any).moveBlocksUp(); }, m);
    await scenario('S11 A types in p2, B changes p2 textColor prop', (A) => typeAt(A, 'p2', 'end', ' AAA'), (_, B) => void B.updateBlock('p2', { props: { textColor: 'red' } } as never), m);
    await scenario('S12 A splits p1 (Enter), B types in p1 end', (A) => { caretAt(A, 'p1', 5); press(A, 'Enter'); }, (_, B) => typeAt(B, 'p1', 'end', ' BBB'), m);
    await scenario('S13 A deletes range spanning p1..p2, B types in p2 end', (A) => {
      const v = view(A); let from = 0, to = 0;
      v.state.doc.descendants((n, p) => { if (n.type.name === 'blockContainer' && n.attrs.id === 'p1') from = p + 2 + 3; if (n.type.name === 'blockContainer' && n.attrs.id === 'p2') to = p + 2 + 3; return true; });
      v.dispatch(v.state.tr.setSelection((v.state.selection.constructor as any).create(v.state.doc, from, to)));
      press(A, 'Backspace');
    }, (_, B) => typeAt(B, 'p2', 'end', ' BBB'), m);
  }
}, 120000);
