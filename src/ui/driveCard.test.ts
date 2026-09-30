// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { driveFrameSandbox } from './driveCard';
import { applyDrivePaste, createDrivePaste, driveLinkFromClipboard, findPastedDriveLink } from './drivePaste';
import { DRIVE_CARD_PROP, paragraphProps, QUESTION_PROP, schema, SCRIPT_PROP } from './editorSchema';
import { schema as mainSchema } from './fixtures/editorSchemaMain';
import { findUnknownContent, knownContent } from './unknownContent';

// Tarjetas de Drive (paso 13): un párrafo con el link y `driveCard: true`, nunca un tipo de bloque nuevo.
// La versión publicada (el esquema de `main`, copiado en fixtures/) no conoce la propiedad: tiene que abrir
// la página, mostrar el párrafo con el link y no borrarlo; si edita esa línea, se pierde solo la propiedad.

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const URL_FILE = `https://drive.google.com/file/d/${ID}/view?usp=sharing`;

// jsdom no trae ClipboardEvent (ProseMirror lo usa al pegar HTML).
beforeAll(() => {
  const g = globalThis as { ClipboardEvent?: unknown };
  g.ClipboardEvent ??= class extends Event {
    clipboardData: unknown;
    constructor(type: string, init: EventInit & { clipboardData?: unknown } = {}) {
      super(type, init);
      this.clipboardData = init.clipboardData ?? null;
    }
  };
});

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  document.body.replaceChildren();
});

function mount(doc: Y.Doc, withSchema: unknown = schema, extra: Record<string, unknown> = {}): BlockNoteEditor {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema: withSchema as typeof schema,
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
      ...extra,
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return editor;
}

const tick = () => new Promise((r) => setTimeout(r, 30));
const card = (text = URL_FILE, href = URL_FILE) => ({
  type: 'paragraph' as const,
  props: paragraphProps('driveCard') as never,
  content: [{ type: 'link' as const, href, content: text }],
});
const texts = (e: BlockNoteEditor) =>
  e.document.map((b) =>
    ((b.content as { type: string; text?: string; content?: { text: string }[] }[] | undefined) ?? [])
      .map((c) => c.text ?? c.content?.map((t) => t.text).join('') ?? '')
      .join(''),
  );
const hrefs = (e: BlockNoteEditor) =>
  e.document.map((b) => ((b.content as { type: string; href?: string }[] | undefined) ?? []).filter((c) => c.type === 'link').map((c) => c.href));
const isCard = (e: BlockNoteEditor, i: number) => (e.document[i].props as Record<string, unknown>)[DRIVE_CARD_PROP] === true;

function newPage(): { doc: Y.Doc; editor: BlockNoteEditor } {
  const doc = new Y.Doc();
  const editor = mount(doc);
  editor.replaceBlocks(editor.document, [
    { type: 'paragraph', content: 'Plano de referencia:' },
    card('Plano 12.mov'),
    { type: 'paragraph', content: 'Nota.' },
  ]);
  return { doc, editor };
}

function openInMain(doc: Y.Doc): { old: BlockNoteEditor; updates: Uint8Array[] } {
  const docOld = new Y.Doc();
  Y.applyUpdate(docOld, Y.encodeStateAsUpdate(doc));
  const updates: Uint8Array[] = [];
  docOld.on('update', (u: Uint8Array) => updates.push(u));
  return { old: mount(docOld, mainSchema), updates };
}

