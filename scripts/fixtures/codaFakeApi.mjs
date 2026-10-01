// Una API de Coda de mentira para correr scripts/coda-export.mjs entero sin red (scripts/coda-export-run.test.mjs).
// Se carga antes del comando (`node --import`), sin tocar el comando:
//   - `fetch` contesta desde un doc inventado (`CODA_FAKE`: la ruta de un JSON con `doc`, `pages` y `media`) y
//     anota cada pedido en `CODA_FAKE_LOG` (método, dirección y si llevaba el token);
//   - las esperas de la exportación (uno a tres segundos por página) no esperan;
//   - `import('heic-convert')` da un conversor de mentira (`CODA_FAKE_HEIC=fake`) o falla como si no estuviera
//     instalado (`missing`), aunque la librería de verdad esté en node_modules.

import { appendFileSync, readFileSync } from 'node:fs'
import { register } from 'node:module'

const fake = JSON.parse(readFileSync(process.env.CODA_FAKE, 'utf8'))
const API = 'https://coda.io/apis/v1'
const log = (line) => appendFileSync(process.env.CODA_FAKE_LOG, line + '\n')
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

globalThis.fetch = async (input, init = {}) => {
  const url = String(input)
  const method = init.method ?? 'GET'
  const auth = new Headers(init.headers).get('authorization')
  log(`${method} ${url}${auth ? ' (token)' : ''}`)
  const { doc } = fake
  const path = url.startsWith(API) ? new URL(url).pathname.slice('/apis/v1'.length) : null
  if (path !== null) {
    if (auth !== 'Bearer token-de-prueba') return json({ message: 'Unauthorized' }, 401)
    if (path === `/docs/${doc.id}`) return json(doc)
    if (path === `/docs/${doc.id}/pages`) return json({ items: fake.pages.map(({ html: _html, ...p }) => p) })
    if (path === `/docs/${doc.id}/tables`) return json({ items: [] })
    const exportStart = path.match(/^\/docs\/[^/]+\/pages\/([^/]+)\/export$/)
    if (exportStart && method === 'POST') return json({ href: `${API}/docs/${doc.id}/pages/${exportStart[1]}/export/req-1` })
    const exportStatus = path.match(/^\/docs\/[^/]+\/pages\/([^/]+)\/export\/req-1$/)
    if (exportStatus) return json({ status: 'complete', downloadLink: `https://codahosted.io/export/${exportStatus[1]}.html` })
    return json({ message: 'Not found' }, 404)
  }
  const exported = url.match(/^https:\/\/codahosted\.io\/export\/([^/]+)\.html$/)
  if (exported) {
    const page = fake.pages.find((p) => p.id === exported[1])
    return page ? new Response(page.html, { headers: { 'content-type': 'text/html' } }) : new Response('', { status: 404 })
  }
  const media = fake.media[url]
  if (media) {
    const bytes = Buffer.from(media.base64, 'base64')
    return new Response(bytes, { headers: { 'content-type': media.type, 'content-length': String(bytes.length) } })
  }
  return new Response('', { status: 404 })
}

const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, Math.min(Number(ms) || 0, 5), ...args)

register('./codaFakeHooks.mjs', import.meta.url, {
  data: { mode: process.env.CODA_FAKE_HEIC ?? 'missing', converter: new URL('./fakeHeicConvert.mjs', import.meta.url).href },
})
