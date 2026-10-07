import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Para las pruebas: la API de la base de mentira, **en el nivel de los pedidos HTTP**, con lo que hace PostgREST. El
// cliente es el de verdad (`createClient`), así que lo que se prueba es la dirección que arma: filtros, orden, límite
// y el pedido del total. Lo que imita:
//
// - **El tope de filas por pedido** (`maxRows`, el ajuste *Max rows* del proyecto): la respuesta nunca trae más, pida lo
//   que pida el límite, y no avisa que recortó.
// - **El total** (`Prefer: count=exact`): va en `Content-Range`, contado después de los filtros y antes del límite.
// - **Sin orden escrito no hay orden**: cada pedido entrega las filas empezando por otro lado.
// - Los filtros que usa la app (`eq`, `gt`, `lt`, `in`, `is`, `not.is` y `or=(…, and(…))`), el orden por varias
//   columnas con sus nulos, `limit` y `offset`; y las funciones (`/rpc/…`), con sus argumentos y los mismos filtros.
// - **Solo las columnas pedidas** (`select`): si un pedido deja de pedir una columna, la prueba lo ve.
// - Una función puede contestar algo que no es una lista (un `json`: va tal cual) o un error (lo tira: `FakeFailure`).

export type FakeRow = Record<string, unknown>;

export interface FakeRequest {
  /** La tabla o `rpc/<función>`. */
  target: string;
  /** Los argumentos de la función. */
  args: Record<string, unknown> | null;
  /** Los parámetros de la dirección (`select`, `order`, `limit`, los filtros…). */
  query: Record<string, string>;
  /** Pidió el total. */
  counted: boolean;
  /** Cuántas filas se le contestaron. */
  rows: number;
}

/** El error con que contesta un pedido (lo que una función de la base levanta con `raise`). */
export interface FakeFailure {
  status: number;
  code: string;
  message: string;
}

export interface FakePostgrestOptions {
  tables?: Record<string, FakeRow[]>;
  /** Lo que devuelve cada función, en su propio orden (que el pedido no hereda si no lo escribe). */
  functions?: Record<string, (args: Record<string, unknown>) => FakeRow[] | FakeRow>;
  /** El tope de filas por pedido (de fábrica, 1000). */
  maxRows?: number;
  /** Una API que no manda el total aunque se lo pidan. */
  noCount?: boolean;
  /** Una API que miente el total: dice 1, mande lo que mande (no debería pasar; la app no tiene que creerle). */
  lowCount?: boolean;
  /** Una API que cuenta de más: dice cinco filas más de las que hay. */
  overCount?: boolean;
  /** Lo que pasa en la base justo antes de contestar el pedido número tal (desde 1). */
  before?: (request: number) => void;
  /** El pedido número tal contesta este error. */
  fail?: Record<number, FakeFailure>;
  /** Las columnas que una tabla o vista no tiene: pedirlas en `select` da `42703`. */
  missingColumns?: Record<string, string[]>;
}

type Check = (row: FakeRow) => boolean;

const unquote = (v: string) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\(.)/g, '$1') : v);

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' || typeof b === 'number') return Number(a) - Number(b);
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/** Una condición `op.valor` sobre una columna. */
function condition(column: string, rest: string): Check {
  const negated = rest.startsWith('not.');
  const body = negated ? rest.slice(4) : rest;
  const dot = body.indexOf('.');
  const op = body.slice(0, dot);
  const raw = body.slice(dot + 1);
  const value = unquote(raw);
  const check: Check =
    op === 'eq' ? (r) => r[column] != null && compare(r[column], value) === 0
    : op === 'gt' ? (r) => r[column] != null && compare(r[column], value) > 0
    : op === 'lt' ? (r) => r[column] != null && compare(r[column], value) < 0
    : op === 'is' ? (r) => (value === 'null' ? r[column] == null : r[column] === (value === 'true'))
    : op === 'in' ? ((list) => (r: FakeRow) => list.includes(String(r[column]).toLowerCase()))(raw.slice(1, -1).split(',').map((v) => unquote(v).toLowerCase()))
    : () => {
        throw new Error(`fakePostgrest: operador sin imitar: ${op}`);
      };
  return negated ? (r) => !check(r) : check;
}

/** Parte por comas una lista de condiciones, sin cortar adentro de comillas ni de paréntesis. */
function splitTop(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quotedNow = false;
  let current = '';
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (quotedNow && c === '\\') current += c + list[++i];
    else if (c === '"') { quotedNow = !quotedNow; current += c; }
    else if (!quotedNow && c === '(') { depth++; current += c; }
    else if (!quotedNow && c === ')') { depth--; current += c; }
    else if (!quotedNow && depth === 0 && c === ',') { parts.push(current); current = ''; }
    else current += c;
  }
  if (current) parts.push(current);
  return parts;
}

/** `(a.gt.1,and(a.eq.1,b.gt.2))`: alguna (`any`) o todas las condiciones de la lista. */
function logic(list: string, any: boolean): Check {
  const checks = splitTop(list.slice(1, -1)).map((term): Check => {
    if (term.startsWith('and(')) return logic(term.slice(3), false);
    if (term.startsWith('or(')) return logic(term.slice(2), true);
    const dot = term.indexOf('.');
    return condition(term.slice(0, dot), term.slice(dot + 1));
  });
  return (row) => (any ? checks.some((c) => c(row)) : checks.every((c) => c(row)));
}

