import { register } from '../index';
import type { Dict } from '../types';

// Exportar una rama o un proyecto como zip (P.22, Docs/Doc_Exportar.md, entrega 2; se carga aparte con la ventana).

export const exportZip = {
  // Lo que va adentro del zip.
  'exportZip.missingNote': {
    en: "Some things are missing: see MISSING_FILES.txt.",
    es: "Faltan algunas cosas: ver MISSING_FILES.txt.",
  },
  'exportZip.missingHead': {
    en: "Missing from “{name}” (exported {date}):",
    es: "Lo que falta en “{name}” (exportado el {date}):",
  },
  'exportZip.why.offline': {
    en: "not on this device and there was no connection",
    es: "no está en este dispositivo y no había conexión",
  },
  'exportZip.why.failed': { en: "could not be downloaded", es: "no se pudo bajar" },
  'exportZip.why.incomplete': { en: "only part of it arrived", es: "llegó solo una parte" },
  'exportZip.why.deleted': { en: "it was sent to the Drive trash", es: "se mandó a la papelera de Drive" },
  'exportZip.why.unknown': {
    en: "this device does not know this file yet (it never showed it and there was no connection)",
    es: "este dispositivo todavía no conoce este archivo (nunca lo mostró y no había conexión)",
  },
  'exportZip.why.noView': { en: "there is no preview of it on this device", es: "no hay una vista de este archivo en el dispositivo" },
  'exportZip.why.pageOutdated': {
    en: "this page may be out of date on this device",
    es: "esta página puede no estar al día en este dispositivo",
  },
  'exportZip.why.pageUnknown': {
    en: "part of this page needs a newer version of the app",
    es: "una parte de esta página necesita una versión más nueva de la app",
  },
  'exportZip.why.pageFailed': { en: "this page could not be exported", es: "no se pudo exportar esta página" },
  'exportZip.why.comments': {
    en: "comments as on this device on {date} (they could not be updated)",
    es: "comentarios como estaban en este dispositivo el {date} (no se pudieron poner al día)",
  },

  // La ventana.
  'exportZip.format': { en: "Format", es: "Formato" },
  'exportZip.zip': { en: "Zip — to archive", es: "Zip — para archivar" },
  'exportZip.adminsOnly': {
    en: "Only the workspace owner and admins can export a zip.",
    es: "Solo el dueño y los admins del workspace pueden exportar un zip.",
  },
  'exportZip.notOnPhone': {
    en: "The zip is made from a computer. On a phone or tablet, export the PDF.",
    es: "El zip se arma desde una computadora. En un teléfono o una tableta, exportá el PDF.",
  },
  'exportZip.zipNote': {
    en: "A folder for each page, with the page to open in any browser, its text, the original files and the comments. It can be imported back into Shot Docs.",
    es: "Una carpeta por página, con la página para abrir en cualquier navegador, su texto, los archivos originales y los comentarios. Se puede volver a importar en Shot Docs.",
  },
  'exportZip.originals': { en: "Original photos", es: "Fotos originales" },
  'exportZip.originalsTip': {
    en: "Without them, each photo is still there as a JPEG preview.",
    es: "Sin ellas, cada foto queda igual como una vista JPEG.",
  },
  'exportZip.attachments': { en: "Attachments", es: "Adjuntos" },
  'exportZip.videos': { en: "Videos", es: "Videos" },
  'exportZip.commentsTip': {
    en: "Comment threads go with each page, with names but never email addresses.",
    es: "Los hilos de comentarios van con cada página, con nombres y nunca correos.",
  },
  'exportZip.weight': { en: "{count} · {size}", es: "{count} · {size}" },
  'exportZip.counting': { en: "Counting the files…", es: "Contando los archivos…" },
  'exportZip.pages': {
    en: { one: "{count} page", other: "{count} pages" },
    es: { one: "{count} página", other: "{count} páginas" },
  },
  'exportZip.files': {
    en: { one: "{count} file", other: "{count} files" },
    es: { one: "{count} archivo", other: "{count} archivos" },
  },
  'exportZip.summary': {
    en: "{pages} · {files} · {size} · previews {previews}",
    es: "{pages} · {files} · {size} · vistas {previews}",
  },
  'exportZip.requests': {
    en: "≈ {count} file server requests · {percent}% of today's limit",
    es: "≈ {count} pedidos al servidor de archivos · {percent} % del límite del día",
  },
  'exportZip.notHere': {
    en: {
      one: "{count} original is not on this device; it will be missing until you are online.",
      other: "{count} originals are not on this device; they will be missing until you are online.",
    },
    es: {
      one: "{count} original no está en este dispositivo; va a faltar hasta que haya conexión.",
      other: "{count} originales no están en este dispositivo; van a faltar hasta que haya conexión.",
    },
  },
  'exportZip.asZip': { en: "Download .zip…", es: "Bajar .zip…" },
  'exportZip.asZipTip': { en: "You choose where it goes; it is written as it is made", es: "Elegís dónde va; se escribe a medida que se arma" },
  'exportZip.toFolder': { en: "Download to a folder…", es: "Bajar a una carpeta…" },
  'exportZip.toFolderTip': {
    en: "The same folders and files, without a zip, inside a new folder in the one you choose",
    es: "Las mismas carpetas y archivos, sin zip, en una carpeta nueva adentro de la que elijas",
  },
  'exportZip.inMemory': { en: "Prepare .zip", es: "Preparar .zip" },
  'exportZip.inMemoryTip': {
    en: "Built in this browser's memory: up to {max}",
    es: "Se arma en la memoria de este navegador: hasta {max}",
  },
  'exportZip.tooBig': {
    en: "Too big for this browser's memory (up to {max}). Make a lighter zip, export a smaller part, or use Chrome or Edge on a computer.",
    es: "Es demasiado para la memoria de este navegador (hasta {max}). Armá un zip más liviano, exportá una parte, o usá Chrome o Edge en una computadora.",
  },
  'exportZip.lighter': { en: "Lighter zip", es: "Zip más liviano" },
  'exportZip.lighterTip': {
    en: "Without original photos and videos: each photo as a JPEG preview",
    es: "Sin fotos originales ni videos: cada foto como una vista JPEG",
  },
  'exportZip.downloading': {
    en: "Downloading files: {done} of {total} ({sent} of {size})",
    es: "Bajando los archivos: {done} de {total} ({sent} de {size})",
  },
  'exportZip.waiting': { en: "No connection: it continues when it comes back.", es: "Sin conexión: sigue cuando vuelva." },
  'exportZip.keepOpen': { en: "Keep this tab open until it finishes.", es: "Dejá esta pestaña abierta hasta que termine." },
  'exportZip.doneFile': { en: "Saved as {name}.", es: "Guardado como {name}." },
  'exportZip.doneDir': { en: "Saved in the folder {name}.", es: "Guardado en la carpeta {name}." },
  'exportZip.ready': { en: "The zip is ready.", es: "El zip está listo." },
  'exportZip.preparingLocal': { en: "Preparing the archive and saving changes on this device…", es: "Preparando el archivo y guardando los cambios en este dispositivo…" },
  'exportZip.selectionChanged': { en: "The pages or their layout changed. Prepare the archive again.", es: "Las páginas o su formato cambiaron. Prepará el archivo de nuevo." },
  'exportZip.save': { en: "Save {name}", es: "Guardar {name}" },
  'exportZip.missing': {
    en: { one: "{count} thing is missing (listed in MISSING_FILES.txt).", other: "{count} things are missing (listed in MISSING_FILES.txt)." },
    es: { one: "Falta {count} cosa (está en MISSING_FILES.txt).", other: "Faltan {count} cosas (están en MISSING_FILES.txt)." },
  },
  'exportZip.showList': { en: "Show list", es: "Ver la lista" },
  'exportZip.hideList': { en: "Hide list", es: "Ocultar la lista" },
  'exportZip.failed': { en: "The zip could not be made: {reason}", es: "No se pudo armar el zip: {reason}" },
  'exportZip.cancelled': { en: "Cancelled: nothing was saved.", es: "Cancelado: no se guardó nada." },
  'exportZip.cancelledDir': {
    en: "Cancelled. What was already written stays in the folder.",
    es: "Cancelado. Lo que ya se escribió queda en la carpeta.",
  },
} satisfies Dict;

register(exportZip);
