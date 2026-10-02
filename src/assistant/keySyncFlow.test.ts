import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASSISTANT_DB, closeAssistantDb, loadSettings, readKey, saveSettings } from './keyStore';
import { adoptUnlocked, outcomeOf, replaceSync, stopSync, turnOnSync, unlockSync, updateSync, type SyncContext } from './keySyncFlow';
import { KeySyncStore } from './keySyncTesting';

// Los pasos de la clave sincronizada con un Supabase falso (Docs/Doc_Clave_Sincronizada.md, pruebas 5, 6, 7 y 10 de
// la sección 11): prender en un dispositivo y abrir en otro, la escritura condicional por generación, la regla 7
// (nunca volver a cifrar sin abrir antes la copia), la regla 6 (un destino nuevo no se adopta solo), que nada en claro
// salga ni quede guardado, y que la base del dispositivo siga en la versión 1 y la lea el código publicado.

const EMAIL = 'lega@wanka.tv';
const UID = 'uid-lega-en-wanka';
const PHRASE = 'acorn-bulb-cider-dove-ember-frost';
const KEY = 'sk-ant-api03-CLAVE-sincronizada-a1B2';
const ANT = { provider: 'anthropic' as const, model: 'claude-haiku-4-5', models: [{ id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' }] };

afterEach(async () => {
  await closeAssistantDb();
  indexedDB.deleteDatabase(ASSISTANT_DB);
  vi.restoreAllMocks();
});

function ctx(store: KeySyncStore, userId = UID): SyncContext {
  return { client: store.client(userId), email: EMAIL, userId, ref: 'wanka', name: 'Wanka' };
}

/** "Otro dispositivo": la misma persona, con la base del dispositivo vacía. */
async function otherDevice(): Promise<void> {
  await closeAssistantDb();
  indexedDB.deleteDatabase(ASSISTANT_DB);
}

async function fails(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return outcomeOf(err);
  }
  return 'anduvo';
}

/** Todo lo que guarda la base del dispositivo, como texto. */
async function dump(): Promise<string> {
  const d = await openDB(ASSISTANT_DB);
  const out: string[] = [];
  for (const name of d.objectStoreNames) {
    for (const v of await d.getAll(name)) {
      out.push(JSON.stringify(v, (_k, x) => (x instanceof ArrayBuffer || ArrayBuffer.isView(x) ? new TextDecoder().decode(x as ArrayBuffer) : x)));
    }
  }
  d.close();
  return out.join('\n');
}

describe('prender y abrir en otro dispositivo', () => {
  it('prende con la clave del dispositivo y la abre otro con la frase; la clave queda en el dispositivo como siempre', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    const info = await turnOnSync(ctx(store), PHRASE);
    expect(info).toMatchObject({ ref: 'wanka', name: 'Wanka', userId: UID, generation: 1 });
    expect((await loadSettings(EMAIL))?.sync).toMatchObject({ ref: 'wanka', generation: 1 });

    await otherDevice();
    expect(await loadSettings(EMAIL)).toBeNull();
    const unlocked = await unlockSync(ctx(store), PHRASE);
    expect(unlocked?.decision).toBe('adopt');
    expect(unlocked?.payload).toMatchObject({ provider: 'anthropic', apiKey: KEY, model: 'claude-haiku-4-5' });
    const saved = await adoptUnlocked(ctx(store), unlocked!);
    expect(saved).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-4-5', hasKey: true });
    expect(saved.sync).toMatchObject({ ref: 'wanka', userId: UID, generation: 1, savedAt: info.savedAt });
    expect(await readKey(EMAIL, { provider: 'anthropic' })).toBe(KEY);
  });

  it('una frase equivocada no abre y no guarda nada', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(ctx(store), PHRASE);
    await otherDevice();
    expect(await fails(unlockSync(ctx(store), 'acorn-bulb-cider-dove-ember-frosty'))).toBe('wrong');
    expect(await loadSettings(EMAIL)).toBeNull();
  });

  it('sin copia, sin tabla, sin red, y la copia de otra persona', async () => {
    const store = new KeySyncStore();
    expect(await unlockSync(ctx(store), PHRASE)).toBeNull();
    await saveSettings(EMAIL, ANT, KEY);
    store.missing = true;
    expect(await fails(turnOnSync(ctx(store), PHRASE))).toBe('missing');
    store.missing = false;
    store.online = false;
    expect(await fails(turnOnSync(ctx(store), PHRASE))).toBe('offline');
    expect(await fails(unlockSync(ctx(store), PHRASE))).toBe('offline');
    store.online = true;
    await turnOnSync(ctx(store), PHRASE);
    // Otra persona (otra sesión) no ve la copia; y la fila copiada con otro id no abre (la cabecera ata el id).
    expect(await unlockSync(ctx(store, 'otra-persona'), PHRASE)).toBeNull();
    store.rows.set('otra-persona', { ...store.rows.get(UID)!, user_id: 'otra-persona' });
    expect(await fails(unlockSync(ctx(store, 'otra-persona'), PHRASE))).toBe('wrong');
  });

  it('sin clave guardada no se prende', async () => {
    expect(await fails(turnOnSync(ctx(new KeySyncStore()), PHRASE))).toBe('noLocalKey');
  });
});

