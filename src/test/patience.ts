import { vi } from 'vitest';

// Las esperas por condición de las pruebas (`vi.waitFor`) se rinden al segundo si no se les dice otra cosa. Con la
// máquina cargada (la suite entera, varios procesos a la vez), un recorrido que pasa por IndexedDB, React y el motor
// de sincronización tarda más que eso, y la prueba fallaba sin que nada estuviera mal: sola pasaba siempre.
//
// El plazo de una espera por condición no es algo que la prueba afirme: es solo cuándo deja de mirar. Lo que se afirma
// es la condición, y esa no cambia. Por eso el plazo por defecto se fija acá, una vez, para todas: holgado, pero por
// debajo del tope de cada prueba (`testTimeout`, vite.config.ts), así una condición que nunca llega sigue fallando con
// su propio mensaje y no con un "se acabó el tiempo" que no dice qué faltó. Una prueba que pide su plazo lo conserva.

/** Lo máximo que una espera por condición sigue mirando antes de fallar con el último error de la condición. */
export const WAIT_FOR_MS = 10_000;

const waitFor = vi.waitFor.bind(vi);
vi.waitFor = ((callback, options) =>
  waitFor(callback, typeof options === 'number' ? options : { timeout: WAIT_FOR_MS, ...options })) as typeof vi.waitFor;
