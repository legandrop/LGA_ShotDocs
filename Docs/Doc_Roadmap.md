# Roadmap

**Rechazos definitivos v0.214:** un "no existe" de la base ya no se reintenta para siempre ni corta la sincronización de las demás páginas. **Hecho en v0.217:** lo rechazado así (el contenido de una página, sus comentarios y sus archivos detenidos) se reintenta solo cuando el árbol vuelve a mostrar la página (le devuelven el permiso, sale de la papelera, restauran el proyecto), una vez por cada vuelta de "no" a "sí" y sin tocar los rechazos de otra clase, también si el ciclo del rechazo se cortó o la app estuvo sin red mientras tanto; las menciones editadas mientras la página no se ve ya no se olvidan: quedan a la vista con la edición y salen cuando la página vuelve, y una mención que la persona sacó en una edición posterior ya no revive al reintentar; el estado dice en palabras que una página no se puede bajar o subir; hay una prueba de que "el archivo todavía no llegó al servidor" se sigue esperando con el error tal como lo entrega la base; y el comentario del portero dice 500. Detalle: `Doc_Sincronizacion.md`, "Un 'no existe' se reintenta solo cuando la página vuelve", y `Doc_Menciones.md`, 3.3. Quedan pendientes: (1) si el permiso se va y vuelve entre dos bajadas del árbol, el dispositivo nunca ve el "no" y lo rechazado sigue esperando *Retry* o la próxima apertura; (2) un cambio del árbol rechazado así (renombrar, mover) no se reintenta solo, a propósito: gana el último que llega y podría pisar un cambio más nuevo; (3) `set_comment_mentions` contesta lo mismo por una página que no se ve que por una borrada para siempre: en el segundo caso las menciones quedan rechazadas a la vista hasta que la persona las descarta; para descartarlas solas haría falta que la base le diga a quien escribió el comentario, y solo a él, que la fila ya no existe; (4) reintentar una edición de un comentario rechazada hace tiempo la manda con su texto de entonces: si después entró otra edición del mismo comentario, la pisa. Pasaba con *Retry* desde antes; desde v0.217 también se dispara solo al volver la página, cuando la edición posterior entró por otro camino (otro dispositivo de la misma persona, o la página se ocultó dos veces y la segunda edición entró entre medio). Convendría sacar de la cola las ediciones rechazadas de un comentario cuando entra una más nueva, o no reintentar una edición más vieja que la que tiene el servidor; (5) si la página vuelve solo para ver, el comentario rechazado se reintenta esa vez, queda rechazado por permiso y ya no sale solo cuando después llega el permiso de comentar: espera *Retry* o la próxima apertura; (6) las menciones de una página que sí se ve y cuyo comentario la base dice que no existe preguntan por la página una vez cada una (solo se recuerda, por pasada, la página que no se ve).

**Espera de guardado al exportar v0.210 (D303):** una carpeta subiendo ya no frena *Export*; una importación o un reemplazo en curso en el proyecto sí. **Hecho en v0.213:** con una importación o un reemplazo en curso el aviso dice la causa y no espera; un título que no se pudo guardar se avisa sin gastar los ocho segundos; al cancelar o fallar un zip, el `.zip` vacío que creó el selector se saca (uno que ya tenía contenido no se toca, D308); y la tarjeta de una carpeta que se está subiendo sale en lo exportado con *Google Drive folder* y su peso, sin la nota de avance. **Hecho en v0.216:** *Download all* de una carpeta sigue la misma regla (D308; `Doc_Carpetas.md`, "El zip elegido, al cancelar o fallar"). Queda pendiente: (1) **conservar el zip anterior cuando se elige reemplazarlo** (vale para *Export* a zip y para *Download all*). Hoy se pierde igual: Chrome y Edge, los únicos navegadores con el selector de guardar, vacían el archivo existente en el momento de elegirlo, antes de que la app haga nada (leído en el código de Chromium: al guardar crea el archivo si no existe y lo trunca si existe; no se vio en un navegador), y como queda en 0 bytes la app lo saca al cancelar o fallar. D308 solo protege un archivo con contenido en un navegador que no lo vacíe. Pide otro diseño: avisar antes de abrir el selector que elegir un zip existente lo reemplaza desde ese momento, o escribir con otro nombre al lado y renombrar recién al terminar; (2) ver en Chrome y Edge de verdad que el `.zip` vacío se saca (probado con el selector simulado). Detalle: `Doc_Exportar.md`, "Guardado local antes del PDF".

**Vista previa Format as… v0.208:** avisa antes de Apply cuando la forma elegida quitará Script. Discard conserva el original y Undo recupera también ese formato. Los demás pendientes de P.24 y de la fase 5 siguen abiertos.

**Ventana Export v0.205:** el título completo se ajusta al ancho y las acciones pasan a otro renglón cuando el nombre del ZIP no deja sitio para *Close*. El cierre queda accesible; selectores del sistema, dispositivos y los demás recorridos de exportación mantienen sus pendientes.

**LF21, tramo de guardado local v0.199:** preparación explícita del título y barrera de ocho segundos para *Reload* de avisos y cambio/unión/creación de workspace desde uno abierto. En v0.200 el título completo se conserva hasta confirmar su encabezado y sobrante en el dispositivo; un rechazo mantiene el borrador para reintentar en la misma sesión. En v0.202 el PDF prepara esas escrituras y espera la transferencia durable del sobrante antes de tomar su copia; las partes siguientes comprueban continuidad del plan y conservan el libro anterior si cambió. El ZIP incorpora esa barrera antes de abrir el escritor y toma títulos, documentos y selección actuales, invalidando resultados tardíos. En v0.206 se incorpora el tramo de editor/arranque: anchors propios calificados sin escribir el documento, w normal prioritaria sobre el link público recordado y barrera local para un clic del editor hacia otra cuenta. **Hecho en v0.216:** copiar o cortar una selección con links a páginas propias lleva el workspace en lo que se pega afuera de la app, sin cambiar el documento (`Doc_Links_PDF.md`, "LF21 · Copiar y cortar"). De esa entrega quedan (BAJO): (a) un link a una página propia cuyo texto visible es su propia dirección (una dirección pegada en el texto) sale sin el workspace en el texto plano del portapapeles; en el HTML la dirección del link sí lo lleva, así que solo se nota al pegar en un lugar que toma texto sin formato; (b) sospecha sin verificar: si un navegador deja leer el formato propio del editor (`blocknote/html`) mientras se copia pero después no lo entrega al pegar (puede ser Safari), pegar adentro de la app leería el HTML común y escribiría el workspace en el documento; hay que copiar y pegar un link a una página en Safari de Mac y de iPhone y mirar que la dirección guardada no cambie. Sigue parcial: faltan pegar adentro de la app en otro workspace, drag, hashes públicos antiguos, transporte completo por importación/exportación, cuentas/RLS reales y Safari/iPhone físicos. O1/Request access y los demás recorridos no se cierran con este tramo. Auth y salidas externas conservan sus recorridos.

Lo que falta, por importancia. El orden de trabajo lo manda `Plan_Workspaces.md` (secciones 10 y 11); las
fases originales están en `Plan_ShotDocs.md`, sección 9.

**NVIDIA BYOK, entrega v0.189; aceptación real v0.197:** catálogo y una respuesta de texto de Kimi K3 por la app y el portero propio, con clave personal, comprobados online en Windows sobre texto sintético. Conservó los datos pedidos; Apply aplicó la sugerencia, Undo recuperó el original exacto y Redo restauró la sugerencia sin otro envío. Siguen pendientes Stop real, cambios concurrentes, otros dispositivos, otros modelos y Caption, vencimiento físico de metadatos y recuperación tras reinicios. No cierra la fase 5 ni el MCP, no cambia la selección automática y NVIDIA no se usa para audio. Parar no garantiza detener cómputo ni cobros remotos. Detalle: `Doc_Asistente.md`.

## Regla para todo lo que se haga: cada workspace es una isla

Un **workspace** es de un dueño y tiene varios proyectos. Es su Supabase (login, textos, permisos), el
Drive del dueño (fotos, videos, PDFs) y un portero de archivos del dueño. El dueño invita a su equipo:
cada miembro ve los proyectos o las páginas que le comparta, y si puede editar, sube y borra en el
Supabase y el Drive del dueño. La misma persona puede estar en workspaces ajenos y tener el suyo. Una
sola app se conecta a varios workspaces; nada de un workspace pasa por los servidores de otro (ni por
los de Lega). Se hace por partes (ver pendientes), pero **nada de lo que se haga puede complicarlo:**

- **Nada fijo en el código.** La dirección de Supabase, el dominio, el correo y los ids de Google salen
  de la configuración del workspace. El código recibe el cliente del workspace activo, nunca uno global,
  y todo lo que se guarda en el dispositivo (sesión, base local, preferencias locales) lleva el workspace
  en el nombre. Hecho en el paso 5 (v0.030): el cliente sale del workspace (`src/workspace.ts`) y los
  nombres salen de su clave local; los de Wanka siguen siendo los de siempre.
- **Los permisos pasan por membresías**, aunque hoy haya un solo miembro: nada de "el dueño es el
  único usuario".
- **Todo lo del servidor está en el repo** y se aplica igual en cualquier workspace: migraciones,
  políticas, el portero. Lo que hoy se configura en el panel de Supabase (correo, plantillas, registro
  cerrado, direcciones de redirect) tiene que pasar a `supabase/config.toml` o estar entero en
  `Doc_Supabase.md`.
- **Cada workspace dice qué versión de la base tiene** (`workspace_settings.schema_version`), y la app
  avisa claro si el dueño tiene que actualizarla (desde v0.030).
- **Ningún servicio central.** Ni proxy, ni licencias, ni estadísticas. Lo que cueste por uso lo paga el
  dueño de cada workspace con sus cuentas.
- **El plan gratis de Supabase es el techo por defecto:** nada pesado en la base ni en Storage (egress:
  5 GB al mes).
- **Los miembros nunca reciben las claves del dueño** (ni el token de Google): los archivos pasan por el
  portero, que pregunta los permisos.

## Pendientes

Ordenados en cuatro grupos: el plan de workspaces (primero), los pedidos de Lega del 2026-09-30 (se hacen
ya, en orden), lo que se puede hacer sin que Lega decida nada, y lo que espera una decisión o una acción de
Lega.

### R. Relacionar escenas, locaciones y días (pedido de Lega, 2026-10-08)

El método está en `Doc_Estructura_Proyecto.md` (ES1 a ES10, D355). Hoy lo arma una reorganización al importar, con
listas generadas y fechadas; para que se sostenga en los proyectos nuevos, la app tiene que ganar, en este orden:

1. **Índice de marcas y panel «Relacionado»** fuera del documento: qué páginas mencionan esta escena, locación o día
   (por el número de escena y por los links `/p/<id>`), calculado en el dispositivo como la búsqueda. Reemplaza a las
   listas `Relacionado · generado`. Sin migración.
2. **Selector de escena al escribir**, que conozca los nombres alternativos de la primera línea de cada escena.
3. **Plantillas *Escena*, *Locación* y *Scouting***, y *New day report* con la locación en el título.
4. **Galería por fuente** en la escena y en la locación (fotos de sus scoutings y días), como vista, sin copiar bloques.
5. **Mapa vivo** del proyecto.
6. **«Repartir por escenas» un reporte**, con prueba de conservación y deshacer. Los encabezados con solo el número,
   las escenas en títulos de segundo nivel y las secciones que no son de una escena no se reparten solos.

Anotado al reorganizar: buscar el nombre de una locación trae primero los días que la llevan en el título y después
la página de la locación; buscar «Día 19» trae primero el planning de ese día.

### A. Plan de workspaces (D-17, D-18)

1. **Los pasos 5 a 13 de `Plan_Workspaces.md`** (sección 10, y sección 11 para cómo se hace cada uno).
   Hechos los pasos 1 a 5: copias de seguridad, guarda contra lo desconocido, hosting en Cloudflare, la
   prueba de media en la computadora y el iPhone, y la preparación (workspace en el código, miembros,
   permisos e invitaciones en la base, restaurar sobre el mismo proyecto). **Los pasos 6 a 13 están
   hechos y publicados** (v0.031 a v0.041, migraciones aplicadas en Wanka el 2026-09-30). Absorbe la vieja fase 2 (compartir un proyecto, una
   página o una subpágina con usuarios y con links legibles, D-13) y los que figuran abajo en "Resueltos
   adentro del plan".
2. **La marca de un archivo en Drive, atada a su workspace** (auditoría de P.10, entrega 2, O4). El portero busca un
   archivo de la app por su marca `sdFile` (el id) y el peso. Si una misma cuenta de Google y el mismo cliente OAuth
   sirvieran a dos workspaces, un editor del B que conozca el id y el peso de un archivo del A podría registrarlo en B
   y el portero de B lo enlazaría. Hoy hay un solo workspace por Drive. Antes de que dos workspaces compartan cuenta de
   Google: sumar `sdWorkspace` a `appProperties` al subir y exigirlo en la búsqueda (o buscar solo adentro de la
   carpeta del proyecto).

### P. Pedidos de Lega (2026-09-30), en este orden

**Orden acordado con Lega (2026-09-30) para lo que falta:** después de colapsar 1a (P.11), la búsqueda en el
proyecto (P.12, entrega 2), colapsar 1b, colapsar para todos (P.11, entrega 2), P.9 carpetas, P.10 copias
locales, la segunda entrega de adjuntos (vista previa) y P.8.

- **P.1 Hecho (v0.043): el PDF corta donde marca la pantalla.** Las fotos del Drive salían en el PDF con el
  original a todo el ancho (más altas que en pantalla, con la miniatura). Ver `Doc_Hojas_PDF.md`.
- **P.2 Hecho (v0.044): el primer clic en una foto la elige, el segundo la abre.** Contorno, tiradores a la
  vista y su barra. Ver `Doc_Imagenes.md`.
- **P.3 Hecho (v0.045): fotos y videos en fila** (`Doc_Imagenes.md`, entrega 2): tamaños rápidos 1/1, 1/2, 1/3 y 1/4 en la
  barra, fotos seguidas que entran quedan en una fila, tiradores que imantan a esos tamaños, flechas y Enter
  en una fila, paginación y PDF con la fila entera. Propiedad nueva `rowWidth` en el bloque `image` (sin
  tipo de bloque nuevo); `min_app_version` quedó en 0.045. En v0.184, Replace de foto-bloque/fila conserva
  la última elección local con guardados que terminan fuera de orden, sin cambiar fotos en línea/celdas ni persistencia.
- **P.15 🔴 Fotos en línea: la foto como un carácter del renglón** (Lega, 2026-10-01; **lo primero: sin esto no
  se importa ningún doc de Coda de forma definitiva**). Hoy la foto es un bloque: no se puede poner el cursor a
  su lado, ni escribir o pegar otra foto en su renglón, ni subirla al renglón de arriba con Backspace, ni
  elegir varias con Shift+flechas o Shift+clic. Lo pedido: que fluya en el texto como en Coda (lo que no
  entra baja de renglón), elegir varias fotos seguidas como se eligen letras, y acomodar las elegidas.
  **Diseño en [`Doc_Fotos_En_Linea.md`](Doc_Fotos_En_Linea.md)** (auditado). Por entregas: un prototipo en
  navegador; el nodo propio, el parche de huecos de y-prosemirror y el teclado; crear, dar tamaño, acomodar las
  elegidas, hojas y PDF; convertir las fotos que ya existen; importar de Coda con los renglones como estaban.
  **Hechos el prototipo (entrega 0; Lega lo aprobó el 2026-10-01), la entrega 1 (v0.076, auditada) y la 2
  (v0.078, abajo).** La entrega 1: el nodo
  `photo` (nada lo crea todavía), el resguardo de versiones anteriores también en la importación de Coda, el
  parche de los huecos y los huecos estables (0 letras perdidas en 300 agendas por caso; los párrafos sin fotos
  guardan lo mismo que antes, byte a byte), y lo que se ve y se toca medido en Chromium (filas, teclado, mouse,
  Shift+flechas y Shift+clic, carrete, imprimir, `[Image]` en comentarios; D-22).
  **Entrega 2 hecha (v0.078):** pegar, soltar y "/Image" crean fotos y videos en el renglón (una con su ancho
  natural, varias a 1/3); **paridad con la foto-bloque (D-24):** tiradores que imantan, la misma barra para las dos
  por sectores (ver, bajar | tamaños y *Arrange in rows* de las elegidas | alinear | comentar | reemplazar, renombrar,
  borrar), sin leyenda; un párrafo de fotos se parte entre hojas por filas enteras. Corregido lo de las dos
  auditorías de la entrega 2 (deshacer sacaba la marca del renglón; varias fotos elegidas y una tecla las borraba;
  "Copy image" de una web; acomodar solo las elegidas). Inventario en `Doc_Fotos_En_Linea.md`, "Paridad con la
  foto-bloque". Antes de crear: la
  **marca del renglón** (`lgaStableGaps`, propuesta; cambia la forma guardada) hace que ninguna versión anterior abra
  un renglón que tuvo fotos (versiones mezcladas: de 28 de 49 perdidas a 0, medido con la librería publicada, que
  ahora tiene su prueba en el repo), y los tres pendientes de la auditoría de la 1b (emojis y dictado, arrastrar
  soltando sobre una foto, la barra de texto). Ver `Doc_Fotos_En_Linea.md`, "Cómo quedó (entrega 2)".
  **Después de publicar la v0.078:** subir `min_app_version` a 0.078 (no hace falta antes, por la marca).
  **Entrega 3 hecha (v0.078), escondida (D-26):** la conversión de las fotos-bloque de una página a fotos en línea
  (cada fila a un renglón con los mismos anchos, un solo deshacer, los comentarios siguen anclados; medido en una
  página tipo ERSO: 61 fotos, 25 filas iguales, ±0,55 px) queda en el código y sus pruebas, sin entrada en la
  interfaz: no va a haber fotos viejas para convertir. `Doc_Fotos_En_Linea.md`, "Cómo quedó (entrega 3)".
  **Entrega 4 hecha (v0.078):** importar de Coda deja cada foto en su renglón, como foto en línea, con la parte del
  renglón que ocupaba en Coda (624 px = todo el renglón); las fotos de una ficha, juntas. Medido con una copia
  parcial de ERSO contra el HTML de Coda: las mismas filas, ±1 % de ancho. Sin el recorte de Coda (101 fotos de
  ERSO). Para la importación definitiva de ERSO hay que volver a correr `--convert-only`.
  **Entrega 5 hecha (v0.107): fotos en las celdas de una tabla.** Pegar, soltar, "/Image" y "Copy image" con el cursor en
  una celda ponen la foto en la celda, como miniatura de 96 px de alto (`w = 0`); soltar en el relleno de una celda, al
  final de su texto; la barra ofrece *Thumbnail* y *Full cell width* (D32), sin alinear; ↑ desde una celda con fotos va
  a la de arriba; imprimir las deja igual; importar de Coda deja las fotos de una celda en la celda. Sin tipos ni
  propiedades nuevas (la versión publicada abre la página sin escribir nada). `Doc_Fotos_En_Linea.md`, "Cómo quedó
  (entrega 5)". Queda: probar en Safari y el iPhone, y con una exportación de Coda que tenga fotos en tablas de página.
  **El alto de la miniatura se elige por tabla (v0.129, D27 → B):** *Thumbnail size* con *Small*, *Medium* y *Large*
  (64, 96 y 160 px), en la barra de la foto y en la de la tabla; propiedad de la tabla, la versión publicada vuelve a 96
  si edita la tabla (`Doc_Fotos_En_Linea.md`, "Alto de las miniaturas (D27 → B)"). Para después (auditoría): pegar solo `text/html` de una
  fila con fotos las pierde (O1); una tabla de Google Docs o Excel con imágenes llega sin ellas (O2); la papelera de
  archivos al borrar una fila con fotos, a probar con la base real (O5); ↑ con el cursor al principio de un segundo
  renglón de una celda que empieza con una miniatura (bajó porque no entraba al lado del texto) va a la celda de la
  izquierda en vez de al renglón de arriba: lo hace el navegador, también antes de la corrección de O4 (medido en
  Chromium con "Texto [foto] y más texto" en una columna angosta).
  **Queda:**
  - Probar en Safari y en el iPhone: pegar, soltar, "/Image" con la cámara, la barra con el dedo, la composición
    (sin tecla previa entre dos fotos duplica el primer carácter en Chromium). Medir la decoración de filas con un doc
    grande (recorre el documento en cada cambio).
  - Decidir: pegar HTML con una foto (`data-inline-content-type="photo"`) crea una; el primer Shift+flecha con una
    foto elegida no agranda; las fotos duplicadas cuando dos mueven la misma (39 de 300). Pegar archivos con una foto
    elegida ya no la reemplaza (va después, como una letra); pegar HTML sí.
  - Pegar HTML con un `<img>` de afuera sigue creando una foto-bloque (entrega 3, con la conversión `data:`); "/Image"
    ya no ofrece *Embed* (dirección de otro sitio).
  - Las respuestas de Lega a las preguntas del diseño (leyenda, videos, ancho al pegar varias): hoy va la propuesta.
  - Entregas 3 (convertir las fotos-bloque) y 4 (importar de Coda en línea). Lo que queda de editar a la vez junto a
    fotos (unir renglones, cambiar el tipo, dos Enter a la vez) está medido en `Doc_Colaboracion.md`.
  **A futuro (Lega, 2026-10-01, después de ver el prototipo):** que se puedan escribir varias líneas de texto a
  los costados de una foto (el texto rodea la foto), no solo un renglón alineado abajo.
- **P.4 Hecho a medias (v0.046): acomodar en filas** (`Doc_Imagenes.md`, entrega 3): con una foto elegida, reparte la tanda de fotos
  y videos seguidos en una o más filas de la misma altura, sin cambiar el orden. Se audita antes y después.
  **No es lo que pidió Lega** (confirmado el 2026-10-01): pidió elegir varias fotos seguidas (Shift+clic,
  Shift+flechas) y acomodar **las elegidas**; hoy no se puede elegir más de una y el botón reparte toda la
  tanda. **Resuelto para las fotos en línea en P.15 (v0.078):** *Arrange in rows* acomoda las elegidas. Las
  fotos-bloque siguen con la tanda hasta convertirse (P.15, entrega 3).
- **P.5 Hecho (v0.047): en el teléfono, filas o apiladas:** una opción de la cuenta (solo tiene efecto en pantallas
  angostas) para ver las fotos y videos en fila, como en la computadora, o uno debajo del otro. No cambia lo
  guardado. Por defecto, en fila.
- **P.6 Hecho (v0.048 portero, v0.049 app): adjuntar cualquier archivo** (`Doc_Adjuntos.md`): arrastrar o
  pegar un PDF, un .zip o lo que sea; va al Drive del dueño como las fotos y se ve como una tarjeta con ícono,
  nombre y tamaño (el mismo bloque `image` con `sdmedia://`, sin tipo de bloque nuevo). Un PDF (o lo que el
  navegador sabe mostrar) se abre en una pestaña nueva; el resto se baja con su nombre; en el teléfono, un
  toque abre una hoja. **Entrega 2 hecha (v0.091):** la primera página de un PDF como vista previa en la tarjeta
  (pdf.js en el dispositivo que lo agrega, bajado aparte; viaja como la miniatura de una foto y se ve sin red), y los
  adjuntos en grande en el carrete con *Open* y *Download*. Falta: probar a mano con el portero real, Safari y el
  iPhone; la miniatura de Drive para Office, PSD y demás (CORS en `/t/` del portero y guardarla en el bucket
  `thumbs`; `Doc_Adjuntos.md`, sección 4).
- **P.7 Hecho (v0.050, primera entrega; migración 7 aplicada en Wanka): cuánto ocupa cada proyecto
  en el Drive.** El peso en el renglón de cada proyecto del selector, el total con su desglose en el diálogo
  de Google Drive (solo el dueño) y el total de la papelera de archivos, con la confirmación de vaciar
  corregida. Sale de sumar `files.size` en la base (`project_sizes`), sin preguntarle a Drive. Ver
  `Doc_Peso_Proyectos.md`, "Cómo quedó". La lista de archivos por peso salió con P.8 (v0.220), con los proyectos
  ordenados por peso para elegir; un acceso desde el diálogo de Google Drive y el orden por peso de la papelera
  de archivos siguen pendientes (están en lo que falta de P.8).
