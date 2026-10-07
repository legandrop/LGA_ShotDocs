# Sincronización offline

## Guardado antes de salidas controladas (v0.199, LF21 parcial)

Los botones *Reload* de los avisos y el cambio, unión o creación de un workspace desde la app abierta preparan el título de la página montada y esperan hasta ocho segundos el guardado local. Esa preparación devuelve la escritura real, sin depender de perder el foco ni de esperar el timer del título. Una escritura rechazada, un error de guardado del documento, una cola local pendiente o un cambio de contexto cancelan la salida; la vista conserva el título para volver a intentar. La preferencia de workspace sólo cambia al ejecutar la salida. Lo guardado en el dispositivo puede seguir pendiente de subir: se conservan las preguntas existentes y no se espera confirmación remota.

La comprobación final vuelve a mirar dueño, página, título y escrituras. Una nueva edición del título durante la espera invalida ese intento. Si la vista que preparaba el título ya no está disponible tras un error global, la recarga no toma esa ausencia como prueba de guardado. El editor y sus servicios siguen vivos mientras se espera.

El PDF usa también esta preparación y espera a que el consumidor del sobrante del título lo haya escrito y guardado en el documento antes de tomar la copia exportable. La continuación de una parte comprueba el plan actual antes de liberar la anterior; si cambió su estructura u opciones, conserva ese libro y ofrece reiniciar explícitamente. El ZIP también usa la barrera desde v0.204 antes de abrir su escritor. LF21 sigue parcial: la reimportación y el transporte completo de enlaces continúan pendientes. No cambia Auth, el cierre externo del navegador ni *beforeunload*, que continúa como aviso y no puede garantizar una espera. Desde v0.200 el título completo espera la confirmación de encabezado y sobrante; ante un rechazo mantiene el borrador en la misma sesión, como se detalla en «Límites».

Desde v0.206, el clic normal sobre un link del editor que sale a otro workspace prepara esas mismas escrituras locales antes de abrir la dirección capturada. La vista sigue montada durante la espera; error, límite de tiempo, cambios de contexto o referencia y desmontaje cancelan la salida. Cada gesto toma el contexto vigente, incluida una sesión renovada del mismo usuario, pero una espera previa conserva su captura y se invalida ante la renovación. No cambia Auth, beforeunload ni otros enlaces fuera del editor.

La dirección normal conserva w del origen fijado una vez por documento; el arranque selecciona esa entrada conocida antes de crear el cliente y no recupera por encima un link público recordado. El modo público conserva su cliente, sesión y almacenamiento separados. Calificar el anchor nuevo de un link propio no cambia href del modelo ni escribe Yjs/dirty, incluso al montar en solo lectura. Clipboard rico, drag, hashes públicos antiguos, importación/exportación completa y pruebas de RLS real y dispositivos físicos siguen pendientes (Doc_Links_PDF.md, sección 19).

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
- Los ajustes de una rama (`pages.settings`) viajan como cualquier otro cambio del árbol. Desde v0.214 cada
  cambio dice qué clave tocó y la base la fusiona con las demás (`patch_page_settings`): si dos dispositivos
  cambian ajustes distintos de la misma página sin red, quedan los dos; si cambian el mismo, el último que
  llega. Con una base sin esa función, o con un cambio que dejó en la cola una versión anterior, sube el
  objeto entero y queda el último (`Doc_Plantillas.md`, sección 8).

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
  El campo conserva el texto completo hasta que la transacción local confirma encabezado y sobrante. Durante ese
  intento queda de solo lectura. Si IndexedDB rechaza, vuelve a permitir editar y mantiene el texto para reintentar
  al salir del campo o pulsar Enter; volver a la página en la misma sesión recupera ese borrador. La preparación
  antes de salir espera el mismo intento y no autoriza el cambio si falló. El borrador pendiente pertenece al árbol
  y a la página de ese workspace; no es una copia durable si el almacenamiento todavía rechaza. Cada intento conserva
  el identificador del sobrante, y todos sus escritores releen y modifican la lista dentro de la transacción: retirar
  un sobrante ya transferido no borra otro que se confirmó desde una conexión distinta.
- **La cola.** Al abrir, los cambios sin subir que dejó una versión anterior con un título largo se cortan y lo que
  sobra se anota (son lo último que hizo la persona). Los **rechazados por el largo** (solo por `pages_title_check` o
  `workspaces_name_length`: un rechazo por permisos no se toca) se arreglan con el árbol del servidor a la vista, en
  `setSnapshot` (`repairRejected`): si el título no cambió después del rechazo, el cambio vuelve a la cola en su lugar,
  cortado; si cambió, **el título más nuevo queda** y el texto largo va entero a la página. Para saber si cambió no se
  usa la hora del dispositivo (puede ir adelantada horas y esconder un renombre): al rechazarse, `failOp` guarda el
  `updated_at` que tenía la fila (`rowUpdatedAt`, reloj del servidor) y la reparación mira si el del servidor sigue
  siendo ese (`sameInstant`: igualdad, no "antes o después"); también cuenta un renombre posterior en la cola o un
  rechazo posterior de la misma página (con la app desactualizada la cola no sube, y eso es lo único que lo ve). Un
  rechazo que guardó una versión anterior (hasta v0.152) no tiene ese dato: se toma siempre como cambiado. En la duda
  gana el título de ahora: nada se pisa ni se pierde. *Retry* no los manda de nuevo y *Hide* no los descarta.
- **Nombre de proyecto (200).** Los campos ya tenían el tope; el árbol lo corta igual (sin aviso: no se llega).
- **Clave de orden (128).** La clave entre dos vecinas se alarga cada vez que se pone algo en el mismo hueco (unas 600
  veces para pasar los 128). Antes de pasarlo, las hermanas **de alrededor del hueco** reciben claves nuevas y parejas
  en el mismo orden (`rekeyWindow`): la ventana crece desde el hueco hacia la vecina de clave más larga (de ahí vienen
  las amontonadas) hasta que las claves nuevas, entre dos vecinas que no se tocan, ocupan como mucho la mitad del tope.
  Con 200 hermanas y 650 páginas puestas en el mismo hueco se rehacen 363, todas de las amontonadas; antes, las 850. Si
  otro dispositivo movió a la vez una de las rehechas, gana el último cambio que llega (roadmap B.23).
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
  al abrir la app (lo detenido se vuelve a registrar: `register_file` es idempotente). Lo detenido por
  `page_not_found`, y el uso de un archivo que espera por lo mismo, salen solos cuando la página vuelve a ser
  editable (v0.217; ver "Un 'no existe' se reintenta solo cuando la página vuelve"). Si el servidor dice
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
pestaña en `src/ui/TrashView.tsx` y `src/media/fileTrash.ts` (desde v0.162, el filtro *Files* de la papelera única, en el
selector de proyectos: `Doc_Proyectos_Borrar.md`, "Cómo quedó: una sola papelera").

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
  respuestas). Volver a ponerla en la cola con el mismo id no la repite ni la cambia: desde v0.211 cada una deja
  un recibo en el dispositivo y, al seguir una importación, una página ya escrita no se vuelve a escribir, así que
  el bloque es el mismo (hasta v0.210, si todavía no había salido tomaba el bloque nuevo). Una versión de la app
  anterior a v0.060 no la conoce y la daría por subida sin mandarla: por eso se
  recargan las pestañas antes de importar, y además cada una queda en `meta` (`import:<id>`) hasta que el
  servidor la confirma; al abrir, lo que está ahí y ya no está ni en la cola ni en lo bajado vuelve a la cola.
  Después de restaurar una copia, lo importado por esta persona vuelve como `import`, con su autor y resuelto.
