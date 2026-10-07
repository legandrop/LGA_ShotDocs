// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settled } from '../test/settle';
import { closeDictationDb, DICTATION_DB } from '../dictation/dictationDb';
import { addNote, listNotes } from '../dictation/queue';
import { loadVoiceSettings, resetTabOnlyVoice, saveVoiceSettings } from '../dictation/voiceSettings';
import { ServicesContext, type Services } from '../services';
import { AssistantSettings } from './AssistantSettings';
import { closeAssistantDb, loadSettings, readKey, resetTabOnlyKeys, saveSettings, setSyncInfo, syncFor } from './keyStore';
import { openKey } from './keySync';
import { turnOnSync, updateSync } from './keySyncFlow';
import { KeySyncStore } from './keySyncTesting';
import { SignOutDialog } from './SignOutDialog';
import { ProviderError } from './providers';
import { isKeyRejected, SyncedKeyHint } from './SyncedKeyHint';

// La ventana de la entrega S2 (Docs/Doc_Clave_Sincronizada.md, sección 9 y prueba 8 de la 11): *Change passphrase…*,
// *Keep the key on this device*, la copia más vieja, *Also sync in this workspace*, que *Choose a new passphrase…* no
// aparezca cuando la copia cambió en otro dispositivo, el botón en el 401 y la ventana de salir con las notas de voz.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EMAIL = 'lega@wanka.tv';
const UID = 'uid-lega';
const KEY = 'sk-ant-api03-CLAVE-de-la-ventana-a1B2';
const ANT = { provider: 'anthropic' as const, model: 'claude-haiku-4-5', models: [{ id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' }] };
const PHRASE = 'acorn-bulb-cider-dove-ember-frost';
const roots: Root[] = [];

afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  resetTabOnlyKeys();
  resetTabOnlyVoice();
  await closeAssistantDb();
  await closeDictationDb();
  indexedDB.deleteDatabase('shotdocs-assistant');
  indexedDB.deleteDatabase(DICTATION_DB);
  localStorage.clear();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

// El rato pedido y, después, a que termine lo que quedó en marcha (src/test/settle.ts).
const wait = (ms = 30) => act(() => settled(ms));
async function until(check: () => unknown, what: string, tries = 150): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (check()) return;
    await wait(40);
  }
  throw new Error(`no llegó: ${what}`);
}

function services(store: KeySyncStore, ws: { name: string; localKey: string } = { name: 'Wanka', localKey: 'wanka' }, userId = UID) {
  const client = store.client(userId);
  const status = { online: true };
  const engine = { subscribe: () => () => undefined, getStatus: () => status };
  return {
    client,
    user: { id: userId, email: EMAIL },
    workspace: { config: { url: `https://${ws.localKey}.supabase.co`, publishableKey: 'k', ...ws }, client },
    engine,
  } as unknown as Services;
}

function render(node: React.ReactNode, value: Services): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<ServicesContext.Provider value={value}>{node}</ServicesContext.Provider>));
  return host;
}

async function mount(store: KeySyncStore, ws?: { name: string; localKey: string }, userId = UID): Promise<HTMLElement> {
  const host = render(<AssistantSettings />, services(store, ws, userId));
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
function fill(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.requestSubmit();
  });
}
const wanka = (store: KeySyncStore) => ({ client: store.client(UID), email: EMAIL, userId: UID, ref: 'wanka', name: 'Wanka' });

/** Prende la sincronización desde otro "dispositivo" y deja este sin clave. */
async function syncedElsewhere(store: KeySyncStore) {
  await saveSettings(EMAIL, ANT, KEY);
  await turnOnSync(wanka(store), PHRASE);
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

describe('Change passphrase…', () => {
  it('con la frase actual mal no cambia nada; con la buena, la copia abre con la nueva', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(wanka(store), PHRASE);
    const host = await mount(store);
    expect(section(host).textContent).toContain('Synced in Wanka');
    await click(button(host, 'Change passphrase…'));
    expect(section(host).textContent).toContain('Your synced key stays the same; only the passphrase changes.');
    const current = section(host).querySelector<HTMLInputElement>('input[name="current-passphrase"]')!;
    const generated = section(host).querySelector('output')!.textContent!;
    expect(generated.split('-')).toHaveLength(6);
    // Hace falta tildar "I saved my passphrase".
    expect(button(host, 'Change passphrase')!.disabled).toBe(true);
    await click(section(host).querySelector<HTMLInputElement>('.folder-check input')!);
    fill(current, 'wrong-words-that-do-not-open');
    await submit(current.form!);
    await until(() => section(host).textContent?.includes("That passphrase doesn't open your synced key."), 'el error');
    expect(store.rows.get(UID)!.generation).toBe(1);
    expect(current.value).toBe('');
    fill(current, PHRASE);
    await submit(current.form!);
    await until(() => section(host).textContent?.includes('Your passphrase was changed.'), 'cambiada');
    expect(store.rows.get(UID)!.generation).toBe(2);
    expect((await openKey(store.rows.get(UID)!, generated, UID)).apiKey).toBe(KEY);
    // Sigue "Synced in", sin pedir la frase nueva en este dispositivo.
    await until(() => section(host).textContent?.includes('Synced in Wanka'), 'al día');
    expect(section(host).textContent).not.toContain('changed on another device');
  });
});

