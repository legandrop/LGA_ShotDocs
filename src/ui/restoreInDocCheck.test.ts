// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

// Restaurar sin el editor (`restoreInDoc`): si la prueba en la copia no da igual a la versión, no se escribe ni se sube
// nada en el documento de la página (auditoría de la barrera, O1: antes deshacía, pero quedaban 473 bytes que subían y
// rehacían los bloques). Aparte porque cambia `sameShape` para todo el archivo.

let calls = 0;
let failOn = -1;
vi.mock('../sync/history', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    sameShape: (a: unknown, b: unknown) => {
      calls++;
      if (calls === failOn) return false;
      return (real.sameShape as (a: unknown, b: unknown) => boolean)(a, b);
    },
  };
});

import { block, group, textOf } from '../sync/historyTesting';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { mountEditor, unmountAll } from './collabHarness';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { restoreInDoc } from './historyRestore';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(() => {
  failOn = -1;
  unmountAll();
});

const json = (d: Y.Doc) => d.getXmlFragment(CONTENT_FRAGMENT).toJSON();
const clone = (d: Y.Doc) => {
  const c = new Y.Doc();
  Y.applyUpdate(c, Y.encodeStateAsUpdate(d));
  return c;
};

/**
 * Lo que muestra el editor de un documento (sobre una copia): el editor escribe los atributos por defecto de cada bloque
 * que toca, así que se compara lo que se ve y no el XML.
 */
const shown = (d: Y.Doc, schema: import('@tiptap/pm/model').Schema) => {
  const c = clone(d);
  try {
    return JSON.stringify(yXmlFragmentToProseMirrorRootNode(c.getXmlFragment(CONTENT_FRAGMENT), schema).toJSON());
  } finally {
    c.destroy();
  }
};

describe('restaurar sin editor: la prueba en la copia', () => {
  it('si no da igual a la versión, el documento no cambia y no sale ninguna escritura; lo de otro sigue', () => {
    const schema = mountEditor(new Y.Doc()).prosemirrorView!.state.schema;
    const version = new Y.Doc();
    group(version).push([block('b0', 'cero'), block('b1', 'uno')]);
    const a = clone(version);
    a.transact(() => group(a).push([block('b2', 'dos de A')]));
    const b = clone(a);
    textOf(group(b).get(0) as Y.XmlElement).insert(4, ' DE-B');
    const before = json(a);
    const sv = Y.encodeStateVector(a);
    const updates: Uint8Array[] = [];
    a.on('update', (u: Uint8Array) => updates.push(u));
    calls = 0;
    failOn = 2; // 1: la ida y vuelta de `versionNode`; 2: la prueba en la copia.
    expect(restoreInDoc(a, version, schema)).toEqual({ ok: false, reason: 'failed' });
    expect(updates).toEqual([]);
    expect(Y.encodeStateVector(a)).toEqual(sv);
    expect(json(a)).toBe(before);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    expect(json(a)).toContain('DE-B');
  });

  it('sin la falla forzada, la misma restauración anda (la prueba no es la que falla siempre)', () => {
    const schema = mountEditor(new Y.Doc()).prosemirrorView!.state.schema;
    const version = new Y.Doc();
    group(version).push([block('b0', 'cero'), block('b1', 'uno')]);
    const a = clone(version);
    a.transact(() => group(a).push([block('b2', 'dos de A')]));
    expect(restoreInDoc(a, version, schema).ok).toBe(true);
    expect(shown(a, schema)).toBe(shown(version, schema));
  });
});
