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
  'drive.space': { en: "Space in Drive", es: "Espacio en Drive" },
  'drive.spaceTotal': {
    en: { one: "{size} in {files} file", other: "{size} in {files} files" },
    es: { one: "{size} en {files} archivo", other: "{size} en {files} archivos" },
  },
  'drive.spaceNothing': { en: "Nothing uploaded yet.", es: "Todavía no se subió nada." },
  'drive.spaceDriveTrash': { en: "+ {size} in the Google Drive trash", es: "+ {size} en la papelera de Google Drive" },
  'drive.spaceInTrash': { en: "{size} of it in the app's trash", es: "{size} de eso en la papelera de la app" },
  'drive.spacePending': {
    en: { one: "{size} ({files} file) still uploading from devices", other: "{size} ({files} files) still uploading from devices" },
    es: { one: "{size} ({files} archivo) todavía subiendo desde los dispositivos", other: "{size} ({files} archivos) todavía subiendo desde los dispositivos" },
  },
  'drive.spaceHidden': { en: "{size} in projects you don't see", es: "{size} en proyectos que no ves" },
  'drive.spaceNote': {
    en: "It counts what the app uploaded to Drive, including the app's trash. It doesn't count what was done by hand in Drive, extra copies of a duplicated upload, files restored by hand from the Drive trash, or thumbnails (those are stored in the database). If the folder is in another Google account or in a shared drive, this is not the owner's quota anymore: it is what the app uploaded.",
    es: "Cuenta lo que la app subió a Drive, con la papelera de la app. No cuenta lo que se hizo a mano en Drive, las copias de más de una subida duplicada, lo restaurado a mano desde la papelera de Drive ni las miniaturas (están en la base). Si la carpeta está en otra cuenta de Google o en una unidad compartida, ya no es la cuota del dueño: es lo que la app subió.",
  },
  'drive.spaceUpdated': { en: "Updated {time}", es: "Actualizado {time}" },
  'drive.spaceOffline': {
    en: "No connection: last calculated on {date}",
    es: "Sin conexión: último cálculo del {date}",
  },
  'drive.spaceFailed': { en: "Could not calculate it ({reason})", es: "No se pudo calcular ({reason})" },
  'drive.spaceLoading': { en: "Calculating…", es: "Calculando…" },
  'drive.spaceRecalc': { en: "Recalculate", es: "Volver a calcular" },
  'picker.loadFailed': {
    en: "Could not load the Google folder picker. Check the connection and try again.",
    es: "No se pudo cargar el selector de carpetas de Google. Revisá la conexión y probá de nuevo.",
  },
  'picker.title': { en: "Choose where the LGA_ShotDocs folder goes", es: "Elegí dónde va la carpeta LGA_ShotDocs" },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(drive);
