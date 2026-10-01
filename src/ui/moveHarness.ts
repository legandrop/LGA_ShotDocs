// Ayudas para las pruebas de mover bloques con dos editores a la vez (collabMove*.test.ts). Solo las usan las
// pruebas; la app no las importa. Ver Docs/Doc_Colapsar.md ("Mover la sección entera") y Docs/Doc_Colaboracion.md.
import type { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { TextSelection } from '@tiptap/pm/state';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { dispatchMove, moveTransaction, recreatedRange, type Recreate } from './blockMove';
import { applyLikeApp, mountEditor, pmFromY, sameDocs, seeded, unmountAll, view } from './collabHarness';

/** Palabras distintas (ninguna contiene a otra): una por bloque del contenido inicial. */
const WORDS = [
  'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike',
  'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey', 'xray', 'yankee', 'zulu',
];

/**
 * La página de las agendas: `o0` arriba; la sección que se mueve (`s0`…, `k` bloques); lo que salta (`g0`…, `m`
 * bloques); el destino (`d0`, `d1`). Con `headings`, `s0`, `g0` y `d0` son títulos H2 (secciones); si no, todo
 * párrafos (mover un bloque suelto). Cada bloque tiene una palabra propia.
 */
export function movePage(k: number, m: number, headings = true): PartialBlock[] {
  let w = 0;
  const block = (id: string, heading: boolean): PartialBlock =>
    (heading ? { id, type: 'heading', props: { level: 2 }, content: WORDS[w++] } : { id, type: 'paragraph', content: WORDS[w++] }) as never;
  const out: PartialBlock[] = [block('o0', false)];
  for (let i = 0; i < k; i++) out.push(block(`s${i}`, headings && i === 0));
  for (let i = 0; i < m; i++) out.push(block(`g${i}`, headings && i === 0));
  out.push(block('d0', headings), block('d1', false));
  return out;
}

/** Cómo mueve A (o B): como BlockNote hoy, o en dos pasadas recreando un lado. */
export type MoveWay = 'blocknote' | 'keyboard' | Recreate;

export interface MoveResult {
  /** Marcas escritas que no están al final. */
  lost: string[];
  /** Marcas escritas que están, pero en otro bloque que el que se escribió. */
  displaced: string[];
  /** Marcas que quedaron más de una vez. */
  twice: string[];
  /** Palabras de bloques que nadie borró y no están (texto que nadie tocó... o que solo se movió). */
  baseLost: string[];
  baseTwice: string[];
  /** Palabras de bloques que B borró y siguen estando. */
  resurrected: string[];
  /** Los dos documentos terminan iguales y cada editor muestra el suyo. */
  same: boolean;
  settled: boolean;
  /** Los bloques de la sección (`s…`) quedaron juntos y en orden (con lo que se agregó adentro). */
  sectionWhole: boolean;
  final: string;
}

/**
 * El editor muestra lo que dice el documento, sin mirar los ids de los bloques: si dos mueven lo mismo a la vez,
 * el bloque queda dos veces con el mismo id y el editor le cambia el id a uno al dibujarlo (lo guarda con la próxima
 * edición; Docs/Doc_Colaboracion.md, "Ids repetidos").
 */
export function showsDocNoIds(E: BlockNoteEditor, d: Y.Doc): boolean {
  const strip = (json: unknown): unknown =>
    Array.isArray(json)
      ? json.map(strip)
      : json && typeof json === 'object'
        ? Object.fromEntries(Object.entries(json).map(([k, v]) => (k === 'attrs' && v && typeof v === 'object' ? [k, { ...(v as object), id: null }] : [k, strip(v)])))
        : json;
  return JSON.stringify(strip(view(E).state.doc.toJSON())) === JSON.stringify(strip(pmFromY(E, d).toJSON()));
}

/** Los bloques del documento de Yjs, en orden: id y texto (sin los hijos). */
function yBlocks(d: Y.Doc): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  const walk = (el: Y.XmlElement | Y.XmlFragment) => {
    for (const c of el.toArray()) {
      if (!(c instanceof Y.XmlElement)) continue;
      if (c.nodeName === 'blockContainer') {
        let text = '';
        for (const part of c.toArray()) {
          if (part instanceof Y.XmlElement && part.nodeName !== 'blockGroup')
            text += part
              .toArray()
              .map((t) => (t instanceof Y.XmlText ? t.toString().replace(/<[^>]+>/g, '') : ''))
              .join('');
        }
        out.push({ id: String(c.getAttribute('id') ?? ''), text });
      }
      walk(c);
    }
  };
  walk(d.getXmlFragment(CONTENT_FRAGMENT));
  return out;
}

/** Los bloques de primer nivel del editor, con su posición. */
function topBlocks(E: BlockNoteEditor): { id: string; pos: number; size: number }[] {
  const out: { id: string; pos: number; size: number }[] = [];
  const root = view(E).state.doc.firstChild!;
  let pos = 1;
  root.forEach((n) => {
    out.push({ id: String(n.attrs.id), pos, size: n.nodeSize });
    pos += n.nodeSize;
  });
  return out;
}

