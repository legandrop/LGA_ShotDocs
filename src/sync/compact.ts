import * as Y from 'yjs';
import { sha256Hex } from './clean';
import type { CompactionClaim, SnapshotsRemote } from './remote';
import { errorMessage, isNetworkError, isTimeout, type RemoteUpdate } from './types';

/**
 * Compactar, entrega 2: armar las copias resumidas (snapshots) en el dispositivo de quien edita y subirlas
 * (Docs/Doc_Compactar.md, secciones 3 y 4). Acá están las cuentas (armar y comprobar, Yjs puro: sin editor, sin
 * y-prosemirror y sin la reparación de estructura) y el paso entero de una página contra el servidor (bajar la base y
 * las filas, armar, comprobar, subir, bajar la vuelta y confirmar). Nunca toca lo guardado en el dispositivo: el
 * snapshot sale de las filas exactas del servidor.
 */

/** Un snapshot pesa como mucho lo que un update (la base lo vuelve a controlar). Más grande: la página no se compacta. */
export const SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024;
/** La comparación desde cero (cada 10 snapshots) se salta si las filas pesan más que esto (Doc_Compactar.md, 4.4). */
export const FULL_CHECK_MAX_BYTES = 16 * 1024 * 1024;
/** La pista del árbol: con menos filas después del snapshot vigente no se pide la reserva (la base pide lo mismo). */
export const SNAPSHOT_MIN_ROWS = 100;
/** Cada cuántos snapshots, en promedio, se compara contra todo desde cero (sección 4.4, punto 5). */
export const FULL_CHECK_EVERY = 10;
/** Filas por pedido al bajar el tramo (como `pullPage`; si vence el tope de tiempo, se achica hasta de a una). */
const ROWS_BATCH = 500;
/** Cada cuántas filas aplicadas se le devuelve el control al navegador mientras se arma (no congelar la pantalla). */
const YIELD_EVERY = 50;
/**
 * Y además cada tantos milisegundos de trabajo seguido (entrega 3, O-C): con filas pesadas (las de antes de B.15 llevan
 * todos los borrados de la página) 50 filas tardaban hasta 100 ms con la CPU frenada ×6, una tecla que se nota.
 */
const YIELD_MS = 30;

/**
 * Le devuelve el control al navegador: con un mensaje (`MessageChannel`), que no tiene la espera mínima de `setTimeout`
 * (unos 4 ms, y más con la CPU frenada o la pestaña de fondo); lo que el navegador tenga en cola, como una tecla, va antes.
 */
function yieldToBrowser(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(null);
  });
}

/** Un `Y.Doc` sin GC con el update aplicado: lo borrado conserva su texto. */
export function docFromUpdate(update: Uint8Array): Y.Doc {
  const doc = new Y.Doc({ gc: false });
  Y.applyUpdate(doc, update);
  return doc;
}

/**
 * La base y las filas aplicadas en orden en un `Y.Doc` sin GC (sección 3): cada elemento queda con el contenido de la
 * primera fila que lo trae (la que tenía el texto), y lo que espera algo que no llegó queda pendiente en el documento.
 */
export function buildDoc(base: Uint8Array | null, tail: Uint8Array[]): Y.Doc {
  const doc = new Y.Doc({ gc: false });
  if (base) Y.applyUpdate(doc, base);
  for (const row of tail) Y.applyUpdate(doc, row);
  return doc;
}

/**
 * Como `buildDoc`, devolviendo el control al navegador cada tantas filas o cada tantos milisegundos (una página muy
 * editada tarda segundos). El resultado es el mismo: solo cambia cuándo se pausa.
 */
export async function buildDocAsync(base: Uint8Array | null, tail: Uint8Array[]): Promise<Y.Doc> {
  const doc = new Y.Doc({ gc: false });
  if (base) Y.applyUpdate(doc, base);
  let slice = performance.now();
  for (let i = 0; i < tail.length; i++) {
    Y.applyUpdate(doc, tail[i]);
    if (i % YIELD_EVERY === YIELD_EVERY - 1 || performance.now() - slice >= YIELD_MS) {
      await yieldToBrowser();
      slice = performance.now();
    }
  }
  return doc;
}

