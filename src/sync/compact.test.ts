import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { buildDoc, compact, compareDocs, docFromUpdate, pendingKey, verifySnapshot } from './compact';
import { seedIfEmpty } from './structure';

// Compactar, entrega 2: el núcleo (Docs/Doc_Compactar.md, sección 15, prueba 1). El snapshot es la base y las filas
// aplicadas en orden en un documento sin GC; la comprobación por los dos caminos (con lo pendiente y unidad por unidad)
// no tiene falsas alarmas al azar y rechaza cada snapshot malo (las mutantes).

/** Un generador al azar con semilla (mulberry32): las corridas se repiten igual. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Filas de un servidor escritas por tres dispositivos al azar: texto, formato, un mapa y un fragmento XML; borrados de
 * letras y de párrafos; subidas demoradas (lo de un dispositivo sale en otro orden: el servidor guarda filas que esperan
 * otra) y, a veces, un dispositivo con GC que vuelve a subir el documento entero (una versión vieja o después de
 * restaurar una copia: lo borrado viaja como hueco).
 */
function randomRows(seed: number, steps = 60, emoji = true): Uint8Array[] {
  const r = rng(seed);
  const devices = [0, 1, 2].map((i) => {
    const doc = new Y.Doc({ gc: i !== 2 ? false : true });
    const queue: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin !== 'pull') queue.push(u);
    });
    return { doc, queue, seen: 0 };
  });
  const rows: Uint8Array[] = [];
  const word = () => ['hola ', 'shot ', 'VFX ', 'día ', emoji ? '🎬 ' : 'ñu ', 'x'][Math.floor(r() * 6)];
  for (let step = 0; step < steps; step++) {
    const d = devices[Math.floor(r() * 3)];
    const t = d.doc.getText('t');
    const roll = r();
    if (roll < 0.35) t.insert(Math.floor(r() * (t.length + 1)), word(), r() < 0.2 ? { bold: true } : undefined);
    else if (roll < 0.5 && t.length > 0) {
      const at = Math.floor(r() * t.length);
      t.delete(at, Math.min(t.length - at, 1 + Math.floor(r() * 6)));
    } else if (roll < 0.6) d.doc.getMap('m').set(`k${Math.floor(r() * 4)}`, Math.floor(r() * 100));
    else if (roll < 0.75) {
      const frag = d.doc.getXmlFragment('f');
      const p = new Y.XmlElement('paragraph');
      p.insert(0, [new Y.XmlText(word())]);
      frag.insert(Math.floor(r() * (frag.length + 1)), [p]);
    } else if (roll < 0.82) {
      const frag = d.doc.getXmlFragment('f');
      if (frag.length > 0) frag.delete(Math.floor(r() * frag.length), 1);
    } else if (roll < 0.9 && d.queue.length > 0) {
      // Sube: a veces todo junto, a veces de a uno y en otro orden (una subida demorada).
      const out = d.queue.splice(0);
      if (r() < 0.3) out.reverse();
      if (r() < 0.5) rows.push(Y.mergeUpdates(out));
      else rows.push(...out);
    } else if (roll < 0.93 && d.doc.gc) {
      // El de GC vuelve a subir todo (lo borrado, como hueco).
      d.queue.splice(0);
      rows.push(Y.encodeStateAsUpdate(d.doc));
    } else {
      // Baja lo nuevo del servidor.
      for (; d.seen < rows.length; d.seen++) Y.applyUpdate(d.doc, rows[d.seen], 'pull');
    }
  }
  for (const d of devices) {
    if (d.queue.length > 0) rows.push(Y.mergeUpdates(d.queue.splice(0)));
    d.doc.destroy();
  }
  return rows;
}

