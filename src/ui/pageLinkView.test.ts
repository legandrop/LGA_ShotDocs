// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { rememberLink, parseLinkHash } from '../linkMode';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { editorSchemaOptions } from './editorSchema';
import { pageLinkViewExtension } from './pageLinkView';
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
