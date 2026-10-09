// @vitest-environment jsdom
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { TextSelection } from '@tiptap/pm/state';
import { DecorationSet, type EditorView } from '@tiptap/pm/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { yUndoPluginKey } from 'y-prosemirror';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { schema } from '../ui/editorSchema';
import { buildRegistry } from './reader';
import { anchorOf, linkTextInBlock, locateUnderline, makeLinkAt, relLinkKeyExtension, underlineAt, underlineKey } from './relLink';
import { buildUnderlines, mapThroughReplace, relUnderlineExtension, UNDERLINE_WAIT_MS, type PeekEvents, type UnderlineInfo } from './relUnderline';
import { captureNewLinks, undoAssignInDoc } from './assign';

// El subrayado pasivo, la ficha de los links y el gesto para volver link (Docs/Doc_Relaciones.md, sección 14): son
// decoraciones (nada entra al Y.Doc), se corren con lo que se escribe acá y se rearman en el momento con lo que llega de
// otro dispositivo (dos Y.Doc), volver link es la marca `link` de siempre en un solo paso de deshacer, una versión con el
// esquema anterior abre lo que quedó sin perder nada, y con el teclado abierto tocar un subrayado solo pone el cursor.

const PAGES = {
  '105_026': '26262626-2626-4626-8626-262626262626',
  '105_027': '27272727-2727-4727-8727-272727272727',
  '105_029': '29292929-2929-4929-8929-292929292929',
  CENADE: 'cececece-cece-4ece-8ece-cececececece',
};
const R = buildRegistry({
  scenes: (['105_026', '105_027', '105_029'] as const).map((code) => ({ code, pageId: PAGES[code] })),
  locations: [{ name: 'CENADE', pageId: PAGES.CENADE }],
});
const byPage = new Map<string, { kind: 'scene' | 'loc'; ref: string }>([
  [PAGES['105_026'], { kind: 'scene', ref: '105_026' }],
  [PAGES['105_027'], { kind: 'scene', ref: '105_027' }],
  [PAGES['105_029'], { kind: 'scene', ref: '105_029' }],
  [PAGES.CENADE, { kind: 'loc', ref: 'CENADE' }],
]);
const TITLES: Record<string, string> = { [PAGES['105_027']]: '027 | La ambulancia empieza a zigzaguear' };
const info: UnderlineInfo = {
  R,
  ep: null,
  self: null,
  target: (id) => byPage.get(id) ?? null,
  pageOf: (kind, ref) => (kind === 'scene' ? (PAGES as Record<string, string>)[ref] : kind === 'loc' ? (PAGES as Record<string, string>)[ref] : null) ?? null,
  sceneTitle: (id) => (TITLES[id] ? TITLES[id].split(' | ').slice(1).join(' | ') : null),
};

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function mount(doc: Y.Doc, opts: { underline?: boolean; events?: PeekEvents; withSchema?: unknown } = {}): BlockNoteEditor {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema: (opts.withSchema ?? schema) as typeof schema,
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
      ...(opts.underline === false ? {} : { extensions: [relUnderlineExtension(() => info, () => opts.events ?? null), relLinkKeyExtension] }),
    } as never),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return editor;
}

const view = (e: BlockNoteEditor) => e.prosemirrorView as unknown as EditorView;
const link = (text: string, href: string) => ({ type: 'link', href, content: [{ type: 'text', text, styles: {} }] });

/** Lo dibujado: el texto de cada decoración y su clase (o el título en vivo). */
function drawn(e: BlockNoteEditor): string[] {
  const v = view(e);
  const set = underlineKey.getState(v.state)!.set;
  return set.find().map((d) => {
    const spec = d.spec as { rel?: unknown; chip?: unknown; key?: string };
    if (d.from === d.to) return `title:${spec.key}`;
    const cls = (d as unknown as { type: { attrs: { class: string } } }).type.attrs.class;
    return `${v.state.doc.textBetween(d.from, d.to)}:${cls}`;
  });
}

