// Pruebas de la conversión de tablas de Coda a páginas (scripts/lib/codaTables.mjs) y de tables.config.json.
// Todo inventado: tablas, columnas, filas y textos.

import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { checkTablesConfig, parseExportArgs } from './lib/codaExport.mjs'
import { convertTables, rowCommentsByPage } from './lib/codaTables.mjs'

const parse = (html) => new JSDOM(html).window.document
const blob = (id) => `https://codahosted.io/docs/D/blobs/${id}/x`
const img = (id) => ({ '@type': 'ImageObject', url: blob(id), name: `${id}.png` })

// Una tabla base con fotos (→ fichas), una vista de tarjetas, un calendario y una tabla chica de texto.
const COLUMNS = [
  { id: 'c-name', name: 'Plano', type: 'text' },
  { id: 'c-img', name: 'Fotos', type: 'imageAttachments' },
  { id: 'c-note', name: 'Notas', type: 'canvas' },
  { id: 'c-cat', name: 'Lugar', type: 'select' },
  { id: 'c-rel', name: 'Anterior', type: 'lookup', lookupTableId: 'T1' },
  { id: 'c-date', name: 'Día', type: 'date' },
  { id: 'c-calc', name: 'Fotos de otra tabla', type: 'image', calculated: true },
].map((c) => ({ calculated: false, formula: null, display: c.id === 'c-name', lookupTableId: null, isArray: false, ...c }))

const INDEX = {
  tables: [
    { id: 'T1', name: 'Planos', type: 'table', layout: 'default', pageId: 'p1', baseTableId: null, displayColumnId: 'c-name', visibleColumnIds: COLUMNS.slice(0, 6).map((c) => c.id), columns: COLUMNS },
    { id: 'V1', name: 'Tarjetas', type: 'view', layout: 'card', pageId: 'p2', baseTableId: 'T1', displayColumnId: 'c-name', visibleColumnIds: ['c-name', 'c-cat'], columns: COLUMNS },
    { id: 'V2', name: 'Calendario', type: 'view', layout: 'calendar', pageId: 'p3', baseTableId: 'T1', displayColumnId: 'c-name', visibleColumnIds: ['c-name', 'c-date'], columns: COLUMNS },
    {
      id: 'T2', name: 'Tareas', type: 'table', layout: 'default', pageId: 'p6', baseTableId: null, displayColumnId: 'd-name', visibleColumnIds: ['d-name', 'd-who'],
      columns: [{ id: 'd-name', name: 'Tarea', type: 'text' }, { id: 'd-who', name: 'Quién', type: 'text' }],
    },
  ],
}

const ROWS = {
  T1: {
    visible: ['r1', 'r2'],
    rows: [
      { id: 'r1', name: 'Plano 1', values: { 'c-name': 'Plano 1', 'c-img': [img('bl-1')], 'c-note': 'nota api 1', 'c-cat': 'Exterior', 'c-rel': '', 'c-date': '2026-03-02T00:00:00.000-03:00', 'c-calc': [img('bl-9')] } },
      { id: 'r2', name: 'Plano 2', values: { 'c-name': 'Plano 2', 'c-img': [], 'c-note': 'nota api 2', 'c-cat': 'Interior', 'c-rel': [{ '@type': 'StructuredValue', additionalType: 'row', tableId: 'T1', rowId: 'r1', name: 'Plano 1' }], 'c-date': '2026-03-01T00:00:00.000-03:00' } },
      { id: 'r3', name: 'Plano 3', values: { 'c-name': 'Plano 3', 'c-note': 'nota api 3', 'c-cat': 'Exterior' } },
    ],
  },
  // La vista dice r1, pero el HTML muestra el plano 2: se reconoce por el texto.
  V1: { visible: ['r1'] },
  V2: { visible: ['r1', 'r2'] },
  T2: { visible: ['t1', 't2', 't3'], rows: [1, 2, 3].map((n) => ({ id: `t${n}`, name: `Tarea ${n}`, values: { 'd-name': `Tarea ${n}`, 'd-who': 'Ana' } })) },
}

