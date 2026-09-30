# Investigación: el caso intermitente de la prueba de punta a punta (roadmap B.5)

Resultados de la investigación del punto 5 de `Doc_Roadmap.md` (sección B): dos dispositivos que escriben
sin red en la misma página nueva y uno que tarda más de 40 segundos en mostrar la línea del otro aunque los
dos dicen "All synced". También los dos cortes por tiempo sueltos de la noche del 29 al 30 de septiembre:
la aserción "sin red, lo escrito offline sigue ahí después de recargar" de `e2e.mjs` y un `TimeoutError`
de `features.mjs`.

**Nada de esto está aplicado en la app ni en las pruebas.** Las correcciones propuestas están al final y
quedaron como parches aparte.

## Resumen

| Caso | Qué pasa | ¿Vista del editor o sincronización? |
|---|---|---|
| Dos dispositivos, página nueva, sin red | En condiciones normales se ve la línea del otro en 2 a 4 s (el peor caso natural es el ciclo de 10 s, hasta 13 s). Más de 40 s con "All synced" se reprodujo de dos maneras: **(a)** el dispositivo B abre la página en solo lectura porque la bajada tardó más de 4 s, y lo que escribe no entra en ningún lado; **(b)** una consulta que nunca responde deja trabado el ciclo de sincronización. | Ninguna de las dos es la vista: en todas las repeticiones el editor, el Y.Doc en memoria e IndexedDB cambiaron juntos. (a) es de la prueba (escribe sin esperar a que se pueda editar); (b) es de la sincronización (las consultas no tienen tope de tiempo). |
| Recargar sin red (`e2e.mjs`) | **Se pierde el final de lo escrito** (a veces la línea entera): la prueba recarga a los pocos milisegundos de la última tecla y lo que todavía no se confirmó en IndexedDB se pierde. No es que el texto aparezca tarde. | Del guardado local (`src/sync/docs.ts`) y de la prueba. |
| `TimeoutError` de `features.mjs` | El menú "Turn into" de la barra de formato se cierra solo: la barra se vuelve a montar con cada cambio del estado de sincronización. | De la interfaz (`src/ui/PageEditor.tsx`). |

## Cómo se probó

- **Versión:** la publicada, `main` en `cb285c1` (v0.029), compilada en una copia aparte del repo. Para
  comparar, también la rama en desarrollo (`9eeddb7`, v0.030). En una copia de cada compilación se expuso,
  solo para medir, el estado interno (`PageDocs`, `SyncEngine`, la base local y Yjs); el comportamiento es
  el mismo. Las corridas de los scripts originales usaron la compilación limpia de `main`.
- **Entorno:** Chromium de Playwright contra la base de producción, con usuarios temporales
  `@shotdocs-test.invalid` creados y borrados en cada corrida (al final no quedó ninguno de estas corridas;
  la cuenta de prueba vieja no se tocó). Cada servidor de la app corrió en un puerto propio.
- **Qué se registró:** en cada paso y cada 250 ms, para los dos dispositivos: el texto del editor (DOM),
  si el editor se puede editar, el aviso "still downloading", el contenido del Y.Doc en memoria, lo
  guardado en IndexedDB (updates y estado de la página: `cursor`, `version`, `ackedVersion`), el `seq` de
  la página en el árbol, el badge y el estado del motor (`syncing`, `lastSyncAt`); cada 2 s, lo que hay en
  el servidor (`page_updates`, armado con Yjs); y cada llamada al servidor del contenido (árbol, subidas,
  bajadas) con su hora.

## Dos dispositivos, página nueva, sin red

La prueba enfocada repite el paso B1 de `e2e.mjs`: A crea una página, B la abre, los dos se quedan sin red,
cada uno escribe una línea, vuelve la red y se mide cuánto tarda cada uno en mostrar la línea del otro.

