// Cliente mínimo de la Management API de Supabase (https://api.supabase.com/v1/projects/<ref>/...), sin
// dependencias. Lo usan scripts/db-migrate.mjs y scripts/setup-workspace.mjs.
//
// Modo "solo mirar" (dryRun): el cliente mismo se niega a mandar cualquier pedido que no sea un GET o una
// consulta SQL de solo lectura armada con readOnlySql(). Es la última barrera: aunque una rama del comando
// se equivocara, en dry-run no sale ningún POST/PATCH ni SQL que escriba.

const API = 'https://api.supabase.com/v1';

// Una consulta de solo lectura: una sola sentencia select (o with) dentro de una transacción READ ONLY que
// se deshace. Postgres rechaza cualquier escritura dentro (insert, update, delete, create, nextval, una
// función que escriba). Sin ";" adentro: así entre el begin y el rollback hay exactamente una sentencia.
// El endpoint /database/query devuelve las filas de la última sentencia que dio filas: con una sola
// select, una lista vacía quiere decir que no hubo filas.
const READ_ONLY_RE = /^begin read only;\n\s*(select|with)\b[^;]*;\nrollback;$/i;

export function readOnlySql(select) {
  const sql = select.trim();
  if (sql.includes(';')) throw new Error(`Read-only query with ";": ${sql.slice(0, 80)}`);
  if (!/^(select|with)\b/i.test(sql)) throw new Error(`Read-only query that is not a select: ${sql.slice(0, 80)}`);
  return `begin read only;\n${sql};\nrollback;`;
}

export function isReadOnlyQuery(sql) {
  return typeof sql === 'string' && READ_ONLY_RE.test(sql);
}

// ¿Este pedido puede salir en dry-run? Solo GET, o POST a /database/query con una consulta de solo lectura.
export function allowedInDryRun(method, url, body) {
  if (method === 'GET') return true;
  if (method !== 'POST' || !/^https:\/\/api\.supabase\.com\/v1\/projects\/[a-z0-9]+\/database\/query$/.test(url)) {
    return false;
  }
  try {
    return isReadOnlyQuery(JSON.parse(body).query);
  } catch {
    return false;
  }
}

export function createManagementClient({ ref, token, dryRun = false, fetch: fetchImpl = globalThis.fetch }) {
  if (!/^[a-z0-9]{20}$/.test(ref ?? '')) throw new Error('Invalid project ref: it must be 20 lowercase letters and numbers.');
  const base = `${API}/projects/${ref}`;

  // `target` es una ruta del proyecto ("/config/auth") o una dirección completa (la API de Auth del
  // proyecto, para invitar). `headers` reemplaza los de la Management API (por ejemplo, otra autorización).
  async function request(method, target, { body, headers } = {}) {
    const url = target.startsWith('https://') ? target : `${base}${target}`;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (dryRun && !allowedInDryRun(method, url, payload)) {
      throw new Error(`Dry run: stopped a ${method} to ${url.replace(/\?.*$/, '')}. Nothing was written.`);
    }
    const h = headers ?? {};
    if (!headers && token) h.Authorization = `Bearer ${token}`;
    if (payload !== undefined) h['Content-Type'] = 'application/json';
    const res = await fetchImpl(url, { method, headers: h, body: payload });
    const text = await res.text();
    if (!res.ok) {
      const hint =
        res.status === 401
          ? ' (is SUPABASE_ACCESS_TOKEN missing, or not from the account that owns the project?)'
          : '';
      throw new Error(`${method} ${url.replace(/\?.*$/, '')}: ${res.status}${hint}: ${text.slice(0, 500)}`);
    }
    return text ? JSON.parse(text) : null;
  }

  return {
    ref,
    dryRun,
    request,
    get: (path) => request('GET', path),
    patch: (path, body) => request('PATCH', path, { body }),
    // SQL que puede escribir. En dry-run el cliente lo frena.
    query: (sql) => request('POST', '/database/query', { body: { query: sql } }),
    // SQL de solo lectura: una sentencia select, envuelta en begin read only … rollback.
    readQuery: (select) => request('POST', '/database/query', { body: { query: readOnlySql(select) } }),
  };
}

// Texto SQL entre comillas simples (standard_conforming_strings está prendido en Supabase).
export const quote = (s) => `'${String(s).replaceAll("'", "''")}'`;
