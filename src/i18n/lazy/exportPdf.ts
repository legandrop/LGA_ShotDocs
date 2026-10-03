import { register } from '../index';
import type { Dict } from '../types';

// Exportar una rama o un proyecto como PDF (P.22, Docs/Doc_Exportar.md; se carga aparte con la ventana).

export const exportPdf = {
  // Lo que va adentro del PDF.
  'exportPdf.contents': { en: "Contents", es: "Índice" },
  'exportPdf.exported': { en: "Exported {date}", es: "Exportado el {date}" },
  'exportPdf.asOf': { en: "as on this device on {date}", es: "como estaba en este dispositivo el {date}" },
  'exportPdf.outdated': {
    en: "This page may be out of date on this device.",
    es: "Esta página puede no estar al día en este dispositivo.",
  },
  'exportPdf.unknown': {
    en: "Part of this page needs a newer version of the app and is not included.",
    es: "Una parte de esta página necesita una versión más nueva de la app y no está incluida.",
  },
  'exportPdf.failedPage': { en: "This page could not be exported.", es: "No se pudo exportar esta página." },
  'exportPdf.failedPhotos': {
    en: "This page could not be exported: it has too many photos for one PDF on this device.",
    es: "No se pudo exportar esta página: tiene demasiadas fotos para un PDF en este dispositivo.",
  },
  'exportPdf.shrunkToFit': {
    en: "This page has too many photos for one PDF at full resolution: they are at a lower resolution.",
    es: "Esta página tiene demasiadas fotos para un PDF en resolución completa: van en menor resolución.",
  },
  'exportPdf.part': { en: "Part {part} · pages {first} to {last} of {total}", es: "Parte {part} · páginas {first} a {last} de {total}" },
  'exportPdf.partName': { en: "Part {part}", es: "Parte {part}" },
  'exportPdf.comments': { en: "Comments", es: "Comentarios" },
  'exportPdf.commentsAsOf': {
    en: "Some comments could not be updated: they are as on this device on {date}.",
    es: "Algunos comentarios no se pudieron poner al día: están como en este dispositivo el {date}.",
  },
  'exportPdf.onPage': { en: "On the page", es: "En la página" },
  'exportPdf.resolved': { en: "Resolved", es: "Resuelto" },
  'exportPdf.deletedComment': { en: "(deleted comment)", es: "(comentario borrado)" },
  'exportPdf.deletedAccount': { en: "Deleted account", es: "Cuenta borrada" },
  'exportPdf.someone': { en: "Someone", es: "Alguien" },

  // La ventana.
  'exportDialog.title': { en: "Export “{title}”", es: "Exportar “{title}”" },
  'exportDialog.what': { en: "What", es: "Qué" },
  'exportDialog.thisPage': { en: "This page", es: "Esta página" },
  'exportDialog.withInside': {
    en: { one: "This page and the page inside ({count})", other: "This page and the pages inside ({count})" },
    es: { one: "Esta página y la de adentro ({count})", other: "Esta página y las de adentro ({count})" },
  },
  'exportDialog.project': {
    en: { one: "The whole project ({count} page)", other: "The whole project ({count} pages)" },
    es: { one: "El proyecto entero ({count} página)", other: "El proyecto entero ({count} páginas)" },
  },
  'exportDialog.pdf': { en: "PDF — to share", es: "PDF — para compartir" },
  'exportDialog.pdfNote': {
    en: "One PDF with a contents page that links to each page; every page keeps its page size and sheet breaks. Photos go as they were taken, at full resolution. If it is too much for one PDF on this device, it comes out in parts (Part 1, Part 2…), split between pages.",
    es: "Un solo PDF con un índice que lleva a cada página; cada página sale con su tamaño de hoja y sus cortes. Las fotos van como se tomaron, en resolución completa. Si es demasiado para un PDF en este dispositivo, sale en partes (Parte 1, Parte 2…), cortadas entre páginas.",
  },
  'exportDialog.smaller': { en: "Smaller file (lower-resolution photos)", es: "Archivo más liviano (fotos en menor resolución)" },
  'exportDialog.smallerTip': {
    en: "Each photo is reduced to its printed size: a much lighter PDF, faster to make and usually in one part.",
    es: "Cada foto se achica a su tamaño impreso: un PDF mucho más liviano, más rápido y casi siempre en una sola parte.",
  },
  'exportDialog.offlineOriginals': {
    en: "No connection: photos whose original is not on this device go at a lower resolution.",
    es: "Sin conexión: las fotos cuyo original no está en este dispositivo van en menor resolución.",
  },
  'exportDialog.comments': { en: "Comments", es: "Comentarios" },
  'exportDialog.commentsTip': {
    en: "Each page ends with its comment threads, with names but never email addresses.",
    es: "Cada página termina con sus hilos de comentarios, con nombres y nunca correos.",
  },
  'exportDialog.oneSize': {
    en: "This browser prints every page at {size}. Chrome or Edge on a computer keep each page size.",
    es: "Este navegador imprime todas las páginas en {size}. Chrome o Edge en una computadora respetan la hoja de cada página.",
  },
  'exportDialog.margins': {
    en: "In the print dialog, leave margins and scale as they are: the page numbers in the contents depend on them.",
    es: "En el diálogo de imprimir, dejá los márgenes y la escala como están: de eso dependen los números de hoja del índice.",
  },
  'exportDialog.empty': { en: "There is nothing to export here.", es: "Acá no hay nada para exportar." },
  // Los links a los archivos con un link público (P.30, Docs/Doc_Links_PDF.md, 3.3, LF18).
  'exportDialog.fileLinksView': {
    en: "File links in this PDF use the public link of “{title}”: anyone with the PDF can open that page and the pages inside it.",
    es: "Los links a los archivos de este PDF usan el link público de «{title}»: cualquiera con el PDF puede abrir esa página y las de adentro.",
  },
  'exportDialog.fileLinksEdit': {
    en: "File links in this PDF use the public link of “{title}”: anyone with the PDF can open that page and the pages inside it, and edit them.",
    es: "Los links a los archivos de este PDF usan el link público de «{title}»: cualquiera con el PDF puede abrir esa página y las de adentro, y editarlas.",
  },
  'exportDialog.fileLinksExpires': { en: "That link expires on {date}.", es: "Ese link vence el {date}." },
  'exportDialog.fileLinksLevel': {
    en: "Changing a link's level also changes what PDFs that use it can open. Reset link turns them off.",
    es: "Cambiar el nivel de un link cambia también lo que abren los PDF que lo usan. Reset link los apaga.",
  },
  'exportDialog.useFileLinks': { en: "Use the public link for file links", es: "Usar el link público en los links a archivos" },
  'exportDialog.fileLinksOff': {
    en: "Without it, file links ask to sign in.",
    es: "Sin él, los links a archivos piden entrar con una cuenta.",
  },
  'exportDialog.offlineFileLinks': {
    en: "No connection: file links in this PDF can't use the public link of the page, even if it has one. They ask to sign in.",
    es: "Sin conexión: los links a los archivos de este PDF no pueden usar el link público de la página, aunque tenga uno. Piden entrar con una cuenta.",
  },
  'exportDialog.export': { en: "Export PDF", es: "Exportar PDF" },
  'exportDialog.fetchingComments': { en: "Fetching comments: page {done} of {total}", es: "Bajando los comentarios: página {done} de {total}" },
  'exportDialog.commentsStale': {
    en: { one: "The comments of {count} page could not be updated (no connection): it has the ones on this device.", other: "The comments of {count} pages could not be updated (no connection): they have the ones on this device." },
    es: { one: "Los comentarios de {count} página no se pudieron poner al día (sin conexión): lleva los de este dispositivo.", other: "Los comentarios de {count} páginas no se pudieron poner al día (sin conexión): llevan los de este dispositivo." },
  },
  'exportDialog.preparing': { en: "Preparing page {done} of {total}: {title}", es: "Preparando la página {done} de {total}: {title}" },
  'exportDialog.preparingPart': {
    en: "Part {part} · preparing page {done} of {total}: {title}",
    es: "Parte {part} · preparando la página {done} de {total}: {title}",
  },
  'exportDialog.partReady': {
    en: { one: "Part {part} ready: pages {first} to {last} of {total} · {count} PDF page.", other: "Part {part} ready: pages {first} to {last} of {total} · {count} PDF pages." },
    es: { one: "Parte {part} lista: páginas {first} a {last} de {total} · {count} hoja.", other: "Parte {part} lista: páginas {first} a {last} de {total} · {count} hojas." },
  },
  'exportDialog.nextPart': { en: "Prepare part {part}", es: "Preparar la parte {part}" },
  'exportDialog.nextPartNote': {
    en: "Save this part first: preparing the next one replaces it.",
    es: "Guardá primero esta parte: al preparar la siguiente, esta se suelta.",
  },
  'exportDialog.lastPart': { en: "This is the last part.", es: "Es la última parte." },
  'exportDialog.lowRes': {
    en: { one: "{count} photo is at a lower resolution: its original was not available (no connection, or the browser cannot open it).", other: "{count} photos are at a lower resolution: their originals were not available (no connection, or the browser cannot open them)." },
    es: { one: "{count} foto va en menor resolución: su original no estaba a mano (sin conexión, o el navegador no lo abre).", other: "{count} fotos van en menor resolución: sus originales no estaban a mano (sin conexión, o el navegador no los abre)." },
  },
  'exportDialog.shrunkPages': {
    en: { one: "{count} page has too many photos for one PDF: its photos are at a lower resolution.", other: "{count} pages have too many photos for one PDF: their photos are at a lower resolution." },
    es: { one: "{count} página tiene demasiadas fotos para un PDF: sus fotos van en menor resolución.", other: "{count} páginas tienen demasiadas fotos para un PDF: sus fotos van en menor resolución." },
  },
  'exportDialog.failedList': { en: "These pages could not be exported in full:", es: "Estas páginas no se pudieron exportar enteras:" },
  'exportDialog.failedTooBig': { en: "too many photos for one PDF", es: "demasiadas fotos para un PDF" },
  'exportDialog.failedTimeout': {
    en: "some photos took too long to download and are at a lower resolution",
    es: "algunas fotos tardaron demasiado en bajar y van en menor resolución",
  },
  'exportDialog.printFirst': {
    en: "Open the print dialog and save this PDF first: this replaces it.",
    es: "Abrí primero el diálogo de imprimir y guardá este PDF: esto lo reemplaza.",
  },
  'exportDialog.retry': { en: "Export again", es: "Exportar de nuevo" },
  'exportDialog.retryLabel': { en: "Export “{title}” again, on its own", es: "Exportar “{title}” de nuevo, sola" },
  'exportDialog.ready': {
    en: { one: "Ready: {count} PDF page.", other: "Ready: {count} PDF pages." },
    es: { one: "Listo: {count} hoja.", other: "Listo: {count} hojas." },
  },
  'exportDialog.saveAsPdf': {
    en: "In the print dialog, choose Save as PDF.",
    es: "En el diálogo de imprimir, elegí Guardar como PDF.",
  },
  'exportDialog.print': { en: "Open the print dialog", es: "Abrir el diálogo de imprimir" },
  'exportDialog.missingPhotos': {
    en: { one: "{count} page has photos that did not load in time and may be blank.", other: "{count} pages have photos that did not load in time and may be blank." },
    es: { one: "{count} página tiene fotos que no cargaron a tiempo y pueden salir en blanco.", other: "{count} páginas tienen fotos que no cargaron a tiempo y pueden salir en blanco." },
  },
  'exportDialog.outdatedPages': {
    en: { one: "{count} page may be out of date on this device (marked in the PDF).", other: "{count} pages may be out of date on this device (marked in the PDF)." },
    es: { one: "{count} página puede no estar al día en este dispositivo (marcada en el PDF).", other: "{count} páginas pueden no estar al día en este dispositivo (marcadas en el PDF)." },
  },
  'exportDialog.unknownPages': {
    en: { one: "{count} page has content that needs a newer version of the app.", other: "{count} pages have content that needs a newer version of the app." },
    es: { one: "{count} página tiene contenido que necesita una versión más nueva de la app.", other: "{count} páginas tienen contenido que necesita una versión más nueva de la app." },
  },
  'exportDialog.failedPages': {
    en: { one: "{count} page could not be exported (marked in the PDF).", other: "{count} pages could not be exported (marked in the PDF)." },
    es: { one: "{count} página no se pudo exportar (marcada en el PDF).", other: "{count} páginas no se pudieron exportar (marcadas en el PDF)." },
  },
  'exportDialog.failed': { en: "The PDF could not be prepared. Try again.", es: "No se pudo preparar el PDF. Probá de nuevo." },
  'exportDialog.dialogFailed': {
    en: "The print dialog could not open. Try again.",
    es: "No se pudo abrir el diálogo de imprimir. Probá de nuevo.",
  },
} satisfies Dict;

register(exportPdf);
