import type { LocalDb } from './localDb';
import type { Remote } from './remote';
import type { PageTree } from './tree';
import { errorMessage, isNetworkError } from './types';

// Permisos en el dispositivo (paso 9 de Docs/Plan_Workspaces.md). La base decide de verdad (políticas y
// trigger `pages_permissions` de supabase/migrations/20260930160000_equipo.sql); la app hace la misma
// cuenta con lo que la persona puede leer (su fila de `members`, sus filas de `grants` y el creador de cada
// proyecto) para no ofrecer lo que el servidor va a rechazar. La cuenta se guarda en la base local, así
// anda sin red. Si todavía no hay datos (base sin migrar, sin red la primera vez), no se bloquea nada:
// lo que el servidor rechace va a los rechazados, como siempre.

export type Role = 'owner' | 'admin' | 'member' | 'guest';
export type GrantLevel = 'view' | 'comment' | 'edit' | 'edit_pages';

export const ROLES: Role[] = ['owner', 'admin', 'member', 'guest'];
export const GRANT_LEVELS: GrantLevel[] = ['view', 'comment', 'edit', 'edit_pages'];

export const LEVEL_LABELS: Record<GrantLevel, string> = {
  view: 'View',
  comment: 'Comment',
  edit: 'Edit',
  edit_pages: 'Edit & create pages',
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  guest: 'Guest',
};

/** La escala de la base: 0 nada, 1 ver, 2 comentar, 3 editar, 4 editar y crear páginas. */
export const LEVEL_VIEW = 1;
export const LEVEL_EDIT = 3;
export const LEVEL_EDIT_PAGES = 4;

/** La versión de la base desde la que las políticas miran `members` y `grants` (paso 9). */
export const TEAM_SCHEMA_VERSION = 4;

export function levelValue(level: string | null | undefined): number {
  const at = GRANT_LEVELS.indexOf(level as GrantLevel);
  return at < 0 ? 0 : at + 1;
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as string[]).includes(value);
}

export function isGrantLevel(value: unknown): value is GrantLevel {
  return typeof value === 'string' && (GRANT_LEVELS as string[]).includes(value);
}

/** Una fila propia de `grants`: sobre un proyecto o sobre una página (una de las dos). */
export interface MyGrant {
  id: string;
  project_id: string | null;
  page_id: string | null;
  level: GrantLevel;
}

/** La fila propia de `members`. */
export interface MyMembership {
  role: Role;
  removed_at: string | null;
}

/** Lo que la persona puede leer de sus permisos, tal como vino del servidor. */
export interface AccessSnapshot {
  /** `null`: la base no tiene fila de esta persona (no es miembro). */
  member: MyMembership | null;
  grants: MyGrant[];
  fetchedAt: number;
}

/**
 * La señal de que sacaron a la persona del workspace: SOLO su fila de `members` con `removed_at`. Nada más
 * cuenta (ni un error, ni una lista vacía, ni una respuesta rara): esto termina ofreciendo borrar lo del
 * workspace en el dispositivo.
 */
export function isRemovedSignal(snapshot: AccessSnapshot | null | undefined): boolean {
  const member = snapshot?.member;
  if (!member || typeof member !== 'object' || !isRole(member.role)) return false;
  const at = member.removed_at;
  return typeof at === 'string' && at.trim() !== '' && !Number.isNaN(Date.parse(at));
}

/**
 * Revisa una respuesta del servidor antes de guardarla. Algo que no tiene la forma esperada tira un error
 * (y no cambia nada), en vez de convertirse en "sin permisos" o en la señal de sacado.
 */
export function parseAccess(memberRow: unknown, grantRows: unknown, now = Date.now()): AccessSnapshot {
  let member: MyMembership | null = null;
  if (memberRow !== null && memberRow !== undefined) {
    const row = memberRow as { role?: unknown; removed_at?: unknown };
    if (typeof row !== 'object' || !isRole(row.role)) throw new Error('Unexpected answer for members.');
    const removed = row.removed_at;
    if (removed !== null && removed !== undefined && typeof removed !== 'string') {
      throw new Error('Unexpected answer for members.');
    }
    member = { role: row.role, removed_at: removed ?? null };
  }
  if (!Array.isArray(grantRows)) throw new Error('Unexpected answer for grants.');
  const grants: MyGrant[] = [];
  for (const raw of grantRows as { id?: unknown; project_id?: unknown; page_id?: unknown; level?: unknown; revoked_at?: unknown }[]) {
    // Un permiso con un nivel desconocido (de una versión más nueva de la base) no suma nada, ni uno sacado
    // (`revoked_at`: queda en la tabla sin efecto).
    if (!raw || typeof raw !== 'object' || !isGrantLevel(raw.level)) continue;
    if (raw.revoked_at !== null && raw.revoked_at !== undefined) continue;
    const project = typeof raw.project_id === 'string' ? raw.project_id : null;
    const page = typeof raw.page_id === 'string' ? raw.page_id : null;
    if ((project === null) === (page === null)) continue;
    grants.push({ id: String(raw.id ?? ''), project_id: project, page_id: page, level: raw.level });
  }
  return { member, grants, fetchedAt: now };
}

