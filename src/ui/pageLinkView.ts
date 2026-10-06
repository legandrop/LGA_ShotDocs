import { createExtension } from '@blocknote/core';
import { DOMSerializer } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { publicLinkUrl, type LinkEntry } from '../linkMode';
import { pageLink, qualifyPageLink, type PageLinkOrigin } from '../pageLink';

export const LOGICAL_PAGE_HREF = 'data-shotdocs-page-href';

/** El formato propio del editor en el portapapeles: es el que lee la app al pegar adentro. */
const APP_CLIPBOARD = 'blocknote/html';

/**
 * Lo copiado o cortado para pegar afuera de la app (`text/html` y `text/plain`): el link a una página propia sin
 * identidad sale con la dirección entera y su workspace, igual que el anchor de la vista. Lo que la app lee al pegar
 * adentro (`blocknote/html`) queda literal, así el documento no cambia al copiar y pegar en el mismo workspace. Si el
 * navegador no guardó ese formato propio, no se toca nada: pegar adentro leería este HTML y escribiría la clave en el
 * documento. Una `w` ajena, un hash de acceso y cualquier otro link quedan como están.
 */
export function qualifyCopiedLinks(data: Pick<DataTransfer, 'getData' | 'setData'>, origin: PageLinkOrigin): void {
  if (!data.getData(APP_CLIPBOARD)) return;
  const html = data.getData('text/html');
  if (!html || typeof document === 'undefined') return;
  // En un `<template>` y no como documento entero: un documento se come el espacio con que empieza lo copiado (una
  // selección que arranca en el espacio antes del link) y acomoda lo que no va suelto en un `<body>`.
  const holder = document.createElement('template');
  holder.innerHTML = html;
  const changed = new Map<string, string>();
  for (const anchor of holder.content.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href') ?? '';
    const qualified = qualifyPageLink(href, origin);
    if (qualified === href) continue;
    anchor.setAttribute('href', qualified);
    changed.set(href, qualified);
  }
  if (changed.size === 0) return;
  data.setData('text/html', holder.innerHTML);
  // El texto (Markdown) lleva las mismas direcciones entre paréntesis.
  let text = data.getData('text/plain');
  if (!text) return;
  for (const [href, qualified] of changed) text = text.split(`](${href})`).join(`](${qualified})`);
  data.setData('text/plain', text);
}

/** Sólo cambia el anchor nuevo de la vista: el href persistido sigue siendo el original. */
export function pageLinkViewExtension(source: PageLinkOrigin, publicEntry?: LinkEntry) {
  const origin = Object.freeze({ ...source });
  const publicHash = publicEntry ? new URL(publicLinkUrl(origin.appOrigin, {
    u: publicEntry.url, k: publicEntry.publishableKey, l: publicEntry.localKey, t: publicEntry.token,
  })).hash : null;
  return createExtension({
    key: 'shotdocs-page-link-view',
    prosemirrorPlugins: [new Plugin({
      // Copiar o cortar: después de que el editor arma el portapapeles (su manejador se registró antes en el mismo
      // elemento), lo que va afuera de la app lleva el workspace. Dentro de un link público no se toca: la dirección
      // de la vista lleva el acceso del link, y eso no se copia a escondidas. Arrastrar queda como estaba (lo soltado
      // en otra pestaña de la app se lee de este mismo HTML).
      view: (view) => {
        if (publicHash) return {};
        const onCopy = (event: Event) => {
          const data = (event as ClipboardEvent).clipboardData;
          if (data) qualifyCopiedLinks(data, origin);
        };
        view.dom.addEventListener('copy', onCopy);
        view.dom.addEventListener('cut', onCopy);
        return {
          destroy: () => {
            view.dom.removeEventListener('copy', onCopy);
            view.dom.removeEventListener('cut', onCopy);
          },
        };
      },
      props: { markViews: { link: (mark, view, inline) => {
      const spec = mark.type.spec.toDOM;
      if (!spec) throw new Error('La marca link no tiene representación');
      const rendered = DOMSerializer.renderSpec(view.dom.ownerDocument, spec(mark, inline));
      const anchor = rendered.dom instanceof HTMLAnchorElement ? rendered.dom : null;
      const href = anchor?.getAttribute('href');
      if (anchor && href) {
        const link = pageLink(href, origin);
        if (link?.own) {
          let qualified = qualifyPageLink(href, origin);
          if (publicHash) {
            // Una w explícita siempre identifica una cuenta. Un hash previo queda literal.
            qualified = href;
            if (link.selector.kind === 'absent' && !link.url.hash) {
              link.url.hash = publicHash;
              qualified = link.url.href;
            }
          }
          anchor.setAttribute('href', qualified);
          anchor.setAttribute(LOGICAL_PAGE_HREF, href);
        }
      }
      return rendered;
    } } } })],
  });
}
