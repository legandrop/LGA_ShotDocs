// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { unmountAll } from './collabHarness';
import { para, photo, tally, type Tally } from './photoHarness';

// Dos personas editan a la vez un renglón con fotos en línea (Docs/Doc_Fotos_En_Linea.md, entrega 1a; Docs/
// Doc_Colaboracion.md). Agendas al azar con semilla fija: dos editores reales sobre dos documentos de Yjs que se
// cruzan los cambios en cualquier orden, con la reparación de la app. Esta es la vara para publicar: en estos
// casos no se pierde ni se duplica nada.
//
// Lo que sí puede perder (borrar, mover o insertar una foto mientras el otro escribe al lado; unir renglones o
// cambiar el tipo): collabPhotosLimits.test.ts. Los mismos casos sin el texto de los huecos (pierden):
// collabPhotosNoGaps.test.ts. Por defecto 300 agendas por caso; COLLAB_PHOTO_SCHEDULES cambia la cantidad.

afterEach(unmountAll);

const N = Number(process.env.COLLAB_PHOTO_SCHEDULES ?? 300);
const top = para('p0', ['top']);
const zero = { lost: 0, twice: 0, baseLost: 0, baseTwice: 0, photosLost: 0, photosTwice: 0, breaks: 0, different: 0, unsettled: 0, broken: 0 };
const counts = ({ schedules: _s, examples: _e, ...rest }: Tally) => rest;

const cases: { name: string; alphabet: string[]; initial: () => ReturnType<typeof para>[] }[] = [
  {
    name: '1. los dos escriben en los huecos de [foto][foto]',
    alphabet: ['TA', 'TB', 'TA', 'TB', 'dA', 'dB'],
    initial: () => [top, para('p1', [photo('F1'), photo('F2')])],
  },
  {
    name: '1. los dos escriben en los huecos de "abc"[foto]"def"[foto]',
    alphabet: ['TA', 'TB', 'TA', 'TB', 'dA', 'dB'],
    initial: () => [top, para('p1', ['abc', photo('F1'), 'def', photo('F2')])],
  },
  {
    name: '2. uno escribe y el otro cambia el ancho o agrega fotos en los huecos',
    alphabet: ['TA', 'TA', 'WB', 'PB', 'dA', 'dB'],
    initial: () => [top, para('p1', [photo('F1'), photo('F2')])],
  },
  {
    name: '2. los dos escriben, cambian anchos y agregan fotos en los huecos',
    alphabet: ['TA', 'TB', 'PA', 'PB', 'WA', 'WB', 'dA', 'dB'],
    initial: () => [top, para('p1', ['abc', photo('F1'), 'def', photo('F2')])],
  },
  {
    name: '3. control, solo texto: los dos escriben al principio y al final de los renglones',
    alphabet: ['TA', 'TB', 'TA', 'TB', 'dA', 'dB'],
    initial: () => [top, para('p1', ['abcdef'])],
  },
];

describe(`editar a la vez un renglón con fotos: 0 pérdidas y 0 duplicados (${N} agendas por caso)`, () => {
  for (const [i, c] of cases.entries()) {
    it(c.name, async () => {
      const t = await tally(7000 + i, N, c.alphabet, c.initial);
      expect(counts(t), t.examples.join('\n')).toEqual(zero);
    }, 300_000);
  }
});
