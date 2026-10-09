import { createExtension } from '@blocknote/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Mapping, StepMap } from '@tiptap/pm/transform';
import { Plugin, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { ySyncPluginKey } from 'y-prosemirror';
import { t } from '../i18n';
import { linkedPageId, SEPARATOR, unitPos, unitsFromPM, type BlockMeta, type PMUnit } from '../search/extract';
import { sceneTitleOf } from './dayLive';
import { placeUnits } from './fields';
import type { LiveSource } from './liveView';
import { scan, type Hit, type Registry } from './reader';
import { underlineKey, UNDERLINE_NOW, type UnderlineSpec, type UnderlineState } from './relLink';
import { slashDraft, subscribeSlashDraft } from './slashDraft';
import './liveHeader.css';

// El subrayado pasivo, la ficha-chip de un link y el título en vivo (Docs/Doc_Relaciones.md, sección 14; maqueta S4 «D»,
// `d_escribir.html`). En el editor de la página abierta, las escenas y locaciones que reconoce el lector de las relaciones
// (`scan`, el mismo que arma el índice, con el mismo texto: los links a páginas tapados) quedan con un subrayado punteado;
// lo que no existe en el proyecto (un pendiente, `105_120`), con uno gris de rayas. Un link a la página de una escena o
// una locación se ve como ficha (número e ícono) y, en un título, con el título de la escena en vivo.
//
// Son DECORACIONES de ProseMirror: no están en el Y.Doc, no se sincronizan, no se copian, no salen en el PDF (el editor de
// la exportación no las tiene) ni al imprimir (`@media print`). Una versión vieja ve el texto y los links de siempre.
//
// Cuándo se dibujan: medio segundo después de la última edición (propia o de otro dispositivo) y con cada foto nueva del
// índice; mientras tanto lo dibujado se corre con las ediciones (sin parpadeo y sin mover el cursor). Mientras se compone
// con un IME, se espera. Lo que ya es link no se subraya.

export interface UnderlineInfo {
  R: Registry;
  /** El episodio de la página (para «Esc 27»). */
  ep: string | null;
  /** La entidad de la página misma (no se subraya: su adelanto sería la página que se está viendo). */
  self: { kind: 'scene' | 'loc'; ref: string } | null;
  /** A qué escena o locación lleva un link a esa página (o `null`). */
  target(pageId: string): { kind: 'scene' | 'loc'; ref: string } | null;
  /** La página de una escena o locación, si la persona la ve. */
  pageOf(kind: 'scene' | 'loc', ref: string): string | null;
  /** El título en vivo de la escena de esa página (sin su número), o `null`. */
  sceneTitle(pageId: string): string | null;
}

/** Lo que la vista avisa a la app (el adelanto, `RelPeek.tsx`). */
export interface PeekTarget {
  kind: 'scene' | 'loc' | 'pending';
  ref: string;
  part: string;
  /** Dónde está en el documento (para volverlo link desde el adelanto). */
  from: number;
  to: number;
  /** Su rectángulo en la pantalla al abrirse. */
  rect: { left: number; top: number; right: number; bottom: number };
  /** Un subrayado (se puede volver link) o un link que ya es ficha. */
  via: 'underline' | 'link';
  pageId: string | null;
}

export interface PeekEvents {
  /** El mouse quedó sobre un subrayado o una ficha (`null`: salió). */
  hover(target: PeekTarget | null): void;
  /** Un toque con el teclado cerrado, o mantener apretado. */
  open(target: PeekTarget): void;
  /** Si el adelanto de ese lugar (o, sin lugar, cualquiera) está abierto: un segundo toque pone el cursor. */
  isOpen(from?: number): boolean;
  /** Se escribió, se tocó Esc: se cierra (y el que estaba por abrirse con el mouse no se abre). */
  close(): void;
  /** Se eligió texto: el adelanto del mouse se cierra y no se abre mientras haya algo elegido (O4 de la auditoría de E6). */
  select(): void;
}

/** Lo dibujado: los subrayados, las fichas de los links y el título de la escena al final de un título. */
export interface BuiltUnderlines {
  decos: Decoration[];
  sig: string;
  /** Cuántos subrayados y fichas (para medir). */
  count: number;
}

const TITLE_CHARS = 44;
const short = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : text);

