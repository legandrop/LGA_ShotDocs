import { paragraphProps } from '../ui/editorSchema';
import { ROW_WIDTH_PROP } from '../ui/imageRowsEditor';

// Lo común de las plantillas de la página de práctica (practice.es.ts y practice.en.ts): los ids de los bloques
// que señala la recorrida, las fotos de ejemplo y la forma de cada bloque. Solo tipos de bloque que ya existen
// (párrafo con Script o pregunta como propiedad, títulos, casillas, `image`, tabla): la regla del editor.

/** El id de la página de práctica (no es una página del árbol: nunca llega a la base ni al servidor). */
export const PRACTICE_ID = 'practice';

/** Los bloques que señala la recorrida (`data-id` de BlockNote) y la pregunta con su hilo de ejemplo. */
export const PRACTICE_BLOCKS = {
  question: 'practice-question',
  photos: ['practice-photo-1', 'practice-photo-2', 'practice-photo-3'],
  empty: 'practice-empty',
} as const;

/**
 * Las fotos vienen con la app (`public/tutorial/`, un contrato público: no se renombran ni se borran) y van con la
 * dirección absoluta: el carrete y lo que se copia a una página real las toman como fotos web.
 */
export function practicePhotoUrl(name: string, origin = typeof location !== 'undefined' ? location.origin : ''): string {
  return `${origin}/tutorial/${name}`;
}

/** Las tres fotos de la fila: ancho / alto de cada una (3:2, 2:3 y 16:9), así la fila queda pareja. */
const PHOTOS = [
  { file: 'terraza-1.webp', aspect: 1200 / 800 },
  { file: 'terraza-2.webp', aspect: 800 / 1200 },
  { file: 'terraza-3.webp', aspect: 1200 / 675 },
];

/** El `rowWidth` de cada foto de una fila, como "Acomodar en filas": todas a la misma altura. */
function rowWidths(aspects: number[]): number[] {
  const total = aspects.reduce((a, b) => a + b, 0);
  return aspects.map((a) => Math.floor((a / total) * 1e4) / 1e4);
}

export interface PracticeTexts {
  title: string;
  brief: [string, string, string];
  linkText: string;
  linkUrl: string;
  tasksTitle: string;
  tasks: [string, string, string];
  scene: string;
  action: string;
  question: string;
  /** El hilo de ejemplo de la pregunta: la respuesta y una respuesta a la respuesta. */
  answer: string;
  answerReply: string;
  takesTitle: string;
  takes: string[][];
  notesTitle: string;
  notes: string;
}

/** Los bloques de BlockNote de la plantilla, con sus ids fijos. */
export function practiceBlocks(texts: PracticeTexts, origin?: string): unknown[] {
  const widths = rowWidths(PHOTOS.map((p) => p.aspect));
  return [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: texts.brief[0], styles: {} },
        { type: 'text', text: texts.brief[1], styles: { bold: true } },
        { type: 'text', text: texts.brief[2], styles: {} },
        { type: 'link', href: texts.linkUrl, content: [{ type: 'text', text: texts.linkText, styles: {} }] },
        { type: 'text', text: '.', styles: {} },
      ],
    },
    { type: 'heading', props: { level: 3 }, content: texts.tasksTitle },
    { type: 'checkListItem', props: { checked: true }, content: texts.tasks[0] },
    { type: 'checkListItem', props: { checked: false }, content: texts.tasks[1] },
    { type: 'checkListItem', props: { checked: false }, content: texts.tasks[2] },
    { type: 'paragraph', props: paragraphProps('script'), content: texts.scene },
    { type: 'paragraph', props: paragraphProps('script'), content: texts.action },
    { id: PRACTICE_BLOCKS.question, type: 'paragraph', props: paragraphProps('question'), content: texts.question },
    ...PHOTOS.map((photo, i) => ({
      id: PRACTICE_BLOCKS.photos[i],
      type: 'image',
      props: { url: practicePhotoUrl(photo.file, origin), name: photo.file, caption: '', [ROW_WIDTH_PROP]: widths[i] },
    })),
    { type: 'heading', props: { level: 3 }, content: texts.takesTitle },
    { type: 'table', content: { type: 'tableContent', headerRows: 1, rows: texts.takes.map((cells) => ({ cells })) } },
    { id: PRACTICE_BLOCKS.empty, type: 'paragraph', content: '' },
    { type: 'heading', props: { level: 2 }, content: texts.notesTitle },
    { type: 'paragraph', content: texts.notes },
  ];
}
