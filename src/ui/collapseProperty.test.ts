// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import type { Node as PMNode } from '@tiptap/pm/model';
import { AllSelection, EditorState, NodeSelection, Selection, TextSelection, type Transaction } from '@tiptap/pm/state';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { yUndoPluginKey } from 'y-prosemirror';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { collapseExtension, collapseState, headingBackspaceExtension, removeWithSections, setCollapsed } from './collapseEditor';
import { schema } from './editorSchema';
import { findExtension, replaceAll, setFind, clearFind, stepFind } from './findEditor';
import { connect, sameDocs } from './collabHarness';

// Colapsar (Docs/Doc_Colapsar.md): prueba de propiedades al azar, traída de la verificación independiente de la
// entrega 1a. Dos editores sobre el mismo Y.Doc (A con colapsar y la búsqueda, B sin nada), con pasos al azar:
// colapsar y abrir, Enter después de un título colapsado, teclas con la selección vacía, selecciones borradas,
// cortadas, escritas o pegadas encima (al azar, las que cruzan una sección entera, Shift+→ o Shift+↓ desde un
// título colapsado, el texto exacto de un título con varios bloques pegados, toda la página), bloques elegidos
// enteros, "Borrar", mover bloques (Shift+Ctrl+flechas y arrastrar), deshacer y rehacer, cambios de tipo, ids
// repetidos, "Reemplazar todo", sin red y de vuelta, y cambios de B. Cada paso anota a propósito qué se puede
// borrar de lo escondido: (A) lo del título elegido entero (o todo), (B) lo de las secciones que la selección de
// texto cruza enteras (empieza arriba del título y termina después de lo escondido). Después se verifica:
//   (1) lo que borra la pasada de colapsar estaba escondido por un título que la edición sacó a propósito (A);
//   (2) no se pierde texto que se veía fuera de lo elegido, ni texto escondido salvo por (A) o (B);
//   (3) un cambio propio en algo escondido lo abre;  (4) nada que se veía queda escondido (salvo colapsar);
//   (5) "Reemplazar todo" no abre nada;  (6) la selección no queda en algo escondido;  (7) A y B coinciden (los
//   documentos de Yjs, y lo que muestran los editores sin los ids);
//   (8) lo que escondía un título colapsado que se ve no pasa a esconderlo otro (mover un título);
//   (9) una edición que no se hizo (Shift+→ y borrar, por ejemplo) abre la sección.
// En CI corren unas pocas semillas; con COLLAPSE_SEEDS=1-70 (y ROUNDS, STEPS) corre la prueba grande.
//
// Lo que pasa igual sin nada colapsado (problemas de BlockNote y y-prosemirror, Doc_Colapsar.md, "Riesgos") se
// cuenta aparte y no es una falla de colapsar: texto que se pierde en los dos al juntar cambios hechos sin red
// (lo inherente de y-prosemirror, Doc_Colaboracion.md); lo que pasa con ids repetidos; y el Enter de BlockNote con
// una selección que tira un error y no hace nada. Desde los parches de y-prosemirror (v0.052) y con la entrega en
// orden (`connect` de collabHarness.ts, como el servidor), `restoreRelativeSelection` y A y B que divergían ya no
// aparecen: son fallas.

// Se anota cada applyTransaction del editor con colapsar (para mirar lo que agregan los plugins).
type Rec = { old: EditorState; trs: readonly Transaction[]; state: EditorState };
const log: Rec[] = [];
const origApply = EditorState.prototype.applyTransaction;
EditorState.prototype.applyTransaction = function (this: EditorState, tr: Transaction) {
  const r = origApply.call(this, tr);
  if (collapseState(this)) log.push({ old: this, trs: r.transactions, state: r.state });
  return r;
};

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  document.body.replaceChildren();
});
afterAll(() => {
  EditorState.prototype.applyTransaction = origApply;
});

/** Las semillas: `COLLAPSE_SEEDS` ("1-70" o "3,8,12"); en CI, dos. */
function seedsFromEnv(): number[] {
  const raw = process.env.COLLAPSE_SEEDS ?? process.env.SEED ?? '1-2';
  return raw.split(',').flatMap((part) => {
    const [a, b] = part.split('-').map(Number);
    return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
  });
}

function mk(doc: Y.Doc, withCollapse: boolean, name: string) {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema,
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name, color: '#000' } },
      extensions: withCollapse ? [findExtension, collapseExtension({}), headingBackspaceExtension] : [],
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return editor;
}

const view = (e: BlockNoteEditor) => e.prosemirrorView!;
function press(editor: BlockNoteEditor, key: string, init: KeyboardEventInit = {}) {
  view(editor).dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}
function clipboardEvent(type: 'copy' | 'cut'): Event {
  const data = new Map<string, string>();
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { clearData: () => data.clear(), setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '' },
  });
  return event;
}

