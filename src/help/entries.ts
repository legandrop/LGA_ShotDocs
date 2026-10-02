import type { Key } from '../i18n';
import '../i18n/lazy/help';

// Las entradas de la ayuda (Docs/Doc_Tutorial.md, sección 5). Regla del repo: toda función nueva que ve un
// usuario suma acá su entrada (con sus textos en `src/i18n/lazy/help.ts`, en los dos idiomas) y sus atajos en
// `src/ui/shortcuts.ts`, en la misma tanda. Las claves van escritas enteras: la prueba del diccionario las busca
// literales en el código.

export type HelpSection =
  | 'start'
  | 'pages'
  | 'writing'
  | 'photos'
  | 'attachments'
  | 'drive'
  | 'comments'
  | 'find'
  | 'collapse'
  | 'sharing'
  | 'trash'
  | 'sync'
  | 'print'
  | 'prefs'
  | 'keys';

export const HELP_SECTIONS: { id: HelpSection; title: Key }[] = [
  { id: 'start', title: 'help.section.start' },
  { id: 'pages', title: 'help.section.pages' },
  { id: 'writing', title: 'help.section.writing' },
  { id: 'photos', title: 'help.section.photos' },
  { id: 'attachments', title: 'help.section.attachments' },
  { id: 'drive', title: 'help.section.drive' },
  { id: 'comments', title: 'help.section.comments' },
  { id: 'find', title: 'help.section.find' },
  { id: 'collapse', title: 'help.section.collapse' },
  { id: 'sharing', title: 'help.section.sharing' },
  { id: 'trash', title: 'help.section.trash' },
  { id: 'sync', title: 'help.section.sync' },
  { id: 'print', title: 'help.section.print' },
  { id: 'prefs', title: 'help.section.prefs' },
  { id: 'keys', title: 'help.section.keys' },
];

/** Para quién está una función: si la persona no la puede usar, la entrada se ve apagada con el porqué. */
export type HelpWhen = 'portero' | 'admin' | 'owner' | 'notInstalled';

export interface HelpEntry {
  id: string;
  section: HelpSection;
  title: Key;
  text: Key;
  /**
   * Los atajos que nombra el texto: `{nombre}` del texto → id del registro (shortcuts.ts). El rótulo sale del
   * registro al mostrarla, así nunca queda viejo; la búsqueda también los encuentra ("ctrl f").
   */
  keys?: Record<string, string>;
  /** Más atajos de la función, que la búsqueda encuentra aunque el texto no los nombre. */
  more?: string[];
  /** Palabras que la búsqueda encuentra aunque el texto no las diga (en cualquier idioma). */
  words?: string[];
  /** Lo que hace el botón de la entrada (la recorrida, la práctica). */
  action?: 'tour' | 'practice' | 'install';
  /** El paso de la recorrida que la muestra (para "Mostrame", entrega 3). */
  showMe?: string;
  /**
   * La versión de la app que la trajo (para las novedades, entrega 3). Lo que ya estaba antes de la ayuda lleva
   * `BEFORE_HELP`: las novedades se cuentan desde la primera vez que se abre la ayuda.
   */
  since: string;
  when?: HelpWhen;
}

/** Lo que ya existía cuando llegó la ayuda (v0.082). */
const BEFORE_HELP = '0.081';
/** La versión que trajo la ayuda. */
const HELP = '0.082';
/** "Available offline" y el espacio en el dispositivo (P.10, Docs/Doc_Copias_Locales.md). */
const OFFLINE = '0.083';
/** La que trajo colapsar para todos y mover la sección entera (Doc_Colapsar.md, 1b y 2). */
const COLLAPSE_2 = '0.084';
/** El salto de hoja (fase 4, Docs/Doc_Hojas_PDF.md): la versión se pone al publicar, igual que en el changelog. */
const PAGE_BREAK = '0.093';
/**
 * La vista previa de los PDF adjuntos y los adjuntos en el carrete (Doc_Adjuntos.md, entrega 2).
 */
