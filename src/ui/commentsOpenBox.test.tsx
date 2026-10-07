// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HELP_ENTRIES } from '../help/entries';
import { isNewer, isValidSince } from '../help/news';
import { searchHelp } from '../help/search';
import { translate } from '../i18n';
import '../i18n/lazy/help';
import { prefs } from '../prefs';
import { settled } from '../test/settle';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { CommentsPanel } from './CommentsPanel';
import { closeComments, hasDrafts, showComments } from './commentsUi';

// El panel de comentarios montado de verdad, con dos dispositivos contra el servidor en memoria: lo que la persona está
// tipeando en un cuadro (una respuesta, una edición) no desaparece porque llegue un cambio de afuera por la
// sincronización. Un hilo que se resuelve (o se reabre) con un cuadro abierto se queda donde estaba hasta que el cuadro
// se cierre; un comentario o un hilo que se borra sigue a la vista, con lo tipeado para copiar y el cuadro diciendo que
// desde ahí ya no se puede guardar (Docs/Doc_Sincronizacion.md, "Un cuadro abierto y lo que llega de afuera").

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  })) as never;
});

const roots: Root[] = [];
const devices: Device[] = [];
/** Los avisos que salieron (`notify`): el texto y, si tiene, su botón. */
const notices: { message: string; label?: string; run?: () => void }[] = [];
const onNotice = (e: Event) => {
  const detail = (e as CustomEvent<string | { message: string; action?: { label: string; run: () => void } }>).detail;
  notices.push(typeof detail === 'string' ? { message: detail } : { message: detail.message, label: detail.action?.label, run: detail.action?.run });
};
window.addEventListener('shotdocs:notice', onNotice);

afterEach(async () => {
  vi.restoreAllMocks();
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  act(() => closeComments());
  act(() => prefs.set({ language: 'en' }));
  notices.length = 0;
  document.body.innerHTML = '';
});

function services(d: Device, userId: string): Services {
  const config = { url: 'https://x.supabase.co', publishableKey: 'k', name: 'Wanka', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) };
  const client = { auth: { signOut: vi.fn() } } as never;
  return {
    workspace: { config, client }, client, user: { id: userId, email: `${userId}@test` }, db: d.db, tree: d.tree, docs: d.docs, files: d.files,
    media: d.media, engine: d.engine, access: d.access, remote: d.remote as unknown as SupabaseRemote, dbName: 'test', mediaDb: d.mediaDb,
    comments: d.comments, commentsDb: d.commentsDb, sizes: d.sizes, offline: d.offline, shutdown: async () => undefined,
  };
}

const wait = (ms = 60) => act(() => settled(ms));
const RESOLVED_NOTE = 'This thread was resolved while you were writing. You can still send what you wrote: the thread stays resolved.';
const GONE_EDITING = "This comment was deleted from somewhere else while you were editing it. What you wrote can't be saved from here: copy it if you want to keep it, then cancel.";
const GONE_REPLYING = "This thread was deleted from somewhere else while you were writing. What you wrote can't be saved from here: copy it if you want to keep it, then cancel.";
const GONE_ASK = "Discard what you wrote here? The comment is no longer there, so it can't be saved from this box: copy it first if you want to keep it.";

/**
 * La misma persona en el teléfono (con el panel abierto) y en la computadora, con un hilo suyo («Original») ya subido y
 * bajado en los dos. Lo que hace la computadora le llega al teléfono por la sincronización (`sync`).
 */
