# Arrastrar una carpeta entera (P.9)

Estado: **diseño, sin implementar**. Rediseñado el 2026-09-30 con las respuestas de Lega (ver "Respondidas por
Lega"): la carpeta de la página es **una vista en vivo de una carpeta del Drive**, sin tope de archivos y en el
plan gratis de Cloudflare. El primer diseño (commit `47bbbf4`, una fila de `files` por archivo) y su auditoría
quedan resumidos al final, en "Historia"; lo que la auditoría encontró y sigue valiendo está incorporado.
Sale de leer `fileDrop.ts`, `queue.ts`, `mediaDb.ts`, `attachments.ts`, el portero (`portero/src/`) y las
migraciones de archivos y de la papelera en `main` (v0.051).

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
- **Nombres:** Drive acepta cualquier nombre; se limpian solo los controles y las marcas de dirección
  (`cleanFileName`). Dos nombres que solo difieren en mayúsculas se suben tal cual (el zip los desambigua).

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
  - Firefox: por el service worker, a medida que se arma (hoy el service worker se genera solo, `generateSW`: una ruta
    propia pide pasar a `injectManifest`).
  - Safari (Mac e iPhone): en memoria, con tope (1 GB; en el iPhone, 500 MB); pasado el tope, el aviso de bajar de a
    uno o desde la computadora.
  - Se puede cancelar; lo que falla se saltea y se anota en un `LEEME_faltan.txt` adentro del zip.
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
| Bajar todo (zip de 10.000 archivos) | ~13 (listar el árbol) + 10.000 ≈ **10.000** | 10 % |

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
