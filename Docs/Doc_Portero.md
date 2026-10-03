# Portero de archivos

El portero es un Worker de Cloudflare en la cuenta del dueño del workspace (código en `portero/`). Guarda la
conexión con el Google Drive del dueño, sube los archivos a su Drive y los devuelve en streaming. Nadie
más recibe la conexión con Drive: con ella se abre todo lo que la app subió, de todos los proyectos. El
plan está en `Plan_Workspaces.md`, secciones 5 y 6.

Sirve para los archivos de las páginas (pasos 6 y 8 del plan). La **prueba de media** del paso 4 (la
pantalla *Media test*) salió de la app en v0.042; el portero sigue aceptando su subida sin `file` (solo el
dueño, a `Media_Test`) por si la usa una versión vieja. Conectar Drive y elegir dónde va la carpeta de la
app los hace solo el dueño (menú de la cuenta → *Google Drive*); subir y ver un archivo de una página depende del permiso de cada
persona sobre esa página.

Carpetas en el Drive del dueño. Ninguna lleva espacios, nunca: guiones bajos, también las que suelta el usuario en
una página (D3 → B, 2026-10-02; entre v0.089 y v0.127 esas conservaban su nombre y esas subidas no se renombran):

```
<carpeta elegida por el dueño, o la raíz de su Drive>
└── LGA_ShotDocs
    ├── Media_Test                      (lo de la prueba de media)
    └── <Proyecto>                      (el nombre del proyecto, con _ y sin caracteres raros)
        ├── <AAAA-MM-DD>                (el día en que se subió)
        │   └── IMG_1234.MOV
        └── Carpetas                    (las carpetas soltadas en las páginas, P.9)
            └── Día_2_-_Puerto          (con su árbol: cada carpeta con su nombre y los espacios en "_")
```

- **El nombre del proyecto** se pasa a guiones bajos y se le sacan los caracteres raros (barras, dos puntos,
  comodines, comillas, emojis); las letras con acento y la ñ quedan. `Spot Coca-Cola / 2026` →
  `Spot_Coca-Cola_2026`. Hasta 100 caracteres; si no queda nada, `Project`.
- **Renombrar el proyecto** renombra su carpeta la próxima vez que se sube algo a ese proyecto, pero solo si
  la carpeta todavía tiene el nombre que le puso la app (el portero lo recuerda). Si el dueño la renombró a
  mano, se respeta y se sigue subiendo ahí.
- **Nada se borra en Drive.** Una carpeta que el dueño mandó a la papelera se vuelve a crear (la vieja queda
  en la papelera). Mover o renombrar a mano un archivo o una carpeta no rompe nada: todo se busca por id. Lo
  único que el portero hace con un archivo subido es mandarlo a la **papelera de Drive** (`POST /trash`),
  cuando un dueño o admin lo pide desde la papelera de archivos de la app: Drive lo guarda 30 días más y se
  recupera desde ahí.
- Cada archivo lleva en Drive una marca oculta (`appProperties.sdFile` = el id del archivo en la app), y la
  carpeta de cada proyecto otra (`sdProject`). Con la primera el portero comprueba, antes de dar un pase, que
  el archivo de Drive es de verdad ese archivo de la app.
- Las carpetas creadas antes de v0.027 con el nombre viejo (`LGA Shot Docs`, `Media test`) el portero las
  renombra por su cuenta la próxima vez que sube algo, salvo que el dueño les haya puesto otro nombre.

## Cómo funciona

- **Quién pide.** Cada pedido trae la sesión de Supabase de la persona. El portero le pregunta a
  `media_whoami()` del Supabase del workspace, con esa misma sesión: el propio Supabase la valida y dice
  quién es y si es el dueño. Para un archivo de una página le pregunta a `media_file(id)`, que dice el
  proyecto, el nombre, el tipo, el peso, si ya está en Drive y el **nivel** de la persona sobre el archivo
  (el más alto de las páginas que lo usan): subir pide nivel 3 (editar), ver pide nivel 1. El portero no
  tiene ninguna clave de la base.
- **Conectar Drive** (una vez por workspace, lo hace el dueño): la app pide al portero la dirección de
  Google, el dueño acepta, Google vuelve al portero (`/drive/callback`) y el portero guarda la conexión
  (refresh token). Permiso `drive.file`: la app solo ve lo que ella misma sube, nada más del Drive.
- **Subir** por partes de 8 MiB: la app pide una subida (`POST /upload`), el portero abre una subida
  reanudable en Drive y la app manda las partes (`PUT /upload/<id>`) que el portero pasa a Drive. Si se
  corta, la app pregunta cuánto llegó y sigue desde ahí. Las partes pasan por el portero para que la app
  nunca tenga la conexión con Drive. Cuando termina la subida de un archivo de una página, el portero le
  dice a la base en qué archivo de Drive quedó (`set_file_drive`, con la sesión de la persona). Toda
  respuesta "listo" (`done`) de un archivo de una página dice además `linked: true` (la base ya lo sabe) o
  `linked: false` (todavía no). **La app lo marca subido solo con `linked: true`**; con `false` vuelve a
  preguntar más tarde. Si avisarle a la base falla por la red, el portero lo vuelve a intentar la próxima
  vez que alguien pregunte por ese archivo (la app preguntando cuánto llegó, pidiendo la subida de nuevo o
  pidiendo un pase); mientras tanto el archivo ya se puede ver. Si la app pide de nuevo la subida de un
  archivo que la base ya tiene en Drive, el portero comprueba (una vez) que ese archivo de Drive lleve la
  marca de este y responde "listo" sin volver a subirlo; si no la lleva o ya no existe, responde `409`
  (*"This file is registered with a different Drive file: ask the workspace owner."*) y la app lo deja
  pendiente y a la vista.
- **Ver**: la app pide un pase (`POST /pass`) y lo usa como dirección del video, la foto o el adjunto
  (`/m/<pase>`). El pase está firmado por el portero con una clave que genera él mismo la primera vez y
  que no sale de ahí, y vence a las 8 horas. Lleva, todo firmado, `{ f, t, u, s, n }`: el id de Drive, el
  tipo (`files.mime`), cuándo vence, el peso y el nombre (`files.name`); tipo y nombre salen de
  `media_file`, nunca de lo que mande la app. Los pases de antes (sin `n`) siguen valiendo y se sirven sin
  nombre. Si se muestra o se baja **no va en el pase**: se decide al servir a partir de `t`, así los pases
  viejos también reciben los encabezados de ahora (ver *Lo que se sirve*). `/m/<pase>?download=1` (fuera
  de la firma) **solo puede forzar la descarga**, nunca que se muestre. El portero pide a Drive solo la
  parte que pide el navegador (Range), así un video se reproduce sin bajarlo entero.
- **Arranque del video (caché).** Solo para videos (`t` del pase `video/*`): un PDF o una foto pedidos
  por partes van siempre a Drive, para no desplazar a los videos. Para empezar a reproducir, el navegador
  pide primero el principio del archivo y, en los videos del iPhone, el final (ahí va el índice). El
  portero guarda esas dos puntas en su almacenamiento la primera vez que alguien las pide, y desde
  entonces las sirve sin ir a Drive:
  - Principio: ~254 KiB. Final: ~508 KiB. En trozos de 127 KiB (cada valor del almacenamiento puede pesar
    hasta 128 KiB). Un archivo de hasta ~762 KiB se guarda entero.
  - Tope: **256 archivos** (unos 190 MiB como mucho). Cada archivo tiene un lugar fijo entre los 256 (sale
    de su id) y el que llega desplaza al que estaba en ese lugar. Es solo una copia de las puntas:
    olvidarla no borra nada.
  - Se sirve desde ahí todo pedido por partes que **empieza** adentro de una punta guardada, con `206`,
    `Content-Range`, `Content-Length` y los mismos encabezados que lo que viene de Drive. Si sigue después
    de la punta (Chrome pide `bytes=0-` para empezar), se devuelve solo lo guardado: un `206` más corto que lo pedido
    es válido y el navegador pide lo que sigue, que va a Drive. Lo que empieza afuera de las puntas (el
    medio, lo que sigue al principio), el archivo entero sin Range y varias partes en un pedido van a Drive
    como siempre.
  - Dos pedidos a la vez no se pisan: cada punta tiene su descripción, que se escribe entera una sola vez,
    y la clave de cada trozo dice de qué archivo, de qué peso y de qué lugar son sus bytes. Un trozo que
    falta o no mide lo que debe, o un archivo que ya no ocupa su lugar, se piden a Drive: nunca se sirven
    bytes equivocados. Si dos archivos se pelean por el mismo lugar al mismo tiempo, lo del que pierde puede
    quedar guardado sin usarse (a lo sumo ~762 KiB) hasta que se lo vuelva a pedir.
  - **Hay que medir** si el video arranca más rápido (abriendo un video de una página en el carrete): en las herramientas de desarrollo
    del navegador (pestaña *Network*), la respuesta que sale de la caché lleva `X-Portero-Cache: hit`, y
    `fill` la vez que se trae de Drive y se guarda; sin ese encabezado, vino de Drive. La primera vez que
    alguien abre un archivo se llena la caché; el arranque rápido se ve desde la segunda (de cualquier
    persona). Anotar los tiempos en `Plan_Workspaces.md` como los de la prueba del paso 4.
  - Si el dueño reemplaza el contenido de un archivo en Drive (*Manage versions*), las puntas guardadas
    quedan viejas: lo que sube la app nunca se reemplaza, así que no pasa con los archivos de la app.
