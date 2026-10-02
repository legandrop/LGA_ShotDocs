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
  'team.email': { en: "Email", es: "Correo" },
  'team.emailPlaceholder': { en: "name@example.com", es: "nombre@ejemplo.com" },
  'team.inviteLink': { en: "Invitation link", es: "Link de invitación" },
  'members.title': { en: "Members", es: "Miembros" },
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
  'teamError.pageInTrash': {
    en: "The page is in the trash: restore it before sharing it.",
    es: "La página está en la papelera: restaurala antes de compartirla.",
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