const th = (id, name) => `<th data-coda-column-id="${id}">${name}</th>`
const HEAD = `<thead><tr>${th('c-name', 'Plano')}${th('c-img', 'Fotos')}${th('c-note', 'Notas')}${th('c-cat', 'Lugar')}${th('c-rel', 'Anterior')}</tr></thead>`
const HTML = {
  'p1.html':
    `<div>Arriba</div><table data-coda-grid-id="T1">${HEAD}<tbody>` +
    `<tr><td>Plano 1</td><td><img src="${blob('bl-1')}"></td><td><div>nota <b>rica</b> 1</div><div><img src="${blob('bl-2')}"></div></td><td style="background-color: rgb(1, 2, 3);">Exterior</td><td></td></tr>` +
    `<tr><td>Plano 2</td><td></td><td>nota api 2</td><td>Interior</td><td>Plano 1</td></tr>` +
    `</tbody></table><div>Abajo</div>`,
  'p2.html': `<table data-coda-grid-id="V1"><thead><tr>${th('c-name', 'Plano')}${th('c-cat', 'Lugar')}</tr></thead><tbody><tr><td>Plano 2</td><td>Interior</td></tr></tbody></table>`,
  'p3.html': `<table data-coda-grid-id="V2"><thead><tr>${th('c-name', 'Plano')}${th('c-date', 'Día')}</tr></thead><tbody><tr><td>Plano 1</td><td>2/3</td></tr><tr><td>Plano 2</td><td>1/3</td></tr></tbody></table>`,
  // Maquetado: una tabla sin encabezados con una foto al lado de su texto; y un link a otra página del doc.
  'p4.html': `<table><tbody><tr><td><img src="${blob('bl-3')}"></td><td>texto al lado</td></tr></tbody></table><div><a href="https://coda.io/d/_dDOC/Quinta_suP5">ir a la quinta</a></div>`,
  // Una tabla chica de solo texto, sin tabla de la API: queda igual.
  'p5.html': `<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>`,
  'p6.html': `<table data-coda-grid-id="T2"><thead><tr>${th('d-name', 'Tarea')}${th('d-who', 'Quién')}</tr></thead><tbody><tr><td>Tarea 1</td><td>Ana</td></tr></tbody></table>`,
}
const page = (id, order, extra = {}) => ({ id, name: `Página ${id}`, subtitle: '', icon: null, parentId: null, order, contentType: 'canvas', file: `${id}.html`, media: [], external: [], ...extra })
const MANIFEST = {
  doc: { id: 'DOC', name: 'Inventado' },
  pages: [
    page('p1', 0, { media: ['bl-1', 'bl-2'].map((b) => ({ url: blob(b), file: `${b}.png` })) }),
    page('p2', 1),
    page('p3', 2),
    page('p4', 3, { media: [{ url: blob('bl-3'), file: 'bl-3.png' }] }),
    page('p5', 4, { browserLink: 'https://coda.io/d/_dDOC/Quinta_suP5' }),
    page('p6', 5),
  ],
  problems: [],
}

const convert = (config = {}, extraMedia = []) =>
  convertTables({ manifest: MANIFEST, index: INDEX, rows: (id) => ROWS[id] ?? null, html: (f) => HTML[f] ?? null, parse, config, extraMedia })

