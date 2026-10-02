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

  // "Download all" (entrega 2, Docs/Doc_Carpetas.md, sección 9).
  'folders.downloadAll': { en: "Download all", es: "Bajar todo" },
  'folders.downloadAllTip': { en: "Everything inside, with its subfolders", es: "Todo lo de adentro, con sus subcarpetas" },
  'folders.downloadAllOffline': {
    en: "Downloading the whole folder needs a connection.",
    es: "Para bajar la carpeta entera hace falta conexión.",
  },
  'folders.zipListing': { en: "Looking at what is inside… {files} in {dirs}", es: "Mirando lo que tiene adentro… {files} en {dirs}" },
  'folders.zipSkipped': {
    en: {
      one: "{count} item is not downloaded (a shortcut, a Google document or a folder that could not be opened): it is listed in MISSING_FILES.txt.",
      other: "{count} items are not downloaded (shortcuts, Google documents or folders that could not be opened): they are listed in MISSING_FILES.txt.",
    },
    es: {
      one: "{count} cosa no se baja (un acceso directo, un documento de Google o una carpeta que no se pudo abrir): queda anotada en MISSING_FILES.txt.",
      other: "{count} cosas no se bajan (accesos directos, documentos de Google o carpetas que no se pudieron abrir): quedan anotadas en MISSING_FILES.txt.",
    },
  },
  'folders.zipEmpty': { en: "This folder is empty: there is nothing to download.", es: "Esta carpeta está vacía: no hay nada para bajar." },
  'folders.zipAsZip': { en: "Download as .zip…", es: "Bajar como .zip…" },
  'folders.zipAsZipTip': { en: "You choose where it goes; it is written as it arrives", es: "Elegís dónde va; se escribe a medida que llega" },
  'folders.zipInMemory': { en: "Download as .zip", es: "Bajar como .zip" },
  'folders.zipInMemoryTip': { en: "Built in this browser's memory: up to {max}", es: "Se arma en la memoria de este navegador: hasta {max}" },
  'folders.zipToFolder': { en: "Download to a folder…", es: "Bajar a una carpeta…" },
  'folders.zipToFolderTip': {
    en: "Writes the folders and files as they are, without a zip",
    es: "Escribe las carpetas y los archivos tal cual, sin zip",
  },
  'folders.zipTooBig': {
    en: "Too big to download all at once in this browser (more than {max}). Download the files one by one, or download it all from a computer with Chrome or Edge.",
    es: "Es demasiado para bajar todo junto en este navegador (más de {max}). Bajá los archivos de a uno, o bajá todo desde una computadora con Chrome o Edge.",
  },
  'folders.zipWaitingOnline': { en: "No connection: it continues when it comes back.", es: "Sin conexión: sigue cuando vuelva." },
  'folders.zipKeepOpen': { en: "Keep this tab open until it finishes.", es: "Dejá esta pestaña abierta hasta que termine." },
  'folders.zipDoneFile': { en: "Done: {name} is saved.", es: "Listo: {name} quedó guardado." },
  'folders.zipDoneDir': {
    en: "Done: the folder {name} is in the folder you chose.",
    es: "Listo: la carpeta {name} quedó en la carpeta que elegiste.",
  },
  'folders.zipReady': { en: "The zip is ready.", es: "El zip está listo." },
  'folders.zipSave': { en: "Save {name}", es: "Guardar {name}" },
  'folders.zipMissing': {
    en: {
      one: "{count} item is not in the download: it is listed in MISSING_FILES.txt.",
      other: "{count} items are not in the download: they are listed in MISSING_FILES.txt.",
    },
    es: {
      one: "{count} cosa no está en la descarga: queda anotada en MISSING_FILES.txt.",
      other: "{count} cosas no están en la descarga: quedan anotadas en MISSING_FILES.txt.",
    },
  },
  'folders.zipRetry': { en: "Retry missing", es: "Reintentar lo que falta" },
  'folders.zipRetryTipDir': { en: "Only what failed, into the same folder", es: "Solo lo que falló, en la misma carpeta" },
  'folders.zipRetryTipZip': {
    en: "Only what failed, in a new .zip: extract each one over the first, in order",
    es: "Solo lo que falló, en un .zip nuevo: descomprimí cada uno encima del primero, en orden",
  },
  'folders.zipRetryCancelled': { en: "Retry cancelled: nothing new was saved.", es: "Reintento cancelado: no se guardó nada nuevo." },
  'folders.zipRetryCancelledDir': {
    en: "Retry cancelled: what it already downloaded stays in the folder.",
    es: "Reintento cancelado: lo que ya bajó queda en la carpeta.",
  },
  'folders.zipRetryListing': { en: "Looking again at what could not be opened…", es: "Mirando de nuevo lo que no se pudo abrir…" },
  'folders.zipCancelled': { en: "Cancelled: nothing was saved.", es: "Cancelado: no se guardó nada." },
  'folders.zipCancelledDir': {
    en: "Cancelled: what was already downloaded stays in the folder you chose.",
    es: "Cancelado: lo que ya se bajó queda en la carpeta que elegiste.",
  },
  'folders.zipFailed': { en: "The download stopped: {reason}", es: "La descarga se frenó: {reason}" },
  // `MISSING_FILES.txt`, adentro del zip o de la carpeta.
  'folders.missingHead': {
    en: "These items from the folder \"{name}\" are not in this download ({date}):",
    es: "Estas cosas de la carpeta \"{name}\" no están en esta descarga ({date}):",
  },
  'folders.missingNone': {
    en: "Nothing from the folder \"{name}\" is missing anymore ({date}).",
    es: "Ya no falta nada de la carpeta \"{name}\" ({date}).",
  },
  'folders.missingShortcut': { en: "a Google Drive shortcut (the app does not follow them)", es: "un acceso directo de Google Drive (la app no los sigue)" },
  'folders.missingGoogle': {
    en: "a Google document (it cannot be downloaded from the app)",
    es: "un documento de Google (no se puede bajar desde la app)",
  },
  'folders.missingFolder': { en: "a folder that could not be opened", es: "una carpeta que no se pudo abrir" },
  'folders.missingFailed': { en: "could not be downloaded", es: "no se pudo bajar" },
  'folders.missingIncomplete': { en: "incomplete: the download stopped in the middle", es: "incompleto: la descarga se cortó en el medio" },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(folders);
