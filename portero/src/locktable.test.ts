import { describe, expect, it } from 'vitest';
import { LockTable, memoryLockRows } from './core';

// La tabla de candados entre instancias del Durable Object (v0.264, Docs/Doc_Portero.md, «Candado entre instancias del
// Worker»): de quién es cada candado, cuándo vence y que la verdad esté en el almacenamiento del objeto.

describe('LockTable: el candado entre instancias', () => {
  it('un release tardío de un dueño vencido no borra el candado de quien lo tomó después', () => {
    const t = new LockTable();
    expect(t.claim('k', 'A', 30_000, 0)).toBe(true);
    // A queda mudo: a los 31 s lo toma B.
    expect(t.claim('k', 'B', 30_000, 31_000)).toBe(true);
    // Llega el release de A (tarde).
    t.release('k', 'A');
    // C no lo puede tomar: sigue siendo de B.
    expect(t.claim('k', 'C', 30_000, 32_000)).toBe(false);
  });

  it('la renovación tardía de un dueño vencido no le saca el candado a quien lo tomó después', () => {
    const t = new LockTable();
    t.claim('k', 'A', 30_000, 0);
    expect(t.claim('k', 'B', 30_000, 31_000)).toBe(true);
    expect(t.claim('k', 'A', 30_000, 32_000)).toBe(false);
    expect(t.claim('k', 'C', 30_000, 33_000)).toBe(false);
  });

  it('el mismo dueño renueva, y nadie lo toma hasta que vence desde la última renovación', () => {
    const t = new LockTable();
    t.claim('k', 'A', 30_000, 0);
    expect(t.claim('k', 'A', 30_000, 25_000)).toBe(true);
    expect(t.claim('k', 'B', 30_000, 50_000)).toBe(false);
    expect(t.claim('k', 'B', 30_000, 55_001)).toBe(true);
  });

  it('claves distintas no se pisan, y un release ajeno no suelta nada', () => {
    const t = new LockTable();
    t.claim('k1', 'A', 30_000, 0);
    t.claim('k2', 'B', 30_000, 0);
    t.release('k1', 'B');
    expect(t.claim('k1', 'C', 30_000, 1)).toBe(false);
    t.release('k1', 'A');
    expect(t.claim('k1', 'C', 30_000, 2)).toBe(true);
  });

  it('el candado sobrevive a que el objeto se recree desde su almacenamiento (hibernar, desalojar, publicar), y el vencido se limpia', () => {
    const rows = memoryLockRows();
    expect(new LockTable(rows).claim('k', 'A', 30_000, 0)).toBe(true);
    // El objeto hibernó: una tabla nueva sobre el mismo almacenamiento. A sigue vivo (renueva a los 20 s).
    const again = new LockTable(rows);
    expect(again.claim('k', 'B', 30_000, 10_000)).toBe(false);
    expect(again.claim('k', 'A', 30_000, 20_000)).toBe(true);
    expect(new LockTable(rows).claim('k', 'B', 30_000, 45_000)).toBe(false);
    // A murió: a los 30 s de su última renovación vence, y el próximo candado nuevo lo borra del almacenamiento.
    expect(new LockTable(rows).claim('otra', 'C', 30_000, 51_000)).toBe(true);
    expect([...rows.list()].map(([k]) => k)).toEqual(['otra']);
    // Soltarlo lo borra; lo de otro dueño, no.
    const t = new LockTable(rows);
    t.release('otra', 'X');
    expect(rows.get('otra')).toMatchObject({ holder: 'C' });
    t.release('otra', 'C');
    expect(rows.get('otra')).toBeUndefined();
  });

  it('el vencimiento que vale es el que pidió el dueño, no el de quien pregunta', () => {
    const t = new LockTable();
    t.claim('k', 'A', 60_000, 0);
    expect(t.claim('k', 'B', 30_000, 45_000)).toBe(false);
    expect(t.claim('k', 'B', 30_000, 60_001)).toBe(true);
  });
});