async function world() {
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
  const buttons = (label: string, within: ParentNode = panel()) => [...within.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === label || b.getAttribute('aria-label') === label);
  const click = (label: string, at = 0, within?: ParentNode) => act(async () => buttons(label, within)[at].click());
  const box = () => panel().querySelector<HTMLTextAreaElement>('textarea');
  const type = (text: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box()!, text);
      box()!.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const key = (k: string, mods: KeyboardEventInit = {}) => act(async () => void box()!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods })));
  /** Sube lo de un dispositivo y baja lo que haya (el reloj del servidor se adelanta para que la bajada no espere). */
  const sync = async (d: Device) => {
    server.clockOffset += 11_000;
    await act(async () => d.engine.syncNow());
    await wait();
  };
  /** Lo que hace la computadora, subido, y bajado en el teléfono con el panel abierto. */
  const fromDesk = async (change: () => Promise<unknown>) => {
    await change();
    await desk.engine.syncNow();
    await sync(phone);
  };
  const copied: string[] = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } });
  const outbox = async () => (await phone.commentsDb.getAll('outbox')).map((e) => (e.op as { body?: string }).body ?? e.op.kind);
  /** Los hilos de arriba (los abiertos) y los de la lista de resueltos, como se ven. */
  const openThreads = () => [...panel().querySelectorAll<HTMLElement>('.comments-body > .comment-thread:not(.composing)')];
  const resolvedThreads = () => [...panel().querySelectorAll<HTMLElement>('.comments-resolved .comment-thread')];
  return { server, phone, desk, page, id, host, root, panel, buttons, click, box, type, key, sync, fromDesk, copied, outbox, openThreads, resolvedThreads };
}

