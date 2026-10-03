# Sincronización offline

Cómo funciona hoy la regla de no perder nunca información. El código está en `src/sync/` y las pruebas
(`npm test`) en `src/sync/sync.test.ts`, `audit.test.ts` (los casos de la auditoría de la fase 1),
`editor.test.ts` (con el editor real, en jsdom), `docs.test.ts` (qué falta subir después de bajar y la
semilla solo en memoria), `uploadDeletes.test.ts` y `uploadDeletesVersions.test.ts` (subir solo los borrados nuevos, B.15), `projects.test.ts` (proyectos en la cola, también sin
red y rechazados), `restore.test.ts` (la generación al restaurar una copia y la versión mínima del
workspace, y el aviso de base vieja), `src/workspace.test.ts` (los nombres de lo guardado en el
dispositivo), `src/workspaces.test.ts` (la lista de workspaces del dispositivo, los nombres de Wanka, los
links de invitación, cambiar y quitar) con sus pantallas montadas en `src/ui/workspaces.test.tsx`,
`src/ui/unknownContent.test.ts` (la guarda del editor contra lo desconocido), `offlineLargo.test.ts` (semanas
sin red con la v0.090 y la versión mínima, ver "Volver después de mucho tiempo sin red") con
`src/ui/appUpdate.test.ts`,
`src/media/queue.test.ts` (la cola de fotos y videos), `src/ui/media.test.ts` (`sdmedia://` con el
editor de la versión publicada) y `team.test.ts` (permisos en el dispositivo, solo lectura, rechazos,
invitaciones, la señal de que sacaron a alguien y el archivo con lo que no se subió), con las pantallas
de miembros, compartir y "sacado" montadas en `src/ui/team.test.tsx`, y `comments.test.ts` (la cola de
comentarios sin red, reintentos, orden, rechazos y niveles), con `src/ui/question.test.ts` (preguntas con
el editor de la versión publicada) y `src/ui/comments.test.tsx` (el editor y el panel montados).

## Piezas

| Pieza | Archivo | Qué hace |
|---|---|---|
| Base local | `localDb.ts` | Una base IndexedDB por workspace y usuario (`shotdocs:<clave local>:<userId>`, ver abajo), compartida por todos los proyectos de la app: copia del árbol, cola de salida, updates de contenido, estado de cada página e imágenes. |
| Contenido | `docs.ts` | Un documento Yjs por página. Guarda cada edición en el dispositivo y sube o baja lo que falte. |
| Estructura | `structure.ts` | La raíz inicial de cada página (la "semilla", con su texto vacío desde v0.052) y la reparación de estructura: documentos viejos con dos raíces y bloques que el editor borraría (ver "Fusión" y `Doc_Colaboracion.md`). |
| Árbol | `tree.ts` | La copia del árbol que mandó el servidor más la cola de cambios locales encima. |
| Imágenes | `files.ts` | Guarda la imagen pegada en el dispositivo y la sube cuando hay red (sin portero). |
| Fotos y videos | `../media/queue.ts` | Los guarda en el dispositivo (base aparte) y los sube al Drive del dueño por el portero. Ver "Archivos grandes". |
| Servidor | `remote.ts` | Las llamadas a Supabase. Las pruebas usan un servidor en memoria con las mismas reglas (`testing.ts`). |
| Motor | `engine.ts` | El ciclo de sincronización y el estado que muestra la app. |
| Permisos | `access.ts` | Los permisos propios guardados en el dispositivo y la misma cuenta de niveles que la base. Ver "Permisos en el dispositivo". |
| Comentarios | `comments.ts` | Comentarios y respuestas de las preguntas: una cola en el dispositivo (base aparte) y lo bajado de cada página. Ver "Comentarios y preguntas". |
| Lo sin subir | `unsynced.ts` | Cuenta lo pendiente y lo arma como archivo JSON (ver "Si sacan a alguien del workspace"). |

El nombre de la base local no se cambia nunca: renombrarla con cambios sin subir es perderlos. Sale de la
**clave local** del workspace (`src/workspace.ts`), que también nombra la sesión y lo que la app recuerda
en el dispositivo (proyecto elegido, última página de cada proyecto). La de Wanka está fija como texto
(`znlvpuddswymxpffgvbz`, el ref de su proyecto de Supabase, ya no sacado de la dirección) y sus nombres
son los de siempre: `shotdocs-auth`, `shotdocs-last-user`, `shotdocs-project`, `shotdocs-last-pages` y
la base `shotdocs:znlvpuddswymxpffgvbz:<usuario>`; una prueba (`src/workspace.test.ts`) los protege. Un
workspace nuevo (paso 12 del plan) usa nombres que llevan su clave local. La base guarda la de cada
workspace en `workspace_settings.local_key`, para los links de invitación y para que una copia restaurada
en otro proyecto de Supabase la conserve.

El cliente de Supabase sale del workspace abierto (`WorkspaceContext` y `Services.client`); no hay un
cliente global. Qué workspace se abre lo dice la lista del dispositivo (ver "Varios workspaces").

**Sin proyectos.** El servidor ya no crea "My project" para una cuenta nueva: `ensure_workspace()` devuelve
el primer proyecto propio de la persona, o nada (lo compartido se suma en el paso 9, cuando las políticas
dejen verlo). Sin ninguno, la app muestra *No projects yet* y vuelve
a preguntar sola cada minuto, al volver a la ventana y al volver la red; el dueño y los admins ven además
el botón para crear el primero.

**Versión de la base.** La app sabe qué versión de la base necesita (`DB_SCHEMA_VERSION`) y la compara con
`workspace_settings.schema_version` en cada sincronización. Si la del workspace es menor, el estado dice
el ícono de advertencia y el detalle explica que el dueño tiene que aplicar las migraciones; nada se
pierde mientras tanto. Lo que una migración agrega de forma opcional (la papelera de archivos, los comentarios, el peso de los
proyectos) tiene su propia constante (`TRASH_SCHEMA_VERSION`, `COMMENTS_SCHEMA_VERSION`, `SIZES_SCHEMA_VERSION`)
y no sube `DB_SCHEMA_VERSION`: con la base sin migrar, eso no se muestra y no hay aviso.

## Contenido de las páginas