/** El snapshot: la base y las filas en orden y sin GC, codificado en un solo update de Yjs (incluye lo pendiente). */
export function compact(base: Uint8Array | null, tail: Uint8Array[]): Uint8Array {
  const doc = buildDoc(base, tail);
  try {
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

/**
 * Comprueba un snapshot por el otro camino de Yjs: la base y las filas aplicadas de a una contra el snapshot decodificado.
 * Devuelve `null` si son el mismo documento, o por qué no.
 */
export function verifySnapshot(base: Uint8Array | null, tail: Uint8Array[], snap: Uint8Array): string | null {
  const a = buildDoc(base, tail);
  let b: Y.Doc | null = null;
  try {
    b = docFromUpdate(snap);
    return compareDocs(a, b);
  } catch (err) {
    return `unreadable: ${errorMessage(err)}`;
  } finally {
    a.destroy();
    b?.destroy();
  }
}

/**
 * Si dos documentos sin GC son el mismo (sección 4.4): lo pendiente igual (como tramos), el mismo vector y los mismos
 * borrados (`Y.equalSnapshots`), aplicar el estado de cada uno sobre una copia del otro no cambia nada, y cada elemento
 * es igual unidad por unidad (contenido, borrado, de quién cuelga y entre quiénes se insertó). Comparar bytes no sirve:
 * los mismos documentos se codifican distinto según cómo se partieron los textos. Devuelve `null` o por qué no.
 */
export function compareDocs(a: Y.Doc, b: Y.Doc): string | null {
  if (pendingKey(a) !== pendingKey(b)) return 'pending';
  if (!Y.equalSnapshots(Y.snapshot(a), Y.snapshot(b))) return 'state';
  const units = compareUnits(a, b);
  if (units) return `content ${units}`;
  if (!absorbs(a, b) || !absorbs(b, a)) return 'absorbs';
  return null;
}

/** ¿Aplicar todo lo de `y` sobre una copia de `x` cambia algo? (`true`: no cambia nada.) */
function absorbs(x: Y.Doc, y: Y.Doc): boolean {
  const copy = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(x));
    let changed = false;
    copy.on('update', () => {
      changed = true;
    });
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(y));
    return !changed;
  } finally {
    copy.destroy();
  }
}

const EMPTY_V2 = Y.encodeStateAsUpdateV2(new Y.Doc());

/**
 * Lo pendiente del documento (lo que espera algo que no llegó: structs y borrados), como tramos unidos por autor. Ni el
 * vector, ni `Y.snapshot`, ni el evento `update` lo ven; Yjs lo guarda en formato v2 (lo encontró la auditoría del
 * diseño: un snapshot sin una fila que dependía de algo ausente pasaba).
 */
export function pendingKey(doc: Y.Doc): string {
  const store = doc.store as unknown as { pendingStructs: { update: Uint8Array } | null; pendingDs: Uint8Array | null };
  if (!store.pendingStructs && !store.pendingDs) return '|';
  const merged = Y.mergeUpdatesV2([store.pendingStructs?.update ?? EMPTY_V2, store.pendingDs ?? EMPTY_V2]);
  const decoded = Y.decodeUpdateV2(merged);
  const structs: [number, number, number][] = decoded.structs
    .filter((s) => !(s instanceof Y.Skip))
    .map((s) => [s.id.client, s.id.clock, s.id.clock + s.length]);
  const ds: [number, number, number][] = [...decoded.ds.clients].flatMap(([client, items]) =>
    items.map((i): [number, number, number] => [client, i.clock, i.clock + i.len]),
  );
  return `${spans(structs)}|${spans(ds)}`;
}

/** Tramos `[autor, desde, hasta)` ordenados y unidos los que se tocan, como texto comparable. */
function spans(list: [number, number, number][]): string {
  const sorted = [...list].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out: [number, number, number][] = [];
  for (const [client, from, to] of sorted) {
    const last = out[out.length - 1];
    if (last && last[0] === client && from <= last[2]) last[2] = Math.max(last[2], to);
    else out.push([client, from, to]);
  }
  return out.map((s) => s.join(':')).join(',');
}

