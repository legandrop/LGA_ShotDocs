// @vitest-environment jsdom
// Versiones mezcladas con la librería de VERDAD de las versiones publicadas (Docs/Doc_Colaboracion.md,
// "Versiones viejas"). En este archivo `y-prosemirror` es la de la v0.052 a la v0.075 (antes de los huecos
// estables; la arma src/test/publishedYProsemirror.ts y la pone el alias de vite.config.ts, proyecto
// `published`), también adentro de BlockNote: el editor con el esquema anterior es exactamente el de esas
// versiones. El dispositivo nuevo es un ProseMirror con el esquema de hoy y la librería de hoy (importada por su
// ruta), que es lo que escribe Yjs en la app de hoy (BlockNote no toca esa parte).
//
// Cómo se mide: desde un mismo estado S, cada dispositivo edita por su lado (sin verse, como dos dispositivos
// sin red, o uno viejo cuya cola llega después de actualizarse) y después se juntan los cambios.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BlockNoteEditor } from '@blocknote/core';
import type { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { PUBLISHED_DIR, PUBLISHED_ENTRY, SHA_PUBLISHED } from '../test/publishedYProsemirror';
import { mountEditor, tick, unmountAll, view } from './collabHarness';
import { schema } from './editorSchema';
import { GAP_TEXT_SPEC, PHOTO } from './inlinePhoto';
import { para, previousSchema } from './photoHarness';
import { findUnknownContent, knownContent, STABLE_GAPS_MARKER, type KnownContent } from './unknownContent';

type Lib = typeof import('y-prosemirror');

// La librería de hoy, por su ruta (el alias solo cambia `y-prosemirror` a secas).
const CURRENT_LIB = '../../node_modules/y-prosemirror/src/y-prosemirror.js';
let current: Lib;
let pm: Schema;

/** Lo que conoce el resguardo de las versiones publicadas de la v0.052 a la v0.075 (unknownContent.ts de entonces). */
const PUBLISHED_KNOWN: KnownContent = {
  nodes: new Set([...knownContent().nodes].filter((n) => n !== PHOTO && n !== STABLE_GAPS_MARKER)),
  marks: knownContent().marks,
};

const views: EditorView[] = [];
afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
  unmountAll();
});

beforeAll(async () => {
  current = (await import(/* @vite-ignore */ CURRENT_LIB)) as Lib;
  pm = (BlockNoteEditor.create({ schema }) as unknown as BlockNoteEditor).pmSchema;
});

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

/** Un dispositivo con la app de hoy: ProseMirror con el esquema de hoy y `ySyncPlugin` de la librería de hoy. */
async function currentDevice(doc: Y.Doc): Promise<EditorView> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const v = new EditorView(el, {
    state: EditorState.create({ schema: pm, plugins: [current.ySyncPlugin(doc.getXmlFragment(CONTENT_FRAGMENT))] }),
  });
  views.push(v);
  await tick(20);
  return v;
}

/** El principio del texto del bloque con ese id (posición de ProseMirror). */
function startOf(state: EditorState, id: string): number {
  let at = -1;
  state.doc.descendants((n, pos) => {
    if (at >= 0) return false;
    if (n.type.name === 'blockContainer' && n.attrs.id === id) at = pos + 2;
    return at < 0;
  });
  if (at < 0) throw new Error(`No block ${id}`);
  return at;
}

const photoNode = (name: string) => pm.nodes[PHOTO].create({ url: `https://example.invalid/${name}.jpg`, name, w: 0.5 });

function rawInsertText(v: EditorView, pos: number, text: string): void {
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos)).insertText(text));
}

/** Las fotos de la vista, de atrás para adelante (para borrarlas sin correr posiciones). */
function photoPositions(v: EditorView): number[] {
  const out: number[] = [];
  v.state.doc.descendants((n, pos) => {
    if (n.type.name === PHOTO) out.push(pos);
    return true;
  });
  return out.reverse();
}

