import { register } from '../index';
import type { Dict } from '../types';

// Lo que suma la app al editor: Script y Question, comentar un bloque, pegar links de Drive, la tarjeta de Drive y los botones de fotos (se carga aparte, con el editor).

export const editor = {
  'comments.margin': { en: "Comments in the margin", es: "Comentarios en el margen" },
  'comments.openOnBlock': {
    en: { one: "{count} open comment on this block", other: "{count} open comments on this block" },
    es: { one: "{count} comentario abierto en este bloque", other: "{count} comentarios abiertos en este bloque" },
  },
  'comments.answers': {
    en: { one: "{count} answer", other: "{count} answers" },
    es: { one: "{count} respuesta", other: "{count} respuestas" },
  },
  'comments.resolvedMark': { en: "resolved", es: "resuelta" },
  'comments.onBlock': { en: "Comment on this block", es: "Comentar este bloque" },
  'drivePaste.caption': { en: "Paste as", es: "Pegar como" },
  'drivePaste.link': { en: "Link", es: "Link" },
  'drivePaste.text': { en: "Text", es: "Texto" },
  'drivePaste.card': { en: "Card", es: "Tarjeta" },
  'drivePaste.cardTip': {
    en: "Shows the **Google Drive player** on the page.\nPlays for people signed in to Google with access to the file.\nIn Safari and on iPhone, only files shared by link may play.",
    es: "Muestra el **reproductor de Google Drive** en la página.\nSe reproduce para quien entró a Google y tiene acceso al archivo.\nEn Safari y en el iPhone, puede que solo anden los compartidos por link.",
  },
  'mediaButton.offline': {
    en: "You're offline, and the original isn't on this device.",
    es: "Estás sin conexión, y el original no está en este dispositivo.",
  },
  'mediaButton.failed': { en: "The original could not be downloaded.", es: "No se pudo descargar el original." },
  'mediaButton.view': { en: "View full screen", es: "Ver en pantalla completa" },
  'mediaButton.space': { en: "Space", es: "Espacio" },
  'mediaButton.download': { en: "Download image", es: "Descargar imagen" },
  'driveCard.tap': { en: "Tap to use the player", es: "Tocá para usar el reproductor" },
  'driveCard.open': { en: "Open in Drive", es: "Abrir en Drive" },
  'driveCard.showAsLink': { en: "Show as link", es: "Mostrar como link" },
  'driveCard.cookies': {
    en: "In Safari and on iPhone, only files shared by link may play here.",
    es: "En Safari y en el iPhone, puede que acá solo se reproduzcan los archivos compartidos por link.",
  },
  'driveCard.notLoaded': { en: "The Drive player didn't load.", es: "El reproductor de Drive no cargó." },
  'driveCard.offline': {
    en: "You're offline. The Drive player loads when you're back online.",
    es: "Estás sin conexión. El reproductor de Drive carga cuando vuelva la conexión.",
  },
  'driveCard.player': { en: "Google Drive player", es: "Reproductor de Google Drive" },
  'editor.script': { en: "Script", es: "Guion" },
  'editor.scriptHint': {
    en: "Screenplay text: INT/EXT, DAY, NIGHT marked",
    es: "Texto de guion: INT/EXT, DÍA y NOCHE marcados",
  },
  'editor.question': { en: "Question", es: "Pregunta" },
  'editor.questionHint': {
    en: "A question for the team or the client, answered in comments",
    es: "Una pregunta para el equipo o el cliente, que se contesta en los comentarios",
  },
  'editor.image': { en: "Image", es: "Imagen" },
  'editor.missingOnline': {
    en: "Part of this page is still downloading. It opens for editing as soon as it arrives.",
    es: "Una parte de esta página todavía se está bajando. Se abre para editar apenas llega.",
  },
  'editor.missingOffline': {
    en: "Part of this page has not been downloaded to this device yet. You can read what is here; connect to the internet to edit it.",
    es: "Una parte de esta página todavía no se bajó a este dispositivo. Podés leer lo que hay; conectate a internet para editarla.",
  },
  'editor.commentOnly': {
    en: "You can comment on this page and answer its questions. Ask for edit access to change it.",
    es: "Podés comentar esta página y contestar sus preguntas. Pedí permiso de edición para cambiarla.",
  },
  'editor.unsupportedTitle': {
    en: "This page was edited with a newer version of the app.",
    es: "Esta página se editó con una versión más nueva de la app.",
  },
  'editor.unsupported': {
    en: "This version can't show all of it without losing part, so it stays closed. Nothing is lost.",
    es: "Esta versión no puede mostrarla entera sin perder una parte, así que queda cerrada. No se pierde nada.",
  },
  'editor.updateApp': { en: "Update the app", es: "Actualizar la app" },
  'editor.onlyImages': {
    en: "Only images can be added for now (JPEG, PNG, GIF, WebP, AVIF or HEIC). Videos need the workspace media server (Google Drive).",
    es: "Por ahora solo se pueden agregar imágenes (JPEG, PNG, GIF, WebP, AVIF o HEIC). Los videos necesitan el servidor de archivos del workspace (Google Drive).",
  },
  'editor.fileNotSaved': {
    en: "This file could not be saved on this device.",
    es: "No se pudo guardar este archivo en este dispositivo.",
  },
  'editor.pastedEmbedded': {
    en: "A pasted image stays embedded in the page: {reason}",
    es: "Una imagen pegada queda guardada dentro de la página: {reason}",
  },
  'editor.pastedNotSaved': {
    en: "A pasted image could not be saved as a file; it stays embedded in the page.",
    es: "Una imagen pegada no se pudo guardar como archivo; queda guardada dentro de la página.",
  },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(editor);
