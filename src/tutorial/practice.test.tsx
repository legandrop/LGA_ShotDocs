// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { settled } from '../test/settle';
import { closeHelp } from '../help/helpUi';
import { prefs } from '../prefs';
import { navigate, pagePath } from '../router';
import { ServicesContext, type Services } from '../services';
import { FileRejected } from '../sync/files';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { closeFindBar } from '../ui/findUi';
import { setNavOpen } from '../ui/navStore';
import { Shell } from '../ui/Workspace';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { PracticeWriteError, practiceSession } from './practiceServices';
import { practiceEn } from './practice.en';
import { practiceBlocks, PRACTICE_BLOCKS, PRACTICE_ID } from './practiceTemplate';
import { dismissTour, getTourUi, readDeviceTour, startTour } from './tourState';
// El editor de la página se carga aparte la primera vez que se muestra. Acá se arma antes de las pruebas: si no, la
// primera que monta una página pagaba ese armado (cientos de módulos) dentro de su plazo, y con la máquina cargada no
// le alcanzaba (y una prueba que se corta por tiempo deja a las que siguen en el archivo sin poder dibujar).
import '../ui/PageEditor';

// La página de práctica y la recorrida con la app de verdad (Shell, barra lateral, editor, comentarios) sobre el
// servidor en memoria (Docs/Doc_Tutorial.md, "Entregas y pruebas", entrega 2):
// - Aislamiento: todo lo que se hace en la práctica deja cero escrituras en el servidor, la base local, las colas
//   y `localStorage`; los contadores de "sin subir" y los avisos al salir no cambian.
// - El motor: arranca sola la primera vez, numera bien, Siguiente / Atrás / →, ← / Esc, se pausa al salir de la
//   práctica, `aria-live`, y al terminar queda vista en el dispositivo y en la cuenta.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 90_000 });

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as never;
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) });
  Range.prototype.getClientRects ??= (() => []) as never;
  Range.prototype.getBoundingClientRect ??= empty as never;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollTo ??= function () {} as never;
  Element.prototype.scrollIntoView ??= function () {} as never;
});

const roots: Root[] = [];
const devices: Device[] = [];
afterEach(async () => {
  act(() => {
    dismissTour();
    closeHelp();
    closeFindBar();
    setNavOpen(false);
  });
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  document.body.innerHTML = '';
  localStorage.clear();
  history.replaceState(null, '', '/');
  act(() => prefs.set({ language: 'en' }));
});

// El rato pedido y, después, a que termine lo que quedó en marcha (src/test/settle.ts).
const wait = (ms = 30) => act(() => settled(ms));
async function until(check: () => unknown, what: string, tries = 300): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (check()) return;
    await wait(40);
  }
  throw new Error(`no llegó: ${what}`);
}

interface Harness {
  host: HTMLElement;
  d: Device;
  server: FakeServer;
  services: Services;
  /** Lo que el cliente de Supabase anotó en los metadatos del usuario. */
  metadata: Record<string, unknown>;
}

async function app({ route = '/', firstLoad = false, accountSeen = false } = {}): Promise<Harness> {
  const server = new FakeServer();
  server.enableComments();
  const d = await makeDevice(server);
  devices.push(d);
  const brief = await d.tree.create(null, 'Brief');
  await d.tree.create(brief, 'Referencias');
  await d.engine.syncNow();
  const metadata: Record<string, unknown> = accountSeen ? { shotdocs_tour: 1 } : {};
  const client = {
    auth: {
      signOut: vi.fn(),
      getSession: async () => ({ data: { session: { user: { id: d.remote.userId, user_metadata: { ...metadata } } } }, error: null }),
      updateUser: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(metadata, data);
        return { data: {}, error: null };
      },
    },
  };
  const services = {
    workspace: { config: { url: 'https://x.supabase.co', publishableKey: 'k', name: 'W', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) }, client },
    client,
    user: { id: d.remote.userId, email: 'a@test' },
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
    firstLoad,
  } as unknown as Services;
  history.replaceState(null, '', route);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <ServicesContext.Provider value={services}>
        <Shell />
      </ServicesContext.Provider>,
    ),
  );
  return { host, d, server, services, metadata };
}

