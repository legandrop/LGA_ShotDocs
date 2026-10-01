// Fotos HEIC/HEIF (las del iPhone) de un doc de Coda → JPEG. Lo usa scripts/coda-export.mjs después de bajar.
//
// La app acepta un HEIC y lo sube, pero Chrome no lo decodifica: no le arma miniatura y la página no lo
// muestra (en Coda se veía porque Coda lo convierte al mostrarlo). Por eso el comando deja, para cada HEIC:
//   - `media/<blob>.jpg`: el JPEG que importa la app (mismo nombre de blob, así lo encuentran los dos lugares
//     que buscan por ese prefijo: la bajada, que no lo pide de nuevo, y la importación);
//   - `media-originals/<blob>.heic`: el original, fuera de lo que se importa (la app solo mira `media/`).
// Y en lo que se importa, el tipo y el nombre de esa foto pasan a ser los del JPEG (`rewriteHeicHtml`), y la
// entrada del manifest apunta al JPEG (`applyHeic`). El HTML de Coda queda intacto: lo cambiado va a
// `pages/*.import.html`, como con las tablas.
//
// Lo convertido se sabe mirando el disco (el original en `media-originals/` y su JPEG en `media/`), no por lo
// que hizo esta corrida: por eso se puede cortar, repetir y correr con `--refresh` sin convertir dos veces.
// La librería (`heic-convert`: libheif en wasm, JavaScript puro) NO está en package.json: se carga con
// `import()` y, si no está instalada, el comando sigue sin convertir y lo anota como problema.

import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { mediaBaseName } from './codaExport.mjs'

/** La carpeta de los originales, al lado de `media/` (la importación busca solo adentro de `media/`). */
export const ORIGINALS = 'media-originals'
export const HEIC_LIBRARY = 'heic-convert'
export const HEIC_INSTALL = `npm i --no-save ${HEIC_LIBRARY}`
// 0,92: alta, sin que el archivo se dispare (es también la calidad por defecto de la librería).
const JPEG_QUALITY = 0.92
const JPEG_TYPE = 'image/jpeg'

const HEIC_FILE = /\.hei[cf]$/i
const JPEG_FILE = /\.jpe?g$/i
const HOSTED = /^https:\/\/(?:codahosted\.io|coda\.io\/blobs|docs\.superhuman\.com\/blobs)\//

export const isHeic = (file) => HEIC_FILE.test(file)
const baseOf = (file) => String(file).replace(/\.[^.]+$/, '')

/**
 * El archivo ya bajado de un blob en `media/` (o `null`). Si un corte dejó el HEIC y su JPEG juntos, vale el
 * JPEG: es el que se importa.
 */
export function storedMedia(files, base) {
  const found = files.filter((f) => f.startsWith(base + '.') && !f.endsWith('.part'))
  return found.find((f) => !isHeic(f)) ?? found[0] ?? null
}

/**
 * Qué hay que hacer con cada HEIC, mirando solo los nombres de `media/` y de `media-originals/`:
 *   - `convert`: sin JPEG todavía (el HEIC está en `media/`; o solo quedó el original, si alguien borró el JPEG);
 *   - `move`: el JPEG ya está y el HEIC sigue en `media/` (un corte justo antes de moverlo): solo se mueve;
 *   - `done`: convertido en una corrida anterior.
 */
export function heicPlan(media, originals) {
  const live = media.filter((f) => !f.endsWith('.part'))
  const jpegs = new Map(live.filter((f) => JPEG_FILE.test(f)).map((f) => [baseOf(f), f]))
  const plan = { convert: [], move: [], done: [] }
  const seen = new Set()
  const each = (files, visit) => {
    for (const file of files.filter((f) => isHeic(f)).sort()) {
      const base = baseOf(file)
      if (seen.has(base)) continue
      seen.add(base)
      visit({ base, file, jpeg: jpegs.get(base) ?? `${base}.jpg` }, jpegs.has(base))
    }
  }
  each(live, (item, hasJpeg) => (hasJpeg ? plan.move : plan.convert).push({ ...item, dir: 'media' }))
  each(originals, (item, hasJpeg) => (hasJpeg ? plan.done : plan.convert).push({ ...item, dir: ORIGINALS }))
  return plan
}

