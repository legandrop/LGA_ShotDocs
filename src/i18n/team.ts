import type { Dict } from './types';

// El equipo: miembros, compartir, roles, permisos y sus errores.

export const team = {
  'role.owner': { en: "Owner", es: "Dueño" },
  'role.admin': { en: "Admin", es: "Admin" },
  'role.member': { en: "Member", es: "Miembro" },
  'role.guest': { en: "Guest", es: "Invitado" },
  'level.view': { en: "View", es: "Ver" },
  'level.comment': { en: "Comment", es: "Comentar" },
  'level.edit': { en: "Edit", es: "Editar" },
  'level.editPages': { en: "Edit & create pages", es: "Editar y crear páginas" },
  'team.linkCopied': {
    en: "Link copied — send it by email or WhatsApp",
    es: "Link copiado: mandalo por correo o por WhatsApp",
  },
  'team.email': { en: "Email", es: "Correo" },
  'team.emailPlaceholder': { en: "name@example.com", es: "nombre@ejemplo.com" },
  'team.role': { en: "Role", es: "Rol" },
  'team.access': { en: "Access", es: "Acceso" },
  'team.inviting': { en: "Inviting…", es: "Invitando…" },
  'team.inviteAndCopy': { en: "Invite and copy link", es: "Invitar y copiar el link" },
  'team.copyManually': { en: "Copy this link and send it:", es: "Copiá este link y mandalo:" },
  'team.inviteLink': { en: "Invitation link", es: "Link de invitación" },
  'members.title': { en: "Members", es: "Miembros" },
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
  'teamError.notAllowed': { en: "You are not allowed to do this.", es: "No tenés permiso para hacer esto." },
  'teamError.ownerCannotChange': {
    en: "Nobody can change or remove the owner of the workspace.",
    es: "Nadie puede cambiar ni quitar al dueño del workspace.",
  },
  'teamError.memberNotFound': {
    en: "This person is not an active member of the workspace anymore.",
    es: "Esta persona ya no es miembro activo del workspace.",
  },
  'teamError.grantNotFound': {
    en: "That access was already removed, or you cannot change it.",
    es: "Ese acceso ya se quitó, o no podés cambiarlo.",
  },
  'teamError.grantNotAllowed': {
    en: "You can only share what you can edit and create pages in.",
    es: "Solo podés compartir donde podés editar y crear páginas.",
  },
  'teamError.emailInvalid': { en: "That email does not look right.", es: "Ese correo no parece estar bien." },
  'teamError.roleInvalid': { en: "That role is not valid.", es: "Ese rol no es válido." },
  'teamError.levelInvalid': { en: "That access level is not valid.", es: "Ese nivel de acceso no es válido." },
  'teamError.targetInvalid': {
    en: "Choose a project or a page to share.",
    es: "Elegí un proyecto o una página para compartir.",
  },
  'teamError.grantsInvalid': {
    en: "The access for this invitation is not valid.",
    es: "El acceso de esta invitación no es válido.",
  },
  'teamError.invitationExists': {
    en: "Someone else already invited this email. They can add to their invitation, or it can be revoked in Members.",
    es: "Otra persona ya invitó a este correo. Puede sumar a su invitación, o se la puede revocar en Miembros.",
  },
  'teamError.invitationUsed': {
    en: "That invitation was already used. To take access away, remove the person instead.",
    es: "Esa invitación ya se usó. Para sacarle el acceso, quitá a la persona.",
  },
  'teamError.invitationNotFound': {
    en: "That invitation is not there anymore, or you cannot revoke it.",
    es: "Esa invitación ya no está, o no podés revocarla.",
  },
  'teamError.sessionNotAllowed': {
    en: "This session cannot do that. Sign out and sign in again with the emailed code.",
    es: "Esta sesión no puede hacer eso. Cerrá la sesión y volvé a entrar con el código que te llega por correo.",
  },
  'teamError.pageCreateDenied': {
    en: "You cannot create pages here: it needs “Edit & create pages”.",
    es: "No podés crear páginas acá: hace falta “Editar y crear páginas”.",
  },
  'teamError.pageMoveDenied': {
    en: "You cannot move this page there: it needs “Edit & create pages” on the page and on where it goes.",
    es: "No podés mover esta página ahí: hace falta “Editar y crear páginas” en la página y en el destino.",
  },
  'teamError.pageTrashDenied': {
    en: "You cannot move this page to the trash or back: it needs “Edit & create pages”.",
    es: "No podés mandar esta página a la papelera ni sacarla: hace falta “Editar y crear páginas”.",
  },
  'teamError.pageEditDenied': {
    en: "You cannot edit this page: it needs “Edit”.",
    es: "No podés editar esta página: hace falta “Editar”.",
  },
  'teamError.pageNotFound': {
    en: "The page is not there anymore, or you cannot edit it (it needs “Edit”).",
    es: "La página ya no está, o no podés editarla (hace falta “Editar”).",
  },
  'teamError.projectNotFound': {
    en: "The project is not there anymore, or you cannot rename it (it needs “Edit & create pages”).",
    es: "El proyecto ya no está, o no podés renombrarlo (hace falta “Editar y crear páginas”).",
  },
  'teamError.offline': {
    en: "You are offline. Managing people needs an internet connection.",
    es: "Estás sin conexión. Para manejar el equipo hace falta internet.",
  },
  'teamError.schema': {
    en: "The workspace database needs an update before people can be managed from the app.",
    es: "La base de datos del workspace necesita una actualización para manejar el equipo desde la app.",
  },
  'teamError.rls': {
    en: "You do not have permission for this ({error}).",
    es: "No tenés permiso para esto ({error}).",
  },
} satisfies Dict;
