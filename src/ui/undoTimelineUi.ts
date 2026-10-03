import { useEffect, useRef } from 'react';
import { t } from '../i18n';
import { navigate, pagePath, useRoute } from '../router';
import { usePermissions, useServices } from '../services';
import { isLetter, modPressed } from './findUi';
import { notify } from './notice';
import { useCurrentProject } from './project';
import { redoReplace, replaceRunning, replaceSession, undoReplace } from './replaceUi';
import { IS_MAC, shortcutLabel } from './shortcuts';
import { setUndoRunner, undoTimelineFor, type StepKind, type UndoTimeline } from './undoTimeline';

// ⌘Z y ⌘⇧Z en el orden en que editaste (P.26, entrega 1; Docs/Doc_Deshacer.md, 3.4). El atajo se toma en `window`
// (fase de captura, antes que el editor) cuando el foco está en el editor de la página o fuera de un campo de texto (el
// árbol, un botón, la página). En el título, un comentario, la búsqueda, un diálogo o el anotador sigue el deshacer de
// ese lugar. Un ⌘Z deshace UN paso, el último del proyecto abierto:
//
// - de esta página: acá, como siempre;
// - de otra página: la app va a esa página, espera a que su editor esté listo y lo deshace ahí, a la vista ("Undone in
//   “Shot 12” · Back"). Manteniendo apretado (`repeat`) no cruza de página;
// - un paso que ya no cambia nada (otra persona borró justo eso) se descarta y, en el mismo ⌘Z, se sigue con el anterior
//   solo si es de la misma página; si no, se avisa y se frena.
//
// - un reemplazo del proyecto (entrega 2): se deshace en todas sus páginas sin moverte ("Undid “Cámara” → “Camera” in 12
//   pages · Redo"; replaceUi.ts). Manteniendo apretado se frena antes de un reemplazo.
//
// Mientras se va a otra página, o se deshace un reemplazo, los ⌘Z que llegan no hacen nada (no se encolan).

type KeyLike = { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; key: string; code?: string };

/** Ctrl/⌘+Z, sin Alt ni Shift. */
export function isUndoShortcut(e: KeyLike, mac = IS_MAC): boolean {
  return modPressed(e, mac) && !e.altKey && !e.shiftKey && isLetter(e, 'z');
}

/** Ctrl/⌘+Shift+Z o Ctrl/⌘+Y (sin Alt). */
export function isRedoShortcut(e: KeyLike, mac = IS_MAC): boolean {
  if (!modPressed(e, mac) || e.altKey) return false;
  return (e.shiftKey && isLetter(e, 'z')) || (!e.shiftKey && isLetter(e, 'y'));
}

const MODAL = '[aria-modal="true"], .modal, .modal-backdrop, .carrete, dialog[open]';

/**
 * Si ⌘Z con el foco en `target` es de la línea de tiempo: en el editor de la página (el que está en ella) o fuera de
 * cualquier campo de texto, sin un diálogo, el carrete ni el anotador abiertos.
 */
export function takesUndoShortcut(timeline: Pick<UndoTimeline, 'ownsElement'>, target: EventTarget | null, doc: Document = document): boolean {
  if (doc.querySelector(MODAL)) return false;
  const el = target instanceof Element ? target : null;
  if (!el) return true;
  if (el.closest('.bn-editor')) return timeline.ownsElement(el);
  if (el.closest('input, textarea, select')) return false;
  return !(el as HTMLElement).isContentEditable;
}

