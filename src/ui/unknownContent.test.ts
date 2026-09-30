// @vitest-environment jsdom
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { schema, SCRIPT_PROP } from './editorSchema';
import { findUnknownContent, supportsContent } from './unknownContent';

const editors: BlockNoteEditor[] = [];
const devices: Device[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
  }
});

// Una versión "más nueva" de la app: con el bloque de video que esta versión todavía no tiene.
const newerSchema = BlockNoteSchema.create({ blockSpecs: defaultBlockSpecs });

function mount(doc: Y.Doc, withSchema: unknown = schema): BlockNoteEditor {
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

describe('contenido que esta versión no conoce', () => {
  it('reconoce todo lo que hace esta versión', async () => {
    const doc = new Y.Doc();
    const editor = mount(doc);
    editor.replaceBlocks(editor.document, [
      { type: 'heading', content: 'Escena 64' },
      { type: 'paragraph', props: { [SCRIPT_PROP]: true } as never, content: '64 INT. BAR - NOCHE' },
      { type: 'paragraph', content: [{ type: 'text', text: 'negrita', styles: { bold: true, textColor: 'red' } }] },
      { type: 'bulletListItem', content: 'Uno' },
      { type: 'image', props: { url: 'sdfile://p/x.png' } },
      { type: 'table', content: { type: 'tableContent', rows: [{ cells: ['a', 'b'] }] } },
    ]);
    await tick();
    expect(findUnknownContent(doc)).toBeNull();
  });

  it('marca un tipo de bloque nuevo y una marca de texto nueva', async () => {
    const doc = new Y.Doc();
    const newer = mount(doc, newerSchema);
    newer.replaceBlocks(newer.document, [{ type: 'video', props: { url: 'sdfile://p/v.mp4' } } as never]);
    await tick();
    expect(findUnknownContent(doc)).toBe('"video"');

    const text = new Y.Doc();
    const para = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    para.insert(0, [t]);
    text.getXmlFragment(CONTENT_FRAGMENT).insert(0, [para]);
    t.insert(0, 'hola', { bold: {} });
    expect(findUnknownContent(text)).toBeNull();
    t.insert(4, ' mundo', { 'bold--AbCd1234': {} });
    expect(findUnknownContent(text)).toBeNull();
    t.insert(10, '!', { comment: { id: 'x' } });
    expect(findUnknownContent(text)).toBe('"comment"');
  });

  it('un atributo desconocido en un bloque no molesta (se ignora sin borrar nada)', () => {
    const doc = new Y.Doc();
    const para = new Y.XmlElement('paragraph');
    para.setAttribute('algoNuevo', 'x');
    doc.getXmlFragment(CONTENT_FRAGMENT).insert(0, [para]);
    expect(findUnknownContent(doc)).toBeNull();
  });

  it('lo desconocido que llega con la página abierta se guarda pero no entra al editor', async () => {
    const server = new FakeServer();
    const newer = await makeDevice(server);
    const old = await makeDevice(server, undefined, '0.021', { supports: supportsContent });
    devices.push(newer, old);

    const page = await newer.tree.create(null, 'Escena');
    await newer.engine.syncNow();
    await old.engine.syncNow();

    const warned: string[] = [];
    old.docs.subscribeUnsupported((id) => warned.push(id));
    const openDoc = await old.docs.open(page);
    const before = Y.encodeStateVector(openDoc);

    const newerDoc = await newer.docs.open(page);
    const editor = mount(newerDoc, newerSchema);
    editor.replaceBlocks(editor.document, [
      { type: 'paragraph', content: 'Texto.' },
      { type: 'video', props: { url: 'sdfile://p/v.mp4' } } as never,
    ]);
    await tick();
    await newer.docs.flush(page);
    await newer.engine.syncNow();

    await old.engine.syncNow();
    expect(warned).toEqual([page]);
    expect(Y.encodeStateVector(openDoc)).toEqual(before);
    old.docs.close(page);

    // Al volver a abrir, viene de lo guardado: el video está, y la página no se abre en el editor.
    const reopened = await old.docs.open(page);
    expect(reopened).not.toBe(openDoc);
    expect(findUnknownContent(reopened)).toBe('"video"');
    old.docs.close(page);

    // En el servidor no se borró nada.
    const fresh = await makeDevice(server);
    devices.push(fresh);
    await fresh.engine.syncNow();
    const check = await fresh.docs.open(page);
    expect(findUnknownContent(check)).toBe('"video"');
    fresh.docs.close(page);
  });
});
