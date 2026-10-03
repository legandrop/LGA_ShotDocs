// Deshacer en el orden en que editaste, entrega 3 (P.26; Docs/Doc_Deshacer.md, sección 19), al azar: lo anotado en
// las fotos de una página como un paso de la línea de tiempo, con la página escribiendo texto en el medio. Cada vez en
// el anotador es su propio `UndoManager` (como Annotator.tsx: el origen de la foto, sin juntar pasos, lo ajeno
// protegido, ⌘Z de a un paso); al cerrarlo pasa a la línea de tiempo (`pushMarkup`). Sin el editor (el núcleo): el
// texto de las páginas va por un `UndoManager` simple anotado en la línea de tiempo.
//
// - Sola: deshacer todo deja el mapa y el texto como al principio, y rehacer todo, como al final.
// - Con otra persona anotando la misma foto (dibuja, mueve y cambia formas suyas y tuyas, borra; también con cortes de
//   red y deshaciendo lo suyo): ningún deshacer ni
//   rehacer (de la línea de tiempo o del anotador) se lleva algo suyo que estaba a la vista (una forma, un campo, el
//   marco de una foto donde dibujó), y los dos terminan iguales.
//
// Cuántas semillas: `TIMELINE_SEEDS` (por defecto, pocas: la medición grande va en el informe).
import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addShape, deleteShape, markupOrigin, PHOTO_MARKUP_MAP, updateShape } from '../media/markup';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { connect, seeded } from './collabHarness';
import { popMarkupStep, protectMarkupOthers, UndoTimeline, type StepKind, type TimelineDocs } from './undoTimeline';

const SEEDS = Number(process.env.TIMELINE_SEEDS ?? 12);
const PHOTOS = ['0f8fad5b-d9cb-469f-a165-708677289501', '7c9e6679-7425-40de-944b-e07fc1f90ae7'];
const FRAME = { w: 4000, h: 3000 };

function report(name: string, tally: object): void {
  if (process.env.TIMELINE_OUT) appendFileSync(process.env.TIMELINE_OUT, `${name} ${JSON.stringify(tally)}\n`);
}

interface ItemLike {
  id: { client: number };
  deleted: boolean;
  content: { type?: { _map?: Map<string, ItemLike> } };
}

/**
 * Lo del otro que está a la vista: sus formas vivas, sus campos vivos en formas vivas, y el marco de cada foto donde
 * tiene una forma viva (sin el marco, sus formas no se ven).
 */
function visibleOf(map: Y.Map<unknown>, client: number): Set<string> {
  const out = new Set<string>();
  const root = (map as unknown as { _map: Map<string, ItemLike> })._map;
  for (const [key, item] of root) {
    if (item.deleted) continue;
    if (item.id.client === client) {
      out.add(key);
      const photo = key.split('/')[0];
      if (key.includes('/') && map.has(photo)) out.add(`frame:${photo}`);
    }
    for (const [field, fi] of item.content?.type?._map ?? []) {
      if (fi.deleted || fi.id.client !== client) continue;
      out.add(`${key}.${field}`);
      // Su cambio en una forma mía se ve solo con el marco de la foto.
      const photo = key.split('/')[0];
      if (map.has(photo)) out.add(`frame:${photo}`);
    }
  }
  return out;
}

/** Lo de `before` que ya no está en `after`. */
const lost = (before: Set<string>, after: Set<string>) => [...before].filter((k) => !after.has(k));

/** Un objeto con las claves en orden (el orden de las claves de un `Y.Map` rehecho puede cambiar; lo que vale es el contenido). */
const sorted = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])])) : v;

/** Lo anotado sin los marcos solos (deshacer nunca borra el marco, auditoría B1; un marco sin formas no se dibuja). */
function shown(map: Y.Map<unknown>): Record<string, unknown> {
  const all = map.toJSON() as Record<string, unknown>;
  const keys = Object.keys(all);
  return Object.fromEntries(Object.entries(all).filter(([k]) => k.includes('/') || keys.some((o) => o.startsWith(`${k}/`))));
}

const json = (doc: Y.Doc) => JSON.stringify({ m: sorted(shown(doc.getMap(PHOTO_MARKUP_MAP))), t: doc.getXmlFragment(CONTENT_FRAGMENT).toString() });

interface Tally {
  runs: number;
  exactUndo: number;
  exactRedo: number;
  undone: number;
  sessions: number;
  othersLost: number;
  converged: number;
  errors: number;
  frameless: number;
}

/** Formas vivas sin el marco de su foto (no se ven): lo que dejaba B1 de la auditoría al volver la red. */
function frameless(map: Y.Map<unknown>): number {
  let n = 0;
  for (const key of map.keys()) if (key.includes('/') && !map.has(key.split('/')[0])) n++;
  return n;
}

type Mode = 'sola' | 'otro' | 'cortes';