/** Los updates que escribe un dispositivo desde S: al abrir y al editar. */
async function editFrom(
  S: Uint8Array,
  clientId: number,
  device: 'old' | 'new',
  edit: (open: { view: EditorView; insert: (offset: number | 'end', text: string) => void }) => void,
): Promise<{ opened: boolean; onOpen: string[]; onEdit: string[] }> {
  const d = new Y.Doc();
  d.clientID = clientId;
  Y.applyUpdate(d, S, 'remote');
  // El resguardo de cada versión: si no conoce algo, no abre la página (no escribe nada).
  const known = device === 'old' ? PUBLISHED_KNOWN : knownContent();
  if (findUnknownContent(d, known) !== null) return { opened: false, onOpen: [], onEdit: [] };
  const onOpen: string[] = [];
  const onEdit: string[] = [];
  let phase = onOpen;
  d.on('update', (u: Uint8Array, o: unknown) => {
    if (o !== 'remote') phase.push(b64(u));
  });
  let v: EditorView;
  if (device === 'old') {
    v = view(mountEditor(d, 'old', previousSchema));
    await tick(20);
  } else {
    v = await currentDevice(d);
  }
  phase = onEdit;
  const start = startOf(v.state, 'p1');
  const end = start + v.state.doc.resolve(start).parent.content.size;
  edit({ view: v, insert: (offset, text) => rawInsertText(v, offset === 'end' ? end : start + offset, text) });
  await tick(5);
  for (const x of views.splice(0)) x.destroy();
  unmountAll();
  return { opened: true, onOpen, onEdit };
}

/** El renglón p1 tal como quedó en Yjs: sus textos (`*` sin la marca) y sus elementos. */
function rowOf(doc: Y.Doc): Y.XmlElement {
  let row: Y.XmlElement | null = null;
  const walk = (el: Y.XmlElement | Y.XmlFragment) => {
    for (const c of el.toArray()) {
      if (!(c instanceof Y.XmlElement) || row) continue;
      if (c.nodeName === 'blockContainer' && c.getAttribute('id') === 'p1') row = c.get(0) as Y.XmlElement;
      else walk(c);
    }
  };
  walk(doc.getXmlFragment(CONTENT_FRAGMENT));
  if (!row) throw new Error('Sin el renglón p1');
  return row;
}
const rowText = (doc: Y.Doc) =>
  rowOf(doc)
    .toArray()
    .filter((c): c is Y.XmlText => c instanceof Y.XmlText)
    .map((t) => t.toString())
    .join('');
const describeRow = (doc: Y.Doc) =>
  rowOf(doc)
    .toArray()
    .map((c) => (c instanceof Y.XmlText ? `${c.getAttribute(GAP_TEXT_SPEC) === true ? '' : '*'}${JSON.stringify(c.toString())}` : `<${c.nodeName}>`))
    .join(' ');

/**
 * El estado S: un renglón `abcdefghi` al que la app de hoy le puso dos fotos (`abc[F1]def[F2]ghi`) y después se
 * las borró. Con `photos`, sin borrarlas.
 */
async function rowState({ photos = false } = {}): Promise<Uint8Array> {
  const doc = new Y.Doc();
  doc.clientID = 900;
  // El documento lo arma la versión publicada (un párrafo común, como cualquier página de hoy).
  const E = mountEditor(doc, 'm', previousSchema);
  E.replaceBlocks(E.document, [para('p0', ['top']), para('p1', ['abcdefghi'])] as never);
  await tick(5);
  unmountAll();
  const v = await currentDevice(doc);
  const s = startOf(v.state, 'p1');
  v.dispatch(v.state.tr.insert(s + 6, photoNode('F2')));
  v.dispatch(v.state.tr.insert(s + 3, photoNode('F1')));
  if (!photos) for (const p of photoPositions(v)) v.dispatch(v.state.tr.delete(p, p + 1));
  await tick(5);
  for (const x of views.splice(0)) x.destroy();
  return Y.encodeStateAsUpdate(doc);
}

