// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { addMediaLinks, appLinkSource, setMediaLinkSource, type MediaLinkSource } from './mediaLinks';
import { parseWorkspaceHash } from '../fileLink';
import { parseLinkHash } from '../linkMode';
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
    // Un video en línea y una tarjeta de Drive pegada.
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
  it('adjunto, video y carpeta con nombre; video en línea solo con cuadro enlazado', () => {
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
    expect(root.querySelector<HTMLAnchorElement>('a.sd-photo')?.href).toContain(`/f/wanka_1/${ID.video}#ws=abc`);
    expect(root.querySelector('.drive-card a')!.getAttribute('href')).toBe('https://drive.google.com/x');
  });

  it('el cuadro inline conserva hijos y presentación, sin copiar eventos ni crear links anidados', () => {
    const root = editor();
    const holder = root.querySelector<HTMLElement>('.sd-photo')!;
    holder.classList.add('sd-photo-sized'); holder.style.width = '36%'; holder.dataset.w = '36';
    holder.setAttribute('onclick', 'externo()'); holder.setAttribute('href', 'https://externo.test');
    const img = holder.firstElementChild!;
    const marks = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); holder.append(marks);
    addMediaLinks(root, { source: source(), pageId: 'P1', href: id => source().href(id) });
    const a = root.querySelector<HTMLAnchorElement>('a.sd-inline-media-link')!;
    expect([...a.children]).toEqual([img, marks]);
    expect(a.style.width).toBe('36%'); expect(a.dataset.w).toBe('36');
    expect(a.classList.contains('sd-photo-sized')).toBe(true); expect(a.hasAttribute('onclick')).toBe(false);
    expect(a.querySelector('.sd-media-name')).toBeNull();
    addMediaLinks(root, { source: source(), pageId: 'P1', href: () => 'https://otro.test' });
    expect(root.querySelectorAll('.sd-inline-media-link')).toHaveLength(1);
    const linked = document.createElement('a'); linked.href = 'https://escrito.test/';
    const nested = document.createElement('span'); nested.className = 'sd-photo'; nested.dataset.url = `sdmedia://${ID.video}`;
    nested.append(document.createElement('img')); nested.firstElementChild!.className = 'bn-visual-media'; linked.append(nested); root.append(linked);
    addMediaLinks(root, { source: source(), pageId: 'P1', href: id => source().href(id) });
    expect(linked.children).toHaveLength(1); expect(linked.querySelector('a')).toBeNull();
  });

  it('inline exige video conocido, UUID, imagen directa, permiso por página y href seguro', () => {
    for (const [id, over, href, direct] of [
      [ID.photo, {}, 'https://app.test/x', true], [ID.unknownPdf, {}, 'https://app.test/x', true],
      ['invalido', {}, 'https://app.test/x', true], [ID.video, { linkable: () => false }, 'https://app.test/x', true],
      [ID.video, {}, 'javascript:alert(1)', true], [ID.video, {}, 'https://app.test/x', false],
    ] as const) {
      const root = editor(); const holder = root.querySelector<HTMLElement>('.sd-photo')!;
      holder.dataset.url = `sdmedia://${id}`;
      if (!direct) { const wrapper = document.createElement('span'); wrapper.append(...holder.childNodes); holder.append(wrapper); }
      addMediaLinks(root, { source: source(over), pageId: 'P1', href: () => href });
      expect(root.querySelector('.sd-inline-media-link')).toBeNull();
    }
    const root = editor(); let pageSeen: string | null = null;
    addMediaLinks(root, { source: source({ linkable: (_id, page) => { pageSeen = page; return true; } }), pageId: 'P2', href: id => `https://app.test/f/${id}#link=own` });
    expect(root.querySelector<HTMLAnchorElement>('.sd-inline-media-link')?.href).toContain('#link=own'); expect(pageSeen).toBe('P2');
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

describe('appLinkSource (la que pone la app abierta)', () => {
  const media = { fileInfo: () => null, linkable: () => true };
  const config = { url: 'https://aaaaaaaaaa.supabase.co', publishableKey: 'sb_publishable_aaaaaaaa', localKey: 'wanka_1' };
  const token = `sdl_${'T'.repeat(43)}`;

  it('con una cuenta: siempre el # del workspace, nunca un token (imprimir, LF17)', () => {
    const href = new URL(appLinkSource(media, config, null, 'https://app.test').href(ID.pdf));
    expect(href.origin + href.pathname).toBe(`https://app.test/f/wanka_1/${ID.pdf}`);
    expect(parseWorkspaceHash(href.hash)).toEqual({ u: config.url, k: config.publishableKey, l: 'wanka_1' });
    expect(parseLinkHash(href.hash)).toBeNull();
  });

  it('con un link público abierto: el # del propio link', () => {
    const link = { url: 'https://bbbbbbbbbb.supabase.co', publishableKey: 'sb_publishable_bbbbbbbb', localKey: 'otro_2', token };
    const href = new URL(appLinkSource(media, config, link, 'https://app.test').href(ID.pdf));
    expect(href.pathname).toBe(`/f/otro_2/${ID.pdf}`);
    expect(parseLinkHash(href.hash)?.t).toBe(token);
  });
});
