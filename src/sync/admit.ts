import * as Y from 'yjs';
import { mediaIdOf } from '../media/queue';
import { mediaIdsInDoc } from '../media/usage';
import { findUnknownContent, type KnownContent } from '../ui/unknownContent';
import { checkCleanBase } from './clean';
import { pendingKey } from './compact';
import { depthProblem, pageDepth, shapeProblem, urlsInDoc, type PageDepth } from './linkShape';
import { CONTENT_FRAGMENT } from './structure';

// La prueba de admisión de lo que escribe un link público (Docs/Doc_Link_Publico.md, E2.3, LE3). Lo que manda un
// visitante con *Can edit* espera en una sala (`public_link_updates`); el dispositivo de un editor que ya arma las
// bases limpias (D14) lo prueba acá, fila por fila y en orden, sobre una copia de la página armada con lo guardado (que
// es exactamente lo del servidor) y con lo que ya entró en esta vuelta. La base mueve a la página solo lo que pasa
// (`link_admit`); lo demás queda apartado con su motivo, sin perder nada.
//
// Yjs puro, sin el editor: la copia se arma una vez por página y las filas se prueban seguidas (una que no pasa obliga a
// rearmarla sin ella).

/** Los tipos raíz que usa la app: el contenido, colapsar para todos y las anotaciones de fotos. */
export const ADMIT_ROOTS: ReadonlySet<string> = new Set([CONTENT_FRAGMENT, 'collapsedHeadings', 'photoMarkup']);

/** La base limpia que sale de la página no puede pasar de esto (`push_clean_base` rechaza más de 8 MB; N4). */
export const ADMIT_MAX_BASE_BYTES = 8 * 1024 * 1024;

/** Por qué una fila no entra. */
export type AdmitReason =
  | 'undecodable'
  | 'unknown_root'
  | 'pending'
  | 'unknown_content'
  | 'foreign_media'
  | 'external_url'
  | 'bad_shape'
  | 'too_deep'
  | 'too_big'
  | `clean_${string}`;

export type AdmitVerdict =
  /** Entra. `media`: los archivos (`sdmedia://`) que la fila suma a la página; la base los vuelve a comprobar. */
  | { ok: true; media: string[] }
  | { ok: false; reason: AdmitReason; detail?: string };

export interface AdmitOptions {
  /** El tope de la base limpia (por defecto, 8 MB). */
  maxBaseBytes?: number;
  /**
   * Si un archivo nuevo en la página se puede usar (lo usa hoy una página de la rama del link, o lo registró el link).
   * Sin esto lo decide la base al admitir (`link_media_allowed`): la prueba manda la lista.
   */
  mediaAllowed?: (id: string) => boolean;
  /** Los nombres que conoce esta versión (para las pruebas: el esquema de otra versión). */
  known?: KnownContent;
}

/**
 * La prueba de las filas de un link sobre una página. `rows`: las filas del servidor tal como las tiene guardadas el
 * dispositivo. Cada `test` deja aplicada la fila si entra; si no, la página sigue como estaba.
 */
export class AdmissionTester {
  /** La copia sin GC (para ver lo pendiente, lo desconocido, las fotos y la forma). */
  private work!: Y.Doc;
  /** La copia con GC: de acá sale la base limpia (como `buildCleanBase`). */
  private clean!: Y.Doc;
  private readonly accepted: Uint8Array[] = [];
  /** La profundidad de la copia antes de la fila que se prueba (R1: una página ya honda admite lo que no la ahonda). */
  private depth: PageDepth = { groups: 0, nodes: 0 };
  private readonly maxBase: number;

  constructor(
    private readonly rows: readonly Uint8Array[],
    private readonly options: AdmitOptions = {},
  ) {
    this.maxBase = options.maxBaseBytes ?? ADMIT_MAX_BASE_BYTES;
    this.rebuild();
  }

  /** Arma las dos copias desde las filas del servidor y lo que ya entró. */
  private rebuild(): void {
    this.work?.destroy();
    this.clean?.destroy();
    const all = [...this.rows, ...this.accepted];
    this.work = new Y.Doc({ gc: false });
    this.clean = new Y.Doc();
    if (all.length > 0) {
      const merged = Y.mergeUpdates(all);
      Y.applyUpdate(this.work, merged);
      Y.applyUpdate(this.clean, merged);
    }
    this.depth = pageDepth(this.work);
  }

  /** Prueba una fila. Si entra, queda aplicada para las que siguen. */
  test(row: Uint8Array): AdmitVerdict {
    const verdict = this.check(row);
    if (verdict.ok) this.accepted.push(row);
    return verdict;
  }

