// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { MEDIA_SCHEME, mediaIdOf } from '../media/queue';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { TrashView } from './TrashView';

// La pestaña Archivos de la papelera (paso 11), montada contra el servidor y el portero en memoria: quién la
// ve, qué muestra y que mandar a la papelera de Drive pide confirmación y saca el archivo de la lista.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const devices: Device[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
  }
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function services(d: Device, userId: string): Services {
  const config = {
    url: 'https://znlvpuddswymxpffgvbz.supabase.co',
    publishableKey: 'sb_publishable_test',
    name: 'Wanka',
    localKey: WANKA_LOCAL_KEY,
    storage: legacyStorageNames(WANKA_LOCAL_KEY),
  };
  const client = { auth: {} } as never;
  return {
    workspace: { config, client },
    client,
    user: { id: userId, email: `${userId}@test` },
    db: d.db,
    tree: d.tree,
    docs: d.docs,
    files: d.files,
    media: d.media,
    engine: d.engine,
    access: d.access,
    remote: d.remote as unknown as SupabaseRemote,
    dbName: 'test',
    mediaDb: d.mediaDb,
    comments: d.comments,
    commentsDb: d.commentsDb,
    sizes: d.sizes,
    shutdown: async () => undefined,
  };
}

async function mount(value: Services): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<ServicesContext.Provider value={value}>{<TrashView />}</ServicesContext.Provider>));
  await settle();
  return host;
}

const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

async function sync(d: Device): Promise<void> {
  for (let i = 0; i < 2; i++) {
    await d.engine.syncNow();
    await d.engine.syncMedia();
  }
}

/** Una foto que estuvo en una página y ya no: queda en la papelera de archivos. */
async function trashedPhoto(): Promise<{ server: FakeServer; owner: Device; id: string }> {
  const server = new FakeServer();
  server.enableTrash();
  const owner = await makeDevice(server);
  devices.push(owner);
  await sync(owner);
  const page = await owner.tree.create(null, 'Día 1');
  await sync(owner);
  const id = mediaIdOf(await owner.media.add(page, new File([new Uint8Array(2048)], 'IMG_0042.JPG', { type: 'image/jpeg' })))!;
  const doc = await owner.docs.open(page);
  const group = new Y.XmlElement('blockGroup');
  const container = new Y.XmlElement('blockContainer');
  const image = new Y.XmlElement('image');
  doc.transact(() => {
    doc.getXmlFragment(CONTENT_FRAGMENT).insert(0, [group]);
    group.insert(0, [container]);
    container.insert(0, [image]);
    image.setAttribute('url', MEDIA_SCHEME + id);
  });
  await owner.docs.flush();
  await sync(owner);
  doc.transact(() => group.delete(0, 1));
  owner.docs.close(page);
  await owner.docs.flush();
  await sync(owner);
  expect(server.mediaFiles.get(id)?.trashed_at).toBeTruthy();
  return { server, owner, id };
}

const buttons = (host: HTMLElement) => [...host.querySelectorAll('button')];
const byText = (host: HTMLElement, text: string) => buttons(host).find((b) => b.textContent?.trim() === text);

