// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection, type Transaction } from '@tiptap/pm/state';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { yUndoPluginKey } from 'y-prosemirror';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { collapseExtension, collapseState, setCollapsed } from './collapseEditor';
import { schema } from './editorSchema';
import { findExtension, replaceAll, setFind, clearFind, stepFind } from './findEditor';

// Colapsar (Docs/Doc_Colapsar.md): prueba de propiedades al azar, traída de la verificación independiente de la
// entrega 1a. Dos editores sobre el mismo Y.Doc (A con colapsar y la búsqueda, B sin nada), con pasos al azar:
// colapsar y abrir, Enter después de un título colapsado, teclas con el cursor, selecciones borradas, cortadas,
// escritas o pegadas encima, bloques elegidos enteros, "Borrar", deshacer y rehacer, cambios de tipo, ids
// repetidos, "Reemplazar todo", sin red y de vuelta, y cambios de B. Después de cada paso se verifica:
//   (1) lo que borra la pasada de colapsar estaba escondido por un título que la edición sacó;
//   (2) no se pierde texto que se veía fuera de lo elegido, ni texto escondido salvo con su título;
//   (3) un cambio propio en algo escondido lo abre;  (4) nada que se veía queda escondido (salvo colapsar);
//   (5) "Reemplazar todo" no abre nada;  (6) la selección no queda en algo escondido;  (7) A y B coinciden.
// En CI corren unas pocas semillas; con COLLAPSE_SEEDS=1-70 (y ROUNDS, STEPS) corre la prueba grande.
//
// Lo que pasa igual sin nada colapsado (problemas de BlockNote y y-prosemirror, Doc_Colapsar.md, "Riesgos") se
// cuenta aparte y no es una falla de colapsar: `restoreRelativeSelection` que tira un error al deshacer, rehacer
// o juntar cambios; A y B que divergen después de deshacer, rehacer o volver a tener red; y texto que se pierde
// en los dos al juntar cambios hechos sin red. Se verificó corriendo la prueba grande sin colapsar nada
// (NOTOGGLE=1): aparecen los mismos.

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
      extensions: withCollapse ? [findExtension, collapseExtension({})] : [],
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
    const thrown: string[] = [];
    const onError = (e: ErrorEvent) => {
      e.preventDefault();
      thrown.push(`${where}: ${String(e.error?.stack ?? e.message).split('\n').slice(0, 8).join(' | ')}`);
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
      const pendA: Uint8Array[] = [];
      const pendB: Uint8Array[] = [];
      docA.on('update', (u: Uint8Array, origin: unknown) => {
        if (origin === 'remote') return;
        if (online) Y.applyUpdate(docB, u, 'remote');
        else pendA.push(u);
      });
      docB.on('update', (u: Uint8Array, origin: unknown) => {
        if (origin === 'remote') return;
        if (online) Y.applyUpdate(docA, u, 'remote');
        else pendB.push(u);
      });
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
        let kind = '';
        let checkTokens = true;
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
          } else if (r < 0.36) {
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
          } else if (r < 0.58) {
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
            const k = pick(['Backspace', 'Delete', 'cut', 'type', 'paste', 'pasteHTML', 'Enter']);
            kind += ` ${k} ${from}-${to}`;
            if (k === 'cut') view(A).dom.dispatchEvent(clipboardEvent('cut'));
            else if (k === 'type') {
              const v = view(A);
              const t = tok();
              if (!v.someProp('handleTextInput', (f) => f(v, v.state.selection.from, v.state.selection.to, t, () => v.state.tr.insertText(t)))) {
                v.dispatch(v.state.tr.insertText(t));
              }
            } else if (k === 'paste') view(A).pasteText(tok());
            else if (k === 'pasteHTML') view(A).pasteHTML(`<p>${tok()}</p><h2>${tok()}</h2><p>${tok()}</p>`);
            else press(A, k);
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
            const k = pick(['Backspace', 'Delete', 'cut']);
            kind += ` ${k} ${b.text}`;
            if (k === 'cut') view(A).dom.dispatchEvent(clipboardEvent('cut'));
            else press(A, k);
          } else if (r < 0.7) {
            kind = 'removeBlocks';
            if (!visibleIds.length) continue;
            const id = pick(visibleIds);
            intent.add(id);
            for (const d of descendantsIds(bl.get(id)!.node)) intent.add(d);
            kind += ` ${bl.get(id)!.text}`;
            A.removeBlocks([id]);
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
            if (online) online = false;
            else {
              online = true;
              remote = true;
              for (const u of pendB.splice(0)) Y.applyUpdate(docA, u, 'remote');
              for (const u of pendA.splice(0)) Y.applyUpdate(docB, u, 'remote');
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
          if (String((err as Error).stack).includes('restoreRelativeSelection')) {
            known('restoreRelativeSelection');
            break;
          }
          failures.push(`seed ${seedArg} round ${round} step ${step} ${kind}: EXCEPTION ${(err as Error).stack?.split("\n").slice(0, 14).join(' | ')}`);
          break;
        }
        history.push(kind);
        kindsCount[kind.split(' ')[0]] = (kindsCount[kind.split(' ')[0]] ?? 0) + 1;
        (globalThis as any).__dumpAfter();
        const after = view(A).state;
        const acs = collapseState(after)!;
        const abl = blocksOf(after.doc);
        const afterText = after.doc.textBetween(0, after.doc.content.size, ' ');
        const fail = (msg: string) => failures.push(`seed ${seedArg} round ${round} step ${step} [${kind}] ${msg}\n   history: ${history.slice(-8).join(' ; ')}`);

        // (1) appended transactions: only delete blocks hidden before by a heading the root removed
        for (const rec of log) {
          const [root, ...app] = rec.trs;
          if (!app.length) continue;
          const oldHidden = collapseState(rec.old)!.analysis.hidden;
          const rootIds = new Set(blocksOf(root.doc).keys());
          const finalIds = new Set(blocksOf(rec.state.doc).keys());
          for (const id of rootIds) {
            if (finalIds.has(id) || id === 'null' || !id) continue;
            const t = blocksOf(root.doc).get(id)!.text;
            const finalText = rec.state.doc.textBetween(0, rec.state.doc.content.size, ' ');
            if (t && tokensIn(t).length && tokensIn(t).every((x) => finalText.includes(x))) continue; // renamed
            if (dup) continue;
            if (!oldHidden.has(id)) fail(`appended deleted non-hidden block ${id} "${t}"`);
            else if (rootIds.has(oldHidden.get(id)!)) fail(`appended deleted ${t} but its hider still there`);
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
                const fully = from >= 0 && b.pos >= from - 2 && b.pos + b.node.nodeSize <= to + 2;
                const hider = hidden.get(id)!;
                const hb = bl.get(hider);
                const hiderGone = !abl.has(hider) && (!hb || tokensIn(hb.text).every((x) => !afterText.includes(x)));
                if (!fully && !hiderGone && !intent.has(hider)) fail(`HIDDEN token ${tk} lost (hider ${hb?.text}, range ${from}-${to}, block ${b.pos}-${b.pos + b.node.nodeSize})`);
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
          for (const [id] of hidden) if (abl.has(id) && !acs.analysis.hidden.has(id)) fail(`replaceAll revealed ${bl.get(id)!.text}`);
        }
        // (6) selection not in hidden after local edit
        const sel = after.selection;
        for (const $p of [sel.$head, sel.$anchor]) {
          for (let d = $p.depth; d > 0; d--) {
            const nd = $p.node(d);
            if (nd.type.name === 'blockContainer' && acs.analysis.hidden.has(String(nd.attrs.id))) {
              if (!(sel.toJSON() as { type: string }).type.startsWith('sd-')) fail(`selection inside hidden ${String(nd.attrs.id)}`);
              break;
            }
          }
        }
        // (7) convergence
        if (online && !dup) {
          const ja = JSON.stringify(A.document);
          const jb = JSON.stringify(B.document);
          if (ja !== jb && history.some((h) => /^(undo|redo|offline|online)/.test(h))) {
            // Pasa igual sin colapsar: divergen después de deshacer, rehacer o de juntar cambios sin red.
            known('divergen después de deshacer, rehacer o sin red');
            dup = true;
          } else if (ja !== jb) {
            const sh = (e: BlockNoteEditor) => { const o: string[] = []; const w = (bs: any[], d: number) => bs.forEach((b) => { o.push(`${d}${b.type[0]}:${String(b.id).slice(0,4)}:${Array.isArray(b.content) ? b.content.map((c: any) => c.text ?? '').join('') : ''}`); w(b.children, d + 1); }); w(e.document, 0); return o.join(' '); };
            dup = true;
            fail('A and B diverged\n   A: ' + sh(A) + '\n   B: ' + sh(B));
          }
        }
        if (failures.length > 40) break;
      }
      if (failures.length > 40) break;
    }
    window.removeEventListener('error', onError);
    for (const t of thrown) {
      // El Enter de BlockNote (partir el bloque) a veces tira un error de ProseMirror: pasa igual sin colapsar.
      if (/TransformError|RangeError: Position \d+ out of range/.test(t) && /blocks-[\w-]+\.js/.test(t)) known('Enter de BlockNote tira un error');
      else failures.push(`EXCEPTION en un evento: ${t}`);
    }
    if (big) console.log('KINDS ' + JSON.stringify(kindsCount) + '\nFUERA DE COLAPSAR ' + JSON.stringify(baseline));
    if (failures.length) console.log(failures.join('\n'));
    expect(failures).toEqual([]);
  }, 3_600_000);
});
