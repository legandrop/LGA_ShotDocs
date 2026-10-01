// @vitest-environment jsdom
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { anchorBlock, buildComments, codaCommentId, normalizeText, parseCodaComments, type CodaThread } from './codaComments';
import { COMMENTS_FILE, countComments, importCoda, type CodaFolder, type CodaManifestPage } from './codaImport';

// Los comentarios de Coda al importar (Doc_Importar_Coda.md, "3. Comentarios"): `comments.json` con la forma
// que devuelve el servidor MCP de Coda, el anclaje por texto, los ids estables y la importación entera contra
// el servidor en memoria. Nombres, correos y textos inventados.

Object.assign(globalThis, { Blob: NodeBlob, File: NodeFile });

const devices: Device[] = [];
afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
});

const ME = 'yo@test.invalid';

/** Un hilo con la forma de `content_read` del MCP de Coda. */
function codaThread(n: number, opts: { state?: string; ref?: string | null; replyByMe?: boolean } = {}): Record<string, unknown> {
  const comments: Record<string, unknown>[] = [
    { authorEmail: 'ext@test.invalid', authorName: 'Persona Externa', commentUri: `comments/i-${n}a`, createdAt: 1790000000 + n, reactions: [], text: `Comentario ${n}`, userId: 1 },
  ];
  if (opts.replyByMe) {
    comments.push({ authorEmail: 'YO@test.invalid', authorName: 'Yo Mismo', commentUri: `comments/i-${n}b`, createdAt: 1790000100 + n, reactions: [], text: `Respuesta ${n}`, userId: 2 });
  }
  return {
    canvasUri: 'canvases/canvas-x',
    comments,
    pageUri: 'pages/section-x',
    reference: opts.ref === null || opts.ref === undefined ? null : { type: 'text', referenceBlockIds: ['cl-abc'], text: opts.ref },
    state: opts.state ?? 'Active',
    threadUri: `threads/r-${n}`,
  };
}

