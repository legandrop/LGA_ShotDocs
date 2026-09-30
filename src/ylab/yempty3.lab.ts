// @vitest-environment jsdom
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, it } from 'vitest';
import * as Y from '@y/y';
import { buildSeed } from '../sync/structure';
import { editors, mk, press, view, yText } from './yh';
afterEach(() => { for (const e of editors.splice(0)) e.unmount(); document.body.replaceChildren(); });

if (process.env.EMPTYTEXT) (globalThis as any).__EMPTYTEXT = true;
function run(sch: string[], fromSeed: boolean, pickR: () => number = () => 0) {
  const docA = new Y.Doc(), docB = new Y.Doc();
  if (fromSeed) { const sd = buildSeed('page-1'); Y.applyUpdate(docA, sd); Y.applyUpdate(docB, sd); }
  const out = { A: [] as Uint8Array[], B: [] as Uint8Array[] };
  docA.on('update', (u: Uint8Array, o: unknown) => { if (o !== 'remote') out.A.push(u); });
  docB.on('update', (u: Uint8Array, o: unknown) => { if (o !== 'remote') out.B.push(u); });
  const A = mk(docA, 'a'), B = mk(docB, 'b');
  if (!fromSeed) {
    A.replaceBlocks(A.document, [{ id: 'p1', type: 'paragraph', content: '' }] as never);
    for (const u of out.A.splice(0)) Y.applyUpdate(docB, u, 'remote');
    out.B.length = 0;
  }
  const typed: string[] = [];
  let n = 0;
  for (const op of sch) {
    const E = op[1] === 'A' ? A : B;
    if (op[0] === 'd') { const to = op[1] === 'A' ? docB : docA; for (const u of out[op[1] as 'A' | 'B'].splice(0)) Y.applyUpdate(to, u, 'remote'); continue; }
    const v = view(E);
    const ends: number[] = [];
    v.state.doc.descendants((nd, p) => { if (nd.isTextblock) { ends.push(p + 1, p + 1 + nd.content.size); return false; } return true; });
    const bi = Math.floor(pickR() * (ends.length / 2)); const pos = op[2] === 's' ? ends[2 * bi] : ends[2 * bi + 1];
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos)));
    if (op[0] === 'E') press(E, 'Enter');
    else { const t = `{${op[1]}${n++}}`; typed.push(t); E.insertInlineContent(t); }
  }
  for (let i = 0; i < 3; i++) { for (const u of out.A.splice(0)) Y.applyUpdate(docB, u, 'remote'); for (const u of out.B.splice(0)) Y.applyUpdate(docA, u, 'remote'); }
  const fin = yText(docA);
  for (const e of editors.splice(0)) e.unmount();
  return { lost: typed.filter((t) => !fin.includes(t)), fin, dups: typed.filter((t) => fin.split(t).length > 2) };
}

it('EMPTY3 random schedule search', { timeout: 3600000 }, () => {
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const ops = ['TAe', 'TAs', 'TBe', 'TBs', 'EAe', 'EBe', 'EAs', 'dA', 'dB', 'dA', 'dB'];
  const found: string[] = [];
  let dupRuns = 0;
  const lostBy = { seed: 0, replaceBlocks: 0 };
  for (const fromSeed of [true, false]) for (let i = 0; i < Number(process.env.N ?? 400); i++) {
    const len = 6 + Math.floor(rand() * 14);
    const sch = Array.from({ length: len }, () => ops[Math.floor(rand() * ops.length)]);
    const sub = Math.floor(rand() * 1e9); let s2 = sub; const pr = () => (s2 = (s2 * 1103515245 + 12345) % 2147483648) / 2147483648; const r = run(sch, fromSeed, pr); (sch as any).sub = sub;
    if (r.dups.length) dupRuns++;
    if (r.lost.length) lostBy[fromSeed ? 'seed' : 'replaceBlocks']++;
    if (r.lost.length && !process.env.NOMIN) {
      let cur = [...sch];
      const loses = (c: string[]) => { let s3 = sub; const pr3 = () => (s3 = (s3 * 1103515245 + 12345) % 2147483648) / 2147483648; return run(c, fromSeed, pr3); };
      for (let changed = true; changed; ) { changed = false; for (let k = 0; k < cur.length; k++) { const c = cur.filter((_, j) => j !== k); const rr = loses(c); if (rr.lost.length) { cur = c; changed = true; break; } } }
      const rr = loses(cur);
      found.push(`MIN ${cur.join(' ')} => lost ${rr.lost} final "${rr.fin}" (sub ${sub})`);
    }
    if (r.lost.length) found.push(`${fromSeed ? 'seed' : 'replaceBlocks'} len ${len}: ${sch.join(' ')} => lost ${r.lost} final "${r.fin}"`);
  }
  found.sort((a, b) => a.length - b.length);
  console.log(`EMPTY3 losing seed=${lostBy.seed} replaceBlocks=${lostBy.replaceBlocks} of ${Number(process.env.N ?? 400)} each, runs with duplicated text ${dupRuns}\n` + [...found.filter((f) => f.startsWith('seed')).slice(0, 8), ...found.filter((f) => !f.startsWith('seed')).slice(0, 4)].join('\n'));
});
