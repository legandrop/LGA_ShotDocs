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
  'page.title': { en: "Title", es: "Título" },
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