/** Lo reconocido por texto de unidad, mientras no cambie lo que existe ni el episodio (al releer, solo lo nuevo). */
export interface ScanMemo {
  key: string;
  map: Map<string, Hit[]>;
}

/** Los tramos con link de una unidad, en posiciones de su texto (un link partido en pedazos es uno solo). */
function linkRanges(unit: PMUnit): { start: number; end: number; href: string; pageId: string | null }[] {
  const out: { start: number; end: number; href: string; pageId: string | null }[] = [];
  if (!unit.node) return out;
  let at = 0;
  unit.node.forEach((child) => {
    const len = child.isText ? child.text!.length : 1;
    const href = child.isText ? child.marks.find((m) => m.type.name === 'link')?.attrs.href : undefined;
    if (typeof href === 'string') {
      const last = out[out.length - 1];
      if (last && last.end === at && last.href === href) last.end += len;
      else out.push({ start: at, end: at + len, href, pageId: linkedPageId(href) });
    }
    at += len;
  });
  return out;
}

/** El texto que lee el índice (`pageRelations.ts`, `readable`): separadores como espacios, los links a páginas tapados. */
function readable(text: string, links: { start: number; end: number; pageId: string | null }[]): string {
  let s = text.includes(SEPARATOR) ? text.replaceAll(SEPARATOR, ' ') : text;
  for (const l of links) if (l.pageId) s = s.slice(0, l.start) + ' '.repeat(l.end - l.start) + s.slice(l.end);
  return s;
}

function titleWidget(title: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'lh-ltitle';
  el.contentEditable = 'false';
  el.dataset.tip = t('day.liveTitleTip');
  el.textContent = ` · ${short(title, TITLE_CHARS)}`;
  return el;
}

/**
 * Arma las decoraciones de un documento. Puro salvo el DOM de los widgets (que se crea recién al dibujarlos). `memo`
 * guarda lo reconocido por texto para la próxima vez.
 */
export function buildUnderlines(doc: PMNode, info: UnderlineInfo | null, memo?: ScanMemo): BuiltUnderlines {
  if (!info) return { decos: [], sig: '', count: 0 };
  const key = `${info.R.signature}|${info.ep ?? ''}`;
  const prev = memo && memo.key === key ? memo.map : null;
  const next = new Map<string, Hit[]>();
  const decos: Decoration[] = [];
  const sig: string[] = [];
  const units = unitsFromPM(doc);
  // El valor de un campo de locación se lee como un lugar, igual que en el índice (D545): lo que cuenta se ve.
  const place = placeUnits(units, metaFromPM(doc, units));
  // La consulta abierta del `/` (`/e 105_141`) todavía no es un número escrito: no se subraya hasta elegir (D664).
  const draft = slashDraft();
  for (const [index, unit] of units.entries()) {
    if (unit.field !== 'text' || !unit.node) continue;
    const heading = unit.node.type.name === 'heading';
    const inPlace = !heading && place.has(index);
    const links = linkRanges(unit);
    const text = readable(unit.text, links);
    const mkey = `${heading ? 'h' : inPlace ? 'p' : 't'}\u0000${text}`;
    let hits = next.get(mkey) ?? prev?.get(mkey);
    if (!hits) hits = scan(info.R, text, inPlace ? { heading, ep: info.ep, dayTitle: true } : { heading, ep: info.ep });
    next.set(mkey, hits);
    const queryAt = draft && unit.field === 'text' && doc.nodeAt(unit.blockPos)?.attrs.id === draft.blockId ? unit.text.lastIndexOf(draft.query) : -1;
    for (const h of hits) {
      if (h.hidden) continue;
      if (queryAt >= 0 && h.kind === 'pending' && h.s >= queryAt && draft!.codes.includes(h.ref)) continue;
      if (info.self && h.kind === info.self.kind && h.ref === info.self.ref) continue;
      // Lo que ya es link (a una página o afuera) no lleva subrayado.
      if (links.some((l) => l.start < h.e && l.end > h.s)) continue;
      const from = unitPos(unit, h.s);
      const to = unitPos(unit, h.e);
      if (to <= from) continue;
      const pageId = h.kind === 'pending' ? null : info.pageOf(h.kind, h.ref);
      const spec: UnderlineSpec = { kind: h.kind, ref: h.ref, part: h.part, pageId };
      const cls = h.kind === 'loc' ? 'rel-u loc' : h.kind === 'pending' ? 'rel-u pend' : 'rel-u';
      decos.push(Decoration.inline(from, to, { class: cls, 'data-rel': h.kind, 'data-ref': h.ref }, { rel: spec }));
      sig.push(`${from}-${to}${cls}${h.ref}`);
    }
    // Los links a una escena o una locación: la ficha. En un título, el título de la escena al final (O4 de E5: lo que se
    // escribe después del link queda antes del título en vivo y se lee en orden).
    let title: string | null = null;
    for (const l of links) {
      const target = l.pageId ? info.target(l.pageId) : null;
      if (!target) continue;
      const from = unitPos(unit, l.start);
      const to = unitPos(unit, l.end);
      if (to <= from) continue;
      const cls = target.kind === 'loc' ? 'rel-chip loc' : 'rel-chip scene';
      decos.push(Decoration.inline(from, to, { class: cls, 'data-rel': target.kind, 'data-ref': target.ref }, { chip: { kind: target.kind, ref: target.ref, pageId: l.pageId } }));
      sig.push(`${from}-${to}${cls}${target.ref}`);
      if (heading && target.kind === 'scene' && title === null) title = info.sceneTitle(l.pageId!) || null;
    }
    if (title) {
      const end = unit.nodePos + unit.nodeSize - 1;
      decos.push(Decoration.widget(end, () => titleWidget(title!), { side: 1, ignoreSelection: true, key: `lt:${title}` }));
      sig.push(`${end}lt${title}`);
    }
  }
  if (memo) {
    memo.key = key;
    memo.map = next;
  }
  return { decos, sig: sig.join('|'), count: sig.length };
}

