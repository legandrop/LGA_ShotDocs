// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { mountEditor, unmountAll } from './collabHarness';
import { isAppMediaUrl, quietExternalHtml, setQuietSrc } from './quietImage';

// B.24: copiar o arrastrar una foto del Drive armaba un `<img src="sdmedia://…">` que el navegador intentaba pedir
// (`net::ERR_UNKNOWN_URL_SCHEME` en la consola). Acá se mira cada vez que un `<img>` recibe un `sdmedia://`: tiene que
// llevar antes `loading="lazy"` (una imagen que no está en la página con esa marca no se pide).

afterEach(unmountAll);

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const URL_ = `sdmedia://${ID}`;

interface Set {
  value: string;
  lazy: boolean;
}

/** Anota cada `src` que recibe un `<img>` (por la propiedad o por `setAttribute`) y si ya tenía `loading="lazy"`. */
function watchSrc(): { sets: Set[]; stop: () => void } {
  const sets: Set[] = [];
  const proto = HTMLImageElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'src')!;
  const lazyOf = (img: Element) => img.getAttribute('loading') === 'lazy';
  Object.defineProperty(proto, 'src', {
    ...desc,
    set(this: HTMLImageElement, v: string) {
      sets.push({ value: String(v), lazy: lazyOf(this) });
      desc.set!.call(this, v);
    },
  });
  const setAttribute = Element.prototype.setAttribute;
  const spy = vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function (this: Element, name: string, value: string) {
    if (this instanceof HTMLImageElement && name === 'src') sets.push({ value: String(value), lazy: lazyOf(this) });
    return setAttribute.call(this, name, value);
  });
  return {
    sets,
    stop: () => {
      Object.defineProperty(proto, 'src', desc);
      spy.mockRestore();
    },
  };
}

const content = () =>
  [
    { type: 'paragraph', content: 'plano' },
    { type: 'image', props: { url: URL_, name: 'Bloque.jpg', previewWidth: 420 } },
    { type: 'paragraph', content: [{ type: 'text', text: 'en linea ', styles: {} }, { type: 'photo', props: { url: URL_, name: 'Linea.jpg', w: 0.3 } }] },
    { type: 'image', props: { url: URL_, name: 'Con pie.jpg', caption: 'un pie' } },
  ] as never[];

describe('B.24: lo que arma el editor para copiar no pide sdmedia://', () => {
  it('el HTML externo (portapapeles y arrastre) deja la dirección escrita pero no la pide', () => {
    const E = mountEditor(new Y.Doc());
    E.replaceBlocks(E.document, content());
    const w = watchSrc();
    let html = '';
    try {
      html = E.blocksToHTMLLossy(E.document);
    } finally {
      w.stop();
    }
    const media = w.sets.filter((s) => s.value.startsWith('sdmedia://'));
    // Bloque, bloque con pie y foto en línea: cada uno puso la dirección...
    expect(media.length).toBeGreaterThanOrEqual(3);
    // ...y ninguno la puso sin la marca antes.
    expect(media.filter((s) => !s.lazy)).toEqual([]);
    // La dirección sigue en el HTML (es lo que lee el pegado) y no quedó la imagen mínima del armado.
    expect(html.split(`src="${URL_}"`).length - 1).toBe(3);
    expect(html).toContain(`data-url="${URL_}"`);
    expect(html).not.toContain('data:image/gif');
  });

  it('pegar ese HTML trae las mismas fotos (bloque y en línea)', () => {
    const E = mountEditor(new Y.Doc());
    E.replaceBlocks(E.document, content());
    const html = E.blocksToHTMLLossy(E.document);
    const blocks = E.tryParseHTMLToBlocks(html) as unknown as { type: string; props?: { url?: string }; content?: { type: string; props?: { url?: string } }[] }[];
    const images = blocks.filter((b) => b.type === 'image');
    expect(images.map((b) => b.props?.url)).toEqual([URL_, URL_]);
    const inline = blocks.flatMap((b) => (Array.isArray(b.content) ? b.content : [])).filter((c) => c.type === 'photo');
    expect(inline.map((c) => c.props?.url)).toEqual([URL_]);
  });

  it('una imagen que no es de la app sale como siempre', () => {
    const E = mountEditor(new Y.Doc());
    E.replaceBlocks(E.document, [{ type: 'image', props: { url: 'https://example.test/a.png', name: 'a.png' } }] as never[]);
    const html = E.blocksToHTMLLossy(E.document);
    expect(html).toContain('src="https://example.test/a.png"');
    expect(html).not.toContain('loading="lazy"');
  });

  it('un editor sin resolveFileUrl no le pone la dirección de la app a la foto en línea que dibuja', () => {
    const w = watchSrc();
    try {
      const E = mountEditor(new Y.Doc());
      E.replaceBlocks(E.document, [{ type: 'paragraph', content: [{ type: 'photo', props: { url: URL_, name: 'L.jpg', w: 0 } }] }] as never[]);
    } finally {
      w.stop();
    }
    expect(w.sets.filter((s) => s.value.startsWith('sdmedia://') && !s.lazy)).toEqual([]);
  });
});

describe('quietImage', () => {
  it('isAppMediaUrl: solo el esquema de la app', () => {
    expect(isAppMediaUrl(URL_)).toBe(true);
    expect(isAppMediaUrl('https://a.test/x.png')).toBe(false);
    expect(isAppMediaUrl('sdfile://x')).toBe(false);
    expect(isAppMediaUrl(undefined)).toBe(false);
  });

  it('setQuietSrc marca antes de poner la dirección; otra dirección, sin marca', () => {
    const a = document.createElement('img');
    const w = watchSrc();
    try {
      setQuietSrc(a, URL_);
      const b = document.createElement('img');
      setQuietSrc(b, 'https://a.test/x.png');
      expect(b.hasAttribute('loading')).toBe(false);
    } finally {
      w.stop();
    }
    expect(w.sets[0]).toEqual({ value: URL_, lazy: true });
  });

  it('quietExternalHtml llama al original con el mismo this y deja intacto lo que no es de la app', () => {
    const calls: unknown[] = [];
    const wrapped = quietExternalHtml(function (this: unknown, block: { props: { url?: unknown } }) {
      calls.push(this);
      const dom = document.createElement('div');
      dom.setAttribute('data-url', String(block.props.url));
      return { dom };
    });
    const me = { me: true };
    const out = wrapped.call(me, { props: { url: 'https://a.test/x.png' } });
    expect(calls[0]).toBe(me);
    expect((out.dom as HTMLElement).getAttribute('data-url')).toBe('https://a.test/x.png');
    const app = wrapped.call(me, { props: { url: URL_ } });
    expect(calls[1]).toBe(me);
    expect((app.dom as HTMLElement).getAttribute('data-url')).toBe(URL_);
  });
});
