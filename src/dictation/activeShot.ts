import { labelKey, noteMentions, type PageMap } from './pageMap';
import type { Change } from './answer';

// El plano activo de *Dictate to report* (Docs/Doc_Dictado.md, 5.6 punto 3; entrega V4): la chapita *Shot: 12_010 ▾* de
// la hoja, que queda fija entre notas hasta cambiarla y se pone sola con el plano de lo último aplicado. En el set se
// filma un plano varios minutos: dictar tres notas seguidas sobre el mismo es lo normal. Va en el pedido como
// `ACTIVE_SHOT`, después de lo dicho y del cursor (DI4), y cuenta como señal propia para *Row chosen by the assistant*.
//
// Se guarda en el dispositivo por correo, workspace y página (`localStorage`): es una preferencia de la hoja, no un dato
// de la página, y no viaja a ningún lado.

/**
 * El nombre del plano de un rótulo: los dos primeros números (`12 · 010 · 3` → `12_010`, `Shot 12_010` → `12_010`), o el
 * texto si no tiene dos números (`Grúa`). `null` si no hay nada.
 */
export function shotKeyOf(label: string): string | null {
  const groups = label.match(/\d+/g);
  if (groups && groups.length >= 2) return `${groups[0]}_${groups[1]}`;
  const text = label.replace(/\s+/g, ' ').trim().slice(0, 40);
  return text || null;
}

/** Si dos nombres de plano son el mismo (`12_010` y `012_010`; `Grúa` y `grua`). */
export function sameShot(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false;
  return /\d/.test(a) || /\d/.test(b) ? noteMentions(a, b) && noteMentions(b, a) : labelKey(a) === labelKey(b);
}

const SHOT_LABELS = new Set(['shot', 'plano']);

/** En una página *Shot Breakdown*, el plano de la página: el valor de la fila *Shot* (o *Plano*) de su ficha. */
export function pageShot(map: PageMap): string | null {
  for (const table of map.tables) {
    if (!table.labelCol || table.cols !== 2) continue;
    for (const row of table.rows) {
      if (SHOT_LABELS.has(labelKey(row[0]?.plain ?? '')) && row[1]?.plain.trim()) return shotKeyOf(row[1].plain);
    }
    return null;
  }
  return null;
}

/**
 * Los planos de la página, en orden y sin repetir: los rótulos con dos números de las tablas con encabezado (la *Slate*
 * de *Setups & takes*) y las secciones de los planos (`Shot 12_010`).
 */
export function shotsOnPage(map: PageMap): string[] {
  const out: string[] = [];
  const add = (label: string) => {
    if ((label.match(/\d+/g)?.length ?? 0) < 2) return;
    const key = shotKeyOf(label);
    if (key && !out.some((s) => sameShot(s, key))) out.push(key);
  };
  for (const table of map.tables) {
    if (!table.headerRow) continue;
    for (const row of table.rows.slice(1)) add(row[0]?.plain ?? '');
  }
  for (const s of map.shots) if (s.name) add(s.name);
  return out;
}

/** El plano de un cambio aplicado (para la chapita): la *Slate* de su fila, o la sección del plano. */
export function shotOfChange(c: Change, map: PageMap): string | null {
  if (c.op === 'addShotSection') return c.shot ? shotKeyOf(c.shot) : null;
  if (c.op === 'addRow') return c.cells?.[0] ? numbered(c.cells[0]) : null;
  const t = c.target;
  if (!t) return null;
  if (t.kind === 'cell') {
    const table = map.tables.find((x) => x.n === t.table);
    if (!table?.headerRow) return null;
    // La *Slate* que escribió este mismo pedido en una fila vacía.
    return numbered(c.slate ?? t.rowLabel ?? '');
  }
  const shot = map.shots.find((s) => s.heading.addr === t.addr || s.checks.some((k) => k.addr === t.addr));
  if (!shot) return null;
  if (shot.name) return shotKeyOf(shot.name);
  // La sección vacía de la plantilla que este pedido renombró (`Shot ` → `Shot 12_010`).
  return c.op === 'setText' && c.after ? numbered(c.after) : null;
}

const numbered = (label: string) => ((label.match(/\d+/g)?.length ?? 0) >= 2 ? shotKeyOf(label) : null);

/** El plano que dejan los cambios aplicados: el primero que nombra uno (`null` si ninguno). */
export function shotOfApplied(changes: Change[], map: PageMap): string | null {
  for (const c of changes) {
    const s = shotOfChange(c, map);
    if (s) return s;
  }
  return null;
}

// --- Guardado en el dispositivo ---------------------------------------------------------------------------------------

const PREFIX = 'shotdocs-dictation-shot:';
const keyOf = (email: string, workspace: string, pageId: string) => `${PREFIX}${email.trim().toLowerCase()}|${workspace}|${pageId}`;

export function loadActiveShot(email: string, workspace: string, pageId: string): string | null {
  try {
    const v = localStorage.getItem(keyOf(email, workspace, pageId));
    return v && v.trim() ? v.slice(0, 40) : null;
  } catch {
    return null;
  }
}

export function saveActiveShot(email: string, workspace: string, pageId: string, shot: string | null): void {
  try {
    if (shot) localStorage.setItem(keyOf(email, workspace, pageId), shot.slice(0, 40));
    else localStorage.removeItem(keyOf(email, workspace, pageId));
  } catch {
    // Sin almacenamiento (modo privado): queda solo mientras la hoja está abierta.
  }
}
