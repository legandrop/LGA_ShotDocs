// La librería y-prosemirror tal como la tienen las versiones PUBLICADAS de la app de la v0.052 a la v0.075
// (antes de los huecos estables): y-prosemirror 1.3.7 con el parche de entonces
// (`fixtures/y-prosemirror-v0.052.patch`, la parte de `src/plugins/sync-plugin.js`; el parche no cambió entre
// esas versiones). Sirve para probar versiones mezcladas con la librería de verdad de esas versiones, no con el
// esquema viejo sobre la librería nueva (*.published.test.ts, Docs/Doc_Colaboracion.md, "Versiones viejas").
//
// Se arma sin red y sin git: se copia `node_modules/y-prosemirror` (con su `lib0` propio) a
// `node_modules/.cache/`, se le saca el parche de hoy (patches/, al revés) y se le pone el de entonces. Las
// huellas de abajo comprueban que lo que sale es exactamente la 1.3.7 original y la librería publicada.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SYNC_PLUGIN = 'src/plugins/sync-plugin.js';
const inPatch = (file: string) => `node_modules/y-prosemirror/${file}`;

/** Dónde queda la librería publicada (fuera del repo: `node_modules` no se versiona). */
export const PUBLISHED_DIR = path.join(ROOT, 'node_modules/.cache/lga-y-prosemirror-v0.052');
/** El archivo de entrada que reemplaza a `y-prosemirror` en las pruebas *.published.test.ts (alias de Vite). */
export const PUBLISHED_ENTRY = path.join(PUBLISHED_DIR, 'src/y-prosemirror.js').replace(/\\/g, '/');

// sha256 de `src/plugins/sync-plugin.js`: el de `npm pack y-prosemirror@1.3.7` y el de la app publicada.
const SHA_ORIGINAL = '2525b13d7b9cae04e8e81fc59674493dddb5017b68f3097a76994ea65ff264f8';
/** Los archivos que el parche de entonces no tocaba (el de hoy sí): vuelven a la 1.3.7 original, con su sha256. */
const ORIGINAL_FILES: Record<string, string> = {
  'src/lib.js': 'cc2940350b9236c531d3a6fa22d788ceec8cb65fa4c415b1c10544718ceebe55',
  'src/plugins/undo-plugin.js': '09e33654e102716ec1bcd507fd00a7a6eff756b7f38252ebd438ea1d29bb60d7',
};
export const SHA_PUBLISHED = 'bb6940b405ed8ecf0dae9e62204891860f29f90812a24e26abf3862547546e98';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

interface Hunk {
  oldStart: number;
  newStart: number;
  lines: string[];
}

/** Los cambios de un archivo en un diff unificado (el de patch-package). */
function hunksOf(patch: string, file: string): Hunk[] {
  const lines = patch.split('\n');
  const hunks: Hunk[] = [];
  let inFile = false;
  let hunk: Hunk | null = null;
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      inFile = line.includes(` b/${file}`);
      hunk = null;
      continue;
    }
    if (!inFile) continue;
    const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (head) {
      hunk = { oldStart: Number(head[1]), newStart: Number(head[2]), lines: [] };
      hunks.push(hunk);
    } else if (hunk && /^[ +-]/.test(line)) {
      hunk.lines.push(line);
    } else if (hunk && line.startsWith('\\')) {
      // "\ No newline at end of file": el archivo de la librería termina con salto; no se usa.
    } else {
      hunk = null;
    }
  }
  if (hunks.length === 0) throw new Error(`El parche no tiene cambios para ${file}`);
  return hunks;
}

/**
 * Aplica (o deshace, con `reverse`) los cambios de `file` del parche sobre `source`. Exige que cada línea de
 * contexto y cada línea a sacar estén donde dice el parche: si no, corta (nunca aplica a medias).
 */
export function applyPatch(source: string, patch: string, file: string, reverse = false): string {
  const out = source.split('\n');
  const hunks = hunksOf(patch, file);
  // De abajo hacia arriba: así los números de línea de los cambios de arriba siguen valiendo.
  for (const h of [...hunks].reverse()) {
    const from = h.lines.filter((l) => l[0] === ' ' || l[0] === (reverse ? '+' : '-')).map((l) => l.slice(1));
    const to = h.lines.filter((l) => l[0] === ' ' || l[0] === (reverse ? '-' : '+')).map((l) => l.slice(1));
    const start = (reverse ? h.newStart : h.oldStart) - 1;
    for (let i = 0; i < from.length; i++) {
      if (out[start + i] !== from[i]) {
        throw new Error(`El parche no entra en ${file}, línea ${start + i + 1}: se esperaba ${JSON.stringify(from[i])}`);
      }
    }
    out.splice(start, from.length, ...to);
  }
  return out.join('\n');
}

/** Arma la librería publicada (si ya está y coincide, no hace nada). Devuelve el archivo de entrada. */
export function buildPublishedYProsemirror(): string {
  const target = path.join(PUBLISHED_DIR, SYNC_PLUGIN);
  const same = (file: string, sha: string) => {
    const at = path.join(PUBLISHED_DIR, file);
    return existsSync(at) && sha256(readFileSync(at, 'utf8')) === sha;
  };
  if (same(SYNC_PLUGIN, SHA_PUBLISHED) && Object.entries(ORIGINAL_FILES).every(([file, sha]) => same(file, sha))) return PUBLISHED_ENTRY;
  const todayPatch = readFileSync(path.join(ROOT, 'patches/y-prosemirror+1.3.7.patch'), 'utf8');
  const unpatch = (file: string) => {
    const today = readFileSync(path.join(ROOT, inPatch(file)), 'utf8');
    return todayPatch.includes(` b/${inPatch(file)}`) ? applyPatch(today, todayPatch, inPatch(file), true) : today;
  };
  const original = unpatch(SYNC_PLUGIN);
  const others = Object.keys(ORIGINAL_FILES).map((file) => [file, unpatch(file)] as const);
  if (sha256(original) !== SHA_ORIGINAL || others.some(([file, text]) => sha256(text) !== ORIGINAL_FILES[file])) {
    throw new Error('Sacando el parche de hoy no quedó y-prosemirror 1.3.7 original: ¿cambió la librería o el parche?');
  }
  const publishedPatch = readFileSync(path.join(ROOT, 'src/test/fixtures/y-prosemirror-v0.052.patch'), 'utf8');
  const published = applyPatch(original, publishedPatch, inPatch(SYNC_PLUGIN));
  if (sha256(published) !== SHA_PUBLISHED) throw new Error('La librería armada no es la de las versiones publicadas');
  rmSync(PUBLISHED_DIR, { recursive: true, force: true });
  mkdirSync(PUBLISHED_DIR, { recursive: true });
  cpSync(path.join(ROOT, 'node_modules/y-prosemirror'), PUBLISHED_DIR, { recursive: true, dereference: true });
  writeFileSync(target, published, 'utf8');
  for (const [file, text] of others) writeFileSync(path.join(PUBLISHED_DIR, file), text, 'utf8');
  return PUBLISHED_ENTRY;
}
