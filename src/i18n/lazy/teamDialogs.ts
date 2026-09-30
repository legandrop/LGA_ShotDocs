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
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(teamDialogs);
