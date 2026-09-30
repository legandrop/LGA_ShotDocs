import type { Dict } from './types';

// La barra lateral, el árbol de páginas y el selector de proyectos.

export const sidebar = {
  'sidebar.collapse': { en: "Collapse", es: "Plegar" },
  'sidebar.expand': { en: "Expand", es: "Desplegar" },
  'sidebar.moreActions': { en: "More actions", es: "Más acciones" },
  'sidebar.addInside': { en: "Add a page inside", es: "Agregar una página adentro" },
  'sidebar.pages': { en: "Pages", es: "Páginas" },
  'sidebar.width': { en: "Sidebar width", es: "Ancho de la barra lateral" },
  'sidebar.widthTip': {
    en: "**Drag:** resize the sidebar\n**Double-click:** back to the default width\n**Arrow keys:** resize from the keyboard",
    es: "**Arrastrar:** cambia el ancho de la barra\n**Doble clic:** vuelve al ancho de fábrica\n**Flechas:** cambia el ancho con el teclado",
  },
  'project.defaultName': { en: "My project", es: "Mi proyecto" },
  'project.thisProject': { en: "this project", es: "este proyecto" },
  'project.switchTip': {
    en: "**{shortcut}** to switch projects from anywhere",
    es: "**{shortcut}** para cambiar de proyecto desde cualquier lado",
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
  'import.menu': { en: "Import from Coda…", es: "Importar de Coda…" },
  'import.title': { en: "Import from Coda", es: "Importar de Coda" },
  'import.text': {
    en: "Choose the folder made by coda-export. Everything goes into a new project; photos and videos upload to your Drive in the background.",
    es: "Elegí la carpeta que armó coda-export. Todo entra a un proyecto nuevo; las fotos y los videos se suben a tu Drive en segundo plano.",
  },
  'import.choose': { en: "Choose folder", es: "Elegir carpeta" },
  'import.chooseOther': { en: "Choose another folder", es: "Elegir otra carpeta" },
  'import.found': { en: "{pages} pages and {files} files.", es: "{pages} páginas y {files} archivos." },
  'import.start': { en: "Import", es: "Importar" },
  'import.importing': { en: "Importing…", es: "Importando…" },
  'import.progress': { en: "Page {done} of {total}:", es: "Página {done} de {total}:" },
  'import.done': { en: "Imported {pages} pages and {files} files.", es: "Se importaron {pages} páginas y {files} archivos." },
  'import.uploading': {
    en: "Files keep uploading to Drive while the app is open. Keep it open until the sync status says everything is uploaded.",
    es: "Los archivos se siguen subiendo al Drive mientras la app está abierta. Dejala abierta hasta que el estado diga que se subió todo.",
  },
  'import.problems': {
    en: { one: "{count} thing could not be imported:", other: "{count} things could not be imported:" },
    es: { one: "{count} cosa no se pudo importar:", other: "{count} cosas no se pudieron importar:" },
  },
  'import.open': { en: "Open the project", es: "Abrir el proyecto" },
} satisfies Dict;
