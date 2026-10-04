import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/teamDialogs';
import { formatSize } from '../media/fileTrash';
import { useServices, useSyncStatus } from '../services';
import { LINK_FILES_SCHEMA_VERSION } from '../sync/linkAdmitApi';
import { getPublicLinkFiles, PUBLIC_LINK_FILES_MAX, type PublicLinkFile } from '../sync/publicLinks';
import { downloadNow, prepareAndGet, prepareAttachment, preparedFor } from './attachmentOpen';

// En Share de una página, debajo de lo apartado (Docs/Doc_Link_Publico.md, "Cómo quedó la 2b", decisión de Lega del
// 2026-10-03): los archivos que subieron los links de esta página (el de hoy y los anteriores), también los que ningún
// cambio admitido muestra (los de un cambio apartado, los subidos y no usados). No se borran ni van solos a la papelera:
// siguen en el Drive del dueño y acá se ven, con su nombre, y se bajan. Sale de `public_link_files` (a partir de
// `files.plink_id`, no de las filas apartadas) y lo ve quien ve lo borrado de la página.

/** Cuántos se muestran (la lista llega con hasta `PUBLIC_LINK_FILES_MAX`). */
const SHOWN = 20;

export function LinkFilesList({ pageId, linkId }: { pageId: string; linkId: string | null }) {
  const tr = useT();
  const { client, media } = useServices();
  const status = useSyncStatus();
  const [rows, setRows] = useState<PublicLinkFile[]>([]);
  /** Cuántos son en total (la base 25 lo dice aunque la lista se corte); `null` con una base anterior. */
  const [total, setTotal] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const supported = (status.schemaVersion ?? 0) >= LINK_FILES_SCHEMA_VERSION;

  useEffect(() => {
    if (!supported) return;
    let live = true;
    // Sin permiso (no ve lo borrado) o sin red: la lista no se muestra.
    getPublicLinkFiles(client, pageId).then(
      (got) => {
        if (!live) return;
        setRows(got.rows);
        setTotal(got.total);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [client, pageId, supported]);

  // Las direcciones para bajar, preparadas antes del clic (Safari no deja abrir otra pestaña después de esperar).
  useEffect(() => {
    for (const r of rows.slice(0, SHOWN)) if (r.uploaded) void prepareAttachment(media, r.id);
  }, [rows, media]);

  if (!supported || rows.length === 0) return null;
  // Con el total de la base (versión 25, D279 B) la cantidad es exacta aunque la lista llegue cortada. Sin él, una lista
  // cortada en el tope dice «o más»: hay al menos esos, quizás más.
  const count = total ?? rows.length;
  const capped = total === null && rows.length >= PUBLIC_LINK_FILES_MAX;
  const lang = tr.lang === 'es' ? 'es' : 'en';
  const when = (iso: string) => new Date(iso).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' });

  const download = (id: string) => {
    setFailed(false);
    const ready = preparedFor(id)?.download;
    if (ready) return downloadNow(ready);
    void prepareAndGet(media, id).then(
      (got) => (got.download ? downloadNow(got.download) : setFailed(true)),
      () => setFailed(true),
    );
  };

  return (
    <div className="link-aside-list link-files-list">
      <p className="small team-lead">
        <strong>{tr(capped ? 'share.link.filesTitleCapped' : 'share.link.filesTitle', { count })}</strong> <span className="muted">{tr('share.link.filesHint')}</span>
      </p>
      <ul className="link-aside-rows">
        {rows.slice(0, SHOWN).map((r) => (
          <li key={r.id} className="link-aside-row">
            <span className="link-aside-what">
              <span className="link-aside-page">{r.name}</span>
              <span className="muted small">
                {formatSize(r.size, tr.lang)} · {when(r.created_at)}
                {linkId !== null && r.link_id !== linkId ? ` · ${tr('share.link.asideOldLink')}` : ''}
                {r.trashed ? ` · ${tr('share.link.fileTrashed')}` : ''}
              </span>
            </span>
            {r.uploaded ? (
              <button type="button" className="link" onClick={() => download(r.id)}>
                {tr('share.link.fileDownload')}
              </button>
            ) : (
              <span className="muted small">{tr('share.link.fileNotUploaded')}</span>
            )}
          </li>
        ))}
      </ul>
      {count > SHOWN && (
        <p className="muted small">{tr(capped ? 'share.link.filesCappedMore' : 'share.link.asideMore', { count: count - SHOWN })}</p>
      )}
      {failed && <p className="error">{tr('sync.downloadFailed')}</p>}
    </div>
  );
}
