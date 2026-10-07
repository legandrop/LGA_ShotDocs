// @vitest-environment jsdom
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { mountEditor, press, seeded, unmountAll, view, type Editor } from '../ui/collabHarness';
import { PHOTO } from '../ui/inlinePhoto';
import { AdmissionTester, type AdmitVerdict } from './admit';
import { buildCleanBase } from './clean';
import { block, group } from './historyTesting';
import { MAX_GROUP_DEPTH } from './linkShape';
import { normalizeStructure } from './structure';

// Las correcciones de la auditoría de la 2a (Docs/Doc_Link_Publico.md, "Cómo quedó la 2a", correcciones): las
// reproducciones del auditor como pruebas. B1: lo que escribe el editor real en un renglón con fotos en línea (Enter,
// copiar, duplicar una foto, Tab, encabezado) entra; B2: un nodo conocido donde el esquema no lo acepta se aparta; B3: los
// números enormes se apartan (sin montar el editor: un `colspan` de cien millones lo deja sin memoria); B4: mil, tres mil y
// ocho mil niveles se apartan rápido y sin desbordar la pila. Y la corrida al azar del visitante honesto con el editor real,
// con fotos en línea, tablas y listas: nada apartado.

afterEach(() => unmountAll());
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const allowed = (id: string): boolean => id === A;
const reason = (v: AdmitVerdict) => (v.ok ? 'ok' : v.reason);

/** El visitante: arranca de la base limpia y la estructura reparada, con el editor real. */
function visitorFrom(rows: Uint8Array[]): Y.Doc {
  const v = new Y.Doc();
  const b = buildCleanBase(rows);
  Y.applyUpdate(v, b.base);
  b.doc.destroy();
  normalizeStructure(v, 'repair');
  return v;
}

/** La página del equipo, escrita con el editor real. */
async function teamPage(blocks: unknown[]): Promise<Uint8Array[]> {
  const team = new Y.Doc({ gc: false });
  const E = mountEditor(team, 'equipo');
  await tick();
  E.replaceBlocks(E.document, blocks as never);
  await tick();
  unmountAll();
  return [Y.encodeStateAsUpdate(team)];
}

const inline = [
  { type: 'text', text: 'foto uno ', styles: {} },
  { type: PHOTO, props: { url: `sdmedia://${A}`, name: 'a.jpg', w: 0 } },
  { type: 'text', text: ' entre ', styles: {} },
  { type: PHOTO, props: { url: `sdmedia://${A}`, name: 'b.jpg', w: 0 } },
];

function photosOf(e: Editor): number[] {
  const ps: number[] = [];
  view(e).state.doc.descendants((n, pos) => {
    if (n.type.name === PHOTO) ps.push(pos);
    return true;
  });
  return ps;
}
const at = (e: Editor, pos: number) => view(e).dispatch(view(e).state.tr.setSelection(TextSelection.create(view(e).state.doc, pos)));

const gapActions: Record<string, (e: Editor) => void> = {
  tipearAlLado: (e) => {
    at(e, photosOf(e)[0] + 1);
    e.insertInlineContent('X');
  },
  enterEnElMedio: (e) => {
    at(e, photosOf(e)[0] + 3);
    press(e, 'Enter');
  },
  enterAlFinal: (e) => {
    const ps = photosOf(e);
    at(e, ps[ps.length - 1] + 1);
    press(e, 'Enter');
  },
  copiarElRenglon: (e) => {
    const blk = e.document.find((b) => Array.isArray(b.content) && (b.content as { type: string }[]).some((c) => c.type === PHOTO));
    if (blk) e.insertBlocks([{ type: 'paragraph', content: blk.content } as never], blk.id, 'after');
  },
  borrarUnaFoto: (e) => {
    const ps = photosOf(e);
    view(e).dispatch(view(e).state.tr.delete(ps[0], ps[0] + 1));
  },
  cambiarElAncho: (e) => {
    view(e).dispatch(view(e).state.tr.setNodeAttribute(photosOf(e)[0], 'w', 0.5));
  },
  duplicarUnaFoto: (e) => {
    const ps = photosOf(e);
    const node = view(e).state.doc.nodeAt(ps[0])!;
    view(e).dispatch(view(e).state.tr.insert(ps[1] + 1, node.type.create(node.attrs)));
  },
  sangrarConTab: (e) => {
    at(e, photosOf(e)[0] + 3);
    press(e, 'Tab');
  },
  pasarAEncabezado: (e) => {
    const blk = e.document.find((b) => Array.isArray(b.content) && (b.content as { type: string }[]).some((c) => c.type === PHOTO));
    if (blk) e.updateBlock(blk, { type: 'heading', props: { level: 3 } } as never);
  },
};

