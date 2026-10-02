import { BlockNoteEditor } from '@blocknote/core';
import { locale, t } from '../i18n';
import '../i18n/lazy/exportPdf';
import '../i18n/lazy/exportZip';
import { mediaIdOf } from '../media/queue';
import type { CommentThread, CommentView } from '../sync/comments';
import { editorSchemaOptions } from '../ui/editorSchema';
import { PHOTO } from '../ui/inlinePhoto';
import { internalPageId } from '../ui/internalLinks';
import type { PageFormat } from '../ui/pageFormat';
import { printGeometry } from '../ui/pageFormat';
import { authorLabel, blockText, type CommentSource } from './exportComments';
import { hrefOf, relativePath } from './zipLayout';

// El `.html` y el `.md` de cada página del zip de exportar (P.22, Docs/Doc_Exportar.md, sección 2.3; entrega 2).
//
// - `.html`: la copia de la vista de impresión de la página (la misma del PDF), en claro, SIN una línea de JavaScript:
//   sin `<script>`, sin atributos `on…`, sin `javascript:`, sin reproductores. Cada foto se muestra con su vista JPEG
//   (`Files/_view/…`, que cualquier navegador abre, también la de un HEIC) y es un link al original si está en el zip.
//   Todo con rutas relativas: se abre con doble clic, sin red. Se imprime con la hoja de la página (`@page`).
// - `.md`: el texto en Markdown (la conversión de BlockNote con el esquema de la app), cada foto como
//   `[![nombre](vista)](original)`, el salto de hoja como `<!-- shotdocs:page-break -->` y los comentarios al final.
// Los links a otra página del zip van a su `.html` (o `.md`); a una de afuera, solo el texto.

type Format = Pick<PageFormat, 'size' | 'landscape'>;

/** Lo que se hace con cada imagen de la vista (en el orden del documento). */
export type ImagePlan =
  /** Una foto, un video o un adjunto del workspace: su vista y su original (rutas adentro del zip, o `null`). */
  | { kind: 'media'; view: string | null; original: string | null; name: string; video: boolean; block: boolean }
  /** Una imagen suelta del dispositivo (una imagen vieja de Supabase), copiada al zip. */
  | { kind: 'file'; path: string }
  /** Queda como está (una imagen `data:`, un ícono). */
  | { kind: 'keep' }
  /** Se saca (una imagen de afuera que pediría la red: la miniatura de una tarjeta de Drive). */
  | { kind: 'drop' };

/** El salto de hoja en el `.md`: una línea propia que no se confunde con la línea divisoria (`---`). */
export const PAGE_BREAK_MARK = '<!-- shotdocs:page-break -->';

/** Los estilos propios del archivo, después de los de la app: la vista se ve como una hoja en la pantalla. */
export const ARCHIVE_CSS = `
/* LGA Shot Docs: archivo exportado. */
html.sd-archive, html.sd-archive body { margin: 0; height: auto; min-height: 0; overflow: visible; background: #ecebe7; color: #1b1a17; color-scheme: light; }
html.sd-archive body { padding: 24px 12px 48px; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
.sd-archive .print-view { position: static; left: auto; top: auto; visibility: visible; pointer-events: auto; contain: none; margin: 0 auto; padding: var(--sd-sheet-margin, 20mm); box-sizing: content-box; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18); }
.sd-archive-nav, .sd-archive-foot { max-width: 900px; margin: 0 auto 14px; font-size: 13px; color: #5e5a52; }
.sd-archive-foot { margin: 14px auto 0; font-size: 12px; }
.sd-archive-nav a, .sd-archive-index a { color: #8a5700; }
.sd-archive-nav .sep { margin: 0 6px; color: #b8b3a8; }
.sd-archive-link { display: contents; }
.sd-archive-name { display: block; margin-top: 4px; font-size: 11px; color: #6b665d; overflow-wrap: anywhere; }
.sd-archive-index { max-width: 860px; margin: 0 auto; padding: 32px 40px; background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18); }
.sd-archive-index h1 { margin: 0 0 6px; font-size: 30px; }
.sd-archive-index .meta { margin: 0 0 18px; color: #6b665d; font-size: 13px; }
.sd-archive-index ul { margin: 0; padding-left: 20px; }
.sd-archive-index li { margin: 4px 0; }
.sd-archive-index .note { padding: 6px 10px; border-left: 3px solid #b8b3a8; background: #f6f4ef; color: #5e5a52; font-size: 13px; }
@media print {
  html.sd-archive, html.sd-archive body { background: #fff; padding: 0; }
  .sd-archive .print-view { margin: 0; padding: 0; box-shadow: none; width: auto; }
  .sd-archive-nav, .sd-archive-foot, .sd-archive-name { display: none; }
}
`;

