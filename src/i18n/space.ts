import type { Dict } from './types';

// El espacio de la app en el dispositivo y "Available offline" (P.10, Docs/Doc_Copias_Locales.md): lo que se ve
// sin abrir las ventanas (el aviso del tope, los menús, el ícono del árbol). Las ventanas van en `lazy/offline.ts`.

export const space = {
  'offline.noSpace': { en: "Not enough space on this device", es: "No hay lugar en este dispositivo" },
  'offline.waitingDrive': {
    en: "Waiting for the owner's Google Drive",
    es: "Esperando el Google Drive del dueño",
  },
  'offline.iosLimit': {
    en: "Offline pages on this iPhone are limited to {limit} for now. Check free space in iPhone Settings before marking large projects.",
    es: "Por ahora, lo disponible sin conexión en este iPhone llega hasta {limit}. Mirá el lugar libre en los Ajustes del iPhone antes de marcar proyectos grandes.",
  },
  'pageMenu.offline': { en: "Available offline…", es: "Disponible sin conexión…" },
  'project.offline': { en: "Available offline…", es: "Disponible sin conexión…" },
  'account.storage': { en: "Storage on this device", es: "Espacio en este dispositivo" },
  'space.promptLimit': {
    en: "Shot Docs is keeping {kept} of files on this device (limit {limit}). Free up {free}? Files stay in Drive; without a connection you'll see their thumbnails.",
    es: "Shot Docs guarda {kept} de archivos en este dispositivo (tope {limit}). ¿Liberar {free}? Los archivos siguen en Drive; sin conexión vas a ver sus miniaturas.",
  },
  'space.unsaved': {
    en: "Not enough space on this device: “{name}” ({size}) was not added. Save it so it isn't lost.",
    es: "No hay lugar en este dispositivo: “{name}” ({size}) no se agregó. Guardalo para no perderlo.",
  },
  'space.saveFile': { en: "Save…", es: "Guardar…" },
  'space.discardFile': { en: "Dismiss", es: "Descartar" },
  'space.promptMark': {
    en: "An offline page needs more space. Free up {free} of copies already in Drive?",
    es: "Una página sin conexión necesita más lugar. ¿Liberar {free} de copias que ya están en Drive?",
  },
  'space.promptFirst': {
    en: "New: Shot Docs keeps up to {limit} of files on this device. Mark pages Available offline to keep them. Original photos and videos are kept only if you check them when marking.",
    es: "Nuevo: Shot Docs guarda hasta {limit} de archivos en este dispositivo. Marcá las páginas Disponible sin conexión para conservarlas. Las fotos originales y los videos quedan solo si los tildás al marcar.",
  },
  'space.promptRoom': {
    en: "Not enough space for new files on this device. Free up {free} of photos and videos added here that are already in Drive? Without a connection you'll see their thumbnails.",
    es: "No hay lugar para archivos nuevos en este dispositivo. ¿Liberar {free} de fotos y videos agregados acá que ya están en Drive? Sin conexión vas a ver sus miniaturas.",
  },
  'space.freeRoom': { en: "Free up {size}", es: "Liberar {size}" },
  'space.keptSome': {
    en: { one: "{count} file stayed on this device: {reasons}.", other: "{count} files stayed on this device: {reasons}." },
    es: { one: "{count} archivo quedó en este dispositivo: {reasons}.", other: "{count} archivos quedaron en este dispositivo: {reasons}." },
  },
  'space.skip.offline': { en: "no connection", es: "sin conexión" },
  'space.skip.server': { en: "the media server needs an update", es: "el servidor de archivos necesita una actualización" },
  'space.skip.notInDrive': { en: "not in Drive", es: "no está en Drive" },
  'space.skip.trash': { en: "in a trash", es: "en una papelera" },
  'space.skip.mismatch': { en: "Drive has a different file", es: "Drive tiene otro archivo" },
  'space.skip.changed': { en: "changed meanwhile", es: "cambió mientras tanto" },
  'space.skip.noAnswer': { en: "Drive didn't answer", es: "Drive no contestó" },
  'space.freeUp': { en: "Free up", es: "Liberar" },
  'space.showWhat': { en: "Show what", es: "Ver qué" },
  'space.changeLimit': { en: "Change limit", es: "Cambiar el tope" },
  'space.notNow': { en: "Not now", es: "Ahora no" },
  'space.freed': { en: "Freed {size} on this device.", es: "Se liberaron {size} en este dispositivo." },
  'space.downloading': {
    en: "Downloading for offline: {done} of {total}",
    es: "Bajando para usar sin conexión: {done} de {total}",
  },
  'space.readyNotice': { en: "“{title}” is ready to use offline.", es: "“{title}” está listo para usar sin conexión." },
  'sidebar.offlineReady': { en: "Available offline", es: "Disponible sin conexión" },
  'sidebar.offlineNoSpace': { en: "Offline: not enough space", es: "Sin conexión: falta lugar" },
  'sidebar.offlineWaiting': { en: "Offline: waiting to download", es: "Sin conexión: esperando para bajar" },
  'sync.offlineShort': { en: "Offline · {count}", es: "Sin conexión · {count}" },
} satisfies Dict;
