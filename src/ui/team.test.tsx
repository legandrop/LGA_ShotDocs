// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importJobFor } from '../import/importJob';
import { copyWhenReady, parseInviteHash } from '../invite';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { MembersDialog } from './MembersDialog';
import { RemovedScreen } from './RemovedScreen';
import { ShareDialog } from './ShareDialog';

// Las pantallas del equipo, montadas de verdad contra el servidor en memoria: que se muestren, que
// inviten y copien el link, y que la de "sacado" no borre nada sola.

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
});

function services(d: Device, userId: string, signOut = vi.fn(async () => ({ error: null }))): Services {
  const config = {
    url: 'https://znlvpuddswymxpffgvbz.supabase.co',
    publishableKey: 'sb_publishable_test',
    name: 'Wanka',
    localKey: WANKA_LOCAL_KEY,
    storage: legacyStorageNames(WANKA_LOCAL_KEY),
  };
  const client = { auth: { signOut } } as never;
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
    offline: d.offline,
    shutdown: async () => undefined,
  };
}

async function mount(value: Services, node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<ServicesContext.Provider value={value}>{node}</ServicesContext.Provider>));
  await act(async () => new Promise((r) => setTimeout(r, 20)));
  return host;
}

async function teamDevice(userId?: string) {
  const server = new FakeServer();
  server.enableTeam();
  const owner = await makeDevice(server);
  devices.push(owner);
  const page = await owner.tree.create(null, 'Brief');
  await owner.engine.syncNow();
  server.addMember('ana', 'member', 'ana@test');
  server.grant('ana', { pageId: page }, 'view');
  if (!userId) return { server, device: owner, page, userId: server.ownerId };
  const d = await makeDevice(server, undefined, undefined, undefined, undefined, { id: userId });
  devices.push(d);
  await d.engine.syncNow();
  return { server, device: d, page, userId };
}

