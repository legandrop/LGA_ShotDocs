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
  'header.forInside': { en: "Header for pages inside", es: "Encabezado para las de adentro" },
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
  'editor.script': { en: "Script", es: "Guion" },
  'editor.scriptHint': {
    en: "Screenplay text: INT/EXT, DAY, NIGHT marked",
    es: "Texto de guion: INT/EXT, DÍA y NOCHE marcados",
  },
  'editor.question': { en: "Question", es: "Pregunta" },
  'editor.questionHint': {
    en: "A question for the team or the client, answered in comments",
    es: "Una pregunta para el equipo o el cliente, que se contesta en los comentarios",
  },
  'editor.image': { en: "Image", es: "Imagen" },
  'editor.missingOnline': {
    en: "Part of this page is still downloading. It opens for editing as soon as it arrives.",
    es: "Una parte de esta página todavía se está bajando. Se abre para editar apenas llega.",
  },
  'editor.missingOffline': {
    en: "Part of this page has not been downloaded to this device yet. You can read what is here; connect to the internet to edit it.",
    es: "Una parte de esta página todavía no se bajó a este dispositivo. Podés leer lo que hay; conectate a internet para editarla.",
  },
  'editor.commentOnly': {
    en: "You can comment on this page and answer its questions. Ask for edit access to change it.",
    es: "Podés comentar esta página y contestar sus preguntas. Pedí permiso de edición para cambiarla.",
  },
  'editor.unsupportedTitle': {
    en: "This page was edited with a newer version of the app.",
    es: "Esta página se editó con una versión más nueva de la app.",
  },
  'editor.unsupported': {
    en: "This version can't show all of it without losing part, so it stays closed. Nothing is lost.",
    es: "Esta versión no puede mostrarla entera sin perder una parte, así que queda cerrada. No se pierde nada.",
  },
  'editor.updateApp': { en: "Update the app", es: "Actualizar la app" },
  'editor.onlyImages': {
    en: "Only images can be added for now (JPEG, PNG, GIF, WebP, AVIF or HEIC). Videos need the workspace media server (Google Drive).",
    es: "Por ahora solo se pueden agregar imágenes (JPEG, PNG, GIF, WebP, AVIF o HEIC). Los videos necesitan el servidor de archivos del workspace (Google Drive).",
  },
  'editor.fileNotSaved': {
    en: "This file could not be saved on this device.",
    es: "No se pudo guardar este archivo en este dispositivo.",
  },
  'editor.pastedEmbedded': {
    en: "A pasted image stays embedded in the page: {reason}",
    es: "Una imagen pegada queda incrustada en la página: {reason}",
  },
  'editor.pastedNotSaved': {
    en: "A pasted image could not be saved as a file; it stays embedded in the page.",
    es: "Una imagen pegada no se pudo guardar como archivo; queda incrustada en la página.",
  },
} satisfies Dict;
