// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addShape } from '../media/markup';
import { insertTemplate } from '../templates/apply';
import { builtinBlocks } from '../templates/builtin';
import { applyLikeApp, mountEditor, unmountAll } from '../ui/collabHarness';
import { findUnknownContent, supportsContent } from '../ui/unknownContent';
import { AdmissionTester } from './admit';
import { buildCleanBase } from './clean';
import { block, group } from './historyTesting';
import { CONTENT_FRAGMENT, normalizeStructure, seedIfEmpty } from './structure';

// Can edit por un link con el editor real (Docs/Doc_Link_Publico.md, E2.14.4): el visitante escribe, aplica una plantilla
// de fábrica en una página vacía de la rama y anota una foto, con el editor de la app; todo pasa la prueba de admisión, y
// lo admitido se abre en el editor del equipo sin *UnsupportedPage* (nada desconocido) y sin perder nada.

afterEach(() => unmountAll());
const tick = () => new Promise((r) => setTimeout(r, 40));
const PHOTO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** El visitante arranca de la base limpia de la página, como la recibe el link. */
function visitorFrom(rows: Uint8Array[]): Y.Doc {
  const v = new Y.Doc();
  const built = buildCleanBase(rows);
  if (rows.length > 0) Y.applyUpdate(v, built.base);
  built.doc.destroy();
  return v;
}

/** Lo que agrega `fn` (asíncrono: el editor guarda en el documento cuando dibuja). */
async function row(v: Y.Doc, fn: () => void | Promise<void>): Promise<Uint8Array> {
  const sv = Y.encodeStateVector(v);
  await fn();
  await tick();
  return Y.encodeStateAsUpdate(v, sv);
}

describe('el visitante con el editor real', () => {
  it('escribe, aplica una plantilla en una página vacía y anota una foto: todo entra y el equipo lo abre', async () => {
    // La página con texto del equipo y una foto de la rama.
    const team = new Y.Doc({ gc: false });
    group(team).push([block('b0', 'texto del equipo'), block('ph', '', 'image', { url: `sdmedia://${PHOTO}` })]);
    const pageRows = [Y.encodeStateAsUpdate(team)];

    const v = visitorFrom(pageRows);
    normalizeStructure(v, 'repair');
    const ed = mountEditor(v, 'visitante');
    await tick();
    const tester = new AdmissionTester(pageRows);
    const visitorRows: Uint8Array[] = [];
    const admit = (r: Uint8Array) => {
      const verdict = tester.test(r);
      expect(verdict).toMatchObject({ ok: true });
      visitorRows.push(r);
    };
    // Escribe con el editor.
    admit(await row(v, () => void ed.insertBlocks([{ type: 'paragraph', content: 'Escrito desde el link' }] as never, ed.document[0].id, 'after')));
    // Anota la foto (el mapa de anotaciones, como el anotador).
    admit(await row(v, () => addShape(v, PHOTO, 's1', { kind: 'arrow', color: '#ff0000', x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5 }, { w: 800, h: 600 })));

    // Una página vacía de la rama: la semilla y una plantilla de fábrica.
    const empty = new Y.Doc();
    const emptyRows: Uint8Array[] = [];
    const seedRow = await row(empty, () => void seedIfEmpty(empty, 'pagina-vacia', 'seed'));
    const ed2 = mountEditor(empty, 'visitante');
    await tick();
    const templateRow = await row(empty, () => insertTemplate(ed2, builtinBlocks('prepro', 'en')));
    const emptyTester = new AdmissionTester(emptyRows);
    expect(emptyTester.test(seedRow)).toMatchObject({ ok: true });
    expect(emptyTester.test(templateRow)).toMatchObject({ ok: true });
    emptyTester.destroy();

    // El equipo, con la página abierta, recibe lo admitido; otro la abre de cero: nada desconocido, nada perdido.
    const live = new Y.Doc();
    for (const r of pageRows) Y.applyUpdate(live, r);
    mountEditor(live, 'equipo');
    await tick();
    for (const r of visitorRows) applyLikeApp(live, r);
    await tick();
    expect(findUnknownContent(live)).toBeNull();
    const json = JSON.stringify(live.getXmlFragment(CONTENT_FRAGMENT).toJSON());
    expect(json).toContain('Escrito desde el link');
    expect(json).toContain('texto del equipo');
    expect(live.getMap('photoMarkup').get(`${PHOTO}/s1`)).toBeTruthy();
    const fresh = new Y.Doc();
    for (const r of [...pageRows, ...visitorRows]) Y.applyUpdate(fresh, r);
    expect(supportsContent(fresh)).toBe(true);
    const ed3 = mountEditor(fresh, 'equipo2');
    await tick();
    expect(() => ed3.document.length).not.toThrow();
    // La plantilla aplicada, abierta por el equipo.
    const tpl = new Y.Doc();
    for (const r of [seedRow, templateRow]) Y.applyUpdate(tpl, r);
    expect(supportsContent(tpl)).toBe(true);
    const ed4 = mountEditor(tpl, 'equipo3');
    await tick();
    expect(ed4.document.length).toBeGreaterThan(3);
    tester.destroy();
  });
});
