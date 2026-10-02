// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyPlan, planReplace, planUndo, recordsOf } from '../search/replaceDoc';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { schema } from './editorSchema';
import { schema as mainSchema } from './fixtures/editorSchemaMain';
import { findUnknownContent } from './unknownContent';

// Reemplazar en el proyecto escribe texto, con marcas que ya existen, en textos que ya existen (Docs/Doc_Buscar.md,
// "Reemplazar en el proyecto", sección 5): la versión publicada (el esquema de `main`) abre la página reemplazada
// y deshecha sin bloquearla, la muestra con el texto nuevo y abrirla no escribe nada.

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
});

function mount(doc: Y.Doc, withSchema: unknown): BlockNoteEditor {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema: withSchema as typeof schema,
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return editor;
}

const tick = () => new Promise((r) => setTimeout(r, 30));
const text = (e: BlockNoteEditor) =>
  e.document.map((b) => (Array.isArray(b.content) ? (b.content as { text?: string; content?: { text?: string }[] }[]).map((c) => c.text ?? (c.content ?? []).map((x) => x.text ?? '').join('')).join('') : '')).join('|');

it('la versión publicada abre la página reemplazada y deshecha, sin bloquearla ni escribir nada', async () => {
  const doc = new Y.Doc();
  const editor = mount(doc, schema);
  editor.replaceBlocks(editor.document, [
    { type: 'paragraph', content: [{ type: 'text', text: 'La cámara ', styles: { bold: true } }, { type: 'link', href: 'https://x.test', content: 'cámara' }] },
    { type: 'heading', props: { level: 2 }, content: 'Otra cámara' },
  ] as never);
  await tick();
  editor.unmount();
  editors.length = 0;

  const plan = planReplace(doc, 'camara', 'Camera');
  doc.transact(() => applyPlan(plan));
  const probe = BlockNoteEditor.create({ schema: mainSchema });
  const mainNames = { nodes: new Set(Object.keys(probe.pmSchema.nodes)), marks: new Set(Object.keys(probe.pmSchema.marks)) };
  expect(findUnknownContent(doc, mainNames)).toBeNull();

  const before = Y.encodeStateVector(doc);
  const updates: Uint8Array[] = [];
  doc.on('update', (u: Uint8Array) => updates.push(u));
  const old = mount(doc, mainSchema);
  await tick();
  expect(text(old)).toBe('La Camera Camera|Otra Camera');
  // El link sigue (el primer carácter lo tenía).
  expect(JSON.stringify(old.document[0].content)).toContain('https://x.test');
  // Abrirla no escribió nada.
  expect(updates).toEqual([]);
  expect(Y.encodeStateVector(doc)).toEqual(before);

  // Deshacer, con la versión publicada abierta: la muestra como estaba.
  const undo = planUndo(doc, JSON.parse(JSON.stringify(recordsOf(plan))));
  doc.transact(() => undo.apply());
  await tick();
  expect(text(old)).toBe('La cámara cámara|Otra cámara');
});