function run(seed: number, mode: Mode, tally: Tally): void {
  const withOther = mode !== 'sola';
  const rnd = seeded(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  // Dos páginas: A tiene las fotos; B, solo texto (para el orden entre páginas).
  const docs: Record<string, Y.Doc> = { A: new Y.Doc(), B: new Y.Doc() };
  const texts: Record<string, Y.XmlText> = {};
  for (const [name, doc] of Object.entries(docs)) {
    const el = new Y.XmlText();
    doc.getXmlFragment(CONTENT_FRAGMENT).insert(0, [el]);
    el.insert(0, 'base ');
    texts[name] = el;
  }
  const mine = docs.A;
  const map = mine.getMap<unknown>(PHOTO_MARKUP_MAP);
  let other: Y.Doc | null = null;
  let link: ReturnType<typeof connect> | null = null;
  // Con cortes, el otro anota con su anotador (también deshace lo suyo, de a un paso y protegido, como Annotator.tsx).
  let otherUm: Y.UndoManager | null = null;
  if (withOther) {
    other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(mine));
    link = connect(mine, other, 'sync', { repair: false });
    if (mode === 'cortes') {
      const otherMap = other.getMap<unknown>(PHOTO_MARKUP_MAP);
      otherUm = new Y.UndoManager(otherMap, { trackedOrigins: new Set(PHOTOS.map(markupOrigin)), captureTimeout: 0 });
      protectMarkupOthers(otherUm, otherMap);
    }
  }
  let online = true;
  /** Vuelve la red y mira que no queden formas sin marco en ninguno de los dos. */
  const reconnect = () => {
    link!.online();
    online = true;
    const n = frameless(map) + frameless(other!.getMap(PHOTO_MARKUP_MAP));
    tally.frameless += n;
    if (n > 0) throw new Error(`semilla ${seed}: ${n} formas sin marco al volver la red`);
  };
  const tdocs: TimelineDocs = { open: async (id) => docs[id], close: () => undefined, subscribeUnsupported: () => () => undefined };
  const timeline = new UndoTimeline({ docs: tdocs, projectOf: () => 'P' });
  // El texto de cada página: un `UndoManager` anotado en la línea de tiempo (como el editor en pantalla).
  const textUm: Record<string, Y.UndoManager> = {};
  for (const [name, doc] of Object.entries(docs)) {
    textUm[name] = new Y.UndoManager(doc.getXmlFragment(CONTENT_FRAGMENT), { trackedOrigins: new Set(['texto']) });
    timeline.attach(name, doc, textUm[name], { editable: () => true });
  }
  const start = { A: json(docs.A), B: json(docs.B) };
  let session: { um: Y.UndoManager; fileId: string; wrote: { n: number } } | null = null;
  let counter = 0;
  const shapeIn = (doc: Y.Doc, fileId: string): string | null => {
    const keys = [...doc.getMap(PHOTO_MARKUP_MAP).keys()].filter((k) => k.startsWith(`${fileId}/`));
    return keys.length ? pick(keys).slice(fileId.length + 1) : null;
  };
  const fields = () => ({ type: 'rectangle', posX: Math.floor(rnd() * 4000), posY: Math.floor(rnd() * 3000), w: 200, h: 100, color: pick(['#ff0000', '#00ff00', '#0000ff']) });

  /** Corre `fn` (un deshacer o rehacer mío) y mira que no se lleve nada visible del otro. */
  const guard = (fn: () => void) => {
    const before = other ? visibleOf(map, other.clientID) : new Set<string>();
    try {
      fn();
    } catch (err) {
      tally.errors++;
      throw err;
    }
    if (other) {
      const gone = lost(before, visibleOf(map, other.clientID));
      tally.othersLost += gone.length;
      if (gone.length > 0) throw new Error(`semilla ${seed}: se fue lo del otro ${gone.join(', ')}`);
    }
  };

  const close = () => {
    if (!session) return;
    const { um, fileId, wrote } = session;
    um.clear(false, true);
    const steps = um.undoStack;
    um.undoStack = [];
    um.destroy();
    // Como Annotator.tsx: si se escribió algo (aunque se haya deshecho todo adentro).
    if (wrote.n > 0) timeline.pushMarkup('A', map, fileId, steps);
    if (steps.length) tally.sessions++;
    session = null;
  };

  const timelineStep = (kind: StepKind) => {
    const next = timeline.peek('P', kind);
    if (!next) return false;
    if (next.kind === 'markup') guard(() => void timeline.stepMarkup(next.id, kind));
    else if (next.kind === 'page') guard(() => void timeline.step(next.pageId, kind));
    else return false;
    if (kind === 'undo') tally.undone++;
    return true;
  };

  for (let i = 0; i < 50; i++) {
    const r = rnd();
    if (link && mode === 'cortes' && rnd() < 0.12) {
      if (online) {
        link.offline();
        online = false;
      } else reconnect();
      continue;
    }
    if (otherUm && r < 0.05) {
      popMarkupStep(otherUm, 'undo');
      continue;
    }
    if (other && r < 0.2) {
      // El otro anota la misma foto: dibuja, mueve o cambia (suyas o mías), o borra.
      const fileId = pick(PHOTOS);
      const target = shapeIn(other, fileId);
      const what = rnd();
      if (what < 0.4 || !target) addShape(other, fileId, `o${counter++}`, fields(), FRAME);
      else if (what < 0.85) other.transact(() => (other!.getMap(PHOTO_MARKUP_MAP).get(`${fileId}/${target}`) as Y.Map<unknown>).set(pick(['posX', 'color']), Math.floor(rnd() * 999)), 'otra');
      else other.transact(() => other!.getMap(PHOTO_MARKUP_MAP).delete(`${fileId}/${target}`), 'otra');
      continue;
    }
    if (session) {
      const { um, fileId } = session;
      const target = shapeIn(mine, fileId);
      if (r < 0.45) addShape(mine, fileId, `m${counter++}`, fields(), FRAME);
      else if (r < 0.6 && target) updateShape(mine, fileId, target, { posX: Math.floor(rnd() * 4000), posY: Math.floor(rnd() * 3000) });
      else if (r < 0.66 && target) updateShape(mine, fileId, target, { color: pick(['#123456', '#abcdef']) });
      else if (r < 0.72 && target) deleteShape(mine, fileId, target);
      else if (r < 0.8) guard(() => void popMarkupStep(um, 'undo'));
      else if (r < 0.85) guard(() => void popMarkupStep(um, 'redo'));
      else close();
      continue;
    }
    if (r < 0.4) {
      // Abrir el anotador en una foto.
      const fileId = pick(PHOTOS);
      const um = new Y.UndoManager(map, { trackedOrigins: new Set([markupOrigin(fileId)]), captureTimeout: 0 });
      protectMarkupOthers(um, map);
      const wrote = { n: 0 };
      um.on('stack-item-added', () => void wrote.n++);
      session = { um, fileId, wrote };
    } else if (r < 0.65) {
      const name = pick(['A', 'B']);
      docs[name].transact(() => texts[name].insert(texts[name].length, `${name}${counter++} `), 'texto');
      textUm[name].stopCapturing();
    } else if (r < 0.85) timelineStep('undo');
    else timelineStep('redo');
  }
  close();
  if (link && !online) reconnect();
  // Lo último, con lo que quedaba para rehacer: deshacer todo vuelve al principio y rehacer todo, acá.
  for (let g = 0; g < 1000 && timelineStep('redo'); g++);
  const end = { A: json(docs.A), B: json(docs.B) };
  for (let g = 0; g < 1000 && timelineStep('undo'); g++);
  const afterUndo = { A: json(docs.A), B: json(docs.B) };
  if (!other && afterUndo.A === start.A && afterUndo.B === start.B) tally.exactUndo++;
  else if (!other && process.env.MARKUP_DEBUG) console.log('DEBUG', seed, afterUndo.A, afterUndo.B);
  for (let g = 0; g < 1000 && timelineStep('redo'); g++);
  const afterRedo = { A: json(docs.A), B: json(docs.B) };
  if (!other && afterRedo.A === end.A && afterRedo.B === end.B) tally.exactRedo++;
  if (link && mode === 'cortes') reconnect();
  if (other && JSON.stringify(sorted(other.getMap(PHOTO_MARKUP_MAP).toJSON())) === JSON.stringify(sorted(map.toJSON()))) tally.converged++;
  tally.runs++;
  otherUm?.destroy();
  timeline.dispose();
}

