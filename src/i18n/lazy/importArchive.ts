import { register } from '../index';
import type { Dict } from '../types';

// Volver a Shot Docs desde un zip exportado (se carga aparte, con ImportArchiveDialog.tsx y src/import/shotdocsImport.ts).
// La entrada del menú (`importArchive.menu`) está en la primera carga, en sidebar.ts.

export const importArchive = {
  'importArchive.title': { en: "Import Shot Docs archive", es: "Importar archivo de Shot Docs" },
  'importArchive.text': {
    en: "Choose a zip exported from Shot Docs (Export › Zip — to archive). It becomes a new project in this workspace: nothing that exists changes. Photos and files upload to this workspace's Drive in the background.",
    es: "Elegí un zip exportado de Shot Docs (Exportar › Zip — para archivar). Entra como un proyecto nuevo en este workspace: nada de lo que existe cambia. Las fotos y los archivos se suben al Drive de este workspace en segundo plano.",
  },
  'importArchive.chooseZip': { en: "Choose zip", es: "Elegir zip" },
  'importArchive.chooseFolder': { en: "Choose unzipped folder", es: "Elegir carpeta descomprimida" },
  'importArchive.reading': { en: "Reading the archive…", es: "Leyendo el archivo…" },
  'importArchive.found': {
    en: "“{title}”: {pages} and {files} ({size}).",
    es: "“{title}”: {pages} y {files} ({size}).",
  },
  'importArchive.foundComments': {
    en: { one: "It also has {count} comment.", other: "It also has {count} comments." },
    es: { one: "Trae además {count} comentario.", other: "Trae además {count} comentarios." },
  },
  'importArchive.foundPreviews': {
    en: { one: "{count} photo only has its preview in the archive: it comes back at lower resolution.", other: "{count} photos only have their preview in the archive: they come back at lower resolution." },
    es: { one: "{count} foto tiene solo su vista en el archivo: vuelve con menos resolución.", other: "{count} fotos tienen solo su vista en el archivo: vuelven con menos resolución." },
  },
  'importArchive.foundMissing': {
    en: { one: "{count} file is not in the archive: the page keeps its name in its place.", other: "{count} files are not in the archive: the pages keep their names in their place." },
    es: { one: "{count} archivo no está en el archivo exportado: la página conserva su nombre en su lugar.", other: "{count} archivos no están en el archivo exportado: las páginas conservan sus nombres en su lugar." },
  },
  'importArchive.room': {
    en: "Files are saved on this device until they upload. Free space for the app: {free}.",
    es: "Los archivos quedan en este dispositivo hasta que se suben. Espacio libre para la app: {free}.",
  },
  'importArchive.noRoom': {
    en: "This device doesn't have room: the files take {size} and the app has {free} free. Free up space or import from another device.",
    es: "No entra en este dispositivo: los archivos ocupan {size} y la app tiene {free} libres. Liberá espacio o importá desde otro dispositivo.",
  },
  'importArchive.phoneBig': {
    en: "This archive is large for a phone or tablet: importing it from a computer is safer.",
    es: "Este archivo es grande para un teléfono o una tableta: es más seguro importarlo desde una computadora.",
  },
  'importArchive.needsDrive': {
    en: "Connect Google Drive first: the photos and files of the archive go to this workspace's Drive.",
    es: "Primero conectá Google Drive: las fotos y los archivos del archivo exportado van al Drive de este workspace.",
  },
  'importArchive.resumeText': {
    en: "An earlier import of this archive into “{name}” did not finish ({done} of {total} pages). Resuming continues there without repeating what was already saved.",
    es: "Una importación anterior de este archivo a “{name}” no terminó ({done} de {total} páginas). Si seguís, continúa ahí sin repetir lo que ya se guardó.",
  },
  // Entró todo y solo faltó anotarla como terminada: no hay páginas por traer.
  'importArchive.resumeClose': {
    en: "An earlier import of this archive into “{name}” brought everything in but was not closed. Resume closes it.",
    es: "Una importación anterior de este archivo a “{name}” trajo todo pero no quedó cerrada. Seguir la cierra.",
  },
  'importArchive.resume': { en: "Resume", es: "Seguir" },
  'importArchive.startOver': { en: "Import into a new project", es: "Importar a un proyecto nuevo" },
  'importArchive.name': { en: "New project name", es: "Nombre del proyecto nuevo" },
  'importArchive.start': { en: "Import", es: "Importar" },
  'importArchive.importing': { en: "Importing…", es: "Importando…" },
  'importArchive.keepOpen': {
    en: "Keep this window open until it finishes. If it stops, choose the same archive again to resume.",
    es: "Dejá esta ventana abierta hasta que termine. Si se corta, elegí el mismo archivo otra vez para seguir.",
  },
  'importArchive.progress': { en: "Page {current} of {total}:", es: "Página {current} de {total}:" },
  // `{pages}` y `{files}` llegan ya con su cantidad y en singular o plural (acá y en `importArchive.found`).
  'importArchive.done': {
    en: "Imported {pages} and {files}.",
    es: "Se importaron {pages} y {files}.",
  },
  'importArchive.countPages': { en: { one: "{count} page", other: "{count} pages" }, es: { one: "{count} página", other: "{count} páginas" } },
  'importArchive.countFiles': { en: { one: "{count} file", other: "{count} files" }, es: { one: "{count} archivo", other: "{count} archivos" } },
  'importArchive.doneComments': {
    en: { one: "{count} comment uploads with the sync.", other: "{count} comments upload with the sync." },
    es: { one: "{count} comentario se sube con la sincronización.", other: "{count} comentarios se suben con la sincronización." },
  },
  'importArchive.uploading': {
    en: "Photos and files upload to Drive in the background; the sync badge shows what is left.",
    es: "Las fotos y los archivos se suben al Drive en segundo plano; el indicador de sincronización dice cuánto falta.",
  },
  'importArchive.canResume': {
    en: "Something was left to retry: choose the same archive again and Resume.",
    es: "Quedó algo para reintentar: elegí el mismo archivo otra vez y Seguir.",
  },
  'importArchive.problems': {
    en: { one: "{count} thing to check:", other: "{count} things to check:" },
    es: { one: "{count} cosa para revisar:", other: "{count} cosas para revisar:" },
  },
  'importArchive.open': { en: "Open project", es: "Abrir el proyecto" },
  'importArchive.someone': { en: "Someone", es: "Alguien" },

  'importArchive.error.notArchive': {
    en: "This is not a Shot Docs archive (it has no _shotdocs/manifest.json). Export it from Shot Docs with Zip — to archive.",
    es: "Esto no es un archivo de Shot Docs (no tiene _shotdocs/manifest.json). Exportalo desde Shot Docs con Zip — para archivar.",
  },
  'importArchive.error.newer': {
    en: "This archive was made by a newer version of Shot Docs. Update the app to import this archive.",
    es: "Este archivo lo hizo una versión más nueva de Shot Docs. Actualizá la app para importarlo.",
  },
  'importArchive.error.badManifest': {
    en: "The archive's manifest can't be read. Nothing was imported.",
    es: "No se puede leer el manifest del archivo. No se importó nada.",
  },
  'importArchive.error.notZip': { en: "This file is not a zip.", es: "Este archivo no es un zip." },
  'importArchive.error.damaged': {
    en: "The zip is incomplete or damaged (maybe the download was cut). Nothing was imported.",
    es: "El zip está incompleto o dañado (quizás se cortó la descarga). No se importó nada.",
  },
  'importArchive.error.tooBig': {
    en: "The archive is too large to read here. Nothing was imported.",
    es: "El archivo es demasiado grande para leerlo acá. No se importó nada.",
  },
  'importArchive.error.needsDrive': {
    en: "Connect Google Drive first: the photos and files of the archive go to this workspace's Drive.",
    es: "Primero conectá Google Drive: las fotos y los archivos del archivo exportado van al Drive de este workspace.",
  },

  'importArchive.note.badPage': { en: "page {n} of the manifest is not valid and was skipped", es: "la página {n} del manifest no es válida y se salteó" },
  'importArchive.note.duplicatePage': { en: "“{title}” appears twice in the manifest; the second was skipped", es: "“{title}” aparece dos veces en el manifest; la segunda se salteó" },
  'importArchive.note.skipped.unsafe': { en: "{name}: unsafe path in the zip, skipped", es: "{name}: ruta peligrosa en el zip, salteada" },
  'importArchive.note.skipped.encrypted': { en: "{name}: encrypted in the zip, skipped", es: "{name}: cifrado en el zip, salteado" },
  'importArchive.note.skipped.method': { en: "{name}: compressed in a way the app can't read, skipped", es: "{name}: comprimido de una forma que la app no lee, salteado" },
  'importArchive.note.skipped.duplicate': { en: "{name}: repeated in the zip, the second was skipped", es: "{name}: repetido en el zip, se salteó el segundo" },
  'importArchive.note.skipped.range': { en: "{name}: damaged entry in the zip, skipped", es: "{name}: entrada dañada en el zip, salteada" },
  'importArchive.note.skippedMore': {
    en: { one: "and {count} more entry was skipped", other: "and {count} more entries were skipped" },
    es: { one: "y se salteó {count} entrada más", other: "y se saltearon {count} entradas más" },
  },
  'importArchive.note.reattached': { en: "its parent page is not in the archive; it went to the top level", es: "su página madre no está en el archivo; quedó en el primer nivel" },
  'importArchive.note.badComments': {
    en: "The comments of the archive can't be read; the pages were imported without them.",
    es: "No se pueden leer los comentarios del archivo; las páginas se importaron sin ellos.",
  },
  'importArchive.note.commentsOff': {
    en: "Comments can't be saved on this device right now; the pages were imported without them.",
    es: "Ahora no se pueden guardar comentarios en este dispositivo; las páginas se importaron sin ellos.",
  },
  'importArchive.note.commentsWait': {
    en: "This workspace's database doesn't accept imported archive comments yet: once it is updated, choose the same archive again and Resume to add them.",
    es: "La base de este workspace todavía no acepta los comentarios de un archivo: cuando se actualice, elegí el mismo archivo otra vez y Seguir para sumarlos.",
  },
  'importArchive.note.noContent': { en: "its content is not in the archive (it failed when exporting); the page was created empty", es: "su contenido no está en el archivo (falló al exportar); la página se creó vacía" },
  'importArchive.note.badPageJson': { en: "its content in the archive can't be read", es: "no se puede leer su contenido en el archivo" },
  'importArchive.note.recompressed': {
    en: "{name} was compressed again (unzipped and zipped) and is too large to read here; it didn't come back. Import the zip Shot Docs made, without unzipping it",
    es: "{name} se volvió a comprimir (se descomprimió y se comprimió otra vez) y es demasiado grande para leerlo acá; no volvió. Importá el zip que armó Shot Docs, sin descomprimirlo",
  },
  'importArchive.note.recompressedTotal': {
    en: "the zip was compressed again and this much can't be unpacked at once; choose the same zip again and Resume, or import the zip Shot Docs made",
    es: "el zip se volvió a comprimir y no se puede descomprimir tanto de una vez; elegí el mismo zip otra vez y Seguir, o importá el zip que armó Shot Docs",
  },
  'importArchive.foundTooBig': {
    en: { one: "{count} file was compressed again and is too large to read here: import the zip Shot Docs made, without unzipping it.", other: "{count} files were compressed again and are too large to read here: import the zip Shot Docs made, without unzipping it." },
    es: { one: "{count} archivo se volvió a comprimir y es demasiado grande para leerlo acá: importá el zip que armó Shot Docs, sin descomprimirlo.", other: "{count} archivos se volvieron a comprimir y son demasiado grandes para leerlos acá: importá el zip que armó Shot Docs, sin descomprimirlo." },
  },
  'importArchive.note.damagedFile': { en: "{path} is damaged in the zip", es: "{path} está dañado en el zip" },
  'importArchive.note.incomplete': { en: "it may have been out of date on the device that exported it", es: "puede que estuviera desactualizada en el dispositivo que la exportó" },
  'importArchive.note.preview': { en: "{name} came back from its preview (the original was not in the archive)", es: "{name} volvió desde su vista (el original no estaba en el archivo)" },
  'importArchive.note.markupSkipped': {
    en: { one: "the annotations of {count} photo did not fit and were left out", other: "the annotations of {count} photos did not fit and were left out" },
    es: { one: "las anotaciones de {count} foto no entraron y quedaron afuera", other: "las anotaciones de {count} fotos no entraron y quedaron afuera" },
  },
  'importArchive.note.textOnly': { en: "the editor didn't accept its blocks; its text came back as plain paragraphs", es: "el editor no aceptó sus bloques; su texto volvió en párrafos simples" },
  'importArchive.note.unsupported': {
    en: "a newer version of the app edited it in the meantime; update the app and resume",
    es: "una versión más nueva de la app la editó mientras tanto; actualizá la app y seguí",
  },
  'importArchive.note.appended': { en: "it already had other text; the imported content went below", es: "ya tenía otro texto; lo importado quedó debajo" },
  'importArchive.note.promoted': {
    en: { one: "{count} thread had its first comment deleted; its first reply opens it now", other: "{count} threads had their first comment deleted; their first reply opens them now" },
    es: { one: "{count} hilo tenía el primer comentario borrado; ahora lo abre su primera respuesta", other: "{count} hilos tenían el primer comentario borrado; ahora los abre su primera respuesta" },
  },
  'importArchive.note.unanchored': {
    en: { one: "{count} thread lost its block and is on the whole page", other: "{count} threads lost their block and are on the whole page" },
    es: { one: "{count} hilo perdió su bloque y quedó en la página", other: "{count} hilos perdieron su bloque y quedaron en la página" },
  },
  'importArchive.note.redated': {
    en: { one: "{count} comment had an invalid date and got today's", other: "{count} comments had an invalid date and got today's" },
    es: { one: "{count} comentario tenía una fecha inválida y quedó con la de hoy", other: "{count} comentarios tenían una fecha inválida y quedaron con la de hoy" },
  },
  'importArchive.note.commentsFailed': { en: "its comments could not be saved ({reason})", es: "no se pudieron guardar sus comentarios ({reason})" },

  'importArchive.block.missingFile': {
    en: { one: "{count} photo or file was not in the archive ({list}); its name stays in its place", other: "{count} photos or files were not in the archive ({list}); their names stay in their place" },
    es: { one: "{count} foto o archivo no estaba en el archivo ({list}); su nombre queda en su lugar", other: "{count} fotos o archivos no estaban en el archivo ({list}); sus nombres quedan en su lugar" },
  },
  'importArchive.block.unknownBlock': {
    en: { one: "{count} block of a type this version doesn't know ({list}) became a paragraph with its text", other: "{count} blocks of a type this version doesn't know ({list}) became paragraphs with their text" },
    es: { one: "{count} bloque de un tipo que esta versión no conoce ({list}) quedó como párrafo con su texto", other: "{count} bloques de un tipo que esta versión no conoce ({list}) quedaron como párrafos con su texto" },
  },
  'importArchive.block.unknownInline': {
    en: { one: "{count} inline element this version doesn't know ({list}) became text", other: "{count} inline elements this version doesn't know ({list}) became text" },
    es: { one: "{count} elemento en línea que esta versión no conoce ({list}) quedó como texto", other: "{count} elementos en línea que esta versión no conoce ({list}) quedaron como texto" },
  },
  'importArchive.block.unknownProp': {
    en: { one: "{count} property this version doesn't know ({list}) was left out", other: "{count} properties this version doesn't know ({list}) were left out" },
    es: { one: "{count} propiedad que esta versión no conoce ({list}) quedó afuera", other: "{count} propiedades que esta versión no conoce ({list}) quedaron afuera" },
  },
  'importArchive.block.badProp': {
    en: { one: "{count} property with an invalid value ({list}) was left out", other: "{count} properties with invalid values ({list}) were left out" },
    es: { one: "{count} propiedad con un valor inválido ({list}) quedó afuera", other: "{count} propiedades con valores inválidos ({list}) quedaron afuera" },
  },
  'importArchive.block.badUrl': {
    en: { one: "{count} image address that is not allowed ({list}) was removed", other: "{count} image addresses that are not allowed ({list}) were removed" },
    es: { one: "se sacó {count} dirección de imagen no permitida ({list})", other: "se sacaron {count} direcciones de imagen no permitidas ({list})" },
  },
  'importArchive.block.badLink': {
    en: { one: "{count} link that is not allowed ({list}) became text", other: "{count} links that are not allowed ({list}) became text" },
    es: { one: "{count} link no permitido ({list}) quedó como texto", other: "{count} links no permitidos ({list}) quedaron como texto" },
  },
  'importArchive.block.outsideLink': {
    en: { one: "{count} link to a page outside the archive became text", other: "{count} links to pages outside the archive became text" },
    es: { one: "{count} link a una página de afuera del archivo quedó como texto", other: "{count} links a páginas de afuera del archivo quedaron como texto" },
  },
  'importArchive.block.externalImage': {
    en: { one: "{count} image loads from another site ({list}); that site can tell when the page is opened", other: "{count} images load from other sites ({list}); those sites can tell when the page is opened" },
    es: { one: "{count} imagen se carga de otro sitio ({list}); ese sitio puede saber cuándo se abre la página", other: "{count} imágenes se cargan de otros sitios ({list}); esos sitios pueden saber cuándo se abre la página" },
  },
  'importArchive.block.duplicateId': {
    en: { one: "{count} repeated block id got a new one", other: "{count} repeated block ids got new ones" },
    es: { one: "{count} id de bloque repetido recibió uno nuevo", other: "{count} ids de bloque repetidos recibieron uno nuevo" },
  },
  'importArchive.block.tooDeep': {
    en: "blocks nested too deep moved up a level, with their text",
    es: "bloques anidados demasiado hondo subieron un nivel, con su texto",
  },
  'importArchive.block.tooMany': {
    en: "the page has too many blocks; the ones after the limit were left out",
    es: "la página tiene demasiados bloques; los que pasan el tope quedaron afuera",
  },
  // Lo que quedó pendiente (importCommit.ts, `importPendingText`): en el diálogo y en la lista del final.
  'importArchive.pending.job.changed': {
    en: "An earlier import of this archive was left unfinished, or it changed in another tab. Try again with the options below.",
    es: "Una importación anterior de este archivo quedó sin terminar, o cambió en otra pestaña. Probá de nuevo con las opciones de abajo.",
  },
  'importArchive.pending.job.unreadable': {
    en: "This device has an import record for this archive that this version of the app can't read. Update the app and close its other tabs.",
    es: "Este dispositivo tiene un registro de importación de este archivo que esta versión de la app no puede leer. Actualizá la app y cerrá sus otras pestañas.",
  },
  'importArchive.pending.page.unsaved': {
    en: "could not be saved on this device yet; resume the import",
    es: "todavía no se pudo guardar en este dispositivo; seguí la importación",
  },
  'importArchive.pending.page.changed': {
    en: "changed while it was being imported; resume the import",
    es: "cambió mientras se importaba; seguí la importación",
  },
  'importArchive.pending.page.mismatch': {
    en: "was left in a state the import can't continue; use Import into a new project",
    es: "quedó en un estado que la importación no puede seguir; usá Importar a un proyecto nuevo",
  },
  'importArchive.pending.page.invalid': {
    en: "could not be prepared for importing, and Resume will give the same result; use Import into a new project",
    es: "no se pudo preparar para importar, y Seguir va a dar lo mismo; usá Importar a un proyecto nuevo",
  },
  'importArchive.pending.close': {
    en: "Everything came in, but the import could not be marked as finished: choose the same archive again and use Resume. If Resume says this again, use Import into a new project.",
    es: "Entró todo, pero la importación no se pudo anotar como terminada: elegí el mismo archivo de nuevo y usá Seguir. Si Seguir vuelve a decir esto, usá Importar a un proyecto nuevo.",
  },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(importArchive);
