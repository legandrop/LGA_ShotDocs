// @vitest-environment jsdom
import type { Schema } from '@tiptap/pm/model';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import * as Y from 'yjs';
import { block, group, textOf } from '../sync/historyTesting';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { mountEditor, unmountAll } from './collabHarness';
import { schema as publishedSchema } from './fixtures/editorSchemaMain';
import { restoreInDoc } from './historyRestore';

// Restaurar sin el editor no toca lo que no cambió (R2 de la barrera de error). Antes, `restoreInDoc` comparaba cada
// elemento por los atributos guardados: un bloque que no los tenía escritos (uno de una versión anterior de la app, o de
// una importación) recibía todos los de valor por defecto (`backgroundColor`, `textAlignment`, `script="false"`…), también
// si estaba igual que en la versión. Pesaba bytes de más y, en el historial, aparecía como «formato cambiado». Ahora solo
// los bloques que de verdad cambian, como hace el editor.

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(unmountAll);

const schemaOfApp = (): Schema => mountEditor(new Y.Doc()).prosemirrorView!.state.schema;

/** Lo que muestra el editor de un documento (sobre una copia): se compara lo que se ve, no el XML. */
function shown(d: Y.Doc, schema: Schema): string {
  const c = new Y.Doc();
  Y.applyUpdate(c, Y.encodeStateAsUpdate(d));
  try {
    return JSON.stringify(yXmlFragmentToProseMirrorRootNode(c.getXmlFragment(CONTENT_FRAGMENT), schema).toJSON());
  } finally {
    c.destroy();
  }
}

/** El XML de cada bloque de arriba, por id. */
function xmlById(d: Y.Doc): Record<string, string> {
  const out: Record<string, string> = {};
  for (const bc of group(d).toArray()) if (bc instanceof Y.XmlElement) out[String(bc.getAttribute('id'))] = bc.toString();
  return out;
}

/** La versión (bloques como los de una importación: sin los atributos por defecto) y la página de ahora, copia de ella. */
function pair() {
  const version = new Y.Doc();
  group(version).push([block('b0', 'cero'), block('b1', 'uno', 'heading', { level: '2' }), block('b2', 'dos'), block('b3', 'tres')]);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(version));
  return { version, doc };
}

describe('restaurar sin editor: lo que no cambió no se toca', () => {
  it('solo el bloque que cambió recibe sus atributos por defecto; los iguales quedan como estaban', () => {
    const { version, doc } = pair();
    textOf(group(doc).get(0) as Y.XmlElement).insert(4, ' y algo más');
    const schema = schemaOfApp();
    const before = xmlById(doc);
    const sv = Y.encodeStateVector(doc);
    const outcome = restoreInDoc(doc, version, schema);
    expect(outcome.ok).toBe(true);
    const after = xmlById(doc);
    // Los que no cambiaron: el mismo XML, sin un atributo escrito de más.
    for (const id of ['b1', 'b2', 'b3']) expect(after[id]).toBe(before[id]);
    expect(after.b2).not.toContain('backgroundColor');
    // El que cambió vuelve a la versión (como el editor: con sus atributos por defecto).
    expect(after.b0).toContain('>cero<');
    expect(shown(doc, schema)).toBe(shown(version, schema));
    // Lo que sube es poco: el texto y el bloque que cambió, no toda la página.
    expect(Y.encodeStateAsUpdate(doc, sv).length).toBeLessThan(300);
  });

  it('un bloque que difiere solo en un formato se restaura (no se lo salta por parecido)', () => {
    const { version, doc } = pair();
    (((group(doc).get(2) as Y.XmlElement).get(0)) as Y.XmlElement).setAttribute('textAlignment', 'center');
    const schema = schemaOfApp();
    expect(shown(doc, schema)).not.toBe(shown(version, schema));
    expect(restoreInDoc(doc, version, schema).ok).toBe(true);
    expect(shown(doc, schema)).toBe(shown(version, schema));
    const xml = xmlById(doc);
    expect(xml.b2).toContain('textAlignment="left"');
    expect(xml.b0).not.toContain('textAlignment');
  });

  it('un bloque que otro agregó sale y uno que otro borró vuelve; el resto sigue igual', () => {
    const { version, doc } = pair();
    const g = group(doc);
    g.push([block('x9', 'lo de otro')]);
    g.delete(1, 1);
    const schema = schemaOfApp();
    const before = xmlById(doc);
    expect(restoreInDoc(doc, version, schema).ok).toBe(true);
    expect(shown(doc, schema)).toBe(shown(version, schema));
    const after = xmlById(doc);
    expect(Object.keys(after)).toEqual(['b0', 'b1', 'b2', 'b3']);
    // El de antes del hueco queda como estaba (después del hueco, `updateYFragment` rehace en el lugar, como el editor).
    expect(after.b0).toBe(before.b0);
  });

  it('con un bloque que el editor no puede leer (la razón de ser de esta restauración), ese se reescribe y los demás no se tocan', () => {
    const { version, doc } = pair();
    // `text.toDelta is not a function`: un mapa donde va el texto del bloque b1.
    ((group(doc).get(1) as Y.XmlElement).get(0) as Y.XmlElement).insert(0, [new Y.Map() as never]);
    const schema = schemaOfApp();
    const before = xmlById(doc);
    const outcome = restoreInDoc(doc, version, schema);
    expect(outcome.ok).toBe(true);
    expect(shown(doc, schema)).toBe(shown(version, schema));
    const after = xmlById(doc);
    for (const id of ['b0', 'b2', 'b3']) expect(after[id]).toBe(before[id]);
  });

  it('la versión publicada de la app (el esquema anterior) abre lo restaurado igual y no pierde nada', () => {
    const { version, doc } = pair();
    textOf(group(doc).get(0) as Y.XmlElement).insert(4, ' y algo más');
    expect(restoreInDoc(doc, version, schemaOfApp()).ok).toBe(true);
    const old = mountEditor(doc, 'viejo', publishedSchema);
    expect(old.document.map((b) => b.id)).toEqual(['b0', 'b1', 'b2', 'b3']);
    const text = JSON.stringify(old.document);
    for (const word of ['cero', 'uno', 'dos', 'tres']) expect(text).toContain(word);
    expect(text).not.toContain('y algo más');
  });
});
