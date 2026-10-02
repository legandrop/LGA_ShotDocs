// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServicesContext, type Services } from '../services';
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

const wait = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));

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

async function mount(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <ServicesContext.Provider value={{ user: { id: 'u1', email: EMAIL } } as unknown as Services}>
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