- **Comentarios hechos por un link público** (`Doc_Link_Publico.md`, 3.7): la fila trae el nombre que escribió el
  visitante (`plink_author`) y el id del link (`plink_id`), y se guarda entera en el dispositivo. El panel muestra
  `Ana (via link)` y, a quien puede compartir la página del link, de qué link vino (v0.222: `public_link_labels`,
  pedido una vez por conjunto de links y recordado solo por la sesión; `src/ui/linkLabels.ts`). Cuando se lee la vista
  `comments_view` en lugar de `list_comments`, se piden también esas dos columnas (sin ellas si la vista no las tiene).
- **Errores:** sin red, espera. Un error que se arregla solo (un 500, la sesión renovándose) se reintenta
  en la próxima sincronización con el error a la vista (`commentError`). Un rechazo (`comment_denied`,
  `not_allowed`, `comment_deleted`, `comment_conflict`, una página que dejó de estar compartida...) queda
  en el dispositivo con el motivo en palabras, en el panel (junto al comentario) y en el estado ("rejected
  by the server"), **y no se descarta solo**: se reintenta con "Retry" o al abrir la app, va en el archivo
  de "Download my unsynced changes", y solo la persona puede descartarlo ("Discard…", en el panel o en el
  detalle del estado). Los rechazados porque la página "no existe" salen solos cuando la página vuelve a verse
  (v0.217; ver "Un 'no existe' se reintenta solo cuando la página vuelve"). Las menciones de un comentario
  (`set_comment_mentions`) reciben `comment_not_found` tanto si el comentario no existe como si la sesión no ve su
  página: la cola le pregunta a la base por la página (`list_comments`) y, si no se ve, las deja rechazadas a la
  vista, con la edición de su comentario, en vez de olvidarlas; salen detrás de la edición cuando la página vuelve
  (`Doc_Menciones.md`, 3.3). Antes de descartar, la app dice qué pasa (el comentario vuelve como está en el
  servidor, el hilo se reabre, se van también N respuestas sin subir) y ofrece copiar el texto. **Un cambio
  rechazado no se aplica en pantalla:** un borrado que la base no aceptó deja ver el comentario, y una
  edición de un comentario que otro borró lo muestra borrado, las dos con el motivo. Borrar un comentario
  propio cuya alta fue rechazada lo saca de la cola sin mandar nada. Lo demás de la cola sigue subiendo.
- **Dos ediciones del mismo comentario (v0.227).** Solo quien escribió un comentario lo edita, así que el choque es
  de una persona consigo misma: lo edita en el teléfono sin red y, después, en la computadora. La base guardaba lo
  último que **llegaba**: cuando el teléfono recuperaba la red, su edición, escrita antes, pisaba la posterior, y el
  texto pisado no quedaba en ningún lado ni se avisaba en ningún dispositivo. Comparar fechas no lo arregla: la base
  sabe cuándo llegó cada edición, no cuándo se escribió, y la hora de un dispositivo no es de fiar. Cómo quedó:
  - **La edición lleva el texto del que partió** (`base` en la operación `edit`): el que la persona tenía delante al
    abrir el cuadro para editar (el panel lo toma en ese momento, no al guardar). Sube con
    `edit_comment(p_id, p_body, p_base)` (`20261115120000_comentario_edicion_base.sql`): la base cambia el texto solo
    si el que tiene sigue siendo ese. Si ya es otro, **no escribe** y contesta `{conflict: true, body, edited_at}`.
    Se compara el texto y no `edited_at` (D325): un comentario nunca editado no es un caso aparte, no depende de
    ninguna fecha, y dos ediciones seguidas del mismo dispositivo se encadenan solas (la segunda parte del texto de
    la primera; si todavía no salió ninguna, se juntan en una y queda la base de la primera).
  - **Reintentos:** una edición que llegó pero cuya respuesta se perdió encuentra su mismo texto y da bien, sin
    escribir, antes de mirar la base y el permiso. Si entre la edición y su reintento el comentario se editó desde
    otro dispositivo, el reintento da conflicto aunque la edición había entrado: queda a la vista de más, nunca de
    menos.
  - **La edición que no entró no se descarta ni se reintenta sola:** en una sola escritura sale de la cola y queda
    **apartada** en `meta` (`editConflict:<id del comentario>`), con lo que la persona hizo después sobre ese
    comentario, todavía no había salido **y partía de ese texto** (otra edición con ese texto de base, sus
    menciones): lo apartado es su último texto. Lo guardado toma en el acto el texto que contestó la base, y la
    página se baja en esa misma vuelta. No está en la cola a propósito: la cola reintenta lo rechazado cada vez que
    abre la app, y una versión anterior de la app que tomara una edición de la cola la mandaría con la firma de dos
    argumentos y pisaría. De `meta`, esa versión no toca esa clave. Lo demás de la cola sigue subiendo.
  - **Un solo texto apartado por comentario, y nada lo reemplaza sin que la persona lo haya visto.** Tres casos:
    (1) Una edición **rechazada** de antes (por ejemplo, de cuando le habían bajado el permiso) que se reintenta
    (al abrir la app o con *Retry*) y también choca, habiendo ya otra apartada de ese comentario que no partía de
    ella: no la reemplaza. Sigue en la cola como rechazada (*…another edit of yours on it is waiting for you to
    choose*), con su texto para copiarlo o descartarlo, y sus menciones no se mandan; se reintenta como cualquier
    rechazo, y cuando la apartada se decide pasa a ser ella la que espera decisión. (2) Una edición posterior que
    **no** partía de la que choca (se escribió sobre lo guardado, con la otra rechazada a la vista) no se va con
    ella: sale después, y si también choca queda rechazada como en (1). (3) Si el cuadro de edición ya estaba
    abierto cuando llegó el conflicto de la edición anterior, el cuadro sigue abierto, con un aviso arriba (*This
    comment was changed from somewhere else while you were editing…*); lo que se guarda desde ese cuadro **pasa a
    ser lo apartado** (su texto, su hora y sus menciones; sin pasar menciones, quedan las que tenía) y no entra a la
    cola. Un texto que no partía de lo apartado no la reemplaza ni se encola: se rechaza al guardar y queda en el
    cuadro.
  - **El cuadro que no puede guardar (v0.228, D332).** Ese último caso se alcanza así: el cuadro está abierto sobre
    lo guardado y una edición **rechazada** de antes se reintenta, choca y pasa a ser lo apartado. Desde ese cuadro
    guardar se rechaza siempre, y el aviso de la v0.227 decía «guardá o cancelá para ver los dos textos»: la única
    salida era *Cancel*, que descartaba lo tipeado sin preguntar. Ahora, cuando el cuadro no partía de lo apartado
    (`editBase !== conflict.text`), el aviso es otro (*An earlier edit of yours on this comment was not saved and is
    waiting for you to choose… What you are writing here can't be saved until you choose: copy it, then cancel…*), el
    cuadro suma ***Copy text*** de lo escrito, *Cancel* **pide confirmación** si hay algo escrito (solo en ese
    estado; Escape ya la pedía en todos), y el error de guardar (`commentError.decideFirst`) dice lo mismo. Ningún
    clic ni tecla adentro del cuadro descarta lo tipeado sin confirmar. **Lo que todavía lo tira sin preguntar**, en
    este cuadro y en cualquier otro de comentarios (ya era así): cambiar de página, recargar (el aviso de salir del
    navegador no cuenta un comentario a medio escribir) y que el hilo se resuelva o el comentario se borre desde otro
    lado mientras el cuadro está abierto (ver el roadmap).
  - **A la vista (D327):** el comentario muestra los dos textos, cada uno con su rótulo (*Saved now, changed from
    somewhere else* y *What you wrote on this device*), y tres acciones: *Keep mine* (la edición vuelve a la cola con
    la base de lo que se está viendo; si la base volvió a cambiar, vuelve a quedar apartada), *Discard mine…* (pide
    confirmación) y *Copy mine*. Hasta decidir no se ofrece *Edit*. En un hilo resuelto, la lista de resueltos se
    abre sola. Cuenta en el estado con lo rechazado (`failedComments`), sale en su detalle con su texto, y va en el
    archivo de "Download my unsynced changes"; si todo lo rechazado son ediciones apartadas, el detalle dice dónde
    se decide y no ofrece *Retry* (no hay nada que reintentar). **Al salir de la cuenta (v0.228, D333)** la
    pregunta cuenta también lo rechazado y lo apartado (antes, solo lo pendiente: con una edición esperando decisión
    salía sin preguntar) y lo dice: *N changes were rejected by the server and are only on this device. They stay
    saved here…* No se pierde nada (queda en la base local de esa cuenta); la persona se entera.
  - **Varios textos rechazados del mismo comentario (v0.228, D335).** Cuando dos ediciones (o un alta y su edición)
    quedan rechazadas, el cartel rojo del comentario mostraba y copiaba solo el primer texto. Ahora dice cuántos son
    y lista cada uno, cortado con «…», con su *Copy text*; con uno solo queda como estaba. Salen de
    `CommentQueue.failures()`, en el orden en que se escribieron.
  - **En una pantalla táctil** (`@media (pointer: coarse)`), los botones de la caja del conflicto, del cartel de un
    rechazo y del cuadro de edición tienen 36 px de alto (medían 18); el escritorio no cambia.
  - **Se olvida sola en un único caso:** cuando la base termina teniendo ese mismo texto (no queda nada que
    decidir), aunque las menciones que quedaron en la base sean otras que las de la edición apartada: el texto está
    guardado, y lo que no se manda es el aviso a quien ella nombraba.
  - **Lo que sigue como antes:** un comentario que se borró mientras tanto (`comment_deleted`: la edición queda
    rechazada con su texto, para copiarlo o descartarlo), el permiso que se bajó (`comment_denied`), y un hilo que
    se resolvió (no es un conflicto: resolver no cambia el texto). Si el comentario se borra **después** de que una
    edición quedó apartada, lo apartado sigue a la vista en el comentario borrado, para copiarlo o descartarlo.
  - **Compatibilidad:** la firma de dos argumentos no se toca; una app publicada sigue guardando lo que llega.
    PostgREST elige la función por los nombres de los argumentos del pedido (como con `push_page_update` y su
    `p_app_version`). La app nueva con una base sin la migración (`PGRST202`) cae a la firma de dos argumentos y no
    vuelve a probar por 10 minutos. No sube `schema_version`. **Mientras quede abierto un dispositivo con una
    versión anterior a la v0.227, su edición tardía sigue pisando:** con `min_app_version` en 0.227 (D329, se sube
    al publicar) la base frena de verdad una edición nueva hecha desde una versión vieja (503 `app_outdated`: no
    escribe, y queda en su cola para reintentar).
  - **La edición que una versión anterior dejó en la cola** no dice de qué texto partió. Al abrir la app, una sola
    vez, toma de base el texto que el dispositivo tiene guardado de ese comentario (o el de la edición propia que la
    precede en la cola): si el dispositivo no bajó nada desde que se escribió, es el texto del que partió y ya no
    pisa; si bajó algo en el medio, la base es lo último que vio y la edición entra como antes. Achica el hueco, no
    lo cierra: nunca es peor que mandarla sin base. Las que no tienen de dónde sacarla quedan sin base, marcadas
    (`unchecked`) para no buscarles una otra vez; una edición nueva que se funde en una de esas conserva la marca
    (v0.228: sin ella, al reabrir la app tomaba de base lo guardado, que no es el texto del que partió). Dos
    seguidas se encadenan: la segunda se manda con el texto de la primera de base.
  - **Lo que no cubre:** el visitante de un link público (`plink_edit_comment`) edita lo suyo solo desde el mismo
    navegador con el que lo escribió, así que no tiene dos dispositivos que choquen; no cambió (dos pestañas de ese
    navegador siguen con «gana la última»). Dos pestañas de un mismo dispositivo comparten la cola: ahí vale lo
    último que se guardó, como en el resto de la cola; *Keep mine* relee lo guardado en el dispositivo antes de
    mandar, así que lo que otra pestaña descartó no vuelve. Y después de restaurar una copia, las ediciones propias
    que vuelven a la cola van sin base a propósito (como antes).
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

**Qué es un rechazo y qué una falla pasajera** (`toRemoteError` en `remote.ts`; lo usan todos los pedidos a la base).
Sin red, una sesión que se está renovando (401) y los estados 408, 425, 429 y 500 o más son pasajeros: el pedido se
repite en la vuelta siguiente y, si es contenido, la vuelta se corta ahí. Lo demás es un rechazo definitivo: queda a la
vista con su motivo y se reintenta a mano o al abrir la app (y, si es un "no existe", solo cuando la página vuelve:
ver abajo). **Desde v0.214, un "no existe" de una función de la base es
definitivo aunque llegue con estado 500.** Las funciones lo levantan con el código `P0002` (`page_not_found`,
`file_not_found`, `comment_not_found`, `link_not_found`, `version_not_found`…, también cuando la sesión dejó de ver la
página) y PostgREST le pone 400 solo al `P0001`: a los demás códigos `P0…` les pone 500. Con el estado solo, la app lo
tomaba como una falla de la base: reintentaba para siempre un pedido que nunca iba a pasar, y una página que la persona
ya no podía editar o ver cortaba la subida o la bajada de las demás en cada vuelta. Ahora manda el código: esa página
queda rechazada (lo escrito sigue en el dispositivo) y las demás siguen. Un 500 con otro código, o sin código, sigue
siendo pasajero, igual que el 503 `app_outdated`. El archivo que todavía no llegó al servidor (`file_not_found`) se
sigue esperando: la cola de fotos y videos lo reconoce por el mensaje, no por esto. El servidor en memoria de un link
contesta como la base (500 con `P0002`). Pruebas: `src/sync/remoteErrors.test.ts`.

**Un "no existe" se reintenta solo cuando la página vuelve (v0.217; `retryReturned` en `engine.ts`).** Ese "no existe"
es también lo que la base contesta cuando la sesión dejó de ver o de poder editar la página, y eso se revierte: le
devuelven el permiso, la página sale de la papelera (una invitada, o quien no edita, no la ve mientras está ahí),
restauran el proyecto. El
dato llega con el árbol y los permisos que baja cada ciclo. Con algo rechazado así, cuando una bajada del árbol muestra
la página en "no" y una posterior en "sí", se limpia ese rechazo y sale en ese mismo ciclo, sin *Retry* ni reabrir la
app: el contenido rechazado con `page_not_found` y los archivos detenidos o los usos que esperan por lo mismo, cuando
la página vuelve a ser **editable** (está en el árbol y los permisos bajados dan Editar; sin datos de permisos, alcanza
con que esté); los comentarios rechazados con `page_not_found`, `comment_not_found` o `thread_not_found`, cuando la
página vuelve a **verse** (está en el árbol). El cliente solo decide cuándo reintentar: si puede o no, lo sigue
decidiendo la base.
- **Sin bucle:** hay un reintento por cada vez que el árbol pasa de "no" a "sí", nunca uno por ciclo. Las páginas
  que se esperan se anotan en memoria cuando el árbol las muestra en "no"; el reintento las saca de la lista. Si la
  base vuelve a rechazar, lo escrito sigue en el dispositivo, rechazado y a la vista como antes, y no hay otro
  reintento hasta que el árbol vuelva a decir "no" y otra vez "sí".
- **Cuándo se anota el "no":** al bajar el árbol (lo que ya estaba rechazado) y, con ese mismo árbol, en el momento
  de cada rechazo nuevo: el contenido, apenas la base lo rechaza (`noteLocked`: no espera al final del ciclo, que se
  puede cortar más abajo si se cae la red); los comentarios, al terminar la vuelta de su cola (`noteHidden`); los
  archivos, al terminar la vuelta de la suya, que corre después del ciclo (`noteFilesLocked`). Así el "no" queda
  anotado aunque la app pase sin red todo el rato que dura, y lo rechazado sale solo cuando vuelven la red y la página.
- **Si la página vuelve solo para ver:** el comentario rechazado se reintenta esa vez, la base lo rechaza por permiso
  (`comment_denied`, otra clase) y desde ahí no sale solo aunque después llegue el permiso de comentar: queda a la
  vista para *Retry* o la próxima apertura. Lo mismo no pasa con el contenido ni con los archivos, que esperan a que
  la página sea editable.
- **Solo esa clase:** un rechazo por tamaño, por la versión mínima, por un conflicto o por falta del permiso de
  comentar no se toca; tampoco los cambios del árbol rechazados (renombrar o mover: gana el último que llega, y
  reintentarlos solos podría pisar un cambio más nuevo de otra persona).
- **Lo que no cubre:** si el permiso se va y vuelve entre dos bajadas del árbol, el dispositivo nunca ve el "no" y
  lo rechazado queda para *Retry* o para la próxima apertura de la app, como antes. La lista es por apertura (al
  abrir se reintenta todo igual).
- **En el estado:** mientras una página no se puede bajar o subir por esto, el detalle lo dice en palabras ("The page
  is not on the server, or you can no longer see it." / "…or you cannot edit it."), no con el código de la base.

Pruebas: `src/sync/rejectedReturn.test.ts`.

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

## Las listas largas: sin suponer cuántas filas entrega la API (v0.224 y v0.226)

La API de la base entrega como mucho un **tope de filas por pedido** (el ajuste *Max rows* del proyecto; de fábrica,
1000) y **no avisa cuando recorta**. La app daba por última "una página con menos de 1000 filas": con un tope menor (un
workspace con su propio Supabase) la lista quedaba cortada en silencio. Y una lista cortada no es solo una lista más
corta: el motor la toma por todo lo que hay.

- **Qué hace el motor con lo que no vino.** `PageTree.setSnapshot` **reemplaza** la copia del árbol por lo que llegó:
  las páginas y los proyectos que faltan dejan de verse (su contenido sigue en el dispositivo, sin página que lo
  muestre) y, si además cambió la generación, `recoverAfterRestore` las vuelve a poner en la cola como altas. La cola de
  comentarios, en una bajada entera, **borra lo guardado de la página y lo cambia por la lista**; y `commentOnServer`
  lee "no está en la lista" como "se borró" y **tira las menciones** que esperaban. Los permisos propios que faltan
  apagan en la interfaz lo que la persona sí puede hacer. Por eso ninguna de estas listas puede llegar parcial: o llega
  entera, o el pedido falla y no se toca nada.
- **Por clave y hasta el total** (`src/sync/listPages.ts`, `KeyedList`). Cada pedido lleva **el orden escrito** (un
  orden total: la última columna desempata), pide lo que sigue a **la última fila recibida** y le pide a la API **el
  total** (`count: 'exact'`, que llega en la misma respuesta, en `Content-Range`). La lista termina cuando lo recibido
  alcanza ese total, o con una página vacía; nunca por haber recibido pocas filas. Lo que cambia entre dos pedidos no
  corre ni saltea filas; una fila repetida (una base que no avanza) es un error; si un pedido falla, falla la lista. En
  el caso de siempre (todo entra en una respuesta) es **un pedido, como antes**. Si la API no mandara el total, o mandara
  uno menor que lo que entregó (no se le cree), se sigue hasta una página vacía (un pedido más).
- **Sin migración.** `list_comments` ya recibe desde cuándo (`p_since`) y devuelve por `updated_at` e `id`: el pedido
  siguiente manda en `p_since` la fecha de la última fila y un filtro que deja afuera lo de esa misma fecha que ya
  llegó. No sube `schema_version` y anda igual con una base anterior.

| Lista | Dónde | Cómo se pide ahora |
|---|---|---|
| Comentarios de una página | `listComments`, `fetchComments` | Por clave (`updated_at`/`created_at`, `id`) y total. Lo editado entre dos pedidos llega con su última versión. |
| Árbol de páginas | `fetchTreeOf` | Por `id` (ya lo hacía) y total, en vez de "menos de 1000". |
| Proyectos | `fetchProjects` | Por `created_at`, `id` y total (antes, un pedido con "hasta 1000"). |
| Permisos propios | `fetchMyAccess` | Por `id` y total (antes, un pedido con "hasta 10000", que la API recortaba a su tope). |
| Usos de archivos | `fetchPageUses`, `fileUses` | Por clave (página, archivo) y total. |
| Archivos por id | `fetchMediaFiles` | Se vuelve a pedir lo que no llegó mientras siga llegando algo; sin total (contar revisa dos veces los permisos de cada archivo: 50 ms más cada 100). Un archivo que falta de verdad cuesta un pedido más, vacío. |
| Archivos por peso | `filesBySize` | Ya iba por clave; termina con una página vacía (un pedido más al final de la lista). Sin total: contar revisaría los permisos de todos los archivos del proyecto en cada tramo. |
| Lotes de contenido e historial | `pullUpdates`, `pullContent`, `pageHistory` | Si la API recortó el lote (dice que la función dio más filas), se completa desde la última fila: "menos que lo pedido" sigue queriendo decir "no hay más". |
| Papelera de archivos, base sin `trashed_files_page` | `trashedFilesAllByRange` | Sigue por tramos, pero hasta el total. |
| Correos de quienes comentaron o escribieron una página | `fetchCommentAuthors`, `pageHistoryAuthors` | Por clave (`user_id`) y total (`rpcByKey`): un correo que falta no deja en error la bajada de comentarios ni la carga del historial. |
| Árbol de un link (v0.226) | `LinkRemote.fetchTree` (`plink_tree`) | Por `id` y total. Todas las filas de una bajada traen la misma firma (`sig`) y son tantas como anunció el primer pedido; si no, se empieza de nuevo (abajo, "El modo link"). |
| Comentarios de una página por un link (v0.226) | `LinkCommentRemote.listComments` (`plink_list_comments`) | Por clave (`updated_at`, `id`) y total, como `list_comments`. |
| Archivos por un link (v0.226) | `LinkRemote.fetchMediaFiles` (`plink_media_files`) | De a 200 ids (el tope de la función) y cada tanda por `id` y total: un archivo que el link no ve no cuesta un pedido más. |
| Estado de lo mandado por un link (v0.226) | `LinkRemote.refreshEdits` (`plink_push_status`) | Por `page_id` y total. |
| Lo apartado de los links (v0.226) | `linkAside` (`public_link_aside`) | Por `id` y total (`rpcByKey`); después vuelve al orden de la función, lo más nuevo primero. |
| Lo que no entró de un link en una página (v0.226) | `linkUpdatesOf` | Con `public_link_updates_page` (migración `20261114120000`): por `n` (el orden de llegada), de a 1000, hasta el total que la función dice en cada fila. Con una base sin ella, `public_link_updates_of` como antes (hasta 500). |

**Las listas que se piden de una vez** (una función de la base, sin lugar desde dónde seguir) son dos grupos. Lo que
decide el grupo es si la lista puede tener de verdad más filas que el tope **de fábrica** y quién recibe el error.

| Lista | ¿Pasa de 1000 de verdad? | Quién recibe un error | Qué hace desde v0.224 |
|---|---|---|---|
| Equipo (`list_members`) | No | *Members*: lo muestra. *Share* (sugerencias): se lo traga. | Con el total: si la API la recortó, error (`wholeList`). |
| Quién tiene acceso (`list_access`) | No | *Share*: lo muestra. | Con el total. |
| Proyectos borrados (`trashed_projects`) | No | La papelera: lo muestra, con *Retry*. El aviso de "hay algo para restaurar": se lo traga. | Con el total. |
| Peso de los proyectos (`project_sizes`) | No (una fila por proyecto) | *Drive* y la lista por peso: lo muestran. | Con el total. |
| Invitaciones (`list_invitations`) | No | *Members* se lo traga: la sección de invitaciones no se muestra. | Con el total. |
| Nombres de versión (`list_page_versions`) | No | `fetchVersions` se lo traga: el historial se ve sin los nombres. | Con el total. |
| Candidatos del `@` (`mention_candidates`) | No | `refreshCandidates` se lo traga. | **Lo que llega**, como antes: con el error, el `@` se quedaba sin nadie. |
| Lo apartado de los links (`public_link_aside`) | **Sí**: hasta 200 por página, y nunca se borra | `LinkAsideStore` se lo traga. | En v0.224, lo que llega. **Desde v0.226, entera, por clave** (la tabla de arriba). |
| Lo que no entró de un link en una página (`public_link_updates_of`) | La función corta en 500 **adentro** | El aviso de la página se lo traga. | En v0.224, lo que llega. **Desde v0.226, entera, con `public_link_updates_page`**; con una base sin ella, como antes. |
| Páginas con link (`public_link_pages`) | No (una fila por página con un link vivo) | El ícono del árbol y los links del PDF se lo tragan. | **Lo que llega**, como siempre (D323). |
| Pedidos de acceso (`access_requests_pending`) | La función corta en 100 **adentro** (lo más nuevo) | La campana y *Share* se lo tragan. | **Lo que llega**: es una lista de trabajo, decidir uno deja ver el siguiente (D323). |
| Papelera de un proyecto, base sin `trashed_files_page` (`trashed_files`) | **Sí** (un proyecto importado y borrado) | La papelera: lo muestra. | **Lo que llega**, como antes (lo último primero): con el error no se veía nunca. Con la función nueva llega entera, por clave. |

Con el tope de fábrica ninguna de las del primer grupo llega a recortarse; con un tope menor, las que muestran el error
dicen *This list is longer than this workspace's database sends in one request…* y las otras dos (invitaciones, nombres
de versión) simplemente no se muestran. Lo de `public_link_aside` lo encontró la auditoría de esta versión: el control
del total, puesto ahí, dejaba la lista vacía con el tope de fábrica.

- **El modo link (v0.226).** El visitante de un link público pedía sus listas en un pedido cada una. Medido con una
  rama y una página con más filas que el tope (el motor de verdad contra una API de mentira que recorta):

  | Tope de filas | Rama (páginas) | Veía antes | Ve ahora | Comentarios antes | Ahora | Pedidos del árbol (antes → ahora) |
  |---|---|---|---|---|---|---|
  | 1000 | 1203 | 1000 | 1203 | 1000 de 1203 | 1203 | 1 → 2 |
  | 500 | 1203 | 500 | 1203 | 500 de 1203 | 1203 | 1 → 3 |
  | 137 | 320 | 137 | 320 | 137 de 320 | 320 | 1 → 3 |
  | 1 | 7 | 1 | 7 | 1 de 5 | 5 | 1 → 7 |

  Lo que no venía, el dispositivo lo daba por inexistente (`PageTree.setSnapshot` reemplaza). Y como `plink_tree`
  entrega por `id`, **la raíz del link quedaba afuera** cada vez que su id no estaba entre los primeros: con la
  función real (por SQL, en una transacción que se deshizo), una rama de 1501 páginas y la raíz con el id más alto, las
  primeras 1000 filas que entregaría la API venían **sin la raíz** (un árbol sin nada de dónde colgar: el link se veía
  roto). Con el visitante de *Can edit* no se perdía lo
  escrito (sigue en su dispositivo), pero trabajaba sobre un árbol incompleto.
  - **Ahora** cada lista va por clave, con el orden escrito y hasta el total, como las de una cuenta
    (`src/sync/linkRemote.ts`). Con todo en una respuesta son **los mismos pedidos que antes** (abrir el link y un
    pedido por lista; medido con el dispositivo entero de un visitante, 41 páginas y 30 comentarios: los mismos 7
    pedidos, en el mismo orden). Anda igual con el rol `anon` y el token en el header: el filtro, el orden y el total son del
    pedido, no de la sesión. Ninguna de las cuatro funciones del árbol, los comentarios, los archivos y el contenido
    corta adentro (`plink_pull_page` da una sola fila: no hay nada que recortar); `plink_push_status` sí, en 500
    páginas y sin orden (abajo, "Lo que queda").
  - **La firma del árbol.** `plink_tree` devuelve en cada fila la firma del árbol del que salió. El primer pedido
    lleva la firma guardada (sin cambios, la base no devuelve nada ni cuenta); los que siguen, ninguna. Todas las
    filas de una bajada tienen que traer **la misma** y ser tantas como dijo el primer pedido (una respuesta vacía no
    trae firma: por eso el total). Si el árbol cambió entre dos pedidos, lo juntado se descarta y se empieza de
    nuevo, hasta 3 veces (`TREE_TRIES`). Nunca se guarda un árbol armado con dos estados.
  - **Si no deja de cambiar** (una importación, un movimiento masivo en una rama que no entra en una respuesta): el
    ciclo **sigue con el árbol que tenía**, sin error, así lo que el visitante escribió sube igual; y la bajada se
    vuelve a probar de a **un** intento, cada vez más espaciado (20 s, el doble cada vez, hasta 10 minutos:
    `TREE_WAIT_MS`, `TREE_WAIT_MAX_MS`), hasta que una salga bien. Cada intento cuenta el árbol entero en el tope del
    día del link: tres intentos en cada sincronización lo gastaban en minutos, para todos sus visitantes. Solo si
    todavía no hay ningún árbol de esta carga de la app es un error (*The shared pages kept changing while they were
    loading…*): un árbol vacío se tomaría por "no queda ninguna página". Ese caso sí corta el ciclo, con la misma
    espera.
  - **La lista atrasada, a la vista (v0.228, D334).** Mientras el visitante sigue con el árbol que tenía, la insignia
    decía «All synced» sin ninguna señal. Ahora su detalle tiene una línea (*The list of pages may be out of date: it
    kept changing while it was loading, so you still see the earlier one. It updates on its own.*): no es un error,
    no cambia el texto ni el color de la insignia, no frena nada, y se va sola cuando llega el árbol nuevo
    (`LinkRemote.treeBehind`, que avisa por la misma suscripción que lo mandado).
  - **Un link revocado durante esa espera (v0.228, D336).** En la espera no se pide el árbol, que era el pedido que
    en cada ciclo contestaba `link_not_found`: un visitante que no escribe podía tardar hasta 10 minutos en enterarse
    de que el link fue revocado o venció. Los comentarios de la página abierta sí se piden en cada ciclo
    (`plink_list_comments`, como mucho cada 10 s), y esa función contesta `link_not_found` con el link muerto: ahora
    `LinkCommentRemote` lo avisa a la pantalla (también al comentar, editar o borrar). **Ningún pedido de más y
    nada del cupo de bytes:** es el mismo pedido de siempre. Sin ninguna página abierta en pantalla (un link abre
    en su página, así que es raro) sigue esperando al árbol, como antes. Un tope del día en los comentarios no se
    avisa por acá (como antes).
  - **Un total que no coincide con las filas.** Dos bajadas seguidas que terminan con la misma firma y la misma
    cantidad de filas son el árbol, aunque el primer pedido haya anunciado más (una rama que se achicó de verdad
    cambia de firma): una API que contara de más no deja al link sin árbol. **Solo si las dos terminaron con una
    respuesta vacía (v0.228):** ahí la API misma dijo que después de la última fila no hay nada, y una que anuncia
    de más termina siempre así. Antes alcanzaba con la firma y la cantidad: una API que dijera bien el total en el
    primer pedido y «esta página es todo lo que queda» en los siguientes dejaba aceptar un árbol incompleto y sin la
    raíz (medido: 274 de 401 páginas). Ahora esa bajada no se acepta nunca: el visitante sigue con el árbol que
    tenía o, sin ninguno, ve el aviso de siempre.
  - **Si un pedido falla,** el resultado es el error: el árbol guardado (en `LinkRemote` y en el dispositivo), los
    comentarios guardados de la página y lo que el visitante escribió sin subir quedan como estaban, y la vuelta
    siguiente lo completa.
  - **Lo que cuesta: el cupo del día del link** (medido en la base real, en transacciones que se deshicieron). Las
    funciones del link son `volatile` y cuentan cada pedido en los topes del día (`pull_bytes`, 50 MB por link **entre
    todos sus visitantes**). `plink_tree` cuenta los bytes de **todo** el árbol, antes del filtro del pedido: unos
    307 bytes por página, 41–64 ms por pedido con 1501 páginas. Con una rama de hasta el tope de filas, los pedidos y
    los bytes son **idénticos a los de la v0.225**. Con una más grande, cada pedido de la bajada cuenta el árbol
    entero, así que el costo es cuadrático: `ceil(N / tope) × 307 B × N`.

    | Páginas de la rama | Tope de filas | Una bajada del árbol | Bajadas por día (50 MB) |
    |---|---|---|---|
    | hasta 1000 | 1000 | como en v0.225 (423 páginas: ~130 KB) | como en v0.225 |
    | 1501 | 1000 | 0,92 MB | 56 |
    | 1501 | 500 | 1,84 MB | 28 |
    | 1501 | 137 | 5,07 MB | 10 |
    | 5001 | 1000 | 9,2 MB | 5 |
    | 10001 | 1000 | 33,9 MB | 1 |
    | desde unas 12.800–13.000 | 1000 | más de 50 MB | ninguna: el link no carga nunca |

    - **Qué dispara una bajada entera:** cada apertura o recarga del link (la firma guardada vive en memoria) y
      **cada cambio de la firma con la pestaña abierta**, incluida cada base limpia nueva de cualquier página de la
      rama mientras alguien edita (la firma mezcla la estructura con `clean_seq`: `Doc_Roadmap.md`).
    - **Al agotarse:** `link_rate_limited` (`pull_bytes`) para **todos** los visitantes de ese link hasta el día
      siguiente, en el árbol y en los comentarios con novedades (*This link has been used a lot today*). Siguen
      andando abrir el link, el estado de lo mandado y mandar ediciones. El tope de todos los links
      (`all_pull_bytes`, 150 MB por día) es compartido: tres links en su tope dejan sin bajar a todos los del
      workspace.
    - Antes, una rama más grande que el tope llegaba cortada y contaba un solo pedido.
- **Dar una página por comprobada** (`verifyHistory` en `engine.ts`, lo que habilita mandar archivos a la papelera)
  recorre el historial hasta el cursor o hasta un lote vacío, no hasta un lote más corto que lo pedido: un lote
  recortado dejaba sin mirar lo que seguía.
- **Lo que cuesta** (medido en la base de Wanka, en transacciones que se deshicieron). Los pedidos de una
  sincronización son **los mismos** que antes: ajustes, permisos (2), proyectos, árbol (uno cada 100 proyectos) y uno por
  página de comentarios que se baja. Contar no es gratis en las tablas, porque la base revisa los permisos de cada fila
  otra vez: el árbol pasa de 8 a 15 ms, los proyectos de 1,5 a 3 y los permisos de 0,2 a 0,4; en una función no cuesta
  nada (`list_comments`: 0,5 ms con o sin total). Los usos de archivos de 100 páginas pasan de 104 a 207 ms, pero solo
  se piden para las páginas que un dispositivo nunca comparó.
- **El costo de contar a escala** (medido por la auditoría, con 3.500 páginas sembradas en una transacción que se
  deshizo). El primer pedido del árbol pasa de 1,2–2,3 s a 2,3–4,4 s para la dueña (un miembro con permisos página por
  página, de 2,3 a 4,0 s; un admin sin permisos propios, de 1,2 a 3,2 s), y los usos de 100 páginas con 2.600 filas, de
  1,1–3,0 a 2,2–5,7 s. La sesión tiene un tope de 8 segundos por sentencia: contar baja a la mitad el tamaño de árbol
  desde el que la sincronización empieza a fallar entera (de unas 12–24 mil páginas a 6–12 mil). Hoy no pesa (41
  páginas vivas). **Diseño para cuando haga falta:** en `pages` y `page_files` no pedir el total y, cuando una página
  llega más corta que lo pedido, confirmar el final con **un** pedido por clave (no encuentra filas y casi no le cuesta
  a la base, aunque suma una ida y vuelta por lista); o elegir entre las dos formas según el tamaño que tuvo la lista
  en la sincronización anterior (chica: total; grande: pedido de confirmación). En las funciones y en las tablas
  chicas el total no cuesta y se queda.
- **Qué mirar en producción.** Con la pestaña de red, en una sincronización: la respuesta de `rpc/list_comments` (y la
  de `pages`, `workspaces` y `grants`) trae un `Content-Range` que termina en un número (`0-29/30`), no en `*`. La
  señal de problema son los pedidos de a pares, donde el segundo contesta `[]`. Si la API no mandara el total en un
  `rpc`: los comentarios siguen seguros, con un pedido de más por página; los lotes de contenido que la API recorte
  llegan demorados (los retoma la vuelta siguiente), no perdidos; y el historial y las listas de un pedido quedarían
  cortados en silencio con un tope de filas bajo. Esto se probó contra una API de mentira que imita a PostgREST y
  contra las funciones reales por SQL, **no contra la API real** (hace falta una sesión).
  - **Con el primer link real** (v0.226; hoy la base no tiene ninguno): que el pedido a `rpc/plink_tree` lleve
    `Prefer: count=exact` y el header del link; que su `Content-Range` termine en un número; que la segunda
    sincronización conteste `[]`; y **que el uso del link (`pull`, en *Share*) suba de a uno por pedido HTTP** (que la
    API no corra la función dos veces para dar el total). Para ver el camino de varios pedidos: bajar un rato *Max
    rows* de la Data API a 5 y abrir un link con más de 5 páginas (llegan todas, en varios pedidos con la misma
    firma).
- **Lo que queda.**
  - **Hecho en v0.228 (lo anotado en la re-verificación de v0.226):** la bajada corta repetida del árbol vale solo
    si terminó con una respuesta vacía; la línea de «lista atrasada» en el detalle de la insignia; el link revocado
    durante la espera se nota en el ciclo siguiente por los comentarios de la página abierta (los tres, arriba, en
    "El modo link"); la prueba de que `run()` marca el error de comentarios como «de bajada» (sin esa marca,
    `refresh` no limpia un error que dejó `run`); y el error de una fila repetida tiene dos textos: el de siempre
    donde se reintenta solo, y uno sin «se vuelve a intentar» donde no (`sync.listRepeatedStuck`: la papelera de
    archivos, que ofrece *Retry* al lado; ahí el motivo además se muestra en el idioma de la cuenta, que salía en
    inglés).
  - **Hecho en v0.226:** las pruebas que faltaban (la guarda de «el historial no avanza» de `verifyHistory`, un pedido
    fallido a mitad de `rpcByKey`, las columnas del árbol, de los proyectos y de los usos por archivo, y la papelera
    por tramos con un total mentido), el modo link, `public_link_aside`, `public_link_updates_of` (con la migración
    `20261114120000_link_no_entro_por_clave.sql`), el orden escrito en `link_admit_work`, los dos errores que salían
    crudos (ahora pasan por el diccionario, en los dos idiomas y sin el nombre de la función de la base, que va al
    registro de la consola: *A list could not be loaded: the same row arrived twice…*) y el error del estado de los
    comentarios, que `CommentQueue.refresh` limpia cuando la bajada que había fallado sale bien (si era de una bajada
    y no es también el de otra página; uno igual que vino de una subida no se toca).
  - **El modo link cuenta de más con una rama grande: antes de usar links sobre ramas de más de 1000 páginas.** Cada
    pedido de más del árbol cuenta el árbol entero en el tope del día del link (arriba, "Lo que cuesta", con la
    tabla). **Diseño** (con migración): una función `plink_tree_page(p_sig, p_after, p_limit)` que arme el árbol una
    vez, devuelva solo la página pedida con la firma y el total, y **cuente los bytes de lo que entrega**; la app la
    prueba y, con `PGRST202`, sigue como hoy. Lo mismo para `plink_list_comments`.
  - **`plink_push_status` corta en 500 páginas adentro, sin orden** (confirmado con 620 páginas: llegan 500 y la API
    dice que el total es 500). Las demás páginas se dejan de recordar (`dropSent`). No se llega en un uso real (hace
    falta escribir en más de 500 páginas con un link y que nadie lo admita); arreglarlo es escribirle un orden y
    darle desde dónde seguir, con migración. Y con un tope de filas bajo gasta un `pass` por pedido en cada refresco.
  - **El orden de lo apartado** en la app (`created_at`, `id`) no es exactamente el de la función (`n`): difiere
    entre filas con la misma fecha. Para que sea exacto, `public_link_aside` tendría que devolver `n`.
  - **Una fila que se confirma tarde con un `n` menor** que la última recibida no llega en esa bajada del aviso de la
    página (solo con dos links escribiendo a la vez en la misma página); llega en el refresco siguiente.
  - **Los servidores de mentira de las pruebas no imitan el cupo `pull`:** lo que cuenta cada pedido se midió por SQL.
  - **`public_link_pages` y `access_requests_pending` quedan con lo que llega** (D323). La primera tiene una fila por
    página con un link vivo: hacen falta más de 1000 links vivos para pasar el tope de fábrica, y lo que falta es un
    ícono en el árbol o la dirección del link en un PDF. Paginarla es pedirla por `page_id`, pero la piden cuatro
    lugares con sus pruebas. La segunda corta en 100 adentro (lo más nuevo) y es una lista de trabajo: al decidir un
    pedido aparece el siguiente.
  - **Las listas de trabajo** (`files_due_for_purge`, `link_admit_pages`, `link_admit_work`, `clean_work`) no llevan
    el control: una parte ahora y el resto en la vuelta siguiente es lo que hacen siempre. `link_admit_work` escribe
    el orden en el pedido desde v0.226 (el de la función: página, link y llegada).
  - **Las listas del primer grupo** dan un error (o no se muestran) con un tope bajo en vez de paginarse; paginarlas es
    pedirlas por su clave, como los correos.
  - **El cursor de los comentarios:** `updated_at` es la hora en que empezó la transacción, así que un cambio que
    empezó antes y se confirmó después de una bajada queda detrás del cursor (reproducido de forma simulada por la
    auditoría; no empeora respecto de v0.223). Lo barato, sin migración: pedir con `p_since` un minuto atrás.
  - `fetchTree` con más de 100 proyectos son varios pedidos: una página que cambia de proyecto entre dos puede faltar
    o repetirse en esa bajada.
  - Chicos: en `scripts/lib/management.mjs` el "Try again" también sale para invitar (un `POST` que pudo haber
    llegado); y los pedidos de más ya dichos (`fetchMediaFiles` cuando falta un archivo, `filesBySize` al final de la
    lista).
- Pruebas: `src/sync/listPages.test.ts`, contra `src/sync/fakePostgrest.ts` (el cliente de verdad y una API de mentira
  en el nivel de los pedidos: tope de 1000, 500, 137 y 1, solo las columnas pedidas, otro orden en cada pedido si no se
  lo escribe, cambios entre dos pedidos, sin total o con un total mentido, y un pedido que falla a mitad);
  `src/sync/linkLists.test.ts` (las listas del visitante con los mismos topes: el árbol que cambia a mitad, que no
  deja de cambiar o que pierde páginas, el pedido que falla, y el dispositivo entero de un visitante con una rama más
  grande que el tope); `src/sync/linkEdit.test.ts` (lo escrito sin subir cuando el árbol falla a mitad);
  `src/ui/linkAsideStore.test.ts` (lo apartado con más filas que el tope, y los errores que no son de red);
  `src/media/trash.test.ts` (el historial con lotes recortados, y el que no avanza) y
  `supabase/tests/link_no_entro_por_clave_permisos.sql`. Lo del modo link se probó contra la API de mentira y contra
  las funciones reales por SQL, con el pedido como lo arma la API (el rol `anon`, el token en el header, el filtro por
  clave, el orden y el total), **no contra la API real**: en producción, con un link abierto y la pestaña de red, la
  respuesta de `rpc/plink_tree` tiene que traer un `Content-Range` que termine en un número.

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

**Para que frene a las versiones viejas** (hoy la migración está aplicada y `min_app_version` en 0.181; verificado en la base el 2026-10-06): aplicar la migración (con copia de seguridad), publicar la v0.090 y,
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

**Qué no frena la base:** la papelera de archivos (mandar un archivo a la papelera de Drive), que la pide el portero sin
la versión de la app; es una acción con red y en el momento, no una cola. En la app, la cola de archivos sí deja de
mandar a la papelera con una versión menor a la mínima. Compartir e invitar frenan desde v0.214 (abajo).
Un header alto falso pasa: la mínima es una guarda de compatibilidad, no de seguridad
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

### La versión mínima, el equipo y los permisos (v0.214)

Quedaba afuera todo lo que cambia quién ve qué: una versión más vieja que la mínima seguía compartiendo, sacando
permisos, invitando, revocando invitaciones, cambiando roles y sacando personas. Importa porque esas versiones no hacen
lo que la mínima exige antes de compartir (subir lo pendiente de la rama, por ejemplo: `Doc_Privacidad_Borrado.md`, 4.2).

`grants`, `members` e `invitations` se escriben solo con funciones `security definer` (`share`, `unshare`,
`create_invitation`, `revoke_invitation`, `accept_invitations`, `set_member_role`, `remove_member`, y las que llaman a
`share`: `decide_access_request` y `share_for_mention`). Como con los comentarios, lo mira **un trigger en cada tabla**
(`private.team_write_version`, migración `20261106120000_version_minima_equipo.sql`) y no el cuerpo de cada función:
ninguna función cambia, y una función nueva que escriba esas tablas queda frenada sola. La regla es la misma
(`private.require_session_write_version`): solo los pedidos de una sesión de la app, con el header contra la mínima y,
sin header, solo con una mínima de 0.099 o más. El rechazo es el mismo 503 `app_outdated`.

- Corre **después** de los permisos de cada función y solo cuando una fila se crea o cambia de verdad: repetir algo ya
  hecho (el mismo permiso, revocar lo revocado, el mismo rol) y leer siguen andando con cualquier versión.
- El rechazo deshace todo el pedido, también el reinicio de la rama que `share` y `create_invitation` hacen antes de
  escribir.
- `accept_invitations` también frena: quien tiene una invitación y abre una versión vieja entra igual (nunca corta la
  entrada), la app se actualiza sola y la acepta al volver a abrir.
- La consola, las migraciones, la clave de servicio y los hooks de login no se frenan.
- En la app: *Share* y *Members* dicen *This workspace needs a newer version of the app…* en vez del código
  (`src/ui/teamText.ts`). El servidor en memoria sigue la regla (`FakeServer.teamWriteVersion`).
- Pruebas: `src/sync/teamWriteVersion.test.ts` y `supabase/tests/version_minima_equipo_permisos.sql`. No sube
  `schema_version`.

### La versión mínima y la papelera de archivos (v0.218)

Lo último que quedaba afuera: mandar un archivo de la papelera de la app a la papelera de Drive. `purge_file` no lo
llama la app sino el portero, con la sesión de la persona, y el portero no sabía qué versión de la app se lo pedía. La
app ya se frena sola (con una versión menor que la mínima no manda nada de archivos), pero la base no podía exigirlo.

Tres piezas, pensadas para que el orden en que se publican no importe:

- **La app** le dice su versión al portero en `POST /trash`, en el cuerpo (`appVersion`). No en un header: un header
  nuevo no pasa el CORS de un portero anterior y el navegador cortaría el pedido entero.
- **El portero** se la pasa a la base en el header `x-shotdocs-version` de `purge_file`, sin decidir nada con ella (lo
  que no tiene forma de versión viaja como `invalid`, que la base rechaza). También la lee del header, que su CORS
  acepta desde esta versión.
- **La base** (`private.require_file_trash_version`, migración `20261109120000_version_minima_papelera_archivos.sql`):
  con el header, la regla de siempre (menor que la mínima o ilegible: 503 `app_outdated`, sin marcar nada); **sin el
  header pasa como hasta ahora**, salvo que la mínima sea 0.218 o más, la primera versión que lo manda. Corre después
  de los permisos y del estado del archivo y solo si va a marcar: repetir lo ya pedido no pasa por ahí, y la
  confirmación (`media_purged`) no se frena, para que lo pedido termine.

| La base | El portero | La app | Qué pasa |
|---|---|---|---|
| con la migración | anterior | cualquiera | Sin header: pasa como siempre (con la mínima menor que 0.218). |
| con la migración | nuevo | anterior (no dice su versión) | Sin header: lo mismo. |
| con la migración | nuevo | 0.218 o más | Se compara con la mínima. |
| sin la migración | cualquiera | cualquiera | La base ignora el header: como siempre. |

**Para cerrar del todo** (que una app anterior a la 0.218 tampoco pueda): subir `min_app_version` a 0.218 o más. Desde
ahí un pedido sin versión se rechaza. Antes de subirla, el portero tiene que ser el de esta versión (en Wanka se
publica solo con la app; un workspace con su propio portero lo actualiza primero): con un portero anterior y la mínima
en 0.218, mandar a Drive falla para todos con *The workspace did not answer (503)*.

**Es una guarda de compatibilidad, no de seguridad.** La versión la dice la app (acá y en todo lo demás que frena la
mínima) y nadie la comprueba: quien arme el pedido a mano puede mandar una más alta. Sirve para que una app vieja y
honesta no escriba; lo que cada persona puede hacer lo deciden los permisos, que van antes.

En la app: el portero contesta `426` con `code: 'app_outdated'`; la papelera avisa *This workspace needs a newer version
of the app…*, no deja un error en el archivo, *Empty* no sigue con los demás y la cola de archivos queda frenada como
con cualquier `app_outdated`. Pruebas: `src/media/trashVersion.test.ts` (que además ata el 0.218 de la migración, de su
prueba SQL y del servidor en memoria a la entrada del changelog que la nombra), `portero/src/core.test.ts` y
`supabase/tests/version_minima_papelera_archivos_permisos.sql`. No sube `schema_version`.

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
(`unchangedBlocks`, sobre una copia; un bloque cuyo XML cambia al leerlo, por tener algo que el esquema no conoce, no cuenta como igual y se reescribe, así se limpia como siempre) y `updateYFragment` los salta: sin eso, un bloque sin los atributos por defecto
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
`src/ui/restoreInDoc.test.tsx`, `src/ui/restoreInDocCheck.test.ts`, `src/ui/restoreInDocDefaults.test.ts` y `src/ui/restoreInDocGate.test.ts` (la compuerta de la copia).

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
   nunca empezó a instalar y ofrecía forzar. Desde v0.212, si después de una instalación fallida el servidor vuelve a publicar
   la misma versión que ya corre (se lee igual que para forzar), no queda nada por instalar y *Update now* recarga en vez
   de seguir diciendo que falló; sin poder leer la versión publicada, la falla anotada sigue valiendo. Solo si el navegador **nunca empezó** a instalar nada y el servidor publica otra versión
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
- **Los archivos del visitante** (entrega 2b, base 21): la cola de siempre, sin usos (`noUsage`), registra con
  `plink_register_file`, sube la miniatura y el original por el portero con los headers del link. **Lo escrito de una
  página no sale mientras su documento muestre un archivo agregado en este dispositivo que la base todavía no registró**
  (`PageDocs.holdUpload` con `MediaQueue.unregistered`, de cualquier página: también un bloque copiado a otra): en la sala
  se apartaría por `foreign_media` y, en cadena, todo lo que siga de esa sesión. Registrar despierta al motor; el
  original puede seguir subiendo después. Si el link muere con un archivo sin subir, la pantalla del link muerto lo
  ofrece para bajar (`linkUnsentMedia`).

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