/**
 * Convierte lo que falta. `io` toca el disco (`read(dir, file)`, `write(file, datos)` entero o nada en
 * `media/`, `move(file)` de `media/` a los originales, `size(file)` en `media/`) y `load` trae el conversor
 * (`{ convert }`, o `{ convert: null, error }` si la librería no está). Un HEIC que falla queda como estaba y
 * anotado; los demás siguen.
 *
 * @returns {Promise<{ converted: Map<string, { file: string, bytes: number }>, stats: object, problems: string[] }>}
 */
export async function convertHeic({ media, originals, io, load, log = () => {} }) {
  const plan = heicPlan(media, originals)
  const converted = new Map()
  const problems = []
  const stats = { total: plan.convert.length + plan.move.length + plan.done.length, converted: 0, already: 0, failed: 0, pending: 0 }
  const keep = async (item) => converted.set(item.base, { file: item.jpeg, bytes: await io.size(item.jpeg) })
  // El JPEG ya vale aunque el original no se pueda mover: queda anotado y se reintenta en la corrida siguiente.
  const moveOriginal = async (item) => {
    if (item.dir !== 'media') return
    try {
      await io.move(item.file)
    } catch (e) {
      problems.push(`foto HEIC ${item.file}: convertida, pero el original no se pudo mover a ${ORIGINALS}/ (${e.message})`)
    }
  }
  for (const item of plan.done) {
    await keep(item)
    stats.already++
  }
  for (const item of plan.move) {
    await moveOriginal(item)
    await keep(item)
    stats.already++
  }
  if (!plan.convert.length) return { converted, stats, problems }

  // La librería se carga recién acá: un doc sin HEIC (o con todo convertido) no la necesita.
  const { convert, error } = await load()
  if (!convert) {
    const n = (stats.pending = plan.convert.length)
    const what = n === 1 ? '1 foto HEIC sin convertir: la app no la va a mostrar' : `${n} fotos HEIC sin convertir: la app no las va a mostrar`
    problems.push(`${what} (${error ?? 'falta el conversor'}; se instala con: ${HEIC_INSTALL})`)
    return { converted, stats, problems }
  }
  for (const [i, item] of plan.convert.entries()) {
    const started = Date.now()
    let input
    let output
    try {
      input = await io.read(item.dir, item.file)
      output = await convert(input)
      // Lo que no empieza como un JPEG no se guarda con nombre de JPEG.
      if (!output || output.length < 4 || output[0] !== 0xff || output[1] !== 0xd8) throw new Error('el conversor no devolvió un JPEG')
      await io.write(item.jpeg, output)
    } catch (e) {
      stats.failed++
      problems.push(`foto HEIC ${item.file}: no se pudo convertir (${e?.message ?? e}); queda como estaba y la app no la va a mostrar`)
      log({ ...item, index: i, total: plan.convert.length, error: e })
      continue
    }
    await moveOriginal(item)
    converted.set(item.base, { file: item.jpeg, bytes: output.length })
    stats.converted++
    log({ ...item, index: i, total: plan.convert.length, heicBytes: input.length, jpegBytes: output.length, ms: Date.now() - started })
  }
  return { converted, stats, problems }
}

/**
 * El conversor de verdad: `heic-convert`, si está instalado. Aplica la orientación de la foto (lo hace
 * libheif) y le pasa al JPEG el perfil de color del HEIC.
 */
export async function loadHeicConverter(importer = (name) => import(name)) {
  let mod
  try {
    mod = await importer(HEIC_LIBRARY)
  } catch (e) {
    const missing = e?.code === 'ERR_MODULE_NOT_FOUND' || e?.code === 'MODULE_NOT_FOUND'
    return { convert: null, error: missing ? `falta la librería ${HEIC_LIBRARY}` : `${HEIC_LIBRARY} no cargó: ${e?.message ?? e}` }
  }
  const run = mod.default ?? mod
  return {
    convert: async (buffer) => jpegWithProfile(Buffer.from(await run({ buffer, format: 'JPEG', quality: JPEG_QUALITY })), heicColorProfile(buffer)),
  }
}

/**
 * El perfil de color (ICC) de un HEIC: el contenido de su caja `colr` de tipo `prof` (o `rICC`), o `null`. Las
 * fotos del iPhone están en Display P3: sin el perfil, el JPEG se leería como sRGB y se vería menos saturado
 * (la librería entrega los píxeles tal cual, sin perfil).
 */
