import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeDictationDb, DICTATION_DB } from '../dictation/dictationDb';
import { readVoiceKey, resetTabOnlyVoice, resolveVoice, saveVoiceSettings } from '../dictation/voiceSettings';
import { ASSISTANT_DB, closeAssistantDb, forgetKey, loadSettings, readKey, resetTabOnlyKeys, saveSettings, syncEntries, syncFor } from './keyStore';
import { nextSavedAt, openKey } from './keySync';
import { adoptUnlocked, alsoSync, changePassphrase, needsAnswer, outcomeOf, stopSync, turnOnSync, unlockSync, updateSync, type SyncContext } from './keySyncFlow';
import { KeySyncStore } from './keySyncTesting';

// La entrega S2 de la clave sincronizada (Docs/Doc_Clave_Sincronizada.md, pruebas 6 y 7 de la sección 11): cambiar la
// frase (regla 7), *Keep the key on this device* destildada (nada en la base, nada al recargar), una copia más vieja que
// no se adopta, varias copias en varios workspaces, el `savedAt` que nunca retrocede con un reloj atrasado, y la clave
// de *Voice* que viaja en el mismo sobre (con la regla 6 también para ella).

vi.setConfig({ testTimeout: 30_000 });

const EMAIL = 'lega@wanka.tv';
const UID = 'uid-lega-en-wanka';
const PHRASE = 'acorn-bulb-cider-dove-ember-frost';
const NEW_PHRASE = 'gift-hello-jump-kite-lemon-mango';
const KEY = 'sk-ant-api03-CLAVE-sincronizada-a1B2';
const ANT = { provider: 'anthropic' as const, model: 'claude-haiku-4-5', models: [] };
const VOICE_KEY = 'sk-proj-VOZ-de-la-copia-v0Z9';

afterEach(async () => {
  resetTabOnlyKeys();
  resetTabOnlyVoice();
  await closeAssistantDb();
  await closeDictationDb();
  indexedDB.deleteDatabase(ASSISTANT_DB);
  indexedDB.deleteDatabase(DICTATION_DB);
  vi.restoreAllMocks();
});

function ctx(store: KeySyncStore, ref = 'wanka', userId = UID): SyncContext {
  return { client: store.client(userId), email: EMAIL, userId, ref, name: ref === 'wanka' ? 'Wanka' : 'Cliente' };
}

/** "Otro dispositivo": la misma persona, con las bases del dispositivo vacías. */
async function otherDevice(): Promise<void> {
  resetTabOnlyKeys();
  resetTabOnlyVoice();
  await closeAssistantDb();
  await closeDictationDb();
  indexedDB.deleteDatabase(ASSISTANT_DB);
  indexedDB.deleteDatabase(DICTATION_DB);
}

async function fails(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return outcomeOf(err);
  }
  return 'anduvo';
}

/** Lo que guarda una base del dispositivo, como texto (las claves cifradas, decodificadas tal cual). */
async function dump(name: string): Promise<string> {
  const d = await openDB(name);
  const out: string[] = [];
  for (const store of d.objectStoreNames) {
    for (const v of await d.getAll(store)) out.push(JSON.stringify(v, (_k, x) => (x instanceof ArrayBuffer || ArrayBuffer.isView(x) ? '[bytes]' : x)));
  }
  d.close();
  return out.join('\n');
}