interface Blk { id: string; pos: number; node: PMNode; textStart: number; textEnd: number; text: string; parentId: string | null }
function blocksOf(doc: PMNode): Map<string, Blk> {
  const out = new Map<string, Blk>();
  const stack: string[] = [];
  doc.descendants((node, pos, parent) => {
    if (node.type.name === 'blockContainer') {
      const content = node.firstChild!;
      const pid = parent && parent.type.name === 'blockGroup' ? null : null;
      void pid;
      out.set(String(node.attrs.id), {
        id: String(node.attrs.id), pos, node, textStart: pos + 2, textEnd: pos + 2 + content.content.size,
        text: content.isTextblock ? content.textContent : '', parentId: null,
      });
      return true;
    }
    void stack;
    return true;
  });
  return out;
}
function descendantsIds(node: PMNode): string[] {
  const out: string[] = [];
  node.descendants((n) => {
    if (n.type.name === 'blockContainer') out.push(String(n.attrs.id));
    return true;
  });
  return out;
}
const tokensIn = (s: string) => s.match(/[\[{]\d+[\]}]/g) ?? [];

let tokenN = 1000;
const tok = () => `{${tokenN++}}`;

if (typeof (globalThis as any).ClipboardEvent === 'undefined') {
  (globalThis as any).ClipboardEvent = class extends Event {
    clipboardData: unknown = null;
  };
}
describe('colapsar, al azar', () => {
  it('nunca borra ni esconde de más, y A y B coinciden', async () => {
    const big = !!process.env.COLLAPSE_SEEDS;
    const rounds = Number(process.env.ROUNDS ?? (big ? 30 : 12));
    const steps = Number(process.env.STEPS ?? (big ? 40 : 30));
    const failures: string[] = [];
    const baseline: Record<string, number> = {};
    const known = (what: string) => (baseline[what] = (baseline[what] ?? 0) + 1);
    const kindsCount: Record<string, number> = {};
    // Un error adentro de un manejador de teclas (BlockNote) no llega a la prueba: se anota acá.
    let where = '';
    let kindNow = () => '';
    const thrown: string[] = [];
    const onError = (e: ErrorEvent) => {
      e.preventDefault();
      thrown.push(`${where} [${kindNow()}]: ${String(e.error?.stack ?? e.message).split('\n').slice(0, 8).join(' | ')}`);
    };
    window.addEventListener('error', onError);
    for (const seedArg of seedsFromEnv()) for (let round = 0; round < rounds; round++) {
      let seed = seedArg * 7919 + round * 104729 + 1;
      const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
      const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
      for (const e of editors.splice(0)) e.unmount();
      document.body.replaceChildren();
      const docA = new Y.Doc();
      const docB = new Y.Doc();
      let online = true;
      // Como el servidor de la app: lo de cada lado llega al otro en orden, y se aplica como en la app (con la
      // reparación de estructura; Doc_Colaboracion.md).
      const link = connect(docA, docB, 'sync');
      let diverged = false;
      const A = mk(docA, true, 'a');
      const B = mk(docB, false, 'b');
      let n = 0;
      const mkBlocks = (depth: number): PartialBlock[] => {
        const out: PartialBlock[] = [];
        const count = depth === 0 ? 5 + Math.floor(rand() * 10) : 1 + Math.floor(rand() * 2);
        for (let i = 0; i < count; i++) {
          const kids = depth < 2 && rand() < 0.15 ? mkBlocks(depth + 1) : [];
          const r = rand();
          const text = rand() < 0.08 ? '' : `[${n++}]`;
          if (r < 0.45) out.push({ type: 'heading', props: { level: 1 + Math.floor(rand() * 3) }, content: text, children: kids } as PartialBlock);
          else if (r < 0.9) out.push({ type: 'paragraph', content: text, children: kids } as PartialBlock);
          else out.push({ type: 'bulletListItem', content: text, children: kids } as PartialBlock);
        }
        if (depth === 0 && rand() < 0.4) out.push({ type: 'paragraph', content: '' } as PartialBlock);
        return out;
      };
      A.replaceBlocks(A.document, mkBlocks(0) as never);
      await new Promise((r) => setTimeout(r, 5));
      const um = () => (yUndoPluginKey.getState(view(A).state as never) as { undoManager: Y.UndoManager }).undoManager;
      um().clear();
      const heads = () => [...blocksOf(view(A).state.doc).values()].filter((b) => b.node.firstChild!.type.name === 'heading').map((b) => b.id);
      const picked = heads().filter(() => rand() < 0.5);
      if (!process.env.NOTOGGLE) setCollapsed(view(A), picked, true);

      const history: string[] = [];
      let dup = false;
      let didReplace = false;
      for (let step = 0; step < steps; step++) {
        um().stopCapturing();
        const st = view(A).state;
        const cs = collapseState(st)!;
        const hidden = new Map(cs.analysis.hidden);
        const bl = blocksOf(st.doc);
        const visibleIds = [...bl.keys()].filter((id) => !hidden.has(id));
        const textVisible = visibleIds.filter((id) => bl.get(id)!.node.firstChild!.isTextblock);
        let from = -1;
        let to = -1;
        const intent = new Set<string>(); // blocks removed on purpose (with descendants)
        // Los títulos cuyo contenido escondido se puede borrar en este paso: (A) elegidos enteros, (B) cruzados.
        const allowed = new Set<string>();
        let mode = '';
        const hidersNow = () => [...new Set(hidden.values())];
        const hiddenEndOf = (hider: string) => {
          const hb = bl.get(hider)!;
          let end = hb.pos + hb.node.nodeSize;
          for (const [id, h] of hidden) if (h === hider && bl.has(id)) end = Math.max(end, bl.get(id)!.pos + bl.get(id)!.node.nodeSize);
          return end;
        };
        /** (B): las secciones que la selección de texto cruza enteras. */
        const crossed = (a: number, b: number) => {
          for (const hd of hidersNow()) if (bl.has(hd) && a < bl.get(hd)!.pos && b > hiddenEndOf(hd)) allowed.add(hd);
          if (allowed.size) mode += ' B';
        };
        /** (A): los títulos que esconden algo adentro de un bloque elegido entero. */
        const whole = (b: Blk) => {
          for (const hd of hidersNow()) {
            const hb = bl.get(hd);
            if (hb && hb.pos >= b.pos && hb.pos + hb.node.nodeSize <= b.pos + b.node.nodeSize) allowed.add(hd);
          }
          if (allowed.size) mode += ' A';
        };
        /** Una edición con la selección: teclas, cortar, escribir, pegar. */
        const act = (k: string) => {
          const v = view(A);
          if (k === 'cut') v.dom.dispatchEvent(clipboardEvent('cut'));
          else if (k === 'type') {
            const t = tok();
            if (!v.someProp('handleTextInput', (f) => f(v, v.state.selection.from, v.state.selection.to, t, () => v.state.tr.insertText(t)))) {
              v.dispatch(v.state.tr.insertText(t));
            }
          } else if (k === 'paste') v.pasteText(tok());
          else if (k === 'pasteHTML') v.pasteHTML(`<p>${tok()}</p><h2>${tok()}</h2><p>${tok()}</p>`);
          else press(A, k);
        };
        let revealOf: string | null = null;
        let kind = '';
        let checkTokens = true;
        kindNow = () => kind;
        let allowHide = false;
        let remote = false;
        let findReplace = false;
        const r = rand();
        where = `seed ${seedArg} round ${round} step ${step}`;

        const dump = (d: PMNode, an: typeof cs) => {
          const lines: string[] = [];
          d.descendants((node, pos) => {
            if (node.type.name === 'blockContainer') {
              const c = node.firstChild!;
              const depth = d.resolve(pos).depth;
              lines.push(`${'  '.repeat(depth)}${pos} ${c.type.name}${c.attrs.level ? c.attrs.level : ''} "${c.textContent}" id=${String(node.attrs.id).slice(0, 8)} ${an.analysis.hidden.has(String(node.attrs.id)) ? 'HIDDEN by ' + String(an.analysis.hidden.get(String(node.attrs.id))).slice(0, 8) : ''} ${an.records.get(String(node.attrs.id)) ? 'REC ' + JSON.stringify(an.records.get(String(node.attrs.id))) : ''}`);
            }
            return true;
          });
          return lines.join('\n');
        };
        if (process.env.DUMP === `${round}:${step}`) console.log('BEFORE\n' + dump(st.doc, cs) + '\nsel ' + JSON.stringify(st.selection.toJSON()));
        queueMicrotask(() => {});
        (globalThis as any).__dumpAfter = () => { if (process.env.DUMP === `${round}:${step}`) console.log('AFTER\n' + dump(view(A).state.doc, collapseState(view(A).state)!) + '\nsel ' + JSON.stringify(view(A).state.selection.toJSON()) + '\nlog ' + log.map((l) => l.trs.map((t) => t.steps.map((x) => JSON.stringify(x.toJSON()).slice(0, 200)).join(',') + ' meta:' + JSON.stringify(Object.keys((t as any).meta))).join(' || ')).join('\n')); };
        const posIn = (id: string) => {
          const b = bl.get(id)!;
          const w = rand();
          return w < 0.4 ? b.textStart : w < 0.8 ? b.textEnd : b.textStart + Math.floor(rand() * (b.textEnd - b.textStart + 1));
        };
        log.length = 0;
        const docText = (d: PMNode) => d.textBetween(0, d.content.size, ' ');
        const aTokBefore = tokensIn(docText(st.doc));
        const bTokBefore = new Set(tokensIn(docText(view(B).state.doc)));
        try {
          if (r < 0.08) {
            kind = 'toggle';
            allowHide = true;
            const hs = heads();
            if (hs.length) {
              const id = pick(hs);
              const c = rand() < 0.6;
              allowHide = c;
              if (!c && rand() < 0.5) {
                // open by search stepping to a hidden block's token
                const hiddenTok = [...hidden.keys()].map((h) => bl.get(h)?.text ?? '').flatMap(tokensIn);
                if (hiddenTok.length) {
                  const t = pick(hiddenTok);
                  let yUpd = 0;
                  const on = () => yUpd++;
                  const docBefore = view(A).state.doc;
                  docA.on('update', on);
                  setFind(view(A), t.slice(1, -1), {});
                  stepFind(view(A), 1);
                  clearFind(view(A));
                  docA.off('update', on);
                  // Después de ids repetidos (`dup`), ProseMirror y el Y.Doc pueden quedar con un id distinto, que
                  // y-prosemirror guarda con la próxima transacción: si el documento del editor no cambió, eso no
                  // es de la búsqueda.
                  if (yUpd && dup && view(A).state.doc.eq(docBefore)) known('y-prosemirror guarda un id repetido viejo');
                  else if (yUpd) failures.push(`seed ${seedArg} round ${round} step ${step}: stepFind wrote to Y.Doc`);
                  kind = 'stepFind ' + t;
                }
              } else if (!process.env.NOTOGGLE) setCollapsed(view(A), [id], c);
              kind += ` ${bl.get(id)?.text}`;
            }
          } else if (r < 0.16) {
            // Enter at end of a visible collapsed heading and type
            kind = 'enter-after';
            const cands = [...cs.analysis.collapsed].filter((id) => !hidden.has(id) && bl.has(id));
            if (!cands.length) continue;
            const id = pick(cands);
            const b = bl.get(id)!;
            view(A).dispatch(st.tr.setSelection(TextSelection.create(st.doc, b.textEnd)));
            from = to = b.textEnd;
            press(A, 'Enter');
            if (rand() < 0.7) A.insertInlineContent(tok());
            if (rand() < 0.4) {
              press(A, 'Enter');
              A.insertInlineContent(tok());
            }
            kind += ` ${b.text}`;
          } else if (r < 0.3) {
            kind = 'caret';
            if (!textVisible.length) continue;
            const id = pick(textVisible);
            const c = rand() < 0.5 ? bl.get(id)!.textStart : bl.get(id)!.textEnd;
            from = to = c;
            view(A).dispatch(st.tr.setSelection(TextSelection.create(st.doc, c)));
            const k = pick(['Backspace', 'Delete', 'Enter', 'type', 'Backspace', 'Tab', 'ShiftTab']);
            kind += ` ${k} ${c === bl.get(id)!.textStart ? 'start' : 'end'} of ${bl.get(id)!.text}`;
            if (k === 'type') A.insertInlineContent(tok());
            else if (k === 'Tab') press(A, 'Tab');
            else if (k === 'ShiftTab') press(A, 'Tab', { shiftKey: true });
            else press(A, k);
            if (k === 'Enter' && rand() < 0.5) A.insertInlineContent(tok());
          } else if (r < 0.44) {
            kind = 'range';
            if (textVisible.length < 1) continue;
            const a = posIn(pick(textVisible));
            const b = posIn(pick(textVisible));
            if (a === b) continue;
            from = Math.min(a, b);
            to = Math.max(a, b);
            view(A).dispatch(st.tr.setSelection(TextSelection.create(st.doc, rand() < 0.5 ? from : to, from === a ? b : a)));
            // appendCollapse may move it; recompute actual selection
            const sel = view(A).state.selection;
            from = sel.from;
            to = sel.to;
            crossed(from, to);
            const k = pick(['Backspace', 'Delete', 'cut', 'type', 'paste', 'pasteHTML', 'Enter']);
            kind += ` ${k} ${from}-${to}`;
            act(k);
          } else if (r < 0.49) {
            // (B) Una selección de texto que cruza una sección colapsada entera.
            kind = 'cross';
            const hd = pick(hidersNow().filter((x) => bl.has(x)));
            if (!hd) continue;
            const end = hiddenEndOf(hd);
            const before = textVisible.filter((id) => bl.get(id)!.textEnd < bl.get(hd)!.pos);
            const afterIds = textVisible.filter((id) => bl.get(id)!.textStart > end);
            if (!before.length || !afterIds.length) continue;
            from = posIn(pick(before));
            to = posIn(pick(afterIds));
            view(A).dispatch(st.tr.setSelection(rand() < 0.5 ? TextSelection.create(st.doc, from, to) : TextSelection.create(st.doc, to, from)));
            crossed(from, to);
            const k = pick(['Backspace', 'Delete', 'cut', 'type', 'paste', 'pasteHTML']);
            kind += ` ${k} ${bl.get(hd)!.text} ${from}-${to}`;
            act(k);
          } else if (r < 0.53) {
            // Shift+→ o Shift+↓ al final de un título colapsado (la selección salta lo escondido) y una edición: no
            // se hace, se abre la sección (verificación de cbed5dc, punto 4).
            kind = 'shift-skip';
            const hd = pick(hidersNow().filter((x) => bl.has(x) && bl.get(x)!.node.firstChild!.type.name === 'heading'));
            if (!hd) continue;
            const b = bl.get(hd)!;
            view(A).dispatch(st.tr.setSelection(TextSelection.create(st.doc, b.textEnd)));
            press(A, rand() < 0.5 ? 'ArrowRight' : 'ArrowDown', { shiftKey: true });
            const sel = view(A).state.selection;
            from = sel.from;
            to = sel.to;
            // Sin nada visible después, la selección no se extiende: la edición es la de siempre.
            if (from !== to) revealOf = hd;
            const k = pick(['Backspace', 'Delete', 'cut', 'type', 'paste']);
            kind += ` ${k} ${b.text} ${from}-${to}`;
            act(k);
          } else if (r < 0.56) {
            // El texto exacto de un título colapsado (triple clic) y pegar varios bloques: la sección no se borra.
            kind = 'exact-paste';
            const hd = pick(hidersNow().filter((x) => bl.has(x) && bl.get(x)!.node.firstChild!.type.name === 'heading' && bl.get(x)!.text));
            if (!hd) continue;
            const b = bl.get(hd)!;
            from = b.textStart;
            to = b.textEnd;
            view(A).dispatch(st.tr.setSelection(TextSelection.create(st.doc, from, to)));
            const w = rand();
            kind += ` ${b.text} ${w.toFixed(2)}`;
            if (w < 0.4) view(A).pasteHTML(`<p>${tok()}</p><p>${tok()}</p>`);
            else if (w < 0.7) view(A).pasteHTML(`<ul><li>${tok()}</li><li>${tok()}</li></ul>`);
            else view(A).pasteText(`${tok()}\n\n${tok()}`);
          } else if (r < 0.58) {
            // Toda la página (Ctrl+A: el navegador la elige como texto; o AllSelection) y borrar o cortar.
            kind = 'all';
            const d = st.doc;
            // Ctrl+A: la tecla y después la selección de todo como texto (como la pone el navegador).
            press(A, 'a', { ctrlKey: true });
            view(A).dispatch(st.tr.setSelection(rand() < 0.5 ? new AllSelection(d) : TextSelection.create(d, Selection.atStart(d).from, Selection.atEnd(d).to)));
            for (const id of bl.keys()) intent.add(id);
            for (const hd of hidersNow()) allowed.add(hd);
            mode += ' A';
            const k = pick(['Backspace', 'Delete', 'cut']);
            kind += ` ${k}`;
            act(k);
          } else if (r < 0.62) {
            // Mover un bloque: Shift+Ctrl+↑/↓ (BlockNote) o arrastrarlo (el tirador elige el bloque entero).
            kind = 'move';
            if (!visibleIds.length) continue;
            const id = pick(visibleIds);
            const b = bl.get(id)!;
            if (rand() < 0.5) {
              if (!b.node.firstChild!.isTextblock) continue;
              view(A).dispatch(st.tr.setSelection(TextSelection.create(st.doc, b.textEnd)));
              const up = rand() < 0.5;
              kind += ` ${up ? 'up' : 'down'} ${b.text}`;
              press(A, up ? 'ArrowUp' : 'ArrowDown', { shiftKey: true, ctrlKey: true });
            } else {
              const inside = new Set(descendantsIds(b.node));
              const targets = visibleIds.filter((x) => x !== id && !inside.has(x));
              if (!targets.length) continue;
              const target = bl.get(pick(targets))!;
              const at = rand() < 0.5 ? target.pos : target.pos + target.node.nodeSize;
              kind += ` drag ${b.text} to ${at === target.pos ? 'before' : 'after'} ${target.text}`;
              view(A).dispatch(st.tr.setSelection(NodeSelection.create(st.doc, b.pos)));
              const v = view(A);
              const node = (v.state.selection as NodeSelection).node;
              const tr = v.state.tr.deleteSelection();
              const mapped = tr.mapping.mapResult(at);
              if (mapped.deleted) continue;
              tr.insert(mapped.pos, node);
              tr.setSelection(NodeSelection.create(tr.doc, mapped.pos));
              v.dispatch(tr.setMeta('uiEvent', 'drop'));
            }
          } else if (r < 0.66) {
            kind = 'node';
            if (!visibleIds.length) continue;
            const id = pick(visibleIds);
            const b = bl.get(id)!;
            view(A).dispatch(st.tr.setSelection(NodeSelection.create(st.doc, b.pos)));
            const sel = view(A).state.selection;
            if (!(sel instanceof NodeSelection)) continue;
            intent.add(id);
            for (const d of descendantsIds(b.node)) intent.add(d);
            whole(b);
            const k = pick(['Backspace', 'Delete', 'cut', 'type', 'paste']);
            kind += ` ${k} ${b.text}`;
            act(k);
          } else if (r < 0.7) {
            // "Borrar" (el menú del bloque, con la sección) o `removeBlocks` de BlockNote (sin ella).
            const menu = rand() < 0.5;
            kind = menu ? 'remove-menu' : 'removeBlocks';
            if (!visibleIds.length) continue;
            const id = pick(visibleIds);
            intent.add(id);
            for (const d of descendantsIds(bl.get(id)!.node)) intent.add(d);
            // Con ids repetidos, BlockNote saca el primer bloque con ese id (no es de colapsar).
            st.doc.descendants((node) => {
              if (node.type.name === 'blockContainer' && node.attrs.id === id && node !== bl.get(id)!.node) {
                for (const d of [id, ...descendantsIds(node)]) intent.add(d);
                known('ids repetidos: se saca otro bloque con el mismo id');
              }
              return true;
            });
            if (menu) whole(bl.get(id)!);
            kind += ` ${bl.get(id)!.text}`;
            if (menu) removeWithSections(view(A), [id]);
            else A.removeBlocks([id]);
          } else if (r < 0.77) {
            kind = rand() < 0.6 ? 'undo' : 'redo';
            checkTokens = false;
            if (kind === 'undo') A.undo();
            else A.redo();
          } else if (r < 0.81) {
            kind = 'retype';
            const cands = textVisible;
            if (!cands.length) continue;
            const id = pick(cands);
            const w = rand();
            const b = A.getBlock(id)!;
            kind += ` ${bl.get(id)!.text} ${w.toFixed(2)}`;
            if (w < 0.4) A.updateBlock(id, { type: 'paragraph' } as never);
            else A.updateBlock(id, { type: 'heading', props: { level: 1 + Math.floor(rand() * 3) } } as never);
            void b;
          } else if (r < 0.84) {
            kind = 'rename-id';
            if (!visibleIds.length) continue;
            const id = pick(visibleIds);
            const b = bl.get(id)!;
            // duplicate id of another block (UniqueID should repair) or a fresh one
            if (rand() < 0.5) {
              const other = `r${tokenN++}`;
              kind += ` ${b.text} -> ${other}`;
              view(A).dispatch(st.tr.setNodeMarkup(b.pos, undefined, { ...b.node.attrs, id: other }));
            } else {
              // remote: B gives some block the id of a collapsed heading in A (duplicate); UniqueID repairs
              remote = true;
              checkTokens = false;
              const cands = [...cs.analysis.collapsed];
              if (!cands.length) continue;
              const target = pick(cands);
              const vb = view(B);
              const bb = blocksOf(vb.state.doc);
              const victim = pick([...bb.keys()].filter((x) => x !== target));
              if (!victim) continue;
              dup = true;
              kind += ` REMOTE dup ${bb.get(victim)!.text} gets id of ${bl.get(target)?.text}`;
              vb.dispatch(vb.state.tr.setNodeMarkup(bb.get(victim)!.pos, undefined, { ...bb.get(victim)!.node.attrs, id: target }));
            }
            await new Promise((res) => setTimeout(res, 1));
          } else if (r < 0.87) {
            kind = 'replaceAll';
            findReplace = true;
            const allTok = tokensIn(st.doc.textBetween(0, st.doc.content.size, ' '));
            if (!allTok.length) continue;
            const t = pick(allTok);
            setFind(view(A), t.slice(1, -1), {});
            replaceAll(A, rand() < 0.3 ? '' : `R${t.slice(1, -1)}`);
            clearFind(view(A));
            checkTokens = false;
          } else if (r < 0.9) {
            kind = online ? 'offline' : 'online';
            if (online) {
              online = false;
              link.offline();
            } else {
              online = true;
              remote = true;
              link.online();
            }
            checkTokens = false;
          } else {
            kind = 'remote';
            remote = true;
            checkTokens = false;
            const docs = B.document;
            const all: string[] = [];
            const walk = (bs: typeof docs) => bs.forEach((b) => (all.push(b.id), walk(b.children)));
            walk(docs);
            if (!all.length) continue;
            const id = pick(all);
            const w = rand();
            if (w < 0.3) {
              kind += ' delete';
              if (all.length > 1) B.removeBlocks([id]);
            } else if (w < 0.6) {
              kind += ' insert';
              B.insertBlocks([rand() < 0.3 ? ({ type: 'heading', props: { level: 1 + Math.floor(rand() * 3) }, content: tok() } as never) : ({ type: 'paragraph', content: rand() < 0.3 ? '' : tok() } as never)], id, rand() < 0.5 ? 'before' : 'after');
            } else if (w < 0.8) {
              kind += ' text';
              const blk = B.getBlock(id)!;
              if (Array.isArray(blk.content)) B.updateBlock(id, { content: tok() } as never);
            } else {
              kind += ' type';
              B.updateBlock(id, rand() < 0.5 ? ({ type: 'paragraph' } as never) : ({ type: 'heading', props: { level: 1 + Math.floor(rand() * 3) } } as never));
            }
          }
        } catch (err) {
          failures.push(`seed ${seedArg} round ${round} step ${step} ${kind}: EXCEPTION ${(err as Error).stack?.split("\n").slice(0, 14).join(' | ')}`);
          break;
        }
        // Lo que la pasada de colapsar deja para después: abrir la sección de una edición que no se hizo.
        await Promise.resolve();
        kind += mode;
        history.push(kind);
        kindsCount[kind.split(' ')[0]] = (kindsCount[kind.split(' ')[0]] ?? 0) + 1;
        (globalThis as any).__dumpAfter();
        const after = view(A).state;
        const acs = collapseState(after)!;
        const abl = blocksOf(after.doc);
        const afterText = after.doc.textBetween(0, after.doc.content.size, ' ');
        const fail = (msg: string) => failures.push(`seed ${seedArg} round ${round} step ${step} [${kind}] ${msg}\n   history: ${history.slice(-8).join(' ; ')}`);

        // (1) appended transactions: only delete blocks hidden before by a heading the root removed on purpose (A).
        // Con ids repetidos también: un bloque al que un plugin solo le cambió el id (UniqueID) sigue en su lugar.
        for (const rec of log) {
          const [root, ...app] = rec.trs;
          if (!app.length) continue;
          const oldHidden = collapseState(rec.old)!.analysis.hidden;
          const rootBlocks = blocksOf(root.doc);
          const finalIds = new Set(blocksOf(rec.state.doc).keys());
          for (const [id, rb] of rootBlocks) {
            if (finalIds.has(id) || id === 'null' || !id) continue;
            let at = rb.pos;
            for (const t of app) at = t.mapping.map(at, -1);
            const now = rec.state.doc.nodeAt(at);
            if (now?.type.name === 'blockContainer' && now.firstChild!.eq(rb.node.firstChild!)) continue; // renamed
            const t = rb.text;
            const hider = oldHidden.get(id);
            if (!hider) fail(`appended deleted non-hidden block ${id} "${t}"`);
            else if (rootBlocks.has(hider)) fail(`appended deleted ${t} but its hider still there`);
            else if (!allowed.has(hider)) fail(`appended deleted ${t} but its hider was not removed on purpose (A)`);
          }
        }
        // (2) tokens
        if (checkTokens) {
          for (const [id, b] of bl) {
            for (const tk of tokensIn(b.text)) {
              if (afterText.includes(tk)) continue;
              if (intent.has(id)) continue;
              const inRange = from >= 0 && b.textStart <= to + 1 && b.textEnd >= from - 1;
              if (!hidden.has(id)) {
                if (!inRange) fail(`visible token ${tk} lost (range ${from}-${to}, block ${b.textStart}-${b.textEnd})`);
              } else {
                // Lo escondido se borra solo a propósito: (A) o (B), anotado en el paso.
                const hider = hidden.get(id)!;
                if (!allowed.has(hider)) fail(`HIDDEN token ${tk} lost (hider ${bl.get(hider)?.text}, range ${from}-${to}, block ${b.pos}-${b.pos + b.node.nodeSize})`);
              }
            }
          }
        }
        if (remote) {
          const aNow = new Set(tokensIn(afterText));
          const bNow = new Set(tokensIn(docText(view(B).state.doc)));
          for (const t of aTokBefore) {
            if (aNow.has(t)) continue;
            if (bTokBefore.has(t) && bNow.has(t)) fail(`remote op: A lost token ${t} that B still has`);
            else if (bTokBefore.has(t) && !bNow.has(t) && kind.startsWith('online')) known('texto perdido al juntar cambios sin red');
          }
        }
        // (3) hidden blocks changed by local edit must be revealed (not for remote/find replace)
        if (kind === 'replaceAll') didReplace = true;
        if (!remote && !findReplace && kind !== 'toggle' && !((kind === 'undo' || kind === 'redo') && didReplace)) {
          for (const [id] of hidden) {
            const now = abl.get(id);
            const was = bl.get(id)!;
            if (now && now.text !== was.text && now.text.replace(/R/g, '') !== was.text.replace(/R/g, '') && acs.analysis.hidden.has(id)) fail(`hidden block ${was.text} changed to ${now.text} but still hidden`);
          }
        }
        // (4) nothing visible became hidden (except toggles)
        if (!allowHide) {
          for (const id of visibleIds) {
            if (acs.analysis.hidden.has(id)) fail(`visible block ${bl.get(id)!.text} (${bl.get(id)!.node.firstChild!.type.name}) became hidden`);
          }
        }
        // (5) find replace: never opens anything
        if (findReplace) {
          for (const [id, hider] of hidden) {
            if (!abl.has(id) || acs.analysis.hidden.has(id)) continue;
            // Con ids repetidos, UniqueID le cambia el id a los dos bloques y el título pierde lo colapsado (no se
            // sabe cuál era): pasa con cualquier cambio que llegue en ese momento.
            if (dup && !abl.has(hider)) known('un título con id repetido pierde lo colapsado al arreglarse');
            else fail(`replaceAll revealed ${bl.get(id)!.text}`);
          }
        }
        // (6) selection not in hidden after local edit
        const sel = after.selection;
        for (const $p of [sel.$head, sel.$anchor]) {
          for (let d = $p.depth; d > 0; d--) {
            const nd = $p.node(d);
            if (nd.type.name === 'blockContainer' && acs.analysis.hidden.has(String(nd.attrs.id))) {
              // Con ids repetidos todavía sin arreglar (un título se esconde a sí mismo), no se puede saber dónde.
              const ids = descendantsIds(after.doc);
              if (new Set(ids).size !== ids.length) known('ids repetidos sin arreglar');
              else if (!(sel.toJSON() as { type: string }).type.startsWith('sd-')) fail(`selection inside hidden ${String(nd.attrs.id)}`);
              break;
            }
          }
        }
        // (8) lo que escondía un título colapsado que se ve no pasa a esconderlo otro que ya se veía (mover un
        // título; hasta 1b).
        if (!kind.startsWith('toggle') && !kind.startsWith('stepFind') && !findReplace) {
          for (const [id, was] of hidden) {
            const now = acs.analysis.hidden.get(id);
            // Un título de adentro que queda a la vista (estaba escondido) conserva lo suyo.
            if (now && now !== was && !hidden.has(now) && acs.analysis.collapsed.has(was) && !acs.analysis.hidden.has(was)) {
              fail(`hidden block ${bl.get(id)!.text} moved from ${bl.get(was)?.text} to ${abl.get(now)?.text}`);
            }
          }
        }
        // (9) una edición que no se hizo abre la sección.
        if (revealOf && after.doc.eq(st.doc) && [...acs.analysis.hidden.values()].includes(revealOf)) fail('an edit was swallowed but the section stayed collapsed');
        // (7) convergence
        // Los documentos de Yjs iguales, y lo que muestran los editores igual sin los ids de los bloques (el editor
        // les cambia el id a los repetidos). Recomendación de Doc_Colaboracion.md.
        if (online && !diverged) {
          const noIds = (e: BlockNoteEditor) => JSON.stringify(e.document, (k, v) => (k === 'id' ? undefined : v));
          if (!sameDocs(docA, docB) || noIds(A) !== noIds(B)) {
            const sh = (e: BlockNoteEditor) => { const o: string[] = []; const w = (bs: any[], d: number) => bs.forEach((b) => { o.push(`${d}${b.type[0]}:${Array.isArray(b.content) ? b.content.map((c: any) => c.text ?? '').join('') : ''}`); w(b.children, d + 1); }); w(e.document, 0); return o.join(' '); };
            diverged = true;
            fail(`A and B diverged (Yjs ${sameDocs(docA, docB) ? 'same' : 'different'})\n   A: ` + sh(A) + '\n   B: ' + sh(B));
          }
        }
        if (failures.length > 40) break;
      }
      if (failures.length > 40) break;
    }
    window.removeEventListener('error', onError);
    for (const t of thrown) {
      // El Enter de BlockNote con una selección (partir el bloque) a veces tira uno de estos errores y no hace nada:
      // pasa igual sin Yjs y sin colapsar (Doc_Colapsar.md, "Riesgos").
      const enter = /\[(range|caret)[^\]]* Enter\b/.test(t);
      if (enter && /Cannot join blockGroup onto|Position \d+ out of range|Inserted content deeper than insertion position/.test(t)) known('Enter de BlockNote tira un error');
      else failures.push(`EXCEPTION en un evento: ${t}`);
    }
    if (big) console.log('KINDS ' + JSON.stringify(kindsCount) + '\nFUERA DE COLAPSAR ' + JSON.stringify(baseline));
    if (failures.length) console.log(failures.join('\n'));
    expect(failures).toEqual([]);
  }, 3_600_000);
});
