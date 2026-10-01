// @vitest-environment jsdom
// Convertir las fotos-bloque en fotos en línea (Docs/Doc_Fotos_En_Linea.md, entrega 3).
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { connect, editors, mountEditor, sameDocs, tick, undoManager, unmountAll, yText } from './collabHarness';
import { collapseExtension, headingBackspaceExtension } from './collapseEditor';
import { schema } from './editorSchema';
import { findExtension } from './findEditor';
import { undoGuardExtension } from './undoGuard';
import { convertPhotos, planConversion, REFERENCE_WIDTH_PX, type ConvertCheck } from './convertPhotos';
import { PHOTO } from './inlinePhoto';
import { brokenGaps, storedPhotos } from './photoHarness';
import { findUnknownContent, knownContent, STABLE_GAPS_MARKER } from './unknownContent';

afterEach(unmountAll);

const url = (n: string) => `https://example.invalid/${n}.jpg`;
const img = (id: string, props: Record<string, unknown> = {}, children: unknown[] = []) => ({
  id,
  type: 'image',
  props: { url: url(id), name: id, ...props },
  children,
});
const p = (id: string, text: string) => ({ id, type: 'paragraph', content: text });

const check = (commented: string[] = []): ConvertCheck => ({
  isAttachment: (_u, name) => /\.(pdf|zip)$/i.test(name),
  hasComments: (id) => commented.includes(id),
});

/** La página: una fila de tres a 1/3, una sola de 360 px centrada, una sin ancho, una con leyenda, un adjunto. */
const page = () => [
  p('t0', 'Escena 1'),
  img('A', { rowWidth: 1 / 3, previewWidth: 233 }),
  img('B', { rowWidth: 1 / 3, previewWidth: 233 }),
  img('C', { rowWidth: 1 / 3, previewWidth: 233 }),
  img('D', { previewWidth: 360, textAlignment: 'center' }),
  img('E'),
  img('F', { caption: 'Plano general' }),
  img('G', { url: url('G'), name: 'guion.pdf' }),
  p('t1', 'Fin'),
];

function docWith(blocks: unknown[]): { doc: Y.Doc; E: ReturnType<typeof mountEditor> } {
  const doc = new Y.Doc();
  const E = mountEditor(doc);
  E.replaceBlocks(E.document, blocks as never);
  return { doc, E };
}

/** Cada bloque de arriba: `tipo#id` y, si es un renglón, sus fotos con su ancho. */
function summary(E: ReturnType<typeof mountEditor>): string[] {
  const out: string[] = [];
  const walk = (list: typeof E.document, depth: number) => {
    for (const b of list) {
      const content = Array.isArray(b.content)
        ? (b.content as { type: string; text?: string; props?: { name: string; w: number } }[])
            .map((c) => (c.type === PHOTO ? `[${c.props!.name}@${+c.props!.w.toFixed(4)}]` : (c.text ?? '')))
            .join('')
        : '';
      const align = (b.props as { textAlignment?: string }).textAlignment;
      out.push(`${'  '.repeat(depth)}${b.type}#${b.id}${content ? ` ${content}` : ''}${align && align !== 'left' ? ` (${align})` : ''}`);
      walk(b.children, depth + 1);
    }
  };
  walk(E.document, 0);
  return out;
}

