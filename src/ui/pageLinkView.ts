import { createExtension } from '@blocknote/core';
import { DOMSerializer } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { publicLinkUrl, type LinkEntry } from '../linkMode';
import { pageLink, qualifyPageLink, type PageLinkOrigin } from '../pageLink';

export const LOGICAL_PAGE_HREF = 'data-shotdocs-page-href';

/** Sólo cambia el anchor nuevo de la vista: el href persistido sigue siendo el original. */
export function pageLinkViewExtension(source: PageLinkOrigin, publicEntry?: LinkEntry) {
  const origin = Object.freeze({ ...source });
  const publicHash = publicEntry ? new URL(publicLinkUrl(origin.appOrigin, {
    u: publicEntry.url, k: publicEntry.publishableKey, l: publicEntry.localKey, t: publicEntry.token,
  })).hash : null;
  return createExtension({
    key: 'shotdocs-page-link-view',
    prosemirrorPlugins: [new Plugin({ props: { markViews: { link: (mark, view, inline) => {
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
