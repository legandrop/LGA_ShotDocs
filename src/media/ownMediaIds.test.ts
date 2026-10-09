// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { schema } from '../ui/editorSchema';
import { MEDIA_SCHEME } from './queue';
import { linkOnOpen, mediaIdsInDoc, ownMediaIds, serverUsesBesidesOwn } from './usage';

// D611: qué fotos trae lo que este dispositivo tiene de una página y el servidor todavía no (la diferencia contra
// `syncedSV`). Con el editor real (BlockNote con colaboración), como lo escribe la app. Y `linkOnOpen` con dependencias de
// mentira: sus guardas (D613) y que una falla termine en «todo por mandar» (C1 de la auditoría de E14).

const editors: { e: BlockNoteEditor; el: HTMLElement }[] = [];
afterEach(() => {
  for (const { e, el } of editors.splice(0)) {
    e.unmount();
    el.remove();
  }
});

function editorOn(doc: Y.Doc): BlockNoteEditor {
  const e = BlockNoteEditor.create(
    withCollaboration({ schema, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } } }) as never,
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  e.mount(el);
  editors.push({ e, el });
  return e;
}

const uuid = () => crypto.randomUUID();
const own = (doc: Y.Doc, sv: Uint8Array) => [...(ownMediaIds(doc, sv) ?? ['NULL'])].sort();

/** Un reporte con fotos en bloque y en línea, escrito con el editor; `sv` es lo que «tiene el servidor». */
function report() {
  const doc = new Y.Doc();
  const e = editorOn(doc);
  const f = [uuid(), uuid(), uuid(), uuid(), uuid()];
  e.replaceBlocks(e.document, [
    { type: 'paragraph', content: 'Reporte' },
    { type: 'image', props: { url: MEDIA_SCHEME + f[0] } },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Fotos: ', styles: {} },
        { type: 'photo', props: { url: MEDIA_SCHEME + f[1], name: 'a' } },
        { type: 'photo', props: { url: MEDIA_SCHEME + f[2], name: 'b' } },
        { type: 'text', text: ' fin', styles: {} },
      ],
    },
    { type: 'image', props: { url: MEDIA_SCHEME + f[3] } },
    { type: 'paragraph', content: [{ type: 'photo', props: { url: MEDIA_SCHEME + f[4], name: 'c' } }] },
  ] as never);
  expect(mediaIdsInDoc(doc).size).toBe(5);
  return { doc, e, f, sv: Y.encodeStateVector(doc) };
}

