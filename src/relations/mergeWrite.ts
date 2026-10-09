import * as Y from 'yjs';
import { unitsFromYDoc, type BlockMeta } from '../search/extract';
import { PHOTO_MARKUP_MAP } from '../media/markup';
import { carryMarkup, mediaIdsInText, snapshotMarkup } from '../media/markupClipboard';
import { CONTENT_FRAGMENT, copyType } from '../sync/structure';
import { SHARED_COLLAPSE_MAP } from '../ui/collapseEditor';
import { withEditor } from './prepareDay';

// La escritura de *Merge* en los documentos (E16, D645, D649, C4, C5). Se baja recién al unir (con el editor).
//
// - **Copiar** (`copyIntoDoc`): en el Y.Doc de la página que queda (A), en UNA transacción y solo insertando, al final de
//   la raíz: un título 1 separador y una copia exacta (`copyType`: atributos, huecos estables, fotos en línea) de cada
//   bloque de la página que se va (B), con **los mismos ids de bloque**. Un id de B que A ya tenía antes de unir (`remap`:
//   una salió de copiar la otra) va con un id derivado, igual en todos los dispositivos, también en los bloques anidados
//   (C4). Repetir no duplica: si A ya tiene el separador (su id también es derivado de B), no se copia nada. Las
//   anotaciones de las fotos copiadas pasan con las reglas de pegar (`carryMarkup`) y los títulos colapsados para todos,
//   con su entrada. B no se toca.
// - **Deshacer** (`undoCopyInDoc`): saca de A, por id y en una transacción, solo los bloques copiados que siguen
//   **intactos**: el contenedor, cada atributo y cada hijo son items de esa copia (el mismo autor de Yjs y su rango de
//   relojes) y nada está borrado. Uno que alguien tocó queda (C5, la lección de E5: nunca `removeBlocks`).

/** El origen de lo que escribe *Merge* en A (se guarda y se sube como cualquier edición; el ⌘Z del editor no lo toca). */
export const MERGE_ORIGIN = Symbol('merge');

const GROUP = 'blockGroup';
const CONTAINER = 'blockContainer';

/** Lo que escribió una copia en A: para retomar y para *Undo*. */
export interface CopyRecord {
  /** El autor de Yjs y el rango de relojes `[from, to)` de la transacción de la copia. */
  client: number;
  from: number;
  to: number;
  /** Los ids de primer nivel que agregó (el separador primero), ya con los derivados. */
  ids: string[];
  /** Las fotos y archivos (`sdmedia://`) de lo copiado. */
  photos: string[];
  /** Las fotos cuyas anotaciones no pasaron (otro marco en A, topes): quedan en B. */
  markupSkipped: string[];
}

/**
 * Un id derivado, el mismo en todos los dispositivos: una mezcla de 128 bits de `B:idViejo` con forma de uuid. Para
 * un bloque de B cuyo id ya estaba en A y para el separador.
 */
