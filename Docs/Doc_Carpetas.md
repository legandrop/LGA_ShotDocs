# Arrastrar una carpeta entera (P.9)

Estado: **diseño, sin implementar**. Falta la auditoría previa y que Lega responda las decisiones del final.
Lo pidió Lega el 2026-09-30, al responder las decisiones de P.6 (`Doc_Adjuntos.md`): hoy una carpeta se
rechaza pidiendo que se comprima; él quiere subirla entera, con sus subcarpetas, y que en la página quede
algo que al hacer clic muestre lo que tiene adentro. Sale de leer el código de `main` (v0.051): `fileDrop.ts`,
`queue.ts`, `mediaDb.ts`, `attachments.ts`, el portero y las migraciones de archivos y de la papelera.

## Qué se pide

1. Arrastrar una carpeta (con subcarpetas) a la página. Va al Drive del dueño, como las fotos y los adjuntos.
2. Antes y durante la subida, una **ventana que muestra qué se sube**: "esta carpeta, con todo esto".
3. En la página queda **un bloque de carpeta**. Al hacer clic muestra su contenido **adentro de la app**.
4. **Permisos:** quien ve la página ve y baja lo de esa carpeta (como las fotos), pero **nunca** puede subir
   a la carpeta de arriba ni ver otras carpetas del Drive. Por eso no es un link de Drive: la app arma la
   lista con lo que sabe la base y el portero sirve cada archivo con los mismos pases de siempre.

## Reglas que no se rompen

- **Ningún tipo de bloque nuevo.** Una carpeta es **un bloque `image` con `url: sdmedia://<uuid>`**, como una
  foto o un adjunto; el uuid es el de una fila de `files` que representa la carpeta (sección 2). El bloque
  `file` de BlockNote sigue afuera (una versión vieja lo borraría, ver `Doc_Adjuntos.md`).
- **Nunca se agrega nada a `sdmedia://<uuid>`** (una versión vieja dejaría de reconocer el archivo y lo daría
  por quitado).
- Primero en el dispositivo (IndexedDB, la cola de `src/media/queue.ts`), después al Drive por el portero,
  registrado en `files`/`page_files`; para ver, un pase del portero por archivo. La papelera de archivos
  sigue funcionando igual, con la carpeta como un solo elemento.
- Lo que una versión vieja no conozca se ve raro, **nunca se borra**.
- El portero **nunca lista el Drive**: lo que se ve de una carpeta sale siempre de la base.

## Resumen

- **En la página:** un bloque `image` con `sdmedia://<id de la carpeta>`, dibujado como una tarjeta de
  carpeta (la misma técnica que la tarjeta de los adjuntos). Una versión vieja lo ve como un adjunto sin
  abrir, y no pierde nada.
- **En la base:** la carpeta es una fila de `files` con `mime = 'inode/directory'`; cada archivo de adentro es
  otra fila de `files` con `folder_id` (la carpeta) y `rel_path` (`Fotos/Dia 2/IMG_0001.jpg`). Los archivos de
  adentro **no** tienen filas en `page_files`: heredan el permiso, la papelera y el borrado de la carpeta.
  Migración nueva (sección 7).
- **En el Drive:** `LGA_ShotDocs/<Proyecto>/<AAAA-MM-DD>/<Carpeta>/<subcarpetas>/<archivo>`, creada por el
  portero a medida que llegan los archivos.
- **El visor:** una hoja o un diálogo con la lista (carpetas primero, después archivos), migas de pan que
  **empiezan en la carpeta** (nunca más arriba), el carrete para las fotos y videos, abrir o bajar para el
  resto y "Bajar todo" armado en el navegador.

## 1. Qué frena hoy una carpeta

| Dónde | Qué hace hoy |
|---|---|
| `src/ui/fileDrop.ts`, `takeFiles` | Mira `webkitGetAsEntry()` de cada ítem; si es una carpeta la cuenta en `folders` y la saltea. `PageEditor.tsx` avisa que hay que comprimirla. |
| `queue.ts`, `save` | Un archivo por vez, con su bloque; nada sabe de rutas ni de carpetas. `checkRoom` mira el espacio de a un archivo. |
| `queue.ts`, `round` | Procesa los pendientes por `createdAt`, uno por vez, hasta el final de la vuelta: una tanda de 500 archivos frenaría horas a la foto que se agregue después. |
| Portero, `startFileUpload` / `dayFolder` | Siempre sube a `LGA_ShotDocs/<Proyecto>/<día>`, sin subcarpetas. |
| Base (`files`, `page_files`) | Un archivo es visible si alguna página que lo usa es visible (`private.can_view_file`, `private.file_level`). No hay relación entre archivos. `size > 0`. |
| `private.refresh_file_trash` | Un archivo sin usos vivos en `page_files` entra a la papelera: un archivo de adentro, sin filas propias, entraría enseguida. |
| `project_sizes`, `trashed_files` | Suman o listan fila por fila: contarían la carpeta y cada archivo. |

