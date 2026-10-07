// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { translate, type Key } from '../i18n';
import { ARCHIVE_COMMENTS_SCHEMA_VERSION } from '../sync/comments';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { folderSource } from '../export/zipReader';
import { findResumable, importCoda, metaJournal, type CodaFolder, type ImportDeps, type ImportJournal } from './codaImport';
import { ImportPending, KEPT_CLOSED, type GenerationStore, type ImportEnvelope, type RecoveryJournal } from './importCommit';
import { activeJournal, hookableJournal } from './importTesting';
import { archiveJournal, importArchive, openArchive, type ArchiveImportDeps } from './shotdocsImport';

// La identidad de cada página y de cada archivo se anota en el registro antes de crearlos, como la del proyecto: un
// corte entre anotar y crear (o entre crear y volver) no deja una página ni un archivo que el registro no conoce. Y lo
// que cuelga de eso: la página pendiente que se reemplaza, la carpeta que se volvió a exportar sin una página y la
// poda de las importaciones terminadas. Cada caso se arma por su recorrido, con la base local de verdad.

const en = (key: Key, params?: Record<string, string | number>) => translate('en', key, params);

const devices: Device[] = [];
beforeAll(() => {
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('File', NodeFile);
  window.matchMedia ??= ((media: string) => ({ matches: false, media, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })) as never;
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of devices.splice(0)) {
    d.offline.stop();
    await d.engine.stop();
    d.docs.dispose();
    await d.docs.flush();
    d.media.dispose();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
});

async function device() {
  const server = new FakeServer();
  server.enableMedia();
  server.enableImportedComments();
  server.settings!.schemaVersion = ARCHIVE_COMMENTS_SCHEMA_VERSION;
  const d = await makeDevice(server);
  devices.push(d);
  await d.engine.syncNow();
  server.online = false;
  expect(d.media.enabled).toBe(true);
  return d;
}

type Kind = 'coda' | 'archive';
const kinds: Kind[] = ['coda', 'archive'];
type Tree = ArchiveImportDeps['tree'];
type Over = { tree?: Tree; media?: ImportDeps['media']; docs?: ImportDeps['docs']; journal?: unknown };
interface Outcome { projectId: string; pages: number; files: number; problems: string[]; resumable: boolean }

/** Una fuente con dos páginas, A (un texto y una foto) y B (un texto), para las dos importaciones. */
interface Source {
  key: string;
  ids: { a: string; b: string };
  store(d: Device): GenerationStore<RecoveryJournal>;
  run(d: Device, over?: Over, options?: Parameters<typeof importCoda>[2]): Promise<Outcome>;
}

function codaSource() {
  const docId = crypto.randomUUID();
  const blob = 'https://codahosted.io/docs/DOC/blobs/bl-pic/abc';
  const image = `<span style="display: inline-block"><img data-coda-blob-id="bl-pic" data-coda-mime-type="image/png" src="${blob}" width="100"></span>`;
  const files = new Map<string, string | Uint8Array>([
    ['pages/a.html', `<p>TEXTO_A</p>${image}`],
    ['pages/b.html', '<p>TEXTO_B</p>'],
    ['media/bl-pic.png', new Uint8Array(1000).fill(1)],
  ]);
  /** La carpeta como la deja `coda-export` con esas páginas (volver a exportar sin una: sin su id). */
  const folder = (ids: string[] = ['a', 'b']): CodaFolder => ({
    manifest: {
      doc: { id: docId, name: 'Doc' },
      pages: ids.map((id, order) => ({ id, name: id.toUpperCase(), parentId: null, order, contentType: 'canvas', file: `${id}.html`, media: id === 'a' ? [{ url: blob, file: 'bl-pic.png' }] : [] })),
    },
    has: (p) => files.has(p),
    paths: () => [...files.keys()],
    text: async (p) => files.get(p) as string,
    file: async (p) => new Blob([files.get(p) as Uint8Array<ArrayBuffer>], { type: 'image/png' }),
    size: (p) => files.get(p)?.length ?? 0,
  });
  const deps = (d: Device, over: Over = {}): ImportDeps => ({ tree: d.tree, docs: d.docs, media: d.media, comments: d.comments, journal: metaJournal(d.db), ...(over as Partial<ImportDeps>) });
  const source: Source = {
    key: docId,
    ids: { a: 'a', b: 'b' },
    store: (d) => metaJournal(d.db) as unknown as GenerationStore<RecoveryJournal>,
    run: (d, over, options) => importCoda(folder(), deps(d, over), options),
  };
  return { ...source, docId, folder, deps };
}

