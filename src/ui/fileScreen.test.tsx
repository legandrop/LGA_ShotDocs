// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';

// La pantalla de la dirección fija de un archivo (P.30, Docs/Doc_Links_PDF.md, 2.3 y 2.4): decide solo la base
// (`media_file`, o `plink_media_files` con un link), "no existe" y "sin acceso" son la misma pantalla sin nada del
// archivo, y con permiso abre el visor que corresponde.

const rpc = vi.fn();
const fileInfo = vi.fn();
let online = true;
let schemaVersion: number | null = null;
let link: { entry: { localKey: string } } | null = null;

// Los servicios son los mismos en cada dibujo (como en la app).
const services = { client: { rpc }, media: { fileInfo }, files: {}, workspace: { config: { localKey: 'wanka_1' } } };
vi.mock('../services', () => ({
  useServices: () => services,
  useSyncStatus: () => ({ online, schemaVersion }),
}));
vi.mock('../linkMode', () => ({ useLinkMode: () => link }));
vi.mock('./AttachmentSheet', () => ({ AttachmentSheet: ({ fileId }: { fileId: string }) => <div data-testid="sheet">{fileId}</div> }));
vi.mock('./FolderViewer', () => ({ FolderViewer: ({ name }: { name: string }) => <div data-testid="folder">{name}</div> }));
vi.mock('./Carrete', () => ({ Carrete: ({ items }: { items: { mediaId: string }[] }) => <div data-testid="carrete">{items[0].mediaId}</div> }));
vi.mock('./carreteLoader', () => ({ createCarreteLoader: () => ({ dispose: () => undefined }) }));

const { FileScreen, NO_ACCESS_RECHECK_MS } = await import('./FileScreen');
const { navigate } = await import('../router');

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  rpc.mockReset();
  fileInfo.mockReset();
  online = true;
  schemaVersion = null;
  link = null;
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(async () => {
  await reset();
  host.remove();
  vi.useRealTimers();
  history.replaceState(null, '', '/');
});

const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
};

function button(text: string): HTMLButtonElement {
  const b = [...host.querySelectorAll('button')].find((x) => x.textContent === text);
  if (!b) throw new Error(`falta el botón ${text}: ${host.textContent}`);
  return b as HTMLButtonElement;
}

async function click(text: string): Promise<void> {
  await act(async () => button(text).click());
  await settle();
}

/** La base: `media_file` contesta `file` (null: sin acceso) y `request_access` contesta `asked`. */
function base(file: () => unknown, asked: () => { data?: unknown; error?: unknown; status?: number } = () => ({ data: 'sent' })) {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === 'media_file') return { data: file(), error: null };
    if (fn === 'request_access') return { data: null, error: null, ...asked() };
    throw new Error(fn);
  });
}

async function reset(): Promise<void> {
  await act(async () => root?.unmount());
  root = null;
}

async function show(localKey = 'wanka_1'): Promise<string> {
  root = createRoot(host);
  await act(async () => root!.render(<FileScreen localKey={localKey} id={ID} />));
  await settle();
  return host.innerHTML;
}

