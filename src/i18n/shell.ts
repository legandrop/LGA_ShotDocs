import type { Dict } from './types';

// La pantalla principal: abrir el workspace, la barra de arriba, el inicio y los avisos de invitación.

export const shell = {
  // Reemplazar en el proyecto (Docs/Doc_Buscar.md): lo que se ve con el panel cerrado y al salir mientras corre.
  'replace.runningLeave': {
    en: "Replacing in the project is still running. Wait until it finishes, or press Stop.",
    es: "Todavía se está reemplazando en el proyecto. Esperá a que termine, o tocá Parar.",
  },
  'replace.bar': { en: "Replacing… {done} of {total} pages", es: "Reemplazando… {done} de {total} páginas" },
  'replace.barUndo': { en: "Undoing… {done} of {total} pages", es: "Deshaciendo… {done} de {total} páginas" },
  'replace.barStop': { en: "Stop", es: "Parar" },
  'replace.barRedo': { en: "Redoing… {done} of {total} pages", es: "Rehaciendo… {done} de {total} páginas" },
  // Lo que dice deshacer un reemplazo (también con ⌘Z, sin el panel cargado).
  'replace.undone': {
    en: { one: "Undid {count} replacement", other: "Undid {count} replacements" },
    es: { one: "Se deshizo {count} reemplazo", other: "Se deshicieron {count} reemplazos" },
  },
  'replace.undoChanged': {
    en: { one: "{count} had changed and was left as is", other: "{count} had changed and were left as they are" },
    es: { one: "{count} había cambiado y quedó como estaba", other: "{count} habían cambiado y quedaron como estaban" },
  },
  'replace.undoRemaining': {
    en: { one: "{count} page couldn't be undone now", other: "{count} pages couldn't be undone now" },
    es: { one: "{count} página no se pudo deshacer ahora", other: "{count} páginas no se pudieron deshacer ahora" },
  },
  'replace.unsaved': {
    en: "Couldn't save on this device: replacing stopped",
    es: "No se pudo guardar en este dispositivo: se paró el reemplazo",
  },
  // Deshacer en el orden en que editaste (P.26, Docs/Doc_Deshacer.md, sección 8): los avisos de ⌘Z y ⌘⇧Z.
  'undo.doneIn': { en: "Undone in “{page}”", es: "Deshecho en “{page}”" },
  'undo.redoneIn': { en: "Redone in “{page}”", es: "Rehecho en “{page}”" },
  'undo.back': { en: "Back", es: "Volver" },
  // El reemplazo del proyecto en la línea de tiempo (entrega 2).
  'undo.replaceUndone': { en: "Undid {what} in {pages}", es: "Se deshizo {what} en {pages}" },
  'undo.replaceRedone': { en: "Redid {what} in {pages}", es: "Se rehízo {what} en {pages}" },
  'undo.replaceWhat': { en: "“{from}” → “{to}”", es: "“{from}” → “{to}”" },
  'undo.replaceWhatDelete': { en: "deleting “{from}”", es: "el borrado de “{from}”" },
  'undo.pages': {
    en: { one: "{count} page", other: "{count} pages" },
    es: { one: "{count} página", other: "{count} páginas" },
  },
  // Lo anotado en una foto (entrega 3), cuando la foto ya no está en la página.
  'undo.markupGone': {
    en: "Undid annotations on a photo that's no longer in “{page}”.",
    es: "Se deshicieron las anotaciones de una foto que ya no está en “{page}”.",
  },
  'undo.markupGoneRedo': {
    en: "Redid annotations on a photo that's no longer in “{page}”.",
    es: "Se rehicieron las anotaciones de una foto que ya no está en “{page}”.",
  },
  // *Show* en el aviso de ⌘Z de un reemplazo con páginas que habían cambiado (entrega 3, pendiente de 18.4).
  'undo.showChanged': { en: "Show", es: "Mostrar" },
  'undo.changedHere': {
    en: "Changed after the replace, left as it is ({n} of {total})",
    es: "Cambió después del reemplazo y quedó como estaba ({n} de {total})",
  },
  'undo.nextChanged': { en: "Next", es: "Siguiente" },
  'undo.redoAction': { en: "Redo", es: "Rehacer" },
  'undo.undoAction': { en: "Undo", es: "Deshacer" },
  'undo.nothingThere': {
    en: "Nothing to undo there: someone else already changed it. {undo} again for the previous change.",
    es: "No hay nada para deshacer ahí: otra persona ya lo cambió. {undo} otra vez para el cambio anterior.",
  },
  'undo.nothingThereRedo': {
    en: "Nothing to redo there: someone else already changed it. {redo} again for the next change.",
    es: "No hay nada para rehacer ahí: otra persona ya lo cambió. {redo} otra vez para el cambio siguiente.",
  },
  'undo.lost': {
    en: "Older changes in “{page}” can't be undone (the page was reloaded).",
    es: "Los cambios anteriores en “{page}” no se pueden deshacer (la página se volvió a cargar).",
  },
  'undo.limit': {
    en: "Older changes can't be undone: undo keeps your last {pages} pages and {steps} changes in this tab.",
    es: "Los cambios anteriores no se pueden deshacer: deshacer guarda tus últimas {pages} páginas y {steps} cambios en esta pestaña.",
  },
  'undo.cant': {
    en: "Can't undo in “{page}”: {reason}. {undo} again for the previous change.",
    es: "No se puede deshacer en “{page}”: {reason}. {undo} otra vez para el cambio anterior.",
  },
  'undo.cantRedo': {
    en: "Can't redo in “{page}”: {reason}. {redo} again for the next change.",
    es: "No se puede rehacer en “{page}”: {reason}. {redo} otra vez para el cambio siguiente.",
  },
  'undo.reason.trash': { en: "it's in the trash", es: "está en la papelera" },
  'undo.reason.deleted': { en: "it was deleted", es: "se borró" },
  'undo.reason.noEdit': { en: "you can no longer edit it", es: "ya no la podés editar" },
  'undo.reason.loading': { en: "the page didn't open in time", es: "la página no terminó de abrir" },
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
  // La barrera de error de la app (ui/ErrorBarrier.tsx): un error que no dejó seguir, en lugar de la pantalla en blanco.
  'shell.crash.title': { en: "Something went wrong", es: "Algo salió mal" },
  'shell.crash.text': {
    en: "The app hit an error and can't continue in this window. Reload to keep working: what is saved on this device stays there.",
    es: "La app tuvo un error y no puede seguir en esta ventana. Recargá para seguir trabajando: lo guardado en este dispositivo queda ahí.",
  },
  'shell.crash.pending': {
    en: "{changes} still to upload: they are saved on this device and keep uploading after you reload.",
    es: "{changes} sin subir: están guardados en este dispositivo y se siguen subiendo después de recargar.",
  },
  'shell.error.title': { en: "Could not open your workspace", es: "No se pudo abrir tu workspace" },
  'shell.openPages': { en: "Open pages", es: "Abrir páginas" },
  'shell.findInPage': { en: "Find in page", es: "Buscar en la página" },
  // *Dictate to report* (Docs/Doc_Dictado.md): el botón de la barra y el redondo del teléfono.
  'shell.dictate': { en: "Dictate to report", es: "Dictar al reporte" },
  'shell.dictateSaved': {
    en: { one: "Dictate to report · {count} saved note", other: "Dictate to report · {count} saved notes" },
    es: { one: "Dictar al reporte · {count} nota guardada", other: "Dictar al reporte · {count} notas guardadas" },
  },
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
  // Instalar la app (Docs/Doc_Instalar.md): la entrada del menú de la cuenta y de la pantalla de entrar, y el aviso
  // del teléfono. Los pasos están en lazy/install.ts.
  'install.menu': { en: "Install app", es: "Instalar la app" },
  'install.menuTip': {
    en: "Opens in its own window, from the home screen or the Dock.\nSteps for iPhone, Android and computer",
    es: "Se abre en su propia ventana, desde la pantalla de inicio o el Dock.\nPasos para iPhone, Android y computadora",
  },
  'install.banner.title': { en: "Install the app", es: "Instalá la app" },
  'install.banner.text': {
    en: "Open Shot Docs from your home screen, full screen, and keep your offline copy safer.",
    es: "Abrí Shot Docs desde la pantalla de inicio, en pantalla completa, y cuidá mejor tu copia sin red.",
  },
  'install.banner.install': { en: "Install", es: "Instalar" },
  'install.banner.notNow': { en: "Not now", es: "Ahora no" },
  'install.installed': {
    en: "Installed. Open Shot Docs from your home screen or app list.",
    es: "Instalada. Abrí Shot Docs desde la pantalla de inicio o la lista de apps.",
  },
} satisfies Dict;
