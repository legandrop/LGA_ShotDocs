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
/** La que trajo colapsar para todos y mover la sección entera (Doc_Colapsar.md, 1b y 2). */
const COLLAPSE_2 = '0.084';

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
    id: 'carrete',
    section: 'photos',
    title: 'help.carrete.title',
    text: 'help.carrete.text',
    keys: { prev: 'carretePrev', next: 'carreteNext', ends: 'carreteEnds', close: 'carreteClose' },
    since: BEFORE_HELP,
  },
  { id: 'photosPhone', section: 'photos', title: 'help.photosPhone.title', text: 'help.photosPhone.text', since: BEFORE_HELP },
  { id: 'photosOffline', section: 'photos', title: 'help.photosOffline.title', text: 'help.photosOffline.text', since: BEFORE_HELP },

  // --- Adjuntos y links de Drive ---
  { id: 'attach', section: 'attachments', title: 'help.attach.title', text: 'help.attach.text', when: 'portero', since: BEFORE_HELP },
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

  // --- Papelera ---
  { id: 'trash', section: 'trash', title: 'help.trash.title', text: 'help.trash.text', since: BEFORE_HELP },

  // --- Sin red ---
  { id: 'syncStatus', section: 'sync', title: 'help.syncStatus.title', text: 'help.syncStatus.text', showMe: 'sync', since: BEFORE_HELP },
  { id: 'syncSafe', section: 'sync', title: 'help.syncSafe.title', text: 'help.syncSafe.text', since: BEFORE_HELP },

  // --- Hojas y PDF ---
  { id: 'sheets', section: 'print', title: 'help.sheets.title', text: 'help.sheets.text', since: BEFORE_HELP },
  { id: 'pdf', section: 'print', title: 'help.pdf.title', text: 'help.pdf.text', keys: { print: 'print' }, showMe: 'page-menu', since: BEFORE_HELP },

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
