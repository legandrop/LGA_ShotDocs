import { paragraphProps } from '../ui/editorSchema';
import { builtinEn } from './builtin.en';
import { builtinEs } from './builtin.es';

// Las tres plantillas de fábrica (Docs/Doc_Plantillas.md, sección 2): viven en el código, en todos los workspaces y
// proyectos, y andan sin red. Solo usan bloques que ya conoce la versión mínima publicada (tablas con encabezado,
// títulos, párrafos, casillas, viñetas, párrafos de guion y preguntas): ningún tipo de bloque ni propiedad nueva.
// Se arman en el idioma de la interfaz al crearlas (PL9), como la página de práctica. Sin textos de ayuda adentro
// de la página: los rótulos de las tablas y de las viñetas son contenido; lo demás sale vacío.

export type BuiltinKind = 'prepro' | 'onset' | 'shot';

export const BUILTIN_KINDS: BuiltinKind[] = ['prepro', 'onset', 'shot'];

/**
 * Los ids de las de fábrica, para `pages.template_id` (informativo: de qué plantilla salió una página). Son uuid fijos:
 * no se cambian nunca (el reporte del día, entrega 2, deduce la carpeta de reportes por el de *On-Set Report*).
 */
export const BUILTIN_PREPRO = '5d1b7a0e-3c4f-4e8a-9b21-0f6c2a7d1e01';
export const BUILTIN_ONSET = '5d1b7a0e-3c4f-4e8a-9b21-0f6c2a7d1e02';
export const BUILTIN_SHOT = '5d1b7a0e-3c4f-4e8a-9b21-0f6c2a7d1e03';

export const BUILTIN_IDS: Record<BuiltinKind, string> = { prepro: BUILTIN_PREPRO, onset: BUILTIN_ONSET, shot: BUILTIN_SHOT };

/** El nombre de cada una en la dirección de la vista previa (`/practice?template=on-set`). */
export const BUILTIN_SLUGS: Record<BuiltinKind, string> = { prepro: 'pre-production', onset: 'on-set', shot: 'shot-breakdown' };

export function kindOfSlug(slug: string | null | undefined): BuiltinKind | null {
  const found = BUILTIN_KINDS.find((k) => BUILTIN_SLUGS[k] === slug);
  return found ?? null;
}

/** Una fila de una tabla de datos: el rótulo y, si hay, el valor que trae la plantilla. */
export type Row = [label: string, value?: string];

/** Los textos de las tres plantillas en un idioma (`builtin.en.ts`, `builtin.es.ts`). */
export interface BuiltinTexts {
  names: Record<BuiltinKind, string>;
  descriptions: Record<BuiltinKind, string>;
  /** La lista de trabajos de VFX (la misma en *Pre-production Notes* y en *Shot Breakdown*). */
  vfxWork: string[];
  questions: string;
  internal: string;
  prepro: {
    facts: Row[];
    script: string;
    summary: string;
    shotList: string;
    shotListHeader: string[];
    vfxWork: string;
    approach: string;
    approachItems: string[];
    elements: string;
    elementItems: string[];
    setNeeds: string;
    setNeedItems: string[];
    references: string;
    questionItems: string[];
    decisions: string;
    internalItems: string[];
  };
  onset: {
    facts: Row[];
    summary: string;
    camera: string;
    cameraHeader: string[];
    cameraRows: string[];
    setups: string;
    setupsHeader: string[];
    vfxShots: string;
    /** El título de cada plano de VFX: "Shot " (se completa el número; el H3 se duplica por plano). */
    shot: string;
    shotChecks: string[];
    light: string;
    lightHeader: string[];
    measurements: string;
    measurementsHeader: string[];
    measurementRows: string[];
    markers: string;
    markerItems: string[];
    photos: string;
    weather: string;
    weatherItems: string[];
    data: string;
    dataHeader: string[];
    dataRows: string[];
    issues: string;
    questionItems: string[];
  };
  shot: {
    facts: Row[];
    frame: string;
    vfxWork: string;
    technique: string;
    elements: string;
    elementsHeader: string[];
    shootData: string;
    shootDataRows: Row[];
    notes: string;
    notesHeader: string[];
    questionItems: string[];
    internalRows: Row[];
  };
}

export function builtinTexts(lang: string): BuiltinTexts {
  return lang === 'es' ? builtinEs : builtinEn;
}

// --- Los bloques -------------------------------------------------------------------------------------------------

/** Un bloque de BlockNote sin id: el editor le pone uno nuevo al insertarlo. */
export type TemplateBlock = Record<string, unknown>;

