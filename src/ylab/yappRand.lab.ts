// @vitest-environment jsdom
if (process.env.EMPTYTEXT) (globalThis as any).__EMPTYTEXT = true;
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, it } from 'vitest';
import * as Y from '@y/y';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { editors, mk, press, tick, view, yConverged, yText } from './yh';
import { CONTENT_FRAGMENT } from '../sync/structure';

const devices: Device[] = [];
afterEach(() => { for (const e of editors.splice(0)) e.unmount(); for (const d of devices.splice(0)) { d.engine.stop(); d.db.close(); } });

it('app sync path, typing-only random ops: nothing dropped', async () => {
  const seeds = Number(process.env.SEEDS ?? 10);
  const problems: string[] = [];
  let tokN = 1;
  for (let s = 1; s <= seeds; s++) {
    let seed = s * 31337 + 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (const e of editors.splice(0)) e.unmount();
    const server = new FakeServer();
    const a = await makeDevice(server); const b = await makeDevice(server); devices.push(a, b);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow(); await b.engine.syncNow();
    const docA = await a.docs.open(pageId, { seed: true });
    const docB = await b.docs.open(pageId, { seed: true });
    const A = mk(docA, 'a'), B = mk(docB, 'b');
    for (const [nm, d] of [['A', docA], ['B', docB]] as const) {
      let tb = '';
      d.on('beforeTransaction', () => { tb = yText(d); });
      d.on('afterTransaction', (tr: any) => {
        const now = yText(d);
        const lostT = (tb.match(/\{\d+\}/g) ?? []).filter((t) => !now.includes(t));
        const roots = d.get(CONTENT_FRAGMENT).length;
        if (lostT.length || roots > 1) console.log(`TX ${nm} seed ${s} origin=${String(tr.origin?.key ?? tr.origin?.toString?.() ?? tr.origin)} lost=${lostT} roots=${roots}`);
      });
      let inRemote = false; let before = '';
      let beforeXml = '';
      d.on('beforeAllTransactions', () => { before = yText(d); beforeXml = d.get(CONTENT_FRAGMENT).toString(); });
      d.on('beforeTransaction', (tr: any) => { if (String(tr.origin?.toString?.() ?? '').includes('remote')) inRemote = true; });
      d.on('afterAllTransactions', () => { if (inRemote && process.env.POSTMERGE) { const now = yText(d); const lostT = (before.match(/\{\d+\}/g) ?? []).filter((t) => !now.includes(t)); const remoteAdded = true; if (lostT.length) console.log(`POSTMERGE ${nm} seed ${s}: after remote apply (incl. nested editor writes) tokens vanished: ${lostT}\n  BEFORE ${beforeXml.replace(/ (backgroundColor|textColor|textAlignment|driveCard|question|script)="[^"]*"/g, '')}\n  AFTER  ${d.get(CONTENT_FRAGMENT).toString().replace(/ (backgroundColor|textColor|textAlignment|driveCard|question|script)="[^"]*"/g, '')}`); } inRemote = false; });
      d.on('update', (_u: Uint8Array, origin: any) => { if (inRemote && origin && !String(origin?.toString?.() ?? origin).includes('remote')) { if (process.env.POSTMERGE) console.log(`NESTED-WRITE ${nm} seed ${s} origin=${String(origin?.key ?? origin?.toString?.() ?? origin)}`); } });
    }
    const typed = new Set<string>();
    const inflight: Promise<unknown>[] = [];
    for (let step = 0; step < 60; step++) {
      const [E, d] = rand() < 0.5 ? [A, a] : [B, b];
      const r = rand();
      if (r < 0.55) {
        const v = view(E);
        const ends: number[] = [];
        v.state.doc.descendants((n, p) => { if (n.isTextblock) { ends.push(p + 1, p + 1 + n.content.size); return false; } return true; });
        const pos = ends[Math.floor(rand() * ends.length)];
        v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos)));
        const t = `{${tokN++}}`;
        typed.add(t);
        if (rand() < 0.15) press(E, 'Enter');
        E.insertInlineContent(t);
        if (!yText(d === a ? docA : docB).includes(t)) problems.push(`seed ${s} step ${step}: token ${t} not even in local doc after typing: ${yText(d === a ? docA : docB).slice(0, 200)}`);
      } else if (r < 0.75) inflight.push(d.docs.pushPage(pageId, d.remote).catch(() => undefined));
      else if (r < 0.95) inflight.push(d.docs.pullPage(pageId, d.remote).catch((e) => console.log('PULLERR seed', s, String(e?.stack ?? e).split('\n').slice(0, 5).join(' / ').slice(0, 400))));
      else server.loseNextPushResponse = true;
      if (rand() < 0.3) { await Promise.all(inflight.splice(0)); await tick(1); }
      if (process.env.STEPLOG && Number(process.env.STEPLOG) === s) console.log(`STEP ${step} ${E === A ? 'A' : 'B'} r=${r.toFixed(2)} ${r < 0.55 ? 'type ' + (tokN - 1) : r < 0.75 ? 'push' : r < 0.95 ? 'pull' : 'lose'} | A: ${yText(docA)} | B: ${yText(docB)} | PM A: ${view(A).state.doc.textBetween(0, view(A).state.doc.content.size, ' | ')}`);
      if (process.env.TRACE) { const fa = yText(docA), fb = yText(docB); const lost = [...typed].filter((t) => !fa.includes(t) && !fb.includes(t)); if (lost.length) { problems.push(`seed ${s} step ${step} after ${r.toFixed(2)}: lost ${lost} | A: ${fa.slice(0,300)} | B: ${fb.slice(0,300)}`); typed.clear(); } }
    }
    await Promise.all(inflight.splice(0));
    server.loseNextPushResponse = false;
    for (let i = 0; i < 3; i++) for (const d of [a, b]) { await d.docs.flush(pageId); await d.docs.pushPage(pageId, d.remote); await d.docs.pullPage(pageId, d.remote); }
    await tick();
    const srv = new Y.Doc();
    Y.applyUpdate(srv, Y.mergeUpdates((server.updates.get(pageId) ?? []).map((u) => u.data)));
    const fin = yText(docA);
    const missing = [...typed].filter((t) => !fin.includes(t));
    const conv = yConverged(docA, docB) && srv.get(CONTENT_FRAGMENT).toString() === docA.get(CONTENT_FRAGMENT).toString();
    // A token whose characters are all still there but out of order is scrambled, not deleted.
    const chars = fin.replace(/ \| /g, '');
    const gone = missing.filter((t) => !chars.includes(t.slice(1, -1)));
    if (!conv || missing.length) problems.push(`seed ${s}: converged(A,B,server)=${conv} missing=${missing.join(',')} (deleted: ${gone.join(',') || 'none'})${process.env.SHOWFIN ? ' fin=' + fin.slice(0, 400) : ''}`);
    for (const e of editors.splice(0)) e.unmount();
    a.docs.close(pageId); b.docs.close(pageId);
  }
  console.log(`APPRAND seeds=${seeds} problems=${problems.length}\n` + problems.join('\n'));
}, 600000);
