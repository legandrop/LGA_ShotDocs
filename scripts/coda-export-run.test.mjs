// El comando entero (scripts/coda-export.mjs) contra una API de Coda de mentira, sin red: un proceso de node como
// lo corre una persona, con `fetch` y `heic-convert` reemplazados antes de arrancar (scripts/fixtures/
// codaFakeApi.mjs). Lo que se mira es lo que queda en la carpeta, lo que se pidió y el código de salida: la
// bajada, la conversión de las fotos HEIC (`convertFolder`), repetirla, `--convert-only`, sin la librería, un
// HEIC roto y un doc sin HEIC. Todo inventado: doc, páginas y archivos.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PRELOAD = pathToFileURL(join(ROOT, 'scripts/fixtures/codaFakeApi.mjs')).href
const DOC = { id: 'docPrueba1', name: 'Doc de prueba', browserLink: 'https://coda.io/d/_ddocPrueba1' }
const blobUrl = (id) => `https://codahosted.io/docs/${DOC.id}/blobs/${id}/abc123`
const b64 = (text) => Buffer.from(text, 'latin1').toString('base64')
/** Un "HEIC" (el comando lo reconoce por el tipo con que llega; el conversor es de mentira). */
const HEIC = b64('\0\0\0\x18ftypheic\0\0\0\0mif1heic foto del iphone')
const JPEG = b64('\xff\xd8\xff\xe0 una foto comun')
const PNG = b64('\x89PNG\r\n\x1a\n una captura')
const img = (id, type, alt) => `<img src="${blobUrl(id)}" data-coda-blob-id="${id}" data-coda-mime-type="${type}" alt="${alt}" width="350">`

/** Un doc con dos páginas: la primera con una foto HEIC y un JPEG, la segunda (hija) con un PNG. */
function docWithHeic({ broken = false } = {}) {
  return {
    doc: DOC,
    pages: [
      {
        id: 'canvas-1',
        name: 'Rodaje',
        contentType: 'canvas',
        isHidden: false,
        browserLink: 'https://coda.io/d/_ddocPrueba1/Rodaje_su1',
        children: [{ id: 'canvas-2' }],
        html: `<div><p>Día 1</p>${img('bl-heic1', 'image/heic', 'IMG_0001.HEIC')}${img('bl-jpg1', 'image/jpeg', 'IMG_0002.JPG')}${broken ? img('bl-heic2', 'image/heic', 'IMG_0003.HEIC') : ''}</div>`,
      },
      {
        id: 'canvas-2',
        name: 'Notas',
        contentType: 'canvas',
        isHidden: false,
        parent: { id: 'canvas-1' },
        browserLink: 'https://coda.io/d/_ddocPrueba1/Notas_su2',
        html: `<div>${img('bl-png1', 'image/png', 'captura.png')}</div>`,
      },
    ],
    media: {
      [blobUrl('bl-heic1')]: { type: 'image/heic', base64: HEIC },
      [blobUrl('bl-jpg1')]: { type: 'image/jpeg', base64: JPEG },
      [blobUrl('bl-png1')]: { type: 'image/png', base64: PNG },
      ...(broken ? { [blobUrl('bl-heic2')]: { type: 'image/heic', base64: b64('ftypheic ROTO') } } : {}),
    },
  }
}

const dirs = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** Una carpeta para la corrida: el doc inventado, el registro de pedidos y de conversiones, y la salida. */
async function setup(fake) {
  const dir = await mkdtemp(join(tmpdir(), 'coda-export-run-'))
  dirs.push(dir)
  await writeFile(join(dir, 'fake.json'), JSON.stringify(fake))
  return { dir, out: join(dir, 'export') }
}

/** Corre el comando; devuelve el código de salida, lo que imprimió, los pedidos y las conversiones de esa corrida. */
async function run({ dir }, args, { heic = 'fake' } = {}) {
  const logFile = join(dir, `requests-${Date.now()}-${Math.random()}.log`)
  const convertsFile = join(dir, `converts-${Date.now()}-${Math.random()}.log`)
  await writeFile(logFile, '')
  await writeFile(convertsFile, '')
  const child = spawn(process.execPath, ['--import', PRELOAD, join(ROOT, 'scripts/coda-export.mjs'), ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      CODA_API_TOKEN: 'token-de-prueba',
      CODA_FAKE: join(dir, 'fake.json'),
      CODA_FAKE_LOG: logFile,
      CODA_FAKE_CONVERTS: convertsFile,
      CODA_FAKE_HEIC: heic,
      // Nada va a la carpeta de la persona.
      HOME: dir,
      USERPROFILE: dir,
    },
  })
  let output = ''
  child.stdout.on('data', (d) => (output += d))
  child.stderr.on('data', (d) => (output += d))
  const code = await new Promise((resolve) => child.on('close', resolve))
  const lines = async (file) => (await readFile(file, 'utf8')).split('\n').filter(Boolean)
  return { code, output, requests: await lines(logFile), converts: await lines(convertsFile) }
}

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
/** El manifest sin la fecha de la corrida (cambia cada vez). */
const stable = ({ exportedAt: _at, ...rest }) => rest

