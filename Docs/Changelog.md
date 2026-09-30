# Changelog — LGA Shot Docs

v0.026 :

Prueba de media terminada (paso 4 del plan de workspaces). En el iPhone con Safari, un video 4K de 62 MB
del carrete subió en 20 segundos sin reintentos y se reprodujo en la app. El selector entrega el archivo
original (.mov), sin convertirlo. El plan anota los resultados de Windows y del iPhone, lo que implican
para la cola de archivos y lo que queda por revisar: el video tarda entre 5 y 9 segundos en arrancar.
[ Docs - resultados de la prueba de media ]

v0.025 :

Primera prueba de media en la computadora: Drive conectado y un video de 25,7 MB subido en 9 segundos.
El roadmap anota el pedido de Lega de que la pantalla de Google diga "LGA Shot Docs" en vez de la
dirección del portero: dirección propia para el portero, Branding completo en Google Cloud, publicar la
app y verificar la marca.
[ Docs - nombre en la pantalla de Google ]

v0.024 :

Corrección del portero: en Cloudflare cortaba cada pedido con "Illegal invocation", porque llamaba a la
función que habla con Google y con Supabase desde otro objeto. Ahora la llama como función global, con
una prueba que reproduce la regla de Cloudflare. Era lo que hacía que *Media test* dijera que no podía
llegar al portero.
[ Portero - Illegal invocation en Cloudflare ]

v0.023 :

El menú de la cuenta muestra la versión de la app al pie, así se ve enseguida si un dispositivo ya tiene
la última. Hasta ahora solo se veía en la pantalla de entrada. La app se publica de nuevo en Cloudflare
después de reconectar el repo: los cambios desde v0.020 no se habían publicado porque la conexión con
GitHub se había cortado.
[ Cuenta - versión de la app en el menú ]

v0.022 :

Portero de archivos y pantalla de prueba de media, con auditoría (paso 4 del plan de workspaces). El
portero es un Worker de Cloudflare del dueño del workspace: guarda la conexión con su Google Drive, sube
archivos por partes que se pueden retomar y los devuelve en streaming con un pase firmado, para que un
video se reproduzca sin bajarlo entero. Quién pide lo decide el Supabase del workspace, con la sesión de
cada persona. La pantalla *Media test* (menú de la cuenta) conecta Drive, sube un video o una foto con
progreso y reintentos, lo reproduce y arma un informe para copiar. Migración: dueño del workspace y
dirección del portero. Guía para publicarlo en `Doc_Portero.md`.
[ Portero - Drive, subida por partes y prueba de media ]

v0.021 :

Protecciones para lo que viene, con auditoría. Si una página trae algo que esta versión no conoce (un
bloque, una marca de texto), no se abre en el editor: se ve un aviso para actualizar y nada se borra; lo
mismo con lo que llega con la página abierta. El workspace puede pedir una versión mínima de la app para
subir contenido: una versión vieja guarda lo suyo en el dispositivo y lo sube al actualizar. Si la base
se restaura desde una copia de seguridad, cada dispositivo vuelve a subir lo que hizo después de la copia
(páginas, proyectos, contenido e imágenes), así no se pierde nada. Nueva tabla `workspace_settings`, con
su prueba de permisos.
[ Sync - guarda contra lo desconocido y restaurar copias sin perder nada ]

v0.020 :

La app ya se publica en Cloudflare con la misma dirección, y Vercel quedó dado de baja: se borra su
configuración del repo y las direcciones permitidas del login en Supabase ya no tienen las de Vercel.
Las copias de seguridad de la base corren solas cuatro veces por día desde un repo privado, cifradas. Con
esto quedan hechos los pasos 1 (menos la generación de la base) y 3 del plan de workspaces.
[ Hosting - mudanza a Cloudflare terminada ]

v0.019 :

Primeros pasos del plan de workspaces. La app queda lista para publicarse en Cloudflare en vez de
Vercel (`wrangler.jsonc`, y `_headers` para que los archivos con versión queden en caché): gratis, con
uso comercial y con la misma dirección (D-05, decidido). Vercel sigue andando hasta que el deploy nuevo
esté funcionando. El plan anota las respuestas de Lega: copias
de seguridad en un repo privado de GitHub cuatro veces por día, cifradas; carpetas de Drive por el día en
que se subió; cada archivo de la papelera se borra a los 30 días de haber entrado; nadie ve los
proyectos privados de otro, tampoco el dueño, y los de quien se va se van con él; los clientes pueden
recibir un proyecto entero, ven los nombres del equipo, y la invitación es un link que se copia.
[ Hosting - Cloudflare y respuestas del plan de workspaces ]

v0.018 :

