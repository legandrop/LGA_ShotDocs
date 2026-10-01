import type { Dict } from './types';

// La barra lateral, el árbol de páginas y el selector de proyectos.

export const sidebar = {
  'sidebar.collapse': { en: "Collapse", es: "Plegar" },
  'sidebar.expand': { en: "Expand", es: "Desplegar" },
  'sidebar.moreActions': { en: "More actions", es: "Más acciones" },
  'sidebar.addInside': { en: "Add a page inside", es: "Agregar una página adentro" },
  'sidebar.pages': { en: "Pages", es: "Páginas" },
  'sidebar.tree': { en: "Page tree", es: "Árbol de páginas" },
  'sidebar.width': { en: "Sidebar width", es: "Ancho de la barra lateral" },
  'sidebar.widthTip': {
    en: "**Drag:** resize the sidebar\n**Double-click:** back to the default width\n**Arrow keys:** resize from the keyboard",
    es: "**Arrastrar:** cambia el ancho de la barra\n**Doble clic:** vuelve al ancho de fábrica\n**Flechas:** cambia el ancho con el teclado",
  },
  'project.defaultName': { en: "My project", es: "Mi proyecto" },
  'project.thisProject': { en: "this project", es: "este proyecto" },
  'project.switchTip': {
    en: "**{shortcut}** searches pages and projects from anywhere",
    es: "**{shortcut}** busca páginas y proyectos desde cualquier lado",
  },
  'sidebar.search': { en: "Search this project ({shortcut})", es: "Buscar en el proyecto ({shortcut})" },
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
  'import.menu': { en: "Import from Coda…", es: "Importar de Coda…" },
  // Con una importación de Coda en curso (importJob.ts): cerrar la sesión o quitar el workspace esperan.
  'import.running': {
    en: "An import from Coda is running. Wait until it finishes.",
    es: "Hay una importación de Coda en curso. Esperá a que termine.",
  },
  'import.otherTab': {
    en: "The other window is importing from Coda. If you take over, the import stops there (it can be resumed later). Take over anyway?",
    es: "La otra ventana está importando de Coda. Si tomás el control, la importación se corta ahí (después se puede seguir). ¿Tomar el control igual?",
  },
} satisfies Dict;
