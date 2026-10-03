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
  'link.yourName': { en: "Your name", es: "Tu nombre" },
  'link.namePrompt': {
    en: "Write your name to comment. It's shown with “(via link)”.",
    es: "Escribí tu nombre para comentar. Se muestra con “(vía link)”.",
  },
  'link.commentingAs': { en: "Commenting as {name}", es: "Comentás como {name}" },
  'link.changeName': { en: "Change", es: "Cambiar" },
  'link.saveName': { en: "Save", es: "Guardar" },
  // Can edit por un link (entrega 2a, Docs/Doc_Link_Publico.md, E2.9).
  'link.edit.noUploads': {
    en: "Adding photos, videos and files through a link isn't available yet.",
    es: "Todavía no se pueden subir fotos, videos ni archivos con un link.",
  },
  'link.edit.namePrompt': {
    en: "Write your name so your changes can be sent. It's shown with “(via link)”.",
    es: "Escribí tu nombre para que se manden tus cambios. Se muestra con “(vía link)”.",
  },
  'link.edit.editingAs': { en: "Editing as {name}", es: "Editás como {name}" },
  'link.edit.waiting': { en: "Sent, waiting for the team", es: "Enviado, esperando al equipo" },
  'link.edit.waitingDetail': {
    en: "Your changes reach the page when someone from the team opens the app. Until then they're saved in this browser.",
    es: "Tus cambios llegan a la página cuando alguien del equipo abre la app. Mientras tanto quedan guardados en este navegador.",
  },
  'link.edit.aside': {
    en: { one: "Some of your changes on a page couldn't be added.", other: "Some of your changes on {count} pages couldn't be added." },
    es: { one: "Algunos de tus cambios en una página no se pudieron sumar.", other: "Algunos de tus cambios en {count} páginas no se pudieron sumar." },
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
} satisfies Dict;
