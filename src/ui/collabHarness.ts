// Ayudas para las pruebas de edición a la vez con el editor real (collab*.test.ts). Solo las usan las
// pruebas; la app no las importa. Ver Docs/Doc_Colaboracion.md.
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { yUndoPluginKey, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT, normalizeStructure } from '../sync/structure';
import { schema } from './editorSchema';

export type Editor = BlockNoteEditor;

export const editors: BlockNoteEditor[] = [];

/** Desmonta los editores de la prueba (va en `afterEach`). */
export function unmountAll(): void {
  for (const e of editors.splice(0)) {
    try {
      e.unmount();
    } catch {
      // Ya desmontado.
    }
  }
  document.body.replaceChildren();
}

/** Un editor como el de la app (mismo esquema, con Yjs) sobre el documento. */
export function mountEditor(doc: Y.Doc, name = 'u'): BlockNoteEditor {
  const editor = BlockNoteEditor.create(
    withCollaboration({ schema, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name, color: '#000' } } }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return editor;
}

export const view = (e: BlockNoteEditor) => e.prosemirrorView!;
export const undoManager = (e: BlockNoteEditor) =>
  (yUndoPluginKey.getState(view(e).state as never) as { undoManager: Y.UndoManager }).undoManager;

/** Aplica lo que llega como la app (docs.ts, `applyToLive`): si hay que reparar, en la misma transacción. */
export function applyLikeApp(doc: Y.Doc, update: Uint8Array): void {
  const probe = new Y.Doc();
  Y.applyUpdate(probe, Y.encodeStateAsUpdate(doc));
  Y.applyUpdate(probe, update);
  const repair = normalizeStructure(probe, 'repair');
  probe.destroy();
  if (!repair) Y.applyUpdate(doc, update, 'remote');
  else
    doc.transact(() => {
      Y.applyUpdate(doc, update);
      normalizeStructure(doc, 'repair');
    }, 'repair');
}

/**
 * Dos documentos conectados. `sync`: cada cambio llega al otro enseguida (al terminar el que se está
 * entregando); `async`: quedan en cola hasta `flush()`. Con `offline()`, cada lado junta lo suyo hasta
 * `online()`. Con `repair` (por defecto), lo que llega se aplica como en la app, con la reparación de
 * estructura; sin él, como Yjs puro.
 *
 * Como el servidor de la app, lo de cada lado llega al otro EN ORDEN: lo que un lado escribe mientras recibe
 * (su reparación, lo que su editor guarda) sale después de lo que ya tenía pendiente. Entregarlo antes (en el
 * medio de otra entrega, como hacía la prueba de colapsar) arma estados que la app nunca ve: por ejemplo, un
 * borrado de la reparación que llega antes que el contenido que la reparación dejó, y el editor del otro lado
 * borra el bloque que quedó vacío.
 */
export function connect(docA: Y.Doc, docB: Y.Doc, mode: 'sync' | 'async' = 'async', { repair = true } = {}) {
  const state = { online: true, fromA: [] as Uint8Array[], fromB: [] as Uint8Array[], delivering: false };
  const deliver = (to: Y.Doc, u: Uint8Array) => (repair ? applyLikeApp(to, u) : Y.applyUpdate(to, u, 'remote'));
  const pump = () => {
    if (state.delivering || !state.online) return;
    state.delivering = true;
    try {
      while (state.fromA.length || state.fromB.length) {
        if (state.fromB.length) deliver(docA, state.fromB.shift()!);
        else deliver(docB, state.fromA.shift()!);
      }
    } finally {
      state.delivering = false;
    }
  };
  const hook = (from: Y.Doc, outbox: Uint8Array[]) =>
    from.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return;
      outbox.push(u);
      if (mode === 'sync') pump();
    });
  hook(docA, state.fromA);
  hook(docB, state.fromB);
  return {
    offline() {
      state.online = false;
    },
    /** Vuelve la red: lo de B llega a A y después lo de A a B. */
    online() {
      state.online = true;
      pump();
    },
    flush() {
      pump();
    },
    /** Cambios que todavía no llegaron al otro lado. */
    pending() {
      return state.fromA.length + state.fromB.length;
    },
  };
}

/** Todo el texto del documento de Yjs (lo que vale), sin mirar ningún editor. Bloques separados por " | ". */
export function yText(d: Y.Doc): string {
  const out: string[] = [];
  const walk = (t: Y.XmlElement | Y.XmlFragment | Y.XmlText) => {
    if (t instanceof Y.XmlText) out.push(t.toString().replace(/<[^>]+>/g, ''));
    else t.toArray().forEach((c) => walk(c as never));
  };
  walk(d.getXmlFragment(CONTENT_FRAGMENT));
  return out.join(' | ');
}

/** El texto que muestra el editor. */
export const pmText = (e: BlockNoteEditor) => view(e).state.doc.textBetween(0, view(e).state.doc.content.size, ' | ');

/** Lo que el editor mostraría si dibujara el documento ahora (sobre una copia: dibujar puede borrar). */
export function pmFromY(e: BlockNoteEditor, d: Y.Doc) {
  const c = new Y.Doc();
  Y.applyUpdate(c, Y.encodeStateAsUpdate(d));
  return yXmlFragmentToProseMirrorRootNode(c.getXmlFragment(CONTENT_FRAGMENT), view(e).state.schema);
}
/** El editor muestra lo que dice el documento (no se quedó con algo viejo). */
export const showsDoc = (e: BlockNoteEditor, d: Y.Doc) => view(e).state.doc.eq(pmFromY(e, d));

export const sameDocs = (a: Y.Doc, b: Y.Doc) =>
  Buffer.from(Y.encodeStateVector(a)).equals(Buffer.from(Y.encodeStateVector(b))) &&
  a.getXmlFragment(CONTENT_FRAGMENT).toJSON() === b.getXmlFragment(CONTENT_FRAGMENT).toJSON();

/** Posición del `blockContainer` con ese id en el editor (-1 si no está). */
export function posOf(e: BlockNoteEditor, id: string): number {
  let pos = -1;
  view(e).state.doc.descendants((n, p) => {
    if (pos >= 0) return false;
    if (n.type.name === 'blockContainer' && n.attrs.id === id) pos = p;
    return pos < 0;
  });
  return pos;
}

/** Pone el cursor en un bloque: al principio, al final o en un desplazamiento. */
export function caretAt(e: BlockNoteEditor, id: string, where: 'start' | 'end' | number): void {
  const v = view(e);
  const p = posOf(e, id);
  if (p < 0) throw new Error(`No block ${id}`);
  const content = v.state.doc.nodeAt(p)!.firstChild!;
  const pos = where === 'start' ? p + 2 : where === 'end' ? p + 2 + content.content.size : p + 2 + where;
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos)));
}

export function typeAt(e: BlockNoteEditor, id: string, where: 'start' | 'end' | number, text: string): void {
  caretAt(e, id, where);
  e.insertInlineContent(text);
}

/** Elige el bloque entero (como al tocar una imagen): el contenido (`inner`) o el bloque con sus hijos. */
export function selectNode(e: BlockNoteEditor, id: string, inner = false): void {
  const v = view(e);
  v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, posOf(e, id) + (inner ? 1 : 0))));
}

export function press(e: BlockNoteEditor, key: string, init: KeyboardEventInit = {}): void {
  view(e).dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

export const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

/** Generador de números al azar con semilla (el mismo de siempre para la misma semilla). */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
}

/** Las marcas `{n}` de un texto. */
export const tokens = (text: string) => text.match(/\{[A-Z]?\d+\}/g) ?? [];
