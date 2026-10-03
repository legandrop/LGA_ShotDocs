# Roadmap

Lo que falta, por importancia. El orden de trabajo lo manda `Plan_Workspaces.md` (secciones 10 y 11); las
fases originales están en `Plan_ShotDocs.md`, sección 9.

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
  tipo de bloque nuevo); `min_app_version` quedó en 0.045.
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
  `Doc_Peso_Proyectos.md`, "Cómo quedó". La lista por proyecto y el orden por peso van con P.8.
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
  la subida directa a Google con el Drive real, "Agregar a esta carpeta", la cuadrícula, la lista sin red, "Seguir"
  en Chrome y Edge y el botón "Carpeta…" del menú `/`. **Entrega 2 hecha (*Bajar todo*, rama `lega/carpetas-zip`):**
  zip sin comprimir con Zip64 escrito a medida que llega en Chrome y Edge, o el árbol en una carpeta; en memoria con
  tope en Firefox, Safari y los teléfonos (D24); nombres de Drive limpios para Windows y la Mac (`.`, `..`, punto al
  final, `CON`…, a lo sumo 255 bytes) y cortes de 200 y 250 caracteres por grafema. *Retry missing*, el tope sin avance
  de cada pedido (R1) y el ZWJ de los emojis compuestos en la app (O4), hechos (rama `lega/carpetas-restos`); listar
  hasta 40 subcarpetas por pedido (`dirs` en `/folder/list`) y el ZWJ en el portero, hechos (v0.119, rama
  `lega/carpetas-e2`). Falta (BAJO): Firefox sin tope por el service worker y probar a mano en Safari, el iPhone y con
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
  práctica en `/practice` y la recorrida de diez pasos (nueve en el teléfono). Falta la entrega 3 ("Mostrame" en
  cada entrada y el punto de novedades), elegir con Lega las fotos del ejemplo y probar a mano en Safari, el iPhone
  y con VoiceOver.
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
  archivados y de borrados con *Restore*, el primer proyecto de cada dispositivo y la pantalla sin proyectos; falta
  aplicar la migración 9 (después de la auditoría del código y la copia de seguridad) y subir `min_app_version`.
  **Entrega 2 implementada (rama `lega/proyectos-borrar-drive`):** la casilla de Drive en la ventana de borrar
  (destildada; dueño y admins), las rutas `/project/trash` y `/project/untrash` del portero, restaurar trayendo la
  carpeta, *Restore without its files* solo con `missing` de verdad y *Look for its files again*; falta la auditoría,
  aplicar la migración 10, publicar y correr la prueba técnica. Después, la 3 (*Delete forever*).
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
  calcular en jsdom; la prueba afirma el texto del selector y la medición real está en Chromium; (O3) un clic en el
  triángulo de una fila no abierta le deja el foco y, por `:focus-within`, sus ⋯ y + (y el nombre cortado) hasta que el
  foco se va, aunque el mouse ya no esté; pasar a `:focus-visible` lo evitaría pero cambia el comportamiento existente.
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
  **Falta:** medir en el iPhone. Para después: la marca *Restored from…* se pierde si la app se cierra antes de que la
  restauración suba y nunca se vuelve a abrir el historial de esa página en una semana (es solo un rótulo); (O3)
  renombrar pisa el nombre anterior sin rastro (bien hecho pide una función nueva en la base, o sea una migración: desde
  la app serían dos pedidos y el nombre cambiaría de dueño). Aparte, después: que lo borrado no llegue a quien solo ve la página (decisión 2;
  diseño en `Doc_Privacidad_Borrado.md`, B.18).
  Ojo: `npm run db:test` aplica las migraciones de verdad; esta se probó con un script en `begin … rollback`.
