// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { addMediaLinks, setMediaLinkSource, type MediaLinkSource } from './mediaLinks';
import { buildPrintView } from './printView';

// Los links a los archivos en la copia de impresión (P.30, Docs/Doc_Links_PDF.md, 3.1 y 3.2).

const ID = {
  pdf: '00000000-0000-4000-8000-000000000001',
  video: '00000000-0000-4000-8000-000000000002',
  folder: '00000000-0000-4000-8000-000000000003',
  photo: '00000000-0000-4000-8000-000000000004',
  foreign: '00000000-0000-4000-8000-000000000005',
  unknownPdf: '00000000-0000-4000-8000-000000000006',
  unknown: '00000000-0000-4000-8000-000000000007',
  deleted: '00000000-0000-4000-8000-000000000008',
};

const INFO: Record<string, { mime: string; name: string }> = {
  [ID.pdf]: { mime: 'application/pdf', name: 'plano_set.pdf' },
  [ID.video]: { mime: 'video/quicktime', name: 'clip_001.mov' },
  [ID.folder]: { mime: 'inode/directory', name: 'Dia_2' },
  [ID.photo]: { mime: 'image/jpeg', name: 'IMG_0412.jpg' },
  [ID.foreign]: { mime: 'application/pdf', name: 'ajeno.pdf' },
  [ID.deleted]: { mime: 'application/zip', name: 'borrado.zip' },
};

function source(over: Partial<MediaLinkSource> = {}): MediaLinkSource {
  return {
    info: (id) => INFO[id] ?? null,
    linkable: (id, page) => !(id === ID.foreign && page === 'P1') && id !== ID.deleted,
    href: (id) => `https://app.test/f/wanka_1/${id}#ws=abc`,
    ...over,
  };
}

function block(id: string, name: string): string {
  return `<div class="bn-block-outer"><div class="bn-block-content" data-content-type="image" data-url="sdmedia://${id}" data-name="${name}">
    <div class="bn-file-block-content-wrapper"><div class="bn-visual-media-wrapper"><img class="bn-visual-media" src="data:image/svg+xml,x"></div></div></div></div>`;
}

function editor(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'bn-editor';
  root.innerHTML = [
    block(ID.pdf, 'plano_set.pdf'),
    block(ID.video, 'clip_001.mov'),
    block(ID.folder, 'Dia_2'),
    block(ID.photo, 'IMG_0412.jpg'),
    block(ID.foreign, 'ajeno.pdf'),
    block(ID.unknownPdf, 'nuevo.pdf'),
    block(ID.unknown, 'sin_extension'),
    block(ID.deleted, 'borrado.zip'),
    // Una foto en línea con un video, y una tarjeta de Drive pegada: sin cambios.
    `<p><span class="sd-photo" data-url="sdmedia://${ID.video}"><img class="bn-visual-media"></span></p>`,
    `<div class="drive-card"><a class="drive-card-open" href="https://drive.google.com/x">Drive</a></div>`,
  ].join('');
  return root;
}

