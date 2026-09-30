/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

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

// La versión que se muestra en la app es la última entrada del changelog.
function appVersion(): string {
  try {
    const changelog = readFileSync(new URL('./Docs/Changelog.md', import.meta.url), 'utf8');
    return /^v(\d+\.\d+)/m.exec(changelog)?.[1] ?? '';
  } catch {
    return '';
  }
}

// y-prosemirror lleva dos arreglos propios (patches/y-prosemirror+1.3.7.patch, Docs/Doc_Colaboracion.md) que
// aplica `patch-package` al instalar (postinstall). Sin ellos, editar a la vez pierde texto: el build y las
// pruebas se niegan a correr (por ejemplo, si se instaló con --ignore-scripts o si se actualizó la librería
// y el parche no se volvió a hacer).
function assertYProsemirrorPatched(): void {
  const files = ['src/plugins/sync-plugin.js', 'dist/y-prosemirror.cjs'];
  for (const file of files) {
    let source = '';
    try {
      source = readFileSync(new URL(`./node_modules/y-prosemirror/${file}`, import.meta.url), 'utf8');
    } catch {
      continue;
    }
    if ((source.match(/LGA-SHOTDOCS-PATCH/g) ?? []).length < 2) {
      throw new Error(
        `y-prosemirror sin el parche de la app (node_modules/y-prosemirror/${file}). Correr "npx patch-package" ` +
          '(o "npm install"). Ver Docs/Doc_Colaboracion.md.',
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
          navigateFallback: '/index.html',
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        },
      }),
    ],
    build: {
      // El editor se baja aparte (roadmap B.4) y pesa alrededor de 1 MB sin comprimir (300 KB comprimido).
      chunkSizeWarningLimit: 1200,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'portero/src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    },
  };
});
