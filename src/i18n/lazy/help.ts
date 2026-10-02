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

  // --- Los lugares de la tabla de atajos ---
  'help.place.global': { en: "Anywhere (with a page open)", es: "En toda la app (con una página abierta)" },
  'help.place.editor': { en: "In the editor", es: "En el editor" },
  'help.place.markdown': { en: "Typed at the start of a line", es: "Escrito al principio de un renglón" },
  'help.place.photos': { en: "Photos", es: "Fotos" },
  'help.place.carrete': { en: "Full-screen viewer", es: "Carrete (pantalla completa)" },
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
    en: "Titles like 064 | Name | Place show in the sidebar as a code and a name: Short titles in the ⋯ menu turns it on for a page and everything inside. Above the title, a page can show the pages that contain it.",
    es: "Títulos como 064 | Nombre | Lugar se ven en la barra lateral como un código y un nombre: Títulos cortos, en el menú ⋯, lo prende para una página y todo lo de adentro. Arriba del título, una página puede mostrar las que la contienen.",
  },
  'help.title.title': { en: "The page title", es: "El título de la página" },
  'help.title.text': { en: "{enter} in the title moves you to the text.", es: "{enter} en el título te pasa al texto." },
  'help.projects.title': { en: "Projects", es: "Proyectos" },
  'help.projects.text': {
    en: "Each show or job is a project with its own page tree. Switch projects or create one from the top of the sidebar; {search} lists them too.",
    es: "Cada serie o trabajo es un proyecto con su propio árbol de páginas. Cambiá de proyecto o creá uno desde arriba de la barra lateral; {search} también los muestra.",
  },
  'help.projectsArchive.title': { en: "Archive and delete projects", es: "Archivar y borrar proyectos" },
  'help.projectsArchive.text': {
    en: "Hover a project in the list (on a phone, tap its ⋯) to rename, archive or delete it. An archived project leaves the everyday list but can still be opened and edited. Deleting asks you to type delete and moves it to Deleted projects: nobody sees it, and Restore brings it back exactly as it was.",
    es: "Pasá el mouse por un proyecto de la lista (en el teléfono, tocá su ⋯) para renombrarlo, archivarlo o borrarlo. Un archivado sale de la lista de todos los días pero se sigue abriendo y editando. Borrar pide escribir borrar y lo pasa a Proyectos borrados: nadie lo ve, y Restaurar lo deja tal como estaba.",
  },
  'help.projectsDrive.title': { en: "Its files in Google Drive", es: "Sus archivos en Google Drive" },
  'help.projectsDrive.text': {
    en: "When the workspace owner or an admin deletes a project, Also send its files to the Google Drive trash sends its whole folder to the Drive trash; it starts unticked. Google deletes it for good after 30 days; Restore before that brings the folder back with everything in it. From Deleted projects you can also send it later. If Google Drive no longer has the folder, the app asks before restoring the pages without their files, and Look for its files again, on the project's start page, brings them back if the folder turns up.",
    es: "Cuando el dueño del workspace o un admin borra un proyecto, Mandar también sus archivos a la papelera de Google Drive manda su carpeta entera a la papelera de Drive; arranca destildada. Google la borra para siempre a los 30 días; Restaurar antes la trae de vuelta con todo lo de adentro. Desde Proyectos borrados también se puede mandar después. Si Google Drive ya no tiene la carpeta, la app pregunta antes de restaurar las páginas sin sus archivos, y Buscar sus archivos de nuevo, en el inicio del proyecto, los trae si la carpeta aparece.",
  },
  'help.workspaces.title': { en: "Workspaces", es: "Workspaces" },
  'help.workspaces.text': {
    en: "The app can connect to several workspaces. Each one is an island on its owner's own servers and Google Drive: nothing goes from one to another. Switch workspaces from the project list.",
    es: "La app se puede conectar a varios workspaces. Cada uno es una isla en los servidores y el Google Drive de su dueño: nada pasa de uno a otro. Cambiá de workspace desde la lista de proyectos.",
  },

  // --- Escribir ---
  'help.slash.title': { en: "The / menu", es: "El menú /" },
  'help.slash.text': {
    en: "Type / on an empty line to add headings, lists, checklists, a table, a quote, code, a divider, an image, Script, a question or a page break. Keep typing to filter; ↑ ↓ and Enter pick, Esc closes.",
    es: "Escribí / en un renglón vacío para sumar títulos, listas, casillas, una tabla, una cita, código, un divisor, una foto, Script, una pregunta o un salto de hoja. Seguí escribiendo para filtrar; ↑ ↓ y Enter eligen, Esc cierra.",
  },
  'help.blocks.title': { en: "Moving blocks", es: "Mover bloques" },
  'help.blocks.text': {
    en: "Each block has a handle on its left: drag it to move the block, click it to select the block and open its bar. {up} and {down} move it with the keyboard; {indent} and {outdent} nest it.",
    es: "Cada bloque tiene un tirador a su izquierda: arrastralo para mover el bloque, o hacé clic para elegirlo y abrir su barra. {up} y {down} lo mueven con el teclado; {indent} y {outdent} lo meten o lo sacan un nivel.",
  },
  'help.format.title': { en: "Formatting text", es: "Dar formato al texto" },
  'help.format.text': {
    en: "Select text to get the formatting bar: bold, italic, colors, links. {bold} bold, {italic} italic, {underline} underline, {strike} strikethrough, {code} code, {link} link.",
    es: "Elegí texto y aparece la barra de formato: negrita, cursiva, colores, links. {bold} negrita, {italic} cursiva, {underline} subrayado, {strike} tachado, {code} código, {link} link.",
  },
  'help.blockTypes.title': { en: "Headings, lists and quotes", es: "Títulos, listas y citas" },
  'help.blockTypes.text': {
    en: "{heading} heading 1 to 6, {paragraph} normal text, {quote} quote, {numbered} numbered list, {bullet} bulleted list, {checklist} checklist, {toggle} toggle list.",
    es: "{heading} título 1 a 6, {paragraph} texto común, {quote} cita, {numbered} lista numerada, {bullet} lista con viñetas, {checklist} lista de casillas, {toggle} lista plegable.",
  },
  'help.markdown.title': { en: "Typing shortcuts", es: "Atajos al escribir" },
  'help.markdown.text': {
    en: "At the start of a line: # (to ######) and a space make a heading, - a bulleted list, 1. a numbered list, [] a checklist, > a quote, --- a divider and ``` a code block.",
    es: "Al principio de un renglón: # (hasta ######) y un espacio hacen un título, - una lista con viñetas, 1. una numerada, [] una de casillas, > una cita, --- un divisor y ``` un bloque de código.",
  },
  'help.script.title': { en: "Script", es: "Script (guion)" },
  'help.script.text': {
    en: "Script is text in a screenplay typeface ({script}, or / Script). INT/EXT, DAY, NIGHT and DAWN/DUSK are marked in color. Enter keeps writing Script; on an empty line it goes back to normal text.",
    es: "Script es texto con la tipografía de los guiones ({script}, o / Guion). INT/EXT, DÍA, NOCHE y AMANECER/ATARDECER se marcan con color. Enter sigue en Script; en un renglón vacío vuelve al texto común.",
  },
  'help.undo.title': { en: "Undo", es: "Deshacer" },
  'help.undo.text': {
    en: "{undo} undoes, {redo} redoes. Deleting blocks, a section or the whole page is always a single undo step.",
    es: "{undo} deshace, {redo} rehace. Borrar bloques, una sección o la página entera es siempre un solo paso de deshacer.",
  },

  // --- Fotos y videos ---
  'help.photosAdd.title': { en: "Adding photos and videos", es: "Sumar fotos y videos" },
  'help.photosAdd.text': {
    en: "Paste them ({paste}), drop them or choose them with / Image: they go into the line, where the cursor is or where you drop them (one at its own size, several at a third each); other files go below as a card. With Google Drive connected they're stored in the workspace owner's Drive (videos too). iPhone photos (HEIC) are saved as JPEG.",
    es: "Pegalas ({paste}), soltalas o elegilas con / Imagen: entran en el renglón, donde está el cursor o donde las soltás (una con su tamaño, varias a un tercio cada una); los demás archivos van abajo, como tarjeta. Con Google Drive conectado se guardan en el Drive del dueño del workspace (también los videos). Las fotos del iPhone (HEIC) se guardan como JPEG.",
  },
  'help.photosInline.title': { en: "Photos in the line, like letters", es: "Fotos en el renglón, como letras" },
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
  'help.carrete.title': { en: "The full-screen viewer", es: "El carrete" },
  'help.carrete.text': {
    en: "Shows every photo, video and file of the page: {prev} {next} to go through them, {ends} to jump to the first or last, scroll or double-click to zoom, {close} to close. Download gets the original.",
    es: "Muestra todas las fotos, los videos y los archivos de la página: {prev} {next} para recorrerlos, {ends} para ir al primero o al último, la rueda o un doble clic para el zoom, {close} para cerrar. Descargar baja el original.",
  },
  'help.photosPhone.title': { en: "On the phone", es: "En el teléfono" },
  'help.photosPhone.text': {
    en: "Tap a photo to see it full size; back on the page, tap it again for its bar and handles. Photos in a row can show side by side or one under the other: Images in a row, in the account menu.",
    es: "Tocá una foto para verla en grande; de vuelta en la página, tocala otra vez y aparecen su barra y sus tiradores. Las fotos en fila se pueden ver una al lado de la otra o apiladas: Fotos en fila, en el menú de la cuenta.",
  },
  'help.photosCamera.title': { en: "Take a photo or record a video", es: "Sacar una foto o filmar" },
  'help.photosCamera.text': {
    en: "On the phone, type / and choose Take photo or Record video, or use the page menu (•••). The camera opens and what you shoot goes in the line, at the cursor (from the page menu without a cursor, at the end of the page), and uploads like any photo. To keep a copy on the phone, select the photo or video and tap Save to camera roll, then Save Image or Save Video in the share sheet. Videos need the workspace's Drive.",
    es: "En el teléfono, escribí / y elegí Sacar una foto o Filmar un video, o usá el menú de la página (•••). Se abre la cámara y lo que saques va en el renglón, donde está el cursor (desde el menú de la página sin cursor, al final de la página), y sube como cualquier foto. Para guardar una copia en el teléfono, elegí la foto o el video y tocá Guardar en Fotos, y después Guardar imagen o Guardar video en la hoja de compartir. Los videos necesitan el Drive del workspace.",
  },
  'help.photosOffline.title': { en: "Without a connection", es: "Sin conexión" },
  'help.photosOffline.text': {
    en: "Photos added offline are saved on this device and upload by themselves when you're back online; the page shows them right away.",
    es: "Las fotos que agregás sin red quedan guardadas en este dispositivo y se suben solas cuando vuelve la conexión; la página las muestra enseguida.",
  },

  // --- Adjuntos ---
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
    en: "The card says how it is going; click it to see the upload: Pause, Resume, Retry for the files that failed. If you close the tab, drop the same folder on its card again (or Choose the folder…): only what is missing goes up. Dropping the same folder elsewhere in the page offers to continue it. Stop uploading forgets it on this device (what reached Drive stays).",
    es: "La tarjeta dice cómo va; un clic muestra la subida: Pausar, Seguir, Reintentar los archivos que fallaron. Si cerrás la pestaña, soltá la misma carpeta otra vez en su tarjeta (o Elegir la carpeta…): sube solo lo que falta. Soltar la misma carpeta en otro lugar de la página ofrece seguirla. Dejar de subir la olvida en este dispositivo (lo que llegó a Drive queda).",
  },
  'help.folderOpen.title': { en: "Open a folder", es: "Abrir una carpeta" },
  'help.folderOpen.text': {
    en: "Click the card twice (once on the phone or without edit access), press {open} with it selected, or Open in its bar. You see what is in the Drive folder right now: subfolders first, then files with their thumbnail. A photo or a video opens in the viewer; a PDF opens in a new tab; the rest downloads. {up} goes up one level.",
    es: "Dos clics en la tarjeta (uno en el teléfono o sin permiso de editar), {open} con la tarjeta elegida, o Abrir en su barra. Ves lo que hay ahora en la carpeta de Drive: primero las subcarpetas, después los archivos con su miniatura. Una foto o un video se abren en el carrete; un PDF, en otra pestaña; lo demás se baja. {up} sube un nivel.",
  },
  'help.folderDownload.title': { en: "Download a whole folder", es: "Bajar una carpeta entera" },
  'help.folderDownload.text': {
    en: "Download all, in the folder viewer or in the card's bar, saves everything inside with its subfolders. In Chrome and Edge on a computer you choose where the .zip goes, or Download to a folder… writes the files as they are. Firefox, Safari and phones build the zip in memory: up to 1 GB (500 MB on a phone). Shortcuts, Google documents and anything that fails are listed in MISSING_FILES.txt. It needs a connection; keep the tab open until it finishes.",
    es: "Bajar todo, en el visor de la carpeta o en la barra de la tarjeta, guarda todo lo de adentro con sus subcarpetas. En Chrome y Edge de computadora elegís dónde va el .zip, o Bajar a una carpeta… escribe los archivos tal cual. Firefox, Safari y los teléfonos arman el zip en memoria: hasta 1 GB (500 MB en un teléfono). Los accesos directos, los documentos de Google y lo que falle quedan anotados en MISSING_FILES.txt. Hace falta conexión; dejá la pestaña abierta hasta que termine.",
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
  'help.questions.title': { en: "Questions", es: "Preguntas" },
  'help.questions.text': {
    en: "A question is a line marked with a ? icon ({question}, or / Question). Anyone who can comment answers it in a thread, without editing the page.",
    es: "Una pregunta es un renglón marcado con un ícono ? ({question}, o / Pregunta). Quien puede comentar la contesta en un hilo, sin editar la página.",
  },

  // --- Buscar ---
  'help.findPage.title': { en: "Find and replace in the page", es: "Buscar y reemplazar en la página" },
  'help.findPage.text': {
    en: "{find} or the magnifying glass at the top finds in the open page; the arrow opens Replace (if you can edit). {next} next match, {prev} previous, {close} closes and leaves the match selected. {find} again inside the bar opens the browser's own search.",
    es: "{find} o la lupa de arriba buscan en la página abierta; la flecha despliega Reemplazar (si podés editar). {next} siguiente, {prev} anterior, {close} cierra y deja elegida la coincidencia. {find} otra vez dentro de la barra abre la búsqueda del navegador.",
  },
  'help.findProject.title': { en: "Search the whole project", es: "Buscar en todo el proyecto" },
  'help.findProject.text': {
    en: "{search} or the magnifying glass next to + searches the titles and text of every page in the project, offline too, and takes you to the exact spot. It also lists matching projects. The arrow left of the field opens Replace.",
    es: "{search} o la lupa al lado del + buscan en los títulos y el texto de todas las páginas del proyecto, también sin red, y te llevan al lugar exacto. También muestran los proyectos que coinciden. La flecha a la izquierda del campo despliega Reemplazar.",
  },
  'help.replaceProject.title': { en: "Replace in the whole project", es: "Reemplazar en todo el proyecto" },
  'help.replaceProject.text': {
    en: "Open {search} and use the arrow left of the field (if you can edit pages). Accents don't matter (camara finds cámara) unless you turn on Aa, but ñ is its own letter (ano doesn't find año). Each match shows the old text crossed out and the new one next to it; replace one, a whole page or all of them. Replace all asks first how many changes in how many pages, and says how many are in collapsed sections (deleting those needs its checkbox). Page titles, captions and file names don't change, and neither do pages you can only view or that aren't downloaded yet. Undo, in the notice or in the panel, puts back everything that wasn't changed afterwards; it works offline and after closing the app, on the device where you replaced. {undo} in the page doesn't undo it.",
    es: "Abrí {search} y usá la flecha a la izquierda del campo (si podés editar páginas). Las tildes no cuentan (camara encuentra cámara) salvo con Aa, pero la ñ es otra letra (ano no encuentra año). Cada coincidencia muestra lo de antes tachado y lo nuevo al lado; reemplazá una, una página entera o todas. Reemplazar todo pregunta antes cuántos cambios en cuántas páginas, y dice cuántas están en secciones colapsadas (borrarlas pide su casilla). No cambian los títulos de las páginas, los pies ni los nombres de archivo, ni las páginas que solo podés ver o que todavía no bajaron. Deshacer, en el aviso o en el panel, vuelve a poner todo lo que nadie cambió después; anda sin red y después de cerrar la app, en el dispositivo donde reemplazaste. {undo} en la página no lo deshace.",
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
    en: "Share from the ⋯ menu: view, comment, edit, or edit and create pages. A permission covers everything under that page and never what's above it.",
    es: "Se comparte desde el menú ⋯: ver, comentar, editar, o editar y crear páginas. Un permiso vale para todo lo de abajo de esa página y nunca para lo de arriba.",
  },
  'help.members.title': { en: "Members and guests", es: "Miembros e invitados" },
  'help.members.text': {
    en: "The owner and the admins invite people from Members, in the account menu. Clients join as guests and only see what's shared with them.",
    es: "El dueño y los admins invitan gente desde Miembros, en el menú de la cuenta. Los clientes entran como invitados y ven solo lo que se les comparte.",
  },

  'help.deletedPrivacy.title': { en: "Who can see what was deleted", es: "Quién ve lo que se borró" },
  'help.deletedPrivacy.text': {
    en: "People who can edit a page (not guests) see everything that was deleted, like in the version history. People who only view or comment, and guests, get a clean copy of the page instead: the page as it was the last time an editor's app prepared it, about 20 seconds after you stop typing, every 2 minutes while you keep typing (longer for very large pages) and when you close the app. Until an editor prepares it, they see that the page is being prepared. Something that stayed on the page for a while may have reached them even if you delete it later; something deleted within seconds almost never does. They can tell that something was deleted and how long it was, not what it said. Photos and files removed from a page stop opening for them. What a device already downloaded can't be taken back from it. Until the workspace turns clean copies on, deleted text and photos can still reach the people a page is shared with.",
    es: "Quienes pueden editar una página (no los invitados) ven todo lo que se borró, como en el historial de versiones. Quienes solo ven o comentan, y los invitados, reciben en cambio una copia limpia de la página: la página como estaba la última vez que la app de alguien que edita la preparó, unos 20 segundos después de que dejás de escribir, cada 2 minutos mientras seguís escribiendo (más espaciado en páginas muy grandes) y al cerrar la app. Hasta que alguien que edita la prepara, ven que la página está en preparación. Algo que quedó un rato en la página les pudo haber llegado aunque después lo borres; algo borrado en segundos casi nunca. Pueden saber que se borró algo y cuánto ocupaba, no qué decía. Las fotos y archivos que se sacan de una página dejan de abrirse para ellos. Lo que un dispositivo ya bajó no se le puede quitar. Hasta que el workspace prenda las copias limpias, el texto y las fotos borrados todavía les pueden llegar a las personas con quienes se comparte una página.",
  },

  // --- Papelera ---
  'help.history.title': { en: "Version history", es: "Historial de versiones" },
  'help.history.text': {
    en: "In the page menu, Version history ({open}) lists who changed the page and when, grouped by editing session, in your local time (the time a change reached the server: what was written offline shows when it synced). Choose a version to see the page as it was; select and copy any part of it. Restore this version makes the page look like that again as a new change: nothing is lost, the version you had stays in the history and you undo it with {undo}. Restoring needs a connection and the page synced. Anyone who can edit the page sees its history; guests don't.",
    es: "En el menú de la página, Historial de versiones ({open}) muestra quién cambió la página y cuándo, agrupado por sesión de edición, en tu hora (la hora en que el cambio llegó al servidor: lo escrito sin conexión figura cuando se sincronizó). Elegí una versión para ver la página como era; podés elegir y copiar cualquier parte. Restaurar esta versión deja la página otra vez así, como un cambio nuevo: no se pierde nada, la versión que tenías queda en el historial y se deshace con {undo}. Restaurar pide conexión y la página sincronizada. Ven el historial quienes pueden editar la página; los invitados, no.",
  },
  'help.historyChanges.title': { en: "See what changed", es: "Ver qué cambió" },
  'help.historyChanges.text': {
    en: "In Version history, Show changes (on by default) compares each version with the previous one in the list: what was added is underlined and what was deleted is struck through, in the color of the person who did it (point at a mark, or touch it on the phone, to see who and when). A whole block added or deleted gets a bar on its left, and a block that changed its type or formatting says so (Changed to Heading 2). Text someone wrote in a part that had already been removed shows above the version, with Copy. Turn Show changes off to see the version as it was. The list updates by itself when new changes arrive.",
    es: "En el historial de versiones, Mostrar cambios (prendido de entrada) compara cada versión con la anterior de la lista: lo agregado va subrayado y lo borrado tachado, con el color de quien lo hizo (señalá una marca, o tocala en el teléfono, para ver quién y cuándo). Un bloque entero agregado o borrado lleva una barra a la izquierda, y uno que cambió de tipo o de formato lo dice (Cambió a Título 2). Lo que alguien escribió en una parte que ya se había borrado aparece arriba de la versión, con Copiar. Apagá Mostrar cambios para ver la versión tal como era. La lista se actualiza sola cuando llegan cambios nuevos.",
  },
  'help.historyNames.title': { en: "Name versions", es: "Ponerle nombre a una versión" },
  'help.historyNames.text': {
    en: "In Version history, the ⋯ button of a version lets you name it (Draft for the client, Shooting day 1), rename it or remove the name; Only named versions shows just those and the current one. What is written after a named version goes into a new one. Whoever named it, or someone who can edit and create pages there, can change the name. After restoring, the list says Restored from and the date of that version. Without a connection you still see the history up to the last time it was downloaded on this device; naming and restoring need a connection.",
    es: "En el historial de versiones, el botón ⋯ de una versión sirve para ponerle nombre (Borrador para el cliente, Rodaje día 1), cambiárselo o quitarlo; Solo versiones con nombre muestra esas y la actual. Lo que se escribe después de una versión con nombre va a una nueva. El nombre lo cambia quien lo puso, o quien puede editar y crear páginas ahí. Después de restaurar, la lista dice Restaurada desde y la fecha de esa versión. Sin conexión se sigue viendo el historial hasta la última vez que se bajó en este dispositivo; ponerle nombre y restaurar piden conexión.",
  },
  'help.trash.title': { en: "Trash", es: "Papelera" },
  'help.trash.text': {
    en: "Sending a page to the Trash, at the bottom of the sidebar, takes its subpages with it; Restore brings everything back where it was. With Google Drive connected, its Files tab lists the photos and files no page uses anymore (the owner and admins manage it).",
    es: "Mandar una página a la papelera, abajo en la barra lateral, se lleva sus subpáginas; Restaurar devuelve todo a su lugar. Con Google Drive conectado, su pestaña Archivos muestra las fotos y los archivos que ya no usa ninguna página (los manejan el dueño y los admins).",
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
    en: "Storage on this device, in the account menu, shows how much Shot Docs keeps here and what is available offline. Copies of files already in Drive are kept up to a limit you choose (2 GB by default); past it, the app asks before removing the ones opened least recently. Pages marked offline, photos added on this device and anything not uploaded yet are never removed to make room.",
    es: "Espacio en este dispositivo, en el menú de la cuenta, muestra cuánto guarda Shot Docs acá y qué está disponible sin conexión. Las copias de archivos que ya están en Drive se guardan hasta un tope que elegís (2 GB de fábrica); pasado el tope, la app pregunta antes de sacar las que hace más que no se abren. Lo marcado sin conexión, las fotos agregadas en este dispositivo y lo que todavía no se subió nunca se sacan para hacer lugar.",
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
  'help.pdf.title': { en: "PDF and printing", es: "PDF e impresión" },
  'help.pdf.text': {
    en: "{print} or ⋯ › Export PDF / Print opens the browser's print dialog with the same sheet breaks you see; choose Save as PDF there.",
    es: "{print} o ⋯ › Exportar PDF / Imprimir abre la impresión del navegador con los mismos cortes de hoja que ves; ahí elegí Guardar como PDF.",
  },

  // --- Preferencias ---
  'help.prefs.title': { en: "Appearance", es: "Apariencia" },
  'help.prefs.text': {
    en: "In the account menu: light, dark or system theme, default or editorial typeface, text size and page width. They're saved in your account and follow you to every device.",
    es: "En el menú de la cuenta: tema claro, oscuro o del sistema, letra común o editorial, tamaño del texto y ancho de la página. Se guardan en tu cuenta y te siguen a cada dispositivo.",
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
  'shortcut.heading': { en: "Heading 1 to 6", es: "Título 1 a 6" },
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
  'shortcut.findNext': { en: "Next match", es: "Coincidencia siguiente" },
  'shortcut.findPrev': { en: "Previous match", es: "Coincidencia anterior" },
  'shortcut.findClose': { en: "Close the bar (the match stays selected)", es: "Cerrar la barra (queda elegida la coincidencia)" },
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
