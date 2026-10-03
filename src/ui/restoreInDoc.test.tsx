// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { block, group, textOf } from '../sync/historyTesting';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { mountEditor, unmountAll } from './collabHarness';
import { schema as publishedSchema } from './fixtures/editorSchemaMain';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { restoreInDoc, restoreInEditor } from './historyRestore';

// Restaurar sin el editor (historyRestore.ts, `restoreInDoc`, la barrera de la página) con otra persona escribiendo sin
// red o a la vez: cambia solo los bloques distintos, como el editor (`restoreInEditor`), así lo que el otro escribió en
// un bloque que la versión no cambia, o un bloque que agregó, sigue estando cuando llega. Auditoría de la barrera, B1:
// con un reemplazo de todo se perdía en 200 de 200 casos al azar; por el editor, en 0 de 50.

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Range.prototype.getClientRects ??= (() => []) as never;
  Range.prototype.getBoundingClientRect ??= (() => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })) as never;
});

afterEach(() => unmountAll());

const pmSchema = () => mountEditor(new Y.Doc()).prosemirrorView!.state.schema;
const json = (d: Y.Doc) => d.getXmlFragment(CONTENT_FRAGMENT).toJSON();
/** Los dos lados se mandan lo que el otro no tiene (como al volver la red). */
const exchange = (a: Y.Doc, b: Y.Doc) => {
  const ua = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const ub = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, ua);
  Y.applyUpdate(a, ub);
};
const clone = (d: Y.Doc) => {
  const c = new Y.Doc();
  Y.applyUpdate(c, Y.encodeStateAsUpdate(d));
  return c;
};
/**
 * Lo que muestra el editor de un documento (sobre una copia): el editor escribe los atributos por defecto de cada bloque
 * que toca, así que se compara lo que se ve y no el XML.
 */
const shown = (d: Y.Doc, schema = pmSchema()) => {
  const c = clone(d);
  try {
    return JSON.stringify(yXmlFragmentToProseMirrorRootNode(c.getXmlFragment(CONTENT_FRAGMENT), schema).toJSON());
  } finally {
    c.destroy();
  }
};
// Una de las filas hostiles de la auditoría del link (B3): el editor tira con esto.
const nivelObjeto = (v: Y.Doc) => ((group(v).get(1) as Y.XmlElement).get(0) as Y.XmlElement).setAttribute('level', { x: 1 } as never);
const mapEnElParrafo = (v: Y.Doc) => ((group(v).get(0) as Y.XmlElement).get(0) as Y.XmlElement).insert(0, [new Y.Map() as never]);

function base(): Y.Doc {
  const d = new Y.Doc();
  group(d).push([block('b0', 'cero'), block('b1', 'uno', 'heading', { level: '2' }), block('b2', 'dos'), block('b3', 'tres'), block('b4', 'cuatro')]);
  return d;
}

