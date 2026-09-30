import * as Y from 'yjs';
import { toBase64 } from '../lib/base64';
import type { MediaDb } from '../media/mediaDb';
import { exportComments, unsyncedComments, type CommentsDb } from './comments';
import { hasUnsyncedContent, type LocalDb } from './localDb';
import { CONTENT_FRAGMENT } from './structure';

// Lo que el dispositivo tiene sin subir, para no perderlo cuando sacan a alguien del workspace (sección 8
// de Docs/Plan_Workspaces.md): se cuenta, se baja como archivo JSON y recién después, si la persona lo
// elige, se borra la base local. Se lee directo de IndexedDB: vale aunque la sincronización esté parada.

export interface UnsyncedSummary {
  /** Cambios del árbol en la cola (crear, renombrar, mover...). */
  ops: number;
  /** Cambios del árbol que el servidor rechazó y siguen guardados. */
  failedOps: number;
  /** Páginas con contenido sin confirmar. */
  pages: number;
  /** Imágenes pegadas (`sdfile://`) sin subir. */
  images: number;
  /** Fotos y videos (`sdmedia://`) sin terminar de subir, y sus usos en otras páginas. */
  media: number;
  /** Comentarios (altas, ediciones, borrados, resoluciones) sin subir, también los rechazados. */
  comments: number;
  total: number;
}

export async function unsyncedSummary(
  db: LocalDb,
  mediaDb: MediaDb | null,
  commentsDb: CommentsDb | null = null,
): Promise<UnsyncedSummary> {
  const [ops, failed, states, images, media, links, comments] = await Promise.all([
    db.count('ops'),
    db.count('failedOps'),
    db.getAll('docState'),
    db.countFromIndex('files', 'uploaded', 0),
    mediaDb ? mediaDb.countFromIndex('files', 'pending', 1) : 0,
    mediaDb ? mediaDb.countFromIndex('links', 'pending', 1) : 0,
    unsyncedComments(commentsDb).catch(() => 0),
  ]);
  const pages = states.filter(hasUnsyncedContent).length;
  const summary = { ops, failedOps: failed, pages, images, media: media + links, comments, total: 0 };
  summary.total = ops + failed + pages + images + media + links + comments;
  return summary;
}

/** Texto plano de un documento de BlockNote, para leer el archivo sin la app. */
function plainText(doc: Y.Doc): string {
  const lines: string[] = [];
  const walk = (node: Y.XmlElement | Y.XmlFragment | Y.XmlText) => {
    if (node instanceof Y.XmlText) {
      const text = (node.toDelta() as { insert?: unknown }[]).map((d) => (typeof d.insert === 'string' ? d.insert : '')).join('');
      if (text) lines.push(text);
      return;
    }
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlElement || child instanceof Y.XmlText) walk(child);
    }
  };
  walk(doc.getXmlFragment(CONTENT_FRAGMENT));
  return lines.join('\n');
}

export interface UnsyncedExportInfo {
  appVersion: string;
  workspace: { url: string; localKey: string; name: string };
  user: { id: string; email: string };
  /** El título de una página, si el dispositivo lo sabe. */
  titleOf: (pageId: string) => string | undefined;
}

/**
 * Todo lo pendiente, en un objeto que se guarda como JSON: la cola del árbol (y lo rechazado), los updates
 * de Yjs sin confirmar de cada página (en base64, más el texto para leerlo), las imágenes pegadas sin subir
 * (en base64: son de hasta 25 MB) y la lista de fotos y videos pendientes con sus nombres (los originales
 * se bajan aparte, uno por uno).
 */
export async function exportUnsynced(
  db: LocalDb,
  mediaDb: MediaDb | null,
  info: UnsyncedExportInfo,
  commentsDb: CommentsDb | null = null,
): Promise<unknown> {
  const [ops, failedOps, states, images] = await Promise.all([
    db.getAll('ops'),
    db.getAll('failedOps'),
    db.getAll('docState'),
    db.getAllFromIndex('files', 'uploaded', 0),
  ]);

  const pages = [];
  for (const state of states.filter(hasUnsyncedContent)) {
    const rows = await db.getAllFromIndex('docUpdates', 'pageId', state.pageId);
    const doc = new Y.Doc();
    if (rows.length > 0) Y.applyUpdate(doc, Y.mergeUpdates(rows.map((r) => r.data)));
    // Lo que el servidor todavía no confirmó: la diferencia contra lo que ya tiene.
    const update = Y.encodeStateAsUpdate(doc, state.syncedSV);
    pages.push({
      pageId: state.pageId,
      title: info.titleOf(state.pageId) ?? null,
      rejected: state.rejected ?? null,
      text: plainText(doc),
      yjsUpdate: toBase64(update),
      yjsFullState: toBase64(Y.encodeStateAsUpdate(doc)),
    });
    doc.destroy();
  }

  const media = mediaDb ? await mediaDb.getAllFromIndex('files', 'pending', 1) : [];
  const links = mediaDb ? await mediaDb.getAllFromIndex('links', 'pending', 1) : [];
  const comments = await exportComments(commentsDb).catch(() => []);

  return {
    kind: 'lga-shotdocs-unsynced',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    appVersion: info.appVersion,
    workspace: info.workspace,
    user: info.user,
    treeQueue: ops.map((o) => ({ op: o.op, createdAt: new Date(o.createdAt).toISOString() })),
    rejectedTreeChanges: failedOps.map((f) => ({ op: f.op, error: f.error, failedAt: new Date(f.failedAt).toISOString() })),
    pages,
    images: images.map((f) => ({
      path: f.path,
      pageId: f.pageId,
      pageTitle: info.titleOf(f.pageId) ?? null,
      mime: f.mime,
      size: f.data.byteLength,
      base64: toBase64(new Uint8Array(f.data)),
    })),
    media: media.map((m) => ({
      id: m.id,
      name: m.name,
      mime: m.mime,
      size: m.size,
      pageId: m.pageId,
      pageTitle: info.titleOf(m.pageId) ?? null,
      day: m.day,
      note: 'The original is not inside this file: download it separately from the app.',
    })),
    mediaLinks: links.map((l) => ({ pageId: l.pageId, fileId: l.fileId })),
    comments,
  };
}
