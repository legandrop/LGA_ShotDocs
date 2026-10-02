// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { yXmlFragmentToBlocks } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { buildSeed, CONTENT_FRAGMENT } from '../sync/structure';
import { mountEditor, tick, unmountAll } from '../ui/collabHarness';
import { paragraphProps, schema } from '../ui/editorSchema';
import { schema as anteriorSchema } from '../ui/fixtures/editorSchemaAnterior';
import { schema as publishedSchema } from '../ui/fixtures/editorSchemaMain';
import { findUnknownContent } from '../ui/unknownContent';
import { insertTemplate } from './apply';
import { BUILTIN_IDS, BUILTIN_KINDS, BUILTIN_SLUGS, builtinBlocks, builtinTexts, kindOfSlug, type TemplateBlock } from './builtin';

// Las tres plantillas de fábrica (Docs/Doc_Plantillas.md, sección 2 y entrega 0): solo bloques que ya existen, las
// mismas filas en los dos idiomas, y una página creada con cualquiera de ellas se abre en la versión publicada (y en
// la anterior) sin que el editor viejo escriba ni borre nada.

afterEach(unmountAll);

const LANGS = ['en', 'es'] as const;
const KNOWN_TYPES = new Set(['heading', 'paragraph', 'table', 'checkListItem', 'bulletListItem']);
const PARAGRAPH_KINDS = [paragraphProps('script'), paragraphProps('question')].map((p) => JSON.stringify(p));

/** La forma de los bloques sin los textos: cada texto pasa a "hay texto" o "vacío". */
function shape(value: unknown): unknown {
  if (typeof value === 'string') return value === '' ? '' : 'T';
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]));
  return value;
}

type TableContent = { headerRows?: number; headerCols?: number; rows: { cells: string[] }[] };
const tables = (blocks: TemplateBlock[]) => blocks.filter((b) => b.type === 'table').map((b) => b.content as TableContent);

/** Una página nueva (con la semilla) con la plantilla agregada como lo hace la app. */
async function pageWith(kind: (typeof BUILTIN_KINDS)[number], lang: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, buildSeed('nueva'));
  const editor = mountEditor(doc, 'a');
  insertTemplate(editor as never, builtinBlocks(kind, lang));
  await tick(10);
  return doc;
}

