import { useEffect, useSyncExternalStore } from 'react';
import type { IndexDocs, IndexTree, ProjectIndex } from '../search/projectIndex';
import { buildRegistry, scan } from '../relations/reader';
import { entityRelations, indexPages, pageRelations, pendingRelations, RelationIndex } from '../relations/relationIndex';
import type { RegisterTree } from '../relations/register';
import { useServices, useSyncStatus, useTree } from '../services';
import type { LocalDb } from '../sync/localDb';
import type { PageRow } from '../sync/types';
import { useCurrentProject } from './project';
import { searchSession } from './projectSearchUi';

// Las relaciones en vivo de una instancia de servicios (Docs/Doc_Relaciones.md, sección 5): arrancan el índice del
// proyecto al abrirlo (antes, la primera vez que se abría ⌘K), lo mantienen leyendo aunque se cierre el panel de buscar,
// releen la página abierta medio segundo después de dejar de escribir y reconocen escenas y locaciones con lo leído.
// Nada escribe en el documento ni sube a la base. Con un link público no corren (no hay tipos de página).

/** Espera después de la última edición local antes de releer la página. */
export const REREAD_MS = 500;
/** Espera para leer lo que cambió después de un cambio del árbol o una sincronización. */
const REFRESH_MS = 300;

type RelationServices = { tree: IndexTree & RegisterTree & { subscribe(fn: () => void): () => void }; docs: IndexDocs; db?: LocalDb };

export class RelationsSession {
  readonly index: ProjectIndex;
  readonly relations: RelationIndex;
  private projectId: string | null = null;
  private readonly release: () => void;
  private readonly stops: (() => void)[] = [];
  private readonly edited = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(services: RelationServices) {
    this.index = searchSession(services).index;
    this.release = this.index.retain();
    this.relations = new RelationIndex(services.tree, this.index);
    // Lo que leyó el índice y los cambios del árbol (una escena nueva, un título que cambió) se vuelven a reconocer.
    this.stops.push(this.index.subscribe(() => this.recognize()));
    this.stops.push(services.tree.subscribe(() => this.recognize()));
    this.stops.push(
      services.docs.subscribeLocalChange((pageId) => {
        this.edited.add(pageId);
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.reread(), REREAD_MS);
      }),
    );
  }

  /** El proyecto abierto: lee lo que falte o haya cambiado (al abrirlo, al sincronizar, al cambiar el árbol). */
  open(projectId: string): void {
    const changed = this.projectId !== projectId;
    this.projectId = projectId;
    if (changed) {
      void this.index.refresh(projectId);
      this.recognize();
      return;
    }
    // Un cambio del árbol por tecla (un título que se escribe) no relee el estado de todas las páginas cada vez.
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      if (this.projectId) void this.index.refresh(this.projectId);
    }, REFRESH_MS);
  }

  private recognize(): void {
    if (this.projectId) void this.relations.update(this.projectId);
  }

  /** Medio segundo sin escribir: la página abierta se relee de su documento vivo; las demás, en la próxima pasada. */
  private reread(): void {
    this.timer = null;
    const projectId = this.projectId;
    if (!projectId) return;
    let others = false;
    for (const pageId of this.edited) if (!this.index.readOpen(projectId, pageId)) others = true;
    this.edited.clear();
    if (others) void this.index.refresh(projectId);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    for (const stop of this.stops.splice(0)) stop();
    this.release();
    this.relations.dispose();
  }
}

const sessions = new WeakMap<object, RelationsSession>();

export function relationsSession(services: RelationServices): RelationsSession {
  let session = sessions.get(services.docs);
  if (!session) sessions.set(services.docs, (session = new RelationsSession(services)));
  return session;
}

/** Las relaciones ya arrancadas (por `RelationsRunner`), sin arrancarlas: para quien solo las muestra (la cabecera viva). */
export function existingRelationsSession(services: { docs: IndexDocs }): RelationsSession | null {
  return sessions.get(services.docs) ?? null;
}

/** Suelta las relaciones de una instancia de servicios (cerrar sesión, cambiar de workspace). Antes que la búsqueda. */
export function disposeRelationsSession(services: { docs: IndexDocs }): void {
  sessions.get(services.docs)?.dispose();
  sessions.delete(services.docs);
}

/**
 * Arranca y mantiene al día las relaciones del proyecto abierto. Va montado en el espacio de trabajo (no con un link
 * público). No dibuja nada.
 */
export function RelationsRunner(): null {
  const services = useServices();
  const tree = useTree();
  const status = useSyncStatus();
  const projectId = useCurrentProject();
  const session = relationsSession(services);
  const treeRevision = tree.getRevision();
  useEffect(() => {
    session.open(projectId);
  }, [session, projectId, status.lastSyncAt, treeRevision]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // Para auditar sin interfaz (solo en desarrollo, el build lo saca): `__shotdocsRelations` en la consola, y
    // `__shotdocsDev` con el árbol y los documentos para los guiones de desarrollo (ERSO a vivo, E4).
    const w = window as unknown as Record<string, unknown>;
    w.__shotdocsRelations = relationsDebug(session, () => projectId, services.tree);
    w.__shotdocsDev = { tree: services.tree, docs: services.docs, projectId };
  }, [session, projectId, services]);
  return null;
}