describe('Keep the key on this device', () => {
  it('destildada, la clave abre solo en esta pestaña y lo dice; nada queda en la base', async () => {
    const store = new KeySyncStore();
    await syncedElsewhere(store);
    const host = await mount(store);
    const keep = [...section(host).querySelectorAll<HTMLLabelElement>('label.folder-check')].find((l) => l.textContent?.includes('Keep the key on this device'))!;
    expect(keep.getAttribute('data-tip')).toBe('Off on a borrowed computer: the key lives only in this tab.');
    expect(keep.hasAttribute('title')).toBe(false);
    const box = keep.querySelector('input')!;
    expect(box.checked).toBe(true);
    await click(box);
    expect(box.checked).toBe(false);
    await unlockWith(host, PHRASE);
    expect(section(host).textContent).toContain('Unlocked: Anthropic key ending in …a1B2.');
    await until(() => section(host).textContent?.includes("This key is only in this tab. If you reload, you'll need your passphrase again."), 'el aviso de la pestaña');
    expect(await readKey(EMAIL, { provider: 'anthropic' })).toBe(KEY);
    const { openDB } = await import('idb');
    const d = await openDB('shotdocs-assistant');
    const kept = d.objectStoreNames.contains('keys') ? await d.getAll('keys') : [];
    d.close();
    expect(kept).toEqual([]);
    resetTabOnlyKeys();
    expect(await loadSettings(EMAIL)).toBeNull();
  });
});

describe('una copia más vieja y la copia que cambió', () => {
  it('This synced copy is older than the one on this device.', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(wanka(store), PHRASE);
    const old = { ...store.rows.get(UID)! };
    await saveSettings(EMAIL, ANT, 'sk-ant-api03-NUEVA-n3W4');
    await updateSync(wanka(store), PHRASE);
    store.rows.set(UID, { ...old, generation: 7 });
    const host = await mount(store);
    expect(section(host).textContent).toContain('Your synced key changed on another device.');
    await unlockWith(host, PHRASE);
    expect(section(host).textContent).toContain('This synced copy is older than the one on this device.');
    expect(await readKey(EMAIL, { provider: 'anthropic' })).toBe('sk-ant-api03-NUEVA-n3W4');
  });

  it('con la copia cambiada en otro dispositivo no ofrece Choose a new passphrase…, ni aunque la clave de acá se haya cambiado (O3)', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(wanka(store), PHRASE);
    store.rows.get(UID)!.generation = 5;
    const host = await mount(store);
    expect(section(host).textContent).toContain('Your synced key changed on another device.');
    expect(button(host, 'Choose a new passphrase…')).toBeUndefined();
    expect(section(host).textContent).not.toContain('Forgot it?');
    for (const r of roots.splice(0)) act(() => r.unmount());
    document.body.innerHTML = '';
    // Una clave pegada acá alguna vez (quizás hace semanas) no habilita pisar la copia más nueva; queda Stop syncing.
    await saveSettings(EMAIL, ANT, 'sk-ant-api03-PEGADA-p4G5');
    const again = await mount(store);
    expect(button(again, 'Choose a new passphrase…')).toBeUndefined();
    expect(button(again, 'Stop syncing')).toBeDefined();
  });
});

