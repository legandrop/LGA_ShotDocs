import { BACKGROUND_META } from './editorMeta';

// Soltar o pegar archivos en la página (Docs/Doc_Adjuntos.md). Con portero, cualquier archivo (fotos, videos,
// PDF, zip…) va al Drive del dueño: la app inserta un bloque `image` por archivo (nunca el bloque `file` de
// BlockNote, que una versión vieja borraría) y después guarda cada uno. Se hace acá y no con lo de BlockNote
// porque BlockNote lee los archivos del evento después de esperar (con varios, entra solo el primero), los
// inserta en otro orden y, con un tipo que ningún bloque acepta, crea un bloque `file`.

/** Lo que trae un evento que BlockNote trataría como texto o HTML (y no como archivos). */
const TEXT_TYPES = ['vscode-editor-data', 'blocknote/html', 'text/html', 'text/markdown'];

/**
 * El evento trae archivos para guardar: tiene `Files` y nada de HTML (pegar desde Excel o Word, "Copiar
 * imagen" o arrastrar una imagen de otra pestaña traen `text/html` y siguen el camino de BlockNote). Copiar en
 * el Finder y pegar puede traer además un `text/plain` con el nombre: igual son archivos.
 */
export function isFilesTransfer(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  const types = Array.from(dt.types ?? []);
  return types.includes('Files') && !types.some((t) => TEXT_TYPES.includes(t));
}

/**
 * Los archivos del evento, leídos en el acto (después de terminar el evento el `DataTransfer` queda vacío).
 * `folders`: cuántos eran carpetas (se rechazan: hay que comprimirlas).
 */
export function takeFiles(dt: DataTransfer): { files: File[]; folders: number } {
  const files: File[] = [];
  let folders = 0;
  const items = Array.from(dt.items ?? []);
  if (items.length > 0) {
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory?: boolean } | null }).webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        folders++;
        continue;
      }
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    return { files, folders };
  }
  return { files: Array.from(dt.files ?? []), folders };
}

/** Dónde van los bloques nuevos: antes o después de un bloque (o, sin uno, después del cursor). */
export interface InsertAt {
  blockId: string;
  placement: 'before' | 'after';
}

/** El bloque bajo el punto donde se soltó: arriba de su mitad, antes; abajo, después. */
export function dropTarget(root: Element, x: number, y: number): InsertAt | null {
  const el = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
  const block = el && root.contains(el) ? el.closest<HTMLElement>('[data-node-type="blockContainer"][data-id]') : null;
  if (!block?.dataset.id) return null;
  const content = block.querySelector<HTMLElement>(':scope > .bn-block-content') ?? block;
  const r = content.getBoundingClientRect();
  return { blockId: block.dataset.id, placement: y < r.top + r.height / 2 ? 'before' : 'after' };
}

interface BlockLike {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: unknown[];
}

/** Lo que usa `insertFiles` del editor (la parte de la API de BlockNote que hace falta). */
export interface FileEditor {
  getTextCursorPosition(): { block: BlockLike };
  getBlock(id: string): BlockLike | undefined;
  insertBlocks(blocks: unknown[], ref: string, placement: 'before' | 'after'): BlockLike[];
  removeBlocks(ids: string[]): unknown;
  updateBlock(id: string, update: unknown): unknown;
  uploadFile?: (file: File, blockId?: string) => Promise<unknown>;
  /** Una transacción (para marcarla como de la app: no abre una sección colapsada, Doc_Colapsar.md). */
  transact?: (fn: (tr: { setMeta: (key: string, value: unknown) => unknown }) => void) => unknown;
}

/**
 * Un párrafo común, vacío y sin bloques adentro (se reemplaza, como hace BlockNote; cualquier otro bloque se
 * deja: sacar un párrafo con hijos se los llevaría).
 */
export function isEmptyParagraph(block: BlockLike | undefined): boolean {
  if (!block || block.type !== 'paragraph') return false;
  if (Array.isArray(block.children) && block.children.length > 0) return false;
  const props = block.props ?? {};
  if (props.script === true || props.question === true || props.driveCard === true) return false;
  return !Array.isArray(block.content) || block.content.length === 0;
}

/**
 * Inserta un bloque `image` por archivo, todos juntos y en orden, y después guarda cada uno con
 * `uploadFile` (que muestra "Loading…" y, si falla, saca el bloque y avisa). Un archivo que falla no corta los
 * demás. Devuelve los ids de los bloques nuevos. `onInserted`: los mismos ids, apenas se insertan (antes de guardar
 * nada), para poner otra cosa después de ellos (las carpetas del mismo soltar, P.9).
 */
export async function insertFiles(
  editor: FileEditor,
  files: readonly File[],
  at: InsertAt | null,
  onInserted?: (ids: string[]) => void,
): Promise<string[]> {
  if (files.length === 0) return [];
  const ref = at ?? { blockId: editor.getTextCursorPosition().block.id, placement: 'after' as const };
  const refBlock = editor.getBlock(ref.blockId);
  const blocks = files.map((f) => ({ type: 'image', props: { url: '', name: f.name || 'file' } }));
  const inserted = editor.insertBlocks(blocks, ref.blockId, ref.placement);
  if (isEmptyParagraph(refBlock)) {
    try {
      editor.removeBlocks([ref.blockId]);
    } catch {
      // Ya no estaba.
    }
  }
  const ids = inserted.map((b) => b.id);
  onInserted?.(ids);
  for (let i = 0; i < files.length; i++) {
    const id = ids[i];
    if (!id) continue;
    try {
      const url = await editor.uploadFile?.(files[i], id);
      if (typeof url === 'string' && editor.getBlock(id)) {
        // Lo hace la app al terminar de guardar: no abre una sección colapsada (Docs/Doc_Colapsar.md).
        const update = () => editor.updateBlock(id, { props: { url } });
        if (editor.transact) {
          editor.transact((tr) => {
            tr.setMeta(BACKGROUND_META, true);
            update();
          });
        } else update();
      }
    } catch {
      // `uploadFile` ya avisó y sacó el bloque: se sigue con el próximo.
    }
  }
  return ids;
}