describe('ownMediaIds con el editor real (D611)', () => {
  it('escribir junto a las fotos no trae ninguna', () => {
    const { doc, e, sv } = report();
    const blocks = e.document;
    e.setTextCursorPosition(blocks[0].id, 'end');
    e.insertInlineContent('x');
    expect(own(doc, sv)).toEqual([]);
    // En el párrafo que tiene fotos en línea.
    e.setTextCursorPosition(blocks[2].id, 'end');
    e.insertInlineContent('y');
    expect(own(doc, sv)).toEqual([]);
    // Un párrafo nuevo entre fotos.
    e.insertBlocks([{ type: 'paragraph', content: 'nuevo' }] as never, blocks[1].id, 'after');
    expect(own(doc, sv)).toEqual([]);
  });

  it('cambiar el texto de un bloque con fotos en línea no las trae', () => {
    const { doc, e, f, sv } = report();
    const block = e.document[2];
    e.updateBlock(block.id, {
      content: [
        { type: 'text', text: 'Fotos!! ', styles: {} },
        { type: 'photo', props: { url: MEDIA_SCHEME + f[1], name: 'a' } },
        { type: 'photo', props: { url: MEDIA_SCHEME + f[2], name: 'b' } },
        { type: 'text', text: ' fin', styles: {} },
      ],
    } as never);
    expect(own(doc, sv)).toEqual([]);
  });

  it('pegar una foto en línea y una en bloque las trae', () => {
    const { doc, e, sv } = report();
    const g = uuid();
    const h = uuid();
    e.setTextCursorPosition(e.document[0].id, 'end');
    e.insertInlineContent([{ type: 'photo', props: { url: MEDIA_SCHEME + g, name: 'g' } }] as never);
    e.insertBlocks([{ type: 'image', props: { url: MEDIA_SCHEME + h } }] as never, e.document[0].id, 'after');
    expect(own(doc, sv)).toEqual([g, h].sort());
  });

  it('mover una foto (sacar y volver a poner) la trae', () => {
    const { doc, e, f, sv } = report();
    const moved = e.document.find((b) => (b.props as { url?: string }).url === MEDIA_SCHEME + f[3])!;
    e.removeBlocks([moved.id]);
    e.insertBlocks([{ type: 'image', props: { url: MEDIA_SCHEME + f[3] } }] as never, e.document[0].id, 'before');
    expect(own(doc, sv)).toEqual([f[3]]);
  });

  it('borrar y deshacer la trae (Yjs vuelve a escribir el bloque)', () => {
    const { doc, f, sv } = report();
    const undo = new Y.UndoManager(doc.getXmlFragment(CONTENT_FRAGMENT));
    // Como el deshacer de la app sobre el Y.Doc: borrar el bloque de la foto y deshacerlo.
    const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
    const at = group
      .toArray()
      .findIndex((c) => ((c as Y.XmlElement).get(0) as Y.XmlElement | undefined)?.getAttribute('url') === MEDIA_SCHEME + f[0]);
    expect(at).toBeGreaterThanOrEqual(0);
    group.delete(at, 1);
    expect(mediaIdsInDoc(doc).has(f[0])).toBe(false);
    undo.stopCapturing();
    undo.undo();
    expect(mediaIdsInDoc(doc).has(f[0])).toBe(true);
    expect(own(doc, sv)).toContain(f[0]);
  });

  it('sin syncedSV no se sabe: null', () => {
    const { doc } = report();
    expect(ownMediaIds(doc, undefined)).toBeNull();
  });
});

describe('serverUsesBesidesOwn (D611, C1)', () => {
  it('saca lo que trae lo propio; sin saber o si el cálculo falla, undefined (se manda todo)', () => {
    const { doc, e, f, sv } = report();
    const uses = new Map(f.map((id) => [id, { foreign: false }]));
    e.insertBlocks([{ type: 'image', props: { url: MEDIA_SCHEME + f[0] } }] as never, e.document[0].id, 'after');
    expect([...serverUsesBesidesOwn(uses, doc, sv)!.keys()].sort()).toEqual(f.slice(1).sort());
    expect(serverUsesBesidesOwn(uses, doc, undefined)).toBeUndefined();
    expect(serverUsesBesidesOwn(undefined, doc, sv)).toBeUndefined();
    // Un vector de estado roto: Yjs tira al leerlo. Nunca corta la comparación: se manda todo.
    expect(() => ownMediaIds(doc, new Uint8Array([0xff]))).toThrow();
    expect(serverUsesBesidesOwn(uses, doc, new Uint8Array([0xff]))).toBeUndefined();
  });
});

