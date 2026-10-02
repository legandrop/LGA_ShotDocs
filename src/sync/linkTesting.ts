import type { SupabaseClient } from '@supabase/supabase-js';
import { toBase64 } from '../lib/base64';
import { AccessStore, Permissions } from './access';
import { CommentQueue, commentsDbName, openCommentsDb, type CommentRow } from './comments';
import { PageDocs } from './docs';
import { SyncEngine } from './engine';
import { PageFiles } from './files';
import { LinkCommentRemote, LinkRemote, type LinkProblem } from './linkRemote';
import { openLocalDb, type LocalDb } from './localDb';
import { normalizeStructure, seedIfEmpty } from './structure';
import type { FakeServer } from './testing';
import { PageTree } from './tree';

// Lo de las pruebas del modo link (Docs/Doc_Link_Publico.md, sección 6.2): un cliente de Supabase en memoria que
// contesta las funciones `plink_*` con los datos de `FakeServer` y las mismas reglas que la migración
// (20261012120000_link_publico.sql), y un dispositivo de visitante armado como en services.ts.

type Result = { data: unknown; error: { message: string; code: string } | null; status: number };

/** Lo que se le pidió al cliente del link: la función y los headers (para ver que nunca va una sesión). */
export interface LinkCall {
  fn: string;
  headers: Record<string, string>;
}

/** Un link vivo en el servidor en memoria (como `create_public_link`). Devuelve el token. */
export function addPublicLink(server: FakeServer, pageId: string, createdBy = server.ownerId): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = 'sdl_' + toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  server.publicLinks.set(token, { id: crypto.randomUUID(), pageId, createdBy });
  server.cleanReset({ pageId });
  return token;
}

/**
 * Un cliente que habla como el de supabase-js (`rpc` devuelve `{ data, error, status }`) contra `FakeServer`, con el
 * token y el dispositivo en sus headers. `calls` junta lo pedido.
 */
export function fakeLinkClient(server: FakeServer, headers: Record<string, string>, calls: LinkCall[] = []): SupabaseClient {
  const fail = (message: string, code: string, status: number): Result => ({ data: null, error: { message, code }, status });
  const link = () => {
    const l = server.publicLinks.get(headers['x-shotdocs-link'] ?? '');
    if (!l || l.revoked) return null;
    // El creador todavía puede compartir: miembro activo que no es invitado.
    const role = server.role(l.createdBy);
    if (!role || role === 'guest' || server.pageLevel(l.createdBy, l.pageId, true) < 4) return null;
    return l;
  };
  /** `plink_page_level`: la raíz del link en la cadena y nada de la cadena en la papelera. */
  const level = (pageId: string): number => {
    const l = link();
    if (!l) return 0;
    let under = false;
    for (let cur: string | null = pageId, n = 0; cur && n < 10000; cur = server.pages.get(cur)?.parent_id ?? null, n++) {
      const p = server.pages.get(cur);
      if (!p || p.deleted_at) return 0;
      if (cur === l.pageId) under = true;
    }
    return under ? 2 : 0;
  };
  const branch = (): string[] => {
    const l = link();
    if (!l || level(l.pageId) === 0) return [];
    return server.branch(l.pageId).filter((id) => level(id) > 0);
  };
  const device = () => headers['x-shotdocs-device'] ?? null;
  const rpc = async (fn: string, args: Record<string, unknown>): Promise<Result> => {
    calls.push({ fn, headers: { ...headers } });
    if (!server.online) return fail('Failed to fetch', '', 0);
    const l = link();
    if (!l || level(l.pageId) === 0) return fail('link_not_found', 'P0002', 404);
    switch (fn) {
      case 'plink_open': {
        const s = server.settings;
        return {
          data: {
            link_id: l.id, page_id: l.pageId, title: server.pages.get(l.pageId)?.title ?? '', level: 'comment', expires_at: null,
            min_app_version: s?.minAppVersion ?? null, schema_version: Math.max(s?.schemaVersion ?? 0, 14),
            clean_on: server.cleanOn(), media_url: s?.mediaUrl ?? null, outdated: false,
          },
          error: null,
          status: 200,
        };
      }
      case 'plink_tree': {
        const rows = branch().map((id) => {
          const p = server.pages.get(id)!;
          const clean = server.cleanMeta.get(id)?.seq ?? 0;
          return {
            id, workspace_id: l.id, parent_id: id === l.pageId ? null : p.parent_id, title: p.title, icon: p.icon,
            sort_key: p.sort_key, settings: {}, update_seq: clean > 0 ? clean : p.update_seq > 0 ? 1 : 0, clean_seq: clean,
            created_at: p.created_at, updated_at: p.updated_at,
          };
        });
        const sig = JSON.stringify(rows);
        if (args.p_sig === sig) return { data: [], error: null, status: 200 };
        return { data: rows.map((r) => ({ ...r, sig })), error: null, status: 200 };
      }
      case 'plink_pull_page': {
        const pageId = String(args.p_page_id);
        if (level(pageId) < 1) return fail('page_not_found', 'P0002', 404);
        if (!server.cleanOn()) return { data: [], error: null, status: 200 };
        const base = server.currentBase(pageId);
        if (!base || base.toSeq <= Number(args.p_after_seq ?? 0)) return { data: [], error: null, status: 200 };
        return { data: [{ seq: base.toSeq, update: toBase64(base.state) }], error: null, status: 200 };
      }
      case 'plink_media_files':
        return { data: [], error: null, status: 200 };
      case 'plink_list_comments': {
        const pageId = String(args.p_page_id);
        if (level(pageId) < 1) return fail('page_not_found', 'P0002', 404);
        const since = (args.p_since as string | null) ?? null;
        const rows = [...server.comments.values()]
          .filter((c) => c.page_id === pageId && (since === null || (c.updated_at ?? c.created_at) >= since))
          .map((c) => {
            const stored = c as CommentRow & { plink_id?: string; plink_device?: string; updated_at?: string };
            const kind = stored.plink_id ? 'link' : c.imported_from ? 'imported' : 'team';
            const email = c.author_id ? server.members.get(c.author_id)?.email : undefined;
            return {
              id: c.id, page_id: c.page_id, block_id: c.block_id, thread_id: c.thread_id, body: c.deleted_at ? null : c.body,
              author_name: kind === 'link' ? stored.plink_author : kind === 'imported' ? c.imported_author : email ? email.split('@')[0] : null,
              author_kind: kind, mine: stored.plink_id === l.id && !!device() && stored.plink_device === device(),
              created_at: c.created_at, edited_at: c.edited_at, resolved_at: c.resolved_at, deleted_at: c.deleted_at,
              updated_at: stored.updated_at ?? c.created_at,
            };
          });
        return { data: rows, error: null, status: 200 };
      }
      case 'plink_add_comment': {
        const pageId = String(args.p_page_id);
        if (level(pageId) < 2) return fail('page_not_found', 'P0002', 404);
        const name = String(args.p_author ?? '').trim();
        if (!name || name.length > 60) return fail('author_invalid', '22023', 400);
        const id = String(args.p_id);
        if (server.comments.has(id)) return { data: null, error: null, status: 204 };
        const now = new Date().toISOString();
        server.comments.set(id, {
          id, page_id: pageId, block_id: (args.p_block_id as string | null) ?? null, thread_id: (args.p_thread_id as string | null) ?? null,
          body: String(args.p_body), author_id: null, created_at: now, edited_at: null, resolved_at: null, resolved_by: null,
          deleted_at: null, deleted_by: null, updated_at: now, plink_author: name, plink_id: l.id, plink_device: device(),
        } as CommentRow & { body: string; updated_at: string });
        return { data: null, error: null, status: 204 };
      }
      case 'plink_edit_comment':
      case 'plink_delete_comment': {
        const c = server.comments.get(String(args.p_id)) as (CommentRow & { body: string; plink_id?: string; plink_device?: string; updated_at?: string }) | undefined;
        if (!c || level(c.page_id) < 1) return fail('comment_not_found', 'P0002', 404);
        if (c.plink_id !== l.id || !device() || c.plink_device !== device()) return fail('not_allowed', '42501', 403);
        const now = new Date().toISOString();
        if (fn === 'plink_edit_comment') Object.assign(c, { body: String(args.p_body), edited_at: now, updated_at: now });
        else if (!c.deleted_at) Object.assign(c, { deleted_at: now, updated_at: now });
        return { data: null, error: null, status: 204 };
      }
      default:
        return fail(`permission denied for function ${fn}`, '42501', 401);
    }
  };
  return { rpc: (fn: string, args: Record<string, unknown> = {}) => rpc(fn, args) } as unknown as SupabaseClient;
}

