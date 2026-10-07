// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readLinks, rememberLink } from '../linkMode';
import { commentsDbName, openCommentsDb, type CommentOp } from '../sync/comments';
import type { KeyValueStore } from '../workspaces';
import { LinkApp, SLOW_OPEN_MS } from './LinkApp';
import { linkDbName } from './LinkEditBar';

// Abrir el link sin red (Docs/Doc_Link_Publico.md, 3.10): quien ya lo abrió una vez vuelve a ver lo guardado aunque no
// haya señal; con red, un link revocado o vencido se corta sin mostrar nada. La página de verdad (el editor, el motor) se
// cambia por un cartel: lo que se prueba es qué decide `LinkApp` antes de montarla.

/** Lo que `LinkApp` le pasa a la app de adentro (el servidor del link y el de sus comentarios). */
const inside = vi.hoisted(() => ({ link: null as { comments: { listComments(pageId: string, since: string | null): Promise<unknown> } } | null }));

vi.mock('./Workspace', async () => {
  const { createElement } = await import('react');
  return {
    Workspace: (props: { link?: typeof inside.link }) => {
      inside.link = props.link ?? null;
      return createElement('div', { id: 'workspace' }, 'WORKSPACE');
    },
  };
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
    if (!String(input).includes('/rest/v1/rpc/plink_open')) return Promise.resolve(json(500, { message: 'link_not_found', code: 'P0002' }));
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

describe('el link dejó de andar con comentarios sin mandar', () => {
  /** Deja en la cola de comentarios de este link (la de este navegador) lo que el visitante escribió y no salió. */
  async function queue(entry: ReturnType<typeof entryFor>, ops: CommentOp[]) {
    const db = await openCommentsDb(commentsDbName(linkDbName(entry)));
    for (const op of ops) await db.add('outbox', { op, attempted: false, failed: false, error: null, queuedAt: 1 });
    db.close();
  }
  const add = (id: string, body: string): CommentOp => ({ kind: 'add', id, pageId: 'page-1', blockId: null, threadId: null, body, at: '2026-10-05T10:00:00Z' });

  it('los muestra enteros y los copia: el último texto de cada uno, sin el que el visitante borró', async () => {
    const entry = entryFor(true);
    await queue(entry, [
      add('c1', 'La toma 12 va de noche.'),
      add('c2', 'Borrador'),
      { kind: 'edit', id: 'c2', pageId: 'page-1', body: 'Falta el plano\ndel puerto.', at: '2026-10-05T10:01:00Z' },
      add('c3', 'Me arrepentí'),
      { kind: 'delete', id: 'c3', pageId: 'page-1', at: '2026-10-05T10:02:00Z' },
      { kind: 'resolve', id: 'c9', pageId: 'page-1', resolved: true, at: '2026-10-05T10:03:00Z' },
    ]);
    const copied: string[] = [];
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async (text: string) => void copied.push(text) } });
    stubFetch(() => Promise.resolve(json(404, { message: 'link_not_found', code: 'P0002', details: null, hint: null })));
    const host = await mount(entry);
    const box = () => host.querySelector('[data-link-unsent-comments]');
    for (let i = 0; i < 40 && !box(); i++) await act(async () => new Promise((r) => setTimeout(r, 10)));
    expect(host.textContent).toContain('This link no longer works');
    expect(box()!.textContent).toContain("2 comments you wrote weren't sent:");
    expect([...box()!.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['La toma 12 va de noche.', 'Falta el plano\ndel puerto.']);
    const button = [...box()!.querySelectorAll('button')].find((b) => b.textContent === 'Copy the text')!;
    await act(async () => button.click());
    for (let i = 0; i < 5; i++) await act(async () => void (await Promise.resolve()));
    expect(copied).toEqual(['La toma 12 va de noche.\n\nFalta el plano\ndel puerto.']);
    expect(box()!.textContent).toContain('Copied');
    // Copiar no saca nada de la cola: siguen ahí.
    const db = await openCommentsDb(commentsDbName(linkDbName(entry)));
    expect(await db.count('outbox')).toBe(6);
    db.close();
  });

  it('sin nada sin mandar no dice nada de comentarios', async () => {
    stubFetch(() => Promise.resolve(json(404, { message: 'link_not_found', code: 'P0002', details: null, hint: null })));
    const host = await mount(entryFor(true));
    for (let i = 0; i < 10; i++) await act(async () => new Promise((r) => setTimeout(r, 10)));
    expect(host.textContent).toContain('This link no longer works');
    expect(host.querySelector('[data-link-unsent-comments]')).toBeNull();
  });
});

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
    stubFetch(() => Promise.resolve(json(500, { message: 'link_not_found', code: 'P0002', details: null, hint: null })));
    const host = await mount(entryFor(true));
    expect(host.textContent).toContain('This link no longer works');
    expect(host.textContent).not.toContain('WORKSPACE');
  });

  it('abierto y andando, si los comentarios contestan que el link ya no anda, la pantalla lo dice', async () => {
    // `plink_open` contesta bien; cualquier otro pedido (acá, la lista de comentarios), que el link no existe.
    stubFetch(() => Promise.resolve(json(200, OPEN)));
    const host = await mount(entryFor(false));
    expect(host.textContent).toContain('WORKSPACE');
    // El servidor de comentarios que recibe la app de adentro es el de verdad, con el aviso conectado a la pantalla.
    await act(async () => {
      await expect(inside.link!.comments.listComments('page-1', null)).rejects.toThrow('link_not_found');
    });
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

describe('el link muerto en la dirección de un archivo (P.30, LF16)', () => {
  const FILE = '0f8fad5b-d9cb-469f-a165-70867728950e';
  afterEach(() => {
    history.replaceState(null, '', '/');
    sessionStorage.clear();
  });

  it('Sign in instead deja de abrir el link en esta pestaña y pasa a la dirección de miembro, sin el token', async () => {
    stubFetch(() => Promise.resolve(json(500, { message: 'link_not_found', code: 'P0002', details: null, hint: null })));
    history.replaceState(null, '', `/f/wanka_1/${FILE}`);
    const entry = entryFor(true);
    sessionStorage.setItem('shotdocs-tab-link', entry.id);
    expect(readLinks().active).toBe(entry.id);
    const host = await mount(entry);
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Sign in instead');
    expect(button).toBeTruthy();
    // jsdom no recarga (lo avisa por consola): alcanza con lo que queda escrito antes de recargar.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => button!.click());
    quiet.mockRestore();
    // Recargar no vuelve al link muerto (O2): ni el de la pestaña ni el último abierto.
    expect(sessionStorage.getItem('shotdocs-tab-link')).toBeNull();
    expect(readLinks().active).toBeNull();
    expect(location.pathname).toBe(`/f/wanka_1/${FILE}`);
    expect(location.hash.startsWith('#ws=')).toBe(true);
    expect(location.hash).not.toContain(entry.token);
  });

  it('en la página de un link (no un archivo), sin Sign in instead', async () => {
    stubFetch(() => Promise.resolve(json(500, { message: 'link_not_found', code: 'P0002', details: null, hint: null })));
    const host = await mount(entryFor(true));
    expect(host.textContent).toContain('This link no longer works');
    expect(host.textContent).not.toContain('Sign in instead');
  });
});
