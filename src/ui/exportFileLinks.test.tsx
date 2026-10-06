// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as Y from 'yjs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ExportCancelled, ExportEditor, type ExportEditorOptions } from '../export/exportEditor';
import { LinkContext, parseLinkHash } from '../linkMode';
import { MEDIA_SCHEME, mediaIdOf } from '../media/queue';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { ExportDialog } from './ExportDialog';
import { appLinkSource, setMediaLinkSource } from './mediaLinks';
import { watchPendingWrites } from './lazyPart';

// La ventana *Export* arma los links a los archivos (P.30, Docs/Doc_Links_PDF.md, LF17, LF18 y la ronda 1 de la
// auditoría de E1): con un link público *Can view* tildado, el token de ese link solo para sus páginas; destildado, nunca;
// *Can edit* viene destildado; y si la red se corta y vuelve, la casilla queda como la dejó la persona.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as never;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

const devices: Device[] = [];
const roots: Root[] = [];
const unsets: (() => void)[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const u of unsets.splice(0)) u();
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const FILE = '0f8fad5b-d9cb-469f-a165-70867728950e';
const CONFIG = { url: 'https://xyzxyzxyzx.supabase.co', publishableKey: 'sb_publishable_testtest', name: 'Test', localKey: 'test_ws', storage: {} };
const TOKEN = { view: `sdl_${'V'.repeat(43)}`, edit: `sdl_${'E'.repeat(43)}` };

/** Un bloque `image` con esa dirección en el contenido de la página (lo que ve el aviso de «sin conexión»). */
function insertFile(doc: Y.Doc, fileId: string): void {
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  doc.transact(() => {
    if (fragment.length === 0) fragment.insert(0, [new Y.XmlElement('blockGroup')]);
    const group = fragment.get(0) as Y.XmlElement;
    const container = new Y.XmlElement('blockContainer');
    container.setAttribute('id', crypto.randomUUID());
    const image = new Y.XmlElement('image');
    image.setAttribute('url', MEDIA_SCHEME + fileId);
    container.insert(0, [image]);
    group.insert(group.length, [container]);
  });
}

/**
 * `files`: qué lleva la página de adentro: nada (el PDF sin archivos), una foto con su original en el dispositivo (`local`) o una
 * foto cuyo original no está acá (`remote`, ya subida y liberada: solo el registro) o un adjunto (`file`).
 */
