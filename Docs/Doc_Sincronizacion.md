# Sincronización offline

Cómo funciona hoy la regla de no perder nunca información. El código está en `src/sync/` y las pruebas
(`npm test`) en `src/sync/sync.test.ts`, `audit.test.ts` (los casos de la auditoría de la fase 1),
`editor.test.ts` (con el editor real, en jsdom), `projects.test.ts` (proyectos en la cola, también sin
red y rechazados), `restore.test.ts` (la generación al restaurar una copia y la versión mínima del
workspace, y el aviso de base vieja), `src/workspace.test.ts` (los nombres de lo guardado en el
dispositivo), `src/ui/unknownContent.test.ts` (la guarda del editor contra lo desconocido),
`src/media/queue.test.ts` (la cola de fotos y videos) y `src/ui/media.test.ts` (`sdmedia://` con el
editor de la versión publicada).

## Piezas

| Pieza | Archivo | Qué hace |
|---|---|---|
| Base local | `localDb.ts` | Una base IndexedDB por workspace y usuario (`shotdocs:<clave local>:<userId>`, ver abajo), compartida por todos los proyectos de la app: copia del árbol, cola de salida, updates de contenido, estado de cada página e imágenes. |
| Contenido | `docs.ts` | Un documento Yjs por página. Guarda cada edición en el dispositivo y sube o baja lo que falte. |
| Estructura | `structure.ts` | La raíz inicial de cada página (la "semilla") y la reparación de documentos viejos con dos raíces (ver "Fusión"). |
| Árbol | `tree.ts` | La copia del árbol que mandó el servidor más la cola de cambios locales encima. |
| Imágenes | `files.ts` | Guarda la imagen pegada en el dispositivo y la sube cuando hay red (sin portero). |
| Fotos y videos | `../media/queue.ts` | Los guarda en el dispositivo (base aparte) y los sube al Drive del dueño por el portero. Ver "Archivos grandes". |
| Servidor | `remote.ts` | Las llamadas a Supabase. Las pruebas usan un servidor en memoria con las mismas reglas (`testing.ts`). |
| Motor | `engine.ts` | El ciclo de sincronización y el estado que muestra la app. |

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
cliente global. Hasta que exista la lista de workspaces del dispositivo (paso 12), el único es el de la
compilación (`SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`).

**Sin proyectos.** El servidor ya no crea "My project" para una cuenta nueva: `ensure_workspace()` devuelve
el primer proyecto propio de la persona, o nada (lo compartido se suma en el paso 9, cuando las políticas
dejen verlo). Sin ninguno, la app muestra *No projects yet* y vuelve
a preguntar sola cada minuto, al volver a la ventana y al volver la red; el dueño y los admins ven además
el botón para crear el primero.

**Versión de la base.** La app sabe qué versión de la base necesita (`DB_SCHEMA_VERSION`) y la compara con
`workspace_settings.schema_version` en cada sincronización. Si la del workspace es menor, el estado dice
el ícono de advertencia y el detalle explica que el dueño tiene que aplicar las migraciones; nada se
pierde mientras tanto.

## Contenido de las páginas

1. **Primero el dispositivo.** Cada edición se guarda en IndexedDB en cuanto ocurre. Mientras una escritura
   está en curso, las ediciones siguientes se juntan y salen todas en la próxima transacción, así nunca se
   acumula una fila de escrituras: si la app se cierra de golpe, lo único que puede faltar es lo de la
   última transacción, y el navegador pide confirmación antes de cerrar si hay algo sin guardar.
   Si guardar falla (por ejemplo, disco lleno), la edición queda en memoria, se reintenta cada 3 segundos,
   cuenta como pendiente y la app lo avisa en rojo hasta que se pueda guardar.
2. **Qué falta subir.** Cada página guarda `syncedSV`, el vector de estado de Yjs de lo que el servidor ya
   confirmó. Lo pendiente es siempre la diferencia entre el documento local y ese vector, así que no
   importa si la app se cerró a mitad de camino: al volver se recalcula entera.
3. **Envío con confirmación.** Lo que se sube se calcula desde lo guardado en IndexedDB, leído en la misma
   transacción que el contador de ediciones: la confirmación nunca cubre algo que no viajó. Antes de
   enviar, el update se guarda con un id propio. Si la respuesta no llega, se reenvía el mismo update con
   el mismo id y el servidor devuelve el mismo `seq` sin duplicar nada. Recién con la confirmación avanza
   `syncedSV`. Si el servidor lo rechaza para siempre (por ejemplo, por tamaño), la página queda marcada
   como rechazada, la app lo avisa y se reintenta al abrirla de nuevo o con "Retry".
