// Pruebas de las fotos HEIC de Coda → JPEG (scripts/lib/codaHeic.mjs). Todo inventado: blobs, nombres y fotos.
// La decisión (qué se convierte, cómo quedan nombre, tipo, manifest y HTML) se prueba sin disco ni librería,
// con un conversor de mentira; aparte, lo mismo sobre una carpeta temporal y, si `heic-convert` está
// instalado, un HEIC de verdad.

import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { convertTables } from './lib/codaTables.mjs'
import {
  HEIC_INSTALL,
  ORIGINALS,
  applyHeic,
  convertHeic,
  convertHeicFolder,
  folderHasHeic,
  heicColorProfile,
  heicPlan,
  heicSummary,
  isHeicProblem,
  jpegWithProfile,
  loadHeicConverter,
  rewriteHeicHtml,
  rewriteLocalHtml,
  storedMedia,
} from './lib/codaHeic.mjs'

const blob = (id) => `https://codahosted.io/docs/D/blobs/${id}/x`
const JPEG = (text) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(text)])

/** Un disco de mentira: `media/` y los originales, con lo que se leyó, escribió y movió. */
function fakeDisk(media, originals = {}) {
  const disk = { media: new Map(Object.entries(media)), originals: new Map(Object.entries(originals)), writes: [], moves: [] }
  disk.io = {
    read: async (dir, file) => (dir === 'media' ? disk.media : disk.originals).get(file),
    write: async (file, data) => {
      disk.writes.push(file)
      disk.media.set(file, data)
    },
    move: async (file) => {
      disk.moves.push(file)
      disk.originals.set(file, disk.media.get(file))
      disk.media.delete(file)
    },
    size: async (file) => disk.media.get(file).length,
  }
  disk.run = (convert, extra = {}) => {
    const calls = { load: 0, convert: [] }
    const load = async () => {
      calls.load++
      return convert ? { convert: async (input) => (calls.convert.push(input.toString()), convert(input)) } : { convert: null, error: 'falta la librería heic-convert' }
    }
    return convertHeic({ media: [...disk.media.keys()], originals: [...disk.originals.keys()], io: disk.io, load, ...extra }).then((r) => ({ ...r, calls }))
  }
  return disk
}
const ok = (input) => JPEG(`jpeg de ${input}`)

describe('fotos HEIC: qué se convierte', () => {
  it('cada .heic o .heif de media/ sin su JPEG; lo demás no se toca', () => {
    const plan = heicPlan(['bl-a.heic', 'bl-b.HEIC', 'bl-c.heif', 'bl-d.jpg', 'bl-e.png', 'bl-f.mov', 'bl-g.heic.part', 'bl-h.jpg.part'], [])
    expect(plan.convert.map((c) => [c.file, c.jpeg, c.dir])).toEqual([
      ['bl-a.heic', 'bl-a.jpg', 'media'],
      ['bl-b.HEIC', 'bl-b.jpg', 'media'],
      ['bl-c.heif', 'bl-c.jpg', 'media'],
    ])
    expect(plan.move).toEqual([])
    expect(plan.done).toEqual([])
  })

  it('lo ya convertido se reconoce por el disco: el original en media-originals/ y su JPEG en media/', () => {
    const plan = heicPlan(['bl-a.jpg', 'bl-z.png'], ['bl-a.heic'])
    expect(plan.convert).toEqual([])
    expect(plan.done.map((d) => [d.base, d.jpeg])).toEqual([['bl-a', 'bl-a.jpg']])
  })

  it('un corte entre escribir el JPEG y mover el original: solo falta moverlo', () => {
    const plan = heicPlan(['bl-a.heic', 'bl-a.jpg'], [])
    expect(plan.convert).toEqual([])
    expect(plan.move.map((m) => m.file)).toEqual(['bl-a.heic'])
  })

  it('si alguien borró el JPEG, se rehace desde el original (sin red)', () => {
    const plan = heicPlan(['bl-z.png'], ['bl-a.heic'])
    expect(plan.convert.map((c) => [c.file, c.dir, c.jpeg])).toEqual([['bl-a.heic', ORIGINALS, 'bl-a.jpg']])
  })

  it('la bajada no pide de nuevo una foto convertida, y con el HEIC y su JPEG juntos vale el JPEG', () => {
    // Sin HEIC, lo mismo que antes: el primer archivo del blob que no sea un .part.
    expect(storedMedia(['bl-a.png', 'bl-ab.png', 'bl-b.mp4.part'], 'bl-a')).toBe('bl-a.png')
    expect(storedMedia(['bl-ab.png', 'bl-b.mp4.part'], 'bl-a')).toBeNull()
    expect(storedMedia(['bl-b.mp4.part'], 'bl-b')).toBeNull()
    expect(storedMedia(['bl-a.heic'], 'bl-a')).toBe('bl-a.heic')
    expect(storedMedia(['bl-a.jpg'], 'bl-a')).toBe('bl-a.jpg')
    expect(storedMedia(['bl-a.heic', 'bl-a.jpg'], 'bl-a')).toBe('bl-a.jpg')
  })
})

