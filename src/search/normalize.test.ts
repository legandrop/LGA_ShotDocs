import { describe, expect, it } from 'vitest';
import { normalize, normalizeQuery, searchText } from './normalize';

// Cómo compara la búsqueda (Docs/Doc_Buscar.md, sección 4 y corrección 10).

const found = (text: string, query: string, options = {}) => searchText(text, query, options).map(([s, e]) => text.slice(s, e));

describe('normalizar', () => {
  it('sin mayúsculas ni tildes; la ñ vale como n', () => {
    expect(normalize('Cámara ÑANDÚ Über').text).toBe('camara nandu uber');
    expect(found('La Cámara grande', 'camara')).toEqual(['Cámara']);
    expect(found('Año nuevo', 'ano')).toEqual(['Año']);
    expect(found('camara', 'CÁMARA')).toEqual(['camara']);
  });

  it('una tilde descompuesta (I + tilde combinada, como pega macOS) queda adentro del resaltado', () => {
    const text = 'DÍA y noche';
    expect(found(text, 'dia')).toEqual(['DÍA']);
    expect(found(text, 'DÍA')).toEqual(['DÍA']);
    // Termina justo antes de la tilde: la tilde entra en el resaltado.
    expect(found('Í', 'i')).toEqual(['Í']);
  });

  it('con Aa: mayúsculas y tildes exactas, y la Í descompuesta es la misma que la compuesta', () => {
    expect(found('Cámara camara CAMARA', 'camara', { matchCase: true })).toEqual(['camara']);
    expect(found('Cámara camara', 'Cámara', { matchCase: true })).toEqual(['Cámara']);
    expect(found('DÍA', 'DÍA', { matchCase: true })).toEqual(['DÍA']);
    // "I" no encuentra la I de una Í.
    expect(found('DÍA', 'DI', { matchCase: true })).toEqual([]);
    expect(found('Año', 'Ano', { matchCase: true })).toEqual([]);
  });

  it('İ, ß y lo que NFD no separa', () => {
    expect(found('İstanbul', 'istanbul')).toEqual(['İstanbul']);
    expect(found('Straße', 'strasse')).toEqual([]);
    expect(found('Straße', 'straße')).toEqual(['Straße']);
    expect(found('Øresund', 'oresund')).toEqual([]);
  });

  it('espacios seguidos cuentan como uno; lo buscado sin espacios en las puntas', () => {
    expect(found('toma     tres', 'toma tres')).toEqual(['toma     tres']);
    expect(normalizeQuery('  toma  ')).toBe('toma');
    expect(found('abc', '   ')).toEqual([]);
  });

  it('partes de palabras, y palabra entera', () => {
    expect(found('Cámaras y camarógrafo', 'cam')).toEqual(['Cám', 'cam']);
    expect(found('Cámaras y cámara.', 'camara', { wholeWord: true })).toEqual(['cámara']);
    expect(found('plano1 plano', 'plano', { wholeWord: true })).toEqual(['plano']);
  });

  it('emojis y pares sustitutos', () => {
    const text = 'foto 📷 cámara 📷 final';
    expect(found(text, 'camara')).toEqual(['cámara']);
    expect(found(text, '📷')).toEqual(['📷', '📷']);
    expect(found('𝒜bc abc', 'abc', { wholeWord: true })).toEqual(['abc']);
  });

  it('el separador de un salto de línea no es un espacio', () => {
    expect(found('toma￼tres', 'toma tres')).toEqual([]);
    expect(found('toma￼tres', 'tres', { wholeWord: true })).toEqual(['tres']);
  });

  it('coreano: una sílaba no se parte (NFD la separa en letras)', () => {
    expect(found('한국', '하')).toEqual([]);
    expect(found('한국', '한')).toEqual(['한']);
    expect(searchText('한국', '하')).toEqual([]);
  });

  it('emojis compuestos: el tono de piel, el selector de variante y el ZWJ quedan adentro', () => {
    expect(found('ok 👍🏽 listo', '👍')).toEqual(['👍🏽']);
    expect(found('👩\u200D💻 dev', '👩')).toEqual(['👩\u200D💻']);
    expect(found('te ❤\uFE0F mucho', '❤')).toEqual(['❤\uFE0F']);
  });

  it('no se superponen', () => {
    expect(found('aaaa', 'aa')).toEqual(['aa', 'aa']);
  });
});
