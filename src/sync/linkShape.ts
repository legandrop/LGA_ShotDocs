import * as Y from 'yjs';
import { STABLE_GAPS_MARKER } from '../ui/unknownContent';
import { CONTENT_FRAGMENT } from './structure';

// El paso 8 de la admisión de lo que escribe un link público (Docs/Doc_Link_Publico.md, E2.3, B3 de la auditoría):
// "forma y valores". Lo que una fila del link agrega o cambia en el contenido de la página tiene que poder dibujarlo el
// editor del equipo: en `document-store` solo hay `XmlElement` y `XmlText` (nada de `Y.Map`, `Y.Array` ni valores
// sueltos, en ningún nivel); cada atributo nuevo o cambiado de un nodo es uno que el esquema de esta versión le da a su
// tipo, con su tipo de valor (texto, número o sí/no) y, si el esquema tiene una lista, uno de esa lista; las marcas del
// texto, con el valor que espera cada una. La auditoría encontró tres filas armadas a mano que pasaban los demás pasos y
// hacían tirar al editor real (un `Y.Map` adentro de un párrafo; el `level` de un encabezado como objeto o como 'x y').
//
// Es Yjs puro: no carga el editor (como `ui/unknownContent.ts`). La lista está escrita a mano, sacada del esquema de esta
// versión (`ui/editorSchema.ts`); una prueba (`linkShape.test.ts`) la compara con el esquema real: si el esquema cambia,
// falla hasta actualizarla.

/** Cómo es el valor de un atributo. */
export interface AttrRule {
  type: 'string' | 'number' | 'boolean' | 'colwidth';
  /** Los únicos valores que acepta (el `values` del esquema). */
  values?: readonly (string | number)[];
  /** Acepta `null` (el valor por defecto del esquema es nulo o no tiene). */
  nullable?: boolean;
}

const ALIGN: AttrRule = { type: 'string', values: ['left', 'center', 'right', 'justify'] };
const STR: AttrRule = { type: 'string' };
const NUM: AttrRule = { type: 'number' };
const BOOL: AttrRule = { type: 'boolean' };
const COLORS = { backgroundColor: STR, textColor: STR };
const BLOCK = { ...COLORS, textAlignment: ALIGN };

/**
 * Los atributos de cada nodo que el editor guarda en Yjs. Los bloques (paragraph, heading…) con su `propSchema`; los
 * demás (el contenedor, la tabla y sus celdas, la foto en línea), con los atributos de su nodo de ProseMirror.
 */
export const NODE_ATTRS: Readonly<Record<string, Readonly<Record<string, AttrRule>>>> = {
  blockGroup: {},
  blockContainer: { id: STR },
  paragraph: { ...BLOCK, script: BOOL, question: BOOL, driveCard: BOOL, pageBreak: BOOL },
  heading: { ...BLOCK, level: { type: 'number', values: [1, 2, 3, 4, 5, 6] }, isToggleable: BOOL },
  bulletListItem: BLOCK,
  numberedListItem: { ...BLOCK, start: { type: 'number', nullable: true } },
  checkListItem: { ...BLOCK, checked: BOOL },
  toggleListItem: BLOCK,
  quote: COLORS,
  codeBlock: { language: STR },
  divider: {},
  image: {
    textAlignment: ALIGN,
    backgroundColor: STR,
    name: STR,
    url: STR,
    caption: STR,
    showPreview: BOOL,
    previewWidth: { type: 'number', nullable: true },
    rowWidth: NUM,
  },
  table: { textColor: STR, thumbHeight: NUM },
  tableRow: {},
  tableCell: { ...BLOCK, colspan: NUM, rowspan: NUM, colwidth: { type: 'colwidth', nullable: true } },
  tableHeader: { ...BLOCK, colspan: NUM, rowspan: NUM, colwidth: { type: 'colwidth', nullable: true } },
  tableParagraph: {},
  hardBreak: {},
  // La foto en línea (inlinePhoto.ts): `rowStart` solo `true` o nada.
  photo: { url: STR, name: STR, w: NUM, rowStart: { type: 'boolean', nullable: true } },
  // La marca de los renglones con fotos en línea (el parche de y-prosemirror): un elemento vacío.
  [STABLE_GAPS_MARKER]: {},
};

/** El valor de cada marca en el texto (`XmlText`, como lo guarda y-prosemirror: los atributos de la marca). */
export const MARK_ATTRS: Readonly<Record<string, Readonly<Record<string, AttrRule>>>> = {
  bold: {},
  italic: {},
  underline: {},
  strike: {},
  code: {},
  textColor: { stringValue: STR },
  backgroundColor: { stringValue: STR },
  link: { href: STR },
};

// Como y-prosemirror: una marca que puede repetirse se guarda como "nombre--hash".
const hashedMark = /(.*)(--[a-zA-Z0-9+/=]{8})$/;
const DIGITS = /^-?\d{1,9}(\.\d{1,9})?$/;

