// El registro único de los atajos de teclado (Docs/Doc_Tutorial.md, sección 6). De acá salen los rótulos de los
// tooltips, la ayuda (sección "Atajos de teclado") y la recorrida, y los atajos de ProseMirror que define la app
// (el esquema y las extensiones los importan en vez de escribirlos). Las pruebas (`shortcuts.test.ts`) lo
// comparan con el editor real, con las funciones `is…Shortcut` y con los archivos que escuchan teclas: un
// atajo nuevo que no esté acá hace fallar la suite.
//
// Va en la primera carga y es chico: los textos que explican cada atajo están en la ayuda, que se baja aparte
// (`src/help/shortcutTexts.ts`), y qué archivos maneja cada uno, en `shortcutSources.ts` (solo lo usan las pruebas).

/** En la Mac los atajos son con ⌘ (nunca Ctrl); en el resto, con Ctrl. Una sola copia para toda la app. */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Dónde vale un atajo (las secciones de la tabla de la ayuda). */
export type ShortcutPlace = 'global' | 'editor' | 'markdown' | 'photos' | 'carrete' | 'annotate' | 'find' | 'comments' | 'tree' | 'menus' | 'tour';

export const SHORTCUT_PLACES: ShortcutPlace[] = ['global', 'editor', 'markdown', 'photos', 'carrete', 'annotate', 'find', 'comments', 'tree', 'menus', 'tour'];

export interface Shortcut {
  id: string;
  /**
   * Las teclas, en el formato de ProseMirror (`Mod-Alt-m`, `Shift-Enter`, `F3`); varias son alternativas. En lo
   * que se escribe (`typed`), el texto tal cual ("# ", "/").
   */
  keys: string[];
  place: ShortcutPlace;
  /**
   * Dentro del lugar, cuándo vale (una foto de una fila elegida, una línea de guion, texto elegido): dos atajos
   * con las mismas teclas en el mismo lugar solo pueden convivir si tienen distinto `context`.
   */
  context?: string;
  /** De quién es: la app, BlockNote o Tiptap (que trae BlockNote). */
  owner: 'app' | 'blocknote' | 'tiptap';
  /**
   * Cómo se toma: `keymap` (un atajo de ProseMirror: la prueba lo busca en el editor real), `window` (una
   * función `is…Shortcut` sobre `window`), `dom` (un `onKeyDown` de un componente), `react` (un botón de
   * BlockNote) o `typed` (se escribe; una regla de entrada de BlockNote). Los archivos y las reglas de cada uno
   * están en `shortcutSources.ts`.
   */
  source: 'keymap' | 'window' | 'dom' | 'react' | 'typed';
  /** Cómo se muestra si no son las teclas de `keys` (por ejemplo, "⌘⌥1…6" en vez de seis atajos). */
  display?: string[];
}