describe('Change passphrase…', () => {
  it('con la frase actual mal no escribe nada (regla 7); con la buena, lo mismo queda cifrado con la nueva', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(ctx(store), PHRASE);
    const before = { ...store.rows.get(UID)! };

    expect(await fails(changePassphrase(ctx(store), 'wrong-words-that-do-not-open', NEW_PHRASE))).toBe('wrong');
    expect(store.rows.get(UID)).toEqual(before);

    const info = await changePassphrase(ctx(store), PHRASE, NEW_PHRASE);
    const row = store.rows.get(UID)!;
    expect(row.generation).toBe(before.generation + 1);
    expect(row.salt).not.toBe(before.salt);
    expect(row.iv).not.toBe(before.iv);
    expect(await fails(openKey(row, PHRASE, UID))).toBe('wrong');
    const opened = await openKey(row, NEW_PHRASE, UID);
    expect(opened).toMatchObject({ provider: 'anthropic', apiKey: KEY });
    expect(opened.savedAt).toBeGreaterThan((await openKey(before, PHRASE, UID)).savedAt);
    // Este dispositivo estaba al día: sigue al día (no le aparece "cambió en otro dispositivo").
    expect(syncFor(await loadSettings(EMAIL), 'wanka', UID)).toMatchObject({ generation: info.generation, savedAt: opened.savedAt });
  });

  it('no sube la clave del dispositivo: si acá se cambió, la copia sigue con la suya y la marca queda', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(ctx(store), PHRASE);
    await saveSettings(EMAIL, ANT, 'sk-ant-api03-LOCAL-L0c4');
    await changePassphrase(ctx(store), PHRASE, NEW_PHRASE);
    expect((await openKey(store.rows.get(UID)!, NEW_PHRASE, UID)).apiKey).toBe(KEY);
    expect(syncFor(await loadSettings(EMAIL), 'wanka', UID)?.localChanged).toBe(true);
  });

  it('el otro dispositivo ve que cambió y la toma con la frase nueva sin preguntar (la clave es la misma)', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(ctx(store), PHRASE);
    await otherDevice();
    await adoptUnlocked(ctx(store), (await unlockSync(ctx(store), PHRASE))!);
    const phone = syncFor(await loadSettings(EMAIL), 'wanka', UID)!;
    // "La PC" cambia la frase: la misma tabla, otra base del dispositivo (otro correo para no mezclar lo guardado).
    await changePassphrase({ ...ctx(store), email: 'pc@otro.dispositivo' }, PHRASE, NEW_PHRASE);
    expect(store.rows.get(UID)!.generation).toBeGreaterThan(phone.generation);
    expect(await fails(unlockSync(ctx(store), PHRASE))).toBe('wrong');
    const again = (await unlockSync(ctx(store), NEW_PHRASE))!;
    expect(again.decision).toBe('adopt');
    await adoptUnlocked(ctx(store), again);
    expect(syncFor(await loadSettings(EMAIL), 'wanka', UID)!.generation).toBe(store.rows.get(UID)!.generation);
  });
});

describe('Change passphrase… desde un dispositivo atrasado (O5)', () => {
  it('si la copia cambió en otro dispositivo antes del clic, este no queda anotado como al día', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(ctx(store), PHRASE);
    // Otro dispositivo (otra base del dispositivo: otro correo) sube otra clave con la misma frase: generación 2.
    await saveSettings('pc@otro.dispositivo', ANT, 'sk-ant-api03-OTRA-o7R8');
    await updateSync({ ...ctx(store), email: 'pc@otro.dispositivo' }, PHRASE);
    expect(store.rows.get(UID)!.generation).toBe(2);
    expect(syncFor(await loadSettings(EMAIL), 'wanka', UID)?.generation).toBe(1);
    await changePassphrase(ctx(store), PHRASE, NEW_PHRASE);
    const after = store.rows.get(UID)!.generation;
    expect(after).toBe(3);
    // Este dispositivo sigue con la generación que abrió: la ventana le va a decir "cambió en otro dispositivo".
    expect(syncFor(await loadSettings(EMAIL), 'wanka', UID)?.generation).toBe(1);
  });
});

describe('una copia más vieja', () => {
  it('un dispositivo que ya abrió una copia rechaza una más vieja que repone el dueño; uno nuevo la abre (no se puede impedir)', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(ctx(store), PHRASE);
    const old = { ...store.rows.get(UID)! };
    // Otro dispositivo sube una clave nueva con la misma frase.
    await saveSettings(EMAIL, ANT, 'sk-ant-api03-NUEVA-n3W4');
    await updateSync(ctx(store), PHRASE);
    await otherDevice();
    await adoptUnlocked(ctx(store), (await unlockSync(ctx(store), PHRASE))!);
    expect(await readKey(EMAIL, { provider: 'anthropic' })).toBe('sk-ant-api03-NUEVA-n3W4');
    // El dueño repone la fila vieja (con una generación más alta, como si fuera un cambio).
    store.rows.set(UID, { ...old, generation: 99 });
    expect(await fails(unlockSync(ctx(store), PHRASE))).toBe('older');
    expect(await readKey(EMAIL, { provider: 'anthropic' })).toBe('sk-ant-api03-NUEVA-n3W4');
    // Un dispositivo nuevo, sin anotación, la abre (es lo que dice el modelo de amenazas: no filtra nada).
    await otherDevice();
    expect((await unlockSync(ctx(store), PHRASE))?.payload.apiKey).toBe(KEY);
  });

  it('el savedAt nuevo nunca queda antes del de la copia, aunque el reloj de este dispositivo esté atrasado', async () => {
    expect(nextSavedAt(100, 50, undefined)).toBe(100);
    expect(nextSavedAt(100, 200)).toBe(201);
    expect(nextSavedAt(100, 200, 300)).toBe(301);
    expect(nextSavedAt(100, Number.NaN)).toBe(100);

    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(ctx(store), PHRASE);
    const first = (await openKey(store.rows.get(UID)!, PHRASE, UID)).savedAt;
    // "Otro dispositivo" con el reloj una hora atrás actualiza la copia.
    await otherDevice();
    await saveSettings(EMAIL, ANT, 'sk-ant-api03-ATRASADO-t1M3');
    const real = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(real - 3_600_000);
    await updateSync(ctx(store), PHRASE);
    vi.restoreAllMocks();
    expect((await openKey(store.rows.get(UID)!, PHRASE, UID)).savedAt).toBeGreaterThan(first);
  });
});

