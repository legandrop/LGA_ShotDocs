// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { describe, expect, it } from 'vitest';
import { editorSchemaOptions } from './editorSchema';
import { editorSchemaOptions as publishedOptions } from './fixtures/editorSchemaMain';

// fixtures/editorSchemaMain.ts es la copia del esquema de la versión publicada: con ella las pruebas comprueban que lo
// nuevo degrada en la versión que puede seguir abierta en otro dispositivo. Si queda vieja, esas pruebas comparan contra
// una versión que ya no existe y dejan de proteger (pasó hasta v0.107: era la de v0.040). Esta prueba compara los dos
// esquemas tal como los arma ProseMirror: nodos, qué contenido acepta cada uno, sus atributos con su valor de fábrica y
// las marcas.
//
// Lo nuevo de una tanda que todavía no se publicó va en NUEVO_SIN_PUBLICAR (una línea por diferencia, como la muestra el
// error), con su prueba de que la versión publicada lo conserva. Al publicarla: se regenera el fixture (cómo, en su
// encabezado) y se vacía la lista.
const NUEVO_SIN_PUBLICAR: string[] = [
  // El alto de las miniaturas de una tabla (cellThumbs.ts, D27 → B); la versión publicada lo conserva: cellThumbs.test.ts.
  'atributo table.thumbHeight = 96',
];

function signature(options: unknown): string[] {
  const editor = BlockNoteEditor.create(options as typeof editorSchemaOptions);
  const { nodes, marks } = editor.pmSchema;
  const out: string[] = [];
  for (const [name, type] of Object.entries(nodes)) {
    out.push(`nodo ${name}: ${type.spec.content ?? ''} | ${type.spec.group ?? ''}`);
    for (const [attr, spec] of Object.entries(type.spec.attrs ?? {})) out.push(`atributo ${name}.${attr} = ${JSON.stringify(spec.default)}`);
  }
  for (const [name, type] of Object.entries(marks)) {
    out.push(`marca ${name}`);
    for (const [attr, spec] of Object.entries(type.spec.attrs ?? {})) out.push(`atributo de marca ${name}.${attr} = ${JSON.stringify(spec.default)}`);
  }
  return out.sort();
}

const HOW =
  'Si esta versión ya se publicó, regenerá src/ui/fixtures/editorSchemaMain.ts (los pasos están en su encabezado) y ' +
  'vaciá NUEVO_SIN_PUBLICAR. Si es lo nuevo de una tanda sin publicar, sumá cada línea a NUEVO_SIN_PUBLICAR, con su ' +
  'prueba de que la versión publicada lo conserva.';

describe('el fixture del esquema publicado', () => {
  const now = signature(editorSchemaOptions);
  const published = signature(publishedOptions);

  it('esta versión tiene todo lo del esquema publicado (nunca saca un nodo, un atributo ni una marca)', () => {
    const missing = published.filter((line) => !now.includes(line));
    expect(missing, `Esto está en fixtures/editorSchemaMain.ts y no en src/ui/editorSchema.ts. ${HOW} Sacar algo del esquema borra lo que la versión publicada escribió.`).toEqual([]);
  });

  it('lo que esta versión suma al esquema publicado es exactamente NUEVO_SIN_PUBLICAR', () => {
    const added = now.filter((line) => !published.includes(line));
    expect(added, `src/ui/editorSchema.ts y fixtures/editorSchemaMain.ts difieren. ${HOW}`).toEqual([...NUEVO_SIN_PUBLICAR].sort());
  });

  it('la firma ve lo que importa: los atributos del párrafo y la foto en línea', () => {
    expect(now).toContain('atributo paragraph.pageBreak = false');
    expect(now.some((line) => line.startsWith('nodo photo:'))).toBe(true);
    expect(now.some((line) => line.startsWith('nodo tableParagraph:') || line.startsWith('nodo tableCell:'))).toBe(true);
  });
});
