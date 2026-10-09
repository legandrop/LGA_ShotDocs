// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { unitsFromYDoc, type BlockMeta } from '../search/extract';
import type { IndexedContent, IndexInfo } from '../search/projectIndex';
import { CONTENT_FRAGMENT } from '../sync/structure';
import type { PageRow, PageSettings } from '../sync/types';
import { schema } from '../ui/editorSchema';
import { fakeTree } from './kindTesting';
import { dayRef, locationLive, sceneLive, type LiveSource } from './liveView';
import { entityRelations, RelationIndex, WRITTEN_WAIT_MS, type RelationSource } from './relationIndex';
import type { RegisterTree } from './register';

// Los otros nombres en el índice de relaciones (Docs/Doc_Relaciones.md, «Otros nombres de una locación»; D526–D537),
// con un árbol y lo leído de cada página en memoria: de dónde salen (solo de la página de la locación), cuándo se aplican
// (2 s después de escribir; al abrir, enseguida) y qué cambian (el lugar de las fichas, los días, los decorados).

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

let marks = 0;
function content(blocks: unknown[]): IndexedContent {
  const doc = new Y.Doc();
  const editor = BlockNoteEditor.create(
    withCollaboration({ schema, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } } }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  editor.replaceBlocks(editor.document, blocks as never);
  const meta: BlockMeta[] = [];
  const units = unitsFromYDoc(doc, meta);
  return { mark: `m${++marks}`, units, meta };
}

const p = (text: string) => ({ type: 'paragraph', content: text });
const table = (rows: string[][]) => ({ type: 'table', content: { type: 'tableContent', rows: rows.map((cells) => ({ cells })) } });

type Spec = { id: string; parent?: string; title?: string; settings?: PageSettings; deleted?: boolean };

const SPECS: Spec[] = [
  { id: 'bd', title: 'Breakdown', settings: { holds: 'scene' } },
  { id: 'ep', parent: 'bd', title: '105' },
  { id: 's027', parent: 'ep', title: '105_027 | Ambulancia' },
  { id: 'ficha', parent: 's027', title: 'PRUEBA_105_027_010' },
  { id: 'ficha2', parent: 's027', title: 'PRUEBA_105_027_020' },
  { id: 'locs', title: 'Locations', settings: { holds: 'location' } },
  { id: 'arenera', parent: 'locs', title: 'La Arenera (estudio)' },
  { id: 'scout', parent: 'arenera', title: 'Scouting 06/01' },
  { id: 'europa', parent: 'locs', title: 'Europa (plates)' },
  { id: 'brand', parent: 'locs', title: 'Brandemburgo (Europa)' },
  { id: 'days', title: 'Shoot days', settings: { holds: 'day' } },
  { id: 'd34', parent: 'days', title: '2026-03-01 | Día 34 | Arenera VA' },
  { id: 'd35', parent: 'days', title: '2026-03-02 | Día 35 | Europa' },
  { id: 'decor', title: 'Barco de pasajeros' },
  { id: 'notas', title: 'Notas' },
  { id: 'archivo', title: '90 | Archivo', settings: { graph: false } },
  { id: 'vieja', parent: 'archivo', title: 'Galpón viejo', settings: { entity: { kind: 'location' } } },
];

const CONTENT: Record<string, IndexedContent> = {};
function base(): Record<string, IndexedContent> {
  if (!CONTENT.arenera) {
    Object.assign(CONTENT, {
      arenera: content([p('Otros nombres: Arenera, Estudio, Estudio Autos'), p('Galpón grande.')]),
      scout: content([p('Otros nombres: Galpón Sur')]),
      europa: content([p('Otros nombres: Europa')]),
      brand: content([p('Plates de la ciudad.')]),
      ficha: content([table([['Locacion Guion', 'Estudio de radio'], ['Locacion Real', 'Estudio | Autos']]), p('Estudio | Autos')]),
      ficha2: content([table([['Alias', 'Galpón Sur'], ['Locacion Real', 'Galpón Sur']])]),
      d34: content([p('Llamado 7:00')]),
      d35: content([p('Llamado 8:00')]),
      decor: content([table([['Locacion Real', 'Estudio']])]),
      notas: content([p('El estudio de sonido queda lejos; Arenera VA y Galpón viejo.')]),
      vieja: content([p('Otros nombres: Notas')]),
    });
  }
  return { ...CONTENT };
}

