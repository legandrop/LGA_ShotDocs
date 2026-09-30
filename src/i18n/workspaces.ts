import type { Dict } from './types';

// Los workspaces: bienvenida, unirse, crear con la guía, cambiar, quitar del dispositivo y cuando sacan a alguien.

export const workspaces = {
  'workspaces.title': { en: "Workspaces", es: "Workspaces" },
  'workspaces.joinOrCreate': { en: "Join or create a workspace…", es: "Unirse a un workspace o crear uno…" },
  'workspaces.removeNamed': { en: "Remove “{name}” from this device…", es: "Quitar “{name}” de este dispositivo…" },
  'workspaces.signInToFinish': { en: "sign in to finish", es: "entrá para terminar" },
  'workspaces.joinEllipsis': { en: "Join a workspace…", es: "Unirse a un workspace…" },
  'workspaces.createEllipsis': { en: "Create a workspace…", es: "Crear un workspace…" },
  'leave.unsaved': {
    en: "Some of your latest edits are not saved on this device yet. Wait a moment and try again.",
    es: "Algunos de tus últimos cambios todavía no se guardaron en este dispositivo. Esperá un momento y probá de nuevo.",
  },
  'leave.pending': {
    en: { one: "{count} change in {name} is not uploaded yet. It stays saved on this device and uploads the next time you open {name}. Continue?", other: "{count} changes in {name} are not uploaded yet. They stay saved on this device and upload the next time you open {name}. Continue?" },
    es: { one: "Hay {count} cambio en {name} sin subir. Queda guardado en este dispositivo y se sube la próxima vez que abras {name}. ¿Seguir?", other: "Hay {count} cambios en {name} sin subir. Quedan guardados en este dispositivo y se suben la próxima vez que abras {name}. ¿Seguir?" },
  },
  'leave.settings': {
    en: "Your appearance settings in {name} are not uploaded yet. They stay saved on this device and upload the next time you open {name}. Continue?",
    es: "Tus preferencias de apariencia en {name} todavía no se subieron. Quedan guardadas en este dispositivo y se suben la próxima vez que abras {name}. ¿Seguir?",
  },
  'leave.both': {
    en: { one: "{count} change and your appearance settings in {name} are not uploaded yet. They stay saved on this device and upload the next time you open {name}. Continue?", other: "{count} changes and your appearance settings in {name} are not uploaded yet. They stay saved on this device and upload the next time you open {name}. Continue?" },
    es: { one: "Hay {count} cambio y tus preferencias de apariencia en {name} sin subir. Quedan guardados en este dispositivo y se suben la próxima vez que abras {name}. ¿Seguir?", other: "Hay {count} cambios y tus preferencias de apariencia en {name} sin subir. Quedan guardados en este dispositivo y se suben la próxima vez que abras {name}. ¿Seguir?" },
  },
  'removeWs.label': { en: "Remove workspace", es: "Quitar workspace" },
  'removeWs.title': { en: "Remove “{name}” from this device", es: "Quitar “{name}” de este dispositivo" },
  'removeWs.text': {
    en: "This deletes what this device keeps of {name} for {email} and signs you out of it. Nothing changes on the server or for anyone else.",
    es: "Esto borra lo que este dispositivo guarda de {name} para {email} y cierra tu sesión ahí. No cambia nada en el servidor ni para nadie más.",
  },
  'removeWs.pending': {
    en: { one: "This device has {count} change that was never uploaded.", other: "This device has {count} changes that were never uploaded." },
    es: { one: "Este dispositivo tiene {count} cambio que nunca se subió.", other: "Este dispositivo tiene {count} cambios que nunca se subieron." },
  },
  'removeWs.uploadOrDownload': {
    en: "Open the workspace with internet until they upload, or download them first.",
    es: "Abrí el workspace con internet hasta que se suban, o descargalos antes.",
  },
  'removeWs.uploadOrDownloadMedia': {
    en: "Open the workspace with internet until they upload, or download them first: the file, and each photo or video below.",
    es: "Abrí el workspace con internet hasta que se suban, o descargalos antes: el archivo, y cada foto o video de abajo.",
  },
  'removeWs.allUploaded': {
    en: "Everything on this device was already uploaded.",
    es: "Todo lo de este dispositivo ya se subió.",
  },
  'removeWs.warning': {
    en: { one: "The {count} change that was never uploaded will only be in what you downloaded.", other: "The {count} changes that were never uploaded will only be in what you downloaded." },
    es: { one: "El cambio que nunca se subió va a quedar solo en lo que descargaste.", other: "Los {count} cambios que nunca se subieron van a quedar solo en lo que descargaste." },
  },
  'removeWs.warningMedia': {
    en: { one: "The {count} change that was never uploaded will only be in what you downloaded (the file and the photos and videos).", other: "The {count} changes that were never uploaded will only be in what you downloaded (the file and the photos and videos)." },
    es: { one: "El cambio que nunca se subió va a quedar solo en lo que descargaste (el archivo y las fotos y videos).", other: "Los {count} cambios que nunca se subieron van a quedar solo en lo que descargaste (el archivo y las fotos y videos)." },
  },
  'removeWs.confirm': {
    en: "Remove “{name}” from this device? {warning}You can join it again later with an invitation link.",
    es: "¿Quitar “{name}” de este dispositivo? {warning}Después podés volver a unirte con un link de invitación.",
  },
  'removeWs.blocked': {
    en: "Close other tabs or windows of the app on this device, then reload and try again.",
    es: "Cerrá las otras pestañas o ventanas de la app en este dispositivo, después recargá y probá de nuevo.",
  },
  'removed.title': { en: "You no longer have access to this workspace", es: "Ya no tenés acceso a este workspace" },
  'removed.text': {
    en: "The owner or an admin of {name} removed {email}. Nothing was sent or changed since then.",
    es: "El dueño o un admin de {name} quitó a {email}. Desde entonces no se mandó ni se cambió nada.",
  },
  'removed.checking': { en: "Checking this device…", es: "Revisando este dispositivo…" },
  'removed.pending': {
    en: { one: "This device has {count} change that was never uploaded", other: "This device has {count} changes that were never uploaded" },
    es: { one: "Este dispositivo tiene {count} cambio que nunca se subió", other: "Este dispositivo tiene {count} cambios que nunca se subieron" },
  },
  'removed.downloadFirst': {
    en: "Download them before removing this workspace from the device.",
    es: "Descargalos antes de quitar este workspace del dispositivo.",
  },
  'removed.downloadAgain': { en: "Download again", es: "Descargar de nuevo" },
  'removed.allUploaded': {
    en: "Everything on this device was already uploaded. You can remove it from here.",
    es: "Todo lo de este dispositivo ya se subió. Podés quitarlo de acá.",
  },
  'removed.mediaKept': {
    en: "The storage for photos and videos could not be opened on this device, so it may still hold originals that were never uploaded. It stays on this device; everything else is removed.",
    es: "No se pudo abrir el almacenamiento de fotos y videos en este dispositivo, así que puede tener originales que nunca se subieron. Queda en este dispositivo; todo lo demás se borra.",
  },
  'removed.removing': { en: "Removing…", es: "Quitando…" },
  'removed.remove': { en: "Remove from this device", es: "Quitar de este dispositivo" },
  'removed.signOutKeep': {
    en: "Sign out and keep it on this device",
    es: "Cerrar sesión y dejarlo en este dispositivo",
  },
  'removed.mediaList': {
    en: "The file does not include the original photos and videos. Download each one:",
    es: "El archivo no trae las fotos y los videos originales. Descargá cada uno:",
  },
  'removed.downloaded': { en: "downloaded", es: "descargado" },
  'removed.downloadFailed': {
    en: "The file could not be made ({reason}). Nothing was deleted.",
    es: "No se pudo armar el archivo ({reason}). No se borró nada.",
  },
  'removed.mediaGone': {
    en: "“{name}” is not on this device anymore.",
    es: "“{name}” ya no está en este dispositivo.",
  },
  'removed.confirmNotDownloaded': {
    en: { one: "{count} change on this device was never uploaded, and you have not downloaded it. Removing deletes it for good. Remove anyway?", other: "{count} changes on this device were never uploaded, and you have not downloaded them. Removing deletes them for good. Remove anyway?" },
    es: { one: "Hay {count} cambio en este dispositivo que nunca se subió, y no lo descargaste. Quitarlo lo borra para siempre. ¿Quitar igual?", other: "Hay {count} cambios en este dispositivo que nunca se subieron, y no los descargaste. Quitarlo los borra para siempre. ¿Quitar igual?" },
  },
  'removed.confirmMediaLeft': {
    en: { one: "{count} change on this device was never uploaded, and you have not downloaded {left} of the photos and videos. Removing deletes them for good. Remove anyway?", other: "{count} changes on this device were never uploaded, and you have not downloaded {left} of the photos and videos. Removing deletes them for good. Remove anyway?" },
    es: { one: "Hay {count} cambio en este dispositivo que nunca se subió, y no descargaste {left} de las fotos y videos. Quitarlo los borra para siempre. ¿Quitar igual?", other: "Hay {count} cambios en este dispositivo que nunca se subieron, y no descargaste {left} de las fotos y videos. Quitarlo los borra para siempre. ¿Quitar igual?" },
  },
  'removed.blocked': {
    en: "Close other tabs or windows of the app on this device, then tap “Remove from this device” again.",
    es: "Cerrá las otras pestañas o ventanas de la app en este dispositivo y tocá otra vez “Quitar de este dispositivo”.",
  },
  'removed.failed': {
    en: "Could not remove everything ({reason}). Reload the app and try again.",
    es: "No se pudo quitar todo ({reason}). Recargá la app y probá de nuevo.",
  },
  'unsynced.pages': {
    en: { one: "{count} page", other: "{count} pages" },
    es: { one: "{count} página", other: "{count} páginas" },
  },
  'unsynced.pageChanges': {
    en: { one: "{count} page changes", other: "{count} page changes" },
    es: { one: "{count} cambio de páginas", other: "{count} cambios de páginas" },
  },
  'unsynced.images': {
    en: { one: "{count} image", other: "{count} images" },
    es: { one: "{count} imagen", other: "{count} imágenes" },
  },
  'unsynced.media': {
    en: { one: "{count} photos or videos", other: "{count} photos or videos" },
    es: { one: "{count} foto o video", other: "{count} fotos o videos" },
  },
  'unsynced.comments': {
    en: { one: "{count} comment", other: "{count} comments" },
    es: { one: "{count} comentario", other: "{count} comentarios" },
  },
} satisfies Dict;
