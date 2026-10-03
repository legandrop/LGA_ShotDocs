import { useState } from 'react';
import { useT } from '../i18n';
import { useServices, useTree } from '../services';
import { canListAside, type LinkAsideRow } from '../sync/linkAdmitApi';
import { asideReasonText, downloadLinkChanges, useLinkAside } from './linkAside';

// En Share de una página, debajo de *General access* (Docs/Doc_Link_Publico.md, entrega 2c): lo que mandaron los links de
// esta página (el de hoy y los anteriores, reseteados o revocados) y quedó apartado, con quién, cuándo, en qué página y
// por qué, y para bajarlo (uno o todo). Lo apartado nunca se borra; la lista sale de `public_link_aside` y la ve quien ve
// lo borrado de cada página.

/** Cuántas filas se muestran; el resto se baja con *Download all*. */
const SHOWN = 20;

export function LinkAsideList({ pageId, linkId }: { pageId: string; linkId: string | null }) {
  const tr = useT();
  const { remote } = useServices();
  const tree = useTree();
  const aside = useLinkAside(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const rows = aside.rows.filter((r) => r.link_page_id === pageId);
  if (rows.length === 0 || !canListAside(remote)) return null;
  const lang = tr.lang === 'es' ? 'es' : 'en';
  const when = (iso: string) => new Date(iso).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' });
  const titleOf = (id: string) => tree.get(id)?.title || tr('common.untitled');

  const download = (key: string, list: LinkAsideRow[]) => {
    setBusy(key);
    setFailed(false);
    void downloadLinkChanges(remote, list, { pageId: null, title: tree.get(pageId)?.title ?? null, titleOf: (id) => tree.get(id)?.title })
      .catch(() => setFailed(true))
      .finally(() => setBusy(null));
  };

  return (
    <div className="link-aside-list">
      <p className="small team-lead">
        <strong>{tr('share.link.asideTitle', { count: rows.length })}</strong> <span className="muted">{tr('share.link.asideHint')}</span>{' '}
        <button type="button" className="link" disabled={busy !== null} onClick={() => download('all', rows)}>
          {busy === 'all' ? tr('common.preparing') : tr('share.link.asideDownloadAll')}
        </button>
      </p>
      <ul className="link-aside-rows">
        {rows.slice(0, SHOWN).map((r) => (
          <li key={r.id} className="link-aside-row">
            <span className="link-aside-what">
              <span className="link-aside-page">{titleOf(r.page_id)}</span>
              <span className="muted small">
                {tr('share.link.asideRow', { name: r.author, when: when(r.created_at) })}
                {linkId !== null && r.link_id !== linkId ? ` · ${tr('share.link.asideOldLink')}` : ''}
              </span>
              <span className="muted small">{asideReasonText(tr, r.reason)}</span>
            </span>
            <button type="button" className="link" disabled={busy !== null} onClick={() => download(r.id, [r])}>
              {busy === r.id ? tr('common.preparing') : tr('link.aside.download')}
            </button>
          </li>
        ))}
      </ul>
      {rows.length > SHOWN && <p className="muted small">{tr('share.link.asideMore', { count: rows.length - SHOWN })}</p>}
      {failed && <p className="error">{tr('sync.downloadFailed')}</p>}
    </div>
  );
}
