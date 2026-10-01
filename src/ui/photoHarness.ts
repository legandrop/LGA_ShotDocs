// Ayudas para las pruebas de las fotos en línea (inlinePhoto*.test.ts, collabPhotos*.test.ts). Solo las usan
// las pruebas; la app no las importa. Ver Docs/Doc_Fotos_En_Linea.md y Docs/Doc_Colaboracion.md.
import { BlockNoteSchema, defaultInlineContentSpecs, type BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { TextSelection } from '@tiptap/pm/state';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { applyLikeApp, mountEditor, press, sameDocs, seeded, showsDoc, unmountAll, view, yText } from './collabHarness';
import { appBlockSpecs, schema } from './editorSchema';
import { PHOTO, PhotoNode, photoSpec } from './inlinePhoto';

/**
 * El esquema de la versión anterior (`origin/main` al hacer la entrega 1a): los mismos bloques y el contenido
 * en línea de BlockNote, sin `photo`.
 */
export const previousSchema = BlockNoteSchema.create({ blockSpecs: appBlockSpecs });

/**
 * `photo` SIN la marca de los huecos: guarda un párrafo con fotos como lo guardaría y-prosemirror sin la parte
 * nueva del parche (sin textos vacíos en los huecos). Ninguna versión publicada es así: sirve para medir qué
 * arregla el parche y qué pasaría si las dos formas se mezclaran.
 */
export const noGapsSchema = BlockNoteSchema.create({
  blockSpecs: appBlockSpecs,
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    photo: {
      ...photoSpec,
      implementation: { ...photoSpec.implementation, node: PhotoNode.extend({ extendNodeSchema: () => ({}) }) },
    } as typeof photoSpec,
  },
});

export type Inline = string | { type: 'photo'; props: { url: string; name: string; w: number } };

/** Una foto en línea para el contenido de un bloque. La dirección no es de un archivo real. */
export const photo = (name: string, w = 0): Inline => ({ type: 'photo', props: { url: `https://example.invalid/${name}.jpg`, name, w } });

/** Un párrafo con ese contenido en línea (textos y fotos). */
export const para = (id: string, content: Inline[]): PartialBlock =>
  ({ id, type: 'paragraph', content: content.map((c) => (typeof c === 'string' ? { type: 'text', text: c, styles: {} } : c)) }) as never;

/** Las fotos en línea que muestra el editor, en orden. */
export function photosIn(E: BlockNoteEditor): { pos: number; name: string; w: number }[] {
  const out: { pos: number; name: string; w: number }[] = [];
  view(E).state.doc.descendants((n, pos) => {
    if (n.type.name === PHOTO) out.push({ pos, name: String(n.attrs.name), w: Number(n.attrs.w) });
    return true;
  });
  return out;
}

/** Las posiciones pegadas a una foto (justo antes y justo después de cada una), sin repetir. */
export function gapsIn(E: BlockNoteEditor): number[] {
  const out = new Set<number>();
  for (const p of photosIn(E)) {
    out.add(p.pos);
    out.add(p.pos + 1);
  }
  return [...out].sort((a, b) => a - b);
}

/** El principio y el final de cada bloque de texto. */
export function textEnds(E: BlockNoteEditor): number[] {
  const out: number[] = [];
  view(E).state.doc.descendants((n, pos) => {
    if (!n.isTextblock) return true;
    out.push(pos + 1, pos + 1 + n.content.size);
    return false;
  });
  return out;
}

/** Posiciones en el medio de un texto, entre dos letras minúsculas (nunca adentro de una marca `{A1}`). */
export function midTextIn(E: BlockNoteEditor): number[] {
  const out: number[] = [];
  view(E).state.doc.descendants((n, pos) => {
    if (!n.isText || !n.text) return true;
    for (let i = 1; i < n.text.length; i++) if (/[a-z]/.test(n.text[i - 1]) && /[a-z]/.test(n.text[i])) out.push(pos + i);
    return false;
  });
  return out;
}

export function caret(E: BlockNoteEditor, pos: number): void {
  const v = view(E);
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos)));
}

/** Escribe con el cursor en esa posición. */
export function typeAtPos(E: BlockNoteEditor, pos: number, text: string): void {
  caret(E, pos);
  E.insertInlineContent(text);
}

