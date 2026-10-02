# Espacio en el dispositivo y "Available offline" (P.10)

Estado: **entregas 0 (portero) y 1 (Available offline, el tope con aviso y el espacio en el dispositivo)
implementadas en la rama `lega/espacio-offline`, sin publicar** (ver "Cómo quedó (entregas 0 y 1)", al final). La
entrega 2 (liberar originales propios) sigue en diseño. Lo que sigue es el diseño: auditado ("aprobado con cambios", 3 bloqueantes y 21 observaciones) y
corregido**: lo que cambió por la auditoría está en el cuerpo y se lista en "Correcciones de la auditoría", al
final; la re-verificación dejó dos bloqueantes nuevos, N1 y N2, también corregidos. Después llegaron las respuestas
de Lega a las propuestas (tope elegible, avisar antes de liberar, permiso quitado): están en "Qué se pide" y en el
cuerpo. Falta una: el tope del total marcado en el iPhone (sección 9.1). **Diseño aprobado** en la tercera
verificación (2026-10-01). Esta versión sale de las decisiones de Lega del 2026-10-01 (**D-25**, `Doc_Decisiones.md`) y reemplaza al
diseño anterior ("liberar a mano por defecto", commits `47bbbf4` y `cd6cb98`). De aquel diseño y de su auditoría
sigue valiendo, y quedó adentro de este, todo lo que asegura que nunca se borra un original sin confirmar: la
comprobación en tres pasos con `POST /verify`, el `relink` sin bytes después de una restauración, la fecha de uso con
"ahora" para lo anterior y medir con las sumas propias y no con `estimate()`. Sale de leer `main` en `e9eb660`
(v0.077): `src/media/queue.ts`, `src/media/mediaDb.ts`, `src/ui/sharpImages.ts`, `src/ui/carreteLoader.ts`,
`src/ui/attachmentOpen.ts`, `src/ui/printPage.ts`, `src/sync/engine.ts`, `src/sync/files.ts`,
`src/sync/comments.ts`, `portero/src/core.ts`, `Doc_Sincronizacion.md`, `Doc_Imagenes.md`, `Doc_Portero.md`,
`Doc_Proyectos_Borrar.md` y `Doc_Carpetas.md`.

## Qué se pide (D-25)

1. **Tope automático:** la app usa hasta **2 GB por dispositivo** (después, por la respuesta 8: **por workspace**, y
   elegible). Al pasarlo, borra las copias **ya confirmadas en el Drive** que hace más tiempo no se abren (después,
   por la respuesta 2: **avisando antes**). La miniatura queda siempre. **Nunca** se borra algo que no está
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

**Respuestas de Lega a las propuestas (2026-10-01), que mandan sobre lo anterior:**

- **El tope lo pone la persona.** La ventana de "Available offline" y "Storage on this device" muestran el tope y
  cuánto se está ocupando, para decidir antes de activar; el tope se puede cambiar. De fábrica, **2 GB por
  workspace**.
