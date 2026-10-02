// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import type { PartialBlock } from '@blocknote/core';
import { yXmlFragmentToBlocks } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { writeNewPage } from '../templates/dayReportCreate';
import { mountEditor, pmFromY, undoManager, unmountAll, view, yText, type Editor } from '../ui/collabHarness';
import { schema as mainSchema } from '../ui/fixtures/editorSchemaMain';
import { appliedDoc, applySuggestion } from './apply';
import type { AssistantEditor } from './assistantUi';
import { parseSummary, toPartialBlocks } from './mdBlocks';
import { collectPage, insertSummary, parsePageTranslation, subpageAllowed, subpageBlocks, takePageSnapshot, TITLE_TOKEN } from './pageActions';
import { Permissions } from '../sync/access';
import type { Snapshot } from './apply';
import { buildRequest } from './prompt';

// La página entera (Docs/Doc_Asistente.md, entrega A2): *Summarize page* y *Translate page* con el editor real. Lo que
// se manda (el título y el contenido actual, con las marcas; las celdas de las tablas), *Replace page content* (el
// reemplazo de A1 sobre la página: ids, tipos, propiedades y fotos quedan, un deshacer), *Create translated subpage*
// (una copia con ids nuevos escrita en una página nueva) y agregar un resumen.

const devices: Device[] = [];
afterEach(async () => {
  unmountAll();
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
});

const settle = () => new Promise((r) => setTimeout(r, 0));
const photo = (name: string) => ({ type: 'photo', props: { url: `sdmedia://${name}`, name: `${name}.jpg`, w: 0.3 } });
const ed$ = (ed: Editor) => ed as unknown as AssistantEditor;

function page(blocks: unknown[], doc = new Y.Doc()): Editor {
  const ed = mountEditor(doc);
  ed.replaceBlocks(ed.document, blocks as PartialBlock[]);
  undoManager(ed).stopCapturing();
  return ed;
}

const BLOCKS = [
  { id: 'h', type: 'heading', props: { level: 2 }, content: 'Notas de kamara' },
  { id: 'p', type: 'paragraph', props: { script: true }, content: [{ type: 'text', text: 'INT. BAR - DIA. La kalle ', styles: {} }, photo('calle'), { type: 'text', text: ' mojada', styles: { bold: true } }] },
  { id: 'img', type: 'image', props: { url: 'sdmedia://croquis', name: 'croquis.jpg' } },
  { id: 't', type: 'table', content: { type: 'tableContent', rows: [{ cells: ['Lente', 'Notas'] }, { cells: ['35 mm', 'con lluvia'] }] } },
  { id: 'b', type: 'bulletListItem', content: [{ type: 'link', href: 'https://ref.example/a', content: 'la referencia' }] },
];

const TRANSLATED = [
  `${TITLE_TOKEN}Shoot report`,
  '## Camera notes',
  'INT. BAR - DAY. The street ⟦photo:1⟧** wet**',
  '⟦block:1⟧',
  'Lens',
  'Notes',
  '35 mm',
  'with rain',
  '- ⟦link:1⟧the reference⟦/link⟧',
].join('\n\n');

function snap(ed: Editor): Snapshot {
  const s = takePageSnapshot(view(ed).state);
  if (typeof s === 'string') throw new Error(s);
  return s;
}

const textOf = (ed: Editor, id: string) =>
  ((ed.getBlock(id)?.content ?? []) as { type: string; text?: string; content?: { text: string }[] }[])
    .map((c) => (c.type === 'photo' ? '[foto]' : c.type === 'link' ? (c.content ?? []).map((x) => x.text).join('') : c.text ?? ''))
    .join('');

const cells = (b: { content?: unknown }) =>
  (b.content as { rows: { cells: ({ content?: { text: string }[] } | { text: string }[])[] }[] }).rows.map((r) =>
    r.cells.map((c) => (Array.isArray(c) ? c : (c.content ?? [])).map((x) => x.text).join('')),
  );

describe('lo que se manda de la página', () => {
  it('el título y todo el contenido actual, con las marcas y cada celda; nada de direcciones', () => {
    const ed = page(BLOCKS);
    const s = snap(ed);
    expect(s.selected.markdown).toBe(
      ['## Notas de kamara', 'INT. BAR - DIA. La kalle ⟦photo:1⟧ **mojada**', '⟦block:1⟧', 'Lente', 'Notas', '35 mm', 'con lluvia', '- ⟦link:1⟧la referencia⟦/link⟧'].join('\n\n'),
    );
    const req = buildRequest('translatePage', s.selected, { language: 'English', title: 'Reporte del *rodaje*' });
    expect(req.user).toContain(`<user_content>\n${TITLE_TOKEN}Reporte del \\*rodaje\\*\n\n## Notas de kamara`);
    expect(req.user).toContain('The content has 9 blocks.');
    expect(req.system).toContain(TITLE_TOKEN);
    for (const secret of ['sdmedia', 'croquis', 'ref.example']) expect(req.user + req.system).not.toContain(secret);
    const sum = buildRequest('summarize', s.selected, { title: 'Reporte' });
    expect(sum.user).toContain(`${TITLE_TOKEN}Reporte`);
    expect(sum.maxTokens).toBe(2048);
  });

  it('una página sin texto no se pide; una de más de 20 000 caracteres tampoco', () => {
    const empty = page([{ id: 'a', type: 'paragraph', content: '' }]);
    expect(collectPage(view(empty).state)).toBe('empty');
    unmountAll();
    const long = page([{ id: 'a', type: 'paragraph', content: 'x'.repeat(20_001) }]);
    expect(collectPage(view(long).state)).toBe('tooLong');
  });
});