/**
 * Lo que el índice sabe de cada bloque (`BlockMeta`: nivel de título y celdas de una tabla), sacado del documento del
 * editor, en el mismo orden que `unitsFromPM`. Para leer los campos de la página abierta como los lee el índice.
 */
export function metaFromPM(doc: PMNode, units: readonly PMUnit[]): BlockMeta[] {
  const meta: BlockMeta[] = [];
  let ui = 0;
  doc.descendants((node, pos) => {
    if (node.type.name !== 'blockContainer') return true;
    while (ui < units.length && units[ui].blockPos < pos) ui++;
    const content = node.firstChild;
    const level = content?.type.name === 'heading' ? Math.max(1, Number(content.attrs.level) || 1) : 0;
    const extra: BlockMeta = { blockId: String(node.attrs.id ?? ''), at: ui, level };
    if (content?.type.name === 'table') {
      const cells: NonNullable<BlockMeta['cells']> = [];
      let cols = 0;
      for (let i = ui; i < units.length && units[i].blockPos === pos; i++) {
        if (units[i].field !== 'text') continue;
        const $p = doc.resolve(units[i].nodePos);
        for (let d = $p.depth; d >= 2; d--) {
          const name = $p.node(d).type.name;
          if (name !== 'tableCell' && name !== 'tableHeader') continue;
          const row = $p.node(d - 1);
          let col = 0;
          for (let k = 0; k < $p.index(d - 1); k++) col += Math.max(1, Number(row.child(k).attrs.colspan) || 1);
          cells.push({ unit: i, row: $p.index(d - 2), col });
          let width = 0;
          row.forEach((c) => (width += Math.max(1, Number(c.attrs.colspan) || 1)));
          cols = Math.max(cols, width);
          break;
        }
      }
      if (cells.length) {
        extra.cells = cells;
        extra.cols = cols;
      }
    }
    if (extra.level || extra.cells) meta.push(extra);
    return true;
  });
  return meta;
}