describe('un hilo que se resuelve desde otro lado con un cuadro abierto', () => {
  it('una respuesta a medio escribir sigue ahí, a la vista, con el aviso; se puede mandar igual y recién ahí el hilo pasa a los resueltos', async () => {
    const w = await world();
    await w.click('Reply');
    await w.type('Respuesta a medio escribir');
    const before = w.box();
    await w.fromDesk(() => w.desk.comments.resolve(w.page, w.id, true));
    // El cambio llegó de verdad por la sincronización.
    expect(w.phone.comments.threads(w.page)[0].resolved).toBe(true);
    // El cuadro es el mismo (no se volvió a montar), con lo tipeado, y el hilo sigue arriba, no escondido.
    expect(w.box()).toBe(before);
    expect(w.box()!.value).toBe('Respuesta a medio escribir');
    expect(w.openThreads()).toHaveLength(1);
    expect(w.resolvedThreads()).toHaveLength(0);
    const thread = w.openThreads()[0];
    expect(thread.textContent).toContain('Resolved by You');
    expect(thread.querySelector('.comments-note')!.textContent).toBe(RESOLVED_NOTE);
    // Mandar la respuesta: se guarda en el hilo, que sigue resuelto.
    await w.click('Reply');
    await wait();
    await w.sync(w.phone);
    const sent = [...w.server.comments.values()].find((c) => c.thread_id === w.id);
    expect(sent?.body).toBe('Respuesta a medio escribir');
    expect(w.server.comments.get(w.id)!.resolved_at).not.toBeNull();
    // Cerrado el cuadro, el hilo va a los resueltos, que se abren para que se vea adónde fue lo mandado.
    expect(w.box()).toBeNull();
    expect(w.openThreads()).toHaveLength(0);
    expect(w.resolvedThreads()).toHaveLength(1);
    expect(w.resolvedThreads()[0].textContent).toContain('Respuesta a medio escribir');
    expect(w.panel().querySelector('.comments-resolved-toggle')!.getAttribute('aria-expanded')).toBe('true');
    expect(w.panel().textContent).not.toContain(RESOLVED_NOTE);
    expect(notices).toEqual([]);
  });

  it('una edición a medio escribir sigue ahí; al cancelar, el hilo va a los resueltos y no queda pegado arriba', async () => {
    const w = await world();
    await w.click('Edit');
    await w.type('Edición a medio escribir');
    const before = w.box();
    await w.fromDesk(() => w.desk.comments.resolve(w.page, w.id, true));
    expect(w.box()).toBe(before);
    expect(w.box()!.value).toBe('Edición a medio escribir');
    expect(w.openThreads()).toHaveLength(1);
    expect(w.openThreads()[0].querySelector('.comments-note')!.textContent).toBe(RESOLVED_NOTE);
    // Más sincronizaciones no lo mueven ni lo tocan.
    await w.sync(w.phone);
    await w.sync(w.phone);
    expect(w.box()).toBe(before);
    expect(w.box()!.value).toBe('Edición a medio escribir');
    // Guardar anda como en cualquier hilo resuelto.
    await w.click('Save');
    await wait();
    await w.sync(w.phone);
    expect(w.server.comments.get(w.id)!.body).toBe('Edición a medio escribir');
    expect(w.box()).toBeNull();
    expect(w.openThreads()).toHaveLength(0);
    expect(w.resolvedThreads()).toHaveLength(1);
  });

  it('sin ningún cuadro abierto, el hilo resuelto desde otro lado pasa a los resueltos, plegados, como siempre', async () => {
    const w = await world();
    await w.click('Reply');
    await w.click('Cancel');
    await w.fromDesk(() => w.desk.comments.resolve(w.page, w.id, true));
    expect(w.openThreads()).toHaveLength(0);
    expect(w.resolvedThreads()).toHaveLength(0);
    expect(w.panel().querySelector('.comments-resolved-toggle')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('al revés: editando en un hilo resuelto que se reabre desde otro lado, el cuadro sigue en su lugar; plegar la lista no lo esconde', async () => {
    const w = await world();
    await w.fromDesk(() => w.desk.comments.resolve(w.page, w.id, true));
    await act(async () => w.panel().querySelector<HTMLButtonElement>('.comments-resolved-toggle')!.click());
    await w.click('Edit');
    await w.type('Editando en un hilo resuelto');
    const before = w.box();
    // Abrir el cuadro no mueve el hilo de lista.
    expect(w.resolvedThreads()).toHaveLength(1);
    expect(w.openThreads()).toHaveLength(0);
    await w.fromDesk(() => w.desk.comments.resolve(w.page, w.id, false));
    expect(w.phone.comments.threads(w.page)[0].resolved).toBe(false);
    expect(w.box()).toBe(before);
    expect(w.box()!.value).toBe('Editando en un hilo resuelto');
    expect(w.resolvedThreads()[0].querySelector('.comments-note')!.textContent).toBe('This thread was reopened while you were writing.');
    // Plegar los resueltos con el cuadro abierto adentro no se lo lleva.
    await act(async () => w.panel().querySelector<HTMLButtonElement>('.comments-resolved-toggle')!.click());
    expect(w.panel().querySelector('.comments-resolved-toggle')!.getAttribute('aria-expanded')).toBe('false');
    expect(w.box()).toBe(before);
    expect(w.box()!.value).toBe('Editando en un hilo resuelto');
    // Al cerrarse el cuadro, el hilo va arriba con los abiertos.
    await w.click('Cancel');
    expect(w.box()).toBeNull();
    expect(w.openThreads()).toHaveLength(1);
    expect(w.panel().querySelector('.comments-resolved')).toBeNull();
  });
});

describe('un comentario o un hilo que se borra desde otro lado con un cuadro abierto', () => {
  it('el cuadro de edición sigue con lo tipeado, dice que el comentario ya no está y que desde ahí no se guarda; se copia, y cancelar pide confirmación', async () => {
    const w = await world();
    await w.click('Edit');
    await w.type('Mucho texto tipeado que todavía no se guardó');
    const before = w.box();
    await w.fromDesk(() => w.desk.comments.remove(w.page, w.id));
    // Llegó: para la cola, el hilo ya no existe.
    expect(w.phone.comments.threads(w.page)).toEqual([]);
    expect(w.box()).toBe(before);
    expect(w.box()!.value).toBe('Mucho texto tipeado que todavía no se guardó');
    const thread = w.openThreads()[0];
    expect(thread.textContent).toContain('This comment was deleted.');
    expect(thread.querySelector('.comment-conflict')!.textContent).toBe(GONE_EDITING);
    // Guardar no se ofrece: ni el botón ni Ctrl/⌘+Enter mandan nada.
    expect(w.buttons('Save')[0].disabled).toBe(true);
    await w.key('Enter', { ctrlKey: true });
    await w.key('Enter', { metaKey: true });
    await wait();
    expect(await w.outbox()).toEqual([]);
    // *Copy text* copia lo tipeado, entero.
    await w.click('Copy text');
    await wait();
    expect(w.copied).toEqual(['Mucho texto tipeado que todavía no se guardó']);
    // Cancelar, Escape, la X y tocar afuera preguntan con el texto del caso; con un «no», todo sigue igual.
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await w.click('Cancel');
    await w.key('Escape');
    await w.click('Close comments');
    await act(async () => w.host.querySelector<HTMLElement>('.comments-scrim')!.click());
    expect(ask.mock.calls.map((c) => c[0])).toEqual([GONE_ASK, GONE_ASK, GONE_ASK, GONE_ASK]);
    expect(w.box()).toBe(before);
    expect(w.box()!.value).toBe('Mucho texto tipeado que todavía no se guardó');
    // Más sincronizaciones no se lo llevan.
    await w.sync(w.phone);
    expect(w.box()).toBe(before);
    // En castellano.
    act(() => prefs.set({ language: 'es' }));
    await wait();
    expect(w.openThreads()[0].querySelector('.comment-conflict')!.textContent).toBe(translate('es', 'comments.gone.editing'));
    await w.click('Cancelar');
    expect(ask).toHaveBeenLastCalledWith(translate('es', 'comments.gone.cancel'));
    act(() => prefs.set({ language: 'en' }));
    await wait();
    // Con un «sí», el cuadro se cierra y el hilo borrado deja de verse; nada se mandó.
    ask.mockReturnValue(true);
    await w.click('Cancel');
    await wait();
    expect(w.box()).toBeNull();
    expect(w.openThreads()).toHaveLength(0);
    expect(await w.outbox()).toEqual([]);
    expect(notices).toEqual([]);
  });

  it('una respuesta propia que se borra mientras se la edita: el hilo sigue, y el cuadro queda en su lugar con el aviso', async () => {
    const w = await world();
    const reply = await w.phone.comments.add(w.page, null, 'Mi respuesta', w.id);
    await w.sync(w.phone);
    await w.desk.engine.syncNow();
    await w.click('Edit', 1);
    await w.type('Respuesta editada a medias');
    const before = w.box();
    await w.fromDesk(() => w.desk.comments.remove(w.page, reply));
    expect(w.phone.comments.threads(w.page)[0].replies).toEqual([]);
    expect(w.box()).toBe(before);
    expect(w.box()!.value).toBe('Respuesta editada a medias');
    const thread = w.openThreads()[0];
    expect(thread.textContent).toContain('Original');
    expect(thread.querySelector('.comment.deleted .comment-conflict')!.textContent).toBe(GONE_EDITING);
    expect(w.buttons('Save')[0].disabled).toBe(true);
    expect(w.buttons('Copy text')).toHaveLength(1);
    // Sin nada escrito que perder, cancelar no pregunta.
    await w.type('Mi respuesta');
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await w.click('Cancel');
    expect(ask).not.toHaveBeenCalled();
    expect(w.box()).toBeNull();
    expect(w.openThreads()[0].querySelector('.comment.deleted')).toBeNull();
  });

  it('el hilo entero borrado con una respuesta a medio escribir: lo tipeado sigue a la vista, para copiarlo', async () => {
    const w = await world();
    await w.click('Reply');
    await w.type('Respuesta a un hilo que se va a borrar');
    const before = w.box();
    await w.fromDesk(() => w.desk.comments.remove(w.page, w.id));
    expect(w.phone.comments.threads(w.page)).toEqual([]);
    expect(w.box()).toBe(before);
    expect(w.box()!.value).toBe('Respuesta a un hilo que se va a borrar');
    const thread = w.openThreads()[0];
    expect(thread.textContent).toContain('This comment was deleted.');
    expect(thread.querySelector('.comment-conflict')!.textContent).toBe(GONE_REPLYING);
    expect(w.buttons('Reply')[0].disabled).toBe(true);
    await w.key('Enter', { ctrlKey: true });
    await wait();
    expect(await w.outbox()).toEqual([]);
    await w.click('Copy text');
    await wait();
    expect(w.copied).toEqual(['Respuesta a un hilo que se va a borrar']);
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await w.click('Cancel');
    expect(ask).toHaveBeenCalledWith(GONE_ASK);
    expect(w.box()!.value).toBe('Respuesta a un hilo que se va a borrar');
    ask.mockReturnValue(true);
    await w.click('Cancel');
    await wait();
    expect(w.box()).toBeNull();
    expect(w.openThreads()).toHaveLength(0);
    expect(w.panel().textContent).toContain('No comments on this page yet.');
  });
});

describe('lo que no cambió, y lo que ya no se va en silencio', () => {
  it('en los cuadros normales Cancel no pregunta y Escape sí, como siempre; y no ofrecen copiar', async () => {
    const w = await world();
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    // Edición: Escape pregunta (con un «no» sigue), Cancel cierra sin preguntar.
    await w.click('Edit');
    await w.type('Editando');
    expect(w.buttons('Copy text')).toHaveLength(0);
    await w.key('Escape');
    expect(ask.mock.calls.map((c) => c[0])).toEqual(['Discard what you wrote?']);
    expect(w.box()!.value).toBe('Editando');
    await w.click('Cancel');
    expect(ask).toHaveBeenCalledTimes(1);
    expect(w.box()).toBeNull();
    // Respuesta: lo mismo.
    await w.click('Reply');
    await w.type('Respondiendo');
    expect(w.buttons('Copy text')).toHaveLength(0);
    await w.key('Escape');
    expect(ask).toHaveBeenCalledTimes(2);
    expect(w.box()!.value).toBe('Respondiendo');
    await w.click('Cancel');
    expect(ask).toHaveBeenCalledTimes(2);
    expect(w.box()).toBeNull();
    // Comentario nuevo: lo mismo.
    await w.click('Comment on the page');
    await wait();
    await w.type('Nuevo');
    await w.key('Escape');
    expect(ask).toHaveBeenCalledTimes(3);
    expect(w.box()!.value).toBe('Nuevo');
    await w.click('Cancel');
    expect(ask).toHaveBeenCalledTimes(3);
    expect(w.box()).toBeNull();
    // Sin nada escrito, Escape tampoco pregunta.
    await w.click('Reply');
    await w.key('Escape');
    expect(ask).toHaveBeenCalledTimes(3);
    expect(w.box()).toBeNull();
    // Cerrar un cuadro a mano nunca deja un aviso.
    expect(notices).toEqual([]);
    expect(hasDrafts()).toBe(false);
  });

  it('un cuadro con algo escrito que se desmonta sin que la persona lo cierre deja un aviso con Copy text; mandar o cerrar el panel confirmando, no', async () => {
    const w = await world();
    // Mandar: sin aviso.
    await w.click('Reply');
    await w.type('Se manda');
    await w.click('Reply');
    await wait();
    expect(notices).toEqual([]);
    // Cerrar el panel confirmando el descarte: sin aviso.
    await w.click('Reply');
    await w.type('Se descarta a propósito');
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await w.click('Close comments');
    expect(ask).toHaveBeenCalledWith('Discard what you wrote?');
    await wait();
    expect(notices).toEqual([]);
    ask.mockRestore();
    // La página deja de mostrarse con una respuesta a medio escribir (se cambió de página, o dejó de verse).
    await act(async () => showComments(null));
    await wait();
    await w.click('Reply');
    await w.type('Se iba a perder');
    act(() => w.root.unmount());
    roots.splice(roots.indexOf(w.root), 1);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ message: 'A comment you were writing was closed before you sent it.', label: 'Copy text' });
    notices[0].run!();
    await wait();
    expect(w.copied).toEqual(['Se iba a perder']);
    expect(hasDrafts()).toBe(false);
  });

  it('con el cuadro que no puede guardar por otra edición esperando decisión, la X y tocar afuera preguntan con el texto del caso', async () => {
    const w = await world();
    // Una edición rechazada de antes; la computadora edita; con el cuadro abierto sobre lo guardado, la rechazada se
    // reintenta, choca y pasa a ser lo apartado (el caso de la v0.228).
    await w.phone.commentsDb.add('outbox', {
      op: { kind: 'edit', id: w.id, pageId: w.page, body: 'VIEJA', at: new Date().toISOString(), base: 'Original' },
      attempted: true, failed: true, error: 'You can view this page but not comment on it.', queuedAt: Date.now(),
    });
    await act(async () => w.phone.comments.load());
    await w.fromDesk(() => w.desk.comments.edit(w.page, w.id, 'PC'));
    await w.click('Edit');
    await w.type('NUEVO');
    await act(async () => w.phone.comments.retryFailed());
    await w.sync(w.phone);
    expect(w.phone.comments.threads(w.page)[0].root.conflict).toEqual({ text: 'VIEJA' });
    const stuck = "Discard what you wrote here? It can't be saved from this box: copy it first if you want to keep it.";
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await w.click('Close comments');
    await act(async () => w.host.querySelector<HTMLElement>('.comments-scrim')!.click());
    expect(ask.mock.calls.map((c) => c[0])).toEqual([stuck, stuck]);
    expect(w.box()!.value).toBe('NUEVO');
    // Otro cuadro normal abierto además no cambia la pregunta: alcanza con uno que no pueda guardar.
    act(() => prefs.set({ language: 'es' }));
    await wait();
    await w.click('Cerrar los comentarios');
    expect(ask).toHaveBeenLastCalledWith(translate('es', 'comments.conflict.cancelStuck'));
  });
});

describe('el cartel de varios textos rechazados', () => {
  const rejected = (pageId: string, id: string, body: string) => ({
    op: { kind: 'edit' as const, id, pageId, body, at: new Date().toISOString(), base: 'Original' },
    attempted: true, failed: true, error: 'You can view this page but not comment on it.', queuedAt: Date.now(),
  });

  it('con más de uno, Retry y Discard dicen que valen para todos y la confirmación lo dice en plural; con uno solo, como siempre', async () => {
    const w = await world();
    await w.phone.commentsDb.add('outbox', rejected(w.page, w.id, 'Primera'));
    await act(async () => w.phone.comments.load());
    await wait();
    const cartel = () => w.panel().querySelector<HTMLElement>('.comment-error')!;
    const labels = () => [...cartel().querySelectorAll('button')].map((b) => b.textContent);
    expect(labels()).toEqual(['Retry', 'Copy text', 'Discard…']);
    await w.click('Discard…', 0, cartel());
    expect(cartel().textContent).toContain('Discarding the edit: the comment comes back as it is on the server.');
    expect(labels()).toEqual(['Copy text', 'Discard', 'Cancel']);
    await w.click('Cancel', 0, cartel());
    await w.phone.commentsDb.add('outbox', rejected(w.page, w.id, 'Segunda'));
    await w.phone.commentsDb.add('outbox', rejected(w.page, w.id, 'Tercera'));
    await act(async () => w.phone.comments.load());
    await wait();
    expect(labels()).toEqual(['Copy text', 'Copy text', 'Copy text', 'Retry all 3', 'Discard all 3…']);
    await w.click('Discard all 3…', 0, cartel());
    expect(cartel().textContent).toContain('Discarding the 3 edits: the comment comes back as it is on the server.');
    expect(cartel().textContent).not.toContain('Discarding the edit:');
    expect(labels()).toEqual(['Copy text', 'Copy text', 'Copy text', 'Discard all 3', 'Cancel']);
    // En castellano.
    act(() => prefs.set({ language: 'es' }));
    await wait();
    expect(cartel().textContent).toContain('Se descartan las 3 ediciones: el comentario vuelve a como está en el servidor.');
    expect(labels().slice(3)).toEqual(['Descartar los 3', 'Cancelar']);
    await w.click('Cancelar', 0, cartel());
    expect(labels().slice(3)).toEqual(['Reintentar los 3', 'Descartar los 3…']);
    act(() => prefs.set({ language: 'en' }));
    await wait();
    // Y de verdad valen para todos: descartar se lleva los tres.
    await w.click('Discard all 3…', 0, cartel());
    await w.click('Discard all 3', 0, cartel());
    await wait();
    expect(await w.outbox()).toEqual([]);
    expect(w.panel().querySelector('.comment-error')).toBeNull();
  });

  it('la lista de un comentario no suma los textos rechazados de otros comentarios', async () => {
    const w = await world();
    const other = await w.phone.comments.add(w.page, null, 'Otro hilo');
    await w.sync(w.phone);
    await w.phone.commentsDb.add('outbox', rejected(w.page, w.id, 'De Original, una'));
    await w.phone.commentsDb.add('outbox', rejected(w.page, w.id, 'De Original, dos'));
    await w.phone.commentsDb.add('outbox', rejected(w.page, other, 'Del otro hilo'));
    await act(async () => w.phone.comments.load());
    await wait();
    const carteles = [...w.panel().querySelectorAll<HTMLElement>('.comment-error')];
    expect(carteles).toHaveLength(2);
    const rows = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('.comment-rejected-text')].map((r) => r.querySelector('span')!.textContent);
    const [first, second] = carteles[0].closest('.comment-thread')!.textContent!.includes('Otro hilo') ? [carteles[1], carteles[0]] : carteles;
    expect(rows(first)).toEqual(['De Original, una', 'De Original, dos']);
    expect(first.textContent).toContain('2 texts you wrote for this comment were not accepted.');
    expect(first.textContent).not.toContain('Del otro hilo');
    // El otro comentario, con uno solo: sin lista y con los botones de siempre.
    expect(rows(second)).toEqual([]);
    expect([...second.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Retry', 'Copy text', 'Discard…']);
  });
});

describe('los textos', () => {
  it('la ayuda lo explica y la búsqueda lo encuentra, con el nombre del botón', () => {
    const ids = (q: string, lang: 'en' | 'es' = 'en') => searchHelp(HELP_ENTRIES, q, lang).map((h) => h.entry.id);
    expect(ids('thread is resolved while')).toContain('commentBoxKept');
    expect(ids('a medio escribir', 'es')).toContain('commentBoxKept');
    const entry = HELP_ENTRIES.find((e) => e.id === 'commentBoxKept')!;
    expect(entry.section).toBe('comments');
    for (const lang of ['en', 'es'] as const) {
      expect(translate(lang, entry.text)).toContain(translate(lang, 'sync.copyText'));
      expect(translate(lang, entry.text)).toContain(translate(lang, 'common.cancel'));
    }
    // Llegó después de la v0.228: sale en las novedades de quien venía de ahí.
    expect(isValidSince(entry.since)).toBe(true);
    expect(isNewer(entry.since, '0.228')).toBe(true);
  });

  it('están en los dos idiomas', () => {
    const keys = [
      'comments.resolvedWhileWriting', 'comments.reopenedWhileWriting', 'comments.gone.editing', 'comments.gone.replying',
      'comments.gone.cancel', 'comments.draftClosed', 'comments.retryAll', 'comments.discardAllEllipsis', 'comments.discardAll',
      'commentError.editUnknown',
    ] as const;
    for (const key of keys) {
      expect(translate('en', key, { count: 2 }), key).not.toBe(key);
      expect(translate('es', key, { count: 2 }), key).not.toBe(translate('en', key, { count: 2 }));
    }
  });
});