export function insertPhotoAt(E: BlockNoteEditor, pos: number, name: string, w = 0): void {
  const v = view(E);
  const node = v.state.schema.nodes[PHOTO].create({ url: `https://example.invalid/${name}.jpg`, name, w });
  v.dispatch(v.state.tr.insert(pos, node));
}

export function setPhotoWidth(E: BlockNoteEditor, pos: number, w: number): void {
  const v = view(E);
  v.dispatch(v.state.tr.setNodeAttribute(pos, 'w', w));
}

export function deletePhotoAt(E: BlockNoteEditor, pos: number): void {
  const v = view(E);
  v.dispatch(v.state.tr.delete(pos, pos + 1));
}

/** Mueve una foto a otra posición del documento, en una sola transacción (como arrastrarla: borrar e insertar). */
export function movePhoto(E: BlockNoteEditor, from: number, to: number): void {
  const v = view(E);
  const node = v.state.doc.nodeAt(from);
  if (!node || node.type.name !== PHOTO) return;
  const tr = v.state.tr.delete(from, from + 1);
  v.dispatch(tr.insert(tr.mapping.map(to), node));
}

/**
 * Cómo está guardado en Yjs el contenido de cada bloque de texto que tiene algún elemento en línea (una foto,
 * un salto de línea): `"texto"` por cada texto (también los vacíos) y `<nombre>` por cada elemento.
 */
export function storedInline(doc: Y.Doc): string[] {
  const out: string[] = [];
  const walk = (el: Y.XmlElement | Y.XmlFragment) => {
    const children = el.toArray();
    const inline = children.filter((c) => c instanceof Y.XmlElement && (c.nodeName === PHOTO || c.nodeName === 'hardBreak'));
    if (inline.length > 0) {
      out.push(children.map((c) => (c instanceof Y.XmlText ? JSON.stringify(c.toString().replace(/<[^>]+>/g, '')) : `<${(c as Y.XmlElement).nodeName}>`)).join(' '));
      return;
    }
    for (const c of children) if (c instanceof Y.XmlElement) walk(c);
  };
  walk(doc.getXmlFragment(CONTENT_FRAGMENT));
  return out;
}

/** Los nombres de las fotos en línea guardadas en Yjs, en orden. */
export function storedPhotos(doc: Y.Doc): string[] {
  const out: string[] = [];
  const walk = (el: Y.XmlElement | Y.XmlFragment) => {
    for (const c of el.toArray()) {
      if (!(c instanceof Y.XmlElement)) continue;
      if (c.nodeName === PHOTO) out.push(String(c.getAttribute('name')));
      else walk(c);
    }
  };
  walk(doc.getXmlFragment(CONTENT_FRAGMENT));
  return out;
}

/**
 * La forma de los huecos: en un bloque con fotos, cada foto tiene un texto (aunque sea vacío) a cada lado y no
 * hay dos textos seguidos. Devuelve los bloques que no la cumplen.
 */
export function brokenGaps(doc: Y.Doc): string[] {
  return storedInline(doc).filter((line) => {
    const parts = line.split(' ').map((p) => (p.startsWith('"') ? 't' : p));
    if (!parts.includes(`<${PHOTO}>`)) return false;
    return parts.some((p, i) => (p === `<${PHOTO}>` ? parts[i - 1] !== 't' || parts[i + 1] !== 't' : p === 't' && parts[i + 1] === 't'));
  });
}

export interface ScheduleResult {
  /** Marcas escritas que no están al final. */
  lost: string[];
  /** Marcas escritas que quedaron más de una vez. */
  twice: string[];
  /** Palabras del contenido inicial que no están al final, o que quedaron más de una vez. */
  baseLost: string[];
  baseTwice: string[];
  /** Fotos que tendrían que estar (las del principio y las agregadas, menos las borradas) y no están. */
  photosLost: string[];
  /** Fotos que quedaron más de una vez. */
  photosTwice: string[];
  /** Los dos documentos terminan iguales y cada editor muestra el suyo. */
  same: boolean;
  /** Bloques con fotos que no quedaron con la forma de los huecos. */
  broken: string[];
  final: string;
}

