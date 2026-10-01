// Ayudas para las pruebas de las fotos en línea (inlinePhoto*.test.ts, collabPhotos*.test.ts). Solo las usan
// las pruebas; la app no las importa. Ver Docs/Doc_Fotos_En_Linea.md y Docs/Doc_Colaboracion.md.
import { BlockNoteSchema, defaultInlineContentSpecs, type BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { TextSelection } from '@tiptap/pm/state';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { applyLikeApp, mountEditor, press, sameDocs, seeded, showsDoc, unmountAll, view, yText } from './collabHarness';
import { appBlockSpecs, schema } from './editorSchema';
import { GAP_TEXT_SPEC, PHOTO, PhotoNode, photoSpec } from './inlinePhoto';
import { STABLE_GAPS_MARKER } from './unknownContent';

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

/** Las fotos en línea que muestra el editor, en orden (o los nodos en línea de otro tipo, como `hardBreak`). */
export function photosIn(E: BlockNoteEditor, type = PHOTO): { pos: number; name: string; w: number }[] {
  const out: { pos: number; name: string; w: number }[] = [];
  view(E).state.doc.descendants((n, pos) => {
    if (n.type.name === type) out.push({ pos, name: String(n.attrs.name), w: Number(n.attrs.w) });
    return true;
  });
  return out;
}

/** Las posiciones pegadas a una foto (justo antes y justo después de cada una), sin repetir. */
export function gapsIn(E: BlockNoteEditor, type = PHOTO): number[] {
  const out = new Set<number>();
  for (const p of photosIn(E, type)) {
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
 * La forma de los huecos estables: en un bloque con fotos, cada foto tiene un texto (aunque sea vacío) a cada
 * lado, todos los textos del bloque llevan la marca `lgaGapText` y el bloque tiene su marca de renglón
 * (`lgaStableGaps`, que no cuenta como vecino de una foto). Puede haber varios textos seguidos (lo que queda al
 * borrar una foto: no se juntan). Un bloque sin fotos con textos marcados (le borraron las fotos) también tiene
 * que tener la marca de renglón: es lo que no deja abrirlo a una versión anterior. Devuelve los bloques que no la
 * cumplen, como los muestra `storedInline` (con `*` en un texto sin la marca).
 */
export function brokenGaps(doc: Y.Doc): string[] {
  const out: string[] = [];
  const walk = (el: Y.XmlElement | Y.XmlFragment) => {
    const all = el.toArray();
    const isMarker = (c: unknown) => c instanceof Y.XmlElement && c.nodeName === STABLE_GAPS_MARKER;
    const children = all.filter((c) => !isMarker(c));
    const isPhoto = (c: unknown) => c instanceof Y.XmlElement && c.nodeName === PHOTO;
    const marked = children.some((c) => c instanceof Y.XmlText && c.getAttribute(GAP_TEXT_SPEC) === true);
    if (children.some(isPhoto) || marked) {
      const bad =
        !all.some(isMarker) ||
        children.some(
          (c, i) =>
            (isPhoto(c) && (!(children[i - 1] instanceof Y.XmlText) || !(children[i + 1] instanceof Y.XmlText))) ||
            (c instanceof Y.XmlText && c.getAttribute(GAP_TEXT_SPEC) !== true),
        );
      if (bad)
        out.push(
          all
            .map((c) =>
              c instanceof Y.XmlText
                ? `${c.getAttribute(GAP_TEXT_SPEC) === true ? '' : '*'}${JSON.stringify(c.toString().replace(/<[^>]+>/g, ''))}`
                : `<${(c as Y.XmlElement).nodeName}>`,
            )
            .join(' '),
        );
      return;
    }
    for (const c of children) if (c instanceof Y.XmlElement) walk(c);
  };
  walk(doc.getXmlFragment(CONTENT_FRAGMENT));
  return out;
}

/**
 * Las marcas perdidas de las que no quedan ni las letras. Una marca puede no estar tal cual y tener todas sus
 * letras en el documento, desordenadas o partidas (`7}{A` por `{A7}`, o `7}{A3}{A` con otra en el medio): pasa
 * cuando el otro borra o se lleva el texto pegado a donde se escribió y lo escrito empezaba igual que ese texto
 * (la comparación por letras pone lo nuevo donde termina lo que coincide). Se sacan del texto las marcas que
 * quedaron enteras y se buscan las letras de cada marca perdida entre las que sobran (`{`, `}`, `A`, `B` y
 * números: el texto inicial es de minúsculas).
 */
export function lettersGone(text: string, typed: string[]): string[] {
  const intact = typed.filter((t) => text.includes(t)).sort((a, b) => b.length - a.length);
  const rest = intact.reduce((t, m) => t.split(m).join('|'), text);
  const pool = new Map<string, number>();
  for (const ch of rest) if (/[{}AB0-9]/.test(ch)) pool.set(ch, (pool.get(ch) ?? 0) + 1);
  return typed
    .filter((t) => !text.includes(t))
    .filter((t) => {
      const need = new Map<string, number>();
      for (const ch of t) need.set(ch, (need.get(ch) ?? 0) + 1);
      if ([...need].some(([ch, n]) => (pool.get(ch) ?? 0) < n)) return true;
      for (const [ch, n] of need) pool.set(ch, pool.get(ch)! - n);
      return false;
    });
}

export interface ScheduleResult {
  /** Marcas escritas que no están al final. */
  lost: string[];
  /** De esas, las que no tienen ni sus letras en el documento (`lettersGone`): letras perdidas de verdad. */
  gone: string[];
  /** Marcas escritas que quedaron más de una vez. */
  twice: string[];
  /** Palabras del contenido inicial que no están al final, o que quedaron más de una vez. */
  baseLost: string[];
  baseTwice: string[];
  /** Fotos que tendrían que estar (las del principio y las agregadas, menos las borradas) y no están. */
  photosLost: string[];
  /** Fotos que quedaron más de una vez. */
  photosTwice: string[];
  /** Saltos de línea de más (positivo) o de menos (negativo) que los del principio más los agregados. */
  breaks: number;
  /** Los dos documentos terminan iguales y cada editor muestra el suyo. */
  same: boolean;
  /** Después de entregar todo, nadie vuelve a escribir (no hay un ida y vuelta de arreglos entre los dos). */
  settled: boolean;
  /** Bloques con fotos que no quedaron con la forma de los huecos. */
  broken: string[];
  final: string;
  /** Todo el texto seguido (para buscar las letras de una marca que no quedó tal cual). */
  text: string;
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
 * - `K` Shift+Enter (un salto de línea) pegado a una foto o a otro salto, o en un borde de un bloque;
 * - `d` entrega al otro lo pendiente de ese lado (como la app: con la reparación de estructura).
 *
 * Con `around: 'hardBreak'`, "pegado a una foto" pasa a ser "pegado a un salto de línea".
 */
export function runSchedule(
  ops: string[],
  initial: PartialBlock[],
  rand: () => number,
  {
    schemaA = schema as unknown,
    schemaB = schema as unknown,
    widths = [0.25, 1 / 3, 0.5, 1],
    around = PHOTO,
    trace = undefined as ((step: string, a: string, b: string) => void) | undefined,
  } = {},
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
  const countBreaks = (doc: Y.Doc) => storedInline(doc).join(' ').split('<hardBreak>').length - 1;
  let breaks = countBreaks(docA);
  // Las palabras del contenido inicial (cada una distinta, en minúsculas): ningún paso de la agenda las borra.
  const base = yText(docA).split(' | ').flatMap((t) => t.match(/[a-z]{3,}/g) ?? []);
  const expected = new Set(photosIn(A).map((p) => p.name));
  const pick = <T>(list: T[]): T | undefined => list[Math.floor(rand() * list.length)];
  const lastBlock = (E: BlockNoteEditor) => E.document[E.document.length - 1];

  // Para mirar una agenda paso a paso (solo al investigar): lo guardado en cada lado después de cada paso.
  const shown = (d: Y.Doc) => {
    const out: string[] = [];
    const walk = (el: Y.XmlElement | Y.XmlFragment) => {
      const children = el.toArray();
      if (children.some((c) => c instanceof Y.XmlText) || (el instanceof Y.XmlElement && el.nodeName === 'paragraph'))
        out.push(
          children
            .map((c) => (c instanceof Y.XmlText ? JSON.stringify(c.toString().replace(/<[^>]+>/g, '')) : `<${String((c as Y.XmlElement).getAttribute('name') ?? (c as Y.XmlElement).nodeName)}>`))
            .join(''),
        );
      else for (const c of children) if (c instanceof Y.XmlElement) walk(c);
    };
    walk(d.getXmlFragment(CONTENT_FRAGMENT));
    return out.join(' | ');
  };
  const step = (op: string) => trace?.(op, shown(docA), shown(docB));
  ops.forEach((op, n) => {
    doStep(op, n);
    step(op);
  });
  function doStep(op: string, n: number): void {
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
    const near = gapsIn(E, around);
    switch (op[0]) {
      case 'T':
        return write(pick(near.length ? near : ends));
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
      case 'K': {
        const pos = pick([...near, ...ends]);
        if (pos === undefined) return;
        const v = view(E);
        breaks++;
        return v.dispatch(v.state.tr.insert(pos, v.state.schema.nodes.hardBreak.create()));
      }
      default:
        throw new Error(`Paso desconocido: ${op}`);
    }
  }
  for (let i = 0; i < 3; i++) {
    deliver('A');
    deliver('B');
    step('fin dA dB');
  }
  const settled = out.A.length === 0 && out.B.length === 0;
  // Todo el texto seguido, sin separar por texto ni por bloque: una marca que quedó partida por una foto o por
  // un Enter de otro (el texto está, en dos pedazos) no cuenta como perdida.
  const final = yText(docA).split(' | ').join('');
  const stored = storedPhotos(docA);
  // El texto inicial, sin las marcas: una marca que quedó en el medio de una palabra no la cuenta como perdida.
  const plain = final.replace(/\{[AB]\d+\}/g, '');
  const result: ScheduleResult = {
    lost: typed.filter((t) => !final.includes(t)),
    gone: lettersGone(final, typed),
    twice: typed.filter((t) => final.split(t).length > 2),
    baseLost: base.filter((w) => !plain.includes(w)),
    baseTwice: base.filter((w) => plain.split(w).length > 2),
    photosLost: [...expected].filter((name) => !stored.includes(name)),
    photosTwice: [...new Set(stored.filter((name, i) => stored.indexOf(name) !== i))],
    breaks: countBreaks(docA) - breaks,
    same: sameDocs(docA, docB) && showsDoc(A, docA) && showsDoc(B, docB),
    settled,
    broken: brokenGaps(docA),
    final: storedInline(docA).join(' | ') || final,
    text: final,
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
  /** Agendas con alguna marca perdida de verdad (no solo con las letras desordenadas o partidas). */
  gone: number;
  twice: number;
  /** Agendas en las que se perdió o se duplicó texto del contenido inicial. */
  baseLost: number;
  baseTwice: number;
  photosLost: number;
  photosTwice: number;
  /** Agendas en las que se perdió o se duplicó un salto de línea. */
  breaks: number;
  /** Agendas que no terminan iguales, que no se aquietan, o con un bloque sin la forma de los huecos. */
  different: number;
  unsettled: number;
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
  const t: Tally = { schedules: count, lost: 0, gone: 0, twice: 0, baseLost: 0, baseTwice: 0, photosLost: 0, photosTwice: 0, breaks: 0, different: 0, unsettled: 0, broken: 0, examples: [] };
  for (let i = 0; i < count; i++) {
    const len = 6 + Math.floor(rand() * 14);
    const sch = Array.from({ length: len }, () => alphabet[Math.floor(rand() * alphabet.length)]);
    const r = runSchedule(sch, initial(), seeded(Math.floor(rand() * 1e9)), options);
    // Deja correr los temporizadores de los editores desmontados: si no, se acumulan (y con ellos la memoria).
    await new Promise((done) => setTimeout(done, 0));
    if (r.lost.length) t.lost++;
    if (r.gone.length) t.gone++;
    if (r.twice.length) t.twice++;
    if (r.baseLost.length) t.baseLost++;
    if (r.baseTwice.length) t.baseTwice++;
    if (r.photosLost.length) t.photosLost++;
    if (r.photosTwice.length) t.photosTwice++;
    if (r.breaks !== 0) t.breaks++;
    if (!r.same) t.different++;
    if (!r.settled) t.unsettled++;
    if (r.broken.length) t.broken++;
    if ((r.lost.length || r.twice.length || r.baseLost.length || r.baseTwice.length || r.photosLost.length || r.photosTwice.length || !r.same) && t.examples.length < 3)
      t.examples.push(`${sch.join(' ')} => perdió ${r.lost} ${r.baseLost} dos veces ${r.twice} ${r.baseTwice} fotos ${r.photosLost}/${r.photosTwice} iguales ${r.same}: ${r.final}`);
  }
  return t;
}

// --- Los límites conocidos (collabPhotosLimits.test.ts y collabPhotosNoGaps.test.ts) ----------------------
//
// Lo que SÍ puede perder editar a la vez un renglón con fotos en línea, con el número medido en 300 agendas al
// azar por caso (semilla 9000 + el número del caso): con los huecos estables (lo que guarda la app) y sin el
// texto de los huecos. Cada número es la cantidad de agendas con algo de eso: `lost`/`twice`, alguna marca
// escrita que no está tal cual o que está dos veces; `gone`, de esas, las que tienen una marca de la que no
// quedan ni las letras (`lost` sin `gone` es una marca con las letras desordenadas, ver `lettersGone`);
// `baseLost`/`baseTwice`, texto que ya estaba; `photosLost`/`photosTwice`, una foto que nadie borró y no está,
// o que quedó dos veces. La tabla está en Docs/Doc_Colaboracion.md.

const top = para('p0', ['top']);
const row3 = () => [top, para('p1', [photo('F1'), photo('F2'), photo('F3')])];
const mixed = () => [top, para('p1', ['abc', photo('F1'), 'def', photo('F2')])];

export type Counts = Pick<Tally, 'lost' | 'gone' | 'twice' | 'baseLost' | 'baseTwice' | 'photosLost' | 'photosTwice'>;
export const losses = (t: Tally): Counts => ({
  lost: t.lost,
  gone: t.gone,
  twice: t.twice,
  baseLost: t.baseLost,
  baseTwice: t.baseTwice,
  photosLost: t.photosLost,
  photosTwice: t.photosTwice,
});
const c = (lost: number, gone: number, twice = 0, baseLost = 0, baseTwice = 0, photosLost = 0, photosTwice = 0): Counts => ({
  lost,
  gone,
  twice,
  baseLost,
  baseTwice,
  photosLost,
  photosTwice,
});

export interface Limit {
  name: string;
  alphabet: string[];
  initial: () => ReturnType<typeof para>[];
  /** Con el texto de los huecos (lo que guarda la app) y sin él. */
  gaps: Counts;
  noGaps: Counts;
}

export const limits: Limit[] = [
  {
    name: 'A escribe justo a la derecha de una foto, B borra fotos ([foto][foto][foto])',
    alphabet: ['RA', 'RA', 'XB', 'dA', 'dB'],
    initial: row3,
    gaps: c(0, 0),
    noGaps: c(40, 40, 3),
  },
  {
    name: 'A escribe pegado a una foto, B borra fotos ("abc"[foto]"def"[foto])',
    alphabet: ['TA', 'TA', 'XB', 'dA', 'dB'],
    initial: mixed,
    gaps: c(0, 0),
    noGaps: c(167, 167),
  },
  {
    name: 'A escribe justo a la derecha de una foto, B mueve fotos ([foto][foto][foto])',
    alphabet: ['RA', 'RA', 'MB', 'dA', 'dB'],
    initial: row3,
    gaps: c(0, 0),
    noGaps: c(87, 87, 1),
  },
  {
    name: 'A escribe pegado a una foto, B mueve fotos ("abc"[foto]"def"[foto])',
    alphabet: ['TA', 'TA', 'MB', 'dA', 'dB'],
    initial: mixed,
    gaps: c(0, 0),
    noGaps: c(166, 166, 5, 2, 0, 3, 3),
  },
  {
    name: 'A escribe pegado a una foto, B aprieta Enter pegado a una foto',
    alphabet: ['TA', 'TA', 'NB', 'dA', 'dB'],
    initial: mixed,
    gaps: c(41, 0),
    noGaps: c(139, 139),
  },
  {
    name: 'A escribe al final, B pone fotos en el medio del texto',
    alphabet: ['ZA', 'ZA', 'IB', 'dA', 'dB'],
    initial: () => [top, para('p1', ['abcdefghijkl'])],
    gaps: c(0, 0),
    noGaps: c(0, 0),
  },
  {
    name: 'los dos borran fotos de "abc"[foto]"def"[foto]"ghi"[foto]"jkl"',
    alphabet: ['XA', 'XB', 'dA', 'dB'],
    initial: () => [top, para('p1', ['abc', photo('F1'), 'def', photo('F2'), 'ghi', photo('F3'), 'jkl'])],
    gaps: c(0, 0),
    noGaps: c(0, 0, 0, 53, 139),
  },
  {
    name: 'A une el renglón con el de arriba (Backspace), B pega fotos en él',
    alphabet: ['JA', 'PB', 'PB', 'dA', 'dB'],
    initial: () => [top, para('p1', ['abc', photo('F1')])],
    gaps: c(0, 0, 0, 0, 0, 227),
    noGaps: c(0, 0, 0, 0, 0, 227),
  },
  {
    name: 'A le cambia el tipo al renglón, B pega fotos en él',
    alphabet: ['HA', 'PB', 'PB', 'dA', 'dB'],
    initial: () => [top, para('p1', ['abc', photo('F1')])],
    gaps: c(0, 0, 0, 0, 0, 261),
    noGaps: c(0, 0, 0, 0, 0, 261),
  },
  {
    name: 'A une el renglón con el de arriba, B escribe pegado a sus fotos',
    alphabet: ['JA', 'TB', 'TB', 'dA', 'dB'],
    initial: mixed,
    gaps: c(231, 231),
    noGaps: c(231, 231),
  },
  {
    name: 'de todo un poco: escribir, agregar, cambiar el ancho, borrar, mover y Enter, los dos',
    alphabet: ['TA', 'TB', 'TA', 'TB', 'TA', 'TB', 'TA', 'TB', 'PA', 'PB', 'WA', 'WB', 'XA', 'XB', 'MA', 'MB', 'NA', 'NB', 'dA', 'dB', 'dA', 'dB', 'dA', 'dB'],
    initial: mixed,
    gaps: c(7, 0, 6, 0, 13, 0, 39),
    noGaps: c(101, 101, 18, 0, 72, 19, 33),
  },
];