type Struct = Y.Item | Y.GC;

/**
 * Recorre los elementos de cada autor en los dos documentos a la vez, por tramos que no cortan ningún elemento de ninguno
 * de los dos (un mismo texto puede estar partido en otros lugares), y compara cada tramo. `null` si todo es igual.
 */
function compareUnits(a: Y.Doc, b: Y.Doc): string | null {
  const ca = a.store.clients as Map<number, Struct[]>;
  const cb = b.store.clients as Map<number, Struct[]>;
  if (ca.size !== cb.size) return 'authors';
  for (const [client, la] of ca) {
    const lb = cb.get(client);
    if (!lb) return `author ${client}`;
    let ia = 0;
    let oa = 0;
    let ib = 0;
    let ob = 0;
    while (ia < la.length && ib < lb.length) {
      const sa = la[ia];
      const sb = lb[ib];
      if (sa.id.clock + oa !== sb.id.clock + ob) return `clock ${client}`;
      const n = Math.min(sa.length - oa, sb.length - ob);
      const why = chunkDiff(sa, oa, sb, ob, n);
      if (why) return `${why} at ${client}:${sa.id.clock + oa}`;
      oa += n;
      ob += n;
      if (oa === sa.length) {
        ia++;
        oa = 0;
      }
      if (ob === sb.length) {
        ib++;
        ob = 0;
      }
    }
    if (ia !== la.length || ib !== lb.length) return `length ${client}`;
  }
  return null;
}

/** Borrado y sin contenido: un hueco (`GC`) o un elemento con `ContentDeleted`. Los dos dicen lo mismo. */
function isHole(s: Struct): boolean {
  return s instanceof Y.GC || (s.deleted && s.content instanceof Y.ContentDeleted);
}

function chunkDiff(sa: Struct, oa: number, sb: Struct, ob: number, n: number): string | null {
  if (isHole(sa) || isHole(sb)) return isHole(sa) && isHole(sb) ? null : 'hole';
  const x = sa as Y.Item;
  const y = sb as Y.Item;
  if (x.deleted !== y.deleted) return 'deleted';
  if ((x.parentSub ?? null) !== (y.parentSub ?? null)) return 'parentSub';
  if (parentKey(x) !== parentKey(y)) return 'parent';
  if (idKey(x.rightOrigin) !== idKey(y.rightOrigin)) return 'rightOrigin';
  // El primero del tramo: si no es el primero de su elemento, se insertó después del anterior del mismo autor.
  const originX = oa === 0 ? idKey(x.origin) : `${x.id.client}:${x.id.clock + oa - 1}`;
  const originY = ob === 0 ? idKey(y.origin) : `${y.id.client}:${y.id.clock + ob - 1}`;
  if (originX !== originY) return 'origin';
  return contentDiff(x.content, oa, y.content, ob, n);
}

function idKey(id: Y.ID | null): string {
  return id ? `${id.client}:${id.clock}` : '-';
}

function parentKey(item: Y.Item): string {
  const parent = item.parent as unknown;
  if (parent === null) return '-';
  if (typeof parent === 'string') return `root:${parent}`;
  if (parent instanceof Y.ID) return idKey(parent);
  const type = parent as Y.AbstractType<unknown>;
  return type._item ? idKey(type._item.id) : `root:${Y.findRootTypeKey(type)}`;
}

