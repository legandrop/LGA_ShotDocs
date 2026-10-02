// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { builtinBlocks } from '../templates/builtin';
import { connect, mountEditor, pmFromY, undoManager, unmountAll, view, yText, type Editor } from '../ui/collabHarness';
import { schema as mainSchema } from '../ui/fixtures/editorSchemaMain';
import type { AssistantEditor } from '../assistant/assistantUi';
import { shotTemplate, validateAnswer, type Change } from './answer';
import { addToSummary, applyChanges, undoApplied } from './applyPlan';
import { answer, cellText, mapOf, rowCount, reportBlocks, reportEditor, targetBy, WORDS } from './fixtures/report';
import type { PageMap } from './pageMap';

// Aplicar con el editor real (Docs/Doc_Dictado.md, 5.5; pruebas 10.1.3 y 10.1.4): cada operación, un solo paso de
// deshacer, la guarda (otro escribe en la misma celda → no aplica nada; en otra → aplica y conserva), la fila nueva como
// UNA inserción (lo que otro escribe sin red en otra fila queda), y la página aplicada abierta con el esquema publicado.

afterEach(unmountAll);

const settle = () => new Promise((r) => setTimeout(r, 0));
const photo = (name: string) => ({ type: 'photo', props: { url: `sdmedia://${name}`, name: `${name}.jpg`, w: 0.3 } });
const BUILTIN_EN = { word: 'Shot', checks: ['Clean plate', 'HDRI'] };

function plan(map: PageMap, changes: unknown[], note = 'nota'): Change[] {
  const p = validateAnswer(answer(changes), map, { note, words: WORDS }, BUILTIN_EN);
  if (typeof p === 'string') throw new Error(p);
  expect(p.unplaced).toEqual([]);
  return p.changes;
}

function apply(ed: Editor, map: PageMap, changes: Change[]) {
  return applyChanges(view(ed), ed as unknown as AssistantEditor, map, changes, true, shotTemplate(map, BUILTIN_EN));
}

const blockText = (ed: Editor, id: string) => {
  const content = ed.getBlock(id)?.content;
  return Array.isArray(content) ? (content as { text?: string }[]).map((c) => c.text ?? '').join('') : '';
};