describe('FileScreen', () => {
  it('no existe y sin acceso: la misma pantalla, sin el nombre del archivo', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const none = await show();
    expect(rpc).toHaveBeenCalledWith('media_file', { p_file_id: ID });
    expect(host.textContent).toContain(t('file.noAccess.title'));
    expect(host.textContent).toContain(t('file.home'));
    await reset();
    // Lo que el dispositivo sabe de antes no cuenta (O4): aunque conozca el archivo, decide la base.
    fileInfo.mockReturnValue({ kind: 'file', mime: 'application/pdf', name: 'secreto.pdf', size: 1, local: true });
    const again = await show();
    expect(again).toBe(none);
    expect(again).not.toContain('secreto');
  });

  it('con permiso: el adjunto en su hoja, la carpeta en su visor, la foto y el video en el carrete', async () => {
    rpc.mockResolvedValue({ data: { name: 'plano.pdf', mime: 'application/pdf' }, error: null });
    await show();
    expect(host.querySelector('[data-testid="sheet"]')?.textContent).toBe(ID);
    await reset();
    rpc.mockResolvedValue({ data: { name: 'Dia_2', mime: 'inode/directory' }, error: null });
    await show();
    expect(host.querySelector('[data-testid="folder"]')?.textContent).toBe('Dia_2');
    await reset();
    rpc.mockResolvedValue({ data: { name: 'clip.mov', mime: 'video/quicktime' }, error: null });
    await show();
    expect(host.querySelector('[data-testid="carrete"]')?.textContent).toBe(ID);
  });

  it('borrado: lo dice, sin abrir nada', async () => {
    rpc.mockResolvedValue({ data: { name: 'plano.pdf', mime: 'application/pdf', drive_trashed_at: '2026-10-01T00:00:00Z' }, error: null });
    await show();
    expect(host.textContent).toContain(t('file.deleted'));
    expect(host.querySelector('[data-testid="sheet"]')).toBeNull();
  });

  it('con un link público pregunta con el link', async () => {
    link = { entry: { localKey: 'wanka_1' } };
    rpc.mockResolvedValue({ data: [], error: null });
    await show();
    expect(rpc).toHaveBeenCalledWith('plink_media_files', { p_ids: [ID] });
    expect(host.textContent).toContain(t('file.noAccess.title'));
  });

  it('sin red: nunca "sin acceso"; lo que está en el dispositivo se abre', async () => {
    online = false;
    await show();
    expect(rpc).not.toHaveBeenCalled();
    expect(host.textContent).toContain(t('file.offline'));
    expect(host.textContent).not.toContain(t('file.noAccess.title'));
    await reset();
    fileInfo.mockReturnValue({ kind: 'file', mime: 'application/pdf', name: 'plano.pdf', size: 1, local: true });
    await show();
    expect(host.querySelector('[data-testid="sheet"]')).not.toBeNull();
  });

  it('la base no contesta: reintentar; otra clave local: incompleto, sin preguntar', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await show();
    expect(host.textContent).toContain(t('file.failed'));
    await reset();
    rpc.mockReset();
    await show('otro_ws');
    expect(rpc).not.toHaveBeenCalled();
    expect(host.textContent).toContain(t('file.incomplete'));
  });
});

