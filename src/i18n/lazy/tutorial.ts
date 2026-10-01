import { register } from '../index';
import type { Dict } from '../types';

// La página de práctica y la recorrida (Docs/Doc_Tutorial.md, secciones 3 y 4): se bajan aparte, con
// PracticeView.tsx y TourLayer.tsx. Los atajos van como `{nombre}` y salen del registro (shortcuts.ts).

export const tutorial = {
  // --- La página de práctica ---
  'practice.banner': {
    en: "Practice page: nothing you do here is saved or seen by anyone.",
    es: "Página de práctica: lo que hagas acá no se guarda ni lo ve nadie.",
  },
  'practice.startOver': { en: "Start over", es: "Empezar de nuevo" },
  'practice.exit': { en: "Exit", es: "Salir" },
  'practice.exitLong': { en: "Exit the practice page", es: "Salir de la práctica" },
  'practice.crumb': { en: "Practice", es: "Práctica" },
  'practice.noFiles': {
    en: "Files aren't uploaded on the practice page: try the sample photos.",
    es: "En la práctica no se suben archivos: probá con las fotos de ejemplo.",
  },

  // --- La recorrida ---
  'tour.label': { en: "Tour", es: "Recorrida" },
  'tour.live': { en: "Step {n} of {total}: {title}", es: "Paso {n} de {total}: {title}" },
  'tour.next': { en: "Next", es: "Siguiente" },
  'tour.back': { en: "Back", es: "Atrás" },
  'tour.finish': { en: "Finish", es: "Terminar" },
  'tour.skip': { en: "Skip tour", es: "Saltar recorrida" },
  'tour.replay': {
    en: "You can take the tour again from the help (?).",
    es: "Podés volver a verla desde la ayuda (?).",
  },
  'tour.paused': { en: "Tour paused", es: "Recorrida en pausa" },
  'tour.continue': { en: "Continue", es: "Seguir" },
  'tour.resume': { en: "Continue the tour?", es: "¿Seguimos la recorrida?" },
  'tour.stepOf': { en: "Step {n} of {total}", es: "Paso {n} de {total}" },
  'tour.end': { en: "End", es: "Terminar" },
  'tour.invite': { en: "First time here? A two-minute tour", es: "¿Primera vez? Recorrida de 2 minutos" },
  'tour.start': { en: "Start", es: "Empezar" },
  'tour.notNow': { en: "Not now", es: "Ahora no" },

  // --- Los pasos (src/tutorial/steps.ts) ---
  'tour.hello.title': { en: "Hi!", es: "¡Hola!" },
  'tour.hello.text': {
    en: "This is a practice page: write, move and delete anything, nothing is saved and nobody else sees it. Here's the tour, two minutes.",
    es: "Esta es una página de práctica: podés escribir, mover y borrar lo que quieras, no se guarda ni lo ve nadie. Te muestro lo principal en dos minutos.",
  },
  'tour.pages.title': { en: "Your pages", es: "Tus páginas" },
  'tour.pages.text': {
    en: "Your project's pages live here, nested. + creates one; drag to reorder.",
    es: "Acá están las páginas del proyecto, unas adentro de otras. Con + creás una; arrastrándolas las ordenás.",
  },
  'tour.projects.title': { en: "Projects", es: "Proyectos" },
  'tour.projects.text': {
    en: "A workspace has several projects. Switch or create one here; {search} finds pages and projects.",
    es: "Un workspace tiene varios proyectos. Acá cambiás de proyecto o creás uno; {search} busca páginas y proyectos.",
  },
  'tour.projects.textPhone': {
    en: "A workspace has several projects. Switch or create one here.",
    es: "Un workspace tiene varios proyectos. Acá cambiás de proyecto o creás uno.",
  },
  'tour.slash.title': { en: "The / menu", es: "El menú /" },
  'tour.slash.text': {
    en: "Type / on an empty line: headings, lists, tables, script, questions and images. Drag a block by its ⋮⋮ handle.",
    es: "Escribí / en un renglón vacío: títulos, listas, tablas, guion, preguntas y fotos. Con ⋮⋮, al costado, arrastrás un bloque.",
  },
  'tour.photos.title': { en: "Images", es: "Fotos" },
  'tour.photos.text': {
    en: "Photos go in the line, like letters: you can write right next to them. One click selects one, another opens it full screen; its bar sets the size or arranges them in rows.",
    es: "Las fotos van en el renglón, como letras: podés escribir al lado. Un clic elige una y otro la abre en grande; en su barra elegís el tamaño o las acomodás en filas.",
  },
  'tour.photos.textDrive': {
    en: "Photos go in the line, like letters: you can write right next to them. One click selects one, another opens it full screen; its bar sets the size or arranges them in rows. With Google Drive connected, drop any file (PDF, zip) to attach it.",
    es: "Las fotos van en el renglón, como letras: podés escribir al lado. Un clic elige una y otro la abre en grande; en su barra elegís el tamaño o las acomodás en filas. Con Google Drive conectado, soltá cualquier archivo (PDF, zip) y queda como tarjeta.",
  },
  'tour.photos.textPhone': {
    en: "Photos go in the line, like letters. Tap one to see it full screen; back on the page, tap it again for its bar: size, or arrange them in rows.",
    es: "Las fotos van en el renglón, como letras. Tocá una para verla en grande; de vuelta en la página, tocala otra vez y aparece su barra: tamaño o acomodarlas en filas.",
  },
  'tour.comments.title': { en: "Comments and questions", es: "Comentarios y preguntas" },
  'tour.comments.text': {
    en: "Comment on any block ({comment}); all threads are here. A question, like the one above, can be answered by anyone who can comment.",
    es: "Comentá cualquier bloque ({comment}) y acá ves todos los hilos. Una pregunta, como la del ejemplo, la puede contestar quien solo comenta.",
  },
  'tour.comments.textPhone': {
    en: "Comment on any block; all threads are here. A question, like the one above, can be answered by anyone who can comment.",
    es: "Comentá cualquier bloque y acá ves todos los hilos. Una pregunta, como la del ejemplo, la puede contestar quien solo comenta.",
  },
  'tour.find.title': { en: "Find", es: "Buscar" },
  'tour.find.text': { en: "Find and replace in the page ({find}).", es: "Buscá y reemplazá en la página ({find})." },
  'tour.pageMenu.title': { en: "The page", es: "La página" },
  'tour.pageMenu.text': {
    en: "Share, move, page size and Export PDF ({print}).",
    es: "Compartir, mover, tamaño de hoja y Exportar PDF ({print}).",
  },
  'tour.pageMenu.textPhone': {
    en: "Share, move, page size and Export PDF.",
    es: "Compartir, mover, tamaño de hoja y Exportar PDF.",
  },
  'tour.sync.title': { en: "Always saved", es: "Siempre guardado" },
  'tour.sync.text': {
    en: "Everything is saved on your device first and uploads by itself, even offline. This shows if anything is pending.",
    es: "Todo se guarda primero en tu dispositivo y se sube solo, también sin red. Acá ves si falta subir algo.",
  },
  'tour.help.title': { en: "Help", es: "Ayuda" },
  'tour.help.text': {
    en: "Everything is explained here, with every shortcut. You can replay this tour from here.",
    es: "Acá está todo explicado, con todos los atajos. Desde acá podés volver a ver esta recorrida.",
  },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(tutorial);
