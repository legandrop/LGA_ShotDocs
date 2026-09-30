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
    en: "Offline · {changes} saved on this device",
    es: "Sin conexión · {changes} guardados en este dispositivo",
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
    en: "Your edits are saved on this device and upload after updating.",
    es: "Tus cambios están guardados en este dispositivo y se suben después de actualizar.",
  },
  'sync.detail.updateNow': { en: "Update now", es: "Actualizar ahora" },
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
} satisfies Dict;