const ACCESS_KEY = 'access';

/**
 * Los permisos de la persona en este dispositivo: la última respuesta del servidor, guardada en la base
 * local (`meta.access`). `null` mientras no se sabe nada: entonces no se bloquea nada.
 */
export class AccessStore {
  private snapshot: AccessSnapshot | null = null;
  private listeners = new Set<() => void>();
  private revision = 0;

  constructor(
    private readonly db: LocalDb | null,
    readonly userId: string,
  ) {}

  async load(): Promise<void> {
    if (!this.db) return;
    const saved = (await this.db.get('meta', ACCESS_KEY)) as AccessSnapshot | undefined;
    this.snapshot = saved && typeof saved === 'object' && Array.isArray(saved.grants) ? saved : null;
    this.notify();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getRevision = (): number => this.revision;

  get(): AccessSnapshot | null {
    return this.snapshot;
  }

  /** Guarda la respuesta nueva (o `null`: no hay datos, por ejemplo una base sin migrar). */
  async set(next: AccessSnapshot | null): Promise<void> {
    const same = JSON.stringify(strip(next)) === JSON.stringify(strip(this.snapshot));
    // Se pregunta en cada ciclo: si no cambió nada, no se escribe.
    if (same) return;
    if (this.db) {
      if (next) await this.db.put('meta', next, ACCESS_KEY);
      else await this.db.delete('meta', ACCESS_KEY);
    }
    this.snapshot = next;
    this.notify();
  }

  /** La base dijo que sacaron a la persona del workspace. */
  get removed(): boolean {
    return isRemovedSignal(this.snapshot);
  }

  private notify(): void {
    this.revision++;
    for (const fn of this.listeners) fn();
  }
}

function strip(s: AccessSnapshot | null): unknown {
  return s && { member: s.member, grants: s.grants };
}

/**
 * Qué puede hacer la persona, con la misma cuenta que la base (`private.page_level`,
 * `private.project_level`, `private.can_share`...). Sin datos, todo da permitido.
 */
export class Permissions {
  constructor(
    private readonly tree: PageTree,
    private readonly access: AccessSnapshot | null,
    private readonly userId: string,
  ) {}

  /** Hay datos de permisos: sin ellos no se bloquea nada. */
  get known(): boolean {
    return this.access !== null;
  }

  /** El rol activo; `null` sin datos, sin fila o si la sacaron. */
  get role(): Role | null {
    const m = this.access?.member;
    return m && !m.removed_at ? m.role : null;
  }

  private get active(): boolean {
    return this.role !== null;
  }

  private isCreator(projectId: string): boolean {
    const project = this.tree.project(projectId);
    if (!project) return false;
    if (typeof project.owner_id === 'string') return project.owner_id === this.userId;
    // Creado en este dispositivo y todavía sin volver del servidor: solo lo pudo crear esta persona.
    if (this.tree.isLocalProject(projectId)) return true;
    // No se sabe de quién es (el de relleno antes de bajar la lista, o una copia de una versión anterior):
    // al dueño y a los admins no se les bloquea lo que ya podían hacer; a los demás no se les ofrece crear
    // ni renombrar hasta saberlo (sus permisos por `grants` valen igual).
    return this.role === 'owner' || this.role === 'admin';
  }

  /** Nivel sobre un proyecto entero (0..4): creador o permiso sobre el proyecto. */
  projectLevel(projectId: string): number {
    if (!this.access) return LEVEL_EDIT_PAGES;
    if (!this.active) return 0;
    let level = this.isCreator(projectId) ? LEVEL_EDIT_PAGES : 0;
    for (const g of this.access.grants) {
      if (g.project_id === projectId) level = Math.max(level, levelValue(g.level));
    }
    return level;
  }

