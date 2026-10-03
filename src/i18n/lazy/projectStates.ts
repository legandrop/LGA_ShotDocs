import { register } from '../index';
import type { Dict } from '../types';

// La ventana de borrar un proyecto y los proyectos borrados de la papelera (P.14; se cargan aparte).

export const projectStates = {
  'deleteProject.title': { en: "Delete “{name}”?", es: "¿Borrar “{name}”?" },
  'deleteProject.stats': {
    en: "{pages} · {files} · {size} in Google Drive",
    es: "{pages} · {files} · {size} en Google Drive",
  },
  'deleteProject.files': {
    en: { one: "{count} file", other: "{count} files" },
    es: { one: "{count} archivo", other: "{count} archivos" },
  },
  'deleteProject.shared': {
    en: { one: "Shared with {count} person.", other: "Shared with {count} people." },
    es: { one: "Compartido con {count} persona.", other: "Compartido con {count} personas." },
  },
  'deleteProject.where': {
    en: "It goes to the Trash: nobody sees it anymore, and it can be restored exactly as it was for {days} days.",
    es: "Va a la papelera: nadie lo ve más, y se puede restaurar tal como estaba durante {days} días.",
  },
  'deleteProject.driveStays': {
    en: "Its files stay in Google Drive ({size}).",
    es: "Sus archivos quedan en Google Drive ({size}).",
  },
  // La casilla de Drive (entrega 2): arranca destildada; solo dueño y admins, con Drive conectado.
  'deleteProject.driveOption': {
    en: "Also send its files to the Google Drive trash ({size})",
    es: "Mandar también sus archivos a la papelera de Google Drive ({size})",
  },
  'deleteProject.driveHint': {
    en: "The folder {folder} goes to the Drive trash with everything in it, also what someone added to it by hand. Google deletes it for good after 30 days; restoring the project before that brings it back.",
    es: "La carpeta {folder} va a la papelera de Drive con todo lo que tiene adentro, también lo que alguien haya agregado a mano. Google la borra para siempre a los 30 días; restaurar el proyecto antes la trae de vuelta.",
  },
  'deleteProject.driveOnlyStaff': {
    en: "Only the workspace owner or an admin can send its files to the Google Drive trash.",
    es: "Solo el dueño del workspace o un admin puede mandar sus archivos a la papelera de Google Drive.",
  },
  'deleteProject.driveChecking': { en: "Checking Google Drive…", es: "Revisando Google Drive…" },
  'deleteProject.driveMissingBefore': {
    en: "The files that were not found the last time can no longer be recovered from the app; only by hand from Google Drive, if they are still there.",
    es: "Los archivos que no se encontraron la vez anterior dejan de poder recuperarse desde la app; se recuperan solo a mano desde Google Drive, si siguen ahí.",
  },
  'deleteProject.sendingDrive': { en: "Sending to the Drive trash…", es: "Mandando a la papelera de Drive…" },
  'deleteProject.driveSent': {
    en: "Its folder is in the Google Drive trash.",
    es: "Su carpeta está en la papelera de Google Drive.",
  },
  'deleteProject.driveWasMissing': {
    en: "Google Drive no longer had its folder.",
    es: "Google Drive ya no tenía su carpeta.",
  },
  'deleteProject.driveFailed': {
    en: "Its files did not go to the Google Drive trash ({reason}): send them from the Trash.",
    es: "Sus archivos no fueron a la papelera de Google Drive ({reason}): mandalos desde la papelera.",
  },
  'deleteProject.usedElsewhere': {
    en: {
      one: "{count} file of this project is also used in pages of other projects: it stops showing there.",
      other: "{count} files of this project are also used in pages of other projects: they stop showing there.",
    },
    es: {
      one: "{count} archivo de este proyecto se usa también en páginas de otros proyectos: deja de verse ahí.",
      other: "{count} archivos de este proyecto se usan también en páginas de otros proyectos: dejan de verse ahí.",
    },
  },
  'deleteProject.foreignOnlyHere': {
    en: {
      one: "{count} file from another project is used only here: it stays in its project's trash while this one is deleted.",
      other: "{count} files from other projects are used only here: they stay in their project's trash while this one is deleted.",
    },
    es: {
      one: "{count} archivo de otro proyecto se usa solo acá: queda en la papelera de su proyecto mientras este esté borrado.",
      other: "{count} archivos de otros proyectos se usan solo acá: quedan en la papelera de su proyecto mientras este esté borrado.",
    },
  },
  'deleteProject.unsynced': {
    en: {
      one: "This device has {count} change in this project that is not uploaded yet. Let it upload, or download it, before deleting.",
      other: "This device has {count} changes in this project that are not uploaded yet. Let them upload, or download them, before deleting.",
    },
    es: {
      one: "Este dispositivo tiene {count} cambio de este proyecto sin subir. Esperá a que suba, o bajalo, antes de borrarlo.",
      other: "Este dispositivo tiene {count} cambios de este proyecto sin subir. Esperá a que suban, o bajalos, antes de borrarlo.",
    },
  },
  'deleteProject.typeWord': { en: "Type {word} to confirm", es: "Escribí {word} para confirmar" },
  'deleteProject.button': { en: "Delete project", es: "Borrar proyecto" },
  'deleteProject.deleting': { en: "Deleting…", es: "Borrando…" },
  'deleteProject.done': {
    en: "“{name}” is in the Trash. It can be restored for {days} days.",
    es: "“{name}” está en la papelera. Se puede restaurar durante {days} días.",
  },
  'deleteProject.checking': { en: "Checking this device…", es: "Revisando este dispositivo…" },
  'deleteProject.loadFailed': {
    en: "Could not read this project: {reason}",
    es: "No se pudo leer este proyecto: {reason}",
  },
  'deletedList.hint': {
    en: "Deleted projects can be restored exactly as they were. After 30 days too, until someone deletes them forever. Their files stay in Google Drive unless they were sent to its trash.",
    es: "Los proyectos borrados se restauran tal como estaban. También después de los 30 días, mientras nadie los borre para siempre. Sus archivos siguen en Google Drive, salvo que se hayan mandado a su papelera.",
  },
  'deletedList.by': { en: "Deleted by {email} · {when}", es: "Lo borró {email} · {when}" },
  'deletedList.on': { en: "Deleted {when}", es: "Borrado {when}" },
  'deletedList.daysLeft': {
    en: { one: "{count} day left", other: "{count} days left" },
    es: { one: "queda {count} día", other: "quedan {count} días" },
  },
  'deletedList.passed': { en: "30 days passed", es: "pasaron los 30 días" },
  'deletedList.restore': { en: "Restore", es: "Restaurar" },
  'deletedList.restoring': { en: "Restoring…", es: "Restaurando…" },
  'deletedList.restored': {
    en: "“{name}” is back exactly as it was.",
    es: "“{name}” volvió tal como estaba.",
  },
  'deletedList.restoredWithoutFiles': {
    en: "“{name}” is back without its files. If its folder turns up in Google Drive, “Look for its files again” on its start page brings them back.",
    es: "“{name}” volvió sin sus archivos. Si su carpeta aparece en Google Drive, “Buscar sus archivos de nuevo” en su inicio los trae.",
  },
  'deletedList.driveTrashed': {
    en: "Files in the Google Drive trash until {date}",
    es: "Archivos en la papelera de Google Drive hasta el {date}",
  },
  'deletedList.driveTrashedPast': {
    en: "Files sent to the Google Drive trash on {date}: Google deletes them for good after 30 days",
    es: "Archivos mandados a la papelera de Google Drive el {date}: Google los borra para siempre a los 30 días",
  },
  'deletedList.driveUnfinished': {
    en: "Sending its files to the Google Drive trash did not finish",
    es: "No terminó de mandar sus archivos a la papelera de Google Drive",
  },
  'deletedList.needsStaff': {
    en: "Its files are in the Google Drive trash: the workspace owner or an admin has to restore it.",
    es: "Sus archivos están en la papelera de Google Drive: lo tiene que restaurar el dueño del workspace o un admin.",
  },
  'deletedList.sendToDrive': { en: "Send files to the Drive trash", es: "Mandar archivos a la papelera de Drive" },
  'deletedList.sendToDriveSize': {
    en: "Send files to the Drive trash ({size})",
    es: "Mandar archivos a la papelera de Drive ({size})",
  },
  'deletedList.sendConfirm': {
    en: "Send the folder {folder} to the Google Drive trash, with everything in it? Google deletes it for good after 30 days; restoring the project before that brings it back.",
    es: "¿Mandar la carpeta {folder} a la papelera de Google Drive, con todo lo que tiene adentro? Google la borra para siempre a los 30 días; restaurar el proyecto antes la trae de vuelta.",
  },
  'deletedList.send': { en: "Send to the Drive trash", es: "Mandar a la papelera" },
  'deletedList.sending': { en: "Sending…", es: "Mandando…" },
  'deletedList.sent': {
    en: "The folder of “{name}” is in the Google Drive trash.",
    es: "La carpeta de “{name}” está en la papelera de Google Drive.",
  },
  'deletedList.missingQuestion': {
    en: "Google Drive no longer has the folder of this project: Google deleted it for good, or someone took it out of the trash and deleted it. Restore its pages and text without its files?",
    es: "Google Drive ya no tiene la carpeta de este proyecto: Google la borró para siempre o alguien la sacó de la papelera y la borró. ¿Restaurar las páginas y el texto sin sus archivos?",
  },
  'deletedList.restoreWithoutFiles': { en: "Restore without its files", es: "Restaurar sin sus archivos" },
  'deletedList.none': { en: "No deleted projects.", es: "No hay proyectos borrados." },
  'deletedList.notYet': {
    en: "This workspace does not have deleted projects yet: its database needs an update.",
    es: "Este workspace todavía no tiene proyectos borrados: hay que actualizar su base.",
  },
  'deletedList.loadFailed': {
    en: "Could not load the deleted projects: {reason}",
    es: "No se pudieron leer los proyectos borrados: {reason}",
  },
  // *Delete forever* (entrega 3): en el renglón de un borrado, pasados los 30 días, solo dueño y admins que lo manejan.
  'purgeProject.open': { en: "Delete forever…", es: "Borrar para siempre…" },
  'purgeProject.confirm': {
    en: "Delete “{name}” forever? It leaves the Trash and can no longer be restored from the app. If its folder is not in the Google Drive trash yet, it goes there now; Google deletes it for good after 30 days.",
    es: "¿Borrar “{name}” para siempre? Sale de la papelera y ya no se puede restaurar desde la app. Si su carpeta todavía no está en la papelera de Google Drive, va ahora; Google la borra para siempre a los 30 días.",
  },
  'purgeProject.usedElsewhere': {
    en: {
      one: "{count} file of this project is also used in pages of other projects: it goes to the Google Drive trash with the folder, and those pages lose it for good when Google empties the trash.",
      other: "{count} files of this project are also used in pages of other projects: they go to the Google Drive trash with the folder, and those pages lose them for good when Google empties the trash.",
    },
    es: {
      one: "{count} archivo de este proyecto se usa también en páginas de otros proyectos: va a la papelera de Google Drive con la carpeta, y esas páginas lo pierden para siempre cuando Google vacía la papelera.",
      other: "{count} archivos de este proyecto se usan también en páginas de otros proyectos: van a la papelera de Google Drive con la carpeta, y esas páginas los pierden para siempre cuando Google vacía la papelera.",
    },
  },
  'purgeProject.button': { en: "Delete forever", es: "Borrar para siempre" },
  'purgeProject.purging': { en: "Deleting…", es: "Borrando…" },
  'purgeProject.sendingDrive': { en: "Sending its folder to the Drive trash…", es: "Mandando su carpeta a la papelera de Drive…" },
  'purgeProject.done': { en: "“{name}” was deleted forever.", es: "“{name}” se borró para siempre." },
  'purgeProject.notDue': {
    en: "A deleted project can be deleted forever 30 days after it was deleted.",
    es: "Un proyecto borrado se puede borrar para siempre 30 días después de borrarlo.",
  },
  'purgeProject.notDeleted': {
    en: "It is not in the Trash anymore: someone restored it.",
    es: "Ya no está en la papelera: alguien lo restauró.",
  },
  'purgeProject.driveFirst': {
    en: "Some of its files are not in the Google Drive trash yet: try again.",
    es: "Algunos de sus archivos todavía no están en la papelera de Google Drive: probá de nuevo.",
  },
  'purgeProject.driveFailed': {
    en: "Its folder did not go to the Google Drive trash ({reason}), so it was not deleted forever.",
    es: "Su carpeta no fue a la papelera de Google Drive ({reason}), así que no se borró para siempre.",
  },
} satisfies Dict;

register(projectStates);
