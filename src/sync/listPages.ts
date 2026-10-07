import { stored, t } from '../i18n';
import { RemoteError } from './types';

// Las listas largas que la app le pide a la base (Docs/Doc_Sincronizacion.md, "Las listas largas"). La API entrega
// como mucho un tope de filas por pedido (el ajuste *Max rows* del proyecto; de fábrica, 1000) y **no avisa** cuando
// recorta. Dar por última "una página con menos de 1000 filas" supone ese tope: con uno menor, la lista quedaba
// cortada en silencio, y una lista cortada del árbol o de los comentarios se toma por "esto ya no existe".
//
// Acá nada supone el tope. Cada pedido lleva el orden escrito y pide **el total** (`count: 'exact'`: la API lo manda
// en la misma respuesta, sin otro pedido): la lista terminó cuando lo recibido alcanza ese total, o cuando llega una
// página vacía. Si la API no manda el total, se sigue hasta la página vacía (un pedido más): nunca se corta por
// haber recibido pocas filas.

/** La opción de supabase-js que le pide a la API el total de filas del pedido (encabezado `Content-Range`). */
export const COUNTED = { count: 'exact' } as const;

/** El código del error de una lista que se pide de una sola vez y la API recortó (mandó menos filas que las que dijo que había). */
export const LIST_CUT = 'list_cut';

/**
 * Una lista que se junta **por clave**: cada pedido trae lo que sigue a la última fila recibida (`last`), en un orden
 * total escrito en el pedido. Así lo que cambia entre dos pedidos no corre ni saltea filas, y lo que la API recorta se
 * vuelve a pedir desde donde quedó.
 */
export class KeyedList<T> {
  readonly rows: T[] = [];
  private readonly seen = new Set<string>();

  /** `key`: el lugar de la fila en el orden del pedido (lo que hace única a cada fila en ese orden). */
  constructor(
    private readonly what: string,
    private readonly key: (row: T) => string,
  ) {}

  /** La última fila recibida: desde dónde sigue el próximo pedido. `null` antes del primero. */
  get last(): T | null {
    return this.rows.length > 0 ? this.rows[this.rows.length - 1] : null;
  }

  /**
   * Suma una página y dice si la lista terminó. `count`: el total que la API dijo que había para este pedido (lo que
   * faltaba, contando esta página); sin él, solo una página vacía termina la lista.
   */
  add(page: readonly T[], count: number | null | undefined): boolean {
    for (const row of page) {
      const key = this.key(row);
      // Cada página sigue a la anterior: una fila repetida es una base que no avanza, y pedir de nuevo no terminaría.
      if (this.seen.has(key)) throw repeatedRow(this.what, key);
      this.seen.add(key);
      this.rows.push(row);
    }
    if (page.length === 0) return true;
    // Solo un total que coincide con lo recibido termina la lista. Si la API contesta `*` en lugar del total (el
    // cliente lo deja como "no es un número"), o un total menor que lo que mandó (no puede ser: no se le cree), se
    // sigue hasta la página vacía.
    return count === page.length;
  }
}

/**
 * El error de una lista que no avanza. Qué lista y qué fila van al registro; el texto que ve la persona no nombra
 * funciones de la base. `permanent`: nada lo reintenta solo (quien lo muestra ofrece reintentar), así que el texto no
 * promete «se vuelve a intentar».
 */
export function repeatedRow(what: string, key: string, permanent = false): RemoteError {
  console.warn(`Lista ${what}: la fila ${key} llegó dos veces.`);
  return new RemoteError(stored(permanent ? 'sync.listRepeatedStuck' : 'sync.listRepeated'), permanent);
}

/**
 * Las filas de una lista que se pide **en un solo pedido** (una función de la base sin lugar desde dónde seguir). Si
 * la API dice que había más filas que las que mandó, es un error: nunca una lista cortada que parezca entera.
 *
 * Solo para listas que con el tope de fábrica entran siempre y cuya pantalla muestra el error. Una lista que puede
 * pasar de 1000 filas de verdad (lo apartado de los links, la papelera de un proyecto), o una que quien la pide deja
 * vacía ante un error, queda peor con esto que con una parte: ahí va lo que llega, o se pagina por clave
 * (Docs/Doc_Sincronizacion.md, "Las listas largas", la tabla).
 */
export function wholeList<T>(data: unknown, count: number | null | undefined): T[] {
  const rows = (Array.isArray(data) ? data : []) as T[];
  // No es un rechazo (no dice nada de lo pedido): quien llama no concluye nada y puede volver a pedir.
  if (typeof count === 'number' && count > rows.length) throw new RemoteError(t('sync.listCut'), false, LIST_CUT);
  return rows;
}

/** Un valor de texto adentro de un filtro `or(...)` armado a mano: entre comillas, con las comillas escapadas. */
export function quoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * El filtro `or(...)` de "lo que sigue a esta fila" en un orden ascendente de dos columnas (`a`, `b`): `a` mayor, o
 * `a` igual y `b` mayor. La segunda columna desempata, así el orden es total.
 */
export function afterPair(a: string, aValue: string, b: string, bValue: string): string {
  return `${a}.gt.${quoted(aValue)},and(${a}.eq.${quoted(aValue)},${b}.gt.${quoted(bValue)})`;
}

/** El lugar de una fila en un orden por fecha y, a igual fecha, por id; tira si a la fila le falta la fecha. */
export function placeOf(what: string, at: unknown, id: string): { at: string; id: string } {
  if (typeof at !== 'string' || !at) {
    console.warn(`Lista ${what}: la fila ${id} llegó sin su fecha.`);
    throw new RemoteError(stored('sync.listNoDate'), false);
  }
  return { at, id };
}
