// @vitest-environment jsdom
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { t } from '../i18n';
import type { Services } from '../services';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { schema } from '../ui/editorSchema';
import { disposeRelationsSession, relationsSession } from '../ui/relationsUi';
import { buildProject, writeBlocks, type Built } from './fixtures/proyectoSintetico';
import { buildRegistry } from './reader';
import { parseSlashQuery, pendingCode, relationSlash } from './slashRelations';

// El `/` de escenas y locaciones (E7, D506–D511) con el editor de verdad: qué lista sale de lo escrito, qué deja ↵ en el
// documento (un link común con el número canónico, en un párrafo o en un título), *Create* con las guardas y *Keep as
// text* sin ellas (nunca borra lo escrito), y nada sin las relaciones (un link público, una versión del historial).

// jsdom no trae `toJSON` en los rectángulos (el menú de BlockNote lo usa al abrirse).
beforeAll(() => {
  const rect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const r = rect.call(this);
    return Object.assign(r, { toJSON: () => ({}) });
  };
});

const devices: Device[] = [];
const editors: { e: BlockNoteEditor; el: HTMLElement }[] = [];
afterEach(() => {
  for (const { e, el } of editors.splice(0)) {
    e.unmount();
    el.remove();
  }
  for (const d of devices.splice(0)) {
    disposeRelationsSession(d);
    d.engine.stop();
    d.docs.dispose();
    d.db.close();
  }
});

let n = 0;
const fakePhoto = async () => `0000${String(++n).padStart(4, '0')}-eeee-4bbb-8ccc-dddddddddddd`;
const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => unknown, what: string, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await check()) return;
    await wait(30);
  }
  throw new Error(`no llegó: ${what}`);
}

const services = (d: Device) => ({ ...d, user: { id: d.remote.userId, email: 'a@test' } }) as unknown as Services;

async function world(opts: { team?: boolean } = {}): Promise<{ d: Device; built: Built; server: FakeServer }> {
  const server = new FakeServer();
  if (opts.team) server.enableTeam();
  const d = await makeDevice(server);
  devices.push(d);
  const built = await buildProject(d, fakePhoto, { indexPage: false, days: true });
  await d.engine.syncNow();
  const session = relationsSession(d);
  session.open(built.projectId);
  await until(() => session.relations.snapshot(built.projectId)?.complete, 'el índice');
  return { d, built, server };
}

/** Un editor sobre la página (como el de la app), con el cursor al final del bloque `at`. */
async function editorOn(d: Device, pageId: string, withSchema: unknown = schema): Promise<{ e: BlockNoteEditor; doc: Y.Doc }> {
  const doc = await d.docs.open(pageId, { seed: true });
  const e = BlockNoteEditor.create(
    withCollaboration({ schema: withSchema as typeof schema, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } } }) as never,
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  e.mount(el);
  editors.push({ e, el });
  return { e, doc };
}

/** Un renglón nuevo al final con ese texto y el cursor al final (lo que queda después de que BlockNote borra `/e 027`). */
function typeLine(e: BlockNoteEditor, text: string, type: 'paragraph' | 'heading' = 'paragraph'): string {
  const last = e.document[e.document.length - 1];
  const [b] = e.insertBlocks([{ type, content: text } as never], last.id, 'after');
  e.setTextCursorPosition(b.id, 'end');
  return b.id;
}

const inline = (e: BlockNoteEditor, id: string) =>
  ((e.getBlock(id)?.content ?? []) as { type: string; text?: string; href?: string; content?: { text: string }[] }[])
    .map((c) => (c.type === 'link' ? `[${(c.content ?? []).map((x) => x.text).join('')}](${c.href})` : (c.text ?? '')))
    .join('');