// Entrega 2 (Docs/Doc_Links_PDF.md, 5.2 y 5.3) y las observaciones O7 de la auditoría de E1.
describe('FileScreen: Request access', () => {
  it('con la base en la 22: avisa quién lo va a ver antes de mandar, manda y recuerda cuándo', async () => {
    schemaVersion = 22;
    base(() => null);
    await show();
    expect(host.textContent).not.toContain(t('file.noAccess.text'));
    await click(t('file.request'));
    // Todavía no mandó: primero el aviso (LF19).
    expect(rpc).not.toHaveBeenCalledWith('request_access', expect.anything());
    expect(host.textContent).toContain(t('file.requestNote'));
    await click(t('file.request'));
    expect(rpc).toHaveBeenCalledWith('request_access', { p_file: ID });
    expect(host.textContent).toContain(t('file.requestSent'));
    // Sin nada del archivo, también después de pedir.
    expect(host.textContent).not.toContain('pdf');
    // Al volver a abrir la dirección: cuándo lo pidió y pedir de nuevo.
    await reset();
    await show();
    const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date());
    expect(host.textContent).toContain(t('file.requestedOn', { date: day }));
    expect(button(t('file.requestAgain'))).toBeTruthy();
  });

  it('Cancel no manda nada', async () => {
    schemaVersion = 22;
    base(() => null);
    await show();
    await click(t('file.request'));
    await click(t('common.cancel'));
    expect(rpc).not.toHaveBeenCalledWith('request_access', expect.anything());
    expect(host.textContent).not.toContain(t('file.requestNote'));
  });

  it('con la base vieja o con un link público: sin Request access', async () => {
    schemaVersion = 21;
    base(() => null);
    await show();
    expect(host.textContent).toContain(t('file.noAccess.text'));
    expect(host.textContent).not.toContain(t('file.request'));
    await reset();
    schemaVersion = 22;
    link = { entry: { localKey: 'wanka_1' } };
    rpc.mockResolvedValue({ data: [], error: null });
    await show();
    expect(host.textContent).toContain(t('file.noAccess.text'));
    expect(host.textContent).not.toContain(t('file.request'));
  });

  it('si ya lo ve (has_access), vuelve a preguntar y abre el archivo', async () => {
    schemaVersion = 22;
    let row: unknown = null;
    base(
      () => row,
      () => {
        row = { name: 'plano.pdf', mime: 'application/pdf' };
        return { data: 'has_access' };
      },
    );
    await show();
    await click(t('file.request'));
    await click(t('file.request'));
    expect(host.querySelector('[data-testid="sheet"]')?.textContent).toBe(ID);
  });

  it('el tope del día: lo dice y no anota el pedido', async () => {
    schemaVersion = 22;
    base(
      () => null,
      () => ({ error: { message: 'rate_limited', code: 'P0001' }, status: 400 }),
    );
    await show();
    await click(t('file.request'));
    await click(t('file.request'));
    expect(host.textContent).toContain(t('file.requestLimited'));
    expect(localStorage.length).toBe(0);
  });

  it('a la vista vuelve a preguntar cada 60 s sin parpadear; si le dieron acceso, abre', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    schemaVersion = 22;
    let row: unknown = null;
    let answer: ((v: unknown) => void) | null = null;
    rpc.mockImplementation(async () => {
      if (row === 'wait') return new Promise((r) => (answer = r));
      return { data: row, error: null };
    });
    await show();
    expect(rpc).toHaveBeenCalledTimes(1);
    const before = host.innerHTML;
    row = 'wait';
    await act(async () => void vi.advanceTimersByTime(NO_ACCESS_RECHECK_MS));
    await settle();
    expect(rpc).toHaveBeenCalledTimes(2);
    // Mientras pregunta de fondo, la misma pantalla (sin "Opening…").
    expect(host.innerHTML).toBe(before);
    await act(async () => answer!({ data: { name: 'plano.pdf', mime: 'application/pdf' }, error: null }));
    await settle();
    expect(host.querySelector('[data-testid="sheet"]')).not.toBeNull();
  });

  it('una pregunta de fondo que falla deja la pantalla como estaba', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    schemaVersion = 22;
    base(() => null);
    await show();
    const before = host.innerHTML;
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await act(async () => void vi.advanceTimersByTime(NO_ACCESS_RECHECK_MS));
    await settle();
    expect(host.innerHTML).toBe(before);
    expect(host.textContent).not.toContain(t('file.failed'));
  });
});

describe('FileScreen: volver y la red (O7)', () => {
  it('sin red al abrir: al volver la red pregunta sola', async () => {
    let up = false;
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => up);
    rpc.mockResolvedValue({ data: { name: 'plano.pdf', mime: 'application/pdf' }, error: null });
    await show();
    expect(host.textContent).toContain(t('file.offline'));
    expect(rpc).not.toHaveBeenCalled();
    up = true;
    await act(async () => void window.dispatchEvent(new Event('online')));
    await settle();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="sheet"]')).not.toBeNull();
    spy.mockRestore();
  });

  it('Go to Shot Docs vuelve a donde estaba si llegó desde la app; si no, al inicio', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const PAGE = '/p/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
    navigate(PAGE);
    navigate(`/f/wanka_1/${ID}`);
    await show();
    await click(t('file.home'));
    expect(location.pathname).toBe(PAGE);
    await reset();
    // Llegó de afuera (un PDF): al inicio.
    history.replaceState(null, '', `/f/wanka_1/${ID}`);
    await show();
    await click(t('file.home'));
    expect(location.pathname).toBe('/');
  });
});
