// @vitest-environment jsdom
import type { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { mountEditor, pmFromY, seeded, showsDoc, unmountAll, view } from './collabHarness';
import { GAP_TEXT_SPEC } from './inlinePhoto';
import { photo } from './photoHarness';
import { STABLE_GAPS_MARKER } from './unknownContent';

// Las marcas (link, negrita, colores) de un renglón no cambian cuando se edita OTRO bloque, y una corrección de
// marcas hecha en el editor llega al Y.Doc (Docs/Doc_Colaboracion.md, "Marcas que no se escribían"). Lo encontró la
// limpieza de los planes de VLLF (2026-11-05): la tarjeta de Drive del Día 09 quedó con las últimas letras fuera del
// link y en negrita, y corregirla desde el editor no llegaba al documento.
//
// La causa: y-prosemirror compara las marcas de cada tramo buscando cada una por nombre, y una que falta en el editor
// se comparaba con «nada», que da igual a una marca sin atributos (negrita, cursiva). Un tramo en negrita valía lo
// mismo que uno con link, y no se escribía. En un renglón con huecos estables (patches/y-prosemirror+1.3.7.patch)
// pasaba sobre todo cuando y-prosemirror reescribe un bloque con el contenido de otro (borrar o insertar bloques antes
// reescribe los de después por posición): cada Y.XmlText recibe su parte del texto nuevo y sus marcas se corrigen
// solo si la comparación dice que cambiaron.

afterEach(unmountAll);

const LINK = 'https://drive.google.com/open?id=1G43fjEssDZaCO8mf20Yp1uxhyQrnCuu8&usp=drive_fs';

function docWith(blocks: PartialBlock[]): Y.Doc {
  const doc = new Y.Doc();
  const E = mountEditor(doc, 'x');
  E.replaceBlocks(E.document, blocks as never);
  unmountAll();
  return doc;
}

const containers = (doc: Y.Doc) => (doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).toArray() as Y.XmlElement[];
const contentById = (doc: Y.Doc, id: string) => containers(doc).find((bc) => bc.getAttribute('id') === id)!.get(0) as Y.XmlElement;

type Delta = { insert: string; attributes?: Record<string, unknown> }[];

/**
 * Cada bloque por id: su tipo, sus atributos, sus elementos y sus tramos con marcas. Los tramos seguidos con las
 * mismas marcas van juntos aunque estén en dos Y.XmlText (el editor los lee como uno), y la marca del renglón no
 * cuenta (un bloque que y-prosemirror reescribe por posición puede quedar con ella: no cambia lo que se lee).
 */
function shape(doc: Y.Doc): Record<string, string> {
  const out: Record<string, string> = {};
  for (const bc of containers(doc)) {
    const content = bc.get(0) as Y.XmlElement;
    const parts: string[] = [];
    let runs: [string, string][] = [];
    const flush = () => {
      for (const [t, k] of runs) parts.push(`${JSON.stringify(t)}${k}`);
      runs = [];
    };
    for (const c of content.toArray()) {
      if (c instanceof Y.XmlText) {
        for (const d of c.toDelta() as Delta) {
          const k = JSON.stringify(Object.keys(d.attributes ?? {}).sort().map((x) => [x, d.attributes![x]]));
          if (runs.length && runs[runs.length - 1][1] === k) runs[runs.length - 1][0] += d.insert;
          else runs.push([d.insert, k]);
        }
      } else if ((c as Y.XmlElement).nodeName !== STABLE_GAPS_MARKER) {
        flush();
        parts.push(`<${(c as Y.XmlElement).nodeName}>`);
      }
    }
    flush();
    out[String(bc.getAttribute('id'))] = `${content.nodeName}${JSON.stringify(content.getAttributes())} ${parts.join(' ')}`;
  }
  return out;
}

const text = (t: string, styles = {}) => ({ type: 'text', text: t, styles });
const link = (t: string, styles = {}) => ({ type: 'link', href: LINK, content: [text(t, styles)] });

/**
 * Un plan del día como el del Día 09 de VLLF: una fila de fotos, un texto con link, un renglón con una foto y texto en
 * negrita (su elemento de Yjs es el que recibe la tarjeta cuando se borra un bloque de arriba), la tarjeta, un vacío y un
 * título.
 */
function page(driveCard: boolean): PartialBlock[] {
  return [
    { id: 'p0', type: 'paragraph', content: [text('top')] },
    { id: 'row', type: 'paragraph', content: [photo('F1'), text('\n'), photo('F2')] },
    { id: 'txt', type: 'paragraph', content: [text('Los últimos shots: ', { bold: true }), link(LINK)] },
    { id: 'photos', type: 'paragraph', content: [text('abc'), photo('F0'), text('def', { bold: true })] },
    { id: 'card', type: 'paragraph', props: { driveCard }, content: [link(LINK)] },
    { id: 'empty', type: 'paragraph', content: [] },
    { id: 'h', type: 'heading', props: { level: 3 }, content: [text('Plano 01:', { textColor: 'pink' })] },
    { id: 'deco', type: 'paragraph', content: [text('Decorado', { bold: true }), text(' nota', { italic: true })] },
    { id: 'tail', type: 'paragraph', content: [text('fin')] },
  ] as never;
}

/**
 * Cómo está guardada la tarjeta: como la escribe el editor (`plain`), con la marca del renglón y los textos marcados
 * (`marker`), o además con su texto en varios Y.XmlText, uno vacío (`split`: lo que dejan los huecos estables).
 */
function storeCard(doc: Y.Doc, how: 'plain' | 'marker' | 'split'): void {
  if (how === 'plain') return;
  const el = contentById(doc, 'card');
  const delta = (el.get(0) as Y.XmlText).toDelta() as Delta;
  const whole = delta.map((d) => d.insert).join('');
  const attrs = delta[0].attributes;
  const cuts = how === 'split' ? [0, 30, 30, whole.length - 4, whole.length] : [0, whole.length];
  doc.transact(() => {
    el.delete(0, el.length);
    const texts = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const t = new Y.XmlText();
      const piece = whole.slice(cuts[i], cuts[i + 1]);
      if (piece) t.insert(0, piece, attrs);
      t.setAttribute(GAP_TEXT_SPEC, true as never);
      texts.push(t);
    }
    el.insert(0, [new Y.XmlElement(STABLE_GAPS_MARKER), ...texts]);
  });
}