describe('el comando entero, contra una API de Coda de mentira', () => {
  it('baja, convierte la foto HEIC y deja todo coherente; repetirlo no baja ni convierte nada de nuevo', async () => {
    const ctx = await setup(docWithHeic())
    const first = await run(ctx, [DOC.id, ctx.out])
    expect(first.code, first.output).toBe(0)
    expect(first.output).toContain('Fotos HEIC: 1 convertida')
    // Una conversión, a JPEG con calidad 0,92.
    expect(first.converts).toEqual([`JPEG 0.92 ${Buffer.from(HEIC, 'base64').length}`])
    // El token va solo a la API de Coda; los archivos se bajan sin él.
    expect(first.requests.filter((r) => r.includes('(token)')).every((r) => r.includes('https://coda.io/apis/v1/'))).toBe(true)
    expect(first.requests.filter((r) => r.includes('codahosted.io/docs/')).every((r) => !r.includes('(token)'))).toBe(true)

    // En la carpeta: el JPEG en media/ con el nombre del blob, el original aparte, lo demás tal cual.
    expect((await readdir(join(ctx.out, 'media'))).sort()).toEqual(['bl-heic1.jpg', 'bl-jpg1.jpg', 'bl-png1.png'])
    expect(await readdir(join(ctx.out, 'media-originals'))).toEqual(['bl-heic1.heic'])
    expect((await readFile(join(ctx.out, 'media-originals', 'bl-heic1.heic'))).toString('base64')).toBe(HEIC)
    const jpeg = await readFile(join(ctx.out, 'media', 'bl-heic1.jpg'))
    expect([...jpeg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])

    // El manifest apunta al JPEG (tipo y peso); el de Coda queda aparte, tal cual.
    const manifest = await readJson(join(ctx.out, 'manifest.json'))
    const coda = await readJson(join(ctx.out, 'manifest.coda.json'))
    expect(manifest.heic).toEqual({ converted: 1, pending: 0 })
    expect(manifest.problems ?? []).toEqual([])
    const [rodaje, notas] = manifest.pages
    expect(rodaje.media.find((m) => m.url === blobUrl('bl-heic1'))).toMatchObject({ file: 'bl-heic1.jpg', type: 'image/jpeg', bytes: jpeg.length })
    expect(coda.pages[0].media.find((m) => m.url === blobUrl('bl-heic1'))).toMatchObject({ file: 'bl-heic1.heic', type: 'image/heic' })
    expect(notas).toMatchObject({ parentId: 'canvas-1', file: coda.pages[1].file })
    // El HTML de Coda no se toca; lo que se importa dice JPEG.
    expect(rodaje.file).toMatch(/\.import\.html$/)
    const imported = await readFile(join(ctx.out, 'pages', rodaje.file), 'utf8')
    expect(imported).toContain('data-coda-mime-type="image/jpeg" alt="IMG_0001.jpg"')
    expect(imported).toContain('alt="IMG_0002.JPG"')
    expect(await readFile(join(ctx.out, 'pages', coda.pages[0].file), 'utf8')).toContain('alt="IMG_0001.HEIC"')
    expect(await readFile(join(ctx.out, 'pages', coda.pages[0].file.replace(/\.html$/, '.local.html')), 'utf8')).toContain('../media/bl-heic1.jpg')

    // Otra vez: el HTML no se vuelve a pedir, los archivos tampoco (la foto convertida está como .jpg), no se
    // convierte nada y el manifest queda igual.
    const second = await run(ctx, [DOC.id, ctx.out])
    expect(second.code, second.output).toBe(0)
    expect(second.converts).toEqual([])
    expect(second.requests.filter((r) => r.includes('codahosted.io'))).toEqual([])
    expect(stable(await readJson(join(ctx.out, 'manifest.json')))).toEqual(stable(manifest))
    expect(await readdir(join(ctx.out, 'media-originals'))).toEqual(['bl-heic1.heic'])

    // Con --refresh se vuelve a pedir el HTML, pero no la foto ya convertida.
    const refresh = await run(ctx, [DOC.id, ctx.out, '--refresh'])
    expect(refresh.code, refresh.output).toBe(0)
    expect(refresh.requests.some((r) => r.includes('codahosted.io/export/'))).toBe(true)
    expect(refresh.requests.some((r) => r.includes('bl-heic1'))).toBe(false)
    expect(refresh.converts).toEqual([])
    expect(stable(await readJson(join(ctx.out, 'manifest.json')))).toEqual(stable(manifest))
  })

  it('sin la librería: baja todo, no convierte, lo dice con la forma de instalarla y sale con error; --convert-only lo termina', async () => {
    const ctx = await setup(docWithHeic())
    const first = await run(ctx, [DOC.id, ctx.out], { heic: 'missing' })
    expect(first.code).toBe(1)
    expect(first.output).toContain('npm i --no-save heic-convert')
    expect(first.converts).toEqual([])
    expect(await readdir(join(ctx.out, 'media'))).toContain('bl-heic1.heic')
    expect(existsSync(join(ctx.out, 'media-originals'))).toBe(false)
    const manifest = await readJson(join(ctx.out, 'manifest.json'))
    expect(manifest.heic).toEqual({ converted: 0, pending: 1 })
    expect(manifest.pages[0].media.find((m) => m.url === blobUrl('bl-heic1'))).toMatchObject({ type: 'image/heic' })

    // Instalada la librería, sin red ni token.
    const convert = await run(ctx, ['--convert-only', ctx.out])
    expect(convert.code, convert.output).toBe(0)
    expect(convert.requests).toEqual([])
    expect(convert.converts).toHaveLength(1)
    const after = await readJson(join(ctx.out, 'manifest.json'))
    expect(after.heic).toEqual({ converted: 1, pending: 0 })
    expect(after.problems ?? []).toEqual([])
    expect(after.pages[0].media.find((m) => m.url === blobUrl('bl-heic1'))).toMatchObject({ file: 'bl-heic1.jpg', type: 'image/jpeg' })
  })

  it('un HEIC roto queda como estaba y anotado, las demás se convierten, y el comando sale con error', async () => {
    const ctx = await setup(docWithHeic({ broken: true }))
    const done = await run(ctx, [DOC.id, ctx.out])
    expect(done.code).toBe(1)
    expect(done.converts).toHaveLength(2)
    expect((await readdir(join(ctx.out, 'media'))).sort()).toEqual(['bl-heic1.jpg', 'bl-heic2.heic', 'bl-jpg1.jpg', 'bl-png1.png'])
    const manifest = await readJson(join(ctx.out, 'manifest.json'))
    expect(manifest.heic).toEqual({ converted: 1, pending: 1 })
    expect(manifest.problems.some((p) => /HEIC/.test(p) && p.includes('bl-heic2'))).toBe(true)
    expect(manifest.pages[0].media.find((m) => m.url === blobUrl('bl-heic2'))).toMatchObject({ file: 'bl-heic2.heic', type: 'image/heic' })
  })

  it('un doc sin fotos HEIC: el manifest de siempre, sin manifest.coda.json y sin cargar la librería', async () => {
    const fake = docWithHeic()
    fake.pages[0].html = `<div>${img('bl-jpg1', 'image/jpeg', 'IMG_0002.JPG')}</div>`
    delete fake.media[blobUrl('bl-heic1')]
    const ctx = await setup(fake)
    // Con la librería "sin instalar": si se intentara cargar, quedaría anotado como problema.
    const done = await run(ctx, [DOC.id, ctx.out], { heic: 'missing' })
    expect(done.code, done.output).toBe(0)
    expect(done.output).not.toContain('HEIC')
    expect(existsSync(join(ctx.out, 'manifest.coda.json'))).toBe(false)
    expect(existsSync(join(ctx.out, 'media-originals'))).toBe(false)
    const manifest = await readJson(join(ctx.out, 'manifest.json'))
    expect(manifest.heic).toBeUndefined()
    expect(manifest.pages.map((p) => p.file)).toEqual(manifest.pages.map((p) => p.file.replace('.import.html', '.html')))
    expect(manifest.pages[0].media).toEqual([{ url: blobUrl('bl-jpg1'), file: 'bl-jpg1.jpg', type: 'image/jpeg', bytes: Buffer.from(JPEG, 'base64').length }])
  })
})