describe('fotos HEIC: la conversión, con un conversor de mentira', () => {
  it('deja el JPEG en media/ con el nombre del blob y mueve el original', async () => {
    const disk = fakeDisk({ 'bl-a.heic': Buffer.from('A'), 'bl-b.HEIC': Buffer.from('B'), 'bl-c.png': Buffer.from('C') })
    const logged = []
    const r = await disk.run(ok, { log: (x) => logged.push(x) })
    expect([...disk.media.keys()].sort()).toEqual(['bl-a.jpg', 'bl-b.jpg', 'bl-c.png'])
    expect([...disk.originals.keys()].sort()).toEqual(['bl-a.heic', 'bl-b.HEIC'])
    expect(disk.media.get('bl-a.jpg').toString()).toContain('jpeg de A')
    expect(r.converted.get('bl-a')).toEqual({ file: 'bl-a.jpg', bytes: disk.media.get('bl-a.jpg').length })
    expect(r.stats).toEqual({ total: 2, converted: 2, already: 0, failed: 0, pending: 0 })
    expect(r.problems).toEqual([])
    expect(logged.map((x) => [x.file, x.index, x.total, x.heicBytes])).toEqual([['bl-a.heic', 0, 2, 1], ['bl-b.HEIC', 1, 2, 1]])
    expect(heicSummary(r.stats)).toBe(`Fotos HEIC: 2 convertidas a JPEG, 0 ya estaban, 0 fallaron. Los originales quedan en ${ORIGINALS}/`)
  })

  it('correr de nuevo no convierte nada ni carga la librería: todo ya estaba', async () => {
    const disk = fakeDisk({ 'bl-a.heic': Buffer.from('A') })
    await disk.run(ok)
    disk.writes.length = 0
    const again = await disk.run(ok)
    expect(again.calls).toEqual({ load: 0, convert: [] })
    expect(disk.writes).toEqual([])
    expect(again.stats).toEqual({ total: 1, converted: 0, already: 1, failed: 0, pending: 0 })
    // Lo convertido vale igual para el manifest y el HTML.
    expect(again.converted.get('bl-a')).toEqual({ file: 'bl-a.jpg', bytes: disk.media.get('bl-a.jpg').length })
  })

  it('una foto nueva entre las ya convertidas: solo esa', async () => {
    const disk = fakeDisk({ 'bl-a.jpg': JPEG('viejo'), 'bl-n.heic': Buffer.from('N') }, { 'bl-a.heic': Buffer.from('A') })
    const r = await disk.run(ok)
    expect(r.calls.convert).toEqual(['N'])
    expect(disk.media.get('bl-a.jpg').toString()).toContain('viejo')
    expect(r.stats).toEqual({ total: 2, converted: 1, already: 1, failed: 0, pending: 0 })
  })

  it('un HEIC roto queda como estaba y anotado; los demás se convierten', async () => {
    const disk = fakeDisk({ 'bl-a.heic': Buffer.from('A'), 'bl-roto.heic': Buffer.from('ROTO'), 'bl-z.heic': Buffer.from('Z') })
    const r = await disk.run((input) => {
      if (input.toString() === 'ROTO') throw new TypeError('input buffer is not a HEIC image')
      return ok(input)
    })
    expect([...disk.media.keys()].sort()).toEqual(['bl-a.jpg', 'bl-roto.heic', 'bl-z.jpg'])
    expect(disk.originals.has('bl-roto.heic')).toBe(false)
    expect(r.converted.has('bl-roto')).toBe(false)
    expect(r.stats).toEqual({ total: 3, converted: 2, already: 0, failed: 1, pending: 0 })
    expect(r.problems).toEqual(['foto HEIC bl-roto.heic: no se pudo convertir (input buffer is not a HEIC image); queda como estaba y la app no la va a mostrar'])
    expect(r.problems.every(isHeicProblem)).toBe(true)
    expect(heicSummary(r.stats)).toContain('2 convertidas a JPEG, 0 ya estaban, 1 fallaron')
  })

  it('lo que devuelve el conversor y no es un JPEG no se guarda con nombre de JPEG', async () => {
    const disk = fakeDisk({ 'bl-a.heic': Buffer.from('A') })
    const r = await disk.run(() => Buffer.from('no soy un jpeg'))
    expect([...disk.media.keys()]).toEqual(['bl-a.heic'])
    expect(r.stats.failed).toBe(1)
    expect(r.problems[0]).toContain('el conversor no devolvió un JPEG')
  })

  it('sin la librería instalada: no convierte, no toca nada y lo dice con la forma de instalarla', async () => {
    const disk = fakeDisk({ 'bl-a.heic': Buffer.from('A'), 'bl-b.heic': Buffer.from('B'), 'bl-c.jpg': JPEG('c') }, { 'bl-c.heic': Buffer.from('C') })
    const r = await disk.run(null)
    expect(disk.writes).toEqual([])
    expect(disk.moves).toEqual([])
    expect(r.stats).toEqual({ total: 3, converted: 0, already: 1, failed: 0, pending: 2 })
    expect(r.problems).toEqual([`2 fotos HEIC sin convertir: la app no las va a mostrar (falta la librería heic-convert; se instala con: ${HEIC_INSTALL})`])
    expect(isHeicProblem(r.problems[0])).toBe(true)
    expect(HEIC_INSTALL).toBe('npm i --no-save heic-convert')
    // Con una sola, en singular; y lo que no es de las fotos HEIC no se confunde.
    const one = await fakeDisk({ 'bl-a.heic': Buffer.from('A') }).run(null)
    expect(one.problems[0]).toMatch(/^1 foto HEIC sin convertir: la app no la va a mostrar \(/)
    expect(heicSummary(one.stats)).toBe(`Fotos HEIC: 0 convertidas a JPEG, 0 ya estaban, 0 fallaron, 1 sin convertir (${HEIC_INSTALL})`)
    expect(isHeicProblem(one.problems[0])).toBe(true)
    expect(isHeicProblem('Página 3: página de tipo "embed", no se exporta')).toBe(false)
    // Lo convertido en una corrida anterior (con la librería) sigue valiendo.
    expect([...r.converted.keys()]).toEqual(['bl-c'])
    expect(heicSummary(r.stats)).toContain(`2 sin convertir (${HEIC_INSTALL})`)
  })

  it('después de un corte (el JPEG ya escrito, el original sin mover) solo mueve: no convierte ni carga la librería', async () => {
    const disk = fakeDisk({ 'bl-a.heic': Buffer.from('A'), 'bl-a.jpg': JPEG('hecho') })
    const r = await disk.run(ok)
    expect(r.calls.load).toBe(0)
    expect(disk.moves).toEqual(['bl-a.heic'])
    expect(disk.media.get('bl-a.jpg').toString()).toContain('hecho')
    expect(r.stats).toEqual({ total: 1, converted: 0, already: 1, failed: 0, pending: 0 })
  })

  it('si el original no se puede mover, el JPEG vale igual y queda anotado', async () => {
    const disk = fakeDisk({ 'bl-a.heic': Buffer.from('A') })
    disk.io.move = async () => {
      throw new Error('EPERM')
    }
    const r = await disk.run(ok)
    expect(r.converted.get('bl-a').file).toBe('bl-a.jpg')
    expect(r.stats.converted).toBe(1)
    expect(r.problems[0]).toMatch(/^foto HEIC bl-a\.heic: convertida, pero el original no se pudo mover/)
  })

  it('un doc sin HEIC: nada que hacer, sin cargar la librería ni tocar el disco', async () => {
    const disk = fakeDisk({ 'bl-a.jpg': JPEG('a'), 'bl-b.png': Buffer.from('b'), 'bl-c.mov': Buffer.from('c') })
    const r = await disk.run(ok)
    expect(r.calls.load).toBe(0)
    expect(disk.writes).toEqual([])
    expect(disk.moves).toEqual([])
    expect(r.converted.size).toBe(0)
    expect(r.stats.total).toBe(0)
    expect(heicSummary(r.stats)).toBeNull()
  })

  it('la librería se pide con JPEG a calidad 0,92; si no está, se sabe por qué', async () => {
    const asked = []
    const found = await loadHeicConverter(async (name) => ({ default: async (options) => (asked.push([name, options.format, options.quality, options.buffer.toString()]), JPEG('x')) }))
    expect((await found.convert(Buffer.from('heic'))).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]))
    expect(asked).toEqual([['heic-convert', 'JPEG', 0.92, 'heic']])
    const missing = await loadHeicConverter(async () => {
      throw Object.assign(new Error("Cannot find package 'heic-convert'"), { code: 'ERR_MODULE_NOT_FOUND' })
    })
    expect(missing).toEqual({ convert: null, error: 'falta la librería heic-convert' })
    const broken = await loadHeicConverter(async () => {
      throw new Error('wasm roto')
    })
    expect(broken).toEqual({ convert: null, error: 'heic-convert no cargó: wasm roto' })
  })
})

