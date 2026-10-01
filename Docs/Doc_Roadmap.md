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
  toque abre una hoja. Falta: la vista previa (entrega 2), la tarjeta grande en el carrete y probar a mano con
  el portero real.
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
  regla de no salir del árbol. Falta: que Lega decida `drive.readonly` (ver lo agregado a mano en Drive), probar
  la subida directa a Google con el Drive real, "Agregar a esta carpeta", la cuadrícula, la lista sin red, "Seguir"
  en Chrome y Edge, el botón "Carpeta…" del menú `/` y *Bajar todo* (entrega 2). Detalle en `Doc_Carpetas.md`,
  "Cómo quedó".
- **P.10 Liberar la copia de la app en el dispositivo** (Lega, 2026-09-30): el archivo que el usuario eligió
  nunca se toca (queda en su disco); lo que se puede liberar es la copia que la app guarda en el almacenamiento
  del navegador después de que el archivo está confirmado en el Drive (por ejemplo, un video grande subido
  desde el iPhone). Pensar cuándo (tamaño, días), qué se pierde (verlo sin red en ese dispositivo) y que la
  miniatura se queda. **Diseño en `Doc_Copias_Locales.md`** (auditado; a mano por defecto, esperando la respuesta de Lega).
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
  (v0.067).** Faltan de la 1b arrastrar la sección entera y Shift+Ctrl/⌘+↑/↓, y la 2 (para todos, Shift+clic).
- **P.12 Buscar (urgente, Lega 2026-09-30). Entrega 1 hecha (v0.051): buscar y reemplazar en la página;
  entrega 2 hecha (v0.054): buscar en el proyecto con Ctrl/⌘+K** (`Doc_Buscar.md`, "Cómo quedó (entrega 1)" y
  "(entrega 2)"). Queda para después: reemplazar en el proyecto, la papelera, todos los proyectos y los
  comentarios. Lo pedido: dos lupas. **En el proyecto:** una lupa a la izquierda del "+" de
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
  cada feature nueva suma su línea en la ayuda). Diseño y auditoría antes de implementar. **Diseño en
  `Doc_Tutorial.md`** (sin implementar; auditado; Lega ya respondió sus preguntas).
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
  teléfono el cajón sigue abierto). Lógica en `src/ui/treeNav.ts`. Falta su entrada en la ayuda (P.13).
