import { groupRows, snapRowWidth } from './imageRows';
import { ROW_WIDTH_PROP } from './imageRowsEditor';
import { PHOTO, photoWidth } from './inlinePhoto';
import { asOneUndoStep } from './undoGuard';
import type { EditorState } from '@tiptap/pm/state';

// Convertir las fotos-bloque de una página en fotos en línea (Docs/Doc_Fotos_En_Linea.md, entrega 3). Por página y
// de una vez (nunca de a una al editar: la corrección 4 del diseño), con un solo deshacer.
//
// - Cada fila de fotos-bloque de hoy (fotos seguidas con `rowWidth`, como las arma `groupRows`) pasa a ser UN
//   renglón (un párrafo) con sus fotos en línea, con el mismo ancho (`w` significa lo mismo que `rowWidth`). Una
//   foto-bloque sola pasa a ser un renglón con esa foto: su ancho propio (`rowWidth`) o, si solo tiene uno en px
//   (`previewWidth`), esa parte de un ancho de referencia FIJO (`REFERENCE_WIDTH_PX`: dos dispositivos convierten
//   igual), imantada a 1, 1/2, 1/3 y 1/4; sin ninguno, su ancho natural. Una foto sola conserva su alineación.
// - No se convierte (queda como bloque, como hoy): una foto con leyenda (se perdería; D-24: las leyendas que existen
//   se siguen viendo), un adjunto (la tarjeta), una foto a medio subir (sin dirección). Se cuentan.
// - Nada se pierde: el nombre, la dirección (del Drive o no), los videos (son fotos-bloque con un video), los hijos
//   de un bloque (pasan al renglón), y los comentarios: están anclados al id del bloque, así que el renglón toma el
//   id de su foto con comentarios (o el de la primera). Solo si dos fotos de una misma fila tienen comentarios la
//   fila se parte en dos renglones (medido en Chromium: un renglón partido se ve hasta 5 px más grande, porque
//   reparte el espacio entre menos fotos). Una foto con hijos TERMINA su renglón.
// - Versiones viejas: el renglón nuevo lleva la marca del renglón (lgaStableGaps); ninguna versión anterior abre la
//   página (Doc_Colaboracion.md, "Versiones viejas").

/** El ancho del área de texto de una página de ancho normal (px): la referencia fija para `previewWidth`. */
export const REFERENCE_WIDTH_PX = 720;

export interface BlockLike {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: BlockLike[];
}

export interface ConvertCheck {
  /** El archivo es un adjunto (PDF, zip…): queda como tarjeta. */
  isAttachment: (url: string, name: string) => boolean;
  /** El bloque tiene comentarios (anclados a su id). */
  hasComments: (blockId: string) => boolean;
}

/** Un renglón nuevo: reemplaza a los bloques `ids` (en orden, seguidos) por `paragraph`. */
export interface Segment {
  ids: string[];
  paragraph: BlockLike;
}

