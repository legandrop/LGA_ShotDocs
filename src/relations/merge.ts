import type { IndexedContent } from '../search/projectIndex';
import type { PageRow } from '../sync/types';

// *Merge* de dos páginas de la misma escena o de dos reportes del mismo día (Docs/Doc_Relaciones.md, sección 20; E16,
// alcance reducido de la auditoría del plan). Lo puro: el puntero de la página unida, las guardas que se pueden mirar sin
// red, qué agrega una página a la otra y lo que *Map › Pending* lista después.
//
// Merge solo agrega: lo de la página que se va (B) se copia al final de la que queda (A) y B va entera a la papelera con
// un puntero `settings.merged` (D641). El puntero es solo una pista: nadie en la base confía en él, y vale solo si B está
// en la papelera y su destino está vivo (C2). Una versión vieja que hace *Restore* de B lo deja sin efecto: las dos vuelven
// a listarse como repetidas.

/** El puntero que deja *Merge* en la página que se fue: a cuál se unió y hasta qué `seq` de su contenido se copió. */
export interface MergedPointer {
  into: string;
  /** El `update_seq` de B que se copió: lo que llegue después se ve en *Pending* («changed after it was merged»). */
  seq: number;
  /** Cuándo (ISO). */
  at: string;
  /** Las subpáginas de B que ya se vieron (*Dismiss*): una nueva adentro de B también se lista. */
  kids?: string[];
}

/** Hasta cuántas uniones seguidas se siguen (B → A → C…). */
export const MAX_CHAIN = 5;

/** El puntero de una fila, si tiene la forma esperada (lo escribe cualquier editor de B: se valida siempre). */
export function readPointer(row: Pick<PageRow, 'settings'> | undefined): MergedPointer | null {
  const raw = (row?.settings as { merged?: unknown } | undefined)?.merged;
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.into !== 'string' || !p.into || typeof p.seq !== 'number' || !Number.isFinite(p.seq)) return null;
  const kids = Array.isArray(p.kids) ? p.kids.filter((k): k is string => typeof k === 'string') : undefined;
  return { into: p.into, seq: p.seq, at: typeof p.at === 'string' ? p.at : '', ...(kids ? { kids } : {}) };
}

export interface PointerTree {
  get(id: string): PageRow | undefined;
  isTrashed(id: string): boolean;
}

/**
 * A qué página viva lleva una que se unió (C2): B en la papelera (ella misma, no por una carpeta), con un puntero a una
 * página que la persona ve, del mismo proyecto, distinta de B y viva; si esa también se unió (en la papelera con su
 * puntero), se sigue, hasta `MAX_CHAIN`. Cualquier otra cosa: `null` (el puntero no vale).
 */
export function mergedTarget(tree: PointerTree, id: string): string | null {
  const start = tree.get(id);
  if (!start) return null;
  const seen = new Set<string>([id]);
  let row = start;
  for (let hop = 0; hop < MAX_CHAIN; hop++) {
    if (!row.deleted_at) return null;
    const p = readPointer(row);
    if (!p || seen.has(p.into)) return null;
    const next = tree.get(p.into);
    if (!next || next.workspace_id !== start.workspace_id) return null;
    if (!tree.isTrashed(next.id)) return next.id;
    seen.add(next.id);
    row = next;
  }
  return null;
}

/** Las páginas unidas del proyecto (en la papelera, con un puntero que vale) y a cuál llevan. */
export function mergedPages(tree: PointerTree & { trashed(projectId?: string): PageRow[] }, projectId: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of tree.trashed(projectId)) {
    if (!readPointer(row)) continue;
    const to = mergedTarget(tree, row.id);
    if (to) out.set(row.id, to);
  }
  return out;
}

// --- Qué tiene cada página (qué agrega una a la otra lo dice `planCopy`, con los documentos: D646, D707) ---------

/** Cuántos bloques y fotos tiene lo leído de una página (para el adelanto). */
export function contentCounts(content: Pick<IndexedContent, 'units' | 'meta'> | undefined): { blocks: number; photos: number } {
  if (!content) return { blocks: 0, photos: 0 };
  const blocks = new Set<string>();
  for (const u of content.units) if (u.text.trim()) blocks.add(u.blockId);
  let photos = 0;
  for (const m of content.meta) {
    if (m.media?.length) {
      blocks.add(m.blockId);
      photos += m.media.length;
    }
  }
  return { blocks: blocks.size, photos };
}

// --- Las guardas que se miran sin red (§5.4 del plan, ajustadas) ---------------------------------------------------

export type MergeBlock =
  /** No están las dos, alguna está en la papelera, son la misma o una adentro de la otra (M4). */
  | 'gone'
  | 'inside'
  /** Sin red o sin una sincronización buena (M2, D653). */
  | 'offline'
  /** Puede ser que otra gente vea una y no la otra (M8, C6). */
  | 'audience'
  /** La que se va tiene comentarios (M9); `bothComments`: las dos (no se puede elegir otra). */
  | 'comments'
  | 'bothComments';

export interface MergeGuardContext {
  tree: PointerTree & { isDescendant(id: string, ofId: string): boolean };
  /** Puede crear, mover y mandar a la papelera las dos (nivel 4) y no es invitado ni lector de base limpia (M1). */
  canMerge(pageId: string): boolean;
  sync: { online: boolean; lastSyncAt: number | null };
}

