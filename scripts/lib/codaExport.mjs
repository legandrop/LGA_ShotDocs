// Lo que scripts/coda-export.mjs necesita decidir sin red (probado en scripts/coda-export.test.mjs).

import { createHash } from 'node:crypto'
import { MODES as TABLE_MODES } from './codaTables.mjs'

export const API = 'https://coda.io/apis/v1'

/**
 * Si una dirección es de la API de Coda: solo a esas va el token. Las direcciones que devuelve la API
 * (`href` de una exportación, `nextPageLink`) se revisan igual antes de mandarlo.
 */
export function isCodaApi(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.host === 'coda.io' && u.pathname.startsWith('/apis/') && !u.username && !u.password
  } catch {
    return false
  }
}

/**
 * La dirección de lo que muestra una página embebida (`embeds.json`): una página de un doc de Coda
 * (`{ kind: 'coda', docId, slug }`, de `…/d/…_d<docId>/…_su<slug>`) o cualquier otra cosa como link
 * (`{ kind: 'link', url }`). `null` si no es una dirección https.
 */
export function parseEmbedUrl(url) {
  let u
  try {
    u = new URL(String(url ?? '').trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null
  if (u.host === 'coda.io' || u.host === 'docs.superhuman.com') {
    const docId = u.pathname.match(/^\/d\/(?:[^/]*_)?d([A-Za-z0-9_-]+)(?:\/|$)/)?.[1]
    const slug = codaPageSlug(u.href)
    if (docId && slug && u.pathname.split('/').filter(Boolean).length >= 3) return { kind: 'coda', docId, slug }
  }
  return { kind: 'link', url: u.href }
}

/**
 * El `_su<slug>` de una página de Coda: el del último tramo de la dirección (el nombre de la página puede
 * traer `_su` antes, como en "Resumen_super_suXyZ9").
 */
export function codaPageSlug(url) {
  try {
    const last = new URL(url).pathname.replace(/\/+$/, '').split('/').pop() ?? ''
    return last.match(/_su([A-Za-z0-9-]+)$/)?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * `embeds.json` (lo captura quien tiene el servidor MCP de Coda): `{ docId, pages: { <id de la página
 * embebida>: <dirección> } }`. Devuelve el mapa id → dirección; uno de otro doc o sin forma es un error claro.
 */
export function checkEmbeds(raw, docId) {
  const where = 'embeds.json'
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${where}: tiene que ser un objeto`)
  if (raw.docId !== docId) throw new Error(`${where}: es de otro doc (${raw.docId ?? 'sin docId'}, se esperaba ${docId})`)
  if (!raw.pages || typeof raw.pages !== 'object' || Array.isArray(raw.pages)) throw new Error(`${where}: falta "pages" { id: dirección }`)
  const out = new Map()
  for (const [id, url] of Object.entries(raw.pages)) if (typeof url === 'string' && url.trim()) out.set(id, url.trim())
  return out
}

/** Un archivo guardado en Coda (las fotos y adjuntos de las páginas y de las tablas): solo esos se bajan. */
export function isCodaHosted(url) {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false
    if (u.host === 'codahosted.io') return true
    return (u.host === 'coda.io' || u.host === 'docs.superhuman.com') && u.pathname.startsWith('/blobs/') && !u.pathname.includes('/../')
  } catch {
    return false
  }
}

/**
 * El nombre (sin extensión) con que se guarda un archivo de Coda en media/: el blob (`bl-…`), estable entre
 * corridas. Una dirección sin blob usa un hash de la dirección entera: dos direcciones distintas nunca
 * comparten nombre.
 */
export function mediaBaseName(url) {
  const blob = url.match(/\/blobs\/(bl-[A-Za-z0-9_-]+)/)?.[1]
  if (blob) return blob
  return 'url-' + createHash('sha256').update(url).digest('hex').slice(0, 20)
}

/**
 * `node coda-export.mjs "<doc>" [carpeta] [--refresh]`, o `--convert-only <carpeta exportada>` (convierte otra
 * vez las tablas de una carpeta ya bajada, sin red ni token).
 */
export function parseExportArgs(argv) {
  const flags = argv.filter((a) => a.startsWith('--'))
  const rest = argv.filter((a) => !a.startsWith('--'))
  const unknown = flags.filter((f) => f !== '--refresh' && f !== '--convert-only')
  if (unknown.length) throw new Error(`Opción desconocida: ${unknown.join(' ')}`)
  const convertOnly = flags.includes('--convert-only')
  if (convertOnly && flags.includes('--refresh')) throw new Error('--convert-only no baja nada: no va con --refresh')
  return { nameOrId: rest[0], out: rest[1], refresh: flags.includes('--refresh'), convertOnly }
}


/**
 * Revisa `tables.config.json` (opcional, en la carpeta exportada) y lo devuelve; un error dice qué está mal.
 * `tables`: modo por tabla (nombre o id); `index`: columnas del índice por tabla; `skipColumns`: columnas que
 * no van a las fichas, por tabla.
 */
export function checkTablesConfig(raw) {
  const where = 'tables.config.json'
  if (raw == null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${where}: tiene que ser un objeto`)
  const extra = Object.keys(raw).filter((k) => !['tables', 'index', 'skipColumns'].includes(k))
  if (extra.length) throw new Error(`${where}: clave desconocida ${extra.map((k) => `"${k}"`).join(', ')} (valen tables, index y skipColumns)`)
  const map = (key, check) => {
    const value = raw[key]
    if (value === undefined) return
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${where}: "${key}" tiene que ser un objeto { tabla: … }`)
    for (const [table, v] of Object.entries(value)) check(table, v)
  }
  map('tables', (table, mode) => {
    if (!TABLE_MODES.includes(mode)) throw new Error(`${where}: modo "${mode}" para "${table}" (valen ${TABLE_MODES.join(', ')})`)
  })
  const columns = (key) => (table, list) => {
    if (!Array.isArray(list) || !list.every((c) => typeof c === 'string' && c.trim())) {
      throw new Error(`${where}: "${key}" de "${table}" tiene que ser una lista de nombres de columna`)
    }
  }
  map('index', columns('index'))
  map('skipColumns', columns('skipColumns'))
  return raw
}