- **P.19 Link público: *Anyone with the link*** (Lega, 2026-10-02): en *Share*, además de personas y correos, un link
  que cualquiera abre sin cuenta, con *Can view* (que siempre puede comentar) o *Can edit*; "debería estar seguro".
  **Entregas 0 y 1 hechas (v0.114: *Can view*, migración sin aplicar; ver "Cómo quedó" en `Doc_Link_Publico.md`).** Para
  publicarla: aplicar la migración, prender el interruptor de D14 y subir la mínima. Falta: el ícono del árbol para las
  páginas con link, el detalle *Can view link, created by…* para el equipo, y las entregas 2 y 3.
  **Entrega 2a hecha (v0.151: escribir; migración `20261028120000_link_editar.sql` sin aplicar, `schema_version` 19, y el
  interruptor `link_edit_min_version` apagado; ver "Cómo quedó la 2a" en `Doc_Link_Publico.md`).** Para prenderla: la
  barrera de error alrededor de `PageEditor` en `main` (R4), aplicar la migración, subir la mínima y poner
  `link_edit_min_version`. Falta la 2b (archivos por el link) y la 2c (lo apartado a la vista). Lo encontrado al
  implementar: si una fila del visitante se aparta, todo lo que sigue de la misma sesión (el mismo autor de Yjs) también,
  dependa o no, hasta que recarga: adelantar "volver a la página como la ve el equipo" (2c) gana peso. **Su auditoría
  dio no aprobado (el paso 8) y se corrigió en una ronda** (`Doc_Link_Publico.md`, "Correcciones de la auditoría de la
  2a"). Quedan de esa auditoría: O3 (una versión inventada como `'9999'` en una fila la deja sin decidir y traba lo que
  sigue de ese link en esa página; *Reset link* lo corta; falta un techo de versión en la base), O9 (la
  pantalla de link muerto, después de recargar, no ofrece lo mandado y apartado) y O4 (con D14 apagado se escribe igual
  en la sala). Al publicar la 2a, subir `min_app_version` a ella (O5: la publicada pasa *Can edit* a *Can view* al
  cambiar el vencimiento). De la re-verificación (BAJO): una página del equipo con más de 100 niveles de sangría aparta
  todo lo que mande el link en esa página (el tope de profundidad se mide en la página entera; solo con una importación rara).
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
  modo liviano), avisar y ofrecer copiar los comentarios sin subir cuando el link muere, limpiar las bases locales de
  links viejos, confirmar *Restricted* como *Reset link*, los plurales de «Today: opened 1 times», un texto propio del
  link en vez de «Ask for edit access», `LinkRemote` cerrando también `deleteProject` (la 2a cerró `namePageVersion`,
  `share` y compactar), rechazar «(via link)» en el nombre, un selector de fecha en vez de `prompt()` al cambiar el vencimiento, la ayuda
  según quién la lee; en la base, tiempos de un token que ya existe (el doc dice «cuesta lo mismo»), el costo sin contar
  de `plink_tree(sig)` (26 ms con 423 páginas), el `max_rows` de PostgREST (1000: ramas más grandes llegan cortadas), la
  prueba del portero de los pases de 2 horas en `/folder/list`, el texto de «cada archivo listado cuenta como un pase»,
  y una línea de ayuda por `revoke_public_link` con la raíz en la papelera (`page_in_trash`).
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
  observaciones de su re-verificación quedaron **hechas (v0.0XX)**: la prueba con un reemplazo en curso para la
  pregunta al cerrar la pantalla de error (`replaceRunning`), y restaurar sin el editor ya no escribe los atributos por
  defecto en los bloques iguales a la versión (los saltea; la vista de diferencias comparaba los atributos guardados y los
  mostraba como «formato cambiado»).
