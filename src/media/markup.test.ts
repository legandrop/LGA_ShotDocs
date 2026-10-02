import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { buildCleanBase, checkCleanBase } from '../sync/clean';
import { PageHistory, type HistoryRow } from '../sync/history';
import { CONTENT_FRAGMENT } from '../sync/structure';
import {
  addShape,
  DEFAULT_MARKUP_COLOR,
  deleteShape,
  MAX_POINTS,
  MAX_TEXT,
  markupOrigin,
  orphanMarkup,
  parseMarkupKey,
  PHOTO_MARKUP_MAP,
  readAllMarkup,
  readFrame,
  readPhotoMarkup,
  readShape,
  removePhotoMarkup,
  shapeKey,
  touchedFileIds,
  updateShape,
  writeFrame,
  type LineShape,
  type TextShape,
} from './markup';

// Las anotaciones de las fotos (P.20, Docs/Doc_Anotar_Fotos.md): el mapa raíz `photoMarkup` con claves planas, su
// lectura como entrada no confiable y las propiedades de datos de la entrega 0 (carrera, una propiedad por clave,
// deshacer por foto, base limpia, historial).

const F1 = '6f1c2a4e-0b7d-4c8e-9f10-112233445566';
const F2 = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f00112233';
const FRAME = { w: 6000, h: 4000 };

const arrow = (extra: Record<string, unknown> = {}) => ({
  type: 'arrow',
  zValue: 1,
  posX: 2210,
  posY: 1340,
  startX: 0,
  startY: 0,
  endX: 640,
  endY: -220,
  strokeColor: '#ff3b30',
  strokeWidth: 9,
  strokeOpacity: 100,
  headStyle: 0,
  headPosition: 2,
  arrowHeadSize: 100,
  ...extra,
});
const label = (text: string, extra: Record<string, unknown> = {}) => ({
  type: 'text',
  zValue: 2,
  posX: 100,
  posY: 100,
  rectX: 0,
  rectY: 0,
  rectW: 900,
  rectH: 120,
  text,
  fontSize: 75,
  fillMode: 3,
  fillColor: '#ffd60a',
  ...extra,
});

const json = (doc: Y.Doc) => doc.getMap(PHOTO_MARKUP_MAP).toJSON();

describe('las claves', () => {
  it('el marco es el id del archivo; cada forma, archivo/forma; lo demás no es de esta app', () => {
    expect(parseMarkupKey(F1)).toEqual({ fileId: F1, shapeId: null });
    expect(parseMarkupKey(shapeKey(F1, 's-1'))).toEqual({ fileId: F1, shapeId: 's-1' });
    expect(parseMarkupKey('otra-cosa')).toBeNull();
    expect(parseMarkupKey(`${F1}/`)).toBeNull();
    expect(parseMarkupKey(`${F1}/a/b`)).toBeNull();
    expect(parseMarkupKey(F1.toUpperCase())).toBeNull();
    expect(markupOrigin(F1)).toBe(`sd-markup:${F1}`);
  });
});

