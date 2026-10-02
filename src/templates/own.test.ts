// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { PageTree } from '../sync/tree';
import type { PageRow, ProjectRow } from '../sync/types';
import { builtinBlocks, type TemplateBlock } from './builtin';
import { BUILTIN_ONSET, BUILTIN_SHOT } from './builtinIds';
import { dayReportFolderOf, isDayReportFolder, isReportPage } from './dayReport';
import { cellContent, inlineText } from './dayReportFacts';
import {
  builtinOrigin,
  dayReportTemplates,
  isDayReportTemplate,
  isTemplatePage,
  listTemplates,
  saveTemplateSettings,
  settingsFit,
  stopUsingAsTemplate,
  templateInfo,
  templateMark,
  templatesFolderOf,
  templateSetting,
} from './own';
import { clearFilledIn, stripAppMedia, suggestedTemplateName } from './ownCopy';

// Las plantillas propias (Docs/Doc_Plantillas.md, secciones 3, 5 y 7; entrega 3): cuál página es una plantilla (marcada,
// deducida de la carpeta *Templates*, dejada a mano), qué lista la ventana, los ajustes que no se pisan, y las dos
// transformaciones del contenido: sacar fotos y archivos de otro proyecto (PL10) y *Clear filled-in values* (5.1).

/** Un árbol en memoria con varias páginas y proyectos (sin base: solo para leerlo). */
function treeOf(rows: Partial<PageRow>[], projects: ProjectRow[] = [{ id: 'p', name: 'ERSO', created_at: '1' }]): PageTree {
  const writes: unknown[] = [];
  const db = {
    getAll: async () => [],
    get: async () => undefined,
    put: async (...args: unknown[]) => writes.push(args),
    transaction: () => ({ objectStore: () => ({ put: async () => undefined, add: async () => 1, delete: async () => undefined }), done: Promise.resolve() }),
  } as never;
  const tree = new PageTree(db, projects[0].id);
  const full = rows.map(
    (r, i): PageRow => ({
      id: r.id!,
      workspace_id: r.workspace_id ?? projects[0].id,
      parent_id: r.parent_id ?? null,
      title: r.title ?? '',
      icon: null,
      sort_key: `a${i}`,
      settings: r.settings ?? {},
      template_id: r.template_id ?? null,
      update_seq: 0,
      deleted_at: r.deleted_at ?? null,
      created_at: '',
      updated_at: '',
    }),
  );
  const internal = tree as unknown as { snapshot: Map<string, PageRow>; projectSnapshot: Map<string, ProjectRow>; projectsKnown: boolean; recompute(): void };
  internal.snapshot = new Map(full.map((r) => [r.id, r]));
  internal.projectSnapshot = new Map(projects.map((p) => [p.id, p]));
  internal.projectsKnown = true;
  internal.recompute();
  return tree;
}

/** Un árbol que anota los cambios de ajustes en vez de encolarlos. */
function recordingTree(rows: Partial<PageRow>[]) {
  const tree = treeOf(rows);
  const calls: { id: string; key: string; value: unknown }[] = [];
  const fake = {
    get: (id: string) => tree.get(id),
    setSetting: async (id: string, key: string, value: unknown) => {
      calls.push({ id, key, value });
    },
  };
  return { tree, fake: fake as never as Pick<PageTree, 'get' | 'setSetting'>, calls };
}

const PROJECTS: ProjectRow[] = [
  { id: 'p', name: 'ERSO', created_at: '1' },
  { id: 'q', name: 'MGTZD', created_at: '2' },
];

