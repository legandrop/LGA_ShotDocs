// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { AllSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { rememberLink, parseLinkHash } from '../linkMode';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { editorSchemaOptions } from './editorSchema';
import { pageLinkViewExtension, qualifyCopiedLinks } from './pageLinkView';
import { redrawFromYjs } from './editorRecovery';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const href = `/p/${ID}?keep=1`;
const origin = { appOrigin: location.origin, localKey: 'isla_a' };
const editors: BlockNoteEditor[] = [];
const docs: Y.Doc[] = [];
const tick = () => new Promise((r) => setTimeout(r, 35));
afterEach(() => { for (const e of editors.splice(0)) e.unmount(); for (const d of docs.splice(0)) d.destroy(); document.body.innerHTML = ''; localStorage.clear(); });

function mount(doc: Y.Doc, qualified: boolean, publicEntry?: ReturnType<typeof rememberLink>) {
  const editor = BlockNoteEditor.create(withCollaboration({
    ...editorSchemaOptions,
    extensions: qualified ? [pageLinkViewExtension(origin, publicEntry)] : [],
    collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
  })) as unknown as BlockNoteEditor;
  const host = document.createElement('div'); document.body.append(host); editor.mount(host); editors.push(editor);
  return editor;
}

async function seeded() {
  const doc = new Y.Doc(); docs.push(doc);
  const editor = mount(doc, false);
  editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: [
    { type: 'text', text: 'Antes ', styles: {} },
    { type: 'link', href, content: [{ type: 'text', text: 'Plano', styles: { bold: true } }] },
    { type: 'text', text: ' después', styles: {} },
  ] }]);
  await tick(); editor.unmount(); editors.pop();
  return doc;
}

function modelHrefs(editor: BlockNoteEditor) {
  const values: string[] = [];
  editor.prosemirrorState.doc.descendants((node) => { for (const m of node.marks) if (m.type.name === 'link') values.push(m.attrs.href); });
  return [...new Set(values)];
}

describe('vista de enlaces sobre la marca existente', () => {
  it('anchor antes de cualquier gesto, spec fiel, mount/readonly/redraw cero updates y modelo anterior', async () => {
    const doc = await seeded(); const before = Y.encodeStateAsUpdate(doc); let updates = 0;
    doc.on('update', () => updates++);
    const editor = mount(doc, true); await tick();
    const anchor = editor.domElement!.querySelector('a')!;
    expect(anchor.href).toBe(`${location.origin}${href}&w=isla_a`);
    expect(anchor.getAttribute('data-inline-content-type')).toBe('link');
    expect(anchor.target).toBe('_blank'); expect(anchor.rel).toContain('noopener');
    expect(anchor.textContent).toBe('Plano'); expect(modelHrefs(editor)).toEqual([href]);
    let effective = false;
    editor.prosemirrorView.someProp('markViews', (views) => { effective ||= typeof views.link === 'function'; });
    expect(effective).toBe(true);
    editor.isEditable = false; expect(redrawFromYjs(editor)).toBe(true); await tick();
    expect(editor.domElement!.querySelector('a')!.href).toBe(`${location.origin}${href}&w=isla_a`);
    expect(updates).toBe(0); expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    editor.unmount(); editors.pop();
    const old = mount(doc, false); await tick();
    expect(modelHrefs(old)).toEqual([href]); expect(old.domElement!.textContent).toContain('Antes Plano después');
    expect(updates).toBe(0);
  });

  it('ediciones junto al link y nuevo link conservan attrs, deshacer/rehacer y reentrada', async () => {
    const doc = await seeded(); const editor = mount(doc, true);
    editor.setTextCursorPosition(editor.document[0], 'end'); editor.insertInlineContent('!');
    await tick(); expect(modelHrefs(editor)).toEqual([href]);
    expect(editor.domElement!.querySelector('a')!.href).toContain('w=isla_a');
    expect(editor.undo()).toBe(true); await tick(); expect(modelHrefs(editor)).toEqual([href]);
    expect(editor.redo()).toBe(true); await tick(); expect(modelHrefs(editor)).toEqual([href]);
    editor.insertInlineContent([{ type: 'link', href: `/p/${ID}?w=isla_b#dest`, content: 'Ajeno' }]); await tick();
    expect(modelHrefs(editor)).toContain(`/p/${ID}?w=isla_b#dest`);
    expect(editor.domElement!.querySelectorAll('a')[1].getAttribute('href')).toBe(`/p/${ID}?w=isla_b#dest`);
    editor.unmount(); editors.pop(); const fresh = mount(doc, true); await tick();
    expect(modelHrefs(fresh)).toEqual([href, `/p/${ID}?w=isla_b#dest`]);
  });

  it('público plain copia su autoridad, w explícita y hash previo permanecen literales', async () => {
    const doc = await seeded();
    const entry = rememberLink({ u: 'https://abcdefghijklmnopqrst.supabase.co', k: 'sb_publishable_abcdefghij', l: 'isla_a', t: 'sdl_' + 'T'.repeat(43) });
    const editor = mount(doc, true, entry); await tick();
    const url = new URL(editor.domElement!.querySelector('a')!.href);
    expect(url.searchParams.has('w')).toBe(false); expect(url.searchParams.get('keep')).toBe('1');
    expect(parseLinkHash(url.hash)?.l).toBe('isla_a'); expect(modelHrefs(editor)).toEqual([href]);
    editor.setTextCursorPosition(editor.document[0], 'end');
    editor.insertInlineContent([{ type: 'link', href: `/p/${ID}#old`, content: 'Legacy' }, { type: 'text', text: ' ', styles: {} }, { type: 'link', href: `/p/${ID}?w=isla_a`, content: 'Cuenta' }]); await tick();
    expect([...editor.domElement!.querySelectorAll('a')].map((a) => a.getAttribute('href')).slice(1)).toEqual([`/p/${ID}#old`, `/p/${ID}?w=isla_a`]);
  });
});