describe('fotos HEIC: el HTML que se importa', () => {
  const converted = new Set(['bl-a', 'bl-b'])
  const fix = (html) => rewriteHeicHtml(html, (base) => converted.has(base))
  const parse = (html) => new JSDOM(`<body>${html}</body>`).window.document

  it('la foto convertida queda con tipo image/jpeg y nombre .jpg; el resto de la etiqueta, igual', () => {
    const html = `<div><img src="${blob('bl-a')}" data-coda-blob-id="bl-a" data-coda-mime-type="image/heic" alt="IMG_0001.HEIC" width="350" height="263"></div>`
    expect(fix(html)).toBe(`<div><img src="${blob('bl-a')}" data-coda-blob-id="bl-a" data-coda-mime-type="image/jpeg" alt="IMG_0001.jpg" width="350" height="263"></div>`)
    const img = parse(fix(html)).querySelector('img')
    expect([img.getAttribute('data-coda-mime-type'), img.getAttribute('alt'), img.getAttribute('width')]).toEqual(['image/jpeg', 'IMG_0001.jpg', '350'])
  })

  it('una foto HEIC sin convertir (falló, o falta la librería) y las que no son HEIC quedan como estaban', () => {
    const html =
      `<img src="${blob('bl-roto')}" data-coda-mime-type="image/heic" alt="IMG_0002.HEIC">` +
      `<img src="${blob('bl-png')}" data-coda-mime-type="image/png" alt="plano.png">` +
      `<img src="https://otro.sitio/blobs/bl-a/x" data-coda-mime-type="image/heic" alt="de afuera.heic">`
    expect(fix(html)).toBe(html)
  })

  it('nombres raros: sin extensión, el blob, minúsculas, .heif, un > adentro, un & en la dirección', () => {
    expect(fix(`<img src="${blob('bl-a')}" data-coda-mime-type="image/heic" alt="bl-a">`)).toBe(`<img src="${blob('bl-a')}" data-coda-mime-type="image/jpeg" alt="bl-a">`)
    expect(fix(`<img alt="foto.heif" src="${blob('bl-b')}" data-coda-mime-type="image/heif">`)).toBe(`<img alt="foto.jpg" src="${blob('bl-b')}" data-coda-mime-type="image/jpeg">`)
    expect(fix(`<img src="${blob('bl-a')}" alt="antes > después.heic">`)).toBe(`<img src="${blob('bl-a')}" alt="antes > después.jpg">`)
    // Sin tipo en la etiqueta no se agrega: la app lo toma del archivo, que ya es un .jpg.
    expect(fix(`<img src="${blob('bl-a')}?a=1&amp;b=2" alt="x.heic.txt">`)).toBe(`<img src="${blob('bl-a')}?a=1&amp;b=2" alt="x.heic.txt">`)
    // `data-src` no es `src`.
    expect(fix(`<img data-src="${blob('bl-a')}" src="${blob('bl-png')}" alt="x.heic">`)).toBe(`<img data-src="${blob('bl-a')}" src="${blob('bl-png')}" alt="x.heic">`)
  })

  it('un adjunto (link al archivo): el texto del link es el nombre', () => {
    expect(fix(`<a href="${blob('bl-a')}">IMG_0003.HEIC</a>`)).toBe(`<a href="${blob('bl-a')}">IMG_0003.jpg</a>`)
    expect(fix(`<a href="${blob('bl-roto')}">IMG_0004.HEIC</a>`)).toBe(`<a href="${blob('bl-roto')}">IMG_0004.HEIC</a>`)
    // El link que envuelve la foto para abrirla grande: cambia la foto, no hay texto que tocar.
    const wrapped = `<a href="${blob('bl-a')}"><img src="${blob('bl-a')}" data-coda-mime-type="image/heic" alt="a.heic"></a>`
    expect(fix(wrapped)).toBe(`<a href="${blob('bl-a')}"><img src="${blob('bl-a')}" data-coda-mime-type="image/jpeg" alt="a.jpg"></a>`)
  })

  it('la vista local apunta al JPEG de media/', () => {
    const map = new Map([['bl-a', { file: 'bl-a.jpg', bytes: 1 }]])
    expect(rewriteLocalHtml('<img src="../media/bl-a.heic" alt="a.HEIC"><img src="../media/bl-roto.heic"><img src="../media/bl-p.png">', map)).toBe(
      '<img src="../media/bl-a.jpg" alt="a.HEIC"><img src="../media/bl-roto.heic"><img src="../media/bl-p.png">',
    )
  })
})