export interface UndoUiDeps {
  timeline: UndoTimeline;
  /** La página en pantalla (la ruta), o `null`. */
  currentPage: () => string | null;
  /** El proyecto abierto. */
  currentProject: () => string;
  title: (pageId: string) => string;
  /** Por qué no se puede deshacer en esa página (`null`: se puede). */
  blocked: (pageId: string) => 'trash' | 'deleted' | 'noEdit' | null;
  go: (pageId: string) => void;
  notify: typeof notify;
  /**
   * Deshace (o rehace) un reemplazo del proyecto en todas sus páginas, sin moverte (DH3; replaceUi.ts, con su aviso).
   * Sin él (pruebas de solo páginas), un reemplazo no se toca.
   */
  replace?: (kind: StepKind, opId: string) => Promise<unknown>;
  /** Cuánto se espera a que la otra página esté lista. */
  waitMs?: number;
}

const REASONS = {
  trash: 'undo.reason.trash',
  deleted: 'undo.reason.deleted',
  noEdit: 'undo.reason.noEdit',
  loading: 'undo.reason.loading',
} as const;

/** Si dos documentos de ProseMirror son iguales (`eq`); con otra cosa, nunca. */
function sameDoc(a: unknown, b: unknown): boolean {
  return !!a && !!b && typeof (a as { eq?: unknown }).eq === 'function' && (a as { eq: (o: unknown) => boolean }).eq(b);
}

/** El que corre ⌘Z / ⌘⇧Z: un paso, con las reglas de arriba. Mientras va a otra página, ignora los que lleguen. */
export function createUndoRunner(deps: UndoUiDeps) {
  let busy = false;
  const label = (kind: StepKind) => shortcutLabel(kind === 'undo' ? 'undo' : 'redo');

  const cant = (kind: StepKind, pageId: string, reason: keyof typeof REASONS) =>
    deps.notify(
      kind === 'undo'
        ? t('undo.cant', { page: deps.title(pageId), reason: t(REASONS[reason]), undo: label('undo') })
        : t('undo.cantRedo', { page: deps.title(pageId), reason: t(REASONS[reason]), redo: label('redo') }),
    );

  async function run(kind: StepKind, { repeat = false, focusInEditor = false }: { repeat?: boolean; focusInEditor?: boolean } = {}): Promise<void> {
    if (busy) return;
    const { timeline } = deps;
    const here = deps.currentPage();
    const project = deps.currentProject();
    let crossed = false;
    for (let guard = 0; guard < 1000; guard++) {
      const next = timeline.peek(project, kind);
      if (!next) return;
      if (next.kind === 'lost') {
        timeline.consumeLost(next.pageId, next.reason, project);
        if (next.reason === 'limit') deps.notify(t('undo.limit', timeline.limits()));
        else deps.notify(t('undo.lost', { page: deps.title(next.pageId) }));
        return;
      }
      if (next.kind === 'replace') {
        // Un reemplazo: en todas sus páginas a la vez; manteniendo apretado se frena acá (3.4).
        if (repeat || !deps.replace) return;
        busy = true;
        try {
          await deps.replace(kind, next.opId);
        } finally {
          busy = false;
        }
        return;
      }
      const pageId = next.pageId;
      const why = deps.blocked(pageId);
      if (why) {
        // Ese paso (y los demás de esa página) ya no se pueden deshacer: se sacan, y el próximo ⌘Z sigue con lo anterior.
        timeline.forget(pageId);
        cant(kind, pageId, why);
        return;
      }
      if (timeline.activePage() !== pageId || deps.currentPage() !== pageId) {
        if (repeat) return;
        busy = true;
        try {
          deps.go(pageId);
          const ok = await timeline.whenAttached(pageId, deps.waitMs ?? 10000);
          if (!ok) {
            cant(kind, pageId, 'loading');
            return;
          }
        } finally {
          busy = false;
        }
        crossed = true;
      }
      const info = timeline.mounted(pageId);
      const keepsCursor = timeline.topRemembersCursor(pageId, kind);
      const before = info?.snapshot?.();
      const result = timeline.step(pageId, kind);
      // Yjs dice que cambió algo, pero en la página no cambió nada a la vista después de cruzar (otra persona ya había
      // borrado casi todo lo del paso; auditoría de la entrega 1, O2): se avisa como un paso que no cambia nada en vez
      // de "Undone in…". No se sigue con el anterior (el paso pudo cambiar algo que no está en el texto, como las
      // anotaciones de una foto pegada).
      if (result === 'done' && crossed && before !== undefined && sameDoc(before, info?.snapshot?.())) {
        deps.notify(kind === 'undo' ? t('undo.nothingThere', { undo: label('undo') }) : t('undo.nothingThereRedo', { redo: label('redo') }));
        return;
      }
      if (result === 'done') {
        if (before !== undefined && (crossed || !keepsCursor)) info?.reveal?.(before, { moveCursor: crossed || focusInEditor });
        if (crossed) {
          const back = here && here !== pageId ? here : null;
          deps.notify(
            t(kind === 'undo' ? 'undo.doneIn' : 'undo.redoneIn', { page: deps.title(pageId) }),
            back ? { label: t('undo.back'), run: () => deps.go(back) } : undefined,
          );
        }
        return;
      }
      if (result !== 'nothing' && result !== 'failed') return;
      // No cambió nada: en el mismo ⌘Z se sigue solo si lo anterior es de esta misma página. Si Yjs tiró un error
      // (B.22), se avisa y se frena siempre: el próximo ⌘Z sigue con lo anterior.
      const after = timeline.peek(project, kind);
      if (result === 'nothing' && after?.kind === 'page' && after.pageId === pageId) continue;
      deps.notify(kind === 'undo' ? t('undo.nothingThere', { undo: label('undo') }) : t('undo.nothingThereRedo', { redo: label('redo') }));
      return;
    }
  }

  return { run, busy: () => busy };
}

