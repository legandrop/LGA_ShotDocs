// @vitest-environment jsdom
import type { PartialBlock } from '@blocknote/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { connect, mountEditor, pmFromY, posOf, typeAt, undoManager, unmountAll, view, yText, type Editor } from '../ui/collabHarness';
import { schema as mainSchema } from '../ui/fixtures/editorSchemaMain';
import type { AssistantEditor } from './assistantUi';
import { applyFormat, planFormat, takeFormatSnapshot, type FormatPlan, type FormatSnapshot, type FormatTarget } from './format';
import { buildRequest } from './prompt';

// *Format as…* con el editor real (Docs/Doc_Asistente.md, entrega A2, 6.3, 6.5 y pruebas 5 y 6 de la sección 13): solo
// los tipos que ya existen; cambiar solo el tipo conserva id, hijos y colores; partir en bloques nuevos saca los viejos
// en la misma edición; un paso de deshacer; la guarda; los bloques con hijos; y la versión publicada abriendo el
// resultado.

afterEach(unmountAll);

const settle = () => new Promise((r) => setTimeout(r, 0));
const photo = (name: string) => ({ type: 'photo', props: { url: `sdmedia://${name}`, name: `${name}.jpg`, w: 0.3 } });
const ed$ = (ed: Editor) => ed as unknown as AssistantEditor;

function page(blocks: unknown[], doc = new Y.Doc()): Editor {
  const ed = mountEditor(doc);
  ed.replaceBlocks(ed.document, blocks as PartialBlock[]);
  undoManager(ed).stopCapturing();
  return ed;
}

function select(ed: Editor, fromId: string, a: number, toId: string, b: number): void {
  const v = view(ed);
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, posOf(ed, fromId) + 2 + a, posOf(ed, toId) + 2 + b)));
}

function snap(ed: Editor): FormatSnapshot {
  const s = takeFormatSnapshot(view(ed).state, ed$(ed));
  if (typeof s === 'string') throw new Error(s);
  return s;
}

function plan(fs: FormatSnapshot, text: string, target?: FormatTarget): FormatPlan {
  const p = planFormat(text, fs, target);
  if (typeof p === 'string') throw new Error(p);
  if ('lost' in p) throw new Error(`lost: ${p.lost.join(', ')}`);
  return p;
}

const textOf = (ed: Editor, id: string) =>
  ((ed.getBlock(id)?.content ?? []) as { type: string; text?: string; content?: { text: string }[] }[])
    .map((c) => (c.type === 'photo' ? '[foto]' : c.type === 'link' ? (c.content ?? []).map((x) => x.text).join('') : c.text ?? ''))
    .join('');

const shape = (ed: Editor) =>
  ed.document.map((b) => [b.type, ((b.content ?? []) as { type: string; text?: string }[]).map((c) => (c.type === 'photo' ? '[foto]' : c.text ?? '')).join('')]);

/** Respuestas de prueba con los identificadores explícitos de su captura; los oráculos quedan independientes. */
function wireAnswer(fs: FormatSnapshot, markdown: (token: (id: number) => string) => string, spans: { origin: string; text: string }[]): string {
  const token = (id: number) => `SD${fs.origins.nonce}R${id}END`;
  return JSON.stringify({ version: 1, nonce: fs.origins.nonce, markdown: markdown(token), spans: spans.map((span, id) => ({ id, ...span })) });
}
describe('Format as…: lo que se manda', () => {
  it('se estira a bloques enteros: el pedido lleva los bloques tocados completos, nada más', () => {
    const ed = page([
      { id: 'a', type: 'paragraph', content: 'Lente 35 mm' },
      { id: 'b', type: 'paragraph', content: 'T2.8 e ISO 800' },
      { id: 'c', type: 'paragraph', content: 'Presupuesto interno: no mandar' },
    ]);
    select(ed, 'a', 3, 'b', 2);
    const fs = snap(ed);
    expect(fs.ids).toEqual(['a', 'b']);
    const req = buildRequest('format', fs.snapshot.selected, { format: 'checklist' });
    expect(req.user).toContain('<user_content>\nLente 35 mm\n\nT2.8 e ISO 800\n</user_content>');
    expect(req.user).not.toContain('Presupuesto');
    expect(req.system).toContain('checklist');
  });

  it('adentro de una celda de tabla no se puede', () => {
    const ed = page([{ id: 't', type: 'table', content: { type: 'tableContent', rows: [{ cells: ['uno', 'dos'] }] } }]);
    const v = view(ed);
    let cellPos = -1;
    v.state.doc.descendants((n, pos) => {
      if (cellPos < 0 && n.type.name === 'tableParagraph') cellPos = pos + 1;
      return cellPos < 0;
    });
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, cellPos, cellPos + 2)));
    expect(takeFormatSnapshot(v.state, ed$(ed))).toBe('inTable');
  });
});

