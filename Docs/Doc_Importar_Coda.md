# Importar de Coda

Cómo se pasa un doc de Coda (con sus páginas, subpáginas, fotos y videos) a un proyecto de Shot Docs. Son
dos pasos: un comando que baja el doc a una carpeta de la PC, y la app, que importa esa carpeta. Los
comentarios se capturan aparte, con el servidor MCP de Coda (ver "3. Comentarios").

## Paso a paso

1. **Token de Coda** (una vez): *Account settings → API settings → Generate API token*, de solo lectura si
   Coda lo ofrece. Se guarda como único contenido de `%USERPROFILE%\.coda-token` (fuera del repo).
2. **Bajar el doc**: `node scripts/coda-export.mjs "<nombre del doc>"`. Termina con "Listo: N páginas, M
   archivos. Problemas: 0"; con problemas sale con error y se vuelve a correr (trae solo lo que falta).
3. **Capturar los comentarios** (si el doc tiene): con el MCP de Coda, `comments.json` en la misma carpeta
   (ver "3. Comentarios"). Sin ese archivo se importa igual, sin comentarios.
4. **Revisar la carpeta** (`%USERPROFILE%\Coda_Export\<doc>`): cualquier `pages/*.local.html` se abre en el
   navegador con sus fotos, y `manifest.json` lista el árbol y lo que no se pudo bajar.
5. **Importar**: recargar las pestañas abiertas de la app y, en la app, selector de proyectos → *Import from
   Coda…* → la carpeta → un nombre para el proyecto nuevo.
6. **Esperar la subida**: dejar la app abierta hasta que el estado diga que se subió todo al Drive y que no
   quedan cambios por sincronizar (los comentarios suben con ellos).
7. **Comprobar**: el árbol de páginas, las fotos y los comentarios de algunas páginas, comparando con Coda.

Así se probó con MGTZD (35 páginas, 32 fotos, 28 MB): la importación salió completa. Dos exportaciones
desde cero dieron los mismos archivos byte por byte, y una segunda corrida sobre la misma carpeta no bajó
nada (un segundo).

## 1. Bajar el doc (`scripts/coda-export.mjs`)

```
node scripts/coda-export.mjs "MGTZD" [carpeta] [--refresh]
```

- **Token.** Usa la API de Coda con un token personal (*Account settings → API settings*, conviene de solo
  lectura). Se lee de la variable `CODA_API_TOKEN` o del archivo `%USERPROFILE%\.coda-token` (en Mac,
  `~/.coda-token`). Nunca va en el repo (`.coda-token` y `Coda_Export/` están en `.gitignore`). El token va
  solo a direcciones `https://coda.io/apis/…`: las que devuelve la API (el `href` de una exportación, el
  `nextPageLink` de una lista) se revisan antes de mandarlo, y una que apunta a otro lado corta el comando
  con error. Los pedidos con token no siguen redirecciones (una redirección corta el comando), así que no
  depende de lo que haga Node con el encabezado al redirigir. Las bajadas de archivos y del HTML exportado van
  sin token.
- **Qué baja.** Para cada página, `POST /docs/{doc}/pages/{página}/export` en **HTML**: el Markdown de Coda
  descarta las fotos pegadas en la página. Cada foto, video o adjunto (`codahosted.io`) se baja a `media/`
  con el nombre de su blob (`bl-….jpg`); una dirección sin blob, con `url-` y un hash de la dirección entera
  (dos direcciones distintas nunca comparten nombre).
- **Qué deja** (por defecto en `%USERPROFILE%\Coda_Export\<doc>`):
  - `manifest.json`: el árbol (padre y orden de cada página, título, subtítulo, ícono) y qué archivo es cada
    dirección de Coda.
  - `pages/<n>_<id>.html`: el HTML tal cual lo da Coda; `pages/<n>_<id>.local.html`, el mismo con las fotos
    apuntando a `media/` (para mirarlo en el navegador).
  - `media/`: los archivos.
- **Se puede cortar y volver a correr**: lo que ya está en la carpeta no se vuelve a pedir. Cada archivo se
  escribe primero como `.part` y se renombra al terminar (y se compara con el tamaño que dijo el servidor),
  así un corte nunca deja uno a medias que la corrida siguiente dé por bueno. Los archivos se bajan en
  streaming (un video grande no pasa entero por la memoria). Ante un corte de red, un 429 (límite de pedidos)
  o un error del servidor, espera y reintenta hasta 8 veces. Si algo igual falla, termina con error y lo lista:
  se vuelve a correr y trae solo lo que falta.
