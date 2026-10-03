// Regenera el esquema del editor "publicado" que usan las pruebas (npm run esquema:publicado).
//
// Cuándo: al publicar una versión que cambia src/ui/editorSchema.ts, en la rama ya lista para ir a main (o en main
// justo después de publicar), con el árbol limpio de otros cambios. Lo que hace, en este orden:
//   1. src/ui/fixtures/editorSchemaMain.ts = el esquema de hoy (src/ui/editorSchema.ts) con sus imports de '../'.
//   2. NUEVO_SIN_PUBLICAR de src/ui/editorSchemaFixture.test.ts queda vacío (lo de la tanda ya es lo publicado).
//   3. src/ui/fixtures/editorSchemaMain.firma.ts = la firma del esquema de hoy, escrita por esa misma prueba con
//      FIRMA_ESCRIBIR=1 (así los atributos de la foto, la tarjeta de Drive y las filas de fotos, que el fixture toma de
//      los módulos de hoy, quedan fijos).
//   4. Corre la prueba sin FIRMA_ESCRIBIR para confirmar que quedó bien.
// Después se commitean los tres archivos juntos. No hace falta red ni git (solo lo usa para anotar el commit de origen).
//
// Una rama que cambia el esquema a propósito NO corre esto: anota sus diferencias en NUEVO_SIN_PUBLICAR (el error de la
// prueba muestra cada línea) y la regenera quien publica.
//
// En esta PC las pruebas van con Node 22: `npx -y node@22 scripts/esquema-publicado.mjs`.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const SCHEMA = 'src/ui/editorSchema.ts';
const FIXTURE = 'src/ui/fixtures/editorSchemaMain.ts';
const TEST = 'src/ui/editorSchemaFixture.test.ts';
const VITEST = 'node_modules/vitest/vitest.mjs';

function commit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

const source = readFileSync(SCHEMA, 'utf8').replace(/\r\n/g, '\n');
const header =
  `// Copia de src/ui/editorSchema.ts de la versión publicada${commit() ? ` (árbol de ${commit()})` : ''}. Las pruebas la usan para comprobar\n` +
  '// que lo nuevo degrada en la versión que hoy puede estar abierta en otro dispositivo. No se edita a mano: la escribe\n' +
  "// scripts/esquema-publicado.mjs (`npm run esquema:publicado`) y cambian solo los imports ('./x' pasa a '../x'). Los\n" +
  '// módulos que importa (driveCard, imageRowsEditor, inlinePhoto, shortcuts, cellThumbs, quietImage) son los de hoy, así que\n' +
  '// los atributos que vienen de ellos los fija la firma (fixtures/editorSchemaMain.firma.ts), no este archivo. Lo de versiones\n' +
  '// más viejas queda en editorSchemaAnterior.ts (v0.083 a v0.092, antes del salto de hoja) y editorSchemaSoloScript.ts\n' +
  '// (hasta v0.040, solo Script).\n\n';
writeFileSync(FIXTURE, header + source.replace(/from '\.\//g, "from '../"));

const test = readFileSync(TEST, 'utf8');
const emptied = test.replace(/const NUEVO_SIN_PUBLICAR: string\[\] = \[[\s\S]*?\n?\];/, 'const NUEVO_SIN_PUBLICAR: string[] = [];');
if (emptied === test && !/const NUEVO_SIN_PUBLICAR: string\[\] = \[\];/.test(test)) {
  console.error(`No encontré NUEVO_SIN_PUBLICAR en ${TEST}: vaciala a mano.`);
  process.exit(1);
}
writeFileSync(TEST, emptied);

const run = (env, quiet) => spawnSync(process.execPath, [VITEST, 'run', TEST], { stdio: quiet ? 'ignore' : 'inherit', env: { ...process.env, ...env } });
// La primera corrida escribe la firma (las otras pruebas del archivo pueden fallar: la firma vieja todavía está; no se muestra).
run({ FIRMA_ESCRIBIR: '1' }, true);
const check = run({ FIRMA_ESCRIBIR: '' });
if (check.status !== 0) {
  console.error('La prueba sigue fallando con el fixture y la firma nuevos: mirá el error de arriba.');
  process.exit(1);
}
console.log(`\nListo. Commiteá juntos: ${FIXTURE}, src/ui/fixtures/editorSchemaMain.firma.ts y ${TEST}.`);