## 2. En la página: qué bloque y cómo se degrada

Se compararon cuatro formas. La que decide es cómo reacciona la app publicada (v0.041 en adelante), porque
una versión vieja puede abrir la misma página en otro dispositivo.

| Forma | Versión vieja (v0.049–v0.051) | Versión vieja (v0.041–v0.048) | Papelera en versión vieja | Veredicto |
|---|---|---|---|---|
| **`image` con `sdmedia://<carpeta>`** (la carpeta es una fila de `files`) | Tarjeta de adjunto gris con el nombre y el peso total; al abrirla, el portero responde "abrila con la app actualizada". | Recuadro gris con el ícono de foto y el nombre; el carrete dice que no se pudo cargar. | `mediaIdsInDoc` la ve: copiar, pegar, mover y borrar el bloque registran y quitan el uso como con cualquier archivo. | **Elegida.** |
| `image` con `sdfolder://<id>` | Imagen rota (`<img src="sdfolder://…">`). | Imagen rota. | `mediaIdOf` no la reconoce: copiarla a otra página en una versión vieja no registra el uso. No se pierde nada (la versión nueva lo registra después), pero la carpeta queda sin contar mientras tanto. | Peor sin ganar nada. |
| Párrafo con una propiedad (`sdFolder`, como `driveCard`) | El párrafo con su texto. **Editar esa línea borra la propiedad** (`Doc_Sincronizacion.md`, "Links de Drive"): la carpeta desaparece de la página y la versión nueva la da por quitada. | Igual. | `mediaIdsInDoc` solo mira `url`: no la cuenta. | Riesgo real de perderla de la página. Descartada. |
| Bloque `file` o un bloque nuevo | **La borra** al abrir la página (no está en el esquema). | Igual. | — | Prohibido por la regla. |

**Por qué una fila de `files` para la carpeta:** así el uso en la página (`page_files`), la papelera, "de otro
proyecto" (`is_foreign`), el permiso (`file_level`), el bucket de miniaturas y el diálogo de Drive funcionan sin
caminos nuevos. La carpeta pesa lo que suman sus archivos (`size`, útil para la tarjeta de una versión vieja) y
tiene `item_count`. Su `drive_id` es el de la carpeta en Drive, cuando el portero la crea.

**La tarjeta:** sale de `display()` como las de los adjuntos (SVG generado, `data:image/svg+xml`, 360×96, sin
tiradores ni tamaños rápidos ni "Acomodar", fija). Un ícono de carpeta amarillo a la izquierda, el nombre en hasta
2 renglones y abajo "512 archivos · 4,2 GB". Estados, con la misma forma: guardando en el dispositivo (solo en el
que la soltó), subiendo "120 de 512", con errores, completa, de otro proyecto ("Carpeta de otro proyecto") y en la
papelera de Drive. `fileKind` sigue diciendo `'file'` para la carpeta (así el carrete la saltea y "Acomodar" corta
solos); una función aparte, `isFolderMime(mime)`, decide que el clic abra el visor y no una descarga. La tarjeta se
vuelve a dibujar con el mismo mecanismo que usa la miniatura cuando llega (`subscribeThumbs`), como mucho una vez
por segundo mientras sube.

**Clic:** igual que un adjunto (Doc_Adjuntos.md, sección 3): con el mouse el primer clic elige y el segundo abre
el visor; en el teléfono un toque lo abre; la barra espaciadora también. En la barra del bloque, *Open* abre el
visor y *Download* ofrece "Bajar todo".

## 3. Leer la carpeta

- **Soltar (computadora):** en el mismo manejador de `fileDrop.ts`, `webkitGetAsEntry()` de **todos** los ítems
  **en el acto** (la lista de ítems queda vacía al terminar el evento; las entradas sí siguen valiendo después).
  Después, sin apuro, se recorre cada carpeta con `createReader().readEntries()` **en bucle hasta que devuelva
  vacío** (Chrome entrega de a 100) y `entry.file()` para cada archivo. Anda en Chrome, Edge, Firefox y Safari de
  Mac. `DataTransferItem.getAsFileSystemHandle()` (solo Chromium) no suma nada para esto: no se usa.
