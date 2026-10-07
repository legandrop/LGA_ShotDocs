import { act } from 'react';
import { WAIT_FOR_MS } from './patience';
import { settled } from './settle';

// Esperar algo que tiene que aparecer en la pantalla, para las pruebas que montan React.
//
// `await act(() => vi.waitFor(condición))` parece la forma de esperar una condición de pantalla, y no lo es: mientras
// un `act` está abierto React junta lo que tiene para dibujar y recién lo dibuja cuando el `act` termina. Si el cambio
// de estado llega durante la espera, la condición mira una pantalla que no se va a actualizar, se rinde a su plazo y
// falla sin que nada esté mal. Solo pasaba cuando el cambio había llegado antes de empezar a esperar: con la máquina
// libre, casi siempre; con la suite entera corriendo junto a otros procesos, no.
//
// Acá se mira afuera del `act` y entre mirada y mirada se abre y se cierra uno corto: en cada cierre React dibuja lo
// que juntó. Lo que se afirma es la condición, igual que con `vi.waitFor`; el plazo es solo cuándo se deja de mirar.
//
// No sirve para afirmar que algo NUNCA pasa: una negativa que ya es cierta se cumple en la primera mirada, a los 0 ms,
// y una condición que se cumple un instante y después deja de cumplirse también se da por buena (igual que con
// `vi.waitFor`). Para eso: el rato pedido con `settled` y, recién después, mirar.

/** Lo que dura cada `act` entre dos miradas (más lo que tarde en terminar lo que quedó en marcha). */
const STEP_MS = 15;

/**
 * Espera a que `check` deje de fallar y devuelve lo que devuelve. Si el plazo se cumple, falla con el último error de
 * la condición (qué faltaba), no con un "se acabó el tiempo".
 */
export async function shown<T>(check: () => T | Promise<T>, timeoutMs = WAIT_FOR_MS): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() >= end) throw error;
    }
    await act(() => settled(STEP_MS));
  }
}
