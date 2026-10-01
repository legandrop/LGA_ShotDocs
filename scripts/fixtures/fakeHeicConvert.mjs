// Un `heic-convert` de mentira (ver codaFakeApi.mjs): devuelve un "JPEG" (la firma y el texto del HEIC) y anota
// cada conversión en `CODA_FAKE_CONVERTS`. Un HEIC que dice "ROTO" falla, como un archivo dañado.

import { appendFileSync } from 'node:fs'

export default async function convert({ buffer, format, quality }) {
  const text = Buffer.from(buffer).toString('latin1')
  appendFileSync(process.env.CODA_FAKE_CONVERTS, `${format} ${quality} ${buffer.length}\n`)
  if (text.includes('ROTO')) throw new Error('HEIF image not found')
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`JPEG de ${buffer.length} bytes`)])
}
