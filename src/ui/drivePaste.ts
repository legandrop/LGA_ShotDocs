import type { BlockNoteEditor, BlockNoteEditorOptions } from '@blocknote/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { parseDriveLink, type DriveLink } from './driveLinks';
import { PAGE_BREAK_PROP, paragraphProps } from './editorSchema';

// Pegar un link de Drive (paso 13 de Docs/Plan_Workspaces.md). El link se pega como siempre (un texto con
// el link) y al lado del cursor aparece un menú chico, como en Notion o Coda:
//   - Link: lo de siempre (el menú se cierra y queda el link).
//   - Text: el mismo texto (el título o la dirección) sin el link.
//   - Card: una tarjeta con el reproductor de Drive (un párrafo con el link y `driveCard: true`).
// El menú se cierra con Escape, tocando afuera o al seguir escribiendo; con las flechas y Enter se elige.
// Este archivo tiene la lógica (sin React), para probarla sola; el menú está en DrivePasteMenu.tsx.

type AnyEditor = BlockNoteEditor<any, any, any>;
type PasteHandler = NonNullable<BlockNoteEditorOptions<any, any, any>['pasteHandler']>;

export type DrivePasteChoice = 'link' | 'text' | 'card';

/** Lo que se acaba de pegar: el rango del texto pegado (en un mismo bloque de texto) y su link de Drive. */
export interface DrivePasteTarget {
  from: number;
  to: number;
  href: string;
  text: string;
  link: DriveLink;
}

interface ClipboardLike {
  types?: ArrayLike<string> | readonly string[];
  getData(format: string): string;
}

/**
 * El link de Drive del portapapeles, solo si es lo único que se pega: la dirección sola en texto, o un
 * link solo en HTML (copiado de una página, con su título). Cualquier otra cosa se pega como siempre.
 */
export function driveLinkFromClipboard(data: ClipboardLike | null | undefined): { href: string; link: DriveLink } | null {
  if (!data) return null;
  const types = Array.from(data.types ?? []);
  if (types.includes('Files') || types.includes('blocknote/html')) return null;
  const plain = data.getData('text/plain')?.trim() ?? '';
  const fromPlain = parseDriveLink(plain);
  if (fromPlain) return { href: plain, link: fromPlain };
  const html = types.includes('text/html') ? data.getData('text/html') : '';
  if (!html || typeof DOMParser === 'undefined') return null;
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const anchors = body.querySelectorAll('a[href]');
  if (anchors.length !== 1) return null;
  const a = anchors[0];
  const href = a.getAttribute('href') ?? '';
  const link = parseDriveLink(href);
  if (!link || (body.textContent ?? '').trim() !== (a.textContent ?? '').trim()) return null;
  return { href: href.trim(), link };
}

function linkHref(node: PMNode): string | null {
  return (node.marks.find((m) => m.type.name === 'link')?.attrs.href as string | undefined) ?? null;
}

/** El primer link de Drive entre `from` y `to` (dentro de un bloque de texto). */
function driveLinkBetween(doc: PMNode, from: number, to: number): { href: string; link: DriveLink } | null {
  let found: { href: string; link: DriveLink } | null = null;
  doc.nodesBetween(from, to, (node) => {
    if (found || !node.isText) return !found;
    const href = linkHref(node);
    const link = parseDriveLink(href);
    if (href && link) found = { href, link };
    return false;
  });
  return found;
}

/**
 * Lo que quedó pegado entre `start` (donde empezaba la selección antes de pegar) y el cursor, si es un
 * texto en un mismo bloque con un link de Drive. Si pegar reemplazó el bloque, se toma desde su principio.
 */
export function findPastedDriveLink(editor: AnyEditor, start: number): DrivePasteTarget | null {
  const { doc, selection } = editor.prosemirrorState;
  const $to = selection.$to;
  if (!$to.parent.isTextblock) return null;
  const blockStart = $to.start();
  const from = start >= blockStart && start <= $to.pos ? start : blockStart;
  const to = $to.pos;
  if (from >= to) return null;
  const found = driveLinkBetween(doc, from, to);
  if (!found) return null;
  return { from, to, href: found.href, text: doc.textBetween(from, to), link: found.link };
}

/** El texto pegado sigue donde estaba (nadie lo cambió ni movió mientras el menú estaba abierto). */
export function isTargetValid(editor: AnyEditor, target: DrivePasteTarget): boolean {
  const { doc } = editor.prosemirrorState;
  if (target.to > doc.content.size) return false;
  const $from = doc.resolve(target.from);
  if (!$from.parent.isTextblock || !$from.sameParent(doc.resolve(target.to))) return false;
  return doc.textBetween(target.from, target.to) === target.text && driveLinkBetween(doc, target.from, target.to) !== null;
}

