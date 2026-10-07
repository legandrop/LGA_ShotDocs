// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settled } from '../test/settle';
import { parseLinkHash } from '../linkMode';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { RemoteError } from '../sync/types';
import { dateInDays, endOfDay, linkErrorText, LinkShare } from './LinkShare';
import { t } from '../i18n';

// *General access* en Share (Docs/Doc_Link_Publico.md, 3.11): montado de verdad, con un cliente que contesta las
// funciones de quien comparte como la migración (20261012120000_link_publico.sql), simplificadas.

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

type Link = { id: string; page_id: string; token: string; level: string; expires_at: string | null; revoked: boolean };

/** Las funciones de quien comparte, en memoria. `canShare`: lo que diría `can_share`. */
function fakeClient(opts: { cleanOn: boolean; canShare: boolean }) {
  const links: Link[] = [];
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let n = 0;
  const state = {
    usage: { open: { n: 4, bytes: 0 }, comment: { n: 1, bytes: 30 } },
    creator: 'owner' as string | null,
    above: null as { page_id: string; level: string; title: string | null } | null,
    /** El link se apagó en otro dispositivo: cambiarlo da `link_not_found`. */
    goneOnSet: false,
    /** La base no acepta el pedido (`link_invalid`): al renovar, por un id repetido; al cambiar la fecha, por una que ya pasó. */
    invalid: false,
  };
  const json = (l: Link) => ({
    id: l.id, page_id: l.page_id, level: l.level, created_at: '2026-10-02T10:00:00Z', expires_at: l.expires_at,
    created_by_name: state.creator, token: l.token, alive: true, usage_today: state.usage,
    limited: false, comments: 1,
  });
  const live = (page: unknown) => links.find((l) => l.page_id === page && !l.revoked);
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    const ok = (data: unknown) => ({ data, error: null, status: 200 });
    if (fn === 'get_public_link') {
      if (!opts.canShare) return ok(null);
      const l = live(args.p_page);
      return ok({ clean_on: opts.cleanOn, link: l ? json(l) : null, above: state.above });
    }
    if (state.invalid && (fn === 'reset_public_link' || fn === 'set_public_link')) {
      return { data: null, error: { message: 'link_invalid', code: '22023' }, status: 400 };
    }
    if (fn === 'create_public_link' || fn === 'reset_public_link') {
      if (!opts.cleanOn) return { data: null, error: { message: 'clean_off', code: 'P0001' }, status: 400 };
      if (fn === 'reset_public_link') live(args.p_page)!.revoked = true;
      const l: Link = { id: String(args.p_id ?? args.p_new_id), page_id: String(args.p_page), token: 'sdl_' + String(++n).padStart(43, 'x'), level: 'comment', expires_at: (args.p_expires as string | null) ?? null, revoked: false };
      links.push(l);
      return ok(json(l));
    }
    if (fn === 'set_public_link') {
      if (state.goneOnSet) {
        for (const x of links) if (x.page_id === args.p_page) x.revoked = true;
        return { data: null, error: { message: 'link_not_found', code: 'P0002' }, status: 404 };
      }
      const l = live(args.p_page)!;
      l.expires_at = (args.p_expires as string | null) ?? null;
      return ok(json(l));
    }
    if (fn === 'revoke_public_link') {
      for (const l of links) if (l.page_id === args.p_page) l.revoked = true;
      return ok(null);
    }
    return { data: null, error: { message: 'unexpected ' + fn, code: '42501' }, status: 401 };
  };
  return {
    client: { rpc, auth: { signOut: vi.fn() } },
    calls,
    links,
    set usage(value: typeof state.usage) {
      state.usage = value;
    },
    state,
  };
}