describe('plantillas de fábrica', () => {
  it('en inglés y en castellano tienen los mismos bloques, filas y columnas (cambian solo los textos)', () => {
    for (const kind of BUILTIN_KINDS) {
      expect(shape(builtinBlocks(kind, 'es')), kind).toEqual(shape(builtinBlocks(kind, 'en')));
    }
    const en = builtinTexts('en');
    const es = builtinTexts('es');
    for (const kind of BUILTIN_KINDS) {
      expect(en.names[kind]).not.toBe(es.names[kind]);
      expect(es.descriptions[kind].length).toBeGreaterThan(20);
    }
    // Otro idioma cae al inglés.
    expect(builtinBlocks('onset', 'fr')).toEqual(builtinBlocks('onset', 'en'));
  });

  it('solo usan bloques que ya existen, con propiedades que ya existen', () => {
    for (const kind of BUILTIN_KINDS) {
      for (const lang of LANGS) {
        for (const block of builtinBlocks(kind, lang)) {
          expect(KNOWN_TYPES.has(block.type as string), `${kind} ${lang} ${String(block.type)}`).toBe(true);
          expect(block.id, 'sin ids: el editor pone uno nuevo').toBeUndefined();
          if (block.type === 'paragraph' && block.props) expect(PARAGRAPH_KINDS).toContain(JSON.stringify(block.props));
          if (block.type === 'heading') expect([2, 3]).toContain((block.props as { level: number }).level);
        }
      }
    }
  });

  it('las tablas entran en una hoja vertical (7 columnas o menos) y las fichas son de 2 columnas con rótulo', () => {
    for (const kind of BUILTIN_KINDS) {
      const list = tables(builtinBlocks(kind, 'en'));
      expect(list.length).toBeGreaterThan(0);
      for (const table of list) {
        const cols = table.rows[0].cells.length;
        expect(cols).toBeLessThanOrEqual(7);
        for (const row of table.rows) expect(row.cells.length).toBe(cols);
        if (table.headerCols === 1) {
          expect(cols).toBe(2);
          for (const row of table.rows) expect(row.cells[0]).not.toBe('');
        } else {
          expect(table.headerRows).toBe(1);
          for (const cell of table.rows[0].cells) expect(cell).not.toBe('');
        }
      }
      // La primera es la ficha de datos (la lee el reporte del día, entrega 2).
      expect(list[0].headerCols).toBe(1);
    }
  });

  it('la ficha de On-Set Report tiene las filas que lee el reporte del día, en los dos idiomas', () => {
    const labels = (lang: string) => tables(builtinBlocks('onset', lang))[0].rows.map((r) => r.cells[0]);
    expect(labels('en')).toEqual(expect.arrayContaining(['Date', 'Shoot day', 'Location', 'Unit', 'VFX on set', 'Director · DP']));
    expect(labels('es')).toEqual(expect.arrayContaining(['Fecha', 'Día de rodaje', 'Locación', 'Unidad', 'VFX en set', 'Director · DF']));
    // Los valores que trae la plantilla: la unidad principal; la fecha y el día los pone el botón (entrega 2).
    const unit = tables(builtinBlocks('onset', 'en'))[0].rows.find((r) => r.cells[0] === 'Unit');
    expect(unit?.cells[1]).toBe('Main unit');
  });

  it('lo interno va al final, en su sección (para borrarla antes de compartir con un cliente)', () => {
    for (const kind of ['prepro', 'shot'] as const) {
      for (const lang of LANGS) {
        const blocks = builtinBlocks(kind, lang);
        const headings = blocks.filter((b) => b.type === 'heading' && (b.props as { level: number }).level === 2);
        expect(headings.at(-1)?.content).toBe(builtinTexts(lang).internal);
      }
    }
    expect(JSON.stringify(builtinBlocks('onset', 'en'))).not.toContain(builtinTexts('en').internal);
  });

  it('cada llamada da objetos nuevos: cambiar uno no cambia la plantilla', () => {
    const a = builtinBlocks('shot', 'en');
    (a[0] as { type: string }).type = 'paragraph';
    expect(builtinBlocks('shot', 'en')[0].type).toBe('table');
  });

  it('ids fijos (uuid, distintos) y la dirección de la vista previa ida y vuelta', () => {
    const ids = Object.values(BUILTIN_IDS);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    for (const kind of BUILTIN_KINDS) expect(kindOfSlug(BUILTIN_SLUGS[kind])).toBe(kind);
    expect(BUILTIN_SLUGS.onset).toBe('on-set');
    expect(kindOfSlug('nada')).toBeNull();
    expect(kindOfSlug(null)).toBeNull();
  });
});

describe('una página creada con una plantilla de fábrica', () => {
  it('queda con todo lo de la plantilla y el párrafo de la semilla al final', async () => {
    for (const kind of BUILTIN_KINDS) {
      const doc = await pageWith(kind, 'es');
      const reader = BlockNoteEditor.create({ schema }) as unknown as BlockNoteEditor;
      const blocks = yXmlFragmentToBlocks(reader as never, doc.getXmlFragment(CONTENT_FRAGMENT)) as unknown as { id: string; type: string }[];
      const built = builtinBlocks(kind, 'es');
      expect(blocks.length).toBe(built.length + 1);
      expect(blocks.at(-1)!.id).toBe('initialBlockId');
      expect(blocks.slice(0, -1).map((b) => b.type)).toEqual(built.map((b) => b.type));
      expect(findUnknownContent(doc)).toBeNull();
      unmountAll();
    }
  });

  it('la versión publicada (y la anterior) la abren sin escribir ni borrar nada, en los dos idiomas', async () => {
    for (const old of [publishedSchema, anteriorSchema]) {
      for (const kind of BUILTIN_KINDS) {
        for (const lang of LANGS) {
          const doc = await pageWith(kind, lang);
          const clone = new Y.Doc();
          Y.applyUpdate(clone, Y.encodeStateAsUpdate(doc));
          const before = Y.encodeStateVector(clone);
          const writes: Uint8Array[] = [];
          clone.on('update', (u: Uint8Array) => writes.push(u));
          const e = mountEditor(clone, 'vieja', old);
          await tick(20);
          expect(writes, `${kind} ${lang}`).toEqual([]);
          expect(Y.encodeStateVector(clone)).toEqual(before);
          // La vieja ve los mismos bloques (ninguno se cayó).
          expect(e.document.length, `${kind} ${lang}`).toBe(builtinBlocks(kind, lang).length + 1);
          unmountAll();
        }
      }
    }
  });
});
