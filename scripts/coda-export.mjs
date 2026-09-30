// Exporta un doc de Coda a una carpeta local: una página HTML por página de Coda, todas las imágenes y
// videos bajados a media/, y manifest.json con el árbol (padre, orden, título, subtítulo, ícono). La app la
// importa desde el selector de proyectos (Import from Coda…). Ver Docs/Doc_Importar_Coda.md.
//
// Uso:  node scripts/coda-export.mjs "<nombre del doc o id>" [carpeta de salida] [--refresh]
// Sale por defecto en %USERPROFILE%\Coda_Export\<doc> (en Mac, ~/Coda_Export/<doc>).
// Token: variable CODA_API_TOKEN o archivo %USERPROFILE%\.coda-token (nunca en el repo).
// Se puede cortar y volver a correr: lo ya bajado (páginas y archivos) no se vuelve a pedir. Por eso una
// página que cambió en Coda después de bajarla queda como estaba: `--refresh` vuelve a pedir el HTML de
// todas las páginas (los archivos no: cada blob de Coda es siempre el mismo archivo). Borrar la carpeta
// también sirve.

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createWriteStream, existsSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { homedir } from 'node:os'
import { join, extname } from 'node:path'
import { API, isCodaApi, mediaBaseName, parseExportArgs } from './lib/codaExport.mjs'