describe('la respuesta de Translate page', () => {
  it('el título (sin marca ni formato) y los bloques; sin la marca del título o con otros bloques, no', () => {
    const ed = page(BLOCKS);
    const s = snap(ed);
    const ok = parsePageTranslation(TRANSLATED, s.selected);
    if (typeof ok === 'string') throw new Error(ok);
    expect(ok.title).toBe('Shoot report');
    expect(parsePageTranslation(TRANSLATED.replace(TITLE_TOKEN, ''), s.selected)).toBe('structure');
    expect(parsePageTranslation(TRANSLATED.replace('\n\nNotes', ''), s.selected)).toBe('structure');
    expect(parsePageTranslation(TRANSLATED.replace('⟦photo:1⟧', ''), s.selected)).toBe('marker');
    expect(parsePageTranslation(`# ${TRANSLATED}`, s.selected)).not.toBe('structure');
  });
});

describe('Replace page content', () => {
  it('traduce cada bloque en su lugar: ids, tipos, Script, la foto (el mismo elemento), el link y las celdas; un deshacer', () => {
    const doc = new Y.Doc();
    const ed = page(BLOCKS, doc);
    const s = snap(ed);
    const t = parsePageTranslation(TRANSLATED, s.selected);
    if (typeof t === 'string') throw new Error(t);
    const before = undoManager(ed).undoStack.length;
    expect(applySuggestion(view(ed), s, t.parsed, true).ok).toBe(true);
    expect(undoManager(ed).undoStack.length).toBe(before + 1);
    expect(ed.document.map((b) => [b.id, b.type])).toEqual([
      ['h', 'heading'],
      ['p', 'paragraph'],
      ['img', 'image'],
      ['t', 'table'],
      ['b', 'bulletListItem'],
    ]);
    expect(textOf(ed, 'h')).toBe('Camera notes');
    expect(textOf(ed, 'p')).toBe('INT. BAR - DAY. The street [foto] wet');
    expect((ed.getBlock('p')!.props as { script: boolean }).script).toBe(true);
    expect(cells(ed.getBlock('t')!)).toEqual([
      ['Lens', 'Notes'],
      ['35 mm', 'with rain'],
    ]);
    expect((ed.getBlock('b')!.content as { href?: string }[])[0].href).toBe('https://ref.example/a');
    ed.undo();
    expect(textOf(ed, 'h')).toBe('Notas de kamara');
    expect(cells(ed.getBlock('t')!)[1]).toEqual(['35 mm', 'con lluvia']);
  });

  it('si la página cambió mientras pensaba, no aplica nada', () => {
    const ed = page(BLOCKS);
    const s = snap(ed);
    const t = parsePageTranslation(TRANSLATED, s.selected);
    if (typeof t === 'string') throw new Error(t);
    ed.updateBlock('h', { content: 'Notas de cámara' } as never);
    expect(applySuggestion(view(ed), s, t.parsed, true)).toEqual({ ok: false, reason: 'changed' });
    expect(textOf(ed, 'p')).toContain('DIA');
  });
});

