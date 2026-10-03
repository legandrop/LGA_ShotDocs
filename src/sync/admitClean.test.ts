import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { admitRows } from './admit';
import { block, group } from './historyTesting';

// El paso 7 de la prueba de admisión (Docs/Doc_Link_Publico.md, E2.3): la base limpia que sale con la fila tiene que
// pasar `checkCleanBase` (privacidad y contenido). Ninguna fila armada con Yjs la hace fallar después de los pasos 1 a 6
// (es la red de seguridad de D14 para un caso que nadie previó), así que acá se la hace fallar a mano para comprobar que
// la prueba la mira y aparta la fila con el motivo.

const failing = vi.hoisted(() => ({ on: false }));
vi.mock('./clean', async (original) => {
  const real = await original<typeof import('./clean')>();
  return {
    ...real,
    checkCleanBase: (base: Uint8Array, source: Y.Doc) => (failing.on ? 'content under deleted' : real.checkCleanBase(base, source)),
  };
});

describe('el paso 7: la base limpia que sale pasa sus comprobaciones', () => {
  it('si no pasa, la fila se aparta con el motivo; si pasa, entra', () => {
    const team = new Y.Doc({ gc: false });
    group(team).push([block('b0', 'equipo')]);
    const rows = [Y.encodeStateAsUpdate(team)];
    const v = new Y.Doc();
    Y.applyUpdate(v, rows[0]);
    const sv = Y.encodeStateVector(v);
    group(v).push([block('b1', 'visitante')]);
    const row = Y.encodeStateAsUpdate(v, sv);
    failing.on = true;
    expect(admitRows(rows, [row])[0]).toEqual({ ok: false, reason: 'clean_content_under_deleted' });
    failing.on = false;
    expect(admitRows(rows, [row])[0]).toEqual({ ok: true, media: [] });
  });
});