/**
 * Una agenda de dos personas (A y B) sobre una página con el bloque `p0` arriba y `p1` debajo. Cada paso es una
 * letra y quién lo hace (`TA`, `dB`…):
 *
 * - `T` escribe una marca pegada a una foto (si no hay fotos, al principio o al final de un bloque);
 * - `R` escribe una marca justo a la derecha de una foto; `Z`, al final del último bloque;
 * - `W` le cambia el ancho a una foto; `P` agrega una foto pegada a otra (o en un borde del bloque);
 * - `I` agrega una foto en el medio de un texto; `X` borra una foto; `M` mueve una foto a otro hueco;
 * - `N` Enter pegado a una foto; `J` une el último bloque con el de arriba (Backspace al principio);
 * - `H` le cambia el tipo al último bloque (párrafo ↔ título);
 * - `d` entrega al otro lo pendiente de ese lado (como la app: con la reparación de estructura).
 */
export function runSchedule(
  ops: string[],
  initial: PartialBlock[],
  rand: () => number,
  { schemaA = schema as unknown, schemaB = schema as unknown, widths = [0.25, 1 / 3, 0.5, 1] } = {},
): ScheduleResult {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  // El orden en que Yjs resuelve dos cambios en el mismo lugar sale de los ids de cliente: fijos (y con los dos
  // órdenes, según la agenda) para que la misma semilla dé siempre lo mismo.
  const flip = rand() < 0.5;
  docA.clientID = flip ? 2 : 1;
  docB.clientID = flip ? 1 : 2;
  const out = { A: [] as Uint8Array[], B: [] as Uint8Array[] };
  docA.on('update', (u: Uint8Array, o: unknown) => o !== 'remote' && out.A.push(u));
  docB.on('update', (u: Uint8Array, o: unknown) => o !== 'remote' && out.B.push(u));
  const A = mountEditor(docA, 'a', schemaA);
  const B = mountEditor(docB, 'b', schemaB);
  const deliver = (who: 'A' | 'B') => {
    for (const u of out[who].splice(0)) applyLikeApp(who === 'A' ? docB : docA, u);
  };
  A.replaceBlocks(A.document, initial as never);
  deliver('A');
  out.B.length = 0;

  const typed: string[] = [];
  // Las palabras del contenido inicial (cada una distinta, en minúsculas): ningún paso de la agenda las borra.
  const base = yText(docA).split(' | ').flatMap((t) => t.match(/[a-z]{3,}/g) ?? []);
  const expected = new Set(photosIn(A).map((p) => p.name));
  const pick = <T>(list: T[]): T | undefined => list[Math.floor(rand() * list.length)];
  const lastBlock = (E: BlockNoteEditor) => E.document[E.document.length - 1];

  ops.forEach((op, n) => {
    const who = op[1] as 'A' | 'B';
    if (op[0] === 'd') return deliver(who);
    const E = who === 'A' ? A : B;
    const token = `{${who}${n}}`;
    const write = (pos: number | undefined) => {
      if (pos === undefined) return;
      typed.push(token);
      typeAtPos(E, pos, token);
    };
    const add = (pos: number | undefined) => {
      if (pos === undefined) return;
      const name = `${who}f${n}`;
      expected.add(name);
      insertPhotoAt(E, pos, name, pick([0, ...widths]));
    };
    const photos = photosIn(E);
    const ends = textEnds(E);
    switch (op[0]) {
      case 'T':
        return write(pick(photos.length ? gapsIn(E) : ends));
      case 'R': {
        const p = pick(photos);
        return write(p ? p.pos + 1 : undefined);
      }
      case 'Z':
        return write(ends[ends.length - 1]);
      case 'W': {
        const p = pick(photos);
        if (p) setPhotoWidth(E, p.pos, pick(widths.filter((w) => w !== p.w))!);
        return;
      }
      case 'P':
        return add(pick(photos.length ? gapsIn(E) : ends));
      case 'I':
        return add(pick(midTextIn(E)));
      case 'X': {
        const p = pick(photos);
        if (!p) return;
        expected.delete(p.name);
        return deletePhotoAt(E, p.pos);
      }
      case 'M': {
        const p = pick(photos);
        const to = pick(gapsIn(E).filter((g) => p && g !== p.pos && g !== p.pos + 1));
        if (p && to !== undefined) movePhoto(E, p.pos, to);
        return;
      }
      case 'N': {
        const pos = pick(gapsIn(E));
        if (pos === undefined) return;
        caret(E, pos);
        return press(E, 'Enter');
      }
      case 'J': {
        if (E.document.length < 2) return;
        E.setTextCursorPosition(lastBlock(E), 'start');
        return press(E, 'Backspace');
      }
      case 'H': {
        const block = lastBlock(E);
        return void E.updateBlock(block, { type: block.type === 'heading' ? 'paragraph' : 'heading' } as never);
      }
      default:
        throw new Error(`Paso desconocido: ${op}`);
    }
  });
  for (let i = 0; i < 3; i++) {
    deliver('A');
    deliver('B');
  }
  // Todo el texto seguido, sin separar por texto ni por bloque: una marca que quedó partida por una foto o por
  // un Enter de otro (el texto está, en dos pedazos) no cuenta como perdida.
  const final = yText(docA).split(' | ').join('');
  const stored = storedPhotos(docA);
  const result: ScheduleResult = {
    lost: typed.filter((t) => !final.includes(t)),
    twice: typed.filter((t) => final.split(t).length > 2),
    baseLost: base.filter((w) => !final.includes(w)),
    baseTwice: base.filter((w) => final.split(w).length > 2),
    photosLost: [...expected].filter((name) => !stored.includes(name)),
    photosTwice: [...new Set(stored.filter((name, i) => stored.indexOf(name) !== i))],
    same: sameDocs(docA, docB) && showsDoc(A, docA) && showsDoc(B, docB),
    broken: brokenGaps(docA),
    final: storedInline(docA).join(' | ') || final,
  };
  unmountAll();
  docA.destroy();
  docB.destroy();
  return result;
}

