// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServicesContext, type Services } from '../services';
import { AssistantSettings } from './AssistantSettings';
import { closeAssistantDb, loadSettings, readKey, saveSettings, setSyncInfo } from './keyStore';
import { turnOnSync } from './keySyncFlow';
import { KeySyncStore } from './keySyncTesting';
import { SignOutDialog } from './SignOutDialog';
import { SignOutOthersDialog } from './SignOutOthersDialog';

// La sección *Sync across my devices* de los ajustes del asistente (Docs/Doc_Clave_Sincronizada.md, sección 9 y prueba
// 8 de la sección 11): cada estado de la tabla (sin clave, solo acá, prendida, para abrir, en otro workspace, sin red,
// sin la tabla, la política *Off*), prender con la frase generada o una propia, abrir con la buena y con una mala,
// preguntar ante un destino nuevo (regla 6), actualizar sin pisar con una frase mala (regla 7), dejar de sincronizar,
// *Sign out other devices* y la ventana de salir.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 30_000 });

const EMAIL = 'lega@wanka.tv';
const UID = 'uid-lega';
const KEY = 'sk-ant-api03-CLAVE-de-la-ventana-a1B2';
const ANT = { provider: 'anthropic' as const, model: 'claude-haiku-4-5', models: [{ id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' }] };
const PHRASE = 'acorn-bulb-cider-dove-ember-frost';
const roots: Root[] = [];

afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  await closeAssistantDb();
  indexedDB.deleteDatabase('shotdocs-assistant');
  localStorage.clear();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const wait = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));
async function until(check: () => unknown, what: string, tries = 150): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (check()) return;
    await wait(40);
  }
  throw new Error(`no llegó: ${what}`);
}

function services(store: KeySyncStore, online = true) {
  const client = store.client(UID);
  const status = { online };
  const engine = { subscribe: () => () => undefined, getStatus: () => status };
  return {
    client,
    user: { id: UID, email: EMAIL },
    workspace: { config: { url: 'https://x.supabase.co', publishableKey: 'k', name: 'Wanka', localKey: 'wanka' }, client },
    engine,
  } as unknown as Services;
}

async function mount(store: KeySyncStore, online = true): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <ServicesContext.Provider value={services(store, online)}>
        <AssistantSettings />
      </ServicesContext.Provider>,
    ),
  );
  await until(() => host.querySelector('.assistant-sync'), 'la sección de sincronizar');
  await wait(80);
  return host;
}

const section = (host: HTMLElement) => host.querySelector<HTMLElement>('.assistant-sync')!;
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
async function click(el: HTMLElement | undefined) {
  if (!el) throw new Error('no está el botón');
  await act(async () => {
    el.click();
  });
  await wait(60);
}
/** Escribe en un campo NO controlado (como lo hace la persona: el valor queda en el campo, no en React). */
function fill(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.requestSubmit();
  });
}

/** Prende la sincronización desde otro "dispositivo" (sin la ventana) y deja este sin clave. */
async function syncedElsewhere(store: KeySyncStore, payload: { settings: Parameters<typeof saveSettings>[1]; key: string } = { settings: ANT, key: KEY }) {
  await saveSettings(EMAIL, payload.settings, payload.key);
  await turnOnSync({ client: store.client(UID), email: EMAIL, userId: UID, ref: 'wanka', name: 'Wanka' }, PHRASE);
  await closeAssistantDb();
  indexedDB.deleteDatabase('shotdocs-assistant');
}

async function unlockWith(host: HTMLElement, phrase: string) {
  const field = section(host).querySelector<HTMLInputElement>('#assistant-sync-passphrase')!;
  fill(field, phrase);
  await submit(field.form!);
  await until(() => section(host).querySelector('[role="status"]'), 'la respuesta de Unlock', 200);
  await wait(60);
}

describe('los estados de la sección', () => {
  it('sin clave y sin copia', async () => {
    const host = await mount(new KeySyncStore());
    expect(section(host).textContent).toContain('Save a key first to sync it across your devices.');
    expect(button(host, 'Turn on sync…')).toBeUndefined();
  });

  it('sin red, sin la tabla y con la política Off', async () => {
    await saveSettings(EMAIL, ANT, KEY);
    let host = await mount(new KeySyncStore(), false);
    expect(section(host).textContent).toContain('Syncing your key needs internet.');
    expect(button(host, 'Turn on sync…')).toBeUndefined();
    act(() => roots.pop()!.unmount());

    const missing = new KeySyncStore();
    missing.missing = true;
    host = await mount(missing);
    expect(section(host).textContent).toContain("This workspace's database needs an update to sync your key.");
    act(() => roots.pop()!.unmount());

    const off = new KeySyncStore();
    off.policy = 'off';
    host = await mount(off);
    expect(section(host).textContent).toContain("The owner turned the assistant off in this workspace, so your key can't be synced here.");
    expect(button(host, 'Turn on sync…')).toBeUndefined();
  });

  it('con la política Off se puede abrir una copia que ya existe', async () => {
    const store = new KeySyncStore();
    await syncedElsewhere(store);
    store.policy = 'off';
    const host = await mount(store);
    expect(button(host, 'Unlock')).toBeTruthy();
    expect(button(host, 'Choose a new passphrase…')).toBeUndefined();
  });
});