describe('Keep the key on this device destildada', () => {
  it('la clave queda solo en esta pestaña: la base del dispositivo no se toca y al recargar no está', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(ctx(store), PHRASE);
    await otherDevice();
    const unlocked = (await unlockSync(ctx(store), PHRASE))!;
    const saved = await adoptUnlocked(ctx(store), unlocked, { tabOnly: true });
    expect(saved).toMatchObject({ tabOnly: true, hasKey: true, provider: 'anthropic' });
    expect(await readKey(EMAIL, { provider: 'anthropic' })).toBe(KEY);
    expect(await readKey(EMAIL, { provider: 'openai' })).toBe('');
    expect(syncFor(await loadSettings(EMAIL), 'wanka', UID)).toMatchObject({ generation: 1 });
    // Cambiar el modelo y recordar el idioma siguen en la pestaña.
    await saveSettings(EMAIL, { ...ANT, model: 'claude-sonnet-4-5' });
    expect(await readKey(EMAIL, { provider: 'anthropic' })).toBe(KEY);
    expect(await dump(ASSISTANT_DB)).toBe('');
    // "Recargar": no hay clave.
    resetTabOnlyKeys();
    expect(await loadSettings(EMAIL)).toBeNull();
    expect(await readKey(EMAIL, { provider: 'anthropic' })).toBe('');
  });

  it('Forget key la saca de la pestaña', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(ctx(store), PHRASE);
    await otherDevice();
    await adoptUnlocked(ctx(store), (await unlockSync(ctx(store), PHRASE))!, { tabOnly: true });
    await forgetKey(EMAIL);
    expect(await loadSettings(EMAIL)).toBeNull();
    expect(await readKey(EMAIL, { provider: 'anthropic' })).toBe('');
  });
});

describe('Also sync in this workspace', () => {
  it('sube otra copia, independiente; Stop syncing en uno no toca la anotación del otro', async () => {
    const wanka = new KeySyncStore();
    const cliente = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(ctx(wanka), PHRASE);
    await alsoSync(ctx(cliente, 'cliente', 'uid-en-cliente'), PHRASE);
    expect(cliente.rows.get('uid-en-cliente')).toBeDefined();
    expect(syncEntries(await loadSettings(EMAIL)).map((e) => e.ref)).toEqual(['wanka', 'cliente']);
    // Una clave nueva en el dispositivo marca las dos copias.
    await saveSettings(EMAIL, ANT, 'sk-ant-api03-OTRA-o7R8');
    expect(syncEntries(await loadSettings(EMAIL)).map((e) => e.localChanged)).toEqual([true, true]);
    await updateSync(ctx(wanka), PHRASE);
    const s = await loadSettings(EMAIL);
    expect(syncFor(s, 'wanka', UID)?.localChanged).toBeUndefined();
    expect(syncFor(s, 'cliente', 'uid-en-cliente')?.localChanged).toBe(true);
    await stopSync(ctx(cliente, 'cliente', 'uid-en-cliente'));
    expect(syncEntries(await loadSettings(EMAIL)).map((e) => e.ref)).toEqual(['wanka']);
    expect(await readKey(EMAIL, { provider: 'anthropic' })).toBe('sk-ant-api03-OTRA-o7R8');
  });

  it('abrir en otro workspace una copia con otra clave deja marcadas las copias de los otros', async () => {
    const wanka = new KeySyncStore();
    const cliente = new KeySyncStore();
    await saveSettings(EMAIL, ANT, 'sk-ant-api03-DEL-CLIENTE-c1C2');
    await turnOnSync(ctx(cliente, 'cliente', 'uid-en-cliente'), PHRASE);
    await otherDevice();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(ctx(wanka), PHRASE);
    const u = (await unlockSync(ctx(cliente, 'cliente', 'uid-en-cliente'), PHRASE))!;
    expect(u.decision).toBe('replace');
    await adoptUnlocked(ctx(cliente, 'cliente', 'uid-en-cliente'), u);
    const s = await loadSettings(EMAIL);
    expect(syncFor(s, 'wanka', UID)?.localChanged).toBe(true);
    expect(syncFor(s, 'cliente', 'uid-en-cliente')?.localChanged).toBeUndefined();
  });
});

