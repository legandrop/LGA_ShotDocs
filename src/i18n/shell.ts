import type { Dict } from './types';

// La pantalla principal: abrir el workspace, la barra de arriba, el inicio y los avisos de invitación.

export const shell = {
  'shell.opening': { en: "Opening your workspace…", es: "Abriendo tu workspace…" },
  'shell.busy.title': { en: "Already open in another window", es: "Ya está abierta en otra ventana" },
  'shell.busy.text': {
    en: "LGA Shot Docs is open in another tab or window. Keep working there, or close it and this one will open by itself.",
    es: "LGA Shot Docs está abierta en otra pestaña o ventana. Seguí trabajando ahí, o cerrala y esta se abre sola.",
  },
  'shell.busy.takeOver': {
    en: "The other window is not responding: use this one",
    es: "La otra ventana no responde: usar esta",
  },
  'shell.lost.title': { en: "Opened in another window", es: "Se abrió en otra ventana" },
  'shell.lost.text': {
    en: "Another window took over, so this one stopped saving. Your edits are kept on this device; reload to use this window again.",
    es: "Otra ventana tomó el control y esta dejó de guardar. Tus cambios quedan en este dispositivo; recargá para volver a usar esta ventana.",
  },
  'shell.lost.reload': { en: "Reload", es: "Recargar" },
  'shell.error.title': { en: "Could not open your workspace", es: "No se pudo abrir tu workspace" },
  'shell.openPages': { en: "Open pages", es: "Abrir páginas" },
  'shell.findInPage': { en: "Find in page ({shortcut})", es: "Buscar en la página ({shortcut})" },
  'shell.location': { en: "Location", es: "Ubicación" },
  'home.thisProject': { en: "This project", es: "Este proyecto" },
  'home.empty': { en: "{name} is empty", es: "{name} está vacío" },
  'home.nothingShared': { en: "Nothing here is shared with you yet.", es: "Todavía no te compartieron nada acá." },
  'home.openPage': { en: "Open a page from the sidebar.", es: "Abrí una página de la barra lateral." },
  'home.createFirst': {
    en: "Create your first page: a show, a scene or a shoot day. Every page can hold other pages.",
    es: "Creá tu primera página: un proyecto, una escena o un día de rodaje. Cada página puede tener otras adentro.",
  },
  'home.openOrCreate': {
    en: "Open a page from the sidebar or create a new one.",
    es: "Abrí una página de la barra lateral o creá una nueva.",
  },
  'noProjects.title': { en: "No projects yet", es: "Todavía no hay proyectos" },
  'noProjects.canCreate': {
    en: "You are signed in to {workspace} as {email}. Create the first project to start.",
    es: "Entraste a {workspace} como {email}. Creá el primer proyecto para empezar.",
  },
  'noProjects.wait': {
    en: "You are signed in to {workspace} as {email}, but nothing has been shared with you yet. Ask the workspace owner for access; this page opens your projects as soon as they share one.",
    es: "Entraste a {workspace} como {email}, pero todavía no te compartieron nada. Pedile acceso al dueño del workspace; esta pantalla abre tus proyectos apenas te comparta uno.",
  },
  'noProjects.thisWorkspace': { en: "this workspace", es: "este workspace" },
  // Con proyectos borrados que la persona puede restaurar (P.14).
  'noProjects.restoreOrCreate': {
    en: "You are signed in to {workspace} as {email}. Restore a deleted project below, or create a new one.",
    es: "Entraste a {workspace} como {email}. Restaurá un proyecto borrado de abajo, o creá uno nuevo.",
  },
  'noProjects.restore': {
    en: "You are signed in to {workspace} as {email}. Restore a deleted project below.",
    es: "Entraste a {workspace} como {email}. Restaurá un proyecto borrado de abajo.",
  },
  'noProjects.pending': {
    en: {
      one: "This device has {count} change that is not uploaded yet. It is kept here and uploads if its project is restored.",
      other: "This device has {count} changes that are not uploaded yet. They are kept here and upload if their project is restored.",
    },
    es: {
      one: "Este dispositivo tiene {count} cambio sin subir. Queda guardado acá y sube si restauran su proyecto.",
      other: "Este dispositivo tiene {count} cambios sin subir. Quedan guardados acá y suben si restauran su proyecto.",
    },
  },
  'home.archived': {
    en: "Archived: out of your everyday list. Unarchive it from Archived projects in the project menu.",
    es: "Archivado: fuera de tu lista de todos los días. Se desarchiva desde Proyectos archivados, en el selector.",
  },
  // Restaurado sin su carpeta de Drive (P.14, entrega 2): las fotos y archivos subidos antes no se ven.
  'home.driveMissing': {
    en: "Its files were not in Google Drive when it was restored, so its photos and files do not show. If its folder turns up in Google Drive, look for them again.",
    es: "Sus archivos no estaban en Google Drive cuando se restauró, así que sus fotos y archivos no se ven. Si su carpeta vuelve a aparecer en Google Drive, buscalos de nuevo.",
  },
  'project.lookForFiles': { en: "Look for its files again", es: "Buscar sus archivos de nuevo" },
  'project.lookingForFiles': { en: "Looking…", es: "Buscando…" },
  'project.filesBack': {
    en: "Its files are back from the Google Drive trash.",
    es: "Sus archivos volvieron de la papelera de Google Drive.",
  },
  'project.filesStillMissing': {
    en: "Google Drive still does not have the folder of this project.",
    es: "Google Drive sigue sin tener la carpeta de este proyecto.",
  },
  // Los errores del portero con la carpeta de un proyecto (src/media/projectDrive.ts).
  'projectDrive.notConnected': {
    en: "Google Drive is not connected: the workspace owner has to connect it.",
    es: "Google Drive no está conectado: el dueño del workspace tiene que conectarlo.",
  },
  'projectDrive.otherAccount': {
    en: "Google Drive is connected to another account: connect the one this project used to restore its files.",
    es: "Google Drive está conectado a otra cuenta: conectá la que usaba este proyecto para restaurar sus archivos.",
  },
  'projectDrive.mismatch': {
    en: "The folder in Google Drive does not belong to this project: nothing was touched. Ask the workspace owner.",
    es: "La carpeta de Google Drive no es de este proyecto: no se tocó nada. Preguntale al dueño del workspace.",
  },
  'projectDrive.driveFailed': {
    en: "Google Drive did not answer. Try again: nothing is lost.",
    es: "Google Drive no respondió. Probá de nuevo: no se pierde nada.",
  },
  'projectDrive.notAllowed': {
    en: "Only the workspace owner or an admin who manages this project can do this.",
    es: "Solo el dueño del workspace o un admin que maneja este proyecto puede hacerlo.",
  },
  'projectDrive.outdated': {
    en: "This workspace's database needs an update for this.",
    es: "Para esto hay que actualizar la base de este workspace.",
  },
  'projectDrive.restoredMeanwhile': {
    en: "Someone restored the project meanwhile: its folder stays in Google Drive.",
    es: "Alguien restauró el proyecto mientras tanto: su carpeta queda en Google Drive.",
  },
  'projectDrive.noPortero': {
    en: "This workspace has no file server.",
    es: "Este workspace no tiene servidor de archivos.",
  },
  'projectDrive.unreachable': { en: "Could not reach the file server.", es: "No se pudo llegar al servidor de archivos." },
  'invite.incomplete': {
    en: "This invitation link is incomplete. Copy the whole link again, or ask for a new one.",
    es: "Este link de invitación está incompleto. Copiá el link entero otra vez, o pedí uno nuevo.",
  },
  'invite.targetMissing': {
    en: "The shared page is not available to this account yet. Ask the person who invited you.",
    es: "La página compartida todavía no está disponible para esta cuenta. Preguntale a quien te invitó.",
  },
  'legal.label': { en: "Legal", es: "Legales" },
  'legal.privacy': { en: "Privacy", es: "Privacidad" },
  'legal.terms': { en: "Terms", es: "Condiciones" },
  'legal.englishOnly': {
    en: "This page is only in English: it is the version Google reviews and the one that applies.",
    es: "Esta página está solo en inglés: es la versión que revisa Google y la que vale.",
  },
  'lazy.newVersion': { en: "A new version is available — reloading", es: "Hay una versión nueva: recargando" },
  'lazy.draftQuestion': {
    en: "A comment you wrote has not been sent. Reload anyway and lose it?",
    es: "Un comentario que escribiste no se mandó. ¿Recargar igual y perderlo?",
  },
  'lazy.unsaved': {
    en: "A new version of the app is available. It did not reload by itself because something you wrote is not saved yet (or a comment is not sent). Finish it, then reload.",
    es: "Hay una versión nueva de la app. No se recargó sola porque algo que escribiste todavía no se guardó (o un comentario no se mandó). Terminalo y después recargá.",
  },
  'lazy.offline': {
    en: "This part of the app is not on this device yet. Connect to the internet: it tries again by itself.",
    es: "Esta parte de la app todavía no está en este dispositivo. Conectate a internet: se vuelve a intentar sola.",
  },
  'lazy.failed': {
    en: "This part of the app could not be loaded. Reload to try again.",
    es: "No se pudo cargar esta parte de la app. Recargá para intentar de nuevo.",
  },
  'lazy.couldNotOpen': { en: "Could not open", es: "No se pudo abrir" },
  'lazy.couldNotOpenTitle': { en: "Could not open this", es: "No se pudo abrir esto" },
  'legal.openApp': { en: "Open the app", es: "Abrir la app" },
} satisfies Dict;
