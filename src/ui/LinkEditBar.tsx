import { useEffect, useState, useSyncExternalStore } from 'react';
import { useT } from '../i18n';
import { cleanVisitorName, linkStorageNames, setVisitorName, type LinkEntry } from '../linkMode';
import { mediaDbName, openMediaDb, type MediaRecord } from '../media/mediaDb';
import { commentsDbName, openCommentsDb } from '../sync/comments';
import { openLocalDb } from '../sync/localDb';
import type { LinkEdits, LinkRemote } from '../sync/linkRemote';
import { PageTree } from '../sync/tree';
import { exportUnsyncedBlob } from '../sync/unsynced';
import { unsyncedDocStates } from '../sync/localDb';
import { saveBlob } from './unsyncedDownload';

// Lo que ve quien escribe con un link *Can edit* (Docs/Doc_Link_Publico.md, E2.9), arriba de la app: el nombre la primera
// vez que escribe (sin nombre, lo escrito queda en este navegador), y lo que mandó y no pudo entrar, con *Download
// them*. La base local se abre aparte (como la pantalla de "este link ya no anda"): bajar no necesita la sincronización.

/** El nombre de la base local del link (el mismo que usa services.ts con `linkConfig`). */
export function linkDbName(entry: LinkEntry): string {
  return linkStorageNames(entry).db(`link:${entry.id}`);
}

/** Lo que el visitante no mandó y lo que mandó y no entró (`pages`), como el archivo de "bajar lo pendiente". */
export async function linkPagesBlob(entry: LinkEntry, pages: string[]): Promise<Blob> {
  const db = await openLocalDb(linkDbName(entry));
  try {
    const workspaceId = ((await db.get('meta', 'workspaceId')) as string | undefined) ?? '';
    const tree = new PageTree(db, workspaceId);
    await tree.load();
    return await exportUnsyncedBlob(db, null, {
      appVersion: __APP_VERSION__,
      workspace: { url: entry.url, localKey: entry.localKey, name: entry.title ?? '' },
      user: { id: `link:${entry.id}`, email: '' },
      titleOf: (id) => tree.get(id)?.title,
      alsoPages: pages,
    });
  } finally {
    db.close();
  }
}

/** Cuántas páginas tienen algo sin mandar en este navegador (para la pantalla de "este link ya no anda"). */
export async function linkUnsentPages(entry: LinkEntry): Promise<number> {
  const db = await openLocalDb(linkDbName(entry));
  try {
    return (await unsyncedDocStates(db)).length;
  } finally {
    db.close();
  }
}

/**
 * Los originales que este navegador agregó con el link y no llegaron a Drive (con su archivo todavía acá): con el link
 * muerto no suben nunca (con el link nuevo tampoco: son del viejo), así que la pantalla de "este link ya no anda" los
 * ofrece de a uno (B1 de la auditoría de la 2b; E2.7). Se leen aparte, como las páginas: no hace falta la sincronización.
 */
export async function linkUnsentMedia(entry: LinkEntry): Promise<MediaRecord[]> {
  const db = await openMediaDb(mediaDbName(linkDbName(entry)));
  try {
    const out: MediaRecord[] = [];
    for (const r of await db.getAllFromIndex('files', 'pending', 1)) {
      if ((await db.count('blobs', r.id)) > 0) out.push(r);
    }
    return out;
  } finally {
    db.close();
  }
}

/**
 * Los comentarios que el visitante escribió y no llegaron a mandarse (la cola de este navegador): con el link muerto no
 * se mandan nunca, así que la pantalla de "este link ya no anda" los muestra para copiarlos. Por comentario, su último
 * texto (el alta y sus ediciones); uno que él mismo borró después no se ofrece. Se leen aparte, sin la sincronización.
 */
export async function linkUnsentComments(entry: LinkEntry): Promise<{ id: string; body: string }[]> {
  const db = await openCommentsDb(commentsDbName(linkDbName(entry)));
  try {
    const texts = new Map<string, string>();
    for (const { op } of await db.getAll('outbox')) {
      if (op.kind === 'add' || op.kind === 'edit') texts.set(op.id, op.body);
      else if (op.kind === 'delete') texts.delete(op.id);
    }
    return [...texts].filter(([, body]) => body.trim() !== '').map(([id, body]) => ({ id, body }));
  } finally {
    db.close();
  }
}

/** El original de un archivo de `linkUnsentMedia`, para bajarlo (`null` si ya no está). */
export async function linkMediaBlob(entry: LinkEntry, id: string): Promise<Blob | null> {
  const db = await openMediaDb(mediaDbName(linkDbName(entry)));
  try {
    return ((await db.get('blobs', id)) as Blob | undefined) ?? null;
  } finally {
    db.close();
  }
}

export async function downloadLinkPages(entry: LinkEntry, pages: string[]): Promise<void> {
  const blob = await linkPagesBlob(entry, pages);
  saveBlob(blob, `shotdocs-link-${new Date().toISOString().slice(0, 10)}.json`);
}

const NONE: LinkEdits = { needName: false, waiting: [], aside: [] };

export function useLinkEdits(remote: LinkRemote | null): LinkEdits {
  return useSyncExternalStore(remote?.subscribeLinkEdits ?? noSubscribe, remote?.linkEdits ?? none);
}
const noSubscribe = () => () => undefined;
const none = () => NONE;

export function LinkEditBar({ entry, remote }: { entry: LinkEntry; remote: LinkRemote }) {
  const tr = useT();
  const edits = useLinkEdits(remote);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [edits.aside.length]);

  if (!edits.needName && edits.aside.length === 0) return null;
  const save = () => {
    const clean = cleanVisitorName(name);
    if (!clean) return;
    setVisitorName(entry.id, clean);
    remote.nameChanged();
  };
  return (
    <div className="notice link-edit-bar" role="status">
      {edits.needName && (
        <form
          className="link-edit-name"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <span>{tr('link.edit.namePrompt')}</span>
          <input value={name} maxLength={60} placeholder={tr('link.yourName')} aria-label={tr('link.yourName')} onChange={(e) => setName(e.target.value)} />
          <button className="primary" type="submit" disabled={!cleanVisitorName(name)}>
            {tr('link.saveName')}
          </button>
        </form>
      )}
      {edits.aside.length > 0 && (
        <p className="link-edit-aside">
          <span>
            {tr('link.edit.aside', { count: edits.aside.length })}
          </span>{' '}
          <button
            className="link"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void downloadLinkPages(entry, edits.aside)
                .catch(() => setFailed(true))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? tr('common.preparing') : tr('link.edit.downloadThem')}
          </button>
          {failed && <span className="error"> {tr('sync.downloadFailed')}</span>}
        </p>
      )}
    </div>
  );
}
