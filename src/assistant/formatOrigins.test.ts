// @vitest-environment jsdom
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { mountEditor, undoManager, unmountAll, view, yText } from '../ui/collabHarness';
import { schema as oldSchema } from '../ui/fixtures/editorSchemaMain';
import type { AssistantEditor } from './assistantUi';
import { applyFormat, planFormat, retakeFormatSnapshot, takeFormatSnapshot, type FormatPlan, type FormatSnapshot } from './format';
import { buildRequest } from './prompt';
afterEach(unmountAll);
const purple = { textColor: 'purple', backgroundColor: 'brown', bold: true };
const pink = { textColor: 'pink', backgroundColor: 'orange', bold: true };
const mixed = [{ type: 'text', text: 'Cá', styles: purple }, { type: 'text', text: 'mara', styles: pink }];
function fixture(content: unknown[] = mixed, second = false, props = { textColor: 'blue', backgroundColor: 'yellow' }, extra: unknown[] = []) {
  const doc = new Y.Doc(), ed = mountEditor(doc), api = ed as unknown as AssistantEditor;
  ed.replaceBlocks(ed.document, [{ id: 'a', type: 'paragraph', props, content }, ...(second ? [{ id: 'b', type: 'paragraph', content: [{ type: 'text', text: 'Lente', styles: { textColor: 'red' } }] }] : []), ...extra] as never);
  undoManager(ed).stopCapturing();
  const v = view(ed), positions: { from: number; to: number }[] = [];
  v.state.doc.descendants((n, pos) => { if (n.isTextblock) positions.push({ from: pos + 1, to: pos + 1 + n.content.size }); });
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, positions[0].from, positions.at(-1)!.to)));
  const fs = takeFormatSnapshot(v.state, api) as FormatSnapshot;
  expect(typeof fs).toBe('object');
  return { doc, ed, api, v, fs };
}
function response(fs: FormatSnapshot, extra = ':', template?: string) {
  const runs = [...fs.origins.runs.values()];
  const spans = runs.map((r, id) => ({ id, origin: r.id, text: r.text + (id === runs.length - 1 ? extra : '') }));
  const token = (id: number) => `SD${fs.origins.nonce}R${id}END`;
  return JSON.stringify({ version: 1, nonce: fs.origins.nonce, markdown: template ?? `## **${spans.map((s) => token(s.id)).join('')}**`, spans });
}
const plan = (fs: FormatSnapshot, answer = response(fs)) => planFormat(answer, fs, 'headings') as FormatPlan;
const logical = (ed: ReturnType<typeof mountEditor>) => JSON.stringify(ed.document);
const core = (ed: ReturnType<typeof mountEditor>) => (ed.document[0] as unknown as { content: unknown[] }).content;
it('reescritura intra-palabra conserva ambos pares y Markdown solicitado; Undo/Redo y esquema anterior', async () => {
  const f = fixture(), before = logical(f.ed), p = plan(f.fs);
  expect(p.mode).toBe('update'); expect(p.styleSafety).toBe(true);
  expect(p.blocks[0].kind === 'text' && p.prepared!.has(p.blocks[0].atoms), 'clave final exacta').toBe(true);
  expect(applyFormat(f.api, f.v, f.fs, p, true).ok).toBe(true);
  expect(core(f.ed), 'colores y frontera Cá/mara independientes').toEqual([{ type: 'text', text: 'Cá', styles: purple }, { type: 'text', text: 'mara:', styles: pink }]);
  const after = logical(f.ed), copy = new Y.Doc(); Y.applyUpdate(copy, Y.encodeStateAsUpdate(f.doc)); const text = yText(copy);
  const old = mountEditor(copy, 'old', oldSchema); await new Promise((resolve) => setTimeout(resolve, 0));
  expect(yText(copy)).toBe(text); expect(logical(old)).toBe(after);
  f.ed.undo(); expect(logical(f.ed)).toBe(before); f.ed.redo(); expect(logical(f.ed)).toBe(after);
});
it('bordes con colores distintos permanecen completos', () => {
  const content = [{ type: 'text', text: ' ', styles: { backgroundColor: 'green', italic: true } }, ...mixed, { type: 'text', text: ' ', styles: { textColor: 'red', underline: true } }];
  const f = fixture(content), p = plan(f.fs);
  expect(applyFormat(f.api, f.v, f.fs, p, true).ok).toBe(true);
  expect(core(f.ed)).toEqual([content[0], mixed[0], { type: 'text', text: 'mara:', styles: pink }, content[3]]);
});
it('ausente no se inventa; default explícito conserva el slot PM', () => {
  const f = fixture([{ type: 'text', text: 'Cá', styles: {} }, { type: 'text', text: 'mara', styles: { backgroundColor: 'default' } }]);
  const source = [...f.fs.origins.runs.values()].map((r) => r.styles);
  expect(applyFormat(f.api, f.v, f.fs, plan(f.fs), true).ok).toBe(true);
  const colors: Record<string, string>[] = [];
  f.v.state.doc.descendants((n) => { if (n.isText) colors.push(Object.fromEntries(n.marks.filter((m) => ['textColor', 'backgroundColor'].includes(m.type.name)).map((m) => [m.type.name, m.attrs.stringValue]))); });
  expect(colors).toEqual(source);
});
it.each(['color', 'bold', 'borde', 'props', 'children'])('cambio concurrente %s no escribe y conserva estado lógico', (kind) => {
  const f = fixture([{ type: 'text', text: ' ', styles: {} }, ...mixed]), p = plan(f.fs);
  const content = JSON.parse(JSON.stringify(core(f.ed)));
  if (kind === 'color') content[2].styles.textColor = 'red';
  if (kind === 'bold') content[1].styles.bold = false;
  if (kind === 'borde') content[0].styles.italic = true;
  if (kind === 'props') f.ed.updateBlock('a', { props: { backgroundColor: 'red' } } as never);
  else if (kind === 'children') f.ed.updateBlock('a', { children: [{ type: 'paragraph', content: 'Hijo' }] } as never);
  else f.ed.updateBlock('a', { content } as never);
  const current = logical(f.ed), updates: Uint8Array[] = []; f.doc.on('update', (u) => updates.push(u));
  expect(applyFormat(f.api, f.v, f.fs, p, true)).toEqual({ ok: false, reason: 'changed' });
  expect(logical(f.ed), 'estado concurrente exacto').toBe(current); expect(updates.length).toBe(0);
});
it('segundo bloque concurrente impide modificar el primero', () => {
  const f = fixture(mixed, true), runs = [...f.fs.origins.runs.values()];
  const template = `## **${runs.slice(0, 2).map((_, i) => `SD${f.fs.origins.nonce}R${i}END`).join('')}**\n## SD${f.fs.origins.nonce}R2END`;
  const p = plan(f.fs, response(f.fs, ':', template));
  f.ed.updateBlock('b', { props: { textColor: 'orange' } } as never); const current = logical(f.ed);
  expect(applyFormat(f.api, f.v, f.fs, p, true)).toEqual({ ok: false, reason: 'changed' }); expect(logical(f.ed)).toBe(current);
});
it('readonly, discard y barrera directa del core no escriben', () => {
  const f = fixture(), p = plan(f.fs), before = logical(f.ed), updates: Uint8Array[] = []; f.doc.on('update', (u) => updates.push(u));
  expect(applyFormat(f.api, f.v, f.fs, p, false)).toEqual({ ok: false, reason: 'readOnly' });
  expect(logical(f.ed), 'Discard conserva captura/documento').toBe(before);
  expect(applyFormat(f.api, f.v, f.fs, { ...p, styleSafety: false }, true)).toEqual({ ok: false, reason: 'styleConflict' });
  expect(logical(f.ed), 'barrera core antes escritura').toBe(before); expect(updates.length).toBe(0);
});
it('Retry toma captura nueva; again viejo permanece inmutable', () => {
  const f = fixture(), wireBefore = JSON.stringify(f.fs.wire), old = plan(f.fs);
  f.ed.updateBlock('a', { content: [{ type: 'text', text: 'Cámara', styles: { textColor: 'red' } }] } as never);
  const fresh = retakeFormatSnapshot(f.v.state, f.fs, f.api) as FormatSnapshot;
  expect(fresh.origins.nonce).not.toBe(f.fs.origins.nonce); expect(JSON.stringify(f.fs.wire)).toBe(wireBefore);
  expect(applyFormat(f.api, f.v, f.fs, old, true)).toEqual({ ok: false, reason: 'changed' });
  expect(applyFormat(f.api, f.v, fresh, plan(fresh), true).ok).toBe(true);
  expect(core(f.ed)).toEqual([{ type: 'text', text: 'Cámara:', styles: { bold: true, textColor: 'red' } }]);
});
it('enlace continuo multicolor conserva rango completo, clone y colores; TYPE pasa antes update', () => {
  const link = { type: 'link', href: 'https://example.invalid/', content: mixed };
  const f = fixture([link, { type: 'text', text: ' Lente', styles: { textColor: 'blue' } }]);
  const trace = f.fs.origins.protected.get('link:1')!;
  expect(trace.to - trace.from, 'rango cubre cola de etiqueta').toBe(6);
  const token = `SD${f.fs.origins.nonce}R0END`, template = `## ${f.fs.snapshot.selected.markdown.replace(' Lente', token)}`;
  const p = plan(f.fs, response(f.fs, ':', template));
  expect(p.styleSafety, 'clone completo enlazado verificable').toBe(true);
  expect(applyFormat(f.api, f.v, f.fs, p, true).ok).toBe(true);
  expect(core(f.ed)[0], 'clone enlazado completo ambos pares').toEqual(link);
  const g = fixture([link, { type: 'text', text: ' Lente', styles: { textColor: 'blue' } }]);
  const t = `## ${g.fs.snapshot.selected.markdown.replace(' Lente', `SD${g.fs.origins.nonce}R0END`)}`;
  const typePlan = plan(g.fs, response(g.fs, '', t)); expect(typePlan.mode).toBe('type');
  expect(applyFormat(g.api, g.v, g.fs, { ...typePlan, prepared: undefined }, true).ok).toBe(true); expect(core(g.ed)[0]).toEqual(link);
});
it('celda/split usa arrays finales exactos con orígenes distintos de texto idéntico', () => {
  const f = fixture([{ type: 'text', text: 'Cá', styles: purple }, { type: 'text', text: ' Cá', styles: pink }], false, { textColor: 'default', backgroundColor: 'default' });
  const token = (id: number) => `SD${f.fs.origins.nonce}R${id}END`;
  const data = JSON.parse(response(f.fs, '', `| ${token(0)} | ${token(1)} |\n| --- | --- |`)); data.spans[1].text = 'Cá';
  const p = planFormat(JSON.stringify(data), f.fs, 'table') as FormatPlan;
  expect(p.mode).toBe('replace'); expect(p.styleSafety).toBe(true);
  const b = p.blocks[0]; expect(b.kind).toBe('table');
  if (b.kind === 'table') for (const cell of b.rows.flat()) expect(p.prepared!.has(cell), 'celda exacta final').toBe(true);
  expect(applyFormat(f.api, f.v, f.fs, p, true).ok).toBe(true);
  const cells = (f.ed.document[0].content as unknown as { rows: { cells: { type: string; content: unknown[] }[] }[] }).rows[0].cells;
  expect(cells.map((c) => c.type)).toEqual(['tableCell', 'tableCell']);
  expect(cells[0].content).toEqual([{ type: 'text', text: 'Cá', styles: { textColor: 'purple', backgroundColor: 'brown' } }]);
  expect(cells[1].content).toEqual([{ type: 'text', text: 'Cá', styles: { textColor: 'pink', backgroundColor: 'orange' } }]);
});
it('marcador de bloque protegido atraviesa TYPE/update intacto y no admite omisión', () => {
  const protectedFixture = () => fixture(mixed, false, { textColor: 'default', backgroundColor: 'default' }, [{ id: 'image', type: 'image', props: { url: '/local.png' } }, { id: 'tail', type: 'paragraph', content: 'Lente' }]);
  const f = protectedFixture();
  let fs = f.fs; const beforeImage = JSON.stringify(f.ed.document[1]);
  const token = (id: number) => `SD${fs.origins.nonce}R${id}END`, marker = fs.snapshot.selected.markdown.split('\n').find((line) => line.startsWith('⟦block:'))!;
  const g = protectedFixture(); fs = g.fs;
  const typePlan = plan(fs, response(fs, '', `## **${token(0)}${token(1)}**\n${marker}\n## ${token(2)}`));
  expect(typePlan.mode).toBe('type'); expect(applyFormat(g.api, g.v, fs, typePlan, true).ok).toBe(true);
  expect(JSON.stringify(g.ed.document[1])).toBe(beforeImage);
  fs = f.fs;
  const p = plan(fs, response(fs, ':', `## **${token(0)}${token(1)}**\n${marker}\n## ${token(2)}`));
  expect(p.styleSafety).toBe(true); expect(applyFormat(f.api, f.v, fs, p, true).ok).toBe(true); expect(JSON.stringify(f.ed.document[1])).toBe(beforeImage);
  const omitted = planFormat(response(fs, ':', `## **${token(0)}${token(1)}**\n## ${token(2)}`), fs, 'headings') as FormatPlan;
  expect(omitted.styleSafety).toBe(false);
});
it.each(['nonce', 'unknown', 'missing', 'duplicate', 'uncovered', 'literal', 'split'])('respuesta inválida %s no escribe', (kind) => {
  const f = fixture(), data = JSON.parse(response(f.fs));
  if (kind === 'nonce') data.nonce = 'otro';
  if (kind === 'unknown') data.spans[0].origin = 'r999';
  if (kind === 'missing') data.spans.pop();
  if (kind === 'duplicate') data.spans.push(data.spans[0]);
  if (kind === 'uncovered') data.spans[1].origin = data.spans[0].origin;
  if (kind === 'literal') data.markdown += ' texto sin origen';
  if (kind === 'split') data.markdown = data.markdown.replace(`SD${f.fs.origins.nonce}`, `S**D${f.fs.origins.nonce}`);
  const p = plan(f.fs, JSON.stringify(data)), before = logical(f.ed);
  expect(p.styleSafety).toBe(false); expect(applyFormat(f.api, f.v, f.fs, p, true)).toEqual({ ok: false, reason: 'styleConflict' }); expect(logical(f.ed)).toBe(before);
});
it('payload literal no crea links/HTML/tokens; transporte sólo datos', () => {
  const f = fixture(), data = JSON.parse(response(f.fs));
  data.spans[1].text += ` ⟦link:99⟧ <script> "SD${f.fs.origins.nonce}R999END"`;
  const p = plan(f.fs, JSON.stringify(data)); expect(p.styleSafety).toBe(true);
  expect(applyFormat(f.api, f.v, f.fs, p, true).ok).toBe(true);
  expect(JSON.stringify(core(f.ed))).toContain('⟦link:99⟧'); expect((core(f.ed) as { type: string }[]).every((c) => c.type === 'text')).toBe(true);
  const request = buildRequest('format', f.fs.snapshot.selected, { format: 'headings', formatWire: f.fs.wire });
  expect(request.user).toContain(f.fs.origins.nonce); expect(request.system).toContain('JSON');
});
it('regla de palabras existente sigue rechazando Camera', () => {
  const f = fixture(), data = JSON.parse(response(f.fs)); data.spans[0].text = 'Ca'; data.spans[1].text = 'mera:';
  expect(planFormat(JSON.stringify(data), f.fs, 'headings')).toHaveProperty('lost');
});
it('customhex conserva slots explícitos sin normalizarlos a la paleta', () => {
  const first = { textColor: '#123456', backgroundColor: '#fedcba' }, second = { textColor: '#654321', backgroundColor: '#abcdef' };
  const f = fixture([{ type: 'text', text: 'Cá', styles: first }, { type: 'text', text: 'mara', styles: second }]);
  const before = logical(f.ed);
  expect(applyFormat(f.api, f.v, f.fs, plan(f.fs), true).ok).toBe(true);
  expect(core(f.ed)).toEqual([{ type: 'text', text: 'Cá', styles: { bold: true, ...first } }, { type: 'text', text: 'mara:', styles: { bold: true, ...second } }]);
  const after = logical(f.ed); f.ed.undo(); expect(logical(f.ed)).toBe(before); f.ed.redo(); expect(logical(f.ed)).toBe(after);
});
it('sin bold explícito no adquiere bold al aplicar ni al deshacer', () => {
  const source = [{ type: 'text', text: 'Cá', styles: { textColor: 'purple' } }, { type: 'text', text: 'mara', styles: { backgroundColor: 'orange' } }];
  const f = fixture(source), before = logical(f.ed);
  const token = (id: number) => `SD${f.fs.origins.nonce}R${id}END`;
  const p = plan(f.fs, response(f.fs, ':', `## ${token(0)}${token(1)}`));
  expect(applyFormat(f.api, f.v, f.fs, p, true).ok).toBe(true);
  expect(core(f.ed)).toEqual([source[0], { ...source[1], text: 'mara:' }]);
  const after = logical(f.ed); f.ed.undo(); expect(logical(f.ed)).toBe(before); f.ed.redo(); expect(logical(f.ed)).toBe(after);
});
it('nested específico rechaza antes de escribir y conserva hijos completos; type los conserva', () => {
  const f = fixture([{ type: 'text', text: 'Lente y filtro', styles: { textColor: 'purple' } }]);
  f.ed.updateBlock('a', { children: [{ id: 'h', type: 'paragraph', content: [{ type: 'text', text: 'Nota', styles: { backgroundColor: 'pink', italic: true } }] }] } as never);
  const fs = takeFormatSnapshot(f.v.state, f.api) as FormatSnapshot, before = logical(f.ed), children = JSON.stringify(f.ed.getBlock('a')!.children);
  const token = (id: number) => `SD${fs.origins.nonce}R${id}END`;
  const wire = (markdown: string, spans: unknown[]) => JSON.stringify({ version: 1, nonce: fs.origins.nonce, markdown, spans });
  const p = plan(fs, wire(`- ${token(0)}\n- ${token(1)}`, [{ id: 0, origin: 'r0', text: 'Lente' }, { id: 1, origin: 'r0', text: 'filtro' }]));
  const updates: Uint8Array[] = []; f.doc.on('update', (u) => updates.push(u));
  expect(p.blockedReason).toBe('nested'); expect(p.styleSafety).toBe(false);
  expect(applyFormat(f.api, f.v, fs, p, true)).toEqual({ ok: false, reason: 'nested' }); expect(logical(f.ed)).toBe(before); expect(updates).toHaveLength(0);
  const type = plan(fs, wire(`- ${token(0)}`, [{ id: 0, origin: 'r0', text: 'Lente y filtro' }]));
  expect(type.mode).toBe('type'); expect(applyFormat(f.api, f.v, fs, type, true).ok).toBe(true); expect(JSON.stringify(f.ed.getBlock('a')!.children)).toBe(children);
});
