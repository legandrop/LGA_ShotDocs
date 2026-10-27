// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { blocksThirdPartyCookies, DRIVE_CARD_WIDTH_PROP, DRIVE_FRAME_SANDBOX, driveCardWidth, PLAYER_TIMEOUT_MS } from './driveCard';
import { canShowAsCard } from './DriveLinkCardButton';
import { applyDrivePaste, createDrivePaste, driveLinkFromClipboard, findPastedDriveLink, showLinkAsCard } from './drivePaste';
import { DRIVE_CARD_PROP, paragraphProps, QUESTION_PROP, schema, SCRIPT_PROP } from './editorSchema';
import { schema as anteriorSchema } from './fixtures/editorSchemaAnterior';
import { schema as mainSchema } from './fixtures/editorSchemaMain';
import { schema as soloScriptSchema } from './fixtures/editorSchemaSoloScript';
import { findUnknownContent, knownContent } from './unknownContent';

// Tarjetas de Drive (paso 13): un párrafo con el link y `driveCard: true`, nunca un tipo de bloque nuevo.
// Una versión sin tarjetas (la publicada hasta v0.040, fixtures/editorSchemaSoloScript.ts) no conoce la propiedad:
// tiene que abrir la página, mostrar el párrafo con el link y no borrarlo; si edita esa línea, se pierde solo la
// propiedad. La publicada hoy (fixtures/editorSchemaMain.ts) ya las conoce: con ella se prueba la guarda.

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

function openInOld(doc: Y.Doc): { old: BlockNoteEditor; updates: Uint8Array[] } {
  const docOld = new Y.Doc();
  Y.applyUpdate(docOld, Y.encodeStateAsUpdate(doc));
  const updates: Uint8Array[] = [];
  docOld.on('update', (u: Uint8Array) => updates.push(u));
  return { old: mount(docOld, soloScriptSchema), updates };
}

