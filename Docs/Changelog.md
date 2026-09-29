# Changelog — LGA Shot Docs

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
