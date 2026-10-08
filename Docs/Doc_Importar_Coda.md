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
node scripts/coda-export.mjs --convert-only "<carpeta exportada o nombre del doc>"
```

Si el doc tiene tablas, además las baja y las convierte en páginas (ver "Tablas", abajo), y si tiene fotos
HEIC las pasa a JPEG (ver "Fotos HEIC"). `--convert-only` repite solo esas conversiones, sin token (solo baja,
si faltan, archivos guardados en Coda): para probar `tables.config.json` sin volver a bajar el doc, o para
convertir las fotos que faltaban.

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
  - `media/`: los archivos. Una foto HEIC queda como JPEG, y su original en `media-originals/` (ver "Fotos
    HEIC").
- **Se puede cortar y volver a correr**: lo que ya está en la carpeta no se vuelve a pedir. Cada archivo se
  escribe primero como `.part` y se renombra al terminar (y se compara con el tamaño que dijo el servidor),
  así un corte nunca deja uno a medias que la corrida siguiente dé por bueno. Los archivos se bajan en
  streaming (un video grande no pasa entero por la memoria). Ante un corte de red, un 429 (límite de pedidos)
  o un error del servidor, espera y reintenta hasta 8 veces. Si algo igual falla, termina con error y lo lista:
  se vuelve a correr y trae solo lo que falta.
- **Lo ya bajado no se actualiza.** Como vuelve a usar lo que está en la carpeta, una página que cambió en
  Coda después de bajarla queda como estaba. `--refresh` vuelve a pedir el HTML de todas las páginas (los
  archivos no: un blob de Coda es siempre el mismo archivo); borrar la carpeta también sirve.
- La misma foto usada en dos páginas se baja una vez; desde v0.061 en la app también entra una vez.
- Una página que no es texto (una página embebida o sincronizada de otro doc) no se exporta: queda anotada en
  `problems` del manifest y en la app entra vacía. **Salvo una embebida con su dirección en `embeds.json`**
  (desde v0.066, ver abajo).

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
- **Al terminar**: cuántas páginas y archivos entraron ("Imported N pages and M files."; desde v0.211 N cuenta
  las páginas terminadas, no las del manifest: con una que quedó para seguir es menor), la lista de lo que no se
  pudo traer y, aparte, lo que anotó el comando al bajar el doc (`manifest.problems`). Si quedó algo para reintentar, lo dice ("elegí la misma
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

Cada importación de un doc es una **generación** con identidad propia (desde v0.211). Mientras importa, la app
anota en el dispositivo (`meta` de la base local, clave `codaImport2:<id del doc>`; la tabla ya existía, la base
no cambia) las generaciones de ese doc y cuál es la vigente; de cada una, qué página de la app es cada página de
Coda, cuáles están terminadas y la dirección `sdmedia://` de cada archivo apenas queda guardado. Al volver a
elegir la misma carpeta el diálogo lo dice ("no terminó: 12 de 35 páginas") y ofrece **Seguir**, que continúa la
generación vigente en el mismo proyecto: no crea otra vez las páginas ya creadas, saltea las terminadas y usa los
archivos ya guardados en vez de guardarlos (y subirlos al Drive) de nuevo.

- **La identidad se reserva antes de crear el proyecto.** En una sola transacción de la base local quedan
  anotados el id de la generación, el del proyecto y el de la operación que lo crea, con el nombre elegido. Recién
  después se crea el proyecto con esos ids: la operación entra a la cola de salida junto con su recibo y con el
  registro de a qué operación pertenece ese proyecto, también en una sola transacción (si se aborta, no queda
  ninguna de las tres cosas). Si se corta entre la reserva y el proyecto, reintentar o **Seguir** usa los mismos
  ids: no aparece un segundo proyecto ni una segunda operación en la cola, tampoco con un doble clic, después de
  cerrar y abrir la app o cuando el servidor ya confirmó la operación. Un recibo que no coincide con la reserva
  (otro id, otro nombre, incompleto o de un formato que la app no conoce) frena la importación sin escribir nada, y
  una reserva nunca toma un proyecto que no creó ella. El nombre se reserva como se guarda, cortado a 200 caracteres
  y sin espacios en las puntas: uno más largo que al cortarse terminaba en un espacio hacía fallar la importación, y
  ya no (así queda el nombre de cualquier proyecto nuevo, no solo de los importados).
- **Después de un error**, el diálogo mira lo que quedó guardado y ofrece **Seguir** e **Importar a un proyecto
  nuevo** ahí mismo, sin volver a elegir la carpeta. Cambiar el nombre y elegir el proyecto nuevo es otra
  importación, con su propia reserva: entra con el nombre nuevo.
- **Importar a un proyecto nuevo** abre otra generación, con otro proyecto y otros ids. La anterior queda como
  estaba: su proyecto, el contenido de sus páginas (también lo que la persona escribió ahí), sus archivos, sus
  comentarios en cola y su anotación no se tocan, pero deja de ofrecerse para seguir. Si el intento se corta,
  repetirlo usa los ids de ese mismo intento. El proyecto a medias se puede borrar desde el selector (desde P.14;
  va a la papelera de proyectos: `Doc_Proyectos_Borrar.md`).
- **Al terminar, la anotación se conserva.** Cuando todas las páginas quedaron terminadas la generación se marca
  como terminada: no se borra (hasta v0.210 se borraba) y ya no ofrece seguir. Importar otra vez la misma carpeta
  crea otro proyecto, como siempre, en una generación nueva y sin tocar el anterior.
- **El registro no crece sin fin (D307, desde v0.213).** De las importaciones terminadas de una misma carpeta se
  conserva el detalle (qué página es cada una y la dirección de cada archivo) de las tres más recientes. De las
  anteriores queda solo la identidad: la generación, el proyecto, la operación que lo creó y el nombre, que alcanzan
  para que ninguna reserva nueva repita un proyecto. Se poda al terminar una importación. Nunca se toca una sin
  terminar, ni la que vino de un registro de un solo diario, ni los registros archivados de versiones anteriores
  (D304). Los proyectos, sus páginas y sus archivos no cambian: la poda es solo del registro del dispositivo.