describe('la lectura: el mapa es entrada no confiable (sección 4)', () => {
  it('el marco: dos números finitos, positivos y acotados; si no, la foto no se dibuja', () => {
    expect(readFrame({ v: 1, w: 6000, h: 4000 })).toEqual({ v: 1, w: 6000, h: 4000 });
    expect(readFrame({ w: 10, h: 10 })).toEqual({ v: 1, w: 10, h: 10 });
    for (const bad of [null, 3, 'x', [], { w: 0, h: 10 }, { w: Infinity, h: 4 }, { w: NaN, h: 4 }, { w: 1e9, h: 4 }, { w: '600', h: 400 }]) {
      expect(readFrame(bad)).toBeNull();
    }
    expect(readFrame(new Y.Map())).toBeNull();
  });

  it('colores solo #RRGGBB; números finitos y acotados; texto como texto; un tope de puntos', () => {
    const frame = { v: 1, ...FRAME };
    const evil = readShape(
      's',
      {
        ...arrow(),
        strokeColor: 'red;background:url(javascript:alert(1))',
        fillColor: '#12345',
        strokeWidth: 1e308,
        posX: -Infinity,
        posY: NaN,
        startX: 1e12,
        arrowHeadSize: 9999,
        headStyle: 7,
        headPosition: -1,
        style: 'fill:url(#x)',
        href: 'javascript:alert(1)',
        onload: 'alert(1)',
      },
      frame,
    ) as LineShape;
    expect(evil.strokeColor).toBe(DEFAULT_MARKUP_COLOR);
    expect(evil.fillColor).toBe(DEFAULT_MARKUP_COLOR);
    expect(evil.strokeWidth).toBeLessThanOrEqual(999 * (6000 / 1920));
    expect([evil.posX, evil.posY]).toEqual([0, 0]);
    expect(evil.start[0]).toBe(4 * 6000);
    expect(evil.headSize).toBe(300);
    expect([evil.headStyle, evil.headPosition]).toEqual([0, 2]);
    // Los campos que no conoce no pasan.
    expect(Object.keys(evil)).not.toContain('style');
    expect(Object.keys(evil)).not.toContain('href');
    expect(Object.keys(evil)).not.toContain('onload');

    const text = readShape('t', label('<img src=x onerror=alert(1)>'.repeat(400)), frame) as TextShape;
    expect(text.text.length).toBe(MAX_TEXT);
    expect(text.text.startsWith('<img src=x')).toBe(true);
    expect(readShape('t', label(42 as never), frame)).toBeNull();

    const many = Array.from({ length: 2 * (MAX_POINTS + 500) }, (_, i) => i % 7);
    const stroke = readShape('p', { type: 'freehand_pencil', points: [...many, 'x', null, Infinity, 3] }, frame);
    expect(stroke && 'points' in stroke && stroke.points.length).toBe(MAX_POINTS * 2);
  });

  it('un tipo desconocido no se dibuja y no se borra; un campo desconocido se ignora', () => {
    const doc = new Y.Doc();
    addShape(doc, F1, 'a', arrow({ futureField: { deep: true } as never }), FRAME);
    addShape(doc, F1, 'b', { type: 'censor', rectX: 0, rectY: 0, rectW: 10, rectH: 10 });
    const photo = readPhotoMarkup(doc.getMap(PHOTO_MARKUP_MAP), F1)!;
    expect(photo.shapes.map((s) => s.id)).toEqual(['a']);
    // Lo que no se entiende sigue en el documento.
    expect(Object.keys(json(doc)).sort()).toEqual([F1, shapeKey(F1, 'a'), shapeKey(F1, 'b')].sort());
    // Una foto con solo formas desconocidas no se dibuja (no tiene `<svg>`).
    const only = new Y.Doc();
    addShape(only, F2, 'x', { type: 'loupe' }, FRAME);
    expect(readPhotoMarkup(only.getMap(PHOTO_MARKUP_MAP), F2)).toBeNull();
    expect(readAllMarkup(only.getMap(PHOTO_MARKUP_MAP)).size).toBe(0);
  });

  it('una forma sin marco no se dibuja; una versión del formato más nueva se dibuja igual', () => {
    const doc = new Y.Doc();
    addShape(doc, F1, 'a', arrow());
    expect(readPhotoMarkup(doc.getMap(PHOTO_MARKUP_MAP), F1)).toBeNull();
    doc.getMap(PHOTO_MARKUP_MAP).set(F1, { v: 3, w: 600, h: 400 });
    const photo = readPhotoMarkup(doc.getMap(PHOTO_MARKUP_MAP), F1)!;
    expect(photo.newer).toBe(true);
    expect(photo.shapes).toHaveLength(1);
  });

  it('el orden de apilado: zValue, y en un empate el id (igual en todos los dispositivos)', () => {
    const doc = new Y.Doc();
    addShape(doc, F1, 'c', arrow({ zValue: 2 }), FRAME);
    addShape(doc, F1, 'b', arrow({ zValue: 1 }));
    addShape(doc, F1, 'a', arrow({ zValue: 2 }));
    expect(readPhotoMarkup(doc.getMap(PHOTO_MARKUP_MAP), F1)!.shapes.map((s) => s.id)).toEqual(['b', 'a', 'c']);
  });

  it('una forma como objeto plano también se lee (no la escribe la app, pero no rompe)', () => {
    const doc = new Y.Doc();
    const map = doc.getMap(PHOTO_MARKUP_MAP);
    map.set(F1, { v: 1, ...FRAME });
    map.set(shapeKey(F1, 'plain'), arrow());
    map.set(shapeKey(F1, 'proto'), JSON.parse('{"__proto__": {"type": "arrow"}, "posX": 1}'));
    expect(readPhotoMarkup(map, F1)!.shapes.map((s) => s.id)).toEqual(['plain']);
  });
});

describe('qué fotos tocó un cambio', () => {
  it('las claves de arriba y los campos de adentro de una forma', () => {
    const doc = new Y.Doc();
    const map = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
    const seen: string[][] = [];
    map.observeDeep((events) => seen.push([...touchedFileIds(events, map)]));
    addShape(doc, F1, 'a', arrow(), FRAME);
    updateShape(doc, F1, 'a', { posX: 10 });
    addShape(doc, F2, 'b', arrow(), FRAME);
    doc.transact(() => map.set('basura', 1));
    deleteShape(doc, F1, 'a');
    // Una clave que no es de esta app no toca ninguna foto.
    expect(seen).toEqual([[F1], [F1], [F2], [], [F1]]);
  });
});

