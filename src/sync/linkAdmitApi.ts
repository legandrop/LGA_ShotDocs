import { RemoteError } from './types';

// Lo que se habla con la base para admitir lo que escribe un link público (Docs/Doc_Link_Publico.md, E2.3): los tipos,
// la versión de la base y cómo se lee la respuesta. La vuelta de la admisión está en linkAdmit.ts.

/** La versión de la base con la sala y la admisión (20261028120000_link_editar.sql). */
export const LINK_EDIT_SCHEMA_VERSION = 19;

/** La versión de la base con la lista de lo apartado (`public_link_aside`, 20261029120000_link_apartado.sql). */
export const LINK_ASIDE_SCHEMA_VERSION = 20;

/** La versión de la base con los archivos por un link (`plink_register_file`, 20261030120000_link_archivos.sql). */
export const LINK_FILES_SCHEMA_VERSION = 21;

/** Como mucho, cuántas páginas se piden con bytes por vuelta (`link_admit_work` rechaza más de 20). */
export const ADMIT_PAGES_PER_ROUND = 20;

/** Una página con la que el editor está escribiendo no se prueba hasta esta pausa (como la base limpia, 20 s). */
export const ADMIT_PAUSE_MS = 20_000;

/** Una página con algo para decidir (`link_admit_pages`), sin bytes. */
export interface AdmitPageRow {
  page_id: string;
  waiting: number;
  bytes: number;
}

/** Una fila de la sala para probar (`link_admit_work`). */
export interface AdmitWorkRow {
  id: string;
  page_id: string;
  link_id: string;
  n: number;
  data: Uint8Array;
}

/** Lo que el editor decide de una fila. `media`: los archivos que suma (la base los vuelve a comprobar). */
export interface AdmitDecision {
  id: string;
  ok: boolean;
  reason?: string;
  media?: string[];
}

/** Lo que dice la base de cada fila: entró (con su `seq`), quedó apartada o retenida (el link dejó de editar ahí). */
export interface AdmitResult {
  id: string;
  decision: 'admitted' | 'aside' | 'held';
  seq?: number;
  reason?: string;
}

/** Lo que el link mandó a una página y no está en ella: apartado, retenido o esperando (`public_link_updates_of`). */
export interface LinkUpdateRow {
  id: string;
  link_id: string;
  author: string;
  created_at: string;
  bytes: number;
  state: 'waiting' | 'held' | 'aside';
  reason: string | null;
}

/**
 * Algo que un link mandó y quedó apartado (`public_link_aside`, entrega 2c), de cualquier link (también uno reseteado o
 * revocado), en una página que quien pregunta ve con lo borrado (hasta 200 por página). `link_page_id`: la página raíz
 * del link (la de su *Share*). Sin bytes: se bajan de a uno (`linkUpdateBytes`).
 */
export interface LinkAsideRow {
  id: string;
  page_id: string;
  link_id: string;
  /** Nula si quien pregunta no ve la raíz del link (no se le da ni su id). */
  link_page_id: string | null;
  author: string;
  created_at: string;
  decided_at: string | null;
  bytes: number;
  reason: string | null;
}

/** Lo apartado de todos los links (Share, el árbol y el historial; entrega 2c). */
export interface LinkAsideRemote {
  linkAside(): Promise<LinkAsideRow[]>;
  linkUpdateBytes(id: string): Promise<Uint8Array>;
}

export function canListAside(remote: object): remote is LinkAsideRemote {
  const r = remote as Partial<LinkAsideRemote> & { admitsLinks?: boolean };
  return r.admitsLinks !== false && typeof r.linkAside === 'function' && typeof r.linkUpdateBytes === 'function';
}

/** El servidor de la admisión (`SupabaseRemote` y el servidor en memoria de las pruebas). */
export interface LinkAdmitRemote {
  admitPages(): Promise<AdmitPageRow[]>;
  admitWork(pages: string[]): Promise<AdmitWorkRow[]>;
  admit(pageId: string, decisions: AdmitDecision[]): Promise<AdmitResult[]>;
  linkUpdatesOf(pageId: string): Promise<LinkUpdateRow[]>;
  linkUpdateBytes(id: string): Promise<Uint8Array>;
}

export function canAdmit(remote: object): remote is LinkAdmitRemote {
  const r = remote as Partial<LinkAdmitRemote> & { admitsLinks?: boolean };
  return r.admitsLinks !== false && typeof r.admitPages === 'function' && typeof r.admitWork === 'function' && typeof r.admit === 'function';
}

export function parseAdmitResults(data: unknown): AdmitResult[] {
  if (!Array.isArray(data)) throw new RemoteError(`link_admit: unexpected answer ${JSON.stringify(data)?.slice(0, 200)}`, true);
  return data.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    decision: r.decision === 'admitted' || r.decision === 'aside' ? r.decision : 'held',
    ...(r.seq == null ? {} : { seq: Number(r.seq) }),
    ...(typeof r.reason === 'string' ? { reason: r.reason } : {}),
  }));
}