const question = () => document.querySelector(`.bn-editor [data-id="${PRACTICE_BLOCKS.question}"]`);
const editorView = () => (document.querySelector('.bn-editor') as unknown as { editor: { view: import('@tiptap/pm/view').EditorView } }).editor.view;
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === text);

/** Todo lo que el dispositivo y el servidor tienen escrito (para comparar antes y después). */
async function snapshot(h: Harness) {
  const { d, server } = h;
  const status = d.engine.getStatus();
  return {
    updates: [...server.updates.values()].reduce((n, list) => n + list.length, 0),
    pages: server.pages.size,
    serverComments: server.comments.size,
    files: server.files.size + server.mediaFiles.size,
    meta: JSON.stringify(await d.db.getAll('meta')),
    metaKeys: JSON.stringify(await d.db.getAllKeys('meta')),
    treeOps: d.tree.pendingOps().length,
    pending: status.pendingOps + status.pendingPages + status.pendingFiles + status.pendingMedia + status.pendingComments,
    commentsQueue: d.comments.status().pending,
    unsaved: d.docs.hasUnsavedEdits() || d.tree.hasUnsavedWrites() || d.media.hasUnsavedWrites() || d.comments.hasUnsavedWrites(),
    storage: Object.keys(localStorage)
      // Las novedades de la ayuda se cuentan al abrir la app, cuando el navegador está libre (no es la práctica).
      .filter((k) => k !== 'shotdocs-expanded' && k !== 'shotdocs-help-news')
      .sort()
      .map((k) => `${k}=${localStorage.getItem(k)}`),
  };
}

describe('la plantilla de la práctica', () => {
  it('las tres fotos en un solo renglón, en línea y a la misma altura (como "Arrange in rows")', () => {
    const blocks = practiceBlocks(practiceEn, 'https://app.test') as { id?: string; type: string; content?: unknown }[];
    expect(blocks.some((b) => b.type === 'image')).toBe(false);
    const row = blocks.find((b) => b.id === PRACTICE_BLOCKS.photos)!;
    expect(row.type).toBe('paragraph');
    const photos = row.content as { type: string; props: { url: string; name: string; w: number } }[];
    expect(photos.map((p) => p.type)).toEqual(['photo', 'photo', 'photo']);
    expect(photos[0].props.url).toBe('https://app.test/tutorial/terraza-1.webp');
    // Una sola fila: los anchos más los dos espacios llenan el renglón, y la altura (ancho / proporción) es la misma.
    const total = photos.reduce((n, p) => n + p.props.w, 0);
    expect(total).toBeGreaterThan(0.95);
    expect(total).toBeLessThanOrEqual(1);
    const heights = photos.map((p, i) => p.props.w / [1200 / 800, 800 / 1200, 1200 / 675][i]);
    for (const h of heights) expect(h).toBeCloseTo(heights[0], 3);
  });
});

