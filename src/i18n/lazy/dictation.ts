import { register } from '../index';
import type { Dict } from '../types';

// *Dictate to report*, entregas V2 y V3 (Docs/Doc_Dictado.md): la cola de notas sin red y el micrófono propio. Viaja con
// la hoja (los textos de V1 están en `assistant.ts`, que la hoja también carga).

export const dictation = {
  // V2: la cola sin red.
  'dictation.savedForLater': {
    en: "Saved. It will be placed when you're back online: find it in Saved notes, or in Voice notes to place next to the sync status.",
    es: "Guardada. Se ubica cuando vuelva la red: está en Notas guardadas, o en Notas de voz para ubicar, junto al estado de la sincronización.",
  },
  'dictation.saveFailed': {
    en: "The note couldn't be saved on this device. It's still in the field.",
    es: "No se pudo guardar la nota en este dispositivo. Sigue en el campo.",
  },
  'dictation.savedNotes': { en: "Saved notes", es: "Notas guardadas" },
  'dictation.savedNote': { en: "Saved note · {time}", es: "Nota guardada · {time}" },
  'dictation.savedNoteHint': {
    en: "Place it in this page as it is now, with a preview, or add it as a paragraph at the end. It stays saved until you do one of those or discard it.",
    es: "Ubicala en esta página como está ahora, con vista previa, o agregala como párrafo al final. Queda guardada hasta que hagas una de esas cosas o la descartes.",
  },
  'dictation.openSaved': { en: "Open", es: "Abrir" },
  'dictation.insertAsText': { en: "Insert as text", es: "Insertar como texto" },
  'dictation.inserted': { en: "Added at the end of the page.", es: "Se agregó al final de la página." },
  'dictation.discardSaved': { en: "Discard this saved note? It can't be undone.", es: "¿Descartar esta nota guardada? No se puede deshacer." },
  'dictation.discardedSaved': { en: "Note discarded.", es: "Nota descartada." },
  'dictation.undoneQueued': { en: "Undone. The note is saved again.", es: "Deshecho. La nota volvió a quedar guardada." },
  'dictation.audioNote': { en: "Recording, not transcribed yet", es: "Grabación, todavía sin transcribir" },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(dictation);
