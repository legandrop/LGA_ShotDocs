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
  'invite.incomplete': {
    en: "This invitation link is incomplete. Copy the whole link again, or ask for a new one.",
    es: "Este link de invitación está incompleto. Copiá el link entero otra vez, o pedí uno nuevo.",
  },
  'invite.targetMissing': {
    en: "The shared page is not available to this account yet. Ask the person who invited you.",
    es: "La página compartida todavía no está disponible para esta cuenta. Preguntale a quien te invitó.",
  },
} satisfies Dict;
