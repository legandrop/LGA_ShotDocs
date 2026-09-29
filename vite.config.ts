/// <reference types="vitest/config" />
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

export default defineConfig(({ mode }) => {
  const supabase = supabaseConfig(mode);
  return {
    define: {
      __SUPABASE_URL__: JSON.stringify(supabase.url),
      __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(supabase.key),
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
        manifest: {
          name: 'LGA Shot Docs',
          short_name: 'Shot Docs',
          description: 'Documentación de VFX: notas de preproducción y reportes de rodaje.',
          lang: 'es',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#f7f7f5',
          theme_color: '#f7f7f5',
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
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          navigateFallback: '/index.html',
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        },
      }),
    ],
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
