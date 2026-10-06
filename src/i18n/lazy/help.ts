import { register } from '../index';
import type { Dict } from '../types';

// La ayuda (Docs/Doc_Tutorial.md, sección 5): se baja aparte, con HelpDialog.tsx. Las entradas están en
// `src/help/entries.ts`; lo que hace cada atajo, en `src/help/shortcutTexts.ts`. Los `{valores}` de los textos
// son rótulos de atajos del registro (shortcuts.ts), puestos al mostrar: nunca quedan viejos.

export const help = {
  // --- El diálogo ---
  'help.title': { en: "Help and shortcuts", es: "Ayuda y atajos" },
  'help.search': { en: "Search the help", es: "Buscar en la ayuda" },
  'help.noResults': { en: "No results. Try another word.", es: "No encontramos eso. Probá con otra palabra." },
  'help.index': { en: "Sections", es: "Secciones" },
  'help.unavailable': { en: "Not available to you here: {reason}", es: "Acá no lo tenés: {reason}" },
  'help.when.portero': {
    en: "the workspace needs Google Drive connected.",
    es: "el workspace necesita Google Drive conectado.",
  },
  'help.when.admin': { en: "only the owner and the admins.", es: "solo el dueño y los admins." },
  'help.when.owner': { en: "only the workspace owner.", es: "solo el dueño del workspace." },
  'help.installed': { en: "This is already the installed app.", es: "Esta ya es la app instalada." },
  'help.keysPhone': {
    en: "Keyboard shortcuts are for a hardware keyboard (an iPad with a keyboard, a computer).",
    es: "Los atajos son para un teclado físico (un iPad con teclado, una computadora).",
  },

  // --- Las secciones ---
  'help.section.start': { en: "Getting started", es: "Primeros pasos" },
  'help.section.pages': { en: "Pages and projects", es: "Páginas y proyectos" },
  'help.section.writing': { en: "Writing", es: "Escribir" },
  'help.section.photos': { en: "Photos and videos", es: "Fotos y videos" },
  'help.section.attachments': { en: "Attachments", es: "Archivos adjuntos" },
  'help.section.drive': { en: "Google Drive links", es: "Links de Google Drive" },
  'help.section.comments': { en: "Comments and questions", es: "Comentarios y preguntas" },
  'help.section.find': { en: "Find and replace", es: "Buscar y reemplazar" },
  'help.section.collapse': { en: "Collapsing sections", es: "Colapsar secciones" },
  'help.section.sharing': { en: "Sharing and members", es: "Compartir y miembros" },
  'help.section.trash': { en: "Trash and history", es: "Papelera e historial" },
  'help.section.sync': { en: "Offline and syncing", es: "Sin red y sincronización" },
  'help.section.print': { en: "Sheets, PDF and printing", es: "Hojas, PDF e impresión" },
  'help.section.prefs': { en: "Preferences", es: "Preferencias" },
  'help.section.keys': { en: "Keyboard shortcuts", es: "Atajos de teclado" },
  // Las novedades (entrega 3): arriba de todo, solo cuando hay algo nuevo desde la última vez.
  'help.section.news': { en: "What's new", es: "Novedades" },
  'help.newsIntro': {
    en: "New or changed since you last opened the help.",
    es: "Lo nuevo o cambiado desde la última vez que abriste la ayuda.",
  },
  'help.new': { en: "New", es: "Nuevo" },
  'help.showMe.action': { en: "Show me", es: "Mostrame" },

  // --- Los lugares de la tabla de atajos ---
  'help.place.global': { en: "Anywhere (with a page open)", es: "En toda la app (con una página abierta)" },
  'help.place.editor': { en: "In the editor", es: "En el editor" },
  'help.place.markdown': { en: "Typed at the start of a line", es: "Escrito al principio de un renglón" },
  'help.place.photos': { en: "Photos", es: "Fotos" },
  'help.place.carrete': { en: "Full-screen viewer", es: "Carrete (pantalla completa)" },
  'help.place.annotate': { en: "Annotating a photo", es: "Anotando una foto" },
  'help.place.find': { en: "Find bar", es: "Barra de buscar" },
  'help.place.comments': { en: "Comments", es: "Comentarios" },
  'help.place.tree': { en: "Page tree and sidebar", es: "Árbol de páginas y barra lateral" },
  'help.place.menus': { en: "Menus, lists and dialogs", es: "Menús, listas y diálogos" },
  'help.place.tour': { en: "During the tour", es: "En la recorrida" },

  // --- Primeros pasos ---
  'help.tour.title': { en: "The tour", es: "La recorrida" },
  'help.tour.text': {
    en: "A two-minute walk through the app on a practice page, with Next to move on. Nothing you do there is saved.",
    es: "Una recorrida de dos minutos por la app sobre una página de práctica, que se avanza con Siguiente. Nada de lo que hagas ahí se guarda.",
  },
  'help.tour.action': { en: "Take the tour", es: "Ver la recorrida" },
  'help.practice.title': { en: "Practice page", es: "Página de práctica" },
  'help.practice.text': {
    en: "A sample page you can edit freely: it isn't saved, doesn't sync and nobody else sees it. Opening it again starts it over.",
    es: "Una página de ejemplo para editar libremente: no se guarda, no se sincroniza y no la ve nadie. Abrirla de nuevo la arma de cero.",
  },
  'help.practice.action': { en: "Practice", es: "Practicar" },
  'help.install.title': { en: "Install the app", es: "Instalar la app" },
  'help.install.text': {
    en: "Install app in the account menu (or Install in the banner on your phone) shows the steps for your device: iPhone and iPad, Android or computer. Installed, Shot Docs opens from the home screen in its own window; on iPhone it keeps its own storage, which Safari doesn't clear.",
    es: "Instalar la app, en el menú de la cuenta (o Instalar en el aviso del teléfono), muestra los pasos para tu dispositivo: iPhone y iPad, Android o computadora. Instalada, Shot Docs se abre desde la pantalla de inicio en su propia ventana; en el iPhone guarda sus datos aparte y Safari no los borra.",
  },
  'help.install.action': { en: "Install app", es: "Instalar la app" },
  'help.news.title': { en: "What's new", es: "Novedades" },
  'help.news.text': {
    en: "When the app brings something new, the ? at the bottom of the sidebar shows a dot. Open the help: What's new, at the top, lists what's new or changed since you last looked, and those entries say New. Once you've opened it, the dot goes away until the next new thing. It's remembered on this device.",
    es: "Cuando la app trae algo nuevo, el ? de abajo de la barra lateral muestra un punto. Abrí la ayuda: Novedades, arriba de todo, lista lo nuevo o cambiado desde la última vez que la miraste, y esas entradas dicen Nuevo. Una vez abierta, el punto se va hasta la próxima novedad. Se recuerda en este dispositivo.",
  },
  'help.news.textTouch': {
    en: "When the app brings something new, the ? at the bottom of the page list shows a dot (on a phone, so does the menu button at the top left). Open the help: What's new, at the top, lists what's new or changed since you last looked, and those entries say New. Once you've opened it, the dots go away until the next new thing. It's remembered on this device.",
    es: "Cuando la app trae algo nuevo, el ? de abajo de la lista de páginas muestra un punto (en el teléfono, también el botón de menú de arriba a la izquierda). Abrí la ayuda: Novedades, arriba de todo, lista lo nuevo o cambiado desde la última vez que la miraste, y esas entradas dicen Nuevo. Una vez abierta, los puntos se van hasta la próxima novedad. Se recuerda en este dispositivo.",
  },
  'help.showMe.title': { en: "Show me", es: "Mostrame" },
  'help.showMe.text': {
    en: "Entries with Show me open the practice page and point at that part of the screen, just that step of the tour. Done (or Esc) takes you back where you were. Nothing you do there is saved.",
    es: "Las entradas con Mostrame abren la página de práctica y señalan esa parte de la pantalla, solo ese paso de la recorrida. Listo (o Esc) te devuelve a donde estabas. Nada de lo que hagas ahí se guarda.",
  },
  'help.showMe.textTouch': {
    en: "Entries with Show me open the practice page and point at that part of the screen, just that step of the tour. Done takes you back where you were. Nothing you do there is saved.",
    es: "Las entradas con Mostrame abren la página de práctica y señalan esa parte de la pantalla, solo ese paso de la recorrida. Listo te devuelve a donde estabas. Nada de lo que hagas ahí se guarda.",
  },

  // --- Páginas y proyectos ---
  'help.pagesTree.title': { en: "Pages inside pages", es: "Páginas adentro de páginas" },
  'help.pagesTree.text': {
    en: "Every page can hold text and other pages, as deep as you need; a folder is just a page with no text. + next to Pages creates one; + on a row creates one inside it.",
    es: "Cada página puede tener texto y otras páginas adentro, sin límite; una carpeta es una página sin texto. El + al lado de Páginas crea una; el + de un renglón, una adentro.",
  },
  'help.pagesArrange.title': { en: "Reorder, rename, move", es: "Ordenar, renombrar, mover" },
  'help.pagesArrange.text': {
    en: "Drag a page in the sidebar to reorder it, or drop it on another to put it inside. The ⋯ menu of a page renames it, moves it, sets its sheet size or sends it to the Trash.",
    es: "Arrastrá una página en la barra lateral para ordenarla, o soltala sobre otra para meterla adentro. El menú ⋯ de una página la renombra, la mueve, le da tamaño de hoja o la manda a la papelera.",
  },
  'help.pagesKeys.title': { en: "The page tree with the keyboard", es: "El árbol de páginas con el teclado" },
  'help.pagesKeys.text': {
    en: "With the focus on a row (click it once): {step} open the previous or next page (holding the key, the last one opens when you stop), → expands or goes to the first subpage, ← collapses or goes to the parent, {ends} go to the first or last page.",
    es: "Con el foco en un renglón (un clic lo deja ahí): {step} abren la página anterior o la siguiente (con la tecla apretada, se abre la última al frenar), → despliega o pasa a la primera subpágina, ← pliega o sube a la madre, {ends} van a la primera o la última.",
  },
  'help.pagesTitles.title': { en: "Short titles and the header", es: "Títulos cortos y el encabezado" },
  'help.pagesTitles.text': {
    en: "Titles like 064 | Name | Place show in the sidebar as a code and a name: Short titles in the ⋯ menu turns it on for a page and everything inside. Above the title, a page can show the pages that contain it. A long pasted title keeps its full text until it saves locally; the rest then moves to the page. If saving fails, keep the app open and retry by leaving the title field or pressing Enter.",
    es: "Títulos como 064 | Nombre | Lugar se ven en la barra lateral como un código y un nombre: Títulos cortos, en el menú ⋯, lo prende para una página y todo lo de adentro. Arriba del título, una página puede mostrar las que la contienen. Un título pegado largo conserva el texto completo hasta guardarlo localmente; después, lo que sobra pasa a la página. Si falla el guardado, dejá la app abierta y reintentá al salir del campo o pulsar Enter.",
  },
  'help.templates.title': { en: "Templates", es: "Plantillas" },
  'help.templates.text': {
    en: "A new empty page offers Start from a template: Pre-production Notes (one page per scene), On-Set Report (one per shoot day) or Shot Breakdown (one per VFX shot). More… describes each one and has Preview, to try it without saving anything. Keep writing and the strip goes away. Pick one, type the page name and {enter} takes you to its first field; {undo} takes it all back. Apply template… in the ⋯ menu does the same on any empty page. The page gets a copy in the app's language. Internal — remove before sharing holds bids and vendors: delete that section before sharing the page with a client.",
    es: "Una página nueva vacía ofrece Empezar con una plantilla: Notas de preproducción (una página por escena), Reporte de rodaje (una por día de rodaje) o Desglose de plano (una por plano de VFX). Más… cuenta qué trae cada una y tiene Ver, para probarla sin guardar nada. Si seguís escribiendo, la tira se va. Elegí una, escribí el nombre de la página y {enter} te lleva a su primer dato; {undo} la saca entera. Aplicar plantilla…, en el menú ⋯, hace lo mismo en cualquier página vacía. La página recibe una copia en el idioma de la app. Interno — borrar antes de compartir tiene cotizaciones y proveedores: borrá esa sección antes de compartir la página con un cliente.",
  },
  'help.ownTemplates.title': { en: "Your own templates", es: "Plantillas propias" },
  'help.ownTemplates.text': {
    en: "Save as template… in the ⋯ menu copies a page to the project's Templates folder (it's created the first time), with a name and a description; the page itself doesn't change. Clear filled-in values empties the tables (keeps headers and row labels), unchecks the checkboxes and leaves out photos and files (and with them their annotations). Without it, photos keep their annotations in the template, and new pages made from it get them too. A template is a page: open it and write to change it. New pages get a copy, so pages already made don't change. Above its title, Template settings… has the description and Use for day reports, and Stop using as template turns it back into a normal page. Customize, next to each built-in one in Templates, makes your own copy to change. Templates lists this project's templates and the ones from other projects you can see; one from another project comes without its photos and files, and so without annotations. With Use for day reports, New day report uses it, and lets you pick when there's more than one. Whoever sees the Templates folder sees its templates: share it with your team, not with clients.",
    es: "Guardar como plantilla…, en el menú ⋯, copia una página a la carpeta Plantillas del proyecto (se crea la primera vez), con un nombre y una descripción; la página no cambia. Vaciar lo completado vacía las tablas (deja encabezados y rótulos), desmarca las casillas y no copia fotos ni archivos (ni sus anotaciones). Sin vaciar, las fotos guardan sus anotaciones en la plantilla y las páginas nuevas hechas con ella también las reciben. Una plantilla es una página: abrila y escribí para cambiarla. Las páginas nuevas reciben una copia, así que las ya hechas no cambian. Arriba de su título, Ajustes de la plantilla… tiene la descripción y Usar para reportes del día, y Dejar de usar como plantilla la vuelve una página común. Personalizar, al lado de cada una de fábrica en Plantillas, hace una copia tuya para cambiarla. Plantillas muestra las de este proyecto y las de otros proyectos que ves; una de otro proyecto llega sin sus fotos ni archivos, y por lo tanto sin anotaciones. Con Usar para reportes del día, Nuevo reporte del día la usa, y deja elegir cuando hay más de una. Quien ve la carpeta Plantillas ve sus plantillas: compartila con tu equipo, no con clientes.",
  },
  'help.dayReports.title': { en: "Day reports", es: "Reportes del día" },
  'help.dayReports.text': {
    en: "New day report ({newReport}) is above the title of the day reports folder and of each report inside it. It suggests today's date (your device's time), the next shoot day and the previous report's location: change anything and press Enter. The new page is named like 2026-10-02 | Day 06 and copies the unit, the VFX crew, the director and DP, and the camera package from the previous report. If there's already a report for that date, Enter opens it and Create another makes a second one with the same shoot day (a second unit, a split day). Choosing On-Set Report on a new page inside a folder makes that folder the day reports folder; in the project root it asks for a folder first (create one, with a name you can change, or pick the one you already have) and the page goes inside it; Use for day reports in the ⋯ menu does it by hand, and a project can have several. It all works offline. The shortcut goes by the key's position (where N is on a US keyboard): on Dvorak it's the key that types B.",
    es: "Nuevo reporte del día ({newReport}) está arriba del título de la carpeta de reportes y de cada reporte de adentro. Propone la fecha de hoy (la hora de tu dispositivo), el día de rodaje siguiente y la locación del reporte anterior: cambiá lo que haga falta y apretá Enter. La página nueva se llama como 2026-10-02 | Día 06 y copia del reporte anterior la unidad, la gente de VFX, director y DF, y el equipo de cámara. Si ya hay un reporte con esa fecha, Enter lo abre y Crear otro hace uno más con el mismo día de rodaje (una segunda unidad, un día partido). Elegir Reporte de rodaje en una página nueva adentro de una carpeta la vuelve la carpeta de reportes; en la raíz del proyecto pide una carpeta antes (crear una, con un nombre que podés cambiar, o elegir la que ya tenés) y la página queda adentro; Usar para reportes del día, en el menú ⋯, lo hace a mano, y un proyecto puede tener varias. Todo anda sin conexión. El atajo va por la posición de la tecla (donde está la N en un teclado de EE. UU.): en Dvorak es la tecla que escribe B.",
  },
  'help.title.title': { en: "The page title", es: "El título de la página" },
  'help.title.text': {
    en: "{enter} in the title moves you to the text. A title can be up to 500 characters: if you paste a longer text, the rest becomes the first paragraph of the page.",
    es: "{enter} en el título te pasa al texto. Un título puede tener hasta 500 caracteres: si pegás un texto más largo, lo que sobra queda como primer párrafo de la página.",
  },
  'help.projects.title': { en: "Projects", es: "Proyectos" },
  'help.projects.text': {
    en: "Each show or job is a project with its own page tree. Switch projects or create one from the top of the sidebar; {search} lists them too.",
    es: "Cada serie o trabajo es un proyecto con su propio árbol de páginas. Cambiá de proyecto o creá uno desde arriba de la barra lateral; {search} también los muestra.",
  },
  'help.projectsArchive.title': { en: "Archive and delete projects", es: "Archivar y borrar proyectos" },
  'help.projectsArchive.text': {
    en: "Hover a project in the list (on a phone, tap its ⋯) to rename, archive or delete it. An archived project leaves the everyday list but can still be opened and edited. Deleting asks you to type delete and moves it to the Trash: nobody sees it, and Restore brings it back exactly as it was.",
    es: "Pasá el mouse por un proyecto de la lista (en el teléfono, tocá su ⋯) para renombrarlo, archivarlo o borrarlo. Un archivado sale de la lista de todos los días pero se sigue abriendo y editando. Borrar pide escribir borrar y lo pasa a la papelera: nadie lo ve, y Restaurar lo deja tal como estaba.",
  },
  'help.projectsDrive.title': { en: "Its files in Google Drive", es: "Sus archivos en Google Drive" },
  'help.projectsDrive.text': {
    en: "When the workspace owner or an admin deletes a project, Also send its files to the Google Drive trash sends its whole folder to the Drive trash; it starts unticked. Google deletes it for good after 30 days; Restore before that brings the folder back with everything in it. From the Trash you can also send it later. If Google Drive no longer has the folder, the app asks before restoring the pages without their files, and Look for its files again, on the project's start page, brings them back if the folder turns up.",
    es: "Cuando el dueño del workspace o un admin borra un proyecto, Mandar también sus archivos a la papelera de Google Drive manda su carpeta entera a la papelera de Drive; arranca destildada. Google la borra para siempre a los 30 días; Restaurar antes la trae de vuelta con todo lo de adentro. Desde la papelera también se puede mandar después. Si Google Drive ya no tiene la carpeta, la app pregunta antes de restaurar las páginas sin sus archivos, y Buscar sus archivos de nuevo, en el inicio del proyecto, los trae si la carpeta aparece.",
  },
  'help.projectsPurge.title': { en: "Delete a project forever", es: "Borrar un proyecto para siempre" },
  'help.projectsPurge.text': {
    en: "30 days after a project was deleted, the workspace owner or an admin who manages it can choose Delete forever… on its row in the Trash and type delete. It leaves the Trash and can no longer be restored from the app; if its folder is not in the Google Drive trash yet, it goes there first (Google deletes it for good after 30 days). Before those 30 days, Restore always brings it back exactly as it was. Files that never reached Drive stop counting toward the project size after Delete forever; files in the Drive trash keep counting there for 30 days.",
    es: "A los 30 días de borrado un proyecto, el dueño del workspace o un admin que lo maneja puede elegir Borrar para siempre… en su renglón de la papelera y escribir borrar. Sale de la papelera y ya no se puede restaurar desde la app; si su carpeta todavía no está en la papelera de Google Drive, va primero ahí (Google la borra para siempre a los 30 días). Antes de esos 30 días, Restaurar siempre lo deja tal como estaba. Después de Borrar para siempre, los archivos que nunca llegaron a Drive dejan de sumar en el peso del proyecto; los de la papelera de Drive siguen sumando ahí durante 30 días.",
  },
  'help.workspaces.title': { en: "Workspaces", es: "Workspaces" },
  'help.workspaces.text': {
    en: "The app can connect to several workspaces. Each one is an island on its owner's own servers and Google Drive: nothing goes from one to another. Switch workspaces from the project list.",
    es: "La app se puede conectar a varios workspaces. Cada uno es una isla en los servidores y el Google Drive de su dueño: nada pasa de uno a otro. Cambiá de workspace desde la lista de proyectos.",
  },

  // --- Escribir ---
  'help.slash.title': { en: "The / menu", es: "El menú /" },
  'help.slash.text': {
    en: "Type / on an empty line to add headings, lists, checklists, a table, a quote, code, a divider, an image, Script, a question or a page break. Keep typing to filter; ↑ ↓ and Enter pick, Esc closes. Heading choices run from H1 to H5 in gradual steps; H5 matches normal bold text. Existing H6 headings keep their content and look like H5.",
    es: "Escribí / en un renglón vacío para sumar títulos, listas, casillas, una tabla, una cita, código, un divisor, una foto, Script, una pregunta o un salto de hoja. Seguí escribiendo para filtrar; ↑ ↓ y Enter eligen, Esc cierra. Los encabezados del menú van de H1 a H5 en pasos graduales; H5 se ve como el texto normal en negrita. Los H6 existentes conservan su contenido y se ven como H5.",
  },
  'help.blocks.title': { en: "Moving blocks", es: "Mover bloques" },
  'help.blocks.text': {
    en: "Each block has a handle on its left: drag it to move the block, click it to select the block and open its bar. {up} and {down} move it with the keyboard; {indent} and {outdent} nest it.",
    es: "Cada bloque tiene un tirador a su izquierda: arrastralo para mover el bloque, o hacé clic para elegirlo y abrir su barra. {up} y {down} lo mueven con el teclado; {indent} y {outdent} lo meten o lo sacan un nivel.",
  },
  'help.pageLinks.title': { en: "Page links and workspaces", es: "Links de páginas y workspaces" },
  'help.pageLinks.text': {
    en: "Use the browser’s Copy link address or Open link in new tab on a page link in the editor to keep its workspace. An ordinary click opens a page here, or waits for local saving before opening another workspace. If saving fails, the page stays open for another attempt. In a public link, old links to pages in that workspace keep its access only if they have no explicit workspace or existing fragment. Copying selected formatted text, dragging links and old public page links with fragments still need work.",
    es: "Usá Copiar dirección del enlace o Abrir enlace en una pestaña nueva del navegador sobre un link de página del editor para conservar su workspace. Un clic normal abre la página acá, o espera el guardado local antes de abrir otro workspace. Si falla el guardado, la página queda abierta para reintentar. En un link público, los links antiguos de páginas de ese workspace conservan su acceso sólo si no indican un workspace ni un fragmento previo. Copiar texto seleccionado con formato, arrastrar links y los links públicos antiguos con fragmentos siguen pendientes.",
  },
  'help.format.title': { en: "Formatting text", es: "Dar formato al texto" },
  'help.format.text': {
    en: "Select text to get the formatting bar: bold, italic, colors, links. {bold} bold, {italic} italic, {underline} underline, {strike} strikethrough, {code} code, {link} link.",
    es: "Elegí texto y aparece la barra de formato: negrita, cursiva, colores, links. {bold} negrita, {italic} cursiva, {underline} subrayado, {strike} tachado, {code} código, {link} link.",
  },
  'help.tablePhone.title': { en: "Wide tables on a phone or tablet", es: "Tablas anchas en el teléfono o la tablet" },
  'help.tablePhone.text': {
    en: "On a narrow screen (a phone, or a tablet held upright) a table keeps its column widths and scrolls sideways inside its block: swipe it left or right. The page itself doesn't move, and when you jump to another cell with Tab or the arrows it slides into view. On a computer and in the PDF nothing changes (a tablet gets the same as a phone, except on a page with a sheet size like A4).",
    es: "En una pantalla angosta (un teléfono, o una tablet vertical) la tabla mantiene el ancho de sus columnas y se desplaza de costado dentro de su bloque: deslizala a la izquierda o a la derecha. La página no se mueve, y al pasar a otra celda con Tab o las flechas, la celda se acomoda a la vista. En la compu y en el PDF no cambia nada (una tablet recibe lo mismo que el teléfono, salvo en una página con tamaño de hoja, como A4).",
  },
  'help.blockTypes.title': { en: "Headings, lists and quotes", es: "Títulos, listas y citas" },
  'help.blockTypes.text': {
    en: "{heading} heading 1 to 5, {paragraph} normal text, {quote} quote, {numbered} numbered list, {bullet} bulleted list, {checklist} checklist, {toggle} toggle list.",
    es: "{heading} título 1 a 5, {paragraph} texto común, {quote} cita, {numbered} lista numerada, {bullet} lista con viñetas, {checklist} lista de casillas, {toggle} lista plegable.",
  },
  'help.markdown.title': { en: "Typing shortcuts", es: "Atajos al escribir" },
  'help.markdown.text': {
    en: "At the start of a line: # (to #####) and a space make a heading, - a bulleted list, 1. a numbered list, [] a checklist, > a quote, --- a divider and ``` a code block.",
    es: "Al principio de un renglón: # (hasta #####) y un espacio hacen un título, - una lista con viñetas, 1. una numerada, [] una de casillas, > una cita, --- un divisor y ``` un bloque de código.",
  },
  'help.script.title': { en: "Script", es: "Script (guion)" },
  'help.script.text': {
    en: "Script is text in a screenplay typeface ({script}, or / Script). INT/EXT, DAY, NIGHT and DAWN/DUSK are marked in color. Enter keeps writing Script; on an empty line it goes back to normal text.",
    es: "Script es texto con la tipografía de los guiones ({script}, o / Guion). INT/EXT, DÍA, NOCHE y AMANECER/ATARDECER se marcan con color. Enter sigue en Script; en un renglón vacío vuelve al texto común.",
  },
  'help.undo.title': { en: "Undo", es: "Deshacer" },
  'help.undo.text': {
    en: "{undo} undoes, {redo} redoes, in the order you edited across the whole project: if your last change was on another page, the app takes you there and undoes it in view (Back returns you). A replace in the whole project is one step: {undo} undoes it in every page it changed, without moving you, and {redo} does it again. If a page was in the trash during undo, restore it before your next undo: its replacement is undone first, then the earlier edits. Annotating a photo is one step too: everything you did in the annotator that time, undone at once with the photo in view. It keeps working after you switch pages, until you reload. Deleting blocks, a section or the whole page is always a single undo step. Renaming, moving or trashing pages isn't undone this way.",
    es: "{undo} deshace, {redo} rehace, en el orden en que editaste en todo el proyecto: si lo último fue en otra página, la app te lleva y lo deshace a la vista (Volver te devuelve). Un reemplazo en todo el proyecto es un solo paso: {undo} lo deshace en todas las páginas que cambió, sin moverte, y {redo} lo vuelve a hacer. Si una página estaba en la papelera al deshacer, restaurala antes del próximo deshacer: primero se deshace su reemplazo, y después lo escrito antes. Anotar una foto también es un solo paso: todo lo que hiciste en el anotador esa vez, deshecho junto con la foto a la vista. Sigue andando después de cambiar de página, hasta que recargues. Borrar bloques, una sección o la página entera es siempre un solo paso de deshacer. Renombrar, mover o mandar páginas a la papelera no se deshace así.",
  },

  // --- Fotos y videos ---
  'help.photosAdd.title': { en: "Adding photos and videos", es: "Sumar fotos y videos" },
  'help.photosAdd.text': {
    en: "Paste them ({paste}), drop them or choose them with / Image: they go into the line, where the cursor is or where you drop them (one at its own size, several at a third each); other files go below as a card. With Google Drive connected they're stored in the workspace owner's Drive (videos too). iPhone photos (HEIC) are saved as JPEG. Older HEIC photos still queued on this device are also prepared as JPEG before their upload starts. A photo already registered as HEIC keeps its original format. The original stays protected while its registration is being checked.",
    es: "Pegalas ({paste}), soltalas o elegilas con / Imagen: entran en el renglón, donde está el cursor o donde las soltás (una con su tamaño, varias a un tercio cada una); los demás archivos van abajo, como tarjeta. Con Google Drive conectado se guardan en el Drive del dueño del workspace (también los videos). Las fotos del iPhone (HEIC) se guardan como JPEG. Las fotos HEIC antiguas que siguen pendientes en este dispositivo también se preparan como JPEG antes de iniciar su subida. Una foto ya registrada como HEIC conserva su formato original. El original queda protegido mientras se comprueba su registro.",
  },
  'help.photosInline.title': { en: "Photos in the line, like letters", es: "Fotos en el renglón, como letras" },
  'help.photosReplaceBlock.title': { en: 'Replacing a photo', es: 'Reemplazar una foto' },
  'help.photosReplaceBlock.text': {
    en: 'Select one photo block, a photo in a row, an inline photo or a table photo and choose Replace image. For an annotated Drive photo on an editable workspace page, Keep annotations? offers Yes when the new image has exactly the same proportions after orientation. Yes copies the complete drawings to the new photo; No replaces without copying. If its proportions or annotation data cannot be checked, only Replace without annotations and Cancel are offered. Cancel or Escape leaves the current photo unchanged, also while preparing or saving; a new file already saved stays on the device. Replacing and copying form one undo step. The original file and its drawings stay intact, including another appearance of it on the page. Changing the selected photo, source, page, session or permission cancels this annotated attempt. Your latest file choice takes priority even if an older save finishes later, and a failed or canceled new attempt never revives the older one. Canceling the file picker without choosing a file leaves an earlier choice in progress. Unannotated photos keep the direct replacement flow.',
    es: 'Elegí una sola foto de bloque, en fila, en línea o en una tabla y tocá Reemplazar imagen. Para una foto del Drive anotada en una página editable del workspace, ¿Conservar las anotaciones? ofrece Sí cuando la imagen nueva tiene exactamente la misma proporción después de orientarla. Sí copia todos los dibujos a la foto nueva; No reemplaza sin copiarlos. Si no se pueden comprobar la proporción o los datos anotados, solo aparecen Reemplazar sin anotaciones y Cancelar. Cancelar o Escape deja intacta la foto actual, también mientras prepara o guarda; un archivo nuevo ya guardado queda en el dispositivo. Reemplazar y copiar forman un solo paso de deshacer. El archivo original y sus dibujos quedan intactos, incluida otra aparición suya en la página. Cambiar la foto elegida, fuente, página, sesión o permiso cancela este intento anotado. Vale el último archivo elegido aunque una subida anterior termine después; un intento nuevo fallido o cancelado nunca revive el anterior. Cancelar el selector sin elegir archivo conserva una elección anterior pendiente. Las fotos sin anotaciones conservan el reemplazo directo.',
  },
  'help.photosInline.text': {
    en: "A photo sits in the line like a letter: write next to it, before or after. Select several (and text) with Shift+click, {select} or by dragging. With photos selected, a letter or Enter writes after them (never replacing them), Space opens the first one full screen and {delete} deletes them.",
    es: "Una foto va en el renglón como una letra: escribí al lado, antes o después. Elegí varias (y texto) con Shift+clic, {select} o arrastrando. Con fotos elegidas, una letra o Enter escriben después (nunca las reemplazan), Espacio abre la primera en grande y {delete} las borra.",
  },
  'help.photosOpen.title': { en: "Select and open", es: "Elegir y abrir" },
  'help.photosOpen.text': {
    en: "One click selects a photo (its bar and handles); a second click or a double click opens it full screen. With the keyboard, {open} opens the selected one.",
    es: "Un clic elige la foto (su barra y sus tiradores); un segundo clic, o un doble clic, la abre en pantalla completa. Con el teclado, {open} abre la elegida.",
  },
  'help.photosRows.title': { en: "Sizes, rows and the photo bar", es: "Tamaños, filas y la barra de la foto" },
  'help.photosRows.text': {
    en: "Drag a photo's handles to resize it: they snap to the full width, 1/2, 1/3 and 1/4. Its bar (the same for every photo) has view, download, quick sizes for all the selected photos, Arrange in rows for the selected ones, align the line, comment, replace, rename and delete. In the PDF a line of photos breaks between sheets by rows. In an older row of photo blocks, {next} and {prev} go from photo to photo, {leave} leave the row and {enter} adds a line after it.",
    es: "Arrastrá los tiradores de una foto para cambiarle el tamaño: imantan al ancho entero, 1/2, 1/3 y 1/4. Su barra (la misma para todas las fotos) tiene ver, bajar, tamaños rápidos para todas las elegidas, Acomodar en filas de las elegidas, alinear el renglón, comentar, reemplazar, renombrar y borrar. En el PDF, un renglón de fotos se parte entre hojas por filas. En una fila vieja de fotos-bloque, {next} y {prev} van de una foto a otra, {leave} salen de la fila y {enter} suma un renglón después.",
  },
  'help.photosCells.title': { en: "Photos in a table", es: "Fotos en una tabla" },
  'help.photosCells.text': {
    en: "Paste, drop or choose photos with the cursor in a table cell and they go into that cell, as thumbnails as tall as a row, side by side. Their bar has Thumbnail and Full cell width, and their handles make them bigger inside the cell: for more, widen the column. They open full screen like any photo and come out the same in the PDF.",
    es: "Pegá, soltá o elegí fotos con el cursor en una celda de una tabla y entran en esa celda, como miniaturas del alto de una fila, una al lado de la otra. Su barra tiene Miniatura y Todo el ancho de la celda, y sus tiradores las agrandan dentro de la celda: para más, ensanchá la columna. Se abren en grande como cualquier foto y salen iguales en el PDF.",
  },
  'help.photosCellsSize.title': { en: "Thumbnail size in a table", es: "El tamaño de las miniaturas de una tabla" },
  'help.photosCellsSize.text': {
    en: "Each table has its own thumbnail size: Small, Medium (the default) or Large. Pick it with Thumbnail size in the bar of a photo in the table, or click the table's dots. It changes every thumbnail of that table; photos you made bigger keep their size. The PDF shows them the same size.",
    es: "Cada tabla tiene su tamaño de miniaturas: Chico, Mediano (el de fábrica) o Grande. Se elige con Tamaño de las miniaturas en la barra de una foto de la tabla, o con un clic en los puntos de la tabla. Cambia todas las miniaturas de esa tabla; las fotos que agrandaste mantienen su tamaño. El PDF las muestra del mismo tamaño.",
  },
  'help.photosDownloadAnnotated.title': { en: 'Download a photo with annotations', es: 'Bajar una foto con anotaciones' },
  'help.photosDownloadAnnotated.text': {
    en: 'On an editable workspace page, select one annotated Drive photo and use its Download button. This works for a photo block, a row, an inline photo or a table cell. Choose Original to keep the unchanged file, or Download → With annotations to prepare a full-size copy. The next Download saves it. Close or Escape cancels preparation. Changing the selected photo, page, workspace, session or permission discards the prepared result. Original and Close remain available while the annotated controls load, and if those controls fail. In the full-screen viewer, Download → With annotations prepares a local JPEG or PNG copy with this page’s drawings, then Download saves it at the full original dimensions. The original never changes. On phones, the menu stays inside the screen and shows the full file name and dimensions; scroll the menu if its buttons are below. Hide annotations only affects the viewer: this download includes the drawings. It works offline if the full original is on this device. Simple static WebP originals are saved as PNG, with the resulting filename and full dimensions shown before Download. Animated WebP and WebP with metadata are rejected without flattening; Original keeps every byte. HEIC and other formats are not supported yet; a photo too large for this device (including 48 MP on phones) cannot be prepared, and Original stays available. No smaller copy is made automatically. This option is available to anyone who can see the page in a workspace; it is not yet available through a public link.',
    es: 'En una página editable del workspace, elegí una sola foto del Drive anotada y tocá su botón Descargar. Vale para una foto de bloque, en fila, en línea o en una celda. Elegí Original para conservar el archivo intacto, o Descargar → Con anotaciones para preparar una copia de tamaño completo. El siguiente Descargar la guarda. Cerrar o Escape cancela la preparación. Cambiar la foto elegida, página, workspace, sesión o permiso descarta el resultado preparado. Original y Cerrar siguen disponibles mientras cargan los controles anotados y si esa carga falla. En el carrete, Descargar → Con anotaciones prepara una copia local JPEG o PNG con los dibujos de esta página; después Descargar la guarda con las medidas completas del original. El original nunca cambia. En el teléfono, el menú queda dentro de la pantalla y muestra el nombre completo y las dimensiones; desplazá el menú si sus botones quedan más abajo. Ocultar anotaciones solo afecta el carrete: esta descarga incluye los dibujos. Funciona sin conexión si el original completo está en este dispositivo. Los originales WebP estáticos simples se guardan como PNG, mostrando el nombre y las medidas completas antes de Descargar. WebP animado o con metadatos se rechaza sin aplanar; Original conserva todos sus bytes. HEIC y otros formatos todavía no están disponibles; una foto demasiado grande para este dispositivo (incluidas las de 48 MP en teléfonos) no se puede preparar y sigue disponible Original. No se hace una copia más chica automáticamente. La opción está disponible para quien puede ver la página en un workspace; todavía no desde un link público.',
  },
  'help.photosCopyAnnotated.title': { en: 'Copy a photo with annotations', es: 'Copiar una foto con anotaciones' },
  'help.photosCopyAnnotated.text': {
    en: 'On an editable workspace page, select one annotated Drive photo and use its Download button, then choose Copy → Copy with annotations. When the full-size PNG is ready, tap Copy to send it to the clipboard. In the photo viewer, choose Copy with annotations to prepare a full-size PNG from a JPEG, PNG or simple static WebP original, then tap Copy. Animated WebP and WebP with metadata are rejected; Original keeps the unchanged file. The browser must allow image copying. Original still downloads the unchanged file. On phones, the menu shows the full file name and dimensions inside the screen; scroll it to reach the remaining buttons. Changing the photo or its annotations before Copy discards the prepared image. Close cancels preparation; after Copy starts, the browser cannot undo that clipboard write. Offline, the original must already be on your device. Public links, HEIC and photos beyond this device’s limits are not supported yet. If preparation fails, download Original. Other apps decide how they paste the copied image.',
    es: 'En una página editable del workspace, elegí una sola foto del Drive anotada y tocá Descargar, después Copiar → Copiar con anotaciones. Cuando el PNG completo esté listo, tocá Copiar para enviarlo al portapapeles. En el carrete, elegí Copiar con anotaciones para preparar un PNG al tamaño completo desde un original JPEG, PNG o WebP estático simple y después tocá Copiar. WebP animado o con metadatos se rechaza; Original conserva el archivo intacto. El navegador debe permitir copiar imágenes. Original sigue bajando el archivo intacto. En el teléfono, el menú muestra el nombre completo y las dimensiones dentro de la pantalla; desplazalo para llegar a los botones que quedan más abajo. Cambiar la foto o sus anotaciones antes de Copiar descarta la imagen preparada. Cerrar cancela la preparación; después de empezar Copiar, el navegador no puede deshacer esa escritura al portapapeles. Sin red, el original debe estar en el dispositivo. Los links públicos, HEIC y las fotos que exceden los límites del dispositivo todavía no están admitidos. Si falla la preparación, bajá Original. Cada otra app decide cómo pega la imagen copiada.',
  },
  'help.carrete.title': { en: "The full-screen viewer", es: "El carrete" },
  'help.carrete.text': {
    en: "Shows every photo, video and file of the page: {prev} {next} to go through them, {ends} to jump to the first or last, scroll or double-click to zoom, {close} to close. Download gets the original.",
    es: "Muestra todas las fotos, los videos y los archivos de la página: {prev} {next} para recorrerlos, {ends} para ir al primero o al último, la rueda o un doble clic para el zoom, {close} para cerrar. Descargar baja el original.",
  },
  'help.photosMarkup.title': { en: "Annotations on photos", es: "Anotaciones sobre las fotos" },
  'help.photosMarkup.text': {
    en: "A photo can carry annotations drawn on top (arrows, circles, text, numbers, freehand strokes): they show on the page, in a table cell, in the full-screen viewer and in the PDF, and the original never changes. In the viewer, Hide annotations shows the clean photo just for you (nothing is saved). The same photo twice on a page shares its annotations; on another page it shows clean, unless you copy and paste it there.",
    es: "Una foto puede llevar anotaciones dibujadas encima (flechas, círculos, texto, números, trazos a mano): se ven en la página, en una celda de una tabla, en el carrete y en el PDF, y el original nunca cambia. En el carrete, Ocultar anotaciones muestra la foto limpia solo para vos (no se guarda nada). La misma foto dos veces en una página comparte sus anotaciones; en otra página sale limpia, salvo que la copies y la pegues ahí.",
  },
  'help.photosAnnotate.title': { en: "Annotate a photo", es: "Anotar una foto" },
  'help.photosAnnotate.text': {
    en: "If you can edit the page, select a photo from Drive and choose Annotate in its bar, or press {viewer} in the full-screen viewer. The tools and their letters are the ones in LGA FrameRev: V Select, R Rectangle, E Ellipse, A Arrow, L Line, P Pencil, M Marker, T Text, N Number. Shift draws a square, a circle or 45° lines; Alt (⌥ on the Mac) draws from the center. {width} make the selected shape under the pointer (or the next one) thinner or thicker, {next} always the next one; thickness counts pixels with the photo's long side at 1920. Each tool remembers its color and thickness on this device. Every shape is saved as you release it, also offline. If the system interrupts a developed drawing, its last accepted points are saved; Undo removes it. During a drawing, {close} discards the unfinished drawing and keeps the annotator open; {undo} only undoes what you did on this photo; once you close the annotator, {pageUndo} on the page undoes everything you did that time in one step. {close} deselects, and with nothing selected closes. Whoever has the page open sees each shape appear. If you take an annotated photo out of the page, its annotations are cleared after 10 minutes with the page open (bringing the photo back later shows it clean).",
    es: "Si podés editar la página, elegí una foto del Drive y tocá Anotar en su barra, o apretá {viewer} en el carrete. Las herramientas y sus letras son las de LGA FrameRev: V Elegir, R Rectángulo, E Elipse, A Flecha, L Línea, P Lápiz, M Marcador, T Texto, N Número. Shift dibuja un cuadrado, un círculo o líneas a 45°; Alt (⌥ en la Mac) dibuja desde el centro. {width} hacen más fina o más gruesa la forma elegida bajo el cursor (o la próxima), {next} siempre la próxima; el grosor cuenta píxeles con el lado largo de la foto a 1920. Cada herramienta recuerda su color y su grosor en este dispositivo. Cada forma se guarda apenas la soltás, también sin conexión. Si el sistema interrumpe un dibujo desarrollado, se guardan sus últimos puntos aceptados; Deshacer lo retira. Durante el dibujo, {close} descarta lo inconcluso y deja abierto el anotador; {undo} deshace solo lo que hiciste en esta foto; al cerrar el anotador, {pageUndo} en la página deshace todo lo de esa vez en un solo paso. {close} deja de elegir, y sin nada elegido cierra. Quien tiene la página abierta ve aparecer cada forma. Si sacás una foto anotada de la página, sus anotaciones se borran a los 10 minutos con la página abierta (si después la foto vuelve, vuelve limpia).",
  },
  'help.photosAnnotateTouch.title': { en: "Annotate with your finger or a pencil", es: "Anotar con el dedo o con un lápiz" },
  'help.photosAnnotateTouch.text': {
    en: "On the phone and the iPad, open the photo full size and tap Annotate. The tools are in the strip at the bottom (swipe it if they don't fit). The selected tool stays visible when opening, choosing a tool or resizing the window; the color dot opens a sheet with the colors, thickness and opacity, and tapping the photo closes it. One finger draws; two fingers zoom and move the photo and never draw. With Select, one finger picks and moves a shape; tap a text or a number twice to change it. With Text, tap the photo and type in the box at the top: OK finishes it. With a pencil (Apple Pencil on the iPad), once you use it only the pencil draws and your finger moves the photo, like in Notes; Only the pencil draws, in the sheet, turns it off. It also works offline: everything goes up when the connection is back.",
    es: "En el teléfono y el iPad, abrí la foto en grande y tocá Anotar. Las herramientas están en la tira de abajo (deslizala si no entran). La herramienta elegida queda a la vista al abrir, elegir otra o cambiar el ancho de la ventana; el punto de color abre una hoja con los colores, el grosor y la opacidad, y tocar la foto la cierra. Un dedo dibuja; dos dedos amplían y mueven la foto y nunca dibujan. Con Elegir, un dedo elige y mueve una forma; dos toques en un texto o un número lo cambian. Con Texto, tocá la foto y escribí en la caja de arriba: OK lo termina. Con un lápiz (el Apple Pencil en el iPad), apenas lo usás solo dibuja el lápiz y el dedo mueve la foto, como en Notas; Solo dibuja el lápiz, en la hoja, lo apaga. También anda sin conexión: todo sube cuando vuelve.",
  },
  'help.photosAnnotateCopy.title': { en: "Copy a photo with its annotations", es: "Copiar una foto con sus anotaciones" },
  'help.photosAnnotateCopy.text': {
    en: "Copy or cut an annotated photo, alone or with the text around it, and paste it with {paste} on another page of the same project: its annotations come along, also into another window of the app. Pasting it again, or on the same page, doesn't repeat them, and {undo} right after pasting takes out the photo together with its annotations. On a page of another project the photo arrives without them. The annotations never go to the clipboard: pasted outside the app, you get the same as before.",
    es: "Copiá o cortá una foto anotada, sola o con el texto de alrededor, y pegala con {paste} en otra página del mismo proyecto: sus anotaciones van con ella, también a otra ventana de la app. Pegarla otra vez, o en la misma página, no las repite, y {undo} justo después de pegar saca la foto junto con sus anotaciones. En una página de otro proyecto la foto llega sin ellas. Las anotaciones nunca van al portapapeles: pegada afuera de la app, sale lo mismo que antes.",
  },
  'help.photosPhone.title': { en: "On the phone", es: "En el teléfono" },
  'help.photosPhone.text': {
    en: "Tap a photo to see it full size; back on the page, tap it again for its bar and handles. Photos in a row can show side by side or one under the other: Images in a row, in the account menu.",
    es: "Tocá una foto para verla en grande; de vuelta en la página, tocala otra vez y aparecen su barra y sus tiradores. Las fotos en fila se pueden ver una al lado de la otra o apiladas: Fotos en fila, en el menú de la cuenta.",
  },
  'help.photosCamera.title': { en: "Take a photo or record a video", es: "Sacar una foto o filmar" },
  'help.photosCamera.text': {
    en: "On the phone, type / and choose Take photo or Record video, or use the page menu (•••). These actions are available only on phones; computers and tablets can still add existing photos and videos. If your phone hides its identity with Request Desktop Site, switch back to the mobile site to see the camera actions. The camera opens and what you shoot goes in the line, at the cursor (from the page menu without a cursor, at the end of the page), and uploads like any photo. To keep a copy on the phone, select the photo or video and tap Save to camera roll, then Save Image or Save Video in the share sheet. Videos need the workspace's Drive.",
    es: "En el teléfono, escribí / y elegí Sacar una foto o Filmar un video, o usá el menú de la página (•••). Estas acciones se ofrecen solo en teléfonos; las computadoras y las tabletas siguen pudiendo agregar fotos y videos existentes. Si el teléfono oculta su identidad con Sitio de escritorio, volvé al sitio móvil para ver las acciones de cámara. Se abre la cámara y lo que saques va en el renglón, donde está el cursor (desde el menú de la página sin cursor, al final de la página), y sube como cualquier foto. Para guardar una copia en el teléfono, elegí la foto o el video y tocá Guardar en Fotos, y después Guardar imagen o Guardar video en la hoja de compartir. Los videos necesitan el Drive del workspace.",
  },
  'help.photosOffline.title': { en: "Without a connection", es: "Sin conexión" },
  'help.photosOffline.text': {
    en: "Photos added offline are saved on this device and upload by themselves when you're back online; the page shows them right away.",
    es: "Las fotos que agregás sin red quedan guardadas en este dispositivo y se suben solas cuando vuelve la conexión; la página las muestra enseguida.",
  },

  // --- Adjuntos ---
  'help.driveConnect.title': { en: "Connect Google Drive", es: "Conectar Google Drive" },
  'help.driveConnect.text': {
    en: "Photos, videos and files added to pages are stored in the workspace owner's Google Drive. In the account menu, Google Drive (only the owner sees it) connects it and shows whether it's connected and with which account, Reconnect if Google asks again, where the LGA_ShotDocs folder is (Choose folder… moves it with everything inside; Use My Drive root brings it back) and how much the app's files take up in Drive.",
    es: "Las fotos, los videos y los archivos que se agregan a las páginas se guardan en el Google Drive del dueño del workspace. En el menú de la cuenta, Google Drive (solo lo ve el dueño) lo conecta y muestra si está conectado y con qué cuenta, Volver a conectar si Google lo pide de nuevo, dónde está la carpeta LGA_ShotDocs (Elegir carpeta… la mueve con todo lo que tiene; Usar la raíz de Mi unidad la vuelve a poner ahí) y cuánto ocupan en Drive los archivos de la app.",
  },
  'help.attach.title': { en: "Any file", es: "Cualquier archivo" },
  'help.attach.text': {
    en: "Drop or paste any file (a PDF, a zip, a sound) and it shows as a card with its icon; a PDF shows its first page. A second click opens or downloads it; on a phone, a sheet offers Open, Download and Share. In the full-screen viewer, files appear large among the photos, with Open and Download. Previews you've already seen also show offline.",
    es: "Soltá o pegá cualquier archivo (un PDF, un zip, un sonido) y queda como una tarjeta con su ícono; un PDF muestra su primera página. Un segundo clic lo abre o lo baja; en el teléfono, una hoja ofrece Abrir, Descargar y Compartir. En el carrete de fotos, los archivos aparecen en grande entre las fotos, con Abrir y Descargar. Las vistas previas que ya viste se ven también sin conexión.",
  },

  'help.folderDrop.title': { en: "Drop a folder", es: "Soltar una carpeta" },
  'help.folderDrop.text': {
    en: "Drag a folder from your computer onto the page. A window shows what goes up: how many files, in how many folders, how much it weighs, and what is skipped (hidden and system files, unless you tick Include hidden files). Upload sends it to the owner's Google Drive and leaves a folder card in the page. Keep the tab open until it finishes.",
    es: "Arrastrá una carpeta de tu computadora a la página. Una ventana muestra qué se sube: cuántos archivos, en cuántas carpetas, cuánto pesa y qué se saltea (los archivos ocultos y del sistema, salvo que tildes Incluir archivos ocultos). Subir la manda al Google Drive del dueño y deja una tarjeta de carpeta en la página. Dejá la pestaña abierta hasta que termine.",
  },
  'help.folderUpload.title': { en: "While it uploads", es: "Mientras sube" },
  'help.folderUpload.text': {
    en: "The card says how it is going; click it to see the upload: Pause, Resume, Retry for the files that failed. If you close the tab, drop the same folder on its card again (or Choose the folder…): only what is missing goes up. Dropping the same folder elsewhere in the page offers to continue it. Stop uploading forgets it on this device (what reached Drive stays). If the media server or the connection stops answering, it waits a moment and tries again (sooner when the connection comes back); no file fails because of that.",
    es: "La tarjeta dice cómo va; un clic muestra la subida: Pausar, Seguir, Reintentar los archivos que fallaron. Si cerrás la pestaña, soltá la misma carpeta otra vez en su tarjeta (o Elegir la carpeta…): sube solo lo que falta. Soltar la misma carpeta en otro lugar de la página ofrece seguirla. Dejar de subir la olvida en este dispositivo (lo que llegó a Drive queda). Si el servidor de archivos o la conexión dejan de contestar, espera un momento y vuelve a probar (antes, si vuelve la conexión); ningún archivo falla por eso.",
  },
  'help.folderOpen.title': { en: "Open a folder", es: "Abrir una carpeta" },
  'help.folderOpen.text': {
    en: "Click the card twice (once on the phone or without edit access), press {open} with it selected, or Open in its bar. You see what is in the Drive folder right now: subfolders first, then files with their thumbnail. Use List or Grid to change the view; your choice is remembered on this device. A photo or a video opens in the viewer; a PDF opens in a new tab; the rest downloads. {up} goes up one level.",
    es: "Dos clics en la tarjeta (uno en el teléfono o sin permiso de editar), {open} con la tarjeta elegida, o Abrir en su barra. Ves lo que hay ahora en la carpeta de Drive: primero las subcarpetas, después los archivos con su miniatura. Usá Lista o Cuadrícula para cambiar la vista; se recuerda en este dispositivo. Una foto o un video se abren en el carrete; un PDF, en otra pestaña; lo demás se baja. {up} sube un nivel.",
  },
  'help.folderDownload.title': { en: "Download a whole folder", es: "Bajar una carpeta entera" },
  'help.folderDownload.text': {
    en: "Download all, in the folder viewer or in the card's bar, saves everything inside with its subfolders. In Chrome and Edge on a computer you choose where the .zip goes, or Download to a folder… writes the files as they are. Firefox, Safari and phones build the zip in memory: up to 1 GB (500 MB on a phone). Shortcuts, Google documents and anything that fails are listed in MISSING_FILES.txt; Retry missing downloads only what failed: into the same folder, or in a new .zip (Folder (missing files).zip, then (missing files 2).zip…) to extract over the first one, in order. It needs a connection; keep the tab open until it finishes. If the connection or the server stops answering, it waits and continues when they come back. Cancel stops the download even if an error response gets stuck; an unfinished zip is discarded, and completed files in a folder are kept. While listing more pages, folders already set aside in that pass stop using checks; deferred folders are checked again in their next pass.",
    es: "Bajar todo, en el visor de la carpeta o en la barra de la tarjeta, guarda todo lo de adentro con sus subcarpetas. En Chrome y Edge de computadora elegís dónde va el .zip, o Bajar a una carpeta… escribe los archivos tal cual. Firefox, Safari y los teléfonos arman el zip en memoria: hasta 1 GB (500 MB en un teléfono). Los accesos directos, los documentos de Google y lo que falle quedan anotados en MISSING_FILES.txt; Reintentar lo que falta baja solo lo que falló: en la misma carpeta, o en un .zip nuevo (Carpeta (missing files).zip, después (missing files 2).zip…) para descomprimir encima del primero, en orden. Hace falta conexión; dejá la pestaña abierta hasta que termine. Si la conexión o el servidor dejan de contestar, espera y sigue cuando vuelven. Cancelar corta la bajada aunque una respuesta de error se trabe; se descarta el zip a medias y se conserva lo ya terminado en una carpeta. Al listar más páginas, las subcarpetas ya apartadas de esa vuelta dejan de gastar comprobaciones; las aplazadas se comprueban de nuevo en su próxima vuelta.",
  },
  'help.folderWho.title': { en: "Who sees a folder", es: "Quién ve una carpeta" },
  'help.folderWho.text': {
    en: "Whoever sees the page sees and downloads what is in the folder, but never the folders above it or next to it. Only the person who added the folder uploads into it.",
    es: "Quien ve la página ve y baja lo que hay en la carpeta, pero nunca las carpetas de arriba ni las de al lado. Solo quien agregó la carpeta sube a ella.",
  },

  // --- Links de Drive ---
  'help.driveLinks.title': { en: "Pasting a Drive link", es: "Pegar un link de Drive" },
  'help.driveLinks.text': {
    en: "Paste a Google Drive link and choose how it stays: as a link, as text, or as a card with a player. {pick} choose, Esc keeps the link.",
    es: "Pegá un link de Google Drive y elegí cómo queda: como link, como texto o como tarjeta con reproductor. {pick} eligen, Esc deja el link.",
  },

  // --- Comentarios ---
  'help.comments.title': { en: "Comments", es: "Comentarios" },
  'help.comments.text': {
    en: "Comment on any block with {comment}, the button in its margin or the formatting bar. The comments icon at the top shows every thread of the page. {send} sends, Esc cancels.",
    es: "Comentá cualquier bloque con {comment}, el botón de su margen o la barra de formato. El ícono de comentarios de arriba muestra todos los hilos de la página. {send} manda, Esc cancela.",
  },
  'help.mentions.title': { en: "Mention someone in a comment", es: "Mencionar a alguien en un comentario" },
  'help.mentions.text': {
    en: "In a comment, type @ and pick someone who can see the page: they get a notice in the bell at the top, with the number of unread mentions. {pick} choose from the list, {close} closes it without erasing what you wrote. Deleting the @name before sending removes the mention. A dot on the comments button and in the page tree means someone mentioned you on that page; the number also shows in the tab title and on the installed app's icon.",
    es: "En un comentario, escribí @ y elegí a alguien que vea la página: le llega un aviso en la campana de arriba, con el número de menciones sin leer. {pick} eligen de la lista, {close} la cierra sin borrar lo escrito. Borrar el @nombre antes de mandar saca la mención. Un punto en el botón de comentarios y en el árbol de páginas quiere decir que te mencionaron en esa página; el número también aparece en el título de la pestaña y en el ícono de la app instalada.",
  },
  'help.mentionsShare.title': { en: "Mention someone who can't see the page", es: "Mencionar a alguien que no ve la página" },
  'help.mentionsShare.text': {
    en: "If you're the owner or an admin and can share the page, the @ list also shows, in gray under “Can't see this page”, people who can't see it. Pick one and choose Share and mention: the page is shared with them with Comment (only that page and the ones inside it) and they're mentioned. It's shared right away, even if you then don't send the comment. It needs a connection. {cancel} closes the question without sharing.",
    es: "Si sos dueño o admin y podés compartir la página, la lista del @ también muestra, en gris bajo «No ven esta página», a quienes no la ven. Elegí a alguien y tocá Compartir y mencionar: se le comparte la página con Comentar (solo esa página y las de adentro) y queda mencionado. Se comparte en el momento, aunque después no mandes el comentario. Pide conexión. {cancel} cierra la pregunta sin compartir.",
  },
  'help.questions.title': { en: "Questions", es: "Preguntas" },
  'help.questions.text': {
    en: "A question is a line marked with a ? icon ({question}, or / Question). Anyone who can comment answers it in a thread, without editing the page.",
    es: "Una pregunta es un renglón marcado con un ícono ? ({question}, o / Pregunta). Quien puede comentar la contesta en un hilo, sin editar la página.",
  },

  // --- Buscar ---
  'help.findPage.title': { en: "Find and replace in the page", es: "Buscar y reemplazar en la página" },
  'help.findPage.text': {
    en: "{find} or the magnifying glass at the top finds in the open page; the arrow opens Replace (if you can edit). {next} next match, {prev} previous, {close} closes and leaves the match selected. Collapsed sections that hide matches open while you search, just on this device, and fold back when you close the bar (the one holding the selected match, or one you touched, stays open). {find} again inside the bar opens the browser's own search.",
    es: "{find} o la lupa de arriba buscan en la página abierta; la flecha despliega Reemplazar (si podés editar). {next} siguiente, {prev} anterior, {close} cierra y deja elegida la coincidencia. Las secciones colapsadas que esconden coincidencias se abren mientras buscás, solo en este dispositivo, y se vuelven a cerrar al cerrar la barra (queda abierta la de la coincidencia elegida, o una que tocaste). {find} otra vez dentro de la barra abre la búsqueda del navegador.",
  },
  'help.findProject.title': { en: "Search the whole project", es: "Buscar en todo el proyecto" },
  'help.findProject.text': {
    en: "{search} or the magnifying glass next to + searches the titles and text of every page in the project, offline too, and takes you to the exact spot, opening the collapsed section that hides it. Annotation results also find the complete text of drawings on photos, including inline photos and table cells; selecting one opens that photo in the viewer. If it changed or was removed, the page stays open and a notice asks you to search again. It also lists matching projects. The arrow left of the field opens Replace.",
    es: "{search} o la lupa al lado del + buscan en los títulos y el texto de todas las páginas del proyecto, también sin red, y te llevan al lugar exacto, abriendo la sección colapsada que lo esconde. Los resultados Anotación también encuentran el texto completo de los dibujos de las fotos, incluidas las de renglones y celdas; elegir uno abre esa foto en el Carrete. Si cambió o se retiró, la página queda abierta y un aviso pide buscar otra vez. También muestran los proyectos que coinciden. La flecha a la izquierda del campo despliega Reemplazar.",
  },
  'help.replaceProject.title': { en: "Replace in the whole project", es: "Reemplazar en todo el proyecto" },
  'help.replaceProject.text': {
    en: "Open {search} and use the arrow left of the field (if you can edit pages). Accents don't matter (camara finds cámara) unless you turn on Aa, but ñ is its own letter (ano doesn't find año). Each match shows the old text crossed out and the new one next to it; replace one, a whole page or all of them. Replace all asks first how many changes in how many pages, and says how many are in collapsed sections (deleting those needs its checkbox). Page titles, captions and file names don't change, and neither do pages you can only view or that aren't downloaded yet. If it's the last thing you did, {undo} undoes it in every page (also right after replacing, with the panel still open) and {redo} does it again. Undo, in the notice or in the panel, works even when it isn't the last thing you did: it puts back everything that wasn't changed afterwards, offline too and after closing the app, on the device where you replaced.",
    es: "Abrí {search} y usá la flecha a la izquierda del campo (si podés editar páginas). Las tildes no cuentan (camara encuentra cámara) salvo con Aa, pero la ñ es otra letra (ano no encuentra año). Cada coincidencia muestra lo de antes tachado y lo nuevo al lado; reemplazá una, una página entera o todas. Reemplazar todo pregunta antes cuántos cambios en cuántas páginas, y dice cuántas están en secciones colapsadas (borrarlas pide su casilla). No cambian los títulos de las páginas, los pies ni los nombres de archivo, ni las páginas que solo podés ver o que todavía no bajaron. Si es lo último que hiciste, {undo} lo deshace en todas las páginas (también recién reemplazado, con el panel abierto) y {redo} lo vuelve a hacer. Deshacer, en el aviso o en el panel, anda aunque no sea lo último: vuelve a poner todo lo que nadie cambió después, también sin red y después de cerrar la app, en el dispositivo donde reemplazaste.",
  },

  // --- Colapsar ---
  'help.collapse.title': { en: "Collapse a section", es: "Colapsar una sección" },
  'help.collapse.text': {
    en: "Every heading has a triangle: click it to hide what's under it, up to the next heading of its level, just for you (saved on this device). {collapse} does it from the keyboard; the ⋯ menu collapses or expands them all. The triangle's tooltip says whether it's collapsed for everyone or just for you.",
    es: "Cada título tiene un triángulo: un clic esconde lo que tiene abajo, hasta el próximo título de su nivel, solo para vos (queda guardado en este dispositivo). {collapse} lo hace con el teclado; el menú ⋯ colapsa o abre todos. El tooltip del triángulo dice si está colapsado para todos o solo para vos.",
  },
  'help.collapseEveryone.title': { en: "Collapse for everyone", es: "Colapsar para todos" },
  'help.collapseEveryone.text': {
    en: "Shift+click on the triangle (or {everyone}) collapses or expands the section for everyone who views the page, if you can edit it. A plain click still changes it just for you, and what you set for yourself stays even if someone changes it for everyone. On the phone, a tap is always just for you.",
    es: "Shift+clic en el triángulo (o {everyone}) colapsa o abre la sección para todos los que miran la página, si podés editarla. Un clic sin Shift la sigue cambiando solo para vos, y lo tuyo se mantiene aunque otro la cambie para todos. En el teléfono, un toque es siempre solo para vos.",
  },
  'help.collapseMove.title': { en: "Move a collapsed section", es: "Mover una sección colapsada" },
  'help.collapseMove.text': {
    en: "Dragging the dots of a collapsed heading, or {up} / {down}, moves its whole section, and what was hidden stays hidden. With {up} / {down}, any other block jumps over a collapsed section as if it were a single block. Undo puts it back in one step.",
    es: "Arrastrar los puntos de un título colapsado, o {up} / {down}, mueve su sección entera, y lo escondido sigue escondido. Con {up} / {down}, cualquier otro bloque salta una sección colapsada como si fuera uno solo. Deshacer la vuelve en un solo paso.",
  },
  'help.collapsePrint.title': { en: "Print as shown", es: "Imprimir como se ve" },
  'help.collapsePrint.text': {
    en: "With something collapsed, the PDF comes out fully expanded unless you turn on Print as shown in the ⋯ menu.",
    es: "Con algo colapsado, el PDF sale con todo abierto, salvo que prendas Imprimir como se ve en el menú ⋯.",
  },

  // --- Compartir ---
  'help.share.title': { en: "Sharing a page or a project", es: "Compartir una página o un proyecto" },
  'help.share.text': {
    en: "Share from the ⋯ menu: view, comment, edit, or edit and create pages. A permission covers everything under that page and never what's above it. A page made from a template has an Internal — remove before sharing section: delete it before sharing with a client.",
    es: "Se comparte desde el menú ⋯: ver, comentar, editar, o editar y crear páginas. Un permiso vale para todo lo de abajo de esa página y nunca para lo de arriba. Una página hecha con una plantilla tiene la sección Interno — borrar antes de compartir: borrala antes de compartirla con un cliente.",
  },
  'help.publicLink.title': { en: "Share with a link", es: "Compartir con un link" },
  'help.publicLink.text': {
    en: "In Share, General access: Anyone with the link can open the page and the ones inside, without an account, and comment with a name. It never shows what's above, what was deleted or the history. Copy link sends it; Reset link cuts it for everyone at once; it can expire. It needs the setting that keeps deleted text out of shared pages. Not for sensitive material.",
    es: "En Compartir, Acceso general: cualquiera con el link abre la página y las de adentro, sin cuenta, y comenta con un nombre. Nunca ve lo de arriba, lo borrado ni el historial. Copiar link lo manda; Renovar link lo corta para todos en el acto; puede vencer. Pide el ajuste que deja afuera de lo compartido lo que se borró. No es para material sensible.",
  },
  'help.openedWithLink.title': { en: "Opened with a link", es: "Abierto con un link" },
  'help.openedWithLink.text': {
    en: "You see the shared page and the ones inside, without an account. To comment, write your name once: it's shown with “(via link)”. What you write is saved in this browser first, and a page you already opened shows again without a connection. The link can stop working if whoever shared it turns it off.",
    es: "Ves la página compartida y las de adentro, sin cuenta. Para comentar, escribí tu nombre una vez: se muestra con “(vía link)”. Lo que escribís se guarda primero en este navegador, y una página que ya abriste se vuelve a ver sin conexión. El link puede dejar de andar si quien lo compartió lo apaga.",
  },
  'help.linkEdit.title': { en: "Can edit with a link", es: "Puede editar con un link" },
  'help.linkEdit.text': {
    en: "In Share, General access, a link can be Can edit once the workspace turns it on. Whoever has the link writes in the page and the ones inside, without an account, and adds photos and files to your Drive; they don't create, move, rename or delete pages. What they write waits until someone from your team who sees deleted text opens the app: it's checked and added to the page, and the history shows it as “Name (via link)”. A change that can't be added is set aside, never lost: the page says so, with Download it. Share counts what's waiting, set aside and on hold; Reset link sets aside what was waiting.",
    es: "En Compartir, Acceso general, un link puede ser Puede editar cuando el workspace lo prende. Quien tiene el link escribe en la página y las de adentro, sin cuenta, y suma fotos y archivos a tu Drive; no crea, mueve, renombra ni borra páginas. Lo que escribe espera hasta que alguien de tu equipo que ve lo borrado abre la app: se revisa y se suma a la página, y el historial lo muestra como “Nombre (vía link)”. Un cambio que no se puede sumar queda aparte, nunca se pierde: la página lo dice, con Bajarlo. Compartir cuenta lo que espera, lo apartado y lo que está en espera; Renovar link aparta lo que esperaba.",
  },
  'help.editingWithLink.title': { en: "Editing with a link", es: "Editar con un link" },
  'help.editingWithLink.text': {
    en: "With a Can edit link you write in the shared page and the ones inside. The first time, write your name: it's shown with “(via link)”. What you write is saved in this browser and reaches the others when someone from the team opens the app (the badge says Sent, waiting for the team). A change that can't be added is set aside with Download them. A change of more than 1 MB (a big paste) isn't sent: undo it to keep going. If the link stops working, you can still download what you wrote.",
    es: "Con un link Puede editar escribís en la página compartida y las de adentro. La primera vez, escribí tu nombre: se muestra con “(vía link)”. Lo que escribís se guarda en este navegador y les llega a los demás cuando alguien del equipo abre la app (el indicador dice Enviado, esperando al equipo). Un cambio que no se puede sumar queda aparte, con Bajarlos. Un cambio de más de 1 MB (un pegado grande) no se manda: deshacelo para seguir. Si el link deja de andar, igual podés bajar lo que escribiste.",
  },
  'help.linkFiles.title': { en: "Photos and files through a link", es: "Fotos y archivos con un link" },
  'help.linkFiles.text': {
    en: "With a Can edit link you add photos, videos and files to the shared pages, up to 500 MB each. They're saved in this browser first and then go to the Drive of the workspace owner; what you write on that page is sent once its files are registered. By default a link adds up to 100 files a day and 500 in all, 1 GB a day and 5 GB in all. Folders can't be added. If the link stops working before a file finishes uploading, you can still download it from this browser. In Share, the team sees the exact count of files added through all links to this page, including earlier links, even beyond 500 files; the list shows the newest 20. It also shows how much is in the Drive, with a warning from 1 GB.",
    es: "Con un link Puede editar sumás fotos, videos y archivos a las páginas compartidas, de hasta 500 MB cada uno. Se guardan primero en este navegador y después van al Drive del dueño del workspace; lo que escribís en esa página se manda cuando sus archivos quedan registrados. De fábrica, un link suma hasta 100 archivos por día y 500 en total, 1 GB por día y 5 GB en total. Carpetas, no. Si el link deja de andar antes de que un archivo termine de subir, lo podés bajar de este navegador. En Compartir, el equipo ve la cantidad exacta de archivos sumados con todos los links de esta página, también los anteriores, aunque pasen de 500; la lista muestra los 20 más nuevos. También ve cuánto hay en el Drive, con un aviso desde 1 GB.",
  },
  'help.linkAside.title': { en: "Changes set aside from a link", es: "Cambios de un link que quedaron aparte" },
  'help.linkAside.text': {
    en: "Share, under General access, lists what was sent through the page's link (also through an earlier link, before Reset link) and was set aside: who, when, on which page and why, with Download it and Download all. In the page tree, a warning sign marks a page with something set aside, and its Version history shows it as Set aside (via link): you can read what it brings, but it isn't a version and isn't applied. Nothing set aside is ever deleted. The files the page's links added are listed too, also the ones in changes set aside: they stay in your Drive, and you can download them.",
    es: "Compartir, en Acceso general, lista lo que se mandó con el link de la página (también con un link anterior, antes de Renovar link) y quedó aparte: quién, cuándo, en qué página y por qué, con Bajarlo y Bajar todo. En el árbol de páginas, un signo de atención marca una página con algo apartado, y su Historial de versiones lo muestra como Apartado (vía link): se puede leer lo que trae, pero no es una versión y no se aplica. Nada apartado se borra nunca. También se listan los archivos que sumaron los links de la página, también los de cambios apartados: quedan en tu Drive y se pueden bajar.",
  },
  'help.linkStartOver.title': { en: "Back to the team's version", es: "Volver a la versión del equipo" },
  'help.linkStartOver.text': {
    en: "With a Can edit link, if some of your changes on a page couldn't be added, what you write next on that page won't reach the team either. The page says so. Download them keeps a copy; Show the team's version downloads a copy first and then shows the page here as the team sees it, so what you write from then on reaches them. It needs a connection, and if anything changes while the copy is prepared, nothing is replaced. What you had stays in the copy and in this browser.",
    es: "Con un link Puede editar, si algunos de tus cambios en una página no se pudieron sumar, lo que escribas después en esa página tampoco le llega al equipo. La página lo dice. Bajarlos guarda una copia; Ver la versión del equipo primero baja una copia y después muestra la página acá como la ve el equipo, así lo que escribas desde ahí les llega. Necesita conexión, y si algo cambia mientras se prepara la copia, no se reemplaza nada. Lo que tenías queda en la copia y en este navegador.",
  },
  'help.members.title': { en: "Members and guests", es: "Miembros e invitados" },
  'help.members.text': {
    en: "The owner and the admins invite people from Members, in the account menu. Clients join as guests and only see what's shared with them.",
    es: "El dueño y los admins invitan gente desde Miembros, en el menú de la cuenta. Los clientes entran como invitados y ven solo lo que se les comparte.",
  },

  'help.mcpConnect.title': { en: "Connect an assistant (MCP)", es: "Conectar un asistente (MCP)" },
  'help.mcpConnect.text': {
    en: "When you add Shot Docs as a connector in an assistant like Claude or ChatGPT, a Shot Docs screen opens asking whether to allow it (sign in with your code first if it asks). It shows the name the app gave itself, your account and workspace, and the address you go back to after choosing: anyone can register an app with any name, so allow it only if you just started the connection and that address is your assistant's (hold the pointer over it to see it whole). Allow sends you back connected; Deny sends you back without access. The connection only reaches Shot Docs through the assistant functions, never your photos or the rest of the app. It's being tested: the owner has to turn it on for the workspace.",
    es: "Cuando agregás Shot Docs como conector en un asistente como Claude o ChatGPT, se abre una pantalla de Shot Docs que pregunta si lo permitís (antes entrá con tu código si te lo pide). Muestra el nombre que se puso la app, tu cuenta y tu workspace, y la dirección a la que volvés después de elegir: cualquiera puede registrar una app con cualquier nombre, así que permitilo solo si recién empezaste la conexión y esa dirección es la de tu asistente (dejá el puntero encima para verla entera). Permitir te devuelve conectado; No permitir te devuelve sin acceso. La conexión solo llega a Shot Docs por las funciones del asistente, nunca a tus fotos ni al resto de la app. Está en prueba: el dueño tiene que prenderla en el workspace.",
  },
  'help.deletedPrivacy.title': { en: "Who can see what was deleted", es: "Quién ve lo que se borró" },
  'help.deletedPrivacy.text': {
    en: "People who can edit a page (not guests) see everything that was deleted, like in the version history. People who only view or comment, and guests, get a clean copy of the page instead: the page as it was the last time an editor's app prepared it, about 20 seconds after you stop typing, every 2 minutes while you keep typing (longer for very large pages) and when you close the app. Until an editor prepares it, they see that the page is being prepared. Something that stayed on the page for a while may have reached them even if you delete it later; something deleted within seconds almost never does. They can tell that something was deleted and how long it was, not what it said. Photos and files removed from a page stop opening for them. What a device already downloaded can't be taken back from it. Until the workspace turns clean copies on, deleted text and photos can still reach the people a page is shared with.",
    es: "Quienes pueden editar una página (no los invitados) ven todo lo que se borró, como en el historial de versiones. Quienes solo ven o comentan, y los invitados, reciben en cambio una copia limpia de la página: la página como estaba la última vez que la app de alguien que edita la preparó, unos 20 segundos después de que dejás de escribir, cada 2 minutos mientras seguís escribiendo (más espaciado en páginas muy grandes) y al cerrar la app. Hasta que alguien que edita la prepara, ven que la página está en preparación. Algo que quedó un rato en la página les pudo haber llegado aunque después lo borres; algo borrado en segundos casi nunca. Pueden saber que se borró algo y cuánto ocupaba, no qué decía. Las fotos y archivos que se sacan de una página dejan de abrirse para ellos. Lo que un dispositivo ya bajó no se le puede quitar. Hasta que el workspace prenda las copias limpias, el texto y las fotos borrados todavía les pueden llegar a las personas con quienes se comparte una página.",
  },

  // --- El asistente ---
  'help.assistant.title': { en: "Assistant", es: "Asistente" },
  'help.assistant.text': {
    en: "Select some text (or put the cursor in a paragraph) and choose Assistant in the toolbar, in the page menu or with {open}. Fix spelling & grammar, Improve writing, Make shorter, Translate to… or Ask… sends only what you selected to your provider, with your own key, and shows a preview of what changes. Apply replaces it as one edit: undo it with {undo}, or apply the suggestion with {apply}. If the text changes while the assistant is working (you or someone else typed in it), nothing is applied. With NVIDIA, Stop sends a separate control request to your workspace's gatekeeper and waits for confirmation. Until it finishes, new requests and Apply stay disabled. If confirmation cannot be obtained, the app says so. An interrupted or incomplete answer cannot be applied; even a confirmed Stop does not guarantee the provider stops processing or charging for work it already received. Photos inside the selection stay; links the assistant invents are removed. If you can only view or comment on the page, you can translate or ask and copy the result. Without internet the assistant doesn't work (a local model on your computer still does).",
    es: "Elegí un texto (o poné el cursor en un párrafo) y tocá Asistente en la barra, en el menú de la página o con {open}. Corregir ortografía y gramática, Mejorar la redacción, Acortar, Traducir al… o Pedir… manda solo lo elegido a tu proveedor, con tu propia clave, y muestra una vista previa de lo que cambia. Aplicar lo reemplaza como una sola edición: se deshace con {undo}, y la sugerencia se aplica con {apply}. Si el texto cambia mientras el asistente trabaja (escribiste vos u otra persona), no se aplica nada. Con NVIDIA, Parar manda un control separado al portero de tu workspace y espera la confirmación. Hasta que termina no se puede iniciar otro pedido ni aplicar la respuesta. Si no se puede obtener confirmación, la app lo aclara. Una respuesta cortada o incompleta no se puede aplicar; incluso una parada confirmada no garantiza que el proveedor detenga el procesamiento o el cobro por trabajo que ya recibió. Las fotos dentro de lo elegido quedan; los links que invente el asistente se sacan. Si en la página solo podés ver o comentar, podés traducir o pedir y copiar el resultado. Sin internet el asistente no anda (un modelo local en tu computadora sí).",
  },
  'help.assistantKey.title': { en: "Your assistant key", es: "Tu clave del asistente" },
  'help.assistantKey.text': {
    en: "In the account menu, Assistant… sets the provider (NVIDIA, Anthropic, OpenAI, Google Gemini or an OpenAI-compatible service such as OpenRouter, Ollama or LM Studio), your API key and the model; Test lists the models; with NVIDIA, this does not confirm inference access. Before sending your key, Test waits for the workspace gateway to prepare the request; a preparation timeout identifies that gateway. NVIDIA Test works through that gateway in Chromium too; you do not need to start a local model. The key is saved on this device, encrypted, and is sent only to that provider (for a compatible service, only to the address it was saved with: if you change the address, paste the key again): NVIDIA is the exception: your key and request pass through the gatekeeper of your workspace to NVIDIA, without being stored or logged there. Other providers do not use the gatekeeper. NVIDIA supports Qwen for text and captions, and Llama, manually selected Kimi K3 or GLM 5.3 for text only. Kimi K3 and GLM 5.3 have a 16,000 generation-token limit in this app; automatic selection still prefers Qwen, then Llama; voice uses OpenAI, Gemini or a compatible service. A copy is stored in the workspace only if you turn on Sync across my devices, encrypted with your passphrase (see Sync your assistant key); otherwise you paste it once on each device. The encryption only keeps it from showing in plain text by accident: anyone using this browser could still use it, so set a spending limit in your provider's account, and on a shared computer check Also forget my assistant key on this device when you sign out (or use Forget key). Each request is charged by the provider to your account; the assistant shows the tokens it used. The owner or an admin of the workspace can turn the assistant off or allow only local models: it's a rule of the app, since anyone who can read a page can copy it.",
    es: "En el menú de la cuenta, Asistente… elige el proveedor (NVIDIA, Anthropic, OpenAI, Google Gemini o un servicio compatible con OpenAI, como OpenRouter, Ollama o LM Studio), tu clave de la API y el modelo; Probar lista los modelos; con NVIDIA, esto no confirma el acceso a inferencia. Antes de enviar tu clave, Probar espera que el portero del workspace prepare el pedido; si vence esa espera, el aviso identifica al portero. Probar NVIDIA pasa por ese portero también en Chromium; no hace falta arrancar un modelo local. La clave se guarda en este dispositivo, cifrada, y se manda solo a ese proveedor (en un servicio compatible, solo a la dirección con que se guardó: si cambiás la dirección, pegá la clave de nuevo): NVIDIA es la excepción: tu clave y el pedido pasan por el portero del dueño de tu workspace hacia NVIDIA, sin guardarse ni registrarse allí. Los otros proveedores no usan el portero. NVIDIA admite Qwen para texto y pies de foto, y Llama, Kimi K3 o GLM 5.3 elegidos manualmente sólo para texto. Kimi K3 y GLM 5.3 tienen un tope de 16000 tokens de generación en esta app; la elección automática sigue prefiriendo Qwen y después Llama; la voz usa OpenAI, Gemini o un servicio compatible. Una copia queda guardada en el workspace solo si prendés Sincronizar en mis dispositivos, cifrada con tu frase (ver Sincronizar tu clave del asistente); si no, la pegás una vez en cada dispositivo. El cifrado solo evita que se vea en claro por accidente: quien use este navegador igual la podría usar, así que poné un tope de gasto en tu cuenta del proveedor, y en una computadora compartida tildá Olvidar también mi clave del asistente en este dispositivo al cerrar la sesión (u Olvidar la clave). Cada pedido lo cobra el proveedor a tu cuenta; el asistente muestra los tokens que usó. El dueño o un admin del workspace puede apagar el asistente o permitir solo modelos locales: es una regla de la app, porque quien puede leer una página la puede copiar.",
  },

  'help.assistantSync.title': { en: "Sync your assistant key", es: "Sincronizar tu clave del asistente" },
  'help.assistantSync.text': {
    en: "To use your key on all your devices, open Assistant… with the key saved and, under Sync across my devices, choose Turn on sync…. The app proposes a passphrase of six random words: save it in your password manager (the browser offers to when you tap Turn on sync) rather than copying it, since copied text can stay in your clipboard history. Your key is encrypted on this device with that passphrase, and only the encrypted copy is stored in the workspace's database: neither its owner nor anyone who gets a copy of it can read it, and only you can open or change it. The copy is only in the workspace where you turn it on. On another device, open Assistant…, enter the passphrase and choose Unlock: the app shows where the key goes and the last four characters, and asks before using a key that goes to a different provider or address than the one that device uses. Update synced key uploads the key of this device with the same passphrase, and Stop syncing deletes the copy (the key stays on each device). You can use your own passphrase of at least 20 characters and four words, but a made-up one is much easier to guess. If you forget the passphrase nobody can recover it: paste your API key again and choose a new one. If the passphrase leaks, create a new key at your provider (the owner's backups keep old copies). If you lose a device: 1) Sign out other devices in the account menu; 2) remove it from your password manager or plan a new passphrase; 3) create a new key at your provider and delete the old one; 4) save the new key here and use Replace synced key… with your current passphrase and a new one. Your other devices keep their key until you open Assistant… there: it says the synced key changed, and you unlock it with the new passphrase. Unlocking a key different from the one a device has (and that didn't come from the synced copy) asks first.",
    es: "Para usar tu clave en todos tus dispositivos, abrí Asistente… con la clave guardada y, en Sincronizar en mis dispositivos, elegí Prender la sincronización…. La app propone una frase de seis palabras al azar: guardala en tu gestor de contraseñas (el navegador lo ofrece al tocar Prender la sincronización) antes que copiarla, porque lo copiado puede quedar en el historial del portapapeles. Tu clave se cifra en este dispositivo con esa frase, y en la base del workspace queda solo la copia cifrada: ni su dueño ni quien consiga una copia de la base la pueden leer, y solo vos la podés abrir o cambiar. La copia queda solo en el workspace donde la prendés. En otro dispositivo, abrí Asistente…, escribí la frase y elegí Abrir: la app muestra a dónde va la clave y sus últimos cuatro caracteres, y pregunta antes de usar una clave que va a otro proveedor u otra dirección que la que usa ese dispositivo. Actualizar la clave sincronizada sube la clave de este dispositivo con la misma frase, y Dejar de sincronizar borra la copia (la clave queda en cada dispositivo). Podés usar una frase tuya de al menos 20 caracteres y cuatro palabras, pero una inventada es mucho más fácil de adivinar. Si olvidás la frase nadie la puede recuperar: pegá tu clave de la API de nuevo y elegí otra. Si la frase se filtra, creá una clave nueva en tu proveedor (las copias de seguridad del dueño guardan las copias viejas). Si perdés un dispositivo: 1) Cerrar la sesión en los otros dispositivos, en el menú de la cuenta; 2) sacalo de tu gestor de contraseñas o pensá en una frase nueva; 3) creá una clave nueva en tu proveedor y borrá la vieja; 4) guardá la clave nueva acá y usá Reemplazar la clave sincronizada… con tu frase actual y una nueva. Tus otros dispositivos siguen con su clave hasta que abrís Asistente… en cada uno: dice que la clave sincronizada cambió, y la abrís con la frase nueva. Abrir una clave distinta de la que tiene un dispositivo (y que no vino de la copia sincronizada) pregunta antes.",
  },
  'help.assistantSyncMore.title': { en: "Change your passphrase, borrowed computers and other workspaces", es: "Cambiar la frase, computadoras prestadas y otros workspaces" },
  'help.assistantSyncMore.text': {
    en: "With your key synced, Assistant… also offers Change passphrase…: enter the current passphrase and save the new one; the synced key stays the same, and your other devices ask for the new passphrase the next time you open Assistant… there. When the provider rejects a device's key and the synced copy is newer, the error offers Enter your passphrase to update it here. On a borrowed computer, uncheck Keep the key on this device before Unlock: the key lives only in that tab, nothing is saved, and reloading asks for the passphrase again. A device that already opened your copy refuses an older one (This synced copy is older than the one on this device), so an old copy put back in the database doesn't replace a newer key. If you work in several workspaces, one copy is enough: the key on a device works in all of them. To keep a copy in another workspace too, open Assistant… there and choose Also sync in this workspace…, with the same passphrase typed twice; each copy is independent and Stop syncing deletes only that one. The second key of Voice, if you have one, travels encrypted in the same copy. When you sign out, Also forget my assistant key on this device also forgets the voice key, and if there are voice notes to place, the window says how many and offers to delete them.",
    es: "Con tu clave sincronizada, Asistente… también ofrece Cambiar la frase…: escribí la frase actual y guardá la nueva; la clave sincronizada sigue igual, y tus otros dispositivos te piden la frase nueva la próxima vez que abrís Asistente… en cada uno. Cuando el proveedor rechaza la clave de un dispositivo y la copia sincronizada es más nueva, el error ofrece Escribir tu frase para actualizarla acá. En una computadora prestada, destildá Guardar la clave en este dispositivo antes de Abrir: la clave vive solo en esa pestaña, no se guarda nada, y al recargar te vuelve a pedir la frase. Un dispositivo que ya abrió tu copia rechaza una más vieja (Esta copia sincronizada es más vieja que la de este dispositivo), así una copia vieja repuesta en la base no reemplaza una clave más nueva. Si trabajás en varios workspaces, con una copia alcanza: la clave de un dispositivo sirve en todos. Para tener una copia también en otro workspace, abrí Asistente… ahí y elegí Sincronizar también en este workspace…, con la misma frase escrita dos veces; cada copia es independiente y Dejar de sincronizar borra solo esa. La segunda clave de Voz, si tenés una, viaja cifrada en la misma copia. Al cerrar la sesión, Olvidar también mi clave del asistente en este dispositivo olvida también la de voz, y si quedan notas de voz para ubicar, la ventana dice cuántas y ofrece borrarlas.",
  },
  'help.assistantPage.title': { en: "Summarize or translate a page", es: "Resumir o traducir una página" },
  'help.assistantPage.text': {
    en: "In the assistant, under Whole page, Summarize page and Translate page send the title and the current text of the open page to your provider, with your key. Summarize page shows a summary: Insert at top adds it above everything, Insert below adds it under the block with the cursor, and Copy copies it. Translate page shows the translated page: Replace page content changes the text of each block where it is (photos, links, tables and the rest stay; undo it with {undo}), and Create translated subpage makes a new page inside this one with the translation and opens it (it needs permission to create pages there). Up to 20,000 characters: on a longer page, select a part and use the actions on the selection. If the page changes while the assistant is working, nothing is replaced. If you can only view or comment, you can ask and copy the result.",
    es: "En el asistente, en Toda la página, Resumir la página y Traducir la página mandan el título y el texto actual de la página abierta a tu proveedor, con tu clave. Resumir la página muestra un resumen: Agregar arriba lo pone arriba de todo, Agregar debajo lo pone debajo del bloque donde está el cursor, y Copiar lo copia. Traducir la página muestra la página traducida: Reemplazar el contenido cambia el texto de cada bloque en su lugar (las fotos, los links, las tablas y lo demás quedan; se deshace con {undo}), y Crear una subpágina traducida arma una página nueva adentro de esta con la traducción y la abre (hace falta poder crear páginas ahí). Hasta 20.000 caracteres: en una página más larga, elegí una parte y usá las acciones sobre lo elegido. Si la página cambia mientras el asistente trabaja, no se reemplaza nada. Si solo podés ver o comentar, podés pedir y copiar el resultado.",
  },
  'help.assistantCaption.title': { en: "Suggest a caption for a photo", es: "Sugerir un pie de foto" },
  'help.assistantCaption.text': {
    en: "Click a photo you can edit and choose Suggest caption in its bar (or, with the photo selected, in the assistant). The app first asks Send this photo to…? with the name of your provider: nothing leaves the device until you say yes. It sends a copy of up to 1,024 pixels, without the location and camera data of the file and never the original, and nothing else from the page. Choose the caption language there. The model looks at the photo (it can read a slate) and suggests one line; check it, edit it if you want, and choose Apply (or {apply}). It's added as normal text under the photo (in a table, in the same cell), so you can edit it or delete it like any other line; undo it with {undo}. If the photo was deleted or replaced while the model was looking, nothing is added. Your model must be able to look at images (most current ones can). The owner can turn it off with the assistant.",
    es: "Hacé clic en una foto que podés editar y tocá Sugerir un pie de foto en su barra (o, con la foto elegida, en el asistente). La app primero pregunta ¿Mandar esta foto a…? con el nombre de tu proveedor: no sale nada del dispositivo hasta que decís que sí. Manda una copia de hasta 1024 píxeles, sin la ubicación ni los datos de la cámara del archivo y nunca el original, y nada más de la página. Ahí elegís el idioma del pie. El modelo mira la foto (puede leer una claqueta) y propone un renglón; revisalo, retocalo si querés y tocá Aplicar (o {apply}). Se agrega como texto común debajo de la foto (en una tabla, en la misma celda), así que lo editás o lo borrás como cualquier renglón; se deshace con {undo}. Si la foto se borró o se reemplazó mientras el modelo la miraba, no se agrega nada. Tu modelo tiene que poder mirar imágenes (casi todos los actuales pueden). El dueño lo puede apagar junto con el asistente.",
  },
  'help.assistantFormat.title': { en: "Format as… (list, checklist, table, headings)", es: "Dar forma de… (lista, casillas, tabla, títulos)" },
  'help.assistantFormat.text': {
    en: "Select a few lines (or put the cursor in one) and, in the assistant, choose Bulleted list, Checklist, Table or Headings next to Format as…: the assistant gives the same data another shape, only with the blocks the app already has. Check the preview and apply it with Apply or {apply}; undo it with {undo}. If the new shape removes Script formatting, the preview warns you before Apply. Discard keeps the original; Undo restores its Script formatting too. If the suggestion leaves out any of the selected words, it can't be applied (the assistant tells you which); words it adds are underlined. It works on whole blocks: photos and links stay, a photo or a table among the lines comes back as it was, and blocks that only change their type keep their colors and the blocks nested inside. Splitting a block that has blocks nested inside is not done (they would be lost). If someone else edits those lines at the same time without internet, their change may only remain in the page history.",
    es: "Elegí unos renglones (o poné el cursor en uno) y, en el asistente, elegí Lista con viñetas, Lista de casillas, Tabla o Títulos al lado de Dar forma de…: el asistente les da otra forma a los mismos datos, solo con los bloques que la app ya tiene. Mirá la vista previa y aplicala con Aplicar o {apply}; se deshace con {undo}. Si la forma nueva quita el formato Guion, la vista previa te avisa antes de Aplicar. Descartar conserva el original; Deshacer también restaura su formato Guion. Si la sugerencia deja afuera alguna palabra de lo elegido, no se puede aplicar (el asistente dice cuál); las que agrega van subrayadas. Trabaja con bloques enteros: las fotos y los links quedan, una foto o una tabla entre los renglones vuelve como estaba, y los bloques que solo cambian de tipo conservan sus colores y los bloques que tienen adentro. Partir un bloque que tiene bloques adentro no se hace (se perderían). Si otra persona edita esos renglones al mismo tiempo sin internet, su cambio puede quedar solo en el historial de la página.",
  },
  'help.dictation.title': { en: "Dictate to report", es: "Dictar al reporte" },
  'help.dictation.text': {
    en: "On a page you can edit, the microphone button (on the phone, the round one at the bottom; on the computer, in the top bar, in the page menu or with {open}) opens Dictate to report. Write a note in your own words, or dictate it with your keyboard's microphone, for example “the 12_010 setup 3 was a 50 mm at T2.8, we did clean plate and HDRI”, and choose Place (or {place}). The assistant, with your own key, reads the page as it is now and proposes each change with its place: the table row and column, the line after its label (Afternoon:), the checkbox to check, a new row or the section of a new shot. Nothing is written until you check the preview: uncheck what you don't want and choose Apply (or {apply}); it's one edit, undo it with Undo or {undo}. Say which shot, or put the cursor in its row first; if it's not clear, it asks with a button per row. Rows it picked on its own are marked. What it couldn't place, and what you unchecked, stays under Couldn't place on this device until you add it to Summary or discard it (copying it leaves it there). Your note itself stays in the sheet, so you can check nothing was left out, until you choose Done or New note. If the page changed while it was working, nothing is applied. Without internet your note stays saved. If you can only view or comment, you can place a note and copy the result. The owner can turn it off with the assistant.",
    es: "En una página que podés editar, el botón del micrófono (en el teléfono, el redondo de abajo; en la compu, en la barra de arriba, en el menú de la página o con {open}) abre Dictar al reporte. Escribí una nota con tus palabras, o dictala con el micrófono del teclado, por ejemplo «el 12_010 setup 3 fue con un 50 mm a T2.8, hicimos clean plate y HDRI», y tocá Ubicar (o {place}). El asistente, con tu propia clave, lee la página como está ahora y propone cada cambio con su lugar: la fila y la columna de la tabla, el renglón después de su rótulo (Tarde:), la casilla a tildar, una fila nueva o la sección de un plano nuevo. No se escribe nada hasta que revisás la vista previa: destildá lo que no quieras y tocá Aplicar (o {apply}); es una sola edición, se deshace con Deshacer o {undo}. Decí qué plano, o poné antes el cursor en su fila; si no queda claro, pregunta con un botón por fila. Las filas que eligió por su cuenta se marcan. Lo que no pudo ubicar, y lo que destildaste, queda en No se pudo ubicar en este dispositivo hasta que lo agregues al resumen o lo descartes (copiarlo lo deja ahí). Tu nota misma queda en la hoja, para que revises que no haya quedado nada afuera, hasta que toques Listo o Nota nueva. Si la página cambió mientras trabajaba, no se aplica nada. Sin internet la nota queda guardada. Si solo podés ver o comentar, podés ubicar una nota y copiar el resultado. El dueño lo puede apagar junto con el asistente.",
  },
  'help.dictationQueue.title': { en: "Notes saved for later (Dictate to report)", es: "Notas guardadas para después (Dictar al reporte)" },
  'help.dictationQueue.text': {
    en: "Without internet, Dictate to report keeps your note: choose Save for later and write or dictate the next one. Saved notes stay on this device and are never deleted on their own; next to the sync status you see how many voice notes there are to place, and the microphone button on the phone shows how many belong to the page. Tap the notice to see the list and open each note in its page: there you place it with its preview against the page as it is then, one at a time, or Insert as text adds it as a paragraph at the end of the page. Discard asks first. A note from a page you can no longer open can be copied or discarded. Saved notes don't sync: they stay on the device where you wrote them.",
    es: "Sin internet, Dictar al reporte guarda tu nota: tocá Guardar para después y escribí o dictá la siguiente. Las notas guardadas quedan en este dispositivo y nunca se borran solas; al lado del estado de la sincronización dice cuántas notas de voz hay para ubicar, y el botón del micrófono del teléfono, cuántas son de esa página. Tocá el aviso para ver la lista y abrí cada nota en su página: ahí la ubicás con su vista previa contra la página como esté en ese momento, de a una, o Insertar como texto la agrega como párrafo al final de la página. Descartar pregunta antes. Una nota de una página que ya no podés abrir se puede copiar o descartar. Las notas guardadas no se sincronizan: quedan en el dispositivo donde las escribiste.",
  },
  'help.dictationVoice.title': { en: "Record a voice note (Dictate to report)", es: "Grabar una nota de voz (Dictar al reporte)" },
  'help.dictationVoice.text': {
    en: "In Dictate to report, the big microphone button records a voice note: tap to start and tap again to stop (no need to hold it; it stops by itself at 2 minutes). The recording is saved on this device second by second, so a call or switching apps keeps what was recorded. It is turned into text by the provider you choose in Voice (the same OpenAI, Gemini or compatible key as the assistant, or a second key only for voice: Anthropic and NVIDIA are not used for audio), with the names of the page's rows and columns as hints, and then placed with its preview, like a written note. Without internet it stays saved and is transcribed when you're back online. Before placing it you can fix the transcription, write it where the cursor was (a cell or a comment) with Insert at cursor, or add it as text. The screen stays on while recording. The Ask… field of the assistant has a small microphone too. The recording only goes to that provider and is deleted from the device with its note. A headset with a microphone helps with noise and gloves.",
    es: "En Dictar al reporte, el botón grande del micrófono graba una nota de voz: tocá para empezar y otra vez para cortar (no hace falta mantenerlo apretado; se corta solo a los 2 minutos). La grabación se guarda en este dispositivo segundo a segundo, así una llamada o cambiar de app no pierde lo grabado. La pasa a texto el proveedor que elijas en Voz (la misma clave de OpenAI, Gemini o un servicio compatible del asistente, u otra clave solo para la voz: Anthropic y NVIDIA no se usan para audio), con los nombres de las filas y columnas de la página como pistas, y después se ubica con su vista previa, como una nota escrita. Sin internet queda guardada y se transcribe cuando vuelve la red. Antes de ubicarla podés corregir la transcripción, escribirla donde estaba el cursor (una celda o un comentario) con Insertar en el cursor, o agregarla como texto. La pantalla no se apaga mientras graba. El campo Pedir… del asistente también tiene un micrófono chico. La grabación va solo a ese proveedor y se borra del dispositivo junto con su nota. Unos auriculares con micrófono ayudan con el ruido y los guantes.",
  },
  'help.dictationShot.title': { en: "Active shot, corrections and the shot's page (Dictate to report)", es: "Plano activo, correcciones y la página del plano (Dictar al reporte)" },
  'help.dictationShot.text': {
    en: "In Dictate to report, the Shot chip (Shot: 12_010) stays set between notes: notes that don't name a shot go to that one, so you can dictate three notes in a row about the shot you're filming. It changes by itself to the shot of what you apply, and you can change it or set it to None. To fix what you just applied, say it: “no, it was a 35” changes the last change again (and another correction after it, the same place); the preview says it corrects a change you just applied. When the note changes the lens of a shot that has its own Shot Breakdown page in the project, the preview also offers to write it in that page's Lens row, unticked: tick it to write it there too. It's only offered if that row is empty or still says what the report said, never over what someone else wrote, and only if you can edit that page; Undo in the panel takes it out of both pages. If you can only comment on the page, Add as comment leaves the note and where it would go as a comment, for someone who edits to apply it.",
    es: "En Dictar al reporte, la chapita del plano (Plano: 12_010) queda fija entre notas: las notas que no nombran un plano van a ese, así podés dictar tres notas seguidas del plano que estás filmando. Cambia sola al plano de lo que aplicás, y la podés cambiar o poner en Ninguno. Para corregir lo que acabás de aplicar, decilo: «no, era un 35» vuelve a cambiar el último cambio (y otra corrección después, el mismo lugar); la vista previa dice que corrige un cambio que acabás de aplicar. Cuando la nota cambia el lente de un plano que tiene su página de Desglose de plano en el proyecto, la vista previa ofrece además escribirlo en la fila Lente de esa página, destildado: tildalo para escribirlo también ahí. Solo se ofrece si esa fila está vacía o todavía dice lo que decía el reporte, nunca encima de lo que escribió otro, y solo si podés editar esa página; Deshacer en el panel lo saca de las dos páginas. Si en la página solo podés comentar, Agregar como comentario deja la nota y dónde iría como un comentario, para que alguien que edita la aplique.",
  },
  'help.dictationShortcut.title': { en: "Dictate from an iPhone Shortcut (Action button)", es: "Dictar desde un Atajo del iPhone (botón de acción)" },
  'help.dictationShortcut.text': {
    en: "You can open Dictate to report with your note already written, from the Action button or Siri. In the Shortcuts app, make a shortcut with three actions: Dictate Text, URL Encode (of the dictated text), and Open URLs with the app's address followed by /dictate# and the encoded text (for example shotdocs.lega.com.ar/dictate#…). Then set it on the Action button (Settings → Action Button → Shortcut). Siri turns your voice into text on the phone; the text goes after the #, which never reaches any server. The app opens the last page you had open with Dictate to report and the note in the field: nothing is sent until you check it and choose Place. If you use the app installed on the Home Screen and the shortcut opens Safari instead, sign in once in Safari too.",
    es: "Podés abrir Dictar al reporte con la nota ya escrita, desde el botón de acción o con Siri. En la app Atajos, armá un atajo con tres acciones: Dictar texto, Codificar URL (con el texto dictado) y Abrir URL con la dirección de la app seguida de /dictate# y el texto codificado (por ejemplo shotdocs.lega.com.ar/dictate#…). Después asignalo al botón de acción (Ajustes → Botón de acción → Atajo). Siri pasa tu voz a texto en el teléfono; el texto va después de #, que nunca llega a ningún servidor. La app abre la última página que tenías abierta con Dictar al reporte y la nota en el campo: no se manda nada hasta que la revises y toques Ubicar. Si usás la app instalada en la pantalla de inicio y el atajo abre Safari, entrá una vez también en Safari.",
  },
  'help.keyboardDictation.title': { en: "Dictation with your keyboard", es: "Dictar con el teclado" },
  'help.keyboardDictation.text': {
    en: "You can dictate in any text field of the app (a cell, a comment, the title, Dictate to report) with the dictation of your device: on the iPhone, the microphone key of the keyboard (on recent iPhones it works without internet for English and Spanish and the audio stays on the phone); on Android, the microphone of the keyboard (without internet only if the language is downloaded); on Windows, Win+H (it needs internet: the audio goes to Microsoft); on the Mac, the dictation key or pressing Fn twice. The app doesn't control it: your system does, and it decides where the audio goes. With gloves or in a noisy place, a headset with a microphone helps.",
    es: "Podés dictar en cualquier campo de texto de la app (una celda, un comentario, el título, Dictar al reporte) con el dictado de tu dispositivo: en el iPhone, la tecla del micrófono del teclado (en los iPhone recientes anda sin internet en castellano e inglés y el audio no sale del teléfono); en Android, el micrófono del teclado (sin internet solo si el idioma está bajado); en Windows, Win+H (necesita internet: el audio va a Microsoft); en la Mac, la tecla de dictado o tocar Fn dos veces. La app no lo controla: lo maneja tu sistema, que decide adónde va el audio. Con guantes o con ruido, ayudan unos auriculares con micrófono.",
  },
  'help.assistantPolicy.title': { en: "The assistant in a workspace", es: "El asistente en un workspace" },
  'help.assistantPolicy.text': {
    en: "In Assistant… (account menu), the owner and the admins choose for everyone in the workspace: On (each person uses their own key and provider), Local models only (only a model on the same computer or local network, so nothing goes to a provider) or Off. Everyone's assistant follows it the next time they open it. It's a rule of the app, not a barrier: anyone who can read a page can still copy it by hand.",
    es: "En Asistente… (menú de la cuenta), el dueño y los admins eligen para todos en el workspace: Prendido (cada uno usa su clave y su proveedor), Solo modelos locales (solo un modelo en la misma computadora o red local, así nada sale a un proveedor) o Apagado. El asistente de cada uno lo respeta la próxima vez que lo abre. Es una regla de la app, no una barrera: quien puede leer una página igual la puede copiar a mano.",
  },

  // --- Papelera ---
  'help.history.title': { en: "Version history", es: "Historial de versiones" },
  'help.history.text': {
    en: "In the page menu, Version history ({open}) lists who changed the page and when, grouped by editing session, in your local time (the time a change reached the server: what was written offline shows when it synced). Choose a version to see the page as it was; select and copy any part of it. Restore this version makes the page look like that again as a new change: nothing is lost, the version you had stays in the history and you undo it with {undo}. Restoring needs a connection and the page synced. Annotation-only sessions show Annotated plus the photo name from that version, or Annotations changed when the name is unclear; their authors count too. Manual version names take priority. Show changes compares supported drawings in Before and Selected version panels without loading the original photos or attributing individual shapes to authors; unsupported data is marked as partial. Restore also restores supported line fields when their photo, drawing parent and frame match; unsupported data prevents restoration. Anyone who can edit the page sees its history; guests don't. If a page can't be shown (something in it makes the editor fail), it says so in place of the page and the rest of the app keeps working: Version history is right there to restore an earlier version (restored from there, you go back by restoring another version).",
    es: "En el menú de la página, Historial de versiones ({open}) muestra quién cambió la página y cuándo, agrupado por sesión de edición, en tu hora (la hora en que el cambio llegó al servidor: lo escrito sin conexión figura cuando se sincronizó). Elegí una versión para ver la página como era; podés elegir y copiar cualquier parte. Restaurar esta versión deja la página otra vez así, como un cambio nuevo: no se pierde nada, la versión que tenías queda en el historial y se deshace con {undo}. Restaurar pide conexión y la página sincronizada. Las sesiones de solo anotaciones muestran Anotó y el nombre de la foto de esa versión, o Cambios en anotaciones cuando no es inequívoco; también cuentan sus autores. Los nombres manuales tienen prioridad. Mostrar cambios compara dibujos soportados en Antes y Versión elegida, sin cargar fotos originales ni atribuir formas a personas; los datos no representables se anuncian como parciales. Restaurar también restaura campos de líneas admitidas si siguen siendo la misma foto, el mismo padre y el mismo marco; los datos no admitidos impiden la restauración. Ven el historial quienes pueden editar la página; los invitados, no. Si una página no se puede mostrar (algo de su contenido hace fallar al editor), lo dice en lugar de la página y el resto de la app sigue andando: el historial de versiones queda a mano para restaurar una versión anterior (restaurada desde ahí, se vuelve atrás restaurando otra versión).",
  },
  'help.historyChanges.title': { en: "See what changed", es: "Ver qué cambió" },
  'help.historyChanges.text': {
    en: "In Version history, Show changes (on by default) compares each version with the previous one in the list: what was added is underlined and what was deleted is struck through, in the color of the person who did it (point at a mark, or touch it on the phone, to see who and when). A whole block added or deleted gets a bar on its left, and a block that changed its type or formatting says so (Changed to Heading 2). Text someone wrote in a part that had already been removed shows above the version, with Copy. Turn Show changes off to see the version as it was. The list updates by itself when new changes arrive. For supported lines, Recover drawing previews which missing fields it can add and which current values it will keep after changes arrive for a removed line. It saves on this device first and Undo reverses it in one step. If the history or drawing changes, choose it again; unsupported data is left unchanged.",
    es: "En el historial de versiones, Mostrar cambios (prendido de entrada) compara cada versión con la anterior de la lista: lo agregado va subrayado y lo borrado tachado, con el color de quien lo hizo (señalá una marca, o tocala en el teléfono, para ver quién y cuándo). Un bloque entero agregado o borrado lleva una barra a la izquierda, y uno que cambió de tipo o de formato lo dice (Cambió a Título 2). Lo que alguien escribió en una parte que ya se había borrado aparece arriba de la versión, con Copiar. Apagá Mostrar cambios para ver la versión tal como era. La lista se actualiza sola cuando llegan cambios nuevos. Para líneas admitidas, Recover drawing muestra qué campos faltantes puede agregar y qué valores actuales conserva cuando llegan cambios a una línea retirada. Guarda primero en este dispositivo y Undo lo revierte en un paso. Si cambió la historia o el dibujo, elegilo otra vez; los datos no admitidos quedan intactos.",
  },
  'help.historyNames.title': { en: "Name versions", es: "Ponerle nombre a una versión" },
  'help.historyNames.text': {
    en: "In Version history, the ⋯ button of a version lets you name it (Draft for the client, Shooting day 1), rename it or remove the name; Only named versions shows just those and the current one. What is written after a named version goes into a new one. Whoever named it, or someone who can edit and create pages there, can change the name. After restoring, the list says Restored from and the date of that version. Without a connection you still see the history up to the last time it was downloaded on this device; naming and restoring need a connection.",
    es: "En el historial de versiones, el botón ⋯ de una versión sirve para ponerle nombre (Borrador para el cliente, Rodaje día 1), cambiárselo o quitarlo; Solo versiones con nombre muestra esas y la actual. Lo que se escribe después de una versión con nombre va a una nueva. El nombre lo cambia quien lo puso, o quien puede editar y crear páginas ahí. Después de restaurar, la lista dice Restaurada desde y la fecha de esa versión. Sin conexión se sigue viendo el historial hasta la última vez que se bajó en este dispositivo; ponerle nombre y restaurar piden conexión.",
  },
  'help.trash.title': { en: "Trash", es: "Papelera" },
  'help.trash.text': {
    en: "There is one Trash, in the project menu (click the project at the top of the sidebar): deleted projects, pages with their subpages and, with Google Drive connected, the photos and files no page uses anymore, newest first. Filter by All, Projects, Pages or Files, and switch between This project and All projects. Restore brings a page or a project back where it was; the owner and admins manage the files.",
    es: "Hay una sola papelera, en el selector de proyectos (clic en el proyecto, arriba de la barra lateral): los proyectos borrados, las páginas con sus subpáginas y, con Google Drive conectado, las fotos y los archivos que ya no usa ninguna página, del más nuevo al más viejo. Filtrá por Todo, Proyectos, Páginas o Archivos, y pasá de Este proyecto a Todos los proyectos. Restaurar devuelve una página o un proyecto a su lugar; los archivos los manejan el dueño y los admins.",
  },

  // --- Sin red ---
  'help.syncStatus.title': { en: "What the sync status means", es: "Qué dice el estado de sincronización" },
  'help.syncStatus.text': {
    en: "Under the project name (on a phone, the icon at the top): All synced, changes not uploaded yet, offline, or a new version of the app to load.",
    es: "Debajo del nombre del proyecto (en el teléfono, el ícono de arriba): todo sincronizado, cambios sin subir, sin conexión, o una versión nueva de la app para cargar.",
  },
  'help.availableOffline.title': { en: "Use pages without a connection", es: "Usar páginas sin conexión" },
  'help.availableOffline.text': {
    en: "Available offline… in a page's ⋯ menu (or next to a project in the project list) downloads what the page and its subpages, or the whole project, need without a connection: large photos, attachments up to 50 MB and, if you tick them, original photos and videos. Each option shows its size first. It stays up to date while there's a connection; keep the app open until it says Ready to use offline.",
    es: "Disponible sin conexión…, en el menú ⋯ de una página (o al lado de un proyecto en la lista de proyectos), baja lo que la página y sus subpáginas, o el proyecto entero, necesitan sin red: fotos en grande, adjuntos de hasta 50 MB y, si los tildás, las fotos originales y los videos. Cada casilla muestra antes su peso. Se mantiene al día mientras haya conexión; dejá la app abierta hasta que diga Listo para usar sin conexión.",
  },
  'help.storageDevice.title': { en: "Storage on this device", es: "Espacio en este dispositivo" },
  'help.storageDevice.text': {
    en: "Storage on this device, in the account menu, shows how much Shot Docs keeps here and what is available offline. Copies of files already in Drive are kept up to a limit you choose (2 GB by default); past it, the app asks before removing the ones opened least recently. Photos, videos and other files added on this device can be freed too, with a connection, 14 days after they were uploaded and only after Drive confirms it has the same file; the thumbnail stays and the original opens from Drive. Pages marked offline and anything not uploaded yet are never removed.",
    es: "Espacio en este dispositivo, en el menú de la cuenta, muestra cuánto guarda Shot Docs acá y qué está disponible sin conexión. Las copias de archivos que ya están en Drive se guardan hasta un tope que elegís (2 GB de fábrica); pasado el tope, la app pregunta antes de sacar las que hace más que no se abren. Las fotos, los videos y los demás archivos agregados en este dispositivo también se pueden liberar, con conexión, 14 días después de subirlos y solo después de que Drive confirma que tiene el mismo archivo; la miniatura queda y el original se abre desde Drive. Lo marcado sin conexión y lo que todavía no se subió nunca se sacan.",
  },
  'help.removedWriting.title': { en: "When someone deletes what you were writing in", es: "Cuando alguien borra donde estabas escribiendo" },
  'help.removedWriting.text': {
    en: "If someone deletes a block (or a list, a table or a section) while you are writing or moving text in it, the deletion wins for everyone. You get a notice on the page with what you wrote or moved there (moving a block or changing its type rewrites its text), so you can copy it and paste it back.",
    es: "Si alguien borra un bloque (o una lista, una tabla o una sección) mientras escribís o movés texto en él, el borrado gana para todos. Te aparece un aviso en la página con lo que escribiste o moviste ahí (mover un bloque o cambiarle el tipo reescribe su texto), para copiarlo y volver a pegarlo.",
  },
  'help.updateApp.title': { en: "When the app asks to be updated", es: "Cuando la app pide actualizarse" },
  'help.updateApp.text': {
    en: "If the workspace needs a newer version, the sync status says Update the app: your changes wait on this device and upload after updating. It usually updates itself; if not, Update now in the sync status details. If the browser never loads the new version, Force the update appears there: with a connection, it reloads the app from the internet and keeps what is saved on this device; until it finishes installing, the app can't open offline. If the new version couldn't be installed (low storage or a dropped connection), free up space or find a better connection and tap Update now.",
    es: "Si el workspace pide una versión más nueva, el estado de sincronización dice Actualizá la app: tus cambios esperan en este dispositivo y se suben después de actualizar. Normalmente se actualiza sola; si no, Actualizar ahora en el detalle del estado. Si el navegador nunca carga la versión nueva, ahí aparece Forzar la actualización: con conexión, recarga la app desde internet y conserva lo guardado en este dispositivo; hasta que termine de instalarse, la app no abre sin conexión. Si la versión nueva no se pudo instalar (poco espacio o se cortó la conexión), liberá espacio o buscá mejor conexión y tocá Actualizar ahora.",
  },
  'help.syncSafe.title': { en: "Nothing gets lost", es: "No se pierde nada" },
  'help.localSaveExit.title': { en: "Saving before Reload or switching workspace", es: "Guardar antes de recargar o cambiar de workspace" },
  'help.localSaveExit.text': {
    en: "Reload in an app notice and switching, joining or creating a workspace from an open workspace wait up to eight seconds for local saving, including the current page title. If saving fails or the page changes during the wait, you stay where you are and can try again. Changes already on this device do not have to finish uploading. This covers these app actions; closing or reloading the browser, links to another workspace and signing out have separate handling.",
    es: "Recargar desde un aviso de la app y cambiar, unirse o crear un workspace desde uno abierto esperan hasta ocho segundos el guardado local, incluido el título de la página. Si falla el guardado o cambia la página durante la espera, te quedás donde estabas y podés volver a intentar. Lo ya guardado acá no tiene que terminar de subir. Esto cubre esas acciones de la app; cerrar o recargar el navegador, los enlaces a otro workspace y cerrar sesión tienen recorridos separados.",
  },
  'help.syncSafe.text': {
    en: "Every change is saved on this device first and uploads by itself, offline too, even after weeks without a connection. If the workspace needs a newer version of the app, it usually updates itself when the connection returns (if not, Update now in the sync status) and then uploads everything; until then, pages someone else changed can be read but not edited. Edits made on two devices at the same time are merged, never overwritten. Signing out with changes not uploaded asks first.",
    es: "Cada cambio se guarda primero en este dispositivo y se sube solo, también sin red y aunque pasen semanas. Si el workspace pide una versión más nueva de la app, normalmente se actualiza sola al volver la conexión (si no, Actualizar ahora en el estado de sincronización) y después sube todo; mientras tanto, las páginas que cambió otro se pueden leer pero no editar. Lo que se edita a la vez en dos dispositivos se junta, nunca se pisa. Cerrar sesión con cambios sin subir pregunta antes.",
  },

  // --- Hojas y PDF ---
  'help.sheets.title': { en: "Sheet sizes", es: "Tamaño de hoja" },
  'help.sheets.text': {
    en: "A page can be free or have a sheet size (A5, A4, A3, Letter) in ⋯ › Page size, for the page or its whole branch. Marks show where each sheet ends, and what you see is what the PDF looks like.",
    es: "Una página puede ser libre o tener tamaño de hoja (A5, A4, A3, Carta) en ⋯ › Tamaño de hoja, para la página o toda su rama. Unas marcas muestran dónde termina cada hoja, y lo que ves es lo que sale en el PDF.",
  },
  'help.pageBreak.title': { en: "Page break", es: "Salto de hoja" },
  'help.pageBreak.text': {
    en: "{pageBreak} or / Page break makes what follows start on a new sheet, in the Page marks and in the PDF. It shows as a dashed line; Backspace right after it removes it. On a free page it only counts when printing.",
    es: "{pageBreak} o / Salto de hoja hace que lo que sigue empiece en una hoja nueva, en las marcas de hoja y en el PDF. Se ve como una línea punteada; Retroceso justo después lo saca. En una página libre cuenta solo al imprimir.",
  },
  'help.export.title': { en: "Export pages and projects as PDF", es: "Exportar páginas y proyectos en PDF" },
  'help.export.text': {
    en: "⋯ › Export… makes one PDF with the page and the pages inside it; in the project list, Export project… does the whole project. Before preparing a PDF, the open title and pending local writes must finish saving, including overflow text moving into the page. A failed save keeps the window open; Cancel stops preparation without cancelling the write. If page order or layout changed before the next part, the previous PDF stays available and Export again starts from the beginning. It starts with a contents page that links to each page and says on which PDF page it starts; every page keeps its page size (in Chrome or Edge on a computer). Photos go as they were taken, at full resolution (from Drive if this device does not have them). Downloads keep going while data arrives; after 30 seconds without data, the photo uses the available lower-resolution copy and the page is listed with Export again. Photos reduced because full-size conversion exceeds the export limit are counted separately from unavailable originals. Media previews shown as markers in the PDF have a separate count; this does not mean their originals are missing. Tick Smaller file for a lighter PDF with lower-resolution photos. If it is too much for one PDF on this device, it comes out in parts (Part 1, Part 2…), split between pages: save each one and then prepare the next. Pages that could not be exported are listed at the end, each with a link and Export again. Comments are left out unless you tick Comments, and they show names, never email addresses. Pages in the trash are never included. In the print dialog choose Save as PDF and leave margins and scale as they are.",
    es: "⋯ › Exportar… arma un solo PDF con la página y las de adentro; en la lista de proyectos, Exportar proyecto… hace el proyecto entero. Antes de preparar el PDF espera el título abierto y las escrituras locales, incluido el sobrante que pasa al documento. Si el guardado falla conserva la ventana; Cancelar detiene la preparación sin cancelar la escritura. Si el orden o el formato de las páginas cambió antes de la siguiente parte, conserva el PDF anterior y Exportar de nuevo empieza desde el principio. Empieza con un índice que lleva a cada página y dice en qué hoja empieza; cada página sale con su tamaño de hoja (en Chrome o Edge en una computadora). Las fotos van como se tomaron, en resolución completa (del Drive si este dispositivo no las tiene). La descarga sigue mientras lleguen datos; después de 30 segundos sin datos, la foto sale con la copia disponible en menor resolución y la página queda en Exportar de nuevo. Las fotos reducidas porque la conversión a tamaño completo supera el límite de exportación se cuentan aparte de los originales no disponibles. Las vistas de archivos que salen como marcadores en el PDF tienen una cantidad aparte; eso no significa que falten sus originales. Tildá Archivo más liviano para un PDF más chico con fotos en menor resolución. Si es demasiado para un PDF en este dispositivo, sale en partes (Parte 1, Parte 2…), cortadas entre páginas: guardá cada una y después prepará la siguiente. Al final aparecen las páginas que no se pudieron exportar, cada una con su link y Exportar de nuevo. Los comentarios no van salvo que tildes Comentarios, y llevan nombres, nunca correos. Lo que está en la papelera no sale nunca. En el diálogo de imprimir elegí Guardar como PDF y dejá los márgenes y la escala como están.",
  },
  'help.fileLinks.title': { en: "Links to files in a PDF", es: "Links a los archivos en un PDF" },
  'help.fileLinks.text': {
    en: "In a PDF (Export… or printing a page), every attachment, folder and video block links to the file, with its name below; an inline video links only its frame and keeps the line or cell unchanged. Photos don't. Whoever opens the link signs in and sees the file only if they can see a page where it is; if not, they see that they don't have access, with nothing about the file. Printing a page always works this way. With Export…, if the page has a public link, the window says so and, ticked, file links use it: anyone with the PDF opens that page and the pages inside it (and edits them, if the link can edit). Changing the link's level also changes what those PDFs open, and Reset link turns them off. Without a connection, Export… can't ask for the public link: file links ask to sign in, and the window says so only if the PDF contains attachments, folders or videos. Photos only show an offline warning when their originals are missing from this device and Smaller file is unticked.",
    es: "En un PDF (Exportar… o imprimir una página), cada adjunto, carpeta y video en bloque lleva un link al archivo, con su nombre debajo; un video en línea enlaza solo su cuadro y conserva el renglón o la celda. Las fotos no. Quien abre el link entra con su cuenta y ve el archivo solo si puede ver una página donde está; si no, ve que no tiene acceso, sin nada del archivo. Imprimir una página siempre funciona así. Con Exportar…, si la página tiene un link público, la ventana lo dice y, tildado, los links a archivos lo usan: cualquiera con el PDF abre esa página y las de adentro (y las edita, si el link edita). Cambiar el nivel del link cambia también lo que abren esos PDF, y Reset link los apaga. Sin conexión, Exportar… no puede pedir el link público: los links a archivos piden entrar con una cuenta, y la ventana lo dice solo si el PDF lleva adjuntos, carpetas o videos. Las fotos solo muestran un aviso sin conexión cuando falta su original en este dispositivo y Archivo más liviano está destildado.",
  },
  'help.accessRequests.title': { en: "Access requests", es: "Pedidos de acceso" },
  'help.accessRequests.text': {
    en: "When you open a file link from a PDF, or a link to a page, and can't see it, Request access asks for it, even if nothing has been shared with you yet; the people who can share that page (or a page with that file) see your email and your role. A page link doesn't say which workspace it is from: with more than one workspace on this device, Request access is hidden for page links. Switch to the right workspace in Workspaces and open the link again to see a page already shared with you. Shot Docs remembers on this device when you asked; if you leave that screen open, the file or the page opens by itself once someone gives you access (or open the link again). If you can share pages, requests show up at the top of the bell and in Share of the page: Review lets you choose the access, View by default, and for a file also the page (when it is in more than one); it gives access to that page and the pages inside it and never lowers what the person already has. Decline turns it down: the same person can ask again the next day. Without an account you can't ask: the workspace has to invite you.",
    es: "Cuando abrís el link de un archivo desde un PDF, o el link de una página, y no podés verlo, Pedir acceso lo pide, aunque todavía no te hayan compartido nada; quienes pueden compartir esa página (o una página con ese archivo) ven tu correo y tu rol. El link de una página no dice de qué workspace es: con más de un workspace en este dispositivo, Pedir acceso no se ofrece para los links de páginas. Cambiá al workspace que corresponde en Workspaces y abrí el link de nuevo para ver una página que ya te compartieron. Shot Docs recuerda en este dispositivo cuándo lo pediste; si dejás esa pantalla abierta, el archivo o la página se abre en cuanto alguien te da acceso (o abrí el link de nuevo). Si podés compartir páginas, los pedidos aparecen arriba en la campana y en Compartir de la página: Revisar deja elegir el acceso, Ver por defecto, y para un archivo también la página (si está en más de una); da acceso a esa página y a las de adentro y nunca baja lo que la persona ya tiene. Rechazar lo descarta: la misma persona puede volver a pedirlo al día siguiente. Sin cuenta no se puede pedir: el workspace te tiene que invitar.",
  },
  'help.exportZip.title': { en: "Export pages and projects as a zip", es: "Exportar páginas y proyectos como zip" },
  'help.exportZip.text': {
    en: "In ⋯ › Export… or Export project…, choose Zip — to archive: a folder for each page with the page to open in any browser (no app or connection needed), its text as Markdown, its photos and files, and the comments with names, never email addresses. Before writing the archive, it saves pending changes on this device, including the title and any text moved from a long title into the page. If saving fails, retry; Cancel keeps accepted changes and stops this archive. If the selected pages or their layout change, prepare it again. Every photo is there as a JPEG you can see; tick Original photos, Attachments and Videos to also get the originals from Drive (the window shows how much each weighs). The zip also keeps what Shot Docs needs to import it again later. Deleted text, removed photos and pages in the trash are never included. Only the workspace owner and admins can export a zip, and only from a computer; on a phone, export the PDF.",
    es: "En ⋯ › Exportar… o Exportar proyecto…, elegí Zip — para archivar: una carpeta por página con la página para abrir en cualquier navegador (sin la app ni conexión), su texto en Markdown, sus fotos y archivos, y los comentarios con nombres, nunca correos. Antes de escribir el archivo guarda los cambios pendientes en este dispositivo, incluidos el título y el sobrante de un título largo que pasa a la página. Si falla el guardado, reintentá; Cancelar conserva lo aceptado y detiene este archivo. Si cambian las páginas elegidas o su formato, preparalo de nuevo. Cada foto va como una JPEG que se ve; tildá Fotos originales, Adjuntos y Videos para sumar los originales del Drive (la ventana dice cuánto pesa cada cosa). El zip guarda además lo que Shot Docs necesita para volver a importarlo. Lo borrado, las fotos sacadas y las páginas de la papelera no salen nunca. Solo el dueño y los admins del workspace exportan un zip, y desde una computadora; en el teléfono, exportá el PDF.",
  },
  'help.importArchive.title': { en: "Import a Shot Docs archive", es: "Importar un archivo de Shot Docs" },
  'help.importArchive.text': {
    en: "To bring back a project you exported as a zip, open the project list and choose Import Shot Docs archive…, then the zip (or, on a computer, its unzipped folder). It always becomes a new project, never on top of one that exists: pages in the same order with their sheet sizes, blocks, collapsed headings, photo annotations, template marks, comments with their names and dates, and photos and files, which upload to this workspace's Drive. A photo whose original was left out comes back from its preview; a video or file that is not in the zip keeps its name in its place. If it stops, choose the same zip again and Resume. Only the workspace owner and admins can import.",
    es: "Para volver a traer un proyecto que exportaste como zip, abrí la lista de proyectos y elegí Importar archivo de Shot Docs…, y después el zip (o, en una computadora, su carpeta descomprimida). Siempre entra como un proyecto nuevo, nunca encima de uno que existe: las páginas en el mismo orden con sus hojas, los bloques, los títulos colapsados, las anotaciones de las fotos, las marcas de plantilla, los comentarios con sus nombres y fechas, y las fotos y los archivos, que se suben al Drive de este workspace. Una foto sin su original vuelve desde su vista; un video o un archivo que no está en el zip deja su nombre en su lugar. Si se corta, elegí el mismo zip otra vez y Seguir. Solo el dueño y los admins del workspace pueden importar.",
  },
  'help.pdf.title': { en: "PDF and printing", es: "PDF e impresión" },
  'help.pdf.text': {
    en: "{print} or ⋯ › Export PDF / Print opens the browser's print dialog with the same sheet breaks you see; choose Save as PDF there.",
    es: "{print} o ⋯ › Exportar PDF / Imprimir abre la impresión del navegador con los mismos cortes de hoja que ves; ahí elegí Guardar como PDF.",
  },

  // --- Preferencias ---
  'help.prefs.title': { en: "Appearance", es: "Apariencia" },
  'help.prefs.text': {
    en: "In the account menu: light, dark or system theme, default or editorial typeface, text size and page width. They're saved in your account and follow you to every device.",
    es: "En el menú de la cuenta: tema claro, oscuro o del sistema, fuente normal o editorial, tamaño del texto y ancho de la página. Se guardan en tu cuenta y te siguen a cada dispositivo.",
  },
  'help.contrast.title': { en: "Text contrast", es: "Contraste del texto" },
  'help.contrast.text': {
    en: "In the account menu, Normal contrast gives the page text three shades: headings the strongest, bold a little softer and the rest a little softer still. More contrast softens the body text further while keeping bold close to headings; No contrast shows everything in one shade. Text with a color you picked keeps its color. It applies to the page, to a version in the history, to the PDF and to the pages of an exported zip (those always in the light shades), and it follows you to every device.",
    es: "En el menú de la cuenta, Contraste normal le da tres tonos al texto de la página: los encabezados, los más fuertes; la negrita, un poco más suave, y el resto, un poco más todavía. Más contraste apaga un poco más el texto común y mantiene la negrita cerca del encabezado; Sin contraste muestra todo en un solo tono. El texto con un color elegido conserva su color. Vale en la página, en una versión del historial, en el PDF y en las páginas de un zip exportado (esos siempre con los tonos claros), y te sigue a cada dispositivo.",
  },
  'help.language.title': { en: "Language", es: "Idioma" },
  'help.language.text': {
    en: "English or Español, also in the account menu.",
    es: "English o Español, también en el menú de la cuenta.",
  },

  // --- Atajos ---
  'help.keys.title': { en: "All the shortcuts", es: "Todos los atajos" },
  'help.keys.text': {
    en: "Every keyboard shortcut of the app, by where it works. On a Mac they use ⌘, never Ctrl.",
    es: "Todos los atajos de la app, según dónde valen. En la Mac son con ⌘, nunca con Ctrl.",
  },

  // --- Lo que hace cada atajo (src/help/shortcutTexts.ts) ---
  'shortcut.search': { en: "Search the project (and its projects list)", es: "Buscar en el proyecto (y la lista de proyectos)" },
  'shortcut.find': { en: "Find and replace in the page", es: "Buscar y reemplazar en la página" },
  'shortcut.print': { en: "Export PDF / print the page", es: "Exportar PDF / imprimir la página" },
  'shortcut.history': { en: "Version history of the page", es: "Historial de versiones de la página" },
  'shortcut.newDayReport': {
    en: "New day report (in the day reports folder or a report)",
    es: "Nuevo reporte del día (en la carpeta de reportes o en un reporte)",
  },
  'shortcut.assistant': { en: "Open or close the assistant", es: "Abrir o cerrar el asistente" },
  'shortcut.assistantApply': { en: "Apply the assistant's suggestion", es: "Aplicar la sugerencia del asistente" },
  'shortcut.dictate': { en: "Open or close Dictate to report", es: "Abrir o cerrar Dictar al reporte" },
  'shortcut.dictationPlace': { en: "Place the note (in Dictate to report)", es: "Ubicar la nota (en Dictar al reporte)" },
  'shortcut.titleEnter': { en: "From the title, go to the text", es: "Desde el título, pasar al texto" },
  'shortcut.comment': { en: "Comment on the block", es: "Comentar el bloque" },
  'shortcut.question': { en: "Question", es: "Pregunta" },
  'shortcut.script': { en: "Script (screenplay)", es: "Script (guion)" },
  'shortcut.pageBreak': { en: "Page break: what follows starts on a new sheet", es: "Salto de hoja: lo que sigue empieza en una hoja nueva" },
  'shortcut.scriptEnter': {
    en: "In a Script line: keep writing Script (on an empty line, back to normal text)",
    es: "En una línea de Script: seguir en Script (en una vacía, volver al texto común)",
  },
  'shortcut.paragraph': { en: "Normal text", es: "Texto común" },
  'shortcut.collapse': { en: "Collapse or expand the heading's section", es: "Colapsar o abrir la sección del título" },
  'shortcut.collapseEveryone': {
    en: "Collapse or expand the heading's section for everyone (if you can edit the page; Shift+click on the triangle too)",
    es: "Colapsar o abrir la sección del título para todos (si podés editar la página; también Shift+clic en el triángulo)",
  },
  'shortcut.selectAll': {
    en: "Select the whole page (collapsed sections too)",
    es: "Elegir la página entera (también lo colapsado)",
  },
  'shortcut.heading': { en: "Heading 1 to 5", es: "Título 1 a 5" },
  'shortcut.quote': { en: "Quote", es: "Cita" },
  'shortcut.numbered': { en: "Numbered list", es: "Lista numerada" },
  'shortcut.bullet': { en: "Bulleted list", es: "Lista con viñetas" },
  'shortcut.checklist': { en: "Checklist", es: "Lista de casillas" },
  'shortcut.toggle': { en: "Toggle list", es: "Lista plegable" },
  'shortcut.undo': { en: "Undo", es: "Deshacer" },
  'shortcut.redo': { en: "Redo", es: "Rehacer" },
  'shortcut.indent': { en: "Nest the block (in a table, next cell)", es: "Meter el bloque un nivel (en una tabla, la celda siguiente)" },
  'shortcut.outdent': { en: "Un-nest the block (in a table, previous cell)", es: "Sacar el bloque un nivel (en una tabla, la celda anterior)" },
  'shortcut.moveUp': { en: "Move the block up (a collapsed heading takes its whole section)", es: "Subir el bloque (un título colapsado lleva su sección entera)" },
  'shortcut.moveDown': { en: "Move the block down (a collapsed heading takes its whole section)", es: "Bajar el bloque (un título colapsado lleva su sección entera)" },
  'shortcut.lineBreak': { en: "Line break inside the block", es: "Salto de renglón dentro del bloque" },
  'shortcut.link': { en: "With text selected: link", es: "Con texto elegido: link" },
  'shortcut.bold': { en: "Bold", es: "Negrita" },
  'shortcut.italic': { en: "Italic", es: "Cursiva" },
  'shortcut.underline': { en: "Underline", es: "Subrayado" },
  'shortcut.strike': { en: "Strikethrough", es: "Tachado" },
  'shortcut.code': { en: "Code", es: "Código" },
  'shortcut.mdSlash': { en: "The / menu (on an empty line)", es: "El menú / (en un renglón vacío)" },
  'shortcut.mdHeading': { en: "Heading 1, 2, 3…", es: "Título 1, 2, 3…" },
  'shortcut.mdBullet': { en: "Bulleted list", es: "Lista con viñetas" },
  'shortcut.mdNumbered': { en: "Numbered list", es: "Lista numerada" },
  'shortcut.mdChecklist': { en: "Checklist", es: "Lista de casillas" },
  'shortcut.mdQuote': { en: "Quote", es: "Cita" },
  'shortcut.mdDivider': { en: "Divider", es: "Divisor" },
  'shortcut.mdCode': { en: "Code block", es: "Bloque de código" },
  'shortcut.photoOpen': {
    en: "Open the selected photo (with several, the first; an attachment: open or download; a folder: its viewer)",
    es: "Abrir la foto elegida (con varias, la primera; un adjunto: abrir o bajar; una carpeta: su visor)",
  },
  'shortcut.photoRowNext': { en: "In a row: next photo", es: "En una fila: la foto siguiente" },
  'shortcut.photoRowPrev': { en: "In a row: previous photo", es: "En una fila: la foto anterior" },
  'shortcut.photoRowLeave': { en: "In a row: leave the row", es: "En una fila: salir de la fila" },
  'shortcut.photoRowEnter': { en: "In a row: new line after the whole row", es: "En una fila: renglón nuevo después de toda la fila" },
  'shortcut.photoInlineSelect': {
    en: "Photo in a line selected: select more photos and text, like letters",
    es: "Foto de un renglón elegida: elegir más fotos y texto, como letras",
  },
  'shortcut.photoInlineType': {
    en: "Photo in a line selected: a new line after it (a letter is written after it, never replacing it)",
    es: "Foto de un renglón elegida: renglón nuevo después de ella (una letra se escribe después, nunca la reemplaza)",
  },
  'shortcut.carretePrev': { en: "Previous", es: "Anterior" },
  'shortcut.carreteNext': { en: "Next", es: "Siguiente" },
  'shortcut.carreteEnds': { en: "First / last", es: "Primera / última" },
  'shortcut.carreteClose': { en: "Close", es: "Cerrar" },
  'shortcut.carreteAnnotate': { en: "Annotate the photo (if you can edit the page)", es: "Anotar la foto (si podés editar la página)" },
  'shortcut.annotateSelect': { en: "Select and move shapes", es: "Elegir y mover formas" },
  'shortcut.annotateRectangle': { en: "Rectangle", es: "Rectángulo" },
  'shortcut.annotateEllipse': { en: "Ellipse", es: "Elipse" },
  'shortcut.annotateArrow': { en: "Arrow", es: "Flecha" },
  'shortcut.annotateLine': { en: "Line", es: "Línea" },
  'shortcut.annotatePencil': { en: "Pencil", es: "Lápiz" },
  'shortcut.annotateMarker': { en: "Marker", es: "Marcador" },
  'shortcut.annotateText': { en: "Text", es: "Texto" },
  'shortcut.annotateNumber': { en: "Number (each click, the next one)", es: "Número (cada clic, el siguiente)" },
  'shortcut.annotateWidth': {
    en: "Thinner / thicker: the selected shape under the pointer, or the next one",
    es: "Más fino / más grueso: la forma elegida bajo el cursor, o la próxima",
  },
  'shortcut.annotateWidthNext': { en: "Thinner / thicker, always the next shape", es: "Más fino / más grueso, siempre la próxima forma" },
  'shortcut.annotateUndo': { en: "Undo (only on this photo)", es: "Deshacer (solo en esta foto)" },
  'shortcut.annotateRedo': { en: "Redo", es: "Rehacer" },
  'shortcut.annotateDelete': { en: "Delete the selected shapes", es: "Borrar las formas elegidas" },
  'shortcut.annotateEscape': { en: "Deselect; with nothing selected, close", es: "Dejar de elegir; sin nada elegido, cerrar" },
  'shortcut.annotateFit': { en: "Fit the whole photo", es: "Encuadrar la foto entera" },
  'shortcut.annotatePan': { en: "Hold and drag to move the zoomed photo", es: "Mantener y arrastrar para mover la foto ampliada" },
  'shortcut.annotateSave': { en: "Nothing to save: every shape is saved as you draw it", es: "Nada que guardar: cada forma se guarda apenas la dibujás" },
  'shortcut.findNext': { en: "Next match", es: "Coincidencia siguiente" },
  'shortcut.findPrev': { en: "Previous match", es: "Coincidencia anterior" },
  'shortcut.findClose': { en: "Close the bar (the match stays selected)", es: "Cerrar la barra (queda elegida la coincidencia)" },
  'shortcut.findReplace': {
    en: "In the replace field: replace this match and go to the next",
    es: "En el campo de reemplazar: reemplazar esta coincidencia y pasar a la siguiente",
  },
  'shortcut.commentsSend': { en: "Send the comment", es: "Mandar el comentario" },
  'shortcut.commentsCancel': { en: "Cancel (on a phone, close the sheet)", es: "Cancelar (en el teléfono, cerrar la hoja)" },
  'shortcut.treeStep': { en: "Open the previous / next page", es: "Abrir la página anterior / siguiente" },
  'shortcut.treeEnds': { en: "First / last page", es: "Primera / última página" },
  'shortcut.treeExpand': { en: "Expand, or go to the first subpage", es: "Desplegar, o ir a la primera subpágina" },
  'shortcut.treeCollapse': { en: "Collapse, or go to the parent page", es: "Plegar, o ir a la página madre" },
  'shortcut.treeOpen': { en: "Open the page", es: "Abrir la página" },
  'shortcut.treeRename': { en: "Renaming: save / cancel", es: "Al renombrar: guardar / cancelar" },
  'shortcut.sidebarResize': {
    en: "On the sidebar edge: narrower, wider, narrowest, widest",
    es: "En el borde de la barra lateral: más angosta, más ancha, mínima, máxima",
  },
  'shortcut.menusMove': { en: "Go through the items of a menu", es: "Recorrer los ítems de un menú" },
  'shortcut.menusClose': { en: "Close a menu or a dialog", es: "Cerrar un menú o un diálogo" },
  'shortcut.listPick': {
    en: "In the project list, the search panel and the Drive paste menu: move and choose",
    es: "En la lista de proyectos, el panel de buscar y el menú de pegar Drive: moverse y elegir",
  },
  'shortcut.listClose': { en: "Close that list", es: "Cerrar esa lista" },
  'shortcut.mentionPick': {
    en: "With the @ list open: choose who to mention and put them in",
    es: "Con la lista del @ abierta: elegir a quién mencionar y ponerlo",
  },
  'shortcut.mentionClose': {
    en: "Close the @ list without erasing what you wrote",
    es: "Cerrar la lista del @ sin borrar lo escrito",
  },
  'shortcut.mentionShareCancel': {
    en: "Close the question to share the page with someone you mention, without sharing",
    es: "Cerrar la pregunta de compartir la página con quien mencionás, sin compartir",
  },
  'shortcut.versionName': {
    en: "Naming a version in the history: save / leave it as it was",
    es: "Al ponerle nombre a una versión del historial: guardar / dejar como estaba",
  },
  'shortcut.photoDelete': { en: "Photos selected: delete them", es: "Fotos elegidas: borrarlas" },
  'shortcut.pasteFiles': {
    en: "Paste files: photos and videos into the line, where the cursor is (other files, as a card)",
    es: "Pegar archivos: fotos y videos en el renglón, donde está el cursor (los demás, como tarjeta)",
  },
  'shortcut.folderUp': { en: "Folder viewer: up one level (at the top, close)", es: "Visor de una carpeta: subir un nivel (arriba de todo, cerrar)" },
  'shortcut.tabsMove': {
    en: "Tabs of a window (Install app): previous / next tab, first / last",
    es: "Pestañas de una ventana (Instalar la app): anterior / siguiente, primera / última",
  },
  'shortcut.tourNext': { en: "Next step", es: "Paso siguiente" },
  'shortcut.tourBack': { en: "Previous step", es: "Paso anterior" },
  'shortcut.tourExit': { en: "Leave the tour (it can be replayed from the help)", es: "Salir de la recorrida (se vuelve a ver desde la ayuda)" },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(help);