describe('B1: el visitante honesto en un renglón con fotos en línea (el editor real)', () => {
  for (const inTable of [false, true]) {
    for (const [name, act] of Object.entries(gapActions)) {
      it(`${inTable ? 'en una celda' : 'en un párrafo'}: ${name}`, async () => {
        const blocks: unknown[] = [{ type: 'paragraph', content: 'antes' }];
        if (inTable) blocks.push({ type: 'table', content: { type: 'tableContent', rows: [{ cells: [{ type: 'tableCell', content: inline }, 'otra'] }] } });
        else blocks.push({ type: 'paragraph', content: inline });
        blocks.push({ type: 'bulletListItem', content: 'después' });
        const rows = await teamPage(blocks);
        const v = visitorFrom(rows);
        const e = mountEditor(v, 'visitante');
        await tick();
        const sv = Y.encodeStateVector(v);
        try {
          act(e);
        } catch {
          // Lo que esa acción no puede hacer acá (una celda) no escribe nada.
        }
        await tick();
        const row = Y.encodeStateAsUpdate(v, sv);
        const tester = new AdmissionTester(rows, { mediaAllowed: allowed });
        try {
          expect(tester.test(row)).toMatchObject({ ok: true });
          // Y lo que sigue escribiendo en la misma sesión, también.
          const sv2 = Y.encodeStateVector(v);
          e.insertBlocks([{ type: 'paragraph', content: 'sigue escribiendo' }] as never, e.document[0].id, 'after');
          await tick();
          expect(tester.test(Y.encodeStateAsUpdate(v, sv2))).toMatchObject({ ok: true });
        } finally {
          tester.destroy();
        }
      });
    }
  }
});

// --- B2 y B3: filas hostiles armadas a mano sobre la página del equipo -------------------------------------------------

function teamRows(): Uint8Array[] {
  const d = new Y.Doc({ gc: false });
  group(d).push([
    block('b0', 'texto del equipo cero'),
    block('b1', 'texto del equipo uno', 'heading', { level: '2' }),
    block('b2', 'texto del equipo dos'),
  ]);
  return [Y.encodeStateAsUpdate(d)];
}
const parOf = (v: Y.Doc, i: number) => (group(v).get(i) as Y.XmlElement).get(0) as Y.XmlElement;
function para(text: string, type = 'paragraph'): Y.XmlElement {
  const p = new Y.XmlElement(type);
  const t = new Y.XmlText();
  t.insert(0, text);
  p.insert(0, [t]);
  return p;
}
function table(cell: (c: Y.XmlElement) => void): Y.XmlElement {
  const t = new Y.XmlElement('table');
  const r = new Y.XmlElement('tableRow');
  const c = new Y.XmlElement('tableCell');
  cell(c);
  const tp = new Y.XmlElement('tableParagraph');
  tp.insert(0, [new Y.XmlText()]);
  c.insert(0, [tp]);
  r.insert(0, [c]);
  t.insert(0, [r]);
  const bc = new Y.XmlElement('blockContainer');
  bc.setAttribute('id', 'tbl');
  bc.insert(0, [t]);
  return bc;
}

