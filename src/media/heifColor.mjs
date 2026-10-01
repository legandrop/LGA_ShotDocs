// El color de una foto HEIC/HEIF (Docs/Doc_Imagenes.md, "Fotos HEIC"): qué perfil ICC lleva su JPEG. Lo usan la
// app (`heic.ts`, con `heifColor.d.mts` para los tipos) y el comando que baja un doc de Coda
// (`scripts/lib/codaHeic.mjs`): por eso es JavaScript puro, sobre `Uint8Array` (un `Buffer` también lo es).
//
// El decodificador entrega los píxeles tal cual, en el espacio de color de la foto, sin perfil. Las del iPhone
// están en Display P3: sin su perfil, el JPEG se leería como sRGB y se vería menos saturado.
//
// Cuál es el color de la foto: el de su imagen principal. Un HEIC tiene varias imágenes (la foto, partida en
// cuadros; la miniatura; mapas de profundidad o de brillo), cada una con sus propiedades. Se sigue la cadena del
// formato: `pitm` (cuál es la principal) → `ipma` (qué propiedades tiene) → `ipco` (las propiedades). Si la
// principal no tiene color pero es una grilla, vale el de su primer cuadro (`iref` de tipo `dimg`). El color
// puede ser un perfil ICC (`colr` de tipo `prof` o `rICC`) o solo unos números (`nclx`: primarios y curva):
// con `nclx` se arma un perfil estándar equivalente (Display P3 o BT.2020; sRGB no hace falta, es lo que se
// supone sin perfil). Si el archivo no se puede leer así (cortado, raro), se busca como antes: el primer perfil
// de color que aparece.

const ascii = (bytes, at, length = 4) =>
  at >= 0 && at + length <= bytes.length ? String.fromCharCode(...bytes.subarray(at, at + length)) : ''
const u16 = (bytes, at) => (bytes[at] << 8) | bytes[at + 1]
const u32 = (bytes, at) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0

/**
 * Las cajas que hay entre `start` y `end`: `{ type, start, body, end }` (`body`: donde empieza el contenido).
 * Devuelve `null` si alguna no cierra bien (un archivo cortado o que no es de esta familia).
 */
function boxes(bytes, start, end) {
  const out = []
  let at = start
  while (at + 8 <= end) {
    let size = u32(bytes, at)
    let body = at + 8
    if (size === 1) {
      // Tamaño de 64 bits: en la cabecera de una foto nunca hace falta, salvo para la caja de datos (`mdat`).
      if (at + 16 > end) return null
      const high = u32(bytes, at + 8)
      size = high * 2 ** 32 + u32(bytes, at + 12)
      body = at + 16
    } else if (size === 0) {
      size = end - at
    }
    if (size < body - at) return null
    // La caja de datos puede quedar afuera de lo leído; las demás tienen que entrar enteras.
    const type = ascii(bytes, at + 4)
    if (at + size > end && type !== 'mdat') return null
    out.push({ type, start: at, body, end: Math.min(at + size, end) })
    at += size
  }
  return out
}

/** Una caja "completa" (`FullBox`): versión y banderas, y después el contenido. */
const full = (bytes, box) => ({ version: bytes[box.body], flags: (bytes[box.body + 1] << 16) | (bytes[box.body + 2] << 8) | bytes[box.body + 3], body: box.body + 4 })

/**
 * Un perfil ICC de color (RGB) válido, o `null`: lleva la firma `acsp` en el byte 36 y `RGB ` en el 16. El de
 * una imagen en grises (un mapa de profundidad) no es el de la foto, y lo que no tiene firma no se copia.
 */
function rgbProfile(icc) {
  return icc.length >= 128 && ascii(icc, 36) === 'acsp' && ascii(icc, 16) === 'RGB ' ? icc : null
}

/** Lo que dice una caja `colr`: `{ icc }`, `{ nclx }` o `null`. */
function readColr(bytes, box) {
  const kind = ascii(bytes, box.body)
  if (kind === 'prof' || kind === 'rICC') {
    const icc = rgbProfile(bytes.subarray(box.body + 4, box.end))
    return icc ? { icc } : null
  }
  if (kind === 'nclx' && box.body + 11 <= box.end) {
    return {
      nclx: {
        primaries: u16(bytes, box.body + 4),
        transfer: u16(bytes, box.body + 6),
        matrix: u16(bytes, box.body + 8),
        fullRange: bytes[box.body + 10] >> 7 === 1,
      },
    }
  }
  return null
}

