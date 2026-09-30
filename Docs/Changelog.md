# Changelog — LGA Shot Docs

v0.052 :

Colapsar secciones por sus títulos (P.11, entrega 1a). Todo título tiene un triángulo a la izquierda (aparece
al pasar el mouse; colapsado se ve siempre; en pantallas táctiles, siempre y tenue): colapsar un título
esconde todo hasta el próximo título de su nivel o mayor, y los de adentro guardan su estado. Es **solo para
vos**: se guarda en el dispositivo y no cambia la página (los demás la ven igual; "para todos" con Shift+clic
llega en la entrega 2). Ctrl/⌘+Alt+Enter colapsa o abre la sección de la selección; "Colapsar todo" y "Abrir
todo" en el menú de la página. Editar al lado de lo escondido es seguro: borrar un título colapsado borra su
sección entera de una vez (también el último de la página; si la página queda vacía, queda un párrafo), con un
aviso y Ctrl+Z que trae todo; lo escondido se borra solo a propósito: con "Borrar", con el título elegido
entero (o toda la página, Ctrl+A) y borrarlo, cortarlo o pegar o escribir encima, o con una selección de texto
que cruza la sección entera (empieza arriba del título y termina después de lo escondido), y cortar lleva
justo lo que se borra; cualquier otra edición que borraría algo escondido (por ejemplo Shift+→ desde un título
colapsado y después Retroceso) no se hace y la sección se abre; juntar el título con otro bloque o borrar solo
su texto no borra lo escondido (se abre), y Supr justo arriba de un título colapsado no lo junta; mover un
título colapsado (con el tirador o Shift+Ctrl/⌘+flechas) deja ver lo que escondía hasta que mover la sección
entera llegue en la entrega 1b; Enter al final de un título colapsado crea un renglón después de la sección
sin abrirla (y Retroceso en ese renglón vuelve al título sin unirlo a lo escondido); Supr ahí no une lo
escondido; ↓ y → lo saltan; si algo que se veía fuera a quedar escondido por un cambio (propio o de otro), su
sección se abre para vos; "Ir al bloque" de los comentarios abre lo que lo esconde. Escribir en una página
grande con todo colapsado no recalcula lo escondido en cada tecla (unos pocos ms con miles de bloques), y
Enter no rearma todas las marcas. Hace falta un navegador con `:has()` en el CSS (Chrome 105, Safari e iOS
15.4, Firefox 121); en uno más viejo no aparecen los triángulos y no se esconde nada. Las marcas de hoja se
cuentan con todo abierto y el título colapsado dice qué hojas tiene adentro ("Hojas 2–4 adentro"); el PDF sale
todo abierto. Los "Encabezados plegables" de BlockNote salen del menú "/" y del selector de tipo; los que ya
existían se ven como títulos comunes. Sin tipo de bloque ni propiedad nueva, sin migración. La búsqueda en la
página (v0.051) encuentra lo que está en secciones colapsadas y, al ir a una coincidencia escondida, abre para
vos lo que la esconde; "Reemplazar todo" y su deshacer no abren nada. Retroceso al principio de un título ya
no lo pasa a párrafo: "sube la línea" como cualquier renglón (se une al de arriba; un título colapsado que se
une deja ver lo que escondía).
[ Colapsar secciones - entrega 1a ]

v0.051 :

Buscar y reemplazar en la página (P.12, primera entrega). Una lupa a la izquierda del ícono de comentarios, o
Ctrl/⌘+F, abre una barra como la del navegador que busca en el documento: sin distinguir mayúsculas ni tildes
("camara" encuentra "Cámara"), con partes de palabras, "3 de 12", Enter y Shift+Enter, *Aa* (exacto) y palabra
entera; encuentra también los pies de las fotos y los nombres de los archivos (el bloque queda con un
contorno). Un segundo Ctrl/⌘+F, con el foco en la barra, abre la búsqueda del navegador; Esc la cierra y deja
elegida la coincidencia. Quien puede editar la página despliega el reemplazo con la flecha de la barra:
*Reemplazar* (la actual y pasa a la siguiente) y *Reemplazar todo*, que se deshace con un solo Ctrl/⌘+Z (o con
*Deshacer* en la barra); conserva el formato y los links, no borra un link entero (una tarjeta de Drive sigue
andando) y no toca pies ni nombres de archivo. Si otra persona cambió la coincidencia justo antes, no se
reemplaza y se vuelve a buscar. "Reemplazar todo" escribe todo de una vez (cientos de reemplazos en una
página grande, en una fracción de segundo). Encuentra también lo que está adentro de una lista plegable cerrada
y la abre al llegar; los resaltados no se mueven cuando llegan cambios de otra persona. Lo resaltado no sale
al imprimir y no recalcula las marcas de hoja. Queda listo el enganche con las secciones colapsadas (P.11):
cuando exista, la búsqueda las abre al llegar a una coincidencia escondida.
[ Buscar y reemplazar en la página - primera entrega ]

