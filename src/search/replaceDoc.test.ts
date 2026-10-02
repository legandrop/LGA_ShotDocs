import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { unitsFromYDoc } from './extract';
import { searchText } from './normalize';
import {
  applyPlan,
  hiddenBlocks,
  planCount,
  planRedo,
  planReplace,
  planUndo,
  recordsOf,
  SHARED_COLLAPSE_MAP_NAME,
  type EditRecord,
  type Run,
} from './replaceDoc';

// Reemplazar en el Y.Doc de una página y deshacer con el registro (Docs/Doc_Buscar.md, "Reemplazar en el proyecto"):
// el formato, los links, los separadores, las pegadas, lo escondido, y deshacer solo lo que sigue igual, también con
// otro dispositivo escribiendo y borrando a la vez (al azar: `REPLACE_SEEDS`).

type Part = string | Run | 'br' | 'photo';
type Spec = { id?: string; parts?: Part[]; heading?: number; caption?: string; name?: string; cells?: string[]; children?: Spec[] };

let n = 0;
/** Arma la página como la deja el editor: primero la estructura, después el texto (Yjs no deja escribir antes). */
function pageDoc(specs: Spec[], doc = new Y.Doc()): Y.Doc {
  const fills: (() => void)[] = [];
  const container = (spec: Spec): Y.XmlElement => {
    const c = new Y.XmlElement('blockContainer');
    c.setAttribute('id', spec.id ?? `b${n++}`);
    let content: Y.XmlElement;
    if (spec.caption !== undefined || spec.name !== undefined) {
      content = new Y.XmlElement('image');
      if (spec.caption !== undefined) content.setAttribute('caption', spec.caption);
      if (spec.name !== undefined) content.setAttribute('name', spec.name);
    } else if (spec.cells) {
      content = new Y.XmlElement('table');
      const row = new Y.XmlElement('tableRow');
      row.insert(
        0,
        spec.cells.map((text) => {
          const cell = new Y.XmlElement('tableCell');
          const p = new Y.XmlElement('tableParagraph');
          const t = new Y.XmlText();
          p.insert(0, [t]);
          cell.insert(0, [p]);
          fills.push(() => t.insert(0, text));
          return cell;
        }),
      );
      content.insert(0, [row]);
    } else {
      content = new Y.XmlElement(spec.heading ? 'heading' : 'paragraph');
      if (spec.heading) content.setAttribute('level', spec.heading as never);
      const kids: (Y.XmlText | Y.XmlElement)[] = [];
      let cur: { t: Y.XmlText; runs: Run[] } | null = null;
      for (const part of spec.parts ?? []) {
        if (part === 'br' || part === 'photo') {
          kids.push(new Y.XmlElement(part === 'br' ? 'hardBreak' : 'inlinePhoto'));
          cur = null;
          continue;
        }
        if (!cur) {
          const made: { t: Y.XmlText; runs: Run[] } = { t: new Y.XmlText(), runs: [] };
          cur = made;
          kids.push(made.t);
          fills.push(() => {
            for (const r of made.runs) made.t.insert(made.t.length, r.text, { ...r.attrs });
          });
        }
        cur.runs.push(typeof part === 'string' ? { text: part, attrs: {} } : part);
      }
      content.insert(0, kids);
    }
    c.insert(0, [content]);
    if (spec.children) {
      const g = new Y.XmlElement('blockGroup');
      g.insert(0, spec.children.map(container));
      c.insert(1, [g]);
    }
    return c;
  };
  const f = doc.getXmlFragment(CONTENT_FRAGMENT);
  doc.transact(() => {
    if (f.length === 0) f.insert(0, [new Y.XmlElement('blockGroup')]);
    const g = f.get(0) as Y.XmlElement;
    g.insert(g.length, specs.map(container));
    for (const fill of fills) fill();
  });
  return doc;
}

const xml = (doc: Y.Doc) => doc.getXmlFragment(CONTENT_FRAGMENT).toString();
const sync = (a: Y.Doc, b: Y.Doc) => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
};
/** Rearma el documento desde sus bytes (como al volver a abrir la app). */
const reload = (doc: Y.Doc) => {
  const d = new Y.Doc();
  Y.applyUpdate(d, Y.encodeStateAsUpdate(doc));
  return d;
};
const ORIGIN = Symbol('test-replace');

