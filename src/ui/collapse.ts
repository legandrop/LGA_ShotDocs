import type { Node as PMNode } from '@tiptap/pm/model';

// Colapsar secciones por sus títulos (P.11, Docs/Doc_Colapsar.md). Lo que es cálculo puro sobre el documento
// de ProseMirror: qué esconde cada título colapsado. Nada de esto cambia el documento.
//
// Una sección: para un `heading` de nivel N, sus propios hijos (anidados) y los hermanos que siguen en su
// grupo, hasta el primer hermano que sea un título de nivel N o menor. Además (correcciones 12 y 19):
// - el último bloque de la página, si es un párrafo vacío, nunca se esconde (es el lugar para seguir
//   escribiendo);
// - un título colapsado puede tener un fin (`e`): el primer bloque que se ve después de lo escondido (lo pone
//   Enter al final del título). Desde ahí se ve todo, aunque por la regla de los niveles sería de la sección.

/** Lo guardado de un título, por persona y dispositivo (ver collapseStore.ts). */
export interface HeadingRecord {
  /** Colapsado para vos. */
  c: boolean;
  /** La marca de "para todos" que valía cuando se guardó (entrega 2; `null` hasta entonces). */
  g: string | null;
  /** El fin: el id del primer bloque que se ve después de lo escondido. */
  e?: string;
}

export type Records = ReadonlyMap<string, HeadingRecord>;

/** Lo que se ve: colapsado para vos. (En la entrega 2 entra "para todos", con la regla de Doc_Colapsar.md §4.) */
export function isCollapsed(record: HeadingRecord | undefined): boolean {
  return record?.c === true;
}

export interface BlockAt {
  node: PMNode;
  /** La posición antes del `blockContainer`. */
  pos: number;
}

export interface Analysis {
  /** Todos los bloques (`blockContainer`) por id (vacío si no hay nada colapsado). */
  blocks: Map<string, BlockAt>;
  /** Los bloques escondidos, con el título colapsado de más afuera que los esconde (el que se ve). */
  hidden: Map<string, string>;
  /** Los títulos colapsados (con o sin algo que esconder, visibles o no). */
  collapsed: Set<string>;
  /** Los bloques escondidos de más afuera (hermanos de un título que se ve): los que se decoran. */
  top: { id: string; pos: number; size: number; hider: string }[];
}

export function headingLevel(container: PMNode): number | null {
  const content = container.firstChild;
  if (!content || content.type.name !== 'heading') return null;
  const level = Number(content.attrs.level);
  return Number.isFinite(level) ? level : 1;
}

/** El grupo de hijos de un bloque (`blockGroup`), si tiene. */
function childGroup(container: PMNode): PMNode | null {
  const last = container.lastChild;
  return container.childCount > 1 && last?.type.name === 'blockGroup' ? last : null;
}

function isEmptyParagraph(container: PMNode): boolean {
  const content = container.firstChild;
  return !!content && content.type.name === 'paragraph' && content.content.size === 0 && !childGroup(container);
}

/**
 * Hasta dónde llega (sin incluirlo) lo que esconde el título `kids[index]`, de nivel `level`, en su grupo.
 * `end`: el fin guardado. `root`: el grupo de la página (ahí el último párrafo vacío no se esconde).
 */
export function runEnd(kids: readonly PMNode[], index: number, level: number, end: string | undefined, root: boolean): number {
  for (let k = index + 1; k < kids.length; k++) {
    const kid = kids[k];
    const l = headingLevel(kid);
    if (l !== null && l <= level) return k;
    if (end !== undefined && kid.attrs.id === end) return k;
    if (root && k === kids.length - 1 && isEmptyParagraph(kid)) return k;
  }
  return kids.length;
}

function childrenOf(group: PMNode): PMNode[] {
  const kids: PMNode[] = [];
  group.forEach((n) => kids.push(n));
  return kids;
}

/** Recorre la estructura de la página (sin entrar al texto) y calcula qué se esconde. */
export function analyze(doc: PMNode, records: Records): Analysis {
  const out: Analysis = { blocks: new Map(), hidden: new Map(), collapsed: new Set(), top: [] };
  // Sin nada colapsado no hay nada que calcular (cada tecla pasa por acá).
  if (records.size === 0) return out;
  const root = doc.firstChild;
  if (root && root.type.name === 'blockGroup') walk(root, 0, null, true, records, out);
  return out;
}