v0.050 :

Cuánto ocupa cada proyecto en el Drive (P.7, primera entrega). El selector de proyectos lo muestra en el
renglón de cada uno ("12 páginas · 3,4 GB · editado hoy") a quien ve su papelera de archivos; el diálogo de
Google Drive (solo el dueño) da el total de lo que la app subió, lo que está además en la papelera de Drive,
el desglose (papelera de la app, todavía subiendo, proyectos que no ves), qué cuenta y qué no, y "Volver a
calcular"; la papelera de archivos muestra su total arriba, y la confirmación de vaciar dice cuánto pasa a la
papelera de Drive y que el espacio se libera recién cuando Google la vacía (30 días). Lo calcula la base
(`project_sizes`, migración nueva, versión 7) y queda guardado en el dispositivo: sin red, el último valor.
Con una base sin migrar no se muestra y nada más cambia. Los pesos se escriben con una sola regla (un decimal
por debajo de 100, sin ",0", hasta TB).
[ Peso de los proyectos - primera entrega ]

v0.049 :

Se puede adjuntar cualquier archivo: un PDF, un zip, un rar, un exe, un proyecto de Nuke… Se arrastra o se
pega en la página (varios a la vez, quedan en orden), va al Drive del dueño como las fotos, y se ve como una
tarjeta con el tipo, el nombre y el tamaño. Con el mouse, el primer clic la elige y el segundo abre el PDF (o lo
que el navegador sepa mostrar) en una pestaña nueva, o baja el archivo con su nombre; en el teléfono, un toque
abre una hoja con Abrir, Descargar y Compartir. Los adjuntos no entran al carrete ni a "Acomodar en filas", y la
papelera muestra su tipo. Antes de guardar algo grande, la app revisa que haya lugar en el dispositivo. Sin
Google Drive conectado, solo imágenes, con un aviso. No es un bloque nuevo: una versión vieja ve el archivo con
el marcador de foto y no lo borra. *Download* con un archivo del Drive (en la barra y en el carrete) ahora
siempre baja, también un PDF.
[ Adjuntos - cualquier archivo ]

v0.048 :

El portero les pone su nombre a las descargas y sirve cualquier archivo de forma segura (primera parte de
los adjuntos, `Doc_Adjuntos.md`). Un PDF, una foto, un video, un audio o un texto se muestran en el
navegador; todo lo demás (un zip, un exe, una página web) se baja siempre, nunca se abre como página. El
pase lleva el nombre del archivo (firmado, sale de la base) y `?download=1` pide la descarga. Si Google Drive
se llena o marca un archivo como peligroso, el portero lo dice con un código propio. La caché del arranque
queda solo para los videos. Los pases de antes siguen valiendo.
[ Portero - nombres y encabezados seguros ]

v0.047 :

En el teléfono, las fotos y videos en fila se ven en fila, como en la computadora, o uno debajo del otro:
lo elige cada cuenta en el menú de la cuenta (*Fotos en fila*: En fila o Apiladas; la opción aparece solo en
el teléfono). Solo cambia cómo se ven: lo guardado, la computadora y el PDF siguen igual. Por defecto, en
fila; tocar una foto la abre a pantalla completa.
[ Fotos - en el teléfono, en fila o apiladas ]

v0.046 :

Acomodar en filas: con una foto o un video elegido, un botón de su barra reparte la tanda de fotos y videos
seguidos en una o más filas del ancho de la página, con todas las de cada fila a la misma altura y sin
cambiar el orden. Elige solo cuántas filas y dónde cortar (como una galería de fotos): prefiere unas tres
por fila, nunca más de cuatro, una panorámica puede tener su fila, y la última fila no se estira de más. Se
deshace con un solo paso.
[ Fotos - acomodar en filas ]