/** El mismo estado, guardado como lo guarda la v0.076 (sin la marca del renglón). */
function withoutMarker(S: Uint8Array): Uint8Array {
  const d = new Y.Doc();
  Y.applyUpdate(d, S);
  const row = rowOf(d);
  d.transact(() => {
    for (let i = row.length - 1; i >= 0; i--) {
      const c = row.get(i);
      if (c instanceof Y.XmlElement && c.nodeName === STABLE_GAPS_MARKER) row.delete(i, 1);
    }
  });
  return Y.encodeStateAsUpdate(d);
}

// Dónde escribe cada dispositivo en `abcdefghi` (los bordes de los textos que dejan las fotos: 3 y 6).
const OFFSETS: (number | 'end')[] = [0, 2, 3, 4, 6, 7, 'end'];

interface Combined {
  combos: number;
  lost: number;
  twice: number;
  oldOpened: number;
  examples: string[];
}

/** Junta cada edición de A con cada una de B (sin verse) y cuenta lo perdido o duplicado. */
async function combine(S: Uint8Array, a: 'old' | 'new', b: 'old' | 'new'): Promise<Combined> {
  const mark = (who: 'old' | 'new', n: number) => (who === 'old' ? `{O${n}}` : `{N${n}}`);
  const edits = async (who: 'old' | 'new', base: number) => {
    const out = [];
    for (const [i, off] of OFFSETS.entries()) out.push(await editFrom(S, base + i, who, ({ insert }) => insert(off, mark(who, base + i))));
    return out;
  };
  const A = await edits(a, 2000);
  const B = await edits(b, 3000);
  const res: Combined = { combos: 0, lost: 0, twice: 0, oldOpened: 0, examples: [] };
  res.oldOpened = [...(a === 'old' ? A : []), ...(b === 'old' ? B : [])].filter((e) => e.opened).length;
  for (const [i, ea] of A.entries()) {
    for (const [j, eb] of B.entries()) {
      const d = new Y.Doc();
      Y.applyUpdate(d, S);
      for (const u of [...ea.onOpen, ...ea.onEdit, ...eb.onOpen, ...eb.onEdit]) Y.applyUpdate(d, fromB64(u));
      const text = rowText(d);
      const marks = [ea.opened ? mark(a, 2000 + i) : null, eb.opened ? mark(b, 3000 + j) : null].filter((m): m is string => m !== null);
      const count = (s: string) => text.split(s).length - 1;
      const plain = text.replace(/\{[ON]\d+\}/g, '');
      res.combos++;
      const lost = marks.some((m) => count(m) === 0) || plain.length < 9;
      const twice = marks.some((m) => count(m) > 1) || plain.length > 9;
      if (lost) res.lost++;
      else if (twice) res.twice++;
      if ((lost || twice) && res.examples.length < 3) res.examples.push(`${describeRow(d)} ← ${marks.join(' ')}`);
    }
  }
  return res;
}

