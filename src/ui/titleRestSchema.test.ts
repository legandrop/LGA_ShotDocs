// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { prependRest } from '../sync/titleRest';
import { mountEditor, pmFromY, tick, unmountAll, view, yText } from './collabHarness';
import { schema as mainSchema } from './fixtures/editorSchemaMain';
import { schema as anteriorSchema } from './fixtures/editorSchemaAnterior';

// Lo que sobra del título, escrito sin editor, abierto con el esquema publicado (main) y el anterior: nada se borra
// ni se "repara" en el Y.Doc.
afterEach(() => unmountAll());

describe('el resto del título con esquemas viejos', () => {
  for (const [name, schema] of [
    ['main', mainSchema],
    ['anterior', anteriorSchema],
  ] as const) {
    it(`esquema ${name}: página vacía y página con contenido`, async () => {
      const empty = new Y.Doc();
      prependRest(empty, { id: 'r1', text: 'uno\ndos 👨‍👩‍👧‍👦' });
      const before = Y.encodeStateVector(empty);
      const textBefore = yText(empty);
      const e = mountEditor(empty, 'old', schema);
      await tick(20);
      expect(view(e).state.doc.eq(pmFromY(e, empty))).toBe(true);
      expect(yText(empty)).toBe(textBefore);
      // Nada escrito al abrir.
      expect(Buffer.from(Y.encodeStateVector(empty)).equals(Buffer.from(before))).toBe(true);
      expect(view(e).state.doc.textContent).toContain('dos 👨‍👩‍👧‍👦');

      // Con contenido escrito por un editor (con sus atributos) y después el resto arriba.
      const src = new Y.Doc();
      const w = mountEditor(src, 'w', schema);
      await tick(20);
      w.insertBlocks([{ type: 'heading', content: 'Título' }, { type: 'paragraph', content: 'texto' }] as never, w.document[0].id, 'before');
      await tick(20);
      prependRest(src, { id: 'r2', text: 'resto' });
      await tick(20);
      const copy = new Y.Doc();
      Y.applyUpdate(copy, Y.encodeStateAsUpdate(src));
      const sv = Y.encodeStateVector(copy);
      const o = mountEditor(copy, 'o', schema);
      await tick(20);
      expect(view(o).state.doc.eq(pmFromY(o, copy))).toBe(true);
      expect(Buffer.from(Y.encodeStateVector(copy)).equals(Buffer.from(sv))).toBe(true);
      expect(o.document.map((b) => b.type).slice(0, 3)).toEqual(['paragraph', 'heading', 'paragraph']);
      // Editar el párrafo del resto con el esquema viejo no pierde nada.
      o.updateBlock('titlerest-r2', { content: 'resto editado' } as never);
      await tick(20);
      expect(yText(copy)).toContain('resto editado');
      expect(yText(copy)).toContain('texto');
    });
  }
});
