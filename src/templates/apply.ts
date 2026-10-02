import { BlockNoteEditor } from '@blocknote/core';
import { yXmlFragmentToBlocks } from '@blocknote/core/yjs';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { SHARED_COLLAPSE_MAP } from '../ui/collapseEditor';
import { schema } from '../ui/editorSchema';
import { findUnknownContent } from '../ui/unknownContent';
import type { TemplateBlock } from './builtin';

// Crear una página desde una plantilla es copiar (Docs/Doc_Plantillas.md, sección 4.2): los bloques de la plantilla se
// AGREGAN antes del primer bloque de la página vacía, sin borrar nada. Si otro dispositivo escribió a la vez en ese
// párrafo, su texto queda (debajo de lo copiado). El párrafo vacío de la semilla queda al final.

// Lo que tiene una página recién creada (la raíz inicial, `buildSeed`): un párrafo vacío. Mismo criterio que la
// importación de Coda (`hasContent` de codaImport.ts).
const SEED_NODES = new Set(['blockGroup', 'blockContainer', 'paragraph']);

function hasContent(node: Y.XmlFragment | Y.XmlElement): boolean {
  return node.toArray().some((child) => {
    if (child instanceof Y.XmlText) return child.length > 0;
    if (child instanceof Y.XmlElement) return !SEED_NODES.has(child.nodeName) || hasContent(child);
    return false;
  });
}

/**
 * La página no tiene contenido: solo párrafos vacíos (la semilla, o renglones vacíos). Un título vacío, una lista o
 * una foto ya cuentan como contenido.
 */
export function isEmptyPage(doc: Y.Doc): boolean {
  return !hasContent(doc.getXmlFragment(CONTENT_FRAGMENT));
}

/** Lo que usa del editor de BlockNote (el de la página abierta, o uno sin pantalla en las pruebas). */
export interface TemplateEditor {
  document: { id: string }[];
  insertBlocks(blocks: never[], reference: string, placement: 'before' | 'after'): unknown;
}

/**
 * Agrega los bloques de la plantilla antes del primer bloque de la página, con el editor (así entra en su deshacer).
 * Nunca reemplaza ni borra: lo que ya estaba (la semilla vacía, o lo que escribió otro dispositivo) queda debajo.
 * El editor les pone ids nuevos a todos los bloques.
 */
export function insertTemplate(editor: TemplateEditor, blocks: TemplateBlock[]): void {
  const first = editor.document[0];
  if (!first) throw new Error('The page has no blocks to insert before.');
  editor.insertBlocks(blocks as never[], first.id, 'before');
}

// --- Una plantilla que es una página (4.2, pasos 1 y 2) ------------------------------------------------------------
//
// Lo usan las plantillas propias (entrega 3): se lee una COPIA en memoria del documento de la plantilla (nunca se monta
// un editor sobre ella, que le escribiría arreglos), se corta si tiene algo que esta versión no conoce, y los bloques
// salen con ids nuevos. Los comentarios y las respuestas a las preguntas quedan en la plantilla (son de sus bloques);
// el "colapsado para todos" se copia con los ids nuevos.

interface CopiedBlock {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: CopiedBlock[];
}

export type TemplateCopy =
  | { ok: true; blocks: TemplateBlock[]; collapsed: string[] }
  /** Hecha con una versión más nueva de la app: copiarla perdería lo que esta no conoce. */
  | { ok: false; unknown: string };

function renew(blocks: CopiedBlock[], ids: Map<string, string>): CopiedBlock[] {
  return blocks.map((b) => {
    const id = crypto.randomUUID();
    ids.set(b.id, id);
    return { ...b, id, children: renew(b.children ?? [], ids) };
  });
}

const isEmptyParagraph = (b: CopiedBlock | undefined) =>
  !!b && b.type === 'paragraph' && Array.isArray(b.content) && b.content.length === 0 && !b.children?.length;

/** Los bloques de una plantilla que es una página, leídos de una copia en memoria de su documento. */
export function copyTemplateDoc(template: Y.Doc): TemplateCopy {
  const memory = new Y.Doc();
  try {
    Y.applyUpdate(memory, Y.encodeStateAsUpdate(template));
    const unknown = findUnknownContent(memory);
    if (unknown) return { ok: false, unknown };
    // Un editor sin montar, solo para el esquema: no escribe nada en ningún documento.
    const reader = BlockNoteEditor.create({ schema }) as unknown as BlockNoteEditor;
    let blocks = yXmlFragmentToBlocks(reader as never, memory.getXmlFragment(CONTENT_FRAGMENT)) as unknown as CopiedBlock[];
    // El párrafo vacío del final de la plantilla no se copia: la página nueva ya tiene el suyo.
    if (isEmptyParagraph(blocks.at(-1))) blocks = blocks.slice(0, -1);
    const ids = new Map<string, string>();
    const renewed = renew(blocks, ids);
    const collapsed = [...memory.getMap(SHARED_COLLAPSE_MAP).entries()]
      .filter(([, v]) => v === true)
      .flatMap(([k]) => (ids.has(k) ? [ids.get(k)!] : []));
    return { ok: true, blocks: renewed as unknown as TemplateBlock[], collapsed };
  } finally {
    memory.destroy();
  }
}

/** Agrega una copia (`copyTemplateDoc`) a la página: los bloques antes del primero y el colapsado para todos. */
export function insertTemplateCopy(editor: TemplateEditor, doc: Y.Doc, copy: Extract<TemplateCopy, { ok: true }>): void {
  insertTemplate(editor, copy.blocks);
  if (copy.collapsed.length === 0) return;
  const shared = doc.getMap(SHARED_COLLAPSE_MAP);
  doc.transact(() => {
    for (const id of copy.collapsed) shared.set(id, true);
  });
}
