// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import { block, group } from '../sync/historyTesting';
import { addPublicLink, makeLinkDevice, type LinkDevice } from '../sync/linkTesting';
import { FakeServer, makeDevice } from '../sync/testing';
import { SyncBadge } from './SyncBadge';

// O-R2 de la re-verificación de la entrega 2b (Docs/Doc_Link_Publico.md, E2.7): con el link VIVO, un archivo que el tope del
// día no deja registrar queda solo en el navegador del visitante. El detalle de la insignia de sincronización lo nombra y
// ofrece *Download it*: baja ese mismo original (con el link vivo no se completa solo hasta que el tope vuelve).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const visitors: LinkDevice[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const v of visitors.splice(0)) {
    await v.engine.stop();
    v.media.stop?.();
    try {
      v.db.close();
    } catch {
      // ya cerrada
    }
  }
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const settle = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));

/** Lo que usa la insignia, con el dispositivo de un visitante (`remote` es el `LinkRemote`, como en el modo link). */
function servicesOf(v: LinkDevice): Services {
  const client = { auth: {} } as never;
  return {
    workspace: { config: { url: 'https://abcdefghijklmnopqrst.supabase.co', publishableKey: 'sb_publishable_x', name: 'Wanka', localKey: 'wanka_1', storage: {} }, client },
    client,
    user: { id: `link:test`, email: '' },
    tree: v.tree,
    docs: v.docs,
    media: v.media,
    engine: v.engine,
    access: v.access,
    remote: v.remote,
    comments: v.comments,
  } as unknown as Services;
}

const bytesOf = (size: number, seed: number) => new Uint8Array(size).map((_, i) => (i * seed + (i >> 8)) % 251);
const bytesEqual = async (blob: Blob, bytes: Uint8Array) => {
  const got = new Uint8Array(await blob.arrayBuffer());
  expect(got.length).toBe(bytes.length);
  expect(Buffer.from(got).equals(Buffer.from(bytes))).toBe(true);
};

describe('la insignia de sincronización con un link vivo: archivo que no se registró', () => {
  it('el detalle lo nombra con su motivo y Download it baja cada original, el mismo archivo', async () => {
    prefs.set({ language: 'en' });
    const server = new FakeServer();
    server.enableTeam();
    server.enableClean(0.1);
    server.enableLinkEdit(0.1);
    server.enableLinkFiles();
    const e1 = await makeDevice(server, undefined, '0.200');
    try {
      const page = await e1.tree.create(null, 'Brief');
      await e1.engine.syncNow();
      const doc0 = await e1.docs.open(page);
      doc0.transact(() => group(doc0).push([block('e0', 'Del equipo')]), 'test');
      await e1.docs.flush(page);
      e1.docs.close(page);
      await e1.engine.syncNow();
      const token = addPublicLink(server, page, server.ownerId, 'edit');
      await e1.engine.prepareBases([page]);
      const v = await makeLinkDevice(server, token, undefined, '0.200', 'Ana');
      visitors.push(v);
      await v.engine.syncNow();
      await v.engine.prefetchPage(page);

      // El tope del día de archivos, lleno: ninguno se registra.
      server.linkLimits.file = 0;
      const files = [
        { name: 'toma-01.mp4', type: 'video/mp4', bytes: bytesOf(120_000, 31) },
        { name: 'ref-02.pdf', type: 'application/pdf', bytes: bytesOf(70_000, 17) },
      ];
      for (const [i, f] of files.entries()) {
        const url = await v.media.add(page, Object.assign(new NodeBlob([f.bytes], { type: f.type }) as unknown as Blob, { name: f.name }));
        const doc = await v.docs.open(page);
        doc.transact(() => group(doc).push([block(`f${i}`, '', 'image', { url })]), 'test');
        await v.docs.flush(page);
        v.docs.close(page);
      }
      await v.media.idle();
      for (let i = 0; i < 3; i++) {
        await v.engine.syncNow();
        await v.engine.syncMedia();
      }
      // El link sigue vivo y nada llegó a la base.
      expect(server.mediaFiles.size).toBe(0);
      expect((await v.media.failures()).map((f) => f.name).sort()).toEqual(['ref-02.pdf', 'toma-01.mp4']);

      // Lo que baja el navegador: el blob y el nombre.
      const saved: { blob: Blob; name: string }[] = [];
      let pending: Blob | null = null;
      vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: Blob) => ((pending = b), 'blob:saved'), revokeObjectURL: () => undefined }));
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        saved.push({ blob: pending!, name: this.download });
      });

      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      roots.push(root);
      await act(async () => root.render(
        <ServicesContext.Provider value={servicesOf(v)}>
          <SyncBadge />
        </ServicesContext.Provider>,
      ));
      await settle();
      // La insignia avisa y el detalle se abre con un clic.
      await act(async () => host.querySelector<HTMLButtonElement>('.sync-pill')!.click());
      for (let i = 0; i < 20 && !host.textContent?.includes('toma-01.mp4'); i++) await settle();
      const details = host.querySelector('.sync-details')!;
      expect(details.textContent).toContain('toma-01.mp4');
      expect(details.textContent).toContain('ref-02.pdf');
      expect(details.textContent).toMatch(/limit for adding files/);
      const rows = [...details.querySelectorAll('li')];
      const rowOf = (name: string) => rows.find((li) => li.textContent?.includes(name))!;
      const downloadOf = (name: string) => [...rowOf(name).querySelectorAll('button')].find((b) => b.textContent === 'Download it')!;
      expect(downloadOf('toma-01.mp4')).toBeDefined();
      expect(downloadOf('ref-02.pdf')).toBeDefined();

      // Cada botón baja el original de su fila (en un orden que no es el de la lista).
      for (const f of [files[1], files[0]]) {
        const before = saved.length;
        await act(async () => downloadOf(f.name).click());
        for (let i = 0; i < 20 && saved.length === before; i++) await settle();
        expect(saved).toHaveLength(before + 1);
        expect(saved[before].name).toBe(f.name);
        await bytesEqual(saved[before].blob, f.bytes);
      }
      // No se borró nada: siguen sin subir, en la cola del navegador, y el link sigue vivo.
      expect((await v.media.failures()).map((f) => f.name).sort()).toEqual(['ref-02.pdf', 'toma-01.mp4']);
      expect(server.publicLinks.get(token)).toBeDefined();
    } finally {
      await e1.engine.stop();
      e1.db.close();
      e1.mediaDb.close();
    }
  });
});
