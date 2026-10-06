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
  // `{pages}` y `{files}` llegan ya con su cantidad y en singular o plural (`import.countPages`, `import.countFiles`).
  'import.found': { en: "{pages} and {files} ({size}).", es: "{pages} y {files} ({size})." },
  'import.countPages': { en: { one: "{count} page", other: "{count} pages" }, es: { one: "{count} página", other: "{count} páginas" } },
  'import.countFiles': { en: { one: "{count} file", other: "{count} files" }, es: { one: "{count} archivo", other: "{count} archivos" } },
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
  // Entró todo y solo faltó anotarla como terminada: no hay páginas por traer.
  'import.resumeClose': {
    en: "An earlier import of this doc into “{name}” brought everything in but was not closed. Resume closes it.",
    es: "Una importación anterior de este doc a “{name}” trajo todo pero no quedó cerrada. Seguir la cierra.",
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
  'import.done': { en: "Imported {pages} and {files}.", es: "Se importaron {pages} y {files}." },
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
    en: { one: "{count} thing to check:", other: "{count} things to check:" },
    es: { one: "{count} cosa para revisar:", other: "{count} cosas para revisar:" },
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
  'import.unsupported': {
    en: "has content from a newer version of the app: it was not changed (update the app and resume the import)",
    es: "tiene contenido de una versión más nueva de la app: no se tocó (actualizá la app y seguí la importación)",
  },
  'import.reattached': {
    en: "went to the top level: its parent page is missing or the pages loop",
    es: "quedó en el primer nivel: falta su página madre o las páginas forman un círculo",
  },
  'import.goneFromFolder': {
    en: "is no longer in the exported folder: it stays in the project as the interrupted import left it",
    es: "ya no está en la carpeta exportada: queda en el proyecto como la dejó la importación cortada",
  },
  'import.noDocId': {
    en: "This folder's export doesn't say which doc it is from. Export the doc again with coda-export.",
    es: "La exportación de esta carpeta no dice de qué doc es. Exportá el doc de nuevo con coda-export.",
  },
  // Lo que quedó pendiente (importCommit.ts, `importPendingText`): en el diálogo y en la lista del final.
  'import.pending.job.changed': {
    en: "An earlier import of this folder was left unfinished, or it changed in another tab. Try again with the options below.",
    es: "Una importación anterior de esta carpeta quedó sin terminar, o cambió en otra pestaña. Probá de nuevo con las opciones de abajo.",
  },
  'import.pending.job.unreadable': {
    en: "This device has an import record for this folder that this version of the app can't read. Update the app and close its other tabs.",
    es: "Este dispositivo tiene un registro de importación de esta carpeta que esta versión de la app no puede leer. Actualizá la app y cerrá sus otras pestañas.",
  },
  'import.pending.page.unsaved': {
    en: "could not be saved on this device yet; resume the import",
    es: "todavía no se pudo guardar en este dispositivo; seguí la importación",
  },
  'import.pending.page.changed': {
    en: "changed while it was being imported; resume the import",
    es: "cambió mientras se importaba; seguí la importación",
  },
  'import.pending.page.mismatch': {
    en: "was left in a state the import can't continue; use Import into a new project",
    es: "quedó en un estado que la importación no puede seguir; usá Importar a un proyecto nuevo",
  },
  'import.pending.page.invalid': {
    en: "could not be prepared for importing, and Resume will give the same result; use Import into a new project",
    es: "no se pudo preparar para importar, y Seguir va a dar lo mismo; usá Importar a un proyecto nuevo",
  },
  'import.pending.close': {
    en: "Everything came in, but the import could not be marked as finished: choose the same folder again and use Resume. If Resume says this again, use Import into a new project.",
    es: "Entró todo, pero la importación no se pudo anotar como terminada: elegí la misma carpeta de nuevo y usá Seguir. Si Seguir vuelve a decir esto, usá Importar a un proyecto nuevo.",
  },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(importCoda);
