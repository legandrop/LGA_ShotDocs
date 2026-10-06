# Arrastrar una carpeta entera (P.9)

Estado: **entrega 1 implementada (v0.081, rama `lega/carpetas`)**, con lo que no depende de Lega; ver "Cómo
quedó" justo abajo. **Entrega 2 (*Download all*) implementada** (rama `lega/carpetas-zip`): "Cómo quedó (entrega 2)". **Entrega 3 (los
restos de las auditorías y las subidas que se traban, v0.142, rama `lega/carpetas-e3`):** "Cómo quedó (entrega 3)". **Entrega 4 (los restos de la
entrega 3, v0.149, rama `lega/carpetas-e4`):** "Cómo quedó (entrega 4)". El diseño sigue debajo. Rediseñado el 2026-09-30 con las respuestas de Lega (ver "Respondidas por
Lega"): la carpeta de la página es **una vista en vivo de una carpeta del Drive**, sin tope de archivos y en el
plan gratis de Cloudflare. El primer diseño (commit `47bbbf4`, una fila de `files` por archivo) y su auditoría
quedan resumidos al final, en "Historia"; lo que la auditoría encontró y sigue valiendo está incorporado.
Sale de leer `fileDrop.ts`, `queue.ts`, `mediaDb.ts`, `attachments.ts`, el portero (`portero/src/`) y las
migraciones de archivos y de la papelera en `main` (v0.051).

## Cómo quedó (entrega 1, v0.081)

**Qué ve el usuario.** Soltar una carpeta en la página abre la ventana "Upload this folder to Google Drive?": el
nombre, "512 files in 38 folders · 4,2 GB", el desglose por tipo, el árbol plegable (hasta 300 renglones), lo
salteado con su lista, la casilla *Include hidden files*, los avisos (más de 1000 archivos, archivos de más de
1 GB), quién la va a ver y que la pestaña tiene que quedar abierta. *Upload* registra la carpeta, pone su bloque
donde se soltó (después de los archivos sueltos del mismo soltar) y muestra cómo va: barra, "34 of 512 files ·
1,2 of 4,2 GB", lo que falta, *Pause* / *Resume*, los errores por archivo con *Retry*, *Open the folder* y
*Close* (sigue en segundo plano). La tarjeta de la carpeta (SVG de 360×96, como la de un adjunto, con una
carpeta) dice "Google Drive folder · 4,2 GB" o, en el dispositivo que sube, "Uploading 34 of 512", "Paused…",
"N files left: drop the folder here again" o "N files could not be uploaded". Un clic la elige y el segundo la
abre (en solo lectura y en el teléfono, uno); *Open* de la barra y la barra espaciadora también. Mientras sube
desde este dispositivo, abrirla muestra cómo va; si no, el visor.

**El visor** (`src/ui/FolderViewer.tsx`): lo que hay ahora en la carpeta de Drive, pedido al portero cada vez que
se abre. Migas que empiezan en la carpeta, primero las subcarpetas y después los archivos en orden natural, con
la miniatura de Drive (por `/t/`) o un ícono, el peso y *Download*. Una foto o un video abre el carrete con las
fotos y videos de esa subcarpeta (un `CarreteLoader` propio: la miniatura mientras carga y el archivo por su
pase); un PDF o un texto se abre en otra pestaña; lo demás se baja con `?download=1`. Escape sube un nivel y, en
la carpeta, cierra. Los accesos directos y los documentos de Google se muestran sin abrirse. Más de 100 cosas:
*Show more*. En el teléfono ocupa la pantalla.

**Cómo está hecho:**

- **En la página:** un bloque `image` con `sdmedia://<uuid>`, sin tipo nuevo; la fila de `files` tiene
  `mime = 'inode/directory'` y el peso de lo que se subió (1 si estaba vacía). `MediaQueue.addFolder` la registra
  en el acto con `register_file` (hace falta red: sin copia no hay nada que guardar para después) y la anota en el
  dispositivo como propia, ya registrada y sin original; si vuelve a la cola (una copia restaurada), se registra
  de nuevo y queda lista sin buscar un original. La carpeta no necesita migración; una chica
  (`20261001150000_carpetas_creador.sql`: `media_file` suma `created_by`, probada en una transacción deshecha
  contra la base) cierra quién sube adentro.
- **Leer la carpeta** (`src/media/folderRead.ts`): `webkitGetAsEntry` en el acto, `readEntries` en bucle,
  subcarpetas vacías incluidas; se saltean lo que empieza con punto, `Thumbs.db`, `ehthumbs.db`, `desktop.ini`,
  `Icon\r`, `__MACOSX` y `~$…` (con la casilla, entran); lo ilegible queda afuera con su motivo. La lista de un
  `<input webkitdirectory>` también sirve (la usa "Choose the folder…" para retomar).
- **La cola propia** (`src/media/folderUpload.ts`, `FolderUploads`): primero la carpeta y las subcarpetas, de a
  30 por pedido y en orden; después los archivos, de a 3 a la vez, pidiendo las subidas de a 30. Los bytes pasan
  **por el portero** (plan B del diseño, sección 5): el id de cada subida es la dirección de Google cifrada por el
  portero, así no se guarda nada por archivo en el portero ni en la base, y el navegador nunca ve la dirección de
  Google. Si Drive pide ir más despacio, espera (5 s, 10 s… hasta 2 min) y sigue; un archivo que falla 5 veces
  queda con su error sin frenar a los demás. La lista de trabajo (ruta, peso, tipo, su subida, si llegó; sin
  bytes) vive en `<base local>:folders`; al terminar se borra. Si la pestaña se cierra, la tarjeta pide volver a
  soltar la carpeta (o elegirla en la ventana): se toma cada archivo que falta con la misma ruta y el mismo peso.
  Sacar el workspace del dispositivo borra esa base.
- **El portero** (`portero/src/core.ts`, ver `Doc_Portero.md`): `POST /folder/prepare`, `/folder/sessions`,
  `/folder/list`, `GET /t/<pase>`, `PUT /upload/f.…` y `features: ['folders']` en `/drive/status`. La regla
  "nunca hacia arriba" es código (`inTree`): todo id que manda la app (una subcarpeta para listar, una para subir,
  la de arriba de una subcarpeta nueva) tiene que estar adentro del árbol, comprobado subiendo por sus `parents`
  hasta la carpeta (o hasta una subcarpeta comprobada hace menos de 10 minutos, en la memoria de la instancia);
  la raíz del Drive, un ciclo, algo que no es una carpeta, algo en la papelera o 30 niveles dicen que no. Las
  subcarpetas creadas llevan `sdFolder` y `sdPath` (la ruta resumida): repetir un pedido no crea nada dos veces.
  `/pass` de una carpeta responde `409 is_folder`.
- **Permisos:** listar y bajar, nivel 1 sobre la carpeta (quien ve la página). Crear y subir: nivel 3 **y ser
  quien agregó la carpeta**: lo dice la base (`files.created_by`, que `media_file` devuelve desde la migración
  `20261001150000_carpetas_creador.sql`); con una base sin esa migración, quien la creó en Drive (el portero lo
  anota en `file:<uuid>`, `creator`), que deja una ventana de segundos para que otro se adelante. Corrección de la
  auditoría: el nivel de `media_file` es el más alto entre las páginas que usan la carpeta, y alguien con "Ver" en
  la página A y "Editar" en otra B podía pegar el bloque en B y subir adentro de la carpeta que ven todos los de
  A). Sin acceso a la página, 404 como si no existiera; pedir otra carpeta del Drive, 404 al listar y 403 al
  subir. "Agregar a esta carpeta" (de otros) pide una regla nueva que decide Lega.
- **Plan gratis:** cada pedido de carpetas le pide a Drive a lo sumo 36 cosas (`DRIVE_CALL_BUDGET`): lo que no
  entra vuelve sin crear o como `later` y la app lo pide en el siguiente. Listar trae 100 por pedido (cada
  archivo lleva su pase firmado; 300 se midieron en ~9,5 ms de CPU, al límite de los 10 ms: falta medirlo en
  Cloudflare, ver `Doc_Portero.md`, "Antes de publicar"). Dos pedidos que crean la misma carpeta a la vez en dos instancias:
  el segundo la encuentra en Drive por su marca `sdFile` y no crea otra; si igual quedaran dos, la app rearma el
  árbol cuando el portero dice que una subcarpeta no es de esta carpeta.

## Cómo quedó (entrega 2, *Download all*)