- **Dónde guarda**: en un Durable Object con almacenamiento SQLite (lo trae el plan gratis de Workers). No
  hay que crear nada a mano. Lo guardado, por clave (lo de antes se sigue leyendo igual):

  | Clave | Qué es |
  |---|---|
  | `google` | La conexión con Drive (refresh token), el correo y los ids de `LGA_ShotDocs` y `Media_Test`. |
  | `accessToken` | El token de acceso vigente (dura una hora). |
  | `passSecret` | La clave con la que firma los pases. |
  | `state:<id>` | Un pedido de conexión con Google en curso (15 minutos), con la ruta de la app a la que vuelve. |
  | `upload:<id>` | Una subida en curso o terminada (con el archivo de la app, si es uno). |
  | `drivePlace` | La carpeta que eligió el dueño para `LGA_ShotDocs` (sin la clave: la raíz). |
  | `project:<id del proyecto>` | La carpeta del proyecto y el nombre que le puso la app. |
  | `day:<id del proyecto>:<AAAA-MM-DD>` | La carpeta de ese día. |
  | `file:<id del archivo>` | Lo que subió el portero y si la base ya se enteró; qué id de Drive ya se comprobó. |
  | `cache:<id de Drive>:head`, `cache:<id>:tail` | Qué hay guardado de cada punta de un archivo (peso, largo, tipo). |
  | `cache:<id>:<peso>:h<n>`, `cache:<id>:<peso>:t<n>` | Los trozos de 127 KiB de cada punta. |
  | `cacheSlot:<n>` | Qué archivo ocupa cada uno de los 256 lugares de la caché. |
  | `cache:<id>` | El peso aprendido de un archivo de la prueba de media (su pase no lo trae). |
| `carpetas:<id del proyecto>` | La carpeta `Carpetas` del proyecto (P.9). Lo de adentro de cada carpeta no se guarda: ni subidas ni listas. |

  **Nunca** se cambia el nombre de la clase `Store` ni las `migrations` de `portero/wrangler.jsonc`: ahí vive
  todo esto.
- **Por qué Cloudflare y no Supabase**: Supabase gratis deja 5 GB de transferencia al mes; Cloudflare no
  cobra la transferencia.

Direcciones que la app conoce: la del portero está en `workspace_settings.media_url` (la carga el dueño
de la base, ver abajo). Quién es el dueño: `workspace_settings.owner_id`.

### Rutas

Todas están en `portero/src/core.ts`. Las tres primeras no llevan sesión; las demás llevan la sesión de
Supabase (`Authorization: Bearer …`). "Nivel" es el de la persona sobre el archivo, según `media_file`.