describe('fotos HEIC: manifest y páginas', () => {
  const heicImg = (id, name) => `<img src="${blob(id)}" data-coda-blob-id="${id}" data-coda-mime-type="image/heic" alt="${name}">`
  const page = (id, order, extra = {}) => ({ id, name: `Página ${id}`, subtitle: '', icon: null, parentId: null, order, contentType: 'canvas', file: `${id}.html`, media: [], external: [], ...extra })
  const converted = new Map([['bl-a', { file: 'bl-a.jpg', bytes: 4321 }]])

  it('una página sin tablas: su foto apunta al JPEG (tipo y peso) y pasa a su .import.html; el HTML de Coda no cambia', () => {
    const manifest = {
      doc: { id: 'DOC', name: 'Inventado' },
      pages: [
        page('p1', 0, { media: [{ url: blob('bl-a'), file: 'bl-a.heic' }, { url: blob('bl-p'), file: 'bl-p.png', type: 'image/png', bytes: 9 }] }),
        page('p2', 1, { media: [{ url: blob('bl-p'), file: 'bl-p.png' }] }),
        // Una embebida (el HTML es el de la página que muestra) y una que no se exportó (sin archivo).
        page('p3', 2, { contentType: 'embed', embedOf: { docId: 'OTRO', pageId: 'x', url: 'https://coda.io/d/_dOTRO/_suX' }, media: [{ url: blob('bl-a'), file: 'bl-a.jpg' }] }),
        page('p4', 3, { contentType: 'embed', file: 'p4.html' }),
      ],
      problems: [],
    }
    const html = { 'p1.html': `<div>Hola ${heicImg('bl-a', 'IMG_1.HEIC')}</div><div><img src="${blob('bl-p')}" alt="p.png"></div>`, 'p2.html': `<div><img src="${blob('bl-p')}"></div>`, 'p3.html': heicImg('bl-a', 'IMG_1.HEIC') }
    const frozen = JSON.stringify(manifest)
    const r = applyHeic({ manifest, html: (f) => html[f] ?? null, converted })
    expect(JSON.stringify(manifest)).toBe(frozen)
    const [p1, p2, p3, p4] = r.manifest.pages
    expect(p1.file).toBe('p1.import.html')
    expect(p1.media).toEqual([{ url: blob('bl-a'), file: 'bl-a.jpg', type: 'image/jpeg', bytes: 4321 }, { url: blob('bl-p'), file: 'bl-p.png', type: 'image/png', bytes: 9 }])
    expect(r.files.get('pages/p1.import.html')).toContain('data-coda-mime-type="image/jpeg" alt="IMG_1.jpg"')
    expect(r.files.get('pages/p1.import.html')).toContain('<div>Hola ')
    // Sin fotos convertidas: la página queda exactamente como estaba.
    expect(p2).toEqual(manifest.pages[1])
    expect(r.files.has('pages/p2.import.html')).toBe(false)
    // La embebida, igual que cualquiera (la corrida anterior ya había dejado el JPEG en su entrada).
    expect([p3.file, p3.media[0].type, p3.media[0].bytes, p3.embedOf.docId]).toEqual(['p3.import.html', 'image/jpeg', 4321, 'OTRO'])
    expect(p4.file).toBe('p4.html')
    expect([...r.files.keys()].sort()).toEqual(['pages/p1.import.html', 'pages/p3.import.html'])
  })

  it('una página que la conversión de tablas ya reescribió: se corrige ese mismo .import.html', () => {
    const manifest = { doc: { id: 'DOC', name: 'x' }, pages: [page('p1', 0, { file: 'p1.import.html', media: [{ url: blob('bl-a'), file: 'bl-a.heic' }] })] }
    const files = new Map([['pages/p1.import.html', `<div>${heicImg('bl-a', 'a.heic')}</div>`]])
    const r = applyHeic({ manifest, files, html: () => null, converted })
    expect(r.manifest.pages[0].file).toBe('p1.import.html')
    expect(r.files.get('pages/p1.import.html')).toBe(`<div><img src="${blob('bl-a')}" data-coda-blob-id="bl-a" data-coda-mime-type="image/jpeg" alt="a.jpg"></div>`)
    // Lo que recibió no se toca.
    expect(files.get('pages/p1.import.html')).toContain('image/heic')
  })

  it('sin nada convertido devuelve lo mismo que recibió (un doc sin HEIC da lo mismo que antes)', () => {
    const manifest = { doc: { id: 'DOC', name: 'x' }, pages: [page('p1', 0, { media: [{ url: blob('bl-p'), file: 'bl-p.png' }] })] }
    const files = new Map([['pages/p1.import.html', '<div>x</div>']])
    const r = applyHeic({ manifest, files, html: () => '<div>x</div>', converted: new Map() })
    expect(r.manifest).toBe(manifest)
    expect(r.files).toBe(files)
  })

  it('las fichas de una tabla: la foto de cada fila queda como JPEG en su ficha; la que no se pudo convertir, como estaba', () => {
    const columns = [
      { id: 'c-name', name: 'Plano', type: 'text', display: true },
      { id: 'c-img', name: 'Fotos', type: 'imageAttachments' },
      { id: 'c-note', name: 'Notas', type: 'canvas' },
    ].map((c) => ({ calculated: false, formula: null, display: false, lookupTableId: null, isArray: false, ...c }))
    const index = { tables: [{ id: 'T1', name: 'Planos', type: 'table', layout: 'default', pageId: 'p1', baseTableId: null, displayColumnId: 'c-name', visibleColumnIds: columns.map((c) => c.id), columns }] }
    const image = (id, name) => ({ '@type': 'ImageObject', url: blob(id), name })
    const rows = { T1: { visible: ['r1', 'r2', 'r3'], rows: [
      { id: 'r1', name: 'Plano 1', values: { 'c-name': 'Plano 1', 'c-img': [image('bl-a', 'IMG_1.HEIC')], 'c-note': 'nota 1' } },
      // La segunda fila no se ve en el HTML: su foto sale de los datos de la API.
      { id: 'r2', name: 'Plano 2', values: { 'c-name': 'Plano 2', 'c-img': [image('bl-b', 'IMG_2.heic'), image('bl-p', 'plano.png')], 'c-note': 'nota 2' } },
      { id: 'r3', name: 'Plano 3', values: { 'c-name': 'Plano 3', 'c-img': [], 'c-note': 'nota 3' } },
    ] } }
    const th = (id) => `<th data-coda-column-id="${id}">x</th>`
    const html = { 'p1.html': `<table data-coda-grid-id="T1"><thead><tr>${th('c-name')}${th('c-img')}${th('c-note')}</tr></thead><tbody><tr><td>Plano 1</td><td>${heicImg('bl-a', 'IMG_1.HEIC')}</td><td><div>nota rica</div><div>${heicImg('bl-n', 'IMG_9.HEIC')}</div></td></tr></tbody></table>` }
    const manifest = { doc: { id: 'DOC', name: 'x' }, pages: [page('p1', 0, { media: [{ url: blob('bl-a'), file: 'bl-a.heic' }, { url: blob('bl-n'), file: 'bl-n.heic' }] })], problems: [] }
    const extraMedia = [{ url: blob('bl-b'), file: 'bl-b.heic', type: 'image/heic' }, { url: blob('bl-p'), file: 'bl-p.png', type: 'image/png' }]
    const tables = convertTables({ manifest, index, rows: (id) => rows[id] ?? null, html: (f) => html[f] ?? null, parse: (text) => new JSDOM(text).window.document, extraMedia })
    // bl-n falló al convertir: queda como HEIC, en el manifest y en el HTML.
    const done = new Map([['bl-a', { file: 'bl-a.jpg', bytes: 11 }], ['bl-b', { file: 'bl-b.jpg', bytes: 22 }]])
    const r = applyHeic({ manifest: tables.manifest, files: tables.files, html: (f) => html[f] ?? null, converted: done })
    const ficha = (id) => r.manifest.pages.find((p) => p.id === `row-T1-${id}`)
    expect(ficha('r1').file).toBe('row-T1-r1.import.html')
    expect(ficha('r1').media.map((m) => [m.file, m.type, m.bytes])).toEqual([['bl-a.jpg', 'image/jpeg', 11], ['bl-n.heic', undefined, undefined]])
    const one = r.files.get('pages/row-T1-r1.import.html')
    expect(one).toContain(`<img src="${blob('bl-a')}" alt="IMG_1.jpg">`)
    expect(one).toContain('alt="IMG_9.HEIC"')
    expect(one).toContain('data-coda-mime-type="image/heic"')
    expect(ficha('r2').media.map((m) => [m.file, m.type, m.bytes])).toEqual([['bl-b.jpg', 'image/jpeg', 22], ['bl-p.png', 'image/png', undefined]])
    const two = r.files.get('pages/row-T1-r2.import.html')
    expect(two).toContain(`<img src="${blob('bl-b')}" alt="IMG_2.jpg">`)
    expect(two).toContain('alt="plano.png"')
    // Ninguna foto convertida quedó con nombre o tipo de HEIC en lo que se importa.
    for (const [path, text] of r.files) {
      for (const tag of text.matchAll(/<img\b[^>]*>/g)) {
        if (/bl-a\/|bl-b\//.test(tag[0])) expect(`${path} ${tag[0]}`).not.toMatch(/\.hei[cf]"|image\/hei[cf]/i)
      }
    }
  })
})

describe('fotos HEIC: en el disco (carpeta temporal, conversor de mentira)', () => {
  const load = (convert) => async () => ({ convert })

  it('JPEG entero en media/, original en media-originals/, un .part viejo no cuenta, y repetir no convierte', async () => {
    const out = await mkdtemp(join(tmpdir(), 'coda-heic-'))
    try {
      await mkdir(join(out, 'media'))
      expect(await folderHasHeic(out)).toBe(false)
      await writeFile(join(out, 'media', 'bl-a.heic'), 'A')
      await writeFile(join(out, 'media', 'bl-roto.heic'), 'ROTO')
      await writeFile(join(out, 'media', 'bl-p.png'), 'P')
      // Lo que dejó un corte a mitad de escribir: no es un JPEG terminado.
      await writeFile(join(out, 'media', 'bl-a.jpg.part'), 'a medias')
      expect(await folderHasHeic(out)).toBe(true)
      const convert = async (input) => {
        if (input.toString() === 'ROTO') throw new Error('archivo roto')
        return JPEG(`jpeg de ${input}`)
      }
      const first = await convertHeicFolder(out, { load: load(convert) })
      expect(first.stats).toEqual({ total: 2, converted: 1, already: 0, failed: 1, pending: 0 })
      expect((await readdir(join(out, 'media'))).sort()).toEqual(['bl-a.jpg', 'bl-p.png', 'bl-roto.heic'])
      expect(await readdir(join(out, ORIGINALS))).toEqual(['bl-a.heic'])
      expect((await readFile(join(out, 'media', 'bl-a.jpg'))).toString()).toContain('jpeg de A')
      expect((await readFile(join(out, ORIGINALS, 'bl-a.heic'))).toString()).toBe('A')
      expect(first.converted.get('bl-a')).toEqual({ file: 'bl-a.jpg', bytes: 4 + 'jpeg de A'.length })

      // De nuevo, ahora sin librería: lo hecho sigue hecho y la que falta queda anotada.
      const again = await convertHeicFolder(out, { load: async () => ({ convert: null, error: 'falta la librería heic-convert' }) })
      expect(again.stats).toEqual({ total: 2, converted: 0, already: 1, failed: 0, pending: 1 })
      expect([...again.converted.keys()]).toEqual(['bl-a'])
      expect((await readdir(join(out, 'media'))).sort()).toEqual(['bl-a.jpg', 'bl-p.png', 'bl-roto.heic'])
      // Convertida toda, la carpeta sigue contando como "con HEIC": el manifest y el HTML se arman igual.
      await rm(join(out, 'media', 'bl-roto.heic'))
      expect(await folderHasHeic(out)).toBe(true)
    } finally {
      await rm(out, { recursive: true, force: true })
    }
  })
})

describe('fotos HEIC: el perfil de color pasa al JPEG', () => {
  // Un perfil ICC de mentira: 128 bytes de cabecera con la firma `acsp` en el byte 36, y algo más.
  const profile = (size) => {
    const icc = Buffer.alloc(size, 7)
    icc.write('acsp', 36, 'latin1')
    return icc
  }
  const box = (type, body) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(8 + body.length, 0)
    head.write(type, 4, 'latin1')
    return Buffer.concat([head, body])
  }
  const jfif = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]), Buffer.from([0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9])])

  it('lo saca de la caja colr del HEIC; sin perfil, o con algo que no es un perfil, nada', () => {
    const icc = profile(200)
    const heic = Buffer.concat([box('ftyp', Buffer.from('heic')), box('colr', Buffer.concat([Buffer.from('prof'), icc])), box('mdat', Buffer.from('datos'))])
    expect(heicColorProfile(heic)).toEqual(icc)
    expect(heicColorProfile(new Uint8Array(heic))).toEqual(icc)
    expect(heicColorProfile(Buffer.concat([box('ftyp', Buffer.from('heic')), box('colr', Buffer.concat([Buffer.from('nclx'), Buffer.from([0, 1, 0, 13, 0, 6, 0x80])]))]))).toBeNull()
    expect(heicColorProfile(box('colr', Buffer.concat([Buffer.from('prof'), Buffer.alloc(200, 7)])))).toBeNull()
    // Una caja que dice ser más larga que el archivo (cortado).
    expect(heicColorProfile(box('colr', Buffer.concat([Buffer.from('prof'), icc])).subarray(0, 150))).toBeNull()
    expect(heicColorProfile(Buffer.from('A'))).toBeNull()
  })

  it('va en un segmento APP2 después de la cabecera JFIF; uno grande, en varios numerados', () => {
    const icc = profile(200)
    const out = jpegWithProfile(jfif, icc)
    expect(out.subarray(0, 8)).toEqual(jfif.subarray(0, 8))
    expect(out.readUInt16BE(8)).toBe(0xffe2)
    expect(out.readUInt16BE(10)).toBe(200 + 16)
    expect(out.toString('latin1', 12, 24)).toBe('ICC_PROFILE\0')
    expect([out[24], out[25]]).toEqual([1, 1])
    expect(out.subarray(26, 226)).toEqual(icc)
    expect(out.subarray(226)).toEqual(jfif.subarray(8))
    // 70.000 bytes no entran en un segmento (64 KB): dos, "1 de 2" y "2 de 2", que juntos dan el perfil.
    const big = jpegWithProfile(jfif, profile(70000))
    const first = big.readUInt16BE(10)
    expect([big[24], big[25], first]).toEqual([1, 2, 65535])
    const second = 8 + 2 + first
    expect([big.readUInt16BE(second), big[second + 16], big[second + 17], big.readUInt16BE(second + 2)]).toEqual([0xffe2, 2, 2, 70000 - 65519 + 16])
    expect(big.length).toBe(jfif.length + 70000 + 2 * 18)
    // Sin perfil, o si no es un JPEG, queda igual.
    expect(jpegWithProfile(jfif, null)).toBe(jfif)
    const other = Buffer.from('no soy un jpeg')
    expect(jpegWithProfile(other, icc)).toBe(other)
  })
})

