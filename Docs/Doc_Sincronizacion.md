# Sincronización offline

Cómo funciona hoy la regla de no perder nunca información. El código está en `src/sync/` y las pruebas
(`npm test`) en `src/sync/sync.test.ts`, `audit.test.ts` (los casos de la auditoría de la fase 1),
`editor.test.ts` (con el editor real, en jsdom), `projects.test.ts` (proyectos en la cola, también sin
red y rechazados), `restore.test.ts` (la generación al restaurar una copia y la versión mínima del
workspace, y el aviso de base vieja), `src/workspace.test.ts` (los nombres de lo guardado en el
dispositivo), `src/ui/unknownContent.test.ts` (la guarda del editor contra lo desconocido),
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
| Estructura | `structure.ts` | La raíz inicial de cada página (la "semilla") y la reparación de documentos viejos con dos raíces (ver "Fusión"). |
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
  tiene pero la base no se enteró), sigue pendiente y se vuelve a preguntar: el portero le avisa a la base
  sin volver a subir el archivo. Un portero anterior al paso 6 no manda `linked` ni le avisa a la base: el
  archivo queda pendiente con el aviso *The media server needs an update*. Un archivo de una página que
  todavía no existe en el servidor espera a que la página suba.
- **Errores:** sin red (o sin respuesta del portero) espera a la próxima sincronización. Lo que se puede
  arreglar solo (sesión renovándose, Drive sin conectar, 5xx) se reintenta esperando cada vez más, hasta
  10 minutos, con el error a la vista. Lo que no (`page_not_found`, `file_other_project`, un 400, 403 o
  404 del portero) queda detenido y a la vista, **sin descartar el archivo**, y se reintenta con "Retry" o
  al abrir la app (lo detenido se vuelve a registrar: `register_file` es idempotente). Si el servidor dice
  que no existe un archivo que acá figura registrado (un 404 del portero, `file_not_found`), se vuelve a
  registrar en vez de detenerlo; recién si sigue igual tres veces seguidas, se detiene.
- **Si la base de archivos del dispositivo no se abre,** la app arranca igual: la cola de fotos y videos
  queda apagada (no se pueden agregar), el estado lo avisa y el texto sincroniza como siempre. Un error de
  esa base nunca corta la sincronización del texto.
- **Qué páginas usan cada archivo** (`page_files`): el dispositivo que registra un archivo ya lo cuelga de
  su página. Cuando una página tiene un `sdmedia://` que llegó de otra (se copió o se pegó el bloque), al
  abrirla y con cada cambio hecho en ella se pide `link_page_file`. Los pares ya vistos se guardan en el
  dispositivo para no llamar de más. Si el archivo todavía no está en el servidor (`file_not_found`: lo
  registra otro dispositivo), se espera y se reintenta más tarde sin contarlo como pendiente; lo mismo si la
  persona no puede editar esa página.
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
  subida a medias sigue desde donde quedó). Si la base de archivos del dispositivo falla justo ahí, el
  texto se recupera igual; lo pendiente se recupera cuando el servidor diga que no lo tiene (ver
  "Errores"), pero lo que ya estaba subido no se vuelve a registrar (caso raro, queda anotado).
- **La carpeta en Drive** (paso 8): el dueño la elige en el menú de la cuenta → *Google Drive* (estado de la
  conexión, conectar o reconectar, dónde está `LGA_ShotDocs` y *Choose folder…* con el selector de
  Google). Sin `GOOGLE_API_KEY` en el portero, va a la raíz de *My Drive* (`Doc_Portero.md`, paso 2b). Al
  volver de Google (`?drive=`), el diálogo se abre solo para el dueño; a otra persona no le ofrece
  conectar ni elegir.

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
- **Errores:** sin red, espera. Un error que se arregla solo (un 500, la sesión renovándose) se reintenta
  en la próxima sincronización con el error a la vista (`commentError`). Un rechazo (`comment_denied`,
  `not_allowed`, `comment_deleted`, `comment_conflict`...) queda en el dispositivo con el motivo en
  palabras, en el panel (junto al comentario) y en el estado ("rejected by the server"), **y no se
  descarta solo**: se reintenta con "Retry" o al abrir la app, y solo la persona puede descartarlo
  ("Discard", que se lleva también las respuestas sin subir de un hilo descartado). Lo demás de la cola
  sigue subiendo.
- **Bajar:** los comentarios de la página abierta se bajan al abrirla y en cada sincronización mientras
  siga abierta, y se guardan (con los correos) para verlos sin red. Con la base anterior a la versión 5
  nada se manda: lo escrito queda en el dispositivo y el estado avisa que falta migrar.
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
  bloque (el tirador de la izquierda) y con Ctrl/⌘+Alt+M.
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
contenido nuevo, imágenes pendientes y comentarios (subir la cola y bajar los de las páginas abiertas).
Las imágenes y los comentarios van al final y sus errores no cortan el ciclo: una foto grande en una red
mala no frena el texto. Corre al abrir la app, un poco después de cada cambio, cada 10
segundos con la app a la vista, al volver la red y al volver a la ventana. Al final de cada ciclo arranca,
sin esperarla, la cola de fotos y videos, que tiene su propio ciclo (ver "Archivos grandes").

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
  cambios): el servidor la rechazaría en cada apertura. La estructura inicial (`seedIfEmpty`) se pone solo
  con los permisos ya conocidos y "Edit"; con menos de 4 no se ofrece crear páginas adentro, mover
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
  abre la página (`src/invite.ts`). De otro workspace, por ahora avisa que llega más adelante (paso 12).

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
  usuario, la de `:media` y la de `:comments`, olvida lo que la app recordaba de ese workspace (proyecto
  elegido, últimas páginas, el link de invitación pendiente) y cierra la sesión. Si otra pestaña tiene la
  base abierta, avisa que se cierren las otras pestañas y se reintenta (nunca queda colgado); con cambios sin bajar, pide confirmación antes. Sin cambios
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
`script: true` (D-14), y así las preguntas: un párrafo con `question: true` (ver "Comentarios y
preguntas").

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