describe('qué se convierte', () => {
  it('una fila es un renglón con sus fotos y el mismo ancho; una sola, un renglón; leyenda y adjunto quedan', () => {
    const { E } = docWith(page());
    const plan = convertPhotos(E as never, check());
    expect(plan.photos).toBe(5);
    expect(plan.kept).toEqual({ caption: 1, attachment: 1, uploading: 0 });
    expect(summary(E)).toEqual([
      'paragraph#t0 Escena 1',
      'paragraph#A [A@0.3333][B@0.3333][C@0.3333]',
      `paragraph#D [D@0.5] (center)`,
      'paragraph#E [E@0]',
      'image#F',
      'image#G',
      'paragraph#t1 Fin',
    ]);
    expect(360 / REFERENCE_WIDTH_PX).toBe(0.5);
    // Otra vez: no queda nada por convertir.
    expect(planConversion(E.document as never, check()).segments).toHaveLength(0);
  });

  it('los comentarios: el renglón toma el id de la foto comentada; solo dos comentadas en una fila la parten', () => {
    const one = docWith(page());
    convertPhotos(one.E as never, check(['B', 'D']));
    expect(summary(one.E).slice(1, 3)).toEqual(['paragraph#B [A@0.3333][B@0.3333][C@0.3333]', 'paragraph#D [D@0.5] (center)']);
    const two = docWith(page());
    convertPhotos(two.E as never, check(['B', 'C']));
    expect(summary(two.E).slice(1, 3)).toEqual(['paragraph#B [A@0.3333][B@0.3333]', 'paragraph#C [C@0.3333]']);
  });

  it('los hijos de una foto pasan a su renglón (la foto con hijos termina el renglón)', () => {
    const { E } = docWith([
      img('A', { rowWidth: 0.5 }, [p('h1', 'nota de A')]),
      img('B', { rowWidth: 0.5 }),
      p('t', 'x'),
    ]);
    convertPhotos(E as never, check());
    expect(summary(E)).toEqual(['paragraph#A [A@0.5]', '  paragraph#h1 nota de A', 'paragraph#B [B@0.5]', 'paragraph#t x']);
  });

  it('videos, fotos del Drive y fotos dentro de una lista (hijos de otro bloque) también', () => {
    const drive = 'sdmedia://11111111-1111-4111-8111-111111111111';
    const { E } = docWith([
      { id: 'L', type: 'bulletListItem', content: 'ítem', children: [img('V', { url: url('toma'), name: 'toma.mp4' })] },
      img('M', { url: drive, name: 'IMG_1.jpg', rowWidth: 1 }),
    ]);
    convertPhotos(E as never, check());
    expect(summary(E)).toEqual(['bulletListItem#L ítem', '  paragraph#V [toma.mp4@0]', 'paragraph#M [IMG_1.jpg@1]']);
    const urls: string[] = [];
    E.prosemirrorView!.state.doc.descendants((n) => {
      if (n.type.name === PHOTO) urls.push(String(n.attrs.url));
      return true;
    });
    expect(urls).toEqual([url('toma'), drive]);
  });
});

describe('deshacer y versiones', () => {
  it('un Ctrl+Z vuelve todo como estaba (ids, anchos, nombres, leyenda)', async () => {
    const { E } = docWith(page());
    await tick(5);
    const before = JSON.stringify(E.document);
    undoManager(E).stopCapturing();
    convertPhotos(E as never, check());
    await tick(5);
    expect(JSON.stringify(E.document)).not.toBe(before);
    undoManager(E).undo();
    await tick(5);
    expect(JSON.stringify(E.document)).toBe(before);
  });

  it('con las extensiones de la página (sacar bloques corta el deshacer): sigue siendo un solo Ctrl+Z, y rehacer', async () => {
    const doc = new Y.Doc();
    const E = BlockNoteEditor.create(
      withCollaboration({
        schema,
        collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
        extensions: [findExtension, undoGuardExtension(), headingBackspaceExtension, collapseExtension({})],
      }),
    ) as unknown as BlockNoteEditor;
    const el = document.createElement('div');
    document.body.appendChild(el);
    E.mount(el);
    editors.push(E);
    E.replaceBlocks(E.document, page() as never);
    await tick(5);
    const before = JSON.stringify(E.document);
    undoManager(E).stopCapturing();
    convertPhotos(E as never, check());
    await tick(5);
    const after = JSON.stringify(E.document);
    E.undo();
    await tick(5);
    expect(JSON.stringify(E.document)).toBe(before);
    E.redo();
    await tick(5);
    expect(JSON.stringify(E.document)).toBe(after);
    // Lo de antes de convertir sigue siendo su propio paso.
    E.undo();
    E.undo();
    await tick(5);
    expect(E.document.filter((b) => b.type === 'image')).toHaveLength(0);
  });

  it('una página que es solo una fila, y una foto que es la única hija de un ítem: quedan en su lugar', async () => {
    const { E } = docWith([img('A', { rowWidth: 0.5 }), img('B', { rowWidth: 0.5 })]);
    convertPhotos(E as never, check());
    expect(summary(E)).toEqual(['paragraph#A [A@0.5][B@0.5]']);
    const second = docWith([{ id: 'L', type: 'bulletListItem', content: 'ítem', children: [img('V')] }, p('t', 'x')]);
    convertPhotos(second.E as never, check());
    expect(summary(second.E)).toEqual(['bulletListItem#L ítem', '  paragraph#V [V@0]', 'paragraph#t x']);
    await tick(5);
    undoManager(second.E).undo();
    await tick(5);
    expect(summary(second.E)).toEqual(['bulletListItem#L ítem', '  image#V', 'paragraph#t x']);
  });

  it('los renglones nuevos llevan la marca: las versiones anteriores no abren la página', async () => {
    const { doc, E } = docWith(page());
    convertPhotos(E as never, check());
    await tick(5);
    expect(brokenGaps(doc)).toEqual([]);
    const published = { nodes: new Set([...knownContent().nodes].filter((n) => n !== PHOTO && n !== STABLE_GAPS_MARKER)), marks: knownContent().marks };
    expect(findUnknownContent(doc, published)).not.toBeNull();
    expect(findUnknownContent(doc)).toBeNull();
  });
});