| Corridas | Qué | Peor de los dos en ver la línea del otro | Resultado |
|---|---|---|---|
| 20 | Como la prueba original (evento `online` a mano y `focus` al quedar "All synced") | 1,9 a 4,0 s (mediana 2,2 s) | Todas bien. El servidor tuvo las dos líneas a los 1,1 a 3,4 s. |
| 10 | Sin el `focus` | 1,8 a 3,6 s (mediana 2,3 s) | Todas bien. |
| 12 | B vuelve a la red 2,5 s después que A, sin eventos a mano | 10,1 a 12,8 s (mediana 12,2 s) | Todas bien. A dice "All synced" enseguida y ve la línea de B en el ciclo siguiente (cada 10 s). |
| 10 | La rama en desarrollo, como la original | 2,2 a 5,7 s | Todas bien. |
| 3 | La bajada de B al abrir la página tarda 5 s (más que la espera de 4 s de la app) | nunca (50 s) | **Síntoma reproducido 3 de 3** (ver (a)). |
| 2 | La primera bajada de A después de volver la red no responde nunca | nunca (60 s) | **Síntoma reproducido 2 de 2** (ver (b)). |

**La vista del editor no se atrasa.** En todas las repeticiones, la línea del otro apareció en el DOM en la
misma muestra que en el Y.Doc en memoria, y en el Y.Doc en la misma muestra que en IndexedDB (salvo una
vez, en que IndexedDB se adelantó 1,3 s al Y.Doc). Ninguna repetición normal pasó de 13 s.

**El motor sí puede decir "All synced" sin haber bajado lo del otro, hasta el ciclo siguiente.** "All
synced" dice que no queda nada sin subir, no que se bajó todo. Qué páginas bajar se decide con el árbol
leído al principio del ciclo, antes de subir: si el otro sube después, se baja en el ciclo siguiente (10 s,
o antes con `focus`/`online`). Es lo que muestra la fila de 12 s. No llega a 40 s.

**(a) B abre la página en solo lectura.** `PageEditor` espera hasta 4 s a bajar lo que falta
(`prefetchPage`); si no llega, abre en solo lectura con el aviso "Part of this page is still downloading" y
se reabre para editar cuando llega. La prueba hace clic y escribe igual: lo escrito no entra. Con la bajada
demorada 5 s: B abrió con `contenteditable="false"`, su línea no quedó ni en el editor ni en el Y.Doc, los
dos dijeron "All synced" (a los 1,5 a 3,7 s), A nunca mostró la línea de B y el servidor nunca la tuvo.
Coincide con lo anotado en v0.015: "uno de los dos tardó más de 40 s" y "no se confirmó pérdida" (no hubo
pérdida: la línea nunca se escribió).

**(b) Una consulta que no responde traba la sincronización.** Ninguna consulta a la base tiene tope de
tiempo. Si una no responde nunca, el ciclo queda esperando para siempre, y como nunca hay dos ciclos a la
vez, los siguientes (cada 10 s, `focus`, `online`) se cuelgan del mismo. Con la bajada colgada: A siguió
diciendo "All synced" (ya había subido lo suyo) con `syncing: true` y `lastSyncAt` congelado, su `cursor`
quedó en 2 con el servidor en 3, nunca mostró la línea de B, y el servidor tenía las dos. Solo se arregla
recargando. En la prueba es poco probable, pero en una red real que se corta a mitad de una respuesta
puede pasar.

**Cuál de las dos fue en v0.015** no se puede saber: la prueba no guardaba el estado al fallar. Se
distinguen así: en (a) el dispositivo lento no tiene su propia línea y el editor no se puede editar; en
(b) tiene su línea, el servidor tiene las dos y el motor queda con `syncing: true`. El parche de la prueba
lo deja escrito si vuelve a pasar.

## Recargar sin red

La aserción de `e2e.mjs` escribe sin red, espera a que el badge diga "Offline" y recarga. La sospecha era
que leía el editor antes de que cargara lo guardado. **No es eso:** el editor se arma recién después de
cargar lo guardado, y en las 170 recargas medidas el primer cuadro del editor ya mostraba exactamente lo
que había en IndexedDB. **El texto no aparece tarde: no aparece, porque no llegó a guardarse.**