describe('la página de práctica no toca nada real', () => {
  it('escribir, comentar, contestar la pregunta, cambiar la hoja, buscar y empezar de nuevo: cero escrituras', async () => {
    const h = await app();
    await until(() => h.host.querySelector('.tree'), 'el árbol');
    await wait(200);
    const before = await snapshot(h);

    act(() => {
      history.pushState(null, '', '/practice');
      window.dispatchEvent(new Event('shotdocs:navigate'));
    });
    await until(() => question(), 'la práctica con su pregunta');
    expect(document.querySelector(`article.page[data-page-id="${PRACTICE_ID}"] .page-header`)).not.toBeNull();
    expect(h.host.querySelector('.practice-banner')?.textContent).toContain("Practice page: nothing you do here is saved or seen by anyone.");
    const session = practiceSession(h.services)!;
    expect(session).toBeTruthy();

    // Las fotos de ejemplo van en el renglón, como las crea hoy la app al pegar o soltar (no la fila vieja de
    // fotos-bloque), y se ven con la dirección de la app.
    const photos = [...document.querySelectorAll(`.bn-editor [data-id="${PRACTICE_BLOCKS.photos}"] .sd-photo`)];
    expect(photos.map((p) => p.getAttribute('data-name'))).toEqual(['terraza-1.webp', 'terraza-2.webp', 'terraza-3.webp']);
    expect(photos.map((p) => p.querySelector('img')?.getAttribute('src'))).toEqual(
      ['terraza-1.webp', 'terraza-2.webp', 'terraza-3.webp'].map((f) => `${location.origin}/tutorial/${f}`),
    );
    expect(document.querySelector('.bn-editor [data-content-type="image"]')).toBeNull();

    // Escribir en el editor (el de verdad, con el documento en memoria).
    const view = editorView();
    act(() => view.dispatch(view.state.tr.insertText('Hola práctica ', 1)));
    await wait(100);
    expect(session.doc.getXmlFragment('blocks').toString() + view.state.doc.textContent).toContain('Hola práctica');

    // Comentarios: abrir el panel, comentar un bloque, contestar la pregunta y resolver su hilo.
    click(h.host.querySelector('[data-tour="comments"]'));
    await until(() => document.querySelector('.comments-panel'), 'el panel de comentarios');
    const comments = session.services.comments;
    const [thread] = comments.threads(PRACTICE_ID);
    expect(thread.blockId).toBe(PRACTICE_BLOCKS.question);
    expect(thread.count).toBe(2);
    await act(async () => {
      await comments.add(PRACTICE_ID, thread.blockId, 'Una respuesta más', thread.id);
      await comments.add(PRACTICE_ID, PRACTICE_BLOCKS.empty, 'Un comentario nuevo');
      await comments.resolve(PRACTICE_ID, thread.id, true);
    });
    expect(comments.threads(PRACTICE_ID).map((t) => [t.count, t.resolved])).toEqual([
      [1, false],
      [3, true],
    ]);

    // La hoja (en memoria) y la barra de buscar.
    click(h.host.querySelector('[data-tour="page-menu"]'));
    click(button('A4'));
    await wait(50);
    expect(h.host.querySelector('article.page.practice')?.classList.contains('sheet')).toBe(true);
    click(h.host.querySelector('[data-tour="find"]'));
    await until(() => document.querySelector('.find-bar'), 'la barra de buscar');

    // Agregar un archivo avisa y no hace nada.
    await expect(session.services.files.add(PRACTICE_ID, new Blob(['x'], { type: 'image/png' }))).rejects.toBeInstanceOf(FileRejected);
    await expect(session.services.media.add(PRACTICE_ID, new Blob(['x'], { type: 'application/pdf' }))).rejects.toThrow(
      "Files aren't uploaded on the practice page",
    );

    // Lo que escribiría algo real tira en vez de escribir.
    expect(() => session.services.tree.create(null, 'x')).toThrow(PracticeWriteError);
    expect(() => session.services.docs.open(PRACTICE_ID)).toThrow(PracticeWriteError);
    expect(() => session.services.engine.syncNow()).toThrow(PracticeWriteError);
    // "Available offline": la práctica solo lee lo marcado; ni marca, ni baja, ni libera.
    expect(() => session.services.offline.mark('page', PRACTICE_ID)).toThrow(PracticeWriteError);
    expect(() => session.services.offline.freeUp('all')).toThrow(PracticeWriteError);
    expect(session.services.offline.getSnapshot()).toBeTruthy();
    expect(() => session.services.remote.ensureWorkspace()).toThrow(PracticeWriteError);
    expect(() => session.services.client.auth.signOut()).toThrow(PracticeWriteError);

    // Empezar de nuevo: otro documento, con el hilo de ejemplo como al principio.
    click(button('Start over'));
    await until(() => practiceSession(h.services) !== session && question(), 'la práctica de nuevo');
    expect(practiceSession(h.services)!.services.comments.threads(PRACTICE_ID).map((t) => t.count)).toEqual([2]);

    // Salir: vuelve a lo de siempre.
    click(button('Exit'));
    await until(() => !question(), 'salir');
    await act(async () => {
      await h.d.engine.syncNow();
    });
    await wait(300);
    const after = await snapshot(h);
    expect(after).toEqual(before);
  });

  it('la vista previa de una plantilla (entrega 0 de Doc_Plantillas): las tres, en los dos idiomas, sin escribir nada', async () => {
    const h = await app();
    await until(() => h.host.querySelector('.tree'), 'el árbol');
    await wait(200);
    const before = await snapshot(h);

    act(() => {
      history.pushState(null, '', '/practice?template=on-set');
      window.dispatchEvent(new Event('shotdocs:navigate'));
    });
    const editorText = () => document.querySelector('.bn-editor')?.textContent ?? '';
    await until(() => editorText().includes('Camera package'), 'On-Set Report');
    expect(h.host.querySelector('.practice-banner')?.textContent).toContain('Template preview: nothing you write here is saved');
    expect(h.host.querySelector('.breadcrumbs')?.textContent).toBe('Template preview');
    expect(h.host.querySelector<HTMLTextAreaElement>('article.page.practice .page-title')?.value).toBe('On-Set Report');
    expect(question()).toBeNull();
    // Sin el hilo de ejemplo (cuelga de la pregunta del ejemplo).
    expect(practiceSession(h.services)!.services.comments.threads(PRACTICE_ID)).toEqual([]);
    expect(document.querySelectorAll('.bn-editor table').length).toBe(6);
    expect(button('On-Set Report')?.getAttribute('aria-pressed')).toBe('true');

    // Escribir en la vista previa no guarda nada.
    const view = editorView();
    act(() => view.dispatch(view.state.tr.insertText('Prueba ', 1)));
    await wait(50);

    // El mismo contenido en castellano, sin cambiar el idioma de la interfaz.
    click(button('Español'));
    await until(() => editorText().includes('Equipo de cámara'), 'el reporte en castellano');
    expect(location.search).toBe('?template=on-set&lang=es');
    expect(h.host.querySelector<HTMLTextAreaElement>('article.page.practice .page-title')?.value).toBe('Reporte de rodaje');
    expect(h.host.querySelector('.breadcrumbs')?.textContent).toBe('Template preview');

    click(button('Shot Breakdown'));
    await until(() => editorText().includes('Cuadro de referencia'), 'el desglose en castellano');
    click(button('Pre-production Notes'));
    await until(() => editorText().includes('Elementos a filmar'), 'la preproducción en castellano');
    expect(document.querySelector('.bn-editor [data-content-type="paragraph"] .script-line, .bn-editor .question-line')).not.toBeNull();

    click(button('Exit'));
    await until(() => !document.querySelector('.practice-banner'), 'salir');
    await act(async () => {
      await h.d.engine.syncNow();
    });
    await wait(300);
    expect(await snapshot(h)).toEqual(before);
  });

  it('Exit de la vista previa de una plantilla vuelve a la página desde donde se abrió', async () => {
    const h = await app();
    await until(() => h.host.querySelector('.tree'), 'el árbol');
    const [brief] = h.d.tree.roots(h.d.tree.workspaceId);
    const inside = h.d.tree.children(brief.id)[0].id;
    // Se abre una página, después otra (la última abierta), y desde esa la vista previa, como hace la ventana Templates.
    act(() => navigate(pagePath(brief.id)));
    await until(() => h.host.querySelector(`article.page[data-page-id="${brief.id}"]`), 'la primera página');
    act(() => navigate(pagePath(inside)));
    await until(() => h.host.querySelector(`article.page[data-page-id="${inside}"]`), 'la segunda página');
    act(() => navigate('/practice?template=on-set'));
    await until(() => h.host.querySelector('.practice-banner'), 'la vista previa');
    // Cambiar de plantilla adentro de la vista previa no cambia a dónde se vuelve.
    click(button('Shot Breakdown'));
    await until(() => location.search === '?template=shot-breakdown&lang=en', 'la otra plantilla');
    click(button('Exit'));
    await until(() => h.host.querySelector(`article.page[data-page-id="${inside}"]`), 'la página de antes');
    expect(location.pathname).toBe(pagePath(inside));
  });

  it('la práctica de una instancia de servicios no aparece en otra (otro workspace, otra sesión)', async () => {
    const a = await app({ route: '/practice' });
    await until(() => question(), 'la práctica');
    expect(practiceSession(a.services)).toBeTruthy();
    const other = { ...a.services } as Services;
    expect(practiceSession(other)).toBeUndefined();
  });
});

