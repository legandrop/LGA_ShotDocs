// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { PageTree } from '../sync/tree';
import type { PageRow } from '../sync/types';
import { builtinBlocks, BUILTIN_ONSET as FROM_BUILTIN, type TemplateBlock } from './builtin';
import { BUILTIN_ONSET, BUILTIN_SHOT } from './builtinIds';
import {
  dateAtStart,
  dateWithWeekday,
  dayInTitle,
  dayName,
  dayReportFolderOf,
  dayReportsMark,
  factKeyOf,
  fillReport,
  firstNumber,
  isDayReportFolder,
  isDayReportShortcut,
  isValidDate,
  localDate,
  readFacts,
  reportTitle,
} from './dayReport';

// El reporte del día (Docs/Doc_Plantillas.md, sección 6): la fecha local, el nombre, los rótulos en los dos idiomas, lo
// que se copia del reporte anterior, la carpeta de reportes (marcada, deducida, dejada a mano) y el atajo.

const TZ = process.env.TZ;
afterEach(() => {
  if (TZ === undefined) delete process.env.TZ;
  else process.env.TZ = TZ;
});

describe('la fecha y el nombre', () => {
  it('la fecha es la del dispositivo (hora local): a las 23:30 en Buenos Aires sigue siendo hoy', () => {
    process.env.TZ = 'America/Argentina/Buenos_Aires';
    // 2026-10-03 02:30 UTC = 2026-10-02 23:30 en Buenos Aires.
    expect(localDate(new Date('2026-10-03T02:30:00Z'))).toBe('2026-10-02');
    // 00:30 en Buenos Aires: ya es el día siguiente (el nocturno se corrige en el campo, PL6).
    expect(localDate(new Date('2026-10-03T03:30:00Z'))).toBe('2026-10-03');
    process.env.TZ = 'UTC';
    expect(localDate(new Date('2026-10-03T02:30:00Z'))).toBe('2026-10-03');
  });

  it('el título es la fecha y el día con dos cifras, en el idioma del contenido (PL7)', () => {
    expect(reportTitle('2026-10-02', 6, 'en')).toBe('2026-10-02 | Day 06');
    expect(reportTitle('2026-10-02', 6, 'es')).toBe('2026-10-02 | Día 06');
    expect(reportTitle('2026-10-02', 112, 'en')).toBe('2026-10-02 | Day 112');
    expect(dayName(1, 'es')).toBe('Día 01');
  });

  it('la fila Date lleva el día de la semana en el idioma del contenido', () => {
    expect(dateWithWeekday('2026-10-02', 'en')).toBe('2026-10-02 · Fri');
    expect(dateWithWeekday('2026-10-02', 'es')).toBe('2026-10-02 · vie');
    expect(dateWithWeekday('no es fecha', 'en')).toBe('no es fecha');
  });

  it('lee la fecha y el día de un título o de una fila', () => {
    expect(dateAtStart('2026-10-02 | Day 06')).toBe('2026-10-02');
    expect(dateAtStart('  2026-10-02 · Fri')).toBe('2026-10-02');
    expect(dateAtStart('2026-02-30 | Day 1')).toBeNull();
    expect(dateAtStart('Call sheets')).toBeNull();
    expect(dateAtStart('20261002')).toBeNull();
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(dayInTitle('2026-10-02 | Day 06')).toBe(6);
    expect(dayInTitle('2026-10-02 | Día 6')).toBe(6);
    expect(dayInTitle('2026-10-02 | Dia 12')).toBe(12);
    expect(dayInTitle('Holiday 3')).toBeNull();
    expect(dayInTitle('2026-10-02')).toBeNull();
    expect(firstNumber('Day 7')).toBe(7);
    expect(firstNumber('')).toBeNull();
  });
});

type Table = { rows: { cells: unknown[] }[] };
const factsOf = (blocks: TemplateBlock[]) => (blocks[0].content as Table).rows;
const cellText = (cell: unknown): string => {
  const c = cell as { type?: string; content?: unknown };
  const content = c && typeof c === 'object' && c.type === 'tableCell' ? c.content : cell;
  return typeof content === 'string' ? content : JSON.stringify(content);
};
const valueOf = (blocks: TemplateBlock[], label: string) => cellText(factsOf(blocks).find((r) => r.cells[0] === label)?.cells[1]);

/** Un reporte "de ayer" como lo daría el lector de BlockNote: celdas `tableCell` con contenido en línea. */
function yesterday(lang: 'en' | 'es', values: Record<string, unknown>, cameraBody = 'ARRI Alexa 35'): TemplateBlock[] {
  const blocks = builtinBlocks('onset', lang);
  const rows = factsOf(blocks);
  for (const row of rows) {
    const label = row.cells[0] as string;
    row.cells = [
      { type: 'tableCell', props: {}, content: [{ type: 'text', text: label, styles: {} }] },
      { type: 'tableCell', props: {}, content: label in values ? values[label] : [] },
    ];
  }
  const camera = blocks.find((b, i) => b.type === 'table' && i > 0) as { content: Table };
  camera.content.rows[1].cells[1] = cameraBody;
  return blocks;
}