class Source implements RelationSource {
  constructor(
    private readonly tree: RegisterTree,
    readonly pages: Record<string, IndexedContent>,
  ) {}
  pagesOf(): PageRow[] {
    const out: PageRow[] = [];
    const walk = (parent: string | null) => {
      for (const r of this.tree.children(parent)) {
        out.push(r);
        walk(r.id);
      }
    };
    walk(null);
    return out;
  }
  content(id: string) {
    return this.pages[id];
  }
  info(): IndexInfo {
    return { pages: 0, building: false, missing: 0, unreadable: 0 } as unknown as IndexInfo;
  }
}

function setup(specs = SPECS, pages = base()) {
  const t = fakeTree(specs);
  const tree: RegisterTree = { ...t, roots: () => t.children(null) };
  const source = new Source(tree, pages);
  const relations = new RelationIndex(tree, source, { yieldMs: 1e9 });
  const snap = () => relations.snapshot('p')!;
  const live = (): LiveSource => ({ snap: snap(), title: (id) => tree.get(id)?.title, content: (id) => source.content(id) });
  return { tree, source, relations, snap, live };
}

describe('de dónde salen (D528)', () => {
  it('solo de la página de la locación: no de un scouting, una ficha con «Alias», ni lo de afuera de las relaciones', async () => {
    const { relations, snap } = setup();
    await relations.update('p');
    const R = snap().registry;
    expect(R.locations.get('La Arenera (estudio)')!.forms).toEqual(['La Arenera (estudio)', 'La Arenera', 'Estudio Autos', 'Arenera', 'Estudio']);
    expect([...R.locations.values()].some((l) => l.forms.includes('Galpón Sur') || l.forms.includes('Notas'))).toBe(false);
    expect(R.locations.has('Galpón viejo')).toBe(false);
    relations.dispose();
  });

  it('una plantilla de locación no aporta nombres', async () => {
    const specs: Spec[] = [...SPECS, { id: 'tpl', parent: 'locs', title: 'Plantilla', settings: { template: {}, entity: { kind: 'location' } } as PageSettings }];
    const { relations, snap } = setup(specs, { ...base(), tpl: content([p('Otros nombres: Ficha')]) });
    await relations.update('p');
    expect([...snap().registry.locations.values()].some((l) => l.forms.includes('Ficha'))).toBe(false);
    relations.dispose();
  });

  it('un invitado que no ve la página de la locación no recibe sus nombres', async () => {
    const hidden = SPECS.filter((s) => s.id !== 'arenera' && s.id !== 'scout');
    const { relations, snap, live } = setup(hidden);
    await relations.update('p');
    expect(snap().registry.locations.has('La Arenera (estudio)')).toBe(false);
    expect(dayRef(live(), 'd34').locs).toEqual([]);
    expect(entityRelations(snap(), 'loc', 'La Arenera (estudio)').pages).toEqual([]);
    relations.dispose();
  });
});