- **P.25 Sacar una foto o filmar desde la app** (Lega, 2026-10-01). **Hecho para la web (v0.110):** *Take photo* y
  *Record video* en el menú "/" y en el menú de la página, solo en el teléfono y la tableta (el video, con portero):
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
  ofrece crear o elegir la carpeta de reportes y mueve ahí la página (ya no sale como plantilla común). Quedan dos
  sorpresas anotadas por la auditoría: *Apply template…* en una página de la raíz con subpáginas las mueve con la página, y
  la ventana no avisa si la carpeta elegida ya tiene el reporte de hoy (mostrar el *already exists* con *Open*).
  **Las anotaciones de las fotos viajan con la plantilla (v0.136, D46 aplicado a las plantillas):** al usarla (también el
  reporte del día) y al guardar como plantilla, mismas reglas que copiar y pegar; *Clear filled-in values* las saca con las
  fotos; entre proyectos no viajan (`Doc_Plantillas.md`, "Cómo quedó (las anotaciones de las fotos)"). Falta a mano: usar
  una plantilla con fotos anotadas en la Mac y en el iPhone. De su auditoría (BAJO): en el reporte del día, si las anotaciones
  no entran por los topes, el aviso queda solo en la consola (llevarlo a la pantalla, como al usar una plantilla); dos
  guardas dobles (si se saca una capa la otra filtra igual) no tienen una prueba por capa. **Falta** que Lega revise el contenido de las tres (PL1) y
  pruebe el atajo en Firefox y Safari de la Mac y con un teclado latinoamericano físico. Quedan para después la marca
  *2 reports for…* en la barra lateral con la papelera ofrecida para el repetido sin tocar (O6), y en *Buscar en el
  proyecto* la marca *Template* con *Replace all* que saltee las plantillas salvo *Include templates* (O9, va con la
  búsqueda). De la auditoría de la entrega 3 (ninguna pierde contenido): dos dispositivos sin red que guardan su primera
  plantilla crean dos carpetas *Templates* (O1); *Template settings* en un dispositivo y un cambio de formato en otro a la vez
  pisan la descripción, la limitación conocida de `settings` (O2); guardar un reporte con *Use for day reports* cambia la
  plantilla de la carpeta para todo el equipo (O3, decidido así: D94); un invitado con *Edit & create pages* guarda
  plantillas, como permite la base (O4). Quedó de la auditoría de
  la entrega 1: *Exit* de la vista previa abierta desde la ventana va al inicio y no a la página donde se elegía
  (Atrás sí vuelve); y un aviso de ProseMirror en la consola al abrir la vista previa (sin efecto visible). De la
  auditoría de la entrega 2 (las demás observaciones, corregidas): un invitado con *Edit & create pages* crea reportes,
  porque la base mira el nivel y no el rol; si un cliente nunca tiene que crear páginas, es una decisión del modelo de
  permisos (`Plan_Workspaces.md`); y al reusar un reporte vacío hecho por la app se le cambia el número de día por el
  siguiente al último (no se pierde nada). **Para después:** que la base fusione las claves de `pages.settings`
  (`settings || patch`) en vez de reemplazar el objeto entero, con su migración: hoy dos cambios de ajustes a la vez
  se pisan (`Doc_Plantillas.md`, sección 8).
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
  contra el dibujo, el Apple Pencil con la palma. De su auditoría quedan: un `pointercancel` del sistema (el gesto de «atrás», una llamada) descarta el trazo en curso, como en la compu (decidir si se guarda); la tira de herramientas no se desliza sola hasta la elegida al abrir. Sigue la entrega 4 (bajar y copiar con anotaciones).
  **Copiar y pegar con las anotaciones hecho (v0.132, D46, parte de la entrega 5):** copiar o cortar una foto anotada y
  pegarla en otra página del mismo proyecto le lleva sus formas (mismas claves, sin duplicar, un solo ⌘Z saca la foto y
  sus flechas); a otro proyecto o workspace no viajan, y al portapapeles no va nada nuevo
  (`src/media/markupClipboard.ts`, `src/ui/markupClipboardEditor.ts`). Falta a mano: ⌘C y ⌘V de verdad en Safari de la
  Mac y en el iPhone. **Con plantillas (v0.136):** las anotaciones también viajan al usar una plantilla del mismo proyecto y al
  guardar como plantilla (*Clear filled-in values* las saca con las fotos). De la entrega 5 quedan el historial de las anotaciones, *Keep annotations?* al reemplazar y buscar
  en sus textos.
  De la auditoría de la entrega 2 (`Doc_Anotar_Fotos.md`, "Correcciones de la auditoría de la entrega 2"), pendientes:
  una prueba que caiga si la condición «página sincronizada» de `PageEditor` (red, nada sin subir, nada sin bajar) que
  frena la poda se rompe (hoy, con `synced = async () => true`, la suite sigue en verde; la re-verificación lo comprobó en
  el navegador); una prueba que caiga si `PageEditor` ofrece *Annotate* sin poder editar; un marco ilegible lo pisa la primera forma
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
  `20261026120000_comentarios_archivo.sql`, **sin aplicar**: con la base vieja esperan para *Resume*); sigue donde quedó
  sin duplicar; zips rotos y hostiles avisados sin crear nada. Falta: aplicar la migración (con su prueba SQL) y a mano
  ERSO entero con el portero de verdad, Safari y el iPhone (`Doc_Exportar.md`, "Cómo quedó la entrega 3"). Sigue la 4.
  Quedó de la re-verificación de la 1b (BAJO): una foto de más de 100 MP que hay que pasar a JPEG (girada, PNG, CMYK)
  sale a 200 ppp y el aviso dice «sin conexión» (llevarla al tope de píxeles de a una y dar su motivo); sin red y sin
  miniaturas en el dispositivo las fotos salen como marcador y la ventana no lo cuenta al terminar (de antes); el tope de
  90 s cuenta la bajada entera y no el tiempo sin datos (vencer por 30 s sin recibir nada); faltan pruebas de que la
  parte siguiente no vuelve a bajar los originales; si la pestaña se cuelga en la parte N, no se puede retomar desde ahí.
  Observaciones de la re-verificación de la entrega 1: (R1) el Imprimir del menú del navegador mientras se arma el PDF
  puede llevar la vista de la página en curso: sacar `print-output` a esa vista hasta `place()`; (R2) la prueba de la
  vuelta al achicador del hilo principal no distingue la mutación: hacerlo inyectable en `workerResizer`; (R3) con
  *Comments* tildada se hace un pedido por página, en fila: medirlo contra Supabase con 300 páginas y, si pesa, pedir de
  a varias.
