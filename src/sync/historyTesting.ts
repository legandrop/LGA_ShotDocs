import * as Y from 'yjs';
import type { HistoryRow, PageHistory } from './history';
import type { HistoryMark } from './historyDiff';
import { CONTENT_FRAGMENT, normalizeStructure } from './structure';
import type { FakeServer } from './testing';

// Ayudas de las pruebas del historial (P.18): bloques como los guarda el editor, las filas del servidor en memoria y
// cómo leer la unión de una versión con sus marcas (qué texto marca cada una), sin el editor.

/** El grupo de bloques de la página (lo crea si no está), como lo guarda el editor. */
export function group(doc: Y.Doc): Y.XmlElement {
  const f = doc.getXmlFragment(CONTENT_FRAGMENT);
  if (f.length === 0) f.insert(0, [new Y.XmlElement('blockGroup')]);
  return f.get(0) as Y.XmlElement;
}

/** Un bloque `blockContainer > paragraph > texto`, como BlockNote. */
export function block(id: string, text: string, type = 'paragraph', attrs: Record<string, string> = {}): Y.XmlElement {
  const bc = new Y.XmlElement('blockContainer');
  bc.setAttribute('id', id);
  const p = new Y.XmlElement(type);
  for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v);
  const t = new Y.XmlText();
  t.insert(0, text);
  p.insert(0, [t]);
  bc.insert(0, [p]);
  return bc;
}

export const textOf = (bc: Y.XmlElement) => (bc.get(0) as Y.XmlElement).get(0) as Y.XmlText;

/** Las filas del servidor como las da `page_history`. */
export function rowsOf(server: FakeServer, pageId: string): HistoryRow[] {
  return (server.updates.get(pageId) ?? []).map((u) => ({
    id: u.id ?? u.seq,
    seq: u.seq,
    createdBy: u.createdBy ?? null,
    createdAt: u.createdAt ?? new Date(0).toISOString(),
    data: u.data,
  }));
}

/** Lo visible del documento (estructura, atributos y texto), para comparar sin imprimir. */
export const visible = (doc: Y.Doc) => doc.getXmlFragment(CONTENT_FRAGMENT).toJSON();

/** Lo que había en el servidor después de la fila `n`, como lo muestra la app (con la reparación de estructura). */
export function serverAt(rows: HistoryRow[], n: number): string {
  const doc = new Y.Doc();
  for (let i = 0; i < n; i++) Y.applyUpdate(doc, rows[i].data);
  normalizeStructure(doc, 'ref');
  const out = visible(doc);
  doc.destroy();
  return out;
}

export function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

/** El texto de un texto de Yjs (sin el formato). */
const plain = (t: Y.XmlText) => (t.toDelta() as { insert: unknown }[]).map((op) => (typeof op.insert === 'string' ? op.insert : '')).join('');

/** Una marca leída en la unión: qué marca, sobre qué bloque y con qué texto (o el nodo). */
export interface ReadMark {
  type: 'text' | 'node';
  kind: string;
  row: number;
  block: string;
  text: string;
  label?: string;
}

/** El id del bloque de un tipo de la unión. */
function blockIdOf(t: Y.AbstractType<any> | null): string {
  for (let x = t; x; x = (x._item?.parent as Y.AbstractType<any> | null) ?? null) {
    if (x instanceof Y.XmlElement && x.nodeName === 'blockContainer') return String(x.getAttribute('id') ?? '');
  }
  return '';
}

/** Lee las marcas de la unión (para comparar la diferencia completa con la de solo lo que cambió). */
export function readMarks(union: Y.Doc, marks: HistoryMark[]): ReadMark[] {
  return marks.map((m) => {
    if (m.type === 'text') {
      const a = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(m.from), union);
      const b = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(m.to), union);
      if (!a || !b || a.type !== b.type || !(a.type instanceof Y.XmlText)) return { type: 'text', kind: m.kind, row: m.row, block: '?', text: '?' };
      return { type: 'text', kind: m.kind, row: m.row, block: blockIdOf(a.type), text: plain(a.type).slice(a.index, b.index) };
    }
    const at = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(m.at), union);
    const node = at ? (at.type as Y.XmlElement).toArray()[at.index] : null;
    return {
      type: 'node',
      kind: m.kind,
      row: m.row,
      block: blockIdOf(node as Y.AbstractType<any> | null),
      text: node instanceof Y.XmlElement ? node.nodeName : '?',
      label: m.label ? JSON.stringify(m.label) : undefined,
    };
  });
}

/**
 * Los bloques de la unión sin lo marcado como `drop` (sin los bloques enteros y sin los tramos de texto): cada uno
 * como `id:texto`. Sin lo borrado tiene que dar la versión; sin lo agregado, la anterior.
 */