Documentación, sin cambios en la app. Nuevo `Plan_Workspaces.md`, auditado, con todo lo que Lega fue
decidiendo: qué es un workspace (el suyo es Wanka), la primera vez que se abre la app (unirse o crear
uno con una guía y un solo comando para Supabase), roles y permisos, compartir con un cliente que entra
desde el navegador, comentarios en una tabla propia (los del editor borrarían párrafos en versiones
viejas), archivos en el Drive del dueño con un portero en Cloudflare, copia de seguridad diaria antes de
todo, sacar a alguien y la mudanza del hosting a Cloudflare. Se actualizan D-02, D-05, D-09, D-12, D-13,
D-17 y D-18, y el roadmap apunta al orden de trabajo del plan.
[ Docs - plan de workspaces, equipo, invitados y archivos ]

v0.017 :

Documentación, sin cambios en la app. Corrige la regla de v0.016: la isla no es la instalación sino el
workspace (D-18). Un workspace es de un dueño, tiene varios proyectos y su equipo; usa el Supabase y el
Drive del dueño, y los miembros ven y editan lo que se les comparta. Una sola app se conecta a varios
workspaces. La regla ahora pide además: nada global en el código ni en el dispositivo (todo por
workspace), permisos por membresías aunque haya un solo usuario, versión de la base por workspace y que
los miembros nunca reciban las claves del dueño. D-17 anota lo que Lega ya decidió: originales en el
Drive del dueño con carpetas por proyecto y fecha, videos que se reproducen en la app, carrete de media,
links de Drive como en Coda y papelera de archivos por proyecto.
[ Docs - cada workspace es una isla (D-18) ]

v0.016 :

Documentación del próximo paso, sin cambios en la app. Queda escrita la regla para todo lo que se haga:
cada instalación es una isla, con su Supabase, su hosting, su correo, su cliente de Google y el
almacenamiento de sus usuarios, y nada llega a Lega. No se implementa todavía, pero nada puede
complicarlo: nada fijo en el código, todo lo del servidor en el repo, ningún servicio central. Nueva
decisión abierta D-17: los archivos grandes (fotos, videos y PDFs de rodaje) salen de Supabase, que en
el plan gratis trae 1 GB. Entran al roadmap, antes de la fase 2, una guarda para que una versión vieja
no borre bloques nuevos y la cola de archivos grandes; también dos arreglos chicos (fotos HEIC en
Windows e imágenes copiadas entre páginas).
[ Docs - autohosteo aislado y archivos grandes (D-17) ]

v0.015 :

Editor más cómodo, con auditoría. La barra lateral se ensancha arrastrando su borde (doble clic vuelve al
ancho de fábrica). Los tooltips son propios, con el estilo de las apps LGA en Qt, y solo donde suman algo
(D-15). Nuevo texto Script para guiones: tipografía de guion y marcas de color para INT/EXT, DÍA, NOCHE y
AMANECER/ATARDECER; se elige desde "/" o la barra de formato, y Enter sigue en Script (D-14). Es un
párrafo marcado y no un bloque nuevo: la auditoría mostró que la versión anterior borraba los bloques
desconocidos de todos los dispositivos. Cada rama elige tamaño de hoja (A5, A4, A3, Carta) y la página
se ve como esa hoja. El título ya no queda cortado al cambiar de fuente o de ancho. La app en
castellano e inglés queda en el roadmap (D-16).
[ Editor - barra ajustable, tooltips, texto Script y tamaño de hoja ]

v0.014 :

Corrección del atajo del selector de proyectos. Con texto elegido en el editor, Ctrl+K (⌘K en Mac) crea
un link, pero si se apretaba apenas elegido el texto, antes de que apareciera la barra de formato, el
editor todavía no lo había tomado y se abría además el selector de proyectos encima. Ahora, con texto
elegido adentro del editor, el atajo queda siempre para el link; en cualquier otro lugar sigue abriendo
el selector. Lo detectó una prueba de punta a punta que falló una vez entre varias corridas; ahora pasa
de forma estable.
[ Proyectos - Ctrl+K con texto elegido queda para el link ]

v0.013 :

Proyectos: cada usuario tiene varios, cada uno con su propio árbol de páginas (D-12). Arriba de la barra
lateral queda el proyecto abierto, en lugar del ícono grande; un clic o Ctrl+K abre el selector, con
buscador, flechas y Enter, para cambiar de proyecto sin salir de la página, crear uno nuevo o renombrarlo.
En el teléfono sube como hoja desde abajo. Crear y renombrar van en la misma cola que las páginas, así
que funcionan sin red, y un proyecto rechazado nunca se pierde. Cada proyecto recuerda su última página.
La migración nueva deja crear proyectos solo a nombre propio; el proyecto de Lega pasó a llamarse
MGTZD. La auditoría de la fase sumó: el selector se dibuja fuera de la barra, no le gana al Ctrl+K del
editor, el árbol se pide por proyecto y un proyecto vacío rechazado se puede descartar. Quedan decididos
los links legibles para compartir (D-13).
[ Proyectos - varios por usuario y selector arriba de la barra ]

