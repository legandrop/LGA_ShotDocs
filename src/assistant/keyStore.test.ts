import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { ASSISTANT_DB, closeAssistantDb, forgetKey, hasAssistantKey, loadSettings, readKey, rememberLanguage, saveSettings } from './keyStore';

// La clave del asistente, solo en el dispositivo (Docs/Doc_Asistente.md, sección 4, y prueba 2 de la sección 13):
// cifrada, por correo, *Forget key*, y que la clave en claro no quede en ningún lado de la base.

const KEY = 'sk-ant-api03-CLAVE-de-prueba-0987654321';

afterEach(async () => {
  await closeAssistantDb();
  indexedDB.deleteDatabase(ASSISTANT_DB);
});

const settings = { provider: 'anthropic' as const, model: 'claude-haiku-4-5', models: [{ id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' }] };

/** Todo lo que la base guarda, como texto (para buscar la clave en claro). */
async function dump(): Promise<string> {
  const d = await openDB(ASSISTANT_DB);
  const out: string[] = [];
  for (const store of d.objectStoreNames) {
    for (const value of await d.getAll(store)) {
      out.push(JSON.stringify(value, (_k, v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? new TextDecoder().decode(v as ArrayBuffer) : v)));
    }
  }
  d.close();
  return out.join('\n');
}

describe('la clave en el dispositivo', () => {
  it('se guarda cifrada (nunca en claro en la base) y se descifra justo antes de un pedido', async () => {
    const saved = await saveSettings('Lega@Wanka.tv', settings, KEY);
    expect(saved).toMatchObject({ email: 'lega@wanka.tv', provider: 'anthropic', model: 'claude-haiku-4-5', hasKey: true });
    expect(JSON.stringify(saved)).not.toContain(KEY);
    expect(await dump()).not.toContain(KEY);
    expect(await dump()).not.toContain('CLAVE-de-prueba');
    expect(await readKey('lega@wanka.tv')).toBe(KEY);
    // Lo que ve la app de los ajustes no trae la clave.
    const loaded = await loadSettings('LEGA@wanka.tv');
    expect(loaded).toMatchObject({ hasKey: true, model: 'claude-haiku-4-5' });
    expect(JSON.stringify(loaded)).not.toContain(KEY);
  });

  it('es por correo: otro correo en el mismo dispositivo no la ve', async () => {
    await saveSettings('lega@wanka.tv', settings, KEY);
    expect(await loadSettings('otro@wanka.tv')).toBeNull();
    expect(await readKey('otro@wanka.tv')).toBe('');
    expect(await hasAssistantKey('otro@wanka.tv')).toBe(false);
    expect(await hasAssistantKey('lega@wanka.tv')).toBe(true);
  });

  it('guardar sin clave nueva conserva la de antes; una cadena vacía la saca (un modelo local)', async () => {
    await saveSettings('a@b.c', settings, KEY);
    await saveSettings('a@b.c', { ...settings, model: 'claude-sonnet-5-5' });
    expect(await readKey('a@b.c')).toBe(KEY);
    expect((await loadSettings('a@b.c'))?.model).toBe('claude-sonnet-5-5');
    await saveSettings('a@b.c', { provider: 'compatible', baseUrl: ' http://localhost:11434/v1 ', model: 'llama3', models: [] }, '');
    expect(await readKey('a@b.c')).toBe('');
    expect(await loadSettings('a@b.c')).toMatchObject({ provider: 'compatible', baseUrl: 'http://localhost:11434/v1', hasKey: false });
  });

  it('Forget key la saca del dispositivo; recuerda el último idioma de Translate', async () => {
    await saveSettings('a@b.c', settings, KEY);
    await rememberLanguage('a@b.c', 'es');
    expect((await loadSettings('a@b.c'))?.translateTo).toBe('es');
    await saveSettings('a@b.c', settings);
    expect((await loadSettings('a@b.c'))?.translateTo).toBe('es');
    await forgetKey('a@b.c');
    expect(await loadSettings('a@b.c')).toBeNull();
    expect(await readKey('a@b.c')).toBe('');
    expect(await hasAssistantKey('a@b.c')).toBe(false);
    expect(await dump()).not.toContain(KEY);
  });

  it('dos claves guardadas usan la misma llave del dispositivo, cada una con su propio vector', async () => {
    await saveSettings('a@b.c', settings, KEY);
    await saveSettings('d@e.f', settings, `${KEY}-2`);
    expect(await readKey('a@b.c')).toBe(KEY);
    expect(await readKey('d@e.f')).toBe(`${KEY}-2`);
    const d = await openDB(ASSISTANT_DB);
    expect(await d.count('crypto')).toBe(1);
    const [a, b] = (await d.getAll('keys')) as { iv: Uint8Array }[];
    expect(Buffer.from(a.iv).equals(Buffer.from(b.iv))).toBe(false);
    d.close();
  });
});