/** Mueve la sección (`s…`) al otro lado de lo que salta (`g…`), en este editor. */
export function moveSection(E: BlockNoteEditor, way: MoveWay): void {
  const blocks = topBlocks(E);
  const idx = (p: string) => blocks.map((b, i) => (b.id.startsWith(p) ? i : -1)).filter((i) => i >= 0);
  const s = idx('s');
  const g = idx('g');
  if (!s.length || !g.length) return;
  const s0 = Math.min(...s);
  const s1 = Math.max(...s);
  const g0 = Math.min(...g);
  const g1 = Math.max(...g);
  if (s1 >= g0 && g1 >= s0) return; // mezclados: no se sabe qué mover
  const down = s1 < g0;
  const from = blocks[s0].pos;
  const to = blocks[s1].pos + blocks[s1].size;
  const insertAt = down ? blocks[g1].pos + blocks[g1].size : blocks[g0].pos;
  if (way === 'blocknote') {
    // Como BlockNote al arrastrar varios bloques o con su mover: sacar e insertar, en una transacción.
    const ids = blocks.slice(s0, s1 + 1).map((b) => b.id);
    const moved = ids.map((id) => E.getBlock(id)!);
    const ref = down ? blocks[g1].id : blocks[g0].id;
    E.transact(() => {
      E.removeBlocks(ids);
      E.insertBlocks(moved as never, ref, down ? 'after' : 'before');
    });
    return;
  }
  if (way === 'keyboard') {
    // Shift+Ctrl+flechas de BlockNote: la sección elegida (de texto a texto) salta un bloque por vez.
    const v = view(E);
    const doc = v.state.doc;
    v.dispatch(v.state.tr.setSelection(TextSelection.create(doc, from + 2, to - 2)));
    const e = E as unknown as { moveBlocksUp: () => void; moveBlocksDown: () => void };
    for (let i = 0; i < g.length; i++) (down ? e.moveBlocksDown : e.moveBlocksUp).call(E);
    return;
  }
  const v = view(E);
  const move = { from, to, insertAt };
  const removed = recreatedRange(v.state.doc, move, way);
  dispatchMove(v, moveTransaction(v.state, move), removed);
}

/**
 * Una agenda de A y B sobre `movePage`. Cada paso, letra + quién (+ región para las que la llevan):
 * - `V` mueve la sección al otro lado de lo que salta (A con `way`; B como `wayB`);
 * - `T` escribe una marca al principio o al final de un bloque de la región (`TBs`: en la sección; `g`, en lo que
 *   salta; `d`, en el destino; `o`, arriba);
 * - `X` borra un bloque (que no sea título) de la región; `N` agrega un párrafo con una marca después de un bloque
 *   de la región; `I` anida un bloque de la región debajo del de arriba (Tab);
 * - `d` entrega al otro lo pendiente de ese lado (como la app: con la reparación de estructura).
 */
