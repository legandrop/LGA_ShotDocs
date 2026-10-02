import { useBlockNoteEditor, useComponentsContext, useEditorState, usePortalElement } from '@blocknote/react';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n';
import '../i18n/lazy/editor';
import { mediaIdOf } from '../media/queue';
import { BarButton } from './BarButton';
import { ROW_PRESETS } from './imageRows';
import { PHOTO, photoWidth } from './inlinePhoto';
import { inTableCell, liveView, trackSpot, takeSpot } from './inlinePhotoCreate';
import { photoKeyAtPos } from './inlinePhotoEditor';
import { arrangeSelected, arrangeTarget, aspectAt, onlyPhotosSelected, selectedPhotos, setPhotoWidths } from './inlinePhotoSize';
import {
  AlignButtons,
  CommentButton,
  DeleteButton,
  DownloadButton,
  RenameButton,
  ReplaceButton,
  Sectors,
  useMediaActions,
  useMediaKind,
  ViewButton,
  type Alignment,
} from './MediaBar';
import { ArrangeIcon, SIZE_LABELS } from './MediaToolbarButtons';

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
  name: string;
  key: string | null;
  arrange: { positions: number[]; adjacent: boolean } | null;
  /** Los bloques de las fotos (sin repetir) y su alineación, si es la misma en todos. */
  blocks: string[];
  align: Alignment | null;
  /**
   * Dónde están: `all`, todas en celdas de tabla (la barra de la celda: miniatura y todo el ancho de la celda); `some`,
   * una mezcla con fotos de renglones (la barra de siempre, sin lo de la celda, auditoría de la entrega 5); `none`.
   * Con alguna en una celda no se alinea (la tabla no tiene alineación propia).
   */
  inTable: 'all' | 'some' | 'none';
}

/** El bloque de la foto en `pos` y la alineación de su texto. */
function blockOf(state: EditorState, pos: number): { id: string; align: Alignment } | null {
  const $pos = state.doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name !== 'blockContainer') continue;
    const a = $pos.node(d + 1)?.attrs.textAlignment;
    return { id: String(node.attrs.id ?? ''), align: a === 'center' || a === 'right' ? a : 'left' };
  }
  return null;
}

/** `all` si todas están en celdas, `some` si algunas, `none` si ninguna. */
export function tableShare(inCell: readonly boolean[]): 'all' | 'some' | 'none' {
  const n = inCell.filter(Boolean).length;
  return n === 0 ? 'none' : n === inCell.length ? 'all' : 'some';
}

function choiceOf(state: EditorState): PhotoChoice | null {
  const positions = selectedPhotos(state);
  if (positions.length === 0) return null;
  const widths = positions.map((p) => photoWidth(state.doc.nodeAt(p)?.attrs.w));
  const single = positions.length === 1 ? state.doc.nodeAt(positions[0]) : null;
  const owners = positions.map((p) => blockOf(state, p)).filter((b): b is { id: string; align: Alignment } => !!b);
  const blocks = [...new Set(owners.map((b) => b.id))];
  const aligns = new Set(owners.map((b) => b.align));
  return {
    positions,
    widths,
    url: single?.type.name === PHOTO ? String(single.attrs.url ?? '') : null,
    name: single?.type.name === PHOTO ? String(single.attrs.name ?? '') : '',
    key: single ? photoKeyAtPos(state.doc, positions[0]) : null,
    arrange: arrangeTarget(state),
    blocks,
    align: aligns.size === 1 ? [...aligns][0] : null,
    inTable: tableShare(positions.map((p) => inTableCell(state.doc.resolve(p)))),
  };
}

const sameChoice = (a: PhotoChoice | null, b: PhotoChoice | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.positions.join() === b.positions.join() &&
    a.widths.join() === b.widths.join() &&
    a.url === b.url &&
    a.name === b.name &&
    a.key === b.key &&
    a.blocks.join() === b.blocks.join() &&
    a.align === b.align &&
    a.inTable === b.inTable &&
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

/** Una miniatura en una fila de tabla: la foto chica entre las dos líneas de la fila. */
function ThumbIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" aria-hidden="true">
      <path d="M2 4.5h16M2 15.5h16" />
      <path d="M4 7h6v6H4z" />
      <path d="M12.5 10h4" strokeLinecap="round" />
    </svg>
  );
}