/** Lo que muestra el editor de una página, armado con la foto del índice de relaciones (o `null`: nada). */
export function underlineInfo(src: Pick<LiveSource, 'snap' | 'title'>, pageId: string): UnderlineInfo | null {
  const { snap } = src;
  const role = snap.registration.roles.get(pageId);
  // Una página fuera de las relaciones (`graph: false`, una plantilla) o que el índice todavía no conoce: nada.
  if (!role || role.excluded) return null;
  const byPage = new Map<string, { kind: 'scene' | 'loc'; ref: string }>();
  for (const e of snap.registry.scenes.values()) if (e.pageId) byPage.set(e.pageId, { kind: 'scene', ref: e.code });
  for (const e of snap.registry.locations.values()) if (e.pageId) byPage.set(e.pageId, { kind: 'loc', ref: e.name });
  const own = role.entity && role.entity.ref && (role.entity.kind === 'scene' || role.entity.kind === 'location') ? { kind: role.entity.kind === 'scene' ? ('scene' as const) : ('loc' as const), ref: role.entity.ref } : null;
  return {
    R: snap.registry,
    ep: role.ep ?? null,
    self: own,
    target: (id) => byPage.get(id) ?? null,
    pageOf: (kind, ref) => (kind === 'scene' ? snap.registry.scenes.get(ref)?.pageId : snap.registry.locations.get(ref)?.pageId) ?? null,
    sceneTitle: (id) => {
      const title = src.title(id);
      return title === undefined ? null : sceneTitleOf(title);
    },
  };
}

/** Armar más lento que esto (una página enorme) no se repite con cada cambio que llega de otro dispositivo. */
export const SLOW_MS = 12;

/**
 * Corre lo dibujado por un reemplazo del documento entero (lo que hace y-prosemirror con lo que llega de Yjs) como si
 * solo hubiera cambiado el tramo distinto: lo de antes y lo de después queda en su lugar; lo de adentro se va hasta la
 * próxima lectura.
 */
export function mapThroughReplace(set: DecorationSet, oldDoc: PMNode, newDoc: PMNode): DecorationSet {
  const start = oldDoc.content.findDiffStart(newDoc.content);
  if (start === null || start === undefined) return set;
  const end = oldDoc.content.findDiffEnd(newDoc.content);
  if (!end) return set;
  let { a: endA, b: endB } = end;
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  return set.map(new Mapping([new StepMap([start, endA - start, endB - start])]), newDoc);
}

/**
 * Lo dibujado que tocó una edición de acá (escribir adentro de «105_029», reemplazar con buscar) se saca hasta la
 * relectura: su referencia ya no es la del texto (O5 de la auditoría de E6: «105_025» con el adelanto de 105_029 durante
 * medio segundo). Lo que está pegado a lo escrito, antes o después, queda como estaba (escribir al lado no lo apaga).
 */
export function dropTouched(set: DecorationSet, mapping: Mapping): DecorationSet {
  const ranges: [number, number][] = [];
  mapping.maps.forEach((map, i) => {
    const rest = mapping.slice(i + 1);
    map.forEach((_oldFrom, _oldTo, from, to) => ranges.push([rest.map(from, -1), rest.map(to, 1)]));
  });
  if (!ranges.length) return set;
  const gone: Decoration[] = [];
  for (const [from, to] of ranges) {
    for (const d of set.find(from, to)) {
      // El título en vivo (un widget) no tiene tramo: se queda.
      if (d.from === d.to) continue;
      const hit = from === to ? d.from < from && d.to > from : d.from < to && d.to > from;
      if (hit && !gone.includes(d)) gone.push(d);
    }
  }
  return gone.length ? set.remove(gone) : set;
}

/**
 * Lo dibujado al que una edición le sacó letras del borde (borrar la última cifra de «105_029»): su tramo quedó más corto
 * y ya no dice lo que decía, pero `dropTouched` no lo ve porque la edición queda pegada y no adentro (O10 de la
 * auditoría de la v0.244, D670). Se compara el largo de cada tramo antes y después de correrlo.
 */
export function dropShrunk(before: DecorationSet, mapped: DecorationSet, mapping: Mapping): DecorationSet {
  const gone: Decoration[] = [];
  for (const d of before.find()) {
    if (d.from === d.to) continue;
    const from = mapping.map(d.from, 1);
    const to = mapping.map(d.to, -1);
    if (to - from === d.to - d.from) continue;
    for (const m of mapped.find(from, to, (spec) => spec === d.spec)) if (!gone.includes(m)) gone.push(m);
  }
  return gone.length ? mapped.remove(gone) : mapped;
}

