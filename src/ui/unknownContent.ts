import * as Y from '@y/y';
import { CONTENT_FRAGMENT } from '../sync/structure';

// El editor borra del documento compartido lo que no conoce: un tipo de bloque (o de contenido en línea)
// que no está en su esquema, o un texto con una marca desconocida (en ese caso, el párrafo entero). Ese
// borrado llega a todos los dispositivos. Pasa cuando una versión vieja de la app abre una página hecha
// con una más nueva. Antes de mostrar una página, y con cada cambio que llega, se revisa que todo lo que
// trae esté en el esquema de esta versión; si no, la página no se abre en el editor.

export interface KnownContent {
  nodes: ReadonlySet<string>;
  marks: ReadonlySet<string>;
}

// Los nombres de bloques, contenidos en línea y marcas del esquema de esta versión del editor
// (`editorSchema.ts`), escritos acá para que la sincronización pueda revisar sin cargar el editor, que se
// baja aparte (roadmap B.4). Una prueba (unknownContent.test.ts) los compara con el esquema real: si el
// esquema o BlockNote cambian, falla hasta que se actualicen.
//
// Sin `doc` ni `text`: están en el esquema, pero y-prosemirror nunca los guarda como elemento (la raíz es
// el fragmento y el texto es XmlText). Un elemento con uno de esos nombres el editor lo borraría.
const NEVER_ELEMENTS: ReadonlySet<string> = new Set(['doc', 'text']);
const KNOWN_NODES = [
  'blockContainer',
  'blockGroup',
  'bulletListItem',
  'checkListItem',
  'codeBlock',
  'divider',
  'hardBreak',
  'heading',
  'image',
  'numberedListItem',
  'paragraph',
  'quote',
  'table',
  'tableCell',
  'tableHeader',
  'tableParagraph',
  'tableRow',
  'toggleListItem',
];
// Las `y-attributed-*` las agrega al esquema la entrada `@blocknote/core/y` (modo sugerencia de @y/prosemirror);
// nunca se guardan en el Y.Doc, pero son marcas del esquema.
const KNOWN_MARKS = [
  'backgroundColor',
  'bold',
  'code',
  'italic',
  'link',
  'strike',
  'textColor',
  'underline',
  'y-attributed-delete',
  'y-attributed-format',
  'y-attributed-insert',
];

const known: KnownContent = { nodes: new Set(KNOWN_NODES), marks: new Set(KNOWN_MARKS) };

/** Los nombres de elementos (bloques, contenidos en línea) y de marcas que esta versión del editor conoce. */
export function knownContent(): KnownContent {
  return known;
}

// Como y-prosemirror: una marca que puede repetirse se guarda como "nombre--hash".
const hashedMark = /(.*)(--[a-zA-Z0-9+/=]{8})$/;

/** Lo primero que el editor no conoce en el contenido de la página, o `null` si conoce todo. */
export function findUnknownContent(doc: Y.Doc, schemaNames: KnownContent = knownContent()): string | null {
  const stack: Y.Type[] = [doc.get(CONTENT_FRAGMENT)];
  let root = true;
  while (stack.length > 0) {
    const item = stack.pop()!;
    // En Yjs 14 el texto vive adentro del elemento: las marcas son el `format` de cada tramo de texto.
    if (!root && (item.name == null || NEVER_ELEMENTS.has(item.name) || !schemaNames.nodes.has(item.name))) return `"${item.name}"`;
    root = false;
    for (const op of item.toDelta().children as Iterable<{ insert: unknown; format?: Record<string, unknown> | null }>) {
      if (typeof op.insert === 'string') {
        for (const key of Object.keys(op.format ?? {})) {
          const mark = hashedMark.exec(key)?.[1] ?? key;
          if (!schemaNames.marks.has(mark)) return `"${mark}"`;
        }
      } else if (Array.isArray(op.insert)) {
        for (const child of op.insert) if (child instanceof Y.Type) stack.push(child);
      }
    }
  }
  return null;
}

export function supportsContent(doc: Y.Doc): boolean {
  return findUnknownContent(doc) === null;
}
