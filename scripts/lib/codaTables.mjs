// Tablas de Coda (bases de datos) → páginas. Lo usa scripts/coda-export.mjs después de bajar el doc.
//
// Shot Docs no tiene bases de datos: tiene páginas. Una tabla "rica" de Coda (con fotos o muchas columnas) se
// convierte así, sin tocar la app:
//   - cada fila pasa a ser una página (una "ficha"): fotos arriba, campos cortos en una tabla de dos columnas,
//     textos largos debajo, cada uno con su título;
//   - donde estaba la tabla o una vista suya queda un índice (una tabla de texto con un link a cada ficha) o,
//     si era una vista de tarjetas, una tarjeta por fila (link, foto y campos);
//   - una relación entre tablas pasa a ser un link entre fichas (`coda-page:<id>`, que la importación cambia
//     por el link interno);
//   - una tabla simple con fotos (sin encabezados: Coda las usa para maquetar) se desarma por filas, así cada
//     foto queda junto a su texto; una tabla chica de solo texto queda como tabla.
// Todo es una función pura de lo bajado: el HTML de cada página (con el contenido rico de las celdas, pero
// con el filtro de la vista puesto y sin id de fila) y los datos de la API (todas las filas, con su id y
// sus relaciones, pero con el texto en Markdown y sin las fotos de las notas). Se juntan fila por fila.

/** @typedef {{ id: string, name: string, type: string, calculated: boolean, formula: string | null, display: boolean, lookupTableId: string | null }} Column */

export const MODES = ['fichas', 'unwrap', 'table', 'text', 'skip']

const LABELS = {
  group: (column, value) => `${column} ${value}`.trim(),
  noGroup: 'Sin grupo',
  hidden: 'Filas ocultas por el filtro de la vista en Coda',
  empty: '(sin filas)',
  untitled: '(sin título)',
  skipped: (name) => `La tabla «${name}» de Coda no se importó.`,
  other: 'Otros campos',
}

const IMAGE_TYPES = new Set(['image', 'attachments', 'imageAttachments'])
const LONG_TEXT = 140

