import * as Y from 'yjs';
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
const KNOWN_NODES = [
  'blockContainer',
  'blockGroup',
  'bulletListItem',
  'checkListItem',
  'codeBlock',
  'divider',
  'doc',
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
  'text',
  'toggleListItem',
];
const KNOWN_MARKS = ['backgroundColor', 'bold', 'code', 'italic', 'link', 'strike', 'textColor', 'underline'];

const known: KnownContent = { nodes: new Set(KNOWN_NODES), marks: new Set(KNOWN_MARKS) };

/** Los nombres de bloques, contenidos en línea y marcas del esquema de esta versión del editor. */
export function knownContent(): KnownContent {
  return known;
}

// Como y-prosemirror: una marca que puede repetirse se guarda como "nombre--hash".
const hashedMark = /(.*)(--[a-zA-Z0-9+/=]{8})$/;

/** Lo primero que el editor no conoce en el contenido de la página, o `null` si conoce todo. */
export function findUnknownContent(doc: Y.Doc, schemaNames: KnownContent = knownContent()): string | null {
  const stack: unknown[] = doc.getXmlFragment(CONTENT_FRAGMENT).toArray();
  while (stack.length > 0) {
    const item = stack.pop();
    if (item instanceof Y.XmlElement) {
      if (!schemaNames.nodes.has(item.nodeName)) return `"${item.nodeName}"`;
      stack.push(...item.toArray());
    } else if (item instanceof Y.XmlText) {
      for (const op of item.toDelta() as { attributes?: Record<string, unknown> }[]) {
        for (const key of Object.keys(op.attributes ?? {})) {
          const mark = hashedMark.exec(key)?.[1] ?? key;
          if (!schemaNames.marks.has(mark)) return `"${mark}"`;
        }
      }
    }
  }
  return null;
}

export function supportsContent(doc: Y.Doc): boolean {
  return findUnknownContent(doc) === null;
}
