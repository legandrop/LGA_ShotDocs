// La proporción (ancho / alto) de cada foto en línea que ya se vio, por su dirección (`sdmedia://<id>` o `https`):
// la usan las filas con la misma altura (inlinePhotoEditor.ts; Docs/Doc_Fotos_En_Linea.md, "Filas con la misma
// altura"). Se anota al cargar la imagen (inlinePhoto.ts) y dura lo que dura la pestaña: una foto que se vuelve a
// dibujar (otra página, un cambio que llega de otro dispositivo, deshacer) ya tiene su proporción y su fila no salta.
// Es solo de lo que se ve: no se guarda en el documento.

const aspects = new Map<string, number>();
const listeners = new Set<(url: string) => void>();

/** La proporción conocida de la foto con esa dirección, o `undefined` si todavía no se vio. */
export function photoAspect(url: string): number | undefined {
  return aspects.get(url);
}

/**
 * Anota la proporción de una foto (la de su miniatura: lo que se ve). Avisa solo si es nueva o cambió (más de una
 * milésima): cargar la imagen nítida encima de la miniatura no vuelve a armar las filas.
 */
export function notePhotoAspect(url: string, aspect: number): void {
  if (!url || !Number.isFinite(aspect) || !(aspect > 0)) return;
  const old = aspects.get(url);
  if (old !== undefined && Math.abs(old - aspect) <= 1e-3 * old) return;
  aspects.set(url, aspect);
  for (const fn of [...listeners]) fn(url);
}

/** Avisa cada vez que se anota una proporción nueva (con la dirección de la foto). Devuelve cómo dejar de escuchar. */
export function onPhotoAspects(fn: (url: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Cómo rearmar ya las filas de cada editor abierto, por su elemento (lo anota la decoración de inlinePhotoEditor.ts). */
const flushers = new Map<Element, () => void>();

/** Anota cómo rearmar ya las filas del editor de `dom`. Devuelve cómo sacarlo. */
export function registerPhotoRows(dom: Element, flush: () => void): () => void {
  flushers.set(dom, flush);
  return () => {
    if (flushers.get(dom) === flush) flushers.delete(dom);
  };
}

/**
 * Rearma ya las filas con la misma altura que quedaron pendientes (una proporción que llegó y todavía no se dibujó, o
 * una imagen cargada cuyo aviso todavía no llegó) en los editores que están dentro de `within` (de fábrica, todos).
 * Imprimir y exportar a PDF lo llaman antes de copiar la página (`buildPrintView`): las filas se rearman en el cuadro
 * siguiente y la espera de imágenes mira `complete`, así que una fila podía salir con lo guardado, sobre todo con la
 * pestaña oculta. Vive acá (y no en el editor) para que imprimir no cargue el editor entero.
 */
export function flushPhotoRows(within?: Element | null): void {
  for (const [dom, flush] of [...flushers]) {
    if (!within || within.contains(dom)) flush();
  }
}

/** Solo para las pruebas: olvida todo. */
export function forgetPhotoAspects(): void {
  aspects.clear();
}
