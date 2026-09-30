import type { Dict } from './types';

// Las marcas de hoja del editor y la impresión (Docs/Doc_Hojas_PDF.md).

export const print = {
  'print.sheet': { en: "Page {n}", es: "Hoja {n}" },
  'print.preparing': { en: "Preparing the PDF…", es: "Preparando el PDF…" },
  'print.failed': {
    en: "The page could not be prepared for printing. Open it and try again.",
    es: "No se pudo preparar la página para imprimir. Abrila y probá de nuevo.",
  },
  'print.dialogFailed': {
    en: "The print dialog could not open. Try again.",
    es: "No se pudo abrir el diálogo de impresión. Probá de nuevo.",
  },
} satisfies Dict;