function contentDiff(x: Y.Item['content'], ox: number, y: Y.Item['content'], oy: number, n: number): string | null {
  if (x.constructor !== y.constructor) return 'content kind';
  if (x instanceof Y.ContentString) {
    return x.str.slice(ox, ox + n) === (y as Y.ContentString).str.slice(oy, oy + n) ? null : 'text';
  }
  if (x instanceof Y.ContentDeleted) return null;
  if (x instanceof Y.ContentAny || x instanceof Y.ContentJSON) {
    const yy = y as Y.ContentAny | Y.ContentJSON;
    return JSON.stringify(x.arr.slice(ox, ox + n)) === JSON.stringify(yy.arr.slice(oy, oy + n)) ? null : 'values';
  }
  if (x instanceof Y.ContentBinary) {
    const a = x.content;
    const b = (y as Y.ContentBinary).content;
    return a.length === b.length && a.every((v, i) => v === b[i]) ? null : 'binary';
  }
  if (x instanceof Y.ContentEmbed) return JSON.stringify(x.embed) === JSON.stringify((y as Y.ContentEmbed).embed) ? null : 'embed';
  if (x instanceof Y.ContentFormat) {
    const yy = y as Y.ContentFormat;
    return x.key === yy.key && JSON.stringify(x.value) === JSON.stringify(yy.value) ? null : 'format';
  }
  if (x instanceof Y.ContentType) return typeKey(x.type) === typeKey((y as Y.ContentType).type) ? null : 'type';
  if (x instanceof Y.ContentDoc) {
    const yy = y as Y.ContentDoc;
    return x.doc?.guid === yy.doc?.guid && JSON.stringify(x.opts) === JSON.stringify(yy.opts) ? null : 'subdoc';
  }
  return 'unknown content';
}

/** El tipo de un `ContentType`: su referencia de Yjs y, en XML, el nombre del nodo o del gancho. */
function typeKey(type: Y.AbstractType<unknown>): string {
  const t = type as unknown as { nodeName?: string; hookName?: string };
  return `${type.constructor.name}:${t.nodeName ?? ''}:${t.hookName ?? ''}`;
}

// --- el paso de una página contra el servidor ---------------------------------------------------------------------

/** Lo que el compactador le pide al servidor: las funciones de compactar y las filas sueltas (`pull_page_updates`). */
export type CompactRemote = SnapshotsRemote & {
  pullUpdates(pageId: string, afterSeq: number, limit: number): Promise<RemoteUpdate[]>;
};

/** Si el servidor sabe compactar (el cliente de verdad y el de las pruebas; el del link público, no). */
export function canCompact(remote: object): remote is CompactRemote {
  const r = remote as Partial<CompactRemote>;
  return typeof r.claimCompaction === 'function' && typeof r.pushSnapshot === 'function' && typeof r.confirmSnapshot === 'function';
}

/**
 * Cómo terminó una compactación: `confirmed` (se sirve desde ahora), `stale` (otro llegó antes o cambió la base: nada que
 * hacer), `exists` (otra versión de la app armó el mismo tramo), `mismatch` (otro dispositivo de la misma versión armó
 * otra cosa para lo mismo: la base invalidó los dos), `skipped` (no se puede compactar: 24 horas sin reservar, con el
 * motivo), `invalidated` (la comparación desde cero no dio igual: se invalidó la cadena de la base).
 */
export type CompactOutcome =
  | { kind: 'confirmed'; id: string; bytes: number; fullCheck: boolean }
  | { kind: 'stale' | 'exists' | 'mismatch'; reason?: string }
  | { kind: 'skipped' | 'invalidated'; reason: string };

export interface CompactOptions {
  /** Cada cuántos snapshots se compara contra todo desde cero (1: siempre; las pruebas). Por defecto, 10. */
  fullCheckEvery?: number;
  /** La pista del árbol (`SNAPSHOT_MIN_ROWS`); las pruebas la achican junto con la del servidor en memoria. */
  minRows?: number;
  /**
   * Para las pruebas mutantes: cambia el snapshot armado antes de comprobarlo (un error del compactador). La
   * comprobación tiene que frenarlo.
   */
  tamper?: (snap: Uint8Array) => Uint8Array;
}

/**
 * Compacta una página ya reservada (`claim`): baja la base y las filas exactas del servidor, arma el snapshot, lo comprueba
 * por los dos caminos, cada tanto contra todo desde cero, lo sube, baja la vuelta, comprueba la huella y lo confirma.
 * Lo que no se puede compactar se avisa (`skip_page_compaction`) para que no se reintente en cada ciclo. Los errores de
 * red salen para afuera (la reserva vence sola); un rechazo de la base por una carrera es `stale`.
 */
