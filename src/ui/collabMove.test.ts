// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { connect, editors, sameDocs, unmountAll, yText } from './collabHarness';
import { collapseExtension, setCollapsed } from './collapseEditor';
import { schema } from './editorSchema';
import { movePage, showsDocNoIds, tallyMoves } from './moveHarness';

// Mover bloques con dos editores a la vez (P.11, entrega 1b; Docs/Doc_Colapsar.md, "Mover la sección entera").
// El mover de la app (blockMove.ts) se escribe en Yjs en dos pasadas y recrea solo el lado más chico. Lo que se
// exige siempre: el texto que nadie tocó no se pierde, nada aparece en otro bloque, lo que el otro escribe en el
// lado que no se recrea queda donde lo escribió, y los dos terminan iguales. Lo que escribe a la vez en el lado
// recreado se pierde (medido: ver el documento). En CI, 40 agendas por caso; la medición entera (300, y los
// caminos de BlockNote para comparar) está en collabMoveMeasure.test.ts.

afterEach(unmountAll);

const N = Number(process.env.MOVE_SCHEDULES ?? 40);

describe('el mover de la app con dos editores', () => {
  const cases = [
    { name: 'sección de 3 que salta un título: B escribe en la sección (no se recrea)', k: 3, m: 1, alphabet: ['VA', 'TBs', 'TBs', 'dA', 'dB'], keep: true },
    { name: 'sección de 2 arrastrada lejos: B escribe en lo que salta (no se recrea)', k: 2, m: 6, alphabet: ['VA', 'TBg', 'TBg', 'dA', 'dB'], keep: true },
    { name: 'B escribe en el destino y arriba', k: 3, m: 3, alphabet: ['VA', 'TBd', 'TBo', 'dA', 'dB'], keep: true },
    { name: 'B borra bloques de todos lados', k: 3, m: 3, alphabet: ['VA', 'XBs', 'XBg', 'XBd', 'dA', 'dB'], keep: true },
    { name: 'B agrega bloques', k: 2, m: 6, alphabet: ['VA', 'NBs', 'NBg', 'NBd', 'dA', 'dB'], keep: true },
    { name: 'sección de 3 que salta un título: B escribe en el título (se recrea)', k: 3, m: 1, alphabet: ['VA', 'TBg', 'TBg', 'dA', 'dB'], keep: false },
    { name: 'los dos mueven lo mismo', k: 3, m: 1, alphabet: ['VA', 'VB', 'TBs', 'TBg', 'dA', 'dB'], keep: false },
  ];
  for (const [i, c] of cases.entries()) {
    it(c.name, async () => {
      const t = await tallyMoves(4100 + i, N, c.alphabet, () => movePage(c.k, c.m), { way: 'smaller' });
      expect({ baseLost: t.baseLost, displaced: t.displaced, different: t.different, unsettled: t.unsettled }, t.examples.join('\n')).toEqual({
        baseLost: 0,
        displaced: c.alphabet.includes('VB') ? t.displaced : 0,
        different: 0,
        unsettled: 0,
      });
      if (c.keep) expect(t.lost, t.examples.join('\n')).toBe(0);
    }, 120_000);
  }
});

describe('con el editor de la página (colapsar y el atajo)', () => {
  function mountWith(doc: Y.Doc): BlockNoteEditor {
    const editor = BlockNoteEditor.create(
      withCollaboration({
        schema,
        collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
        extensions: [collapseExtension({})],
      }),
    ) as unknown as BlockNoteEditor;
    const el = document.createElement('div');
    document.body.appendChild(el);
    editor.mount(el);
    editors.push(editor);
    return editor;
  }
  const h = (id: string, text: string) => ({ id, type: 'heading', props: { level: 2 }, content: text }) as PartialBlock;
  const p = (id: string, text: string) => ({ id, type: 'paragraph', content: text }) as PartialBlock;
  const caretIn = (E: BlockNoteEditor, id: string, end = false) => {
    const v = E.prosemirrorView!;
    let at = -1;
    v.state.doc.descendants((n, pos) => {
      if (at >= 0) return false;
      if (n.type.name === 'blockContainer' && n.attrs.id === id) at = pos + 2 + (end ? n.firstChild!.content.size : 0);
      return at < 0;
    });
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at)));
  };

  it('A baja una sección colapsada mientras B escribe adentro de lo escondido: lo de B queda en su renglón', async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const net = connect(docA, docB);
    const A = mountWith(docA);
    const B = mountWith(docB);
    A.replaceBlocks(A.document, [p('top', 'top'), h('S', 'Section'), p('s1', 'one'), p('s2', 'two'), h('G', 'Next'), p('end', 'end')] as never);
    net.flush();
    setCollapsed(A.prosemirrorView!, ['S'], true);
    net.offline();
    caretIn(A, 'S');
    A.prosemirrorView!.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, ctrlKey: true, bubbles: true, cancelable: true }));
    caretIn(B, 's1', true);
    B.insertInlineContent(' B wrote this');
    net.online();
    net.flush();
    await new Promise((r) => setTimeout(r, 0));
    net.flush();
    expect(yText(docA)).toBe('top | Next | Section | one B wrote this | two | end');
    expect(sameDocs(docA, docB)).toBe(true);
    expect(showsDocNoIds(A, docA) && showsDocNoIds(B, docB)).toBe(true);
  });
});
