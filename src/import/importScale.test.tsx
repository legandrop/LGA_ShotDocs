// @vitest-environment jsdom
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { serialize } from 'node:v8';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ARCHIVE_COMMENTS_SCHEMA_VERSION } from '../sync/comments';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { folderSource } from '../export/zipReader';
import { importCoda, metaJournal, type CodaFolder, type ImportJournal } from './codaImport';
import { closeCommit, importWork, type ImportEnvelope } from './importCommit';
import { archiveJournal, importArchive, openArchive, type ArchiveJournal } from './shotdocsImport';

// Importar cuesta lo mismo por página, haya diez o cuarenta ya importadas. Se afirma contando trabajo (cuántas veces
// se revisa un plan, cuántas hubo que armar un documento para revisarlo, cuánto ocupa el registro guardado) y no con
// un reloj: una página terminada no se vuelve a mirar, así que nada de eso depende de las páginas anteriores.

beforeAll(() => {
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('File', NodeFile);
  window.matchMedia ??= ((media: string) => ({ matches: false, media, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })) as never;
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
});

const devices: Device[] = [];
afterEach(async () => {
  for (const d of devices.splice(0)) {
    d.offline.stop();
    await d.engine.stop();
    d.docs.dispose();
    await d.docs.flush();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
});
async function device() {
  const server = new FakeServer();
  server.enableMedia();
  const d = await makeDevice(server);
  devices.push(d);
  await d.engine.syncNow();
  server.online = false;
  return d;
}

/** Páginas con peso de verdad (25 renglones cada una): el plan de cada una ocupa varios KB. */
const BLOCKS = 25;
const line = (page: number, row: number) => `Página ${page}, renglón ${row}: ${'lorem ipsum dolor sit amet consectetur '.repeat(3)}`;

async function archiveOf(pages: number) {
  const ids = Array.from({ length: pages }, () => crypto.randomUUID());
  const files: Record<string, string> = {
    '_shotdocs/manifest.json': JSON.stringify({ format: 1, id: crypto.randomUUID(), title: 'Escala', pages: ids.map((id, order) => ({ id, parent: order % 5 ? ids[order - (order % 5)] : null, order, title: `Página ${order}`, json: `_shotdocs/pages/${order}.json`, complete: true })) }),
  };
  ids.forEach((id, i) => {
    files[`_shotdocs/pages/${i}.json`] = JSON.stringify({ id, blocks: Array.from({ length: BLOCKS }, (_, j) => ({ id: crypto.randomUUID(), type: 'paragraph', content: line(i, j) })) });
  });
  return openArchive(folderSource(Object.entries(files).map(([path, text]) => Object.assign(new NodeFile([text], path.split('/').pop()!), { webkitRelativePath: `R/${path}` }) as unknown as File)));
}
function folderOf(pages: number): CodaFolder {
  const files = new Map<string, string>();
  const list = Array.from({ length: pages }, (_, i) => ({ id: `p${i}`, name: `Página ${i}`, parentId: i % 5 ? `p${i - (i % 5)}` : null, order: i, contentType: 'canvas', file: `p${i}.html`, media: [] }));
  for (let i = 0; i < pages; i++) files.set(`pages/p${i}.html`, Array.from({ length: BLOCKS }, (_, j) => `<p>${line(i, j)}</p>`).join(''));
  return { manifest: { doc: { id: crypto.randomUUID(), name: 'Escala' }, pages: list }, has: (p) => files.has(p), paths: () => [...files.keys()], text: async (p) => files.get(p)!, file: async () => new Blob([]) as never, size: (p) => files.get(p)?.length ?? 0 };
}

interface Cost { checks: number; builds: number; bytes: number }

/** Importa `pages` páginas en un dispositivo limpio y devuelve el trabajo que llevó y lo que quedó guardado. */
async function cost(kind: 'archive' | 'coda', pages: number): Promise<Cost> {
  const d = await device();
  importWork.checks = 0;
  importWork.builds = 0;
  let stored: unknown;
  let journal: ArchiveJournal | ImportJournal;
  if (kind === 'archive') {
    const archive = await archiveOf(pages);
    const result = await importArchive(archive, { tree: d.tree, docs: d.docs, media: d.media, comments: d.comments, journal: archiveJournal(d.db), schemaVersion: ARCHIVE_COMMENTS_SCHEMA_VERSION });
    expect(result).toMatchObject({ pages, problems: [], resumable: false });
    stored = await d.db.get('meta', `shotdocsImport2:${archive.key}`);
    journal = (stored as ImportEnvelope<ArchiveJournal>).generations[(stored as ImportEnvelope<ArchiveJournal>).activeGenerationId].journal!;
  } else {
    const folder = folderOf(pages);
    const result = await importCoda(folder, { tree: d.tree, docs: d.docs, media: d.media, comments: d.comments, journal: metaJournal(d.db) });
    expect(result).toMatchObject({ pages, problems: [], resumable: false });
    stored = await d.db.get('meta', `codaImport2:${folder.manifest.doc.id}`);
    journal = (stored as ImportEnvelope<ImportJournal>).generations[(stored as ImportEnvelope<ImportJournal>).activeGenerationId].journal!;
  }
  const work = { ...importWork };
  // Todo entró: cada página está terminada, con su texto, y de su plan queda solo que se confirmó.
  const entries = Object.values(journal.pages);
  expect(entries).toHaveLength(pages);
  for (const entry of entries) expect(entry).toMatchObject({ done: true, commit: closeCommit() });
  const last = await d.docs.open(entries[pages - 1].pageId);
  expect(last.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain(`renglón ${BLOCKS - 1}`);
  d.docs.close(entries[pages - 1].pageId);
  return { ...work, bytes: serialize(stored).length };
}

describe('el costo de importar no depende de cuántas páginas ya entraron', () => {
  it.each(['archive', 'coda'] as const)('%s: de 10 a 40 páginas, el trabajo por página es el mismo y el registro guardado no crece con el contenido', async (kind) => {
    const ten = await cost(kind, 10);
    const forty = await cost(kind, 40);
    // Cuatro veces las páginas, cuatro veces el trabajo: ni una revisión más por las páginas que ya entraron.
    expect(forty.checks).toBe(4 * ten.checks);
    expect(forty.builds).toBe(4 * ten.builds);
    // Por página: unas pocas revisiones del plan (una por guardado mientras está abierto), y de esas solo las de
    // bytes nuevos arman un documento.
    expect(ten.checks).toBeLessThanOrEqual(12 * 10);
    expect(ten.builds).toBeLessThanOrEqual(3 * 10);
    // El registro guarda de cada página terminada solo su ficha: unos cientos de bytes, pese a los varios KB de su plan.
    expect((forty.bytes - ten.bytes) / 30).toBeLessThan(512);
    expect(forty.bytes).toBeLessThan(40 * 512);
  }, 120000);
});
