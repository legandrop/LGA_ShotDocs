// Lo que scripts/coda-export.mjs necesita decidir sin red (probado en scripts/coda-export.test.mjs).

import { createHash } from 'node:crypto'

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
 * El nombre (sin extensión) con que se guarda un archivo de Coda en media/: el blob (`bl-…`), estable entre
 * corridas. Una dirección sin blob usa un hash de la dirección entera: dos direcciones distintas nunca
 * comparten nombre.
 */
export function mediaBaseName(url) {
  const blob = url.match(/\/blobs\/(bl-[A-Za-z0-9_-]+)/)?.[1]
  if (blob) return blob
  return 'url-' + createHash('sha256').update(url).digest('hex').slice(0, 20)
}

/** `node coda-export.mjs "<doc>" [carpeta] [--refresh]`. */
export function parseExportArgs(argv) {
  const flags = argv.filter((a) => a.startsWith('--'))
  const rest = argv.filter((a) => !a.startsWith('--'))
  const unknown = flags.filter((f) => f !== '--refresh')
  if (unknown.length) throw new Error(`Opción desconocida: ${unknown.join(' ')}`)
  return { nameOrId: rest[0], out: rest[1], refresh: flags.includes('--refresh') }
}
