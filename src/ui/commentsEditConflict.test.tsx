// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HELP_ENTRIES } from '../help/entries';
import { isNewer, isValidSince } from '../help/news';
import { searchHelp } from '../help/search';
import { translate } from '../i18n';
import '../i18n/lazy/help';
import { settled } from '../test/settle';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { CommentsPanel } from './CommentsPanel';
import { closeComments, showComments } from './commentsUi';
import { SyncBadge } from './SyncBadge';

// El panel de comentarios montado de verdad, con dos dispositivos de la misma persona contra el servidor en memoria
// (Docs/Doc_Sincronizacion.md, "Dos ediciones del mismo comentario"): una edición propia que no entró porque el
// comentario se cambió antes desde otro lado se ve al lado de lo guardado, cada texto con su rótulo, y la persona
// decide. Las reglas de la cola están en src/sync/commentsEditConflict.test.ts.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  })) as never;
});

const roots: Root[] = [];
const devices: Device[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  act(() => closeComments());
  document.body.innerHTML = '';
});

function services(d: Device, userId: string): Services {
  const config = {
    url: 'https://znlvpuddswymxpffgvbz.supabase.co',
    publishableKey: 'sb_publishable_test',
    name: 'Wanka',
    localKey: WANKA_LOCAL_KEY,
    storage: legacyStorageNames(WANKA_LOCAL_KEY),
  };
  const client = { auth: { signOut: vi.fn() } } as never;
  return {
    workspace: { config, client },
    client,
    user: { id: userId, email: `${userId}@test` },
    db: d.db,
    tree: d.tree,
    docs: d.docs,
    files: d.files,
    media: d.media,
    engine: d.engine,
    access: d.access,
    remote: d.remote as unknown as SupabaseRemote,
    dbName: 'test',
    mediaDb: d.mediaDb,
    comments: d.comments,
    commentsDb: d.commentsDb,
    sizes: d.sizes,
    offline: d.offline,
    shutdown: async () => undefined,
  };
}

const wait = (ms = 60) => act(() => settled(ms));

/**
 * La misma persona en el teléfono (con el panel abierto) y en la computadora, con un comentario suyo en la página ya
 * subido y bajado en los dos.
 */
async function phoneAndDesk() {
  const server = new FakeServer();
  server.enableComments();
  server.editBaseEnabled = true;
  const phone = await makeDevice(server);
  devices.push(phone);
  const page = await phone.tree.create(null, 'Brief');
  await phone.engine.syncNow();
  const desk = await makeDevice(server);
  devices.push(desk);
  await desk.engine.syncNow();
  desk.comments.watch(page);
  const id = await phone.comments.add(page, null, 'Original');
  await phone.engine.syncNow();
  server.clockOffset += 11_000;
  await desk.engine.syncNow();

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<ServicesContext.Provider value={services(phone, server.ownerId)}><CommentsPanel pageId={page} /></ServicesContext.Provider>));
  await act(async () => showComments(null));
  await wait();
  const panel = () => host.querySelector<HTMLElement>('.comments-panel')!;
  const button = (label: string) => [...panel().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label);
  const sync = async (d: Device) => {
    server.clockOffset += 11_000;
    await act(async () => d.engine.syncNow());
    await wait();
  };
  return { server, phone, desk, page, id, panel, button, sync };
}

/** La computadora edita y sube mientras el teléfono tiene una edición sin subir; después el teléfono sincroniza. */
async function conflicted() {
  const w = await phoneAndDesk();
  await act(async () => w.phone.comments.edit(w.page, w.id, 'Del teléfono'));
  await w.desk.comments.edit(w.page, w.id, 'De la computadora');
  await w.desk.engine.syncNow();
  await w.sync(w.phone);
  return w;
}