describe('leer el reporte anterior y llenar el nuevo (6.4)', () => {
  it('lee las filas por su rótulo, en los dos idiomas, y la tabla Camera package', () => {
    const text = (t: string) => [{ type: 'text', text: t, styles: {} }];
    const en = readFacts(
      yesterday('en', { Date: text('2026-10-01 · Thu'), 'Shoot day': text('5'), Location: text('Estancia La Paz – galpón') }) as never,
    );
    expect(en.date).toBe('2026-10-01');
    expect(en.day).toBe(5);
    expect(en.location).toBe('Estancia La Paz – galpón');
    expect(JSON.stringify(en.camera)).toContain('ARRI Alexa 35');
    const es = readFacts(yesterday('es', { Fecha: text('2026-10-01'), 'Día de rodaje': text('Día 5'), Locación: text('Galpón') }) as never);
    expect([es.date, es.day, es.location]).toEqual(['2026-10-01', 5, 'Galpón']);
    expect(JSON.stringify(es.camera)).toContain('ARRI Alexa 35');
  });

  it('una fila renombrada queda vacía: nunca se adivina', () => {
    const blocks = yesterday('en', { Place: 'x' });
    const rows = factsOf(blocks);
    (rows[2].cells[0] as { content: unknown }).content = [{ type: 'text', text: 'Where we shot', styles: {} }];
    (rows[2].cells[1] as { content: unknown }).content = [{ type: 'text', text: 'Galpón', styles: {} }];
    expect(readFacts(blocks as never).location).toBe('');
    expect(factKeyOf('  LOCACIÓN: ')).toBe('location');
    expect(factKeyOf('Lugar')).toBe('location');
    expect(factKeyOf('Where we shot')).toBeNull();
  });

  it('el nuevo lleva fecha, día y locación, y copia unidad, VFX, director y DP, y el equipo de cámara', () => {
    const bold = [{ type: 'text', text: 'Lega', styles: { bold: true } }];
    const prev = readFacts(
      yesterday('en', {
        Location: [{ type: 'text', text: 'Galpón', styles: {} }],
        Unit: [{ type: 'text', text: '2nd unit', styles: {} }],
        'VFX on set': bold,
        'Director · DP': [{ type: 'text', text: 'Ana · Beto', styles: {} }],
      }) as never,
    );
    const base = builtinBlocks('onset', 'es');
    const filled = fillReport(base, { date: '2026-10-02', day: 6, location: 'Galpón 2', previous: prev }, 'es');
    expect(valueOf(filled, 'Fecha')).toBe('2026-10-02 · vie');
    expect(valueOf(filled, 'Día de rodaje')).toBe('6');
    expect(valueOf(filled, 'Locación')).toBe('Galpón 2');
    expect(valueOf(filled, 'Unidad')).toContain('2nd unit');
    expect(valueOf(filled, 'VFX en set')).toContain('"bold":true');
    expect(valueOf(filled, 'Director · DF')).toContain('Ana · Beto');
    // Lo demás sale vacío de la plantilla.
    expect(valueOf(filled, 'Clima')).toBe('');
    expect(JSON.stringify(filled)).toContain('ARRI Alexa 35');
    // La plantilla no cambió.
    expect(JSON.stringify(base)).not.toContain('ARRI');
    expect(builtinBlocks('onset', 'es')).toEqual(base);
  });

  it('sin reporte anterior: fecha y día; la unidad queda la de la plantilla', () => {
    const filled = fillReport(builtinBlocks('onset', 'en'), { date: '2026-10-02', day: 1, location: '', previous: null }, 'en');
    expect(valueOf(filled, 'Shoot day')).toBe('1');
    expect(valueOf(filled, 'Unit')).toBe('Main unit');
    expect(valueOf(filled, 'Location')).toBe('');
  });

  it('una unidad vacía ayer no borra la de la plantilla', () => {
    const prev = readFacts(yesterday('en', {}) as never);
    const filled = fillReport(builtinBlocks('onset', 'en'), { date: '2026-10-02', day: 2, location: '', previous: prev }, 'en');
    expect(valueOf(filled, 'Unit')).toBe('Main unit');
  });
});

// --- La carpeta de reportes ----------------------------------------------------------------------------------------