describe('la clave de Voice en el sobre', () => {
  it('viaja cifrada con la del asistente y el otro dispositivo la guarda; nada en claro en la fila', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await saveVoiceSettings(EMAIL, { source: 'own', provider: 'openai', model: 'gpt-4o-mini-transcribe' }, VOICE_KEY);
    await turnOnSync(ctx(store), PHRASE);
    expect(store.sent.join('\n')).not.toContain(VOICE_KEY);
    expect((await openKey(store.rows.get(UID)!, PHRASE, UID)).voice).toEqual({ provider: 'openai', model: 'gpt-4o-mini-transcribe', apiKey: VOICE_KEY });

    await otherDevice();
    const u = (await unlockSync(ctx(store), PHRASE))!;
    expect(needsAnswer(u)).toBe(false);
    await adoptUnlocked(ctx(store), u);
    const voice = await resolveVoice(EMAIL);
    expect(voice).toMatchObject({ provider: 'openai', source: 'own' });
    expect(await readVoiceKey(EMAIL, voice!)).toBe(VOICE_KEY);
  });

  it('regla 6: si la de Voice va a otro lado que la que usa este dispositivo, pregunta', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await saveVoiceSettings(EMAIL, { source: 'own', provider: 'compatible', baseUrl: 'https://voz.atacante.example/v1', model: 'whisper-1' }, 'gsk_AJENA-0000');
    await turnOnSync(ctx(store), PHRASE);
    await otherDevice();
    await saveSettings(EMAIL, ANT, KEY);
    await saveVoiceSettings(EMAIL, { source: 'own', provider: 'openai', model: '' }, 'sk-proj-MIA-m1A2');
    const u = (await unlockSync(ctx(store), PHRASE))!;
    expect(u.decision).toBe('adopt');
    expect(u.voiceAsk).toBe('destination');
    expect(needsAnswer(u)).toBe(true);
    // Con la misma dirección y otra clave, también pregunta (regla 5).
    await saveVoiceSettings(EMAIL, { source: 'own', provider: 'compatible', baseUrl: 'https://voz.atacante.example/v1', model: 'whisper-1' }, 'gsk_MIA-m1A2');
    const again = (await unlockSync(ctx(store), PHRASE))!;
    expect(again.voiceAsk).toBe('key');
    expect(again.voiceLocalEnding).toBe('m1A2');
  });

  it('cambiar la clave de Voice marca la copia para Update; una copia sin Voice no le saca la suya al dispositivo', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(ctx(store), PHRASE);
    await saveVoiceSettings(EMAIL, { source: 'own', provider: 'openai', model: '' }, VOICE_KEY);
    expect(syncFor(await loadSettings(EMAIL), 'wanka', UID)?.localChanged).toBe(true);
    // Solo el modelo de voz: no marca.
    await updateSync(ctx(store), PHRASE);
    await saveVoiceSettings(EMAIL, { source: 'own', provider: 'openai', model: 'whisper-1' });
    expect(syncFor(await loadSettings(EMAIL), 'wanka', UID)?.localChanged).toBeUndefined();

    // Otro dispositivo con su propia clave de voz abre una copia sin Voice: la suya queda.
    const bare = new KeySyncStore();
    await otherDevice();
    await saveSettings(EMAIL, ANT, KEY);
    await turnOnSync(ctx(bare), PHRASE);
    await otherDevice();
    await saveVoiceSettings(EMAIL, { source: 'own', provider: 'gemini', model: '' }, 'AIzaMIA-0000');
    await adoptUnlocked(ctx(bare), (await unlockSync(ctx(bare), PHRASE))!);
    expect(await readVoiceKey(EMAIL, (await resolveVoice(EMAIL))!)).toBe('AIzaMIA-0000');
  });

  it('con Keep the key on this device destildada, la de Voice tampoco se guarda en la base', async () => {
    const store = new KeySyncStore();
    await saveSettings(EMAIL, ANT, KEY);
    await saveVoiceSettings(EMAIL, { source: 'own', provider: 'openai', model: '' }, VOICE_KEY);
    await turnOnSync(ctx(store), PHRASE);
    await otherDevice();
    await adoptUnlocked(ctx(store), (await unlockSync(ctx(store), PHRASE))!, { tabOnly: true });
    expect(await readVoiceKey(EMAIL, (await resolveVoice(EMAIL))!)).toBe(VOICE_KEY);
    expect(await dump(DICTATION_DB)).not.toContain('voice');
    resetTabOnlyVoice();
    resetTabOnlyKeys();
    expect(await resolveVoice(EMAIL)).toBeNull();
  });
});