- **P.21 Menciones en comentarios: *@persona*** (Lega, 2026-10-02): escribir `@` en un comentario, elegir a alguien y
  que le llegue un aviso en la app; por correo cuando haya clave de Resend (C.12). **Entrega 1 programada (v0.120;
  migración `20261015120000_menciones.sql` sin aplicar):** el `@` con la lista, el pintado, la cola, la campana y el
  punto en el botón de comentarios; auditada y corregida. **Entrega 2 programada (v0.125; migración
  `20261016120000_menciones_e2.sql` sin aplicar, `schema_version` 16):** compartir desde la mención (dueño y admins que
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
  (sin aplicar; la aplica quien publica). **A2 implementada (v0.126):** *Summarize page* (*Insert at top* / *Insert
  below*), *Translate page* (*Replace page content* en su lugar o *Create translated subpage*), *Format as…* (viñetas,
  casillas, tabla, títulos) y la política del workspace en *Assistant…* para dueño y admins, con su migración
  `20261017120000_asistente_politica_ventana.sql` (sin aplicar). **La clave sincronizada, S1 implementada (v0.138,
  D72 → B, `Doc_Clave_Sincronizada.md`):** prender la copia cifrada con una frase, abrirla en otro dispositivo
  (preguntando si cambia el destino), *Update* / *Replace synced key…*, *Stop syncing* y *Sign out other devices*; su
  migración `20261023120000_clave_sincronizada.sql`, sin aplicar. **S2 implementada (v0.143, sin migración):**
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
  cuando junta varios bloques en menos (renglones a una tabla) los comentarios de los que sobran quedan sin bloque;
  *Format as… Headings* sobre un bloque Script le saca el Script sin decirlo en la vista previa. Quedó de la auditoría de A1 (chico): la barra de formato de BlockNote se dibuja encima del panel
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
  y rehacer un pegado con anotaciones después de ir y volver; sección 19). Pendientes chicos: una página con historia que estaba en la papelera durante
  el ⌘Z de un reemplazo, restaurada después, deja "Toma 1: cámara" (18.4, auditoría O1: el reemplazo tendría que quedar
  a la vez para rehacer y para deshacer; mediano); con el panel abierto y el foco puesto por programa en el editor,
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
- **P.28 (chico) La tabla del reporte en el teléfono:** en 375 px las tablas de 7 columnas del *On-Set Report* quedan muy
  angostas (una palabra por renglón); viene de antes de V4 del dictado (lo anotó su auditoría). Para mirar con el
  desplazamiento de costado de las tablas o un ancho mínimo por columna.