async function setup(level: 'comment' | 'edit', visitor = false, files: 'none' | 'local' | 'remote' | 'file' = 'file') {
  const d = await makeDevice(new FakeServer());
  devices.push(d);
  const root = await d.tree.create(null, 'Reporte');
  const child = await d.tree.create(root, 'Día 1');
  if (files !== 'none') {
    const id = mediaIdOf(await d.media.add(child, new File([new Uint8Array(2048)], 'IMG_0001.JPG', { type: 'image/jpeg' })))!;
    if (files === 'file') {
      const stored = (await d.mediaDb.get('files', id))!;
      await d.mediaDb.put('files', { ...stored, name: 'reporte.pdf', mime: 'application/pdf' });
    }
    const doc = await d.docs.open(child);
    insertFile(doc, id);
    d.docs.close(child);
    await d.docs.flush();
    if (files === 'remote') await d.mediaDb.delete('blobs', id);
  }
  // El link público está en la página de adentro: sus archivos usan su token; los de la raíz, la dirección de siempre.
  const rpc = vi.fn(async (fn: string, args: { p_page?: string }) => {
    if (fn === 'public_link_pages') return { data: [{ page_id: child }], error: null, status: 200 };
    if (fn === 'get_public_link' && args.p_page === child) {
      return { data: { clean_on: true, link: { level, token: level === 'edit' ? TOKEN.edit : TOKEN.view, alive: true, expires_at: null }, above: null }, error: null, status: 200 };
    }
    return { data: null, error: null, status: 200 };
  });
  const client = { rpc, auth: { getSession: async () => ({ data: { session: null } }) } } as never;
  // El portero conectado (los links solo se piden con archivos en Drive).
  const media = Object.create(d.media, { enabled: { value: true } });
  unsets.push(setMediaLinkSource(appLinkSource(media, CONFIG, null, 'https://app.test')));
  const services = {
    workspace: { config: CONFIG, client },
    client,
    user: { id: d.remote.userId, email: 'owner@test' },
    db: d.db,
    tree: d.tree,
    docs: d.docs,
    files: d.files,
    media,
    engine: d.engine,
    access: d.access,
    remote: d.remote as unknown as SupabaseRemote,
    dbName: 'test',
    mediaDb: d.mediaDb,
    comments: d.comments,
    commentsDb: d.commentsDb,
    sizes: d.sizes,
    shutdown: async () => undefined,
  } as unknown as Services;
  unsets.push(watchPendingWrites({ owner: services, current: () => true, unsaved: () => false, flush: () => d.docs.flush() }));
  const host = document.createElement('div');
  document.body.append(host);
  const r = createRoot(host);
  roots.push(r);
  await act(async () =>
    r.render(
      // `visitor`: alguien que abrió la app con un link público (`LinkContext`), no una cuenta.
      <LinkContext.Provider value={visitor ? ({ entry: {}, domain: 'x', linkId: '', pageId: root } as never) : null}>
        <ServicesContext.Provider value={services}>
          <ExportDialog target={{ kind: 'page', id: root }} onClose={() => undefined} />
        </ServicesContext.Provider>
      </LinkContext.Provider>,
    ),
  );
  await settle();
  // Lo que *Export* le pasa al editor de exportación (se corta ahí: el armado del PDF no importa acá).
  const created: ExportEditorOptions[] = [];
  vi.spyOn(ExportEditor, 'create').mockImplementation(async (options) => {
    created.push(options ?? {});
    throw new ExportCancelled();
  });
  const exportNow = async () => {
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Export PDF')!.click());
    await settle();
    return created[created.length - 1];
  };
  const box = () => host.querySelector<HTMLInputElement>('.export-file-links input[type="checkbox"]');
  return { d, host, root, child, rpc, exportNow, box };
}

const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
const tokenOf = (href: string | null | undefined) => (href ? parseLinkHash(new URL(href).hash)?.t ?? null : null);