/** El bloque de BlockNote (su id) que contiene la posición, y si el texto es el del bloque o de una tabla. */
function blockAt(doc: PMNode, pos: number): { id: string; direct: boolean } | null {
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === 'blockContainer') return { id: node.attrs.id as string, direct: d === $pos.depth - 1 };
  }
  return null;
}

/** Aplica lo elegido en el menú. Devuelve `false` si el texto pegado ya no está donde estaba. */
export function applyDrivePaste(editor: AnyEditor, target: DrivePasteTarget, choice: DrivePasteChoice): boolean {
  if (choice === 'link') return true;
  if (!isTargetValid(editor, target)) return false;
  const { from, to, href, text } = target;
  const linkMark = editor.prosemirrorState.schema.marks.link;

  if (choice === 'text') {
    editor.transact((tr) => {
      tr.removeMark(from, to, linkMark);
    });
    return true;
  }

  const { doc } = editor.prosemirrorState;
  const block = blockAt(doc, from);
  if (!block) return false;
  const textblock = doc.resolve(from).parent;
  const onlyLink = block.direct && textblock.textContent.trim() === text.trim();

  if (onlyLink) {
    // El bloque es solo el link: pasa a ser la tarjeta (un párrafo, aunque fuera un título o una lista).
    editor.transact((tr) => {
      tr.removeMark(from, to, linkMark);
      tr.addMark(from, to, linkMark.create({ href }));
    });
    // Un salto de hoja que pasa a ser tarjeta sigue siendo salto (Docs/Doc_Hojas_PDF.md): la hoja nueva empieza después.
    const keepBreak = textblock.type.name === 'paragraph' && textblock.attrs[PAGE_BREAK_PROP] === true;
    const props = { ...paragraphProps('driveCard'), ...(keepBreak ? { [PAGE_BREAK_PROP]: true } : {}) };
    editor.updateBlock(block.id, { type: 'paragraph', props } as never);
    moveCursorAfter(editor, block.id);
    return true;
  }

  // El link se pegó en medio de un texto (o en una tabla): sale de ahí y la tarjeta va debajo del bloque.
  editor.transact((tr) => {
    tr.delete(from, to);
  });
  const [card] = editor.insertBlocks(
    [{ type: 'paragraph', props: paragraphProps('driveCard'), content: [{ type: 'link', href, content: text }] } as never],
    block.id,
    'after',
  );
  if (card) moveCursorAfter(editor, card.id);
  return true;
}

/** El cursor, en el bloque que sigue a la tarjeta (o al final de la tarjeta si no hay dónde). */
function moveCursorAfter(editor: AnyEditor, blockId: string) {
  try {
    const next = editor.getNextBlock(blockId);
    if (next && editor.schema.blockSchema[next.type]?.content === 'inline') editor.setTextCursorPosition(next, 'start');
    else editor.setTextCursorPosition(blockId, 'end');
  } catch {
    // El bloque ya no está.
  }
}

// --- El estado del menú ------------------------------------------------------------------------------

export interface DrivePaste {
  /** Para las opciones del editor (`pasteHandler`). */
  pasteHandler: PasteHandler;
  /** Lo que muestra el menú (`null`: cerrado). */
  get(): DrivePasteTarget | null;
  subscribe(listener: () => void): () => void;
  close(): void;
  choose(editor: AnyEditor, choice: DrivePasteChoice): void;
}

export function createDrivePaste(): DrivePaste {
  let target: DrivePasteTarget | null = null;
  const listeners = new Set<() => void>();
  const set = (next: DrivePasteTarget | null) => {
    if (next === target) return;
    target = next;
    for (const l of listeners) l();
  };

  return {
    pasteHandler: ({ event, editor, defaultPasteHandler }) => {
      set(null);
      const candidate = driveLinkFromClipboard(event.clipboardData);
      if (!candidate) return defaultPasteHandler();
      const start = editor.prosemirrorState.selection.from;
      const handled = defaultPasteHandler();
      set(findPastedDriveLink(editor, start));
      return handled;
    },
    get: () => target,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => set(null),
    choose: (editor, choice) => {
      const current = target;
      set(null);
      if (current) applyDrivePaste(editor, current, choice);
      editor.focus();
    },
  };
}
