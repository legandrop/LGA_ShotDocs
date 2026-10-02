// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { t } from '../i18n';
import type { RemovedWriting } from '../sync/removedWriting';
import { RemovedWritingBanner, type RemovedWritingSource } from './RemovedWritingBanner';

// El aviso de B.16 en la página: aparece cuando hay algo guardado para esa página (y cuando llega con la página
// abierta), muestra el texto, lo copia, y al cerrarlo se borra lo guardado.

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

class MemorySource implements RemovedWritingSource {
  readonly notes = new Map<string, RemovedWriting[]>();
  private readonly listeners = new Set<(pageId: string) => void>();
  async removedWriting(pageId: string): Promise<RemovedWriting[]> {
    return this.notes.get(pageId) ?? [];
  }
  async dismissRemovedWriting(pageId: string): Promise<void> {
    this.notes.delete(pageId);
  }
  subscribeRemovedWriting(fn: (pageId: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  add(pageId: string, text: string): void {
    this.notes.set(pageId, [...(this.notes.get(pageId) ?? []), { at: Date.now(), text }]);
    for (const fn of this.listeners) fn(pageId);
  }
}

async function render(source: MemorySource, pageId: string): Promise<HTMLElement> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => root!.render(<RemovedWritingBanner docs={source} pageId={pageId} />));
  return el;
}

const button = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;

describe('el aviso de lo que escribiste en algo que otro borró', () => {
  it('sin nada guardado no se ve; llega con la página abierta y muestra el texto', async () => {
    const source = new MemorySource();
    source.notes.set('otra', [{ at: 1, text: 'de otra página' }]);
    const el = await render(source, 'p');
    expect(el.textContent).toBe('');
    await act(async () => source.add('p', 'lo que escribí'));
    expect(el.querySelector('.removed-writing')?.textContent).toContain(t('removedWriting.text'));
    expect(el.querySelector('pre')).toBeNull();
    await act(async () => button(el, t('removedWriting.show')).click());
    expect(el.querySelector('pre')?.textContent).toBe('lo que escribí');
    expect(el.textContent).not.toContain('de otra página');
  });

  it('Copy copia todo el texto; Dismiss lo borra del dispositivo', async () => {
    const source = new MemorySource();
    source.add('p', 'uno');
    source.add('p', 'dos');
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => void (copied = text) },
    });
    const el = await render(source, 'p');
    await act(async () => button(el, t('removedWriting.copy')).click());
    expect(copied).toBe('uno\n\ndos');
    await act(async () => button(el, t('removedWriting.dismiss')).click());
    expect(el.textContent).toBe('');
    expect(await source.removedWriting('p')).toEqual([]);
  });

  it('sin portapapeles, el texto queda a la vista para copiarlo a mano', async () => {
    const source = new MemorySource();
    source.add('p', 'a mano');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const el = await render(source, 'p');
    await act(async () => button(el, t('removedWriting.copy')).click());
    expect(el.querySelector('pre')?.textContent).toBe('a mano');
  });
});