v0.012 :

Correo propio: los mails de login salen por Resend desde el dominio de Lega y traen el código de 8
dígitos, además del link. Con el código se entra desde la app instalada en el iPhone, donde el link abría
Safari y no la app. El registro queda cerrado y solo entran cuentas invitadas (D-09); un mail sin cuenta
ve el aviso de pedir una invitación. La app se publica también en un dominio propio, que quedó como
dirección del login en Supabase junto a la de Vercel. `Doc_Supabase.md` explica cómo configurar el SMTP
y las plantillas en otra instalación, y el roadmap ya no lleva el SMTP ni la decisión del registro
(D-11).
[ Login - correo propio con código y registro cerrado ]

v0.011 :

Diseño nuevo, auditado y con sus correcciones. Login con la franja de la claqueta, ícono
de anotador con claqueta en blanco y negro, paleta papel y tinta con tema oscuro y acento ámbar. El menú
de la cuenta elige tema (sistema, claro u oscuro), fuente (Default o Editorial), tamaño del texto y ancho
de página, y lo guarda en la cuenta (`user_settings`) para todos los dispositivos. En la barra lateral,
"064 | Nombre | Lugar" se ve como código y nombre si ningún código de la lista pasa de 7 caracteres, y
arriba del título aparece un encabezado con los contenedores. Los dos ajustes van por rama en
`pages.settings` y se heredan (D-10). La app tolera una base sin la migración nueva, y las migraciones
van antes de publicar.
[ Diseño - login, ícono, temas y ajustes por rama y por cuenta ]

v0.010 :

La app ya está publicada en Vercel, conectada al repo: cada push a `main` se publica solo. La dirección de
producción quedó en Supabase como *Site URL* y entre las direcciones permitidas del login, junto con las
de preview del equipo en Vercel y las locales de desarrollo, así el link del mail vuelve a la app. El
deploy sale del roadmap. Para entrar desde la app instalada en el iPhone y para invitar a otras personas
sigue faltando el servidor de correo propio, y antes hay que decidir si el registro queda abierto (D-09).
[ Deploy - la app publicada en Vercel ]

v0.009 :

Verificación final de la fase 1: la auditoría confirma que la semilla es determinística byte a byte, que
nunca se aplica sobre una página a medio bajar y que el editor no la reescribe, y da la fase por cerrada.
Se corrigen tres detalles menores que dejó: un ciclo de sincronización en curso ahora se corta entre
pasos cuando otra ventana toma el control (antes podía escribir unos milisegundos más), una página a medio
bajar en solo lectura se reabre recién cuando llega lo que falta (antes el editor se volvía a montar en
cada ciclo y la vista saltaba), y una imagen rechazada ya no deja un bloque vacío en la página.
[ Fase 1 - cierre con la verificación final ]

v0.008 :

La re-auditoría de la fase 1 encontró que la reparación de dos raíces seguía perdiendo datos: lo que un
dispositivo escribía en su raíz después de que otro la copiara se borraba en todos lados. Ahora no se
llega a eso: al abrir una página vacía se le pone una semilla, la raíz inicial escrita con un autor y un
contenido que salen del id de la página, igual en todos los dispositivos, así que Yjs ve un solo cambio y
hay una sola raíz. La reparación queda solo para páginas anteriores. Además, una página a medio bajar se
muestra en solo lectura en vez de quedar ilegible sin red, lo que sube el propio dispositivo ya no cuenta
como faltante, "Retry" descarta el envío rechazado, pegar o soltar un archivo que no es imagen avisa en vez
de romper el editor, no se puede cerrar sesión con ediciones sin guardar y se puede tomar el control de una
ventana colgada.
[ Fase 1 - semilla de la raíz y correcciones de la re-auditoría ]

v0.007 :

Cierre de la fase 1 después de la auditoría, que encontró dos fallas que perdían datos. Si dos
dispositivos empezaban la misma página sin haberse visto, el documento quedaba con dos raíces y el editor
borraba una en la edición siguiente: ahora se juntan en la misma transacción que aplica lo recibido, y
una página que el dispositivo no bajó no se abre para editar. Con dos pestañas, una podía dar por subido
lo de la otra: ahora escribe una sola (Web Locks) y lo que se sube sale de IndexedDB. Además: movimientos
simultáneos ya no arman ciclos, un error al guardar en el dispositivo queda a la vista hasta resolverse,
el contenido rechazado se marca, las fotos no frenan el texto y solo se aceptan imágenes raster.
[ Fase 1 - correcciones de la auditoría ]