describe('dos anotando a la vez (sección 7, corrección B1)', () => {
  /** Dos dispositivos sin red desde el mismo estado: cada uno anota y después se juntan. */
  function race(writeA: (d: Y.Doc) => void, writeB: (d: Y.Doc) => void): Y.Doc {
    const base = new Y.Doc();
    base.getText('t').insert(0, 'página');
    const S = Y.encodeStateAsUpdate(base);
    const a = new Y.Doc();
    const b = new Y.Doc();
    Y.applyUpdate(a, S);
    Y.applyUpdate(b, S);
    writeA(a);
    writeB(b);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(json(a)).toEqual(json(b));
    return a;
  }

  it('dos que anotan por primera vez la misma foto sin red: al juntarse están todas las formas (3 de 3)', () => {
    const merged = race(
      (a) => {
        addShape(a, F1, 'a1', arrow(), FRAME);
        addShape(a, F1, 'a2', label('<t1>'));
      },
      (b) => addShape(b, F1, 'b1', arrow({ zValue: 5 }), FRAME),
    );
    expect(readPhotoMarkup(merged.getMap(PHOTO_MARKUP_MAP), F1)!.shapes.map((s) => s.id).sort()).toEqual(['a1', 'a2', 'b1']);
  });

  it('control: con un Y.Map por foto creado a demanda (lo que descartó la auditoría) se pierden las de uno', () => {
    const nested = (d: Y.Doc, ids: string[]) =>
      d.transact(() => {
        const photo = new Y.Map<unknown>();
        d.getMap(PHOTO_MARKUP_MAP).set(`nested-${F1}`, photo);
        for (const id of ids) photo.set(id, arrow());
      });
    const merged = race(
      (a) => nested(a, ['a1', 'a2']),
      (b) => nested(b, ['b1']),
    );
    const survivors = Object.keys((json(merged) as Record<string, Record<string, unknown>>)[`nested-${F1}`]);
    expect(survivors.length).toBeLessThan(3);
  });

  it('uno cambia el color y otro mueve la misma forma: quedan las dos cosas (una propiedad por clave)', () => {
    const base = new Y.Doc();
    addShape(base, F1, 'a', arrow(), FRAME);
    const merged = race(
      (a) => {
        Y.applyUpdate(a, Y.encodeStateAsUpdate(base));
        updateShape(a, F1, 'a', { strokeColor: '#0a84ff' });
      },
      (b) => {
        Y.applyUpdate(b, Y.encodeStateAsUpdate(base));
        updateShape(b, F1, 'a', { posX: 10, posY: 20 });
      },
    );
    const s = readPhotoMarkup(merged.getMap(PHOTO_MARKUP_MAP), F1)!.shapes[0];
    expect([s.strokeColor, s.posX, s.posY]).toEqual(['#0A84FF', 10, 20]);
  });

  it('una versión futura que suma un campo no lo pierde cuando una de hoy mueve la forma', () => {
    const doc = new Y.Doc();
    addShape(doc, F1, 'a', arrow({ banner: 2 }), FRAME);
    updateShape(doc, F1, 'a', { posX: 5 });
    expect((json(doc) as Record<string, Record<string, unknown>>)[shapeKey(F1, 'a')].banner).toBe(2);
  });

  it('el marco escrito por dos a la vez: queda uno, con los mismos números', () => {
    const merged = race(
      (a) => writeFrame(a, F1, 6000, 4000),
      (b) => writeFrame(b, F1, 6000, 4000),
    );
    expect(readFrame(merged.getMap(PHOTO_MARKUP_MAP).get(F1))).toEqual({ v: 1, w: 6000, h: 4000 });
  });
});

describe('deshacer: el de la foto y el de la página no se mezclan', () => {
  it('un UndoManager con el origen de una foto deshace solo lo de esa foto; el de la página no deshace anotaciones', () => {
    const doc = new Y.Doc();
    const map = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
    const text = doc.getText('t');
    const photoUndo = new Y.UndoManager(map, { trackedOrigins: new Set([markupOrigin(F1)]), captureTimeout: 0 });
    const pageUndo = new Y.UndoManager(text, { trackedOrigins: new Set(['editor']), captureTimeout: 0 });
    doc.transact(() => text.insert(0, 'hola'), 'editor');
    addShape(doc, F1, 'a', arrow(), FRAME);
    addShape(doc, F2, 'b', arrow(), FRAME);
    pageUndo.undo();
    expect(text.toString()).toBe('');
    expect(Object.keys(json(doc)).length).toBe(4);
    photoUndo.undo();
    expect(Object.keys(json(doc)).sort()).toEqual([F2, shapeKey(F2, 'b')].sort());
  });
});

