// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { editorSchemaOptions } from './editorSchema';
import { FIRMA_PUBLICADA } from './fixtures/editorSchemaMain.firma';

// fixtures/editorSchemaMain.ts es la copia del esquema de la versión publicada: con ella las pruebas comprueban que lo
// nuevo degrada en la versión que puede seguir abierta en otro dispositivo. Si queda vieja, esas pruebas comparan contra
// una versión que ya no existe y dejan de proteger (pasó hasta v0.107: era la de v0.040; y otra vez después: el alto de
// las miniaturas de las tablas se publicó y el fixture siguió sin él). Esta prueba compara el esquema de hoy con la FIRMA
// de la versión publicada, tal como la arma ProseMirror: nodos, qué contenido acepta cada uno, sus atributos con su valor
// de fábrica y las marcas.
//
// La firma es un texto fijo (fixtures/editorSchemaMain.firma.ts) y no sale de las opciones del fixture a propósito: el
// fixture importa de hoy el módulo de la foto en línea (`photoSpec`), el de la tarjeta de Drive y el de las filas de fotos,
// así que un atributo nuevo de la foto aparecía también en la "publicada" y la prueba no lo veía.
//
// Lo nuevo de una tanda que todavía no se publicó va en NUEVO_SIN_PUBLICAR (una línea por diferencia, como la muestra el
// error), con su prueba de que la versión publicada lo conserva. Al publicarla: `npm run esquema:publicado` (regenera el
// fixture y la firma y vacía la lista; cómo y cuándo, en scripts/esquema-publicado.mjs).
const NUEVO_SIN_PUBLICAR: string[] = [];

/** La firma del esquema de unas opciones del editor. */
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
  'Si esta versión ya se publicó, corré `npm run esquema:publicado` (regenera src/ui/fixtures/editorSchemaMain.ts y su ' +
  'firma y vacía NUEVO_SIN_PUBLICAR; los pasos están en scripts/esquema-publicado.mjs). Si es lo nuevo de una tanda sin ' +
  'publicar, sumá cada línea a NUEVO_SIN_PUBLICAR, con su prueba de que la versión publicada lo conserva.';

// El script de regeneración corre esto con FIRMA_ESCRIBIR=1 para escribir la firma de hoy como la publicada.
const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
it.skipIf(!process.env.FIRMA_ESCRIBIR)('(solo con FIRMA_ESCRIBIR=1) escribe la firma de hoy como la publicada', () => {
  const lines = signature(editorSchemaOptions);
  const text =
    '// Firma del esquema del editor de la versión publicada (editorSchemaFixture.test.ts la compara con la de hoy).\n' +
    '// La escribe scripts/esquema-publicado.mjs (`npm run esquema:publicado`): no se edita a mano.\n\n' +
    `export const FIRMA_PUBLICADA: string[] = [\n${lines.map((l) => `  ${quote(l)},`).join('\n')}\n];\n`;
  writeFileSync('src/ui/fixtures/editorSchemaMain.firma.ts', text);
});

describe('el fixture del esquema publicado', () => {
  const now = signature(editorSchemaOptions);

  it('esta versión tiene todo lo del esquema publicado (nunca saca un nodo, un atributo ni una marca)', () => {
    const missing = FIRMA_PUBLICADA.filter((line) => !now.includes(line));
    expect(missing, `Esto está en la firma publicada (fixtures/editorSchemaMain.firma.ts) y no en src/ui/editorSchema.ts. ${HOW} Sacar algo del esquema borra lo que la versión publicada escribió.`).toEqual([]);
  });

  it('lo que esta versión suma al esquema publicado es exactamente NUEVO_SIN_PUBLICAR', () => {
    const added = now.filter((line) => !FIRMA_PUBLICADA.includes(line));
    expect(added, `src/ui/editorSchema.ts y la firma publicada (fixtures/editorSchemaMain.firma.ts) difieren. ${HOW}`).toEqual([...NUEVO_SIN_PUBLICAR].sort());
  });

  it('la firma ve lo que importa: los atributos del párrafo y la foto en línea', () => {
    expect(now).toContain('atributo paragraph.pageBreak = false');
    expect(now.some((line) => line.startsWith('nodo photo:'))).toBe(true);
    // Los atributos de la foto vienen de un módulo compartido: la firma los trae fijos, no los del fixture.
    expect(FIRMA_PUBLICADA.filter((line) => line.startsWith('atributo photo.')).length).toBeGreaterThan(0);
    expect(now.some((line) => line.startsWith('nodo tableParagraph:') || line.startsWith('nodo tableCell:'))).toBe(true);
  });

  // Que nadie se olvide de regenerar después de publicar: si el esquema de esta copia es el mismo que el de origin/main
  // (esta rama no lo cambió) y el fixture no es ese esquema, se publicó un cambio del esquema sin regenerar. En una rama que
  // cambia el esquema a propósito, o sin git o sin origin/main, la prueba se salta: nunca frena el trabajo normal.
  it('el fixture es el esquema de origin/main cuando esta copia no lo cambió', (ctx) => {
    const SCHEMA = 'src/ui/editorSchema.ts';
    let main: string;
    try {
      main = execFileSync('git', ['show', `origin/main:${SCHEMA}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 });
    } catch {
      ctx.skip('no hay git u origin/main en esta copia');
      return;
    }
    // Sin los comentarios y renglones vacíos del principio (el encabezado del fixture lo pone el script) ni los fines de línea.
    const body = (text: string) => {
      const lines = text.replace(/\r\n/g, '\n').split('\n');
      const first = lines.findIndex((l) => l.trim() !== '' && !l.startsWith('//'));
      return lines.slice(Math.max(0, first)).join('\n').trim();
    };
    const mine = readFileSync(SCHEMA, 'utf8');
    if (body(mine) !== body(main)) {
      ctx.skip('esta copia cambió el esquema respecto de origin/main (una tanda sin publicar)');
      return;
    }
    const fixture = readFileSync('src/ui/fixtures/editorSchemaMain.ts', 'utf8');
    const published = body(main.replace(/from '\.\//g, "from '../"));
    expect(
      body(fixture) === published,
      `origin/main cambió ${SCHEMA} y src/ui/fixtures/editorSchemaMain.ts quedó con el esquema de antes: las pruebas de que lo nuevo degrada comparan contra una versión que ya no existe. Corré \`npm run esquema:publicado\` y commiteá el fixture y su firma. (Si origin/main de tu copia está desactualizado, hacé \`git fetch\`.)`,
    ).toBe(true);
  });
});
