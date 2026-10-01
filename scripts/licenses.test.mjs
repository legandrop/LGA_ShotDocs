import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Los avisos de licencias de terceros (THIRD_PARTY_NOTICES.md, Docs/Doc_Decisiones.md, D-21) también van con la
// app publicada (`public/licenses/`): el mismo archivo y los textos de la LGPL-3.0 y la GPL-3.0 que pide libheif.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('licencias de terceros', () => {
  it('la app publicada lleva el mismo aviso que el repo y los textos de la LGPL-3.0 y la GPL-3.0', () => {
    expect(read('public/licenses/THIRD_PARTY_NOTICES.md')).toBe(read('THIRD_PARTY_NOTICES.md'))
    expect(read('public/licenses/LGPL-3.0.txt')).toMatch(/GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/)
    expect(read('public/licenses/GPL-3.0.txt')).toMatch(/^\s*GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/)
    expect(read('public/licenses/GPL-3.0.txt')).toMatch(/END OF TERMS AND CONDITIONS/)
    // El aviso apunta a esos textos.
    for (const text of ['/licenses/LGPL-3.0.txt', '/licenses/GPL-3.0.txt']) expect(read('THIRD_PARTY_NOTICES.md')).toContain(text)
  })

  it('el service worker no contesta esos archivos con la app', () => {
    expect(read('vite.config.ts')).toMatch(/navigateFallbackDenylist: \[\/\^\\\/licenses\\\/\/\]/)
  })
})