| Ruta | Quién | Qué hace |
|---|---|---|
| `GET /health` | Cualquiera | Responde `{ ok: true }`: sirve para ver que el portero está publicado. |
| `GET /drive/callback` | Google | Vuelta de Google al conectar Drive. Guarda la conexión y vuelve a la ruta de la app que pidió `/drive/connect` (por defecto `/media-test`) con `?drive=<resultado>`. |
| `GET` o `HEAD /m/<pase>` | Quien tenga el pase | Devuelve el archivo desde Drive o desde la caché del arranque, por partes (Range). El pase firmado es la única credencial y vence a las 8 horas. `?download=1`: se baja (`attachment`). `?offline=1`: saltea la caché del arranque (la app baja el archivo entero por partes para tenerlo sin red; ver `Doc_Copias_Locales.md`). `403 abusive` si Drive lo marcó como malware; `403 pass_expired` o `pass_invalid`; `404 drive_missing` si Drive ya no lo tiene. |
| `GET /drive/status` | Cualquier sesión | `{ connected, broken, email, isOwner, folder, picker, features }`. `features`: lo que sabe hacer este portero además de lo de siempre: `folders` (desde v0.081; la app no ofrece soltar carpetas a uno anterior) y `verify`, `known`, `offline`, `codes` (`Doc_Copias_Locales.md`); un portero anterior no lo manda. `email` y `folder` (la carpeta elegida para `LGA_ShotDocs`, `{ id, name }`, o `null` si va en la raíz) solo se le muestran al dueño. `picker`: si está `GOOGLE_API_KEY`. |
| `POST /drive/connect` | Dueño | `{ return?: "/ruta" }` → la dirección de Google para conectar Drive. `return` es la ruta de la app a la que se vuelve (tiene que empezar con `/`). Solo desde una dirección de `APP_ORIGINS`. |
| `POST /drive/picker` | Dueño | `{ apiKey, appId, token }` para el selector de carpetas de Google: la clave de API, el número del proyecto de Google (el principio de `GOOGLE_CLIENT_ID`, antes del primer `-`) y un token de acceso nuevo, de una hora, solo con `drive.file`. `404` si no está `GOOGLE_API_KEY`. |
| `POST /drive/folder` | Dueño | `{ parentId: "<id>" \| null }`: guarda dónde va `LGA_ShotDocs` (`null` = la raíz) y, si la carpeta ya existe, la mueve ahí con todo lo que tiene adentro. Devuelve `{ folder }`. |
| `POST /upload` con `file` | Nivel 3 o más | `{ file: <id>, name, mime, size, day: "AAAA-MM-DD" }`. Una carpeta (P.9): `409 is_folder`. Abre una subida reanudable en `LGA_ShotDocs/<Proyecto>/<día>` y devuelve `{ uploadId }`; si ya está en Drive, `{ status: 'done', file, linked }`. `404` si no existe o no lo puede ver; `403` si lo ve pero no puede editar; `409` si la base lo tiene en un archivo de Drive sin su marca; `507 drive_full` si el Drive del dueño está lleno. Con `only: 'known'`, si el portero no recuerda la subida responde `{ status: 'unknown' }` sin crear la carpeta del día ni abrir nada (la app lo usa para un archivo cuya copia del dispositivo se liberó). |
| `POST /upload` sin `file` | Dueño | La prueba de media: abre una subida en `LGA_ShotDocs/Media_Test`. |
| `PUT /upload/<id>` | El que abrió la subida | Pasa una parte a Drive (`Content-Range: bytes a-b/total`), o, sin cuerpo y con `bytes */total`, pregunta cuánto llegó para retomar. Al terminar: `{ status: 'done', file }`; si es un archivo de una página, además `linked: true\|false` (si la base ya se enteró; la app lo marca subido solo con `true`). `507 drive_full` si el Drive se llenó (la subida queda y se retoma después). Con un id `f.…` (un archivo de una carpeta, P.9): el portero lo descifra, comprueba que sea de esta persona y de menos de 6 días (`410` si venció) y no guarda nada; al terminar responde `done` sin `linked` (no hay fila en la base). Si Drive pide ir más despacio, `503 rate`. |
| `POST /pass` con `file` | Nivel 1 o más | Una carpeta (P.9): `409 is_folder` (lo de adentro se lista). `{ file: <id> }` → `{ url, named: true }`: un pase para `/m/…`, siempre con el tipo y el nombre de `files` (un `type` o un `name` que mande la app no cuentan). `named: true` le dice a la app que este portero pone el nombre y entiende `?download=1` (un portero anterior responde solo `{ url }`). Comprueba que el archivo de Drive lleve la marca de ese archivo. Los errores traen un `code` fijo (la app decide por él, nunca por el número): `404 not_found` (sin fila o sin permiso), `409 not_uploaded` (todavía no terminó de subirse), `404 drive_missing` (Drive ya no lo tiene), `403 drive_mismatch` (Drive tiene ahí un archivo con la marca de otro), `409 drive_not_connected`. |
| `POST /verify` | Nivel 1 o más, por archivo | `{ files: [<id>…] }`, hasta 15 por pedido (`400 too_many` si son más): lo que dice Drive **hoy** de cada uno, sin usar lo comprobado antes: `{ results: { <id>: { driveId, size, trashed, marked, md5 } } }` (`marked`: lleva `appProperties.sdFile` de ese archivo; `md5`: el `md5Checksum` de Drive, o `null` si no lo da). Lo que falla de uno va en su lugar como `{ error, code }` (`not_found`, `not_uploaded`, `drive_missing`, `drive_failed`) sin cortar a los demás. `503 drive_not_connected` sin conexión con Drive. La app lo pide antes de liberar la copia de un dispositivo (`Doc_Copias_Locales.md`, sección 5.3). |
| `POST /folder/prepare` | Nivel 3 o más, y quien agregó la carpeta (`files.created_by`, desde la migración `20261001150000_carpetas_creador.sql`; sin ella, quien la creó en Drive): si no, `403 not_creator` | Carpetas (P.9, `Doc_Carpetas.md`). `{ file, name, dirs?, parents? }`: `file` es la fila de la carpeta (`mime = 'inode/directory'`). La primera vez crea `<Proyecto>/Carpetas/<nombre>` (si el nombre ya está, `_2`, `_3`…) con la marca `sdFile` y llama a `set_file_drive`. Después crea las subcarpetas de `dirs` (rutas relativas sin `..`, primero las de arriba, hasta 30); `parents` trae los ids de las de arriba creadas antes, y cada uno tiene que estar adentro del árbol (`403 outside` si no). Cada subcarpeta lleva `sdFolder` y `sdPath`: repetir un pedido no crea nada dos veces. → `{ root: { id, name }, dirs: { <ruta>: <id> } }`. |
| `POST /folder/sessions` | Nivel 3 o más, y quien creó la carpeta | `{ file, items: [{ dir, name, mime, size }] }`, hasta 30; `dir`: el id de la subcarpeta (adentro del árbol) o `null`. Abre una subida reanudable por archivo con el nombre, la carpeta y el peso fijados, y devuelve por cada uno `{ uploadId }` (la dirección de Google cifrada por el portero, con quién la abrió y cuándo; se usa con `PUT /upload/<id>` y vence a los 6 días), `{ done }` (un archivo vacío, ya creado) o `{ error: 'rate' }` (Drive pidió ir más despacio: pedirlo de nuevo después). No guarda nada por archivo. |
| `POST /folder/list` | Nivel 1 o más | `{ file, dir?, pageToken? }`: lo que hay ahora en la carpeta (o en la subcarpeta `dir`, adentro del árbol; si no, `404`), sin la papelera de Drive, hasta 100 por pedido (cada archivo lleva su pase firmado; 300 se midieron en ~9,5 ms de CPU en una computadora, al límite de los 10 ms del plan gratis: falta medirlo en Cloudflare). Las subcarpetas traen su id; cada archivo, su pase (`url`, 8 horas, con `m` = la fecha de cambio) y `thumb` si Drive tiene miniatura; los accesos directos y los documentos de Google, solo el nombre. → `{ entries, nextPageToken }`. `409 not_ready` si la carpeta todavía no se creó en Drive. **Con `dirs` en vez de `dir`** (hasta 40 ids de subcarpetas; las dos juntas dan `400`; lo que usa *Download all*): una sola consulta a Drive, `('a' in parents or 'b' in parents …) and trashed = false`, con `parents` entre los campos para agrupar la respuesta, y el mismo tope de 100 cosas (100 pases firmados) por pedido en total, no por subcarpeta. → `{ lists, failed, later, nextPageToken }`: `lists`, por cada subcarpeta aceptada, lo suyo en esa página (puede ser `[]`); `failed`, por cada una que no se puede listar, `not_found` (no existe, está en la papelera o no es del árbol: el mismo `404` de `dir`, sin mostrar nada de afuera); `later`, las que no entraron en el tope de llamados a Drive del pedido (36: se piden de nuevo; cada pedido avanza al menos una). Cada subcarpeta se comprueba una por una (`inTree`), salvo la comprobada hace menos de 60 s (la que Drive mostró adentro de otra ya comprobada): `dir` la sigue mirando siempre. Las páginas siguientes mandan el mismo `dirs` (solo las de `lists`: la consulta no cambia, Drive ata el `pageToken` a ella) y, si una ya no se puede comprobar, `409 changed` (la app empieza de nuevo ese grupo). Una app anterior que manda `dir` sigue igual; un portero anterior contesta a `dirs` sin `lists` y la app lista de a una. |
| `GET /t/<pase>` | Quien tenga el pase | La miniatura que hace Drive del archivo del pase (lado 320), por el portero (Drive no deja usarlas desde una página), con CSP `sandbox`; la guarda la caché de Cloudflare por archivo y fecha de cambio, y el navegador un día. |
| `POST /pass` con `fileId` | Dueño | La prueba de media: un pase para un archivo de Drive por su id. |
| `POST /trash` | Dueño o admin (lo decide la base) | `{ file: <id> }`: manda un archivo de la papelera de la app a la papelera de Drive (`PATCH files/<id>` con `trashed: true`; nunca lo borra). Con la sesión de la persona: `media_file`; Drive conectado y, si el archivo está en Drive, que lleve la marca de este (si algo de eso falla, no se le pide nada a la base y el archivo queda como estaba); `purge_file` (la base comprueba que sea dueño o admin con permiso sobre el proyecto y que el archivo esté en la papelera, y lo marca); `media_file` de nuevo (tiene que decir que está en la papelera y pedido); Drive; y al final `media_purged`. Devuelve `{ status: 'done', file, drive }`, con `drive`: `trashed` (quedó en la papelera de Drive), `missing` (en Drive ya no estaba) o `none` (todavía no está en Drive: si la subida seguía en curso, al terminar el portero lo manda solo a la papelera de Drive). Pedirlo de nuevo no hace nada de más. Los errores traen `{ error, code }` (tabla de abajo). |
| `POST /project/trash` | Dueño o admin que maneja el proyecto (lo decide la base) | `{ project: <id> }`: manda a la papelera de Drive la carpeta entera de un proyecto **borrado** (`LGA_ShotDocs/<Proyecto>`, con todo lo de adentro). P.14, entrega 2: sección de abajo. Devuelve `{ status: 'done', project, drive, folders }`, con `drive`: `trashed`, `missing` (Drive ya no la tenía) o `none` (nunca tuvo carpeta). |
| `POST /project/untrash` | Igual | `{ project: <id> }`: la trae de la papelera de Drive (para restaurar el proyecto, o *Look for its files again*). `drive`: `untrashed`, `none`, o `missing` (Drive, con la misma cuenta, no tiene ninguna: **la base no se toca**). |
| `GET /project/inspect?project=<id>` | Dueño | Solo mirar (la prueba técnica): las carpetas del proyecto en Drive con su estado en la papelera, las carpetas del día y sus archivos (`parents`, `explicitlyTrashed`, `appProperties.sdFile`) y el registro del portero. No cambia nada. |

### Con un link público (`Doc_Link_Publico.md`, 3.9)

