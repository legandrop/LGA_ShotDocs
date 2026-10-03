// @vitest-environment jsdom
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { Fragment } from '@tiptap/pm/model';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

// La compuerta de `restoreInDoc` (`read.eq(node)` sobre la copia): si un bloque se saltea por error, creyendo que ya es
// igual a la versión, y difiere en algo que `sameShape` no mira (los atributos), la restauración no se hace y la página
// queda como estaba. Para forzar el error de emparejamiento, la lectura de un bloque suelto (la que decide qué se saltea)
// miente: devuelve el bloque de la versión. Las demás lecturas son las de verdad.

const lie: { byId: Record<string, PMNode> } = { byId: {} };

vi.mock('y-prosemirror', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  const read = real.yXmlFragmentToProseMirrorRootNode as (f: Y.XmlFragment, s: Schema) => PMNode;
  return {
    ...real,
    yXmlFragmentToProseMirrorRootNode: (fragment: Y.XmlFragment, schema: Schema) => {
      const only = fragment.length === 1 ? fragment.get(0) : null;
      if (only instanceof Y.XmlElement && only.nodeName === 'blockContainer') {
        const liar = lie.byId[String(only.getAttribute('id'))];
        if (liar) return schema.topNodeType.create(null, Fragment.from(liar));
      }
      return read(fragment, schema);
    },
  };
});

import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { block, group } from '../sync/historyTesting';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { mountEditor, unmountAll } from './collabHarness';
import { restoreInDoc } from './historyRestore';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(() => {
  lie.byId = {};
  unmountAll();
});

describe('restoreInDoc: la compuerta de la copia', () => {
  function setup() {
    const version = new Y.Doc();
    group(version).push([block('b0', 'cero'), block('b1', 'uno'), block('b2', 'dos')]);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(version));
    // b1 difiere de la versión solo en un atributo.
    ((group(doc).get(1) as Y.XmlElement).get(0) as Y.XmlElement).setAttribute('textAlignment', 'center');
    const schema = mountEditor(new Y.Doc()).prosemirrorView!.state.schema;
    return { version, doc, schema };
  }

  it('sin la mentira, el bloque que difiere en un atributo se restaura', () => {
    const { version, doc, schema } = setup();
    expect(restoreInDoc(doc, version, schema).ok).toBe(true);
    expect(group(doc).get(1).toString()).toContain('textAlignment="left"');
  });

  it('un bloque salteado por error que difiere solo en un atributo: no se restaura y la página queda como estaba', () => {
    const { version, doc, schema } = setup();
    // El bloque de la versión, tal como lo arma el editor.
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(version));
    lie.byId.b1 = yXmlFragmentToProseMirrorRootNode(copy.getXmlFragment(CONTENT_FRAGMENT), schema).child(0).child(1);
    const before = doc.getXmlFragment(CONTENT_FRAGMENT).toString();
    const sv = Y.encodeStateVector(doc);
    const outcome = restoreInDoc(doc, version, schema);
    expect(outcome).toEqual({ ok: false, reason: 'failed' });
    expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString()).toBe(before);
    expect(Y.encodeStateAsUpdate(doc, sv).length).toBeLessThan(10);
  });
});
