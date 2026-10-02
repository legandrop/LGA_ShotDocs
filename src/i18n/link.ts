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
} satisfies Dict;