describe('tarjetas de Drive con el editor de una versión que no las conoce (hasta v0.040)', () => {
  it('abre la página y muestra el párrafo con el link; editar otro bloque no borra nada', async () => {
    const { doc, editor } = newPage();
    await tick();
    const cardId = editor.document[1].id;

    const { old, updates } = openInOld(doc);
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

  it('si la versión vieja edita la tarjeta, queda el párrafo con el link (se pierde solo la propiedad)', async () => {
    const { doc, editor } = newPage();
    await tick();
    const cardId = editor.document[1].id;

    const { old, updates } = openInOld(doc);
    await tick();
    old.setTextCursorPosition(old.document[1], 'end');
    old.insertInlineContent(' (toma 3)');
    await tick();
    for (const u of updates) Y.applyUpdate(doc, u);
    await tick();

    expect(editor.document).toHaveLength(3);
    expect(editor.document[1].id).toBe(cardId);
    expect(editor.document[1].type).toBe('paragraph');
    // Se pierde solo la propiedad: el texto y el link quedan, en los dos editores.
    expect(isCard(editor, 1)).toBe(false);
    expect(texts(editor)).toEqual(['Plano de referencia:', 'Plano 12.mov (toma 3)', 'Nota.']);
    expect(hrefs(editor)[1]).toEqual([URL_FILE]);
    expect(texts(old)[1]).toBe('Plano 12.mov (toma 3)');
    expect(hrefs(old)[1]).toEqual([URL_FILE]);
    expect(editor.domElement?.querySelector('.drive-card')).toBeNull();
  });

  it('pegar una tarjeta copiada (drive-card-line) en la versión vieja deja el párrafo con el link', async () => {
    const { doc, editor } = newPage();
    await tick();
    const { old, updates } = openInOld(doc);
    await tick();
    old.setTextCursorPosition(old.document[2], 'end');
    old.pasteHTML(`<p class="drive-card-line"><a href="${URL_FILE}">Plano 13.mov</a></p>`);
    await tick();
    expect(old.document.map((b) => b.type).every((t) => t === 'paragraph')).toBe(true);
    expect(texts(old).join('|')).toContain('Plano 13.mov');
    expect(hrefs(old).flat()).toContain(URL_FILE);
    for (const u of updates) Y.applyUpdate(doc, u);
    await tick();
    // Llega como link común (la versión vieja no conoce la propiedad) y nada de lo que había se borró.
    expect(texts(editor).slice(0, 2)).toEqual(['Plano de referencia:', 'Plano 12.mov']);
    expect(isCard(editor, 1)).toBe(true);
    expect(texts(editor).join('|')).toContain('Plano 13.mov');
    expect(editor.document.filter((b) => (b.props as Record<string, unknown>)[DRIVE_CARD_PROP] === true)).toHaveLength(1);
  });

  it('la guarda contra lo desconocido de la versión publicada y de la vieja no la bloquea', async () => {
    const { doc } = newPage();
    await tick();
    const namesOf = (s: unknown) => {
      const probe = BlockNoteEditor.create({ schema: s as typeof schema });
      return { nodes: new Set(Object.keys(probe.pmSchema.nodes)), marks: new Set(Object.keys(probe.pmSchema.marks)) };
    };
    const mainNames = namesOf(mainSchema);
    const oldNames = namesOf(soloScriptSchema);
    expect(findUnknownContent(doc, mainNames)).toBeNull();
    expect(findUnknownContent(doc, oldNames)).toBeNull();
    expect(findUnknownContent(doc)).toBeNull();
    // Ningún bloque, nodo ni marca nuevos respecto de la versión publicada (que ya tiene la foto en línea).
    expect([...knownContent().nodes, 'doc', 'text'].sort()).toEqual([...mainNames.nodes].sort());
    expect([...knownContent().marks].sort()).toEqual([...mainNames.marks].sort());
    // Desde v0.040, el único nodo nuevo es la foto en línea (inlinePhoto.ts: una versión sin ella no abre una página que
    // la tenga, unknownContent.ts).
    expect([...knownContent().nodes, 'doc', 'text'].sort()).toEqual([...oldNames.nodes, 'photo'].sort());
    expect([...knownContent().marks].sort()).toEqual([...oldNames.marks].sort());
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
    expect(f.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-popups allow-storage-access-by-user-activation');
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

  it('el sandbox no deja escapar popups ni mandar formularios', () => {
    expect(DRIVE_FRAME_SANDBOX).not.toContain('allow-popups-to-escape-sandbox');
    expect(DRIVE_FRAME_SANDBOX).not.toContain('allow-forms');
    expect(DRIVE_FRAME_SANDBOX).not.toContain('allow-top-navigation');
  });

  it('un formulario de Google queda como párrafo común (sin iframe)', async () => {
    const editor = mount(new Y.Doc());
    editor.replaceBlocks(editor.document, [card('Formulario', `https://docs.google.com/forms/d/${ID}/edit`)]);
    await tick();
    expect(editor.domElement!.querySelector('iframe, .drive-card')).toBeNull();
  });

  it('reconoce los navegadores que bloquean las cookies de terceros', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const iphoneChrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
    const macSafari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
    const macChrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
    const android = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
    const winEdge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0';
    expect(blocksThirdPartyCookies(iphone, true)).toBe(true);
    expect(blocksThirdPartyCookies(iphoneChrome, true)).toBe(true);
    expect(blocksThirdPartyCookies(macSafari, false)).toBe(true);
    expect(blocksThirdPartyCookies(macSafari.replace('Version/18.0 ', ''), true)).toBe(true); // iPad
    expect(blocksThirdPartyCookies(macChrome, false)).toBe(false);
    expect(blocksThirdPartyCookies(android, true)).toBe(false);
    expect(blocksThirdPartyCookies(winEdge, false)).toBe(false);
  });

  it('en Safari o el iPhone avisa que solo andan los compartidos por link, con "Open in Drive"', async () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    );
    try {
      const { editor } = newPage();
      await tick();
      const hint = editor.domElement!.querySelector<HTMLElement>('.drive-card-hint')!;
      expect(hint.hidden).toBe(false);
      expect(hint.textContent).toMatch(/shared by link/);
      expect(hint.querySelector('a')?.getAttribute('href')).toBe(`https://drive.google.com/file/d/${ID}/view`);
    } finally {
      ua.mockRestore();
    }
  });

  it('si el reproductor no carga a tiempo (ya en pantalla), ofrece abrirlo en Drive; al cargar, se va', async () => {
    const observers: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
    const g = globalThis as { IntersectionObserver?: unknown };
    const saved = g.IntersectionObserver;
    g.IntersectionObserver = class {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        observers.push(cb);
      }
      observe() {}
      disconnect() {}
    };
    try {
      const { editor } = newPage();
      await tick();
      const hint = editor.domElement!.querySelector<HTMLElement>('.drive-card-hint')!;
      expect(hint.hidden).toBe(true);
      vi.useFakeTimers();
      observers.at(-1)!([{ isIntersecting: true }]);
      vi.advanceTimersByTime(PLAYER_TIMEOUT_MS + 1);
      expect(hint.hidden).toBe(false);
      expect(hint.textContent).toMatch(/didn't load/);
      expect(hint.querySelector('a')?.textContent).toBe('Open in Drive');
      editor.domElement!.querySelector('iframe')!.dispatchEvent(new Event('load'));
      expect(hint.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
      g.IntersectionObserver = saved;
    }
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

  it('"Card" en un salto de hoja vacío: la tarjeta sigue siendo salto', async () => {
    const { drivePaste, editor } = withPaste();
    editor.replaceBlocks(editor.document, [
      { type: 'paragraph', content: 'Antes' },
      { type: 'paragraph', props: paragraphProps('pageBreak') as never },
      { type: 'paragraph', content: 'Después' },
    ]);
    editor.setTextCursorPosition(editor.document[1], 'start');
    paste(editor, { 'text/plain': URL_FILE });
    // Pegar en el salto vacío no le saca el salto.
    expect((editor.document[1].props as Record<string, unknown>).pageBreak).toBe(true);
    drivePaste.choose(editor, 'card');
    await tick();
    expect(texts(editor)).toEqual(['Antes', URL_FILE, 'Después']);
    expect(isCard(editor, 1)).toBe(true);
    expect((editor.document[1].props as Record<string, unknown>).pageBreak).toBe(true);
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

// D796: "Show as card" en la barra del link y el ancho de la tarjeta (1, 1/2, 1/3, 1/4).
const widthOf = (e: BlockNoteEditor, i: number) => (e.document[i].props as Record<string, unknown>)[DRIVE_CARD_WIDTH_PROP];

/** El rango del primer link del documento (como el `range` que le da BlockNote a la barra del link). */
function linkRange(editor: BlockNoteEditor): { from: number; to: number } {
  let range: { from: number; to: number } | null = null;
  editor.prosemirrorState.doc.descendants((node, pos) => {
    if (range || !node.isText || !node.marks.some((m) => m.type.name === 'link')) return !range;
    range = { from: pos, to: pos + node.nodeSize };
    return false;
  });
  return range!;
}

describe('"Show as card" en la barra del link (D796)', () => {
  it('un renglón que es solo el link pasa a ser la tarjeta', async () => {
    const editor = mount(new Y.Doc());
    editor.replaceBlocks(editor.document, [
      { type: 'paragraph', content: 'Antes' },
      { type: 'paragraph', content: [{ type: 'link', href: URL_FILE, content: URL_FILE }] },
      { type: 'paragraph', content: 'Después' },
    ]);
    const id = editor.document[1].id;
    const { from, to } = linkRange(editor);
    expect(showLinkAsCard(editor, from, to, URL_FILE)).toBe(true);
    await tick();
    expect(editor.document[1].id).toBe(id);
    expect(isCard(editor, 1)).toBe(true);
    expect(texts(editor)).toEqual(['Antes', URL_FILE, 'Después']);
    expect(editor.domElement!.querySelectorAll('.drive-card iframe')).toHaveLength(1);
  });

  it('la dirección pelada dentro de un texto sale de ahí y la tarjeta va debajo', () => {
    const editor = mount(new Y.Doc());
    editor.replaceBlocks(editor.document, [
      { type: 'paragraph', content: ['Mirá ', { type: 'link', href: URL_FILE, content: URL_FILE }, ' y avisame'] as never },
    ]);
    const { from, to } = linkRange(editor);
    expect(showLinkAsCard(editor, from, to, URL_FILE)).toBe(true);
    expect(texts(editor).slice(0, 2)).toEqual(['Mirá  y avisame', URL_FILE]);
    expect(isCard(editor, 0)).toBe(false);
    expect(isCard(editor, 1)).toBe(true);
  });

  it('un link con palabras propias deja las palabras (sin el link) y la tarjeta lleva la dirección', () => {
    const editor = mount(new Y.Doc());
    editor.replaceBlocks(editor.document, [
      { type: 'paragraph', content: ['Mirá ', { type: 'link', href: URL_FILE, content: 'el video' }, ' y avisame'] as never },
    ]);
    const { from, to } = linkRange(editor);
    expect(showLinkAsCard(editor, from, to, URL_FILE)).toBe(true);
    expect(texts(editor).slice(0, 2)).toEqual(['Mirá el video y avisame', URL_FILE]);
    expect(hrefs(editor)[0]).toEqual([]);
    expect(hrefs(editor)[1]).toEqual([URL_FILE]);
    expect(isCard(editor, 1)).toBe(true);
  });

  it('un título que es solo el link no pierde el nivel: queda sin el link y la tarjeta va debajo', () => {
    const editor = mount(new Y.Doc());
    editor.replaceBlocks(editor.document, [{ type: 'heading', props: { level: 2 }, content: [{ type: 'link', href: URL_FILE, content: URL_FILE }] } as never]);
    const { from, to } = linkRange(editor);
    expect(showLinkAsCard(editor, from, to, URL_FILE)).toBe(true);
    expect(editor.document[0].type).toBe('heading');
    expect((editor.document[0].props as Record<string, unknown>).level).toBe(2);
    expect(texts(editor).slice(0, 2)).toEqual([URL_FILE, URL_FILE]);
    expect(hrefs(editor)[0]).toEqual([]);
    expect(isCard(editor, 1)).toBe(true);
  });

  it('una foto en línea dentro del link no se pierde (auditoría de v0.285)', () => {
    const editor = mount(new Y.Doc());
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: ['Mirá ', { type: 'link', href: URL_FILE, content: URL_FILE }, ' y avisame'] as never }]);
    const { from, to } = linkRange(editor);
    const view = editor.prosemirrorView!;
    const photo = view.state.schema.nodes.photo.create({ url: 'https://example.invalid/a.jpg', name: 'a.jpg' }, null, [view.state.schema.marks.link.create({ href: URL_FILE })]);
    view.dispatch(view.state.tr.insert(from + 5, photo));
    const photos = () => { let n = 0; editor.prosemirrorState.doc.descendants((x) => { if (x.type.name === 'photo') n++; }); return n; };
    expect(photos()).toBe(1);
    expect(showLinkAsCard(editor, from, to + 1, URL_FILE)).toBe(true);
    expect(photos()).toBe(1);
    expect(isCard(editor, 1)).toBe(true);
  });

  it('un link que no es de Drive no cambia nada, y el botón no aparece ahí ni en el pie de una tarjeta', () => {
    const editor = mount(new Y.Doc());
    const other = 'https://example.com/video.mov';
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: [{ type: 'link', href: other, content: other }] }, card()]);
    const { from, to } = linkRange(editor);
    expect(canShowAsCard(editor.prosemirrorState.doc, from, other)).toBe(false);
    expect(showLinkAsCard(editor, from, to, other)).toBe(false);
    expect(isCard(editor, 0)).toBe(false);
    // El link del pie de la tarjeta: ya es una tarjeta.
    let footLink = -1;
    editor.prosemirrorState.doc.descendants((node, pos) => {
      if (node.isText && node.marks.some((m) => m.attrs.href === URL_FILE)) footLink = pos;
      return footLink < 0;
    });
    expect(canShowAsCard(editor.prosemirrorState.doc, footLink, URL_FILE)).toBe(false);
    expect(canShowAsCard(editor.prosemirrorState.doc, from, URL_FILE)).toBe(true);
  });
});

describe('el ancho de la tarjeta (D796)', () => {
  it('lee solo anchos válidos; lo demás es todo el renglón', () => {
    expect(driveCardWidth(1 / 3)).toBeCloseTo(1 / 3);
    expect(driveCardWidth('0.5')).toBe(0.5);
    for (const raro of [undefined, null, 0, -1, 2, 1, Number.NaN, 'x', 0.05]) expect(driveCardWidth(raro)).toBe(1);
  });

  it('los tamaños de la tarjeta cambian el ancho sin recargar el reproductor; en solo lectura no hacen nada', async () => {
    const { editor } = newPage();
    await tick();
    const el = editor.domElement!.querySelector<HTMLElement>('.drive-card')!;
    const iframe = el.querySelector('iframe');
    const third = [...el.querySelectorAll<HTMLButtonElement>('.drive-card-size')].find((b) => b.textContent === '1/3')!;
    editor.isEditable = false;
    third.click();
    expect(widthOf(editor, 1)).toBe(1);
    editor.isEditable = true;
    third.click();
    await tick();
    expect(widthOf(editor, 1)).toBeCloseTo(1 / 3);
    const now = editor.domElement!.querySelector<HTMLElement>('.drive-card')!;
    expect(now).toBe(el);
    expect(now.querySelector('iframe')).toBe(iframe);
    expect(now.classList.contains('drive-card-sized')).toBe(true);
    expect(Number(now.style.getPropertyValue('--drive-card-w'))).toBeCloseTo(1 / 3);
    expect(third.classList.contains('is-active')).toBe(true);
    [...now.querySelectorAll<HTMLButtonElement>('.drive-card-size')].find((b) => b.textContent === '1/1')!.click();
    await tick();
    expect(widthOf(editor, 1)).toBe(1);
    expect(now.classList.contains('drive-card-sized')).toBe(false);
  });

  it('una versión sin el ancho (v0.083-v0.092, congelada) abre la tarjeta entera; editar otro bloque no le saca el ancho', async () => {
    const { doc, editor } = newPage();
    editor.updateBlock(editor.document[1], { props: { [DRIVE_CARD_WIDTH_PROP]: 1 / 2 } } as never);
    await tick();
    const docOld = new Y.Doc();
    Y.applyUpdate(docOld, Y.encodeStateAsUpdate(doc));
    const updates: Uint8Array[] = [];
    docOld.on('update', (u: Uint8Array) => updates.push(u));
    const old = mount(docOld, anteriorSchema);
    await tick();
    expect(texts(old)).toEqual(['Plano de referencia:', 'Plano 12.mov', 'Nota.']);
    expect((old.document[1].props as Record<string, unknown>)[DRIVE_CARD_PROP]).toBe(true);
    expect(old.domElement!.querySelector('.drive-card')?.classList.contains('drive-card-sized')).toBe(false);
    old.setTextCursorPosition(old.document[2], 'end');
    old.insertInlineContent(' Editada en la vieja.');
    await tick();
    for (const u of updates) Y.applyUpdate(doc, u);
    await tick();
    expect(texts(editor)[2]).toBe('Nota. Editada en la vieja.');
    expect(widthOf(editor, 1)).toBe(0.5);
  });

  it('si una versión sin el ancho edita la tarjeta, se pierde a lo sumo el ancho: el texto, el link y la tarjeta quedan', async () => {
    const { doc, editor } = newPage();
    editor.updateBlock(editor.document[1], { props: { [DRIVE_CARD_WIDTH_PROP]: 1 / 2 } } as never);
    await tick();
    const docOld = new Y.Doc();
    Y.applyUpdate(docOld, Y.encodeStateAsUpdate(doc));
    const updates: Uint8Array[] = [];
    docOld.on('update', (u: Uint8Array) => updates.push(u));
    const old = mount(docOld, anteriorSchema);
    await tick();
    old.setTextCursorPosition(old.document[1], 'end');
    old.insertInlineContent(' (toma 3)');
    await tick();
    for (const u of updates) Y.applyUpdate(doc, u);
    await tick();
    expect(texts(editor)).toEqual(['Plano de referencia:', 'Plano 12.mov (toma 3)', 'Nota.']);
    expect(hrefs(editor)[1]).toEqual([URL_FILE]);
    expect(isCard(editor, 1)).toBe(true);
    expect([0.5, 1]).toContain(widthOf(editor, 1));
  });
});

describe('la grilla de una carpeta (D797)', () => {
  it('una carpeta se arma con el ancho fijo y se achica al marco; un video no; al destruirla se deja de mirar', async () => {
    const observers: { cb: ResizeObserverCallback; disconnected: boolean }[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        entry: { cb: ResizeObserverCallback; disconnected: boolean };
        constructor(cb: ResizeObserverCallback) {
          this.entry = { cb, disconnected: false };
          observers.push(this.entry);
        }
        observe() {}
        disconnect() {
          this.entry.disconnected = true;
        }
      },
    );
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('drive-card-frame') ? 330 : 0;
    });
    const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('drive-card-frame') ? 247.5 : 0;
    });
    try {
      const FOLDER = `https://drive.google.com/drive/folders/${ID}`;
      const editor = mount(new Y.Doc());
      editor.replaceBlocks(editor.document, [card(FOLDER, FOLDER), card()]);
      await tick();
      const [folder, video] = [...editor.domElement!.querySelectorAll<HTMLIFrameElement>('.drive-card iframe')];
      expect(folder.classList.contains('drive-card-folder')).toBe(true);
      expect(video.classList.contains('drive-card-folder')).toBe(false);
      expect(observers).toHaveLength(1);
      observers[0].cb([], {} as ResizeObserver);
      expect(folder.style.width).toBe('1100px');
      expect(parseFloat(folder.style.height)).toBeCloseTo(825);
      expect(folder.style.transform).toBe('scale(0.3)');
      expect(video.style.transform).toBe('');
      editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: 'Nada' }]);
      await tick();
      expect(observers[0].disconnected).toBe(true);
    } finally {
      width.mockRestore();
      height.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