const hostile: Record<string, (v: Y.Doc) => void> = {
  // B2: un nodo conocido donde el esquema no lo acepta (el editor del equipo borraba el bloque del equipo).
  parrafoEnParrafoDelEquipo: (v) => parOf(v, 0).insert(1, [para('intruso')]),
  bloqueEnEncabezadoDelEquipo: (v) => parOf(v, 1).insert(1, [block('zz', 'intruso')]),
  imagenEnParrafoDelEquipo: (v) => {
    const im = new Y.XmlElement('image');
    im.setAttribute('url', '');
    parOf(v, 2).insert(0, [im]);
  },
  filaDeTablaEnParrafoDelEquipo: (v) => parOf(v, 0).insert(0, [new Y.XmlElement('tableRow')]),
  grupoEnParrafoDelEquipo: (v) => parOf(v, 0).insert(1, [new Y.XmlElement('blockGroup')]),
  fotoAlPrincipioDelBloqueDelEquipo: (v) => {
    const ph = new Y.XmlElement(PHOTO);
    ph.setAttribute('url', `sdmedia://${A}`);
    (group(v).get(0) as Y.XmlElement).insert(0, [ph]);
  },
  encabezadoAdentroDelBloqueDelEquipo: (v) => (group(v).get(0) as Y.XmlElement).insert(1, [para('x', 'heading')]),
  textoSueltoEnElGrupo: (v) => group(v).insert(1, [new Y.XmlText('suelto')]),
  // B3: números que hacen trabajar sin fin al editor.
  tablaColspanEnorme: (v) => group(v).insert(3, [table((c) => c.setAttribute('colspan', 100000000 as never))]),
  tablaColspanCero: (v) => group(v).insert(3, [table((c) => c.setAttribute('colspan', 0 as never))]),
  tablaRowspanNegativo: (v) => group(v).insert(3, [table((c) => c.setAttribute('rowspan', -3 as never))]),
  tablaColwidthLarguisimo: (v) => group(v).insert(3, [table((c) => c.setAttribute('colwidth', Array(5000).fill(100) as never))]),
  previewWidthEnorme: (v) => group(v).insert(3, [block('im', '', 'image', { url: '', previewWidth: '999999999' })]),
  numeroInicioEnorme: (v) => group(v).insert(3, [block('nl', 'uno', 'numberedListItem', { start: '999999999' })]),
};

describe('B2 y B3: filas hostiles nuevas de la auditoría', () => {
  for (const [name, fn] of Object.entries(hostile)) {
    it(name, () => {
      const rows = teamRows();
      const v = visitorFrom(rows);
      const sv = Y.encodeStateVector(v);
      fn(v);
      const row = Y.encodeStateAsUpdate(v, sv);
      const tester = new AdmissionTester(rows);
      try {
        // Sin montar el editor: la de colspan lo deja sin memoria.
        expect(tester.test(row)).toMatchObject({ ok: false, reason: 'bad_shape' });
      } finally {
        tester.destroy();
      }
    });
  }
});

// --- B4: profundidad, armada de a un nivel (sin recursión) ------------------------------------------------------------

function deepRow(v: Y.Doc, depth: number, valid: boolean): Uint8Array {
  const sv = Y.encodeStateVector(v);
  v.transact(() => {
    const g = group(v);
    const first = new Y.XmlElement('blockContainer');
    first.setAttribute('id', 'd0');
    g.insert(3, [first]);
    let cur = g.get(3) as Y.XmlElement;
    for (let i = 1; i <= depth; i++) {
      if (valid) {
        cur.insert(0, [para('n'), new Y.XmlElement('blockGroup')]);
        const sub = cur.get(1) as Y.XmlElement;
        const bc = new Y.XmlElement('blockContainer');
        bc.setAttribute('id', 'd' + i);
        sub.insert(0, [bc]);
        cur = sub.get(0) as Y.XmlElement;
      } else {
        cur.insert(0, [new Y.XmlElement('blockGroup')]);
        cur = cur.get(0) as Y.XmlElement;
      }
    }
    if (valid) cur.insert(0, [para('n')]);
  });
  return Y.encodeStateAsUpdate(v, sv);
}