v0.045 :

Fotos y videos en fila. La barra de una foto suma cuatro tamaños: todo el ancho, 1/2, 1/3 y 1/4 del ancho
de la página, y fotos seguidas que entran quedan una al lado de la otra (dos de 1/2, tres de 1/3, cuatro
de 1/4), igual en la computadora, el teléfono y el PDF. Los tiradores también cambian el ancho y se imantan
a esos tamaños al pasar cerca. En una fila, las flechas van de una foto a la otra y Enter escribe debajo
de la fila entera; una hoja nunca corta una fila por la mitad, y dos comentarios en la misma fila no se
tapan. No es un bloque nuevo: cada foto guarda la parte del ancho que ocupa (`rowWidth`), y una versión
vieja de la app las muestra una debajo de otra con un ancho parecido.
[ Fotos - en fila ]

v0.044 :

Con el mouse, el primer clic en una foto o un video la elige y el segundo (o un doble clic) la abre en el
carrete: antes se abría enseguida y no se podía usar su barra. La foto elegida se ve con un contorno del
color de acento y sus tiradores para cambiar el tamaño a la vista, también cuando se llega con las
flechas, con el editor con foco; la lupa aparece solo sobre la elegida. El cursor entre dos fotos seguidas
se ve como una línea del ancho de la foto.
En el teléfono y en solo lectura, un toque o un clic sigue abriendo.
[ Fotos - el primer clic elige ]

v0.043 :

El PDF corta las hojas donde las marca la pantalla. Al imprimir, las fotos del Drive se cambian por el
original si está en el dispositivo, y el original llenaba el ancho de la hoja: la foto salía más alta que
en pantalla (donde se ve con su miniatura) y la hoja se cortaba antes. Ahora cada foto va en el PDF con
el ancho que le puso la persona o, si no tiene, el de su miniatura, igual desde el teléfono o la
computadora; el original solo la hace más nítida.
[ PDF - los cortes de la pantalla ]

v0.042 :

Sale la pantalla *Media test* del menú de la cuenta: era la prueba del portero de antes de que las fotos y
los videos anduvieran en las páginas. Conectar y reconectar Drive sigue en el menú de la cuenta → *Google
Drive*. La dirección `/media-test` ahora abre la app (y si trae la vuelta de Google, muestra el resultado en
el diálogo de Drive). El portero no cambia: sigue aceptando la subida de prueba de una versión vieja.
[ Interfaz - sin Media test ]

v0.041 :

La app en castellano e inglés (roadmap B.8, D-16). Toda la interfaz pasa por un diccionario con los dos
idiomas: pantallas, menús, avisos, errores, el editor (con el diccionario de BlockNote), el carrete, los
comentarios, la papelera, miembros y compartir. El idioma se elige en el menú de la cuenta y sigue a la
cuenta en todos los dispositivos; por defecto, el del navegador. Script se llama Guion y Question,
Pregunta; lo guardado en las páginas no cambia. Los dispositivos que ya tienen la versión nueva conservan
su idioma aunque una versión vieja suba sus preferencias; uno nuevo toma el del navegador. Las páginas
legales quedan en inglés, con una nota.
[ Interfaz - castellano e inglés ]

v0.040 :

Hojas y PDF (roadmap B.7, fase 4). En una página con tamaño de hoja, el editor marca dónde empieza cada
hoja, y *Export PDF / Print* (o Ctrl/⌘+P) imprime exactamente esas hojas: el mismo cálculo sirve para la
pantalla y para el PDF, sobre una copia de la página. Un bloque que entra en una hoja no se parte; uno más
alto se parte entre renglones o filas; un título pasa a la hoja siguiente con su bloque. El PDF sale sin
barra lateral ni controles, con las fotos del dispositivo reducidas y en tema claro. Nada de esto toca el
documento.
[ Páginas - cortes de hoja y PDF ]

v0.039 :

Las últimas teclas ya no se pierden y la app abre más rápido (roadmap B.4 y B.5). La investigación del
caso intermitente encontró que recargar o cerrar la página a milisegundos de escribir podía perder lo
último: el guardado local ahora escribe en una transacción que no espera ninguna lectura y se confirma en
el acto, con una marca de "falta subir" que solo se borra si el servidor confirmó eso mismo, y una versión
vieja que abra la misma base igual ve lo pendiente. Cada consulta al servidor tiene un tope según su
tamaño y una página lenta no frena a las demás; los menús de la barra del editor ya no se cierran solos. El
editor, el carrete y los diálogos se cargan aparte: la primera carga baja de 591 KB a 276 KB (283 KB en v0.041, con los idiomas).
[ Sincronización - sin perder las últimas teclas; carga más liviana ]