describe('lo escrito después de /', () => {
  it('pasa a escenas o locaciones solo con la palabra y un espacio, o pegada a cifras (D507, D508)', () => {
    expect(parseSlashQuery('')).toEqual({ mode: 'normal' });
    expect(parseSlashQuery('sc')).toEqual({ mode: 'normal' });
    expect(parseSlashQuery('e')).toEqual({ mode: 'normal' });
    expect(parseSlashQuery('script')).toEqual({ mode: 'normal' });
    expect(parseSlashQuery('hea')).toEqual({ mode: 'normal' });
    expect(parseSlashQuery('s 027')).toEqual({ mode: 'normal' });
    expect(parseSlashQuery('e ')).toEqual({ mode: 'scene', q: '' });
    expect(parseSlashQuery('e 027')).toEqual({ mode: 'scene', q: '027' });
    expect(parseSlashQuery('e5027')).toEqual({ mode: 'scene', q: '5027' });
    expect(parseSlashQuery('Escena 105-027')).toEqual({ mode: 'scene', q: '105-027' });
    expect(parseSlashQuery('sc cami')).toEqual({ mode: 'scene', q: 'cami' });
    expect(parseSlashQuery('l cen')).toEqual({ mode: 'location', q: 'cen' });
    expect(parseSlashQuery('Locación la arenera')).toEqual({ mode: 'location', q: 'la arenera' });
    expect(parseSlashQuery('l2')).toEqual({ mode: 'normal' });
  });

  it('el número que no existe: canónico, compacto o corto con el episodio de la página', () => {
    const R = buildRegistry({ scenes: [{ code: '105_027' }, { code: '104_008' }, { code: '101_033B' }], locations: [] });
    expect(pendingCode(R, '105_120', null)).toBe('105_120');
    expect(pendingCode(R, '105-120a', null)).toBe('105_120A');
    expect(pendingCode(R, '5120', null)).toBe('105_120');
    expect(pendingCode(R, '120', '105')).toBe('105_120');
    expect(pendingCode(R, '120', null)).toBeNull();
    expect(pendingCode(R, '027', '105')).toBeNull();
    // Con la base existente solo con letra, no es pendiente (D516).
    expect(pendingCode(R, '101_033', null)).toBeNull();
    expect(pendingCode(R, '106_001', null)).toBeNull();
    expect(pendingCode(R, 'cami', '105')).toBeNull();
  });
});

