import type { Dict } from './types';

// La dirección fija de un archivo (P.30, Docs/Doc_Links_PDF.md): abrirla, entrar y la pantalla sin acceso. La pantalla
// sin acceso nunca nombra el archivo, el proyecto ni la página.

export const files = {
  'file.opening': { en: "Opening the file…", es: "Abriendo el archivo…" },
  'file.incomplete': {
    en: "This file link is incomplete. Open it again from the document.",
    es: "Este link de archivo está incompleto. Abrilo de nuevo desde el documento.",
  },
  'file.signIn': { en: "Sign in to open this file.", es: "Entrá para abrir este archivo." },
  'file.askInvite': {
    en: "If someone sent you this document, ask them to invite you.",
    es: "Si alguien te mandó este documento, pedile que te invite.",
  },
  'file.noAccess.title': { en: "You don't have access to this file", es: "No tenés acceso a este archivo" },
  'file.noAccess.text': {
    en: "Ask whoever shared the document with you.",
    es: "Pedíselo a quien te compartió el documento.",
  },
  'file.home': { en: "Go to Shot Docs", es: "Ir a Shot Docs" },
  'file.offline': {
    en: "You're offline. Open this link again when you're connected.",
    es: "Estás sin conexión. Abrí este link de nuevo cuando tengas conexión.",
  },
  'file.deleted': { en: "This file was deleted.", es: "Este archivo se borró." },
  'file.failed': {
    en: "The file could not be opened. Try again in a moment.",
    es: "No se pudo abrir el archivo. Probá de nuevo en un rato.",
  },
  'file.signInInstead': { en: "Sign in instead", es: "Entrar con una cuenta" },
} satisfies Dict;
