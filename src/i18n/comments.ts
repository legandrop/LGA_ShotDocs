import type { Dict } from './types';

// Los comentarios y las preguntas: el panel, el margen del editor y sus errores.

export const comments = {
  'comments.title': { en: "Comments", es: "Comentarios" },
  'comments.toggleOpen': {
    en: { one: "Comments, {count} open", other: "Comments, {count} open" },
    es: { one: "Comentarios, {count} abierto", other: "Comentarios, {count} abiertos" },
  },
  'comments.discardDraft': { en: "Discard what you wrote?", es: "¿Descartar lo que escribiste?" },
  'comments.comment': { en: "Comment", es: "Comentar" },
  'comments.answer': { en: "Answer", es: "Responder" },
  'comments.readOnlyDevice': {
    en: "Comments are read-only on this device: {reason}",
    es: "En este dispositivo los comentarios son de solo lectura: {reason}",
  },
  'commentError.pageNotFound': {
    en: "The page is not on the server, or you can no longer see it.",
    es: "La página no está en el servidor, o ya no podés verla.",
  },
  'commentError.commentNotFound': {
    en: "The comment is not on the server, or you can no longer see it.",
    es: "El comentario no está en el servidor, o ya no podés verlo.",
  },
  'commentError.threadNotFound': {
    en: "The thread is not on the server, or you can no longer see it.",
    es: "El hilo no está en el servidor, o ya no podés verlo.",
  },
  'commentError.denied': {
    en: "You can view this page but not comment on it.",
    es: "Podés ver esta página pero no comentarla.",
  },
  'commentError.deleteNotAllowed': {
    en: "Only the author, or someone who can edit and create pages here, can delete this comment.",
    es: "Solo quien lo escribió, o alguien que pueda editar y crear páginas acá, puede borrar este comentario.",
  },
  'commentError.editNotAllowed': {
    en: "Only the author can edit this comment.",
    es: "Solo quien lo escribió puede editar este comentario.",
  },
  'commentError.conflict': {
    en: "The server already has a different comment with this id.",
    es: "El servidor ya tiene otro comentario con este id.",
  },
  'commentError.deleted': { en: "The comment was deleted.", es: "El comentario se borró." },
  'commentError.importDenied': {
    en: "Importing comments needs permission to edit and create pages here.",
    es: "Importar comentarios pide permiso para editar y crear páginas acá.",
  },
  'commentError.outdated': {
    en: "This workspace needs a newer version of the app: it is sent after updating.",
    es: "Este workspace necesita una versión más nueva de la app: se manda al actualizar.",
  },
  'commentError.importInvalid': {
    en: "The imported comment has an invalid date.",
    es: "El comentario importado tiene una fecha inválida.",
  },
  'commentError.threadInvalid': {
    en: "The reply does not match its thread.",
    es: "La respuesta no corresponde a su hilo.",
  },
  'commentError.signedOut': {
    en: "You are signed out: sign in again to send it.",
    es: "Se cerró tu sesión: volvé a entrar para mandarlo.",
  },
  'commentError.empty': { en: "Write something first.", es: "Primero escribí algo." },
  'commentError.tooLong': {
    en: "A comment can have up to {max} characters.",
    es: "Un comentario puede tener hasta {max} caracteres.",
  },
  'commentError.storage': {
    en: "the storage for comments could not be opened.",
    es: "no se pudo abrir el almacenamiento de los comentarios.",
  },
  'commentError.badBlock': { en: "This block cannot take comments.", es: "Este bloque no se puede comentar." },
  'commentError.threadGone': { en: "The thread is not here anymore.", es: "El hilo ya no está." },
  'commentError.off': {
    en: "Comments are off on this device: {reason}",
    es: "Los comentarios no andan en este dispositivo: {reason}",
  },
  'commentError.rejected': { en: "Rejected by the server.", es: "El servidor lo rechazó." },
  'commentDiscard.add': {
    en: "This comment was never uploaded: discarding removes it from this device.",
    es: "Este comentario nunca se subió: descartarlo lo borra de este dispositivo.",
  },
  'commentDiscard.addWithReplies': {
    en: { one: "This comment was never uploaded: discarding removes it from this device, and also discards {count} reply to it.", other: "This comment was never uploaded: discarding removes it from this device, and also discards {count} replies to it." },
    es: { one: "Este comentario nunca se subió: descartarlo lo borra de este dispositivo, y también descarta {count} respuesta.", other: "Este comentario nunca se subió: descartarlo lo borra de este dispositivo, y también descarta {count} respuestas." },
  },
  'commentDiscard.edit': {
    en: "Discarding the edit: the comment comes back as it is on the server.",
    es: "Se descarta la edición: el comentario vuelve a como está en el servidor.",
  },
  'commentDiscard.delete': {
    en: "Discarding the delete: the comment comes back.",
    es: "Se descarta el borrado: el comentario vuelve.",
  },
  'commentDiscard.resolve': { en: "Discarding: the thread reopens.", es: "Se descarta: el hilo se vuelve a abrir." },
  'commentDiscard.reopen': { en: "Discarding: the thread stays resolved.", es: "Se descarta: el hilo sigue resuelto." },
  'commentDiscard.generic': { en: "Discard this change?", es: "¿Descartar este cambio?" },
  'commentDiscard.mentions': {
    en: "Discarding the mentions: no one gets notified; the text of the comment stays.",
    es: "Se descartan las menciones: nadie recibe el aviso; el texto del comentario queda.",
  },
  // La campana de las menciones (Doc_Menciones.md, 2.3): está siempre en la barra de arriba.
  'mentions.title': { en: "Mentions", es: "Menciones" },
  'mentions.unread': {
    en: { one: "{count} unread", other: "{count} unread" },
    es: { one: "{count} sin leer", other: "{count} sin leer" },
  },
  'mentions.unreadMany': { en: "9+ unread", es: "9+ sin leer" },
  'mentions.markAll': { en: "Mark all as read", es: "Marcar todas como leídas" },
  'mentions.empty': {
    en: "No mentions yet. When someone writes @ and your name in a comment, it shows up here.",
    es: "Todavía no hay menciones. Cuando alguien escriba @ y tu nombre en un comentario, aparece acá.",
  },
  'mentions.offline': { en: "Offline · checked {time}", es: "Sin conexión · revisado a las {time}" },
  'mentions.offlineNever': { en: "Offline", es: "Sin conexión" },
  'mentions.resolved': { en: "Resolved", es: "Resuelto" },
  'mentions.inTrash': { en: "In trash", es: "En la papelera" },
  'mentions.someone': { en: "Someone", es: "Alguien" },
  'mentions.unreadDot': { en: "Unread", es: "Sin leer" },
  'comments.mentionedHere': { en: "You were mentioned here", es: "Te mencionaron acá" },
  'commentError.mentionsInvalid': {
    en: "The mentions in this comment are not valid.",
    es: "Las menciones de este comentario no son válidas.",
  },
} satisfies Dict;