describe('el / en el editor', () => {
  it('/e 027 y /e5027: la escena del episodio; ↵ deja el número canónico con link y un espacio', async () => {
    const { d, built } = await world();
    const { e } = await editorOn(d, built.ids.notas);
    const slash = relationSlash({ editor: e as never, services: services(d), pageId: () => built.ids.notas, tr: t as never });
    const items = slash.items('e 027')!;
    expect(items[0].title).toBe('105_027');
    expect(items[0].subtext).toContain('La ambulancia empieza a zigzaguear');
    expect(slash.items('e5027')![0].title).toBe('105_027');
    expect(slash.items('escena 105-027')![0].title).toBe('105_027');
    expect(slash.items('e zigza')!.map((i) => i.title)).toEqual(['105_027']);
    expect(slash.items('e cami')!.map((i) => i.title)).toEqual(['104_008']);
    const id = typeLine(e, 'Revisar la ');
    items[0].onItemClick();
    expect(inline(e, id)).toBe(`Revisar la [105_027](/p/${built.ids.s027}) `);
    // Sin espacio antes: lo agrega (no deja «la105_027»).
    const id2 = typeLine(e, 'Vuelco');
    slash.items('e 026')![0].onItemClick();
    expect(inline(e, id2)).toBe(`Vuelco [105_026](/p/${built.ids.s026}) `);
  });

  it('en un día, /e sin nada: primero las escenas del día; /l cen deja «CENADE» con link; en un título también', async () => {
    const { d, built } = await world();
    const { e } = await editorOn(d, built.ids.d59);
    const slash = relationSlash({ editor: e as never, services: services(d), pageId: () => built.ids.d59, tr: t as never });
    expect(slash.items('e ')![0].title).toBe('105_027');
    const loc = slash.items('l cen')!;
    expect(loc[0].title).toBe('CENADE');
    const id = typeLine(e, 'Plates ', 'heading');
    loc[0].onItemClick();
    expect(inline(e, id)).toBe(`Plates [CENADE](/p/${built.ids.cenade}) `);
    expect(e.getBlock(id)!.type).toBe('heading');
  });

  it('un número que no existe sin poder crear (permisos desconocidos): «Keep 105_120 as text» con el motivo, y deja el texto', async () => {
    const { d, built } = await world();
    const { e } = await editorOn(d, built.ids.notas);
    const slash = relationSlash({ editor: e as never, services: services(d), pageId: () => built.ids.notas, tr: t as never });
    const items = slash.items('e 105_120')!;
    const last = items.at(-1)!;
    expect(last.title).toBe('Keep 105_120 as text');
    expect(last.subtext).toContain('whole project');
    const id = typeLine(e, 'Falta la ');
    last.onItemClick();
    expect(inline(e, id)).toBe('Falta la 105_120 ');
    expect(d.tree.children(built.ids.ep5).some((p) => p.title === '105_120')).toBe(false);
  });

  it('con las guardas: «Create scene 105_120»; ↵ escribe el número, crea la escena y lo vuelve link', async () => {
    const { d, built } = await world({ team: true });
    const { e } = await editorOn(d, built.ids.notas);
    const slash = relationSlash({ editor: e as never, services: services(d), pageId: () => built.ids.notas, tr: t as never });
    const last = slash.items('e 105_120')!.at(-1)!;
    expect(last.title).toBe('Create scene 105_120');
    expect(last.subtext).toBe('In «105 | Episodio 5»');
    const id = typeLine(e, 'Falta la ');
    last.onItemClick();
    // El texto queda enseguida.
    expect(inline(e, id)).toBe('Falta la 105_120 ');
    await until(() => d.tree.children(built.ids.ep5).find((p) => p.title === '105_120'), 'la escena creada');
    const created = d.tree.children(built.ids.ep5).find((p) => p.title === '105_120')!;
    await until(() => inline(e, id).includes('/p/'), 'el link');
    expect(inline(e, id)).toBe(`Falta la [105_120](/p/${created.id}) `);
    expect(d.tree.children(built.ids.ep5).filter((p) => p.title === '105_120')).toHaveLength(1);
  });

  it('Undo del aviso: la escena creada va a la papelera y el número escrito pierde el link (vuelve a ser pendiente)', async () => {
    const { d, built } = await world({ team: true });
    const { e } = await editorOn(d, built.ids.notas);
    const slash = relationSlash({ editor: e as never, services: services(d), pageId: () => built.ids.notas, tr: t as never });
    const notices: { message: string; second?: { run: () => void } }[] = [];
    const listen = (ev: Event) => notices.push((ev as CustomEvent).detail);
    window.addEventListener('shotdocs:notice', listen);
    try {
      const id = typeLine(e, 'Falta la ');
      slash.items('e 105_120')!.at(-1)!.onItemClick();
      await until(() => inline(e, id).includes('/p/'), 'el link');
      await until(() => notices.some((n) => typeof n === 'object' && n.message?.startsWith('Created scene 105_120')), 'el aviso');
      const created = d.tree.children(built.ids.ep5).find((p) => p.title === '105_120')!;
      notices.find((n) => typeof n === 'object' && n.message?.startsWith('Created'))!.second!.run();
      await until(() => d.tree.isTrashed(created.id), 'a la papelera');
      await until(() => !inline(e, id).includes('/p/'), 'sin link');
      expect(inline(e, id)).toBe('Falta la 105_120 ');
    } finally {
      window.removeEventListener('shotdocs:notice', listen);
    }
  });

  it('/l: crear una locación solo si nada empieza con lo escrito', async () => {
    const { d, built } = await world({ team: true });
    const { e } = await editorOn(d, built.ids.notas);
    const slash = relationSlash({ editor: e as never, services: services(d), pageId: () => built.ids.notas, tr: t as never });
    expect(slash.items('l cen')!.map((i) => i.title)).toEqual(['CENADE']);
    expect(slash.items('l planta bernal')!.map((i) => i.title)).toEqual(['Create location «Planta bernal»']);
    expect(slash.items('l casa')!.at(-1)!.subtext).toContain('won’t be recognized in text by itself');
  });

  it('D557: el subtítulo de una locación con muchos nombres dice dos y cuántos más; «/l arenera» la encuentra por lo escrito', async () => {
    const { d, built } = await world({ team: true });
    const { e } = await editorOn(d, built.ids.notas);
    const slash = relationSlash({ editor: e as never, services: services(d), pageId: () => built.ids.notas, tr: t as never });
    expect(slash.items('l la arenera')![0].subtext).toBe('Location · La Arenera');
    await writeBlocks(d, built.ids.arenera, [{ p: 'Otros nombres: Arenera VA, Estudio, Estudio Autos' }]);
    // Se aplica 2 s después de escribir (D537).
    await until(() => slash.items('l la arenera')![0].subtext === 'Location · La Arenera · Arenera VA · +2', 'el subtítulo con lo escrito', 500);
    expect(slash.items('l arenera va')!.map((i) => i.title)).toEqual(['La Arenera (estudio)']);
  });

  it('sin red: «Keep as text» (otro dispositivo puede haberla creado)', async () => {
    const { d, built, server } = await world({ team: true });
    server.online = false;
    await d.engine.syncNow();
    const { e } = await editorOn(d, built.ids.notas);
    const slash = relationSlash({ editor: e as never, services: services(d), pageId: () => built.ids.notas, tr: t as never });
    const last = slash.items('e 105_120')!.at(-1)!;
    expect(last.title).toBe('Keep 105_120 as text');
    expect(last.subtext).toContain('Connect to create it');
  });

  it('Scene y Location en el menú de siempre; elegir Scene vuelve a abrir el menú con «/e »', async () => {
    const { d, built } = await world();
    const { e } = await editorOn(d, built.ids.notas);
    const slash = relationSlash({ editor: e as never, services: services(d), pageId: () => built.ids.notas, tr: t as never });
    const root = slash.root('Basic blocks');
    expect(root.map((i) => i.title)).toEqual(['Scene', 'Location']);
    const id = typeLine(e, 'Antes ');
    root[0].onItemClick();
    expect(inline(e, id)).toBe('Antes /e ');
  });

  it('sin las relaciones (un link público, otra instancia): ningún ítem nuevo', async () => {
    const server = new FakeServer();
    const d = await makeDevice(server);
    devices.push(d);
    const built = await buildProject(d, fakePhoto, { indexPage: false });
    const { e } = await editorOn(d, built.ids.notas);
    const slash = relationSlash({ editor: e as never, services: services(d), pageId: () => built.ids.notas, tr: t as never });
    expect(slash.items('e 027')).toBeNull();
    expect(slash.root('Basic blocks')).toEqual([]);
  });

  it('esquema anterior: el link del / se abre igual (es la marca link de siempre)', async () => {
    const { d, built } = await world();
    const { e } = await editorOn(d, built.ids.notas);
    const slash = relationSlash({ editor: e as never, services: services(d), pageId: () => built.ids.notas, tr: t as never });
    const id = typeLine(e, 'Ver ');
    slash.items('e 027')![0].onItemClick();
    const { audio: _a, file: _f, video: _v, ...oldSpecs } = defaultBlockSpecs;
    const { e: old } = await editorOn(d, built.ids.notas, BlockNoteSchema.create({ blockSpecs: oldSpecs }));
    expect(inline(old, id)).toBe(`Ver [105_027](/p/${built.ids.s027}) `);
    expect(inline(e, id)).toBe(`Ver [105_027](/p/${built.ids.s027}) `);
  });
});
