import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import type { PageDocs } from '../sync/docs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import type { PageTree } from '../sync/tree';
import { editorSchemaOptions } from '../ui/editorSchema';
import type { PageSize } from '../ui/pageFormat';

// El proyecto de prueba de exportar (P.22, Docs/Doc_Exportar.md, entrega 0): un árbol de N páginas con lo que tiene
// un proyecto de rodaje de verdad (texto, Script, preguntas, saltos de hoja, tablas, fotos-bloque en filas, fotos en
// línea y en las celdas, páginas que son solo carpetas, alguna página muy larga) y hojas de cuatro tamaños. Lo usan
// las pruebas (export.test.tsx, con pocas páginas) y la medición en el navegador (bench/), con 300. Siempre el
// mismo proyecto para la misma semilla. Solo para probar: la app no lo importa.

export interface TestPhoto {
  url: string;
  name: string;
}

export interface TestPageSpec {
  /** La posición en el árbol, para encontrarla (`3`, `3.1`, `3.1.2`). */
  key: string;
  parent: string | null;
  title: string;
  /** El formato de hoja de la rama (va en las páginas de primer nivel, como lo fija un proyecto). */
  format?: { size: Exclude<PageSize, 'free'>; landscape: boolean };
  blocks: PartialBlock<any, any, any>[];
  /** Cuántas fotos usa (bloques y en línea). */
  photos: number;
}

export interface TestProjectOptions {
  pages: number;
  /** Fotos por página, en promedio (las páginas carpeta no tienen). */
  photosPerPage?: number;
  seed?: number;
}

/** Números al azar repetibles (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = (
  'plano toma lente cámara grúa dolly croma fondo verde marcas tracking luz difusa contraluz rebote negro bandera ' +
  'actor doble escena secuencia set decorado utilería maquillaje vestuario sonido claqueta foco diafragma obturador ' +
  'altura distancia sensor referencia gris esfera cromada HDRI medición nota pendiente revisar cliente director ' +
  'supervisor efectos composición rotoscopia limpieza cable plataforma lluvia humo fuego chispas viento noche día'
).split(' ');

const SCENES = ['INT. CASA DE ANA - NOCHE', 'EXT. RUTA 3 - DÍA', 'INT./EXT. AUTO - AMANECER', 'EXT. PUERTO - ATARDECER', 'INT. GALPÓN - DÍA'];

const text = (t: string) => ({ type: 'text', text: t, styles: {} });

/**
 * Las páginas del proyecto, en el orden del árbol. `photo(n)` da la foto número `n` (cada uso es una foto distinta,
 * como en un proyecto de verdad).
 */
