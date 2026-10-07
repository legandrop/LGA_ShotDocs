// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settled } from '../test/settle';
import { rememberLink } from '../linkMode';
import { mediaDbName } from '../media/mediaDb';
import { prefs } from '../prefs';
import { block, group } from '../sync/historyTesting';
import { addPublicLink, makeLinkDevice, resetPublicLink } from '../sync/linkTesting';
import { FakeServer, makeDevice } from '../sync/testing';
import type { KeyValueStore } from '../workspaces';
import { LinkApp } from './LinkApp';
import { linkDbName } from './LinkEditBar';

// B1 de la auditoría de la entrega 2b (Docs/Doc_Link_Publico.md, E2.7): si el link deja de andar con un archivo a medio
// subir, el original no puede quedar encerrado en el navegador del visitante. La pantalla de "este link ya no anda" lo
// ofrece para bajar, el mismo archivo, sin base ni portero (como la de cuando sacan a alguien). El caso del auditor (un video
// de 40 MB cortado por *Reset link* a mitad de la subida), achicado.

vi.mock('./Workspace', async () => {
  const { createElement } = await import('react');
  return { Workspace: () => createElement('div', { id: 'workspace' }, 'WORKSPACE') };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  localStorage.clear();
});

// El rato pedido y, después, a que termine lo que quedó en marcha (src/test/settle.ts).
const settle = () => act(() => settled(30));
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });


/** Los bytes de un archivo de prueba: cada uno, con su largo y su dibujo (si se bajara otro, no coincidiría). */
const bytesOf = (size: number, seed: number) => new Uint8Array(size).map((_, i) => (i * seed + (i >> 8)) % 251);