- **Mezcla:** en un mismo soltar, los archivos sueltos siguen el camino de hoy (un bloque por archivo) y cada
  carpeta da un bloque de carpeta, en el orden en que llegaron.
- **Botón "Carpeta…"** (en el menú `/` y en la barra de la imagen, al lado de subir archivo): un
  `<input type="file" webkitdirectory>`. Cada `File` trae `webkitRelativePath`. Chrome pregunta "¿Subir N
  archivos a este sitio?": es del navegador. Con este camino **no llegan las carpetas vacías**.
- **iPhone y iPad:** arrastrar una carpeta desde Archivos a Safari no es confiable (a probar a mano: puede no
  llegar nada o llegar sin entradas). `webkitdirectory` en iOS **está por probar** (WebKit anunció soporte en
  versiones recientes; en las viejas se ignora y abre el selector de archivos común). Si en el iPhone no hay
  forma, el botón no aparece y el aviso de hoy (comprimirla) se queda para ese caso. Android: a probar
  `webkitdirectory` en Chrome.
- **Pegar** una carpeta copiada en el Finder: los navegadores no la entregan bien. Sigue rechazada con el aviso.
- **Qué se saltea** (y la ventana lo dice con el número): lo que empieza con punto (`.DS_Store`, `._foto.jpg`
  de AppleDouble, `.git`), `Thumbs.db`, `ehthumbs.db`, `desktop.ini`, `Icon\r`, las carpetas `__MACOSX`, los
  archivos de bloqueo de Office (`~$…`) y los **archivos vacíos** (la base pide `size > 0` y la cola ya rechaza
  el vacío). Una casilla "Incluir archivos ocultos" en la ventana (decisión 5). Las carpetas vacías no se crean.
- **Accesos directos y alias:** llegan como archivos chicos; se suben tal cual. Si leer un archivo falla (un
  permiso del sistema, un archivo que se movió mientras tanto), queda en la lista como "no se pudo leer" y el
  resto sigue.

## 4. La ventana: "esta carpeta, con todo esto"

Una sola ventana (no bloquea la página) con dos momentos:

1. **Antes de subir (confirmar):** el nombre, "512 archivos en 38 carpetas · 4,2 GB", el desglose por tipo (310
   fotos, 12 videos, 190 otros), el árbol plegable (primer nivel abierto), lo salteado ("Se saltean 23 archivos
   del sistema y 3 vacíos", con la lista), avisos (archivos de más de 1 GB, más de 1000 archivos, lugar en el
   dispositivo) y *Subir* / *Cancelar*. Con varias carpetas soltadas juntas, una fila por carpeta.
2. **Después (progreso):** la misma ventana pasa a mostrar las dos etapas: "Guardando en este dispositivo: 120 de
   512" y "Subiendo al Drive: 34 de 512 · 1,2 de 4,2 GB · faltan unos 6 min" (el tiempo sale del ritmo de los
   últimos minutos, redondeado). *Pausar* / *Seguir*, la lista de errores con *Reintentar* y *Cerrar* (sigue en
   segundo plano). Se vuelve a abrir desde la tarjeta (con la carpeta elegida, "Ver subida" en la barra) o desde el
   indicador de sincronización.

Otros dispositivos no ven la ventana: ven la tarjeta con "subiendo desde otro dispositivo" y, en el visor, los
archivos que todavía no llegaron marcados así.

## 5. En el dispositivo: guardar primero, entera o nada

- **Lugar:** antes de *Subir*, `navigator.storage.estimate()` con el total más el margen de siempre
  (`ROOM_MARGIN`, 200 MB, el texto de las páginas vive en la misma cuota). Si no entra, la ventana lo dice con los
  números ("hacen falta 4,2 GB y hay 2,9 GB libres") y no deja subir; con P.10 (`Doc_Copias_Locales.md`) ofrece
  además liberar las copias de archivos que ya están en Drive.
- **Guardar:** al tocar *Subir* se copian los archivos a IndexedDB **de a uno** (cada uno en su transacción, con
  su registro), con el progreso en la ventana. `hasUnsavedWrites()` cuenta la carpeta entera: cerrar la pestaña
  mientras se guarda pide confirmación.