/** Una página con lo de siempre: menciones, un pendiente, una locación y un link. */
function page(): Y.Doc {
  const doc = new Y.Doc();
  const e = mount(doc, { underline: false });
  e.replaceBlocks(e.document, [
    { type: 'heading', props: { level: 1 }, content: 'Escena 105_027b' },
    { type: 'paragraph', content: 'Repetir el plano 2 de la 5029a y la 105_026 queda para mañana. Escena 105_120 sin página. En CENADE.' },
    { type: 'paragraph', content: ['Ver ', link('105_029', `/p/${PAGES['105_029']}`), ' y el año 2025.'] },
  ] as never);
  return doc;
}

describe('el subrayado pasivo', () => {
  it('subraya lo que reconoce el lector (escenas, pendientes, locaciones), nunca lo que ya es link, y no toca el Y.Doc', async () => {
    const doc = page();
    const before = doc.getXmlFragment(CONTENT_FRAGMENT).toString();
    const e = mount(doc);
    await tick();
    expect(drawn(e)).toEqual([
      '105_027b:rel-u',
      '5029a:rel-u',
      '105_026:rel-u',
      '105_120:rel-u pend',
      'CENADE:rel-u loc',
      // El link a 105_029 es una ficha, sin subrayado.
      '105_029:rel-chip scene',
    ]);
    // En pantalla: las clases están en el editor, y el documento sigue idéntico (nada de esto se guarda).
    expect(view(e).dom.querySelectorAll('.rel-u').length).toBe(5);
    expect(view(e).dom.querySelector('.rel-chip')!.textContent).toBe('105_029');
    await tick(UNDERLINE_WAIT_MS + 50);
    expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString()).toBe(before);
    expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString()).not.toMatch(/rel-|underline/);
  });

  it('lo escrito acá corre lo dibujado (sin parpadeo ni mover el cursor) y medio segundo después se vuelve a leer', async () => {
    const e = mount(page());
    await tick();
    const v = view(e);
    // Escribir al principio del párrafo: lo dibujado se corre en la misma transacción.
    const at = v.state.doc.resolve(drawnRange(e, '5029a').from).start();
    v.dispatch(v.state.tr.insertText('Ojo: ', at));
    expect(drawn(e)).toContain('5029a:rel-u');
    expect(drawn(e)).toContain('105_026:rel-u');
    // Escribir un número nuevo: hasta medio segundo después no aparece (nada salta mientras se escribe).
    const end = v.state.doc.resolve(drawnRange(e, 'CENADE').to).end();
    v.dispatch(v.state.tr.insertText(' Mañana la 105_029.', end));
    const cursor = v.state.selection.from;
    await tick(100);
    expect(drawn(e).filter((x) => x.startsWith('105_029:rel-u'))).toEqual([]);
    await tick(UNDERLINE_WAIT_MS + 50);
    expect(drawn(e)).toContain('105_029:rel-u');
    // Volver a dibujar no movió el cursor.
    expect(v.state.selection.from).toBe(cursor);
  });

  it('lo que llega de otro dispositivo (dos Y.Doc) se dibuja en el momento, sin quedar un instante sin subrayado', async () => {
    const a = page();
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    a.on('update', (u: Uint8Array, origin: unknown) => origin !== 'b' && Y.applyUpdate(b, u, 'a'));
    b.on('update', (u: Uint8Array, origin: unknown) => origin !== 'a' && Y.applyUpdate(a, u, 'b'));
    const ea = mount(a);
    const eb = mount(b, { underline: false });
    await tick();
    const va = view(ea);
    // A tiene el cursor en el segundo párrafo.
    const cursorAt = drawnRange(ea, 'CENADE').to;
    va.dispatch(va.state.tr.setSelection(TextSelection.create(va.state.doc, cursorAt)));
    // B escribe antes de lo de A y suma una mención nueva.
    eb.insertBlocks([{ type: 'paragraph', content: 'Nota de B: la 105_027 se repite.' }] as never, eb.document[0], 'before');
    await tick(10);
    // En A, en el momento (antes del medio segundo): lo de antes en su lugar, y lo nuevo.
    const now = drawn(ea);
    expect(now).toContain('105_026:rel-u');
    expect(now).toContain('CENADE:rel-u loc');
    expect(now).toContain('105_027:rel-u');
    // El cursor de A sigue al lado de CENADE.
    expect(va.state.doc.textBetween(va.state.selection.from - 6, va.state.selection.from + 1)).toBe('CENADE.');
    // B no tiene nada (sin la extensión): lo de A no viaja.
    expect(b.getXmlFragment(CONTENT_FRAGMENT).toString()).not.toMatch(/rel-/);
  });

  it('en una página enorme, lo que llega de otro se corre solo por el tramo que cambió (lo demás queda en su lugar)', () => {
    const e = mount(page(), { underline: false });
    const before = view(e).state.doc;
    const built = buildUnderlines(before, info);
    const set = DecorationSet.create(before, built.decos);
    // Lo que hace y-prosemirror con lo de otro: el documento entero de nuevo, con un párrafo más arriba.
    const tr = view(e).state.tr.insert(0, view(e).state.schema.nodes.blockContainer.create(null, view(e).state.schema.nodes.paragraph.create(null, view(e).state.schema.text('Nota nueva.'))));
    const after = tr.doc;
    const mapped = mapThroughReplace(set, before, after).find().map((d) => after.textBetween(d.from, d.to));
    expect(mapped).toEqual(['105_027b', '5029a', '105_026', '105_120', 'CENADE', '105_029']);
    // Sin cambios: el mismo conjunto.
    expect(mapThroughReplace(set, before, before)).toBe(set);
  });

  it('la página de la escena no subraya su propia escena; una página fuera de las relaciones no subraya nada', () => {
    const doc = page();
    const e = mount(doc, { underline: false });
    const pm = view(e).state.doc;
    const own = buildUnderlines(pm, { ...info, self: { kind: 'scene', ref: '105_026' } });
    expect(own.decos.some((d) => pm.textBetween(d.from, d.to) === '105_026')).toBe(false);
    expect(buildUnderlines(pm, null).decos).toEqual([]);
  });
});