function replace(doc: Y.Doc, query: string, replacement: string, options = {}) {
  const plan = planReplace(doc, query, replacement, options);
  doc.transact(() => applyPlan(plan), ORIGIN);
  return { plan, records: JSON.parse(JSON.stringify(recordsOf(plan))) as EditRecord[] };
}

function undo(doc: Y.Doc, records: EditRecord[]) {
  const u = planUndo(doc, records);
  doc.transact(() => u.apply(), ORIGIN);
  const count = (o: string) => u.outcomes.filter((x) => x === o).length;
  return { undone: count('undone'), changed: count('changed'), notApplied: count('notApplied') };
}

describe('el plan', () => {
  it('formato partido, link que se conserva, salto de línea que separa, celdas de tabla, código; deshacer deja todo igual', () => {
    const doc = pageDoc([
      { parts: ['La ', { text: 'Cá', attrs: { bold: true } }, { text: 'mara', attrs: { italic: true } }, ' A y la cámara B'] },
      { parts: [{ text: 'cámara', attrs: { link: { href: 'https://drive.google.com/file/d/x' } } }] },
      { parts: ['cáma', 'br', 'ra no cruza'] },
      { cells: ['una cámara', 'otra'] },
      { parts: ['linea con cámara\ncámara en otra'] },
    ]);
    const before = xml(doc);
    const { plan, records } = replace(doc, 'camara', 'Camera');
    expect(planCount(plan)).toBe(6);
    // El primer carácter manda el formato.
    expect(xml(doc)).toContain('<bold>Camera</bold>');
    expect(xml(doc)).toContain('https://drive.google.com/file/d/x');
    expect(xml(doc)).toContain('cáma<hardbreak></hardbreak>ra no cruza');
    const again = reload(doc);
    expect(undo(again, records)).toEqual({ undone: 6, changed: 0, notApplied: 0 });
    expect(xml(again)).toBe(before);
    // Otra vez no hace nada.
    expect(undo(again, records)).toEqual({ undone: 0, changed: 0, notApplied: 6 });
    expect(xml(again)).toBe(before);
  });

  it('cuenta las coincidencias de cada bloque igual que la búsqueda del proyecto (pies y nombres incluidos)', () => {
    const doc = pageDoc([
      { id: 'x', parts: ['cámara y cámara'] },
      { id: 'f', caption: 'una cámara', name: 'camara.jpg' },
      { id: 't', cells: ['cámara', 'la cámara'] },
    ]);
    const { matches } = planReplace(doc, 'camara', 'Z');
    expect(matches.map((m) => [m.blockId, m.field, m.occurrence, m.skip ?? null])).toEqual([
      ['x', 'text', 0, null],
      ['x', 'text', 1, null],
      ['f', 'caption', 0, 'caption'],
      ['f', 'name', 1, 'name'],
      ['t', 'text', 0, null],
      ['t', 'text', 1, null],
    ]);
    // Lo mismo que da la búsqueda sobre las unidades del índice.
    const perBlock = new Map<string, number>();
    for (const u of unitsFromYDoc(doc)) perBlock.set(u.blockId, (perBlock.get(u.blockId) ?? 0) + searchText(u.text, 'camara').length);
    expect(Object.fromEntries(perBlock)).toEqual({ x: 2, f: 2, t: 2 });
  });

  it('se saltea lo que borraría un link entero, lo que ya es igual y lo que cruza el borde de una foto borrada', () => {
    const doc = pageDoc([{ parts: ['ver ', { text: 'acá', attrs: { link: { href: 'https://x' } } }, ' y acá'] }, { parts: ['Camera'] }]);
    // Un renglón al que le borraron una foto: dos textos seguidos.
    const f = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
    const c = new Y.XmlElement('blockContainer');
    c.setAttribute('id', 'gap');
    const p = new Y.XmlElement('paragraph');
    const t1 = new Y.XmlText();
    const t2 = new Y.XmlText();
    p.insert(0, [t1, t2]);
    c.insert(0, [p]);
    doc.transact(() => {
      f.insert(f.length, [c]);
      t1.insert(0, 'la cá');
      t2.insert(0, 'mara');
    });
    const before = xml(doc);
    const empty = planReplace(doc, 'aca', '');
    expect(empty.matches.map((m) => m.skip ?? null)).toEqual(['link', null]);
    const same = planReplace(doc, 'camera', 'Camera');
    expect(same.matches.map((m) => m.skip ?? null)).toEqual(['same']);
    const gap = planReplace(doc, 'camara', 'X');
    expect(gap.matches.map((m) => m.skip ?? null)).toEqual(['boundary']);
    expect(gap.edits).toEqual([]);
    const { records } = replace(doc, 'aca', '');
    expect(undo(doc, records).undone).toBe(1);
    expect(xml(doc)).toBe(before);
  });

  it('las fotos en línea separan y nunca se tocan', () => {
    const doc = pageDoc([{ parts: ['la cám', 'photo', 'ara y la cámara', 'photo', 'cámara'] }]);
    const { plan } = replace(doc, 'camara', 'C');
    expect(planCount(plan)).toBe(2);
    expect(xml(doc)).toBe(
      '<blockgroup><blockcontainer id="' +
        (doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).get(0).toJSON().match(/id="([^"]+)"/)![1] +
        '"><paragraph>la cám<inlinephoto></inlinephoto>ara y la C<inlinephoto></inlinephoto>C</paragraph></blockcontainer></blockgroup>',
    );
  });

  it('coincidencias pegadas (sin nada entre ellas): un solo cambio, y deshacer las deja como estaban', () => {
    for (const replacement of ['', 'Camera', 'x']) {
      const doc = pageDoc([{ parts: ['cámaracámara'] }, { parts: ['ver cámaracámaracámara fin'] }, { parts: [{ text: 'cámara', attrs: { bold: true } }, 'cámara'] }]);
      const before = xml(doc);
      const { plan, records } = replace(doc, 'camara', replacement);
      expect(plan.edits.map((e) => e.count)).toEqual([2, 3, 2]);
      const again = reload(doc);
      expect(undo(again, records)).toEqual({ undone: 3, changed: 0, notApplied: 0 });
      expect({ replacement, xml: xml(again) }).toEqual({ replacement, xml: before });
    }
  });

  it('Aa y palabra entera', () => {
    const doc = pageDoc([{ parts: ['Cámara cámara cámaras'] }]);
    expect(planCount(planReplace(doc, 'Cámara', 'X', { matchCase: true }))).toBe(1);
    expect(planCount(planReplace(doc, 'camara', 'X', { wholeWord: true }))).toBe(2);
    expect(planCount(planReplace(doc, 'camara', 'X'))).toBe(3);
  });

  it('las excluidas (por sus ids) y "solo esta" no dependen del número: otro agrega una antes', () => {
    const a = pageDoc([{ id: 'x', parts: ['uno cámara dos cámara'] }]);
    const b = new Y.Doc();
    sync(a, b);
    const second = planReplace(a, 'camara', 'Z').matches[1].key;
    // B agrega una "cámara" antes: la número 1 ahora es otra.
    const yt = (((b.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    yt.insert(0, 'cámara ');
    sync(a, b);
    replace(a, 'camara', 'Z', { only: new Set([second]) });
    sync(a, b);
    expect(yt.toString()).toBe('cámara uno cámara dos Z');
  });
});

describe('lo escondido', () => {
  const doc = () =>
    pageDoc([
      { id: 'h1', heading: 1, parts: ['Título'] },
      { id: 'p1', parts: ['cámara escondida'], children: [{ id: 'c1', parts: ['hija con cámara'] }] },
      { id: 'h2', heading: 2, parts: ['Sub'] },
      { id: 'p2', parts: ['otra cámara'] },
      { id: 'h1b', heading: 1, parts: ['Otro'] },
      { id: 'p3', parts: ['cámara a la vista'] },
    ]);

  it('lo tuyo manda sobre lo de todos; un título del mismo nivel corta la sección', () => {
    const d = doc();
    expect([...hiddenBlocks(d)]).toEqual([]);
    expect([...hiddenBlocks(d, new Map([['h1', { c: true }]]))]).toEqual(['p1', 'c1', 'h2', 'p2']);
    expect([...hiddenBlocks(d, new Map([['h2', { c: true }]]))]).toEqual(['p2']);
    // Para todos (el mapa del documento), salvo que lo tuyo diga abierto.
    d.getMap(SHARED_COLLAPSE_MAP_NAME).set('h1', true);
    expect([...hiddenBlocks(reload(d))]).toEqual(['p1', 'c1', 'h2', 'p2']);
    expect([...hiddenBlocks(reload(d), new Map([['h1', { c: false }]]))]).toEqual([]);
  });

  it('se cambia con la cuenta; con el reemplazo vacío las escondidas quedan afuera salvo la casilla', () => {
    const d = doc();
    const hidden = hiddenBlocks(d, new Map([['h1', { c: true }]]));
    const swap = planReplace(d, 'camara', 'X', { hidden });
    expect(swap.matches.filter((m) => m.hidden && !m.skip)).toHaveLength(3);
    expect(planCount(swap)).toBe(4);
    const del = planReplace(d, 'camara', '', { hidden });
    expect(del.matches.map((m) => m.skip ?? null)).toEqual(['hidden', 'hidden', 'hidden', null]);
    expect(planCount(planReplace(d, 'camara', '', { hidden, deleteHidden: true }))).toBe(4);
  });

  it('el nombre del mapa es el de colapsar para todos', async () => {
    const { SHARED_COLLAPSE_MAP } = await import('../ui/collapseEditor');
    expect(SHARED_COLLAPSE_MAP_NAME).toBe(SHARED_COLLAPSE_MAP);
  });
});

describe('deshacer con otro dispositivo', () => {
  it('se deshace solo lo que sigue igual y lo del otro queda', () => {
    const a = pageDoc([{ parts: ['uno cámara dos cámara tres cámara cuatro cámara'] }]);
    const b = new Y.Doc();
    sync(a, b);
    const { records } = replace(a, 'camara', 'Camera');
    sync(a, b);
    const yt = (((b.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    const s = yt.toString();
    const second = s.indexOf('Camera', s.indexOf('Camera') + 1);
    yt.insert(second + 3, 'XYZ');
    const s2 = yt.toString();
    yt.insert(s2.lastIndexOf('Camera') + 'Camera'.length, 's');
    sync(a, b);
    expect(undo(a, records)).toEqual({ undone: 2, changed: 2, notApplied: 0 });
    sync(a, b);
    expect(yt.toString()).toBe('uno cámara dos CamXYZera tres cámara cuatro Cameras');
    expect(xml(a)).toBe(xml(b));
  });

  it('un borrado: si el otro borró al lado, no se resucita', () => {
    const a = pageDoc([{ parts: ['a cámara b'] }]);
    const b = new Y.Doc();
    sync(a, b);
    const { records } = replace(a, 'camara', '');
    sync(a, b);
    const yt = (((b.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    yt.delete(0, yt.length);
    sync(a, b);
    expect(undo(a, records)).toEqual({ undone: 0, changed: 1, notApplied: 0 });
    expect(yt.toString()).toBe('');
  });

  it('un borrado: si el otro borró solo el vecino de la izquierda, tampoco se resucita', () => {
    const a = pageDoc([{ parts: ['ab cámara cd'] }]);
    const b = new Y.Doc();
    sync(a, b);
    const { records } = replace(a, 'camara', '');
    sync(a, b);
    const yt = (((b.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    expect(yt.toString()).toBe('ab  cd');
    // B borra "b " (el espacio era el vecino de la izquierda): las anclas igual dan el mismo lugar.
    yt.delete(1, 2);
    sync(a, b);
    expect(undo(a, records)).toEqual({ undone: 0, changed: 1, notApplied: 0 });
    expect(yt.toString()).toBe('a cd');
  });

  it('un borrado: si el vecino se borró y volvió con un deshacer (una copia de Yjs, la misma letra), se deshace igual', () => {
    const a = pageDoc([{ parts: ['la cámara roja'] }]);
    const { records } = replace(a, 'camara', '');
    const yt = (((a.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    expect(yt.toString()).toBe('la  roja');
    // Borrar "a  r" (los dos vecinos adentro) y deshacerlo: vuelven como copias.
    const um = new Y.UndoManager(yt, { trackedOrigins: new Set(['editor']) });
    a.transact(() => yt.delete(1, 4), 'editor');
    um.undo();
    expect(yt.toString()).toBe('la  roja');
    expect(undo(a, records)).toEqual({ undone: 1, changed: 0, notApplied: 0 });
    expect(yt.toString()).toBe('la cámara roja');
  });

  it('el bloque rehecho (cambio de tipo): las anclas quedan en el viejo, no se toca nada', () => {
    const a = pageDoc([{ id: 'x', parts: ['la cámara'] }]);
    const { records } = replace(a, 'camara', 'Z');
    // Como y-prosemirror al cambiar el tipo: borra el bloque y crea otro con el mismo texto.
    const g = a.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
    a.transact(() => {
      g.delete(0, 1);
      const c = new Y.XmlElement('blockContainer');
      c.setAttribute('id', 'x');
      const h = new Y.XmlElement('heading');
      const t = new Y.XmlText();
      h.insert(0, [t]);
      c.insert(0, [h]);
      g.insert(0, [c]);
      t.insert(0, 'la Z');
    });
    const before = xml(a);
    expect(undo(a, records)).toEqual({ undone: 0, changed: 1, notApplied: 0 });
    expect(xml(a)).toBe(before);
  });

  it('al azar: nada de lo que escribe el otro se borra, terminan iguales, y sin cambios del otro deshacer deja todo igual', () => {
    const SEEDS = Number(process.env.REPLACE_SEEDS ?? 300);
    let lost = 0;
    let quietRuns = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      let x = seed * 9301 + 49297;
      const rnd = (m: number) => {
        x = (x * 9301 + 49297) % 233280;
        return Math.floor((x / 233280) * m);
      };
      const words = ['cámara', 'luz', 'set', 'Cámara', 'plano'];
      // A veces pegadas (sin espacio).
      const text = Array.from({ length: 30 }, () => words[rnd(words.length)] + (rnd(3) === 0 ? '' : ' ')).join('');
      const a = pageDoc([{ parts: [text] }, { parts: [text.slice(0, 40)] }]);
      const b = new Y.Doc();
      sync(a, b);
      const original = xml(a);
      const quiet = rnd(5) === 0;
      // Lo que borró A (el reemplazo y el deshacer): nada de eso puede ser algo que escribió B.
      const aDeletes: Y.Transaction["deleteSet"][] = [];
      const watch = (doc: Y.Doc) =>
        doc.on('afterTransaction', (tr: Y.Transaction) => {
          if (tr.origin === ORIGIN) aDeletes.push(tr.deleteSet);
        });
      watch(a);
      const typeB = () => {
        if (quiet) return;
        const g = b.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
        const yt = ((g.get(rnd(g.length)) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlText;
        if (rnd(4) === 0 && yt.length > 3) yt.delete(rnd(yt.length - 2), 1 + rnd(2));
        else yt.insert(rnd(yt.length + 1), `{${seed}}`);
      };
      const replacement = rnd(3) === 0 ? '' : 'Camera';
      for (let i = rnd(4); i > 0; i--) typeB();
      const { records } = replace(a, 'camara', replacement);
      for (let i = rnd(4); i > 0; i--) typeB();
      if (rnd(2)) sync(a, b);
      for (let i = rnd(3); i > 0; i--) typeB();
      const a2 = reload(a);
      watch(a2);
      const r = undo(a2, records);
      for (let i = rnd(3); i > 0; i--) typeB();
      sync(a2, b);
      expect(xml(a2)).toBe(xml(b));
      if (quiet) {
        expect(xml(a2)).toBe(original);
        expect(r.changed).toBe(0);
        quietRuns++;
      }
      for (const struct of b.store.clients.get(b.clientID) ?? []) {
        for (let c = struct.id.clock; c < struct.id.clock + struct.length; c++) {
          if (aDeletes.some((ds) => Y.isDeleted(ds, Y.createID(b.clientID, c)))) lost++;
        }
      }
    }
    expect(lost).toBe(0);
    expect(quietRuns).toBeGreaterThan(SEEDS / 10);
  });
});

function redo(doc: Y.Doc, records: EditRecord[]) {
  const r = planRedo(doc, records);
  doc.transact(() => r.apply(), ORIGIN);
  const count = (o: string) => r.outcomes.filter((x) => x === o).length;
  return { redone: count('redone'), changed: count('changed'), already: count('already') };
}

describe('rehacer con las anclas (planRedo; Docs/Doc_Deshacer.md, 3.3)', () => {
  it('reemplazar, deshacer y rehacer deja lo reemplazado; otra vez no hace nada; también con formato, pegadas y borrar', () => {
    const doc = pageDoc([
      { parts: ['La ', { text: 'Cá', attrs: { bold: true } }, { text: 'mara', attrs: { italic: true } }, ' A y la cámara B'] },
      { parts: ['cámaracámara pegadas'] },
      { cells: ['una cámara', 'otra'] },
    ]);
    const { records } = replace(doc, 'camara', 'Camera');
    const replaced = xml(doc);
    undo(doc, records);
    const again = reload(doc);
    expect(redo(again, records)).toEqual({ redone: 4, changed: 0, already: 0 });
    expect(xml(again)).toBe(replaced);
    expect(redo(again, records)).toEqual({ redone: 0, changed: 0, already: 4 });
    expect(xml(again)).toBe(replaced);
    // Y se puede volver a deshacer con el mismo registro.
    expect(undo(again, records).undone).toBe(4);
    const del = pageDoc([{ parts: ['a cámara b cámara c'] }]);
    const d = replace(del, 'camara', '');
    const deleted = xml(del);
    undo(del, d.records);
    expect(redo(del, d.records)).toEqual({ redone: 2, changed: 0, already: 0 });
    expect(xml(del)).toBe(deleted);
  });

  it('si otro cambió lo de antes, eso no se toca; lo demás se rehace', () => {
    const a = pageDoc([{ parts: ['uno cámara dos cámara'] }]);
    const b = new Y.Doc();
    sync(a, b);
    const { records } = replace(a, 'camara', 'Camera');
    undo(a, records);
    sync(a, b);
    const yt = (((b.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    yt.insert(yt.toString().indexOf('cámara') + 2, 'XY');
    sync(a, b);
    expect(redo(a, records)).toEqual({ redone: 1, changed: 1, already: 0 });
    sync(a, b);
    expect(yt.toString()).toBe('uno cáXYmara dos Camera');
    expect(xml(a)).toBe(xml(b));
  });

  it('al azar: nada de lo que escribe el otro se borra, terminan iguales, y sin cambios del otro rehacer deja lo reemplazado', () => {
    const SEEDS = Number(process.env.REPLACE_SEEDS ?? 300);
    let lost = 0;
    let quietRuns = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      let x = seed * 7919 + 104729;
      const rnd = (m: number) => {
        x = (x * 9301 + 49297) % 233280;
        return Math.floor((x / 233280) * m);
      };
      const words = ['cámara', 'luz', 'set', 'Cámara', 'plano'];
      const text = Array.from({ length: 30 }, () => words[rnd(words.length)] + (rnd(3) === 0 ? '' : ' ')).join('');
      const a = pageDoc([{ parts: [text] }, { parts: [text.slice(0, 40)] }]);
      const b = new Y.Doc();
      sync(a, b);
      const quiet = rnd(5) === 0;
      const aDeletes: Y.Transaction['deleteSet'][] = [];
      a.on('afterTransaction', (tr: Y.Transaction) => {
        if (tr.origin === ORIGIN) aDeletes.push(tr.deleteSet);
      });
      const typeB = () => {
        if (quiet) return;
        const g = b.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
        const yt = ((g.get(rnd(g.length)) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlText;
        if (rnd(4) === 0 && yt.length > 3) yt.delete(rnd(yt.length - 2), 1 + rnd(2));
        else yt.insert(rnd(yt.length + 1), `{${seed}}`);
      };
      const replacement = rnd(3) === 0 ? '' : 'Camera';
      const { records } = replace(a, 'camara', replacement);
      const replaced = xml(a);
      if (rnd(2)) sync(a, b);
      undo(a, records);
      for (let i = rnd(4); i > 0; i--) typeB();
      if (rnd(2)) sync(a, b);
      for (let i = rnd(3); i > 0; i--) typeB();
      redo(a, records);
      for (let i = rnd(3); i > 0; i--) typeB();
      sync(a, b);
      expect(xml(a)).toBe(xml(b));
      if (quiet) {
        expect(xml(a)).toBe(replaced);
        quietRuns++;
      }
      for (const struct of b.store.clients.get(b.clientID) ?? []) {
        for (let c = struct.id.clock; c < struct.id.clock + struct.length; c++) {
          if (aDeletes.some((ds) => Y.isDeleted(ds, Y.createID(b.clientID, c)))) lost++;
        }
      }
    }
    expect(lost).toBe(0);
    expect(quietRuns).toBeGreaterThan(SEEDS / 10);
  });
});
