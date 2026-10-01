/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// La librería de las versiones publicadas para las pruebas *.published.test.ts: la arma
// src/test/publishedYProsemirror.ts (`PUBLISHED_ENTRY`, la misma ruta; una prueba lo comprueba).
const PUBLISHED_Y_PROSEMIRROR = fileURLToPath(
  new URL('./node_modules/.cache/lga-y-prosemirror-v0.052/src/y-prosemirror.js', import.meta.url),
).replace(/\\/g, '/');

// La app solo recibe la URL del proyecto y la clave pública. Se leen por nombre, sin exponer prefijos
// enteros, para que una clave secreta cargada en el mismo entorno nunca termine en el bundle.
function supabaseConfig(mode: string) {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '';
  const key = env.SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
  if (key.startsWith('sb_secret_') || /service_role/.test(decodeJwtPayload(key))) {
    throw new Error('SUPABASE_PUBLISHABLE_KEY tiene una clave secreta. Usá la clave pública.');
  }
  return { url, key };
}

function decodeJwtPayload(token: string): string {
  const part = token.split('.')[1];
  if (!part) return '';
  try {
    return Buffer.from(part, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

// El aviso de licencia de libheif (LGPL-3.0, Docs/Doc_Decisiones.md, D-21) al principio de los archivos que la
// llevan: el Worker que convierte las fotos HEIC y su respaldo en la página. `/*!`: el minificador lo conserva.
const LIBHEIF_BANNER =
  '/*! Includes libheif and libde265 (LGPL-3.0-or-later, (c) struktur AG, Dirk Farin and contributors) via libheif-js, ' +
  'unmodified. Source and license texts: /licenses/THIRD_PARTY_NOTICES.md */';

// El aviso de PDF.js (Apache-2.0) al principio de su parte (la vista previa de los PDF adjuntos); su Worker ya trae el
// suyo.
const PDFJS_BANNER = '/*! Includes PDF.js (Copyright Mozilla Foundation, Apache-2.0): https://github.com/mozilla/pdf.js */';

// La versión que se muestra en la app es la última entrada del changelog.
function appVersion(): string {
  try {
    const changelog = readFileSync(new URL('./Docs/Changelog.md', import.meta.url), 'utf8');
    return /^v(\d+\.\d+)/m.exec(changelog)?.[1] ?? '';
  } catch {
    return '';
  }
}

// y-prosemirror lleva arreglos propios (patches/y-prosemirror+1.3.7.patch, Docs/Doc_Colaboracion.md) que
// aplica `patch-package` al instalar (postinstall): la selección que se restaura, el texto vacío del párrafo
// vacío, el de los huecos alrededor de las fotos en línea y los huecos estables (un renglón con fotos nunca
// borra ni vuelve a crear un texto). Sin ellos, editar a la vez pierde texto (y sin los dos últimos, las fotos
// en línea se guardarían de otra forma): el build y las pruebas se niegan a correr (por ejemplo, si se instaló
// con --ignore-scripts o si se actualizó la librería y el parche no se volvió a hacer). Se miran los dos
// archivos de la librería: `src` (el que usan la app y las pruebas) y `dist/*.cjs` (stableGaps.test.ts
// comprueba que los dos escriben lo mismo), más `src/lib.js` (las posiciones, desde la marca del renglón) y
// `src/plugins/undo-plugin.js` (deshacer no borra la marca).
function assertYProsemirrorPatched(): void {
  const marks = [
    'LGA-SHOTDOCS-PATCH',
    'relativeItemDeleted',
    'sameSelectedNode',
    'pnode.isTextblock && c.length === 0',
    // La marca que lee el parche es la de `GAP_TEXT_SPEC` (src/ui/inlinePhoto.ts); una prueba lo compara.
    'n.type.spec.lgaGapText === true',
    'needsGapText(res[res.length - 1])',
    // Los huecos estables. El nombre del atributo de los textos es el mismo `GAP_TEXT_SPEC` (inlinePhoto.test.ts).
    "const STABLE_GAP_TEXT = 'lgaGapText'",
    'updateStableGapsChildren(y,',
    'isStableGapsBlock(yDomFragment, pNode)',
    'isStableGapsBlock(ytype, pnode)',
    '!stableGaps && nextytext',
    'if (hasGapTextChild(node))',
    // La marca del renglón (`STABLE_GAPS_MARKER` de src/ui/unknownContent.ts, el mismo nombre): sin ella, las
    // versiones anteriores abrirían un renglón al que le borraron todas las fotos (Docs/Doc_Colaboracion.md).
    "const STABLE_GAPS_MARKER = 'lgaStableGaps'",
    'if (isStableGapsMarker(type)) return',
    'if (!hasMarker) yel.insert(0,',
  ];
  const libMarks = ["if (t.nodeName !== 'lgaStableGaps')", "if (contentType.nodeName !== 'lgaStableGaps')"];
  // Deshacer nunca borra la marca del renglón (si no, deshacer la primera foto la sacaba).
  const undoMarks = ["item.content.type.nodeName === 'lgaStableGaps'", 'isStableGapsMarkerItem(item) ? false :'];
  const files: [string, string[]][] = [
    ['src/plugins/sync-plugin.js', marks],
    ['src/lib.js', libMarks],
    ['src/plugins/undo-plugin.js', undoMarks],
    ['dist/y-prosemirror.cjs', [...marks, ...libMarks, ...undoMarks]],
  ];
  for (const [file, wanted] of files) {
    let source = '';
    try {
      source = readFileSync(new URL(`./node_modules/y-prosemirror/${file}`, import.meta.url), 'utf8');
    } catch {
      // Sin el archivo tampoco se sabe si está el parche (la librería cambió de forma): se corta igual.
    }
    const missing = wanted.filter((mark) => !source.includes(mark));
    if (missing.length > 0) {
      throw new Error(
        `y-prosemirror sin el parche de la app (node_modules/y-prosemirror/${file}: falta ${missing.join(', ')}). ` +
          'Correr "npx patch-package" (o "npm install"). Ver Docs/Doc_Colaboracion.md.',
      );
    }
  }
}

export default defineConfig(({ mode }) => {
  assertYProsemirrorPatched();
  const supabase = supabaseConfig(mode);
  return {
    define: {
      __SUPABASE_URL__: JSON.stringify(supabase.url),
      __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(supabase.key),
      __APP_VERSION__: JSON.stringify(appVersion()),
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
        manifest: {
          // La identidad de la app instalada: la misma que tenía sin `id` (la dirección de inicio), explícita para
          // que cambiar `start_url` algún día no la convierta en otra app (Docs/Doc_Instalar.md).
          id: '/',
          name: 'LGA Shot Docs',
          short_name: 'Shot Docs',
          description: 'VFX documentation: pre-production notes and on-set reports.',
          lang: 'en',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#FBFAF8',
          theme_color: '#FBFAF8',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: '/icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // Todos los .js entran, también los que se cargan aparte (el editor, el carrete, los diálogos):
          // sin red, con la app instalada, el editor abre desde la caché. El más grande (el editor) pesa
          // alrededor de 1 MB, lejos del límite de abajo. Ojo: un archivo más grande que el límite queda
          // afuera de la caché y el build NO falla (workbox solo escribe una advertencia en la salida del
          // build); sin red, esa parte no abriría. Revisar que `dist/sw.js` liste todos los .js.
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // Menos el decodificador de fotos HEIC (Docs/Doc_Imagenes.md, "Fotos HEIC"): el Worker, la librería y
          // su `.wasm` (que tampoco entra por la extensión) pesan ~1,6 MB y solo hacen falta cuando alguien
          // agrega un HEIC. Se guardan en la caché `heic-decoder` la primera vez que se usan (abajo): desde ahí
          // la conversión anda sin red. Un HEIC agregado sin red en un dispositivo que nunca lo bajó se guarda
          // tal cual y se convierte antes de subirlo, cuando vuelve la red.
          // Lo mismo con pdf.js (Docs/Doc_Adjuntos.md, "Vista previa"): la librería (`pdfLib`, ~0,5 MB) y su Worker
          // (`.mjs`, ~1,3 MB, que tampoco entra por la extensión) solo hacen falta cuando alguien agrega un PDF; se
          // guardan en la caché `pdf-preview` la primera vez. Un PDF agregado sin red en un dispositivo que nunca
          // la bajó queda sin vista previa hasta que se lo vuelve a mostrar con red.
          globIgnores: ['**/heic.worker-*.js', '**/heicLib-*.js', '**/pdfLib-*.js'],
          runtimeCaching: [
            {
              urlPattern: /\/assets\/(?:heic\.worker|heicLib|libheif)-[^/]+\.(?:js|wasm)$/,
              handler: 'CacheFirst',
              options: { cacheName: 'heic-decoder', expiration: { maxEntries: 6 } },
            },
            {
              urlPattern: /\/assets\/(?:pdfLib-[^/]+\.js|pdf\.worker\.min-[^/]+\.mjs)$/,
              handler: 'CacheFirst',
              options: { cacheName: 'pdf-preview', expiration: { maxEntries: 4 } },
            },
            // Las fotos de la página de práctica (Docs/Doc_Tutorial.md, corrección 18): no van en la instalación; se
            // guardan la primera vez que se ven, así la práctica anda sin red después.
            {
              urlPattern: /\/tutorial\/[^/]+\.webp$/,
              handler: 'CacheFirst',
              options: { cacheName: 'tutorial-images', expiration: { maxEntries: 10 } },
            },
          ],
          navigateFallback: '/index.html',
          // Los avisos y los textos de las licencias (`public/licenses/`) son archivos, no pantallas de la app.
          navigateFallbackDenylist: [/^\/licenses\//],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        },
      }),
    ],
    build: {
      // El editor se baja aparte (roadmap B.4) y pesa alrededor de 1 MB sin comprimir (300 KB comprimido).
      chunkSizeWarningLimit: 1200,
      rolldownOptions: {
        output: {
          postBanner: (chunk: { name: string }) => (chunk.name === 'heicLib' ? LIBHEIF_BANNER : chunk.name === 'pdfLib' ? PDFJS_BANNER : ''),
        },
      },
    },
    worker: {
      rolldownOptions: { output: { postBanner: LIBHEIF_BANNER } },
    },
    test: {
      // 15 s por prueba (el de vitest es 5 s): las que montan el editor (38 archivos: buscar, la página, las fotos,
      // colapsar, editar a la vez…) tardan cerca de 5 s con la máquina cargada y fallaban por tiempo, cada vez en
      // otra (auditoría de las fotos en línea, ronda 3). Solas pasan siempre; lo que prueban no cambia.
      testTimeout: 15_000,
      projects: [
        {
          extends: true,
          test: {
            name: 'app',
            environment: 'node',
            include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'portero/src/**/*.test.ts', 'scripts/**/*.test.mjs'],
            exclude: ['**/node_modules/**', 'src/**/*.published.test.ts'],
          },
        },
        {
          // Versiones mezcladas con la librería de verdad de las versiones publicadas (src/test/
          // publishedYProsemirror.ts): en estas pruebas `y-prosemirror` es esa, también adentro de BlockNote
          // (por eso BlockNote pasa por Vite: `inline`). La de hoy se importa por su ruta.
          extends: true,
          resolve: { alias: [{ find: /^y-prosemirror$/, replacement: PUBLISHED_Y_PROSEMIRROR }] },
          test: {
            name: 'published',
            environment: 'node',
            include: ['src/**/*.published.test.ts'],
            globalSetup: ['src/test/publishedYProsemirror.setup.ts'],
            server: { deps: { inline: [/@blocknote\/core/] } },
          },
        },
      ],
    },
  };
});