describe('cuál página es una plantilla (sección 3)', () => {
  const tree = treeOf(
    [
      { id: 'folder', title: 'Templates', settings: { templatesFolder: true } },
      { id: 'marked', parent_id: 'folder', title: 'Our On-Set', settings: { template: { description: 'Ours', dayReport: true } } },
      { id: 'lost', parent_id: 'folder', title: 'Lost mark' },
      { id: 'stopped', parent_id: 'folder', title: 'Old one', settings: { template: false } },
      { id: 'deep', parent_id: 'lost', title: 'Subpage of a template' },
      { id: 'outside', title: 'Somewhere', settings: { template: {} } },
      { id: 'plain', title: 'Plain page' },
      { id: 'trashed', parent_id: 'folder', title: 'Trashed', settings: { template: {} }, deleted_at: '2026-10-01' },
      { id: 'weird', title: 'Weird', settings: { template: 'yes' as never } },
      { id: 'other', workspace_id: 'q', title: 'MGTZD Templates', settings: { templatesFolder: true } },
      { id: 'otherTpl', workspace_id: 'q', parent_id: 'other', title: 'Shot sheet', settings: { template: { description: 'Per shot' } } },
      { id: 'otherReport', workspace_id: 'q', parent_id: 'other', title: 'Report', settings: { template: { dayReport: true } } },
    ],
    PROJECTS,
  );

  it('marcada, deducida adentro de Templates (marca perdida), dejada a mano, en la papelera', () => {
    expect(templateMark(tree.get('marked'))).toBe('on');
    expect(templateMark(tree.get('stopped'))).toBe('off');
    expect(templateMark(tree.get('lost'))).toBeNull();
    expect(templateMark(tree.get('weird'))).toBeNull();
    expect(isTemplatePage(tree, 'marked')).toBe(true);
    // La marca se perdió (dos cambios de ajustes a la vez, sección 8): adentro de Templates sigue siendo plantilla.
    expect(isTemplatePage(tree, 'lost')).toBe(true);
    // *Stop using as template* gana sobre lo deducido.
    expect(isTemplatePage(tree, 'stopped')).toBe(false);
    // Solo lo que está directamente adentro de la carpeta.
    expect(isTemplatePage(tree, 'deep')).toBe(false);
    expect(isTemplatePage(tree, 'outside')).toBe(true);
    expect(isTemplatePage(tree, 'plain')).toBe(false);
    expect(isTemplatePage(tree, 'trashed')).toBe(false);
    expect(isTemplatePage(tree, 'folder')).toBe(false);
    expect(isTemplatePage(tree, 'weird')).toBe(false);
  });

  it('la información de la marca (formas raras cuentan como vacías) y de qué plantilla de fábrica salió', () => {
    expect(templateInfo(tree.get('marked'))).toEqual({ description: 'Ours', dayReport: true });
    expect(templateInfo(tree.get('lost'))).toEqual({ description: '', dayReport: false });
    expect(templateInfo(tree.get('weird'))).toEqual({ description: '', dayReport: false });
    expect(builtinOrigin({ template_id: BUILTIN_SHOT } as PageRow)).toBe('shot');
    expect(builtinOrigin({ template_id: 'some-page' } as PageRow)).toBeNull();
  });

  it('la ventana lista las del proyecto (sin la página que recibe) y, aparte, las de otros proyectos', () => {
    expect(templatesFolderOf(tree, 'p')?.id).toBe('folder');
    const lists = listTemplates(tree, 'p', 'marked');
    expect(lists.thisProject.map((t) => t.row.id)).toEqual(['lost', 'outside']);
    expect(lists.others.map((o) => [o.project.name, o.templates.map((t) => t.row.id)])).toEqual([['MGTZD', ['otherTpl', 'otherReport']]]);
    expect(listTemplates(tree, 'q').others[0].templates.map((t) => t.row.id)).toEqual(['marked', 'lost', 'outside']);
    // Las de reporte del día: primero las del proyecto.
    expect(dayReportTemplates(tree, 'p').map((t) => t.row.id)).toEqual(['marked', 'otherReport']);
  });

  it('una página que salió de una plantilla de reporte propia es un reporte; Templates nunca se deduce como carpeta de reportes', () => {
    const t2 = treeOf([
      { id: 'folder', title: 'Templates', settings: { templatesFolder: true } },
      { id: 'tpl', parent_id: 'folder', title: '2026-10-01 | Day 01', template_id: BUILTIN_ONSET, settings: { template: { dayReport: true } } },
      { id: 'reports', title: 'Reportes' },
      { id: 'r1', parent_id: 'reports', title: '2026-10-02 | Day 02', template_id: 'tpl' },
    ]);
    expect(isDayReportTemplate(t2, 'tpl')).toBe(true);
    expect(isReportPage(t2.get('r1')!, t2)).toBe(true);
    // Sin el árbol, solo se reconoce la de fábrica.
    expect(isReportPage(t2.get('r1')!)).toBe(false);
    expect(isDayReportFolder(t2, 'reports')).toBe(true);
    expect(dayReportFolderOf(t2, 'r1')).toBe('reports');
    // La plantilla guardada desde un reporte tiene nombre de reporte, pero Templates no es una carpeta de reportes.
    expect(isDayReportFolder(t2, 'folder')).toBe(false);
  });
});

