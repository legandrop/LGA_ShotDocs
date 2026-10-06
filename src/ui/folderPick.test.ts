// @vitest-environment jsdom
// "Folder" del menú "/" (P.9): cuándo se ofrece y qué entrega el selector de carpetas del sistema. El selector se
// maneja a mano (jsdom no abre ninguno): se toma el `<input>` que crea `pickFolder` y se le pone lo elegido.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FolderSource } from '../media/folderRead';
import { canPickFolder, folderSlashOffer, pickFolder } from './folderPick';

const proto = HTMLInputElement.prototype as unknown as Record<string, unknown>;
let hadDirectory = false;

beforeEach(() => {
  hadDirectory = 'webkitdirectory' in proto;
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
});

afterEach(() => {
  if (!hadDirectory) Reflect.deleteProperty(proto, 'webkitdirectory');
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

/** Un archivo como lo da un `<input webkitdirectory>`: con su ruta desde la carpeta elegida. */
function file(path: string, bytes = 3): File {
  const f = new File([new Uint8Array(bytes)], path.split('/').pop()!);
  Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
}

/** El selector que abrió `pickFolder`. */
function picker(): HTMLInputElement {
  const input = document.body.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no se abrió el selector');
  return input;
}

/** Elegir en el selector: el cambio con esos archivos. */
function choose(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change'));
}

describe('"Folder" del menú "/": cuándo se ofrece', () => {
  it('solo en una computadora cuyo navegador sabe elegir una carpeta entera', () => {
    Reflect.deleteProperty(proto, 'webkitdirectory');
    expect(canPickFolder(false)).toBe(false);
    Object.defineProperty(proto, 'webkitdirectory', { value: false, configurable: true, writable: true });
    expect(canPickFolder(false)).toBe(true);
    // En un teléfono no se ofrece aunque el navegador diga que sabe.
    expect(canPickFolder(true)).toBe(false);
  });

  it('no se ofrece sin permiso de editar, en la práctica, sin portero, por un link ni sin la cola de carpetas', () => {
    const yes = { editable: true, practice: false, portero: true, noFolders: false, queue: true, canPick: true };
    expect(folderSlashOffer(yes)).toBe(true);
    expect(folderSlashOffer({ ...yes, editable: false })).toBe(false);
    expect(folderSlashOffer({ ...yes, practice: true })).toBe(false);
    expect(folderSlashOffer({ ...yes, portero: false })).toBe(false);
    expect(folderSlashOffer({ ...yes, noFolders: true })).toBe(false);
    expect(folderSlashOffer({ ...yes, queue: false })).toBe(false);
    expect(folderSlashOffer({ ...yes, canPick: false })).toBe(false);
  });
});

describe('"Folder" del menú "/": el selector', () => {
  it('abre un selector de carpetas en el mismo gesto y entrega la carpeta leída con sus subcarpetas y lo salteado', () => {
    const got: FolderSource[][] = [];
    pickFolder((sources) => got.push(sources));
    const input = picker();
    expect(input.hasAttribute('webkitdirectory')).toBe(true);
    expect(HTMLInputElement.prototype.click).toHaveBeenCalledTimes(1);
    choose(input, [file('Ref/Fotos/Dia 2/a.jpg', 5), file('Ref/b.pdf', 7), file('Ref/.DS_Store')]);
    expect(got).toHaveLength(1);
    const [source] = got[0]!;
    expect(got[0]).toHaveLength(1);
    expect(source!.name).toBe('Ref');
    expect(source!.files.map((f) => [f.path, f.file.size])).toEqual([['Fotos/Dia 2/a.jpg', 5], ['b.pdf', 7]]);
    expect(source!.dirs).toEqual(['Fotos', 'Fotos/Dia 2']);
    expect(source!.skipped.map((s) => [s.path, s.reason])).toEqual([['.DS_Store', 'hidden']]);
    // El selector no queda en la página.
    expect(document.body.querySelector('input[type="file"]')).toBeNull();
  });

  it('una carpeta sin archivos entrega una lista vacía (quien llama avisa)', () => {
    const got: FolderSource[][] = [];
    pickFolder((sources) => got.push(sources));
    choose(picker(), []);
    expect(got).toEqual([[]]);
  });

  it('cerrar el selector sin elegir no entrega nada, y un cambio que llegue después tampoco', () => {
    const done = vi.fn();
    pickFolder(done);
    const input = picker();
    input.dispatchEvent(new Event('cancel'));
    expect(document.body.querySelector('input[type="file"]')).toBeNull();
    choose(input, [file('Ref/a.jpg')]);
    expect(done).not.toHaveBeenCalled();
  });

  it('si se cambió de página con el selector abierto, lo elegido no se entrega', () => {
    const done = vi.fn();
    let alive = true;
    pickFolder(done, () => alive);
    alive = false;
    choose(picker(), [file('Ref/a.jpg')]);
    expect(done).not.toHaveBeenCalled();
  });
});
