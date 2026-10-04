// Mide en un navegador de verdad (Chromium sin ventana) si el botón de comentar y el contador de comentarios del margen
// tapan el final del texto en el teléfono. Es la medida que `jsdom` no puede hacer (no calcula el diseño): la usa quien
// toque `--gutter`, el ancho del botón o la tipografía del contador, y confirma la cuenta de
// `src/ui/commentMarginLayout.test.ts` (que corre en la suite y avisa antes, calculando desde los valores del CSS).
//
// Uso (con el servidor de vite andando: `npx vite --port 5404 --strictPort`):
//   node scripts/medir-telefono.mjs [--url http://localhost:5404] [--json salida.json]
// Necesita `playwright-core` y un Chromium ya instalado (nada se descarga): `SD_PLAYWRIGHT_CORE` = carpeta de
// `node_modules` donde está `playwright-core` (si no está en este proyecto) y `SD_CHROMIUM` = el ejecutable (si no, el de
// la caché de Playwright de tu usuario). Sale con código 1 si algo tapa el texto o se sale de la pantalla.
import { createRequire } from 'node:module';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const base = arg('--url', 'http://localhost:5404').replace(/\/$/, '');
const jsonOut = arg('--json', '');
const shots = arg('--shots', '');
/** Tolerancia del redondeo del navegador, en px: más que eso encima del texto es una superposición. */
const TOL = 0.5;

/** `playwright-core`: el del proyecto si está; si no, la carpeta de `SD_PLAYWRIGHT_CORE`. */
function loadPlaywright() {
  const dirs = [process.cwd() + '/', process.env.SD_PLAYWRIGHT_CORE ? process.env.SD_PLAYWRIGHT_CORE.replace(/[\/]*$/, '/') : ''];
  for (const dir of dirs.filter(Boolean)) {
    try {
      return createRequire(dir + 'x.js')('playwright-core');
    } catch {
      /* siguiente */
    }
  }
  throw new Error('No encuentro playwright-core: poné SD_PLAYWRIGHT_CORE con la carpeta node_modules que lo tiene.');
}

/** El Chromium: `SD_CHROMIUM` o el más nuevo de la caché de Playwright del usuario. */
function findChromium() {
  if (process.env.SD_CHROMIUM) return process.env.SD_CHROMIUM;
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), 'AppData', 'Local', 'ms-playwright');
  if (!existsSync(cache)) throw new Error('No encuentro un Chromium: poné SD_CHROMIUM con su ejecutable.');
  const dirs = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse();
  for (const d of dirs) {
    for (const sub of ['chrome-headless-shell-win64/chrome-headless-shell.exe', 'chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-linux/headless_shell']) {
      const exe = join(cache, d, sub);
      if (existsSync(exe)) return exe;
    }
  }
  throw new Error('No encuentro un Chromium: poné SD_CHROMIUM con su ejecutable.');
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: findChromium(), headless: true });
const report = {};
const fails = [];

try {
for (const width of [360, 375, 390, 414]) {
  const ctx = await browser.newContext({ viewport: { width, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.route('**/*', (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/src/dev/medir-telefono.html`);
  await page.waitForFunction(() => window.__medir?.listo, null, { timeout: 90000 });
  await page.waitForFunction(() => document.querySelectorAll('.comment-count').length >= 3, null, { timeout: 30000 });
  // El botón de comentar aparece en el bloque sin comentarios al tocarlo.
  const sin = page.locator('[data-id="sin"] .bn-inline-content').first();
  await sin.scrollIntoViewIfNeeded();
  const box = await sin.boundingBox();
  await page.mouse.click(box.x + 40, box.y + 8);
  await page.waitForSelector('.comment-add', { timeout: 10000 });
  await page.evaluate(() => document.fonts.ready);

  const rows = await page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const out = [];
    for (const btn of document.querySelectorAll('.comment-count, .comment-add')) {
      const r = btn.getBoundingClientRect();
      // El bloque cuyo botón es éste: el contenido que empieza a su misma altura.
      const block = [...document.querySelectorAll('.bn-block-content')].find((c) => Math.abs(c.getBoundingClientRect().top - r.top) < 14);
      let textRight = null;
      if (block) {
        // Solo los nodos de texto (los rectángulos de las cajas llegan hasta el borde del margen aunque el texto no).
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        const rects = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(n);
          rects.push(...range.getClientRects());
        }
        const near = rects.filter((q) => q.width > 0 && q.bottom > r.top && q.top < r.bottom);
        if (near.length) textRight = Math.max(...near.map((q) => q.right));
      }
      out.push({
        kind: btn.classList.contains('comment-add') ? 'comentar' : 'contador ' + btn.textContent.trim(),
        left: r.left,
        right: r.right,
        width: r.width,
        height: r.height,
        textRight,
        numeroAncho: btn.querySelector('span')?.getBoundingClientRect().width ?? null,
        W,
      });
    }
    return { W, docW: document.documentElement.scrollWidth, rows: out };
  });
  report[width] = { ...rows, errors };
  if (errors.length) fails.push(`${width} px: errores de la página: ${errors.join(' | ')}`);
  if (rows.docW > rows.W + TOL) fails.push(`${width} px: la página se corre de costado (${rows.docW} > ${rows.W})`);
  if (rows.rows.length < 4) fails.push(`${width} px: faltan botones (${rows.rows.length} de 4)`);
  for (const r of rows.rows) {
    // Con signo: positivo = el botón tapa texto; negativo = el aire que queda entre los dos (el «solape»).
    r.superposicion = r.textRight === null ? null : r.textRight - r.left;
    r.afuera = Math.max(0, r.right - r.W);
    if (r.superposicion === null) fails.push(`${width} px, ${r.kind}: no encontré el texto de su bloque`);
    else if (r.superposicion > TOL) fails.push(`${width} px, ${r.kind}: tapa ${r.superposicion.toFixed(1)} px del final del texto`);
    if (r.afuera > TOL) fails.push(`${width} px, ${r.kind}: se sale ${r.afuera.toFixed(1)} px de la pantalla`);
  }
  if (shots) await page.screenshot({ path: join(shots, `telefono-${width}.png`) });
  await ctx.close();
}
} finally {
await browser.close();
}

if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 1));
for (const [w, v] of Object.entries(report)) {
  console.log(`${w} px (la página mide ${v.docW}):`);
  for (const r of v.rows) {
    console.log(`  ${r.kind.padEnd(14)} ancho ${r.width.toFixed(1)}  empieza en ${r.left.toFixed(1)}  texto termina en ${r.textRight?.toFixed(1)}  solape ${r.superposicion?.toFixed(1)}  número ${r.numeroAncho?.toFixed(1) ?? '-'}  afuera ${r.afuera.toFixed(1)}`);
  }
}
if (fails.length) {
  console.error('\nFALLA:\n- ' + fails.join('\n- '));
  process.exit(1);
}
console.log('\nOK: ningún botón tapa el texto ni se sale de la pantalla.');
