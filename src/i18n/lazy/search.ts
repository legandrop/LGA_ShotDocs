import { register } from '../index';
import type { Dict } from '../types';

// El panel de buscar en el proyecto (Ctrl/⌘+K; se carga aparte).

export const search = {
  'search.label': { en: "Search this project", es: "Buscar en el proyecto" },
  'search.placeholder': { en: "Search in {name}", es: "Buscar en {name}" },
  'search.hint': {
    en: "Type to search the titles and text of every page in {name}.",
    es: "Escribí para buscar en los títulos y el texto de todas las páginas de {name}.",
  },
  'search.projects': { en: "Projects", es: "Proyectos" },
  'search.pages': { en: "Pages", es: "Páginas" },
  'search.none': { en: "No results in this project", es: "Sin resultados en este proyecto" },
  'search.searching': { en: "Searching…", es: "Buscando…" },
  'search.missingOnline': {
    en: { one: "Still downloading {count} page: something may be missing", other: "Still downloading {count} pages: something may be missing" },
    es: { one: "Todavía bajando {count} página: puede faltar algo", other: "Todavía bajando {count} páginas: puede faltar algo" },
  },
  'search.missingOffline': {
    en: { one: "Offline: {count} page is not on this device yet", other: "Offline: {count} pages are not on this device yet" },
    es: { one: "Sin conexión: {count} página todavía no está en este dispositivo", other: "Sin conexión: {count} páginas todavía no están en este dispositivo" },
  },
  'search.unreadable': {
    en: {
      one: "{count} page could not be read completely on this device: something may be missing",
      other: "{count} pages could not be read completely on this device: something may be missing",
    },
    es: {
      one: "{count} página no se pudo leer entera en este dispositivo: puede faltar algo",
      other: "{count} páginas no se pudieron leer enteras en este dispositivo: puede faltar algo",
    },
  },
  'search.more': {
    en: { one: "and {count} more on this page", other: "and {count} more on this page" },
    es: { one: "y {count} más en esta página", other: "y {count} más en esta página" },
  },
  'search.showMore': { en: "Show more ({count})", es: "Mostrar más ({count})" },
  'search.inCaption': { en: "Caption:", es: "Pie de foto:" },
  'search.inName': { en: "File name:", es: "Nombre del archivo:" },
  'search.keys': { en: "↑ ↓ to move · Enter to open · Esc to close", es: "↑ ↓ para moverte · Enter abre · Esc cierra" },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(search);
