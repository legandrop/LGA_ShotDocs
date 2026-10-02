// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { PageHistory, type HistoryRow } from '../sync/history';
import { versionChanges } from '../sync/historyDiff';
import { readMarks } from '../sync/historyTesting';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { editors, mountEditor, undoManager, unmountAll, view } from './collabHarness';
import { schema } from './editorSchema';
import { schema as mainSchema } from './fixtures/editorSchemaMain';
import { cleanClipboard, historyMarksExtension, markDecorations, type HistoryMarksInput } from './historyMarks';
import { TextSelection } from '@tiptap/pm/state';

// Las marcas de "Show changes" (P.18, Docs/Doc_Historial.md, entrega 2) son DECORACIONES sobre el editor de solo
// lectura que muestra la unión: no tocan el esquema ni el documento. Se prueban con el editor de hoy y con el de la
// versión publicada (fixtures/editorSchemaMain.ts): las dos lo muestran igual y ninguna escribe en la unión.

afterEach(unmountAll);

const settle = () => new Promise((r) => setTimeout(r, 0));

/** Graba cada edición del documento como una fila, cada una en su propia sesión (una hora entre filas). */
function recorder(doc: Y.Doc, who: () => string) {
  const rows: HistoryRow[] = [];
  let clock = Date.parse('2026-10-01T10:00:00Z');
  doc.on('update', (u: Uint8Array) => {
    clock += 60 * 60_000;
    rows.push({ id: rows.length + 1, seq: rows.length + 1, createdBy: who(), createdAt: new Date(clock).toISOString(), data: u });
  });
  return rows;
}

/** Una página con tres personas: Ana escribe, Bea corrige y cambia un tipo, Ana borra un bloque. */
async function page() {
  const doc = new Y.Doc();
  let who = 'ana';
  const rows = recorder(doc, () => who);
  const ed = mountEditor(doc, 'A');
  ed.replaceBlocks(ed.document, [
    { type: 'heading', content: 'Escena 64' },
    { type: 'paragraph', content: 'Ramón suelta los cubiertos.' },
    { type: 'paragraph', content: 'Plano general de la mesa.' },
    { type: 'paragraph', content: 'Nota que se borra.' },
  ] as PartialBlock[]);
  undoManager(ed).stopCapturing();
  await settle();
  const first = rows.length;
  who = 'bea';
  ed.updateBlock(ed.document[1], { content: 'Ramón suelta los cubiertos y se levanta.' });
  ed.updateBlock(ed.document[2], { type: 'heading', props: { level: 2 } } as never);
  undoManager(ed).stopCapturing();
  await settle();
  who = 'cata';
  ed.removeBlocks([ed.document[3]]);
  undoManager(ed).stopCapturing();
  await settle();
  return { rows, first };
}

function inputFor(marks: ReturnType<typeof versionChanges>['marks']): HistoryMarksInput {
  return { marks, look: (m) => ({ color: `var(--hist-${(m.row % 8) + 1})`, tip: `fila ${m.row}`, label: m.type === 'node' && m.label ? m.label.kind : undefined }) };
}

/** Lo que pinta cada decoración del texto: su clase y el texto que cubre. */
function painted(ed: BlockNoteEditor, input: HistoryMarksInput): string[] {
  const state = view(ed).state;
  const set = markDecorations(state, input);
  return set
    .find()
    .map((d) => {
      const attrs = (d as unknown as { type: { attrs: Record<string, string> } }).type.attrs ?? {};
      const node = state.doc.nodeAt(d.from);
      const isNode = String(attrs.class ?? '').startsWith('hist-node');
      const text = isNode ? `[${node?.type.name}]` : state.doc.textBetween(d.from, d.to);
      return `${attrs.class ?? 'widget'}:${text}`;
    })
    .sort();
}