/** Los tamaños rápidos y "Arrange in rows" para las fotos en línea de la selección (D-24: los tamaños primero). */
export function PhotoSizeButtons() {
  const editor = useBlockNoteEditor();
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
  // En una celda (entrega 5, D32): solo la miniatura del alto de una fila (`w = 0`, con lo que entran) y todo el ancho
  // de la celda. 1/2, 1/3, 1/4 y "Arrange in rows" no van: en una columna de 120 px (la de fábrica) dejaban la foto más
  // chica que la miniatura. El tirador sigue agrandándola dentro de la celda. Con una mezcla de celdas y renglones, la
  // barra de siempre.
  const cell = choice.inTable === 'all';
  const presets = cell ? ROW_PRESETS.filter((f) => f === 1) : ROW_PRESETS;
  return (
    <>
      {cell && (
        <BarButton
          test="photoSize-thumb"
          label={tr('cellSize.thumb')}
          tip={`**${tr('cellSize.thumb')}**\n${tr(many ? 'photoTip.thumbAll' : 'photoTip.thumb')}`}
          icon={<ThumbIcon />}
          selected={choice.widths.every((w) => w === 0)}
          onClick={() => {
            setPhotoWidths(view, choice.positions, 0);
            view.focus();
          }}
        />
      )}
      {presets.map((f) => (
        <BarButton
          key={f}
          className="image-size-button"
          test={`photoSize-${SIZE_LABELS[f].text}`}
          label={tr(cell ? 'cellSize.full' : SIZE_LABELS[f].tip)}
          tip={`**${tr(cell ? 'cellSize.full' : SIZE_LABELS[f].tip)}**\n${tr(cell ? (many ? 'photoTip.sizeCellAll' : 'photoTip.sizeCell') : many ? 'photoTip.sizeAll' : 'photoTip.size')}`}
          selected={choice.widths.every((w) => Math.abs(w - f) < 1e-4)}
          onClick={() => {
            setPhotoWidths(view, choice.positions, f);
            view.focus();
          }}
        >
          {SIZE_LABELS[f].text}
        </BarButton>
      ))}
      {arrange && !cell && (
        <BarButton
          test="photoArrange"
          label={tr('imageSize.arrange')}
          tip={`**${tr('imageSize.arrange')}**\n${arrangeTip}`}
          icon={<ArrangeIcon />}
          disabled={!arrange.adjacent || !ready}
          onClick={() => {
            arrangeSelected(view);
            view.focus();
          }}
        />
      )}
    </>
  );
}

/**
 * La barra de la foto en línea (D-24: la misma de la foto-bloque, por sectores): con una foto en línea elegida, o
 * con una selección de solo fotos. Ver, bajar, reemplazar y renombrar valen para una sola; los tamaños, alinear
 * (el renglón: la alineación del bloque) y borrar, para todas las elegidas.
 */
export function PhotoToolbar() {
  const editor = useBlockNoteEditor() as AnyEditor;
  const Components = useComponentsContext()!;
  const actions = useMediaActions();
  const choice = usePhotoChoice();
  const kind = useMediaKind(choice?.url ?? null, choice?.name ?? '');
  const view = editor.prosemirrorView;
  if (!choice || !view) return null;
  const single = choice.positions.length === 1;
  const fileId = mediaIdOf(choice.url);
  return (
    <Components.FormattingToolbar.Root className="bn-toolbar bn-formatting-toolbar sd-photo-toolbar sd-media-bar">
      <Sectors>
        {[
          single && choice.url && (
            <>
              <ViewButton url={choice.url} onView={() => choice.key && actions?.onView(choice.key)} />
              <DownloadButton url={choice.url} name={choice.name} />
            </>
          ),
          <PhotoSizeButtons />,
          // En una celda, alinear no tiene qué alinear (la tabla no tiene alineación): no va.
          choice.inTable === 'none' && <AlignButtons current={choice.align} inline onAlign={(a) => alignBlocks(editor, choice.blocks, a)} />,
          actions?.canComment && <CommentButton blockId={choice.blocks[0] ?? null} />,
          <>
            {single && actions && <ReplaceButton accept={actions.accept.inline} kind={kind} onFile={(file) => replacePhoto(editor, choice.positions[0], choice.url ?? '', file, actions.store)} />}
            {/* Un archivo del Drive no se renombra (la descarga y la papelera usan el nombre del archivo), como la foto-bloque. */}
            {single && !fileId && <RenameButton name={choice.name} kind={kind} onRename={(name) => renamePhoto(view, name)} />}
            <DeleteButton many={!single} kind={kind} onDelete={() => deletePhotos(view, choice.positions)} />
          </>,
        ]}
      </Sectors>
    </Components.FormattingToolbar.Root>
  );
}

