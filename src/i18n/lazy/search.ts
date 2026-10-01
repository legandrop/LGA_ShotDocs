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
  'search.titlesOnly': {
    en: "One letter searches page titles only: type another to search the text too.",
    es: "Con una sola letra se buscan solo los títulos: escribí otra para buscar también en el texto.",
  },
  'search.count': {
    en: { one: "{count} page found", other: "{count} pages found" },
    es: { one: "{count} página encontrada", other: "{count} páginas encontradas" },
  },
  'search.keys': { en: "↑ ↓ to move · Enter to open · Esc to close", es: "↑ ↓ para moverte · Enter abre · Esc cierra" },

  // Reemplazar en todo el proyecto (Docs/Doc_Buscar.md, "Reemplazar en el proyecto").
  "replace.pages": { en: { one: "{count} page", other: "{count} pages" }, es: { one: "{count} página", other: "{count} páginas" } },
  'replace.show': { en: "Replace in this project", es: "Reemplazar en el proyecto" },
  'replace.hide': { en: "Hide replace", es: "Ocultar reemplazar" },
  'replace.placeholder': { en: "Replace", es: "Reemplazar" },
  'replace.matchCase': { en: "Match case and accents", es: "Mayúsculas y tildes exactas" },
  'replace.wholeWord': { en: "Whole word", es: "Palabra entera" },
  'replace.all': { en: "Replace all ({count})", es: "Reemplazar todo ({count})" },
  'replace.one': { en: "Replace", es: "Reemplazar" },
  'replace.oneTip': { en: "Only this one", es: "Solo esta" },
  'replace.page': { en: "Replace in page", es: "Reemplazar en la página" },
  'replace.pageTip': { en: "All in this page", es: "Todas las de esta página" },
  'replace.leaveOut': { en: "Leave out of this replacement", es: "Dejar afuera de este reemplazo" },
  'replace.leaveOutPage': { en: "Leave this page out", es: "Dejar esta página afuera" },
  'replace.summary': {
    en: { one: "{count} match in {pages}", other: "{count} matches in {pages}" },
    es: { one: "{count} coincidencia en {pages}", other: "{count} coincidencias en {pages}" },
  },
  'replace.moreInPage': {
    en: { one: "and {count} more: it changes with the page", other: "and {count} more: they change with the page" },
    es: { one: "y {count} más: cambia con la página", other: "y {count} más: cambian con la página" },
  },
  'replace.fieldNotReplaced': { en: "Captions and file names don't change", es: "Los pies y los nombres de archivo no cambian" },
  'replace.block.gone': { en: "No longer in this project", es: "Ya no está en este proyecto" },
  'replace.block.trash': { en: "In the trash", es: "En la papelera" },
  'replace.block.permsUnknown': { en: "Permissions not loaded yet", es: "Todavía sin los permisos" },
  'replace.block.viewOnly': { en: "View only", es: "Solo lectura" },
  'replace.block.missing': { en: "Not downloaded yet", es: "Todavía sin bajar" },
  'replace.block.unreadable': { en: "Couldn't be read entirely", es: "No se pudo leer entera" },
  'replace.block.rejected': { en: "The server rejected changes to this page", es: "El servidor rechazó cambios de esta página" },
  'replace.block.unsupported': { en: "This version can't show this page", es: "Esta versión no puede mostrar esta página" },
  'replace.block.changing': { en: "Changed while replacing", es: "Cambió mientras se reemplazaba" },
  'replace.block.error': { en: "Couldn't be changed", es: "No se pudo cambiar" },
  'replace.checking': { en: "Checking for changes…", es: "Buscando cambios…" },
  'replace.confirmTitle': {
    en: { one: "Replace {count} match in {pages}?", other: "Replace {count} matches in {pages}?" },
    es: { one: "¿Reemplazar {count} coincidencia en {pages}?", other: "¿Reemplazar {count} coincidencias en {pages}?" },
  },
  'replace.confirmDelete': {
    en: { one: "Delete {count} match in {pages}?", other: "Delete {count} matches in {pages}?" },
    es: { one: "¿Borrar {count} coincidencia en {pages}?", other: "¿Borrar {count} coincidencias en {pages}?" },
  },
  'replace.confirmNone': { en: "Nothing to change", es: "No hay nada que cambiar" },
  'replace.nothing': { en: "nothing (deleted)", es: "nada (se borra)" },
  'replace.confirmHidden': {
    en: { one: "{count} is in a collapsed section.", other: "{count} are in collapsed sections." },
    es: { one: "{count} está en una sección colapsada.", other: "{count} están en secciones colapsadas." },
  },
  'replace.deleteHidden': {
    en: { one: "Also delete the {count} in a collapsed section", other: "Also delete the {count} in collapsed sections" },
    es: { one: "Borrar también la que está en una sección colapsada", other: "Borrar también las {count} que están en secciones colapsadas" },
  },
  'replace.wontChange': { en: "Won't change: {list}.", es: "No cambian: {list}." },
  'replace.skip.fields': {
    en: { one: "{count} in a caption or file name", other: "{count} in captions or file names" },
    es: { one: "{count} en un pie o un nombre de archivo", other: "{count} en pies o nombres de archivo" },
  },
  'replace.skip.link': {
    en: { one: "{count} would remove a link", other: "{count} would remove a link" },
    es: { one: "{count} borraría un link", other: "{count} borrarían un link" },
  },
  'replace.skip.boundary': {
    en: { one: "{count} crosses a deleted photo (use Replace all on that page)", other: "{count} cross a deleted photo (use Replace all on that page)" },
    es: { one: "{count} cruza una foto borrada (usá Reemplazar todo en esa página)", other: "{count} cruzan una foto borrada (usá Reemplazar todo en esa página)" },
  },
  'replace.skip.pages': {
    en: { one: "{count} in a page you can't change now", other: "{count} in pages you can't change now" },
    es: { one: "{count} en una página que no se puede cambiar ahora", other: "{count} en páginas que no se pueden cambiar ahora" },
  },
  'replace.offline': {
    en: "You're offline: it's saved on this device and uploads when you're back online.",
    es: "Sin conexión: se guarda en este dispositivo y se sube cuando vuelva la red.",
  },
  'replace.canUndo': { en: "You can undo it from the notice or from this panel.", es: "Se puede deshacer desde el aviso o desde este panel." },
  'replace.confirmButton': { en: "Replace {count}", es: "Reemplazar {count}" },
  'replace.confirmDeleteButton': { en: "Delete {count}", es: "Borrar {count}" },
  'replace.progress': { en: "Replacing… {done} of {total} pages", es: "Reemplazando… {done} de {total} páginas" },
  'replace.undoing': { en: "Undoing… {done} of {total} pages", es: "Deshaciendo… {done} de {total} páginas" },
  'replace.stop': { en: "Stop", es: "Parar" },
  'replace.done': {
    en: { one: "{count} replacement in {pages}", other: "{count} replacements in {pages}" },
    es: { one: "{count} reemplazo en {pages}", other: "{count} reemplazos en {pages}" },
  },
  'replace.stopped': { en: "stopped", es: "se paró" },
  'replace.pagesSkipped': {
    en: { one: "{count} page wasn't changed", other: "{count} pages weren't changed" },
    es: { one: "{count} página no se cambió", other: "{count} páginas no se cambiaron" },
  },
  'replace.unsaved': {
    en: "Couldn't save on this device: replacing stopped",
    es: "No se pudo guardar en este dispositivo: se paró el reemplazo",
  },
  'replace.changed': { en: "That match changed: the list was updated", es: "Esa coincidencia cambió: la lista se actualizó" },
  'replace.undo': { en: "Undo", es: "Deshacer" },
  'replace.undoRest': { en: "Undo the rest", es: "Deshacer lo que falta" },
  'replace.undone': {
    en: { one: "Undid {count} replacement", other: "Undid {count} replacements" },
    es: { one: "Se deshizo {count} reemplazo", other: "Se deshicieron {count} reemplazos" },
  },
  'replace.undoChanged': {
    en: { one: "{count} had changed and was left as is", other: "{count} had changed and were left as they are" },
    es: { one: "{count} había cambiado y quedó como estaba", other: "{count} habían cambiado y quedaron como estaban" },
  },
  'replace.undoRemaining': {
    en: { one: "{count} page couldn't be undone now", other: "{count} pages couldn't be undone now" },
    es: { one: "{count} página no se pudo deshacer ahora", other: "{count} páginas no se pudieron deshacer ahora" },
  },
  'replace.recent': {
    en: "Last: “{query}” → “{replacement}”, {count} in {pages}",
    es: "Último: “{query}” → “{replacement}”, {count} en {pages}",
  },
  'replace.recentStopped': { en: "stopped after {done} of {total} pages", es: "se paró después de {done} de {total} páginas" },
  'replace.recentPartial': { en: "partly undone", es: "deshecho en parte" },
  'replace.more': { en: "More ({count})", es: "Más ({count})" },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(search);