describe('correcciones de la auditoría de S2', () => {
  async function tabOnlyUnlocked(store: KeySyncStore): Promise<HTMLElement> {
    const host = await mount(store);
    const box = [...section(host).querySelectorAll<HTMLLabelElement>('label.folder-check')].find((l) => l.textContent?.includes('Keep the key on this device'))!.querySelector('input')!;
    await click(box);
    await unlockWith(host, PHRASE);
    await until(() => section(host).textContent?.includes('This key is only in this tab.'), 'solo en la pestaña');
    return host;
  }

  it('O1: en la computadora prestada, Stop syncing no promete que la clave queda en el dispositivo', async () => {
    const store = new KeySyncStore();
    await syncedElsewhere(store);
    const host = await tabOnlyUnlocked(store);
    await click(button(host, 'Stop syncing'));
    expect(section(host).textContent).toContain("Your key is only in this tab: after you reload, it won't be on this computer.");
    expect(section(host).textContent).not.toContain('Your key stays on this device');
    await click(button(host, 'Delete copy'));
    await until(() => section(host).textContent?.includes('Your key is only in this tab until you reload.'), 'el aviso');
  });

  it('O2: Forget key en modo pestaña olvida solo la de la pestaña; la guardada de antes queda', async () => {
    const store = new KeySyncStore();
    await syncedElsewhere(store);
    await saveSettings(EMAIL, ANT, 'sk-ant-api03-PROPIA-9999');
    const host = await mount(store);
    const box = [...section(host).querySelectorAll<HTMLLabelElement>('label.folder-check')].find((l) => l.textContent?.includes('Keep the key on this device'))!.querySelector('input')!;
    await click(box);
    await unlockWith(host, PHRASE);
    await click(button(host, 'Use it'));
    await until(() => section(host).textContent?.includes('This key is only in this tab.'), 'solo en la pestaña');
    expect(await readKey(EMAIL, { provider: 'anthropic' })).toBe(KEY);
    await click(button(host, 'Forget key'));
    await until(() => host.textContent?.includes('Forgot the key in this tab. The key saved on this device before stays.'), 'el aviso');
    expect(await readKey(EMAIL, { provider: 'anthropic' })).toBe('sk-ant-api03-PROPIA-9999');
    expect((await loadSettings(EMAIL))?.tabOnly).toBeUndefined();
  });

  it('O4: si solo se pregunta por Voice, Keep my voice key toma la del asistente y deja la de Voice', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await saveVoiceSettings(EMAIL, { source: 'own', provider: 'openai', model: '' }, 'sk-proj-VOZ-COPIA-1111');
    await turnOnSync(wanka(store), PHRASE);
    await closeAssistantDb();
    await closeDictationDb();
    indexedDB.deleteDatabase('shotdocs-assistant');
    indexedDB.deleteDatabase(DICTATION_DB);
    await saveVoiceSettings(EMAIL, { source: 'own', provider: 'openai', model: '' }, 'sk-proj-VOZ-MIA-2222');
    const host = await mount(store);
    await unlockWith(host, PHRASE);
    expect(section(host).textContent).toContain('Replace the voice key on this device (…2222) with the synced one (…1111)?');
    await click(button(host, 'Keep my voice key'));
    await until(() => section(host).textContent?.includes('Your current voice key stays on this device.'), 'el aviso');
    expect(section(host).textContent).not.toContain('Your current key stays on this device.');
    expect(await readKey(EMAIL, { provider: 'anthropic' })).toBe(KEY);
    const { readVoiceKey, resolveVoice } = await import('../dictation/voiceSettings');
    expect(await readVoiceKey(EMAIL, (await resolveVoice(EMAIL))!)).toBe('sk-proj-VOZ-MIA-2222');
  });
});

describe('Also sync in this workspace', () => {
  it('con la clave sincronizada en otro workspace: la frase dos veces, que coincidan, y sube otra copia acá', async () => {
    const other = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(wanka(other), PHRASE);
    const store = new KeySyncStore();
    const host = await mount(store, { name: 'Cliente', localKey: 'cliente' }, 'uid-en-cliente');
    expect(section(host).textContent).toContain('Your key is synced in Wanka.');
    expect(button(host, 'Turn on sync…')).toBeUndefined();
    await click(button(host, 'Also sync in this workspace…'));
    expect(section(host).textContent).toContain('Enter the passphrase you use in Wanka, twice. Cliente gets its own encrypted copy.');
    const a = section(host).querySelector<HTMLInputElement>('input[name="passphrase"]')!;
    const b = section(host).querySelector<HTMLInputElement>('input[name="passphrase-repeat"]')!;
    fill(a, PHRASE);
    fill(b, 'acorn-bulb-cider-dove-ember-frosty');
    await submit(a.form!);
    await wait(60);
    expect(section(host).textContent).toContain("The two passphrases don't match.");
    expect(store.rows.size).toBe(0);
    fill(a, PHRASE);
    fill(b, PHRASE);
    await submit(a.form!);
    await until(() => section(host).textContent?.includes('Your key is synced in Cliente.'), 'subida');
    expect((await openKey(store.rows.get('uid-en-cliente')!, PHRASE, 'uid-en-cliente')).apiKey).toBe(KEY);
    const s = await loadSettings(EMAIL);
    expect(syncFor(s, 'wanka', UID)).toBeDefined();
    expect(syncFor(s, 'cliente', 'uid-en-cliente')).toBeDefined();
    await until(() => section(host).textContent?.includes('Synced in Cliente'), 'abierta acá');
  });
});