describe('los ajustes de una plantilla (5.2, 7 y 8)', () => {
  it('Template settings guarda la descripción (recortada) y la marca, y conserva claves que esta versión no conoce', async () => {
    const { fake, calls } = recordingTree([{ id: 't', title: 'T', settings: { template: { description: 'Old', future: 1 } as never } }]);
    expect(await saveTemplateSettings(fake, 't', { description: '  New   text ', dayReport: true })).toBe(true);
    expect(calls).toEqual([{ id: 't', key: 'template', value: { future: 1, description: 'New text', dayReport: true } }]);
    calls.length = 0;
    expect(await saveTemplateSettings(fake, 't', { description: '', dayReport: false })).toBe(true);
    expect(calls[0].value).toEqual({ future: 1 });
  });

  it('lo que no entra en los 2000 caracteres de la base no se guarda', async () => {
    const big = 'x'.repeat(1900);
    const { fake, calls } = recordingTree([{ id: 't', title: 'T', settings: { header: { levels: 1, note: big } as never } }]);
    expect(settingsFit(fake.get('t'), { template: templateSetting({ description: 'y'.repeat(300) }) })).toBe(false);
    expect(await saveTemplateSettings(fake, 't', { description: 'y'.repeat(300), dayReport: false })).toBe(false);
    expect(calls).toEqual([]);
    expect(templateSetting({ description: 'z'.repeat(400) }).description).toHaveLength(300);
  });

  it('Stop using as template: adentro de Templates deja false (si no, se volvería a deducir); afuera borra la marca', async () => {
    const { fake, calls } = recordingTree([
      { id: 'folder', title: 'Templates', settings: { templatesFolder: true } },
      { id: 'in', parent_id: 'folder', title: 'A', settings: { template: {} } },
      { id: 'out', title: 'B', settings: { template: {} } },
    ]);
    await stopUsingAsTemplate(fake, 'in');
    await stopUsingAsTemplate(fake, 'out');
    expect(calls).toEqual([
      { id: 'in', key: 'template', value: false },
      { id: 'out', key: 'template', value: undefined },
    ]);
  });

  it('cambiar el formato de hoja conserva template, templatesFolder y dayReports (setSetting copia lo demás)', async () => {
    const tree = treeOf([{ id: 'x', title: 'X', settings: { template: { description: 'd' }, templatesFolder: true, dayReports: { template: 'y' } } }]);
    const queued: unknown[] = [];
    (tree as unknown as { enqueue(op: unknown): Promise<void> }).enqueue = async (op) => {
      queued.push(op);
    };
    await tree.setSetting('x', 'format', { size: 'a4' });
    expect(queued).toEqual([
      { kind: 'update', id: 'x', patch: { settings: { template: { description: 'd' }, templatesFolder: true, dayReports: { template: 'y' }, format: { size: 'a4' } } } },
    ]);
  });

  it('el nombre que propone Save as template: el título; un reporte del día, On-Set Report en el idioma de la app', () => {
    expect(suggestedTemplateName({ title: 'Escena 12' } as PageRow, 'en')).toBe('Escena 12');
    expect(suggestedTemplateName({ title: '2026-10-02 | Day 06' } as PageRow, 'en')).toBe('On-Set Report');
    expect(suggestedTemplateName({ title: '2026-10-02 | Día 06' } as PageRow, 'es')).toBe('Reporte de rodaje');
  });
});

// --- El contenido ----------------------------------------------------------------------------------------------------

const ID = (n: number) => `0f8fad5b-d9cb-469f-a165-7086772895${String(n).padStart(2, '0')}`;
const text = (t: string) => ({ type: 'text', text: t, styles: {} });
const photo = (url: string) => ({ type: 'photo', props: { url, name: 'F.jpg', w: 0 } });
const cell = (content: unknown[]) => ({ type: 'tableCell', props: { colspan: 1, rowspan: 1 }, content });

const PAGE: TemplateBlock[] = [
  {
    id: 'facts',
    type: 'table',
    content: {
      type: 'tableContent',
      headerCols: 1,
      rows: [
        { cells: [cell([text('Location')]), cell([text('Estancia'), photo(`sdmedia://${ID(1)}`)])] },
        { cells: [cell([text('Unit')]), cell([text('Main unit')])] },
      ],
    },
  },
  {
    id: 'shots',
    type: 'table',
    content: {
      type: 'tableContent',
      headerRows: 1,
      rows: [
        { cells: [cell([text('Shot')]), cell([text('Ref')]), cell([text('Notes')])] },
        { cells: [cell([text('010')]), cell([photo(`sdmedia://${ID(2)}`)]), cell([text('wide')])] },
      ],
    },
  },
  { id: 'c', type: 'checkListItem', props: { checked: true }, content: [text('clean plate')] },
  { id: 'img', type: 'image', props: { url: `sdmedia://${ID(3)}`, name: 'F3.jpg' }, children: [{ id: 'kid', type: 'paragraph', content: [text('caption kept')] }] },
  { id: 'old', type: 'image', props: { url: 'sdfile://ws/old.jpg', name: 'old.jpg' } },
  { id: 'web', type: 'image', props: { url: 'https://example.com/a.jpg', name: 'a.jpg' } },
  { id: 'p', type: 'paragraph', content: [text('Before '), photo(`SDMEDIA://${ID(4)}`), { type: 'link', href: 'https://x.test', content: [text('link')] }, text(' after')] },
  { id: 'drive', type: 'paragraph', props: { driveCard: true }, content: [{ type: 'link', href: 'https://drive.google.com/file/d/abc', content: [text('Plate')] }] },
];