/**
 * El color de la imagen principal: `{ icc }`, `{ nclx }`, `{}` si no declara ninguno, o `undefined` si el
 * archivo no se pudo leer así (entonces se busca por orden).
 */
export function primaryColor(bytes) {
  try {
    return readPrimaryColor(bytes)
  } catch {
    return undefined
  }
}

function readPrimaryColor(bytes) {
  const top = boxes(bytes, 0, bytes.length)
  const meta = top?.find((b) => b.type === 'meta')
  if (!meta) return undefined
  const children = boxes(bytes, full(bytes, meta).body, meta.end)
  if (!children) return undefined
  const pitm = children.find((b) => b.type === 'pitm')
  const iprp = children.find((b) => b.type === 'iprp')
  if (!pitm || !iprp) return undefined
  const p = full(bytes, pitm)
  const primary = p.version === 0 ? u16(bytes, p.body) : u32(bytes, p.body)
  const inIprp = boxes(bytes, iprp.body, iprp.end)
  const ipco = inIprp?.find((b) => b.type === 'ipco')
  if (!ipco) return undefined
  const properties = boxes(bytes, ipco.body, ipco.end)
  if (!properties) return undefined
  // Qué propiedades tiene cada imagen (puede haber más de una caja `ipma`).
  const associations = new Map()
  for (const ipma of inIprp.filter((b) => b.type === 'ipma')) {
    const { version, flags, body } = full(bytes, ipma)
    let at = body
    const count = u32(bytes, at)
    at += 4
    for (let i = 0; i < count; i++) {
      if (at + (version < 1 ? 3 : 5) > ipma.end) return undefined
      const item = version < 1 ? u16(bytes, at) : u32(bytes, at)
      at += version < 1 ? 2 : 4
      const n = bytes[at++]
      const list = associations.get(item) ?? []
      for (let k = 0; k < n; k++) {
        if (at + (flags & 1 ? 2 : 1) > ipma.end) return undefined
        // El bit más alto dice si la propiedad es esencial; el resto es su número en `ipco`, desde 1 (0: ninguna).
        const index = flags & 1 ? u16(bytes, at) & 0x7fff : bytes[at] & 0x7f
        at += flags & 1 ? 2 : 1
        if (index > 0) list.push(index)
      }
      associations.set(item, list)
    }
  }
  const colorOf = (item) => {
    let nclx = null
    for (const index of associations.get(item) ?? []) {
      const box = properties[index - 1]
      if (box?.type !== 'colr') continue
      const color = readColr(bytes, box)
      // Si declara las dos cosas, manda el perfil.
      if (color?.icc) return color
      if (color?.nclx && !nclx) nclx = color
    }
    return nclx
  }
  const own = colorOf(primary)
  if (own) return own
  // Una grilla (la foto en cuadros, como las del iPhone) sin color propio: el de su primer cuadro.
  const iref = children.find((b) => b.type === 'iref')
  if (iref) {
    const { version, body } = full(bytes, iref)
    const size = version === 0 ? 2 : 4
    for (const ref of boxes(bytes, body, iref.end) ?? []) {
      if (ref.type !== 'dimg') continue
      const from = size === 2 ? u16(bytes, ref.body) : u32(bytes, ref.body)
      if (from !== primary || ref.body + size + 2 + size > ref.end) continue
      const first = size === 2 ? u16(bytes, ref.body + size + 2) : u32(bytes, ref.body + size + 2)
      const tile = colorOf(first)
      if (tile) return tile
    }
  }
  return {}
}

