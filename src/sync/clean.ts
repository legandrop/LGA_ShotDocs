import * as Y from 'yjs';
import { rangesContain, rangesOf } from './deleteSets';
import type { PageRow } from './types';

/**
 * La base limpia de una página (Docs/Doc_Privacidad_Borrado.md, D14): la página entera con lo borrado como hueco, que
 * arma el dispositivo de alguien que ve lo borrado y es lo único que baja quien no lo ve (Ver, Comentar, invitados),
 * con el interruptor del workspace prendido (`workspace_settings.clean_min_version`). Acá están las cuentas, sin red ni
 * base local: armarla, comprobarla antes de subirla y saber si una que llega cubre lo guardado.
 */

/** Desde esta versión de la base existen `pages.clean_seq`, `clean_work` y `push_clean_base`. */
export const CLEAN_SCHEMA_VERSION = 12;

/** Como mucho, cuántas bases arma un dispositivo por vuelta. */
export const CLEAN_PER_ROUND = 20;

/**
 * Hasta qué `seq` puede bajar este dispositivo el contenido de la página: `update_seq` si recibe las filas, y
 * `clean_seq` (el `to_seq` de la base vigente) si recibe bases. Lo usan todas las cuentas de "al día".
 */
export function serverSeqFor(row: Pick<PageRow, 'update_seq' | 'clean_seq'>, baseReader: boolean): number {
  return baseReader ? (row.clean_seq ?? 0) : row.update_seq;
}

/**
 * Lo que le falta a la página en este dispositivo: `missing` si el servidor tiene más de lo que bajó, `preparing` si
 * la página tiene contenido pero ningún editor armó todavía la base que le corresponde (y el dispositivo no tiene
 * nada), o `null` si está al día. Con `preparing` la página no se abre para editar ni se le pone la semilla: armaría
 * una estructura paralela a la que va a llegar.
 */
export function contentGap(
  row: Pick<PageRow, 'update_seq' | 'clean_seq'>,
  baseReader: boolean,
  cursor: number,
): 'missing' | 'preparing' | null {
  if (serverSeqFor(row, baseReader) > cursor) return 'missing';
  if (baseReader && (row.clean_seq ?? 0) === 0 && row.update_seq > 0 && cursor === 0) return 'preparing';
  return null;
}

/** Lo que necesitan las cuentas de "al día" de un árbol (el de verdad es `PageTree`; las pruebas pasan uno más chico). */
export interface SeqTree {
  serverSeq?(row: PageRow): number;
  contentGap?(row: PageRow, cursor: number): 'missing' | 'preparing' | null;
}

/** `serverSeq` del árbol, o `update_seq` si el árbol no lo sabe. */
export function treeServerSeq(tree: SeqTree, row: PageRow): number {
  return tree.serverSeq ? tree.serverSeq(row) : row.update_seq;
}

/** `contentGap` del árbol, o la cuenta de siempre con `update_seq`. */
export function treeContentGap(tree: SeqTree, row: PageRow, cursor: number): 'missing' | 'preparing' | null {
  return tree.contentGap ? tree.contentGap(row, cursor) : row.update_seq > cursor ? 'missing' : null;
}

/** Arma la base desde las filas guardadas: un documento con GC (lo borrado queda como hueco) y su estado entero. */
export function buildCleanBase(rows: Uint8Array[]): { base: Uint8Array; doc: Y.Doc } {
  const doc = new Y.Doc();
  if (rows.length > 0) Y.applyUpdate(doc, Y.mergeUpdates(rows));
  return { base: Y.encodeStateAsUpdate(doc), doc };
}

/**
 * Las dos comprobaciones antes de subir una base (sección 4.1 del doc). Devuelve `null` si pasa, o por qué no.
 *
 * 1. Privacidad: armada en un documento SIN GC (para que nada se tire al leerla), ningún elemento borrado tiene su
 *    contenido y ningún elemento con contenido cuelga de algo borrado. Una base armada sin GC no pasa.
 * 2. Contenido: se lee entera (nada pendiente) y su vector de estado y sus borrados (`Y.snapshot`) son los del
 *    documento del que salió.
 */
export function checkCleanBase(base: Uint8Array, source: Y.Doc): string | null {
  const doc = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(doc, base);
    if (doc.store.pendingStructs || doc.store.pendingDs) return 'incomplete';
    for (const structs of doc.store.clients.values()) {
      for (const struct of structs) {
        if (!(struct instanceof Y.Item)) continue;
        if (struct.deleted) {
          if (!(struct.content instanceof Y.ContentDeleted)) return 'deleted content';
          continue;
        }
        // Vivo: ninguno de los de arriba puede estar borrado.
        for (let up = (struct.parent as Y.AbstractType<unknown> | null)?._item; up; up = (up.parent as Y.AbstractType<unknown> | null)?._item) {
          if (up.deleted) return 'content under deleted';
        }
      }
    }
    if (!Y.equalSnapshots(Y.snapshot(doc), Y.snapshot(source))) return 'different';
    return null;
  } finally {
    doc.destroy();
  }
}

/**
 * Si `incoming` (una base que bajó) cubre lo guardado: se lee entera, tiene todo lo de cada autor que tiene lo guardado
 * y todos sus borrados. Recién así puede reemplazar lo guardado sin que se pierda nada visible (lo que no cubre se
 * suma como una fila más). Lo guardado con piezas pendientes (que esperan algo que no llegó) no se cubre nunca: no
 * cuentan en el vector de estado ni en los borrados, y reemplazarlo las tiraría.
 */
export function coversLocal(rows: Uint8Array[], incoming: Uint8Array): boolean {
  const inc = new Y.Doc();
  const local = new Y.Doc();
  try {
    Y.applyUpdate(inc, incoming);
    if (inc.store.pendingStructs || inc.store.pendingDs) return false;
    if (rows.length > 0) Y.applyUpdate(local, Y.mergeUpdates(rows));
    if (local.store.pendingStructs || local.store.pendingDs) return false;
    const have = Y.decodeStateVector(Y.encodeStateVector(inc));
    for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVector(local))) {
      if ((have.get(client) ?? 0) < clock) return false;
    }
    return rangesContain(rangesOf(Y.encodeStateAsUpdate(inc)), rangesOf(Y.encodeStateAsUpdate(local)));
  } catch {
    return false;
  } finally {
    inc.destroy();
    local.destroy();
  }
}

/** La huella SHA-256 en hexadecimal (la base la vuelve a calcular y compara). */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