export function withoutMarks(union: Y.Doc, marks: HistoryMark[], drop: 'add' | 'del'): string[] {
  const droppedBlocks = new Set<Y.XmlElement>();
  const droppedText = new Map<Y.XmlText, [number, number][]>();
  for (const m of marks) {
    if (m.kind !== drop) continue;
    if (m.type === 'node') {
      if (!m.block) continue;
      const at = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(m.at), union);
      const node = at ? (at.type as Y.XmlElement).toArray()[at.index] : null;
      const container = node instanceof Y.XmlElement ? (node._item?.parent as Y.XmlElement) : null;
      if (container) droppedBlocks.add(container);
    } else {
      const a = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(m.from), union);
      const b = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(m.to), union);
      if (!a || !b || !(a.type instanceof Y.XmlText)) continue;
      const list = droppedText.get(a.type) ?? [];
      list.push([a.index, b.index]);
      droppedText.set(a.type, list);
    }
  }
  const out: string[] = [];
  const textOfContent = (el: Y.XmlElement): string => {
    let s = '';
    for (const c of el.toArray()) {
      if (c instanceof Y.XmlText) {
        const full = plain(c);
        const cut = droppedText.get(c) ?? [];
        for (let i = 0; i < full.length; i++) if (!cut.some(([a, b]) => i >= a && i < b)) s += full[i];
      } else if (c instanceof Y.XmlElement) s += textOfContent(c);
    }
    return s;
  };
  const walk = (g: Y.XmlElement) => {
    for (const c of g.toArray()) {
      if (!(c instanceof Y.XmlElement) || c.nodeName !== 'blockContainer') continue;
      if (droppedBlocks.has(c)) continue;
      const kids = c.toArray().filter((k): k is Y.XmlElement => k instanceof Y.XmlElement);
      const content = kids.find((k) => k.nodeName !== 'blockGroup');
      out.push(`${String(c.getAttribute('id') ?? '')}:${content ? textOfContent(content) : ''}`);
      for (const k of kids) if (k.nodeName === 'blockGroup') walk(k);
    }
  };
  const root = union.getXmlFragment(CONTENT_FRAGMENT).get(0);
  if (root instanceof Y.XmlElement) walk(root);
  return out;
}

/** Los bloques de una versión como `id:texto` (la misma cuenta que `withoutMarks`, sin marcas). */
export function blocksOf(doc: Y.Doc): string[] {
  return withoutMarks(doc, [], 'add');
}

/** El documento de una unión. */
export function unionDoc(update: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  return doc;
}

/** Quién subió la fila de una marca. */
export const authorOfRow = (h: PageHistory, row: number) => (row >= 0 ? h.rows[row].createdBy : undefined);

/**
 * Filas simuladas como las del diseño (sección 5.3): dos personas con el patrón de subida de la app después de B.15 (una
 * subida por pausa con solo lo nuevo, también sus borrados), un autor de Yjs nuevo cada 60 subidas, a veces las dos a
 * la vez, cambios de tipo como y-prosemirror y una pausa de una hora cada tanto. Para medir y para probar el Worker.
 */
export function simulate(n: number, seed = 7): HistoryRow[] {
  const rnd = seeded(seed);
  const people = ['ana', 'bea'];
  const docs = people.map(() => new Y.Doc());
  const pending: Uint8Array[][] = [[], []];
  const uploads = [0, 0];
  docs.forEach((d, i) =>
    d.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin !== 'remote') pending[i].push(u);
    }),
  );
  const rows: HistoryRow[] = [];
  let clock = Date.parse('2026-01-01T10:00:00Z');
  let ids = 0;
  const words = ['plano', 'general', 'Ramón', 'suelta', 'los', 'cubiertos', 'mesa', 'luz', 'cámara', 'toma'];
  const word = () => words[Math.floor(rnd() * words.length)];
  // La primera fila: el grupo con un bloque.
  docs[0].transact(() => group(docs[0]).insert(0, [block(`b${++ids}`, 'Escena 1')]));
  const upload = (i: number) => {
    if (pending[i].length === 0) return;
    const data = Y.mergeUpdates(pending[i]);
    pending[i] = [];
    rows.push({ id: rows.length + 1, seq: rows.length + 1, createdBy: people[i], createdAt: new Date(clock).toISOString(), data });
    // El otro lo baja (a veces más tarde: las dos a la vez).
    uploads[i]++;
    if (uploads[i] % 60 === 0) docs[i].clientID = Math.floor(rnd() * 2 ** 31) + 1;
  };
  const sync = () => {
    for (const row of rows.slice(-4)) for (const d of docs) Y.applyUpdate(d, row.data, 'remote');
  };
  upload(0);
  sync();
  while (rows.length < n) {
    const i = rnd() < 0.5 ? 0 : 1;
    const d = docs[i];
    d.transact(() => {
      const g = group(d);
      const containers = g.toArray().filter((x): x is Y.XmlElement => x instanceof Y.XmlElement && x.get(0) instanceof Y.XmlElement && (x.get(0) as Y.XmlElement).get(0) instanceof Y.XmlText);
      const pick = () => containers[Math.floor(rnd() * containers.length)];
      const r = rnd();
      if (containers.length === 0 || r < 0.12) g.insert(Math.floor(rnd() * (g.length + 1)), [block(`b${++ids}`, `${word()} ${word()}`)]);
      else if (r < 0.16 && containers.length > 5) g.delete(g.toArray().indexOf(pick()), 1);
      else if (r < 0.2) {
        const c = pick();
        const at = g.toArray().indexOf(c);
        const t = ((c.get(0) as Y.XmlElement).get(0) as Y.XmlText).toString();
        g.delete(at, 1);
        g.insert(at, [block(String(c.getAttribute('id')), t, rnd() < 0.5 ? 'heading' : 'paragraph')]);
      } else if (r < 0.35) {
        const t = (pick().get(0) as Y.XmlElement).get(0) as Y.XmlText;
        if (t.length > 4) t.delete(Math.floor(rnd() * (t.length - 4)), 1 + Math.floor(rnd() * 4));
      } else {
        const t = (pick().get(0) as Y.XmlElement).get(0) as Y.XmlText;
        t.insert(Math.floor(rnd() * (t.length + 1)), ` ${word()}`);
      }
    });
    upload(i);
    clock += rnd() < 0.01 ? 60 * 60_000 : 1200 + Math.floor(rnd() * 20_000);
    if (rnd() < 0.8) sync();
  }
  return rows;
}