describe('Format as…: aplicar', () => {
  it.each([
    ['## INT. SET - DÍA', 'type', true],
    ['## INT. SET — DÍA', 'update', true],
    ['- INT. SET - DÍA', 'type', true],
    ['[ ] INT. SET - DÍA', 'type', true],
    ['INT. SET - DÍA', 'type', false],
    ['INT. SET — DÍA', 'update', false],
    ['INT. SET\n\nDÍA', 'replace', true],
    ['| Escena |\n|---|\n| INT. SET - DÍA |', 'replace', true],
  ])('Script: %s detecta su pérdida real en modo %s (%s)', (answer, mode, removes) => {
    const ed = page([{ id: 'p', type: 'paragraph', props: { script: true }, content: 'INT. SET - DÍA' }]);
    select(ed, 'p', 0, 'p', 13);
    const fs = snap(ed);
    const before = JSON.stringify(ed.document);
    const p = plan(fs, answer);
    expect(p.mode).toBe(mode);
    expect(p.removesScript).toBe(removes);
    expect(JSON.stringify(ed.document)).toBe(before);
    expect(applyFormat(ed$(ed), view(ed), fs, p, true).ok).toBe(true);
    expect(ed.document.some((b) => (b.props as Record<string, unknown>).script === true)).toBe(!removes);
    if (JSON.stringify(ed.document) !== before) ed.undo();
    expect(JSON.stringify(ed.document)).toBe(before);
  });

  it('un Script afuera de lo elegido no causa aviso; cambiarlo después del pedido bloquea Apply', () => {
    const ed = page([
      { id: 'p', type: 'paragraph', content: 'INT. SET - DÍA' },
      { id: 'q', type: 'paragraph', props: { script: true }, content: 'afuera' },
    ]);
    select(ed, 'p', 0, 'p', 13);
    const fs = snap(ed);
    const p = plan(fs, '## INT. SET - DÍA');
    expect(p.removesScript).toBe(false);
    ed.updateBlock('p', { props: { script: true } } as never);
    const before = JSON.stringify(ed.document);
    expect(applyFormat(ed$(ed), view(ed), fs, p, true)).toEqual({ ok: false, reason: 'changed' });
    expect(JSON.stringify(ed.document)).toBe(before);
  });

  it('Checklist sobre tres renglones: solo cambia el tipo; ids, hijos, colores y fotos quedan; un paso de deshacer', () => {
    const ed = page([
      { id: 'a', type: 'paragraph', props: { textColor: 'blue' }, content: 'Pedir el LiDAR', children: [{ id: 'h', type: 'paragraph', content: 'detalle' }] },
      { id: 'b', type: 'paragraph', content: [{ type: 'text', text: 'Fotos de ', styles: { bold: true } }, photo('set')] },
      { id: 'c', type: 'paragraph', content: 'Medir el set' },
    ]);
    select(ed, 'a', 0, 'c', 12);
    const fs = snap(ed);
    // Lo elegido incluye el hijo de 'a': vuelve como un renglón más (y cambia de tipo adentro de 'a').
    const p = plan(fs, '[ ] Pedir el LiDAR\n[ ] detalle\n[x] **Fotos de** ⟦photo:1⟧\n[ ] Medir el set');
    expect(p.mode).toBe('type');
    const before = undoManager(ed).undoStack.length;
    const out = applyFormat(ed$(ed), view(ed), fs, p, true);
    expect(out).toEqual({ ok: true, changed: 4 });
    expect(undoManager(ed).undoStack.length).toBe(before + 1);
    expect(ed.document.map((b) => [b.id, b.type, (b.props as { checked?: boolean }).checked])).toEqual([
      ['a', 'checkListItem', false],
      ['b', 'checkListItem', true],
      ['c', 'checkListItem', false],
    ]);
    expect((ed.getBlock('a')!.props as { textColor: string }).textColor).toBe('blue');
    expect(ed.getBlock('a')!.children.map((c) => [c.id, c.type])).toEqual([['h', 'checkListItem']]);
    expect(textOf(ed, 'b')).toBe('Fotos de [foto]');
    ed.undo();
    expect(ed.document.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
    expect(textOf(ed, 'b')).toBe('Fotos de [foto]');
  });

  it('Bulleted list que parte un párrafo en ítems: bloques nuevos en lugar del viejo, la foto en línea sigue, un deshacer', () => {
    const ed = page([
      { id: 'x', type: 'paragraph', content: 'Antes' },
      { id: 'p', type: 'paragraph', content: [{ type: 'text', text: 'Lente 35 mm, T2.8 e ISO 800 ', styles: {} }, photo('slate')] },
      { id: 'y', type: 'paragraph', content: 'Después' },
    ]);
    select(ed, 'p', 0, 'p', 5);
    const fs = snap(ed);
    const p = plan(fs, wireAnswer(fs, (t) => `- ${t(0)}\n- ${t(1)}\n- ${t(2)}⟦photo:1⟧`, [{ origin: 'r0', text: 'Lente 35 mm' }, { origin: 'r0', text: 'T2.8' }, { origin: 'r0', text: 'ISO 800 ' }]));
    expect(p.mode).toBe('replace');
    const out = applyFormat(ed$(ed), view(ed), fs, p, true);
    expect(out.ok).toBe(true);
    expect(shape(ed)).toEqual([
      ['paragraph', 'Antes'],
      ['bulletListItem', 'Lente 35 mm'],
      ['bulletListItem', 'T2.8'],
      ['bulletListItem', 'ISO 800 [foto]'],
      ['paragraph', 'Después'],
    ]);
    // Sin ids repetidos; el primer bloque nuevo hereda el id del que reemplaza (un comentario anclado ahí sigue con bloque).
    const ids = ed.document.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[1]).toBe('p');
    ed.undo();
    expect(shape(ed)).toEqual([
      ['paragraph', 'Antes'],
      ['paragraph', 'Lente 35 mm, T2.8 e ISO 800 [foto]'],
      ['paragraph', 'Después'],
    ]);
  });

  it('Table: una tabla de verdad con encabezado; una foto-bloque elegida vuelve tal cual, con su id', () => {
    const ed = page([
      { id: 'a', type: 'paragraph', content: 'Toma 1: 35 mm' },
      { id: 'img', type: 'image', props: { url: 'sdmedia://croquis', name: 'croquis.jpg' } },
      { id: 'b', type: 'paragraph', content: 'Toma 2: 50 mm' },
    ]);
    select(ed, 'a', 0, 'b', 13);
    const fs = snap(ed);
    expect(fs.snapshot.selected.markdown).toBe('Toma 1: 35 mm\n\n⟦block:1⟧\n\nToma 2: 50 mm');
    const p = plan(fs, '| Toma | Lente |\n|---|---|\n| 1 | 35 mm |\n| 2 | 50 mm |\n⟦block:1⟧', 'table');
    expect(applyFormat(ed$(ed), view(ed), fs, p, true).ok).toBe(true);
    expect(ed.document.map((b) => b.type)).toEqual(['table', 'image']);
    // La tabla hereda el id del primer renglón ('a'); el segundo ('b') sale (sus comentarios quedan sin bloque).
    expect(ed.document.map((b) => b.id)).toEqual(['a', 'img']);
    const table = ed.document[0] as unknown as { content: { headerRows?: number; rows: { cells: { content: { text: string }[] }[] }[] } };
    expect(table.content.headerRows).toBe(1);
    expect(table.content.rows.map((r) => r.cells.map((c) => c.content.map((x) => x.text).join('')))).toEqual([
      ['Toma', 'Lente'],
      ['1', '35 mm'],
      ['2', '50 mm'],
    ]);
    const img = ed.getBlock('img')!;
    expect((img.props as { url: string }).url).toBe('sdmedia://croquis');
  });

  it('Headings con el mismo texto y la misma cantidad: cambia el tipo; con otro texto, tipo y texto (mismos ids)', () => {
    const ed = page([
      { id: 'a', type: 'paragraph', content: 'Cámara' },
      { id: 'b', type: 'paragraph', content: 'Lente de 35 mm' },
    ]);
    select(ed, 'a', 0, 'b', 14);
    const fs = snap(ed);
    const p = plan(fs, '## Cámara:\nLente de 35 mm');
    expect(p.mode).toBe('update');
    expect(applyFormat(ed$(ed), view(ed), fs, p, true)).toEqual({ ok: true, changed: 2 });
    expect(ed.document.map((b) => [b.id, b.type, textOf(ed, b.id)])).toEqual([
      ['a', 'heading', 'Cámara:'],
      ['b', 'paragraph', 'Lente de 35 mm'],
    ]);
  });

  it('si ya tienen esa forma, no cambia nada', () => {
    const ed = page([{ id: 'a', type: 'bulletListItem', content: 'uno' }]);
    select(ed, 'a', 0, 'a', 3);
    const fs = snap(ed);
    const before = undoManager(ed).undoStack.length;
    expect(applyFormat(ed$(ed), view(ed), fs, plan(fs, '- uno'), true)).toEqual({ ok: true, changed: 0 });
    expect(undoManager(ed).undoStack.length).toBe(before);
  });

  it('partir un bloque con bloques adentro no se hace (se perderían); cambiar solo su tipo sí', () => {
    const ed = page([{ id: 'a', type: 'paragraph', content: 'Lente y filtro', children: [{ id: 'h', type: 'paragraph', content: 'hijo' }] }]);
    select(ed, 'a', 0, 'a', 14);
    const fs = snap(ed);
    expect(applyFormat(ed$(ed), view(ed), fs, plan(fs, wireAnswer(fs, (t) => `- ${t(0)}\n- ${t(1)}`, [{ origin: 'r0', text: 'Lente' }, { origin: 'r0', text: 'filtro' }])), true)).toEqual({ ok: false, reason: 'nested' });
    expect(ed.getBlock('a')!.children.map((c) => c.id)).toEqual(['h']);
    expect(applyFormat(ed$(ed), view(ed), fs, plan(fs, wireAnswer(fs, (t) => `- ${t(0)}`, [{ origin: 'r0', text: 'Lente y filtro' }])), true).ok).toBe(true);
    expect(ed.getBlock('a')!.type).toBe('bulletListItem');
    expect(ed.getBlock('a')!.children.map((c) => c.id)).toEqual(['h']);
  });

  it('la guarda: si el texto o el tipo de un bloque cambió mientras pensaba, no aplica nada', () => {
    const ed = page([
      { id: 'a', type: 'paragraph', content: 'uno' },
      { id: 'b', type: 'paragraph', content: 'dos' },
    ]);
    select(ed, 'a', 0, 'b', 3);
    let fs = snap(ed);
    typeAt(ed, 'a', 3, ' más');
    expect(applyFormat(ed$(ed), view(ed), fs, plan(fs, '- uno\n- dos'), true)).toEqual({ ok: false, reason: 'changed' });
    expect(ed.document.map((b) => b.type)).toEqual(['paragraph', 'paragraph']);
    select(ed, 'a', 0, 'b', 3);
    fs = snap(ed);
    ed.updateBlock('b', { type: 'heading', props: { level: 2 } } as never);
    expect(applyFormat(ed$(ed), view(ed), fs, plan(fs, '- uno más\n- dos'), true)).toEqual({ ok: false, reason: 'changed' });
    expect(ed.document.map((b) => b.type)).toEqual(['paragraph', 'heading']);
  });

  it('la guarda mira también las propiedades: si otro tildó la casilla mientras pensaba, no aplica', () => {
    const ed = page([{ id: 'a', type: 'checkListItem', props: { checked: false }, content: 'Pedir el LiDAR' }]);
    select(ed, 'a', 0, 'a', 14);
    const fs = snap(ed);
    ed.updateBlock('a', { props: { checked: true } } as never);
    expect(applyFormat(ed$(ed), view(ed), fs, plan(fs, '- Pedir el LiDAR'), true)).toEqual({ ok: false, reason: 'changed' });
    expect(ed.getBlock('a')!.type).toBe('checkListItem');
    expect((ed.getBlock('a')!.props as { checked: boolean }).checked).toBe(true);
  });

  it('si al final un bloque no quedó como se pidió, se deshace todo y no se aplica nada', () => {
    const ed = page([
      { id: 'a', type: 'paragraph', content: 'uno' },
      { id: 'b', type: 'paragraph', content: 'dos' },
    ]);
    select(ed, 'a', 0, 'b', 3);
    const fs = snap(ed);
    // Un editor que ignora el cambio de 'b' (como si algo lo hubiera rechazado).
    const real = ed$(ed);
    const flaky = new Proxy(real, {
      get: (t, k) => (k === 'updateBlock' ? (id: string, u: unknown) => (id === 'b' ? undefined : t.updateBlock(id, u)) : Reflect.get(t, k)),
    });
    const before = undoManager(ed).undoStack.length;
    expect(applyFormat(flaky, view(ed), fs, plan(fs, '- uno\n- dos'), true)).toEqual({ ok: false, reason: 'failed' });
    expect(ed.document.map((b) => b.type)).toEqual(['paragraph', 'paragraph']);
    expect(undoManager(ed).undoStack.length).toBe(before);
  });

  it('sin Editar no aplica', () => {
    const ed = page([{ id: 'a', type: 'paragraph', content: 'uno' }]);
    select(ed, 'a', 0, 'a', 3);
    const fs = snap(ed);
    expect(applyFormat(ed$(ed), view(ed), fs, plan(fs, '- uno'), false)).toEqual({ ok: false, reason: 'readOnly' });
    ed.isEditable = false;
    expect(applyFormat(ed$(ed), view(ed), fs, plan(fs, '- uno'), true)).toEqual({ ok: false, reason: 'readOnly' });
    expect(ed.getBlock('a')!.type).toBe('paragraph');
  });

  it('B1: una respuesta que deja afuera un renglón, una palabra o una fila no se puede aplicar, y dice qué falta', () => {
    const ed = page([
      { id: 'a', type: 'paragraph', content: 'Llevar trípode' },
      { id: 'b', type: 'paragraph', content: 'Revisar baterías' },
      { id: 'c', type: 'paragraph', content: 'Confirmar locación' },
    ]);
    select(ed, 'a', 0, 'c', 18);
    const fs = snap(ed);
    // Un renglón entero.
    expect(planFormat('[ ] Llevar trípode\n[ ] Confirmar locación', fs, 'checklist')).toEqual({ lost: ['Revisar', 'baterías'] });
    // Una palabra, con la misma cantidad de bloques.
    expect(planFormat('[ ] Llevar trípode\n[ ] Revisar\n[ ] Confirmar locación', fs, 'checklist')).toEqual({ lost: ['baterías'] });
    // Una fila de una tabla.
    expect(planFormat('| Tarea |\n|---|\n| Llevar trípode |\n| Confirmar locación |', fs, 'table')).toEqual({ lost: ['Revisar', 'baterías'] });
    // Sin mayúsculas, puntuación ni formato de por medio, nada falta.
    expect('lost' in (planFormat('[ ] **llevar** trípode.\n[ ] REVISAR baterías\n[ ] confirmar, locación', fs, 'checklist') as object)).toBe(false);
    // Nada se aplicó.
    expect(ed.document.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
  });

  it('B1: las palabras que agrega la respuesta se marcan (se puede aplicar); una "y" entre ítems se puede caer', () => {
    const ed = page([{ id: 'a', type: 'paragraph', content: 'Llevar trípode y revisar baterías' }]);
    select(ed, 'a', 0, 'a', 33);
    const fs = snap(ed);
    const p = plan(fs, '- Llevar trípode\n- Revisar baterías\n- Pagar al equipo 5000 USD', 'bullets');
    const added = (p.blocks[2] as { atoms: { t: string; ch?: string }[] }).atoms.filter((a) => p.added.has(a as never)).map((a) => a.ch).join('');
    expect(added).toBe('Pagaralequipo5000USD');
    expect(p.blocks.slice(0, 2).every((b) => b.kind === 'text' && b.atoms.every((a) => !p.added.has(a)))).toBe(true);
    // Una tabla repite un rótulo una sola vez: cuenta que aparezca.
    unmountAll();
    const t = page([
      { id: 'a', type: 'paragraph', content: 'Toma 1: 35 mm' },
      { id: 'b', type: 'paragraph', content: 'Toma 2: 50 mm' },
    ]);
    select(t, 'a', 0, 'b', 13);
    const ft = snap(t);
    expect('lost' in (planFormat('| Toma | Lente |\n|---|---|\n| 1 | 35 mm |\n| 2 | 50 mm |', ft, 'table') as object)).toBe(false);
    // Fuera de una tabla, el segundo "Toma" sí cuenta.
    expect(planFormat('- Toma 1: 35 mm\n- 2: 50 mm', ft, 'bullets')).toEqual({ lost: ['Toma'] });
  });

  it('una respuesta que saca la foto o el bloque no se puede aplicar', () => {
    const ed = page([{ id: 'a', type: 'paragraph', content: [{ type: 'text', text: 'la calle ', styles: {} }, photo('calle')] }]);
    select(ed, 'a', 0, 'a', 10);
    const fs = snap(ed);
    expect(planFormat('- la calle', fs)).toBe('marker');
  });
});

describe('Format as…: editar a la vez y versiones viejas (6.5, regla del editor)', () => {
  it('Script convertido a Heading abre en el esquema anterior sin borrar texto ni la foto; Undo conserva el original', async () => {
    const doc = new Y.Doc();
    const ed = page([{ id: 'p', type: 'paragraph', props: { script: true }, content: [{ type: 'text', text: 'INT. SET - DÍA ', styles: { bold: true } }, photo('set')] }], doc);
    select(ed, 'p', 0, 'p', 15);
    const original = JSON.stringify(ed.document);
    const fs = snap(ed);
    const p = plan(fs, '## **INT. SET - DÍA** ⟦photo:1⟧', 'headings');
    expect(p.removesScript).toBe(true);
    expect(applyFormat(ed$(ed), view(ed), fs, p, true).ok).toBe(true);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    const before = yText(copy);
    const old = mountEditor(copy, 'old', mainSchema);
    await settle();
    expect(yText(copy)).toBe(before);
    expect(old.getBlock('p')?.type).toBe('heading');
    expect(textOf(old, 'p')).toBe('INT. SET - DÍA [foto]');
    ed.undo();
    expect(JSON.stringify(ed.document)).toBe(original);
  });

  it('lo que otro escribe afuera de lo elegido queda; lo que escribe SIN RED adentro de un bloque que cambió de tipo queda solo en el historial', async () => {
    const da = new Y.Doc();
    const db = new Y.Doc();
    const link = connect(da, db, 'async');
    const a = page(
      [
        { id: 'p', type: 'paragraph', content: 'uno' },
        { id: 'q', type: 'paragraph', content: 'dos' },
        { id: 'r', type: 'paragraph', content: 'afuera' },
      ],
      da,
    );
    link.flush();
    const b = mountEditor(db, 'B');
    await settle();
    link.offline();
    typeAt(b, 'p', 3, ' (de B)');
    typeAt(b, 'r', 6, ' (de B)');
    select(a, 'p', 0, 'q', 3);
    const fs = snap(a);
    expect(applyFormat(ed$(a), view(a), fs, plan(fs, '[ ] uno\n[ ] dos'), true).ok).toBe(true);
    link.online();
    link.flush();
    await settle();
    expect(yText(da)).toBe(yText(db));
    expect(view(a).state.doc.eq(pmFromY(a, da))).toBe(true);
    expect(a.document.map((x) => x.type)).toEqual(['checkListItem', 'checkListItem', 'paragraph']);
    expect(textOf(a, 'r')).toBe('afuera (de B)');
    // El texto de un bloque que cambia de tipo se rehace en Yjs: lo de B (sin red) no está en la página.
    expect(textOf(a, 'p')).toBe('uno');
  });

  it('la versión publicada de la app abre lo aplicado igual (lista, casillas y tabla), sin borrar nada', async () => {
    const doc = new Y.Doc();
    const ed = page(
      [
        { id: 'a', type: 'paragraph', content: [{ type: 'text', text: 'Toma 1 35 mm ', styles: {} }, photo('t1')] },
        { id: 'b', type: 'paragraph', content: 'Toma 2 50 mm' },
      ],
      doc,
    );
    select(ed, 'a', 0, 'b', 12);
    const fs = snap(ed);
    expect(applyFormat(ed$(ed), view(ed), fs, plan(fs, wireAnswer(fs, (t) => `## ${t(0)}\n| ${t(1)} | ${t(2)} |\n|---|---|\n| ${t(3)}⟦photo:1⟧ | ${t(4)} |\n| ${t(5)} | ${t(6)} |\n[ ] ${t(7)}`, [{ origin: 'r0', text: 'Tomas' }, { origin: 'r0', text: 'Toma' }, { origin: 'r0', text: 'Lente' }, { origin: 'r0', text: '1 ' }, { origin: 'r0', text: '35 mm' }, { origin: 'r1', text: '2' }, { origin: 'r1', text: '50 mm' }, { origin: 'r1', text: 'revisar' }]), 'table'), true).ok).toBe(true);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    const before = yText(copy);
    const old = mountEditor(copy, 'old', mainSchema);
    await settle();
    expect(yText(copy)).toBe(before);
    expect(view(old).state.doc.eq(pmFromY(old, copy))).toBe(true);
    expect(old.document.map((b) => b.type)).toEqual(['heading', 'table', 'checkListItem']);
  });
});