v0.038 :

Sincronización más liviana y páginas legales (roadmap B.2, B.3 y B.6). Después de bajar cambios de otro
dispositivo, la siguiente subida ya no reenvía lo bajado: el vector de lo que el servidor tiene avanza
solo con lo que el servidor mandó, sin huecos, y nunca por encima de lo que el dispositivo integró; lo
propio sin confirmar sigue siempre pendiente (pruebas al azar con varios dispositivos, cortes y
restauraciones). Abrir una página vacía ya no crea un cambio: la raíz inicial queda en memoria y se guarda
junto con la primera edición, sin cambiar la semilla. Páginas `/privacy` y `/terms` en inglés, sin
iniciar sesión, para la pantalla de Google.
[ Sincronización - subir solo lo propio y páginas legales ]

v0.037 :

Links de Drive (paso 13 del plan de workspaces). Al pegar un link de Google Drive aparece un menú chico:
dejarlo como link, como texto o como tarjeta con el reproductor de Drive. La tarjeta es un párrafo con el
link y una propiedad nueva: una versión vieja de la app ve el párrafo con el link y no borra nada (prueba
con el esquema publicado). El reproductor se arma solo con ids válidos y dominios de Drive, en un marco
aislado. En Safari y el iPhone avisa que solo los archivos compartidos por link se ven ahí, con un botón
para abrirlo en Drive. Los formularios de Google quedan como link.
[ Editor - links de Drive como tarjeta ]

v0.036 :

Varios workspaces (paso 12). La app guarda una lista de workspaces en el dispositivo; Wanka entra con los
nombres de siempre y nada se renombra, aun con la lista alterada. Pantalla de bienvenida (unirse con un
link o crear uno), selector Workspace › Proyecto y cambio de workspace recargando la app, sin dos clientes
a la vez. Un link de otro workspace muestra el servidor antes de unirse. Quitar un workspace del
dispositivo pide bajar antes lo que no subió, originales incluidos. Comando `workspace:setup` que prepara
un Supabase nuevo (con modo que solo muestra, y seguros que impiden correrlo contra Wanka) y guía en
inglés para crear un workspace.
[ Workspaces - varios workspaces, comando y guía ]

v0.035 :

Papelera de archivos (paso 11). Un archivo que ninguna página viva usa entra a la papelera del proyecto;
vuelve si se lo usa de nuevo. Pestaña Archivos en la papelera con miniatura, peso y días; el dueño y los
admins lo mandan a la papelera de Drive (nunca se borra de verdad), de a uno o todos, con confirmación. El
borrado automático a los 30 días queda armado y apagado hasta que Lega lo confirme. La app solo quita un
uso con el documento completo y al día, espera los usos sin confirmar (cortar y pegar entre proyectos) y
la base ignora un aviso viejo.
[ Archivos - papelera de archivos ]

v0.034 :

Comentarios y preguntas (paso 10). Comentarios anclados a un bloque o a la página, en una tabla propia con
permisos (Comentar alcanza, aunque no se pueda editar), panel lateral en la computadora y hoja en el
teléfono, responder, editar, borrar (marca, no borra) y resolver. Funcionan sin red con su cola y nunca
se descartan solos. Preguntas: un párrafo marcado como pregunta cuya respuesta es un hilo; una versión
vieja lo ve como párrafo común. Los invitados ven los correos del equipo en los comentarios.
[ Comentarios - comentarios, preguntas y su cola sin red ]

v0.033 :

Equipo (paso 9). Los permisos pasan por miembros y permisos por proyecto o página: ver, comentar, editar,
editar y crear páginas, hacia abajo y nunca hacia arriba. Un proyecto nuevo es privado; el dueño no ve los
privados de otros. Pantalla de miembros (invitar copiando el link, cambiar rol, sacar) y diálogo de
compartir. Solo lectura real con Ver. Sacar a alguien corta el acceso al instante y, en su dispositivo,
ofrece bajar lo que no subió antes de borrar. La base niega todo a sesiones con contraseña, para que el
registro de invitados no se pueda usurpar. El registro sigue cerrado hasta que Lega lo abra.
[ Equipo - miembros, permisos, compartir e invitaciones ]