- **Entera o nada:** el bloque se inserta en la página **recién cuando se guardaron todos**. Si la app se cierra en
  el medio, en la página no hay nada y lo guardado a medias se borra al volver a abrir (una carpeta en estado
  `copying` de hace más de 10 minutos, sin sesión que la esté guardando). Así nunca queda una carpeta incompleta que
  otros vean como "le faltan archivos para siempre": los `File` del soltar no sobreviven a un cierre y no hay cómo
  completarla.
- **Registros:** la carpeta es un `MediaRecord` más (con `mime: 'inode/directory'`, `size` total y `items`) y cada
  archivo de adentro otro, con `folderId` y `relPath` y **`pageId: ''`**. Mientras falta subir, los dos usan
  **`pending: 2`** en vez de 1 (el índice es un número): la versión vieja de la app, si llegara a correr con la
  misma base del dispositivo (una pestaña vieja abierta), solo busca `pending = 1` y no los toca, y su
  `reconcilePage` no los confunde con archivos propios de la página. La base del dispositivo **no cambia de
  versión** (son campos opcionales). Todo lo que hoy cuenta pendientes (`status`, `failures`, `clearBlocked`, la
  confirmación de sacar el workspace en `WorkspaceMenu.tsx`) pasa a mirar 1 y 2.
- Las miniaturas de las fotos y los videos de adentro se sacan como hoy (`ensureProbed`), después de guardar y sin
  frenar la subida del original (decisión 6).

## 6. La cola con cientos de archivos

- **Orden:** primero lo suelto (fotos y adjuntos de las páginas, los usos) y después los archivos de carpetas.
  Entre archivo y archivo de una carpeta, la vuelta se fija si llegó algo suelto y lo pasa adelante. Dentro de una
  carpeta, por `relPath` (el visor se va llenando en orden).
- **Registrar en tandas:** `register_folder` una vez y `register_folder_files` de a 200 archivos (no 500 llamadas).
- **En paralelo, un poco:** hasta 3 archivos chicos (menos de 8 MiB, una sola parte) a la vez; los grandes, de a
  uno como hoy. Con 500 archivos chicos, lo que manda es la cantidad de pedidos (unos 6 a 8 por archivo: miniatura,
  marcarla, abrir la subida, la parte, confirmar), no los bytes. Drive acepta unas pocas escrituras por segundo por
  usuario: con 3 alcanza y sobra.
- **Pausar y seguir:** por carpeta (`paused` en su registro); la cola saltea sus archivos. Una subida a medias
  guarda su `uploadId` y sigue desde lo que llegó, como hoy.
- **Errores:** cada archivo tiene su error y su `blocked`, como hoy; uno detenido no frena a los demás. La carpeta
  está "con errores" si alguno quedó detenido y "completa" cuando todos tienen `drive_id` confirmado en la base.
  "Drive lleno" (507) pausa la carpeta entera con el aviso.
- **El indicador de sincronización** cuenta una carpeta como un ítem con su detalle ("Referencias: 34 de 512"), no
  como 512 pendientes.
- **Confirmar:** `confirmed()` pregunta por tandas (`fetchMediaFiles` con varios ids).

## 7. La base: migración (diseño)

Una migración nueva, con la próxima versión libre (hoy sería la 8), y su constante propia en la app
(`FOLDERS_SCHEMA_VERSION`; `DB_SCHEMA_VERSION` no se sube, como con la papelera y el peso). Aplicarla pide
autorización de Lega (copia de seguridad antes, `npm run db:migrate`, `npm run db:test`).

**Columnas de `files`:**

- `folder_id uuid references public.files (id)`: en un archivo de adentro, su carpeta.
- `rel_path text`: la ruta adentro de la carpeta, con `/` y el nombre al final. De 1 a 1024 caracteres, sin `/`
  al principio ni al final, sin segmentos vacíos, `.` ni `..`.
- `item_count int check (item_count between 1 and 10000)`: solo en la fila de la carpeta.
- Restricciones: `(folder_id is null) = (rel_path is null)`; `mime = 'inode/directory'` ⇒ `folder_id is null` y
  `item_count is not null`; `item_count is not null` ⇒ `mime = 'inode/directory'`. Una carpeta no va adentro de
  otra: las subcarpetas son solo rutas.
- Índice único `(folder_id, rel_path) where folder_id is not null` (sirve también para listar).

**Funciones nuevas** (security definer, `search_path = ''`, sin `anon`, como las de siempre):