/** Si `value` cumple la regla. `undefined` siempre vale: es "sin valor" (el editor guarda así un número sin poner). */
export function valueOk(rule: AttrRule, value: unknown): boolean {
  if (value === undefined) return true;
  if (value === null) return rule.nullable === true;
  switch (rule.type) {
    case 'string':
      return typeof value === 'string' && (!rule.values || rule.values.includes(value));
    case 'boolean':
      return typeof value === 'boolean';
    case 'number': {
      // Un número puede llegar como texto de dígitos (un pegado de HTML): vale si su valor vale.
      const n = typeof value === 'number' ? value : typeof value === 'string' && DIGITS.test(value) ? Number(value) : NaN;
      return Number.isFinite(n) && (!rule.values || rule.values.includes(n));
    }
    case 'colwidth':
      // El ancho de las columnas de una celda (lo que guarda el editor al achicarla, R3 de la re-verificación).
      // Una celda de varias columnas lleva un ancho por columna, nulo (o sin valor) si esa columna no tiene uno propio.
      return Array.isArray(value) && value.length <= 1000 && value.every((w) => w == null || (typeof w === 'number' && Number.isFinite(w) && w >= 0));
  }
}

/** El valor de una marca en el texto: `null` (se saca la marca), `true` o un objeto con los atributos que espera. */
function markOk(name: string, value: unknown): boolean {
  const attrs = MARK_ATTRS[hashedMark.exec(name)?.[1] ?? name];
  if (!attrs) return false;
  if (value === null || value === undefined) return true;
  if (value === true) return Object.keys(attrs).length === 0;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const rule = attrs[key];
    if (!rule || !valueOk(rule, v)) return false;
  }
  // La que tiene atributos (color, link) los tiene que traer.
  return Object.keys(attrs).every((k) => (value as Record<string, unknown>)[k] !== undefined);
}

/** Un valor, corto, para el motivo (la consola del editor que aparta). */
function preview(value: unknown): string {
  try {
    return (JSON.stringify(value) ?? String(value)).slice(0, 60);
  } catch {
    return typeof value;
  }
}

/** La clave del tipo raíz de un elemento, o `null` si no se sabe. */
function rootOf(item: Y.Item): string | null {
  let type = item.parent as Y.AbstractType<unknown> | null;
  while (type && type._item) type = type._item.parent as Y.AbstractType<unknown> | null;
  if (!type || !type.doc) return null;
  try {
    return Y.findRootTypeKey(type);
  } catch {
    return null;
  }
}

/** Por qué un elemento nuevo del contenido no tiene la forma, o `null` si la tiene. */
function itemProblem(item: Y.Item): string | null {
  const parent = item.parent;
  const content = item.content;
  if (item.parentSub !== null) {
    // Un atributo: solo en un nodo (`XmlElement`), con un valor simple, de un atributo que el nodo tiene.
    if (!(parent instanceof Y.XmlElement)) return 'attribute outside a node';
    const rules = NODE_ATTRS[parent.nodeName];
    if (!rules) return `node "${parent.nodeName}"`;
    const rule = rules[item.parentSub];
    if (!rule) return `attribute "${parent.nodeName}.${item.parentSub}"`;
    if (!(content instanceof Y.ContentAny) || content.arr.length !== 1) return `attribute "${item.parentSub}" is not a value`;
    if (!valueOk(rule, content.arr[0])) return `value of "${parent.nodeName}.${item.parentSub}": ${preview(content.arr[0])}`;
    return null;
  }
  if (parent instanceof Y.XmlText) {
    // Adentro del texto: letras y marcas; nada embebido.
    if (content instanceof Y.ContentString) return null;
    if (content instanceof Y.ContentFormat) return markOk(content.key, content.value) ? null : `mark "${content.key}"`;
    return 'something embedded in a text';
  }
  if (parent instanceof Y.XmlElement || parent instanceof Y.XmlFragment) {
    // Hijos de un nodo o de la raíz: solo nodos y textos (nada de mapas, listas ni valores sueltos).
    if (!(content instanceof Y.ContentType)) return 'a loose value';
    const type = content.type;
    if (type instanceof Y.XmlElement) return NODE_ATTRS[type.nodeName] ? null : `node "${type.nodeName}"`;
    if (type instanceof Y.XmlText) return null;
    return 'a map or a list';
  }
  return 'unknown parent';
}

/**
 * Lo primero que tiene mal la forma entre lo que agregó la última fila aplicada a `doc` (los elementos de cada autor
 * desde `before`, el vector de estado de antes de aplicarla), o `null` si todo está bien. Mira solo el contenido de la
 * página (`document-store`): el colapsar para todos y las anotaciones de fotos ya se leen como entrada no confiable. Lo
 * borrado en la misma fila no se dibuja: no se mira.
 */
export function shapeProblem(doc: Y.Doc, before: Map<number, number>): string | null {
  for (const [client, structs] of doc.store.clients) {
    const from = before.get(client) ?? 0;
    const last = structs[structs.length - 1];
    if (!last || last.id.clock + last.length <= from) continue;
    let i = from === 0 ? 0 : Y.findIndexSS(structs, Math.max(from, structs[0].id.clock));
    for (; i < structs.length; i++) {
      const s = structs[i];
      if (!(s instanceof Y.Item) || s.deleted) continue;
      if (s.id.clock + s.length <= from) continue;
      if (rootOf(s) !== CONTENT_FRAGMENT) continue;
      const problem = itemProblem(s);
      if (problem) return problem;
    }
  }
  return null;
}

/** Los valores de `url` que tiene el contenido (para saber cuáles son nuevos). */
export function urlsInDoc(doc: Y.Doc): Set<string> {
  const out = new Set<string>();
  const stack: unknown[] = doc.getXmlFragment(CONTENT_FRAGMENT).toArray();
  while (stack.length > 0) {
    const item = stack.pop();
    if (!(item instanceof Y.XmlElement)) continue;
    const url = item.getAttribute('url') as unknown;
    if (typeof url === 'string' && url !== '') out.add(url);
    stack.push(...item.toArray());
  }
  return out;
}
