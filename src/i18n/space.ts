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
  'space.promptRoom': {
    en: "Not enough space for the new file ({needed}). Free up {free} of copies already in Drive, then add it again?",
    es: "No hay lugar para el archivo nuevo ({needed}). ¿Liberar {free} de copias que ya están en Drive y volver a agregarlo?",
  },
  'space.promptMark': {
    en: "An offline page needs more space. Free up {free} of copies already in Drive?",
    es: "Una página sin conexión necesita más lugar. ¿Liberar {free} de copias que ya están en Drive?",
  },
  'space.promptFirst': {
    en: "New: Shot Docs keeps up to {limit} of files on this device. Mark pages Available offline to keep them. Original photos and videos are kept only if you check them when marking.",
    es: "Nuevo: Shot Docs guarda hasta {limit} de archivos en este dispositivo. Marcá las páginas Disponible sin conexión para conservarlas. Las fotos originales y los videos quedan solo si los tildás al marcar.",
  },
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
