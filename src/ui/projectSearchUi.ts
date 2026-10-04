import { useSyncExternalStore } from 'react';
import { ProjectIndex, type IndexDocs, type IndexTree } from '../search/projectIndex';
import { useServices } from '../services';
import { IS_MAC, isLetter, modPressed } from './findUi';

// La búsqueda en todo el proyecto (Docs/Doc_Buscar.md, secciones 7 a 9): lo que vive siempre cargado (la lupa
// de la barra lateral y Ctrl/⌘+K abren el panel, que se baja aparte). Todo es de cada instancia de servicios
// (corrección 15), como `projectSizes.ts`: el índice, si el panel está abierto y el pedido de ir a un resultado.
// Se guarda por `docs` (uno por instancia de servicios) y se arma la primera vez que se pide.

/** Ir a un resultado: la página y, si fue en el contenido, la palabra que coincidió y cuál de las del bloque. */
export interface ResultRequest {
  pageId: string;
  /** La palabra que coincidió en el bloque (corrección 5); `null`: un resultado del título, la página arriba. */
  term: string | null;
  blockId?: string;
  occurrence?: number;
  /** *Aa* y palabra entera (desde reemplazar en el proyecto, que busca la frase con esas opciones). */
  options?: { matchCase?: boolean; wholeWord?: boolean };
  /** Destino de sólo lectura: la key de una foto en línea se resuelve al abrir, nunca se guarda. */
  annotation?: { projectId: string; fileId: string; shapeId: string };
}

/** Un pedido de ir a un resultado vale este rato: si la página nunca llega a abrirse, no queda colgado. */
export const REQUEST_TTL_MS = 60_000;

export class SearchSession {
  private indexInstance: ProjectIndex | null = null;
  private open = false;
  private pending: (ResultRequest & { at: number }) | null = null;
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private requestGeneration = 0;
  private requestAt = 0;

  /** Sigue vigente después de consumir pending; cerrar el panel no es otra intención. */
  requestValidity(): () => boolean {
    const generation = this.requestGeneration;
    return () => generation === this.requestGeneration && Date.now() - this.requestAt <= REQUEST_TTL_MS;
  }

  constructor(
    private readonly tree: IndexTree,
    private readonly docs: IndexDocs,
  ) {}

  /** El índice: se arma la primera vez que se pide (al abrir el panel, no al abrir la app). */
  get index(): ProjectIndex {
    this.indexInstance ??= new ProjectIndex(this.tree, this.docs);
    return this.indexInstance;
  }

  /** Suelta el índice y los avisos (al cerrar los servicios). */
  dispose(): void {
    this.requestGeneration++;
    this.indexInstance?.dispose();
    this.indexInstance = null;
    this.pending = null;
    this.open = false;
    this.listeners.clear();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  isOpen = (): boolean => this.open;

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.changed();
  }

  /** Guarda el pedido de ir a un resultado; lo toma el editor de esa página cuando está listo (o ya). */
  requestResult(request: ResultRequest): void {
    this.requestGeneration++;
    this.requestAt = Date.now();
    this.pending = { ...request, at: this.requestAt };
    this.changed();
  }

  /** El pedido para esa página, si hay (y lo borra). */
  takeRequest(pageId: string): ResultRequest | null {
    const request = this.pending;
    if (!request || request.pageId !== pageId) return null;
    this.pending = null;
    if (Date.now() - request.at > REQUEST_TTL_MS) return null;
    const { at: _at, ...rest } = request;
    return rest;
  }

  /** El pedido guardado, sin tomarlo (para las pruebas). */
  peekRequest(): ResultRequest | null {
    if (!this.pending) return null;
    const { at: _at, ...rest } = this.pending;
    return rest;
  }
}

const sessions = new WeakMap<object, SearchSession>();

/** La búsqueda de una instancia de servicios. */
export function searchSession(services: { tree: IndexTree; docs: IndexDocs }): SearchSession {
  let session = sessions.get(services.docs);
  if (!session) sessions.set(services.docs, (session = new SearchSession(services.tree, services.docs)));
  return session;
}

/** Suelta la búsqueda de una instancia de servicios (cerrar sesión, cambiar de workspace). */
export function disposeSearchSession(services: { docs: IndexDocs }): void {
  sessions.get(services.docs)?.dispose();
  sessions.delete(services.docs);
}

export function useSearchSession(): SearchSession {
  const session = searchSession(useServices());
  useSyncExternalStore(session.subscribe, session.getVersion);
  return session;
}

/** Ctrl/⌘+K, sin Alt ni Shift. */
export function isSearchShortcut(
  e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; key: string; code?: string },
  mac = IS_MAC,
): boolean {
  return modPressed(e, mac) && !e.altKey && !e.shiftKey && isLetter(e, 'k');
}

/** Un diálogo o el carrete abiertos, sin contar el propio panel. */
const OTHER_MODAL = '[aria-modal="true"]:not(.search-panel), .modal, .modal-backdrop, .carrete, dialog[open]';

/**
 * Si Ctrl/⌘+K abre la búsqueda. En el editor, con texto elegido, es "crear un link" de BlockNote (se deja
 * pasar aunque la barra de formato todavía no haya aparecido y no lo haya tomado). Con otro diálogo o el
 * carrete abiertos, tampoco.
 */
export function takesSearchShortcut(target: EventTarget | null, doc: Document = document): boolean {
  const el = target instanceof Element ? target : null;
  const selection = doc.getSelection?.();
  if (el?.closest('.bn-editor') && selection && !selection.isCollapsed) return false;
  return !otherModalOpen(doc);
}

/** Un diálogo o el carrete abiertos (sin contar el panel de buscar). */
export function otherModalOpen(doc: Document = document): boolean {
  return !!doc.querySelector(OTHER_MODAL);
}
