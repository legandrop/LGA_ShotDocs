import { useSyncExternalStore } from 'react';

// Las novedades de la ayuda (Docs/Doc_Tutorial.md, entrega 3). Va en la primera carga y es chico: el punto del "?"
// no puede esperar a la ayuda, que se baja aparte. Cada entrada de la ayuda dice la versión que la trajo (`since`, en
// `src/help/entries.ts`); lo nuevo es lo que tiene un `since` más nuevo que lo último que la persona vio.
//
// Se guarda en el dispositivo (`localStorage`, una clave para todos los workspaces, como la recorrida: es lo que la
// persona sabe de la app, no un dato del workspace): `{ seen, latest, app }`.
// - `seen`: el `since` más nuevo que había la última vez que abrió la ayuda (o cuando se empezó a contar).
// - `latest`: el `since` más nuevo de las entradas de la versión `app` de la app.
// - `app`: la versión de la app con la que se calculó `latest`. Cuando la app se actualiza, se vuelve a calcular
//   (una vez por versión: las entradas se bajan con la ayuda, aparte).
// La primera vez (nada guardado) se empieza a contar desde ahí: a alguien nuevo no se le marca todo como nuevo.

const KEY = 'shotdocs-help-news';
/**
 * El `since` de lo que todavía no se publicó lleva X en lugar del número (`0.0` seguido de `XX`, como el changelog):
 * quien publica lo cambia por la versión. Mientras tanto cuenta como lo más nuevo. Se reconoce por la forma y no por
 * el texto exacto, para que el reemplazo al publicar no toque esta regla.
 */
export function isUnpublished(v: string): boolean {
  return /^\d+\.\d*X+$/i.test(v);
}

/** Un `since` que se entiende: una versión publicada (`0.154`) o una sin publicar. */
export function isValidSince(v: string): boolean {
  return /^\d+\.\d{3}$/.test(v) || isUnpublished(v);
}

export interface HelpNewsState {
  seen: string;
  latest: string;
  app: string;
}

/** Una versión `0.154` como número para comparar; lo no publicado, más nuevo que todo; lo que no se entiende, NaN. */
export function versionValue(v: string): number {
  if (isUnpublished(v)) return Number.POSITIVE_INFINITY;
  const m = /^(\d+)\.(\d+)$/.exec(v);
  return m ? Number(m[1]) * 1_000_000 + Number(m[2]) : Number.NaN;
}

/** `a` es más nuevo que `b` (con algo que no se entiende, no). */
export function isNewer(a: string, b: string): boolean {
  return versionValue(a) > versionValue(b);
}

/** El `since` más nuevo de una lista. */
export function latestOf(sinces: readonly string[]): string {
  let best = '';
  for (const s of sinces) if (!best || isNewer(s, best)) best = s;
  return best;
}

const listeners = new Set<() => void>();

export function readHelpNews(): HelpNewsState | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<HelpNewsState> | null;
    return raw && typeof raw.seen === 'string' && typeof raw.latest === 'string' && typeof raw.app === 'string' ? (raw as HelpNewsState) : null;
  } catch {
    return null;
  }
}

function write(next: HelpNewsState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Sin almacenamiento, las novedades se vuelven a contar desde cero en la próxima carga: nada más.
  }
  for (const fn of listeners) fn();
}

/** Hay novedades sin ver (el punto del "?"). */
export function hasHelpNews(): boolean {
  const s = readHelpNews();
  return !!s && isNewer(s.latest, s.seen);
}

/**
 * Lo que la persona vio la última vez, si hay algo más nuevo (lo guarda la ayuda al abrirse, para listar las
 * novedades aunque al mismo tiempo se den por vistas); `null` si no hay novedades.
 */
export function helpNewsFrom(): string | null {
  const s = readHelpNews();
  return s && isNewer(s.latest, s.seen) ? s.seen : null;
}

/**
 * Al abrir la app: si cambió la versión desde la última cuenta, vuelve a calcular el `since` más nuevo de las
 * entradas (`load` las baja). La primera vez, lo que hay hoy cuenta como visto.
 */
export async function checkHelpNews(app: string, load: () => Promise<readonly string[]>): Promise<void> {
  const before = readHelpNews();
  if (before && before.app === app) return;
  let sinces: readonly string[];
  try {
    sinces = await load();
  } catch {
    // Sin la parte de la ayuda (sin red, primera carga): se prueba en la próxima.
    return;
  }
  const latest = latestOf(sinces);
  if (!latest) return;
  // Lo de otra pestaña que se haya escrito mientras tanto manda. Un "visto" sin publicar (una versión de prueba en
  // este mismo navegador) no frena para siempre las novedades de las versiones publicadas: se empieza de nuevo.
  const now = readHelpNews();
  const seen = now && !(isUnpublished(now.seen) && !isUnpublished(latest)) ? now.seen : latest;
  write({ seen, latest, app });
}

/** La ayuda se abrió y mostró las novedades: quedan vistas (el punto se va). */
export function markHelpNewsSeen(latest: string, app: string): void {
  if (!latest) return;
  const now = readHelpNews();
  // Una versión vieja de la ayuda abierta en otra pestaña nunca hace retroceder lo visto.
  const seen = now && isNewer(now.seen, latest) ? now.seen : latest;
  const newest = now && isNewer(now.latest, latest) ? now.latest : latest;
  if (now && now.seen === seen && now.latest === newest && now.app === app) return;
  write({ seen, latest: newest, app });
}

export function useHelpNews(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    hasHelpNews,
  );
}
