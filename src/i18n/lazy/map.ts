import { register } from '../index';
import type { Dict } from '../types';

// El mapa del proyecto (Docs/Doc_Relaciones.md, sección 12; se carga aparte, con la vista).

export const map = {
  'map.title': { en: "Map", es: "Mapa" },
  'map.lede': { en: "Built on this device from every page of the project", es: "Armado en este dispositivo con todas las páginas del proyecto" },
  'map.ledePartial': { en: "Built on this device from the pages you can see", es: "Armado en este dispositivo con las páginas que ves" },
  'map.reading': { en: "Reading {ready} of {total}…", es: "Leyendo {ready} de {total}…" },
  'map.scenes': { en: { one: "{count} scene", other: "{count} scenes" }, es: { one: "{count} escena", other: "{count} escenas" } },
  'map.locations': { en: { one: "{count} location", other: "{count} locations" }, es: { one: "{count} locación", other: "{count} locaciones" } },
  'map.days': { en: { one: "{count} shoot day", other: "{count} shoot days" }, es: { one: "{count} día de rodaje", other: "{count} días de rodaje" } },
  'map.dayCount': { en: { one: "{count} day", other: "{count} days" }, es: { one: "{count} día", other: "{count} días" } },
  'map.tabLocations': { en: "Locations", es: "Locaciones" },
  'map.tabScenes': { en: "Scenes", es: "Escenas" },
  'map.tabDays': { en: "Shoot days", es: "Días de rodaje" },
  'map.tabPending': { en: "Pending", es: "Pendientes" },
  'map.copy': { en: "Copy map", es: "Copiar mapa" },
  'map.copyTip': {
    en: "Every scene, location and shoot day as text, to paste into an assistant or a document. Only what you can see.",
    es: "Todas las escenas, locaciones y días como texto, para pegar en un asistente o un documento. Solo lo que ves.",
  },
  'map.copyJson': { en: "Copy JSON", es: "Copiar JSON" },
  'map.copyJsonTip': {
    en: "The same map as JSON (shotdocs.map, version 1), with where each thing is named: for an assistant or a script",
    es: "El mismo mapa en JSON (shotdocs.map, versión 1), con dónde se nombra cada cosa: para un asistente o un script",
  },
  'map.copied': { en: "Map copied: {scenes}, {locations}", es: "Mapa copiado: {scenes}, {locations}" },
  'map.copiedReading': { en: "Copied while this device is still reading the project: something may be missing", es: "Copiado mientras este dispositivo todavía lee el proyecto: puede faltar algo" },
  'map.copyFailed': { en: "Couldn’t copy: the browser didn’t allow it", es: "No se pudo copiar: el navegador no lo permitió" },
  'map.filter': { en: "Filter by name, number or date", es: "Filtrar por nombre, número o fecha" },
  'map.legendWritten': { en: "report written", es: "reporte escrito" },
  'map.legendEmpty': { en: "nothing written", es: "nada escrito" },
  'map.legendScouting': { en: "has a scouting", es: "tiene scouting" },
  'map.colLocation': { en: "Location", es: "Locación" },
  'map.colFromPages': { en: "From the pages", es: "Según las páginas" },
  'map.colFromPagesTip': {
    en: "Scenes whose breakdown names it or that have a report section on one of its days; days whose title names it",
    es: "Escenas cuyo desglose la nombra o con una sección en el reporte de uno de sus días; días cuyo título la nombra",
  },
  'map.noShootDays': { en: "Without shoot days", es: "Sin días de rodaje" },
  'map.colScene': { en: "Scene", es: "Escena" },
  'map.colTitle': { en: "Title", es: "Título" },
  'map.colWhere': { en: "Locations", es: "Locaciones" },
  'map.colWhereTip': {
    en: "«report»: a day whose title names the location has a section of the scene. «planned»: its breakdown names the location.",
    es: "«reporte»: un día cuyo título nombra la locación tiene una sección de la escena. «planeada»: su desglose nombra la locación.",
  },
  'map.colDays': { en: "Days", es: "Días" },
  'map.inReport': { en: "report", es: "reporte" },
  'map.inPlan': { en: "planned", es: "planeada" },
  'map.dayPlanned': { en: "in a plan", es: "en un plan" },
  'map.noReportSection': { en: "No report section", es: "Sin sección en un reporte" },
  'map.noReportSeen': { en: "No report section you can see", es: "Sin sección en un reporte que veas" },
  'map.episodeScenes': { en: { one: "{count} scene", other: "{count} scenes" }, es: { one: "{count} escena", other: "{count} escenas" } },
  'map.noEpisode': { en: "Scenes", es: "Escenas" },
  'map.colDate': { en: "Date", es: "Fecha" },
  'map.colDay': { en: "Day", es: "Día" },
  'map.colScenes': { en: "Scenes", es: "Escenas" },
  'map.withSection': { en: { one: "{count} with a section", other: "{count} with a section" }, es: { one: "{count} con sección", other: "{count} con sección" } },
  'map.plannedN': { en: { one: "{count} planned", other: "{count} planned" }, es: { one: "{count} planeada", other: "{count} planeadas" } },
  'map.nothingWritten': { en: "nothing written", es: "nada escrito" },
  'map.noLocation': { en: "No location in the title", es: "Sin locación en el título" },
  'map.noLocationTip': {
    en: "What the day title says: it doesn’t name a location of the project",
    es: "Lo que dice el título del día: no nombra una locación del proyecto",
  },
  'map.pendingScene': { en: "{code} doesn’t exist yet", es: "{code} todavía no existe" },
  'map.pendingSceneSeen': { en: "{code} isn’t in the pages you can see", es: "{code} no está en las páginas que ves" },
  'map.pendingSeenNote': {
    en: "You see part of this project: this scene may exist in a page you can’t see.",
    es: "Ves una parte de este proyecto: esta escena puede existir en una página que no ves.",
  },
  'map.namedIn': { en: "Named in", es: "Nombrada en" },
  'map.createLater': {
    en: "Create it here when it can’t duplicate anything (or with + in its episode folder): every mention relates by itself. If it’s a typo, Assign links every mention to the scene it means.",
    es: "Creala desde acá cuando no puede duplicar nada (o con + en la carpeta de su episodio): cada mención se relaciona sola. Si es un error de tipeo, Asignar linkea cada mención a la escena que quiere decir.",
  },
  'map.duplicate': {
    en: { one: "{code} is in {count} page", other: "{code} is in {count} pages" },
    es: { one: "{code} está en {count} página", other: "{code} está en {count} páginas" },
  },
  'map.duplicateDayHint': {
    en: "Two devices may have created the same shoot day at the same time. Move what’s written into one and send the other to the trash; if it’s a second unit, it can stay.",
    es: "Dos dispositivos pueden haber creado el mismo día de rodaje a la vez. Pasá lo escrito a uno y mandá el otro a la papelera; si es una segunda unidad, puede quedar.",
  },
  'map.duplicateHint': {
    en: "The relations use the first one in the sidebar. Move what’s written into one and send the other to the trash.",
    es: "Las relaciones usan la primera de la barra lateral. Pasá lo escrito a una y mandá la otra a la papelera.",
  },
  'map.unnumbered': { en: "«{title}» has no scene number", es: "«{title}» no tiene número de escena" },
  'map.unnumberedHint': { en: "Write the scene number in its heading and it relates by itself", es: "Escribí el número de escena en su título y se relaciona sola" },
  'map.photos': { en: { one: "{count} photo", other: "{count} photos" }, es: { one: "{count} foto", other: "{count} fotos" } },
  'map.openSection': { en: "Open section", es: "Abrir la sección" },
  'map.pendingFoot': {
    en: "A scene number that doesn’t exist yet never blocks writing: it waits here until its scene exists.",
    es: "Un número de escena que todavía no existe nunca frena la escritura: espera acá hasta que exista su escena.",
  },
  'map.pendingFootSeen': {
    en: "A scene number that isn’t in the pages you can see never blocks writing: it waits here.",
    es: "Un número de escena que no está en las páginas que ves nunca frena la escritura: espera acá.",
  },
  'map.nothingPending': { en: "Nothing pending.", es: "Nada pendiente." },
  'map.nothingPendingSeen': { en: "Nothing pending in the pages you can see.", es: "Nada pendiente en las páginas que ves." },
  'map.noMatch': { en: "Nothing matches the filter.", es: "Nada coincide con el filtro." },
  'map.empty': {
    en: "This project has no scenes, locations or shoot days yet. In a folder’s menu, Type › Pages created inside are: Scenes, Locations or Shoot days. The map fills in by itself.",
    es: "Este proyecto todavía no tiene escenas, locaciones ni días de rodaje. En el menú de una carpeta, Tipo › Lo que se crea adentro es: Escenas, Locaciones o Días de rodaje. El mapa se llena solo.",
  },
  'map.unavailable': { en: "The map isn’t available here.", es: "El mapa no está disponible acá." },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(map);
