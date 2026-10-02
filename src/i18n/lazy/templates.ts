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

  // --- El reporte del día (Docs/Doc_Plantillas.md, sección 6): el globito y la tira con On-Set Report ---
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