- **P.9 Arrastrar una carpeta** (pedido de Lega, 2026-09-30, al responder las decisiones de P.6): hoy se
  rechaza pidiendo que se comprima. Lo que quiere: subir la carpeta entera, con sus subcarpetas, al Drive del
  dueño, con una ventana que muestre qué se está subiendo ("esta carpeta, con todo esto"); en la página queda
  como un bloque de carpeta que al hacer clic muestra su contenido. **Permisos:** quien ve la página tiene que
  poder ver y bajar lo de esa carpeta (como las fotos), pero nunca navegar hacia arriba ni ver otras carpetas
  del Drive. Por eso no puede ser un link a Drive con permisos de Google (los miembros no tienen acceso al
  Drive del dueño, y un link compartido deja subir a la carpeta de arriba): la carpeta se muestra adentro de
  la app, con la lista de archivos que sirve el portero con los mismos pases. Diseño y auditoría antes de
  implementar (sin tipo de bloque nuevo). **Diseño en `Doc_Carpetas.md`**, rediseñado con las respuestas de
  Lega: vista en vivo de la carpeta de Drive, subida directa a Google, sin tope y en el plan gratis.
  **Entrega 1 hecha (v0.081):** soltar una carpeta, la ventana de qué se sube, su cola propia (los bytes por el
  portero), la tarjeta, el visor con el carrete y bajar uno, retomar volviendo a soltarla, y el portero con la
  regla de no salir del árbol. Las carpetas soltadas van al Drive sin espacios, con guiones bajos (D3 → B, 2026-10-02; antes, del 2026-10-01 a v0.127, conservaban su nombre). Falta: que Lega decida `drive.readonly` (ver lo agregado a mano en Drive), probar
  la subida directa a Google con el Drive real, "Agregar a esta carpeta", la lista sin red y "Seguir"
  en Chrome y Edge (el porqué de cada una en `Doc_Carpetas.md`, "Cómo quedó (v0.216)"). **Hecho en v0.216:** *Folder* en el menú `/` (en una computadora) y, al quitar el workspace del dispositivo, cuántos archivos de carpetas faltan subir. De esa entrega quedan (BAJO): (a) sospecha sin verificar: en Chrome, elegir una carpeta vacía en el selector del sistema lo da por cerrado sin elegir, así que el aviso de "esa carpeta no tiene archivos" no saldría y no pasaría nada; y una carpeta que solo tiene archivos ocultos abre la ventana con 0 archivos y *Upload* habilitado (igual que al arrastrarla); (b) el selector del sistema recorre toda la carpeta antes de entregarla: con una carpeta enorme la app no muestra ninguna señal de avance hasta que termina; (c) al quitar el workspace, una carpeta que todavía se está preparando y a la que solo le faltan crear subcarpetas (ningún archivo pendiente) cuenta 0 archivos y la ventana dice que todo se subió; es una ventana de segundos. **Entrega 2 hecha (*Bajar todo*, rama `lega/carpetas-zip`):**
  zip sin comprimir con Zip64 escrito a medida que llega en Chrome y Edge, o el árbol en una carpeta; en memoria con
  tope en Firefox, Safari y los teléfonos (D24); nombres de Drive limpios para Windows y la Mac (`.`, `..`, punto al
  final, `CON`…, a lo sumo 255 bytes) y cortes de 200 y 250 caracteres por grafema. *Retry missing*, el tope sin avance
  de cada pedido (R1) y el ZWJ de los emojis compuestos en la app (O4), hechos (rama `lega/carpetas-restos`); listar
  hasta 40 subcarpetas por pedido (`dirs` en `/folder/list`) y el ZWJ en el portero, hechos (v0.119, rama
  `lega/carpetas-e2`). **Corrección implementada (v0.176):** *Cancel* y el plazo cancelan también la fuente
  de un cuerpo de error HTTP atascado, liberando el lector; se mantienen los reintentos y *Retry missing* sin repetir
  lo completado (`Doc_Carpetas.md`, "Cancelar un error que queda a medias"). Falta (BAJO): si todos los archivos fallan por la red, *Download all* igual "termina" y cierra un zip que solo trae `MISSING_FILES.txt` (ya pasaba antes de v0.216; convendría decir que no bajó nada en vez de *Done*); Firefox sin tope por el service worker y probar a mano en Safari, el iPhone y con
  el Drive real (si Drive rechaza la consulta con varios padres, la app cae a de a una sin perder nada, pero gasta un
  pedido de más por tanda; medir el CPU de un pedido con 40 subcarpetas en el plan gratis). De la auditoría de la entrega
  2 (BAJO, decidido, sin acción): la confianza de 60 s del listado de varias deja listar hasta 60 s una subcarpeta recién
  movida a otro proyecto (D81). **Entrega 3 hecha (v0.142, rama `lega/carpetas-e3`):** la confianza de 60 s también
  en las páginas siguientes (con la fecha en que Drive mostró cada subcarpeta, no la del camino); el ZWJ como escape;
  el 403 de Drive por el límite de pedidos sale como `rate` (ya no como «fuera del árbol»); la marca de cada
  subcarpeta en NFC, buscando también las de antes (NFC, tal cual y NFD), y retomar en el mismo dispositivo con una
  copia de la carpeta que trae los acentos en la otra forma (un pendrive, una carpeta de red) reconoce los archivos en
  vez de pedirlos de nuevo; y la cola de una carpeta cierra la vuelta con el portero colgado (B.11). Desde otra
  computadora, soltarla de nuevo sigue siendo otra carpeta (otra tarjeta), por diseño. **Entrega 4 hecha (v0.149, rama
  `lega/carpetas-e4`):** la cola de una carpeta escucha la vuelta de la red y *Resume* vuelve a cero la cuenta de
  esperas (O5), el listado de varias subcarpetas ya no corta con `409` por más de un minuto entre páginas (O7) y una
  parte a la que Drive no le contesta al portero cuenta como trabada a los 90 s (B.11). Detalle en
  `Doc_Carpetas.md`, "Cómo quedó", "Cómo quedó (entrega 2)", "Cómo quedó (entrega 3)" y "Cómo quedó (entrega 4)".
  **Hecho (v0.179):** el visor ofrece List/Grid, con miniaturas completas y columnas adaptadas al ancho; conserva el mismo listado y sus acciones, y recuerda sólo la vista en este dispositivo. No agrega cache offline de la lista (`Doc_Carpetas.md`, "Lista y cuadrícula").
- **P.10 Espacio en el dispositivo y "Available offline"** (Lega, 2026-09-30 y D-25 del 2026-10-01): tope
  elegible, de fábrica 2 GB por workspace en cada dispositivo (pasado el tope, un aviso ofrece liberar las copias ya
  confirmadas en el Drive que hace más que no se abren, y se liberan recién con el sí; la miniatura queda), marcar una página o un proyecto para usarlo sin red (con una ventana de casillas y
  pesos), y "Espacio en este dispositivo" en el menú de la cuenta. **Diseño en `Doc_Copias_Locales.md`**
  (rehecho con D-25; auditado y aprobado). **Entregas 0 y 1 implementadas** (v0.083); **entrega 2 implementada**
  (v0.140: liberar los originales agregados en el dispositivo con la base y Drive confirmando el mismo archivo, el
  relink sin bytes y la búsqueda del portero por la marca; riesgo alto, con su auditoría antes de publicar). Falta la
  medición del iPhone casi lleno (sección 9.1, la hace Lega) y la entrega 3 (*Drive folders* con P.9 y compartir un
  archivo sin copia).
- **P.11 Colapsar secciones por sus títulos, como en Coda** (Lega, 2026-09-30): cualquier título (H1, H2, H3…)
  se colapsa con un triángulo lleno a su izquierda (apunta a la derecha colapsado, abajo abierto). Colapsar un
  título esconde todo lo que sigue hasta el próximo título de su nivel o mayor (un H1 esconde sus H2 y H3, que
  guardan su propio estado al abrirlo). El triángulo aparece al pasar el mouse por el título; en un título
  colapsado se ve siempre. Nada que activar: todos los títulos lo tienen. **Por defecto es de cada persona**
  (un filtro suyo, no cambia lo que ven los demás). **Shift+clic lo colapsa o lo abre para todos** los que
  miran la página; solo quien puede editar la página, y el tooltip lo dice (a quien solo ve, el tooltip no
  menciona Shift y Shift+clic hace lo mismo que el clic). Diseño y auditoría antes de implementar, sin tipo
  de bloque nuevo. Respuestas de Lega: en el teléfono el triángulo se ve siempre (tenue) y "para todos" solo desde
  la computadora; lo personal, por dispositivo (a futuro, que siga a la persona); "Colapsar todo / Abrir todo"
  en el menú de la página y un atajo; el tooltip dice si está colapsado para todos o solo para vos; el PDF
  imprime todo abierto por defecto, con una casilla para imprimirlo como se ve; los saltos de página en
  pantalla se marcan como si todo estuviera abierto (si una sección colapsada ocupa las páginas 2 a 4, el
  corte siguiente dice página 5); arrastrar un título colapsado mueve toda su sección; se saca "Encabezado
  plegable" del menú `/`. **Diseño en [`Doc_Colapsar.md`](Doc_Colapsar.md)** (sin tipo de bloque ni propiedad
  nueva). **Entrega 1a hecha (v0.053):** colapsar para vos, con toda la seguridad al editar, las marcas de hoja
  contadas con todo abierto y el PDF todo abierto. **"Imprimir como se ve" hecho
  (v0.067).** **Arrastrar la sección entera, Shift+Ctrl/⌘+↑/↓ y la 2 (para todos, Shift+clic) hechos (v0.084)**;
  el mover se escribe en Yjs en dos pasadas y recrea solo el lado más chico (medido con dos editores: el texto que
  nadie tocó no se pierde nunca; lo que otro escribe a la vez en el lado recreado, sí). Decidido el 2026-10-01: ese
  mover solo con secciones colapsadas en juego (1A) y los tooltips como la tabla del §3. Falta probar a mano en
  Safari, Firefox y el iPhone.