- `register_folder(p_id, p_page_id, p_name, p_items, p_size)`: como `register_file` con el tipo fijo; idempotente.
- `register_folder_files(p_folder, p_items jsonb)`: hasta 200 por llamada, cada uno con id, `rel_path`, nombre,
  tipo, peso, medidas y duración. Pide nivel 3 sobre la carpeta y que no esté pedida para la papelera de Drive;
  el proyecto es el de la carpeta; reintentar no duplica. Después de insertar, si la cantidad pasa `item_count` o
  la suma pasa `size`, error `folder_too_big` (nadie cuelga más de lo declarado). Los de adentro copian el estado
  de papelera de la carpeta al nacer.
- `folder_files(p_folder)`: la lista entera (id, `rel_path`, nombre, tipo, peso, medidas, `thumb_at`, si ya está
  en Drive), ordenada por `rel_path`. Pide `file_level(p_folder) >= 1` **una vez** (la política de `files` fila por
  fila, con cientos de filas, sería lenta).

**Funciones que cambian:**

- `private.can_view_file` y `private.file_level`: para una fila con `folder_id`, lo que dé la carpeta (más la regla
  de quien la creó, igual que hoy). La política de `files`, el bucket `thumbs`, `media_file`, `set_file_drive` y
  `set_file_thumb` quedan cubiertos solos.
- `media_file`: suma `folder_id`, `rel_path`, `folder_name`, `folder_drive_id` e `is_folder` (sumar campos no rompe
  al portero publicado).
- `private.refresh_file_trash`: no hace nada con una fila de adentro; al cambiar la carpeta, copia `trashed_at` a
  sus archivos.
- `purge_file` y `media_purged`: con la carpeta marcan también sus archivos; con un archivo de adentro, error
  (`file_in_folder`): no se manda a la papelera de a uno.
- `register_file` y `link_page_file`: rechazan un archivo de adentro (`file_in_folder`).
- `trashed_files` y `files_due_for_purge`: sin los de adentro; `trashed_files` suma `item_count` (columna nueva al
  final: la app publicada lee por nombre).
- `project_sizes`: sin las filas de carpeta (sus archivos ya cuentan, cada uno con el estado copiado).
- `schema_version` a la nueva y `notify pgrst, 'reload schema'`.

**Prueba SQL** `supabase/tests/carpetas_permisos.sql`, en una transacción que se deshace: dueña, admin, miembro con
Ver, Comentar, Editar, invitada con acceso a una sola página, miembro sacada, `anon`; que ver la página alcanza para
listar la carpeta y pedir cada archivo; que ver **otra** página del proyecto no alcanza; que colgar más de lo
declarado falla; papelera (sacar el bloque, restaurar la página, pedir la papelera de Drive) con los archivos
siguiendo a la carpeta; `project_sizes` y `trashed_files` sin contar dos veces; y que la app publicada (register,
link, unlink, trashed_files) sigue igual.

## 8. El portero y la estructura en Drive

```
LGA_ShotDocs
└── <Proyecto>
    └── <AAAA-MM-DD>                 (el día en que se soltó)
        └── Referencias              (la carpeta; appProperties: sdFile=<id>, sdFolder=1)
            ├── Fotos
            │   └── Dia_2
            │       └── IMG_0001.jpg (appProperties: sdFile=<id del archivo>)
            └── guion.pdf
```

- **Subir un archivo de adentro** (`POST /upload` con su `file`, como hoy): `media_file` dice su carpeta y su ruta.
  El portero crea la carpeta en Drive con el primer archivo que llega (y le avisa a la base con `set_file_drive` de
  la carpeta) y las subcarpetas que falten, cada una **una sola vez** (`once`, como el día) y anotada en su
  almacenamiento (`dir:<carpeta>:<ruta>` → id de Drive). Si una carpeta anotada ya no está o está en la papelera,
  se vuelve a crear (nada se borra, como hoy).
- **Nombres en Drive:** los de las carpetas se respetan (sin pasarlos a guiones bajos: son del usuario). Si en el
  mismo día ya hay una carpeta con ese nombre subida por la app, la nueva va con " (2)" para que el dueño las
  distinga al mirar su Drive (la app no depende del nombre: todo va por id).
- **Tope por pedido:** el plan gratis de Workers deja unas 50 llamadas por pedido; crear una ruta profunda de una
  vez podría pasarse. Profundidad máxima 20 y, si faltan muchas carpetas, el portero crea las que puede y responde
  "seguí" (la app repite).
- **Ver:** `POST /pass` con un archivo de adentro, igual que hoy (el nivel viene de la carpeta). `POST /pass` con la
  carpeta: `409` con `code: 'is_folder'` y un texto claro ("Esta carpeta se abre con la app actualizada"): es lo
  que ve una versión vieja al tocar *Download*.