describe('regla 6: un destino nuevo no se adopta solo', () => {
  it('si el dispositivo usa otro proveedor u otra dirección, pregunta; con el mismo, o sin clave, no', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, { provider: 'compatible', baseUrl: 'https://servidor-ajeno.example/v1', model: 'x', models: [] }, 'sk-ajena');
    await turnOnSync(ctx(store), PHRASE);
    await otherDevice();
    // Este dispositivo usa Anthropic: la copia manda la clave a otro lado.
    await saveSettings(EMAIL, ANT, KEY);
    const unlocked = await unlockSync(ctx(store), PHRASE);
    expect(unlocked?.decision).toBe('ask');
    expect(unlocked?.payload.baseUrl).toBe('https://servidor-ajeno.example/v1');
    // Hasta que la persona diga que sí, la clave del dispositivo sigue igual.
    expect(await readKey(EMAIL, { provider: 'anthropic' })).toBe(KEY);
    // Otra dirección del mismo proveedor compatible también pregunta.
    await saveSettings(EMAIL, { provider: 'compatible', baseUrl: 'https://openrouter.ai/api/v1', model: 'y', models: [] }, 'sk-or');
    expect((await unlockSync(ctx(store), PHRASE))?.decision).toBe('ask');
    // La misma dirección: se adopta, y el modelo del dispositivo se queda.
    await saveSettings(EMAIL, { provider: 'compatible', baseUrl: 'https://servidor-ajeno.example/v1/', model: 'mio', models: [] }, 'sk-vieja');
    const same = await unlockSync(ctx(store), PHRASE);
    expect(same?.decision).toBe('adopt');
    expect((await adoptUnlocked(ctx(store), same!)).model).toBe('mio');
    expect(await readKey(EMAIL, { provider: 'compatible', baseUrl: 'https://servidor-ajeno.example/v1' })).toBe('sk-ajena');
  });
});

describe('dos dispositivos y la regla 7', () => {
  async function twoDevices() {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(ctx(store), PHRASE);
    return store;
  }

  it('Update synced key con la frase buena sube la clave nueva y la generación', async () => {
    const store = await twoDevices();
    await saveSettings(EMAIL, ANT, 'sk-ant-api03-NUEVA-c3D4');
    expect((await loadSettings(EMAIL))?.sync?.localChanged).toBe(true);
    const info = await updateSync(ctx(store), PHRASE);
    expect(info.generation).toBe(2);
    expect((await loadSettings(EMAIL))?.sync?.localChanged).toBeUndefined();
    await otherDevice();
    expect((await unlockSync(ctx(store), PHRASE))?.payload.apiKey).toBe('sk-ant-api03-NUEVA-c3D4');
  });

  it('Update y Replace con una frase que no abre la copia no escriben nada', async () => {
    const store = await twoDevices();
    const before = { ...store.rows.get(UID)! };
    await saveSettings(EMAIL, ANT, 'sk-ant-api03-NUEVA-c3D4');
    expect(await fails(updateSync(ctx(store), 'acorn-bulb-cider-dove-ember-frozen'))).toBe('wrong');
    expect(await fails(replaceSync(ctx(store), 'acorn-bulb-cider-dove-ember-frozen', 'gift-hello-jump-kite-lemon-mango'))).toBe('wrong');
    expect(store.rows.get(UID)).toEqual(before);
    // Con la buena, Replace cambia la frase: la vieja ya no abre y la nueva sí.
    await replaceSync(ctx(store), PHRASE, 'gift-hello-jump-kite-lemon-mango');
    await otherDevice();
    expect(await fails(unlockSync(ctx(store), PHRASE))).toBe('wrong');
    expect((await unlockSync(ctx(store), 'gift-hello-jump-kite-lemon-mango'))?.payload.apiKey).toBe('sk-ant-api03-NUEVA-c3D4');
  });

  it('la escritura condicional: si otro dispositivo cambió la copia en el medio, no se pisa', async () => {
    const store = await twoDevices();
    // El otro dispositivo cambia la copia (generación 2) mientras este tenía leída la 1.
    const client = ctx(store).client;
    const gen1 = store.rows.get(UID)!.generation;
    await updateSync(ctx(store), PHRASE);
    const after = { ...store.rows.get(UID)! };
    const { updateSyncRow } = await import('./keySyncRemote');
    expect(await fails(updateSyncRow(client, UID, gen1, { format: 1, salt: after.salt, iv: after.iv, ciphertext: after.ciphertext.replace(/^./, 'Z') }))).toBe('conflict');
    expect(store.rows.get(UID)).toEqual(after);
    // Prender otra vez cuando ya hay copia (otro dispositivo la creó): tampoco pisa.
    expect(await fails(turnOnSync(ctx(store), 'gift-hello-jump-kite-lemon-mango'))).toBe('conflict');
    expect(store.rows.get(UID)).toEqual(after);
  });

  it('Forgot it?: pisa la copia que no se puede abrir solo si sigue en la generación que se vio', async () => {
    const store = await twoDevices();
    const gen = store.rows.get(UID)!.generation;
    await turnOnSync(ctx(store), 'gift-hello-jump-kite-lemon-mango', { generation: gen });
    expect(store.rows.get(UID)!.generation).toBe(gen + 1);
    expect(await fails(turnOnSync(ctx(store), 'otra-frase-cualquiera-de-seis-palabras', { generation: gen }))).toBe('conflict');
  });
});