- **P.8 (a futuro, última prioridad) Ordenar la media por tamaño:** una lista de las fotos, videos y
  archivos del proyecto ordenados por lo que pesan, con el link a la página donde está cada uno, para
  decidir si se deja, se borra o se reemplaza. Para cuando un proyecto ocupa mucho en el Drive.

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
   (v0.127 a v0.133) ya no sirve snapshots (migración `20261025120000_compactar_prender.sql`, sin aplicar); el script de
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
   con pérdidas a 0 de 500. Ver `Doc_Colaboracion.md`. `min_app_version` subió a 0.052 al publicar. **Falta:** **evaluar `@blocknote/core/y`** (la integración nueva de BlockNote sobre y-prosemirror 2 y Yjs 14),
   que compara bloques por identidad y podría resolver parte de lo que sigue pasando cuando uno cambia el
   tipo, la sangría o la posición de un renglón mientras otro escribe en él; cambia el formato de lo guardado,
   así que pide un plan de migración y convivencia de versiones.

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
   - **Queda (informativa, O4):** en las páginas siguientes del listado de varias, el portero vuelve a comprobar las
     subcarpetas que la app ya descartó (gasta parte del tope de 36 llamados; converge, sin bucle). Arreglo posible:
     que la app mande cuáles saltear (`skip`).
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
      más (`Doc_Sincronizacion.md`, "La versión mínima y los archivos"). **Falta:** aplicar la migración (con copia
      de seguridad), publicar la v0.090 y, cuando Lega la tenga en sus dispositivos, subir `min_app_version` a
      0.090. Un HEIC que una versión anterior a v0.075 guardó sin la marca se registra tal cual al actualizar: se
      cerraría convirtiendo también, antes de registrarlo, un HEIC propio sin la marca.
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
    sigue cada instalación desde `updatefound`; archivar, borrar y restaurar proyectos también frenan. **Falta:**
    aplicar la migración, publicar y, cuando Lega tenga esta versión en sus dispositivos, subir `min_app_version` a
    ella; compartir, invitar y la papelera de archivos siguen sin versión; un workspace autohospedado necesita CORS que
    acepte `x-shotdocs-version`. Menor (auditoría, O6): si una instalación falló y después el servidor vuelve a publicar
    la misma versión que corre, *Update now* sigue diciendo que falló en vez de recargar (cualquier instalación nueva
    lo borra; no pierde nada). Ver `Doc_Sincronizacion.md`, "La versión mínima, el árbol y los comentarios" y "Volver
    después de mucho tiempo sin red".
18. **Que lo borrado no llegue a quien solo ve la página (D14). Entregas 0 y 1 hechas (v0.104), migración
    `20261010120000_privacidad_borrado.sql` aplicada e interruptor apagado.** Quien no edita baja siempre la última
    base limpia (armada por un editor, con lo borrado como hueco), con `clean_reset_seq` al compartir, invitar y mover,
    los permisos de los usos sacados de archivos, la columna `update` cerrada y la línea al compartir y la ayuda.
    **Falta para prenderlo** (antes de invitar al primer cliente de verdad): aplicar la migración, el cambio del script
    de restaurar, `min_app_version` en esta versión, la prueba de punta a punta (7) y `clean_min_version`. Después: (2)
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

20. **El esquema publicado de las pruebas (lo que quedó de B.20, v0.109).** `src/ui/fixtures/editorSchemaMain.ts` se
   regeneró desde v0.107 y `editorSchemaFixture.test.ts` avisa si queda distinto de `editorSchema.ts`. Queda: la prueba
   no ve un atributo nuevo del nodo `photo` (el fixture usa el de hoy), y nada avisa si nadie lo regenera después de
   publicar un cambio del esquema: al publicar una versión que cambia `editorSchema.ts`, regenerarlo.