export function testProject(options: TestProjectOptions, photo: (n: number) => TestPhoto): TestPageSpec[] {
  const rnd = random(options.seed ?? 22);
  const perPage = options.photosPerPage ?? 8;
  let photoCount = 0;
  const nextPhoto = () => photo(photoCount++);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rnd() * list.length)];
  const sentence = (min: number, max: number) => {
    const n = min + Math.floor(rnd() * (max - min + 1));
    const words = Array.from({ length: n }, () => pick(WORDS));
    const s = words.join(' ');
    return s[0].toUpperCase() + s.slice(1) + '.';
  };
  const paragraph = (sentences: number) => Array.from({ length: sentences }, () => sentence(6, 16)).join(' ');
  /** Una cantidad de fotos alrededor del promedio (de 0 a 2 veces). */
  const howMany = () => Math.round(rnd() * 2 * perPage);

  const imageBlock = (props: Record<string, unknown> = {}) => {
    const p = nextPhoto();
    return { type: 'image', props: { url: p.url, name: p.name, ...props } };
  };
  const inlinePhoto = (w: number) => {
    const p = nextPhoto();
    return { type: 'photo', props: { url: p.url, name: p.name, w } };
  };

  /** Una escena: Script, notas, una pregunta y fotos en línea en un renglón. */
  const scene = (photos: number): PartialBlock<any, any, any>[] => {
    const out: any[] = [
      { type: 'heading', props: { level: 2 }, content: 'Escena ' + (1 + Math.floor(rnd() * 120)) },
      { type: 'paragraph', props: { script: true }, content: pick(SCENES) },
      { type: 'paragraph', props: { script: true }, content: paragraph(2).toUpperCase() },
      { type: 'paragraph', content: paragraph(3) },
      { type: 'bulletListItem', content: sentence(4, 9) },
      { type: 'bulletListItem', content: sentence(4, 9) },
      { type: 'numberedListItem', content: sentence(4, 9) },
      { type: 'paragraph', props: { question: true }, content: '¿' + sentence(5, 10).slice(0, -1) + '?' },
    ];
    // Las fotos en renglones de a 3 o 4 (en línea), con texto entre medio.
    let left = photos;
    while (left > 0) {
      const n = Math.min(left, 3 + Math.floor(rnd() * 2));
      const content: unknown[] = [text('Ref. ')];
      for (let i = 0; i < n; i++) content.push(inlinePhoto(n >= 4 ? 0.24 : 0.32));
      out.push({ type: 'paragraph', content });
      out.push({ type: 'paragraph', content: paragraph(1) });
      left -= n;
    }
    return out;
  };

  /** Un reporte de rodaje: tabla de datos, tabla con fotos en las celdas, un salto de hoja y una fila de fotos. */
  const report = (photos: number): PartialBlock<any, any, any>[] => {
    const rows = 4 + Math.floor(rnd() * 8);
    const data = Array.from({ length: rows }, (_, r) => ({
      cells: [[text(`${r + 1}${pick(['A', 'B', 'C'])}`)], [text(pick(['24mm', '35mm', '50mm', '85mm']))], [text(sentence(3, 8))], [text(pick(['OK', 'NG', 'Rep.']))]],
    }));
    const inCells = Math.min(photos, 6);
    const photoRows: { cells: unknown[][] }[] = [];
    for (let i = 0; i < inCells; i += 2) {
      photoRows.push({ cells: [[text(`Toma ${i / 2 + 1}`)], [inlinePhoto(0)], i + 1 < inCells ? [inlinePhoto(0)] : [text('—')]] });
    }
    const out: any[] = [
      { type: 'heading', props: { level: 1 }, content: 'Reporte de rodaje' },
      { type: 'paragraph', content: paragraph(2) },
      { type: 'table', content: { type: 'tableContent', headerRows: 1, rows: [{ cells: [[text('Toma')], [text('Lente')], [text('Notas')], [text('Estado')]] }, ...data] } },
    ];
    if (photoRows.length > 0) {
      out.push({ type: 'paragraph', content: 'Fotos por toma' });
      out.push({ type: 'table', content: { type: 'tableContent', rows: photoRows } });
    }
    out.push({ type: 'paragraph', props: { pageBreak: true } });
    out.push({ type: 'heading', props: { level: 2 }, content: 'Fotos de set' });
    // Lo que queda, en filas de 2 o 3 fotos-bloque.
    let left = photos - inCells;
    while (left > 0) {
      const n = Math.min(left, 2 + Math.floor(rnd() * 2));
      for (let i = 0; i < n; i++) out.push(imageBlock({ rowWidth: n === 2 ? 0.5 : 0.3333 }));
      left -= n;
    }
    out.push({ type: 'paragraph', props: { question: true }, content: '¿Se repite la toma ' + (1 + Math.floor(rnd() * 9)) + '?' });
    return out;
  };

  /** Notas largas (una página de muchas hojas): texto, títulos y alguna foto con su ancho. */
  const notes = (photos: number, long: boolean): PartialBlock<any, any, any>[] => {
    const out: any[] = [];
    const sections = long ? 30 : 3 + Math.floor(rnd() * 4);
    let left = photos;
    for (let s = 0; s < sections; s++) {
      out.push({ type: 'heading', props: { level: 3 }, content: sentence(2, 5).slice(0, -1) });
      for (let k = 0; k < (long ? 5 : 2); k++) out.push({ type: 'paragraph', content: paragraph(long ? 6 : 3) });
      if (left > 0 && rnd() < 0.6) {
        out.push(imageBlock({ previewWidth: 240 + Math.floor(rnd() * 300) }));
        left--;
      }
      if (rnd() < 0.15) out.push({ type: 'paragraph', props: { pageBreak: true } });
    }
    while (left-- > 0) out.push(imageBlock());
    return out;
  };

  // El árbol: cinco ramas de primer nivel, cada una con su hoja, y adentro páginas y subpáginas.
  const formats: TestPageSpec['format'][] = [
    { size: 'A4', landscape: false },
    { size: 'A5', landscape: true },
    { size: 'Letter', landscape: false },
    { size: 'A3', landscape: true },
    { size: 'A4', landscape: false },
  ];
  const rootTitles = ['Preproducción', 'Rodaje · Semana 1', 'Rodaje · Semana 2', 'Desgloses', 'Entregas'];
  const total = Math.max(1, options.pages);
  const specs: TestPageSpec[] = [];
  const roots = Math.min(5, total);
  for (let r = 0; r < roots; r++) {
    specs.push({ key: String(r + 1), parent: null, title: rootTitles[r], format: formats[r], blocks: [], photos: 0 });
  }
  // Las demás, repartidas: hijas de una raíz, y de a ratos nietas de la última hija.
  const lastChild: string[] = Array(roots).fill('');
  const counts = new Map<string, number>();
  for (let i = roots; i < total; i++) {
    const r = (i - roots) % roots;
    const rootKey = String(r + 1);
    const nested = lastChild[r] !== '' && rnd() < 0.35;
    const parent = nested ? lastChild[r] : rootKey;
    const n = (counts.get(parent) ?? 0) + 1;
    counts.set(parent, n);
    const key = `${parent}.${n}`;
    const kind = i % 10;
    const photos = kind === 9 ? 0 : howMany();
    // Una de cada 10 es una carpeta (sin contenido); una de cada 25, una página muy larga.
    const blocks = kind === 9 ? [] : i % 25 === 7 ? notes(photos, true) : kind % 3 === 0 ? scene(photos) : kind % 3 === 1 ? report(photos) : notes(photos, false);
    const used = countPhotos(blocks);
    specs.push({ key, parent, title: kind === 9 ? `Carpeta ${i}` : `${pick(['Escena', 'Día', 'Plano', 'Notas', 'Reporte'])} ${i}`, blocks, photos: used });
    if (!nested) lastChild[r] = key;
  }
  // En el orden del árbol (cada página detrás de su madre y de sus hermanas anteriores, con sus hijas).
  return treeOrder(specs);
}

