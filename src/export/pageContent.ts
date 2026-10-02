import { BlockNoteEditor, type Block } from '@blocknote/core';
import { yXmlFragmentToBlocks } from '@blocknote/core/yjs';
import * as Y from 'yjs';
import { PHOTO_MARKUP_MAP } from '../media/markup';
import { snapshotMarkup, type CopiedPhoto } from '../media/markupClipboard';
import { mediaIdOf } from '../media/queue';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { SHARED_COLLAPSE_MAP } from '../ui/collapseEditor';
import { editorSchemaOptions } from '../ui/editorSchema';
import { findUnknownContent } from '../ui/unknownContent';

// Exportar (P.22, Docs/Doc_Exportar.md, sección 2.4): el contenido de una página sale de sus BLOQUES, no del documento
// Yjs. Los bloques son lo que se ve: sin lápidas ni lo escrito y borrado (EX5, D14). Se leen de una copia en memoria
// (`docs.snapshot`), nunca del documento abierto en el editor: convertir un documento con algo que esta versión no
// conoce lo saca del documento que se convierte (y-prosemirror borra el nodo que no puede crear), y en una copia eso
// no le hace nada a nadie.

/** Lo que se exporta de una página. */
export interface PageContent {
  blocks: Block<any, any, any>[];
  /** Los títulos colapsados para todos (el mapa aparte del documento): solo los ids de bloques que existen. */
  collapsedForAll: string[];
  /** Lo que esta versión no conoce (una página de una versión más nueva), o `null`. Sale lo que se pudo leer. */
  unknown: string | null;
  /**
   * Las anotaciones de las fotos que están en los bloques (el mapa `photoMarkup`, P.20), para volver (entrega 3): las
   * de una foto sacada de la página no salen (solo los valores vigentes de las fotos que se ven).
   */
  photoMarkup: CopiedPhoto[];
}

/** Los ids de los archivos (`sdmedia://`) que usan los bloques, en orden y sin repetir (también en línea y en celdas). */
export function mediaIdsInBlocks(blocks: unknown, out: string[] = []): string[] {
  if (Array.isArray(blocks)) for (const b of blocks) mediaIdsInBlocks(b, out);
  else if (blocks && typeof blocks === 'object') {
    for (const [k, v] of Object.entries(blocks)) {
      if (k === 'url' && typeof v === 'string') {
        const id = mediaIdOf(v);
        if (id && !out.includes(id)) out.push(id);
      } else if (typeof v === 'object') mediaIdsInBlocks(v, out);
    }
  }
  return out;
}

let parser: BlockNoteEditor<any, any, any> | null = null;

/** Un editor sin montar, solo para el esquema de la app (el mismo para todas las páginas). */
function parserEditor(): BlockNoteEditor<any, any, any> {
  parser ??= BlockNoteEditor.create(editorSchemaOptions) as unknown as BlockNoteEditor<any, any, any>;
  return parser;
}

/** Los ids de todos los bloques (también los de adentro). */
export function blockIds(blocks: readonly Block<any, any, any>[]): Set<string> {
  const out = new Set<string>();
  const walk = (list: readonly Block<any, any, any>[]) => {
    for (const b of list) {
      out.add(b.id);
      walk(b.children ?? []);
    }
  };
  walk(blocks);
  return out;
}

/**
 * Los bloques y el colapsado para todos de `doc`, que tiene que ser una COPIA (`docs.snapshot`): esta función puede
 * sacarle lo que esta versión no conoce. Quien la llama destruye la copia después.
 */
export function readPageContent(doc: Y.Doc): PageContent {
  const unknown = findUnknownContent(doc);
  const blocks = yXmlFragmentToBlocks(parserEditor() as never, doc.getXmlFragment(CONTENT_FRAGMENT)) as unknown as Block<any, any, any>[];
  const ids = blockIds(blocks);
  const collapsedForAll: string[] = [];
  // El mapa da solo los valores vigentes: nada borrado.
  doc.getMap(SHARED_COLLAPSE_MAP).forEach((value, key) => {
    if (value === true && ids.has(key)) collapsedForAll.push(key);
  });
  collapsedForAll.sort();
  const photoMarkup = snapshotMarkup(doc.getMap<unknown>(PHOTO_MARKUP_MAP), mediaIdsInBlocks(blocks));
  return { blocks, collapsedForAll, unknown, photoMarkup };
}

/** Lo mismo desde un update guardado (para las pruebas y para quien tiene los bytes y no un documento). */
export function readPageContentFromUpdate(update: Uint8Array): PageContent {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, update);
    return readPageContent(doc);
  } finally {
    doc.destroy();
  }
}