function services(d: Device, client: unknown): Services {
  const config = {
    url: 'https://znlvpuddswymxpffgvbz.supabase.co',
    publishableKey: 'sb_publishable_testtesttest',
    name: 'Wanka',
    localKey: WANKA_LOCAL_KEY,
    storage: legacyStorageNames(WANKA_LOCAL_KEY),
  };
  return {
    workspace: { config, client: client as never },
    client: client as never,
    user: { id: 'owner', email: 'owner@test' },
    db: d.db, tree: d.tree, docs: d.docs, files: d.files, media: d.media, engine: d.engine, access: d.access,
    remote: d.remote as unknown as SupabaseRemote, dbName: 'test', mediaDb: d.mediaDb, comments: d.comments,
    commentsDb: d.commentsDb, sizes: d.sizes, offline: d.offline, shutdown: async () => undefined,
  };
}

async function setup({ schema = 14, clean = true }: { schema?: number; clean?: boolean } = {}) {
  const server = new FakeServer();
  server.enableTeam();
  if (clean) server.enableClean(0.001);
  server.settings = { ...server.settings!, schemaVersion: schema };
  const d = await makeDevice(server);
  devices.push(d);
  const page = await d.tree.create(null, 'Brief');
  await d.engine.syncNow();
  return { server, d, page };
}

async function mount(value: Services, node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<ServicesContext.Provider value={value}>{node}</ServicesContext.Provider>));
  await act(async () => new Promise((r) => setTimeout(r, 30)));
  return host;
}

// El rato pedido y, después, a que termine lo que quedó en marcha (src/test/settle.ts).
const settle = () => act(() => settled(30));