const ATTACH_PREVIEW = '0.091';
/** Quién ve lo borrado (Docs/Doc_Privacidad_Borrado.md, entregas 0 y 1): la versión se pone al publicar. */
const DELETED_PRIVACY = '0.104';
/** El historial de versiones de una página (P.18, Docs/Doc_Historial.md, entrega 1). */
const HISTORY = '0.098';
/** Los cambios marcados por persona en el historial (entrega 2; la versión la pone quien publica). */
const HISTORY_CHANGES = '0.103';
/** Las versiones con nombre y el historial sin red (entrega 3; la versión la pone quien publica). */
const HISTORY_NAMES = '0.106';
/** Reemplazar en todo el proyecto (Doc_Buscar.md, "Reemplazar en el proyecto"). */
const REPLACE_PROJECT = '0.094';
/** El aviso de lo que escribiste en algo que otro borró (roadmap B.16, Doc_Sincronizacion.md): la versión se pone al publicar. */
const REMOVED_WRITING = '0.095';
/** Las fotos en las celdas de una tabla (Doc_Fotos_En_Linea.md, entrega 5): la versión se pone al publicar. */
const CELL_PHOTOS = '0.107';
/** El alto de las miniaturas de una tabla (Doc_Fotos_En_Linea.md, D27 → B): la versión se pone al publicar. */
const CELL_THUMBS = '0.129';
/** La que trajo "Update now" que espera la versión nueva y "Force the update" (Doc_Sincronizacion.md, "Volver después de mucho tiempo sin red"). */
const UPDATE_APP = '0.097';
/** *Download all* de una carpeta (P.9, entrega 2, Doc_Carpetas.md): la versión se pone al publicar, igual que en el changelog. */
const FOLDER_ZIP = '0.105';
/** Sacar una foto o filmar desde la página y guardar en Fotos (camera.ts): la versión se pone al publicar. */
const CAMERA = '0.110';
/** El asistente, entrega A1 (Docs/Doc_Asistente.md): la versión se pone al publicar, igual que en el changelog. */
const ASSISTANT = '0.118';
/** El asistente, entrega A2 (la página entera, *Format as…*, la política del workspace): la versión la pone quien publica. */
const ASSISTANT_A2 = '0.126';
/** Las plantillas de fábrica (Docs/Doc_Plantillas.md, entregas 0 y 1): la versión se ajusta al publicar. */
const TEMPLATES = '0.117';
/** Las plantillas propias (Docs/Doc_Plantillas.md, entrega 3): la versión la pone quien publica. */
const OWN_TEMPLATES = '0.124';
/** El reporte del día (Docs/Doc_Plantillas.md, entrega 2): la versión la pone quien publica. */
const DAY_REPORTS = '0.121';
/** El link público, *Can view* (Doc_Link_Publico.md, entrega 1): la versión se pone al publicar, igual que en el changelog. */
const PUBLIC_LINK = '0.111';
/** Exportar una rama o un proyecto como PDF (P.22, Doc_Exportar.md, entrega 1): la versión se pone al publicar. */
const EXPORT_PDF = '0.122';
/** Exportar como zip (P.22, Doc_Exportar.md, entrega 2): la versión se pone al publicar. */
const EXPORT_ZIP = '0.129';
/** Las menciones en comentarios (P.21, Doc_Menciones.md, entrega 1): la versión se pone al publicar, igual que en el changelog. */
const MENTIONS = '0.120';
/** Menciones, entrega 2: compartir desde la mención, el punto del árbol y el número afuera (la versión la pone quien publica). */
const MENTIONS_SHARE = '0.125';
/** Ver las anotaciones de las fotos (P.20, Doc_Anotar_Fotos.md, entrega 1): la versión se pone al publicar. */
const PHOTO_MARKUP = '0.116';
/** Anotar las fotos en la compu (P.20, entrega 2). El número lo pone quien publica. */
const ANNOTATE = '0.123';
/** Anotar con el dedo y con el lápiz (P.20, entrega 3). El número lo pone quien publica. */
const ANNOTATE_TOUCH = '0.129';
/** Copiar y pegar una foto con sus anotaciones (P.20, D46). El número lo pone quien publica. */
const ANNOTATE_COPY = '0.0XX';

