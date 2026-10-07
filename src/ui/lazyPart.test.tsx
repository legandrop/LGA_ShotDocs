// @vitest-environment jsdom
import { Component, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Las partes que se cargan aparte (roadmap B.4): el esqueleto mientras bajan, sin esperar después, y la
// recarga única con aviso cuando un pedazo ya no está (se publicó una versión nueva).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
beforeEach(() => {
  sessionStorage.clear();
  // Cada prueba con el módulo de cero (la recarga en curso y lo ya bajado viven en el módulo).
  vi.resetModules();
});
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const lazyModule = () => import('./lazyPart');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Con el reloj en manos de la prueba (`reloadSetup`), esperar es adelantarlo: pasan exactamente esos milisegundos para
// la app, tarde lo que tarde la máquina en llegar.
const wait = (ms = 30) => act(async () => void (vi.isFakeTimers() ? await vi.advanceTimersByTimeAsync(ms) : await sleep(ms)));

it('la readiness se consulta en sondeos y guarda final, con el mismo plazo local', async () => {
  const { watchPendingWrites, saveBeforeExit, reloadTimings } = await lazyModule();
  const owner = {};
  const prepared = vi.fn(async () => undefined);
  const action = vi.fn();
  let ready = false;
  const unwatch = watchPendingWrites({ owner, current: () => true, unsaved: () => false, flush: async () => undefined, prepare: prepared });
  const attempt = saveBeforeExit(owner, () => true, action, () => ready);
  await sleep(25); expect(action).not.toHaveBeenCalled(); ready = true;
  expect(await attempt).toBe(true); expect(prepared).toHaveBeenCalledTimes(1); expect(action).toHaveBeenCalledTimes(1);
  // La readiness pendiente no reinicia el plazo ni habilita una acción con datos incompletos.
  const previous = reloadTimings.saveWaitMs; reloadTimings.saveWaitMs = 25;
  try { expect(await saveBeforeExit(owner, () => true, action, () => false)).toBe(false); expect(action).toHaveBeenCalledTimes(1); }
  finally { reloadTimings.saveWaitMs = previous; unwatch(); }
});

it('lo que esperar no arregla corta en el acto: la preparación que ya falló y, al exportar, una causa conocida, que se avisa con su texto', async () => {
  const { watchPendingWrites, saveBeforeExit, reloadTimings } = await lazyModule();
  const notices: string[] = [];
  const onNotice = (e: Event) => notices.push(String((e as CustomEvent<string>).detail));
  window.addEventListener('shotdocs:notice', onNotice);
  const owner = {};
  const action = vi.fn();
  let blocked: string | null = null;
  const prepare = vi.fn(async (): Promise<void> => { throw new Error('el título no se pudo guardar'); });
  const unwatch = watchPendingWrites({ owner, current: () => true, unsaved: () => false, flush: async () => undefined, prepare, exportBlocked: () => blocked });
  // Con el plazo entero por delante: si se esperara, esta prueba no terminaría a tiempo.
  const previous = reloadTimings.saveWaitMs; reloadTimings.saveWaitMs = 60_000;
  try {
    const started = Date.now();
    expect(await saveBeforeExit(owner, () => true, action)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(notices).toEqual(['Some of your latest edits are not saved on this device yet. Wait a moment and try again.']);
    // Al exportar con una importación en curso: el aviso es la causa, y ni siquiera se prepara el título.
    prepare.mockResolvedValue(undefined);
    blocked = 'Hay una importación en curso';
    expect(await saveBeforeExit(owner, () => true, action, () => true, true)).toBe(false);
    expect(notices.at(-1)).toBe('Hay una importación en curso');
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();
    // Esa causa es de exportar: salir (recargar, cambiar de workspace) sigue con su propia cuenta.
    expect(await saveBeforeExit(owner, () => true, action)).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
    // Y si la causa aparece mientras se espera el guardado, corta ahí.
    let saving = true;
    const second = watchPendingWrites({ owner, current: () => true, unsaved: () => saving, unsavedForExport: () => saving, flush: async () => undefined, exportBlocked: () => blocked });
    blocked = null;
    const waiting = saveBeforeExit(owner, () => true, action, () => true, true);
    await sleep(50);
    blocked = 'Hay un reemplazo en curso';
    expect(await waiting).toBe(false);
    expect(notices.at(-1)).toBe('Hay un reemplazo en curso');
    saving = false;
    second();
  } finally {
    reloadTimings.saveWaitMs = previous;
    unwatch();
    window.removeEventListener('shotdocs:notice', onNotice);
  }
});

function render(node: ReactNode): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function Hello({ name }: { name: string }) {
  return <p className="hello">Hola {name}</p>;
}

function notices(): string[] {
  const seen: string[] = [];
  window.addEventListener('shotdocs:notice', (e) => seen.push((e as CustomEvent<string>).detail));
  return seen;
}

describe('una parte que se carga aparte', () => {
  it('muestra el esqueleto hasta que baja y después se dibuja sin esperar', async () => {
    const { lazyPart, Part } = await lazyModule();
    const load = deferred<typeof Hello>();
    const loader = vi.fn(() => load.promise);
    const Lazy = lazyPart(loader);

    const host = render(
      <Part fallback={<span className="skeleton" />}>
        <Lazy name="Ana" />
      </Part>,
    );
    expect(host.querySelector('.skeleton')).not.toBeNull();
    expect(host.querySelector('.hello')).toBeNull();

    await act(async () => load.resolve(Hello));
    await wait(400);
    expect(host.querySelector('.hello')?.textContent).toBe('Hola Ana');
    expect(host.querySelector('.skeleton')).toBeNull();

    // Ya bajada: otra vez en pantalla sale en el mismo dibujo, sin esqueleto.
    const again = render(
      <Part fallback={<span className="skeleton" />}>
        <Lazy name="Beto" />
      </Part>,
    );
    expect(again.querySelector('.hello')?.textContent).toBe('Hola Beto');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('preload la baja antes: al mostrarla no hay esqueleto', async () => {
    const { lazyPart, Part } = await lazyModule();
    const loader = vi.fn(async () => Hello);
    const Lazy = lazyPart(loader);
    Lazy.preload();
    Lazy.preload();
    await sleep(0);
    const host = render(
      <Part fallback={<span className="skeleton" />}>
        <Lazy name="Ana" />
      </Part>,
    );
    expect(host.querySelector('.hello')).not.toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('un preload que falla no avisa ni recarga: se vuelve a intentar al mostrarla', async () => {
    const { lazyPart, Part, pageReload } = await lazyModule();
    const reload = vi.spyOn(pageReload, 'now').mockImplementation(() => undefined);
    const seen = notices();
    const loader = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(Hello);
    const Lazy = lazyPart<{ name: string }>(loader);
    Lazy.preload();
    await sleep(10);
    expect(seen).toEqual([]);
    const host = render(
      <Part>
        <Lazy name="Ana" />
      </Part>,
    );
    await wait(400);
    expect(host.querySelector('.hello')).not.toBeNull();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  /**
   * Tiempos cortos para no esperar de verdad; `leaves`: la recarga dispara `pagehide` (la página se va).
   *
   * La recarga es una secuencia de plazos (esperar el guardado, mostrar el aviso, ver si la página se va) y estas
   * pruebas miran qué hay en cada momento. Contra el reloj de verdad, con la máquina cargada la prueba llegaba tarde a
   * mirar y encontraba el paso siguiente. Por eso el reloj lo maneja la prueba: los plazos de la app y lo que la
   * prueba espera corren en el mismo tiempo, y el orden de lo que pasa es siempre el mismo.
   */
  async function reloadSetup({ leaves = true } = {}) {
    const mod = await lazyModule();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    Object.assign(mod.reloadTimings, { noticeMs: 100, saveWaitMs: 300, pagehideMs: 150 });
    const reload = vi.spyOn(mod.pageReload, 'now').mockImplementation(() => {
      if (leaves) window.dispatchEvent(new Event('pagehide'));
    });
    return { ...mod, reload, seen: notices() };
  }
  const failing = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'));

  it('si no baja (versión nueva): espera lo que falta guardar, recién ahí avisa, y recarga una sola vez', async () => {
    const { lazyPart, Part, watchPendingWrites, newVersionNotice, reload, seen } = await reloadSetup();
    // Hay una edición a medio guardar: la recarga espera a que termine.
    let unsaved = true;
    const flush = vi.fn(async () => {
      await sleep(150);
      unsaved = false;
    });
    const unwatch = watchPendingWrites({ unsaved: () => unsaved, flush });
    const Editor = lazyPart<{ name: string }>(failing);
    const Dialog = lazyPart<{ name: string }>(failing);

    const host = render(
      <>
        <Part fallback={<span className="skeleton" />}>
          <Editor name="Ana" />
        </Part>
        <Part onClose={() => undefined}>
          <Dialog name="Beto" />
        </Part>
      </>,
    );
    await wait(30);
    // Todavía guardando: el aviso de recargar sale recién cuando se va a recargar.
    expect(seen).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
    // Mientras tanto sigue el esqueleto (nada de avisos de error).
    expect(host.querySelector('.skeleton')).not.toBeNull();
    expect(host.querySelector('.part-error, .part-error-dialog')).toBeNull();

    await wait(100);
    expect(flush).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    await wait(300);
    expect(unsaved).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([newVersionNotice()]);
    // La página se va: sigue el esqueleto hasta el final.
    await wait(300);
    expect(host.querySelector('.skeleton')).not.toBeNull();
    unwatch();

    // Después de recargar sigue sin bajar: no se recarga en bucle, queda el aviso con el botón.
    vi.resetModules();
    const fresh = await lazyModule();
    const reloadAgain = vi.spyOn(fresh.pageReload, 'now').mockImplementation(() => undefined);
    const Again = fresh.lazyPart<{ name: string }>(failing);
    const second = render(
      <fresh.Part fallback={<span className="skeleton" />}>
        <Again name="Ana" />
      </fresh.Part>,
    );
    await wait(50);
    expect(second.querySelector('.part-error')?.textContent).toContain('could not be loaded');
    expect(reloadAgain).not.toHaveBeenCalled();
    await act(async () => second.querySelector<HTMLButtonElement>('.part-error button')!.click());
    expect(reloadAgain).toHaveBeenCalledTimes(1);
  });

  it('si la persona elige quedarse en el aviso del navegador, la parte muestra el aviso (no queda colgada)', async () => {
    const { lazyPart, Part, reload } = await reloadSetup({ leaves: false });
    const Lazy = lazyPart<{ name: string }>(failing);
    const host = render(
      <Part fallback={<span className="skeleton" />}>
        <Lazy name="Ana" />
      </Part>,
    );
    await wait(150);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.skeleton')).not.toBeNull();
    await wait(250);
    expect(host.querySelector('.skeleton')).toBeNull();
    expect(host.querySelector('.part-error button')?.textContent).toBe('Reload');
  });

  it('con un comentario escrito sin mandar no recarga sola; "Reload" pregunta antes', async () => {
    const { lazyPart, Part, reload, seen } = await reloadSetup();
    const { setDraft } = await import('./commentsUi');
    const draft = Symbol('borrador');
    setDraft(draft, true);
    const Lazy = lazyPart<{ name: string }>(failing);
    const host = render(
      <Part>
        <Lazy name="Ana" />
      </Part>,
    );
    await wait(400);
    expect(seen).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
    expect(host.querySelector('.part-error')?.textContent).toContain('not sent');

    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => host.querySelector<HTMLButtonElement>('.part-error button')!.click());
    expect(ask).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    ask.mockReturnValue(true);
    await act(async () => host.querySelector<HTMLButtonElement>('.part-error button')!.click());
    expect(reload).toHaveBeenCalledTimes(1);
    setDraft(draft, false);
  });

  it('si lo escrito no termina de guardarse en el tope, no recarga sola', async () => {
    const { lazyPart, Part, watchPendingWrites, reload } = await reloadSetup();
    const unwatch = watchPendingWrites({ unsaved: () => true, flush: async () => undefined });
    const Lazy = lazyPart<{ name: string }>(failing);
    const host = render(
      <Part>
        <Lazy name="Ana" />
      </Part>,
    );
    await wait(250);
    expect(host.querySelector('.part-error')).toBeNull();
    await wait(500);
    expect(reload).not.toHaveBeenCalled();
    expect(host.querySelector('.part-error')?.textContent).toContain('not saved yet');
    unwatch();
  });

  it('sin red y sin service worker no recarga; cuando vuelve la red lo intenta de nuevo', async () => {
    const { lazyPart, Part, reload } = await reloadSetup();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const loader = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(Hello);
    const Lazy = lazyPart<{ name: string }>(loader);
    const host = render(
      <Part>
        <Lazy name="Ana" />
      </Part>,
    );
    await wait(50);
    expect(host.querySelector('.part-error')?.textContent).toContain('Connect to the internet');
    expect(reload).not.toHaveBeenCalled();

    online.mockReturnValue(true);
    await act(async () => window.dispatchEvent(new Event('online')));
    await wait(400);
    expect(host.querySelector('.hello')?.textContent).toBe('Hola Ana');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('un diálogo que no baja avisa como diálogo; cerrarlo y volver a abrirlo lo intenta de nuevo', async () => {
    const { lazyPart, Part, reload } = await reloadSetup();
    sessionStorage.setItem('shotdocs-part-reload', String(Date.now())); // ya recargó: no recarga otra vez
    const loader = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(Hello);
    const Dialog = lazyPart<{ name: string }>(loader);
    const onClose = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const show = (open: boolean) =>
      act(() =>
        root.render(
          open ? (
            <Part onClose={onClose}>
              <Dialog name="Ana" />
            </Part>
          ) : null,
        ),
      );
    show(true);
    await wait(50);
    const dialog = host.querySelector('.part-error-dialog');
    expect(dialog?.getAttribute('role')).toBe('alertdialog');
    const buttons = [...dialog!.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).toEqual(['Close', 'Reload']);
    await act(async () => dialog!.querySelector<HTMLButtonElement>('button')!.click());
    expect(onClose).toHaveBeenCalledTimes(1);

    show(false);
    show(true);
    await wait(400);
    expect(host.querySelector('.hello')?.textContent).toBe('Hola Ana');
    expect(reload).not.toHaveBeenCalled();
  });

  it('vite:preloadError (un archivo del import que ya no está) también recarga una vez con el aviso', async () => {
    const { listenForMissingFiles, newVersionNotice, reload, seen } = await reloadSetup();
    const stop = listenForMissingFiles();
    const event = Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload: new Error('x') });
    window.dispatchEvent(event);
    window.dispatchEvent(event);
    await wait(250);
    expect(seen).toEqual([newVersionNotice()]);
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it('un import opcional que no baja (el decodificador de fotos HEIC sin red) no recarga ni avisa; los demás sí', async () => {
    const { listenForMissingFiles, newVersionNotice, reload, seen } = await reloadSetup();
    const { optionalImport } = await import('../lib/optionalImport');
    const stop = listenForMissingFiles();
    const missing = () => new TypeError('Failed to fetch dynamically imported module: /assets/heicLib-x.js');
    // Como el ayudante de Vite: avisa con `vite:preloadError` y después rechaza el import.
    const viteImport = (err: Error) => {
      window.dispatchEvent(Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload: err }));
      return Promise.reject(err);
    };
    const err = missing();
    await expect(optionalImport(() => viteImport(err))).rejects.toBe(err);
    await wait(250);
    expect(seen).toEqual([]);
    expect(reload).not.toHaveBeenCalled();

    // La conversión de verdad (heicConvert.ts) sin el decodificador: termina en "no está", sin recargar.
    vi.doMock('../media/heicLib', () => {
      const failed = missing();
      window.dispatchEvent(Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload: failed }));
      throw failed;
    });
    const { convertHeic } = await import('../media/heicConvert');
    await expect(convertHeic(new Blob([new Uint8Array([1, 2, 3])]))).rejects.toMatchObject({ reason: 'unavailable' });
    await wait(250);
    expect(seen).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
    vi.doUnmock('../media/heicLib');

    // Fuera de un import opcional, el mismo evento sigue siendo una versión nueva.
    await viteImport(missing()).catch(() => undefined);
    await wait(250);
    expect(seen).toEqual([newVersionNotice()]);
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it('otros errores siguen de largo como antes (la caja es solo para lo que no bajó)', async () => {
    const { lazyPart, Part } = await lazyModule();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Broken(): ReactNode {
      throw new Error('roto');
    }
    const Lazy = lazyPart(async () => Broken);
    Lazy.preload();
    await sleep(0);
    class Outer extends Component<{ children: ReactNode }, { error: string | null }> {
      state = { error: null as string | null };
      static getDerivedStateFromError(e: Error) {
        return { error: e.message };
      }
      render() {
        return this.state.error ? <p className="outer">{this.state.error}</p> : this.props.children;
      }
    }
    const host = render(
      <Outer>
        <Part>
          <Lazy />
        </Part>
      </Outer>,
    );
    await wait(10);
    expect(host.querySelector('.outer')?.textContent).toBe('roto');
    expect(host.querySelector('.part-error')).toBeNull();
  });
});
