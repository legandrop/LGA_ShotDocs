// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { unmountAll } from './collabHarness';
import { schema } from './editorSchema';
import { limits, losses, noGapsSchema, para, photo, tally } from './photoHarness';

// Para comparar: los mismos casos de collabPhotos.test.ts y collabPhotosLimits.test.ts con las fotos en línea
// guardadas SIN el texto de los huecos (como las guardaría y-prosemirror sin la parte nueva del parche: sin la
// marca en el nodo, el renglón va por el código de siempre). Ninguna versión de la app guarda así: sirve para
// saber qué arreglan los huecos estables, con números (Docs/Doc_Colaboracion.md, "El texto de los huecos" y
// "Huecos estables"). 300 agendas por caso, las mismas semillas.

afterEach(unmountAll);

const noGaps = { schemaA: noGapsSchema, schemaB: noGapsSchema };

describe('sin el texto de los huecos, escribir los dos en el mismo hueco pierde y duplica (lo que arregla el parche)', () => {
  // Las mismas agendas (semilla y pasos) que el caso de collabPhotos.test.ts, que con el texto de los huecos da 0.
  const typing = ['TA', 'TB', 'TA', 'TB', 'dA', 'dB'];
  const textAndPhotos = () => [para('p0', ['top']), para('p1', ['abc', photo('F1'), 'def', photo('F2')])];
  const cases = [
    { name: 'los dos escriben en los huecos de [foto][foto]', seed: 7000, alphabet: typing, initial: () => [para('p0', ['top']), para('p1', [photo('F1'), photo('F2')])], lost: 21, twice: 52 },
    { name: 'los dos escriben en los huecos de "abc"[foto]"def"[foto]', seed: 7001, alphabet: typing, initial: textAndPhotos, lost: 0, twice: 20 },
    {
      name: 'los dos escriben, cambian anchos y agregan fotos en los huecos',
      seed: 7003,
      alphabet: ['TA', 'TB', 'PA', 'PB', 'WA', 'WB', 'dA', 'dB'],
      initial: textAndPhotos,
      lost: 0,
      twice: 2,
    },
  ];
  for (const c of cases) {
    it(c.name, async () => {
      const t = await tally(c.seed, 300, c.alphabet, c.initial, noGaps);
      expect({ lost: t.lost, twice: t.twice }).toEqual({ lost: c.lost, twice: c.twice });
      expect({ different: t.different, unsettled: t.unsettled }).toEqual({ different: 0, unsettled: 0 });
    }, 300_000);
  }
});

describe('sin el texto de los huecos, los límites conocidos (donde el número cambia)', () => {
  for (const [i, limit] of limits.entries()) {
    // Donde las dos formas dan lo mismo no hace falta repetirlo.
    if (JSON.stringify(limit.gaps) === JSON.stringify(limit.noGaps)) continue;
    it(limit.name, async () => {
      const t = await tally(9000 + i, 300, limit.alphabet, limit.initial, noGaps);
      expect({ different: t.different, unsettled: t.unsettled }).toEqual({ different: 0, unsettled: 0 });
      expect(losses(t), t.examples.join('\n')).toEqual(limit.noGaps);
    }, 300_000);
  }
});

describe('las dos formas mezcladas en el mismo renglón (no pasa en la app: para saber qué pasaría)', () => {
  // Un editor con los huecos estables y otro sin el texto de los huecos. En la app no pasa: la versión anterior
  // no conoce `photo` y no abre la página (unknownContent.ts), y toda versión que conoce `photo` tiene el parche
  // entero (vite.config.ts no construye sin él). Si pasara: no hay ida y vuelta (cada lado reescribe solo lo que
  // él mismo edita) y los dos terminan iguales. Como el lado con los huecos estables nunca borra un texto, en
  // estas agendas no se pierde nada (antes de los huecos estables se perdía más que con cualquiera de las dos
  // formas sola); los textos que escribe el otro lado quedan sin la marca.
  it('no se quedan reparándose uno al otro y terminan iguales', async () => {
    const alphabet = ['TA', 'TB', 'TA', 'TB', 'PA', 'PB', 'WA', 'WB', 'dA', 'dB'];
    const initial = () => [para('p0', ['top']), para('p1', ['abc', photo('F1'), photo('F2')])];
    const t = await tally(12000, 300, alphabet, initial, { schemaA: schema, schemaB: noGapsSchema });
    expect({ different: t.different, unsettled: t.unsettled }).toEqual({ different: 0, unsettled: 0 });
    expect({ lost: t.lost, twice: t.twice, photosLost: t.photosLost, photosTwice: t.photosTwice }).toEqual({ lost: 0, twice: 0, photosLost: 0, photosTwice: 0 });
  }, 300_000);
});