- **Papelera:** `POST /trash` con la carpeta manda **la carpeta de Drive** a la papelera de Drive (Drive se lleva
  todo lo de adentro) y confirma con `media_purged`. Si todavía no existía en Drive, `drive: 'none'`, y cada
  archivo que termine de subir después se manda solo a la papelera de Drive (como hoy con `trashIfPurged`).
- **La marca `sdFile` también en la carpeta de Drive:** un portero viejo que recibe `/trash` de una carpeta la
  manda a la papelera sin problema; un `/pass` de un portero viejo daría un pase que falla al servirlo (Drive no
  baja carpetas): feo pero inofensivo.
- **Cómo sabe la app que el portero entiende carpetas:** `/drive/status` suma `features: ['folders']`. Sin eso (el
  portero se publica aparte y puede atrasarse), soltar una carpeta sigue rechazado con "El dueño tiene que
  actualizar el portero" (un portero viejo subiría todo aplanado en la carpeta del día).
- **Por qué no un zip en el portero:** un zip necesita calcular el CRC de todos los bytes (el plan gratis deja 10 ms
  de CPU por pedido) y pedir cada archivo a Drive (unas 50 llamadas por pedido): no entra ni para una carpeta
  mediana.

## 9. El visor, adentro de la app

- **Qué es:** un diálogo (en el teléfono, a pantalla completa) con el nombre y "512 archivos · 4,2 GB" arriba,
  *Bajar todo*, y la lista de la carpeta actual: primero las subcarpetas (con cuántos archivos tienen), después los
  archivos, en orden natural (`IMG_2` antes que `IMG_10`), con miniatura si hay (del bucket `thumbs`, pedidas a
  medida que aparecen en pantalla) o el ícono del tipo, el nombre y el peso. Arriba, migas de pan que empiezan en la
  carpeta: `Referencias › Fotos › Dia 2`. **No hay nada más arriba que la carpeta**: la lista sale de
  `folder_files`, que solo devuelve lo de adentro.
- **Lista o cuadrícula:** lista por defecto; un botón pasa a cuadrícula de miniaturas (útil para una carpeta de
  fotos). Se recuerda por dispositivo.
- **Abrir:** una foto o un video abre **el carrete con las fotos y videos de esa subcarpeta**, en el orden de la
  lista (hace falta que el carrete acepte una lista sin bloques: `CarreteItem.blockId` pasa a ser opcional, o un id
  armado; `carreteLoader.ts` ya trabaja por id de archivo). Un adjunto se abre o se baja como en la página
  (`attachmentOpen.ts`, `AttachmentSheet.tsx`), por id. Cada archivo pide su propio pase: nunca hay un pase para la
  carpeta.
- **Bajar uno:** *Download* en la fila (el pase con `?download=1`, o el original si está en el dispositivo).
- **Bajar todo:** se arma **en el navegador**. Cada archivo se pide con su pase y se escribe en un zip "sin
  comprimir" (lo de VFX ya viene comprimido; es rápido y no carga la CPU), con Zip64 para pasar los 4 GB, los
  nombres repetidos por mayúsculas y minúsculas desambiguados (" (2)") y la estructura de subcarpetas. Dónde se
  escribe:
  - Chrome y Edge de computadora: `showSaveFilePicker()` y se escribe a medida que llega (sin llenar la memoria).
    Además, "Bajar a una carpeta…" con `showDirectoryPicker()` escribe el árbol tal cual, sin zip.
  - Firefox y Safari: por el service worker (una dirección que la app responde con el zip a medida que se arma, como
    una descarga normal). Si no se puede, un zip en memoria con tope (1 GB; en el iPhone, 500 MB) y, pasado el tope,
    el aviso de bajarlos de a uno o desde la computadora.
  - Se puede cancelar; lo que falla (un archivo todavía sin subir, sin red) se saltea y se anota en un
    `LEEME_faltan.txt` adentro del zip.
  La librería: una chica de zip en streaming (del orden de 3 KB, a elegir en la implementación) o una propia de
  unas 200 líneas; nunca una que comprima en el hilo principal.
- **Sin red:** la lista queda guardada (en `meta`, `folder:<id>`, con los ids y rutas, más `known` de cada archivo):
  se ve la lista y las miniaturas ya bajadas; se abre solo lo que está en este dispositivo.
