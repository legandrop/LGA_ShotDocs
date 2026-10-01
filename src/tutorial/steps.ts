import type { Key } from '../i18n';
import '../i18n/lazy/tutorial';
import type { Side } from '../ui/floating';
import { PRACTICE_BLOCKS } from './practiceTemplate';

// Los pasos de la recorrida (Docs/Doc_Tutorial.md, sección 4): diez en la computadora, nueve en el teléfono. Cada
// paso señala un ancla puesta a propósito (`data-tour="…"` en el componente, nunca una clase de CSS) o bloques de
// la plantilla de la práctica (por su id). Regla del repo: si cambia algo que señala un paso, el paso cambia en la
// misma tanda; una prueba revisa que cada `data-tour` de acá exista en `src/ui/`.

export type TourAnchor =
  /** El elemento con `data-tour="…"` que se ve (en el teléfono, el de la barra de arriba o el del cajón). */
  | { tour: string }
  /** Bloques de la página de práctica (`data-id` de BlockNote): el foco de luz los abarca a todos. */
  | { blocks: readonly string[] };

export interface TourStep {
  id: string;
  /** `null`: el globito va centrado, sin foco de luz. */
  anchor: TourAnchor | null;
  layout: 'all' | 'desktop' | 'phone';
  /** En el teléfono, lo señalado está en el cajón: se abre antes y se cierra después. */
  drawer?: boolean;
  /**
   * El paso deja tocar lo señalado (no oscurece ni tapa nada) y avanza solo cuando pasa algo: `slash`, se abrió el
   * menú "/". El foco va a la página (el renglón vacío), no al globito.
   */
  interactive?: 'slash';
  title: Key;
  text: Key;
  /** En el teléfono (sin atajos, o con otro gesto). */
  textPhone?: Key;
  /** Con Google Drive conectado (corrección 17: los adjuntos solo se nombran si se pueden usar). */
  textDrive?: Key;
  /** Los atajos del texto: `{nombre}` → id del registro (shortcuts.ts). */
  keys?: Record<string, string>;
  /** Dónde va el globito respecto del ancla, en orden de preferencia (en la computadora). */
  sides?: Side[];
}

export const TOUR_STEPS: TourStep[] = [
  { id: 'hello', anchor: null, layout: 'all', title: 'tour.hello.title', text: 'tour.hello.text' },
  { id: 'pages', anchor: { tour: 'pages' }, layout: 'all', drawer: true, title: 'tour.pages.title', text: 'tour.pages.text' },
  {
    id: 'project-switcher',
    anchor: { tour: 'project-switcher' },
    layout: 'all',
    drawer: true,
    title: 'tour.projects.title',
    text: 'tour.projects.text',
    textPhone: 'tour.projects.textPhone',
    keys: { search: 'search' },
  },
  {
    id: 'slash',
    anchor: { blocks: [PRACTICE_BLOCKS.empty] },
    layout: 'all',
    interactive: 'slash',
    // El menú "/" se abre abajo del renglón: el globito, arriba.
    sides: ['above', 'right', 'left', 'below'],
    title: 'tour.slash.title',
    text: 'tour.slash.text',
  },
  {
    id: 'practice-photos',
    anchor: { blocks: PRACTICE_BLOCKS.photos },
    layout: 'all',
    title: 'tour.photos.title',
    text: 'tour.photos.text',
    textDrive: 'tour.photos.textDrive',
    textPhone: 'tour.photos.textPhone',
  },
  {
    id: 'comments',
    anchor: { tour: 'comments' },
    layout: 'all',
    title: 'tour.comments.title',
    text: 'tour.comments.text',
    textPhone: 'tour.comments.textPhone',
    keys: { comment: 'comment' },
  },
  // En el teléfono no va (un paso menos: buscar en la página se explica en la ayuda).
  { id: 'find', anchor: { tour: 'find' }, layout: 'desktop', title: 'tour.find.title', text: 'tour.find.text', keys: { find: 'find' } },
  {
    id: 'page-menu',
    anchor: { tour: 'page-menu' },
    layout: 'all',
    title: 'tour.pageMenu.title',
    text: 'tour.pageMenu.text',
    textPhone: 'tour.pageMenu.textPhone',
    keys: { print: 'print' },
  },
  // En el teléfono, el ícono de la barra de arriba (el de la barra lateral queda en el cajón cerrado).
  { id: 'sync', anchor: { tour: 'sync' }, layout: 'all', title: 'tour.sync.title', text: 'tour.sync.text' },
  { id: 'help', anchor: { tour: 'help' }, layout: 'all', drawer: true, title: 'tour.help.title', text: 'tour.help.text' },
];

/** Los pasos de este diseño (computadora o teléfono): con ellos se cuenta "3/10", así el número nunca salta. */
export function stepsFor(phone: boolean): TourStep[] {
  return TOUR_STEPS.filter((s) => s.layout === 'all' || s.layout === (phone ? 'phone' : 'desktop'));
}