export const rowPageId = (tableId, rowId) => `row-${tableId}-${rowId}`

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
/** Para comparar textos de dos fuentes (HTML y API): sin mayúsculas, espacios ni signos de formato. */
export const norm = (s) => squash(String(s ?? '').normalize('NFKC').replace(/[`*_]/g, '')).toLowerCase()
const stripTicks = (s) => s.replace(/^```([\s\S]*)```$/, '$1')

/** Un hash corto y estable (FNV-1a de 32 bits). */
function hash(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

const isImageValue = (v) => !!v && typeof v === 'object' && v['@type'] === 'ImageObject'
const isRowValue = (v) => !!v && typeof v === 'object' && v['@type'] === 'StructuredValue' && v.additionalType === 'row'
const isEmpty = (v) => v == null || v === '' || v === false || (Array.isArray(v) && v.every(isEmpty)) || (typeof v === 'string' && !stripTicks(v).trim())
const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v])

/** El valor de una celda de la API como texto plano. */
export function plainValue(v, column) {
  if (isEmpty(v)) return ''
  if (Array.isArray(v)) return v.map((x) => plainValue(x, column)).filter(Boolean).join(', ')
  if (typeof v === 'object') return squash(v.name ?? v.url ?? '')
  if (v === true) return '✓'
  // Un texto con un link viene en Markdown (`[texto](dirección)`): queda el texto.
  const text = stripTicks(String(v)).replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1')
  if (column && /^(date|dateTime|dp)$/i.test(column.type) && /^\d{4}-\d{2}-\d{2}T/.test(text)) return `${text.slice(8, 10)}/${text.slice(5, 7)}/${text.slice(0, 4)}`
  return text
}

/** El Markdown simple que da la API de Coda para un texto (viñetas, títulos, links, negrita), como HTML. */
export function markdownToHtml(md) {
  const inline = (s) =>
    esc(s)
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  const out = []
  let items = []
  const flush = () => {
    if (items.length) out.push(`<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`)
    items = []
  }
  for (const raw of stripTicks(md).split('\n')) {
    const line = raw.trimEnd()
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    const heading = line.match(/^#{1,6}\s+(.*)$/)
    if (bullet) {
      items.push(inline(bullet[1]))
      continue
    }
    flush()
    if (!line.trim()) continue
    out.push(heading ? `<div><b>${inline(heading[1])}</b></div>` : `<div>${inline(line)}</div>`)
  }
  flush()
  return out.join('')
}

/**
 * Convierte las tablas de un doc exportado.
 *
 * @param {object} input
 * @param {{ doc: object, pages: object[], problems?: string[] }} input.manifest  El manifest de coda-export.
 * @param {{ tables: object[] }} input.index  `tables/index.json`: tablas y vistas con sus columnas.
 * @param {(tableId: string) => { visible: string[], rows?: object[] } | null} input.rows  `tables/<id>.rows.json`.
 * @param {(file: string) => string | null} input.html  El HTML de una página (`pages/<file>`).
 * @param {(html: string) => Document} input.parse  Un analizador de HTML (jsdom).
 * @param {{ url: string, file: string }[]} [input.extraMedia]  Archivos de media/ que no figuran en ninguna página del manifest.
 * @param {object} [input.config]  `tables.config.json` de la carpeta: `{ tables: { <nombre o id>: modo }, index: { <nombre o id>: [columnas] } }`.
 * @returns {{ manifest: object, files: Map<string, string>, notes: string[], modes: Map<string, string>, rowPages: Map<string, string> }}
 */
export function convertTables({ manifest, index, rows, html, parse, config = {}, extraMedia = [] }) {
  const notes = []
  const files = new Map()
  // Los fragmentos chicos (una celda, el cuerpo de una ficha) se analizan todos en un mismo documento: crear
  // un documento por celda agota la memoria con unos miles de celdas.
  const scratch = parse('<body></body>')
  const fragment = (text) => {
    const el = scratch.createElement('div')
    el.innerHTML = text
    return el
  }
  const tables = new Map(index.tables.map((t) => [t.id, t]))
  const bases = index.tables.filter((t) => t.type === 'table')
  const data = new Map() // id de la tabla base → { rows: Map<id, fila>, order: string[] }
  for (const b of bases) {
    const got = rows(b.id)
    data.set(b.id, { rows: new Map((got?.rows ?? []).map((r) => [r.id, r])), visible: got?.visible ?? [], all: (got?.rows ?? []).map((r) => r.id) })
  }
  const columnsOf = (table) => new Map(table.columns.map((c) => [c.id, c]))
  const displayOf = (base, row) => squash(plainValue(row.values?.[base.displayColumnId], null) || row.name || '') || LABELS.untitled

  // --- 1. Leer cada página: sus tablas, a qué tabla o vista de la API corresponde cada una y sus filas ------
  const docs = new Map() // id de página → { doc, found: [{ el, table, base, ths, rowIds }] }
  const cells = new Map() // `${base} ${fila} ${columna}` → HTML de la celda (el más completo que se vio)
  const cellOf = (baseId, rowId, columnId) => cells.get(`${baseId} ${rowId} ${columnId}`)
  // El color con que Coda pintaba cada celda (el resultado de sus reglas de color; las reglas no se exportan).
  const paints = new Map()
  const paint = (baseId, rowId, columnId, inner) => {
    const p = paints.get(`${baseId} ${rowId} ${columnId}`)
    return p && inner ? `<span style="${p}">${inner}</span>` : inner
  }
  const seenWithImages = new Set() // tablas del HTML que no están en la API y tienen fotos

  for (const page of manifest.pages) {
    const raw = page.file ? html(page.file) : null
    if (!raw || !raw.includes('<table')) continue
    const doc = parse(`<body>${raw}</body>`)
    const found = []
    const pending = index.tables.filter((t) => t.pageId === page.id)
    for (const el of doc.body.querySelectorAll('table')) {
      if (el.parentElement?.closest('table')) continue
      const grid = el.getAttribute('data-coda-grid-id')
      const ths = [...el.querySelectorAll(':scope > thead > tr > th')]
      const at = pending.findIndex((t) => t.id === grid || t.baseTableId === grid)
      const table = at >= 0 ? pending.splice(at, 1)[0] : (tables.get(grid) ?? null)
      const base = table ? (table.type === 'table' ? table : tables.get(table.baseTableId)) : null
      const trs = [...el.querySelectorAll(':scope > tbody > tr')]
      const entry = { el, table, base, ths, trs, rowIds: [], headerless: ths.length === 0 }
      if (table && base && data.get(base.id)) entry.rowIds = matchRows(entry, table, base)
      found.push(entry)
    }
    docs.set(page.id, { doc, found })
  }

  /** Qué fila de la API es cada fila del HTML: por posición (la vista ya viene en su orden) y, si no coincide, por el texto. */
  function matchRows(entry, table, base) {
    const d = data.get(base.id)
    const order = (table.type === 'table' ? d.visible : rows(table.id)?.visible) ?? []
    const colIds = entry.ths.map((th) => th.getAttribute('data-coda-column-id'))
    const cols = columnsOf(base)
    // Una fila se reconoce por sus columnas de texto de una línea (lo demás se escribe distinto en cada
    // fuente: fechas, listas, notas): solo letras y números, para que no importen espacios ni signos.
    const key = (s) => norm(s).replace(/[^\p{L}\p{N}]+/gu, '')
    const keys = colIds.map((id, i) => ({ id, i })).filter(({ id }) => cols.get(id)?.type === 'text')
    const score = (tr, rowId) => {
      const row = d.rows.get(rowId)
      if (!row) return -1
      const tds = tr.querySelectorAll(':scope > td')
      let equal = 0
      for (const { id, i } of keys) {
        const api = key(plainValue(row.values?.[id], cols.get(id)))
        const web = key(tds[i]?.textContent ?? '')
        if (api.length > 200 || /\n/.test(String(row.values?.[id] ?? '').trim())) continue
        if (api === web) equal++
        else if (id === base.displayColumnId) return -1
        else equal -= 1
      }
      return equal
    }
    const same = (tr, rowId) => score(tr, rowId) >= Math.min(1, keys.length)
    const best = (tr, ids) => {
      let top = null
      let topScore = 0
      for (const x of ids) {
        if (used.has(x)) continue
        const s = score(tr, x)
        if (s > topScore) [top, topScore] = [x, s]
      }
      return top
    }
    const used = new Set()
    const out = []
    entry.trs.forEach((tr, i) => {
      let id = order[i]
      // La posición manda (la vista ya viene en su orden); si esa fila no se parece, se busca la que más.
      if (!id || used.has(id) || (keys.length && !same(tr, id))) id = keys.length ? (best(tr, order) ?? best(tr, d.all)) : null
      if (id) used.add(id)
      out.push(id)
      if (!id) return
      const tds = tr.querySelectorAll(':scope > td')
      colIds.forEach((columnId, c) => {
        const td = tds[c]
        if (!columnId || !td) return
        const key = `${base.id} ${id} ${columnId}`
        const inner = td.innerHTML.trim()
        if (inner && (cells.get(key)?.length ?? 0) < inner.length) cells.set(key, inner)
        const style = td.getAttribute('style') ?? ''
        const bg = style.match(/background-color:\s*([^;]+)/i)?.[1]
        const fg = style.match(/(?:^|;)\s*color:\s*([^;]+)/i)?.[1]
        if (bg || fg) paints.set(key, [bg && `background-color: ${bg.trim()}`, fg && `color: ${fg.trim()}`].filter(Boolean).join('; '))
      })
    })
    const lost = out.filter((x) => !x).length
    if (lost) notes.push(`${table.name}: ${lost} de ${out.length} filas del HTML no se reconocieron en los datos de la API (quedan sin ficha propia)`)
    return out
  }

  // --- 2. Qué se hace con cada tabla base ---------------------------------------------------------------------
  const modes = new Map()
  for (const b of bases) {
    const forced = config.tables?.[b.name] ?? config.tables?.[b.id]
    if (forced) {
      if (!MODES.includes(forced)) throw new Error(`tables.config.json: modo desconocido "${forced}" para ${b.name}`)
      modes.set(b.id, forced)
      continue
    }
    const d = data.get(b.id)
    const imageCols = b.columns.filter((c) => IMAGE_TYPES.has(c.type))
    const hasImages = [...d.rows.values()].some((r) => imageCols.some((c) => !isEmpty(r.values?.[c.id])))
    const headerless = [...docs.values()].some((p) => p.found.some((f) => f.base?.id === b.id && f.headerless))
    // Sin encabezados, o de una sola columna o un par de filas: es maquetado, no una base de datos.
    const layout = headerless || b.columns.length <= 1 || d.all.length <= 2
    modes.set(b.id, layout ? (hasImages ? 'unwrap' : 'table') : hasImages || b.columns.length > 8 ? 'fichas' : 'table')
  }
  const isFichas = (baseId) => modes.get(baseId) === 'fichas'

  // --- 3. Las páginas nuevas: una ficha por fila, agrupadas como la tabla en Coda ------------------------------
  const rowPages = new Map() // `${base} ${fila}` → id de la página
  const pages = manifest.pages.map((p) => ({ ...p }))
  const byId = new Map(pages.map((p) => [p.id, p]))
  const nextOrder = new Map()
  const orderUnder = (parentId) => {
    if (!nextOrder.has(parentId)) nextOrder.set(parentId, Math.max(-1, ...pages.filter((p) => (p.parentId ?? null) === parentId).map((p) => p.order ?? 0)) + 1)
    const n = nextOrder.get(parentId)
    nextOrder.set(parentId, n + 1)
    return n
  }
  const groups = new Map() // id de tabla base → [{ id, title, rowIds }]
  const mediaFile = new Map() // blob → archivo en media/
  for (const p of manifest.pages) for (const m of p.media ?? []) mediaFile.set(blobOf(m.url) || m.url, m)
  // Los archivos que no están en ninguna página y se bajaron por los datos de una tabla.
  for (const m of extraMedia) mediaFile.set(blobOf(m.url) || m.url, m)

  for (const b of bases) {
    if (!isFichas(b.id)) continue
    const d = data.get(b.id)
    const home = byId.get(b.pageId)
    if (!home) {
      notes.push(`${b.name}: la página donde está la tabla no se exportó; sus fichas van al primer nivel`)
    }
    const parentId = home?.id ?? null
    // El grupo de la tabla en Coda (data-coda-vertical-group-ids de su página), si tiene.
    const own = [...docs.values()].flatMap((p) => p.found).find((f) => f.table?.id === b.id)
    const groupCol = groupColumn(own?.el, b)
    const visible = d.visible.filter((id) => d.rows.has(id))
    const hidden = d.all.filter((id) => !visible.includes(id))
    const ordered = [...visible, ...hidden]
    const made = []
    if (groupCol) {
      const byValue = new Map()
      for (const id of ordered) {
        const value = plainValue(d.rows.get(id).values?.[groupCol.id], groupCol) || ''
        if (!byValue.has(value)) byValue.set(value, [])
        byValue.get(value).push(id)
      }
      for (const [value, ids] of byValue) {
        const id = `group-${b.id}-${hash(value)}`
        const title = value ? LABELS.group(groupCol.name, value) : LABELS.noGroup
        pages.push({ id, name: title, subtitle: '', icon: null, parentId, order: orderUnder(parentId), contentType: 'canvas', file: `${id}.import.html`, media: [], external: [], generated: 'group' })
        made.push({ id, title, rowIds: ids })
      }
    } else made.push({ id: parentId, title: null, rowIds: ordered })
    groups.set(b.id, made)
    for (const g of made) {
      for (const rowId of g.rowIds) {
        const id = rowPageId(b.id, rowId)
        rowPages.set(`${b.id} ${rowId}`, id)
        pages.push({
          id,
          name: displayOf(b, d.rows.get(rowId)),
          subtitle: '',
          icon: null,
          parentId: g.id,
          order: orderUnder(g.id),
          contentType: 'canvas',
          file: `${id}.import.html`,
          media: [],
          external: [],
          generated: 'row',
        })
      }
    }
  }

  function groupColumn(el, base) {
    if (!el) return null
    try {
      const ids = JSON.parse(el.getAttribute('data-coda-vertical-group-ids') ?? '[]')
      return base.columns.find((c) => c.id === ids[0]) ?? null
    } catch {
      return null
    }
  }

  // --- 4. El contenido de cada cosa ---------------------------------------------------------------------------
  const linkTo = (baseId, rowId, text) => {
    const target = rowPages.get(`${baseId} ${rowId}`)
    return target ? `<a href="coda-page:${target}">${esc(text)}</a>` : esc(text)
  }
  const imgTag = (url, name, width) => `<div><img src="${esc(url)}" alt="${esc(name ?? '')}"${width ? ` width="${width}"` : ''}></div>`

  /** Las fotos de una columna de fotos, sin el tamaño de miniatura que tenían en la celda. */
  function imagesOf(base, row, column, width) {
    const fromCell = cellOf(base.id, row.id, column.id)
    if (fromCell) {
      const imgs = [...fragment(fromCell).querySelectorAll('img')]
      if (imgs.length) return imgs.map((i) => imgTag(i.getAttribute('src'), i.getAttribute('alt'), width)).join('')
    }
    return list(row.values?.[column.id]).filter(isImageValue).map((v) => imgTag(v.url, v.name, width)).join('')
  }

  /** El valor de un campo, como HTML: `{ html, long }` (largo: va con su título, fuera de la tabla de campos). */
  function fieldHtml(base, row, column) {
    const value = row.values?.[column.id]
    const cell = cellOf(base.id, row.id, column.id)
    const values = list(value)
    if (values.length && values.every(isRowValue)) {
      return { html: values.map((v) => linkTo(v.tableId, v.rowId, squash(v.name))).join(', '), long: false }
    }
    if (values.length && values.every((v) => v && typeof v === 'object' && v['@type'] === 'WebPage')) {
      return { html: values.map((v) => `<a href="${esc(v.url)}">${esc(v.name || v.url)}</a>`).join(', '), long: false }
    }
    if (column.type === 'canvas' || column.type === 'text') {
      // El texto: el del HTML si esa celda se vio en alguna vista (trae formato y fotos); si no, el de la API.
      if (cell) {
        const tmp = fragment(cell)
        const text = squash(tmp.textContent)
        const blocks = tmp.querySelector('ul, ol, img, table, h1, h2, h3, h4, video, br') || tmp.querySelectorAll('div, p').length > 1
        if (!text && !tmp.querySelector('img, video, a')) return { html: '', long: false }
        if (column.type === 'canvas') stats.richNotes++
        return blocks || text.length > LONG_TEXT ? { html: cell, long: true } : { html: tmp.innerHTML, long: false }
      }
      if (isEmpty(value)) return { html: '', long: false }
      const text = stripTicks(String(value))
      // Esa celda no se vio en ninguna vista: queda el texto de la API (Markdown, sin las fotos de la nota).
      if (column.type === 'canvas') stats.apiNotes++
      const made = markdownToHtml(text)
      const multi = /\n/.test(text.trim()) || text.length > LONG_TEXT || made.includes('<ul>')
      return multi ? { html: made, long: true } : { html: made.replace(/^<div>|<\/div>$/g, ''), long: false }
    }
    // Fechas, números, listas de opciones: el texto del HTML (ya viene con el formato de Coda) o el de la API.
    if (cell) {
      const text = squash(fragment(cell).textContent)
      if (text) return { html: esc(text), long: false }
    }
    return { html: esc(plainValue(value, column)), long: false }
  }

  /** El cuerpo de una ficha (o de una tarjeta, con las columnas de la vista). */
  function fichaBody(base, row, columns, { imageWidth, heading }) {
    const out = []
    const short = []
    const long = []
    const skip = config.skipColumns?.[base.name] ?? config.skipColumns?.[base.id] ?? []
    for (const column of columns) {
      if (column.id === base.displayColumnId || skip.includes(column.name) || skip.includes(column.id)) continue
      if (IMAGE_TYPES.has(column.type)) {
        // Las fotos que la fila trae de otra tabla (una columna calculada) no se copian: están en la ficha
        // de esa otra fila, a un link de distancia.
        if (!column.calculated) out.push(imagesOf(base, row, column, imageWidth))
        continue
      }
      const { html: value, long: isLong } = fieldHtml(base, row, column)
      if (!value) continue
      if (isLong) long.push(`<${heading}>${esc(column.name)}</${heading}>${value}`)
      else short.push(`<tr><td><b>${esc(column.name)}</b></td><td>${paint(base.id, row.id, column.id, value)}</td></tr>`)
    }
    if (short.length) out.push(`<table><tbody>${short.join('')}</tbody></table>`)
    out.push(...long)
    return out.join('')
  }

  /** Las columnas de una ficha: las que se ven en la tabla, en su orden, y después las ocultas con datos propios. */
  function fichaColumns(base) {
    const shown = new Set(base.visibleColumnIds ?? base.columns.map((c) => c.id))
    const own = [...docs.values()].flatMap((p) => p.found).find((f) => f.table?.id === base.id)
    const order = own ? own.ths.map((th) => th.getAttribute('data-coda-column-id')) : []
    const rank = (c) => (order.includes(c.id) ? order.indexOf(c.id) : shown.has(c.id) ? 1000 : 2000)
    return base.columns
      .filter((c) => order.includes(c.id) || shown.has(c.id) || !c.calculated)
      .map((c, i) => ({ c, i }))
      .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
      .map(({ c }) => c)
  }

  /** Las columnas del índice de una tabla: las de `tables.config.json`, o todas las de texto que se ven. */
  function indexColumns(base, shownIds) {
    const wanted = config.index?.[base.name] ?? config.index?.[base.id]
    if (wanted) {
      const found = wanted.map((name) => base.columns.find((c) => c.name === name || c.id === name)).filter(Boolean)
      if (found.length !== wanted.length) notes.push(`${base.name}: tables.config.json nombra columnas que no existen`)
      return found
    }
    // Sin configuración: todas las columnas que mostraba la vista, menos las de fotos (una celda de la tabla de
    // la app solo lleva texto; las fotos están en la ficha de cada fila).
    return shownIds.map((id) => base.columns.find((c) => c.id === id)).filter((c) => c && c.id !== base.displayColumnId && !IMAGE_TYPES.has(c.type) && c.type !== 'button')
  }

  function indexTable(base, rowIds, columns, first) {
    const d = data.get(base.id)
    if (!rowIds.length) return `<div><i>${LABELS.empty}</i></div>`
    const display = base.columns.find((c) => c.id === base.displayColumnId)
    const head = [...(first ? [first] : []), display ?? { name: '' }, ...columns].map((c) => `<th>${esc(c.name)}</th>`).join('')
    const body = rowIds
      .map((id) => {
        const row = d.rows.get(id)
        const tds = [
          ...(first ? [`<td>${esc(plainValue(row.values?.[first.id], first))}</td>`] : []),
          `<td>${paint(base.id, id, base.displayColumnId, linkTo(base.id, id, displayOf(base, row)))}</td>`,
          ...columns.map((c) => {
            const v = row.values?.[c.id]
            const vs = list(v)
            return `<td>${paint(base.id, id, c.id, vs.length && vs.every(isRowValue) ? vs.map((x) => linkTo(x.tableId, x.rowId, squash(x.name))).join(', ') : esc(plainValue(v, c)))}</td>`
          }),
        ]
        return `<tr>${tds.join('')}</tr>`
      })
      .join('')
    return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
  }

  /** Lo que queda donde estaba una tabla o una vista de una tabla con fichas. */
  function replacement(entry) {
    const { table, base, ths } = entry
    const d = data.get(base.id)
    const shownIds = ths.map((th) => th.getAttribute('data-coda-column-id')).filter(Boolean)
    const ids = entry.rowIds.filter(Boolean)
    if (/card/i.test(table.layout ?? '')) {
      // Vista de tarjetas: una tarjeta por fila, con las columnas que mostraba la vista.
      const columns = shownIds.map((id) => base.columns.find((c) => c.id === id)).filter(Boolean)
      if (!ids.length) return `<div><i>${LABELS.empty}</i></div>`
      return ids.map((id) => `<h3>${linkTo(base.id, id, displayOf(base, d.rows.get(id)))}</h3>${fichaBody(base, d.rows.get(id), columns, { imageWidth: 480, heading: 'h4' })}`).join('')
    }
    const columns = indexColumns(base, shownIds)
    if (/calendar|gantt|timeline/i.test(table.layout ?? '')) {
      // Calendario o timeline: la lista por fecha.
      const dateCol = base.columns.find((c) => /^(date|dateTime|dp)$/i.test(c.type) && shownIds.includes(c.id)) ?? base.columns.find((c) => /^(date|dateTime|dp)$/i.test(c.type))
      const key = (id) => String(d.rows.get(id).values?.[dateCol?.id] ?? '') || '9999'
      const sorted = [...ids].sort((a, b) => key(a).localeCompare(key(b)))
      return indexTable(base, sorted, columns.filter((c) => c.id !== dateCol?.id), dateCol)
    }
    if (table.id !== base.id) return indexTable(base, ids, columns)
    // La tabla base en su página: el índice por grupo, y al final las filas que el filtro de Coda escondía.
    const visible = new Set(d.visible)
    const out = []
    const hidden = []
    for (const g of groups.get(base.id) ?? []) {
      const shown = g.rowIds.filter((id) => visible.has(id))
      hidden.push(...g.rowIds.filter((id) => !visible.has(id)))
      if (!shown.length) continue
      if (g.title) out.push(`<h3><a href="coda-page:${g.id}">${esc(g.title)}</a></h3>`)
      out.push(indexTable(base, shown, columns))
    }
    if (hidden.length) out.push(`<h3>${LABELS.hidden} (${hidden.length})</h3>${indexTable(base, hidden, columns)}`)
    return out.join('') || `<div><i>${LABELS.empty}</i></div>`
  }

  /** Una tabla de maquetado: su contenido, fila por fila, fuera de la tabla. */
  function unwrap(entry) {
    const out = []
    for (const tr of entry.trs) {
      for (const td of tr.querySelectorAll(':scope > td')) {
        const inner = td.innerHTML.trim()
        if (!inner) continue
        out.push(/^<(div|ul|ol|h[1-6]|p|table)\b/i.test(inner) ? inner : `<div>${inner}</div>`)
      }
      out.push('<div><br></div>')
    }
    return out.join('')
  }

  // Links a otras páginas del doc (su dirección en Coda) y a filas con ficha (por el nombre que muestra el link).
  const pageBySlug = new Map()
  for (const p of manifest.pages) {
    const slug = String(p.browserLink ?? '').match(/_su([A-Za-z0-9_-]+)/)?.[1]
    if (slug) pageBySlug.set(slug, p.id)
  }
  const stats = { pageLinks: 0, rowLinks: 0, rowLinksLeft: 0, richNotes: 0, apiNotes: 0 }
  const missing = new Set()
  function rewriteLinks(root) {
    for (const a of root.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href')
      if (/^coda-page:/.test(href)) continue
      if (!/^https:\/\/(docs\.superhuman\.com|coda\.io)\/d\//.test(href)) continue
      const row = href.match(/#[^/]*_tu([A-Za-z0-9_-]+)\/r\d+/)
      if (row) {
        const base = bases.find((b) => b.id.endsWith(row[1]))
        const wanted = norm(a.textContent)
        const hits = base && isFichas(base.id) ? [...data.get(base.id).rows.values()].filter((r) => norm(displayOf(base, r)) === wanted) : []
        if (hits.length === 1) {
          a.setAttribute('href', `coda-page:${rowPageId(base.id, hits[0].id)}`)
          stats.rowLinks++
        } else stats.rowLinksLeft++
        continue
      }
      const slug = href.match(/_su([A-Za-z0-9_-]+)/)?.[1]
      if (slug && pageBySlug.has(slug)) {
        a.setAttribute('href', `coda-page:${pageBySlug.get(slug)}`)
        stats.pageLinks++
      }
    }
  }

  const finish = (page, body) => {
    const root = fragment(body)
    rewriteLinks(root)
    const out = root.innerHTML
    page.media = mediaIn(out)
    files.set(`pages/${page.file}`, out)
  }
  function mediaIn(text) {
    const seen = new Map()
    for (const m of text.matchAll(/https:\/\/(?:codahosted\.io|coda\.io\/blobs|docs\.superhuman\.com\/blobs)\/[^"'\s)<>]+/g)) {
      const url = m[0].replace(/&amp;/g, '&')
      const known = mediaFile.get(blobOf(url) || url)
      if (known) seen.set(known.file, { ...known, url })
      else if (!seen.has(url)) seen.set(url, { url, file: '', missing: true })
    }
    const out = [...seen.values()]
    // Un archivo que solo está en los datos de la tabla (una fila que ninguna vista mostraba): hay que bajarlo.
    for (const m of out.filter((x) => x.missing)) missing.add(m.url)
    return out.filter((x) => !x.missing)
  }

  // Las páginas que ya existían: cada tabla, según su modo.
  for (const page of pages) {
    const read = docs.get(page.id)
    if (!read) continue
    let changed = false
    for (const entry of read.found) {
      const mode = entry.base ? modes.get(entry.base.id) : entry.headerless && entry.el.querySelector('img') ? 'unwrap' : 'table'
      if (!entry.base && mode === 'unwrap') seenWithImages.add(page.id)
      if (mode === 'table') continue
      let next = ''
      if (mode === 'fichas') next = replacement(entry)
      else if (mode === 'unwrap') next = unwrap(entry)
      else if (mode === 'text') {
        for (const img of entry.el.querySelectorAll('img, video')) img.remove()
        continue
      } else if (mode === 'skip') next = `<div><i>${esc(LABELS.skipped(entry.table?.name ?? ''))}</i></div>`
      const holder = read.doc.createElement('div')
      holder.innerHTML = next
      entry.el.replaceWith(...holder.childNodes)
      changed = true
    }
    const textOnly = read.found.some((e) => e.base && modes.get(e.base.id) === 'text')
    if (!changed && !textOnly && !pageBySlug.size) continue
    page.file = page.file.replace(/\.html$/, '.import.html')
    finish(page, read.doc.body.innerHTML)
  }
  // Las páginas sin tablas también pueden tener links a otras páginas o a filas.
  for (const page of pages) {
    if (page.generated || docs.has(page.id) || !page.file) continue
    const raw = html(page.file)
    if (!raw || !/href="https:\/\/(docs\.superhuman\.com|coda\.io)\/d\//.test(raw)) continue
    page.file = page.file.replace(/\.html$/, '.import.html')
    finish(page, raw)
  }
  // Las fichas y las páginas de grupo.
  for (const b of bases) {
    if (!isFichas(b.id)) continue
    const d = data.get(b.id)
    const columns = fichaColumns(b)
    const shownIds = columns.map((c) => c.id)
    for (const g of groups.get(b.id) ?? []) {
      if (g.title) finish(byId2(g.id), indexTable(b, g.rowIds, indexColumns(b, shownIds)))
      for (const rowId of g.rowIds) finish(byId2(rowPageId(b.id, rowId)), fichaBody(b, d.rows.get(rowId), columns, { heading: 'h3' }))
    }
  }
  function byId2(id) {
    return pages.find((p) => p.id === id)
  }

  for (const [id, mode] of modes) notes.push(`tabla «${tables.get(id).name}» (${data.get(id).all.length} filas, ${tables.get(id).columns.length} columnas): ${mode}`)
  if (seenWithImages.size) notes.push(`${seenWithImages.size} páginas con tablas de maquetado con fotos: se desarmaron por filas`)
  if (stats.apiNotes) notes.push(`notas (columnas de texto libre): ${stats.richNotes} con su formato y fotos; ${stats.apiNotes} solo con el texto de la API (esa fila no aparecía en ninguna vista con esa columna: revisar si tenían fotos)`)
  else notes.push(`notas (columnas de texto libre): ${stats.richNotes}, todas con su formato y fotos`)
  notes.push(`links entre páginas: ${stats.pageLinks}; links a fichas: ${stats.rowLinks}; links a filas que quedaron apuntando a Coda: ${stats.rowLinksLeft}`)
  return { manifest: { ...manifest, pages }, files, notes, modes, rowPages, missingMedia: [...missing] }
}

const blobOf = (url) => String(url).match(/\/blobs\/(bl-[A-Za-z0-9_-]+)/)?.[1] ?? ''

/**
 * Los comentarios de filas (capturados con el MCP de Coda, `table_rows_read` con `includeComments`) pasan a
 * la página que le toca a cada fila: su ficha (a la página entera) o, si la tabla quedó como tabla, la
 * página donde está, anclados al texto de la fila.
 *
 * @param {{ tableId: string, rows: { rowId: string, commentThreads: object[] }[] }[]} captured
 * @returns {Map<string, object[]>} id de página → hilos, con la forma de `comments.json`.
 */
export function rowCommentsByPage(captured, { index, rows, modes, rowPages }) {
  const out = new Map()
  const tables = new Map(index.tables.map((t) => [t.id, t]))
  for (const { tableId, rows: withComments } of captured) {
    const base = tables.get(tableId)
    if (!base) continue
    const all = new Map((rows(tableId)?.rows ?? []).map((r) => [r.id, r]))
    for (const { rowId, commentThreads } of withComments) {
      const ficha = rowPages.get(`${tableId} ${rowId}`)
      const pageId = ficha ?? base.pageId
      if (!pageId) continue
      const row = all.get(rowId)
      const text = row ? squash(plainValue(row.values?.[base.displayColumnId], null) || row.name || '') : ''
      const reference = ficha || !text || modes.get(tableId) !== 'table' ? null : { type: 'text', text }
      if (!out.has(pageId)) out.set(pageId, [])
      for (const thread of commentThreads) out.get(pageId).push({ ...thread, reference })
    }
  }
  return out
}
