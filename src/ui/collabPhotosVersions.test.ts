// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { unmountAll } from './collabHarness';
import { schema } from './editorSchema';
import { para, previousSchema, tally, type Tally } from './photoHarness';

// Versiones mezcladas (Docs/Doc_Colaboracion.md, "El texto de los huecos"), con el ESQUEMA anterior y la librería
// de hoy (la librería de las versiones publicadas: collabPhotosVersions.published.test.ts). Entre que se publica
// esta versión y se sube `min_app_version`, la anterior y esta pueden editar la misma página. La parte nueva del parche solo
// cambia los párrafos que tienen fotos en línea, y la versión anterior no abre esas páginas (unknownContent.ts):
// en todo lo demás las dos escriben exactamente igual. Acá se prueba con los saltos de línea (Shift+Enter), el
// otro elemento en línea que ya existe en las páginas de los usuarios.

afterEach(unmountAll);

const N = Number(process.env.COLLAB_PHOTO_SCHEDULES ?? 300);
const counts = ({ schedules: _s, examples: _e, ...rest }: Tally) => rest;

describe('saltos de línea: la versión anterior y esta escriben igual', () => {
  const docs: [string, () => ReturnType<typeof para>[]][] = [
    ['un salto en el medio y dos seguidos', () => [para('p0', ['top']), para('p1', ['ab\ncd\n\nef'])]],
    ['saltos al principio y al final', () => [para('p0', ['top']), para('p1', ['\nab\n'])]],
  ];
  // Escribir pegado a un salto y agregar saltos, los dos.
  const alphabet = ['TA', 'TB', 'TA', 'TB', 'KA', 'KB', 'dA', 'dB'];
  for (const [i, [name, initial]] of docs.entries()) {
    it(`${name}: las mismas agendas dan lo mismo con las dos versiones, en cualquier combinación`, async () => {
      const run = (schemaA: unknown, schemaB: unknown) => tally(11000 + i, N, alphabet, initial, { schemaA, schemaB, around: 'hardBreak' });
      const now = await run(schema, schema);
      const before = await run(previousSchema, previousSchema);
      // En las agendas, quién gana un empate lo decide la semilla: "anterior y esta" cubre los dos órdenes.
      const mixed = await run(previousSchema, schema);
      expect(counts(now)).toEqual(counts(before));
      expect(counts(mixed)).toEqual(counts(before));
      // Siempre iguales, al día, sin ida y vuelta, y sin textos vacíos nuevos al lado de los saltos.
      expect({ different: now.different, unsettled: now.unsettled, broken: now.broken }).toEqual({ different: 0, unsettled: 0, broken: 0 });
      // Lo que ya pasaba antes de esta versión al escribir los dos en el mismo hueco entre saltos (Docs/
      // Doc_Colaboracion.md): se documenta, no lo cambia esta versión.
      if (N === 300) expect({ lost: now.lost, twice: now.twice, breaks: now.breaks }).toEqual(i === 0 ? { lost: 2, twice: 1, breaks: 0 } : { lost: 4, twice: 12, breaks: 0 });
    }, 600_000);
  }
});
