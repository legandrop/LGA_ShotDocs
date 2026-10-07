// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServicesContext, type Services } from '../services';
import { settled } from '../test/settle';
import { AssistantSettings } from './AssistantSettings';
import { closeAssistantDb, loadSettings, saveSettings } from './keyStore';

// Los ajustes del asistente con un proveedor compatible (Docs/Doc_Asistente.md, sección 4; IA1, D-06): la clave
// guardada para una Base URL nunca sale hacia otra. Cambiar la dirección vacía el campo de la clave, *Test* no la manda
// y *Save* no la conserva.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EMAIL = 'lega@wanka.tv';
const KEY = 'sk-or-v1-CLAVE-guardada-para-A-7777';
const A = 'https://openrouter.ai/api/v1';
const B = 'https://otro-servicio.example/v1';
const roots: Root[] = [];

afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  await closeAssistantDb();
  indexedDB.deleteDatabase('shotdocs-assistant');
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

// El rato pedido y, después, a que termine lo que quedó en marcha (src/test/settle.ts): la pantalla lee sus ajustes de
// la base del dispositivo, y con la máquina cargada un rato fijo se cumplía antes de que terminara de leerlos.
const wait = (ms = 30) => act(() => settled(ms));

/** Un `fetch` que contesta la lista de modelos y anota a dónde fue cada pedido y con qué `Authorization`. */
function provider() {
  const calls: { url: string; authorization: string | undefined }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const h = (init.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(input), authorization: h.authorization ?? h.Authorization });
      return new Response(JSON.stringify({ data: [{ id: 'modelo-1' }] }), { status: 200 });
    }),
  );
  return calls;
}

async function mount(extra: Partial<Services> = {}): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <ServicesContext.Provider value={{ user: { id: 'u1', email: EMAIL }, ...extra } as unknown as Services}>
        <AssistantSettings />
      </ServicesContext.Provider>,
    ),
  );
  await wait(80);
  return host;
}

const button = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
const urlInput = (host: HTMLElement) => host.querySelector<HTMLInputElement>('input[type="url"]')!;
const keyInput = (host: HTMLElement) => host.querySelector<HTMLInputElement>('#assistant-key')!;

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await wait(60);
}

describe('los ajustes de un proveedor compatible', () => {
  const nvidiaServices = () => ({
    workspace: { config: { localKey: 'isla-sintetica' } },
    client: { from: () => ({ select: () => ({ maybeSingle: async () => ({ data: { media_url: 'https://portero.example' }, error: null }) }) }),
      auth: { getSession: async () => ({ data: { session: { access_token: 'sesion-sintetica' } } }) } },
  }) as unknown as Partial<Services>;
  it('Test NVIDIA sin clave conserva el aviso y no consulta el catálogo ni guarda ajustes', async () => {
    const id = 'a'.repeat(64), paths: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      const path = new URL(String(url)).pathname; paths.push(path);
      const prepare = path.endsWith('/prepare');
      return new Response(JSON.stringify(prepare
        ? { v: 1, id, capability: 'C'.repeat(43), prepareExpiresAt: 30000, retentionExpiresAt: 600000 }
        : { v: 1, id, state: 'stopped', rootAborted: true, cleanupJoined: true }), { status: prepare ? 201 : 200 });
    }));
    const host = await mount(nvidiaServices()); await click(button(host, 'Test'));
    expect(host.querySelector('[role="status"]')?.textContent).toContain('NVIDIA');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('key');
    expect(paths).toEqual(['/assistant/nvidia/prepare', '/assistant/nvidia/stop']);
    expect(await loadSettings(EMAIL)).toBeNull();
  });
  it('Test NVIDIA muestra la conexión al portero sin sugerir un modelo local', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const host = await mount(nvidiaServices()); await click(button(host, 'Test'));
    const message = host.querySelector('[role="status"]')?.textContent;
    expect(message).toContain('workspace’s NVIDIA gateway'); expect(message).not.toContain('local model');
    expect(button(host, 'Test').disabled).toBe(false); expect(await loadSettings(EMAIL)).toBeNull();
  });
  it.each(['moonshotai/kimi-k3', 'z-ai/glm-5.3'])('T27: guardar y reabrir el modelo manual %s conserva clave y ajustes', async model => {
    await saveSettings(EMAIL, { provider: 'nvidia', model: 'qwen/qwen3.5-122b-a10b', models: [] }, KEY);
    const calls = provider();
    const host = await mount();
    const before = await loadSettings(EMAIL);
    await type(host.querySelector<HTMLInputElement>('input[list="assistant-models"]')!, model);
    await click(button(host, 'Test'));
    expect(await loadSettings(EMAIL)).toEqual(before);
    expect(calls).toHaveLength(0); // Sin portero configurado: Test falla, nunca reescribe lo guardado.
    expect(await loadSettings(EMAIL)).toEqual(before);
    await click(button(host, 'Save'));
    for (const r of roots.splice(0)) act(() => r.unmount());
    const reopened = await mount();
    expect(reopened.querySelector<HTMLInputElement>('input[list="assistant-models"]')!.value).toBe(model);
    expect(await loadSettings(EMAIL)).toMatchObject({ provider: 'nvidia', model, hasKey: true, models: [] });
    expect(calls).toHaveLength(0);
  });

  it('con la misma dirección, Test usa la clave guardada', async () => {
    await saveSettings(EMAIL, { provider: 'compatible', baseUrl: A, model: 'modelo-1', models: [] }, KEY);
    const calls = provider();
    const host = await mount();
    expect(urlInput(host).value).toBe(A);
    expect(keyInput(host).placeholder).toBe('Saved on this device');
    expect(host.textContent).toContain('is sent only to openrouter.ai');
    await click(button(host, 'Test'));
    expect(calls).toEqual([{ url: `${A}/models`, authorization: `Bearer ${KEY}` }]);
  });

  it('si cambia la Base URL: el campo queda vacío, Test no manda la clave guardada y Save no la conserva', async () => {
    await saveSettings(EMAIL, { provider: 'compatible', baseUrl: A, model: 'modelo-1', models: [] }, KEY);
    const calls = provider();
    const host = await mount();
    await type(urlInput(host), B);
    expect(keyInput(host).placeholder).not.toBe('Saved on this device');
    expect(host.textContent).toContain('is sent only to otro-servicio.example');
    await click(button(host, 'Test'));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${B}/models`);
    expect(calls[0].authorization).toBeUndefined();
    await click(button(host, 'Save'));
    expect(calls.every((c) => !c.authorization?.includes(KEY))).toBe(true);
    expect(await loadSettings(EMAIL)).toMatchObject({ provider: 'compatible', baseUrl: B, hasKey: false });
  });
});
