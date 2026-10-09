// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { schema } from '../ui/editorSchema';
import { hoverGateExtension, MOUSE_ATTR } from './hoverGate';
import { todayText } from './TodayBar';

// Dos detalles de lo que se ve al escribir (auditoría de E6): la barra *Today* no deja un espacio antes de la
// puntuación (O11, D572) y el fondo del subrayado bajo el mouse sale solo con el mouse movido de verdad (O9, D571).

const mounted: { e: BlockNoteEditor; el: HTMLElement }[] = [];
afterEach(() => {
  for (const { e, el } of mounted.splice(0)) {
    e.unmount();
    el.remove();
  }
});

function editor(text: string): BlockNoteEditor {
  const e = BlockNoteEditor.create({ schema, extensions: [hoverGateExtension()] } as never) as unknown as BlockNoteEditor;
  // Como BlockNoteView: el editor adentro de un contenedor `.editor`.
  const el = document.createElement('div');
  el.className = 'editor';
  document.body.appendChild(el);
  e.mount(el);
  mounted.push({ e, el });
  e.replaceBlocks(e.document, [{ type: 'paragraph', content: text }] as never);
  return e;
}

/** El cursor justo antes de `mark` (o al final, sin `mark`). */
function cursorAt(e: BlockNoteEditor, text: string, mark?: string): void {
  const view = e.prosemirrorView!;
  let start = 0;
  view.state.doc.descendants((n, pos) => {
    if (n.isText && n.text === text) start = pos;
    return true;
  });
  const at = start + (mark ? text.indexOf(mark) : text.length);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
}

describe('la barra Today: qué escribe una pastilla (O11)', () => {
  it('antes de un punto, una coma o un cierre, sin espacio después', () => {
    for (const [text, mark] of [
      ['Plano doble .', '.'],
      ['Plano doble , y otro', ','],
      ['(Plano doble )', ')'],
      ['«Plano doble »', '»'],
    ] as const) {
      const e = editor(text);
      cursorAt(e, text, mark);
      expect(todayText(e.prosemirrorView!.state, '101_001'), text).toBe('101_001');
    }
  });

  it('pegado a una palabra: un espacio antes; antes de una palabra o al final del renglón: uno después', () => {
    const e = editor('Plano doble');
    cursorAt(e, 'Plano doble');
    expect(todayText(e.prosemirrorView!.state, '101_001')).toBe(' 101_001 ');
    const e2 = editor('Plano doble otra');
    cursorAt(e2, 'Plano doble otra', 'otra');
    expect(todayText(e2.prosemirrorView!.state, '101_001')).toBe('101_001 ');
    const e3 = editor('Plano doble.');
    cursorAt(e3, 'Plano doble.', '.');
    expect(todayText(e3.prosemirrorView!.state, '101_001')).toBe(' 101_001');
  });
});

describe('el fondo del subrayado solo con el mouse movido (O9)', () => {
  const move = (x: number, y: number) => window.dispatchEvent(Object.assign(new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true }), { pointerType: 'mouse' }));
  const keydown = (e: BlockNoteEditor, key: string) => e.prosemirrorView!.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

  it('una tecla lo desarma; el mouse quieto no lo arma; moverlo a otro lugar, sí', () => {
    const e = editor('Revisar 105_027');
    const host = e.prosemirrorView!.dom.closest('.editor')!;
    move(10, 10);
    expect(host.hasAttribute(MOUSE_ATTR)).toBe(true);
    keydown(e, 'a');
    expect(host.hasAttribute(MOUSE_ATTR)).toBe(false);
    // El subrayado nuevo aparece debajo del puntero quieto: el navegador puede mandar un movimiento en el mismo lugar.
    move(10, 10);
    expect(host.hasAttribute(MOUSE_ATTR)).toBe(false);
    // Un modificador solo no desarma (el principio de un atajo).
    move(30, 12);
    expect(host.hasAttribute(MOUSE_ATTR)).toBe(true);
    keydown(e, 'Shift');
    expect(host.hasAttribute(MOUSE_ATTR)).toBe(true);
  });

  it('el CSS pide el atributo para el fondo de :hover', () => {
    const css = readFileSync(resolve(__dirname, 'liveHeader.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const hovers = css.match(/[^{}]*\.rel-u[^{}]*:hover[^{}]*\{/g) ?? [];
    expect(hovers.length).toBeGreaterThan(0);
    for (const h of hovers) expect(h).toContain(`[${MOUSE_ATTR}]`);
  });
});