// Un HEIC de verdad, hecho para esta prueba (sin fotos de nadie): 96×64, cuatro cuadrantes de color plano
// (rojo, verde / azul, blanco), con un perfil sRGB genérico y guardado con la rotación `irot` de una foto
// vertical de iPhone (hay que girarlo 90° a la derecha para verlo). Solo corre si `heic-convert` está instalado
// (no está en package.json).
const HEIC_SAMPLE =
  'AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAA+ZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAADRpbG9jAAAAAERAAAIAAQAAAAAECgABAAAAAAAAAM0AAgAAAA' +
  'AE1wABAAAAAAAAACQAAAA4aWluZgAAAAAAAgAAABVpbmZlAgAAAAABAABodmMxAAAAABVpbmZlAgAAAQACAABFeGlmAAAAAA5waXRtAAAAAAABAAADJWlwcnAAAAMFaXBjbwAAAHhodmNDAQNwAAAA' +
  'AAAAAAAAHvAA/P34+AAADwNgAAEAGEABDAH//wNwAAADAJAAAAMAAAMAHroCQGEAAQArQgEBA3AAAAMAkAAAAwAAAwAeoDCBBZbqSSmubgIaDAgAAAMAyAAAAwAIQGIAAQAHRAHBcrAiQAAAAlhjb2' +
  'xycHJvZgAAAkxsY21zBEAAAG1udHJSR0IgWFlaIAfqAAoAAQAGADQAFWFjc3BNU0ZUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD21gABAAAAANMtbGNtcwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC2Rlc2MAAAEIAAAANmNwcnQAAAFAAAAATHd0cHQAAAGMAAAAFGNoYWQAAAGgAAAALHJYWVoAAAHMAAAAFGJYWVoAAAHgAAAAFGdYWVoAAAH0AAAAFHJUUk' +
  'MAAAIIAAAAIGdUUkMAAAIIAAAAIGJUUkMAAAIIAAAAIGNocm0AAAIoAAAAJG1sdWMAAAAAAAAAAQAAAAxlblVTAAAAGgAAABwAcwBSAEcAQgAgAGIAdQBpAGwAdAAtAGkAbgAAbWx1YwAAAAAAAAAB' +
  'AAAADGVuVVMAAAAwAAAAHABOAG8AIABjAG8AcAB5AHIAaQBnAGgAdAAsACAAdQBzAGUAIABmAHIAZQBlAGwAeVhZWiAAAAAAAAD21gABAAAAANMtc2YzMgAAAAAAAQxCAAAF3v//8yUAAAeTAAD9kP' +
  '//+6H///2iAAAD3AAAwG5YWVogAAAAAAAAb6AAADj1AAADkFhZWiAAAAAAAAAknwAAD4QAALbDWFlaIAAAAAAAAGKXAAC3hwAAGNlwYXJhAAAAAAADAAAAAmZmAADypwAADVkAABPQAAAKW2Nocm0A' +
  'AAAAAAMAAAAAo9cAAFR7AABMzQAAmZoAACZmAAAPXAAAABRpc3BlAAAAAAAAAGAAAABAAAAAEHBpeGkAAAAAAwgICAAAAAlpcm90AwAAABhpcG1hAAAAAAAAAAEAAQWBAgMEhQAAABppcmVmAAAAAA' +
  'AAAA5jZHNjAAIAAQABAAAA+W1kYXQAAADJKAGvCeDjC5y6r//+QR///jEbkP4E5qSCUnnv3en+0+f/5zYrqKPdrKMEEXplF1DrSbxta9SlxP+McyN+XxyBOh68dCmoVBQFAAabb4rAmTxP5Bl4cflD' +
  'TAoHR4O9if/38IPH8SyN/+uvJX1JQjWMOhYSNsDq9HQIab008QxcHwdh3uqumeM1jidzPli/woDVJxiSQkZORZ8qosPIZPu93V/tqtPxJT6f+bKh+YLAPFEwmGD7eimS73r7wtVeeubw5zronv/+E8' +
  '/wAAAABkV4aWYAAE1NACoAAAAIAAEBEgADAAAAAQAGAAAAAAAA'

