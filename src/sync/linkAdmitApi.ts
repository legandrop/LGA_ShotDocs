import { RemoteError } from './types';

// Lo que se habla con la base para admitir lo que escribe un link público (Docs/Doc_Link_Publico.md, E2.3): los tipos,
// la versión de la base y cómo se lee la respuesta. La vuelta de la admisión está en linkAdmit.ts.

/** La versión de la base con la sala y la admisión (20261027120000_link_editar.sql). */
export const LINK_EDIT_SCHEMA_VERSION = 19;

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