describe('comentarios de Coda: lectura y anclaje', () => {
  it('normaliza el Markdown de Coda: viñetas, casillas, títulos, negritas, links, tildes y espacios', () => {
    expect(normalizeText('- ¿A cuántos  FPS se filma?')).toBe('¿a cuantos fps se filma?');
    expect(normalizeText('1. **Uno** y [dos](https://x.test)')).toBe('uno y dos');
    expect(normalizeText('## Título\n- [ ] Tarea `código`')).toBe('titulo tarea codigo');
    expect(normalizeText('Precio \\- 3 <formula>x</formula>')).toBe('precio - 3 x');
  });

  it('va al primer bloque con ese texto; si abarca varias líneas prueba cada una; si no está, a la página', () => {
    const blocks = [
      { id: 'b1', text: 'Datos' },
      { id: 'b2', text: 'No está confirmado que sea necesario' },
      { id: 'b3', text: 'Segunda línea del texto' },
    ];
    const t = (ref: string | null): CodaThread => ({ comments: [{ text: 'x' }], reference: ref === null ? null : { text: ref } });
    expect(anchorBlock(t('- No está confirmado que sea necesario'), blocks)).toEqual({ blockId: 'b2', lost: false });
    expect(anchorBlock(t('- no esta CONFIRMADO'), blocks)).toEqual({ blockId: 'b2', lost: false });
    expect(anchorBlock(t('Otra cosa\nsegunda línea'), blocks)).toEqual({ blockId: 'b3', lost: false });
    expect(anchorBlock(t('Texto que ya no está'), blocks)).toEqual({ blockId: null, lost: true });
    expect(anchorBlock(t(null), blocks)).toEqual({ blockId: null, lost: false });
  });

  it('primero el texto exacto; lo corto no se busca adentro de otro; la cursiva se limpia; vacío va a la página', () => {
    const blocks = [
      { id: 'b1', text: 'Datos del rodaje' },
      { id: 'b2', text: 'Datos' },
      { id: 'b3', text: 'Plano 12: ok' },
      { id: 'b4', text: 'Un texto en cursiva acá' },
    ];
    const t = (ref: string): CodaThread => ({ comments: [{ text: 'x' }], reference: { text: ref } });
    expect(anchorBlock(t('Datos'), blocks)).toEqual({ blockId: 'b2', lost: false });
    expect(anchorBlock(t('ok'), blocks)).toEqual({ blockId: null, lost: true });
    expect(anchorBlock(t('a'), blocks)).toEqual({ blockId: null, lost: true });
    expect(anchorBlock(t('- texto en *cursiva*'), blocks)).toEqual({ blockId: 'b4', lost: false });
    expect(anchorBlock(t('_Un texto en cursiva acá_'), blocks)).toEqual({ blockId: 'b4', lost: false });
    expect(anchorBlock(t('- '), blocks)).toEqual({ blockId: null, lost: false });
    expect(normalizeText('snake_case_name y 2*3*4')).toBe('snake_case_name y 2*3*4');
  });

  it('último intento sin espacios: un texto que Coda da pegado (o la importación separó) encuentra su bloque', () => {
    const blocks = [
      { id: 'b1', text: 'Otra cosa' },
      { id: 'b2', text: 'Videos: https://drive.google.com/a https://drive.google.com/b' },
    ];
    const thread = (ref: string) => ({ reference: { type: 'text', text: ref } }) as unknown as CodaThread;
    expect(anchorBlock(thread('Videos:https://drive.google.com/ahttps://drive.google.com/b'), blocks)).toEqual({ blockId: 'b2', lost: false });
    // Corto: no se busca sin espacios adentro de otro bloque (11 caracteres no; 12 sí).
    expect(anchorBlock(thread('ot ra'), blocks)).toEqual({ blockId: null, lost: true });
    const near = [{ id: 'c1', text: 'xx abcdefghijkl yy' }];
    expect(anchorBlock(thread('abcde fghijk'), near)).toEqual({ blockId: null, lost: true });
    expect(anchorBlock(thread('abcde fghijkl'), near)).toEqual({ blockId: 'c1', lost: false });
    // Contenido en dos bloques: no se adivina, va a la página entera.
    const twice = [
      { id: 'd1', text: 'Ver https://x.com/ab y más' },
      { id: 'd2', text: 'Ver https://x.com/abc' },
    ];
    expect(anchorBlock(thread('Ver https://x.com/a b'), twice)).toEqual({ blockId: null, lost: true });
  });

  it('un párrafo que la importación partió en tarjetas se compara contra sus bloques seguidos juntos', () => {
    const A = 'https://drive.google.com/file/d/1AAA/view';
    const B = 'https://drive.google.com/file/d/1BBB/view';
    const blocks = [
      { id: 'b0', text: 'Otra cosa' },
      { id: 'b1', text: 'Referencia:' },
      { id: 'b2', text: A },
      { id: 'b3', text: B },
      { id: 'b4', text: 'Sigue el texto.' },
    ];
    const thread = (ref: string) => ({ reference: { type: 'text', text: ref } }) as unknown as CodaThread;
    // El párrafo entero, pegado o con el Markdown de Coda: va al primero de sus bloques.
    expect(anchorBlock(thread(`Referencia:${A}${B}`), blocks)).toEqual({ blockId: 'b1', lost: false });
    expect(anchorBlock(thread(`Referencia: [${A}](${A}) [${B}](${B})`), blocks)).toEqual({ blockId: 'b1', lost: false });
    // Una parte que cruza de un bloque al siguiente: al bloque donde empieza.
    expect(anchorBlock(thread(`${B}Sigue el texto`), blocks)).toEqual({ blockId: 'b3', lost: false });
    // El mismo párrafo partido dos veces en la página: no se adivina, va a la página entera.
    const twice = [...blocks, { id: 'c1', text: 'Referencia:' }, { id: 'c2', text: A }, { id: 'c3', text: B }];
    expect(anchorBlock(thread(`Referencia:${A}${B}`), twice)).toEqual({ blockId: null, lost: true });
    // Corto (menos de 12 caracteres sin espacios): tampoco se busca así.
    expect(anchorBlock(thread('cosa Refer'), blocks)).toEqual({ blockId: null, lost: true });
  });

  it('datos raros de Coda: sin texto, nombre largo, correo inválido, fecha imposible', async () => {
    const threads = parseCodaComments({
      pages: {
        p: [
          {
            state: 'Active',
            comments: [
              { commentUri: 'comments/i-z', authorName: 'N'.repeat(300), authorEmail: 'no-es-un-correo', createdAt: 100, text: '  ' },
              { commentUri: 'comments/i-y', authorName: '', authorEmail: 'ext@test.invalid', createdAt: 1790000000, text: 'Hola' },
            ],
          },
        ],
      },
    }).pages.get('p')!;
    const now = '2026-09-30T12:00:00.000Z';
    const { comments } = await buildComments(threads, { projectId: 'proj', pageId: 'page', codaPageId: 'p', blocks: [], now });
    // La fecha imposible toma la última válida del hilo: sale siempre igual (seguir no la cambia).
    const other = new Date(1790000000 * 1000).toISOString();
    expect(comments[0]).toMatchObject({ body: '(no text in Coda)', authorEmail: null, createdAt: other });
    // Un hilo sin ninguna fecha válida toma la de la captura, no la de ahora.
    const alone = parseCodaComments({ pages: { p: [{ comments: [{ text: 'x' }] }] } }).pages.get('p')!;
    const captured = '2026-09-29T08:00:00.000Z';
    const again = await buildComments(alone, { projectId: 'proj', pageId: 'page', codaPageId: 'p', blocks: [], capturedAt: captured, now });
    expect(again.comments[0].createdAt).toBe(captured);
    expect(comments[0].authorName).toHaveLength(200);
    expect(comments[1]).toMatchObject({ authorName: 'ext@test.invalid', authorEmail: 'ext@test.invalid', body: 'Hola' });
  });

  it('lee comments.json y saltea lo que no tiene forma; sin "pages" es un error', () => {
    const parsed = parseCodaComments({
      docId: 'DOC',
      pages: { p1: [codaThread(1), { comments: [] }, 'x', { comments: 'no' }], p2: 'no' },
    });
    expect(parsed.docId).toBe('DOC');
    expect(parsed.pages.get('p1')).toHaveLength(1);
    expect(parsed.pages.has('p2')).toBe(false);
    expect(() => parseCodaComments({ docId: 'DOC' })).toThrow();
  });

  it('ids estables por proyecto: el mismo comentario da el mismo id; en otro proyecto, otro', async () => {
    const a = await codaCommentId('proj-1', 'comments/i-1a');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await codaCommentId('proj-1', 'comments/i-1a')).toBe(a);
    expect(await codaCommentId('proj-2', 'comments/i-1a')).not.toBe(a);
  });

  it('arma los hilos: fecha original, resuelto con la fecha del último comentario, lo propio sin autor de afuera', async () => {
    const threads = parseCodaComments({ pages: { p: [codaThread(1, { state: 'Resolved', ref: '- Datos', replyByMe: true })] } }).pages.get('p')!;
    const { comments, lost } = await buildComments(threads, {
      projectId: 'proj',
      pageId: 'page',
      codaPageId: 'p',
      blocks: [{ id: 'b1', text: 'Datos' }],
      userEmail: ME,
    });
    expect(lost).toBe(0);
    expect(comments).toHaveLength(2);
    expect(comments[0]).toMatchObject({
      blockId: 'b1',
      threadId: null,
      body: 'Comentario 1',
      createdAt: new Date(1790000001 * 1000).toISOString(),
      resolvedAt: new Date(1790000101 * 1000).toISOString(),
      authorName: 'Persona Externa',
      authorEmail: 'ext@test.invalid',
      source: 'coda',
    });
    expect(comments[1]).toMatchObject({ threadId: comments[0].id, blockId: null, resolvedAt: null, authorName: null, authorEmail: null });
  });
});

