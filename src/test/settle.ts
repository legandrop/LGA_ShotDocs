// Esperar a que la app termine lo que tiene en marcha, para las pruebas de pantallas.
//
// Muchas pruebas hacen clic y esperan "un rato" (30, 100, 200 ms) antes de mirar la pantalla. Ese rato alcanza con la
// máquina libre y no con la suite entera corriendo: lo que dispara un clic (leer y escribir en IndexedDB, hablar con
// el servidor de prueba, volver a dibujar) son cientos de pasos encadenados, y con la máquina cargada cada paso tarda
// más. La prueba miraba antes de que terminaran y fallaba sin que nada estuviera mal; sola pasaba siempre.
//
// Acá el rato se conserva (hay cosas que la app hace a propósito después de una pausa, y hay que darles ese tiempo) y
// después se espera a que no quede trabajo encadenado. En estas pruebas todo corre en el mismo proceso y cada paso que
// no es inmediato se encadena con una tarea del proceso (así agenda la base en memoria cada pedido, y así vuelven sus
// respuestas): mientras quede alguna pendiente, algo sigue en marcha. Lo que la prueba afirma después no cambia; para
// lo que afirma que algo NO pasó, esperar a que todo termine es más exigente, no menos.
//
// Lo que no ve: una cadena que avanza solo con temporizadores. Un salto suelto por un temporizador corto sí (se le da
// lugar, abajo); una espera larga de la app (una pausa de un segundo antes de sincronizar) no, y es a propósito: esa
// es la que la prueba pide con su rato, o la que espera por su condición.

/** Lo máximo que se espera a que termine lo encadenado (una vuelta que nunca se calma no cuelga la prueba). */
const DRAIN_CAP_MS = 8_000;
/** Vueltas seguidas sin nada pendiente para dar por terminado lo encadenado. */
const CALM_TURNS = 3;
/** Un paso que salta por un temporizador corto (`setTimeout(…, 0)`): se le da lugar esta cantidad de veces seguidas. */
const QUIET_HOPS = 3;
const HOP_MS = 2;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const workPending = () => process.getActiveResourcesInfo().includes('Immediate');

/**
 * Espera a que no quede trabajo encadenado: varias vueltas seguidas del proceso sin ninguna tarea pendiente, y eso
 * mismo después de darle lugar a un temporizador corto que ya estuviera puesto (los temporizadores corren en el orden
 * en que vencen: uno puesto antes y más corto que el de acá corre primero, por más cargada que esté la máquina).
 */
export async function drained(capMs = DRAIN_CAP_MS): Promise<void> {
  const end = Date.now() + capMs;
  for (let quiet = 0; quiet < QUIET_HOPS; ) {
    let worked = false;
    for (let calm = 0; calm < CALM_TURNS; ) {
      if (Date.now() >= end) return;
      await turn();
      if (workPending()) {
        calm = 0;
        worked = true;
      } else calm++;
    }
    await sleep(HOP_MS);
    quiet = worked || workPending() ? 0 : quiet + 1;
  }
}

/** Espera `ms` (lo que la app hace después de una pausa) y después a que termine todo lo encadenado. */
export async function settled(ms = 0): Promise<void> {
  if (ms > 0) await sleep(ms);
  await drained();
}
