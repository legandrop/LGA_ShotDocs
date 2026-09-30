import { register } from '../index';
import type { Dict } from '../types';

// La prueba de fotos y videos (se carga aparte).

export const mediaTest = {
  'mediaTest.intro': {
    en: "Upload a video from this device to Google Drive and check that it plays back here.",
    es: "Subí un video de este dispositivo a Google Drive y fijate que se reproduzca acá.",
  },
  'mediaTest.wake.unavailable': { en: "Not available on this device", es: "No disponible en este dispositivo" },
  'mediaTest.wake.on': { en: "On: the screen stays on", es: "Activo: la pantalla queda encendida" },
  'mediaTest.wake.released': { en: "Released by the system", es: "Lo soltó el sistema" },
  'mediaTest.wake.refused': { en: "Refused ({reason})", es: "Rechazado ({reason})" },
  'mediaTest.selected': { en: "Selected: copy it from the menu", es: "Seleccionado: copialo desde el menú" },
  'mediaTest.settingsFailed': {
    en: "Could not read the workspace settings",
    es: "No se pudieron leer los ajustes del workspace",
  },
  'mediaTest.noServer': {
    en: "The workspace has no media server yet",
    es: "El workspace todavía no tiene servidor de archivos",
  },
  'mediaTest.ownerOnly': {
    en: "Only the owner of the workspace can connect Google Drive.",
    es: "Solo el dueño del workspace puede conectar Google Drive.",
  },
  'mediaTest.upload': { en: "Upload", es: "Subir" },
  'mediaTest.choose': { en: "Choose a video or a photo", es: "Elegir un video o una foto" },
  'mediaTest.name': { en: "Name", es: "Nombre" },
  'mediaTest.type': { en: "Type", es: "Tipo" },
  'mediaTest.none': { en: "(none)", es: "(ninguno)" },
  'mediaTest.bytes': { en: "({bytes} bytes)", es: "({bytes} bytes)" },
  'mediaTest.modified': { en: "Modified", es: "Modificado" },
  'mediaTest.uploadToDrive': { en: "Upload to Drive", es: "Subir a Drive" },
  'mediaTest.starting': { en: "Starting…", es: "Empezando…" },
  'mediaTest.retries': {
    en: { one: "{count} retry", other: "{count} retries" },
    es: { one: "{count} reintento", other: "{count} reintentos" },
  },
  'mediaTest.keepOpen': {
    en: "Keep the app open and the screen on.",
    es: "Dejá la app abierta y la pantalla encendida.",
  },
  'mediaTest.screenLock': { en: "Screen lock: {state}.", es: "Pantalla encendida: {state}." },
  'mediaTest.uploadedIn': { en: "Uploaded in {time}.", es: "Subido en {time}." },
  'mediaTest.play': { en: "Play", es: "Reproducir" },
  'mediaTest.nothing': {
    en: "Nothing uploaded from this device yet.",
    es: "Todavía no se subió nada desde este dispositivo.",
  },
  'mediaTest.asMp4Tip': {
    en: "Labels the file as MP4 when it is sent back,\nto test whether a .mov plays that way",
    es: "Marca el archivo como MP4 al devolverlo,\npara probar si un .mov se reproduce así",
  },
  'mediaTest.asMp4': { en: "Serve as video/mp4", es: "Servir como video/mp4" },
  'mediaTest.open': { en: "Open", es: "Abrir" },
  'mediaTest.noType': { en: "(no type)", es: "(sin tipo)" },
  'mediaTest.servedAs': { en: "served as {type}", es: "servido como {type}" },
  'mediaTest.readyAfter': { en: "Ready to play after {time}", es: "Listo para reproducir después de {time}" },
  'mediaTest.asking': { en: "Asking for a link…", es: "Pidiendo un link…" },
  'mediaTest.device': { en: "This device", es: "Este dispositivo" },
  'mediaTest.browser': { en: "Browser", es: "Navegador" },
  'mediaTest.installed': { en: "Installed", es: "Instalada" },
  'mediaTest.yes': { en: "Yes", es: "Sí" },
  'mediaTest.no': { en: "No", es: "No" },
  'mediaTest.report': { en: "Report", es: "Informe" },
  'mediaTest.copyReport': { en: "Copy report", es: "Copiar el informe" },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(mediaTest);