/** Arma los snapshots de a tramos al azar sobre el anterior (como lo hacen los dispositivos), hasta `rows.length`. */
function chain(rows: Uint8Array[], r: () => number): { upTo: number; snap: Uint8Array; base: Uint8Array | null; tail: Uint8Array[] }[] {
  const out: { upTo: number; snap: Uint8Array; base: Uint8Array | null; tail: Uint8Array[] }[] = [];
  let at = 0;
  let base: Uint8Array | null = null;
  while (at < rows.length) {
    const next = Math.min(rows.length, at + 1 + Math.floor(r() * 12));
    const tail = rows.slice(at, next);
    const snap = compact(base, tail);
    out.push({ upTo: next, snap, base, tail });
    base = snap;
    at = next;
  }
  return out;
}

const SEEDS = Number(process.env.COMPACT_SEEDS ?? 40);
const sorted = (o: Record<string, unknown>) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));

describe('el núcleo: armar y comprobar', () => {
  it(`al azar (${SEEDS} semillas): cada eslabón pasa la comprobación, es igual a todo desde cero, es determinista y un dispositivo nuevo queda igual`, () => {
    let snapshots = 0;
    let withPending = 0;
    let sameBytesAsScratch = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rows = randomRows(seed);
      const r = rng(seed * 7919);
      for (const link of chain(rows, r)) {
        snapshots++;
        expect(verifySnapshot(link.base, link.tail, link.snap), `semilla ${seed}, hasta ${link.upTo}`).toBeNull();
        // Determinista: lo mismo da los mismos bytes.
        expect(Buffer.from(compact(link.base, link.tail)).equals(Buffer.from(link.snap))).toBe(true);
        // Igual a todo desde cero (la segunda red).
        const scratch = buildDoc(null, rows.slice(0, link.upTo));
        const fromSnap = docFromUpdate(link.snap);
        expect(compareDocs(scratch, fromSnap), `semilla ${seed}, desde cero hasta ${link.upTo}`).toBeNull();
        if (pendingKey(fromSnap) !== '|') withPending++;
        if (Buffer.from(Y.encodeStateAsUpdate(scratch)).equals(Buffer.from(link.snap))) sameBytesAsScratch++;
        // Un dispositivo nuevo: el snapshot y las filas que siguen, igual que todas las filas.
        const fresh = docFromUpdate(link.snap);
        for (const u of rows.slice(link.upTo)) Y.applyUpdate(fresh, u);
        const all = buildDoc(null, rows);
        expect(fresh.getText('t').toString()).toBe(all.getText('t').toString());
        expect(fresh.getXmlFragment('f').toString()).toBe(all.getXmlFragment('f').toString());
        expect(sorted(fresh.getMap('m').toJSON())).toBe(sorted(all.getMap('m').toJSON()));
        expect(Y.equalSnapshots(Y.snapshot(fresh), Y.snapshot(all))).toBe(true);
        for (const d of [scratch, fromSnap, fresh, all]) d.destroy();
      }
    }
    expect(snapshots).toBeGreaterThan(SEEDS * 3);
    // Las subidas demoradas dejan snapshots con algo pendiente: la comprobación los cubre.
    expect(withPending).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.info(`compactar al azar: ${snapshots} snapshots, ${withPending} con algo pendiente, ${sameBytesAsScratch} con los mismos bytes que desde cero`);
  });

  it('una página vacía, una con solo la semilla y una vieja con dos raíces', () => {
    expect(verifySnapshot(null, [], compact(null, []))).toBeNull();
    const seeded = new Y.Doc();
    seedIfEmpty(seeded, 'p', 'seed');
    const seedRow = Y.encodeStateAsUpdate(seeded);
    expect(verifySnapshot(null, [seedRow], compact(null, [seedRow]))).toBeNull();
    // Dos dispositivos que sembraron por su cuenta (antes de la semilla fija): dos raíces; el snapshot copia las dos.
    const a = new Y.Doc();
    const b = new Y.Doc();
    for (const d of [a, b]) {
      const block = new Y.XmlElement('blockGroup');
      d.getXmlFragment('document-store').insert(0, [block]);
    }
    const rows = [Y.encodeStateAsUpdate(a), Y.encodeStateAsUpdate(b)];
    const snap = compact(null, rows);
    expect(verifySnapshot(null, rows, snap)).toBeNull();
    const back = docFromUpdate(snap);
    expect(back.getXmlFragment('document-store').length).toBe(2);
    // Compactar no repara nada: la reparación de la app las junta al abrir, como sin snapshot.
    for (const d of [seeded, a, b, back]) d.destroy();
  });
});