function walk(group: PMNode, groupPos: number, hiddenBy: string | null, root: boolean, records: Records, out: Analysis) {
  const kids = childrenOf(group);
  const positions: number[] = [];
  let at = groupPos + 1;
  for (const kid of kids) {
    positions.push(at);
    at += kid.nodeSize;
  }
  let hiderHere: string | null = null;
  let until = -1;
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i];
    const pos = positions[i];
    const id = String(kid.attrs.id ?? '');
    if (hiderHere !== null && i >= until) hiderHere = null;
    const hider = hiddenBy ?? hiderHere;
    if (id) {
      out.blocks.set(id, { node: kid, pos });
      if (hider) {
        out.hidden.set(id, hider);
        if (!hiddenBy) out.top.push({ id, pos, size: kid.nodeSize, hider });
      }
    }
    const level = headingLevel(kid);
    const record = id ? records.get(id) : undefined;
    const collapsed = level !== null && isCollapsed(record);
    if (collapsed) out.collapsed.add(id);
    if (collapsed && !hider) {
      hiderHere = id;
      until = runEnd(kids, i, level, record?.e, root);
    }
    const children = childGroup(kid);
    if (children) {
      const childrenPos = pos + 1 + kid.firstChild!.nodeSize;
      walk(children, childrenPos, hider ?? (collapsed ? id : null), false, records, out);
    }
  }
}

export interface Section {
  /** El título. */
  heading: BlockAt;
  /** El grupo del título y su posición. */
  group: PMNode;
  groupPos: number;
  /** El lugar del título en su grupo, y hasta dónde llega lo que esconde (sin incluirlo). */
  index: number;
  end: number;
  /** Los hermanos que esconde, con su posición. */
  siblings: BlockAt[];
  /** Dónde termina lo escondido (después del último hermano escondido, o del título si no hay). */
  after: number;
}

/**
 * La sección de un título (colapsado o no) tal como la esconde `record`: los hermanos que siguen hasta el
 * próximo título de su nivel o mayor, el fin o el último párrafo vacío de la página.
 */
export function sectionAt(doc: PMNode, headingPos: number, record: HeadingRecord | undefined): Section | null {
  const heading = doc.nodeAt(headingPos);
  if (!heading || heading.type.name !== 'blockContainer') return null;
  const level = headingLevel(heading);
  if (level === null) return null;
  const $pos = doc.resolve(headingPos);
  const group = $pos.parent;
  if (group.type.name !== 'blockGroup') return null;
  if ($pos.depth < 1) return null;
  const groupPos = $pos.before();
  const kids = childrenOf(group);
  const index = $pos.index();
  const root = $pos.depth === 1;
  const end = runEnd(kids, index, level, record?.e, root);
  const siblings: BlockAt[] = [];
  let pos = headingPos + heading.nodeSize;
  for (let k = index + 1; k < end; k++) {
    siblings.push({ node: kids[k], pos });
    pos += kids[k].nodeSize;
  }
  return { heading: { node: heading, pos: headingPos }, group, groupPos, index, end, siblings, after: pos };
}

/** Si un título colapsado esconde algo (hijos o hermanos). */
export function hidesSomething(section: Section | null): boolean {
  return !!section && (section.siblings.length > 0 || !!childGroup(section.heading.node));
}

/** El fin del texto de un título (dentro del `heading`), para poner la selección. */
export function headingTextEnd(heading: BlockAt): number {
  const content = heading.node.firstChild!;
  return heading.pos + 1 + 1 + content.content.size;
}

/** Los títulos de la página (id y nivel), en orden. */
export function headingsOf(doc: PMNode): { id: string; level: number }[] {
  const out: { id: string; level: number }[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'blockContainer') {
      const level = headingLevel(node);
      if (level !== null && node.attrs.id) out.push({ id: String(node.attrs.id), level });
      return true;
    }
    return node.type.name === 'blockGroup' || node.type.name === 'doc';
  });
  return out;
}