1. **Primero el dispositivo.** Cada edición se guarda en IndexedDB en cuanto ocurre. Las de un mismo
   momento (la misma tarea del navegador, por ejemplo una tecla) salen juntas en una transacción que **no
   lee nada**: agrega el update y pone en `meta` una marca nueva de "sin subir" (`docDirty:<página>`, con
   un id al azar), y se confirma en el acto (`commit()`), sin esperar a la anterior. Antes (hasta la
   investigación de `Doc_Investigacion_Intermitente.md`, roadmap B.5) la transacción leía el estado de la
   página para sumarle uno a la versión, así que no podía confirmarse hasta tener la respuesta, y lo que se
   escribía mientras tanto esperaba en memoria: una recarga o un cierre a pocos milisegundos de la última
   tecla perdía el final de lo escrito (25 de 60 recargas rápidas en la versión publicada), a veces con el
   estado diciendo ya "1 change saved on this device". Queda una ventana de milisegundos: una tecla escrita
   en la misma tarea en que la página se va todavía se puede perder, y el navegador pide confirmación antes
   de cerrar si hay algo sin guardar.
   Si guardar falla (por ejemplo, disco lleno), la edición queda en memoria, se reintenta cada 3 segundos,
   cuenta como pendiente y la app lo avisa en rojo hasta que se pueda guardar. Cada transacción lleva
   también las tandas de las anteriores que todavía no terminaron (Yjs no duplica): si una falla después de
   que la siguiente se confirmó, lo guardado nunca queda colgando de algo que no está. Lo que ya estaba
   programado para guardarse cuando se cierra la sesión (`dispose`) se guarda igual; solo se cortan los
   reintentos.
   **La versión** (`DocState.version`) se sigue sumando, pero aparte y después, en otra transacción (si la
   app se cierra antes, se suma la próxima vez que se cuenta lo pendiente). Ya no hace falta para no perder
   nada; es para una versión anterior de la app que abra esta misma base (ver "La misma base con una
   versión anterior", abajo) y para la papelera de archivos, que la usa para saber si el documento cambió.
   La suma lee la marca: si la edición ya entró en una subida (la marca es la del envío en vuelo, o ya no
   hay marca porque se confirmó), suma también la versión del envío o la confirmada, así no sale una
   subida vacía de más.
   Una edición sobre un documento reparado solo en memoria (quien no podía escribir y recibe "Edit" con la
   página abierta, ver "Permisos en el dispositivo") guarda el documento entero: la reparación queda
   guardada junto con lo que depende de ella.
2. **Qué falta subir.** Cada página guarda `syncedSV`, el vector de estado de Yjs de lo que el servidor ya
   tiene. Lo pendiente es siempre la diferencia entre el documento local y ese vector, así que no
   importa si la app se cerró a mitad de camino: al volver se recalcula entera. La única regla es que
   `syncedSV` nunca diga que el servidor tiene algo que no tiene: avanza solo con lo que el servidor
   confirma al subir (punto 3) o manda al bajar (punto 4). Los borrados no dependen del vector (un borrado
   no avanza ningún reloj de Yjs): tienen su propia cuenta, `syncedDS`, con la misma regla (ver "Subir solo
   los borrados nuevos", abajo; hasta B.15 viajaban todos en cada subida).
3. **Envío con confirmación.** Lo que se sube se calcula desde lo guardado en IndexedDB, leído en la misma
   transacción que la marca de "sin subir" y la versión: la confirmación nunca cubre algo que no viajó.
   **Una página tiene algo sin subir** si tiene marca, si su versión es mayor que la confirmada
   (`ackedVersion`, lo de siempre) o si tiene un envío sin confirmar. Al confirmarse el envío, en la misma
   transacción que el estado, la marca se borra **solo si sigue siendo la que se leyó** al armarlo: cada
   edición guardada pone una marca nueva, así que si hubo ediciones después, la marca es otra y queda (van
   en la vuelta siguiente). La versión confirmada pasa a ser la que se leyó junto con lo subido. Antes de
   enviar, el update se guarda con un id propio. Si la respuesta no llega, se reenvía el mismo update con
   el mismo id y el servidor devuelve el mismo `seq` sin duplicar nada. Recién con la confirmación avanza
   `syncedSV` (se suma, autor por autor, a lo que ya decía: lo bajado mientras la subida estaba en vuelo
   también cuenta). Si el servidor lo rechaza para siempre (por ejemplo, por tamaño), la página queda marcada
   como rechazada, la app lo avisa y se reintenta al abrirla de nuevo o con "Retry".
4. **Bajar lo nuevo.** El árbol trae el último `seq` de cada página. Si es mayor que el que tiene el
   dispositivo, se bajan los updates posteriores y se guardan en la misma transacción que el nuevo cursor.
   Así se bajan también las páginas que nunca se abrieron en ese dispositivo, y quedan disponibles offline.
   En esa misma transacción avanza `syncedSV` con lo bajado, así la próxima subida lleva solo lo propio y
   no reenvía lo que el servidor mandó (antes lo reenviaba una vez, sin perder nada). Avanza
   con dos límites (`serverReach` y `advanceSynced` en `docs.ts`):
   - **Solo lo que vino del servidor, sin huecos.** `syncedSV` dice que el servidor tiene los relojes
     `[0, n)` de cada autor de Yjs; un update bajado con los relojes `[a, b)` de ese autor, con `a <= n`, lo
     lleva hasta `b`. Un hueco corta. Lo propio sin confirmar nunca vino del servidor, así que sigue afuera
     del vector, o sea, adentro de lo que falta subir; lo propio que vuelve del servidor (una subida cuya
     respuesta se perdió) sí cuenta, porque el servidor lo tiene.
   - **Nunca más de lo que el documento del dispositivo integró.** Si lo bajado depende de algo que
     todavía no llegó, Yjs lo deja pendiente y el vector no avanza por eso (en la próxima subida viaja de
     más, sin daño). Para saberlo hay que armar el documento de la página: se hace antes y fuera de la
     transacción que escribe (una lectura aparte), para no frenar el guardado de ninguna página. Adentro
     se comprueba que la cantidad de filas guardadas de la página no cambió; si cambió (una edición local,
     una compactación), el vector no avanza en esa vuelta: se sube de más, nunca de menos.
   Si la app se cierra antes de terminar la transacción, no cambia nada (ni lo guardado, ni el cursor, ni
   el vector). **Un caso que no se cubre:** los autores de Yjs son números al azar de 32 bits, uno por cada
   vez que se abre una página. Si dos sesiones que editan la misma página sacaran el mismo número (una
   probabilidad de 2⁻³² por par de sesiones), Yjs no podría distinguir lo de una y lo de otra y la fusión ya
   fallaría antes de este cambio (no es una regresión de la fusión); además, desde este cambio, lo que el
   dispositivo tenía sin subir de esa sesión repetida y se superpone con lo bajado de la otra queda tapado
   por el vector y no sale del dispositivo (sigue guardado ahí). Restaurar una copia borra el vector y el cursor (ver "Restaurar una copia de seguridad"), y
   lo que se baja después cuenta solo lo que tiene el servidor restaurado. Las pruebas están en
   `src/sync/docs.test.ts`: en cada paso revisan contra el servidor que el vector no diga de más, con
   ediciones sin subir mezcladas con lo bajado, updates que dependen de algo que falta, lo propio que
   vuelve, una subida en vuelo (con la respuesta perdida o sin llegar), cerrar la app a la mitad,
   restaurar y corridas al azar con tres dispositivos.
5. **Fusión.** Dos dispositivos que editan la misma página sin red se fusionan con Yjs al volver. El editor
   guarda cada página bajo una única raíz; si cada dispositivo creara la suya, al fusionarse quedarían dos
   y el editor borraría la que no puede mostrar. Para que eso no pase, al abrir una página vacía para
   editar se le pone una **semilla**: la raíz inicial, escrita con un autor de Yjs y un contenido que salen
   del id de la página. Todos los dispositivos escriben exactamente la misma semilla, así que Yjs la toma
   como un solo cambio y hay una sola raíz. Lo que dos personas escriben a la vez en el mismo renglón se
   fusiona letra por letra, como en cualquier editor colaborativo.
   La semilla **queda solo en memoria** hasta la primera edición local (origen `ORIGIN_SEED`): abrir una
   página vacía sin escribir no guarda nada, no cuenta como pendiente y no sube nada. Con la primera
   edición, la semilla y la edición se guardan juntas, en la misma transacción (lo que se escribe cuelga
   de la raíz de la semilla: guardar una sin la otra dejaría la edición sin poder mostrarse), y suben
   juntas. Si guardar falla, se reintentan juntas. Si antes de escribir llega lo de otro dispositivo, se
   aplica encima como siempre (trae la misma semilla, o se repara). El contenido de la semilla no cambió
   (`structure.ts`: nunca se cambia).
   Las páginas creadas antes de la semilla (v0.008) pueden tener igual dos raíces; para ellas queda la
   reparación: al abrir y al recibir cambios, las raíces sobrantes se juntan en la primera en la misma
   transacción que aplica lo recibido. La reparación copia los bloques y borra la raíz sobrante, así que lo
   que otro dispositivo escriba en esa raíz después de la copia se pierde: por eso es solo el último
   recurso. `src/sync/editor.test.ts` prueba los dos casos con el editor real.
   Desde v0.052 la semilla lleva además, con otro autor fijo que también sale del id de la página, un texto
   vacío adentro del párrafo (la raíz sigue igual, byte por byte): dos dispositivos que escriben a la vez en la
   primera línea de una página nueva escriben en el mismo texto. Y la reparación, además de juntar raíces,
   arregla los bloques que dos cambios de estructura a la vez dejan de una forma que el editor no acepta (dos
   contenidos, dos grupos de hijos), que el editor si no borraría enteros. Qué puede pasar todavía cuando dos
   personas cambian el mismo bloque, los parches de y-prosemirror y sus pruebas: `Doc_Colaboracion.md`.
6. **Páginas a medio bajar.** Si el servidor tiene contenido de una página que el dispositivo no, se baja
   antes de mostrar el editor. Si no llega (sin red o muy lento), se muestra lo que hay en el dispositivo
   en **solo lectura**, con un aviso, y la página pasa a editable sola cuando llega lo que falta (se
   revisa con cada sincronización y cada segundo: la bajada que empezó al abrir sigue después de la
   espera y puede terminar entre dos ciclos). Lo que
   sube el propio dispositivo cuenta como bajado (si nadie subió nada en el medio), así que una página
   que solo se editó acá siempre se abre para editar, con red o sin ella.
7. **La misma base con una versión anterior de la app.** La base local no cambió de versión ni de nombre:
   la marca vive en `meta`, que ya existía y que las versiones anteriores solo leen por clave (nunca ven
   ni tocan las `docDirty:`). En los dos sentidos:
   - **Una versión anterior con cambios pendientes que se actualiza:** lo suyo tiene `version >
     ackedVersion` y sin marca, y esta versión lo cuenta y lo sube igual. Un envío sin confirmar armado por
     la anterior (sin marca guardada) se reenvía y, al confirmarse, no borra ninguna marca.
   - **Una versión anterior que abre la base después** (una pestaña que no se recargó, cuando la nueva la
     suelta): solo mira `version > ackedVersion`. Como la versión se suma aparte, la app se podría cerrar
     entre guardar una edición y sumarla. Para eso está **la versión guardia** (`DocState.guardVersion`):
     al abrir una página que se puede editar, antes de que se pueda escribir nada, si la versión no está
     por encima de la confirmada (ni de la de un envío en vuelo) se le suma uno y se anota ese valor como
     guardia; lo mismo al armar un envío y al confirmarlo, en la misma transacción, mientras la página
     siga abierta. Así, cualquier página que esta versión tuvo abierta queda pendiente para una versión
     anterior, también si esa confirma un envío de esta que no llevaba la última edición. Esta versión no
     cuenta como pendiente una página cuya versión es solo la guardia (sin marca ni envío sin confirmar), así
     que la guardia no la hace subir nada; una versión anterior, en cambio, sube una vez un update casi
     vacío (se prefiere subir de más). Restaurar una copia borra la guardia. Lo que la anterior sube y
     confirma no borra la marca: esta versión, al volver, sube lo que falte (casi nada) y la borra. Si la
     anterior escribe mientras un envío de esta está sin confirmar, su versión queda por encima de la
     confirmada y esas ediciones van en la vuelta siguiente. La suma de versión de cada edición sigue:
     cubre también la papelera de archivos, y si la app se cerró antes de sumarla, se suma apenas esta
     versión vuelve a contar lo pendiente. Queda una sola ventana: recibir "Edit" con la página abierta y
     cerrar la app enseguida de la primera edición, antes de armar la guardia (que ahí se arma aparte).
     Otra pestaña con la misma base, que la app no permite (una sola pestaña, Web Locks), tampoco se
     cubre.
   Las pruebas están en `src/sync/localSave.test.ts` (la pérdida al irse la página en medio de la
   transacción, que falla con la versión anterior del guardado, "Escrito sin co" en vez de "Escrito sin
   conexión 1.", y pasa con esta; la marca que queda si hubo ediciones durante una subida; un dispositivo
   que actualiza con cambios pendientes; restaurar una copia; cerrar la app en cada punto; las carreras de
   la suma de versión, las tandas que fallan, `dispose` y la edición sobre una reparación en memoria),
   `publishedCompat.test.ts` (con una copia de la versión publicada, `fixtures/publishedDocs.ts`: cerrar
   justo después de escribir, un envío en vuelo con una edición que no entra, la publicada que escribe
   con un envío pendiente, y que la guardia no suba nada de más) y `localSaveRandom.test.ts` (corridas al
   azar con cierres de golpe en cualquier microtarea, subidas en vuelo, compactación, restauraciones y la
   versión publicada sobre la misma base; `LOCAL_SAVE_SEEDS` y `LOCAL_SAVE_STEPS` para correr más).
8. **Compactación local.** Con más de 64 updates guardados, al abrir la página se fusionan en uno solo, en la
   misma transacción. En el servidor no se compacta todavía.

## Subir solo los borrados nuevos (B.15)

**Qué pasaba.** Un update de Yjs son dos partes seguidas: los elementos (structs) y el *delete set*, la lista
de tramos borrados `[reloj, reloj + largo)` de cada autor. `Y.encodeStateAsUpdate(doc, syncedSV)` corta los
elementos con el vector, pero escribe siempre **todos** los borrados del documento (un borrado no avanza
ningún reloj, así que el vector no los puede describir). Cada subida repetía la historia entera de borrados de
la página. Dos medidas, de dos guiones distintos (por eso los números no coinciden):

- **La simulación del diseño de compactar** (roadmap B.9; ediciones sueltas de un texto en bloques, una subida
  por pausa): con 2000 subidas, 2,4 MB en `page_updates` contra 92 KB sin los borrados repetidos. Los borrados
  repetidos eran el 96 % del peso.
- **Las pruebas de esta tanda** (`src/sync/uploadDeletes.test.ts`, por `PageDocs` y el servidor de prueba, con
  más borrados por subida): con 200 ediciones, las últimas 20 subidas pesaban 929 B de promedio y el total 112 KB;
  con el guion de sesiones de 60 subidas y 2000 subidas, 4,2 MB.

**Cómo es ahora** (`src/sync/deleteSets.ts` y `pushPage` en `docs.ts`):

- **`DocState.syncedDS`**: los borrados que el servidor ya tiene, guardados como un update de Yjs sin elementos
  (cualquier Yjs lo lee con `Y.decodeUpdate`). Es el equivalente de `syncedSV` para los borrados.
- **Qué se sube**: los elementos de siempre (después de `syncedSV`) y solo los borrados del documento que no
  están en `syncedDS`. Se arma cortando el update entero: el delete set que escribió Yjs se vuelve a escribir
  igual desde lo leído (mismo orden, byte a byte) y tiene que ser el final exacto del update; se reemplaza por
  el de los que faltan. Antes de usarlo se comprueba leyéndolo: los mismos elementos que el update entero, y
  sus borrados más `syncedDS` cubren todos los del documento. **Si algo no cierra, se sube el update entero,
  con todos los borrados, como antes.** Sin `syncedDS` (o sin que valga, ver abajo), también.
- **La regla, la misma que la del vector: `syncedDS` nunca dice que el servidor tiene un borrado que no
  tiene.** Crece solo con dos cosas, cada una en la misma transacción que lo demás:
  1. Al **confirmarse un envío**, con los borrados que viajaron en él (`pending.ds`; un envío armado por una
     versión anterior no lo trae y se leen del update, que lleva todos los de su documento). Va junto con
     `syncedSV`, `ackedVersion` y el envío que se borra.
  2. Al **bajar**, con los borrados de lo que mandó el servidor, en la transacción que guarda lo bajado y
     avanza el cursor. Acá no hace falta el tope de lo integrado que tiene el vector: un borrado de más en la
     cuenta (de algo que el documento todavía no tiene) no cambia qué hay que subir. La cuenta se prepara
     **antes y fuera** de esa transacción (como el tope del vector, `integratedCap`), con los borrados de lo
     bajado ya juntado (`mergeUpdates` une los de todas las filas); adentro solo se guarda, si `syncedDS` y la
     generación siguen siendo los que se leyeron (si no, se vuelve a hacer adentro). Así el guardado local de
     ninguna página espera a la cuenta: las filas de las versiones anteriores traen el delete set entero cada
     una, y unirlas fila por fila adentro trababa ese guardado. Bajar 1500 filas viejas de una página: unos
     140 ms, contra unos 130 ms de main (sumándolas fila por fila adentro eran unos 220 ms).
  Nunca crece con lo local. Como el servidor no borra nunca una fila de `page_updates` (y compactar tampoco
  pierde borrados: en su diseño, roadmap B.9, el snapshot es `Y.mergeUpdates` sin recolectar), lo que tenía lo sigue
  teniendo, salvo al restaurar una copia.
- **Por qué no se puede dejar de subir un borrado propio:** el envío lleva los borrados del documento menos
  `syncedDS`; el servidor ya tenía `syncedDS`; con el envío confirmado tiene todos los del documento. Un
  borrado que no se sube "vuelve" en los demás dispositivos (es perder la edición del usuario), así que toda
  duda se resuelve subiendo de más.

**Cada caso:**

- **Reintentos.** El envío se guarda con su id, sus bytes y sus borrados (`pending.ds`) antes de mandarlo; si la
  respuesta se pierde, se reenvía igual y el servidor devuelve el mismo `seq`. Sumar a `syncedDS` es una unión:
  confirmar dos veces da lo mismo.
- **Cerrar la app a la mitad.** `syncedDS` cambia solo en la transacción de la confirmación o de la bajada; si la
  app se cierra antes, no cambió y el envío sigue guardado (se reenvía).
- **Restaurar una copia.** `resetForRestore` borra `syncedDS` junto con `syncedSV`: todo vuelve a subir entero.
- **Una versión anterior de la app sobre la misma base** (una pestaña vieja, `localSave` y `publishedCompat`):
  no conoce `syncedDS`. Sube siempre todos los borrados (de más, nunca de menos) y al confirmar no lo toca (la
  cuenta queda de menos: la próxima subida de esta repite esos borrados una vez). Lo delicado es que **restaura
  a su manera**: borra `syncedSV`, `ackedVersion` y el envío, pero deja `syncedDS`, y guarda la generación nueva
  (esta versión ya no restaura). Por eso `syncedDS` lleva la generación del workspace con que se anotó
  (`syncedDSGeneration`, comparada con la de `meta`, que sin guardar vale 1 como en el motor): con otra
  generación no cuenta y se suben todos. La prueba lo muestra: sin la generación, la versión anterior que
  restaura y se cierra antes de subir deja un borrado sin subir, y vuelve en otro dispositivo.
  - Un envío de una versión anterior confirmado por esta: sus borrados (todos los de su documento) se leen del
    update. Un envío de esta (solo lo nuevo) confirmado por la anterior: el servidor tiene el resto desde antes.
- **Lo que ya está en el servidor.** Las filas viejas, con los borrados repetidos, quedan como están: quien baja
  todas las filas arma lo mismo (los borrados se suman). Una fila con solo los borrados nuevos es un update de
  Yjs común: las versiones anteriores la leen igual. No cambia la base ni hace falta una migración, ni subir
  `min_app_version`.
- **Dos pestañas** (la app no lo deja, Web Locks): `syncedDS` solo crece con cosas ciertas, en transacciones de
  lectura y escritura, y el envío se arma con el `syncedDS` leído en la misma transacción que lo guardado. Hay
  una prueba con dos instancias sobre la misma base.
- **Lo que Yjs deja pendiente** (elementos que dependen de algo que falta, o borrados de algo que todavía no
  llegó): `encodeStateAsUpdate` los suma con `mergeUpdates`; el corte se comprueba igual y, si no cierra, va
  entero.
- **"Download my unsynced changes"** (`unsynced.ts`) sigue llevando todos los borrados, a propósito: ese
  archivo tiene que servir solo, sin saber qué tiene el servidor.
- **Peso en el dispositivo:** `syncedDS` pesa lo que antes viajaba en cada subida (de bytes a pocos KB en una
  página muy editada), una vez por página. **Tiempo:** armar una subida con 2000 tramos borrados conocidos tarda
  unos 9 ms, y con 20 000 de un solo autor (un caso extremo) unos 36 ms; la resta de tramos es lineal.
- **Lo mismo que el vector no cubre:** dos sesiones con el mismo autor de Yjs al azar (2⁻³², punto 4).

**Pruebas:**

- **`src/sync/uploadDeletes.test.ts`:**
  - el delete set escrito igual que Yjs, byte a byte;
  - restar, sumar y contener, contra conjuntos de relojes;
  - lo armado más lo del servidor es todo el documento (200 casos al azar, también con cosas pendientes de Yjs);
  - el tamaño tras 200 ediciones (fallaba antes): las últimas 20 subidas, de 929 B a 53 B; el total, de 112 KB a
    9,2 KB;
  - el mismo guion con la versión publicada y con esta (sesiones de 60 subidas, borrados en casi todas): con 300
    subidas, 105 KB contra 12,8 KB; con 2000, 4,2 MB contra 86 KB, y las últimas subidas de 4285 B a 44 B
    (`DELETES_MEASURE_EDITS` para otra cantidad);
  - los borrados de otro no se vuelven a subir, y restaurar una copia;
  - con cada versión anterior (la publicada hoy, `fixtures/mainDocs.ts`, y la v0.029): la que restaura y se
    cierra antes de subir, y los envíos cruzados;
  - dos instancias sobre la misma base;
  - corridas al azar con tres dispositivos que escriben y borran (también lo de otros), pierden respuestas, se
    quedan sin red, se cierran de golpe con una subida en vuelo, vuelven con una versión anterior (que a veces
    restaura y se cierra), con el servidor que se restaura (`DELETES_SEEDS` y `DELETES_STEPS` para más; pasaron
    150 semillas de 80 pasos).
- **`src/sync/uploadDeletesVersions.test.ts`** (con la versión publicada hoy como versión anterior, y a veces la
  v0.029):
  - corridas al azar con tres bases y dos páginas, y a veces dos instancias vivas sobre la misma base (la
    publicada y esta, o dos de esta); borrados chicos, de media página y de todo el texto; cierres de golpe de toda
    la base con el ciclo en vuelo; y una versión anterior que restaura y se cierra antes o después de guardar la
    generación (`DELETES_VERSIONS_SEEDS` y `DELETES_VERSIONS_STEPS`; en la suite, 20 semillas de 70 pasos; pasaron
    200 de 90);
  - una subida con la generación vieja contra un servidor ya restaurado;
  - la publicada que restaura en otra pestaña mientras esta tiene un envío armado;
  - 400 `buildUpload` con cosas pendientes de Yjs de tres autores;
  - el tiempo de bajar una página grande escrita con la publicada (`DELETES_PERF=1`, fuera de la suite).
- **En todas:** en cada paso `syncedDS` no dice de más; después de cada subida confirmada, el servidor tiene todos
  los borrados del dispositivo; al final, todos iguales y al servidor no le falta nada.
- **Mutantes a mano** (para ver que las pruebas los detectan):
  - ignorar la generación: falla la prueba de la versión anterior que restaura, y semillas al azar de los dos
    archivos;
  - sumar al bajar también los borrados locales: fallan semillas al azar y varias pruebas;
  - dejar afuera un tramo: fallan 6 pruebas. Con la comprobación interna de `buildUpload` puesta, ese error se
    ataja solo y sube todo.

## La subida sin GC (B.16)

**Qué pasaba.** Lo que alguien escribe adentro de un bloque que otro borra al mismo tiempo podía no llegar nunca al
servidor. La subida se armaba en un `Y.Doc` con GC (*garbage collection*: Yjs cambia el contenido de lo borrado por
un hueco que solo dice cuánto medía). Si el dispositivo bajaba el borrado del otro **antes** de subir lo suyo, su
texto ya estaba borrado en ese documento (cuelga de un bloque borrado) y viajaba como hueco. En el documento final
ese texto iba a quedar borrado igual, pero se perdía para siempre: no quedaba en ninguna fila de `page_updates`
(ni en el historial de versiones, en preparación), solo en el IndexedDB de quien lo escribió. Pasaba con lo
escrito entre la subida y la bajada de un mismo ciclo (el ciclo sube y después baja), y con todo lo de una página si
su subida vencía o la app estaba por debajo de la versión mínima. Lo encontró la auditoría del diseño del historial;
`src/sync/uploadNoGc.test.ts` lo reproduce (la fila de A llegaba sin el texto).

**Cómo es ahora** (`readSaved` en `docs.ts` y `src/sync/removedWriting.ts`):

- **La subida se arma en un documento sin GC**, descartable, con las filas guardadas aplicadas **de a una y en
  orden** en una sola transacción (`applyRowsInOrder`). Sin GC, lo borrado conserva su texto; en orden, gana la
  primera copia de cada elemento (la que se guardó al escribirlo) y nunca una posterior que lo traiga como hueco
  (`Y.mergeUpdates` puede quedarse con el hueco; lo midió el diseño del historial de versiones, en preparación). Lo demás no cambia: el documento
  abierto en el editor sigue con GC, lo guardado en IndexedDB es lo mismo (cada edición ya se guardaba con su texto)
  y la subida lleva los mismos elementos y los mismos borrados (`buildUpload` de B.15, igual).
- **Qué cambia en el servidor:** la fila de cada subida trae también el texto de lo propio que ya estaba borrado al
  armarla: lo que otro borró mientras se escribía y **lo escrito y borrado entre dos subidas** (una subida cada
  1,2 s de pausa). Lo segundo es una consecuencia, no el objetivo: el historial lo va a poder mostrar, y lo borrado
  ya viaja a quien puede ver la página (lo señaló el diseño del historial de versiones, en preparación). Ojo con eso: algo pegado y borrado en el
  mismo segundo (una contraseña, por ejemplo) ahora llega siempre al servidor; antes llegaba solo si justo había una
  subida en el medio.
- **Tope:** si la subida sin GC pasa de 6 MB (`NO_GC_MAX_BYTES`; el servidor rechaza más de 8 MB) se vuelve a armar
  con GC, como antes, y se avisa en la consola. Un rechazo dejaría toda la página sin subir. Solo puede pasar con una
  página muy editada que vuelve a subir entera (después de restaurar una copia).

**El aviso a quien escribió.** El borrado gana en todos lados (es lo de siempre en Yjs), pero quien escribió tiene
que enterarse y tener su texto a mano:

- **Cuándo.** Al bajar (`applyRemote`; `pullPage` primero espera que lo escrito quede guardado), si lo bajado trae
  borrados y la página tiene algo sin subir o se editó en esta sesión, `findRemovedWriting` arma lo guardado sin GC
  y en orden, anota **lo propio vivo**, aplica lo bajado y se queda con lo propio que quedó borrado **sin que el
  borrado lo nombre**. Quien borra un bloque nombra todo lo que tenía adentro (Yjs anota cada elemento); lo que no
  nombra es lo que no había visto. Así el aviso sale solo cuando se escribía y se borraba a la vez, nunca cuando el
  otro borró algo que tenía a la vista.
- **Letra por letra.** Yjs junta en un solo elemento lo que un autor escribe seguido: si A escribe «abcde», sube, B lo
  ve, A sigue con «fghij» sin subir y B borra el bloque, el elemento es «abcdefghij» pero el borrado de B nombra solo
  «abcde». Cada elemento se recorta por relojes (lo vivo propio menos lo nombrado) y el aviso dice «fghij».
- **Lo propio:** solo lo de los autores de Yjs (`clientID`) que escribieron en la página **desde este dispositivo**,
  anotados en `meta` (`ownClient:<página>:<autor>`) en la misma transacción que su primera edición guardada, sin
  leer nada antes. Así vale después de cerrar la app, de restaurar una copia o con `syncedSV` atrasado. Si no se sabe
  que algo es propio, no se avisa. Lo escrito con una versión anterior (que no anota) no avisa. **"Propio" es lo que
  escribió el autor de Yjs del dispositivo, no lo que tecleó la persona** (D23): el editor reescribe con el número
  del dispositivo lo que mueve o convierte (subir, sangrar o cambiar el tipo de un bloque) y la reparación copia, así
  que el aviso puede traer texto que tecleó otro y este dispositivo movió. No se pierde nada: quien lo tecleó no
  recibe aviso (su texto lo borró el movimiento, con nombre), y que lo reciba quien lo movió es la única forma de
  recuperarlo. Por eso el aviso dice *what you wrote or moved*. Lo que nunca pasó por este dispositivo no se avisa.
- **Un documento abierto puede tener varios autores** (v0.101). Yjs le cambia el número a un documento cuando una
  transacción que aplica algo bajado también escribe con el número del documento: es la reparación de estructura que va
  en la misma transacción que lo que llega (`applyToLive`). `applyUpdate` marca esa transacción como remota y Yjs, al
  ver su propio número en una transacción remota, cree que otro lo usa y elige uno nuevo (avisa en la consola
  *Changed the client-id…*). Lo que escribió la reparación es del número de antes, pero el `update` sale cuando ya
  tiene el nuevo, y solo se anotaba ese: si era lo primero que el documento guardaba, lo que copió la reparación (por
  ejemplo el texto propio, sin subir, que pasa a un bloque nuevo cuando dos cambian el tipo del mismo párrafo) no era
  "propio" y, si otro lo borraba sin verlo, desaparecía sin aviso (el texto igual llegaba al servidor). Ahora se anotan
  todos los números que tuvo el documento desde que se abrió (el del principio de cada transacción y el del final).
  La prueba al azar, que solo conocía el número con que se abrió cada documento, tomaba como ajeno el aviso de lo que
  el mismo dispositivo escribió después del cambio (semillas 2 y 88 con 120 pasos): el aviso era correcto.
- **Dónde se guarda:** en `meta`, clave `removedWriting:<pageId>` (el texto, un renglón por bloque en el orden de la
  página, las fotos y los archivos por su nombre entre corchetes, la hora y los tramos de relojes; hasta 20 por
  página), **en la misma transacción que lo bajado**. Las versiones anteriores leen `meta` solo por clave: no les
  cambia nada.
- **Qué ve:** en la página, un aviso amarillo (*Someone deleted a part of this page while you were writing or moving
  text in it…*) con **Show what you wrote or moved**, **Copy** (si el navegador no deja copiar, el texto queda a la vista) y **Dismiss**,
  que borra del dispositivo los avisos que se mostraron (uno que llegó mientras tanto queda; el texto sigue en el
  servidor). Si la página no está abierta, el estado de la
  sincronización lo dice con el título. **Download my unsynced changes** lleva el texto del aviso
  (`removedWriting`) y arma sus updates también sin GC y en orden, así el archivo trae ese texto. La ayuda tiene su
  entrada (*When someone deletes what you were writing in*).
- **Sin "by Ana":** las filas que se bajan no traen el autor (`pull_updates` devuelve `seq` y los bytes); sumarlo
  pide una migración. Queda para el historial.

**Cómo convive con lo demás:**

- **B.15 (`syncedDS`), la generación y la versión guardia:** no cambian. GC o no, el documento tiene los mismos
  borrados, y `buildUpload` corta igual.
- **Versiones anteriores sobre la misma base:** siguen armando la subida con GC. Lo que una de ellas sube se pierde
  igual que antes (con un borrado de otro ya bajado), y `syncedSV` avanza: esta versión ya no lo vuelve a subir. Se
  cierra del todo subiendo `min_app_version` a esta versión cuando se publique (no es obligatorio: no rompe nada).
- **y-prosemirror, su parche y el editor:** no se tocan. El documento abierto sigue con GC; no hay tipos de bloque
  ni propiedades nuevas.
- **Restaurar una copia** (`resetForRestore`): la subida entera ahora lleva todo lo borrado que el dispositivo tiene
  con texto (ver los números); con el tope de arriba nunca se queda sin subir.
- **Compactar en el servidor** (`Doc_Compactar.md`): su snapshot ya se arma aplicando las filas
  en orden en un `Y.Doc({ gc: false })`, así que conserva este texto. Con `Y.mergeUpdates` lo podía perder (una fila
  vieja que vuelve a subir todo con huecos gana).
- **Compactar en el dispositivo** (`loadInto`, con más de 64 filas al abrir; también la búsqueda del proyecto): ahora
  igual, en orden y sin GC (`mergeRowsInOrder`), por la misma razón.
- **La reparación solo en memoria** (quien abrió sin permiso de escritura y después lo recibe): con la primera
  edición guardaba el documento abierto entero, con GC, y lo borrado en memoria iba como hueco. Ahora guarda solo lo
  que el documento tiene además de lo que se cargó de IndexedDB (`loadedSV`): lo cargado ya está en las filas con su
  texto.
- **Historial de versiones** (en preparación): es "la subida sin GC" de su entrega 2. Con esto, cada
  elemento llega con su texto en su primera fila.

**Números** (`src/ui/uploadNoGcMeasure.test.ts`, fuera de la suite: el editor real escribe letra por letra, cada
letra es una fila guardada como en la app, y cada 20 letras se arma la subida de las dos formas con las mismas
filas; las páginas reales, con las filas de `page_updates` leídas para el diseño del historial):

| Página | Filas guardadas | Subidas: total con GC → sin GC | La subida que más creció | Armar cada subida, con GC → sin GC | Subida entera (restaurar), con GC → sin GC |
|---|---|---|---|---|---|
| Típica: 2000 letras, pocas correcciones | 1961 (55 KB) | 23,7 → 24,3 KB (+2 %) | ×1,42 | 10,3 → 1,2 ms | 15,6 → 19,9 KB |
| Corregida: 5000 letras, muchas correcciones | 4591 (194 KB) | 124 → 140 KB (+13 %) | ×3,55 | 52 → 3,9 ms | 49 → 115 KB |
| Muy editada: 20 000 letras, reescribe bloques | 17 542 (991 KB) | 1370 → 1497 KB (+9 %) | ×2,78 | 987 → 40 ms | 197 → 684 KB |
| Real, 17 filas (`page_updates`) | 17 (6 KB) | — | — | 1,6 → 0,5 ms | 4,6 → 4,7 KB |
| Real, la más editada: 63 filas | 63 (37 KB) | — | — | 3,9 → 2,2 ms | 8,6 → 12,4 KB |

- **En IndexedDB no crece nada**: cada edición ya se guardaba con su texto. Lo que crece son las filas del servidor
  (y lo que los demás dispositivos bajan): entre 2 y 13 % en estas sesiones.
- **Armar la subida es más rápido**, no más lento: aplicar las filas en orden evita `Y.mergeUpdates` de todas, que
  crece con la cantidad de filas (durante una sesión larga las filas se juntan; se compactan recién al volver a abrir
  la página). En la sesión muy editada, de casi 1 s a 40 ms por subida.
- **Memoria**: el documento sin GC es descartable (vive lo que dura la subida). Con la sesión muy editada ocupa unos
  9 MB contra unos 4 MB con GC; en las páginas reales, por debajo de lo que se puede medir. El documento abierto en el
  editor no cambia.
- **La subida entera** (después de restaurar una copia) lleva todo lo borrado que el dispositivo tiene con texto:
  hasta 3,5 veces más en la sesión muy editada, lejos del tope de 6 MB.
- **La auditoría**, con otro guion, midió de +2 a +20 % por subida y hasta ×8 la subida entera después de restaurar
  una copia. Mismo orden de magnitud: lo que crece es lo escrito y borrado entre dos subidas.

**Límites conocidos:** lo escrito con una versión anterior de la app no avisa (no anota sus autores), y lo que ella
sube desde la misma base va con GC (ver arriba). Una reparación hecha solo en memoria que después se borra en memoria
se guarda como hueco: es una copia de algo que ya está en las filas, no texto que alguien escribió.

**Pruebas:**

- **`src/sync/uploadNoGc.test.ts`:** el caso de la auditoría (fallaba antes del cambio: la fila llegaba sin el
  texto), con el aviso solo para quien escribió y todos iguales al servidor; subido antes del borrado (también
  avisa); el otro vio el texto y borró (no avisa); lo borrado por uno mismo (no avisa, y también sube); después de
  cerrar la app; la versión publicada (`fixtures/mainDocs.ts`) sobre la misma base con el aviso guardado; el tope de
  6 MB; *Download my unsynced changes*; «abcde» visto y «fghij» sin subir (el aviso dice solo «fghij»); después de
  restaurar una copia, lo de un tercero no se avisa (sí a quien lo escribió); descartar borra solo lo que se mostró;
  el texto del aviso (orden, fotos por nombre, sin autores propios no avisa); el estado avisa solo con la página
  cerrada; y compactar en orden conserva el texto que una fila posterior trae como hueco (también al abrir con 70
  filas propias más una fila hueco: falla si `loadInto` vuelve a `mergeUpdates`). Desde v0.101, lo que copia la
  reparación que vino con lo bajado (Yjs le cambia el autor al documento) también avisa: falla si se vuelve a anotar
  solo el autor que tiene el documento al guardar; y lo que se escribe después con el número nuevo también (falla si
  se anota solo el número con que se abrió el documento).
- **`src/ui/collabRemovedWriting.test.ts`:** al azar con el editor real, tres dispositivos y uno de la versión
  publicada, escribiendo en párrafos, listas anidadas, celdas de tablas y secciones con el mapa de colapsar
  mientras otros borran bloques padres, tablas y secciones enteras; sin red, bajando antes de subir, respuestas que
  se pierden y la versión publicada sobre la misma base. Revisa letra por letra (por autor de Yjs: y-prosemirror
  reusa letras iguales de al lado, así que una marca no siempre es un solo tramo) que **todo lo que un dispositivo
  guardó con su texto esté en el servidor con su texto**, que todos terminen iguales al servidor (con el mapa de
  colapsar) y que cada aviso sea solo de lo propio y diga **exactamente las letras de sus tramos**, borradas en el
  servidor. En la suite, 12 corridas de 60 pasos (`REMOVED_SEEDS`, `REMOVED_STEPS`; pasaron 40 de 80). Con la subida
  de antes fallan 29 de 30 corridas. Desde v0.101 lo propio de cada dispositivo son todos los autores que tuvieron sus
  documentos (la prueba los anota en cada transacción) y no solo el número con que se abrió cada uno: con 300 corridas
  de 200 pasos, la prueba de antes fallaba en 25 en una corrida (17 en otra: a 200 pasos no es del todo repetible) («was told about text it did not write», que era texto del mismo
  dispositivo escrito después de que Yjs le cambió el número); ahora pasan las 300, y las semillas 2 y 88 con 120
  pasos quedan como casos fijos (fallan si la prueba vuelve a mirar solo el primer número). Las corridas al azar
  además vuelven a abrir la página, en la misma pestaña o en otra (otro `PageDocs` sobre la misma base), a veces
  después de 70 filas sin red (al abrir se compactan): en 300 × 200, 2976 aperturas, 861 compactando, 67 cambios de
  autor, ninguna letra propia fuera del servidor.
- **`src/ui/RemovedWritingBanner.test.tsx`:** el aviso aparece con la página abierta, muestra, copia (y sin
  portapapeles deja el texto a la vista) y al cerrarlo se borra lo mostrado.

## Bajar con snapshots (compactar, B.9)

Entregas 1 y 2 de `Doc_Compactar.md` (v0.127: la app sabe bajar snapshots; v0.133: el dispositivo de quien edita los
arma). Siguen apagados en la base hasta la entrega 3.

- **El pedido.** `PageDocs.pullPage` baja con `remote.pullContent`: con los snapshots prendidos y la base en la versión
  17, `pull_page_content`; si no (apagados, una base sin la función), el mismo `pull_page_updates` de siempre. Un
  snapshot llega como la primera fila de la respuesta, con `seq` = la última fila que junta y su `snapshotId`; para
  `applyRemote` es un update más (lo guarda con el cursor, avanza `syncedSV` con `serverReach` y suma sus borrados a
  `syncedDS`).
- **Lo que se anota** (`DocState.snapshotId` y `contentEpoch`): el último snapshot aplicado y la época de contenido de
  la página que vino en la misma respuesta, en la misma transacción que lo guardado.
- **Un snapshot ilegible** (de una versión más nueva) no se saltea como una fila: no se guarda nada del lote, el
  cursor no se mueve y esa página baja en filas sueltas hasta que se vuelve a abrir la app.
- **La huella** (entrega 3, O-D): desde la entrega 3 la app pide `pull_page_content` con su versión y la base manda la
  huella guardada del snapshot; si no coincide con lo que llegó (aunque se pueda leer), no se guarda nada del lote, se
  invalida (si la sesión ve lo borrado) y la página baja en filas. La de sin versión (v0.127 a v0.133) ya no sirve
  snapshots.
- **Si se invalida** (el dispositivo aplicó un snapshot de esa página y la época de la respuesta es otra, o la del
  árbol es más nueva que la anotada; un árbol atrasado no reinicia nada): **desde la entrega 2 (D110)**, sin nada propio
  sin subir, lo guardado pasa a ser sus elementos sin ningún borrado (en una sola transacción, con el cursor,
  `syncedSV`, `syncedDS` y el snapshot) y la página baja las filas del servidor: un borrado de más del snapshot no
  llega a nadie, y un elemento de más se conserva y, si el servidor no lo tiene, sube con lo escrito al lado (sobra
  texto antes que falte). Si está abierta, se vuelve a abrir. Con algo sin subir, olvida `syncedSV` y espera: lo propio
  sube primero con todos sus elementos (`syncedDS` no deja subir los borrados del snapshot) y el rearmado va en la
  bajada siguiente; olvida `syncedSV` una sola vez por época (`forgotSyncedForEpoch`, entrega 3, R-2). Restaurar una
  copia hace lo mismo con las páginas que aplicaron un snapshot. (En v0.127 a v0.129 la página volvía a subir entera.)
  La marca del rearmado (`DocState.rebuilt`) se guarda con él y se borra cuando se marca la subida (entrega 3, R-1): si
  la app se cierra a mitad, la próxima bajada lo termina. El ciclo baja también las páginas al día cuya época cambió y
  las que tienen esa marca.
- **Armar snapshots** (entrega 2, `compact.ts`): al final del ciclo, como mucho una página, con los snapshots prendidos
  y una versión que alcanza; sale de las filas del servidor, nunca de lo guardado. Ver `Doc_Compactar.md`, "Cómo quedó
  la entrega 2".
- Restaurar una copia (`resetForRestore`) borra también los dos campos. Las versiones anteriores de la app los
  conservan sin mirarlos y siguen bajando con `pull_page_updates`.

## Árbol de páginas

- Crear, renombrar, mover, mandar a la papelera y restaurar entran a una **cola de salida** en IndexedDB y
  se aplican en la vista en el acto.
- Crear y renombrar **proyectos** va en la misma cola: un proyecto creado sin red sube antes que sus
  páginas. El dispositivo guarda la lista de proyectos para abrirlos sin red. Si el servidor rechaza un
  proyecto nuevo, queda a la vista con sus páginas hasta que se lo descarta; si tiene páginas creadas
  adentro, no se puede descartar, igual que una página rechazada.
- El servidor rechaza los movimientos que arman un ciclo, también si llegan dos a la vez desde dos
  dispositivos (los cambios de padre de un espacio se aplican de a uno). Si igual apareciera un ciclo, la
  app muestra esas páginas en la raíz en vez de colgarse.
- Se suben en el orden en que se hicieron. Crear una página es idempotente (`upsert` por id generado en el
  dispositivo), así que reintentar no falla.
- Si el servidor rechaza un cambio para siempre (por ejemplo, dos movimientos offline que juntos arman un
  ciclo), el cambio pasa a la lista de rechazados y la app lo avisa. Una **creación rechazada nunca
  desaparece**: la página y sus cambios siguen a la vista, su contenido sigue en el dispositivo y se puede
  reintentar. "Ocultar" solo descarta rechazos que no dejan nada afuera (renombrar, mover o borrar una
  página que ya está en el servidor, o un proyecto rechazado sin páginas, con sus renombres).
- El contenido de una página se sube recién cuando la página existe en el servidor.
- Los ajustes de una rama (`pages.settings`) viajan como cualquier otro cambio del árbol. Cada cambio
  manda el objeto entero: si dos dispositivos cambian ajustes distintos de la misma página sin red, queda
  el último que llega al servidor. Son preferencias de vista, no contenido, y se vuelven a elegir en un
  toque.

### Topes de largo

La base tiene `check` de largo (`length()`, en caracteres de Postgres: **puntos de código**, no unidades UTF-16 de JS;
un emoji son dos unidades y un carácter). Un cambio que pasa uno lo rechaza para siempre y el *Retry* vuelve a fallar:
pasó con un título pegado de más de 500 caracteres. Los topes están en `src/lib/dbLimits.ts` y el servidor falso de
las pruebas aplica los mismos `check` con el mismo error (`src/sync/lengthChecks.ts`).

- **Título (500).** Todo lo que escribe un título pasa por el árbol (`PageTree.enqueue` → `fitOp`): lo corta en 500
  caracteres sin partir un grafema (`cutText`) y, si el corte cae en una palabra, en el espacio anterior (hasta 60
  caracteres atrás). **Lo que sobra no se pierde:** se anota en `meta.titleRests` en la misma transacción que el
  cambio, y `src/sync/titleRest.ts` lo escribe al principio de la página, un párrafo por renglón, como una edición
  local (se guarda y se sube; no entra en el ⌘Z del editor abierto). Lo anotado se olvida recién cuando la página
  quedó guardada en el dispositivo; el primer párrafo lleva el id de lo anotado, así que un corte en el medio no lo
  repite. Aviso: *The title was longer than 500 characters: the rest is now the first paragraph of “…”*.
- **En el título de la página**, pegar, soltar o dictar más de la cuenta deja el título en el tope y manda lo que sobra
  a la página (con sus renglones); teclear pasado el tope no entra y avisa *A title can be up to 500 characters.*
- **La cola.** Al abrir, los cambios sin subir que dejó una versión anterior con un título largo se cortan y lo que
  sobra se anota (son lo último que hizo la persona). Los **rechazados por el largo** (solo por `pages_title_check` o
  `workspaces_name_length`: un rechazo por permisos no se toca) se arreglan con el árbol del servidor a la vista, en
  `setSnapshot` (`repairRejected`): si el título no cambió después del rechazo, el cambio vuelve a la cola en su lugar,
  cortado; si cambió (el `updated_at` del servidor es posterior al rechazo, o hay un renombre posterior en este
  dispositivo), **el título más nuevo queda** y el texto largo va entero a la página. En la duda gana el título de ahora:
  nada se pisa ni se pierde. *Retry* no los manda de nuevo (perderían el momento del rechazo) y *Hide* no los descarta.
- **Nombre de proyecto (200).** Los campos ya tenían el tope; el árbol lo corta igual (sin aviso: no se llega).
- **Clave de orden (128).** La clave entre dos vecinas se alarga cada vez que se pone algo en el mismo hueco (unas 600
  veces para pasar los 128). Antes de pasarlo, las hermanas reciben claves nuevas y parejas en el mismo orden
  (un cambio por hermana). Si otro dispositivo movió una de esas hermanas a la vez, gana el último cambio que llega
  (roadmap B.23).
- **Una página nueva con título largo** (asistente, reporte del día, copia propia): su contenido lo escribe
  `writeNewPage`, que no escribe en una página con algo. Lo que sobró del título no cuenta (`onlyTitleRests`, por el
  prefijo `titlerest-` de esos párrafos): si llega antes, el contenido va después de él.
- Un archivo de Shot Docs importado ya no corta el título en 500 (`shotdocsImport.ts`): lo corta el árbol y lo que
  sobra queda en la página. Los demás cortes de texto que van a la base (autor y cuerpo de un comentario importado,
  rótulo de una mención) usan `cutText` para no dejar medio emoji.

## Preferencias de la cuenta

Tema, fuente, tamaño del texto y ancho de página se aplican al instante y se guardan en el dispositivo
(`localStorage`), así la app abre con ellas aunque no haya red y sin un destello del otro tema. Al entrar,
si hay cambios de ese usuario sin subir, se suben; si no, manda lo guardado en la cuenta
(`user_settings`). Gana el último cambio, igual que con los ajustes de una rama. `shotdocs-prefs` guarda
siempre las del usuario actual (el nombre de siempre); al entrar con otro usuario (otra cuenta u otro
workspace), el nuevo vuelve a la suya si ya había entrado en el dispositivo, también sin red:
`shotdocs-prefs-others` guarda una copia por usuario (hasta 20, también la del actual, al día con cada
cambio). Con dos pestañas en workspaces distintos, una no toma las preferencias de la otra (el aviso de
otra pestaña con otro usuario se ignora) y solo sube las del usuario con que entró, con su cliente.

## Imágenes

- Se aceptan JPEG, PNG, GIF, WebP, AVIF y HEIC de hasta 25 MB (lo mismo que acepta el bucket). SVG no,
  porque puede traer scripts. Otro archivo se rechaza con un aviso.
- Una imagen pegada adentro de HTML (`data:`) se pasa a archivo para que el documento no cargue megas.

## Archivos grandes (fotos y videos)

Con portero (`workspace_settings.media_url`) y la base en la versión 3 (la migración
`20260930150000_archivos.sql`), las fotos y los videos que se eligen, pegan o sueltan en una página van al
Drive del dueño (`Plan_Workspaces.md`, pasos 6 y 8). Sin portero, todo sigue como en "Imágenes" (solo
imágenes, a Supabase, con `sdfile://`). El código está en `src/media/`: `queue.ts` (la cola),
`mediaDb.ts` (la base del dispositivo), `probe.ts` (medidas y miniatura), `portero.ts` (el cliente del
portero) y `picker.ts` (el selector de carpetas de Google).

- **En la página:** el bloque `image` de siempre con `url: "sdmedia://<id>"`, donde `<id>` es el uuid de la
  fila de `files`, creado en el dispositivo. Nada de bloques `video` o `file`: la versión publicada los
  borraría. Una versión vieja muestra una imagen rota y conserva la dirección aunque se edite la página
  (`src/ui/media.test.ts`, con una copia del esquema de `main` en `src/ui/fixtures/`). Con portero, el
  bloque `image` acepta también videos al elegir, pegar o soltar un archivo (cambia lo que ofrece el
  selector, no el bloque); sin portero, solo imágenes, como antes.
- **Primero en el dispositivo:** el archivo se guarda en otra base IndexedDB, `<base local>:media` (la de
  siempre no cambia de versión: una versión vieja de la app no podría abrirla), con su id, página,
  proyecto, nombre, tipo (en minúsculas, sin parámetros; si el navegador no lo da, sale de la extensión),
  peso, el día local (`AAAA-MM-DD`) y el archivo, en una sola transacción. El editor inserta el bloque
  `image` apenas se elige el archivo (vacío, con el nombre) y la dirección `sdmedia://` llega cuando el
  archivo ya quedó guardado; si no se pudo guardar, el bloque se quita con un aviso. Mientras se guarda, el
  navegador pide confirmación antes de cerrar. El original queda en el dispositivo también después de
  subirlo.
- **Medidas y miniatura:** se sacan después de guardar el archivo, del archivo ya guardado (si la app se
  cierra antes, se sacan al volver, antes de registrarlo). Foto: se decodifica ya reducida (a 480 px de lado
  mayor, `createImageBitmap` con `resizeWidth`/`resizeHeight`, para no abrir una foto de 48 MP entera en el
  iPhone; si el navegador no lo soporta, se dibuja la imagen cargada), JPEG de calidad 0.8 (baja la
  calidad si pasa de 512 KB). Video: un cuadro cerca del primer segundo. Si el navegador no puede abrir el
  archivo (un video que no decodifica; un HEIC que no se pudo pasar a JPEG, ver `Doc_Imagenes.md`, "Fotos
  HEIC": desde v0.075 se convierten al agregarlos), no hay miniatura ni medidas: se
  registra y se sube igual, y en la página queda un ícono con el nombre. La primera miniatura que se sube
  a `thumbs` queda: el bucket no deja reemplazarla. **Queda para después:** que otro dispositivo que sí
  pueda abrir el archivo genere la miniatura que falta (`thumb_at` en null).
- **Subida, con su propio ciclo** (una subida de minutos no frena al texto; nunca hay dos vueltas a la
  vez): `register_file` → miniatura a `thumbs/<id>.jpg` sin reemplazar (si ya existe, está hecho) y
  `set_file_thumb` → portero, `POST /upload` con `{ file, name, mime, size, day }` y partes de 8 MiB
  (`PUT /upload/<id>`) → subido cuando el portero responde `done` **y la base lo confirma** (se lee
  `files.drive_id`; mientras esté vacío, sigue pendiente). Si la miniatura no se puede subir nunca (el
  bucket la rechaza), se sigue con el original sin ella y queda anotado. Cada paso queda anotado apenas termina
  (también el id de la subida y hasta dónde llegó, con cada parte): si la app se cierra a la mitad, al
  volver sigue desde ahí, y el portero dice cuánto le llegó. Todos los pasos son idempotentes: repetir uno
  cuya respuesta se perdió no duplica nada. Si el portero responde `done` con `linked: false` (Drive lo
  tiene pero la base no se enteró), sigue pendiente con el id de Drive anotado, y las vueltas siguientes
  **nunca vuelven a subir el archivo**: leen la base y le preguntan al portero sin abrir una subida nueva
  (`onlyIfSent`), y el portero le avisa a la base. Si el portero ya no sabe que el archivo llegó (abriría
  una subida nueva), se detiene y recién "Retry" lo vuelve a subir entero. Un portero anterior al paso 6
  no manda `linked`, no le avisa a la base y sube a `Media_Test` sin la marca del archivo: el archivo se
  detiene con el aviso *The media server needs an update* (cada reintento lo subiría entero otra vez), y
  "Retry", después de actualizar el portero, lo sube bien (la copia de `Media_Test` queda de más en el
  Drive). Un archivo de una página que todavía no existe en el servidor espera a que la página suba.
- **Errores:** sin red (o sin respuesta del portero) espera a la próxima sincronización. Lo que se puede
  arreglar solo (sesión renovándose, Drive sin conectar, 5xx) se reintenta esperando cada vez más, hasta
  10 minutos, con el error a la vista. Lo que no (`page_not_found`, `file_other_project`, un 400, 403 o
  404 del portero, o el 409 de un archivo que la base tiene con otro archivo de Drive) queda detenido y a la vista, **sin descartar el archivo**, y se reintenta con "Retry" o
  al abrir la app (lo detenido se vuelve a registrar: `register_file` es idempotente). Si el servidor dice
  que no existe un archivo que acá figura registrado (un 404 del portero, `file_not_found`), se vuelve a
  registrar en vez de detenerlo; recién si sigue igual tres veces seguidas, se detiene.
- **Subidas que se traban:** un pedido al portero que deja de moverse (sin error de red) se corta y el
  archivo vuelve a la cola para más tarde, sin frenar a los demás; una subida lenta no se corta mientras
  sigan saliendo bytes. Los topes y el detalle están en `Doc_Portero.md`, "Subidas que se traban". Lo mismo
  con la miniatura si Storage no contesta (v0.070; ver "Cada consulta a la base tiene un tope de tiempo"). Si
  se traban dos archivos distintos seguidos sin avanzar, la vuelta deja de subir archivos y la cola espera
  antes de volver a probar (v0.092; `Doc_Portero.md`, "Colgado para todos").
- **Si la base de archivos del dispositivo no se abre,** la app arranca igual: la cola de fotos y videos
  queda apagada (no se pueden agregar), el estado lo avisa con un aviso propio (`mediaWarning`, que no
  pisa ni es pisado por los demás) y el texto sincroniza como siempre. Un error de esa base nunca corta la
  sincronización del texto.
- **Qué páginas usan cada archivo** (`page_files`): el dispositivo que registra un archivo ya lo cuelga de
  su página. Cuando una página tiene un `sdmedia://` que llegó de otra (se copió o se pegó el bloque), al
  abrirla y con cada cambio hecho en ella se pide `link_page_file`. Los pares ya vistos se guardan en el
  dispositivo para no llamar de más. Si el archivo todavía no está en el servidor (`file_not_found`: lo
  registra otro dispositivo), se espera y se reintenta más tarde sin contarlo como pendiente; lo mismo si la
  persona no puede editar esa página. Desde el paso 11, también lo que una página deja de usar: ver
  "Papelera de archivos".
- **Mostrar:** en la página, siempre la miniatura: la hecha en este dispositivo o la del bucket `thumbs`
  (bajada con la sesión y guardada en el dispositivo, así se ve sin red); un video, con una marca de
  "play"; sin miniatura, un ícono con el nombre. El original solo lo muestra el carrete (paso 7,
  `Doc_Carrete.md`): el del dispositivo si está (anda sin red), o el archivo entero con un pase del
  portero (`POST /pass` con `{ file }`). BlockNote resuelve la dirección de una imagen una sola vez:
  cuando la miniatura llega después (se terminó de hacer acá, o la subió otro dispositivo; esto último se
  pregunta como mucho una vez por minuto, solo por los archivos que se mostraron con el ícono), el editor
  cambia la imagen en pantalla sin tocar el documento.
- **Cuenta en los cambios pendientes** (`pendingMedia` en el estado), también los usos de páginas por
  confirmar. Los detenidos por un error cuentan como rechazados (`failedMedia`).
- **Restaurar una copia:** todo lo de este dispositivo vuelve a la cola, también lo que estaba a medio
  subir: se vuelve a registrar, a marcar la miniatura (si está en el dispositivo) y a colgar de sus
  páginas. El archivo no se vuelve a subir, porque el portero recuerda lo que ya subió a Drive (y una
  subida a medias sigue desde donde quedó). La cola guarda en su propia base la última generación que
  vio y hace su parte aparte del resto: si su base falla o está cerrada, el texto se recupera igual y la
  cola lo hace en la próxima sincronización (o al abrirse), antes de guardar la generación nueva.
- **La carpeta en Drive** (paso 8): el dueño la elige en el menú de la cuenta → *Google Drive* (estado de la
  conexión, conectar o reconectar, dónde está `LGA_ShotDocs` y *Choose folder…* con el selector de
  Google). Sin `GOOGLE_API_KEY` en el portero, va a la raíz de *My Drive* (`Doc_Portero.md`, paso 2b). Al
  volver de Google (`?drive=`), el diálogo se abre solo para el dueño; a otra persona no le ofrece
  conectar ni elegir.

## Papelera de archivos

Paso 11 de `Plan_Workspaces.md`, con la base en la versión 6 (migración
`20260930180000_papelera_archivos.sql`). Un archivo está en la papelera (`files.trashed_at`) cuando ninguna
página viva lo usa; la base lo recalcula sola con cada cambio de `page_files` y cada vez que una página entra
o sale de la papelera de páginas. Usar un archivo es una fila de `page_files` sin `removed_at`, y eso lo
mantienen los dispositivos. El código: `src/media/usage.ts` (qué archivos tiene un documento),
`MediaQueue.reconcilePage` y la cola en `src/media/queue.ts`, `reconcileMedia` en `src/sync/engine.ts`, la
pestaña en `src/ui/TrashView.tsx` y `src/media/fileTrash.ts`.

- **Qué archivos usa cada página.** En cada sincronización, después de subir y bajar el contenido, cada
  página cuyo documento cambió desde la última vez (acá o en otro dispositivo, abierta o no) se lee de lo
  guardado en el dispositivo y se juntan sus `sdmedia://<id>`: el atributo `url` de cualquier elemento, no
  solo del bloque `image` (un bloque que esta versión no conoce igual cuenta como uso). Eso se compara con lo
  que el dispositivo sabe que el servidor tiene y la diferencia va a la cola de archivos: lo nuevo,
  `link_page_file`; lo que ya no está, `unlink_page_file`. Qué versión de cada documento ya se comparó
  (ediciones, cursor y si la base tiene la papelera) queda anotado en la base de archivos del dispositivo:
  mientras no cambie, no se vuelve a leer. Solo queda anotada si se pudo quitar lo que hiciera falta: una
  página a medio subir, con algo ilegible o desconocido, o sin comprobar (ver abajo), se vuelve a mirar en
  cada ciclo.
- **Dispositivo nuevo: lo bajado no cuenta como pendiente** (B.14). Un dispositivo que nunca comparó una
  página (recién instalado, recién entrado, o una página que acaba de llegar) no tiene anotado ningún uso, y
  antes ponía en la cola un `link_page_file` por cada foto o video de lo que bajaba: miles de cambios "sin
  subir" que salían de a uno durante minutos y no escribían nada (la base ya tenía cada fila). Ahora, antes
  de comparar esas páginas, se lee una vez qué usos activos tiene el servidor (`page_files`, de a 100 páginas;
  `MediaQueue.serverUses`) y lo que ya está queda anotado como confirmado, igual que después de mandarlo (si es
  ajeno, como ajeno, sin avisar). Lo que el servidor no tiene, o tiene quitado, se manda como siempre, y si la
  lectura falla (sin red, un error), todo se manda como antes: nunca se deja de mandar un uso sin ver que el
  servidor lo tiene. Cada página se lee una vez por apertura de la app. La lectura solo se usa si la página no
  tiene nada propio por subir: si no, entre la lectura y la comparación otro dispositivo pudo quitar un uso que
  esta página volvió a tener (lo encontró la auditoría; prueba A2 de `trash.test.ts`).
- **Una sola fila por página y archivo** (store `links`, con `removed` y una revisión `rev`): gana lo último
  que se vio en el documento. Borrar y deshacer antes de sincronizar no manda nada; si el deshacer llega
  mientras viaja el `unlink`, la respuesta no marca la fila como hecha (cambió la revisión) y después sale el
  `link`, que reactiva el uso. El editor, al volver a ver un archivo (deshacer, pegar), también da vuelta la
  fila en el acto (`ensureLinks`). Los dos pedidos son idempotentes: repetir uno cuya respuesta se perdió no
  cambia nada. Primero van los usos nuevos y después los quitados.
- **Nunca se quita mientras haya otro uso sin confirmar.** Un `unlink` de un archivo no sale mientras este
  dispositivo tenga, para el mismo archivo, un uso que el servidor todavía no confirmó: por mandar, detenido
  por un error, esperando (`file_not_found`), sin permiso sobre esa página, o un archivo agregado acá y
  todavía sin registrar (`register_file` lo volvería a colgar de la página). Queda esperando (`held`, sin
  contar como pendiente) y sale solo cuando ese otro uso se confirma o se quita. Así, cortar una
  foto de una página y pegarla en otra nunca la manda a la papelera en el medio, aunque el `link` de la
  página nueva falle.
- **Una foto o un video de otro proyecto** (se pegó el bloque desde otro proyecto): el uso se manda igual.
  `link_page_file` (y `register_file`) lo guardan como uso ajeno (`page_files.is_foreign`: cuenta para la
  papelera, así el archivo no se va mientras está en esa página, pero no da permiso sobre el archivo) y
  devuelven `'file_other_project'` sin error. La app lo toma como confirmado (`foreign` en la fila), no lo
  reintenta y avisa una vez *This photo belongs to another project: it will show broken here* (al pegarlo,
  si ya sabe de qué proyecto es; si no, cuando responde la base). En esa página se ve el marcador *Photo
  from another project* en vez de la foto (`MediaQueue.resolve` con la página): lo decide el proyecto del
  archivo, si el dispositivo lo sabe, o la fila confirmada como ajena. Quien no ve el archivo lo ve como
  no disponible. De otro workspace no se sabe nada: queda esperando como un archivo que todavía no llegó.
- **Solo se quita con el documento completo y al día.** Un documento a medio bajar no dice que un archivo se
  quitó, dice que todavía no llegó. Para mandar un `unlink`: el dispositivo tiene todo lo que el servidor
  tenía al bajar el árbol en ese ciclo, no llegó ningún update que esta versión no pudo leer (queda marcado
  en la página, `unreadable`, y esa página nunca quita), el documento no trae contenido que esta versión no
  conoce, lo propio ya está subido (si no, el servidor todavía muestra el bloque) y no hay ediciones sin
  guardar en el dispositivo. Si falta algo, solo se suman usos. Las páginas que la persona no puede editar y
  las que el servidor todavía no tiene no se miran.
- **La primera vez que una página quitaría un archivo**, se baja su historial entero del servidor y se
  comprueba que esta versión lo pueda leer: una versión anterior de la app descartaba un update ilegible sin
  anotarlo (la marca `unreadable` es de esta versión), así que en un dispositivo que se actualizó el
  documento local podría estar incompleto sin saberlo. Si algo no se lee, la página queda marcada y nunca
  quita; si se lee todo, queda anotada como comprobada (en la base de archivos) y no se vuelve a hacer. Si
  la comprobación falla (sin red o un error), no se quita y no se vuelve a bajar el historial hasta pasado
  un rato que crece cada vez (1 minuto, 2, 4… hasta 1 hora).
- **`p_seen_seq`:** cada `unlink` lleva el `seq` del documento con el que se decidió. Si la página cambió
  después en el servidor (otro dispositivo pudo volver a poner la foto), la base no hace nada y lo dice; la
  fila vuelve a "usado" y la página se compara otra vez con el documento nuevo en el próximo ciclo.
- **Lo agregado en este dispositivo:** `register_file` ya lo cuelga de su página. Cuando el documento lo
  muestra por primera vez se anota (sin mandar nada) para saber después si se quitó; si el documento nunca lo
  tuvo (se agregó y se borró enseguida), se quita pasados 5 minutos.
- **Sin red** no se compara nada (el documento guarda el cambio) y lo que ya está en la cola espera,
  guardado en el dispositivo; cuenta en los cambios pendientes y sale al volver la red. Los usos que esperan
  algo que no depende del dispositivo (`held`, `denied`, `file_not_found`) no cuentan como cambios sin subir
  (tampoco en "Download my unsynced changes", donde `mediaLinks` trae cada uso con `removed`). Con la base
  anterior a la versión 6 no se manda ningún `unlink`.
- **La pestaña Archivos** de la papelera: se muestra si la base tiene la papelera, los permisos del
  dispositivo no la descartan y `trashed_files` no responde `not_allowed` (ven la de un proyecto quien tiene
  *Edit & create pages* sobre el proyecto entero, y el dueño y los admins con algún permiso sobre él). Lista
  del proyecto abierto, lo último primero: miniatura (la del dispositivo o la del bucket `thumbs`), nombre,
  peso, el día en que entró y los días que faltan para los 30; mientras `auto_purge_files` esté apagado dice
  *Auto-delete is off* y que, prendido, cada uno se mandaría a los 30 días. Los que usa una página que está
  en la papelera de páginas dicen *Used by “<título>” in the trash* (`in_trashed_page` de `trashed_files`).
  Arriba, el aviso *A file can show here while still in use on a page this device hasn't synced*, que se
  repite en la confirmación. Solo con red. La pestaña Pages avisa que restaurar una página no trae de vuelta
  lo que ya se mandó a la papelera de Drive (se ve como borrado).
- **Mandar a la papelera de Drive** (dueño y admins con permiso sobre el proyecto): de a uno o *Empty*, con
  una confirmación que dice que van a la papelera de Drive del dueño y que se recuperan desde ahí durante 30
  días. Cada uno es `POST /trash` al portero con la sesión (`Doc_Portero.md`). 200: sale de la lista. 409 con
  `code: 'in_use'`: una página lo volvió a usar, se vuelve a leer la lista. 503 con `code:
  'drive_not_connected'`: se avisa *Google Drive is not connected: ask the workspace owner to reconnect it*
  sin marcar nada (y *Empty* para). Otro 409, 403, 404 y 502: el error queda a la vista en ese archivo.
  *Empty* manda de a uno, mostrando el avance, sigue si uno falla y deja afuera los que usa una página de la
  papelera (esos se mandan de a uno, con una confirmación que dice que restaurar la página no los recupera).
  Un archivo que una página de este dispositivo usa sin haberse sincronizado se saltea con un aviso. Uno
  pedido y sin confirmar (`purged_at` sin `drive_trashed_at`, por ejemplo porque Drive falló) sigue en la
  lista y se puede volver a pedir. Pedirlo es definitivo para la app: aunque una página lo vuelva a usar, no
  sale de la papelera.
- **En las páginas**, un archivo con `drive_trashed_at` se muestra como *File deleted (in the Drive trash)*
  y uno pedido pero sin confirmar (`purged_at` solo) como *Deletion requested (not yet in the Drive trash)*,
  con su miniatura oscurecida si la hay, no como roto ni como pendiente. Lo guardado de cada archivo se
  vuelve a preguntar una vez por sesión al mostrarlo; si resultó borrado, el editor cambia la imagen en
  pantalla (como cuando llega una miniatura). El carrete todavía no lo distingue.
- **Borrado automático a los 30 días: armado y apagado.** Mientras `workspace_settings.auto_purge_files` sea
  `false` (hoy siempre; lo decide Lega) no se pregunta ni se manda nada. Prendido, al abrir la app un dueño
  o admin esperaría una vuelta de la cola de usos, pediría `files_due_for_purge` de cada proyecto y mandaría
  cada vencido a `/trash`, de a uno, salteando los que tengan usos de este dispositivo sin mandar
  (`MediaQueue.autoPurge`). Una prueba confirma que apagado no se llama nunca.

## Comentarios y preguntas

Paso 10 de `Plan_Workspaces.md` (sección 4), con la base en la versión 5
(`20260930170000_comentarios.sql`). El código está en `src/sync/comments.ts` (la cola),
`src/sync/commentsRemote.ts` (las llamadas), `src/ui/CommentsPanel.tsx` (el panel), `src/ui/EditorComments.tsx`
(lo que suma el editor) y `src/ui/commentsUi.ts` (lo que comparten).

- **En una tabla propia, nunca en el documento.** Cada comentario va anclado al id del bloque de BlockNote
  (o a la página entera). No se usan los comentarios que trae el editor: guardan una marca nueva en el
  texto, que una versión vieja borraría con el párrafo entero, y obligarían a que quien comenta pueda
  escribir la página. Un hilo es un comentario sin `thread_id` y sus respuestas (que llevan el bloque del
  hilo); lo que se resuelve es el hilo. La app lee `comments_view` (la tabla no se puede leer con `*`: el
  texto sale solo por la vista, vacío si el comentario se borró) y los correos con `comment_authors`.
- **Primero en el dispositivo:** altas, ediciones, borrados y resoluciones entran a una cola en otra base
  IndexedDB, `<base local>:comments` (la de siempre no cambia de versión: una versión vieja de la app no
  podría abrirla), con un id creado en el dispositivo. Se ven en el acto (lo bajado con la cola encima) y
  cuentan en los cambios pendientes (`pendingComments`). Si esa base no se abre, los comentarios se leen
  con red pero no se escriben, con un aviso.
- **Suben en orden** al final de cada ciclo, uno por uno, y cada paso es idempotente por id: reintentar lo
  que ya llegó no duplica nada. Lo de una página creada sin red espera a que la página suba. Antes de
  guardar un cambio se junta con lo que todavía no salió: una edición de un comentario cuya alta no se
  intentó mandar **se funde en el alta** (la base da `comment_conflict` si se reintenta un alta con otro
  texto); un comentario borrado antes de subir no viaja (salvo que tenga respuestas esperando); resolver y
  reabrir sin mandar se queda con lo último. El cambio que se manda se marca como intentado en la misma
  transacción en que se lee: desde ahí nada se le funde, y una edición va aparte.
- **Comentarios importados** (`Doc_Importar_Coda.md`, "3. Comentarios"): la operación `import` de la cola lleva
  la fecha original y, si es de alguien de afuera, su nombre y correo; sube con `import_comment` (base en la
  versión 8) y en todo lo demás se trata como un alta (se le funde una edición, descartarla se lleva sus
  respuestas). Volver a ponerla en la cola con el mismo id no la repite; si todavía no salió, toma el bloque
  nuevo. Una versión de la app anterior a v0.060 no la conoce y la daría por subida sin mandarla: por eso se
  recargan las pestañas antes de importar, y además cada una queda en `meta` (`import:<id>`) hasta que el
  servidor la confirma; al abrir, lo que está ahí y ya no está ni en la cola ni en lo bajado vuelve a la cola.
  Después de restaurar una copia, lo importado por esta persona vuelve como `import`, con su autor y resuelto.
- **Errores:** sin red, espera. Un error que se arregla solo (un 500, la sesión renovándose) se reintenta
  en la próxima sincronización con el error a la vista (`commentError`). Un rechazo (`comment_denied`,
  `not_allowed`, `comment_deleted`, `comment_conflict`, una página que dejó de estar compartida...) queda
  en el dispositivo con el motivo en palabras, en el panel (junto al comentario) y en el estado ("rejected
  by the server"), **y no se descarta solo**: se reintenta con "Retry" o al abrir la app, va en el archivo
  de "Download my unsynced changes", y solo la persona puede descartarlo ("Discard…", en el panel o en el
  detalle del estado). Antes de descartar, la app dice qué pasa (el comentario vuelve como está en el
  servidor, el hilo se reabre, se van también N respuestas sin subir) y ofrece copiar el texto. **Un cambio
  rechazado no se aplica en pantalla:** un borrado que la base no aceptó deja ver el comentario, y una
  edición de un comentario que otro borró lo muestra borrado, las dos con el motivo. Borrar un comentario
  propio cuya alta fue rechazada lo saca de la cola sin mandar nada. Lo demás de la cola sigue subiendo.
- **Bajar:** los comentarios de la página abierta se bajan al abrirla y después **como mucho cada 10
  segundos** mientras siga abierta (en el acto si se subió algo de ella), y se guardan para verlos sin
  red. Si la base tiene `list_comments(p_page_id, p_since)`, se baja solo lo que cambió desde la última
  vez (el cursor, `updated_at`, se guarda con lo bajado); si no la tiene (PGRST202), la vista entera. Los
  correos (`comment_authors`) se piden solo cuando aparece alguien que el dispositivo no conoce. Una página
  que ya no se ve no corta la bajada de las demás, y el error se ve en el panel. Con la base anterior a la
  versión 5 nada se manda: lo escrito queda en el dispositivo y el estado avisa que falta migrar.
- **Restaurar una copia** (la generación, ver abajo): la cola de comentarios guarda la última generación
  que vio (en su base). Si cambió, **antes de la primera bajada** (que pisaría lo guardado) compara lo
  guardado con lo que tiene el servidor y vuelve a poner en la cola, delante de lo que ya había: los
  comentarios propios que ya no están (con el mismo id: el alta es idempotente), sus ediciones más nuevas
  que las del servidor, y los borrados y resoluciones hechos por esta persona. Lo de otra persona lo
  recupera su dispositivo. La próxima bajada es entera. Se suma al aviso de recuperación.
- **Permisos** (misma cuenta que la base, escala de `access.ts`): con Ver (1) se leen; con Comentar (2) se
  comenta, se responde y se resuelve **aunque el editor quede en solo lectura**; editar un comentario,
  solo quien lo escribió; borrarlo, quien lo escribió o quien tiene editar y crear páginas (4). Los nombres
  son el correo de quien escribió (de `comment_authors`) y "You" para uno mismo.
- **En la pantalla:** el botón de comentarios de la barra de arriba (con la cantidad de hilos abiertos)
  abre el panel: a la derecha en la computadora (si hay lugar, la página se corre) y como hoja desde abajo
  en el teléfono. Arriba los hilos abiertos, en el orden de la página; los resueltos, plegados. Cada hilo
  muestra el bloque al que apunta: un clic lleva al bloque y lo resalta (en el teléfono, la hoja se
  cierra). En el margen derecho de cada bloque, la cantidad de comentarios abiertos, y en el bloque que se
  señala (o se toca) un botón para comentarlo. También "Comment" en la barra de formato, en el menú del
  bloque (el tirador de la izquierda) y con Ctrl/⌘+Alt+M (con AltGr no). Si la base de comentarios del
  dispositivo no se abrió, no se ofrece comentar. Cerrar el panel con algo escrito sin mandar (tocar
  afuera, Escape, la X) pide confirmación. **En el teléfono**, la hoja se sube por encima del teclado (el
  panel lee `visualViewport`, porque en iOS el teclado no achica la página) y el cuadro de texto queda a la
  vista; en Android, `interactive-widget=resizes-content` (en `index.html`) hace que el teclado achique la
  página, como hacía Chrome antes de la versión 108.
- **Preguntas:** un párrafo con `question: true` (como Script: **nunca un tipo de bloque nuevo**), en el
  menú "/", en el selector de tipo de la barra y con **Ctrl/⌘+Alt+P** (Ctrl/⌘+Alt+Q ya es la cita del
  editor, y con AltGr, Q y E escriben "@" y "€" en los teclados en castellano). Se ve con un ícono de
  pregunta y un fondo suave; Enter al final sigue en un párrafo común. Su respuesta es un hilo de
  comentarios de ese bloque: el botón "Answer" (o "2 answers") abajo del texto abre el hilo o empieza uno.
  Así un invitado con Comentar contesta sin escribir la página. Script y pregunta no van juntos: cada ítem
  del selector pide las dos propiedades.
- **Una versión vieja con una pregunta:** el editor publicado no conoce `question`, así que muestra un
  párrafo común (la guarda contra lo desconocido revisa tipos y marcas, no propiedades, y no la bloquea).
  Si alguien edita esa línea en la versión vieja, se pierde solo la marca: el texto y el id del bloque
  quedan, y el hilo de respuestas sigue anclado (`src/ui/question.test.ts`, con el esquema de `main`).
  **Después de publicar esta versión, Lega sube `min_app_version` a ella** (regla de la sección 11 del
  plan); no lo hace la app ni la migración.

## Ciclo de sincronización

Nunca corren dos a la vez. En orden: los ajustes del workspace (ver abajo), los permisos propios (ver
"Permisos en el dispositivo"; si la base dice que sacaron a la persona, el ciclo termina ahí), cambios del árbol, los proyectos y sus páginas, contenido pendiente,
contenido nuevo, qué fotos y videos usa cada página que cambió (ver "Papelera de archivos"), imágenes
pendientes y comentarios (subir la cola y bajar los de las páginas abiertas).
Las imágenes y los comentarios van al final y sus errores no cortan el ciclo: una foto grande en una red
mala no frena el texto. Corre al abrir la app, un poco después de cada cambio, cada 10
segundos con la app a la vista, al volver la red y al volver a la ventana. Al final de cada ciclo arranca,
sin esperarla, la cola de fotos y videos, que tiene su propio ciclo (ver "Archivos grandes").

**Cada consulta a la base tiene un tope de tiempo** (`timed` en `remote.ts`, con `abortSignal`; también
las de los comentarios y las de la cola de fotos y videos). Sin él, una respuesta que no llegaba nunca (una
red que se corta a mitad de camino) dejaba el ciclo colgado para siempre, con `syncing` prendido y el
estado en "All synced" porque no quedaba nada sin subir, y como nunca corren dos a la vez, los siguientes
se colgaban del mismo hasta recargar. El tope es de 30 s más lo que tardaría lo que se manda a 16 KB/s
(`timeoutFor`; una subida de contenido de 8 MB, el máximo, tiene unos 12 minutos), así "lento" nunca se
vuelve "nunca". La bajada no sabe de antemano cuánto llega: pide lotes de hasta 500 updates con 30 s, y si
un lote vence, pide uno más chico (50, 5 y 1; de a uno tiene el tope más largo). Al vencer, la consulta
vuelve como un error de red (`request_timeout`) y la vuelta siguiente la reintenta: todo lo que se manda es
idempotente. **El vencimiento de una página no corta el ciclo:** se sigue con las demás (subir y bajar),
el estado lo avisa como último error (`request_timeout`) y la página no queda rechazada; se reintenta en
la vuelta siguiente. No cubre una espera adentro del cliente de sesión de Supabase (la renovación del token):
si se viera, haría falta un vigilante del ciclo en `engine.ts`. Pruebas en `src/sync/remoteTimeout.test.ts`.

**Los archivos de Storage no usan el tope fijo** (una foto grande en una red lenta puede tardar más), pero
desde v0.070 **las miniaturas sí tienen uno, proporcional** (hoy a Storage van solo miniaturas, de 480 px y
decenas de KB; los originales van al Drive por el portero), y desde v0.092 también las imágenes del bucket
`page-files` (un workspace sin portero). No pasan por `timed`: son una carrera contra el tope (`within` en
`remote.ts`), que termina en el mismo `request_timeout`.

| Pedido | Tope | Si vence |
|---|---|---|
| Subir la miniatura (`uploadThumb`) | `thumbUploadLimit`: la primera vez, `timeoutFor(tamaño)`, 30 s más lo que tarda a 16 KB/s (40 s para 160 KB; 62 s para 512 KB, lo máximo que acepta el bucket); después el doble, el triple… por cada vez seguida que venció (`thumbStalls`), hasta lo que tardaría a 2 KB/s (280 s para 500 KB) y como mínimo cuatro veces el primero | El archivo vuelve a la cola con su espera (10 s, 20 s… hasta 10 minutos) y el aviso *The upload stopped moving; it will try again*; la vuelta sigue con los demás. A la segunda trabada seguida, deja de subir (ver abajo) |
| Bajar la miniatura de otro dispositivo (`downloadThumb`) | 62 s (`THUMB_DOWNLOAD_TIMEOUT_MS`): no se sabe de antemano cuánto pesa, se le da lo de la más pesada posible | Al final de la vuelta: no se piden las demás miniaturas en esa pasada (los adjuntos, que no piden nada a Storage, sí se actualizan) y se vuelve a preguntar un minuto después del corte. Al dibujar la página: queda el ícono y se vuelve a preguntar |
| Subir una imagen de `page-files` (`uploadFile`) | `storageTimeout(tamaño)`: 30 s más lo que tarda a 16 KB/s, **sin el techo** de las consultas (una de 25 MB tiene 27 minutos) | Queda por subir con su error y la pasada sigue con las demás; a la segunda seguida, la pasada termina (`PageFiles.pushPending`) y las siguientes esperan antes de volver a probar (10 s, 20 s… hasta 10 minutos; desde v0.142). Las que vencieron van al final de la pasada siguiente |
| Bajar una imagen de `page-files` (`downloadFile`) | **30 s sin que llegue nada** (`FILE_IDLE_MS`: hasta la respuesta y entre un pedazo y el siguiente; desde v0.142) y, como techo, `FILE_DOWNLOAD_TIMEOUT_MS`: el de la más pesada que acepta el bucket (25 MB, 27 minutos) | Error de red: la imagen no se muestra y se vuelve a pedir al dibujarla |

- **Las subidas se cortan de verdad** (v0.092). `upload` del cliente de Storage (`@supabase/storage-js` 2.117)
  no acepta una señal de corte, pero cada pedido sale por el `fetch` del cliente, y cada `storage.from(bucket)`
  es un objeto nuevo con el suyo: `bucketWith` lo envuelve para que lleve la señal del tope. Antes la subida
  cortada quedaba suelta, y con Storage colgado para todos se acumulaban. Si la miniatura igual había llegado
  (se perdió la respuesta), no hace daño: no reemplaza (`upsert: false`), así que el reintento se encuentra con
  que ya está (409) y lo da por hecho; `thumb_at` se marca recién después de una subida confirmada. En
  `download` la señal se pasa como siempre.
- **No se marca ni se pierde nada:** la miniatura sigue por subir (`thumb: 'local'`), el original sigue en
  el dispositivo y todavía no fue al portero. `MediaRecord.thumbStalls` es un campo nuevo y opcional: una versión
  anterior no lo lee y usa el tope de siempre.
- **Por qué una sola no cuenta como "sin red"** (que corta la vuelta): la vuelta siguiente empezaría otra vez por
  el mismo archivo, porque van por orden de llegada, y con Storage colgado solo para él los demás no subirían
  nunca. **Dos seguidas sí** (v0.092): con Storage colgado para todos, cada archivo esperaba su tope entero (de 30
  a 62 s). La vuelta deja de subir archivos y la cola espera antes de volver a probar, igual que con el portero
  colgado (`Doc_Portero.md`, "Colgado para todos"). Lo mismo en `PageFiles.pushPending` con `page-files`. Una
  falla de red de verdad (el pedido falla en vez de colgarse) sigue cortando enseguida.
- **El minuto de la bajada se cuenta desde el corte,** no desde que se preguntó: el tope (62 s) dura más
  que esa espera (60 s), y contado desde el principio la vuelta siguiente volvería a pedir enseguida.
- **La bajada de `page-files` se corta por quietud** (v0.142). No se sabe de antemano cuánto pesa, así que antes su
  único tope era el de la más pesada (27 minutos) y una imagen chica de un Storage colgado frenaba "Available offline"
  todo ese rato. Ahora `withinIdle` corta a los 30 s sin que llegue nada: `bucketWatched` envuelve el `fetch` del
  cliente de Storage y avisa al llegar la respuesta y con cada pedazo del cuerpo (un `TransformStream`). Lenta no es
  colgada: una bajada que sigue recibiendo no se corta hasta el techo de siempre.
- **Las pasadas de `page-files` esperan** (v0.142). `pushPending` corre adentro del ciclo del motor: con Storage
  colgado para todas, cada ciclo esperaba dos topes enteros antes de los comentarios. Después de cerrar una pasada,
  las siguientes no prueban hasta su espera (`stallWait`: 10 s, 20 s… hasta 10 minutos), devuelven el mismo error
  (sigue a la vista) y siguen con lo demás del ciclo. Una imagen nueva acorta la espera a 10 s, volver la red la
  levanta (`networkBack`, el mismo aviso que la cola de archivos) y una imagen que sube la vuelve a cero.
- Pruebas: `src/sync/remoteTimeout.test.ts` (los topes, las subidas que se cortan, `page-files`, la bajada lenta que
  no se corta, la que se queda quieta a mitad y las pasadas que esperan) y
  `src/media/queue.test.ts`, "miniaturas que Storage no contesta" (lo que hace la cola).

## Permisos en el dispositivo

Desde la versión 4 de la base (`20260930160000_equipo.sql`) las páginas, el contenido y los proyectos se
ven y se cambian según `members` y `grants` (escala 0 nada, 1 ver, 2 comentar, 3 editar, 4 editar y crear
páginas). La base decide; la app hace la misma cuenta para no ofrecer lo que el servidor va a rechazar:

- **Qué lee:** en cada ciclo, su fila de `members` (rol y `removed_at`) y sus propias filas de `grants`
  (los admins ven las de todos: se piden solo las propias; las que tienen `revoked_at` no cuentan), más `workspaces.owner_id` de cada proyecto (va
  con `fetchProjects`). Se guarda en la base local (`meta.access`), así anda sin red. Una respuesta con
  otra forma tira error y no cambia lo guardado.
- **La cuenta** (`Permissions` en `access.ts`, igual que `private.page_level` y `private.project_level`):
  sin membresía activa todo da 0; quien creó el proyecto tiene 4 (solo siendo miembro activo); un permiso
  sobre el proyecto vale para todas sus páginas y uno sobre una página para ella y las de abajo, nunca para
  las de arriba; si hay varios, gana el más alto. Un proyecto creado en el dispositivo que todavía no
  volvió del servidor cuenta como propio. Uno cuyo creador no se sabe todavía (el de relleno antes de
  bajar la lista, o una copia de una versión anterior) cuenta como propio solo para el dueño y los admins:
  a los demás no se les ofrece crear ni renombrar hasta saberlo.
- **En la interfaz:** con menos de 3, el editor y el título quedan de solo lectura (y no se ponen la
  estructura inicial ni los ajustes de la rama). La reparación de dos raíces (`mergeRootGroups`) se hace
  solo en memoria, con un origen que no se guarda (opción `canWrite` de `PageDocs`, al abrir y al recibir
  cambios): el servidor la rechazaría en cada apertura. La estructura inicial (`seedIfEmpty`) se pone
  siempre que el editor quede editable, también sin datos de permisos (una base sin la versión del equipo,
  o la primera apertura sin red): sin ella el editor crearía su propia raíz. Queda solo en memoria hasta la
  primera edición (ver "Contenido de las páginas", punto 5); con menos de 4 no se ofrece crear páginas adentro, mover
  (tampoco arrastrar), mandar a la papelera ni restaurar; mover pide 4 en la página y en el destino.
  Crear proyectos, solo el dueño y los admins; renombrarlos, quien tiene 4 sobre el proyecto. "Members"
  (menú de la cuenta) lo ven el dueño y los admins, y "Share…" quien puede compartir (`private.can_share`).
- **Sin datos no se bloquea nada:** con una base anterior a la versión 4, o sin red la primera vez, todo
  queda como antes. Lo que el servidor rechace igual (por ejemplo, desde una versión vieja) va a los
  rechazados que muestra la barra lateral, con el motivo en palabras (`page_create_denied`,
  `page_move_denied`, `page_trash_denied`; editar sin permiso llega como `page_not_found`). Nunca se pierde
  en silencio. Si dejan de compartir una página con cambios sin subir, la página sale del árbol pero su
  contenido sigue en el dispositivo: el detalle de la sincronización ofrece "Download my unsynced changes"
  (el mismo archivo que la pantalla de "sacado").
- **Restaurar una copia con permisos:** lo que el dispositivo recupera no incluye páginas ni proyectos que
  la persona ya no puede crear (el servidor los rechazaría); se avisan en el estado de la sincronización y
  su contenido se puede bajar como archivo.
- **Miembros:** además de la gente, las invitaciones sin usar (`list_invitations`) con "Revoke"
  (`revoke_invitation`); con una base sin esas funciones, la lista no aparece. El link se copia dentro del
  mismo toque (Safari no deja después): `ClipboardItem` con la promesa del link, `writeText` de respaldo y,
  si nada anda, un campo para copiarlo a mano.
- **Invitaciones:** al entrar, antes de buscar el primer proyecto, la app llama a `accept_invitations()`
  (una base sin la función, un error o la falta de red no cortan la entrada). Con proyectos ya guardados
  no se espera, salvo que se venga de un link de invitación; también se llama al volver la red en la
  pantalla de "sin proyectos".
- **El link de invitación** es `https://<app>/#invite=<base64url de {"u","k","l","p"}>`: la dirección y la
  clave publicable del workspace, su clave local (`workspace_settings.local_key`) y la página o el
  proyecto. Lo que va después del `#` no llega a ningún servidor. Si es el workspace de la compilación
  (misma dirección y clave local), la app lo saca de la dirección, lleva al login y, después de entrar,
  abre la página (`src/invite.ts`). De otro workspace, pregunta antes de agregarlo (ver "Varios
  workspaces"). El link lleva además, opcional, el nombre del workspace (`n`), solo para mostrarlo en esa
  pregunta; las versiones anteriores lo ignoran.

## Varios workspaces

Paso 12 de `Plan_Workspaces.md`. El código está en `src/workspaces.ts` (la lista y todo lo que no es
pantalla), `src/ui/App.tsx` (qué se abre al arrancar), `src/ui/Welcome.tsx` (bienvenida, unirse, crear y
el diálogo de workspaces) y `src/ui/WorkspaceMenu.tsx` (el selector y quitar del dispositivo).

- **La lista del dispositivo** vive en `localStorage`, en `shotdocs-workspaces` (una clave nueva: ninguna de
  las de siempre cambia): de cada workspace la dirección, la clave publicable, la clave local, el nombre
  (`workspace_settings.name`, que se guarda al sincronizar) y cuál fue el último abierto. Hace falta antes
  de entrar y sin red. Al leerla se descarta una entrada rota, repetida (mismo id o misma dirección) o con
  una dirección o una clave publicable que no pasarían la revisión de "Unirse".
- **El de la compilación** (`SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`; en la dirección de Lega, Wanka)
  entra siempre a la lista al abrir la app, marcado como `legacy`: usa `legacyStorageNames` con la clave
  local fija `znlvpuddswymxpffgvbz`, así que su base local, su sesión y lo que recuerda la app se siguen
  llamando igual que siempre (pruebas en `src/workspaces.test.ts`). Su dirección y su clave salen siempre
  de la compilación: si Wanka se restaura en otro proyecto de Supabase y la app se publica con la dirección
  nueva, el dispositivo sigue con la base de siempre (y la generación hace el resto). Con compilación
  configurada siempre hay una entrada así, y cualquier otra con su dirección o con su clave local (una lista
  tocada o armada a propósito) se descarta al abrir: si no, Wanka abriría con otros nombres y Lega quedaría
  deslogueado y sin su base. No se puede quitar del dispositivo: volvería a entrar solo al abrir la app.
- **Los demás** usan `storageNamesFor(<clave local>)`: `shotdocs-auth:<clave>`, `shotdocs-last-user:<clave>`,
  `shotdocs-project:<clave>`, `shotdocs-last-pages:<clave>`, `shotdocs-invite-target:<clave>` y la base
  `shotdocs:<clave>:<usuario>` (con sus `:media` y `:comments`). Nada se renombra nunca. La página de un link
  de invitación se guarda con el nombre del workspace del link (la de Wanka, en `shotdocs-invite-target`,
  el de siempre): nunca se abre en otro workspace.
- **Sesión separada:** cada workspace tiene su cliente de Supabase y su sesión (`storage.auth`). **Cambiar
  de workspace guarda el elegido como el último abierto y recarga la app en el inicio** (`switchWorkspace`):
  así nunca hay dos clientes ni dos sincronizaciones andando a la vez en la misma pestaña, y no queda nada
  en memoria del anterior. Antes de irse, si algo no llegó todavía al dispositivo (texto, árbol, fotos o un
  comentario a medio guardar), espera; si hay cambios guardados sin subir (también las preferencias), lo
  avisa: quedan en el dispositivo y suben la próxima vez que se abra ese workspace.
  Otra pestaña puede seguir en otro workspace (cada base tiene su propio lock de pestaña).
- **Al abrir la app**, antes de crear ningún cliente: se arma la lista, se lee el link de invitación de la
  dirección (una sola vez, y se saca de ahí) y se abre el último workspace abierto. Sin ninguno (una
  publicación sin `SUPABASE_URL`, o después de quitar el último), la **pantalla de bienvenida**: *Join a
  workspace* o *Create my workspace*.
- **Unirse con un link:** se revisa que la dirección sea `https://` (solo la dirección, sin camino ni
  usuario, y el punto final del host se ignora; `http://localhost` solo con la app corriendo en la
  computadora), la clave publicable (`sb_publishable_…`; una `sb_secret_` se rechaza con un aviso, aunque
  el workspace ya esté) y la clave local (la forma de
  `workspace_settings.local_key`). Si la dirección es la de un workspace que ya está, se abre ese sin tocar
  nada. Si la clave local es la de otro workspace del dispositivo (también la de Wanka) con otra dirección,
  se rechaza: compartirían la base local, y un link armado a propósito mandaría lo sin subir de uno al
  servidor de otro. Si todo está bien, pregunta **"Join <nombre>?"** con el host del Supabase aparte y
  destacado: el nombre lo arma quien manda el link, así que se muestra sin comillas, saltos ni caracteres
  de control y recortado a 40 letras (también en la lista, hasta que la base da el suyo); uno con forma de
  dirección o de dominio (`/`, `:`, `@` o un punto seguido de letras) se descarta y queda "Join a
  workspace?". Al aceptar, lo agrega, lo abre y sigue al login, con la página del link pendiente para después de entrar.
  El link se puede abrir o pegar en *Join a workspace* (en la bienvenida o en el selector).
- **Crear:** la bienvenida (o *Create a workspace…* en el selector) enlaza la guía en el repo público
  (`Guide_Create_Workspace.md` en GitHub) y pide la dirección y la clave publicable que imprime el comando.
  La app lee `workspace_settings` (`name`, `local_key`, `schema_version`) con la clave publicable: sin la
  tabla o sin clave local, avisa que falta correr el comando; con una clave que no es de esa dirección, lo
  dice. **Hoy la base solo deja leer `workspace_settings` con sesión** (la política es para
  `authenticated`), así que la respuesta normal es "permiso denegado": entonces el workspace entra
  **pendiente** (id `pending.<azar>`, con la sesión en `shotdocs-auth:pending.<azar>`), el login pide el
  correo del dueño y, después de entrar, la app lee los ajustes con la sesión, pasa la sesión a los nombres
  de la clave local y recarga. Un pendiente nunca abre una base local, así que no hay nada más que mover.
  Si falta la clave local, lo avisa y ofrece quitarlo.
- **El selector Workspace › Proyecto:** con un solo workspace se ve igual que antes, más una línea al pie
  del selector de proyectos (*Join or create a workspace…*). Con varios, arriba de la barra lateral el
  nombre del workspace va antes del proyecto, y el selector tiene la sección *Workspaces* (cambiar, *Join a
  workspace…*, *Create a workspace…*). En el login, con más de un workspace (o uno que no es Wanka), se ve
  en cuál se entra y *Change* abre la lista.
- **Quitar un workspace del dispositivo** (*Remove “…” from this device…* en el selector, solo el abierto y
  nunca el de la compilación): cuenta lo sin subir como la pantalla de "sacado"; con cambios pendientes, el
  botón queda apagado hasta bajarlos con *Download my unsynced changes* y, uno por uno, cada original de
  foto o video sin subir (el archivo no los trae; la lista es la misma de la pantalla de "sacado"), o hasta
  que suban. Con confirmación, borra la base local de esa cuenta y después las de `:media` y `:comments`
  (si otra pestaña tiene abierta la principal no se borra nada; reintentar sigue desde donde quedó; si la
  base de fotos y videos no se pudo abrir, no se borra y se avisa: podría tener originales sin subir), lo que la app recordaba
  y la sesión, lo saca de la lista y recarga en otro workspace o en la bienvenida. Las bases de otras
  cuentas de ese workspace en el mismo dispositivo quedan (vuelven si se une de nuevo con esa cuenta). Sin
  sesión (desde el login) solo se ofrece quitar uno que no tiene ninguna base en el dispositivo (un
  pendiente, o uno al que nunca se entró). La pantalla de "sacado", al borrar, también lo saca de la lista.

## Si sacan a alguien del workspace

- **La señal es una sola:** la fila propia de `members` con `removed_at` (`isRemovedSignal`). Un error de
  red, un 500, una lista vacía, una respuesta rara o una base sin la versión del equipo nunca cuentan (hay
  pruebas de cada caso). Un error después de la señal tampoco la borra; volver a invitar a la persona la
  levanta en la próxima sincronización.
- Con la señal, el ciclo no sube ni baja nada más (tampoco la cola de fotos y videos, ni la recuperación
  tras restaurar una copia) y el árbol guardado no se vacía. La app muestra "You no longer have access to
  this workspace", también al abrirla sin red (la señal queda guardada).
- Si hay cambios sin subir (cola del árbol y rechazados, contenido, imágenes, fotos y videos), ofrece
  "Download my unsynced changes": un JSON con la cola del árbol, los updates de Yjs sin confirmar de cada
  página en base64 (más el estado entero y el texto, para leerlo sin la app), las imágenes pegadas en
  base64, la lista de fotos y videos pendientes con sus nombres y la cola de comentarios (con el motivo de
  los rechazados). Los originales de las fotos y los videos se bajan aparte, uno por uno.
- El archivo se arma por partes (un Blob de muchos pedazos, sin sangría) para no juntar todo en un solo
  texto en la memoria del teléfono.
- **No se borra nada solo.** "Remove from this device" cierra y borra la base local de ese workspace y
  usuario y, después, la de `:media` y la de `:comments` (en ese orden: si otra pestaña tiene la principal
  abierta no se borra nada; la de `:media` queda, con un aviso, si no se pudo abrir), olvida lo que la app recordaba de ese workspace (proyecto
  elegido, últimas páginas, el link de invitación pendiente) y cierra la sesión. Si otra pestaña tiene la
  base abierta, avisa que se cierren las otras pestañas y se reintenta (nunca queda colgado); con cambios sin bajar
  (el archivo o algún original de foto o video), pide confirmación antes. Sin cambios
  pendientes también espera que la persona toque el botón (a confirmar con Lega si ahí se borra solo).
  "Sign out and keep it on this device" deja todo como está.

## Una sola pestaña

Una sola pestaña o ventana usa la base local de un usuario a la vez (Web Locks). Si la app ya está abierta
en otra, esta lo avisa y espera; cuando la otra se cierra, se abre sola. Con dos escribiendo a la vez, cada
una tendría su propia cola y su propio documento en memoria.

## Estado visible

La barra lateral dice, en este orden de gravedad: si no se pudo guardar en el dispositivo, si no hay
conexión (y cuántos cambios quedaron guardados en el dispositivo), si el servidor rechazó algo (con
"Retry"), si hubo un problema al sincronizar aunque no haya nada pendiente, cuántos cambios faltan subir y,
si no hay nada de eso, que todo está sincronizado. Las fotos y los videos cuentan como cambios pendientes
(con el porcentaje de la subida en curso); los detenidos por un error cuentan como rechazados, con su
nombre y el error en el detalle. Lo mismo los comentarios: pendientes mientras no suben, rechazados (con la
página, el comienzo del texto y el motivo) si el servidor no los acepta.

## Sin red al abrir

- La app queda en caché con un service worker (PWA), así que abre sin red, en cualquiera de sus
  direcciones (`/`, `/p/<uuid>`, `/trash`; ver `index.md`).
- El editor, el carrete, el panel de comentarios y los diálogos se bajan aparte (`ui/lazyPart.tsx`), pero el
  service worker precachea todos los `.js` (`globPatterns` en `vite.config.ts`; menos el decodificador de
  fotos HEIC, que se guarda la primera vez que se usa: `Doc_Imagenes.md`, "Fotos HEIC"): con la app instalada, el
  editor abre sin red desde la caché. Al publicar una versión nueva, el service worker nuevo borra los
  archivos viejos; si una pestaña vieja pide uno, la app avisa ("A new version is available — reloading"),
  espera a que lo escrito esté guardado en el dispositivo y recarga una sola vez. Si queda algo sin guardar
  después de 8 segundos, o un comentario escrito sin mandar, no recarga sola: la parte muestra un aviso
  con "Reload" (en un diálogo, si es un diálogo o el carrete). Lo mismo si la persona se queda en el aviso
  del navegador. Volver a abrir la parte, o que vuelva la red, lo intenta de nuevo.
- Si la sesión venció y no hay red para renovarla, se sigue con el último usuario conocido y se renueva sola
  cuando vuelve la red.
- La app pide almacenamiento persistente (`navigator.storage.persist()`) para que el navegador no borre los
  datos locales.

## Cambios en el editor: nada que una versión vieja no entienda

Una versión vieja de la app puede seguir abierta en algún dispositivo (una pestaña que no se recargó, el
iPhone sin red). Si una página tiene un tipo de bloque (o una marca de texto) que su editor no conoce, el editor lo borra del
documento compartido al abrirla, y ese borrado se sincroniza a todos lados. Por eso todo lo nuevo en el
editor tiene que degradar en una versión vieja: una propiedad nueva en un bloque existente se ignora al
mostrar y, si esa versión edita el bloque, se pierde (el texto queda); un tipo de bloque nuevo, en cambio,
se borra entero. Así está hecho Script: un párrafo con
`script: true` (D-14), así las preguntas: un párrafo con `question: true` (ver "Comentarios y
preguntas"), y así las tarjetas de Drive: un párrafo con el link y `driveCard: true` (ver "Links de Drive").

Desde v0.021 hay dos protecciones para poder sumar tipos de bloque (y marcas) nuevos:

- **La guarda del editor** (`ui/unknownContent.ts`). Antes de abrir una página se revisa que todo lo que
  trae (tipos de bloque, contenido en línea, marcas de texto) esté en el esquema de esta versión. Si no,
  la página no se abre en el editor: se ve un aviso para actualizar la app, y nada se borra. Lo mismo con
  cada cambio que llega con la página abierta: se guarda en el dispositivo pero no entra al editor, que
  se cierra. Los atributos desconocidos de un bloque no cuentan: se ignoran sin borrar nada. Los nombres
  del esquema están escritos en el archivo (la sincronización revisa sin cargar el editor, que se baja
  aparte); una prueba los compara con el esquema real, así que un cambio de esquema o de BlockNote la hace
  fallar hasta actualizarlos. Un elemento llamado `doc` o `text` nunca pasa (y-prosemirror no los guarda
  así, y el editor lo borraría).
- **La versión mínima del workspace** (`workspace_settings.min_app_version`). Cada subida de contenido
  lleva la versión de la app, y el servidor rechaza las de una versión menor (también las de versiones
  anteriores a v0.021, que no mandan versión). La app vieja lo ve, deja de subir contenido (queda en el
  dispositivo), y pide actualizar; al actualizar, sube todo. Desde v0.097 tampoco sube el árbol ni los comentarios ni
  baja contenido, y se actualiza sola (ver "Volver después de mucho tiempo sin red"). Desde v0.090 frena también la cola de archivos (ver
  abajo, "La versión mínima y los archivos"), y desde v0.099 la base frena también el árbol y los comentarios de las
  versiones anteriores (ver abajo, "La versión mínima, el árbol y los comentarios").

**Regla para un bloque nuevo:** antes de publicar la versión que lo trae, subir `min_app_version` a la
primera versión con la guarda (0.021) o más, para que ninguna versión sin guarda pueda mandar el borrado.

### La versión mínima y los archivos (v0.090)

Hasta v0.089 la versión mínima frenaba solo el contenido de las páginas: `register_file`, `link_page_file` y
`unlink_page_file` no recibían la versión y la cola de archivos no miraba el aviso, así que una pestaña vieja seguía
registrando y subiendo archivos (por ejemplo, un HEIC sin pasar a JPEG, `Doc_Imagenes.md`). Ahora hay dos frenos:

- **La app se frena sola** (desde v0.090). El motor calcula en cada sincronización si esta versión es menor a la
  mínima (`status.outdated`) y se lo pasa a la cola (`MediaQueue.setOutdated`). Mientras tanto la cola no manda
  nada: no registra, no sube la miniatura ni el original al portero, no manda usos de páginas
  (`link_page_file`/`unlink_page_file`), no manda a la papelera de Drive (a mano ni el borrado automático) y no deja
  soltar una carpeta (se registra en el acto). Las imágenes sin portero (`sdfile://`) tampoco suben. Todo queda en
  el dispositivo y en la cola, contado como pendiente y **sin marcarse como error**; las bajadas de "Available
  offline" no lo esperan. Al actualizar, la versión nueva lo manda todo. Si la base responde `app_outdated` (subieron
  la mínima entre la consulta y el pedido), la cola deja el archivo como estaba, corta la vuelta y se ve el aviso.
- **La base frena a las versiones ya publicadas** (migración `20261006120000_version_minima_archivos.sql`, prueba
  `supabase/tests/version_minima_archivos_permisos.sql`). Las tres funciones tienen una versión con
  `p_app_version`, que la app usa desde v0.090 (si la base todavía no la tiene, usa la de siempre por 10 minutos y
  vuelve a probar). Las versiones anteriores no mandan nada que las identifique, pero solo ellas llaman a las
  funciones de siempre: esas dejan de andar (`app_outdated`) **cuando la mínima es 0.090 o más**. Con una mínima
  menor siguen andando, porque quien llama puede ser una versión permitida y rechazarla la rompería. Una versión
  vieja rechazada deja el archivo detenido en el dispositivo, con el error a la vista; al abrir la versión nueva,
  lo detenido se vuelve a intentar (`clearBlocked`) y sale.

**Para que frene a las versiones viejas:** aplicar la migración (con copia de seguridad), publicar la v0.090 y,
cuando Lega la tenga en sus dispositivos, subir `min_app_version` a 0.090 o más. 0.090 está escrito en
`private.files_version_allowed`: si esta versión se publica con otro número, se cambia ahí y en la prueba antes de
aplicar (`minVersion.test.ts` falla si no coincide con la entrada del changelog que nombra la migración). Si la app
abrió antes de la migración (usa la función de siempre por 10 minutos) y la base le contesta `app_outdated`, repite
el pedido una vez con versión. El portero no recibe la versión: una versión vieja con un archivo ya registrado puede terminar de subir su
original, que no cambia nada de lo que la base sabe del archivo. Un HEIC que una versión anterior a v0.075 guardó
sin la marca de convertir se registra tal cual cuando la app se actualiza: el freno lo demora, no lo convierte.

### La versión mínima, el árbol y los comentarios (B.17, v0.099)

Desde v0.097 la app se frena sola, pero una versión anterior abierta seguía subiendo los cambios del árbol (crear,
renombrar, mover, papelera, formato, ícono, proyectos nuevos y sus nombres) y los comentarios aunque estuviera por
debajo de la mínima: la base no sabía qué versión los mandaba.

**Cómo escribe hoy la app** (relevado en `remote.ts` y `commentsRemote.ts`): el árbol va **directo a las tablas** con
Row Level Security (`pages`: `upsert` al crear, `update` con el cambio; `workspaces`: `upsert` al crear un proyecto,
`update` al renombrarlo). Los comentarios van por **funciones** `security definer` (`add_comment`, `import_comment`,
`edit_comment`, `delete_comment`, `resolve_thread`), que son las únicas que escriben `comments`.

**Opciones que se miraron:**

1. *Funciones nuevas con `p_app_version`* (como los archivos): pasar todo el árbol a funciones (crear página, cambiar
   página con cualquier combinación de campos, crear y renombrar proyecto) que repitan los permisos y los triggers de
   las políticas, y cerrar la escritura directa a quien no las usa. Es reescribir la escritura del árbol y duplicar los
   permisos en otro lado: mucho riesgo para lo que se gana.
2. *Un header con la versión*: la app nueva manda `x-shotdocs-version` en cada pedido a la base (opción `global.headers`
   del cliente de Supabase; PostgREST lo deja en `current_setting('request.headers')`). Una política **restrictiva**
   de `insert` y `update` en `pages` y `workspaces` y un trigger en `comments` lo miran. No cambia ninguna firma ni
   ningún cuerpo de función, no toca los permisos que ya hay y no depende de nada central (cada base lo hace sola).
3. *Una columna con la versión en cada fila*: obliga a migrar antes que la app (una base sin la columna rechaza el
   pedido) y ensucia las tablas.

**Elegida: la 2.** Es la más chica y la base sin la migración ignora el header. La regla es la misma que la de
archivos: con header, se compara su versión con la mínima (`private.app_version_allowed`); sin header (solo lo
mandan las versiones desde v0.099), se rechaza **solo cuando la mínima es 0.099 o más**, porque con una mínima menor
quien llama puede ser una versión permitida (la v0.098 publicada no manda header). Lo hacen
`private.write_version_allowed()` y `private.require_write_version()`. Las funciones de proyectos que usa la app
(`set_project_archived`, `delete_project`, `restore_project`) no pasan por las políticas: lo miran adentro, después
de los permisos y solo cuando van a escribir (`private.require_session_write_version()`, que como el trigger mira
solo los pedidos de una sesión de la app).

**Cómo se rechaza, para no perder nada:** con un error de PostgREST de estado **503** (`raise sqlstate 'PGRST'`) y
mensaje `app_outdated`. Todas las versiones publicadas tratan un 503 como pasajero: el cambio del árbol **queda en su
cola** (la ronda se corta ahí y se reintenta en la próxima) y el comentario **queda pendiente**; nada pasa a la lista
de rechazados, donde la versión vieja ofrecería *descartarlo*. Al actualizar, la versión nueva lo sube en el orden de
siempre. Con un 400 (como `push_page_update`) la versión vieja lo marcaba rechazado y un renombre o un movimiento
quedaban a un clic de perderse. Un comentario o una página ya rechazados por otra razón no cambian.

**La versión nueva:** si la base contesta `app_outdated` a un cambio del árbol (subieron la mínima entre la consulta y
el pedido), el cambio queda en la cola, la ronda se corta y se ve el aviso de actualizar (`status.outdated`); en la
cola de comentarios, el comentario queda pendiente y la vuelta se corta sin error. Archivar, borrar o restaurar un
proyecto, o crear el primero, dicen *This workspace needs a newer version of the app…* en vez del código. Al abrir,
vuelve a poner en la cola
los cambios del árbol que una versión anterior dejó rechazados con `app_outdated` (por si alguna base contestó con
otro estado). El servidor en memoria (`src/sync/testing.ts`) sigue la misma regla (`FakeServer.writeVersionSince`,
`FakeRemote.versionHeader`).

**Qué no frena:** compartir e invitar y la papelera de archivos, que van por funciones sin versión; son acciones con
red y en el momento, no colas. Un header alto falso pasa: la mínima es una guarda de compatibilidad, no de seguridad
(quien puede editar puede escribir igual por la API), y una app vieja de verdad no manda el header.

**Otros workspaces (D-18):** el CORS de la base tiene que aceptar el header `x-shotdocs-version` (ver
`Doc_Supabase.md`); si no, el navegador corta todos los pedidos de la app (nada se pierde: queda en el dispositivo).

**Las colas publicadas:** `src/sync/offlineLargo.test.ts` prueba la cola de comentarios de la v0.098 copiada sin tocar
(`src/sync/fixtures/v098/comments.ts`): con el 503 el comentario queda pendiente, sin rechazados, también al cerrar y
abrir, y sale con la cola de hoy al actualizar. Esa versión muestra el código `app_outdated` como error del comentario
(no lo conoce); desde v0.099 sale en palabras.

**Aplicada el 2026-10-02 con la v0.099, y la mínima subida a 0.099 ese día.** **Para que frene:** aplicar `20261008120000_version_minima_arbol.sql` (con copia de seguridad), publicar la v0.099 y,
cuando Lega la tenga en sus dispositivos, subir `min_app_version` a 0.099 o más. 0.099 está escrito en
`private.write_version_allowed` y en la prueba: quien publica pone el número real en los dos (la migración no corre
con el número provisional) y `src/sync/writeVersion.test.ts` falla si no coincide con la entrada del changelog que nombra la
migración. No sube `schema_version`: la app no necesita saber si la base la tiene.

## Barreras de error (v0.147)

Hasta acá la única barrera de error de React era la de las partes que se bajan aparte (`lazyPart.tsx`, que solo explica
lo que no bajó). Si el editor tiraba una excepción al dibujar una página (una forma que nadie previó, un bug), React
desmontaba todo: la app quedaba en blanco. La auditoría del link *Can edit* (`Doc_Link_Publico.md`, B3) armó 3 filas
que lo hacían: un `Y.Map` adentro de un párrafo (`text.toDelta is not a function`) y el `level` de un encabezado como
objeto o `'x y'` (`"h[object Object]" is not a valid element local name`). Ahora hay tres (`src/ui/ErrorBarrier.tsx`):

- **La de la página** (`PageBarrier`, en `PageView.tsx`, alrededor del editor): falla solo el cuerpo de la página; el
  título, el árbol, la barra, *Share* y el resto siguen. En su lugar, *This page can't be shown right now*. Quien puede
  ver el historial (`canSeeHistory`) tiene *Version history* y *Try again*; quien no (un visitante con link, un
  invitado, quien solo ve), solo *Try again*. En la consola, una vez: `[barrera] La página <id> no se pudo mostrar`
  con el error.
- **La del workspace** (`WorkspaceBarrier`, en `Workspace.tsx`, debajo de los servicios): *Something went wrong* con
  *Reload*. La base del dispositivo y la sincronización quedan vivas arriba, así lo pendiente sigue subiendo y la
  pantalla dice cuántos cambios faltan (`usePendingCount`). Mientras se ve, pide confirmación al cerrar o recargar con
  algo todavía sin guardar en IndexedDB (lo mismo que la app) y la recarga por versión nueva lo espera
  (`watchPendingWrites`).
- **La de la raíz** (`AppBarrier`, en `main.tsx`): lo mismo para lo que pase fuera de un workspace (entrar, la
  bienvenida), sin contar nada (no hay servicios para leerlo sin riesgo).

**Sin bucles:** ninguna vuelve a montar sola lo que acaba de tirar; solo *Try again*, restaurar una versión o cambiar de
página (la de la página se reinicia con el id). **Nada se borra:** las barreras no tocan IndexedDB ni las colas; *Reload*
es el de los avisos de siempre (`reloadByHand`, que pregunta si hay un comentario sin mandar).

**Restaurar sin el editor.** Con el aviso a la vista, el historial restaura sobre el documento de la página
(`restoreInDoc` de `historyRestore.ts`): la misma ida y vuelta que el editor (`versionNode`, con el esquema del editor
que muestra la versión, que el historial pasa en `requestRestore`) y después **el mismo algoritmo con que el editor pasa
lo suyo a Yjs** (`updateYFragment` de y-prosemirror): conserva los bloques iguales y, en los distintos, cambia solo
atributos y texto. Los bloques de arriba que ya se leen igual que en la versión se anotan como emparejados antes
(`unchangedBlocks`, sobre una copia) y `updateYFragment` los salta: sin eso, un bloque sin los atributos por defecto
escritos (de una versión vieja o de una importación) los recibía todos aunque no hubiera cambiado, y el historial lo
mostraba como «formato cambiado» (R2; `restoreInDocDefaults.test.ts`). Así lo que otro dispositivo escribió sin red o a la vez sigue estando cuando llega, como al restaurar
por el editor (la primera versión reemplazaba el grupo entero y lo perdía: 0 de 200 casos al azar contra 50 de 50 por el
editor; auditoría, B1). Se prueba primero en una copia en memoria; si no da igual a la versión, no se escribe ni sube
nada. Es una edición local más: se guarda, sube y el historial la muestra. No tiene **Undo** en el aviso (el editor que
se monta después no la tiene en su pila); para volver atrás se restaura otra versión. Si *Restore* llega mientras la
barrera todavía abre el documento, el historial la espera (`restoreTargetSettled`). La vista de una versión en el
historial tiene su propia barrera: si la actual es la que rompe, se ve *This version can't be shown* y se elige otra.

**Exportar a PDF o zip** no necesita barrera: el editor de exportación vive en su propia raíz de React, fuera de la app,
y una página que lo hace tirar se saltea con su motivo mientras las demás salen (`exportPages.ts`; probado con las tres
filas en `src/export/exportHostile.test.tsx`). Pruebas de las barreras: `src/ui/errorBarrier.test.tsx`,
`src/ui/restoreInDoc.test.tsx`, `src/ui/restoreInDocCheck.test.ts` y `src/ui/restoreInDocDefaults.test.ts`.

## Volver después de mucho tiempo sin red

El caso: alguien trabaja semanas sin red con una versión de la app (un rodaje) y mientras tanto se publican otras,
quizás con `min_app_version` subida. Qué pasa, paso a paso:

1. **Sin red.** Todo queda en el dispositivo: el contenido en IndexedDB (`docUpdates` y la marca de sin subir), los
   cambios del árbol en su cola (`ops`), las fotos en `<base local>:media` y los comentarios en su base. Nada vence con
   el tiempo, y cerrar la app (o que el sistema la mate) no pierde nada: al abrirla sigue igual.
2. **Vuelve la red con la versión vieja.** El primer ciclo lee los ajustes del workspace antes que nada. Si la mínima es
   más alta que la versión, la app queda "vieja" (`status.outdated`, el aviso *Update the app* con lo pendiente):
   - **no sale nada del dispositivo:** ni el árbol, ni el contenido, ni las imágenes, ni las fotos y videos, ni los
     comentarios; todo sigue en sus colas, contado como pendiente y sin marcarse como error. Lo que no pasa por estas
     colas sigue andando con la app vieja: una carpeta (P.9) que ya se estaba subiendo sigue llevando su contenido al
     Drive por el portero (soltar una nueva no se puede: se registra en el acto y la cola lo frena), y las acciones
     directas contra la base (restaurar de la papelera, archivar o borrar un proyecto, compartir, invitar) siguen;
   - **no se baja contenido** (sí el árbol): lo escrito con una versión más nueva puede tener una propiedad que el
     editor viejo no conoce y que sacaría al editar ese bloque, y ese cambio saldría al actualizar. Las páginas que
     nadie más cambió siguen editables; las que cambiaron en el servidor se abren en solo lectura, con un aviso de
     actualizar (*This page has newer changes…*), como una página a medio bajar. Si una página se abre antes de que
     termine el primer ciclo, la app pregunta la versión antes de bajarla (`prefetchPage`; si esa pregunta falla por
     la red, baja como antes). Mientras tanto, la búsqueda del proyecto y *Reemplazar* dicen que esas páginas tienen
     cambios más nuevos (no que se están bajando), y el editor no vuelve a mirar cada segundo si llegaron.
   Sin la mínima subida, la versión vieja sube todo directo, como cualquier vuelta de red.
3. **La app se actualiza.** El navegador busca el service worker nuevo al abrir la app y, en Chromium, también unos
   segundos después de volver la red (medido con la app instalada en un Chromium sin interfaz). Además, con la app vieja
   para el workspace, la app se lo pide (`registration.update()`) apenas lo sabe y al volver la red. Desde el arranque
   (`main.tsx`) anota si una versión nueva tomó el control de la pestaña, también antes de entrar a un workspace, y con
   la versión nueva al mando y esta vieja **recarga sola**, con las protecciones de la recarga por versión nueva (espera
   a que lo escrito esté guardado, nunca encima de un comentario sin mandar, nunca en bucle: una por minuto). Si en ese
   momento hay algo sin guardar no avisa nada y vuelve a probar con los cambios del estado de sincronización; el aviso
   *A new version is available — reloading* sale recién cuando de verdad va a recargar. *Update now* espera a que la
   versión nueva tome el control antes de recargar (recargar antes abría otra vez la vieja desde la caché). Si el
   navegador **empezó a instalarla y no pudo** (el service worker nuevo pasa a `redundant`: un teléfono sin espacio,
   una red que corta la descarga del precache), no se ofrece forzar, porque la causa sigue y forzar dejaría el
   dispositivo sin ninguna versión para abrir sin red: el estado dice que libere espacio o busque mejor conexión y
   vuelva a tocar *Update now*. Cada instalación se sigue desde que empieza (`updatefound`, desde v0.099): también la
   que empezó el navegador solo y la que falla antes de que *Update now* la mire, que antes parecía un navegador que
   nunca empezó a instalar y ofrecía forzar. Solo si el navegador **nunca empezó** a instalar nada y el servidor publica otra versión
   (lee `/index.html?version-check=…` sin caché; si el servidor redirige a `/`, `fetch` sigue la redirección), el estado
   ofrece **Force the update**: saca el service worker y recarga desde el servidor, sin tocar lo guardado en el
   dispositivo. Antes exige todo guardado, red (comprobada leyendo la versión publicada justo antes) y lugar libre en
   el almacenamiento del navegador para el precache con holgura (`FORCE_FREE_BYTES`, 10 MB; sin saberlo, no fuerza).
   Después de forzar, mientras ningún service worker tome la app, el estado avisa fijo que todavía no abre sin
   conexión. Una segunda versión que
   toma el control antes del minuto de la anterior no se recarga sola (la guarda contra bucles): queda *Update now*.
   Código: `src/ui/appUpdate.ts`.
4. **La versión nueva abre la misma base local** (mismo nombre y misma versión de IndexedDB; lo nuevo de cada versión
   son campos opcionales, ver "La misma base con una versión anterior de la app") y sube todo en el orden de siempre:
   el árbol (una página existe antes que su contenido), el contenido (la diferencia con `syncedSV` y los borrados que
   faltan), las fotos (registro, miniatura, original al Drive y usos) y los comentarios. Lo de los demás se baja y se
   fusiona con Yjs: nada de los dos se pierde.

**Las versiones anteriores a v0.097** (por ejemplo la v0.090) frenan solo el contenido y los archivos, y bajan el
contenido nuevo. Los cambios del árbol y los comentarios los frena la base desde v0.099, pero solo con la mínima en
v0.099 o más (ver "La versión mínima, el árbol y los comentarios"): con una mínima menor todavía los suben. No se
pierde nada propio; lo único que puede pasar es que, si se edita con esa versión un bloque que otra más nueva marcó
con una propiedad nueva, la propiedad se pierda (el texto no), que es lo que acepta la regla de "Cambios en el
editor".

**Lo que garantiza la prueba** (`src/sync/offlineLargo.test.ts`, con la sincronización de la v0.090 copiada sin tocar
en `fixtures/v090/`: motor, contenido, árbol, base local e imágenes; las colas de fotos y de comentarios son las de hoy,
cuya base no cambió de versión desde la v0.090): dos semanas de reloj simulado, A con la v0.090 y sin red escribe,
borra renglones, agrega fotos, crea una página, mueve otra, renombra, comenta, intenta sincronizar sin red y el sistema
le cierra la app; B, con la versión nueva, edita las mismas páginas y otras, crea una con foto y comenta, y se sube la
mínima. Al volver, la v0.090 avisa, no sube contenido ni fotos y conserva todo; al actualizar (el código de hoy sobre
la misma base) sube todo, y A, B y un dispositivo nuevo quedan iguales al servidor, con todo lo de los dos, sin nada
pendiente ni rechazado. Lo mismo sin subir la mínima (la v0.090 sube directo), y con la mínima en v0.099 y la base
que frena el árbol y los comentarios (la v0.090 no sube nada, no marca nada rechazado, ni al cerrarla y abrirla, y al
actualizar sale todo; `src/sync/writeVersion.test.ts` prueba además la carrera con la versión nueva, la base sin la
migración y el 503 del cliente de Supabase). Con la versión actual que queda vieja,
además, no sale ni se baja nada (fallaba antes de este cambio). Y variantes al azar (`OFFLINE_LARGO_SEEDS`, 6 en la
suite; pasaron 40) con días, ediciones, borrados, agregados a un renglón, fotos, páginas nuevas, renombres, movimientos,
cierres de la app y la mínima que sube o no, con la v0.090 (también con la base que la frena: ahí A comenta) y con la
versión actual que queda vieja (esa además comenta y sigue trabajando con red antes de actualizar; con la base que
frena, pasaron 40). `src/ui/appUpdate.test.ts` prueba la recarga, *Update now*, la instalación que falla y forzar.

**Qué no puede ver esta prueba** (los fixtures): copia el motor, el contenido, el árbol, la base local y las imágenes de
la v0.090, pero usa los tipos, `remote.ts`, los permisos, los textos y las colas de fotos y de comentarios de hoy. Prueba
bien que la base local que deja la v0.090 la lee el código nuevo y cómo se porta el motor viejo; no puede detectar un
cambio del protocolo con la base (funciones o columnas que un cliente viejo pide) ni el comportamiento de la cola de fotos
de la v0.090. Un cambio futuro en `types.ts` o en `Remote` puede obligar a tocar los imports de los fixtures.

**Lo que no cubre:** el service worker en Safari del iPhone (solo se midió Chromium); la conexión con Drive en modo
Testing de Google vence a los 7 días, y entonces los originales esperan en la cola (sin perderse) hasta reconectar Drive;
una sesión que no se pudiera renovar pide entrar de nuevo (lo del dispositivo queda en su base); y en un iPhone, Safari
puede borrar los datos de una web **no instalada** que no se abre en 7 días: instalada no, y la app pide almacenamiento
persistente.

## Links de Drive

Pegar en el editor un link de Google Drive (paso 13 de `Plan_Workspaces.md`) lo pega como siempre, un
texto con el link, y abre al lado del cursor un menú chico, **Paste as**: **Link** (queda así), **Text** (el
mismo texto sin el link: el título si se copió un link con título, si no la dirección) o **Card** (una
tarjeta con el reproductor de Drive). Se elige con el mouse, con el dedo o con las flechas y Enter; Escape,
tocar afuera o seguir escribiendo lo cierran y queda el link. Solo aparece si lo pegado es un link de Drive
solo (en texto, o un link solo en HTML); cualquier otra cosa se pega como siempre. Código:
`ui/driveLinks.ts` (reconocer el link y sacar el id), `ui/drivePaste.ts` (qué se pegó y qué hace cada
opción), `ui/DrivePasteMenu.tsx` (el menú), `ui/driveCard.ts` (la tarjeta) y `ui/drive.css`.

- **Links que reconoce:** `drive.google.com/file/d/<id>/…` (también con `/u/<n>/`), `/open?id=<id>`,
  `/uc?id=<id>`, carpetas `drive.google.com/drive/folders/<id>` (también `/u/<n>/` y `/mobile/`) y
  `docs.google.com/<document|spreadsheets|presentation|drawings>/d/<id>/…`, siempre con `https`. El id
  solo puede tener letras, números, `_` y `-` (10 a 128). Se guarda la `resourcekey` de los links
  compartidos, que Drive pide para verlos (validada igual que el id en todas las direcciones que se arman).
  **Los formularios de Google (`docs.google.com/forms/…`) no se reconocen:** se pegan como link común y
  nunca son tarjeta, para que un formulario no pueda parecer parte de la app.
- **La tarjeta es un párrafo con el link y `driveCard: true`** (nunca un tipo de bloque nuevo, D-14). Si el
  link estaba solo en su línea, esa línea pasa a ser la tarjeta; si estaba en medio de un texto o en una
  tabla, sale de ahí y la tarjeta va debajo del bloque. Arriba, el reproductor de Drive; abajo, el pie con
  el link (el texto del párrafo, que se edita como cualquier texto) y **Open in Drive**. **Show as link** (solo
  con permiso de edición) la vuelve un link común, igual que pasarla a párrafo, Script o pregunta desde el
  menú "/" (la tarjeta no va junto con Script ni con pregunta). Al copiar a otro programa sale el link
  (`<p class="drive-card-line">`), y al pegarlo en la app vuelve a ser tarjeta. La importación de Coda usa esa
  misma marca para lo que en Coda era un embebido de Drive (`Doc_Importar_Coda.md`, "Direcciones sueltas").
- **El iframe:** la dirección se arma con una plantilla fija y el id (`https://drive.google.com/file/d/<id>/preview`;
  una carpeta, `drive.google.com/embeddedfolderview`; un documento, `docs.google.com/<tipo>/d/<id>/preview`),
  nunca con el link tal cual: un link que no es de Drive, o con un id raro, deja un párrafo común.
  `sandbox="allow-scripts allow-same-origin allow-popups allow-storage-access-by-user-activation"` (el
  reproductor necesita sus scripts y la sesión de Google; es de otro origen, así que no ve nada de la app;
  los popups, para el botón de Drive que abre el archivo, que queda con las mismas restricciones: sin
  `allow-popups-to-escape-sandbox`, porque para abrirlo en una pestaña normal está **Open in Drive** en el
  pie; sin `allow-forms` ni `allow-top-navigation`), `allow="fullscreen"`, `referrerpolicy="no-referrer"` y
  `loading="lazy"`. Anda si quien mira tiene acceso al archivo con su cuenta de Google: la app no ve el
  archivo ni los permisos.
- **`referrerpolicy="no-referrer"` falta confirmarlo a mano:** que el reproductor cargue un video privado y
  uno compartido por link en Chrome, Safari y el iPhone. Si Drive no carga sin referrer, se cambia a
  `strict-origin` (manda solo el dominio de la app, nunca la dirección de la página) en `playerFrame`
  (`ui/driveCard.ts`) y en la prueba de `ui/driveCard.test.ts` que lo afirma.
- **Safari y el iPhone:** bloquean las cookies de terceros (en el iPhone y el iPad, todos los navegadores,
  que usan el motor de Safari), así que el reproductor no tiene la sesión de Google de quien mira: un
  archivo privado pide iniciar sesión y en general solo andan los **compartidos por link**. Por eso:
  - En esos navegadores la tarjeta muestra debajo del reproductor el aviso discreto *In Safari and on iPhone,
    only files shared by link may play here* con **Open in Drive** (`blocksThirdPartyCookies` en
    `ui/driveCard.ts`), y el tooltip de **Card** en el menú lo dice.
  - **Open in Drive** en el pie es un botón bien visible (abre Drive en otra pestaña, con la sesión normal).
  - Si el reproductor, ya en pantalla, no termina de cargar en 15 segundos, aparece el aviso *The Drive
    player didn't load* con **Open in Drive**. Un reproductor que carga pero pide iniciar sesión no se puede
    detectar (es de otro origen): para eso quedan el aviso de Safari y el botón del pie.
  - `allow-storage-access-by-user-activation` deja que el reproductor, después de un toque, le pida al
    navegador su propia sesión (API Storage Access). **Solo ayuda si Drive la pide**, y hoy no está
    documentado que lo haga: no hay que contar con eso. No le da acceso a nada de la app.
- **Tamaño:** todo el ancho del texto (en una hoja, el ancho de la hoja) con proporción de video y a lo sumo
  480 px o el 70 % del alto de la pantalla; un documento o una carpeta, 4:3. Al imprimir queda solo el link.
- **Sin red** la tarjeta muestra el link y el aviso *You're offline*; el reproductor carga solo cuando
  vuelve la red.
- **En el teléfono** una tapa transparente sobre el reproductor deja deslizar la página sin que el iframe se
  quede con el scroll; un toque (*Tap to use the player*) la saca hasta tocar afuera de la tarjeta.
- **Solo lectura:** la tarjeta se ve igual y el link se abre; no aparece **Show as link** y no se pega nada.
- **Una versión vieja** (sin la propiedad) muestra el párrafo con el link. Si edita esa línea, la propiedad
  se pierde y quedan el texto, el link y el id del bloque; si pega una tarjeta copiada
  (`drive-card-line`), queda un párrafo con el link. La guarda de `ui/unknownContent.ts` revisa tipos y
  marcas, no propiedades, así que no la bloquea. Lo prueban `ui/driveCard.test.ts` con un esquema anterior a las tarjetas
  (`ui/fixtures/editorSchemaSoloScript.ts`), `ui/driveLinks.test.ts` y `ui/DrivePasteMenu.test.tsx`.
- **El fixture se actualiza en cada publicación:** `ui/fixtures/editorSchemaMain.ts` es la copia del
  `ui/editorSchema.ts` de `main`. Al publicar, se reemplaza por el de la nueva `main` (entonces ya con
  `driveCard`), para que las pruebas sigan comparando contra la versión publicada.
- **Después de publicar** la versión con las tarjetas, subir `workspace_settings.min_app_version` a esa
  versión (regla de la sección 11 de `Plan_Workspaces.md`): así ninguna versión anterior vuelve a sacarle la
  propiedad a una tarjeta al editarla.
- **La copia liviana de un video** (para verlo sin el reproductor de Drive) queda para más adelante, solo si
  hace falta: sin un servidor que convierta videos, se haría en el navegador.

## Quien no ve lo borrado baja bases limpias

`Doc_Privacidad_Borrado.md` (D14). Con el interruptor del workspace prendido (`clean_min_version`, versión 12 de la
base), quien no ve lo borrado de una página (menos que Editar, o invitado: `SyncEngine.isBaseReader`) no recibe filas
sino la última **base limpia**: la página entera con lo borrado como hueco. Para ese dispositivo "al día" es llegar a
`pages.clean_seq` (`PageTree.serverSeq`, `contentGap`): lo usan el ciclo, `isMissingContent`, *Available offline*, la
búsqueda y el reemplazo del proyecto. Sin base todavía, la página está "en preparación" (solo lectura, sin semilla).

- **Bajar:** la base llega como una fila con `seq = to_seq`. Si el dispositivo no tiene nada sin subir y la base cubre
  todo lo guardado, lo reemplaza en la misma transacción (`applyRemote`); si no, se suma como una fila más.
- **Armar** (dispositivos de quien edita, desde la versión del interruptor): al final de cada ciclo, si hubo actividad
  en los últimos 5 minutos (o cada 2), `clean_work` dice qué páginas con lectores toca armar (sin base, o 20 s × f sin
  escribir, o 2 minutos × f escribiendo); el dispositivo arma solo las que tiene exactamente como el servidor, con las
  dos comprobaciones, como mucho 20 por vuelta. Al pasar a segundo plano (`appHidden`), sin esperar. Sus errores no
  cortan el ciclo.
- **Compartir, invitar y mover** suben antes lo pendiente de las páginas alcanzadas (`uploadPagesFirst`; mover, desde
  la cola del árbol) y después arman las bases enseguida (`prepareBases`, que pide de a 50 a `clean_work` hasta que no
  queda ninguna).
- **Un invitado con Editar** sube sus filas como siempre; su cursor queda por delante de la base y baja la siguiente.
- **La subida no cambia** (D15, D19).

## Lo que escribe un link público (*Can edit*, entrega 2a)

`Doc_Link_Publico.md`, "Entrega 2". Con el interruptor `link_edit_min_version` prendido (versión 19 de la base):

- **El visitante** es un invitado con Editar sobre la página del link y sube con el motor de siempre (IndexedDB
  primero, la cola se vacía solo con la confirmación), pero a la **sala de espera** (`plink_push_page_update`), que
  devuelve 0: la confirmación sube `syncedSV` y no mueve el cursor. Sigue siendo un lector de bases: lo suyo vuelve con
  la base siguiente, cuando un editor lo admitió (Yjs no duplica nada). Sin el nombre del visitante no sube (queda en el
  dispositivo y el ciclo sigue); una subida armada de más de 1 MB no se manda y la página queda rechazada, y la primera
  edición guardada de esa página (deshacer el pegado) la vuelve a intentar (`linkVisitor` en el motor,
  `clearRejectedPage`). La subida sin GC llega hasta 1 MB (`noGcMaxBytes`). Mientras algo espera, una vez por ciclo,
  `plink_push_status` dice qué espera y qué se apartó.
- **La admisión** la hace el dispositivo de quien arma las bases, en `buildCleanBases` y antes de `clean_work`
  (`LinkAdmission` en `src/sync/linkAdmit.ts`): las páginas con algo para decidir (sin bytes); de esas, las que tiene
  exactamente como el servidor (cursor en `update_seq`, nada sin subir, nada rechazado ni ilegible) y sin una edición
  local en los últimos 20 s; los bytes solo de esas; la prueba (`src/sync/admit.ts`, sobre `docs.savedRows`) y la
  decisión. Si la base decide distinto, se corta esa página y se vuelve a probar en la vuelta siguiente; lo probado que
  no se pudo mandar (sin red) se manda en la siguiente sin volver a bajarlo. Si entró algo, la base de esa página sale
  con la cadencia de siempre. Sus errores no cortan las bases.
- **Lo admitido** es una fila común de `page_updates` (`created_by` nulo, `plink_author`): baja, se compacta y se ve en
  el historial como cualquiera. Lo apartado y lo que espera nunca están en `page_updates`.

## Restaurar una copia de seguridad: la generación

Las copias de seguridad de la base (`Plan_Workspaces.md`, sección 7) se pueden restaurar, pero lo que se
hizo después de la copia solo queda en los dispositivos, que además creen que el servidor ya lo tiene.
`workspace_settings.generation` resuelve eso:

- La restauración le pone a la generación un valor que no se haya usado nunca (la hora en minutos, o la
  actual más uno si es mayor): así también se nota restaurar dos veces la misma copia. Lo hace el script
  de restauración del repo de copias.
- Solo funciona si se restaura **sobre el mismo proyecto de Supabase**: lo guardado en cada dispositivo
  lleva el proyecto en el nombre (`Plan_Workspaces.md`, sección 7).
- Cada dispositivo guarda la última generación que vio. Al ver una distinta, antes de sincronizar: vuelve
  a poner en la cola los proyectos y las páginas que el servidor ya no tiene (primero los padres) y los
  cambios a páginas que vio más nuevos que lo restaurado, todo antes de lo que ya estaba en la cola sin
  subir (que es más nuevo y va después); marca todo su contenido para volver a subirlo
  entero (Yjs no duplica lo que el servidor ya tiene) y bajarlo desde el principio; y vuelve a poner en la
  cola todas sus imágenes (las que el servidor todavía tiene no se vuelven a mandar). Recién después guarda
  la generación nueva: si la app se cierra en el medio, la próxima vez hace todo de nuevo.
- Lo que no vuelve: los renombres de proyectos hechos después de la copia (el servidor no dice cuándo se
  hizo cada uno).
- Un dispositivo sin generación guardada cuenta la 1 (la que crea la migración): uno que todavía tenía una
  versión anterior cuando se restauró se recupera al actualizar, y uno vacío no tiene nada que hacer.
- Si dos dispositivos recuperan cambios de la misma página, gana el primero que sincroniza.