describe('dejar de sincronizar', () => {
  it('borra la copia y la clave del dispositivo queda', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(ctx(store), PHRASE);
    await stopSync(ctx(store));
    expect(store.rows.size).toBe(0);
    expect((await loadSettings(EMAIL))?.sync).toBeUndefined();
    expect(await readKey(EMAIL, { provider: 'anthropic' })).toBe(KEY);
  });

  it('borrar la copia de un workspace no toca la anotación de la copia de otro', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(ctx(store), PHRASE);
    const other = new KeySyncStore();
    await stopSync({ ...ctx(other), ref: 'cliente', name: 'Cliente' });
    expect((await loadSettings(EMAIL))?.sync?.ref).toBe('wanka');
  });
});

describe('nada en claro sale ni queda guardado (prueba 5)', () => {
  it('ni la frase ni la clave ni la dirección van a la base; la frase y la clave no quedan en el dispositivo ni en la consola', async () => {
    const logs: string[] = [];
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
    const store = new KeySyncStore();
    const BASE = 'https://direccion-secreta.example/v1';
    await saveSettings(EMAIL, { provider: 'compatible', baseUrl: BASE, model: 'x', models: [] }, KEY);
    await turnOnSync(ctx(store), PHRASE);
    await updateSync(ctx(store), PHRASE);
    await otherDevice();
    await expect(unlockSync(ctx(store), 'frase-equivocada-de-seis-palabras-aqui')).rejects.toThrow();
    const u = await unlockSync(ctx(store), PHRASE);
    await adoptUnlocked(ctx(store), u!);
    await replaceSync(ctx(store), PHRASE, 'gift-hello-jump-kite-lemon-mango');
    const sent = store.sent.join('\n') + JSON.stringify([...store.rows.values()]);
    for (const secret of [PHRASE, 'gift-hello', KEY, 'direccion-secreta', 'compatible']) expect(sent).not.toContain(secret);
    const saved = await dump();
    for (const secret of [PHRASE, 'gift-hello', KEY]) expect(saved).not.toContain(secret);
    for (const secret of [PHRASE, KEY, BASE]) expect(logs.join('\n')).not.toContain(secret);
    expect(typeof localStorage === 'undefined' || !JSON.stringify({ ...localStorage }).includes(KEY)).toBe(true);
  });
});

describe('el dispositivo (prueba 6)', () => {
  it('la base sigue en la versión 1 y el código publicado (abrirla con la versión 1, leer y descifrar) lee la clave abierta', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(ctx(store), PHRASE);
    await otherDevice();
    await adoptUnlocked(ctx(store), (await unlockSync(ctx(store), PHRASE))!);
    await closeAssistantDb();
    // Como keyStore.ts de v0.129: openDB(…, 1), el registro por correo y la llave del dispositivo.
    const d = await openDB(ASSISTANT_DB, 1);
    expect(d.version).toBe(1);
    const r = await d.get('keys', EMAIL);
    const { key } = await d.get('crypto', 'aes');
    const plain = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: r.iv }, key, r.cipher));
    expect(plain).toBe(KEY);
    expect(r).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-4-5' });
    // Una versión vieja rehace el registro sin `sync`: la nueva sigue andando y no ve copia de origen.
    const { sync: _s, ...old } = r;
    await d.put('keys', { ...old, savedAt: Date.now() });
    d.close();
    expect(await loadSettings(EMAIL)).toMatchObject({ hasKey: true, provider: 'anthropic' });
    expect((await loadSettings(EMAIL))?.sync).toBeUndefined();
    expect(await readKey(EMAIL, { provider: 'anthropic' })).toBe(KEY);
  });

  it('cambiar solo el modelo no marca la clave como distinta de la copia', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(ctx(store), PHRASE);
    await saveSettings(EMAIL, { ...ANT, model: 'otro-modelo' });
    expect((await loadSettings(EMAIL))?.sync?.localChanged).toBeUndefined();
    await saveSettings(EMAIL, { provider: 'openai', model: 'gpt', models: [] }, 'sk-openai');
    expect((await loadSettings(EMAIL))?.sync?.localChanged).toBe(true);
  });
});
