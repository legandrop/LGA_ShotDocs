// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readLinks, rememberLink } from '../linkMode';
import type { KeyValueStore } from '../workspaces';
import { LinkApp, SLOW_OPEN_MS } from './LinkApp';

// Abrir el link sin red (Docs/Doc_Link_Publico.md, 3.10): quien ya lo abrió una vez vuelve a ver lo guardado aunque no
// haya señal; con red, un link revocado o vencido se corta sin mostrar nada. La página de verdad (el editor, el motor) se
// cambia por un cartel: lo que se prueba es qué decide `LinkApp` antes de montarla.

vi.mock('./Workspace', async () => {
  const { createElement } = await import('react');
  return { Workspace: () => createElement('div', { id: 'workspace' }, 'WORKSPACE') };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const URL_ = 'https://abcdefghijklmnopqrst.supabase.co';
const KEY = 'sb_publishable_abcdefghij';
let seed = 0;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});
beforeEach(() => localStorage.clear());

/** Un link nuevo en este navegador (cada prueba el suyo: el cliente se guarda por id). */
function entryFor(saved: boolean) {
  seed += 1;
  const token = 'sdl_' + String(seed).padStart(43, 'T');
  const entry = rememberLink({ u: URL_, k: KEY, l: 'wanka_1', t: token }, localStorage as KeyValueStore);
  if (saved) {
    const list = readLinks();
    const e = list.links.find((l) => l.id === entry.id)!;
    e.linkId = 'link-1';
    e.pageId = 'page-1';
    e.title = 'Brief';
    localStorage.setItem('shotdocs-links', JSON.stringify(list));
  }
  return readLinks().links.find((l) => l.id === entry.id)!;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const OPEN = { link_id: 'link-1', page_id: 'page-1', title: 'Brief', level: 'comment', expires_at: null, min_app_version: null, schema_version: 14, clean_on: true, media_url: null, outdated: false };

function stubFetch(handler: () => Promise<Response>) {
  const fn = vi.fn((input: RequestInfo | URL) => {
    if (!String(input).includes('/rest/v1/rpc/plink_open')) return Promise.resolve(json(404, { message: 'link_not_found', code: 'P0002' }));
    return handler();
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function mount(entry: ReturnType<typeof entryFor>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(<LinkApp entry={entry} />);
  });
  // Deja correr los pedidos y sus respuestas.
  for (let i = 0; i < 5; i++) await act(async () => void (await Promise.resolve()));
  return host;
}

describe('abrir un link sin red', () => {
  it('con lo guardado de una visita anterior y sin red: muestra la página guardada y avisa', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const host = await mount(entryFor(true));
    expect(host.textContent).toContain('WORKSPACE');
    expect(host.textContent).toContain("Couldn't reach the server");
    expect(host.textContent).not.toContain('Could not open');
  });

  it('con lo guardado y un servidor que no contesta: pasado el tiempo, la página guardada', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubFetch(() => new Promise<Response>(() => undefined));
    const host = await mount(entryFor(true));
    expect(host.textContent).not.toContain('WORKSPACE');
    await act(async () => void vi.advanceTimersByTime(SLOW_OPEN_MS + 50));
    expect(host.textContent).toContain('WORKSPACE');
    expect(host.textContent).toContain("Couldn't reach the server");
  });

  it('con red y el link revocado o vencido: se corta, sin mostrar lo guardado', async () => {
    stubFetch(() => Promise.resolve(json(404, { message: 'link_not_found', code: 'P0002', details: null, hint: null })));
    const host = await mount(entryFor(true));
    expect(host.textContent).toContain('This link no longer works');
    expect(host.textContent).not.toContain('WORKSPACE');
  });

  it('con red: abre, y guarda el id del link y de la página para la próxima vez sin red', async () => {
    stubFetch(() => Promise.resolve(json(200, OPEN)));
    const entry = entryFor(false);
    const host = await mount(entry);
    expect(host.textContent).toContain('WORKSPACE');
    expect(host.textContent).not.toContain("Couldn't reach the server");
    const saved = readLinks().links.find((l) => l.id === entry.id)!;
    expect([saved.linkId, saved.pageId, saved.title]).toEqual(['link-1', 'page-1', 'Brief']);
  });

  it('la primera vez en este dispositivo y sin red: lo dice con sus palabras (no "Could not open your workspace")', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const host = await mount(entryFor(false));
    expect(host.textContent).toContain('You need a connection to open this link');
    expect(host.textContent).not.toContain('WORKSPACE');
    expect(host.textContent).not.toContain('workspace');
  });

  it('un tope del día al abrir no muestra lo guardado como si nada: lo dice', async () => {
    stubFetch(() => Promise.resolve(json(400, { message: 'link_rate_limited', code: 'P0001', details: 'open', hint: null })));
    const host = await mount(entryFor(true));
    expect(host.textContent).toContain('This link has been used a lot today');
  });
});