export function heicColorProfile(input) {
  const heic = Buffer.isBuffer(input) ? input : Buffer.from(input)
  for (const type of ['prof', 'rICC']) {
    const at = heic.indexOf(Buffer.from(`colr${type}`, 'latin1'))
    if (at < 4) continue
    const end = at - 4 + heic.readUInt32BE(at - 4)
    const icc = heic.subarray(at + 8, end)
    // Un perfil ICC lleva la firma `acsp` en el byte 36: lo que no la tiene no se copia.
    if (end <= heic.length && icc.length >= 128 && icc.toString('latin1', 36, 40) === 'acsp') return icc
  }
  return null
}

/** Un JPEG con el perfil de color adentro (segmentos APP2 `ICC_PROFILE`, después de la cabecera JFIF). */
export function jpegWithProfile(jpeg, icc) {
  // Cada segmento lleva hasta 65.519 bytes del perfil (64 KB menos su propio largo, la firma y dos contadores).
  const MAX = 65519
  const count = icc ? Math.ceil(icc.length / MAX) : 0
  if (!count || count > 255 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg
  const segments = []
  for (let i = 0; i < count; i++) {
    const data = icc.subarray(i * MAX, (i + 1) * MAX)
    const head = Buffer.alloc(18)
    head.writeUInt16BE(0xffe2, 0)
    head.writeUInt16BE(data.length + 16, 2)
    head.write('ICC_PROFILE\0', 4, 'latin1')
    head[16] = i + 1
    head[17] = count
    segments.push(head, data)
  }
  // La cabecera JFIF (APP0), si está, tiene que seguir siendo lo primero.
  const at = jpeg[2] === 0xff && jpeg[3] === 0xe0 ? 4 + jpeg.readUInt16BE(4) : 2
  return Buffer.concat([jpeg.subarray(0, at), ...segments, jpeg.subarray(at)])
}

/** Si un problema del manifest es de los que anota `convertHeic` (empiezan con "foto HEIC" o "N fotos HEIC"). */
export const isHeicProblem = (text) => /^(?:\d+ fotos?|foto) HEIC /.test(text)

/** El resumen para el final del comando, o `null` si el doc no tiene fotos HEIC. */
export function heicSummary(stats) {
  if (!stats?.total) return null
  const parts = [`${stats.converted} convertidas a JPEG`, `${stats.already} ya estaban`, `${stats.failed} fallaron`]
  if (stats.pending) parts.push(`${stats.pending} sin convertir (${HEIC_INSTALL})`)
  const where = stats.converted + stats.already ? `. Los originales quedan en ${ORIGINALS}/` : ''
  return `Fotos HEIC: ${parts.join(', ')}${where}`
}

// Una etiqueta con sus atributos: una comilla adentro de un valor no la corta antes de tiempo.
const ATTRS = `((?:[^>"']|"[^"]*"|'[^']*')*)`
const MEDIA_TAG = new RegExp(`<(img|source|video|a)\\b${ATTRS}>`, 'gi')
const ANCHOR_TEXT = new RegExp(`(<a\\b${ATTRS}>)([^<]*?)\\.hei[cf](\\s*</a>)`, 'gi')

/** El archivo de Coda al que apunta una etiqueta (`src`, o `href` en un link): su nombre en `media/`, sin extensión. */
function tagBase(tag, attrs) {
  const url = attrs.match(tag.toLowerCase() === 'a' ? /\shref="([^"]*)"/i : /\ssrc="([^"]*)"/i)?.[1]
  // En el HTML los & van como &amp;: el nombre sale de la dirección como la ve el navegador (igual que al bajar).
  const plain = url?.replace(/&amp;/g, '&')
  return plain && HOSTED.test(plain) ? mediaBaseName(plain) : null
}

/**
 * El HTML de una página con sus fotos convertidas como lo que son ahora: `data-coda-mime-type="image/jpeg"` y
 * el nombre (`alt`, o el texto de un link al archivo) con extensión `.jpg`. La app toma de ahí el tipo y el
 * nombre: con `image/heic` o `.HEIC` guardaría un JPEG como si fuera un HEIC. No toca nada más.
 */
export function rewriteHeicHtml(html, isConverted) {
  const out = html.replace(MEDIA_TAG, (all, tag, attrs) => {
    const base = tagBase(tag, attrs)
    if (!base || !isConverted(base)) return all
    const next = attrs
      .replace(/(\sdata-coda-mime-type=")[^"]*(")/i, `$1${JPEG_TYPE}$2`)
      .replace(/(\salt="[^"]*?)\.hei[cf](")/i, '$1.jpg$2')
    return `<${tag}${next}>`
  })
  // Un adjunto llega como link al archivo y su texto es el nombre.
  return out.replace(ANCHOR_TEXT, (all, open, attrs, name, close) => {
    const base = tagBase('a', attrs)
    return base && isConverted(base) ? `${open}${name}.jpg${close}` : all
  })
}

/** La vista local (`pages/*.local.html`, para mirar en el navegador): la foto apunta al JPEG de `media/`. */
export function rewriteLocalHtml(html, converted) {
  return html.replace(/\.\.\/media\/([^"'\s)<>/]+)\.hei[cf]\b/gi, (all, base) => (converted.has(base) ? `../media/${converted.get(base).file}` : all))
}

/**
 * Deja el manifest y el HTML que se importa coherentes con lo convertido: cada entrada de `media` de una foto
 * convertida apunta al JPEG (con su tipo y su peso) y la página pasa a su `.import.html` si su HTML cambió.
 * Vale para cualquier página del manifest: con o sin tablas, fichas, grupos y embebidas. Sin nada convertido
 * devuelve lo mismo que recibió.
 *
 * @param {object} input
 * @param {{ pages: object[] }} input.manifest
 * @param {Map<string, string>} [input.files]  Lo que ya escribió la conversión de tablas (`pages/…` → HTML).
 * @param {(file: string) => string | null} input.html  El HTML de una página en el disco (`pages/<file>`).
 * @param {Map<string, { file: string, bytes: number }>} input.converted  De `convertHeic`.
 */
export function applyHeic({ manifest, files = new Map(), html, converted }) {
  if (!converted.size) return { manifest, files }
  const out = new Map(files)
  const isConverted = (base) => converted.has(base)
  const pages = manifest.pages.map((page) => {
    const media = (page.media ?? []).map((m) => {
      const jpeg = converted.get(baseOf(m.file))
      return jpeg ? { ...m, file: jpeg.file, type: JPEG_TYPE, bytes: jpeg.bytes } : m
    })
    let file = page.file
    const text = file ? (out.get(`pages/${file}`) ?? html(file)) : null
    const fixed = text == null ? null : rewriteHeicHtml(text, isConverted)
    if (fixed != null && fixed !== text) {
      // El HTML de Coda no se toca: lo cambiado va al `.import.html` (el mismo, si la página ya tenía uno).
      if (!file.endsWith('.import.html')) file = file.replace(/\.html$/, '.import.html')
      out.set(`pages/${file}`, fixed)
    }
    return { ...page, file, media }
  })
  return { manifest: { ...manifest, pages }, files: out }
}

// --- En el disco -------------------------------------------------------------------------------------------

const listDir = async (dir) => (existsSync(dir) ? readdir(dir) : [])

/** Si la carpeta exportada tiene fotos HEIC, convertidas o por convertir. */
export async function folderHasHeic(out) {
  return (await listDir(join(out, 'media'))).some(isHeic) || (await listDir(join(out, ORIGINALS))).some(isHeic)
}

/** `convertHeic` sobre una carpeta exportada. El JPEG se escribe entero o nada (`.part` y se renombra). */
export async function convertHeicFolder(out, { load = loadHeicConverter, log } = {}) {
  const mediaDir = join(out, 'media')
  const originalsDir = join(out, ORIGINALS)
  const io = {
    read: (dir, file) => readFile(join(out, dir, file)),
    write: async (file, data) => {
      await writeFile(join(mediaDir, file + '.part'), data)
      await rename(join(mediaDir, file + '.part'), join(mediaDir, file))
    },
    move: async (file) => {
      await mkdir(originalsDir, { recursive: true })
      await rename(join(mediaDir, file), join(originalsDir, file))
    },
    size: async (file) => (await stat(join(mediaDir, file))).size,
  }
  return convertHeic({ media: await listDir(mediaDir), originals: await listDir(originalsDir), io, load, log })
}
