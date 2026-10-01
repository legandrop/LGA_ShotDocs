import { register } from '../index';
import type { Dict } from '../types';

// Las carpetas (P.9, Docs/Doc_Carpetas.md): la ventana de qué se sube y el visor de lo que hay en la carpeta de
// Drive. Se carga aparte, con el editor.

export const folders = {
  'folders.askTitle': {
    en: { one: "Upload this folder to Google Drive?", other: "Upload these {count} folders to Google Drive?" },
    es: { one: "¿Subir esta carpeta a Google Drive?", other: "¿Subir estas {count} carpetas a Google Drive?" },
  },
  'folders.counts': {
    en: "{files} in {dirs} · {size}",
    es: "{files} en {dirs} · {size}",
  },
  'folders.files': {
    en: { one: "{count} file", other: "{count} files" },
    es: { one: "{count} archivo", other: "{count} archivos" },
  },
  'folders.dirs': {
    en: { one: "{count} folder", other: "{count} folders" },
    es: { one: "{count} carpeta", other: "{count} carpetas" },
  },
  'folders.kindImages': {
    en: { one: "{count} photo", other: "{count} photos" },
    es: { one: "{count} foto", other: "{count} fotos" },
  },
  'folders.kindVideos': {
    en: { one: "{count} video", other: "{count} videos" },
    es: { one: "{count} video", other: "{count} videos" },
  },
  'folders.kindPdfs': {
    en: { one: "{count} PDF", other: "{count} PDFs" },
    es: { one: "{count} PDF", other: "{count} PDF" },
  },
  'folders.kindOther': {
    en: { one: "{count} other file", other: "{count} other files" },
    es: { one: "{count} archivo más", other: "{count} archivos más" },
  },
  'folders.invalid': {
    en: {
      one: "{count} file is skipped: its folder is too deep (more than 30 levels) or its name does not work in Google Drive.",
      other: "{count} files are skipped: their folders are too deep (more than 30 levels) or their names do not work in Google Drive.",
    },
    es: {
      one: "Se saltea {count} archivo: su carpeta está demasiado honda (más de 30 niveles) o su nombre no va en Google Drive.",
      other: "Se saltean {count} archivos: sus carpetas están demasiado hondas (más de 30 niveles) o sus nombres no van en Google Drive.",
    },
  },
  'folders.again': {
    en: "Part of this folder is already uploading on this page: it can continue with what is missing.",
    es: "Una parte de esta carpeta ya se está subiendo en esta página: puede seguir con lo que falta.",
  },
  'folders.continue': { en: "Continue the upload", es: "Seguir la subida" },
  'folders.uploadNew': { en: "Upload as a new folder", es: "Subir como carpeta nueva" },
  'folders.stop': { en: "Stop uploading", es: "Dejar de subir" },
  'folders.stopAsk': {
    en: "Stop uploading this folder? What is already in Google Drive stays there; the rest is not uploaded.",
    es: "¿Dejar de subir esta carpeta? Lo que ya está en Google Drive queda ahí; lo demás no se sube.",
  },
  'folders.stopYes': { en: "Stop", es: "Dejar de subir" },
  'folders.showTree': { en: "Show what is inside", es: "Ver lo que tiene adentro" },
  'folders.treeMore': {
    en: { one: "…and {count} more", other: "…and {count} more" },
    es: { one: "…y {count} más", other: "…y {count} más" },
  },
  'folders.skipped': {
    en: { one: "{count} hidden or system file is skipped", other: "{count} hidden or system files are skipped" },
    es: { one: "Se saltea {count} archivo oculto o del sistema", other: "Se saltean {count} archivos ocultos o del sistema" },
  },
  'folders.unreadable': {
    en: { one: "{count} file could not be read and is skipped", other: "{count} files could not be read and are skipped" },
    es: { one: "{count} archivo no se pudo leer y se saltea", other: "{count} archivos no se pudieron leer y se saltean" },
  },
  'folders.includeHidden': { en: "Include hidden files", es: "Incluir archivos ocultos" },
  'folders.manyFiles': {
    en: "Many files: this takes a long while (Google Drive creates a few files per second).",
    es: "Muchos archivos: va a tardar un rato largo (Google Drive crea pocos archivos por segundo).",
  },
  'folders.bigFiles': {
    en: { one: "{count} file is larger than 1 GB.", other: "{count} files are larger than 1 GB." },
    es: { one: "{count} archivo pesa más de 1 GB.", other: "{count} archivos pesan más de 1 GB." },
  },
  'folders.where': {
    en: "It goes to the workspace owner's Drive. Whoever sees this page sees and downloads what is in it.",
    es: "Va al Drive del dueño del workspace. Quien ve esta página ve y baja lo que tiene.",
  },
  'folders.keepOpen': {
    en: "Keep this tab open until it finishes: the files are read from your disk.",
    es: "Dejá esta pestaña abierta hasta que termine: los archivos se leen de tu disco.",
  },
  'folders.upload': { en: "Upload", es: "Subir" },
  'folders.checking': { en: "Checking the media server…", es: "Revisando el servidor de archivos…" },
  'folders.oldServer': {
    en: "The media server of this workspace cannot take folders yet: the workspace owner has to update it.",
    es: "El servidor de archivos de este workspace todavía no recibe carpetas: el dueño del workspace tiene que actualizarlo.",
  },
  'folders.offline': {
    en: "Uploading a folder needs a connection.",
    es: "Para subir una carpeta hace falta conexión.",
  },
  'folders.notSaved': { en: "The folder could not be added: {reason}", es: "No se pudo agregar la carpeta: {reason}" },
  'folders.uploadingTitle': { en: "Uploading to Google Drive", es: "Subiendo a Google Drive" },
  'folders.progress': {
    en: "{done} of {total} files · {sent} of {size}",
    es: "{done} de {total} archivos · {sent} de {size}",
  },
  'folders.eta': { en: "about {time} left", es: "faltan unos {time}" },
  'folders.minutes': {
    en: { one: "{count} min", other: "{count} min" },
    es: { one: "{count} min", other: "{count} min" },
  },
  'folders.seconds': { en: "{count} s", es: "{count} s" },
  'folders.preparing': { en: "Creating the folders in Drive…", es: "Creando las carpetas en Drive…" },
  'folders.waiting': { en: "Waiting a moment: {reason}", es: "Esperando un momento: {reason}" },
  'folders.paused': { en: "Paused", es: "En pausa" },
  'folders.done': { en: "Done: everything is in Google Drive.", es: "Listo: todo está en Google Drive." },
  'folders.missing': {
    en: { one: "{count} file left: drop the folder here again (or choose it) to finish.", other: "{count} files left: drop the folder here again (or choose it) to finish." },
    es: { one: "Falta {count} archivo: soltá la carpeta acá de nuevo (o elegila) para terminar.", other: "Faltan {count} archivos: soltá la carpeta acá de nuevo (o elegila) para terminar." },
  },
  'folders.chooseAgain': { en: "Choose the folder…", es: "Elegir la carpeta…" },
  'folders.matched': {
    en: { one: "{count} file found: it continues.", other: "{count} files found: it continues." },
    es: { one: "Se encontró {count} archivo: sigue.", other: "Se encontraron {count} archivos: sigue." },
  },
  'folders.noMatch': {
    en: "None of the missing files is in that folder (same path and size).",
    es: "Ninguno de los archivos que faltan está en esa carpeta (misma ruta y peso).",
  },
  'folders.errors': {
    en: { one: "{count} file could not be uploaded:", other: "{count} files could not be uploaded:" },
    es: { one: "{count} archivo no se pudo subir:", other: "{count} archivos no se pudieron subir:" },
  },
  'folders.pause': { en: "Pause", es: "Pausar" },
  'folders.resume': { en: "Resume", es: "Seguir" },
  'folders.retry': { en: "Retry", es: "Reintentar" },
  'folders.openFolder': { en: "Open the folder", es: "Abrir la carpeta" },
  'folders.closeTip': { en: "It keeps uploading while this tab is open", es: "Sigue subiendo mientras la pestaña esté abierta" },
  'folders.viewerEmpty': { en: "This folder is empty.", es: "Esta carpeta está vacía." },
  'folders.loading': { en: "Loading…", es: "Cargando…" },
  'folders.loadMore': { en: "Show more", es: "Mostrar más" },
  'folders.notReady': {
    en: "This folder is still being created in Google Drive: try again in a moment.",
    es: "Esta carpeta todavía se está creando en Google Drive: probá de nuevo en un momento.",
  },
  'folders.notFound': {
    en: "This folder does not exist or you cannot see it.",
    es: "Esta carpeta no existe o no la podés ver.",
  },
  'folders.slowDown': {
    en: "Google Drive asked to slow down: try again in a moment.",
    es: "Google Drive pidió ir más despacio: probá de nuevo en un momento.",
  },
  'folders.listFailed': { en: "Could not open the folder: {reason}", es: "No se pudo abrir la carpeta: {reason}" },
  'folders.offlineList': {
    en: "No connection: the folder's contents are in Google Drive.",
    es: "Sin conexión: lo que tiene la carpeta está en Google Drive.",
  },
  'folders.shortcut': { en: "Shortcut (not opened from the app)", es: "Acceso directo (no se abre desde la app)" },
  'folders.googleDoc': { en: "Google document (not downloadable here)", es: "Documento de Google (no se baja desde acá)" },
  'folders.download': { en: "Download", es: "Bajar" },
  'folders.uploadHere': { en: "Upload in progress", es: "Subida en curso" },
  'folders.showUpload': { en: "Show the upload", es: "Ver la subida" },
  'folders.breadcrumb': { en: "Folders", es: "Carpetas" },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(folders);