/** Copiar o cortar todo lo de la página, con un portapapeles de mentira (jsdom no tiene). `formats`: los que guarda. */
function copyAll(editor: BlockNoteEditor, type: 'copy' | 'cut' = 'copy', keeps: (format: string) => boolean = () => true) {
  const view = editor.prosemirrorView;
  view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
  const data = new Map<string, string>();
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { clearData: () => data.clear(), setData: (k: string, v: string) => void (keeps(k) && data.set(k, v)), getData: (k: string) => data.get(k) ?? '' },
  });
  view.dom.dispatchEvent(event);
  return data;
}

/** Copiar desde el espacio que está antes del link hasta el final del link (` Plano`, con el espacio adelante). */
function copyFromSpace(editor: BlockNoteEditor) {
  const view = editor.prosemirrorView;
  let from = -1; let to = -1;
  view.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    if (node.text === 'Antes ') from = pos + node.nodeSize - 1;
    if (node.marks.some((m) => m.type.name === 'link')) to = pos + node.nodeSize;
  });
  if (from < 0 || to < 0) throw new Error('no se encontró el texto sembrado');
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
  const data = new Map<string, string>();
  const event = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { clearData: () => data.clear(), setData: (k: string, v: string) => void data.set(k, v), getData: (k: string) => data.get(k) ?? '' },
  });
  view.dom.dispatchEvent(event);
  return data;
}

/** Las direcciones de los links de un HTML copiado. */
function hrefsIn(html: string) {
  return [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('a')].map((a) => a.getAttribute('href'));
}