Un pedido con el header `x-shotdocs-link` (y sin sesión) es de alguien que abrió un link: el portero acepta solo
`POST /pass`, `POST /verify`, `POST /folder/list` y `GET /drive/status`; lo demás da `403 link_denied` sin preguntarle
nada a la base. Pregunta `plink_media_file` (por `POST`, con la clave publicable y el header reenviado: la base valida
el link y cuenta el pase) en lugar de `media_file`, nunca reenvía un `Authorization` que venga en el pedido, y los
pases del link vencen a las 2 horas (también los de `/folder/list`; las cuentas siguen con 8). Un link revocado o
vencido da `401 link_not_found`; uno que llegó al tope del día, `429 link_rate_limited`. CORS acepta
`x-shotdocs-link` y `x-shotdocs-device`.

### Lo que se sirve (`/m/<pase>`)

Una sola función (`servedHeaders`) arma los encabezados de lo que viene de Drive y de lo que sale de la
caché del arranque (también el `206`):

- **Se muestra (`inline`) con su tipo** solo lo de esta lista: `image/*` menos SVG, `video/*`, `audio/*`,
  `application/pdf` y `text/plain`. **Todo lo demás** (HTML, XHTML, SVG, XML, JS, JSON, CSV, Office,
  comprimidos, ejecutables, `octet-stream`) sale como `Content-Type: application/octet-stream` y
  `attachment`: nunca corre como página en la dirección del portero. Las fotos y los videos nunca pasan a
  `octet-stream` (el `<img>` y el `<video>` de la app usan el mismo pase).