const edits: Record<string, (E: BlockNoteEditor) => string[]> = {
  'borrar la fila de fotos': (E) => {
    E.removeBlocks(['row']);
    return [];
  },
  'borrar la fila de fotos y el renglón vacío': (E) => {
    E.removeBlocks(['row', 'empty']);
    return [];
  },
  'borrar el texto con link': (E) => {
    E.removeBlocks(['txt']);
    return [];
  },
  'cambiar el nivel del título': (E) => {
    E.updateBlock('h', { props: { level: 2 } } as never);
    return ['h'];
  },
  'insertar dos renglones vacíos antes del título': (E) => {
    E.insertBlocks([{ type: 'paragraph' }, { type: 'paragraph' }] as never, 'h', 'before');
    return [];
  },
  'todo junto, en una transacción': (E) => {
    E.transact(() => {
      E.updateBlock('h', { props: { level: 2 } } as never);
      E.insertBlocks([{ type: 'paragraph' }, { type: 'paragraph' }] as never, 'h', 'before');
      E.removeBlocks(['row', 'empty']);
    });
    return ['h'];
  },
};

describe('editar otro bloque no cambia las marcas de la tarjeta de Drive ni de sus vecinos', () => {
  for (const driveCard of [true, false]) {
    for (const how of ['plain', 'marker', 'split'] as const) {
      for (const [name, edit] of Object.entries(edits)) {
        it(`${name} (driveCard ${driveCard}, ${how})`, () => {
          const doc = docWith(page(driveCard));
          storeCard(doc, how);
          const before = shape(doc);
          const E = mountEditor(doc);
          const changed = edit(E);
          const after = shape(doc);
          for (const id of Object.keys(after)) {
            if (changed.includes(id) || !(id in before)) continue;
            expect(`${id}: ${after[id]}`).toBe(`${id}: ${before[id]}`);
          }
          expect(showsDoc(E, doc)).toBe(true);
        });
      }
    }
  }
});