/**
 * El mouse sobre el editor: si se movió de verdad desde la última tecla (B1 de la auditoría de E6). Medio segundo después
 * de escribir, el subrayado nuevo aparece debajo del puntero quieto y Chromium le manda `pointerover` (y puede mandar un
 * `pointermove` en el mismo lugar) como si el mouse hubiera llegado: eso no es pasar el mouse, y el adelanto se abría
 * solo mientras se escribía. Una tecla lo desarma; recién un movimiento a otro lugar lo vuelve a armar.
 */
export class MouseGate {
  private x = Number.NaN;
  private y = Number.NaN;
  private typed = false;
  armed = false;
  /** El subrayado o la ficha donde quedó el mouse (para avisar una sola vez al entrar). */
  over: Element | null = null;

  /** El puntero está en (x, y): si cambió de lugar (o no se sabía dónde estaba y no se escribió nada), es un movimiento. */
  move(x: number, y: number): void {
    const known = !Number.isNaN(this.x);
    if (known ? x !== this.x || y !== this.y : !this.typed) this.armed = true;
    this.x = x;
    this.y = y;
  }

  /** Un clic: dónde está el puntero, sin armar (el clic para empezar a escribir deja el mouse ahí). */
  place(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  /** Una tecla que escribe o mueve el cursor. */
  key(): void {
    this.armed = false;
    this.typed = true;
    this.over = null;
  }
}

/** Cuánto esperar después de la última edición (como la relectura de la página, `REREAD_MS`). */
export const UNDERLINE_WAIT_MS = 500;

const views = new WeakMap<EditorView, UnderlineView>();

/** Hay una foto nueva del índice: volver a dibujar (cuando pase medio segundo de la última edición). */
export function refreshRelUnderline(view: EditorView): void {
  views.get(view)?.refresh();
}

/** Mantener apretado: lo que se espera antes de abrir el adelanto (lo mismo que el menú de un toque largo). */
const PRESS_MS = 450;
/** Un toque que se movió más que esto es un desplazamiento, no un toque. */
const TAP_SLOP = 10;
/** Teclas que solas no escriben (no cierran el adelanto: son el principio de un atajo). */
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

class UnderlineView {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastEdit = 0;
  private destroyed = false;
  private readonly unsubscribeDraft: () => void;

  private readonly win: Window | null;
  private readonly onMove = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') this.gate.move(e.clientX, e.clientY);
  };
  private readonly onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') this.gate.place(e.clientX, e.clientY);
  };

  constructor(
    private readonly view: EditorView,
    private readonly compute: (doc: PMNode) => UnderlineState,
    private readonly gate: MouseGate,
    private readonly events: () => PeekEvents | null,
  ) {
    views.set(view, this);
    // Dónde está el mouse en toda la ventana, antes de que lo vea el editor (fase de captura): si se movió de verdad.
    this.win = view.dom.ownerDocument?.defaultView ?? null;
    this.win?.addEventListener('pointermove', this.onMove, true);
    this.win?.addEventListener('pointerdown', this.onDown, true);
    // Lo primero, en cuanto haya un momento libre (el editor recién montado).
    this.schedule(0);
    // La consulta del `/` se abre y se cierra sin tocar el documento (Esc): al cerrarse, lo escrito vuelve a subrayarse.
    this.unsubscribeDraft = subscribeSlashDraft(() => this.refresh());
  }

  update(view: EditorView, prev: EditorState): void {
    // Texto elegido (doble clic sobre un subrayado): la barra de formato y el adelanto no salen juntos (O4).
    if (!view.state.selection.empty && !prev.selection.eq(view.state.selection)) this.events()?.select();
    if (prev.doc.eq(view.state.doc)) return;
    this.lastEdit = Date.now();
    this.schedule(UNDERLINE_WAIT_MS);
  }

  refresh(): void {
    this.schedule(Math.max(0, this.lastEdit + UNDERLINE_WAIT_MS - Date.now()));
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), ms);
  }

  private run(): void {
    this.timer = null;
    if (this.destroyed) return;
    // Escribiendo con un IME (acentos, japonés, el dictado del teclado): nada cambia en el medio.
    if (this.view.composing) return this.schedule(200);
    const wait = this.lastEdit + UNDERLINE_WAIT_MS - Date.now();
    if (wait > 0) return this.schedule(wait);
    const next = this.compute(this.view.state.doc);
    if (next.sig === underlineKey.getState(this.view.state)?.sig) return;
    this.view.dispatch(this.view.state.tr.setMeta(underlineKey, next).setMeta('addToHistory', false));
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribeDraft();
    if (this.timer) clearTimeout(this.timer);
    this.win?.removeEventListener('pointermove', this.onMove, true);
    this.win?.removeEventListener('pointerdown', this.onDown, true);
    views.delete(this.view);
  }
}