- `?download=1` pasa a `attachment` (con el tipo de la lista, si es de la lista).
- **CORS (desde v0.058):** a un pedido con `Origin` de `APP_ORIGINS`, todo lo que sale de `/m/` (`200`, `206`,
  también de la caché del arranque, `HEAD`, `416` y los errores) lleva `Access-Control-Allow-Origin` con ese
  origen y `Access-Control-Expose-Headers: Content-Length, Content-Range, Content-Type, Content-Disposition,
  ETag`; `Vary: Origin` siempre (la caché del navegador no le da a `fetch` la respuesta sin CORS que pidió un
  `<img>`). Otro origen no queda habilitado. El preflight (`OPTIONS`) deja pasar `Range`. Lo necesita la app
  para bajar el original con `fetch` y hacer la imagen nítida de la página (`Doc_Imagenes.md`, "Calidad en la
  página"); el `<img>`, el `<video>` y el carrete no mandan `Origin` y salen igual que antes, así que las
  versiones anteriores de la app no cambian. *Download all* de una carpeta (P.9, entrega 2, `Doc_Carpetas.md`) baja cada
  archivo de la lista con `fetch` por este mismo camino (también `/t/`), sin nada nuevo en el portero: el pase es la
  credencial. Con un portero anterior, esa bajada falla (CORS) y la página
  sigue con la miniatura; la app deja de intentar un rato (ver `Doc_Imagenes.md`).
- `Content-Disposition`: `inline` o `attachment` con `filename="…"` en ASCII (lo que no es ASCII, las
  comillas y las barras, `_`) y `filename*=UTF-8''…` (RFC 5987, también con `'()*` codificados). Al nombre se
  le sacan los controles y las marcas de dirección (U+202A–U+202E, U+2066–U+2069, U+200E, U+200F, U+061C:
  con U+202E, `gpj.exe` se lee `exe.jpg`). Un nombre de más de 255 caracteres se corta antes de la extensión y por
  grafema (`cutText`: nunca media bandera ni un emoji sin su tono), igual que el de las carpetas (200). Un pase viejo, sin nombre: `inline` o `attachment` solos.
- Siempre `X-Content-Type-Options: nosniff` y `Referrer-Policy: no-referrer` (el pase no se filtra desde
  los links de un PDF), y `Content-Security-Policy: sandbox` **menos en el PDF que se muestra**: el visor de
  PDF del navegador no carga en un documento con `sandbox`. Ese va sin CSP, con `nosniff`. No lleva
  `frame-ancestors 'none'` hasta probar a mano que el visor de Chrome, que ahora abre el PDF adentro de un
  marco propio, carga con él.

Códigos de error al ver y al subir (mismo formato `{ error, code }`):

| Status | `code` | Dónde | Qué pasó |
|---|---|---|---|
| 403 | `abusive` | `/m/<pase>` | Drive marcó el archivo como malware o spam (`cannotDownloadAbusiveFile`) y no lo deja bajar. No se pide `acknowledgeAbuse`. |
| 507 | `drive_full` | `POST /upload`, `PUT /upload/<id>` | El Drive del dueño está lleno (`storageQuotaExceeded`). La subida en curso queda guardada y se retoma cuando haya espacio. La app publicada lo reintenta como cualquier 5xx; la entrega 1b de adjuntos deja de reintentar con este código. |

Cualquier otro error de Drive sigue como siempre (`404` si no está, `502` lo demás).

Códigos de error de `/trash` (el campo `code`, para que la app decida sin leer el texto):

| Status | `code` | Qué pasó | Qué hace la app |
|---|---|---|---|
| 400 | `bad_request` | Falta el id o no es un uuid. | Error de la app. |
| 401 | `session_expired` (o sin `code`, si la sesión falla antes) | La sesión venció. | Volver a entrar. |
| 403 | `not_allowed` | No es dueño ni admin con permiso sobre el proyecto. | No ofrecer el botón. |
| 403 | `drive_mismatch` | El archivo de Drive al que apunta la base no lleva la marca de este: no se toca. | Mostrar el error; lo revisa el dueño. |
| 404 | `not_found` | No existe o la persona no lo ve. | Refrescar la lista. |
| 409 | `in_use` | Una página lo volvió a usar: ya no está en la papelera. | Refrescar la lista (el archivo salió). |
| 409 | `in_deleted_project` | Lo usa una página de un proyecto borrado (P.14, `purge_file` da `file_in_deleted_project`): vuelve si se restaura ese proyecto. | No ofrecer el botón (la app desde P.14 no lo ofrece; la anterior recibe este motivo en vez de `db_error`). |
| 503 | `drive_not_connected` | Drive no está conectado (o la conexión venció). No se pidió nada a la base. | Avisar que el dueño conecte Drive. |
| 502 | `drive_failed` | Drive no contestó bien. Si ya se había pedido, queda pedido sin confirmar. | Reintentar más tarde. |
| 502 | `db_outdated` | La base no tiene la migración de la papelera de archivos. | Avisar. |
| 502 | `db_error` | La base no contestó bien. | Reintentar más tarde. |

Si un dueño o admin manda a la papelera un archivo cuya subida sigue en curso (`drive: 'none'`), cuando la
subida termina el portero manda lo subido a la papelera de Drive y lo confirma con `media_purged`, con la
sesión de quien subió (la base se lo permite a quien edita el archivo). Si en ese momento Drive falla, la
subida termina igual y el archivo queda en Drive sin ir a la papelera (no se pierde nada): pedir `/trash` de
nuevo para ese archivo lo termina (la app ya no lo muestra en la papelera, así que es un caso a mano).

### La carpeta de un proyecto borrado (P.14, entrega 2)

Diseño completo: `Doc_Proyectos_Borrar.md`, secciones 3.3 a 3.9. Con la casilla de la ventana de borrar, después de
que la base lo borra, la app pide `POST /project/trash`; para restaurarlo, primero `POST /project/untrash` (la base lo
exige: `restore_project` da `drive_untrash_first`). Con la sesión de la persona y la migración 10
(`20261005120000_proyectos_drive.sql`):

- **Quién y cuándo** lo decide la base: `media_project` (nulo si la sesión no es dueño o admin que maneja el proyecto:
  `404 not_found`, sin decir si existe), `request_project_drive_trash` (solo con el proyecto borrado),
  `project_drive_trashed` y `project_drive_untrashed`. La base guarda el estado en el proyecto, no en cada archivo.
- **Cuáles son sus carpetas:** la que recuerda el portero (`project:<id>`), las de su registro y las que encuentra Drive
  con `appProperties has { key='sdProject' and value='<id>' }` (con `drive.file`, Drive solo devuelve lo que creó la
  app). Una carpeta se toca solo si lleva la marca del proyecto; si la recordada no la lleva, al mandar: `403
  drive_mismatch` **antes** de pedirle nada a la base (el proyecto se sigue pudiendo restaurar); al traer, se la deja
  afuera.
- **El registro `projectTrash:<id>`** (`{ email, requestedAt, folders, result }`): se escribe **antes** de cada `PATCH`
  y se acumula. Así, si Drive cumple y la respuesta se pierde, el reintento la cuenta como ya mandada y traer la
  trae. `email` es la cuenta de Google conectada al mandar: con otra cuenta conectada, las dos rutas responden `409
  drive_other_account` sin tocar nada (y la app no ofrece restaurar sin los archivos). Se borra cuando la carpeta
  vuelve.
- **Ya mandadas:** al mandar, una carpeta con la marca que ya está en la papelera cuenta como mandada por este pedido
  si está en el registro o si su `trashedTime` es posterior al pedido menos 5 minutos (`CLOCK_MARGIN_MS`: los relojes
  de Google y de la base pueden no coincidir). **Al traer**, se trae la unión del registro y de las de la búsqueda que
  fueron a la papelera desde el pedido (no una vieja que ya estaba ahí). Para responder `untrashed` (y que la base borre
  sus marcas) cuentan solo las carpetas de ese pedido: las del registro, las que se traen y una viva creada antes del
  pedido. Una viva creada después (la que arma el portero en la primera subida tras restaurar sin la carpeta) no
  cuenta: sin ninguna del pedido, la respuesta es `missing` y la base no se toca. Google documenta `trashedTime` solo para las
  unidades compartidas: si no viene, la carpeta cuenta como del pedido (traer de más nunca pierde nada; lo mide la
  prueba técnica).
- **Mandar y traer de un mismo proyecto van de a uno** en el Worker. Si lo restauraron mientras se mandaba (la base
  responde `project_drive_not_requested` al confirmar), lo que se mandó en ese pedido vuelve y la respuesta es `409
  project_restored`.

Códigos de error de `/project/trash` y `/project/untrash`:

| Status | `code` | Qué pasó | Qué hace la app |
|---|---|---|---|
| 400 | `bad_request` | Falta el proyecto o no es un uuid; o un modo de prueba que no existe o que no pidió el dueño. | Error de la app. |
| 401 | `session_expired` | La sesión venció. | Volver a entrar. |
| 403 | `not_allowed` | La base no lo deja (no es dueño ni admin que lo maneja). | "Solo el dueño o un admin…". |
| 403 | `drive_mismatch` | La carpeta recordada no lleva la marca del proyecto: no se tocó nada. | Mostrar el error; lo revisa el dueño. |
| 404 | `not_found` | No existe, o la sesión no puede mandar ni traer su carpeta. | Como `not_allowed`. |
| 409 | `project_not_deleted` | Mandar la carpeta de un proyecto que no está borrado. | No debería pasar (la app borra antes). |
| 409 | `nothing_to_untrash` | Traer la de un proyecto que nunca la mandó. | Restaurar directo. |
| 409 | `drive_other_account` | Drive está conectado a otra cuenta de Google que la que se usó para mandarla. Nada se tocó. | Pedir que se conecte la de antes; **no** ofrecer restaurar sin los archivos. |
| 409 | `project_restored` | Lo restauraron mientras se mandaba: lo mandado volvió. | Avisar. |
| 503 | `drive_not_connected` | Drive no está conectado (o venció la conexión). No se pidió nada a la base. | Avisar que el dueño conecte Drive. |
| 502 | `drive_failed` | Drive no contestó bien (o la red). El pedido queda sin confirmar y el registro con lo intentado. | Repetir: termina sin perder ninguna. |
| 502 | `db_outdated` | La base no tiene la migración 10. | Avisar. |
| 502 | `db_error` | La base no contestó bien. | Reintentar más tarde. |

**Modos de prueba (solo el dueño, y solo con la variable `TEST_MODES=1` en el Worker; para la prueba técnica,
sección 3.9):** `POST /project/trash { project, test: 'lost_response' }` manda la primera carpeta y responde `502
drive_failed` sin confirmar en la base (el estado exacto de una respuesta perdida); `test: 'lost_registry'` (en las dos
rutas) hace el pedido sin el registro ni la carpeta recordada, solo con la búsqueda por la marca (al mandar, borra de
verdad el registro de ese proyecto). Sin la variable, cualquier `test` responde `400 bad_request`, también al dueño.

- **Prenderlos para la prueba técnica:** Cloudflare → Workers → `shotdocs-portero` → Settings → Variables and Secrets →
  agregar `TEST_MODES` (texto) con el valor `1` y guardar (se publica sola).
- **Apagarlos al terminar:** borrar la variable `TEST_MODES` (o dejarla vacía) y guardar. Como `keep_vars` está
  prendido, publicar el portero no la toca: hay que sacarla a mano.

La app manda partes de 8 MiB (`PART_BYTES` en `src/media/portero.ts`); el portero acepta hasta 64 MiB por
parte (`MAX_CHUNK`) y rechaza la que no coincide con la subida. El permiso para subir se mira al abrir la
subida, no en cada parte (una subida dura minutos); al terminar, la base lo vuelve a mirar en
`set_file_drive`. Si `day` no viene, se usa el día de hoy en UTC.

### Lado de la app

- `src/media/portero.ts`: el cliente del portero (estado de Drive, conectar, subir por partes retomando lo
  que ya llegó, pedir pases y mandar a la papelera de Drive, `trash`). Lee la dirección de
  `workspace_settings.media_url`.
- `src/media/queue.ts` (`MediaQueue`): sube los archivos de a uno, y sigue con el siguiente cuando una
  subida se traba (ver "Subidas que se traban").
- `src/ui/DriveDialog.tsx`: el diálogo *Google Drive* del menú de la cuenta (conectar, reconectar y
  dónde va la carpeta).
- `src/media/folderUpload.ts` (`FolderUploads`): la cola de las carpetas (P.9), aparte de la de los archivos
  sueltos; `src/ui/FolderViewer.tsx`, el visor. Ver `Doc_Carpetas.md`, "Cómo quedó".
- Pruebas (entran en `npm test`): `portero/src/core.test.ts` (el Worker, con Drive y Supabase simulados),
  `portero/src/folders.test.ts` (las carpetas y la regla de no salir del árbol),
  `src/media/portero.test.ts` (el cliente) y `src/media/queue.test.ts` (la cola). Los tipos del portero se
  revisan aparte, con `npx tsc -p portero --noEmit` (`npm run typecheck` no los cubre).

### Subidas que se traban (v0.068 y v0.092)

**Qué pasaba.** La cola sube de a un archivo y ningún pedido al portero tenía tiempo límite. Un pedido que
nunca contestaba, sin error de red, dejaba la cola entera esperando: visto al importar un doc de unos 2300
archivos, 5 a 9 minutos sin subir nada, la barra en 0 % y en la base un archivo registrado sin `drive_id`,
hasta que el navegador o Cloudflare cortaban la conexión. Por qué se cuelga ese pedido (Drive, el Worker o
la red) no se encontró.

**Lento no es colgado.** Lo que distingue una cosa de la otra es si siguen saliendo bytes, y `fetch` no lo
dice: no avisa nada hasta que llega la respuesta. Por eso las partes se mandan con `XMLHttpRequest`
(`xhrSend`), que avisa cuántos bytes del cuerpo van saliendo (`upload.onprogress`). Un tope por tiempo para
la parte entera no sirve: con una red lenta una parte de 8 MiB tarda más que cualquier tope razonable, se
corta, se manda entera otra vez y se vuelve a cortar.

| Pedido | Se corta cuando | Constante |
|---|---|---|
| Abrir la subida (`POST /upload`) y preguntar cuánto llegó (`bytes */total`) | Pasa 1 minuto sin respuesta | `CONTROL_TIMEOUT_MS` |
| Una parte, mientras sale | Pasan 2 minutos sin que salga **ni un byte** más | `STALL_MS` |
| Una parte, ya enviada entera | La respuesta tarda más que su plazo (`answerLimit`: 2 minutos, 2 más por cada trabada seguida anterior, o lo aprendido de una respuesta lenta anterior) más lo que tardó en salir el cuerpo sin contar una suspensión (hasta 2 minutos más) | `STALL_MS` |

- Los pedidos de control casi no llevan cuerpo: tardan lo que tardan el portero y Drive (segundos), no lo
  que da la red. Un minuto sin respuesta es un pedido colgado.
- La parte no tiene tope: tarda lo que tarde mientras se mueva. Dos minutos sin un byte ya no es una red
  lenta, y es la mitad o menos de lo que tardaba en cortar solo el navegador.
- Con el cuerpo afuera ya no hay bytes que avisen: falta que el portero le pase la parte a Drive y Drive
  la guarde (segundos). El plazo se estira con lo que tardó el cuerpo porque parte de lo que el navegador
  da por enviado puede seguir en camino (medido en Chromium: da por enviado medio megabyte que el servidor
  todavía no leyó), y con una red lenta eso también tarda más.
- **Si el cuerpo sale de golpe** (un antivirus que revisa HTTPS o un proxy lo reciben entero y lo suben
  ellos, despacio), el navegador no ve nada de la subida de verdad y una parte lenta se cortaría siempre
  en el mismo lugar. Por eso cada trabada seguida sin avance le da 2 minutos más al intento siguiente
  (`stalledBefore`): lento termina pasando. El techo es lo que tardaría la parte entera a 16 KiB/s, la
  misma red lenta de los topes de la base: 10 minutos y medio para una parte de 8 MiB, 5 para una foto
  de 3 MB. Más lento que eso y con el cuerpo tragado de golpe, la parte no pasa: es el único caso que
  queda sin cubrir.
- **Se recuerda el plazo que funcionó** (v0.092, `Portero.learn`). Sin eso, detrás del mismo proxy cada archivo
  nuevo volvía a empezar con el plazo corto y se trababa una o más veces antes de pasar. Cuando la respuesta de
  una parte llega después de un minuto o más con el cuerpo ya afuera (`LEARN_FROM_MS`), el cliente anota a qué
  velocidad llegó (bytes por segundo, sin el tiempo suspendido) y el plazo de las partes siguientes es lo que
  tardarían a esa velocidad más 2 minutos, con el mismo techo. Solo aprende de partes de 1 MiB o más
  (`LEARN_MIN_BYTES`): en una foto chica casi todo es la espera fija, y escalada a una parte de 8 MiB daría minutos
  de más. Una respuesta rápida de una de esas lo olvida. Vale para el cliente de la sesión (la cola y las carpetas comparten el mismo): al recargar se vuelve a
  aprender.
- Donde no hay `XMLHttpRequest`, o con un `fetch` propio (las pruebas del cliente), las partes van por
  `fetch` y **no se vigilan**: sin saber cuántos bytes salieron, cortar por tiempo cortaría las lentas.
  Los pedidos de control sí tienen su tope.
- El vigilante mira cada 5 segundos (`STALL_CHECK_MS`). Solo cubre los pedidos de una subida: `pass`,
  `trash` y los del diálogo de Drive siguen sin tope.
- **Equipo suspendido.** Si entre dos miradas pasa más de un minuto y medio (`FROZEN_GAP_MS`), el equipo
  estuvo suspendido o la pestaña congelada: ese tiempo no se cuenta, y al despertar una parte sana no se
  corta. El umbral no puede ser más chico: con la pestaña en segundo plano el navegador deja correr los
  temporizadores una vez por minuto, y ahí el vigilante tiene que seguir cortando (tarda hasta un minuto
  más en darse cuenta). Desde v0.092 se descuentan **a lo sumo dos huecos seguidos** sin que el pedido se mueva
  (`FROZEN_DISCOUNTS`): una pestaña tan frenada que el vigilante mira menos de una vez por minuto y medio hacía que
  cada hueco pareciera una suspensión y no cortaba nunca. Un movimiento vuelve a dar los dos. Y el tiempo
  suspendido tampoco cuenta como tiempo del cuerpo: si el equipo se suspendía mientras salía, la espera de la
  respuesta quedaba hasta 2 minutos más larga.

**Qué pasa al cortarse.** El pedido cortado no se reintenta en el momento (cada intento podría tardar lo
mismo): la subida termina con un `UploadError` con `stalled`, el archivo queda con el aviso *The upload
stopped moving; it will try again* y vuelve a la cola con la espera de cualquier error que se arregla solo
(10 s, 20 s… hasta 10 minutos), y la cola sigue con los demás archivos. No se pierde nada: el original
sigue en el dispositivo y lo que Drive ya recibió sigue en la subida.

**Colgado para todos (v0.092).** Si el portero no contesta a nadie, seguir con el archivo siguiente no sirve:
cada uno esperaba su minuto entero, y una vuelta por 2300 archivos duraba horas sin subir nada. Por eso, a la
**segunda trabada seguida de archivos distintos sin avance** (`STALLS_TO_CLOSE_ROUND`, en `src/sync/types.ts`) la
vuelta deja de subir archivos, como sin conexión, y la cola espera antes de volver a probar (`stallPause` en
`queue.ts`: 10 s, 20 s… hasta 10 minutos, cada vez que vuelve a pasar). Cuenta igual una miniatura que Storage no
contestó (`Doc_Sincronizacion.md`, "Cada consulta a la base tiene un tope de tiempo").

- Una sola trabada no corta: puede estar colgado solo ese archivo, y cortar haría que la vuelta siguiente empezara
  otra vez por él. Y los que ya se trabaron (`stalls` o `thumbStalls` mayor que 0) van **después** de los demás:
  si no, dos archivos colgados solo para ellos irían siempre primero, cerrarían cada vuelta y el resto no subiría
  nunca (lo encontró la auditoría).
- Una trabada **después de avanzar** no cuenta: el portero anda, aunque despacio. Un archivo que termina de subir,
  o cualquier avance, vuelve a cero la cuenta y la espera. Una carpeta registrada o un HEIC que espera su
  decodificador no cuentan para nada: no hablaron con el portero ni con Storage.
- Un archivo nuevo acorta la espera a la más corta (10 s), sin volver la cuenta a cero: si el portero ya anda, la
  foto sube enseguida; si sigue colgado, la espera siguiente es más larga.
- Los archivos que no se probaron quedan como estaban, sin error ni espera propia. Los usos de páginas
  (`link_page_file`, `unlink_page_file`) salen igual en esa vuelta: van a la base, no al portero.
- Mientras la cola espera, no hay nada "para subir ahora" (`hasUploadableNow`): las bajadas de "Available offline"
  no se quedan esperando a las subidas.
- La espera se levanta sola al pasar su plazo, y antes cuando vuelve la red (el evento `online`, o la base
  contesta después de un ciclo sin conexión) y con *Retry* (que se ve solo si hay algo detenido). Un plazo más
  largo que la espera más larga posible (el reloj del equipo saltó hacia atrás) se da por vencido. Vive en
  memoria: al recargar, se prueba de nuevo.
- **Mientras la cola espera, se registra y se suben las miniaturas** (v0.0XX, `prepareWhilePaused`): lo que no le
  pide nada al portero sigue. Los archivos todavía sin registrar se registran en la base y, si la espera no fue por
  Storage (`stallPause.storage`: alguna de las trabadas que cerró la vuelta fue una miniatura), se suben sus
  miniaturas; los otros dispositivos ya los ven, con su miniatura, y el original sale cuando el portero vuelve. Si una
  miniatura se traba ahí, lo que queda solo se registra. Sin red o con la app vieja, se corta como siempre. Es el
  mismo camino de `process` hasta antes de leer el original (`beforeOriginal`).
- **Las carpetas (P.9) cierran la vuelta igual** (v0.0XX): una trabada no gasta intentos, después de una no se empieza
  otro archivo hasta que los que están en curso terminen o se traben, y a la segunda la cola de la carpeta espera
  (`stallWait`, la misma escala). Detalle en `Doc_Carpetas.md`, "Cómo quedó (entrega 3)".

**Al retomar** siempre se le pregunta primero a la subida que quedó (`bytes */total`):

- Ya terminó (la última parte había llegado y la respuesta se perdió): el portero lo dice y no se manda
  nada más. Nunca se abre otra subida sin preguntar, que es lo que dejaría el archivo dos veces en Drive.
- Recibió algo: se sigue con ella desde ahí, siempre. Una subida que ya recibió bytes anda; si de verdad
  se perdió, Drive lo dice (404 o 410) y recién entonces se empieza de nuevo.
- No recibió nada y van dos trabadas seguidas (y después cada dos: `STALLS_BEFORE_RENEW`): se abre otra
  (`renewIfEmpty`), por si la que se cuelga es esa. No se pierde nada, porque no tenía nada.
- La pregunta tampoco contesta: no se abre otra (no se sabe si la que hay terminó). El archivo sigue
  pendiente con el aviso y se vuelve a preguntar más tarde.

Preguntar primero evita la copia de más en casi todos los casos, no en todos. Si algo en el medio (un
proxy, un antivirus) recibió el cuerpo entero y lo sigue mandando después de que la app cortó el pedido,
la subida vieja contesta que no recibió nada, se abre otra y la vieja termina más tarde: queda **una copia
de más en el Drive**. No se pierde nada, la base apunta a una sola y el portero lo tolera; la copia de más
la ve el dueño en la carpeta del día.

`MediaRecord.stalls` cuenta las trabadas **seguidas y sin avance**: vuelve a 0 cuando el portero confirma
más bytes y cuando el archivo termina de subir (abrir otra subida no es avanzar). Es un campo nuevo y
opcional: lo guardado por una versión anterior no lo tiene y vale 0. Con el mismo avance vuelve a 0
`failures`, de donde sale la espera para reintentar: un video largo al que le llega una parte más en cada
vuelta vuelve a intentar a los 10 segundos, no cada vez más tarde. Avanzar es que el portero confirme **más de lo
que ya había confirmado de ese archivo** (v0.092): si el portero pierde la subida en cada vuelta y se empieza otra,
volver a mandar lo que la perdida ya tenía no es avanzar, y la espera se alarga (antes reintentaba siempre a los
10 s).

**Probado a mano en Chromium 152** contra un portero de mentira en otro origen (con el mismo CORS): tres partes
por `XMLHttpRequest` llegan intactas; una parte leída a 256 KB/s (que tarda ocho veces el plazo) no se
corta; un servidor que no lee el cuerpo, que deja de leerlo a la mitad, que no contesta la parte o que no
contesta al abrir la subida se cortan y el navegador aborta el pedido (con la pestaña en segundo plano: a
los 60 segundos al abrir y a los 125 la parte); al retomar no se manda nada dos veces. Falta verlo en
Safari de iPhone y con una red lenta de verdad.

**"Colgado para todos", probado en Chromium (v0.092)** con la cola real, las partes por `XMLHttpRequest` y las
miniaturas por el cliente de Supabase real, contra un portero y un Storage locales que reciben el pedido y no
contestan nunca: con el portero colgado y 4 fotos, la vuelta terminó a los 120 s con 2 subidas abiertas (no 4) y
los 2 pedidos cortados por el navegador; una vuelta enseguida no volvió a probar; al volver el portero subieron las
4, una subida por archivo. Con Storage colgado y 3 fotos, la vuelta terminó a los 67 s con 2 miniaturas pedidas
(no 3) y las 2 subidas cortadas por el navegador (no quedan sueltas); al volver, las 7 miniaturas quedaron una vez
cada una en el bucket.

**La miniatura (v0.070).** Los dos pedidos de la miniatura a Supabase Storage (subirla antes del original
y bajar, al final de cada vuelta, las de otros dispositivos) no pasan por el portero y no tenían tope: si
el que se colgaba era uno de esos, la cola esperaba igual que antes. Ahora tienen uno proporcional al
tamaño, y al vencer el archivo vuelve a la cola como una subida trabada. Detalle en
`Doc_Sincronizacion.md`, "Cada consulta a la base tiene un tope de tiempo".

**"Colgado para todos", entrega 3 (v0.0XX), probado en Chromium** con la cola real y el cliente del portero de
verdad (partes por `XMLHttpRequest`) contra un portero local que recibe el pedido y no contesta (la base y las
miniaturas, en memoria): con 4 fotos, la vuelta se cerró a los 120 s con 2 subidas abiertas, y las otras 2 quedaron
registradas y con su miniatura, sin error; una foto nueva durante la espera se registró con su miniatura sin abrir
ninguna subida; al volver el portero subieron las 5, una vez cada una.

**Lo que queda afuera** (anotado en `Doc_Roadmap.md`, B.11): probarlo en Safari de iPhone y con una red lenta de
verdad.

### Carpetas: nunca hacia arriba (P.9)

Con `drive.file` (hoy) el portero ve solo lo que creó la app; con `drive.readonly` (si Lega lo decide) vería
todo el Drive del dueño. Por eso la regla de no salir de la carpeta es **código del portero** y no depende del
permiso de Google: todo id de Drive que manda la app (una subcarpeta para listar, una para subir, la de arriba de
una subcarpeta nueva) se comprueba subiendo por sus `parents` hasta la carpeta de la app (`inTree`). Lo
comprobado se recuerda 10 minutos en la memoria de la instancia, con una llave fija (`memoryKey` de `index.ts`;
cada pedido crea su propio stub del Durable Object, que en Cloudflare queda atado al pedido que lo creó). La
subcarpeta que se pide listar se vuelve a mirar en Drive siempre: una que el dueño mandó a la papelera o movió afuera
deja de listarse en el acto; lo que está adentro de ella, a más tardar a los 10 minutos. En el listado de varias, la
subcarpeta pedida que se movió afuera deja de listarse a más tardar al minuto, también en sus páginas siguientes
(`LIST_TRUST_MS`); lo de adentro de una subcarpeta de arriba movida afuera, igual que en el de una, hasta los 10
minutos de su comprobación (medido en la auditoría de la entrega 3). Un 403 de Drive por el límite de pedidos
no es "afuera": sale como `503 rate` (v0.0XX). La última parte de cada
archivo de una carpeta vuelve a preguntarle a la base si la persona todavía puede subir ahí: sacada de la página, la
subida queda sin terminar.
La raíz del Drive, un ciclo, algo que no es una carpeta (un acceso directo), algo en la papelera, una carpeta con
dos padres o 30 niveles: no. Sin acceso a la página, todo da `404` como si no existiera.

## Publicarlo y conectarlo (una vez por workspace)

Hace falta la app ya publicada y la migración `20260930120000_portero.sql` aplicada. Para los archivos de
las páginas, además, la migración de archivos (`20260930150000_archivos.sql`, con `media_file` y
`set_file_drive`); sin ella, lo de la prueba de media sigue andando y lo de los archivos responde
*"The workspace database is not up to date for files yet."* Para la papelera de archivos, la migración
`20260930180000_papelera_archivos.sql` (`purge_file` y `media_purged`); sin ella, `/trash` responde *"The
workspace database is not up to date for the file trash yet."* y no toca Drive.

### 0. Antes de publicar: la prueba en `workerd`

Las pruebas de `portero/src/*.test.ts` corren `core.ts` con un almacenamiento en memoria y **no pasan por
`index.ts`** ni por el Durable Object. Antes de publicar un cambio del portero, correr desde la raíz del repo:

```
node scripts/portero-smoke.mjs
```

Levanta el portero con `wrangler dev` (local: `workerd` y el Durable Object en una carpeta temporal, sin cuenta
de Cloudflare ni red; la primera vez `npx` baja `wrangler`) y le manda varios pedidos seguidos (pases inválidos que
leen el Durable Object, el estado sin sesión, un listado de carpeta (y uno de varias subcarpetas) sin sesión, el preflight, un pase desde el origen
de la app (con CORS) y desde otro (sin), la salud). Falla si
alguno da otra cosa, por ejemplo un `500`: así se vio que guardar el stub del Durable Object entre pedidos rompe
todo desde el segundo pedido ("Cannot perform I/O on behalf of a different request"). `PORTERO_SMOKE_PORT` cambia
el puerto (4198) y `PORTERO_SMOKE_WRANGLER` la versión (`wrangler@4.146.0`, que conoce la `compatibility_date` del portero: si se sube esa fecha, subir también esta versión).

**Pendiente de medir en Cloudflare (P.9):** el CPU de `/folder/list` con 100 archivos (panel del Worker →
Metrics), y la caché de las miniaturas: `caches.default` no guarda nada en una dirección `*.workers.dev` (sí con un
dominio propio), así que ahí cada miniatura cuesta dos llamados a Drive; y cada `/t/` lee el Durable Object (la
clave de los pases y el token), cuando el diseño decía cero. Lejos de los límites del plan gratis.

### 1. Publicar el portero en Cloudflare

1. En Cloudflare: **Compute → Workers & Pages → Create → Import a repository**, el mismo repo de la app.
2. Nombre: `shotdocs-portero` (tiene que ser exactamente ese). En las opciones avanzadas: **Root
   directory / Path: `portero`**, y **Build watch paths: `portero/*`** (así los cambios de la app no vuelven
   a publicar el portero). Build command: vacío. Deploy command: `npx wrangler deploy`.
3. Deploy. Queda en una dirección `https://shotdocs-portero.<tu-subdominio>.workers.dev`: anotarla.
4. En el Worker → **Settings → Variables and Secrets** (las del Worker, no las del build), agregar:
   - `SUPABASE_URL` (texto): la dirección del Supabase del workspace (en Supabase: el proyecto → botón
     **Connect**, o *Project Settings → API*; es la que termina en `.supabase.co`).
   - `SUPABASE_PUBLISHABLE_KEY` (texto): la clave publicable (*Project Settings → API Keys*, la que empieza
     con `sb_publishable_`). Las dos son las mismas que usa la app al publicarse.
   - `APP_ORIGINS` (texto): las direcciones de la app separadas por comas, sin barra al final (por ejemplo
     `https://shotdocs.lega.com.ar,https://shotdocs.<tu-subdominio>.workers.dev`).
   - `GOOGLE_API_KEY` (**Secret**, opcional): la clave del selector de carpetas (paso 2b). Sin ella, la
     carpeta de la app va a la raíz del Drive.

   Las variables cargadas en el panel no se borran al publicar (`keep_vars` en `portero/wrangler.jsonc`).

### 2. Crear el cliente de Google (Google Cloud)

1. En https://console.cloud.google.com, crear un proyecto (por ejemplo `LGA Shot Docs`).
2. **APIs & Services → Library → Google Drive API → Enable.**
3. **Google Auth Platform** (antes "OAuth consent screen") **→ Get started**: nombre de la app, correo de
   soporte, público **External**, correo de contacto → Create.
4. **Data Access → Add or remove scopes**: marcar `openid`, `.../auth/userinfo.email` y
   `https://www.googleapis.com/auth/drive.file` (si no aparece en la lista, pegarlo en *Manually add
   scopes*). Guardar.
5. **Audience → Publish app** para que quede **In production**. En "Testing" la conexión con Drive vence a
   los 7 días.
6. **Clients → Create client → Web application.** En *Authorized redirect URIs* poner
   `https://shotdocs-portero.<tu-subdominio>.workers.dev/drive/callback` (la del paso 1.3). Create.
7. Copiar el **Client ID** y el **Client secret** en ese momento (o tocar *Download JSON*): Google muestra
   el secreto **una sola vez**. Si se pierde, se crea otro secreto en el mismo cliente.
8. De vuelta en el Worker → Variables and Secrets: `GOOGLE_CLIENT_ID` (texto) y `GOOGLE_CLIENT_SECRET`
   (**Secret**). Guardar.

### 2b. Clave para el selector de carpetas (`GOOGLE_API_KEY`, opcional)

Con ella, el dueño elige con el selector de Google en qué carpeta de su Drive va `LGA_ShotDocs`. Sin ella,
va a la raíz (*My Drive*). Se hace en el **mismo proyecto** de Google Cloud del paso 2.

1. En https://console.cloud.google.com, arriba a la izquierda, elegir el proyecto (por ejemplo
   `LGA Shot Docs`).
