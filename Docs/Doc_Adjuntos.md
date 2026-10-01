# Adjuntar cualquier archivo en las páginas (P.6)

Estado: **entregas 1a (portero, v0.048), 1b (app, v0.049) y 2 (vista previa y tarjeta grande en el carrete, ver "Cómo
quedó (entrega 2)") hechas**. "Correcciones de la auditoría previa" manda sobre lo anterior; la sección 4 manda sobre
la propuesta original de la vista previa. Lo pidió Lega: "intenté
arrastrar un PDF y no funcionó. Deberíamos poder arrastrar cualquier tipo de archivo, como una interfaz del
Drive: .zip, .rar, lo que sea, y que alguien lo pueda bajar desde ahí". Sale de leer el código de la rama
`lega/acomodar`.

## Qué se pide

1. Arrastrar, pegar o elegir **cualquier archivo** (PDF, .zip, .rar, .exe, .psd, .nk…). Va al Drive del dueño,
   igual que las fotos.
2. En la página se ve como una **tarjeta con ícono** según el tipo, con nombre y tamaño.
3. **Clic:** el primero elige y el segundo abre, como las fotos desde v0.044. Un PDF (o lo que el navegador
   sepa mostrar) se abre en una **pestaña nueva**; un .zip, un .exe y el resto se **bajan** con su nombre.
4. La vista previa (la primera página del PDF como miniatura), en una segunda entrega.

## Reglas que no se rompen

- **Ningún tipo de bloque nuevo.** El bloque `file` de BlockNote queda afuera del esquema. Un adjunto es **un
  bloque `image` con `url: sdmedia://<uuid>`**, como las fotos y los videos: la app mira `files.mime` para
  dibujar foto, video o tarjeta.
- Primero en el dispositivo (IndexedDB y la cola de `src/media/queue.ts`), después al Drive por el portero,
  registrado en `files`/`page_files`; para ver, un pase del portero. La papelera de archivos sigue igual.
- Lo que una versión vieja no conozca se ve raro, **nunca se borra**.

## 1. Qué frena hoy un PDF o un zip

Cuatro frenos en la app; el portero y la base ya aceptan cualquier tipo.

| Dónde | Qué hace hoy |
|---|---|
| `PageEditor.tsx`, `rejectOtherFiles` (pegar y soltar en captura) | **El que vio Lega.** Deja pasar solo imágenes (`isAllowedImage`) o, con portero, `image/*` y `video/*` (`isMediaFile`); con lo demás corta y avisa *Only photos and videos*. |
| `editorSchema.ts`, `fileBlockAccept` del bloque `image` | Solo `image/*` (y `video/*` con portero). Sin el freno de arriba, BlockNote no encontraría un bloque que acepte el PDF y **crearía un bloque `file`**, que no está en el esquema. Un archivo sin `type` (.rar o .exe en Windows) nunca coincide; `*/*` tampoco sirve (compara `application` con `*`). |
| `queue.ts`, `save` | Rechaza lo que no es foto o video y el SVG (`FileRejected`); `queue.test.ts` lo fija con `notas.pdf`. |
| `queue.ts`, `normalizeMime` | Solo conoce extensiones de fotos y videos; un .rar sin tipo queda `application/octet-stream`. |
| Portero, `startFileUpload` | **Acepta cualquier tipo** (usa `files.mime`), **sin tope de tamaño** (partes de hasta 64 MiB; la app manda de 8 MiB). |
| Portero al servir (`media`, `mediaHeaders`) | (Antes de v0.048.) `Content-Type` = `files.mime`, siempre `nosniff` y `CSP: sandbox`. **Nunca mandaba `Content-Disposition`**: no se podía pedir descarga ni poner el nombre. Resuelto en la entrega 1a. |
| Base (`register_file`, `files`) | **No restringe el tipo** (solo la forma `tipo/subtipo`), `size bigint > 0`. |
| Carrete (`collectCarrete`) | Mete todo `image` con `sdmedia://`: un PDF entraría y se vería *The photo couldn't be loaded*. |
| `display()` en `queue.ts` | Un tipo desconocido muestra el recuadro gris con el ícono de foto; si lo subió otro dispositivo, además le pregunta a la base cada 60 s por una miniatura que nunca llega. |
| Impresión, papelera, `mediaIdsInDoc` | Andan con cualquier archivo. |

## 2. El modelo: el mismo bloque `image`, dibujado como tarjeta

- `fileKind(mime, name)` (en `src/media/probe.ts`): `'image' | 'video' | 'file'`. Es foto o video si
  `mediaKind(mime)` no es nulo **y** no es uno de los tipos que el navegador nunca muestra (SVG, que puede traer
  scripts; PSD, EXR, DPX, TGA, DWG: en VFX son adjuntos). Todo lo demás es `'file'`. HEIC, TIFF, DNG y los
  videos que no se reproducen siguen siendo media (D-17). `mediaKind` no cambia.
- **La tarjeta sale de `display()`** como imagen SVG generada (`data:image/svg+xml`, sin scripts), igual que hoy
  los marcadores (`placeholderUrl`, `deletedUrl`). BlockNote la pone en su `<img class="bn-visual-media">`, así
  que **nada del editor cambia**: elegir, contorno, tiradores, barra, `rowWidth` y filas, arrastrar,
  comentarios, marcas de hoja e impresión. Se descartaron: `showPreview: false` (un segundo dato que se
  desincroniza), un render propio del bloque (el tipo llega después, asíncrono; lo más riesgoso) y una capa
  encima (no sale en la impresión).
- **Cómo es:** horizontal, 360×96 (como la lista del Drive). A la izquierda un documento con la esquina doblada
  y la extensión (PDF, ZIP, RAR, EXE, NK…) con un color por familia (PDF rojo, comprimidos amarillo, audio
  violeta, textos y hojas azul o verde, presentaciones naranja, ejecutables gris oscuro, 3D y proyectos
  celeste, el resto gris; `attachmentFamily(mime, name)`). A la derecha el nombre en hasta 2 renglones (si hay
  que cortar, en el medio, conservando la extensión) y abajo "PDF · 2,4 MB". Texto escapado y `system-ui`.
  Variantes: sin datos todavía, de otro proyecto ("Archivo de otro proyecto"), en la papelera de Drive. Colores
  neutros como los marcadores de hoy (una por tema, más adelante).
- **`queue.ts`:** `save` acepta cualquier archivo con portero (solo rechaza el vacío); `normalizeMime` suma
  extensiones que no son media (pdf, zip, rar, 7z, tar, gz, txt, csv, json, doc(x), xls(x), ppt(x), pages,
  numbers, key, mp3, wav, aif, m4a, flac, ogg, psd, exr, svg, exe, dmg); `display()` devuelve la tarjeta y
  **no lo anota en `missing`**; `size` llega con `fetchMediaFiles` (campo opcional en `MediaFileRow` y
  `KnownFile`, sin cambiar la versión de la base local); método sincrónico `fileInfo(id)` (tipo, nombre,
  tamaño, si está en el dispositivo) desde un `Map` que llenan `display()`, `source()` y `fetchMeta`;
  `foreignTo` también para adjuntos.
- **Una versión vieja (v0.041 en adelante)** ve el recuadro gris con el ícono de foto y el nombre; dos clics
  abren su carrete con el aviso y *Download*, que con el portero nuevo baja el archivo con su nombre. No puede
  agregar adjuntos. **No se pierde nada** aunque edite o mueva el bloque: no hay propiedad nueva.

## 3. Clic, abrir y bajar

| | Foto o video | Adjunto |
|---|---|---|
| Mouse, 1.er clic | Elige | Elige |
| Mouse, 2.º clic o doble clic | Carrete | Abre (pestaña nueva) o baja, según el tipo |
| Toque (teléfono) | Carrete | Abre o baja; tocarlo ya elegido muestra la barra |
| Barra espaciadora con el bloque elegido | Carrete | Abre o baja |
| Barra: *View* | Carrete | *Open*, con otro ícono |
| Barra: *Download* | Original | Original con su nombre (forzado a descarga) |
| Solo lectura | Un clic abre | Un clic abre o baja |

- **Qué se abre (`inline`)**, una lista compartida por la app y el portero, con prueba: `application/pdf`,
  `text/plain`, imágenes comunes y audio. **Todo lo demás se baja (`attachment`)**, incluidos HTML, XHTML, SVG,
  XML, JS, CSV, JSON, Office, comprimidos, ejecutables y `octet-stream`.
- **Portero:** el pase suma, firmados, `n` (el nombre, de `files.name`) y `d` (`i` o `a`, calculado de
  `files.mime`, nunca de lo que mande la app); un pase viejo sigue valiendo y se sirve como hoy.
  `/m/<pase>?download=1` (sin firmar) **solo puede forzar la descarga**. Una sola función arma los encabezados
  de `media()` y de las respuestas por partes de la caché: `Content-Disposition` con `filename*` (RFC 5987),
  `Referrer-Policy: no-referrer` (el pase no se filtra desde los links de un PDF), `nosniff` y `sandbox`; con
  `attachment` y un tipo activo (HTML, SVG, XML, JS), `Content-Type: application/octet-stream`.
- **La app (`src/ui/attachmentOpen.ts`, nuevo):** si el archivo está en el dispositivo, se baja con
  `<a download>` y un `blob:`; se abre solo si es de la lista `inline`, **envuelto de nuevo con ese tipo** (un
  `blob:` tiene el origen de la app: abrir ahí un HTML o un SVG sería peligroso). Si no está, un pase:
  `window.open` para abrir, `?download=1` para bajar. Safari bloquea `window.open` después de un `await`: el
  pase o el `blob:` se preparan al elegir el bloque (primer clic o `pointerdown`), así el segundo clic abre en
  el acto; si no está listo, se abre en el mismo clic una pestaña vacía y después se la lleva a la dirección.
- **Barra:** *Open* para un adjunto; *Download* con `?download=1` también en las fotos (baja con su nombre); sin
  *Rename* para `sdmedia://` (la tarjeta usa `files.name`); sin *Toggle preview* para `sdmedia://`.

## 4. Vista previa (entrega 2)

La primera entrega es solo la tarjeta con el ícono. La propuesta original era pedirle a Drive su miniatura por el
portero. **Se cambió (decisión de la entrega 2, contrastada con el código): la primera página del PDF se hace en el
dispositivo que lo agrega, con pdf.js bajado aparte, como la miniatura de una foto.** Por qué:

- **La de Drive se puede pedir sin darle ninguna clave a la app**: ya existe `GET /t/<pase>` (lo sumó P.9 para el
  visor de carpetas). El portero le pide a Drive `thumbnailLink` con la conexión del dueño y devuelve la imagen; la
  app solo necesita el pase. Con `drive.file` anda, porque los archivos los creó la app. Pero:
  - **No anda sin red ni recién agregado**: Drive la hace después de recibir el archivo, a veces minutos más tarde. En
    el dispositivo que lo agrega, nada hasta que se sube y Drive termina; habría que volver a preguntar cada tanto.
  - **Para guardarla** (y verla sin red) la app tiene que leer los bytes: `/t/` no tiene CORS, así que el portero
    tiene que cambiar, y el portero de cada dueño se publica aparte. Sin guardarla, cada vista son dos pedidos al
    Worker (el pase y `/t/`) y dos a Drive: el pase de un archivo de la app no trae `m` y la caché de Cloudflare de
    `/t/` no se usa. No rompe el plan gratis (100.000 pedidos por día, `Doc_Carpetas.md`, sección 12), pero suma
    pedidos y estados (esperar, reintentar, "Drive no tiene miniatura").
- **pdf.js en el dispositivo** reusa todo el camino de las fotos sin tocar el portero ni la base: se hace al agregar
  el archivo (sin red también, si pdf.js ya se bajó una vez), se guarda en `thumbs` del dispositivo, la cola la sube
  al bucket `thumbs` con `set_file_thumb` **antes que el original**, y los demás la bajan de Supabase Storage (cero
  pedidos al Worker) y la guardan. Lo ya visto se ve sin red, y "Available offline" la baja con las miniaturas.
- **Peso y seguridad de pdf.js:** 6.3 (Apache-2.0), la versión `legacy` (con los arreglos para Safari viejos):
  ~490 KB la librería y ~1,3 MB su Worker, **bajados solo cuando alguien agrega un PDF**, fuera del paquete y de lo que
  la app guarda al instalarse; se guardan en la caché `pdf-preview` la primera vez (como el decodificador de HEIC).
  Desde la 5.x pdf.js ya no compila código desde el PDF (la falla de 2024 venía de ahí). Se usa lo mínimo: la
  primera página en un canvas, sin texto, anotaciones, formularios XFA ni wasm, con el análisis en su Worker.
- **Lo que queda afuera:** Office, PSD y demás siguen con el ícono. Sumar la miniatura de Drive para esos es una
  entrega aparte (CORS en `/t/` y guardarla en el bucket), en el roadmap.

Detalles:

- Solo PDF de hasta **64 MB** (pdf.js lo lee entero en memoria; el iPhone no da para más). Un PDF dañado, con
  contraseña o que tarda más de 20 s en dibujarse queda con el ícono. La vista previa es un JPEG de 480 de lado mayor
  (igual que la miniatura de una foto, menos de 512 KB).
- **Sin red la primera vez** (pdf.js nunca se bajó en ese dispositivo): el archivo se guarda y se sube igual, sin
  vista previa; se hace la próxima vez que se muestra con red, y si el archivo ya estaba subido, se sube al bucket en
  ese momento. Lo mismo con los PDF agregados antes de esta versión, en el dispositivo que tiene el original.
- **Otro dispositivo** que ya mostró un adjunto sin vista previa se entera en la sesión siguiente (al preguntar si el
  archivo se borró, ve `thumb_at`) y vuelve a dibujar la tarjeta.
- **La tarjeta con vista previa** mide 360×268: la vista previa arriba (llena el ancho y muestra la parte de arriba
  de la página, como la cuadrícula de Drive) y abajo el nombre en un renglón y la etiqueta del tipo con el peso. Es
  el mismo SVG `data:` de siempre con la foto adentro (`data:image/jpeg;base64`; un SVG en un `<img>` no carga nada
  de afuera, y solo se acepta una foto en base64). De otro proyecto o borrado, la tarjeta de siempre, sin vista previa.
- **Sin migración ni propiedad nueva en el bloque**: la vista previa es la miniatura del archivo (`files.thumb_at`,
  bucket `thumbs`). En el registro local de la cola se suma `previewTried` (opcional; una versión vieja lo ignora y
  lo conserva). Una versión anterior a v0.049 mostraría la vista previa como si fuera una foto; desde v0.049 se ve la
  tarjeta con el ícono. No hace falta subir `min_app_version`.

## 5. Carrete y filas

- **El carrete muestra los adjuntos en grande** (entrega 2), en su lugar entre las fotos: la vista previa (la
  primera página de un PDF, a su tamaño, sin agrandarla) o la tarjeta, el tipo y el peso, y *Open* (si el navegador lo
  sabe mostrar) y *Download*. Las carpetas siguen afuera (tienen su visor). El segundo clic en un adjunto sigue
  abriéndolo o bajándolo (sección 3); al carrete se llega desde una foto.
- Un adjunto puede tener `rowWidth`: los tamaños rápidos lo ponen en fila como a una foto. **"Acomodar en filas"
  corta la tanda en los adjuntos** (una tarjeta de 3,75:1 desarmaría la galería); con un adjunto elegido, el
  botón no aparece.

## 6. Seguridad y tamaños

- HTML, SVG, XML y JS **nunca se sirven `inline`**. `CSP: sandbox` sin `allow-scripts` y `nosniff` siguen. En
  el origen del portero no hay sesión en cookies ni claves que robar, igual se mantienen las barreras.
- **PDF y `sandbox`:** probablemente el visor de PDF de Chrome no carga en un documento con `CSP: sandbox`. Se
  verifica en la entrega 1; si pasa, el PDF se sirve sin CSP (a lo sumo `frame-ancestors 'none'`), con
  `nosniff`, `inline` y `Referrer-Policy: no-referrer`.
- **Malware:** Drive analiza los archivos; uno marcado como malicioso responde 403 y el portero lo informa. No
  se pide `acknowledgeAbuse`.
- **Tamaños grandes:** portero y Drive sin tope (partes de 8 MiB que se retoman). El riesgo es el espacio del
  dispositivo: el original queda también ahí después de subir (Doc_Decisiones). No se borra nada en esta tanda;
  aviso (no bloqueo) al agregar algo de más de 1 GB, y un ítem nuevo del roadmap para liberar originales ya
  subidos.
- **Sin portero** (workspace sin Drive): como hoy, solo imágenes; lo demás se rechaza con un aviso que dice que
  el dueño tiene que conectar Google Drive.

## 7. Base de datos y versión mínima

- **Sin migración:** `files.mime` acepta cualquier tipo; no se agrega `kind` (sale siempre de `mime` y del
  nombre).
- **Sin propiedad nueva** en el bloque: no hace falta subir `min_app_version` para proteger datos.
- El portero sale con la misma subida que la app y sirve los pases viejos.

## 8. Entregas y pruebas

1. **Entrega 1:** soltar y pegar cualquier archivo (un solo manejador en captura, que toma el evento solo si
   BlockNote lo trataría como archivos, inserta en orden un bloque `image` por archivo y usa `uploadFile`; con
   `fileBlockAccept = ['*/*']` solo para el selector), la cola, la tarjeta, abrir y bajar, el carrete que
   saltea, "Acomodar" que corta, el portero (pase con nombre, `?download=1`, encabezados), la papelera con el
   ícono de tipo, textos y docs.
2. **Entrega 2 (hecha):** vista previa de los PDF (pdf.js en el dispositivo, sección 4) y la tarjeta grande en el
   carrete.
3. **Opcional:** tarjeta por tema, `/Archivo` en el menú "/", audio en el carrete.

Pruebas: unidad (`fileKind`, `normalizeMime`, `attachmentFamily`, la tarjeta con un nombre con `<script>` y el
corte en el medio, la lista `inline`, la cola con `notas.pdf`, el carrete que saltea, abrir o bajar y el
`blob:` re-tipado), portero (encabezados por tipo, `?download=1`, `filename*`, pase viejo, 206 de la caché,
HTML como `octet-stream`), jsdom con el esquema publicado (una página con un PDF adjunto se abre, se edita y se
mueve sin perder nada; la guarda no marca nada), jsdom con el editor nuevo (soltar `[a.pdf, b.zip, c.jpg]` da
tres `image` en orden y ningún `file`) y de punta a punta (soltar PDF, zip y .exe, tarjeta, PDF en pestaña
nueva con el visor, zip bajado con su nombre, sin red desde el dispositivo, impresión). A mano: Safari de Mac,
iPhone (Safari y la app instalada), Firefox y un archivo de 1 GB.

## Decisiones (a confirmar por Lega)

1. Tarjeta horizontal (como la lista del Drive), no baldosa.
2. Un toque en el teléfono sobre un zip lo baja enseguida (como una foto abre el carrete).
3. Aviso, sin tope, al agregar algo de más de 1 GB.
4. Sin subir `min_app_version` por los adjuntos (no hace falta).
5. Vista previa en una segunda entrega: hecha con pdf.js en el dispositivo y no con la miniatura de Drive (sección 4).

## Correcciones de la auditoría previa (mandan sobre lo de arriba)

Una auditoría independiente contrastó el diseño con el código. El modelo (mismo bloque `image`, sin propiedades
nuevas, sin migración) se mantiene. Cambios:

1. **Todo `blob:` que sale de un original se envuelve de nuevo:** `application/octet-stream` para bajar, y para
   abrir solo los tipos de la lista `inline`. Vale también para el carrete y la barra de hoy (con adjuntos, un
   original puede ser HTML o SVG, y un `blob:` tiene el origen de la app).
2. **El portero se publica aparte** (en la cuenta de cada dueño, puede atrasarse): la app nueva tiene que andar con
   un portero viejo. `/pass` suma una marca (`named: true`); sin ella, las descargas siguen con un nombre feo y el
   diálogo de Drive avisa que conviene actualizar el portero. Los pases guardados sin nombre no se usan para bajar.
3. **Portero:** el `d` no va en el pase: se calcula al servir a partir de `t` (ya firmado), así los pases viejos
   también reciben los encabezados seguros. Solo se suma `n` (el nombre), firmado. `Content-Type` = `t` solo si
   está en una lista permitida (imágenes menos SVG, video, audio, PDF, texto plano); si no, `octet-stream` y
   `attachment`. `video/*` también es `inline`. Una función de encabezados para `media()` y la caché por partes;
   `filename*` bien codificado (también `'()*`) más `filename` en ASCII; sin caracteres de control ni bidi. PDF sin
   `sandbox` si la prueba confirma que el visor no carga con él. 403 de Drive por malware o por Drive lleno, con
   códigos fijos (la cola deja de reintentar un Drive lleno). La caché del arranque, solo para videos.
4. **Soltar y pegar:** pegar por la opción `pasteHandler` del editor (si hay `Files` y no hay HTML de BlockNote,
   `text/html` ni de VS Code); soltar en captura solo si se puede editar y el destino está en el editor, sin
   procesar dos veces el mismo `DataTransfer` (el menú lateral reenvía el evento), copiando la lista de archivos en
   el acto (BlockNote la lee después de un `await` y con varios archivos entra solo el primero). Todos los bloques
   se insertan de una vez, en orden, con `url: ""` y `name`; después se guarda cada uno (`uploadFile`) y un error
   no corta los demás. Se inserta siempre (no se reemplaza un bloque vacío, salvo un párrafo común). Las carpetas se
   rechazan pidiendo que se compriman. Una guarda en `window` evita que soltar un archivo afuera del editor (o en
   solo lectura) abra el PDF en la pestaña y reemplace la app. El conversor de imágenes `data:` sigue solo para
   media.
5. **`display()`:** la tarjeta se guarda en caché (sin preguntar a la base en cada dibujo); `refreshMissing` pasa
   de "todavía no está" a adjunto cuando aparece la fila; las variantes (borrado, de otro proyecto) tienen la misma
   forma; los nombres se limpian (controles, bidi, pares sustitutos) y el texto se corta midiéndolo.
6. **La tarjeta tiene tamaño fijo** (360 px, `max-width: 100%`): sin tiradores, sin tamaños rápidos ni "Acomodar",
   y `rowWidth`/`previewWidth` se ignoran al dibujarla; sin lupa. "Acomodar" y el carrete cortan en los adjuntos
   con un dato sincrónico (`fileInfo`, y mientras tanto la extensión de `name`).
7. **`localImage`, la miniatura y `foreignTo`** usan `fileKind`; la papelera muestra el ícono del tipo.
8. **Espacio:** antes de guardar algo grande, `navigator.storage.estimate()` con margen (si no entra, se avisa y no
   se agrega: el texto de las páginas vive en la misma cuota); `navigator.storage.persist()` al empezar.
9. **En pantallas táctiles, un toque en un adjunto abre una hoja** con la tarjeta grande y *Open*, *Download* y
   *Share* (el pase se prepara mientras está abierta; cada botón es un gesto nuevo, sin pestañas vacías). Con el
   mouse, el segundo clic abre si el pase está listo y si no, la misma hoja. En iOS, para lo que está en el
   dispositivo, *Share* con `navigator.share({ files })` ("Guardar en Archivos").
10. **Nunca se agrega nada a `sdmedia://<uuid>`** (las versiones viejas dejarían de reconocer el archivo y lo
    mandarían a la papelera).

### Orden

1. **Entrega 1a, portero** (compatible con la app de hoy, que gana los nombres en las descargas), con pruebas.
   **Hecha**: detalle en `Doc_Portero.md` (*Lo que se sirve*). El PDF va sin `sandbox` y, por ahora, sin
   `frame-ancestors` (falta probar a mano el visor de Chrome con él).
2. **Entrega 1b, app (hecha, v0.049; ver "Cómo quedó"):** `fileKind` y `normalizeMime`, nombres limpios, `blob:` envueltos, tarjeta y `display()`,
   el manejador de archivos, abrir y bajar (computadora: segundo clic y barra; teléfono: la hoja), carrete y
   "Acomodar" que cortan, impresión y papelera, espacio.
3. **Entrega 2, hecha:** vista previa de los PDF y la tarjeta grande en el carrete (ver "Cómo quedó (entrega 2)").
   Después: la miniatura de Drive para Office y PSD, tarjeta por tema, `/Archivo`.

### Decisiones (respondidas por Lega el 2026-09-30)

- Tarjeta horizontal, la propuesta (Lega quiere ver las dos opciones para decidir más adelante).
- En el teléfono, un toque abre la hoja: de acuerdo.
- Carpetas: hoy se rechazan pidiendo que se compriman; **Lega quiere subirlas enteras** (P.9 del roadmap).
- Originales: el archivo que eligió el usuario nunca se toca; se puede liberar la copia de la app en el
  navegador después de subir (P.10 del roadmap).
- Vista previa: en una segunda entrega, de acuerdo.

### Decisiones tomadas antes (quedan como estaban salvo lo de arriba)

- Los originales de los adjuntos **se quedan en el dispositivo** después de subir, como las fotos (borrarlos es
  otra decisión, pendiente).
- En el teléfono, un toque abre la hoja (no baja enseguida).
- Una carpeta se rechaza pidiendo que se comprima.
- Sin tope de archivos por tanda.
- Con un portero sin actualizar, los adjuntos se pueden agregar y se bajan con un nombre feo; el diálogo de Drive
  avisa que conviene actualizar el portero.

## Cómo quedó (v0.049)

- `src/media/attachments.ts`: `fileKind` (un SVG o un subtipo XML es adjunto), `inlineType` (más estricta que el
  portero: solo fotos y audio que el navegador muestra, videos, PDF y texto plano; un HEIC, un PSD o un AIFF se
  bajan con su nombre), `attachmentFamily`,
  `extensionLabel`, `cleanFileName`, `safeBlob` y la tarjeta (`attachmentCardUrl`: SVG de 360×96, texto medido
  con margen para las fuentes anchas, variantes con la misma forma).
- `src/media/queue.ts`: acepta cualquier archivo con portero (sin portero, solo imágenes, con el aviso de
  conectar Drive); aviso de espacio antes de guardar algo grande; `fileInfo`, `localOriginal`, `passInfo`;
  `display()` con la tarjeta en caché; un Drive lleno (507) deja la subida detenida con el aviso.
- `src/ui/carreteLoader.ts`: todo original que se baja va como `octet-stream`; `openTarget` y `downloadTarget`;
  *Download* (en la barra y en el carrete) con un pase del portero lleva `?download=1` (si no, un PDF se abriría
  en vez de bajarse).
- `src/ui/fileDrop.ts`: soltar y pegar (un bloque `image` por archivo, en orden, los archivos leídos en el acto,
  carpetas rechazadas; reemplaza un párrafo vacío solo si no tiene bloques adentro); `PageEditor.tsx` lo usa en `pasteHandler` y en la captura de soltar, con una guarda en
  `window` para lo que se suelta afuera.
- `src/ui/attachments.ts` (qué bloque es un adjunto y la clase `sd-attachment`; sin los datos del archivo, solo
  por una extensión conocida), `src/ui/attachmentOpen.ts` (preparar, abrir, bajar; lo que no se pudo preparar
  no se guarda y el próximo pedido vuelve a probar) y `src/ui/AttachmentSheet.tsx` (la hoja: *Open*, *Download*, *Share*).
- Barra: *Open* en un adjunto, sin tamaños rápidos ni "Acomodar"; sin *Rename* ni la vista previa de BlockNote
  en los archivos del Drive. El carrete y "Acomodar" cortan en los adjuntos. La papelera muestra la etiqueta
  del tipo.
- Probado en Chromium (`attach.mjs`, en el repo de pruebas privado; sin llegar al portero real ni escribir en
  la base): tres archivos soltados quedan en orden, las tarjetas miden 360 px, el primer clic elige y el
  segundo abre el PDF (desde el dispositivo, con su tipo), el zip se baja con su nombre, la barra, el carrete
  con solo la foto, soltar afuera no navega, la hoja en el teléfono y el aviso sin portero.
- Auditoría de la entrega 1b (independiente): arregladas antes de publicar la descarga sin `?download=1`, el
  párrafo con hijos que se borraba al soltar, la lista de lo que se abre (HEIC, PSD, XML), los caracteres
  invisibles del nombre, los fallos que quedaban guardados, la barra espaciadora (abre como el teclado) y los
  estilos de la tarjeta (tiradores, fila, puntero).
- Pendiente:
  - Probar a mano con el portero real: PDF en una pestaña con el visor, descargas con nombre, Safari y el
    iPhone instalado.
  - ~~La vista previa (entrega 2).~~ Hecha con pdf.js en el dispositivo: ver "Cómo quedó (entrega 2)".
  - Un adjunto de otro dispositivo que todavía no está registrado se ve con el marcador de foto hasta que llega
    su fila.
  - El aviso "este portero todavía no pone el nombre" (`named: false` de `downloadTarget`) se calcula pero no
    se muestra: con el portero v0.048 siempre llega el nombre. Mostrarlo si algún día hay porteros viejos.
  - ~~En el carrete, un adjunto no aparece.~~ Hecho en la entrega 2: se ve en grande con *Open* y *Download*.

## Cómo quedó (entrega 2)

- `src/media/pdfPreview.ts`: qué tiene vista previa (`previewable`: un PDF de hasta 64 MB), la carga de pdf.js
  (comprueba que su Worker llegue; si no, `PreviewUnavailable` y se prueba más tarde) y `attachmentPreview` (la
  primera página, JPEG de 480 de lado mayor, con `thumbFromCanvas` de `probe.ts`). `src/media/pdfLib.ts`: lo único
  que importa pdf.js, bajado aparte (vite.config.ts lo deja fuera de la instalación y lo guarda en `pdf-preview`).
- `src/media/queue.ts`: al medir un adjunto propio, la vista previa va a `thumbs` como una miniatura (`thumb:
  'local'`, la cola la sube antes que el original) y se anota `previewTried`; `display()` arma la tarjeta con ella
  (la propia, o la bajada del bucket para los de otro dispositivo, guardada para verla sin red);
  `backfillPreview` la hace después (pdf.js no estaba, o PDF de antes) y la sube si el archivo ya estaba subido; si
  llega más tarde a otro dispositivo, `checkDeleted` lo nota y vuelve a dibujar.
- `src/media/attachments.ts`: la tarjeta alta (`preview`, 360×268) y `blobToDataUrl`. Solo acepta
  `data:image/(jpeg|png|webp);base64`.
- Carrete (`carreteLoader.ts`, `Carrete.tsx`): los adjuntos entran (`collectCarrete` saltea solo las carpetas); la
  vista previa a su tamaño o la tarjeta, tipo y peso, *Open* (la dirección se prepara al verlo: Safari no deja abrir
  después de esperar) y *Download*; sin zoom. Sin red y sin el archivo en el dispositivo: el aviso adentro de la
  tarjeta y los botones apagados. La hoja del teléfono ya mostraba la tarjeta: ahora con la vista previa.
- "Available offline" baja también la vista previa de los adjuntos (va con las miniaturas, `offline.ts` y
  `offlinePlan.ts`).
- Ayuda: la entrada de adjuntos y la del carrete, en los dos idiomas. Avisos de licencia: PDF.js (Apache-2.0) en
  `THIRD_PARTY_NOTICES.md` y al principio de su archivo.
- Probado: pdf.js de verdad en Node dibujando un PDF hecho en la prueba (`pdfPreview.test.ts`, con el canvas de
  `@napi-rs/canvas` que trae pdf.js); la cola (vista previa al agregar, subida antes del original, otro dispositivo,
  sin red, pdf.js que no se pudo bajar, PDF de antes), la tarjeta, el carrete y su cargador. En Chromium, con un arnés
  local sin login (servidor en memoria, pdf.js real): soltar un PDF y un zip, la tarjeta de 360×268, el carrete con
  el PDF en grande, *Open* (el original del dispositivo con su tipo) y *Download*, el zip con su tarjeta, otro
  dispositivo que la baja del bucket, sin red y la app abierta de nuevo (la vista previa sigue; el carrete avisa y
  apaga los botones), y en el teléfono en oscuro la tarjeta, la hoja y el carrete.
- Pendiente:
  - Probar a mano con el portero real y Safari/iPhone: que pdf.js se baje, dibuje y quede guardado para usarlo sin
    red; un PDF grande (50 MB) en el iPhone.
  - La miniatura de Drive para Office, PSD y demás (roadmap).
  - Los PDF de antes que solo están en Drive (ningún dispositivo tiene el original) siguen con el ícono.