export interface LinkDevice {
  db: LocalDb;
  tree: PageTree;
  docs: PageDocs;
  engine: SyncEngine;
  remote: LinkRemote;
  comments: CommentQueue;
  access: AccessStore;
  problems: (LinkProblem | null)[];
  calls: LinkCall[];
  /** El nombre con el que comenta el visitante. */
  name: { value: string };
}

/** Un visitante con el link: como \`services.ts\` en modo link (modo liviano, solo bases, comentarios con nombre). */
export async function makeLinkDevice(server: FakeServer, token: string, device = 'dev-' + 'x'.repeat(20), appVersion = '9.999'): Promise<LinkDevice> {
  const calls: LinkCall[] = [];
  const problems: (LinkProblem | null)[] = [];
  const client = fakeLinkClient(server, { 'x-shotdocs-version': appVersion, 'x-shotdocs-link': token, 'x-shotdocs-device': device }, calls);
  const remote = new LinkRemote(client, appVersion, (p) => problems.push(p));
  const userId = `link:${device}`;
  const db = await openLocalDb(crypto.randomUUID());
  const access = new AccessStore(db, userId);
  await access.load();
  const tree = new PageTree(db, (await remote.ensureWorkspace()) ?? 'link');
  await tree.load();
  const docs = new PageDocs(db, {
    normalize: normalizeStructure,
    seed: seedIfEmpty,
    canWrite: (pageId) => new Permissions(tree, access.get(), userId).canEditPage(pageId),
  });
  const files = new PageFiles(db, remote);
  const name = { value: '' };
  const commentsDb = await openCommentsDb(commentsDbName(crypto.randomUUID()));
  const comments = new CommentQueue(commentsDb, new LinkCommentRemote(client, userId, () => name.value), userId);
  await comments.load();
  const engine = new SyncEngine(remote, tree, docs, files, {
    appVersion,
    access,
    comments,
    intervalMs: 30_000,
    pullOnly: (id, cursor) => cursor > 0 || !!docs.peek(id),
  });
  return { db, tree, docs, engine, remote, comments, access, problems, calls, name };
}