4. **Bajar lo nuevo.** El árbol trae el último `seq` de cada página. Si es mayor que el que tiene el
   dispositivo, se bajan los updates posteriores y se guardan en la misma transacción que el nuevo cursor.
   Así se bajan también las páginas que nunca se abrieron en ese dispositivo, y quedan disponibles offline.
5. **Fusión.** Dos dispositivos que editan la misma página sin red se fusionan con Yjs al volver. El editor
   guarda cada página bajo una única raíz; si cada dispositivo creara la suya, al fusionarse quedarían dos
   y el editor borraría la que no puede mostrar. Para que eso no pase, al abrir una página vacía para
   editar se le pone una **semilla**: la raíz inicial, escrita con un autor de Yjs y un contenido que salen
   del id de la página. Todos los dispositivos escriben exactamente la misma semilla, así que Yjs la toma
   como un solo cambio y hay una sola raíz. Lo que dos personas escriben a la vez en el mismo renglón se
   fusiona letra por letra, como en cualquier editor colaborativo.
   Las páginas creadas antes de la semilla (v0.008) pueden tener igual dos raíces; para ellas queda la
   reparación: al abrir y al recibir cambios, las raíces sobrantes se juntan en la primera en la misma
   transacción que aplica lo recibido. La reparación copia los bloques y borra la raíz sobrante, así que lo
   que otro dispositivo escriba en esa raíz después de la copia se pierde: por eso es solo el último
   recurso. `src/sync/editor.test.ts` prueba los dos casos con el editor real.
6. **Páginas a medio bajar.** Si el servidor tiene contenido de una página que el dispositivo no, se baja
   antes de mostrar el editor. Si no llega (sin red o muy lento), se muestra lo que hay en el dispositivo
   en **solo lectura**, con un aviso, y la página pasa a editable sola cuando llega lo que falta. Lo que
   sube el propio dispositivo cuenta como bajado (si nadie subió nada en el medio), así que una página
   que solo se editó acá siempre se abre para editar, con red o sin ella.
7. **Compactación local.** Con más de 64 updates guardados, al abrir la página se fusionan en uno solo, en la
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
(`user_settings`). Gana el último cambio, igual que con los ajustes de una rama.

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
  (`src/ui/media.test.ts`, con una copia del esquema de `main` en `src/ui/fixtures/`). El bloque `image`
  acepta videos al elegir, pegar o soltar un archivo (cambia lo que ofrece el selector, no el bloque).
- **Primero en el dispositivo:** el archivo se guarda en otra base IndexedDB, `<base local>:media` (la de
  siempre no cambia de versión: una versión vieja de la app no podría abrirla), con su id, página,
  proyecto, nombre, tipo (en minúsculas, sin parámetros; si el navegador no lo da, sale de la extensión),
  peso, ancho, alto, duración, el día local (`AAAA-MM-DD`), la miniatura y el archivo, todo en una sola
  transacción. Recién después se pone el bloque en la página. Mientras se guarda, el navegador pide
  confirmación antes de cerrar. El original queda en el dispositivo también después de subirlo.
- **Miniatura:** se hace al elegir el archivo. Foto: reducida a 480 px de lado mayor, JPEG de calidad 0.8
  (baja la calidad si pasa de 512 KB). Video: un cuadro cerca del primer segundo. Si el navegador no puede
  abrir el archivo (HEIC en Chrome de Windows, un video que no decodifica), no hay miniatura ni medidas:
  se registra y se sube igual, y en la página queda un ícono con el nombre. **Queda para después:** que
  otro dispositivo que sí pueda abrirlo genere la miniatura que falta (`thumb_at` en null).
- **Subida, con su propio ciclo** (una subida de minutos no frena al texto; nunca hay dos vueltas a la
  vez): `register_file` → miniatura a `thumbs/<id>.jpg` sin reemplazar (si ya existe, está hecho) y
  `set_file_thumb` → portero, `POST /upload` con `{ file, name, mime, size, day }` y partes de 8 MiB
  (`PUT /upload/<id>`) → subido cuando el portero responde `done`. Cada paso queda anotado apenas termina
  (también el id de la subida y hasta dónde llegó, con cada parte): si la app se cierra a la mitad, al
  volver sigue desde ahí, y el portero dice cuánto le llegó. Todos los pasos son idempotentes: repetir uno
  cuya respuesta se perdió no duplica nada. Si el portero responde `done` con `linked: false` (Drive lo
  tiene pero la base no se enteró), sigue pendiente y se vuelve a preguntar: el portero le avisa a la base
  sin volver a subir el archivo. Un archivo de una página que todavía no existe en el servidor espera a
  que la página suba.