/** Lo que se toma con una función sobre `window` o en un componente; los textos van en la ayuda. */
export const SHORTCUTS: Shortcut[] = [
  // --- En toda la app (con una página abierta) ---
  { id: 'search', keys: ['Mod-k'], place: 'global', owner: 'app', source: 'window' },
  { id: 'find', keys: ['Mod-f'], place: 'global', owner: 'app', source: 'window' },
  { id: 'print', keys: ['Mod-p'], place: 'global', owner: 'app', source: 'window' },
  // El historial de versiones de la página (P.18, Docs/Doc_Historial.md), el mismo de Google Docs.
  { id: 'history', keys: ['Mod-Alt-Shift-h'], place: 'global', owner: 'app', source: 'window' },
  // El reporte del día (Docs/Doc_Plantillas.md, 6.1 y 9): con la carpeta de reportes o un reporte abierto. ⌘⌥N no
  // (es *Open split view* de Chrome en la Mac), ⌘⌥D tampoco (esconde el Dock).
  { id: 'newDayReport', keys: ['Mod-Alt-Shift-n'], place: 'global', context: 'dayReport', owner: 'app', source: 'window' },
  // El asistente (Docs/Doc_Asistente.md, A1): abre y cierra su panel sobre lo elegido.
  { id: 'assistant', keys: ['Mod-Alt-j'], place: 'global', owner: 'app', source: 'window' },
  // *Dictate to report* (Docs/Doc_Dictado.md, V1): abrir o cerrar la hoja.
  { id: 'dictate', keys: ['Mod-Alt-Shift-d'], place: 'global', owner: 'app', source: 'window' },
  { id: 'titleEnter', keys: ['Enter'], place: 'global', context: 'title', owner: 'app', source: 'dom' },

  // --- Editor: lo de la app ---
  { id: 'comment', keys: ['Mod-Alt-m'], place: 'editor', owner: 'app', source: 'window' },
  { id: 'question', keys: ['Mod-Alt-p'], place: 'editor', owner: 'app', source: 'keymap' },
  { id: 'script', keys: ['Mod-Alt-s'], place: 'editor', owner: 'app', source: 'keymap' },
  { id: 'scriptEnter', keys: ['Enter'], place: 'editor', context: 'script', owner: 'app', source: 'keymap' },
  { id: 'paragraph', keys: ['Mod-Alt-0'], place: 'editor', owner: 'app', source: 'keymap' },
  // El salto de hoja (Docs/Doc_Hojas_PDF.md): Ctrl+Enter como en los procesadores de texto (⌘↩ en la Mac).
  { id: 'pageBreak', keys: ['Mod-Enter'], place: 'editor', owner: 'app', source: 'keymap' },
  { id: 'collapse', keys: ['Mod-Alt-Enter'], place: 'editor', owner: 'app', source: 'keymap' },
  // Para todos (Doc_Colapsar.md, entrega 2): solo quien puede editar; si no, como sin Shift. Shift+clic en el
  // triángulo hace lo mismo (es un clic: va en el texto de la ayuda, no en el registro).
  { id: 'collapseEveryone', keys: ['Shift-Mod-Alt-Enter'], place: 'editor', owner: 'app', source: 'keymap' },
  { id: 'selectAll', keys: ['Mod-a'], place: 'editor', owner: 'app', source: 'dom' },

  // --- Editor: BlockNote ---
  {
    id: 'heading',
    keys: ['Mod-Alt-1', 'Mod-Alt-2', 'Mod-Alt-3', 'Mod-Alt-4', 'Mod-Alt-5', 'Mod-Alt-6'],
    display: ['Mod-Alt-1', '…', '6'],
    place: 'editor',
    owner: 'blocknote',
    source: 'keymap',
  },
  { id: 'quote', keys: ['Mod-Alt-q'], place: 'editor', owner: 'blocknote', source: 'keymap' },
  { id: 'numbered', keys: ['Mod-Shift-7'], place: 'editor', owner: 'blocknote', source: 'keymap' },
  { id: 'bullet', keys: ['Mod-Shift-8'], place: 'editor', owner: 'blocknote', source: 'keymap' },
  { id: 'checklist', keys: ['Mod-Shift-9'], place: 'editor', owner: 'blocknote', source: 'keymap' },
  { id: 'toggle', keys: ['Mod-Shift-6'], place: 'editor', owner: 'blocknote', source: 'keymap' },
  // Deshacer y rehacer en el orden en que editaste (P.26, Docs/Doc_Deshacer.md): los toma primero la app en `window`
  // (undoTimelineUi.ts), con el foco en el editor de la página o fuera de un campo de texto, y pueden llevarte a otra
  // página. Un reemplazo en todo el proyecto es un paso (entrega 2); recién reemplazado, también en el panel de buscar
  // (ProjectSearch.tsx, DH9). El atajo de BlockNote sigue en el editor para la página de práctica y las versiones del
  // historial.
  { id: 'undo', keys: ['Mod-z'], place: 'editor', owner: 'app', source: 'keymap' },
  { id: 'redo', keys: ['Mod-Shift-z', 'Mod-y'], place: 'editor', owner: 'app', source: 'keymap' },
  { id: 'indent', keys: ['Tab'], place: 'editor', owner: 'blocknote', source: 'keymap' },
  { id: 'outdent', keys: ['Shift-Tab'], place: 'editor', owner: 'blocknote', source: 'keymap' },
  // Mover bloques: los toma primero la app (collapseEditor.ts): con una sección colapsada en juego la mueve entera
  // (Doc_Colapsar.md, "Mover la sección entera"); si no, se los deja a BlockNote.
  { id: 'moveUp', keys: ['Mod-Shift-ArrowUp'], place: 'editor', owner: 'app', source: 'keymap' },
  { id: 'moveDown', keys: ['Mod-Shift-ArrowDown'], place: 'editor', owner: 'app', source: 'keymap' },
  { id: 'lineBreak', keys: ['Shift-Enter'], place: 'editor', owner: 'blocknote', source: 'keymap' },
  { id: 'link', keys: ['Mod-k'], place: 'editor', context: 'selection', owner: 'blocknote', source: 'react' },

  // --- Editor: Tiptap (formato del texto) ---
  { id: 'bold', keys: ['Mod-b'], place: 'editor', owner: 'tiptap', source: 'keymap' },
  { id: 'italic', keys: ['Mod-i'], place: 'editor', owner: 'tiptap', source: 'keymap' },
  { id: 'underline', keys: ['Mod-u'], place: 'editor', owner: 'tiptap', source: 'keymap' },
  { id: 'strike', keys: ['Mod-Shift-s'], place: 'editor', owner: 'tiptap', source: 'keymap' },
  { id: 'code', keys: ['Mod-e'], place: 'editor', owner: 'tiptap', source: 'keymap' },

  // --- Lo que se escribe al principio de un renglón ---
  { id: 'mdSlash', keys: ['/'], place: 'markdown', owner: 'blocknote', source: 'typed' },
  { id: 'mdHeading', keys: ['# ', '## ', '### '], place: 'markdown', owner: 'blocknote', source: 'typed' },
  { id: 'mdBullet', keys: ['- ', '* '], place: 'markdown', owner: 'blocknote', source: 'typed' },
  { id: 'mdNumbered', keys: ['1. '], place: 'markdown', owner: 'blocknote', source: 'typed' },
  { id: 'mdChecklist', keys: ['[] ', '[x] '], place: 'markdown', owner: 'blocknote', source: 'typed' },
  { id: 'mdQuote', keys: ['> '], place: 'markdown', owner: 'blocknote', source: 'typed' },
  { id: 'mdDivider', keys: ['---'], place: 'markdown', owner: 'blocknote', source: 'typed' },
  { id: 'mdCode', keys: ['```'], place: 'markdown', owner: 'blocknote', source: 'typed' },

  // --- Fotos ---
  { id: 'photoOpen', keys: ['Space'], place: 'photos', context: 'photo', owner: 'app', source: 'dom' },
  { id: 'photoRowNext', keys: ['ArrowRight'], place: 'photos', context: 'row', owner: 'app', source: 'keymap' },
  { id: 'photoRowPrev', keys: ['ArrowLeft'], place: 'photos', context: 'row', owner: 'app', source: 'keymap' },
  { id: 'photoRowLeave', keys: ['ArrowUp', 'ArrowDown'], place: 'photos', context: 'row', owner: 'app', source: 'keymap' },
  { id: 'photoRowEnter', keys: ['Enter'], place: 'photos', context: 'row', owner: 'app', source: 'keymap' },
  // Las fotos en línea (Docs/Doc_Fotos_En_Linea.md): con una elegida.
  { id: 'photoInlineSelect', keys: ['Shift-ArrowLeft', 'Shift-ArrowRight', 'Shift-ArrowUp', 'Shift-ArrowDown'], place: 'photos', context: 'inline', owner: 'app', source: 'dom' },
  { id: 'photoInlineType', keys: ['Enter'], place: 'photos', context: 'inline', owner: 'app', source: 'dom' },
  // Borrar las fotos elegidas (ProseMirror; también *Delete image* en su barra).
  { id: 'photoDelete', keys: ['Delete', 'Backspace'], place: 'photos', context: 'selected', owner: 'blocknote', source: 'keymap' },
  // Pegar archivos: fotos y videos en el renglón, donde está el cursor (inlinePhotoCreate.ts).
  { id: 'pasteFiles', keys: ['Mod-v'], place: 'photos', owner: 'app', source: 'dom' },
  // El visor de una carpeta de Drive (Docs/Doc_Carpetas.md): Esc sube un nivel; arriba de todo, cierra.
  { id: 'folderUp', keys: ['Escape'], place: 'photos', context: 'folder', owner: 'app', source: 'dom' },

  // --- Carrete ---
  { id: 'carretePrev', keys: ['ArrowLeft'], place: 'carrete', owner: 'app', source: 'dom' },
  { id: 'carreteNext', keys: ['ArrowRight'], place: 'carrete', owner: 'app', source: 'dom' },
  { id: 'carreteEnds', keys: ['Home', 'End'], place: 'carrete', owner: 'app', source: 'dom' },
  { id: 'carreteClose', keys: ['Escape'], place: 'carrete', owner: 'app', source: 'dom' },
  // Anotar la foto que se ve (P.20, Docs/Doc_Anotar_Fotos.md): solo quien puede editar la página.
  { id: 'carreteAnnotate', keys: ['a'], place: 'carrete', owner: 'app', source: 'dom' },

  // --- El anotador de fotos (P.20, entrega 2): las letras de FrameRev, solo con el anotador abierto y sin una caja
  // de texto con el foco (annotatorKeys.ts). ⌘[ y ⌘] (atrás y adelante del navegador en la Mac) se frenan ahí. ---
  { id: 'annotateSelect', keys: ['v'], place: 'annotate', owner: 'app', source: 'dom' },
  { id: 'annotateRectangle', keys: ['r'], place: 'annotate', owner: 'app', source: 'dom' },
  { id: 'annotateEllipse', keys: ['e'], place: 'annotate', owner: 'app', source: 'dom' },
  { id: 'annotateArrow', keys: ['a'], place: 'annotate', owner: 'app', source: 'dom' },
  { id: 'annotateLine', keys: ['l'], place: 'annotate', owner: 'app', source: 'dom' },
  { id: 'annotatePencil', keys: ['p'], place: 'annotate', owner: 'app', source: 'dom' },
  { id: 'annotateMarker', keys: ['m'], place: 'annotate', owner: 'app', source: 'dom' },
  { id: 'annotateText', keys: ['t'], place: 'annotate', owner: 'app', source: 'dom' },
  { id: 'annotateNumber', keys: ['n'], place: 'annotate', owner: 'app', source: 'dom' },
  { id: 'annotateWidth', keys: ['[', ']'], place: 'annotate', owner: 'app', source: 'dom' },
  { id: 'annotateWidthNext', keys: ['Mod-[', 'Mod-]'], place: 'annotate', owner: 'app', source: 'dom' },
  { id: 'annotateUndo', keys: ['Mod-z'], place: 'annotate', owner: 'app', source: 'dom' },
  { id: 'annotateRedo', keys: ['Mod-Shift-z', 'Mod-y'], place: 'annotate', owner: 'app', source: 'dom' },
  { id: 'annotateDelete', keys: ['Delete', 'Backspace'], place: 'annotate', owner: 'app', source: 'dom' },
  // Esc deja de elegir (o termina el texto); sin nada elegido, cierra.
  { id: 'annotateEscape', keys: ['Escape'], place: 'annotate', owner: 'app', source: 'dom' },
  { id: 'annotateFit', keys: ['f'], place: 'annotate', owner: 'app', source: 'dom' },
  // Mantener apretada: arrastrar mueve la foto ampliada.
  { id: 'annotatePan', keys: ['Space'], place: 'annotate', owner: 'app', source: 'dom' },
  // Solo el aviso de que se guarda solo (y no el "guardar página" del navegador).
  { id: 'annotateSave', keys: ['Mod-s'], place: 'annotate', owner: 'app', source: 'dom' },

  // --- Buscar en la página ---
  { id: 'findNext', keys: ['Enter', 'F3', 'Mod-g'], place: 'find', owner: 'app', source: 'dom' },
  { id: 'findPrev', keys: ['Shift-Enter', 'Shift-F3', 'Mod-Shift-g'], place: 'find', owner: 'app', source: 'dom' },
  { id: 'findClose', keys: ['Escape'], place: 'find', owner: 'app', source: 'dom' },
  // En el campo de reemplazar: reemplaza la de ahora y pasa a la siguiente (el botón Replace lo dice en su tooltip).
  { id: 'findReplace', keys: ['Enter'], place: 'find', context: 'replace', owner: 'app', source: 'dom' },

  // --- Comentarios ---
  { id: 'commentsSend', keys: ['Mod-Enter'], place: 'comments', owner: 'app', source: 'dom' },
  { id: 'commentsCancel', keys: ['Escape'], place: 'comments', owner: 'app', source: 'dom' },
  // La lista del @ (Docs/Doc_Menciones.md, 2.1): con la lista abierta, eligen y la cierran sin borrar lo escrito.
  { id: 'mentionPick', keys: ['ArrowUp', 'ArrowDown', 'Enter', 'Tab'], place: 'comments', context: 'mentions', owner: 'app', source: 'dom' },
  { id: 'mentionClose', keys: ['Escape'], place: 'comments', context: 'mentions', owner: 'app', source: 'dom' },
  // La pregunta de compartir desde la mención (entrega 2, ME2): Esc la cierra sin cancelar el comentario.
  { id: 'mentionShareCancel', keys: ['Escape'], place: 'comments', context: 'mentionShare', owner: 'app', source: 'dom' },

  // --- Árbol de páginas y barra lateral ---
  { id: 'treeStep', keys: ['ArrowUp', 'ArrowDown'], place: 'tree', owner: 'app', source: 'dom' },
  { id: 'treeEnds', keys: ['Home', 'End'], place: 'tree', owner: 'app', source: 'dom' },
  { id: 'treeExpand', keys: ['ArrowRight'], place: 'tree', owner: 'app', source: 'dom' },
  { id: 'treeCollapse', keys: ['ArrowLeft'], place: 'tree', owner: 'app', source: 'dom' },
  { id: 'treeOpen', keys: ['Enter', 'Space'], place: 'tree', owner: 'app', source: 'dom' },
  { id: 'treeRename', keys: ['Enter', 'Escape'], place: 'tree', context: 'rename', owner: 'app', source: 'dom' },
  { id: 'sidebarResize', keys: ['ArrowLeft', 'ArrowRight', 'Home', 'End'], place: 'tree', context: 'resizer', owner: 'app', source: 'dom' },

  // --- Menús, paneles y diálogos ---
  { id: 'menusMove', keys: ['ArrowUp', 'ArrowDown', 'Home', 'End'], place: 'menus', owner: 'app', source: 'dom' },
  // También cancela Keep annotations? durante la medición o el guardado, con foco dentro de la hoja.
  { id: 'menusClose', keys: ['Escape'], place: 'menus', owner: 'app', source: 'dom' },
  { id: 'listPick', keys: ['ArrowUp', 'ArrowDown', 'Enter'], place: 'menus', context: 'list', owner: 'app', source: 'dom' },
  { id: 'listClose', keys: ['Escape'], place: 'menus', context: 'list', owner: 'app', source: 'dom' },
  // El nombre de una versión del historial (Docs/Doc_Historial.md, entrega 3): guardar o dejar como estaba.
  { id: 'versionName', keys: ['Enter', 'Escape'], place: 'menus', context: 'versionName', owner: 'app', source: 'dom' },
  // Aplicar la sugerencia del asistente, con el foco en su panel (Esc la descarta: `menusClose`).
  { id: 'assistantApply', keys: ['Mod-Enter'], place: 'menus', context: 'assistant', owner: 'app', source: 'dom' },
  // *Place* en *Dictate to report*, con el foco en la hoja (con la vista previa abierta, el mismo atajo aplica: `assistantApply`).
  { id: 'dictationPlace', keys: ['Mod-Enter'], place: 'menus', context: 'dictation', owner: 'app', source: 'dom' },
  // Las pestañas de una ventana (Install app: iPhone, Android, computadora).
  { id: 'tabsMove', keys: ['ArrowLeft', 'ArrowRight', 'Home', 'End'], place: 'menus', context: 'tabs', owner: 'app', source: 'dom' },

  // --- La recorrida (con el foco en el globito) ---
  { id: 'tourNext', keys: ['ArrowRight', 'Enter'], place: 'tour', owner: 'app', source: 'dom' },
  { id: 'tourBack', keys: ['ArrowLeft'], place: 'tour', owner: 'app', source: 'dom' },
  { id: 'tourExit', keys: ['Escape'], place: 'tour', owner: 'app', source: 'dom' },
];

