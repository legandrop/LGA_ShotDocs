# Espacio en el dispositivo y "Available offline" (P.10)

Estado: **diseño, sin implementar, esperando su auditoría.** Esta versión sale de las decisiones de Lega del
2026-10-01 (**D-25**, `Doc_Decisiones.md`) y reemplaza al diseño anterior ("liberar a mano por defecto", commits
`47bbbf4` y `cd6cb98`). De aquel diseño y de su auditoría sigue valiendo, y quedó adentro de este, todo lo que
asegura que nunca se borra un original sin confirmar: la comprobación en tres pasos con `POST /verify`, el
`relink` sin bytes después de una restauración, `lastUsedAt` con "ahora" para lo anterior y medir con las sumas
propias y no con `estimate()`. Sale de leer `main` en `e9eb660` (v0.077): `src/media/queue.ts`,
`src/media/mediaDb.ts`, `src/ui/sharpImages.ts`, `src/ui/carreteLoader.ts`, `src/ui/attachmentOpen.ts`,
`src/ui/printPage.ts`, `Doc_Sincronizacion.md`, `Doc_Imagenes.md`, `Doc_Portero.md`, `Doc_Proyectos_Borrar.md` y
`Doc_Carpetas.md`.

## Qué se pide (D-25)

1. **Tope automático:** la app usa hasta **2 GB por dispositivo**. Al pasarlo, borra las copias **ya confirmadas
   en el Drive** que hace más tiempo no se abren. La miniatura queda siempre. **Nunca** se borra algo que no está
   confirmado en el Drive.
2. **Available offline** para una **página** (con sus subpáginas) o un **proyecto entero**: baja todo lo que falta
   para usarlo sin red (un rodaje en una locación sin señal) y lo mantiene al día mientras haya red. Lo marcado
   no cuenta para el tope y nunca se libera solo.