async function archiveSource(): Promise<Source> {
  const a = crypto.randomUUID(), b = crypto.randomUUID(), fileId = crypto.randomUUID();
  const entry = (id: string, order: number, title: string) => ({ id, parent: null, order, title, json: `_shotdocs/pages/${order}.json`, complete: true });
  const files: Record<string, string> = {
    '_shotdocs/manifest.json': JSON.stringify({
      format: 1, id: crypto.randomUUID(), title: 'Archivo', pages: [entry(a, 0, 'A'), entry(b, 1, 'B')],
      files: [{ id: fileId, name: 'foto.png', mime: 'image/png', kind: 'image', size: 600, original: 'files/foto.png', view: null }],
    }),
    '_shotdocs/pages/0.json': JSON.stringify({ id: a, blocks: [{ id: 'texto-a', type: 'paragraph', content: 'TEXTO_A' }, { id: 'foto', type: 'image', props: { url: `sdmedia://${fileId}`, name: 'foto.png' } }] }),
    '_shotdocs/pages/1.json': JSON.stringify({ id: b, blocks: [{ id: 'texto-b', type: 'paragraph', content: 'TEXTO_B' }] }),
    'files/foto.png': 'P'.repeat(600),
  };
  const archive = await openArchive(folderSource(Object.entries(files).map(([path, text]) => Object.assign(new NodeFile([text], path.split('/').pop()!), { webkitRelativePath: `R/${path}` }) as unknown as File)));
  const deps = (d: Device, over: Over = {}): ArchiveImportDeps => ({
    tree: d.tree, docs: d.docs, media: d.media, comments: d.comments, journal: archiveJournal(d.db), userEmail: d.remote.email ?? undefined, schemaVersion: ARCHIVE_COMMENTS_SCHEMA_VERSION,
    ...(over as Partial<ArchiveImportDeps>),
  });
  return {
    key: archive.key,
    ids: { a, b },
    store: (d) => archiveJournal(d.db) as unknown as GenerationStore<RecoveryJournal>,
    run: (d, over, options) => importArchive(archive, deps(d, over), options),
  };
}

const sourceOf = async (kind: Kind): Promise<Source> => (kind === 'coda' ? codaSource() : archiveSource());

/** El árbol de verdad, con lo que la prueba le cambie. */
const treeOf = (d: Device, over: Partial<Tree>): Tree => ({
  create: d.tree.create.bind(d.tree), createProject: d.tree.createProject.bind(d.tree), project: d.tree.project.bind(d.tree), get: d.tree.get.bind(d.tree),
  isTrashed: d.tree.isTrashed.bind(d.tree), setPatch: d.tree.setPatch.bind(d.tree), dropFresh: d.tree.dropFresh.bind(d.tree), ...over,
});
/** Un corte al abrir cada página para escribirla: las páginas quedan creadas y anotadas, sin terminar. */
const cutDocs = (d: Device): ImportDeps['docs'] => ({
  open: async () => { throw new Error('se cerró la app'); }, close: d.docs.close.bind(d.docs), flush: d.docs.flush.bind(d.docs), isSaved: d.docs.isSaved.bind(d.docs),
});
/** Las páginas del proyecto que están a la vista (sin las de la papelera), por título. */
const liveTitles = (d: Device, projectId: string) => d.tree.roots(projectId).filter((p) => !d.tree.isTrashed(p.id)).map((p) => p.title).sort();
const envelopeOf = async (d: Device, s: Source) => (await s.store(d).loadState(s.key)).raw as ImportEnvelope<RecoveryJournal>;