describe('B4: profundidad sin límite', () => {
  for (const [depth, valid] of [[1000, true], [3000, true], [8000, true], [3000, false], [12000, false]] as [number, boolean][]) {
    it(`${valid ? 'sangría' : 'grupos'} de ${depth} niveles: se aparta rápido, sin desbordar la pila`, () => {
      const rows = teamRows();
      const row = deepRow(visitorFrom(rows), depth, valid);
      const tester = new AdmissionTester(rows);
      const t0 = performance.now();
      try {
        const verdict = tester.test(row);
        expect(reason(verdict)).toBe('too_deep');
      } finally {
        tester.destroy();
      }
      // Antes: 8000 niveles, ~11 s en el hilo del editor que admite.
      expect(performance.now() - t0).toBeLessThan(3000);
    });
  }

  it(`una sangría honesta de ${MAX_GROUP_DEPTH - 10} niveles entra; una de ${MAX_GROUP_DEPTH + 1}, no`, () => {
    const rows = teamRows();
    const ok = new AdmissionTester(rows);
    const no = new AdmissionTester(rows);
    try {
      expect(ok.test(deepRow(visitorFrom(rows), MAX_GROUP_DEPTH - 10, true))).toMatchObject({ ok: true });
      expect(no.test(deepRow(visitorFrom(rows), MAX_GROUP_DEPTH + 1, true))).toMatchObject({ ok: false, reason: 'too_deep' });
    } finally {
      ok.destroy();
      no.destroy();
    }
  });
});

// --- R1 de la re-verificación (entrega 2c): una página del equipo ya más honda que el tope --------------------------

describe('R1: una página del equipo de más de 100 grupos anidados sigue admitiendo lo que no la ahonda', () => {
  /** La página del equipo con una sangría de `depth` niveles (como la arma `deepRow`, pero del equipo). */
  function deepTeam(depth: number): Uint8Array[] {
    const rows = teamRows();
    return [...rows, deepRow(visitorFrom(rows), depth, true)];
  }

  it(`escribir arriba de todo en una página de ${MAX_GROUP_DEPTH + 5} niveles entra; sumarle un nivel más, no`, () => {
    const rows = deepTeam(MAX_GROUP_DEPTH + 5);
    const tester = new AdmissionTester(rows);
    try {
      const v = visitorFrom(rows);
      let sv = Y.encodeStateVector(v);
      (parOf(v, 0).get(0) as Y.XmlText).insert(0, 'arriba ');
      expect(tester.test(Y.encodeStateAsUpdate(v, sv))).toMatchObject({ ok: true });
      // Otra rama igual de honda tampoco la ahonda.
      sv = Y.encodeStateVector(v);
      const same = deepRow(v, MAX_GROUP_DEPTH + 5, true);
      expect(tester.test(same)).toMatchObject({ ok: true });
      // Más honda que lo que ya tenía: se aparta.
      const v2 = visitorFrom(rows);
      expect(tester.test(deepRow(v2, MAX_GROUP_DEPTH + 7, true))).toMatchObject({ ok: false, reason: 'too_deep' });
      void sv;
    } finally {
      tester.destroy();
    }
  });

  it('una página dentro del tope sigue sin dejar pasarlo', () => {
    const rows = deepTeam(MAX_GROUP_DEPTH - 20);
    const tester = new AdmissionTester(rows);
    try {
      const v = visitorFrom(rows);
      expect(tester.test(deepRow(v, MAX_GROUP_DEPTH + 1, true))).toMatchObject({ ok: false, reason: 'too_deep' });
    } finally {
      tester.destroy();
    }
  });
});

// --- Al azar: el visitante honesto con el editor real, con fotos en línea, tablas y listas --------------------------

