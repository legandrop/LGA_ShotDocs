// Pruebas de lo que scripts/coda-export.mjs decide sin red (scripts/lib/codaExport.mjs).

import { describe, expect, it } from 'vitest'
import { isCodaApi, mediaBaseName, parseExportArgs } from './lib/codaExport.mjs'

describe('coda-export', () => {
  it('el token va solo a la API de Coda, también en las direcciones que devuelve la API', () => {
    expect(isCodaApi('https://coda.io/apis/v1/docs/abc/pages')).toBe(true)
    expect(isCodaApi('https://coda.io/apis/v1/docs/abc/pages?pageToken=x&limit=100')).toBe(true)
    // Otro sitio, otra ruta de coda.io, http, un host parecido o con usuario en la dirección: no.
    expect(isCodaApi('https://evil.example/apis/v1/docs')).toBe(false)
    expect(isCodaApi('https://coda.io/d/doc')).toBe(false)
    expect(isCodaApi('http://coda.io/apis/v1/docs')).toBe(false)
    expect(isCodaApi('https://coda.io.evil.example/apis/v1')).toBe(false)
    expect(isCodaApi('https://user:pw@coda.io/apis/v1')).toBe(false)
    expect(isCodaApi('https://codahosted.io/docs/x/blobs/bl-1/abc')).toBe(false)
    expect(isCodaApi('no es una dirección')).toBe(false)
  })

  it('un archivo se guarda con su blob; sin blob, con un hash que no choca entre direcciones', () => {
    expect(mediaBaseName('https://codahosted.io/docs/D/blobs/bl-Ab_1-x/abc')).toBe('bl-Ab_1-x')
    const a = mediaBaseName('https://codahosted.io/packs/123/unversioned/assets/logo-aaaaaaaaaaaaaaaaaaaaaaaaaaaa.png')
    const b = mediaBaseName('https://codahosted.io/packs/456/unversioned/assets/logo-aaaaaaaaaaaaaaaaaaaaaaaaaaaa.png')
    expect(a).toMatch(/^url-[0-9a-f]{20}$/)
    expect(a).not.toBe(b)
    expect(mediaBaseName('https://codahosted.io/packs/123/unversioned/assets/logo-aaaaaaaaaaaaaaaaaaaaaaaaaaaa.png')).toBe(a)
  })

  it('--refresh vuelve a pedir las páginas; una opción desconocida es un error', () => {
    expect(parseExportArgs(['MGTZD'])).toEqual({ nameOrId: 'MGTZD', out: undefined, refresh: false, convertOnly: false })
    expect(parseExportArgs(['--refresh', 'MGTZD', 'C:\\salida'])).toEqual({ nameOrId: 'MGTZD', out: 'C:\\salida', refresh: true, convertOnly: false })
    expect(() => parseExportArgs(['MGTZD', '--force'])).toThrow(/--force/)
  })
})

describe('páginas embebidas (embeds.json)', () => {
  it('reconoce una página de otro doc de Coda; cualquier otra dirección queda como link', async () => {
    const { parseEmbedUrl } = await import('./lib/codaExport.mjs')
    expect(parseEmbedUrl('https://coda.io/d/_dAbC123/_suXyZ9')).toEqual({ kind: 'coda', docId: 'AbC123', slug: 'XyZ9' })
    expect(parseEmbedUrl('https://coda.io/d/Reportes_dAbC123/Dia-43_suXyZ9#tabla')).toEqual({ kind: 'coda', docId: 'AbC123', slug: 'XyZ9' })
    expect(parseEmbedUrl('https://docs.superhuman.com/d/Reportes_dAbC123/Dia_suXyZ9')).toEqual({ kind: 'coda', docId: 'AbC123', slug: 'XyZ9' })
    expect(parseEmbedUrl('https://www.youtube.com/watch?v=1')).toEqual({ kind: 'link', url: 'https://www.youtube.com/watch?v=1' })
    // Un doc de Coda sin página (o un host parecido) es un link, no una página que bajar con el token.
    expect(parseEmbedUrl('https://coda.io/d/_dAbC123')).toEqual({ kind: 'link', url: 'https://coda.io/d/_dAbC123' })
    expect(parseEmbedUrl('https://coda.io.evil.com/d/_dAbC/_suX')).toEqual({ kind: 'link', url: 'https://coda.io.evil.com/d/_dAbC/_suX' })
    expect(parseEmbedUrl('http://coda.io/d/_dAbC/_suX')).toBeNull()
    expect(parseEmbedUrl('javascript:alert(1)')).toBeNull()
    expect(parseEmbedUrl('')).toBeNull()
  })

  it('embeds.json se revisa: de otro doc o sin "pages" es un error claro; las direcciones vacías se ignoran', async () => {
    const { checkEmbeds } = await import('./lib/codaExport.mjs')
    const ok = checkEmbeds({ source: 'x', docId: 'D1', pages: { 'canvas-a': ' https://coda.io/d/_dX/_suY ', 'canvas-b': '' } }, 'D1')
    expect([...ok]).toEqual([['canvas-a', 'https://coda.io/d/_dX/_suY']])
    expect(() => checkEmbeds({ docId: 'D2', pages: {} }, 'D1')).toThrow(/otro doc/)
    expect(() => checkEmbeds({ docId: 'D1' }, 'D1')).toThrow(/falta "pages"/)
    expect(() => checkEmbeds([], 'D1')).toThrow(/objeto/)
  })
})