- **De otro proyecto** (se pegó la carpeta en una página de otro proyecto): tarjeta "Carpeta de otro proyecto", sin
  visor (como las fotos).

## 10. Permisos

- Quien ve la página ve la carpeta (el uso está en `page_files`, como cualquier archivo) y, a través de ella, **cada
  archivo de adentro**: `file_level(archivo) = file_level(carpeta)`. Ver, Comentar, Editar e invitados con acceso a
  esa página: ven y bajan. Subir a la carpeta: nadie (en esta entrega la carpeta no cambia, decisión 3).
- **Nunca hacia arriba:** la app no recibe nunca un id de Drive de la carpeta del día ni del proyecto (no están en la
  base); el id de Drive de la carpeta sí está en `files.drive_id`, pero sin acceso al Drive del dueño no sirve para
  nada, y el portero nunca sirve ni lista carpetas. Cada pase firma **un** id de Drive de un archivo, comprobado con
  su marca `sdFile`.
- **Nada se comparte en Google:** los miembros no tienen acceso al Drive del dueño; un link compartido de Drive
  dejaría subir a la carpeta de arriba. Por eso todo pasa por la app.
- Un archivo de adentro no se puede colgar de otra página (`register_file` y `link_page_file` lo rechazan): conocer
  su id no da permiso.

## 11. Papelera

- **Sacar el bloque** de la página: la carpeta entra a la papelera de archivos como **un solo elemento** ("Referencias
  · carpeta · 512 archivos · 4,2 GB"), con sus archivos detrás. **Restaurar** (deshacer, volver a pegar el bloque o
  restaurar la página) la saca con todo.
- **Mandar a la papelera de Drive** (dueño y admins, como hoy): una sola orden para la carpeta; Drive la guarda 30
  días con todo adentro. En la página, la tarjeta pasa a "en la papelera de Drive".
- **Si la carpeta todavía se estaba subiendo:** el dispositivo que la sube deja de subir sus archivos (no tiene
  sentido mandar gigas a la papelera) y la marca "cancelada: se mandó a la papelera de Drive". Las copias quedan en
  el dispositivo (nada se borra; se liberan con P.10).
- El total de la papelera y el peso del proyecto (P.7) cuentan una sola vez cada byte.

## 12. Tamaños, nombres y límites

- **Archivos por carpeta:** hasta 10.000 (tope de la base); aviso desde 1000 ("va a tardar"). Decisión 4.
- **Peso:** sin tope propio; manda el lugar del dispositivo (sección 5). Aviso, como los adjuntos, por cada archivo de
  más de 1 GB.
- **Profundidad:** 20 niveles. Ruta: 1024 caracteres.
- **Nombres:** cada segmento pasa por `cleanFileName` (controles, marcas de dirección, pares sueltos); si dos quedan
  iguales después de limpiar, el segundo lleva " (2)" antes de la extensión. Dos nombres que solo difieren en
  mayúsculas (llegan desde Linux) se permiten en la base y en Drive; el zip los desambigua.
- **La misma carpeta dos veces:** son dos carpetas (la app no compara contenidos).

## 13. Versiones viejas

| Quién | Qué ve y qué puede hacer | ¿Se pierde algo? |
|---|---|---|
| App v0.049–v0.051 | Tarjeta de adjunto gris con el nombre y el peso total. Abrir o bajar: el portero responde "abrila con la app actualizada". Copiar, mover, borrar el bloque y la papelera andan. | No. |
| App v0.041–v0.048 | Recuadro gris con el ícono de foto. El carrete: "no se pudo cargar" y *Download* con el mismo aviso. | No. |
| App nueva, base sin la migración | Soltar una carpeta: rechazado, "la base todavía no tiene carpetas" (lo ve el dueño). | — |
| App nueva, portero viejo | Soltar una carpeta: rechazado, "el dueño tiene que actualizar el portero". | — |
| Portero viejo con una carpeta ya subida | `/trash` de la carpeta anda (tiene la marca); `/pass` de la carpeta da un pase que falla al servir. Los archivos de adentro se ven bien. | No. |

**Sin subir `min_app_version`:** no hay propiedades nuevas en el bloque y una versión vieja no puede romper nada.

## Riesgos

- **El iPhone:** puede que no haya forma de elegir una carpeta. Se prueba antes de prometerlo; si no, en el iPhone se
  sigue pidiendo comprimir.
