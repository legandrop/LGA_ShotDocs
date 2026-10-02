// Cortar un nombre largo sin partir lo que se ve como un solo carácter (un grafema): una bandera son dos puntos de
// código, un emoji con tono de piel también, una letra con su tilde suelta otros dos. Cortar por punto de código
// puede dejar media bandera o sacarle el tono a un emoji (roadmap P.9, pendientes de D3). El portero tiene la misma
// función (portero/src/core.ts, `cutText`).

type Segmenter = { segment(text: string): Iterable<{ segment: string }> };

let segmenter: Segmenter | null | undefined;

function getSegmenter(): Segmenter | null {
  if (segmenter === undefined) {
    const Ctor = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: string }) => Segmenter }).Segmenter;
    segmenter = Ctor ? new Ctor(undefined, { granularity: 'grapheme' }) : null;
  }
  return segmenter;
}

/** Los grafemas del texto (sin `Intl.Segmenter`, los puntos de código). */
export function graphemesOf(text: string): string[] {
  const seg = getSegmenter();
  if (!seg) return Array.from(text);
  return Array.from(seg.segment(text), (s) => s.segment);
}

/**
 * El principio del texto con grafemas enteros y **a lo sumo `max` puntos de código** (lo que cuenta la base, que
 * mide en caracteres). Un grafema que solo ya pasa el tope (cientos de marcas encimadas) se corta por punto de código.
 */
export function cutText(text: string, max: number): string {
  if (max <= 0) return '';
  if (Array.from(text).length <= max) return text;
  let out = '';
  let used = 0;
  for (const g of graphemesOf(text)) {
    const n = Array.from(g).length;
    if (used + n > max) {
      if (used === 0) return Array.from(g).slice(0, max).join('');
      break;
    }
    out += g;
    used += n;
  }
  return out;
}