/** Dónde está dibujado un texto. */
function drawnRange(e: BlockNoteEditor, text: string): { from: number; to: number } {
  const v = view(e);
  const d = underlineKey.getState(v.state)!.set.find().find((x) => v.state.doc.textBetween(x.from, x.to) === text)!;
  return { from: d.from, to: d.to };
}

describe('volver link un subrayado', () => {
  it('Ctrl+Alt+K con el cursor en un subrayado: la marca link de siempre a su página, el mismo texto; se deshace en un paso', async () => {
    const doc = page();
    const e = mount(doc);
    await tick();
    const v = view(e);
    const r = drawnRange(e, '5029a');
    v.focus();
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, r.to)));
    const key = new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true });
    expect(v.someProp('handleKeyDown', (f) => f(v, key))).toBe(true);
    const xml = doc.getXmlFragment(CONTENT_FRAGMENT).toString();
    expect(xml).toContain(`<link href="/p/${PAGES['105_029']}">5029a</link>`);
    // Nada de tipos ni marcas nuevas: el texto es el mismo.
    expect(e.document[1].content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'link', href: `/p/${PAGES['105_029']}` })]));
    // Ya no está subrayado: es una ficha.
    expect(drawn(e)).toContain('5029a:rel-chip scene');
    expect(drawn(e)).not.toContain('5029a:rel-u');
    // Deshacer: un solo paso.
    const um = (yUndoPluginKey.getState(v.state as never) as { undoManager: Y.UndoManager }).undoManager;
    um.undo();
    await tick();
    expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString()).not.toContain('5029a</link>');
    expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain('de la 5029a y la');
    expect(drawn(e)).toContain('5029a:rel-u');
  });

  it('un pendiente o un texto sin subrayado no se vuelven link', async () => {
    const doc = page();
    const e = mount(doc);
    await tick();
    const v = view(e);
    const before = doc.getXmlFragment(CONTENT_FRAGMENT).toString();
    expect(makeLinkAt(v, drawnRange(e, '105_120').from + 1)).toBe(false);
    expect(makeLinkAt(v, 3)).toBe(false);
    expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString()).toBe(before);
    expect(underlineAt(v.state, drawnRange(e, '105_026').to)?.spec).toMatchObject({ kind: 'scene', ref: '105_026', pageId: PAGES['105_026'] });
  });

  it('Ctrl+Alt+K donde no hay nada para volver link: un aviso corto que dice por qué; en solo lectura, nada (O3)', async () => {
    const doc = page();
    const e = mount(doc);
    await tick();
    const v = view(e);
    const notices: string[] = [];
    const listen = (ev: Event) => notices.push(String((ev as CustomEvent).detail));
    window.addEventListener('shotdocs:notice', listen);
    const press = () => v.someProp('handleKeyDown', (f) => f(v, new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true })));
    const at = (pos: number) => v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos)));
    const before = doc.getXmlFragment(CONTENT_FRAGMENT).toString();
    try {
      at(drawnRange(e, '105_120').from + 2);
      expect(press()).toBe(true);
      at(drawnRange(e, '105_029').from + 2);
      expect(press()).toBe(true);
      at(4);
      expect(press()).toBe(true);
      expect(notices).toEqual(['105_120 doesn’t exist yet: nothing to link to', 'It’s already a link', 'Nothing to link here']);
      // En solo lectura la tecla sigue su camino, sin aviso.
      e.isEditable = false;
      expect(press()).toBeFalsy();
      expect(notices).toHaveLength(3);
    } finally {
      window.removeEventListener('shotdocs:notice', listen);
    }
    expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString()).toBe(before);
  });

  it('desde el adelanto, sobre una locación; con la página en solo lectura, no', async () => {
    const doc = page();
    const e = mount(doc);
    await tick();
    const v = view(e);
    expect(makeLinkAt(v, drawnRange(e, 'CENADE').from, 'CENADE')).toBe(true);
    expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain(`<link href="/p/${PAGES.CENADE}">CENADE</link>`);
    e.isEditable = false;
    expect(makeLinkAt(v, drawnRange(e, '105_026').from)).toBe(false);
  });

  it('desde el adelanto, aunque otro dispositivo escriba más arriba mientras está abierto (O8)', async () => {
    const a = page();
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    a.on('update', (u: Uint8Array, origin: unknown) => origin !== 'b' && Y.applyUpdate(b, u, 'a'));
    b.on('update', (u: Uint8Array, origin: unknown) => origin !== 'a' && Y.applyUpdate(a, u, 'b'));
    const ea = mount(a);
    const eb = mount(b, { underline: false });
    await tick();
    const va = view(ea);
    // A abre el adelanto de CENADE: queda anclado.
    const anchor = anchorOf(va.state, drawnRange(ea, 'CENADE').from, 'CENADE');
    const old = anchor.from;
    // B escribe arriba de todo, antes de CENADE.
    eb.insertBlocks([{ type: 'paragraph', content: 'Nota de B, larga, que corre todo lo de abajo.' }] as never, eb.document[0], 'before');
    await tick(10);
    // La posición vieja ya no es CENADE; la anclada sí.
    expect(underlineAt(va.state, old)?.spec.ref).not.toBe('CENADE');
    const at = locateUnderline(va.state, anchor);
    expect(at).not.toBeNull();
    expect(makeLinkAt(va, at!, 'CENADE')).toBe(true);
    expect(a.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain(`<link href="/p/${PAGES.CENADE}">CENADE</link>`);
    // Si el bloque se borró, no hay dónde: no se linkea nada al azar.
    const gone = anchorOf(va.state, drawnRange(ea, '105_026').from, '105_026');
    eb.removeBlocks([eb.document[2]] as never);
    await tick(10);
    expect(locateUnderline(va.state, gone)).toBeNull();
  });
});

