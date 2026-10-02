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

  // V3: el micrófono propio.
  'dictation.micStart': { en: "Record a voice note", es: "Grabar una nota de voz" },
  'dictation.micStop': { en: "Stop and save", es: "Cortar y guardar" },
  'dictation.micIdle': {
    en: "Tap to record, tap again to stop. The recording is saved on this device as you talk.",
    es: "Tocá para grabar y otra vez para cortar. La grabación se guarda en este dispositivo mientras hablás.",
  },
  'dictation.micStarting': { en: "Getting the microphone…", es: "Abriendo el micrófono…" },
  'dictation.micRecording': { en: "Recording · {time} · tap to stop", es: "Grabando · {time} · tocá para cortar" },
  'dictation.micEnding': { en: "Recording · {time} · it stops at {max}", es: "Grabando · {time} · se corta a los {max}" },
  'dictation.micSaving': { en: "Saving the recording…", es: "Guardando la grabación…" },
  'dictation.micDenied': {
    en: "Microphone access was denied. On the iPhone: Settings › Safari › Microphone (or, in Safari, aA › Website Settings) and allow it; on a computer, the microphone icon in the address bar.",
    es: "Se negó el acceso al micrófono. En el iPhone: Ajustes › Safari › Micrófono (o, en Safari, aA › Configuración del sitio web) y permitilo; en la compu, el ícono del micrófono en la barra de direcciones.",
  },
  'dictation.micNone': { en: "No microphone was found.", es: "No se encontró un micrófono." },
  'dictation.micUnsupported': {
    en: "This browser can't record. Use your keyboard's microphone in the field below.",
    es: "Este navegador no puede grabar. Usá el micrófono del teclado en el campo de abajo.",
  },
  'dictation.micStorage': {
    en: "Can't save the recording on this device, so it didn't record. Free some space or use your keyboard's microphone.",
    es: "No se puede guardar la grabación en este dispositivo, así que no grabó. Liberá espacio o usá el micrófono del teclado.",
  },
  'dictation.micFailed': { en: "The microphone couldn't start. Try again.", es: "No se pudo abrir el micrófono. Probá de nuevo." },
  'dictation.nothingRecorded': { en: "Nothing was recorded.", es: "No se grabó nada." },
  'dictation.recordedOffline': {
    en: "Saved. It will be transcribed and placed when you're back online.",
    es: "Guardada. Se transcribe y se ubica cuando vuelva la red.",
  },
  'dictation.voicePolicy': {
    en: "The owner of this workspace doesn't allow sending recordings to this provider. The recording stays saved on this device.",
    es: "El dueño de este workspace no permite mandar grabaciones a este proveedor. La grabación queda guardada en este dispositivo.",
  },
  'dictation.voiceSetupText': {
    en: "To record, choose who turns your voice into text in Voice (OpenAI, Gemini or a compatible service, with your key). Anthropic doesn't take audio.",
    es: "Para grabar, elegí en Voz quién pasa tu voz a texto (OpenAI, Gemini o un servicio compatible, con tu clave). Anthropic no recibe audio.",
  },
  'dictation.transcribing': { en: "Transcribing…", es: "Transcribiendo…" },
  'dictation.transcribe': { en: "Transcribe", es: "Transcribir" },
  'dictation.transcript': { en: "Transcription", es: "Transcripción" },
  'dictation.audioSaved': { en: "Recording of {duration}, not transcribed yet.", es: "Grabación de {duration}, todavía sin transcribir." },
  'dictation.nothingHeard': { en: "Didn't catch that.", es: "No se entendió nada." },
  'dictation.emptyRecording': { en: "The recording is empty.", es: "La grabación está vacía." },
  'dictation.transcribeFailed': { en: "It couldn't be transcribed.", es: "No se pudo transcribir." },
  'dictation.insertAtCursor': { en: "Insert at cursor", es: "Insertar en el cursor" },
  'dictation.insertedAtCursor': { en: "Inserted at the cursor.", es: "Se insertó en el cursor." },
  'dictation.cursorFailed': {
    en: "Put the cursor where the text goes first (in a paragraph, a cell or a comment), then come back.",
    es: "Primero poné el cursor donde va el texto (en un párrafo, una celda o un comentario) y volvé.",
  },
  'dictation.askMic': { en: "Dictate the request", es: "Dictar el pedido" },
  'dictation.askMicStop': { en: "Stop and transcribe", es: "Cortar y transcribir" },

  // V3: la ventana *Voice*.
  'dictation.voice.title': { en: "Voice", es: "Voz" },
  'dictation.voice.intro': {
    en: "The microphone of Dictate to report records on this device and sends the recording to the provider you choose here, with your key, to turn it into text. Nothing goes through Shot Docs.",
    es: "El micrófono de Dictar al reporte graba en este dispositivo y manda la grabación al proveedor que elijas acá, con tu clave, para pasarla a texto. Nada pasa por Shot Docs.",
  },
  'dictation.voice.sameKey': { en: "Same as the assistant ({provider})", es: "La misma del asistente ({provider})" },
  'dictation.voice.sameKeyNo': {
    en: "Same as the assistant (not possible: set the assistant to OpenAI, Gemini or a compatible service)",
    es: "La misma del asistente (no se puede: el asistente tiene que usar OpenAI, Gemini o un servicio compatible)",
  },
  'dictation.voice.ownKey': { en: "Another key, only for voice", es: "Otra clave, solo para la voz" },
  'dictation.voice.provider': { en: "Provider", es: "Proveedor" },
  'dictation.voice.baseUrl': { en: "Base URL", es: "Dirección (Base URL)" },
  'dictation.voice.key': { en: "API key", es: "Clave (API key)" },
  'dictation.voice.keySaved': { en: "Saved on this device", es: "Guardada en este dispositivo" },
  'dictation.voice.model': { en: "Transcription model", es: "Modelo de transcripción" },
  'dictation.voice.geminiFree': {
    en: "On Gemini's free tier, Google uses what you send to improve its products, also your voice recordings.",
    es: "En el nivel gratis de Gemini, Google usa lo que mandás para mejorar sus productos, también tus grabaciones de voz.",
  },
  'dictation.voice.works': { en: "The key works.", es: "La clave anda." },
  'dictation.voice.saveFailed': { en: "Couldn't save. Try again.", es: "No se pudo guardar. Probá de nuevo." },
  'dictation.voice.forgotten': { en: "The voice key was removed from this device.", es: "Se sacó la clave de voz de este dispositivo." },
  'dictation.voice.forget': { en: "Forget voice key", es: "Olvidar la clave de voz" },
  'dictation.voice.test': { en: "Test", es: "Probar" },
  'dictation.voice.save': { en: "Save", es: "Guardar" },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(dictation);
