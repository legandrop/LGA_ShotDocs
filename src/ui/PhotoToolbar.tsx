import { useBlockNoteEditor, useComponentsContext, useEditorState, usePortalElement } from '@blocknote/react';
import type { EditorState } from '@tiptap/pm/state';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n';
import '../i18n/lazy/editor';
import { mediaIdOf } from '../media/queue';
import { carreteSourceOf } from './carreteModel';
import { CommentToolbarButton } from './EditorComments';
import { ROW_PRESETS } from './imageRows';
import { PHOTO, photoWidth } from './inlinePhoto';
import { photoKeyAtPos } from './inlinePhotoEditor';
import { arrangeSelected, arrangeTarget, aspectAt, onlyPhotosSelected, selectedPhotos, setPhotoWidths } from './inlinePhotoSize';
import { ArrangeIcon, OriginalDownloadButton, SIZE_LABELS, ViewIcon } from './MediaToolbarButtons';

// La barra de la foto en línea (Docs/Doc_Fotos_En_Linea.md, entrega 2): ver (el carrete), bajar el original, los
// tamaños rápidos (para todas las fotos elegidas) y "Arrange in rows" (las elegidas, o las seguidas a la elegida).
//
// Con una foto elegida o una selección de solo fotos, BlockNote no tiene qué mostrar (su barra es de texto: con una
// foto elegida aparecía encima de la foto vecina y tapaba el clic, auditoría de v0.076), así que esta barra es
// propia y va arriba de las fotos (o abajo, si arriba no entra). Con una selección de texto que también abarca fotos,
// la barra de texto de BlockNote suma los tamaños y "Arrange in rows" (`PhotoSizeButtons`, PageToolbar.tsx).

type AnyEditor = ReturnType<typeof useBlockNoteEditor>;

interface PhotoChoice {
  positions: number[];
  /** Los anchos de cada una (para marcar el tamaño que tienen todas). */
  widths: number[];
  /** La única elegida: su dirección (ver, bajar) y su clave del carrete. */
  url: string | null;
  key: string | null;
  arrange: { positions: number[]; adjacent: boolean } | null;
}

function choiceOf(state: EditorState): PhotoChoice | null {
  const positions = selectedPhotos(state);
  if (positions.length === 0) return null;
  const widths = positions.map((p) => photoWidth(state.doc.nodeAt(p)?.attrs.w));
  const single = positions.length === 1 ? state.doc.nodeAt(positions[0]) : null;
  return {
    positions,
    widths,
    url: single?.type.name === PHOTO ? String(single.attrs.url ?? '') : null,
    key: single ? photoKeyAtPos(state.doc, positions[0]) : null,
    arrange: arrangeTarget(state),
  };
}

const sameChoice = (a: PhotoChoice | null, b: PhotoChoice | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.positions.join() === b.positions.join() &&
    a.widths.join() === b.widths.join() &&
    a.url === b.url &&
    a.key === b.key &&
    a.arrange?.positions.join() === b.arrange?.positions.join() &&
    a.arrange?.adjacent === b.arrange?.adjacent);

/** Las fotos en línea elegidas (y lo que se puede hacer con ellas), o `null`. */
export function usePhotoChoice(): PhotoChoice | null {
  const editor = useBlockNoteEditor();
  return useEditorState({
    editor,
    selector: ({ editor: e }) => (e.isEditable ? choiceOf((e as AnyEditor).prosemirrorState) : null),
    equalityFn: sameChoice,
  });
}

/** Vuelve a dibujar cuando termina de cargar una imagen del editor ("Arrange in rows" espera a que carguen). */
function useImageLoads(dom: Element | null | undefined): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!dom) return;
    const onLoad = (e: Event) => {
      if ((e.target as Element | null)?.matches?.('img.bn-visual-media')) setTick((n) => n + 1);
    };
    dom.addEventListener('load', onLoad, true);
    dom.addEventListener('error', onLoad, true);
    return () => {
      dom.removeEventListener('load', onLoad, true);
      dom.removeEventListener('error', onLoad, true);
    };
  }, [dom]);
}

/** Los tamaños rápidos y "Arrange in rows" para las fotos en línea de la selección. */
export function PhotoSizeButtons() {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext()!;
  const tr = useT();
  const choice = usePhotoChoice();
  useImageLoads(choice?.arrange ? editor.domElement : null);
  const view = editor.prosemirrorView;
  if (!choice || !view) return null;
  const many = choice.positions.length > 1;
  const arrange = choice.arrange;
  const ready = !!arrange && arrange.positions.every((p) => aspectAt(view, p) !== null);
  const arrangeTip = !arrange?.adjacent
    ? tr('photoSize.notAdjacent')
    : !ready
      ? tr('imageSize.waiting')
      : many
        ? tr('photoSize.arrangeSelected')
        : tr('imageSize.arrangeHint');
  return (
    <>
      {arrange && (
        <Components.FormattingToolbar.Button
          className="bn-button"
          data-test="photoArrange"
          label={tr('imageSize.arrange')}
          mainTooltip={tr('imageSize.arrange')}
          secondaryTooltip={arrangeTip}
          icon={<ArrangeIcon />}
          isDisabled={!arrange.adjacent || !ready}
          onClick={() => {
            arrangeSelected(view);
            view.focus();
          }}
        />
      )}
      {ROW_PRESETS.map((f) => (
        <Components.FormattingToolbar.Button
          key={f}
          className="bn-button image-size-button"
          data-test={`photoSize-${SIZE_LABELS[f].text}`}
          label={tr(SIZE_LABELS[f].tip)}
          mainTooltip={tr(SIZE_LABELS[f].tip)}
          secondaryTooltip={many ? tr('photoSize.allSelected') : f < 1 ? tr('imageSize.rows') : undefined}
          isSelected={choice.widths.every((w) => Math.abs(w - f) < 1e-4)}
          onClick={() => {
            setPhotoWidths(view, choice.positions, f);
            view.focus();
          }}
        >
          {SIZE_LABELS[f].text}
        </Components.FormattingToolbar.Button>
      ))}
    </>
  );
}

