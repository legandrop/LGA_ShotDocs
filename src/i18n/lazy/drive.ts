import { register } from '../index';
import type { Dict } from '../types';

// El diálogo de Google Drive del menú de la cuenta (se carga aparte).

export const drive = {
  'drive.aFolder': { en: "a folder", es: "una carpeta" },
  'drive.root': { en: "My Drive (the root)", es: "Mi unidad (la raíz)" },
  'drive.intro': {
    en: "Photos and videos added to pages are stored in the workspace owner's Google Drive.",
    es: "Las fotos y los videos que se agregan a las páginas se guardan en el Google Drive del dueño del workspace.",
  },
  'drive.noServer': {
    en: "This workspace has no media server yet (see Docs/Doc_Portero.md).",
    es: "Este workspace todavía no tiene servidor de archivos (ver Docs/Doc_Portero.md).",
  },
  'drive.folder': { en: "Folder", es: "Carpeta" },
  'drive.folderText': {
    en: "{folder} is in {place}. Inside it: one folder per project, and one per day.",
    es: "{folder} está en {place}. Adentro: una carpeta por proyecto, y una por día.",
  },
  'drive.noPicker': {
    en: "The folder goes to the root of My Drive. To choose another folder, the media server needs a Google API key ({key}, step 2b of the media server guide, Docs/Doc_Portero.md).",
    es: "La carpeta va a la raíz de Mi unidad. Para elegir otra carpeta, el servidor de archivos necesita una clave de la API de Google ({key}, paso 2b de la guía del servidor de archivos, Docs/Doc_Portero.md).",
  },
  'drive.ownerOnly': {
    en: "Only the owner of the workspace can change this.",
    es: "Solo el dueño del workspace puede cambiar esto.",
  },
  'drive.reconnectDrive': { en: "Reconnect Google Drive", es: "Volver a conectar Google Drive" },
  'drive.chooseTip': {
    en: "Opens Google's folder picker. The LGA_ShotDocs folder moves there with everything in it.",
    es: "Abre el selector de carpetas de Google. La carpeta LGA_ShotDocs se mueve ahí con todo lo que tiene.",
  },
  'drive.choosing': { en: "Choosing…", es: "Eligiendo…" },
  'drive.choose': { en: "Choose folder…", es: "Elegir carpeta…" },
  'drive.useRootTip': {
    en: "Moves the LGA_ShotDocs folder back to the root of My Drive",
    es: "Vuelve a poner la carpeta LGA_ShotDocs en la raíz de Mi unidad",
  },
  'drive.useRoot': { en: "Use My Drive root", es: "Usar la raíz de Mi unidad" },
  'drive.reconnectTip': {
    en: "Authorize Google Drive again, with the same Google account",
    es: "Autoriza Google Drive de nuevo, con la misma cuenta de Google",
  },
  'drive.reconnect': { en: "Reconnect", es: "Volver a conectar" },
  'picker.loadFailed': {
    en: "Could not load the Google folder picker. Check the connection and try again.",
    es: "No se pudo cargar el selector de carpetas de Google. Revisá la conexión y probá de nuevo.",
  },
  'picker.title': { en: "Choose where the LGA_ShotDocs folder goes", es: "Elegí dónde va la carpeta LGA_ShotDocs" },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(drive);
