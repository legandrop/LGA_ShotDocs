import { register } from '../index';
import type { Dict } from '../types';

// Importar de Coda (se carga aparte, con ImportCodaDialog.tsx y src/import/codaImport.ts). La entrada del
// menú (`import.menu`) está en la primera carga, en sidebar.ts.

export const importCoda = {
  'import.title': { en: "Import from Coda", es: "Importar de Coda" },
  'import.text': {
    en: "Choose the folder made by coda-export. Everything goes into a new project; photos and videos upload to your Drive in the background.",
    es: "Elegí la carpeta que armó coda-export. Todo entra a un proyecto nuevo; las fotos y los videos se suben a tu Drive en segundo plano.",
  },
  'import.needsDrive': {
    en: "Connect Google Drive first: imported photos and videos go to your Drive.",
    es: "Primero conectá Google Drive: las fotos y los videos importados van a tu Drive.",
  },
  'import.noFolders': {
    en: "This browser can't choose a whole folder (iPad and iPhone can't). Import from a computer: the project then syncs to this device.",
    es: "Este navegador no puede elegir una carpeta entera (el iPad y el iPhone no pueden). Importá desde una computadora: después el proyecto se sincroniza a este dispositivo.",
  },
  'import.choose': { en: "Choose folder", es: "Elegir carpeta" },
  'import.chooseOther': { en: "Choose another folder", es: "Elegir otra carpeta" },
  'import.found': { en: "{pages} pages and {files} files ({size}).", es: "{pages} páginas y {files} archivos ({size})." },
  'import.room': {
    en: "Files are saved on this device until they upload. Free space for the app: {free}.",
    es: "Los archivos quedan en este dispositivo hasta que se suben. Espacio libre para la app: {free}.",
  },
  'import.noRoom': {
    en: "This device may not have room: the files take {size} and the app has {free} free. Free up space or import from another device.",
    es: "Puede que no entre en este dispositivo: los archivos ocupan {size} y la app tiene {free} libres. Liberá espacio o importá desde otro dispositivo.",
  },
  'import.resumeText': {
    en: "An earlier import of this doc into “{name}” did not finish ({done} of {total} pages). Resuming continues there without repeating what was already saved.",
    es: "Una importación anterior de este doc a “{name}” no terminó ({done} de {total} páginas). Si seguís, continúa ahí sin repetir lo que ya se guardó.",
  },
  'import.resume': { en: "Resume", es: "Seguir" },
  'import.startOver': { en: "Import into a new project", es: "Importar a un proyecto nuevo" },
  'import.start': { en: "Import", es: "Importar" },
  'import.importing': { en: "Importing…", es: "Importando…" },
  'import.keepOpen': {
    en: "Keep the app open until the import finishes.",
    es: "Dejá la app abierta hasta que termine la importación.",
  },
  'import.progress': { en: "Page {current} of {total}:", es: "Página {current} de {total}:" },
  'import.done': { en: "Imported {pages} pages and {files} files.", es: "Se importaron {pages} páginas y {files} archivos." },
  'import.foundComments': {
    en: { one: "It also has {count} comment.", other: "It also has {count} comments." },
    es: { one: "Trae además {count} comentario.", other: "Trae además {count} comentarios." },
  },
  'import.doneComments': {
    en: { one: "{count} comment uploads with the sync.", other: "{count} comments upload with the sync." },
    es: { one: "{count} comentario se sube con la sincronización.", other: "{count} comentarios se suben con la sincronización." },
  },
  'import.badComments': {
    en: "The comments.json in this folder can't be read: the comments were not imported.",
    es: "No se puede leer el comments.json de esta carpeta: los comentarios no se importaron.",
  },
  'import.commentsOtherDoc': {
    en: "The comments.json in this folder is from another doc: the comments were not imported.",
    es: "El comments.json de esta carpeta es de otro doc: los comentarios no se importaron.",
  },
  'import.commentsOff': {
    en: "Comments can't be saved on this device: they were not imported.",
    es: "En este dispositivo no se pueden guardar comentarios: no se importaron.",
  },
  'import.commentsOnPage': {
    en: { one: "the text of {count} comment was not found; it is on the whole page", other: "the text of {count} comments was not found; they are on the whole page" },
    es: { one: "no se encontró el texto de {count} comentario; quedó en la página entera", other: "no se encontró el texto de {count} comentarios; quedaron en la página entera" },
  },
  'import.commentsFailed': { en: "comments not imported ({reason})", es: "no se importaron los comentarios ({reason})" },
  'import.uploading': {
    en: "Files keep uploading to Drive while the app is open. Keep it open until the sync status says everything is uploaded.",
    es: "Los archivos se siguen subiendo al Drive mientras la app está abierta. Dejala abierta hasta que el estado diga que se subió todo.",
  },
  'import.problems': {
    en: { one: "{count} thing could not be imported:", other: "{count} things could not be imported:" },
    es: { one: "{count} cosa no se pudo importar:", other: "{count} cosas no se pudieron importar:" },
  },
  'import.exportProblems': {
    en: { one: "coda-export noted {count} thing:", other: "coda-export noted {count} things:" },
    es: { one: "coda-export anotó {count} cosa:", other: "coda-export anotó {count} cosas:" },
  },
  'import.canResume': {
    en: "Some of it can be retried: choose the same folder again and use Resume.",
    es: "Parte se puede reintentar: elegí la misma carpeta de nuevo y usá Seguir.",
  },
  'import.open': { en: "Open the project", es: "Abrir el proyecto" },
  // Errores y la lista del final (codaImport.ts).
  'import.noManifest': {
    en: "This folder has no manifest.json. Choose the folder made by coda-export.",
    es: "Esta carpeta no tiene manifest.json. Elegí la carpeta que armó coda-export.",
  },
  'import.badManifest': {
    en: "The manifest.json in this folder can't be read. Run coda-export again and choose its folder.",
    es: "No se puede leer el manifest.json de esta carpeta. Volvé a correr coda-export y elegí su carpeta.",
  },
  'import.missingFile': { en: "missing in the folder: {path}", es: "falta en la carpeta: {path}" },
  'import.notExported': { en: "the page was not exported", es: "la página no se exportó" },
  'import.notCanvas': {
    en: "a “{type}” page (not text): it comes in empty",
    es: "una página “{type}” (no es texto): entra vacía",
  },
  'import.missingMedia': { en: "missing file {file}", es: "falta el archivo {file}" },
  'import.movedToEnd': { en: "{file} went to the end of the page", es: "{file} quedó al final de la página" },
  'import.linked': {
    en: "an image not stored in Coda stays linked to its site: {url}",
    es: "una foto que no estaba guardada en Coda queda enlazada a su sitio: {url}",
  },
  'import.dropped': {
    en: "an image not stored in Coda was left out: {url}",
    es: "una foto que no estaba guardada en Coda quedó afuera: {url}",
  },
  'import.notPlaced': {
    en: {
      one: "{count} file was saved but the page could not be written; resume the import to place it",
      other: "{count} files were saved but the page could not be written; resume the import to place them",
    },
    es: {
      one: "{count} archivo quedó guardado pero la página no se pudo escribir; seguí la importación para ubicarlo",
      other: "{count} archivos quedaron guardados pero la página no se pudo escribir; seguí la importación para ubicarlos",
    },
  },
  'import.brokenPageLink': {
    en: "a link to another page stays as text (that page is not in the import): “{text}”",
    es: "un link a otra página queda como texto (esa página no está en la importación): “{text}”",
  },
  'import.embed': {
    en: "a video or embed from another site stays as a link: {url}",
    es: "un video o embebido de otro sitio queda como link: {url}",
  },
  'import.appended': {
    en: "was edited after the import stopped: your text stays and the import went below it",
    es: "se editó después del corte: tu texto queda y lo importado va debajo",
  },
  'import.keptEdited': {
    en: "was edited after the import stopped: it stays as you left it (what failed there was not retried)",
    es: "se editó después del corte: queda como la dejaste (lo que había fallado ahí no se reintentó)",
  },
  'import.unsupported': {
    en: "has content from a newer version of the app: it was not changed (update the app and resume the import)",
    es: "tiene contenido de una versión más nueva de la app: no se tocó (actualizá la app y seguí la importación)",
  },
  'import.reattached': {
    en: "went to the top level: its parent page is missing or the pages loop",
    es: "quedó en el primer nivel: falta su página madre o las páginas forman un círculo",
  },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(importCoda);