const byId = new Map(SHORTCUTS.map((s) => [s.id, s]));

export function shortcut(id: string): Shortcut {
  const found = byId.get(id);
  if (!found) throw new Error(`Atajo desconocido: ${id}`);
  return found;
}

/** Las teclas de un atajo de ProseMirror del registro (el esquema y las extensiones las importan de acá). */
export function shortcutKeys(id: string): string[] {
  return shortcut(id).keys;
}

const MAC_MODS: Record<string, string> = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' };
const PC_MODS: Record<string, string> = { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift' };
/** El orden de los modificadores en el rótulo (el que ya usaba la app: ⌘⌥M, ⌘⇧Z; Ctrl+Alt+Shift+…). */
const ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift'];

/** `es`: el nombre en castellano en todas las plataformas; `pcEs`: solo fuera de la Mac (en la Mac va el símbolo). */
const KEY_NAMES: Record<string, { mac: string; pc: string; es?: string; pcEs?: string }> = {
  Enter: { mac: '↩', pc: 'Enter' },
  Escape: { mac: 'Esc', pc: 'Esc' },
  ArrowUp: { mac: '↑', pc: '↑' },
  ArrowDown: { mac: '↓', pc: '↓' },
  ArrowLeft: { mac: '←', pc: '←' },
  ArrowRight: { mac: '→', pc: '→' },
  Home: { mac: 'Home', pc: 'Home', es: 'Inicio' },
  End: { mac: 'End', pc: 'End', es: 'Fin' },
  Space: { mac: 'Space', pc: 'Space', es: 'Espacio' },
  Tab: { mac: '⇥', pc: 'Tab' },
  Backspace: { mac: '⌫', pc: 'Backspace', pcEs: 'Retroceso' },
  Delete: { mac: 'Delete', pc: 'Delete', pcEs: 'Supr' },
};

/**
 * Una combinación de ProseMirror (`Mod-Alt-m`) como se ve: ⌘⌥M en la Mac, Ctrl+Alt+M en el resto. Un Enter
 * solo se escribe entero también en la Mac ("Enter" se entiende más que "↩" sin modificadores).
 */
export function keyLabel(keys: string, mac = IS_MAC, lang: 'en' | 'es' = 'en'): string {
  if (keys === '…') return '…';
  // "Mod--" no existe; un guion solo es la tecla "-".
  const parts = keys === '-' ? ['-'] : keys.split(/-(?!$)/);
  const key = parts.pop()!;
  const mods = ORDER.filter((m) => parts.includes(m));
  const named = KEY_NAMES[key];
  const alone = mods.length === 0;
  const name = named
    ? lang === 'es' && (named.es || (!mac && named.pcEs))
      ? (named.es ?? named.pcEs)!
      : mac && !(alone && key === 'Enter')
        ? named.mac
        : named.pc
    : key.length === 1
      ? key.toUpperCase()
      : key;
  if (mac) return mods.map((m) => MAC_MODS[m]).join('') + name;
  return [...mods.map((m) => PC_MODS[m]), name].join('+');
}

/**
 * El rótulo de un atajo del registro, con sus alternativas separadas ("Enter / F3 / ⌘G"). Para los tooltips, la
 * ayuda y la recorrida. `lang` solo cambia los nombres de algunas teclas (Inicio, Fin, Espacio).
 */
export function shortcutLabel(id: string, mac = IS_MAC, lang: 'en' | 'es' = 'en'): string {
  const s = shortcut(id);
  if (s.source === 'typed') return s.keys.map((k) => k.trim()).join('  ');
  if (s.display) {
    const [first, ...rest] = s.display;
    return keyLabel(first, mac, lang) + rest.join('');
  }
  return s.keys.map((k) => keyLabel(k, mac, lang)).join(' / ');
}

/** El atajo de cada ítem del menú "/" de BlockNote (por su `key`), del registro. */
const SLASH_SHORTCUTS: Record<string, [string, number]> = {
  heading: ['heading', 0],
  heading_2: ['heading', 1],
  heading_3: ['heading', 2],
  heading_4: ['heading', 3],
  heading_5: ['heading', 4],
  heading_6: ['heading', 5],
  quote: ['quote', 0],
  toggle_list: ['toggle', 0],
  numbered_list: ['numbered', 0],
  bullet_list: ['bullet', 0],
  check_list: ['checklist', 0],
  paragraph: ['paragraph', 0],
};

/**
 * El rótulo del atajo de un ítem del menú "/" (por su `key` de BlockNote), con el mismo formato que el resto de la
 * app; `undefined` si no tiene. BlockNote 0.55 rotula "Bloque de código" con ⌘⌥C, que no existe (corrección 9):
 * ese y cualquier otro que no esté en el registro se quedan sin rótulo.
 */
export function slashBadge(key: string | undefined, mac = IS_MAC): string | undefined {
  const found = key ? SLASH_SHORTCUTS[key] : undefined;
  return found ? keyLabel(shortcut(found[0]).keys[found[1]], mac) : undefined;
}