describe('el botón en el 401', () => {
  it('solo el error de la clave que no sirve lo pide', () => {
    expect(isKeyRejected(new ProviderError('auth', 'x', 401))).toBe(true);
    expect(isKeyRejected(new ProviderError('rateLimit', 'x', 429))).toBe(false);
    expect(isKeyRejected(new Error('auth'))).toBe(false);
  });

  it('con una copia más nueva que la del dispositivo ofrece actualizarla; al día, no; sin copia, no', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(wanka(store), PHRASE);
    const fresh = render(<SyncedKeyHint show />, services(store));
    await wait(120);
    expect(fresh.textContent).toBe('');
    store.rows.get(UID)!.generation = 3;
    const newer = render(<SyncedKeyHint show />, services(store));
    await until(() => newer.textContent?.includes('Enter your passphrase to update it here'), 'el botón');
    const hidden = render(<SyncedKeyHint show={false} />, services(store));
    await wait(120);
    expect(hidden.textContent).toBe('');
    const none = render(<SyncedKeyHint show />, services(new KeySyncStore()));
    await wait(120);
    expect(none.textContent).toBe('');
  });

  it('si el dispositivo nunca abrió la copia, ofrece abrirla', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(wanka(store), PHRASE);
    await setSyncInfo(EMAIL, null);
    const host = render(<SyncedKeyHint show />, services(store));
    await until(() => host.textContent?.includes('Unlock your synced key'), 'el botón');
  });
});

describe('la ventana de salir', () => {
  it('cuenta las notas de voz sin ubicar y, tildada, las borra; si no, quedan', async () => {
    for (const text of ['uno', 'dos', 'tres']) await addNote({ email: EMAIL, workspace: 'wanka', pageId: 'p1', pageTitle: 'Día 1', text });
    await addNote({ email: EMAIL, workspace: 'otro', pageId: 'p2', pageTitle: 'Otro', text: 'de otro workspace' });
    const run = vi.fn(async () => undefined);
    const host = render(<SignOutDialog email={EMAIL} workspace="wanka" run={run} />, {} as Services);
    await until(() => host.textContent?.includes('You have 3 voice notes to place on this device.'), 'el número');
    // Sin clave guardada, no aparece la casilla de la clave.
    expect(host.textContent).not.toContain('Also forget my assistant key');
    await click(button(host, 'Sign out'));
    expect(run).toHaveBeenCalledOnce();
    expect(await listNotes(EMAIL, 'wanka')).toHaveLength(3);

    const host2 = render(<SignOutDialog email={EMAIL} workspace="wanka" run={run} />, {} as Services);
    await until(() => host2.textContent?.includes('You have 3 voice notes'), 'el número');
    const box = [...host2.querySelectorAll('label')].find((l) => l.textContent?.includes('Also delete them'))!.querySelector('input')!;
    expect(box.checked).toBe(false);
    await click(box);
    await click([...host2.querySelectorAll('button')].filter((b) => b.textContent === 'Sign out').at(-1));
    expect(await listNotes(EMAIL, 'wanka')).toHaveLength(0);
    expect(await listNotes(EMAIL, 'otro')).toHaveLength(1);
  });

  it('olvidar la clave olvida también la de Voice (y lo dice)', async () => {
    await saveSettings(EMAIL, ANT, KEY);
    await saveVoiceSettings(EMAIL, { source: 'own', provider: 'openai', model: '' }, 'sk-proj-VOZ-0000');
    const host = render(<SignOutDialog email={EMAIL} workspace="wanka" run={async () => undefined} />, {} as Services);
    await until(() => host.textContent?.includes('It also forgets your voice key.'), 'el aviso');
    const box = [...host.querySelectorAll('label')].find((l) => l.textContent?.includes('Also forget my assistant key'))!.querySelector('input')!;
    await click(box);
    await click(button(host, 'Sign out'));
    expect(await loadSettings(EMAIL)).toBeNull();
    expect(await loadVoiceSettings(EMAIL)).toBeNull();
  });
});

describe('la ayuda', () => {
  it('la entrada de S2 se encuentra en los dos idiomas y nombra los controles como en la ventana', async () => {
    const { searchHelp } = await import('../help/search');
    const { HELP_ENTRIES } = await import('../help/entries');
    const { t } = await import('../i18n');
    const ids = (q: string, lang: 'en' | 'es') => searchHelp(HELP_ENTRIES, q, lang).map((h) => h.entry.id);
    expect(ids('change passphrase', 'en')).toContain('assistantSyncMore');
    expect(ids('computadora prestada', 'es')).toContain('assistantSyncMore');
    expect(ids('also sync', 'en')).toContain('assistantSyncMore');
    const text = t('help.assistantSyncMore.text');
    for (const k of ['assistant.sync.change', 'assistant.sync.keepHere', 'assistant.sync.alsoSync', 'assistant.sync.updateHere'] as const) {
      expect(text).toContain(t(k).replace(/…$/, ''));
    }
  });
});
