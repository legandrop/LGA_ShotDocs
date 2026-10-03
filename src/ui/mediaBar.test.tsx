// @vitest-environment jsdom
// La barra de una foto (D-24): la misma para la foto-bloque y la foto en línea, por sectores; sin leyenda; y lo que
// hace cada botón de la foto en línea (paridad con la foto-bloque).
import { BlockNoteEditor } from '@blocknote/core';
import { BlockNoteView } from '@blocknote/mantine';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeAssistant, registerAssistantTarget, useAssistantUi } from '../assistant/assistantUi';
import { t } from '../i18n';
import { ServicesContext } from '../services';
import { editorSchemaOptions } from './editorSchema';
import { PHOTO } from './inlinePhoto';
import { inlinePhotoExtensions } from './inlinePhotoEditor';
import { inlinePhotoSpotsExtension } from './inlinePhotoCreate';
import { MediaActionsContext, type MediaActions } from './MediaBar';
import { PageFormattingToolbarController, PageFormattingToolbar, pageToolbarItems } from './PageToolbar';
import { PhotoToolbarController } from './PhotoToolbar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as never;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Range.prototype.getClientRects ??= (() => []) as never;
  Range.prototype.getBoundingClientRect ??= (() => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })) as never;
});

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

const url = (n: string) => `https://example.invalid/${n}.jpg`;
const ph = (name: string, w = 0.5) => ({ type: 'photo', props: { url: url(name), name, w } });

function Toolbar() {
  return <PageFormattingToolbar items={pageToolbarItems(editorRef.current!.dictionary, t)} canComment />;
}
const editorRef: { current: BlockNoteEditor | null } = { current: null };

async function mount(stored: string[] = []) {
  const editor = BlockNoteEditor.create({
    ...editorSchemaOptions,
    extensions: [...inlinePhotoExtensions, inlinePhotoSpotsExtension],
  }) as unknown as BlockNoteEditor;
  editorRef.current = editor;
  const actions: MediaActions = {
    store: async (file) => {
      stored.push(file.name);
      return `https://example.invalid/new/${file.name}`;
    },
    accept: { inline: 'image/*,video/*', block: 'image/*,video/*,*/*' },
    canComment: true,
    onView: vi.fn(),
  };
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  await act(async () => {
    root.render(
      <ServicesContext.Provider value={{ media: { fileInfo: () => null } } as never}>
        <MediaActionsContext.Provider value={actions}>
          <BlockNoteView editor={editor} sideMenu={false} formattingToolbar={false} slashMenu={false}>
            <PageFormattingToolbarController formattingToolbar={Toolbar} />
            <PhotoToolbarController />
          </BlockNoteView>
        </MediaActionsContext.Provider>
      </ServicesContext.Provider>,
    );
  });
  await act(async () => {
    editor.replaceBlocks(editor.document, [
      { id: 'img', type: 'image', props: { url: url('B1'), name: 'B1' } },
      { id: 'p', type: 'paragraph', content: [{ type: 'text', text: 'antes ', styles: {} }, ph('F1'), ph('F2'), ph('F3')] },
    ] as never);
  });
  return { editor, actions };
}

const view = (e: BlockNoteEditor) => e.prosemirrorView!;
function photoPos(e: BlockNoteEditor, name: string): number {
  let found = -1;
  view(e).state.doc.descendants((n, pos) => {
    if (n.type.name === PHOTO && n.attrs.name === name) found = pos;
    return found < 0;
  });
  return found;
}
const names = (e: BlockNoteEditor) => {
  const out: string[] = [];
  view(e).state.doc.descendants((n) => {
    if (n.type.name === PHOTO) out.push(String(n.attrs.name));
    return true;
  });
  return out;
};

/** La barra que se ve: sus botones (por su nombre) y `|` en cada separador. */
function bar(selector: string): string[] {
  const root = document.querySelector(selector);
  if (!root) return [];
  return [...root.querySelectorAll('button, .sd-bar-sep')].map((el) => (el.classList.contains('sd-bar-sep') ? '|' : (el.getAttribute('aria-label') ?? '')));
}

async function chooseBlock(e: BlockNoteEditor) {
  await act(async () => {
    e.focus();
    let at = -1;
    view(e).state.doc.descendants((n, pos) => {
      if (n.type.name === 'image' && at < 0) at = pos;
      return at < 0;
    });
    view(e).dispatch(view(e).state.tr.setSelection(NodeSelection.create(view(e).state.doc, at)));
  });
}

