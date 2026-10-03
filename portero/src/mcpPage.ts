// Una página guardada (un Y.Doc de BlockNote) como Markdown acotado, para el MCP (Docs/Doc_Asistente.md, 9.3 y 9.4).
// Sin editor ni DOM: recorre el fragmento como la búsqueda del proyecto (src/search/extract.ts) y da un renglón por
// bloque, con su id adelante (`[b:<id>]`) para que una herramienta que escribe pueda nombrar el bloque. Lo que no es
// texto (fotos, adjuntos, saltos de línea) sale como una marca corta; lo desconocido, como su texto.
//
// Es la versión de la prueba técnica M0: alcanza para medir cuánto cuesta leer una página en el portero. El formato
// definitivo (marcas, links internos sin título, el autor de cada bloque) se fija en M1.
import * as Y from 'yjs';

/** El fragmento del editor (src/sync/structure.ts, `CONTENT_FRAGMENT`). */
export const CONTENT_FRAGMENT = 'document-store';
const NESTED = 'blockGroup';
const CONTAINER = 'blockContainer';

/** El texto de un bloque, con las fotos en línea y los saltos como marcas. */
function inlineText(el: Y.XmlElement): string {
  let text = '';
  for (const child of el.toArray()) {
    if (child instanceof Y.XmlText) {
      for (const op of child.toDelta() as { insert: unknown }[]) {
        text += typeof op.insert === 'string' ? op.insert : '';
      }
    } else if (child instanceof Y.XmlElement) {
      if (child.nodeName === 'photo') text += '[photo]';
      else if (child.nodeName === 'hardBreak') text += ' / ';
      else text += inlineText(child);
    }
  }
  return text.replace(/\r?\n/g, ' / ');
}

/** Las celdas de una tabla, renglón por renglón. */
function tableRows(el: Y.XmlElement): string[] {
  const rows: string[] = [];
  const visit = (node: Y.XmlElement) => {
    if (node.nodeName === 'tableRow') {
      const cells = node.toArray().filter((c): c is Y.XmlElement => c instanceof Y.XmlElement);
      rows.push(`| ${cells.map((c) => inlineText(c).replace(/\|/g, '/')).join(' | ')} |`);
      return;
    }
    for (const child of node.toArray()) if (child instanceof Y.XmlElement) visit(child);
  };
  visit(el);
  return rows;
}

function attr(el: Y.XmlElement, name: string): string {
  const value = el.getAttribute(name) as unknown;
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

/** Un bloque (el contenido de un `blockContainer`) como uno o más renglones. */
function blockLines(el: Y.XmlElement): string[] {
  switch (el.nodeName) {
    case 'heading':
      return [`${'#'.repeat(Math.min(Math.max(Number(attr(el, 'level')) || 1, 1), 6))} ${inlineText(el)}`];
    case 'bulletListItem':
      return [`- ${inlineText(el)}`];
    case 'numberedListItem':
      return [`1. ${inlineText(el)}`];
    case 'checkListItem':
      return [`- [${attr(el, 'checked') === 'true' ? 'x' : ' '}] ${inlineText(el)}`];
    case 'quote':
      return [`> ${inlineText(el)}`];
    case 'codeBlock':
      return ['```', inlineText(el).replace(/ \/ /g, '\n'), '```'];
    case 'table':
      return tableRows(el);
    case 'image': {
      // Fotos, videos y adjuntos son bloques `image` (Doc del editor): el pie o el nombre, nunca la dirección.
      const caption = attr(el, 'caption');
      const name = attr(el, 'name');
      const url = attr(el, 'url');
      const kind = /^sdmedia:\/\//.test(url) && name && !caption ? 'file' : 'photo';
      return [`[${kind}: ${caption || name || 'no caption'}]`];
    }
    default:
      return [inlineText(el)];
  }
}

export interface PageMarkdown {
  markdown: string;
  blocks: number;
}

/** El estado actual de una página como Markdown acotado. */
export function pageToMarkdown(doc: Y.Doc): PageMarkdown {
  const out: string[] = [];
  let blocks = 0;
  const visitGroup = (group: Y.XmlElement | Y.XmlFragment, depth: number) => {
    for (const child of group.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (child.nodeName === NESTED) visitGroup(child, depth);
      else if (child.nodeName === CONTAINER) visitContainer(child, depth);
    }
  };
  const visitContainer = (container: Y.XmlElement, depth: number) => {
    const id = attr(container, 'id');
    let nested: Y.XmlElement | null = null;
    for (const child of container.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (child.nodeName === NESTED) {
        nested = child;
        continue;
      }
      blocks++;
      const indent = '  '.repeat(depth);
      const lines = blockLines(child);
      out.push(`${indent}[b:${id}] ${lines[0] ?? ''}`);
      for (const line of lines.slice(1)) out.push(`${indent}${line}`);
    }
    if (nested) visitGroup(nested, depth + 1);
  };
  visitGroup(doc.getXmlFragment(CONTENT_FRAGMENT), 0);
  return { markdown: out.join('\n'), blocks };
}

/** Arma el Y.Doc de una página con su base y las filas posteriores (base64, como las da la base). */
export function buildDoc(updates: string[]): Y.Doc {
  const doc = new Y.Doc();
  Y.transact(doc, () => {
    for (const update of updates) Y.applyUpdate(doc, base64ToBytes(update));
  });
  return doc;
}

function base64ToBytes(text: string): Uint8Array {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