/** La barra propia: con una foto en línea elegida, o con una selección de solo fotos. */
export function PhotoToolbar({ canComment, onView }: { canComment: boolean; onView: (key: string) => void }) {
  const Components = useComponentsContext()!;
  const tr = useT();
  const choice = usePhotoChoice();
  if (!choice) return null;
  const viewable = choice.key && carreteSourceOf(choice.url);
  const fileId = mediaIdOf(choice.url);
  return (
    <Components.FormattingToolbar.Root className="bn-toolbar bn-formatting-toolbar sd-photo-toolbar">
      {viewable && (
        <Components.FormattingToolbar.Button
          className="bn-button"
          label={tr('mediaButton.view')}
          mainTooltip={tr('mediaButton.view')}
          secondaryTooltip={tr('mediaButton.space')}
          icon={<ViewIcon />}
          onClick={() => onView(choice.key!)}
        />
      )}
      {fileId && <OriginalDownloadButton key={fileId} fileId={fileId} />}
      <PhotoSizeButtons />
      {canComment && <CommentToolbarButton />}
    </Components.FormattingToolbar.Root>
  );
}

/** El rectángulo que abarca las fotos (en la pantalla), o `null`. */
function photosRect(editor: AnyEditor, positions: readonly number[]): DOMRect | null {
  const view = editor.prosemirrorView;
  if (!view) return null;
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const p of positions) {
    const dom = view.nodeDOM(p);
    if (!(dom instanceof HTMLElement)) continue;
    const r = dom.getBoundingClientRect();
    top = Math.min(top, r.top);
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  return Number.isFinite(top) ? new DOMRect(left, top, right - left, bottom - top) : null;
}

/** Dónde va la barra: arriba de las fotos (10 px), o abajo si arriba no entra; adentro de la pantalla. */
export function toolbarSpot(rect: { top: number; bottom: number; left: number }, size: { width: number; height: number }, viewport: { width: number; height: number }): { top: number; left: number } {
  const above = rect.top - 10 - size.height;
  const top = above >= 8 ? above : Math.min(rect.bottom + 10, viewport.height - size.height - 8);
  const left = Math.max(8, Math.min(rect.left, viewport.width - size.width - 8));
  return { top, left };
}

/**
 * Muestra `PhotoToolbar` cuando corresponde: la página se puede editar, el editor (o la barra) tiene el foco, no se
 * está apretando el mouse (eligiendo con un arrastre) y hay una foto en línea elegida o una selección de solo fotos.
 */
export function PhotoToolbarController({ canComment, onView }: { canComment: boolean; onView: (key: string) => void }) {
  const editor = useBlockNoteEditor() as AnyEditor;
  const portal = usePortalElement();
  const box = useRef<HTMLDivElement>(null);
  const [pressing, setPressing] = useState(false);
  const [focused, setFocused] = useState(false);
  const [, setTick] = useState(0);
  const positions = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const state = (e as AnyEditor).prosemirrorState;
      return e.isEditable && onlyPhotosSelected(state) ? selectedPhotos(state).join(',') : '';
    },
  });

  useEffect(() => {
    const dom = editor.domElement;
    if (!dom) return;
    const down = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setPressing(true);
    };
    const up = () => setPressing(false);
    const focus = () => {
      const active = document.activeElement;
      setFocused(!!active && (dom.contains(active) || !!box.current?.contains(active)));
    };
    const blur = () => setTimeout(focus);
    const redraw = () => setTick((n) => n + 1);
    dom.addEventListener('pointerdown', down);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', blur);
    window.addEventListener('scroll', redraw, true);
    window.addEventListener('resize', redraw);
    focus();
    return () => {
      dom.removeEventListener('pointerdown', down);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', blur);
      window.removeEventListener('scroll', redraw, true);
      window.removeEventListener('resize', redraw);
    };
  }, [editor]);

  const show = positions !== '' && !pressing && focused;
  const list = positions ? positions.split(',').map(Number) : [];

  // La posición, después de dibujar (hace falta el tamaño de la barra).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !show) return;
    const rect = photosRect(editor, list);
    if (!rect) return;
    const { top, left } = toolbarSpot(rect, { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  });

  if (!show || !portal) return null;
  return createPortal(
    <div ref={box} className="sd-photo-toolbar-box" style={{ position: 'fixed', zIndex: 40, top: -9999, left: -9999 }}>
      <PhotoToolbar canComment={canComment} onView={onView} />
    </div>,
    portal,
  );
}
