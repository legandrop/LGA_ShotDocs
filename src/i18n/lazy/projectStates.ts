import { register } from '../index';
import type { Dict } from '../types';

// La ventana de borrar un proyecto y la lista de proyectos borrados (P.14; se cargan aparte).

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
    en: "It goes to Deleted projects: nobody sees it anymore, and it can be restored exactly as it was for {days} days.",
    es: "Va a Proyectos borrados: nadie lo ve más, y se puede restaurar tal como estaba durante {days} días.",
  },
  'deleteProject.driveStays': {
    en: "Its files stay in Google Drive ({size}).",
    es: "Sus archivos quedan en Google Drive ({size}).",
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
    en: "“{name}” is in Deleted projects. It can be restored for {days} days.",
    es: "“{name}” está en Proyectos borrados. Se puede restaurar durante {days} días.",
  },
  'deleteProject.checking': { en: "Checking this device…", es: "Revisando este dispositivo…" },
  'deleteProject.loadFailed': {
    en: "Could not read this project: {reason}",
    es: "No se pudo leer este proyecto: {reason}",
  },
  'deletedList.hint': {
    en: "Deleted projects can be restored exactly as they were. After 30 days too, until someone deletes them forever. Their files stay in Google Drive.",
    es: "Los proyectos borrados se restauran tal como estaban. También después de los 30 días, mientras nadie los borre para siempre. Sus archivos siguen en Google Drive.",
  },
  'deletedList.by': { en: "Deleted by {email} · {when}", es: "Lo borró {email} · {when}" },
  'deletedList.on': { en: "Deleted {when}", es: "Borrado {when}" },
  'deletedList.daysLeft': {
    en: { one: "{count} day left", other: "{count} days left" },
    es: { one: "Queda {count} día", other: "Quedan {count} días" },
  },
  'deletedList.passed': { en: "30 days passed", es: "Pasaron los 30 días" },
  'deletedList.restore': { en: "Restore", es: "Restaurar" },
  'deletedList.restoring': { en: "Restoring…", es: "Restaurando…" },
  'deletedList.restored': {
    en: "“{name}” is back exactly as it was.",
    es: "“{name}” volvió tal como estaba.",
  },
  'deletedList.none': { en: "No deleted projects.", es: "No hay proyectos borrados." },
  'deletedList.notYet': {
    en: "This workspace does not have deleted projects yet: its database needs an update.",
    es: "Este workspace todavía no tiene proyectos borrados: hay que actualizar su base.",
  },
  'deletedList.loadFailed': {
    en: "Could not load the deleted projects: {reason}",
    es: "No se pudieron leer los proyectos borrados: {reason}",
  },
} satisfies Dict;

register(projectStates);