3. **Una ventana al marcar**, con casillas y su peso: *Fotos en grande* (2048 px, la nítida de
   `src/ui/sharpImages.ts`) tildada; *Fotos originales* destildada; *Adjuntos* (PDF, documentos) tildada, hasta
   50 MB cada uno; *Videos* destildada; *Carpetas del Drive* destildada (P.9). Los pesos se calculan de todo,
   también de lo destildado, y el total de lo elegido; mientras calcula, un indicador circular por fila y en el
   total. Muestra el espacio libre del dispositivo y no arranca si no entra. Barra de progreso ("Descargando 340
   de 620 · 1,2 GB") y aviso de "listo para usar sin red".
4. **A mano:** "Espacio en este dispositivo" en el menú de la cuenta: cuánto ocupa, lo marcado, *Free up space* y
   desmarcar.

## Reglas que no se rompen

- **Un original propio** (el que se agregó en este dispositivo, `blobs[<id>]`) se borra solo si pasa la
  comprobación de tres pasos de la sección 5.3, repetida adentro de la transacción que lo borra. Sin red, o si
  cualquier paso falla o no contesta, no se borra.
- **Dos espacios de claves que no se tocan:** lo que se baja para "Available offline" vive en claves con prefijo
  (`off:`, `offview:`, sección 2). El código que borra copias bajadas solo puede borrar claves con esos prefijos;
  la **única** función que borra `blobs[<id>]` sin prefijo es la que libera un original propio (`freeOwn`). Un
  error al armar una clave nunca puede llevarse un original sin subir.
- **Nunca se borra:** el registro (`files`), la miniatura, lo que se sabe del archivo (`known`), los usos
  (`links`), el texto de las páginas ni los comentarios. La página se ve igual.
- **Lo que pide una marca no se libera solo**, ni por el tope ni por falta de lugar. Solo la persona lo suelta
  (desmarcando o con *Free up space*, que no toca lo marcado).
- **Sin versión nueva de IndexedDB ni almacenes nuevos:** claves nuevas en los almacenes que ya existen y campos
  opcionales. Una versión vieja las ignora (sección 11).
- **Sin cambios en el documento ni en la base** (ninguna migración). El portero sí cambia (entrega 0).
- **Solo lo que la persona puede ver:** todo lo que se baja pasa por la base (con Row Level Security) y por un pase
  del portero, que pide permiso con la sesión de la persona.

## Resumen

| | Cómo |
|---|---|
| Qué se marca | Una página con todas sus subpáginas, o un proyecto entero. Por dispositivo y por cuenta. |
| Qué se baja | Siempre: las miniaturas y los comentarios. Según las casillas: la nítida de 2048 de cada foto, los originales de las fotos, los adjuntos de hasta 50 MB, los videos. El texto de todas las páginas ya está en el dispositivo. |
| Dónde | IndexedDB, en la base de archivos de siempre (`<base local>:media`), con claves `off:` y `offview:`. |
| Pesos | `files.size` de la base para lo que se baja entero; la nítida, estimada por sus píxeles (sección 3.3). |
| Al día | Después de cada sincronización que cambió algo de la rama, se baja lo nuevo. |
| Tope | 2 GB de copias no marcadas; pasado eso, se liberan las confirmadas que hace más que no se abren. |
| A mano | *Storage on this device*, en el menú de la cuenta. |
| Portero | `POST /verify` (en lote), `only: 'known'` en `POST /upload` y `features`, antes de liberar originales propios. |

## 1. Qué guarda hoy cada dispositivo

Cada cuenta de cada workspace tiene su base `<base local>:media` (`mediaDbName`):

| Almacén | Qué tiene hoy | Se borra hoy |
|---|---|---|
| `files` | Un `MediaRecord` por archivo **agregado en este dispositivo**. | Nunca. |
| `blobs` | El original entero de lo agregado acá. | Nunca. |
| `thumbs` | Las miniaturas (`<id>`) y las nítidas de la página (`view:<id>`, `view1024:<id>`, `Doc_Imagenes.md`). | Las nítidas, pasado 150 MB u 800 (`viewIndex` en `meta`), o todas si falta lugar al agregar un archivo. |
| `known` | Lo que la base sabe de archivos de otros dispositivos. | Al restaurar una copia de la base. |
| `links`, `meta` | Usos por página y ajustes de la cola. | — |

Además, en la base local de siempre: el árbol y **el contenido de todas las páginas** (la sincronización baja
todas, también las que nunca se abrieron: `Doc_Sincronizacion.md`, "Contenido de las páginas", punto 4). En
`<base local>:comments`, los comentarios **solo de las páginas que se abrieron**. De los archivos de otros
dispositivos se guardan la miniatura (al mostrarlos) y la nítida (si se vio grande), nunca el original.

O sea: el texto ya anda sin red en todos lados. Lo que falta para "Available offline" son las fotos en grande, los
originales, los adjuntos, los videos y los comentarios de las páginas que no se abrieron.

## 2. Qué se guarda nuevo y dónde

| Almacén | Clave | Qué |
|---|---|---|
| `blobs` | `off:<id>#<n>` | Una **copia bajada** del Drive (el archivo entero), en partes de 16 MiB (`n` desde 0; una sola si pesa menos). |
| `thumbs` | `offview:<id>` | La nítida de 2048 de una foto, hecha para una marca. **No** entra en `viewIndex`: el tope de 150 MB de las nítidas no la toca. |
| `meta` | `copy:<id>` | Una entrada por archivo con alguna copia en el dispositivo (sección 2.1). |
| `meta` | `offline:<marca>` | Una marca (sección 3.1). |
| `meta` | `space:rollout` | Cuándo estrenó este dispositivo el tope (sección 5.6). |
| `files` | `freedAt` (opcional) | En el `MediaRecord`: cuándo se liberó el original propio. |

### 2.1 La entrada `copy:<id>`

```
{ id, usedAt,                       // la última vez que se abrió (sección 5.5)
  orig?: { bytes, parts, mime, savedAt, complete },   // copia bajada (off:)
  view?: { bytes } }                // nítida de una marca (offview:)
```

Una entrada por clave (y no un índice único, como `viewIndex`) para poder borrar la copia y su entrada **en la
misma transacción** (`blobs`, `thumbs` y `meta`). Se leen todas con un rango de claves (`copy:` a `copy:￿`).
Una sola pestaña usa la base a la vez (Web Locks), así que no hay dos escritores.

### 2.2 Por qué IndexedDB y no la caché del service worker

- Todo lo que lee archivos (carrete, adjuntos, impresión, nítidas) ya lee de IndexedDB; con Cache Storage habría
  que hacer otra ruta de lectura y otra contabilidad.
- Los pases del portero cambian (vencen a las 8 horas): Cache Storage necesitaría claves propias y que el service
  worker pase de `generateSW` a `injectManifest`.
- En Safari las dos comparten la misma cuota y el mismo desalojo: Cache Storage no da más lugar ni más seguridad.
- El service worker nuevo borra su caché al publicar una versión: no es lugar para algo que tiene que durar.

### 2.3 Por qué prefijos y no un almacén nuevo

Un almacén nuevo obliga a subir la versión de la base de archivos, y una versión vieja de la app (una pestaña sin
recargar, un iPhone sin red) ya no podría abrirla: se quedaría sin cola de fotos (`Doc_Sincronizacion.md`, "Si la
base de archivos del dispositivo no se abre"). Las nítidas ya usan este mismo recurso (`view:` en `thumbs`).

### 2.4 Leer una copia bajada

`new Blob([partes…], { type: mime })`, sin copiar los bytes (el navegador arma la vista sobre las partes guardadas).
Solo cuenta si `complete` y si la suma de las partes da `files.size`.

## 3. Available offline

### 3.1 Qué se marca

- **Una página con sus subpáginas**, o **un proyecto** (todas sus páginas raíz con todo lo de abajo). La rama se
  calcula del árbol local cada vez: una subpágina nueva, una que se movió adentro o una restaurada de la papelera
  entran solas; una que se movió afuera, se mandó a la papelera o dejó de verse, sale.
- **Es del dispositivo y de la cuenta** (va en `<base local>:media`), no del documento: otro dispositivo o
  otra persona no se enteran.
- La marca guarda: `{ id, kind: 'page' | 'project', target, title, options, createdAt, state, scanned, error }`,
  con `options = { sharp, originals, attachments, videos, folders }` y `scanned` = el `seq` de cada página de
  la rama la última vez que se leyó su contenido (sección 3.6).
- Dos marcas pueden cruzarse (un proyecto y una página suya): lo protegido es la **unión** de lo que pide cada una.
  Marcar una página que ya está adentro de una rama marcada lo dice ("Already offline with *Proyecto*") y
  deja sumar casillas.

### 3.2 Qué baja cada casilla

| Casilla (UI en inglés) | Por defecto | Qué se guarda | Peso que se muestra |
|---|---|---|---|
| *Large photos* (2048 px) | Tildada | La nítida de 2048 (`offview:`) de cada foto de más de 576 px de lado. Para hacerla se baja el original y se reduce acá (como hoy la página); el original no se guarda. | Estimado (sección 3.3) |
| *Original photos* | Destildada | El original entero de cada foto (`off:`). Con esta tildada no hace falta la nítida: se hace del original cuando se ve. | `files.size` |
| *Attachments up to 50 MB* | Tildada | El original de cada adjunto (PDF, documentos, todo lo que no es foto ni video) de hasta 50 MB. Los más grandes se nombran en la fila ("3 over 50 MB are not included"). | `files.size` |
| *Videos* | Destildada | El original entero de cada video. | `files.size` |
| *Drive folders* | Destildada | Lo de adentro de las carpetas de P.9. **Recién cuando P.9 esté publicado**; hasta entonces la fila no aparece. | Del listado del portero (P.9) |

Siempre, sin casilla: **las miniaturas** que falten de todos los archivos de la rama y **los comentarios** de
todas sus páginas (son chicos y sin ellos la página se ve rota sin red). Una línea del total los suma
("Thumbnails and comments · 12 MB").

**Un original propio** (agregado en este dispositivo y todavía en `blobs`) ya cubre su fila sin bajar nada. Queda
protegido si su casilla lo pide (*Original photos*, *Videos*, *Attachments*). Con solo *Large photos*, se hace su
nítida de 2048 desde el original (sin red, sin bajar nada) y el original sigue con el tope como cualquier otro
(pregunta 3).

No se baja: lo que la base no devuelve (sin permiso), lo que está en la papelera de Drive (se ve como borrado), lo
que todavía no llegó a Drive (otro dispositivo lo está subiendo: se espera y se baja cuando llegue), los links de
Drive pegados como tarjeta (`Doc_Sincronizacion.md`, "Links de Drive": son del Drive de otro) y lo de afuera de la
app (videos de YouTube, links).

### 3.3 Cómo se calculan los pesos

Se calcula **todo**, también lo destildado, y cada fila muestra lo que **falta bajar** (lo que va a ocupar
lugar) y, en gris, lo que ya está ("420 photos · 118 MB · 40 MB already on this device").

1. **Las páginas** de la rama, del árbol local (en el acto).
2. **Los archivos** de cada página: `mediaIdsInDoc` (`src/media/usage.ts`) sobre el contenido local, que mira
   el `url` de cualquier elemento (fotos-bloque, fotos en línea, adjuntos, videos). Se suman los usos que la base
   conoce (`page_files`) por si un dispositivo todavía no bajó un cambio.
3. **Los datos** de cada archivo: `fetchMediaFiles` de a lotes (la base, con su Row Level Security): tipo, peso
   (`files.size`), medidas, `drive_id`, papelera. Sin red, lo guardado en `known` y en `files`; lo que no se sabe
   queda en "—".
4. **Lo que ya está** en el dispositivo: `blobs`, `copy:`, `offview:`, `view:` y miniaturas.

**La nítida, estimada** (la de verdad depende de la foto). De las mediciones de `Doc_Imagenes.md` (WebP 0,8: entre
0,7 y 0,9 bits por píxel; JPEG 0,8 de Safari: entre 1,0 y 1,5):

- Foto de hasta 576 px de lado (`THUMB_SIDE × VIEW_GAIN`): 0 (alcanza la miniatura).
- JPEG de hasta 900 KB que ya entra en 2048: `files.size` (se guarda tal cual, como hoy).
- Con medidas: píxeles de la reducida a 2048 × 0,9 bits (WebP) o × 1,4 bits (Safari) / 8, y nunca más que
  `files.size`. Una foto de teléfono de 4032 × 3024: unos 350 KB (550 KB en Safari).
- Sin medidas: 400 KB (600 KB en Safari).
- Una foto que el navegador no abre (TIFF, RAW, un HEIC que no se convirtió): 0, y la fila lo dice ("5 photos
  can't be made large here: only with *Original photos*").
- Se muestra con "≈". Al terminar, la marca guarda lo que de verdad ocupó.
- Miniatura que falta: 40 KB cada una.

**Lo que se baja por la red** no es lo mismo que lo que ocupa: para la nítida se baja el original entero. El
total lo dice aparte ("Uses ≈1.2 GB · downloads ≈3.4 GB"), por los datos del teléfono (pregunta 5).

**Indicador circular:** cada fila lo muestra mientras le falta el paso 3 o el 4; el total, mientras falte alguna
fila tildada. Tildar o destildar cambia el total en el acto con lo que ya se sabe.

### 3.4 La ventana

```
Available offline · Escena 12 (and 14 pages inside)

[x] Large photos (2048 px)        420 photos   ≈118 MB   ◌
[ ] Original photos               420 photos    1.6 GB
[x] Attachments up to 50 MB        12 files    86 MB     (3 over 50 MB are not included)
[ ] Videos                          6 videos    2.3 GB
    Thumbnails and comments                     12 MB

    Selected: ≈216 MB · downloads ≈1.7 GB
    Free on this device: 41 GB

    [Cancel]                                [Make available offline]
```

- **Espacio libre:** `quota − usage` de `navigator.storage.estimate()`. **No arranca** si lo elegido más un margen
  (200 MB, el `ROOM_MARGIN` de la cola) no entra: el botón queda apagado con el motivo ("Needs 3.4 GB; 2.1 GB
  free on this device"). Si el navegador no da el dato, arranca y lo frena el primer archivo que no entre.
- **Sin red:** las filas que no se pueden calcular quedan en "—" y el botón, apagado ("Connect to download").
- **Sin almacenamiento persistente** (`navigator.storage.persisted()` en `false`), una línea de aviso. En el
  iPhone, fuera de la app instalada: "Safari may erase this if you don't open the app for 7 days. Add Shot Docs
  to your Home Screen first" (sección 9).
- **En un teléfono:** "Keep the app open until it's ready" (sección 3.5).
- Al tocar el botón, la ventana pasa a la **barra de progreso**: "Downloading 340 of 620 · 1.2 GB of 3.4 GB",
  con *Hide* (sigue sola) y *Stop* (desmarca, sección 3.7). Al terminar: "Ready to use offline" en la ventana y un
  aviso (`notice.ts`) si la ventana ya se cerró.
- Una página ya marcada abre la misma ventana con lo elegido, el estado ("Ready · updated 5 min ago") y
  *Update now*, *Save* (si cambió alguna casilla) y *Remove*.

### 3.5 La descarga

- **La hace la pestaña de la cola**, al final de cada vuelta de la cola de fotos y videos y **después** de lo que
  falta subir: subir nunca espera a bajar. De a **dos archivos** a la vez.
- **Orden:** miniaturas y comentarios primero (son lo que más se ve), después nítidas, adjuntos, originales y
  videos, y dentro de cada grupo del más liviano al más pesado (así el contador avanza y lo útil llega antes).
- **Cada archivo:** un pase (`POST /pass`, el de `carreteLoader`, reusado mientras no venza) y la bajada de
  `/m/<pase>` con `fetch` (`cache: 'no-store'`; CORS en `/m/` desde v0.058). Hasta 16 MiB, en un pedido; más,
  **por partes con `Range`**, y cada parte se guarda apenas llega: si la app se cierra, se sigue desde la última
  parte. Al terminar se comprueba que lo bajado pesa `files.size` (y que `Content-Range` dice ese total); si no,
  se descarta y se reintenta una vez, y después queda con el error a la vista.
- **La nítida:** se baja el original (en memoria, sin guardarlo), se reduce con `viewImage` (`probe.ts`) a 2048 y
  se guarda en `offview:`. Si ya hay una `view:<id>` de 2048, se copia a `offview:` sin bajar nada.
- **Errores:** sin red o con el portero sin contestar, se espera a la próxima vuelta (1, 4, 16 minutos… hasta una
  hora, como las nítidas). Un 403 o 404 del portero, o `abusive`: ese archivo no se baja y la marca lo cuenta
  ("2 files are not available"). El Drive del dueño desconectado: la marca queda en "Waiting for the owner's
  Drive". Ninguno corta a los demás.
- **Lugar:** antes de cada archivo, si con él se pasa lo libre, primero se liberan copias no marcadas (sección
  5.2); si igual no entra, la marca se detiene en "Not enough space: needs 300 MB more" y nunca libera lo
  marcado.
- **Con la app cerrada o en segundo plano no baja nada** (el navegador no lo deja sin una API que Safari no tiene):
  sigue al volver. En el teléfono, mientras la ventana de progreso está abierta, se pide que la pantalla no se
  apague (`navigator.wakeLock`, donde exista).
- **"Listo"**: cuando todo lo que pide la marca está en el dispositivo, salvo lo que no está disponible (sin
  permiso, borrado, todavía subiendo desde otro dispositivo), que se dice en la misma línea.

### 3.6 Mantenerlo al día

- **Cuándo:** al abrir la app, después de cada sincronización que bajó algo de una página de la rama o cambió el
  árbol, y cada 10 minutos con red. Nada de esto corre sin red.
- **Qué se vuelve a leer:** solo las páginas cuyo `seq` cambió desde `scanned` (sección 3.1) y las que entraron a
  la rama; el resto ya está. Los comentarios de la rama, al abrir y cada una hora (`list_comments` con su cursor:
  solo lo nuevo).
- **Lo nuevo se baja** con las mismas reglas de la sección 3.5. **Lo que ya no se usa** en la rama (se borró de
  la página, la subpágina se movió afuera) deja de estar protegido: pasa a contar para el tope (sección 5) y se
  libera cuando toque. No se borra en el acto: un deshacer lo devolvería.
- **Un archivo que pasó a la papelera de Drive** se muestra como borrado (como hoy): su copia bajada deja de estar
  protegida y su nítida se borra (lo que ya hace `forgetView`).
- El estado de cada marca se ve en el diálogo (sección 6) y en el ícono del árbol (sección 3.8).

### 3.7 Desmarcar

- *Remove* en la ventana de la página o en el diálogo de espacio. Pregunta con el peso: "Stop keeping *Escena
  12* offline? The downloaded copies (1.2 GB) will be removed from this device. Everything stays in Drive". Con
  una casilla, tildada: "Remove the copies now". Destildada, las copias quedan y pasan a contar para el tope.
- Lo que sigue pedido por otra marca no se borra. Una descarga en curso se corta y sus partes se borran.
- **Nunca toca un original propio** (no tiene prefijo): solo deja de protegerlo.

### 3.8 Dónde se ve

- **Marcar:** en el menú "⋯" de la página (barra lateral y barra de la página) y en el del proyecto (selector de
  proyectos, junto a archivar y borrar de D-23): *Available offline…*.
- **En el árbol:** un ícono chico en la página marcada (no en cada subpágina), con `data-tip` solo si suma algo
  ("Ready offline · updated 5 min ago", "Downloading 340 of 620", "Not enough space"). En el selector, lo mismo en
  el proyecto.
- **En el estado de la sincronización**, mientras baja: "Downloading for offline: 340 of 620", sin contarlo como
  cambios pendientes (no es algo que se pueda perder).

## 4. Permisos, proyectos archivados o borrados, y sacar a alguien

- **Marcar** puede cualquiera que vea la página (nivel 1, Ver). Bajar usa los mismos caminos que ver: la base con
  su Row Level Security y el pase del portero, que pide permiso con la sesión. Nada se baja de lo que la persona no
  puede ver.
- **Una página que deja de verse** (le sacaron el permiso): sale de la rama en la próxima sincronización. Las
  copias bajadas de sus archivos que ninguna otra página visible usa **se borran** en la siguiente vuelta de
  mantenimiento, cuando la base deja de devolver el archivo o el portero responde 403 (pregunta 9). Los
  originales propios no se tocan (son de esta persona y pueden estar sin subir).
- **Proyecto archivado** (D-23): archivar es solo orden; la marca sigue igual.
- **Proyecto borrado** (P.14): para todos pasa a nivel 0. La marca queda en pausa ("Project deleted") y sus copias
  bajadas se borran como en el punto anterior. Si se restaura, la marca sigue y vuelve a bajar.
- **Sacado del workspace:** el ciclo se detiene y `RemovedScreen` hace lo de siempre; *Remove from this device*
  borra la base entera, con las copias.

## 5. El tope de 2 GB

### 5.1 Qué cuenta

Las **copias enteras** que no pide ninguna marca:

- los originales propios en `blobs[<id>]` (subidos o no),
- las copias bajadas (`off:`) que ya no pide ninguna marca,
- las nítidas de la página (`view:`, con su propio tope de 150 MB, que sigue).

No cuentan: lo marcado, las miniaturas, el texto, los comentarios y el código de la app (son chicos y nunca se
liberan). Se mide con **las sumas propias** (`size` de los registros, `bytes` de `copy:` y de `viewIndex`), no con
`estimate()`, que en Safari y Firefox tarda en bajar después de borrar (auditoría anterior, corrección 5).

**Lo que espera subir cuenta pero no se puede liberar.** Si solo eso pasa los 2 GB, no se libera nada y la app no
deja de aceptar archivos: el tope es una meta, no un límite para agregar. Lo único que rechaza un archivo es que no
entre en la cuota del navegador (`checkRoom`, sección 5.7).

### 5.2 Cuándo corre y qué libera

- **Cuándo:** una vez por apertura (después de la primera sincronización, con red), después de que la cola confirma
  subidas, después de cada tanda de descargas de una marca y cuando algo no entra (sección 5.7). Solo en la pestaña
  de la cola.
- **Qué:** si el total pasa 2 GB, los candidatos se ordenan **del que hace más que no se abre** (`usedAt`) al más
  reciente, y se liberan hasta bajar a **1,8 GB** (el 10 % de margen evita liberar de a uno cada vez que se agrega
  algo).
- **Candidatos, por tipo:**
  - nítida de la página (`view:`): siempre (se rehace sola);
  - copia bajada (`off:`): si la base dice que el archivo sigue en Drive (`drive_id`, sin `purged_at` ni
    `drive_trashed_at`; un pedido de `fetchMediaFiles` para muchos);
  - original propio: solo con los tres pasos de la sección 5.3.
- **Nunca solos:** lo marcado, lo que espera subir, lo que tiene `uploadId` o `heic` pendiente, lo detenido
  (`blocked`), lo que está en la papelera de la app o en la de Drive (puede ser la última copia fuera de una
  papelera: auditoría anterior, corrección 4) y lo de un portero sin `verify`.
- **Sin red no se libera nada.** Si con todo lo liberable no alcanza, no se hace nada más (no hay aviso: el tope es
  una meta).
- **El tope efectivo** es `min(2 GB, la mitad de la cuota del navegador)` (pregunta 1): en Firefox sin
  almacenamiento persistente la cuota puede ser chica.

### 5.3 La comprobación antes de liberar un original propio

Igual que en el diseño anterior, con sus correcciones. Si cualquier paso falla o no contesta, **no se libera** y se
vuelve a probar en otra apertura:

1. **En el dispositivo, adentro de la misma transacción que borra** (`files`, `blobs`, `meta`): el registro sigue
   con `pending: 0` y `driveId`, sin `blocked`, sin `uploadId`, sin `heic`, y ninguna marca lo pide. Se repite ahí
   porque entre la comprobación y el borrado pudo pasar algo (una restauración de la base lo vuelve a la cola).
2. **La base** (`fetchMediaFiles`, de a muchos): `drive_id` igual al `driveId` del registro, sin `purged_at`,
   `drive_trashed_at` ni `trashed_at`.
3. **El portero:** `POST /verify` (sección 10): pregunta a Drive, sin caché, el peso, si está en la papelera de
   Drive y si lleva la marca `appProperties.sdFile` de ese archivo. Se libera solo con el mismo peso,
   `trashed: false` y la marca.

Liberar = borrar `blobs[<id>]` y poner `freedAt` en el registro, en esa transacción. Nada más.

### 5.4 Qué pasa después de liberar

| | Después de liberar |
|---|---|
| La página | Igual: miniatura (o tarjeta del adjunto) desde `thumbs` y el registro. |
| Carrete, abrir, bajar | Con red, por el portero (el camino de cualquier archivo de otro dispositivo). Sin red: la miniatura con el aviso "This file isn't on this device: connect to open it" (con "the copy on this device was freed" si fue liberado). |
| Imprimir | Una foto liberada sale con su nítida si está y si no con la miniatura. |
| *Share* en el teléfono | Solo con una copia en el dispositivo (propia o bajada); si no, el botón no aparece. |
| Registro, usos, papelera | Igual. |

**Volver a tenerlo** es marcar la página "Available offline": baja la copia (`off:`) como cualquier archivo. El
"Guardar en este dispositivo" por archivo del diseño anterior no hace falta (pregunta 4).

### 5.5 "Que hace más que no se abren": `usedAt`

- Se anota en `copy:<id>` cuando **se abre una página que lo usa**, o se abre el archivo (carrete, adjunto, bajar,
  compartir, imprimir). Como mucho una vez por día por archivo, en una sola escritura por página.
- Sin entrada (todo lo guardado antes de esta versión), vale lo de la sección 5.6.

### 5.6 Al estrenar la versión

La primera vez, `space:rollout` guarda la fecha y todo lo que no tiene `usedAt` toma "ahora" (para que el orden
salga de lo que se use de ahí en adelante, y a igualdad, del más viejo al más nuevo por `createdAt`). Un dispositivo
con 10 GB de originales ya subidos (un iPhone con videos) liberaría 8 GB en la primera apertura con red. **Propuesta**
(pregunta 2): los originales propios se empiezan a liberar recién **7 días después** del estreno, con un aviso
mientras tanto en el diálogo de espacio y una vez al abrir: "Shot Docs now keeps up to 2 GB of files on this device.
Mark what you need offline before *8 Oct*". Las copias bajadas y las nítidas, desde el primer día.

### 5.7 Cuando algo no entra

`checkRoom` (hoy: si no entra, borra todas las nítidas y si igual no entra, rechaza) suma un paso: libera copias
no marcadas con las reglas de la sección 5.2, **sin mirar el tope** (hasta que entre, del menos usado al más), y
vuelve a probar. Si igual no entra, el aviso de hoy dice además cuánto ocupa lo marcado ("Offline pages use 6.3 GB:
remove some in *Storage on this device*").

### 5.8 Varios workspaces y cuentas en el mismo dispositivo

- La cuota del navegador es una sola para todo el origen, y el tope es "por dispositivo". Cada workspace guarda en
  `localStorage` (`sd:space:<base>`) la suma de sus copias no marcadas cada vez que cambia, y el total del
  dispositivo es la suma de todas (las de un workspace que se sacó del dispositivo se borran con él).
- **Cada workspace libera solo lo suyo** (comprobar que algo está en Drive pide su sesión y su portero): el abierto
  libera de lo suyo hasta que el total del dispositivo baje o no le quede nada; lo de otros espera a que se abran.
  El diálogo lo dice ("Other workspaces on this device: 1.4 GB · open them to free their copies").

## 6. A mano: *Storage on this device*

En el menú de la cuenta, en todos los dispositivos:

```
Storage on this device

Shot Docs uses 3.1 GB · 41 GB free on this device          (estimate(); sin el dato, no va)
Protected from being erased by the browser                 (o el aviso de la sección 9)

Kept automatically          1.6 GB of 2 GB  ▓▓▓▓▓▓▓░░
  Copies of files already in Drive. Past 2 GB, the ones opened least recently are removed;
  the thumbnails stay.
  Waiting to upload: 1.1 GB (5 files) · can't be removed yet
                                                     [Free up space]

Available offline           1.2 GB
  Escena 12 · 14 pages      Ready · updated 5 min ago     [⋯]
  Proyecto ERSO             Downloading 340 of 620        [⋯]
                            (⋯: Update now, Edit…, Remove)

Other app data              0.4 GB   (texto, comentarios, miniaturas, otros workspaces)
```

- ***Free up space*** libera **todo** lo liberable que no está marcado (sección 5.2, sin el margen del tope),
  después de confirmar con el total: "Free up 1.6 GB? Files stay in Drive. Without a connection, this device will
  only show their thumbnails". Lo que no pasa la comprobación se dice con el motivo ("not in Drive yet", "no
  connection", "the media server needs an update"). A mano también se puede liberar lo que está en la papelera de
  la app o la de Drive, con una segunda línea de aviso ("4 files are in the trash: this device may have the last
  copy outside it") y destildado por defecto.
- Los números salen de las sumas propias; el de arriba, de `estimate()`.
- "Other app data" es la diferencia entre `estimate()` y lo contado: incluye el texto y los comentarios de este
  workspace, las miniaturas, la caché del service worker y los otros workspaces (auditoría anterior, corrección 10).

## 7. Cambios en la cola y en los caminos de abrir y bajar

- **`MediaRecord`** suma `freedAt` (opcional). Una versión vieja lo conserva (todo se escribe con
  `{ ...registro, ...cambios }`). Del diseño anterior, `keep` ya no hace falta (lo reemplazan las marcas) y
  `lastUsedAt` pasa a `copy:<id>.usedAt` (vale también para los archivos de otros dispositivos, que no tienen
  `MediaRecord`, y `known` se reescribe entero con cada `fetchMeta`).
- **`source()`, `localOriginal()` y `localImage()`**: primero el original propio, después la copia bajada completa
  (sección 2.4). Con eso el carrete, los adjuntos (`attachmentOpen.ts`), *Share* (`AttachmentSheet`) y la
  impresión (`printPage.ts`) andan sin red con lo bajado, sin cambiar sus caminos. `source()` suma `freed: true`
  para el texto del aviso sin red.
- **`makeViewFor()`** (las nítidas): primero `offview:`, después `view:`, después el original propio o la copia
  bajada, después el portero. `clearViews()` y el tope de `viewIndex` no tocan `offview:`.
- **`remember(id, …, local)`** mira si hay original propio o copia bajada (hoy pone `local: true` para todo lo
  propio).
- **`process()` sin original** (auditoría anterior, corrección 7): hoy, si falta `blobs[id]`, detiene el archivo con
  `originalMissing` antes de mirar `driveId`. Con `freedAt`, y si una restauración de la base lo volvió a la cola
  (`pending: 1`, sin `driveId`), en vez de eso se le pregunta al portero **sin mandar bytes**: un `relink`
  (`POST /upload` con id, peso, nombre, tipo y día, y `only: 'known'`). Si el portero recuerda la subida
  (`rec.drive`), responde `done` y le avisa a la base. Si no, no abre nada y responde `unknown`: el archivo se
  detiene con "The copy on this device was freed and the media server doesn't remember this file. It's in the
  owner's Drive: ask them". Si hay una copia bajada completa del mismo archivo, se sube esa (es el mismo archivo).
- **`resetForRestore` y `clearBlocked`** conservan `freedAt`.
- **El borrado de copias bajadas** es una función aparte (`dropCopy`) que solo arma claves `off:` y `offview:`;
  `freeOwn` es la única que borra `blobs[<id>]`. Las pruebas lo fijan (sección "Pruebas").

## 8. Lo que se toca en la interfaz

- Menú "⋯" de la página y del proyecto: *Available offline…* (sección 3.8).
- La ventana de la sección 3.4 (parte cargada aparte, `lazyDialogs.ts`, como los demás diálogos).
- El diálogo *Storage on this device* (sección 6), en el menú de la cuenta.
- El ícono en el árbol y en el selector de proyectos, con `data-tip` (nada de `title=`; regla de no repetir lo
  obvio).
- El estado de la sincronización: la línea de descarga.
- Avisos sin red del carrete y de los adjuntos (sección 5.4).
- Textos en `src/i18n/` (inglés y castellano), sin atajos nuevos.
- **Ayuda:** una entrada "Available offline" y una "Storage on this device" en la ayuda de P.13 (si P.13 llega
  antes; si no, se suman con P.13: `Doc_Tutorial.md`).

## 9. Safari y el iPhone, Firefox y Chrome

Lo que dicen los navegadores (**a medir en el iPhone de Lega** durante la implementación: `estimate()` y
`persisted()` con la app instalada y en Safari suelto):

- **Safari (iOS y Mac, desde la versión 17):** cuota por origen de hasta ~60 % del disco; con `persist()`
  concedido, el origen no se desaloja por falta de lugar. **La regla de 7 días** (Safari borra lo de un sitio
  que no se abrió en 7 días de uso del navegador) no rige para la app **agregada a la pantalla de inicio**.
  Ojo: **la app instalada tiene su propio almacenamiento**, separado del de Safari: lo bajado en Safari no está en
  la app instalada. Por eso, en el iPhone fuera de la app instalada, la ventana recomienda instalarla antes de
  marcar.
- **Firefox:** sin `persist()`, cuota "de mejor esfuerzo" (del orden de 10 GB o el 10 % del disco); `persist()`
  muestra un permiso. La app ya lo pide al guardar el primer archivo (`askPersist`); al marcar, se vuelve a pedir.
- **Chrome y Edge:** hasta ~60 % del disco; `persist()` se concede solo según el uso (instalada, marcada).
- **Siempre:** al marcar se llama a `persist()`, y la ventana y el diálogo dicen si quedó persistente.
- **Videos grandes sin red en Safari:** reproducir un video de 1 GB desde un `blob:` armado con partes es lo menos
  probado; se mide en el iPhone antes de cerrar la entrega 1. Si no anda, la casilla *Videos* dice en el iPhone
  hasta qué peso se probó.

## 10. Portero (entrega 0) y límites de Cloudflare

**Hace falta antes de liberar originales propios** (no para bajar: `/m/` ya tiene CORS y `Range`):

- **`POST /verify`** con `{ files: [id…] }`, **hasta 20 por pedido** (el plan gratis de Workers deja 50
  subpedidos por pedido: uno a la base y uno a Drive por archivo). Nivel 1, como un pase: `media_file` de cada uno y
  a Drive `files.get` con `fields=size,trashed,appProperties`, **sin** lo anotado en `rec.verified`. Responde
  `{ results: { [id]: { size, trashed, marked } | { error } } }`.
- **`only: 'known'`** en `POST /upload`: si el portero no recuerda la subida, responde `{ status: 'unknown' }` sin
  crear la carpeta del día ni abrir una sesión de Drive.
- **`features: ['verify', 'known']`** en `/drive/status`. Con un portero sin actualizar, la app no libera originales
  propios (ni solos ni a mano: el diálogo lo dice) y sí todo lo demás.
- **Mejora aparte** (diseño anterior, entrega 1b): antes de abrir una subida, buscar en Drive un archivo con la
  marca `sdFile = <id>` y usarlo. Hace que una restauración ande aunque el portero perdió su registro. No es
  necesaria para esta tanda.

**Límites (plan gratis: 100.000 pedidos por día al Worker para toda la cuenta):** bajar una marca cuesta un pase y
uno o más pedidos a `/m/` por archivo (uno cada 16 MiB). ERSO entero (2459 archivos, 5,7 GB) serían unos 5500
pedidos: el 5,5 % de un día. Liberar, un `/verify` cada 20 archivos. Mantener al día, solo lo nuevo. Drive no
cobra por bajar; Cloudflare no cobra el tráfico de un Worker.

## 11. Versiones viejas

- Una versión vieja (pestaña sin recargar, iPhone sin actualizar) **ignora** `off:`, `offview:`, `copy:`,
  `offline:` y `freedAt`: sin red, muestra la miniatura donde la nueva mostraría la copia bajada. Su `clearViews` y
  su tope de nítidas no tocan `offview:` (no están en `viewIndex`).
- Un original propio liberado: la vieja muestra la miniatura y abre por el portero. Si una restauración lo vuelve a
  la cola, la vieja lo detiene con "falta el original" a la vista y bloquea *Remove from this device* (pide el
  original): se acepta, porque solo pasa con restauración más vuelta atrás de versión (auditoría anterior,
  corrección 8). La nueva lo resuelve con el `relink`.
- No cambia nada en el documento ni en la base: no hace falta subir `min_app_version`.

## Riesgos

- **Liberar un original que no estaba bien en Drive.** Lo evitan los tres pasos de la sección 5.3 y la separación de
  claves. Queda que el dueño borre a mano el archivo en su Drive después (se perdería para todos, no solo acá).
- **El tope automático y un rodaje sin red:** alguien cuenta con ver un video sin red y se liberó. Por eso las marcas,
  los 7 días de gracia (pregunta 2) y el aviso claro.
- **Descargas grandes en el teléfono:** sin la app abierta no bajan; con datos móviles gastan. La ventana lo dice
  ("downloads ≈3.4 GB") y la pantalla queda prendida mientras baja con la ventana abierta.
- **Safari:** la app instalada y Safari no comparten almacenamiento; videos grandes desde partes, a medir.
- **El estimado de la nítida** puede errarle un 30 %: el margen de 200 MB y el freno por archivo (sección 3.5)
  lo cubren.
- **Restauración de la base con originales liberados:** depende de que el portero recuerde la subida (o de la mejora
  de la marca).
- **Cuota de Cloudflare compartida** con el resto de la cuenta: una marca de un proyecto enorme en varios
  dispositivos el mismo día podría acercarse al tope diario; se mide con ERSO.

## Entregas y pruebas

1. **Entrega 0, portero:** `POST /verify` en lote, `only: 'known'`, `features`, con pruebas en
   `portero/src/core.test.ts` (archivo en la papelera de Drive, sin la marca, otro peso, sin caché, lote de 20,
   uno sin permiso en el lote, `only: 'known'` sin abrir nada). Se publica con el push a `main`, antes que la app
   que libera originales propios.
2. **Entrega 1, Available offline:** marcas, la ventana con los pesos, la descarga por partes, mantener al día,
   desmarcar, el ícono, los caminos de lectura de la sección 7, el diálogo de espacio **sin** liberar originales
   propios, y el tope solo para copias bajadas y nítidas. No depende del portero nuevo. Riesgo medio: lo único que
   borra son claves con prefijo.
3. **Entrega 2, liberar originales propios:** `freeOwn` con los tres pasos, el tope y *Free up space* para los
   propios, el `relink`, `usedAt` con los 7 días de gracia, `checkRoom` que libera, `localStorage` de varios
   workspaces. Riesgo alto: auditoría propia antes de publicar.
4. **Después:** *Drive folders* (con P.9), la búsqueda del portero por la marca, compartir un archivo grande sin
   copia (bajarlo al vuelo).

**Pruebas de unidad** (`queue.test.ts` y una nueva `offline.test.ts`, con el servidor y el portero en memoria de
`src/sync/testing.ts`):

- **Separación de claves:** `dropCopy` nunca borra una clave sin prefijo (también con ids raros, mayúsculas,
  `off:` adentro del id); con un original propio sin subir y una copia bajada del mismo id, liberar la copia deja el
  original.
- **`freeOwn` no libera:** con `pending: 1`, `blocked`, `uploadId`, `heic`, sin `driveId`, pedido por una marca, con
  la base diciendo otro `drive_id`, `purged_at`, `drive_trashed_at` o `trashed_at`, con `/verify` diciendo otro
  peso, `trashed`, sin marca, error o sin respuesta, con un portero sin `verify`, sin red; una restauración entre la
  comprobación y el borrado no borra.
- **El tope:** del menos usado al más, hasta 1,8 GB, con las sumas propias; lo marcado no cuenta ni se libera; lo
  que espera subir cuenta y no se libera; la gracia de 7 días; `min(2 GB, cuota / 2)`; varios workspaces.
- **Marcas:** la rama sigue al árbol (crear, mover adentro y afuera, papelera, restaurar, permisos); dos marcas
  cruzadas; los pesos de todas las filas (también destildadas), la nítida estimada, lo que ya está; no arranca si no
  entra; la descarga por partes se retoma después de cerrar; un peso distinto se descarta; 403 y 404 se saltean;
  "listo" con lo no disponible; mantener al día solo relee las páginas que cambiaron; desmarcar borra solo lo suyo y
  nunca un original propio; proyecto borrado y restaurado.
- **Lectura:** `source()`, `localOriginal()`, `localImage()` y `makeViewFor()` con copia bajada y con `offview:`;
  sin red, el carrete y un adjunto abren desde la copia.
- **`relink`:** `resetForRestore` con un original liberado termina en `done` sin mandar bytes (portero que recuerda)
  o detenido con el aviso (portero que no, sin abrir nada).
- **Versión vieja:** con el esquema de la base de `main`, abrir una base con `off:`, `offview:` y `copy:` no rompe ni
  borra nada, y su `clearViews` no toca `offview:`.

**jsdom:** la ventana (filas, indicadores circulares, total, sin lugar, sin red, progreso, listo), el diálogo de
espacio (números, *Free up space* con confirmación, desmarcar).

**En Chromium (servidor de mentira):** marcar una página con fotos, adjuntos y un video, ver el progreso, cortar la
red y abrir el carrete, un adjunto y la página con las fotos en grande.

**A mano, Lega:** en el iPhone con la app instalada, marcar un proyecto, poner el modo avión y recorrerlo (fotos en
grande, PDF, un video de 1 GB); en Chrome de computadora y en Safari de Mac lo mismo; y ver el tope liberar algo
después de los 7 días.

## Preguntas para Lega

1. **Tope en dispositivos chicos:** ¿`min(2 GB, la mitad de lo que el navegador le da a la app)`? En Firefox sin
   permiso persistente, o en un teléfono casi lleno, 2 GB puede ser más de lo que hay.
2. **Gracia al estrenar:** ¿los originales propios se empiezan a liberar 7 días después de la actualización, con un
   aviso para que marques lo que necesitás sin red? Sin la gracia, un iPhone con 10 GB de videos subidos libera 8 GB
   la primera vez que abre la app con red.
3. **Fotos propias con solo *Large photos*:** propuesta, se guarda la de 2048 y el original sigue con el tope (así una
   marca de 400 fotos de teléfono ocupa ~140 MB y no ~1,5 GB). La otra opción es proteger el original.
4. **"Keep on this device" por archivo** (del diseño anterior): propuesta, no hacerlo; alcanza con marcar la página.
5. **Mostrar lo que se baja por la red** además de lo que ocupa ("Uses ≈1.2 GB · downloads ≈3.4 GB"), por los datos
   del teléfono: propuesta, sí.
6. **Comentarios sin red:** propuesta, se bajan siempre los de la rama marcada (sin casilla) y se actualizan cada una
   hora.
7. **Desmarcar:** propuesta, borra las copias bajadas en el acto, con una casilla tildada para dejarlas (y que las
   libere el tope).
8. **El tope cuenta todos los workspaces del dispositivo** y cada uno libera lo suyo cuando se abre: ¿o preferís 2 GB
   por workspace?
9. **Permiso quitado o proyecto borrado:** propuesta, las copias bajadas de esos archivos se borran del dispositivo (la
   persona ya no puede verlos); al restaurar el proyecto, la marca vuelve a bajar.