export async function compactPage(
  remote: CompactRemote,
  pageId: string,
  claim: CompactionClaim,
  options: CompactOptions = {},
): Promise<CompactOutcome> {
  const skip = async (reason: string): Promise<CompactOutcome> => {
    await remote.skipCompaction(pageId, reason);
    return { kind: 'skipped', reason };
  };
  let base: Uint8Array | null = null;
  if (claim.baseId) {
    try {
      // Con la huella que guardó la base (entrega 3, O-D): una base corrupta se invalida (con toda su cadena; la próxima
      // compactación arranca desde la fila 1) en vez de saltear la página cada día. Sin la función, como antes.
      const checked = remote.pullSnapshotChecked ? await remote.pullSnapshotChecked(claim.baseId) : null;
      if (checked) {
        if ((await sha256Hex(checked.state)) !== checked.sha256) {
          console.error(`Página ${pageId}: la base del snapshot no coincide con su huella; se invalida su cadena.`);
          await remote.invalidateSnapshot(claim.baseId, 'corrupt base: sha256');
          return { kind: 'invalidated', reason: 'corrupt base' };
        }
        base = checked.state;
      } else {
        base = await remote.pullSnapshot(claim.baseId);
      }
    } catch (err) {
      if (isNetworkError(err) || isTimeout(err)) throw err;
      // La base dejó de ser la vigente entre la reserva y ahora (otro confirmó, o se invalidó): la próxima vuelta.
      return { kind: 'stale', reason: errorMessage(err) };
    }
  }
  const tail = await pullRows(remote, pageId, claim.baseSeq, claim.upToSeq);
  if ('gap' in tail) return skip(`rows: ${tail.gap}`);
  for (const row of tail.rows) {
    try {
      Y.decodeUpdate(row.data);
    } catch {
      return skip(`unreadable row ${row.seq}`);
    }
  }
  if (base) {
    try {
      Y.decodeUpdate(base);
    } catch {
      return skip('unreadable base');
    }
  }

  const doc = await buildDocAsync(base, tail.rows.map((r) => r.data));
  let built: Y.Doc | null = null;
  let fullCheck = false;
  let snap: Uint8Array;
  let sha: string;
  try {
    snap = Y.encodeStateAsUpdate(doc);
    if (options.tamper) snap = options.tamper(snap);
    if (snap.length > SNAPSHOT_MAX_BYTES) return await skip('too large');
    try {
      built = docFromUpdate(snap);
    } catch (err) {
      console.error(`Página ${pageId}: el snapshot armado no se puede leer.`, err);
      return await skip('check: unreadable');
    }
    // Los dos caminos: lo que juntó aplicando las filas de a una, contra el snapshot decodificado.
    const why = compareDocs(doc, built);
    if (why) {
      // La señal de un error del compactador (o de Yjs): no se sube y se anota para mirarlo.
      console.error(`Página ${pageId}: el snapshot no pasó la comprobación (${why}); no se sube.`);
      return await skip(`check: ${why}`);
    }
    sha = await sha256Hex(snap);
    // Cada tanto, contra todo desde cero: una segunda red contra un error de la propia comprobación o de un eslabón
    // anterior. Determinista para el mismo tramo (sale de la huella): dos dispositivos deciden lo mismo.
    const every = Math.max(1, options.fullCheckEvery ?? FULL_CHECK_EVERY);
    if (base && parseInt(sha.slice(0, 8), 16) % every === 0) {
      const all = await pullRows(remote, pageId, 0, claim.upToSeq, FULL_CHECK_MAX_BYTES);
      if ('gap' in all) {
        if (all.gap !== 'too heavy') return await skip(`rows: ${all.gap}`);
        // Las páginas más pesadas no tienen la segunda red (sección 16): queda anotado en la consola.
        console.info(`Página ${pageId}: la comparación desde cero se salta (las filas pesan más de 16 MB).`);
      } else {
        fullCheck = true;
        const fresh = await buildDocAsync(null, all.rows.map((r) => r.data));
        try {
          const diff = compareDocs(fresh, built);
          if (diff) {
            // El tramo nuevo se comprobó contra lo que juntó: lo que no da igual viene de la base. Se invalida toda su
            // cadena; la próxima compactación arranca desde la fila 1.
            console.error(`Página ${pageId}: la cadena de snapshots no da igual que las filas desde cero (${diff}); se invalida.`);
            await remote.invalidateSnapshot(claim.baseId!, `full check: ${diff}`);
            return { kind: 'invalidated', reason: diff };
          }
        } finally {
          fresh.destroy();
        }
      }
    }
  } finally {
    doc.destroy();
    built?.destroy();
  }

  let pushed;
  try {
    pushed = await remote.pushSnapshot({
      pageId,
      baseId: claim.baseId,
      upToSeq: claim.upToSeq,
      lastUpdateId: claim.lastUpdateId,
      state: snap,
      sv: Y.encodeStateVectorFromUpdate(snap),
      sha256: sha,
    });
  } catch (err) {
    if (isNetworkError(err) || isTimeout(err)) throw err;
    // `snapshot_base_stale`, `snapshot_row_mismatch`, `snapshot_off`, `app_outdated`: cambió algo desde la reserva.
    return { kind: 'stale', reason: errorMessage(err) };
  }
  if (pushed.result === 'snapshot_mismatch') {
    console.error(`Página ${pageId}: otro dispositivo de esta versión armó otro snapshot para el mismo tramo; la base invalidó los dos.`);
    return { kind: 'mismatch' };
  }
  if (pushed.result === 'snapshot_exists') return { kind: 'exists' };

  // La vuelta: lo que quedó en la base es lo que se comprobó, entero y legible. Recién ahí se confirma.
  let back: Uint8Array;
  try {
    back = await remote.pullSnapshot(pushed.id);
  } catch (err) {
    if (isNetworkError(err) || isTimeout(err)) throw err;
    return { kind: 'stale', reason: errorMessage(err) };
  }
  if ((await sha256Hex(back)) !== sha) {
    // No se confirma: sin confirmar no se sirve nunca, y la base lo limpia al día.
    console.error(`Página ${pageId}: el snapshot volvió distinto de la base; no se confirma.`);
    return skip('check: round trip');
  }
  try {
    Y.decodeUpdate(back);
  } catch {
    return skip('check: round trip unreadable');
  }
  let confirmed: boolean;
  try {
    confirmed = await remote.confirmSnapshot(pushed.id, sha);
  } catch (err) {
    if (isNetworkError(err) || isTimeout(err)) throw err;
    return { kind: 'stale', reason: errorMessage(err) };
  }
  return confirmed ? { kind: 'confirmed', id: pushed.id, bytes: snap.length, fullCheck } : { kind: 'stale', reason: 'not confirmed' };
}