async function choosePhoto(e: BlockNoteEditor, name: string) {
  await act(async () => {
    e.focus();
    view(e).dispatch(view(e).state.tr.setSelection(NodeSelection.create(view(e).state.doc, photoPos(e, name))));
  });
  await act(async () => {
    document.dispatchEvent(new FocusEvent('focusin'));
  });
}

async function click(selector: string, label: string) {
  const btn = [...document.querySelectorAll(`${selector} button`)].find((b) => b.getAttribute('aria-label') === label) as HTMLButtonElement | undefined;
  if (!btn) throw new Error(`No button ${label}`);
  await act(async () => {
    btn.click();
  });
}

/** El estado del asistente (lo que pidió la barra), leído con un componente de prueba que no hace falta: el módulo lo guarda. */
let lastUi: ReturnType<typeof import('../assistant/assistantUi').useAssistantUi> | null = null;
const assistantUiState = () => {
  lastUi = null;
  const el = document.createElement('div');
  const r = createRoot(el);
  act(() => r.render(<UiProbe />));
  act(() => r.unmount());
  return lastUi!;
};
function UiProbe() {
  lastUi = useAssistantUi();
  return null;
}

const BLOCK = '.sd-media-bar:not(.sd-photo-toolbar)';
const INLINE = '.sd-photo-toolbar';

describe('la barra, por sectores (D-24)', () => {
  it('foto-bloque: ver y bajar | tamaños | alinear | comentar | reemplazar, renombrar, borrar; sin leyenda ni vista previa', async () => {
    const { editor } = await mount();
    await chooseBlock(editor);
    expect(bar(BLOCK)).toEqual([
      'View full screen',
      'Download image',
      '|',
      'Full width',
      'Half the page width',
      'A third of the page width',
      'A quarter of the page width',
      '|',
      'Align left',
      'Align center',
      'Align right',
      '|',
      'Comment',
      '|',
      'Replace image',
      'Rename image',
      'Delete image',
    ]);
    expect(document.querySelector('[aria-label="Edit caption"], [aria-label="Toggle preview"]')).toBeNull();
  });

  it('foto en línea: la misma barra, más "Arrange in rows" con las seguidas; tooltips data-tip, nunca title', async () => {
    const { editor } = await mount();
    await choosePhoto(editor, 'F2');
    expect(bar(INLINE)).toEqual([
      'View full screen',
      'Download image',
      '|',
      'Full width',
      'Half the page width',
      'A third of the page width',
      'A quarter of the page width',
      'Arrange in rows',
      '|',
      'Align left',
      'Align center',
      'Align right',
      '|',
      'Comment',
      '|',
      'Replace image',
      'Rename image',
      'Delete image',
    ]);
    const buttons = [...document.querySelectorAll(`${INLINE} button`)];
    expect(buttons.every((b) => !b.hasAttribute('title') && !!b.getAttribute('data-tip'))).toBe(true);
    expect(buttons.every((b) => b.classList.contains('sd-bar-button'))).toBe(true);
    // Con la foto en línea elegida no se abre la barra de la foto-bloque ni la de texto.
    expect(document.querySelectorAll('.bn-formatting-toolbar').length).toBe(1);
  });
});