/** Alinea los bloques de esas fotos (en la foto en línea, alinear es alinear su renglón), en un solo cambio. */
function alignBlocks(editor: AnyEditor, ids: readonly string[], a: Alignment): void {
  editor.transact(() => {
    for (const id of ids) {
      try {
        editor.updateBlock(id, { props: { textAlignment: a } } as never);
      } catch {
        // El bloque ya no está, o no se alinea.
      }
    }
  });
}

/** Renombra la foto elegida (la que está elegida al escribir: el globo no cambia la selección del editor). */
function renamePhoto(view: EditorView, name: string): void {
  const sel = view.state.selection;
  const pos = selectedPhotos(view.state)[0];
  if (pos === undefined || sel.empty) return;
  view.dispatch(view.state.tr.setNodeAttribute(pos, 'name', name));
}

/** Borra las fotos elegidas (de atrás para adelante), en un solo cambio. */
function deletePhotos(view: EditorView, positions: readonly number[]): void {
  const tr = view.state.tr;
  for (const pos of [...positions].sort((x, y) => y - x)) {
    if (tr.doc.nodeAt(pos)?.type.name === PHOTO) tr.delete(pos, pos + 1);
  }
  if (tr.docChanged) view.dispatch(tr);
  view.focus();
}

/**
 * Reemplaza el archivo de la foto en `pos`: se guarda el nuevo y, cuando está (en el dispositivo), la foto pasa a
 * ese archivo, con su nombre. El lugar se sigue mientras tanto (inlinePhotoCreate.ts); si la foto ya no está ahí
 * (la borraron o la movieron), no se toca nada.
 */
function replacePhoto(editor: AnyEditor, pos: number, oldUrl: string, file: File, store: (f: File) => Promise<string>): void {
  const view = editor.prosemirrorView;
  if (!view) return;
  const spot = trackSpot(view, pos, false);
  store(file).then(
    (url) => {
      if (!liveView(editor as never)) return;
      const at = takeSpot(view, spot);
      const node = at === null ? null : view.state.doc.nodeAt(at);
      if (at === null || node?.type.name !== PHOTO || node.attrs.url !== oldUrl) return;
      view.dispatch(view.state.tr.setNodeMarkup(at, undefined, { ...node.attrs, url, name: file.name || 'image' }));
    },
    () => {
      if (liveView(editor as never)) takeSpot(view, spot);
    },
  );
}

/**
 * El rectángulo que abarca las fotos (en la pantalla), o `null`. Arriba, el de la foto más alta de su renglón: las
 * fotos se alinean abajo, y una barra puesta arriba de una foto baja taparía a la vecina más alta (y el clic en la
 * vecina caería en la barra, como pasaba en la auditoría de v0.076 con la barra de texto).
 */
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
    top = Math.min(top, r.top, lineTop(dom, r));
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  return Number.isFinite(top) ? new DOMRect(left, top, right - left, bottom - top) : null;
}

/** Lo más alto de las fotos del mismo renglón visual que `photo` (las que terminan a la misma altura). */
function lineTop(photo: HTMLElement, r: DOMRect): number {
  let top = r.top;
  const line = photo.parentElement;
  if (!line) return top;
  for (const other of line.querySelectorAll<HTMLElement>(':scope > .sd-photo')) {
    const o = other.getBoundingClientRect();
    if (Math.abs(o.bottom - r.bottom) < 3) top = Math.min(top, o.top);
  }
  return top;
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
export function PhotoToolbarController() {
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
      // También con el foco en un globo de la barra (renombrar): está en el contenedor del editor.
      const wrapper = dom.closest('.bn-container');
      setFocused(!!active && (dom.contains(active) || !!box.current?.contains(active) || !!wrapper?.contains(active)));
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
      <PhotoToolbar />
    </div>,
    portal,
  );
}