describe('aplicar', () => {
  it('setCell en una celda vacía: escribe, es UN paso de deshacer y Undo de la hoja lo saca', () => {
    const ed = reportEditor();
    const map = mapOf(ed);
    const changes = plan(map, [{ op: 'setCell', at: 'T3 r3 c3', row: '12 · 010 · 3', col: 'Lens · Filters', old: '', new: '50 mm' }]);
    const before = undoManager(ed).undoStack.length;
    const res = apply(ed, map, changes);
    expect(res.ok).toBe(true);
    expect(cellText(ed, 3, 3, 3)).toBe('50 mm');
    expect(undoManager(ed).undoStack.length).toBe(before + 1);
    expect(res.ok && undoApplied(view(ed), res.undo)).toBe(true);
    expect(cellText(ed, 3, 3, 3)).toBe('');
  });

  it('setCell en una celda con texto, por diferencias: lo que no cambia queda (con su formato)', () => {
    const blocks = reportBlocks('en', {
      setups: [['12 · 010 · 1', '', [{ type: 'text', text: 'ND .6', styles: { bold: true } }], '', '', '', '']],
    });
    const ed = reportEditor(blocks);
    const map = mapOf(ed);
    const changes = plan(map, [{ op: 'setCell', at: 'T3 r2 c3', row: '12 · 010 · 1', col: 'Lens · Filters', old: 'ND .6', new: '50 mm · ND .6' }]);
    expect(apply(ed, map, changes).ok).toBe(true);
    expect(cellText(ed, 3, 2, 3)).toBe('50 mm · ND .6');
    // "ND .6" sigue en negrita: no se borró ni se volvió a escribir.
    const cell = view(ed).state.doc.resolve(mapOf(ed).targets.get('T3 r2 c3')!.start).parent;
    const bold = [] as string[];
    cell.forEach((n) => n.marks.some((m) => m.type.name === 'bold') && bold.push(n.text!));
    expect(bold.join('')).toBe('ND .6');
  });

  it('setCell en una celda con una foto: la foto queda', () => {
    const blocks = reportBlocks('en', { setups: [['12 · 010 · 1', '', '', '', '', '', [photo('toma'), { type: 'text', text: ' 3', styles: {} }]]] });
    const ed = reportEditor(blocks);
    const map = mapOf(ed);
    expect(map.targets.get('T3 r2 c7')!.text).toBe('⟦photo:1⟧ 3');
    const changes = plan(map, [{ op: 'setCell', at: 'T3 r2 c7', row: '12 · 010 · 1', col: 'Circled takes · Notes', old: '⟦photo:1⟧ 3', new: '⟦photo:1⟧ 3, 4' }]);
    expect(apply(ed, map, changes).ok).toBe(true);
    expect(cellText(ed, 3, 2, 7)).toBe(' 3, 4');
    expect(JSON.stringify(view(ed).state.doc.toJSON())).toContain('sdmedia://toma');
  });

  it('setText después de "Afternoon:" y en una pregunta ("Director: ")', () => {
    const ed = reportEditor();
    const map = mapOf(ed);
    const afternoon = targetBy(map, (t) => t.label === 'Afternoon:');
    const director = targetBy(map, (t) => t.label === 'Director:');
    const changes = plan(map, [
      { op: 'setText', at: afternoon.addr, label: 'Afternoon:', old: '', new: 'rain' },
      { op: 'setText', at: director.addr, label: 'Director:', old: '', new: 'Director: wants one more take' },
    ]);
    expect(apply(ed, map, changes).ok).toBe(true);
    expect(blockText(ed, afternoon.blockId)).toBe('Afternoon: rain');
    expect(blockText(ed, director.blockId)).toBe('Director: wants one more take');
    expect(ed.getBlock(director.blockId)?.props).toMatchObject({ question: true });
  });

  it('addRow en el medio y al final: UNA fila nueva insertada, con sus celdas', () => {
    const ed = reportEditor();
    const map = mapOf(ed);
    const changes = plan(map, [{ op: 'addRow', table: 'T3', after: 'r2', row: '12 · 010 · 1', cells: { Slate: '12 · 010 · 2', 'Lens · Filters': '40 mm' } }]);
    expect(apply(ed, map, changes).ok).toBe(true);
    expect([cellText(ed, 3, 3, 1), cellText(ed, 3, 3, 3), cellText(ed, 3, 4, 1)]).toEqual(['12 · 010 · 2', '40 mm', '12 · 010 · 3']);
    undoManager(ed).stopCapturing();
    const map2 = mapOf(ed);
    const last = plan(map2, [{ op: 'addRow', table: 'T3', after: 'r5', row: '', cells: { c1: '12 · 011 · 1' } }]);
    expect(apply(ed, map2, last).ok).toBe(true);
    expect(cellText(ed, 3, 6, 1)).toBe('12 · 011 · 1');
    ed.undo();
    expect(rowCount(ed, 3)).toBe(5);
  });

  it('la fila vacía de la plantilla se prefiere: setCell en r4 con la Slate nueva', () => {
    const ed = reportEditor();
    const map = mapOf(ed);
    const changes = plan(
      map,
      [
        { op: 'setCell', at: 'T3 r4 c1', row: '', col: 'Slate', old: '', new: '12 · 010 · 4' },
        { op: 'setCell', at: 'T3 r4 c3', row: '12 · 010 · 4', col: 'Lens · Filters', old: '', new: '50 mm' },
      ],
      'el 12_010 setup 4 con un 50',
    );
    expect(apply(ed, map, changes).ok).toBe(true);
    expect([cellText(ed, 3, 4, 1), cellText(ed, 3, 4, 3)]).toEqual(['12 · 010 · 4', '50 mm']);
  });

  it('addShotSection en inglés, en castellano y desde una plantilla propia (copia la de la página)', () => {
    for (const lang of ['en', 'es'] as const) {
      const ed = reportEditor(reportBlocks(lang));
      // La sección vacía de la plantilla ya se usó (otro plano): hay que agregar una.
      const map0 = mapOf(ed);
      const heading = map0.shots[0].heading;
      const word = lang === 'es' ? 'Plano' : 'Shot';
      expect(apply(ed, map0, plan(map0, [{ op: 'setText', at: heading.addr, label: '', old: heading.text, new: `${word} 12_011` }])).ok).toBe(true);
      const map = mapOf(ed);
      const checks = lang === 'es' ? ['Placa limpia', 'HDRI'] : ['Clean plate', 'HDRI'];
      const changes = plan(map, [{ op: 'addShotSection', shot: '12_010', checks }], 'el 12_010');
      expect(apply(ed, map, changes).ok).toBe(true);
      const shape = ed.document.map((b) => [b.type, blockText(ed, b.id), (b.props as { checked?: boolean }).checked]);
      const at = shape.findIndex(([, text]) => text === `${word} 12_010`);
      expect(at, lang).toBeGreaterThan(0);
      // Después de la sección del 12_011 (y antes del párrafo vacío y el título siguiente), con las once casillas.
      expect(shape.findIndex(([, text]) => text === `${word} 12_011`)).toBeLessThan(at);
      expect(shape.slice(at + 1, at + 3)).toEqual([
        ['checkListItem', checks[0], true],
        ['checkListItem', 'HDRI', true],
      ]);
      expect(shape.slice(at + 1, at + 12).every(([type]) => type === 'checkListItem')).toBe(true);
      expect(shape[at + 3][2]).toBe(false);
      unmountAll();
    }
    // Plantilla propia: la sección de la página tiene otras casillas; la nueva copia esas.
    const own = [
      { type: 'heading', props: { level: 2 }, content: 'VFX shots' },
      { type: 'heading', props: { level: 3 }, content: 'Shot 10_001' },
      { type: 'checkListItem', props: { checked: true }, content: 'Plate' },
      { type: 'checkListItem', props: { checked: false }, content: 'Gray ball' },
    ];
    const ed = reportEditor(own);
    const map = mapOf(ed);
    expect(apply(ed, map, plan(map, [{ op: 'addShotSection', shot: '10_002', checks: ['Gray ball'] }], 'el 10_002')).ok).toBe(true);
    expect(ed.document.map((b) => [blockText(ed, b.id), (b.props as { checked?: boolean }).checked]).slice(4, 7)).toEqual([
      ['Shot 10_002', undefined],
      ['Plate', false],
      ['Gray ball', true],
    ]);
  });

  it('check y appendText (un párrafo vacío se llena; uno con texto suma otro debajo)', () => {
    const ed = reportEditor();
    const map = mapOf(ed);
    const hdri = targetBy(map, (t) => t.code === 'K' && t.plain === 'HDRI');
    const changes = plan(map, [
      { op: 'check', at: hdri.addr, label: 'HDRI' },
      { op: 'appendText', at: map.summary!.addr, text: 'Mañana nublada.' },
    ]);
    expect(apply(ed, map, changes).ok).toBe(true);
    expect(ed.getBlock(hdri.blockId)?.props).toMatchObject({ checked: true });
    const summaryAt = ed.document.findIndex((b) => b.id === map.summary!.blockId);
    expect(blockText(ed, ed.document[summaryAt + 1].id)).toBe('Mañana nublada.');
    undoManager(ed).stopCapturing();
    const map2 = mapOf(ed);
    const p = targetBy(map2, (t) => t.plain === 'Mañana nublada.');
    expect(apply(ed, map2, plan(map2, [{ op: 'appendText', at: p.addr, text: 'Llovió a la tarde.' }])).ok).toBe(true);
    expect([blockText(ed, ed.document[summaryAt + 1].id), blockText(ed, ed.document[summaryAt + 2].id)]).toEqual(['Mañana nublada.', 'Llovió a la tarde.']);
    // Add to Summary: en la sección, debajo de lo que hay.
    expect(addToSummary(view(ed), ed as unknown as AssistantEditor, map2.summary!.blockId, 'El DP pidió otra toma', true)).toBe(true);
    expect(blockText(ed, ed.document[summaryAt + 3].id)).toBe('El DP pidió otra toma');
  });

  it('la guarda: si otro escribió en una de las celdas, no aplica nada; si escribió en otra, aplica y conserva lo suyo', () => {
    const ed = reportEditor();
    const map = mapOf(ed);
    const changes = plan(map, [
      { op: 'setCell', at: 'T3 r3 c3', row: '12 · 010 · 3', col: 'Lens · Filters', old: '', new: '50 mm' },
      { op: 'setCell', at: 'T3 r3 c4', row: '12 · 010 · 3', col: 'T-stop · Focus', old: '', new: 'T2.8' },
    ]);
    const v = view(ed);
    // Otro escribe en la celda de T-stop mientras el modelo pensaba.
    v.dispatch(v.state.tr.insertText('T4', map.targets.get('T3 r3 c4')!.start));
    const res = apply(ed, map, changes);
    expect(res).toEqual({ ok: false, reason: 'changed' });
    expect([cellText(ed, 3, 3, 3), cellText(ed, 3, 3, 4)]).toEqual(['', 'T4']);
    // En otra celda: aplica y lo de otro queda.
    const map2 = mapOf(ed);
    const again = plan(map2, [{ op: 'setCell', at: 'T3 r3 c3', row: '12 · 010 · 3', col: 'Lens · Filters', old: '', new: '50 mm' }]);
    v.dispatch(v.state.tr.insertText('B', map2.targets.get('T3 r3 c2')!.start));
    expect(apply(ed, map2, again).ok).toBe(true);
    expect([cellText(ed, 3, 3, 2), cellText(ed, 3, 3, 3), cellText(ed, 3, 3, 4)]).toEqual(['B', '50 mm', 'T4']);
  });

  it('la guarda de una casilla: si otro la tildó, no aplica', () => {
    const ed = reportEditor();
    const map = mapOf(ed);
    const hdri = targetBy(map, (t) => t.code === 'K' && t.plain === 'HDRI');
    const changes = plan(map, [{ op: 'check', at: hdri.addr, label: 'HDRI' }]);
    ed.updateBlock(hdri.blockId, { props: { checked: true } } as never);
    expect(apply(ed, map, changes)).toEqual({ ok: false, reason: 'changed' });
  });

  it('sin permiso de editar, no aplica', () => {
    const ed = reportEditor();
    const map = mapOf(ed);
    const changes = plan(map, [{ op: 'setCell', at: 'T3 r3 c3', row: '12 · 010 · 3', col: 'Lens · Filters', old: '', new: '50 mm' }]);
    expect(applyChanges(view(ed), ed as unknown as AssistantEditor, map, changes, false, BUILTIN_EN)).toEqual({ ok: false, reason: 'readOnly' });
    expect(cellText(ed, 3, 3, 3)).toBe('');
  });

  it('Undo de la hoja no deshace si hubo otra edición después', () => {
    const ed = reportEditor();
    const map = mapOf(ed);
    const res = apply(ed, map, plan(map, [{ op: 'setCell', at: 'T3 r3 c3', row: '12 · 010 · 3', col: 'Lens · Filters', old: '', new: '50 mm' }]));
    undoManager(ed).stopCapturing();
    const v = view(ed);
    v.dispatch(v.state.tr.insertText('x', mapOf(ed).summary ? targetBy(mapOf(ed), (t) => t.code === 'P' && t.section === 'Summary').start : 1));
    expect(res.ok && undoApplied(v, res.undo)).toBe(false);
    expect(cellText(ed, 3, 3, 3)).toBe('50 mm');
  });

  it('editar a la vez: otro escribe SIN RED en otra fila mientras se agrega una fila → lo suyo queda', async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const link = connect(docA, docB, 'sync');
    const a = reportEditor(reportBlocks(), docA, 'a');
    await settle();
    const b = mountEditor(docB, 'b');
    await settle();
    link.offline();
    // B, sin red, escribe en la fila del 12 · 010 · 1.
    const mapB = mapOf(b);
    view(b).dispatch(view(b).state.tr.insertText('B · A001C004', mapB.targets.get('T3 r2 c2')!.start + 'A · A001C003'.length));
    // A agrega una fila después de la del 12 · 010 · 3.
    const mapA = mapOf(a);
    expect(apply(a, mapA, plan(mapA, [{ op: 'addRow', table: 'T3', after: 'r3', row: '12 · 010 · 3', cells: { Slate: '12 · 010 · 5' } }])).ok).toBe(true);
    link.online();
    await settle();
    for (const ed of [a, b]) {
      expect(cellText(ed, 3, 2, 2)).toBe('A · A001C003B · A001C004');
      expect(cellText(ed, 3, 4, 1)).toBe('12 · 010 · 5');
    }
    expect(JSON.stringify(view(a).state.doc.toJSON())).toBe(JSON.stringify(view(b).state.doc.toJSON()));
  });

  it('la página aplicada se abre igual con el esquema publicado (una versión vieja no borra nada)', async () => {
    const doc = new Y.Doc();
    const ed = reportEditor(reportBlocks(), doc);
    const map = mapOf(ed);
    const hdri = targetBy(map, (t) => t.code === 'K' && t.plain === 'HDRI');
    const changes = plan(
      map,
      [
        { op: 'setCell', at: 'T3 r3 c3', row: '12 · 010 · 3', col: 'Lens · Filters', old: '', new: '50 mm' },
        { op: 'addRow', table: 'T3', after: 'r4', row: '', cells: { Slate: '12 · 010 · 5' } },
        { op: 'check', at: hdri.addr, label: 'HDRI' },
        { op: 'setText', at: targetBy(map, (t) => t.label === 'Afternoon:').addr, label: 'Afternoon:', old: '', new: 'lluvia' },
        { op: 'addShotSection', shot: '12_011', checks: ['HDRI'] },
      ],
      'el 12_011',
    );
    expect(apply(ed, map, changes).ok).toBe(true);
    await settle();
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    const before = yText(copy);
    const old = mountEditor(copy, 'old', mainSchema);
    await settle();
    expect(yText(copy)).toBe(before);
    expect(view(old).state.doc.eq(pmFromY(old, copy))).toBe(true);
    expect(before).toContain('12 · 010 · 5');
    expect(before).toContain('Shot 12_011');
    expect(before).toContain('lluvia');
  });

  it('un On-Set Report con las plantillas de fábrica como bloques sigue siendo los mismos tipos (ningún tipo nuevo)', () => {
    const types = new Set(builtinBlocks('onset', 'en').map((b) => b.type));
    expect([...types].sort()).toEqual(['bulletListItem', 'checkListItem', 'heading', 'paragraph', 'table']);
  });
});