/**
 * Lo monta la app (Workspace.tsx): ⌘Z / ⌘⇧Z (y ⌘Y; Ctrl en Windows) en `window`, y el deshacer del navegador sobre el
 * editor (`historyUndo`, que llega a undoGuard.ts).
 */
export function useUndoTimelineKeys(): void {
  const services = useServices();
  const route = useRoute();
  const project = useCurrentProject();
  const perms = usePermissions();
  const state = useRef({ page: null as string | null, project, perms });
  state.current = { page: route.name === 'page' ? route.id : null, project, perms };

  useEffect(() => {
    const timeline = undoTimelineFor(services);
    const { tree } = services;
    const runner = createUndoRunner({
      timeline,
      currentPage: () => state.current.page,
      currentProject: () => state.current.project,
      title: (id) => tree.get(id)?.title || t('common.untitled'),
      blocked: (id) => {
        if (!tree.get(id)) return 'deleted';
        if (tree.isTrashed(id)) return 'trash';
        return state.current.perms.canEditPage(id) ? null : 'noEdit';
      },
      go: (id) => navigate(pagePath(id)),
      notify,
      replace: (kind, opId) => {
        const session = replaceSession(services);
        return kind === 'undo' ? undoReplace(session, opId) : redoReplace(session, opId);
      },
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      const kind: StepKind | null = isUndoShortcut(e) ? 'undo' : isRedoShortcut(e) ? 'redo' : null;
      // Solo con una página abierta (no en la papelera, el inicio ni la página de práctica).
      if (!kind || state.current.page === null || !takesUndoShortcut(timeline, e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      // Con un reemplazo del proyecto corriendo (o su deshacer), ⌘Z no hace nada hasta que termine (Doc_Deshacer.md, 5).
      if (replaceRunning(services)) return;
      const inEditor = e.target instanceof Element && timeline.ownsElement(e.target);
      void runner.run(kind, { repeat: e.repeat, focusInEditor: inEditor });
    };
    window.addEventListener('keydown', onKey, true);
    const offRunner = setUndoRunner((kind, el) => {
      if (!timeline.ownsElement(el)) return false;
      if (replaceRunning(services)) return true;
      void runner.run(kind, { focusInEditor: true });
      return true;
    });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      offRunner();
    };
  }, [services]);
}