2. **APIs & Services → Library**, buscar **Google Picker API**, abrirla y tocar **Enable**.
3. **APIs & Services → Credentials → + Create credentials → API key.** Google crea la clave y la muestra:
   copiarla (se puede volver a ver después con *Show key*).
4. Tocar el nombre de la clave nueva (o *Edit API key*) para restringirla:
   - **Name**: `LGA Shot Docs picker`.
   - **Application restrictions → Websites**, y en *Website restrictions* agregar cada dirección de la app
     con `/*` al final, una por renglón (las mismas de `APP_ORIGINS`), por ejemplo
     `https://shotdocs.lega.com.ar/*` y `https://shotdocs.<tu-subdominio>.workers.dev/*`.
   - **API restrictions → Restrict key**, y en la lista marcar solo **Google Picker API**.
   - **Save.** Las restricciones tardan hasta 5 minutos en valer.
5. En Cloudflare: el Worker `shotdocs-portero` → **Settings → Variables and Secrets → + Add**. Type:
   **Secret**. Variable name: `GOOGLE_API_KEY`. Value: la clave. **Deploy** (o *Save*).

El número del proyecto que usa el selector no hace falta cargarlo: es el principio del Client ID (los
números antes del primer `-`). La clave y un token de una hora llegan al navegador del dueño (así funciona
el selector de Google): por eso la clave queda restringida al selector y a las direcciones de la app.

