import type { NeedWorld } from './catalog';

// El proyecto de práctica del documento aparte (tour.html, src/tour/practiceDoc.tsx): el árbol en memoria, el proyecto y
// las carpetas de sus etapas. Lo pone la entrada del documento; lo leen las condiciones de los pasos, los requisitos de
// los capítulos y las anclas `{ page: [...] }`. En la app de verdad no hay ninguno (`null`).

let world: NeedWorld | null = null;

export function setPracticeWorld(next: NeedWorld | null): void {
  world = next;
}

export function practiceWorld(): NeedWorld | null {
  return world;
}
