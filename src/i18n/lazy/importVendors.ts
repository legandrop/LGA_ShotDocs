import { register } from '../index';
import type { Dict } from '../types';

// Importar vendors desde una planilla (se carga con su ventana). Docs/Doc_Compartir_Escenas.md, sección 13.

export const importVendors = {
  'scenes.import.button': { en: "Import from spreadsheet…", es: "Importar desde planilla…" },
  'scenes.import.buttonTip': {
    en: "Assign scenes to vendors from a breakdown in Excel or CSV",
    es: "Asignar escenas a vendors desde un breakdown en Excel o CSV",
  },
  'scenes.import.title': { en: "Import vendors from a spreadsheet", es: "Importar vendors desde una planilla" },
  'scenes.import.lead': {
    en: "{project} · The spreadsheet is read on this device and isn't uploaded anywhere.",
    es: "{project} · La planilla se lee en este dispositivo y no se sube a ningún lado.",
  },
  'scenes.import.steps': { en: "Steps", es: "Pasos" },
  'scenes.import.stepFile': { en: "File", es: "Archivo" },
  'scenes.import.stepVendors': { en: "Vendors", es: "Vendors" },
  'scenes.import.stepReview': { en: "Review", es: "Revisar" },
  'scenes.import.choose': { en: "Choose file…", es: "Elegir archivo…" },
  'scenes.import.chooseOther': { en: "Choose another…", es: "Elegir otro…" },
  'scenes.import.drop': {
    en: "Choose a breakdown with one row per shot: the shot name (like ERSO_1016_0300) and its vendor. Or drop it here.",
    es: "Elegí un breakdown con un renglón por plano: el shot name (como ERSO_1016_0300) y su vendor. O soltalo acá.",
  },
  'scenes.import.formats': {
    en: "Excel (.xlsx) or CSV. From Numbers or Google Sheets, export to one of those first.",
    es: "Excel (.xlsx) o CSV. Desde Numbers o Google Sheets, exportalo antes a uno de esos.",
  },
  'scenes.import.reading': { en: "Reading…", es: "Leyendo…" },
  'scenes.import.errFormat': {
    en: "This file can't be read. Save it as .xlsx or .csv and try again.",
    es: "Este archivo no se puede leer. Guardalo como .xlsx o .csv y probá de nuevo.",
  },
  'scenes.import.errTooBig': { en: "This file is too big to read here.", es: "Este archivo es demasiado grande para leerlo acá." },
  'scenes.import.errEmpty': { en: "This file has no sheets to read.", es: "Este archivo no tiene hojas para leer." },
  'scenes.import.sheetCount': {
    en: { one: "{count} sheet", other: "{count} sheets" },
    es: { one: "{count} hoja", other: "{count} hojas" },
  },
  'scenes.import.sheet': { en: "Sheet", es: "Hoja" },
  'scenes.import.headerRow': { en: "Header row", es: "Fila del encabezado" },
  'scenes.import.sheetMeta': {
    en: { one: "Header on row {row} · {count} shot", other: "Header on row {row} · {count} shots" },
    es: { one: "Encabezado en la fila {row} · {count} plano", other: "Encabezado en la fila {row} · {count} planos" },
  },
  'scenes.import.noHeader': {
    en: "No header with a shot column and a vendor column was found in this sheet. Pick the header row and the columns, or another sheet.",
    es: "En esta hoja no se encontró un encabezado con columna de shot y de vendor. Elegí la fila del encabezado y las columnas, u otra hoja.",
  },
  'scenes.import.colShot': { en: "Shot name", es: "Shot name" },
  'scenes.import.colShotHint': { en: "the scene comes from here", es: "de acá sale la escena" },
  'scenes.import.colVendor': { en: "Vendor", es: "Vendor" },
  'scenes.import.colLetter': { en: "Scene letter", es: "Letra de la escena" },
  'scenes.import.optional': { en: "optional", es: "opcional" },
  'scenes.import.none': { en: "(none)", es: "(ninguna)" },
  'scenes.import.pick': { en: "Choose a column", es: "Elegí una columna" },
  'scenes.import.shotBad': {
    en: "This column has almost no shot names (like ERSO_1016_0300).",
    es: "Esta columna casi no tiene shot names (como ERSO_1016_0300).",
  },
  'scenes.import.vendorNames': {
    en: { one: "{count} name", other: "{count} different names" },
    es: { one: "{count} nombre", other: "{count} nombres distintos" },
  },
  'scenes.import.vendorEmpty': { en: "This column is empty.", es: "Esta columna está vacía." },
  'scenes.import.letterHint': {
    en: "Only used when the project has a scene with a letter (1016A) and the shot name doesn't: 101_16A2-01-06 → 1016A.",
    es: "Solo se usa cuando el proyecto tiene la escena con letra (1016A) y el shot name no: 101_16A2-01-06 → 1016A.",
  },
  'scenes.import.letterNone': {
    en: "Without it, scenes that only exist with a letter are left for you to assign by hand.",
    es: "Sin esto, las escenas que existen solo con letra quedan para asignar a mano.",
  },
  'scenes.import.sampleScene': { en: "Scene", es: "Escena" },
  'scenes.import.samplePage': { en: "Page in {project}", es: "Página en {project}" },
  'scenes.import.noPage': { en: "No page in this project", es: "Sin página en este proyecto" },
  'scenes.import.whichOne': { en: "Can't tell which", es: "No se sabe cuál" },
  'scenes.import.fromClip': { en: "from the clip", es: "por el clip" },
  'scenes.import.noVendorCell': { en: "no vendor", es: "sin vendor" },
  'scenes.import.next': { en: "Next", es: "Siguiente" },
  'scenes.import.back': { en: "Back", es: "Atrás" },
  'scenes.import.toReview': { en: "Review", es: "Revisar" },
  'scenes.import.cancel': { en: "Cancel", es: "Cancelar" },
  'scenes.import.apply': { en: "Apply to table", es: "Aplicar a la tabla" },
  'scenes.import.shotsRead': {
    en: { one: "{count} shot read", other: "{count} shots read" },
    es: { one: "{count} plano leído", other: "{count} planos leídos" },
  },
  'scenes.import.vendorsLead': {
    en: "Each name in the spreadsheet joins a vendor of the project, is created, or is skipped. Cells with two vendors (“Wanka, Net-Fx”) are already split at the comma.",
    es: "Cada nombre de la planilla se une a un vendor del proyecto, se crea, o se omite. Las celdas con dos vendors («Wanka, Net-Fx») ya están partidas por la coma.",
  },
  'scenes.import.colName': { en: "Name in the spreadsheet", es: "Nombre en la planilla" },
  'scenes.import.colIn': { en: "In {project}", es: "En {project}" },
  'scenes.import.shotCount': {
    en: { one: "{count} shot", other: "{count} shots" },
    es: { one: "{count} plano", other: "{count} planos" },
  },
  'scenes.import.whatFor': { en: "What to do with {name}", es: "Qué hacer con {name}" },
  'scenes.import.optNew': { en: "Create new vendor", es: "Crear vendor nuevo" },
  'scenes.import.optExisting': { en: "Project vendor: {name}", es: "Vendor del proyecto: {name}" },
  'scenes.import.optSame': { en: "Same as “{name}”", es: "Mismo que «{name}»" },
  'scenes.import.optSkip': { en: "Don't import", es: "No importar" },
  'scenes.import.newName': { en: "Name of the new vendor", es: "Nombre del vendor nuevo" },
  'scenes.import.code': { en: "Code", es: "Código" },
  'scenes.import.color': { en: "Color of {name}", es: "Color de {name}" },
  'scenes.import.tagNew': { en: "new", es: "nuevo" },
  'scenes.import.tagSuggested': { en: "suggested: spelled almost the same", es: "sugerido: se escribe casi igual" },
  'scenes.import.newHint': {
    en: "New vendors are created without emails: planning only until you add one.",
    es: "Los vendors nuevos se crean sin correos: es solo planificación hasta que les cargues uno.",
  },
  'scenes.import.newVendors': {
    en: { one: "{count} new vendor", other: "{count} new vendors" },
    es: { one: "{count} vendor nuevo", other: "{count} vendors nuevos" },
  },
  'scenes.import.needName': { en: "Every new vendor needs a name.", es: "Cada vendor nuevo necesita un nombre." },
  'scenes.import.cardAdd': {
    en: { one: "assignments in {count} scene", other: "assignments in {count} scenes" },
    es: { one: "asignaciones en {count} escena", other: "asignaciones en {count} escenas" },
  },
  'scenes.import.cardChange': {
    en: { one: "scene changes vendor", other: "scenes change vendor" },
    es: { one: "escena cambia de vendor", other: "escenas cambian de vendor" },
  },
  'scenes.import.cardLetter': {
    en: { one: "resolved by the clip letter", other: "resolved by the clip letter" },
    es: { one: "resuelta por la letra del clip", other: "resueltas por la letra del clip" },
  },
  'scenes.import.cardNoPage': {
    en: { one: "scene with no page: not imported", other: "scenes with no page: not imported" },
    es: { one: "escena sin página: no se importa", other: "escenas sin página: no se importan" },
  },
  'scenes.import.changeTitle': { en: "Change vendor", es: "Cambian de vendor" },
  'scenes.import.changeLead': {
    en: "In {project} these scenes are in a vendor the spreadsheet no longer lists for them. Checked: it's removed from that vendor. Unchecked: it stays and the new one is added.",
    es: "En {project} estas escenas están en un vendor que en la planilla ya no figura para ellas. Marcada: se le saca a ese vendor. Sin marcar: se queda y el nuevo se suma.",
  },
  'scenes.import.replaceAll': { en: "Replace all", es: "Reemplazar todas" },
  'scenes.import.ofTotal': { en: "{count} of {total}", es: "{count} de {total}" },
  'scenes.import.removedFrom': { en: "Removed from {names}", es: "Se le saca a {names}" },
  'scenes.import.staysIn': { en: "Also stays in {names}", es: "Queda también en {names}" },
  'scenes.import.addTitle': { en: "Added", es: "Se suman" },
  'scenes.import.addLead': { en: "Per vendor, the scenes it gets.", es: "Por vendor, las escenas que se le asignan." },
  'scenes.import.untouched': {
    en: { one: "{count} scene of {project} that already has a vendor and gets nothing from the spreadsheet stays as it is.", other: "{count} scenes of {project} that already have a vendor and get nothing from the spreadsheet stay as they are." },
    es: { one: "{count} escena de {project} que ya tiene vendor y no recibe nada de la planilla queda como está.", other: "{count} escenas de {project} que ya tienen vendor y no reciben nada de la planilla quedan como están." },
  },
  'scenes.import.nothingToAdd': { en: "Nothing new to add.", es: "Nada nuevo para sumar." },
  'scenes.import.letterTitle': { en: "Resolved by the clip letter", es: "Resueltas por la letra del clip" },
  'scenes.import.letterLead': {
    en: "In {project} these scenes only exist with a letter and the shot name doesn't have it: the letter comes from the clip column.",
    es: "En {project} estas escenas existen solo con letra y el shot name no la trae: la letra sale de la columna del clip.",
  },
  'scenes.import.ambTitle': { en: "Can't tell which", es: "No se pudo saber cuál" },
  'scenes.import.ambLead': {
    en: "Either the scene only exists with a letter and the clip doesn't say which, or two episodes have a scene with that number: they aren't imported. Assign them by hand in the table.",
    es: "O la escena existe solo con letra y el clip no dice cuál, o dos episodios tienen una escena con ese número: no se importan. Asignalas a mano en la tabla.",
  },
  'scenes.import.noPageTitle': { en: "Scenes with no page in {project}", es: "Escenas sin página en {project}" },
  'scenes.import.noPageLead': {
    en: "They have no page or report in this project: they probably came up in post. They aren't imported. If you create their page later, import again.",
    es: "No tienen página ni reporte en este proyecto: seguramente surgieron en post. No se importan. Si más adelante creás su página, importá de nuevo.",
  },
  'scenes.import.blockedTitle': { en: "Can't be assigned", es: "No se pueden asignar" },
  'scenes.import.blockedLead': {
    en: "Scenes that can't be shared today (something else is inside, or they need the scene mark and you can't edit them), or a vendor you can't add scenes to. They aren't imported.",
    es: "Escenas que hoy no se pueden compartir (tienen otra cosa adentro, o les falta la marca de escena y no las podés editar), o un vendor al que no le podés sumar escenas. No se importan.",
  },
  'scenes.import.noVendorTitle': { en: "No vendor in the spreadsheet", es: "Sin vendor en la planilla" },
  'scenes.import.noVendorLead': {
    en: "Shots with an empty vendor column, or whose vendors you left out: {shots}. Scenes with no shot that has a vendor: {scenes}. They stay as they are.",
    es: "Planos con la columna de vendor vacía, o con vendors que dejaste afuera: {shots}. Escenas sin ningún plano con vendor: {scenes}. Quedan como están.",
  },
  'scenes.import.badShots': {
    en: { one: "{count} row has a shot name that isn't a shot (like ERSO_1016_0300): skipped.", other: "{count} rows have a shot name that isn't a shot (like ERSO_1016_0300): skipped." },
    es: { one: "{count} fila tiene un shot name que no es un plano (como ERSO_1016_0300): se saltea.", other: "{count} filas tienen un shot name que no es un plano (como ERSO_1016_0300): se saltean." },
  },
  'scenes.import.replacements': {
    en: { one: "{count} of {total} replacement", other: "{count} of {total} replacements" },
    es: { one: "{count} de {total} reemplazo", other: "{count} de {total} reemplazos" },
  },
  'scenes.import.nothingShared': { en: "Nothing is shared until Save", es: "Nada se comparte hasta Guardar" },
  'scenes.import.nothing': {
    en: "The spreadsheet doesn't change anything in {project}.",
    es: "La planilla no cambia nada en {project}.",
  },
  'scenes.import.tooMany': {
    en: "That's {count} scene changes, and one Save takes up to 1000. Import part of the spreadsheet (fewer vendors), save, and import the rest.",
    es: "Son {count} cambios de escenas, y Guardar acepta hasta 1000 por vez. Importá una parte de la planilla (menos vendors), guardá, e importá el resto.",
  },
  'scenes.import.appliedAdds': {
    en: { one: "+{count} assignment", other: "+{count} assignments" },
    es: { one: "+{count} asignación", other: "+{count} asignaciones" },
  },
  'scenes.import.appliedRm': {
    en: { one: "{count} replacement", other: "{count} replacements" },
    es: { one: "{count} reemplazo", other: "{count} reemplazos" },
  },
  'scenes.import.applied': {
    en: "From the spreadsheet: {what}. Check the table: nothing is saved or shared until Save.",
    es: "De la planilla: {what}. Revisá la tabla: nada se guarda ni se comparte hasta Guardar.",
  },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(importVendors);