describe('la recorrida', () => {
  const bubble = () => document.querySelector<HTMLElement>('.tour-bubble');
  const count = () => bubble()?.querySelector('.mono-label')?.textContent;
  const press = (key: string) =>
    act(() => void bubble()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));

  it('la primera vez arranca sola en la práctica; Siguiente, Atrás, flechas; al terminar queda vista en el dispositivo y la cuenta', async () => {
    const h = await app({ firstLoad: true });
    await until(() => bubble(), 'el globito');
    await until(() => location.pathname === '/practice', 'la práctica');
    expect(count()).toBe('1/10');
    expect(bubble()!.querySelector('h3')?.textContent).toBe('Hi!');
    expect(document.querySelector('.tour-live')?.textContent).toBe('Step 1 of 10: Hi!');
    // El foco va a "Siguiente".
    expect(document.activeElement?.textContent).toBe('Next');
    // Mientras dura, sin tooltips, y la app no se alcanza ni con el teclado (Tab hasta el "+" de verdad).
    expect(document.documentElement.dataset.tourRunning).toBe('1');
    expect(document.querySelector('.shell')?.hasAttribute('inert')).toBe(true);

    click(button('Next'));
    await until(() => count() === '2/10', 'el paso 2');
    press('ArrowRight');
    await until(() => count() === '3/10', 'el paso 3');
    expect(bubble()!.textContent).toContain('Ctrl+K finds pages and projects');
    press('ArrowLeft');
    await until(() => count() === '2/10', 'atrás');
    click(button('Back'));
    await until(() => count() === '1/10', 'el paso 1');
    expect(readDeviceTour()).toMatchObject({ done: false, step: 0 });

    // Hasta el final (el del menú "/" también avanza con Siguiente: nunca se traba).
    for (let i = 1; i < 10; i++) {
      click(bubble()!.querySelector('button.primary'));
      await until(() => count() === `${i + 1}/10` || !bubble(), `el paso ${i + 1}`);
    }
    expect(bubble()!.querySelector('button.primary')?.textContent).toBe('Finish');
    click(button('Finish'));
    await until(() => !bubble(), 'que termine');
    await wait(50);
    expect(readDeviceTour()).toEqual({ v: 1, done: true, step: null, account: true });
    expect(h.metadata.shotdocs_tour).toBe(1);
    expect(document.documentElement.dataset.tourRunning).toBeUndefined();
    expect(document.querySelector('.shell')?.hasAttribute('inert')).toBe(false);
  });

  it('Esc sale (cuenta como vista) y avisa que se puede volver a ver desde la ayuda', async () => {
    const h = await app({ firstLoad: true });
    await until(() => bubble(), 'el globito');
    press('Escape');
    await until(() => !bubble(), 'que salga');
    expect(h.host.querySelector('.notice')?.textContent).toContain('You can take the tour again from the help (?).');
    expect(readDeviceTour().done).toBe(true);
  });

  it('sin ancla a la vista el globito va centrado, sin foco de luz (nunca se traba)', async () => {
    await app({ firstLoad: true });
    await until(() => bubble(), 'el globito');
    click(button('Next'));
    await until(() => count() === '2/10', 'el paso 2');
    // En jsdom nada tiene tamaño: el ancla no se ve.
    expect(document.querySelector('.tour-spot')).toBeNull();
    expect(document.querySelector('.tour-dim')).not.toBeNull();
  });

  it('salir de la práctica a mitad la pone en pausa; Seguir vuelve al mismo paso', async () => {
    const h = await app({ firstLoad: true });
    await until(() => bubble(), 'el globito');
    click(button('Next'));
    await until(() => count() === '2/10', 'el paso 2');
    act(() => {
      history.pushState(null, '', '/trash');
      window.dispatchEvent(new Event('shotdocs:navigate'));
    });
    await until(() => h.host.ownerDocument.querySelector('.tour-card'), 'la tarjeta de pausa');
    expect(document.querySelector('.tour-card')?.textContent).toContain('Tour paused');
    click(button('Continue'));
    await until(() => location.pathname === '/practice' && count() === '2/10', 'seguir en el paso 2');
  });

  it('se recargó a mitad: la tarjeta de retomar, en el paso guardado', async () => {
    localStorage.setItem('shotdocs-tour', JSON.stringify({ v: 1, done: false, step: 3 }));
    await app();
    await until(() => document.querySelector('.tour-card'), 'la tarjeta');
    expect(document.querySelector('.tour-card')?.textContent).toContain('Continue the tour?');
    expect(document.querySelector('.tour-card')?.textContent).toContain('Step 4 of 10');
    click(button('Continue'));
    await until(() => count() === '4/10', 'el paso 4');
  });

  it('la cuenta dice que ya la vio: no arranca y queda el punto en el "?"; la ayuda la ofrece desde el paso 1', async () => {
    const h = await app({ firstLoad: true, accountSeen: true });
    await until(() => h.host.querySelector('.help-button'), 'la barra');
    await wait(300);
    expect(bubble()).toBeNull();
    expect(h.host.querySelector('.help-button')?.classList.contains('has-dot')).toBe(true);
    click(h.host.querySelector('.help-button'));
    await until(() => document.querySelector('[data-help-id="tour"] .help-action'), 'la ayuda');
    expect(h.host.querySelector('.help-button')?.classList.contains('has-dot')).toBe(false);
    click(document.querySelector('[data-help-id="tour"] .help-action'));
    await until(() => count() === '1/10', 'la recorrida desde el paso 1');
    expect(getTourUi().mode).toBe('running');
  });

  it('el punto de la recorrida también está en el botón de menú de la barra de arriba (teléfono), en la página y en la práctica', async () => {
    const dot = (h: Harness) => h.host.querySelector('.topbar button.only-mobile')?.classList.contains('has-dot');
    const help = (h: Harness) => h.host.querySelector('.help-button')?.classList.contains('has-dot');
    const h = await app({ firstLoad: true, accountSeen: true });
    await until(() => h.host.querySelector('.topbar button.only-mobile'), 'la barra de arriba');
    await wait(300);
    // Misma regla que el "?" del cajón: los dos con punto, y la ayuda abierta los apaga a los dos.
    expect(help(h)).toBe(true);
    expect(dot(h)).toBe(true);
    // En la práctica (otra barra de arriba) también.
    act(() => {
      history.pushState(null, '', '/practice');
      window.dispatchEvent(new Event('shotdocs:navigate'));
    });
    await until(() => question(), 'la práctica');
    expect(dot(h)).toBe(true);
    click(h.host.querySelector('.help-button'));
    await until(() => document.querySelector('[data-help-id="tour"] .help-action'), 'la ayuda');
    expect(help(h)).toBe(false);
    expect(dot(h)).toBe(false);
  });

  it('con un link de invitación: primero lo del link y la tarjeta de primera vez', async () => {
    localStorage.setItem(legacyStorageNames(WANKA_LOCAL_KEY).inviteTarget, 'a-page-id');
    await app({ firstLoad: true });
    await until(() => document.querySelector('.tour-card'), 'la tarjeta');
    expect(document.querySelector('.tour-card')?.textContent).toContain('First time here? A two-minute tour');
    expect(location.pathname).not.toBe('/practice');
    click(button('Not now'));
    await until(() => !document.querySelector('.tour-card'), 'que se vaya');
    expect(readDeviceTour().done).toBe(false);
    act(() => startTour());
    await until(() => count() === '1/10', 'la recorrida');
  });
});