describe('Assign desde el adelanto de un pendiente y el link de lo creado desde el / (E7)', () => {
  it('Assign: la marca a la escena elegida sobre el pendiente, el mismo texto, en un paso de deshacer; aunque otro escriba arriba', async () => {
    const a = page();
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    a.on('update', (u: Uint8Array, origin: unknown) => origin !== 'b' && Y.applyUpdate(b, u, 'a'));
    b.on('update', (u: Uint8Array, origin: unknown) => origin !== 'a' && Y.applyUpdate(a, u, 'b'));
    const ea = mount(a);
    const eb = mount(b, { underline: false });
    await tick();
    const va = view(ea);
    // Sin destino, un pendiente no se vuelve link (E6).
    expect(makeLinkAt(va, drawnRange(ea, '105_120').from)).toBe(false);
    const anchor = anchorOf(va.state, drawnRange(ea, '105_120').from, '105_120');
    eb.insertBlocks([{ type: 'paragraph', content: 'Nota de B arriba.' }] as never, eb.document[0], 'before');
    await tick(10);
    const at = locateUnderline(va.state, anchor);
    expect(at).not.toBeNull();
    expect(makeLinkAt(va, at!, '105_120', { pageId: PAGES['105_026'] })).toBe(true);
    expect(a.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain(`<link href="/p/${PAGES['105_026']}">105_120</link>`);
    expect(b.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain(`<link href="/p/${PAGES['105_026']}">105_120</link>`);
    // Con otro ref (el subrayado ya no dice eso), no.
    expect(makeLinkAt(va, drawnRange(ea, 'CENADE').from, '105_120', { pageId: PAGES['105_026'] })).toBe(false);
  });

  it('el Undo del aviso del adelanto (D566): saca solo la marca puesta, en los dos dispositivos; lo que B escribió queda', async () => {
    const a = page();
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    a.on('update', (u: Uint8Array, origin: unknown) => origin !== 'b' && Y.applyUpdate(b, u, 'a'));
    b.on('update', (u: Uint8Array, origin: unknown) => origin !== 'a' && Y.applyUpdate(a, u, 'b'));
    const ea = mount(a);
    const eb = mount(b, { underline: false });
    await tick();
    const va = view(ea);
    const anchor = anchorOf(va.state, drawnRange(ea, '105_120').from, '105_120');
    const href = `/p/${PAGES['105_026']}`;
    const spans = captureNewLinks(a, anchor.blockId!, href, () => makeLinkAt(va, locateUnderline(va.state, anchor)!, '105_120', { pageId: PAGES['105_026'] }));
    expect(spans!.map((s) => s.text)).toEqual(['105_120']);
    eb.insertBlocks([{ type: 'paragraph', content: 'Nota de B arriba.' }] as never, eb.document[0], 'before');
    await tick(10);
    expect(undoAssignInDoc(a, spans!)).toBe('undone');
    await tick(10);
    for (const d of [a, b]) {
      const xml = d.getXmlFragment(CONTENT_FRAGMENT).toString();
      expect(xml).not.toContain(href);
      expect(xml).toContain('105_120');
      expect(xml).toContain('Nota de B arriba.');
    }
  });

  it('linkTextInBlock: el número recién escrito, en su bloque (el más cercano al lugar); si el bloque ya no está, nada', async () => {
    const doc = page();
    const e = mount(doc);
    await tick();
    const v = view(e);
    const block = e.document[1].id;
    const from = drawnRange(e, '105_120').from;
    const at = anchorOf(v.state, from, '');
    expect(at.blockId).toBe(block);
    expect(linkTextInBlock(v, { blockId: block, offset: at.offset }, '105_120', `/p/${PAGES['105_027']}`)).toBe(true);
    expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain(`<link href="/p/${PAGES['105_027']}">105_120</link>`);
    // Ya tiene link: no se vuelve a marcar ni se toma otro.
    expect(linkTextInBlock(v, { blockId: block, offset: at.offset }, '105_120', `/p/${PAGES['105_029']}`)).toBe(false);
    expect(linkTextInBlock(v, { blockId: 'no-esta', offset: 0 }, 'CENADE', `/p/${PAGES.CENADE}`)).toBe(false);
  });
});

describe('la ficha de un link a una escena', () => {
  it('en un título: ficha y título en vivo al final; lo escrito después del link queda antes del título (O4 de E5)', async () => {
    const doc = new Y.Doc();
    const e = mount(doc);
    e.replaceBlocks(e.document, [{ type: 'heading', props: { level: 1 }, content: ['Escena ', link('105_027', `/p/${PAGES['105_027']}`)] }] as never);
    await tick(UNDERLINE_WAIT_MS + 80);
    const h = view(e).dom.querySelector('h1, [data-content-type="heading"]')!;
    expect(h.querySelector('.rel-chip')!.textContent).toBe('105_027');
    expect(h.textContent).toBe('Escena 105_027 · La ambulancia empieza a zigzaguear');
    const v = view(e);
    v.dispatch(v.state.tr.insertText(' grúa', drawnRange(e, '105_027').to));
    await tick(UNDERLINE_WAIT_MS + 80);
    expect(h.textContent).toBe('Escena 105_027 grúa · La ambulancia empieza a zigzaguear');
    // El título en vivo no está en el documento.
    expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString()).not.toContain('zigzaguear');
  });

  it('una versión con el esquema anterior abre la página con el link que dejó «Make it a link» sin perder el texto ni el link', async () => {
    const doc = page();
    const e = mount(doc);
    await tick();
    expect(makeLinkAt(view(e), drawnRange(e, '105_026').from)).toBe(true);
    e.unmount();
    editors.splice(editors.indexOf(e), 1);
    const xml = doc.getXmlFragment(CONTENT_FRAGMENT).toString();
    // El esquema de la versión anterior (BlockNote sin lo propio de la app), sin el subrayado ni la ficha.
    const { audio: _a, file: _f, video: _v, ...oldSpecs } = defaultBlockSpecs;
    const old = mount(doc, { underline: false, withSchema: BlockNoteSchema.create({ blockSpecs: oldSpecs }) });
    await tick();
    expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString()).toBe(xml);
    const para = old.document[1].content as { type: string; href?: string; content?: { text: string }[]; text?: string }[];
    expect(para.map((c) => (c.type === 'link' ? `[${c.content!.map((x) => x.text).join('')}](${c.href})` : c.text)).join('')).toBe(
      `Repetir el plano 2 de la 5029a y la [105_026](/p/${PAGES['105_026']}) queda para mañana. Escena 105_120 sin página. En CENADE.`,
    );
    // Y en la versión vieja el link es un link común: ni ficha ni subrayado.
    expect(view(old).dom.querySelector('.rel-chip, .rel-u')).toBeNull();
    expect(view(old).dom.querySelector(`a[href="/p/${PAGES['105_026']}"]`)!.textContent).toBe('105_026');
  });
});

