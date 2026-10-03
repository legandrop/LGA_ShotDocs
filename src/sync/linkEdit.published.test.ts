// @vitest-environment jsdom
// Lo que escribe un link *Can edit* (entrega 2a, Docs/Doc_Link_Publico.md) abierto con la librería de VERDAD de las
// versiones publicadas más viejas (molde de src/templates/builtin.published.test.ts): `y-prosemirror` es la de la
// v0.052 a la v0.075 (el alias del proyecto `published` de vite.config.ts). Una fila admitida es una fila común: un
// editor de antes abre la página sin escribir ni borrar nada, con el texto del visitante adentro.
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addShape } from '../media/markup';
import { mountEditor, tick, unmountAll } from '../ui/collabHarness';
import { PHOTO } from '../ui/inlinePhoto';
import { previousSchema } from '../ui/photoHarness';
import { findUnknownContent, knownContent, STABLE_GAPS_MARKER, type KnownContent } from '../ui/unknownContent';
import { AdmissionTester } from './admit';
import { buildCleanBase } from './clean';
import { CONTENT_FRAGMENT, buildSeed } from './structure';

afterEach(unmountAll);

const PUBLISHED_KNOWN: KnownContent = {
  nodes: new Set([...knownContent().nodes].filter((n) => n !== PHOTO && n !== STABLE_GAPS_MARKER)),
  marks: knownContent().marks,
};

describe('lo admitido de un link en la versión publicada más vieja (librería real)', () => {
  it('se abre sin escribir nada y con el texto del visitante', async () => {
    // La página del equipo (la semilla) y lo que escribe el visitante con el editor de esta versión.
    const team = [buildSeed('pagina')];
    const v = new Y.Doc();
    const base = buildCleanBase(team);
    Y.applyUpdate(v, base.base);
    base.doc.destroy();
    const visitor = mountEditor(v, 'visitante');
    await tick(20);
    const sv = Y.encodeStateVector(v);
    visitor.insertBlocks(
      [
        { type: 'heading', props: { level: 2 }, content: 'Del cliente' },
        { type: 'paragraph', content: [{ type: 'text', text: 'Escrito con el link', styles: { bold: true } }] },
        { type: 'checkListItem', props: { checked: true }, content: 'Revisado' },
      ] as never,
      visitor.document[0].id,
      'before',
    );
    addShape(v, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 's1', { kind: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1 }, { w: 10, h: 10 });
    await tick(20);
    const row = Y.encodeStateAsUpdate(v, sv);
    unmountAll();
    const tester = new AdmissionTester(team);
    expect(tester.test(row)).toMatchObject({ ok: true });
    tester.destroy();

    // El editor de una versión publicada abre la página con la fila admitida.
    const doc = new Y.Doc();
    for (const r of [...team, row]) Y.applyUpdate(doc, r);
    expect(findUnknownContent(doc, PUBLISHED_KNOWN)).toBeNull();
    const before = Y.encodeStateVector(doc);
    const writes: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => writes.push(u));
    const old = mountEditor(doc, 'old', previousSchema);
    await tick(20);
    expect(writes).toEqual([]);
    expect(Y.encodeStateVector(doc)).toEqual(before);
    const json = JSON.stringify(doc.getXmlFragment(CONTENT_FRAGMENT).toJSON());
    expect(json).toContain('Escrito con el link');
    expect(old.document.map((b) => b.type)).toEqual(['heading', 'paragraph', 'checkListItem', 'paragraph']);
  });
});