describe('aplicar, correcciones de la auditoría', () => {
  it('X11: la guarda mira que el lugar siga en el mismo bloque', () => {
    const ed = reportEditor();
    const map = mapOf(ed);
    const [change] = plan(map, [{ op: 'setCell', at: 'T3 r3 c3', row: '12 · 010 · 3', col: 'Lens · Filters', old: '', new: '50 mm' }]);
    // El mismo contenido (vacío) pero de otro bloque: no es el lugar de la foto.
    const moved = { ...change, target: { ...change.target!, blockId: 'otro-bloque' } };
    expect(apply(ed, map, [moved])).toEqual({ ok: false, reason: 'changed' });
    expect(cellText(ed, 3, 3, 3)).toBe('');
  });

  it('X12 y O3: un Apply que falla a mitad no deja nada, ni en la página ni en rehacer', () => {
    const ed = reportEditor();
    const map = mapOf(ed);
    const summary = targetBy(map, (t) => t.code === 'P' && t.section === 'Summary');
    // Armados a mano (el validador ya no deja dos cambios al mismo lugar): agregar llena el párrafo vacío primero y
    // después escribir en él falla la guarda.
    const [write] = plan(map, [{ op: 'setText', at: summary.addr, label: '', old: '', new: 'nublado' }]);
    const [add] = plan(map, [{ op: 'appendText', at: summary.addr, text: 'llovió' }]);
    const before = JSON.stringify(view(ed).state.doc.toJSON());
    const um = undoManager(ed);
    const undoBefore = um.undoStack.length;
    expect(apply(ed, map, [write, add])).toEqual({ ok: false, reason: 'failed' });
    expect(JSON.stringify(view(ed).state.doc.toJSON())).toBe(before);
    expect(um.undoStack.length).toBe(undoBefore);
    expect(um.redoStack.length).toBe(0);
  });
});

