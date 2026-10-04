import { register } from '../index';
import type { Dict } from '../types';

// El carrete de fotos y videos (se carga aparte, con Carrete.tsx).

export const carrete = {
  'carrete.copy.withAnnotations': { en: 'Copy with annotations', es: 'Copiar con anotaciones' },
  'carrete.copy.action': { en: 'Copy', es: 'Copiar' },
  'carrete.copy.writing': { en: 'Copying…', es: 'Copiando…' },
  'carrete.copy.copied': { en: 'Copied', es: 'Copiado' },
  'carrete.copy.unsupported': { en: 'This browser cannot copy images here. You can download the original instead.', es: 'Este navegador no puede copiar imágenes acá. Podés bajar el original.' },
  'carrete.copy.denied': { en: 'Your browser did not allow this copy. Tap Copy to try again, or download the original.', es: 'El navegador no permitió esta copia. Tocá Copiar para reintentar, o bajá el original.' },
  'carrete.copy.changed': { en: 'The annotations changed. Close and prepare the copy again.', es: 'Las anotaciones cambiaron. Cerrá y volvé a preparar la copia.' },
  'carrete.copy.format': { en: 'Annotated copies support JPEG, PNG and simple static WebP originals as PNG. Animated or extended WebP is not supported. Download the original instead.', es: 'Las copias anotadas admiten originales JPEG, PNG y WebP estático simple como PNG. WebP animado o extendido no está disponible. Podés bajar el original.' },
  'carrete.copy.size': { en: 'This photo cannot be copied at full resolution on this device. No smaller copy was made. Download the original instead.', es: 'Esta foto no se puede copiar en resolución completa en este dispositivo. No se hizo una copia más chica. Podés bajar el original.' },
  'carrete.copy.annotations': { en: 'This version cannot include all annotations. Download the original or use a newer app; your annotations have not changed.', es: 'Esta versión no puede incluir todas las anotaciones. Podés bajar el original o usar una app más nueva; tus anotaciones no cambiaron.' },
  'carrete.copy.source': { en: 'The full original is unavailable or changed. Check its offline copy or reconnect, then prepare again. Original is still available.', es: 'El original completo no está disponible o cambió. Revisá su copia sin conexión o reconectá y volvé a preparar. Original sigue disponible.' },
  'carrete.copy.encode': { en: 'The annotated PNG could not be prepared. No image was copied. Download the original instead.', es: 'No se pudo preparar el PNG anotado. No se copió ninguna imagen. Podés bajar el original.' },
  'carrete.original': { en: 'Original', es: 'Original' },
  'carrete.withAnnotations': { en: 'With annotations', es: 'Con anotaciones' },
  'carrete.raster.unsupported': { en: 'Annotated downloads support JPEG, PNG and simple static WebP (saved as PNG). Animated or extended WebP, HEIC and other formats are not supported. Download the original instead.', es: 'La descarga anotada admite JPEG, PNG y WebP estático simple (se guarda como PNG). WebP animado o extendido, HEIC y otros formatos no están disponibles. Podés bajar el original.' },
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