- **P.17 Hecho (v0.079): instalar la app** (Lega, 2026-10-01). La app reconoce si está instalada; si no, ofrece
  *Install app* en el menú de la cuenta y en la pantalla de entrar, y en el teléfono un aviso que se cierra por 30
  días. La ventana muestra los pasos con dibujos para iPhone, Android y computadora, con *Install* directo donde
  el navegador lo ofrece. Ver `Doc_Instalar.md`. Falta: probarlo en un iPhone y un Android reales, su entrada en
  la ayuda (P.13, ya escrita en `Doc_Tutorial.md`), y a futuro las capturas del manifiesto (`screenshots`) y la
  pantalla de arranque del iPhone.
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
   `Doc_Hojas_PDF.md`. **Falta:** el bloque de salto de hoja (una propiedad de párrafo, para que degrade en
   una versión vieja) y probar a mano en Safari y en el iPhone.
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
   datos: un snapshot nunca borra nada hasta estar confirmado, con pruebas antes.

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
   sigue con los demás archivos. **Falta:**
   - **Probarlo en Safari de iPhone y con una red lenta de verdad.** Está probado a mano en Chromium contra
     un servidor local; el aviso de bytes que salen (`XMLHttpRequest`) puede portarse distinto en Safari,
     con HTTP/2 y a través de Cloudflare.
   - **Cerrar la vuelta de la cola como sin conexión** después de 2 o 3 trabadas seguidas de archivos
     distintos: hoy, con el portero colgado para todos, gasta un minuto por archivo. Lo mismo con Storage
     colgado para todos: de 30 a 62 s por archivo en cada vuelta, lo que tarda en vencer su miniatura.
   - **La miniatura (lo que quedó de v0.070,** `Doc_Sincronizacion.md`, "Cada consulta a la base tiene un
     tope de tiempo"**).** El tope de la subida no crece entre reintentos: una miniatura de 500 KB con
     menos de unos 8 KB/s vence siempre (agrandarlo con las fallas seguidas, como `stalledBefore` en el
     portero). Las subidas cortadas quedan sueltas y se acumulan si Storage está colgado para todos (subir
     con un `fetch` propio que acepte una señal de corte). Y `uploadFile` y `downloadFile` del bucket
     `page-files` (un workspace sin portero) siguen sin tope.
   - **Recordar el plazo que funcionó.** Detrás de un antivirus o un proxy que recibe el cuerpo de golpe,
     cada archivo vuelve a empezar con el plazo corto y se traba una o más veces antes de pasar.
   - **Casos raros en que espera o reintenta de más** (no pierden ni duplican): una pestaña tan frenada
     que el vigilante mira menos de una vez cada 90 s no corta nunca mientras dure (descontar a lo sumo uno
     o dos huecos seguidos sin movimiento); si el equipo se suspende mientras sale el cuerpo, la espera de
     la respuesta queda hasta 120 s más larga; y una subida que el portero pierde en cada vuelta reintenta
     siempre a los 10 s en vez de espaciarse (comparar contra el máximo confirmado del intento).
12. **Importar de Coda, direcciones sueltas: lo que quedó de v0.069** (`Doc_Importar_Coda.md`, "Direcciones
    sueltas"). **Falta:**
    - **Hecho (v0.071): el anclaje de un comentario** pegado a un renglón con direcciones: un último intento
      compara sin espacios (12 caracteres o más; adentro de un bloque, solo si es uno solo). Queda sin probar con un comentario real de ese tipo, y un párrafo
      partido en tarjetas todavía no se compara contra los bloques seguidos juntos.
    - **Prolijidad:** una dirección partida en dos por un cambio de formato queda como un link cortado; una
      dirección con un punto final lo lleva adentro del link; un salto de línea puede quedar adentro del
      link al final del párrafo o alrededor de una tarjeta.
    - **Verlo en la app** con una importación real: una página con muchas tarjetas de Drive.
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
    - **Hecho (v0.0XX): con red, si el decodificador no baja** se vuelve a probar a los 30 s y a los 2 min antes
      de subir el HEIC tal cual; sin red los intentos no cuentan. **Sin red, la conversión arranca enseguida**
      (no espera la consulta a la base, que tardaba unos 7 s en fallar). **La comprobación del JPEG** mira además
      los puntos que se apartan del fondo: un canvas en blanco ya no pasa con una foto casi toda blanca.
    - **Subir `min_app_version` a 0.075** cuando Lega tenga la versión en sus dispositivos: una pestaña de
      v0.074 o anterior puede registrar un HEIC mientras esta lo convierte (sospecha de la auditoría, sin
      reproducir). **Verificado (v0.0XX): no la frena.** Solo la usan `push_page_update` y el ciclo de páginas;
      `register_file`, el portero y la cola de archivos no miran la versión. Frenarla pide una migración que haga
      con `register_file` lo mismo que con `push_page_update` (`Doc_Imagenes.md`, "Pendiente").
    - **Hecho (v0.0XX): el perfil de color** es el de la imagen principal (`pitm` → `ipma` → `ipco`), en la app y
      en el comando de Coda (el mismo código, `src/media/heifColor.mjs`), y un HEIC con solo `nclx` lleva un
      Display P3 o BT.2020 estándar. HDR (`nclx` PQ o HLG) sigue sin perfil.
    - **Sin portero** (fotos a Supabase) no se convierte.
    - **Verlo en la app con el doc entero.** Probado con una importación real de cuatro páginas (46 fotos
      convertidas: en el Drive, con miniatura y a la vista); falta la de un doc completo.
    - **Los metadatos** de la foto (fecha, lugar, cámara) no pasan al JPEG: quedan en el original.
    - **De a una.** La conversión tarda alrededor de un segundo por foto; con miles, convendría en paralelo.
    - **Hecho (v0.0XX): pruebas del comando entero** (`scripts/coda-export-run.test.mjs`, contra una API de Coda
      de mentira): bajar, convertir, repetir, `--refresh`, sin la librería, `--convert-only`, un HEIC roto y un doc
      sin HEIC, con el código de salida.
    - **Probar en la app real con sesión** lo de v0.0XX (con red mala y sin red): se probó en Chromium sin sesión,
      con un banco de prueba fuera del repo.
14. **Un dispositivo nuevo muestra "Subiendo ~2750 cambios" unos 4 minutos** al abrir un proyecto grande
    ("HEIC (prueba)"), sin escrituras visibles en la base (lo vio la auditoría de v0.075). Averiguar qué
    cuenta ese número: si son cambios que de verdad suben, o lo bajado contado como pendiente.

### C. Esperan a Lega

10. **Fase 3.** Plantillas: definir con Lega los campos de *Pre-production Notes*, *On-Set Report* y
    *Shot Breakdown*.
11. **Fase 5.** Asistente con la clave de cada usuario y MCP: Lega elige entre las opciones de D-06 y D-07.
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