- **Lo ya bajado no se actualiza.** Como vuelve a usar lo que está en la carpeta, una página que cambió en
  Coda después de bajarla queda como estaba. `--refresh` vuelve a pedir el HTML de todas las páginas (los
  archivos no: un blob de Coda es siempre el mismo archivo); borrar la carpeta también sirve.
- La misma foto usada en dos páginas se baja una vez, pero en la app entra una vez por página.
- Una página que no es texto (una página embebida o sincronizada de otro doc) no se exporta: queda anotada en
  `problems` del manifest y en la app entra vacía.

## 2. Importar la carpeta (la app)

Selector de proyectos → **Import from Coda…**. Se elige la carpeta y todo entra a un **proyecto nuevo**. El
código está en `src/import/` y el diálogo en `src/ui/ImportCodaDialog.tsx`.

- **Quién lo ve: solo la cuenta de Lega** (y solo donde puede crear proyectos). Es una herramienta suya, no una
  función de la app: nadie más ve la entrada del menú ni puede abrir el diálogo, que para los demás ni se
  monta (`ImportCodaHost` en `Workspace.tsx`). Como el repositorio es público, el correo no está escrito en
  ningún lado: `src/import/codaOwner.ts` compara el SHA-256 (hex) del correo del usuario que inició sesión,
  sin espacios alrededor y en minúsculas, con una constante (`CODA_OWNER_HASH`). El hash se calcula con Web
  Crypto (`crypto.subtle.digest`), una vez por usuario, y la entrada aparece cuando se resolvió (un instante).
  Sin Web Crypto (una página servida sin HTTPS) no la ve nadie. Para cambiar de cuenta, el comentario de
  `codaOwner.ts` dice cómo calcular el hash nuevo. Desde v0.056.

- **De entrada** el diálogo dice lo que impide importar, antes de elegir nada: con el Drive sin conectar (sin
  portero) las fotos no tendrían adónde ir; en el iPad y el iPhone Safari no elige carpetas enteras (hay que
  importar desde una computadora; después el proyecto se sincroniza).
- **Al elegir la carpeta** se revisa el manifest (ver abajo) y se muestran las páginas, los archivos y cuánto
  pesan, con el espacio que el navegador le deja a la app (`navigator.storage.estimate`): los archivos quedan
  en el dispositivo hasta que se suben, y si no entran lo avisa.
- **Mientras importa**: "Página 3 de 35: <título>", y la app pide confirmación antes de cerrarse o recargarse
  (el mismo `beforeunload` que cuida lo que no llegó a IndexedDB, en `Workspace.tsx`). Cambiar de workspace,
  cerrar la sesión (menú de la cuenta) y, en la pantalla de "te sacaron del workspace", cerrar la sesión o
  quitar el workspace del dispositivo esperan a que termine. Otra ventana que quiere tomar el control
  (`shell.busy`) pregunta antes si esta está importando: una marca en localStorage, renovada en cada página,
  se lo dice. Entre página y página le da un respiro al navegador (`setTimeout(0)`), así el progreso se dibuja.
- **El estado vive afuera del diálogo** (`src/import/importJob.ts`, uno por workspace abierto) y el diálogo lo
  dibuja el Shell (`ImportCodaHost`), no el selector de proyectos: si el selector se desmonta (se cierra la
  barra lateral en el celular), la importación y su resultado siguen a la vista.
