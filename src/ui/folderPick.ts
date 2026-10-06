import { foldersFromList, type FolderSource } from '../media/folderRead';
import { detectPlatform, isMobilePlatform } from './install';

// "Folder" del menú "/" (P.9, Docs/Doc_Carpetas.md, sección 6): elegir una carpeta con el selector del sistema en vez
// de arrastrarla. Es otra forma de llegar a la misma ventana ("esta carpeta, con todo esto"): lo elegido se lee con
// `foldersFromList` (cada archivo trae su ruta) y sigue el camino de una carpeta soltada. Las carpetas vacías no
// llegan por acá (el navegador no las da): para esas, arrastrar.

/**
 * Si este navegador sabe elegir una carpeta entera (`<input webkitdirectory>`). En un teléfono no se ofrece: ahí el
 * selector no entrega carpetas de forma pareja y no está probado; se sigue pidiendo comprimirla.
 */
export function canPickFolder(mobile: boolean = isMobilePlatform(detectPlatform())): boolean {
  if (mobile || typeof HTMLInputElement === 'undefined') return false;
  return 'webkitdirectory' in HTMLInputElement.prototype;
}

/**
 * Cuándo el menú "/" ofrece "Folder": se puede editar, no es la práctica (que no guarda archivos), el workspace tiene
 * portero, no se entró por un link (un link nunca sube carpetas), la cola de carpetas está y el navegador sabe elegir
 * una.
 */
export function folderSlashOffer(o: { editable: boolean; practice: boolean; portero: boolean; noFolders: boolean; queue: boolean; canPick?: boolean }): boolean {
  return o.editable && !o.practice && o.portero && !o.noFolders && o.queue && (o.canPick ?? canPickFolder());
}

/**
 * Abre el selector de carpetas del sistema y entrega lo elegido como carpetas leídas (una lista vacía si la carpeta
 * no tiene archivos). Se llama dentro del clic o la tecla (el navegador no abre el selector sin un gesto). Cerrar el
 * selector sin elegir no hace nada. `alive`: si quien lo pidió sigue ahí (se cambió de página con el selector
 * abierto: lo elegido no va a otra página).
 */
export function pickFolder(done: (sources: FolderSource[]) => void, alive: () => boolean = () => true): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.setAttribute('webkitdirectory', '');
  let finished = false;
  const finish = (files: File[] | null) => {
    if (finished) return;
    finished = true;
    input.remove();
    if (files === null || !alive()) return;
    done(foldersFromList(files));
  };
  input.addEventListener('change', () => finish(Array.from(input.files ?? [])));
  input.addEventListener('cancel', () => finish(null));
  input.style.display = 'none';
  document.body.append(input);
  input.click();
}