function setDate(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function pick(host: HTMLElement, label: string, value: string) {
  const select = host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('General access (Share)', () => {
  it('con una base anterior a los links, o para quien no comparte, no aparece', async () => {
    const old = await setup({ schema: 13 });
    const a = fakeClient({ cleanOn: true, canShare: true });
    const host = await mount(services(old.d, a.client), <LinkShare pageId={old.page} onClose={() => undefined} />);
    expect(host.textContent).toBe('');
    expect(a.calls).toEqual([]);
    act(() => roots.pop()!.unmount());

    const now = await setup();
    const b = fakeClient({ cleanOn: true, canShare: false });
    const host2 = await mount(services(now.d, b.client), <LinkShare pageId={now.page} onClose={() => undefined} />);
    expect(host2.textContent).toBe('');
    expect(b.calls.map((c) => c.fn)).toEqual(['get_public_link']);
  });

  it('con el interruptor de D14 apagado, Anyone with the link se ve apagado con la línea que lo explica (D33)', async () => {
    const { d, page } = await setup({ clean: false });
    const f = fakeClient({ cleanOn: false, canShare: true });
    const host = await mount(services(d, f.client), <LinkShare pageId={page} onClose={() => undefined} />);
    expect((host.querySelector('select[aria-label="General access"]') as HTMLSelectElement).disabled).toBe(true);
    expect(host.textContent).toContain('Links need the workspace setting');
    expect(f.calls.map((c) => c.fn)).toEqual(['get_public_link']);
  });

  it('crear (Never por defecto, D30), copiar el link, cambiar el vencimiento, Reset link y apagarlo', async () => {
    const { d, page } = await setup();
    const writes: string[] = [];
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async (t: string) => void writes.push(t) } });
    vi.stubGlobal('confirm', () => true);
    const f = fakeClient({ cleanOn: true, canShare: true });
    const host = await mount(services(d, f.client), <LinkShare pageId={page} onClose={() => undefined} />);
    expect(host.textContent).toContain('Restricted');
    pick(host, 'General access', 'anyone');
    await settle();
    const create = f.calls.find((c) => c.fn === 'create_public_link')!;
    expect(create.args).toMatchObject({ p_page: page, p_level: 'comment', p_expires: null });
    // Se copió el link: la dirección de la app con el token después del #, nunca en la dirección.
    expect(writes).toHaveLength(1);
    const url = new URL(writes[0]);
    expect(url.pathname).toBe('/');
    expect(url.search).toBe('');
    expect(parseLinkHash(url.hash)).toMatchObject({ u: 'https://znlvpuddswymxpffgvbz.supabase.co', k: 'sb_publishable_testtesttest', t: f.links[0].token });
    expect(host.textContent).toContain('Copy link');
    expect(host.textContent).toContain('Today: opened 4 times · 1 comment · 0.0 MB downloaded');
    // Vence en 7 días.
    pick(host, 'Expires', '7');
    await settle();
    const set = f.calls.find((c) => c.fn === 'set_public_link')!;
    expect(Date.parse(String(set.args.p_expires)) - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    // Reset link: otro token.
    const reset = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Reset link')!;
    await act(async () => reset.click());
    await settle();
    expect(f.calls.some((c) => c.fn === 'reset_public_link')).toBe(true);
    expect(f.links.filter((l) => !l.revoked)).toHaveLength(1);
    expect(f.links[0].revoked).toBe(true);
    // Restricted: lo apaga.
    pick(host, 'General access', 'restricted');
    await settle();
    expect(f.links.every((l) => l.revoked)).toBe(true);
    expect(host.textContent).toContain('Restricted');
  });

  it('el uso de hoy se dice en singular y en plural', async () => {
    const { d, page } = await setup();
    const f = fakeClient({ cleanOn: true, canShare: true });
    f.links.push({ id: 'l1', page_id: page, token: 'sdl_' + 'y'.repeat(43), level: 'comment', expires_at: null, revoked: false });
    f.usage = { open: { n: 1, bytes: 0 }, comment: { n: 2, bytes: 30 } };
    const host = await mount(services(d, f.client), <LinkShare pageId={page} onClose={() => undefined} />);
    expect(host.textContent).toContain('Today: opened 1 time · 2 comments · 0.0 MB downloaded');
    act(() => prefs.set({ language: 'es' }));
    expect(host.textContent).toContain('Hoy: abierto 1 vez · 2 comentarios · 0.0 MB bajados');
    act(() => prefs.set({ language: 'en' }));
  });

  it('On a date… muestra un campo de fecha en la ventana, sin el cuadro del navegador; una fecha pasada no se manda', async () => {
    const { d, page } = await setup();
    const asked = vi.fn(() => '2030-01-01');
    vi.stubGlobal('prompt', asked);
    const f = fakeClient({ cleanOn: true, canShare: true });
    f.links.push({ id: 'l1', page_id: page, token: 'sdl_' + 'y'.repeat(43), level: 'comment', expires_at: null, revoked: false });
    const host = await mount(services(d, f.client), <LinkShare pageId={page} onClose={() => undefined} />);
    const dateRow = () => host.querySelector('[data-link-expiry="date"]');
    const button = (text: string) => [...dateRow()!.querySelectorAll('button')].find((b) => b.textContent === text)!;
    expect(dateRow()).toBeNull();
    pick(host, 'Expires', 'date');
    expect(asked).not.toHaveBeenCalled();
    const input = dateRow()!.querySelector('input[type="date"]') as HTMLInputElement;
    // Propone dentro de 7 días y no deja elegir un día pasado.
    expect(input.value).toBe(dateInDays(7));
    expect(input.min).toBe(dateInDays(0));
    expect(f.calls.some((c) => c.fn === 'set_public_link')).toBe(false);

    setDate(input, '2020-01-01');
    await act(async () => button('Set date').click());
    await settle();
    expect(host.textContent).toContain('Pick a date in the future.');
    expect(f.calls.some((c) => c.fn === 'set_public_link')).toBe(false);

    setDate(dateRow()!.querySelector('input[type="date"]') as HTMLInputElement, '2031-03-09');
    await act(async () => button('Set date').click());
    await settle();
    const set = f.calls.filter((c) => c.fn === 'set_public_link');
    expect(set).toHaveLength(1);
    expect(set[0].args.p_expires).toBe(new Date(2031, 2, 9, 23, 59, 59).toISOString());
    expect(dateRow()).toBeNull();
    expect(host.textContent).not.toContain('Pick a date in the future.');

    // Cancel cierra el campo sin cambiar nada, y se lleva el aviso de la fecha mala.
    pick(host, 'Expires', 'date');
    setDate(dateRow()!.querySelector('input[type="date"]') as HTMLInputElement, '2020-01-01');
    await act(async () => button('Set date').click());
    expect(host.textContent).toContain('Pick a date in the future.');
    await act(async () => button('Cancel').click());
    expect(dateRow()).toBeNull();
    expect(host.textContent).not.toContain('Pick a date in the future.');
    expect(f.calls.filter((c) => c.fn === 'set_public_link')).toHaveLength(1);
  });

  it('volver a Restricted pregunta antes: sin confirmar el link sigue, confirmando se apaga', async () => {
    const { d, page } = await setup();
    const answers = [false, true];
    const asked: string[] = [];
    vi.stubGlobal('confirm', (text: string) => {
      asked.push(text);
      return answers.shift();
    });
    const f = fakeClient({ cleanOn: true, canShare: true });
    f.links.push({ id: 'l1', page_id: page, token: 'sdl_' + 'y'.repeat(43), level: 'comment', expires_at: null, revoked: false });
    const host = await mount(services(d, f.client), <LinkShare pageId={page} onClose={() => undefined} />);
    pick(host, 'General access', 'restricted');
    await settle();
    expect(asked).toEqual(['The current link will stop working for everyone who has it.']);
    expect(f.calls.some((c) => c.fn === 'revoke_public_link')).toBe(false);
    expect(f.links[0].revoked).toBe(false);
    expect((host.querySelector('select[aria-label="General access"]') as HTMLSelectElement).value).toBe('anyone');
    pick(host, 'General access', 'restricted');
    await settle();
    expect(f.links[0].revoked).toBe(true);
  });

  it('con el campo de fecha abierto, apagar el link y prender otro no hace reaparecer el campo con la fecha del anterior', async () => {
    const { d, page } = await setup();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async () => undefined } });
    vi.stubGlobal('confirm', () => true);
    const f = fakeClient({ cleanOn: true, canShare: true });
    f.links.push({ id: 'l1', page_id: page, token: 'sdl_' + 'y'.repeat(43), level: 'comment', expires_at: null, revoked: false });
    const host = await mount(services(d, f.client), <LinkShare pageId={page} onClose={() => undefined} />);
    const dateRow = () => host.querySelector('[data-link-expiry="date"]');
    pick(host, 'Expires', 'date');
    setDate(dateRow()!.querySelector('input[type="date"]') as HTMLInputElement, '2031-03-09');
    pick(host, 'General access', 'restricted');
    await settle();
    expect(f.links[0].revoked).toBe(true);
    expect(dateRow()).toBeNull();
    pick(host, 'General access', 'anyone');
    await settle();
    expect(f.links.filter((l) => !l.revoked)).toHaveLength(1);
    expect(host.textContent).toContain('Copy link');
    expect(dateRow()).toBeNull();
    // El link nuevo no heredó nada de lo que se estaba eligiendo: nadie mandó esa fecha.
    expect(f.calls.some((c) => c.fn === 'set_public_link')).toBe(false);
    // Reset link con el campo abierto: también se cierra (el campo era del link que se acaba de dejar sin efecto).
    pick(host, 'Expires', 'date');
    expect(dateRow()).not.toBeNull();
    const reset = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Reset link')!;
    await act(async () => reset.click());
    await settle();
    expect(dateRow()).toBeNull();
  });

  it('Enter en el campo de fecha confirma como Set date (el campo y el botón son un formulario); con una fecha pasada avisa y no manda nada', async () => {
    const { d, page } = await setup();
    const f = fakeClient({ cleanOn: true, canShare: true });
    f.links.push({ id: 'l1', page_id: page, token: 'sdl_' + 'y'.repeat(43), level: 'comment', expires_at: null, revoked: false });
    const host = await mount(services(d, f.client), <LinkShare pageId={page} onClose={() => undefined} />);
    const input = () => host.querySelector('[data-link-expiry="date"] input[type="date"]') as HTMLInputElement | null;
    // Lo que hace el navegador con Enter en un campo de un formulario con botón de enviar: mandarlo. El botón de
    // enviar es *Set date*, no *Cancel*, y la página no se recarga.
    const enter = () => {
      const form = input()!.closest('form')!;
      expect([...form.querySelectorAll('button')].filter((b) => b.type === 'submit').map((b) => b.textContent)).toEqual(['Set date']);
      const event = new Event('submit', { bubbles: true, cancelable: true });
      act(() => void form.dispatchEvent(event));
      return event;
    };
    pick(host, 'Expires', 'date');
    // La fecha pasada la avisa la ventana (el formulario no usa la validación del navegador, que la frenaría antes).
    expect((input()!.closest('form') as HTMLFormElement).noValidate).toBe(true);
    setDate(input()!, '2020-01-01');
    expect(enter().defaultPrevented).toBe(true);
    await settle();
    expect(host.textContent).toContain('Pick a date in the future.');
    expect(f.calls.some((c) => c.fn === 'set_public_link')).toBe(false);
    expect(input()).not.toBeNull();
    // Enter con una fecha buena: el fin de ese día, una sola vez, y el campo se cierra.
    setDate(input()!, '2031-03-09');
    expect(enter().defaultPrevented).toBe(true);
    await settle();
    const set = f.calls.filter((c) => c.fn === 'set_public_link');
    expect(set).toHaveLength(1);
    expect(set[0].args.p_expires).toBe(new Date(2031, 2, 9, 23, 59, 59).toISOString());
    expect(input()).toBeNull();
    expect(host.textContent).not.toContain('Pick a date in the future.');
  });

  it('dice quién creó el link y cuándo; si esa cuenta ya no está, solo cuándo', async () => {
    const { d, page } = await setup();
    const f = fakeClient({ cleanOn: true, canShare: true });
    f.links.push({ id: 'l1', page_id: page, token: 'sdl_' + 'y'.repeat(43), level: 'comment', expires_at: null, revoked: false });
    const day = new Date('2026-10-02T10:00:00Z').toLocaleDateString();
    const host = await mount(services(d, f.client), <LinkShare pageId={page} onClose={() => undefined} />);
    expect(host.querySelector('[data-link-created]')!.textContent).toBe(`Created by owner on ${day}.`);
    act(() => roots.pop()!.unmount());
    f.state.creator = null;
    const host2 = await mount(services(d, f.client), <LinkShare pageId={page} onClose={() => undefined} />);
    expect(host2.querySelector('[data-link-created]')!.textContent).toBe(`Created on ${day}.`);
    // Sin link propio no hay de quién decirlo.
    f.links[0].revoked = true;
    act(() => roots.pop()!.unmount());
    const host3 = await mount(services(d, f.client), <LinkShare pageId={page} onClose={() => undefined} />);
    expect(host3.querySelector('[data-link-created]')).toBeNull();
  });

  it('el link de una página de arriba se dice con lo que deja hacer: ver o editar', async () => {
    const { d, page } = await setup();
    const f = fakeClient({ cleanOn: true, canShare: true });
    f.state.above = { page_id: 'up', level: 'edit', title: 'Brief' };
    const host = await mount(services(d, f.client), <LinkShare pageId={page} onClose={() => undefined} />);
    expect(host.textContent).toContain('Anyone with the link to “Brief” can edit this page.');
    act(() => roots.pop()!.unmount());
    f.state.above = { page_id: 'up', level: 'comment', title: 'Brief' };
    const host2 = await mount(services(d, f.client), <LinkShare pageId={page} onClose={() => undefined} />);
    expect(host2.textContent).toContain('Anyone with the link to “Brief” can view this page.');
  });

  it('si el link se apagó en otro lado, cambiarlo lo dice en palabras y la ventana muestra cómo quedó', async () => {
    const { d, page } = await setup();
    const f = fakeClient({ cleanOn: true, canShare: true });
    f.links.push({ id: 'l1', page_id: page, token: 'sdl_' + 'y'.repeat(43), level: 'comment', expires_at: null, revoked: false });
    const host = await mount(services(d, f.client), <LinkShare pageId={page} onClose={() => undefined} />);
    f.state.goneOnSet = true;
    pick(host, 'Expires', '7');
    await settle();
    expect(host.textContent).toContain("This link was turned off or reset somewhere else. Here's how it is now.");
    expect(host.textContent).not.toContain('link_not_found');
    expect((host.querySelector('select[aria-label="General access"]') as HTMLSelectElement).value).toBe('restricted');
    expect(host.textContent).not.toContain('Copy link');
  });

  it('un pedido que la base no acepta habla de la fecha solo cuando se mandó una fecha', async () => {
    const { d, page } = await setup();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async () => undefined } });
    vi.stubGlobal('confirm', () => true);
    const f = fakeClient({ cleanOn: true, canShare: true });
    f.links.push({ id: 'l1', page_id: page, token: 'sdl_' + 'y'.repeat(43), level: 'comment', expires_at: null, revoked: false });
    const host = await mount(services(d, f.client), <LinkShare pageId={page} onClose={() => undefined} />);
    f.state.invalid = true;
    // Reset link: no hay ninguna fecha de por medio.
    const reset = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Reset link')!;
    await act(async () => reset.click());
    await settle();
    expect(host.textContent).toContain("The link couldn't be saved. Try again.");
    expect(host.textContent).not.toContain('Pick a date in the future.');
    // Set date con una fecha que para la base ya pasó (el reloj de este dispositivo atrasa): ahí sí es la fecha.
    pick(host, 'Expires', 'date');
    const form = host.querySelector('[data-link-expiry="date"]') as HTMLFormElement;
    setDate(form.querySelector('input[type="date"]') as HTMLInputElement, '2031-03-09');
    await act(async () => [...form.querySelectorAll('button')].find((b) => b.textContent === 'Set date')!.click());
    await settle();
    expect(host.textContent).toContain('Pick a date in the future.');
    expect(host.textContent).not.toContain("The link couldn't be saved.");
  });

  it('los errores propios del link se dicen en palabras; los demás, como los del equipo', () => {
    const text = (message: string) => linkErrorText(t, new RemoteError(message, true, 'P0001'));
    expect(text('page_in_trash')).toContain('Restoring the page turns the link back on');
    expect(text('link_not_found')).toContain('turned off or reset somewhere else');
    expect(text('clean_off')).toContain('Links need the workspace setting');
    expect(text('edit_off')).toContain("Editing through a link isn't turned on");
    // `link_invalid` es la fecha solo si se estaba mandando una; si no (un id repetido al crear o renovar), se prueba de nuevo.
    expect(text('link_invalid')).toBe("The link couldn't be saved. Try again.");
    expect(linkErrorText(t, new RemoteError('link_invalid', true, '22023'), true)).toBe('Pick a date in the future.');
    expect(text('not_allowed')).toBe('You are not allowed to do this.');
  });

  it('una fecha de vencimiento: el fin de ese día, y nunca una del pasado', () => {
    const now = Date.parse('2026-10-02T12:00:00');
    expect(endOfDay('2026-10-05', now)).toBe(new Date(2026, 9, 5, 23, 59, 59).toISOString());
    expect(endOfDay('2026-10-01', now)).toBeNull();
    expect(endOfDay('5/10/2026', now)).toBeNull();
  });
});