describe('la barra de una foto en una celda de tabla (entrega 5)', () => {
  async function inCell() {
    const m = await mount();
    await act(async () => {
      m.editor.replaceBlocks(m.editor.document, [
        {
          id: 'tb',
          type: 'table',
          content: { type: 'tableContent', rows: [{ cells: [[ph('C1', 0), ph('C2', 0)], [{ type: 'text', text: 'nota', styles: {} }]] }] },
        },
      ] as never);
    });
    return m;
  }
  const widths = (e: BlockNoteEditor) => {
    const out: number[] = [];
    view(e).state.doc.descendants((n) => {
      if (n.type.name === PHOTO) out.push(Number(n.attrs.w));
      return true;
    });
    return out;
  };

  it('solo miniatura y todo el ancho de la celda (D32); sin 1/2, 1/3, 1/4, acomodar ni alinear', async () => {
    const { editor } = await inCell();
    await choosePhoto(editor, 'C1');
    expect(bar(INLINE)).toEqual([
      'View full screen',
      'Download image',
      '|',
      'Thumbnail',
      'Full cell width',
      'Thumbnail size',
      '|',
      'Comment',
      '|',
      'Replace image',
      'Rename image',
      'Delete image',
    ]);
    const thumb = document.querySelector(`${INLINE} [aria-label="Thumbnail"]`)!;
    expect(thumb.getAttribute('aria-pressed')).toBe('true');
    expect(thumb.getAttribute('data-tip')).toMatch(/table's thumbnail size/);
    expect(thumb.hasAttribute('title')).toBe(false);
  });

  it('todo el ancho de la celda la pasa a w = 1 y Miniatura la vuelve a miniatura', async () => {
    const { editor } = await inCell();
    await choosePhoto(editor, 'C2');
    await click(INLINE, 'Full cell width');
    expect(widths(editor)).toEqual([0, 1]);
    await choosePhoto(editor, 'C2');
    await click(INLINE, 'Thumbnail');
    expect(widths(editor)).toEqual([0, 0]);
  });
});

/** Abre el menú de *Thumbnail size* (el de `scope`) y devuelve sus ítems, esperando a que aparezcan (Mantine, un cuadro después). */
async function thumbSizeMenu(scope: string): Promise<HTMLElement[]> {
  const trigger = document.querySelector<HTMLButtonElement>(`${scope} [data-test="cellThumbs-size"]`);
  if (!trigger) throw new Error('No Thumbnail size');
  await act(async () => {
    trigger.click();
    await new Promise((r) => setTimeout(r, 50));
  });
  let items: HTMLElement[] = [];
  for (let i = 0; items.length < 3 && i < 60; i++) {
    items = [64, 96, 160].map((h) => document.querySelector<HTMLElement>(`[data-test="cellThumbs-${h}"]`)).filter((x): x is HTMLElement => !!x);
    if (items.length < 3) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
    }
  }
  return items;
}
/** El ítem marcado (el de Mantine lleva el tilde; los demás, el espacio del tilde). */
const checkedOf = (items: HTMLElement[]) => items.filter((i) => !i.querySelector('.bn-tick-space')).map((i) => i.textContent);

describe('el alto de las miniaturas de la tabla (D27 → B)', () => {
  async function inTable(cells: unknown[][] = [[ph('C1', 0), ph('C2', 0.5)], [{ type: 'text', text: 'nota', styles: {} }]]) {
    const m = await mount();
    await act(async () => {
      m.editor.replaceBlocks(m.editor.document, [
        { id: 'tb', type: 'table', content: { type: 'tableContent', rows: [{ cells }] } },
        { id: 'tc', type: 'table', content: { type: 'tableContent', rows: [{ cells: [[{ type: 'text', text: 'sin fotos', styles: {} }]] }] } },
      ] as never);
    });
    return m;
  }
  const height = (e: BlockNoteEditor, id = 'tb') => (e.getBlock(id)!.props as Record<string, unknown>).thumbHeight;
  const widthsOf = (e: BlockNoteEditor) => {
    const out: number[] = [];
    view(e).state.doc.descendants((n) => {
      if (n.type.name === PHOTO) out.push(Number(n.attrs.w));
      return true;
    });
    return out;
  };
  async function chooseTable(e: BlockNoteEditor, id: string) {
    await act(async () => {
      e.focus();
      let at = -1;
      view(e).state.doc.descendants((n, pos) => {
        if (n.type.name === 'blockContainer' && n.attrs.id === id) at = pos;
        return at < 0;
      });
      view(e).dispatch(view(e).state.tr.setSelection(NodeSelection.create(view(e).state.doc, at)));
    });
  }

  it('en la barra de una foto de la celda: Small, Medium y Large, el actual marcado; Large cambia toda la tabla, no las fotos', async () => {
    const { editor } = await inTable();
    await choosePhoto(editor, 'C1');
    const trigger = document.querySelector(`${INLINE} [data-test="cellThumbs-size"]`)!;
    expect(trigger.getAttribute('aria-label')).toBe('Thumbnail size');
    // El tooltip dice lo que el nombre no dice: para toda la tabla, y las agrandadas no cambian.
    expect(trigger.getAttribute('data-tip')).toMatch(/every thumbnail in this table/);
    expect(trigger.hasAttribute('title')).toBe(false);
    let items = await thumbSizeMenu(INLINE);
    expect(items.map((i) => i.textContent)).toEqual(['Small', 'Medium', 'Large']);
    expect(checkedOf(items)).toEqual(['Medium']);
    await act(async () => {
      items[2].click();
    });
    expect(height(editor)).toBe(160);
    expect(height(editor, 'tc')).toBe(96);
    expect(widthsOf(editor)).toEqual([0, 0.5]);
    // La foto sigue elegida (con su barra).
    const sel = view(editor).state.selection;
    expect(sel instanceof NodeSelection && sel.node.type.name === PHOTO && sel.node.attrs.name === 'C1').toBe(true);
    await choosePhoto(editor, 'C1');
    items = await thumbSizeMenu(INLINE);
    expect(checkedOf(items)).toEqual(['Large']);
  });

  it('con la tabla elegida entera (sus puntos): Thumbnail size en la barra; en una tabla sin fotos, no', async () => {
    const { editor } = await inTable();
    await chooseTable(editor, 'tb');
    const toolbar = '.bn-formatting-toolbar';
    expect(document.querySelector(`${toolbar} [data-test="cellThumbs-size"]`)).not.toBeNull();
    const items = await thumbSizeMenu(toolbar);
    expect(checkedOf(items)).toEqual(['Medium']);
    await act(async () => {
      items[0].click();
    });
    expect(height(editor)).toBe(64);
    // Sigue elegida la tabla entera.
    const sel = view(editor).state.selection;
    expect(sel instanceof NodeSelection && sel.node.attrs.id === 'tb').toBe(true);
    await chooseTable(editor, 'tc');
    expect(document.querySelector(`${toolbar} [data-test="blockColors"]`)).not.toBeNull();
    expect(document.querySelector(`${toolbar} [data-test="cellThumbs-size"]`)).toBeNull();
  });

  it('en una página de solo lectura no aparece', async () => {
    const { editor } = await inTable();
    await act(async () => {
      editor.isEditable = false;
    });
    await chooseTable(editor, 'tb');
    expect(document.querySelector('[data-test="cellThumbs-size"]')).toBeNull();
  });
});

