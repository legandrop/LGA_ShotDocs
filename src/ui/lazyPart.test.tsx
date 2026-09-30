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
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const lazyModule = () => import('./lazyPart');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const wait = (ms = 30) => act(async () => sleep(ms));

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

  it('si no baja (versión nueva): avisa, espera lo que falta guardar y recarga una sola vez', async () => {
    const { lazyPart, Part, pageReload, watchPendingWrites, NEW_VERSION_NOTICE } = await lazyModule();
    const reload = vi.spyOn(pageReload, 'now').mockImplementation(() => undefined);
    const seen = notices();
    // Hay una edición a medio guardar: la recarga espera a que termine.
    let unsaved = true;
    const flush = vi.fn(async () => {
      await sleep(200);
      unsaved = false;
    });
    const unwatch = watchPendingWrites({ unsaved: () => unsaved, flush });
    const failing = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'));
    const Editor = lazyPart<{ name: string }>(failing);
    const Dialog = lazyPart<{ name: string }>(failing);

    const host = render(
      <>
        <Part fallback={<span className="skeleton" />}>
          <Editor name="Ana" />
        </Part>
        <Part>
          <Dialog name="Beto" />
        </Part>
      </>,
    );
    await wait(50);
    expect(seen).toEqual([NEW_VERSION_NOTICE]);
    expect(reload).not.toHaveBeenCalled();
    // Mientras tanto sigue el esqueleto (nada de cajas de error).
    expect(host.querySelector('.skeleton')).not.toBeNull();
    expect(host.querySelector('.part-error')).toBeNull();

    await wait(1500);
    expect(flush).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    await wait(400);
    expect(unsaved).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([NEW_VERSION_NOTICE]);
    unwatch();

    // Después de recargar sigue sin bajar: no se recarga en bucle, queda una caja con el botón.
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

  it('sin red y sin service worker no recarga (dejaría la pantalla sin conexión del navegador)', async () => {
    const { lazyPart, Part, pageReload } = await lazyModule();
    const reload = vi.spyOn(pageReload, 'now').mockImplementation(() => undefined);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const Lazy = lazyPart<{ name: string }>(() => Promise.reject(new TypeError('Failed to fetch')));
    const host = render(
      <Part>
        <Lazy name="Ana" />
      </Part>,
    );
    await wait(50);
    expect(host.querySelector('.part-error')?.textContent).toContain('Connect to the internet');
    expect(reload).not.toHaveBeenCalled();
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