describe('papelera: pestaña Archivos', () => {
  it('el dueño ve la lista con los datos y los avisos, y manda uno a la papelera de Drive con confirmación', async () => {
    const { server, owner, id } = await trashedPhoto();
    const host = await mount(services(owner, server.ownerId));
    await act(async () => byText(host, 'Files')!.click());
    await vi.waitFor(() => expect(host.textContent).toContain('IMG_0042.JPG'));

    const text = host.textContent ?? '';
    expect(text).toContain('IMG_0042.JPG');
    expect(text).toContain('2 KB');
    expect(text).toContain('30 days left');
    expect(text).toContain('Auto-delete is off');
    expect(text).toContain("A file can show here while still in use on a page this device hasn't synced.");
    expect(host.querySelector('[title]')).toBeNull();

    // Sin confirmar no se manda nada.
    const confirm = vi.fn((_message: string) => false);
    vi.stubGlobal('confirm', confirm);
    await act(async () => byText(host, 'Send to Drive trash')!.click());
    await settle();
    expect(confirm.mock.calls[0]?.[0]).toMatch(/Google Drive trash[\s\S]*30 days[\s\S]*hasn't synced/);
    expect(server.portero.calls.some((c) => c.path === '/trash')).toBe(false);

    confirm.mockReturnValue(true);
    await act(async () => byText(host, 'Send to Drive trash')!.click());
    await vi.waitFor(async () => {
      await settle();
      expect(host.textContent).toContain('No files in the trash.');
    });
    expect(server.mediaFiles.get(id)?.drive_trashed_at).toBeTruthy();
  });

  it('marca los que usa una página de la papelera y "Empty" los deja afuera', async () => {
    const server = new FakeServer();
    server.enableTrash();
    const owner = await makeDevice(server);
    devices.push(owner);
    await sync(owner);
    const page = await owner.tree.create(null, 'Día 1');
    await sync(owner);
    const id = mediaIdOf(await owner.media.add(page, new File([new Uint8Array(2048)], 'IMG_0042.JPG', { type: 'image/jpeg' })))!;
    const doc = await owner.docs.open(page);
    doc.transact(() => {
      const group = new Y.XmlElement('blockGroup');
      const container = new Y.XmlElement('blockContainer');
      const image = new Y.XmlElement('image');
      doc.getXmlFragment(CONTENT_FRAGMENT).insert(0, [group]);
      group.insert(0, [container]);
      container.insert(0, [image]);
      image.setAttribute('url', MEDIA_SCHEME + id);
    });
    owner.docs.close(page);
    await owner.docs.flush();
    await sync(owner);
    await owner.tree.trash(page);
    await sync(owner);

    const host = await mount(services(owner, server.ownerId));
    expect(host.textContent).toContain('already sent to the Google Drive trash');
    await act(async () => byText(host, 'Files')!.click());
    await vi.waitFor(() => expect(host.textContent).toContain('Used by “Día 1” in the trash'));
    expect(byText(host, 'Empty')!.disabled).toBe(true);
    // De a uno se puede, con su propia confirmación.
    const confirm = vi.fn((_message: string) => false);
    vi.stubGlobal('confirm', confirm);
    await act(async () => byText(host, 'Send to Drive trash')!.click());
    expect(confirm.mock.calls[0]?.[0]).toMatch(/a page in the trash\. Restoring that page will not bring it back/);
  });

  it('un archivo que usa una página de un proyecto borrado (P.14) lo dice y no se manda, ni de a uno ni con "Empty"', async () => {
    const { server, owner, id } = await trashedPhoto();
    server.enableProjectStates();
    // La foto también está pegada en una página de otro proyecto, que después se borra.
    const other = await owner.tree.createProject('Otro');
    const page = await owner.tree.create(null, 'Escena', other);
    await sync(owner);
    server.foreignPageFiles.add(`${page}:${id}`);
    server.refreshFileTrash(id);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeNull();
    await owner.remote.deleteProject(other);
    expect(server.mediaFiles.get(id)?.trashed_at).toBeTruthy();

    const host = await mount(services(owner, server.ownerId));
    await act(async () => byText(host, 'Files')!.click());
    await vi.waitFor(() => expect(host.textContent).toContain('Used by a page of a deleted project. It comes back if that project is restored.'));
    expect(byText(host, 'Send to Drive trash')).toBeUndefined();
    expect(byText(host, 'Empty')!.disabled).toBe(true);
  });

  it('quien no puede verla no tiene la pestaña; quien la ve sin ser dueño ni admin no puede mandar nada', async () => {
    const { server } = await trashedPhoto();
    server.addMember('editor-1', 'member');
    server.grant('editor-1', { projectId: server.workspaceId }, 'edit');
    server.addMember('lead-1', 'member');
    server.grant('lead-1', { projectId: server.workspaceId }, 'edit_pages');

    const editor = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'editor-1' });
    devices.push(editor);
    await sync(editor);
    const hostEditor = await mount(services(editor, 'editor-1'));
    expect(byText(hostEditor, 'Files')).toBeUndefined();
    expect(server.mediaCalls.filter((c) => c.startsWith('trashed_files'))).toEqual([]);

    const lead = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'lead-1' });
    devices.push(lead);
    await sync(lead);
    const hostLead = await mount(services(lead, 'lead-1'));
    await act(async () => byText(hostLead, 'Files')!.click());
    await vi.waitFor(() => expect(hostLead.textContent).toContain('IMG_0042.JPG'));
    expect(byText(hostLead, 'Send to Drive trash')).toBeUndefined();
    expect(byText(hostLead, 'Empty')).toBeUndefined();
  });
});

describe('papelera: el peso de los archivos (P.7)', () => {
  it('muestra el total arriba y la confirmación de vaciar dice cuánto pasa a la papelera de Drive, sin prometer que libera', async () => {
    const { server, owner } = await trashedPhoto();
    server.enableSizes();
    await sync(owner);
    const calls = server.sizesCalls;
    const host = await mount(services(owner, server.ownerId));
    await act(async () => byText(host, 'Files')!.click());
    await vi.waitFor(() => expect(host.textContent).toContain('1 file · 2 KB'));

    const confirm = vi.fn((_message: string) => false);
    vi.stubGlobal('confirm', confirm);
    await act(async () => byText(host, 'Empty')!.click());
    const message = confirm.mock.calls[0]?.[0] ?? '';
    expect(message).toContain('2 KB go to the Google Drive trash');
    expect(message).toMatch(/freed when Google empties its trash \(after 30 days\)/);
    expect(message).not.toMatch(/\bfrees\b/);
    expect(server.sizesCalls).toBe(calls);

    // Al terminar de vaciar se vuelve a pedir el peso, una sola vez.
    confirm.mockReturnValue(true);
    await act(async () => byText(host, 'Empty')!.click());
    await vi.waitFor(async () => {
      await settle();
      expect(host.textContent).toContain('No files in the trash.');
    });
    expect(server.sizesCalls).toBe(calls + 1);
  });
});
