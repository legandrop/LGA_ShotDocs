import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from './structure';
import type { PageTree, TitleRest } from './tree';

// Lo que sobra de un título de más de 500 caracteres (el tope de la base, `pages_title_check`) no se pierde: el árbol lo
// anota junto con el título cortado (`TitleRest`, tree.ts) y esto lo escribe al principio de la página, un párrafo por
// renglón, como una edición local más (se guarda y se sube). Docs/Doc_Sincronizacion.md, "Topes de largo".

/** Una edición local escrita sin editor (como `ORIGIN_REPLACE`): no entra en el Ctrl/⌘+Z de la página abierta. */
export const ORIGIN_TITLE_REST = Symbol('title-rest');

/** Si algo no se pudo escribir o guardar, se reintenta a los pocos segundos. */
const RETRY_MS = 5000;

/** Los renglones de lo que sobró, uno por párrafo, sin los vacíos y con los espacios juntados. */
export function restParagraphs(text: string): string[] {
  return text
    .split(/\r\n?|\n|\u2028|\u2029/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function paragraph(id: string, text: string): Y.XmlElement {
  const container = new Y.XmlElement('blockContainer');
  container.setAttribute('id', id);
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText(text)]);
  container.insert(0, [p]);
  return container;
}

function hasBlock(node: Y.XmlFragment | Y.XmlElement, id: string): boolean {
  for (const child of node.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    if (child.nodeName === 'blockContainer' && child.getAttribute('id') === id) return true;
    if (hasBlock(child, id)) return true;
  }
  return false;
}

/**
 * Escribe lo que sobró al principio de la página, un párrafo por renglón. El primer párrafo lleva el id de lo anotado:
 * si ya está (se escribió y la app se cortó antes de olvidarlo), no se repite. Devuelve si escribió algo.
 */
export function prependRest(doc: Y.Doc, rest: Pick<TitleRest, 'id' | 'text'>, origin: unknown = ORIGIN_TITLE_REST): boolean {
  const lines = restParagraphs(rest.text);
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  if (lines.length === 0 || hasBlock(fragment, rest.id)) return false;
  doc.transact(() => {
    let group = fragment.toArray().find((n): n is Y.XmlElement => n instanceof Y.XmlElement && n.nodeName === 'blockGroup');
    if (!group) {
      group = new Y.XmlElement('blockGroup');
      fragment.insert(0, [group]);
    }
    group.insert(0, lines.map((line, i) => paragraph(i === 0 ? rest.id : crypto.randomUUID(), line)));
  }, origin);
  return true;
}

/** Lo que usa de `PageDocs` (docs.ts). */
export interface RestDocs {
  edit<T>(pageId: string, fn: (doc: Y.Doc) => Promise<T> | T): Promise<T>;
  applyLocal(pageId: string, doc: Y.Doc, origin: symbol, apply: () => void): boolean;
  flush(pageId?: string): Promise<void>;
  isSaved(pageId: string): boolean;
}

/**
 * Escribe en sus páginas lo que el árbol tiene anotado (ahora y cada vez que se anota algo nuevo) y lo olvida recién
 * cuando la página quedó guardada en el dispositivo. `onMoved` avisa cada vez que escribió algo. Devuelve cómo parar.
 */
export function watchTitleRests(tree: PageTree, docs: RestDocs, onMoved?: (rest: TitleRest) => void): () => void {
  let running: Promise<void> | null = null;
  let again = false;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const run = async (): Promise<boolean> => {
    let pending = false;
    for (const rest of tree.titleRests()) {
      if (stopped) return false;
      try {
        let wrote = false;
        await docs.edit(rest.pageId, (doc) => docs.applyLocal(rest.pageId, doc, ORIGIN_TITLE_REST, () => (wrote = prependRest(doc, rest))));
        await docs.flush(rest.pageId);
        if (!docs.isSaved(rest.pageId)) {
          // Escrito pero sin guardar todavía (sin espacio, por ejemplo): se olvida cuando quede guardado.
          pending = true;
          continue;
        }
        await tree.doneTitleRest(rest.id);
        if (wrote) onMoved?.(rest);
      } catch (err) {
        pending = true;
        console.warn('[titleRest] no se pudo escribir lo que sobró del título; se reintenta', err);
      }
    }
    return pending;
  };

  const kick = (): void => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    if (retry) clearTimeout(retry);
    retry = null;
    running = run()
      .then((pending) => {
        if (pending && !stopped) retry = setTimeout(kick, RETRY_MS);
      })
      .finally(() => {
        running = null;
        if (again) {
          again = false;
          kick();
        }
      });
  };

  tree.onTitleRest = kick;
  kick();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    if (tree.onTitleRest === kick) tree.onTitleRest = undefined;
  };
}
