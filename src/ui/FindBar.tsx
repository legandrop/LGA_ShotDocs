import { useEffect, useLayoutEffect, useReducer, useRef, type KeyboardEvent } from 'react';
import type { EditorView } from '@tiptap/pm/view';
import { useT } from '../i18n';
import '../i18n/lazy/editor';
import {
  canUndoReplace,
  clearFind,
  closeFind,
  getFindState,
  hiddenCount,
  landOnOccurrence,
  replaceAll,
  replaceCurrent,
  revealCurrent,
  setFind,
  stepFind,
  subscribeFind,
  undoReplace,
  type ReplaceResult,
} from './findEditor';
import { closeFindBar, dropFindTarget, getFindUi, hasFindTarget, takeFindTarget, isStepShortcut, takeFocusRequest, takesStepShortcut, updateFindUi, useFindUi, type FindStatus } from './findUi';
import { scrollParent, stopKeepingInView } from './findScroll';
import { ChevronUpIcon, CloseIcon, CollapseIcon, ExpandIcon } from './icons';

// La barra de buscar y reemplazar en la página (Docs/Doc_Buscar.md, secciones 5 y 6). Como la del navegador,
// pero busca en el documento: también en lo que está en secciones colapsadas, en los pies de las fotos y en
// los nombres de los archivos. Se despliega para reemplazar (como VS Code) solo si se puede editar la página.

export interface FindEditor {
  prosemirrorView?: EditorView;
  isEditable: boolean;
  focus(): void;
}

/** Espera al escribir antes de buscar. */
const TYPE_MS = 100;
/** Lo elegido en el editor se usa para buscar si es de una línea y no muy largo. */
const PREFILL_MAX = 200;