### 3. Decirle a la app dónde está el portero

En Supabase → SQL Editor (lo hace el dueño de la base):

```sql
update public.workspace_settings set media_url = 'https://shotdocs-portero.<tu-subdominio>.workers.dev';
```

### 4. Conectar Drive

En la app, con la cuenta del dueño: menú de la cuenta → **Google Drive → Connect Google Drive**. Elegir la
cuenta de Google cuyo Drive va a usar el workspace. Si Google avisa que la app no está verificada:
*Advanced → Go to …* (es tu propia app). Al aceptar, vuelve a la app con "Connected".

Mejor hacerlo desde la computadora: la conexión queda en el portero y vale para todos los dispositivos.

Si está `GOOGLE_API_KEY` (paso 2b), después se puede elegir con el selector de Google en qué carpeta va
`LGA_ShotDocs`. Si la carpeta ya existe, el portero la mueve ahí con todo lo que tiene adentro; no crea
otra.

## Si algo falla

- *"The connection with Google Drive stopped working"*: el dueño revocó el acceso, cambió la contraseña,
  pasaron 6 meses sin uso, o la app de Google sigue en modo **Testing**, donde la conexión vence a los 7
  días. Volver a conectar desde el menú de la cuenta → *Google Drive*. Lo del modo Testing se evita publicando la app en Google
  (paso 2.5, *In production*; ver `Doc_Roadmap.md`).
