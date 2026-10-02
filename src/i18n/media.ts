import type { Dict } from './types';

// Fotos, videos y adjuntos: el carrete, Google Drive, las tarjetas de Drive, la cola de subida.

export const media = {
  'drive.connected': { en: "Google Drive connected.", es: "Google Drive conectado." },
  'drive.permissionMissing': {
    en: "Google Drive was not connected: the Drive permission was left unchecked. Connect again and keep it checked.",
    es: "Google Drive no se conectó: quedó sin marcar el permiso de Drive. Conectá de nuevo y dejalo marcado.",
  },
  'drive.notConnectedReason': {
    en: "Google Drive was not connected ({reason}).",
    es: "Google Drive no se conectó ({reason}).",
  },
  'drive.unreachable': { en: "Could not reach the media server", es: "No se pudo llegar al servidor de archivos" },
  'drive.connectedAs': { en: "Connected as {email}", es: "Conectado como {email}" },
  'drive.connectedShort': { en: "Connected", es: "Conectado" },
  'drive.needsReconnect': { en: "Needs reconnecting", es: "Hay que volver a conectarlo" },
  'drive.notConnected': { en: "Not connected", es: "No conectado" },
  'drive.status': { en: "Status", es: "Estado" },
  'drive.problem': { en: "Problem", es: "Problema" },
  'drive.connect': { en: "Connect Google Drive", es: "Conectar Google Drive" },
  'drive.checkAgain': { en: "Check again", es: "Revisar de nuevo" },
  'mediaTest.cancelled': { en: "Upload cancelled.", es: "Subida cancelada." },
  'queue.pageNotFound': {
    en: "The page is not on the server, or you cannot edit it.",
    es: "La página no está en el servidor, o no podés editarla.",
  },
  'queue.otherProject': { en: "This file belongs to another project.", es: "Este archivo es de otro proyecto." },
  'queue.foreignPlaceholder': { en: "Photo from another project", es: "Foto de otro proyecto" },
  'queue.foreignNotice': {
    en: "This photo belongs to another project: it will show broken here.",
    es: "Este archivo es de otro proyecto: acá se va a ver roto.",
  },
  'queue.foreignNoticeNamed': {
    en: "“{name}” is from another project: it will show broken here.",
    es: "“{name}” es de otro proyecto: acá se va a ver roto.",
  },
  'queue.unsentUse': {
    en: "A page on this device uses this file and has not synced yet, so it was skipped.",
    es: "Una página de este dispositivo usa este archivo y todavía no se sincronizó, así que se salteó.",
  },
  'queue.storage': {
    en: "The storage for photos and videos could not be opened.",
    es: "No se pudo abrir el almacenamiento de fotos y videos.",
  },
  'queue.cannotAdd': {
    en: "Photos and videos cannot be added on this device right now: {reason}",
    es: "Ahora no se pueden agregar fotos ni videos en este dispositivo: {reason}",
  },
  'queue.empty': { en: "This file is empty.", es: "Este archivo está vacío." },
  'queue.noSpace': {
    en: "There is not enough free storage on this device for this file.",
    es: "No hay espacio libre suficiente en este dispositivo para este archivo.",
  },
  'queue.noRoom': {
    en: "There is no room on this device for this file.",
    es: "No hay lugar en este dispositivo para este archivo.",
  },
  'queue.needsDrive': {
    en: "Only photos can be added here: to attach other files, the workspace owner has to connect Google Drive.",
    es: "Acá solo se pueden agregar fotos: para adjuntar otros archivos, el dueño del workspace tiene que conectar Google Drive.",
  },
  'queue.outdated': {
    en: "This workspace needs a newer version of the app. Reload the app to update it and try again.",
    es: "Este workspace necesita una versión más nueva de la app. Recargá la app para actualizarla y probá de nuevo.",
  },
  'attachment.foreign': { en: "File from another project", es: "Archivo de otro proyecto" },
  'queue.originalMissing': {
    en: "The original file is missing on this device.",
    es: "El archivo original ya no está en este dispositivo.",
  },
  'queue.freedUnknown': {
    en: "The copy on this device was freed and the media server doesn't remember this file. It's in the owner's Google Drive: ask them.",
    es: "La copia de este dispositivo se liberó y el servidor de archivos no recuerda este archivo. Está en el Google Drive del dueño: pedíselo.",
  },
  'queue.unknownToServer': {
    en: "The media server does not know this file reached Google Drive. Retry uploads it again.",
    es: "El servidor de archivos no sabe que este archivo llegó a Google Drive. Reintentar lo vuelve a subir.",
  },
  'queue.serverUpdate': {
    en: "The media server needs an update: the file reached Google Drive but the workspace was not told.",
    es: "El servidor de archivos necesita una actualización: el archivo llegó a Google Drive pero no se le avisó al workspace.",
  },
  'queue.waitingDb': {
    en: "Uploaded to Google Drive; waiting for the database to confirm it.",
    es: "Subido a Google Drive; esperando que la base de datos lo confirme.",
  },
  'queue.unknownError': { en: "Unknown error", es: "Error desconocido" },
  'queue.removedFromPage': { en: "removed from a page", es: "quitado de una página" },
  'queue.copiedToPage': { en: "copied to another page", es: "copiado a otra página" },
  'queue.notYet': { en: "Not available yet", es: "Todavía no está disponible" },
  'queue.notOnDevice': { en: "Not available on this device", es: "No está disponible en este dispositivo" },
  'queue.heicConverting': { en: "HEIC photo: turning it into a JPEG…", es: "Foto HEIC: pasándola a JPEG…" },
  'queue.heicPending': { en: "HEIC photo: turns into a JPEG once online", es: "Foto HEIC: pasa a JPEG cuando haya conexión" },
  'queue.heicRetrying': { en: "HEIC photo: trying again to turn it into a JPEG…", es: "Foto HEIC: volviendo a intentar pasarla a JPEG…" },
  'queue.heicFailed': { en: "HEIC photo: could not turn it into a JPEG", es: "Foto HEIC: no se pudo pasar a JPEG" },
  'queue.heicNoPreview': { en: "HEIC photo: this browser cannot show it", es: "Foto HEIC: este navegador no la muestra" },
  'probe.deleted': { en: "File deleted (in the Drive trash)", es: "Borrado (en la papelera de Drive)" },
  'probe.requested': { en: "Deletion requested, not yet in the trash", es: "Borrado pedido, todavía sin confirmar" },
  'probe.imageFailed': { en: "The image could not be opened.", es: "No se pudo abrir la imagen." },
  'probe.videoFailed': { en: "The video could not be opened.", es: "No se pudo abrir el video." },
  'portero.alreadySent': {
    en: "The media server does not know this file reached Google Drive.",
    es: "El servidor de archivos no sabe que este archivo llegó a Google Drive.",
  },
  'portero.settings': {
    en: "Could not read the workspace settings ({reason}).",
    es: "No se pudieron leer los ajustes del workspace ({reason}).",
  },
  'portero.notStarted': {
    en: "The media server did not start the upload.",
    es: "El servidor de archivos no empezó la subida.",
  },
  'portero.partLost': { en: "The part did not arrive.", es: "La parte no llegó." },
  'portero.lost': {
    en: "The media server does not have this upload anymore: it will start again.",
    es: "El servidor de archivos ya no tiene esta subida: se empieza de nuevo.",
  },
  // La tarjeta de una carpeta en la página (P.9, Docs/Doc_Carpetas.md).
  'folder.dirGone': {
    en: "Its folder is not in Google Drive anymore.",
    es: "Su carpeta ya no está en Google Drive.",
  },
  'folder.driveFailed': {
    en: "Google Drive did not start the upload.",
    es: "Google Drive no empezó la subida.",
  },
  'folder.card': { en: "Google Drive folder", es: "Carpeta de Google Drive" },
  'folder.cardStopped': { en: "Stopped: {done} of {total} (open it to retry)", es: "Detenida: {done} de {total} (abrila para reintentar)" },
  'folder.rate': { en: "Google Drive asked to slow down.", es: "Google Drive pidió ir más despacio." },
  'folder.notCreator': {
    en: "Only the person who added this folder can upload into it.",
    es: "Solo quien agregó esta carpeta puede subir adentro.",
  },
  'folder.full': {
    en: "The Google Drive of the workspace owner is full: free up space in it and press Retry.",
    es: "El Google Drive del dueño del workspace está lleno: liberá espacio y tocá Reintentar.",
  },
  'folder.gone': {
    en: "This folder is not in Google Drive anymore.",
    es: "Esta carpeta ya no está en Google Drive.",
  },
  'folder.cardUploading': { en: "Uploading {done} of {total}", es: "Subiendo {done} de {total}" },
  'folder.cardPaused': { en: "Paused: {done} of {total}", es: "En pausa: {done} de {total}" },
  'folder.cardMissing': {
    en: { one: "{count} left: drop the folder again", other: "{count} left: drop the folder again" },
    es: { one: "Falta {count}: soltá la carpeta otra vez", other: "Faltan {count}: soltá la carpeta otra vez" },
  },
  'folder.badPath': {
    en: "Its folder cannot be created in Google Drive (too deep, or a name that does not work there).",
    es: "Su carpeta no se puede crear en Google Drive (demasiado honda, o un nombre que no va ahí).",
  },
  'folder.cardErrors': {
    en: { one: "{count} file could not be uploaded", other: "{count} files could not be uploaded" },
    es: { one: "{count} archivo no se pudo subir", other: "{count} archivos no se pudieron subir" },
  },
  'portero.stalled': {
    en: "The upload stopped moving; it will try again.",
    es: "La subida dejó de avanzar; se vuelve a intentar.",
  },
  'portero.retries': {
    en: "The upload stopped after {max} failed retries in a row: {reason}",
    es: "La subida se frenó después de {max} reintentos fallidos seguidos: {reason}",
  },
  'portero.signIn': { en: "Sign in to the app first.", es: "Primero entrá a la app." },
  'portero.noConnection': {
    en: "No connection with the media server ({reason}).",
    es: "No hay conexión con el servidor de archivos ({reason}).",
  },
  'portero.answered': { en: "The media server answered {status}.", es: "El servidor de archivos respondió {status}." },
  'portero.unreadable': {
    en: "The media server gave an answer that could not be read.",
    es: "El servidor de archivos dio una respuesta que no se pudo leer.",
  },
  'queue.noServer': { en: "This workspace has no media server.", es: "Este workspace no tiene servidor de archivos." },
} satisfies Dict;
