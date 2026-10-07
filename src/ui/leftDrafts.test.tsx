// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acceptDraftLoss, closeDraft, confirmDraftLoss, dropLeftDrafts, leftDraftsNow, setDraft, signOutAccepted, withdrawDraftLoss } from './commentsUi';
import { AppBarrier } from './ErrorBarrier';
import { noticeVisible, useNotice } from './notice';

// El cartel de lo que quedó de un comentario a medio escribir (LeftDrafts.tsx) cuando falla él mismo, y la cuenta de
// pantallas que dibujan el aviso (notice.ts), de la que depende que el texto vaya al cartel.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// El cartel tira al dibujarse.
vi.mock('./LeftDrafts', () => ({
  LeftDrafts: () => {
    throw new Error('el cartel tiró');
  },
}));

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  act(() => dropLeftDrafts());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function render(node: React.ReactNode): Root {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return root;
}

/** Un cuadro con ese texto que se cierra solo, sin ninguna pantalla que dibuje el aviso: va al cartel. */
async function leave(text: string): Promise<void> {
  const key = Symbol('cuadro');
  setDraft(key, true, { text });
  await act(async () => closeDraft(key, false));
}

describe('si el cartel mismo falla', () => {
  it('queda un respaldo con el texto a la vista, y cerrar la ventana sigue preguntando', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<AppBarrier><main>login</main></AppBarrier>);
    await leave('Lo que estaba escribiendo');
    expect(leftDraftsNow().texts).toEqual(['Lo que estaba escribiendo']);
    const card = document.querySelector('.left-drafts');
    expect(card?.textContent).toContain('A comment you were writing was not sent.');
    expect(card?.textContent).toContain('Lo que estaba escribiendo');
    // La app de abajo sigue.
    expect(document.body.textContent).toContain('login');
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
});

describe('el alto del cartel', () => {
  it('nunca más de casi media pantalla: los textos se recorren adentro y el título y los botones quedan a la vista', () => {
    // jsdom no calcula el diseño (medido en un navegador: Doc_Sincronizacion.md); acá se fija lo que lo produce.
    const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8').replace(/\r\n/g, '\n');
    const body = (selector: string) => css.slice(css.indexOf(`\n${selector} {\n`)).split('}')[0];
    expect(body('.left-drafts')).toContain('max-height: 45dvh;');
    expect(body('.left-drafts')).toContain('grid-template-rows: auto minmax(0, 1fr) auto;');
    expect(body('.left-drafts-texts')).toContain('overflow: auto;');
    expect(body('.left-drafts .left-draft')).not.toContain('max-height');
  });
});

describe('la cuenta de pantallas que dibujan el aviso', () => {
  it('se borra en el mismo paso en que se desmonta la pantalla, antes de lo que se desmonta después de ella', () => {
    const seen: boolean[] = [];
    function Host() {
      useNotice();
      return null;
    }
    // Desmontado en el mismo paso, después de la pantalla (como un cuadro de comentario al reemplazarse la app).
    function Probe() {
      useLayoutEffect(() => () => void seen.push(noticeVisible()), []);
      return null;
    }
    const root = render(
      <>
        <Host />
        <Probe />
      </>,
    );
    expect(noticeVisible()).toBe(true);
    act(() => root.render(<main />));
    expect(seen).toEqual([false]);
    expect(noticeVisible()).toBe(false);
  });
});

describe('el cartel y el «sí» de la app a perder lo que se está escribiendo', () => {
  const asks = () => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  };

  it('un «sí» que contó solo los cuadros abiertos (Reload, forzar la actualización) no se lleva el cartel sin preguntar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<AppBarrier><main>app</main></AppBarrier>);
    await leave('Lo del cartel');
    // Un cuadro nuevo con algo escrito, y la pregunta de recargar (que cuenta los cuadros): «sí».
    const open = Symbol('abierto');
    setDraft(open, true, { text: 'Otro a medias' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    expect(confirmDraftLoss('¿Recargar?')).toBe(true);
    // El navegador sigue preguntando por el cartel, que esa pregunta no nombró.
    expect(asks()).toBe(true);
    act(() => closeDraft(open, true));
    withdrawDraftLoss();
  });

  it('un «sí» que contó el cartel no se repite en el navegador, salvo que el cartel cambie después', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<AppBarrier><main>app</main></AppBarrier>);
    await leave('Primero');
    expect(asks()).toBe(true);
    acceptDraftLoss(true);
    expect(asks()).toBe(false);
    // Llega otro texto al cartel: ese «sí» no lo cubría.
    await leave('Segundo');
    expect(leftDraftsNow().texts).toEqual(['Primero', 'Segundo']);
    expect(asks()).toBe(true);
    withdrawDraftLoss();
  });

  it('salir de la cuenta descarta el cartel recién cuando la salida ocurrió: si falla, el texto sigue', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<AppBarrier><main>app</main></AppBarrier>);
    await leave('No se pierde');
    await act(async () => { await signOutAccepted(async () => ({ error: new Error('sin red') })); });
    expect(leftDraftsNow().texts).toEqual(['No se pierde']);
    expect(asks()).toBe(true);
    await act(async () => { await expect(signOutAccepted(async () => { throw new Error('tiró'); })).rejects.toThrow('tiró'); });
    expect(leftDraftsNow().texts).toEqual(['No se pierde']);
    expect(asks()).toBe(true);
    await act(async () => { await signOutAccepted(async () => ({ error: null })); });
    expect(leftDraftsNow().texts).toEqual([]);
    withdrawDraftLoss();
  });
});
