import { jpegName } from '../media/heic';
import { mediaIdOf, type MediaQueue } from '../media/queue';
import { BACKGROUND_META } from './editorMeta';

// El nombre del bloque de una foto que se agregó como HEIC (Docs/Doc_Imagenes.md, "Fotos HEIC"). El archivo se
// guarda tal cual al agregarlo y se pasa a JPEG después, así que el bloque nace con el nombre de la persona
// (`IMG_1234.HEIC`). Cuando el archivo ya es un JPEG, el bloque pasa a `IMG_1234.jpg`, como el archivo en el
// Drive: al convertirlo (si la página está abierta) o la próxima vez que se muestra en un editor que puede
// editar (otra sesión, otro dispositivo, una página importada de Coda). Solo cambia `name`; nunca la dirección.

const HEIC_NAME = /\.(?:heic|heif|hif)$/i;

interface NamedBlock {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  children?: NamedBlock[];
}

/** Lo que usa del editor (la parte de la API de BlockNote que hace falta). */
export interface NameEditor {
  document: NamedBlock[];
  updateBlock(id: string, update: unknown): unknown;
  transact(fn: (tr: { setMeta: (key: string, value: unknown) => unknown }) => void): unknown;
}

/**
 * Si el archivo `id` ya es un JPEG y algún bloque suyo todavía dice `.HEIC` (o `.heif`), le pone el nombre del
 * JPEG. Es un cambio de la app, no de la persona (no abre una sección colapsada). Devuelve cuántos cambió.
 */
export function renameConvertedHeic(editor: NameEditor | null, media: Pick<MediaQueue, 'fileInfo'>, id: string): number {
  const info = media.fileInfo(id);
  if (!editor || info?.mime !== 'image/jpeg') return 0;
  const targets: NamedBlock[] = [];
  const walk = (blocks: NamedBlock[]) => {
    for (const block of blocks) {
      const name = block.props?.name;
      if (block.type === 'image' && mediaIdOf(block.props?.url as string | undefined) === id && typeof name === 'string' && HEIC_NAME.test(name)) {
        targets.push(block);
      }
      if (block.children?.length) walk(block.children);
    }
  };
  walk(editor.document);
  if (targets.length === 0) return 0;
  try {
    editor.transact((tr) => {
      tr.setMeta(BACKGROUND_META, true);
      for (const block of targets) editor.updateBlock(block.id, { props: { name: jpegName(block.props!.name as string) } });
    });
  } catch {
    // El bloque ya no está.
    return 0;
  }
  return targets.length;
}