- **Errores:** sin red (o sin respuesta del portero) espera a la próxima sincronización. Lo que se puede
  arreglar solo (sesión renovándose, Drive sin conectar, 5xx) se reintenta esperando cada vez más, hasta
  10 minutos, con el error a la vista. Lo que no (`page_not_found`, `file_other_project`, un 400, 403 o
  404 del portero) queda detenido y a la vista, **sin descartar el archivo**, y se reintenta con "Retry" o
  al abrir la app.
- **Qué páginas usan cada archivo** (`page_files`): el dispositivo que registra un archivo ya lo cuelga de
  su página. Cuando una página tiene un `sdmedia://` que llegó de otra (se copió o se pegó el bloque), al
  abrirla y con cada cambio hecho en ella se pide `link_page_file`. Los pares ya vistos se guardan en el
  dispositivo para no llamar de más. Si el archivo todavía no está en el servidor (`file_not_found`: lo
  registra otro dispositivo), se espera y se reintenta más tarde sin contarlo como pendiente; lo mismo si la
  persona no puede editar esa página.
- **Mostrar:** una foto de este dispositivo se muestra entera desde el dispositivo; si no, la miniatura
  del bucket `thumbs` (bajada con la sesión y guardada en el dispositivo, así se ve sin red). Un video
  muestra su miniatura con una marca de "play". Un clic en la página abre un visor simple (hasta el
  carrete del paso 7): el original si está en el dispositivo (anda sin red) o el archivo entero con un
  pase del portero (`POST /pass` con `{ file }`).
- **Cuenta en los cambios pendientes** (`pendingMedia` en el estado), también los usos de páginas por
  confirmar. Los detenidos por un error cuentan como rechazados (`failedMedia`).
- **Restaurar una copia:** todo lo de este dispositivo vuelve a la cola (registrar, miniatura, usos de
  páginas); el archivo no se vuelve a subir, porque el portero recuerda lo que ya subió a Drive.
- **La carpeta en Drive** (paso 8): el dueño la elige en el menú de la cuenta → *Google Drive* (estado de la
  conexión, conectar o reconectar, dónde está `LGA_ShotDocs` y *Choose folder…* con el selector de
  Google). Sin `GOOGLE_API_KEY` en el portero, va a la raíz de *My Drive* (`Doc_Portero.md`, paso 2b).

## Ciclo de sincronización

Nunca corren dos a la vez. En orden: los ajustes del workspace (ver abajo), cambios del árbol, los proyectos y sus páginas, contenido pendiente,
contenido nuevo e imágenes pendientes. Las imágenes van al final y sus errores no cortan el ciclo: una foto
grande en una red mala no frena el texto. Corre al abrir la app, un poco después de cada cambio, cada 10
segundos con la app a la vista, al volver la red y al volver a la ventana. Al final de cada ciclo arranca,
sin esperarla, la cola de fotos y videos, que tiene su propio ciclo (ver "Archivos grandes").

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
nombre y el error en el detalle.

## Sin red al abrir

- La app queda en caché con un service worker (PWA), así que abre sin red, en cualquiera de sus
  direcciones (`/`, `/p/<uuid>`, `/trash`, `/media-test`; ver `index.md`).
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
`script: true` (D-14).

Desde v0.021 hay dos protecciones para poder sumar tipos de bloque (y marcas) nuevos:

- **La guarda del editor** (`ui/unknownContent.ts`). Antes de abrir una página se revisa que todo lo que
  trae (tipos de bloque, contenido en línea, marcas de texto) esté en el esquema de esta versión. Si no,
  la página no se abre en el editor: se ve un aviso para actualizar la app, y nada se borra. Lo mismo con
  cada cambio que llega con la página abierta: se guarda en el dispositivo pero no entra al editor, que
  se cierra. Los atributos desconocidos de un bloque no cuentan: se ignoran sin borrar nada.
- **La versión mínima del workspace** (`workspace_settings.min_app_version`). Cada subida de contenido
  lleva la versión de la app, y el servidor rechaza las de una versión menor (también las de versiones
  anteriores a v0.021, que no mandan versión). La app vieja lo ve, deja de subir contenido (queda en el
  dispositivo), y pide actualizar; al actualizar, sube todo.

**Regla para un bloque nuevo:** antes de publicar la versión que lo trae, subir `min_app_version` a la
primera versión con la guarda (0.021) o más, para que ninguna versión sin guarda pueda mandar el borrado.

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
