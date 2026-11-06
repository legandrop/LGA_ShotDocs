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
  // *Share scenes* (Docs/Doc_Compartir_Escenas.md, B-1).
  // Decidir el pedido de una escena desde su link (Doc_Compartir_Escenas.md, B-2): la ventana de la campana.
  'requests.scene': { en: "Scene", es: "Escena" },
  'requests.scenePick': { en: "Pick a scene", es: "Elegí una escena" },
  'requests.sceneAsked': {
    en: "The link asked for “{scene}”, which isn't a scene of this project you can find. Pick the right one, or decline.",
    es: "El link pedía «{scene}», que no aparece como escena de este proyecto. Elegí la que corresponde, o rechazá el pedido.",
  },
  'requests.sceneLinkSaid': { en: "The link said “{project}”.", es: "El link decía «{project}»." },
  'requests.sceneByWord': {
    en: "The link said “{project}”, which only matches the first word of this project's name: it may mean another project. Pick the scene yourself, or decline.",
    es: "El link decía «{project}», que coincide solo con la primera palabra del nombre de este proyecto: puede ser otro proyecto. Elegí la escena vos, o rechazá el pedido.",
  },
  'requests.sceneConfirm': {
    en: "The link asked for “{asked}”, you're giving {given}. Give access?",
    es: "El link pedía «{asked}» y estás dando {given}. ¿Dar acceso?",
  },
  'requests.giveConfirm': { en: "Yes, give access", es: "Sí, dar acceso" },
  'requests.sceneInfo': {
    en: { one: "Scene · {count} page inside", other: "Scene · {count} pages inside" },
    es: { one: "Escena · {count} página adentro", other: "Escena · {count} páginas adentro" },
  },
  'requests.sceneScope': {
    en: "They'll see this scene and the pages inside it, never the locations, the shoot days or the other scenes. Same rules as Share scenes.",
    es: "Va a ver esta escena y las páginas de adentro, nunca las locaciones, los días de rodaje ni las otras escenas. Las mismas reglas que Compartir escenas.",
  },
  'requests.sceneNoScenes': {
    en: "This project has no scenes on this device yet. Decline, or try again when it has synced.",
    es: "Este proyecto todavía no tiene escenas en este dispositivo. Rechazá el pedido, o probá de nuevo cuando termine de sincronizar.",
  },
  'scenes.share.label': { en: "Share scenes", es: "Compartir escenas" },
  'scenes.share.title': { en: "Share scenes of “{name}”", es: "Compartir escenas de “{name}”" },
  'scenes.share.lead': {
    en: "Pick one person and the scenes they work on. They see those scenes and the pages inside them, in the sidebar and in the Overview: never the locations, the shoot days or the other scenes.",
    es: "Elegí una persona y las escenas en las que trabaja. Ve esas escenas y las páginas de adentro, en la barra lateral y en el Panorama: nunca las locaciones, los días de rodaje ni las otras escenas.",
  },
  'scenes.share.limits': {
    en: "What is written in a shared scene is seen too: the text of a link to another page, and the emails of whoever commented. If you take a scene away, what they already downloaded can stay on their device.",
    es: "Lo que está escrito en una escena compartida también se ve: el texto de un link a otra página y los correos de quienes comentaron. Si le sacás una escena, lo que ya bajó puede quedar en su dispositivo.",
  },
  'scenes.share.cleanOff': {
    en: "Sharing scenes needs the workspace setting that keeps deleted text out of shared pages, and it isn't on yet. Until then, nothing can be saved here.",
    es: "Compartir escenas pide el ajuste del workspace que deja afuera de lo compartido lo que se borró, y todavía no está prendido. Hasta entonces, acá no se puede guardar nada.",
  },
  'scenes.share.emailPlaceholder': { en: "name@vendor.com or pick someone", es: "nombre@vendor.com o elegí a alguien" },
  'scenes.share.suggestPages': {
    en: { one: "{count} page in this project", other: "{count} pages in this project" },
    es: { one: "{count} página en este proyecto", other: "{count} páginas en este proyecto" },
  },
  'scenes.share.suggestInvited': { en: "Invited, not joined yet", es: "Invitado, todavía no entró" },
  'scenes.share.member': { en: "In the workspace · {role}", es: "En el workspace · {role}" },
  'scenes.share.newPerson': {
    en: "New to the workspace: invited as a guest with these scenes. The app copies the invitation link for you to send.",
    es: "Es nuevo en el workspace: se lo invita como invitado con estas escenas. La app copia el link de la invitación para que lo mandes.",
  },
  'scenes.share.pending': {
    en: "Has a pending invitation: you can add scenes. To take one away, revoke the invitation in Members and invite again.",
    es: "Tiene una invitación pendiente: podés sumar escenas. Para sacarle una, revocá la invitación en Miembros y volvé a invitar.",
  },
  'scenes.share.wholeProject': {
    en: "Already sees the whole project ({level}): sharing scenes doesn't change that. Change it in Share “{name}”.",
    es: "Ya ve todo el proyecto ({level}): compartir escenas no lo cambia. Se cambia en Compartir “{name}”.",
  },
  'scenes.share.alsoHas': { en: "Also shared with them here: {list}", es: "Además tiene acá: {list}" },
  'scenes.share.filter': { en: "Filter scenes", es: "Filtrar escenas" },
  'scenes.share.all': { en: "All", es: "Todas" },
  'scenes.share.none': { en: "None", es: "Ninguna" },
  'scenes.share.list': { en: "Scenes", es: "Escenas" },
  'scenes.share.noScenes': {
    en: "This project has no scenes yet: pages in a scenes folder, or marked as a scene with Type.",
    es: "Este proyecto todavía no tiene escenas: páginas en una carpeta de escenas, o marcadas como escena con Tipo.",
  },
  'scenes.share.noMatch': { en: "No scene matches.", es: "Ninguna escena coincide." },
  'scenes.share.inside': {
    en: { one: "{count} page inside", other: "{count} pages inside" },
    es: { one: "{count} página adentro", other: "{count} páginas adentro" },
  },
  'scenes.share.blocked': {
    en: "Can't be shared: it has another scene, a location, a day or a set inside (or a page named like a scene). Move that page out first.",
    es: "No se puede compartir: tiene adentro otra escena, una locación, un día o un decorado (o una página con nombre de escena). Primero sacá esa página de ahí.",
  },
  'scenes.share.containsEntities': {
    en: "One of the scenes has another scene, a location, a day or a set inside, so it can't be shared. Nothing was saved.",
    es: "Una de las escenas tiene adentro otra escena, una locación, un día o un decorado, así que no se puede compartir. No se guardó nada.",
  },
  'scenes.share.trashLead': {
    en: "Also shared, in the trash: untick to take it away.",
    es: "También compartidas, en la papelera: desmarcalas para sacarlas.",
  },
  'scenes.share.memberInvitation': {
    en: "This person is in the workspace but their email also has a pending invitation: accepting it would give back what you take away here. Revoke it in Members first.",
    es: "Esta persona está en el workspace pero su correo tiene además una invitación pendiente: al aceptarla le volvería lo que le sacás acá. Revocala primero en Miembros.",
  },
  'scenes.share.trashList': { en: "Shared pages in the trash", es: "Páginas compartidas en la papelera" },
  'scenes.share.inTrash': { en: "In trash · {level}", es: "En la papelera · {level}" },
  'scenes.share.others': {
    en: "Also seen from outside the team by {list}: they see each other's comments and emails",
    es: "También la ven de afuera del equipo {list}: se ven los comentarios y los correos",
  },
  'scenes.share.higher': { en: "{level}: change it in Share", es: "{level}: se cambia en Compartir" },
  'scenes.share.count': { en: "{checked} of {total} scenes", es: "{checked} de {total} escenas" },
  'scenes.share.changes': { en: "+{add} −{remove}", es: "+{add} −{remove}" },
  'scenes.share.tooMany': { en: "Up to 200 scenes at a time.", es: "Hasta 200 escenas por vez." },
  'scenes.share.save': { en: "Save", es: "Guardar" },
  'scenes.share.saving': { en: "Saving…", es: "Guardando…" },
  'scenes.share.marksPending': {
    en: "The scene marks couldn't be uploaded yet. Check the connection and try again.",
    es: "Las marcas de escena todavía no se pudieron subir. Revisá la conexión y probá de nuevo.",
  },
  'scenes.share.pageInvalid': {
    en: "One of the scenes can't be shared anymore (it moved, went to the trash, or isn't a scene). Close this and try again.",
    es: "Una de las escenas ya no se puede compartir (se movió, fue a la papelera o ya no es una escena). Cerrá esto y probá de nuevo.",
  },
  'scenes.share.doneMember': {
    en: { one: "Saved: {email} has {count} page of this project shared.", other: "Saved: {email} has {count} pages of this project shared." },
    es: { one: "Guardado: {email} tiene {count} página de este proyecto compartida.", other: "Guardado: {email} tiene {count} páginas de este proyecto compartidas." },
  },
  'scenes.share.doneInvited': {
    en: { one: "Invited {email} with {count} page of this project. Send them the link.", other: "Invited {email} with {count} pages of this project. Send them the link." },
    es: { one: "Invitaste a {email} con {count} página de este proyecto. Mandale el link.", other: "Invitaste a {email} con {count} páginas de este proyecto. Mandale el link." },
  },
  'scenes.share.another': { en: "Same scenes for another email…", es: "Las mismas escenas para otro correo…" },
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
  // Lo que sube el link al Drive (entrega 2b, Docs/Doc_Link_Publico.md, E2.8).
  'share.link.files': {
    en: "Files added through the link: {today} today · {total} in all ({size} in your Drive)",
    es: "Archivos sumados con el link: {today} hoy · {total} en total ({size} en tu Drive)",
  },
  'share.link.filesBig': {
    en: "This link has uploaded {size} to your Drive. Reset link if it went too far.",
    es: "Este link ya subió {size} a tu Drive. Si se escapó, Renovar link.",
  },
  'share.link.filesTitle': {
    en: { one: "{count} file was added through this page's link", other: "{count} files were added through this page's link" },
    es: { one: "Se sumó {count} archivo con el link de esta página", other: "Se sumaron {count} archivos con el link de esta página" },
  },
  // Con la lista cortada en el tope de la base no se sabe el total: se dice «o más».
  'share.link.filesTitleCapped': {
    en: "{count} or more files were added through this page's link",
    es: "Se sumaron {count} archivos o más con el link de esta página",
  },
  'share.link.filesCappedMore': {
    en: "and {count} more, plus older ones that aren't listed. They all stay in your Drive.",
    es: "y {count} más, y otros anteriores que no se listan. Todos quedan en tu Drive.",
  },
  'share.link.filesHint': {
    en: "Also the ones in changes that were set aside. They stay in your Drive.",
    es: "También los de cambios que quedaron aparte. Quedan en tu Drive.",
  },
  'share.link.fileDownload': { en: "Download", es: "Bajar" },
  'share.link.fileNotUploaded': { en: "didn't finish uploading", es: "no terminó de subir" },
  'share.link.fileTrashed': { en: "in the trash", es: "en la papelera" },
  // Lo apartado a la vista (entrega 2c, Docs/Doc_Link_Publico.md).
  'share.link.asideTitle': {
    en: { one: "{count} change sent through this page's link was set aside", other: "{count} changes sent through this page's link were set aside" },
    es: { one: "{count} cambio mandado con el link de esta página quedó aparte", other: "{count} cambios mandados con el link de esta página quedaron aparte" },
  },
  'share.link.asideHint': {
    en: "They didn't reach the pages and nothing was lost: download them to read them.",
    es: "No llegaron a las páginas y no se perdió nada: bajalos para leerlos.",
  },
  'share.link.asideRow': { en: "{name} (via link) · {when}", es: "{name} (vía link) · {when}" },
  'share.link.asideOldLink': { en: "earlier link", es: "link anterior" },
  'share.link.asideDownloadAll': { en: "Download all", es: "Bajar todo" },
  'share.link.asideMore': {
    en: { one: "and {count} more", other: "and {count} more" },
    es: { one: "y {count} más", other: "y {count} más" },
  },
  'share.link.restrictedHint': {
    en: "Only people with access can open it. With a link, anyone who has it opens this page and the ones inside, without an account.",
    es: "Solo la abre quien tiene acceso. Con un link, cualquiera que lo tenga abre esta página y las de adentro, sin cuenta.",
  },
  'share.link.pdfHint': {
    en: "PDFs exported with this link use it in their file links: changing its level also changes what they open, and Reset link turns them off.",
    es: "Los PDF exportados con este link lo usan en sus links a archivos: cambiar su nivel cambia también lo que abren, y Reset link los apaga.",
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
  'share.link.setDate': { en: "Set date", es: "Poner fecha" },
  'share.link.badDate': { en: "Pick a date in the future.", es: "Elegí una fecha futura." },
  'share.link.expiresOn': { en: "on {date}", es: "el {date}" },
  'share.link.usage': {
    en: "Today: {opens} · {comments} · {mb} MB downloaded",
    es: "Hoy: {opens} · {comments} · {mb} MB bajados",
  },
  'share.link.usageOpens': {
    en: { one: "opened {count} time", other: "opened {count} times" },
    es: { one: "abierto {count} vez", other: "abierto {count} veces" },
  },
  'share.link.usageComments': {
    en: { one: "{count} comment", other: "{count} comments" },
    es: { one: "{count} comentario", other: "{count} comentarios" },
  },
  'share.link.limited': {
    en: "Daily limit reached: new visits are paused until tomorrow. Reset link if it went too far.",
    es: "Llegó al tope del día: las visitas nuevas siguen mañana. Si se escapó, Renovar link.",
  },
  'share.link.above': { en: "Anyone with the link to “{title}” can view this page.", es: "Cualquiera con el link de “{title}” puede ver esta página." },
  'share.link.aboveEdit': { en: "Anyone with the link to “{title}” can edit this page.", es: "Cualquiera con el link de “{title}” puede editar esta página." },
  // Qué link es (3.7: *created by…*): lo ve quien comparte la página.
  'share.link.createdBy': { en: "Created by {name} on {date}.", es: "Lo creó {name} el {date}." },
  'share.link.created': { en: "Created on {date}.", es: "Creado el {date}." },
  'share.link.error.gone': {
    en: "This link was turned off or reset somewhere else. Here's how it is now.",
    es: "Este link se apagó o se renovó en otro lado. Así está ahora.",
  },
  'share.link.error.invalid': { en: "The link couldn't be saved. Try again.", es: "No se pudo guardar el link. Probá de nuevo." },
  'share.link.error.trash': {
    en: "This page is in the trash, so its link doesn't work. Restoring the page turns the link back on: restore it to change the link or turn it off.",
    es: "Esta página está en la papelera, así que su link no anda. Al restaurarla el link vuelve a andar: restaurala para cambiarlo o apagarlo.",
  },
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