it('un renglón con fotos reescrito con el contenido del de abajo (texto en negrita y link) queda con esas marcas', () => {
  // Borrar `a` y `row` hace que y-prosemirror escriba en el elemento de Yjs de `photos` (con la marca, "abc" [foto]
  // "def" en negrita) el contenido de `card`. Antes, la parte del link que caía en el texto "def" quedaba en negrita.
  const doc = docWith([
    { id: 'p0', type: 'paragraph', content: [text('top')] },
    { id: 'a', type: 'paragraph', content: [text('Los últimos: ', { bold: true }), link(LINK)] },
    { id: 'photos', type: 'paragraph', content: [text('abc'), photo('F1'), text('def', { bold: true })] },
    { id: 'card', type: 'paragraph', content: [text('Los últimos: ', { bold: true }), link(LINK)] },
    { id: 'empty', type: 'paragraph', content: [] },
    { id: 'row', type: 'paragraph', content: [photo('F2'), text('\n'), photo('F3')] },
    { id: 'e1', type: 'paragraph', content: [] },
    { id: 'h', type: 'heading', props: { level: 2 }, content: [text('Plano 01:')] },
  ] as never);
  const before = shape(doc);
  const E = mountEditor(doc);
  E.removeBlocks(['a', 'row']);
  const after = shape(doc);
  for (const id of Object.keys(after)) expect(`${id}: ${after[id]}`).toBe(`${id}: ${before[id]}`);
  expect(showsDoc(E, doc)).toBe(true);
});

/** Un renglón con la marca y su texto en dos Y.XmlText, con las marcas corridas como quedó la tarjeta del Día 09. */
function brokenCard(): Y.Doc {
  const doc = docWith([
    { id: 'p0', type: 'paragraph', content: [text('top')] },
    { id: 'card', type: 'paragraph', props: { driveCard: true }, content: [link(LINK)] },
  ] as never);
  const el = contentById(doc, 'card');
  doc.transact(() => {
    el.delete(0, el.length);
    const a = new Y.XmlText();
    a.insert(0, LINK.slice(0, -4), { link: { href: LINK } });
    a.setAttribute(GAP_TEXT_SPEC, true as never);
    const b = new Y.XmlText();
    b.insert(0, LINK.slice(-4), { bold: {} });
    b.setAttribute(GAP_TEXT_SPEC, true as never);
    el.insert(0, [new Y.XmlElement(STABLE_GAPS_MARKER), a, b]);
  });
  return doc;
}

describe('una corrección de marcas hecha en el editor llega al Y.Doc', () => {
  it('en un renglón con la marca y el texto en dos Y.XmlText (la tarjeta del Día 09)', () => {
    const doc = brokenCard();
    const E = mountEditor(doc);
    let from = 0;
    let to = 0;
    view(E).state.doc.descendants((n, pos) => {
      if (n.type.name === 'paragraph' && n.attrs.driveCard) {
        from = pos + 1;
        to = pos + n.nodeSize - 1;
      }
      return true;
    });
    const { schema } = view(E).state;
    const tr = view(E).state.tr.removeMark(from, to, schema.marks.bold).addMark(from, to, schema.marks.link.create({ href: LINK }));
    view(E).dispatch(tr);
    expect(shape(doc).card).toBe(
      `paragraph${JSON.stringify(contentById(doc, 'card').getAttributes())} ${JSON.stringify(LINK)}[["link",{"href":${JSON.stringify(LINK)}}]]`,
    );
    expect(showsDoc(E, doc)).toBe(true);
  });

  it('en un renglón común: cambiar negrita por cursiva en un solo paso', () => {
    const doc = docWith([{ id: 'p0', type: 'paragraph', content: [text('abc', { bold: true })] }] as never);
    const E = mountEditor(doc);
    const { schema } = view(E).state;
    // doc > blockGroup > blockContainer > paragraph: el texto va de 3 a 6.
    expect(view(E).state.doc.textBetween(3, 6)).toBe('abc');
    const tr = view(E).state.tr.removeMark(3, 6, schema.marks.bold).addMark(3, 6, schema.marks.italic.create());
    view(E).dispatch(tr);
    expect((contentById(doc, 'p0').get(0) as Y.XmlText).toDelta()).toEqual([{ insert: 'abc', attributes: { italic: {} } }]);
    expect(showsDoc(E, doc)).toBe(true);
  });
});

