import type { Dict } from './types';

// El estado de la sincronización (barra lateral) y su detalle.

export const sync = {
  'sync.changes': {
    en: { one: "{count} change", other: "{count} changes" },
    es: { one: "{count} cambio", other: "{count} cambios" },
  },
  'sync.allSynced': { en: "All synced", es: "Todo sincronizado" },
  'sync.localError': {
    en: "Could not save on this device · retrying",
    es: "No se pudo guardar en este dispositivo · reintentando",
  },
  'sync.offline': { en: "Offline", es: "Sin conexión" },
  'sync.offlinePending': {
    en: "Offline · {count} to upload",
    es: "Sin conexión · {count} por subir",
  },
  'sync.notUploadedRetrying': { en: "{changes} not uploaded · retrying", es: "{changes} sin subir · reintentando" },
  'sync.problem': { en: "Sync problem · retrying", es: "Problema al sincronizar · reintentando" },
  'sync.update': { en: "Update the app", es: "Actualizá la app" },
  'sync.updatePending': { en: "Update the app · {changes} waiting", es: "Actualizá la app · {changes} esperando" },
  'sync.uploadingPercent': { en: "Uploading {changes} · {percent}%", es: "Subiendo {changes} · {percent}%" },
  'sync.uploading': { en: "Uploading {changes}…", es: "Subiendo {changes}…" },
  'sync.notUploaded': { en: "{changes} not uploaded", es: "{changes} sin subir" },
  'sync.syncing': { en: "Syncing…", es: "Sincronizando…" },
  'sync.rejected': {
    en: { one: "{count} change rejected by the server", other: "{count} changes rejected by the server" },
    es: { one: "{count} cambio rechazado por el servidor", other: "{count} cambios rechazados por el servidor" },
  },
  'sync.detail.localErrorTitle': {
    en: "This device could not save your last edits",
    es: "Este dispositivo no pudo guardar tus últimos cambios",
  },
  'sync.detail.localError': {
    en: "{title} ({error}). They are kept in memory and saving is retried every few seconds. Do not close the app until this message goes away; freeing up storage space usually fixes it.",
    es: "{title} ({error}). Quedan en la memoria y se reintenta guardarlos cada pocos segundos. No cierres la app hasta que se vaya este mensaje; liberar espacio suele arreglarlo.",
  },
  'sync.detail.lastError': {
    en: "Last problem: {error}. Nothing is lost; syncing keeps retrying.",
    es: "Último problema: {error}. No se perdió nada; la sincronización sigue reintentando.",
  },
  'sync.detail.mediaError': {
    en: "Photos and videos: {error}. They are saved on this device and keep retrying.",
    es: "Fotos y videos: {error}. Están guardados en este dispositivo y se sigue reintentando.",
  },
  'sync.detail.commentError': {
    en: "Comments: {error}. They are saved on this device and keep retrying.",
    es: "Comentarios: {error}. Están guardados en este dispositivo y se sigue reintentando.",
  },
  'sync.detail.outdatedTitle': {
    en: "This workspace needs a newer version of the app.",
    es: "Este workspace necesita una versión más nueva de la app.",
  },
  'sync.detail.outdated': {
    en: "Your edits and files are saved on this device and upload after updating.",
    es: "Tus cambios y archivos están guardados en este dispositivo y se suben después de actualizar.",
  },
  'sync.detail.updateNow': { en: "Update now", es: "Actualizar ahora" },
  'sync.detail.stuck': {
    en: "The browser didn't load the new version. Forcing it reloads the app from the internet; what is saved on this device stays.",
    es: "El navegador no cargó la versión nueva. Forzarla recarga la app desde internet; lo guardado en este dispositivo queda.",
  },
  'sync.detail.force': { en: "Force the update", es: "Forzar la actualización" },
  'sync.detail.forceFailed': {
    en: "Couldn't force the update: it needs a connection and everything saved on this device.",
    es: "No se pudo forzar la actualización: hace falta conexión y que todo esté guardado en este dispositivo.",
  },
  'sync.detail.schemaTitle': {
    en: "The workspace database needs an update.",
    es: "La base de datos del workspace necesita una actualización.",
  },
  'sync.detail.schema': {
    en: "It is at version {has} and this version of the app needs {needs}. The workspace owner has to apply the database migrations; until then, new features may not work. Your edits are safe on this device.",
    es: "Está en la versión {has} y esta versión de la app necesita la {needs}. El dueño del workspace tiene que aplicar las migraciones de la base; hasta entonces, lo nuevo puede no andar. Tus cambios están a salvo en este dispositivo.",
  },
  'sync.detail.warning': {
    en: "Reopening the app tries again; updating the app may be needed.",
    es: "Al volver a abrir la app se reintenta; puede hacer falta actualizarla.",
  },
  'sync.detail.rejected': {
    en: "The server did not accept these changes. Nothing was lost: they stay on this device until you retry.",
    es: "El servidor no aceptó estos cambios. No se perdió nada: quedan en este dispositivo hasta que reintentes.",
  },
  'sync.op.create': { en: "Create “{title}”", es: "Crear “{title}”" },
  'sync.op.createProject': { en: "Create the project “{name}”", es: "Crear el proyecto “{name}”" },
  'sync.op.renameProject': { en: "Rename a project to “{name}”", es: "Renombrar un proyecto como “{name}”" },
  'sync.op.change': { en: "Change “{title}”", es: "Cambiar “{title}”" },
  'sync.rejectedPages': {
    en: { one: "{count} page whose content could not be uploaded", other: "{count} pages whose content could not be uploaded" },
    es: { one: "{count} página cuyo contenido no se pudo subir", other: "{count} páginas cuyo contenido no se pudo subir" },
  },
  'sync.upload': { en: "Upload “{name}”", es: "Subir “{name}”" },
  'sync.comment.add': { en: "A comment on “{page}”", es: "Un comentario en “{page}”" },
  'sync.comment.import': { en: "An imported comment on “{page}”", es: "Un comentario importado en “{page}”" },
  'sync.comment.edit': { en: "An edited comment on “{page}”", es: "Un comentario editado en “{page}”" },
  'sync.comment.delete': { en: "A deleted comment on “{page}”", es: "Un comentario borrado en “{page}”" },
  'sync.comment.resolve': { en: "A resolved thread on “{page}”", es: "Un hilo resuelto en “{page}”" },
  'sync.copyText': { en: "Copy text", es: "Copiar el texto" },
  'sync.hideDiscardable': { en: "Hide what can be discarded", es: "Ocultar lo que se puede descartar" },
  'sync.downloadFailed': {
    en: "The file could not be made. Nothing was deleted; try again.",
    es: "No se pudo armar el archivo. No se borró nada; probá de nuevo.",
  },
  'sync.downloadUnsynced': { en: "Download my unsynced changes", es: "Descargar mis cambios sin sincronizar" },
  'engine.mediaOff': {
    en: "Photos and videos are off on this device: {reason}",
    es: "Las fotos y los videos no andan en este dispositivo: {reason}",
  },
  'engine.removedWriting': {
    en: "Someone deleted a part of “{page}” while you were writing in it. Open the page to get back what you wrote.",
    es: "Alguien borró una parte de “{page}” mientras escribías en ella. Abrí la página para recuperar lo que escribiste.",
  },
  'engine.restored': {
    en: "The workspace was restored from a backup.",
    es: "El workspace se restauró desde una copia de seguridad.",
  },
  'engine.restoredMedia': {
    en: "The workspace was restored from a backup. This device is uploading again the photos and videos it had, so nothing made after the backup is lost.",
    es: "El workspace se restauró desde una copia de seguridad. Este dispositivo está volviendo a subir las fotos y los videos que tenía, así no se pierde nada de lo hecho después de la copia.",
  },
  'engine.restoredComments': {
    en: "The workspace was restored from a backup. This device is uploading again the comments it had, so nothing made after the backup is lost.",
    es: "El workspace se restauró desde una copia de seguridad. Este dispositivo está volviendo a subir los comentarios que tenía, así no se pierde nada de lo hecho después de la copia.",
  },
  'engine.restoredBoth': {
    en: "The workspace was restored from a backup. This device is uploading again the photos and videos and the comments it had, so nothing made after the backup is lost.",
    es: "El workspace se restauró desde una copia de seguridad. Este dispositivo está volviendo a subir las fotos, los videos y los comentarios que tenía, así no se pierde nada de lo hecho después de la copia.",
  },
  'engine.restoredAll': {
    en: "The workspace was restored from a backup. This device is uploading again everything it had, so nothing made after the backup is lost.",
    es: "El workspace se restauró desde una copia de seguridad. Este dispositivo está volviendo a subir todo lo que tenía, así no se pierde nada de lo hecho después de la copia.",
  },
  'engine.skipped': {
    en: { one: "{count} page or project made on this device after the backup could not be created again: you no longer have permission to create them there. Their content stays on this device; use “{download}” to keep it.", other: "{count} pages or projects made on this device after the backup could not be created again: you no longer have permission to create them there. Their content stays on this device; use “{download}” to keep it." },
    es: { one: "{count} página o proyecto hecho en este dispositivo después de la copia no se pudo volver a crear: ya no tenés permiso para crearlo ahí. Su contenido queda en este dispositivo; usá “{download}” para guardarlo.", other: "{count} páginas o proyectos hechos en este dispositivo después de la copia no se pudieron volver a crear: ya no tenés permiso para crearlos ahí. Su contenido queda en este dispositivo; usá “{download}” para guardarlo." },
  },
  'files.onlyImages': {
    en: "Only images can be added for now (JPEG, PNG, GIF, WebP, AVIF or HEIC).",
    es: "Por ahora solo se pueden agregar imágenes (JPEG, PNG, GIF, WebP, AVIF o HEIC).",
  },
  'files.tooBig': {
    en: "This image is {mb} MB; the limit is 25 MB.",
    es: "Esta imagen pesa {mb} MB; el límite es 25 MB.",
  },
  'unsynced.note': {
    en: "The original is not inside this file: download it separately from the app.",
    es: "El original no está en este archivo: descargalo aparte desde la app.",
  },
  'docs.unreadable': {
    en: "Could not read an update from the server (page {page}, #{seq}).",
    es: "No se pudo leer un cambio del servidor (página {page}, #{seq}).",
  },
  'remote.settingsMissing': {
    en: "The database is missing pages.settings: apply the database migrations.",
    es: "A la base de datos le falta pages.settings: aplicá las migraciones de la base.",
  },
  'boot.firstTime': {
    en: "Setting up your workspace the first time needs an internet connection ({reason}).",
    es: "Para preparar tu workspace la primera vez hace falta conexión a internet ({reason}).",
  },
  'boot.mediaStorage': {
    en: "the storage for photos and videos could not be opened ({reason}). Reopening the app tries again.",
    es: "no se pudo abrir el almacenamiento de fotos y videos ({reason}). Al volver a abrir la app se intenta de nuevo.",
  },
  'boot.commentsStorage': {
    en: "the storage for comments could not be opened ({reason}). Reopening the app tries again.",
    es: "no se pudo abrir el almacenamiento de los comentarios ({reason}). Al volver a abrir la app se intenta de nuevo.",
  },
} satisfies Dict;
