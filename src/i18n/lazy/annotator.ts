import { register } from '../index';
import type { Dict } from '../types';

// El anotador de fotos (P.20, entrega 2; se carga aparte, con Annotator.tsx).

export const annotator = {
  'annotate.label': { en: "Annotate {name}", es: "Anotar {name}" },
  'annotate.tools': { en: "Tools", es: "Herramientas" },
  'annotate.select': { en: "Select", es: "Elegir" },
  'annotate.rectangle': { en: "Rectangle", es: "Rectángulo" },
  'annotate.ellipse': { en: "Ellipse", es: "Elipse" },
  'annotate.arrow': { en: "Arrow", es: "Flecha" },
  'annotate.line': { en: "Line", es: "Línea" },
  'annotate.pencil': { en: "Pencil", es: "Lápiz" },
  'annotate.marker': { en: "Marker", es: "Marcador" },
  'annotate.text': { en: "Text", es: "Texto" },
  'annotate.number': { en: "Number", es: "Número" },
  'annotate.toolTip': { en: "**{name}**\nKeyboard: {key}", es: "**{name}**\nTeclado: {key}" },
  'annotate.toolTipModifiers': {
    en: "**{name}**\nKeyboard: {key}\nShift: square, circle or 45°; {alt}: from the center",
    es: "**{name}**\nTeclado: {key}\nShift: cuadrado, círculo o 45°; {alt}: desde el centro",
  },
  'annotate.undo': { en: "Undo", es: "Deshacer" },
  'annotate.redo': { en: "Redo", es: "Rehacer" },
  'annotate.undoTip': { en: "**Undo**\nOnly what you did on this photo\n{key}", es: "**Deshacer**\nSolo lo que hiciste en esta foto\n{key}" },
  'annotate.redoTip': { en: "**Redo**\n{key}", es: "**Rehacer**\n{key}" },
  'annotate.delete': { en: "Delete", es: "Borrar" },
  'annotate.deleteTip': { en: "**Delete**\nThe selected shapes\n{key}", es: "**Borrar**\nLas formas elegidas\n{key}" },
  'annotate.done': { en: "Done", es: "Listo" },
  'annotate.doneTip': { en: "Every shape is saved as you draw it", es: "Cada forma se guarda apenas la dibujás" },
  'annotate.color': { en: "Color", es: "Color" },
  'annotate.colorNamed': { en: "Color {color}", es: "Color {color}" },
  'annotate.recent': { en: "Recent colors", es: "Colores recientes" },
  'annotate.customColor': { en: "Custom color", es: "Color a elección" },
  'annotate.width': { en: "Thickness", es: "Grosor" },
  'annotate.widthTip': {
    en: "**Thickness**\nPixels with the photo's long side at 1920\n{key}: the selected shape under the pointer, or the next one\n{next}: always the next one",
    es: "**Grosor**\nPíxeles con el lado largo de la foto a 1920\n{key}: la forma elegida bajo el cursor, o la próxima\n{next}: siempre la próxima",
  },
  'annotate.opacity': { en: "Opacity", es: "Opacidad" },
  'annotate.fill': { en: "Fill", es: "Relleno" },
  'annotate.fillOpacity': { en: "Fill opacity", es: "Opacidad del relleno" },
  'annotate.background': { en: "Background", es: "Fondo" },
  'annotate.backgroundTip': { en: "**Background**\nA box behind the text; the letters pick black or white", es: "**Fondo**\nUna caja detrás del texto; las letras eligen negro o blanco" },
  'annotate.headOpen': { en: "Open head", es: "Punta abierta" },
  'annotate.headBoth': { en: "Both ends", es: "En las dos puntas" },
  'annotate.fontSize': { en: "Size", es: "Tamaño" },
  'annotate.selectHint': {
    en: "Click a shape to select it, or drag around several. Double-click a text or a number to change it.",
    es: "Hacé clic en una forma para elegirla, o arrastrá alrededor de varias. Doble clic en un texto o un número para cambiarlo.",
  },
  'annotate.textHint': { en: "Type, then Esc or click outside", es: "Escribí y después Esc o clic afuera" },
  'annotate.numberValue': { en: "Number", es: "Número" },
  'annotate.saved': { en: "Saved automatically: every shape is saved as you draw it.", es: "Se guarda solo: cada forma se guarda apenas la dibujás." },
  'annotate.loading': { en: "Loading the photo…", es: "Cargando la foto…" },
  'annotate.preview': {
    en: "Showing a preview: the original isn't on this device",
    es: "Se ve una vista previa: el original no está en este dispositivo",
  },
  'annotate.missing': {
    en: "This photo isn't on this device yet: connect to the internet to annotate it.",
    es: "Esta foto todavía no está en este dispositivo: conectate a internet para anotarla.",
  },
  'annotate.newer': { en: "Update the app to edit these annotations", es: "Actualizá la app para editar estas anotaciones" },
  'annotate.photoWarn': { en: "This photo is close to its annotation limit", es: "Esta foto está cerca del límite de anotaciones" },
  'annotate.photoFull': { en: "This photo has too many annotations", es: "Esta foto tiene demasiadas anotaciones" },
  'annotate.pageWarn': { en: "This page is close to its annotation limit", es: "Esta página está cerca del límite de anotaciones" },
  'annotate.pageFull': { en: "This page has too many annotations", es: "Esta página tiene demasiadas anotaciones" },
  'annotate.baseFull': { en: "This page is too large to add annotations", es: "Esta página es demasiado grande para sumar anotaciones" },
  'annotate.fit': { en: "Fit", es: "Encuadrar" },
  'annotate.fitTip': { en: "**Fit**\nThe whole photo\n{key} · scroll to zoom · hold {pan} and drag to move", es: "**Encuadrar**\nLa foto entera\n{key} · la rueda amplía · {pan} apretada y arrastrar mueve" },
} satisfies Dict;

register(annotator);