describe('al azar: después de cada edición de bloques, el Y.Doc se lee igual que el editor', () => {
  const kinds = (rnd: () => number, i: number): PartialBlock => {
    const id = `b${i}`;
    switch (Math.floor(rnd() * 8)) {
      case 0:
        return { id, type: 'paragraph', content: [photo(`F${i}`), text('\n'), photo(`G${i}`)] } as never;
      case 1:
        return { id, type: 'paragraph', content: [text('Los últimos: ', { bold: true }), link(LINK)] } as never;
      case 2:
        return { id, type: 'paragraph', props: { driveCard: true }, content: [link(LINK)] } as never;
      case 3:
        return { id, type: 'paragraph', content: [] } as never;
      case 4:
        return { id, type: 'heading', props: { level: 3 }, content: [text(`Plano 0${i}:`, { textColor: 'pink' })] } as never;
      case 5:
        return { id, type: 'paragraph', content: [text(`Decorado ${i}`, { bold: true }), text(' nota', { italic: true })] } as never;
      case 6:
        return { id, type: 'paragraph', content: [text(`abc${i}`), photo(`H${i}`), text('def', { bold: true })] } as never;
      default:
        return { id, type: 'paragraph', content: [text(`texto ${i}`)] } as never;
    }
  };

  it('60 páginas, 6 ediciones cada una (borrar, cambiar niveles, sumar renglones vacíos)', () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 60; seed++) {
      const rnd = seeded(seed);
      const doc = docWith(Array.from({ length: 12 }, (_, i) => kinds(rnd, i)));
      const E = mountEditor(doc);
      const log: string[] = [];
      for (let step = 0; step < 6; step++) {
        const ids = E.document.map((b) => b.id);
        const r = Math.floor(rnd() * 5);
        E.transact(() => {
          if (r === 0) {
            const n = 1 + Math.floor(rnd() * 3);
            const del = ids.filter(() => rnd() < n / ids.length).slice(0, n);
            if (del.length && del.length < ids.length) E.removeBlocks(del);
            log.push(`borrar ${del}`);
          } else if (r === 1) {
            for (const b of E.document.filter((x) => x.type === 'heading')) if (rnd() < 0.6) E.updateBlock(b.id, { props: { level: 2 } } as never);
            log.push('niveles');
          } else if (r === 2) {
            for (const b of E.document.filter((x) => x.type === 'heading'))
              if (rnd() < 0.6) E.insertBlocks([{ type: 'paragraph' }, { type: 'paragraph' }] as never, b.id, 'before');
            log.push('aire');
          } else if (r === 3) {
            const id = ids[Math.floor(rnd() * ids.length)];
            E.insertBlocks([{ type: 'paragraph' }] as never, id, 'after');
            log.push(`vacío después de ${id}`);
          } else {
            const id = ids[Math.floor(rnd() * ids.length)];
            if (ids.length > 1) E.removeBlocks([id]);
            log.push(`borrar ${id}`);
          }
        });
        if (!view(E).state.doc.eq(pmFromY(E, doc))) {
          bad.push(`semilla ${seed}: ${log.join(' | ')}`);
          break;
        }
      }
      unmountAll();
    }
    expect(bad).toEqual([]);
  });
});