describe('una selección con fotos de una celda y de un renglón (auditoría de la entrega 5, O7)', () => {
  it('la barra de siempre (tamaños de la página), sin lo de la celda; sin alinear (hay una en una celda)', async () => {
    const { editor } = await mount();
    await act(async () => {
      editor.replaceBlocks(editor.document, [
        { id: 'p', type: 'paragraph', content: [ph('P1')] },
        { id: 'tb', type: 'table', content: { type: 'tableContent', rows: [{ cells: [[ph('C1', 0)], [{ type: 'text', text: 'nota', styles: {} }]] }] } },
      ] as never);
    });
    await act(async () => {
      editor.focus();
      const from = photoPos(editor, 'P1');
      const to = photoPos(editor, 'C1') + 1;
      view(editor).dispatch(view(editor).state.tr.setSelection(TextSelection.create(view(editor).state.doc, from, to)));
    });
    await act(async () => {
      document.dispatchEvent(new FocusEvent('focusin'));
    });
    const labels = bar(INLINE);
    expect(labels).toContain('Half the page width');
    expect(labels).not.toContain('Thumbnail');
    expect(labels).not.toContain('Full cell width');
    expect(labels).not.toContain('Align left');
  });
});

describe('lo que hace cada botón de la foto en línea', () => {
  it('borrar: la elegida (un solo cambio)', async () => {
    const { editor } = await mount();
    await choosePhoto(editor, 'F2');
    await click(INLINE, 'Delete image');
    expect(names(editor)).toEqual(['F1', 'F3']);
  });

  it('alinear: el renglón (el bloque), y marca la alineación que tiene', async () => {
    const { editor } = await mount();
    await choosePhoto(editor, 'F1');
    await click(INLINE, 'Align center');
    expect((editor.getBlock('p')!.props as { textAlignment: string }).textAlignment).toBe('center');
    const center = [...document.querySelectorAll(`${INLINE} button`)].find((b) => b.getAttribute('aria-label') === 'Align center')!;
    expect(center.getAttribute('aria-pressed')).toBe('true');
  });

  it('renombrar (una foto que no es del Drive): cambia el nombre de la elegida', async () => {
    const { editor } = await mount();
    await choosePhoto(editor, 'F3');
    await click(INLINE, 'Rename image');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const input = document.querySelector<HTMLInputElement>('input[name="file-name"]')!;
    expect(input.value).toBe('F3');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'Plano general');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(names(editor)).toEqual(['F1', 'F2', 'Plano general']);
  });

  it('reemplazar: el selector de archivos; lo elegido se guarda y la foto pasa a ser ese archivo, en su lugar', async () => {
    const stored: string[] = [];
    const { editor } = await mount(stored);
    await choosePhoto(editor, 'F2');
    let input: HTMLInputElement | null = null;
    const click0 = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
      if (this.type === 'file') input = this;
    };
    try {
      await click(INLINE, 'Replace image');
    } finally {
      HTMLInputElement.prototype.click = click0;
    }
    expect(input!.accept).toBe('image/*,video/*');
    Object.defineProperty(input!, 'files', { value: [new File([new Uint8Array([1])], 'nueva.jpg', { type: 'image/jpeg' })] });
    await act(async () => {
      input!.dispatchEvent(new Event('change'));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(stored).toEqual(['nueva.jpg']);
    expect(names(editor)).toEqual(['F1', 'nueva.jpg', 'F3']);
    const node = view(editor).state.doc.nodeAt(photoPos(editor, 'nueva.jpg'))!;
    expect(node.attrs.url).toBe('https://example.invalid/new/nueva.jpg');
    expect(node.attrs.w).toBe(0.5);
  });

  it('con varias elegidas: tamaños, alinear y borrar valen para todas; ver, bajar, reemplazar y renombrar no van', async () => {
    const { editor } = await mount();
    await act(async () => {
      editor.focus();
      const v = view(editor);
      const { TextSelection } = await import('@tiptap/pm/state');
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, photoPos(editor, 'F1'), photoPos(editor, 'F2') + 1)));
    });
    await act(async () => {
      document.dispatchEvent(new FocusEvent('focusin'));
    });
    const labels = bar(INLINE);
    expect(labels).not.toContain('View full screen');
    expect(labels).not.toContain('Replace image');
    expect(labels).not.toContain('Rename image');
    expect(labels).toContain('Delete images');
    await click(INLINE, 'Delete images');
    expect(names(editor)).toEqual(['F3']);
  });
});