describe('la librería de las versiones publicadas', () => {
  it('es la de antes de los huecos estables (no conoce la marca de los textos)', async () => {
    const lib = await import('y-prosemirror');
    expect(lib.ySyncPlugin).not.toBe(current.ySyncPlugin);
    // El alias (vite.config.ts) apunta a lo que arma publishedYProsemirror.ts, y es la librería de entonces.
    const config = readFileSync('vite.config.ts', 'utf8');
    expect(PUBLISHED_ENTRY.endsWith(/\.\/(node_modules\/\.cache\/[^']+)'/.exec(config)?.[1] ?? '?')).toBe(true);
    expect(sha(readFileSync(`${PUBLISHED_DIR}/src/plugins/sync-plugin.js`, 'utf8'))).toBe(SHA_PUBLISHED);
    // Con la librería publicada, editar un renglón con varios textos seguidos los junta en uno (borra los otros).
    const S = withoutMarker(await rowState());
    const e = await editFrom(S, 77, 'old', ({ insert }) => insert(0, 'x'));
    expect(e.opened).toBe(true);
    expect(e.onOpen).toEqual([]);
    const d = new Y.Doc();
    Y.applyUpdate(d, S);
    for (const u of e.onEdit) Y.applyUpdate(d, fromB64(u));
    expect(describeRow(d)).toBe('"xabcdefghi"');
  });
});

describe('un renglón al que le borraron todas las fotos', () => {
  it('así lo deja la app de hoy: los textos de los huecos y la marca del renglón', async () => {
    const d = new Y.Doc();
    Y.applyUpdate(d, await rowState());
    expect(describeRow(d)).toBe(`<${STABLE_GAPS_MARKER}> "abc" "def" "ghi"`);
    // La marca la ve el resguardo de las versiones publicadas: no abren la página.
    expect(findUnknownContent(d, PUBLISHED_KNOWN)).toBe(`"${STABLE_GAPS_MARKER}"`);
    // La de hoy sí.
    expect(findUnknownContent(d)).toBeNull();
  }, 60_000);

  it('ANTES (como lo guardaba la v0.076, sin la marca): la versión publicada lo abre y se pierde o duplica texto', async () => {
    const S = withoutMarker(await rowState());
    const oldNew = await combine(S, 'old', 'new');
    const oldOld = await combine(S, 'old', 'old');
    // Lo que midió la auditoría de v0.076: lo del nuevo en el 2.º o el 3.er texto se pierde (la versión publicada
    // copia todo en el primero y borra los otros); con dos publicadas, cada una vuelve a escribir el renglón entero.
    expect({ combos: oldNew.combos, lost: oldNew.lost, twice: oldNew.twice }).toEqual({ combos: 49, lost: 28, twice: 0 });
    expect({ combos: oldOld.combos, lost: oldOld.lost, twice: oldOld.twice }).toEqual({ combos: 49, lost: 0, twice: 49 });
    expect(oldNew.oldOpened).toBe(7);
  }, 120_000);

  it('AHORA (con la marca): la versión publicada no lo abre, no escribe nada y no se pierde nada', async () => {
    const S = await rowState();
    const oldNew = await combine(S, 'old', 'new');
    const oldOld = await combine(S, 'old', 'old');
    const newNew = await combine(S, 'new', 'new');
    expect(oldNew.oldOpened + oldOld.oldOpened).toBe(0);
    expect({ lost: oldNew.lost, twice: oldNew.twice }).toEqual({ lost: 0, twice: 0 });
    expect({ lost: oldOld.lost, twice: oldOld.twice }).toEqual({ lost: 0, twice: 0 });
    expect({ lost: newNew.lost, twice: newNew.twice }).toEqual({ lost: 0, twice: 0 });
  }, 120_000);
});

describe('un renglón con fotos', () => {
  it('la versión publicada no lo abre (con y sin la marca); la de hoy lo edita sin perder nada', async () => {
    const S = await rowState({ photos: true });
    const d = new Y.Doc();
    Y.applyUpdate(d, S);
    expect(describeRow(d)).toBe(`<${STABLE_GAPS_MARKER}> "abc" <photo> "def" <photo> "ghi"`);
    expect(findUnknownContent(d, PUBLISHED_KNOWN)).not.toBeNull();
    const old = withoutMarker(S);
    const d2 = new Y.Doc();
    Y.applyUpdate(d2, old);
    expect(findUnknownContent(d2, PUBLISHED_KNOWN)).toBe('"photo"');
    const oldNew = await combine(S, 'old', 'new');
    const newNew = await combine(S, 'new', 'new');
    expect(oldNew.oldOpened).toBe(0);
    expect({ lost: oldNew.lost + newNew.lost, twice: oldNew.twice + newNew.twice }).toEqual({ lost: 0, twice: 0 });
  }, 120_000);
});
