// @vitest-environment jsdom
// Can Yjs 14 + @y/prosemirror 2.0.0-6 (BlockNote 0.55 /y) read documents written by yjs 13 + y-prosemirror 1.3.7?
// V13DATA=<json file [{page_id,u:"b64,b64,..."}]> uses real page_updates rows; without it, generated v13 docs.
import { readFileSync } from 'node:fs';
import { afterEach, it } from 'vitest';
import * as Y from '@y/y';
import * as Y13 from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { editors, mk, pmFromY, text, tick, yText } from './yh';
afterEach(() => { for (const e of editors.splice(0)) e.unmount(); document.body.replaceChildren(); });

function text13(d: Y13.Doc): string {
  const out: string[] = [];
  const walk = (t: Y13.XmlElement | Y13.XmlFragment | Y13.XmlText) => {
    if (t instanceof Y13.XmlText) out.push(t.toString().replace(/<[^>]+>/g, ''));
    else t.toArray().forEach((c) => walk(c as never));
  };
  walk(d.getXmlFragment(CONTENT_FRAGMENT));
  return out.filter(Boolean).join(' | ');
}

it('v13 page_updates on v14', async () => {
  const file = process.env.V13DATA;
  const pages: { page_id: string; u: string }[] = file ? JSON.parse(readFileSync(file, 'utf8')) : [];
  const rows: string[] = [];
  for (const p of pages) {
    const ups = p.u.split(',').map((b) => new Uint8Array(Buffer.from(b, 'base64')));
    const d13 = new Y13.Doc();
    for (const u of ups) Y13.applyUpdate(d13, u);
    const t13 = text13(d13);
    let decodeErr = '';
    const d14 = new Y.Doc();
    try { for (const u of ups) Y.applyUpdate(d14, u as Uint8Array<ArrayBuffer>); } catch (e) { decodeErr = String(e).slice(0, 80); }
    const merged14 = (() => { try { const m = Y.mergeUpdates(ups as Uint8Array<ArrayBuffer>[]); const d = new Y.Doc(); Y.applyUpdate(d, m); return 'ok'; } catch (e) { return String(e).slice(0, 60); } })();
    const sv = Buffer.from(Y.encodeStateVector(d14)).equals(Buffer.from(Y13.encodeStateVector(d13)));
    // v13 update format re-encoded by v14 readable by v13?
    let back = '';
    try { const d = new Y13.Doc(); Y13.applyUpdate(d, Y.encodeStateAsUpdate(d14)); back = text13(d) === t13 ? 'same' : 'DIFF'; } catch (e) { back = 'ERR ' + String(e).slice(0, 40); }
    // render through the v14 binding
    let rendered = '', renderErr = '', writes = 0;
    try {
      d14.on('update', () => writes++);
      const E = mk(d14, 'x');
      await tick();
      rendered = text(E);
    } catch (e) { renderErr = String(e).slice(0, 80); }
    const yAfter = yText(d14);
    rows.push(`${p.page_id.slice(0, 8)} ups=${ups.length} decodeErr=${decodeErr || '-'} merge=${merged14} svEq=${sv} v14->v13=${back}\n   v13 text : ${t13.slice(0, 120)}\n   v14 PM   : ${rendered.slice(0, 120)} ${renderErr}\n   v14 Y after mount (writes=${writes}): ${yAfter.slice(0, 120)}`);
    for (const e of editors.splice(0)) e.unmount();
  }
  console.log(rows.join('\n'));
});

it('generated v13 doc (y-prosemirror 1 shape: nested XmlText) on v14', async () => {
  const d13 = new Y13.Doc();
  const frag = d13.getXmlFragment(CONTENT_FRAGMENT);
  const g = new Y13.XmlElement('blockGroup'), c = new Y13.XmlElement('blockContainer'), p = new Y13.XmlElement('paragraph'), t = new Y13.XmlText();
  d13.transact(() => {
    frag.insert(0, [g]); g.insert(0, [c]); c.setAttribute('id', 'b1'); c.insert(0, [p]);
    p.setAttribute('backgroundColor', 'default'); p.setAttribute('textColor', 'default'); p.setAttribute('textAlignment', 'left');
    p.insert(0, [t]); t.insert(0, 'hello '); t.insert(6, 'world', { bold: true });
  });
  const d14 = new Y.Doc();
  Y.applyUpdate(d14, Y13.encodeStateAsUpdate(d13) as Uint8Array<ArrayBuffer>);
  console.log('v14 raw toString:', d14.get(CONTENT_FRAGMENT).toString());
  let pm = ''; try { const E = mk(d14, 'x'); await tick(); pm = text(E) + ' | doc=' + JSON.stringify(E.document.map((b) => [b.id, b.type, b.content])); } catch (e) { pm = 'ERR ' + String(e).slice(0, 100); }
  console.log('v14 editor shows:', pm, '| Y after:', d14.get(CONTENT_FRAGMENT).toString());
  try { console.log('deltaToPNode:', pmFromY(editors[0], d14).textContent); } catch (e) { console.log('deltaToPNode ERR', String(e).slice(0, 80)); }
});