/** El subrayado o la ficha bajo un elemento del editor, con su lugar. */
function targetOf(view: EditorView, el: Element | null): PeekTarget | null {
  const span = el?.closest?.('.rel-u, .rel-chip');
  if (!span || !view.dom.contains(span)) return null;
  let pos: number;
  try {
    pos = view.posAtDOM(span, 0);
  } catch {
    return null;
  }
  const st = underlineKey.getState(view.state);
  if (!st) return null;
  for (const d of st.set.find(Math.max(0, pos - 1), pos + 1)) {
    const spec = d.spec as { rel?: UnderlineSpec; chip?: { kind: 'scene' | 'loc'; ref: string; pageId: string } };
    if (d.from > pos || d.to <= pos) continue;
    const r = span.getBoundingClientRect();
    const rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    if (spec.rel) return { kind: spec.rel.kind, ref: spec.rel.ref, part: spec.rel.part, from: d.from, to: d.to, rect, via: 'underline', pageId: spec.rel.pageId };
    if (spec.chip) return { kind: spec.chip.kind, ref: spec.chip.ref, part: '', from: d.from, to: d.to, rect, via: 'link', pageId: spec.chip.pageId };
  }
  return null;
}

/**
 * La extensión del editor de la página. `info` devuelve lo de la foto más nueva del índice (`refreshRelUnderline` la
 * vuelve a leer); `events`, lo que se avisa para el adelanto.
 */
