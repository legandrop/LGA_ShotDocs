// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { buildCleanBase, checkCleanBase } from '../sync/clean';
import { normalizeStructure } from '../sync/structure';
import { mountEditor, unmountAll, type Editor } from './collabHarness';
import { SHARED_COLLAPSE_MAP } from './collapseEditor';
import { paragraphProps } from './editorSchema';
import { schema as olderSchema } from './fixtures/editorSchemaAnterior';

// La base limpia con el editor real (Docs/Doc_Privacidad_Borrado.md, prueba 2 de la sección 9): una página con texto,
// links, formato, una foto en línea, una foto-bloque con epígrafe, Script, preguntas, una tabla, una tarjeta de Drive,
// un bloque hijo y el mapa de colapsar para todos. Se pone un secreto en cada lugar y después se pisa o se borra. Las
// filas (cada update del editor, como las sube el dispositivo) los llevan; la base, ninguno. La página que abre un
// lector desde la base es la del editor, sin reparaciones, también con el esquema de la versión anterior.

afterEach(unmountAll);

const SECRET = /SEC\d+/g;
const secretsIn = (bytes: Uint8Array) => new Set(Buffer.from(bytes).toString('latin1').match(SECRET) ?? []);
const settle = () => new Promise((r) => setTimeout(r, 0));

/** Cada update del documento, en orden, como las filas que sube el dispositivo (con el texto que después se borra). */
function recorder(doc: Y.Doc): Uint8Array[] {
  const rows: Uint8Array[] = [];
  doc.on('update', (u: Uint8Array) => rows.push(u));
  return rows;
}

const blocks = (e: Editor) => e.document as unknown as { id: string; type: string; children: unknown[] }[];

describe('la base limpia de una página con el editor real', () => {
  it('ningún secreto pisado o borrado está en la base, y el lector ve la misma página', async () => {
    const doc = new Y.Doc();
    const rows = recorder(doc);
    const editor = mountEditor(doc, 'editor');
    const p = (kind: Parameters<typeof paragraphProps>[0], content: unknown, extra: object = {}) =>
      ({ type: 'paragraph', props: paragraphProps(kind), content, ...extra }) as never;
    editor.replaceBlocks(editor.document, [
      p('paragraph', 'queda SEC1'),
      p('paragraph', [{ type: 'link', href: 'https://SEC2.example', content: 'un link' }]),
      { type: 'image', props: { url: 'sdmedia://SEC3', caption: 'SEC4 epígrafe', name: 'SEC5.jpg' } } as never,
      p('paragraph', ['antes ', { type: 'photo', props: { url: 'sdmedia://SEC6', name: 'SEC6.jpg', w: 0.5 } }, ' después']),
      p('script', 'INT. CASA SEC7 - DÍA'),
      p('question', '¿Cuándo SEC8?'),
      {
        type: 'table',
        content: { type: 'tableContent', rows: [{ cells: ['SEC9', 'celda'] }, { cells: ['a', 'b'] }] },
      } as never,
      p('driveCard', [{ type: 'link', href: 'https://drive.google.com/file/d/SEC10/view', content: 'archivo' }]),
      { type: 'heading', content: 'Título', children: [p('paragraph', 'hijo SEC11')] } as never,
      p('paragraph', [{ type: 'text', text: 'negrita SEC13', styles: { bold: true } }]),
      p('paragraph', 'final'),
    ]);
    await settle();
    // El mapa de colapsar: su clave es el id del bloque (queda en la base como metadato, sección 6 del doc); el valor no.
    doc.getMap(SHARED_COLLAPSE_MAP).set('bloque-colapsado', 'SEC12');
    await settle();

    // Se pisa o se borra cada secreto.
    const all = blocks(editor);
    editor.updateBlock(all[0].id, { content: 'queda' } as never);
    editor.updateBlock(all[1].id, { content: 'sin link' } as never);
    editor.updateBlock(all[2].id, { props: { url: 'sdmedia://otra', caption: 'epígrafe nuevo', name: 'otra.jpg' } } as never);
    editor.updateBlock(all[3].id, { content: 'antes después' } as never);
    editor.removeBlocks([all[4].id]);
    editor.updateBlock(all[5].id, { content: '¿Cuándo?' } as never);
    editor.updateBlock(all[6].id, {
      content: { type: 'tableContent', rows: [{ cells: ['nueva', 'celda'] }, { cells: ['a', 'b'] }] },
    } as never);
    editor.removeBlocks([all[7].id]);
    editor.removeBlocks([(all[8].children[0] as { id: string }).id]);
    editor.updateBlock(all[9].id, { content: [{ type: 'text', text: 'negrita', styles: { bold: true } }] } as never);
    await settle();
    doc.getMap(SHARED_COLLAPSE_MAP).delete('bloque-colapsado');
    await settle();

    // Las filas llevan los secretos (lo que hoy baja un lector); la base, ninguno.
    const inRows = new Set(rows.flatMap((r) => [...secretsIn(r)]));
    expect(inRows.size).toBeGreaterThanOrEqual(12);
    const built = buildCleanBase(rows);
    expect([...secretsIn(built.base)]).toEqual([]);
    expect(checkCleanBase(built.base, built.doc)).toBe(null);

    // El lector abre la base: la misma página, sin reparar nada.
    const reader = new Y.Doc();
    Y.applyUpdate(reader, built.base);
    expect(normalizeStructure(reader, 'repair')).toBe(false);
    const readerEditor = mountEditor(reader, 'lector');
    await settle();
    expect(JSON.stringify(readerEditor.document)).toBe(JSON.stringify(editor.document));
    expect(reader.getMap(SHARED_COLLAPSE_MAP).toJSON()).toEqual(doc.getMap(SHARED_COLLAPSE_MAP).toJSON());
    // Abrir la base no escribió nada en el documento del lector (el editor no la tuvo que "arreglar").
    expect(Y.encodeStateVector(reader)).toEqual(Y.encodeStateVectorFromUpdate(built.base));

    // Con el esquema de la versión anterior, la base se abre igual que las filas.
    const oldFromRows = new Y.Doc();
    Y.applyUpdate(oldFromRows, Y.mergeUpdates(rows));
    const oldFromBase = new Y.Doc();
    Y.applyUpdate(oldFromBase, built.base);
    const a = mountEditor(oldFromRows, 'viejo-filas', olderSchema);
    const b = mountEditor(oldFromBase, 'viejo-base', olderSchema);
    await settle();
    expect(JSON.stringify(b.document)).toBe(JSON.stringify(a.document));
    built.doc.destroy();
  });
});
