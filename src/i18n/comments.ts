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
  'comments.margin': { en: "Comments in the margin", es: "Comentarios en el margen" },
  'comments.openOnBlock': {
    en: { one: "{count} open comment on this block", other: "{count} open comments on this block" },
    es: { one: "{count} comentario abierto en este bloque", other: "{count} comentarios abiertos en este bloque" },
  },
  'comments.answer': { en: "Answer", es: "Responder" },
  'comments.answers': {
    en: { one: "{count} answer", other: "{count} answers" },
    es: { one: "{count} respuesta", other: "{count} respuestas" },
  },
  'comments.resolvedMark': { en: "resolved", es: "resuelta" },
  'comments.onBlock': { en: "Comment on this block", es: "Comentar este bloque" },
  'comments.onPage': { en: "Comment on the page", es: "Comentar la página" },
  'comments.close': { en: "Close comments", es: "Cerrar los comentarios" },
  'comments.offline': {
    en: "Offline: what you write is saved on this device and uploads when you’re back online.",
    es: "Sin conexión: lo que escribas se guarda en este dispositivo y se sube cuando vuelva la conexión.",
  },
  'comments.schemaBehind': {
    en: "The workspace database needs an update before comments can upload. Yours stay saved on this device.",
    es: "La base de datos del workspace necesita una actualización para que se suban los comentarios. Los tuyos quedan guardados en este dispositivo.",
  },
  'comments.readOnlyDevice': {
    en: "Comments are read-only on this device: {reason}",
    es: "En este dispositivo los comentarios son de solo lectura: {reason}",
  },
  'comments.readOnly': {
    en: "You can read the comments here. Ask for comment access to add yours.",
    es: "Podés leer los comentarios. Pedí permiso para comentar si querés agregar los tuyos.",
  },
  'comments.pullError': {
    en: "Could not download the latest comments: {reason}",
    es: "No se pudieron bajar los últimos comentarios: {reason}",
  },
  'comments.loading': { en: "Loading comments…", es: "Cargando comentarios…" },
  'comments.none': { en: "No comments on this page yet.", es: "Todavía no hay comentarios en esta página." },
  'comments.noneHint': {
    en: "Select a block and choose Comment, or use the comment button in its margin.",
    es: "Elegí un bloque y tocá Comentar, o usá el botón de comentar en su margen.",
  },
  'comments.noneOffline': {
    en: "No comments saved on this device for this page.",
    es: "No hay comentarios de esta página guardados en este dispositivo.",
  },
  'comments.resolvedThreads': {
    en: { one: "{count} resolved thread", other: "{count} resolved threads" },
    es: { one: "{count} hilo resuelto", other: "{count} hilos resueltos" },
  },
  'comments.wholePage': { en: "On the whole page", es: "En toda la página" },
  'comments.blockGone': {
    en: "The block it pointed to is no longer on the page",
    es: "El bloque al que apuntaba ya no está en la página",
  },
  'comments.emptyBlock': { en: "Empty block", es: "Bloque vacío" },
  'comments.goToBlock': { en: "Go to the block", es: "Ir al bloque" },
  'comments.writeAnswer': { en: "Write your answer…", es: "Escribí tu respuesta…" },
  'comments.write': { en: "Write a comment…", es: "Escribí un comentario…" },
  'comments.replyPlaceholder': { en: "Reply…", es: "Responder…" },
  'comments.reply': { en: "Reply", es: "Responder" },
  'comments.resolved': { en: "Resolved", es: "Resuelto" },
  'comments.resolvedBy': { en: "Resolved by {name}", es: "Resuelto por {name}" },
  'comments.reopen': { en: "Reopen", es: "Reabrir" },
  'comments.resolve': { en: "Resolve", es: "Resolver" },
  'comments.you': { en: "You", es: "Vos" },
  'comments.deletedAccount': { en: "Deleted account", es: "Cuenta borrada" },
  'comments.someone': { en: "Someone", es: "Alguien" },
  'comments.deleted': { en: "This comment was deleted.", es: "Este comentario se borró." },
  'comments.edited': { en: "edited", es: "editado" },
  'comments.notUploaded': { en: "Not uploaded yet", es: "Todavía sin subir" },
  'comments.editPlaceholder': { en: "Edit the comment…", es: "Editá el comentario…" },
  'comments.deleteConfirm': { en: "Delete this comment?", es: "¿Borrar este comentario?" },
  'comments.rejected': {
    en: "Not accepted by the server: {reason} It stays on this device.",
    es: "El servidor no lo aceptó: {reason} Queda en este dispositivo.",
  },
  'comments.discardEllipsis': { en: "Discard…", es: "Descartar…" },
  'comments.saveFailed': {
    en: "Could not save it on this device ({reason}).",
    es: "No se pudo guardar en este dispositivo ({reason}).",
  },
  'comments.tooLong': { en: "Up to {max} characters ({now} now).", es: "Hasta {max} caracteres (ahora hay {now})." },
  'comments.justNow': { en: "just now", es: "recién" },
  'comments.minutes': {
    en: { one: "{count} min", other: "{count} min" },
    es: { one: "{count} min", other: "{count} min" },
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
} satisfies Dict;
