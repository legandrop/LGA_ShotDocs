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
  'attachment.foreign': { en: "File from another project", es: "Archivo de otro proyecto" },
  'queue.stalled': {
    en: "The upload stopped moving; it will try again.",
    es: "La subida dejó de avanzar; se vuelve a intentar.",
  },
  'queue.originalMissing': {
    en: "The original file is missing on this device.",
    es: "El archivo original ya no está en este dispositivo.",
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
