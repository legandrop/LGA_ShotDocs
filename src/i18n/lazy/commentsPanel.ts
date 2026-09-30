import { register } from '../index';
import type { Dict } from '../types';

// El panel de comentarios (se carga aparte).

export const commentsPanel = {
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
  'common.save': { en: "Save", es: "Guardar" },
  'common.delete': { en: "Delete", es: "Borrar" },
  'common.edit': { en: "Edit", es: "Editar" },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(commentsPanel);