function click(el: Element | null | undefined) {
  if (!el) throw new Error('no element');
  act(() => (el as HTMLElement).click());
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('pantallas del equipo', () => {
  it('Members lista a la gente, invita y copia el link', async () => {
    const { server, device, userId } = await teamDevice();
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t: string) => void copied.push(t) },
    });
    const notices: string[] = [];
    window.addEventListener('shotdocs:notice', (e) => notices.push((e as CustomEvent<string>).detail));

    const host = await mount(services(device, userId), <MembersDialog onClose={() => undefined} />);
    expect(host.textContent).toContain('ana@test');
    expect(host.textContent).toContain('owner@test');

    type(host.querySelector('input[type="email"]') as HTMLInputElement, 'Cliente@Example.com');
    await act(async () => {
      (host.querySelector('form') as HTMLFormElement).requestSubmit();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(server.invitations.map((i) => i.email)).toEqual(['cliente@example.com']);
    expect(copied).toHaveLength(1);
    const payload = parseInviteHash(copied[0].slice(copied[0].indexOf('#')));
    expect(payload?.l).toBe(WANKA_LOCAL_KEY);
    expect(notices).toContain('Link copied — send it by email or WhatsApp');
  });

  it('Members muestra las invitaciones sin usar con "Revoke", y las esconde si la base no las tiene', async () => {
    const { server, device, userId } = await teamDevice();
    await device.remote.createInvitation('pendiente@test', 'guest', []);
    const host = await mount(services(device, userId), <MembersDialog onClose={() => undefined} />);
    expect(host.textContent).toContain('Invitations not used yet');
    expect(host.textContent).toContain('pendiente@test');
    vi.stubGlobal('confirm', () => true);
    click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Revoke'));
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(server.invitations[0].revoked_at).toBeTruthy();
    expect(host.textContent).not.toContain('pendiente@test');
    vi.unstubAllGlobals();

    server.noInvitationList = true;
    await device.remote.createInvitation('otra@test', 'guest', []);
    const again = await mount(services(device, userId), <MembersDialog onClose={() => undefined} />);
    expect(again.textContent).not.toContain('Invitations not used yet');
  });

  it('copia con ClipboardItem dentro del gesto (Safari), y si no se puede, avisa para copiar a mano', async () => {
    const written: string[] = [];
    class FakeItem {
      constructor(readonly data: Record<string, Promise<Blob>>) {}
    }
    vi.stubGlobal('ClipboardItem', FakeItem);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: async (items: FakeItem[]) => void written.push(await (await items[0].data['text/plain']).text()),
        writeText: async () => {
          throw new Error('not allowed');
        },
      },
    });
    let resolve!: (t: string) => void;
    const link = new Promise<string>((r) => (resolve = r));
    const copied = copyWhenReady(link);
    resolve('https://app/#invite=abc');
    expect(await copied).toBe(true);
    expect(written).toEqual(['https://app/#invite=abc']);
    // El texto no llegó (la invitación falló): no copia nada y no rechaza.
    expect(await copyWhenReady(Promise.reject(new Error('invitation_exists')))).toBe(false);
    // Sin ClipboardItem y sin permiso: `false` (se muestra el campo para copiar a mano).
    vi.unstubAllGlobals();
    expect(await copyWhenReady(Promise.resolve('x'))).toBe(false);
  });

  it('Share muestra quién tiene acceso y comparte con un miembro', async () => {
    const { server, device, page, userId } = await teamDevice();
    server.addMember('bea', 'member', 'bea@test');
    const host = await mount(services(device, userId), <ShareDialog target={{ pageId: page }} onClose={() => undefined} />);
    expect(host.textContent).toContain('ana@test');
    expect(host.textContent).toContain('created the project');

    type(host.querySelector('input[type="email"]') as HTMLInputElement, 'bea@test');
    await act(async () => {
      (host.querySelector('form') as HTMLFormElement).requestSubmit();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(server.grants.find((g) => g.user_id === 'bea')).toMatchObject({ page_id: page, level: 'edit' });
    expect(host.textContent).toContain('bea@test');
  });

  it('la pantalla de sacado ofrece bajar lo pendiente y no borra nada hasta que se elige', async () => {
    const { server, device, page } = await teamDevice('ana');
    await device.docs.open(page).then((doc) => doc.getText('t').insert(0, 'x'));
    await device.docs.flush(page);
    server.removeMember('ana');
    await device.engine.syncNow();
    expect(device.access.removed).toBe(true);

    const signOut = vi.fn(async () => ({ error: null }));
    const value = services(device, 'ana', signOut);
    const shutdown = vi.fn(async () => undefined);
    value.shutdown = shutdown;
    const host = await mount(value, <RemovedScreen />);
    expect(host.textContent).toContain('You no longer have access to this workspace');
    expect(host.textContent).toContain('Download my unsynced changes');
    expect(shutdown).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();

    // Quedarse con todo en el dispositivo: solo cierra la sesión.
    click([...host.querySelectorAll('button')].find((b) => b.textContent?.includes('keep it on this device')));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(shutdown).not.toHaveBeenCalled();
  });

  it('la pantalla de sacado no cierra la sesión ni borra el dispositivo con una importación de Coda en curso', async () => {
    const { server, device } = await teamDevice('ana');
    server.removeMember('ana');
    await device.engine.syncNow();
    const signOut = vi.fn(async () => ({ error: null }));
    const value = services(device, 'ana', signOut);
    const shutdown = vi.fn(async () => undefined);
    value.shutdown = shutdown;
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const job = importJobFor(device.tree);
    let finish!: () => void;
    const running = job.run(
      () => new Promise((resolve) => (finish = () => resolve({ projectId: 'p', pages: 0, files: 0, comments: 0, problems: [], exportProblems: [], resumable: false }))),
    );
    try {
      const host = await mount(value, <RemovedScreen />);
      const buttons = [...host.querySelectorAll('button')];
      click(buttons.find((b) => b.textContent?.includes('keep it on this device')));
      click(buttons.find((b) => b.textContent?.includes('Remove')));
      await act(async () => new Promise((r) => setTimeout(r, 20)));
      expect(signOut).not.toHaveBeenCalled();
      expect(shutdown).not.toHaveBeenCalled();
      expect(alert).toHaveBeenCalledWith('An import from Coda is running. Wait until it finishes.');
    } finally {
      finish();
      await running;
      job.close();
      vi.restoreAllMocks();
    }
  });
});