export function derivedId(pageId: string, oldId: string): string {
  const text = `${pageId}:${oldId}`;
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const hex = [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1].map((n) => (n >>> 0).toString(16).padStart(8, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * El id del separador que deja una unión (`key`: la página que se va y el id de la unión, `copyKey`): igual en todos los
 * dispositivos y al retomar, distinto en otra unión de la misma página.
 */
export const separatorId = (key: string) => derivedId(key, 'merge-separator');

/** Las raíces del documento (debería haber una; con dos sin reparar, se leen las dos en orden). */
function rootGroups(doc: Y.Doc): Y.XmlElement[] {
  return doc
    .getXmlFragment(CONTENT_FRAGMENT)
    .toArray()
    .filter((n): n is Y.XmlElement => n instanceof Y.XmlElement && n.nodeName === GROUP);
}

/** Cada id de bloque del documento, a cualquier profundidad. */
export function blockIds(doc: Y.Doc): Set<string> {
  const out = new Set<string>();
  const walk = (node: Y.XmlElement) => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (child.nodeName === CONTAINER) {
        const id = child.getAttribute('id');
        if (typeof id === 'string') out.add(id);
      }
      if (child.nodeName === GROUP || child.nodeName === CONTAINER) walk(child);
    }
  };
  for (const root of rootGroups(doc)) walk(root);
  return out;
}

/** Los archivos (`sdmedia://`) de un elemento y lo de adentro: los de bloque y los de las fotos en línea. */
function mediaIn(node: Y.XmlElement, out: Set<string>): void {
  for (const value of Object.values(node.getAttributes())) if (typeof value === 'string') for (const id of mediaIdsInText(value)) out.add(id);
  for (const child of node.toArray()) if (child instanceof Y.XmlElement) mediaIn(child, out);
}

/** Lo que se lee de un documento para contar (el adelanto): sus unidades de texto con lo de cada bloque. */
export function readDoc(doc: Y.Doc): { units: ReturnType<typeof unitsFromYDoc>; meta: BlockMeta[] } {
  const meta: BlockMeta[] = [];
  const units = unitsFromYDoc(doc, meta);
  return { units, meta };
}

// --- Qué de B ya está en A (D646, D707) ------------------------------------------------------------------------------

/** JSON con las claves ordenadas: dos valores iguales dan el mismo texto. */
function stable(value: unknown): string {
  if (value instanceof Y.AbstractType) return stable(value.toJSON());
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * La firma de un elemento: su tipo, sus atributos (menos el `id` del bloque), el texto con su formato y lo de adentro, a
 * cualquier profundidad. Dos bloques con la misma firma dicen lo mismo, con las mismas mayúsculas y el mismo formato.
 */
export function blockSignature(node: Y.XmlElement | Y.XmlText): string {
  if (node instanceof Y.XmlText) return `t${stable(node.toDelta())}`;
  const attrs = { ...node.getAttributes() } as Record<string, unknown>;
  if (node.nodeName === CONTAINER) delete attrs.id;
  const kids = node.toArray().map((c) => (c instanceof Y.XmlElement || c instanceof Y.XmlText ? blockSignature(c) : stable(c)));
  return `<${node.nodeName} ${stable(attrs)}>${kids.join('')}</>`;
}

/** Del aspecto de un párrafo: un renglón en blanco lo es con cualquiera. */
const LOOKS = new Set(['textColor', 'backgroundColor', 'textAlignment']);

/**
 * Un renglón en blanco: un párrafo sin texto ni nada adentro y sin ninguna marca (salto de página, pregunta, script, tarjeta
 * de Drive; algo que no se conozca tampoco cuenta como blanco). No dice nada: si sobra, no se copia.
 */
function isBlank(block: Y.XmlElement): boolean {
  const parts = block.toArray();
  if (parts.length !== 1) return false;
  const content = parts[0];
  if (!(content instanceof Y.XmlElement) || content.nodeName !== 'paragraph') return false;
  for (const [key, value] of Object.entries(content.getAttributes())) {
    if (!LOOKS.has(key) && String(value ?? '') !== 'false' && String(value ?? '') !== '') return false;
  }
  return content.toArray().every((c) => c instanceof Y.XmlText && c.toDelta().every((op: { insert?: unknown }) => op.insert === ''));
}

/** Los bloques de primer nivel de un documento. */
function topBlocks(doc: Y.Doc): Y.XmlElement[] {
  return rootGroups(doc).flatMap((g) => g.toArray().filter((n): n is Y.XmlElement => n instanceof Y.XmlElement && n.nodeName === CONTAINER));
}

/** El nivel de un título (`heading`), o 0 si el bloque no lo es. */
function headingLevel(block: Y.XmlElement): number {
  const content = block.toArray()[0];
  if (!(content instanceof Y.XmlElement) || content.nodeName !== 'heading') return 0;
  const n = Number(content.getAttribute('level'));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * Las anotaciones de las fotos de `block` (en B) ya están en A: cada forma de B, con su id y sus campos. Una foto que está
 * en las dos pero que B anotó y A no (o con otras formas) no es lo mismo: su bloque se copia y las anotaciones pasan (D715).
 */
function markupCovered(docA: Y.Doc, docB: Y.Doc, block: Y.XmlElement): boolean {
  const ids = new Set<string>();
  mediaIn(block, ids);
  if (!ids.size) return true;
  const fromB = snapshotMarkup(docB.getMap(PHOTO_MARKUP_MAP), ids);
  if (!fromB.length) return true;
  const inA = new Map(snapshotMarkup(docA.getMap(PHOTO_MARKUP_MAP), ids).map((p) => [p.fileId, new Map(p.shapes.map(([id, fields]) => [id, stable(fields)]))]));
  return fromB.every((p) => {
    const have = inA.get(p.fileId);
    return !!have && p.shapes.every(([id, fields]) => have.get(id) === stable(fields));
  });
}

/** Qué de B ya está en A: por bloque de primer nivel, si se saltea (idéntico en A, o un renglón en blanco). */
function classify(docA: Y.Doc, docB: Y.Doc): { all: Y.XmlElement[]; skip: boolean[]; blank: boolean[] } {
  const have = new Map<string, number>();
  for (const a of topBlocks(docA)) {
    const key = blockSignature(a);
    have.set(key, (have.get(key) ?? 0) + 1);
  }
  const all = topBlocks(docB);
  const blank = all.map(isBlank);
  const skip = all.map((b, i) => {
    if (blank[i]) return true;
    const key = blockSignature(b);
    const n = have.get(key) ?? 0;
    if (n > 0 && markupCovered(docA, docB, b)) {
      have.set(key, n - 1);
      return true;
    }
    return false;
  });
  // Un título que está en las dos se saltea solo si TODO lo de su sección también (hasta el próximo título de su nivel o
  // de uno más alto): si algo de abajo se copia, el título viaja con eso. Si no, lo escrito bajo «Escena 105_027» llegaría a A
  // debajo del separador y la escena dejaría de verlo como suyo (D713). De atrás para adelante: los de adentro antes.
  const level = all.map(headingLevel);
  for (let i = all.length - 1; i >= 0; i--) {
    if (!level[i] || !skip[i] || blank[i]) continue;
    for (let j = i + 1; j < all.length && !(level[j] && level[j] <= level[i]); j++) {
      if (!skip[j]) {
        skip[i] = false;
        break;
      }
    }
  }
  return { all, skip, blank };
}

/**
 * Lo de B que hay que copiar a A (D707): los bloques de primer nivel de B menos los que A ya tiene idénticos (la misma
 * firma, contando cuántos; es lo de la plantilla que las dos traen, o lo que una unión anterior ya copió: *Restore* y unir
 * otra vez) y menos los renglones en blanco del principio o del final. Un título idéntico va con su sección si algo de ella
 * se copia (D713) y una foto con anotaciones que A no tiene también (D715). Nada de B se pierde: lo que no se copia está
 * igual en A, o es un renglón en blanco.
 */
export function blocksToCopy(docA: Y.Doc, docB: Y.Doc): Y.XmlElement[] {
  const { all, skip, blank } = classify(docA, docB);
  const first = skip.findIndex((x) => !x);
  let last = skip.length - 1;
  while (last >= 0 && skip[last]) last--;
  if (first < 0) return [];
  // Los renglones en blanco de en medio se copian: el ritmo de B queda como estaba.
  return all.filter((_b, i) => i >= first && i <= last && (!skip[i] || blank[i]));
}

/** Las firmas de lo de B que se saltea porque A ya lo tiene (sin los renglones en blanco), para volver a mirar después (D714). */
export function skippedSignatures(docA: Y.Doc, docB: Y.Doc): string[] {
  const { all, skip, blank } = classify(docA, docB);
  return all.flatMap((b, i) => (skip[i] && !blank[i] ? [blockSignature(b)] : []));
}

/** Cuántas de esas firmas (contando cuántas veces) A ya no tiene entre sus bloques de primer nivel. */
export function missingFrom(docA: Y.Doc, signatures: readonly string[]): number {
  const have = new Map<string, number>();
  for (const a of topBlocks(docA)) {
    const key = blockSignature(a);
    have.set(key, (have.get(key) ?? 0) + 1);
  }
  let missing = 0;
  for (const sig of signatures) {
    const n = have.get(sig) ?? 0;
    if (n > 0) have.set(sig, n - 1);
    else missing++;
  }
  return missing;
}

export interface CopyPlan {
  /** Los ids de B (a cualquier profundidad, de lo que se copia) que A ya tiene: van con un id derivado (C4). */
  remap: string[];
  /** B no agrega nada (D646): no se copia nada. */
  nothing: boolean;
  /** Los archivos (`sdmedia://`) de lo que se copia. */
  photos: string[];
  /** Cuántos bloques de primer nivel con algo se copian. */
  blocks: number;
}

function idsIn(block: Y.XmlElement, out: Set<string>): void {
  if (block.nodeName === CONTAINER) {
    const id = block.getAttribute('id');
    if (typeof id === 'string') out.add(id);
  }
  for (const c of block.toArray()) if (c instanceof Y.XmlElement) idsIn(c, out);
}

/** Lo que hay que saber de las dos antes de unir: qué se copia, qué ids de B ya están en A y si B no agrega nada. */
export function planCopy(docA: Y.Doc, docB: Y.Doc): CopyPlan {
  const list = blocksToCopy(docA, docB);
  const inA = blockIds(docA);
  const ids = new Set<string>();
  for (const b of list) idsIn(b, ids);
  const photos = new Set<string>();
  for (const b of list) mediaIn(b, photos);
  return { remap: [...ids].filter((id) => inA.has(id)), nothing: list.length === 0, photos: [...photos], blocks: list.filter((b) => !isBlank(b)).length };
}

/**
 * Una copia de un elemento de B con los ids de `remap` cambiados por el derivado (`copyType` copia todo lo demás igual).
 * Anota cada id viejo con el nuevo (para los colapsados).
 */
function copyMapped<T extends Y.XmlElement | Y.XmlText>(type: T, mapId: (id: string) => string, ids: Map<string, string>): T {
  if (type instanceof Y.XmlText) return copyType(type);
  const copy = new Y.XmlElement(type.nodeName);
  for (const [key, value] of Object.entries(type.getAttributes())) {
    if (key === 'id' && type.nodeName === CONTAINER && typeof value === 'string') {
      const next = mapId(value);
      ids.set(value, next);
      copy.setAttribute(key, next);
    } else copy.setAttribute(key, value as never);
  }
  const children = type.toArray().map((child) => (child instanceof Y.XmlHook ? child.clone() : copyMapped(child as Y.XmlElement | Y.XmlText, mapId, ids)));
  copy.insert(0, children as (Y.XmlElement | Y.XmlText)[]);
  return copy as T;
}

/**
 * El título 1 separador (D645), armado con el editor de la app en un documento aparte (así tiene los atributos que el
 * esquema espera) y copiado. `id`: `separatorId(clave de la unión)`.
 */
export function separatorBlock(text: string, id: string): Y.XmlElement {
  const tmp = new Y.Doc();
  try {
    withEditor(tmp, (editor) => {
      editor.replaceBlocks(editor.document, [{ id, type: 'heading', props: { level: 1 }, content: text }] as never);
    });
    for (const root of rootGroups(tmp)) {
      for (const child of root.toArray()) {
        if (child instanceof Y.XmlElement && child.nodeName === CONTAINER && child.getAttribute('id') === id) return copyType(child);
      }
    }
    throw new Error('separator not built');
  } finally {
    tmp.destroy();
  }
}

/**
 * Copia lo de B al final de A (ver arriba). `already`: A ya tiene el separador de esta unión (se copió antes: retomar no
 * duplica). `empty`: B no tiene bloques.
 */
export function copyIntoDoc(
  docA: Y.Doc,
  docB: Y.Doc,
  /** `from`: la clave de la unión (`copyKey`: la página que se va y el id de la unión). */
  opts: { from: string; remap: readonly string[]; separator: () => Y.XmlElement },
): CopyRecord | 'already' | 'empty' {
  // (Un elemento recién armado todavía no está en ningún documento: sus atributos no se leen. Los ids salen de B.)
  const sepId = separatorId(opts.from);
  if (blockIds(docA).has(sepId)) return 'already';
  // Lo que A ya tiene idéntico no se copia otra vez (D707); los ids de lo que sí, aunque el plan no los haya dicho, no se repiten.
  const blocks = blocksToCopy(docA, docB);
  if (!blocks.length) return 'empty';
  const remap = new Set(opts.remap);
  {
    const inA = blockIds(docA);
    const wanted = new Set<string>();
    for (const b of blocks) idsIn(b, wanted);
    for (const id of wanted) if (inA.has(id)) remap.add(id);
  }
  const mapId = (id: string) => (remap.has(id) ? derivedId(opts.from, id) : id);
  const photos = new Set<string>();
  for (const b of blocks) mediaIn(b, photos);
  const ids = new Map<string, string>();
  const record: CopyRecord = { client: 0, from: 0, to: 0, ids: [], photos: [...photos], markupSkipped: [] };
  docA.transact(() => {
    record.client = docA.clientID;
    record.from = Y.getState(docA.store, docA.clientID);
    let root = rootGroups(docA)[0];
    if (!root) {
      root = new Y.XmlElement(GROUP);
      docA.getXmlFragment(CONTENT_FRAGMENT).insert(0, [root]);
    }
    const copies = blocks.map((b) => copyMapped(b, mapId, ids));
    root.insert(root.length, [opts.separator(), ...copies]);
    record.ids = [sepId, ...blocks.map((b) => mapId(String(b.getAttribute('id'))))];
    // Las anotaciones de las fotos copiadas, con las reglas de pegar (mismas claves, el marco solo si falta, topes).
    if (photos.size) {
      const carried = carryMarkup(docA, snapshotMarkup(docB.getMap(PHOTO_MARKUP_MAP), photos), photos, MERGE_ORIGIN);
      record.markupSkipped = carried.skipped.filter((s) => s.reason !== 'notInContent').map((s) => s.fileId);
    }
    // Los títulos colapsados para todos (por id de bloque), con el id que quedó en A.
    const collapsedB = docB.getMap<unknown>(SHARED_COLLAPSE_MAP);
    const collapsedA = docA.getMap<unknown>(SHARED_COLLAPSE_MAP);
    for (const [old, next] of ids) if (collapsedB.get(old) === true && collapsedA.get(next) !== true) collapsedA.set(next, true);
    record.to = Y.getState(docA.store, docA.clientID);
  }, MERGE_ORIGIN);
  return record;
}

/** El item es de la copia: su autor y todos sus relojes adentro del rango. */
const ofCopy = (item: Y.Item, rec: Pick<CopyRecord, 'client' | 'from' | 'to'>) =>
  item.id.client === rec.client && item.id.clock >= rec.from && item.id.clock + item.length <= rec.to;

/**
 * Un tipo de Yjs sigue como lo dejó la copia: él mismo, cada valor de su mapa (atributos) con lo que tuvo antes, y cada
 * item de su lista (hijos, texto, formatos), son de la copia y ninguno está borrado. Lo de adentro, igual.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cualquier tipo de Yjs (elemento, texto, mapa)
export function intactCopy(type: Y.AbstractType<any>, rec: Pick<CopyRecord, 'client' | 'from' | 'to'>): boolean {
  const own = type._item;
  if (!own || own.deleted || !ofCopy(own, rec)) return false;
  for (const latest of type._map.values()) {
    if (latest.deleted) return false;
    for (let it: Y.Item | null = latest; it; it = it.left) if (!ofCopy(it, rec)) return false;
  }
  for (let it: Y.Item | null = type._start; it; it = it.right) {
    if (it.deleted || !ofCopy(it, rec)) return false;
    const inner = (it.content as { type?: unknown }).type;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (inner instanceof Y.AbstractType && !intactCopy(inner as Y.AbstractType<any>, rec)) return false;
  }
  return true;
}

/**
 * *Undo* de la copia (C5): saca de A, por id y en una transacción, los bloques de primer nivel de `rec` que siguen
 * intactos. El separador sale solo si no queda ningún bloque copiado. Lo que alguien tocó (o movió adentro de otro) queda:
 * `kept` dice cuántos.
 */
export function undoCopyInDoc(docA: Y.Doc, rec: CopyRecord): { removed: number; kept: number } {
  const root = rootGroups(docA)[0];
  if (!root) return { removed: 0, kept: 0 };
  const [sepId, ...copied] = rec.ids;
  const top = root.toArray().filter((n): n is Y.XmlElement => n instanceof Y.XmlElement && n.nodeName === CONTAINER);
  const remove: Y.XmlElement[] = [];
  let kept = 0;
  const anywhere = blockIds(docA);
  for (const id of copied) {
    // Puede haber dos con el mismo id (dos dispositivos unieron a la vez, C9): sale solo el de esta copia.
    const mine = top.filter((el) => el.getAttribute('id') === id && intactCopy(el, rec));
    if (mine.length) remove.push(...mine);
    else if (anywhere.has(id)) kept++;
  }
  const removed = remove.length;
  if (!kept) remove.push(...top.filter((el) => el.getAttribute('id') === sepId && intactCopy(el, rec)));
  if (remove.length) {
    docA.transact(() => {
      for (const el of remove) {
        const at = root.toArray().indexOf(el);
        if (at >= 0) root.delete(at, 1);
      }
    }, MERGE_ORIGIN);
  }
  return { removed, kept };
}