/**
 * Las filas del servidor `after+1..upTo`, exactamente (sin huecos ni de más), con `pull_page_updates`: nunca lo guardado
 * en el dispositivo, que mezcla lo propio sin subir. Si un lote vence el tope de tiempo, se pide uno más chico. Con
 * `maxBytes`, deja de bajar al pasarse (`too heavy`).
 */
async function pullRows(
  remote: CompactRemote,
  pageId: string,
  after: number,
  upTo: number,
  maxBytes = Infinity,
): Promise<{ rows: RemoteUpdate[] } | { gap: string }> {
  const rows: RemoteUpdate[] = [];
  let cursor = after;
  let batch = ROWS_BATCH;
  let bytes = 0;
  while (cursor < upTo) {
    let got: RemoteUpdate[];
    try {
      got = await remote.pullUpdates(pageId, cursor, Math.min(batch, upTo - cursor));
    } catch (err) {
      if (!isTimeout(err) || batch === 1) throw err;
      batch = Math.max(1, Math.floor(batch / 10));
      continue;
    }
    if (got.length === 0) return { gap: `missing ${cursor + 1}` };
    for (const row of got) {
      if (row.seq > upTo) break;
      // Las filas del servidor son seguidas (cada subida toma la siguiente): un salto es algo raro (una base limpia, por
      // ejemplo), y armar con un hueco daría un snapshot al que le falta algo.
      if (row.seq !== cursor + 1) return { gap: `expected ${cursor + 1}, got ${row.seq}` };
      bytes += row.data.length;
      if (bytes > maxBytes) return { gap: 'too heavy' };
      rows.push(row);
      cursor = row.seq;
    }
    if (got[got.length - 1].seq > upTo) break;
  }
  return { rows };
}
