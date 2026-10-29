import '../i18n/lazy/tutorial';
import type { Stage } from '../relations/projectStructure';
import type { Condition } from '../tour/conditions';
import type { Text } from '../tour/catalog';
import type { Side } from '../ui/floating';
import { PRACTICE_BLOCKS } from './practiceTemplate';

// Los pasos de la recorrida de la app, *Getting around* (Docs/Doc_Tutorial.md, sección 4): diez en la computadora, nueve
// en el teléfono, en tres capítulos (src/tour/catalog.ts). Cada paso señala un ancla puesta a propósito (`data-tour="…"`
// en el componente, nunca una clase de CSS) o bloques de la plantilla de la práctica (por su id). Regla del repo: si
// cambia algo que señala un paso, el paso cambia en la misma tanda; una prueba revisa que cada `data-tour` exista en el
// código. El tipo `TourStep` es el de todos los pasos del catálogo (el formato está explicado en catalog.ts).

export type TourAnchor =
  /**
   * Los elementos con `data-tour="…"` que se ven (en el teléfono, el de la barra de arriba o el del cajón): el foco
   * de luz los abarca a todos (el árbol: su título con el "+" y la lista).
   */
  | { tour: string }
  /** Bloques de la página de práctica (`data-id` de BlockNote): el foco de luz los abarca a todos. */
  | { blocks: readonly string[] }
  /** Las filas del árbol de las carpetas de esas etapas, en el proyecto de práctica (src/tour/world.ts). */
  | { page: readonly Stage[] }
  /** La ficha de la página abierta: la primera tabla del editor (los campos de una escena o una locación). */
  | { fields: true };

export interface TourStep {
  id: string;
  /**
   * `info`: explica, *Next* prendido y la app tapada. `do`: la persona hace la acción en la app (que queda a mano); el
   * paso se cumple solo con `until` y *Next* nunca la hace. `card`: tarjeta centrada, sin ancla.
   */
  mode: 'info' | 'do' | 'card';
  /** `null`: el globito va centrado, sin foco de luz. */
  anchor: TourAnchor | null;
  layout: 'all' | 'desktop' | 'phone';
  /** En el teléfono, lo señalado está en el cajón: se abre antes y se cierra después. */
  drawer?: boolean;
  /** El paso del menú "/": antes, el cursor va al renglón vacío de la práctica (y en «Show me» el menú no lo termina). */
  interactive?: 'slash';
  title: Text;
  text: Text;
  /** En el teléfono (sin atajos, o con otro gesto). */
  textPhone?: Text;
  /** Con Google Drive conectado (corrección 17: los adjuntos solo se nombran si se pueden usar). */
  textDrive?: Text;
  /** Paso `do`: lo que hay que hacer, después de «Do this:» (`**negrita**` para el control). */
  turn?: Text;
  /** Paso `do`: cuándo está hecho (una condición de src/tour/conditions.ts). */
  until?: Condition;
  /** Los atajos del texto: `{nombre}` → id del registro (shortcuts.ts). */
  keys?: Record<string, string>;
  /** Dónde va el globito respecto del ancla, en orden de preferencia (en la computadora). */
  sides?: Side[];
}

const SIDEBAR: Side[] = ['right', 'below', 'above', 'left'];

export const TOUR_STEPS: TourStep[] = [
  { id: 'hello', mode: 'card', anchor: null, layout: 'all', title: 'tour.hello.title', text: 'tour.hello.text' },
  // Lo de la barra lateral: el globito a la derecha, así no tapa el árbol.
  { id: 'pages', mode: 'info', anchor: { tour: 'pages' }, layout: 'all', drawer: true, sides: SIDEBAR, title: 'tour.pages.title', text: 'tour.pages.text' },
  {
    id: 'project-switcher',
    mode: 'info',
    anchor: { tour: 'project-switcher' },
    layout: 'all',
    drawer: true,
    sides: SIDEBAR,
    title: 'tour.projects.title',
    text: 'tour.projects.text',
    textPhone: 'tour.projects.textPhone',
    keys: { search: 'search' },
  },
  {
    id: 'slash',
    mode: 'do',
    anchor: { blocks: [PRACTICE_BLOCKS.empty] },
    layout: 'all',
    interactive: 'slash',
    turn: 'tour.slash.turn',
    // Se cumple cuando el menú se cierra después de usarlo (se eligió algo o Esc): avanzar al abrirse lo cerraría.
    until: { what: 'slashUsed' },
    // El menú "/" se abre abajo del renglón: el globito, arriba.
    sides: ['above', 'right', 'left', 'below'],
    title: 'tour.slash.title',
    text: 'tour.slash.text',
  },
  {
    id: 'practice-photos',
    mode: 'info',
    anchor: { blocks: [PRACTICE_BLOCKS.photos] },
    layout: 'all',
    title: 'tour.photos.title',
    text: 'tour.photos.text',
    textDrive: 'tour.photos.textDrive',
    textPhone: 'tour.photos.textPhone',
  },
  {
    id: 'comments',
    mode: 'info',
    anchor: { tour: 'comments' },
    layout: 'all',
    title: 'tour.comments.title',
    text: 'tour.comments.text',
    textPhone: 'tour.comments.textPhone',
    keys: { comment: 'comment' },
  },
  // En el teléfono no va en la recorrida (un paso menos: buscar en la página se explica en la ayuda); "Mostrame" sí lo
  // muestra ahí, con el texto sin atajo.
  { id: 'find', mode: 'info', anchor: { tour: 'find' }, layout: 'desktop', title: 'tour.find.title', text: 'tour.find.text', textPhone: 'tour.find.textPhone', keys: { find: 'find' } },
  {
    id: 'page-menu',
    mode: 'info',
    anchor: { tour: 'page-menu' },
    layout: 'all',
    title: 'tour.pageMenu.title',
    text: 'tour.pageMenu.text',
    textPhone: 'tour.pageMenu.textPhone',
    keys: { print: 'print' },
  },
  // En el teléfono, el ícono de la barra de arriba (el de la barra lateral queda en el cajón cerrado).
  { id: 'sync', mode: 'info', anchor: { tour: 'sync' }, layout: 'all', sides: SIDEBAR, title: 'tour.sync.title', text: 'tour.sync.text' },
  { id: 'help', mode: 'info', anchor: { tour: 'help' }, layout: 'all', drawer: true, title: 'tour.help.title', text: 'tour.help.text' },
];

/** Los pasos de este diseño (computadora o teléfono), todos seguidos (las pruebas los cuentan). */
export function stepsFor(phone: boolean): TourStep[] {
  return TOUR_STEPS.filter((s) => s.layout === 'all' || s.layout === (phone ? 'phone' : 'desktop'));
}
