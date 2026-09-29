# Sincronización offline

Cómo funciona hoy la regla de no perder nunca información. El código está en `src/sync/` y las pruebas en
`src/sync/sync.test.ts` (`npm test`).

## Piezas

| Pieza | Archivo | Qué hace |
|---|---|---|
| Base local | `localDb.ts` | IndexedDB por usuario y por proyecto: copia del árbol, cola de salida, updates de contenido, estado de cada página e imágenes. |
| Contenido | `docs.ts` | Un documento Yjs por página. Guarda cada edición en el dispositivo y sube o baja lo que falte. |
| Árbol | `tree.ts` | La copia del árbol que mandó el servidor más la cola de cambios locales encima. |
| Imágenes | `files.ts` | Guarda la imagen pegada en el dispositivo y la sube cuando hay red. |
| Servidor | `remote.ts` | Las llamadas a Supabase. Las pruebas usan un servidor en memoria con las mismas reglas (`testing.ts`). |
| Motor | `engine.ts` | El ciclo de sincronización y el estado que muestra la app. |

## Contenido de las páginas

1. **Primero el dispositivo.** Cada edición se guarda en IndexedDB en cuanto ocurre. Mientras una escritura
   está en curso, las ediciones siguientes se juntan y salen todas en la próxima transacción, así nunca se
   acumula una fila de escrituras: si la app se cierra de golpe, lo único que puede faltar es lo de la
   última transacción.
2. **Qué falta subir.** Cada página guarda `syncedSV`, el vector de estado de Yjs de lo que el servidor ya
   confirmó. Lo pendiente es siempre la diferencia entre el documento local y ese vector, así que no
   importa si la app se cerró a mitad de camino: al volver se recalcula entera.
3. **Envío con confirmación.** Antes de enviar, el update se guarda en el dispositivo con un id propio. Si
   la respuesta no llega, se reenvía el mismo update con el mismo id y el servidor devuelve el mismo `seq`
   sin duplicar nada. Recién con la confirmación avanza `syncedSV`.
4. **Bajar lo nuevo.** El árbol trae el último `seq` de cada página. Si es mayor que el que tiene el
   dispositivo, se bajan los updates posteriores y se guardan en la misma transacción que el nuevo cursor.
   Así se bajan también las páginas que nunca se abrieron en ese dispositivo, y quedan disponibles offline.
5. **Fusión.** Dos dispositivos que editan la misma página sin red se fusionan con Yjs al volver: nunca gana
   "el último".
6. **Abrir en un dispositivo nuevo.** Si el servidor tiene contenido que el dispositivo no, se baja antes de
   mostrar el editor (hasta 4 segundos; si no llega, se abre igual y se fusiona después).
7. **Compactación local.** Con más de 64 updates guardados, al abrir la página se fusionan en uno solo, en la
   misma transacción. En el servidor no se compacta todavía.

## Árbol de páginas

- Crear, renombrar, mover, mandar a la papelera y restaurar entran a una **cola de salida** en IndexedDB y
  se aplican en la vista en el acto.
- Se suben en el orden en que se hicieron. Crear una página es idempotente (`upsert` por id generado en el
  dispositivo), así que reintentar no falla.
- Si el servidor rechaza un cambio para siempre (por ejemplo, dos movimientos offline que juntos arman un
  ciclo), el cambio pasa a la lista de rechazados y la app lo avisa. Una **creación rechazada nunca
  desaparece**: la página y sus cambios siguen a la vista, su contenido sigue en el dispositivo y se puede
  reintentar. "Ocultar" solo descarta rechazos que no dejan nada afuera (renombrar, mover o borrar una
  página que ya está en el servidor).
- El contenido de una página se sube recién cuando la página existe en el servidor.

## Ciclo de sincronización

Nunca corren dos a la vez. En orden: cambios del árbol, árbol completo del servidor, imágenes pendientes,
contenido pendiente y contenido nuevo. Corre al abrir la app, un poco después de cada cambio, cada 10
segundos con la app a la vista, al volver la red y al volver a la ventana.

## Estado visible

La barra lateral dice siempre si todo está sincronizado, cuántos cambios faltan subir, si no hay conexión
(y que los cambios están guardados en el dispositivo) y si el servidor rechazó algo.

## Sin red al abrir

- La app queda en caché con un service worker (PWA), así que abre sin red.
- Si la sesión venció y no hay red para renovarla, se sigue con el último usuario conocido y se renueva sola
  cuando vuelve la red.
- La app pide almacenamiento persistente (`navigator.storage.persist()`) para que el navegador no borre los
  datos locales.