| Corridas | Qué | Recargas con lo escrito perdido |
|---|---|---|
| 25 + 25 | `main` y la rama, con una pausa de unos milisegundos antes de recargar (leer el estado) | 0 |
| 60 | `main`, recargando apenas el badge dice "Offline" (como la prueba) | **25** (7, 4, 8 y 6 de 15; CPU normal y cuatro veces más lenta) |
| 15 | La rama, igual | **9** |
| 3 + 3 | `e2e.mjs` original: `main` / la rama | 0 / **3** (falla justo en esa aserción) |
| 30 | `main` con la corrección propuesta (F2, abajo) | **1** |
| 15 | Una primera corrección descartada (F1, abajo) | 14 |

Lo perdido es siempre el final: a veces unas letras ("Escrito sin co" en vez de "Escrito sin conexión
1."), a veces la línea entera con el Enter guardado. Varias veces el badge ya decía "Offline · 1 change
saved on this device" con parte de lo escrito todavía sin guardar. Una edición tarda en quedar guardada
entre 7 y 42 ms (mediana unos 20 ms) después de la última tecla, y hasta 90 ms con la CPU cuatro veces más
lenta.

**Por qué.** `persistLocal` guarda cada tanda en una transacción que agrega el update, **lee** el estado de
la página y le suma uno a la versión. No puede confirmarse hasta tener la respuesta de la lectura, y lo que
se escribe mientras tanto espera en memoria a que termine. Si la página se va en ese rato (una recarga, un
cierre, el sistema que mata la app en el teléfono), lo que estaba en memoria se pierde y la transacción sin
confirmar también. El código ya lo admitía ("lo que puede faltar es lo de la última transacción"), pero la
ventana es más larga de lo que parece y el badge dice "saved" antes de tiempo. Dos mediciones lo confirman:
abrir una transacción por edición sin esperar a la anterior, pero todavía con la lectura (F1), empeora (14
de 15: más transacciones abiertas sin confirmar); una transacción sin lecturas que se confirma en el acto
(F2) baja las pérdidas de 14 de 30 a 1 de 30 en las mismas condiciones. La ventana no se puede cerrar del
todo desde el navegador, así que la prueba igual tiene que esperar antes de recargar.

La rama en desarrollo pierde más seguido (9 de 15, y 3 de 3 con el script original) y además, al crear una
página, a veces el editor todavía no estaba listo después del Enter del título y lo escrito terminó en el
título (4 de 25 en la prueba enfocada; en `main`, 0 de 25).

## El `TimeoutError` de `features.mjs`

Con el script original: `main` falló 1 de 3 y la rama 2 de 3, siempre en el mismo lugar: el clic en
*Script* del menú "Turn into" ("element was detached from the DOM"). La barra de formato se pasa a
BlockNote como una función escrita en línea (`formattingToolbar={() => <FormattingToolbar … />}`) y BlockNote
la usa como componente. `PageEditor` se vuelve a dibujar con cada cambio del estado de sincronización (lee
`useSyncStatus`), la función es otra y la barra se desmonta y se monta de nuevo, cerrando el menú. En la
prueba el ciclo llega 1,2 s después de la última tecla, justo cuando se abre el menú. Una prueba chica lo
mide: con el menú abierto y 1,5 s de espera, se cerró solo en 15 de 16 intentos (la única vez que siguió
abierto no hubo ningún cambio de estado; las otras, la barra se desmontó enseguida de uno); con la barra
como función estable, 0 de 10, con los mismos cambios de estado. A una persona le pasa lo mismo: un menú de
la barra abierto se cierra solo en el próximo ciclo (1,2 s después de escribir, o cada 10 s).

## Correcciones propuestas (sin aplicar)

### En las pruebas (`e2e.mjs`, `features.mjs`)

- Esperar a que el editor se pueda editar (`.bn-editor[contenteditable="true"]`) antes del Enter del
  título y antes de escribir en una página recién abierta por otro dispositivo (B1 y la fusión anterior).
- Antes de recargar sin red, dejar 500 ms para que termine de guardarse lo escrito (medido: hasta 90 ms).
- En B1 y en la fusión, comprobar que cada dispositivo tiene lo suyo **antes** de volver a la red: si B no
  pudo escribir, la prueba falla ahí con un mensaje claro y no a los 40 s.
- Si la fusión tarda, escribir el estado de cada dispositivo (editable, "still downloading", texto,
  badge, detalle del error) y lo que hay en `page_updates`.
- `features.mjs`: reintentar el menú "Turn into" si se cierra, mientras la app no lo corrija.

Con estos cambios, `e2e.mjs` y `features.mjs` pasaron 8 de 8 (dos corridas de cada uno, contra `main` y
contra la rama); los originales, en las mismas compilaciones, fallaron 6 de 12.

### En la app

1. **Guardado local sin lecturas (F2), en `src/sync/docs.ts` y `localDb.ts`.** Cada tanda de ediciones
   (las de una misma tarea del navegador) sale en una transacción que agrega el update y pone en `meta` una
   marca nueva de "sin subir" (`docDirty:<página>` con un id al azar), sin leer nada, y se confirma en el
   acto (`commit()`). La versión deja de sumarse en cada edición: lo que falta subir se reconoce por la
   marca (o por `version > ackedVersion`, lo de antes, así un dispositivo que actualiza con cambios
   pendientes los sigue subiendo). Al confirmar una subida, la marca se borra en la misma transacción que
   el estado, solo si sigue siendo la que se leyó al armarla; si hubo ediciones después, queda.
   `unsyncedPages` lee el estado y las marcas juntos; el motor cuenta las páginas rechazadas con esa lista.
   La prueba de auditoría que simula un error de escritura cambia el nombre de los almacenes que
   intercepta. Las 82 pruebas de `main` pasan.
2. **Tope de 30 s para cada consulta a la base, en `src/sync/remote.ts`** (`abortSignal`). Una consulta
   vencida cuenta como error de red y el ciclo siguiente la reintenta; las subidas ya eran idempotentes.
   Storage no lo usa (una foto grande puede tardar más).
3. **Barra de formato estable, en `src/ui/PageEditor.tsx`:** `formattingToolbar` pasa a ser una función
   memorizada (`useCallback`), así la barra no se vuelve a montar con cada cambio de estado.
4. **Solo lectura más corta, en `src/ui/PageEditor.tsx`:** mientras la página está "still downloading",
   se revisa cada segundo si ya llegó lo que faltaba (la bajada que empezó al abrir sigue después de los
   4 s), en vez de esperar al ciclo siguiente.

### Riesgos

- F2 cambia cómo se sabe qué falta subir, que es la regla de no perder datos. Hay que auditarlo como
  cualquier cambio de sincronización, sumar pruebas propias (marca que queda si hubo ediciones durante una
  subida, dispositivo que actualiza con `version > ackedVersion`, restaurar una copia) y actualizar
  `Doc_Sincronizacion.md`. Guarda un update por tarea del navegador (al escribir, uno por tecla, como ya
  pasaba en la práctica); se siguen compactando al abrir la página.
- F2 está hecho sobre `main`. La rama en desarrollo cambió `docs.ts` (la semilla solo en memoria, que se
  guarda en el mismo lote que la primera edición, y `syncedSV` que avanza al bajar): hay que pasarlo a mano.
  La semilla y la primera edición ya van en la misma tanda, así que siguen yendo en la misma transacción.
- El tope de 30 s no cubre una espera dentro del cliente de sesión de Supabase (la renovación del token);
  si se viera, haría falta un vigilante del ciclo en `engine.ts`.
- Aun con F2 queda una ventana de milisegundos: una recarga o un cierre justo después de escribir todavía
  puede perder la última tecla.
- El atraso de hasta 10 s del ciclo (la fila de 12 s) es el diseño actual. Bajarlo necesita avisos del
  servidor o un ciclo más frecuente.

## Qué queda

- Decidir y aplicar las correcciones (pruebas primero: son independientes de la app).
- Si se aplica F2, pasarlo a la rama y actualizar "Contenido de las páginas" en `Doc_Sincronizacion.md`.
- El punto 5 del roadmap puede cerrarse con la corrección de la prueba y pasar lo de la app a sus propios
  puntos.
