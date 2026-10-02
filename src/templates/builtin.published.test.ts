// @vitest-environment jsdom
// Las plantillas de fábrica con la librería de VERDAD de las versiones publicadas más viejas (molde de
// src/ui/collabPhotosVersions.published.test.ts): en este archivo `y-prosemirror` es la de la v0.052 a la v0.075 (la
// pone el alias de vite.config.ts, proyecto `published`), también adentro de BlockNote. Una página creada con
// cualquiera de las tres, en los dos idiomas, se abre en esa versión sin que su editor escriba ni borre nada.
import { BlockNoteEditor } from '@blocknote/core';
import { blocksToYXmlFragment } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { buildSeed, CONTENT_FRAGMENT } from '../sync/structure';
import { mountEditor, tick, unmountAll } from '../ui/collabHarness';
import { schema } from '../ui/editorSchema';
import { PHOTO } from '../ui/inlinePhoto';
import { previousSchema } from '../ui/photoHarness';
import { findUnknownContent, knownContent, STABLE_GAPS_MARKER, type KnownContent } from '../ui/unknownContent';
import { BUILTIN_KINDS, builtinBlocks } from './builtin';

afterEach(unmountAll);

/** Lo que conoce el resguardo de las versiones publicadas de la v0.052 a la v0.075 (unknownContent.ts de entonces). */
const PUBLISHED_KNOWN: KnownContent = {
  nodes: new Set([...knownContent().nodes].filter((n) => n !== PHOTO && n !== STABLE_GAPS_MARKER)),
  marks: knownContent().marks,
};

/**
 * La página como la deja la app: la semilla y, antes de ella, los bloques de la plantilla. Las de fábrica no tienen
 * fotos en línea (lo único que escriben distinto las dos librerías), así que se arman sin editor.
 */
function pageWith(kind: (typeof BUILTIN_KINDS)[number], lang: string): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, buildSeed('nueva'));
  const tmp = new Y.Doc();
  const editor = BlockNoteEditor.create({ schema }) as unknown as BlockNoteEditor;
  blocksToYXmlFragment(editor as never, builtinBlocks(kind, lang) as never, tmp.getXmlFragment(CONTENT_FRAGMENT));
  const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
  const built = (tmp.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).toArray().map((c) => (c as Y.XmlElement).clone());
  group.insert(0, built);
  return doc;
}

describe('plantillas de fábrica en la versión publicada más vieja (librería real)', () => {
  it('cada una, en inglés y castellano, se abre sin escribir nada y con todos sus bloques', async () => {
    for (const kind of BUILTIN_KINDS) {
      for (const lang of ['en', 'es']) {
        const doc = pageWith(kind, lang);
        expect(findUnknownContent(doc, PUBLISHED_KNOWN), `${kind} ${lang}`).toBeNull();
        const before = Y.encodeStateVector(doc);
        const writes: Uint8Array[] = [];
        doc.on('update', (u: Uint8Array) => writes.push(u));
        const e = mountEditor(doc, 'old', previousSchema);
        await tick(20);
        expect(writes, `${kind} ${lang}`).toEqual([]);
        expect(Y.encodeStateVector(doc)).toEqual(before);
        expect(e.document.length).toBe(builtinBlocks(kind, lang).length + 1);
        expect(e.document.at(-1)!.id).toBe('initialBlockId');
        unmountAll();
      }
    }
  });
});