describe('tarjetas de Drive con el editor de la versión publicada (main)', () => {
  it('abre la página y muestra el párrafo con el link; editar otro bloque no borra nada', async () => {
    const { doc, editor } = newPage();
    await tick();
    const cardId = editor.document[1].id;

    const { old, updates } = openInMain(doc);
    await tick();
    expect(old.document.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
    expect(texts(old)).toEqual(['Plano de referencia:', 'Plano 12.mov', 'Nota.']);
    expect(hrefs(old)[1]).toEqual([URL_FILE]);
    expect(old.document[1].id).toBe(cardId);
    // La versión vieja no dibuja la tarjeta ni ningún iframe.
    expect(old.domElement?.querySelector('iframe, .drive-card')).toBeNull();

    old.setTextCursorPosition(old.document[2], 'end');
    old.insertInlineContent(' Editada en la versión publicada.');
    await tick();
    for (const u of updates) Y.applyUpdate(doc, u);
    await tick();

    expect(texts(editor)).toEqual(['Plano de referencia:', 'Plano 12.mov', 'Nota. Editada en la versión publicada.']);
    expect(isCard(editor, 1)).toBe(true);
    expect(editor.domElement?.querySelectorAll('.drive-card iframe')).toHaveLength(1);
  });

  it('si la versión publicada edita la tarjeta, queda el párrafo con el link (se pierde solo la propiedad)', async () => {
    const { doc, editor } = newPage();
    await tick();
    const cardId = editor.document[1].id;

    const { old, updates } = openInMain(doc);
    await tick();
    old.setTextCursorPosition(old.document[1], 'end');
    old.insertInlineContent(' (toma 3)');
    await tick();
    for (const u of updates) Y.applyUpdate(doc, u);
    await tick();

    expect(editor.document).toHaveLength(3);
    expect(editor.document[1].id).toBe(cardId);
    expect(editor.document[1].type).toBe('paragraph');
    expect(texts(editor)[1]).toBe('Plano 12.mov (toma 3)');
    expect(hrefs(editor)[1]).toContain(URL_FILE);
  });

  it('la guarda contra lo desconocido de la versión publicada no la bloquea', async () => {
    const { doc } = newPage();
    await tick();
    const probe = BlockNoteEditor.create({ schema: mainSchema });
    const mainNames = { nodes: new Set(Object.keys(probe.pmSchema.nodes)), marks: new Set(Object.keys(probe.pmSchema.marks)) };
    expect(findUnknownContent(doc, mainNames)).toBeNull();
    expect(findUnknownContent(doc)).toBeNull();
    // Ningún bloque ni marca nuevos: los mismos nombres que la versión publicada.
    expect([...knownContent().nodes].sort()).toEqual([...mainNames.nodes].sort());
    expect([...knownContent().marks].sort()).toEqual([...mainNames.marks].sort());
    expect(Object.keys(schema.blockSpecs).sort()).toEqual(Object.keys(mainSchema.blockSpecs).sort());
  });
});

describe('la tarjeta en esta versión', () => {
  it('dibuja el reproductor de Drive con un iframe acotado y el link al pie', async () => {
    const { editor } = newPage();
    await tick();
    const frames = editor.domElement!.querySelectorAll('iframe');
    expect(frames).toHaveLength(1);
    const f = frames[0];
    expect(f.getAttribute('src')).toBe(`https://drive.google.com/file/d/${ID}/preview`);
    expect(f.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    expect(f.getAttribute('allow')).toBe('fullscreen');
    expect(f.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(f.hasAttribute('title')).toBe(false);
    const cardEl = editor.domElement!.querySelector('.drive-card')!;
    expect(cardEl.querySelector('.drive-card-text a')?.getAttribute('href')).toBe(URL_FILE);
    expect(cardEl.querySelector<HTMLAnchorElement>('.drive-card-open')?.getAttribute('href')).toBe(`https://drive.google.com/file/d/${ID}/view`);
    expect(cardEl.querySelector('.drive-card-open')?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('un link que no es de Drive (o un id raro) no mete nada en un iframe: queda un párrafo común', async () => {
    const editor = mount(new Y.Doc());
    editor.replaceBlocks(editor.document, [
      card('evil', 'https://evil.example/file/d/1AbCdEfGhIjKlMnOp/view'),
      card('raro', 'https://drive.google.com/file/d/abc"onload="x/view'),
      { type: 'paragraph', props: paragraphProps('driveCard') as never, content: 'sin link' },
    ]);
    await tick();
    expect(editor.domElement!.querySelector('iframe, .drive-card')).toBeNull();
    expect(texts(editor)).toEqual(['evil', 'raro', 'sin link']);
  });

  it('editar el texto del pie no recarga el reproductor; cambiar el link sí', async () => {
    const { editor } = newPage();
    await tick();
    const first = editor.domElement!.querySelector('iframe');
    editor.setTextCursorPosition(editor.document[1], 'end');
    editor.insertInlineContent(' (toma 3)');
    await tick();
    expect(editor.domElement!.querySelector('iframe')).toBe(first);

    const other = '1ZyXwVuTsRqPoNmLkJiHgFeDcBa987654';
    editor.updateBlock(editor.document[1], { content: [{ type: 'link', href: `https://drive.google.com/file/d/${other}/view`, content: 'Otro' }] } as never);
    await tick();
    expect(editor.domElement!.querySelector('iframe')?.getAttribute('src')).toBe(`https://drive.google.com/file/d/${other}/preview`);
  });

  it('sin red muestra el link y un aviso, y el reproductor carga al volver la red', async () => {
    const onLine = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')!;
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
    try {
      const { editor } = newPage();
      await tick();
      const el = editor.domElement!.querySelector('.drive-card')!;
      expect(el.querySelector('iframe')).toBeNull();
      expect(el.querySelector('.drive-card-offline')?.textContent).toMatch(/offline/i);
      expect(el.querySelector('.drive-card-text a')?.getAttribute('href')).toBe(URL_FILE);
      window.dispatchEvent(new Event('online'));
      expect(el.querySelector('iframe')).not.toBeNull();
    } finally {
      Object.defineProperty(Navigator.prototype, 'onLine', onLine);
    }
  });

  it('"Show as link" la vuelve un link común; en solo lectura no cambia nada', async () => {
    const { editor } = newPage();
    await tick();
    editor.isEditable = false;
    editor.domElement!.querySelector<HTMLButtonElement>('.drive-card-unembed')!.click();
    expect(isCard(editor, 1)).toBe(true);
    editor.isEditable = true;
    editor.domElement!.querySelector<HTMLButtonElement>('.drive-card-unembed')!.click();
    await tick();
    expect(isCard(editor, 1)).toBe(false);
    expect(hrefs(editor)[1]).toEqual([URL_FILE]);
    expect(editor.domElement!.querySelector('iframe')).toBeNull();
  });

  it('pasar la tarjeta a Script, pregunta o párrafo le saca la tarjeta (y al revés)', () => {
    const editor = mount(new Y.Doc());
    editor.replaceBlocks(editor.document, [card()]);
    for (const kind of ['script', 'question', 'paragraph'] as const) {
      editor.updateBlock(editor.document[0], { props: paragraphProps('driveCard') } as never);
      editor.updateBlock(editor.document[0], { props: paragraphProps(kind) } as never);
      const p = editor.document[0].props as Record<string, unknown>;
      expect([p[DRIVE_CARD_PROP], p[SCRIPT_PROP], p[QUESTION_PROP]]).toEqual([false, kind === 'script', kind === 'question']);
    }
  });

  it('se copia y se pega como HTML con su marca', () => {
    const editor = mount(new Y.Doc());
    editor.replaceBlocks(editor.document, [card('Plano 12.mov')]);
    const html = editor.blocksToHTMLLossy(editor.document);
    expect(html).toContain('drive-card-line');
    expect(html).not.toContain('iframe');
    const parsed = editor.tryParseHTMLToBlocks(`<p class="drive-card-line"><a href="${URL_FILE}">Plano 12.mov</a></p>`);
    expect((parsed[0].props as Record<string, unknown>)[DRIVE_CARD_PROP]).toBe(true);
  });

  it('un formulario necesita mandar datos; el resto no', () => {
    expect(driveFrameSandbox({ kind: 'file', id: ID })).not.toContain('allow-forms');
    expect(driveFrameSandbox({ kind: 'doc', id: ID, docType: 'forms' })).toContain('allow-forms');
  });
});

// --- Pegar -------------------------------------------------------------------------------------------

function clipboard(data: Record<string, string>) {
  return { types: Object.keys(data), getData: (t: string) => data[t] ?? '', files: [] };
}

function paste(editor: BlockNoteEditor, data: Record<string, string>) {
  const ev = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: clipboard(data) });
  editor.prosemirrorView!.dom.dispatchEvent(ev);
}

function withPaste() {
  const drivePaste = createDrivePaste();
  const editor = mount(new Y.Doc(), schema, { pasteHandler: drivePaste.pasteHandler });
  return { drivePaste, editor };
}

describe('pegar un link de Drive', () => {
  it('reconoce solo un link de Drive solo en el portapapeles', () => {
    expect(driveLinkFromClipboard(clipboard({ 'text/plain': URL_FILE }))?.link.id).toBe(ID);
    expect(driveLinkFromClipboard(clipboard({ 'text/plain': `  ${URL_FILE}\n` }))?.link.id).toBe(ID);
    expect(driveLinkFromClipboard(clipboard({ 'text/plain': `Mirá ${URL_FILE}` }))).toBeNull();
    expect(driveLinkFromClipboard(clipboard({ 'text/plain': 'https://example.com/a' }))).toBeNull();
    // Un link copiado de una página, con su título.
    const html = `<meta charset="utf-8"><a href="${URL_FILE}">Plano 12</a>`;
    expect(driveLinkFromClipboard(clipboard({ 'text/html': html, 'text/plain': 'Plano 12' }))?.href).toBe(URL_FILE);
    expect(driveLinkFromClipboard(clipboard({ 'text/html': `<p>Hola <a href="${URL_FILE}">Plano</a></p>`, 'text/plain': 'Hola Plano' }))).toBeNull();
    // Contenido copiado del mismo editor: se pega como siempre.
    expect(driveLinkFromClipboard(clipboard({ 'blocknote/html': '<p></p>', 'text/plain': URL_FILE }))).toBeNull();
  });

  it('pega el link como siempre y abre el menú; Escape o "Link" lo dejan así', () => {
    const { drivePaste, editor } = withPaste();
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: 'Mirá ' }]);
    editor.setTextCursorPosition(editor.document[0], 'end');
    paste(editor, { 'text/plain': URL_FILE });
    expect(hrefs(editor)[0]).toEqual([URL_FILE]);
    const target = drivePaste.get();
    expect(target?.link.id).toBe(ID);
    expect(target?.text).toBe(URL_FILE);
    drivePaste.choose(editor, 'link');
    expect(drivePaste.get()).toBeNull();
    expect(hrefs(editor)[0]).toEqual([URL_FILE]);
  });

  it('otra cosa pegada no abre el menú', () => {
    const { drivePaste, editor } = withPaste();
    editor.setTextCursorPosition(editor.document[0], 'end');
    paste(editor, { 'text/plain': 'https://example.com/video' });
    expect(drivePaste.get()).toBeNull();
    paste(editor, { 'text/plain': `Mirá ${URL_FILE}` });
    expect(drivePaste.get()).toBeNull();
  });

  it('"Text" deja el texto sin link', () => {
    const { drivePaste, editor } = withPaste();
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: 'Mirá ' }]);
    editor.setTextCursorPosition(editor.document[0], 'end');
    paste(editor, { 'text/plain': URL_FILE });
    drivePaste.choose(editor, 'text');
    expect(texts(editor)[0]).toBe(`Mirá ${URL_FILE}`);
    expect(hrefs(editor)[0]).toEqual([]);
  });

  it('"Card" en una línea vacía la vuelve tarjeta', async () => {
    const { drivePaste, editor } = withPaste();
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: 'Antes' }, { type: 'paragraph' }, { type: 'paragraph', content: 'Después' }]);
    editor.setTextCursorPosition(editor.document[1], 'start');
    paste(editor, { 'text/plain': URL_FILE });
    drivePaste.choose(editor, 'card');
    await tick();
    expect(texts(editor)).toEqual(['Antes', URL_FILE, 'Después']);
    expect(isCard(editor, 1)).toBe(true);
    expect(hrefs(editor)[1]).toEqual([URL_FILE]);
    expect(editor.domElement!.querySelectorAll('.drive-card iframe')).toHaveLength(1);
    // El cursor sigue en el bloque de abajo.
    expect(editor.getTextCursorPosition().block.id).toBe(editor.document[2].id);
  });

  it('"Card" en medio de un texto saca el link de ahí y pone la tarjeta debajo', () => {
    const { drivePaste, editor } = withPaste();
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: 'Mirá  y avisame' }]);
    editor.setTextCursorPosition(editor.document[0], 'start');
    const start = editor.prosemirrorState.selection.from;
    editor.transact((tr) => tr.setSelection(TextSelection.create(tr.doc, start + 5)));
    paste(editor, { 'text/plain': URL_FILE });
    drivePaste.choose(editor, 'card');
    expect(texts(editor).slice(0, 2)).toEqual(['Mirá  y avisame', URL_FILE]);
    expect(isCard(editor, 0)).toBe(false);
    expect(isCard(editor, 1)).toBe(true);
  });

  it('un link copiado con título: la tarjeta lleva el título', () => {
    const { drivePaste, editor } = withPaste();
    editor.setTextCursorPosition(editor.document[0], 'start');
    paste(editor, { 'text/html': `<a href="${URL_FILE}">Plano doce</a>`, 'text/plain': 'Plano doce' });
    const target = drivePaste.get();
    expect(target?.text).toBe('Plano doce');
    drivePaste.choose(editor, 'card');
    expect(texts(editor)[0]).toBe('Plano doce');
    expect(hrefs(editor)[0]).toEqual([URL_FILE]);
    expect(isCard(editor, 0)).toBe(true);
  });

  it('si lo pegado cambió mientras el menú estaba abierto, no toca nada', () => {
    const { drivePaste, editor } = withPaste();
    editor.setTextCursorPosition(editor.document[0], 'start');
    paste(editor, { 'text/plain': URL_FILE });
    const target = drivePaste.get()!;
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: 'Otra cosa totalmente distinta que es más larga que el link pegado, mucho más larga, de verdad.' }]);
    expect(applyDrivePaste(editor, target, 'card')).toBe(false);
    expect(isCard(editor, 0)).toBe(false);
    expect(findPastedDriveLink(editor, 1)).toBeNull();
  });
});