describe('prender', () => {
  it('con la frase generada: hace falta tildar "I saved my passphrase"; la frase no queda en ningún campo después', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    const host = await mount(store);
    expect(section(host).textContent).toContain('Your key is only on this device.');
    await click(button(host, 'Turn on sync…'));
    const out = section(host).querySelector('output.assistant-phrase')!;
    const phrase = out.textContent!;
    expect(phrase.split('-')).toHaveLength(6);
    // El campo escondido para el gestor de contraseñas lleva la misma frase, con autocomplete="new-password".
    const hidden = section(host).querySelector<HTMLInputElement>('input[type="password"][autocomplete="new-password"]')!;
    expect(hidden.value).toBe(phrase);
    expect(section(host).querySelector<HTMLInputElement>('input[autocomplete="username"]')!.value).toBe('Shot Docs assistant key');
    // *New one* propone otra.
    await click(button(host, 'New one'));
    const second = out.textContent!;
    expect(second).not.toBe(phrase);
    const turnOn = button(host, 'Turn on sync')!;
    expect(turnOn.disabled).toBe(true);
    await click(section(host).querySelector<HTMLInputElement>('.folder-check input')!);
    expect(button(host, 'Turn on sync')!.disabled).toBe(false);
    await submit(section(host).querySelector('form')!);
    await until(() => section(host).textContent?.includes('Your key is synced in Wanka.'), 'sincronizada', 200);
    expect(store.rows.get(UID)?.generation).toBe(1);
    await until(() => section(host).textContent?.includes('Synced in Wanka · updated'), 'el estado prendido');
    // Nada de la frase quedó en un campo ni en la página.
    expect(document.body.innerHTML).not.toContain(second);
    expect((await loadSettings(EMAIL))?.sync).toMatchObject({ ref: 'wanka', name: 'Wanka', userId: UID });
    // Y el aviso de siempre dice que hay una copia cifrada.
    expect(host.textContent).toContain('With sync on, an encrypted copy is stored in Wanka.');
  });

  it('con una frase propia: la regla del largo y que las dos coincidan', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    const host = await mount(store);
    await click(button(host, 'Turn on sync…'));
    await click(button(host, 'Use my own passphrase instead'));
    expect(section(host).textContent).toContain('A passphrase you make up is much easier to guess');
    const [a, b] = [...section(host).querySelectorAll<HTMLInputElement>('input[type="password"]')];
    expect(a.getAttribute('autocapitalize')).toBe('none');
    expect(a.getAttribute('autocorrect')).toBe('off');
    expect(a.getAttribute('spellcheck')).toBe('false');
    fill(a, 'muy corta');
    fill(b, 'muy corta');
    await submit(a.form!);
    expect(section(host).textContent).toContain('At least 20 characters and four words.');
    expect(store.rows.size).toBe(0);
    fill(a, 'mi gato duerme en la terraza');
    fill(b, 'mi gato duerme en la terrasa');
    await submit(a.form!);
    expect(section(host).textContent).toContain("The two passphrases don't match.");
    expect(store.rows.size).toBe(0);
    fill(b, 'mi gato duerme en la terraza');
    await submit(a.form!);
    await until(() => store.rows.size === 1, 'la copia', 200);
  });
});