function sorter(order: string): (a: FakeRow, b: FakeRow) => number {
  const keys = order.split(',').map((part) => {
    const [column, ...flags] = part.split('.');
    const desc = flags.includes('desc');
    // Como Postgres: los nulos van últimos al subir y primeros al bajar, salvo que el pedido diga otra cosa.
    const nullsFirst = flags.includes('nullsfirst') || (desc && !flags.includes('nullslast'));
    return { column, desc, nullsFirst };
  });
  return (a, b) => {
    for (const { column, desc, nullsFirst } of keys) {
      const x = a[column] ?? null;
      const y = b[column] ?? null;
      if (x === null && y === null) continue;
      if (x === null || y === null) return (x === null) === nullsFirst ? -1 : 1;
      const c = compare(x, y);
      if (c !== 0) return desc ? -c : c;
    }
    return 0;
  };
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'or', 'and']);

/**
 * Lo que la API hace con las filas de una tabla o de una función: los filtros, el orden escrito (sin él, `turn` las
 * da empezando por otro lado y al revés), el límite pedido y el tope de filas. `total`: cuántas había después de los
 * filtros y antes del límite.
 */
export function answerRows(source: FakeRow[], params: URLSearchParams, maxRows: number, turn: number): { page: FakeRow[]; total: number; offset: number } {
  const checks: Check[] = [];
  for (const [key, value] of params) {
    if (key === 'or') checks.push(logic(value, true));
    else if (key === 'and') checks.push(logic(value, false));
    else if (!RESERVED.has(key)) checks.push(condition(key, value));
  }
  const matching = source.filter((row) => checks.every((c) => c(row)));
  const order = params.get('order');
  const from = turn % Math.max(matching.length, 1);
  const listed = order ? [...matching].sort(sorter(order)) : [...matching.slice(from), ...matching.slice(0, from)].reverse();
  const offset = Number(params.get('offset') ?? 0);
  const limit = Math.min(params.get('limit') === null ? Infinity : Number(params.get('limit')), maxRows);
  return { page: listed.slice(offset, offset + limit), total: matching.length, offset };
}

export function fakePostgrest(options: FakePostgrestOptions = {}): { client: SupabaseClient; requests: FakeRequest[]; tables: Record<string, FakeRow[]> } {
  const tables = options.tables ?? {};
  const requests: FakeRequest[] = [];
  const maxRows = options.maxRows ?? 1000;
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

  const answer = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const target = url.pathname.replace(/^\/rest\/v1\//, '');
    const args = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const query = Object.fromEntries(url.searchParams);
    const counted = /count=exact/.test(new Headers(init?.headers).get('prefer') ?? '');
    const request: FakeRequest = { target, args, query, counted, rows: 0 };
    requests.push(request);
    options.before?.(requests.length);
    const failure = options.fail?.[requests.length];
    if (failure) return json(failure.status, { code: failure.code, message: failure.message, details: null, hint: null });

    let source: FakeRow[];
    if (target.startsWith('rpc/')) {
      const fn = options.functions?.[target.slice(4)];
      if (!fn) return json(404, { code: 'PGRST202', message: `Could not find the function public.${target.slice(4)}`, details: null, hint: null });
      let result: FakeRow[] | FakeRow;
      try {
        result = fn(args ?? {});
      } catch (err) {
        const failed = err as FakeFailure;
        return json(failed.status, { code: failed.code, message: failed.message, details: null, hint: null });
      }
      if (!Array.isArray(result)) return json(200, result);
      source = result;
    } else {
      if (!tables[target]) return json(404, { code: 'PGRST205', message: `Could not find the table public.${target}`, details: null, hint: null });
      const asked = (query.select ?? '*').split(',').map((c) => c.trim());
      const missing = asked.find((c) => options.missingColumns?.[target]?.includes(c));
      if (missing) return json(400, { code: '42703', message: `column ${target}.${missing} does not exist`, details: null, hint: null });
      source = tables[target];
    }

    // Sin orden escrito, cada pedido las da empezando por otro lado y al revés.
    const { page, total: matched, offset } = answerRows(source, url.searchParams, maxRows, requests.length);
    request.rows = page.length;
    const total = counted && !options.noCount ? (options.lowCount ? '1' : String(matched + (options.overCount ? 5 : 0))) : '*';
    const range = page.length > 0 ? `${offset}-${offset + page.length - 1}` : '*';
    // Solo las columnas pedidas (`select`): una que el pedido dejó de pedir no llega, y una que la fila no tiene va nula.
    const columns = !query.select || query.select.trim() === '*' ? null : query.select.split(',').map((c) => c.trim());
    const shaped = page.map((row) => (columns ? Object.fromEntries(columns.map((c) => [c, row[c] ?? null])) : { ...row }));
    return json(counted && page.length < matched ? 206 : 200, shaped, { 'content-range': `${range}/${total}` });
  };

  const client = createClient('https://base.test', 'clave-publica', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: answer },
  });
  return { client, requests, tables };
}
