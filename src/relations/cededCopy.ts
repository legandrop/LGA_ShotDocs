import type { PageTree } from '../sync/tree';
import type { PageRow, PageSettings } from '../sync/types';

// La copia que cede (D580, corregida por D626–D628): dos dispositivos crearon el reporte del mismo día a la vez y el de id
// mayor manda su página, todavía vacía, a la papelera. Un tercer dispositivo pudo abrirla y escribir en sus primeros
// segundos, y ese texto puede llegar al servidor después de la papelera: ninguna mirada antes de mandarla alcanza a verlo.
// Por eso la copia va con una marca (`settings.ceded`) y cualquier dispositivo que vea, en una copia así, algo escrito (lo
// suyo sin subir o lo que bajó) la saca de la papelera: queda como día repetido, a la vista en *Map › Pending* (D520).
// Nunca se esconde texto de nadie.

export type CededMark = NonNullable<PageSettings['ceded']>;

/** Hasta qué diferencia la hora de la papelera de la fila es la que anotó la marca (la base la guarda con otro formato). */
const SAME_TRASH_MS = 1000;

/**
 * La marca de una copia cedida que sigue en la papelera por esa razón: la fila está en la papelera con la misma hora que
 * anotó la marca. Si alguien la restauró y la volvió a mandar a mano, ya no vale (esa papelera es de la persona).
 */
export function cededMark(row: Pick<PageRow, 'deleted_at' | 'settings'> | undefined): CededMark | null {
  const mark = row?.settings?.ceded;
  if (!mark || !row?.deleted_at || typeof mark.at !== 'string' || typeof mark.to !== 'string') return null;
  const a = Date.parse(row.deleted_at);
  const b = Date.parse(mark.at);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < SAME_TRASH_MS ? mark : null;
}

/**
 * Manda la copia a la papelera con su marca: primero la marca y después la papelera con la misma hora, así una fila en la
 * papelera por ceder siempre la lleva.
 */
export async function cedeCopy(tree: Pick<PageTree, 'setSetting' | 'setPatch'>, pageId: string, to: string): Promise<void> {
  const at = new Date().toISOString();
  await tree.setSetting(pageId, 'ceded', { to, at });
  await tree.setPatch(pageId, { deleted_at: at });
}

export interface ReviveDeps {
  tree: Pick<PageTree, 'trashed' | 'get' | 'restore' | 'setSetting'>;
  docs: {
    indexSnapshot(pageId: string): Promise<{ doc: import('yjs').Doc; state: { cursor: number; version: number } | undefined }>;
    /** El estado guardado (sin el candado de la página ni leer el contenido): alcanza para saber si algo cambió (D636). */
    stateOf(pageId: string): Promise<{ cursor: number; version: number } | undefined>;
  };
  /** Si esta persona puede sacarla de la papelera (si no, lo hará otro dispositivo que pueda). */
  canRestore(pageId: string): boolean;
}

/** Lo que ya se miró y estaba vacío, por página: `update_seq`, cursor y versión local. Cambia uno, se mira de nuevo. */
type Seen = Map<string, string>;

/** Las copias que este dispositivo sacó de la papelera (para no avisar dos veces lo mismo, D633). */
const revivedHere = new Set<string>();
export const wasRevivedHere = (pageId: string): boolean => revivedHere.has(pageId);

/** Si el documento tiene algo escrito: un renglón con texto (también un título) o una foto. */
async function hasWriting(doc: import('yjs').Doc): Promise<boolean> {
  const { unitsFromYDoc } = await import('../search/extract');
  const meta: import('../search/extract').BlockMeta[] = [];
  const units = unitsFromYDoc(doc, meta);
  return units.some((u) => u.text.trim().length > 0) || meta.some((m) => (m.media?.length ?? 0) > 0);
}

/**
 * Saca de la papelera las copias cedidas en las que alguien escribió (lo de este dispositivo, subido o no, o lo que bajó
 * de otro) y les quita la marca. Lo de la página se lee de lo guardado en el dispositivo (sin abrirla). Devuelve las que
 * volvieron.
 */
export async function reviveCeded(deps: ReviveDeps, seen: Seen = new Map()): Promise<string[]> {
  const back: string[] = [];
  for (const row of deps.tree.trashed()) {
    if (!cededMark(row) || !deps.canRestore(row.id)) continue;
    // Primero lo barato (D636): si nada cambió desde la última vez que se vio vacía, ni se lee el contenido.
    const before = await deps.docs.stateOf(row.id);
    if (seen.get(row.id) === `${row.update_seq ?? 0}:${before?.cursor ?? 0}:${before?.version ?? 0}`) continue;
    const { doc, state } = await deps.docs.indexSnapshot(row.id);
    try {
      const key = `${row.update_seq ?? 0}:${state?.cursor ?? 0}:${state?.version ?? 0}`;
      if (!(await hasWriting(doc))) {
        seen.set(row.id, key);
        continue;
      }
    } finally {
      doc.destroy();
    }
    // Otro paso pudo haberla restaurado mientras se leía.
    const now = deps.tree.get(row.id);
    if (!cededMark(now)) continue;
    await deps.tree.restore(row.id);
    await deps.tree.setSetting(row.id, 'ceded', undefined);
    seen.delete(row.id);
    revivedHere.add(row.id);
    back.push(row.id);
  }
  return back;
}

/**
 * Lo que hace `services.ts` al arrancar: después de cada sincronización, mira las copias cedidas (pocas: solo las deja
 * una carrera de dos dispositivos). `onBack` avisa las que volvieron. Devuelve con qué dejar de mirar.
 *
 * Nunca antes de la primera sincronización (D632, O1 de la auditoría de E15): con el árbol que quedó guardado en el
 * dispositivo, una copia que otro ya sacó de la papelera y la persona volvió a mandar ahí a propósito todavía se ve «en la
 * papelera por ceder», y la vuelta pisaría esa decisión. Recién con el árbol bajado de nuevo se sabe.
 */
export function watchCededCopies(
  deps: ReviveDeps,
  engine: { subscribe(fn: () => void): () => void; getStatus(): { lastSyncAt: number | null }; syncNow(): Promise<void> },
  onBack: (pageIds: string[]) => void,
): () => void {
  const seen: Seen = new Map();
  let last = engine.getStatus().lastSyncAt;
  let running = false;
  let again = false;
  let stopped = false;
  const run = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const back = await reviveCeded(deps, seen).catch((err) => {
          console.warn('[relaciones] no se pudo mirar las copias cedidas', err);
          return [] as string[];
        });
        if (stopped) return;
        if (back.length) {
          onBack(back);
          // Que la vuelta suba ya y no en el próximo ciclo.
          void engine.syncNow().catch(() => undefined);
        }
      } while (again && !stopped);
    } finally {
      running = false;
    }
  };
  const off = engine.subscribe(() => {
    const at = engine.getStatus().lastSyncAt;
    if (at === last) return;
    last = at;
    void run();
  });
  return () => {
    stopped = true;
    off();
  };
}