describe('con otro editor a la vez', () => {
  async function pair() {
    const d1 = new Y.Doc();
    const d2 = new Y.Doc();
    d1.clientID = 1;
    d2.clientID = 2;
    const A = mountEditor(d1, 'a');
    A.replaceBlocks(A.document, page() as never);
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1));
    const B = mountEditor(d2, 'b');
    const net = connect(d1, d2, 'async');
    await tick(10);
    return { d1, d2, A, B, net };
  }

  it('el otro escribe en otro renglón mientras se convierte: no se pierde nada y quedan iguales', async () => {
    const { d1, d2, A, B, net } = await pair();
    convertPhotos(A as never, check());
    B.setTextCursorPosition('t1', 'end');
    B.insertInlineContent(' y más');
    net.flush();
    net.flush();
    await tick(10);
    expect(yText(d1)).toBe(yText(d2));
    expect(summary(A)).toEqual(summary(B));
    expect(summary(A)).toContain('paragraph#t1 Fin y más');
    expect(summary(A)).toContain('paragraph#A [A@0.3333][B@0.3333][C@0.3333]');
  });

  it('los dos convierten a la vez (sin verse): quedan iguales; las fotos quedan dos veces (se prefiere duplicar a perder)', async () => {
    const { d1, d2, A, B, net } = await pair();
    convertPhotos(A as never, check());
    convertPhotos(B as never, check());
    for (let i = 0; i < 4; i++) {
      net.flush();
      await tick(10);
    }
    expect(sameDocs(d1, d2)).toBe(true);
    expect(yText(d1)).toBe(yText(d2));
    const shape = (E: typeof A) => summary(E).map((l) => l.replace(/#[^ ]+/, ''));
    expect(shape(A)).toEqual(shape(B));
    // Medido: cada renglón queda dos veces (las dos conversiones se suman) y ninguna foto se pierde, en la página y en
    // lo guardado. Los dos renglones con el mismo id reciben en cada editor ids nuevos (el editor no deja dos iguales);
    // ese cambio de id no llega a Yjs hasta la próxima edición (lo hace BlockNote mientras dibuja lo que llegó), así
    // que acá no se compara el editor con lo guardado. Los comentarios de la primera foto de un renglón pueden quedar
    // sin bloque en este caso (Doc_Fotos_En_Linea.md, entrega 3).
    expect((shape(A).join(' ').match(/\[[A-E]@/g) ?? []).length).toBe(10);
    expect(storedPhotos(d1).length).toBe(10);
    expect(shape(A).filter((l) => l.startsWith('image')).length).toBe(2);
  });
});
