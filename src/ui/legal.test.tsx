// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../auth';
import { createWorkspaceClient } from '../workspace';
import { addWorkspace, updateWorkspaces, type DeviceWorkspace } from '../workspaces';
import { App } from './App';
import { Welcome } from './Welcome';

// /privacy y /terms se ven sin sesión: App las muestra antes de crear el cliente del workspace y antes del
// login (Google las revisa sin cuenta). El resto de las direcciones sigue pasando por el workspace.

vi.mock('../workspace', async (importOriginal) => {
  const real = await importOriginal<typeof import('../workspace')>();
  return { ...real, createWorkspaceClient: vi.fn(() => ({}) as ReturnType<typeof real.createWorkspaceClient>) };
});
vi.mock('../auth', async (importOriginal) => {
  const real = await importOriginal<typeof import('../auth')>();
  return { ...real, useAuth: vi.fn(() => ({ status: 'loading' }) as const) };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STUDIO: DeviceWorkspace = {
  id: 'ws_studio1234567890abc',
  url: 'https://abcdefghijklmnopqrst.supabase.co',
  publishableKey: 'sb_publishable_studioKey456',
  localKey: 'ws_studio1234567890abc',
  name: 'Studio',
};

const roots: Root[] = [];
beforeEach(() => {
  localStorage.clear();
  // Un workspace en el dispositivo: si la dirección no fuera pública, la app lo abriría y crearía su cliente.
  updateWorkspaces((l) => addWorkspace(l, STUDIO));
  vi.mocked(createWorkspaceClient).mockClear();
  vi.mocked(useAuth).mockClear();
});
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
});

function mountAt(path: string, node = <App />): HTMLElement {
  history.replaceState(null, '', path);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

function links(host: HTMLElement): string[] {
  return [...host.querySelectorAll<HTMLAnchorElement>('.legal-links a')].map((a) => a.getAttribute('href') ?? '');
}

describe('páginas públicas', () => {
  it('/privacy se ve sin sesión ni cliente del workspace', () => {
    const host = mountAt('/privacy');
    expect(host.querySelector('h1')?.textContent).toBe('Privacy Policy');
    expect(host.textContent).toContain('Limited Use');
    expect(host.textContent).toContain('drive.file');
    expect(host.textContent).toContain('info@lega.com.ar');
    expect(host.querySelector('.legal-nav a[aria-current="page"]')?.getAttribute('href')).toBe('/privacy');
    expect(document.title).toBe('Privacy Policy · LGA Shot Docs');
    expect(createWorkspaceClient).not.toHaveBeenCalled();
    expect(useAuth).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('Sign in');
  });

  it('/terms se ve sin sesión ni cliente del workspace', () => {
    const host = mountAt('/terms/');
    expect(host.querySelector('h1')?.textContent).toBe('Terms of Service');
    expect(host.textContent).toContain('laws of the Argentine Republic');
    expect(host.querySelector('.legal-footer a[href="/privacy"]')).not.toBeNull();
    expect(createWorkspaceClient).not.toHaveBeenCalled();
    expect(useAuth).not.toHaveBeenCalled();
  });

  it('cualquier otra dirección pasa por el workspace y el login', () => {
    const host = mountAt('/trash');
    expect(host.querySelector('.legal-doc')).toBeNull();
    expect(createWorkspaceClient).toHaveBeenCalled();
    expect(useAuth).toHaveBeenCalled();
    expect(host.textContent).toContain('Loading');
  });

  it('la bienvenida enlaza privacidad y condiciones en otra pestaña', () => {
    const host = mountAt('/', <Welcome onAdded={vi.fn()} />);
    expect(links(host)).toEqual(['/privacy', '/terms']);
    for (const a of host.querySelectorAll<HTMLAnchorElement>('.legal-links a')) expect(a.target).toBe('_blank');
  });
});