describe('qué cambian', () => {
  it('la ficha con «Locacion Real | Estudio | Autos» da el lugar; la misma frase en un párrafo, no', async () => {
    const { relations, snap, live } = setup();
    await relations.update('p');
    const ficha = snap().pages.get('ficha')!;
    const locs = ficha.mentions.filter((m) => m.kind === 'loc');
    expect(locs.map((m) => [m.ref, m.via, m.block])).toEqual([['La Arenera (estudio)', 'text', 0]]);
    expect(sceneLive(live(), '105_027').plannedAt.map((x) => x.title)).toEqual(['La Arenera (estudio)']);
    // «Galpón Sur» escrito en una fila «Alias» de una ficha no es de nadie.
    expect(snap().pages.get('ficha2')!.mentions.filter((m) => m.kind === 'loc')).toEqual([]);
    // Las notas sueltas: ni «estudio» ni «Arenera VA» en el texto.
    expect(snap().pages.get('notas')!.mentions.filter((m) => m.kind === 'loc')).toEqual([]);
    relations.dispose();
  });

  it('el día por su título, el decorado «Estudio», y dos locaciones con el mismo nombre escrito: ninguna, con la nota', async () => {
    const pages = { ...base(), brand: content([p('Otros nombres: Europa')]) };
    const { relations, live } = setup(SPECS, pages);
    await relations.update('p');
    expect(dayRef(live(), 'd34').locs).toEqual(['La Arenera (estudio)']);
    const arenera = locationLive(live(), 'La Arenera (estudio)');
    expect(arenera.days.map((d) => d.day.pageId)).toEqual(['d34']);
    expect(arenera.sets.map((s) => s.title)).toEqual(['Barco de pasajeros']);
    expect(arenera.aliasNotes).toEqual([]);
    // «Europa» escrito en dos: el Día 35 no es de ninguna y las dos lo dicen.
    expect(dayRef(live(), 'd35').locs).toEqual([]);
    expect(locationLive(live(), 'Europa (plates)').aliasNotes).toEqual([{ alias: 'Europa', kind: 'shared', others: [{ name: 'Brandemburgo (Europa)', pageId: 'brand' }] }]);
    expect(locationLive(live(), 'Brandemburgo (Europa)').aliasNotes.map((n) => n.others[0].name)).toEqual(['Europa (plates)']);
    relations.dispose();
  });
});

describe('cuándo se aplican (D537)', () => {
  it('al abrir, enseguida; mientras se escribe, 2 s después del último cambio, sin releer las otras páginas', async () => {
    vi.useFakeTimers();
    const { relations, snap, source } = setup();
    await relations.update('p');
    expect(snap().registry.locations.get('Europa (plates)')!.forms).toContain('Europa');
    const before = snap().pages.get('notas');
    // Se escribe en la página de la locación: «Otros nombres: Europa, Plates del Este».
    source.pages.europa = content([p('Otros nombres: Europa, Plates del')]);
    await relations.update('p');
    expect(snap().registry.locations.get('Europa (plates)')!.forms).not.toContain('Plates del');
    // Las demás páginas no se reconocieron de nuevo: lo que existe no cambió todavía.
    expect(snap().pages.get('notas')).toBe(before);
    await vi.advanceTimersByTimeAsync(1000);
    source.pages.europa = content([p('Otros nombres: Europa, Plates del Este')]);
    await relations.update('p');
    await vi.advanceTimersByTimeAsync(WRITTEN_WAIT_MS - 100);
    expect(snap().registry.locations.get('Europa (plates)')!.forms).not.toContain('Plates del Este');
    await vi.advanceTimersByTimeAsync(200);
    await relations.update('p');
    expect(snap().registry.locations.get('Europa (plates)')!.forms).toContain('Plates del Este');
    expect(snap().registry.locations.get('Europa (plates)')!.forms).not.toContain('Plates del');
    relations.dispose();
  });

  it('una locación que se lee por primera vez (recién bajada) aporta lo suyo enseguida', async () => {
    const pages = base();
    const later = pages.arenera;
    delete pages.arenera;
    const { relations, snap, source } = setup(SPECS, pages);
    await relations.update('p');
    expect(snap().registry.locations.get('La Arenera (estudio)')!.forms).not.toContain('Arenera');
    expect(snap().complete).toBe(false);
    source.pages.arenera = later;
    await relations.update('p');
    expect(snap().registry.locations.get('La Arenera (estudio)')!.forms).toContain('Arenera');
    relations.dispose();
  });
});