describe('el adelanto: el toque, el mouse, elegir, editar y lo que lo cierra', () => {
  function touch(el: Element, type: string, x = 5, y = 5): Event {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] });
    el.dispatchEvent(ev);
    return ev;
  }
  const events = () => {
    let open: number | null = null;
    const ev = { hover: vi.fn(), open: vi.fn((t: { from: number }) => (open = t.from)), isOpen: (from?: number) => open !== null && (from === undefined || from === open), close: vi.fn(() => (open = null)), select: vi.fn() };
    return ev;
  };

  it('con el teclado abierto (el editor con el foco) tocar solo pone el cursor: ni adelanto ni nada', async () => {
    const ev = events();
    const e = mount(page(), { events: ev as unknown as PeekEvents });
    await tick();
    const v = view(e);
    v.focus();
    vi.spyOn(v, 'hasFocus').mockReturnValue(true);
    const u = v.dom.querySelector('.rel-u')!;
    touch(u, 'touchstart');
    const end = touch(u, 'touchend');
    expect(ev.open).not.toHaveBeenCalled();
    expect(end.defaultPrevented).toBe(false);
  });

  it('con el teclado cerrado, el adelanto sin abrir el teclado; un segundo toque lo cierra y pone el cursor', async () => {
    const ev = events();
    const e = mount(page(), { events: ev as unknown as PeekEvents });
    await tick();
    const v = view(e);
    vi.spyOn(v, 'hasFocus').mockReturnValue(false);
    const u = [...v.dom.querySelectorAll('.rel-u')].find((x) => x.textContent === '105_026')!;
    touch(u, 'touchstart');
    const end = touch(u, 'touchend');
    expect(end.defaultPrevented).toBe(true);
    expect(ev.open).toHaveBeenCalledWith(expect.objectContaining({ kind: 'scene', ref: '105_026', via: 'underline', pageId: PAGES['105_026'] }));
    touch(u, 'touchstart');
    const again = touch(u, 'touchend');
    expect(again.defaultPrevented).toBe(false);
    expect(ev.close).toHaveBeenCalled();
  });

  it('mantener apretado abre el adelanto aunque el teclado esté abierto, y ese toque no pone el cursor', async () => {
    const ev = events();
    const e = mount(page(), { events: ev as unknown as PeekEvents });
    await tick();
    const v = view(e);
    vi.spyOn(v, 'hasFocus').mockReturnValue(true);
    const u = v.dom.querySelector('.rel-u.loc')!;
    vi.useFakeTimers();
    touch(u, 'touchstart');
    vi.advanceTimersByTime(500);
    expect(ev.open).toHaveBeenCalledWith(expect.objectContaining({ kind: 'loc', ref: 'CENADE' }));
    expect(touch(u, 'touchend').defaultPrevented).toBe(true);
    // Desplazar (el dedo se mueve) no es mantener apretado.
    ev.open.mockClear();
    touch(u, 'touchstart', 5, 5);
    touch(u, 'touchmove', 5, 40);
    vi.advanceTimersByTime(500);
    expect(ev.open).not.toHaveBeenCalled();
  });

  it('lo que una edición tocó por dentro (reemplazar con buscar) no queda medio segundo con la referencia vieja (O5)', async () => {
    const e = mount(page());
    await tick();
    const v = view(e);
    const r = drawnRange(e, '105_026');
    // Como el reemplazo de buscar: el mismo tramo, otro texto.
    v.dispatch(v.state.tr.insertText('105_027', r.from, r.to));
    const refs = () => [...v.dom.querySelectorAll('.rel-u')].map((x) => `${x.textContent}:${x.getAttribute('data-ref')}`);
    expect(refs()).not.toContain('105_027:105_026');
    expect(drawn(e).some((x) => x.startsWith('105_027:'))).toBe(false);
    // Lo de al lado sigue dibujado, y escribir pegado a un subrayado no lo apaga.
    expect(drawn(e)).toContain('5029a:rel-u');
    const c = drawnRange(e, 'CENADE');
    v.dispatch(v.state.tr.insertText('!', c.to));
    expect(drawn(e)).toContain('CENADE:rel-u loc');
    await tick(UNDERLINE_WAIT_MS + 50);
    expect(refs()).toContain('105_027:105_027');
  });

  it('el adelanto con el mouse: solo con un movimiento de verdad, no cuando el subrayado aparece debajo del puntero quieto (B1)', async () => {
    const ev = events();
    const e = mount(page(), { events: ev as unknown as PeekEvents });
    await tick();
    const v = view(e);
    const mouse = (el: EventTarget, type: string, x: number, y: number) => {
      const m = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: 0 });
      Object.defineProperty(m, 'pointerType', { value: 'mouse' });
      el.dispatchEvent(m);
    };
    const u = () => [...v.dom.querySelectorAll('.rel-u')].find((x) => x.textContent === '105_026')!;
    // Clic para empezar a escribir (el mouse queda ahí) y teclas.
    mouse(v.dom, 'pointerdown', 40, 12);
    v.someProp('handleKeyDown', (f) => f(v, new KeyboardEvent('keydown', { key: '1' })));
    // Medio segundo después aparece el subrayado debajo del puntero quieto: el navegador manda pointerover (y puede mandar
    // un pointermove en el mismo lugar). No es pasar el mouse.
    mouse(u(), 'pointerover', 40, 12);
    mouse(u(), 'pointermove', 40, 12);
    expect(ev.hover).not.toHaveBeenCalled();
    // Mover el mouse de verdad sobre el subrayado: el adelanto (una sola vez al entrar).
    mouse(u(), 'pointermove', 43, 12);
    mouse(u(), 'pointermove', 45, 13);
    expect(ev.hover).toHaveBeenCalledTimes(1);
    expect(ev.hover).toHaveBeenCalledWith(expect.objectContaining({ kind: 'scene', ref: '105_026', via: 'underline' }));
    // Una tecla lo desarma otra vez (y cierra lo que estaba por abrirse).
    v.someProp('handleKeyDown', (f) => f(v, new KeyboardEvent('keydown', { key: 'a' })));
    expect(ev.close).toHaveBeenCalled();
    mouse(u(), 'pointermove', 45, 13);
    expect(ev.hover).toHaveBeenCalledTimes(1);
    // Arrastrar para elegir texto no lo abre.
    const drag = new MouseEvent('pointermove', { bubbles: true, clientX: 60, clientY: 13, buttons: 1 });
    Object.defineProperty(drag, 'pointerType', { value: 'mouse' });
    u().dispatchEvent(drag);
    expect(ev.hover).toHaveBeenCalledTimes(1);
  });

  it('elegir texto avisa al adelanto (no sale junto con la barra de formato, O4)', async () => {
    const ev = events();
    const e = mount(page(), { events: ev as unknown as PeekEvents });
    await tick();
    const v = view(e);
    const r = drawnRange(e, '105_026');
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, r.from)));
    expect(ev.select).not.toHaveBeenCalled();
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, r.from, r.to)));
    expect(ev.select).toHaveBeenCalledTimes(1);
  });

  it('escribir o Esc cierran el adelanto', async () => {
    const ev = events();
    const e = mount(page(), { events: ev as unknown as PeekEvents });
    await tick();
    const v = view(e);
    ev.open({ from: 3 });
    expect(v.someProp('handleKeyDown', (f) => f(v, new KeyboardEvent('keydown', { key: 'Escape' })))).toBe(true);
    expect(ev.close).toHaveBeenCalledTimes(1);
    ev.open({ from: 3 });
    expect(v.someProp('handleKeyDown', (f) => f(v, new KeyboardEvent('keydown', { key: 'Shift' })))).toBeFalsy();
    expect(ev.close).toHaveBeenCalledTimes(1);
    expect(v.someProp('handleKeyDown', (f) => f(v, new KeyboardEvent('keydown', { key: 'a' })))).toBeFalsy();
    expect(ev.close).toHaveBeenCalledTimes(2);
  });
});

