import type { Dict } from './types';

// La barra lateral, el árbol de páginas y el selector de proyectos.

export const sidebar = {
  'sidebar.collapse': { en: "Collapse", es: "Plegar" },
  'sidebar.expand': { en: "Expand", es: "Desplegar" },
  'sidebar.moreActions': { en: "More actions", es: "Más acciones" },
  // El rótulo de una carpeta con tipo (Doc_Estructura_Proyecto.md, «Tipo de página»).
  'sidebar.holdsScenes': { en: "Everything created inside is a scene", es: "Todo lo que se crea adentro es una escena" },
  'sidebar.holdsLocations': { en: "Everything created inside is a location", es: "Todo lo que se crea adentro es una locación" },
  'sidebar.tagDays': { en: "Shoot days", es: "Días" },
  'sidebar.holdsDays': { en: "Everything created inside is a shoot day", es: "Todo lo que se crea adentro es un día de rodaje" },
  'sidebar.addInside': { en: "Add a page inside", es: "Agregar una página adentro" },
  'sidebar.pages': { en: "Pages", es: "Páginas" },
  'sidebar.tree': { en: "Page tree", es: "Árbol de páginas" },
  'sidebar.width': { en: "Sidebar width", es: "Ancho de la barra lateral" },
  // El botón "?" del pie y la entrada del menú de la cuenta (la ayuda, Docs/Doc_Tutorial.md).
  'help.open': { en: "Help and shortcuts", es: "Ayuda y atajos" },
  // Con novedades en la ayuda (el punto del "?", Docs/Doc_Tutorial.md, entrega 3).
  'help.openNews': { en: "Help and shortcuts: what's new", es: "Ayuda y atajos: novedades" },
  // El tooltip del borde (D226): renglones «gesto o atajo: acción» que arma tipRows.ts.
  'sidebar.widthDrag': { en: "resize the sidebar", es: "cambiar el ancho de la barra" },
  'sidebar.widthReset': { en: "back to the default width", es: "volver al ancho de fábrica" },
  'sidebar.widthKeys': { en: "resize step by step", es: "cambiar el ancho de a poco" },
  'project.defaultName': { en: "My project", es: "Mi proyecto" },
  'project.thisProject': { en: "this project", es: "este proyecto" },
  'project.switchTip': {
    en: "search pages and projects from anywhere",
    es: "buscar páginas y proyectos desde cualquier lado",
  },
  'sidebar.search': { en: "Search this project ({shortcut})", es: "Buscar en el proyecto ({shortcut})" },
  'sidebar.searchAct': { en: "search this project", es: "buscar en el proyecto" },
  // Mientras el dispositivo lee el proyecto por primera vez (Docs/Doc_Relaciones.md, sección 6).
  'sidebar.reading': { en: "Reading {ready} of {total}…", es: "Leyendo {ready} de {total}…" },
  'sidebar.readingTip': {
    en: "This device is reading the project's pages to search them and recognize scenes and locations. Only the first time: after that, only what changes.",
    es: "El dispositivo lee las páginas del proyecto para buscarlas y reconocer escenas y locaciones. Solo la primera vez: después, solo lo que cambia.",
  },
  'project.summary': {
    en: { one: "Project · {count} page", other: "Project · {count} pages" },
    es: { one: "Proyecto · {count} página", other: "Proyecto · {count} páginas" },
  },
  'project.pages': {
    en: { one: "{count} page", other: "{count} pages" },
    es: { one: "{count} página", other: "{count} páginas" },
  },
  'project.new': { en: "New project", es: "Proyecto nuevo" },
  'project.newNamed': { en: "New project “{name}”", es: "Proyecto nuevo “{name}”" },
  'project.rename': { en: "Rename project", es: "Renombrar proyecto" },
  'project.renameNamed': { en: "Rename “{name}”", es: "Renombrar “{name}”" },
  'project.share': { en: "Share “{name}”…", es: "Compartir “{name}”…" },
  'project.name': { en: "Project name", es: "Nombre del proyecto" },
  'project.newName': { en: "New project name", es: "Nombre del proyecto nuevo" },
  'project.saveFailed': {
    en: "This device could not save the change. Free up some storage and try again.",
    es: "Este dispositivo no pudo guardar el cambio. Liberá espacio y probá de nuevo.",
  },
  'project.projects': { en: "Projects", es: "Proyectos" },
  'project.find': { en: "Find a project", es: "Buscar un proyecto" },
  'project.findPlaceholder': { en: "Find a project…", es: "Buscar un proyecto…" },
  'project.yours': { en: "Your projects", es: "Tus proyectos" },
  'project.open': { en: "Open", es: "Abierto" },
  'project.noMatch': { en: "No project with that name.", es: "No hay ningún proyecto con ese nombre." },
  'project.emptyStats': { en: "empty", es: "vacío" },
  'project.editedToday': { en: "edited today", es: "editado hoy" },
  'project.editedYesterday': { en: "edited yesterday", es: "editado ayer" },
  'project.editedOn': { en: "edited {date}", es: "editado el {date}" },
  'project.untitled': { en: "Untitled project", es: "Proyecto sin título" },
  // Archivar y borrar proyectos (P.14): los íconos de cada renglón del selector y las listas.
  'project.archiveNamed': { en: "Archive “{name}”", es: "Archivar “{name}”" },
  'project.unarchiveNamed': { en: "Unarchive “{name}”", es: "Desarchivar “{name}”" },
  'project.deleteNamed': { en: "Delete “{name}”…", es: "Borrar “{name}”…" },
  'project.moreNamed': { en: "Actions for “{name}”", es: "Acciones de “{name}”" },
  'project.archiveTip': { en: "Archive", es: "Archivar" },
  'project.unarchiveTip': { en: "Unarchive", es: "Desarchivar" },
  'project.deleteTip': { en: "Delete…", es: "Borrar…" },
  'project.archive': { en: "Archive", es: "Archivar" },
  'project.unarchive': { en: "Unarchive", es: "Desarchivar" },
  'project.delete': { en: "Delete…", es: "Borrar…" },
  'project.archiveConfirm': { en: "Archive “{name}”?", es: "¿Archivar “{name}”?" },
  'project.archived': {
    en: "“{name}” archived. It is in Archived projects.",
    es: "“{name}” archivado. Está en Proyectos archivados.",
  },
  'project.unarchived': { en: "“{name}” is back in your projects.", es: "“{name}” volvió a tus proyectos." },
  'project.archivedMark': { en: "Archived", es: "Archivado" },
  'project.archivedOn': { en: "archived {date}", es: "archivado el {date}" },
  'project.archivedList': { en: "Archived projects ({count})", es: "Proyectos archivados ({count})" },
  'project.archivedTitle': { en: "Archived projects", es: "Proyectos archivados" },
  'project.findArchived': { en: "Find an archived project…", es: "Buscar un proyecto archivado…" },
  'project.noArchived': { en: "No archived project with that name.", es: "No hay ningún proyecto archivado con ese nombre." },
  'project.onlyOne': {
    en: "This is your only project: create another one first",
    es: "Es tu único proyecto: primero creá otro",
  },
  'project.stateFailed': { en: "Could not do it: {reason}", es: "No se pudo: {reason}" },
  'project.onlyActive': {
    en: "This is your only active project: create or unarchive another one first",
    es: "Es tu único proyecto activo: primero creá o desarchivá otro",
  },
  'project.errorNotAllowed': {
    en: "You can't do that in this project anymore: your access changed.",
    es: "Ya no podés hacer eso en este proyecto: cambió tu acceso.",
  },
  'project.errorNotFound': {
    en: "This project no longer exists, or you can't see it anymore.",
    es: "Este proyecto ya no existe, o ya no lo ves.",
  },
  'project.errorDriveFirst': {
    en: "Its files are in the Google Drive trash: Restore brings them back first. Open the Trash again.",
    es: "Sus archivos están en la papelera de Google Drive: Restaurar primero los trae. Abrí la papelera de nuevo.",
  },
  'project.errorDeleted': {
    en: "This project was deleted in the meantime: it is in the Trash.",
    es: "Este proyecto se borró mientras tanto: está en la papelera.",
  },
  'project.errorPurged': {
    en: "This project was deleted forever: it can no longer be restored from the app.",
    es: "Este proyecto se borró para siempre: ya no se puede restaurar desde la app.",
  },
  'import.menu': { en: "Import from Coda…", es: "Importar de Coda…" },
  'importArchive.menu': { en: "Import Shot Docs archive…", es: "Importar archivo de Shot Docs…" },
  // Con una importación en curso (de Coda o de un archivo de Shot Docs, importJob.ts): cerrar la sesión o quitar el
  // workspace esperan.
  'import.running': {
    en: "An import is running. Wait until it finishes.",
    es: "Hay una importación en curso. Esperá a que termine.",
  },
  'import.otherTab': {
    en: "The other window is importing. If you take over, the import stops there (it can be resumed later). Take over anyway?",
    es: "La otra ventana está importando. Si tomás el control, la importación se corta ahí (después se puede seguir). ¿Tomar el control igual?",
  },
} satisfies Dict;
