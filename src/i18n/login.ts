import type { Dict } from './types';

// La pantalla para entrar (antes de la sesión, en el idioma del navegador o el último elegido).

export const login = {
  'login.error.rateLimit': {
    en: "Too many emails were sent in a short time. Wait a while and try again.",
    es: "Se mandaron demasiados correos en poco tiempo. Esperá un rato y probá de nuevo.",
  },
  'login.error.noAccount': {
    en: "There is no account with this email. Ask the owner of this workspace for an invitation.",
    es: "No hay ninguna cuenta con este correo. Pedile una invitación al dueño de este workspace.",
  },
  'login.error.testSmtp': {
    en: "The Supabase test mail server only sends to members of the project. Set up your own mail server (SMTP) to let other people in.",
    es: "El servidor de correo de prueba de Supabase solo manda a los miembros del proyecto. Configurá tu propio servidor de correo (SMTP) para que entren otras personas.",
  },
  'login.error.code': {
    en: "That code is not valid or has expired. Ask for a new one.",
    es: "Ese código no es válido o ya venció. Pedí uno nuevo.",
  },
  'login.error.offline': {
    en: "You are offline. Signing in needs an internet connection.",
    es: "Estás sin conexión. Para entrar hace falta internet.",
  },
  'login.hero.title': { en: "Notes for every shot.", es: "Notas para cada plano." },
  'login.hero.subtitle': { en: "On set, offline, in sync.", es: "En el set, sin señal, sincronizadas." },
  'login.hero.text': {
    en: "Pre-production notes and on-set reports in one tree of pages. Every edit is saved on your device first, and nothing is lost when the signal drops.",
    es: "Notas de preproducción e informes de rodaje en un solo árbol de páginas. Cada cambio se guarda primero en tu dispositivo, y no se pierde nada cuando se corta la señal.",
  },
  'login.tag.scenes': { en: "Scene notes", es: "Notas de escena" },
  'login.tag.reports': { en: "On-set reports", es: "Informes de rodaje" },
  'login.tag.breakdowns': { en: "Shot breakdowns", es: "Desgloses de planos" },
  'login.title': { en: "Sign in", es: "Entrar" },
  'login.lead': {
    en: "Enter your email and we will send you a sign-in link. No password to remember.",
    es: "Escribí tu correo y te mandamos un link para entrar. Sin contraseñas que recordar.",
  },
  'login.invited': {
    en: "You were invited to {workspace}. Use the email the invitation was sent to.",
    es: "Te invitaron a {workspace}. Usá el correo al que llegó la invitación.",
  },
  'login.invitedPage': {
    en: "The shared page opens after you sign in.",
    es: "La página compartida se abre después de entrar.",
  },
  'login.sending': { en: "Sending…", es: "Mandando…" },
  'login.continue': { en: "Continue with email", es: "Seguir con el correo" },
  'login.emailFirst': { en: "Type your email first.", es: "Primero escribí tu correo." },
  'login.haveCode': { en: "I already have a code", es: "Ya tengo un código" },
  'login.iphoneHint': {
    en: "On iPhone, open the link on this device or type the code from the email, so you stay signed in to the installed app.",
    es: "En el iPhone, abrí el link en este dispositivo o escribí el código del correo, así quedás adentro de la app instalada.",
  },
  'login.checkEmail': { en: "Check your email", es: "Revisá tu correo" },
  'login.sent': {
    en: "We sent a sign-in link to {email}. Open it on this device, or type the code if the email has one.",
    es: "Te mandamos un link para entrar a {email}. Abrilo en este dispositivo, o escribí el código si el correo trae uno.",
  },
  'login.code': { en: "Code", es: "Código" },
  'login.checking': { en: "Checking…", es: "Revisando…" },
  'login.resend': { en: "Send the email again", es: "Mandar el correo de nuevo" },
  'login.otherEmail': { en: "Use another email", es: "Usar otro correo" },
  'login.footer': {
    en: "Self-hosted · your data, your database",
    es: "En tus servidores · tus datos, tu base de datos",
  },
} satisfies Dict;