async function token() {
  if (process.env.CODA_API_TOKEN) return process.env.CODA_API_TOKEN.trim()
  const file = join(homedir(), '.coda-token')
  const saved = existsSync(file) ? (await readFile(file, 'utf8')).trim() : ''
  if (saved && saved !== 'PEGAR_ACA_EL_TOKEN') return saved
  throw new Error(`Falta el token: variable CODA_API_TOKEN o el archivo ${file}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let TOKEN

// Un pedido con reintentos: ante un corte de red (fetch tira), un 429 (límite de Coda) o un 5xx espera y
// vuelve a probar, hasta 8 veces. El token va solo a la API de Coda, nunca a las bajadas de archivos.
async function request(url, init = {}) {
  for (let attempt = 0; ; attempt++) {
    let res
    try {
      res = await fetch(url, init)
    } catch (err) {
      if (attempt >= 8) throw new Error(`Sin red al pedir ${url}: ${err.message}`)
      await sleep(2000 * 2 ** Math.min(attempt, 4))
      continue
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 8) throw Object.assign(new Error(`${res.status} en ${url} tras ${attempt} reintentos`), { status: res.status })
      await res.body?.cancel()
      await sleep(Number(res.headers.get('retry-after')) * 1000 || 2000 * 2 ** Math.min(attempt, 4))
      continue
    }
    return res
  }
}

async function api(path, init = {}) {
  const url = path.startsWith('http') ? path : API + path
  // El token va solo a la API de Coda: una dirección que devuelve la API (`href`, `nextPageLink`) y apunta a
  // otro lado no lo recibe.
  if (!isCodaApi(url)) throw new Error(`No se manda el token a una dirección que no es de la API de Coda: ${url}`)
  // Sin seguir redirecciones: que el token no viaje a otro sitio no depende de lo que haga el fetch de la
  // versión de Node con el encabezado al redirigir.
  const res = await request(url, {
    ...init,
    redirect: 'manual',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...init.headers },
  })
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel()
    throw new Error(`La API de Coda redirigió ${url} a ${res.headers.get('location') || '(sin dirección)'}: no se sigue con el token`)
  }
  const body = await res.text()
  if (!res.ok) throw Object.assign(new Error(`${res.status} en ${path}: ${body.slice(0, 300)}`), { status: res.status })
  return body ? JSON.parse(body) : null
}

// Escribe entero o nada: primero a un .part y después se renombra, así un corte no deja un archivo a medias
// que la corrida siguiente daría por bueno.
async function writeAtomic(path, data) {
  await writeFile(path + '.part', data)
  await rename(path + '.part', path)
}

async function listAll(path) {
  const items = []
  let url = path + (path.includes('?') ? '&' : '?') + 'limit=100'
  while (url) {
    const page = await api(url)
    items.push(...page.items)
    url = page.nextPageLink || null
  }
  return items
}

async function findDoc(nameOrId) {
  try {
    return await api(`/docs/${encodeURIComponent(nameOrId)}`)
  } catch (err) {
    // No es un id: se busca por nombre. Cualquier otro error (token inválido, Coda caído) se muestra tal cual.
    if (err.status !== 400 && err.status !== 404) throw err
  }
  const docs = await listAll(`/docs?query=${encodeURIComponent(nameOrId)}`)
  const exact = docs.filter((d) => d.name.trim().toLowerCase() === nameOrId.trim().toLowerCase())
  const pick = exact.length ? exact : docs
  if (pick.length !== 1) {
    const list = pick.map((d) => `  ${d.id}  ${d.name}`).join('\n') || '  (ninguno)'
    throw new Error(`No hay un único doc que se llame "${nameOrId}". Candidatos:\n${list}`)
  }
  return pick[0]
}

async function exportHtml(docId, pageId) {
  const begin = await api(`/docs/${docId}/pages/${pageId}/export`, {
    method: 'POST',
    body: JSON.stringify({ outputFormat: 'html' }),
  })
  for (let i = 0; i < 120; i++) {
    await sleep(i < 5 ? 1000 : 3000)
    const st = await api(begin.href)
    if (st.status === 'complete') {
      const res = await request(st.downloadLink)
      if (!res.ok) throw new Error(`No se pudo bajar el HTML de ${pageId}: ${res.status}`)
      return await res.text()
    }
    if (st.status === 'failed') throw new Error(`La exportación de ${pageId} falló: ${st.error}`)
  }
  throw new Error(`La exportación de ${pageId} no terminó en ~6 minutos`)
}

const EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'image/svg+xml': '.svg', 'image/heic': '.heic', 'video/mp4': '.mp4', 'video/quicktime': '.mov',
  'video/webm': '.webm', 'application/pdf': '.pdf',
}

// Archivos de Coda: src/href que apuntan a codahosted.io (o a coda.io/blobs). El resto (YouTube, Drive,
// Vimeo, etc.) queda como link externo y se anota en el manifest.
const HOSTED = /https:\/\/(?:codahosted\.io|coda\.io\/blobs|docs\.superhuman\.com\/blobs)\/[^"'\s)<>]+/g

async function download(url, dir) {
  // El nombre sale del blob id de la URL (bl-XXXX), estable entre corridas; sin blob, un hash de la URL.
  const blob = mediaBaseName(url)
  const done = (await readdir(dir)).find((f) => f.startsWith(blob + '.') && !f.endsWith('.part'))
  if (done && (await stat(join(dir, done))).size > 0) return { file: done, reused: true }
  const res = await request(url)
  if (!res.ok) throw new Error(`${res.status} al bajar ${url}`)
  const type = (res.headers.get('content-type') || '').split(';')[0].trim()
  const ext = EXT[type] || extname(new URL(url).pathname).toLowerCase() || '.bin'
  const path = join(dir, blob + ext)
  // En streaming: un video grande no pasa entero por la memoria.
  try {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(path + '.part'))
  } catch (err) {
    await rm(path + '.part', { force: true })
    throw err
  }
  const bytes = (await stat(path + '.part')).size
  const expected = Number(res.headers.get('content-length'))
  if (expected && bytes !== expected) {
    await rm(path + '.part', { force: true })
    throw new Error(`${url}: llegaron ${bytes} de ${expected} bytes`)
  }
  await rename(path + '.part', path)
  return { file: blob + ext, type, bytes }
}

async function main() {
  const { nameOrId, out: outArg, refresh } = parseExportArgs(process.argv.slice(2))
  if (!nameOrId) throw new Error('Uso: node coda-export.mjs "<nombre del doc>" [carpeta] [--refresh]')
  TOKEN = await token()
  const doc = await findDoc(nameOrId)
  const safe = doc.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || doc.id
  const out = outArg || join(homedir(), 'Coda_Export', safe)
  const pagesDir = join(out, 'pages')
  const mediaDir = join(out, 'media')
  await mkdir(pagesDir, { recursive: true })
  await mkdir(mediaDir, { recursive: true })
  console.log(`Doc: ${doc.name} (${doc.id}) -> ${out}`)

  const pages = await listAll(`/docs/${doc.id}/pages`)
  // El orden de listPages es el del árbol en Coda; el orden entre hermanos sale de `children` del padre.
  const byId = new Map(pages.map((p) => [p.id, p]))
  const manifest = { exportedAt: new Date().toISOString(), doc: { id: doc.id, name: doc.name, browserLink: doc.browserLink }, pages: [] }
  const problems = []

  for (const [i, p] of pages.entries()) {
    const siblings = p.parent ? byId.get(p.parent.id)?.children || [] : pages.filter((x) => !x.parent)
    const order = siblings.findIndex((c) => c.id === p.id)
    const htmlFile = `${String(i).padStart(3, '0')}_${p.id}.html`
    const entry = {
      id: p.id, name: p.name, subtitle: p.subtitle || '', icon: p.icon?.name || null,
      parentId: p.parent?.id || null, order, contentType: p.contentType, isHidden: p.isHidden,
      browserLink: p.browserLink, file: htmlFile, media: [], external: [],
    }
    manifest.pages.push(entry)
    const htmlPath = join(pagesDir, htmlFile)
    let html
    if (existsSync(htmlPath) && !refresh) {
      html = await readFile(htmlPath, 'utf8')
    } else if (p.contentType !== 'canvas') {
      problems.push(`${p.name}: página de tipo "${p.contentType}", no se exporta`)
      console.log(`  [${i + 1}/${pages.length}] ${p.name} (tipo ${p.contentType}, salteada)`)
      continue
    } else {
      process.stdout.write(`  [${i + 1}/${pages.length}] ${p.name} ... `)
      try {
        html = await exportHtml(doc.id, p.id)
      } catch (e) {
        problems.push(`${p.name}: ${e.message}`)
        console.log('ERROR')
        continue
      }
      console.log('ok')
    }
    // Guardamos el HTML original de Coda intacto; la versión con rutas locales va aparte.
    await writeAtomic(htmlPath, html)
    let local = html
    for (const raw of new Set(html.match(HOSTED) || [])) {
      // En el HTML los & van como &amp;: el manifest guarda la dirección como la ve el navegador.
      const url = raw.replace(/&amp;/g, '&')
      try {
        const got = await download(url, mediaDir)
        entry.media.push({ url, file: got.file, type: got.type, bytes: got.bytes })
        local = local.split(raw).join(`../media/${got.file}`)
      } catch (e) {
        problems.push(`${p.name}: ${e.message}`)
      }
    }
    for (const m of html.matchAll(/<(?:iframe|video|source|embed)[^>]+src="([^"]+)"/g)) entry.external.push(m[1])
    await writeAtomic(join(pagesDir, htmlFile.replace(/\.html$/, '.local.html')), local)
  }

  manifest.problems = problems
  await writeAtomic(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
  const files = manifest.pages.reduce((n, p) => n + p.media.length, 0)
  console.log(`\nListo: ${manifest.pages.length} páginas, ${files} archivos. Problemas: ${problems.length}`)
  for (const pr of problems) console.log('  - ' + pr)
  // Con problemas, sale con error: se vuelve a correr y trae solo lo que falta.
  if (problems.length) process.exitCode = 1
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