const require = createRequire(import.meta.url)
const installed = (name) => {
  try {
    require.resolve(name)
    return true
  } catch {
    return false
  }
}

describe('fotos HEIC: la librería de verdad', () => {
  it.skipIf(!installed('heic-convert') || !installed('jpeg-js'))('un HEIC vertical sale como JPEG a tamaño completo y derecho (no acostado)', async () => {
    const { convert } = await loadHeicConverter((name) => Promise.resolve(require(name)))
    const jpeg = await convert(Buffer.from(HEIC_SAMPLE, 'base64'))
    expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8])
    const image = require('jpeg-js').decode(jpeg)
    // Guardado 96×64 (acostado); con la rotación aplicada, 64×96.
    expect([image.width, image.height]).toEqual([64, 96])
    const at = (x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 3)]
    const near = (rgb, want) => rgb.every((v, i) => Math.abs(v - want[i]) < 40)
    // Girado 90° a la derecha: arriba azul y rojo, abajo blanco y verde.
    expect(near(at(5, 5), [30, 30, 220])).toBe(true)
    expect(near(at(58, 5), [220, 30, 30])).toBe(true)
    expect(near(at(5, 90), [240, 240, 240])).toBe(true)
    expect(near(at(58, 90), [30, 200, 30])).toBe(true)
    // El perfil de color del HEIC (588 bytes) está en el JPEG, entero.
    const icc = heicColorProfile(Buffer.from(HEIC_SAMPLE, 'base64'))
    expect(icc.length).toBe(588)
    const at2 = jpeg.indexOf(Buffer.from('ICC_PROFILE\0', 'latin1'))
    expect(at2).toBeGreaterThan(0)
    expect(jpeg.subarray(at2 + 14, at2 + 14 + 588)).toEqual(icc)
    // Un archivo que no es un HEIC: el error llega a quien convierte (queda anotado, sin cortar el resto).
    await expect(convert(Buffer.from('esto no es una foto'))).rejects.toThrow()
  })
})