describe('tablas de Coda → páginas', () => {
  const r = convert()
  const file = (id) => r.files.get(`pages/${r.manifest.pages.find((p) => p.id === id).file}`)

  it('una tabla con fotos pasa a fichas: una página por fila (también las que el filtro escondía), debajo de su página', () => {
    expect(r.modes.get('T1')).toBe('fichas')
    const rows = r.manifest.pages.filter((p) => p.generated === 'row').map((p) => [p.id, p.name, p.parentId, p.file])
    expect(rows).toEqual([
      ['row-T1-r1', 'Plano 1', 'p1', 'row-T1-r1.import.html'],
      ['row-T1-r2', 'Plano 2', 'p1', 'row-T1-r2.import.html'],
      ['row-T1-r3', 'Plano 3', 'p1', 'row-T1-r3.import.html'],
    ])
    // El manifest de Coda no se toca: lo nuevo va aparte.
    expect(MANIFEST.pages.map((p) => p.file)).toEqual(['p1.html', 'p2.html', 'p3.html', 'p4.html', 'p5.html', 'p6.html'])
  })

  it('la ficha: fotos propias (no las calculadas), la nota con su formato y fotos del HTML, el color de la celda, la relación como link', () => {
    const one = file('row-T1-r1')
    expect(one).toContain(blob('bl-1'))
    expect(one).toContain(blob('bl-2'))
    expect(one).not.toContain('bl-9')
    expect(one).toContain('nota <b>rica</b> 1')
    expect(one).not.toContain('nota api 1')
    expect(one).toMatch(/<span style="background-color: rgb\(1, 2, 3\)">Exterior<\/span>/)
    expect(r.manifest.pages.find((p) => p.id === 'row-T1-r1').media.map((m) => m.file).sort()).toEqual(['bl-1.png', 'bl-2.png'])
    expect(file('row-T1-r2')).toContain('<a href="coda-page:row-T1-r1">Plano 1</a>')
    // Una fila que ninguna vista mostraba: la nota de la API.
    expect(file('row-T1-r3')).toContain('nota api 3')
  })

  it('donde estaba la tabla queda un índice con un link a cada ficha y, al final, las filas que escondía el filtro', () => {
    const p1 = file('p1')
    expect(r.manifest.pages.find((p) => p.id === 'p1').file).toBe('p1.import.html')
    expect(p1).toContain('Arriba')
    expect(p1).toContain('Abajo')
    expect(p1).not.toContain('data-coda-grid-id')
    const links = [...p1.matchAll(/coda-page:(row-T1-r\d)/g)].map((m) => m[1])
    expect(links.slice(0, 2)).toEqual(['row-T1-r1', 'row-T1-r2'])
    expect(p1).toMatch(/Filas ocultas[^<]*\(1\)/)
    expect(links).toContain('row-T1-r3')
  })

  it('una vista de tarjetas: una tarjeta por fila; la fila se reconoce por el texto si la posición no coincide', () => {
    const p2 = file('p2')
    expect(p2).toContain('<h3><a href="coda-page:row-T1-r2">Plano 2</a></h3>')
    expect(p2).not.toContain('row-T1-r1')
  })

  it('un calendario: la lista por fecha', () => {
    const p3 = file('p3')
    expect([...p3.matchAll(/coda-page:(row-T1-r\d)/g)].map((m) => m[1])).toEqual(['row-T1-r2', 'row-T1-r1'])
  })

  it('una tabla de maquetado con fotos se desarma; una chica de texto queda igual; los links a páginas del doc pasan a coda-page', () => {
    const p4 = file('p4')
    expect(p4).not.toContain('<table')
    expect(p4).toContain('<div>texto al lado</div>')
    expect(p4).toContain('href="coda-page:p5"')
    // La tabla chica de p5 queda igual (la página se reescribe por si tuviera links, con el mismo contenido).
    expect(file('p5')).toContain('<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>')
    expect(r.modes.get('T2')).toBe('table')
  })

  it('modos forzados: text saca las fotos y deja la tabla; skip la cambia por una nota; un modo desconocido es un error', () => {
    const text = convert({ tables: { Planos: 'text' } })
    const p1 = text.files.get('pages/p1.import.html')
    expect(p1).toContain('<table')
    expect(p1).not.toContain('<img')
    expect(text.manifest.pages.some((p) => p.generated)).toBe(false)
    const skip = convert({ tables: { T1: 'skip' } })
    expect(skip.files.get('pages/p1.import.html')).toContain('Planos')
    expect(skip.files.get('pages/p1.import.html')).not.toContain('<table')
    expect(() => convert({ tables: { Planos: 'nada' } })).toThrow(/modo desconocido/)
  })

  it('un archivo que solo está en los datos de una tabla se pide; con él en extraMedia, queda en la ficha', () => {
    const rows = structuredClone(ROWS)
    rows.T1.rows[2].values['c-img'] = [img('bl-7')]
    const go = (extra) => convertTables({ manifest: MANIFEST, index: INDEX, rows: (id) => rows[id] ?? null, html: (f) => HTML[f] ?? null, parse, extraMedia: extra })
    expect(go([]).missingMedia).toEqual([blob('bl-7')])
    const got = go([{ url: blob('bl-7'), file: 'bl-7.png' }])
    expect(got.missingMedia).toEqual([])
    expect(got.manifest.pages.find((p) => p.id === 'row-T1-r3').media.map((m) => m.file)).toEqual(['bl-7.png'])
  })

  it('comentarios de filas: a su ficha (página entera); en una tabla que queda como tabla, anclados al texto de la fila', () => {
    const captured = [
      { tableId: 'T1', rows: [{ rowId: 'r1', commentThreads: [{ n: 1 }] }] },
      { tableId: 'T2', rows: [{ rowId: 't2', commentThreads: [{ n: 2 }] }] },
    ]
    const out = rowCommentsByPage(captured, { index: INDEX, rows: (id) => ROWS[id] ?? null, modes: r.modes, rowPages: r.rowPages })
    expect(out.get('row-T1-r1')).toEqual([{ n: 1, reference: null }])
    expect(out.get('p6')).toEqual([{ n: 2, reference: { type: 'text', text: 'Tarea 2' } }])
  })

  it('las notas del final cuentan lo que pasó, sin cortar con error', () => {
    expect(r.notes.some((n) => n.includes('Planos') && n.includes('fichas'))).toBe(true)
    expect(r.notes.some((n) => n.startsWith('links entre páginas: 1'))).toBe(true)
  })
})

describe('tables.config.json y --convert-only', () => {
  it('se revisa con errores claros', () => {
    expect(checkTablesConfig(null)).toEqual({})
    const ok = { tables: { Planos: 'fichas', T2: 'skip' }, index: { Planos: ['Lugar'] }, skipColumns: { Planos: ['Día'] } }
    expect(checkTablesConfig(ok)).toBe(ok)
    expect(() => checkTablesConfig([])).toThrow(/objeto/)
    expect(() => checkTablesConfig({ tabla: {} })).toThrow(/clave desconocida "tabla"/)
    expect(() => checkTablesConfig({ tables: { Planos: 'fotos' } })).toThrow(/modo "fotos" para "Planos"/)
    expect(() => checkTablesConfig({ index: { Planos: 'Lugar' } })).toThrow(/lista de nombres/)
    expect(() => checkTablesConfig({ skipColumns: [] })).toThrow(/tiene que ser un objeto/)
  })

  it('--convert-only toma la carpeta y no va con --refresh', () => {
    expect(parseExportArgs(['--convert-only', 'C:\\x'])).toEqual({ nameOrId: 'C:\\x', out: undefined, refresh: false, convertOnly: true })
    expect(() => parseExportArgs(['--convert-only', '--refresh', 'x'])).toThrow(/no va con --refresh/)
  })
})
