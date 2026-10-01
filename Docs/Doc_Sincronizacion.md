# Sincronización offline

Cómo funciona hoy la regla de no perder nunca información. El código está en `src/sync/` y las pruebas
(`npm test`) en `src/sync/sync.test.ts`, `audit.test.ts` (los casos de la auditoría de la fase 1),
`editor.test.ts` (con el editor real, en jsdom), `docs.test.ts` (qué falta subir después de bajar y la
semilla solo en memoria), `projects.test.ts` (proyectos en la cola, también sin
red y rechazados), `restore.test.ts` (la generación al restaurar una copia y la versión mínima del
workspace, y el aviso de base vieja), `src/workspace.test.ts` (los nombres de lo guardado en el
dispositivo), `src/workspaces.test.ts` (la lista de workspaces del dispositivo, los nombres de Wanka, los
links de invitación, cambiar y quitar) con sus pantallas montadas en `src/ui/workspaces.test.tsx`,
`src/ui/unknownContent.test.ts` (la guarda del editor contra lo desconocido),
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
   confirma al subir (punto 3) o manda al bajar (punto 4). Los borrados viajan siempre todos en cada
   subida (Yjs los manda enteros), así que no dependen del vector.
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
  archivo (HEIC en Chrome de Windows, un video que no decodifica), no hay miniatura ni medidas: se
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
  con la miniatura si Storage no contesta (v0.070; ver "Cada consulta a la base tiene un tope de tiempo").
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
decenas de KB; los originales van al Drive por el portero). No pasan por `timed`: son una carrera contra el
tope (`within` en `remote.ts`), que termina en el mismo `request_timeout`.

| Pedido | Tope | Si vence |
|---|---|---|
| Subir la miniatura (`uploadThumb`) | `timeoutFor(tamaño)`: 30 s más lo que tarda a 16 KB/s (40 s para 160 KB; 62 s para 512 KB, lo máximo que acepta el bucket) | El archivo vuelve a la cola con su espera (10 s, 20 s… hasta 10 minutos) y el aviso *The upload stopped moving; it will try again*; la vuelta sigue con los demás |
| Bajar la miniatura de otro dispositivo (`downloadThumb`) | 62 s (`THUMB_DOWNLOAD_TIMEOUT_MS`): no se sabe de antemano cuánto pesa, se le da lo de la más pesada posible | Al final de la vuelta: no se piden las demás miniaturas en esa pasada (los adjuntos, que no piden nada a Storage, sí se actualizan) y se vuelve a preguntar un minuto después del corte. Al dibujar la página: queda el ícono y se vuelve a preguntar |

- **Subir no se puede cortar:** el cliente de Storage (`@supabase/storage-js` 2.117) no acepta una señal de
  corte en `upload`; en `download` sí, y se le pasa. La subida cortada queda suelta y puede terminar sola.
  No hace daño: no reemplaza (`upsert: false`), así que el reintento se encuentra con que ya está (409) y
  lo da por hecho; `thumb_at` se marca recién después de una subida confirmada.
- **No se marca ni se pierde nada:** la miniatura sigue por subir (`thumb: 'local'`), el original sigue en
  el dispositivo y todavía no fue al portero.
- **Por qué no cuenta como "sin red"** (que corta la vuelta): la vuelta siguiente empezaría otra vez por el
  mismo archivo, porque van por orden de llegada, y con Storage colgado solo para él los demás no subirían
  nunca. Una falla de red de verdad (el pedido falla en vez de colgarse) sigue cortando la vuelta.
- **El minuto de la bajada se cuenta desde el corte,** no desde que se preguntó: el tope (62 s) dura más
  que esa espera (60 s), y contado desde el principio la vuelta siguiente volvería a pedir enseguida.
- **Lo que queda afuera** (`Doc_Roadmap.md`, B.11): con Storage colgado para todos, la vuelta gasta de 30
  a 62 s en cada archivo con miniatura por subir, en vez de cortarse; el tope de la subida no crece entre
  reintentos; las subidas sueltas se acumulan; y las imágenes del bucket `page-files` (un workspace sin
  portero, `files.ts`) siguen sin tope.
- Pruebas: `src/sync/remoteTimeout.test.ts` (el tope) y `src/media/queue.test.ts`, "miniaturas que Storage
  no contesta" (lo que hace la cola).

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
  service worker precachea todos los `.js` (`globPatterns` en `vite.config.ts`): con la app instalada, el
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
  dispositivo), y pide actualizar; al actualizar, sube todo.

**Regla para un bloque nuevo:** antes de publicar la versión que lo trae, subir `min_app_version` a la
primera versión con la guarda (0.021) o más, para que ninguna versión sin guarda pueda mandar el borrado.

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
  marcas, no propiedades, así que no la bloquea. Lo prueban `ui/driveCard.test.ts` con el esquema de `main`
  (`ui/fixtures/editorSchemaMain.ts`), `ui/driveLinks.test.ts` y `ui/DrivePasteMenu.test.tsx`.
- **El fixture se actualiza en cada publicación:** `ui/fixtures/editorSchemaMain.ts` es la copia del
  `ui/editorSchema.ts` de `main`. Al publicar, se reemplaza por el de la nueva `main` (entonces ya con
  `driveCard`), para que las pruebas sigan comparando contra la versión publicada.
- **Después de publicar** la versión con las tarjetas, subir `workspace_settings.min_app_version` a esa
  versión (regla de la sección 11 de `Plan_Workspaces.md`): así ninguna versión anterior vuelve a sacarle la
  propiedad a una tarjeta al editarla.
- **La copia liviana de un video** (para verlo sin el reproductor de Drive) queda para más adelante, solo si
  hace falta: sin un servidor que convierta videos, se haría en el navegador.

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
