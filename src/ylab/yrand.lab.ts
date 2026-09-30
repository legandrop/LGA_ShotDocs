// @vitest-environment jsdom
if (process.env.EMPTYTEXT) (globalThis as any).__EMPTYTEXT = true;
import type { PartialBlock } from '@blocknote/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, it } from 'vitest';
import * as Y from '@y/y';
import { editors, mk, net, pmFromY, press, tick, um, view, yConverged, yText , seeded } from './yh';

afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  document.body.replaceChildren();
});

const tokens = (s: string) => new Set(s.match(/[\[{]\d+[\]}]/g) ?? []);
const stripIds = (n: PMNode) => JSON.stringify(n.toJSON(), (k, v) => (k === 'id' ? undefined : v));

it('random two-editor run with Y-level checks', async () => {
  const MODE = (process.env.SYNCMODE ?? 'sync') as 'sync' | 'async';
  const seeds = Number(process.env.SEEDS ?? 20);
  const steps = Number(process.env.STEPS ?? 40);
  const noNodeSel = !!process.env.NO_NODESEL;
  const c: Record<string, number> = {};
  const inc = (k: string) => (c[k] = (c[k] ?? 0) + 1);
  const samples: Record<string, string[]> = {};
  const sample = (k: string, s: string) => { inc(k); (samples[k] ??= []).length < 3 && samples[k].push(s); };
  let where = '';
  const onError = (e: ErrorEvent) => { e.preventDefault(); classifyErr(String(e.error?.stack ?? e.message), 'event'); };
  const classifyErr = (s: string, via: string) => {
    const k = /restoreRelativeSelection/.test(s) ? 'ERR restoreRelativeSelection' : /deeper than insertion/.test(s) ? 'ERR Inserted content deeper' : /out of range/.test(s) ? 'ERR position out of range' : 'ERR other: ' + s.split('\n')[0].slice(0, 80);
    sample(k + ` (${via})`, where + ' :: ' + s.split('\n').slice(0, 6).join(' | ').slice(0, 600));
  };
  window.addEventListener('error', onError);
  let tokN = 1000;
  for (let s = 1; s <= seeds; s++) {
    let seed = s * 7919 + 17;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
    for (const e of editors.splice(0)) e.unmount();
    const docA = seeded();
    const docB = seeded();
    const nw = net(docA, docB, MODE);
    const A = mk(docA, 'a');
    const B = mk(docB, 'b');
    let n = 0;
    const blocks: PartialBlock[] = [];
    for (let i = 0; i < 8; i++) blocks.push({ type: rand() < 0.3 ? 'heading' : rand() < 0.8 ? 'paragraph' : 'bulletListItem', content: `[${n++}]` } as never);
    A.replaceBlocks(A.document, blocks as never);
    nw.flush();
    await tick();
    um(A).clear();
    um(B).clear();
    const history: string[] = [];
    let offlineSince: { a: Set<string>; b: Set<string> } | null = null;
    for (let step = 0; step < steps; step++) {
      where = `seed ${s} step ${step}`;
      const E = rand() < 0.6 ? A : B;
      const who = E === A ? 'A' : 'B';
      um(E).stopCapturing();
      const v = view(E);
      const st = v.state;
      const bl: { id: string; pos: number; node: PMNode; ts: number; te: number }[] = [];
      st.doc.descendants((node, pos) => {
        if (node.type.name === 'blockContainer') bl.push({ id: node.attrs.id, pos, node, ts: pos + 2, te: pos + 2 + node.firstChild!.content.size });
        return true;
      });
      const r = rand();
      let kind = '';
      try {
        if (r < 0.3) {
          const b = pick(bl);
          const at = rand() < 0.5 ? b.ts : b.te;
          v.dispatch(st.tr.setSelection(TextSelection.create(st.doc, at)));
          const k = pick(['type', 'type', 'Enter', 'Backspace', 'Delete', 'Tab', 'ShiftTab']);
          kind = `${k}`;
          if (k === 'type') E.insertInlineContent(`{${tokN++}}`);
          else if (k === 'Tab') press(E, 'Tab');
          else if (k === 'ShiftTab') press(E, 'Tab', { shiftKey: true });
          else press(E, k);
        } else if (r < 0.45) {
          const a = pick(bl), b = pick(bl);
          const from = Math.min(a.ts, b.te), to = Math.max(a.ts, b.te);
          if (from === to) continue;
          v.dispatch(st.tr.setSelection(TextSelection.create(st.doc, from, to)));
          kind = 'range-' + pick(['Backspace', 'type', 'Enter']);
          if (kind === 'range-type') E.insertInlineContent(`{${tokN++}}`);
          else press(E, kind.slice(6));
        } else if (r < 0.52 && !noNodeSel) {
          const b = pick(bl);
          v.dispatch(st.tr.setSelection(NodeSelection.create(st.doc, rand() < 0.5 ? b.pos : b.pos + 1)));
          kind = 'nodesel-' + pick(['Backspace', 'keep']);
          if (kind === 'nodesel-Backspace') press(E, 'Backspace');
        } else if (r < 0.6) {
          const b = pick(bl);
          kind = 'retype';
          E.updateBlock(b.id, rand() < 0.5 ? ({ type: 'paragraph' } as never) : ({ type: 'heading', props: { level: 2 } } as never));
        } else if (r < 0.66) {
          kind = 'insert';
          E.insertBlocks([{ type: 'paragraph', content: `{${tokN++}}` } as never], pick(bl).id, rand() < 0.5 ? 'before' : 'after');
        } else if (r < 0.7) {
          kind = 'remove';
          if (bl.length > 1) E.removeBlocks([pick(bl).id]);
        } else if (r < 0.84) {
          kind = rand() < 0.6 ? 'undo' : 'redo';
          if (kind === 'undo') E.undo();
          else E.redo();
        } else if (r < 0.9) {
          kind = nw.n.online ? 'offline' : 'online';
          if (nw.n.online) {
            nw.offline();
            history.push('offline-mark');
            offlineSince = { a: tokens(yText(docA)), b: tokens(yText(docB)) };
          } else {
            const aT = tokens(yText(docA)), bT = tokens(yText(docB));
            const pure = new Y.Doc();
            Y.applyUpdate(pure, Y.encodeStateAsUpdate(docA));
            Y.applyUpdate(pure, Y.encodeStateAsUpdate(docB));
            const pureT = tokens(yText(pure));
            try { nw.online(); } catch (e) { classifyErr(String((e as Error).stack), 'online'); }
            nw.flush();
            await tick();
            const fin = tokens(yText(docA));
            for (const t of pureT) if (!fin.has(t)) sample('LOSS post-merge (in pure CRDT merge, deleted by an editor after merge)', `${where} ${t} hist: ${history.slice(-6).join(';')}`);
            const offOps = history.slice(history.lastIndexOf('offline-mark') + 1).join(';');
            for (const t of new Set([...aT, ...bT])) if (!pureT.has(t)) {
              if (aT.has(t) && bT.has(t)) sample('COLLATERAL: both sides still had it at merge, gone in pure CRDT merge', `${where} ${t} ops while offline: ${offOps}`);
              else {
                const otherHad = aT.has(t) ? offlineSince!.b.has(t) : offlineSince!.a.has(t);
                sample(otherHad ? 'intended: other side deleted it' : "typed offline into a block the other side deleted/recreated", `${where} ${t} ops: ${offOps}`);
              }
            }
          }
        } else {
          kind = 'type-mid';
          const b = pick(bl);
          v.dispatch(st.tr.setSelection(TextSelection.create(st.doc, b.ts + Math.floor(rand() * (b.te - b.ts + 1)))));
          E.insertInlineContent(`{${tokN++}}`);
        }
      } catch (e) {
        classifyErr(String((e as Error).stack), 'call');
      }
      history.push(`${who}:${kind}`);
      try { nw.flush(); } catch (e) { classifyErr(String((e as Error).stack), 'flush'); }
      inc('steps');
      if (!nw.n.online) continue;
      // Checks
      {
        const yIds = docA.get('document-store').toString().match(/blockContainer id="[^"]*"/g) ?? [];
        if (yIds.length !== new Set(yIds).size) sample('dup ids in Y', `${where} hist: ${history.slice(-6).join(';')}`);
        if (yIds.length === 0) inc('Y fragment has no blocks');
      }
      if (!yConverged(docA, docB)) sample('Y DIVERGED', `${where} hist: ${history.slice(-6).join(';')}`);
      const pmA = view(A).state.doc, pmB = view(B).state.doc;
      const yA = pmFromY(A, docA), yB = pmFromY(B, docB);
      for (const [nm, pm, y] of [['A', pmA, yA], ['B', pmB, yB]] as const) {
        if (!pm.eq(y)) {
          const idsOnly = stripIds(pm) === stripIds(y);
          const dump = (d: PMNode) => { const o: string[] = []; d.descendants((x) => { if (x.type.name === 'blockContainer') o.push(`${x.firstChild!.type.name}:"${x.firstChild!.textContent}"${x.childCount > 1 ? '[' + x.lastChild!.type.name + ']' : ''}`); return true; }); return o.join(' '); };
          sample(idsOnly ? 'PM!=Y ids only' : 'PM!=Y content', `${where} ${nm} hist: ${history.slice(-6).join(';')}\n     PM: ${dump(pm)}\n     Y : ${dump(y)}`);
        }
      }
      const docJsonEq = JSON.stringify(A.document) === JSON.stringify(B.document);
      if (!docJsonEq) {
        const idsOnly = stripIds(pmA) === stripIds(pmB);
        inc(idsOnly ? 'A.document!=B.document (ids only)' : 'A.document!=B.document (content)');
      }
      // (e) latent write: a selection-only dispatch that produces a Y update
      for (const [nm, E2, d] of [['A', A, docA], ['B', B, docB]] as const) {
        let wrote = 0;
        const on = (_u: Uint8Array, o: unknown) => { if (o !== 'remote') wrote++; };
        d.on('update', on);
        const v2 = view(E2);
        try { v2.dispatch(v2.state.tr.setSelection(TextSelection.atStart(v2.state.doc))); } catch { /* */ }
        d.off('update', on);
        if (wrote) sample('latent write on selection-only dispatch', `${where} ${nm} hist: ${history.slice(-4).join(';')}`);
      }
      try { nw.flush(); } catch (e) { classifyErr(String((e as Error).stack), 'flush2'); }
    }
  }
  window.removeEventListener('error', onError);
  console.log(`MODE=${MODE} NO_NODESEL=${noNodeSel}\n` + Object.entries(c).map(([k, v]) => `${v}\t${k}`).join('\n'));
  if (process.env.SAMPLES) for (const [k, v] of Object.entries(samples)) console.log(`== ${k}\n  ` + v.join('\n  '));
}, 3_600_000);
