// El documento de práctica de los recorridos (tour.html, src/tour/practiceDoc.tsx) y la vuelta a él. Va en la primera
// carga: main.tsx lo mira antes de arrancar la app, y la ayuda y la recorrida lo usan para entrar y salir.
//
// Por qué hace falta: la app de práctica navega como la de verdad, así que la dirección pasa a `/p/<id de práctica>` o a
// `/map`. Si se recarga ahí, el servidor (o el service worker) devuelve la app real, que no conoce esa página. Elegido:
// el documento de práctica deja en `sessionStorage` (de la pestaña) una marca con su dirección de entrada y la dirección
// de ahora; main.tsx, si la carga es una **recarga** de esa misma dirección, vuelve al recorrido sin arrancar la app. Se
// descartó un prefijo en los ids de práctica: los ids los arma el árbol con `crypto.randomUUID`, y tocarlo sería tocar
// la sincronización. La marca no sirve para nada más: se borra al leerla, al salir del recorrido, y si la carga no es
// una recarga (Atrás, un link, la dirección escrita a mano).

export const TOUR_DOC_PATH = '/tour.html';
const MARK = 'shotdocs-tour-doc';
const LAUNCH = 'shotdocs-tour-launch';

/** El `sessionStorage` de verdad (en el documento de práctica, el que guardó `isolate.ts`). */
function session(): Storage | null {
  try {
    return (globalThis as { __shotdocsRealSession?: Storage }).__shotdocsRealSession ?? sessionStorage;
  } catch {
    return null;
  }
}

/** Una dirección de la app a la que se puede volver: de este sitio, nunca otra pestaña de práctica. */
export function safeBack(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  // Tampoco la dirección limpia (`/tour`), la que puede dar Cloudflare al servir tour.html.
  if (raw.startsWith(TOUR_DOC_PATH) || raw === '/tour' || raw.startsWith('/tour?')) return '/';
  return raw;
}

export function tourDocHref(tour: string, chapter: string | null, back: string): string {
  const q = new URLSearchParams({ tour });
  if (chapter) q.set('chapter', chapter);
  q.set('back', safeBack(back));
  return `${TOUR_DOC_PATH}?${q}`;
}

/** El documento de práctica anota su entrada (`href`) y dónde está ahora (`at`), para volver si se recarga. */
export function markTourDoc(href: string, at: string): void {
  try {
    session()?.setItem(MARK, JSON.stringify({ href, at }));
  } catch {
    // Sin almacenamiento, recargar a mitad cae en la app real: nada se pierde.
  }
}

/** Sale del documento de práctica a `back` (sin dejar la práctica en el historial); `launch`: un recorrido de la app. */
export function leaveTourDoc(back: string, launch?: { tour: string; chapter: string }): void {
  try {
    session()?.removeItem(MARK);
    if (launch) session()?.setItem(LAUNCH, JSON.stringify(launch));
  } catch {
    // Sin almacenamiento: se vuelve igual.
  }
  location.replace(safeBack(back));
}

/** El recorrido de la app que pidió el documento de práctica al salir (una sola vez). */
export function takeLaunchIntent(): { tour: string; chapter: string } | null {
  try {
    const raw = session()?.getItem(LAUNCH);
    if (!raw) return null;
    session()?.removeItem(LAUNCH);
    const it = JSON.parse(raw) as { tour?: unknown; chapter?: unknown };
    return typeof it.tour === 'string' ? { tour: it.tour, chapter: typeof it.chapter === 'string' ? it.chapter : '' } : null;
  } catch {
    return null;
  }
}

/** main.tsx: si es la recarga de una dirección del recorrido, vuelve a él (`true`: la app real no arranca). */
export function backToTour(): boolean {
  try {
    const store = session();
    const raw = store?.getItem(MARK);
    if (!raw) return false;
    store!.removeItem(MARK);
    const mark = JSON.parse(raw) as { href?: unknown; at?: unknown };
    const nav = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
    const here = location.pathname + location.search;
    if (nav?.type !== 'reload' || mark.at !== here || typeof mark.href !== 'string' || !mark.href.startsWith(`${TOUR_DOC_PATH}?`)) return false;
    location.replace(mark.href);
    return true;
  } catch {
    return false;
  }
}
