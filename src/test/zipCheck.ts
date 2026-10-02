// Para las pruebas del zip de "Download all": abrir lo que escribe `zipWriter.ts` con un lector que no es nuestro
// (el módulo `zipfile` de Python, que comprueba cada CRC con `testzip()`). Si la máquina no tiene Python, las
// pruebas que lo usan se saltean (`hasPython`); las demás miran el zip con lo de abajo.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PYTHON = process.env.PYTHON ?? 'python';

export const hasPython: boolean = (() => {
  try {
    const r = spawnSync(PYTHON, ['-c', 'import zipfile, zlib, json; print("ok")'], { encoding: 'utf8', timeout: 20_000 });
    return r.status === 0 && r.stdout.trim() === 'ok';
  } catch {
    return false;
  }
})();

export interface PyEntry {
  name: string;
  size: number;
  crc: number;
  dir: boolean;
  /** El contenido en base64 (solo de los chicos). */
  data?: string;
}

export interface PyZip {
  /** El primer archivo con el CRC mal según `testzip()`, o `null`. */
  bad: string | null;
  entries: PyEntry[];
}

// `segments`: el zip "con huecos" (lo que no está es ceros), para probar uno de más de 4 GiB sin escribirlo.
const SCRIPT = String.raw`
import base64, io, json, sys, zipfile

class Holes(io.RawIOBase):
    def __init__(self, size, segments):
        self.size = size
        self.segments = segments
        self.pos = 0
    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        if whence == 0: self.pos = off
        elif whence == 1: self.pos += off
        else: self.pos = self.size + off
        return self.pos
    def readinto(self, b):
        n = min(len(b), self.size - self.pos)
        if n <= 0: return 0
        out = bytearray(n)
        for start, data in self.segments:
            end = start + len(data)
            lo = max(start, self.pos); hi = min(end, self.pos + n)
            if lo < hi: out[lo - self.pos:hi - self.pos] = data[lo - start:hi - start]
        b[:n] = out
        self.pos += n
        return n

src = sys.argv[1]
if src.endswith('.json'):
    spec = json.load(open(src))
    f = io.BufferedReader(Holes(spec['size'], [(s, base64.b64decode(d)) for s, d in spec['segments']]), 1 << 20)
else:
    f = open(src, 'rb')
with zipfile.ZipFile(f) as z:
    bad = z.testzip()
    out = []
    for i in z.infolist():
        e = {'name': i.filename, 'size': i.file_size, 'crc': i.CRC, 'dir': i.is_dir()}
        if not i.is_dir() and i.file_size <= 65536:
            e['data'] = base64.b64encode(z.read(i)).decode()
        out.append(e)
print(json.dumps({'bad': bad, 'entries': out}))
`;

function run(path: string): PyZip {
  const dir = mkdtempSync(join(tmpdir(), 'zipcheck-'));
  try {
    const script = join(dir, 'check.py');
    writeFileSync(script, SCRIPT);
    const r = spawnSync(PYTHON, [script, path], { encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`python: ${r.stderr || r.stdout}`);
    return JSON.parse(r.stdout) as PyZip;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Abre un zip entero con Python. */
export function pythonReadZip(bytes: Uint8Array): PyZip {
  const dir = mkdtempSync(join(tmpdir(), 'zipcheck-'));
  try {
    const file = join(dir, 'a.zip');
    writeFileSync(file, bytes);
    return run(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Abre un zip "con huecos" (lo que no está en `segments` son ceros) con Python. */
export function pythonReadHoles(size: number, segments: [number, Uint8Array][]): PyZip {
  const dir = mkdtempSync(join(tmpdir(), 'zipcheck-'));
  try {
    const file = join(dir, 'spec.json');
    writeFileSync(file, JSON.stringify({ size, segments: segments.map(([s, d]) => [s, Buffer.from(d).toString('base64')]) }));
    return run(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Junta pedazos en un solo buffer. */
export function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export function text(entry: PyEntry | undefined): string {
  return entry?.data ? Buffer.from(entry.data, 'base64').toString('utf8') : '';
}
