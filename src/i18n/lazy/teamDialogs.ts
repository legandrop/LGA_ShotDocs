import { register } from '../index';
import type { Dict } from '../types';

// Los diálogos de miembros y compartir (se cargan aparte).

export const teamDialogs = {
  'team.linkCopied': {
    en: "Link copied — send it by email or WhatsApp",
    es: "Link copiado: mandalo por correo o por WhatsApp",
  },
  'team.role': { en: "Role", es: "Rol" },
  'team.access': { en: "Access", es: "Acceso" },
  'team.inviting': { en: "Inviting…", es: "Invitando…" },
  'team.inviteAndCopy': { en: "Invite and copy link", es: "Invitar y copiar el link" },
  'team.copyManually': { en: "Copy this link and send it:", es: "Copiá este link y mandalo:" },
  'members.invite': { en: "Invite someone", es: "Invitar a alguien" },
  'members.giveAccess': { en: "Give access to “{name}”", es: "Darle acceso a “{name}”" },
  'members.inviteHint': {
    en: "The app copies an invitation link for you to send.",
    es: "La app copia un link de invitación para que lo mandes.",
  },
  'members.people': { en: "People in the workspace", es: "Personas del workspace" },
  'members.you': { en: "(you)", es: "(vos)" },
  'members.removedOn': { en: "Removed {date}", es: "Quitado el {date}" },
  'members.active': { en: "Active", es: "Activo" },
  'members.roleOf': { en: "Role of {email}", es: "Rol de {email}" },
  'members.remove': { en: "Remove", es: "Quitar" },
  'members.removeConfirm': {
    en: "Remove {email} from the workspace?\n\nThey lose access right away, on every device. Projects they shared with others move to an admin, and their private projects stay hidden. Nothing is deleted. Their app offers to keep any changes that were not uploaded yet.",
    es: "¿Quitar a {email} del workspace?\n\nPierde el acceso enseguida, en todos sus dispositivos. Los proyectos que compartió con otros pasan a un admin, y sus proyectos privados quedan ocultos. No se borra nada. Su app le ofrece guardar los cambios que todavía no subió.",
  },
  'members.invitations': { en: "Invitations not used yet", es: "Invitaciones sin usar" },
  'members.invitedBy': { en: "Invited by {email}", es: "Invitado por {email}" },
  'members.invited': { en: "Invited", es: "Invitado" },
  'members.until': { en: "until {date}", es: "hasta el {date}" },
  'members.revoke': { en: "Revoke", es: "Revocar" },
  'members.revokeConfirm': {
    en: "Revoke the invitation for {email}? They can no longer join with it; nothing else changes.",
    es: "¿Revocar la invitación de {email}? Ya no va a poder entrar con ella; nada más cambia.",
  },
  'share.label': { en: "Share", es: "Compartir" },
  'share.deletedNow': {
    en: "Text and photos deleted from these pages can still reach the people you share them with.",
    es: "El texto y las fotos que se borraron de estas páginas todavía pueden llegarles a las personas con quienes las compartís.",
  },
  'share.deletedClean': {
    en: "They'll get the page as it is when the editors' apps refresh it, not its history. Something that stayed on the page for a minute may reach them even if you delete it later.",
    es: "Les llega la página como está cuando las apps de quienes editan la actualizan, no su historia. Algo que quedó en la página un minuto les puede llegar aunque después lo borres.",
  },
  'share.unsynced': {
    en: "There are unsynced changes on these pages: what you deleted may still reach them.",
    es: "Hay cambios sin sincronizar en estas páginas: lo que borraste todavía les puede llegar.",
  },
  'share.retry': { en: "Retry", es: "Reintentar" },
  'share.anyway': { en: "Share anyway", es: "Compartir igual" },
  'share.preparing': {
    en: "Preparing {done} of {count} pages for {email}…",
    es: "Preparando {done} de {count} páginas para {email}…",
  },
  'share.title': { en: "Share “{title}”", es: "Compartir “{title}”" },
  'share.projectScope': {
    en: "Access to a project covers every page in it.",
    es: "El acceso a un proyecto incluye todas sus páginas.",
  },
  'share.pageScope': {
    en: "Access to a page covers the pages inside it, never the ones above.",
    es: "El acceso a una página incluye las de adentro, nunca las de arriba.",
  },
  'share.creatorOnly': {
    en: "You can share this because you created the project: you can change or remove the access of the people below. To add someone else, ask the owner or an admin of the workspace.",
    es: "Podés compartir esto porque creaste el proyecto: podés cambiar o quitar el acceso de las personas de abajo. Para sumar a alguien más, pedíselo al dueño o a un admin del workspace.",
  },
  'share.cannotInvite': {
    en: "{email} does not have access here yet, and only the owner or an admin can add someone new. Ask one of them to invite this person; after that you can change or remove their access here.",
    es: "{email} todavía no tiene acceso acá, y solo el dueño o un admin pueden sumar a alguien nuevo. Pediles que inviten a esta persona; después vas a poder cambiar o quitar su acceso desde acá.",
  },
  'share.emailOrMember': { en: "name@example.com or pick a member", es: "nombre@ejemplo.com o elegí un miembro" },
  'share.emailListed': { en: "Email of someone listed below", es: "Correo de alguien de la lista de abajo" },
  'share.inviteAs': { en: "New to the workspace: invite as", es: "Es nuevo en el workspace: invitar como" },
  'share.sharing': { en: "Sharing…", es: "Compartiendo…" },
  'share.share': { en: "Share", es: "Compartir" },
  'share.who': { en: "Who has access", es: "Quién tiene acceso" },
  'share.nobody': { en: "Nobody yet.", es: "Nadie todavía." },
  'share.accessOf': { en: "Access of {email}", es: "Acceso de {email}" },
  'share.via.creator': { en: "created the project", es: "(creó el proyecto)" },
  'share.via.project': { en: "from the project", es: "desde el proyecto" },
  'share.via.page': { en: "from “{title}”", es: "desde “{title}”" },
  'share.via.pageAbove': { en: "a page above", es: "una página de arriba" },
  // El link público, "General access" (Docs/Doc_Link_Publico.md, 3.11).
  'share.link.general': { en: "General access", es: "Acceso general" },
  'share.link.restricted': { en: "Restricted", es: "Restringido" },
  'share.link.anyone': { en: "Anyone with the link", es: "Cualquiera con el link" },
  'share.link.canView': { en: "Can view (and comment)", es: "Puede ver (y comentar)" },
  // Can edit por un link (entrega 2a, Docs/Doc_Link_Publico.md, E2.8).
  'share.link.canEdit': { en: "Can edit", es: "Puede editar" },
  'share.link.editOff': {
    en: "Editing through a link isn't turned on for this workspace yet.",
    es: "Editar con un link todavía no está prendido en este workspace.",
  },
  'share.link.editHint': {
    en: "Changes made through the link reach other people when someone from your team opens the app.",
    es: "Lo que se cambia con el link les llega a los demás cuando alguien de tu equipo abre la app.",
  },
  'share.link.edits': {
    en: "{added} changes added today · {waiting} waiting · {aside} set aside · {held} on hold",
    es: "{added} cambios sumados hoy · {waiting} esperando · {aside} apartados · {held} en espera",
  },
  'share.link.restrictedHint': {
    en: "Only people with access can open it. With a link, anyone who has it opens this page and the ones inside, without an account.",
    es: "Solo la abre quien tiene acceso. Con un link, cualquiera que lo tenga abre esta página y las de adentro, sin cuenta.",
  },
  'share.link.anyoneHint': {
    en: "Anyone with the link can open this page and the ones inside, and comment with a name. Not for sensitive material.",
    es: "Cualquiera con el link abre esta página y las de adentro, y comenta con un nombre. No es para material sensible.",
  },
  'share.link.cleanOff': {
    en: "Links need the workspace setting that keeps deleted text out of shared pages. The owner of the workspace turns it on.",
    es: "Los links necesitan el ajuste del workspace que deja afuera de lo compartido lo que se borró. Lo prende el dueño del workspace.",
  },
  'share.link.notAlive': {
    en: "This link isn't working: it expired, or whoever created it can't share this page anymore. Reset link makes a new one.",
    es: "Este link no anda: venció, o quien lo creó ya no puede compartir esta página. Renovar link crea uno nuevo.",
  },
  'share.link.copy': { en: "Copy link", es: "Copiar link" },
  'share.link.copied': { en: "Link copied", es: "Link copiado" },
  'share.link.reset': { en: "Reset link", es: "Renovar link" },
  'share.link.resetConfirm': {
    en: "The current link will stop working for everyone who has it.",
    es: "El link actual va a dejar de andar para todos los que lo tienen.",
  },
  'share.link.expires': { en: "Expires", es: "Vence" },
  'share.link.never': { en: "Never", es: "Nunca" },
  'share.link.change': { en: "Change…", es: "Cambiar…" },
  'share.link.days': {
    en: { one: "In {count} day", other: "In {count} days" },
    es: { one: "En {count} día", other: "En {count} días" },
  },
  'share.link.onDate': { en: "On a date…", es: "Una fecha…" },
  'share.link.date': { en: "Expiry date", es: "Fecha de vencimiento" },
  'share.link.datePrompt': { en: "Expires at the end of (YYYY-MM-DD):", es: "Vence al final del día (AAAA-MM-DD):" },
  'share.link.badDate': { en: "Pick a date in the future.", es: "Elegí una fecha futura." },
  'share.link.expiresOn': { en: "on {date}", es: "el {date}" },
  'share.link.usage': {
    en: "Today: opened {opens} times · {comments} comments · {mb} MB downloaded",
    es: "Hoy: abierto {opens} veces · {comments} comentarios · {mb} MB bajados",
  },
  'share.link.limited': {
    en: "Daily limit reached: new visits are paused until tomorrow. Reset link if it went too far.",
    es: "Llegó al tope del día: las visitas nuevas siguen mañana. Si se escapó, Renovar link.",
  },
  'share.link.above': { en: "Anyone with the link to “{title}” can view this page.", es: "Cualquiera con el link de “{title}” puede ver esta página." },
  'share.link.goAbove': { en: "Go to it", es: "Ir a esa" },
  'share.link.visitors': { en: "the link", es: "el link" },
  'share.link.deleteComments': {
    en: { one: "Delete {count} comment from this link…", other: "Delete {count} comments from this link…" },
    es: { one: "Borrar {count} comentario de este link…", other: "Borrar {count} comentarios de este link…" },
  },
  'share.link.deleteCommentsConfirm': {
    en: { one: "Delete {count} comment written through this link?", other: "Delete {count} comments written through this link?" },
    es: { one: "¿Borrar {count} comentario escrito con este link?", other: "¿Borrar {count} comentarios escritos con este link?" },
  },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(teamDialogs);
