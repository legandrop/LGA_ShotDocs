import { register } from '../index';
import type { Dict } from '../types';

// La ventana "Available offline" y "Storage on this device" (P.10, Docs/Doc_Copias_Locales.md; se cargan aparte).

export const offline = {
  'offlineDialog.title': { en: "Available offline", es: "Disponible sin conexión" },
  'offlineDialog.page': {
    en: { one: "{title} (and {count} page inside)", other: "{title} (and {count} pages inside)" },
    es: { one: "{title} (y {count} página adentro)", other: "{title} (y {count} páginas adentro)" },
  },
  'offlineDialog.project': {
    en: { one: "{title} · {count} page", other: "{title} · {count} pages" },
    es: { one: "{title} · {count} página", other: "{title} · {count} páginas" },
  },
  'offlineDialog.coveredBy': {
    en: "Already offline with “{title}”. You can add more here.",
    es: "Ya está disponible sin conexión con “{title}”. Acá podés sumar más.",
  },
  'offlineDialog.sharp': { en: "Large photos (2048 px)", es: "Fotos en grande (2048 px)" },
  'offlineDialog.originals': { en: "Original photos", es: "Fotos originales" },
  'offlineDialog.attachments': { en: "Attachments up to 50 MB", es: "Adjuntos de hasta 50 MB" },
  'offlineDialog.videos': { en: "Videos", es: "Videos" },
  'offlineDialog.photos': {
    en: { one: "{count} photo", other: "{count} photos" },
    es: { one: "{count} foto", other: "{count} fotos" },
  },
  'offlineDialog.files': {
    en: { one: "{count} file", other: "{count} files" },
    es: { one: "{count} archivo", other: "{count} archivos" },
  },
  'offlineDialog.videoCount': {
    en: { one: "{count} video", other: "{count} videos" },
    es: { one: "{count} video", other: "{count} videos" },
  },
  'offlineDialog.present': { en: "{size} already on this device", es: "{size} ya en este dispositivo" },
  'offlineDialog.over': {
    en: { one: "{count} over 50 MB is not included", other: "{count} over 50 MB are not included" },
    es: { one: "{count} de más de 50 MB no se incluye", other: "{count} de más de 50 MB no se incluyen" },
  },
  'offlineDialog.ownUnkept': {
    en: {
      one: "{count} original already on this device ({size}) · kept only if checked",
      other: "{count} originals already on this device ({size}) · kept only if checked",
    },
    es: {
      one: "{count} original ya en este dispositivo ({size}) · queda solo si se tilda",
      other: "{count} originales ya en este dispositivo ({size}) · quedan solo si se tilda",
    },
  },
  'offlineDialog.cantLarge': {
    en: {
      one: "{count} photo can't be made large here: only with Original photos",
      other: "{count} photos can't be made large here: only with Original photos",
    },
    es: {
      one: "{count} foto no se puede hacer en grande acá: solo con Fotos originales",
      other: "{count} fotos no se pueden hacer en grande acá: solo con Fotos originales",
    },
  },
  'offlineDialog.extras': { en: "Thumbnails, older images and comments", es: "Miniaturas, imágenes viejas y comentarios" },
  'offlineDialog.calculating': { en: "Calculating", es: "Calculando" },
  'offlineDialog.pagesWaiting': {
    en: { one: "{count} page is still downloading: sizes may grow.", other: "{count} pages are still downloading: sizes may grow." },
    es: {
      one: "{count} página todavía se está bajando: los pesos pueden crecer.",
      other: "{count} páginas todavía se están bajando: los pesos pueden crecer.",
    },
  },
  'offlineDialog.needsUpdate': {
    en: { one: "{count} page needs an app update.", other: "{count} pages need an app update." },
    es: { one: "{count} página necesita una versión más nueva de la app.", other: "{count} páginas necesitan una versión más nueva de la app." },
  },
  'offlineDialog.selected': { en: "Selected: {size} · downloads {network}", es: "Lo elegido: {size} · baja {network}" },
  'offlineDialog.available': { en: "Available to Shot Docs on this device: {size}", es: "Lo que este dispositivo le deja a Shot Docs: {size}" },
  'offlineDialog.offlineNow': { en: "Offline in this workspace: {now} → {after}", es: "Sin conexión en este workspace: {now} → {after}" },
  'offlineDialog.kept': { en: "Kept automatically: {kept} of {limit}", es: "Guardado automáticamente: {kept} de {limit}" },
  'offlineDialog.keptNoLimit': { en: "Kept automatically: {kept} (no limit)", es: "Guardado automáticamente: {kept} (sin tope)" },
  'offlineDialog.notPersisted': {
    en: "This browser may erase what is saved here if it runs out of space.",
    es: "Este navegador puede borrar lo guardado acá si se queda sin lugar.",
  },
  'offlineDialog.installFirst': {
    en: "Safari may erase this if you don't open the app for 7 days. Add Shot Docs to your Home Screen first: the installed app keeps its own copy.",
    es: "Safari puede borrar esto si no abrís la app en 7 días. Primero agregá Shot Docs a la pantalla de inicio: la app instalada guarda su propia copia.",
  },
  'offlineDialog.keepOpen': { en: "Keep the app open until it's ready.", es: "Dejá la app abierta hasta que esté lista." },
  'offlineDialog.make': { en: "Make available offline", es: "Hacer disponible sin conexión" },
  'offlineDialog.freeAndMake': { en: "Free up {size} and make available offline", es: "Liberar {size} y hacer disponible sin conexión" },
  'offlineDialog.save': { en: "Save", es: "Guardar" },
  'offlineDialog.needsRoom': {
    en: "Needs {needed}; {available} available, keeping {reserve} for new photos and videos.",
    es: "Hace falta {needed}; hay {available}, y quedan {reserve} para fotos y videos nuevos.",
  },
  'offlineDialog.iosRoom': {
    en: "On this iPhone, offline pages can use up to {limit} for now ({used} in use).",
    es: "En este iPhone, lo disponible sin conexión puede usar hasta {limit} por ahora (hay {used} en uso).",
  },
  'offlineDialog.connect': { en: "Connect to download.", es: "Conectate para bajar." },
  'offlineDialog.progress': {
    en: "Downloading {done} of {total} · {bytesDone} of {bytesTotal}",
    es: "Bajando {done} de {total} · {bytesDone} de {bytesTotal}",
  },
  'offlineDialog.ready': { en: "Ready to use offline", es: "Listo para usar sin conexión" },
  'offlineDialog.readyAt': { en: "Ready · updated {when}", es: "Listo · actualizado {when}" },
  'offlineDialog.waiting': { en: "Waiting to download", es: "Esperando para bajar" },
  'offlineDialog.offlineState': { en: "Waiting for a connection", es: "Esperando conexión" },
  'offlineDialog.unavailable': {
    en: { one: "{count} file is not available", other: "{count} files are not available" },
    es: { one: "{count} archivo no está disponible", other: "{count} archivos no están disponibles" },
  },
  'offlineDialog.stillUploading': {
    en: { one: "{count} file is still uploading from another device", other: "{count} files are still uploading from another device" },
    es: { one: "{count} archivo todavía se está subiendo desde otro dispositivo", other: "{count} archivos todavía se están subiendo desde otro dispositivo" },
  },
  'offlineDialog.hide': { en: "Hide", es: "Ocultar" },
  'offlineDialog.stop': { en: "Stop", es: "Parar" },
  'offlineDialog.updateNow': { en: "Update now", es: "Actualizar ahora" },
  'offlineDialog.tryAgain': { en: "Try again", es: "Probar de nuevo" },
  'offlineDialog.remove': { en: "Remove", es: "Sacar" },
  'offlineDialog.removeTitle': {
    en: "Stop keeping “{title}” offline?",
    es: "¿Dejar de tener “{title}” sin conexión?",
  },
  'offlineDialog.removeText': {
    en: "The downloaded copies ({size}) will be removed from this device. Everything stays in Drive.",
    es: "Las copias bajadas ({size}) se borran de este dispositivo. Todo sigue en Drive.",
  },
  'offlineDialog.removeCopies': { en: "Remove the copies now", es: "Borrar las copias ahora" },
  'storage.title': { en: "Storage on this device", es: "Espacio en este dispositivo" },
  'storage.uses': { en: "Shot Docs uses {usage} · {available} available to it on this device", es: "Shot Docs usa {usage} · le quedan {available} en este dispositivo" },
  'storage.persisted': { en: "Protected from being erased by the browser", es: "Protegido: el navegador no lo borra solo" },
  'storage.kept': { en: "Kept automatically", es: "Guardado automáticamente" },
  'storage.keptOf': { en: "{kept} of {limit}", es: "{kept} de {limit}" },
  'storage.keptHelp': {
    en: "Copies of files already in Drive. Past the limit, Shot Docs asks before removing the ones opened least recently; the thumbnails stay.",
    es: "Copias de archivos que ya están en Drive. Pasado el tope, Shot Docs pregunta antes de borrar las que hace más que no se abren; las miniaturas quedan.",
  },
  'storage.limit': { en: "Limit", es: "Tope" },
  'storage.noLimit': { en: "No limit", es: "Sin tope" },
  'storage.limitOverHalf': {
    en: "More than half of what this browser gives Shot Docs.",
    es: "Más de la mitad de lo que este navegador le da a Shot Docs.",
  },
  'storage.waiting': {
    en: { one: "Waiting to upload: {size} ({count} file) · can't be removed yet", other: "Waiting to upload: {size} ({count} files) · can't be removed yet" },
    es: { one: "Esperando subir: {size} ({count} archivo) · todavía no se puede borrar", other: "Esperando subir: {size} ({count} archivos) · todavía no se pueden borrar" },
  },
  'storage.freeUp': { en: "Free up space", es: "Liberar espacio" },
  'storage.freeConfirm': {
    en: "Free up {size}? Files stay in Drive. Without a connection, this device will only show their thumbnails.",
    es: "¿Liberar {size}? Los archivos siguen en Drive. Sin conexión, este dispositivo va a mostrar solo sus miniaturas.",
  },
  'storage.nothingToFree': { en: "Nothing to free up right now.", es: "Ahora no hay nada para liberar." },
  'storage.ownLater': {
    en: "Photos and videos added on this device stay for now: freeing them comes in a later version.",
    es: "Las fotos y los videos agregados en este dispositivo quedan por ahora: liberarlos llega en una versión próxima.",
  },
  'storage.offline': { en: "Available offline", es: "Disponible sin conexión" },
  'storage.noMarks': {
    en: "Nothing yet. Use “Available offline…” in the menu of a page or a project.",
    es: "Nada todavía. Usá “Disponible sin conexión…” en el menú de una página o de un proyecto.",
  },
  'storage.edit': { en: "Edit…", es: "Editar…" },
  'storage.gone': { en: "Only copy on this device", es: "Única copia en este dispositivo" },
  'storage.goneHelp': {
    en: { one: "Google Drive no longer has this file.", other: "Google Drive no longer has these files." },
    es: { one: "Google Drive ya no tiene este archivo.", other: "Google Drive ya no tiene estos archivos." },
  },
  'storage.saveCopy': { en: "Save a copy", es: "Guardar una copia" },
  'storage.removeGone': { en: "Remove from this device", es: "Sacar de este dispositivo" },
  'storage.removeGoneConfirm': {
    en: "This is the only copy we know of. Remove it from this device?",
    es: "Es la única copia que conocemos. ¿Sacarla de este dispositivo?",
  },
  'storage.other': { en: "Other app data: {size}", es: "Otros datos de la app: {size}" },
  'storageTest.title': { en: "Storage test", es: "Prueba de espacio" },
  'storageTest.intro': {
    en: "Measures how much this browser lets Shot Docs save on this device. Fill writes test data (never your pages) until the browser says there is no room; Clean up removes all of it. Check the free space in the device settings before and after.",
    es: "Mide cuánto deja guardar este navegador a Shot Docs en este dispositivo. Llenar escribe datos de prueba (nunca tus páginas) hasta que el navegador dice que no hay lugar; Limpiar borra todo eso. Mirá el lugar libre en los ajustes del dispositivo antes y después.",
  },
  'storageTest.quota': { en: "Quota (estimate): {size}", es: "Cuota (estimate): {size}" },
  'storageTest.usage': { en: "In use (estimate): {size}", es: "En uso (estimate): {size}" },
  'storageTest.persisted': { en: "Persistent storage: {value}", es: "Almacenamiento persistente: {value}" },
  'storageTest.standalone': { en: "Installed app: {value}", es: "App instalada: {value}" },
  'storageTest.written': { en: "Test data written: {size}", es: "Datos de prueba escritos: {size}" },
  'storageTest.stoppedWith': { en: "Stopped with: {error}", es: "Se cortó con: {error}" },
  'storageTest.typeFill': { en: "Type fill to start:", es: "Escribí fill para empezar:" },
  'storageTest.fill': { en: "Fill", es: "Llenar" },
  'storageTest.clean': { en: "Clean up", es: "Limpiar" },
  'storageTest.back': { en: "Back to the app", es: "Volver a la app" },
  'storage.measure': { en: "Measure storage on this device…", es: "Medir el espacio de este dispositivo…" },
} satisfies Dict;

register(offline);