export function relUnderlineExtension(info: () => UnderlineInfo | null, events: () => PeekEvents | null) {
  const memo: ScanMemo = { key: '', map: new Map() };
  /** Lo que tardó la última vez (para no rearmar en cada cambio que llega en una página enorme). */
  let lastCost = 0;
  const compute = (doc: PMNode): UnderlineState => {
    const t0 = performance.now();
    const built = buildUnderlines(doc, info(), memo);
    const set = DecorationSet.create(doc, built.decos);
    lastCost = performance.now() - t0;
    return { set, sig: built.sig };
  };
  // El toque en curso sobre un subrayado o una ficha (en la pantalla táctil).
  let touch: { x: number; y: number; target: PeekTarget; timer: ReturnType<typeof setTimeout>; pressed: boolean } | null = null;
  let pointer = '';
  const gate = new MouseGate();
  const endTouch = () => {
    if (touch) clearTimeout(touch.timer);
    touch = null;
  };
  const plugin = new Plugin<UnderlineState>({
    key: underlineKey,
    state: {
      // Al crearse el editor todavía no hay foto del índice: se dibuja apenas llega (o en el primer momento libre).
      init: () => ({ set: DecorationSet.empty, sig: '' }),
      apply: (tr, value, old) => {
        const meta = tr.getMeta(underlineKey) as UnderlineState | typeof UNDERLINE_NOW | undefined;
        if (meta === UNDERLINE_NOW) return compute(tr.doc);
        if (meta) return meta;
        if (!tr.docChanged) return value;
        // Lo que llega de Yjs (otro dispositivo, deshacer, rehacer) reemplaza el documento entero (y-prosemirror,
        // `_typeChanged`): corrido así, no quedaría nada dibujado hasta la próxima lectura (un parpadeo). Se arma de nuevo
        // en el momento, con lo reconocido de antes para lo que no cambió; en una página enorme (armar tardó más de
        // `SLOW_MS`: *BD Main* de ERSO), se corre solo por el tramo que cambió y se vuelve a leer medio segundo después.
        if (tr.getMeta(ySyncPluginKey)) return lastCost < SLOW_MS ? compute(tr.doc) : { set: mapThroughReplace(value.set, old.doc, tr.doc), sig: '' };
        // Lo que se escribe acá se corre con lo dibujado: sin parpadeo, hasta que se vuelve a leer. Lo que la edición tocó
        // por dentro se saca: su referencia ya no vale (O5).
        return { set: dropShrunk(value.set, dropTouched(value.set.map(tr.mapping, tr.doc), tr.mapping), tr.mapping), sig: '' };
      },
    },
    view: (view) => new UnderlineView(view, compute, gate, events),
    props: {
      decorations: (state) => underlineKey.getState(state)?.set,
      // Esc lo cierra (y no hace nada más); escribir también, y la tecla sigue su camino. Toda tecla (salvo un modificador
      // solo) desarma el mouse hasta que se mueva y cancela un adelanto que estaba por abrirse (B1).
      handleKeyDown: (_view, event) => {
        if (MODIFIERS.has(event.key)) return false;
        gate.key();
        const ev = events();
        if (!ev) return false;
        if (event.key === 'Escape' && ev.isOpen()) {
          ev.close();
          return true;
        }
        ev.close();
        return false;
      },
      // El teclado de un teléfono no siempre manda la tecla: lo escrito igual cierra el adelanto.
      handleTextInput: () => {
        if (events()?.isOpen()) events()?.close();
        return false;
      },
      handleDOMEvents: {
        pointerdown: (_view, event) => {
          pointer = event.pointerType;
          return false;
        },
        // Con el mouse: el adelanto con una pequeña demora (la lleva el adelanto), solo al moverse de verdad sobre un
        // subrayado. No cuando el subrayado aparece debajo del puntero quieto (B1): por eso `pointermove` con el mouse
        // armado y no `pointerover`. Nunca mientras se arrastra para elegir.
        pointermove: (view, event) => {
          if (event.pointerType !== 'mouse' || event.buttons !== 0 || !gate.armed) return false;
          const span = (event.target as Element | null)?.closest?.('.rel-u, .rel-chip') ?? null;
          if (span === gate.over) return false;
          gate.over = span;
          if (span) events()?.hover(targetOf(view, span));
          return false;
        },
        pointerout: (_view, event) => {
          if (event.pointerType !== 'mouse') return false;
          const to = event.relatedTarget as Element | null;
          const from = (event.target as Element | null)?.closest?.('.rel-u, .rel-chip');
          if (from && !(to && from.contains(to))) {
            if (gate.over === from) gate.over = null;
            events()?.hover(null);
          }
          return false;
        },
        touchstart: (view, event) => {
          endTouch();
          if (event.touches.length !== 1) return false;
          const target = targetOf(view, event.target as Element);
          if (!target) return false;
          const p = event.touches[0];
          const timer = setTimeout(() => {
            if (!touch) return;
            touch.pressed = true;
            events()?.open(touch.target);
          }, PRESS_MS);
          touch = { x: p.clientX, y: p.clientY, target, timer, pressed: false };
          return false;
        },
        touchmove: (_view, event) => {
          const p = event.touches[0];
          if (touch && p && Math.hypot(p.clientX - touch.x, p.clientY - touch.y) > TAP_SLOP) endTouch();
          return false;
        },
        touchcancel: () => {
          endTouch();
          return false;
        },
        touchend: (view, event) => {
          const current = touch;
          endTouch();
          if (!current) return false;
          if (current.pressed) {
            // Mantuvo apretado: el adelanto ya está abierto; el toque no pone el cursor.
            event.preventDefault();
            return true;
          }
          // Con el teclado abierto (el editor con el foco), tocar solo pone el cursor (C7, B3): ni adelanto ni nada.
          if (view.editable && view.hasFocus()) return false;
          // El segundo toque sobre el mismo: se cierra y pone el cursor (abre el teclado), como cualquier texto.
          if (events()?.isOpen(current.target.from)) {
            events()?.close();
            return false;
          }
          // Teclado cerrado: el adelanto, sin abrir el teclado (sin el clic que pondría el foco).
          event.preventDefault();
          events()?.open(current.target);
          return true;
        },
        // Un toque largo en Android: el menú del sistema no sale sobre un subrayado; el adelanto ya se abrió.
        contextmenu: (view, event) => {
          if (pointer !== 'touch') return false;
          const target = targetOf(view, event.target as Element);
          if (!target) return false;
          event.preventDefault();
          if (!events()?.isOpen(target.from)) events()?.open(target);
          return true;
        },
      },
    },
  });
  return createExtension({ key: 'shotdocs-rel-underline', prosemirrorPlugins: [plugin] });
}