const cellText = (b: TemplateBlock, row: number, col: number) =>
  inlineText(cellContent((b.content as { rows: { cells: unknown[] }[] }).rows[row].cells[col]));

describe('fotos y archivos de otro proyecto (PL10)', () => {
  it('saca fotos-bloque, en línea y en celdas (sdmedia y sdfile), cuenta bien y deja links, tarjetas de Drive y los hijos', () => {
    const before = JSON.stringify(PAGE);
    const { blocks, removed } = stripAppMedia(PAGE);
    expect(JSON.stringify(PAGE)).toBe(before);
    expect(removed).toBe(5);
    const json = JSON.stringify(blocks);
    expect(json).not.toMatch(/sdmedia|sdfile/i);
    expect(json).toContain('https://example.com/a.jpg');
    expect(json).toContain('drive.google.com');
    expect(json).toContain('caption kept');
    const ids = (blocks as { id: string }[]).map((b) => b.id);
    expect(ids).toEqual(['facts', 'shots', 'c', 'kid', 'web', 'p', 'drive']);
    expect(cellText(blocks[0], 0, 1)).toBe('Estancia');
    expect(inlineText((blocks[5] as { content: unknown }).content)).toBe('Before link after');
  });
});

describe('Clear filled-in values (5.1)', () => {
  it('vacía las celdas salvo encabezados y rótulos, desmarca casillas, saca fotos y deja títulos y párrafos', () => {
    const out = clearFilledIn(PAGE);
    // La ficha: el rótulo queda, el valor se vacía (con su foto).
    expect(cellText(out[0], 0, 0)).toBe('Location');
    expect(cellText(out[0], 0, 1)).toBe('');
    expect(cellText(out[0], 1, 1)).toBe('');
    // Una tabla con encabezado: el encabezado queda, el resto se vacía (también la primera columna, que es un dato).
    expect([0, 1, 2].map((c) => cellText(out[1], 0, c))).toEqual(['Shot', 'Ref', 'Notes']);
    expect([0, 1, 2].map((c) => cellText(out[1], 1, c))).toEqual(['', '', '']);
    // Las celdas guardan su forma (tableCell con sus ajustes).
    const firstCell = (out[1].content as { rows: { cells: { type: string; props: unknown }[] }[] }).rows[1].cells[0];
    expect(firstCell.type).toBe('tableCell');
    expect(firstCell.props).toEqual({ colspan: 1, rowspan: 1 });
    expect((out[2] as { props: { checked: boolean } }).props.checked).toBe(false);
    expect(JSON.stringify(out)).not.toMatch(/sdmedia|sdfile/i);
    expect(JSON.stringify(out)).toContain('Before');
  });

  it('en las tablas de las de fábrica deja los rótulos de la primera columna (Camera package, Measurements, Data)', () => {
    for (const lang of ['en', 'es']) {
      const filled = structuredClone(builtinBlocks('onset', lang)) as TemplateBlock[];
      // Se llena todo como en un día de rodaje: cada celda que no es encabezado lleva un valor.
      for (const b of filled) {
        const table = b.content as { headerRows?: number; rows?: { cells: unknown[] }[] } | undefined;
        if (b.type !== 'table' || !table?.rows) continue;
        table.rows.forEach((row, r) => {
          if (r < (table.headerRows ?? 0)) return;
          row.cells = row.cells.map((c, i) => (i === 0 && inlineText(cellContent(c)) ? c : `value ${r}.${i}`));
        });
      }
      const out = clearFilledIn(filled);
      const original = builtinBlocks('onset', lang);
      // Vaciado, queda igual a la de fábrica: los rótulos (A, B, Camera to subject, Camera A…) y los encabezados.
      const texts = (list: TemplateBlock[]) =>
        list.filter((b) => b.type === 'table').map((b) => (b.content as { rows: { cells: unknown[] }[] }).rows.map((r) => r.cells.map((c) => inlineText(cellContent(c)))));
      // Lo único que no vuelve es el valor de fábrica de la ficha (*Unit* = *Main unit*): es un dato (el reporte del día
      // lo copia del anterior).
      const expected = texts(original).map((rows, t) => (t === 0 ? rows.map(([label]) => [label, '']) : rows));
      expect(texts(out), lang).toEqual(expected);
    }
  });
});