describe('Export: los links a los archivos con un link público', () => {
  it('Can view tildado: el token solo para las páginas del link; las demás, la dirección de siempre', async () => {
    const { exportNow, box, root, child, host } = await setup('comment');
    expect(host.textContent).toContain('use the public link of “Día 1”');
    expect(box()!.checked).toBe(true);
    const options = await exportNow();
    expect(tokenOf(options.mediaHref!(FILE, child))).toBe(TOKEN.view);
    const outside = options.mediaHref!(FILE, root)!;
    expect(tokenOf(outside)).toBeNull();
    expect(new URL(outside).hash.startsWith('#ws=')).toBe(true);
  });

  it('Can view destildado: ningún token', async () => {
    const { exportNow, box } = await setup('comment');
    await act(async () => box()!.click());
    expect(box()!.checked).toBe(false);
    const options = await exportNow();
    expect(options.mediaHref).toBeUndefined();
  });

  it('Can edit: viene destildado (sin token); tildado a mano, con el token', async () => {
    const { exportNow, box, child } = await setup('edit');
    expect(box()!.checked).toBe(false);
    expect((await exportNow()).mediaHref).toBeUndefined();
    await act(async () => box()!.click());
    expect(tokenOf((await exportNow()).mediaHref!(FILE, child))).toBe(TOKEN.edit);
  });

  it('sin red la ventana dice que los links a los archivos no usan el link público; con red y con un link, no', async () => {
    const { exportNow, d, host, box } = await setup('comment');
    const notice = () => host.querySelector('.export-offline-links')?.textContent ?? null;
    // Con red y con un link público: el aviso del link, no el de sin conexión.
    expect(notice()).toBeNull();
    expect(box()).not.toBeNull();
    const engine = d.engine as unknown as { patch(p: { online: boolean }): void };
    await act(async () => engine.patch({ online: false }));
    await settle();
    expect(notice()).toBe("No connection: file links in this PDF can't use the public link of the page, even if it has one. They ask to sign in.");
    // Sin la casilla (no se piden links) y con la dirección de siempre en cada link.
    expect(box()).toBeNull();
    expect((await exportNow()).mediaHref).toBeUndefined();
    await act(async () => engine.patch({ online: true }));
    await settle();
    expect(notice()).toBeNull();
    expect(box()).not.toBeNull();
  });

  it('un visitante del link, sin red, no ve el aviso (usa su propio link); una cuenta sin red, sí', async () => {
    for (const visitor of [true, false]) {
      const { d, host } = await setup('comment', visitor);
      const engine = d.engine as unknown as { patch(p: { online: boolean }): void };
      await act(async () => engine.patch({ online: false }));
      await settle();
      expect(host.querySelector('.export-offline-links') === null, visitor ? 'visitante' : 'cuenta').toBe(visitor);
      for (const r of roots.splice(0)) act(() => r.unmount());
      document.body.replaceChildren();
    }
  });

  // Los avisos de «sin conexión» solo salen si el PDF lleva archivos (observación O4 de la auditoría de obs-ui): sin ninguno no
  // hay links a archivos que arreglar ni fotos que bajar de resolución, y decirlo era mentir.
  describe('sin red, los avisos dependen de los archivos que lleva el PDF', () => {
    const LINKS = "No connection: file links in this PDF can't use the public link";
    const PHOTOS = 'No connection: photos whose original is not on this device';
    const offline = async (files: 'none' | 'local' | 'remote' | 'file') => {
      const t = await setup('comment', false, files);
      const engine = t.d.engine as unknown as { patch(p: { online: boolean }): void };
      await act(async () => engine.patch({ online: false }));
      await settle();
      return t;
    };

    it('un PDF sin ningún archivo: ni el aviso de los links ni el de las fotos', async () => {
      const { host } = await offline('none');
      expect(host.textContent).not.toContain(LINKS);
      expect(host.textContent).not.toContain(PHOTOS);
    });

    it('con una foto cuyo original está en el dispositivo: ningún aviso', async () => {
      const { host } = await offline('local');
      expect(host.textContent).not.toContain(LINKS);
      expect(host.textContent).not.toContain(PHOTOS);
    });

    it('con una foto cuyo original no está: solo el aviso de fotos', async () => {
      const { host } = await offline('remote');
      expect(host.textContent).not.toContain(LINKS);
      expect(host.textContent).toContain(PHOTOS);
    });

    it('con Smaller file y una foto no sale ningún aviso', async () => {
      const { host } = await offline('remote');
      const box = [...host.querySelectorAll<HTMLInputElement>('.export-options input[type="checkbox"]')][0]!;
      await act(async () => box.click());
      expect(host.textContent).not.toContain(PHOTOS);
      expect(host.textContent).not.toContain(LINKS);
    });

    it('con un adjunto: solo el aviso de los links', async () => {
      const { host } = await offline('file');
      expect(host.textContent).toContain(LINKS);
      expect(host.textContent).not.toContain(PHOTOS);
    });
  });

  it('la red se corta y vuelve: la casilla queda como la dejó la persona', async () => {
    const { exportNow, box, d, rpc } = await setup('comment');
    await act(async () => box()!.click());
    const engine = d.engine as unknown as { patch(p: { online: boolean }): void };
    await act(async () => engine.patch({ online: false }));
    await settle();
    await act(async () => engine.patch({ online: true }));
    await settle();
    // Se volvieron a pedir los links (la ventana sigue abierta) y la casilla no volvió a tildarse.
    expect(rpc.mock.calls.filter((c) => c[0] === 'public_link_pages').length).toBeGreaterThanOrEqual(2);
    expect(box()!.checked).toBe(false);
    expect((await exportNow()).mediaHref).toBeUndefined();
  });
});