- **P.12 Buscar (urgente, Lega 2026-09-30). Entrega 1 hecha (v0.051): buscar y reemplazar en la página;
  entrega 2 hecha (v0.054): buscar en el proyecto con Ctrl/⌘+K** (`Doc_Buscar.md`, "Cómo quedó (entrega 1)" y
  "(entrega 2)"). **Entrega 3 hecha (v0.094): reemplazar en todo el proyecto** (`Doc_Buscar.md`, "Reemplazar en el proyecto
  (diseño)" y "Cómo quedó (entrega 3)"): la flecha en Ctrl/⌘+K, vista previa, una, la página o todas con confirmación,
  escrito en el Y.Doc de cada página que se puede editar y está completa, y *Undo* de todo lo que siga igual (también
  sin red y después de cerrar la app). Falta probarlo a mano en Safari, el iPhone y Firefox. Queda para después:
  reemplazar en los títulos, pies y nombres; la papelera, todos los proyectos y los comentarios. **D11 (v0.130): al buscar, las
  secciones colapsadas se abren para mostrar lo encontrado** (solo en este dispositivo y a la vista; se vuelven a cerrar al
  terminar; `Doc_Buscar.md`, "Abrir al buscar"). Queda para después: abrir también las listas plegables cerradas.
  Lo pedido: dos lupas. **En el proyecto:** una lupa a la izquierda del "+" de
  páginas en la barra lateral, que busca en todas las páginas del proyecto que la persona puede ver (títulos y
  contenido) y lleva al lugar. **En la página:** una lupa a la izquierda del ícono de comentarios, que busca en
  la página abierta, también adentro de las secciones colapsadas (P.11: el resultado abre la sección). A pensar
  en el diseño: el contenido se guarda como updates de Yjs (no texto), así que buscar en el servidor pide un
  texto derivado; buscar en el dispositivo solo ve las páginas que ya bajó; atajos (Ctrl/Cmd+F para la página,
  Ctrl/Cmd+K para el proyecto) y permisos (nunca mostrar algo que la persona no ve). Lega sumó reemplazar, como
  VS Code (sin atajo propio: se despliega desde la barra de Ctrl/⌘+F).
- **P.13 Tutorial animado y ayuda (Lega, 2026-09-30; "sí o sí lo tenemos que tener"):** la primera vez que
  alguien entra, un documento de ejemplo ya armado y una recorrida con globitos ("acá hacés esto", "acá
  aquello") que se avanza con *Siguiente*, como en tantas apps. Una **ayuda** fija (desde el menú o un "?") que
  explica cada función y **todos los atajos** (Ctrl/⌘+F, Ctrl/⌘+K, Ctrl/⌘+Alt+Enter, filas de fotos, etc.) y
  desde donde se puede **volver a ver el tutorial**. A pensar en el diseño: el documento de ejemplo no debería
  ensuciar el workspace ni sincronizarse (una página de práctica local, o una plantilla que se crea y se puede
  borrar), los dos idiomas, el teléfono, y que la ayuda se mantenga al día con cada función nueva (una regla:
  cada feature nueva suma su línea en la ayuda). **Entregas 1 y 2 hechas (v0.082, `Doc_Tutorial.md`, "Cómo
  quedó"):** la ayuda con el "?" y el menú de la cuenta, el registro único de atajos con sus pruebas, la página de
  práctica en `/practice` y la recorrida de diez pasos (nueve en el teléfono). **Entrega 3 hecha (v0.158):**
  *Show me* en las 16 entradas con un paso (la práctica con solo ese paso, y vuelta a donde estabas) y el punto de
  novedades en el "?" con *What's new* arriba de la ayuda. Falta elegir con Lega las fotos del ejemplo y probar a
  mano en Safari, el iPhone y con VoiceOver. **Hecho (v0.160):** en el teléfono el punto de novedades también está en
  el botón de menú de la barra de arriba (la de la página y la de la práctica), con la misma regla que el del "?".
- **P.14 Borrar y archivar proyectos (Lega, 2026-09-30: "¿cómo borro los proyectos viejos? No encontré de
  dónde"):** hoy un proyecto se crea, se renombra y se comparte, pero no se puede sacar de la lista: no hay nada
  para eso ni en la app ni en la base (`workspaces` no se borra desde la API). Faltan dos opciones distintas:
  - **Borrar un proyecto:** mandarlo entero a la papelera (con sus páginas y sus archivos, que pasan a la
    papelera de archivos) y poder restaurarlo. Sin borrado duro desde la app (las reglas de "nunca perder
    datos"); el borrado definitivo, como el de los archivos: a pedido y con su plazo.
  - **Archivar un proyecto sin borrarlo:** sale de la lista de proyectos de todos los días y de la búsqueda,
    pero queda entero (páginas, archivos en el Drive, comentarios, permisos) y se puede abrir y desarchivar
    desde una lista de archivados. Para los proyectos terminados.
  Las dos piden una migración (marcas en `workspaces`), decidir quién puede (editar y crear páginas sobre el
  proyecto entero, o dueño y admins), qué ven los que lo tenían compartido y qué pasa con lo que está sin
  sincronizar en otros dispositivos. Diseño y auditoría antes. Mientras tanto: renombrarlo y mandar sus páginas
  a la papelera.
  **Diseño aprobado por Lega ("sí a todo") y auditado, sin implementar: `Doc_Proyectos_Borrar.md`** (Lega, 2026-10-01: un ícono de archivar y uno de
  borrar al lado de cada proyecto; borrar con una ventana que muestra páginas, archivos y GB en el Drive, con una
  casilla para mandar también lo del Drive y la palabra `delete` / `borrar`). Papelera de proyectos con 30 días
  para restaurar, sin borrar filas; tres entregas (archivar y borrar; la carpeta del Drive; *Delete forever*) con
  sus migraciones probadas en `begin; … rollback;` contra la base. **Entrega 1 implementada (v0.077, rama
  `lega/proyectos-borrar`):** íconos de archivar y borrar en el selector, la ventana con la palabra, las listas de
  archivados y de borrados con *Restore*, el primer proyecto de cada dispositivo y la pantalla sin proyectos; la
  migración 9 ya está aplicada (verificada en la base el 2026-10-06; antes de aplicarla hizo falta la auditoría del código y la copia de seguridad).
  **Entrega 2 implementada (rama `lega/proyectos-borrar-drive`):** la casilla de Drive en la ventana de borrar
  (destildada; dueño y admins), las rutas `/project/trash` y `/project/untrash` del portero, restaurar trayendo la
  carpeta, *Restore without its files* solo con `missing` de verdad y *Look for its files again*; la
  migración 10 ya está aplicada (verificada en la base el 2026-10-06); falta correr la prueba técnica. Después, la 3 (*Delete forever*).
  **Una sola papelera (v0.162, pedido de Lega del 2026-10-03):** *Trash* sale de la barra lateral y reemplaza a
  *Deleted projects* en el selector de proyectos, con proyectos, páginas y archivos juntos del más nuevo al más viejo,
  el filtro *All / Projects / Pages / Files* y *This project / All projects*; sin migración
  (`Doc_Proyectos_Borrar.md`, "Cómo quedó: una sola papelera"). Falta probarla a mano en la compu y el iPhone.
  **Hecho en v0.218:** con *All projects* se hacía una consulta `trashed_files` por proyecto (la primera vez); ahora
  una sola (`trashed_files_all`, migración `20261108120000_papelera_archivos_todos.sql`, aplicada), y
  con una base sin la función, como antes; con más de 1000 archivos, de a páginas de 1000.
  **Hecho en v0.221 (lo que quedaba de v0.218):** la papelera de archivos se pide **de a páginas por clave**
  (`trashed_files_page`, migración `20261110120000_papelera_archivos_por_clave.sql`, aplicada): cada pedido
  sigue desde la última fila recibida y trabaja solo por su página (6.000 archivos: 7 pedidos que suman 312 ms, contra
  7 corridas enteras de 420 ms); un cambio entre dos páginas ya no corre ni saltea filas; la app corta solo cuando la
  base dice que no hay más (no por recibir pocas filas), así que un tope de filas por pedido menor no corta la lista; y
  la papelera de un proyecto usa lo mismo, sin el corte a 1000 (`Doc_Proyectos_Borrar.md`, "La papelera de archivos, de
  a páginas por clave"). La guía para crear un workspace dice el tope y `setup-workspace.mjs` lo avisa.
  **Pendiente:** (1) **Hecho en v0.231:** si el pedido único falla, sale **una** línea de error con **un** *Retry*,
  que repite ese pedido (antes, una por proyecto; D347). (2) **Hecho en v0.224, sin migración:** los comentarios de una página, el árbol, los
  proyectos, los permisos propios, los usos de archivos y los lotes de contenido ya no suponen que la API entrega 1000
  filas por pedido ni que nada cambia entre dos pedidos: se piden por clave, con el orden escrito, hasta el total que
  dice la API en la misma respuesta (los mismos pedidos que antes en una sincronización); el equipo, quién tiene
  acceso, los proyectos borrados y el peso de los proyectos dan un error si la API los recortó; y dar una página por
  comprobada recorre el historial hasta el cursor (`Doc_Sincronizacion.md`, "Las listas largas", con la tabla de cada
  lista y quién recibe su error). **Queda, por urgencia** (el detalle, en esa sección, "Lo que queda"):
  (a) **mirar en la app real**, con la pestaña de red, que la API manda el total en un `rpc` (probado contra una API de
  mentira y contra las funciones por SQL, no contra la real);
  (b) **el modo link.** **Hecho en v0.226, sin migración:** el árbol, los comentarios, los archivos y el estado de lo
  mandado del visitante se piden por clave y hasta el total; todas las filas de una bajada del árbol traen la misma
  firma; si la rama no deja de cambiar, el visitante sigue con el árbol que tenía y la bajada se reintenta de a un
  intento, cada vez más espaciado. **Queda, antes de usar links sobre ramas de más de 1000 páginas:** cada pedido de
  más cuenta el árbol entero en el tope del día del link (50 MB entre todos sus visitantes), así que el costo es
  cuadrático: con el tope de fábrica, 1501 páginas son 0,92 MB por bajada (56 por día), 5001 son 9,2 MB (5 por día),
  10001 son 33,9 MB (una) y desde unas 12.800 páginas el link no carga nunca; con un tope de 137, 1501 páginas son
  5,07 MB (10 por día). Pide `plink_tree_page`, que entregue de a páginas y cuente lo que entrega
  (`Doc_Sincronizacion.md`, "Las listas largas", "Lo que cuesta: el cupo del día del link"). Y chicos del link:
  `plink_push_status` corta en 500 páginas adentro, sin orden (confirmado con 620), y con un tope de filas bajo gasta
  varios `pass` por refresco; el orden de lo apartado en la app (`created_at`, `id`) no es exactamente el de la
  función (`n`), que tendría que devolverlo; una fila que se confirma tarde con un `n` menor no llega en esa bajada
  del aviso (llega en la siguiente); y los servidores de mentira de las pruebas no imitan el cupo `pull`;
  (b2) **la firma del árbol de un link mezcla la estructura con el contenido** (ya en la versión publicada; gravedad
  media). `plink_tree` firma también `clean_seq`, así que el árbol se vuelve a bajar y a contar **entero** con cada
  base limpia nueva de cualquier página de la rama, también con ramas chicas: 423 páginas son ~130 KB por cambio y
  por pestaña, unas 400 bajadas por día por link; con el equipo escribiendo y varios visitantes mirando, el cupo del
  día se puede ir en horas (y entonces nadie baja el árbol ni los comentarios nuevos de ese link hasta el día
  siguiente). Separar la firma de la estructura de la del contenido (o mandar aparte los `clean_seq` que cambiaron)
  pide migración;
  (c) **el costo de contar a escala. Hecho en v0.231 para el árbol, sin migración** (D346): pide el total solo
  mientras el dispositivo tiene menos de 1000 páginas; con más no lo pide y termina con una página vacía pedida por
  clave. Con 41 páginas, el mismo pedido de siempre; con 3.500, 5 pedidos sin total en vez de 4 con total (el
  primero vuelve a 1,2–2,3 s) y el tamaño desde el que la sincronización falla entera vuelve a unas 12–24 mil
  páginas. Si la base corta por tiempo un pedido que contaba (el árbol o los usos de archivos), se repite sin
  contar. **Queda:** medirlo contra la base real con un árbol grande (los tiempos son los de la auditoría de la
  v0.224); los usos de archivos, que siguen contando porque no tienen un tamaño anterior (la cola de archivos se lo
  podría pasar); y que el tamaño conocido del árbol es el de todo el dispositivo, no el de cada tanda de 100
  proyectos;
  (d) **listas donde se ve menos sin aviso.** **Hecho en v0.226:** `public_link_aside` llega entera (por clave) y lo
  que no entró de un link en una página también (`public_link_updates_page`, migración
  `20261114120000_link_no_entro_por_clave.sql`). **Quedan con lo que llega** (D323): `access_requests_pending` (corta
  en 100 adentro; al decidir uno aparece el siguiente) y `public_link_pages` (hacen falta más de 1000 links vivos);
  (e) **el cursor de los comentarios. Hecho en v0.231, sin migración** (D345): `updated_at` es la hora en que empezó
  la transacción, así que un cambio confirmado después de una bajada quedaba detrás del cursor y no llegaba nunca.
  La bajada pide desde un minuto antes hasta que el cursor queda asentado (una bajada con margen hecha un minuto
  después de la que lo movió), guarda el asentado con el cursor (al volver a abrir la app, una fila por bajada, como
  antes) y funde por id lo que vuelve a llegar; también con un link (`Doc_Sincronizacion.md`, "Comentarios
  y preguntas", "El cursor y los cambios que confirman tarde"). **Queda:** una transacción de más de un minuto hecha
  por fuera de la API; el margen fijo de 10 segundos de la campana de menciones; y que cada bajada trae al menos
  una fila aunque no haya nada nuevo (la función compara con `>=`), que en un link cuenta un `pull` por bajada;
  **Anotado al auditar la v0.231 (no se corrige ahora):** el plazo del cursor de los comentarios usa `Date.now()`:
  un salto de la hora del dispositivo de un minuto o más hacia adelante entre dos bajadas asienta antes de tiempo
  (la alternativa es `performance.now()` dentro de la sesión); una bajada de comentarios de varios pedidos que dure
  más de unos 52 s (durante una importación de miles) se come el sobrante del margen; `Date.parse` sobre fechas con
  microsegundos no está verificado en Safari (si no las lee, esa bajada es entera durante el plazo: más tráfico, nunca
  pérdida); una visita de menos de un minuto no asienta el cursor y cada una repite las bajadas con margen; lo que una
  versión anterior ya dejó detrás del cursor no vuelve solo (lo traería una bajada entera por página al estrenar la
  versión); en la papelera, si los pedidos que juntan varios proyectos fallan por motivos distintos, la línea muestra
  solo el primero; `KeyedList.add` da la lista por terminada si un pedido posterior dice un total igual a su propia
  página (viene de la v0.224, hipotético: la API cuenta lo que falta desde la clave); y sin medir contra la base real:
  la forma del `57014` cuando el pedido lleva `count=exact`, el tope de sentencia del rol `anon` (links) y los tiempos
  del árbol con y sin el total;
  (f) paginar por su clave las listas que hoy dan el error o no se muestran con un tope bajo. **Hecho en v0.231:**
  las dos que no se mostraban (invitaciones, nombres de versión) llegan enteras, por su `id`, y el "Try again" de
  `scripts/lib/management.mjs` ya no sale para lo que escribe (invitar, un ajuste). **Quedan** las cuatro que
  muestran el error (equipo, quién tiene acceso, proyectos borrados, peso de los proyectos)
  (**hechos en v0.226:** los errores crudos en inglés, el orden escrito en `link_admit_work` y `CommentQueue.refresh`,
  que limpia su error después de una bajada que sale bien). (3) Con una base sin
  `trashed_files_page` (un workspace que no aplicó la migración) la papelera de todos sigue pidiendo por tramos (un
  cambio entre dos puede correr las filas), pero desde v0.224 hasta el total, sin suponer el tope; la de un proyecto,
  como en v0.218 (un pedido, lo último primero). (4) De la auditoría de v0.221 (BAJO,
  ninguno pierde ni filtra nada; `Doc_Proyectos_Borrar.md`, "La papelera de archivos, de a páginas por clave", "Lo que
  queda"): *All projects* vuelve a bajar la papelera del proyecto abierto, que ya estaba cargada (viene de la v0.218);
  si la base repitiera una fila, el error *the same row arrived twice* llega crudo y en inglés; y un lugar armado a
  mano `(proyecto, nulo, nulo)` sobre un proyecto con archivos lo saltea entero (la app nunca lo arma).
  **Entrega 3, *Delete forever* (v0.167, D-23 (6)):** en el renglón de un proyecto borrado de la papelera, pasados los
  30 días, dueños y admins que lo manejan escriben la palabra y el proyecto sale de la papelera para siempre; es una
  marca (`purged_at`), ninguna fila se borra, y la carpeta va antes a la papelera de Drive si no estaba. Migración
  `20261101120000_proyectos_purgar.sql` (versión 23) **aplicada** (v0.167; `Doc_Proyectos_Borrar.md`,
  "Cómo quedó (entrega 3)"). Auditada (aprobada con observaciones) y publicada.
  - **Hecho (v0.171), de su auditoría:** (O3) el servidor de las pruebas aplica el corte por `uploaded_at` de
    `drive_trash_first`, como la base; (O4) un proyecto borrado para siempre ya no suma en el peso lo que nunca subió (lo
    mandado a la papelera de Drive cuenta ahí sus 30 días, como cualquier archivo). Migración
    `20261103120000_purgados_peso_link_total.sql` (schema 25), **aplicada** (`Doc_Proyectos_Borrar.md`, "Restos de la
    auditoría de la entrega 3").
- **P.16 Hecho (v0.074): el árbol de páginas con el teclado** (Lega, 2026-10-01). Con el foco en una fila
  (queda ahí después de un clic): ↑ / ↓ abren la página visible anterior o siguiente (una pulsación al
  instante; con la tecla apretada el foco corre y se abre la última al frenar, 150 ms), → despliega o pasa a la
  primera subpágina, ← pliega o va a la página madre, Inicio / Fin a la primera o la última, Enter / Espacio
  abren. Solo con el foco en el árbol y sin Ctrl, ⌘, Alt ni Shift. Y el defecto: plegar con el triángulo (o
  con ←) una madre de la página abierta no dejaba; ahora pliega y la abierta pasa a ser esa madre (en el
  teléfono el cajón sigue abierto). Lógica en `src/ui/treeNav.ts`. Su entrada en la ayuda está desde v0.082 (P.13).
  Ancho del nombre (D233, v0.154): sin mouse, foco ni menú abierto el nombre usa todo el ancho de la fila (también en
  la página abierta, D242) y recién ahí lleva «…»; ⋯ y + (que no ocupan lugar mientras no se ven) le sacan su lugar con
  el mouse encima, el foco en la fila o en sus botones, o el menú ⋯ abierto. En el teléfono (`hover: none`) la página
  abierta los muestra siempre, como antes. Pendientes menores de su auditoría: (O2) `:hover` y `.menu-open` no se pueden
  calcular en jsdom; la prueba afirma el texto del selector y la medición real está en Chromium; (O3, resuelta en
  v0.160) un clic con el mouse en el triángulo o en la fila dejaba el foco ahí y, por `:focus-within`, sus ⋯ y + (y el
  nombre cortado) hasta que el foco se iba; ahora la regla es `:is(:focus-visible, :has(:focus-visible))`: con el
  teclado (flechas, Tab) siguen apareciendo, con el mouse no se quedan.
- **P.17 Hecho (v0.079): instalar la app** (Lega, 2026-10-01). La app reconoce si está instalada; si no, ofrece
  *Install app* en el menú de la cuenta y en la pantalla de entrar, y en el teléfono un aviso que se cierra por 30
  días. La ventana muestra los pasos con dibujos para iPhone, Android y computadora, con *Install* directo donde
  el navegador lo ofrece. Ver `Doc_Instalar.md`. Su entrada en la ayuda está desde v0.082 (P.13). Falta: probarlo en un iPhone y un Android reales, y a futuro las capturas del manifiesto (`screenshots`) y la
  pantalla de arranque del iPhone.
- **P.18 Historial de versiones de una página, como el de Google Docs** (Lega, 2026-10-01; era la fase 6): ver quién
  cambió la página y cuándo, cada versión con lo agregado y lo borrado en el color de cada persona, y volver a una
  versión anterior. **Diseño en `Doc_Historial.md`** (auditado; las cuatro preguntas, decididas el 2026-10-01): las
  versiones salen de `page_updates` aplicadas en orden (sin guardar nada nuevo; cada fila ya tiene autor y hora
  puestos por la base) y restaurar es una edición por el editor que se deshace. **Entrega 1 hecha (v0.098):** la lista
  por sesión con quién y cuándo, ver una versión y restaurarla (Ctrl/⌘+Alt+Shift+H); la migración
  `20261007120000_historial.sql`, aplicada desde v0.098. **Entrega 2 hecha (v0.103):**
  *Show changes* con lo agregado y lo borrado por persona (decoraciones, bloques rehechos apareados por id), el texto
  huérfano en su versión, el Worker con la página de respaldo, la diferencia solo de lo tocado y la lista que se
  actualiza sola. **Entrega 3 hecha (v0.106):** versiones con nombre (`page_versions`: nombrar, renombrar, quitar,
  *Only named versions*, *Restored from…*) y la caché `<base local>:history` con el historial sin red. Migración
  `20261011120000_versiones_con_nombre.sql` aplicada (2026-10-02, `schema_version` 13). **Restos de las auditorías hechos (después de v0.106):** restaurar una versión con dos bloques del mismo id, la consulta
  al confirmar (O9), la generación del servidor antes de la caché (O7), Ctrl/⌘+Z deja de lado *Restored from…*, el hijo
  repetido de dos sangrías a la vez (O2) y las pruebas de M5 y M10 (`Doc_Historial.md`, "Lo que quedó de las entregas").
  **Falta:** medir en el iPhone. **Hecho en v0.219:** la marca *Restored from…* de una restauración que no llegó a
  subir antes de cerrar la app se termina sola después de sincronizar, sin abrir el historial de esa página (antes se
  perdía si no se abría en una semana; con la app más vieja que la versión mínima espera en vez de perderse;
  `Doc_Historial.md`, "*Restored from…* sin abrir el historial", con lo que no se hizo: los pedidos de fondo sin
  espaciar ni guarda contra dos a la vez y hasta 2.000 filas, la marca de una página que nunca sube, y la marca de fondo
  que no se ve en un historial ya abierto). **Hecho en
  v0.214 (O3):** renombrar una versión deja el nombre anterior guardado en la base, con quién lo cambió (migración
  `20261105120000_versiones_renombrar_rastro.sql`; no se muestra en la app). Aparte, después: que lo borrado no llegue a quien solo ve la página (decisión 2;
  diseño en `Doc_Privacidad_Borrado.md`, B.18).
  Ojo: `npm run db:test` aplica las migraciones de verdad; esta se probó con un script en `begin … rollback`.
- **P.19 Link público: *Anyone with the link*** (Lega, 2026-10-02): en *Share*, además de personas y correos, un link
  que cualquiera abre sin cuenta, con *Can view* (que siempre puede comentar) o *Can edit*; "debería estar seguro".
  **Entregas 0 y 1 hechas (v0.114: *Can view*, migración aplicada (verificada en la base el 2026-10-06); ver "Cómo quedó" en `Doc_Link_Publico.md`).** Para
  publicarla del todo falta prender el interruptor de D14 (`clean_min_version`, hoy nulo, apagado); la migración ya está aplicada. **Hecho en v0.215:** el ícono del árbol para las
  páginas con link propio (lo ve quien puede compartir la página; lo confirma la base) y, en *Share*, quién creó el link y
  cuándo. **Hecho en v0.222:** decir en cada comentario de qué link vino (*Can view link · created by…*, solo a quien
  puede compartir la página del link; migración `20261113120000_link_rotulo_comentarios.sql`,
  **aplicada**; `Doc_Link_Publico.md`, "De qué link vino cada comentario (v0.222)"). Falta: probarlo en la app
  real con dos cuentas y en el tema oscuro; lo que queda sabido está en esa sección ("Lo que queda": el store no mira
  la versión mínima, `alive` no mira la papelera y el costo para quien comparte crece con las páginas distintas).
  **Hecho en v0.224:** la vista de compatibilidad de los comentarios pide también `imported_*` y `mentions` (la vista
  las tiene y una sesión las puede leer: comprobado en la base), bajando de a un escalón si a una base anterior le
  falta alguna; y el nombre muy largo y sin espacios de una persona con cuenta o de un comentario importado ya no se
  sale del comentario (500 px en un panel de 375): `.comment` declara su única columna y el nombre se recorta con "…",
  con el nombre entero en el tooltip solo si quedó cortado. Visto en un navegador a 375 px y en escritorio, claro y
  oscuro, sobre una página estática con el HTML del panel; con nombres normales, las 105 cajas del panel miden lo mismo
  que antes. jsdom no calcula el layout: sin prueba automática. Falta mirarlo en la app real. Y la entrega 3.
  **Hecho en v0.229 (lo anotado al auditar la v0.228):** (1) **un cuadro de comentario abierto ya no desaparece con
  lo tipeado si el hilo se resuelve o el comentario se borra desde otro lado** (era anterior a la v0.228): el hilo
  con un cuadro abierto se queda en su lista hasta que el cuadro se cierre, con un aviso de que se resolvió (D337), y
  lo borrado sigue a la vista con el cuadro que no puede guardar, *Copy text* y confirmación (D338). Cerrar o recargar
  el navegador con algo escrito pregunta; cambiar de página, o que la página deje de verse, deja un aviso con *Copy
  text* (D339). (2) *Retry* y *Discard…* del cartel de varias rechazadas dicen la cantidad, y la confirmación va en
  plural (D340). (3) Las pruebas que faltaban: *Cancel* sin preguntar y Escape preguntando en los cuadros normales;
  la lista del cartel sin textos de otros comentarios; la pantalla del link escuchando el aviso de los comentarios;
  la papelera pasando el motivo por `localize`. (4) La pantalla sin proyectos sale con `signOutQuestion`. (6)
  `CommentQueue.edit` sin base carga antes los comentarios de la página y rechaza el comentario que el dispositivo
  no tiene. (7) La X y tocar afuera con el cuadro que no puede guardar preguntan con el texto del caso.
  **Queda de esa lista:** (5) reintentar varias rechazadas con la misma base: la primera entra y las demás chocan
  con ese texto, que es propio, y el aviso habla de «otro lado» (no se pierde nada). Decirlo bien pide que la cola
  recuerde qué texto mandó este dispositivo y lo guarde con lo apartado (`setAside` y la forma de `editConflict:`
  en `meta`, que también leen las versiones anteriores).
  **Hecho en v0.230 (lo anotado al auditar y al hacer la v0.229):** (1) **salir de la cuenta con un comentario a
  medio escribir pregunta**: la pregunta de siempre suma una oración (*A comment you are writing has not been sent
  and will be lost.*), una sola con lo pendiente y lo rechazado; quitar el workspace del dispositivo, igual (D341).
  Los demás caminos que desmontan todo ya lo miraban (la tabla está en `Doc_Sincronizacion.md`). (2) **Un comentario
  nuevo con algo escrito ya no se cierra cuando se le pide otra cosa al panel** (*Comment* en otro bloque, abrir un
  hilo desde el margen o desde la campana, *Comment on the page*): se queda como está, y puede haber uno por bloque
  (D342). (3) Varios cuadros con texto que se cierran a la vez salen en **un solo aviso**, que dice cuántos son y cuyo
  botón los copia todos, separados por una línea en blanco (D343). (4) El aviso flotante en el teléfono (hasta
  760 px) va anclado a los dos costados: a 375 px mide 343 por 90 (antes 210 por 175, con el botón en tres
  renglones). Y los botones de un aviso no se achican en ninguna pantalla: en escritorio y en castellano *Copiar el
  texto* salía en dos renglones (a 1280 px, 640 por 60) y ahora en uno (640 por 56); de 761 px para arriba ningún
  otro aviso cambió (medido). (5) `Panel` lleva `key` por
  página. (6) La prueba que faltaba: con un cuadro de edición abierto, las otras respuestas que se borran dejan de
  verse. (7) El rótulo de los resueltos cuenta los resueltos de verdad (D344).
  **Queda de esa lista:** (a) **cambiar de página con un comentario a medio escribir sigue sin preguntar** (D339 no
  cambió: el aviso con *Copy text*, 15 segundos; el Atrás del navegador, igual). La salida sin límite de tiempo es
  guardar el borrador de cada cuadro y devolverlo al reabrirlo; **no se hizo: abre preguntas que no son obvias**. El
  diseño, para cuando se decida: lo escrito en un cuadro se guarda en el dispositivo mientras se escribe (con un
  respiro de unos 300 ms, y al desmontarse) en la base de comentarios de **esa cuenta** (`commentsDb`, almacén
  `meta`, que ya existe y es de clave y valor: no hace falta subir la versión de la base local, que dejaría afuera a
  una versión anterior abierta), con la clave `draft:<página>:<cuadro>` (`new:<bloque o página>`, `reply:<hilo>`,
  `edit:<comentario>`) y el valor `{ text, mentions, base, at }` (`base`: el texto del que partía una edición). No
  entra a la cola ni viaja; se va con la base al quitar el workspace; se borra al mandar, al cancelar y al cerrar el
  panel confirmando. Al montarse, el panel lee los de su página y el cuadro que tiene uno arranca con ese texto. Lo
  que hay que decidir antes: cómo se entera la persona de que hay un borrador esperando en otra página (sin una
  marca en el árbol o en el botón de comentarios queda escondido); qué pasa con una respuesta guardada para un hilo
  que mientras tanto se resolvió (el panel no ofrece *Reply* ahí) o se borró, con una edición cuyo comentario cambió
  (la base guardada choca: iría a lo apartado de D326) o se borró, y con un comentario nuevo en un bloque que ya no
  está; cuánto dura un borrador que nadie reabre y quién lo limpia; si con el borrador guardado siguen haciendo falta
  las preguntas de cerrar, recargar y salir de la cuenta; y dos pestañas con el mismo cuadro. Tamaño estimado: 250 a
  300 líneas de producto, más pruebas. (b) El panel montado sobre una página que dejó de verse se desmonta entero
  (`PageView.tsx`): los cuadros se van con el aviso. (c) Sin recorrer con el router de verdad: el Atrás del navegador
  y el cambio de proyecto (pasan por el mismo desmontaje).
  **Hecho en v0.232 (lo anotado al hacer y al auditar la v0.230):** (i) **cuando la app se reemplaza sola, lo
  tipeado en un comentario ya no se pierde en silencio**: si al cerrarse un cuadro con texto no queda ninguna pantalla
  que dibuje el aviso, el texto queda en un **cartel fijo arriba de todo** (*A comment you were writing was not
  sent…*, con el texto entero, *Copy text* y *Discard*), que no vence y está afuera de lo que se reemplaza (junto a la
  barrera de la raíz): sirve para otra pestaña que toma el control, sacar a la persona, quedarse sin proyectos, un error
  que frena la app y la sesión que se corta (D348). Mientras no se copió, cerrar o recargar pregunta; descartarlo sin
  copiar, también. Salir de la cuenta diciendo que sí a perderlo no lo deja en el cartel. (ii) Después de un «sí» a la
  pregunta de la app por el comentario (*Reload*, forzar la actualización, cambiar o quitar el workspace) **el navegador
  ya no pregunta de nuevo**; si la salida no ocurre, el «sí» deja de valer (D349). (iii) Cambiar de workspace con un
  comentario a medio escribir y algo sin subir hace **una sola pregunta**. (iv) **En el teléfono, los avisos van por
  encima del botón redondo de dictar** cuando está en pantalla, y los apilados (el avance de reemplazar, los del
  espacio) por encima del aviso común aunque ocupe varios renglones (medido de 320 a 759 px; de 761 px para arriba no
  cambió nada). (v) `noticeLayout.test.ts` descubre solas las variantes del aviso. Detalle en `Doc_Sincronizacion.md`,
  "Un cuadro abierto y lo que llega de afuera". En la auditoría se corrigió: el cartel es de la cuenta que lo escribió
  (entra otra en la misma ventana y se descarta) y las salidas de la cuenta lo cuentan en su pregunta (D350); el «sí» de
  salir de la cuenta se anota recién al salir (cancelar la ventana de salir lo dejaba puesto); el cartel entero no pasa
  del 45 % de la pantalla; si el cartel falla, un respaldo con los textos.
  **Anotado al auditar la v0.232:** (1) si el respaldo del cartel también fallara, no se ve nada (la pregunta al
  cerrar la ventana sigue). (2) Un «sí» a *Reload* y, antes de que recargue, la app se reemplaza sola: el texto no va
  al cartel (la persona había aceptado perderlo). (3) Sin `:has()` (Safari anterior a 15.4) vuelve lo de la v0.230:
  el aviso largo tapa el botón de dictar y el cartel no achica la app de abajo. (4) De 761 px para arriba los
  apilados siguen a 76 px fijos: con un aviso común de dos renglones (a 761 px en castellano) se superponen (ya
  pasaba); llevar `--notice-height` a todos los anchos los movería también a 1280 px con un aviso de 56 px (sin
  superposición hoy), así que no se hizo. (5) `.link-offline` y el aviso común salen en el mismo lugar, y
  `.replace-progress-bar` y `.space-notice` también (ya pasaba). (6) La cola de avisos (abajo, iii). (7) Quitar el
  workspace con éxito retira el «sí» si la página no se va (`untilLeft`), sin prueba propia (la salida es
  `location.replace`). **Corregido en la re-verificación:** con un cartel sin copiar y además un cuadro abierto, el
  «sí» a *Reload* (que cuenta solo los cuadros) hacía que el navegador no preguntara por el cartel; y si salir de la
  cuenta fallaba, el cartel ya se había descartado. **Anotado en la re-verificación:** la pregunta de salir dice «A
  comment you are writing…» también cuando lo que cuenta es el cartel; ninguna prueba fija que cambiar de workspace
  con un cartel no pregunte dos veces (si se rompe, pregunta de más: no se pierde nada).
  **Hecho en v0.234 (lo anotado al auditar la v0.232 y su «Queda»):** los avisos van en cola: el *Copy text* de un
  comentario cerrado no lo saca ningún otro aviso (D356), uno sin botón sobre uno con botón sale ya y el del botón
  vuelve (D357), lo que espera vence y tiene tope (D358); el aviso va anclado a los costados a todos los anchos (a 761
  y 900 px ya no topa en media pantalla); sus botones de texto miden 36 px en pantallas táctiles; los avisos de abajo
  se apilan por su alto real a todos los anchos, también los de un link (el de sin red y el común ya no salen en el
  mismo lugar, ni el avance y los del espacio); la pregunta de salir dice «A comment you wrote…», que vale también
  para el cartel (D359), y una prueba fija que cambiar de workspace con un cartel pregunta una sola vez. Detalle:
  `Doc_Sincronizacion.md`, «Los avisos de abajo».
  **Queda:** un *Cancel* equivocado con varios cuadros (5 de abajo); en el teléfono, con un link *Can edit* y el
  botón de dictar en pantalla, los avisos del link siguen debajo del botón (ya pasaba); sin ver la app real en un
  teléfono.
  **Anotado al auditar la v0.234:** (1) mientras un *Copy text* está a la vista, un aviso sin botón que llega después
  espera 6 s y vence antes de los 15 s del de arriba: no se ve nunca (incluye errores de `notify`; es lo que deciden
  D356 y D358). (2) Un *Copy text* que llega sobre un *Undo* lo descarta (`notice.ts`, `place`, regla 3): sería más
  seguro mandar el *Undo* a esperar, como la regla 2. (3) «Esperan como mucho tres» (D358 y `Doc_Sincronizacion.md`)
  sugiere que se ven los tres: de los avisos sin botón se ve solo el último. (4) Un *Undo* que espera no vence: con
  avisos sin botón seguidos puede salir unos 50 s después, fuera de contexto. (5) Ya pasaba: si la app se reemplaza
  sola con un *Copy text* a la vista o esperando, ese texto no pasa al cartel.
  **Anotado al hacer la v0.230:** (i) **las pantallas que reemplazan la app sin que la persona lo pida** (otra
  pestaña toma el control, sacaron a la persona del workspace, se borraron todos los proyectos, un error que frena la
  app: `Workspace.tsx`, `RemovedScreen.tsx`, `ErrorBarrier.tsx`) desmontan el cuadro junto con la pantalla que dibuja
  el aviso: lo tipeado se pierde en silencio, sin pregunta posible. El borrador guardado de (a) lo resolvería; lo
  barato sería que esas pantallas también dibujen el aviso (hecho en v0.232). (ii) Entre 761 y unos 1100 px el aviso sigue topado en
  media pantalla (a 1280 px, en 640). (iii) Un aviso con botón reemplazado por otro aviso antes de
  sus 15 segundos pierde el botón (el de un comentario cerrado, y también *Undo*): el aviso tiene un solo lugar
  (`notice.ts`). (iv) Cambiar de workspace con un comentario a medio escribir y cambios sin subir hace dos preguntas
  seguidas (`useLeaveGuard`); salir de la cuenta, una (hecho en v0.232).
  **Anotado al auditar la v0.230:** (1) **en el teléfono, un aviso largo ahora tapa el botón redondo de dictar**
  mientras está a la vista (6 o 15 segundos; medido entre 375 y 759 px): es consecuencia de anclarlo a los costados;
  subir el aviso por encima del botón en el teléfono (`styles.css`, `.notice` y `.dictate-fab`), con los avisos que
  van apilados a 76 px (hecho en v0.232). (2) Después de una pregunta de la app por el comentario a medio escribir (*Reload*, forzar la
  actualización, cambiar o quitar el workspace), el `beforeunload` sigue mirando `hasDrafts()` y el navegador
  mostraría además su propia pregunta (anterior a la v0.230; por lectura: hay que mirarlo en un navegador real; hecho
  en v0.232).
  (3) Los botones del aviso miden 21 px de alto en pantallas táctiles. (4) `noticeLayout.test.ts` lee el CSS como
  texto y su lista de variantes es fija: que las descubra por expresión regular (hecho en v0.232). (5) Con varios cuadros abiertos, un
  *Cancel* equivocado descarta ese texto sin pregunta (*Cancel* nunca preguntó; Escape y la X, sí). (6) Sin ver: la
  app real en un navegador y en un teléfono, el Atrás y el cambio de proyecto con el router de verdad.
  **Hecho en v0.228 (lo anotado en la re-verificación de v0.227):** (1) el cuadro de edición abierto sobre lo guardado
  cuando una rechazada vieja se reintenta, choca y pasa a ser lo apartado ya no lleva a perder lo tipeado: el aviso
  dice que desde ahí no se puede guardar, el cuadro suma *Copy text* de lo escrito y *Cancel* pide confirmación (solo
  en ese estado), y el error de guardar dice lo mismo (D332). (2) Las cuatro pruebas que faltaban (una edición
  posterior sin base se va con lo apartado; las menciones nuevas al reescribir lo apartado; la base que se **manda**
  en la segunda de dos ediciones viejas encadenadas; la copia de las menciones en `meta` cuando quedan otras
  esperando). (3) Una edición nueva que se funde en una marcada `unchecked` conserva la marca. (4) Con varios textos
  rechazados del mismo comentario, el cartel dice cuántos son y cada uno lleva su *Copy text* (D335). (5) Salir de la
  cuenta con algo rechazado o con una edición esperando decisión pregunta antes y lo dice (D333). (6) En una pantalla
  táctil, los botones de la caja del conflicto, del cartel de un rechazo y del cuadro de edición miden 36 px de alto
  (18 antes); el escritorio no cambia. Visto en un navegador a 375 px (táctil) y a 1280, sobre una página estática
  con el HTML del panel; falta mirarlo en la app real (`Doc_Sincronizacion.md`, "Dos ediciones del mismo comentario").
  **Lo que queda de esa lista:** si las menciones de una primera edición que entró se reemplazan por las de una
  segunda que queda apartada y después se descarta, a quien nombraba la primera no se le avisa (ya era así). Y lo
  que se vio al hacerlo: la marca `unchecked` solo se podía perder en una edición que una versión anterior dejó sin
  base y sin comentario guardado del que tomarla (las que vuelven después de restaurar una copia entran a la cola ya
  intentadas, y nada se funde en ellas): el caso «después de restaurar» de la nota no se alcanzaba.
  **Hecho en v0.227 (anotado en v0.224):** una edición vieja de un comentario ya no pisa una posterior. Dos
  dispositivos de la misma persona editaban el mismo comentario (solo quien lo escribió lo edita) y `edit_comment`
  guardaba el último que **llegaba**, aunque se hubiera escrito antes. Ahora la edición lleva el texto del que partió
  (`edit_comment(p_id, p_body, p_base)`, migración `20261115120000_comentario_edicion_base.sql`,
  **aplicada**); si la base ya tiene otro, no pisa, y la app deja lo propio apartado en el dispositivo, al
  lado de lo guardado, con *Keep mine* y *Discard mine…* (`Doc_Sincronizacion.md`, "Dos ediciones del mismo
  comentario"; D325 a D329). Se compara el texto y no `edited_at`, que era el diseño anotado: no depende de ninguna
  fecha y dos ediciones seguidas del mismo dispositivo se encadenan solas. La migración quedó aplicada y `min_app_version`
  subió a 0.227 al publicar (D329): la mínima frena de verdad una edición nueva
  hecha desde una versión vieja (503 `app_outdated`, no escribe), pero no cubre lo que esa versión ya dejó en la
  cola, que al actualizarse toma de base lo guardado en el dispositivo (acierta si no bajó nada en el medio): achica
  el hueco, no lo cierra. `plink_edit_comment` no cambia: el visitante edita lo suyo desde el mismo navegador, así que
  no hay dos dispositivos que choquen (dos pestañas siguen con «gana la última»). **Falta verlo con los ojos:** en la
  app real con dos dispositivos, en el teléfono y en el tema oscuro. El aviso se probó montado en jsdom, que no
  calcula el layout, y sobre páginas estáticas con el HTML del panel se midió por geometría del DOM y contraste (sin
  desborde a 375 px, contraste mínimo 5,7); nadie logró capturas de la app andando. **Anotado, sin hacer:** salir de
  la cuenta no cuenta lo rechazado ni lo apartado en el menú (`src/ui/menus.tsx`; ya era así para lo rechazado, y no
  se pierde nada: quedan en la base del dispositivo); en el teléfono los botones del aviso miden 18-19 px de alto,
  igual que los del cartel de rechazo que ya existía (los dos quedan chicos para el dedo); los dos textos del aviso
  tienen el mismo estilo y los distingue solo el rótulo; «quitar del dispositivo» desde una pestaña con una versión
  vieja no contaría lo apartado (lo cubre subir la mínima); y, si hace falta, un tercer camino para juntar los dos
  textos a mano (hoy se copia uno y se edita el otro).
  **Entrega 2a hecha (v0.151: escribir; migración `20261028120000_link_editar.sql` aplicada (verificada en la base el 2026-10-06), `schema_version` 19, y el
  interruptor `link_edit_min_version` ya prendido en 0.151; ver "Cómo quedó la 2a" en `Doc_Link_Publico.md`).** Para prenderla hacía falta: la
  barrera de error alrededor de `PageEditor` en `main` (R4), aplicar la migración, subir la mínima y poner
  `link_edit_min_version` (la migración y el interruptor ya están en la base). **Su auditoría
  dio no aprobado (el paso 8) y se corrigió en una ronda** (`Doc_Link_Publico.md`, "Correcciones de la auditoría de la
  2a"). Queda de esa auditoría O4 (con D14 apagado se escribe igual en la sala). Al publicar la 2a, subir
  `min_app_version` a ella (O5: la publicada pasa *Can edit* a *Can view* al cambiar el vencimiento).
  **Entrega 2c hecha (v0.157: lo apartado a la vista; migración `20261029120000_link_apartado.sql` aplicada (verificada en la base el 2026-10-06),
  `schema_version` 20; ver "Cómo quedó la 2c" en `Doc_Link_Publico.md`):** la lista en *Share*, *Set aside (via link)* en
  el historial, el ícono del árbol y "volver a la página como la ve el equipo" para el visitante (la salida de la cadena
  de D235); con O3 (el orden de la admisión por dispositivo), O9 (la pantalla de link muerto recuerda lo mandado) y R1
  (una página ya honda admite lo que no la ahonda); su auditoría la aprobó con observaciones, corregidas (O1 a O4 y O6). La migración ya está aplicada. Quedan: que el
  dueño pueda descartar lo apartado después de bajarlo (decisión de Lega: va contra "no hay borrado duro"), las filas
  con una versión inventada cuentan en los 20 MB de lo que espera de su link hasta *Reset link* (BAJO, O5 de su auditoría:
  no contar lo que tiene una versión mayor que la de cualquier editor que admitió hoy, o mostrarlo en *Share* como
  trabado), y probar a mano
  con el link de verdad la descarga y la vuelta a la versión del equipo en Safari del iPhone (la descarga de un JSON).
  **Entrega 2b hecha (v0.164: fotos, videos y archivos por un link al Drive del dueño; migración
  `20261030120000_link_archivos.sql` aplicada, `schema_version` 21, y el portero; ver "Cómo quedó la 2b" en
  `Doc_Link_Publico.md`):** registrar con los topes de E2.5 sin vincular nunca un id ajeno, la miniatura, el original por
  el portero solo de lo que registró el link (con cada parte validada), la carpeta del proyecto por su huella o
  `Via_link`, y lo escrito de una página que espera a que sus archivos estén registrados. La migración ya está aplicada (verificada en la base el 2026-10-06); falta publicar el portero con la app si no está. **Decisión de Lega (2026-10-03), hecha en la ronda 1:** lo que
  subió un link no se borra ni va solo a la papelera; *Share* lista los archivos de los links de la página (de
  `files.plink_id`, también de links reseteados y lo subido sin usar) con *Download*. **Junto a D184** (descartar lo
  apartado, cuando exista): descartar manda también sus archivos a la papelera de archivos. Quedan: que `plink_open` diga
  el tope por archivo (hoy la app usa 500 MB fijos); un tope de todos los links juntos para archivos
  (`link_limits.all_upload_bytes`, O7: hoy cada link sube hasta 1 GB por día; cargarlo ya funciona sin código); que la
  política de `page_files` no liste a lectores e invitados los usos de un link que ninguna fila admitida muestra (O4); que
  el visitante no pueda marcar lo suyo con otro id de Drive llamando `plink_set_file_drive` a mano (O8c: no gana nada, el
  portero exige la marca `sdFile`, solo rompe lo suyo); no loguear nunca el usuario `plink:<huella>` del portero (es la
  huella del token, igual a `public_links.token_hash`, O8b); con dos workspaces en el mismo Drive, `findMarked` por un id
  elegido por un visitante; y probar con el portero y el Drive de verdad (lista de Lega).
  **Entrega 2 rediseñada (2026-10-02):** lo que escribe un link espera en una sala
  (`public_link_updates`) y entra a `page_updates` cuando el dispositivo de un editor lo prueba (`link_admit`); partida
  en 2a (texto), 2b (archivos) y 2c (lo apartado a la vista); propuestas LE1 a LE13. **Auditado: aprobado con
  condiciones, corregido** (B1 a B5, E2.18) **y aprobado en la re-verificación** (con la condición C1 aplicada: un
  bloque de imagen vacío entra). **Para la 2a** (R1 a R4): en modo link, no mandar una subida que pase `push_max_bytes`;
  `plink_push_status` cuenta como `pass`; el paso 8 acepta `tableCell.colwidth` como lista o nulo, con un caso honesto
  por cada propiedad propia de la app; y **no prender `link_edit_min_version` hasta que la barrera de error alrededor de
  `PageEditor` esté en `main`**. Observaciones que quedan para
  después: adelantar a la 2a "volver a la página como la ve el equipo" para el visitante con algo apartado; **decisión de
  Lega:** que el dueño pueda descartar algo apartado después de bajarlo (la sala solo crece, hasta 100 MB por link, y va
  contra "no hay borrado duro"); probar el script de restaurar del repo privado con la sala y las columnas nuevas;
  `plink_set_file_drive` (2b) abierta a `anon` es inofensiva (el portero exige `appProperties.sdFile`); invitar al
  cliente con Editar ya cubre "el cliente escribe" sin superficie anónima. **Para D14:** la base limpia lleva los ids de
  archivos de las anotaciones borradas (la clave de `photoMarkup`, sin el contenido); no da acceso por sí sola
  (`Doc_Link_Publico.md`, "Entrega 2: *Can edit* (rediseño 2026-10-02)").
  **Observaciones de las auditorías que quedaron para después** (ninguna pierde datos ni abre el link): en el visitante, *Open my workspace* desde la
  cabecera del link, pruebas de las guardas de la interfaz (*Resolve*, papelera, preferencias, cartel del dominio,
  modo liviano), limpiar las bases locales de
  links viejos, la ayuda
  según quién la lee; en la base, tiempos de un token que ya existe (el doc dice «cuesta lo mismo»), el costo sin contar
  de `plink_tree(sig)` (26 ms con 423 páginas), y el `max_rows` de PostgREST (1000: ramas más grandes llegaban cortadas;
  **hecho en v0.226**: `Doc_Sincronizacion.md`, "Las listas largas", "El modo link").
  **Hecho en v0.221, de esas observaciones:** la base saca «(via link)» del nombre del visitante al comentar y al
  escribir (migración `20261112120000_link_nombre_sin_rotulo.sql`, aplicada). **Limpia en vez de
  rechazar** (D314): rechazar dejaba sin entregar para siempre lo de una app anterior a v0.215. Queda afuera, a
  propósito, el nombre de un comentario importado (D315; `Doc_Link_Publico.md`, "El nombre del visitante sin el rótulo,
  también en la base"). **Queda:** la limpieza no cubre los parecidos, igual que la app (la `í` descompuesta, U+180E,
  la `ı` sin punto, las letras de ancho completo, las cirílicas que se ven iguales, `[via link]`): cerrarlos pide
  normalizar el nombre en la app y en la base a la vez.
  **Hecho en v0.215, de esas observaciones:** la pantalla del link que ya no anda muestra los comentarios sin mandar, para
  copiarlos; quien entró con un link que no edita lee qué pedir (otro link) en vez de «Ask for edit access»; el nombre
  del visitante no puede traer «(via link)»; la prueba del portero de los pases de 2 horas en `/folder/list`; el texto de
  los pases del listado (cuenta uno por pedido, no uno por archivo); y la línea de ayuda del link de una página en la
  papelera, con los errores del link dichos en palabras en *Share* (`Doc_Link_Publico.md`, "Restos del link (v0.215)").
  **Hecho en v0.212, de esas observaciones:** *Restricted* pregunta antes como *Reset link*; el uso de hoy en singular y en
  plural; `LinkRemote` cierra también archivar, borrar, restaurar y borrar para siempre un proyecto; y la fecha de
  vencimiento de un link que ya existe se elige en un campo de la ventana, sin `prompt()` (`Doc_Link_Publico.md`, "Restos
  de las auditorías, en *Share* y en el visitante").
  Las dos observaciones de su revisión quedaron **hechas en v0.215**: el campo de fecha se cierra cuando el link se apaga,
  se renueva o se crea otro, y Enter en el campo confirma como *Set date*.
  **Quedó de v0.215** (`Doc_Link_Publico.md`, "Restos del link (v0.215)", "Lo que queda, sabido"): (a) si una
  confirmación del ícono viaja justo mientras *Share* crea o apaga ese link, la respuesta vieja pisa la nueva y se corrige
  sola en la vuelta siguiente (2 a 10 minutos); (b) **privacidad, hecho en v0.218:** `public_link_pages()` contestaba a
  cualquiera que ve la página, invitados incluidos si la llamaban a mano, y revelaba que la página tiene un link; ahora
  contesta solo a quien puede compartirla, con lo que dice el ícono (migración
  `20261107120000_link_paginas_quien_comparte.sql`, aplicada). **Hecho en v0.221:** tardaba 750 ms con 608 links
  para quien comparte y 240 a 390 ms para un miembro que no recibe nada (lineal en todos los links del workspace, y la
  app la pide cada 2 minutos); ahora corta al principio sin rol o para un invitado, mira solo los proyectos propios de
  quien no es dueño ni admin, y mira el permiso una vez por proyecto (la página, solo si el proyecto no alcanza), con el
  mismo resultado para cada sesión: 182 ms para quien comparte y menos de 1 ms para quien no recibe nada (migración
  `20261111120000_link_paginas_sin_recorrer_todo.sql`, aplicada; `Doc_Link_Publico.md`, "La lista de páginas
  con link, sin recorrer todos los links"). **Queda:** un admin sin «Editar y crear páginas» sobre el proyecto entero
  todavía hace mirar el permiso link por link en ese proyecto (con 613 links, de 400 a entre 270 y 330 ms): pide
  resolver de una vez sus permisos por página. **Arreglado en v0.218,
  falta probarlo de verdad:** quien entraba por un link no podía abrir originales, videos ni adjuntos, ni subir (el
  portero no aceptaba el header de la versión que manda la app; `Doc_Link_Publico.md`, "El portero no aceptaba la
  versión de la app"): probar un link con fotos, un video y una subida contra el portero real; (c) la pantalla del link que ya no anda abre (y crea si no
  existía) la base local de comentarios, y un comentario ya entregado cuyo acuse se perdió figura como «no mandado»; el
  aviso del link *Can edit* que esta app usa solo para leer no sabe decir si hay que actualizar la app o si editar con
  un link está apagado (haría falta que `plink_open` lo cuente).
  **Diseño en `Doc_Link_Publico.md`** (auditado: aprobado con condiciones, ya corregido; D29 a D31): el token
  del link validado por la base en cada pedido (sin cuentas ni cambios en el login; las sesiones anónimas de Supabase no
  andan con el registro cerrado), solo la página y lo de abajo, como un invitado (base limpia de D14, sin historial ni
  papelera), comentarios con nombre *(via link)*, *Reset link* instantáneo y topes por link, por día y de por vida.
  Depende del interruptor de la privacidad de lo borrado (B.18) prendido en Wanka. Entregas: 0 (prueba de los headers y
  de la caché de miniaturas en la base real, y `noindex`), 1 (*Can view*), 2 (*Can edit*, con topes por bytes y la
  cuarentena de filas malas; se vuelve a auditar ese diseño antes de programarla), 3 (medir y ajustar los topes).
  **Hecho (v0.147): la barrera de error alrededor de la página** (B3 del diseño de *Can edit*, requisito para prender
  el link que edita): una página que hace tirar al editor muestra un aviso con el historial a mano y el resto de la app
  sigue; la app entera, *Reload* en vez de blanco. Ver `Doc_Sincronizacion.md`, "Barreras de error". Las dos
  observaciones de su re-verificación quedaron **hechas (v0.155)**: la prueba con un reemplazo en curso para la
  pregunta al cerrar la pantalla de error (`replaceRunning`), y restaurar sin el editor ya no escribe los atributos por
  defecto en los bloques iguales a la versión (los saltea; la vista de diferencias comparaba los atributos guardados y los
  mostraba como «formato cambiado»).
  Las tres observaciones de la re-verificación de la 2b quedaron **hechas (v0.165)**: la prueba del link muerto con varios
  archivos, la del *Download it* de la insignia con el link vivo, y *Share* con «500 or more» cuando la lista llega al tope
  de la base (sin SQL). **Hecho en v0.171:** el total exacto de archivos de todos los links de la página, mediante
  `public_link_files.total` y la migración aplicada de schema 25; «o más» queda solo para una base anterior.
- **P.25 Sacar una foto o filmar desde la app** (Lega, 2026-10-01). **Hecho para la web (v0.110):** *Take photo* y
  *Record video* en el menú "/" y en el menú de la página, solo en teléfonos (D302, v0.172; el video, con portero):
  abren la cámara con el selector del sistema y lo sacado entra en el renglón y sube por la cola de siempre; *Save to
  camera roll* (*Guardar en Fotos*) en la barra de cada foto o video abre la hoja de compartir con el original. Ver
  `Doc_Fotos_En_Linea.md`, "Cámara". **Falta:** probarlo en un iPhone y un Android reales. **Para la app nativa**
  (Capacitor y la cuenta de Apple, ver "Cuando se termine esta app"): guardar en el carrete sin la hoja (y en un álbum
  propio), la cámara adentro de la app con varias tomas seguidas, y los metadatos de la toma.
- **P.23 Plantillas (fase 3) y crear el reporte del día** (Lega, 2026-10-02; era el ítem 10 del grupo C, ya sin esperar
  a Lega): *Pre-production Notes* (por escena), *On-Set Report* (por día) y *Shot Breakdown* (por plano) con lo que se
  anota en supervisión de VFX (primera versión, Lega la ajusta), guardar cualquier página como plantilla, y en el reporte
  en set un botón **New day report** que crea la página del día con fecha y locación ya puestas adentro de la carpeta de
  reportes, sin red. **Diseño en `Doc_Plantillas.md`** (sin código; decisiones propuestas PL1 a PL10): una plantilla
  propia es una página marcada en `settings` dentro de una carpeta *Templates* (sin tabla `templates` ni migración; los
  permisos son los de la página), crear es copiar los bloques antes del párrafo vacío sin borrar nada, y la carpeta de
  reportes es una página marcada (`dayReports`). Sin tipos ni propiedades nuevas en el editor. Auditado (aprobado con
  cambios) y corregido: atajo ⌘⌥⇧N / Ctrl+Alt+Shift+N (⌘⌥N es de Chrome en la Mac), marcas que se recuperan solas,
  plantillas a medio bajar, datos de set que faltaban y una sección *Internal* para lo que no debe ver un cliente.
  Entregas: 0 (las tres plantillas en el código y una vista para que Lega las revise), 1 (crear desde una de fábrica),
  2 (el reporte del día), 3 (plantillas propias). **Entregas 0 y 1 hechas** (v0.117): la vista previa
  (`/practice?template=on-set`), la tira de la página nueva, *More…* y *Apply template…*. **Entrega 2 hecha**
  (v0.121): *New day report* (botón, globito, menú ⋯ y Ctrl/⌘+Alt+Shift+N), la carpeta de reportes marcada o deducida,
  lo que se copia del día anterior, "ya existe" y el orden, sin red. **Entrega 3 hecha** (v0.124): plantillas propias
  (*Save as template…* con *Clear filled-in values*, la carpeta *Templates*, la franja con *Template settings…* y *Stop
  using as template*, *Customize*, las de otros proyectos sin sus fotos, *Wait* / *Use built-in* a medio bajar y el
  selector de plantilla del globito, con el aviso de O4). **D82 hecha** (v0.130): *On-Set Report* en la raíz del proyecto
  ofrece crear o elegir la carpeta de reportes y mueve ahí la página (ya no sale como plantilla común). **Hecho en v0.212,
  las dos sorpresas de su auditoría:** la ventana dice que las subpáginas se mueven con la página, y avisa si la carpeta
  elegida ya tiene el reporte de hoy (*already exists*, con *Open* y *Create another*; `Doc_Plantillas.md`, "Cómo quedó
  (restos de la raíz y del reporte del día)").
  **Las anotaciones de las fotos viajan con la plantilla (v0.136, D46 aplicado a las plantillas):** al usarla (también el
  reporte del día) y al guardar como plantilla, mismas reglas que copiar y pegar; *Clear filled-in values* las saca con las
  fotos; entre proyectos no viajan (`Doc_Plantillas.md`, "Cómo quedó (las anotaciones de las fotos)"). Falta a mano: usar
  una plantilla con fotos anotadas en la Mac y en el iPhone. **Hecho en v0.212:** en el reporte del día, si las anotaciones
  no entran por los topes, el aviso sale en pantalla, como al usar una plantilla. Quedó de su revisión: *Create another*
  desde la raíz numera el día como el siguiente (*Day 02*) y el globito propone el mismo día de rodaje (unificarlo es un
  cambio de comportamiento); si la plantilla tiene a la vez fotos quitadas y anotaciones que no entran, el segundo aviso
  pisa al primero; Enter mientras se lee la carpeta no da señal visible; el texto del aviso de anotaciones habla de una
  página que "ya tiene demasiadas" aunque sea recién creada. De su auditoría (BAJO): dos
  guardas dobles (si se saca una capa la otra filtra igual) no tienen una prueba por capa. **Falta** que Lega revise el contenido de las tres (PL1) y
  pruebe el atajo en Firefox y Safari de la Mac y con un teclado latinoamericano físico. Quedan para después la marca
  *2 reports for…* en la barra lateral con la papelera ofrecida para el repetido sin tocar (O6), y en *Buscar en el
  proyecto* la marca *Template* con *Replace all* que saltee las plantillas salvo *Include templates* (O9, va con la
  búsqueda). De la auditoría de la entrega 3 (ninguna pierde contenido): dos dispositivos sin red que guardan su primera
  plantilla crean dos carpetas *Templates* (O1); guardar un reporte con *Use for day reports* cambia la
  plantilla de la carpeta para todo el equipo (O3, decidido así: D94); un invitado con *Edit & create pages* guarda
  plantillas, como permite la base (O4). Quedó de la auditoría de
  la entrega 1: un aviso de ProseMirror en la consola al abrir la vista previa (sin efecto visible); *Exit* de la vista
  previa ya vuelve a la página donde se elegía (el inicio abre la última página abierta; fijado con una prueba en v0.212). De la
  auditoría de la entrega 2 (las demás observaciones, corregidas): un invitado con *Edit & create pages* crea reportes,
  porque la base mira el nivel y no el rol; si un cliente nunca tiene que crear páginas, es una decisión del modelo de
  permisos (`Plan_Workspaces.md`); y al reusar un reporte vacío hecho por la app se le cambia el número de día por el
  siguiente al último (no se pierde nada). **Hecho en v0.214:** la base fusiona las claves de `pages.settings`
  (`patch_page_settings`, migración `20261104120000_ajustes_fusionar.sql`): dos cambios de ajustes distintos hechos a la
  vez ya no se pisan (`Doc_Plantillas.md`, sección 8); con eso quedó hecha la O2 de la entrega 3 (*Template settings* en
  un dispositivo y un cambio de formato en otro a la vez pisaban la descripción). **Quedan de la fusión de ajustes**
  (ninguno pierde contenido de una página):
  - **Vale entre dispositivos con v0.214 o más.** Una pestaña con una versión anterior sigue subiendo el objeto de
    ajustes entero y puede pisar la clave que otro dispositivo cambió a la vez. Se cierra cuando `min_app_version` llega
    a v0.214.
  - **Después de restaurar una copia de seguridad** cada dispositivo vuelve a subir lo suyo
    (`PageTree.recoverAfterRestore`) con los ajustes de la página enteros: dos dispositivos que recuperan a la vez la
    misma página con ajustes distintos pueden pisarse una clave. Mejora: mandar solo las claves que difieren de las del
    servidor (con `settingsKeys`, como cualquier otro cambio).
  - **El tope de 2000 caracteres vale para el resultado de la fusión.** Dos claves grandes puestas desde dos dispositivos
    (una descripción larga de plantilla y otra) pueden entrar por separado y no juntas: el segundo cambio queda en la
    lista de rechazados, que muestra el texto crudo de la restricción de la base (`pages_settings_shape`; la lista se
    arma en `src/ui/SyncBadge.tsx` con `rejectionText`). Falta decirlo en palabras.
  - **Con una base sin la función** el dispositivo igual muestra los ajustes fusionados por clave, aunque el servidor
    reemplazó el objeto entero: se ve la clave del otro dispositivo hasta la bajada siguiente del árbol, que la corrige.
  - **En las pruebas**, el servidor en memoria fusiona con la misma función que el cliente (`mergeSettings`), así que un
    error en ella no se nota de ese lado (la fusión de verdad la prueba `supabase/tests/ajustes_fusionar_permisos.sql`), y
    no simula el rechazo `settings_invalid`.
- **P.20 Anotar sobre las fotos** (Lega, 2026-10-02): flechas, círculos, rectángulos, texto y lápiz encima de una
  foto de set sin tocar el original, cómodo para quien usa LGA FrameRev (mismas letras, colores y grosores).
  **Diseño en `Doc_Anotar_Fotos.md`** (sin código; auditado: aprobado con condiciones, ya corregido; decisiones AN1 a AN11
  propuestas): las anotaciones en un `Y.Map` del documento de la página, afuera del contenido, con una clave por forma
  (`<archivo>/<forma>`, como "colapsar para todos"), así una versión vieja no las borra y dos sin red no se pisan; las de
  una foto sacada se podan para que no lleguen a quien solo ve (D14); un SVG encima de la foto en la página, la celda, el carrete y el PDF; la copia con
  anotaciones se arma en el dispositivo al bajar; anota quien edita la página. Entregas: 0 (prueba técnica), 1 (ver),
  2 (anotar en la compu), 3 (dedo, y lápiz en el iPad), 4 (bajar, copiar y exportar a FrameRev), 5 (historial, copiar entre
  páginas, buscar), 6 opcional (dibujar en un comentario).
  **Entregas 0 y 1 hechas (v0.116):** el mapa `photoMarkup` y su lectura segura (`src/media/markup.ts`), las pruebas de
  versiones publicadas, base limpia, historial y carrera, y el dibujo encima de la foto en línea, la de una celda, la
  foto-bloque, el carrete (*Hide annotations*) y el PDF.
  **Entrega 2 hecha (v0.123):** el anotador en la compu (`src/ui/Annotator.tsx`): las nueve herramientas con las letras
  de FrameRev, Shift y Alt, colores y grosor contra 1920 px, estilo por herramienta, deshacer propio por foto, escribir
  al soltar, topes en bytes y la poda de AN11; *Annotate* en la barra de la foto y A en el carrete; el PDF con el
  grosor mínimo de su caja impresa (la observación O2). Falta: que `min_app_version` esté en 0.116 o más al publicarla
  (AN10); probar ⌘[ y ⌘] en Safari y Chrome de una Mac, y medir el dedo a 60
  y 120 Hz y las fotos HEIC de un iPhone real (entrega 0, no se pudo sin teléfono).
  **Entrega 3 hecha (v0.129):** el dedo y el lápiz: la tira de herramientas abajo, la hoja de propiedades desde el punto de
  color, un dedo dibuja y dos amplían sin dibujar, el lápiz del iPad dibuja y el dedo mueve (*Only the pencil draws*), la
  palma no dibuja, el texto en una caja común con el teclado, tocar un tirador sin moverlo ya no cambia la forma. Falta
  a mano en un iPhone y un iPad reales: el teclado con el toque, el gesto de "atrás" desde el borde y el doble toque
  contra el dibujo, el Apple Pencil con la palma. De su auditoría quedan: O3 hecho en v0.195: un `pointercancel` del sistema conserva sólo dibujo nuevo desarrollado hasta su último movimiento aceptado, con Deshacer; Escape descarta el borrador sin cerrar. No conserva toques, movimientos de formas ni el primer dedo de un pellizco; pruebas físicas de interrupción siguen pendientes; **Tira corregida (v0.193):** al abrir, elegir una herramienta o cambiar el ancho, la tira muestra la elegida moviéndose sólo en horizontal, sin foco ni cambios en las formas. Primera parte de la entrega 4 en v0.178: Download → With annotations de una foto JPEG/PNG desde el carrete de una sesión normal, a resolución completa o error con Original disponible, sin reducción automática; offline con original completo. HEIC real, otros formatos y 48 MP móvil siguen pendientes; también carpetas y FrameRev. En v0.182 el mismo Download de la barra ofrece descarga/copia anotadas de una foto elegida de bloque, fila, renglón o celda en páginas editables del workspace, con identidad/contexto vigentes y Original disponible; no habilita links públicos ni cierra E4. E4b en v0.180 copia una JPEG/PNG anotada desde el carrete como PNG completo, con preparación y segundo gesto, invalidación previa y portapapeles compatible; no cierra E4. E4c parcial en v0.185 admite WebP estático simple VP8/VP8L, incluido alfa, como PNG completo explícito desde Carrete y barras; rechaza WebP extendido, metadatos y animación sin elegir un frame. HEIC real, otros formatos, carpetas y FrameRev continúan pendientes. Safari físico sigue pendiente.
  **Copiar y pegar con las anotaciones hecho (v0.132, D46, parte de la entrega 5):** copiar o cortar una foto anotada y
  pegarla en otra página del mismo proyecto le lleva sus formas (mismas claves, sin duplicar, un solo ⌘Z saca la foto y
  sus flechas); a otro proyecto o workspace no viajan, y al portapapeles no va nada nuevo
  (`src/media/markupClipboard.ts`, `src/ui/markupClipboardEditor.ts`). Falta a mano: ⌘C y ⌘V de verdad en Safari de la
  Mac y en el iPhone. **Con plantillas (v0.136):** las anotaciones también viajan al usar una plantilla del mismo proyecto y al
  guardar como plantilla (*Clear filled-in values* las saca con las fotos). **Keep annotations? (v0.186, AN2/E5 parcial):** reemplazar una foto anotada de bloque, fila, renglón o celda ofrece Sí para copiar el mapa completo con proporción orientada exacta, No sin copiar y Cancelar sin cambiar la foto. Archivo y mapa originales se conservan; referencia y copia comparten un paso de deshacer, con la última intención por aparición. **Buscar sus textos (v0.187, E5 parcial):** Ctrl/⌘+K encuentra anotaciones textuales válidas de fotos presentes y abre la misma foto en el Carrete, también en renglones/celdas, sin red y para quien solo ve. No modifica las anotaciones ni Reemplazar. **Comparar dibujos históricos (E5 parcial):** Show changes muestra dibujos soportados en Before y Selected version, sin cargar originales, sin autor por forma y con aviso para datos parciales; una entrada apartada no se compara. **Restore y Recover drawing (v0.207, E5 parcial):** restauran campos de líneas soportadas con el mismo padre y marco. Recover drawing completa sólo los campos faltantes de una línea retirada con historia inequívoca y conserva todos los valores posteriores; una nueva edición invalida la oferta, se confirma el guardado local antes del aviso y se deshace en un paso. Quedan otros tipos de forma, padres eliminados y las comprobaciones físicas de búsqueda y reemplazo en Safari/iPhone; no completa E5.
  De la auditoría de la entrega 2 (`Doc_Anotar_Fotos.md`, "Correcciones de la auditoría de la entrega 2"): las dos
  guardas de `PageEditor` tienen prueba con el editor real desde v0.211 (con solo ver no ofrece *Annotate* ni escribe
  con las teclas; la poda espera red y que no haya nada sin subir ni sin bajar; ver "Guardas del editor comprobadas"
  en ese doc). Siguen pendientes: un marco ilegible lo pisa la primera forma
  (revisar el día que cambie `v`); una forma con grosor 0 y sin relleno no se ve pero se puede elegir (sirve para
  borrarla; decidir); un workspace sin la migración del equipo no conoce los permisos y nunca poda.
- **P.22 Exportar una página o un proyecto entero** (Lega, 2026-10-02): PDF y/o zip con las páginas y las fotos, para
  entregarle al cliente o archivar un proyecto terminado. **Diseño en `Doc_Exportar.md`** (sin código; EX1 a EX15 a
  confirmar por Lega; auditado con condiciones y corregido: ningún correo en el zip, vista JPEG de cada foto): un PDF para entregar (toda la rama en orden con un índice que dice la hoja de
  cada página, cada página con su hoja y sus cortes de la fase 4, sin comentarios por defecto) y un zip para archivar
  (una carpeta por página con `.html`, `.md`, los originales del Drive, los comentarios y los bloques en JSON para
  volver; el zip de *Download all*). Lo exporta quien ve, solo su rama; nunca lo borrado (se exportan bloques, nunca el
  documento Yjs) ni la papelera. Volver: *Import Shot Docs archive…*, siempre a un proyecto nuevo. Entregas: 0 (el editor
  de exportación medido), 1 (PDF), 2 (zip), 3 (volver, con la migración de `imported_from`), 4 (carpetas de Drive,
  reusar archivos, link público). **Entrega 0 hecha (v0.115):** el editor de exportación en `src/export/`
  (sin interfaz), medido con 300 páginas y 2219 fotos en Chromium: 14,5 a 38,9 s, nada guardado cambia y las hojas de
  las 300 iguales a las marcas de la pantalla. **Entrega 1 hecha (v0.122): el PDF de una rama o de un proyecto**
  (*Export…* en el menú de la página, *Export project…* en el selector): índice con la hoja de cada página y links
  internos, cada página con su hoja (Chrome y Edge de computadora; los demás, todo con la hoja de la raíz y avisado),
  fotos con sus anotaciones y achicadas a su ancho impreso en Workers, comentarios opcionales bajados antes y sin
  correos, topes de páginas y de píxeles (menos con menos de 8 GB). 300 páginas en ~30 s (Chromium sin ventana);
  resueltas O3 a O7 de la auditoría de la 0 y los tres bloqueantes y O1 a O7 de la auditoría de la 1. Falta a mano:
  Safari, Firefox, el iPhone, una compu de 8 GB y guardar de verdad en Chrome y Edge (`Doc_Exportar.md`, "Cómo quedó
  la entrega 1"). **Entrega 2 hecha (v0.129): el zip** (*Zip — to archive* en la misma ventana): una carpeta por página
  con `.html` sin JavaScript, `.md` con rutas relativas (D57), una vista JPEG de cada foto (también HEIC), los
  originales elegidos (del dispositivo o por el portero con lo de *Download all*), comentarios sin correos, el JSON para
  volver y `MISSING_FILES.txt`; los destinos de *Download all*, sin red y cancelar. Solo dueño y admins (D60), nunca
  desde un teléfono (D63). Probado con `file://` y sin red en Chromium y Firefox. Falta a mano: ERSO entero con el
  portero de verdad (tiempo y llamados al Durable Object), Safari de la Mac y las rutas largas de Windows
  (`Doc_Exportar.md`, "Cómo quedó la entrega 2"). **Entrega 1b hecha (v0.134): los cambios de Lega al PDF** (D84,
  D85, D88): las fotos con su original en resolución completa (*Smaller file* para achicarlas), el PDF en partes por
  páginas enteras cuando pasa un tope (500 MB de fotos por parte en una computadora; medido en Chromium con 300 páginas
  y 2219 fotos de teléfono) y la lista de las que fallaron con *Export again*. Falta a mano: guardar de verdad una parte
  de 500 MB con la vista previa de Chrome y Edge (también en 8 GB), originales reales de iPhone por el portero, Safari,
  Firefox y el iPhone (`Doc_Exportar.md`, "Cómo quedó la entrega 1b"). **Entrega 3 hecha (v0.141): volver a Shot Docs
  desde el zip** (*Import Shot Docs archive…* en el selector, dueño y admins, EX16): siempre a un proyecto nuevo, con el
  árbol, los ajustes, las marcas de plantilla, los bloques revisados contra el esquema, el colapsado, las anotaciones,
  los archivos (sin original, la vista de la foto o su nombre) y los comentarios (migración
  `20261026120000_comentarios_archivo.sql`, **aplicada**, verificada en la base el 2026-10-06; con la base vieja esperaban para *Resume*); sigue donde quedó
  sin duplicar; zips rotos y hostiles avisados sin crear nada. Falta: correr la prueba SQL de esa migración (ya aplicada) y a mano
  ERSO entero con el portero de verdad, Safari y el iPhone (`Doc_Exportar.md`, "Cómo quedó la entrega 3"). Sigue la 4.
  **Importación por generaciones (v0.211, parcial; también *Import from Coda…*; D304 y D305):** cada importación
  reserva en el dispositivo su identidad (generación, proyecto y la operación que lo crea) antes de crear el proyecto;
  reintentar o *Resume* usa los mismos ids y no crea otro proyecto; *Import into a new project*, o importar otra vez
  algo ya terminado, abre otra generación sin tocar la anterior; cada página se escribe entera o no se escribe, y una
  ya escrita no se vuelve a escribir al seguir (el todo o nada vale solo ante fallos que se pueden reintentar: un
  archivo que falta, vacío, dañado o pasado del tope se anota y la página entra); un registro de una versión anterior
  no bloquea y queda archivado; cada
  comentario importado deja un recibo local que impide ponerlo otra vez en la cola; y lo que queda pendiente se dice
  con un texto en inglés o en castellano (`Doc_Importar_Coda.md`, "Si se corta: seguir donde quedó"). Probado con la
  base local simulada y los dos diálogos montados. **No cierra la importación.** Falta: el selector real de carpeta y
  de archivo e IndexedDB en un navegador real; el Drive y los permisos reales; el aborto de una transacción sobre la
  anotación de un archivo de Shot Docs (los abortos se probaron sobre la de Coda y sobre la creación del proyecto); y
  limpiar los registros archivados de versiones anteriores, que hoy quedan en el dispositivo sin que nada los borre.
  **Hecho en v0.213 (los pendientes a, b, e, f, i, j, k y l):** el id de cada página y de cada archivo se anota antes
  de crearlos, y crear dos veces con el mismo id es crear una (ya no queda una página vacía ni un archivo local de
  más, ni una página pendiente dos veces); una página que la carpeta de Coda ya no trae no impide terminar (D306); del
  registro de una misma fuente se conserva el detalle de las tres terminadas más recientes (D307); una carpeta sin id
  de doc se avisa al elegirla; el resumen dice "1 page"; el aviso de cierre nombra *Import into a new project*
  (probado que entra); y un error de lectura del disco en un zip vuelto a comprimir ya no se toma por archivo dañado.
  Pendientes conocidos de la importación: (c) un comentario importado cuyo recibo
  corresponde a otra página no tiene salida por *Resume*, solo por *Import into a new project*; (d) al crear el
  proyecto reservado se vuelve a leer el árbol entero, lo que podría cruzarse con una sincronización en curso (no se
  reprodujo); (g) un registro de esta
  versión que no se puede leer se avisa, pero no tiene salida desde la app; (h) la lectura y la escritura anteriores
  del registro (`get`, `put` y `remove` del diario) ya no las usa la app y siguen en el código con otra política que
  D304, porque varias pruebas dependen de ellas; (m) un corte entre encolar los comentarios de una página y marcarla
  terminada, más esa página mandada a la papelera: *Resume* crea otra página y sus comentarios se rechazan siempre
  (tienen el recibo de la página anterior); la salida hoy es *Import into a new project*, y el arreglo es rehacer los
  comentarios con identidad nueva al reemplazar una página pendiente (ya pasaba en la versión anterior); (n) un zip
  cuyo archivo cambió en el disco después de elegirlo deja la página esperando en cada *Resume* hasta volver a
  elegirlo; (o) el final de *Import from Coda…* muestra "Files keep uploading to Drive…" también con 0 archivos (el
  de archivo de Shot Docs lo oculta).
  **Aviso de conversión aclarado (v0.191):** una foto de más de 100 MP que hay que pasar a JPEG (girada, PNG, CMYK)
  conserva la reducción existente a su ancho impreso; la ventana cuenta aparte ese límite y los originales no disponibles,
  sin sumar dos veces la misma foto. No cambia los topes ni acredita memoria o impresión física.
  **Marcadores contados (v0.192):** la ventana cuenta aparte las vistas de archivos de la app que salen como marcador en el PDF,
  también sin red y sin miniaturas locales. No afirma que falte el original ni cambia las referencias o las descargas. Sigue pendiente: el tope de
  bajada del original ya vence por 30 s sin recibir bytes (v0.177), y puede durar más de 90 s si avanza; faltan pruebas de que la
  parte siguiente no vuelve a bajar los originales; si la pestaña se cuelga en la parte N, no se puede retomar desde ahí.
  Observaciones de la re-verificación de la entrega 1: (R1) el Imprimir del menú del navegador mientras se arma el PDF
  puede llevar la vista de la página en curso: sacar `print-output` a esa vista hasta `place()`; (R2) comprobación
  reforzada en v0.199: el achicador existente permite controlar ambos fallos del Worker;
  el recorrido real produce JPEG y distingue retirar la vuelta al hilo principal, sin cambiar `workerResizer`; (R3) con
  *Comments* tildada se hace un pedido por página, en fila: medirlo contra Supabase con 300 páginas y, si pesa, pedir de
  a varias.
- **P.21 Menciones en comentarios: *@persona*** (Lega, 2026-10-02): escribir `@` en un comentario, elegir a alguien y
  que le llegue un aviso en la app; por correo cuando haya clave de Resend (C.12). **Entrega 1 programada (v0.120;
  migración `20261015120000_menciones.sql` aplicada, verificada en la base el 2026-10-06):** el `@` con la lista, el pintado, la cola, la campana y el
  punto en el botón de comentarios; auditada y corregida. **Entrega 2 programada (v0.125; migración
  `20261016120000_menciones_e2.sql` aplicada, verificada en la base el 2026-10-06, `schema_version` 16):** compartir desde la mención (dueño y admins que
  pueden compartir la página, con Comentar y solo esa página), el punto en el árbol y el número en el título de la
  pestaña y en el ícono de la app. Falta la entrega 3 (correo), y un detalle cosmético (O6 de la
  auditoría): un comentario con mención cuenta como 2 cambios sin subir (alta y menciones). **Diseño en `Doc_Menciones.md`** (auditado y
  corregido; decisiones propuestas ME1 a ME10, ME10 espera a Lega): solo a quien ya
  ve la página; un miembro ve al equipo y a los clientes que ya comentaron (ME10); el dueño y los admins la comparten
  desde la mención (entrega 2); un invitado ve solo a quienes participan en los comentarios y a quien le compartió
  algo; va después del link público (`schema_version` 15); el texto sigue plano (`@lega`) y quién es va en `comment_mentions`, así una versión vieja no rompe
  nada; una campana con las no leídas que pregunta cada 60 segundos (sin Realtime); sin red con la cola de siempre;
  los visitantes del link no mencionan; las menciones de Coda se ven como `@Nombre`. Entregas: 1 (base, `@`, campana,
  sin red), 2 (compartir desde la mención, marcas en el árbol y en el ícono), 3 (correo, grupo C).
  De la auditoría de la entrega 2 (ninguna pierde datos ni da acceso de más), **resuelto en v0.131:** la prueba de
  compartir con `useShareGate` (O1, ya se puede prender D14), la lista del `@` tras Esc o *Cancel* (O2) y la pregunta
  que aclara que se comparte en el acto (O5). Se dejan, con su motivo: compartir desde la mención en un proyecto
  archivado, como con *Share* (O3), y que `share_for_mention` no mire la versión mínima, como `public.share` (O4).
- **P.24 Asistente con la clave de cada usuario y servidor MCP (fase 5)** (era C.11; 2026-10-02, ya sin esperar a
  Lega). **A1 implementada (v0.118):** ajustes con los cuatro proveedores y la clave en el dispositivo, el panel con *Fix*,
  *Improve*, *Shorter*, *Translate to…* y *Ask…* sobre lo elegido, vista previa por palabras, *Apply* con un deshacer y
  la guarda de "cambió mientras pensaba", permisos, sin red, atajo, ayuda, CSP y la migración de `assistant_policy`
  (aplicada, verificada en la base el 2026-10-06; `assistant_policy` en `on`). **A2 implementada (v0.126):** *Summarize page* (*Insert at top* / *Insert
  below*), *Translate page* (*Replace page content* en su lugar o *Create translated subpage*), *Format as…* (viñetas,
  casillas, tabla, títulos) y la política del workspace en *Assistant…* para dueño y admins, con su migración
  `20261017120000_asistente_politica_ventana.sql` (aplicada, verificada en la base el 2026-10-06). **La clave sincronizada, S1 implementada (v0.138,
  D72 → B, `Doc_Clave_Sincronizada.md`):** prender la copia cifrada con una frase, abrirla en otro dispositivo
  (preguntando si cambia el destino), *Update* / *Replace synced key…*, *Stop syncing* y *Sign out other devices*; su
  migración `20261023120000_clave_sincronizada.sql`, aplicada (verificada en la base el 2026-10-06). **S2 implementada (v0.143, sin migración):**
  *Change passphrase…*, *Keep the key on this device*, rechazar una copia más vieja, *Also sync in this workspace…*, el
  botón en el 401, la clave de *Voice* en el mismo sobre y las notas de voz en la ventana de salir. Falta medir en el
  iPhone y el gestor de contraseñas real (recorrido de Lega). Quedó de la auditoría de S2 (improbable): *Change
  passphrase…* no rechaza una copia más vieja repuesta con la misma generación que el dispositivo conoce; al recifrarla le
  da un `savedAt` nuevo y los otros dispositivos la aceptarían (es una clave vieja de la persona, no filtra nada). La prueba de `clearVoiceFromCopy` ya está (v0.150, con la entrega V4 del dictado: el mutante que no la llama muere). Esc en *Assistant…* (y en *Voice*) cierra solo esa ventana, no el panel ni la hoja de abajo (v0.150). **A3 implementada (v0.146):** *Suggest caption* en la barra de la foto y en el panel, con el aviso
  antes de mandarla, la foto rearmada en el dispositivo a 1024 px sin EXIF, la vista previa que se retoca y el pie como
  texto debajo de la foto (en una celda, en la misma celda); ver "Cómo quedó A3". Quedó de A3 (chico): el texto
  alternativo no se hace (la app no tiene dónde guardarlo); una foto que no es del Drive (`https` de afuera) puede no
  bajarse por CORS (lo dice); con varias fotos elegidas no se ofrece. **M0 hecha en lo que no necesita infraestructura real
  (v0.145):** el MCP en el portero detrás de `MCP_M0` (apagado), el token de un asistente rechazado en las demás rutas,
  la especificación 2026-07-28 (la *elicitation* sin estado, por MRTR), el servidor OAuth de Supabase (no respeta
  `resource`; fallas abiertas `#2820` y `#2703` que pegan en los clientes MCP), la API de Auth (con la configuración de
  hoy, el token de un tercero podría ponerle una contraseña a la cuenta en las primeras 24 horas de su sesión, aunque
  con ella no ve nada en la base: se cierra conectando el hook que ya rechaza el ingreso con contraseña), el plan B probado
  en SQL de solo lectura y la CPU con páginas reales (en el plan gratis entran listar, buscar y leer páginas de hasta
  ~16 KB). Faltan los ocho pasos con Supabase y Cloudflare reales ("Cómo quedó M0"), después M1 a M3. **Lo de código de los
pasos 1 a 5 quedó listo (tanda del 2026-10-03, "Pasos reales"):** el hook probado en rollback con eventos de la forma real (12 de
12; el `PATCH` y su vuelta, en el paso 1); la migración del plan B `20261027120000_mcp_plan_b.sql` (sin
aplicar); la pantalla de permiso `/oauth/consent/<ref>`; `MCP_M0` en el jsonc del portero. El paso 1 está prendido
desde el 2026-10-03; falta prender el 2 (con su control de `pg_stat_statements` antes del 5), 3 a 5 y los pasos 6 a 8.
Para M1 (de la auditoría de los pasos reales, O6): las `mcp_*` devuelven `json` o escalares, nunca filas de una tabla
(PostgREST deja embeber tablas relacionadas desde una función que devuelve un tipo de tabla, y el pre-request la dejaría
pasar). Quedó de esa auditoría (chico): una prueba unitaria de `Login` con `consent` que mire que no ofrece *Change*
(hoy lo cubre solo el recorrido en Chromium, O7); un 500 de Supabase en la pantalla de permiso se muestra como *No
connection* (supabase-js lo convierte en `AuthRetryableFetchError`; el detalle dice 500 y hay *Try again*, O8); el
camino rápido del pre-request busca la clave escrita tal cual (`client_id` no lo dispara; no es alcanzable porque
Supabase Auth y PostgREST la escriben literal, y Storage igual lo frena, O9). Para M1
  (de la auditoría de M0): el título de la página y los títulos de `list_pages` y `search_titles` van adentro del
  contenido no confiable (hoy el título de `read_page` va afuera del envoltorio y las listas salen como JSON crudo), y
  la pantalla de permiso muestra el host del `redirect_uri` además del nombre del cliente. De la re-verificación de M0: la migración del plan B da `execute` sobre `private.mcp_pre_request` a `anon`, `authenticated` y `service_role` (hecho, con su prueba), y la vuelta atrás del paso 1 vacía por SQL las contraseñas que pueda haber puesto un tercero (o deja el hook conectado). Lo que Lega prueba con
  sus claves está en "Cómo quedó A1" y "Cómo quedó A2". Quedó de A2 (chico): la política no se actualiza en vivo en un
  panel ya abierto (se lee al abrirlo); *Format as…* no conserva los colores de un bloque al que le cambia el texto, y
  cuando junta varios bloques en menos (renglones a una tabla) los comentarios de los que sobran quedan sin bloque.
  Quedó de la auditoría de A1 (chico): la barra de formato de BlockNote se dibuja encima del panel
  cuando lo elegido queda debajo; una traducción a japonés o chino de cerca de 20 000 caracteres todavía puede
  llegar cortada (se avisa y no se aplica; afinar el tope por idioma o por modelo); un modelo que razona por un servicio
  compatible (OpenRouter) no lleva el margen de tokens, y en OpenAI y Gemini se podría además bajar cuánto piensan
  (`reasoning.effort`, `thinkingConfig`) cuando se pruebe con claves reales qué acepta cada modelo; si el modelo saca
  las barras de un `\+` o un `\*`, el `++` se lee como subrayado (se ve en la vista previa). **Diseño en `Doc_Asistente.md`** (decisiones propuestas IA1 a IA10; auditado, corregido): la clave
  solo en el dispositivo y por persona (IA1, D-06; el cifrado solo evita verla por accidente); el pedido directo del navegador al proveedor (Anthropic, OpenAI, Google
  y compatibles con OpenAI, CORS probado); vista previa y aplicar como una edición que se deshace, sin aplicar si el
  texto cambió mientras el modelo pensaba; aplicar pide Editar; un interruptor del dueño (*On*, *Local models only*,
  *Off*). El MCP en el portero (IA2, D-07), con el OAuth del Supabase del workspace, el token cerrado de fábrica,
  lectura de la base limpia de D14 y escritura opcional por proyecto con guarda, nunca en páginas con invitados sin un
  permiso aparte; con páginas reales pide, casi seguro, el plan pago de Workers del dueño (US$ 5 por mes) o el MCP local. Entregas: A1 (texto elegido), A2
  (página, formato, política), A3 (pie de foto), M0 (prueba técnica del MCP: OAuth de Supabase con el registro cerrado,
  el rol del token, 10 ms de CPU), M1 (MCP de lectura; requiere el interruptor de D14), M2 (MCP que escribe), M3
  (medir). Recortar, achicar y comprimir fotos no necesitan un modelo: van al roadmap de fotos. **La clave en todos tus
  dispositivos (D72 → B, Lega 2026-10-02): diseño en `Doc_Clave_Sincronizada.md`** (sin código; auditado y corregido;
  decisiones CS1 a CS9): una copia cifrada en el dispositivo con una frase de seis palabras que propone la app (PBKDF2-SHA256 de
  1 000 000 de vueltas y AES-256-GCM, medidos), guardada en una tabla propia del Supabase del workspace donde la persona
  la prende, que solo ella lee; el dueño ve que existe, no qué es. Entregas S1 (prender, desbloquear, dejar de
  sincronizar, *Sign out other devices*, preguntar si cambia a dónde va la clave; riesgo alto, con auditoría) y S2
  (cambiar la frase, aviso entre dispositivos, copia más vieja, computadora prestada). **D77 (Lega):** el MCP también
  mueve y manda a la papelera, siempre con la confirmación de la persona y una casilla al conectar (dos pasos, la
  pregunta directa del cliente si la tiene, *Undo* a un clic; `Doc_Asistente.md` 9.3 bis, IA11), y nunca cambia quién
  ve algo; compartir e invitar, nunca. Va en M2. Al roadmap, sin diseño: que una sesión robada no pueda seguir una hora
  con su token de acceso (acortar su vida en Supabase cuesta más pedidos de refresco; para decidir con M0).
- **P.26 ⌘Z en el orden en que editaste** (Lega, 2026-10-02, al responder cómo se deshace un reemplazo en todo el
  proyecto): ⌘Z deshace lo último que hiciste aunque haya sido en otra página, y un *Replace all in project* se deshace
  entero en ese orden. **Diseño en `Doc_Deshacer.md`** (sin código; auditado y corregido; decisiones propuestas DH1 a
  DH10): una línea de tiempo por proyecto y por pestaña
  arriba de las pilas de Yjs de cada página, que sobreviven al cambiar de página (el documento retenido y la pila pasada
  al editor nuevo, sin parchear y-prosemirror); ⌘Z en otra página te lleva y lo deshace a la vista; el reemplazo entra
  en la pila de Yjs de las páginas editadas en la sesión (arregla un resto que deja hoy deshacer el reemplazo y después
  lo escrito antes, también desde el *Undo* del panel) y por las anclas en las demás; ⌘⇧Z rehace todo, también el
  reemplazo. Dura lo que la pestaña; nada cambia en lo guardado. Entregas: 0 (hecha, v0.132: B.21), 1 (**hecha,
  v0.140**: la línea de tiempo con las páginas; la memoria medida en Chromium con el editor real, unos 19 MB con 20
  páginas de 115 KB retenidas; falta medirla en el iPhone; `Doc_Deshacer.md`, sección 17), 2 (**hecha, v0.144**: el
  reemplazo adentro, ⌘Z y ⌘⇧Z en todas sus páginas, `planRedo`, el *Undo* del panel fuera de orden, C1, y DH9; con las
  pruebas de A5, A7 y A9 de la entrega 1; sección 18), 3 (**hecha, v0.152**: lo de una vez en el anotador es un paso de
  la página, ⌘Z lo deshace entero con la foto a la vista y ⌘⇧Z lo rehace, sin llevarse lo de otra persona; con *Show* en
  el aviso de ⌘Z de un reemplazo con páginas cambiadas, el foco que sigue en el panel después del *Undo* de "Last" y la
  prueba de la ventana de O4; con sus correcciones: deshacer nunca borra el marco de una foto, la foto lejana a la vista
  y rehacer un pegado con anotaciones después de ir y volver; sección 19). **O1 corregida (v0.175, sección 22):** la página
  con historia en la papelera durante el ⌘Z de un reemplazo conserva su paso; restaurada, deshacer el reemplazo y luego
  lo escrito deja el texto exacto, y se puede rehacer todo. Pendientes chicos: con el panel abierto y el foco puesto por programa en el editor,
  Ctrl+Shift+Z deshace (no se llega con el mouse ni el teclado: el panel es modal); y la copia propia de lo ajeno que se
  va con un renglón deshecho (17.2, de Yjs, 1 en 300). Botones de deshacer en el teléfono y el árbol (mover, crear, papelera) quedan afuera (DH1, DH8).
- **P.27 Dictado por voz y notas informales que se ubican en el reporte** (Lega, 2026-10-02): dictar en toda la app,
  sobre todo en el teléfono, y que la IA pase «este plano se filmó con un 50 mm, anotalo donde corresponda» a la celda
  *Lens* de la fila de ese plano en el *On-Set Report*. **V1 hecha (v0.135, `Doc_Dictado.md` sección 15):** *Dictate to
  report* con texto (escrito o dictado con el teclado del sistema), el mapa, el validador, la vista previa por cambio con
  casillas, *Apply* con la guarda y *Undo*, `ask` con botones, *Couldn't place* guardado en el dispositivo, permisos y
  política; falta que Lega mida la calidad con su clave (10.3) y pruebe el dictado del teclado en el editor del teléfono.
  **V2 hecha (v0.139, sección 16):** la cola sin red (*Save for later*, *N voice notes to place* en el indicador con la
  lista, ubicar de a una, *Insert as text*, *Discard* con confirmación); falta el número de notas en la ventana de salir
  de la cuenta (después de S1). **V3 hecha (v0.139, sección 17):** el micrófono propio (pedazos de 1 s guardados, C4 y
  C5, OpenAI, Gemini o compatible con pistas, *Voice* con la segunda clave, *Insert at cursor*, *Ask…*); falta que Lega
  lo pruebe en su iPhone (instalada y en Safari) con OpenAI y con Gemini, y que la segunda clave siga a la clave
  sincronizada (hecho en S2, v0.143, junto con O5: olvidar la clave olvida también la de voz y la ventana de salir
  cuenta las notas). El reconocimiento del navegador quedó afuera (optativo y apagado). **V4 hecha (v0.150, sección
  18):** el plano activo (*Shot: 12_010 ▾*, fijo entre notas), las correcciones encadenadas («no, era un 35» con la
  dirección de ahora), el lente también en la página *Shot Breakdown* del plano (destildado, solo si está vacía o era
  la copia del reporte, con su guarda y *Undo*), *Add as comment* para quien comenta y `/dictate#<texto>` para un Atajo
  de iOS; falta que Lega pruebe el Atajo con el botón de acción en su iPhone (¿abre la app instalada o Safari?).
  **Diseño en `Doc_Dictado.md`** (decisiones propuestas DI1 a DI9): el dictado común queda en el teclado del sistema;
  un solo micrófono propio, *Dictate to report*, que graba
  en el dispositivo y transcribe con el proveedor de la persona (OpenAI o Gemini; el reconocimiento del navegador no
  existe en la app instalada del iPhone); la página va como un mapa con direcciones y vuelve una lista de cambios
  validada, con vista previa, *Apply* con la guarda y un deshacer; «este plano» por lo dicho, el cursor o el plano
  activo, y si no, pregunta; sin red, una cola de notas que nunca se borra sola; sin tipos de bloque nuevos. Entregas:
  V1 (texto dictado con el teclado → ubicar; requiere A2 de P.24 en `main`), V2 (la cola sin red), V3 (el micrófono
  propio, guantes y ruido), V4 (plano activo, correcciones, la página del plano, el botón de acción del iPhone).
  Queda para medir: transcripción adentro del teléfono (Whisper en WebAssembly), sin red y privada.
  El resguardo de 600 ms contra el doble toque en *Apply* vale solo para un clic o un toque (v0.150). Queda de V4
  (chico): copiar a la página del plano solo el lente (otras columnas con su fila en la ficha se suman en `FIELDS` de
  `shotPage.ts`); lo escrito en la página del plano no entra en el ⌘Z de esa página (se deshace con *Undo* de la hoja,
  como el reemplazo del proyecto antes de D10).
- **P.30 Links a los archivos en el PDF y *Request access*** (Lega, 2026-10-03; `Doc_Links_PDF.md`). **Hecho (v0.164):
  la entrega 1.** Cada adjunto, carpeta y video del PDF (exportar o imprimir) lleva un link a su dirección fija
  (`/f/<clave local>/<id>`, con la dirección del Supabase después del `#`), que abre el archivo con sesión y permiso,
  pide entrar sin sesión y vuelve, y sin permiso muestra una sola pantalla sin nada del archivo. *Export* puede usar el
  link público de la página (aviso con página y nivel, *Can edit* destildado); imprimir, nunca. **Hecho (v0.166):
  la entrega 2**, *Request access*: la pantalla sin acceso lo pide (con el aviso de quién lo verá), la campana y *Share*
  muestran los pedidos a quien puede compartir y la ventana da acceso (nunca baja) o rechaza; la pantalla `/f/` vuelve a
  donde estaba y reintenta sola al volver la red; pruebas de `http://localhost` y de *Sign in instead* (O4). Migración
  `20261031120000_access_requests` aplicada (schema 22). Falta la prueba de aceptación 4 de Lega. **Hecho (v0.169):
  la entrega 3**, pedir también una página desde `/p/<id>` sin acceso (la misma pantalla para «no existe» y «sin
  acceso»), con los pedidos en la campana y en *Share* de esa página y el permiso solo sobre ella; migración
  `20261102120000_access_requests_paginas` aplicada (schema 24). **Hecho (v0.173): los restos
  de las auditorías de E2 y E3** (`Doc_Links_PDF.md`, sección 19): con más de un workspace en el dispositivo, la pantalla
  sin acceso de `/p/<id>` no ofrece *Request access* (iría a la base del abierto) y dice que se cambie al workspace del
  link (O1, LF21; la dirección no cambia); quien no ve ningún proyecto y abre `/p/` o `/f/` ve la pantalla sin acceso con
  *Request access* en vez de *No projects yet* (O2); el panel de la campana se titula *Access requests and mentions*
  cuando tiene pedidos; el servidor en memoria con el tope de 20 por día, la hora, las 24 horas y los 30 días de la base
  (O9), y el borde de 30 días (30 días y 1 hora) en las dos pruebas SQL, **verificadas contra la base en rollback**:
  dos positivos y dos negativos con el corte cambiado a 31 días, detectados por la aserción de 30 días y 1 hora;
  los dos positivos volvieron a pasar después. La auditoría además acreditó diez mutantes locales por aserción concreta;
  los 21 históricos no se validaron de ese modo ni se cuentan como evidencia independiente. Queda (chico): que la
  dirección de una página lleve el workspace (`/p/<id>?w=<clave local>`,
  LF21 A): v0.206 cubre sólo editor y arranque, y v0.216 lo copiado o cortado para pegar afuera; faltan los demás productores y transportes; `page_level` que tarda distinto si la página existe (la diferencia ya
  aceptada en LF4); y una prueba de dos personas decidiendo a la vez con dos sesiones reales (O8 de E2; hoy por lectura
  del `for update`: el servidor en memoria no la puede probar). Quedan para después: el correo al pedir y al aceptar
  (B.8), pedir acceso sin cuenta y los textos de invitación en el choque de clave y en
  *Join a workspace?* para una dirección de archivo (O7 c). **Hecho (v0.165):** *Export* avisa sin red (O6, *No connection: file links … can't use the public link*; un visitante del link no lo ve, con prueba). **Hecho (v0.171, D279 B):** *Share* dice el total exacto de los archivos de los links de la página aunque pasen de 500 (columna `total` de `public_link_files`, migración `20261103120000_purgados_peso_link_total.sql`, schema 25, aplicada; `Doc_Link_Publico.md`, "El total exacto"). **Hecho (v0.174):** el aviso de links sale solo con adjuntos, videos o carpetas; el de fotos solo si falta su original. La ventana cuenta desde el dispositivo sin pedir metadatos a la red, con pruebas. **Hecho (v0.198):** el cuadro de un video en línea, también dentro de una celda, lleva su enlace sin nombre ni renglón añadido; conserva geometría y permisos existentes. El resto de P.30 sigue pendiente.
- **P.28 Hecho (v0.156): la tabla del reporte en el teléfono** (`Doc_Tabla_Telefono.md`): en pantalla angosta ninguna
  columna con ancho guardado baja de 96 px y la tabla se desplaza de costado dentro de su bloque; la celda donde se
  escribe se acomoda a la vista. La compu y el PDF no cambian. Falta probarlo en un iPhone real (dedo, teclado abierto).
  **Hecho (v0.160):** el piso de las columnas y el desplazamiento valen hasta 1024 px (no 760) solo para las tablas, así
  que en un iPad vertical (768 a 834 px, con el cajón a la vista) el reporte ya no se encoge (columnas de 96 en lugar de
  47 a 57) y se desplaza, salvo en una página con formato de hoja (A4, A3, Carta) entre 761 y 1024 px, que queda como el
  PDF (decisión de Lega, ronda 1); también se arregló el botón de comentar del margen, que salía 4 px de la pantalla.
  **Hecho (v0.165):** el botón de comentar mide el margen de la página en el teléfono (20 px, pegado al borde) y ya no
  tapa el final de un renglón largo (medido a 375 y 390 px: sin superposición); el área del dedo sigue de 44 px de alto.
  **Hecho (restos de la tanda 17):** el contador de comentarios (globo y número) también entra en el margen en el teléfono:
  pastilla de 20 px con el globo arriba y el número abajo, sin superposición con el texto a 360, 375, 390 y 414 px con 1, 12 y
  120 comentarios (antes 19,8 a 35,2 px encima); la compu y el PDF no cambian (`Doc_Tabla_Telefono.md`).
  **Hecho (v0.174):** la superposición se mide de verdad: una prueba de la suite calcula el diseño desde los valores del CSS
  (`commentMarginLayout.test.ts`) y `scripts/medir-telefono.mjs` la mide en Chromium de 360 a 414 px con 1, 12 y 120 comentarios.
  Queda (chico, de la auditoría): el botón mide 20 px de ancho (menos que los 44 px de las guías táctiles; confirmarlo
  con el dedo en un iPhone real).
  Quedan (chicos): lo que headless no prueba (el impulso del dedo, el teclado abierto, un editor remoto moviendo la selección
  mientras se escribe en una tabla).
- **Hecho (v0.201): escala H1–H5 y contraste normal:** encabezados progresivos, H5/H6 como texto normal bold; H6 existente se conserva y sale solo de los menús. Normal conserva el antiguo cuerpo de More; More aumenta la jerarquía con negrita próxima al encabezado y cuerpo legible, también en Script y PDF (Doc_Contraste.md).
- **P.29 Hecho (v0.161): contraste del texto y el panel de la cuenta** (Lega, 2026-10-03; `Doc_Contraste.md`): *Normal contrast*
  (de fábrica), *More contrast* y *No contrast* para el texto con el color por defecto, en la página, el historial y el
  PDF (en claro); el panel de la cuenta con íconos, su propio desplazamiento y *Sign out other devices* alineado a la
  izquierda. Queda: verlo en un iPhone real (el panel con el teclado del sistema y la barra de Safari).
  **Hecho (v0.165):** el zip de exportar lleva el contraste que eligió quien exporta (como el PDF), y en oscuro los
  resaltados gris (2,32:1), amarillo (2,60:1) y naranja (3,69:1) pasaron a 4,74, 4,73 y 4,75:1 con el texto por defecto,
  sin tocar el claro ni el PDF (`Doc_Contraste.md`, sección 5).
- **P.8 Hecho (v0.220, primera entrega, sin migración): ordenar la media por tamaño.** *Files by size*, al pie
  del selector de proyectos (si algún proyecto muestra un peso): las fotos, los videos, las carpetas y los
  archivos de un proyecto que ocupan lugar en el Drive, del más pesado al más liviano, con el link a las páginas
  que usan cada uno y marcado el que no usa ninguna; arriba se elige el proyecto, el más pesado primero. La ve quien ve el peso del proyecto y lista lo que la base le deja leer
  (D312, D313); de a 100, con *Show more*, siguiendo por clave (peso, id) y no por desplazamiento; solo con red. Ver
  `Doc_Peso_Proyectos.md`, "Cómo quedó: la lista por peso". **De paso (v0.220):** el panel de la papelera ya no se
  desborda de costado con un nombre largo (en Papelera › Archivos, publicada, el botón *Send to Drive trash*
  quedaba fuera de la vista), y mandar un archivo a la papelera de Drive vuelve a pedir el peso de los proyectos.
  **Falta (siguiente paso):** borrar o reemplazar desde la lista (hoy se abre la página y se hace ahí); dejar
  elegido el bloque al abrir la página; un acceso desde el diálogo de Google Drive; ordenar por peso la papelera
  de archivos; el recorrido en la app real con sesión y en un iPhone (también el paginado por clave en un pedido real:
  la auditoría recorrió el SQL equivalente contra la base real sin repetir ni saltear); y, si el primer tramo tarda
  (medido: 454 a 734 ms con 2297 archivos; los siguientes, 21 a 78 ms; el tope de 8 s vencería cerca
  de los 25.000 a 40.000 archivos por proyecto), pasar la lectura a una función con una sola puerta por proyecto
  (con su migración). **Anotado al auditarla:**
  - El admin con solo *Ver* se entera de lo que le falta recién al final de la lista (22 *Show more* con 2204
    archivos), y la nota de arriba le indica algo que no puede hacer. Decirlo arriba, y otra nota para quien no
    manda archivos a la papelera de Drive.
  - El motivo de un error de la base sale crudo, en inglés, adentro del texto en castellano ("No se pudo leer la
    lista de archivos (canceling statement due to statement timeout)"). Lo mismo en la papelera de archivos.
  - `.menu .project-actions` reserva 30 px por cada ícono aunque no se vea y le corta el subtítulo al dueño:
    medido, con tres íconos al subtítulo del proyecto abierto le quedan 118 px de los 184 que necesita ("11
    páginas · 4,6 GB · editado hoy"); con cinco, 60 px menos. Que los íconos no ocupen lugar hasta mostrarse, o
    que el peso vaya primero.
  - Servir la app desde un worktree (`node_modules` enlazado al clon principal) da 403 en las fuentes: solo en
    desarrollo, se arregla con `server.fs.allow` en la configuración de Vite del que la sirve.

### B. Sin decisiones pendientes

2. **Hecho: subir solo lo propio después de bajar.** Lo bajado avanza `syncedSV` en la misma transacción
   que lo guarda, solo con lo que el servidor mandó (tramos sin huecos desde lo ya confirmado) y sin pasar
   de lo que el documento del dispositivo integró; lo propio sin confirmar nunca entra. Las pruebas
   (`src/sync/docs.test.ts`) revisan en cada paso que el vector no diga más de lo que tiene el servidor:
   ediciones sin subir mezcladas con lo bajado, updates que dependen de algo que falta, lo propio que
   vuelve del servidor, una subida en vuelo, cerrar la app a la mitad, restaurar una copia y corridas al
   azar. Ver `Doc_Sincronizacion.md`, "Contenido de las páginas", punto 4.
3. **Hecho: abrir una página vacía ya no crea un cambio.** La semilla queda en memoria y se guarda (y
   sube) junto con la primera edición, en la misma transacción; la semilla no cambió, así que dos
   dispositivos que empiezan la misma página siguen compartiendo la raíz. Ver `Doc_Sincronizacion.md`,
   "Contenido de las páginas", punto 5.
4. **Hecho: tamaño de la app.** El editor (BlockNote con ProseMirror, Tiptap y Mantine), el carrete, el
   panel de comentarios, los diálogos de miembros, compartir y Drive (y la página de prueba de media, hasta
   que salió en v0.042) se bajan aparte (`src/ui/lazyPart.tsx`); la primera pantalla (login, barra lateral, árbol) sale sin
   esperarlos y el editor se baja apenas el navegador queda libre. Mientras baja, el cuerpo de la página
   muestra un esqueleto (el título ya se ve). Lo que se baja al abrir, comprimido: de 591 KB (JS 542 KB,
   CSS 48 KB, HTML 1 KB) a 276 KB (JS 227 KB, CSS 48 KB, HTML 1 KB); en v0.041, con los dos idiomas, 283 KB
   (JS 235 KB). Aparte: el editor 302 KB, el carrete
   5 KB, el panel de comentarios 4 KB, cada diálogo 2 KB (y los emojis del editor,
   110 KB, que ya se bajaban aparte). Los estilos del editor siguen en la primera carga para no cambiar el
   orden en que se aplican; las páginas de privacidad y condiciones también (son chicas y se ven sin
   sesión). El service worker precachea todo, así que sin red el editor abre igual; si después de publicar
   una versión nueva falta un archivo viejo, la app avisa y recarga una sola vez sin perder nada. Ver
   `Doc_Sincronizacion.md`, "Sin red al abrir".
5. **Hecho: el caso intermitente de la prueba de punta a punta** (`Doc_Investigacion_Intermitente.md`).
   La vista del editor nunca se atrasó. Los más de 40 s eran un dispositivo que abrió la página en solo
   lectura ("still downloading") y escribió sin que entrara, o una consulta que no respondía nunca y
   colgaba el ciclo. Y la investigación encontró una pérdida real: una recarga o un cierre a pocos
   milisegundos de la última tecla perdía el final de lo escrito. Arreglado en la app: cada edición se
   guarda en una transacción sin lecturas que se confirma en el acto, con una marca de "sin subir" en
   `meta` (la base no cambia de versión, y la "versión guardia" hace que una versión anterior que la abra
   vea pendiente todo lo que esta tuvo abierto); cada consulta a la base tiene un tope de tiempo (30 s
   más lo que tardaría a 16 KB/s, y una página que vence no frena a las demás); la barra de formato ya no se vuelve a montar (y cerrar su menú) con
   cada cambio del estado; y en solo lectura por "still downloading" se revisa cada segundo si llegó lo que
   faltaba. Ver `Doc_Sincronizacion.md`, "Contenido de las páginas" (puntos 1, 3 y 7) y "Ciclo de
   sincronización". Las correcciones de las pruebas de punta a punta (`e2e.mjs`, `features.mjs`) están en
   la investigación.
6. **Hecho: páginas de privacidad y de condiciones** (`/privacy`, `/terms`, en `src/ui/Legal.tsx`), en
   inglés y públicas: se ven sin sesión ni workspace, también sin red, con links en el login, la bienvenida
   y el menú de la cuenta. Son las que pide el punto 13: `https://shotdocs.lega.com.ar/privacy` y
   `https://shotdocs.lega.com.ar/terms`. Si cambia qué datos usa la app o dónde van, se cambia el texto y
   su fecha (`LEGAL_UPDATED`).
7. **Fase 4: hecho lo principal (cortes entre hojas y PDF).** En una página con tamaño de hoja, el editor
   marca dónde empieza cada hoja ("Page 2"…) con el alto real de la hoja menos los márgenes, sin partir un
   bloque que entra en una hoja (pasa entero a la siguiente) y partiendo entre renglones o filas lo que es
   más alto que una hoja; un título de sección pasa con el bloque que sigue. Es solo una capa: el documento
   no cambia. **Export PDF / Print** (menú de la página, o Ctrl/⌘+P) imprime con la impresión del navegador
   la misma hoja (`@page`) y los mismos cortes, sin barra lateral ni controles, con las fotos grandes si el
   original está en el dispositivo, las tarjetas de Drive como link y Script con sus colores; una página
   libre sale en A4. En el teléfono la página se ve libre y las marcas van antes de los mismos bloques. Ver
   `Doc_Hojas_PDF.md`. **Hecho también el salto de hoja** (v0.093): un párrafo con `pageBreak` (nunca un tipo de
   bloque nuevo), desde el menú "/" o con Ctrl/⌘+Enter; lo que sigue empieza hoja en las marcas y en el PDF.
   **Falta:** probar a mano en Safari y en el iPhone.
8. **Hecho: castellano e inglés (D-16).** Toda la interfaz en los dos idiomas: pantallas, menús, diálogos,
   avisos, tooltips, estados de sincronización, errores, el carrete, comentarios, papelera, miembros,
   compartir, workspaces, bienvenida y login. Los textos están en `src/i18n/` (cada clave con los dos
   idiomas juntos, `{valores}` y plurales; `useT()` en los componentes y `t()` en lo demás), y una prueba
   revisa que cada clave tenga los dos idiomas con los mismos valores y que no sobre ninguna. El idioma es
   una preferencia de la cuenta (`language`, en el menú de la cuenta junto al tema y la fuente); de fábrica,
   castellano si el navegador está en castellano. El editor usa el diccionario en castellano de BlockNote,
   pasado a vos. Los tipos de texto se llaman Script/Guion y Question/Pregunta en la interfaz; lo guardado en
   los documentos no cambia. Quedan en inglés, a propósito: las páginas legales (con una nota en
   castellano), la guía para crear un workspace y los mensajes que manda el portero. **Falta:** el correo con el código (su plantilla está en `supabase/`), la guía en
   castellano y las plantillas, que todavía no existen (fase 3), con su nombre en cada idioma.
9. **Compactar en el servidor** los updates de contenido (`page_snapshots`). Toca la regla de no perder
   datos: un snapshot nunca borra nada hasta estar confirmado, con pruebas antes. **Diseño en
   `Doc_Compactar.md`** (auditado): el snapshot se arma aplicando las filas en orden en un `Y.Doc`
   sin GC (conserva lo borrado, D16), lo arma y lo comprueba el dispositivo de quien edita (D5), la base lo sirve
   solo confirmado y válido, y `page_updates` no pierde nunca una fila (D4). **Entrega 1 hecha (v0.127): leer
   snapshots** (la migración `20261019120000_compactar_leer.sql`, aplicada y con los snapshots apagados;
   `pull_page_content`, la época de contenido y el reinicio de una página cuyo snapshot se invalidó). **Entrega 2 hecha
   (v0.133): crearlos** (`compact.ts`: el dispositivo de quien edita arma, comprueba por los dos caminos y unidad por
   unidad, cada 10 contra todo desde cero, sube, baja la vuelta y confirma; una página por ciclo), con lo de la
   auditoría de la entrega 1: el rearmado de D110 (O1: sin nada sin subir, la página se rearma con lo del servidor y el
   borrado de un snapshot malo no llega a nadie), la época del árbol que reinicia solo si es más nueva (O2) y
   `invalidate_page_snapshot` con `sees_deleted` (O3, migración `20261020120000_compactar_crear.sql`, aplicada en v0.133).
   De su auditoría, corregido antes de publicarla: el rearmado conserva los elementos sin sus borrados (O-A: tirarlos
   dejaba invisible lo escrito al lado de un elemento de un snapshot malo), lo mismo al restaurar una copia (O-B).
   **Entrega 3 hecha (v0.137): listos para prender, siguen apagados.** La marca del rearmado se guarda (R-1) y la
   espera olvida `syncedSV` una vez por época (R-2); la base manda la huella de cada snapshot y el dispositivo no aplica
   uno que no coincide: lo invalida, y quien compacta invalida una base corrupta (O-D); `pull_page_content` sin versión
   (v0.127 a v0.133) ya no sirve snapshots (migración `20261025120000_compactar_prender.sql`, aplicada, verificada en la base el 2026-10-06; Compactar sigue apagado: `snapshot_min_version` nulo); el script de
   restaurar empieza por anularlos (D142); armar devuelve el control cada 30 ms, medido con la CPU frenada ×4 y ×6
   (O-C). **Falta (Lega):** la prueba de punta a punta con sesión y la medición en el iPhone (pruebas 7 y 8 de
   `Doc_Compactar.md`); después, el SQL de prender que está en "Cómo quedó la entrega 3" (sube también
   `min_app_version`). Hoy no es urgente: ninguna página lo necesita.
   De su auditoría (BAJO): si una bajada se corta por más de 3 reinicios de época, igual corre el paso que sube lo que
   sobra del rearmado (`settleRebuild`); hace falta que la época cambie 4 veces en una sola bajada y no se pierde nada.

10. **Hecho lo principal: editar a la vez sin perder texto (v0.052).** Dos parches a y-prosemirror (el editor
   que se quedaba con lo de antes y deshacía cambios de otros; dos personas en el mismo párrafo vacío), la
   semilla con un texto vacío, la reparación de bloques con dos contenidos o dos grupos de hijos, y volver a
   dibujar el editor si igual falla. La prueba al azar por el camino de la app pasó de 26 de cada 100 corridas
   con pérdidas a 0 de 500. Ver `Doc_Colaboracion.md`. `min_app_version` subió a 0.052 al publicar.
   **`@blocknote/core/y` (y-prosemirror 2, Yjs 14): evaluado en v0.225, ver `Doc_Evaluacion_BlockNote_Y.md`; la
   decisión es de Lega (D330 y D331, pendientes).** Lo medido: no resuelve lo que se esperaba (escribir en un renglón
   mientras otro le cambia el tipo, lo sangra o lo junta pierde lo escrito igual que hoy, 300 de 300 agendas; moverlo,
   más que hoy), Yjs 14 trae los mismos tres errores del deshacer que arregla el parche del repo, sus librerías son
   todas versiones previas y pasar a ella obliga a convertir cada página guardada (las dos formas no conviven: el
   editor nuevo vacía una página de hoy). Recomendación: esperar a que Yjs 14 e y-prosemirror 2 salgan estables y
   volver a correr el banco, que quedó armado. **Falta (si Lega lo aprueba, D331):** mandar a Yjs los casos mínimos de
   B.21, B.22 y B.26.

11. **Subidas que se traban: lo que quedó de v0.068** (`Doc_Portero.md`, "Subidas que se traban"). La app
   corta los pedidos al portero que dejan de moverse (y, desde v0.070, los de la miniatura a Storage) y
   sigue con los demás archivos. **Hecho en v0.092:** a la segunda trabada seguida de archivos distintos sin
   avance, la vuelta deja de subir archivos y la cola espera antes de volver a probar (10 s, 20 s… hasta 10
   minutos; `Doc_Portero.md`, "Colgado para todos"), también con Storage colgado; la miniatura se sube con la
   señal de corte (ya no quedan subidas sueltas) y su tope crece con las fallas seguidas; `uploadFile` y
   `downloadFile` de `page-files` tienen tope y una que vence no frena a las demás; el portero recuerda el plazo
   de una respuesta lenta (un proxy que recibe el cuerpo de golpe); el vigilante descuenta a lo sumo dos huecos
   seguidos, no estira la espera por una suspensión mientras sale el cuerpo, y volver a mandar lo que una subida
   perdida ya tenía no cuenta como avance. Probado con relojes simulados y en Chromium contra un portero y un
   Storage locales que se cuelgan. **Falta:**
   - **Probarlo en Safari de iPhone y con una red lenta de verdad** (lo hace Lega). El aviso de bytes que salen
     (`XMLHttpRequest`) puede portarse distinto en Safari, con HTTP/2 y a través de Cloudflare; y que cortar la
     subida de una miniatura (la señal en el `fetch` del cliente de Supabase) la corte de verdad en Safari.
   - **Hecho (v0.142, rama `lega/carpetas-e3`):** las carpetas (P.9) cierran la vuelta como los archivos sueltos (una
     trabada no gasta intentos; a la segunda, la cola de la carpeta espera 10 s, 20 s… hasta 10 minutos); mientras la
     cola de archivos espera al portero, registra los archivos nuevos y sube sus miniaturas (si la espera no fue por
     Storage); la bajada de `page-files` se corta a los 30 s sin recibir nada (antes, 27 minutos con una imagen
     chica); y las pasadas de `PageFiles.pushPending` esperan después de cerrar por Storage colgado. Probado con
     relojes simulados y en Chromium contra un portero y un Storage locales que se cuelgan (`Doc_Portero.md`,
     "Colgado para todos"; `Doc_Sincronizacion.md`; `Doc_Carpetas.md`, "Cómo quedó (entrega 3)").
   - **Hecho (v0.149, rama `lega/carpetas-e4`; `Doc_Carpetas.md`, "Cómo quedó (entrega 4)"):**
     - **La última parte de un archivo grande:** el portero, con la parte ya leída, espera a Drive a lo sumo 90 s
       (`PART_ANSWER_MS`) y contesta `504 stalled` si la app lo pide (`?stall=1`); la app lo toma como una trabada, en
       las dos colas, sin esperar su plazo de respuesta (hasta 10 minutos y medio, que sigue haciendo falta para un
       proxy que retiene el cuerpo). Queda sin cubrir un portero que se cae sin contestar con la parte ya leída.
     - **O5:** la cola de una carpeta escucha la vuelta de la red (`FolderUploads.networkBack`, llamado por el motor
       como el de los sueltos y `page-files`) y *Resume*, *Retry* y volver a soltarla ponen en cero `stallStreak` y
       `stallRounds`.
     - **O7:** con `partial: true`, una página siguiente del listado de varias subcarpetas devuelve en `later` las
       que no entran en el tope de llamados y en `failed` las que ya no son del árbol, en vez de cortar con `409
       changed`; la app descarta lo suyo y las lista de nuevo. A una app anterior el portero le sigue contestando `409`.
     Probado con relojes simulados y en Chromium contra un portero local que se cuelga o contesta `504 stalled`.
   - **Queda (BAJO, auditoría de la entrega 4, O2): medir con el portero publicado** un video de varios GB al que
     Drive tarda más de 90 s en cerrar la última parte. Si Google contestara `308` con todo recibido mientras cierra el
     archivo, la app mandaría una parte vacía, el portero la rechazaría con `400` y el archivo gastaría un intento hasta
     *Retry* (nada se pierde ni se duplica). Lo hace Lega con un archivo enorme; si pasa, la app tendría que tomar
     «todo recibido sin `done`» como «preguntar de nuevo más tarde».
   - **Implementado (O4, v0.190):** las continuaciones de *Download all* mandan las subcarpetas
     descartadas en `skip`, conservando consulta y token. El portero valida ese subconjunto y solo lo omite con
     `partial: true` y token válido; las activas conservan sus comprobaciones. Cada nueva vuelta empieza sin omisiones.
12. **Importar de Coda, direcciones sueltas: lo que quedó de v0.069** (`Doc_Importar_Coda.md`, "Direcciones
    sueltas"). **Falta:**
    - **Hecho (v0.071 y v0.087): el anclaje de un comentario** pegado a un renglón con direcciones: un último
      intento compara sin espacios (12 caracteres o más; adentro de un bloque, solo si es uno solo) y, desde
      v0.087, contra hasta 20 bloques seguidos juntos (un párrafo partido en tarjetas). Queda sin probar con un
      comentario real de ese tipo (ERSO no trae comentarios de páginas con direcciones sueltas).
    - **Hecho (v0.087): prolijidad.** Una dirección partida por un cambio de formato queda entera en un link;
      la puntuación del final queda afuera; sin saltos de línea de más al final del párrafo ni alrededor de una
      tarjeta. ERSO no tiene ninguno de esos casos (sale igual: 4492 links, 22 tarjetas); con ERSO alterado en
      memoria, una dirección partida en tres se junta siempre (407 de 407) y partida a la mitad, 217 de 407.
      Después de una dirección que termina en `/`, `=` o `-`, una palabra común no se junta (auditoría).
      **Falta:** un corte en el medio del final de la dirección (un id sin `/` ni `?`) no se reconoce (no se
      adivina: podría ser una palabra pegada).
    - **Verlo en la app** con una importación real: una página con muchas tarjetas de Drive.
    - **Hecho (v0.087): renglones en blanco.** Se veían de dos renglones de alto (en ERSO, 7594 párrafos con
      solo un salto y 121 bloques terminados en salto): ahora cada bloque pierde un solo salto final y quedan
      hasta dos renglones en blanco seguidos. Falta verlo en la app con una importación real contra Coda.
13. **Fotos HEIC: lo que quedó de v0.072 y v0.075** (`Doc_Importar_Coda.md` y `Doc_Imagenes.md`, "Fotos
    HEIC"). El comando que baja un doc de Coda deja un JPEG de cada foto HEIC, y **desde v0.075 la app pasa a
    JPEG en el dispositivo cualquier HEIC que se agrega a una página** (D-20): lo guarda tal cual en el acto y
    lo convierte enseguida, antes de registrarlo (tamaño completo, derecho, con su perfil de color, comprobado),
    en un Web Worker, con el decodificador (libheif, 1,4 MB) bajado aparte y solo cuando hace falta. Mientras
    tanto, o si no se puede, un aviso en el lugar de la foto; sin red se vuelve a probar. **Falta:**
    - **Los HEIC ya subidos sin convertir** (antes de v0.075, o cuando la conversión falló) siguen sin verse,
      con un aviso en su lugar. Convertirlos pide bajar el original, subir un archivo nuevo y cambiar su fila.
    - **Probarlo en Safari, en la Mac y en el iPhone** (un HEIC que llega como archivo): la auditoría de v0.075
      lo recorrió en la app real en Chromium de Windows (soltar, pegar, varias juntas, sin red, recargar en
      plena conversión). En el iPhone falta medir la memoria con una foto de 48 MP.
    - **Hecho (v0.086): con red, si el decodificador no baja** se vuelve a probar a los 30 s y a los 2 min antes
      de subir el HEIC tal cual; sin red los intentos no cuentan. **Sin red, la conversión arranca enseguida**
      (no espera la consulta a la base, que tardaba unos 7 s en fallar). **La comprobación del JPEG** mira además
      los puntos que se apartan del fondo: un canvas en blanco ya no pasa con una foto casi toda blanca.
    - **Frenar a las versiones viejas (v0.074 o anterior registra un HEIC sin convertir).** Verificado en v0.086
      que `min_app_version` no frenaba la cola de archivos. **Hecho en el código (v0.090):** la app se frena sola y
      la migración `20261006120000_version_minima_archivos.sql` frena a las publicadas cuando la mínima es 0.090 o
      más (`Doc_Sincronizacion.md`, "La versión mínima y los archivos"). La migración está aplicada: verificado el
      2026-10-04 con mínima 0.170 y las guardas efectivas; tras publicar esta entrega se eleva a 0.181.
      **Hecho parcial (v0.181):** los HEIC propios antiguos sin marca, pendientes y sin subida iniciada, preparan un
      JPEG durable y lo promueven después de registrar el candidato y leer una fila positiva exacta. El HEIC queda
      protegido durante el registro incierto. Los ya registrados como HEIC conservan sus bytes; las subidas iniciadas
      quedan fuera. No cierra los demás pendientes de B13 ni acredita HEIC de 48 MP/Safari físico.
    - **Hecho (v0.086): el perfil de color** es el de la imagen principal (`pitm` → `ipma` → `ipco`), en la app y
      en el comando de Coda (el mismo código, `src/media/heifColor.mjs`), y un HEIC con solo `nclx` lleva un
      Display P3 o BT.2020 estándar. HDR (`nclx` PQ o HLG) sigue sin perfil.
    - **Sin portero** (fotos a Supabase) no se convierte.
    - **Verlo en la app con el doc entero.** Probado con una importación real de cuatro páginas (46 fotos
      convertidas: en el Drive, con miniatura y a la vista); falta la de un doc completo.
    - **Los metadatos** de la foto (fecha, lugar, cámara) no pasan al JPEG: quedan en el original.
    - **Hecho (v0.086): de a dos.** Varias HEIC soltadas juntas se convertían todas a la vez (cientos de MB
      cada una); ahora de a dos (`HEIC_PARALLEL`).
    - **El comando de Coda convierte de a una.** Tarda alrededor de un segundo por foto (unos 10 minutos con 618);
      con miles, convendría en paralelo.
    - **La comprobación del JPEG acepta uno con la mitad en blanco**, y una carrera de microsegundos entre dos
      pestañas al tercer intento deja el aviso de HEIC sobre un JPEG: anotados en `Doc_Imagenes.md`, "Pendiente".
    - **Hecho (v0.086): pruebas del comando entero** (`scripts/coda-export-run.test.mjs`, contra una API de Coda
      de mentira): bajar, convertir, repetir, `--refresh`, sin la librería, `--convert-only`, un HEIC roto y un doc
      sin HEIC, con el código de salida.
    - **Probar en la app real con sesión** lo de v0.086 (con red mala y sin red): se probó en Chromium sin sesión,
      con un banco de prueba fuera del repo.
14. **Hecho: un dispositivo nuevo ya no muestra "Subiendo ~2750 cambios".** Era lo bajado contado como
    pendiente: cada foto o video de las páginas bajadas entraba a la cola de usos y salía un `link_page_file`
    por uso (2757 en el workspace de Lega, sumando todos sus proyectos), que no cambiaba nada en la base. Ahora,
    para las páginas que el dispositivo nunca comparó, se lee primero qué usos tiene el servidor y solo se manda
    lo que falta (`Doc_Sincronizacion.md`, "Dispositivo nuevo"). Medido con 302 páginas y 2704 fotos: de unos 3 min
    con el número y 2704 pedidos a 0 pedidos, 4 lecturas y sin número.
15. **Hecho (v0.088): cada subida lleva solo los borrados nuevos.** Cada subida de contenido repetía todos los
    borrados de la página (el *delete set* de Yjs), el 96 % del peso de `page_updates` en una página muy editada
    (lo midió el diseño de B.9). Ahora el dispositivo anota los que el servidor ya tiene (`syncedDS`, con la misma
    regla que `syncedSV`: nunca dice de más) y sube solo los demás; si algo no cierra, sube todos. Sin migración.
    Ver `Doc_Sincronizacion.md`, "Subir solo los borrados nuevos".
16. **Hecho (v0.095): lo escrito adentro de algo que otro borra a la vez llega al servidor.** La subida se armaba
    con GC: si el dispositivo bajaba el borrado antes de subir, ese texto viajaba como hueco y se perdía para
    siempre (lo encontró la auditoría del historial; decisión D15: arreglarlo ya). Ahora se arma sin GC y en orden,
    y quien escribió ve en la página un aviso con su texto para copiarlo. Sin migración. Falta: subir
    `min_app_version` a esta versión cuando se publique (las anteriores siguen subiendo con GC) y, con el historial,
    decir quién borró. Ver `Doc_Sincronizacion.md`, "La subida sin GC". En v0.101, el aviso de lo que copió una
    reparación cuando Yjs le cambia el número al documento, y la prueba al azar con 300 corridas de 200 pasos.
17. **Hecho (v0.097): volver después de semanas sin red con una versión vieja.** Prueba con la sincronización de la
    v0.090 (`src/sync/offlineLargo.test.ts`): nada se pierde, con la mínima subida o sin ella. Desde esta versión, con
    la app vieja para el workspace no sale ni baja nada y la app instalada se actualiza sola. **Falta:** ver en el
    iPhone (Safari, app instalada) que se actualiza sola al volver la red (solo se midió Chromium). **Hecho (v0.099):**
    la base frena por versión los cambios del árbol y los comentarios (header `x-shotdocs-version`, migración
    `20261008120000_version_minima_arbol.sql`, rechazo 503 que ninguna versión marca como rechazado) y *Update now*
    sigue cada instalación desde `updatefound`; archivar, borrar y restaurar proyectos también frenan. La migración ya
    está aplicada (verificada en la base el 2026-10-06) y `min_app_version` está en 0.181. **Hecho en v0.214:** compartir,
    sacar permisos, invitar, cambiar roles y sacar personas también frenan en la base (migración
    `20261106120000_version_minima_equipo.sql`). **Hecho en v0.218:** la papelera de archivos también frena en la base:
    la app le dice su versión al portero en `POST /trash`, el portero se la pasa a `purge_file` y la base la compara
    (migración `20261109120000_version_minima_papelera_archivos.sql`, aplicada); sin la versión pasa
    como siempre mientras la mínima sea menor que 0.218. **Falta:** subir `min_app_version` a 0.218 (o más) para que una
    app anterior tampoco pueda, con el portero ya publicado (`Doc_Sincronizacion.md`, "La versión mínima y la papelera
    de archivos"). Un workspace autohospedado necesita CORS que acepte `x-shotdocs-version`, también en su portero.
    **Quedó de v0.218:** (1) después del primer rechazo la cola queda frenada, y un segundo intento de mandar a la
    papelera de Drive sale como error del archivo y no como aviso (`MediaQueue.trash` en `src/media/queue.ts` tira un
    error común cuando ya está frenada): que salga igual que el primero. (2) La prueba «una app anterior, que no dice
    su versión…» de `src/media/trashVersion.test.ts` usa el cliente nuevo sin versión, no la app publicada de verdad
    (la v0.090 copiada de `offlineLargo.test.ts` no manda a la papelera): modelarla con el código publicado. (3) La
    versión la dice la app y nadie la comprueba (un cliente armado a mano puede mandar una alta): la mínima es una
    guarda de compatibilidad, no de seguridad, acá y en todo lo demás que frena. Sin reproducir: como aceptar una invitación
    también frena, una persona invitada que abre por primera vez el workspace con una versión vieja de la app guardada en
    el dispositivo no la acepta en ese arranque y podría ver la pantalla de «sin proyectos» hasta que la app se actualice
    y se vuelva a abrir (`src/services.ts`, donde se aceptan las invitaciones antes de buscar el primer proyecto). Si
    pasa, que esa pantalla ofrezca actualizar. **Hecho en v0.212** (auditoría, O6): si una
    instalación falló y después el servidor vuelve a publicar la misma versión que corre, *Update now* recarga en vez de
    seguir diciendo que falló. Ver `Doc_Sincronizacion.md`, "La versión mínima, el árbol y los comentarios" y "Volver
    después de mucho tiempo sin red".
18. **Que lo borrado no llegue a quien solo ve la página (D14). Entregas 0 y 1 hechas (v0.104), migración
    `20261010120000_privacidad_borrado.sql` aplicada e interruptor apagado.** Quien no edita baja siempre la última
    base limpia (armada por un editor, con lo borrado como hueco), con `clean_reset_seq` al compartir, invitar y mover,
    los permisos de los usos sacados de archivos, la columna `update` cerrada y la línea al compartir y la ayuda.
    **Falta para prenderlo** (antes de invitar al primer cliente de verdad): el cambio del script
    de restaurar (la migración ya está aplicada), `min_app_version` en esta versión, la prueba de punta a punta (7) y `clean_min_version`. Después: (2)
    medir; (3) limpiar el dispositivo de quien deja de ver lo borrado; (4) deltas si hacen falta; medir en el iPhone. La subida
    no cambia (D19). Las páginas en la papelera ya no se leen con Ver (ítem 19, v0.102). Lega aceptó la demora del
    cliente (D22, sección 13).
19. **Hecho (v0.102): la papelera de páginas ya no se lee con Ver.** Ver, Comentar y los invitados leían enteras las
    páginas mandadas a la papelera (título, contenido, comentarios, archivos) si veían algo de arriba: la regla de
    permisos miraba solo si el proyecto estaba borrado (auditoría de D14). Ahora las ven solo quien edita sin ser
    invitado y el dueño; migración `20261009120000_papelera_lectores.sql`, con su prueba SQL y
    `src/sync/trashReaders.test.ts`. Migración aplicada el 2026-10-02. Menores: un pase del portero ya entregado sigue
    sirviendo hasta que vence (8 horas, igual que al sacar un permiso); una invitada con crear que manda una página a la
    papelera y la restaura antes de que suba lo primero recibe un rechazo en la segunda (la página queda en la
    papelera, la restaura el dueño; no se pierde nada). Ver `Doc_Supabase.md`, "La papelera de páginas y quién la ve".

20. **Hecho (restos de la tanda 17): el esquema publicado de las pruebas** (B.20, v0.109). `src/ui/fixtures/editorSchemaMain.ts`
   es la copia del esquema de la versión publicada y `editorSchemaFixture.test.ts` lo compara con el de hoy. Lo que quedaba
   abierto, resuelto: (1) la prueba no veía un atributo nuevo de `photo` porque el fixture importa de hoy el módulo de la
   foto; ahora compara contra una **firma fija** (`fixtures/editorSchemaMain.firma.ts`) y lo ve (medido: con la prueba
   anterior, un atributo agregado a `photo` pasaba; con la nueva falla); (2) nada avisaba si nadie regeneraba el fixture
   después de publicar (ya estaba viejo: sin el alto de las miniaturas ni `quietImage`): una prueba compara el fixture con
   `origin/main:src/ui/editorSchema.ts` cuando esta copia no cambió el esquema y falla con `npm run esquema:publicado`; se salta
   sola en una rama que cambia el esquema a propósito y sin git u `origin/main`. `npm run esquema:publicado` (`scripts/esquema-publicado.mjs`)
   regenera el fixture, la firma y vacía `NUEVO_SIN_PUBLICAR`; se corre al publicar un cambio del esquema, en la misma tanda
   que lo publica (ver `Doc_Fotos_En_Linea.md`, "El esquema publicado de las pruebas"). Queda: el fixture sigue tomando de hoy
   los módulos compartidos (`photoSpec`, `driveCard`, `imageRowsEditor`, `cellThumbs`, `quietImage`): lo que no es el esquema
   (por ejemplo, el `parseHTML` de la foto) no lo cubre la firma. **Hecho (v0.174):** el hueco de la auditoría (el fixture
   regenerado a mano dejaba la firma laxa y `NUEVO_SIN_PUBLICAR` con líneas ya publicadas): ahora, cuando el esquema y los
   módulos que importa son los de `origin/main`, la prueba exige la firma de hoy y la lista vacía; con un módulo distinto se
   salta, sin falsa alarma por un atributo nuevo de la foto.

21. **Hecho (v0.132): restos del deshacer de Yjs** (entrega 0 de P.26, `Doc_Deshacer.md`, sección 16). Deshacer lo
   escrito seguía lo que otro deshacer había vuelto a poner solo hasta el primer corte: dejaba restos si se había escrito
   en el medio y se llevaba texto de antes si las copias se habían juntado. Un parche a Yjs (`patches/yjs+13.6.33.patch`,
   Yjs fijo en 13.6.33) sigue la copia entera. Con texto: de 1.844 a 3.000 de 3.000 exactas y de 14 a 0 con algo de
   menos; con el editor real, de 68 de 300 con restos a 0. Borrando y deshaciendo bloques enteros no es cero: 1 de 300
   con una letra de antes de menos con el editor (antes 7) y 10 de 3.000 en un modelo de párrafos (antes 112). Quedan
   casos raros con las mismas letras en otro orden (1 de 300 con el editor; algunos los trae la parte de `redoItem` del
   parche, sin pérdida). Pendiente: reportarlo a Yjs con los casos mínimos (`Doc_Deshacer.md`, 16.1 y 16.4).
22. **Hecho (v0.170): la excepción del ⌘Z de Yjs con dos personas** (la encontró la auditoría de la entrega 0 de P.26; ya
   pasaba antes del parche de B.21). Con dos personas, a veces `UndoManager.undo()` tiraba `TypeError` en `redoItem`: el
   ⌘Z tenía que volver a poner algo en la copia de un renglón que la otra persona había borrado y Yjs ya había
   recolectado (vaciar rehacer le saca la marca que la guardaba). La línea de tiempo lo atrapaba (v0.140) y frenaba el ⌘Z.
   **Medido** con dos editores borrando y deshaciendo bloques enteros: 10 de 3.000 corridas (13 ⌘Z); ninguno dejaba
   nada a medias ni los editores distintos, pero el paso se perdía (en 7 de 13, renglones enteros que tenían que
   volver). **Arreglado en el parche de Yjs:** lo que no tiene dónde volver se salta, lo demás del paso se hace y, si se
   saltó algo, lo insertado por ese paso se deja (puede ser el mismo texto movido). De 10 a 0 con el editor, de 24 a 0
   (y de 236 a 0 en 20.000 más) en el modelo de párrafos; sin la excepción, idéntico; al final nunca falta más texto
   que con el ⌘Z frenado (en un ⌘Z suelto sí puede: el editor borra un bloque que no entra en el esquema y vuelve con los
   siguientes). Sin `min_app_version`.
   Queda: con dos editores, 6 de 3.000 corridas terminan con los dos textos distintos (las mismas sin el arreglo, ninguna
   con la excepción; **arreglado en B.26**); el Enter deshecho cuya mitad vuelve a un renglón que otro borró desaparece
   (de Yjs, sin copias); la reparación del editor cuando lo que vuelve con un deshacer de dos personas no entra en el
   esquema y se borra el bloque (pasa también sin B.22; merece su propio ítem); reportarlo a Yjs (`Doc_Deshacer.md`,
   sección 20).
23. **Hecho (v0.152): los topes de largo de la base en la app.** Un título de más de 500 caracteres quedaba rechazado
   para siempre (`pages_title_check`). El árbol corta títulos, nombres de proyecto y claves de orden, lo que sobra del
   título va al principio de la página y lo ya rechazado vuelve a la cola cortado (`Doc_Sincronizacion.md`, "Topes de
   largo"). **Hecho (v0.153):** la reparación de un rechazo ya no depende del reloj del dispositivo (compara el
   `updated_at` que tenía la fila al rechazarse con el de ahora; un rechazo de una versión anterior, sin ese dato, deja
   el título y manda el texto entero a la página), con la prueba del renombre posterior en la cola (mutante R3), y
   rehacer las claves de orden toca solo las páginas amontonadas alrededor del hueco. **Hecho (tanda 16):** una prueba fija
   el objetivo de la ventana en la mitad del tope (64; mueren los mutantes 65, 63, 72, 128 y 32). Queda: si otro dispositivo movió a
   la vez una de esas, gana el último que llega (vuelve a su lugar anterior; no se pierde nada, solo el lugar). Pasa solo
   después de unas 600 páginas puestas en el mismo hueco. Arreglo completo: mandar el rehecho como una sola operación del
   servidor que no toque una hermana movida después.
24. **Un error en la consola al pegar una foto — hecho (v0.155).** No era al pegar sino al **copiar** (o arrastrar): el
   HTML externo de BlockNote (el foto-bloque) y el de la foto en línea ponían `sdmedia://…` en un `<img src>` creado en
   el documento vivo, y el navegador lo pide al instante. Pasaba igual en `main`. Ahora la dirección sale con
   `loading="lazy"` puesto antes del `src` (`src/ui/quietImage.ts`, con `editorSchema.ts` e `inlinePhoto.ts`): sin pedido,
   y pegar trae las mismas fotos. Pruebas en `quietImage.test.ts`, más la reproducción en Chromium (cero pedidos fallidos).
   Las observaciones de su auditoría **quedaron hechas (tanda 16):** (O3) el `loading` del `renderHTML` de la foto en línea
   **sí tiene efecto**: BlockNote vuelve a leer ese HTML con `innerHTML` en la página viva al arrastrar por el tirador
   (`SideMenu.onDragStart`) y sin la marca el navegador pide el `sdmedia://`; se probó y se dejó, con dos pruebas (una por
   la ruta del arrastre; la medición inicial en un documento inerte no veía esa ruta); (O4) una foto con `showPreview: false`
   ya no sale con la imagen mínima `data:image/gif…` en el `<a href>` ni en su texto (se envuelve solo con vista previa),
   con prueba y con el esquema anterior. Pegar solo ese HTML trae texto plano (`sdmedia://` no es un destino de enlace
   permitido), no un enlace ni una foto; con el portapapeles completo vuelve el bloque intacto. Queda (BAJO): arrastrar
   una tabla con foto en una celda por el tirador (misma ruta; no se midió).
25. **Lo que quedó de D226 (tooltips con gesto o atajo, v0.156).** (a) **Hecho (v0.163):** los botones propios de
   BlockNote en la barra de formato (*Bold*, *Italic*, alinear, *Colors*, *Link*…) usan el tooltip de la app: la barra
   le pasa a BlockNote su propio botón (`src/ui/toolbarTips.tsx`), con «**atajo**: acción» del registro o el nombre si
   no tiene atajo; lo prueba `formatToolbarTips.test.tsx` con la barra real (el globo de BlockNote ya no aparece). (b) **Hecho (v0.156):** el tooltip
   del borde de la barra lateral salía afuera de la pantalla; ahora todo globo queda adentro (a un costado y a la altura
   del mouse si el control es más alto que media ventana, y corrido si no entra en ningún lado).
   (c) **Hecho (v0.163):** una prueba del anotador en una ventana angosta con mouse (`annotatorTouch.test.tsx`): la tira
   del teléfono, con los atajos en los tooltips de las herramientas, deshacer, encuadrar y el grosor; el mutante
   `{ touch: true }` ya no sobrevive. (d) **Hecho (v0.165):** la barra de los links (*Edit link*, *Open in new tab*,
   *Remove link*, al pasar por un link) también: la página dibuja su `LinkToolbarController` con el botón de BlockNote
   envuelto (`PageLinkToolbarController`, `toolbarTips.tsx`), *Open in new tab* y *Remove link* con su nombre en `data-tip`
   (no tienen atajo: es un ícono) y *Edit link* sin globo (es un botón con texto y BlockNote lo rotulaba «Edit»: repetía
   lo que ya dice); sin el globo de BlockNote. Prueba `linkToolbarTips.test.tsx` con la barra real.
26. **Hecho (v0.170): dos personas con textos distintos después de deshacer** (lo dejó B.22: 6 de 3.000 corridas con
   dos editores terminaban con los dos textos distintos para siempre, "y la toma" en uno y "y la omat" en el otro). Los
   dos `Y.Doc` tenían las mismas ediciones: la memoria de quien deshacía no coincidía con lo que mandaba (ni con lo que
   ve él mismo al recargar). **De Yjs, también sin nuestros parches:** al deshacer el borrado de un renglón, los vecinos
   de cada letra que vuelve se buscan siguiendo las copias, y con un original y su copia en el mismo texto quedaban
   cruzados. **Arreglado en el parche de Yjs:** los vecinos se toman como los lee otro dispositivo (el derecho a la
   derecha del izquierdo, el izquierdo sin partir). De 6 a 0 con dos editores, de 22 a 0 en el modelo de párrafos y de
   33 a 0 documentos distintos de lo guardado con una persona; ninguna letra de menos; versiones mezcladas sin
   diferencias nuevas (las que quedan empiezan en un ⌘Z de una versión vieja: por eso `min_app_version` sube a esta
   versión; `Doc_Deshacer.md`, sección 21). Queda: el Enter deshecho cuya mitad vuelve a un renglón que otro borró (20.5)
   no es de esta familia; extender la decisión F de B.22 lo arregla pero empeora *Replace all* y cambia 655 de 3.000
   corridas: propuesta de dejar lo insertado solo si es el mismo texto movido, a medir (21.5). Reportarlo a Yjs. De la
   auditoría (chicos): con vecinos cruzados el recorrido nuevo puede ir hasta el final del renglón (no medible en páginas
   reales); en ~0,15 % de las corridas, justo después de una negrita, la marca de formato difiere un paso y se iguala
   (de Yjs, nunca texto); el arnés de dos editores muestra en ~50 % de las corridas algún paso donde un editor no muestra
   exactamente su documento (la reparación del esquema, ya conocida).
27. **Hecho (v0.219 y v0.223): las pruebas que fallaban solo con la máquina cargada.** Con la suite entera corriendo junto a
   otros procesos, cada corrida terminaba con entre 0 y 7 pruebas caídas que solas pasaban. No era la app: eran las
   pruebas. Cuatro causas, cada una con su arreglo: (a) esperar "un rato" después de un clic y mirar: ahora se espera
   a que termine lo que quedó en marcha (`src/test/settle.ts`) o la condición misma, y las esperas por condición ya no
   se rinden al segundo (`src/test/patience.ts`); (b) el motor que sincroniza solo, un rato después de la última
   escritura, en medio de una prueba que afirma que nada cambió o que algo está sin subir: la prueba lo frena o
   sostiene la subida; (c) topes de tiempo en milisegundos: se miden contra una vara tomada en la misma corrida
   (escribir sin colapsar, armar el plan del reemplazo) o contra el plazo de la propia espera; (d) el editor, que se
   carga aparte la primera vez, armado dentro del plazo de la primera prueba del archivo: se arma antes; (e) pruebas
   que terminaban con la app todavía trabajando (el final de un reemplazo, de deshacerlo y de rehacerlo): al cerrar la
   base quedaba un rechazo suelto que la corrida anotaba como error aunque todas las pruebas pasaran; ahora esperan el
   aviso del final. Una sonda (anotar cada pedido a una base que una prueba ya cerró) encontró 127 de esos pedidos
   tardíos en 30 archivos en dos corridas, todos atajados por la app; no se revisó uno por uno que todos los caminos lo
   atajen.
   **v0.223: con dos corridas completas a la vez.** Después de la v0.219 la medición independiente había dado 2
   corridas limpias de 10. La de arranque de esta tanda (dos rondas de dos corridas, con otros procesos pesados en la
   máquina) dio 0 de 4: entre 3 y 14 pruebas caídas por corrida y, en dos, un rechazo suelto. Lo que se encontró:
   (f) **demasiados procesos.** Vitest abría uno por núcleo menos uno: 31 por corrida, 62 con dos corridas en 32
   núcleos, y cada prueba tardaba entre 6 y 10 veces lo que tarda sola. Ahora abre la mitad de los núcleos (16 en esa
   PC; nunca menos de 12 ni más que los núcleos menos uno: `testWorkers` en `vite.config.ts`). La corrida sola no tarda
   más, porque la marcan sus dos archivos más largos y no la cantidad de procesos: medida tres veces de cada forma,
   154, 156 y 425 s con 31 procesos (la última, con otra carga pesada en la máquina) y 127, 142 y 142 s con 16. Solo con
   este cambio, sin tocar ninguna prueba, dos corridas a la vez pasaron de entre 3 y 14 caídas a 0 y 1.
   (g) **plazos propios menores o iguales al general.** Se sacaron los 52 que había (30 s en grupos enteros de
   `offline.test.ts` y `offlineUi.test.tsx`, 30 y 45 s en las pruebas de importar, `vi.setConfig` de 30 y 60 s en nueve
   archivos), los pasos de antes y después de cada prueba pasan de 10 a 60 s (`hookTimeout`), y las dos pruebas largas
   que vencían llevan un plazo acorde (`projectIndex` «80 cruces», de 120 a 600 s; `yjsUndoRedoneEditor`, de 120 a 300).
   La regla: el plazo no afirma nada, así que ninguno propio es menor o igual al general, y solo las pruebas largas de
   verdad (más de unos 6 s solas) llevan uno, de 10 veces para arriba de lo que tardan solas.
   `src/test/patience.test.ts` lo comprueba en todos los archivos de pruebas.
   (h) **pruebas pesadas por la prueba y no por la app.** En `offline.test.ts`, comparar megas de `Uint8Array` con
   `toEqual` tardaba entre 7 y 24 s por comparación según la carga (lo de la app, una décima de segundo): ahora compara
   los mismos bytes en milisegundos, y el archivo pasó de 52 s a entre 10 y 19. En `i18n.test.tsx`, buscar cada clave en
   todo el código eran miles de pasadas por varios megas: ahora lee cada archivo una vez (de 17 s a 1).
   (i) **esperar una condición de pantalla adentro de un `act`** (`await act(() => vi.waitFor(…))`): React no dibuja
   hasta que el `act` termina, así que si el cambio llegaba durante la espera la condición no lo veía nunca y fallaba a
   su plazo. `src/test/shown.ts` mira entre actos cortos (`workspaces.test.tsx` y las esperas nuevas de esta tanda).
   (j) **esperar un rato y mirar**, lo que quedaba: los ayudantes de 45 archivos de pruebas de pantallas pasan a
   `settled` (el mismo rato y, después, a que termine lo que quedó en marcha), y donde después del rato había una
   afirmación de algo que tiene que llegar se espera eso (`templateHost`, `ownHost`, `exportLocalSave`, `linkAsideUi`,
   `mentions`, `projectSearch`, `offlineUi`, que además terminaba con la app todavía borrando copias).
   (k) **carreras contra el reloj.** El resguardo del doble toque del dictado (600 ms de reloj real entre tres clics)
   se prueba llevando el reloj a mano, a 1 ms del borde; «no se ofrece mientras el índice lee» frenaba una lectura 1,2 s
   contra una espera de medio segundo, y ahora la frena hasta que la prueba la suelta.
   (l) **topes de rendimiento.** `collapseEditor` «7.» ya no compara la mediana de una página contra la de la otra
   (con la máquina cargada iba de 0,8 a 7,2 contra un tope de 4). Compara, con el mismo tope, la tecla más rápida de
   cada página (de 1,6 a 2,5) y la mediana de las razones por par, cada tecla colapsada contra la que corrió pegada a
   ella (de 1,5 a 2,6 en 70 mediciones con dos y con tres corridas completas a la vez). La más rápida sola no alcanzaba:
   no notaba que 9 de cada 10 teclas rearmaran todas las decoraciones (2,3 a 3,0); la de los pares sí (5,8 a 8,6).
   `admit` «cuánto tarda una fila» afirma sin reloj que la copia se arma una sola vez, y deja el tope de 200 ms por la
   mediana: no hay vara tomada en la misma corrida que aguante la carga (una fila contra armar la copia dio entre 0,07
   y 2,97), así que ese tope solo detecta algo catastrófico.
   De 23 mutantes del código de la app contra las pruebas reescritas, cayeron 22 (el otro, abajo). Medición final:
   tres rondas de dos corridas completas a la vez, con otros procesos pesados en la máquina; las seis cerraron limpias
   (código de salida 0, sin errores sueltos), en entre 209 y 400 s. La prueba más lenta de las que usan el plazo general
   de 60 s tardó 20. La auditoría independiente midió por su cuenta otras ocho de ocho.
   **Queda:** con tres corridas a la vez se midió una sola ronda (las tres limpias, en 293 s, sobre el árbol anterior a
   integrar la v0.222); con otra carga que ocupe más núcleos de los que quedan libres no se midió. Siguen 7 esperas
   `act(() => vi.waitFor(…))` en `exportZipLocalSave.test.tsx`, `historyCacheCleanup.test.tsx` y `pageLinkGate.test.tsx`:
   lo que esperan no es de pantalla, así que funcionan, pero el patrón es una trampa para quien lo copie a una condición
   de pantalla. Seis archivos de pruebas de pantallas siguen con el ayudante de rato fijo (`exportPdf.test.tsx`,
   `exportZip.test.tsx`, `Annotator.test.tsx`, `linkLabels.test.tsx`, `pageMarkupGuards.test.tsx`, `trashAll.test.tsx`;
   los dos últimos usan relojes falsos). Los bucles de espera por cantidad de vueltas (87 en 38 archivos,
   `for (…; i < N && !condición; …) await wait(M)`) siguen con su tope de vueltas: con `wait` sobre `settled` cada vuelta
   espera lo que quedó en marcha, pero no se pasaron a `shown`. Los `tick` y `settle` de rato fijo de unos 60 archivos de
   pruebas sin pantalla no se tocaron (no cayeron en ninguna medición). Tampoco otros topes de tiempo fijos con margen
   amplio (`findEditor`, `pdfPreview`, `carreteModel`, `exportPdfParts`, `folderZip`, `admitAudit`, `codaComments`), y
   una prueba cortada por tiempo sigue dejando sin dibujar a las que siguen en su archivo. La prueba que vigila los
   plazos (`src/test/patience.test.ts`) mira línea por línea: no ve un plazo que sale de una constante, las opciones
   `{ timeout }` puestas como último argumento ni una función flecha sin llaves partida en varias líneas, y toma por
   plazo cualquier `testTimeout:` escrito en un objeto (hoy no hay ninguno de esos casos). Lo que estas pruebas todavía
   no detectan: `collapseEditor` «7.» no nota siempre perder el camino rápido de escribir (la proporción queda entre 3
   y 5 contra el tope de 4: cayó 1 de 5 veces); `admit` «cuánto tarda una fila» no nota el costo de volver a armar la
   copia si no pasa por `rebuild`; en `templateHost`, los *Use* apagados tienen dos resguardos (el botón no llama y
   aplicar vuelve a mirar si la página está vacía) y sacar solo el del botón no se nota, porque el otro lo frena; el
   tope de reemplazar en 300 páginas (12 veces armar el plan) no nota una regresión de ×3, porque con la máquina cargada
   la proporción llega sola a 8; `exportPdf` «no espera dos veces» no se ejerce en jsdom (las imágenes nunca cargan);
   en `offlineUi` «una marca existente…» la nítida nunca se arma en jsdom, así que solo se comprueba que la casilla de
   borrar las copias llega a quien saca la marca; y la tabla de migraciones de `Doc_Supabase.md` tiene tres filas viejas
   fuera de orden.

### C. Esperan a Lega

10. **Fase 3 (plantillas): pasó a P.23** (2026-10-02), con una primera versión de los campos para que Lega la ajuste.
11. **Pasó a P.24** (2026-10-02): el asistente y el MCP ya no esperan a Lega; diseño en `Doc_Asistente.md`.
12. **Correo automático de invitaciones** (el portero lo manda con Resend): hace falta una clave de Resend
    solo para enviar, cargada por Lega en el portero. Mientras tanto, la app copia el link.
13. **Que la pantalla de Google diga "LGA Shot Docs"** (pedido de Lega). Hoy, al conectar Drive, Google
    muestra `cold-salad-d599.workers.dev` porque la app no tiene la marca verificada. Hace falta: una
    dirección propia para el portero (por ejemplo `media.lega.com.ar`, con su dirección de vuelta en el
    cliente de Google), completar **Branding** en Google Cloud (nombre, logo, página de inicio, política de
    privacidad y condiciones del punto 6 y dominio autorizado `lega.com.ar`), publicar la app (**In
    production**, así la conexión tampoco vence a los 7 días) y pedir la verificación de marca. Hasta entonces, la conexión con
    Drive vence cada 7 días y se reconecta desde la app.

### Resueltos adentro del plan

- Una foto HEIC del iPhone se ve rota en Chrome de Windows: lo arreglan las miniaturas (paso 6).
- Una imagen copiada a otra página sigue apuntando a la primera (`sdfile://<página A>/...`): al pegar en
  otra página se registra el archivo también para la nueva (pasos 6 y 9), así quien ve solo esa página
  la ve.
- D-05 (hosting para trabajos pagos): decidido, Cloudflare.

## Cuando se termine esta app

Pedido de Lega (2026-10-01), para cuando la app esté terminada:

- **Apple Developer Program** (USD 99 por año): hace falta para la app nativa de iPhone y Mac, para probarla con
  TestFlight y para guardar en el carrete del iPhone.
- **Microsoft Store**: para que las apps de Windows no salgan como virus. Lo que se publica en la Store lo firma
  Microsoft; un instalador propio fuera de la Store necesita además un certificado de firma (por ejemplo, Azure
  Trusted Signing).
- Google Play, no.

## Al final del alcance: evaluar funciones de reportes de rodaje

Reserva expresa de Lega (2026-10-04): estas oportunidades se ofrecen **sólo cuando todo el resto de
la app esté terminado y probado, incluidas las pruebas pendientes**. Quedan fuera del trabajo
autónomo autorizado. No se diseña ni implementa ninguna por iniciativa propia ni por seguimiento
automático: cada implementación requiere **consentimiento expreso de Lega** después de ofrecerlas.
No hay una decisión que pedir ahora. Referencia funcional: [Wrangler VFX](https://www.wranglervfx.com/learn).

**Registro del rodaje y referencias:**

- Claquetas y tomas con numeración y duplicación automáticas.
- Biblioteca reutilizable de cámaras, lentes y kits.
- Registro de tiempos de rodaje y generación de DTR.
- Cálculo de nombres y rangos para archivos HDRI y series DSLR.
- Fotos de referencia relacionadas con claqueta, toma y cámara.
- Seguimiento de lens grids por lente.
- Lectura de distanciómetros Bluetooth.

**Intercambio y entrega:**

- Exportación tabular especializada a CSV, VES y Excel.
- Integración directa con ShotGrid.
- Importación de Setellite, VES y ZoeLog con mapeos reutilizables.
- Correo de entrega preparado con destinatarios, resumen y PDF.
