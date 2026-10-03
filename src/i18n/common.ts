import type { Dict } from './types';

// Textos comunes a varias pantallas.

export const common = {
  'common.loading': { en: "Loading…", es: "Cargando…" },
  'common.tryAgain': { en: "Try again", es: "Reintentar" },
  // La base rechazó un cambio porque esta versión de la app es más vieja que la mínima del workspace (`app_outdated`).
  'common.appOutdated': {
    en: "This workspace needs a newer version of the app. Reload the app to update it and try again.",
    es: "Este workspace necesita una versión más nueva de la app. Recargá la app para actualizarla y probá de nuevo.",
  },
  'common.signOut': { en: "Sign out", es: "Cerrar sesión" },
  'common.untitled': { en: "Untitled", es: "Sin título" },
  'common.ok': { en: "OK", es: "OK" },
  'common.newPage': { en: "New page", es: "Página nueva" },
  'common.rename': { en: "Rename", es: "Renombrar" },
  'common.create': { en: "Create", es: "Crear" },
  'common.back': { en: "Back", es: "Volver" },
  'common.cannotUndo': { en: "This cannot be undone.", es: "No se puede deshacer." },
  'common.discard': { en: "Discard", es: "Descartar" },
  'common.retry': { en: "Retry", es: "Reintentar" },
  'common.preparing': { en: "Preparing…", es: "Preparando…" },
  'common.close': { en: "Close", es: "Cerrar" },
  'common.on': { en: "On", es: "Sí" },
  'common.off': { en: "Off", es: "No" },
  'common.done': { en: "Done", es: "Listo" },
  'common.cancel': { en: "Cancel", es: "Cancelar" },
  'common.copied': { en: "Copied", es: "Copiado" },
  'common.continue': { en: "Continue", es: "Seguir" },
  // Los gestos de los tooltips con renglones «gesto o atajo: acción» (D226, src/ui/tipRows.ts). El modificador
  // (Shift, ⌥/Alt, ⌘/Ctrl) y la tecla que se mantiene apretada los pone tipRows según la plataforma.
  'tip.click': { en: "Click", es: "Clic" },
  'tip.clickMod': { en: "click", es: "clic" },
  'tip.doubleClick': { en: "Double-click", es: "Doble clic" },
  'tip.drag': { en: "Drag", es: "Arrastrar" },
  'tip.dragMod': { en: "drag", es: "arrastrar" },
  'tip.scroll': { en: "Scroll", es: "Rueda" },
  'tip.pinch': { en: "Pinch", es: "Pellizcar" },
  // Solo la palabra (una clave "{a} or {b}" confundiría a `localize` con cualquier texto guardado "… or …").
  'tip.or': { en: "or", es: "o" },
} satisfies Dict;
