// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorLinkClick, followInternalLink, internalPageId } from './internalLinks';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

function click(href: string, init: MouseEventInit = {}) {
  const host = document.createElement('div');
  host.innerHTML = `<p><a href="${href}"><span>Plano 12</span></a></p>`;
  document.body.append(host);
  const target = host.querySelector('span')!;
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

afterEach(() => {
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('links a páginas de la app', () => {
  it('reconoce /p/<id> y la dirección entera de la app; no otros sitios ni otras direcciones', () => {
    const origin = 'https://shotdocs.lega.com.ar';
    expect(internalPageId(`/p/${ID}`, origin)).toBe(ID);
    expect(internalPageId(`${origin}/p/${ID}`, origin)).toBe(ID);
    expect(internalPageId(`${origin}/p/${ID}?x=1#y`, origin)).toBe(ID);
    expect(internalPageId(`https://otro.com/p/${ID}`, origin)).toBeNull();
    expect(internalPageId('/p/no-es-un-id', origin)).toBeNull();
    expect(internalPageId('/trash', origin)).toBeNull();
    expect(internalPageId('https://x.com', origin)).toBeNull();
    expect(internalPageId('', origin)).toBeNull();
    expect(internalPageId(null, origin)).toBeNull();
    // Un link pegado a mano en mayúsculas va a la página (el árbol guarda los ids en minúsculas).
    expect(internalPageId(`/p/${ID.toUpperCase()}`, origin)).toBe(ID);
    // Nada de otro origen disfrazado.
    expect(internalPageId(`//evil.com/p/${ID}`, origin)).toBeNull();
    expect(internalPageId(`javascript:alert(1)//p/${ID}`, origin)).toBeNull();
  });

  it('un clic simple abre la página en esta pestaña (sin recargar)', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const event = click(`/p/${ID}`);
    expect(editorLinkClick(event)).toBe(true);
    expect(location.pathname).toBe(`/p/${ID}`);
    expect(event.defaultPrevented).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it('⌘/Ctrl+clic en una página de la app: otra pestaña, como un link', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    for (const init of [{ metaKey: true }, { ctrlKey: true }]) {
      expect(editorLinkClick(click(`/p/${ID}`, init))).toBe(true);
    }
    expect(location.pathname).toBe('/');
    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls[0][0]).toBe(`${location.origin}/p/${ID}`);
  });

  it('un link a otro sitio sigue abriéndose en otra pestaña', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(editorLinkClick(click('https://x.com/'))).toBe(true);
    expect(open).toHaveBeenCalledWith('https://x.com/', '_blank', 'noopener,noreferrer');
    expect(location.pathname).toBe('/');
  });

  it('solo lectura: el clic en captura toma solo los links a páginas de la app', () => {
    expect(followInternalLink(click('https://x.com/'))).toBe(false);
    expect(followInternalLink(click(`/p/${ID}`, { button: 1 }))).toBe(false);
    const event = click(`/p/${ID}`);
    expect(followInternalLink(event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(location.pathname).toBe(`/p/${ID}`);
  });
});