v0.006 :

Documentación de la fase 1. `Doc_Supabase.md` explica la configuración del proyecto, las migraciones,
cómo aplicarlas con `npm run db:migrate`, las pruebas de permisos y los límites del login sin servidor de
correo propio. `Doc_Sincronizacion.md` describe cómo funciona hoy la sincronización sin pérdidas: el
contenido con Yjs y el vector de estado confirmado, la cola del árbol, las creaciones rechazadas que nunca
desaparecen, las imágenes y el estado visible. La sección 5 del plan queda reducida a lo que falta
(compactar en el servidor, historial de versiones), la fase 1 figura como hecha y el roadmap pasa a
arrancar por el deploy en Vercel y el SMTP. El changelog suma sus entradas arriba. Los links del editor
toman el color de la app. El README cuenta el estado y cómo levantar la app en desarrollo.
[ Fase 1 - documentación de Supabase y de la sincronización ]

v0.005 :

La app: login por email, barra lateral con el árbol (crear, renombrar, mover con arrastrar o con "Move
to…", papelera y restaurar), editor por bloques con autoguardado, estado de sincronización siempre a la
vista, vista para el teléfono y PWA instalable con íconos propios. La interfaz está en inglés. La prueba
de punta a punta contra el proyecto real encontró cinco fallas y quedaron corregidas: crear páginas con
`upsert` chocaba con la política de lectura (migración nueva), una creación rechazada hacía desaparecer la
página y su contenido, al escribir rápido las escrituras locales se encolaban y un cierre podía perder los
últimos caracteres, "Offline" aparecía ante cualquier error, y en un dispositivo nuevo la página abría
vacía y la rama no se desplegaba.
[ Fase 1 - interfaz en inglés, árbol, editor, PWA y correcciones de sincronización ]

v0.004 :

Dos features nuevas en el plan, pedidas por Lega. Formato de página real: una página puede ser libre o
tener tamaño de hoja (A5, A4, A3, Carta), heredado por rama o por espacio, y lo que se ve al editar es
lo que sale en el PDF (sección 10, fase 4). Asistente: cada usuario carga la clave de su modelo preferido
para revisar y corregir textos, dar formato y ajustar imágenes, con edits normales que se sincronizan y
se deshacen, más un servidor MCP (sección 11, fase 5). Se suman las decisiones abiertas D-06 (dónde se
guarda la clave), D-07 (cómo se expone el MCP) y D-08 (formato por defecto), y las dos features al
README. Las fases se renumeran.
[ Plan - formato de página real y asistente con clave propia ]

v0.003 :

La sincronización offline, en `src/sync/`. Cada edición se guarda primero en IndexedDB; lo pendiente se
calcula contra el vector de estado que el servidor ya confirmó, así que un cierre a mitad de camino no
pierde nada. Cada envío lleva un id propio y reintentarlo no duplica. Los cambios del árbol pasan por
una cola de salida en orden y un movimiento que arma un ciclo se rechaza sin perder la página. Las
imágenes pegadas se guardan en el dispositivo y se suben a un bucket privado de Storage con los permisos
de su página. Pruebas con un servidor en memoria: ediciones offline en dos dispositivos, respuestas
perdidas, cierre de la app, páginas creadas sin red, ciclos, papelera, compactación e imágenes.
[ Fase 1 - sincronización offline e imágenes en Storage ]

v0.002 :

Primer esquema en Supabase, en `supabase/migrations/`: espacios, páginas en árbol y los updates de
contenido en una tabla que solo agrega. Todo pasa por Row Level Security y privilegios por columna: nada
se borra desde la API, el árbol no admite ciclos ni padres de otro espacio y el contenido solo entra por
`push_page_update`, con un `seq` por página que no se saltea nada al bajar. `scripts/db-migrate.mjs`
aplica lo pendiente por la Management API y lo registra donde lo busca el CLI de Supabase. Las pruebas
de `supabase/tests/` corren con dos usuarios dentro de una transacción que se deshace, y verifican que
ninguno ve ni toca lo del otro.
[ Fase 1 - esquema de Supabase, permisos y pruebas ]

v0.001 :

Arranque del repo, todavía sin código. El `README.md` (en inglés) explica el objetivo: documentación de
VFX al estilo de Notion o Coda para la preproducción de escenas y los reportes de rodaje, con plantillas,
offline sin pérdidas, páginas compartibles por rama y autohosteo. En `Docs/` quedan el índice, el plan de
arranque (arquitectura, modelo de datos, sincronización, permisos, plantillas, fases), las decisiones
tomadas (nombre, Supabase y Vercel, editor visual, tiempo real al final) y el roadmap. Se suman la
licencia MIT, `.gitattributes` y `.editorconfig`.
[ Arranque - README, plan y documentación inicial ]