describe('comentarios de Coda: importar la carpeta', () => {
  const page = (id: string, name: string, parentId: string | null, order: number): CodaManifestPage => ({
    id,
    name,
    parentId,
    order,
    contentType: 'canvas',
    file: `${id}.html`,
    media: [],
  });

  function folder(comments: unknown): CodaFolder {
    const files = new Map<string, string>([
      ['pages/root.html', '<h2><span>Datos</span></h2>'],
      [
        'pages/s1.html',
        '<ul><li><span>A cuántos fps se filma?</span></li><li><span>El tráfico es controlado</span></li></ul><div><span>Nota final</span></div>',
      ],
    ]);
    if (comments !== undefined) files.set(COMMENTS_FILE, typeof comments === 'string' ? comments : JSON.stringify(comments));
    return {
      manifest: { doc: { id: 'DOC', name: 'Prueba' }, pages: [page('root', 'Raíz', null, 0), page('s1', 'Escena', 'root', 0)] },
      has: (p) => files.has(p),
      paths: () => [...files.keys()],
      text: async (p) => String(files.get(p)),
      file: async (p) => new Blob([String(files.get(p))]),
      size: (p) => files.get(p)?.length ?? 0,
    };
  }

  const COMMENTS = {
    docId: 'DOC',
    pages: {
      s1: [
        codaThread(1, { ref: '- A cuántos fps se filma?', replyByMe: true }),
        codaThread(2, { ref: '- El tráfico es controlado', state: 'Resolved' }),
        codaThread(3, { ref: null, state: 'Resolved' }),
        codaThread(4, { ref: '- Un texto que se borró' }),
      ],
      root: [],
    },
  };

  async function setup() {
    const server = new FakeServer();
    server.enableMedia();
    server.enableImportedComments();
    const a = await makeDevice(server, undefined, undefined, undefined, undefined, { email: ME });
    devices.push(a);
    await a.engine.syncNow();
    return { server, a };
  }

  it('cada hilo va al bloque con su texto, los resueltos resueltos, sin texto a la página, y otro dispositivo los ve', async () => {
    const { server, a } = await setup();
    const f = folder(COMMENTS);
    expect(await countComments(f)).toBe(5);
    const result = await importCoda(f, { ...a, comments: a.comments, userEmail: ME });
    expect(result.comments).toBe(5);
    expect(result.problems).toEqual(['Escena: the text of 1 comment was not found; it is on the whole page']);
    for (let i = 0; i < 3; i++) await a.engine.syncNow();

    const scene = [...server.pages.values()].find((p) => p.workspace_id === result.projectId && p.title === 'Escena')!;
    const rows = [...server.comments.values()].filter((c) => c.page_id === scene.id);
    expect(rows).toHaveLength(5);
    const byBody = new Map(rows.map((r) => [r.body, r]));
    // Los bloques de verdad de la página: el hilo 1 en el primer ítem, el 2 en el segundo.
    const doc = await a.docs.open(scene.id);
    const { pageBlocks } = await import('./codaComments');
    const { CONTENT_FRAGMENT } = await import('../sync/structure');
    const blocks = pageBlocks(doc.getXmlFragment(CONTENT_FRAGMENT));
    a.docs.close(scene.id);
    const idOf = (text: string) => blocks.find((b) => b.text.includes(text))?.id;
    expect(byBody.get('Comentario 1')!.block_id).toBe(idOf('A cuántos fps'));
    expect(byBody.get('Comentario 2')!.block_id).toBe(idOf('El tráfico'));
    expect(byBody.get('Comentario 2')!.resolved_at).not.toBeNull();
    expect(byBody.get('Comentario 3')).toMatchObject({ block_id: null });
    expect(byBody.get('Comentario 3')!.resolved_at).not.toBeNull();
    expect(byBody.get('Comentario 4')).toMatchObject({ block_id: null, resolved_at: null });
    // La respuesta propia queda a nombre de quien importa; las demás, del autor de afuera.
    expect(byBody.get('Respuesta 1')).toMatchObject({ author_id: server.ownerId, imported_author: null, thread_id: byBody.get('Comentario 1')!.id });
    expect(byBody.get('Comentario 1')).toMatchObject({ author_id: null, imported_author: 'Persona Externa', imported_from: 'coda' });

    // Otro dispositivo los baja al abrir la página.
    const b = await makeDevice(server);
    devices.push(b);
    await b.engine.syncNow();
    const stop = b.comments.watch(scene.id);
    await b.engine.syncNow();
    const threads = b.comments.threads(scene.id);
    stop();
    expect(threads).toHaveLength(4);
    expect(threads.filter((t) => t.resolved)).toHaveLength(2);
  });

  it('un hilo pegado al texto de una celda (también uno corto) queda en el bloque de la tabla, sin nota de problema', async () => {
    const { server, a } = await setup();
    const files = new Map<string, string>([
      ['pages/root.html', '<h2><span>Tareas</span></h2>'],
      // Un párrafo "ok" después de una tabla con una celda "ok": el hilo pegado a "ok" sigue yendo al párrafo.
      ['pages/s1.html', '<div>Antes</div><table><thead><tr><th>Tarea</th><th>Quién</th></tr></thead><tbody><tr><td>Pedir el plano 12</td><td>Ana</td></tr><tr><td>Lente</td><td>ok</td></tr></tbody></table><div>ok</div>'],
      // Uno largo (se encuentra adentro del bloque) y uno corto, de una palabra (antes no se buscaba adentro de
      // otro bloque; ahora vale si es el texto entero de una celda).
      [COMMENTS_FILE, JSON.stringify({ docId: 'DOC', pages: { s1: [codaThread(1, { ref: 'Pedir el plano 12' }), codaThread(2, { ref: 'Lente' }), codaThread(3, { ref: 'ok' }), codaThread(4, { ref: 'Quién' })] } })],
    ]);
    const f: CodaFolder = {
      manifest: { doc: { id: 'DOC', name: 'Prueba' }, pages: [page('root', 'Raíz', null, 0), page('s1', 'Tabla', 'root', 0)] },
      has: (p) => files.has(p),
      paths: () => [...files.keys()],
      text: async (p) => String(files.get(p)),
      file: async (p) => new Blob([String(files.get(p))]),
      size: (p) => files.get(p)?.length ?? 0,
    };
    const result = await importCoda(f, { ...a, comments: a.comments, userEmail: ME });
    expect(result.problems).toEqual([]);
    for (let i = 0; i < 3; i++) await a.engine.syncNow();
    const tablePage = [...server.pages.values()].find((p) => p.workspace_id === result.projectId && p.title === 'Tabla')!;
    const doc = await a.docs.open(tablePage.id);
    const { pageBlocks } = await import('./codaComments');
    const { CONTENT_FRAGMENT } = await import('../sync/structure');
    const blocks = pageBlocks(doc.getXmlFragment(CONTENT_FRAGMENT));
    a.docs.close(tablePage.id);
    const tableBlock = blocks.find((b) => b.text.includes('Pedir el plano 12'))!;
    const rows = [...server.comments.values()].filter((c) => c.page_id === tablePage.id);
    const okBlock = blocks.find((b) => b.text === 'ok')!;
    const byBody = new Map(rows.map((r) => [r.body, r.block_id]));
    expect([1, 2, 4].map((n) => byBody.get(`Comentario ${n}`))).toEqual([tableBlock.id, tableBlock.id, tableBlock.id]);
    expect(byBody.get('Comentario 3')).toBe(okBlock.id);
  });

  it('seguir una importación cortada no repite comentarios, y lo que no salió toma los bloques nuevos de la página', async () => {
    const { server, a } = await setup();
    const f = folder(COMMENTS);
    const { metaJournal } = await import('./codaImport');
    // Los comentarios quedan en la cola pero la página no se llega a anotar como terminada (un corte justo
    // después): al seguir se vuelve a escribir, con bloques de otro id, y se vuelven a poner en la cola.
    server.online = false;
    let cut = true;
    const comments = {
      importComments: async (list: Parameters<typeof a.comments.importComments>[0]) => {
        const n = await a.comments.importComments(list);
        if (cut) throw new Error('corte');
        return n;
      },
    };
    const deps = { ...a, comments, userEmail: ME, journal: metaJournal(a.db) };
    const first = await importCoda(f, deps);
    expect(first.resumable).toBe(true);
    cut = false;
    const second = await importCoda(f, deps, { resume: true });
    expect(second.projectId).toBe(first.projectId);
    expect(second.resumable).toBe(false);
    server.online = true;
    for (let i = 0; i < 3; i++) await a.engine.syncNow();
    expect(server.comments.size).toBe(5);
    expect(a.engine.getStatus().failedComments).toBe(0);
    // El hilo 1 apunta al bloque que tiene su texto ahora, no al de la primera escritura.
    const scene = [...server.pages.values()].find((p) => p.workspace_id === first.projectId && p.title === 'Escena')!;
    const doc = await a.docs.open(scene.id);
    const { pageBlocks } = await import('./codaComments');
    const { CONTENT_FRAGMENT } = await import('../sync/structure');
    const now = pageBlocks(doc.getXmlFragment(CONTENT_FRAGMENT));
    a.docs.close(scene.id);
    const root1 = [...server.comments.values()].find((c) => c.body === 'Comentario 1')!;
    expect(root1.block_id).toBe(now.find((b) => b.text.includes('A cuántos fps'))?.id);
  });

  it('seguir con red después de que los comentarios subieron: el hilo pasa al bloque nuevo, sin conflictos', async () => {
    const { server, a } = await setup();
    const f = folder(COMMENTS);
    const { metaJournal } = await import('./codaImport');
    let cut = true;
    const comments = {
      importComments: async (list: Parameters<typeof a.comments.importComments>[0]) => {
        const n = await a.comments.importComments(list);
        if (cut) throw new Error('corte');
        return n;
      },
    };
    const deps = { ...a, comments, userEmail: ME, journal: metaJournal(a.db) };
    const first = await importCoda(f, deps);
    for (let i = 0; i < 3; i++) await a.engine.syncNow();
    expect(server.comments.size).toBe(5);
    const before = [...server.comments.values()].find((c) => c.body === 'Comentario 1')!.block_id;
    cut = false;
    await importCoda(f, deps, { resume: true });
    for (let i = 0; i < 3; i++) await a.engine.syncNow();
    expect(server.comments.size).toBe(5);
    expect(a.engine.getStatus().failedComments).toBe(0);
    const scene = [...server.pages.values()].find((p) => p.workspace_id === first.projectId && p.title === 'Escena')!;
    const doc = await a.docs.open(scene.id);
    const { pageBlocks } = await import('./codaComments');
    const { CONTENT_FRAGMENT } = await import('../sync/structure');
    const now = pageBlocks(doc.getXmlFragment(CONTENT_FRAGMENT));
    a.docs.close(scene.id);
    const byBody = new Map([...server.comments.values()].map((c) => [c.body, c]));
    const target = now.find((b) => b.text.includes('A cuántos fps'))?.id;
    expect(target).toBeTruthy();
    // La página se volvió a escribir: el bloque es otro.
    expect(target).not.toBe(before);
    expect(byBody.get('Comentario 1')!.block_id).toBe(target);
    expect(byBody.get('Respuesta 1')!.block_id).toBe(target);
  });

  it('un comments.json roto o de otro doc se anota y la importación sigue sin comentarios', async () => {
    const { server, a } = await setup();
    const broken = await importCoda(folder('{no es json'), { ...a, comments: a.comments });
    expect(broken.comments).toBe(0);
    expect(broken.problems).toEqual(["The comments.json in this folder can't be read: the comments were not imported."]);
    const other = await importCoda(folder({ ...COMMENTS, docId: 'OTRO' }), { ...a, comments: a.comments });
    expect(other.comments).toBe(0);
    expect(other.problems[0]).toContain('another doc');
    // Sin la cola de comentarios, también se anota.
    const off = await importCoda(folder(COMMENTS), { ...a, comments: undefined });
    expect(off.problems[0]).toContain("can't be saved");
    await a.engine.syncNow();
    expect(server.comments.size).toBe(0);
  });

  it('sin comments.json importa igual que antes', async () => {
    const { a } = await setup();
    const result = await importCoda(folder(undefined), { ...a, comments: a.comments });
    expect(result).toMatchObject({ comments: 0, problems: [] });
  });
});
