import type { Dict } from './types';

// La barra lateral, el árbol de páginas y el selector de proyectos.

export const sidebar = {
  'sidebar.collapse': { en: "Collapse", es: "Plegar" },
  'sidebar.expand': { en: "Expand", es: "Desplegar" },
  'sidebar.moreActions': { en: "More actions", es: "Más acciones" },
  // *Overview*, el panorama del proyecto (Docs/Doc_Relaciones.md, secciones 12 y 21; D772).
  'sidebar.map': { en: "Overview", es: "Panorama" },
  'sidebar.auto': { en: "Auto", es: "Auto" },
  'sidebar.locations': { en: "Locations", es: "Locaciones" },
  'sidebar.sets': { en: "Sets", es: "Decorados" },
  'sidebar.days': { en: "Shoot days", es: "Días de rodaje" },
  'sidebar.pending': { en: "Pending", es: "Pendientes" },
  'sidebar.shots': { en: "Shots", es: "Planos" },
  'sidebar.mapTip': {
    en: "Made by the app from what the pages say; you don’t edit it. Every scene, location, set and shoot day of the project",
    es: "Lo arma la app con lo que dicen las páginas; no se edita. Todas las escenas, locaciones, decorados y días de rodaje del proyecto",
  },
  'sidebar.mapPending': { en: { one: "{count} pending", other: "{count} pending" }, es: { one: "{count} pendiente", other: "{count} pendientes" } },
  // *Scenes* adentro de *Overview* (Docs/Doc_Relaciones.md, sección 21).
  'sidebar.scenes': { en: "Scenes", es: "Escenas" },
  'sidebar.scenesMore': { en: { one: "Show {count} more", other: "Show {count} more" }, es: { one: "Mostrar {count} más", other: "Mostrar {count} más" } },
  'sidebar.scenesNoEpisode': { en: "No episode", es: "Sin episodio" },
  // El rótulo de una carpeta con tipo (Doc_Estructura_Proyecto.md, «Tipo de página»).
  'sidebar.holdsScenes': { en: "Everything created inside is a scene", es: "Todo lo que se crea adentro es una escena" },
  'sidebar.holdsLocations': { en: "Everything created inside is a location", es: "Todo lo que se crea adentro es una locación" },
  'sidebar.holdsSets': { en: "Everything created inside is a set", es: "Todo lo que se crea adentro es un decorado" },
  'sidebar.tagDays': { en: "Shoot days", es: "Días" },
  'sidebar.tagScoutings': { en: "Scouting", es: "Scouting" },
  'sidebar.tagTests': { en: "Tests", es: "Pruebas" },
  'sidebar.tagPlans': { en: "Plans", es: "Planes" },
  'sidebar.stagePlan': { en: "PLN", es: "PLN" },
  'sidebar.stageReport': { en: "REP", es: "REP" },
  'sidebar.holdsDays': { en: "Everything created inside is a shoot day", es: "Todo lo que se crea adentro es un día de rodaje" },
  'sidebar.holdsScoutings': { en: "Everything inside, at any depth, is a scouting report: it links to the locations it names", es: "Todo lo de adentro, a cualquier profundidad, es un reporte de scouting: se conecta con las locaciones que nombra" },
  'sidebar.holdsPlans': { en: "Everything inside, at any depth, is a day plan: it links to its shoot day by date and day number", es: "Todo lo de adentro, a cualquier profundidad, es un plan de jornada: se conecta con su día por la fecha y el número de día" },
  'sidebar.holdsTests': { en: "Everything inside, at any depth, is a test report: it links to the locations it names", es: "Todo lo de adentro, a cualquier profundidad, es un reporte de prueba: se conecta con las locaciones que nombra" },
  'sidebar.addInside': { en: "Add a page inside", es: "Agregar una página adentro" },
  'sidebar.pages': { en: "Pages", es: "Páginas" },
  'sidebar.tree': { en: "Page tree", es: "Árbol de páginas" },
  'sidebar.width': { en: "Sidebar width", es: "Ancho de la barra lateral" },
  // El botón "?" (arriba; en el teléfono, al pie del cajón) y la entrada del menú de la cuenta (la ayuda, Docs/Doc_Tutorial.md).
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
  // El color del proyecto (Docs/Doc_Navegacion.md, «Color del proyecto»).
  // Con «…»: abren otro panel, como *Export project…* y *Delete…* en el mismo menú.
  'project.color': { en: "Color…", es: "Color…" },
  'project.renameMenu': { en: "Rename…", es: "Renombrar…" },
  'project.favoriteNamed': { en: "Add “{name}” to favorites", es: "Marcar “{name}” como favorito" },
  'project.unfavoriteNamed': { en: "Remove “{name}” from favorites", es: "Quitar “{name}” de favoritos" },
  'project.favoriteFailed': { en: "Couldn't save the favorite on this device", es: "No se pudo guardar el favorito en este dispositivo" },
  'project.favoriteTip': { en: "Favorite: listed before the other projects", es: "Favorito: se lista antes que los demás proyectos" },
  'project.colorNamed': { en: "Color of “{name}”", es: "Color de “{name}”" },
  'project.colorFailed': { en: "Couldn't save the color", es: "No se pudo guardar el color" },
  // El picker de color (ColorPicker.tsx).
  'color.presets': { en: "PRESETS", es: "PRESETS" },
  'color.recent': { en: "RECENT", es: "RECIENTES" },
  'color.custom': { en: "CUSTOM", es: "PERSONALIZADO" },
  'color.svSquare': { en: "Saturation and brightness", es: "Saturación y brillo" },
  'color.hue': { en: "Hue", es: "Tono" },
  'color.saturation': { en: "Saturation", es: "Saturación" },
  'color.brightness': { en: "Brightness", es: "Brillo" },
  'color.hex': { en: "Hex color", es: "Color en hex" },
  'color.reset': { en: "Back to the default color", es: "Volver al color de fábrica" },
  'project.share': { en: "Share “{name}”", es: "Compartir “{name}”" },
  // *Share scenes* (Docs/Doc_Compartir_Escenas.md): la entrada del selector y lo que ven personas de afuera en el árbol.
  'project.shareScenes': { en: "Share scenes of “{name}”", es: "Compartir escenas de “{name}”" },
  'outside.tree.direct': {
    en: {
      one: "Seen by {count} person outside the team (a guest, or View or Comment), with the pages inside",
      other: "Seen by {count} people outside the team (guests, or View or Comment), with the pages inside",
    },
    es: {
      one: "La ve {count} persona de afuera del equipo (un invitado, o con Ver o Comentar), con las páginas de adentro",
      other: "La ven {count} personas de afuera del equipo (invitados, o con Ver o Comentar), con las páginas de adentro",
    },
  },
  'outside.tree.inside': {
    en: "Seen by people outside the team through “{title}”",
    es: "La ven personas de afuera del equipo por “{title}”",
  },
  // Para quien edita sin poder compartir el proyecto: solo sí o no (`page_has_outside_readers`).
  'outside.tree.seen': {
    en: "People outside the team (a guest, or View or Comment) see this page",
    es: "Personas de afuera del equipo (un invitado, o con Ver o Comentar) ven esta página",
  },
  'outside.mergeConfirm': {
    en: "People outside the team (guests, or View or Comment) see “{title}”. Merging brings the text and the pages inside of the other one into it: they will see them too. Merge?",
    es: "Personas de afuera del equipo (invitados, o con Ver o Comentar) ven “{title}”. Al unir, el texto y las páginas de adentro de la otra pasan ahí: también los van a ver. ¿Las unís?",
  },
  'outside.moveIntoShared': {
    en: "The scene “{title}” is shared with people outside the team. To move a page into it, stop sharing it first.",
    es: "La escena “{title}” está compartida con personas de afuera del equipo. Para mover una página adentro, primero dejá de compartirla.",
  },
  'outside.mergeIntoShared': {
    en: "The scene “{title}” is shared with people outside the team. To merge a card from outside it into one inside it, stop sharing it first.",
    es: "La escena “{title}” está compartida con personas de afuera del equipo. Para unir una ficha de afuera con una de adentro, primero dejá de compartirla.",
  },
  'outside.moveConfirm': {
    en: "People outside the team (guests, or View or Comment) see “{title}”. If you move this page inside it, they will see it too, with everything inside. Move it?",
    es: "Personas de afuera del equipo (invitados, o con Ver o Comentar) ven “{title}”. Si movés esta página adentro, también la van a ver, con todo lo de adentro. ¿La movés?",
  },
  'outside.created': {
    en: "People outside the team see “{title}”: they will see this new page too.",
    es: "Personas de afuera del equipo ven “{title}”: también van a ver esta página nueva.",
  },
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
  // El botón *New* de arriba del selector y compartir en el ⋯ de cada proyecto (v0.333; el nombre accesible lleva el del proyecto).
  'project.newMenu': { en: "New", es: "Nuevo" },
  'project.shareItem': { en: "Share…", es: "Compartir…" },
  'project.shareScenesItem': { en: "Share scenes…", es: "Compartir escenas…" },
  // El ⋯ de quien es del equipo de un vendor (D854): sumar gente al equipo y repartir las escenas entre artistas.
  'project.vendorTeamItem': { en: "Share all scenes…", es: "Compartir todas las escenas…" },
  'project.vendorTeamNamed': { en: "Share all scenes of “{name}”", es: "Compartir todas las escenas de “{name}”" },
  'project.vendorArtistsItem': { en: "Share scenes with artists…", es: "Compartir escenas con artistas…" },
  'project.vendorArtistsNamed': { en: "Share scenes of “{name}” with artists", es: "Compartir escenas de “{name}” con artistas" },
  'project.createNamed': { en: "Create “{name}”", es: "Crear “{name}”" },
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
  'import.menu': { en: "Import from Coda", es: "Importar de Coda" },
  'importArchive.menu': { en: "Import Shot Docs archive", es: "Importar archivo de Shot Docs" },
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