v0.032 :

Carrete (paso 7). Un toque en una foto o video abre todas las de la página a pantalla completa, en orden:
deslizar o flechas, zoom con pellizco, rueda y doble toque, video con reproducción en línea, bajar el
original y cerrar con Escape, la X, deslizando hacia abajo o con "atrás". Primero la miniatura y después
la grande; sin red, lo que está en el dispositivo. Accesible (foco atrapado y devuelto) y sin cambiar nada
de lo guardado en la página.
[ Archivos - carrete de fotos y videos ]

v0.031 :

Archivos en Drive (pasos 6 y 8). Una foto o un video pegado en una página se guarda primero en el
dispositivo y sube por partes al Drive del dueño a través del portero, retomando lo que ya llegó; sin red,
espera. En la página queda el bloque de imagen de siempre con una dirección `sdmedia://` y una miniatura
en Supabase; una versión vieja muestra una imagen rota y no borra nada. El portero pregunta los permisos
de cada archivo a la base con la sesión de la persona, arma carpetas por proyecto y día sin espacios,
verifica cada archivo con una marca en Drive y guarda el principio y el final para que el video arranque
antes. El dueño elige dónde va la carpeta con el selector de Google (si se carga la clave).
[ Archivos - cola, miniaturas y Drive ]

v0.030 :

Preparación para el equipo, sin cambios para quien ya usa la app (paso 5 del plan de workspaces). El
cliente de Supabase ya no es global: sale del workspace abierto, que tiene su clave local; la de Wanka
queda fija como texto y conserva los nombres de siempre (sesión y base local), con una prueba que lo
protege. La base suma miembros, permisos por proyecto o página e invitaciones, con sus pruebas; el dueño
entra como `owner` y las otras cuentas con proyectos como miembros con permiso completo sobre lo suyo.
El servidor ya no crea "My project" para una cuenta nueva: sin proyectos, la app lo avisa y vuelve a
preguntar sola. La app avisa si la base del workspace es más vieja que la que necesita. El repo de
copias restaura sobre el mismo proyecto y la configuración de login quedó documentada entera.
[ Workspaces - preparación: workspace en el código, miembros y permisos ]

v0.029 :

Documentación al día para seguir con el plan de workspaces. `Plan_Workspaces.md` suma la sección 11,
con cómo se hace cada paso del 5 al 13: reglas comunes (copia antes de cada migración, nada de tipos de
bloque nuevos, no tocar la base local de Wanka), la clave local por workspace, las tablas de miembros,
permisos e invitaciones, la cola de archivos con miniaturas, videos en el bloque de imagen, el hook que
abre el registro solo para invitados y la papelera de archivos. El roadmap queda en tres grupos: el
plan, lo que no espera decisiones y lo que espera a Lega. Se corrigieron README, índice, plan de
arranque, decisiones (D-05, D-17 y D-18 pasan a tomadas) y los documentos de Supabase, del portero y de
sincronización para que describan la app de hoy.
[ Docs - plan de los pasos 5 a 13 y documentación al día ]

v0.028 :

Ajustes del portero después de la auditoría: si Drive falla un momento al revisar una carpeta, la subida
se corta con un error en vez de crear otra carpeta repetida. Pruebas nuevas: renombra también la carpeta
de prueba y no crea carpetas de más. Docs más claros sobre dónde va la carpeta hasta el paso 8 (la raíz)
y qué pide el selector de carpetas de Google.
[ Portero - carpetas, ajustes de la auditoría ]

v0.027 :

Las carpetas de Drive ya no llevan espacios: la de la app se llama `LGA_ShotDocs`, igual que el repo, y
la de prueba `Media_Test`. El portero renombra solo las que se crearon con el nombre viejo, salvo que el
dueño les haya puesto otro nombre a mano, con una prueba nueva. El plan de workspaces anota la regla
(nunca espacios en nombres de carpeta, siempre guiones bajos) y que el dueño va a elegir dónde va la
carpeta de la app (la raíz u otra carpeta suya) al conectar Drive, en vez de que la app la ponga en la
raíz sin preguntar.
[ Portero - carpetas sin espacios ]

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