describe('abrir en otro dispositivo', () => {
  it('con una frase mala no abre; con la buena muestra a dónde va y el final de la clave, y la guarda', async () => {
    const store = new KeySyncStore();
    await syncedElsewhere(store);
    const host = await mount(store);
    expect(section(host).textContent).toMatch(/Your key is synced \(saved .+\)\. Enter your passphrase to use it on this device\./);
    expect(section(host).textContent).toContain('Forgot it? Paste your API key again and choose a new passphrase.');
    const field = section(host).querySelector<HTMLInputElement>('#assistant-sync-passphrase')!;
    expect(field.type).toBe('password');
    expect(field.getAttribute('autocapitalize')).toBe('none');
    await unlockWith(host, 'acorn-bulb-cider-dove-ember-frosty');
    expect(section(host).textContent).toContain("That passphrase doesn't open your synced key.");
    expect(field.value).toBe('');
    expect(await loadSettings(EMAIL)).toBeNull();
    // Con mayúscula inicial (el teclado del iPhone) abre igual.
    await unlockWith(host, 'Acorn-bulb-cider-dove-ember-frost');
    await until(() => section(host).textContent?.includes('Unlocked: Anthropic key ending in …a1B2.'), 'abierta');
    expect(await readKey(EMAIL, { provider: 'anthropic' })).toBe(KEY);
    // El formulario de arriba muestra lo abierto.
    expect(host.querySelector<HTMLSelectElement>('select')!.value).toBe('anthropic');
    await until(() => section(host).textContent?.includes('Synced in Wanka'), 'el estado prendido');
  });

  it('regla 6: si la copia manda la clave a otro lado, pregunta; Keep my current key no cambia nada, Use it la adopta', async () => {
    const store = new KeySyncStore();
    await syncedElsewhere(store, { settings: { provider: 'compatible', baseUrl: 'https://openrouter.ai/api/v1', model: 'm', models: [] }, key: 'sk-or-v1-COPIA-z9Y8' });
    await saveSettings(EMAIL, { provider: 'openai', model: 'gpt-4.1-mini', models: [] }, 'sk-openai-MIA');
    const host = await mount(store);
    await unlockWith(host, PHRASE);
    expect(section(host).textContent).toContain('Unlocked: OpenAI-compatible at openrouter.ai, key ending in …z9Y8.');
    expect(section(host).textContent).toContain('Your synced key now goes to openrouter.ai. Use it?');
    // Todavía no se adoptó nada.
    expect(await readKey(EMAIL, { provider: 'openai' })).toBe('sk-openai-MIA');
    await click(button(host, 'Keep my current key'));
    expect(section(host).textContent).toContain('Your current key stays on this device.');
    expect(await readKey(EMAIL, { provider: 'openai' })).toBe('sk-openai-MIA');
    expect((await loadSettings(EMAIL))?.sync).toBeUndefined();
    await unlockWith(host, PHRASE);
    await click(button(host, 'Use it'));
    await until(() => section(host).textContent?.includes('Synced in Wanka'), 'adoptada');
    expect((await loadSettings(EMAIL))?.provider).toBe('compatible');
    expect(await readKey(EMAIL, { provider: 'compatible', baseUrl: 'https://openrouter.ai/api/v1' })).toBe('sk-or-v1-COPIA-z9Y8');
  });

  it('si el dispositivo sabe que la copia de la persona está en otro workspace, no ofrece Forgot it?', async () => {
    const store = new KeySyncStore();
    await syncedElsewhere(store);
    await saveSettings(EMAIL, ANT, KEY);
    await setSyncInfo(EMAIL, { ref: 'cliente', name: 'Estudio Cliente', userId: 'otro-id', generation: 3, savedAt: 1, unlockedAt: 1 });
    const host = await mount(store);
    expect(section(host).textContent).toContain('Your key is synced in Estudio Cliente.');
    expect(section(host).textContent).not.toContain('Forgot it?');
    expect(button(host, 'Choose a new passphrase…')).toBeUndefined();
    expect(button(host, 'Unlock')).toBeTruthy();
  });

  it('Forgot it?: con la clave pegada de nuevo, una frase nueva pisa la copia', async () => {
    const store = new KeySyncStore();
    await syncedElsewhere(store);
    await saveSettings(EMAIL, ANT, 'sk-ant-api03-PEGADA-de-nuevo');
    const host = await mount(store);
    await click(button(host, 'Choose a new passphrase…'));
    await click(section(host).querySelector<HTMLInputElement>('.folder-check input')!);
    await submit(section(host).querySelector('form')!);
    await until(() => store.rows.get(UID)?.generation === 2, 'la copia nueva', 200);
  });
});

