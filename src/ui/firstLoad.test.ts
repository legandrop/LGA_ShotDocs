import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// La primera carga no trae el editor (roadmap B.4): desde la entrada de la app y desde lo que arma la
// primera pantalla, siguiendo solo los imports estáticos (los `import()` se bajan aparte), no se llega a
// BlockNote, ProseMirror, Tiptap ni Mantine, ni a las partes que se cargan aparte. Un import estático nuevo
// que los arrastre haría crecer la primera carga de unos 295 KB (JS 244 KB, CSS 49 KB, HTML 1 KB) a unos
// 600 KB (comprimido; medido en v0.041). Los textos de esas partes (`src/i18n/lazy/`) también viajan con ellas.

const SRC = resolve(__dirname, '..');

const HEAVY_PACKAGES = [/^@blocknote\//, /^@tiptap\//, /^@mantine\//, /^prosemirror-/, /^y-prosemirror/, /^@emoji-mart\//];
/** Lo que se baja aparte (lazyPart.tsx, lazyDialogs.ts) y lo que es solo del editor. */
const LAZY_FILES = [
  'ui/PageEditor.tsx',
  'ui/editorSchema.ts',
  'ui/EditorComments.tsx',
  'ui/driveCard.ts',
  'ui/drivePaste.ts',
  'ui/DrivePasteMenu.tsx',
  'ui/MediaToolbarButtons.tsx',
  'ui/Carrete.tsx',
  'ui/CommentsPanel.tsx',
  'ui/MembersDialog.tsx',
  'ui/ShareDialog.tsx',
  'ui/DriveDialog.tsx',
  // Hojas y PDF: bajan con el editor (y el menú de la página pide printPage aparte).
  'ui/SheetBreaks.tsx',
  'ui/printPage.ts',
  'ui/printView.ts',
  'ui/pagination.ts',
  // El selector de carpetas de Google, con el diálogo de Drive.
  'media/picker.ts',
  // Los textos de las partes que se bajan aparte (src/i18n/index.ts).
  'i18n/lazy/carrete.ts',
  'i18n/lazy/commentsPanel.ts',
  'i18n/lazy/drive.ts',
  'i18n/lazy/editor.ts',
  'i18n/lazy/teamDialogs.ts',
  'i18n/lazy/importCoda.ts',
  // Importar de Coda: el diálogo y la importación (la entrada del menú y `importJob.ts` sí van).
  'ui/ImportCodaDialog.tsx',
  'import/codaImport.ts',
  'import/codaHtml.ts',
  // Los pasos para instalar la app (el aviso, la entrada del menú y `install.ts` sí van).
  'ui/InstallDialog.tsx',
  'i18n/lazy/install.ts',
];

const IMPORT = /^\s*import\s+(type\s+)?(?:[\w$]+\s*,?\s*)?(?:\{[^}]*\}|\*\s+as\s+[\w$]+)?\s*from\s*['"]([^'"]+)['"]/gm;
const SIDE_EFFECT = /^\s*import\s*['"]([^'"]+)['"]/gm;
const REEXPORT = /^\s*export\s+(type\s+)?(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?)\s*from\s*['"]([^'"]+)['"]/gm;

/** Los módulos que un archivo importa de forma estática (sin `import type`, que no queda en el build). */
function staticImports(file: string): string[] {
  const code = readFileSync(file, 'utf8');
  const found: string[] = [];
  for (const m of code.matchAll(IMPORT)) if (!m[1]) found.push(m[2]);
  for (const m of code.matchAll(REEXPORT)) if (!m[1]) found.push(m[2]);
  for (const m of code.matchAll(SIDE_EFFECT)) found.push(m[1]);
  // Los estilos no cuentan: los del editor van a propósito con la primera carga (ver main.tsx).
  return found.filter((s) => !s.endsWith('.css'));
}

function resolveLocal(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && !candidate.endsWith('/') && readdirSafe(candidate) === null) return candidate;
  }
  return null;
}

function readdirSafe(path: string): string[] | null {
  try {
    return readdirSync(path);
  } catch {
    return null;
  }
}

/** Recorre los imports estáticos; devuelve cada archivo alcanzado con el camino que llega a él. */
function walk(entries: string[]): { files: Map<string, string[]>; packages: Map<string, string[]> } {
  const files = new Map<string, string[]>();
  const packages = new Map<string, string[]>();
  const queue = entries.map((f) => ({ file: f, path: [relative(SRC, f)] }));
  while (queue.length > 0) {
    const { file, path } = queue.shift()!;
    if (files.has(file)) continue;
    files.set(file, path);
    for (const spec of staticImports(file)) {
      if (spec.startsWith('.')) {
        const target = resolveLocal(file, spec);
        if (target && !files.has(target)) queue.push({ file: target, path: [...path, relative(SRC, target)] });
      } else if (!packages.has(spec)) {
        packages.set(spec, [...path, spec]);
      }
    }
  }
  return { files, packages };
}

const syncFiles = readdirSync(join(SRC, 'sync'))
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== 'testing.ts')
  .map((f) => join(SRC, 'sync', f));

describe('la primera carga no trae el editor', () => {
  const entries = [
    'main.tsx',
    'services.ts',
    'ui/App.tsx',
    'ui/Workspace.tsx',
    'ui/Sidebar.tsx',
  ].map((f) => join(SRC, f));
  const { files, packages } = walk([...entries, ...syncFiles]);

  it('lee los imports de verdad (llega a React, Supabase, Yjs y a la barra lateral)', () => {
    expect(packages.has('react')).toBe(true);
    expect(packages.has('@supabase/supabase-js')).toBe(true);
    expect(packages.has('yjs')).toBe(true);
    expect(files.has(join(SRC, 'ui/Sidebar.tsx'))).toBe(true);
    expect(files.has(join(SRC, 'ui/PageView.tsx'))).toBe(true);
    // El que controla el recorrido: PageEditor.tsx sí importa el editor.
    expect(walk([join(SRC, 'ui/PageEditor.tsx')]).packages.has('@blocknote/react')).toBe(true);
  });

  it('ninguna biblioteca del editor', () => {
    const heavy = [...packages].filter(([spec]) => HEAVY_PACKAGES.some((re) => re.test(spec)));
    expect(heavy.map(([, path]) => path.join(' → '))).toEqual([]);
  });

  it('ninguna de las partes que se bajan aparte', () => {
    const lazy = LAZY_FILES.map((f) => join(SRC, f)).filter((f) => files.has(f));
    expect(lazy.map((f) => files.get(f)!.join(' → '))).toEqual([]);
  });
});