const h2 = (text: string): TemplateBlock => ({ type: 'heading', props: { level: 2 }, content: text });
const h3 = (text: string): TemplateBlock => ({ type: 'heading', props: { level: 3 }, content: text });
const p = (text = ''): TemplateBlock => ({ type: 'paragraph', content: text });
const script = (): TemplateBlock => ({ type: 'paragraph', props: paragraphProps('script'), content: '' });
const question = (text: string): TemplateBlock => ({ type: 'paragraph', props: paragraphProps('question'), content: text });
const checks = (items: string[]): TemplateBlock[] => items.map((text) => ({ type: 'checkListItem', props: { checked: false }, content: text }));
const bullets = (items: string[]): TemplateBlock[] => items.map((text) => ({ type: 'bulletListItem', content: text }));

/** La ficha de datos: 2 columnas, la primera como encabezado (un dato por fila). */
function facts(rows: Row[]): TemplateBlock {
  return {
    type: 'table',
    content: { type: 'tableContent', headerCols: 1, rows: rows.map(([label, value]) => ({ cells: [label, value ?? ''] })) },
  };
}

/** Una tabla con fila de encabezado y `empty` filas vacías (o con la primera celda de cada fila de `first`). */
function grid(header: string[], empty: number, first: string[] = []): TemplateBlock {
  const blank = (lead = '') => ({ cells: header.map((_, i) => (i === 0 ? lead : '')) });
  const rows = first.length ? first.map((lead) => blank(lead)) : Array.from({ length: empty }, () => blank());
  return { type: 'table', content: { type: 'tableContent', headerRows: 1, rows: [{ cells: header }, ...rows] } };
}

/** *Pre-production Notes*: una página por escena (sección 2.2). */
function prepro(t: BuiltinTexts): TemplateBlock[] {
  const x = t.prepro;
  return [
    facts(x.facts),
    h2(x.script),
    script(),
    h2(x.summary),
    p(),
    h2(x.shotList),
    grid(x.shotListHeader, 3),
    h2(x.vfxWork),
    ...checks(t.vfxWork),
    h2(x.approach),
    ...bullets(x.approachItems),
    h2(x.elements),
    ...checks(x.elementItems),
    h2(x.setNeeds),
    ...bullets(x.setNeedItems),
    h2(x.references),
    p(),
    h2(t.questions),
    ...x.questionItems.map(question),
    h2(x.decisions),
    ...bullets(['']),
    h2(t.internal),
    ...bullets(x.internalItems),
  ];
}

/** *On-Set Report*: una página por día de rodaje (sección 2.3). */
function onset(t: BuiltinTexts): TemplateBlock[] {
  const x = t.onset;
  return [
    facts(x.facts),
    h2(x.summary),
    p(),
    h2(x.camera),
    grid(x.cameraHeader, 0, x.cameraRows),
    h2(x.setups),
    grid(x.setupsHeader, 3),
    h2(x.vfxShots),
    h3(x.shot),
    ...checks(x.shotChecks),
    p(),
    h2(x.light),
    grid(x.lightHeader, 2),
    h2(x.measurements),
    grid(x.measurementsHeader, 0, x.measurementRows),
    p(),
    h2(x.markers),
    ...bullets(x.markerItems),
    p(),
    h2(x.photos),
    p(),
    h2(x.weather),
    ...bullets(x.weatherItems),
    h2(x.data),
    grid(x.dataHeader, 0, x.dataRows),
    h2(x.issues),
    ...checks(['']),
    h2(t.questions),
    ...x.questionItems.map(question),
  ];
}

/** *Shot Breakdown*: una página por plano de VFX (sección 2.4). */
function shot(t: BuiltinTexts): TemplateBlock[] {
  const x = t.shot;
  return [
    facts(x.facts),
    h2(x.frame),
    p(),
    h2(x.vfxWork),
    ...checks(t.vfxWork),
    h2(x.technique),
    p(),
    h2(x.elements),
    grid(x.elementsHeader, 2),
    h2(x.shootData),
    facts(x.shootDataRows),
    h2(x.notes),
    grid(x.notesHeader, 2),
    h2(t.questions),
    ...x.questionItems.map(question),
    h2(t.internal),
    facts(x.internalRows),
  ];
}

const BUILDERS: Record<BuiltinKind, (t: BuiltinTexts) => TemplateBlock[]> = { prepro, onset, shot };

/** Los bloques de una plantilla de fábrica, en un idioma. Cada llamada da objetos nuevos (sin ids). */
export function builtinBlocks(kind: BuiltinKind, lang: string): TemplateBlock[] {
  return BUILDERS[kind](builtinTexts(lang));
}
