import type { Dict } from './types';

// Quien abre un link público, sin cuenta (Docs/Doc_Link_Publico.md, 3.2 y 3.5 a 3.7).

export const link = {
  'link.opening': { en: "Opening the shared page…", es: "Abriendo la página compartida…" },
  'link.dead.title': { en: "This link no longer works", es: "Este link ya no anda" },
  'link.dead.text': {
    en: "Whoever shared it turned it off, reset it or let it expire. Ask them for a new link.",
    es: "Quien lo compartió lo apagó, lo reseteó o lo dejó vencer. Pedile un link nuevo.",
  },
  'link.leave': { en: "Open the app", es: "Abrir la app" },
  'link.limited.title': { en: "This link has been used a lot today", es: "Este link se usó mucho hoy" },
  'link.limited.text': {
    en: "This link has been used a lot today. Try again tomorrow, or ask for a new link.",
    es: "Este link se usó mucho hoy. Probá mañana, o pedí un link nuevo.",
  },
  'link.noConnection.title': { en: "You need a connection to open this link", es: "Hace falta conexión para abrir este link" },
  'link.noConnection.text': {
    en: "The first time you open a link, this device has to be online. After that, the page stays available without a connection.",
    es: "La primera vez que abrís un link, este dispositivo tiene que tener conexión. Después, la página queda disponible sin conexión.",
  },
  'link.offline': {
    en: "Couldn't reach the server. Showing what's saved on this device.",
    es: "No se pudo llegar al servidor. Se muestra lo guardado en este dispositivo.",
  },
  'link.confirm.title': { en: "Open a page shared from {domain}?", es: "¿Abrir una página compartida desde {domain}?" },
  'link.confirm.text': {
    en: "Someone shared a page with a link. You don't need an account: it opens in this browser.",
    es: "Alguien compartió una página con un link. No hace falta cuenta: se abre en este navegador.",
  },
  'link.confirm.open': { en: "Open", es: "Abrir" },
  'link.broken': { en: "This link is incomplete: copy it again.", es: "Este link está incompleto: copialo de nuevo." },
  'link.shared': { en: "Shared with a link · {domain}", es: "Compartido con un link · {domain}" },
  'link.viaLink': { en: "(via link)", es: "(vía link)" },
  // Una página que el link no deja editar: con una cuenta se pide el permiso; con un link, otro link.
  'link.readOnly': {
    en: "This link lets you read this page and comment on it. To change it, ask whoever shared it for a link that can edit.",
    es: "Con este link podés leer esta página y comentarla. Para cambiarla, pedile a quien lo compartió un link que deje editar.",
  },
  'link.readOnlyEditOff': {
    en: "This link can edit, but editing through a link isn't available right now (it may need a newer version of the app). You can read this page and comment on it.",
    es: "Este link deja editar, pero editar con un link no está disponible ahora (puede hacer falta una versión más nueva de la app). Podés leer esta página y comentarla.",
  },
  'link.yourName': { en: "Your name", es: "Tu nombre" },
  'link.namePrompt': {
    en: "Write your name to comment. It's shown with “(via link)”.",
    es: "Escribí tu nombre para comentar. Se muestra con “(vía link)”.",
  },
  'link.commentingAs': { en: "Commenting as {name}", es: "Comentás como {name}" },
  'link.changeName': { en: "Change", es: "Cambiar" },
  'link.saveName': { en: "Save", es: "Guardar" },
  // Can edit por un link (entrega 2a, Docs/Doc_Link_Publico.md, E2.9).
  'link.treeMoving': {
    en: "The shared pages kept changing while they were loading. It will be tried again shortly.",
    es: "Las páginas compartidas siguieron cambiando mientras se cargaban. Se vuelve a intentar en un rato.",
  },
  // Lo mismo con un árbol ya bajado: el visitante sigue con ese (no es un error). Una línea en el detalle del estado.
  'link.treeBehind': {
    en: "The list of pages may be out of date: it kept changing while it was loading, so you still see the earlier one. It updates on its own.",
    es: "La lista de páginas puede estar atrasada: siguió cambiando mientras se cargaba, así que seguís viendo la anterior. Se actualiza sola.",
  },
  'link.edit.noUploads': {
    en: "Adding photos, videos and files through a link isn't available yet.",
    es: "Todavía no se pueden subir fotos, videos ni archivos con un link.",
  },
  // Archivos por un link (entrega 2b, E2.5): los topes y las carpetas.
  'link.edit.noFolders': {
    en: "Folders can't be added through a link. Add the files inside it instead.",
    es: "Con un link no se pueden agregar carpetas. Agregá los archivos de adentro.",
  },
  'link.edit.fileTooBig': {
    en: "Files added through a link can be up to 500 MB.",
    es: "Con un link se pueden agregar archivos de hasta 500 MB.",
  },
  'link.edit.filesLimited': {
    en: "This link reached its limit for adding files. Try again tomorrow, or ask for a new link.",
    es: "Este link llegó a su tope para agregar archivos. Probá mañana, o pedí un link nuevo.",
  },
  'link.edit.namePrompt': {
    en: "Write your name so your changes can be sent. It's shown with “(via link)”.",
    es: "Escribí tu nombre para que se manden tus cambios. Se muestra con “(vía link)”.",
  },
  'link.edit.waiting': { en: "Sent, waiting for the team", es: "Enviado, esperando al equipo" },
  'link.edit.waitingDetail': {
    en: "Your changes reach the page when someone from the team opens the app. Until then they're saved in this browser.",
    es: "Tus cambios llegan a la página cuando alguien del equipo abre la app. Mientras tanto quedan guardados en este navegador.",
  },
  'link.edit.aside': {
    en: {
      one: "Some of your changes on a page couldn't be added, and what you write next on it won't reach the team either. On the page you can go back to the team's version. Keep a copy:",
      other: "Some of your changes on {count} pages couldn't be added, and what you write next on them won't reach the team either. On each page you can go back to the team's version. Keep a copy:",
    },
    es: {
      one: "Algunos de tus cambios en una página no se pudieron sumar, y lo que escribas ahí después tampoco va a llegar al equipo. En la página podés volver a la versión del equipo. Guardá una copia:",
      other: "Algunos de tus cambios en {count} páginas no se pudieron sumar, y lo que escribas ahí después tampoco va a llegar al equipo. En cada página podés volver a la versión del equipo. Guardá una copia:",
    },
  },
  'link.edit.downloadThem': { en: "Download them", es: "Bajarlos" },
  'link.edit.tooBig': {
    en: "This change is too big to send through a link. Undo it to keep going, or download it.",
    es: "Este cambio es demasiado grande para mandarlo con un link. Deshacelo para seguir, o bajalo.",
  },
  'link.edit.limited': {
    en: "Your changes are saved in this browser and wait to be sent: the link reached a limit (for today, or until the team takes in what's waiting).",
    es: "Tus cambios quedan guardados en este navegador y esperan para mandarse: el link llegó a un tope (por hoy, o hasta que el equipo sume lo que espera).",
  },
  'link.dead.files': {
    en: {
      one: "{count} photo or file you added didn't finish uploading. Download it:",
      other: "{count} photos or files you added didn't finish uploading. Download each one:",
    },
    es: {
      one: "{count} foto o archivo que agregaste no terminó de subir. Bajalo:",
      other: "{count} fotos o archivos que agregaste no terminaron de subir. Bajá cada uno:",
    },
  },
  'link.dead.comments': {
    en: { one: "{count} comment you wrote wasn't sent:", other: "{count} comments you wrote weren't sent:" },
    es: { one: "{count} comentario que escribiste no se mandó:", other: "{count} comentarios que escribiste no se mandaron:" },
  },
  'link.dead.copyComments': { en: "Copy the text", es: "Copiar el texto" },
  'link.dead.unsent': {
    en: { one: "You have {count} page with unsent changes.", other: "You have {count} pages with unsent changes." },
    es: { one: "Tenés {count} página con cambios sin mandar.", other: "Tenés {count} páginas con cambios sin mandar." },
  },
  'link.aside.title': {
    en: { one: "A change sent through the link couldn't be added to this page.", other: "{count} changes sent through the link couldn't be added to this page." },
    es: { one: "Un cambio mandado con el link no se pudo sumar a esta página.", other: "{count} cambios mandados con el link no se pudieron sumar a esta página." },
  },
  'link.aside.detail': {
    en: "Nothing was lost: it's kept apart, and you can download it. Reason: {reason}.",
    es: "No se perdió nada: queda aparte y se puede bajar. Motivo: {reason}.",
  },
  'link.aside.download': { en: "Download it", es: "Bajarlo" },
  'link.aside.held': {
    en: { one: "{count} change from a link that stopped editing this page is on hold.", other: "{count} changes from a link that stopped editing this page are on hold." },
    es: { one: "{count} cambio de un link que dejó de editar esta página queda en espera.", other: "{count} cambios de un link que dejó de editar esta página quedan en espera." },
  },
  // Lo apartado a la vista (entrega 2c): volver a la página como la ve el equipo, los motivos y el ícono del árbol.
  'link.startOver.title': {
    en: "Some of your changes on this page couldn't be added.",
    es: "Algunos de tus cambios en esta página no se pudieron sumar.",
  },
  'link.startOver.text': {
    en: "What you write next here won't reach the team either. Download a copy, then go back to the page as the team sees it to keep writing.",
    es: "Lo que escribas acá después tampoco va a llegar al equipo. Bajá una copia y después volvé a la página como la ve el equipo para seguir escribiendo.",
  },
  'link.startOver.button': { en: "Show the team's version", es: "Ver la versión del equipo" },
  'link.startOver.tip': {
    en: "Downloads a copy of what you have here first, then replaces this page in this browser",
    es: "Primero baja una copia de lo que tenés acá y después reemplaza esta página en este navegador",
  },
  'link.startOver.confirm': {
    en: "A copy of this page as you have it is downloaded first. Then this browser shows the page as the team sees it, and what of yours isn't on it is removed from the page here (it stays in the copy).",
    es: "Primero se baja una copia de esta página como la tenés. Después este navegador muestra la página como la ve el equipo, y lo tuyo que no está en ella sale de la página acá (queda en la copia).",
  },
  'link.startOver.done': {
    en: "This page now shows the team's version. What you write now reaches the team.",
    es: "Esta página ahora muestra la versión del equipo. Lo que escribas ahora le llega al equipo.",
  },
  'link.startOver.changed': {
    en: "The page changed while the copy was being prepared, so nothing was replaced. Try again.",
    es: "La página cambió mientras se preparaba la copia, así que no se reemplazó nada. Probá de nuevo.",
  },
  'link.startOver.notReady': {
    en: "The team's version of this page isn't ready yet. Nothing was replaced. Try again in a few minutes.",
    es: "La versión del equipo de esta página todavía no está lista. No se reemplazó nada. Probá en unos minutos.",
  },
  'link.startOver.offline': {
    en: "You're offline, so nothing was replaced. Try again when you're back online.",
    es: "No hay conexión, así que no se reemplazó nada. Probá de nuevo cuando vuelva.",
  },
  'link.startOver.lateTitle': {
    en: "Something you typed while this page changed to the team's version wasn't added.",
    es: "Algo que escribiste mientras esta página pasaba a la versión del equipo no se sumó.",
  },
  'link.startOver.lateText': {
    en: "It's kept in this browser and comes in the copy you download.",
    es: "Queda guardado en este navegador y viene en la copia que bajás.",
  },
  'link.startOver.lateDismiss': { en: "Got it", es: "Entendido" },
  'link.startOver.failed': {
    en: "Nothing was replaced: {reason}",
    es: "No se reemplazó nada: {reason}",
  },
  'link.reason.link_revoked': {
    en: "the link was reset or turned off before it was added",
    es: "el link se renovó o se apagó antes de que entrara",
  },
  'link.reason.pending': {
    en: "it came after another change that couldn't be added",
    es: "vino después de otro cambio que no se pudo sumar",
  },
  'link.reason.media': {
    en: "it uses a photo or an image from outside the shared pages",
    es: "usa una foto o una imagen de afuera de las páginas compartidas",
  },
  'link.reason.size': { en: "it would make the page too big", es: "haría la página demasiado grande" },
  'link.reason.other': { en: "the app couldn't add it safely", es: "la app no lo pudo sumar de forma segura" },
  'link.aside.tree': {
    en: "Changes sent through a link were set aside here",
    es: "Acá hay cambios mandados con un link que quedaron aparte",
  },
  // El ícono del árbol en una página con un link propio (3.11): lo ve quien puede abrir su Share.
  'link.tree.view': { en: "Anyone with the link can view and comment", es: "Cualquiera con el link puede ver y comentar" },
  'link.tree.edit': { en: "Anyone with the link can edit", es: "Cualquiera con el link puede editar" },
  'link.tree.off': { en: "This page's link isn't working: see Share", es: "El link de esta página no anda: mirá Compartir" },
  'link.tree.by': { en: "{what} · created by {name}", es: "{what} · lo creó {name}" },
} satisfies Dict;
