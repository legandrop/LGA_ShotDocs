// Harness for the two-device concurrency lab on the Yjs 14 stack (@y/y + @y/prosemirror via
// @blocknote/core/y). Port of the y-prosemirror 1.3.7 investigation harness: same helpers, same output.
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/y';
import { TextSelection } from '@tiptap/pm/state';
import * as YPM from '@y/prosemirror';
import { yUndoPluginKey } from '@y/prosemirror';
// exported by the BlockNote patch (patches/@y+prosemirror+2.0.0-6.patch), not declared in its .d.ts
const deltaToPNode = (YPM as unknown as { deltaToPNode: (d: unknown, s: unknown, f: null) => import('@tiptap/pm/model').Node | null }).deltaToPNode;
import * as Y from '@y/y';
import { buildSeed, CONTENT_FRAGMENT } from '../sync/structure';
import { schema } from '../ui/editorSchema';
import { yUndoExtension } from '../ui/yUndo';

export const editors: BlockNoteEditor[] = [];

export function mk(doc: Y.Doc, name: string): BlockNoteEditor {
  const fragment = doc.get(CONTENT_FRAGMENT);
  const opts = withCollaboration({ schema, collaboration: { fragment, user: { name, color: '#000' } } });
  const o = opts as { extensions?: unknown[] };
  o.extensions = [...(o.extensions ?? []), yUndoExtension(fragment)];
  const editor = BlockNoteEditor.create(opts as never) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return editor;
}

export const view = (e: BlockNoteEditor) => e.prosemirrorView!;
export const um = (e: BlockNoteEditor) => (yUndoPluginKey.getState(view(e).state as never) as { undoManager: Y.UndoManager }).undoManager;

/** Two docs, sync like collapseProperty.test.ts (synchronous, nested in the sender's update event) or async (queued). */
export function net(docA: Y.Doc, docB: Y.Doc, mode: 'sync' | 'async' = 'sync') {
  const n = { online: true, pendA: [] as Uint8Array[], pendB: [] as Uint8Array[], queue: [] as [Y.Doc, Uint8Array][], sentA: 0, sentB: 0 };
  const hook = (from: Y.Doc, to: Y.Doc, pend: Uint8Array[], k: 'sentA' | 'sentB') =>
    from.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return;
      n[k]++;
      if (!n.online) pend.push(u);
      else if (mode === 'sync') Y.applyUpdate(to, u, 'remote');
      else n.queue.push([to, u]);
    });
  hook(docA, docB, n.pendA, 'sentA');
  hook(docB, docA, n.pendB, 'sentB');
  return {
    n,
    offline() {
      n.online = false;
    },
    /** Same order as the property test: B's pending into A, then A's into B. */
    online() {
      n.online = true;
      for (const u of n.pendB.splice(0)) Y.applyUpdate(docA, u, 'remote');
      for (const u of n.pendA.splice(0)) Y.applyUpdate(docB, u, 'remote');
    },
    flush() {
      while (n.queue.length) {
        const [to, u] = n.queue.shift()!;
        Y.applyUpdate(to, u, 'remote');
      }
    },
  };
}

export const yXml = (d: Y.Doc) => d.get(CONTENT_FRAGMENT).toString();
export const yConverged = (a: Y.Doc, b: Y.Doc) =>
  Buffer.from(Y.encodeStateVector(a)).equals(Buffer.from(Y.encodeStateVector(b))) && yXml(a) === yXml(b);
/** The PM doc as the binding would render the Y.Doc right now (on a clone, invalid nodes dropped). */
export const pmFromY = (e: BlockNoteEditor, d: Y.Doc) => {
  const c = new Y.Doc();
  Y.applyUpdate(c, Y.encodeStateAsUpdate(d));
  const node = deltaToPNode(c.get(CONTENT_FRAGMENT).toDelta({ deep: true }) as never, view(e).state.schema, null);
  if (!node) throw new Error('Y fragment does not render');
  return node;
};
export const pmMatchesY = (e: BlockNoteEditor, d: Y.Doc) => {
  try {
    return view(e).state.doc.eq(pmFromY(e, d));
  } catch {
    return false;
  }
};
export const text = (e: BlockNoteEditor) => view(e).state.doc.textBetween(0, view(e).state.doc.content.size, ' | ');
/** All text in the Y.Doc (source of truth), independent of any editor. Text is stored inline in v14. */
export function yText(d: Y.Doc): string {
  const out: string[] = [];
  const walk = (t: Y.Type) => {
    let run = '';
    let hasText = false;
    for (const c of t.toArray()) {
      if (typeof c === 'string') {
        run += c;
        hasText = true;
      } else if (c instanceof Y.Type) {
        if (hasText) out.push(run);
        run = '';
        hasText = false;
        walk(c);
      }
    }
    if (hasText) out.push(run);
  };
  walk(d.get(CONTENT_FRAGMENT));
  return out.join(' | ');
}
export function outline(e: BlockNoteEditor): string {
  const o: string[] = [];
  const w = (bs: any[], dd: number) =>
    bs.forEach((b) => {
      o.push(`${'  '.repeat(dd)}${b.type}#${String(b.id).slice(0, 6)} "${Array.isArray(b.content) ? b.content.map((c: any) => c.text ?? '').join('') : ''}"`);
      w(b.children, dd + 1);
    });
  w(e.document, 0);
  return o.join('\n');
}
export function caretAt(e: BlockNoteEditor, id: string, where: 'start' | 'end' | number) {
  const v = view(e);
  let pos = -1;
  v.state.doc.descendants((node, p) => {
    if (pos >= 0) return false;
    if (node.type.name === 'blockContainer' && node.attrs.id === id) {
      const c = node.firstChild!;
      pos = where === 'start' ? p + 2 : where === 'end' ? p + 2 + c.content.size : p + 2 + where;
      return false;
    }
    return true;
  });
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos)));
}
export function press(e: BlockNoteEditor, key: string, init: KeyboardEventInit = {}) {
  view(e).dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}
export const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

/** A doc that already holds the page seed (what the app does before mounting an editor). */
export function seeded(pageId = 'page-1'): Y.Doc {
  const d = new Y.Doc();
  Y.applyUpdate(d, buildSeed(pageId));
  return d;
}