describe('actualizar y dejar de sincronizar', () => {
  async function opened(store: KeySyncStore) {
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync({ client: store.client(UID), email: EMAIL, userId: UID, ref: 'wanka', name: 'Wanka' }, PHRASE);
  }

  it('Update synced key aparece si la clave de este dispositivo cambió; con una frase mala no escribe nada', async () => {
    const store = new KeySyncStore();
    await opened(store);
    await saveSettings(EMAIL, ANT, 'sk-ant-api03-NUEVA-c3D4');
    const host = await mount(store);
    expect(section(host).textContent).toContain('The key on this device is different from the synced one.');
    const before = { ...store.rows.get(UID)! };
    await click(button(host, 'Update synced key'));
    const field = section(host).querySelector<HTMLInputElement>('input[type="password"][autocomplete="current-password"]')!;
    fill(field, 'acorn-bulb-cider-dove-ember-frozen');
    await submit(field.form!);
    await until(() => section(host).textContent?.includes("That passphrase doesn't open your synced key."), 'el error', 200);
    expect(store.rows.get(UID)).toEqual(before);
    const again = section(host).querySelector<HTMLInputElement>('input[type="password"][autocomplete="current-password"]')!;
    fill(again, PHRASE);
    await submit(again.form!);
    await until(() => section(host).textContent?.includes('Your synced key was updated.'), 'actualizada', 200);
    expect(store.rows.get(UID)!.generation).toBe(2);
  });

  it('Stop syncing pide confirmación, borra la copia y la clave queda', async () => {
    const store = new KeySyncStore();
    await opened(store);
    const host = await mount(store);
    await click(button(host, 'Stop syncing'));
    expect(section(host).textContent).toContain('Delete the synced copy from Wanka? Your key stays on this device.');
    expect(store.rows.size).toBe(1);
    await click(button(host, 'Delete copy'));
    await until(() => store.rows.size === 0, 'borrada');
    await until(() => section(host).textContent?.includes('The synced copy was deleted. Your key stays on this device.'), 'el aviso');
    expect(await readKey(EMAIL, { provider: 'anthropic' })).toBe(KEY);
    expect((await loadSettings(EMAIL))?.sync).toBeUndefined();
  });

  it('si otro dispositivo cambió la copia en el medio, avisa y no pisa', async () => {
    const store = new KeySyncStore();
    await opened(store);
    await saveSettings(EMAIL, ANT, 'sk-ant-api03-NUEVA-c3D4');
    const host = await mount(store);
    await click(button(host, 'Update synced key'));
    // Otro dispositivo cambia la copia (la generación sube) después de que este la abrió y antes de que escriba.
    const field = section(host).querySelector<HTMLInputElement>('input[type="password"][autocomplete="current-password"]')!;
    fill(field, PHRASE);
    store.beforeWrite = () => {
      store.beforeWrite = undefined;
      const r = store.rows.get(UID)!;
      store.rows.set(UID, { ...r, generation: r.generation + 1 });
    };
    const realFetch = store.rows.get(UID)!;
    await submit(field.form!);
    await until(() => section(host).textContent?.includes('Your synced key changed on another device. Reload it?'), 'el aviso', 200);
    expect(store.rows.get(UID)!.ciphertext).toBe(realFetch.ciphertext);
    expect(button(host, 'Reload')).toBeTruthy();
  });
});

describe('Sign out other devices y la ventana de salir', () => {
  it('Sign out others llama signOut({ scope: "others" }) del cliente del workspace', async () => {
    const store = new KeySyncStore();
    const client = store.client(UID);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => root.render(<SignOutOthersDialog workspace="Wanka" run={() => client.auth.signOut({ scope: 'others' })} />));
    expect(host.textContent).toContain('Sign out of Wanka on all your other devices?');
    await click(button(host, 'Sign out others'));
    expect(client.auth.signOutCalls).toEqual([{ scope: 'others' }]);
    expect(host.textContent).toContain('Your other devices were signed out.');
  });

  it('la ventana de salir suma que la copia queda en el workspace, solo si hay copia', async () => {
    await saveSettings(EMAIL, ANT, KEY);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => root.render(<SignOutDialog email={EMAIL} run={async () => undefined} />));
    await wait(80);
    expect(host.textContent).not.toContain('Your synced copy stays in this workspace');
    act(() => root.unmount());
    roots.pop();
    await setSyncInfo(EMAIL, { ref: 'wanka', name: 'Wanka', userId: UID, generation: 1, savedAt: 1, unlockedAt: 1 });
    const host2 = document.createElement('div');
    document.body.append(host2);
    const root2 = createRoot(host2);
    roots.push(root2);
    act(() => root2.render(<SignOutDialog email={EMAIL} run={async () => undefined} />));
    await until(() => host2.textContent?.includes('Your synced copy stays in this workspace, protected by your passphrase.'), 'el aviso');
  });
});

describe('la ayuda', () => {
  it('la entrada nueva se encuentra en los dos idiomas, con los pasos del dispositivo perdido', async () => {
    const { searchHelp } = await import('../help/search');
    const { HELP_ENTRIES } = await import('../help/entries');
    const { t } = await import('../i18n');
    const ids = (q: string, lang: 'en' | 'es') => searchHelp(HELP_ENTRIES, q, lang).map((h) => h.entry.id);
    expect(ids('passphrase', 'en')).toContain('assistantSync');
    expect(ids('frase', 'es')).toContain('assistantSync');
    expect(ids('sign out other devices', 'en')).toContain('assistantSync');
    expect(ids('dispositivo perdido', 'es')).toContain('assistantSync');
    const text = t('help.assistantSync.text');
    for (const step of ['Sign out other devices', 'Replace synced key…', 'create a new key at your provider']) expect(text).toContain(step);
  });
});