describe('el subrayado con el contexto de lugar (D545)', () => {
  it('«Estudio» en la celda de Locacion Real se subraya (cuenta para la cabecera); en un párrafo o en Locacion Guion, no', () => {
    const arenera = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const R2 = buildRegistry({ scenes: [], locations: [{ name: 'La Arenera (estudio)', aliases: ['La Arenera (estudio)'], wholeAliases: ['Estudio'], pageId: arenera }] });
    const doc = new Y.Doc();
    const e = mount(doc, { underline: false });
    e.replaceBlocks(e.document, [
      { type: 'table', content: { type: 'tableContent', rows: [{ cells: ['Locacion Guion', 'Estudio'] }, { cells: ['Locacion Real', 'Estudio | Autos'] }] } },
      { type: 'paragraph', content: 'Estudio | Autos' },
      { type: 'paragraph', content: 'Locación: Estudio' },
    ] as never);
    const pm = view(e).state.doc;
    const built = buildUnderlines(pm, { ...info, R: R2, pageOf: () => arenera });
    const shownText = built.decos.map((d) => `${pm.textBetween(d.from, d.to)}@${pm.resolve(d.from).parent.textContent}`);
    expect(shownText).toEqual(['Estudio@Estudio | Autos', 'Estudio@Locación: Estudio']);
  });
});