describe('las marcas de Show changes en el editor', () => {
  it('se ubican sobre el texto que marcan, con el editor de hoy y con el de la versión publicada, sin escribir en la unión', async () => {
    const { rows } = await page();
    const h = new PageHistory(rows, 30 * 60_000);
    expect(h.sessions.length).toBeGreaterThanOrEqual(3);
    let checked = 0;
    for (let i = 1; i < h.sessions.length; i++) {
      const c = versionChanges(h, i);
      const expected = readMarks(
        (() => {
          const d = new Y.Doc();
          Y.applyUpdate(d, c.update);
          return d;
        })(),
        c.marks,
      );
      const results: string[][] = [];
      for (const which of [schema, mainSchema]) {
        const union = new Y.Doc();
        Y.applyUpdate(union, c.update);
        const before = Y.encodeStateVector(union);
        const writes: unknown[] = [];
        union.on('update', (_u: Uint8Array, origin: unknown) => writes.push(origin));
        const ed = mountEditor(union, 'visor', which);
        ed.isEditable = false;
        await settle();
        const marks = painted(ed, inputFor(c.marks));
        // Cada marca de texto pinta exactamente su texto.
        for (const m of expected.filter((x) => x.type === 'text')) expect(marks, `versión ${i}`).toContain(`hist-${m.kind}:${m.text}`);
        // Mostrarla no escribió nada en la unión (ni el editor de hoy ni el publicado).
        expect(writes, `versión ${i}`).toEqual([]);
        expect(Y.encodeStateVector(union)).toEqual(before);
        results.push(marks);
        checked += marks.length;
      }
      // Las dos versiones del editor la muestran igual.
      expect(results[0]).toEqual(results[1]);
    }
    expect(checked).toBeGreaterThan(4);
  });

  it('con la extensión, el editor dibuja la marca del bloque que cambió (clase, color, quién y cuándo) y su rótulo', async () => {
    const { rows } = await page();
    const h = new PageHistory(rows, 30 * 60_000);
    // La versión en que Bea cambió el párrafo a título 2.
    const i = h.sessions.findIndex((_x, k) => versionChanges(h, k).marks.some((m) => m.type === 'node' && m.kind === 'change'));
    expect(h.rows[h.sessions[i].last].createdBy).toBe('bea');
    const c = versionChanges(h, i);
    const union = new Y.Doc();
    Y.applyUpdate(union, c.update);
    const input: HistoryMarksInput = {
      marks: c.marks,
      look: (m) => ({ color: 'var(--hist-2)', tip: `Bea · ${m.row}`, label: m.type === 'node' && m.kind === 'change' ? 'Changed to Heading 2' : undefined }),
    };
    const ed = BlockNoteEditor.create(
      withCollaboration({
        schema,
        collaboration: { fragment: union.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'v', color: '#000' } },
        extensions: [historyMarksExtension(input)],
      }) as never,
    ) as unknown as BlockNoteEditor;
    const el = document.createElement('div');
    document.body.appendChild(el);
    ed.mount(el);
    editors.push(ed);
    ed.isEditable = false;
    await settle();
    await new Promise((r) => setTimeout(r, 20));
    const tipped = el.querySelector('.hist-node-change') as HTMLElement;
    expect(tipped.getAttribute('data-tip')).toMatch(/^Bea · \d+$/);
    expect(tipped.getAttribute('style')).toContain('--hc: var(--hist-2)');
    expect(el.querySelector('.hist-label')?.textContent).toBe('Changed to Heading 2');
  });
});

describe('copiar con Show changes prendido', () => {
  it('copia lo elegido sin lo borrado y sin los estilos de las marcas: al pegarlo entra la versión limpia', async () => {
    // Ana escribe; Bea cambia una palabra y borra un bloque entero.
    const doc = new Y.Doc();
    let who = 'ana';
    // Cada persona, su sesión: las filas de una misma persona van seguidas (un minuto); entre personas, dos horas.
    const rows: HistoryRow[] = [];
    let clock = Date.parse('2026-10-01T10:00:00Z');
    let last = '';
    doc.on('update', (u: Uint8Array) => {
      clock += who === last ? 60_000 : 2 * 60 * 60_000;
      last = who;
      rows.push({ id: rows.length + 1, seq: rows.length + 1, createdBy: who, createdAt: new Date(clock).toISOString(), data: u });
    });
    const ed = mountEditor(doc, 'A');
    ed.replaceBlocks(ed.document, [
      { type: 'paragraph', content: 'Plano de la mesa, con la cámara fija.' },
      { type: 'paragraph', content: 'Nota de vestuario: camisa azul.' },
      { type: 'paragraph', content: 'Clean plate al final.' },
    ] as PartialBlock[]);
    undoManager(ed).stopCapturing();
    await settle();
    who = 'bea';
    ed.updateBlock(ed.document[0], { content: 'Plano de la mesa, con la cámara en mano.' });
    ed.removeBlocks([ed.document[1]]);
    undoManager(ed).stopCapturing();
    await settle();
    const h = new PageHistory(rows);
    expect(h.sessions.length).toBe(2);
    const c = versionChanges(h, 1);
    expect(c.marks.some((m) => m.kind === 'del')).toBe(true);
    const union = new Y.Doc();
    Y.applyUpdate(union, c.update);
    const input = inputFor(c.marks);
    const viewer = BlockNoteEditor.create(
      withCollaboration({
        schema,
        collaboration: { fragment: union.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'v', color: '#000' } },
        extensions: [historyMarksExtension(input)],
      }) as never,
    ) as unknown as BlockNoteEditor;
    const el = document.createElement('div');
    document.body.appendChild(el);
    viewer.mount(el);
    editors.push(viewer);
    viewer.isEditable = false;
    await settle();
    // La unión muestra lo borrado (por eso hace falta limpiarlo al copiar).
    expect(view(viewer).state.doc.textContent).toContain('fija');
    expect(view(viewer).state.doc.textContent).toContain('Nota de vestuario');
    // Se elige todo.
    const v = view(viewer);
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 1, v.state.doc.content.size - 1)));
    const before = Y.encodeStateVector(union);
    const out = cleanClipboard(viewer as never, v, input)!;
    expect(out).not.toBeNull();
    for (const text of [out.clipboardHTML, out.externalHTML, out.markdown]) {
      expect(text).toContain('en mano');
      expect(text).not.toContain('fija');
      expect(text).not.toContain('Nota de vestuario');
      expect(text).not.toContain('hist-');
    }
    // Pegado con el esquema de la app: sin tachado, subrayado ni colores de las marcas.
    const pasted = JSON.stringify(BlockNoteEditor.create({ schema }).tryParseHTMLToBlocks(out.externalHTML));
    expect(pasted).toContain('cámara en mano');
    expect(pasted).not.toMatch(/strike|underline|rgb|color\(/);
    expect(JSON.stringify(BlockNoteEditor.create({ schema }).tryParseHTMLToBlocks(out.clipboardHTML))).not.toContain('fija');
    // La unión no se tocó.
    expect(Y.encodeStateVector(union)).toEqual(before);
  });
});