- **Espacio del dispositivo:** una carpeta de 20 GB necesita 20 GB en el navegador antes de subir (primero en el
  dispositivo). En Safari la cuota es más chica y puede borrar lo de un sitio que no se usó en días (por eso se pide
  `persist()`). P.10 alivia después, no antes. Alternativa a futuro (solo Chromium): guardar el acceso al archivo en
  vez de copiarlo; rompe la regla de "primero en el dispositivo" y queda afuera.
- **Tiempo:** cientos de archivos chicos tardan por la cantidad de pedidos, no por el peso.
- **Base:** cambian funciones centrales de permisos (`can_view_file`, `file_level`, `refresh_file_trash`); un error
  ahí afecta a todos los archivos. La prueba SQL tiene que cubrir la app publicada tal cual.
- **Cuota de Supabase (1 GB gratis):** una miniatura por foto de adentro (unos 30 KB): 10.000 fotos, unos 300 MB.
- **Pestaña vieja abierta en el mismo dispositivo:** `pending: 2` la aísla; una restauración de la base desde una
  copia, con una pestaña vieja, podría dejar errores a la vista (nunca pérdida).
- **Drive:** carpetas creadas a mano por el dueño dentro de la carpeta de la app no aparecen en la app (la lista sale
  de la base). Es lo esperado, pero conviene decirlo en el diálogo de Drive.

## Entregas y pruebas

1. **Entrega 0, prueba a mano (sin código de la app):** leer carpetas al soltar y con `webkitdirectory` en Chrome,
   Firefox, Safari de Mac, iPhone (Safari y la app instalada), iPad y Android; anotar qué llega (carpetas vacías,
   rutas, ocultos).
2. **Entrega 1a, base y portero:** la migración con su prueba SQL (aplicada solo con permiso de Lega), `media_file`
   con la carpeta, subcarpetas en Drive, `is_folder`, `/trash` de carpetas, `features: ['folders']`, con pruebas en
   `portero/src/core.test.ts` (rutas profundas en varios pedidos, subcarpeta en la papelera que se vuelve a crear,
   pase de carpeta rechazado, papelera con archivos subiendo).
3. **Entrega 1b, app:** leer la carpeta, la ventana, guardar entera o nada, la cola (orden, tandas, paralelo, pausa),
   la tarjeta, el visor con lista, carrete y abrir o bajar uno, la papelera como un solo elemento, textos, docs.
4. **Entrega 2:** *Bajar todo* (zip en streaming y "Bajar a una carpeta…"), cuadrícula.

Pruebas de la app: unidad (recorrer entradas con más de 100 por carpeta, salteados, nombres limpios y repetidos,
`pending: 2` invisible para la consulta vieja, orden de la cola con algo suelto en el medio, pausa, error de un
archivo que no frena, "entera o nada" al cerrar a mitad de camino, lugar insuficiente, zip con Zip64 y nombres
repetidos), jsdom con el esquema publicado (una página con una carpeta se abre, se edita y se mueve sin perder
nada; `mediaIdsInDoc` la cuenta), jsdom con el editor nuevo (soltar `[carpeta, a.pdf]` da dos bloques `image` en
orden), y de punta a punta con el portero real: una carpeta de 500 archivos en 3 niveles, verla desde otra cuenta con
permiso de Ver, que una cuenta sin la página no la vea, bajar todo, papelera y restaurar.

## Decisiones (a confirmar por Lega)

1. Una carpeta es un bloque `image` con `sdmedia://` y una fila de `files` (no un párrafo con propiedad ni un esquema
   nuevo).
2. En el Drive va en la carpeta del día: `<Proyecto>/<AAAA-MM-DD>/<Carpeta>/…` (y no, por ejemplo,
   `<Proyecto>/Carpetas/<Carpeta>`).
3. **La carpeta no cambia después de subida** (no se agregan ni se sacan archivos adentro; para cambiarla, se suelta
   de nuevo). Agregar archivos a una carpeta existente, más adelante.
4. Hasta 10.000 archivos por carpeta, aviso desde 1000; sin tope de peso más que el lugar del dispositivo.
5. Se saltean los archivos del sistema y los vacíos, con una casilla para incluir los ocultos.
6. Miniatura para cada foto y video de adentro (se ve lindo en la cuadrícula; ocupa la cuota de Supabase).
7. Se inserta el bloque recién cuando la carpeta entera quedó guardada en el dispositivo.
8. *Bajar todo* como zip armado en el navegador (en Chrome, también "Bajar a una carpeta…"), en una segunda entrega.
9. En el iPhone, si la prueba de la entrega 0 sale mal, se sigue pidiendo comprimir.
