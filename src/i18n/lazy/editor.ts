import { register } from '../index';
import type { Dict } from '../types';

// Lo que suma la app al editor: Script y Question, comentar un bloque, pegar links de Drive, la tarjeta de Drive y los botones de fotos (se carga aparte, con el editor).

export const editor = {
  'find.label': { en: "Find in page", es: "Buscar en la página" },
  'find.placeholder': { en: "Find", es: "Buscar" },
  'find.replacePlaceholder': { en: "Replace", es: "Reemplazar" },
  'find.showReplace': { en: "Show replace", es: "Mostrar reemplazar" },
  'find.hideReplace': { en: "Hide replace", es: "Ocultar reemplazar" },
  'find.matchCase': { en: "Match case and accents", es: "Mayúsculas y tildes exactas" },
  'find.wholeWord': { en: "Whole word", es: "Palabra entera" },
  'find.previous': { en: "Previous (Shift+Enter)", es: "Anterior (Shift+Enter)" },
  'find.next': { en: "Next (Enter)", es: "Siguiente (Enter)" },
  'find.close': { en: "Close (Esc)", es: "Cerrar (Esc)" },
  'find.count': { en: "{current} of {total}", es: "{current} de {total}" },
  'find.countMore': { en: "{current} of {total}+", es: "{current} de más de {total}" },
  'find.none': { en: "No results", es: "Sin resultados" },
  'find.inCaption': { en: "in a caption", es: "en un pie" },
  'find.inName': { en: "in a file name", es: "en el nombre de un archivo" },
  'find.hidden': {
    en: { one: "{count} in collapsed sections", other: "{count} in collapsed sections" },
    es: { one: "{count} en secciones colapsadas", other: "{count} en secciones colapsadas" },
  },
  'find.replace': { en: "Replace", es: "Reemplazar" },
  'find.replaceAll': { en: "Replace all", es: "Reemplazar todo" },
  'find.replaceTip': { en: "Replace this one and go to the next (Enter)", es: "Reemplazar esta y pasar a la siguiente (Enter)" },
  'find.replaced': {
    en: { one: "{count} replaced", other: "{count} replaced" },
    es: { one: "{count} reemplazo", other: "{count} reemplazos" },
  },
  'find.undo': { en: "Undo", es: "Deshacer" },
  'find.skippedFields': {
    en: { one: "{count} in captions or file names was left as is", other: "{count} in captions or file names were left as is" },
    es: { one: "{count} en pies o nombres de archivo no se tocó", other: "{count} en pies o nombres de archivo no se tocaron" },
  },
  'find.skippedLinks': {
    en: { one: "{count} was skipped: it would remove a whole link", other: "{count} were skipped: they would remove a whole link" },
    es: { one: "{count} se salteó: borraría un link entero", other: "{count} se saltearon: borrarían un link entero" },
  },
  'find.fieldNotReplaced': {
    en: "Captions and file names are not replaced (yet).",
    es: "Los pies y los nombres de archivo no se reemplazan (todavía).",
  },
  'find.changed': {
    en: "That match changed in the meantime; searched again.",
    es: "Esa coincidencia cambió mientras tanto; se volvió a buscar.",
  },
  'comments.margin': { en: "Comments in the margin", es: "Comentarios en el margen" },
  'comments.openOnBlock': {
    en: { one: "{count} open comment on this block", other: "{count} open comments on this block" },
    es: { one: "{count} comentario abierto en este bloque", other: "{count} comentarios abiertos en este bloque" },
  },
  'comments.answers': {
    en: { one: "{count} answer", other: "{count} answers" },
    es: { one: "{count} respuesta", other: "{count} respuestas" },
  },
  'comments.resolvedMark': { en: "resolved", es: "resuelta" },
  'comments.onBlock': { en: "Comment on this block", es: "Comentar este bloque" },
  'drivePaste.caption': { en: "Paste as", es: "Pegar como" },
  'drivePaste.link': { en: "Link", es: "Link" },
  'drivePaste.text': { en: "Text", es: "Texto" },
  'drivePaste.card': { en: "Card", es: "Tarjeta" },
  'drivePaste.cardTip': {
    en: "Shows the **Google Drive player** on the page.\nPlays for people signed in to Google with access to the file.\nIn Safari and on iPhone, only files shared by link may play.",
    es: "Muestra el **reproductor de Google Drive** en la página.\nSe reproduce para quien entró a Google y tiene acceso al archivo.\nEn Safari y en el iPhone, puede que solo anden los compartidos por link.",
  },
  'mediaButton.offline': {
    en: "You're offline, and the original isn't on this device.",
    es: "Estás sin conexión, y el original no está en este dispositivo.",
  },
  'mediaButton.failed': { en: "The original could not be downloaded.", es: "No se pudo descargar el original." },
  'mediaButton.view': { en: "View full screen", es: "Ver en pantalla completa" },
  'mediaButton.space': { en: "Space", es: "Espacio" },
  'mediaButton.download': { en: "Download image", es: "Descargar imagen" },
  'imageSize.full': { en: "Full width", es: "Todo el ancho" },
  'imageSize.half': { en: "Half the page width", es: "La mitad del ancho de la página" },
  'imageSize.third': { en: "A third of the page width", es: "Un tercio del ancho de la página" },
  'imageSize.quarter': { en: "A quarter of the page width", es: "Un cuarto del ancho de la página" },
  'imageSize.arrange': { en: "Arrange in rows", es: "Acomodar en filas" },
  'imageSize.arrangeHint': {
    en: "The images and videos next to this one, in order, with the same height in each row",
    es: "Las fotos y videos seguidos a esta, en orden, con la misma altura en cada fila",
  },
  'imageSize.waiting': { en: "Waiting for the images to load", es: "Esperando que carguen las fotos" },
  'photoSize.arrangeSelected': {
    en: "The selected images, in order, with the same height in each row",
    es: "Las fotos elegidas, en orden, con la misma altura en cada fila",
  },
  'photoSize.notAdjacent': {
    en: "Select images that are next to each other, with no text between them",
    es: "Elegí fotos que estén seguidas, sin texto en el medio",
  },
  'photoTip.view': {
    en: "Opens it full screen, with every photo and video on the page",
    es: "La abre en pantalla completa, con todas las fotos y videos de la página",
  },
  'photoTip.download': { en: "Saves the original file, at full size", es: "Guarda el archivo original, en su tamaño completo" },
  'photoTip.size': {
    en: "Sets its width as a fraction of the page; images side by side share a row",
    es: "Fija su ancho como una parte de la página; las fotos seguidas comparten una fila",
  },
  'photoTip.sizeAll': {
    en: "Gives every selected image this width; images side by side share a row",
    es: "Les da este ancho a todas las fotos elegidas; las fotos seguidas comparten una fila",
  },
  'cellSize.thumb': { en: "Thumbnail", es: "Miniatura" },
  'cellSize.full': { en: "Full cell width", es: "Todo el ancho de la celda" },
  'photoTip.thumb': {
    en: "As tall as a table row; images side by side line up",
    es: "Del alto de una fila de la tabla; las fotos seguidas quedan alineadas",
  },
  'photoTip.thumbAll': {
    en: "Turns every selected image into a thumbnail as tall as a table row",
    es: "Pasa todas las fotos elegidas a miniaturas del alto de una fila",
  },
  'photoTip.sizeCell': {
    en: "Fills the cell's width; to make it bigger, widen the column",
    es: "Ocupa todo el ancho de la celda; para agrandarla, ensanchá la columna",
  },
  'photoTip.sizeCellAll': {
    en: "Every selected image fills its cell's width",
    es: "Todas las fotos elegidas ocupan el ancho de su celda",
  },
  'photoTip.alignSide': { en: "Moves it to that side of the page", es: "Lo lleva a ese lado de la página" },
  'photoTip.alignCenter': { en: "Centers it on the page", es: "Lo centra en la página" },
  'photoTip.alignLine': {
    en: "Aligns its whole line (the text and the photos in it)",
    es: "Alinea todo su renglón (el texto y las fotos que tiene)",
  },
  'photoTip.comment': { en: "Starts a comment thread on this block", es: "Abre un hilo de comentarios sobre este bloque" },
  'photoTip.replace': {
    en: "Picks another file to take its place, keeping its size",
    es: "Elige otro archivo para ponerlo en su lugar, con el mismo tamaño",
  },
  'photoTip.rename': {
    en: "The name it's shown and downloaded with",
    es: "El nombre con el que se muestra y se descarga",
  },
  'photoTip.delete': { en: "Takes it out of the page; undo brings it back", es: "Lo saca de la página; deshacer lo devuelve" },
  'photoTip.deleteMany': { en: "Takes them out of the page; undo brings them back", es: "Las saca de la página; deshacer las devuelve" },
  'photoBar.alignLeft': { en: "Align left", es: "Alinear a la izquierda" },
  'photoBar.alignCenter': { en: "Align center", es: "Alinear al centro" },
  'photoBar.alignRight': { en: "Align right", es: "Alinear a la derecha" },
  'photoBar.replace': { en: "Replace image", es: "Reemplazar la foto" },
  'photoBar.rename': { en: "Rename image", es: "Renombrar la foto" },
  'photoBar.renamePlaceholder': { en: "Image name", es: "Nombre de la foto" },
  'photoBar.delete': { en: "Delete image", es: "Borrar la foto" },
  'photoCreate.notPlaced': {
    en: {
      one: "The page closed before a photo finished saving, so it wasn't added. Add it again.",
      other: "The page closed before {count} photos finished saving, so they weren't added. Add them again.",
    },
    es: {
      one: "La página se cerró antes de que terminara de guardarse una foto: no se agregó. Agregala de nuevo.",
      other: "La página se cerró antes de que terminaran de guardarse {count} fotos: no se agregaron. Agregalas de nuevo.",
    },
  },
  'photoBar.downloadVideo': { en: "Download video", es: "Descargar el video" },
  'photoBar.replaceVideo': { en: "Replace video", es: "Reemplazar el video" },
  'photoBar.renameVideo': { en: "Rename video", es: "Renombrar el video" },
  'photoBar.deleteVideo': { en: "Delete video", es: "Borrar el video" },
  'photoBar.downloadFile': { en: "Download file", es: "Descargar el archivo" },
  'photoBar.replaceFile': { en: "Replace file", es: "Reemplazar el archivo" },
  'photoBar.deleteFile': { en: "Delete file", es: "Borrar el archivo" },
  'photoBar.deleteMany': { en: "Delete images", es: "Borrar las fotos" },
  'photoBar.deleteKeys': { en: "Delete or Backspace", es: "Supr o Retroceso" },
  'photoBar.resize': { en: "Drag to resize: it snaps to 1/1, 1/2, 1/3 and 1/4", es: "Arrastrá para cambiar el tamaño: se imanta a 1/1, 1/2, 1/3 y 1/4" },
  'driveCard.tap': { en: "Tap to use the player", es: "Tocá para usar el reproductor" },
  'driveCard.open': { en: "Open in Drive", es: "Abrir en Drive" },
  'driveCard.showAsLink': { en: "Show as link", es: "Mostrar como link" },
  'driveCard.cookies': {
    en: "In Safari and on iPhone, only files shared by link may play here.",
    es: "En Safari y en el iPhone, puede que acá solo se reproduzcan los archivos compartidos por link.",
  },
  'driveCard.notLoaded': { en: "The Drive player didn't load.", es: "El reproductor de Drive no cargó." },
  'driveCard.offline': {
    en: "You're offline. The Drive player loads when you're back online.",
    es: "Estás sin conexión. El reproductor de Drive carga cuando vuelva la conexión.",
  },
  'driveCard.player': { en: "Google Drive player", es: "Reproductor de Google Drive" },
  'editor.script': { en: "Script", es: "Guion" },
  'editor.scriptHint': {
    en: "Screenplay text: INT/EXT, DAY, NIGHT marked",
    es: "Texto de guion: INT/EXT, DÍA y NOCHE marcados",
  },
  'editor.imageHint': {
    en: "Photos and videos go in the line, at the cursor",
    es: "Las fotos y los videos van en el renglón, donde está el cursor",
  },
  // Sacar una foto o filmar y guardar en el carrete (camera.ts).
  'camera.takePhotoHint': {
    en: "Opens the camera; the photo goes in the line, at the cursor",
    es: "Abre la cámara; la foto va en el renglón, donde está el cursor",
  },
  'camera.recordVideoHint': {
    en: "Opens the camera; the video goes in the line, at the cursor",
    es: "Abre la cámara; el video va en el renglón, donde está el cursor",
  },
  'camera.save': { en: "Save to camera roll", es: "Guardar en Fotos" },
  'camera.saveVideo': { en: "Save video to camera roll", es: "Guardar el video en Fotos" },
  'camera.saveTip': {
    en: "Opens the share sheet: choose **Save Image** or **Save Video**",
    es: "Abre la hoja de compartir: elegí **Guardar imagen** o **Guardar video**",
  },
  'camera.saveAgain': {
    en: "The original is ready. Tap Save to camera roll again.",
    es: "El original está listo. Tocá Guardar en Fotos otra vez.",
  },
  'camera.saveUnsupported': {
    en: "This browser can't save this file to the camera roll. Use Download.",
    es: "Este navegador no puede guardar este archivo en Fotos. Usá Descargar.",
  },
  'editor.pageBreak': { en: "Page break", es: "Salto de hoja" },
  'editor.pageBreakHint': { en: "What follows starts on a new sheet", es: "Lo que sigue empieza en una hoja nueva" },
  'editor.question': { en: "Question", es: "Pregunta" },
  'editor.questionHint': {
    en: "A question for the team or the client, answered in comments",
    es: "Una pregunta para el equipo o el cliente, que se contesta en los comentarios",
  },
  'editor.image': { en: "Image", es: "Imagen" },
  'editor.missingOnline': {
    en: "Part of this page is still downloading. It opens for editing as soon as it arrives.",
    es: "Una parte de esta página todavía se está bajando. Se abre para editar apenas llega.",
  },
  'editor.missingOutdated': {
    en: "This page has newer changes that this version of the app doesn't download. Update the app to see them and edit the page.",
    es: "Esta página tiene cambios más nuevos que esta versión de la app no baja. Actualizá la app para verlos y editarla.",
  },
  'editor.preparing': {
    en: "The editors haven't prepared this page for you yet. It will appear when one of them opens the app.",
    es: "Quienes editan todavía no prepararon esta página para vos. Aparece cuando alguno abra la app.",
  },
  'editor.missingOffline': {
    en: "Part of this page has not been downloaded to this device yet. You can read what is here; connect to the internet to edit it.",
    es: "Una parte de esta página todavía no se bajó a este dispositivo. Podés leer lo que hay; conectate a internet para editarla.",
  },
  'editor.commentOnly': {
    en: "You can comment on this page and answer its questions. Ask for edit access to change it.",
    es: "Podés comentar esta página y contestar sus preguntas. Pedí permiso de edición para cambiarla.",
  },
  'editor.unsupportedTitle': {
    en: "This page was edited with a newer version of the app.",
    es: "Esta página se editó con una versión más nueva de la app.",
  },
  'editor.unsupported': {
    en: "This version can't show all of it without losing part, so it stays closed. Nothing is lost.",
    es: "Esta versión no puede mostrarla entera sin perder una parte, así que queda cerrada. No se pierde nada.",
  },
  'editor.updateApp': { en: "Update the app", es: "Actualizar la app" },
  'removedWriting.text': {
    en: "Someone deleted a part of this page while you were writing or moving text in it, and what you wrote or moved there went with it. You can copy it from here.",
    es: "Alguien borró una parte de esta página mientras escribías o movías texto en ella, y lo que escribiste o moviste ahí se fue con esa parte. Podés copiarlo desde acá.",
  },
  'removedWriting.show': { en: "Show what you wrote or moved", es: "Ver lo que escribiste o moviste" },
  'removedWriting.hide': { en: "Hide", es: "Ocultar" },
  'removedWriting.copy': { en: "Copy", es: "Copiar" },
  'removedWriting.dismiss': { en: "Dismiss", es: "Descartar aviso" },
  'removedWriting.copyFailed': {
    en: "Could not copy. Select the text and copy it by hand.",
    es: "No se pudo copiar. Seleccioná el texto y copialo a mano.",
  },
  'editor.onlyImages': {
    en: "Only images can be added for now (JPEG, PNG, GIF, WebP, AVIF or HEIC). Videos need the workspace media server (Google Drive).",
    es: "Por ahora solo se pueden agregar imágenes (JPEG, PNG, GIF, WebP, AVIF o HEIC). Los videos necesitan el servidor de archivos del workspace (Google Drive).",
  },
  'attachment.title': { en: "Attached file", es: "Archivo adjunto" },
  'attachment.open': { en: "Open", es: "Abrir" },
  'attachment.download': { en: "Download", es: "Descargar" },
  'attachment.share': { en: "Share…", es: "Compartir…" },
  'attachment.preparing': { en: "Preparing…", es: "Preparando…" },
  'attachment.unavailable': {
    en: "It can't be opened right now: it may not have finished uploading, or there is no connection.",
    es: "Ahora no se puede abrir: puede que no haya terminado de subir, o no hay conexión.",
  },
  'attachment.shareFailed': { en: "It couldn't be shared.", es: "No se pudo compartir." },
  'attachment.openTip': { en: "Open in a new tab", es: "Abrir en una pestaña nueva" },
  'editor.attachNeedsDrive': {
    en: "Only images can be added. To attach other files, the owner has to connect Google Drive.",
    es: "Solo se pueden agregar imágenes. Para adjuntar otros archivos, el dueño tiene que conectar Google Drive.",
  },
  'editor.embeddedOnlyMedia': {
    en: "Only photos and videos pasted inside text are kept; attach other files by dropping them.",
    es: "De lo pegado dentro de un texto solo se guardan fotos y videos; los otros archivos, arrastrándolos.",
  },
  'editor.foldersNotSupported': {
    en: "Folders can't be added: compress them first (.zip).",
    es: "No se pueden agregar carpetas: primero comprimilas (.zip).",
  },
  'editor.fileNotSaved': {
    en: "This file could not be saved on this device.",
    es: "No se pudo guardar este archivo en este dispositivo.",
  },
  'editor.pastedEmbedded': {
    en: "A pasted image stays embedded in the page: {reason}",
    es: "Una imagen pegada queda guardada dentro de la página: {reason}",
  },
  'editor.pastedNotSaved': {
    en: "A pasted image could not be saved as a file; it stays embedded in the page.",
    es: "Una imagen pegada no se pudo guardar como archivo; queda guardada dentro de la página.",
  },
  // Colapsar secciones por sus títulos (Docs/Doc_Colapsar.md).
  'collapse.deletedHidden': {
    en: "What was collapsed was deleted too. Undo with {shortcut}.",
    es: "Se borró también lo que estaba colapsado. Se deshace con {shortcut}.",
  },
  'collapse.collapse': { en: "Collapse", es: "Colapsar" },
  'collapse.expand': { en: "Expand", es: "Abrir" },
  'collapse.onlyYou': { en: "Just for you: others still see it as it was.", es: "Solo para vos: los demás lo siguen viendo como estaba." },
  'collapse.collapsedForYou': { en: "Collapsed just for you.", es: "Colapsado solo para vos." },
  'collapse.label': { en: "{action} section “{title}”", es: "{action} la sección «{title}»" },
  // Para todos (entrega 2): el tooltip del triángulo dice si lo que se ve es de todos o solo tuyo.
  'collapse.collapseJustYou': { en: "Collapse just for you", es: "Colapsar solo para vos" },
  'collapse.collapsedJustYou': { en: "Collapsed just for you", es: "Colapsado solo para vos" },
  'collapse.collapsedForAll': { en: "Collapsed for everyone", es: "Colapsado para todos" },
  'collapse.openJustYou': { en: "Expanded just for you", es: "Abierto solo para vos" },
  'collapse.shiftForAll': { en: "Shift+click: for everyone", es: "Shift+clic: para todos" },
  'collapse.clickOpenShiftCollapseAll': {
    en: "Click: expand · Shift+click: collapse for everyone",
    es: "Clic: abrir · Shift+clic: colapsar para todos",
  },
  'collapse.clickOpenYouShiftOpenAll': {
    en: "Click: expand just for you · Shift+click: expand for everyone",
    es: "Clic: abrir solo para vos · Shift+clic: abrir para todos",
  },
  'collapse.clickCollapseShiftOpenAll': {
    en: "Click: collapse · Shift+click: expand for everyone",
    es: "Clic: colapsar · Shift+clic: abrir para todos",
  },
  'collapse.keptOpen': {
    en: "Someone collapsed this section for everyone. It stays expanded for you while you work in it.",
    es: "Alguien colapsó esta sección para todos. Queda abierta para vos mientras trabajás en ella.",
  },
  // Los tres puntos de cada bloque (BlockSideMenu.tsx).
  'block.handleLabel': { en: "Select block (drag to move)", es: "Elegir el bloque (arrastrar para moverlo)" },
  'block.handleClick': { en: "Click: select the block", es: "Clic: elegir el bloque" },
  'block.handleDrag': { en: "Drag: move it", es: "Arrastrar: moverlo" },
  // Los colores del bloque entero en la barra, con el bloque elegido con los puntos (PageToolbar.tsx).
  'block.colors': { en: "Block colors", es: "Colores del bloque" },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(editor);