  /**
   * Nivel sobre una página (0..4): el más alto entre ser creador del proyecto, un permiso sobre el
   * proyecto y uno sobre la página o alguna de arriba. Los permisos bajan, nunca suben.
   */
  pageLevel(pageId: string): number {
    if (!this.access) return LEVEL_EDIT_PAGES;
    if (!this.active) return 0;
    const page = this.tree.get(pageId);
    if (!page) return 0;
    const chain = new Set([pageId, ...this.tree.ancestors(pageId).map((p) => p.id)]);
    let level = this.isCreator(page.workspace_id) ? LEVEL_EDIT_PAGES : 0;
    for (const g of this.access.grants) {
      if (g.project_id === page.workspace_id || (g.page_id !== null && chain.has(g.page_id))) {
        level = Math.max(level, levelValue(g.level));
      }
    }
    return level;
  }

  canEditPage(pageId: string): boolean {
    return this.pageLevel(pageId) >= LEVEL_EDIT;
  }

  /**
   * Poner la estructura inicial en una página vacía es escribirla: solo con los permisos ya conocidos y
   * "Edit". Sin datos no se siembra (es la única escritura que la app hace sola al abrir una página).
   */
  canSeed(pageId: string): boolean {
    return this.known && this.canEditPage(pageId);
  }

  /** Crear, mover, mandar a la papelera o restaurar: 4 sobre la página. */
  canManagePage(pageId: string): boolean {
    return this.pageLevel(pageId) >= LEVEL_EDIT_PAGES;
  }

  /** Crear una página adentro de `parentId`, o en la raíz del proyecto. */
  canCreateIn(parentId: string | null, projectId: string): boolean {
    return parentId ? this.pageLevel(parentId) >= LEVEL_EDIT_PAGES : this.projectLevel(projectId) >= LEVEL_EDIT_PAGES;
  }

  /** Mover `pageId` adentro de `parentId` (o a la raíz): 4 en la página y en el destino. */
  canMove(pageId: string, parentId: string | null): boolean {
    const page = this.tree.get(pageId);
    if (!page) return false;
    return this.canManagePage(pageId) && this.canCreateIn(parentId, page.workspace_id);
  }

  /** Solo el dueño y los admins crean proyectos. Sin datos, lo de antes. */
  get canCreateProject(): boolean {
    if (!this.access) return true;
    return this.role === 'owner' || this.role === 'admin';
  }

  canRenameProject(projectId: string): boolean {
    return this.projectLevel(projectId) >= LEVEL_EDIT_PAGES;
  }

  /** La pantalla de miembros: dueño y admins. Sin datos, no se ofrece (la base puede no tener las funciones). */
  get canManageMembers(): boolean {
    return this.role === 'owner' || this.role === 'admin';
  }

  /**
   * Compartir un proyecto o una página: 4 sobre eso y ser dueño o admin, o quien creó el proyecto. Sin
   * datos, no se ofrece.
   */
  canShareProject(projectId: string): boolean {
    if (!this.access || !this.active) return false;
    return (
      this.projectLevel(projectId) >= LEVEL_EDIT_PAGES &&
      (this.role === 'owner' || this.role === 'admin' || this.isCreator(projectId))
    );
  }

  canSharePage(pageId: string): boolean {
    if (!this.access || !this.active) return false;
    const page = this.tree.get(pageId);
    if (!page) return false;
    return (
      this.pageLevel(pageId) >= LEVEL_EDIT_PAGES &&
      (this.role === 'owner' || this.role === 'admin' || this.isCreator(page.workspace_id))
    );
  }

  /** Invitar gente nueva (con `create_invitation`): dueño y admins. */
  get canInvite(): boolean {
    return this.role === 'owner' || this.role === 'admin';
  }
}

/**
 * Aplica las invitaciones del correo de la sesión (`accept_invitations`). Nunca corta la entrada: sin red,
 * con una base que todavía no tiene la función o con cualquier error, sigue como si no hubiera ninguna.
 * Devuelve cuántas aplicó.
 */
export async function acceptInvitationsQuietly(remote: Pick<Remote, 'acceptInvitations'>): Promise<number> {
  try {
    return (await remote.acceptInvitations()) ?? 0;
  } catch (err) {
    if (!isNetworkError(err)) console.warn('accept_invitations:', errorMessage(err));
    return 0;
  }
}
