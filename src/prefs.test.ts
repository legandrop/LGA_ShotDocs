// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prefs } from './prefs';

// Las preferencias de la cuenta con versiones viejas de la app y sin red (D-16): el idioma no vuelve al del
// navegador por una pestaña o una copia de una versión que no lo conoce, y un cambio hecho antes de leer la
// cuenta no la pisa con lo de fábrica.

const USER = 'u1';
const OLD_KEYS = { theme: 'system', font: 'default', textSize: 'normal', pageWidth: 'normal' };

describe('expansión de subpáginas en la cuenta', () => {
  it('arranca al hacer clic y descarta valores desconocidos de la preferencia', async () => {
    const { cleanPrefs, DEFAULT_PREFS } = await import('./prefs');
    expect(DEFAULT_PREFS.expandSubpages).toBe('onClick');
    expect(cleanPrefs({ expandSubpages: 'recursive' }).expandSubpages).toBe('onClick');
    expect(cleanPrefs({ expandSubpages: 'manual' }).expandSubpages).toBe('manual');
  });

  it('guarda sin red y sube la elección al volver, sin reemplazar lo demás de la cuenta', async () => {
    const prefs = await store();
    const fake = fakeClient({ ...OLD_KEYS, theme: 'dark', expandSubpages: 'onClick' } as Partial<Prefs>);
    await prefs.attach(fake.client, USER);
    fake.state.online = false;
    prefs.set({ expandSubpages: 'manual' });
    await flush();
    expect(prefs.hasUnsynced()).toBe(true);
    expect(JSON.parse(localStorage.getItem('shotdocs-prefs')!).prefs.expandSubpages).toBe('manual');
    const reopened = await store();
    expect(reopened.get().expandSubpages).toBe('manual');
    fake.state.online = true;
    await reopened.attach(fake.client, USER);
    await flush();
    expect(fake.state.pushed.at(-1)).toMatchObject({ theme: 'dark', expandSubpages: 'manual' });
    expect(reopened.hasUnsynced()).toBe(false);
  });

  it('leer una cuenta escrita por una versión sin la clave conserva Manual en este dispositivo', async () => {
    localStorage.setItem('shotdocs-prefs', JSON.stringify({ userId: USER, prefs: { ...OLD_KEYS, expandSubpages: 'manual' }, dirty: false }));
    const prefs = await store();
    const fake = fakeClient(OLD_KEYS as Partial<Prefs>);
    await prefs.attach(fake.client, USER);
    expect(prefs.get().expandSubpages).toBe('manual');
  });
});

/** Un cliente de Supabase mínimo: la fila de `user_settings` en memoria, con o sin red. */
function fakeClient(account: Partial<Prefs> | null) {
  const state = { account: account as unknown, online: true, reads: 0, pushed: [] as Prefs[] };
  let release: (() => void) | null = null;
  let gate: Promise<void> | null = null;
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            state.reads++;
            if (gate) await gate;
            if (!state.online) return { data: null, error: { message: 'Failed to fetch' } };
            return { data: state.account ? { prefs: state.account } : null, error: null };
          },
        }),
      }),
      update: (row: { prefs: Prefs }) => ({
        eq: () => ({
          select: async () => {
            if (!state.online) return { data: null, error: { message: 'Failed to fetch' }, status: 0 };
            state.pushed.push(row.prefs);
            state.account = row.prefs;
            return { data: [{ user_id: USER }], error: null, status: 200 };
          },
        }),
      }),
      insert: async (row: { prefs: Prefs }) => {
        if (!state.online) return { error: { message: 'Failed to fetch' }, status: 0 };
        state.pushed.push(row.prefs);
        state.account = row.prefs;
        return { error: null, status: 201 };
      },
    }),
  };
  return {
    state,
    client: client as never,
    /** La próxima lectura espera hasta `open()`. */
    hold() {
      gate = new Promise((r) => (release = r));
    },
    open() {
      release?.();
      gate = null;
    },
  };
}

