// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyLikeApp, mountEditor, unmountAll } from '../ui/collabHarness';
import { STABLE_GAPS_MARKER } from '../ui/unknownContent';
import { admitRows, AdmissionTester, insertedText, type AdmitVerdict } from './admit';
import { buildCleanBase } from './clean';
import { block, group, seeded, textOf } from './historyTesting';
import { CONTENT_FRAGMENT, normalizeStructure } from './structure';

// La prueba de admisión de lo que escribe un link (Docs/Doc_Link_Publico.md, E2.3 y E2.14.2): los 11 casos del
// prototipo, las 19 filas hostiles de la auditoría contra el editor real, la imagen externa y la vacía (C1), un caso
// honesto por cada propiedad propia de la app (R3), las fotos en línea, las anotaciones y colapsar, y la corrida al azar.

afterEach(() => unmountAll());
const tick = () => new Promise((r) => setTimeout(r, 40));

const ALLOWED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOREIGN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const allowed = (id: string): boolean => id === ALLOWED;

/** Una página del editor: `n` párrafos de ~`len` letras, con lo tecleado y borrado en varias filas. */
function editorPage(n: number, len: number, seed = 1): Uint8Array[] {
  const rnd = seeded(seed);
  const doc = new Y.Doc({ gc: false });
  const rows: Uint8Array[] = [];
  let sv = Y.encodeStateVector(doc);
  const push = () => {
    rows.push(Y.encodeStateAsUpdate(doc, sv));
    sv = Y.encodeStateVector(doc);
  };
  const g = group(doc);
  for (let i = 0; i < n; i++) {
    g.push([block(`b${i}`, 'x'.repeat(len))]);
    if (i % 10 === 9) push();
  }
  push();
  // Borrados del editor (lo que la base limpia no deja pasar).
  for (let i = 0; i < n; i += 7) {
    const t = textOf(g.get(i) as Y.XmlElement);
    t.delete(0, Math.min(20, t.length));
    if (rnd() < 0.3) t.insert(0, 'nota interna borrada');
    if (rnd() < 0.5) t.delete(0, Math.min(5, t.length));
  }
  push();
  doc.destroy();
  return rows;
}

/** El visitante: arranca de la base limpia, como la recibe el link. */
function visitorFrom(rows: Uint8Array[]): Y.Doc {
  const v = new Y.Doc();
  const built = buildCleanBase(rows);
  Y.applyUpdate(v, built.base);
  built.doc.destroy();
  return v;
}

/** Lo que agrega `fn` al documento del visitante: la fila que mandaría. */
function edit(v: Y.Doc, fn: (g: Y.XmlElement) => void): Uint8Array {
  const sv = Y.encodeStateVector(v);
  fn(v.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement);
  return Y.encodeStateAsUpdate(v, sv);
}

const one = (rows: Uint8Array[], row: Uint8Array, options = { mediaAllowed: allowed }): AdmitVerdict =>
  admitRows(rows, [row], options)[0];
const reason = (v: AdmitVerdict) => (v.ok ? 'ok' : v.reason);