describe('restaurar sin editor con otro escribiendo', () => {
  it('lo que otro escribió sin red en un bloque que la versión no cambia sobrevive, y los dos quedan iguales', () => {
    const version = base();
    const a = clone(version);
    const b = clone(version);
    a.transact(() => nivelObjeto(a), 'hostil');
    textOf(group(b).get(3) as Y.XmlElement).insert(4, ' ESCRITO-POR-B');
    const out = restoreInDoc(a, version, pmSchema());
    expect(out.ok).toBe(true);
    // Recién restaurada, la página es la versión, y el grupo y los bloques iguales son los mismos elementos.
    expect(shown(a)).toBe(shown(version));
    exchange(a, b);
    expect(json(a)).toBe(json(b));
    expect(json(a)).toContain('ESCRITO-POR-B');
    expect(json(a)).not.toContain('[object Object]');
  });

  it('un bloque que otro agregó sin red sobrevive', () => {
    const version = base();
    const a = clone(version);
    const b = clone(version);
    a.transact(() => mapEnElParrafo(a), 'hostil');
    group(b).insert(5, [block('nuevoB', 'BLOQUE-NUEVO-DE-B')]);
    expect(restoreInDoc(a, version, pmSchema()).ok).toBe(true);
    exchange(a, b);
    expect(json(a)).toContain('BLOQUE-NUEVO-DE-B');
    expect(json(a)).toBe(json(b));
  });

  it('lo que sobra en la raíz se saca y el grupo queda', () => {
    const version = base();
    const a = clone(version);
    const kept = group(a);
    a.transact(() => {
      nivelObjeto(a);
      const loose = new Y.XmlText();
      loose.insert(0, 'texto suelto');
      a.getXmlFragment(CONTENT_FRAGMENT).insert(0, [loose]);
    });
    expect(restoreInDoc(a, version, pmSchema()).ok).toBe(true);
    expect(json(a)).not.toContain('texto suelto');
    expect(a.getXmlFragment(CONTENT_FRAGMENT).length).toBe(1);
    expect(a.getXmlFragment(CONTENT_FRAGMENT).get(0)).toBe(kept);
  });

  function rnd(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }
  const words = ['a', 'bb', 'ccc', 'dddd', 'eeeee', 'ñandú', 'emoji😀', ' ', 'x y'];
  function randomDoc(r: () => number, n: number, prefix: string): Y.Doc {
    const d = new Y.Doc();
    const blocks: Y.XmlElement[] = [];
    for (let i = 0; i < n; i++) {
      const text = Array.from({ length: 1 + Math.floor(r() * 4) }, () => words[Math.floor(r() * words.length)]).join('');
      if (r() < 0.2) blocks.push(block(`${prefix}${i}`, text, 'heading', { level: String(1 + Math.floor(r() * 3)) }));
      else blocks.push(block(`${prefix}${i}`, text));
    }
    group(d).push(blocks);
    return d;
  }
  /**
   * Un caso al azar: la versión cambia el primer bloque; A (lo actual) tiene un bloque de más y a veces texto de más;
   * B, sin red, escribe en el último bloque común (que la versión no cambia, salvo si es el primero).
   */
  function scenario(seed: number) {
    const r = rnd(seed);
    const common = randomDoc(r, 2 + Math.floor(r() * 6), 'c');
    const version = clone(common);
    textOf(group(version).get(0) as Y.XmlElement).insert(0, 'V');
    const a = clone(common);
    const b = clone(a);
    a.transact(() => {
      group(a).push([block(`a${seed}`, 'de A')]);
      if (r() < 0.5) textOf(group(a).get(group(a).length - 2) as Y.XmlElement).insert(0, 'A');
    });
    textOf(group(b).get(group(common).length - 1) as Y.XmlElement).insert(0, `B${seed}-`);
    return { version, a, b, mark: `B${seed}-` };
  }

  it('200 semillas: lo de B sobrevive igual que restaurando por el editor, y la versión publicada lo abre con sus ids', () => {
    const schema = pmSchema();
    let byDoc = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { version, a, b, mark } = scenario(seed);
      const out = restoreInDoc(a, version, schema);
      expect(out.ok, `semilla ${seed}`).toBe(true);
      expect(shown(a, schema), `semilla ${seed}`).toBe(shown(version, schema));
      if (seed % 20 === 0) {
        const old = mountEditor(clone(a), 'viejo', publishedSchema);
        const ids = group(version)
          .toArray()
          .map((bc) => (bc as Y.XmlElement).getAttribute('id'));
        expect(old.document.map((x) => x.id).slice(0, ids.length), `semilla ${seed}`).toEqual(ids);
        unmountAll();
      }
      exchange(a, b);
      expect(json(a), `semilla ${seed}`).toBe(json(b));
      if (json(a).includes(mark)) byDoc++;
    }
    // Por el editor, las primeras 50 (es más lento): lo de B sobrevive en todas.
    let byEditor = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const { version, a, b, mark } = scenario(seed);
      const ed = mountEditor(a);
      expect(restoreInEditor(ed.prosemirrorView!, version).ok, `semilla ${seed}`).toBe(true);
      exchange(a, b);
      if (json(a).includes(mark)) byEditor++;
      unmountAll();
    }
    expect(byEditor).toBe(50);
    expect(byDoc).toBe(200);
  });

  describe('dos dispositivos en el servidor falso', () => {
    const devices: Device[] = [];
    afterEach(async () => {
      for (const d of devices.splice(0)) {
        await d.engine.stop();
        d.db.close();
        d.mediaDb.close();
        d.commentsDb.close();
      }
    });

    it('A restaura sin editor mientras B tiene ediciones sin subir: el servidor y los dos quedan con lo de B', async () => {
      const server = new FakeServer();
      const a = await makeDevice(server);
      const b = await makeDevice(server);
      devices.push(a, b);
      const pageId = await a.tree.create(null, 'P');
      await a.engine.syncNow();
      const docA = await a.docs.open(pageId);
      docA.transact(() => group(docA).push([block('b0', 'cero'), block('b1', 'uno', 'heading', { level: '2' }), block('b2', 'dos')]), 'test');
      await a.docs.flush(pageId);
      await a.engine.syncNow();
      await b.engine.syncNow();
      const version = clone(docA);
      // B, sin red: escribe y no sube.
      const docB = await b.docs.open(pageId);
      docB.transact(() => textOf(group(docB).get(2) as Y.XmlElement).insert(3, ' SIN-RED-DE-B'), 'test');
      await b.docs.flush(pageId);
      // A recibe la fila hostil y restaura desde la barrera.
      docA.transact(() => nivelObjeto(docA), 'test');
      await a.docs.flush(pageId);
      await a.engine.syncNow();
      expect(restoreInDoc(docA, version, pmSchema()).ok).toBe(true);
      await a.docs.flush(pageId);
      expect(await a.docs.unsyncedPages()).toContain(pageId);
      await a.engine.syncNow();
      // B vuelve.
      await b.engine.syncNow();
      await a.engine.syncNow();
      const onServer = new Y.Doc();
      for (const row of server.updates.get(pageId)!) Y.applyUpdate(onServer, row.data);
      expect(json(onServer)).toBe(json(docA));
      expect(json(onServer)).toBe(json(docB));
      expect(json(onServer)).toContain('SIN-RED-DE-B');
      expect(json(onServer)).not.toContain('[object Object]');
      a.docs.close(pageId);
      b.docs.close(pageId);
    });
  });
});
