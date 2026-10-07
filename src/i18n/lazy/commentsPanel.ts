import { register } from '../index';
import type { Dict } from '../types';

// El panel de comentarios (se carga aparte).

export const commentsPanel = {
  'comments.onPage': { en: "Comment on the page", es: "Comentar la página" },
  // La lista del @ (Doc_Menciones.md, 2.1) y a quién no se avisó (2.2).
  'mentions.listLabel': { en: "People to mention", es: "Personas para mencionar" },
  'mentions.noMatch': { en: "No one with access matches", es: "Nadie con acceso coincide" },
  'mentions.max': { en: "Up to {max} people per comment", es: "Hasta {max} personas por comentario" },
  // Compartir desde la mención (ME2, entrega 2): solo el dueño y los admins que pueden compartir la página.
  'mentions.outsideHead': { en: "Can't see this page", es: "No ven esta página" },
  'mentions.shareLabel': { en: "Share and mention", es: "Compartir y mencionar" },
  'mentions.shareAsk': {
    en: "{name} can't see this page. Share it with them (Comment) and mention them?",
    es: "{name} no ve esta página. ¿Compartírsela con Comentar y mencionarle?",
  },
  'mentions.shareNow': {
    en: "It's shared as soon as you choose Share and mention, even if you don't send the comment.",
    es: "Se comparte en cuanto tocás Compartir y mencionar, aunque después no mandes el comentario.",
  },
  'mentions.shareAndMention': { en: "Share and mention", es: "Compartir y mencionar" },
  'mentions.sharing': { en: "Sharing…", es: "Compartiendo…" },
  'mentions.shareOffline': { en: "Sharing needs a connection.", es: "Para compartir hace falta conexión." },
  'comments.notNotified': {
    en: { one: "{names} wasn't notified.", other: "{names} weren't notified." },
    es: { one: "No se le avisó a {names}.", other: "No se les avisó a {names}." },
  },
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
  // El hilo cambió de estado (acá o desde otro lado) con un cuadro abierto: el cuadro sigue, y se puede mandar igual.
  'comments.resolvedWhileWriting': {
    en: "This thread was resolved while you were writing. You can still send what you wrote: the thread stays resolved.",
    es: "Este hilo se resolvió mientras escribías. Igual podés mandar lo que escribiste: el hilo sigue resuelto.",
  },
  'comments.reopenedWhileWriting': {
    en: "This thread was reopened while you were writing.",
    es: "Este hilo se reabrió mientras escribías.",
  },
  'comments.resolvedBy': { en: "Resolved by {name}", es: "Resuelto por {name}" },
  'comments.reopen': { en: "Reopen", es: "Reabrir" },
  'comments.resolve': { en: "Resolve", es: "Resolver" },
  'comments.you': { en: "You", es: "Vos" },
  'comments.deletedAccount': { en: "Deleted account", es: "Cuenta borrada" },
  'comments.someone': { en: "Someone", es: "Alguien" },
  'comments.importedFrom': { en: "from {source}", es: "de {source}" },
  'comments.importedArchive': { en: "from an archive", es: "de un archivo" },
  'comments.importedBy': { en: "Imported by {name}", es: "Lo importó {name}" },
  // De qué link vino un comentario hecho por un link público (solo para quien puede compartir la página del link):
  // «Can view link · created by lega · closed».
  'comments.link.view': { en: "Can view link", es: "Link Puede ver" },
  'comments.link.edit': { en: "Can edit link", es: "Link Puede editar" },
  'comments.link.by': { en: "created by {name}", es: "lo creó {name}" },
  'comments.link.closed': { en: "closed", es: "cerrado" },
  'comments.link.expired': { en: "expired", es: "vencido" },
  'comments.link.off': { en: "not working", es: "no anda" },
  'comments.deleted': { en: "This comment was deleted.", es: "Este comentario se borró." },
  // El comentario (o el hilo entero) se borró desde otro lado con un cuadro abierto: lo tipeado sigue a la vista, para
  // copiarlo; desde ahí ya no se puede guardar.
  'comments.gone.editing': {
    en: "This comment was deleted from somewhere else while you were editing it. What you wrote can't be saved from here: copy it if you want to keep it, then cancel.",
    es: "Este comentario se borró desde otro lado mientras lo editabas. Lo que escribiste no se puede guardar desde acá: copialo si lo querés conservar y después cancelá.",
  },
  'comments.gone.replying': {
    en: "This thread was deleted from somewhere else while you were writing. What you wrote can't be saved from here: copy it if you want to keep it, then cancel.",
    es: "Este hilo se borró desde otro lado mientras escribías. Lo que escribiste no se puede guardar desde acá: copialo si lo querés conservar y después cancelá.",
  },
  'comments.gone.cancel': {
    en: "Discard what you wrote here? The comment is no longer there, so it can't be saved from this box: copy it first if you want to keep it.",
    es: "¿Descartar lo que escribiste acá? El comentario ya no está, así que desde este cuadro no se puede guardar: copialo antes si lo querés conservar.",
  },
  'comments.edited': { en: "edited", es: "editado" },
  'comments.notUploaded': { en: "Not uploaded yet", es: "Todavía sin subir" },
  'comments.editPlaceholder': { en: "Edit the comment…", es: "Editá el comentario…" },
  'comments.deleteConfirm': { en: "Delete this comment?", es: "¿Borrar este comentario?" },
  'comments.rejected': {
    en: "Not accepted by the server: {reason} It stays on this device.",
    es: "El servidor no lo aceptó: {reason} Queda en este dispositivo.",
  },
  'comments.discardEllipsis': { en: "Discard…", es: "Descartar…" },
  // Con varios textos rechazados del mismo comentario, los botones dicen que valen para todos.
  'comments.retryAll': { en: "Retry all {count}", es: "Reintentar los {count}" },
  'comments.discardAllEllipsis': { en: "Discard all {count}…", es: "Descartar los {count}…" },
  'comments.discardAll': { en: "Discard all {count}", es: "Descartar los {count}" },
  // Varios textos rechazados del mismo comentario (dos ediciones, o un alta y su edición): cuántos son, y cada uno con
  // su *Copy text*.
  'comments.rejectedMany': {
    en: "{count} texts you wrote for this comment were not accepted. Copy the ones you want to keep:",
    es: "El servidor no aceptó {count} textos que escribiste para este comentario. Copiá los que quieras conservar:",
  },
  // Una edición propia que no entró porque el comentario se cambió antes desde otro lado: los dos textos y la decisión.
  'comments.conflict.title': {
    en: "Your edit was not saved: this comment had already been changed from somewhere else. Nothing was lost. Choose which text stays.",
    es: "Tu edición no se guardó: este comentario ya se había cambiado desde otro lado. No se perdió nada. Elegí qué texto queda.",
  },
  // Con el cuadro de edición ya abierto cuando llegó el conflicto de la edición anterior.
  'comments.conflict.whileEditing': {
    en: "This comment was changed from somewhere else while you were editing. Save or cancel to see both texts and choose.",
    es: "Este comentario se cambió desde otro lado mientras editabas. Guardá o cancelá para ver los dos textos y elegir.",
  },
  // Lo mismo, pero lo que quedó esperando decisión es **otro** texto (una edición anterior que se reintentó y chocó) y
  // el cuadro no partía de él: desde acá no se puede guardar. Lo dice, y el cuadro ofrece copiar lo escrito.
  'comments.conflict.whileEditingStuck': {
    en: "An earlier edit of yours on this comment was not saved and is waiting for you to choose which text stays. What you are writing here can't be saved until you choose: copy it, then cancel to see both texts.",
    es: "Una edición tuya anterior de este comentario no se guardó y está esperando que elijas qué texto queda. Lo que estás escribiendo acá no se puede guardar hasta que elijas: copialo y después cancelá para ver los dos textos.",
  },
  'comments.conflict.cancelStuck': {
    en: "Discard what you wrote here? It can't be saved from this box: copy it first if you want to keep it.",
    es: "¿Descartar lo que escribiste acá? Desde este cuadro no se puede guardar: copialo antes si lo querés conservar.",
  },
  'comments.conflict.theirs': { en: "Saved now, changed from somewhere else", es: "Lo que quedó guardado, cambiado desde otro lado" },
  'comments.conflict.mine': { en: "What you wrote on this device", es: "Lo que escribiste en este dispositivo" },
  'comments.conflict.keepMine': { en: "Keep mine", es: "Dejar el mío" },
  'comments.conflict.discardMine': { en: "Discard mine…", es: "Descartar el mío…" },
  'comments.conflict.copyMine': { en: "Copy mine", es: "Copiar el mío" },
  'comments.conflict.deleted': {
    en: "Your edit was not saved, and this comment was deleted since. This is what you wrote on this device:",
    es: "Tu edición no se guardó, y después este comentario se borró. Esto es lo que escribiste en este dispositivo:",
  },
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