interface Dropped {
  name: string;
  type: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/**
 * Un visitante con el link que suelta archivos que no llegan a subir (ninguna parte le llega al portero) y el link que
 * muere: devuelve la entrada del link de este navegador y lo que quedó en su base de archivos.
 */
async function deadLinkWith(files: Dropped[]) {
  prefs.set({ language: 'en' });
  const server = new FakeServer();
  server.enableTeam();
  server.enableClean(0.1);
  server.enableLinkEdit(0.1);
  server.enableLinkFiles();
  const e1 = await makeDevice(server, undefined, '0.200');
  const page = await e1.tree.create(null, 'Brief');
  await e1.engine.syncNow();
  const doc0 = await e1.docs.open(page);
  doc0.transact(() => group(doc0).push([block('e0', 'Del equipo')]), 'test');
  await e1.docs.flush(page);
  e1.docs.close(page);
  await e1.engine.syncNow();
  const token = addPublicLink(server, page, server.ownerId, 'edit');
  await e1.engine.prepareBases([page]);

  // El visitante, con la base de archivos del link de este navegador (la que lee la pantalla del link muerto).
  const entry = rememberLink({ u: 'https://abcdefghijklmnopqrst.supabase.co', k: 'sb_publishable_x', l: 'wanka_1', t: token }, localStorage as KeyValueStore);
  const v = await makeLinkDevice(server, token, entry.device, '0.200', 'Ana', mediaDbName(linkDbName(entry)));
  await v.engine.syncNow();
  await v.engine.prefetchPage(page);
  // Ninguna parte le llega al portero: los archivos quedan sin subir.
  server.portero.cutAfterParts = 0;
  const ids: string[] = [];
  for (const [i, f] of files.entries()) {
    // Un Blob de Node: el de jsdom no pasa por el IndexedDB de las pruebas (en el navegador, el de siempre).
    const url = await v.media.add(page, Object.assign(new NodeBlob([f.bytes], { type: f.type }) as unknown as Blob, { name: f.name }));
    const doc = await v.docs.open(page);
    doc.transact(() => group(doc).push([block(`vid${i}`, '', 'image', { url })]), 'test');
    await v.docs.flush(page);
    v.docs.close(page);
    ids.push(url.slice('sdmedia://'.length));
  }
  await v.media.idle();
  for (let i = 0; i < 2; i++) {
    await v.engine.syncNow();
    await v.engine.syncMedia();
  }
  // El primero llegó a registrarse y no a subir; después de ese corte la cola espera un rato, y los demás siguen solo en
  // este navegador: la pantalla del link muerto los ofrece igual.
  expect(server.mediaFiles.get(ids[0])?.plink_id).toBeDefined();
  expect(server.mediaFiles.get(ids[0])!.drive_id).toBeNull();
  // Reset link: el link de este navegador ya no anda.
  resetPublicLink(server, token);
  await v.engine.stop();
  return { entry };
}

/** Mismo largo y mismos bytes (sin `toEqual`: con un original distinto, comparar y mostrar cien mil números se cuelga). */
const bytesEqual = async (blob: Blob, bytes: Uint8Array) => {
  const got = new Uint8Array(await blob.arrayBuffer());
  expect(got.length).toBe(bytes.length);
  expect(Buffer.from(got).equals(Buffer.from(bytes))).toBe(true);
};

describe('el link muerto con un archivo sin subir (B1)', () => {
  it('Reset link a mitad de la subida: la pantalla ofrece bajar el original, el mismo archivo', async () => {
    // Un "video" de 3 MB que no llega a subir.
    const bytes = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 31) % 251);
    const { entry } = await deadLinkWith([{ name: 'toma-12.mp4', type: 'video/mp4', bytes }]);

    // La app del link vuelve a abrir: el servidor dice que no anda.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(500, { message: 'link_not_found', code: 'P0002', details: null, hint: null }))));
    const saved: Blob[] = [];
    const created = vi.fn((b: Blob) => {
      saved.push(b);
      return 'blob:saved';
    });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: () => undefined }));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<LinkApp entry={entry} />));
    for (let i = 0; i < 20 && !host.textContent?.includes('toma-12.mp4'); i++) await settle();
    expect(host.textContent).toContain('This link no longer works');
    expect(host.textContent).toContain("1 photo or file you added didn't finish uploading");
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'toma-12.mp4')!;
    expect(button).toBeDefined();
    await act(async () => button.click());
    for (let i = 0; i < 20 && saved.length === 0; i++) await settle();
    expect(saved).toHaveLength(1);
    // El mismo original, byte por byte.
    await bytesEqual(saved[0], bytes);
    expect(host.textContent).toContain('downloaded');
  });

  // O-R1 de la re-verificación: con un solo archivo, «baja ese archivo» y «baja el primero de la base» dan lo mismo.
  it('con varios archivos sin subir, cada botón baja su propio original (no el primero ni el último)', async () => {
    const files: Dropped[] = [
      { name: 'toma-01.mp4', type: 'video/mp4', bytes: bytesOf(150_000, 31) },
      { name: 'ref-02.pdf', type: 'application/pdf', bytes: bytesOf(90_000, 17) },
      { name: 'foto-03.zip', type: 'application/zip', bytes: bytesOf(210_000, 7) },
    ];
    const { entry } = await deadLinkWith(files);

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(500, { message: 'link_not_found', code: 'P0002', details: null, hint: null }))));
    const saved: Blob[] = [];
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: (b: Blob) => {
          saved.push(b);
          return 'blob:saved';
        },
        revokeObjectURL: () => undefined,
      }),
    );
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<LinkApp entry={entry} />));
    for (let i = 0; i < 20 && !files.every((f) => host.textContent?.includes(f.name)); i++) await settle();
    expect(host.textContent).toContain("3 photos or files you added didn't finish uploading");
    const buttonOf = (name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === name)!;
    // En un orden que no es el de la lista: el del medio, el último, el primero.
    for (const f of [files[1], files[2], files[0]]) {
      const before = saved.length;
      await act(async () => buttonOf(f.name).click());
      for (let i = 0; i < 20 && saved.length === before; i++) await settle();
      expect(saved).toHaveLength(before + 1);
      await bytesEqual(saved[before], f.bytes);
    }
    // Cada uno se marca como bajado, y nada se borró: sigue en el navegador para bajarlo otra vez.
    expect(host.textContent!.match(/downloaded/g)).toHaveLength(3);
    const again = saved.length;
    await act(async () => buttonOf(files[1].name).click());
    for (let i = 0; i < 20 && saved.length === again; i++) await settle();
    expect(saved).toHaveLength(again + 1);
    await bytesEqual(saved[again], files[1].bytes);
  });
});
