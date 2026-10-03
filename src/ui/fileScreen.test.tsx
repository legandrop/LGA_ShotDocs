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
let link: { entry: { localKey: string } } | null = null;

// Los servicios son los mismos en cada dibujo (como en la app).
const services = { client: { rpc }, media: { fileInfo }, files: {}, workspace: { config: { localKey: 'wanka_1' } } };
vi.mock('../services', () => ({
  useServices: () => services,
  useSyncStatus: () => ({ online }),
}));
vi.mock('../linkMode', () => ({ useLinkMode: () => link }));
vi.mock('./AttachmentSheet', () => ({ AttachmentSheet: ({ fileId }: { fileId: string }) => <div data-testid="sheet">{fileId}</div> }));
vi.mock('./FolderViewer', () => ({ FolderViewer: ({ name }: { name: string }) => <div data-testid="folder">{name}</div> }));
vi.mock('./Carrete', () => ({ Carrete: ({ items }: { items: { mediaId: string }[] }) => <div data-testid="carrete">{items[0].mediaId}</div> }));
vi.mock('./carreteLoader', () => ({ createCarreteLoader: () => ({ dispose: () => undefined }) }));

const { FileScreen } = await import('./FileScreen');

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  rpc.mockReset();
  fileInfo.mockReset();
  online = true;
  link = null;
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(async () => {
  await reset();
  host.remove();
});

async function reset(): Promise<void> {
  await act(async () => root?.unmount());
  root = null;
}

async function show(localKey = 'wanka_1'): Promise<string> {
  root = createRoot(host);
  await act(async () => root!.render(<FileScreen localKey={localKey} id={ID} />));
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
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