describe('cada página y cada archivo se anotan en el registro antes de crearse', () => {
  it('crear una página o guardar un archivo dos veces con el mismo id reservado es hacerlo una sola vez', async () => {
    const d = await device();
    const project = await d.tree.createProject('Uno'), other = await d.tree.createProject('Otro');
    const id = crypto.randomUUID();
    expect(await d.tree.create(null, 'Página', project, { id })).toBe(id);
    const queued = d.tree.pendingOps().length;
    expect(await d.tree.create(null, 'Página', project, { id })).toBe(id);
    expect(d.tree.pendingOps()).toHaveLength(queued);
    expect(d.tree.roots(project).map((p) => p.id)).toEqual([id]);
    // Un id reservado nunca toma una página de otro proyecto, y uno que no es un id se rechaza sin crear nada.
    await expect(d.tree.create(null, 'Ajena', other, { id })).rejects.toMatchObject({ reason: 'changed' });
    await expect(d.tree.create(null, 'Mal', project, { id: 'no-es-un-id' })).rejects.toMatchObject({ reason: 'invalid' });
    expect(d.tree.roots(other)).toHaveLength(0);
    expect(d.tree.roots(project)).toHaveLength(1);

    const fileId = crypto.randomUUID();
    const file = () => new File([new Uint8Array(500).fill(7)], 'foto.png', { type: 'image/png' });
    const url = await d.media.add(id, file(), { id: fileId });
    expect(url).toBe(`sdmedia://${fileId}`);
    const createdAt = (await d.mediaDb.get('files', fileId))!.createdAt;
    expect(await d.media.add(id, file(), { id: fileId })).toBe(url);
    expect((await d.mediaDb.getAll('files')).map((r) => [r.id, r.createdAt])).toEqual([[fileId, createdAt]]);
    await expect(d.media.add(id, file(), { id: 'no-es-un-id' })).rejects.toMatchObject({ reason: 'invalid' });
    expect(await d.mediaDb.getAll('files')).toHaveLength(1);
  });

  const moments = ['antes de crearla', 'después de crearla'] as const;
  it.each(kinds.flatMap((kind) => moments.map((moment) => [kind, moment] as const)))(
    '%s: con un corte %s (ya anotada), al seguir hay una sola página por cada una de la fuente, con el id que se anotó',
    async (kind, moment) => {
      const d = await device(), s = await sourceOf(kind);
      const real = d.tree.create.bind(d.tree);
      const asked: (string | undefined)[] = [];
      const tree = treeOf(d, {
        create: async (...args) => {
          asked.push(args[3]?.id);
          // Solo la primera llega a crearse; de ahí en más, la app está cerrada.
          if (asked.length === 1 && moment === 'después de crearla') await real(...args);
          throw new Error('se cerró la app');
        },
      });
      const first = await s.run(d, { tree });
      expect(first.resumable).toBe(true);
      const noted = (await activeJournal(s.store(d), s.key))!;
      // Lo que se pidió crear es lo que el registro ya tenía anotado.
      expect(asked[0]).toBe(noted.pages[s.ids.a].pageId);
      expect(!!d.tree.get(noted.pages[s.ids.a].pageId)).toBe(moment === 'después de crearla');

      const second = await s.run(d, {}, { resume: true });
      expect(second).toMatchObject({ resumable: false, pages: 2 });
      expect(liveTitles(d, second.projectId)).toEqual(['A', 'B']);
      expect(d.tree.trashed(second.projectId)).toHaveLength(0);
      const done = (await activeJournal(s.store(d), s.key))!;
      expect(d.tree.roots(second.projectId).map((p) => p.id).sort()).toEqual([done.pages[s.ids.a].pageId, done.pages[s.ids.b].pageId].sort());
      // La página A no cambió de identidad por el corte.
      expect(done.pages[s.ids.a].pageId).toBe(asked[0]);
    },
  );

  it.each(kinds)('%s: con un corte entre guardar un archivo y anotarlo, al seguir ese archivo queda una sola vez en el dispositivo', async (kind) => {
    const d = await device(), s = await sourceOf(kind);
    const asked: (string | undefined)[] = [];
    const media = {
      get enabled() { return d.media.enabled; },
      add: async (...args: Parameters<typeof d.media.add>) => {
        asked.push(args[2]?.id);
        const url = await d.media.add(...args);
        // La primera vez el archivo queda guardado y la app se cierra antes de anotarlo.
        if (asked.length === 1) throw new Error('se cerró la app');
        return url;
      },
    };
    const first = await s.run(d, { media });
    expect(first.resumable).toBe(true);
    expect(await d.mediaDb.getAll('files')).toHaveLength(1);

    const second = await s.run(d, { media }, { resume: true });
    expect(second).toMatchObject({ resumable: false, pages: 2, files: 1 });
    const stored = await d.mediaDb.getAll('files');
    expect(stored).toHaveLength(1);
    expect(asked).toEqual([stored[0].id, stored[0].id]);
    const done = (await activeJournal(s.store(d), s.key))!;
    const doc = await d.docs.open(done.pages[s.ids.a].pageId);
    const xml = doc.getXmlFragment(CONTENT_FRAGMENT).toString();
    d.docs.close(done.pages[s.ids.a].pageId);
    expect(xml).toContain(`sdmedia://${stored[0].id}`);
    expect(xml.match(/sdmedia:\/\//g)).toHaveLength(1);
    // Anotado el archivo, su reserva no queda dando vueltas.
    expect(done.reserved ?? {}).toEqual({});
  });

  it.each(kinds)('%s: una página pendiente que se mandó a la papelera, y el registro que no se puede guardar justo al reemplazarla: queda una sola página nueva', async (kind) => {
    const d = await device(), s = await sourceOf(kind);
    const first = await s.run(d, { docs: cutDocs(d) });
    expect(first.resumable).toBe(true);
    const old = (await activeJournal(s.store(d), s.key))!.pages[s.ids.a].pageId;
    await d.tree.trash(old);

    const base = hookableJournal(s.store(d));
    let failed = 0;
    const journal = {
      ...base,
      put: async (next: RecoveryJournal) => {
        // Falla una vez el guardado que anota la página que reemplaza a la de la papelera.
        if (!failed && next.pages[s.ids.a]?.pageId !== old) {
          failed++;
          throw new Error('el registro no se pudo guardar');
        }
        await base.put(next);
      },
    };
    const second = await s.run(d, { journal }, { resume: true });
    expect(failed).toBe(1);
    expect(second).toMatchObject({ resumable: false, pages: 2 });
    expect(liveTitles(d, second.projectId)).toEqual(['A', 'B']);
    // En la papelera sigue solo la que mandó la persona.
    expect(d.tree.trashed(second.projectId).map((p) => p.id)).toEqual([old]);
    const done = (await activeJournal(s.store(d), s.key))!;
    expect(done.pages[s.ids.a].pageId).not.toBe(old);
    expect(d.tree.isTrashed(done.pages[s.ids.a].pageId)).toBe(false);
  });
});

describe('una página recién anotada y creada, sin nada escrito, que la persona mandó a la papelera', () => {
  it.each(kinds)('%s: al seguir se crea otra con un id nuevo y lo importado entra ahí; en la de la papelera no se escribe nada', async (kind) => {
    const d = await device(), s = await sourceOf(kind);
    // Se corta apenas creadas las páginas: en el registro, de cada una, solo su id.
    await expect(s.run(d, {}, { onProgress: () => { throw new Error('se cerró la app'); } })).rejects.toThrow('se cerró la app');
    const cut = (await activeJournal(s.store(d), s.key))!;
    expect(cut.pages[s.ids.a]).toEqual({ pageId: cut.pages[s.ids.a].pageId });
    const old = cut.pages[s.ids.a].pageId;
    expect(d.tree.get(old)).toBeTruthy();
    await d.tree.trash(old);

    const second = await s.run(d, {}, { resume: true });
    expect(second).toMatchObject({ resumable: false, pages: 2, files: 1 });
    const done = (await activeJournal(s.store(d), s.key))!;
    const fresh = done.pages[s.ids.a].pageId;
    expect(fresh).not.toBe(old);
    expect(d.tree.isTrashed(fresh)).toBe(false);
    expect(liveTitles(d, second.projectId)).toEqual(['A', 'B']);
    expect(d.tree.trashed(second.projectId).map((p) => p.id)).toEqual([old]);
    const textOf = async (pageId: string) => {
      const doc = await d.docs.open(pageId);
      const xml = doc.getXmlFragment(CONTENT_FRAGMENT).toString();
      d.docs.close(pageId);
      return xml;
    };
    expect(await textOf(fresh)).toContain('TEXTO_A');
    const trashed = await textOf(old);
    expect(trashed).not.toContain('TEXTO_A');
    expect(trashed).not.toContain('sdmedia://');
  });
});

describe('una carpeta de Coda vuelta a exportar sin una página entre el corte y Resume', () => {
  it('la importación termina: la página que ya no está queda en el proyecto, anotada en la lista del final, y volver a importar entra a un proyecto nuevo', async () => {
    const d = await device(), s = codaSource(), store = metaJournal(d.db);
    await expect(
      importCoda(s.folder(), s.deps(d), { onProgress: (p) => { if (p.page === 'B') throw new Error('se cerró la app'); } }),
    ).rejects.toThrow('se cerró la app');
    const cut = (await activeJournal(store, s.docId))!;
    expect(cut.pages.a.done).toBe(true);
    expect(cut.pages.b.done).toBeUndefined();

    // La carpeta, exportada de nuevo sin B.
    const again = s.folder(['a']);
    expect(await findResumable(again, { tree: d.tree, journal: store })).toMatchObject({ done: 1, total: 1 });
    const resumed = await importCoda(again, s.deps(d), { resume: true });
    expect(resumed).toMatchObject({ resumable: false, pages: 1 });
    expect(resumed.problems).toEqual([`B: ${en('import.goneFromFolder')}`]);
    expect(en('import.goneFromFolder')).toContain('as the interrupted import left it');
    // Nada de lo ya importado se borra: B sigue en el proyecto y en el registro.
    expect(liveTitles(d, resumed.projectId)).toEqual(['A', 'B']);
    expect(d.tree.trashed(resumed.projectId)).toHaveLength(0);
    const closed = (await envelopeOf(d, s)) as unknown as ImportEnvelope<ImportJournal>;
    expect(closed.generations[closed.activeGenerationId]).toMatchObject({ phase: 'complete', journal: { pages: { a: { done: true }, b: { pageId: cut.pages.b.pageId } } } });
    // Terminada: ya no se ofrece seguir, y elegir la carpeta otra vez importa a otro proyecto.
    expect(await findResumable(again, { tree: d.tree, journal: store })).toBeNull();
    const fresh = await importCoda(again, s.deps(d));
    expect(fresh).toMatchObject({ resumable: false, pages: 1, problems: [] });
    expect(fresh.projectId).not.toBe(resumed.projectId);
    expect(liveTitles(d, fresh.projectId)).toEqual(['A']);
  });

  it('una página de la carpeta que todavía no terminó sigue impidiendo el cierre', async () => {
    const d = await device(), s = codaSource();
    const first = await s.run(d, { docs: cutDocs(d) });
    expect(first).toMatchObject({ resumable: true, pages: 0 });
    const env = await envelopeOf(d, s);
    expect(env.generations[env.activeGenerationId].phase).toBe('ready');
    // Y el registro no acepta el cierre aunque se lo pidan con una lista que no la nombra completa.
    const store = s.store(d);
    await expect(store.completeGeneration(await store.loadState(s.key), env.activeGenerationId, ['a', 'b'])).rejects.toMatchObject({ reason: 'invalid' });
    await expect(store.completeGeneration(await store.loadState(s.key), env.activeGenerationId, ['a', 'no-anotada'])).rejects.toMatchObject({ reason: 'invalid' });
    expect((await envelopeOf(d, s)).generations[env.activeGenerationId].phase).toBe('ready');
  });
});

describe('cuando entró todo y no se pudo anotar como terminada', () => {
  it.each(kinds)('%s: el aviso nombra las dos salidas, e Import into a new project entra entero a otro proyecto', async (kind) => {
    const d = await device(), s = await sourceOf(kind);
    const journal = { ...s.store(d), completeGeneration: async () => { throw new ImportPending('invalid'); } };
    const stuck = await s.run(d, { journal });
    expect(stuck).toMatchObject({ resumable: true, pages: 2 });
    const text = en(kind === 'coda' ? 'import.pending.close' : 'importArchive.pending.close');
    expect(stuck.problems).toEqual([text]);
    expect(text).toContain('Resume');
    expect(text).toContain('Import into a new project');
    // Seguir repite lo mismo mientras el cierre no se pueda anotar.
    expect((await s.run(d, { journal }, { resume: true })).problems).toEqual([text]);
    // La otra salida: un proyecto nuevo, que entra entero.
    const fresh = await s.run(d, {}, { intent: 'new' });
    expect(fresh).toMatchObject({ resumable: false, pages: 2, files: 1, problems: [] });
    expect(fresh.projectId).not.toBe(stuck.projectId);
    expect(liveTitles(d, fresh.projectId)).toEqual(['A', 'B']);
    expect(liveTitles(d, stuck.projectId)).toEqual(['A', 'B']);
  });
});

describe('el registro de una misma fuente no crece sin fin', () => {
  it('de las importaciones terminadas se conserva el detalle de las más recientes; de las anteriores queda la identidad; una sin terminar no se toca', async () => {
    const d = await device(), s = codaSource();
    // Primero una que queda sin terminar: nunca se poda.
    expect((await s.run(d, { docs: cutDocs(d) })).resumable).toBe(true);
    const before = await envelopeOf(d, s);
    const unfinished = before.activeGenerationId;
    const total = KEPT_CLOSED + 2;
    const projects: string[] = [];
    for (let i = 0; i < total; i++) {
      const result = await s.run(d, {}, { intent: 'new' });
      expect(result).toMatchObject({ resumable: false, pages: 2 });
      projects.push(result.projectId);
    }
    const env = await envelopeOf(d, s);
    expect(Object.keys(env.generations)).toHaveLength(total + 1);
    expect(env.generations[unfinished]).toEqual(before.generations[unfinished]);
    const closed = projects.map((id) => Object.values(env.generations).find((g) => g.reservation.projectId === id)!);
    expect(closed.map((g) => g.phase)).toEqual(projects.map(() => 'complete'));
    // Las dos más viejas, sin el detalle; las tres últimas, enteras.
    expect(closed.map((g) => Object.keys(g.journal!.pages).length)).toEqual([0, 0, 2, 2, 2]);
    expect(closed.map((g) => Object.keys(g.journal!.media).length)).toEqual([0, 0, 1, 1, 1]);
    // De las podadas queda quiénes son: ninguna reserva nueva puede repetir su proyecto.
    expect(closed[0]).toMatchObject({ reservation: { projectId: projects[0], sourceKey: s.docId }, journal: { projectId: projects[0], docId: s.docId } });
    // Y sus proyectos siguen como estaban.
    expect(liveTitles(d, projects[0])).toEqual(['A', 'B']);
    // La que quedó sin terminar ya no es la vigente, pero su proyecto y su registro siguen ahí.
    expect(d.tree.project(before.generations[unfinished].journal!.projectId)).toBeTruthy();
  });
});