export const HELP_ENTRIES: HelpEntry[] = [
  // --- Primeros pasos ---
  { id: 'tour', section: 'start', title: 'help.tour.title', text: 'help.tour.text', action: 'tour', since: HELP },
  { id: 'practice', section: 'start', title: 'help.practice.title', text: 'help.practice.text', action: 'practice', since: HELP },
  {
    id: 'install',
    section: 'start',
    title: 'help.install.title',
    text: 'help.install.text',
    action: 'install',
    when: 'notInstalled',
    words: ['instalar', 'app', 'pantalla de inicio', 'home screen', 'iPhone', 'Android', 'PWA', 'Dock'],
    since: BEFORE_HELP,
  },

  // --- Páginas y proyectos ---
  { id: 'pagesTree', section: 'pages', title: 'help.pagesTree.title', text: 'help.pagesTree.text', showMe: 'pages', since: BEFORE_HELP },
  { id: 'pagesArrange', section: 'pages', title: 'help.pagesArrange.title', text: 'help.pagesArrange.text', since: BEFORE_HELP },
  {
    id: 'pagesKeys',
    section: 'pages',
    title: 'help.pagesKeys.title',
    text: 'help.pagesKeys.text',
    keys: { step: 'treeStep', ends: 'treeEnds' },
    more: ['treeExpand', 'treeCollapse', 'treeOpen', 'treeRename', 'sidebarResize'],
    since: BEFORE_HELP,
  },
  { id: 'pagesTitles', section: 'pages', title: 'help.pagesTitles.title', text: 'help.pagesTitles.text', since: BEFORE_HELP },
  { id: 'title', section: 'pages', title: 'help.title.title', text: 'help.title.text', keys: { enter: 'titleEnter' }, since: BEFORE_HELP },
  {
    id: 'templates',
    section: 'pages',
    title: 'help.templates.title',
    text: 'help.templates.text',
    keys: { enter: 'titleEnter', undo: 'undo' },
    words: ['template', 'plantilla', 'report', 'reporte', 'on-set', 'rodaje', 'breakdown', 'desglose', 'preproducción', 'pre-production', 'apply', 'aplicar'],
    since: TEMPLATES,
  },
  {
    id: 'ownTemplates',
    section: 'pages',
    title: 'help.ownTemplates.title',
    text: 'help.ownTemplates.text',
    words: ['template', 'plantilla', 'save as template', 'guardar como plantilla', 'customize', 'personalizar', 'templates folder', 'carpeta plantillas', 'clear', 'vaciar'],
    since: OWN_TEMPLATES,
  },
  {
    id: 'dayReports',
    section: 'pages',
    title: 'help.dayReports.title',
    text: 'help.dayReports.text',
    keys: { newReport: 'newDayReport' },
    words: ['day report', 'reporte del día', 'shoot day', 'día de rodaje', 'on-set', 'rodaje', 'unit', 'unidad', 'location', 'locación'],
    since: DAY_REPORTS,
  },
  {
    id: 'projects',
    section: 'pages',
    title: 'help.projects.title',
    text: 'help.projects.text',
    keys: { search: 'search' },
    showMe: 'project-switcher',
    since: BEFORE_HELP,
  },
  { id: 'projectsArchive', section: 'pages', title: 'help.projectsArchive.title', text: 'help.projectsArchive.text', since: BEFORE_HELP },
  { id: 'projectsDrive', section: 'pages', title: 'help.projectsDrive.title', text: 'help.projectsDrive.text', when: 'admin', since: BEFORE_HELP },
  { id: 'workspaces', section: 'pages', title: 'help.workspaces.title', text: 'help.workspaces.text', since: BEFORE_HELP },

  // --- Escribir ---
  { id: 'slash', section: 'writing', title: 'help.slash.title', text: 'help.slash.text', more: ['mdSlash'], showMe: 'slash', since: BEFORE_HELP },
  {
    id: 'blocks',
    section: 'writing',
    title: 'help.blocks.title',
    text: 'help.blocks.text',
    keys: { up: 'moveUp', down: 'moveDown', indent: 'indent', outdent: 'outdent' },
    since: BEFORE_HELP,
  },
  {
    id: 'format',
    section: 'writing',
    title: 'help.format.title',
    text: 'help.format.text',
    keys: { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strike', code: 'code', link: 'link' },
    more: ['lineBreak'],
    since: BEFORE_HELP,
  },
  {
    id: 'blockTypes',
    section: 'writing',
    title: 'help.blockTypes.title',
    text: 'help.blockTypes.text',
    keys: {
      heading: 'heading',
      paragraph: 'paragraph',
      quote: 'quote',
      numbered: 'numbered',
      bullet: 'bullet',
      checklist: 'checklist',
      toggle: 'toggle',
    },
    since: BEFORE_HELP,
  },
  {
    id: 'markdown',
    section: 'writing',
    title: 'help.markdown.title',
    text: 'help.markdown.text',
    more: ['mdHeading', 'mdBullet', 'mdNumbered', 'mdChecklist', 'mdQuote', 'mdDivider', 'mdCode'],
    since: BEFORE_HELP,
  },
  { id: 'script', section: 'writing', title: 'help.script.title', text: 'help.script.text', keys: { script: 'script' }, more: ['scriptEnter'], since: BEFORE_HELP },
  { id: 'undo', section: 'writing', title: 'help.undo.title', text: 'help.undo.text', keys: { undo: 'undo', redo: 'redo' }, more: ['selectAll'], since: BEFORE_HELP },
  {
    id: 'assistant',
    section: 'writing',
    title: 'help.assistant.title',
    text: 'help.assistant.text',
    keys: { open: 'assistant', undo: 'undo', apply: 'assistantApply' },
    words: ['asistente', 'corregir', 'ortografía', 'gramática', 'traducir', 'resumir', 'acortar', 'mejorar', 'assistant', 'fix', 'spelling', 'grammar', 'translate', 'improve', 'shorter', 'ai', 'ia', 'claude', 'gpt', 'gemini'],
    since: ASSISTANT,
  },
  {
    id: 'assistantKey',
    section: 'writing',
    title: 'help.assistantKey.title',
    text: 'help.assistantKey.text',
    words: ['clave', 'api key', 'key', 'proveedor', 'provider', 'anthropic', 'openai', 'gemini', 'openrouter', 'ollama', 'lm studio', 'tope', 'gasto', 'spending limit', 'olvidar', 'forget', 'local'],
    since: ASSISTANT,
  },
  {
    id: 'assistantPage',
    section: 'writing',
    title: 'help.assistantPage.title',
    text: 'help.assistantPage.text',
    keys: { undo: 'undo' },
    words: ['resumen', 'resumir', 'traducir página', 'subpágina', 'reemplazar', 'summary', 'summarize', 'translate page', 'subpage', 'replace', 'asistente', 'assistant'],
    since: ASSISTANT_A2,
  },
  {
    id: 'assistantFormat',
    section: 'writing',
    title: 'help.assistantFormat.title',
    text: 'help.assistantFormat.text',
    keys: { apply: 'assistantApply', undo: 'undo' },
    words: ['formato', 'forma', 'viñetas', 'casillas', 'tabla', 'títulos', 'format', 'bullets', 'checklist', 'table', 'headings', 'asistente', 'assistant'],
    since: ASSISTANT_A2,
  },
  {
    id: 'assistantPolicy',
    section: 'writing',
    title: 'help.assistantPolicy.title',
    text: 'help.assistantPolicy.text',
    words: ['política', 'apagar', 'modelos locales', 'policy', 'turn off', 'local models', 'asistente', 'assistant', 'dueño', 'owner', 'admin'],
    when: 'admin',
    since: ASSISTANT_A2,
  },

  // --- Fotos y videos ---
  { id: 'photosAdd', section: 'photos', title: 'help.photosAdd.title', text: 'help.photosAdd.text', keys: { paste: 'pasteFiles' }, since: BEFORE_HELP },
  {
    id: 'photosInline',
    section: 'photos',
    title: 'help.photosInline.title',
    text: 'help.photosInline.text',
    keys: { select: 'photoInlineSelect', delete: 'photoDelete' },
    more: ['photoInlineType', 'photoOpen'],
    words: ['shift', 'clic', 'click', 'arrastrar', 'drag', 'elegir', 'select'],
    since: BEFORE_HELP,
  },
  {
    id: 'photosOpen',
    section: 'photos',
    title: 'help.photosOpen.title',
    text: 'help.photosOpen.text',
    keys: { open: 'photoOpen' },
    showMe: 'practice-photos',
    since: BEFORE_HELP,
  },
  {
    id: 'photosRows',
    section: 'photos',
    title: 'help.photosRows.title',
    text: 'help.photosRows.text',
    keys: { next: 'photoRowNext', prev: 'photoRowPrev', leave: 'photoRowLeave', enter: 'photoRowEnter' },
    more: ['photoInlineSelect', 'photoInlineType'],
    since: BEFORE_HELP,
  },
  {
    id: 'photosCells',
    section: 'photos',
    title: 'help.photosCells.title',
    text: 'help.photosCells.text',
    words: ['tabla', 'table', 'celda', 'cell', 'miniatura', 'thumbnail'],
    since: CELL_PHOTOS,
  },
  {
    id: 'photosCellsSize',
    section: 'photos',
    title: 'help.photosCellsSize.title',
    text: 'help.photosCellsSize.text',
    words: ['tabla', 'table', 'miniatura', 'thumbnail', 'tamaño', 'size', 'alto', 'height', 'chico', 'grande', 'small', 'large'],
    since: CELL_THUMBS,
  },
  {
    id: 'carrete',
    section: 'photos',
    title: 'help.carrete.title',
    text: 'help.carrete.text',
    keys: { prev: 'carretePrev', next: 'carreteNext', ends: 'carreteEnds', close: 'carreteClose' },
    since: BEFORE_HELP,
  },
  {
    id: 'photosMarkup',
    section: 'photos',
    title: 'help.photosMarkup.title',
    text: 'help.photosMarkup.text',
    words: ['annotate', 'annotations', 'anotar', 'anotaciones', 'flecha', 'arrow', 'dibujo', 'drawing', 'framerev', 'hide', 'ocultar'],
    since: PHOTO_MARKUP,
  },
  {
    id: 'photosAnnotate',
    section: 'photos',
    title: 'help.photosAnnotate.title',
    text: 'help.photosAnnotate.text',
    keys: { viewer: 'carreteAnnotate', width: 'annotateWidth', next: 'annotateWidthNext', undo: 'annotateUndo', close: 'annotateEscape' },
    more: [
      'annotateSelect',
      'annotateRectangle',
      'annotateEllipse',
      'annotateArrow',
      'annotateLine',
      'annotatePencil',
      'annotateMarker',
      'annotateText',
      'annotateNumber',
      'annotateRedo',
      'annotateDelete',
      'annotateFit',
      'annotatePan',
      'annotateSave',
    ],
    words: ['annotate', 'anotar', 'flecha', 'arrow', 'círculo', 'circle', 'texto', 'lápiz', 'pencil', 'marker', 'marcador', 'número', 'framerev', 'dibujar', 'draw'],
    since: ANNOTATE,
  },
  {
    id: 'photosAnnotateTouch',
    section: 'photos',
    title: 'help.photosAnnotateTouch.title',
    text: 'help.photosAnnotateTouch.text',
    words: ['annotate', 'anotar', 'dedo', 'finger', 'pellizco', 'pinch', 'zoom', 'ampliar', 'lápiz', 'pencil', 'apple pencil', 'ipad', 'iphone', 'teléfono', 'phone', 'touch'],
    since: ANNOTATE_TOUCH,
  },
  {
    id: 'photosAnnotateCopy',
    section: 'photos',
    title: 'help.photosAnnotateCopy.title',
    text: 'help.photosAnnotateCopy.text',
    keys: { paste: 'pasteFiles', undo: 'undo' },
    words: ['copy', 'copiar', 'paste', 'pegar', 'cut', 'cortar', 'annotations', 'anotaciones', 'flechas', 'arrows', 'otra página', 'another page'],
    since: ANNOTATE_COPY,
  },
  { id: 'photosPhone', section: 'photos', title: 'help.photosPhone.title', text: 'help.photosPhone.text', since: BEFORE_HELP },
  {
    id: 'photosCamera',
    section: 'photos',
    title: 'help.photosCamera.title',
    text: 'help.photosCamera.text',
    words: ['camera', 'cámara', 'camara', 'foto', 'filmar', 'video', 'record', 'carrete', 'camera roll', 'galería', 'fotos', 'guardar', 'save'],
    since: CAMERA,
  },
  { id: 'photosOffline', section: 'photos', title: 'help.photosOffline.title', text: 'help.photosOffline.text', since: BEFORE_HELP },

  // --- Adjuntos y links de Drive ---
  {
    id: 'attach',
    section: 'attachments',
    title: 'help.attach.title',
    text: 'help.attach.text',
    when: 'portero',
    // La vista previa del PDF y la tarjeta grande en el carrete llegaron después (Doc_Adjuntos.md, entrega 2): sale en
    // las novedades con esa versión.
    words: ['pdf', 'vista previa', 'preview', 'miniatura', 'thumbnail', 'primera página', 'first page', 'carrete', 'viewer'],
    since: ATTACH_PREVIEW,
  },
  {
    id: 'folderDrop',
    section: 'attachments',
    title: 'help.folderDrop.title',
    text: 'help.folderDrop.text',
    when: 'portero',
    words: ['carpeta', 'folder', 'subir', 'arrastrar', 'soltar', 'drive'],
    since: BEFORE_HELP,
  },
  {
    id: 'folderUpload',
    section: 'attachments',
    title: 'help.folderUpload.title',
    text: 'help.folderUpload.text',
    when: 'portero',
    words: ['pausar', 'retomar', 'faltan', 'error', 'dejar de subir'],
    since: BEFORE_HELP,
  },
  {
    id: 'folderOpen',
    section: 'attachments',
    title: 'help.folderOpen.title',
    text: 'help.folderOpen.text',
    keys: { open: 'photoOpen', up: 'folderUp' },
    when: 'portero',
    words: ['ver', 'visor', 'migas', 'bajar', 'download'],
    since: BEFORE_HELP,
  },
  {
    id: 'folderDownload',
    section: 'attachments',
    title: 'help.folderDownload.title',
    text: 'help.folderDownload.text',
    when: 'portero',
    words: ['bajar todo', 'download all', 'zip', 'descargar', 'carpeta entera', 'MISSING_FILES'],
    since: FOLDER_ZIP,
  },
  {
    id: 'folderWho',
    section: 'attachments',
    title: 'help.folderWho.title',
    text: 'help.folderWho.text',
    when: 'portero',
    words: ['permisos', 'compartir', 'invitado'],
    since: BEFORE_HELP,
  },
  {
    id: 'driveLinks',
    section: 'drive',
    title: 'help.driveLinks.title',
    text: 'help.driveLinks.text',
    keys: { pick: 'listPick' },
    more: ['listClose'],
    since: BEFORE_HELP,
  },

  // --- Comentarios y preguntas ---
  {
    id: 'comments',
    section: 'comments',
    title: 'help.comments.title',
    text: 'help.comments.text',
    keys: { comment: 'comment', send: 'commentsSend' },
    more: ['commentsCancel'],
    showMe: 'comments',
    since: BEFORE_HELP,
  },
  {
    id: 'mentions',
    section: 'comments',
    title: 'help.mentions.title',
    text: 'help.mentions.text',
    keys: { pick: 'mentionPick', close: 'mentionClose' },
    words: ['@', 'mention', 'mencionar', 'mención', 'campana', 'bell', 'notification', 'aviso', 'unread', 'sin leer'],
    since: MENTIONS,
  },
  {
    id: 'mentionsShare',
    section: 'comments',
    title: 'help.mentionsShare.title',
    text: 'help.mentionsShare.text',
    keys: { cancel: 'mentionShareCancel' },
    words: ['@', 'mention', 'mencionar', 'share', 'compartir', 'access', 'acceso'],
    when: 'admin',
    since: MENTIONS_SHARE,
  },
  { id: 'questions', section: 'comments', title: 'help.questions.title', text: 'help.questions.text', keys: { question: 'question' }, since: BEFORE_HELP },

  // --- Buscar ---
  {
    id: 'findPage',
    section: 'find',
    title: 'help.findPage.title',
    text: 'help.findPage.text',
    keys: { find: 'find', next: 'findNext', prev: 'findPrev', close: 'findClose' },
    showMe: 'find',
    since: BEFORE_HELP,
  },
  {
    id: 'findProject',
    section: 'find',
    title: 'help.findProject.title',
    text: 'help.findProject.text',
    keys: { search: 'search' },
    more: ['listPick', 'listClose'],
    since: BEFORE_HELP,
  },
  {
    id: 'replaceProject',
    section: 'find',
    title: 'help.replaceProject.title',
    text: 'help.replaceProject.text',
    keys: { search: 'search', undo: 'undo' },
    words: ['replace all', 'reemplazar todo', 'find and replace', 'buscar y reemplazar'],
    since: REPLACE_PROJECT,
  },

  // --- Colapsar ---
  { id: 'collapse', section: 'collapse', title: 'help.collapse.title', text: 'help.collapse.text', keys: { collapse: 'collapse' }, since: BEFORE_HELP },
  {
    id: 'collapseEveryone',
    section: 'collapse',
    title: 'help.collapseEveryone.title',
    text: 'help.collapseEveryone.text',
    keys: { everyone: 'collapseEveryone' },
    words: ['shift', 'clic', 'click', 'para todos', 'everyone', 'compartido', 'shared', 'tooltip'],
    since: COLLAPSE_2,
  },
  {
    id: 'collapseMove',
    section: 'collapse',
    title: 'help.collapseMove.title',
    text: 'help.collapseMove.text',
    keys: { up: 'moveUp', down: 'moveDown' },
    words: ['mover', 'move', 'arrastrar', 'drag', 'puntos', 'dots', 'sección', 'section'],
    since: COLLAPSE_2,
  },
  { id: 'collapsePrint', section: 'collapse', title: 'help.collapsePrint.title', text: 'help.collapsePrint.text', since: BEFORE_HELP },

  // --- Compartir ---
  { id: 'share', section: 'sharing', title: 'help.share.title', text: 'help.share.text', since: BEFORE_HELP },
  { id: 'members', section: 'sharing', title: 'help.members.title', text: 'help.members.text', when: 'admin', since: BEFORE_HELP },
  {
    id: 'publicLink',
    section: 'sharing',
    title: 'help.publicLink.title',
    text: 'help.publicLink.text',
    words: ['link', 'enlace', 'público', 'public', 'anyone', 'cualquiera', 'sin cuenta', 'without an account', 'reset', 'renovar', 'vence', 'expires'],
    since: PUBLIC_LINK,
  },
  {
    id: 'openedWithLink',
    section: 'sharing',
    title: 'help.openedWithLink.title',
    text: 'help.openedWithLink.text',
    words: ['link', 'visitante', 'visitor', 'nombre', 'name', 'via link', 'vía link', 'sin cuenta', 'without an account'],
    since: PUBLIC_LINK,
  },
  {
    id: 'deletedPrivacy',
    section: 'sharing',
    title: 'help.deletedPrivacy.title',
    text: 'help.deletedPrivacy.text',
    words: ['borrado', 'borrar', 'privacidad', 'cliente', 'invitado', 'deleted', 'privacy', 'client', 'guest', 'preparación', 'prepared'],
    since: DELETED_PRIVACY,
  },

  // --- Papelera ---
  { id: 'trash', section: 'trash', title: 'help.trash.title', text: 'help.trash.text', since: BEFORE_HELP },
  {
    id: 'history',
    section: 'trash',
    title: 'help.history.title',
    text: 'help.history.text',
    keys: { open: 'history', undo: 'undo' },
    words: ['historial', 'versiones', 'versión', 'restaurar', 'revisiones', 'history', 'versions', 'restore', 'revisions', 'quién cambió'],
    since: HISTORY,
  },
  {
    id: 'historyChanges',
    section: 'trash',
    title: 'help.historyChanges.title',
    text: 'help.historyChanges.text',
    words: ['cambios', 'mostrar cambios', 'marcas', 'colores', 'tachado', 'subrayado', 'quién escribió', 'show changes', 'changes', 'who wrote', 'compare'],
    since: HISTORY_CHANGES,
  },
  {
    id: 'historyNames',
    section: 'trash',
    title: 'help.historyNames.title',
    text: 'help.historyNames.text',
    words: ['nombre', 'nombrar', 'versión con nombre', 'restaurada desde', 'sin conexión', 'name', 'named versions', 'restored from', 'offline'],
    since: HISTORY_NAMES,
  },

  // --- Sin red ---
  { id: 'syncStatus', section: 'sync', title: 'help.syncStatus.title', text: 'help.syncStatus.text', showMe: 'sync', since: BEFORE_HELP },
  { id: 'syncSafe', section: 'sync', title: 'help.syncSafe.title', text: 'help.syncSafe.text', since: BEFORE_HELP },
  {
    id: 'updateApp',
    section: 'sync',
    title: 'help.updateApp.title',
    text: 'help.updateApp.text',
    words: ['actualizar', 'update', 'versión', 'version', 'forzar', 'force', 'vieja', 'old'],
    since: UPDATE_APP,
  },
  {
    id: 'removedWriting',
    section: 'sync',
    title: 'help.removedWriting.title',
    text: 'help.removedWriting.text',
    words: ['borrado', 'borró', 'deleted', 'perdí', 'lost', 'a la vez', 'same time', 'recuperar', 'recover', 'moviste', 'moved'],
    since: REMOVED_WRITING,
  },
  {
    id: 'availableOffline',
    section: 'sync',
    title: 'help.availableOffline.title',
    text: 'help.availableOffline.text',
    words: ['offline', 'sin red', 'sin conexión', 'modo avión', 'rodaje', 'descargar', 'bajar', 'download'],
    since: OFFLINE,
  },
  {
    id: 'storageDevice',
    section: 'sync',
    title: 'help.storageDevice.title',
    text: 'help.storageDevice.text',
    words: ['espacio', 'almacenamiento', 'storage', 'tope', 'límite', 'liberar', 'free up', 'lleno', 'disco'],
    since: OFFLINE,
  },

  // --- Hojas y PDF ---
  { id: 'sheets', section: 'print', title: 'help.sheets.title', text: 'help.sheets.text', since: BEFORE_HELP },
  {
    id: 'pageBreak',
    section: 'print',
    title: 'help.pageBreak.title',
    text: 'help.pageBreak.text',
    keys: { pageBreak: 'pageBreak' },
    words: ['salto', 'salto de página', 'hoja nueva', 'page break', 'new page', 'new sheet', 'corte', 'ctrl enter'],
    since: PAGE_BREAK,
  },
  { id: 'pdf', section: 'print', title: 'help.pdf.title', text: 'help.pdf.text', keys: { print: 'print' }, showMe: 'page-menu', since: BEFORE_HELP },
  {
    id: 'export',
    section: 'print',
    title: 'help.export.title',
    text: 'help.export.text',
    words: ['exportar', 'export', 'pdf', 'índice', 'contents', 'proyecto entero', 'whole project', 'entregar', 'cliente', 'client', 'reporte'],
    since: EXPORT_PDF,
  },
  {
    id: 'exportZip',
    section: 'print',
    title: 'help.exportZip.title',
    text: 'help.exportZip.text',
    words: ['zip', 'archivar', 'archive', 'backup', 'respaldo', 'markdown', 'html', 'originales', 'originals', 'descargar', 'download'],
    since: EXPORT_ZIP,
  },

  // --- Preferencias ---
  { id: 'prefs', section: 'prefs', title: 'help.prefs.title', text: 'help.prefs.text', since: BEFORE_HELP },
  { id: 'language', section: 'prefs', title: 'help.language.title', text: 'help.language.text', since: BEFORE_HELP },

  // --- Atajos (la tabla entera va abajo de esta entrada) ---
  { id: 'keys', section: 'keys', title: 'help.keys.title', text: 'help.keys.text', more: ['tabsMove'], since: HELP },
];

/** Los atajos de una entrada: los que nombra el texto y los demás. */
export function entryShortcuts(entry: HelpEntry): string[] {
  return [...Object.values(entry.keys ?? {}), ...(entry.more ?? [])];
}