describe('linkOnOpen: guardas y fallas (D613, D617)', () => {
  type Call = { ids: string[]; unconfirmed: boolean };
  function fake({
    unsentCreate = false,
    writeError = null as string | null,
    ownUnsent = false as boolean | 'throw',
    snapshot = null as null | (() => Promise<never>) | { doc: Y.Doc; sv: Uint8Array | undefined },
    failWritesOnSnapshot = false,
  }) {
    const calls: Call[] = [];
    const deps = {
      media: {
        ensureLinks: async (_page: string, ids: string[], opts: { unconfirmed?: boolean } = {}) => {
          calls.push({ ids, unconfirmed: !!opts.unconfirmed });
        },
      },
      docs: {
        getWriteError: () => writeError,
        hasOwnUnsent: async () => {
          if (ownUnsent === 'throw') throw new Error('IndexedDB cerrándose');
          return ownUnsent;
        },
        snapshot: async () => {
          // Guardar empieza a fallar mientras se lee lo guardado.
          if (failWritesOnSnapshot) writeError = 'QuotaExceededError';
          if (typeof snapshot === 'function') return snapshot();
          const doc = new Y.Doc();
          if (snapshot) Y.applyUpdate(doc, Y.encodeStateAsUpdate(snapshot.doc));
          return { doc, state: { pageId: 'p', cursor: 0, version: 1, ackedVersion: 0, syncedSV: snapshot?.sv }, dirty: false, supported: true };
        },
      },
      tree: { hasUnsentCreate: () => unsentCreate },
    };
    return { deps: deps as unknown as Parameters<typeof linkOnOpen>[0], calls };
  }
  const by = (calls: Call[]) => ({
    unconfirmed: calls.filter((c) => c.unconfirmed).flatMap((c) => c.ids).sort(),
    pending: calls.filter((c) => !c.unconfirmed).flatMap((c) => c.ids).sort(),
  });

  it('una página que el servidor todavía no tiene: todo por mandar aunque el documento no tenga nada propio', async () => {
    // La guarda `hasUnsentCreate` sola (D613): con `hasOwnUnsent` en falso, sin ella quedarían sin confirmar.
    const ids = [uuid(), uuid()];
    const { deps, calls } = fake({ unsentCreate: true, ownUnsent: false });
    await linkOnOpen(deps, 'p', ids);
    expect(by(calls)).toEqual({ unconfirmed: [], pending: [...ids].sort() });
  });

  it('guardar está fallando: todo por mandar', async () => {
    const ids = [uuid()];
    const { deps, calls } = fake({ writeError: 'QuotaExceededError' });
    await linkOnOpen(deps, 'p', ids);
    expect(by(calls)).toEqual({ unconfirmed: [], pending: ids });
  });

  it('nada propio: todo sin confirmar', async () => {
    const ids = [uuid(), uuid()];
    const { deps, calls } = fake({});
    await linkOnOpen(deps, 'p', ids);
    expect(by(calls)).toEqual({ unconfirmed: [...ids].sort(), pending: [] });
  });

  it('algo propio: sin confirmar lo que vino del servidor, por mandar lo que trae lo propio', async () => {
    const { doc, e, f, sv } = report();
    const g = uuid();
    e.insertBlocks([{ type: 'image', props: { url: MEDIA_SCHEME + g } }] as never, e.document[0].id, 'after');
    const { deps, calls } = fake({ ownUnsent: true, snapshot: { doc, sv } });
    await linkOnOpen(deps, 'p', [...f, g]);
    expect(by(calls)).toEqual({ unconfirmed: [...f].sort(), pending: [g] });
  });

  it('guardar empieza a fallar mientras se lee lo guardado: todo por mandar, nada sin confirmar (MF de E14)', async () => {
    const { doc, f, sv } = report();
    const { deps, calls } = fake({ ownUnsent: true, snapshot: { doc, sv }, failWritesOnSnapshot: true });
    await linkOnOpen(deps, 'p', f);
    expect(by(calls)).toEqual({ unconfirmed: [], pending: [...f].sort() });
  });

  it('algo propio sin syncedSV: todo por mandar', async () => {
    const { doc, f } = report();
    const { deps, calls } = fake({ ownUnsent: true, snapshot: { doc, sv: undefined } });
    await linkOnOpen(deps, 'p', f);
    expect(by(calls)).toEqual({ unconfirmed: [], pending: [...f].sort() });
  });

  it('C1: si leer lo guardado o lo propio tira, todo por mandar (nunca sin filas)', async () => {
    const ids = [uuid(), uuid()];
    const a = fake({ ownUnsent: true, snapshot: async () => Promise.reject(new Error('base cerrándose')) });
    await expect(linkOnOpen(a.deps, 'p', ids)).resolves.toBeUndefined();
    expect(by(a.calls)).toEqual({ unconfirmed: [], pending: [...ids].sort() });
    const b = fake({ ownUnsent: 'throw' });
    await expect(linkOnOpen(b.deps, 'p', ids)).resolves.toBeUndefined();
    expect(by(b.calls)).toEqual({ unconfirmed: [], pending: [...ids].sort() });
    // Un vector de estado roto (decodificar tira).
    const { doc, f } = report();
    const c = fake({ ownUnsent: true, snapshot: { doc, sv: new Uint8Array([0xff]) } });
    await linkOnOpen(c.deps, 'p', f);
    expect(by(c.calls)).toEqual({ unconfirmed: [], pending: [...f].sort() });
  });
});