21. **Hecho (v0.132): restos del deshacer de Yjs** (entrega 0 de P.26, `Doc_Deshacer.md`, sección 16). Deshacer lo
   escrito seguía lo que otro deshacer había vuelto a poner solo hasta el primer corte: dejaba restos si se había escrito
   en el medio y se llevaba texto de antes si las copias se habían juntado. Un parche a Yjs (`patches/yjs+13.6.33.patch`,
   Yjs fijo en 13.6.33) sigue la copia entera. Con texto: de 1.844 a 3.000 de 3.000 exactas y de 14 a 0 con algo de
   menos; con el editor real, de 68 de 300 con restos a 0. Borrando y deshaciendo bloques enteros no es cero: 1 de 300
   con una letra de antes de menos con el editor (antes 7) y 10 de 3.000 en un modelo de párrafos (antes 112). Quedan
   casos raros con las mismas letras en otro orden (1 de 300 con el editor; algunos los trae la parte de `redoItem` del
   parche, sin pérdida). Pendiente: reportarlo a Yjs con los casos mínimos (`Doc_Deshacer.md`, 16.1 y 16.4).
22. **La excepción del ⌘Z de Yjs con dos personas** (la encontró la auditoría de la entrega 0 de P.26; ya pasaba antes del
   parche de B.21). Con dos personas editando la misma página, a veces `UndoManager.undo()` tira `TypeError` (`reading
   'client'`) en `redoItem`, cuando la copia del padre que tiene que volver ya fue recolectada (1 de 150 con dos editores
   reales; 24 de 3.000 en un modelo de párrafos); qué deja ese ⌘Z en pantalla no está medido. **Atrapada en la línea de
   tiempo (P.26, entrega 1, v0.140):** el paso se descarta, se avisa y el ⌘Z se frena (probado simulando el error). En
   900 corridas al azar de la línea de tiempo con el editor, también 300 con otra persona escribiendo y borrando texto,
   no apareció ninguna. Falta: medirla con dos editores borrando y deshaciendo bloques enteros, y ver si se arregla con
   el parche de Yjs o se reporta (`Doc_Deshacer.md`, 16.6 y 17).
23. **Hecho (v0.152): los topes de largo de la base en la app.** Un título de más de 500 caracteres quedaba rechazado
   para siempre (`pages_title_check`). El árbol corta títulos, nombres de proyecto y claves de orden, lo que sobra del
   título va al principio de la página y lo ya rechazado vuelve a la cola cortado (`Doc_Sincronizacion.md`, "Topes de
   largo"). **Hecho (v0.153):** la reparación de un rechazo ya no depende del reloj del dispositivo (compara el
   `updated_at` que tenía la fila al rechazarse con el de ahora; un rechazo de una versión anterior, sin ese dato, deja
   el título y manda el texto entero a la página), con la prueba del renombre posterior en la cola (mutante R3), y
   rehacer las claves de orden toca solo las páginas amontonadas alrededor del hueco. Queda: si otro dispositivo movió a
   la vez una de esas, gana el último que llega (vuelve a su lugar anterior; no se pierde nada, solo el lugar). Pasa solo
   después de unas 600 páginas puestas en el mismo hueco. Arreglo completo: mandar el rehecho como una sola operación del
   servidor que no toque una hermana movida después.
24. **Un error en la consola al pegar una foto — hecho (v0.0XX).** No era al pegar sino al **copiar** (o arrastrar): el
   HTML externo de BlockNote (el foto-bloque) y el de la foto en línea ponían `sdmedia://…` en un `<img src>` creado en
   el documento vivo, y el navegador lo pide al instante. Pasaba igual en `main`. Ahora la dirección sale con
   `loading="lazy"` puesto antes del `src` (`src/ui/quietImage.ts`, con `editorSchema.ts` e `inlinePhoto.ts`): sin pedido,
   y pegar trae las mismas fotos. Pruebas en `quietImage.test.ts`, más la reproducción en Chromium (cero pedidos fallidos).
   Observaciones de su auditoría que quedan (BAJO): (O3) el `loading` del `renderHTML` de la foto en línea es defensivo y no
   tiene prueba ni efecto medido (copiar, pegar y arrastrar no pasan por ahí): probarlo con `getHTML` o sacarlo; (O4) con
   `showPreview: false` (solo llega por una importación o una fila) el HTML externo lleva el placeholder `data:image/gif…` en
   el `<a href>` y en su texto: envolver solo si `showPreview !== false`, o restituir también `href` y el texto.

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