describe('la prueba de admisión (los casos del prototipo)', () => {
  const rows = editorPage(60, 80);

  it('honesto: escribe, agrega un párrafo y una foto de la rama; dice qué fotos suma', () => {
    const v = visitorFrom(rows);
    const row = edit(v, (g) => {
      textOf(g.get(3) as Y.XmlElement).insert(2, 'hola desde el link');
      g.insert(5, [block('v1', 'párrafo nuevo del visitante')]);
      g.insert(6, [block('v2', '', 'image', { url: `sdmedia://${ALLOWED}` })]);
    });
    expect(one(rows, row)).toEqual({ ok: true, media: [ALLOWED] });
    // Sin la lista de lo permitido, la base decide: la prueba la deja pasar con la lista.
    expect(admitRows(rows, [row])[0]).toEqual({ ok: true, media: [ALLOWED] });
  });

  it('el texto que trae una fila se lee sin la app (O8)', () => {
    const v = visitorFrom(rows);
    const row = edit(v, (g) => {
      g.insert(1, [block('t1', 'primera línea')]);
      g.insert(2, [block('t2', 'segunda línea')]);
    });
    expect(insertedText(row).split(String.fromCharCode(10)).sort()).toEqual(['primera línea', 'segunda línea']);
    expect(insertedText(new Uint8Array([1, 2, 3, 250]))).toBe('');
  });

  it('basura, dependencias que nunca subieron y borrados de algo que no existe', () => {
    expect(reason(one(rows, new Uint8Array([1, 2, 3, 250, 251, 7, 9])))).toBe('undecodable');
    const v = visitorFrom(rows);
    edit(v, (g) => g.insert(0, [block('w1', 'primera')]));
    const second = edit(v, (g) => textOf(g.get(0) as Y.XmlElement).insert(0, 'segunda '));
    expect(reason(one(rows, second))).toBe('pending');
    const x = new Y.Doc();
    x.getXmlFragment(CONTENT_FRAGMENT).insert(0, [new Y.XmlText('fantasma')]);
    (x.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlText).delete(0, 3);
    const onlyDs = Y.encodeStateAsUpdate(x, Y.encodeStateVector(x));
    expect(reason(one(rows, onlyDs))).toBe('pending');
  });

  it('un bloque o una marca que esta versión no conoce, y un tipo raíz nuevo', () => {
    expect(reason(one(rows, edit(visitorFrom(rows), (g) => g.insert(1, [block('u1', 'x', 'fooBlock')]))))).toBe('unknown_content');
    expect(reason(one(rows, edit(visitorFrom(rows), (g) => textOf(g.get(2) as Y.XmlElement).format(0, 3, { evilMark: true })))))
      .toBe('unknown_content');
    const v = visitorFrom(rows);
    const sv = Y.encodeStateVector(v);
    v.getMap('junk').set('a', 'z'.repeat(1000));
    expect(reason(one(rows, Y.encodeStateAsUpdate(v, sv)))).toBe('unknown_root');
  });

  it('una foto de afuera, una página que se pasa del tope', () => {
    expect(reason(one(rows, edit(visitorFrom(rows), (g) => g.insert(1, [block('f1', '', 'image', { url: `sdmedia://${FOREIGN}` })])))))
      .toBe('foreign_media');
    const big = edit(visitorFrom(rows), (g) => g.push([block('big', 'y'.repeat(300_000))]));
    expect(reason(admitRows(rows, [big], { maxBaseBytes: 256 * 1024 })[0])).toBe('too_big');
  });

  it('el visitante escribe adentro de un párrafo que el editor borró después de la base: entra', () => {
    const v = visitorFrom(rows);
    const ed = new Y.Doc({ gc: false });
    for (const r of rows) Y.applyUpdate(ed, r);
    const sv = Y.encodeStateVector(ed);
    (ed.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).delete(10, 1);
    const editorDel = Y.encodeStateAsUpdate(ed, sv);
    const inside = edit(v, (g) => textOf(g.get(10) as Y.XmlElement).insert(1, 'adentro de lo borrado'));
    expect(one([...rows, editorDel], inside).ok).toBe(true);
  });

  it('una foto que la página ya tenía (copiarla dentro de la página) entra sin pedir permiso', () => {
    const withPhoto = [...rows, edit(visitorFrom(rows), (g) => g.insert(0, [block('p0', '', 'image', { url: `sdmedia://${FOREIGN}` })]))];
    const row = edit(visitorFrom(withPhoto), (g) => g.insert(3, [block('c1', '', 'image', { url: `sdmedia://${FOREIGN}` })]));
    expect(one(withPhoto, row, { mediaAllowed: () => false })).toEqual({ ok: true, media: [] });
  });

  it('una imagen de afuera se aparta; una imagen vacía (como la inserta el editor, C1) entra', () => {
    expect(reason(one(rows, edit(visitorFrom(rows), (g) => g.insert(1, [block('e1', '', 'image', { url: 'https://example.invalid/p.png' })])))))
      .toBe('external_url');
    const empty = edit(visitorFrom(rows), (g) => g.insert(1, [block('e2', '', 'image', { url: '', name: '', caption: '' })]));
    expect(one(rows, empty).ok).toBe(true);
    // Y lo que el visitante escribe después colgado de ese bloque, también.
    const v = visitorFrom(rows);
    const a = edit(v, (g) => g.insert(1, [block('e3', '', 'image', { url: '' })]));
    const b = edit(v, (g) => g.insert(2, [block('e4', 'debajo de la imagen')]));
    expect(admitRows(rows, [a, b]).map(reason)).toEqual(['ok', 'ok']);
  });

  it('las anotaciones de fotos, colapsar para todos, la foto en línea y la marca de los huecos entran', () => {
    const v = visitorFrom(rows);
    const sv = Y.encodeStateVector(v);
    v.getMap('photoMarkup').set(`${ALLOWED}/s1`, { kind: 'arrow', points: [0, 0, 1, 1] });
    v.getMap('collapsedHeadings').set('b3', true);
    const marks = Y.encodeStateAsUpdate(v, sv);
    const inline = edit(v, (g) => {
      const bc = new Y.XmlElement('blockContainer');
      bc.setAttribute('id', 'ph');
      const p = new Y.XmlElement('paragraph');
      const photo = new Y.XmlElement('photo');
      photo.setAttribute('url', `sdmedia://${ALLOWED}`);
      photo.setAttribute('name', 'foto.jpg');
      photo.setAttribute('w', 0.4 as never);
      photo.setAttribute('rowStart', true as never);
      const t1 = new Y.XmlText();
      t1.insert(0, 'antes ');
      const t2 = new Y.XmlText();
      t2.insert(0, ' después');
      p.insert(0, [new Y.XmlElement(STABLE_GAPS_MARKER), t1, photo, t2]);
      bc.insert(0, [p]);
      g.insert(4, [bc]);
    });
    expect(admitRows(rows, [marks, inline], { mediaAllowed: allowed }).map(reason)).toEqual(['ok', 'ok']);
  });

  it('en cadena: lo que sigue del mismo autor de Yjs se aparta (pendiente); lo de otra sesión que no depende, entra', () => {
    const v = visitorFrom(rows);
    const bad = edit(v, (g) => g.insert(0, [block('x1', 'colgable'), block('x2', '', 'image', { url: 'https://example.invalid/x.png' })]));
    const dependent = edit(v, (g) => textOf(g.get(0) as Y.XmlElement).insert(0, 'colgado'));
    // Yjs aplica lo de un autor en el orden de sus relojes: aunque no toque lo apartado, lo que sigue de la misma
    // sesión queda pendiente (observación 1 de la auditoría: "volver a la página del equipo" es la 2c).
    const sameSession = edit(v, (g) => textOf(g.get(20) as Y.XmlElement).insert(0, 'aparte '));
    // Otra sesión (otro autor, por ejemplo después de recargar sobre la base): lo que no cuelga de lo apartado entra.
    const other = edit(visitorFrom(rows), (g) => textOf(g.get(20) as Y.XmlElement).insert(0, 'otra sesión '));
    expect(admitRows(rows, [bad, dependent, sameSession, other]).map(reason)).toEqual(['external_url', 'pending', 'pending', 'ok']);
  });

  it('al azar: el visitante honesto nunca queda afuera (60 semillas)', () => {
    let honest = 0;
    let aside = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const accepted = editorPage(30, 40, seed);
      const rnd = seeded(seed * 7);
      const v = visitorFrom(accepted);
      let tester = new AdmissionTester([...accepted]);
      for (let step = 0; step < 25; step++) {
        const r = rnd();
        if (r < 0.15) {
          // El editor escribe y borra; el visitante recibe una base nueva cada tanto.
          const ed = new Y.Doc({ gc: false });
          for (const u of accepted) Y.applyUpdate(ed, u);
          const sv = Y.encodeStateVector(ed);
          const g = ed.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
          const i = Math.floor(rnd() * g.length);
          if (rnd() < 0.5 && g.length > 3) g.delete(i, 1);
          else textOf(g.get(i) as Y.XmlElement).insert(0, `ed${step} `);
          const teamRow = Y.encodeStateAsUpdate(ed, sv);
          ed.destroy();
          accepted.push(teamRow);
          // Una fila del equipo en el medio: la prueba se rearma con las filas del servidor.
          tester.destroy();
          tester = new AdmissionTester([...accepted]);
          if (rnd() < 0.5) {
            const built = buildCleanBase(accepted);
            Y.applyUpdate(v, built.base);
            built.doc.destroy();
          }
        } else {
          const row = edit(v, (g) => {
            const i = Math.floor(rnd() * g.length);
            if (rnd() < 0.3) g.insert(i, [block(`v${seed}-${step}`, `vis ${step}`)]);
            else if (rnd() < 0.2 && g.length > 3) g.delete(i, 1);
            else {
              const t = textOf(g.get(i) as Y.XmlElement);
              if (rnd() < 0.3 && t.length > 2) t.delete(0, 2);
              else t.insert(Math.floor(rnd() * (t.length + 1)), `v${step}`);
            }
          });
          honest++;
          const verdict = tester.test(row);
          if (verdict.ok) accepted.push(row);
          else aside++;
        }
      }
      tester.destroy();
      v.destroy();
    }
    expect(honest).toBeGreaterThan(1000);
    expect(aside).toBe(0);
  });

  it('cuánto tarda una fila en una página grande (la copia se arma una vez)', () => {
    const big = editorPage(800, 350);
    const v = visitorFrom(big);
    const rowsOfVisitor = Array.from({ length: 10 }, (_, i) => edit(v, (g) => textOf(g.get(3 + i) as Y.XmlElement).insert(2, `hola ${i}`)));
    const tester = new AdmissionTester(big);
    const t0 = performance.now();
    for (const r of rowsOfVisitor) expect(tester.test(r).ok).toBe(true);
    const perRow = (performance.now() - t0) / rowsOfVisitor.length;
    tester.destroy();
    // En la PC, unos pocos ms por fila en una página de ~300 KB (el prototipo, armando todo por fila: 13 ms).
    expect(perRow).toBeLessThan(200);
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Las 19 filas hostiles de la auditoría (B3), contra el editor real
// ------------------------------------------------------------------------------------------------------------------

function teamRows(): Uint8Array[] {
  const d = new Y.Doc({ gc: false });
  const g = group(d);
  g.push([
    block('b0', 'texto del equipo cero'),
    block('b1', 'texto del equipo uno', 'heading', { level: '2' }),
    block('b2', 'texto del equipo dos'),
  ]);
  return [Y.encodeStateAsUpdate(d)];
}

const hostile: Record<string, (v: Y.Doc) => void> = {
  anyEnLaRaiz: (v) => (v.getArray(CONTENT_FRAGMENT) as Y.Array<unknown>).insert(0, [42]),
  anyEnElGrupo: (v) => (group(v) as unknown as Y.Array<unknown>).insert(1, [42 as never]),
  mapEnElGrupo: (v) => group(v).insert(1, [new Y.Map() as never]),
  mapEnElParrafo: (v) => ((group(v).get(0) as Y.XmlElement).get(0) as Y.XmlElement).insert(0, [new Y.Map() as never]),
  sinIdEnBloque: (v) => (group(v).get(0) as Y.XmlElement).removeAttribute('id'),
  nivel99: (v) => ((group(v).get(1) as Y.XmlElement).get(0) as Y.XmlElement).setAttribute('level', '99'),
  nivelObjeto: (v) => ((group(v).get(1) as Y.XmlElement).get(0) as Y.XmlElement).setAttribute('level', { x: 1 } as never),
  alineacionRara: (v) => ((group(v).get(0) as Y.XmlElement).get(0) as Y.XmlElement).setAttribute('textAlignment', 'bogus'),
  marcaConValorRaro: (v) => textOf(group(v).get(2) as Y.XmlElement).format(0, 5, { textColor: { a: [1, 2] } as never }),
  imagenExterna: (v) => group(v).insert(3, [block('ext', '', 'image', { url: 'https://example.invalid/pixel.png' })]),
  parrafoSuelto: (v) => {
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    t.insert(0, 'suelto');
    p.insert(0, [t]);
    group(v).insert(1, [p]);
  },
  tablaRota: (v) => {
    const t = new Y.XmlElement('table');
    t.insert(0, [new Y.XmlElement('tableRow')]);
    const bc = new Y.XmlElement('blockContainer');
    bc.setAttribute('id', 'tt');
    bc.insert(0, [t]);
    group(v).insert(1, [bc]);
  },
  textoEnGrupoRaiz: (v) => {
    const t = new Y.XmlText();
    t.insert(0, 'texto suelto');
    v.getXmlFragment(CONTENT_FRAGMENT).insert(0, [t]);
  },
  alineacionObjeto: (v) => ((group(v).get(0) as Y.XmlElement).get(0) as Y.XmlElement).setAttribute('textAlignment', { a: 1 } as never),
  colorObjeto: (v) => ((group(v).get(0) as Y.XmlElement).get(0) as Y.XmlElement).setAttribute('backgroundColor', { a: 1 } as never),
  urlObjeto: (v) => {
    group(v).insert(3, [block('im', '', 'image')]);
    ((group(v).get(3) as Y.XmlElement).get(0) as Y.XmlElement).setAttribute('url', { a: 1 } as never);
  },
  idObjeto: (v) => (group(v).get(0) as Y.XmlElement).setAttribute('id', { a: 1 } as never),
  nivelTexto: (v) => ((group(v).get(1) as Y.XmlElement).get(0) as Y.XmlElement).setAttribute('level', 'x y'),
  dosGruposRaiz: (v) => {
    const g2 = new Y.XmlElement('blockGroup');
    g2.insert(0, [block('x9', 'otro grupo')]);
    v.getXmlFragment(CONTENT_FRAGMENT).insert(1, [g2]);
  },
};

/** Las 3 que hacían tirar al editor real del equipo (B3): se apartan por la forma. */
const CRASHERS = new Set(['mapEnElParrafo', 'nivelObjeto', 'nivelTexto']);

describe('las 19 filas hostiles de la auditoría (B3)', () => {
  it('son 19', () => expect(Object.keys(hostile)).toHaveLength(19));

  for (const [name, fn] of Object.entries(hostile)) {
    it(name, async () => {
      const rows = teamRows();
      const v = visitorFrom(rows);
      const sv = Y.encodeStateVector(v);
      fn(v);
      const row = Y.encodeStateAsUpdate(v, sv);
      const verdict = one(rows, row);
      if (CRASHERS.has(name)) expect(verdict).toMatchObject({ ok: false, reason: 'bad_shape' });
      if (!verdict.ok) return;
      // Entró: el editor del equipo no tira ni con la página abierta ni abriéndola de cero, y no pierde texto del equipo.
      const team = (d: Y.Doc) => {
        const json = JSON.stringify(d.getXmlFragment(CONTENT_FRAGMENT).toJSON());
        return ['cero', 'uno', 'dos'].filter((w) => json.includes(`equipo ${w}`)).length;
      };
      const live = new Y.Doc();
      for (const r of rows) Y.applyUpdate(live, r);
      mountEditor(live, 'team');
      await tick();
      applyLikeApp(live, row);
      await tick();
      expect(team(live)).toBe(3);
      const fresh = new Y.Doc();
      for (const r of [...rows, row]) Y.applyUpdate(fresh, r);
      normalizeStructure(fresh, 'repair');
      const ed = mountEditor(fresh, 'team2');
      await tick();
      expect(() => ed.document.length).not.toThrow();
      expect(team(fresh)).toBe(3);
    });
  }
});

// ------------------------------------------------------------------------------------------------------------------
// Un caso honesto por cada propiedad propia de la app, escrito con el editor real del visitante (R3)
// ------------------------------------------------------------------------------------------------------------------

describe('lo que escribe el editor real del visitante entra (R3)', () => {
  it('script, question, driveCard, pageBreak, isToggleable, checked, rowWidth, thumbHeight, colwidth (lista y nulo), colspan, rowspan', async () => {
    const rows = teamRows();
    const v = visitorFrom(rows);
    normalizeStructure(v, 'repair');
    const e = mountEditor(v, 'visitante');
    await tick();
    const steps: [string, () => void][] = [];
    const first = () => e.document[0].id;
    const add = (label: string, blocks: unknown[]) =>
      steps.push([label, () => void e.insertBlocks(blocks as never, first(), 'before')]);
    add('script', [{ type: 'paragraph', props: { script: true }, content: '1 INT. BAR - NOCHE' }]);
    add('question', [{ type: 'paragraph', props: { question: true }, content: '¿Cuántas tomas?' }]);
    add('driveCard', [{ type: 'paragraph', props: { driveCard: true }, content: 'https://drive.google.com/file/d/abc/view' }]);
    add('pageBreak', [{ type: 'paragraph', props: { pageBreak: true } }]);
    add('isToggleable', [{ type: 'heading', props: { level: 2, isToggleable: true }, content: 'Plegable' }]);
    add('checked', [{ type: 'checkListItem', props: { checked: true }, content: 'hecho' }]);
    add('rowWidth', [{ type: 'image', props: { url: '', rowWidth: 0.5 } }]);
    add('thumbHeight', [{ type: 'table', props: { thumbHeight: 140 }, content: { type: 'tableContent', rows: [{ cells: ['a', 'b'] }] } }]);
    steps.push([
      'colwidth, colspan, rowspan',
      () => {
        const table = e.document.find((b) => b.type === 'table')!;
        e.updateBlock(table, {
          content: {
            type: 'tableContent',
            columnWidths: [150, undefined],
            rows: [{ cells: [{ type: 'tableCell', props: { colspan: 2, rowspan: 1 }, content: 'ancha' } as never] }, { cells: ['c', 'd'] }],
          } as never,
        });
      },
    ]);
    steps.push([
      'colwidth nulo',
      () => {
        const table = e.document.find((b) => b.type === 'table')!;
        e.updateBlock(table, { content: { type: 'tableContent', columnWidths: [undefined, undefined], rows: [{ cells: ['x', 'y'] }] } as never });
      },
    ]);
    const tester = new AdmissionTester(rows);
    try {
      for (const [label, step] of steps) {
        const sv = Y.encodeStateVector(v);
        step();
        await tick();
        const row = Y.encodeStateAsUpdate(v, sv);
        expect([label, tester.test(row)]).toEqual([label, expect.objectContaining({ ok: true })]);
      }
    } finally {
      tester.destroy();
    }
  });
});