/** Lo que lee el índice, mientras lee mucho: «Reading 340 of 921…» (o `null`). */
export function useIndexProgress(): { ready: number; total: number } | null {
  const services = useServices();
  const projectId = useCurrentProject();
  const index = searchSession(services).index;
  useSyncExternalStore(index.subscribe, index.getRevision);
  return index.info(projectId).progress;
}

/** Las consultas del índice de relaciones, para la consola del navegador en desarrollo (Docs/Doc_Relaciones.md, 7). */
export function relationsDebug(session: RelationsSession, project: () => string, tree?: Pick<RegisterTree, 'roots' | 'children'>) {
  const snap = () => session.relations.snapshot(project());
  const short = (r: ReturnType<typeof entityRelations>) => ({
    ...r,
    pages: r.pages.map((p) => ({
      ...p,
      title: session.index.pagesOf(project()).find((x) => x.id === p.pageId)?.title,
      mentions: p.mentions.map((m) => `${m.via}${m.hidden ? '~' : ''} ${m.ref}${m.part ? `(${m.part})` : ''} @${m.blockId}`),
      sections: p.sections.map((s) => `«${s.title}» ${s.blockId}→${s.endBlockId ?? 'end'} · ${s.media.length} fotos`),
    })),
  });
  return {
    /** El estado: páginas leídas, por leer, si está completo y cuántas escenas y locaciones existen. */
    stats: () => {
      const s = snap();
      return s && { pages: s.pages.size, unread: s.unread, complete: s.complete, scenes: s.registry.scenes.size, locations: s.registry.locations.size, duplicates: s.registration.duplicates, index: session.index.info(project()) };
    },
    /** Lo que existe: escenas (código → página) y locaciones (nombre → alias). */
    registry: () => {
      const s = snap();
      return s && { scenes: Object.fromEntries([...s.registry.scenes].map(([k, v]) => [k, v.pageId])), locations: Object.fromEntries([...s.registry.locations].map(([k, v]) => [k, v.aliases])) };
    },
    /** Todo lo de una escena (`'101_074'`). */
    scene: (code: string) => {
      const s = snap();
      return s && short(entityRelations(s, 'scene', code));
    },
    /** Todo lo de una locación (su nombre). */
    location: (name: string) => {
      const s = snap();
      return s && short(entityRelations(s, 'loc', name));
    },
    /** Lo que nombra una página (menciones y secciones). */
    page: (pageId: string) => {
      const s = snap();
      return s && pageRelations(s, pageId);
    },
    /** Qué es cada página (entidad, parte de, etapa, excluida). */
    role: (pageId: string) => snap()?.registration.roles.get(pageId),
    pending: () => {
      const s = snap();
      return s && pendingRelations(s);
    },
    indexPages: () => {
      const s = snap();
      return s && indexPages(s).map((id) => session.index.pagesOf(project()).find((x) => x.id === id)?.title ?? id);
    },
    /**
     * Todo el índice del proyecto en un objeto (para comparar con la fuente en un guion): lo que existe, los duplicados,
     * los pendientes y, por página visible en el orden del árbol, su fila, su papel, sus relaciones y sus unidades.
     */
    dump: (name = 'app') => {
      const s = snap();
      if (!s || !tree) return null;
      const projectId = project();
      const pages: unknown[] = [];
      const visit = (row: PageRow) => {
        const content = session.index.content(row.id);
        pages.push({
          id: row.id,
          parent: row.parent_id,
          title: row.title,
          settings: row.settings ?? {},
          role: s.registration.roles.get(row.id) ?? null,
          rel: s.pages.get(row.id) ?? null,
          units: content ? content.units.map((u) => ({ b: u.blockId, f: u.field, t: u.text })) : null,
        });
        for (const c of tree.children(row.id)) visit(c);
      };
      for (const r of tree.roots(projectId)) visit(r);
      return {
        name,
        projectId,
        complete: s.complete,
        registry: {
          scenes: Object.fromEntries([...s.registry.scenes].map(([k, v]) => [k, v.pageId])),
          locations: Object.fromEntries([...s.registry.locations].map(([k, v]) => [k, { pageId: v.pageId, aliases: v.aliases }])),
        },
        duplicates: s.registration.duplicates,
        pending: pendingRelations(s),
        pages,
      };
    },
    /** Probar el lector con un texto: `scan('Escena 1074C', true)`. */
    scan: (text: string, heading = false) => {
      const s = snap();
      return s ? scan(s.registry, text, { heading }) : scan(buildRegistry({ scenes: [], locations: [] }), text, { heading });
    },
  };
}
