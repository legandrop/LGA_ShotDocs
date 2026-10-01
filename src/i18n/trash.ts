import type { Dict } from './types';

// La papelera: páginas y archivos (fotos y videos que ninguna página usa).

export const trash = {
  'trash.title': { en: "Trash", es: "Papelera" },
  'trash.contents': { en: "Trash contents", es: "Contenido de la papelera" },
  'trash.pages': { en: "Pages", es: "Páginas" },
  'trash.files': { en: "Files", es: "Archivos" },
  'trash.pagesHint': {
    en: "Nothing here is ever deleted from the app. Restoring a page brings it back with everything that was inside it.",
    es: "Nada de lo que está acá se borra de la app. Restaurar una página la trae de vuelta con todo lo que tenía adentro.",
  },
  'trash.pagesHintMedia': {
    en: "Nothing here is ever deleted from the app. Restoring a page brings it back with everything that was inside it, except photos and videos that were already sent to the Google Drive trash from the Files tab: those show as deleted.",
    es: "Nada de lo que está acá se borra de la app. Restaurar una página la trae de vuelta con todo lo que tenía adentro, menos las fotos y los videos que ya se mandaron a la papelera de Google Drive desde la pestaña Archivos: esos aparecen como borrados.",
  },
  'trash.empty': { en: "The trash is empty.", es: "La papelera está vacía." },
  'trash.restore': { en: "Restore", es: "Restaurar" },
  'fileTrash.unsyncedUse': {
    en: "A file can show here while still in use on a page this device hasn't synced.",
    es: "Un archivo puede aparecer acá aunque lo use una página que este dispositivo todavía no sincronizó.",
  },
  'fileTrash.driveNotConnected': {
    en: "Google Drive is not connected: ask the workspace owner to reconnect it.",
    es: "Google Drive no está conectado: pedile al dueño del workspace que lo vuelva a conectar.",
  },
  'fileTrash.noConnection': {
    en: "No connection with the media server. Nothing was sent; try again when online.",
    es: "No hay conexión con el servidor de archivos. No se mandó nada; probá de nuevo cuando haya conexión.",
  },
  'fileTrash.daysPassed': { en: "{days} days passed", es: "pasaron {days} días" },
  'fileTrash.daysLeft': {
    en: { one: "{count} day left", other: "{count} days left" },
    es: { one: "falta {count} día", other: "faltan {count} días" },
  },
  'fileTrash.whereMany': {
    en: "They go to the Google Drive trash of the workspace owner and can be recovered from there for 30 days. Pages that still show one of them will say it was deleted.",
    es: "Van a la papelera de Google Drive del dueño del workspace y se pueden recuperar desde ahí durante 30 días. Las páginas que todavía muestren alguno van a decir que se borró.",
  },
  'fileTrash.whereOne': {
    en: "It goes to the Google Drive trash of the workspace owner and can be recovered from there for 30 days. A page that still shows it will say it was deleted.",
    es: "Va a la papelera de Google Drive del dueño del workspace y se puede recuperar desde ahí durante 30 días. Una página que todavía lo muestre va a decir que se borró.",
  },
  'fileTrash.inUse': {
    en: "A page uses “{name}” again, so it is not in the trash anymore.",
    es: "Una página volvió a usar “{name}”, así que ya no está en la papelera.",
  },
  'fileTrash.confirmUsed': {
    en: "“{name}” is used by “{page}”, a page in the trash. Restoring that page will not bring it back. Send it to the Google Drive trash anyway?",
    es: "“{name}” lo usa “{page}”, una página que está en la papelera. Restaurar esa página no lo va a traer de vuelta. ¿Mandarlo igual a la papelera de Google Drive?",
  },
  'fileTrash.confirmOne': {
    en: "Send “{name}” to the Google Drive trash?",
    es: "¿Mandar “{name}” a la papelera de Google Drive?",
  },
  'fileTrash.allFiles': {
    en: { one: "the {count} file", other: "all {count} files" },
    es: { one: "el único archivo", other: "los {count} archivos" },
  },
  'fileTrash.kept': {
    en: { one: "({count} used by a page in the trash stays)", other: "({count} used by pages in the trash stay)" },
    es: { one: "(queda {count}, que usa una página de la papelera)", other: "(quedan {count}, que usan páginas de la papelera)" },
  },
  'fileTrash.confirmEmpty': {
    en: "Empty the file trash: send {what}{skip} to the Google Drive trash?",
    es: "Vaciar la papelera de archivos: ¿mandar {what}{skip} a la papelera de Google Drive?",
  },
  'fileTrash.emptySpace': {
    en: "{size} go to the Google Drive trash. The space in Drive is freed when Google empties its trash (after 30 days), not right away.",
    es: "{size} pasan a la papelera de Google Drive. El espacio en Drive se libera cuando Google vacía su papelera (a los 30 días), no enseguida.",
  },
  'fileTrash.total': {
    en: { one: "{count} file · {size}", other: "{count} files · {size}" },
    es: { one: "{count} archivo · {size}", other: "{count} archivos · {size}" },
  },
  'fileTrash.someFailed': {
    en: "{failed} of {total} could not be sent. They stay in the list with the reason.",
    es: "{failed} de {total} no se pudieron mandar. Quedan en la lista con el motivo.",
  },
  'fileTrash.intro': {
    en: "Photos and videos that no page outside the trash uses anymore.",
    es: "Fotos y videos que ya no usa ninguna página fuera de la papelera.",
  },
  'fileTrash.autoOn': {
    en: "Each one is sent to the Google Drive trash {days} days after it got here.",
    es: "Cada uno se manda a la papelera de Google Drive {days} días después de llegar acá.",
  },
  'fileTrash.autoOffTitle': { en: "Auto-delete is off:", es: "El borrado automático está apagado:" },
  'fileTrash.autoOff': {
    en: "nothing is sent on its own. When auto-delete is on, each one would be sent to the Google Drive trash {days} days after it got here.",
    es: "no se manda nada solo. Con el borrado automático prendido, cada uno se mandaría a la papelera de Google Drive {days} días después de llegar acá.",
  },
  'fileTrash.loadFailed': {
    en: "The file trash could not be read ({reason}). It needs an internet connection.",
    es: "No se pudo leer la papelera de archivos ({reason}). Hace falta conexión a internet.",
  },
  'fileTrash.none': { en: "No files in the trash.", es: "No hay archivos en la papelera." },
  'fileTrash.needsInternet': { en: "Needs an internet connection", es: "Hace falta conexión a internet" },
  // Un archivo que usa una página de un proyecto borrado (P.14): no se manda a Drive hasta que lo restauren.
  'fileTrash.inDeletedProject': {
    en: "Used by a page of a deleted project. It comes back if that project is restored.",
    es: "Lo usa una página de un proyecto borrado. Vuelve si restauran ese proyecto.",
  },
  'fileTrash.emptyTip': {
    en: "Send every file in this list to the Google Drive trash, except those used by pages in the trash",
    es: "Manda todos los archivos de esta lista a la papelera de Google Drive, menos los que usan páginas de la papelera",
  },
  'fileTrash.emptyButton': { en: "Empty", es: "Vaciar" },
  'fileTrash.sendingOf': { en: "Sending {n} of {total}…", es: "Mandando {n} de {total}…" },
  'fileTrash.usedBy': { en: "Used by “{page}” in the trash", es: "Lo usa “{page}”, en la papelera" },
  'fileTrash.notConfirmed': {
    en: "Sending it to the Google Drive trash was not confirmed yet. Try again.",
    es: "Todavía no se confirmó que haya llegado a la papelera de Google Drive. Probá de nuevo.",
  },
  'fileTrash.sendTip': {
    en: "Send to the Google Drive trash (recoverable there for 30 days)",
    es: "Manda a la papelera de Google Drive (se puede recuperar ahí durante 30 días)",
  },
  'fileTrash.sending': { en: "Sending…", es: "Mandando…" },
  'fileTrash.send': { en: "Send to Drive trash", es: "Mandar a la papelera de Drive" },
} satisfies Dict;
