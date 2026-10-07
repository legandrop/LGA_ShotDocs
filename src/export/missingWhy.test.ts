// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { prefs } from '../prefs';
import { missingLine, type MissingWhy } from './exportZip';

// `MISSING_FILES.txt` del zip: cada motivo dice su propio texto, en los dos idiomas. Las claves van escritas enteras en
// `WHY_TEXT` (src/export/exportZip.ts) para que la prueba del diccionario vea que se usan; esta mira que cada motivo
// apunte a la suya y no a la de otro.

afterEach(() => prefs.set({ language: 'en' }));

const TEXTS: Record<Exclude<MissingWhy, 'comments'>, { en: string; es: string }> = {
  offline: { en: 'not on this device and there was no connection', es: 'no está en este dispositivo y no había conexión' },
  failed: { en: 'could not be downloaded', es: 'no se pudo bajar' },
  incomplete: { en: 'only part of it arrived', es: 'llegó solo una parte' },
  deleted: { en: 'it was sent to the Drive trash', es: 'se mandó a la papelera de Drive' },
  unknown: {
    en: 'this device does not know this file yet (it never showed it and there was no connection)',
    es: 'este dispositivo todavía no conoce este archivo (nunca lo mostró y no había conexión)',
  },
  noView: { en: 'there is no preview of it on this device', es: 'no hay una vista de este archivo en el dispositivo' },
  pageOutdated: { en: 'this page may be out of date on this device', es: 'esta página puede no estar al día en este dispositivo' },
  pageUnknown: { en: 'part of this page needs a newer version of the app', es: 'una parte de esta página necesita una versión más nueva de la app' },
  pageFailed: { en: 'this page could not be exported', es: 'no se pudo exportar esta página' },
};

describe('los motivos de MISSING_FILES.txt', () => {
  it('cada motivo dice su texto, en inglés y en castellano', () => {
    for (const language of ['en', 'es'] as const) {
      prefs.set({ language });
      for (const [why, text] of Object.entries(TEXTS) as [Exclude<MissingWhy, 'comments'>, { en: string; es: string }][]) {
        expect(missingLine({ path: 'a/Files/x.mov', why }, null), `${why} en ${language}`).toBe(`a/Files/x.mov — ${text[language]}`);
      }
    }
    // Ninguno repite el texto de otro.
    expect(new Set(Object.values(TEXTS).map((t) => t.en)).size).toBe(Object.keys(TEXTS).length);
  });

  it('el detalle va entre paréntesis, y los comentarios dicen de cuándo son', () => {
    expect(missingLine({ path: 'a/x.jpg', why: 'failed', detail: 'HTTP 500' }, null)).toBe('a/x.jpg — could not be downloaded (HTTP 500)');
    const line = missingLine({ path: '_shotdocs/comments.json', why: 'comments' }, Date.UTC(2026, 9, 1, 12));
    expect(line).toMatch(/^_shotdocs\/comments\.json — comments as on this device on .*2026.* \(they could not be updated\)$/);
  });
});