/** Texto para HTML (contenido y atributos). */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Los estilos de la app que tiene cargados el documento (los de la página y de la vista de impresión), sin nada que
 * pida la red ni otro archivo: sin `@import` ni `@font-face` (las letras caen a las del sistema) y cada `url(…)` que no
 * es `data:` cambiada por `none`. Después, los del archivo.
 */
export function archiveCss(doc: Document = document): string {
  const parts: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // Una hoja de otro origen no se puede leer.
      continue;
    }
    for (const rule of Array.from(rules)) {
      const text = rule.cssText;
      if (/^\s*@(import|font-face)\b/i.test(text)) continue;
      parts.push(text.replace(/url\(\s*(?!["']?data:)[^)]*\)/gi, 'none'));
    }
  }
  return `${parts.join('\n')}\n${ARCHIVE_CSS}`;
}

/** Lo que nunca va en el `.html`: lo que corre código, carga algo o reproduce. */
const NEVER = 'script, iframe, object, embed, video, audio, source, track, link, meta, base, form, input, button, textarea, select, noscript, template';

/** Saca de una copia todo lo que puede correr código o pedir algo: el `.html` es para leer. */
export function sanitize(root: Element | DocumentFragment): void {
  for (const el of Array.from(root.querySelectorAll(NEVER))) el.remove();
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      // Lo que corre código o es del editor (foco, rol de cuadro de texto): afuera.
      if (
        name.startsWith('on') ||
        (name.startsWith('aria-') && name !== 'aria-label') ||
        ['srcset', 'contenteditable', 'draggable', 'id', 'inert', 'tabindex', 'role', 'autofocus'].includes(name)
      ) {
        el.removeAttribute(attr.name);
        continue;
      }
      if ((name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action' || name === 'formaction') && /^\s*(javascript|vbscript):/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }
}

export interface PageHtmlInput {
  /** La vista de impresión de la página (en el documento). */
  view: HTMLElement;
  title: string;
  /** La carpeta de la página (adentro del zip, sin la de arriba). */
  dir: string;
  format: Format;
  /** Lo que se hace con cada imagen de la vista, en el orden del documento. */
  images: ImagePlan[];
  /** El `.html` de otra página del zip (ruta adentro del zip), o `null` si no se exporta. */
  pageHref: (pageId: string) => string | null;
  /** El camino desde la raíz de lo exportado: títulos y su `.html` (la última es esta página). */
  path: { title: string; html: string | null }[];
  /** Los avisos de arriba (página no al día, contenido de una versión nueva). */
  notes: string[];
  /** La línea del pie ("como estaba en este dispositivo el …"). */
  footer: string;
  /** Los comentarios, ya armados (la sección de exportComments.ts), o `null`. */
  comments: HTMLElement | null;
  lang: string;
}

/** Las reglas `@page` de la hoja de una página, para imprimir el `.html` con su tamaño. */
export function pageCss(format: Format): string {
  const g = printGeometry(format);
  return `@page { size: ${g.widthMm}mm ${g.heightMm}mm; margin: ${g.marginMm}mm; }\n.sd-archive .print-view { --sd-sheet-margin: ${g.marginMm}mm; }`;
}

/** El `.html` de una página. */
export function pageHtml(input: PageHtmlInput): string {
  const tpl = document.createElement('template');
  // Una copia inerte (en un `template` las imágenes no se cargan ni corre nada).
  tpl.innerHTML = input.view.outerHTML;
  const root = tpl.content.firstElementChild as HTMLElement | null;
  if (!root) throw new Error('empty view');
  const from = input.dir;

  // Las imágenes, en el mismo orden que las de la vista.
  const imgs = Array.from(root.querySelectorAll('img'));
  imgs.forEach((img, i) => {
    const plan = input.images[i] ?? { kind: 'keep' };
    img.removeAttribute('loading');
    if (plan.kind === 'drop') {
      img.remove();
      return;
    }
    if (plan.kind === 'keep') {
      const src = img.getAttribute('src') ?? '';
      // Solo lo que no pide la red: una imagen `data:`.
      if (src && !/^data:/i.test(src)) img.remove();
      return;
    }
    if (plan.kind === 'file') {
      img.setAttribute('src', hrefOf(relativePath(from, plan.path)));
      return;
    }
    img.setAttribute('alt', plan.name);
    // Sin vista: la tarjeta de un adjunto (una imagen `data:`) queda; otra cosa pediría la red o no existe.
    if (plan.view) img.setAttribute('src', hrefOf(relativePath(from, plan.view)));
    else if (!/^data:/i.test(img.getAttribute('src') ?? '')) img.removeAttribute('src');
    if (plan.original) {
      const a = document.createElement('a');
      a.className = 'sd-archive-link';
      a.setAttribute('href', hrefOf(relativePath(from, plan.original)));
      img.replaceWith(a);
      a.append(img);
    }
    // Una foto de bloque sin su original (o un video): el nombre del archivo debajo.
    if (plan.block && (!plan.original || plan.video || !plan.view)) {
      const name = document.createElement('span');
      name.className = 'sd-archive-name';
      name.textContent = plan.video ? `▶ ${plan.name}` : plan.name;
      (img.parentElement?.classList.contains('sd-archive-link') ? img.parentElement : img).after(name);
    }
  });

  // Los links: a otra página del zip, su `.html`; a una de afuera, solo el texto; los demás, como están.
  for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    if (a.classList.contains('sd-archive-link')) continue;
    const href = a.getAttribute('href') ?? '';
    if (/^\s*(javascript|vbscript|data):/i.test(href)) {
      a.replaceWith(...Array.from(a.childNodes));
      continue;
    }
    const id = internalPageId(href);
    if (id) {
      const target = input.pageHref(id);
      if (target) a.setAttribute('href', hrefOf(relativePath(from, target)));
      else a.replaceWith(...Array.from(a.childNodes));
      continue;
    }
    // Un link de la app que no es a una página (`/`, `/settings`): no sirve afuera.
    if (/^\s*\//.test(href) && !/^\s*\/\//.test(href)) a.replaceWith(...Array.from(a.childNodes));
  }

  if (input.notes.length) {
    const title = root.querySelector('.page-title');
    for (const text of input.notes) {
      const note = document.createElement('p');
      note.className = 'sd-export-note';
      note.textContent = text;
      title?.parentElement?.insertBefore(note, title);
    }
  }
  if (input.comments) root.querySelector('.print-page')?.append(input.comments.cloneNode(true));
  sanitize(tpl.content);

  const css = hrefOf(relativePath(from, 'style.css'));
  const nav = input.path
    .map((p, i) => {
      const label = escapeHtml(p.title.trim() || t('common.untitled'));
      if (i === input.path.length - 1 || !p.html) return `<span>${label}</span>`;
      return `<a href="${escapeHtml(hrefOf(relativePath(from, p.html)))}">${label}</a>`;
    })
    .join('<span class="sep">›</span>');
  const index = hrefOf(relativePath(from, 'index.html'));
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(input.lang)}" class="sd-archive">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(input.title.trim() || t('common.untitled'))}</title>`,
    `<link rel="stylesheet" href="${escapeHtml(css)}">`,
    `<style>${pageCss(input.format)}</style>`,
    '</head>',
    '<body>',
    `<nav class="sd-archive-nav"><a href="${escapeHtml(index)}">☰</a><span class="sep">›</span>${nav}</nav>`,
    root.outerHTML,
    `<p class="sd-archive-foot">${escapeHtml(input.footer)}</p>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** Un renglón del índice del zip. */
export interface IndexRow {
  title: string;
  depth: number;
  html: string;
}

/** El `index.html` de la raíz: el árbol con un link a cada página, el nombre y la fecha. */
export function indexHtml(input: { title: string; meta: string; rows: IndexRow[]; missing: boolean; lang: string }): string {
  const lines: string[] = [];
  let depth = -1;
  for (const row of input.rows) {
    if (row.depth > depth) {
      for (let d = depth; d < row.depth; d++) lines.push('<ul>');
    } else {
      lines.push('</li>');
      for (let d = depth; d > row.depth; d--) lines.push('</ul></li>');
    }
    depth = row.depth;
    lines.push(`<li><a href="${escapeHtml(hrefOf(row.html))}">${escapeHtml(row.title.trim() || t('common.untitled'))}</a>`);
  }
  if (depth >= 0) {
    lines.push('</li>');
    for (let d = depth; d > 0; d--) lines.push('</ul></li>');
    lines.push('</ul>');
  }
  const title = escapeHtml(input.title.trim() || t('common.untitled'));
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(input.lang)}" class="sd-archive">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    '<link rel="stylesheet" href="style.css">',
    '</head>',
    '<body>',
    '<main class="sd-archive-index">',
    `<h1>${title}</h1>`,
    `<p class="meta">${escapeHtml(input.meta)}</p>`,
    input.missing ? `<p class="note"><a href="MISSING_FILES.txt">${escapeHtml(t('exportZip.missingNote'))}</a></p>` : '',
    `<h2>${escapeHtml(t('exportPdf.contents'))}</h2>`,
    ...lines,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

// --- Markdown -----------------------------------------------------------------------------------------------

type Inline = Record<string, unknown> & { type?: string; text?: string; href?: string; content?: unknown };
type AnyBlock = Record<string, unknown> & { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: AnyBlock[] };

let mdEditor: BlockNoteEditor<any, any, any> | null = null;

/** Un editor sin montar, solo para convertir (el mismo para todas las páginas). */
function markdownEditor(): BlockNoteEditor<any, any, any> {
  mdEditor ??= BlockNoteEditor.create(editorSchemaOptions) as unknown as BlockNoteEditor<any, any, any>;
  return mdEditor;
}

/** Lo que el `.md` necesita saber de cada archivo. */
export interface MdMedia {
  name: string;
  /** La vista y el original (rutas adentro del zip), o `null`. */
  view: string | null;
  original: string | null;
}

export interface MarkdownInput {
  blocks: readonly AnyBlock[];
  title: string;
  dir: string;
  /** El `.md` de otra página del zip, o `null`. */
  pageMd: (pageId: string) => string | null;
  media: (id: string) => MdMedia | null;
  notes: string[];
  comments: { threads: readonly CommentThread[]; source: Pick<CommentSource, 'nameOf'> } | null;
}

/** Una marca que la conversión no toca (solo letras y números: nada que Markdown escape). */
const token = (n: number) => `SDXTOKEN${n}X`;

/** El `.md` de una página. */
export function pageMarkdown(input: MarkdownInput): string {
  const replacements: string[] = [];
  const mark = (text: string) => {
    replacements.push(text);
    return token(replacements.length - 1);
  };
  const mdMedia = (url: unknown, fallbackName: unknown): string => {
    const id = typeof url === 'string' ? mediaIdOf(url) : null;
    const info = id ? input.media(id) : null;
    const name = info?.name || (typeof fallbackName === 'string' ? fallbackName : '') || 'file';
    const label = name.replace(/[[\]]/g, '\\$&');
    const rel = (path: string) => `<${hrefOf(relativePath(input.dir, path))}>`;
    if (!info) return typeof url === 'string' && /^https:/i.test(url) ? `![${label}](<${url}>)` : label;
    const image = info.view ? `![${label}](${rel(info.view)})` : label;
    return info.original ? `[${image}](${rel(info.original)})` : image;
  };
  const textOf = (items: Inline[]): Inline[] => items.flatMap((c) => (c.type === 'link' ? textOf(asList(c.content)) : [c]));
  const inline = (content: unknown): unknown => {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) {
      // Una tabla: cada celda con su contenido.
      const table = content as { type?: string; rows?: { cells: unknown[] }[] } | undefined;
      if (table?.type === 'tableContent' && Array.isArray(table.rows)) {
        return {
          ...table,
          rows: table.rows.map((row) => ({
            ...row,
            cells: row.cells.map((cell) =>
              Array.isArray(cell) ? inline(cell) : cell && typeof cell === 'object' ? { ...(cell as object), content: inline((cell as { content?: unknown }).content) } : cell,
            ),
          })),
        };
      }
      return content;
    }
    return (content as Inline[]).flatMap((c): Inline[] => {
      if (c.type === PHOTO) return [{ type: 'text', text: mark(mdMedia((c.props as Record<string, unknown> | undefined)?.url, (c.props as Record<string, unknown> | undefined)?.name)), styles: {} }];
      if (c.type === 'link') {
        const href = c.href ?? '';
        const id = internalPageId(href);
        const inside = asList(c.content) as Inline[];
        if (/^\s*(javascript|vbscript|data):/i.test(href)) return textOf(inside);
        if (id) {
          const target = input.pageMd(id);
          return target ? [{ ...c, href: hrefOf(relativePath(input.dir, target)), content: textOf(inside) }] : textOf(inside);
        }
        if (/^\s*\//.test(href) && !/^\s*\/\//.test(href)) return textOf(inside);
        return [c];
      }
      return [c];
    });
  };
  const paragraph = (text: string): AnyBlock => ({ type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] });
  const prepare = (blocks: readonly AnyBlock[]): AnyBlock[] => {
    const out: AnyBlock[] = [];
    for (const b of blocks) {
      const children = prepare(b.children ?? []);
      if (b.type === 'image' || b.type === 'video' || b.type === 'audio' || b.type === 'file') {
        out.push({ ...paragraph(mark(mdMedia(b.props?.url, b.props?.name))), children });
        continue;
      }
      const props = { ...(b.props ?? {}) };
      const pageBreak = b.type === 'paragraph' && props.pageBreak === true;
      const content = inline(b.content);
      const hasText = Array.isArray(content) ? content.length > 0 : !!content;
      if (pageBreak) {
        delete props.pageBreak;
        if (hasText) out.push({ ...b, props, content, children: [] });
        out.push(paragraph(mark(PAGE_BREAK_MARK)));
        out.push(...children);
        continue;
      }
      out.push({ ...b, props, content, children });
    }
    return out;
  };
  let body = '';
  try {
    body = markdownEditor().blocksToMarkdownLossy(prepare(input.blocks) as never);
  } catch (err) {
    // Si la conversión falla, el texto plano de cada bloque: nunca un `.md` vacío.
    console.warn('[exportar] no se pudo pasar a Markdown', err);
    body = input.blocks.map((b) => blockText(b)).filter(Boolean).join('\n\n');
  }
  body = body.replace(/SDXTOKEN(\d+)X/g, (_, n: string) => replacements[Number(n)] ?? '');
  const parts = [`# ${escapeMdLine(input.title.trim() || t('common.untitled'))}`, ''];
  for (const note of input.notes) parts.push(`> ${note}`, '');
  parts.push(body.trim(), '');
  if (input.comments) {
    const c = commentsMarkdown(input.comments.threads, input.blocks, input.comments.source);
    if (c) parts.push('---', '', c, '');
  }
  return parts.join('\n');
}

function asList(content: unknown): Inline[] {
  if (Array.isArray(content)) return content as Inline[];
  if (typeof content === 'string') return [{ type: 'text', text: content, styles: {} }];
  return [];
}

function escapeMdLine(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/** Los comentarios al final del `.md`, como citas (sin correos). */
export function commentsMarkdown(threads: readonly CommentThread[], blocks: readonly AnyBlock[], source: Pick<CommentSource, 'nameOf'>): string | null {
  const visible = threads.filter((th) => !th.root.deleted || th.replies.some((r) => !r.deleted));
  if (!visible.length) return null;
  const dates = new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' });
  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : dates.format(d);
  };
  const quote = (text: string, depth: number) =>
    text
      .split('\n')
      .map((line) => `${'> '.repeat(depth)}${line}`.trimEnd())
      .join('\n');
  const out = [`## ${t('exportPdf.comments')}`, ''];
  for (const th of visible) {
    const block = th.blockId ? findBlock(blocks, th.blockId) : undefined;
    const anchor = block ? blockText(block) : '';
    const head = anchor ? `“${anchor.length > 80 ? `${Array.from(anchor).slice(0, 80).join('')}…` : anchor}”` : t('exportPdf.onPage');
    out.push(quote(`*${head}*${th.resolved ? ` · ${t('exportPdf.resolved')}` : ''}`, 1), '>');
    const one = (c: CommentView, depth: number) => {
      if (c.deleted) out.push(quote(t('exportPdf.deletedComment'), depth));
      else out.push(quote(`**${authorLabel(c, source)}** · ${when(c.createdAt)}`, depth), quote(c.body, depth));
      out.push('>'.repeat(depth));
    };
    one(th.root, 1);
    for (const r of th.replies) if (!r.deleted) one(r, 2);
    out.push('');
  }
  return out.join('\n').trimEnd();
}

function findBlock(blocks: readonly AnyBlock[], id: string): AnyBlock | undefined {
  for (const b of blocks) {
    if (b.id === id) return b;
    const inside = findBlock(b.children ?? [], id);
    if (inside) return inside;
  }
  return undefined;
}

// --- Los bloques para volver --------------------------------------------------------------------------------

/**
 * Los bloques para `_shotdocs/pages/<n>.json`, tal cual salvo los links: a una página de afuera de lo exportado (o
 * que ejecuta algo), solo su texto (regla 2: ningún id de afuera). Los de adentro quedan con el id viejo (el manifest
 * dice qué página es).
 */
export function blocksForArchive(blocks: readonly AnyBlock[], inside: ReadonlySet<string>): AnyBlock[] {
  const keepLink = (href: string) => {
    if (/^\s*(javascript|vbscript|data):/i.test(href)) return false;
    const id = internalPageId(href);
    if (id) return inside.has(id);
    return !(/^\s*\//.test(href) && !/^\s*\/\//.test(href));
  };
  const inline = (content: unknown): unknown => {
    if (Array.isArray(content)) {
      return (content as Inline[]).flatMap((c): Inline[] => {
        if (c.type !== 'link') return [c];
        if (keepLink(c.href ?? '')) return [c];
        return asList(c.content).map((x) => ({ ...x }));
      });
    }
    const table = content as { type?: string; rows?: { cells: unknown[] }[] } | undefined;
    if (table && typeof table === 'object' && table.type === 'tableContent' && Array.isArray(table.rows)) {
      return {
        ...table,
        rows: table.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) =>
            Array.isArray(cell) ? inline(cell) : cell && typeof cell === 'object' ? { ...(cell as object), content: inline((cell as { content?: unknown }).content) } : cell,
          ),
        })),
      };
    }
    return content;
  };
  return blocks.map((b) => ({ ...b, content: inline(b.content), children: blocksForArchive(b.children ?? [], inside) }));
}