describe('copiar y cortar links a páginas propias', () => {
  const own = `${location.origin}${href}&w=isla_a`;

  it('lo que se pega afuera lleva la dirección entera con el workspace; lo que lee la app y el documento quedan literales', async () => {
    const doc = await seeded(); let updates = 0;
    const editor = mount(doc, true); await tick();
    doc.on('update', () => updates++);
    const data = copyAll(editor);
    expect(hrefsIn(data.get('text/html')!)).toEqual([own]);
    expect(data.get('text/html')).toContain('Plano');
    expect(data.get('text/plain')).toContain(`](${own})`);
    expect(data.get('text/plain')).not.toContain(`](${href})`);
    // El formato propio del editor (el que se lee al pegar adentro de la app) sigue con la dirección del documento.
    expect(hrefsIn(data.get('blocknote/html')!)).toEqual([href]);
    expect(modelHrefs(editor)).toEqual([href]);
    expect(updates).toBe(0);
  });

  it('una selección que empieza en el espacio antes del link conserva ese espacio y el resto del HTML, salvo la dirección', async () => {
    // Lo que arma el editor sin la vista de enlaces: la referencia de cómo tiene que quedar todo lo demás.
    const plain = mount(await seeded(), false); await tick();
    const literal = copyFromSpace(plain).get('text/html')!;
    expect(literal.startsWith(' ')).toBe(true);
    plain.unmount(); editors.pop();
    const editor = mount(await seeded(), true); await tick();
    const html = copyFromSpace(editor).get('text/html')!;
    expect(html.startsWith(' ')).toBe(true);
    expect(hrefsIn(html)).toEqual([own]);
    // Igual al literal en todo, menos en la dirección del link.
    const holder = document.createElement('template'); holder.innerHTML = html;
    holder.content.querySelector('a')!.setAttribute('href', href);
    expect(holder.innerHTML).toBe(literal);
  });

  it('cortar lleva lo mismo que copiar', async () => {
    const editor = mount(await seeded(), true); await tick();
    const data = copyAll(editor, 'cut');
    expect(hrefsIn(data.get('text/html')!)).toEqual([own]);
    expect(hrefsIn(data.get('blocknote/html')!)).toEqual([href]);
    expect(editor.domElement!.textContent).not.toContain('Plano');
  });

  it('una w ajena, un hash de acceso y un link a otro sitio se copian como están', async () => {
    const editor = mount(await seeded(), true); await tick();
    const foreign = `/p/${ID}?w=isla_b#dest`;
    const access = `/p/${ID}#link=abc`;
    editor.setTextCursorPosition(editor.document[0], 'end');
    editor.insertInlineContent([
      { type: 'link', href: foreign, content: 'Ajeno' },
      { type: 'text', text: ' ', styles: {} },
      { type: 'link', href: access, content: 'Acceso' },
      { type: 'text', text: ' ', styles: {} },
      { type: 'link', href: 'https://example.com/p/x', content: 'Otro' },
    ]); await tick();
    const data = copyAll(editor);
    expect(hrefsIn(data.get('text/html')!)).toEqual([own, foreign, access, 'https://example.com/p/x']);
  });

  it('si el navegador no guardó el formato propio del editor, no se toca nada (pegar adentro leería este HTML)', async () => {
    const editor = mount(await seeded(), true); await tick();
    const data = copyAll(editor, 'copy', (format) => format !== 'blocknote/html');
    expect(data.has('blocknote/html')).toBe(false);
    expect(hrefsIn(data.get('text/html')!)).toEqual([href]);
    expect(data.get('text/plain')).toContain(`](${href})`);
  });

  it('dentro de un link público lo copiado no lleva ni el workspace ni el acceso del link', async () => {
    const entry = rememberLink({ u: 'https://abcdefghijklmnopqrst.supabase.co', k: 'sb_publishable_abcdefghij', l: 'isla_a', t: 'sdl_' + 'T'.repeat(43) });
    const editor = mount(await seeded(), true, entry); await tick();
    const data = copyAll(editor);
    expect(hrefsIn(data.get('text/html')!)).toEqual([href]);
    expect(data.get('text/html')).not.toContain('sdl_');
  });

  it('sin la vista de enlaces (una versión anterior del editor), copiar deja las direcciones del documento', async () => {
    const editor = mount(await seeded(), false); await tick();
    expect(hrefsIn(copyAll(editor).get('text/html')!)).toEqual([href]);
  });

  it('un portapapeles sin HTML o sin links propios queda igual, sin escrituras de más', () => {
    const writes: string[] = [];
    const data = (values: Record<string, string>) => ({ getData: (k: string) => values[k] ?? '', setData: (k: string) => void writes.push(k) });
    qualifyCopiedLinks(data({ 'blocknote/html': '<p>x</p>' }), origin);
    qualifyCopiedLinks(data({ 'blocknote/html': '<p>x</p>', 'text/html': '<p><a href="https://example.com/">x</a></p>', 'text/plain': 'x' }), origin);
    expect(writes).toEqual([]);
    qualifyCopiedLinks(data({ 'blocknote/html': '<p>x</p>', 'text/html': `<p><a href="${href}">x</a></p>` }), origin);
    expect(writes).toEqual(['text/html']);
  });
});