describe('la base limpia y el historial (entrega 0)', () => {
  /** Las filas de una página: cada cambio, una fila sin GC (como sube la app). */
  function rowsOf(steps: ((d: Y.Doc) => void)[]): Uint8Array[] {
    const doc = new Y.Doc({ gc: false });
    const rows: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => rows.push(u));
    // Cada paso, una transacción (una fila), como una edición de la app.
    for (const step of steps) doc.transact(() => step(doc));
    return rows;
  }
  const has = (bytes: Uint8Array, mark: string) => Buffer.from(bytes).toString('latin1').includes(mark);

  it('la base limpia conserva las anotaciones vivas y vacía lo borrado (también una foto podada entera)', () => {
    const rows = rowsOf([
      (d) => d.getText('t').insert(0, 'texto'),
      (d) => addShape(d, F1, 'vive', label('<vive>'), FRAME),
      (d) => addShape(d, F1, 'borrada', label('<borrada>')),
      (d) => addShape(d, F2, 'podada', label('<podada>'), FRAME),
      (d) => updateShape(d, F1, 'vive', { text: '<vive2>' }),
      (d) => deleteShape(d, F1, 'borrada'),
      (d) => removePhotoMarkup(d, F2),
    ]);
    // En las filas está todo (el historial lo devuelve).
    const all = Y.mergeUpdates(rows);
    for (const mark of ['<vive>', '<vive2>', '<borrada>', '<podada>']) expect(has(all, mark)).toBe(true);
    const { base, doc } = buildCleanBase(rows);
    expect(checkCleanBase(base, doc)).toBeNull();
    expect(has(base, '<vive2>')).toBe(true);
    for (const mark of ['<vive>', '<borrada>', '<podada>']) expect(has(base, mark), mark).toBe(false);
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, base);
    expect(Object.keys(json(fresh)).sort()).toEqual([F1, shapeKey(F1, 'vive')].sort());
    expect(readPhotoMarkup(fresh.getMap(PHOTO_MARKUP_MAP), F1)!.shapes.map((s) => (s as TextShape).text)).toEqual(['<vive2>']);
  });

  it('cada versión del historial trae las anotaciones de entonces (y vaciar lo de colapsar no las toca)', () => {
    const rows = rowsOf([
      (d) => {
        const t = new Y.XmlText();
        d.getXmlFragment(CONTENT_FRAGMENT).insert(0, [t]);
        t.insert(0, 'uno');
        d.getMap('collapsedHeadings').set('h', true);
        addShape(d, F1, 'a', arrow(), FRAME);
      },
      (d) => {
        (d.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlText).insert(3, ' dos');
        addShape(d, F1, 'b', label('<b>'));
      },
    ]);
    const history = new PageHistory(
      rows.map(
        (data, i): HistoryRow => ({ id: i + 1, seq: i + 1, createdBy: 'u', createdAt: new Date(Date.UTC(2026, 9, 2, 10 + i * 2)).toISOString(), data }),
      ),
    );
    expect(history.sessions.length).toBe(2);
    const first = history.version(0);
    const last = history.version(1);
    expect(Object.keys(json(first)).sort()).toEqual([F1, shapeKey(F1, 'a')].sort());
    expect(Object.keys(json(last)).sort()).toEqual([F1, shapeKey(F1, 'a'), shapeKey(F1, 'b')].sort());
    expect(last.getMap('collapsedHeadings').size).toBe(0);
  });
});

describe('fotos sacadas (AN11: la cuenta; la poda es de la entrega 2)', () => {
  it('las fotos con anotaciones que ya no están en el contenido', () => {
    const doc = new Y.Doc();
    addShape(doc, F1, 'a', arrow(), FRAME);
    addShape(doc, F2, 'b', { type: 'loupe' }, FRAME);
    expect(orphanMarkup(doc.getMap(PHOTO_MARKUP_MAP), new Set([F1]))).toEqual([F2]);
    expect(orphanMarkup(doc.getMap(PHOTO_MARKUP_MAP), new Set([F1, F2]))).toEqual([]);
    expect(removePhotoMarkup(doc, F2)).toBe(2);
    expect(Object.keys(json(doc)).sort()).toEqual([F1, shapeKey(F1, 'a')].sort());
  });
});
