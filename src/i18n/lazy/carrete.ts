import { register } from '../index';
import type { Dict } from '../types';

// El carrete de fotos y videos (se carga aparte, con Carrete.tsx).

export const carrete = {
  'carrete.original': { en: 'Original', es: 'Original' },
  'carrete.withAnnotations': { en: 'With annotations', es: 'Con anotaciones' },
  'carrete.raster.unsupported': { en: 'Annotated downloads currently support JPEG and PNG originals. HEIC and other formats are not supported yet. Download the original instead.', es: 'La descarga anotada admite originales JPEG y PNG. HEIC y otros formatos todavía no están disponibles. Podés bajar el original.' },
  'carrete.raster.size': { en: 'This photo cannot be prepared at full resolution on this device. No smaller copy was made. Download the original instead.', es: 'Esta foto no se puede preparar en resolución completa en este dispositivo. No se hizo una copia más chica. Podés bajar el original.' },
  'carrete.raster.annotations': { en: 'These annotations cannot all be included by this version. Download the original or use a newer app; your annotations have not changed.', es: 'Esta versión no puede incluir todas las anotaciones. Podés bajar el original o usar una app más nueva; tus anotaciones no cambiaron.' },
  'carrete.raster.source': { en: 'The full original could not be prepared, or it changed. Check that it is available offline, or reconnect and try again. Download the original remains available.', es: 'No se pudo preparar el original completo, o cambió. Revisá que esté disponible sin conexión, o reconectá y volvé a probar. Sigue disponible la descarga del original.' },
  'carrete.raster.encode': { en: 'The annotated photo could not be created on this device. No file was downloaded. Download the original instead.', es: 'No se pudo crear la foto anotada en este dispositivo. No se descargó ningún archivo. Podés bajar el original.' },
  'carrete.label': { en: "Photos, videos and files", es: "Fotos, videos y archivos" },
  'carrete.download': { en: "Download", es: "Descargar" },
  'carrete.open': { en: "Open", es: "Abrir" },
  'carrete.preparing': { en: "Preparing…", es: "Preparando…" },
  'carrete.downloadNamed': { en: "Download {name}", es: "Descargar {name}" },
  'carrete.downloadOffline': {
    en: "Download {name} (not available offline)",
    es: "Descargar {name} (no disponible sin conexión)",
  },
  'carrete.previous': { en: "Previous", es: "Anterior" },
  'carrete.next': { en: "Next", es: "Siguiente" },
  'carrete.offlineMissing': {
    en: "You're offline, and this file isn't on this device yet.",
    es: "Estás sin conexión, y este archivo todavía no está en este dispositivo.",
  },
  'carrete.offlineVideo': {
    en: "You're offline. The video plays when you're back online.",
    es: "Estás sin conexión. El video se reproduce cuando vuelva la conexión.",
  },
  'carrete.offlinePhoto': {
    en: "You're offline: this is the thumbnail. The full photo loads when you're back online.",
    es: "Estás sin conexión: esta es la miniatura. La foto completa se carga cuando vuelva la conexión.",
  },
  'carrete.offlinePhotoLarge': {
    en: "You're offline: this is the large version saved on this device. The original loads when you're back online.",
    es: "Estás sin conexión: esta es la versión grande guardada en este dispositivo. El original se carga cuando vuelva la conexión.",
  },
  'carrete.unplayableVideo': {
    en: "The video couldn't be loaded or played in this browser.",
    es: "El video no se pudo cargar ni reproducir en este navegador.",
  },
  'carrete.unplayablePhoto': {
    en: "The photo couldn't be loaded or shown in this browser.",
    es: "La foto no se pudo cargar ni mostrar en este navegador.",
  },
  'carrete.unsupportedVideo': {
    en: "This video can't be played in this browser.",
    es: "Este video no se puede reproducir en este navegador.",
  },
  'carrete.rarePhoto': {
    en: "This browser can't show this photo's format.",
    es: "Este navegador no puede mostrar el formato de esta foto.",
  },
  'carrete.unsupportedPhoto': { en: "The full photo couldn't be shown.", es: "La foto completa no se pudo mostrar." },
  'carrete.failedVideo': { en: "The video couldn't be loaded.", es: "El video no se pudo cargar." },
  'carrete.failedPhoto': { en: "The full photo couldn't be loaded.", es: "La foto completa no se pudo cargar." },
  'carrete.failedVideoReason': {
    en: "The video couldn't be loaded: {reason}",
    es: "El video no se pudo cargar: {reason}",
  },
  'carrete.failedPhotoReason': {
    en: "The full photo couldn't be loaded: {reason}",
    es: "La foto completa no se pudo cargar: {reason}",
  },
  'carrete.freedHere': {
    en: "The copy on this device was freed to save space; it's in Drive.",
    es: "La copia de este dispositivo se liberó para hacer lugar; está en Drive.",
  },
  'carrete.offlineFile': {
    en: "You're offline, and this file isn't on this device. You can open or download it when you're back online.",
    es: "Estás sin conexión, y este archivo no está en este dispositivo. Vas a poder abrirlo o bajarlo cuando vuelva la conexión.",
  },
  'carrete.failedFile': { en: "The file couldn't be prepared to open or download.", es: "El archivo no se pudo preparar para abrirlo o bajarlo." },
  'carrete.failedFileReason': {
    en: "The file couldn't be prepared to open or download: {reason}",
    es: "El archivo no se pudo preparar para abrirlo o bajarlo: {reason}",
  },
  // Las anotaciones de las fotos (P.20, Docs/Doc_Anotar_Fotos.md, AN9).
  'carrete.hideMarkup': { en: "Hide annotations", es: "Ocultar anotaciones" },
  'carrete.showMarkup': { en: "Show annotations", es: "Mostrar anotaciones" },
  'carrete.markupHidden': { en: "This photo has hidden annotations", es: "Esta foto tiene anotaciones ocultas" },
  'carrete.annotate': { en: "Annotate", es: "Anotar" },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(carrete);