describe('Create translated subpage', () => {
  it('la copia traducida con ids nuevos; la página de origen no cambia; escrita en una página nueva adentro, que la versión publicada abre igual', async () => {
    const server = new FakeServer();
    const device = await makeDevice(server);
    devices.push(device);
    const parent = await device.tree.create(null, 'Reporte del rodaje');
    const doc = await device.docs.open(parent, { seed: true });
    const ed = page(BLOCKS, doc);
    const sourceBefore = yText(doc);
    const s = snap(ed);
    const t = parsePageTranslation(TRANSLATED, s.selected);
    if (typeof t === 'string') throw new Error(t);
    const translated = appliedDoc(view(ed).state, s, t.parsed);
    expect(translated).not.toBeNull();
    // Solo una copia: la página de origen sigue igual.
    expect(yText(doc)).toBe(sourceBefore);
    const blocks = subpageBlocks(translated!) as { id: string; type: string }[];
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'image', 'table', 'bulletListItem']);
    for (const b of blocks) expect(['h', 'p', 'img', 't', 'b']).not.toContain(b.id);
    const child = await device.tree.create(parent, t.title);
    await writeNewPage(device.docs, child, blocks as never);
    expect(device.tree.get(child)?.title).toBe('Shoot report');
    expect(device.tree.get(child)?.parent_id).toBe(parent);
    const written = await device.docs.open(child);
    try {
      const copy = new Y.Doc();
      Y.applyUpdate(copy, Y.encodeStateAsUpdate(written));
      const old = mountEditor(copy, 'old', mainSchema);
      await settle();
      const before = yText(copy);
      expect(view(old).state.doc.eq(pmFromY(old, copy))).toBe(true);
      expect(yText(copy)).toBe(before);
      const got = yXmlFragmentToBlocks(old as never, copy.getXmlFragment(CONTENT_FRAGMENT)) as unknown as { type: string; content?: unknown; props: Record<string, unknown> }[];
      expect(got.map((b) => b.type).slice(0, 5)).toEqual(['heading', 'paragraph', 'image', 'table', 'bulletListItem']);
      expect(yText(copy)).toContain('The street');
      expect((got[1].content as { type: string; props?: { url: string } }[]).find((c) => c.type === 'photo')?.props?.url).toBe('sdmedia://calle');
      expect(got[2].props.url).toBe('sdmedia://croquis');
      expect(cells(got[3])).toEqual([
        ['Lens', 'Notes'],
        ['35 mm', 'with rain'],
      ]);
    } finally {
      device.docs.close(child);
    }
  });

  it('el permiso: con Editar y crear sí; con Editar solo, con Ver o sin el editor escribible, no', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const owner = await makeDevice(server);
    devices.push(owner);
    const pageId = await owner.tree.create(null, 'Reporte');
    await owner.engine.syncNow();
    const levels = { 'u-crea': 'edit_pages', 'u-edita': 'edit', 'u-ve': 'view' } as const;
    const got: Record<string, boolean> = {};
    for (const [uid, level] of Object.entries(levels)) {
      server.addMember(uid, 'member');
      server.grant(uid, { pageId }, level);
      const d = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: uid, email: `${uid}@test` });
      devices.push(d);
      await d.engine.syncNow();
      got[uid] = subpageAllowed(new Permissions(d.tree, d.access.get(), uid), d.tree.get(pageId), true);
      if (uid === 'u-crea') got['u-crea sin editor'] = subpageAllowed(new Permissions(d.tree, d.access.get(), uid), d.tree.get(pageId), false);
    }
    expect(got).toEqual({ 'u-crea': true, 'u-crea sin editor': false, 'u-edita': false, 'u-ve': false });
    expect(subpageAllowed(new Permissions(owner.tree, owner.access.get(), owner.remote.userId), undefined, true)).toBe(false);
  });

  it('si la página cambió mientras pensaba, no hay copia', () => {
    const ed = page(BLOCKS);
    const s = snap(ed);
    const t = parsePageTranslation(TRANSLATED, s.selected);
    if (typeof t === 'string') throw new Error(t);
    ed.updateBlock('b', { content: 'otro' } as never);
    expect(appliedDoc(view(ed).state, s, t.parsed)).toBeNull();
  });
});

describe('Summarize page: agregar el resumen', () => {
  it('arriba de todo o debajo del cursor, como un solo paso de deshacer, sin tocar lo que había', () => {
    const ed = page([
      { id: 'a', type: 'paragraph', content: 'Primero' },
      { id: 'b', type: 'paragraph', content: 'Segundo' },
    ]);
    const md = parseSummary('## Resumen\n- Llovió\n- [x] se filmó la 3');
    const blocks = toPartialBlocks(md!.blocks, { photos: new Map(), links: new Map(), blocks: new Map() });
    const before = undoManager(ed).undoStack.length;
    expect(insertSummary(ed$(ed), view(ed), blocks, 'top', true)).toEqual({ ok: true, changed: 3 });
    expect(undoManager(ed).undoStack.length).toBe(before + 1);
    expect(ed.document.map((b) => [b.type, textOf(ed, b.id)])).toEqual([
      ['heading', 'Resumen'],
      ['bulletListItem', 'Llovió'],
      ['checkListItem', 'se filmó la 3'],
      ['paragraph', 'Primero'],
      ['paragraph', 'Segundo'],
    ]);
    ed.undo();
    expect(ed.document.map((b) => b.id)).toEqual(['a', 'b']);
    ed.setTextCursorPosition('a', 'end');
    expect(insertSummary(ed$(ed), view(ed), blocks, 'below', true).ok).toBe(true);
    expect(ed.document.map((b) => textOf(ed, b.id))).toEqual(['Primero', 'Resumen', 'Llovió', 'se filmó la 3', 'Segundo']);
  });

  it('sin Editar no agrega nada', () => {
    const ed = page([{ id: 'a', type: 'paragraph', content: 'Primero' }]);
    const blocks = toPartialBlocks(parseSummary('- uno')!.blocks, { photos: new Map(), links: new Map(), blocks: new Map() });
    expect(insertSummary(ed$(ed), view(ed), blocks, 'top', false)).toEqual({ ok: false, reason: 'readOnly' });
    expect(ed.document.map((b) => b.id)).toEqual(['a']);
  });
});