function countPhotos(blocks: unknown): number {
  let n = 0;
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as { type?: string; props?: { url?: string } };
      if ((o.type === 'image' || o.type === 'photo') && o.props?.url) n++;
      for (const value of Object.values(o)) if (value && typeof value === 'object') walk(value);
    }
  };
  walk(blocks);
  return n;
}

function treeOrder(specs: TestPageSpec[]): TestPageSpec[] {
  const children = new Map<string | null, TestPageSpec[]>();
  for (const s of specs) children.set(s.parent, [...(children.get(s.parent) ?? []), s]);
  const out: TestPageSpec[] = [];
  const walk = (parent: string | null) => {
    for (const s of children.get(parent) ?? []) {
      out.push(s);
      walk(s.key);
    }
  };
  walk(null);
  return out;
}

/**
 * Crea el proyecto en el árbol y escribe cada página con un editor atado a su documento (como la importación de Coda:
 * lo guardado es lo que guarda la app). Devuelve el proyecto y el id de cada página por su clave.
 */
export async function writeTestProject(
  target: { tree: PageTree; docs: PageDocs },
  name: string,
  specs: TestPageSpec[],
  onPage?: (done: number, total: number) => void,
): Promise<{ projectId: string; ids: Map<string, string> }> {
  const projectId = await target.tree.createProject(name);
  const ids = new Map<string, string>();
  for (const s of specs) {
    const id = await target.tree.create(s.parent ? ids.get(s.parent)! : null, s.title, projectId);
    ids.set(s.key, id);
    if (s.format) await target.tree.setSetting(id, 'format', s.format);
  }
  let done = 0;
  for (const s of specs) {
    if (s.blocks.length > 0) await writeBlocks(target.docs, ids.get(s.key)!, s.blocks);
    onPage?.(++done, specs.length);
  }
  return { projectId, ids };
}

/** Escribe los bloques en el documento de la página con un editor montado (y-prosemirror escribe desde la vista). */
export async function writeBlocks(docs: PageDocs, pageId: string, blocks: PartialBlock<any, any, any>[]): Promise<void> {
  const doc = await docs.open(pageId, { seed: true });
  const editor = BlockNoteEditor.create(
    withCollaboration({
      ...editorSchemaOptions,
      // Este editor no se ve: que no pida las direcciones de las fotos.
      resolveFileUrl: async () => 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'test', color: '#888888' } },
    }),
  ) as unknown as BlockNoteEditor<any, any, any>;
  const host = document.createElement('div');
  host.style.display = 'none';
  document.body.append(host);
  try {
    editor.mount(host);
    editor.replaceBlocks(editor.document, blocks as never);
    await docs.flush(pageId);
  } finally {
    editor.unmount();
    host.remove();
    docs.close(pageId);
  }
}