/** Un árbol en memoria (sin base local): solo para leer, como lo ve la barra lateral. */
function treeOf(rows: Partial<PageRow>[]): PageTree {
  const db = {
    getAll: async () => [],
    get: async () => undefined,
  } as never;
  const tree = new PageTree(db, 'p');
  const full = rows.map(
    (r, i): PageRow => ({
      id: r.id!,
      workspace_id: 'p',
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
  (tree as unknown as { snapshot: Map<string, PageRow> }).snapshot = new Map(full.map((r) => [r.id, r]));
  (tree as unknown as { recompute(): void }).recompute();
  return tree;
}

describe('la carpeta de reportes (6.2)', () => {
  it('el id de On-Set Report de la primera carga es el de la plantilla', () => {
    expect(BUILTIN_ONSET).toBe(FROM_BUILTIN);
  });

  it('marcada, deducida de los reportes de adentro, y dejada a mano', () => {
    const tree = treeOf([
      { id: 'marked', title: 'Reportes', settings: { dayReports: {} } },
      { id: 'lost', title: 'Unidad 2' },
      { id: 'r1', parent_id: 'lost', title: '2026-10-01 | Day 01', template_id: BUILTIN_ONSET },
      { id: 'stopped', title: 'Viejos', settings: { dayReports: false } },
      { id: 'r2', parent_id: 'stopped', title: '2026-09-01 | Day 01', template_id: BUILTIN_ONSET },
      { id: 'undone', title: 'Escenas' },
      // Se deshizo la plantilla: queda el template_id pero no la fecha en el título.
      { id: 'u1', parent_id: 'undone', title: 'Escena 12', template_id: BUILTIN_ONSET },
      { id: 'shots', title: 'Planos' },
      { id: 's1', parent_id: 'shots', title: '2026-10-01 | 012_010', template_id: BUILTIN_SHOT },
      { id: 'trashed', title: 'Borrados' },
      { id: 't1', parent_id: 'trashed', title: '2026-10-01 | Day 01', template_id: BUILTIN_ONSET, deleted_at: '2026-10-02' },
    ]);
    expect(isDayReportFolder(tree, 'marked')).toBe(true);
    expect(isDayReportFolder(tree, 'lost')).toBe(true);
    expect(isDayReportFolder(tree, 'stopped')).toBe(false);
    expect(isDayReportFolder(tree, 'undone')).toBe(false);
    expect(isDayReportFolder(tree, 'shots')).toBe(false);
    expect(isDayReportFolder(tree, 'trashed')).toBe(false);
    expect(dayReportsMark(tree.get('marked'))).toBe('on');
    expect(dayReportsMark(tree.get('stopped'))).toBe('off');
    expect(dayReportsMark(tree.get('lost'))).toBeNull();
    // El botón: en la carpeta y en cada reporte de adentro.
    expect(dayReportFolderOf(tree, 'lost')).toBe('lost');
    expect(dayReportFolderOf(tree, 'r1')).toBe('lost');
    expect(dayReportFolderOf(tree, 'r2')).toBeNull();
    expect(dayReportFolderOf(tree, 'u1')).toBeNull();
  });

  it('una marca con forma rara (de otra versión) cuenta como sin marca', () => {
    const tree = treeOf([{ id: 'x', title: 'X', settings: { dayReports: 'sí' as never } }]);
    expect(dayReportsMark(tree.get('x'))).toBeNull();
    expect(isDayReportFolder(tree, 'x')).toBe(false);
  });
});

describe('el atajo (B1)', () => {
  const ev = (o: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; code: string; key: string; altGr: boolean }>) => ({
    ctrlKey: false,
    metaKey: false,
    altKey: true,
    shiftKey: true,
    code: 'KeyN',
    key: 'N',
    ...o,
    getModifierState: (k: string) => k === 'AltGraph' && !!o.altGr,
  });
  it('⌘⌥⇧N en la Mac (aunque ⌥ cambie la letra), Ctrl+Alt+Shift+N en Windows', () => {
    expect(isDayReportShortcut(ev({ metaKey: true, key: '˜' }), true)).toBe(true);
    expect(isDayReportShortcut(ev({ ctrlKey: true }), false)).toBe(true);
    // Un teclado ruso: la letra es otra, la posición es la N.
    expect(isDayReportShortcut(ev({ ctrlKey: true, key: 'Т' }), false)).toBe(true);
    // Nunca Ctrl en la Mac, ni ⌘ en Windows.
    expect(isDayReportShortcut(ev({ ctrlKey: true }), true)).toBe(false);
    expect(isDayReportShortcut(ev({ metaKey: true }), false)).toBe(false);
    // Sin Shift es otro (⌘⌥N es Open split view de Chrome en la Mac).
    expect(isDayReportShortcut(ev({ metaKey: true, shiftKey: false }), true)).toBe(false);
  });
  it('con AltGr no es el atajo (un teclado polaco escribe ń)', () => {
    expect(isDayReportShortcut(ev({ ctrlKey: true, altGr: true, key: 'Ń' }), false)).toBe(false);
  });
});
