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
  'exportPdf.comments': { en: "Comments", es: "Comentarios" },
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
    en: "One PDF with a contents page that links to each page; every page keeps its page size and sheet breaks.",
    es: "Un solo PDF con un índice que lleva a cada página; cada página sale con su tamaño de hoja y sus cortes.",
  },
  'exportDialog.sharp': { en: "Sharp photos", es: "Fotos nítidas" },
  'exportDialog.sharpTip': {
    en: "Photos that only have a small preview on this device are fetched from Drive (slower).",
    es: "Las fotos que en este dispositivo solo tienen la miniatura se piden al Drive (tarda más).",
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
  'exportDialog.tooManyPages': {
    en: "{count} pages are too many for one PDF on this device (up to {limit}). Export a smaller part:",
    es: "{count} páginas son demasiadas para un PDF en este dispositivo (hasta {limit}). Exportá una parte:",
  },
  'exportDialog.tooManyPhotos': {
    en: "There are too many photos for one PDF on this device. Export a smaller part:",
    es: "Hay demasiadas fotos para un PDF en este dispositivo. Exportá una parte:",
  },
  'exportDialog.branch': {
    en: { one: "{title} · {count} page", other: "{title} · {count} pages" },
    es: { one: "{title} · {count} página", other: "{title} · {count} páginas" },
  },
  'exportDialog.empty': { en: "There is nothing to export here.", es: "Acá no hay nada para exportar." },
  'exportDialog.export': { en: "Export PDF", es: "Exportar PDF" },
  'exportDialog.preparing': { en: "Preparing page {done} of {total}: {title}", es: "Preparando la página {done} de {total}: {title}" },
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