/** El primer perfil ICC de color que aparece en el archivo (la forma de antes, para lo que no se puede leer). */
function firstProfile(bytes) {
  for (const type of ['prof', 'rICC']) {
    const mark = `colr${type}`
    for (let at = indexOfAscii(bytes, mark, 0); at >= 0; at = indexOfAscii(bytes, mark, at + 1)) {
      if (at < 4) continue
      const end = at - 4 + u32(bytes, at - 4)
      if (end > bytes.length || end < at + 8) continue
      const icc = rgbProfile(bytes.subarray(at + 8, end))
      if (icc) return icc
    }
  }
  return null
}

function indexOfAscii(bytes, text, from) {
  const first = text.charCodeAt(0)
  const last = bytes.length - text.length
  outer: for (let i = Math.max(0, from); i <= last; i++) {
    if (bytes[i] !== first) continue
    for (let j = 1; j < text.length; j++) if (bytes[i + j] !== text.charCodeAt(j)) continue outer
    return i
  }
  return -1
}

/**
 * El perfil de color (ICC) que lleva el JPEG de un HEIC, o `null` (sRGB: lo que se supone sin perfil). El de
 * la imagen principal; si solo declara `nclx`, uno estándar equivalente (`profileFromNclx`).
 */
export function heicColorProfile(bytes) {
  const color = primaryColor(bytes)
  if (color === undefined) return firstProfile(bytes)
  if (color.icc) return color.icc
  if (color.nclx) return profileFromNclx(color.nclx)
  return null
}

// --- Un perfil ICC a partir de `nclx` -------------------------------------------------------------------------

/** Los primarios (x, y de rojo, verde y azul) que se saben armar, por su número en `nclx` (ISO/IEC 23091-2). */
const PRIMARIES = {
  // 12: Display P3 (SMPTE EG 432-1), el de las fotos del iPhone y de las pantallas de Apple.
  12: { name: 'Display P3', xy: [0.68, 0.32, 0.265, 0.69, 0.15, 0.06] },
  // 9: BT.2020 (video de gama amplia; en una foto SDR, poco común).
  9: { name: 'BT.2020', xy: [0.708, 0.292, 0.17, 0.797, 0.131, 0.046] },
}
/** Blanco D65 (el de todos esos primarios). */
const D65 = [0.3127, 0.329]
/** El blanco del espacio de conexión de los perfiles (D50), como lo escribe el ICC. */
const PCS_D50 = [0.9642, 1, 0.8249]

/**
 * Las curvas, como función paramétrica de tipo 3 del ICC: `Y = (aX + b)^g` si `X >= d`, si no `Y = cX`.
 * sRGB (13, y 2: sin especificar, que en una foto es sRGB) y BT.709 (1, 6, 14, 15: la misma curva).
 */
const SRGB_CURVE = [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045]
const BT709_CURVE = [1 / 0.45, 1 / 1.099, 0.099 / 1.099, 1 / 4.5, 0.081]
const CURVES = { 13: SRGB_CURVE, 2: SRGB_CURVE, 1: BT709_CURVE, 6: BT709_CURVE, 14: BT709_CURVE, 15: BT709_CURVE }

/**
 * Un perfil ICC (v4, de pantalla, matriz y curvas) equivalente a lo que dice `nclx`, o `null`: con primarios
 * sRGB/BT.709 (1) no hace falta ninguno, y lo que no se sabe armar (HDR: curvas PQ o HLG; otros primarios) queda
 * sin perfil, como antes.
 */
export function profileFromNclx(nclx) {
  const primaries = PRIMARIES[nclx?.primaries]
  const curve = CURVES[nclx?.transfer]
  if (!primaries || !curve) return null
  return buildProfile(primaries.name, primaries.xy, curve)
}

const xyToXYZ = ([x, y]) => [x / y, 1, (1 - x - y) / y]
const mul = (a, b) => a.map((row) => b[0].map((_, j) => row.reduce((sum, v, k) => sum + v * b[k][j], 0)))
const apply = (m, v) => m.map((row) => row.reduce((sum, x, k) => sum + x * v[k], 0))
function invert(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ]
}
/** La adaptación de Bradford, la que pide el ICC para pasar de un blanco a otro. */
const BRADFORD = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
]