/** Una carga nueva de la app (un `PrefsStore` nuevo que lee lo que hay en el dispositivo). */
async function freshStore() {
  vi.resetModules();
  return (await import('./prefs')).prefs;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let stores: { detach(): void }[] = [];
beforeEach(() => localStorage.clear());
afterEach(() => {
  for (const s of stores.splice(0)) s.detach();
  localStorage.clear();
});

async function store() {
  const s = await freshStore();
  stores.push(s);
  return s;
}

describe('versiones viejas de la app', () => {
  it('una pestaña vieja que escribe sus preferencias sin idioma no le cambia el idioma a esta ni lo sube', async () => {
    const prefs = await store();
    const { client, state } = fakeClient({ ...OLD_KEYS, language: 'es' } as Partial<Prefs>);
    await prefs.attach(client, USER);
    expect(prefs.get().language).toBe('es');

    // La otra pestaña (versión vieja, mismo usuario) cambia el tema y escribe la copia de siempre.
    const old = JSON.stringify({ userId: USER, prefs: { ...OLD_KEYS, theme: 'dark' }, dirty: true });
    localStorage.setItem('shotdocs-prefs', old);
    window.dispatchEvent(new StorageEvent('storage', { key: 'shotdocs-prefs', newValue: old }));
    expect(prefs.get().theme).toBe('dark');
    expect(prefs.get().language).toBe('es');

    // El próximo cambio de esta pestaña sube el idioma de siempre, no el del navegador (en-US en jsdom).
    prefs.set({ font: 'editorial' });
    await flush();
    expect(state.pushed.at(-1)).toMatchObject({ language: 'es', font: 'editorial', theme: 'dark' });
  });

  it('al abrir, lo que falta en la copia de siempre sale de la copia aparte del usuario', async () => {
    localStorage.setItem(
      'shotdocs-prefs-others',
      JSON.stringify({ [USER]: { prefs: { ...OLD_KEYS, language: 'es' }, dirty: false } }),
    );
    localStorage.setItem('shotdocs-prefs', JSON.stringify({ userId: USER, prefs: { ...OLD_KEYS, theme: 'light' }, dirty: false }));
    const prefs = await store();
    expect(prefs.get()).toMatchObject({ theme: 'light', language: 'es' });
  });

  it('una copia vieja con cambios sin subir y sin idioma no sube el idioma del navegador sin leer la cuenta', async () => {
    localStorage.setItem('shotdocs-prefs', JSON.stringify({ userId: USER, prefs: { ...OLD_KEYS, theme: 'dark' }, dirty: true }));
    const prefs = await store();
    expect(prefs.hasUnsynced()).toBe(true);
    const { client, state } = fakeClient({ ...OLD_KEYS, theme: 'light', language: 'es' } as Partial<Prefs>);
    await prefs.attach(client, USER);
    await flush();
    // Primero se leyó la cuenta; gana el tema cambiado acá, el idioma sale de la cuenta.
    expect(state.reads).toBe(1);
    // La clave nueva que la cuenta todavía no tenía sube con su valor de fábrica.
    expect(state.pushed).toEqual([{ ...OLD_KEYS, theme: 'dark', language: 'es', phoneImages: 'rows', contrast: 'contrast', expandSubpages: 'onClick' }]);
    expect(prefs.get().language).toBe('es');
    expect(prefs.hasUnsynced()).toBe(false);
  });
});

describe('fotos en fila en el teléfono (phoneImages)', () => {
  it('una copia vieja con cambios sin subir, sin la clave, no pisa "apiladas" de la cuenta', async () => {
    localStorage.setItem('shotdocs-prefs', JSON.stringify({ userId: USER, prefs: { ...OLD_KEYS, theme: 'dark' }, dirty: true }));
    const prefs = await store();
    const { client, state } = fakeClient({ ...OLD_KEYS, theme: 'light', language: 'es', phoneImages: 'stacked' } as Partial<Prefs>);
    await prefs.attach(client, USER);
    await flush();
    expect(prefs.get().phoneImages).toBe('stacked');
    expect(state.pushed).toEqual([{ ...OLD_KEYS, theme: 'dark', language: 'es', phoneImages: 'stacked', contrast: 'contrast', expandSubpages: 'onClick' }]);
  });

  it('un valor desconocido queda en el de fábrica (en fila)', async () => {
    const { cleanPrefs } = await import('./prefs');
    expect(cleanPrefs({ phoneImages: 'grid' }).phoneImages).toBe('rows');
    expect(cleanPrefs({ phoneImages: 'stacked' }).phoneImages).toBe('stacked');
  });
});

describe('un cambio antes de leer la cuenta', () => {
  const account = { theme: 'dark', font: 'editorial', textSize: 'large', pageWidth: 'wide', language: 'en' } as const;

  it('dispositivo nuevo que cambia el idioma mientras se lee la cuenta: se fusiona, no la pisa', async () => {
    const prefs = await store();
    const fake = fakeClient(account);
    fake.hold();
    const attaching = prefs.attach(fake.client, USER);
    prefs.set({ language: 'es' });
    await flush();
    expect(fake.state.pushed).toEqual([]);
    fake.open();
    await attaching;
    await flush();
    expect(prefs.get()).toEqual({ ...account, language: 'es', phoneImages: 'rows', contrast: 'contrast', expandSubpages: 'onClick' });
    expect(fake.state.pushed).toEqual([{ ...account, language: 'es', phoneImages: 'rows', contrast: 'contrast', expandSubpages: 'onClick' }]);
    expect(prefs.hasUnsynced()).toBe(false);
  });

  it('sin red al entrar, un cambio y vuelve la red: primero lee, fusiona y recién ahí sube', async () => {
    const prefs = await store();
    const fake = fakeClient(account);
    fake.state.online = false;
    await prefs.attach(fake.client, USER);
    prefs.set({ theme: 'light' });
    await flush();
    expect(fake.state.pushed).toEqual([]);
    expect(prefs.get().font).toBe('default');

    fake.state.online = true;
    window.dispatchEvent(new Event('online'));
    await flush();
    await flush();
    expect(fake.state.pushed).toEqual([{ ...account, theme: 'light', phoneImages: 'rows', contrast: 'contrast', expandSubpages: 'onClick' }]);
    expect(prefs.get()).toEqual({ ...account, theme: 'light', phoneImages: 'rows', contrast: 'contrast', expandSubpages: 'onClick' });
  });
});

describe('contraste del texto (contrast)', () => {
  it('de fábrica es Contrast, y un valor desconocido vuelve a Contrast', async () => {
    const { cleanPrefs, DEFAULT_PREFS } = await import('./prefs');
    expect(DEFAULT_PREFS.contrast).toBe('contrast');
    expect(cleanPrefs({}).contrast).toBe('contrast');
    expect(cleanPrefs({ contrast: 'max' }).contrast).toBe('contrast');
    expect(cleanPrefs({ contrast: 'none' }).contrast).toBe('none');
    expect(cleanPrefs({ contrast: 'more' }).contrast).toBe('more');
  });

  it('se guarda en el dispositivo, sube a la cuenta y marca el documento (data-contrast)', async () => {
    const prefs = await store();
    const { client, state } = fakeClient({ ...OLD_KEYS, language: 'en' } as Partial<Prefs>);
    await prefs.attach(client, USER);
    expect(prefs.get().contrast).toBe('contrast');
    prefs.set({ contrast: 'more' });
    await flush();
    expect(document.documentElement.dataset.contrast).toBe('more');
    expect(JSON.parse(localStorage.getItem('shotdocs-prefs')!).prefs.contrast).toBe('more');
    expect(state.pushed.at(-1)).toMatchObject({ contrast: 'more' });
    // Una carga nueva de la app arranca con lo guardado, sin red.
    const again = await store();
    expect(again.get().contrast).toBe('more');
  });

  it('una cuenta borrada por una versión vieja (sin la clave) no le cambia el contraste a este dispositivo', async () => {
    localStorage.setItem('shotdocs-prefs', JSON.stringify({ userId: USER, prefs: { ...OLD_KEYS, language: 'es', contrast: 'none' }, dirty: false }));
    const prefs = await store();
    const { client } = fakeClient({ ...OLD_KEYS, language: 'es' } as Partial<Prefs>);
    await prefs.attach(client, USER);
    expect(prefs.get().contrast).toBe('none');
  });
});
