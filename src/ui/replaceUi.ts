import { useSyncExternalStore } from 'react';
import { metaOf, ProjectReplace } from '../search/projectReplace';
import { t } from '../i18n';
import { useServices, type Services } from '../services';
import { Permissions } from '../sync/access';

// Reemplazar en todo el proyecto (Docs/Doc_Buscar.md, "Reemplazar en el proyecto"): lo que vive siempre cargado. El
// motor (`ProjectReplace`, uno por instancia de servicios, como la búsqueda) y lo que el panel recuerda mientras
// dura la sesión: si el reemplazo está desplegado, lo escrito, *Aa*, palabra entera y lo sacado de la lista. El
// panel se baja aparte; el reemplazo sigue corriendo aunque se cierre (y Workspace.tsx pide confirmación antes de
// cerrar la pestaña o de cambiar de workspace mientras corre).

export interface ReplaceUiState {
  /** El renglón del reemplazo, desplegado. */
  open: boolean;
  replacement: string;
  matchCase: boolean;
  wholeWord: boolean;
  /** Coincidencias sacadas de la lista (por los ids de sus caracteres) y páginas sacadas enteras. */
  excluded: ReadonlyMap<string, ReadonlySet<string>>;
  excludedPages: ReadonlySet<string>;
}

const EMPTY: ReplaceUiState = {
  open: false,
  replacement: '',
  matchCase: false,
  wholeWord: false,
  excluded: new Map(),
  excludedPages: new Set(),
};

export class ReplaceSession {
  readonly engine: ProjectReplace;
  private state: ReplaceUiState = EMPTY;
  private readonly listeners = new Set<() => void>();

  constructor(services: Pick<Services, 'tree' | 'docs' | 'db' | 'engine' | 'access' | 'user'>) {
    const { tree, docs, db, engine, access, user } = services;
    this.engine = new ProjectReplace({
      tree,
      docs,
      meta: metaOf(db),
      perms: () => new Permissions(tree, access.get(), user.id),
      online: () => engine.getStatus().online,
      sync: () => engine.syncNow(),
    });
  }

  get = (): ReplaceUiState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  update(patch: Partial<ReplaceUiState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** Lo sacado de la lista vale para una búsqueda: al cambiar lo buscado o las opciones, vuelve todo. */
  clearExcluded(): void {
    if (this.state.excluded.size === 0 && this.state.excludedPages.size === 0) return;
    this.update({ excluded: new Map(), excludedPages: new Set() });
  }
}

const sessions = new WeakMap<object, ReplaceSession>();
/** Todas las sesiones de esta pestaña (para cerrar sesión desde una pantalla sin servicios). */
const every = new Set<ReplaceSession>();

/** El reemplazo de una instancia de servicios. */
export function replaceSession(services: Pick<Services, 'tree' | 'docs' | 'db' | 'engine' | 'access' | 'user'>): ReplaceSession {
  let session = sessions.get(services.docs);
  if (!session) {
    session = new ReplaceSession(services);
    sessions.set(services.docs, session);
    every.add(session);
  }
  return session;
}

/** Si hay un reemplazo (o su deshacer) corriendo en esta instancia de servicios. */
export function replaceRunning(services: { docs: object }): boolean {
  return sessions.get(services.docs)?.engine.isRunning() ?? false;
}

/**
 * Si hay un reemplazo (o su deshacer) corriendo en esta pestaña: cerrar sesión lo dejaría escribiendo en una base
 * cerrada (Docs/Doc_Buscar.md, auditoría de la entrega 3, hallazgo 4). Avisa y devuelve `true` si hay que esperar.
 */
export function replaceBlocksLeaving(): boolean {
  if (![...every].some((s) => s.engine.isRunning())) return false;
  alert(t('replace.runningLeave'));
  return true;
}

export function useReplaceSession(): { session: ReplaceSession; ui: ReplaceUiState } {
  const session = replaceSession(useServices());
  const ui = useSyncExternalStore(session.subscribe, session.get);
  useSyncExternalStore(session.engine.subscribe, session.engine.getVersion);
  return { session, ui };
}