- **Al terminar**: cuántas páginas y archivos, la lista de lo que no se pudo traer y, aparte, lo que anotó el
  comando al bajar el doc (`manifest.problems`). Si quedó algo para reintentar, lo dice ("elegí la misma
  carpeta de nuevo y usá Seguir").

Va por los mismos caminos que usa la app al escribir, así que funciona sin red y lo guardado en el
dispositivo se sube solo. Una página que falla (un archivo que no se puede leer, por ejemplo) queda creada y
anotada en la lista del final, y las demás siguen:

1. **Páginas**: `tree.create(padre, título, proyecto)`, en el orden del árbol (cada padre antes que sus hijas,
   las hermanas en su orden de Coda). **Desde v0.061 se crean todas primero** y después se escribe cada una:
   así un link a otra página del doc siempre tiene adónde ir (ver "Links entre páginas").
2. **Archivos**: `media.add(página, archivo)`, lo mismo que soltar una foto en el editor. El mismo archivo en
   varias páginas (el mismo blob) se guarda y se sube **una sola vez** (desde v0.061; ver abajo). Quedan en el
   dispositivo y la sincronización los sube al Drive por el portero, a
   `LGA_ShotDocs/<Proyecto>/<día de la importación>`. La app tiene que quedar abierta hasta que el estado
   diga que se subió todo.
3. **Contenido**: el HTML se convierte en bloques (`src/import/codaHtml.ts`) y se escribe en el documento de
   la página con un editor sin pantalla, sobre la estructura inicial de siempre.

### Si se corta: seguir donde quedó

Mientras importa, la app anota en el dispositivo (`meta` de la base local, clave `codaImport:<id del doc>`;
la tabla ya existía, la base no cambia) qué página de la app es cada página de Coda, la huella de lo que la
importación escribió en cada una, cuáles están terminadas y la dirección `sdmedia://` de cada archivo apenas
queda guardado. Al volver a elegir la misma carpeta el diálogo lo dice ("no terminó: 12 de 35 páginas") y
ofrece **Seguir**, que continúa en el mismo proyecto: no crea otra vez las páginas ya creadas, saltea las
terminadas y usa los archivos ya guardados en vez de guardarlos (y subirlos al Drive) de nuevo. **Importar a
un proyecto nuevo** empieza de cero (el proyecto a medias queda: la app todavía no borra ni archiva proyectos, ver
P.14 del roadmap; se le puede cambiar el nombre y mandar sus páginas a la papelera).

- **Qué queda para seguir.** La anotación se borra solo cuando todas las páginas quedaron terminadas. Queda
  sin terminar una página cuyo contenido no se pudo escribir ("3 archivos quedaron guardados pero la página no
  se pudo escribir") o a la que le faltó guardar un archivo (sin espacio en el dispositivo, por ejemplo): al
  seguir se reintenta, con los archivos ya guardados, y solo se guarda lo que faltó. Un archivo que no está en
  la carpeta no deja la página sin terminar (volver a probar no lo trae). Se corta a mitad (se cerró la app, se
  cortó la luz) igual: lo que no llegó a terminar se sigue.
- **Nunca pisa lo que escribió la persona.** Antes de escribir una página sin terminar, se mira qué tiene: si
  está vacía (la raíz inicial) o sigue igual a lo que dejó la importación (misma huella: texto, formato y
  elementos en orden), se reemplaza. Si la importación no la había llegado a escribir y la persona escribió
  algo, lo importado va debajo de su texto. Si la importación la había escrito y la persona la cambió después,
  queda como la dejó (lo que había fallado ahí no se reintenta). Las dos cosas quedan anotadas.
- **Una página terminada** no se vuelve a tocar al seguir, aunque la persona la haya mandado a la papelera
  (no vuelve). Una sin terminar que se mandó a la papelera sí se crea de nuevo.
- **Si el proyecto ya no está** (se perdió el acceso), la anotación se borra al elegir la carpeta.
- **Huecos que quedan** (un corte en el instante justo): una página creada y no anotada todavía se crea de
  nuevo al seguir (queda una vacía de más, con el mismo título), y un archivo guardado y no anotado todavía se
  guarda de nuevo (entra dos veces al Drive; la copia de más, sin página que la use, va a la papelera de
  archivos a los pocos minutos, en un workspace que la tiene). `tree.create` y `media.add` eligen su propio id, así que no hay cómo anotar
  antes de crear.

### El manifest

Sin `pages` (o si no es JSON) es un error claro antes de mostrar nada. Lo que falta en una página toma un
valor por defecto: sin nombre entra como "Untitled", sin orden va por orden de llegada, sin `media` sin
archivos, sin id (o con el id repetido) recibe uno propio, derivado de lo que tiene (nombre, padre, orden,
archivo) y no de su lugar en la lista, así la anotación para seguir lo reconoce aunque el manifest cambie de
orden (solo pasa con un manifest roto: coda-export siempre pone el id de Coda). Una página cuyo padre no está en el manifest, o que
forma un círculo con otras (A dentro de B dentro de A), va al primer nivel y queda anotada: ninguna se pierde.

### La conversión

BlockNote convierte texto, títulos, listas, checklists, tablas, citas y código. Lo demás lo resuelve
`codaHtml.ts`:

- **Fotos.** BlockNote descarta una `<img>` adentro de un párrafo o de un ítem de lista (Coda las pone
  siempre así) y todo `<video>`. Antes de convertir, cada archivo se cambia por una marca de texto y después
  cada marca pasa a ser un bloque `image` con su `sdmedia://`. Una foto adentro de un ítem queda adentro del
  ítem (con el texto que sigue), como se veía en Coda; una en una tabla va debajo de la tabla.
- **Ancho.** El ancho con que se veía en Coda pasa a `previewWidth` si es menor que 700 px; más ancho, la foto
  va sin ancho propio (a lo ancho de la página).
- **Nombre.** El de Coda si es un nombre de archivo; si Coda solo sabe el blob, `bl-….<ext>`.
- **Colores.** Coda escribe `rgb(...)`; se pasa al color con nombre más parecido del editor (por tono). El
  gris del texto de cuerpo de Coda se saca.
- **Guion.** Los párrafos debajo de un título "Guion" (o "Script") pasan a texto Script; los fondos que en
  Coda se ponían a mano en INT/EXT y DÍA/NOCHE se sacan, porque Script ya los marca.
- **Una foto adentro de un link** sale del link y queda como foto; el link sigue si tenía texto. Si el link
  apunta al mismo archivo de Coda (Coda envuelve así la foto para abrirla grande), queda solo el texto: si
  no, la foto entraría dos veces.
- **El mismo archivo dos veces en una página** (el mismo blob) se guarda una vez; los dos bloques usan la
  misma dirección. **Desde v0.061, también en páginas distintas** de la misma importación (una foto de una
  tabla de Coda sale en la tabla y en cada vista): la primera página lo guarda y las demás usan su
  `sdmedia://`. La app suma sola el uso de cada página (`link_page_file`, el mismo camino que copiar un bloque
  entre páginas; si el archivo todavía no llegó al servidor, reintenta), así que el portero lo muestra en
  todas y la papelera de archivos solo lo toma cuando ninguna página lo usa. En el diario queda anotado por
  página con `shared: true` (no se cuenta dos veces en "archivos"). Al seguir una importación cortada, solo se
  reusan archivos de páginas **sin terminar**: el de una página terminada pudo quedar sin uso (la persona lo
  borró) y hasta mandarse a la papelera del Drive, así que la página que falta guarda su propia copia. El
  diálogo cuenta cada archivo una vez. Entre proyectos distintos, no se reusa.
- **Links entre páginas del doc** (desde v0.061). El comando escribe `href="coda-page:<id del manifest>"` en
  un link a otra página del mismo doc (acuerdo con quien hace el comando: el formato lo fija `codaHtml.ts`,
  `CODA_PAGE_SCHEME`). Antes de convertir, cada uno pasa a la dirección de la página creada, `/p/<id>`
  (relativa: vale en cualquier dirección de la app); hace falta antes porque el editor descarta un link con
  un esquema que no conoce. Como todas las páginas se crean primero, un ciclo A ↔ B se resuelve solo, y al
  seguir una importación cortada salen a las mismas páginas (una hija cuya madre no se pudo crear en esa
  primera pasada espera a la segunda, para no quedar en el primer nivel). Uno a un id que no está en el
  manifest (o cuya página no se pudo crear) queda como su texto, sin link, y se anota una vez por página con
  el texto del link. Un link a una página
  que después se mandó a la papelera sigue apuntándola (si vuelve, anda). En la app, un clic en un link a una
  página de la app la abre en la misma pestaña (ver `src/ui/internalLinks.ts`).
- **Las marcas** son caracteres de uso privado (U+E000, U+E001). Antes de marcar se sacan del texto y de los
  atributos que trae Coda, así nada escrito se confunde con una marca.
- **Fotos que no están en Coda** (una dirección de otro sitio): no hay archivo que subir. Una `https` queda
  enlazada a su sitio y anotada; cualquier otra (`http`, `data:`, una ruta suelta) se saca y se anota. Vale
  también para las que BlockNote convierte por su cuenta: después de convertir se revisa cada bloque `image`
  que no quedó con `sdmedia://`.
- **Videos de Coda** (`<video><source>`): igual que una foto, un bloque `image` con su `sdmedia://`.
- **Red de seguridad.** Una foto ya guardada que la conversión no llegó a ubicar va al final de la página y
  queda anotada: nunca se pierde en silencio.
- **Videos embebidos** (YouTube, Vimeo), un `<video>` de otro sitio o un `<embed>`: quedan como link y se
  anotan en la lista (no hay archivo que traer).
- **Subtítulo** de la página de Coda: un párrafo en cursiva arriba de todo.

### Lo que no pasa

- **El ícono de la página** de Coda (en MGTZD, el estado de cada escena: ok, importante, cancelada): queda en
  el manifest pero la app todavía no muestra íconos de página.
- **Tablas y vistas de Coda** (bases de datos): la API las da aparte (`/tables`); falta el paso para docs con
  tablas.
- **Una página que no es texto** (embebida o sincronizada de otro doc): entra vacía y queda anotada.
- **Un editor por página.** Cada página se escribe con un editor sin pantalla atado a su documento; la atadura
  (colaboración) se fija al crear el editor, así que no se puede reusar uno para todas. El que convierte el
  HTML sí es uno solo para toda la importación.

## 3. Comentarios

Desde v0.060 los comentarios de Coda entran con la importación, también los de personas que no tienen cuenta
en la app. Esas personas no se enteran de nada: no se les crea cuenta, no se las invita y la app no manda
correos por comentarios.

### Dónde están

- **La API REST de Coda no los da.** La especificación (`https://coda.io/apis/v1/openapi.json`, versión 1.6.0)
  no tiene ningún endpoint de comentarios: solo aparece "comment" como nivel de permiso de un doc.
- **La exportación HTML tampoco** (`beginPageContentExport`): el HTML de una página con comentarios no trae
  ni el texto ni una marca de dónde estaban, ni los ids `cl-…` de los bloques.
- **El servidor MCP de Coda (Superhuman Docs MCP) sí**: `content_read` con
  `contentTypesToInclude: ["comments"]`, página por página. Es de solo lectura. El mismo servidor tiene
  herramientas que escriben (`comment_add`, `comment_resolve`, `comment_delete`, las de notificaciones):
  **para capturar no se usa ninguna**, porque avisarían a la gente del doc.

Lo que devuelve, por hilo (verificado con MGTZD el 2026-09-30):

```json
{
  "threadUri": "threads/r-…",
  "state": "Active | Resolved | New",
  "reference": { "type": "text", "text": "- el texto marcado, en Markdown", "referenceBlockIds": ["cl-…"] },
  "comments": [
    { "commentUri": "comments/i-…", "authorName": "…", "authorEmail": "…", "userId": 123,
      "createdAt": 1790794845.411, "text": "…", "reactions": [] }
  ]
}
```

- `createdAt` son segundos Unix con decimales. El primer comentario abre el hilo; los demás son respuestas.
- `reference` es `null` cuando el hilo no está pegado a nada (en MGTZD, todos los de ese tipo estaban
  resueltos). Coda no dice quién resolvió un hilo ni cuándo.
- Las reacciones no se importan.

### La captura: `comments.json`

La hace alguien con el MCP de Coda conectado, **después** de `coda-export` (y con `--refresh` si el doc
cambió): para cada página del manifest, `content_read` con `comments`, y la respuesta tal cual, sin
transformarla, en `comments.json` en la raíz de la carpeta exportada:

```json
{
  "source": "Coda MCP content_read, contentTypesToInclude: [\"comments\"]",
  "docId": "<el doc.id del manifest>",
  "capturedAt": "2026-09-30T23:30:00Z",
  "pages": { "<id de la página del manifest, canvas-…>": [ <hilo>, … ], "…": [] }
}
```

- Todas las páginas del manifest van en `pages`, también las que no tienen hilos (`[]`): así se ve que la
  captura está completa.
- Tiene nombres y correos de otras personas: queda en la carpeta exportada (fuera del repo, `Coda_Export/`
  está en `.gitignore`) y en la base del workspace. Nunca en el repo ni en las pruebas.
- El comando `coda-export` no puede hacerla: habla con la API REST, que no tiene comentarios.

### Cómo entran (`src/import/codaComments.ts`)

- **Al elegir la carpeta** el diálogo dice cuántos comentarios trae. Un `comments.json` roto o de otro doc
  (`docId` distinto del manifest) queda anotado y la importación sigue sin comentarios.
- **Página por página**, apenas se escribe su contenido, sus hilos van a la cola de comentarios
  (`CommentQueue.importComments`, una operación `import`) y suben con la sincronización cuando la página
  llegó al servidor, como cualquier comentario hecho sin red.
- **Dónde va cada hilo:** al bloque de la página que tiene el texto marcado, comparado sin el Markdown de
  Coda (viñetas, casillas, títulos, negritas, cursivas, links, escapes), sin mayúsculas ni tildes y con los
  espacios juntados. Primero un bloque cuyo texto es exactamente ese (entero, o una de sus líneas si abarcaba
  varios bloques), o una **celda de una tabla** con exactamente ese texto (desde v0.062: el hilo queda en el
  bloque de la tabla, aunque el texto sea corto; así entran los comentarios de las filas de una tabla de Coda
  que se importa como tabla, pegados al texto de su primera celda); si no hay, el primero que lo contiene, de la línea más larga a la más corta y solo con
  textos de 8 letras o más, o de dos palabras ("ok" no se busca adentro de "Plano 12: ok"). Si no se encuentra
  (se borró en Coda, por ejemplo), el hilo va a la página entera y queda anotado en la lista del final. Sin
  `reference`, o con un texto que queda vacío al limpiarlo, va a la página entera sin anotarlo.
- **Autor:** un comentario con el correo de quien importa queda a su nombre (es suyo: lo edita y lo borra
  como cualquier otro). Los demás quedan sin autor de la app, con el nombre y el correo que da Coda; se ven
  con el nombre, la marca "from Coda" y el correo en el tooltip; el tooltip de la marca dice quién los importó.
  Nadie los edita; los borra quien tiene editar y crear páginas. Se responden y se resuelven como cualquier
  otro.
- **Fechas:** la original de cada comentario. Un hilo resuelto entra resuelto, con la fecha de su último
  comentario (Coda no dice cuándo se resolvió) y sin quién.
- **Ids estables:** el id de cada comentario sale del proyecto y del `commentUri` de Coda (SHA-256 con forma
  de uuid). Seguir una importación cortada no repite nada: lo que ya está en la cola no se vuelve a poner, y lo
  que ya subió lo reconoce la base. Si la página se vuelve a escribir al seguir (sus bloques cambian de id), el
  hilo pasa al bloque nuevo: si todavía no salió de la cola, ahí mismo; si ya subió, la base lo mueve (con sus
  respuestas) al recibirlo de nuevo.
- **Datos raros:** un comentario sin texto en Coda (solo una imagen o un adjunto) entra como "(no text in
  Coda)", así el hilo no se pierde; un nombre de más de 200 caracteres se corta; un correo que no parece correo
  no se guarda; una fecha anterior a 2000 o futura queda como la de la importación. Uno de más de 10.000
  caracteres se corta.

### En la base (`20260930200000_comentarios_importados.sql`)

- `comments` suma `imported_from` (`'coda'`), `imported_author`, `imported_author_email` e `imported_by`.
  Un autor de afuera va con `author_id` nulo.
- `import_comment(...)` escribe uno: pide **editar y crear páginas** sobre la página (importar arma
  contenido con autores y fechas de otra herramienta: un invitado que solo edita no puede), acepta solo el
  origen `coda` y fechas desde 2000 y no futuras, guarda la fecha original en `created_at` y la de la
  importación en `updated_at` (así los demás dispositivos lo bajan solos), acepta el hilo resuelto y es
  idempotente por id, como `add_comment`. El mismo comentario importado de nuevo por la misma persona con otro
  bloque no es un conflicto: el hilo pasa a ese bloque con sus respuestas (seguir una importación).
- `list_comments` y `comments_view` devuelven las columnas nuevas, y `comment_authors` suma a quien importó.
  Quien ve la página ve el nombre y el correo del autor importado (como los correos del equipo).
- Compatible con la app publicada: una versión anterior muestra un comentario importado de otra persona como
  de una cuenta borrada, sin perder nada. **Antes de importar, recargar todas las pestañas de la app**: una
  versión anterior a v0.060 que tome el control de la sincronización no conoce la operación `import` de la
  cola y la daría por subida sin mandarla. Por si pasa igual, cada comentario importado queda además en
  `meta` del dispositivo (`import:<id>`) hasta que el servidor lo confirma, y al abrir la app vuelve a la cola
  si desapareció sin llegar.
- Si se restaura una copia de seguridad de la base, todo lo que importó una persona (de afuera o suyo) vuelve
  solo desde su dispositivo, con su autor, su fecha y resuelto si entró resuelto, como cualquier comentario
  propio.

## Migración definitiva

Lo importado hasta ahora es una prueba. Después de importar, Coda se siguió editando (en MGTZD, cinco páginas
cambiaron): la importación no se entera de los cambios posteriores. Para migrar de verdad un doc:

1. Dejar de editarlo en Coda.
2. Bajarlo de nuevo con `--refresh` (o a una carpeta nueva) y capturar de nuevo sus comentarios.
3. Importarlo a un proyecto nuevo y comprobarlo.
4. El proyecto de prueba queda: la app todavía no borra ni archiva proyectos (P.14 del roadmap). Mientras tanto se le
   cambia el nombre y se mandan sus páginas a la papelera.

## Cómo quedó

- `scripts/coda-export.mjs` y `scripts/lib/codaExport.mjs` (lo que decide sin red: a qué dirección va el
  token, el nombre de cada archivo, las opciones), probado en `scripts/coda-export.test.mjs`.
- `src/import/codaHtml.ts`: la conversión del HTML. `src/import/codaImport.ts`: el manifest, el orden del
  árbol, la importación y su anotación para seguirla. `src/import/importJob.ts`: el estado de la importación
  afuera del diálogo (primera carga, sin lo que pesa).
- `src/ui/ImportCodaDialog.tsx` (se baja aparte, con sus textos en `src/i18n/lazy/importCoda.ts`); la entrada
  del menú (`import.menu`, con su ícono propio) está en la primera carga.
- `src/import/codaOwner.ts`: quién ve "Importar de Coda" (solo la cuenta de Lega, por el hash de su correo).
- `src/import/codaComments.ts`: `comments.json`, el anclaje por texto, los ids estables y los comentarios para
  la cola; la operación `import` de la cola en `src/sync/comments.ts`; `import_comment` en
  `supabase/migrations/20260930200000_comentarios_importados.sql`.

### Correcciones de la auditoría (2026-09-30)

Sobre la primera entrega, una auditoría pidió (con su numeración):

2. **Importación cortada**: quedaba el proyecto a medias y archivos sin usar, y volver a importar duplicaba
   todo en el Drive. Ahora la app avisa antes de cerrarse mientras importa y la importación se sigue donde
   quedó, sin repetir páginas ni archivos (ver "Si se corta"). En vez de escribir primero la página y después
   los archivos (dos escrituras por página), la anotación guarda cada archivo apenas queda guardado: al seguir
   se reusa, y si la página no se pudo escribir queda anotado en la lista.
3. **Textos en inglés** en los errores y la lista del final: todo pasa por `t()`, en castellano e inglés. Sin
   portero, el diálogo lo dice de entrada.
4. **Marcas**: se sacan del texto antes de marcar.
5. **Fotos de otros sitios**: enlazadas si son https (anotadas), afuera si no (anotadas).
6. **Manifest**: revisado al elegir la carpeta; nombre por defecto; padres que faltan y círculos al primer
   nivel, anotados.
7. **Páginas que no son texto**: anotadas; lo que anotó el comando se muestra al final.
8. **Mismo archivo dos veces**: se guarda una vez, también cuando un link de Coda envuelve la misma foto.
9. **Respiro entre páginas** y progreso "Página 1 de N" (antes decía "0 de N"). Reusar el editor que escribe
   no se puede (ver "Lo que no pasa").
10. **Diálogo**: su estado vive afuera y lo dibuja el Shell; peso y espacio libre antes de empezar; mensaje
    en el iPad; ícono propio en el menú.
11. **Comando**: token solo a la API de Coda, `--refresh`, nombres sin choques para direcciones sin blob,
    `.coda-token` y `Coda_Export/` en `.gitignore`.

### Segunda verificación (2026-09-30)

Una segunda revisión de las correcciones encontró, y quedó corregido:

1. **La anotación se borraba al terminar aunque hubiera páginas fallidas**, así que "seguí la importación"
   no se podía; volver a importar subía todo de nuevo. Ahora queda mientras falte alguna página, y una página
   con un archivo que no se pudo guardar (sin espacio) queda sin terminar para reintentarlo.
2. **Seguir pisaba una página a medias que la persona había editado.** Ahora se compara con la huella de lo
   que escribió la importación: nunca se reemplaza lo de la persona (va debajo, o la página queda como está).
3. Las páginas terminadas que se mandaron a la papelera ya no vuelven al seguir.
4. Los huecos de un corte en el instante justo quedan explicados arriba.
5. Cerrar la sesión, la pantalla de "te sacaron" y tomar el control desde otra ventana tienen en cuenta una
   importación en curso.
6. Videos y embebidos de otros sitios quedan como link y anotados.
7. Una anotación cuyo proyecto ya no está se borra.
8. Los ids que faltan en el manifest no dependen del orden.
9. La prueba de la primera carga (`src/ui/firstLoad.test.ts`) cuenta el diálogo, la importación y sus textos
   entre lo que se baja aparte.

Además, `coda-export` no sigue redirecciones en los pedidos con token.

## Prueba

`src/import/codaImport.test.ts`: la conversión con HTML con la forma del de Coda (sin datos de clientes:
fotos en párrafos, ítems, links, títulos y tablas, videos, párrafos con solo un link, colores, guion) y la
importación entera contra el servidor y el portero en memoria, con un segundo dispositivo que ve las fotos y
un documento que la app abre (sin contenido desconocido y con una sola raíz); una página que falla no corta
el resto. Y cada corrección de la auditoría: una importación cortada que se sigue sin duplicar nada en el
Drive, los textos en castellano, las marcas escritas en el texto, fotos de otros sitios, un manifest con
faltantes y círculos, páginas que no son texto, el mismo archivo dos veces, el respiro entre páginas y el
progreso; y de la segunda verificación: seguir después de una página que no se pudo escribir o de un archivo
sin espacio (sin volver a guardar nada), una página editada después del corte (escrita o no por la
importación), una terminada en la papelera, un diario sin proyecto, videos de otros sitios, ids estables y la
marca para otra ventana. `src/ui/importCodaDialog.test.tsx`: el diálogo sin Drive, en el iPad, con el
resultado que sigue ahí después de desmontarlo, cerrar la sesión con una importación en curso, y la entrada
del selector de proyectos: escondida para otro correo, visible (y abre el diálogo) para uno cuyo hash es el
permitido, con el hash permitido de un correo de prueba (el real no aparece en las pruebas);
`src/import/codaOwner.test.ts`, el hash (sin espacios, en minúsculas), sin correo o sin Web Crypto nadie, y
una sola vez por usuario; `src/ui/team.test.tsx`, la pantalla de "te sacaron" con una importación en curso.
Con MGTZD real (35 páginas, 32 fotos, 28 MB) se probó igual, fuera del repo, el 2026-09-30, primero sin
comentarios y después con ellos (12 hilos y 13 comentarios en 6 páginas, 7 resueltos, 6 sin texto marcado):
entraron todos, cada uno en su lugar.

Comentarios: `src/import/codaComments.test.ts`, con `comments.json` inventado con la forma del MCP de Coda: el
Markdown de Coda normalizado, el anclaje (texto exacto antes que contenido, textos cortos, cursivas, varias
líneas, texto que ya no está, sin anclaje), datos raros (sin texto, nombre largo, correo inválido, fecha
imposible), ids estables por proyecto, lo propio a nombre de quien importa, y la importación entera contra el
servidor en memoria (cada hilo en el bloque con su texto, resueltos, a la página, otro dispositivo que los ve,
seguir sin repetir, sin red y con red después de subir, con los bloques nuevos, un `comments.json` roto, de otro
doc o sin cola). `src/sync/commentsImport.test.ts`: la cola
(fecha original, autor de afuera, esperar a la página, reintentos, textos vacíos o largos, la base sin
`import_comment`, pedir editar y crear, quién edita y borra, restaurar una copia, una versión vieja que los saca
de la cola, borrar antes de subir). `supabase/tests/comentarios_importados_permisos.sql`: la
función en la base.
