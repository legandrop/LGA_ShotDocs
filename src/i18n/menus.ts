import type { Dict } from './types';

// El menú de la página, el menú de la cuenta, el tamaño de hoja y mover una página.

export const menus = {
  'pageMenu.label': { en: "Page actions", es: "Acciones de la página" },
  'pageMenu.share': { en: "Share…", es: "Compartir…" },
  // Sacar una foto o filmar (camera.ts): también en el menú "/" del editor.
  'camera.takePhoto': { en: "Take photo", es: "Sacar una foto" },
  'camera.recordVideo': { en: "Record video", es: "Filmar un video" },
  'pageMenu.newInside': { en: "New page inside", es: "Página nueva adentro" },
  'pageMenu.move': { en: "Move to…", es: "Mover a…" },
  'pageMenu.pageSize': { en: "Page size", es: "Tamaño de hoja" },
  'pageMenu.print': { en: "Export PDF / Print", es: "Exportar PDF / Imprimir" },
  // Exportar una rama o un proyecto (P.22, Docs/Doc_Exportar.md): la ventana se baja aparte.
  'pageMenu.export': { en: "Export…", es: "Exportar…" },
  'pageMenu.exportTip': {
    en: "One PDF with this page and the pages inside, with a contents page.",
    es: "Un solo PDF con esta página y las de adentro, con un índice.",
  },
  'project.export': { en: "Export project…", es: "Exportar proyecto…" },
  'pageMenu.printAsSeen': { en: "Print as shown", es: "Imprimir como se ve" },
  'pageMenu.printAsSeenTip': {
    en: "Leaves out collapsed sections.\nThe pages won't match the page marks on screen.",
    es: "Sin las secciones colapsadas.\nLas hojas no coinciden con las marcas de la pantalla.",
  },
  'pageMenu.collapseAll': { en: "Collapse all", es: "Colapsar todo" },
  'pageMenu.history': { en: "Version history", es: "Historial de versiones" },
  'pageMenu.assistant': { en: "Assistant", es: "Asistente" },
  'pageMenu.dictate': { en: "Dictate to report", es: "Dictar al reporte" },
  // Las plantillas (Docs/Doc_Plantillas.md, 4.1): la ventana se baja con el editor.
  'pageMenu.applyTemplate': { en: "Apply template…", es: "Aplicar plantilla…" },
  'pageMenu.applyTemplateEmpty': { en: "Only on an empty page", es: "Solo en una página vacía" },
  // Las plantillas propias (entrega 3): guardar una página como plantilla y la franja de una plantilla.
  'pageMenu.saveAsTemplate': { en: "Save as template…", es: "Guardar como plantilla…" },
  'pageMenu.saveAsTemplateBlocked': {
    en: "Needs permission to create pages in Templates",
    es: "Hace falta permiso para crear páginas en Plantillas",
  },
  'pageMenu.useAsTemplate': { en: "Use as template", es: "Usar como plantilla" },
  'templateBanner.text': {
    en: "Template — new pages get a copy; pages already created don't change.",
    es: "Plantilla: las páginas nuevas reciben una copia; las ya creadas no cambian.",
  },
  'templateBanner.settings': { en: "Template settings…", es: "Ajustes de la plantilla…" },
  'templateBanner.stop': { en: "Stop using as template", es: "Dejar de usar como plantilla" },
  'templateBanner.dayReport': { en: "Day reports", es: "Reportes del día" },
  // El reporte del día (Docs/Doc_Plantillas.md, sección 6): el botón arriba del título y el menú de la página.
  'dayReport.new': { en: "New day report", es: "Nuevo reporte del día" },
  'pageMenu.useForDayReports': { en: "Use for day reports", es: "Usar para reportes del día" },
  'pageMenu.useForDayReportsTip': {
    en: "New day report, on this page and the ones inside,\ncreates the next report here",
    es: "Nuevo reporte del día, en esta página y en las de adentro,\ncrea el próximo reporte acá",
  },
  'pageMenu.stopDayReports': { en: "Stop using for day reports", es: "Dejar de usar para reportes del día" },
  'pageMenu.expandAll': { en: "Expand all", es: "Abrir todo" },
  'pageMenu.printTip': {
    en: "Opens the print dialog with this page size.\nChoose Save as PDF to export.",
    es: "Abre la impresión con este tamaño de hoja.\nElegí Guardar como PDF para exportar.",
  },
  'pageMenu.printFailed': {
    en: "Printing could not start. Try again.",
    es: "No se pudo empezar a imprimir. Probá de nuevo.",
  },
  'pageMenu.shortTitles': { en: "Short titles inside", es: "Títulos cortos adentro" },
  'pageMenu.shortTitlesTip': {
    en: "Pages inside show 064 | Name | Place\nas a short code and a name",
    es: "Las páginas de adentro muestran 064 | Nombre | Lugar\ncomo un código corto y un nombre",
  },
  'pageMenu.shortTitlesInherit': {
    en: "Short titles: use the setting from above",
    es: "Títulos cortos: usar lo de más arriba",
  },
  'pageMenu.trash': { en: "Move to trash", es: "Mandar a la papelera" },
  'page.viewOnly': {
    en: "You can view this page. Ask for edit access to change it.",
    es: "Podés ver esta página. Pedí permiso de edición para cambiarla.",
  },
  'account.label': { en: "Account", es: "Cuenta" },
  'account.synced': { en: "Synced to your account", es: "Guardado en tu cuenta" },
  'account.appearance': { en: "Appearance", es: "Apariencia" },
  'account.theme.system': { en: "System", es: "Sistema" },
  'account.theme.light': { en: "Light", es: "Claro" },
  'account.theme.dark': { en: "Dark", es: "Oscuro" },
  'account.font': { en: "Text", es: "Letra" },
  'account.font.default': { en: "Default", es: "Normal" },
  'account.font.editorial': { en: "Editorial", es: "Editorial" },
  'account.textSize': { en: "Text size", es: "Tamaño del texto" },
  'account.textSize.small': { en: "Small", es: "Chico" },
  'account.textSize.normal': { en: "Normal", es: "Normal" },
  'account.textSize.large': { en: "Large", es: "Grande" },
  'account.pageWidth': { en: "Page width", es: "Ancho de la página" },
  'account.pageWidth.normal': { en: "Normal", es: "Normal" },
  'account.pageWidth.wide': { en: "Wide", es: "Ancho" },
  'account.phoneImages': { en: "Images in a row", es: "Fotos en fila" },
  'account.phoneImages.rows': { en: "In a row", es: "En fila" },
  'account.phoneImages.stacked': { en: "Stacked", es: "Apiladas" },
  'account.language': { en: "Language", es: "Idioma" },
  'account.signOutUnsaved': {
    en: "Some of your latest edits are not saved on this device yet. Wait until the red warning goes away, then sign out.",
    es: "Algunos de tus últimos cambios todavía no se guardaron en este dispositivo. Esperá a que se vaya el aviso rojo y después cerrá la sesión.",
  },
  'account.assistant': { en: "Assistant…", es: "Asistente…" },
  'account.forgetAssistantKey': { en: "Also forget my assistant key on this device", es: "Olvidar también mi clave del asistente en este dispositivo" },
  'account.forgetAssistantKeyHint': {
    en: "On a shared computer, check it: otherwise whoever uses this browser next could use your key.",
    es: "En una computadora compartida, tildala: si no, quien use este navegador después podría usar tu clave.",
  },
  'account.forgetVoiceKeyToo': {
    en: "It also forgets your voice key.",
    es: "También olvida tu clave de voz.",
  },
  // Las notas de voz sin ubicar al salir (Docs/Doc_Dictado.md, 8).
  'account.voiceNotesLeft': {
    en: { one: "You have {count} voice note to place on this device.", other: "You have {count} voice notes to place on this device." },
    es: { one: "Tenés {count} nota de voz para ubicar en este dispositivo.", other: "Tenés {count} notas de voz para ubicar en este dispositivo." },
  },
  'account.discardVoiceNotes': { en: "Also delete them", es: "Borrarlas también" },
  'account.forgetAssistantKeySynced': {
    en: "Your synced copy stays in this workspace, protected by your passphrase.",
    es: "Tu copia sincronizada queda en este workspace, protegida por tu frase.",
  },
  // *Sign out other devices* (Docs/Doc_Clave_Sincronizada.md, entrega S1): para un dispositivo perdido.
  'account.signOutOthers': { en: "Sign out other devices", es: "Cerrar la sesión en los otros dispositivos" },
  'account.signOutOthersText': {
    en: "Sign out of {workspace} on all your other devices? They'll need a new code to get back in. A device that is already open can keep working for up to an hour.",
    es: "¿Cerrar la sesión de {workspace} en todos tus otros dispositivos? Van a necesitar un código nuevo para volver a entrar. Un dispositivo que ya está abierto puede seguir andando hasta una hora.",
  },
  'account.signOutOthersButton': { en: "Sign out others", es: "Cerrar los otros" },
  'account.signOutOthersDone': { en: "Your other devices were signed out.", es: "Se cerró la sesión en tus otros dispositivos." },
  'account.signOutOthersFailed': {
    en: "Couldn't sign out the other devices. Check the connection and try again.",
    es: "No se pudo cerrar la sesión en los otros dispositivos. Revisá la conexión y probá de nuevo.",
  },
  'account.signOutPending': {
    en: { one: "{count} change is not uploaded yet. It stays saved on this device and uploads the next time you sign in with this account. Sign out anyway?", other: "{count} changes are not uploaded yet. They stay saved on this device and upload the next time you sign in with this account. Sign out anyway?" },
    es: { one: "Hay {count} cambio sin subir. Queda guardado en este dispositivo y se sube la próxima vez que entres con esta cuenta. ¿Cerrar la sesión igual?", other: "Hay {count} cambios sin subir. Quedan guardados en este dispositivo y se suben la próxima vez que entres con esta cuenta. ¿Cerrar la sesión igual?" },
  },
  'pageFormat.free': { en: "Free", es: "Libre" },
  'pageFormat.letter': { en: "Letter", es: "Carta" },
  'pageFormat.size': { en: "Size", es: "Tamaño" },
  'pageFormat.orientation': { en: "Orientation", es: "Orientación" },
  'pageFormat.portrait': { en: "Portrait", es: "Vertical" },
  'pageFormat.landscape': { en: "Landscape", es: "Horizontal" },
  'pageFormat.saveFor': { en: "Save for", es: "Guardar para" },
  'pageFormat.thisBranch': { en: "This page and the pages inside", es: "Esta página y las de adentro" },
  'pageFormat.branch': { en: "“{title}” and the pages inside", es: "“{title}” y las páginas de adentro" },
  'pageFormat.setHere': {
    en: "Set on this page; pages inside can set their own.",
    es: "Elegido en esta página; las de adentro pueden elegir el suyo.",
  },
  'pageFormat.setOn': {
    en: "Set on “{title}”; pages inside can set their own.",
    es: "Elegido en “{title}”; las de adentro pueden elegir el suyo.",
  },
  'pageFormat.freeHint': {
    en: "Free: the page follows the width of the window.",
    es: "Libre: la página sigue el ancho de la ventana.",
  },
  'pageFormat.printHint': {
    en: "Export PDF / Print is in the page menu (free pages print on A4).",
    es: "Exportar PDF / Imprimir está en el menú de la página (las páginas libres salen en A4).",
  },
  'pageFormat.useFrom': { en: "Use the size from “{title}”", es: "Usar el tamaño de “{title}”" },
  'pageFormat.remove': { en: "Remove (back to Free)", es: "Quitar (vuelve a Libre)" },
  'move.label': { en: "Move page", es: "Mover página" },
  'move.title': { en: "Move “{title}”", es: "Mover “{title}”" },
  'move.search': { en: "Search pages…", es: "Buscar páginas…" },
  'move.top': { en: "Top level", es: "Primer nivel" },
  'move.noMatch': { en: "No pages with that name.", es: "No hay páginas con ese nombre." },
} satisfies Dict;
