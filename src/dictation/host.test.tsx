// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { navigate, pagePath } from '../router';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { mountEditor, unmountAll, view } from '../ui/collabHarness';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { assistantOpen, closeAssistant, openAssistant, registerAssistantTarget, type AssistantEditor } from '../assistant/assistantUi';
import { rememberPolicyValue } from '../assistant/policyCache';
import { DictationHost } from './DictationHost';
import { closeDictation, dictationOpen, isDictateShortcut } from './dictationUi';
import { closeDictationDb } from './drafts';

// Dónde aparece *Dictate to report* (Docs/Doc_Dictado.md, sección 6; prueba 10.1.12 y 10.1.10): el atajo abre y cierra
// la hoja, el botón del teléfono solo con Editar y sin la política apagada, y el asistente y la hoja no conviven.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const devices: Device[] = [];
const offs: (() => void)[] = [];

afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const off of offs.splice(0)) off();
  closeAssistant();
  closeDictation();
  unmountAll();
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  await closeDictationDb();
  localStorage.clear();
  document.body.innerHTML = '';
  navigate('/', true);
});

const wait = (ms = 20) => act(async () => new Promise((r) => setTimeout(r, ms)));

async function setup(opts: { editable?: boolean } = {}) {
  const device = await makeDevice(new FakeServer());
  devices.push(device);
  const pageId = await device.tree.create(null, 'Día 06');
  const ed = mountEditor(await device.docs.open(pageId, { seed: true }));
  offs.push(registerAssistantTarget({ pageId, view: () => view(ed), editable: () => opts.editable ?? true, editor: () => ed as unknown as AssistantEditor }));
  navigate(pagePath(pageId), true);
  const config = { url: 'https://x.supabase.co', publishableKey: 'k', name: 'Wanka', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) };
  const services = {
    workspace: { config, client: { auth: {} } },
    client: { auth: {} },
    user: { id: device.remote.userId, email: 'lega@wanka.tv' },
    db: device.db,
    tree: device.tree,
    docs: device.docs,
    files: device.files,
    media: device.media,
    engine: device.engine,
    access: device.access,
    remote: device.remote as unknown as SupabaseRemote,
    dbName: 'test',
    mediaDb: device.mediaDb,
    comments: device.comments,
    commentsDb: device.commentsDb,
    sizes: device.sizes,
    offline: device.offline,
    shutdown: async () => undefined,
  } as unknown as Services;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <ServicesContext.Provider value={services}>
        <DictationHost />
      </ServicesContext.Provider>,
    ),
  );
  await wait(50);
  return { host, pageId };
}

const key = (init: KeyboardEventInit) => act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })));

describe('dónde aparece Dictate to report', () => {
  it('el atajo: Ctrl+Alt+Shift+D abre y cierra; con AltGr o sin Shift no', async () => {
    await setup();
    expect(isDictateShortcut({ ctrlKey: true, metaKey: false, altKey: true, shiftKey: true, key: 'D', code: 'KeyD' }, false)).toBe(true);
    expect(isDictateShortcut({ ctrlKey: false, metaKey: true, altKey: true, shiftKey: true, key: 'Î', code: 'KeyD' }, true)).toBe(true);
    expect(isDictateShortcut({ ctrlKey: true, metaKey: false, altKey: true, shiftKey: true, key: 'D', code: 'KeyD' }, true)).toBe(false);
    expect(isDictateShortcut({ ctrlKey: true, metaKey: false, altKey: true, shiftKey: false, key: 'd', code: 'KeyD' }, false)).toBe(false);
    expect(isDictateShortcut({ ctrlKey: true, metaKey: false, altKey: true, shiftKey: true, key: 'D', code: 'KeyD', getModifierState: (k) => k === 'AltGraph' }, false)).toBe(false);
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    await key({ key: 'D', code: 'KeyD', ctrlKey: !mac, metaKey: mac, altKey: true, shiftKey: true });
    expect(dictationOpen()).toBe(true);
    await key({ key: 'D', code: 'KeyD', ctrlKey: !mac, metaKey: mac, altKey: true, shiftKey: true });
    expect(dictationOpen()).toBe(false);
  });

  it('el botón del teléfono: con Editar, abre la hoja; se esconde con la hoja abierta', async () => {
    const { host } = await setup();
    const fab = host.querySelector<HTMLButtonElement>('.dictate-fab');
    expect(fab?.getAttribute('aria-label')).toBe('Dictate to report');
    await act(async () => fab!.click());
    expect(dictationOpen()).toBe(true);
    await wait(50);
    expect(host.querySelector('.dictate-fab')).toBeNull();
  });

  it('el botón del teléfono no aparece con la política del asistente apagada', async () => {
    rememberPolicyValue(WANKA_LOCAL_KEY, 'off');
    const { host } = await setup();
    expect(host.querySelector('.dictate-fab')).toBeNull();
  });

  it('el asistente y la hoja ocupan el mismo lugar: abrir uno cierra el otro', async () => {
    await setup();
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    await key({ key: 'D', code: 'KeyD', ctrlKey: !mac, metaKey: mac, altKey: true, shiftKey: true });
    expect(dictationOpen()).toBe(true);
    await act(async () => void openAssistant());
    await wait(20);
    expect(assistantOpen()).toBe(true);
    expect(dictationOpen()).toBe(false);
    await key({ key: 'D', code: 'KeyD', ctrlKey: !mac, metaKey: mac, altKey: true, shiftKey: true });
    expect(dictationOpen()).toBe(true);
    expect(assistantOpen()).toBe(false);
  });

  it('cambiar de página cierra la hoja', async () => {
    await setup();
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    await key({ key: 'D', code: 'KeyD', ctrlKey: !mac, metaKey: mac, altKey: true, shiftKey: true });
    expect(dictationOpen()).toBe(true);
    await act(async () => navigate('/p/otra'));
    await wait(20);
    expect(dictationOpen()).toBe(false);
  });
});
