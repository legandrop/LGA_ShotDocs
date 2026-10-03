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
  // *Request access* (entrega 2, 5.2).
  'file.request': { en: "Request access", es: "Pedir acceso" },
  'file.requestAgain': { en: "Ask again", es: "Pedir de nuevo" },
  'file.requestHint': {
    en: "You can ask the people who can share it to give you access.",
    es: "Podés pedirles acceso a quienes pueden compartirlo.",
  },
  'file.requestNote': {
    en: "The people who can share this file will see your email and your role.",
    es: "Quienes pueden compartir este archivo van a ver tu correo y tu rol.",
  },
  'file.requestSent': {
    en: "Request sent. If someone gives you access, the file opens here.",
    es: "Pedido enviado. Si alguien te da acceso, el archivo se abre acá.",
  },
  'file.requestedOn': { en: "You asked for access on {date}.", es: "Pediste acceso el {date}." },
  'file.requestLimited': {
    en: "You have sent too many requests today. Try again tomorrow.",
    es: "Mandaste demasiados pedidos hoy. Probá de nuevo mañana.",
  },
  'file.requestOffline': {
    en: "You're offline. Ask again when you're connected.",
    es: "Estás sin conexión. Pedilo de nuevo cuando tengas conexión.",
  },
  'file.requestFailed': {
    en: "The request could not be sent. Try again in a moment.",
    es: "No se pudo mandar el pedido. Probá de nuevo en un rato.",
  },
} satisfies Dict;