export interface ConvertPlan {
  segments: Segment[];
  /** Cuántas fotos pasan a ser fotos en línea. */
  photos: number;
  /** Lo que queda como bloque, y por qué. */
  kept: { caption: number; attachment: number; uploading: number };
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** El `w` de una foto-bloque: su `rowWidth`, o su `previewWidth` sobre el ancho de referencia (imantado), o 0. */
export function widthOfBlock(b: BlockLike): number {
  const row = photoWidth(b.props?.[ROW_WIDTH_PROP]);
  if (row > 0) return row;
  const px = Number(b.props?.previewWidth);
  if (Number.isFinite(px) && px > 0) return snapRowWidth(Math.min(1, px / REFERENCE_WIDTH_PX));
  return 0;
}

type Why = 'ok' | 'caption' | 'attachment' | 'uploading' | 'other';

function whyNot(b: BlockLike, check: ConvertCheck): Why {
  if (b.type !== 'image') return 'other';
  const url = str(b.props?.url);
  if (!url) return 'uploading';
  if (str(b.props?.caption).trim()) return 'caption';
  if (check.isAttachment(url, str(b.props?.name))) return 'attachment';
  return 'ok';
}

/** Lo que haría "Convert photos to inline" en estos bloques (sin tocar nada). */
export function planConversion(blocks: readonly BlockLike[], check: ConvertCheck): ConvertPlan {
  const plan: ConvertPlan = { segments: [], photos: 0, kept: { caption: 0, attachment: 0, uploading: 0 } };
  const walk = (list: readonly BlockLike[]) => {
    let i = 0;
    while (i < list.length) {
      const why = whyNot(list[i], check);
      if (why !== 'ok') {
        if (why !== 'other') plan.kept[why]++;
        if (list[i].children?.length) walk(list[i].children!);
        i++;
        continue;
      }
      let j = i;
      while (j < list.length && whyNot(list[j], check) === 'ok') j++;
      planRun(list.slice(i, j), plan, check);
      i = j;
    }
  };
  walk(blocks);
  return plan;
}

/** Una tanda de fotos-bloque seguidas: sus filas, y cada fila en uno o más renglones. */
function planRun(run: readonly BlockLike[], plan: ConvertPlan, check: ConvertCheck): void {
  const fracs = run.map((b) => photoWidth(b.props?.[ROW_WIDTH_PROP]));
  const rows = groupRows(fracs);
  const rowOf = new Map<number, number[]>();
  for (const r of rows) rowOf.set(r[0], r);
  let k = 0;
  while (k < run.length) {
    const row = rowOf.get(k) ?? [k];
    // Los renglones de la fila: casi siempre uno. El renglón toma el id de su foto con comentarios (si tiene una); una
    // segunda foto con comentarios empieza otro renglón, y una foto con hijos termina el suyo.
    let seg: BlockLike[] = [];
    let commented: BlockLike | null = null;
    const flush = () => {
      if (seg.length) plan.segments.push(segmentOf(seg, row.length === 1, commented));
      seg = [];
      commented = null;
    };
    for (const idx of row) {
      const b = run[idx];
      const has = check.hasComments(b.id);
      if (has && commented) flush();
      seg.push(b);
      if (has) commented = b;
      if (b.children?.length) flush();
    }
    flush();
    plan.photos += row.length;
    k = row[row.length - 1] + 1;
  }
}

function segmentOf(blocks: BlockLike[], alone: boolean, commented: BlockLike | null): Segment {
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  const align = str(first.props?.textAlignment);
  const props: Record<string, unknown> = {};
  // Una foto sola conserva su alineación (en una fila de varias no contaba, como en Doc_Imagenes.md).
  if (alone && (align === 'center' || align === 'right')) props.textAlignment = align;
  return {
    ids: blocks.map((b) => b.id),
    paragraph: {
      // El id de la foto con comentarios (siguen anclados al renglón), o el de la primera.
      id: (commented ?? first).id,
      type: 'paragraph',
      props,
      content: blocks.map((b) => ({ type: PHOTO, props: { url: str(b.props?.url), name: str(b.props?.name), w: widthOfBlock(b) } })),
      children: last.children ?? [],
    },
  };
}

/** Lo que usa del editor de BlockNote. */
export interface ConvertEditor {
  document: BlockLike[];
  getParentBlock(id: string): BlockLike | undefined;
  insertBlocks(blocks: unknown[], reference: string, placement: 'before' | 'after'): unknown;
  removeBlocks(ids: string[]): unknown;
  updateBlock(id: string, update: unknown): unknown;
  prosemirrorView?: { state: EditorState } | undefined;
}

/** Dónde vuelve a entrar el renglón cuando ya se sacaron sus bloques. */
type Anchor = { id: string; placement: 'before' | 'after' } | { parent: string } | null;

function anchorOf(editor: ConvertEditor, ids: string[]): Anchor {
  const parent = editor.getParentBlock(ids[0]);
  const siblings = parent ? (parent.children ?? []) : editor.document;
  const from = siblings.findIndex((b) => b.id === ids[0]);
  const to = siblings.findIndex((b) => b.id === ids[ids.length - 1]);
  if (from < 0 || to < 0) return null;
  if (to + 1 < siblings.length) return { id: siblings[to + 1].id, placement: 'before' };
  if (from > 0) return { id: siblings[from - 1].id, placement: 'after' };
  return parent ? { parent: parent.id } : null;
}

/**
 * Convierte, como un solo paso de deshacer. Cada renglón reemplaza a sus bloques y toma el id de la primera foto (los
 * comentarios de esa foto siguen anclados). Devuelve lo que hizo.
 *
 * Primero se SACAN los bloques y después se PONE el renglón (dos cambios), nunca "reemplazar" en uno: y-prosemirror
 * reusaría el contenedor del bloque (mismo id) y pondría el párrafo adentro en lugar de la imagen. Medido
 * (convertPhotos.test.ts): el deshacer no saca un párrafo con contenido (`protectedNodes` de y-prosemirror) y dejaba
 * imagen + párrafo en el mismo bloque, que el editor tiraba entero (se perdían fotos); y dos dispositivos que
 * convertían a la vez metían dos párrafos en el mismo bloque y la fila desaparecía. Sacando y poniendo, el deshacer
 * borra el bloque nuevo y devuelve los viejos, y dos conversiones a la vez dejan la fila dos veces (nada se pierde).
 * Cada renglón es su propio par de cambios: así y-prosemirror toca solo esos bloques y no los de al lado (que otro
 * puede estar editando).
 */
export function convertPhotos(editor: ConvertEditor, check: ConvertCheck): ConvertPlan {
  const plan = planConversion(editor.document, check);
  if (plan.segments.length === 0) return plan;
  const run = () => {
    for (const s of plan.segments) {
      const anchor = anchorOf(editor, s.ids);
      // Sin hermanos ni madre (la página es solo esta fila): un renglón vacío de apoyo, que se saca al final.
      let helper: string | null = null;
      if (!anchor) {
        helper = `convert-${s.ids[0]}`;
        editor.insertBlocks([{ id: helper, type: 'paragraph' }], s.ids[s.ids.length - 1], 'after');
      }
      editor.removeBlocks(s.ids);
      if (helper) editor.insertBlocks([s.paragraph], helper, 'before');
      else if (anchor && 'parent' in anchor) editor.updateBlock(anchor.parent, { children: [s.paragraph] });
      else if (anchor) editor.insertBlocks([s.paragraph], anchor.id, anchor.placement);
      if (helper) editor.removeBlocks([helper]);
    }
  };
  const state = editor.prosemirrorView?.state;
  if (state) asOneUndoStep(state, run);
  else run();
  return plan;
}