/** Quién puede ver el botón: nivel 4 en las dos y nunca un invitado (M1). Quien no puede, no ve *Merge*. */
export function canOffer(ctx: Pick<MergeGuardContext, 'canMerge'>, pageIds: readonly string[]): boolean {
  return pageIds.length >= 2 && pageIds.every((id) => ctx.canMerge(id));
}

/**
 * Lo que dice el adelanto debajo de las dos tarjetas (D708): mientras une, solo si la red se cortó (O10: antes decía «conectate
 * para unir» con el botón en «Uniendo…», y lo demás cambia a medida que avanza la unión); si no, el motivo de lo que impide unir.
 */
export function dialogHint(busy: boolean, block: MergeBlock | 'commentsUnknown' | 'checking' | null): 'wait' | MergeBlock | 'commentsUnknown' | 'checking' | null {
  if (!busy) return block;
  return block === 'offline' ? 'wait' : null;
}

/** Las guardas de la unión de `gone` en `keep` que se miran en el momento (las de red las mira el trabajo). */
export function mergeGuard(ctx: MergeGuardContext, keep: string, gone: string): MergeBlock | null {
  const { tree } = ctx;
  if (keep === gone || !tree.get(keep) || !tree.get(gone) || tree.isTrashed(keep) || tree.isTrashed(gone)) return 'gone';
  if (tree.get(keep)!.workspace_id !== tree.get(gone)!.workspace_id) return 'gone';
  if (tree.isDescendant(keep, gone) || tree.isDescendant(gone, keep)) return 'inside';
  if (!ctx.sync.online || ctx.sync.lastSyncAt === null) return 'offline';
  return null;
}

/** Lo que se sabe de quién ve una página (para C6): permisos propios de página (en ella o arriba) y un link público. */
export interface AudienceInfo {
  ownGrants: boolean;
  publicLink: boolean;
}

/**
 * M8 local y conservadora (C6): se puede unir si las dos tienen el mismo padre (la misma gente las ve), o si quien une es
 * dueño o admin y ninguna de las dos (ni nada de arriba) tiene permisos de página propios ni un link público. Sin poder
 * saberlo (`null`), no.
 */
export function audienceOk(
  tree: PointerTree,
  role: string | null,
  a: string,
  b: string,
  info: { a: AudienceInfo | null; b: AudienceInfo | null } | null,
): boolean {
  if ((tree.get(a)?.parent_id ?? null) === (tree.get(b)?.parent_id ?? null)) return true;
  if (role !== 'owner' && role !== 'admin') return false;
  if (!info?.a || !info.b) return false;
  return !info.a.ownGrants && !info.a.publicLink && !info.b.ownGrants && !info.b.publicLink;
}

/**
 * Cuál queda por defecto (D644, con M9): la que tiene comentarios (la que se va no puede tener); si una no agrega nada a
 * la otra, queda la otra; si no, la primera (la del árbol, que ya usan las relaciones). `null` si las dos tienen
 * comentarios.
 */
export function defaultKeep(pair: readonly [string, string], o: { comments: (id: string) => number; nothing: (from: string, into: string) => boolean }): string | null {
  const [first, second] = pair;
  const c1 = o.comments(first) > 0;
  const c2 = o.comments(second) > 0;
  if (c1 && c2) return null;
  if (c1) return first;
  if (c2) return second;
  if (o.nothing(second, first)) return first;
  if (o.nothing(first, second)) return second;
  return first;
}

// --- Lo que *Map › Pending* lista después (C3, punto 3; C9) ---------------------------------------------------------

export type MergeRow =
  /** B cambió después de unirse (otro dispositivo, una versión vieja): *Open* y *Dismiss*. */
  | { kind: 'changed'; from: string; into: string; kids: string[] }
  /** La página a la que se unió está en la papelera (dos uniones cruzadas a la vez, C9 b): *Restore*. */
  | { kind: 'intoTrashed'; from: string; into: string };

/** Las filas de *Pending* de las uniones: lo que llegó tarde a una página unida y las uniones a una página que ya no está. */
export function mergeRows(tree: PointerTree & { trashed(projectId?: string): PageRow[]; children(parentId: string | null): PageRow[] }, projectId: string): MergeRow[] {
  const out: MergeRow[] = [];
  for (const row of tree.trashed(projectId)) {
    const p = readPointer(row);
    if (!p) continue;
    const to = mergedTarget(tree, row.id);
    if (!to) {
      const into = tree.get(p.into);
      if (into && into.workspace_id === row.workspace_id && tree.isTrashed(into.id)) out.push({ kind: 'intoTrashed', from: row.id, into: p.into });
      continue;
    }
    const kids = tree.children(row.id).map((c) => c.id).filter((id) => !(p.kids ?? []).includes(id));
    if ((row.update_seq ?? 0) > p.seq || kids.length) out.push({ kind: 'changed', from: row.id, into: to, kids });
  }
  return out;
}

/**
 * *Restore* de una página: si estaba unida, además se le saca el puntero (si después alguien la manda a la papelera a mano,
 * no tiene que leerse como unida). Una versión vieja restaura sin sacarlo: queda sin efecto mientras esté viva (C2).
 */
export async function restorePage(tree: { get(id: string): PageRow | undefined; restore(id: string): Promise<void>; setSetting(id: string, key: 'merged', value: undefined): Promise<void> }, id: string): Promise<void> {
  await tree.restore(id);
  if (readPointer(tree.get(id))) await tree.setSetting(id, 'merged', undefined);
}
