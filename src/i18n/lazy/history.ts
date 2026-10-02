import { register } from '../index';
import type { Dict } from '../types';

// El historial de versiones de una página (P.18, Docs/Doc_Historial.md). Se carga aparte, con su pantalla.

export const history = {
  'history.title': { en: "Version history", es: "Historial de versiones" },
  'history.back': { en: "Back to the page", es: "Volver a la página" },
  'history.loading': { en: "Loading the history…", es: "Cargando el historial…" },
  'history.loadingCount': {
    en: { one: "Loading the history… {count} change", other: "Loading the history… {count} changes" },
    es: { one: "Cargando el historial… {count} cambio", other: "Cargando el historial… {count} cambios" },
  },
  'history.offline': {
    en: "Version history needs a connection.",
    es: "El historial de versiones necesita conexión.",
  },
  'history.denied': {
    en: "You can't see the history of this page.",
    es: "No podés ver el historial de esta página.",
  },
  'history.inTrash': {
    en: "This page is in the trash: restore it to see its history.",
    es: "Esta página está en la papelera: restaurala para ver su historial.",
  },
  'history.failed': { en: "The history could not be loaded: {reason}", es: "No se pudo cargar el historial: {reason}" },
  'history.empty': {
    en: "This page has no changes on the server yet.",
    es: "Esta página todavía no tiene cambios en el servidor.",
  },
  'history.current': { en: "Current version", es: "Versión actual" },
  'history.today': { en: "Today", es: "Hoy" },
  'history.yesterday': { en: "Yesterday", es: "Ayer" },
  'history.you': { en: "You", es: "Vos" },
  'history.formerMember': { en: "Former member", es: "Ex miembro" },
  'history.serverTimeTip': {
    en: "When it reached the server.\nWhat was written offline shows when it synced.",
    es: "Cuando llegó al servidor.\nLo escrito sin conexión figura cuando se sincronizó.",
  },
  'history.unsynced': {
    en: "This device has changes to this page that aren't synced yet: they are not in the history.",
    es: "Este dispositivo tiene cambios de esta página sin subir: no están en el historial.",
  },
  'history.unreadable': {
    en: {
      one: "{count} change was made with a newer version of the app and isn't shown.",
      other: "{count} changes were made with a newer version of the app and aren't shown.",
    },
    es: {
      one: "{count} cambio se hizo con una versión más nueva de la app y no se muestra.",
      other: "{count} cambios se hicieron con una versión más nueva de la app y no se muestran.",
    },
  },
  'history.partial': {
    en: "Part of this version can't be shown with this version of the app.",
    es: "Parte de esta versión no se puede mostrar con esta versión de la app.",
  },
  'history.versions': { en: "Versions", es: "Versiones" },
  'history.restore': { en: "Restore this version", es: "Restaurar esta versión" },
  'history.restoreShort': { en: "Restore", es: "Restaurar" },
  'history.confirmTitle': { en: "Restore this version?", es: "¿Restaurar esta versión?" },
  'history.confirmText': {
    en: "The page will look like this version. Nothing is lost: the current version stays in the history and you can undo.",
    es: "La página va a quedar como esta versión. No se pierde nada: la versión actual queda en el historial y se puede deshacer.",
  },
  'history.confirmPhotos': {
    en: {
      one: "1 photo or file in this version was deleted from Google Drive: it will show as deleted until the owner restores it from the Drive trash (30 days).",
      other: "{count} photos or files in this version were deleted from Google Drive: they will show as deleted until the owner restores them from the Drive trash (30 days).",
    },
    es: {
      one: "1 foto o archivo de esta versión se mandó a la papelera de Google Drive: se va a ver como borrado hasta que el dueño lo recupere desde la papelera de Drive (30 días).",
      other: "{count} fotos o archivos de esta versión se mandaron a la papelera de Google Drive: se van a ver como borrados hasta que el dueño los recupere desde la papelera de Drive (30 días).",
    },
  },
  'history.othersEditing': {
    en: "{name} changed this page in the last 2 minutes: what they are writing now could be left out of the page.",
    es: "{name} cambió esta página en los últimos 2 minutos: lo que esté escribiendo ahora podría quedar afuera de la página.",
  },
  'history.confirm': { en: "Restore", es: "Restaurar" },
  'history.syncing': { en: "Syncing the page…", es: "Sincronizando la página…" },
  'history.why.offline': { en: "Needs a connection", es: "Necesita conexión" },
  'history.why.pending': {
    en: "This device has changes to this page that aren't synced yet",
    es: "Este dispositivo tiene cambios de esta página sin subir",
  },
  'history.why.missing': {
    en: "This device is still downloading this page",
    es: "Este dispositivo todavía está bajando esta página",
  },
  'history.why.shape': {
    en: "Part of this version can't be shown, so it can't be restored",
    es: "Parte de esta versión no se puede mostrar, así que no se puede restaurar",
  },
  'history.why.unknown': {
    en: "This version has something this version of the app doesn't know: update the app",
    es: "Esta versión tiene algo que esta versión de la app no conoce: actualizá la app",
  },
  'history.why.size': {
    en: "This version is too large to restore in one step",
    es: "Esta versión es demasiado grande para restaurarla de una vez",
  },
  'history.why.outdated': { en: "Update the app to restore", es: "Actualizá la app para restaurar" },
  'history.why.cantEdit': { en: "You can't edit this page", es: "No podés editar esta página" },
  'history.why.notOpen': {
    en: "The page isn't open for editing on this device",
    es: "La página no está abierta para editar en este dispositivo",
  },
  'history.restored': { en: "Restored the version from {date}.", es: "Se restauró la versión del {date}." },
  'history.undo': { en: "Undo", es: "Deshacer" },
  'history.undone': { en: "Restore undone.", es: "Se deshizo la restauración." },
  'history.restoreFailed': { en: "Could not restore: {reason}", es: "No se pudo restaurar: {reason}" },
  'history.restoreUnchanged': {
    en: "Couldn't restore this version. Nothing changed.",
    es: "No se pudo restaurar esta versión. No cambió nada.",
  },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(history);