describe('mutantes: cada snapshot malo se rechaza', () => {
  /** Filas de una página: escribir, borrar letras y un párrafo, en varias subidas de dos autores. */
  function rowsOf(): Uint8Array[] {
    const a = new Y.Doc({ gc: false });
    const b = new Y.Doc({ gc: false });
    const rows: Uint8Array[] = [];
    const sync = () => {
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
      Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    };
    const t = a.getText('t');
    let sv = Y.encodeStateVector(a);
    const push = (d: Y.Doc) => {
      rows.push(Y.encodeStateAsUpdate(d, sv));
      sv = Y.encodeStateVector(d);
    };
    t.insert(0, 'hello world ');
    push(a);
    t.insert(t.length, 'one two three ');
    push(a);
    sync();
    b.getText('t').delete(0, 6);
    sv = Y.encodeStateVector(a);
    rows.push(Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    sync();
    sv = Y.encodeStateVector(a);
    t.insert(t.length, 'four ');
    push(a);
    a.destroy();
    b.destroy();
    return rows;
  }

  it('le falta una fila', () => {
    const rows = rowsOf();
    const bad = compact(null, rows.filter((_, i) => i !== 1));
    expect(verifySnapshot(null, rows, bad)).not.toBeNull();
  });

  it('un borrado sobre algo integrado (que ninguna fila hizo)', () => {
    const rows = rowsOf();
    const d = buildDoc(null, rows);
    d.getText('t').delete(0, 3);
    const bad = Y.encodeStateAsUpdate(d);
    d.destroy();
    expect(verifySnapshot(null, rows, bad)).not.toBeNull();
  });

  it('una fila pendiente (espera algo que no llegó) o un borrado pendiente que el snapshot perdió', () => {
    // A escribe "hello" y después " WORLD"; el servidor tiene solo la segunda fila (pendiente: le falta la primera).
    const a = new Y.Doc();
    a.getText('t').insert(0, 'hello');
    const first = Y.encodeStateAsUpdate(a);
    const sv = Y.encodeStateVector(a);
    a.getText('t').insert(5, ' WORLD');
    const second = Y.encodeStateAsUpdate(a, sv);
    // Lo bueno incluye lo pendiente; el malo (sin la fila pendiente) tiene que fallar.
    expect(pendingKey(docFromUpdate(compact(null, [second])))).not.toBe('|');
    expect(verifySnapshot(null, [second], compact(null, [second]))).toBeNull();
    expect(verifySnapshot(null, [second], compact(null, []))).not.toBeNull();
    // Un borrado pendiente: borra algo de la primera fila, que el servidor no tiene.
    const b = new Y.Doc();
    Y.applyUpdate(b, first);
    const svB = Y.encodeStateVector(b);
    b.getText('t').delete(0, 2);
    const del = Y.encodeStateAsUpdate(b, svB);
    expect(pendingKey(docFromUpdate(compact(null, [del])))).not.toBe('|');
    expect(verifySnapshot(null, [second, del], compact(null, [second, del]))).toBeNull();
    expect(verifySnapshot(null, [second, del], compact(null, [second]))).not.toBeNull();
    // Y el dispositivo nuevo que baja el bueno y después la primera fila ve "llo WORLD".
    const fresh = docFromUpdate(compact(null, [second, del]));
    Y.applyUpdate(fresh, first);
    expect(fresh.getText('t').toString()).toBe('llo WORLD');
    for (const d of [a, b, fresh]) d.destroy();
  });

  it('el mismo elemento con otro contenido (mismos ids): la comparación unidad por unidad lo ve', () => {
    const a = new Y.Doc({ gc: false });
    a.clientID = 4242;
    a.getText('t').insert(0, 'abc');
    const good = Y.encodeStateAsUpdate(a);
    const b = new Y.Doc({ gc: false });
    b.clientID = 4242;
    b.getText('t').insert(0, 'abd');
    const forged = Y.encodeStateAsUpdate(b);
    // El vector, los borrados y "absorber" no lo ven (los ids son los mismos)…
    const x = docFromUpdate(good);
    const y = docFromUpdate(forged);
    expect(Y.equalSnapshots(Y.snapshot(x), Y.snapshot(y))).toBe(true);
    // …la comparación sí.
    expect(compareDocs(x, y)).toMatch(/^content text/);
    expect(verifySnapshot(null, [good], forged)).not.toBeNull();
    for (const d of [a, b, x, y]) d.destroy();
  });

  it('armado con Y.mergeUpdates sobre filas de un dispositivo con GC: se rechaza (pierde el texto borrado)', () => {
    // Un dispositivo escribe y borra; otro, con GC, vuelve a subir el documento entero después (lo borrado como hueco).
    const a = new Y.Doc({ gc: false });
    const t = a.getText('t');
    const rows: Uint8Array[] = [];
    let sv = Y.encodeStateVector(a);
    const push = () => {
      rows.push(Y.encodeStateAsUpdate(a, sv));
      sv = Y.encodeStateVector(a);
    };
    t.insert(0, 'una frase que se va a borrar ');
    push();
    t.delete(4, 6);
    push();
    const gcDevice = new Y.Doc();
    for (const u of rows) Y.applyUpdate(gcDevice, u);
    rows.push(Y.encodeStateAsUpdate(gcDevice));
    // `mergeUpdates` puede quedarse con la copia del hueco: no es lo mismo que aplicar las filas en orden.
    const merged = Y.mergeUpdates([rows[2], rows[0], rows[1]]);
    expect(verifySnapshot(null, rows, merged)).not.toBeNull();
    expect(verifySnapshot(null, rows, compact(null, rows))).toBeNull();
    a.destroy();
    gcDevice.destroy();
  });
});

describe('el historial sobre el snapshot (Doc_Historial.md)', () => {
  it('cada versión armada sobre el snapshot es igual a aplicar las filas hasta ahí; con Y.mergeUpdates, no', () => {
    let differsWithMerge = 0;
    for (let seed = 1; seed <= 12; seed++) {
      // Sin emojis: borrar la mitad de un par sustituto (algo que el editor no hace) cambia las dos mitades por U+FFFD en
      // el elemento partido, y una versión anterior armada sobre el documento entero ya no lo muestra igual (es de Yjs,
      // pasa igual sin snapshot).
      const rows = randomRows(seed * 31, 50, false);
      const snap = compact(null, rows);
      const viaSnap = docFromUpdate(snap);
      const merged = docFromUpdate(Y.mergeUpdates(rows));
      const step = new Y.Doc({ gc: false });
      for (let k = 0; k < rows.length; k++) {
        Y.applyUpdate(step, rows[k]);
        const version = Y.snapshot(step);
        const expected = step.getText('t').toString();
        const fromSnap = Y.createDocFromSnapshot(viaSnap, version);
        expect(fromSnap.getText('t').toString(), `semilla ${seed}, versión ${k + 1}`).toBe(expected);
        const fromMerge = Y.createDocFromSnapshot(merged, version);
        if (fromMerge.getText('t').toString() !== expected) differsWithMerge++;
        fromSnap.destroy();
        fromMerge.destroy();
      }
      for (const d of [viaSnap, merged, step]) d.destroy();
    }
    // La mutante: armado con `mergeUpdates`, alguna versión del medio pierde texto.
    expect(differsWithMerge).toBeGreaterThan(0);
  });
});
