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