const linkedIds = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLAnchorElement>('a.sd-media-link')].map((a) => a.closest('[data-url]')!.getAttribute('data-url')!.slice(10));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('addMediaLinks', () => {
  it('adjunto, video y carpeta con link y nombre debajo; foto, otro proyecto, borrado y en línea, no', () => {
    const root = editor();
    addMediaLinks(root, { source: source(), pageId: 'P1', href: (id) => source().href(id) });
    expect(linkedIds(root)).toEqual([ID.pdf, ID.video, ID.folder, ID.unknownPdf]);
    const names = [...root.querySelectorAll<HTMLAnchorElement>('a.sd-media-name')];
    expect(names.map((a) => a.textContent)).toEqual(['plano_set.pdf', 'clip_001.mov', 'Dia_2', 'nuevo.pdf']);
    // La tarjeta entera adentro del link, el nombre con el mismo link y debajo de la tarjeta.
    const first = root.querySelector('a.sd-media-link')!;
    expect(first.querySelector('img.bn-visual-media')).not.toBeNull();
    expect(names[0].href).toBe((first as HTMLAnchorElement).href);
    expect(names[0].href).toContain(`/f/wanka_1/${ID.pdf}#ws=abc`);
    expect(names[0].previousElementSibling?.classList.contains('bn-visual-media-wrapper')).toBe(true);
    // La foto en línea y la tarjeta de Drive quedan como estaban.
    expect(root.querySelector('.sd-photo a')).toBeNull();
    expect(root.querySelector('.drive-card a')!.getAttribute('href')).toBe('https://drive.google.com/x');
  });

  it('el marcador de otro proyecto depende de la página', () => {
    const root = editor();
    addMediaLinks(root, { source: source(), pageId: 'P2', href: (id) => source().href(id) });
    expect(linkedIds(root)).toContain(ID.foreign);
  });

  it('la vista de medir: el mismo renglón del nombre, sin link', () => {
    const measure = editor();
    const output = editor();
    addMediaLinks(measure, { source: source(), pageId: 'P1', href: null });
    addMediaLinks(output, { source: source(), pageId: 'P1', href: (id) => source().href(id) });
    expect(measure.querySelectorAll('a')).toHaveLength(1); // solo la de Drive
    expect(measure.querySelectorAll('span.sd-media-name')).toHaveLength(output.querySelectorAll('a.sd-media-name').length);
  });

  it('nunca un link que no sea http(s); sin fuente, nada', () => {
    const root = editor();
    addMediaLinks(root, { source: source(), pageId: 'P1', href: () => 'javascript:alert(1)' });
    expect(root.querySelectorAll('a.sd-media-link, a.sd-media-name')).toHaveLength(0);
    expect(root.querySelectorAll('span.sd-media-name')).toHaveLength(4);
    const none = editor();
    addMediaLinks(none, { source: null, pageId: 'P1', href: () => 'https://x.test/' });
    expect(none.querySelectorAll('.sd-media-name')).toHaveLength(0);
  });
});

describe('buildPrintView con los links', () => {
  function article(pageId: string): HTMLElement {
    const el = document.createElement('article');
    el.className = 'page';
    el.dataset.pageId = pageId;
    el.innerHTML = `<textarea class="page-title">Reporte</textarea><div class="editor-host"><div class="bn-container"></div></div>`;
    el.querySelector('.bn-container')!.append(editor());
    document.body.append(el);
    return el;
  }

  it('imprimir usa la dirección del workspace; medir, solo el renglón; exportar, la que le pasan', () => {
    const unset = setMediaLinkSource(source());
    try {
      const page = article('P1');
      const output = buildPrintView(page, { size: 'A4', landscape: false }, 'output');
      expect(output.root.querySelectorAll('a.sd-media-link')).toHaveLength(4);
      expect(output.root.querySelector<HTMLAnchorElement>('a.sd-media-link')!.href).toContain('#ws=abc');
      const measure = buildPrintView(page, { size: 'A4', landscape: false }, 'measure');
      expect(measure.root.querySelectorAll('a.sd-media-link')).toHaveLength(0);
      expect(measure.root.querySelectorAll('span.sd-media-name')).toHaveLength(4);
      const exported = buildPrintView(page, { size: 'A4', landscape: false }, 'output', {
        pageId: 'P2',
        mediaHref: (id) => `https://app.test/f/wanka_1/${id}#link=tok`,
      });
      // Otra página (P2): el archivo de otro proyecto en P1 sí lleva link acá.
      expect(exported.root.querySelectorAll('a.sd-media-link')).toHaveLength(5);
      expect(exported.root.querySelector<HTMLAnchorElement>('a.sd-media-link')!.href).toContain('#link=tok');
      // El editor de la página no cambia.
      expect(page.querySelectorAll('.sd-media-name, a.sd-media-link')).toHaveLength(0);
    } finally {
      unset();
    }
  });

  it('sin workspace abierto (las pruebas de siempre), sin links', () => {
    const page = article('P1');
    const output = buildPrintView(page, { size: 'A4', landscape: false }, 'output');
    expect(output.root.querySelectorAll('.sd-media-name')).toHaveLength(0);
  });
});