- **Esperar y avisar antes de liberar.** Nada se libera solo sin un aviso previo ("this is taking X, free up
  space?"). Lo marcado offline no se libera nunca solo; lo no marcado sí, con ese aviso. O sea: el tope **detecta y
  pregunta**; recién con el sí de la persona se libera (sección 5.2).
- **Lo marcado se mantiene en la versión tildada** (de fábrica, las fotos en 2048): la marca protege solo lo
  tildado (opción A de la sección 3.2). Los originales propios ya confirmados en el Drive son liberables, **siempre con
  aviso previo**. Lo no subido nunca se toca, con o sin red.
- **Sin internet, la app dice claramente "Offline"** junto con lo pendiente ("Offline · 700 to upload"), también en
  el teléfono (sección 8.1).
- Sin "Keep on this device" por archivo: offline es por página, página con subpáginas, o proyecto.
- Mostrar cuánto se baja por la red: sí. Comentarios, desmarcar y 2 GB por workspace: de acuerdo.
- **Permiso quitado:** se borran las copias. Al restaurar un proyecto o devolver el permiso, **vuelve como online**:
  no se vuelve a bajar solo; se vuelve a marcar si se quiere (sección 4).

## Reglas que no se rompen

- **Nada se libera sin que la persona diga que sí** a un aviso que dice cuánto y qué (sección 5.2). La única
  excepción es la que ya existe: las nítidas de la página (`view:`) con su tope propio de 150 MB, que no son copias
  de un archivo sino imágenes hechas en el dispositivo y se rehacen solas.
- **Un original propio** (el que se agregó en este dispositivo, `blobs[<id>]`) se borra solo si pasa la
  comprobación de tres pasos de la sección 5.3, repetida adentro de la transacción que lo borra, y si se subió hace
  14 días o más (`uploadedAt`). **Sin red, nunca.**
- **Dos espacios de claves que no se tocan:** lo que se baja para "Available offline" vive en claves con prefijo
  (`off:`, `offview:`, sección 2). El código que borra copias bajadas solo puede borrar claves con esos prefijos;
  la **única** función que borra `blobs[<id>]` sin prefijo es la que libera un original propio (`freeOwn`). Un
  error al armar una clave nunca puede llevarse un original sin subir.
- **Lo que pide una marca no se libera solo**, ni por el tope ni por falta de lugar. "Lo que pide" es el
  **conjunto guardado** de la marca (sección 3.1), no lo que dé la última lectura del contenido, y se comprueba
  adentro de la transacción que borra (`marksRev`, sección 2).
- **Una copia que puede ser la única no se borra sola:** un archivo que Google Drive ya no tiene (el portero responde
  el código `drive_missing` y `/verify` lo confirma) queda marcado `gone` y su copia bajada no la borra nada
  automático; a mano, con el aviso "This device has the only copy".
- **La app decide por el `code` del portero, nunca por el número HTTP** (sección 10): el mismo 404 hoy quiere decir
  "sin permiso" o "Drive no lo tiene", y el mismo 403 "pase vencido" o "Drive tiene otro archivo".
- **Nunca se borra:** el registro (`files`), la miniatura, lo que se sabe del archivo (`known`), los usos
  (`links`), el texto de las páginas ni los comentarios. La página se ve igual.
- **Lo nuevo tiene lugar:** las bajadas nunca usan la reserva para fotos y videos nuevos (sección 5.7). En el iPhone
  la cuota puede pasar lo libre del disco, así que además hay un tope fijo para el total de lo marcado hasta medirlo
  (sección 9.1).
- **Sin versión nueva de IndexedDB ni almacenes nuevos:** claves nuevas en los almacenes que ya existen y campos
  opcionales. Una versión vieja las ignora (sección 11).
- **Sin cambios en el documento ni en las tablas.** La base suma, como mucho, una función de solo lectura para los
  comentarios (sección 3.6). El portero sí cambia (entrega 0).
- **Solo lo que la persona puede ver:** todo lo que se baja pasa por la base (con Row Level Security) y por un pase
  del portero, que pide permiso con la sesión de la persona.

## Resumen

| | Cómo |
|---|---|
| Qué se marca | Una página con todas sus subpáginas, o un proyecto entero. Por dispositivo y por cuenta. |
| Qué se baja | Siempre: las miniaturas (también la vista previa de un PDF adjunto, `Doc_Adjuntos.md`), las imágenes viejas `sdfile://` y los comentarios. Según las casillas: la nítida de 2048 de cada foto, los originales de las fotos, los adjuntos de hasta 50 MB, los videos. El texto de todas las páginas ya está en el dispositivo. |
| Dónde | IndexedDB, en la base de archivos de siempre (`<base local>:media`), con claves `off:` y `offview:`. |
| Lo protegido | Un conjunto de archivos guardado en cada marca, que una página a medio bajar solo puede agrandar. |
| Pesos | `files.size` de la base para lo que se baja entero; la nítida, estimada por sus píxeles (sección 3.3). |
| Al día | En su propio ciclo, que nunca demora una subida: después de cada sincronización que cambió algo de la rama. |
| Tope | Lo elige la persona; de fábrica **2 GB por workspace** (por cuenta, en este dispositivo) de copias no marcadas. Pasado eso, un aviso ofrece liberar las confirmadas que hace más que no se abren; sin el sí, no se libera nada. |
| A mano | *Storage on this device*, en el menú de la cuenta. |
| Portero | Entrega 0: `POST /verify` en lote (peso, papelera, marca, `md5Checksum`, id de Drive), `only: 'known'`, saltear la caché de arranque para bajar y `features`. Entrega 2: buscar por la marca `sdFile`. |

## 1. Qué guarda hoy cada dispositivo

Cada cuenta de cada workspace tiene su base `<base local>:media` (`mediaDbName`):

| Almacén | Qué tiene hoy | Se borra hoy |
|---|---|---|
| `files` | Un `MediaRecord` por archivo **agregado en este dispositivo**. | Nunca. |
| `blobs` | El original entero de lo agregado acá. | Nunca. |
| `thumbs` | Las miniaturas (`<id>`) y las nítidas de la página (`view:<id>`, `view1024:<id>`, `Doc_Imagenes.md`). | Las nítidas, pasado 150 MB u 800 (`viewIndex` en `meta`), o todas si falta lugar al agregar un archivo de más de 50 MB. |
| `known` | Lo que la base sabe de archivos de otros dispositivos. | Al restaurar una copia de la base. |
| `links`, `meta` | Usos por página y ajustes de la cola. | — |

Además, en la base local de siempre: el árbol, **el contenido de todas las páginas** (la sincronización baja todas,
también las que nunca se abrieron: `Doc_Sincronizacion.md`, "Contenido de las páginas", punto 4) y las imágenes del
camino anterior `sdfile://` que ya se vieron (`src/sync/files.ts`, `load`; también las de un workspace sin portero).
En `<base local>:comments`, los comentarios **solo de las páginas que se abrieron** (un pedido por página,
`comments.ts`). De los archivos de otros dispositivos se guardan la miniatura (al mostrarlos) y la nítida (si se
vio grande), nunca el original.

O sea: el texto ya anda sin red en todos lados. Lo que falta para "Available offline" son las fotos en grande, los
originales, los adjuntos, los videos, las imágenes `sdfile://` que nunca se vieron y los comentarios de las páginas
que no se abrieron.

## 2. Qué se guarda nuevo y dónde

| Almacén | Clave | Qué |
|---|---|---|
| `blobs` | `off:<id>#<n>` | Una **copia bajada** del Drive (el archivo entero), en partes de largo variable (sección 3.5). |
| `thumbs` | `offview:<id>` | La nítida de 2048 de una foto, hecha para una marca. **No** entra en `viewIndex`: el tope de 150 MB de las nítidas no la toca. |
| `meta` | `copy:<id>` | Una entrada por archivo con alguna copia en el dispositivo (sección 2.1). |
| `meta` | `offline:<marca>` | Una marca, con su conjunto de archivos protegidos (sección 3.1). |
| `meta` | `marksRev` | Un número que sube con cada cambio de una marca o de su conjunto. |
| `meta` | `space:rollout` | Cuándo estrenó este dispositivo el tope (sección 5.6). |
| `files` | `freedAt`, `uploadedAt`, `md5` (opcionales) | En el `MediaRecord`: cuándo se liberó el original propio, cuándo se confirmó la subida (sección 5.2) y su MD5 (sección 5.3). |

Las claves nuevas de `blobs` y `thumbs` (`off:`, `offview:`) empiezan con una letra mayor que `f`: ningún rango de
claves que recorra uuids (que empiezan con `0-9a-f`) las alcanza. Las de `meta` (`copy:`, `offline:`…) no conviven con
uuids. Ninguna versión publicada recorre estos almacenes (solo lee y escribe por clave).

### 2.1 La entrada `copy:<id>`

```
{ id, usedAt,                       // la última vez que se abrió (sección 5.5)
  orig?: { mime, total, parts: [{ n, start, bytes }], savedAt, complete },   // copia bajada (off:)
  view?: { bytes },                 // nítida de una marca (offview:)
  gone?: number }                   // cuándo se confirmó `drive_missing`: puede ser la única copia
```

Una entrada por clave (y no un índice único, como `viewIndex`) para poder escribir o borrar la copia y su entrada
**en la misma transacción** (`blobs`, `thumbs` y `meta`). Cada parte se guarda en la misma transacción que la
actualización de `parts`: una parte sin su entrada no puede quedar. Se leen todas con un rango de claves (`copy:` a
`copy:￿`).

**Partes huérfanas:** al abrir, y antes de cada repaso del tope, se recorren las claves `off:` y se borran las que no
figuran en su `copy:<id>` (una pestaña a la que otra le tomó el control puede terminar de escribir una parte en vuelo:
`services.ts`). Así no ocupan lugar que las sumas propias no ven.

**Un escritor:** una sola pestaña usa la base a la vez (Web Locks). Sin `navigator.locks` (Safari anterior a 15.4)
no hay lock: la comprobación adentro de la transacción mantiene a salvo los originales, pero dos pestañas bajarían lo
mismo dos veces. Requisito de "Available offline": `navigator.locks`; sin él, la opción no aparece.

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

`new Blob([partes en orden…], { type: mime })`, sin copiar los bytes (el navegador arma la vista sobre las partes
guardadas). Solo cuenta si `complete`: las partes van seguidas desde 0 (`start` de cada una = `start + bytes` de la
anterior) y la última termina en `total`, que es `files.size`.

## 3. Available offline

### 3.1 Qué se marca y qué queda protegido

- **Una página con sus subpáginas**, o **un proyecto** (todas sus páginas raíz con todo lo de abajo). La rama se
  calcula del árbol local: una subpágina nueva, una que se movió adentro o una restaurada de la papelera entran
  solas; una que se movió afuera, se mandó a la papelera o dejó de verse, sale.
- **Es del dispositivo y de la cuenta** (va en `<base local>:media`), no del documento: otro dispositivo o
  otra persona no se enteran.
- La marca guarda `{ id, kind: 'page' | 'project', target, title, options, createdAt, state, error, pages, files }`:
  - `options = { sharp, originals, attachments, videos, folders }`;
  - `pages`: por cada página de la rama, el `seq` con el que se leyó su contenido **completo** (o nada, si todavía
    no se pudo);
  - `files`: **el conjunto de la rama**, por archivo las páginas de la rama que lo usan y su tipo
    (`{ [fileId]: { pages: pageId[], kind, size, own } }`). Tiene **todos** los archivos de la rama, sin filtrar por
    casillas.
- **Qué protege:** un archivo del conjunto está protegido si lo pide una casilla de la marca: la copia bajada o la
  nítida que corresponde a su tipo, y un original propio según la opción A o B de la sección 3.2. **El filtro se
  aplica adentro de la transacción que borra**, con las `options` de la marca, que están en la misma entrada de
  `meta`; cambiar una casilla sube `marksRev`. Así "kept only if checked" es cierto en los dos sentidos.
- **Cómo cambia el conjunto** (las mismas condiciones que ya usa la papelera de archivos, `engine.ts:546-553`): una
  página se lee "completa" solo si el dispositivo tiene todo su contenido (`cursor >= update_seq` en su
  `DocState`) y se pudo leer (`!unreadable`, `supported`). Una página **incompleta, sin `DocState` o ilegible solo
  suma** al conjunto lo que se ve; **quitar** un archivo de una página se hace recién con esa página completa.
  Una página que salió de la rama se quita del conjunto entera (salvo lo que siga usando otra página de la rama).
  Cada cambio del conjunto sube `marksRev` en la misma transacción. Una página ilegible o que pide una versión más
  nueva de la app (`unreadable`, `!supported`) nunca queda completa: la marca lo dice ("1 page needs an app
  update"), no "Waiting for 1 page to download".
- Dos marcas pueden cruzarse (un proyecto y una página suya): lo protegido es la **unión** de sus conjuntos.
  Marcar una página que ya está adentro de una rama marcada lo dice ("Already offline with *Proyecto*") y deja
  sumar casillas.

### 3.2 Qué baja cada casilla

| Casilla (UI en inglés) | Por defecto | Qué se guarda | Peso que se muestra |
|---|---|---|---|
| *Large photos* (2048 px) | Tildada | La nítida de 2048 (`offview:`) de cada foto de más de 576 px de lado. Para hacerla se baja el original y se reduce acá (como hoy la página); el original no se guarda. | Estimado (sección 3.3) |
| *Original photos* | Destildada | El original entero de cada foto (`off:`). Con esta tildada no hace falta la nítida: se hace del original cuando se ve. | `files.size` |
| *Attachments up to 50 MB* | Tildada | El original de cada adjunto (PDF, documentos, todo lo que no es foto ni video) de hasta 50 MB. Los más grandes se nombran en la fila ("3 over 50 MB are not included"). | `files.size` |
| *Videos* | Destildada | El original entero de cada video. | `files.size` |
| *Drive folders* | Destildada | Lo de adentro de las carpetas de P.9. **Recién cuando P.9 esté publicado**; hasta entonces la fila no aparece. | Del listado del portero (P.9) |

Siempre, sin casilla: **las miniaturas** que falten de todos los archivos de la rama, **las imágenes viejas
`sdfile://`** de sus páginas (con `files.ts`, `load`, como al verlas; quedan en la base local de siempre y, como hoy,
no cuentan para el tope ni se liberan) y **los comentarios** de todas sus páginas. Una línea del total los suma
("Thumbnails, older images and comments · 12 MB"; las `sdfile://` se estiman en 1 MB cada una, con "≈").

**Los originales propios** (agregados en este dispositivo y todavía en `blobs`) ya cubren su fila sin bajar nada.
**Decidido por Lega (2026-10-01): opción A.** "Lo marcado offline se mantiene siempre en la versión tildada"; los
originales propios ya confirmados en el Drive son liberables, siempre con aviso previo; lo no subido nunca se toca.
La opción B queda escrita abajo como descartada (en el código es una sola regla, la del filtro de la sección 3.1).

- **Opción A (decidida): solo lo tildado.** Una foto propia queda protegida con *Original photos*, un video propio
  con *Videos*, un adjunto propio con *Attachments up to 50 MB* si pesa 50 MB o menos (uno más grande no queda
  protegido por esa casilla, como no se bajaría el de otro). Con solo *Large photos*, se hace su nítida de 2048
  desde el original (sin red, sin bajar nada) y el original sigue con el tope como cualquier otro (y nunca se
  libera sin el aviso de la sección 5.2). **Cada fila lo dice** cuando hay originales propios que no quedan
  protegidos: "380 originals already on this device (1.4 GB) · kept only if checked". Por qué: la marca hace lo
  que dicen sus casillas, en todos los dispositivos igual, y una marca de 400 fotos de teléfono ocupa ~140 MB y no
  ~1,5 GB que no entran en el tope.
- **Opción B (descartada): también los originales propios que ya están.** Todo original propio de la rama entra al conjunto
  protegido, tildado o no (un adjunto propio de más de 50 MB también). La fila lo dice al revés: "380 originals
  already on this device (1.4 GB) · kept too". Esos bytes pasan de "Kept automatically" a "Available offline"
  (no cuentan para el tope). Por qué no la propongo: el mismo proyecto marcado ocupa distinto según en qué
  dispositivo se filmó, y en el teléfono que filmó la marca protege justo lo más pesado.

No se baja: lo que la base no devuelve (sin permiso), lo que está en la papelera de Drive (se ve como borrado), lo
que todavía no llegó a Drive (otro dispositivo lo está subiendo: se espera y se baja cuando llegue), los links de
Drive pegados como tarjeta (`Doc_Sincronizacion.md`, "Links de Drive": son del Drive de otro) y lo de afuera de la
app (videos de YouTube, links).

### 3.3 Cómo se calculan los pesos

Se calcula **todo**, también lo destildado, y cada fila muestra lo que **falta bajar** (lo que va a ocupar
lugar) y, en gris, lo que ya está ("420 photos · 118 MB · 40 MB already on this device").

1. **Las páginas** de la rama, del árbol local (en el acto).
2. **Los archivos** de cada página: `mediaIdsInDoc` (`src/media/usage.ts`) sobre el contenido local, que mira
   el `url` de cualquier elemento (fotos-bloque, fotos en línea, adjuntos, videos); además las direcciones
   `sdfile://`. Se suman los usos que la base conoce (`page_files`) por si un dispositivo todavía no bajó un
   cambio. Las páginas incompletas (sección 3.1) se cuentan y la ventana lo dice ("12 pages still downloading:
   sizes may grow").
3. **Los datos** de cada archivo: `fetchMediaFiles` de a lotes (la base, con su Row Level Security): tipo, peso
   (`files.size`), medidas, `drive_id`, papelera. Sin red, lo guardado en `known` y en `files`; lo que no se sabe
   queda en "—".
4. **Lo que ya está** en el dispositivo: `blobs`, `copy:`, `offview:`, `view:` y miniaturas.

**La nítida, estimada** (la de verdad depende de la foto). De las mediciones de `Doc_Imagenes.md` (WebP 0,8: entre
0,7 y 0,9 bits por píxel; JPEG 0,8 de Safari: entre 1,0 y 1,55):

- Foto de hasta 576 px de lado (`THUMB_SIDE × VIEW_GAIN`): 0 (alcanza la miniatura).
- JPEG de hasta 900 KB que ya entra en 2048: `files.size` (se guarda tal cual, como hoy).
- Con medidas: píxeles de la reducida a 2048 × 0,9 bits (WebP) o × 1,5 bits (Safari) / 8, y nunca más que
  `files.size`. Una foto de teléfono de 4032 × 3024: unos 350 KB (590 KB en Safari).
- Sin medidas: 400 KB (600 KB en Safari).
- Una foto que el navegador no abre (TIFF, RAW, un HEIC que no se convirtió): 0, y la fila lo dice ("5 photos
  can't be made large here: only with *Original photos*").
- Se muestra con "≈". Al terminar, la marca guarda lo que de verdad ocupó.
- Miniatura que falta: 40 KB cada una.

**Lo que se baja por la red** no es lo mismo que lo que ocupa: para la nítida se baja el original entero. El
total lo dice aparte ("Uses ≈1.2 GB · downloads ≈3.4 GB"), por los datos del teléfono.

**Indicador circular:** cada fila lo muestra mientras le falta el paso 3 o el 4; el total, mientras falte alguna
fila tildada. Tildar o destildar cambia el total en el acto con lo que ya se sabe.

### 3.4 La ventana

```
Available offline · Escena 12 (and 14 pages inside)

[x] Large photos (2048 px)        420 photos   ≈118 MB   ◌
[ ] Original photos               420 photos    1.6 GB
                                  380 originals already on this device (1.4 GB) · kept only if checked
[x] Attachments up to 50 MB        12 files    86 MB     (3 over 50 MB are not included)
[ ] Videos                          6 videos    2.3 GB
    Thumbnails, older images and comments      12 MB

    Selected: ≈216 MB · downloads ≈1.7 GB
    Available to Shot Docs on this device: 41 GB
    Offline in this workspace: 1.2 GB → 1.4 GB
    Kept automatically: 1.6 GB of 2 GB                              [Change limit]

    [Cancel]                                [Make available offline]
```

- **El tope y lo ocupado, antes de activar** (respuesta de Lega): cuánto ocupa ya lo marcado offline en este
  workspace y cuánto va a ocupar con esta marca, y lo que se guarda automáticamente con su tope. *Change limit*
  abre el mismo selector que el diálogo de espacio (sección 6).

- **El lugar:** "Available to Shot Docs on this device" es `quota − usage` de `navigator.storage.estimate()` (lo que
  el navegador le deja a la app; en Safari puede pasar lo libre del disco: no se llama "free"). Para arrancar, lo
  elegido tiene que entrar en ese lugar **menos la reserva para lo nuevo** (sección 5.7) y, en el iPhone, en el tope
  del total marcado (sección 9.1). Si entra solo liberando copias no marcadas (sección 5.2; en la entrega 1 solo cuentan las
  copias bajadas y las nítidas, que se liberan sin red ni espera), la ventana lo dice y el botón lo nombra: "Free up 0.6 GB and make available
  offline" (con *Show what* para ver la lista); tocarlo es el sí del aviso. Si ni así entra, el botón queda apagado
  con el motivo ("Needs 3.4 GB; 2.1 GB available, keeping 1 GB for new photos and videos"). Si el navegador no da
  el dato, arranca y lo frena el primer archivo que no entre.
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

- **Su propio ciclo, que nunca demora una subida.** No va en la vuelta de la cola de fotos y videos (`MediaQueue.run`
  hace una vuelta a la vez, y una foto agregada mientras corre esperaría). Las bajadas corren aparte, en la pestaña
  que tiene la cola, **solo mientras no haya nada que se pueda subir ahora**: no cuentan lo detenido (`blocked`), lo
  que espera un reintento (`retryAt` en el futuro), lo que espera a la base ni los usos en espera (`waiting`); si no,
  un archivo detenido congelaría las bajadas sin explicación. Cuando la cola recibe algo nuevo (`onQueued`), se
  corta la parte en vuelo (`AbortController`) y se sigue después desde la última parte guardada. De a **dos
  archivos** a la vez en una computadora; en un teléfono, la reducción a 2048 de **uno a la vez** (memoria).
- **Orden:** miniaturas, imágenes `sdfile://` y comentarios primero (son lo que más se ve), después nítidas,
  adjuntos, originales y videos, y dentro de cada grupo del más liviano al más pesado.
- **Cada archivo:** un pase (`POST /pass`, el de `carreteLoader`, reusado mientras no venza) y la bajada de
  `/m/<pase>?offline=1` con `fetch` (`cache: 'no-store'`; CORS en `/m/` desde v0.058). `offline=1` le pide al
  portero que **no use la caché de arranque de los videos** (sección 10): hoy todo pedido con `Range` de un video
  pasa por ella y, si empieza en la punta guardada, responde un 206 **más corto que lo pedido** (`core.ts`,
  `fromCache`); además ocuparía el lugar de esa caché y le quitaría el arranque rápido a quien esté mirando un video.
- **Por partes, avanzando por lo que llega:** se pide `Range: bytes=<siguiente>-<siguiente + 16 MiB - 1>` y se
  guarda lo que diga el `Content-Range` de la respuesta (inicio, fin, total), nunca una posición fija: la parte
  siguiente empieza donde terminó la recibida. Un `Content-Range` que no empieza donde se pidió, o un total distinto
  de `files.size`, descarta la copia (se reintenta una vez; después queda con el error a la vista). Un 200 sin
  partes (un portero que no hizo caso) se guarda igual si su largo es `files.size` y es de 16 MiB o menos; si es más
  grande, **no se lee** (`res.blob()` de un video de 1 GB cierra la app en el iPhone): se corta y queda con el error. Cada parte se guarda apenas
  llega, con su entrada (sección 2.1): si la app se cierra, se sigue desde la última.
- **La nítida:** se baja el original (en memoria, sin guardarlo), se reduce con `viewImage` (`probe.ts`) a 2048 y
  se guarda en `offview:`. Si ya hay una `view:<id>` de 2048, **se mueve** a `offview:` (se borra `view:` y se saca
  de `viewIndex`), sin bajar nada.
- **Errores, por el `code` del portero** (sección 10), nunca por el número:
  - sin red o el portero sin contestar: se espera a la próxima vuelta (1, 4, 16 minutos… hasta una hora, como las
    nítidas);
  - `/m/` con el pase vencido o inválido: se pide otro pase una vez (como `porteroDownload`, `sharpImages.ts`) y
    recién si vuelve a fallar cuenta como error;
  - `not_found` (sin fila o sin permiso): no se baja y la marca lo cuenta ("2 files are not available"). No borra
    nada por sí solo (sección 4);
  - `drive_missing`: no se baja; si ya había una copia completa, se pide `/verify` y recién si Drive confirma que no
    está, se marca `gone` (sección 5.2);
  - `drive_mismatch` (Drive tiene ahí otro archivo): no se baja, **no se borra nada** y se muestra el error;
  - `abusive`: no se baja;
  - `drive_not_connected`: la marca queda en "Waiting for the owner's Drive";
  - un portero sin códigos (anterior a la entrega 0): todo error es "no disponible por ahora" y nunca borra ni marca
    `gone`.
  Ninguno corta a los demás.
- **Lugar:** antes de cada archivo, si con él se pasa lo disponible menos la reserva, la marca se detiene en "Not
  enough space: needs 300 MB more". **No libera nada sola:** si liberando copias no marcadas entraría, el aviso lo
  ofrece ("Free up 0.4 GB to keep *Escena 12* up to date?", sección 5.2) y sigue con el sí. Lo marcado no se libera
  nunca. (Lo único que se libera sin otra pregunta es lo que la persona ya aceptó al tocar "Free up … and make
  available offline" en la ventana.) Escribir una parte trata `QuotaExceededError` (y el `UnknownError` de Safari con
  el disco lleno) como falta de lugar, no como un error de red: **al primer error así, la marca se detiene y se borran
  las partes del archivo en curso** (con `dropCopy`), para que el disco no quede en cero; no se reintenta sola hasta
  que la persona toque *Try again* o cambie algo (desmarcar, liberar).
- **Con la app cerrada o en segundo plano no baja nada** (el navegador no lo deja sin una API que Safari no tiene):
  sigue al volver. En el teléfono, mientras la ventana de progreso está abierta, se pide que la pantalla no se
  apague (`navigator.wakeLock`, donde exista: en la app instalada del iPhone, desde iOS 18.4).
- **"Listo"** exige las dos cosas: **toda página de la rama completa y leída** (sección 3.1: `cursor >= update_seq`
  y legible) y todo lo del conjunto en el dispositivo, salvo lo que no está disponible (sin permiso, borrado,
  todavía subiendo desde otro dispositivo), que se dice en la misma línea. Si faltan páginas: "Waiting for 12 pages
  to download".

### 3.6 Mantenerlo al día

- **Cuándo:** al abrir la app, después de cada sincronización que bajó algo de una página de la rama o cambió el
  árbol, y cada 10 minutos con red. Nada de esto corre sin red.
- **Qué se vuelve a leer:** solo las páginas cuyo `seq` cambió desde lo anotado en `pages` (sección 3.1) y las que
  entraron a la rama; el resto ya está.
- **Lo nuevo se baja** con las mismas reglas de la sección 3.5. **Lo que ya no se usa** (leído con la página
  completa) sale del conjunto: pasa a contar para el tope (sección 5) y se libera cuando toque. No se borra en el
  acto: un deshacer lo devolvería.
- **Un archivo que pasó a la papelera de Drive** se muestra como borrado (como hoy): sale del conjunto y su nítida
  se borra. `forgetView` hoy borra solo `view:` y `view1024:`; suma `offview:`.
- **Comentarios:** hoy se baja de a una página (`list_comments(p_page_id, p_since)`, con un cursor por página,
  `since:<página>`); un proyecto de 640 páginas serían 640 pedidos por vuelta. Por eso:
  - (a) **una función nueva de solo lectura** en la base, `list_project_comments(p_project_id, p_since)`, con los
    mismos permisos que `comments_view`, que calcula **una vez** las páginas que la persona ve (no `page_level` por
    fila) y trae lo cambiado desde `p_since` en todas. Una vez por hora y al abrir.
  - **El cursor sigue siendo por página.** Una página que entra a la rama (nueva, movida adentro, restaurada, vuelta a
    compartir) se baja **sola, con su propio cursor** (entera si no tiene), porque sus comentarios pueden tener un
    `updated_at` anterior al de la función por proyecto y esta no los traería nunca. Recién después la sigue la
    función por proyecto, que se llama con el menor de los cursores de las páginas que ya están y adelanta el cursor
    de cada página con lo que trae.
  - **Versión de la base:** P.14 ya reservó la 10 (Drive) y la 11 (*Delete forever*) (`Doc_Proyectos_Borrar.md`).
    Esta va **después**: la 12, o la siguiente libre cuando se implemente, coordinada con esas dos tandas.
  - (b) con una base sin la función, de a una página **al marcar** y después **cada 6 horas**, de a 4 pedidos a la
    vez.
  - Lo bajado se guarda como hoy en `<base local>:comments`.
- El estado de cada marca se ve en el diálogo (sección 6) y en el ícono del árbol (sección 3.8).

### 3.7 Desmarcar

- *Remove* en la ventana de la página o en el diálogo de espacio. Pregunta con el peso: "Stop keeping *Escena
  12* offline? The downloaded copies (1.2 GB) will be removed from this device. Everything stays in Drive". Con
  una casilla, tildada: "Remove the copies now". Destildada, las copias quedan y pasan a contar para el tope.
- **Lo que sigue pedido por otra marca** se saca del conjunto guardado de las otras marcas (sección 3.1), nunca de
  una lectura del momento, y no se borra.
- **Lo `gone`** (`drive_missing` confirmado por `/verify`: puede ser la única copia) no se borra: queda en el
  dispositivo, fuera de toda marca, y el diálogo de espacio lo muestra aparte (sección 6).
- Una descarga en curso se corta y sus partes se borran.
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
- **Permiso quitado:** las copias bajadas se borran **solo con una señal explícita**: la página salió del árbol
  porque los permisos propios (`meta.access`) dejaron de darla, **y** el portero responde `not_found` al pedir el
  pase de ese archivo. Ninguna de las dos sola alcanza: un `not_found` también sale después de restaurar una copia de
  la base (sin fila), y que la base deje de devolver la fila tampoco alcanza. En esos casos la copia se deja como
  está y se vuelve a mirar en la vuelta siguiente. Nunca se ofrece *Save a copy* de algo que se borra por permiso.
  Las copias `gone` no se borran por esto (puede ser la única copia; quedan en "Only copy on this device"). Los originales propios no se tocan
  nunca por esto (son de esta persona y pueden estar sin subir).
- **Proyecto archivado** (D-23): archivar es solo orden; la marca sigue igual.
- **Proyecto borrado** (P.14, `deleted_at`): para todos es un permiso quitado (nivel 0), así que va igual: con la
  señal explícita (el proyecto vuelve de la base con `deleted_at`, o sale de la lista de proyectos visibles **y** el
  portero responde `not_found`), **se sacan sus marcas y se borran sus copias bajadas**, salvo las `gone` (pueden ser
  la única copia: quedan en "Only copy on this device"). Los originales propios no se tocan.
- **Al restaurar el proyecto o devolver el permiso** (respuesta de Lega): **vuelve como online**. No se vuelve a
  bajar nada solo; si se quiere sin red, se vuelve a marcar. Por eso las marcas se borran (no quedan en pausa).
- **Sacado del workspace:** el ciclo se detiene y `RemovedScreen` hace lo de siempre; *Remove from this device*
  borra la base entera, con las copias.

## 5. El tope (2 GB de fábrica)

### 5.1 Qué cuenta

**El tope lo elige la persona; de fábrica, 2 GB por workspace** (por cuenta, en este dispositivo), y cada
`<base local>:media` cuenta y libera lo suyo. Es más simple y predecible que una suma de todo el dispositivo, que
dependería de workspaces que no se abren hace meses. Se guarda en `meta` (`space:limit`, del dispositivo y la
cuenta: no viaja a otros dispositivos). Se cambia en *Storage on this device* y desde la ventana de "Available
offline" (*Change limit*): 1, 2, 5, 10 o 20 GB, o *No limit* (nunca avisa). Si lo elegido pasa la mitad de lo que el
navegador le da a la app, se avisa al lado ("More than half of what this browser gives Shot Docs") pero se respeta.
De fábrica es `min(2 GB, la mitad de la cuota)`, por Firefox sin almacenamiento persistente.
Cuentan las **copias enteras** que no están en el conjunto de ninguna marca:

- los originales propios en `blobs[<id>]` (subidos o no),
- las copias bajadas (`off:`) fuera de todo conjunto,
- las nítidas de la página (`view:`, con su propio tope de 150 MB, que sigue).

No cuentan: lo que está en algún conjunto (el guardado, sección 3.1, no lo que dé la última lectura), las
miniaturas, el texto, los comentarios, las imágenes `sdfile://` y el código de la app (son chicos o no se liberan).
Se mide con **las sumas propias** (`size` de los registros, `bytes` de `copy:` y de `viewIndex`), no con
`estimate()`, que en Safari y Firefox tarda en bajar después de borrar.

**Lo que espera subir cuenta pero no se puede liberar.** Si solo eso pasa los 2 GB, no se libera nada y la app no
deja de aceptar archivos: el tope es una meta, no un límite para agregar. Lo único que rechaza un archivo es que no
entre en la cuota del navegador (sección 5.7).

### 5.2 Cuándo corre y qué libera

- **Cuándo:** una vez por apertura (después de la primera sincronización, con red), después de que la cola confirma
  subidas, después de cada tanda de descargas de una marca y cuando algo no entra (sección 5.7). Solo en la pestaña
  de la cola.
- **Qué:** si el total pasa el tope, los candidatos se ordenan **del que hace más que no se abre** (`usedAt`) al más
  reciente, y se arma la lista de lo que haría falta liberar para bajar al 90 % del tope (1,8 GB: el margen evita
  preguntar de a poco cada vez que se agrega algo).
- **Esperar y avisar** (respuesta de Lega): **no se libera nada sin un sí.** Se muestra un aviso (en la barra
  lateral, junto al estado de la sincronización, sin tapar nada): "Shot Docs is keeping 2.4 GB of files on this
  device (limit 2 GB). Free up 0.6 GB? Files stay in Drive; without a connection you'll see their thumbnails",
  con *Free up*, *Show what* (la lista, con el nombre, el peso y "opened 3 weeks ago"), *Change limit* y *Not now*.
  *Not now* lo calla por un día. *Free up* corre la comprobación de cada candidato (la de abajo y la sección 5.3) y
  libera lo que la pase; lo que no, se dice con el motivo. Mientras no se conteste, todo queda como está.
- **Candidatos, por tipo:**
  - nítida de la página (`view:`): siempre (se rehace sola);
  - copia bajada (`off:`): si no es `gone` y la base dice que el archivo sigue en Drive (`drive_id`, sin
    `purged_at` ni `drive_trashed_at`; un pedido de `fetchMediaFiles` para muchos);
  - original propio: solo con los tres pasos de la sección 5.3 y **subido hace 14 días o más** (siempre, no solo al
    estrenar: cubre la semana del rodaje y un error del dueño en Drive en los primeros días). "Subido" es
    `uploadedAt`, que `markUploaded` pone al confirmar la subida; para lo subido antes de esta versión, la fecha de
    `space:rollout`. No `createdAt`: un teléfono que estuvo tres semanas sin señal sube todo al volver, y eso tiene
    que quedar 14 días.
- **Nunca solos:** lo que está en algún conjunto, lo que espera subir, lo que tiene `uploadId` o `heic` pendiente,
  lo detenido (`blocked`), lo que está en la papelera de la app o en la de Drive (puede ser la última copia fuera de
  una papelera), lo `gone`, **lo abierto en esta sesión** (un video que se está reproduciendo desde un `blob:`: en
  Safari, borrarlo puede dejarlo ilegible) y los originales propios con un portero sin `verify`.
- **La comprobación de las marcas, adentro de la transacción que borra:** la lista de candidatos se arma con el
  `marksRev` del momento; `freeOwn` y `dropCopy` lo vuelven a leer en su transacción (con `meta` adentro) y, si
  cambió, no borran en esa vuelta. Así "ninguna marca lo pide" se comprueba de verdad, aunque la rama salga del
  árbol y del contenido, que están en otra base.
- **Sin red no se libera ningún original propio** (el aviso los muestra como "need a connection"). Si no hay nada
  liberable, no hay aviso: el tope es una meta.

### 5.3 La comprobación antes de liberar un original propio

Si cualquier paso falla o no contesta, **no se libera** y se vuelve a probar en otra apertura:

1. **En el dispositivo, adentro de la misma transacción que borra** (`files`, `blobs`, `meta`): el registro sigue
   con `pending: 0` y `driveId`, sin `blocked`, sin `uploadId`, sin `heic`; `marksRev` es el mismo con el que se
   armó la lista y el archivo no está en ningún conjunto. Se repite ahí porque entre la comprobación y el borrado
   pudo pasar algo (una restauración de la base lo vuelve a la cola, alguien lo marcó).
2. **La base** (`fetchMediaFiles`, de a muchos): `drive_id` igual al `driveId` del registro, sin `purged_at`,
   `drive_trashed_at` ni `trashed_at`.
3. **El portero:** `POST /verify` (sección 10), que pregunta a Drive sin caché. Se libera solo si el id de Drive que
   miró es el `driveId` del registro, el peso es el mismo, `trashed: false`, lleva la marca `appProperties.sdFile`
   de ese archivo y su `md5Checksum` es igual al MD5 del original del dispositivo. El MD5 se calcula acá, por tramos
   de 8 MiB y una sola vez por archivo (se guarda en el registro: `md5`), justo antes de liberar: peso igual con
   bytes distintos es improbable con las subidas reanudables, pero es justo el caso que no se ve hasta que hace
   falta el archivo. **Sin `md5Checksum` en la respuesta** (Drive no lo da para algunos archivos), no se libera.

Liberar = borrar `blobs[<id>]` y poner `freedAt` en el registro, en esa transacción. Nada más.

### 5.4 Qué pasa después de liberar

| | Después de liberar |
|---|---|
| La página | Igual: miniatura (o tarjeta del adjunto) desde `thumbs` y el registro. |
| Carrete, abrir, bajar | Con red, por el portero (el camino de cualquier archivo de otro dispositivo). Sin red: la miniatura con el aviso "This file isn't on this device: connect to open it" (con "the copy on this device was freed" si fue liberado). |
| Imprimir | Una foto liberada sale con su nítida si está y si no con la miniatura. |
| *Share* en el teléfono | Solo con una copia en el dispositivo (propia o bajada); si no, el botón no aparece. **Es una pérdida de función** para las fotos y videos viejos del propio teléfono: compartir bajándolo al vuelo queda para la entrega 3. |
| Registro, usos, papelera | Igual. |

**Volver a tenerlo** es marcar la página "Available offline": baja la copia (`off:`) como cualquier archivo. No hay
"Keep on this device" por archivo: alcanza con marcar la página.

### 5.5 "Que hace más que no se abren": `usedAt`

- Se anota en `copy:<id>` cuando **se abre una página que lo usa**, o se abre el archivo (carrete, adjunto, bajar,
  compartir, imprimir). Como mucho una vez por día por archivo, en una sola escritura por página.
- Sin entrada (todo lo guardado antes de esta versión), vale lo de la sección 5.6.

### 5.6 Al estrenar la versión

La primera vez, `space:rollout` guarda la fecha y todo lo que no tiene `usedAt` toma "ahora" (el orden sale de lo
que se use de ahí en adelante, y a igualdad, del más viejo al más nuevo por `createdAt`). Como nada se libera sin el
sí de la persona, ya no hace falta la gracia de 7 días del diseño auditado: el primer aviso del tope (sección 5.2) es
el que lo presenta, con una línea más la primera vez: "New: Shot Docs keeps up to 2 GB of files on this device. Mark
pages *Available offline* to keep them. Original photos and videos are kept only if you check them when marking".
Los 14 días desde la subida siguen.

### 5.7 Reserva para lo nuevo, y cuando algo no entra

- **Reserva:** las bajadas nunca usan los últimos `max(1 GB, 5 % de la cuota)`: un teléfono con casi todo marcado
  tiene que poder seguir filmando. **En el iPhone esto no alcanza** (la cuota puede pasar lo libre del disco): ver el
  tope del total marcado y la medición de la sección 9.1.
- **`save()`** (agregar una foto o un video): hoy, ante `QuotaExceededError`, rechaza con `queue.noSpace`, y
  `checkRoom` solo mira archivos de más de 50 MB. Ahora, ante `QuotaExceededError` (o el `UnknownError` de Safari),
  libera y reintenta **una vez**; y `checkRoom` mira todos los tamaños.
- **Qué ofrece liberar para que entre** (sin mirar el tope, del menos usado al más, hasta que entre). Las nítidas de
  la página se borran sin preguntar, como hoy. Lo demás, **con el aviso**: el archivo no se rechaza en el acto sino
  que queda la pregunta "Not enough space for *IMG_0412.MOV* (1.2 GB). Free up 1.3 GB of copies already in Drive
  and add it?" con *Free up and add* y *Cancel*; con el sí, se libera y se vuelve a probar:
  - **con o sin red:** **las copias bajadas que no están en ningún conjunto ni son `gone`**: son copias de algo que
    estaba en Drive al bajarlo, y lo único irrecuperable en un rodaje es la foto nueva;
  - **solo con red, y nunca en el acto:** los originales propios. Su comprobación (MD5 de varios archivos y
    `/verify`) puede tardar minutos mientras la persona espera agregar una foto y `hasUnsavedWrites` frena el cierre.
    En `save()` se liberan en el acto solo las copias bajadas y las nítidas; los originales propios se ofrecen
    después, en segundo plano, con el aviso de siempre (sección 5.2).
- Si igual no entra, el aviso de hoy dice además cuánto ocupa lo marcado ("Offline pages use 6.3 GB: remove some
  in *Storage on this device*"). Nunca se libera lo marcado para que entre.

## 6. A mano: *Storage on this device*

En el menú de la cuenta, en todos los dispositivos:

```
Storage on this device

Shot Docs uses 3.1 GB · 41 GB available to it on this device     (estimate(); sin el dato, no va)
Protected from being erased by the browser                         (o el aviso de la sección 9)

Kept automatically          1.6 GB of 2 GB  ▓▓▓▓▓▓▓░░          Limit [2 GB ▾]
  Copies of files already in Drive. Past the limit, Shot Docs asks before removing the
  ones opened least recently; the thumbnails stay.
  Waiting to upload: 1.1 GB (5 files) · can't be removed yet
                                                     [Free up space]

Available offline           1.2 GB
  Escena 12 · 14 pages      Ready · updated 5 min ago     [⋯]
  Proyecto ERSO             Downloading 340 of 620        [⋯]
                            (⋯: Update now, Edit…, Remove)

Only copy on this device    120 MB (2 files)             [⋯]
  Google Drive no longer has these files.

Other app data              0.4 GB   (texto, comentarios, miniaturas, otros workspaces)
```

- ***Free up space*** libera **todo** lo liberable que no está en un conjunto (sección 5.2, sin el margen del tope),
  después de confirmar con el total: "Free up 1.6 GB? Files stay in Drive. Without a connection, this device will
  only show their thumbnails". Lo que no pasa la comprobación se dice con el motivo ("not in Drive yet", "no
  connection", "uploaded less than 14 days ago", "the media server needs an update"). A mano también se puede liberar
  lo que está en la papelera de la app o la de Drive, con una segunda línea de aviso ("4 files are in the trash:
  this device may have the last copy outside it"), destildado por defecto.
- **Only copy on this device:** las copias `gone` (solo `drive_missing` confirmado por `/verify`; nunca algo sin
  permiso). Su "⋯" ofrece bajarlas a la computadora (*Save a copy*) y, con confirmación aparte, *Remove from this
  device* ("This is the only copy we know of").
- Los números salen de las sumas propias; el de arriba, de `estimate()`.
- "Other app data" es la diferencia entre `estimate()` y lo contado (el texto y los comentarios de este workspace,
  las miniaturas, la caché del service worker y los otros workspaces). Si sale negativa (`estimate()` atrasado),
  0.

## 7. Cambios en la cola y en los caminos de abrir y bajar

- **`MediaRecord`** suma `freedAt`, `uploadedAt` (puesto por `markUploaded`) y `md5` (opcionales). Una versión vieja los conserva (todo se escribe con
  `{ ...registro, ...cambios }`). Del diseño anterior, `keep` ya no hace falta (lo reemplazan las marcas) y
  `lastUsedAt` pasa a `copy:<id>.usedAt` (vale también para los archivos de otros dispositivos, que no tienen
  `MediaRecord`, y `known` se reescribe entero con cada `fetchMeta`).
- **`source()`, `localOriginal()` y `localImage()`**: primero el original propio, después la copia bajada completa
  (sección 2.4). Con eso el carrete, los adjuntos (`attachmentOpen.ts`), *Share* (`AttachmentSheet`) y la
  impresión (`printPage.ts`) andan sin red con lo bajado, sin cambiar sus caminos. `source()` suma `freed: true`
  para el texto del aviso sin red.
- **`makeViewFor()`** (las nítidas): primero `offview:`, después `view:`, después el original propio o la copia
  bajada, después el portero. `clearViews()` y el tope de `viewIndex` no tocan `offview:`; `forgetView` sí la borra.
- **`remember(id, …, local)`** mira si hay original propio o copia bajada (hoy pone `local: true` para todo lo
  propio).
- **`process()` sin original:** hoy, si falta `blobs[id]`, detiene el archivo con `originalMissing` antes de mirar
  `driveId`. Con `freedAt`, y si una restauración de la base lo volvió a la cola (`pending: 1`, sin `driveId`):
  - con un portero que anuncia `known`: un `relink` **sin mandar bytes** (`POST /upload` con id, peso, nombre, tipo,
    día y `only: 'known'`). Si el portero recuerda la subida (`rec.drive`), o (entrega 2) encuentra en Drive el
    archivo con la marca `sdFile`, responde `done` y le avisa a la base. Si no, no abre nada y responde `unknown`;
  - con un portero sin `known` (ignoraría `only` y **abriría** una subida, con la carpeta del día y una sesión de
    Drive): **no se pide `/upload`**;
  - en los dos últimos casos el archivo se detiene con "The copy on this device was freed and the media server
    doesn't remember this file. It's in the owner's Drive: ask them". Si hay una copia bajada completa del mismo
    archivo, se sube esa (es el mismo archivo).
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
- Avisos sin red del carrete y de los adjuntos (sección 5.4) y el aviso del estreno (sección 5.6).
- "Offline" a la vista con lo pendiente (sección 8.1).
- Textos en `src/i18n/` (inglés y castellano), sin atajos nuevos.
- **Ayuda:** las entradas `availableOffline` y `storageDevice` en la sección "Offline and syncing" de la ayuda
  (v0.083; `Doc_Tutorial.md`, "Entradas que suma P.10").

### 8.1 "Offline" a la vista

Hoy (`src/ui/SyncBadge.tsx`, `src/i18n/sync.ts`): sin conexión (`status.online` en `false`, por el evento `offline` o
por un error de red del ciclo), la barra lateral dice "Offline · 700 changes saved on this device"; en el teléfono,
con la barra lateral cerrada, la barra de arriba muestra **solo el ícono** (`SyncIcon`), con el texto como etiqueta
para lectores de pantalla y `data-tip`, que en un teléfono no se ve. O sea: en el teléfono, el dispositivo del
rodaje, no queda claro. Cambio chico, en la entrega 1:

- **El texto:** "Offline · 700 to upload" ("Sin conexión · 700 por subir"); sin nada pendiente, "Offline". El número
  es el mismo de hoy (`usePendingCount`: cambios, fotos y videos, comentarios).
- **En el teléfono:** sin conexión, la barra de arriba muestra al lado del ícono la palabra y el número ("Offline ·
  700"), no solo el ícono. Con conexión sigue como hoy.
- **Con una marca descargando**, sin conexión dice además que la descarga espera ("Offline · 700 to upload · offline
  download paused") en el detalle, no en la línea.
- Pruebas: jsdom de `SyncBadge` y `SyncIcon` sin conexión, con y sin pendientes, en los dos idiomas.

## 9. Safari y el iPhone, Firefox y Chrome

Lo que dicen los navegadores (**a medir en el iPhone de Lega** durante la implementación: `estimate()` y
`persisted()` con la app instalada y en Safari suelto):

- **Safari (iOS y Mac, desde la versión 17):** cuota por origen de hasta ~60 % del disco; con `persist()`
  concedido, el origen no se desaloja por falta de lugar. **La regla de 7 días** (Safari borra lo de un sitio
  que no se abrió en 7 días de uso del navegador) no rige para la app **agregada a la pantalla de inicio**.
  Ojo: **la app instalada tiene su propio almacenamiento**, separado del de Safari: lo bajado en Safari no está en
  la app instalada. Por eso, en el iPhone fuera de la app instalada, la ventana recomienda instalarla antes de
  marcar. Hace falta Safari 15.4 o más (`navigator.locks`, sección 2.1). `wakeLock` en la app instalada, desde iOS
  18.4.
- **Firefox:** sin `persist()`, cuota "de mejor esfuerzo" (del orden de 10 GB o el 10 % del disco); `persist()`
  muestra un permiso. La app ya lo pide al guardar el primer archivo (`askPersist`); al marcar, se vuelve a pedir.
- **Chrome y Edge:** hasta ~60 % del disco; `persist()` se concede solo según el uso (instalada, marcada).
- **Siempre:** al marcar se llama a `persist()`, y la ventana y el diálogo dicen si quedó persistente.
- **Videos grandes sin red en Safari:** reproducir un video de 1 GB desde un `blob:` armado con partes es lo menos
  probado; se mide en el iPhone antes de cerrar la entrega 1. Si no anda, la casilla *Videos* dice en el iPhone
  hasta qué peso se probó.

### 9.1 El iPhone casi lleno: la reserva no se cumple sola

En Safari la cuota de la app puede pasar lo libre del disco (hasta ~60 % del disco **total**): un iPhone de 128 GB con
10 GB libres le daría a la app unos 76 GB "disponibles" y una reserva de 3,8 GB. Una marca de 15 GB pasaría el control y
bajaría hasta llenar el disco, y **la cámara del teléfono tampoco podría filmar**. Por eso:

- **Medición pendiente, para Lega** (sin ella la entrega 1 no se cierra en el iPhone). En un iPhone con poco lugar
  libre (menos de 3 GB, mirando *Ajustes → General → Almacenamiento del iPhone*), en la app instalada y después en
  Safari suelto:
  1. abrir la página de prueba que deja la implementación (muestra `estimate()` y `persisted()`) y anotar
     `quota`, `usage` y lo libre según Ajustes;
  2. tocar *Fill test* (escribe partes de 16 MiB de prueba en una base aparte, mostrando cuánto lleva) y anotar en
     qué número se corta, con qué error (`QuotaExceededError`, `UnknownError` u otro) y cuánto queda libre según
     Ajustes;
  3. con el disco así, abrir la cámara y probar filmar 10 segundos;
  4. tocar *Clean up* (borra todo lo de prueba) y comprobar en Ajustes que el lugar volvió.
- **Mientras no se mida, en el iPhone (y el iPad) el total de lo marcado offline en todo el dispositivo** (todas las
  marcas de todos los workspaces y cuentas de este origen) **no puede pasar un tope fijo** que no depende de la cuota,
  con el aviso "Check free space in iPhone Settings before marking large projects". **Propuesta: 5 GB** (pendiente de
  Lega). Es una constante (`IOS_OFFLINE_TOTAL_MAX` en `src/media/offline.ts`) fácil de cambiar. El total sale de las
  sumas propias de cada workspace, que cada uno anota en `localStorage` (`sd:offline:<base>`) al cambiar sus marcas;
  un workspace que se sacó del dispositivo borra la suya. Con la medición, se cambia por una regla basada en lo
  medido.
- **Al primer error de escritura por falta de lugar**, la marca se detiene y se borran las partes del archivo en curso
  (sección 3.5).

## 10. Portero y límites de Cloudflare

**Entrega 0** (antes que la app la use):

- **Códigos fijos en `POST /pass` y en lo que use la bajada**, como ya hace `/trash`: hoy `filePass` responde 404 tanto
  sin permiso o sin fila ("does not exist or you cannot see it", `core.ts:1042`) como cuando Drive no lo tiene
  (`:1055`), y 403 cuando Drive tiene un archivo con la marca de otro (`:1056`); y `/m/` responde 403 con el pase
  vencido o inválido (`:1087`, `:1090`). Pasa a responder además `code`: `not_found` (sin fila o sin permiso),
  `drive_missing` (Drive no lo tiene), `drive_mismatch` (Drive tiene otro), `drive_not_connected`, `abusive`,
  `pass_expired` y `pass_invalid`. Los números no cambian (una versión vieja de la app sigue igual). `/verify` usa
  los mismos códigos por archivo. La app los detecta por `features` (`codes`) y decide **solo** por el `code`.

- **`?offline=1` en `GET /m/<pase>`:** no va firmado y **solo saltea** la caché de arranque de los videos
  (`fromCache`): el pedido va directo a Drive con el `Range` pedido. No abre nada ni cambia lo que el pase deja ver.
  Con un portero anterior se ignora: la bajada igual anda porque avanza por el `Content-Range` real (sección 3.5),
  solo que con partes más cortas al principio.
- **`POST /verify`** con `{ files: [id…] }`, **hasta 15 por pedido** (el plan gratis de Workers deja 50
  subpedidos por pedido: uno a la base y uno a Drive por archivo, más la renovación del token de Google). Nivel 1,
  como un pase: `media_file` de cada uno y a Drive `files.get` con
  `fields=id,size,trashed,appProperties,md5Checksum`, **sin** lo anotado en `rec.verified`. Responde
  `{ results: { [id]: { driveId, size, trashed, marked, md5 } | { error } } }`.
- **`only: 'known'`** en `POST /upload`: si el portero no recuerda la subida, responde `{ status: 'unknown' }` sin
  crear la carpeta del día ni abrir una sesión de Drive.
- **`features: ['verify', 'known', 'offline', 'codes']`** en `/drive/status`. Con un portero sin `verify`, la app no libera
  originales propios (ni solos ni a mano: el diálogo lo dice) y sí todo lo demás; sin `known`, no hay `relink`.

**Entrega 2:** **buscar por la marca** antes de abrir una subida y en `only: 'known'`: `files.list` con
`appProperties has { key='sdFile' and value='<id>' }` (anda con `drive.file`; un pedido). Desde D-25 todos los
dispositivos sueltan originales: una restauración de la base más un portero que perdió `file:<id>` dejaría cada
archivo liberado detenido aunque esté en Drive con su marca. Es interna (por un id que la base ya conoce, responde
"está" o "no está"): `Doc_Carpetas.md`, corrección 2.

**Límites (plan gratis):** 100.000 pedidos por día al Worker para toda la cuenta, y el Durable Object tiene su
propio tope diario. Cada pedido al Worker hace **varios** al Durable Object (el secreto del pase, `file:<id>`, las
puntas de la caché: `portero/src/index.ts`). Bajar una marca cuesta un pase y uno o más pedidos a `/m/` por archivo
(uno cada 16 MiB): ERSO entero (2459 archivos, 5,7 GB) serían unos 5500 pedidos al Worker (el 5,5 % de un día) y
bastantes más al Durable Object. **Se mide con ERSO antes de cerrar la entrega 1**, con el contador del panel de
Cloudflare. Liberar, un `/verify` cada 15 archivos. Mantener al día, solo lo nuevo. Drive no cobra por bajar;
Cloudflare no cobra el tráfico de un Worker.

## 11. Versiones viejas

- Una versión vieja (pestaña sin recargar, iPhone sin actualizar) **ignora** `off:`, `offview:`, `copy:`,
  `offline:`, `marksRev`, `freedAt` y `md5`: sin red, muestra la miniatura donde la nueva mostraría la copia
  bajada. Su `clearViews` y su tope de nítidas no tocan `offview:` (no están en `viewIndex`). Su portero viejo ignora
  `?offline=1`.
- Un original propio liberado: la vieja muestra la miniatura y abre por el portero. Si una restauración lo vuelve a
  la cola, la vieja lo detiene con "falta el original" a la vista y bloquea *Remove from this device* (pide el
  original): se acepta, porque solo pasa con restauración más vuelta atrás de versión. La nueva lo resuelve con el
  `relink`.
- No cambia nada en el documento: no hace falta subir `min_app_version`. La función de comentarios es nueva y una
  versión vieja no la usa.

## Riesgos

- **Liberar un original que no estaba bien en Drive.** Lo evitan los tres pasos de la sección 5.3 (con MD5 e id de
  Drive), los 14 días y la separación de claves. Queda que el dueño borre a mano el archivo en su Drive después (se
  perdería para todos, no solo acá).
- **El tope y un rodaje sin red:** alguien cuenta con ver un video sin red y lo liberó con el aviso sin leerlo. Por
  eso las marcas, el aviso que dice qué se libera y que sin red solo se ve la miniatura, los 14 días desde la subida
  y la línea que dice qué casillas guardan los originales.
- **Descargas grandes en el teléfono:** sin la app abierta no bajan; con datos móviles gastan. La ventana lo dice
  ("downloads ≈3.4 GB") y la pantalla queda prendida mientras baja con la ventana abierta.
- **Safari:** la app instalada y Safari no comparten almacenamiento; videos grandes desde partes y el iPhone casi
  lleno (sección 9.1), a medir.
- **Imágenes `sdfile://` de un workspace sin portero:** se bajan de Supabase Storage (plan gratis: 5 GB de tráfico por
  mes) y desmarcar no las borra (viven en la base local de siempre, como hoy).
- **El estimado de la nítida** puede errarle un 30 %: la reserva y el freno por archivo (sección 3.5) lo cubren.
- **Restauración de la base con originales liberados:** depende de que el portero recuerde la subida o, desde la
  entrega 2, de la búsqueda por la marca.
- **Cuota de Cloudflare compartida** con el resto de la cuenta, y la del Durable Object: se mide con ERSO.
- **Share** deja de estar en las fotos y videos viejos del propio teléfono (sección 5.4).
- **Fuera de esta tanda:** si el dueño reconecta Drive con otra cuenta de Google, lo liberado en todos los
  dispositivos queda solo en la cuenta anterior (no se pierde, y `/verify` impide liberar más); convendría avisarle
  al reconectar cuántos archivos quedan en la otra cuenta.

## Entregas y pruebas

1. **Entrega 0, portero:** los códigos fijos, `?offline=1`, `POST /verify` en lote (con `md5Checksum` e id),
   `only: 'known'`, `features`, con pruebas en `portero/src/core.test.ts`: `not_found`, `drive_missing`,
   `drive_mismatch`, `pass_expired`; archivo en la papelera de Drive, sin la marca, otro peso, otro MD5, sin
   `md5Checksum`, sin caché, lote de 15, uno sin permiso en el lote, `only: 'known'` sin abrir nada, y un video de 40 MB
   por `/m/` **con la caché del portero de verdad**, con y sin `offline=1`. Se publica con el push a `main`, antes
   que la app que la usa.
2. **Entrega 1, Available offline:** marcas con su conjunto, la ventana con los pesos, la descarga por partes en su
   ciclo, mantener al día, comentarios (con la función nueva de la base y su migración, o el camino sin ella),
   desmarcar, el ícono, los caminos de lectura de la sección 7, la reserva y `save()` que libera copias bajadas, el
   diálogo de espacio **sin** liberar originales propios, y el tope solo para copias bajadas y nítidas. Lo único que
   borra son claves con prefijo. **No se cierra en el iPhone sin la medición de la sección 9.1.**
3. **Entrega 2, liberar originales propios:** `freeOwn` con los tres pasos, el MD5 y los 14 días, el tope y *Free up
   space* para los propios, el `relink`, la búsqueda del portero por la marca, `uploadedAt`, `usedAt` con el aviso
   del estreno y los originales propios ofrecidos en segundo plano cuando algo no entra. Riesgo alto: auditoría propia antes de publicar.
4. **Entrega 3:** *Drive folders* (con P.9) y compartir un archivo sin copia (bajarlo al vuelo).

**Pruebas de unidad** (`queue.test.ts` y una nueva `offline.test.ts`, con el servidor y el portero en memoria de
`src/sync/testing.ts`):

- **Separación de claves:** `dropCopy` nunca borra una clave sin prefijo (también con ids raros, mayúsculas,
  `off:` adentro del id); con un original propio sin subir y una copia bajada del mismo id, liberar la copia deja el
  original; las partes huérfanas se limpian y una parte nunca queda sin su entrada.
- **`freeOwn` no libera:** con `pending: 1`, `blocked`, `uploadId`, `heic`, sin `driveId`, subido hace menos de 14
  días, en un conjunto, con `marksRev` cambiado entre la lista y la transacción, con la base diciendo otro
  `drive_id`, `purged_at`, `drive_trashed_at` o `trashed_at`, con `/verify` diciendo otro id, otro peso, otro MD5,
  `trashed`, sin marca, error o sin respuesta, con un portero sin `verify`, sin red; una restauración entre la
  comprobación y el borrado no borra.
- **El conjunto protegido:** una página a medio bajar (`cursor < update_seq`), sin `DocState`, ilegible o no
  soportada solo suma; con la página completa, quita; una sincronización a medias con señal mala no libera nada
  marcado (el escenario del rodaje); "listo" espera a todas las páginas.
- **El tope:** por workspace; el que elige la persona (y `min(2 GB, cuota / 2)` de fábrica); **pasado el tope no se
  borra nada hasta el sí**; *Not now* calla un día; del menos usado al más, hasta el 90 %, con las sumas propias; lo
  marcado no cuenta ni se ofrece; lo que espera subir cuenta y no se ofrece; lo abierto en la sesión no se libera;
  `gone` nunca; *No limit* nunca avisa.
- **Lugar:** la reserva; `save()` con `QuotaExceededError` pregunta y, con el sí, libera y reintenta una vez; sin red
  ofrece copias bajadas no marcadas, nunca originales propios; `UnknownError` de Safari como falta de lugar; una
  marca sin lugar se detiene y pregunta.
- **Marcas:** la rama sigue al árbol (crear, mover adentro y afuera, papelera, restaurar, permisos); dos marcas
  cruzadas; los pesos de todas las filas (también destildadas), la nítida estimada, lo que ya está, la línea de los
  originales propios no protegidos; no arranca si no entra, contando lo liberable y la reserva; la descarga avanza
  por el `Content-Range` real (un 206 más corto que lo pedido no deja huecos); se retoma después de cerrar; un total
  distinto se descarta; un 200 de más de 16 MiB no se lee; se decide por el `code` y nunca por el número
  (`not_found` no borra solo ni ofrece *Save a copy*; `drive_missing` marca `gone` solo con `/verify`; `drive_mismatch`
  no borra nada; pase vencido pide otro); un portero sin códigos nunca borra ni marca `gone`; mantener al día solo
  relee las páginas que cambiaron;
  desmarcar borra solo lo suyo, no lo `gone` y nunca un original propio; permiso quitado (`not_found` más la página
  fuera del árbol por permisos) borra y "la base no devuelve la fila" no; proyecto borrado saca la marca y borra sus
  copias, salvo las `gone`; restaurado vuelve como online, sin bajar nada.
- **Opción A** de la sección 3.2: un original propio de la rama con su casilla destildada no está protegido y se
  ofrece con el aviso; con la casilla tildada, nunca.
- **Bajar no demora subir:** con una bajada de 16 MiB en vuelo, agregar una foto corta la bajada y la foto sube
  primero; un archivo detenido o esperando un reintento no frena las bajadas.
- **Sin lugar al escribir:** el primer `QuotaExceededError` o `UnknownError` detiene la marca y borra las partes del
  archivo en curso; el tope fijo del total marcado en el iPhone.
- **Comentarios:** una página que entra a la rama se baja con su propio cursor aunque sus comentarios sean más viejos
  que el cursor del proyecto.
- **`uploadedAt`:** lo pone `markUploaded`; sin el campo vale `space:rollout`; subido hace menos de 14 días no se
  ofrece.
- **Lectura:** `source()`, `localOriginal()`, `localImage()` y `makeViewFor()` con copia bajada y con `offview:`;
  `forgetView` borra `offview:`; mover `view:` a `offview:`; sin red, el carrete y un adjunto abren desde la copia;
  una imagen `sdfile://` de una página marcada se ve sin red.
- **`relink`:** `resetForRestore` con un original liberado termina en `done` sin mandar bytes (portero que recuerda)
  o detenido con el aviso (portero que no, sin abrir nada); con un portero sin `known` no se pide `/upload`.
- **Versión vieja:** con el esquema de la base de `main`, abrir una base con `off:`, `offview:` y `copy:` no rompe ni
  borra nada, y su `clearViews` no toca `offview:`.

**jsdom:** la ventana (filas, indicadores circulares, total, sin lugar, sin red, progreso, listo, páginas que faltan),
el diálogo de espacio (números, *Free up space* con confirmación, desmarcar, *Only copy on this device*).

**En Chromium (servidor de mentira):** marcar una página con fotos, adjuntos y un video, ver el progreso, cortar la
red y abrir el carrete, un adjunto y la página con las fotos en grande.

**A mano, Lega:** en el iPhone con la app instalada, marcar un proyecto, poner el modo avión y recorrerlo (fotos en
grande, PDF, un video de 1 GB); en Chrome de computadora y en Safari de Mac lo mismo; bajar el tope a 1 GB y ver el
aviso, *Not now* y *Free up*.

## Cómo quedó (entregas 0 y 1)

**Entrega 0, portero** (`portero/src/core.ts`, pruebas en `portero/src/core.test.ts`):

- Los errores de `POST /pass`, `GET /m/`, `POST /upload` (archivo de la app) y `POST /verify` traen un `code` fijo:
  `not_found`, `not_uploaded`, `drive_missing`, `drive_mismatch`, `drive_not_connected`, `pass_expired`,
  `pass_invalid` (y los de siempre: `abusive`, `drive_full`). Los números no cambiaron.
- `POST /verify` con `{ files }`, hasta 15: `{ driveId, size, trashed, marked, md5 }` por archivo, preguntándole a Drive
  cada vez, o `{ error, code }` sin cortar a los demás.
- `only: 'known'` en `POST /upload`: `{ status: 'unknown' }` sin crear carpetas ni abrir una subida.
- `?offline=1` en `/m/`: saltea la caché del arranque de los videos.
- `/drive/status` dice `features: ['verify', 'known', 'offline', 'codes']`.

**Entrega 1, app:**

- **Código:** `src/media/offlineStore.ts` (las claves `off:`, `offview:`, `copy:`, `offline:` y `marksRev`, el filtro
  por casillas `protects` y el único borrado de copias, `dropCopy`, que solo arma claves con prefijo),
  `src/media/offlinePlan.ts` (la rama, los pesos y la nítida estimada), `src/media/offline.ts` (`OfflineManager`:
  marcar, leer la rama, bajar, mantener al día, el tope y el aviso), `src/ui/OfflinePart.tsx` (las dos ventanas, que
  se bajan aparte), `src/ui/SpaceHost.tsx` (el aviso, la línea de la bajada en la barra lateral y el ícono) y
  `src/ui/StorageTest.tsx` (la medición de la sección 9.1). En `src/media/queue.ts`: leer las copias bajadas y las
  nítidas de las marcas (`source`, `localOriginal`, `localImage`, `makeViewFor`), `forgetView` que borra también
  `offview:`, `hasUploadableNow`, `uploadedAt` al confirmar una subida (para la entrega 2) y los avisos de uso y de
  falta de lugar.
- **Dónde se ve:** *Available offline…* en el menú de la página y en el de cada proyecto (ícono al pasar el mouse,
  "⋯" en el teléfono); *Storage on this device* en el menú de la cuenta; un ícono en la página o el proyecto
  marcado; "Downloading for offline: 3 of 11" debajo del estado; el aviso del tope abajo, al centro; y sin red,
  "Offline · 700 to upload" en la barra lateral y "Offline · 700" al lado del ícono en la barra de arriba del
  teléfono.
- **Las casillas** de fábrica son las de D-25; la opción A (sección 3.2) decide qué protege cada una. *Drive folders*
  no aparece (llega con P.9).
- **La bajada:** en la pestaña de la cola, después de cada sincronización y cada 10 minutos, solo si no hay nada que se
  pueda subir; algo nuevo para subir corta la parte en vuelo. Partes de 16 MiB por el `Content-Range` real, cada una
  con su entrada en la misma transacción. Errores por el `code`. En el teléfono, la nítida de a una y la pantalla
  prendida mientras la ventana muestra la bajada.
- **El tope:** se elige en *Storage on this device* (1, 2, 5, 10 o 20 GB, o sin tope; de fábrica `min(2 GB, la mitad
  de la cuota)`). Pasado, el aviso pregunta; *Not now* lo calla un día. Con el sí se liberan solo las nítidas de la
  página y las copias bajadas que ninguna marca pide, de la que hace más que no se abre a la más reciente, nunca lo
  abierto en la sesión ni lo `gone`, y antes de borrar una copia entera se le pregunta a la base y, si el portero lo
  sabe, a Drive (`/verify`): si Drive ya no la tiene, queda como "única copia". **Los originales agregados en este
  dispositivo no se liberan** (cuentan para el tope y el diálogo lo dice).
- **Sin lugar:** las bajadas dejan la reserva de `max(1 GB, 5 %)`; si no entra, la marca se detiene y el aviso ofrece
  liberar. En el iPhone, el total marcado del dispositivo (todos los workspaces, más lo bajado en la vuelta en curso)
  no pasa `IOS_OFFLINE_TOTAL_MAX` (5 GB, en `src/media/offline.ts`), y la ventana mira ese mismo total.
- **Una foto nueva que no entra no se pierde** (auditoría de la implementación): antes de rechazarla, la cola libera
  sin preguntar lo que se rehace o ya está en Drive (las nítidas de la página y las copias bajadas que ninguna marca
  pide; nunca lo marcado, lo `gone`, lo abierto ni un original propio) y vuelve a probar una vez. Una copia entera,
  solo si la base dice que sigue en Drive fuera de las dos papeleras (sin red, lo último anotado: sin el dato de la
  papelera de la app, no se libera) y, si el portero tiene `/verify`, Drive lo confirma; una nítida sola, solo si el
  original sigue en Drive (si no, puede ser lo mejor que queda de la foto). Es la única excepción a
  "nada se libera sin el sí": una foto de "Tomar foto" del iPhone no queda en la fototeca. Si igual no entra, un aviso
  ofrece guardarla (*Save…*: la hoja de compartir, con "Guardar imagen" en el iPhone, o una descarga); queda en
  memoria hasta guardarla o descartarla.
- **Comentarios:** de a una página (`CommentQueue.refresh`), al marcar y cada 6 horas. La función por proyecto de la
  sección 3.6 no se hizo (no hace falta migración en esta entrega).

**Lo que quedó distinto o afuera del diseño:**

- No se suman los usos de `page_files` de la base: el conjunto sale del contenido del dispositivo (que la regla de
  las páginas incompletas protege).
- Una página abierta no se vuelve nítida en el acto cuando termina la marca: lo hace al cambiar de ancho, al volver la
  red o al minuto (lo que ya hacía la página).
- *Show what* (en el aviso y en *Storage on this device*) muestra la lista de lo que se liberaría primero: nombre,
  peso y "abierto hace…", con las nítidas de la página en una línea.
- Sin Web Locks (Safari anterior a 15.4) *Available offline* y *Storage on this device* no aparecen.
- Una marca lista y sin cambios no se vuelve a consultar entera en cada sincronización: recién a los 10 minutos.
- Una copia que dice estar completa pero perdió una parte se vuelve a bajar; `cleanOrphans` va en una sola transacción.
- El carrete sin red muestra la de 2048 guardada aunque la página no la haya procesado.
- "Offline · N" en el teléfono sale según la conexión, también con algo rechazado.
- Las tarjetas de carpeta de P.9 (una fila `inode/directory`) no se bajan ni pesan en ninguna fila: lo de adentro
  llega con la casilla *Drive folders* (entrega 3). Mientras una carpeta se sube, las bajadas esperan y la parte en
  vuelo se corta, como con la cola de fotos y videos.
- Sin red, el carrete dice si lo que muestra es la versión grande guardada en el dispositivo o la miniatura.

**La medición del iPhone (sección 9.1), para Lega:** en *Storage on this device*, abajo, *Measure storage on this
device…* abre la página de prueba (también en `/storage-test`). La página no deja llenar si algún workspace de este
dispositivo tiene algo por subir, avisa si el almacenamiento no es persistente y, al abrirla (y al abrir la app),
borra los datos de una medición que haya quedado cortada. Pasos (con **0 por subir**):

1. En el iPhone, mirar el lugar libre en *Ajustes → General → Almacenamiento del iPhone* y anotarlo.
2. Abrir la app instalada → menú de la cuenta → *Storage on this device* → *Measure storage on this device…*. Anotar
   *Quota*, *In use*, *Persistent storage* e *Installed app*.
3. Escribir `fill` y tocar *Fill*. Esperar a que se corte solo y anotar *Test data written* y el error de *Stopped
   with*. Volver a mirar el lugar libre en Ajustes.
4. Con el disco así, abrir la cámara y probar filmar 10 segundos.
5. Volver a la página y tocar *Clean up*; comprobar en Ajustes que el lugar volvió.
6. Repetir en Safari (sin instalar), con `https://shotdocs.lega.com.ar/storage-test`.

Si el iPhone tiene mucho lugar libre, *Fill* tarda (escribe todo lo que el navegador deje): conviene hacerlo con
poco lugar libre, como pide la sección 9.1. Con los números, se cambia el tope fijo del iPhone por una regla.

**Pruebas:** `src/media/offline.test.ts` (los pesos y la nítida estimada; las nítidas y miniaturas de la rama y verlas
sin red; las copias enteras y abrirlas sin red; el portero viejo que corta las partes; la página a medio bajar que solo
suma; desmarcar; las claves que nunca alcanzan un original propio; el tope que avisa y no borra; lo abierto en la
sesión; Drive que ya no lo tiene; permiso quitado con las dos señales; subir antes que bajar; sin lugar por la reserva
y al escribir; el tope del iPhone; la nítida de la página que pasa a la marca; la foto nueva que no entra, que libera
solo copias bajadas que siguen en Drive y nunca algo sin subir, marcado, `gone` o en una papelera; la tarjeta de una
carpeta de P.9, que no se baja), `src/ui/offlineUi.test.tsx` (las dos
ventanas, el aviso y "Offline · N"), `portero/src/core.test.ts` (los códigos, `/verify`, `only: 'known'` y
`?offline=1` con la caché del arranque de verdad) y un recorrido en Chromium con el servidor de mentira (marcar,
pesos, progreso, listo, sin red, teléfono, el diálogo de espacio, el aviso del tope y liberar; la página de
medición, con *Fill*, *Stop* y *Clean up*).

## Respuestas de Lega a las propuestas (2026-10-01)

El diseño de arriba ya las sigue.

1. **Tope:** lo pone la persona; de fábrica 2 GB por workspace (`min(2 GB, la mitad de la cuota)` en un navegador
   con poco lugar). Se ve, con lo ocupado, en la ventana de marcar y en *Storage on this device*.
2. **Esperar y avisar:** nunca se libera sin un aviso previo y un sí; lo marcado, nunca. Reemplaza la gracia de 7
   días. Los 14 días desde la subida antes de ofrecer liberar un original propio siguen.
3. **Opción A** (2026-10-01): lo marcado se mantiene en la versión tildada; los originales propios ya confirmados
   en el Drive son liberables, siempre con aviso previo; lo no subido nunca se toca, con o sin red. Sección 3.2.
10. **"Offline" claro** junto con lo pendiente ("Offline · 700 to upload"), también en el teléfono. Sección 8.1.
4. **Sin "Keep on this device" por archivo:** offline es por página, página con subpáginas, o proyecto.
5. **Mostrar lo que se baja por la red:** sí.
6. **Comentarios:** siempre los de la rama marcada, sin casilla, cada una hora con una función nueva de la base (sin
   ella, al marcar y cada 6 horas, de a una página).
7. **Desmarcar** borra las copias bajadas en el acto (con una casilla para dejarlas), salvo lo que pide otra marca
   (según su conjunto guardado) y lo que Drive ya no tiene (`drive_missing` confirmado: puede ser la única copia).
8. **2 GB por workspace** (por cuenta, en este dispositivo).
9. **Permiso quitado** (también un proyecto borrado): se borran las copias bajadas (salvo las `gone`), con una
   señal explícita. Al
   restaurar el proyecto o devolver el permiso, vuelve como online: no se baja nada solo; se vuelve a marcar si se
   quiere.

**Decidido por Lega (2026-10-01):** en el iPhone, hasta medir con el disco casi lleno (sección 9.1), el **total** de lo
marcado en todo el dispositivo no pasa **5 GB** (constante `IOS_OFFLINE_TOTAL_MAX`).

**Re-verificación (2026-10-01):** B1, B2 y B3 resueltos; dos bloqueantes nuevos corregidos: N1 (decidir por el `code`
del portero: secciones 3.5, 4, 6 y 10) y N2 (el iPhone casi lleno: secciones 3.5 y 9.1). También `uploadedAt`,
"nada que se pueda subir ahora", el cursor de comentarios por página, la versión de la base después de P.14, el filtro
por casillas adentro de la transacción, `save()` sin originales propios en el acto, sin MD5 no se libera, lo liberable
de la entrega 1, la frase de las claves, el 200 de más de 16 MiB, "needs an app update" y las `sdfile://` sin portero.

## Correcciones de la auditoría (2026-10-01)

Una auditoría independiente contrastó la versión `a03a831` con el código de `main` (`e9eb660`): "aprobado con
cambios". Todas quedaron en el cuerpo:

| Observación | Dónde quedó |
|---|---|
| B1: los videos por `/m/` con `Range` salen de la caché de arranque y responden partes más cortas | 3.5 (avanzar por `Content-Range`), 10 (`?offline=1`), pruebas (video de 40 MB con la caché de verdad) |
| B2: lo protegido dependía de una lectura completa del contenido | 3.1 (conjunto guardado: una página incompleta solo suma), 3.5 ("listo" con todas las páginas), 2 y 5.2 (`marksRev` en la transacción) |
| B3: qué cuenta para el tope con páginas sin leer | 5.1 (cuenta según el conjunto guardado) |
| 1: bajar demoraba las subidas | 3.5 (ciclo propio, se corta con `onQueued`) |
| 2: las marcas dejaban sin lugar para filmar; `checkRoom` solo > 50 MB | 5.7 (reserva, `save()` libera y reintenta, sin red solo copias bajadas), 3.4 |
| 3: con las casillas de fábrica los originales propios no quedan | 3.2 y 3.4 (la fila lo dice), 5.6 (el aviso) |
| 4: comprobar contenido y id de Drive | 5.3 y 10 (`md5Checksum`, `driveId`) |
| 5: búsqueda por la marca `sdFile` | 10 y entregas: pasa a la entrega 2 |
| 6: `relink` con un portero viejo | 7 (sin `known`, no se pide `/upload`) |
| 7: borrar porque la base no devuelve la fila | 4 (solo señal explícita) |
| 8: una copia bajada puede ser la única | Reglas, 2.1 (`gone`), 3.5, 3.7, 5.2, 6 |
| 9: partes huérfanas | 2.1 (parte y entrada en la misma transacción; limpieza) |
| 10: comentarios de a una página | 3.6 (función de solo lectura nueva, o cada 6 horas) |
| 11: imágenes `sdfile://` | 1, 3.2, 3.3 |
| 12: límites del Durable Object; `/verify` de 20 | 10 (15 por pedido; medir con ERSO) |
| 13: suma de varios workspaces | 5.1 (2 GB por workspace) |
| 14: "free" no es lo libre del disco; `QuotaExceededError`; número negativo | 3.4, 3.5, 6 |
| 15: el botón no contaba lo liberable | 3.4 |
| 16: `forgetView` no borraba `offview:` | 3.6, 7 |
| 17: copiar `view:` a `offview:` duplicaba | 3.5 (se mueve) |
| 18: liberar algo que se está mostrando | 5.2 (lo abierto en la sesión, nunca) |
| 19: sin Web Locks | 2.1 y 9 (requisito) |
| 20: nítidas de originales grandes en el teléfono | 3.5 (de a una) |
| 21: `wakeLock` en iOS | 3.5, 9 |
| 22: el dueño cambia de cuenta de Google | Riesgos (fuera de esta tanda) |
| 23: *Share* sin copia | 5.4 y Riesgos |
| 24: adjunto propio de más de 50 MB | 3.2 |
| Las 9 preguntas | "Respuestas de Lega a las propuestas" |

## Unión con `main` (v0.081, 2026-10-01)

La rama se unió con `main` en `b03267e` (carpetas, borrar la carpeta de un proyecto en Drive, instalar la app, fotos en
línea), conservando lo de los dos lados. En el portero, `features` anuncia `verify`, `known`, `offline`, `codes` y
`folders`, y los errores nuevos de `main` (`is_folder`) conviven con los códigos de esta rama. Pruebas, `tsc`, build, el
smoke del portero (con `/verify` y `?offline=1`) y el recorrido en Chromium, en verde después de unir. Lo que sigue
pendiente: la medición del iPhone (sección 9.1) y la entrega 2.
