// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prefs } from '../prefs';
import { SyncBadge } from './SyncBadge';
import { forceUpdate, isAppUpdating, setStuck, startAppUpdates, stopAppUpdates, updateNow, type AppUpdates, type ForceDeps } from './appUpdate';
import { shown } from '../test/shown';

vi.mock('../services', () => {
  const status = { online: true, outdated: true, pendingOps: 3, pendingPages: 0, pendingFiles: 0, pendingMedia: 0,
    pendingComments: 0, failedOps: 0, rejectedPages: 0, failedMedia: 0, failedComments: 0, lastSyncAt: 1 };
  const services = { engine: {}, media: {}, comments: {}, remote: {} };
  const tree = {};
  return { useSyncStatus: () => status, useServices: () => services, useTree: () => tree };
});
vi.mock('../dictation/VoiceNotes', () => ({ VoiceNotesNotice: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let updates: AppUpdates;

beforeEach(async () => {
  prefs.set({ language: 'en' });
  updates = startAppUpdates();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<SyncBadge />));
  act(() => host.querySelector<HTMLButtonElement>('.sync-pill')!.click());
});

afterEach(() => {
  act(() => root.unmount());
  stopAppUpdates(updates);
  host.remove();
  vi.restoreAllMocks();
});

function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('el clic de actualizar tiene respuesta mientras espera', () => {
  it('avisa enseguida, conserva la cantidad pendiente y un segundo clic no empieza otro intento', async () => {
    const waiting = deferred();
    const run = vi.spyOn(updates, 'updateNow').mockReturnValue(waiting.promise);
    const button = host.querySelector<HTMLButtonElement>('.sync-details .link')!;
    await act(async () => button.click());
    expect(isAppUpdating()).toBe(true);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent).toBe('Updating…');
    expect(host.querySelector('[role=status]')?.textContent).toBe('Updating the app… Please wait.');
    expect(host.querySelector('.sync-pill')?.textContent).toContain('3 changes waiting');
    expect(host.querySelector('.app-update-spinner')).not.toBeNull();
    const first = updateNow();
    expect(updateNow()).toBe(first);
    act(() => button.click());
    expect(run).toHaveBeenCalledTimes(1);
    // Cerrar y volver a abrir el detalle conserva el intento y su aviso.
    act(() => host.querySelector<HTMLButtonElement>('.sync-pill')!.click());
    expect(host.querySelector('[role=status]')).not.toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('.sync-pill')!.click());
    expect(host.querySelector<HTMLButtonElement>('.sync-details .link')!.disabled).toBe(true);
    await act(async () => { waiting.resolve(); await first; });
    expect(isAppUpdating()).toBe(false);
    expect(host.querySelector('[role=status]')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('.sync-details .link')!.disabled).toBe(false);
  });

  it('si el intento falla se libera el botón y se puede volver a intentar', async () => {
    const waiting = deferred();
    const run = vi.spyOn(updates, 'updateNow').mockReturnValue(waiting.promise);
    let done!: Promise<void>;
    await act(async () => { done = updateNow(); });
    await act(async () => { waiting.reject(new Error('Falla del intento')); await done; });
    expect(isAppUpdating()).toBe(false);
    expect(host.querySelector<HTMLButtonElement>('.sync-details .link')!.disabled).toBe(false);
    run.mockResolvedValue();
    await act(async () => { await updateNow(); });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('un reintento oculta la falla anterior mientras busca y la nueva falla queda a la vista al terminar', async () => {
    act(() => setStuck('failed'));
    const waiting = deferred();
    vi.spyOn(updates, 'updateNow').mockImplementation(async () => { await waiting.promise; setStuck('failed'); });
    let done!: Promise<void>;
    await act(async () => { done = updateNow(); });
    expect(host.textContent).not.toContain("couldn't be installed");
    await act(async () => { waiting.resolve(); await done; });
    expect(host.textContent).toContain("couldn't be installed");
    expect(isAppUpdating()).toBe(false);
  });

  it('forzar también muestra actividad; cancelar antes de recargar termina el aviso y conserva el registro', async () => {
    act(() => setStuck('force'));
    const waiting = deferred();
    const unregister = vi.fn();
    const deps: ForceDeps = {
      container: { getRegistration: async () => ({ unregister }) } as never,
      online: () => true, saved: async () => { await waiting.promise; return false; },
      published: async () => 'index-nuevo.js', confirmDrafts: () => true,
      freeBytes: async () => 100_000_000, markForced: vi.fn(), reload: vi.fn(),
    };
    let done!: ReturnType<typeof forceUpdate>;
    await act(async () => { done = forceUpdate(deps); });
    expect(host.querySelector('[role=status]')).not.toBeNull();
    const actions = Array.from(host.querySelectorAll<HTMLButtonElement>('.sync-details .link')).filter((b) => b.textContent === 'Updating…');
    expect(actions).toHaveLength(2);
    expect(actions.every((b) => b.disabled)).toBe(true);
    await act(async () => { waiting.resolve(); expect(await done).toBe('unsaved'); });
    expect(isAppUpdating()).toBe(false);
    expect(unregister).not.toHaveBeenCalled();
    await shown(() => expect(host.textContent).toContain('Force the update'));
  });
});