export interface Tally {
  schedules: number;
  /** Agendas con alguna marca perdida, con alguna duplicada, con alguna foto perdida o duplicada. */
  lost: number;
  twice: number;
  /** Agendas en las que se perdió o se duplicó texto del contenido inicial. */
  baseLost: number;
  baseTwice: number;
  photosLost: number;
  photosTwice: number;
  /** Agendas que no terminan iguales, o con un bloque sin la forma de los huecos. */
  different: number;
  broken: number;
  /** Las primeras agendas con algún problema, para verlas. */
  examples: string[];
}

/** Corre `count` agendas al azar (con semilla) hechas con las letras de `alphabet` y cuenta las que tienen problemas. */
export async function tally(
  seed: number,
  count: number,
  alphabet: string[],
  initial: () => PartialBlock[],
  options: Parameters<typeof runSchedule>[3] = {},
): Promise<Tally> {
  const rand = seeded(seed);
  const t: Tally = { schedules: count, lost: 0, twice: 0, baseLost: 0, baseTwice: 0, photosLost: 0, photosTwice: 0, different: 0, broken: 0, examples: [] };
  for (let i = 0; i < count; i++) {
    const len = 6 + Math.floor(rand() * 14);
    const sch = Array.from({ length: len }, () => alphabet[Math.floor(rand() * alphabet.length)]);
    const r = runSchedule(sch, initial(), seeded(Math.floor(rand() * 1e9)), options);
    // Deja correr los temporizadores de los editores desmontados: si no, se acumulan (y con ellos la memoria).
    await new Promise((done) => setTimeout(done, 0));
    if (r.lost.length) t.lost++;
    if (r.twice.length) t.twice++;
    if (r.baseLost.length) t.baseLost++;
    if (r.baseTwice.length) t.baseTwice++;
    if (r.photosLost.length) t.photosLost++;
    if (r.photosTwice.length) t.photosTwice++;
    if (!r.same) t.different++;
    if (r.broken.length) t.broken++;
    if ((r.lost.length || r.twice.length || r.baseLost.length || r.baseTwice.length || r.photosLost.length || r.photosTwice.length || !r.same) && t.examples.length < 3)
      t.examples.push(`${sch.join(' ')} => perdió ${r.lost} ${r.baseLost} dos veces ${r.twice} ${r.baseTwice} fotos ${r.photosLost}/${r.photosTwice} iguales ${r.same}: ${r.final}`);
  }
  return t;
}