- *"This app address is not allowed"*: la dirección desde la que se abrió la app no está en `APP_ORIGINS`.
- Google dice `redirect_uri_mismatch`: la dirección del paso 2.6 no coincide con la del portero.
- Vuelve con *"drive-permission-missing"*: en la pantalla de permisos de Google quedó destildado el acceso
  a Drive. Conectar de nuevo y dejarlo marcado.
- *"The folder where "LGA_ShotDocs" goes is not available anymore: choose another one."*: la carpeta que
  eligió el dueño se borró o ya no se puede abrir. Elegir otra (o la raíz) desde la app.
- El selector de Google dice que la clave no es válida (*The API developer key is invalid*): revisar que la
  Picker API esté habilitada, que la dirección desde la que se abrió la app esté en *Website restrictions*
  (con `/*`) y esperar 5 minutos después de cambiar las restricciones. Si sigue, agregar también **Google
  Drive API** en *API restrictions* de la clave.
- *"This file has not finished uploading yet."*: el archivo está registrado pero todavía no terminó de
  subir desde el dispositivo que lo agregó.
- *"Google Drive flagged this file as malware or spam…"* (`abusive`): Drive no deja bajarlo. Lo ve el
  dueño en su Drive.
- *"The Google Drive of the workspace owner is full…"* (`drive_full`): liberar espacio en ese Drive; las
  subidas pendientes siguen desde donde quedaron.
- *"This file in Google Drive does not belong to this file of the app."*: la base apunta a un archivo de
  Drive que no tiene la marca de ese archivo; el portero no lo sirve.
- Otro workspace (otro dueño) publica su portero importando su propia copia del repo (un fork).
- Los registros del portero están en Cloudflare → el Worker → **Logs**.