export function FindBar({
  editor,
  editable,
  complete = true,
  pageId,
}: {
  editor: FindEditor | null;
  editable: boolean;
  complete?: boolean;
  /** La página: solo se va a una coincidencia pedida para ella (un resultado de la búsqueda del proyecto). */
  pageId?: string;
}) {
  const ui = useFindUi();
  const tr = useT();
  const view = editor?.prosemirrorView;
  const input = useRef<HTMLInputElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const status = ui.status;
  const setStatus = (next: FindStatus | null) => updateFindUi({ status: next });

  // Cada cambio de la búsqueda (coincidencias, la actual) redibuja la cuenta.
  useEffect(() => (view ? subscribeFind(view, redraw) : undefined), [view]);

  // Abrir (o Ctrl/⌘+F con la barra abierta): lo elegido en el editor como búsqueda, y el foco al campo. Solo
  // con un pedido nuevo: si la barra se vuelve a montar (el editor se reabrió), no le roba el foco a nadie.
  useEffect(() => {
    if (!ui.open || !takeFocusRequest()) return;
    if (view && getFindUi().prefill) {
      const { from, to } = view.state.selection;
      const selected = from < to ? view.state.doc.textBetween(from, to, '\n', ' ') : '';
      if (selected.trim() && !selected.includes('\n') && selected.length <= PREFILL_MAX) updateFindUi({ query: selected });
    }
    input.current?.focus();
    input.current?.select();
    // Solo al abrir o al pedir el foco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.open, ui.focus]);

  // El ancho que se ve del contenedor que se desplaza (`.main`, sin la parte que tapa el panel de comentarios):
  // con una hoja más ancha que la ventana (A3), la barra se alinea a lo que se ve y no al borde de la hoja
  // (styles.css, `.find-anchor`). Se vuelve a medir al cambiar la ventana, la barra lateral o el panel.
  useLayoutEffect(() => {
    const el = anchor.current;
    if (!ui.open || !el) return;
    const scroller = scrollParent(el);
    if (!scroller || scroller === el.ownerDocument.scrollingElement) return;
    const measure = () => {
      const style = getComputedStyle(scroller);
      const width = scroller.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      el.style.setProperty('--find-visible-width', `${Math.max(0, width)}px`);
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [ui.open]);

  // Lo último que se llevó a la vista: si el efecto vuelve a correr solo porque el editor se volvió a montar
  // (la página terminó de bajar), se busca otra vez pero no se mueve la página (la persona puede estar leyendo
  // otra parte).
  const revealed = useRef<string | null>(null);

  // Buscar mientras se escribe; también al volver a montarse el editor (el estado vive en `findUi`).
  useEffect(() => {
    if (!view) return;
    if (!ui.open) {
      revealed.current = null;
      clearFind(view);
      return;
    }
    // Un resultado de la búsqueda del proyecto: sin esperar, y a la coincidencia pedida (una sola vez: si el
    // editor se vuelve a montar, se busca como siempre).
    const timer = setTimeout(
      () => {
        if (view.isDestroyed) return;
        if (ui.query.trim()) {
          setFind(view, ui.query, { matchCase: ui.matchCase, wholeWord: ui.wholeWord });
          // Con la página a medio bajar el pedido se guarda: al completarse el editor se vuelve a montar.
          const target = takeFindTarget(pageId, { keep: !complete });
          // Al llegar desde la búsqueda del proyecto, la coincidencia se sigue llevando a la vista mientras la
          // página se acomoda (fotos que bajan, marcas de hoja), hasta que la persona desplaza o toca algo.
          // Si la persona desplaza o toca algo, la coincidencia pedida se descarta: al completarse la página no
          // se vuelve a ir ahí.
          const key = `${ui.query}\u0000${ui.matchCase}\u0000${ui.wholeWord}`;
          if (target) landOnOccurrence(view, target, { onUser: () => dropFindTarget(pageId) });
          else if (revealed.current !== key) revealCurrent(view);
          revealed.current = key;
        } else {
          clearFind(view);
        }
      },
      hasFindTarget(pageId) ? 0 : TYPE_MS,
    );
    return () => clearTimeout(timer);
  }, [view, ui.open, ui.query, ui.matchCase, ui.wholeWord, ui.target, complete, pageId]);

  // Al irse este editor (o la barra), deja de acomodar su coincidencia: sin escuchas ni observadores sueltos.
  useEffect(
    () => () => {
      if (view) stopKeepingInView(view.dom);
    },
    [view],
  );

  // Con la barra abierta: F3 y Ctrl/⌘+G van a la siguiente (con Shift, a la anterior), desde la barra o el
  // editor y sin un diálogo abierto.
  useEffect(() => {
    if (!ui.open || !view) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || !isStepShortcut(e) || !takesStepShortcut(e.target)) return;
      e.preventDefault();
      stepFind(view, e.shiftKey ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui.open, view]);

  // Un cambio de lo buscado borra el aviso del último reemplazo (solo un cambio, no volver a montarse).
  const searched = useRef(`${ui.query}\u0000${ui.matchCase}\u0000${ui.wholeWord}`);
  useEffect(() => {
    const key = `${ui.query}\u0000${ui.matchCase}\u0000${ui.wholeWord}`;
    if (key === searched.current) return;
    searched.current = key;
    if (getFindUi().status) updateFindUi({ status: null });
  }, [ui.query, ui.matchCase, ui.wholeWord]);

  if (!ui.open) return null;

  const state = view ? getFindState(view.state) : null;
  const total = state?.matches.length ?? 0;
  const current = state && state.current >= 0 ? state.matches[state.current] : null;
  let count = '';
  if (state?.query.trim()) {
    if (total === 0) count = tr('find.none');
    else count = tr(state.truncated ? 'find.countMore' : 'find.count', { current: state.current + 1, total });
  }
  const where = current?.field === 'caption' ? tr('find.inCaption') : current?.field === 'name' ? tr('find.inName') : '';
  const hidden = state ? hiddenCount(state.matches, view) : 0;

  const close = () => {
    closeFindBar();
    if (view && !view.isDestroyed) closeFind(view, { select: true });
    editor?.focus();
  };

  const step = (dir: 1 | -1) => {
    if (view) stepFind(view, dir);
  };

  const report = (result: ReplaceResult, all: boolean) => {
    const parts: string[] = [];
    if (result.blocked === 'changed') parts.push(tr('find.changed'));
    if (all && result.replaced > 0) parts.push(tr('find.replaced', { count: result.replaced }));
    if (result.skippedFields > 0) parts.push(all ? tr('find.skippedFields', { count: result.skippedFields }) : tr('find.fieldNotReplaced'));
    if (result.skippedLinks > 0) parts.push(tr('find.skippedLinks', { count: result.skippedLinks }));
    setStatus(parts.length ? { text: parts.join(' · '), undoItem: all ? result.undoItem : undefined } : null);
  };

  const onFindKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Escribiendo con un IME (japonés, chino, acentos): Enter y Esc son de la composición.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const onReplaceKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (editor) report(replaceCurrent(editor, ui.replacement), false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  // Los botones no le sacan el foco al campo (así Enter sigue andando).
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div ref={anchor} className="find-anchor">
      <div className={`find-bar${editable && ui.expanded ? ' expanded' : ''}`} role="search" aria-label={tr('find.label')}>
        <div className="find-row">
          {editable && (
            <button
              className="find-button find-toggle"
              aria-expanded={ui.expanded}
              aria-label={ui.expanded ? tr('find.hideReplace') : tr('find.showReplace')}
              data-tip={ui.expanded ? tr('find.hideReplace') : tr('find.showReplace')}
              onMouseDown={keepFocus}
              onClick={() => updateFindUi({ expanded: !ui.expanded })}
            >
              <ExpandIcon size={14} />
            </button>
          )}
          <input
            ref={input}
            className="find-input"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            placeholder={tr('find.placeholder')}
            aria-label={tr('find.placeholder')}
            value={ui.query}
            onChange={(e) => updateFindUi({ query: e.target.value })}
            onKeyDown={onFindKey}
            aria-invalid={!!state?.query.trim() && total === 0}
          />
          <span className="find-count" aria-live="polite">
            {count}
          </span>
          <button
            className={`find-button find-option${ui.matchCase ? ' on' : ''}`}
            aria-pressed={ui.matchCase}
            aria-label={tr('find.matchCase')}
            data-tip={tr('find.matchCase')}
            onMouseDown={keepFocus}
            onClick={() => updateFindUi({ matchCase: !ui.matchCase })}
          >
            Aa
          </button>
          <button
            className={`find-button find-option find-word${ui.wholeWord ? ' on' : ''}`}
            aria-pressed={ui.wholeWord}
            aria-label={tr('find.wholeWord')}
            data-tip={tr('find.wholeWord')}
            onMouseDown={keepFocus}
            onClick={() => updateFindUi({ wholeWord: !ui.wholeWord })}
          >
            ab
          </button>
          <button className="find-button" aria-label={tr('find.previous')} data-tip={tr('find.previous')} disabled={total === 0} onMouseDown={keepFocus} onClick={() => step(-1)}>
            <ChevronUpIcon size={16} />
          </button>
          <button className="find-button" aria-label={tr('find.next')} data-tip={tr('find.next')} disabled={total === 0} onMouseDown={keepFocus} onClick={() => step(1)}>
            <CollapseIcon size={16} />
          </button>
          <button className="find-button" aria-label={tr('find.close')} data-tip={tr('find.close')} onClick={close}>
            <CloseIcon size={15} />
          </button>
        </div>
        {editable && ui.expanded && (
          <div className="find-row find-replace-row">
            <input
              className="find-input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder={tr('find.replacePlaceholder')}
              aria-label={tr('find.replacePlaceholder')}
              value={ui.replacement}
              onChange={(e) => updateFindUi({ replacement: e.target.value })}
              onKeyDown={onReplaceKey}
            />
            <button
              className="find-text-button"
              disabled={total === 0}
              data-tip={tr('find.replaceTip')}
              onMouseDown={keepFocus}
              onClick={() => editor && report(replaceCurrent(editor, ui.replacement), false)}
            >
              {tr('find.replace')}
            </button>
            <button
              className="find-text-button"
              disabled={total === 0}
              onMouseDown={keepFocus}
              onClick={() => editor && report(replaceAll(editor, ui.replacement), true)}
            >
              {tr('find.replaceAll')}
            </button>
          </div>
        )}
        {(where || hidden > 0 || status) && (
          <div className="find-status" role="status">
            {[where, hidden > 0 ? tr('find.hidden', { count: hidden }) : '', status?.text ?? ''].filter(Boolean).join(' · ')}
            {status?.undoItem !== undefined && canUndoReplace(view, status.undoItem) && (
              <>
                {' '}
                <button
                  className="link"
                  onClick={() => {
                    undoReplace(view, status.undoItem);
                    setStatus(null);
                  }}
                >
                  {tr('find.undo')}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