describe('una edición propia que no entró', () => {
  it('se ve lo que quedó guardado y lo que se escribió acá, cada uno con su rótulo; quedarse con lo propio lo manda', async () => {
    const { server, phone, id, panel, button, sync } = await conflicted();
    const box = panel().querySelector<HTMLElement>('.comment-conflict')!;
    expect(box).not.toBeNull();
    const text = box.textContent ?? '';
    expect(text).toContain('Your edit was not saved: this comment had already been changed from somewhere else. Nothing was lost.');
    // Primero lo guardado, después lo propio, cada uno debajo de su rótulo.
    const order = ['Saved now, changed from somewhere else', 'De la computadora', 'What you wrote on this device', 'Del teléfono'].map((s) => text.indexOf(s));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Cada texto una sola vez: lo guardado no se repite afuera del aviso.
    expect(panel().textContent!.split('De la computadora')).toHaveLength(2);
    expect(panel().textContent!.split('Del teléfono')).toHaveLength(2);
    // No es un rechazo ni algo "sin subir": no hay Retry, y no se puede volver a editar antes de decidir.
    expect(panel().textContent).not.toContain('Not accepted by the server');
    expect(panel().textContent).not.toContain('Not uploaded yet');
    expect(button('Retry')).toBeUndefined();
    expect(button('Edit')).toBeUndefined();
    expect(button('Delete')).toBeDefined();
    expect(button('Discard mine…')).toBeDefined();
    // *Copy mine* copia lo propio, entero (no lo guardado).
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void copied.push(t) } });
    await act(async () => button('Copy mine')!.click());
    await wait();
    expect(copied).toEqual(['Del teléfono']);
    expect(button('Copied')).toBeDefined();

    await act(async () => button('Keep mine')!.click());
    await wait();
    expect(panel().querySelector('.comment-conflict')).toBeNull();
    await sync(phone);
    expect(server.comments.get(id)?.body).toBe('Del teléfono');
    expect(panel().querySelector('.comment-conflict')).toBeNull();
    expect(panel().textContent).toContain('Del teléfono');
    expect(panel().textContent).not.toContain('De la computadora');
    expect(button('Edit')).toBeDefined();
  });

  it('descartar lo propio pide confirmación y dice qué queda; cancelar no descarta nada', async () => {
    const { server, phone, id, panel, button, sync } = await conflicted();
    const sent = server.commentEdits.length;
    await act(async () => button('Discard mine…')!.click());
    expect(panel().textContent).toContain('Discarding what you wrote on this device. What is saved does not change.');
    await act(async () => button('Cancel')!.click());
    expect(panel().querySelector('.comment-conflict')!.textContent).toContain('Del teléfono');
    expect(phone.comments.status().failed).toBe(1);

    await act(async () => button('Discard mine…')!.click());
    await act(async () => button('Discard')!.click());
    await wait();
    expect(panel().querySelector('.comment-conflict')).toBeNull();
    expect(panel().textContent).toContain('De la computadora');
    expect(panel().textContent).not.toContain('Del teléfono');
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 0 });
    await sync(phone);
    expect(server.commentEdits).toHaveLength(sent);
    expect(server.comments.get(id)?.body).toBe('De la computadora');
  });

  it('si mientras escribe llega otra versión, guardar no la pisa: la base es el texto con el que se abrió el cuadro', async () => {
    const { server, phone, desk, page, id, panel, button, sync } = await phoneAndDesk();
    await act(async () => button('Edit')!.click());
    const textarea = panel().querySelector<HTMLTextAreaElement>('textarea')!;
    expect(textarea.value).toBe('Original');
    // La computadora edita y el teléfono lo baja con el cuadro abierto: lo escrito sigue en el cuadro.
    await desk.comments.edit(page, id, 'De la computadora');
    await desk.engine.syncNow();
    await sync(phone);
    expect(phone.comments.threads(page)[0].root.body).toBe('De la computadora');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Del teléfono');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Save')!.click());
    await wait();
    await sync(phone);
    expect(server.commentEdits.at(-1)).toEqual({ id, body: 'Del teléfono', base: 'Original' });
    expect(server.comments.get(id)?.body).toBe('De la computadora');
    const box = panel().querySelector('.comment-conflict')!;
    expect(box.textContent).toContain('De la computadora');
    expect(box.textContent).toContain('Del teléfono');
  });

  it('con el cuadro ya abierto cuando choca la edición anterior: se avisa, y lo que se guarda pasa a ser lo propio, no se manda', async () => {
    const { server, phone, desk, page, id, panel, button, sync } = await phoneAndDesk();
    // Una edición sin subir («TEL-1»), y la persona vuelve a abrir el cuadro, que arranca con ese texto.
    await act(async () => phone.comments.edit(page, id, 'TEL-1'));
    await wait();
    await act(async () => button('Edit')!.click());
    const textarea = () => panel().querySelector<HTMLTextAreaElement>('textarea')!;
    expect(textarea().value).toBe('TEL-1');
    // La computadora edita y sube; el teléfono sincroniza con el cuadro abierto: «TEL-1» choca.
    await desk.comments.edit(page, id, 'PC');
    await desk.engine.syncNow();
    await sync(phone);
    expect(phone.comments.status().failed).toBe(1);
    // El cuadro sigue abierto con lo escrito, y arriba avisa.
    expect(textarea().value).toBe('TEL-1');
    expect(panel().querySelector('.comment-conflict')!.textContent).toBe(
      'This comment was changed from somewhere else while you were editing. Save or cancel to see both texts and choose.',
    );
    // Sin red, sigue escribiendo y guarda.
    server.online = false;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea(), 'TEL-2');
      textarea().dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Save')!.click());
    await wait();
    // Los rótulos dicen la verdad: lo guardado es lo de la computadora y lo propio es lo último que escribió.
    expect(panel().querySelector('textarea')).toBeNull();
    const text = panel().querySelector('.comment-conflict')!.textContent ?? '';
    const order = ['Saved now, changed from somewhere else', 'PC', 'What you wrote on this device', 'TEL-2'].map((s) => text.indexOf(s));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(panel().textContent).not.toContain('TEL-1');
    expect(await phone.commentsDb.getAll('outbox')).toEqual([]);
    // *Keep mine* manda lo último.
    server.online = true;
    await act(async () => button('Keep mine')!.click());
    await wait();
    await sync(phone);
    expect(server.comments.get(id)?.body).toBe('TEL-2');
    expect(server.commentEdits.at(-1)).toEqual({ id, body: 'TEL-2', base: 'PC' });
    expect(phone.comments.status()).toMatchObject({ pending: 0, failed: 0 });
  });

  it('en un hilo resuelto, lo que espera decisión no queda escondido: los resueltos se abren solos', async () => {
    const { phone, desk, page, id, panel, sync } = await conflicted();
    await sync(desk);
    await desk.comments.resolve(page, id, true);
    await desk.engine.syncNow();
    await sync(phone);
    expect(phone.comments.threads(page)[0].resolved).toBe(true);
    expect(panel().querySelector('.comments-resolved-toggle')!.getAttribute('aria-expanded')).toBe('true');
    expect(panel().querySelector('.comment-conflict')!.textContent).toContain('Del teléfono');
  });

  it('en un comentario que además se borró queda solo lo propio, para copiarlo o descartarlo', async () => {
    const { phone, desk, page, id, panel, button, sync } = await conflicted();
    // Con una respuesta el hilo sigue a la vista aunque se borre el primer comentario.
    await act(async () => phone.comments.add(page, null, 'Una respuesta', id));
    await sync(phone);
    await sync(desk);
    await desk.comments.remove(page, id);
    await desk.engine.syncNow();
    await sync(phone);
    const box = panel().querySelector('.comment-conflict')!;
    expect(box.textContent).toContain('Your edit was not saved, and this comment was deleted since.');
    expect(box.textContent).toContain('Del teléfono');
    expect(box.textContent).not.toContain('Saved now');
    expect(button('Keep mine')).toBeUndefined();
    expect(button('Copy mine')).toBeDefined();
    await act(async () => button('Discard mine…')!.click());
    await act(async () => button('Discard')!.click());
    await wait();
    expect(panel().querySelector('.comment-conflict')).toBeNull();
    expect(phone.comments.status().failed).toBe(0);
  });

  it('el estado de la sincronización lo cuenta y lo lista con su texto; desde ahí se puede copiar o descartar', async () => {
    const { server, phone, id } = await conflicted();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<ServicesContext.Provider value={services(phone, server.ownerId)}><SyncBadge /></ServicesContext.Provider>));
    await wait();
    const warning = host.querySelector<HTMLButtonElement>('.sync-warning')!;
    expect(warning.textContent).toBe('1 change rejected by the server');
    await act(async () => warning.click());
    const item = [...host.querySelectorAll('li')].find((li) => li.textContent?.includes('Del teléfono'))!;
    expect(item.textContent).toContain('An edited comment on “Brief” (“Del teléfono”)');
    expect(item.textContent).toContain("It had already been changed from somewhere else, so your edit was not saved. Open the page's comments to choose which text stays.");
    // Con solo ediciones apartadas no hay nada que reintentar: el detalle no dice "hasta que reintentes" ni ofrece Retry.
    const details = host.querySelector('.sync-details')!;
    expect(details.textContent).toContain("they stay on this device until you choose which text stays, in each page's comments.");
    expect(details.textContent).not.toContain('until you retry');
    expect([...details.querySelectorAll('button')].map((b) => b.textContent)).not.toContain('Retry');
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const discard = [...item.querySelectorAll('button')].find((b) => b.textContent === 'Discard')!;
    await act(async () => discard.click());
    expect(ask).toHaveBeenCalledWith('Discarding what you wrote on this device. What is saved does not change. This cannot be undone.');
    expect(phone.comments.status().failed).toBe(1);
    ask.mockReturnValue(true);
    await act(async () => discard.click());
    await wait();
    ask.mockRestore();
    expect(phone.comments.status().failed).toBe(0);
    expect(host.querySelector('.sync-warning')).toBeNull();
    expect(server.comments.get(id)?.body).toBe('De la computadora');
  });

  it('los textos están en los dos idiomas', () => {
    const keys = [
      'comments.conflict.title', 'comments.conflict.theirs', 'comments.conflict.mine', 'comments.conflict.keepMine',
      'comments.conflict.discardMine', 'comments.conflict.copyMine', 'comments.conflict.deleted',
      'commentError.editConflict', 'commentDiscard.conflict',
    ] as const;
    for (const key of keys) {
      expect(translate('en', key), key).not.toBe(key);
      expect(translate('es', key), key).not.toBe(translate('en', key));
    }
    expect(translate('es', 'comments.conflict.keepMine')).toBe('Dejar el mío');
    expect(translate('es', 'comments.conflict.theirs')).toBe('Lo que quedó guardado, cambiado desde otro lado');
  });

  it('la ayuda lo explica y la búsqueda lo encuentra, con los nombres de los botones', () => {
    const ids = (q: string, lang: 'en' | 'es' = 'en') => searchHelp(HELP_ENTRIES, q, lang).map((h) => h.entry.id);
    expect(ids('two devices')[0]).toBe('commentEditConflict');
    expect(ids('dos dispositivos', 'es')[0]).toBe('commentEditConflict');
    expect(ids('keep mine')).toContain('commentEditConflict');
    expect(ids('descartar el mío', 'es')).toContain('commentEditConflict');
    expect(ids('conflicto', 'es')).toContain('commentEditConflict');
    const entry = HELP_ENTRIES.find((e) => e.id === 'commentEditConflict')!;
    expect(entry.section).toBe('comments');
    // Los botones se llaman en la ayuda como en el panel, en cada idioma.
    for (const lang of ['en', 'es'] as const) {
      expect(translate(lang, entry.text)).toContain(translate(lang, 'comments.conflict.keepMine'));
      expect(translate(lang, entry.text)).toContain(translate(lang, 'comments.conflict.discardMine').replace('…', ''));
    }
    // Llegó después de la v0.225: sale en las novedades de quien venía de ahí.
    expect(isValidSince(entry.since)).toBe(true);
    expect(isNewer(entry.since, '0.225')).toBe(true);
  });
});