  private check(row: Uint8Array): AdmitVerdict {
    // 1. Se lee.
    let decoded: ReturnType<typeof Y.decodeUpdate>;
    try {
      decoded = Y.decodeUpdate(row);
    } catch {
      return { ok: false, reason: 'undecodable' };
    }
    // 2. Solo los tipos raíz que usa la app.
    for (const s of decoded.structs) {
      const parent = (s as unknown as { parent?: unknown }).parent;
      if (typeof parent === 'string' && !ADMIT_ROOTS.has(parent)) return { ok: false, reason: 'unknown_root', detail: parent };
    }
    const doc = this.work;
    const known = this.options.known;
    const pendingBefore = pendingKey(doc);
    const unknownBefore = findUnknownContent(doc, known);
    const mediaBefore = mediaIdsInDoc(doc);
    const urlsBefore = urlsInDoc(doc);
    const before = Y.decodeStateVector(Y.encodeStateVector(doc));
    let verdict: AdmitVerdict | null = null;
    try {
      // 3. Se aplica sin error y no deja nada pendiente (structs ni borrados).
      try {
        Y.applyUpdate(doc, row);
      } catch {
        verdict = { ok: false, reason: 'pending', detail: 'apply' };
        return verdict;
      }
      if (pendingKey(doc) !== pendingBefore) return (verdict = { ok: false, reason: 'pending' });
      // 8, primero lo barato y lo que protege a lo que sigue: la profundidad de la página entera (B4), sin recursión.
      const deep = depthProblem(doc, this.depth);
      if (deep) return (verdict = { ok: false, reason: 'too_deep', detail: deep });
      // 4. Nada que esta versión no conozca (si antes no había).
      const unknown = unknownBefore === null ? findUnknownContent(doc, known) : null;
      if (unknown) return (verdict = { ok: false, reason: 'unknown_content', detail: unknown });
      // 5. Las fotos nuevas y las direcciones nuevas. Una dirección vacía vale (un bloque de imagen insertado sin archivo
      // todavía, C1 de la re-verificación); una que no sea `sdmedia://` y que la página no tenía, no: una imagen de
      // afuera le avisaría al visitante cuándo abre la página alguien del equipo.
      for (const url of urlsInDoc(doc)) {
        if (!urlsBefore.has(url) && !mediaIdOf(url)) return (verdict = { ok: false, reason: 'external_url' });
      }
      const media = [...mediaIdsInDoc(doc)].filter((id) => !mediaBefore.has(id));
      if (this.options.mediaAllowed && media.some((id) => !this.options.mediaAllowed!(id))) {
        return (verdict = { ok: false, reason: 'foreign_media' });
      }
      // 8. La forma y los valores de lo que agrega (antes que la base: es lo más barato).
      const shape = shapeProblem(doc, before);
      if (shape) return (verdict = { ok: false, reason: 'bad_shape', detail: shape });
      // 6 y 7. La base limpia que sale: hasta 8 MB y pasa sus dos comprobaciones (privacidad y contenido).
      Y.applyUpdate(this.clean, row);
      const base = Y.encodeStateAsUpdate(this.clean);
      if (base.length > this.maxBase) return (verdict = { ok: false, reason: 'too_big' });
      const problem = checkCleanBase(base, this.clean);
      if (problem) return (verdict = { ok: false, reason: `clean_${problem.replace(/\s+/g, '_')}` });
      // Lo que entró queda en la copia: la próxima fila se compara con esta profundidad.
      const now = pageDepth(doc);
      this.depth = { groups: Math.max(this.depth.groups, now.groups), nodes: Math.max(this.depth.nodes, now.nodes) };
      return (verdict = { ok: true, media });
    } finally {
      // Lo que no entró ya quedó aplicado en las copias: se rearman sin la fila.
      if (verdict && !verdict.ok && verdict.reason !== 'undecodable' && verdict.reason !== 'unknown_root') this.rebuild();
    }
  }

  destroy(): void {
    this.work.destroy();
    this.clean.destroy();
  }
}

/** Las filas de un link para una página, probadas en orden (para las pruebas y las herramientas). */
export function admitRows(rows: readonly Uint8Array[], candidates: readonly Uint8Array[], options?: AdmitOptions): AdmitVerdict[] {
  const tester = new AdmissionTester(rows, options);
  try {
    return candidates.map((c) => tester.test(c));
  } finally {
    tester.destroy();
  }
}

/**
 * El texto que trae una fila (lo que se tecleó, en orden de llegada), para leer lo apartado sin la app (O8 de la
 * auditoría: *Download it* traía solo los bytes de Yjs). Un salto de renglón donde un tramo no sigue al anterior. Vacío si
 * la fila no se puede leer.
 */
export function insertedText(update: Uint8Array): string {
  let decoded: ReturnType<typeof Y.decodeUpdate>;
  try {
    decoded = Y.decodeUpdate(update);
  } catch {
    return '';
  }
  let out = '';
  let last: { client: number; clock: number } | null = null;
  for (const s of decoded.structs) {
    if (!(s instanceof Y.Item) || !(s.content instanceof Y.ContentString)) continue;
    const follows = last && s.origin && s.origin.client === last.client && s.origin.clock === last.clock;
    if (out && !follows) out += String.fromCharCode(10);
    out += s.content.str;
    last = { client: s.id.client, clock: s.id.clock + s.length - 1 };
  }
  return out;
}