**Qué ve el usuario.** El visor tiene *Download all* arriba, al lado de *Close* (y la barra de la tarjeta, para quien
edita, un botón con el mismo nombre que abre el visor con la descarga). Primero mira todo lo de adentro ("Looking at
what is inside… 340 files in 12 folders") y dice cuánto es ("340 files in 12 folders · 2,1 GB") y cuántas cosas no se
bajan (accesos directos, documentos de Google, una subcarpeta que no se pudo abrir). Después, según el navegador:

- **Chrome y Edge de computadora** (`showSaveFilePicker`): *Download as .zip…* pide dónde guardarlo y lo escribe a
  medida que llega, sin tope; *Download to a folder…* (`showDirectoryPicker`) escribe el árbol tal cual en una carpeta
  nueva adentro de la elegida (`Referencias`, o `Referencias (2)` si ya hay una: nunca mezcla).
- **Firefox, Safari y los teléfonos** (D24): *Download as .zip* lo arma en memoria hasta 1 GB (500 MB en un teléfono:
  iPhone, iPad o Android, según el navegador); al terminar, *Save Referencias.zip* lo guarda con un clic (un gesto
  nuevo: Safari no deja bajar sin uno después de minutos de espera). Pasado el tope, el aviso de bajar de a uno o desde
  una computadora con Chrome o Edge, sin botón para bajar. El service worker no cambia (`generateSW`).

Mientras baja: la barra, "34 of 340 files · 1,2 of 2,1 GB", el archivo en curso, "Keep this tab open until it
finishes" y *Cancel* (Escape y el clic afuera no cierran nada mientras baja). Sin red se queda esperando ("No
connection: it continues when it comes back") sin gastar reintentos; también con el wifi conectado y sin internet
(el navegador sigue diciendo que hay red): un pedido que falla por la red prueba el portero (`/health`) y, si tampoco
contesta, espera probándolo cada 5 segundos en vez de anotar el archivo como faltante. Al terminar dice dónde quedó y cuántas cosas no
están. Cancelar un zip lo borra (no queda un archivo a medias); cancelar una carpeta deja lo ya bajado. Sin red, el
botón se ve apagado y, con el clic, dice que hace falta conexión.

**Cancelar un error que queda a medias (v0.176):** también se corta en el acto cuando el servidor ya contestó un
error HTTP pero su cuerpo JSON dejó de llegar. El lector de ese cuerpo pertenece a la bajada: *Cancel* y el plazo
vigente de 30 segundos cancelan la fuente, liberan el bloqueo del cuerpo y retiran sus escuchas y temporizadores.
Sin un código JSON completo se conserva la clasificación HTTP: 429 y 5xx tienen cuatro intentos; los otros errores
de archivo se anotan y el resto sigue. Un 403 con `pass_expired` completo renueva el pase una vez, como antes.
*Retry missing* mantiene lo que ya terminó y pide solo lo pendiente. Las pruebas reproducen cuerpos 403, 429 y 503
parciales, comprueban la cancelación de la fuente y la limpieza, y recorren *Cancel* en la ventana real con un
servidor simulado; no reemplazan la comprobación pendiente en Safari, iPhone y Drive real.

**El zip elegido, al cancelar o fallar (v0.216, D308):** *Download as .zip…* sacaba siempre el archivo del destino
al cancelar o fallar. Ahora sigue la regla de la exportación a zip: el `.zip` vacío que crea el selector al elegir
el nombre se saca; uno que al elegirlo tenía contenido no se borra (lo escrito a medias se descarta sin tocarlo), y
si el navegador no dice cuánto pesa, tampoco. Si el archivo elegido no se puede abrir para escribir, el vacío recién
creado también se saca. Vale igual para el zip de *Retry missing*. Probado con el selector simulado
(`src/ui/folderDownloadDialog.test.tsx`).

**Esto no conserva un zip que se eligió reemplazar.** Chrome y Edge, los únicos navegadores con ese selector, vacían
el archivo existente en el momento de elegirlo, antes de que la app haga nada (sale de leer el código de Chromium: al
guardar, crea el archivo si no existe y lo trunca si existe; no se vio en un navegador). El zip anterior queda en 0
bytes al elegirlo y, por estar vacío, se saca al cancelar. La regla solo evita llevarse un archivo con contenido en
un navegador que no lo vacíe. Conservarlo pide otro diseño (`Doc_Roadmap.md`), igual que en la exportación.

**Cómo está hecho:**

- `src/media/folderZip.ts`: `planFolder` recorre el árbol con `/folder/list` (hasta 40 subcarpetas por pedido con `dirs`, 4 pedidos a la vez,
  todas las páginas de 100 en total por pedido; la raíz, de a una: no se conoce su id; ver "Lo que quedó de la entrega 2, hecho (rama `lega/carpetas-e2`)"; si Drive pide ir más despacio, espera 5, 10, 20… segundos; una subcarpeta que no se puede listar se
  anota y el resto sigue) y arma la lista en orden: primero las carpetas, después los archivos, como el visor.
  `runDownload` baja cada archivo por su pase (`fetch` con CORS: `/m/` ya lo dejaba, solo para `APP_ORIGINS`, desde
  v0.058). Los archivos de hasta 4 MB se piden de a 4 por delante; los grandes se escriben a medida que llegan y, si la
  respuesta se corta, se sigue desde donde quedó con `Range` (un `206` más corto, como el del arranque de los videos
  guardado en el portero, también). Todo se pide con `?offline=1`: una bajada entera no pasa por la caché del
  arranque de los videos ni la desplaza. Un archivo que falla (404, `abusive`, 4 intentos con 5xx o con un `fetch` que
  falla mientras el portero sí contesta) se saltea; un pase vencido (una bajada de más de 8 horas), al abrir el
  archivo o entre un corte y el pedido que sigue, vuelve a listar su subcarpeta y sigue con el nuevo. Si el disco no
  deja escribir, la bajada se frena entera; un nombre que el navegador no deja crear en el disco (Chrome rechaza
  `.lnk`, `.scf`, `.local` con un `TypeError`) se saltea y se anota. El zip en memoria tiene su propio tope con los
  bytes que llegan (`BlobSink`): si Drive dijo un peso menor, falla con el mismo aviso del tope.
- `src/media/zipWriter.ts`: el zip a mano (sin librería: en modo *store* es simple). Sin comprimir (método 0), cada
  archivo con su descriptor después de los datos (el CRC se sabe al final: nunca se vuelve atrás en lo escrito),
  Zip64 en un archivo de 4 GiB o más (lo decide el `Content-Length` o el peso de Drive antes de escribir el
  encabezado), en el índice cuando un lugar pasa los 4 GiB y en el final; nombres en UTF-8 (bit 11), permisos de Unix
  y la fecha de Drive. Un archivo que se corta del todo queda en el zip con lo que llegó (el zip sigue sano) y se anota
  como incompleto. Si un archivo sin Zip64 resultara pesar 4 GiB o más (Drive dijo un peso menor), la bajada falla
  entera: un encabezado ya escrito no se arregla.
- `src/media/crc32.ts` y `crc32.worker.ts`: CRC32 de a 8 bytes por vuelta (*slice-by-8*), en un Web Worker que recibe
  los pedazos sin copiarlos; sin Worker, en la página.
- `src/media/zipNames.ts`: cada parte de la ruta se limpia para Windows, la Mac y el iPhone (controles y marcas de
  dirección; `<>:"/\|?*` como `_`; sin punto ni espacio al final; `.` y `..` como `_`; `CON`, `NUL`, `COM1`… con un `_`
  adelante; 200 caracteres y 255 bytes UTF-8 y UTF-16 (la Mac, Linux y Android topan en bytes: 100 letras chinas son
  300), por grafema y conservando la extensión) y, en cada carpeta, dos nombres iguales sin distinguir
  mayúsculas (o que quedan iguales al limpiarlos) llevan « (2)», « (3)». Todo va adentro de una carpeta con el nombre
  de la carpeta (como el zip de Drive), en el zip y en el disco.
- **`MISSING_FILES.txt`** (decisión de esta tanda): en inglés, como la interfaz, para que el nombre sea el mismo en
  cualquier idioma; el texto de adentro va en el idioma de la app, con BOM y renglones de Windows, una línea por cosa
  (`ruta — motivo (detalle)`). Va adentro de la carpeta, solo si falta algo; un archivo de la carpeta con ese nombre
  pasa a `MISSING_FILES (2).txt`.
- `src/ui/FolderDownload.tsx`: la ventana; `FolderViewer.tsx` (el botón) y `MediaBar.tsx` (la barra de la tarjeta,
  `onDownloadAll` de `MediaActions`). Ayuda: `folderDownload`. Sin atajos nuevos.
- **Permisos:** los de siempre, sin nada nuevo en el portero ni en la base: listar pide nivel 1 sobre la carpeta (quien
  ve la página), cada subcarpeta se comprueba adentro del árbol (`inTree`) y cada archivo baja con su pase firmado. Lo
  de afuera de la carpeta no aparece nunca en la lista.
- **Los cortes de 200 y 250 caracteres van por grafema** (`cutText`, en `src/lib/graphemes.ts` y en el portero): el
  nombre para la base (`cleanFileName`, 250), el de las carpetas en Drive (`driveFolderName`, 200), el del pase (255)
  y los del zip ya no parten una bandera ni le sacan el tono a un emoji, y nunca pasan el tope en puntos de código (lo
  que mide la base).

**Pruebas:** `src/media/zipWriter.test.ts` (CRC32 de referencia y por partes, el Worker sin copiar, store con carpetas
vacías y UTF-8, Zip64 forzado, 65.534 y 65.535 cosas (el final con Zip64 desde 65.535), nombres de más de 255 bytes, un archivo de 4 GiB y 120 KB sin escribirlo entero (los datos son "huecos" de ceros y
el CRC se arma sin recorrerlos), el que miente su peso, el que se corta, el disco que falla, la fecha, los nombres y
el corte por grafema), `src/media/folderZip.test.ts` (recorrer con páginas, nombres repetidos y raros, Drive que pide
despacio, subcarpeta que no se lista, el zip entero, un archivo que falla, 5xx, cortes con `Range`, el `206` corto,
incompleto, pase vencido al abrir y a mitad, sin red, el wifi sin internet (espera; si el portero contesta, se
saltea), el tope propio del zip en memoria, cancelar, los chicos por delante, a una carpeta, un nombre que el navegador
rechaza, el disco lleno), `src/ui/folderDownload.test.ts` (el aviso del tope) y
`portero/src/folders.test.ts` (CORS de `/m/` y `/t/` solo para el origen de la app, también en el preflight; quien no
ve la página no lista ni recibe pases; el corte por grafema). Cada zip de las pruebas lo abre Python
(`zipfile.testzip()`, que comprueba cada CRC); sin Python, esas comprobaciones se saltean. `scripts/portero-smoke.mjs`
suma tres pedidos con y sin el origen de la app. **Recorrido en Chromium** con la página real, el portero real en la
página y un Drive de mentira (un invitado con "Ver"): 28 de 28 (el zip con el selector sobre OPFS, abierto con Python y
con `unzip -t`; a una carpeta, dos veces; cancelar; sin red; en memoria sin selectores, guardado con el botón; el tope
de 500 MB con un iPhone; la barra de la tarjeta, en castellano). Lo que quedó (rama `lega/carpetas-restos`):
`folderZip.test.ts` suma el portero colgado (sin respuesta ni de `/health`: espera y sigue; una respuesta quieta a
mitad sigue con `Range`; si `/health` contesta, se saltea a los 4 intentos; cancelar corta en el acto) y *Retry
missing* (a un zip, a una carpeta, la subcarpeta que vuelve a fallar); `attachments.test.ts` y `zipWriter.test.ts`,
el ZWJ. Recorrido en Chromium con el mismo arnés: 22 de 22 (los tres destinos, en castellano, y el portero colgado 50 s:
"No connection" a los 40 s y la bajada entera al volver).

**Lo que quedó de la entrega 2, hecho (rama `lega/carpetas-restos`):**

- **Tope sin avance (R1):** cada pedido de un archivo tiene un tope de 30 s sin que llegue nada (`STALL_MS`: hasta la
  respuesta y entre un pedazo y el siguiente; el tiempo que tarda el disco o el CRC no cuenta). Pasado, se corta y
  cuenta como un corte de la red: prueba `/health` (con su propio tope de 10 s) y, si tampoco contesta, dice "No
  connection" y vuelve a probar cada 5 segundos sin gastar intentos; si el portero contesta, el archivo gasta un intento
  (4 y se saltea). Un portero colgado muestra "No connection" a los ~40 s y la bajada sigue sola cuando vuelve.
  Cancelar corta en el acto, también con un pedido colgado.
- ***Retry missing*:** al terminar con algo que vale la pena volver a probar (un archivo que falló o quedó a medias,
  una subcarpeta que no se pudo listar por un error del portero; no un acceso directo, un documento de Google, un ciclo
  ni una carpeta de más de 64 niveles), la ventana ofrece *Retry missing*. `planRetry` arma el plan con esos archivos
  (con su pase; si venció, se renueva como siempre) y vuelve a listar cada subcarpeta que falló (`planFolder` con
  `start`, con los mismos nombres limpios que en la primera). Lo que sigue sin poder bajarse queda en la lista nueva.
  - *Download to a folder…*: escribe en la misma carpeta, sin volver a pedirla; si ya no falta nada, borra
    `MISSING_FILES.txt`, y si falta, lo reescribe.
  - Zip con selector: pide dónde guardar `Referencias (missing files).zip` (el clic es el gesto que pide Chrome; la
    lista se arma después) con la misma carpeta de arriba, para descomprimirlo encima del primero. Lleva siempre su
    `MISSING_FILES.txt`, que reemplaza al viejo (si ya no falta nada, lo dice). **Cada ronda lleva su número**
    (`(missing files 2).zip`, `3`…): cada una trae solo lo que faltó en la anterior, y con el mismo nombre aceptar
    "reemplazar" perdía lo que trajo la anterior y la lista decía que no faltaba nada (B1 de la auditoría). Se
    descomprimen encima del primero, en orden.
  - En memoria (Firefox, Safari, teléfonos): el botón aparece recién después de *Save*: el segundo zip reemplaza al
    primero en la memoria.
  - Se puede reintentar otra vez lo que siga fallando. Sin red, el clic dice que hace falta conexión.
  - **Cancelar un reintento** vuelve al resultado de antes, con su *Retry missing* y el aviso "Retry cancelled…" (a una
    carpeta, lo que ya bajó queda; la lista vieja sigue nombrándolo hasta el próximo reintento, que lo vuelve a
    bajar). A una carpeta, un archivo que vuelve a fallar no borra uno que ya estaba en esa ruta (`createWritable`
    lo deja como estaba): solo se borra el que se acababa de crear.
  - **Doble clic:** el segundo clic de un doble clic (`event.detail` 2) no aprieta *Cancel*, que aparece en el mismo
    lugar que *Retry missing* y que los botones de bajar.
- **El ZWJ de los emojis compuestos (O4), en la app:** `cleanFileName` deja el U+200D cuando está entre dos emojis (antes
  un emoji, su selector de variante U+FE0F o su tono de piel; después, un emoji): una familia sigue siendo una en el
  nombre de la base, en la tarjeta y en el zip. Entre letras o suelto se sigue sacando (no se ve: dos nombres iguales a
  la vista serían distintos), y el U+200C también. El portero aplica la misma regla (`lega/carpetas-e2`, abajo).

**Lo que quedó de la entrega 2, hecho (rama `lega/carpetas-e2`):**

- **Varias subcarpetas por pedido:** `POST /folder/list` acepta `dirs` (hasta 40 ids; `dir` y `dirs` juntos dan `400`) y
  pide a Drive una sola consulta, `('a' in parents or 'b' in parents …) and trashed = false`, con `parents` en los
  campos para agrupar lo que vuelve. Devuelve `{ lists, failed, later, nextPageToken }` (detalle en `Doc_Portero.md`).
  Cada subcarpeta se comprueba con `inTree` (una por una, dentro del tope de llamados a Drive del pedido: las que no
  entran vuelven en `later` y la app las pide de nuevo; cada pedido avanza al menos una); la comprobada hace menos de 60
  s (porque Drive la mostró adentro de otra ya comprobada) no se vuelve a mirar: sin eso, 40 subcarpetas eran 40
  llamados a Drive antes de listar nada. `dir` (el visor) la mira siempre, como antes. **Compatible hacia atrás:** una
  app anterior que manda `dir` sigue igual; una app nueva contra un portero anterior recibe la respuesta de siempre
  (`entries`, sin `lists`), lo anota y lista de a una, sin romper nada (le cuesta un pedido de más por bajada).
- **En la app** (`planFolder`, así también *Retry missing*): toma hasta 40 subcarpetas de la cola por pedido y 4 pedidos
  a la vez. Una que el portero no puede listar queda anotada con su código y su id (se puede reintentar). Si un pedido
  falla a mitad (o a la mitad de sus páginas), se descarta lo recibido de esas subcarpetas y se listan de a una: una que
  no anda no pierde a las otras. Si Drive pide ir más despacio y no cede, quedan anotadas con `rate`; cancelar corta
  en el acto. Una carpeta con 500 subcarpetas de 2 archivos pasa de 505 pedidos (5 páginas de la raíz y 500) a 18 (las 5
  de la raíz y 13 de 40). **El tope real es la página:** cada pedido trae a lo sumo 100 cosas en total, porque cada
  archivo lleva un pase firmado (el tope de CPU del plan gratis); con subcarpetas de muchos archivos los pedidos son
  `cosas / 100`, igual de bien repartidos que antes pero sin un pedido por subcarpeta vacía o casi vacía.
- **El ZWJ en el portero:** `cleanFileName` del portero (`stripHidden`, en `portero/src/core.ts`) aplica la misma regla
  que la de la app (el U+200D se queda entre dos emojis, también con U+FE0F o un tono de piel antes; se saca entre
  letras o suelto; el U+200C siempre). Alcanza a los nombres que lista el portero, a los de lo que se sube y a los de
  las carpetas que crea en el Drive del dueño (`driveFolderName`): una carpeta soltada con una familia en el nombre
  queda con la familia entera. Una prueba compara las dos funciones con los mismos nombres (`src/media/folders.test.ts`).
  Lo ya subido con una familia partida en el Drive no cambia (sigue encontrándose por su marca, no por el nombre).

**Lo que falta de la entrega 2 (BAJO):** Firefox por el service worker (sin tope) queda para otra entrega (D24). Los documentos de Google no se bajan como PDF
(decisión 5). Probar a mano en Safari, el iPhone y con el Drive real (lista de la tanda). De la auditoría de
`lega/carpetas-restos` (sin acción, BAJO): la fecha de `MISSING_FILES.txt` usa el formato del
sistema y no el idioma de la app; en memoria, que Safari y el iPhone no reemplacen el segundo zip guardado (probar a
mano). De la auditoría de la entrega 2:

- **`APP_ORIGINS` mal puesto en el portero de un dueño (R2):** `/m/` falla por CORS y se saltea todo; si `/health` también
  falla, la bajada espera para siempre. Distinguir el error de CORS del corte de red.
- **Un nombre de un solo grafema gigante (R3)** puede quedar recortado de forma rara (no es prefijo del original). Inofensivo.

- **Emojis compuestos (O4, preexistente):** hecho en la app y en el portero (arriba).
- **`tar.exe` de Windows (O11, informativa):** no extrae nombres con emojis desde la consola (le pasa igual con un zip
  hecho por Python). El Explorador (*Extraer todo*) y .NET extraen todo.
- **Reemplazar un zip existente:** en *Download as .zip…*, cancelar o fallar borra el archivo elegido, también si ya
  existía y se aceptó reemplazarlo (coherente con "reemplazar").

**Correcciones de la segunda auditoría (2026-10-01):**

- **El portero se rompía desde el segundo pedido de cada instancia** (guardaba el stub del Durable Object entre
  pedidos): ahora un stub por pedido y la memoria de subcarpetas con una llave fija. Lo prueba
  `scripts/portero-smoke.mjs` en `workerd` (`Doc_Portero.md`, "Antes de publicar").
- **Una subcarpeta rara ya no frena a la carpeta entera:** una barra invertida en el nombre (válida en Mac y Linux)
  sube como `_`; una carpeta de más de 30 niveles (o con un nombre que no va) se saltea con lo de adentro, se avisa
  en la ventana, y el resto sube. Si el portero igual rechaza una tanda, la cola prueba de a una, saltea la que no
  pasa y "Retry" no la repite.
- **Dejar de subir** (*Stop uploading*, con confirmación): olvida la subida en este dispositivo; lo que llegó queda
  en Drive, y la tarjeta de este dispositivo pasa a decir el peso de lo que llegó (la base y los demás dispositivos
  siguen con el que se registró al soltarla).
- **Volver a soltar la misma carpeta en otro lugar de la página** (mismo nombre y algún archivo con la misma ruta):
  la ventana ofrece *Continue the upload* (sube solo lo que falta) o *Upload as a new folder*.
- Perder el acceso deja la subida sin terminar (la última parte vuelve a mirar el permiso; una subida abierta con
  un portero anterior a esta corrección no lleva la carpeta en su id y no repite ese control: vence a los 6 días); una subcarpeta en la
  papelera deja de listarse en el acto; los tipos de Google no se crean por las subidas; textos (plurales, ocultos
  sin contar carpetas, la tarjeta sin cortar, documentos de Google, sin *Pause* en una detenida).

## Lista y cuadrícula (v0.179, implementado)

El visor ofrece **List / Lista** y **Grid / Cuadrícula** debajo de las migas y las acciones. Sin una elección guardada,
abre List; Grid muestra las mismas entradas en tarjetas adaptadas al ancho de la ventana, con miniaturas completas
(sin recortar la foto), nombre, peso o tipo y el botón de bajar cada archivo. En un teléfono de 360 px entran dos
columnas; una pantalla más angosta usa una. La lista se desplaza dentro del visor, dejando accesible *Show more*.

La elección se recuerda por navegador y dispositivo (`shotdocs.folderView`, sólo `list` o `grid`), para cualquier
carpeta que se abra después; no se guarda en la cuenta ni viaja a otros dispositivos. Un valor desconocido abre
List. Si el navegador bloquea el almacenamiento, se puede cambiar de vista mientras el visor está abierto.

Cambiar de vista conserva las entradas, su orden, la subcarpeta y lo cargado con *Show more*: no vuelve a listar ni
pide originales. Las migas, Escape, abrir un archivo y *Download* usan sus acciones de siempre; los accesos
directos y los documentos de Google siguen sin abrirse. No se guardan listados ni pases para usarlos sin red: ese
pendiente continúa separado. No cambia ningún permiso o regla del árbol ni lo guardado en una página.

Implementación en `src/ui/FolderViewer.tsx`, con CSS propio en `src/ui/folderGrid.css` y textos EN/ES. Las siete
pruebas del componente verifican entradas/pedidos, paginación con error, navegación, recuerdo y storage bloqueado,
acciones y carpeta vacía/sin red. El recorrido de ventana real mide columnas, miniaturas y ausencia de
desbordamiento en escritorio y teléfono, en ambos idiomas y temas. La comprobación física en Safari/iPhone y
Drive real sigue pendiente; esta entrega no cierra P.9 ni toda la entrega 1b.

**Lo que falta, con su nivel:**

- **Lega (MEDIO):** decidir `drive.readonly` (decisión 1). Hoy el portero pide `drive.file`: el visor muestra lo
  que subió la app, no lo que se agregue a mano en Drive. El código no cambia con la decisión (la regla del árbol
  ya es código); hace falta el cambio de permiso y que el dueño reconecte (ver el informe de la tanda).
- **Subida directa del navegador a Google (plan A, BAJO):** no se probó (pide el Drive real); los bytes van por el
  portero, que entra en el plan gratis (unos 10.300 pedidos por carpeta de 10.000 archivos, sección 12).
- **Entrega 1b pendiente (BAJO):** "Agregar a esta carpeta", la copia de la última lista para
  verla sin red, retomar con "Seguir" en Chrome y Edge (`FileSystemHandle`) y la cuenta de pedidos del día. El
  porqué de cada una, en "Cómo quedó (v0.216)".
- **Hecho (v0.216):** *Folder* en el menú `/` y lo que falta subir al quitar el workspace del dispositivo ("Cómo
  quedó (v0.216)").
- **Entrega 2:** *Bajar todo* como zip. **Hecho** ("Cómo quedó (entrega 2)").
- **Nombres de las carpetas: decidido (D3 → B, 2026-10-02).** Sin espacios, nunca: guiones bajos también en las
  carpetas que suelta el usuario (ver "Respondidas por Lega", punto 6). Hecho en `driveFolderName`.
- **El iPhone:** sin probar a mano; si el navegador no da `webkitGetAsEntry`, se sigue pidiendo comprimirla.

**Pruebas:** `portero/src/folders.test.ts` (crear el árbol y repetirlo, nombres con guiones bajos y retomar una
subida con espacios de v0.089 a v0.127, `_2`, niveles, rutas con `..`,
subcarpetas de afuera, subidas cifradas de otra persona, tocadas o vencidas, Drive que pide ir más despacio,
listar, accesos directos, documentos de Google, subcarpeta movida afuera, ciclos, el pase de una carpeta) y
`src/media/folders.test.ts` (leer más de 100 por carpeta, salteados, `webkitdirectory`, la cola de punta a punta,
un error que no frena, retomar por ruta y peso después de cerrar, pausar, la fila de la carpeta, sin red, la
tarjeta). Recorrido en Chromium con el portero real en la página y un Drive de mentira: 16 de 16.

## Cómo quedó (v0.216)

**`/` › *Folder* (`src/ui/folderPick.ts`).** En una computadora, el menú `/` ofrece *Folder* después de *Image*:
abre el selector de carpetas del sistema (`<input webkitdirectory>`) y lo elegido sigue el camino de una carpeta
soltada: la misma ventana, la oferta de seguir una subida a medias de esa página, y el bloque después del renglón
donde estaba el cursor (un renglón vacío se reemplaza). No se ofrece sin permiso de editar, en la práctica, sin
portero, por un link, ni en un teléfono (ahí el selector no entrega carpetas de forma pareja y no está probado: se
sigue pidiendo comprimirla). Una carpeta sin archivos no llega por el selector (el navegador no la da): la app lo
dice y pide arrastrarla. Si se cambia de página con el selector abierto, lo elegido no va a otra página. No hay
tipo de bloque ni propiedad nueva: es el mismo bloque de una carpeta soltada.

**Quitar el workspace con una carpeta a medias.** La lista de trabajo de una carpeta se borra con el workspace, así
que esa subida no se puede retomar después. La ventana de quitar ahora dice cuántos archivos de carpetas faltan
subir, que se corta para siempre y que la carpeta de la página queda con lo que ya llegó a Drive. No frena: los
archivos siguen en el disco de la persona, nunca estuvieron en la app. Con una carpeta a medias no dice "todo lo de
este dispositivo ya se subió".

**Lo que sigue pendiente de la entrega 1b, y por qué:**

- **"Agregar a esta carpeta":** el peso de la carpeta está en su fila de la base (`files.size`, de ahí salen el peso
  del proyecto y el de la tarjeta en otros dispositivos) y hoy no hay cómo cambiarlo después de registrarla: pide una
  función nueva en la base. Para carpetas de otra persona falta además la regla que decide Lega.
- **La lista sin red:** guardar el listado en el dispositivo deja una copia nueva de nombres de archivos que tiene
  que irse cuando la persona pierde el acceso a la página, y no puede ir en la base de las carpetas (subirle la
  versión dejaría afuera a una versión anterior de la app abierta en el mismo dispositivo): va en una base aparte,
  con su tope, su borrado al quitar el workspace y su limpieza al perder el acceso. Los pases guardados vencen a las
  8 horas: sin red la lista se ve, pero abrir o bajar pide conexión.
- **"Seguir" en Chrome y Edge:** guardar el acceso a la carpeta del disco y volver a pedir el permiso solo se puede
  comprobar en un navegador de verdad.
- **Subida directa a Google** y **`drive.readonly`:** siguen como estaban (Drive real y decisión de Lega).

**Pruebas:** `src/ui/folderPick.test.ts` (cuándo se ofrece, la carpeta leída con subcarpetas y salteados, carpeta sin
archivos, cerrar el selector, cambio de página) y `src/ui/workspaces.test.tsx` (el aviso con tres archivos
pendientes, que no frena y que se va al dejar de seguir la carpeta). El selector real del sistema no se probó.

## Cómo quedó (entrega 3, v0.142)

Los restos BAJO de las entregas 1 y 2 y la parte de B.11 (subidas que se traban) que toca a las carpetas.

**La cola de una carpeta con el portero colgado para todos.** Antes, cada archivo esperaba su tope (un minuto la
pregunta de cuánto llegó, dos la parte), gastaba uno de sus 5 intentos y volvía a probar: con el portero colgado una
carpeta de 500 archivos terminaba con 500 errores a la vista hasta *Retry*. Ahora (`FolderUploads`, igual que la cola
de los archivos sueltos, `Doc_Portero.md`, "Colgado para todos"):

- Una trabada (`UploadError` con `stalled`) **no gasta un intento**: se anota en `FolderItem.stalls` (campo nuevo y
  opcional; lo guardado por una versión anterior vale 0) y el archivo vuelve a la fila, detrás de los que nunca se
  trabaron. Cada trabada le da más plazo a la respuesta de la parte (`stalledBefore`) y cada dos, si la subida no
  recibió nada, se pide otra (`renewIfEmpty`, que con `noOpen` devuelve la subida sin id y la cola pide otra al
  portero). Pedir otra **no cuenta como trabada de la vuelta**: el cliente la pide siempre que no llegó nada, también
  con el portero sano (corrección de la auditoría, B1: contarla cerraba la vuelta otra vez justo cuando el portero
  volvía, con una espera del doble y el aviso falso; una carpeta de 3 archivos tardaba 160 s de más).
- Después de una trabada sin avance **no se empieza otro archivo** hasta que los que están en curso terminen o se
  traben. A la segunda seguida (`STALLS_TO_CLOSE_ROUND`) la cola espera `stallWait` (10 s, 20 s… hasta 10 minutos, la
  misma escala que la cola de los sueltos) con el aviso *The media server is not answering; it will try again
  shortly* (en la ventana: "Waiting a moment: …"), y vuelve a probar. Con el portero colgado cada vuelta prueba solo
  los 3 que van a la vez.
- Un archivo que avanza o termina vuelve todo a cero (la cuenta, la espera y el aviso). Avanzar es que el portero
  confirme más de lo que ya había confirmado de ese archivo en la sesión: volver a mandar lo que una subida perdida
  ya tenía no cuenta.
- Lo de siempre no cambia: un error que no es una trabada (Drive rechaza, la subida venció) sigue gastando intentos y,
  a los 5, queda a la vista con *Retry*; sin red no gasta.

**El 403 de Drive por el límite de pedidos (`inTree`).** Drive contesta 403 tanto a "no tenés acceso" como a "andá
más despacio" (`userRateLimitExceeded`, `rateLimitExceeded`, `dailyLimitExceeded`, `quotaExceeded`). `inTree` tomaba
cualquier 403 como "fuera del árbol": la subcarpeta salía como faltante hasta *Retry missing*, y al subir el portero
contestaba `outside` y la app rearmaba el árbol. Ahora un 403 con uno de esos motivos (y un 429) sale como `503 rate`,
que la app ya sabe esperar; un 403 de permiso o sin motivo legible sigue siendo "afuera" (nunca se lista nada de más).

**La confianza de 60 s, también en las páginas siguientes.** En el listado de varias subcarpetas (`dirs`) la primera
página volvía a mirar en Drive cada subcarpeta comprobada hace más de un minuto, pero las siguientes (`pageToken`)
usaban la de `inTree`, de 10 minutos: una subcarpeta movida a otro proyecto se seguía listando hasta terminar las
páginas. Ahora las dos usan la misma regla (`forgetIfStale`). Para que eso no cueste un llamado a Drive por
subcarpeta en cada página, el portero recuerda aparte **cuándo Drive mostró cada subcarpeta adentro de su carpeta de
arriba** (`seen`: su metadata, el listado de la de arriba o el pedido que la creó); antes el minuto se medía con la
fecha de la comprobación más vieja del camino, y una subcarpeta honda se volvía a mirar en cada pedido. Lo de arriba
sigue con sus 10 minutos.

**El ZWJ como escape.** `stripHidden` del portero comparaba con el U+200D escrito tal cual (no se ve en el código):
ahora es la constante `ZWJ = '\u200D'` (escrita como escape; una prueba revisa que ningún renglón de
código de la app ni del portero lleve un carácter invisible tal cual). De paso, la BOM de `MISSING_FILES.txt` (`FolderDownload.tsx`) y el espacio de
ancho cero de `codaHtml.ts` también van como escapes.

**Los acentos de la Mac y de Windows en la marca de cada subcarpeta.** La marca (`sdPath`) resumía la ruta tal cual
llegaba: la Mac da `í` en dos partes (NFD) y Windows en una (NFC), así que la misma subcarpeta tenía dos marcas y
pedirla con la otra forma creaba otra al lado, con el mismo nombre. **Cuándo pasa de verdad:** la app le manda al
portero las rutas de la lista de trabajo del dispositivo, que no cambian; lo que puede traer la otra forma es una
copia de la carpeta soltada para retomar en el mismo dispositivo (un pendrive, una carpeta de red, otro navegador).
Desde otra computadora, soltar la carpeta de nuevo crea otra carpeta (otra tarjeta), por diseño. Lo que protege en
ese caso es la comparación de rutas de la app (abajo); las marcas del portero son una defensa más. Opciones: (a) normalizar la marca, que
cambiaba la de lo ya subido y lo dejaba sin encontrar; (b) normalizar en la app las rutas al leer la carpeta, que
dejaba igual el problema con las listas de trabajo guardadas; (c) **marcar lo nuevo en NFC y buscar por las dos
formas**. Se eligió (c), sin tocar nada en el Drive del dueño:

- `pathMark` marca en NFC lo que se crea desde ahora. `pathMarks` da las marcas con las que se busca una subcarpeta
  que ya existe: NFC, la ruta tal cual y NFD (las que pudo dejar un portero anterior desde cualquiera de los dos
  sistemas). Lo ya subido conserva su marca y se encuentra igual.
- Con acentos la búsqueda lleva hasta tres marcas por ruta; van de a 40 por consulta (`MARKS_PER_QUERY`) para no hacer
  una dirección demasiado larga. 30 rutas con acentos son dos consultas en vez de una.
- Dos rutas del mismo pedido que solo difieren en la forma de los acentos (en Windows pueden ser dos carpetas) van a la
  misma subcarpeta: no se pierde nada (Drive admite dos archivos con el mismo nombre), y no quedan dos carpetas
  iguales a la vista.
- En la app, retomar (`resumeWith`) y reconocer la misma carpeta soltada otra vez (`hasAnyPath`) comparan las rutas
  en NFC: una carpeta en un disco externo, o soltada desde otro navegador, puede traer la otra forma. Lo que se sube
  va con la ruta de la lista de trabajo, la de las subcarpetas ya creadas.

**Pruebas:** `portero/src/folders.test.ts` (el 403 por límite como `rate` al listar de a una y de a varias y al subir,
el 429, el 403 de permiso o sin motivo como 404; las páginas siguientes con la confianza de un minuto y sin llamados
de más dentro del minuto con una subcarpeta honda; las marcas desde los dos sistemas, las de un portero anterior en
NFD y en NFC, dos rutas del mismo pedido, 30 rutas con acentos en dos consultas) y `src/media/folders.test.ts` (el
portero colgado para todos: 3 vueltas de 3 archivos, esperas de 10, 20 y 40 s, ningún error ni intento gastado; uno
colgado solo para él, con más plazo y otra subida a las dos trabadas; una trabada después de avanzar no cierra la
vuelta; una lista guardada sin `stalls` y la misma carpeta con los acentos en la otra forma; pedir otra subida al
volver el portero no cierra la vuelta otra vez; los que se trabaron van después). **Recorrido en Chromium** con el
cliente real del portero (partes por `XMLHttpRequest`) contra un portero local que recibe el pedido y no contesta: la
carpeta de 6 archivos, en castellano, cerró la primera vuelta a los 61 s con 3 pedidos colgados y el aviso, volvió a
probar a los 10 s, cerró la segunda a los 131 s (6 colgados) y, al volver el portero, subió los 6, una vez cada uno.

**Lo que queda (BAJO):** si el portero se cuelga recién en la última parte de un archivo grande, ese archivo espera su
plazo (hasta 10 minutos y medio con el plazo más largo) antes de contar como trabado; los otros dos en curso, también.
Es lo mismo que en la cola de los sueltos. *(Hecho en la entrega 4, abajo, cuando lo que se cuelga es Drive.)*

## Cómo quedó (entrega 4, v0.149)

Los tres restos BAJO de la entrega 3 (`Doc_Roadmap.md`, B.11: O5, O7 y la última parte).

**La vuelta de la red (O5).** La cola de una carpeta no se enteraba de que volvía la red: con el wifi cortado unos
minutos la vuelta se cerraba varias veces y quedaba esperando 2 o 4 minutos aunque el wifi volviera enseguida (los
sueltos y `page-files` ya probaban en el acto). Ahora `FolderUploads.networkBack` despierta las esperas de cada
carpeta que no está en pausa, y el motor la llama donde llama a las otras dos (el evento `online` y la base que
contesta después de un ciclo sin conexión). No vuelve la cuenta a cero: si el portero sigue colgado, la espera
siguiente es más larga. La espera porque Drive pidió ir más despacio (`rate`) no se despierta: la red no cambia eso.
De paso, cada carpeta lleva todas sus esperas en curso (`waits`): antes había un solo lugar y, con varios archivos
esperando a la vez (uno por archivo en curso sin red), pausar despertaba solo al último.

**Pause y Resume (O5).** *Resume*, *Retry* y volver a soltar la carpeta (`resumeWith`) ponen en cero `stallStreak` y
`stallRounds` y sacan el aviso de que el portero no contesta: antes, un *Resume* con la racha en 2 arrancaba con otra
espera, más larga (40 s, 80 s…), sin probar.

**Listar varias subcarpetas con más de un minuto entre páginas (O7).** Con `pageToken`, el portero volvía a mirar en
Drive cada subcarpeta vista hace más de un minuto (`LIST_TRUST_MS`) y, si no entraban todas en su tope de llamados
(36), cortaba con `409 changed`; la app descartaba todo el grupo y lo listaba de a una (un pedido por subcarpeta).
Pasaba con *Download all* de una carpeta con 36 subcarpetas o más cuando Drive pedía ir más despacio entre páginas.
Opciones: (a) que la confianza no venza entre páginas (descartado: es la regla de seguridad del minuto, D81); (b)
devolver las que no entran como `later` en la página siguiente (lo que proponía el roadmap). Se eligió (b), con dos
cuidados:

- **La consulta no cambia:** Drive ata el token a la consulta, así que la página sigue pidiendo todas las subcarpetas
  del grupo, pero de las que no se comprobaron no sale nada (se filtra por padre, como siempre). Lo mismo con una que
  se movió afuera: sale en `failed` (`not_found`), sin cortar a las demás.
- **Solo si la app lo pide** (`partial: true` en el pedido): una app anterior sigue lo que recibe en las páginas
  siguientes sin mirar `later` ni `failed`, y se quedaría con una subcarpeta a medias sin enterarse. A ella el portero
  le sigue contestando `409`. Un portero anterior ignora `partial` y contesta `409` como siempre (la app ya lo sabe
  manejar).

En la app (`listRound`), una subcarpeta que una página siguiente deja para después pierde lo que ya tenía (estaba
incompleto) y se lista de nuevo en la vuelta siguiente; una dada por perdida queda anotada con su código (*Retry
missing* la reintenta); las demás siguen con sus páginas, siempre con los `dirs` de la primera. Si no queda ninguna
del grupo, no se piden más páginas.

**El archivo grande colgado en la última parte.** Desde la app no hay cómo saber si una parte que ya salió entera
está colgada o detrás de un proxy que la sube despacio: no llega nada en los dos casos, y por eso el plazo de la
respuesta crece hasta 10 minutos y medio (`answerLimit`). Opciones: (a) un plazo por quietud en la app como el de
`page-files` (descartado: en una subida no hay bytes que vuelvan mientras se espera la respuesta, y cortaría al proxy
lento); (b) que el portero mande algo mientras espera a Drive (descartado: cambia la forma de las respuestas, y con un
proxy que retiene el cuerpo tampoco llegaría nada); (c) **que el portero ponga el tope**. El portero lee la parte
entera antes de pasársela a Drive, así que lo que tarda desde ahí es Cloudflare con Drive, nunca la red de quien sube.
Con `?stall=1` (la app lo pone en cada parte), si Drive no contesta en 90 s (`PART_ANSWER_MS`; en la última parte de
un archivo de una carpeta cuenta también la consulta a la base) el portero corta su pedido y contesta `504 stalled`, y
la app lo toma como una trabada: no gasta intentos y la cola sigue su escala. Vale para las dos colas (carpetas y
sueltos) porque es el mismo cliente. Lo que no cubre: un portero que se cae sin contestar después de leer la parte
(raro: Cloudflare cierra la conexión) sigue esperando el plazo de la app; detalle en `Doc_Portero.md`, "Subidas que
se traban".

**Lo que queda (BAJO, de la auditoría de la entrega 4):**

- **Medir con el portero publicado y el Drive real (O2):** un archivo de varios GB al que Drive tarda más de 90 s en
  cerrar la última parte. El portero corta y la app pregunta cuánto llegó: si Drive ya terminó contesta `done` y no se
  duplica nada; si no, se vuelve a mandar desde lo recibido (los dos casos, probados con un Drive de mentira). Lo que no
  se sabe es qué contesta Google **mientras** todavía cierra el archivo: si dijera `308` con todo recibido, la app
  mandaría una parte vacía, el portero la rechazaría con `400` y el archivo gastaría un intento, con el error a la vista
  hasta *Retry*. No se pierde ni se duplica nada. Es un camino de antes (una respuesta perdida) que el tope de 90 s
  hace más probable con archivos enormes.
- **Comprobaciones de más en el listado (O4, implementado):** la app manda las subcarpetas descartadas de esta vuelta
  en `skip`, sin cambiar los `dirs` ni el token. El portero valida IDs, tope y pertenencia a `dirs`; solo los omite con
  `partial: true` y un token válido. No aportan contenido ni gastan comprobaciones de pertenencia; las activas conservan
  `inTree` y la confianza corta vigente. Una nueva vuelta de las aplazadas o un reintento empieza sin ese `skip`.
  Un portero anterior puede ignorarlo: la app sigue descartando lo incompleto. No cambia la detección dentro del plazo
  de confianza, ni se acredita aquí el comportamiento físico de Google Drive.

**Pruebas:** `src/media/folders.test.ts` (la vuelta de la red despierta la espera y la siguiente es más larga; no
despierta la de Drive que pide ir más despacio, ni por una subida de la tanda ni por el pedido entero (`503 rate`); *Pause* con tres esperas
a la vez las despierta a todas; *Pause* y después *Resume*, *Retry* o volver a soltarla vuelven la espera a 10 s; el
cliente manda `?stall=1` solo en las partes y un `504 stalled` es una trabada sin reintentar, y un `504` sin código
se sigue reintentando), `src/sync/remoteTimeout.test.ts` (el motor les avisa a las carpetas con el evento `online` y
cuando la base contesta después de un ciclo sin conexión), `src/media/folderZip.test.ts` (una página siguiente que deja
subcarpetas para después o las da por perdidas, sin repetidos y sin listar de a una; sin ninguna, no se piden más
páginas) y `portero/src/folders.test.ts` (`partial` con 40 subcarpetas y más de un minuto entre páginas, y una movida
afuera; sin `partial`, `409` como antes; Drive que no contesta una parte con y sin `?stall=1`; la base colgada en la
última parte).

**Recorrido en Chromium** (sin ventana, con el cliente real del portero, partes por `XMLHttpRequest`, contra un portero
local): con el portero colgado, una carpeta de 3 archivos cerró la vuelta a los 61 s; al cortarse y volver la red
(el evento `online` de verdad) subió en 0,3 s en vez de esperar los 10 s que faltaban. Otra, en la segunda espera (20
s): *Pause* y *Resume* volvió a probar el portero 60 s y la espera siguiente fue de 10 s (antes, 40 s). Cada archivo
llegó una vez. Lo del portero con Drive colgado, en `Doc_Portero.md`, "Subidas que se traban".

## Qué se pide

1. Arrastrar una carpeta (con subcarpetas) a la página. Va al Drive del dueño, a `<Proyecto>/Carpetas/<nombre>`.
2. Antes y durante la subida, una **ventana que muestra qué se sube**: "esta carpeta, con todo esto".
3. En la página queda **un bloque de carpeta**. Al hacer clic muestra, **adentro de la app, lo que hay hoy en esa
   carpeta del Drive**: si el dueño (o alguien con acceso al Drive) agrega o saca archivos ahí, la app lo muestra.
   Es "como un link a esa carpeta", pero con los permisos de la app.
4. **Permisos:** quien ve la página ve y baja lo de esa carpeta y sus subcarpetas, pero **nunca** puede subir a la
   carpeta de arriba ni ver otras carpetas del Drive. Nada de links compartidos de Google.
5. **Sin tope de archivos** y **en el plan gratis**.
6. *Bajar todo* como zip (en la segunda entrega).
7. En el iPhone, si no se puede elegir una carpeta, se sigue pidiendo comprimirla.

## Reglas que no se rompen

- **Ningún tipo de bloque nuevo.** Una carpeta es **un bloque `image` con `url: sdmedia://<uuid>`**, como una foto
  o un adjunto; el uuid es el de **una sola fila de `files`** (`mime = 'inode/directory'`) que apunta a la carpeta
  de Drive. El bloque `file` de BlockNote sigue afuera (una versión vieja lo borraría, ver `Doc_Adjuntos.md`).
- **Nunca se agrega nada a `sdmedia://<uuid>`** (una versión vieja dejaría de reconocer el archivo).
- **El navegador de un miembro nunca recibe un token de Drive.** La conexión con el Drive del dueño vive solo en el
  portero; el navegador recibe, como hoy, pases firmados de un archivo, y además direcciones de subida de un solo
  archivo (sección 5).
- **Nunca hacia arriba:** todo lo que el portero lista o sirve de una carpeta tiene que ser la carpeta registrada o
  algo que está adentro (sección 8). Los accesos directos de Drive nunca se siguen.
- Lo que una versión vieja no conozca se ve raro, **nunca se borra**.

## Resumen

- **En la página:** un bloque `image` con `sdmedia://<id>` dibujado como tarjeta de carpeta. Una versión vieja lo ve
  como un adjunto que no abre, y no pierde nada.
- **En la base:** **solo la fila de la carpeta** (registrada con el `register_file` de siempre, tipo
  `inode/directory`) y su uso en `page_files`. Lo de adentro es de Drive: no tiene filas. **Sin migración en la
  entrega 1.**
- **El portero:** crea la carpeta y sus subcarpetas en Drive, **abre las subidas de a tandas** (unas 40 por pedido)
  y el navegador manda los bytes **directo a Google** (si la prueba de la entrega 0 confirma que Google lo acepta;
  si no, por el portero como hoy, y entra igual en el plan gratis). Para ver, **lista la carpeta en vivo** y cada
  archivo sale con su pase, por el portero.
- **Cuánto entra (plan gratis, 100.000 pedidos por día):** subir una carpeta de 10.000 archivos cuesta unos 270
  pedidos (unos 10.300 si los bytes pasan por el portero); bajarla entera en un zip, unos 10.000. El límite real de
  una subida grande pasa a ser el ritmo de Drive (unas pocas creaciones por segundo), no Cloudflare. Sección 12.
- **El permiso de Drive:** hoy el portero pide `drive.file`, que **solo ve lo que subió la app**. Para que aparezca
  lo que se agrega a mano en Drive hace falta sumar `drive.readonly` (decisión 1, con sus consecuencias).

## 1. Qué frena hoy una carpeta

| Dónde | Qué hace hoy |
|---|---|
| `src/ui/fileDrop.ts`, `takeFiles` | Mira `webkitGetAsEntry()` de cada ítem; si es una carpeta la cuenta en `folders` y la saltea. `PageEditor.tsx` avisa que hay que comprimirla. |
| `queue.ts` | Un archivo por vez, copiado primero al dispositivo, con su bloque; nada sabe de rutas ni de carpetas. |
| Portero, `startFileUpload` / `dayFolder` | Siempre sube a `LGA_ShotDocs/<Proyecto>/<día>`, sin subcarpetas; los bytes pasan por el portero, 8 MiB por pedido. |
| Portero, almacenamiento | Cada `store.get`/`put` es un llamado al Durable Object (`index.ts`): una subida cuesta 7–8 al abrirla y unos 5 por parte; y en cada subida mira en Drive la raíz, el proyecto y el día (`once()` junta lo simultáneo, no guarda nada). |
| Portero, `/m/` | Sin CORS: la app no puede leer las respuestas con `fetch()` (hoy todo va por `<img>`, `<video>` y `<a>`). |
| Portero, permiso de Google | `drive.file`: ve solo lo que creó la app. |

## 2. En la página: qué bloque y cómo se degrada

Se compararon cuatro formas; decide cómo reacciona la app publicada (v0.041 en adelante), porque una versión vieja
puede abrir la misma página en otro dispositivo.

| Forma | Versión vieja (v0.049–v0.051) | Versión vieja (v0.041–v0.048) | Papelera en versión vieja | Veredicto |
|---|---|---|---|---|
| **`image` con `sdmedia://<carpeta>`** (la carpeta es una fila de `files`) | Tarjeta de adjunto con el nombre y el peso subido; abrirla da un aviso genérico ("no se puede abrir"). | Recuadro gris con el ícono de foto; el carrete, su aviso genérico. | `mediaIdsInDoc` la ve: copiar, pegar, mover y borrar el bloque registran y quitan el uso como con cualquier archivo. | **Elegida.** |
| `image` con `sdfolder://<id>` | Imagen rota. | Imagen rota. | No la cuenta: copiarla en una versión vieja no registra el uso. | Peor sin ganar nada. |
| Párrafo con una propiedad (`sdFolder`, como `driveCard`) | El párrafo. **Editar esa línea borra la propiedad**: la carpeta desaparece de la página. | Igual. | No la cuenta (`mediaIdsInDoc` solo mira `url`). | Descartada. |
| Bloque `file` o uno nuevo | **Lo borra** al abrir la página. | Igual. | — | Prohibido. |

- **La fila de la carpeta** se registra con `register_file` tal cual (acepta cualquier tipo con forma
  `tipo/subtipo` y `size > 0`): `mime = 'inode/directory'`, `size` = lo que suma lo que se subió al crearla. El
  portero le pone `drive_id` (el id de la carpeta en Drive) con `set_file_drive` cuando la crea. Así el uso en la
  página, la papelera, "de otro proyecto", `file_level`, el peso del proyecto y el diálogo de Drive funcionan sin
  nada nuevo en la base.
- **La tarjeta** sale de `display()` como la de los adjuntos (SVG generado, 360×96, fija, sin tiradores): un ícono
  de carpeta, el nombre y abajo el estado: "subiendo 120 de 512" (en el dispositivo que sube), "subiendo desde otro
  dispositivo", o "Carpeta de Drive" con el peso subido. No dice cuántos archivos tiene "ahora" (eso pide listar el
  Drive: lo dice el visor). Variantes: de otro proyecto, en la papelera de Drive. `fileKind` sigue diciendo `'file'`
  (el carrete la saltea y "Acomodar" corta solos) y `isFolderMime(mime)` hace que el clic abra el visor.
- **Clic:** como un adjunto: con el mouse, el primero elige y el segundo abre el visor; en el teléfono un toque lo
  abre; la barra espaciadora también. En la barra, *Open* abre el visor y *Download* ofrece *Bajar todo*.

## 3. La carpeta es una vista en vivo del Drive

- **Qué se muestra:** lo que hay **ahora** en la carpeta de Drive y sus subcarpetas, sin la papelera de Drive. Si
  el dueño agrega, borra, renombra o mueve algo adentro desde su Drive, la próxima vez que alguien abre el visor lo ve
  así. La app no guarda la lista de archivos en la base: la pide al portero cada vez (con una copia en el dispositivo
  para verla sin red, sección 8).
- **El problema del permiso de Google.** Con `drive.file` (el de hoy) el portero **solo ve lo que creó la app**:
  lo que se suba desde la app aparece; **lo que se agregue a mano en Drive, no**. Tres caminos (decisión 1):
  1. **Sumar `drive.readonly`** al conectar Drive (el dueño reconecta una vez). Se ve todo lo de adentro, lo haya
     puesto quien lo haya puesto. Consecuencias: la pantalla de Google dice "ver todos tus archivos de Drive"; es un
     permiso "restringido", así que la app de Google del dueño queda "sin verificar" (el aviso de siempre al conectar;
     con un solo usuario, el dueño, no hace falta la verificación de Google; una organización de Google Workspace
     puede bloquear apps sin verificar); y **el portero pasa a poder leer todo el Drive del dueño**: la regla "nunca
     hacia arriba" (sección 8) deja de ser una limitación de Google y pasa a ser **código del portero**, con pruebas.
     Subir y mandar a la papelera siguen con `drive.file`.
  2. **Quedarse con `drive.file`** y sumar en la app "Agregar a esta carpeta" (soltar en el visor o en la tarjeta):
     lo agregado desde la app se ve; lo agregado a mano en Drive, no. Para lo agregado a mano, el dueño podría
     "traerlo" con el selector de Google (elegir los archivos le da acceso a la app), a mano.
  3. `drive` entero: más de lo necesario. Descartado.

  La propuesta es el camino 1, porque es lo que pidió Lega, con el camino 2 ("Agregar a esta carpeta") igual en la
  app.
- **Qué no se ve nunca:** la carpeta de arriba, las hermanas, lo que está en la papelera de Drive, y el destino de
  un acceso directo (sección 8).

## 4. Por qué Cloudflare, y qué hace el portero

Lega preguntó por qué Cloudflare y si se puede saltear. El portero hace una sola cosa que no puede hacer nadie más:
**guardar la conexión con el Drive del dueño** (el refresh token) y usarla solo para lo que la base dice que cada
persona puede. Con ese token se abre todo lo que la app subió (y, con `drive.readonly`, todo el Drive del dueño):
no puede ir nunca al navegador de un miembro.

- **Lo que queda en el portero:** decidir con la sesión de Supabase de la persona (como hoy), firmar pases, crear
  carpetas, abrir subidas y listar. **Los bytes de las subidas pueden ir directo del navegador a Google** (sección
  5). **Los de las descargas no:** Drive no tiene direcciones firmadas para un archivo privado; sin el token, Google
  no los da. Pasan por el portero en streaming, como hoy (Cloudflare no cobra la transferencia: por eso se eligió).
- **Menos pedidos y menos llamados al Durable Object:**
  - Los pedidos "de control" (crear carpetas, abrir subidas, listar, pases) hacen **un solo llamado** al Durable
    Object, que tiene la lógica adentro (un solo hilo: dos pedidos a la vez no crean dos carpetas iguales) y guarda en
    memoria el token vigente, la clave de los pases, los ids de raíz, proyecto y `Carpetas`, y el árbol de cada
    carpeta (con vencimiento de 10 minutos).
  - `/m/` (los bytes) sigue en el Worker, con el token y la clave de los pases en la memoria de la instancia: con la
    instancia caliente, **cero llamados** al Durable Object.
  - Las subidas no guardan nada por archivo en el Durable Object: la dirección de subida la tiene el navegador.
- **Alternativas, honestas:**

| Alternativa | Por qué no (o cuándo sí) |
|---|---|
| Un token de acceso corto (1 hora) con `drive.file` en el navegador | Con ese token se puede leer, cambiar y **borrar todo lo que subió la app, de todos los proyectos**, durante una hora; Google no deja limitarlo a una carpeta (en Drive no existen los tokens "recortados" de Cloud Storage). Para un miembro rompe los permisos. Para el dueño sería aceptable (ya recibe uno para el selector), pero no hace falta. |
| Supabase Edge Functions como portero | Plan gratis: unas 500.000 llamadas por mes y **5 GB de transferencia por mes**, que se van con un par de videos: las descargas no entran. Sirve a lo sumo para el control, y entonces habría dos porteros. |
| Que cada miembro conecte su propia cuenta de Google | Cada carpeta tendría que compartirse en Google con cada persona; un invitado sin cuenta de Google no podría; sacar a alguien de la app no le saca el acceso en Google; y Google deja navegar lo compartido por su cuenta. Rompe el modelo de permisos de la app. |
| Carpeta compartida "cualquiera con el link" | Quien tenga el link la ve, para siempre; Google muestra una página de "no se pudo analizar" en archivos grandes. No. |
| Otro hosting (Deno Deploy, Vercel, un servidor propio) | Límites gratis parecidos y la transferencia se paga. Sin ventaja. |
| Google Apps Script en la cuenta del dueño | Cuotas diarias chicas, sin streaming, respuestas de pocas decenas de MB. No. |
| Plan pago de Workers (USD 5 por mes) | 10 millones de pedidos por mes. No hace falta con este diseño; queda como salida. |

## 5. Subir: del navegador directo a Google

- **Sin copia en el dispositivo** (decisión 2). La carpeta original **sigue en el disco** de quien la soltó: si la
  pestaña se cierra a mitad de camino no se pierde nada, falta subir lo que falta. Así el tamaño no depende del lugar
  del navegador (sin tope práctico) y P.10 no se complica. Lo que sí se guarda en el dispositivo es **la lista de
  trabajo** (qué archivo, a qué subcarpeta, cuánto llegó, su dirección de subida), sin bytes, en una base aparte
  (`<base local>:folders`, que una versión vieja nunca abre; sacar el workspace del dispositivo la borra y la cuenta
  en lo que falta subir).
- **Pasos:**
  1. Leer la carpeta y confirmar en la ventana (secciones 6 y 7).
  2. `register_file` de la carpeta (con la página, como cualquier archivo; si todo lo de adentro pesa 0, con
     `size` 1) y **el bloque se inserta enseguida**, en el lugar donde se soltó (no hay minutos de copia en el medio:
     no hace falta el "ancla" del primer diseño). Este registro lo hace el camino de las carpetas, **no la cola de
     archivos** (la fila de la carpeta no tiene original: `process()` la detendría con `originalMissing`); en el
     dispositivo queda anotada como archivo propio ya registrado, para que `reconcilePage` la trate como tal. **Hace
     falta conexión para empezar**: sin copia no hay nada que guardar para después (sin red, la ventana lo dice).
  3. `POST /folder/prepare` con la carpeta y la lista de subcarpetas: el Durable Object crea
     `<Proyecto>/Carpetas/<nombre>` (con la marca `sdFile` = id de la carpeta de la app) y las subcarpetas, **en
     orden**, de a unas 40 por pedido (el plan gratis deja 50 llamados por pedido; "seguí" si faltan), llama a
     `set_file_drive` de la carpeta y devuelve el mapa ruta → id de Drive. Si en `Carpetas` ya hay una carpeta con ese
     nombre subida por la app, la nueva va con " (2)".
  4. `POST /folder/sessions` con hasta 40 archivos (subcarpeta, nombre, tipo, peso): nivel 3 sobre la carpeta y
     cada subcarpeta tiene que ser del árbol. Por cada uno, el portero abre una **subida reanudable** en Drive (una
     llamada) con el nombre, la subcarpeta y el peso fijados, y devuelve su dirección. Se piden a medida que la cola
     avanza (una ventana de unas 100 por delante), no las 10.000 de golpe (una dirección vence a la semana).
  5. El navegador manda los bytes **a la dirección de Google**, por partes (8 a 64 MiB), y retoma preguntando cuánto
     llegó (`bytes */<peso>`), como hoy pero sin pasar por el portero. La respuesta final de Google trae el id del
     archivo: la lista de trabajo lo anota. **No se registra nada por archivo en la base.**
- **Qué puede hacer quien tiene una dirección de subida:** subir **ese** archivo, con el nombre, la carpeta y el peso
  que fijó el portero (Google rechaza otro peso). Lo mismo que hoy, cuando manda las partes al portero.
- **¿Google acepta esos `PUT` desde el navegador (CORS)?** **Certeza media.** Seguro anda cuando el pedido que abre
  la subida sale del mismo navegador (el ejemplo `cors-upload-sample` de Google hace eso, con un token en el
  navegador, que acá no se puede). Para una subida abierta por un servidor, la documentación de **Cloud Storage** dice
  que el `Origin` del pedido que abre la subida decide el `Access-Control-Allow-Origin` de los siguientes, así que el
  portero mandaría `Origin: <dirección de la app>` al abrirla (un Worker puede poner ese encabezado). La
  documentación de **Drive** no lo dice, y hay un reporte público (un proyecto en GitHub) de que el `PUT` al
  servidor de subidas de Drive vuelve sin CORS; no queda claro si abrieron la subida con `Origin`. **Se prueba en la
  entrega 0 antes de construir nada.**
- **Plan B, si Google no lo acepta:** los bytes pasan por el portero como hoy (`PUT /upload/<id>`), pero sin guardar
  nada en el Durable Object: el `<id>` es la dirección de Google cifrada por el portero (con una clave que no sale de
  él), así cada parte es **un pedido al Worker y cero al Durable Object**, con partes de hasta 64 MiB. Entra igual en
  el plan gratis (sección 12).
- **Retomar después de cerrar la pestaña:** en Chrome y Edge se guarda el acceso a la carpeta (el `FileSystemHandle`
  que da el soltar o `showDirectoryPicker()`) y, al volver, un clic en "Seguir" pide permiso y continúa. En los demás,
  la ventana (y la tarjeta) dicen "faltan 120 archivos: soltá de nuevo la carpeta acá para terminar"; la app compara
  por ruta y peso con lo que ya está en Drive y sube solo lo que falta (las direcciones de menos de una semana se
  retoman donde quedaron).
- **La cola:** los archivos de carpetas van por un camino propio, que nunca frena a las fotos y adjuntos sueltos de las
  páginas. Hasta 3 archivos a la vez. *Pausar* y *Seguir* por carpeta. Un error por archivo, a la vista, que no frena
  a los demás. Si Drive dice que va demasiado rápido (`userRateLimitExceeded`, 429), espera y sigue: **Drive acepta
  unas pocas creaciones de archivos por segundo por usuario**, así que 10.000 archivos llevan una hora o más aunque
  sean chicos.
- **Archivos vacíos:** ahora se pueden subir (en Drive no hay `size > 0`): no se saltean.
- **Agregar después** ("Agregar a esta carpeta"): lo mismo, apuntando a la carpeta abierta en el visor. Nivel 3.
- Más adelante, los adjuntos sueltos de P.6 podrían usar la misma subida directa.

## 6. Leer la carpeta

- **Soltar (computadora):** en el manejador de `fileDrop.ts`, `webkitGetAsEntry()` de **todos** los ítems **en el
  acto** (después del evento la lista queda vacía; las entradas siguen valiendo). Después, `readEntries()` **en bucle
  hasta que devuelva vacío** (Chrome entrega de a 100) y `entry.file()`. En Chrome y Edge, además
  `getAsFileSystemHandle()` en el acto, para poder retomar (sección 5). Anda en Chrome, Edge, Firefox y Safari de Mac.
- **Mezcla:** en un mismo soltar, los archivos sueltos siguen el camino de hoy y cada carpeta da su bloque, en orden.
- **Botón "Carpeta…"** (menú `/` y barra de la imagen): `<input type="file" webkitdirectory>` (cada `File` trae
  `webkitRelativePath`; no llegan las carpetas vacías) o, en Chrome y Edge, `showDirectoryPicker()`.
- **iPhone y iPad:** a probar a mano (arrastrar desde Archivos y `webkitdirectory`). Si no hay forma, el botón no
  aparece y se sigue pidiendo comprimir (respondido por Lega). Android: a probar.
- **Pegar** una carpeta: los navegadores no la entregan bien; sigue rechazada con el aviso.
- **Qué se saltea** (con el número, en la ventana): lo que empieza con punto (`.DS_Store`, `._foto.jpg`, `.git`),
  `Thumbs.db`, `ehthumbs.db`, `desktop.ini`, `Icon\r`, `__MACOSX` y los bloqueos de Office (`~$…`). Una casilla
  "Incluir archivos ocultos". Las carpetas vacías sí se crean (salvo con `webkitdirectory`, que no las ve).
- Un archivo que no se puede leer queda afuera y figura como salteado.
- **Nombres:** Drive acepta cualquier nombre; se limpian solo los controles, las marcas de dirección y los
  caracteres de ancho cero (`cleanFileName`). Dos nombres que solo difieren en mayúsculas se suben tal cual (el zip los
  desambigua, y limpia lo que Windows no acepta: entrega 2).
  Las carpetas en el Drive, en cambio, van sin espacios (D3 → B, punto 6 de "Respondidas por Lega"); la tarjeta y
  el nombre en la app conservan el del usuario.

## 7. La ventana: "esta carpeta, con todo esto"

1. **Antes de subir:** el nombre, "512 archivos en 38 carpetas · 4,2 GB", el desglose por tipo, el árbol plegable,
   lo salteado (con la lista), avisos (más de 1000 archivos: "va a tardar un rato largo"; archivos de más de 1 GB) y
   *Subir* / *Cancelar*. Con varias carpetas, una fila por carpeta.
2. **Durante:** "Subiendo al Drive: 34 de 512 · 1,2 de 4,2 GB · faltan unos 6 min", *Pausar* / *Seguir*, errores con
   *Reintentar*, *Cerrar* (sigue en segundo plano mientras la pestaña esté abierta) y, si se cerró, "Seguir" o
   "soltá de nuevo la carpeta". Se vuelve a abrir desde la tarjeta o el indicador de sincronización.

Otros dispositivos no ven la ventana: ven la tarjeta "subiendo desde otro dispositivo" y, en el visor, lo que ya llegó.

## 8. El visor: listar en vivo, nunca hacia arriba

- **Listar:** `POST /folder/list` con la carpeta (la fila de la app), la subcarpeta (un id de Drive) y la página de
  resultados. El portero: `media_file` de la carpeta (nivel 1 o más, como ver una foto), comprueba que la subcarpeta
  sea del árbol, y pide a Drive `files.list` con `'<subcarpeta>' in parents and trashed = false` (hasta 1000 por
  página; varias páginas en un mismo pedido si hacen falta). Devuelve por cada cosa: nombre, tipo, peso, fecha,
  si tiene miniatura y, **para cada archivo, ya firmado, su pase** (el mismo `{ f, t, u, s, n }` de hoy, 8 horas) y
  el de su miniatura. Abrir un archivo no pide nada más al portero que el archivo mismo.
- **"Del árbol" (nunca hacia arriba):** el Durable Object guarda por carpeta el conjunto de ids de subcarpetas que ya
  vio adentro (lo aprende al listar). Para listar una subcarpeta o firmar el pase de un archivo, el portero mira sus
  `parents` **en ese momento** (llega con la lista o con un `files.get`) y exige que el padre sea la carpeta o una
  subcarpeta conocida; lo conocido se vuelve a comprobar si tiene más de 10 minutos (una subcarpeta que el dueño movió
  afuera deja de valer). Si no está en el conjunto, sube por los `parents` hasta encontrar la carpeta (sí) o la raíz
  del Drive, o 30 niveles (no). **La app nunca recibe un id de Drive de afuera del árbol** y el portero nunca responde
  con algo de afuera.
- **Accesos directos** (`application/vnd.google-apps.shortcut`): se muestran como "acceso directo" y **no se siguen
  nunca** (apuntan a cualquier lado del Drive).
- **Documentos de Google** (Docs, Sheets, Slides): no tienen bytes propios. Se ofrecen bajados como PDF por el portero
  (`files.export`, que Google corta en 10 MB); si pasa, "no se puede bajar desde la app" (decisión 5).
- **Cómo se ve:** un diálogo (a pantalla completa en el teléfono) con el nombre y *Bajar todo* arriba, migas de pan que
  **empiezan en la carpeta** (`Referencias › Fotos › Dia 2`), primero las subcarpetas y después los archivos en orden
  natural, con miniatura o ícono, nombre y peso. Lista o cuadrícula (se recuerda por dispositivo).
- **Miniaturas:** las hace Drive (`thumbnailLink`), pero piden la conexión del dueño y Google no deja usarlas directo
  desde una página. Van por el portero: `/t/<pase>` pide la miniatura a Drive (del tamaño justo) y la guarda en la
  caché de Cloudflare (gratis) por archivo y fecha de cambio; el navegador la guarda un día. Un pedido por miniatura
  que aparece en pantalla.
- **Abrir:** una foto o un video abre **el carrete con las fotos y videos de esa subcarpeta**, en el orden de la lista
  (el carrete pasa a aceptar elementos sin bloque, con su pase). Un adjunto se abre o se baja como en la página
  (`attachmentOpen.ts`, `AttachmentSheet.tsx`), con el pase de la lista.
- **Sin red:** la última lista de cada subcarpeta abierta y sus miniaturas quedan en el dispositivo (con un tope, por
  ejemplo 50 MB, lo más viejo se va primero): se ve lo último conocido con el aviso "sin conexión: puede haber
  cambios"; abrir un archivo pide red.
- **Agregar a esta carpeta** (nivel 3): soltar en el visor o el botón; sube a la subcarpeta abierta (sección 5).
  Borrar o renombrar desde la app: más adelante.

## 9. Bajar todo (entrega 2)

- **Primero, un cambio del portero:** CORS en `/m/` (`Access-Control-Allow-Origin` con el origen si está en
  `APP_ORIGINS`, `Vary: Origin`, `Access-Control-Expose-Headers: Content-Length, Content-Range, Content-Disposition`),
  para que la app lea los archivos con `fetch()`. El pase ya es la credencial: no abre nada nuevo.
- **La lista entera:** el visor recorre el árbol con `/folder/list` (unos 40 listados de subcarpetas por pedido) y
  recibe los pases. Si el zip tarda más de 8 horas, vuelve a listar lo que falta.
- **El zip se arma en el navegador:** cada archivo por su pase (los bytes vienen de Drive por el portero), zip "sin
  comprimir" (lo de VFX ya viene comprimido) con **CRC32 calculado en un Worker del navegador**, Zip64 para pasar los
  4 GB, las subcarpetas y los nombres repetidos por mayúsculas desambiguados (" (2)"). Dónde se escribe:
  - Chrome y Edge de computadora: `showSaveFilePicker()`, a medida que llega. Y "Bajar a una carpeta…"
    (`showDirectoryPicker()`), que escribe el árbol tal cual, sin zip.
  - Firefox y Safari (Mac e iPhone), D24: en memoria, con tope (1 GB; en el teléfono, 500 MB); pasado el tope, el
    aviso de bajar de a uno o desde la computadora con Chrome o Edge. Firefox por el service worker (sin tope) pedía
    pasar de `generateSW` a `injectManifest`: queda para otra entrega.
  - Se puede cancelar; lo que falla se saltea y se anota en `MISSING_FILES.txt` adentro del zip (era
    `LEEME_faltan.txt` en el diseño).
- **Por qué no en el portero:** el CRC de todos los bytes no entra en los 10 ms de CPU por pedido del plan gratis, ni
  pedir miles de archivos a Drive en los 50 llamados por pedido.

## 10. Permisos

- Quien ve la página ve la carpeta (el uso está en `page_files`) y, con ella, **todo lo que hay adentro en Drive**:
  el portero pide `media_file` de la carpeta en cada listado y en cada pase. Ver, Comentar, Editar e invitados con
  acceso a esa página: ven y bajan. Agregar archivos: nivel 3 (Editar).
- **Nunca hacia arriba:** sección 8. Cada pase firma **un** id de Drive, comprobado adentro del árbol al firmarlo.
- **Nada se comparte en Google**; ningún navegador de un miembro recibe un token de Drive.
- Sacar a alguien de la página o del workspace le corta el acceso en el próximo pedido (los pases ya dados duran hasta
  8 horas, como hoy con las fotos).

## 11. Papelera, peso y búsqueda

- **Sacar el bloque:** la carpeta entra a la papelera de archivos como **un elemento** (la fila de la carpeta, como
  cualquier archivo). **Restaurar** (deshacer, volver a pegar, restaurar la página) la saca. En Drive no pasa nada.
- **Mandar a la papelera de Drive** (dueño y admins, como hoy, con el mismo `/trash`: la carpeta de Drive lleva la
  marca `sdFile`): Drive se lleva la carpeta con todo lo de adentro, **también lo que se agregó a mano**. La
  confirmación lo dice. Lo que alguien puso adentro siendo dueño de otra cuenta de Google no va a la papelera del dueño
  (así funciona Drive).
- **Peso del proyecto (P.7):** cuenta el `size` de la fila de la carpeta, que es **lo que se subió al crearla**. Lo
  agregado después (desde la app o a mano) no suma: el diálogo de Drive lo dice en una línea. Más adelante, "Recalcular
  el peso de las carpetas" (el portero recorre el árbol, unos 40 listados por pedido) con una función nueva de la base
  que guarde el total (migración aparte).
- **Buscar (P.12):** encuentra la carpeta por su nombre; lo de adentro, no (está en Drive). Buscar adentro de una
  carpeta (con `name contains` de Drive, limitado al árbol) queda para más adelante.
- **P.10:** las carpetas no guardan copia en el dispositivo (sección 5): no hay nada que liberar.

## 12. Cuánto entra en el plan gratis

Límites del plan gratis de Cloudflare: **100.000 pedidos al Worker por día** y 100.000 al Durable Object (para toda la
cuenta), 50 llamados afuera por pedido y 10 ms de CPU por pedido (el streaming casi no usa CPU). Con el diseño de la
sección 4, un pedido de control hace 1 llamado al Durable Object y uno de bytes, ninguno (con la instancia caliente):
**el límite que manda es el del Worker**. Cuentas para una carpeta de 10.000 archivos en 500 subcarpetas (unos 40
llamados a Drive por pedido):

| Operación | Pedidos al Worker | Parte del día |
|---|---|---|
| Subir, bytes directo a Google (plan A) | ~13 (crear el árbol) + ~250 (abrir las subidas) ≈ **270** | 0,3 % |
| Subir, bytes por el portero (plan B) | ~270 + 1 por archivo de hasta 64 MiB (y 1 más por cada 64 MiB) ≈ **10.300** | ~10 % |
| Abrir una subcarpeta del visor | 1 (hasta 1000 cosas; 1 más cada ~40.000) | — |
| Ver una cuadrícula de 500 fotos | 1 por miniatura que aparece ≈ 500 | 0,5 % |
| Abrir una foto o un PDF | 1 | — |
| Ver un video | 1 por cada pedido por partes del navegador (entre 5 y 30) | — |
| Bajar todo (zip de 10.000 archivos) | ~13 a 100 (listar el árbol: de a 40 subcarpetas y 100 cosas por pedido) + 10.000 ≈ **10.000** | 10 % |

- **Por día**, sin contar el resto del uso: subir unos 300.000 archivos (plan A; antes frena Drive, con unas pocas
  creaciones por segundo) o unos 95.000 archivos chicos (plan B), o bajar en zips unos 95.000 archivos. **En la
  práctica no hay tope por carpeta**: una carpeta muy grande se sube en el día (o en varios, si Drive frena) y se
  puede partir en tandas sin que nadie lo note.
- El diseño anterior costaba unos 20.000 pedidos al Worker y 130.000–150.000 al Durable Object para lo mismo: se
  pasaba del día.
- La caché del arranque de los videos (`Doc_Portero.md`) sigue: suma unos pocos llamados al Durable Object por video,
  lejos del límite.
- Si igual un día se pasa, Cloudflare corta los pedidos hasta el día siguiente (UTC) para todo el workspace, también
  ver fotos. La cola de carpetas lleva la cuenta de lo que pidió en el día y frena antes, con el aviso "sigue mañana";
  lo suelto nunca espera. Salida: el plan pago de Workers.
- Los números son cuentas sobre el diseño: la entrega 0 los mide con los registros de Cloudflare.

## 13. Base de datos

- **Entrega 1, sin migración:** la carpeta es una fila de `files` registrada con `register_file` (`mime =
  'inode/directory'`, `size` = lo subido al crearla) y `set_file_drive` (id de la carpeta en Drive). `media_file`,
  `file_level`, la papelera, `trashed_files`, `purge_file`, `media_purged`, `project_sizes` y el bucket `thumbs` (sin
  miniatura) andan tal cual.
- La app nueva exige una base con la papelera de archivos (`schema_version` 6 o más, `TRASH_SCHEMA_VERSION`); no hace
  falta otra constante.
- **Más adelante (migración aparte):** guardar el peso recalculado de una carpeta; y, si hiciera falta, una lista de
  lo de adentro para buscar sin ir a Drive.

## 14. Versiones viejas

| Quién | Qué ve y qué puede hacer | ¿Se pierde algo? |
|---|---|---|
| App v0.049–v0.051 | Tarjeta de adjunto con el nombre y el peso subido (un nombre como `2026.09.30` muestra una extensión falsa, "30"). Abrir o bajar: aviso genérico. Copiar, mover, borrar el bloque y la papelera andan. | No. |
| App v0.041–v0.048 | Recuadro gris con el ícono de foto; el carrete, su aviso genérico. | No. |
| App nueva, portero viejo | Soltar una carpeta: rechazado, "el dueño tiene que actualizar el portero" (lo sabe por `/drive/status`, `features: ['folders']`). Una carpeta ya subida se ve en la página pero el visor dice lo mismo. | No. |
| App nueva, Drive conectado solo con `drive.file` (si se elige el camino 1) | El visor muestra lo que subió la app y un aviso al dueño: "reconectá Drive para ver lo que se agrega a mano". | No. |
| Portero viejo con una carpeta ya subida | `/trash` de la carpeta anda (tiene la marca); `/pass` de la carpeta da un pase que falla al servir (Drive no baja carpetas). | No. |

**Sin subir `min_app_version`.**

## Riesgos

- **Subida directa sin CORS** (sección 5): si Google no acepta el `PUT` desde el navegador, plan B (10 % del día por
  cada carpeta de 10.000 archivos). Se sabe en la entrega 0.
- **`drive.readonly`:** el portero puede leer todo el Drive del dueño; un error en la regla "nunca hacia arriba" sería
  grave. Pruebas del portero con árboles con accesos directos, archivos movidos afuera, subcarpetas movidas, carpetas
  compartidas por otros y ciclos de `parents`. Una organización de Google Workspace puede bloquear apps sin verificar.
- **Vista en vivo:** alguien con acceso al Drive puede poner adentro algo que después todos los que ven la página
  pueden bajar (también algo que no debería estar ahí). Es lo pedido; conviene decirlo en el diálogo de Drive.
- **Ritmo de Drive:** miles de archivos chicos llevan horas; el portero y la cola tienen que respetar los 429.
- **Sin copia en el dispositivo:** si la pestaña se cierra, hay que volver a soltar la carpeta (fuera de Chrome y
  Edge). Nada se pierde, pero es un paso más.
- **Pases de 8 horas en la lista:** un miembro sacado de la página conserva hasta 8 horas los pases de lo que ya listó
  (igual que hoy con las fotos).
- **El iPhone:** puede que no haya forma de elegir una carpeta (respondido: se pide comprimir).
- **Peso del proyecto:** subestima lo agregado después.

## Entregas y pruebas

1. **Entrega 0, pruebas a mano (sin código de la app):**
   - Subida directa: un Worker de prueba abre una subida reanudable con `Origin: <la app>` y una página de la app
     manda un archivo de 100 MB por partes y retoma después de cortar la red. En Chrome, Firefox, Safari de Mac y el
     iPhone. Decide plan A o B.
   - Leer carpetas al soltar y con `webkitdirectory` / `showDirectoryPicker` en todos los navegadores.
   - `files.list` con `drive.file` y con `drive.readonly` sobre una carpeta con archivos agregados a mano;
     `thumbnailLink` por el portero.
   - Cuántos pedidos y llamados al Durable Object cuesta cada ruta, con los registros de Cloudflare.
2. **Entrega 1a, portero** (publicado antes que la app): lógica de control en el Durable Object con cachés en memoria,
   `/folder/prepare`, `/folder/sessions`, `/folder/list` con pases, `/t/<pase>`, la regla del árbol, accesos directos,
   documentos de Google, `/pass` de una carpeta rechazado (`is_folder`), `features`, y `drive.readonly` si se elige.
   Pruebas en `portero/src/core.test.ts`.
3. **Entrega 1b, app:** leer la carpeta, la ventana, registrar e insertar, la subida directa (o plan B) con su cola,
   retomar, la tarjeta, el visor (lista, cuadrícula, carrete, abrir y bajar uno, sin red), "Agregar a esta carpeta",
   papelera, textos y docs.
4. **Entrega 2:** CORS en `/m/` y *Bajar todo*.

Pruebas de la app: unidad (recorrer entradas con más de 100 por carpeta, salteados, lista de trabajo que sobrevive a
cerrar, retomar comparando por ruta y peso, ventana de direcciones por delante, 429 que espera, un error que no frena,
el cupo del día), jsdom con el esquema publicado (una página con una carpeta se abre, se edita y se mueve sin perder
nada; `mediaIdsInDoc` la cuenta), jsdom con el editor nuevo (soltar `[carpeta, a.pdf]` da dos bloques `image` en
orden) y de punta a punta con el portero real: una carpeta de 2000 archivos en 3 niveles, verla desde una cuenta con
Ver, que una cuenta sin la página no la vea, un archivo agregado a mano en Drive que aparece (con `drive.readonly`),
un acceso directo que no se sigue, una subcarpeta movida afuera que deja de verse, papelera y restaurar.

## Respondidas por Lega (2026-09-30)

1. **Dónde va en el Drive:** `<Proyecto>/Carpetas/<nombre>`. De acuerdo.
2. **No queda congelada:** "quedará como un link a esa carpeta; alguien puede entrar al Drive y modificar el
   contenido". El bloque es una vista en vivo de la carpeta de Drive (secciones 3 y 8). Por eso cambió el modelo: una
   sola fila de `files` y nada por archivo.
3. **Sin tope de archivos y en el plan gratis**, con la pregunta "¿por qué Cloudflare? ¿se puede saltear?": secciones
   4, 5 y 12. Cloudflare queda solo como portero (la conexión con Google, los permisos, los pases) y los bytes de las
   subidas pueden ir directo a Google.
4. **Bajar todo como zip:** sí, en la entrega 2, con los bytes de Drive por el portero (sección 9).
5. **iPhone sin forma de elegir una carpeta → pedir que se comprima:** de acuerdo.
6. **Nombres de las carpetas (D3 → B, 2026-10-02):** el 2026-10-01 Lega delegó y quedó respetar el nombre en las
   carpetas que suelta el usuario (v0.089 a v0.127); el 2026-10-02 decidió lo contrario: **ningún nombre de carpeta
   que la app crea en el Drive lleva espacios, nunca**, tampoco estas. «Día 2 - Puerto» queda `Día_2_-_Puerto` en
   el Drive, y sus subcarpetas también (`driveFolderName` en `portero/src/core.ts`): se saca lo que saca
   `cleanFileName` (igual en la app y en el portero: controles, marcas de dirección y caracteres de ancho cero,
   también U+200C; el U+200D solo se queda entre dos emojis, así que una familia o un emoji con tono se mantienen;
   las barras van como `_`), se corta en 200 caracteres por grafema, se sacan los espacios de los bordes y **cada
   tramo de espacios pasa a un solo `_`** (tildes, eñes, emojis y los `_` del usuario quedan tal cual); vacío,
   `Folder`. En la app, la tarjeta y el nombre de la fila siguen siendo los del usuario (con espacios). Una segunda
   carpeta con el mismo nombre en el proyecto, sin distinguir mayúsculas, sigue llevando `_2`
   (`Día_2_-_Puerto_2`). **Lo ya subido** con espacios (`Dia 2`, de v0.089 a v0.127) o con guiones bajos (antes de
   v0.089) no se renombra: el portero nunca busca una carpeta por su nombre sino por su marca `sdFile` (la raíz) y
   `sdPath` (cada subcarpeta, que sale de la ruta que manda la app, con los nombres originales), así que volver a
   soltarla no duplica nada y lo nuevo va adentro de la vieja con guiones bajos (puede quedar `Dia 2/Toma_2`). Una
   subida vieja con `Dia 2` y una nueva `Dia_2` son nombres distintos: no llevan `_2`.

## Decisiones que quedan (a confirmar por Lega)

1. **Permiso de Google:** sumar `drive.readonly` para que se vea lo agregado a mano en Drive (el dueño reconecta una
   vez; el portero puede leer todo su Drive) o quedarse con `drive.file` (solo se ve lo agregado desde la app).
   Propuesta: sumarlo.
2. **Sin copia en el dispositivo** para las carpetas (se retoma volviendo a soltar la carpeta, o con "Seguir" en
   Chrome y Edge), a diferencia de las fotos y los adjuntos.
3. "Agregar a esta carpeta" desde la app en la entrega 1 (nivel Editar); borrar y renombrar, más adelante.
4. El peso del proyecto cuenta lo subido al crear la carpeta; recalcularlo, más adelante.
5. Documentos de Google adentro de una carpeta: bajarlos como PDF (hasta 10 MB) o solo mostrarlos.
6. Miniaturas de Drive por el portero (un pedido por miniatura) en la cuadrícula.

## Historia: el primer diseño y su auditoría

El primer diseño (commit `47bbbf4`) tenía una fila de `files` por archivo de adentro, con `folder_id` y `rel_path`,
una migración grande (`register_folder`, `register_folder_files`, `folder_files` y cambios en permisos, papelera y
peso), copia de todo en el dispositivo antes de subir y la carpeta congelada después de subida. Una auditoría
independiente encontró (commit `21ee8e3`): `/m/` sin CORS para el zip; los límites diarios de Cloudflare (10.000
archivos costaban ~20.000 pedidos al Worker y 130.000–150.000 al Durable Object: se pasaba del día); carpetas
duplicadas en Drive con subidas en paralelo (`once()` vale por instancia) y un segundo `set_file_drive` tomado como
"listo"; que `pending: 2` no protegía de pestañas viejas (el lock de la base ya lo impide) y que varios lugares leen o
fuerzan `pending: 1`; la lentitud de la cola con 10.000 registros; el lugar de inserción del bloque después de minutos
de copia; archivos ilegibles y `item_count`; textos de las versiones viejas; detalles de la migración; y el zip (CRC32,
Safari, `injectManifest`).

Con las respuestas de Lega el modelo cambió y casi todo eso desaparece: no hay filas por archivo (ni migración, ni
registros por archivo en el dispositivo, ni `pending: 2`), no hay copia (ni inserción diferida), el árbol se crea en
orden adentro del Durable Object y los pedidos bajan a lo de la sección 12. Siguen valiendo, incorporados arriba: CORS en
`/m/` antes del zip, el CRC32 en un Worker del navegador, Safari en memoria, `injectManifest`, crear el árbol en orden
en el Durable Object, cachés en memoria con vencimiento, y los textos reales de las versiones viejas.
