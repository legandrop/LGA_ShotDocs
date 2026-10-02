import { register } from '../index';
import type { Dict } from '../types';

// Las plantillas (Docs/Doc_Plantillas.md): la tira de la página vacía, la ventana *Templates* y la vista previa. Se
// bajan aparte, con el editor (src/templates/TemplateHost.tsx) y con la página de práctica (la vista previa). Los
// nombres y descripciones de las de fábrica están con sus bloques (src/templates/builtin.*.ts).

export const templates = {
  'templates.start': { en: "Start from a template", es: "Empezar con una plantilla" },
  'templates.more': { en: "More…", es: "Más…" },
  'templates.title': { en: "Templates", es: "Plantillas" },
  'templates.builtIn': { en: "Built-in", es: "De fábrica" },
  'templates.use': { en: "Use", es: "Usar" },
  'templates.preview': { en: "Preview", es: "Ver" },
  'templates.previewTip': {
    en: "Opens it as a practice page: nothing you write there is saved.",
    es: "La abre como página de práctica: lo que escribas ahí no se guarda.",
  },
  'templates.readOnly': {
    en: "You can't edit this page.",
    es: "No podés editar esta página.",
  },
  'templates.loading': {
    en: "The page is still loading.",
    es: "La página todavía se está cargando.",
  },
  'templates.copyNote': {
    en: "The page gets a copy: changing a template later doesn't change pages already made with it. Internal — remove before sharing holds bids and vendors: delete that section before sharing the page with a client.",
    es: "La página recibe una copia: cambiar una plantilla después no cambia las páginas ya hechas con ella. Interno — borrar antes de compartir tiene cotizaciones y proveedores: borrá esa sección antes de compartir la página con un cliente.",
  },
  'templates.applyFailed': {
    en: "The template couldn't be added. Nothing on the page changed.",
    es: "No se pudo agregar la plantilla. La página quedó como estaba.",
  },

  // --- Las plantillas propias (Docs/Doc_Plantillas.md, entrega 3): la ventana, guardar, ajustes y usarlas ---
  'templates.thisProject': { en: "This project", es: "Este proyecto" },
  'templates.otherProjects': { en: "Other projects", es: "Otros proyectos" },
  'templates.customize': { en: "Customize", es: "Personalizar" },
  'templates.customizeTip': {
    en: "Makes your own copy in this project's Templates folder, to change it",
    es: "Hace una copia tuya en la carpeta Plantillas de este proyecto, para cambiarla",
  },
  'templates.open': { en: "Open", es: "Abrir" },
  'templates.openTip': { en: "To change it: it's a page like any other", es: "Para cambiarla: es una página como cualquier otra" },
  'templates.createBlocked': {
    en: "Needs permission to create pages in Templates",
    es: "Hace falta permiso para crear páginas en Plantillas",
  },
  'templates.folderName': { en: "Templates", es: "Plantillas" },
  'templates.untitled': { en: "Untitled template", es: "Plantilla sin nombre" },
  'templates.newer': {
    en: "This template was made with a newer version of the app. Update to use it.",
    es: "Esta plantilla se hizo con una versión más nueva de la app. Actualizala para usarla.",
  },
  'templates.notDownloaded': {
    en: "This template hasn't finished downloading.",
    es: "Esta plantilla todavía no terminó de bajar.",
  },
  'templates.gone': {
    en: "This template isn't available anymore.",
    es: "Esta plantilla ya no está disponible.",
  },
  'templates.wait': { en: "Wait", es: "Esperar" },
  'templates.waiting': {
    en: "Waiting for the template to download… It's used as soon as it arrives.",
    es: "Esperando que baje la plantilla… Se usa apenas llega.",
  },
  'templates.useBuiltIn': { en: "Use built-in", es: "Usar la de fábrica" },
  'templates.mediaRemoved': {
    en: {
      one: "{count} photo or file wasn't copied: it belongs to another project.",
      other: "{count} photos and files weren't copied: they belong to another project.",
    },
    es: {
      one: "{count} foto o archivo no se copió: es de otro proyecto.",
      other: "{count} fotos y archivos no se copiaron: son de otro proyecto.",
    },
  },
  'templates.customizeFailed': {
    en: "The copy couldn't be made. Nothing was lost; try again.",
    es: "No se pudo hacer la copia. No se perdió nada; probá de nuevo.",
  },
  'saveTemplate.title': { en: "Save as template", es: "Guardar como plantilla" },
  'saveTemplate.name': { en: "Name", es: "Nombre" },
  'saveTemplate.description': { en: "Description", es: "Descripción" },
  'saveTemplate.dayReport': { en: "Use for day reports", es: "Usar para reportes del día" },
  'saveTemplate.dayReportTip': {
    en: "New day report offers it, and the day reports folder of this page starts using it",
    es: "Nuevo reporte del día la ofrece, y la carpeta de reportes de esta página empieza a usarla",
  },
  'saveTemplate.dayReportSettingsTip': {
    en: "New day report offers it",
    es: "Nuevo reporte del día la ofrece",
  },
  'saveTemplate.clear': { en: "Clear filled-in values", es: "Vaciar lo completado" },
  'saveTemplate.clearTip': {
    en: "Empties table cells (keeps headers and row labels), unchecks checkboxes and leaves out photos and files",
    es: "Vacía las celdas de las tablas (deja encabezados y rótulos), desmarca las casillas y no copia fotos ni archivos",
  },
  'saveTemplate.note': {
    en: "The copy goes to this project's Templates folder. This page doesn't change.",
    es: "La copia va a la carpeta Plantillas de este proyecto. Esta página no cambia.",
  },
  'saveTemplate.save': { en: "Save", es: "Guardar" },
  'saveTemplate.saved': { en: "Saved as template", es: "Guardada como plantilla" },
  'saveTemplate.open': { en: "Open", es: "Abrir" },
  'saveTemplate.failed': {
    en: "The template couldn't be saved. Nothing was lost; try again.",
    es: "No se pudo guardar la plantilla. No se perdió nada; probá de nuevo.",
  },
  'saveTemplate.notDownloaded': {
    en: "This page hasn't finished downloading: try again in a moment.",
    es: "Esta página todavía no terminó de bajar: probá de nuevo en un momento.",
  },
  'saveTemplate.newer': {
    en: "This page has content from a newer version of the app. Update to save it as a template.",
    es: "Esta página tiene contenido de una versión más nueva de la app. Actualizala para guardarla como plantilla.",
  },
  'saveTemplate.tooLong': {
    en: "That doesn't fit: shorten the description.",
    es: "No entra: acortá la descripción.",
  },
  'templateSettings.title': { en: "Template settings", es: "Ajustes de la plantilla" },

  // --- El reporte del día (Docs/Doc_Plantillas.md, sección 6): el globito y la tira con On-Set Report ---
  'dayReport.template': { en: "Template", es: "Plantilla" },
  'dayReport.templateNotShared': {
    en: "The report template isn't shared with you; using {name}",
    es: "La plantilla de los reportes no está compartida con vos; se usa {name}",
  },
  'dayReport.templateGone': {
    en: "The report template isn't available anymore; using {name}",
    es: "La plantilla de los reportes ya no está disponible; se usa {name}",
  },
  'dayReport.templateMissing': {
    en: "The report template hasn't finished downloading; using {name}",
    es: "La plantilla de los reportes todavía no terminó de bajar; se usa {name}",
  },
  'dayReport.templateNewer': {
    en: "The report template was made with a newer version of the app; using {name}",
    es: "La plantilla de los reportes se hizo con una versión más nueva de la app; se usa {name}",
  },
  'dayReport.date': { en: "Date", es: "Fecha" },
  'dayReport.day': { en: "Shoot day", es: "Día de rodaje" },
  'dayReport.location': { en: "Location", es: "Locación" },
  'dayReport.create': { en: "Create", es: "Crear" },
  'dayReport.open': { en: "Open", es: "Abrir" },
  'dayReport.createAnother': { en: "Create another", es: "Crear otro" },
  'dayReport.exists': { en: "{name} already exists", es: "{name} ya existe" },
  'dayReport.several': { en: "{count} reports for {date}", es: "{count} reportes del {date}" },
  'dayReport.incomplete': {
    en: "The previous report hasn't finished downloading — check the location",
    es: "El reporte anterior todavía no terminó de bajar: revisá la locación",
  },
  'dayReport.loading': { en: "Reading the previous report…", es: "Leyendo el reporte anterior…" },
  'dayReport.failed': {
    en: "The day report couldn't be created. Nothing was lost; try again.",
    es: "No se pudo crear el reporte del día. No se perdió nada; probá de nuevo.",
  },
  'dayReport.atRoot': {
    en: "Put day reports inside a folder to get New day report",
    es: "Poné los reportes del día adentro de una carpeta para tener Nuevo reporte del día",
  },

  // --- La vista previa (la página de práctica con una plantilla) ---
  'templates.previewCrumb': { en: "Template preview", es: "Vista previa de plantilla" },
  'templates.previewBanner': {
    en: "Template preview: nothing you write here is saved or seen by anyone.",
    es: "Vista previa de la plantilla: lo que escribas acá no se guarda ni lo ve nadie.",
  },
  'templates.previewWhich': { en: "Template", es: "Plantilla" },
  'templates.previewLanguage': { en: "Content language", es: "Idioma del contenido" },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(templates);
