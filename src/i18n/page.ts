import type { Dict } from './types';

// La página abierta: título, encabezado, avisos del editor y tipos de texto.

export const page = {
  'page.looking': { en: "Looking for the page…", es: "Buscando la página…" },
  'page.notFound': {
    en: "This page does not exist or you do not have access to it.",
    es: "Esta página no existe o no tenés acceso.",
  },
  'page.inTrash': { en: "This page is in the trash.", es: "Esta página está en la papelera." },
  'page.insideTrashed': {
    en: "This page is inside “{title}”, which is in the trash.",
    es: "Esta página está adentro de “{title}”, que está en la papelera.",
  },
  'page.restoreNamed': { en: "Restore “{title}”", es: "Restaurar “{title}”" },
  'page.loadingEditor': { en: "Loading the editor", es: "Cargando el editor" },
  // La barrera de error de la página (ui/ErrorBarrier.tsx): el editor tiró un error con lo que tiene la página.
  'page.crash.title': { en: "This page can't be shown right now.", es: "Esta página no se puede mostrar ahora." },
  'page.crash.text': {
    en: "Something in it made the editor fail. Nothing was deleted, and the rest of the app keeps working.",
    es: "Algo de su contenido hizo fallar al editor. No se borró nada, y el resto de la app sigue andando.",
  },
  'page.crash.textHistory': {
    en: "Something in it made the editor fail. Nothing was deleted: in Version history you can restore an earlier version, and the rest of the app keeps working.",
    es: "Algo de su contenido hizo fallar al editor. No se borró nada: en el historial de versiones podés restaurar una versión anterior, y el resto de la app sigue andando.",
  },
  'page.title': { en: "Title", es: "Título" },
  // El tope del título (500 caracteres, el de la base): lo que sobra va al principio de la página (sync/titleRest.ts).
  'page.titleTooLong': {
    en: "A title can be up to {max} characters.",
    es: "Un título puede tener hasta {max} caracteres.",
  },
  'page.titleRestMoved': {
    en: "The title was longer than 500 characters: the rest is now the first paragraph of “{title}”.",
    es: "El título pasaba de 500 caracteres: lo que sobraba quedó como primer párrafo de “{title}”.",
  },
  'header.options': { en: "Header options", es: "Opciones del encabezado" },
  'header.optionsTip': {
    en: "Header: how many containing pages show here",
    es: "Encabezado: cuántas de las páginas que contienen a esta se ven acá",
  },
  'header.title': { en: "Header", es: "Encabezado" },
  'header.forInside': { en: "Header for pages inside", es: "Encabezado de las páginas de adentro" },
  'header.show': { en: "Show header", es: "Mostrar el encabezado" },
  'header.levels': { en: "Levels shown", es: "Niveles que se ven" },
  'header.all': { en: "All", es: "Todos" },
  'header.startsAt': { en: "Starts at {title}.", es: "Empieza en {title}." },
  'header.setOn': {
    en: "Set on {where}; pages inside can set their own.",
    es: "Elegido en {where}; las de adentro pueden elegir el suyo.",
  },
  'header.thisPage': { en: "this page", es: "esta página" },
  'header.notSet': {
    en: "Not set anywhere yet: showing 2 levels.",
    es: "Todavía no se eligió en ningún lado: se ven 2 niveles.",
  },
  'header.inherit': { en: "Use the setting from above", es: "Usar lo de más arriba" },
} satisfies Dict;