type Act = (e: Editor, rnd: () => number) => void;
const textPositions = (e: Editor) => {
  const out: number[] = [];
  view(e).state.doc.descendants((n, pos) => {
    if (n.isText) for (let i = 0; i <= n.nodeSize; i++) out.push(pos + i);
    return true;
  });
  return out;
};
const caret = (e: Editor, rnd: () => number) => {
  const ps = textPositions(e);
  if (!ps.length) return false;
  try {
    at(e, ps[Math.floor(rnd() * ps.length)]);
    return true;
  } catch {
    return false;
  }
};
const select2 = (e: Editor) => {
  const { from } = view(e).state.selection;
  try {
    view(e).dispatch(view(e).state.tr.setSelection(TextSelection.create(view(e).state.doc, Math.max(1, from - 2), from)));
  } catch {
    // al principio
  }
};
const acts: Record<string, Act> = {
  type: (e, r) => void (caret(e, r) && e.insertInlineContent('abc')),
  enter: (e, r) => void (caret(e, r) && press(e, 'Enter')),
  backspace: (e, r) => void (caret(e, r) && press(e, 'Backspace')),
  bold: (e, r) => {
    if (caret(e, r)) {
      select2(e);
      e.toggleStyles({ bold: true });
    }
  },
  color: (e, r) => {
    if (caret(e, r)) {
      select2(e);
      e.addStyles({ textColor: 'red' });
    }
  },
  tab: (e, r) => void (caret(e, r) && press(e, 'Tab')),
  heading: (e, r) => {
    const b = e.document[Math.floor(r() * e.document.length)];
    if (b && b.type === 'paragraph') e.updateBlock(b, { type: 'heading', props: { level: 3 } } as never);
  },
  check: (e, r) => {
    const b = e.document.find((x) => x.type === 'checkListItem');
    if (b) e.updateBlock(b, { props: { checked: r() < 0.5 } } as never);
  },
  addImage: (e) => void e.insertBlocks([{ type: 'image' }] as never, e.document[0].id, 'after'),
  addTable: (e) => void e.insertBlocks([{ type: 'table', content: { type: 'tableContent', rows: [{ cells: ['x', 'y'] }] } }] as never, e.document[e.document.length - 1].id, 'after'),
  dupBlock: (e, r) => {
    const b = e.document[Math.floor(r() * e.document.length)];
    if (b) e.insertBlocks([{ type: b.type, props: b.props, content: b.content } as never], b.id, 'after');
  },
  link: (e, r) => void (caret(e, r) && e.createLink('https://example.com', 'web')),
  removeBlock: (e, r) => {
    const b = e.document[Math.floor(r() * e.document.length)];
    if (b && e.document.length > 2) e.removeBlocks([b]);
  },
  photoEnter: (e) => {
    const ps = photosOf(e);
    if (ps.length) {
      at(e, ps[0] + 2);
      press(e, 'Enter');
    }
  },
  photoDup: (e) => {
    const ps = photosOf(e);
    if (ps.length) {
      const node = view(e).state.doc.nodeAt(ps[0])!;
      view(e).dispatch(view(e).state.tr.insert(ps[0], node.type.create(node.attrs)));
    }
  },
  photoType: (e) => {
    const ps = photosOf(e);
    if (ps.length) {
      at(e, ps[ps.length - 1] + 1);
      e.insertInlineContent(' nota');
    }
  },
};
const names = Object.keys(acts);

describe('al azar: el visitante honesto con el editor real nunca queda afuera', () => {
  it('60 semillas, con fotos en línea, una tabla con fotos y listas', async () => {
    let total = 0;
    const aside: string[] = [];
    for (let seed = 1; seed <= 60; seed++) {
      const rows = await teamPage([
        { type: 'heading', props: { level: 2 }, content: 'Escena 4' },
        { type: 'paragraph', content: 'Notas del rodaje de hoy' },
        { type: 'paragraph', content: [{ type: 'text', text: 'set ', styles: {} }, inline[1], { type: 'text', text: ' luz', styles: {} }] },
        { type: 'bulletListItem', content: 'toma uno' },
        { type: 'numberedListItem', content: 'paso uno' },
        { type: 'checkListItem', content: 'revisar luz' },
        { type: 'table', content: { type: 'tableContent', rows: [{ cells: [{ type: 'tableCell', content: inline }, 'lente'] }, { cells: ['A', '35mm'] }] } },
        { type: 'paragraph', content: 'final' },
      ]);
      const v = visitorFrom(rows);
      const e = mountEditor(v, `v${seed}`);
      await tick(10);
      const rnd = seeded(seed * 7919);
      const tester = new AdmissionTester(rows, { mediaAllowed: allowed });
      try {
        for (let k = 0; k < 14; k++) {
          const name = names[Math.floor(rnd() * names.length)];
          const sv = Y.encodeStateVector(v);
          try {
            acts[name](e, rnd);
          } catch {
            // una acción que no se puede acá
          }
          await tick(5);
          const row = Y.encodeStateAsUpdate(v, sv);
          if (row.length <= 2) continue;
          total++;
          const verdict = tester.test(row);
          if (!verdict.ok) aside.push(`semilla ${seed} ${name}: ${verdict.reason} ${verdict.detail ?? ''}`);
        }
      } finally {
        tester.destroy();
        unmountAll();
      }
    }
    expect(total).toBeGreaterThan(600);
    expect(aside).toEqual([]);
  }, 600_000);
});