describe('aplicar, re-verificación', () => {
  it('N2: dos appendText al mismo título y dos debajo del mismo párrafo quedan en el orden de la respuesta', () => {
    const ed = reportEditor();
    const map = mapOf(ed);
    const summary = targetBy(map, (t) => t.code === 'H2' && t.plain === 'Summary');
    const camera = targetBy(map, (t) => t.code === 'H2' && t.plain === 'Camera package');
    expect(
      apply(
        ed,
        map,
        plan(map, [
          { op: 'appendText', at: summary.addr, text: 'uno' },
          { op: 'appendText', at: summary.addr, text: 'dos' },
          { op: 'appendText', at: summary.addr, text: 'tres' },
          { op: 'appendText', at: camera.addr, text: 'cuatro' },
        ]),
      ).ok,
    ).toBe(true);
    const texts = ed.document.map((b) => blockText(ed, b.id));
    const at = texts.indexOf('Summary');
    expect(texts.slice(at + 1, at + 4)).toEqual(['uno', 'dos', 'tres']);
    undoManager(ed).stopCapturing();
    // Debajo de un párrafo con texto.
    const map2 = mapOf(ed);
    const uno = targetBy(map2, (t) => t.plain === 'uno');
    expect(apply(ed, map2, plan(map2, [{ op: 'appendText', at: uno.addr, text: 'a' }, { op: 'appendText', at: uno.addr, text: 'b' }])).ok).toBe(true);
    const after = ed.document.map((b) => blockText(ed, b.id));
    expect(after.slice(at + 1, at + 6)).toEqual(['uno', 'a', 'b', 'dos', 'tres']);
  });

  it('N3: si había algo para rehacer, un Apply que falla a mitad tampoco deja nada en rehacer', () => {
    const ed = reportEditor();
    const map0 = mapOf(ed);
    const v = view(ed);
    // Algo escrito y deshecho: queda para rehacer.
    v.dispatch(v.state.tr.insertText('x', map0.targets.get('T1 r4 c2')!.start));
    const um = undoManager(ed);
    um.stopCapturing();
    um.undo();
    expect(um.redoStack.length).toBe(1);
    const map = mapOf(ed);
    const summary = targetBy(map, (t) => t.code === 'P' && t.section === 'Summary');
    const [write] = plan(map, [{ op: 'setText', at: summary.addr, label: '', old: '', new: 'nublado' }]);
    const [add] = plan(map, [{ op: 'appendText', at: summary.addr, text: 'llovió' }]);
    const before = JSON.stringify(v.state.doc.toJSON());
    expect(apply(ed, map, [write, add])).toEqual({ ok: false, reason: 'failed' });
    expect(JSON.stringify(view(ed).state.doc.toJSON())).toBe(before);
    // Rehacer no vuelve a poner lo aplicado a medias.
    while (um.redoStack.length) um.redo();
    expect(JSON.stringify(view(ed).state.doc.toJSON())).not.toContain('llovió');
  });
});