export function runMoveSchedule(
  ops: string[],
  initial: PartialBlock[],
  rand: () => number,
  { way = 'smaller' as MoveWay, wayB = undefined as MoveWay | undefined } = {},
): MoveResult {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const flip = rand() < 0.5;
  docA.clientID = flip ? 2 : 1;
  docB.clientID = flip ? 1 : 2;
  const out = { A: [] as Uint8Array[], B: [] as Uint8Array[] };
  docA.on('update', (u: Uint8Array, o: unknown) => o !== 'remote' && out.A.push(u));
  docB.on('update', (u: Uint8Array, o: unknown) => o !== 'remote' && out.B.push(u));
  const A = mountEditor(docA, 'a');
  const B = mountEditor(docB, 'b');
  const deliver = (who: 'A' | 'B') => {
    for (const u of out[who].splice(0)) applyLikeApp(who === 'A' ? docB : docA, u);
  };
  A.replaceBlocks(A.document, initial as never);
  deliver('A');
  out.B.length = 0;

  const wordOf = new Map(yBlocks(docA).map((b) => [b.id, b.text]));
  const deleted = new Set<string>();
  /** Marca → id del bloque donde se escribió. */
  const typed = new Map<string, string>();
  const pick = <T>(list: T[]): T | undefined => list[Math.floor(rand() * list.length)];

  ops.forEach((op, n) => {
    const who = op[1] as 'A' | 'B';
    if (op[0] === 'd') return deliver(who);
    const E = who === 'A' ? A : B;
    const region = op[2] ?? '';
    const token = `{${who}${n}}`;
    const inRegion = topBlocks(E).filter((b) => b.id.startsWith(region));
    switch (op[0]) {
      case 'V':
        return moveSection(E, who === 'A' ? way : (wayB ?? way));
      case 'T': {
        const b = pick(inRegion);
        if (!b) return;
        const node = view(E).state.doc.nodeAt(b.pos)!;
        const end = rand() < 0.5;
        const pos = end ? b.pos + 2 + node.firstChild!.content.size : b.pos + 2;
        const v = view(E);
        v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos)));
        E.insertInlineContent(token);
        typed.set(token, b.id);
        return;
      }
      case 'X': {
        const b = pick(inRegion.filter((x) => view(E).state.doc.nodeAt(x.pos)!.firstChild!.type.name !== 'heading'));
        if (!b) return;
        deleted.add(b.id);
        return void E.removeBlocks([b.id]);
      }
      case 'I': {
        // Tab: anida el bloque debajo del de arriba (el primero de la página no se puede).
        const b = pick(inRegion.filter((x) => x.pos > 1));
        if (!b) return;
        E.setTextCursorPosition(b.id, 'start');
        if (E.canNestBlock()) E.nestBlock();
        return;
      }
      case 'N': {
        const b = pick(inRegion);
        if (!b) return;
        const id = `${b.id[0]}n${who}${n}`;
        E.insertBlocks([{ id, type: 'paragraph', content: token } as never], b.id, 'after');
        typed.set(token, id);
        return;
      }
      default:
        throw new Error(`Paso desconocido: ${op}`);
    }
  });
  for (let i = 0; i < 3; i++) {
    deliver('A');
    deliver('B');
  }
  const settled = out.A.length === 0 && out.B.length === 0;
  const blocks = yBlocks(docA);
  const all = blocks.map((b) => b.text).join(' | ');
  const count = (s: string) => all.split(s).length - 1;
  const lost: string[] = [];
  const displaced: string[] = [];
  for (const [token, id] of typed) {
    const holder = blocks.find((b) => b.text.includes(token));
    if (!holder) lost.push(token);
    else if (holder.id !== id) displaced.push(token);
  }
  const kept = [...wordOf].filter(([id]) => !deleted.has(id)).map(([, w]) => w);
  const gone = [...wordOf].filter(([id]) => deleted.has(id)).map(([, w]) => w);
  const sIds = blocks.map((b) => b.id).filter((id) => id.startsWith('s'));
  const sIdx = blocks.map((b, i) => (b.id.startsWith('s') ? i : -1)).filter((i) => i >= 0);
  const sectionWhole =
    sIdx.length === 0 ||
    (sIdx[sIdx.length - 1] - sIdx[0] === sIdx.length - 1 && sIds.filter((id) => /^s\d+$/.test(id)).every((id, i, arr) => i === 0 || Number(id.slice(1)) > Number(arr[i - 1].slice(1))));
  const result: MoveResult = {
    lost,
    displaced,
    twice: [...typed.keys()].filter((t) => count(t) > 1),
    baseLost: kept.filter((w) => count(w) === 0),
    baseTwice: kept.filter((w) => count(w) > 1),
    resurrected: gone.filter((w) => count(w) > 0),
    same: sameDocs(docA, docB) && showsDocNoIds(A, docA) && showsDocNoIds(B, docB),
    settled,
    sectionWhole,
    final: blocks.map((b) => `${b.id}:${b.text}`).join(' | '),
  };
  unmountAll();
  docA.destroy();
  docB.destroy();
  return result;
}

export interface MoveTally {
  schedules: number;
  lost: number;
  displaced: number;
  twice: number;
  baseLost: number;
  baseTwice: number;
  resurrected: number;
  different: number;
  unsettled: number;
  broken: number;
  examples: string[];
}

/** Corre `count` agendas al azar (con semilla) con las letras de `alphabet` y cuenta las que tienen cada problema. */
export async function tallyMoves(
  seed: number,
  count: number,
  alphabet: string[],
  initial: () => PartialBlock[],
  options: Parameters<typeof runMoveSchedule>[3] = {},
): Promise<MoveTally> {
  const rand = seeded(seed);
  const t: MoveTally = { schedules: count, lost: 0, displaced: 0, twice: 0, baseLost: 0, baseTwice: 0, resurrected: 0, different: 0, unsettled: 0, broken: 0, examples: [] };
  for (let i = 0; i < count; i++) {
    const len = 4 + Math.floor(rand() * 8);
    const sch = Array.from({ length: len }, () => alphabet[Math.floor(rand() * alphabet.length)]);
    // Siempre al menos un mover de A, antes de que se entreguen las cosas.
    if (!sch.some((s) => s[0] === 'V')) sch.splice(Math.floor(rand() * sch.length), 0, 'VA');
    const r = runMoveSchedule(sch, initial(), seeded(Math.floor(rand() * 1e9)), options);
    await new Promise((done) => setTimeout(done, 0));
    if (r.lost.length) t.lost++;
    if (r.displaced.length) t.displaced++;
    if (r.twice.length) t.twice++;
    if (r.baseLost.length) t.baseLost++;
    if (r.baseTwice.length) t.baseTwice++;
    if (r.resurrected.length) t.resurrected++;
    if (!r.same) t.different++;
    if (!r.settled) t.unsettled++;
    if (!r.sectionWhole) t.broken++;
    if ((r.lost.length || r.baseLost.length || r.displaced.length || !r.same) && t.examples.length < 3)
      t.examples.push(`${sch.join(' ')} => perdió ${r.lost} ${r.baseLost} movió ${r.displaced} iguales ${r.same}: ${r.final}`);
  }
  return t;
}