describe('lo que hace cada botón de la foto-bloque', () => {
  it('alinear y borrar', async () => {
    const { editor } = await mount();
    await chooseBlock(editor);
    await click(BLOCK, 'Align right');
    expect((editor.getBlock('img')!.props as { textAlignment: string }).textAlignment).toBe('right');
    await chooseBlock(editor);
    await click(BLOCK, 'Delete image');
    expect(editor.getBlock('img')).toBeUndefined();
  });
});

describe('Suggest caption (el asistente, entrega A3)', () => {
  it('con el editor de la página abierta: en la barra de la foto en línea y de la foto-bloque; abre el panel con esa foto', async () => {
    const { editor } = await mount();
    const off = registerAssistantTarget({ pageId: 'pg', view: () => view(editor), editable: () => true });
    try {
      await choosePhoto(editor, 'F2');
      expect(bar(INLINE).slice(0, 4)).toEqual(['View full screen', 'Download image', 'Suggest caption', '|']);
      const tip = document.querySelector(`${INLINE} button[aria-label="Suggest caption"]`)?.getAttribute('data-tip') ?? '';
      expect(tip).toContain('looks at the photo');
      await click(INLINE, 'Suggest caption');
      expect(assistantUiState().pageId).toBe('pg');
      expect(assistantUiState().caption?.ref).toEqual({ kind: 'inline', blockId: 'p', index: 1, url: url('F2'), name: 'F2' });
      await chooseBlock(editor);
      expect(bar(BLOCK).slice(0, 4)).toEqual(['View full screen', 'Download image', 'Suggest caption', '|']);
      await click(BLOCK, 'Suggest caption');
      expect(assistantUiState().caption?.ref).toEqual({ kind: 'block', blockId: 'img', index: 0, url: url('B1'), name: 'B1' });
    } finally {
      off();
      closeAssistant();
    }
  });

  it('en un video (en línea o bloque) no aparece: el modelo mira fotos', async () => {
    const { editor } = await mount();
    const off = registerAssistantTarget({ pageId: 'pg', view: () => view(editor), editable: () => true });
    try {
      await act(async () => {
        const v = view(editor);
        const at = photoPos(editor, 'F3') + 1;
        v.dispatch(v.state.tr.insert(at, v.state.schema.nodes.photo.create({ url: 'https://example.invalid/clip.mp4', name: 'clip.mp4', w: 0.5 })));
        editor.updateBlock('img', { props: { url: 'https://example.invalid/toma.mov', name: 'toma.mov' } } as never);
      });
      await choosePhoto(editor, 'clip.mp4');
      expect(bar(INLINE)).toContain('View full screen');
      expect(bar(INLINE)).not.toContain('Suggest caption');
      await chooseBlock(editor);
      expect(bar(BLOCK)).toContain('View full screen');
      expect(bar(BLOCK)).not.toContain('Suggest caption');
      // Una foto, en la misma página, sí.
      await choosePhoto(editor, 'F2');
      expect(bar(INLINE)).toContain('Suggest caption');
    } finally {
      off();
      closeAssistant();
    }
  });

  it('sin el editor de la página anotado (el historial, la práctica): no aparece', async () => {
    const { editor } = await mount();
    await choosePhoto(editor, 'F2');
    expect(bar(INLINE)).not.toContain('Suggest caption');
  });
});
