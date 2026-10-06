import { register } from '../index';
import type { Dict } from '../types';

// El historial de versiones de una página (P.18, Docs/Doc_Historial.md). Se carga aparte, con su pantalla.

export const history = {
  'history.annotationsTitle': { en: "Annotation changes", es: "Cambios en anotaciones" },
  'history.annotationsScope': { en: "Drawings only. Compares supported drawings with the previous version; photos are not loaded.", es: "Sólo dibujos. Compara dibujos soportados con la versión anterior; no carga las fotos." },
  'history.annotationsBefore': { en: "Before", es: "Antes" },
  'history.annotationsSelected': { en: "Selected version", es: "Versión elegida" },
  'history.annotationsAbsent': { en: "Photo not in this version", es: "La foto no está en esta versión" },
  'history.annotationsUnavailable': { en: "These annotations cannot be shown", es: "Estas anotaciones no se pueden mostrar" },
  'history.annotationsEmpty': { en: "No supported drawings", es: "Sin dibujos soportados" },
  'history.annotationsPartial': { en: "Partial annotation comparison: some data cannot be represented or exceeds drawing limits.", es: "Comparación parcial: algunos datos no se pueden representar o superan los límites de dibujo." },
  'history.annotationsUnchanged': { en: "No changes to displayed annotations", es: "Sin cambios en las anotaciones representables" },
  'history.annotationsPhoto': { en: "Photo · {id}", es: "Foto · {id}" },
  'history.annotationsCounts': { en: "Added: {added} · Removed: {removed} · Changed: {changed}", es: "Agregadas: {added} · Borradas: {removed} · Cambiadas: {changed}" },
  'history.annotationsFrame': { en: "Drawing frame changed", es: "Cambió el marco del dibujo" },
  'history.annotationsCompareFailed': { en: "Annotation comparison unavailable", es: "La comparación de anotaciones no está disponible" },
  'history.annotated': { en: "Annotated {name}", es: "Anotó {name}" },
  'history.annotationsChanged': { en: "Annotations changed", es: "Cambios en anotaciones" },
  'history.annotationsPending': {
    en: "Show changes compares supported drawings separately from the photos. Restore keeps the current annotations.",
    es: "Mostrar cambios compara los dibujos soportados por separado de las fotos. Restaurar conserva las anotaciones actuales.",
  },
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
  'history.viaLink': { en: "{name} (via link)", es: "{name} (vía link)" },
  // Lo apartado de un link (entrega 2c): se ve en la lista, sin aplicarlo.
  'history.aside': { en: "Set aside (via link)", es: "Apartado (vía link)" },
  'history.asideTitle': {
    en: "A change {name} sent through a link that couldn't be added",
    es: "Un cambio que {name} mandó con un link y no se pudo sumar",
  },
  'history.asideText': {
    en: "It's not on the page and not in any version: it's kept apart. Reason: {reason}.",
    es: "No está en la página ni en ninguna versión: queda aparte. Motivo: {reason}.",
  },
  'history.asideTyped': { en: "What it brings:", es: "Lo que trae:" },
  'history.asideEmpty': { en: "It brings no text.", es: "No trae texto." },
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
  // Una versión que el editor no puede mostrar (ui/ErrorBarrier.tsx): las demás se siguen pudiendo elegir.
  'history.versionCrash': {
    en: "This version can't be shown. Choose another one in the list.",
    es: "Esta versión no se puede mostrar. Elegí otra de la lista.",
  },
  'history.undo': { en: "Undo", es: "Deshacer" },
  'history.undone': { en: "Restore undone.", es: "Se deshizo la restauración." },
  'history.restoreFailed': { en: "Could not restore: {reason}", es: "No se pudo restaurar: {reason}" },
  'history.restoreUnchanged': {
    en: "Couldn't restore this version. Nothing changed.",
    es: "No se pudo restaurar esta versión. No cambió nada.",
  },
  // Entrega 2: los cambios marcados por persona (Show changes) y el texto huérfano.
  'history.showChanges': { en: "Show changes", es: "Mostrar cambios" },
  'history.showChangesShort': { en: "Changes", es: "Cambios" },
  'history.showChangesTip': {
    en: "Compared with the previous version in the list:\nadded is underlined, deleted is struck through,\nin the color of who did it.",
    es: "Comparado con la versión anterior de la lista:\nlo agregado va subrayado y lo borrado tachado,\ncon el color de quien lo hizo.",
  },
  'history.loadingVersion': { en: "Loading the version…", es: "Cargando la versión…" },
  'history.versionFailed': { en: "This version could not be shown: {reason}", es: "No se pudo mostrar esta versión: {reason}" },
  'history.addedBy': { en: "Added by {name} · {when}", es: "Agregado por {name} · {when}" },
  'history.deletedBy': { en: "Deleted by {name} · {when}", es: "Borrado por {name} · {when}" },
  'history.changedBy': { en: "{label} · {name} · {when}", es: "{label} · {name} · {when}" },
  'history.changedTo': { en: "Changed to {kind}", es: "Cambió a {kind}" },
  'history.formatChanged': { en: "Formatting changed", es: "Cambió el formato" },
  'history.moved': { en: "Moved", es: "Se movió" },
  'history.kind.paragraph': { en: "Text", es: "Texto" },
  'history.kind.heading': { en: "Heading {level}", es: "Título {level}" },
  'history.kind.bulletListItem': { en: "Bulleted list", es: "Lista con viñetas" },
  'history.kind.numberedListItem': { en: "Numbered list", es: "Lista numerada" },
  'history.kind.checkListItem': { en: "Checklist", es: "Lista de tareas" },
  'history.kind.toggleListItem': { en: "Toggle list", es: "Lista desplegable" },
  'history.kind.quote': { en: "Quote", es: "Cita" },
  'history.kind.codeBlock': { en: "Code block", es: "Bloque de código" },
  'history.kind.table': { en: "Table", es: "Tabla" },
  'history.kind.image': { en: "Image", es: "Imagen" },
  'history.kind.script': { en: "Script", es: "Guion" },
  'history.kind.question': { en: "Question", es: "Pregunta" },
  'history.kind.pageBreak': { en: "Page break", es: "Salto de hoja" },
  'history.kind.driveCard': { en: "Drive card", es: "Tarjeta de Drive" },
  'history.orphan': {
    en: "{name} wrote in a part that had already been removed (it isn't on the page):",
    es: "{name} escribió en una parte que ya se había borrado (no está en la página):",
  },
  'history.copy': { en: "Copy", es: "Copiar" },
  'history.copyFailed': {
    en: "Couldn't copy: select the text and copy it by hand.",
    es: "No se pudo copiar: elegí el texto y copialo a mano.",
  },
  'history.offlineSaved': {
    en: "Offline: showing the history up to {when}, the last time it was downloaded.",
    es: "Sin conexión: se ve el historial hasta {when}, la última vez que se bajó.",
  },
  'history.onlyNamed': { en: "Only named versions", es: "Solo versiones con nombre" },
  'history.noNamed': { en: "No named versions yet.", es: "Todavía no hay versiones con nombre." },
  'history.versionActions': { en: "Version actions", es: "Acciones de la versión" },
  'history.nameVersion': { en: "Name this version", es: "Ponerle nombre a esta versión" },
  'history.renameVersion': { en: "Rename", es: "Cambiar el nombre" },
  'history.removeName': { en: "Remove name", es: "Quitar el nombre" },
  'history.namePlaceholder': { en: "Version name", es: "Nombre de la versión" },
  'history.nameOffline': {
    en: "Naming versions needs a connection.",
    es: "Para ponerle nombre a una versión hace falta conexión.",
  },
  'history.nameNotAllowed': {
    en: "Only who named it, or someone who can edit and create pages here, can change that name.",
    es: "Ese nombre lo cambia solo quien lo puso, o quien puede editar y crear páginas acá.",
  },
  'history.nameFailed': { en: "Couldn't save the name: {reason}", es: "No se pudo guardar el nombre: {reason}" },
  'history.nameChanged': {
    en: "The names changed on another device: this is how they are now.",
    es: "Los nombres cambiaron en otro dispositivo: así están ahora.",
  },
  'history.restoredFrom': { en: "Restored from {date}", es: "Restaurada desde {date}" },
  'history.restoredPlain': { en: "Restored from an earlier version", es: "Restaurada desde una versión anterior" },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(history);