- **La carpeta vuelta a exportar sin una página (D306, desde v0.213).** Si entre el corte y **Seguir** la carpeta
  se exportó de nuevo y ya no trae una página que había quedado sin terminar, esa página no impide terminar: la
  importación se cierra cuando están terminadas las páginas que la carpeta trae ahora. La que ya no está queda en
  el proyecto como estaba (no se borra nada de lo importado), sigue anotada en el registro y sale en la lista del
  final ("ya no está en la carpeta exportada: queda en el proyecto como la dejó la importación cortada", porque
  puede haber quedado vacía o a medias). Hasta v0.212 cada **Seguir**
  terminaba en "Entró todo, pero la importación no se pudo anotar como terminada".
- **Si entró todo y no se pudo anotar como terminada**, el aviso nombra las dos salidas (desde v0.213): **Seguir**
  y, si **Seguir** vuelve a decir lo mismo, **Importar a un proyecto nuevo**, que entra entero a otro proyecto. Al
  elegir la carpeta otra vez el diálogo ya no dice "no terminó (1 de 1 páginas)": dice que trajo todo y no quedó
  cerrada, y que **Seguir** la cierra. La lista del final se titula "N cosas para revisar" (antes, "no se pudieron
  importar", que contradecía ese renglón).
- **Una carpeta sin el id del doc** (un manifest que no lo trae) se avisa al elegirla, y no deja importarla (desde
  v0.213; antes el aviso salía recién al apretar **Importar**).
- **Otra pestaña importando la misma carpeta.** Si después de elegir la carpeta otra pestaña dejó una importación
  de ese doc sin terminar, **Importar** no crea un segundo proyecto: avisa que hay una importación anterior sin
  terminar y ofrece seguirla o importar a un proyecto nuevo.
- **Todo o nada por página (D305, desde v0.211), solo ante fallos que se pueden reintentar.** Cada página se
  escribe entera y una sola vez. Si uno de sus archivos no se pudo guardar por algo que puede cambiar al probar de
  nuevo (el dispositivo no tiene dónde guardar archivos, es un adjunto y el Drive no está conectado, no entra en la
  cuota, no hay espacio al guardarlo, no se pudo leer del disco, o el registro de la importación no se pudo
  guardar), queda anotado en la lista del final y la página **no se escribe**: los archivos que sí se guardaron
  quedan anotados, al seguir se guarda solo el que faltó y la página entra entera, con el texto y todas sus fotos.
  Hasta v0.210 entraba con el texto y las demás fotos, y al seguir se reescribía. **Lo definitivo no deja la página
  para seguir**, porque volver a probar da lo mismo: un archivo que no está en la carpeta, uno vacío (0 bytes) o uno
  que pasa el tope por archivo, una página sin su HTML o un `comments.json` que no se puede leer se anotan y la
  página entra con su texto y lo demás. Que la página entre con lo que hay es lo publicado desde antes: sin cambios.
  Una página que no se pudo escribir o guardar en el dispositivo también queda para seguir, con el motivo en la
  lista del final ("3 archivos quedaron guardados pero la página no se pudo escribir", "todavía no se pudo guardar
  en este dispositivo"). Si se corta a mitad (se cerró la app, se cortó la luz), igual: lo que no llegó a terminar
  se sigue.
- **Nunca pisa lo que escribió la persona.** Antes de tocar una página, la importación arma aparte el resultado
  completo, lo anota en el dispositivo (el plan de esa página) y recién después lo aplica al documento; la página
  se da por terminada cuando el documento quedó guardado igual al plan. Si la persona escribió en una página que
  había quedado para seguir, su texto queda arriba y lo importado va debajo, entero, y queda anotado ("tu texto
  queda y lo importado va debajo"). Si la página cambia justo mientras se importa, el plan no se aplica y la
  página queda para seguir. Ya no existe «queda como la dejaste» (hasta v0.210, una página que la importación
  había escrito a medias y la persona había cambiado no se volvía a intentar): con el todo o nada, una página o
  no está escrita o está escrita entera.
- **Una página ya escrita no se vuelve a escribir al seguir.** Sus bloques conservan sus ids, así que los
  comentarios anclados a ellos no cambian de lugar, y lo que la persona editó después queda. Una terminada no se
  vuelve a tocar aunque la persona la haya mandado a la papelera (no vuelve). Una sin terminar que se mandó a la
  papelera sí se crea de nuevo.
- **Un corte entre anotar el plan y aplicarlo.** Al seguir se mira cuánto del plan llegó al documento. Si no
  llegó nada, el plan se descarta y la página se planifica de nuevo sobre lo que hay ahora (lo escrito queda
  arriba). Si llegó entero, vale como aplicado aunque la persona haya editado la página después, y no se toca.
  En cualquier otro caso la página no se toca y su renglón en la lista del final dice cómo salir (**Importar a un
  proyecto nuevo**).
- **Un bloque importado con el id de uno que la persona ya tiene.** En una página que quedó para seguir, si la
  persona ya tiene un bloque con el mismo id que uno de los que hay que importar (pasa con un archivo de Shot Docs,
  que conserva los ids de los bloques), la página no se toca: lo suyo no se pisa y lo importado no entra. **Seguir**
  da el mismo resultado todas las veces; la salida es **Importar a un proyecto nuevo**, y el renglón de la página lo
  dice ("no se pudo preparar para importar, y Seguir va a dar lo mismo; usá Importar a un proyecto nuevo").
- **Si el proyecto ya no está** (se perdió el acceso, o está en la papelera de proyectos), no se ofrece seguir y
  la anotación se conserva. Si el proyecto se restaura antes de importar de nuevo, se puede seguir. **Importar**
  sobre la misma carpeta crea un proyecto nuevo en otra generación (desde v0.211; la anterior queda guardada como
  estaba), y a partir de ahí la importación anterior ya no se puede seguir aunque su proyecto vuelva de la
  papelera.
- **Un registro de importación de una versión anterior a v0.211 (D304)** (clave `codaImport:<id del doc>`, de una
  importación que quedó sin terminar) no bloquea y no se puede seguir: al elegir la carpeta se ofrece **Importar**,
  que entra a un proyecto nuevo. El proyecto que había quedado a medias no se toca, y el registro viejo no se
  convierte ni se borra: en la misma transacción que reserva la importación nueva pasa entero a una clave de
  archivo del dispositivo (`codaImportEarlier1:<id del doc>:<uuid>`; un archivado nunca se pisa).
- **Un registro que esta versión no puede leer** (de una versión más nueva de la app, por ejemplo): el diálogo lo
  dice al elegir la carpeta, pide actualizar la app y cerrar sus otras pestañas, y no toca el registro.
- **Los motivos se leen.** Lo que quedó pendiente sale en el diálogo y en la lista del final con un texto en
  inglés o en castellano, del diccionario de la app (`import.pending.*`, y para los comentarios
  `commentError.importMoved` y `commentError.importEarlier`); el nombre interno del estado nunca llega a la
  pantalla.
- **Cada página y cada archivo se anotan antes de crearse (desde v0.213).** Como el proyecto: el id de la página
  se guarda en el registro y recién después se crea con ese id (`tree.create` con `id`); el de cada archivo que
  falta guardar se anota antes de guardar ninguno, en un solo guardado del registro por página (`reserved`), y se
  guarda con ese id (`media.add` con `id`). Crear o guardar dos veces con el mismo id es hacerlo una vez: la página
  que ya está en el árbol o en la cola no se encola de nuevo, y el archivo que ya está en el dispositivo devuelve su
  dirección sin guardarse ni subirse otra vez. Entonces, si la app se corta entre anotar y crear, **Seguir** crea
  con el mismo id; si se corta entre crear y volver, no crea nada. Si el registro no se puede guardar, no se crea
  nada (hasta v0.212 la página se creaba y se anotaba con el guardado siguiente). Ya no queda una página vacía de
  más ni un archivo local de más.
- **Una página pendiente que se mandó a la papelera** se reemplaza por otra, con un id nuevo que también se anota
  antes de crearla: si ese guardado falla, no se crea, y al reintentar queda una sola. Hasta v0.212, con el
  registro fallando justo ahí, podían quedar dos.

### El manifest

Sin `pages` (o si no es JSON) es un error claro antes de mostrar nada. Sin el id del doc (`doc.id`) la carpeta no
se importa (desde v0.211): no habría con qué reconocer esa importación para seguirla ni para no repetirla, y al
apretar **Importar** el diálogo pide exportar el doc de nuevo con coda-export, sin crear nada (hasta v0.210 se
importaba, sin poder seguirla). Lo que falta en una página toma un
valor por defecto: sin nombre entra como "Untitled", sin orden va por orden de llegada, sin `media` sin
archivos, sin id (o con el id repetido) recibe uno propio, derivado de lo que tiene (nombre, padre, orden,
archivo) y no de su lugar en la lista, así la anotación para seguir lo reconoce aunque el manifest cambie de
orden (solo pasa con un manifest roto: coda-export siempre pone el id de Coda). Una página cuyo padre no está en el manifest, o que
forma un círculo con otras (A dentro de B dentro de A), va al primer nivel y queda anotada: ninguna se pierde.

### La conversión

BlockNote convierte texto, títulos, listas, checklists, tablas, citas y código. Lo demás lo resuelve
`codaHtml.ts`:

- **Fotos (desde v0.078, en el renglón).** BlockNote descarta una `<img>` adentro de un párrafo o de un ítem de
  lista (Coda las pone siempre así: cada una en un `<span style="display: inline-block">` dentro del renglón) y
  todo `<video>`. Antes de convertir, cada archivo se cambia por una marca de texto y después cada marca pasa a
  ser una **foto en línea** (`photo`, `Doc_Fotos_En_Linea.md`) en el mismo lugar del renglón, con su
  `sdmedia://`: las fotos que en Coda iban juntas en un renglón quedan juntas, y las que iban con texto o debajo
  del texto de un ítem (un salto de línea) quedan igual. Vale en párrafos, ítems de lista, títulos y citas; un
  título con solo fotos pasa a ser un párrafo (un título vacío cortaría el guion). Un **adjunto** (PDF, zip…)
  sigue siendo un bloque `image` (la tarjeta). Las fotos de las **celdas de una tabla** que queda como tabla (modo
  `table`) quedan en su celda, como miniaturas del alto de una fila (desde v0.107, entrega 5 de
  `Doc_Fotos_En_Linea.md`; antes iban debajo de la tabla); un adjunto de una celda sigue yendo debajo. Se sacan el espacio de ancho
  cero y el carácter de objeto (U+FFFC) que Coda deja al lado de una foto, y los espacios sueltos entre fotos.
  **Una foto recortada en Coda se ve entera**: el recorte (`data-docx-crop`) no se trae (101 de 6129 fotos en ERSO;
  ver "Lo que no pasa"). Antes de v0.078 cada foto era un bloque aparte.
- **Ancho.** `w` = el ancho con que se veía en Coda sobre **su renglón de Coda**: 624 px (el ancho del texto de una
  página de Coda, `CODA_TEXT_WIDTH`) menos 24 px por cada nivel de lista (`CODA_LIST_INDENT`, medido en una
  captura de Coda), porque `w` es una parte del renglón donde está la foto. Así dos fotos de 312 px van juntas a la
  mitad cada una, y una foto de un ítem no sale más chica que en Coda. Más ancha que su renglón, todo el renglón; sin
  ancho, su ancho natural. Medido en ERSO: la mayor diferencia contra Coda fue 1 % del ancho de la página fuera de
  las listas; en las listas, antes de descontar la sangría, las fotos salían 1 a 5 % más chicas.
- **Nombre.** El de Coda si es un nombre de archivo; si Coda solo sabe el blob, `bl-….<ext>`.
- **Colores.** Coda escribe `rgb(...)` (también se entiende `#rrggbb`); se pasa al color con nombre más
  parecido del editor (por tono), salvo que de 70° a 165° siempre es verde, como se ve en Coda (desde v0.065).
  El gris del texto de cuerpo de Coda se saca.
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
- **Direcciones sueltas** (desde v0.069). Lo que en Coda era un embebido (un video de Drive con su
  reproductor, por ejemplo) sale en el HTML como la dirección en texto, sin `<a>`, cada una en su `<span>` y
  pegada a lo de al lado: entraba como un solo texto, sin links. Ahora un texto que es **entero** una
  dirección `http(s)` (un `<span>`, o el texto suelto de una celda) pasa a ser un link, y si estaba pegado a
  un texto o a otra dirección (sin un espacio de por medio) va en su propio renglón, con un salto de línea
  adentro del mismo bloque: ítem de lista, párrafo, celda o título. **Una de Drive** (las que reconoce
  `parseDriveLink`) que queda sola en su renglón de un párrafo de primer nivel sale a su propio párrafo como
  **tarjeta de Drive** (`<p class="drive-card-line">`, el mismo camino que pegar una tarjeta copiada; ver
  "Links de Drive" en `Doc_Sincronizacion.md`): lo que en Coda se veía con reproductor se sigue viendo así, y
  el texto de antes y el de después quedan en sus párrafos. Adentro de un ítem, de una tabla o de un título
  no hay tarjeta (queda el link), y debajo de un título "Guion" la tarjeta no pasa a Script. No se toca: lo
  que ya es un link (en Coda era un link, no un embebido), una dirección adentro de un texto más largo, dos
  en un mismo texto (no se sabe dónde cortar), lo escrito como código y los archivos de Coda.
  - **Prolijidad** (v0.087, lo que quedó de v0.069). Una dirección **partida por un cambio de formato**
    (`<span>https://drive.google.com/file/d/</span><b>1AbC/view</b>`) se junta en el primer texto y queda un
    solo link entero, con el formato de su primera parte; antes era un link cortado con el resto en otro
    renglón. Se junta solo lo pegado (sin espacio, en la misma línea) que la continúa: lo que sigue tiene forma
    de dirección (lleva `/`, `?`, `=`, `&`, `#` o `%`); o la primera parte quedó abierta (termina en `/`, `?`,
    `=`, `&`, `-`…) y lo que sigue no es una palabra común; o, después de un punto, un dominio en minúsculas.
    No se juntan una palabra común ("Luego", "Sigue."), aunque la dirección termine en `/`; otra dirección
    (también una que empieza con `www.`); "Google.com" después de un punto; un link ni código. Límite: un corte en el medio del final de la dirección (un id sin `/` ni `?`)
    con la primera parte terminada en letra o número no se reconoce y queda como antes. La **puntuación del
    final** (`.`, `,`, `;`, `:`, `!`, `?`, comillas, y `)` o `]` si no cierran uno que abrió adentro de la
    dirección) queda afuera del link, como texto, y en su renglón: tampoco se separa la puntuación que cierra
    pegada después ni la que abre (`(`, `«`) pegada antes. Una de Drive con un punto pegado ya no está sola en
    su renglón: queda link, no tarjeta. **Saltos de línea:** el que la importación pone para separar una
    dirección de un adjunto o una foto que van como bloque ya no queda al final del párrafo (el editor lo
    guardaba adentro del link y no se recortaba), y alrededor de una tarjeta se sacan todos los saltos y
    renglones en blanco que la separaban (la tarjeta ya es su propio bloque). El espacio de ancho cero que Coda
    deja al lado de una foto cuenta como espacio.
- **Renglones en blanco y el último salto** (v0.087). En el HTML de Coda el último `<br>` de un bloque no agrega
  un renglón (`<div><br></div>` es un renglón en blanco; `<div>Dos<br></div>` ocupa uno), pero el editor lo
  muestra: cada renglón en blanco y cada renglón terminado en salto se veían de dos de alto (un reporte de ERSO,
  12 % más largo). Ahora `finishBlocks` le saca a cada párrafo, título, cita o ítem **un solo** salto final
  (también si el editor lo guardó adentro de un link al final): un renglón en blanco es un párrafo vacío,
  "Dos<br>" es "Dos" y con dos saltos queda uno, como se veía. Los párrafos vacíos seguidos quedan **hasta dos**
  (antes se juntaban en uno; en ERSO, el 99 % de los huecos son de uno o dos renglones), y los de las puntas se
  sacan como antes. Solo se sacan saltos: ninguna letra.
- **Subtítulo** de la página de Coda: un párrafo en cursiva arriba de todo.

### Correcciones de la auditoría (v0.087, direcciones sueltas)

- **Una palabra pegada a una dirección que termina en `/`, `=` o `-`** entraba en el link («https://wanka.tv/» +
  «Luego» daba `…/Luego`); también `www.…` y «…/x.» + «Google.com». Ahora, si lo único que justificaba juntar era
  el final abierto, una palabra común no se junta; `www.` cuenta como otra dirección y el dominio después de un
  punto tiene que ir en minúsculas. Costo: un id corto todo en minúsculas sin números (`…/` + `abc`) no se junta.
- **El anclaje contra bloques seguidos** era unas 7 a 10 veces más lento con hilos que no se encuentran: por cada
  bloque juntaba hasta 20 y buscaba en el texto que crecía. Ahora junta una sola vez el texto de la página y recorre
  las apariciones con `indexOf` (lineal), y los textos de la página se normalizan una vez y no una por hilo. Da los
  mismos anclajes (comparado al azar contra la cuenta anterior, y los 12 hilos reales de MGTZD).
- **Renglones en blanco** (lo que encontró la auditoría al medir): ver "Renglones en blanco y el último salto"
  arriba.

### Páginas embebidas (desde v0.066)

Una página `embed` de Coda muestra otra cosa (otra página, de este doc o de otro, o un sitio). La API no dice
qué ni deja exportarla ("Only canvas pages can be exported"); el servidor MCP de Coda sí da la dirección
(`content_read` con `markdown`). Como con los comentarios, la captura quien tiene el MCP y la deja en la carpeta:

- **`embeds.json`** (en la raíz de la carpeta exportada): `{ "source": "…", "docId": "<id del doc>", "pages":
  { "<id de la página embebida>": "<dirección>" } }`. Uno de otro doc, sin `pages` o roto es un error claro
  antes de exportar ninguna página. Si después se corrige o se quita una dirección, lo bajado para esa página se
  descarta y se vuelve a bajar (o la página queda vacía, como antes).
- **Qué hace el comando** con cada página `embed` que tiene dirección:
  - una página de Coda (`https://coda.io/d/…_d<doc>/…_su<página>`, o la misma en `docs.superhuman.com`): busca
    esa página en su doc (por el `_su…` del final de su `browserLink`, comparado entero), exporta su HTML y sus archivos como los de cualquier
    página y los deja como contenido de la página embebida, con `embedOf: { docId, pageId, url }` en el manifest
    (y en `pages/<n>_<id>.embed.json`, para cuando se reusa lo ya bajado). El token va solo a la API de Coda;
  - cualquier otra dirección: un link a ella;
  - sin permiso sobre el otro doc, o una página que no se encuentra: queda como antes (vacía) y anotada con el
    motivo. Sin `embeds.json`, todo igual que antes.
- La importación trae una página `embed` con archivo como cualquier otra.

### Tablas (desde v0.063)

Shot Docs no tiene bases de datos: una tabla de Coda se importa **bakeada**, como páginas (decisión de Lega para
docs con tablas, 2026-09-30). Lo hace el **comando**, no la app: la app importa páginas como siempre, sin ningún
tipo de bloque nuevo. El código de la conversión es `scripts/lib/codaTables.mjs` (función pura de lo bajado,
probada en `scripts/coda-tables.test.mjs` con datos inventados).

- **Qué baja.** Después de las páginas, `GET /docs/{doc}/tables?tableTypes=table,view`, y por cada tabla o vista
  sus columnas (todas y las visibles) y sus filas a `tables/`: `index.json` (cada tabla y vista, su tipo y forma
  —tabla, tarjetas, calendario—, la página donde está, su tabla base y sus columnas) y `<id>.rows.json` (en una
  tabla base, todas las filas con sus valores ricos y, aparte, los ids que deja ver su filtro, en orden; en una
  vista, solo los ids que muestra). Lo ya bajado no se vuelve a pedir, salvo con `--refresh`.
- **Qué hace con cada tabla** (el modo; `tables.config.json` lo puede forzar):
  - `fichas` (una tabla con fotos o con más de 8 columnas): **una página por fila** ("ficha") con las fotos
    arriba (desde v0.078 juntas en un renglón: una sola con su ancho, varias a un tercio cada una, como al pegar
    varias en la app), los campos cortos en una tabla de dos columnas (con el color que la celda tenía en Coda) y los textos
    largos debajo, cada uno con su título; las notas salen del HTML de la página (con formato y fotos) y, si esa
    celda no se veía en ninguna vista, del texto de la API. Las fichas van debajo de la página donde estaba la
    tabla, agrupadas como en Coda (una página por grupo). Donde estaba la tabla queda un **índice** (una tabla
    de texto con un link a cada ficha) y, al final, las filas que escondía el filtro de la vista. Una vista de
    **tarjetas** queda como una tarjeta por fila; un **calendario** o una línea de tiempo, como una lista por
    fecha. Una **relación** entre filas pasa a ser un link entre fichas.
  - `unwrap` (una tabla sin encabezados, con fotos: Coda la usa para maquetar): se desarma por filas, así cada
    foto queda junto a su texto.
  - `table` (una tabla chica de solo texto): queda como tabla.
  - `text` (forzado): queda como tabla, sin fotos. `skip` (forzado): queda una nota en su lugar.
  - En `table` y `text`, **las filas que escondía el filtro** (el HTML trae solo las visibles) van debajo, en otra
    tabla con las mismas columnas y el texto de la API: en un doc bakeado no se pierde ninguna fila.
- **Las filas.** El HTML trae la vista con su filtro y su contenido rico pero sin id de fila; la API trae todas
  las filas con su id. Desde v0.064 una fila del HTML se junta con una de la API **solo si coinciden todas sus
  columnas comparables** (texto, opciones, relaciones, números, personas, correos; solo letras y números):
  primero la de su posición, si no la primera exacta sin usar. Si ninguna coincide en todo, la más parecida sirve
  solo para ubicarla en la lista de esa vista: su ficha sale de la API (sin celdas ni colores del HTML) y queda una
  nota. Así dos filas con el mismo nombre nunca se cruzan.
- **Links.** Un link a otra página del doc o a una fila con ficha pasa a `coda-page:<id>` (ver "Links entre
  páginas del doc" arriba). Un link a una fila sin ficha queda apuntando a Coda, contado en las notas.
- **Archivos que solo están en los datos de una tabla** (una fila que ninguna vista mostraba): se bajan a
  `media/` (sin token, solo de Coda) y quedan en `tables/extra-media.json`.
- **Qué deja.** El HTML de Coda queda intacto en `pages/<n>_<id>.html`; lo convertido va a
  `pages/<n>_<id>.import.html` y a `pages/row-….import.html` / `pages/group-….import.html`. `manifest.coda.json`
  es el manifest de las páginas de Coda tal cual (la base para convertir de nuevo) y `manifest.json`, el
  convertido: cada página apunta a su `.import.html` y las nuevas llevan `generated: 'row' | 'group'`. Las notas
  de la conversión (qué modo tuvo cada tabla, cuántas notas salieron de la API, cuántos links quedaron) van al
  resumen del comando y a `tableNotes` del manifest; no son problemas y no cortan con error. Un doc **sin
  tablas** (y sin fotos HEIC) deja el mismo `manifest.json` de siempre.
- **`tables.config.json`** (opcional, en la carpeta exportada): `{ "tables": { "<tabla o id>": "fichas|unwrap|
  table|text|skip" }, "index": { "<tabla>": ["<columna>", …] }, "skipColumns": { "<tabla>": ["<columna>", …] } }`.
  Se revisa antes de bajar nada y un error dice qué está mal; una tabla que nombra y no existe queda en las notas.
- **Si algo falla.** Una tabla que no se puede bajar (un 403, por ejemplo) queda en `problems` y fuera de la
  conversión; las demás se convierten. Si falla la conversión entera, queda en `problems`, el `manifest.json`
  queda sin convertir (las páginas de Coda tal cual) y se corrige y se corre `--convert-only`. Con problemas el
  comando sale con error, como siempre. `--refresh` vuelve a pedir también las filas de las tablas; si se corta,
  `--convert-only` no convierte hasta terminar la exportación (no mezcla datos viejos y nuevos).
- **Comentarios de filas.** Los da el servidor MCP de Coda (`table_rows_read` con `includeComments`), no la API.
  `rowCommentsByPage` (en `codaTables.mjs`) los pasa a la ficha de su fila (a la página entera) o, si la tabla
  quedó como tabla, a su página anclados al texto de la fila (desde v0.062 el anclaje encuentra el texto de una
  celda). Juntarlos en `comments.json` es parte del paso de los comentarios, no del comando.
- **Lo que no pasa:** las relaciones vivas, los filtros (queda el resultado), los botones (queda su texto), las
  fórmulas (queda su valor), las reglas de color (queda el color de cada celda, no la regla), las vistas como
  vistas (calendario, línea de tiempo). Las columnas de fotos de un índice de fichas siguen sin ir en el índice (las
  fotos están en la ficha): ahora que una celda lleva fotos, un índice podría mostrar la miniatura (para después).

### Fotos HEIC (desde v0.072)

Las fotos del iPhone son HEIC. La app las acepta y las sube, pero Chrome no sabe decodificarlas: no les arma
miniatura y la página no las muestra. En Coda se veían porque Coda las convierte al mostrarlas. Ningún conteo
lo delata (los archivos están): se ve recién al mirar la página. Por eso el **comando** deja un JPEG de cada
una, que es lo que se importa. El código es `scripts/lib/codaHeic.mjs`.

- **Qué hace.** Después de bajar (y también con `--convert-only`, sin red), cada `media/*.heic` o `*.heif` pasa
  a `media/<blob>.jpg`: calidad 0,92, a tamaño completo y **con la orientación aplicada** (una foto vertical
  sale vertical; el JPEG no lleva ninguna marca de rotación que un programa pueda ignorar). El **perfil de
  color** del HEIC (las fotos del iPhone están en Display P3) se copia al JPEG: sin él se leería como sRGB y se
  vería menos saturado. Desde v0.086 es el de la imagen principal (`pitm` → `ipma` → `ipco`), y si la foto solo
  declara `nclx` se arma uno estándar (Display P3 o BT.2020): el mismo código que la app,
  `src/media/heifColor.mjs` (`Doc_Imagenes.md`, "Fotos HEIC").
- **Dónde queda cada cosa.** El JPEG, en `media/` con el mismo nombre de blob: así lo encuentran los dos
  lugares que buscan un archivo por ese prefijo (`bl-….`), la bajada, que no lo pide de nuevo, y la
  importación. El original, en **`media-originals/<blob>.heic`**, al lado de `media/`: se conserva, pero la
  importación solo mira adentro de `media/` y la bajada también, así que no lo importa ni lo confunde con el
  JPEG. Se mueve, no se copia (no ocupa el doble).
- **Lo que se importa queda coherente.** En el manifest, la entrada de esa foto apunta al JPEG, con
  `type: "image/jpeg"` y sus `bytes`. En el HTML, la etiqueta de la foto pasa a
  `data-coda-mime-type="image/jpeg"` y su nombre (`alt`, o el texto de un link al archivo) a `.jpg`: la app
  toma de ahí el tipo y el nombre, y con `image/heic` o `IMG_1234.HEIC` guardaría un JPEG como si fuera un
  HEIC. El HTML de Coda no se toca: lo cambiado va al `.import.html` de la página (el mismo que escriben las
  tablas, o uno nuevo si la página no tenía). Vale para cualquier página: con o sin tablas, fichas, grupos y
  embebidas. `pages/*.local.html` también pasa a apuntar al JPEG.
- **Un doc sin tablas pero con fotos HEIC** ahora también deja `manifest.coda.json` (el de Coda, tal cual) y
  un `manifest.json` convertido, con `heic: { converted, pending }`. Un doc **sin fotos HEIC** da exactamente
  lo mismo que antes.
- **Se puede repetir y cortar.** Qué está convertido se sabe mirando la carpeta (el original en
  `media-originals/` y su JPEG en `media/`), no por lo que hizo una corrida: lo convertido no se convierte de
  nuevo, tampoco con `--refresh`, y repetir el comando deja los mismos archivos. El JPEG se escribe como
  `.part` y se renombra: un corte no deja uno a medias. Si el corte cae entre escribir el JPEG y mover el
  original, la corrida siguiente solo lo mueve. Si alguien borra un JPEG, se rehace desde el original; lo mismo
  si quedó vacío o no empieza como un JPEG (un corte de luz antes de que el disco lo guardara). **Después de un
  corte, volver a correr el comando antes de importar:** el manifest y los `.import.html` se escriben al final,
  y con la carpeta a medias la app tomaría el JPEG con el nombre y el tipo del HEIC. Lo mismo si la conversión
  de tablas falla (el comando lo dice y sale con error). Y una importación cortada en la app **antes** de
  convertir no se sigue con la carpeta ya convertida: lo que guardó como HEIC queda así; se importa de nuevo.
- **La librería.** La conversión usa [`heic-convert`](https://www.npmjs.com/package/heic-convert) (JavaScript
  puro, sobre libheif). **No está en `package.json`**: solo la necesita quien exporta un doc con fotos HEIC, y
  el build de la app instala lo que dice `package-lock.json`. Se instala una vez, en el clon:

  ```
  npm i --no-save heic-convert
  ```

  (`--no-save` no toca `package.json` ni `package-lock.json`; un `npm ci` posterior la saca y hay que
  instalarla de nuevo.) **Sin la librería** el comando sigue, no convierte, lo anota como problema ("N fotos
  HEIC sin convertir: la app no las va a mostrar", con la forma de instalarla) y sale con error: se instala y
  se corre `--convert-only`.
- **Si una falla** (un archivo roto): queda como estaba, en `media/`, anotada en `problems`; las demás se
  convierten. La app la importa igual, como HEIC (no se va a ver).
- **El resumen** del comando: `Fotos HEIC: 618 convertidas a JPEG, 0 ya estaban, 0 fallaron`.
- **Lo que no pasa al JPEG:** los metadatos (fecha, lugar, cámara: siguen en el original). El JPEG pesa más
  que el HEIC, alrededor de una vez y media.
- **Medido** con un doc real de 618 fotos HEIC de 12 y 24 megapíxeles (1,2 GB), fuera del repo: ver "Prueba".
- **Un HEIC que llega a la app por otra vía** (soltado en el editor desde Chrome, por ejemplo) se pasa a JPEG
  en el dispositivo desde v0.075 (`Doc_Imagenes.md`, "Fotos HEIC"). También uno que quedó sin convertir en la
  carpeta: la app lo convierte al importarlo, y su bloque pasa a `.jpg` la primera vez que la página se abre
  para editar.

### Lo que no pasa

- **El recorte de una foto** que se hizo en Coda (`data-docx-crop`, 101 de 6129 fotos de ERSO): la foto entra
  entera, con su ancho de Coda (más alta si estaba recortada).
- **El ícono de la página** de Coda (en MGTZD, el estado de cada escena: ok, importante, cancelada): queda en
  el manifest pero la app todavía no muestra íconos de página.
- **Tablas y vistas de Coda como bases de datos:** desde v0.063 entran como páginas (ver "Tablas"); lo vivo
  (relaciones, filtros, botones, fórmulas) no.
- **Una página que no es texto** (embebida o sincronizada de otro doc): entra vacía y queda anotada, salvo una
  embebida con su dirección en `embeds.json` (ver "Páginas embebidas").
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
  varios bloques); si no hay, una **celda de una tabla** con exactamente ese texto (desde v0.062: el hilo
  queda en el bloque de la tabla, aunque el texto sea corto; así entran los comentarios de las filas de una
  tabla de Coda que se importa como tabla, pegados al texto de su primera celda; con el mismo texto en varias
  tablas, gana la primera); si no hay, el primero que lo contiene, de la línea más larga a la más corta y solo con
  textos de 8 letras o más, o de dos palabras ("ok" no se busca adentro de "Plano 12: ok"); y por último lo
  mismo **sin espacios** (desde v0.071, con 12 caracteres o más y, adentro de un bloque, solo si es uno solo: Coda puede dar pegado el texto de un renglón con
  direcciones que la importación separó en links o tarjetas, o al revés); si ningún bloque lo tiene, también
  contra **varios bloques seguidos juntos** (v0.087, hasta 20: un párrafo que la importación partió en el texto
  y sus tarjetas de Drive), en el bloque donde empieza y solo si pasa una sola vez en la página. Si no se encuentra
  (se borró en Coda, por ejemplo), el hilo va a la página entera y queda anotado en la lista del final. Sin
  `reference`, o con un texto que queda vacío al limpiarlo, va a la página entera sin anotarlo.
- **Autor:** un comentario con el correo de quien importa queda a su nombre (es suyo: lo edita y lo borra
  como cualquier otro). Los demás quedan sin autor de la app, con el nombre y el correo que da Coda; se ven
  con el nombre, la marca "from Coda" y el correo en el tooltip; el tooltip de la marca dice quién los importó.
  Nadie los edita; los borra quien tiene editar y crear páginas. Se responden y se resuelven como cualquier
  otro.
- **Fechas:** la original de cada comentario. Un hilo resuelto entra resuelto, con la fecha de su último
  comentario (Coda no dice cuándo se resolvió) y sin quién.
- **Ids estables y recibo:** el id de cada comentario sale del proyecto y del `commentUri` de Coda (SHA-256 con
  forma de uuid). Desde v0.211, los comentarios de cada página se arman junto con su plan (con los bloques como
  van a quedar) y, al entrar a la cola, cada uno deja en el dispositivo, en la misma transacción, un **recibo**
  (`importReceipt2:<id>`, en `meta` de la base local de comentarios) con su página, su origen y su hilo. El recibo
  no se borra cuando el comentario sube ni cuando después se edita o se borra. Mientras está, volver a importarlo
  (seguir una importación cortada) no lo pone otra vez en la cola ni le cambia el texto o el bloque: uno que la
  persona editó o borró no vuelve a entrar. Hasta v0.210, uno ya subido volvía a la cola al seguir. Si la cola no
  acepta los comentarios de una página (el mismo id con otra página, otro origen u otro hilo; o uno que quedó en
  la cola con una versión anterior, sin recibo, que no se modifica), la página ya quedó escrita, el motivo sale
  en la lista del final y sus comentarios quedan para seguir. **El recibo es local:** dice que este dispositivo ya
  lo puso en la cola, no que el servidor lo tenga; eso lo sigue diciendo la cola, que suelta cada comentario solo
  cuando el servidor lo confirma.
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

### Reorganizar al importar (2026-10-08)

La app importa el árbol que dice `manifest.json`, venga del comando o de otro paso. Para llevar un doc de Coda a la
estructura estándar (`Doc_Estructura_Proyecto.md`, D355) se puede poner un paso intermedio que lea la carpeta exportada
y escriba otra carpeta importable: mueve páginas (`parentId`, `order`), las renombra (el título viejo va al
`subtitle`), genera páginas nuevas (escenas, locaciones, días sin reporte, el Mapa) y **agrega** renglones a las
originales sin quitarles nada. Reglas que tiene que cumplir:

- Los ids de las páginas originales no cambian: de ellos dependen los links `coda-page:` y los comentarios.
- Las fotos se nombran por su blob (`data-coda-blob-id`): la misma foto en dos páginas se sube una vez. `media/` puede
  ser de enlaces duros a la carpeta exportada, sin subcarpetas, y el paso nunca escribe ahí.
- Un validador antes de importar: ids únicos y padres que existen, cada `coda-page:` con su destino, las mismas fotos
  por página original, y el texto de cada original igual a la entrada una vez quitado lo agregado (que el paso anota).
  Tiene que fallar si se le rompe una copia a propósito.
- Ensayo sin red en un perfil descartable antes de la importación real.

Ese paso es propio de cada doc (sabe cómo se escribieron sus escenas y sus locaciones) y no vive en este repo.

## Cómo quedó

- `scripts/coda-export.mjs` y `scripts/lib/codaExport.mjs` (lo que decide sin red: a qué dirección va el
  token, el nombre de cada archivo, las opciones), probado en `scripts/coda-export.test.mjs`.
  `scripts/lib/codaTables.mjs`, las tablas (`scripts/coda-tables.test.mjs`); `scripts/lib/codaHeic.mjs`, las
  fotos HEIC (`scripts/coda-heic.test.mjs`).
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
fotos en párrafos, ítems, links, títulos y tablas, videos, párrafos con solo un link, colores, guion,
direcciones sueltas en un ítem, un párrafo, una celda y un título, con sus tarjetas de Drive; partidas por un
cambio de formato, una palabra pegada a una que termina en `/`, con puntuación al final y sin saltos de línea de
más; el último salto de cada renglón y hasta dos renglones en blanco; siempre comparando que no se pierda texto) y la
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
líneas, texto que ya no está, sin anclaje, sin espacios, un párrafo partido en tarjetas, y la cuenta lineal de los bloques seguidos comparada al azar contra la anterior y
con una página de 3000 bloques), datos raros (sin texto, nombre largo, correo inválido, fecha
imposible), ids estables por proyecto, lo propio a nombre de quien importa, y la importación entera contra el
servidor en memoria (cada hilo en el bloque con su texto, resueltos, a la página, otro dispositivo que los ve,
seguir sin repetir, sin red y con red después de subir, con los bloques nuevos, un `comments.json` roto, de otro
doc o sin cola). `src/sync/commentsImport.test.ts`: la cola
(fecha original, autor de afuera, esperar a la página, reintentos, textos vacíos o largos, la base sin
`import_comment`, pedir editar y crear, quién edita y borra, restaurar una copia, una versión vieja que los saca
de la cola, borrar antes de subir). `supabase/tests/comentarios_importados_permisos.sql`: la
función en la base.

Fotos HEIC: `scripts/coda-heic.test.mjs`, con blobs y fotos inventados y un conversor de mentira: qué se
convierte (HEIC y HEIF, sin tocar lo demás ni los `.part`), lo ya convertido reconocido por la carpeta, un
corte entre escribir el JPEG y mover el original, un JPEG borrado, vacío o roto que se rehace desde el original, la bajada que
no pide de nuevo una foto convertida, un HEIC roto que queda como estaba sin frenar a las demás, un conversor
que no devuelve un JPEG, sin la librería (anotado, con la forma de instalarla, sin tocar nada) y un doc sin
HEIC (no cambia nada ni se carga la librería); el HTML (tipo y nombre de la foto, un link al archivo, nombres
raros, lo que no se convirtió queda igual) y el manifest (una página sin tablas, una que ya tenía su
`.import.html`, una embebida y las fichas de una tabla, con `convertTables`); el perfil de color; lo mismo
sobre una carpeta temporal; y, **solo si `heic-convert` está instalado**, un HEIC de verdad hecho para la
prueba (96×64, cuatro colores planos, guardado girado): sale derecho, a su tamaño y con su perfil. El perfil
de la imagen principal (y no el primero que aparece) y el Display P3 armado desde `nclx`, con cabeceras armadas a
mano.

El comando entero (desde v0.086): `scripts/coda-export-run.test.mjs` corre `coda-export.mjs` en un proceso de
node, como una persona, contra una API de Coda de mentira (`scripts/fixtures/codaFakeApi.mjs`, cargado con
`node --import`: reemplaza `fetch`, no espera entre pedidos y da un `heic-convert` de mentira o "no instalado")
sin tocar el comando. Un doc de dos páginas con una foto HEIC: la bajada, la conversión, el manifest, el
`.import.html` y la vista local; que el token vaya solo a la API; repetir (no pide ni convierte nada y deja el
mismo manifest) y `--refresh`; sin la librería (sale con error y la forma de instalarla) y `--convert-only`
después; un HEIC roto (anotado, sale con error, las demás se convierten); y un doc sin HEIC (sin
`manifest.coda.json` ni cargar la librería). Encontró que repetir el comando dejaba sin `type` ni `bytes` las
entradas de los archivos ya bajados (la importación no los usa): ahora la bajada que reutiliza un archivo los
completa por la extensión y el disco; un tipo que la extensión no dice (un `.bin`) sale del manifest de la
corrida anterior.

Fuera del repo (2026-10-01), con un doc real de 618 fotos HEIC (404 de 12 megapíxeles, 205 de 24 y 9 de 9; 11
con rotación guardada, 9 de ellas verticales; 1,24 GB): las 618 convertidas, ninguna falló; alrededor de un
segundo por foto (de 0,5 a 2,1), unos 10 minutos en total; los JPEG pesan 1,91 GB (1,55 veces); cada JPEG
tiene el tamaño de su HEIC ya orientado, el mismo que da otro decodificador, y su mismo perfil de color
(Display P3); se miraron cinco, las giradas incluidas: derechas. Repetir el comando no convierte ninguna y
deja el mismo manifest. Con algunas de esas fotos: sin la librería (queda anotado y no toca nada), con dos
archivos rotos (quedan como estaban, las demás se convierten) y después de un corte simulado (un original sin
mover y un JPEG a medias). Además, el comando entero contra una API de Coda simulada, sin red (primera corrida,
repetir, `--refresh`, sin la librería, y un doc sin HEIC comparado con el comando anterior: mismos pedidos y
mismos archivos), y la carpeta que dejó, importada con el código de la app: llega el JPEG, con nombre y tipo
de JPEG, y el original no se sube. Y **en la app real** (navegador, base y Drive), una importación de cuatro
páginas con 46 de esas fotos ya convertidas: las 46 quedaron con tipo y nombre de JPEG, en el Drive y con su
miniatura, y las páginas las muestran, las verticales derechas. Falta la importación del doc entero.