/** La matriz de RGB lineal a XYZ (D50) y la de adaptación (D65 → D50, la etiqueta `chad`). */
export function profileMatrices(xy, white = D65) {
  const r = xyToXYZ([xy[0], xy[1]])
  const g = xyToXYZ([xy[2], xy[3]])
  const b = xyToXYZ([xy[4], xy[5]])
  const M = [
    [r[0], g[0], b[0]],
    [r[1], g[1], b[1]],
    [r[2], g[2], b[2]],
  ]
  const W = xyToXYZ(white)
  const S = apply(invert(M), W)
  const toXYZ = M.map((row) => row.map((v, k) => v * S[k]))
  const src = apply(BRADFORD, W)
  const dst = apply(BRADFORD, PCS_D50)
  const scale = [
    [dst[0] / src[0], 0, 0],
    [0, dst[1] / src[1], 0],
    [0, 0, dst[2] / src[2]],
  ]
  const chad = mul(invert(BRADFORD), mul(scale, BRADFORD))
  return { toXYZ: mul(chad, toXYZ), chad }
}

/** Número con signo de 16.16 bits (`s15Fixed16Number` del ICC). */
const s15 = (v) => {
  const n = Math.round(v * 65536) | 0
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
}
const be32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const sig = (text) => [...text].map((c) => c.charCodeAt(0))
const pad4 = (bytes) => (bytes.length % 4 ? [...bytes, ...new Array(4 - (bytes.length % 4)).fill(0)] : bytes)
/** Un texto en inglés (`mluc`, el tipo de texto del ICC v4). */
const mluc = (text) => {
  const utf16 = [...text].flatMap((c) => [(c.charCodeAt(0) >> 8) & 0xff, c.charCodeAt(0) & 0xff])
  return [...sig('mluc'), 0, 0, 0, 0, ...be32(1), ...be32(12), ...sig('enUS'), ...be32(utf16.length), ...be32(28), ...utf16]
}
const xyz = (v) => [...sig('XYZ '), 0, 0, 0, 0, ...v.flatMap(s15)]

function buildProfile(name, xy, curve) {
  const { toXYZ, chad } = profileMatrices(xy)
  const column = (k) => [toXYZ[0][k], toXYZ[1][k], toXYZ[2][k]]
  const para = [...sig('para'), 0, 0, 0, 0, 0, 3, 0, 0, ...curve.flatMap(s15)]
  // Las tres curvas son la misma: una sola copia, apuntada tres veces (lo permite el ICC).
  const tags = [
    ['desc', mluc(name)],
    ['cprt', mluc('No copyright, use freely')],
    ['wtpt', xyz(PCS_D50)],
    ['chad', [...sig('sf32'), 0, 0, 0, 0, ...chad.flat().flatMap(s15)]],
    ['rXYZ', xyz(column(0))],
    ['gXYZ', xyz(column(1))],
    ['bXYZ', xyz(column(2))],
    ['rTRC', para],
    ['gTRC', 'rTRC'],
    ['bTRC', 'rTRC'],
  ]
  const table = []
  const data = []
  const offsets = new Map()
  let at = 128 + 4 + tags.length * 12
  for (const [tag, body] of tags) {
    if (typeof body === 'string') {
      table.push(...sig(tag), ...be32(offsets.get(body)[0]), ...be32(offsets.get(body)[1]))
      continue
    }
    offsets.set(tag, [at, body.length])
    table.push(...sig(tag), ...be32(at), ...be32(body.length))
    const padded = pad4(body)
    data.push(...padded)
    at += padded.length
  }
  const size = at
  const header = [
    ...be32(size),
    0, 0, 0, 0, // quién lo maneja: nadie en particular
    4, 0x30, 0, 0, // versión 4.3
    ...sig('mntr'),
    ...sig('RGB '),
    ...sig('XYZ '),
    // Fecha fija: el mismo HEIC da siempre el mismo JPEG.
    0x07, 0xea, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0,
    ...sig('acsp'),
    ...new Array(24).fill(0), // plataforma, banderas, fabricante, modelo, atributos
    0, 0, 0, 0, // intención: perceptual
    ...PCS_D50.flatMap(s15),
    ...new Array(4 + 16 + 28).fill(0), // creador, id del perfil (sin calcular), reservado
  ]
  return new Uint8Array([...header, ...be32(tags.length), ...table, ...data])
}