const fresh = (): Tally => ({ runs: 0, exactUndo: 0, exactRedo: 0, undone: 0, sessions: 0, othersLost: 0, converged: 0, errors: 0, frameless: 0 });

describe('lo anotado como un paso, al azar (entrega 3)', () => {
  it(`sola: deshacer todo vuelve al principio y rehacer todo, al final (${SEEDS} semillas)`, () => {
    const tally = fresh();
    for (let seed = 1; seed <= SEEDS; seed++) run(seed * 7919, 'sola', tally);
    report('markup-sola', tally);
    expect(tally.sessions).toBeGreaterThan(SEEDS);
    expect(tally.exactUndo).toBe(SEEDS);
    expect(tally.exactRedo).toBe(SEEDS);
  });

  it(`con otra persona anotando la misma foto: nada suyo a la vista se va y los dos iguales (${SEEDS} semillas)`, () => {
    const tally = fresh();
    for (let seed = 1; seed <= SEEDS; seed++) run(seed * 104729, 'otro', tally);
    report('markup-otro', tally);
    expect(tally.othersLost).toBe(0);
    expect(tally.errors).toBe(0);
    expect(tally.converged).toBe(SEEDS);
  });

  // Auditoría de la entrega 3, B1: con la red cortada, el otro dibuja con el marco que escribí yo mientras deshago mi
  // anotación; al volver la red, sus formas no pueden quedar sin marco. Barata (sin editor): más semillas por defecto.
  const CUTS = Number(process.env.TIMELINE_SEEDS ?? 200);
  it(`con otra persona y cortes de red: ninguna forma queda sin marco y nada suyo se va (${CUTS} semillas)`, () => {
    const tally = fresh();
    for (let seed = 1; seed <= CUTS; seed++) run(seed * 141421, 'cortes', tally);
    report('markup-cortes', tally);
    expect(tally.frameless).toBe(0);
    expect(tally.othersLost).toBe(0);
    expect(tally.errors).toBe(0);
    expect(tally.converged).toBe(CUTS);
  });
});
