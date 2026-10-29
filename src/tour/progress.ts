// El progreso de los recorridos en el dispositivo (Docs/Plan_Proyecto_Desde_Cero.md, sección 6). Va en la primera carga
// y es chico: lo leen la ayuda (el índice de capítulos), el arranque de la recorrida (retomar) y el motor.
//
// Se guarda **por id y versión de capítulo, nunca por posición**: reordenar los capítulos o sumar pasos no corrompe nada.
// Si un capítulo sube su `version`, la clave nueva no existe y el capítulo pasa a «actualizado». Un capítulo visto vale
// en todos los recorridos que lo usan. El cursor (dónde quedaste) es por recorrido; si su capítulo o su paso ya no
// existen, la ayuda no ofrece *Continue*.
//
// En el documento de práctica (tour.html) `localStorage` es uno en memoria (src/tour/isolate.ts): el progreso va al de
// verdad, el que guardó `isolate` en `__shotdocsRealStorage`, así la ayuda de la app lo ve al volver.

const KEY = 'shotdocs-tour-progress';

export interface TourCursor {
  chapter: string;
  step: string;
}

export interface Progress {
  /** `seen[capítulo][versión]`: el recorrido donde se vio. */
  seen: Record<string, Record<string, string>>;
  /** Dónde quedó cada recorrido. */
  at: Record<string, TourCursor>;
}

export type ChapterState = 'pending' | 'seen' | 'here' | 'updated';

/** El `localStorage` de verdad (en el documento de práctica, el que guardó `isolate.ts`). */
export function realStorage(): Storage | null {
  try {
    return (globalThis as { __shotdocsRealStorage?: Storage }).__shotdocsRealStorage ?? localStorage;
  } catch {
    return null;
  }
}

export function readProgress(): Progress {
  try {
    const raw = JSON.parse(realStorage()?.getItem(KEY) ?? 'null') as Partial<Progress> | null;
    if (raw && typeof raw === 'object') {
      return { seen: raw.seen && typeof raw.seen === 'object' ? raw.seen : {}, at: raw.at && typeof raw.at === 'object' ? raw.at : {} };
    }
  } catch {
    // Lo que no se entiende cuenta como nada visto.
  }
  return { seen: {}, at: {} };
}

function write(next: Progress): void {
  try {
    realStorage()?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Sin almacenamiento, el progreso dura lo que la pestaña: nada se pierde de la app.
  }
}

/** El capítulo `chapter` en su versión `version` quedó visto (al pasar su último paso). */
export function markSeen(tour: string, chapter: string, version: number): void {
  const p = readProgress();
  p.seen[chapter] = { ...p.seen[chapter], [String(version)]: tour };
  write(p);
}

export function setCursor(tour: string, at: TourCursor): void {
  const p = readProgress();
  const old = p.at[tour];
  if (old && old.chapter === at.chapter && old.step === at.step) return;
  p.at[tour] = { chapter: at.chapter, step: at.step };
  write(p);
}

/** El recorrido se terminó: no queda nada para seguir (lo visto se queda). */
export function clearCursor(tour: string): void {
  const p = readProgress();
  if (!p.at[tour]) return;
  delete p.at[tour];
  write(p);
}

export function cursorOf(tour: string, p: Progress = readProgress()): TourCursor | null {
  const at = p.at[tour];
  return at && typeof at.chapter === 'string' && typeof at.step === 'string' ? at : null;
}

/** Cómo está un capítulo para la ayuda: acá quedaste, visto, visto en una versión anterior, o pendiente. */
export function chapterState(p: Progress, tour: string, chapter: { id: string; version: number }): ChapterState {
  if (cursorOf(tour, p)?.chapter === chapter.id) return 'here';
  const seen = p.seen[chapter.id];
  if (seen?.[String(chapter.version)]) return 'seen';
  return seen && Object.keys(seen).length > 0 ? 'updated' : 'pending';
}
