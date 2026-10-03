# Changelog — LGA Shot Docs

v0.0XX :

**Prueba inestable de las novedades.** La suite completa dejaba a veces un error sin atender (`InvalidStateError` de la
base de pruebas, en `unsyncedPages`) que Vitest atribuía a «no suma entradas al historial del navegador». Causa: el
motor de sincronización cuenta lo pendiente (`refreshCounts`) esperando las escrituras locales; si en ese rato se hace
`stop()` y se cierra la base (cerrar sesión, cambiar de workspace), el conteo seguía y chocaba con la base cerrada,
y desde `poke()` nadie atendía el rechazo. Ahora un motor detenido no cuenta nada, ni antes ni después de consultar la
base (un error con el motor andando se sigue viendo), y la prueba espera el cierre del motor. Prueba nueva en
`engineStop.test.ts` que lo reproduce siempre.
[ Prueba inestable de las novedades - un motor detenido ya no cuenta lo pendiente contra la base cerrada, y la prueba espera su cierre ]

v0.163 :

**La barra de formato con los tooltips de la app (D226, B.25a y B.25c).** Los botones propios de BlockNote en la barra
(*Bold*, *Italic*, *Underline*, *Strike*, alinear, *Colors*, *Nest*, *Link*) seguían con su globo: el nombre arriba y el
atajo escrito por BlockNote abajo, fuera del formato y del registro. No se podía cambiar botón por botón sin rehacerlos.
Ahora la barra le da a BlockNote su propio botón (`toolbarTips.tsx`, por el contexto de componentes): cada uno conserva
lo que hace, marcado y apagado, y su tooltip es `data-tip` con «**⌘B**: bold» y el atajo del registro, o solo el nombre
si no tiene atajo; en pantallas táctiles, sin atajos. Una prueba con la barra real comprueba que el globo de BlockNote
ya no aparece. Además, una prueba del anotador en una ventana angosta con mouse: conserva los atajos.
[ Barra de formato con los tooltips de la app - los botones de BlockNote con un renglón «atajo: acción» del registro o su nombre, sin su globo, y la prueba del anotador angosto con mouse ]

v0.162 :

**Una sola papelera** (pedido de Lega). Había dos: *Trash* abajo de la barra lateral (páginas y archivos) y *Deleted
projects* en el selector de proyectos, y no se entendía cuál era cuál. Ahora *Trash* está solo en el selector, en el
lugar de *Deleted projects*: proyectos, páginas y archivos juntos, del más nuevo al más viejo, cada uno con su
proyecto, con el filtro *All / Projects / Pages / Files* y *This project / All projects* (los proyectos borrados se ven
siempre). Cada tipo hace lo de antes (*Restore*, mandar a Drive, *Restore without its files*; *Empty*, solo del
proyecto abierto y nombrándolo) y cada uno ve lo que la base le dejaba ver: sin migración. Sin red, las páginas. `/trash` abre el selector en la papelera. Ayuda,
recorrida y textos que decían *Deleted projects*, al día.
[ Una sola papelera - Trash pasa al selector de proyectos con proyectos, páginas y archivos juntos, el filtro All Projects Pages Files y este proyecto o todos ]

v0.161 :

**Contraste del texto y el panel de la cuenta.** El texto del documento era todo del mismo tono, y el panel de la cuenta
ya no entraba en una ventana baja: su tope era la ventana entera y la cabecera quedaba afuera por arriba. Ahora
*Contrast* (de fábrica) da tres tonos al texto con el color por defecto: encabezados como siempre, negrita un poco más
suave y texto común un poco más; *More contrast* lo marca más y *No contrast* deja todo como antes. Son tokens por
modo y nivel, todos de 4,5:1 o más (`Doc_Contraste.md`); un color elegido, un resaltado y la cita no cambian. Vale en
la página, el historial y el PDF, en claro. El panel se recorre adentro con el alto que queda, *Appearance*, *Font* («Fuente») y *Contrast* son solo
íconos con su nombre en el tooltip, y *Sign out other devices* va a la izquierda.
[ Contraste del texto - Contrast de fábrica, More contrast y No contrast para encabezados, negrita y texto común, en la página, el historial y el PDF; el panel de la cuenta con íconos y su propio desplazamiento ]

v0.160 :

**Teléfono pulido: cuatro chicos.** (1) El punto de novedades del "?" solo se veía con el cajón abierto; ahora también
está en el botón de menú de la barra de arriba (la de la página y la de la práctica), con la misma regla (`useHelpDot`,
componente `NavMenuButton`, con su nombre accesible), y la ayuda lo dice. (2) El botón de comentar del margen salía 4 px de la
pantalla (`right: -4px`) y la página se arrastraba 4 px de costado; ahora `right: 0`. (3) El piso de 96 px por columna de
las tablas valía hasta 760 px; en un iPad vertical el reporte seguía en 47 px por columna: ahora vale hasta 1024 px, solo
para las tablas de páginas sin hoja (una hoja A4 queda como el PDF; la compu tampoco cambia). (4) Un clic con el mouse en el triángulo o en la fila dejaba ⋯ y + a la
vista por `:focus-within`; ahora es `:focus-visible`, que solo es el teclado.
[ Teléfono pulido - el punto de novedades también en el botón de menú, el botón de comentar adentro de la pantalla, el piso de las columnas de la tabla hasta 1024 px (tablet vertical) y ⋯ y + del árbol solo con foco de teclado ]

v0.159 :

**Restos de dos auditorías, solo pruebas y un ajuste.** (1) Claves de orden (B.23): si el objetivo de la ventana de
rehacer pasaba de 64 a 128 caracteres, ninguna prueba fallaba; ahora una barre las profundidades de 40 a 120 (incluido el
borde 64/65) y exige claves de 64 o menos sin rehacer de más. No había error de lógica. (2) Una foto sin vista previa
(llega por una importación o una fila) salía en el HTML externo con la imagen mínima `data:image/gif…` en el vínculo y
en su texto; ahora sale con su `sdmedia://` y su nombre, como el original de BlockNote. (3) El `loading` del
`renderHTML` de la foto en línea se queda: sin él, arrastrar un párrafo por el tirador vuelve a dejar
`ERR_UNKNOWN_URL_SCHEME` (BlockNote relee ese HTML con `innerHTML` en la página viva). Ahora lo exigen dos pruebas, una
por la ruta del arrastre.
[ Restos de B.23 y B.24 - la prueba que fija la ventana de claves en 64, la foto sin vista previa sin la imagen mínima en el HTML externo y la prueba del loading de la foto en línea al arrastrar ]

v0.158 :

**Ayuda, entrega 3: "Mostrame" y novedades** (P.13). La ayuda explicaba cada función pero no la señalaba, y nada
avisaba qué había de nuevo. Ahora las entradas con un paso de la recorrida (16) tienen *Show me*: abre la práctica con
solo ese paso y *Done* o Esc vuelve a donde estabas (con el desplazamiento y la selección de antes, sin sumar
entradas al historial), sin tocar la recorrida guardada. El "?" lleva un punto cuando una
entrada tiene un `since` más nuevo que lo visto la última vez (en este dispositivo); al abrir la ayuda, *What's new*
las lista arriba con la marca *New* y el punto se va. Nuevas entradas: *What's new*, *Show me* y *Connect Google
Drive* (el dueño); deshacer, el título y buscar suben a la versión que los cambió. Arreglo: un paso podía quedar
invisible si se abría en el mismo cambio en que se cerraba un diálogo.
[ Ayuda entrega 3 - Mostrame abre la práctica con solo el paso de cada entrada y vuelve a donde estabas, y el punto del ? con las novedades desde la última vez que abriste la ayuda ]

v0.157 :

**Link público, entrega 2c: lo apartado a la vista** (P.19). Lo que un visitante mandó y no entró solo se veía en un
aviso de la página y un número en *Share*, y quien tenía algo apartado seguía escribiendo sin que llegara nada (D235).
Ahora *Share* lista lo apartado de los links de la página (también de los anteriores) con quién, cuándo, dónde y por
qué, y lo baja; el árbol marca la página y el historial lo muestra como *Set aside (via link)*, sin aplicarlo. El
visitante baja su copia y vuelve a la versión del equipo, solo con red y si nada cambió en el medio; lo de antes queda
además en el navegador. También: la admisión ordena por dispositivo (una versión inventada traba solo el suyo, O3), la
pantalla de link muerto recuerda lo mandado (O9) y una página ya honda admite lo que no la ahonda (R1). Migración
`20261029120000_link_apartado.sql`, sin aplicar (`schema_version` 20).
[ Link público entrega 2c - lo apartado en Share, el historial y el árbol, volver a la versión del equipo sin perder nada, el orden de la admisión por dispositivo, lo mandado recordado y la página ya honda ]

v0.156 :

**Tooltips con gesto o atajo (D226).** Cada tooltip nombraba sus atajos y gestos a su manera («Keyboard: R», «Close
(Esc)», un ⌘K suelto, «Supr o Retroceso» escrito a mano) y usaba la negrita para cualquier cosa. Ahora van en
renglones «**gesto o atajo**: acción», como el triángulo de colapsar, también *Comment* y *Assistant* de la barra de
formato; la negrita es solo del gesto o el atajo. Los arma `tipRows.ts` con los atajos del registro (⌘ en la Mac, Ctrl
en el resto); en una pantalla táctil (por el puntero, no por el ancho), sin atajos ni gestos de mouse. Suma Enter en el
campo de reemplazar. El globo del borde de la barra lateral quedaba afuera de la pantalla: ahora todo globo queda
adentro. Una prueba recorre los tooltips de la app y falla si alguno nombra un gesto o una tecla, o usa negrita, por
fuera de ese formato.

**La tabla del reporte en el teléfono (P.28).** En 375 px las tablas de 7 columnas del *On-Set Report* se encogían al
ancho de la pantalla: 304 px, columnas de 42 px (una palabra por renglón) y miniaturas de 21 px. La causa: BlockNote
deja el ancho de la tabla en `auto` y el navegador la achica a lo que cabe en su bloque, sin mirar los anchos
guardados. Ahora, solo en pantalla angosta y solo en la página abierta, ninguna columna con ancho guardado baja de 96
px y la tabla se desplaza de costado dentro de su bloque sin mover la página; la que entra en la pantalla con columnas
de 96 px o más no cambia. Al pasar de celda con Tab o las flechas, la celda se acomoda entera a la vista. Es solo
presentación: nada nuevo en el documento. La compu, la vista de impresión y el PDF miden igual que antes. Ayuda: *Wide
tables on a phone*. Medido en Chromium (375 y 1280 px): 39 de 39.

[ Tooltips con gesto o atajo (D226) y la tabla del reporte en el teléfono - un renglón por acción «gesto o atajo: acción» con los atajos del registro, negrita solo para el gesto o el atajo y el globo siempre adentro de la ventana; en el teléfono ninguna columna de tabla baja de 96 px y la tabla se desplaza de costado ]

v0.155 :

**Tres restos de tandas anteriores.** (1) Copiar o arrastrar una foto del Drive dejaba `net::ERR_UNKNOWN_URL_SCHEME` en la
consola (B.24): el HTML que arma BlockNote para el portapapeles ponía el `sdmedia://…` en un `<img>`, y el navegador
intenta pedirlo apenas se le da un `src`. Ahora la dirección sale escrita pero con `loading="lazy"` puesto antes
(`quietImage.ts`): no se pide, y el pegado lee lo mismo; un editor sin `resolveFileUrl` tampoco la pone en la foto en
línea. (2) Prueba de la pregunta al cerrar la pantalla de error con un reemplazo del proyecto en curso (R1 de la barrera).
(3) Restaurar sin el editor reescribía todos los bloques con sus atributos por defecto aunque no hubieran cambiado
(R2): ahora los bloques ya iguales a la versión se saltean (465 a 184 bytes en un caso de 3 bloques), como hace el editor; un bloque con algo que el esquema no conoce se reescribe igual, para que limpiarlo no falle.

[B.24 sin pedir sdmedia al copiar, R1 y R2 de la barrera: restaurar sin editor solo reescribe lo que cambia]

v0.154 :

**El nombre en el árbol usa todo el ancho de la fila** (D233). Un nombre largo se cortaba con «…» antes del borde
aunque no pasaras el mouse: la fila reservaba siempre el lugar de ⋯ y +, que solo se ven con hover. Ahora esos
botones no ocupan lugar mientras no se ven (ancho cero, no solo transparentes) y el nombre llega hasta el borde. Con
el mouse encima, el foco del teclado en la fila o en sus botones, o el menú ⋯ abierto (la fila lleva `menu-open`),
aparecen y el nombre se acorta como antes, sin mover su inicio ni el alto. También en la página abierta: en la compu
llega al borde como las demás; en el teléfono (sin hover) sigue con los botones a la vista, igual que hoy. Renombrando,
el campo usa todo el ancho; la marca offline y el punto de menciones siguen reservando su lugar. Solo CSS y una clase por estado. Pruebas: el cascado real de la fila en jsdom y la
medición en Chromium (sin hover, hover, foco, menú, renombrar y teléfono).
[ Árbol ancho - el nombre de la página usa todo el ancho de la fila hasta el borde y se acorta solo con el mouse encima, el foco o el menú ⋯ abierto, para dejar lugar a ⋯ y + ]

v0.153 :

**Título largo: el reloj del dispositivo ya no decide.** Reparar un título rechazado por el largo podía pisar uno puesto
a mano después si el reloj del dispositivo iba adelantado: se comparaba el `updated_at` del servidor con la hora del
dispositivo. Ahora, al rechazarse, se guarda el `updated_at` que tenía la fila y la reparación mira si sigue siendo el
mismo (reloj del servidor contra reloj del servidor). Un rechazo que guardó una versión anterior, sin ese dato, deja el
título como está y manda el texto largo entero a la página. Probado con el reloj adelantado y atrasado horas, con la
cola de v0.152 y con un renombre que espera en la cola de una app desactualizada. Además, rehacer las claves de orden
toca solo las páginas amontonadas en el hueco, no todas las hermanas.
[ Título largo - la reparación de un rechazo compara contra cómo estaba la fila en el servidor y no contra el reloj del dispositivo; las claves de orden se rehacen solo alrededor del hueco ]

v0.152 :

**Deshacer en orden, entrega 3: anotar una foto es un paso** (P.26): ⌘Z en la página salteaba lo anotado. Ahora, al
cerrar el anotador, lo de esa vez entra en la línea de tiempo: ⌘Z lo deshace entero en su orden (si la foto está en
otra página, te lleva y la muestra) y ⌘⇧Z lo rehace. Lo de otra persona en la misma foto queda, también sin red:
deshacer no borra una forma tuya que ella cambió ni el marco de la foto. Además: *Show* en el aviso de deshacer un
reemplazo con lugares cambiados, el foco del panel después de *Undo*, rehacer un pegado con anotaciones después de ir
y volver (traía la foto sin flechas) y el tooltip del triángulo de colapsar, un renglón por acción con su atajo (D226).

**Título largo.** Un título de más de 500 caracteres (uno pegado) quedaba rechazado por el servidor para siempre
(`pages_title_check`) y *Retry* volvía a fallar: el título de la página no tenía tope. Ahora todo lo que escribe un
título pasa por el árbol, que lo corta en 500 caracteres de la base (puntos de código, sin partir un emoji ni una
palabra) y anota lo que sobra en la misma transacción; eso queda como primer párrafo de la página, con aviso. En el
título, teclear pasado el tope no entra. Lo rechazado por el largo vuelve a la cola cortado, salvo que el título haya
cambiado después: entonces queda el nuevo y el texto largo va a la página. Una página nueva con título largo recibe
igual su contenido. Topes nuevos: nombre de proyecto (200), clave de orden (128) y cortes sin medio emoji en
comentarios importados y menciones. El servidor falso aplica los mismos `check`.
[ Deshacer en orden entrega 3 - anotar una foto como un paso de ⌘Z y ⌘⇧Z sin llevarse lo de otra persona, Show en el aviso del reemplazo, rehacer un pegado con anotaciones y el tooltip de colapsar · Título largo - el título se corta en 500 caracteres y lo que sobra va al principio de la página; lo ya rechazado vuelve a la cola cortado ]

v0.151 :

**Link público, entrega 2a: *Can edit*** (P.19). Un link solo podía ver y comentar. Escribir directo en la página no
era seguro: una fila rota de alguien sin cuenta podía colarse en una copia resumida o trabar el editor del equipo. Ahora
lo que escribe el visitante espera en una sala (`public_link_updates`, migración sin aplicar, `schema_version` 19, con
topes por bytes); el dispositivo de un editor lo prueba en ocho pasos (también la forma, dónde va cada nodo, topes a los
números y a la profundidad) y la base lo mueve a la página o lo aparta sin perder nada. *Share* ofrece *Can edit* con sus
números, la página avisa lo apartado con *Download it*, el historial muestra *Ana (via link)* y el visitante pone su
nombre y ve *Sent, waiting for the team*. El interruptor queda apagado hasta la barrera de error del editor.
[ Link Can edit 2a - la sala de espera, la admisión por un editor, Share con Can edit y el visitante que escribe ]

v0.150 :

**Dictado, entrega V4** (P.27, `Doc_Dictado.md` sección 18). Dictar varias notas del mismo plano obligaba a nombrarlo
cada vez, una corrección no sabía qué corregir y el lente quedaba solo en el reporte. Ahora la hoja tiene el plano
activo (*Shot: 12_010 ▾*), fijo entre notas y puesto solo con lo aplicado; «no, era un 35» lleva lo reciente con la
dirección de ahora y corrige el último cambio del mismo campo; la vista previa ofrece, destildado, escribir el lente en la ficha de la
página *Shot Breakdown* del plano, solo si está vacía o era la copia del reporte, con su guarda y *Undo*; quien solo
comenta tiene *Add as comment*; y `/dictate#<texto>` abre la hoja con el texto de un Atajo de iOS sin mandar nada.
Además: Esc en *Assistant…* y *Voice* cierra solo esa ventana, el doble toque se frena solo con un clic en *Apply*,
la hoja guarda al cerrarse lo escrito en los últimos 250 ms (antes se perdía) y la prueba de `clearVoiceFromCopy`.
[ Dictado V4 - plano activo, correcciones encadenadas, la ficha del plano, Add as comment, /dictate y restos del asistente ]

v0.149 :

**Carpetas, entrega 4** (restos de B.11). Tres cosas hacían esperar de más sin perder nada. La cola de una carpeta no
escuchaba la vuelta de la red y *Resume* arrancaba con una espera más larga: ahora el motor le avisa como a los
sueltos y *Resume*, *Retry* y volver a soltarla ponen la cuenta en cero. En *Download all*, más de un minuto entre
páginas con 36 subcarpetas o más daba `409` y la app listaba de a una: con `partial`, el portero devuelve en `later`
las que no entran y en `failed` las que salieron del árbol. Y una parte a la que Drive no le contestaba al portero
esperaba el plazo de la app (hasta 10 minutos y medio): el portero, que ya leyó la parte, contesta `504 stalled` a
los 90 s (`?stall=1`) y la app la toma como trabada, en las dos colas. Ayuda actualizada.
[ Carpetas entrega 4 - la cola escucha la vuelta de la red, Resume vuelve a cero, el listado sin 409 entre páginas y Drive colgado cuenta como trabada a los 90 s ]

v0.148 :

MCP, pasos reales 1 a 5 (P.24). Para prender el MCP faltaba lo de código: con el servidor OAuth prendido, el token de
un asistente valdría como una sesión de la app y no había pantalla de permiso. La migración
`20261027120000_mcp_plan_b.sql` (sin aplicar) suma el pre-request de PostgREST: con `client_id` solo pasa
`/rpc/mcp_*`; sin él sale enseguida, sin nada que pueda fallar. Storage pide `client_id` nulo y llega `mcp_ping`.
La app suma `/oauth/consent/<ref>`: elige el workspace por el ref, pide entrar con el código, muestra quién pide,
adónde vuelve y qué pide, y contesta *Allow* o *Deny*. El portero publica `MCP_M0=1` desde su jsonc. El hook de
contraseñas, probado en rollback con eventos de la forma real: no necesitó cambios. Ayuda nueva.
[ MCP pasos 1 a 5 - plan B en la base, pantalla de permiso de un asistente y el MCP del portero prendido ]

v0.147 :

**Barrera de error** (B3 del link *Can edit*). Si el editor tiraba una excepción al dibujar una página (una forma que
nadie previó; la auditoría del link encontró tres: un `Y.Map` en un párrafo y el `level` de un encabezado como objeto
o `'x y'`), React desmontaba todo y la app quedaba en blanco. Ahora falla solo la página: *This page can't be shown
right now*, con *Version history* para quien lo ve (restaura sobre el documento, sin abrir el editor) y *Try again*; el
árbol y el resto siguen. Lo que se escape muestra *Something went wrong* con *Reload* y cuántos cambios faltan subir,
con la sincronización viva. Nada se reintenta solo ni se borra; el id de la página y el error van a la consola. Ayuda
actualizada.
[ Barrera de error - la página que hace tirar al editor muestra un aviso con el historial a mano y la app muestra Reload en vez de blanco ]

v0.146 :

**Asistente, entrega A3: *Suggest caption*** (P.24): el asistente no miraba fotos. Ahora la barra de una foto (en
línea, en una celda o foto-bloque) y el panel suman *Suggest caption*: primero pregunta *Send this photo to
<proveedor>?* (nada sale sin el sí), arma en el dispositivo un JPEG de 1024 px como mucho (sin EXIF ni GPS; nunca el
original) y se lo manda con la clave de la persona, sin nada más de la página. La vista previa es un campo que se
retoca; *Apply* lo agrega como texto común debajo de la foto (en una celda, en un renglón nuevo de la misma celda), un
solo Ctrl+Z, sin propiedades nuevas en el esquema. Si la foto se borró o se reemplazó mientras pensaba, no aplica.
Cambiar de proveedor en los ajustes vuelve a preguntar. Respeta la política del workspace y pide Editar. La
política de privacidad ahora dice qué manda el asistente y a quién. Ayuda nueva.
[ Pie de foto A3 - sugerir el pie mirando la foto, con aviso antes de mandarla, achicada en el dispositivo y aplicado como texto debajo ]

v0.145 :

MCP, prueba técnica M0 (P.24). Faltaba saber si el portero puede ser el servidor MCP: nada estaba probado. El portero
suma `/mcp` y su metadata detrás de la variable `MCP_M0` (apagada: hace lo de antes). Valida el token del servidor
OAuth de Supabase sin pedidos a la base (ES256 con el JWKS, `client_id` obligatorio), habla la especificación
2026-07-28 y las anteriores sin sesiones, y deja listo el estado firmado para confirmar con *elicitation*. Las
herramientas de lectura llaman a funciones `mcp_*` que llegan en M1. El token de un asistente ya no sirve en las demás
rutas, prendido o apagado. Medido: validar 0,4 ms; leer una página de 16 KB, 8,5 ms en frío. Los pasos con Supabase y
Cloudflare reales quedan en `Doc_Asistente.md`.
[ MCP M0 - servidor MCP de prueba en el portero, apagado de fábrica, y rechazo de tokens de asistentes fuera de /mcp ]

v0.144 :

Deshacer en orden (P.26), entrega 2. El reemplazo en todo el proyecto no estaba en ⌘Z: solo se deshacía con *Undo*
del aviso o del panel, sin rehacer, y deshacer después lo escrito antes dejaba texto de más ("Toma 1: cámara" en vez de
"Toma 1: "), porque las anclas escriben letras nuevas que la pila de la página no conoce. Ahora el reemplazo es un paso
de la línea de tiempo: ⌘Z lo deshace en todas sus páginas sin moverte y ⌘⇧Z lo rehace (`planRedo`). En las páginas
editadas en la sesión entra en la pila de Yjs de la página, así lo de antes sale exacto, también desde el *Undo* del
panel fuera de orden (C1). Recién reemplazado, ⌘Z en el panel lo deshace (DH9). Deshacer un borrado por las anclas
sigue al vecino que volvió con un deshacer.
[ Deshacer en orden entrega 2 - el reemplazo en todo el proyecto como un paso de ⌘Z y ⌘⇧Z, exacto en las páginas editadas ]

v0.143 :

La clave del asistente sincronizada, entrega S2 (P.24, `Doc_Clave_Sincronizada.md`). Faltaba cambiar la frase, abrir
la copia en una computadora prestada sin guardarla, sincronizar en un segundo workspace y llevar la clave de *Voice*; un
dispositivo aceptaba una copia más vieja repuesta en la base, y con la copia cambiada en otro ofrecía *Choose a new
passphrase…*, que la pisaba con la clave vieja. Ahora: *Change passphrase…* vuelve a cifrar la copia (abriéndola antes);
*Keep the key on this device* destildada deja la clave solo en la pestaña; el `savedAt` del sobre rechaza una copia más
vieja; *Also sync in this workspace…*; la clave de *Voice* viaja en el mismo sobre; el error de clave rechazada suma
*Enter your passphrase to update it here*; la ventana de salir cuenta las notas de voz. Sin migración.
[ Clave sincronizada S2 - cambiar la frase, solo en esta pestaña, copia más vieja, otros workspaces, la clave de Voice y las notas de voz al salir ]

v0.142 :

Carpetas, entrega 3, y subidas que se traban (P.9, B.11). Con el portero colgado, cada archivo de una carpeta gastaba
sus 5 intentos y quedaba con error: ahora una trabada no gasta intentos y, a la segunda, la cola de la carpeta espera
(10 s, 20 s… hasta 10 minutos), como la de los sueltos, que mientras espera registra los archivos nuevos y sube sus
miniaturas. La bajada de `page-files` se corta a los 30 s sin recibir nada (antes, 27 minutos) y sus pasadas esperan
tras cerrar por Storage colgado. En el portero, el 403 de Drive por límite de pedidos sale como `rate` (no «fuera del
árbol»), la confianza de 60 s vale también en las páginas siguientes, el ZWJ va como escape y la marca de cada
subcarpeta va en NFC, buscando también las anteriores; retomar compara rutas sin la forma de los acentos.
[ Carpetas entrega 3 y subidas que se traban - la cola de una carpeta cierra la vuelta con el portero colgado, registrar y miniaturas mientras la cola espera, page-files con tope por quietud, 403 por límite como rate y marcas en NFC ]

v0.141 :

Exportar, entrega 3: volver a Shot Docs desde el zip. El zip guardaba lo necesario para volver, pero nada lo leía.
*Import Shot Docs archive…* (selector de proyectos, dueño y admins) lee el zip por partes (`zipReader.ts`: CRC, Zip64,
*deflate*, rechaza `..` y rutas absolutas) y crea siempre un proyecto nuevo: el árbol en orden, ajustes de hoja, marcas
de plantilla con los ids nuevos, los bloques del JSON revisados contra el esquema (`archiveBlocks.ts`), el colapsado
para todos, las anotaciones (el zip ahora las exporta) y los archivos por `media.add`; sin original, la vista JPEG de
la foto o su nombre. Los comentarios vuelven con `import_comment` e ids derivados del proyecto nuevo, a nombre de quien
importa solo si exportó él; piden la migración `20261026120000_comentarios_archivo.sql` (aplicada, versión 18). Si
se corta, sigue sin duplicar.
[ Exportar 3 - volver a Shot Docs desde el zip como proyecto nuevo, con anotaciones, plantillas y comentarios ]

v0.140 :

Deshacer en el orden en que editaste (P.26), entrega 1. La pila de ⌘Z de cada página moría al cambiar de página: el
editor se desmontaba y y-prosemirror destruía su `UndoManager`. Ahora una línea de tiempo por proyecto y pestaña
(`undoTimeline.ts`) guarda las listas de Yjs al irse, retiene el documento (`docs.open`) y se las pasa al editor nuevo
sin parchear y-prosemirror. ⌘Z y ⌘⇧Z (`undoTimelineUi.ts`)
siguen el orden entre páginas: si lo último fue en otra, la app va ahí, lo deshace a la vista y avisa con *Back*. Un paso
por vez, la excepción de Yjs con dos personas atrapada (B.22), topes de 20 páginas y 1000 pasos. Deshacer un renglón
propio ya no borra lo que otro escribió adentro (pasaba también antes). El reemplazo sigue igual (entrega 2).

Copias locales, entrega 2 (P.10, D-25). Las fotos y los videos agregados en un dispositivo ocupaban lugar para siempre:
la entrega 1 no los liberaba. Ahora *Free up* (aviso del tope, *Storage on this device* o un archivo nuevo que no
entró) los libera con el sí de la persona, con red y un portero con `/verify`, subidos hace 14 días o más, sin marca
que los pida y con la base y Drive confirmando el mismo archivo (id, peso, marca y MD5). `freeOwn`, la única que borra
un original, repite todo en su transacción; queda la miniatura y lo que no se libera se dice con su motivo. Si una
restauración lo vuelve a la cola, se enlaza sin bytes: el portero lo busca por la marca `sdFile` (también antes de
abrir una subida, que sigue igual si la búsqueda falla). Hacer lugar sin preguntar nunca toca un original.
[ Deshacer en orden entrega 1 y copias locales entrega 2 - ⌘Z y ⌘⇧Z entre páginas, y liberar los originales agregados en el dispositivo con Drive confirmado ]

v0.139 :

**Dictar al reporte, entregas V2 y V3** (P.27): sin red, *Save for later* solo dejaba la nota en el borrador de su
página, y el único micrófono era el del teclado, que obliga a tocar un campo. V2: *Save for later* pasa la nota a una
cola del dispositivo (`shotdocs-dictation`, sin subir su versión) y vacía el campo recién con la escritura confirmada;
el indicador de sincronización suma *N voice notes to place* con la lista, y la hoja las ubica de a una con su vista
previa o las pega como texto. Nunca se borra sola. V3: un botón de 72 px graba pedazos de 1 s en la cola (*Recording*
recién con el primero guardado; `ended` y `pagehide` cortan y guardan), con nivel, tope de 2 minutos y pantalla
despierta; transcribe con OpenAI, Gemini o un compatible (WebM primero, plan B a WAV) y ubica. *Voice* usa la clave del
asistente o una segunda cifrada; *Insert at cursor*; micrófono en *Ask…*.
[ Dictar al reporte V2 y V3 - la cola sin red y el micrófono propio: grabar por pedazos, transcribir con la clave de la persona e insertar donde se escribía ]

v0.138 :

La clave del asistente sincronizada, entrega S1 (P.24, D72 → B, `Doc_Clave_Sincronizada.md`). La clave había que
pegarla en cada dispositivo. Ahora *Assistant…* → *Turn on sync…* la cifra en el dispositivo con una frase de seis
palabras de la lista de la EFF (PBKDF2-SHA256 de 1 000 000 de vueltas y AES-256-GCM, relleno a 1 KB) y sube solo el
bloque cifrado a `assistant_key_sync`, que con RLS lee solo la persona (migración `20261023120000_clave_sincronizada.sql`,
aplicada, no sube `schema_version`). Otro dispositivo la abre con la frase, viendo a dónde va; si cambia el destino o la
clave del dispositivo es otra, pregunta, y si la copia cambió en otro dispositivo, pide la frase de nuevo. *Update* y *Replace synced key…* abren antes la copia; *Stop syncing* la borra. Nuevo *Sign out other devices*
en el menú de la cuenta. La base del dispositivo sigue en la versión 1. Sin cambios en el editor ni en
`min_app_version`.
[ Clave del asistente sincronizada S1 - copia cifrada con una frase, abrir en otro dispositivo, dejar de sincronizar y cerrar la sesión en los otros dispositivos ]

v0.137 :

Compactar (B.9), entrega 3: listos para prender (siguen apagados). Faltaba lo que la re-verificación de la entrega 2
pedía antes: la marca del rearmado vivía en memoria y, si la app se cerraba a mitad, lo escrito junto a un elemento de un
snapshot malo quedaba invisible; ahora se guarda con el rearmado (R-1). La espera ya no sube la página entera en cada
bajada (R-2). La base manda la huella de cada snapshot y el dispositivo no aplica uno que no coincide: lo invalida (O-D).
`pull_page_content` sin versión (v0.127 a v0.133) deja de servir snapshots (migración
`20261025120000_compactar_prender.sql`, sin aplicar). Restaurar empieza por anularlos (D142). Armar devuelve el control
cada 30 ms (O-C, medido con la CPU frenada). El SQL para prenderlos queda en `Doc_Compactar.md`.
[ Compactar, entrega 3 - listos para prender: marca del rearmado guardada, huella del snapshot y versiones viejas sin snapshots ]

v0.136 :

Plantillas con anotaciones de fotos (P.23 y P.20). Una foto anotada llegaba limpia a una página creada desde una
plantilla, y a la plantilla guardada desde una página: copian los bloques, y las anotaciones (`photoMarkup`) no están en
los bloques. Ahora la copia en memoria de la plantilla también toma, campo por campo, el marco y las formas de sus fotos, y
`carryMarkup` (el de copiar y pegar, D46) las escribe con las mismas claves solo para las fotos que quedaron en la
página, en el mismo paso de ⌘Z que los bloques; también en el reporte del día y en *Save as template…*. Entre proyectos
no viajan (D136). *Clear filled-in values* las saca con las fotos (cuentan como valores llenados). Sin migración ni
`min_app_version`: una versión vieja abre lo creado sin tocar el mapa.
[ Las anotaciones de las fotos viajan con las plantillas: al usarlas y al guardar como plantilla ]

v0.135 :

**Dictar al reporte** (P.27, entrega V1): pasar una nota informal del set a su lugar en el reporte no tenía forma;
había que buscar la fila y la columna a mano. *Dictate to report* (el micrófono de la página, el botón redondo del
teléfono o Ctrl/⌘+Alt+Shift+D) toma la nota escrita o dictada con el teclado del sistema, manda la página como un mapa
con direcciones al proveedor del asistente y valida la lista de cambios contra el mapa (rótulos de fila y columna, lo de
antes, marcas). La vista previa muestra cada cambio con su casilla y el destino armado por la app; *Apply* aplica lo
tildado en un paso de deshacer, con la guarda. Lo destildado y lo no ubicado quedan en *Couldn't place*, y la nota
escrita sigue a la vista hasta *Done*, guardadas en el dispositivo. Sin tipos de bloque nuevos ni migración;
`min_app_version` no cambia.
[ Dictar al reporte: la nota informal que el asistente ubica en el reporte, con vista previa y deshacer ]

v0.134 :

Exportar, entrega 1b: los cambios de Lega al PDF (D84, D85 y D88). Las fotos salían achicadas a 200 ppp, lo que pasaba
el tope solo se podía exportar por ramas y una página que fallaba quedaba apenas marcada. Ahora cada foto va con su
original (del dispositivo o por el portero): un JPEG derecho entra tal cual; uno girado por EXIF, una PNG o un HEIC se
pasan antes a JPEG del mismo tamaño en Workers, de a pocas por píxeles (Chrome los recodificaba con seis veces el
peso). *Smaller file* vuelve a las achicadas. Lo que no entra sale en partes por páginas enteras (*Part 1*, *Part 2*…,
una por vez, con tope de peso); al terminar, la lista de las que fallaron con su link y *Export again*. *Cancel* corta
las bajadas, que tienen tope de 90 s.
[ Exportar 1b - fotos en resolución completa, el PDF en partes y la lista de las páginas que fallaron ]

v0.133 :

Compactar (B.9), entrega 2: crear snapshots. Nadie armaba las copias resumidas que v0.127 sabe bajar. Nuevo
`compact.ts`: al final del ciclo, el dispositivo de quien ve lo borrado arma como mucho una página con las filas del
servidor, la comprueba por los dos caminos (con lo pendiente y elemento por elemento; cada 10, contra todo desde cero),
la sube, baja la vuelta y la confirma; lo que no se puede se saltea 24 horas. Al invalidarse un snapshot, una página sin
nada sin subir ya no vuelve a subir entera (el borrado de uno malo llegaba a todos, D110): se rearma con lo del
servidor conservando sus elementos sin sus borrados, y lo mismo al restaurar una copia (sobra texto antes que falte).
La época del árbol reinicia solo si es más nueva; `invalidate_page_snapshot` pide ver lo borrado (migración
`20261020120000_compactar_crear.sql`, aplicada al publicar). Siguen apagados.
[ Compactar, entrega 2 - armar las copias resumidas en el dispositivo (apagadas) y rearmar sin propagar el borrado de una mala ]

v0.132 :

Deshacer, entrega 0 (B.21, `Doc_Deshacer.md`, sección 16). Deshacer lo escrito dejaba restos ("la ía" en vez de "la ")
y a veces se llevaba texto de antes (un ⌘Z borró "ám" de "cámara"). La causa estaba en Yjs: deshacer un borrado escribe
copias, y el deshacer siguiente seguía la copia solo hasta su primer corte: si se había escrito en el medio quedaba el
resto, y si las copias se habían juntado se borraban todas. Un parche a Yjs (`patches/yjs+13.6.33.patch`, Yjs fijo en
13.6.33, `assertYjsPatched`) sigue la copia en todo su largo. Con texto: de 14 a 0 de 3.000 con algo de menos; con el
editor real, de 68 de 300 con restos a 0. Borrando bloques enteros queda poco: 1 de 300 con una letra de menos (antes
7). Sin cambios en lo guardado ni en `min_app_version`.
**Además, copiar y pegar una foto con sus anotaciones** (D46): las flechas son de cada página (`photoMarkup`), así que una
foto anotada llegaba limpia a otra página. Ahora, al copiar, la app recuerda las formas de las fotos copiadas (y en sus
otras pestañas, por `BroadcastChannel`); al pegar en una página del mismo proyecto las escribe en el mismo paso de ⌘Z,
solo para las fotos que el pegado agregó. Al portapapeles no va nada nuevo; otro proyecto o una versión vieja reciben la
foto limpia.
[ Deshacer sin restos (parche de Yjs, B.21) y copiar y pegar una foto con sus anotaciones (D46) ]

v0.131 :

Dos cosas del asistente y las menciones. **Arreglos de las menciones, entrega 2:** compartir desde la mención por
`useShareGate` no tenía prueba (2 mutantes vivos); ahora 5 pruebas y los 9 mutantes mueren, lo que faltaba para prender
la privacidad de lo borrado. La lista del `@` no volvía tras Esc o *Cancel* (el campo olvidaba la posición y enfocarlo
por código no la relee): `cancelAsk` la vuelve a leer. La pregunta aclara que se comparte en el acto. **Diseño, sin
código, de la clave del asistente en todos tus dispositivos** (D72 → B, `Doc_Clave_Sincronizada.md`, CS1 a CS9): una
copia cifrada en el dispositivo con una frase de seis palabras (PBKDF2 y AES-256-GCM) que solo lee la persona; para un
dispositivo perdido, *Sign out other devices* y frase nueva. **Mover y borrar por el MCP con confirmación** (D77,
`Doc_Asistente.md` 9.3 bis, IA11): solo proponen, se hacen con el sí de la persona, nunca cambian quién ve algo y tienen
*Undo*; compartir e invitar, nunca. Sin migración.
[ Arreglos de las menciones y el diseño de la clave del asistente sincronizada (D72) y de mover y borrar por el MCP (D77) ]

v0.130 :

Buscar dentro de secciones colapsadas (D11) y el reporte de set en la raíz (D82), dos pedidos de Lega del 2026-10-02.
**Buscar**: las coincidencias escondidas en una sección colapsada solo se veían al ir una por una y esa sección quedaba
abierta para siempre. Ahora buscar en la página (o abrir un resultado del proyecto) abre todas las secciones que esconden
coincidencias y las vuelve a cerrar al terminar; es solo la vista de este dispositivo (los registros de "abrir para vos"
de P.11), no escribe el Y.Doc. **Reporte en la raíz**: *On-Set Report* en una página de la raíz creaba la plantilla común
sin "ayer" que copiar ni días que numerar. Ahora ofrece la carpeta de reportes que ya tenga el proyecto o crear una
(*On-Set Reports*), mueve la página adentro y la llena como `2026-10-02 | Day 01`; si la página cambió o falta permiso,
no escribe nada (`dayReportRoot.ts`, `RootReportDialog.tsx`). Sin migración ni `min_app_version`.
[ Buscar con secciones colapsadas (D11) y el reporte de set en la raíz (D82) ]

v0.129 :

Tres entregas de fotos y exportar. **El zip para archivar** (P.22, entrega 2): guardar un proyecto fuera de la app no
tenía forma; *Zip — to archive* en *Export…* arma por página un `.html` sin red, un `.md` con rutas relativas, vistas
JPEG, los originales, los comentarios sin correos, el JSON para volver y `MISSING_FILES.txt`; los nombres se acortan para
que ninguna ruta pase 180 caracteres en Windows. Solo dueño y admins. **Anotar con el dedo y el lápiz** (P.20, entrega
3): en pantallas táctiles una tira abajo, dos dedos amplían sin dibujar, el lápiz del iPad dibuja y el dedo mueve, la
palma no cuenta. **El alto de las miniaturas en las celdas** (D27 → B): *Thumbnail size* por tabla (64, 96 o 160 px),
como propiedad de la tabla (`thumbHeight`); una versión vieja la ignora y, si edita la tabla, vuelve a 96 sin perder
nada. `min_app_version` sube a esta versión.
[ El zip para archivar, anotar con el dedo y el lápiz, y el alto de las miniaturas en las celdas ]

v0.128 :

Carpetas con guiones bajos (D3 → B) y dos diseños. Las carpetas que se sueltan en una página llegaban al Drive del dueño
con espacios (`Día 2 - Puerto`), por la regla de v0.089; Lega decidió que ninguna carpeta del Drive lleve espacios.
`driveFolderName` del portero vuelve a pasar cada tramo de espacios a `_`, también en subcarpetas, y conserva lo que ya
protegía (controles, ZWJ entre emojis, corte por grafema); lo ya subido no se renombra y se encuentra por su marca.
Diseños sin código, auditados y corregidos: **⌘Z en el orden en que editaste** (P.26, `Doc_Deshacer.md`: una línea de
tiempo por proyecto arriba de las pilas de Yjs, con el reemplazo del proyecto adentro; antes, investigar B.21) y el
**dictado al reporte** (P.27, `Doc_Dictado.md`: micrófono propio que transcribe con el proveedor de la persona y una
lista de cambios con fila y columna que valida la app, con vista previa y deshacer).
[ Carpetas con guiones bajos (D3 → B) y los diseños de deshacer y dictado ]

v0.127 :

Compactar (B.9), entrega 1: leer snapshots. Un dispositivo nuevo baja todas las filas de cada página, y una página muy
editada llega a miles. Nueva migración `20261019120000_compactar_leer.sql` (`schema_version` 17, snapshots apagados):
`page_snapshots` y la reserva en `page_compaction`, sin permisos directos; `pull_page_content`, que con un snapshot
vigente lo manda primero y si no llama a `pull_page_updates`; y las funciones de quien compacta, para la entrega 2.
Solo lo recibe quien ve lo borrado. En la app, `pullContent` (apagados, el mismo pedido de siempre), la época de
contenido en `DocState`, un snapshot ilegible que no mueve el cursor y el reinicio de la página si su cadena se
invalida. Sin snapshots, los pedidos son los de antes. Pruebas SQL en rollback con 60 mutantes y 32 del dispositivo.
[ Compactar, entrega 1 - leer snapshots: la migración apagada, pull_page_content, la época de contenido y sus pruebas ]

v0.126 :

Asistente, entrega A2 (P.24): el asistente solo trabajaba sobre lo elegido y la política del workspace no tenía cómo
cambiarse. El panel suma *Summarize page* (*Insert at top* / *Insert below*), *Translate page* (*Replace page content*,
que traduce cada bloque en su lugar con el reemplazo de A1, o *Create translated subpage*, por `tree.create` y
`writeNewPage`) y *Format as…* (viñetas, casillas, tabla, títulos; solo bloques que ya existen, un deshacer, la guarda
más el tipo de cada bloque, sin partir bloques con hijos; no aplica si la respuesta deja afuera palabras de lo
elegido y subraya las que agrega). Medido: cambiar el tipo rehace el texto en Yjs, así que lo
escrito a la vez sin red queda en el historial; el diseño quedó corregido. Migración
`20261017120000_asistente_politica_ventana.sql` (sin aplicar): `set_assistant_policy` para dueño y admins, con la
sección *This workspace* en *Assistant…*.
[ Asistente A2 - resumir y traducir la página, Format as… y la política del workspace ]

v0.125 :

Menciones en comentarios (P.21), entrega 2. Para mencionar a alguien que no veía la página había que ir a *Share*,
compartirla y volver, y sin abrir la campana no se veía que había menciones. Nueva migración
`20261016120000_menciones_e2.sql` (`schema_version` 16): `mention_candidates` suma a quienes no ven la página solo
para el dueño y los admins que pueden compartirla, y `share_for_mention` la comparte con Comentar, solo esa página y
sin tocar a quien ya la ve; pruebas en rollback y 19 mutantes. En la app, esas personas aparecen en gris bajo *Can't
see this page* y elegir una pregunta *Share and mention*, por el mismo paso previo que *Share*. Además, un punto en el
árbol (hueco en la madre plegada) y el número en el título de la pestaña y en el ícono de la app instalada.
[ Menciones, entrega 2 - compartir desde la mención, el punto del árbol y el número en la pestaña y el ícono ]

v0.124 :

No se podía guardar una página como plantilla ni cambiar las de fábrica (P.23, entrega 3 de `Doc_Plantillas.md`). Ahora
*Save as template…* (menú ⋯) copia la página a la carpeta *Templates* del proyecto, sin tocarla, con nombre, descripción
y *Clear filled-in values* (vacía tablas y casillas, deja rótulos, saca fotos). Una plantilla es una página marcada
(`settings.template`, sin migración): se edita escribiendo, con una franja arriba (*Template settings…*, *Stop using as
template*). La ventana *Templates* suma las del proyecto, las de otros proyectos (sin sus fotos, con aviso) y
*Customize*; una a medio bajar nunca se copia (*Wait*, *Use built-in*). *New day report* usa la plantilla de la carpeta y
deja elegir entre varias; si no la ve, usa la de fábrica y avisa.
[ Plantillas propias - guardar como plantilla, la carpeta Templates, editar, personalizar y usarlas en el reporte del día ]

v0.123 :

Anotar fotos en la compu (P.20, entrega 2 de `Doc_Anotar_Fotos.md`). Las anotaciones se veían pero no había con qué
dibujarlas. Nuevo `src/ui/Annotator.tsx`, a pantalla completa: las nueve herramientas con las letras de FrameRev,
Shift y Alt, colores y grosor contra 1920 px. Se abre con *Annotate* en la barra de
la foto o A en el carrete, solo con permiso de editar. Escribe al soltar en el mapa `photoMarkup` (una clave por
forma, solo los campos que cambian; el marco nuevo, con la medida del archivo), deshace solo lo propio de esa foto y
apaga las herramientas de crear al tope en bytes. La poda saca, con la página sincronizada, las anotaciones de una foto
que lleva 10 minutos afuera. El PDF dibuja con el grosor mínimo de la hoja. Pruebas con dos editores a la vez, sin red,
la versión publicada y un mapa malicioso. Auditada: corregidos el marco y la poda sin red.
[ Anotar fotos, entrega 2 - el anotador en la compu, los topes, la poda y el grosor del PDF ]

v0.122 :

Exportar (P.22), entrega 1: el PDF de una rama o de un proyecto. Para entregarle un reporte al cliente había que
imprimir página por página. Nuevo: *Export…* en el menú de la página y *Export project…* en el selector arman un solo
PDF con un índice que lleva a cada página y dice su hoja, cada página con su tamaño de hoja (Chrome y Edge; en los demás,
todo con la de la raíz, avisado), las fotos con sus anotaciones y achicadas a su ancho impreso en Workers, comentarios
opcionales (bajados antes, con nombres y nunca correos) y topes de páginas y de píxeles según la memoria. 300 páginas
salen en unos 30 s con 1621 hojas, cada página en la hoja que dice el índice. Un salto de hoja vacío cortaba la primera
hoja de la página: se pagina en el orden del documento.
[ Exportar, entrega 1 - el PDF de una rama o un proyecto con índice, hojas con nombre, anotaciones y comentarios ]

v0.121 :

En el set, el reporte de cada día se armaba a mano copiando fecha, número de día, locación y cámara de ayer (P.23,
entrega 2 de `Doc_Plantillas.md`). Ahora *New day report*, arriba del título de la carpeta de reportes y de cada reporte
(también en el menú ⋯ y con Ctrl/⌘+Alt+Shift+N, sin AltGr), abre un globito con la fecha local, el día siguiente y la
locación de ayer; Enter crea `2026-10-02 | Day 06` con la unidad, la gente de VFX y la cámara del anterior, o abre el
de esa fecha (*Create another*, con el mismo día). La carpeta se marca sola con el primer *On-Set Report* adentro
(`settings.dayReports`, sin migración) o a mano. Todo local, sin red. Auditada: corregidos el día de *Create another*,
las páginas vacías, Enter mientras lee y el reintento sin duplicar.
[ Reporte del día - el botón New day report, la carpeta de reportes y lo que se copia de ayer ]

v0.120 :

Menciones en comentarios (P.21), entrega 1. No había forma de avisarle a alguien de un comentario: solo se veía
abriendo la página. Nueva migración `20261015120000_menciones.sql` (`comment_mentions`, la regla de a quién se puede
mencionar, la campana y las leídas; `list_comments` suma `mentions`; `schema_version` 15) con sus pruebas de permisos
y 30 mutantes. En la app: `@` en un comentario abre la lista de quienes ven la página, la mención se pinta y viaja en
la cola como operación `mentions`, con copia en `meta` para una versión vieja; una campana arriba con las sin leer
(9+), la lista, abrir una lleva al hilo, *Mark all as read*, y un punto en el botón de comentarios; sin red, lo
guardado. Las menciones de Coda se ven como `@Nombre`. Con la base sin migrar, nada cambia.
[ Menciones, entrega 1 - el @ en los comentarios, la campana y su migración ]

v0.119 :

*Download all* y *Retry missing* listaban una subcarpeta por pedido: una carpeta con 500 subcarpetas eran 505 pedidos al
portero (el diseño decía ~40 por pedido). `POST /folder/list` acepta `dirs` (hasta 40 ids; `dir` sigue igual para el
visor y las apps viejas): una sola consulta a Drive con `or` entre padres, agrupada por padre, con el control de árbol
de cada una, el tope de llamados a Drive (las que no entran vuelven en `later`) y el mismo tope de 100 pases por
pedido. La app toma 40 de la cola por pedido (505 pasan a 18); si el portero es anterior, o un pedido falla a mitad,
lista de a una sin perder nada. Además el portero conserva el ZWJ de los emojis compuestos (una familia en el nombre de
un archivo o carpeta) con la misma regla que la app; una prueba compara las dos.
[ Carpetas - el portero lista varias subcarpetas por pedido y conserva el ZWJ; Download all usa 40 por pedido ]

v0.118 :

No había asistente (P.24, entrega A1 de `Doc_Asistente.md`). Menú de la cuenta → *Assistant…*: Anthropic, OpenAI,
Gemini o uno compatible (OpenRouter, Ollama), la clave cifrada solo en el dispositivo y solo para la dirección con que
se guardó. Sobre lo elegido (Ctrl/⌘+Alt+J, la barra o el menú de la página): *Fix*, *Improve*, *Shorter*, *Translate
to…* y *Ask…*, directo del navegador al proveedor. La vista previa marca por palabras; *Apply* reemplaza solo lo que
cambió en un paso de deshacer y no aplica si el texto cambió mientras pensaba. Fotos, links y bloques viajan como marcas
que tienen que volver bien cerradas; aplicar pide Editar. Tras la auditoría: la CSP de `public/_headers` deja el
selector de carpetas de Google, los modelos que razonan tienen margen de tokens, 20 000 caracteres por pedido y el foco
vuelve al panel. Migración `assistant_policy` (de fábrica `on`), sin aplicar.
[ Asistente A1 - corregir, mejorar, acortar y traducir lo elegido con la clave de cada uno, vista previa y aplicar con deshacer ]

v0.117 :

No había plantillas: cada reporte o ficha de plano se armaba a mano (P.23, entregas 0 y 1 de `Doc_Plantillas.md`).
Ahora las tres de fábrica, *Pre-production Notes*, *On-Set Report* y *Shot Breakdown*, viven en el código, en inglés y
castellano, solo con bloques que ya existen. Una página nueva del "+" ofrece *Start from a template*; *More…* y *Apply
template…* (menú ⋯, solo con la página vacía) abren la ventana con descripción y *Preview*
(`/practice?template=on-set`, que no guarda nada). Usar una agrega los bloques antes del primero, con el editor, sin
borrar nada y sin red, y anota `template_id`. Enter en el título lleva al primer dato de la ficha y Ctrl/⌘+Z, también
desde el título recién elegida, la saca entera. Pruebas con la versión publicada, dos dispositivos sin red y la
subida al volver la red; ayuda. Auditada: pasa con observaciones, corregidas.
[ Plantillas - las tres de fábrica, la vista previa y crear una página desde una ]

v0.116 :

Ver las anotaciones de las fotos (P.20, entregas 0 y 1 de `Doc_Anotar_Fotos.md`). No había dónde guardarlas ni cómo
mostrarlas. Viven en un mapa del documento de la página (`photoMarkup`), afuera del contenido, con una clave por forma:
las versiones publicadas lo conservan aunque saquen la foto, quien solo ve recibe por la base limpia solo lo vivo, el
historial lo trae y dos anotando sin red no pierden nada. Se dibujan en un SVG encima de la foto en línea, la de una
celda, la foto-bloque, el carrete (con *Hide annotations*) y el PDF. El mapa se lee como entrada no confiable; tras la
auditoría, cortar un texto en renglones es lineal (medía `renglón + palabra` en cada palabra: 200 textos largos
congelaban la página 6 s por cambio, ahora 12 ms), con topes, y no se dibuja sobre la tarjeta de una foto sin copia.
Todavía no se puede anotar (entrega 2).
[ Anotar fotos - entregas 0 y 1: el mapa de anotaciones, sus pruebas y verlas en la página, la celda, el carrete y el PDF ]

v0.115 :

Exportar (P.22), entrega 0. El PDF y el zip de una rama necesitan dibujar cada página fuera de la pantalla con el
esquema real, y no se sabía si eso respetaba los cortes ni cuánto tardaba. Nuevo en `src/export/`: un editor de
exportación sin colaboración ni interfaz que, por página, lee los bloques de una copia (`docs.snapshot`), espera las
imágenes, copia la vista de impresión de siempre y la pagina; el plan de la rama sin la papelera, con avance y
*Cancel*; un proyecto de prueba y su medición en Chromium. Con 300 páginas y 2219 fotos: entre 14,5 y 38,9 s, lo
guardado de cada página igual byte por byte y las hojas de las 300 iguales a las marcas de la pantalla. Nada cambia para
el usuario todavía.
[ Exportar, entrega 0 - el editor de exportación medido con 300 páginas ]

v0.114 :

No se podía compartir una página con alguien sin cuenta. Entregas 0 y 1 de `Doc_Link_Publico.md`: la prueba en la base
real mostró que Storage revisa la política en cada pedido aunque la miniatura esté en caché, y la app quedó sin indexar
(`noindex`). La migración `20261012120000_link_publico.sql` (sin aplicar) suma `public_links`, el uso por día y las
funciones `plink_*` que validan el token en cada pedido: la página y lo de abajo, solo bases limpias, comentarios con
nombre y topes por cantidad y bytes. Crear un link pide el interruptor de D14. En *Share*, *Anyone with the link* (*Can
view*): copiar, vencer, *Reset link*; quien lo abre entra sin cuenta, en modo liviano, y recargar sigue en el link. Tras
la auditoría: *Reset link* reinicia la base de la rama, `plink_media_files` calcula la rama una vez (614 ms a 8 ms) y
cuenta, y lo ya abierto se vuelve a ver sin red. Ayuda nueva.
[ Link público - Can view sin cuenta: migración, Share, la app del visitante y el portero ]

v0.113 :

Lo que quedó de *Download all* (P.9). Un portero que dejaba de contestar sin cortar la conexión dejaba la barra quieta:
no había tope de lectura. Ahora cada pedido tiene uno sin avance (30 s hasta la respuesta o entre pedazos); pasado,
cuenta como un corte: prueba `/health` (con su tope de 10 s) y, si tampoco contesta, dice "No connection" y sigue sola
cuando vuelve. Faltaba *Retry missing*: baja solo lo que falló o quedó a medias y vuelve a listar las subcarpetas que no
se abrieron; a una carpeta escribe en la misma (y borra la lista vieja si ya no falta nada), y cada ronda de un zip va
a uno numerado (`<carpeta> (missing files).zip`, `(missing files 2).zip`…), para descomprimir encima del primero.
Los nombres limpios de la app sacaban el ZWJ de los emojis compuestos (O4): ahora se queda entre dos emojis.
[ Bajar todo - Retry missing, el tope sin avance y el ZWJ de los emojis ]

v0.112 :

Cinco pedidos de Lega del 2026-10-02 no tenían diseño. Se publican los cinco, sin código, cada uno auditado por
separado, corregido y re-verificado: `Doc_Plantillas.md` (P.23: las tres plantillas de supervisión, las propias como
páginas marcadas y *New day report*; PL1-PL10), `Doc_Anotar_Fotos.md` (P.20: anotaciones al estilo de FrameRev en un
mapa del documento, afuera del contenido, y la poda de las de una foto sacada; AN1-AN11), `Doc_Exportar.md` (P.22: el
PDF con índice de una rama o un proyecto y el zip para archivar y volver, sin correos; EX1-EX15), `Doc_Menciones.md`
(P.21: *@persona* con `comment_mentions` y la campana; ME1-ME10) y `Doc_Asistente.md` (P.24: la clave de cada persona
en su dispositivo, aplicar como edición que se deshace y el MCP en el portero, sin escribir en páginas con invitados,
ni siquiera creando una subpágina; IA1-IA10). Las decisiones quedan propuestas para que Lega las cambie.
[ Diseños - plantillas, anotar fotos, exportar, menciones y asistente, auditados ]

v0.111 :

Restos del historial (P.18). Una versión con dos bloques del mismo id (dos dispositivos rehicieron el mismo bloque) no
se podía restaurar: el editor cambiaba un id, la comprobación no daba y se deshacía sola; ahora, en la copia en memoria,
el segundo recibe un id nuevo antes de restaurar. Al confirmar, la consulta de filas en curso pudo empezar antes de
sincronizar: se espera y se pide otra (O9). Una copia restaurada que vuelve atrás el contador de `page_updates` podía
hacer pasar por buena la caché: se lee la generación del servidor antes de usarla (O7). Deshacer la restauración con
Ctrl/⌘+Z también deja de lado *Restored from…*. Dos sangrías a la vez bajo el mismo bloque ya no muestran el hijo
repetido como agregado (O2). Pruebas nuevas, también de `mergeRows` (M5) y de la versión elegida que crece (M10).
[ Historial - restos: restaurar con ids repetidos, la consulta al confirmar, la generación antes de la caché y Ctrl+Z ]

v0.110 :

No se podía sacar una foto ni filmar desde la página: había que salir de la app, sacarla y elegirla con "/Image", y
no había cómo guardar en el teléfono una foto de la página. Pedido de Lega (P.25). En el teléfono, *Take photo* y
*Record video* (el video, con portero) en el menú "/" y en el menú de la página abren la cámara con el selector del
sistema (`capture`); lo sacado entra en el renglón por el camino de "/Image" y sube por la cola de siempre. *Save to
camera roll* en la barra de cada foto o video abre la hoja de compartir con el original. En la compu no aparece nada.
Sin tipos ni propiedades nuevas. Ayuda nueva; `Doc_Fotos_En_Linea.md`, "Cámara".
[ Cámara - sacar una foto o filmar desde la página y Guardar en Fotos con la hoja de compartir ]

v0.109 :

El esquema "publicado" de las pruebas (`fixtures/editorSchemaMain.ts`) era el de v0.040: las pruebas de "la versión
publicada" comparaban contra una versión de hace meses. Se regeneró desde v0.107; el viejo quedó como
`editorSchemaSoloScript.ts` para las pruebas de lo que una versión sin preguntas, tarjetas, filas o Drive conserva, y
`editorSchemaFixture.test.ts` falla si el fixture queda distinto del esquema sin declararlo. Y ↑ con el cursor después de
una foto, en una celda con solo fotos, iba a la celda de la izquierda: el primer renglón se medía comparando bordes de
abajo con tolerancia de 2 px y daba justo 2. Ahora se mira si los renglones se superponen.
[ Fixture del esquema publicado regenerado desde v0.107 y ↑ después de una foto en una celda ]
v0.108 :

Compartir una página con alguien sin cuenta no existía: solo usuarios invitados. Faltaba un diseño seguro para
«Anyone with the link» con el registro cerrado y el plan gratis. `Doc_Link_Publico.md` lo describe: una llave larga en
el link que la base revisa en cada pedido, sin cuentas ni sesiones anónimas (D31); vale para esa página y lo de abajo,
nunca lo de arriba; quien entra recibe la página pasada en limpio, sin historial ni papelera; topes de cantidad y de
bytes por link y por día, guarda del tamaño de la base y nada indexable. *Can view* (que comenta) sale primero; *Can
edit* (texto y archivos, sin tocar el árbol, D29) después; vencimiento opcional (D30). Dos auditorías independientes:
la segunda dejó dos condiciones para programar la entrega 1 (topes de bytes de los comentarios y lecturas contadas).
[ Link público - diseño de Anyone with the link, auditado ]

v0.107 :

Una foto no entraba en una celda de tabla: pegar, soltar, "/Image" y "Copy image" la ponían debajo (o arriba) de la
tabla, y la que llegaba a una celda se veía enorme (una tabla de 8 fotos medía 2799 px de alto). La creación filtraba
las celdas a propósito y el CSS no tenía nada para ellas. Entrega 5 de `Doc_Fotos_En_Linea.md`: la foto en línea entra
en la celda donde está el cursor como miniatura de 96 px de alto (`w = 0`), una al lado de la otra; la barra suma
*Thumbnail* y *Full cell width* (D32), sin alinear; los tiradores miden la celda; ↑ va a la celda de arriba; la impresión las deja iguales; importar de
Coda deja las fotos de una celda en la celda. Sin tipos ni propiedades nuevas: la versión publicada abre la página sin
escribir nada. Ayuda nueva.
[ Fotos en las celdas - entran en la celda como miniaturas, con su barra, impresión e importación de Coda ]

v0.106 :

El historial no dejaba nombrar versiones ni se veía sin red (P.18, entrega 3): faltaban la tabla y la caché del
diseño. La migración `20261011120000_versiones_con_nombre.sql` (sin aplicar) suma `page_versions`: un nombre que
apunta a una fila, sin contenido, con los permisos del historial (editar, no invitados, no en la papelera); renombrar y
quitar, quien lo puso o nivel 4; con la versión mínima y sin borrar nunca una fila. En la lista, el ⋯ de cada versión
la nombra, renombra o le quita el nombre; *Only named versions* filtra; lo escrito después de un nombre va a una
versión nueva, y después de restaurar dice *Restored from <fecha>*. La caché `<base local>:history` guarda las filas:
se baja solo lo nuevo y sin red se ve lo último bajado, con su aviso; restaurar y nombrar piden red. Se borra al salir
de la cuenta y al sacar el workspace.
[ Historial entrega 3 - versiones con nombre, Restored from y el historial sin red ]

v0.105 :

Una carpeta de Drive (P.9) solo se podía bajar de a un archivo: faltaba *Download all*. Ahora el visor y
la barra de la tarjeta la ofrecen a quien ve la página: la app recorre el árbol con `/folder/list` y baja cada archivo
por su pase (el CORS de `/m/` ya dejaba leerlo solo desde la app). En Chrome y Edge de computadora arma un zip sin
comprimir, con CRC32 en un Worker y Zip64, escrito a medida que llega (o escribe el árbol en una carpeta); Firefox,
Safari y los teléfonos lo arman en memoria hasta 1 GB (500 MB en el teléfono, D24). Cada nombre de Drive se limpia
para Windows y la Mac, los repetidos por mayúsculas llevan « (2)», lo que falla va en `MISSING_FILES.txt` y se puede
cancelar. Los nombres se cortan en 200 o 250 caracteres por grafema, sin partir una bandera.
[ Bajar todo - una carpeta de Drive entera como zip o a una carpeta, con sus nombres limpios ]

v0.104 :

Lo borrado de una página les llegaba con las filas a quien solo ve, comenta o es invitado, y las fotos sacadas se seguían
abriendo (D14). Entregas 0 y 1 de `Doc_Privacidad_Borrado.md`: con el interruptor `clean_min_version` prendido, quien
no ve lo borrado baja solo la última base limpia (la página con lo borrado como hueco), que arma el dispositivo de un
editor a los 20 s de pausa, cada 2 minutos escribiendo y al pasar a segundo plano; sin base, la página dice que está en
preparación. Compartir, invitar y mover suben antes lo pendiente y reinician la base. La migración
`20261010120000_privacidad_borrado.sql` (sin aplicar) deja el interruptor apagado (no se prende por encima de la
versión mínima) y ya cierra la columna `update`, los
archivos sacados y la papelera de archivos para invitados. Línea al compartir y ayuda nuevas.
[ Privacidad de lo borrado - quien no edita baja solo la base limpia, con el interruptor apagado ]

v0.103 :

El historial no mostraba qué cambió en cada versión ni quién (P.18, entrega 2). *Show changes*, prendido por defecto,
compara cada versión con la anterior: lo agregado subrayado y lo borrado tachado con el color de cada persona, bloques
enteros con una barra y los que y-prosemirror rehace (cambiar el tipo, mover) apareados por id, con su rótulo y el
texto comparado por palabras. Son decoraciones sobre una unión en memoria: ni el esquema ni los documentos cambian, y
copiar entrega la versión sin lo borrado. Lo
que alguien escribió en algo ya borrado se ve aparte, en su versión, con **Copy**. El historial se arma en un Worker
(con la página de respaldo) y la diferencia, en una sola transacción y solo de lo tocado: con 10 000 subidas, de 0,7 s a
unos 10 ms. La lista se actualiza sola con el historial abierto, sin perder la versión elegida.
[ Historial - los cambios marcados por persona, el texto huérfano, el Worker y la lista que se actualiza sola ]

v0.102 :

Quien solo podía ver o comentar una rama, y los invitados, leían enteras las páginas mandadas a la papelera dentro de
ella: título, contenido, comentarios y archivos. La regla de permisos (`user_page_level`) miraba solo si el proyecto
estaba borrado, y la política de `pages` dejaba ver cualquier fila con permiso sobre el proyecto. La migración
`20261009120000_papelera_lectores.sql` (sin aplicar) da nivel 0 sobre una página en la papelera, o que cuelga de una,
a quien tiene menos de Editar y a los invitados; quien edita y el dueño la siguen viendo para restaurarla. Las dos
funciones pasan a PL/pgSQL con una sola pasada por los padres: leer el árbol es unas cuatro veces más rápido. En la
app la página sale del árbol sin errores, y un comentario o una edición sin subir quedan rechazados con su texto
hasta restaurarla.
[ Papelera para lectores - Ver, Comentar e invitados no leen páginas en la papelera ]

v0.101 :

Con 300 corridas al azar, la prueba del aviso de B.16 decía que un dispositivo recibía texto ajeno (25 fallas en
una corrida). Era suyo: cuando la reparación que va con lo bajado escribe, Yjs le cambia el número al documento, y la
prueba solo conocía el primero. Detrás había un hueco real: la app anotaba como propio solo el número nuevo, y lo que
copió la reparación (texto propio sin subir) podía desaparecer sin aviso. Ahora la app y la prueba anotan todos los
números del documento; la prueba suma otra pestaña y compactar al abrir sin red. El aviso dice ahora *what you wrote
or moved*: puede traer texto que este dispositivo movió o convirtió (D23).
[ Aviso de lo borrado - todos los autores del documento son propios y la prueba al azar con 300 corridas ]

v0.100 :

Lo borrado de una página viajaba en las filas de `page_updates` a cualquiera que la puede ver, invitados incluidos, y
las fotos sacadas se seguían abriendo (D14). Diseño, sin código, en `Doc_Privacidad_Borrado.md`, medido con filas
reales y simulaciones y corregido con la auditoría: quien no edita (Ver, Comentar, invitados) baja siempre la última
base limpia de la página, armada por el dispositivo de un editor con lo borrado como hueco (también al cerrar la app),
nunca filas; al compartir se sube lo pendiente y se exige una base posterior; los usos sacados de fotos y archivos, y la
papelera de archivos para invitados, dejan de darle permiso. La subida no cambia (D19) y los deltas quedan para más
adelante (D20). Con la migración en borrador, las pruebas y una pregunta para Lega.
[ Privacidad de lo borrado - diseño de la base limpia para quien no edita ]

v0.099 :

Una versión anterior a v0.097 abierta seguía subiendo cambios del árbol y comentarios aunque el workspace pidiera una
más nueva: la base no sabía qué versión escribía (B.17). Ahora la app manda su versión en el header
`x-shotdocs-version` y la migración `20261008120000_version_minima_arbol.sql` (sin aplicar) la mira en `pages`,
`workspaces`, los comentarios y archivar, borrar y restaurar proyectos; sin header rechaza solo con la mínima en esta
versión o más. El rechazo es un 503 `app_outdated` que todas las versiones reintentan: el cambio queda en su cola, no
en rechazados (donde se podía descartar), y sale al actualizar. Si suben la mínima a mitad de una subida, la app nueva
lo deja en la cola y avisa en palabras. *Update now* anota con `updatefound` toda instalación que falla.
[ Versión mínima en el árbol, los comentarios y los proyectos - header con la versión, 503 que no se pierde ]

v0.098 :

No había forma de ver quién cambió una página ni de volver atrás (P.18). Diseño en `Doc_Historial.md` (auditado, con las
decisiones de Lega) y entrega 1: *Version history* en el menú de la página (Ctrl/⌘+Alt+Shift+H) lista las versiones
por sesión con quién y cuándo, muestra cada una con el editor en solo lectura y la restaura. Las versiones salen de
`page_updates` aplicadas en orden, sin guardar nada nuevo (con `mergeUpdates` se perdía texto borrado). Restaurar es
una edición por el editor, de a tramos (para no rehacer los bloques iguales) en un solo paso de deshacer, también con
secciones colapsadas: conserva los ids, se deshace con **Undo**, pide la página sincronizada y no corre si la versión no
se puede armar entera. Lo ven quien edita y no es invitado;
la migración `20261007120000_historial.sql` (sin aplicar) además oculta autor y hora de la tabla.
[ Historial - quién y cuándo, ver una versión y restaurarla ]

v0.097 :

Faltaba probar semanas sin red con una versión vieja (un rodaje con la v0.090 mientras se publican otras). Prueba
nueva con la sincronización de la v0.090 copiada tal cual: con la mínima subida avisa, no sube contenido ni fotos y no
pierde nada; al actualizar, el código de hoy abre la misma base, sube todo y los dispositivos quedan iguales; sin la
mínima sube directo; más variantes al azar. Encontró dos huecos. Una versión vieja seguía subiendo el árbol y los
comentarios y bajaba contenido nuevo, que su editor podía degradar al editarlo: ahora no sale ni baja nada hasta
actualizar (las páginas que cambiaron se ven en solo lectura, con aviso). Y la app instalada no recargaba al llegar la
versión nueva: ahora la busca, recarga sola (también si llegó antes de entrar), *Update now* espera a que llegue y, si
el navegador nunca empezó a instalarla, ofrece forzarla (con red y lugar libre; lo guardado queda).
[ Volver sin red - prueba de semanas offline con la v0.090, la versión vieja no sube ni baja nada y se actualiza sola ]

v0.096 :

Detalles del salto de hoja. Pegar en un renglón de salto algo que traía saltos los perdía: v0.093 dejaba uno solo,
sin distinguir los pegados del heredado. Ahora se anota qué bloques eran saltos al pegar y se conservan; el del
renglón sigue al final, sin duplicarse (con un Script al final, en un renglón debajo). Ctrl/⌘+Enter en el medio de
un título colapsado, o con una selección que empieza ahí, lo partía y abría la sección: ahora el salto va después de
lo escondido, como al final. Supr en un salto vacío último hijo de un bloque subía el de abajo adentro del salto:
ahora saca el salto y lo de abajo no se mueve. Cada caso se deshace en un paso. Roadmap: Apple Developer y
Microsoft Store para cuando la app esté terminada.
[ Salto de hoja - pegar conserva los saltos pegados, Ctrl/⌘+Enter en un título colapsado y Supr en un último hijo ]

v0.095 :

Lo que alguien escribía adentro de un bloque que otro borraba al mismo tiempo podía no llegar nunca al servidor: la
subida se armaba en un `Y.Doc` con GC y, si el dispositivo bajaba el borrado antes de subir, ese texto viajaba como
hueco y quedaba solo en su IndexedDB (lo encontró la auditoría del historial). Ahora la subida se arma sin GC,
aplicando lo guardado fila por fila y en orden: el texto llega, borrado (también lo escrito y borrado entre dos
subidas; con más de 6 MB se arma con GC, como antes). Y quien escribió se entera: la página muestra un aviso con lo
que escribió ahí, para verlo, copiarlo o descartarlo; el estado lo dice si la página no está abierta, y *Download my
unsynced changes* lo incluye. Sin migración. Suma el diseño de compactar en el servidor (`Doc_Compactar.md`).
[ Subida sin GC - lo escrito en algo que otro borra a la vez llega al servidor y se avisa ]

v0.094 :

Faltaba reemplazar en todo el proyecto: cambiar un nombre en cincuenta páginas era abrirlas de a una. Ahora la
flecha del panel de Ctrl/⌘+K despliega el reemplazo: lista cada coincidencia con lo de antes tachado y lo nuevo
al lado, y reemplaza una, una página o todas, con una confirmación que dice cuántos cambios, en cuántas páginas y
cuántos escondidos en secciones colapsadas (borrarlos pide su casilla). Escribe en el Y.Doc de cada página que se
puede editar y está completa, sin editor, por el mismo camino que cualquier edición; antes guarda un registro, y
*Undo* vuelve a poner lo que nadie cambió después, también sin red o tras cerrar la app. Diseño auditado (la
protección del editor abierto, el guardado comprobado, los permisos conocidos). Pruebas al azar con dos
dispositivos: nada del otro se pierde. Al buscar, la ñ pasa a ser otra letra (D12). Ayuda nueva.
[ Reemplazar en el proyecto - vista previa, confirmación y deshacer en todas las páginas ]

v0.093 :

En una página con tamaño de hoja no había forma de forzar que algo empiece en una hoja nueva: los cortes eran
solo automáticos. Ahora hay **salto de hoja**: desde el menú "/" (*Page break*) o con Ctrl+Enter (⌘↩ en la Mac).
Es un párrafo con la propiedad `pageBreak`, no un tipo de bloque nuevo: una versión anterior ve un párrafo y, si lo
edita, pierde solo el salto (no hace falta subir `min_app_version`). Se ve como una línea punteada; lo que sigue
empieza hoja en las marcas "Page N" y en el PDF, también en el teléfono, en una página libre (al imprimir) y con
secciones colapsadas. Puede tener texto, que nunca se pierde; Retroceso justo después lo saca. Ayuda: entrada
*Page break* en *Sheets, PDF and printing*.
[ Salto de hoja - párrafo con pageBreak, menú / y Ctrl/⌘+Enter, en las marcas y en el PDF ]

v0.092 :

Subidas que se traban (lo que quedó de v0.068 y v0.070). Con el portero o Storage colgados para todos, la cola
esperaba el tope entero de cada archivo: un minuto, o hasta 62 s por miniatura. Ahora, a la segunda trabada seguida
sin avance, deja de subir archivos y espera antes de volver a probar (10 s… hasta 10 minutos); los ya trabados van
después de los demás. La miniatura se sube con la señal de corte atada al `fetch` del cliente (no quedan subidas
sueltas) y su tope crece con las fallas seguidas; `page-files` tiene tope. El portero recuerda el plazo de una
respuesta lenta (un proxy que recibe el cuerpo de golpe), descuenta a lo sumo dos huecos seguidos como suspensión,
una suspensión no estira la espera de la respuesta, y volver a mandar lo que una subida perdida tenía no es avance.
[ Subidas trabadas - la cola deja de subir cuando el portero o Storage no contestan, y lo demás de B.11 ]

v0.091 :

Un PDF adjunto se veía solo como un ícono y el carrete salteaba los adjuntos. Ahora la tarjeta de un PDF muestra su
primera página: la dibuja con pdf.js (bajado aparte, solo cuando llega un PDF) el dispositivo que lo agrega, y viaja
como la miniatura de una foto, sin pasar por el portero; lo ya visto se ve sin red. Se eligió sobre la miniatura de
Drive, que llega tarde y pedía cambiar el portero. Si pdf.js no estaba, o el PDF es de antes, se hace al mostrarlo;
si la pestaña se cierra mientras se dibuja, no se reintenta y el PDF sube igual. En el carrete, los adjuntos se ven
en grande con *Open* y *Download*. Sin migración ni propiedades nuevas en el bloque.
[ Adjuntos - vista previa del PDF y tarjeta grande en el carrete ]

v0.090 :

Subir `min_app_version` frenaba solo el contenido de las páginas: una pestaña vieja seguía registrando y subiendo
archivos (por ejemplo, un HEIC sin convertir), porque `register_file`, `link_page_file` y `unlink_page_file` no
recibían la versión y la cola de archivos no miraba el aviso de actualizar. Ahora la cola se frena sola con una
versión menor a la mínima: no registra, no sube al portero, no manda usos ni manda a la papelera de Drive, y una
carpeta no se puede soltar. Todo queda en el dispositivo, contado como pendiente y sin error, y sale al actualizar.
Para las versiones ya publicadas, la migración `20261006120000_version_minima_archivos.sql` suma esas
funciones con `p_app_version`; las de siempre las llaman solo versiones anteriores y dejan de andar cuando la mínima
es 0.090 o más.
[ Versión mínima - también frena la cola de archivos ]

v0.089 :

Una carpeta soltada en la página llegaba al Drive con otro nombre: «Día 2 - Puerto» quedaba `Día_2_-_Puerto`, y
sus subcarpetas igual, porque el portero les aplicaba la regla de las carpetas de la app (sin espacios). Decisión D3
(2026-10-01): las carpetas que suelta el usuario conservan su nombre, con espacios, tildes y emojis; solo se sacan,
como en los archivos, controles, marcas de dirección y caracteres de ancho cero (un emoji compuesto, como el de una
familia, queda en sus partes), las barras van como `_` y se corta en 200 caracteres. Las que crea la app
(`LGA_ShotDocs`, la del proyecto, `Carpetas`) siguen sin espacios. Lo ya subido no se renombra, y retomarlo no
duplica nada: cada subcarpeta se encuentra por su marca, no por el nombre. Además, una carpeta sin nada visible en
el nombre se llamaba `file.bin`: ahora, `Folder`.
[ Carpetas - las que suelta el usuario conservan su nombre en el Drive ]

v0.088 :

Cada subida de contenido repetía todos los borrados de la historia de la página (el *delete set* de Yjs):
`encodeStateAsUpdate` corta los elementos con el vector de estado, pero un borrado no avanza ningún reloj y
viajaban enteros. En una página muy editada era el 96 % del peso de `page_updates`. Ahora el dispositivo anota
qué borrados ya tiene el servidor (`syncedDS`, que como `syncedSV` crece solo con lo confirmado al subir y lo
bajado) y cada subida lleva solo los nuevos; si el armado no se comprueba, sube todo como antes. La cuenta lleva
la generación del workspace: una versión anterior que restaura una copia no la conoce. Con 2000 subidas de una
página, de 4,2 MB a 87 KB en `page_updates`. Sin migración.
[ Sincronización - subir solo los borrados nuevos de cada página ]

v0.087 :

Importar de Coda: direcciones sueltas y renglones en blanco. Una dirección partida por un cambio de formato quedaba
como un link cortado (cada texto se miraba solo): ahora lo pegado que la continúa se junta, pero no una palabra común
ni otra dirección. La puntuación final queda afuera del link. Cada renglón en blanco de Coda y cada renglón
terminado en salto se veían de dos renglones de alto, porque el editor muestra el último `<br>` de un bloque y el
HTML no: ahora se saca un solo salto final por bloque y quedan hasta dos renglones en blanco seguidos (un reporte de
ERSO pasa de 18174 a 16280 px; en Coda, unos 16660), sin perder ninguna letra. Un comentario pegado a un párrafo
partido en tarjetas se busca contra los bloques seguidos juntos, en tiempo lineal.
[ Importar de Coda - direcciones partidas, puntuación y renglones en blanco ]

v0.086 :

Fotos HEIC: con red, si el decodificador no bajaba una vez, la foto se subía como HEIC para siempre; sin red,
la conversión esperaba unos 7 s a que fallara la consulta a la base; un canvas en blanco pasaba la comprobación
con una foto casi toda blanca; el perfil de color era el primero del archivo, o ninguno con solo `nclx`; y
varias juntas se convertían todas a la vez. Ahora con red se reintenta a los 30 s y a los 2 min (con su aviso)
antes de subir el HEIC; se convierte sin esperar la consulta; la comprobación mira también los puntos que se
apartan del fondo; el perfil es el de la imagen principal, con un Display P3 o BT.2020 estándar para `nclx`; y
se convierten de a dos. Pruebas del comando de Coda entero, que al repetirse ya deja el mismo manifest.
[ Fotos HEIC - reintentar el decodificador, convertir sin esperar la base, comprobar mejor y el perfil de la imagen principal ]

v0.085 :

Un dispositivo nuevo mostraba "Subiendo ~2750 cambios" unos minutos al abrir el workspace, sin escribir nada
en la base. Era lo bajado contado como pendiente: al comparar cada página con sus fotos y videos (papelera de
archivos), el dispositivo no tenía anotado ningún uso y ponía en la cola un `link_page_file` por cada uno, que
salían de a uno y no cambiaban nada. Ahora, para las páginas que nunca comparó, lee primero qué usos tiene el
servidor (una lectura por cada 100 páginas) y solo manda los que faltan; si la lectura falla, manda todo como
antes. Medido con 302 páginas y 2704 fotos: de unos 3 minutos con el número y 2704 pedidos, a ninguno.
[ Sincronización - un dispositivo nuevo no cuenta como pendientes los usos de fotos que ya están en el servidor ]

v0.084 :

Colapsar, lo que faltaba: mover una sección colapsada entera y colapsar para todos. Arrastrar o mover con
Shift+Ctrl/⌘+↑/↓ un título colapsado movía solo el título y abría lo escondido. Mover reescribía cada bloque
del medio: con otro editando a la vez, su texto caía en otro bloque o se perdía, y un bloque que nadie tocó
podía desaparecer (hasta 192 de 300). Ahora la sección se mueve entera, los demás bloques la saltan como uno,
se esconde lo mismo, deshacer es un paso y Yjs recrea solo el lado más chico: lo que nadie tocó ya no se
pierde (salvo un bloque anidado a la vez, menos que antes). Shift+clic colapsa o abre para todos (si se puede
editar), en un mapa aparte que las versiones viejas conservan. La ayuda suma las dos funciones.
[ Colapsar 1b y 2 - mover la sección entera y colapsar para todos ]

v0.083 :

No había forma de tener una página o un proyecto para usar sin red, ni de saber cuánto ocupa la app en el
dispositivo. *Available offline…* (menú de la página o del proyecto) muestra el peso de cada casilla y baja lo elegido
por partes, sin frenar las subidas, hasta "listo"; después lo mantiene al día. *Storage on this device* (menú de la
cuenta) tiene un tope elegible (2 GB de fábrica): pasado, un aviso pregunta antes de liberar copias bajadas y
nítidas, nunca lo marcado ni lo agregado en el dispositivo. Una foto nueva que no entra libera copias que siguen en
Drive o se ofrece guardarla. Sin red se lee "Offline · N to upload", también en el teléfono. El portero suma códigos
de error fijos, `POST /verify`, `only: 'known'` y `?offline=1`. Medición en `/storage-test`. Ayuda: dos entradas en *Offline and syncing*.
[ Available offline - marcar, bajar, tope con aviso y espacio en el dispositivo ]

v0.082 :

Faltaban una ayuda y una forma de aprender la app. Ahora el "?" al lado de Papelera (o *Help and shortcuts* en el
menú de la cuenta) abre la ayuda: cada función explicada, todos los atajos de teclado por lugar y una búsqueda
("ctrl f", "carrete"). La primera vez, una recorrida de diez pasos (nueve en el teléfono) que se avanza con *Next*
muestra lo principal sobre una página de práctica en `/practice`: el editor de verdad, pero no se guarda, no se
sincroniza y no la ve nadie; sus fotos van en el renglón, como las crea hoy la app. Las dos se vuelven a abrir desde
la ayuda. "Ya la vi" queda en el dispositivo y en la cuenta. Los atajos salen de un solo registro
(`src/ui/shortcuts.ts`) y una prueba falla si uno del código no está ahí, así la ayuda no queda vieja.
[ Ayuda, recorrida y página de práctica (P.13, entregas 1 y 2) ]

v0.081 :

Soltar una carpeta en la página se rechazaba pidiendo comprimirla. Ahora una ventana muestra qué se sube
(archivos, carpetas, peso, tipos, el árbol y lo salteado) y *Upload* la manda al Drive del dueño, a
`<Proyecto>/Carpetas/<nombre>`, con su propia cola: 3 archivos a la vez, pausa, errores por archivo y, si se
cierra la pestaña, se retoma volviendo a soltarla. En la página queda una tarjeta de carpeta (el mismo bloque
`image` con `sdmedia://` y una fila `inode/directory`) que abre un visor con lo que hay hoy en
esa carpeta de Drive: miniaturas, carrete y bajar. El portero suma `/folder/prepare`, `/folder/sessions`,
`/folder/list` y `/t/`, nunca sale del árbol de la carpeta y solo deja subir a quien la agregó (migración: `media_file` suma
`created_by`). Falta que Lega decida `drive.readonly`.
[ Carpetas - soltar una carpeta entera, con su visor y la regla de no salir del árbol ]

v0.080 :

Borrar un proyecto dejaba sus archivos en Google Drive: la casilla de la ventana todavía no existía, y la
importación de prueba de ERSO iba a dejar 5,6 GB huérfanos. Ahora, con la casilla tildada (arranca destildada; solo
dueño y admins), después de borrar el proyecto el portero manda su carpeta entera a la papelera de Drive, y
*Restore* la trae antes de restaurarlo. El portero anota cada carpeta antes de mandarla y la busca por su marca, así
una respuesta perdida o una falla a mitad se terminan sin perder ninguna. Si Drive, con la misma cuenta, ya no la
tiene, la app pregunta antes de restaurar sin los archivos, con una marca reversible (*Look for its files again*).
Migración 10.
[ Proyectos - mandar su carpeta a la papelera de Drive al borrarlos ]

v0.079 :

La app no sabía si estaba instalada ni explicaba cómo instalarla, y en el iPhone importa: Safari puede borrar lo
que una web guarda en el dispositivo tras unos días sin usarla, pero no lo de la app agregada a la pantalla de
inicio. Ahora, mientras no está instalada, *Install app* aparece en el menú de la cuenta y en la pantalla de
entrar, y en el teléfono un aviso que *Not now* esconde por 30 días. La ventana abre en los pasos del dispositivo
(iPhone, Android o computadora, con las otras en pestañas), cada uno con un dibujo del botón que hay que tocar, y
con *Install* directo donde Chrome o Edge lo ofrecen. Ayuda: entrada en `Doc_Tutorial.md`.
[ Instalar la app - detección, aviso y pasos por plataforma ]

v0.078 :

Fotos en línea, entregas 2 a 4: hasta ahora nada creaba fotos en el renglón y lo importado de Coda quedaba apilado.
Pegar, soltar, "/Image" y "Copy image" de una web ponen fotos y videos donde está el cursor. Lega pidió que hagan
todo lo de la foto-bloque (D-24): tiradores que imantan y la misma barra para las dos, por sectores y con tooltips
que explican cada botón; sin leyenda. *Arrange in rows* acomoda solo las elegidas y un párrafo de fotos se parte
entre hojas por filas. Una versión vieja que abría un renglón sin fotos perdía texto: el renglón lleva una marca que
esas versiones no conocen y que deshacer no saca. Importar de Coda pone cada foto en su renglón con su ancho
(859 páginas de ERSO: las 14.316 fotos y el texto, iguales). Convertir fotos-bloque existe sin entrada (D-26).
[ Fotos en línea - crear, paridad con la foto-bloque e importar de Coda en el renglón ]

v0.077 :

No había forma de sacar un proyecto de la lista: la base no dejaba borrar proyectos y la app no tenía nada para
eso. Ahora, al pasar el mouse por un proyecto del selector (o con "⋯" en el teléfono), renombrar, archivar y
borrar. Archivar pregunta en el mismo renglón y lo pasa a *Archived projects*, editable y con los mismos permisos.
Borrar abre una ventana con páginas, archivos y peso en Drive, y pide escribir `delete` o `borrar` según el idioma;
el proyecto va a *Deleted projects*: nadie lo ve, ninguna fila se borra y *Restore* lo deja como estaba. Lo decide
la base (migración 9: los permisos dan cero con el proyecto borrado). Un dispositivo cuyo primer proyecto se borró
pasa al siguiente, y con una base sin migrar todo sigue como antes.
[ Proyectos - archivar, borrar y restaurar ]

v0.076 :

Fotos en línea, entrega 1: la foto como un carácter del renglón, todavía sin nada que la cree. Faltaba que el
editor la conociera y la dibujara antes de poder crearla. Nodo `photo` en el esquema y en el resguardo de
versiones anteriores, que ahora también corre en la importación de Coda. Editar a la vez junto a una foto perdía
texto: y-prosemirror borraba el texto vecino al borrar o mover una foto. El parche guarda un texto en cada hueco
y, en un renglón con fotos, nunca borra ni recrea un texto; con 300 agendas por caso, 0 letras perdidas (antes
hasta 206), y los párrafos sin fotos guardan lo mismo que antes, byte a byte. Lo que se ve y se toca, medido en
Chromium: filas sin cortes en 831 anchos, teclado y selección con la foto elegida, carrete en orden, imprimir;
el panel de comentarios muestra `[Image]`.
[ Fotos en línea - entrega 1: el nodo, los huecos estables y lo que se ve ]

v0.075 :

Las fotos HEIC agregadas desde el navegador no se veían. Una foto del iPhone soltada, pegada o elegida en el
editor desde Chrome se guardaba y se subía al Drive, pero Chrome no sabe decodificar HEIC: quedaba sin
miniatura y la página mostraba un ícono. Ahora la cola la guarda tal cual en el acto y enseguida la pasa a JPEG
en el dispositivo, antes de registrarla (tamaño completo, derecha, con el perfil de color del HEIC y
comprobada); eso queda en la página y en el Drive. Mientras tanto, o si no se puede, un aviso en su lugar; sin
red se vuelve a probar. El decodificador (libheif en WebAssembly, LGPL-3.0) corre en un Web Worker y se baja
aparte, solo cuando llega un HEIC. Los avisos de licencia van en `THIRD_PARTY_NOTICES.md` y en `/licenses/`.
[ Fotos HEIC - se guardan como JPEG al agregarlas ]

v0.074 :

El árbol de páginas con el teclado y plegar una madre de la página abierta. Las flechas solo abrían y cerraban
ramas; ahora, con el foco en una fila, ↑ y ↓ abren la página anterior o siguiente (con la tecla apretada se
abre la última al frenar), → despliega o baja a la primera subpágina, ← pliega o sube a la madre, e Inicio y
Fin van a las puntas. Además, plegar con el triángulo una madre de la página abierta no dejaba: el efecto que
abre las madres de la abierta corría con cada cambio de lo desplegado y la volvía a abrir. Ahora corre solo
cuando cambia la página abierta o el árbol, y plegar esa madre la deja como página abierta (en el teléfono el
cajón sigue abierto).
[ Árbol de páginas - teclado y plegar una madre de la abierta ]

v0.073 :

Diseño de las fotos en línea, sin código. Hoy una foto es un bloque: no se puede poner el cursor a su lado, ni
escribir o pegar otra foto en su renglón, ni subirla al renglón de arriba, ni elegir varias con Shift; y
"acomodar en filas" reparte toda la tanda en vez de las elegidas, que era lo pedido. Por eso lo importado de
Coda queda apilado. `Doc_Fotos_En_Linea.md` propone la foto como un elemento del renglón, con una prueba
técnica y una auditoría que midió qué se pierde al editar a la vez y corrigió el plan: nodo propio, un parche
para los huecos entre fotos, el ancho como en las filas de hoy, convertir por tanda y hojas junto con crear.
El roadmap lo pone primero (P.15), corrige P.4 y anota que la app tiene que mostrar las fotos HEIC.
[ Docs - diseño de las fotos en línea ]

v0.072 :

Las fotos HEIC de un doc de Coda no se veían. Un doc con fotos del iPhone (HEIC) se importaba completo, pero sus
páginas quedaban sin esas fotos: la app las acepta y las sube, y Chrome no sabe decodificarlas, así que no hay
miniatura ni imagen. En Coda se veían porque Coda las convierte al mostrarlas. Ahora el comando que baja el doc
deja un JPEG de cada una (calidad alta, tamaño completo, con la orientación aplicada y su perfil de color), y eso
es lo que se importa: el manifest y el HTML que lee la app nombran el JPEG, en páginas con y sin tablas, fichas
y embebidas. El HEIC original queda en `media-originals/`. Se puede cortar y repetir sin convertir dos veces,
también con `--convert-only`. La librería que convierte se instala aparte; sin ella el comando sigue y lo anota
como problema.
[ Exportar de Coda - fotos HEIC a JPEG ]

v0.071 :

Comentarios de Coda en renglones con direcciones. Desde v0.069 la importación separa las direcciones sueltas de
un renglón (links y tarjetas de Drive), así que el texto del bloque ya no es el que Coda da como texto marcado de
un comentario, que puede venir con todo pegado o con otros espacios. Ese hilo no se encontraba y quedaba en la
página entera, con una nota. Ahora, si nada coincide, el anclaje hace un último intento comparando sin espacios,
solo con textos de 12 caracteres o más y, si lo encuentra adentro de un bloque, solo si es uno solo. Lo demás del anclaje no cambia
y nada se pierde: lo que no se encuentra sigue yendo a la página entera.
[ Importar de Coda - comentarios en renglones con direcciones ]

v0.070 :

La miniatura todavía podía clavar la cola de archivos. Desde v0.068 los pedidos al servidor de archivos tienen
tiempo límite, pero los dos de la miniatura van a otro lado (Supabase Storage) y seguían sin ninguno: subirla,
antes del original, y bajar las de otros dispositivos al final de cada vuelta. Si Storage no contestaba, la cola
esperaba para siempre. Ahora los dos tienen un tope proporcional al tamaño (30 segundos más lo que tardaría en
una red lenta: hasta 62 para la miniatura más pesada), así una lenta pero sana no se corta. Si vence al subir,
el archivo vuelve a la cola para más tarde y los demás siguen; si vence al bajar, la vuelta termina y se vuelve
a preguntar al minuto. No se marca nada como hecho y el original sigue en el dispositivo.
[ Subida de archivos - tope para la miniatura ]

v0.069 :

Direcciones sueltas de Coda. Lo que en Coda era un embebido (un video de Drive con su reproductor) entraba como
un solo texto, sin links y con las direcciones pegadas entre sí y al texto anterior: Coda las exporta como texto,
sin link, cada una en su `<span>`. Ahora, antes de convertir, un texto que es entero una dirección pasa a ser un
link, y si estaba pegado a un texto o a otra dirección va en su propio renglón, en el mismo ítem, párrafo, celda
o título. Una dirección de Drive que queda sola en su renglón de un párrafo sale a su propio párrafo como tarjeta
de Drive, la que la app ya tenía; en un ítem, una tabla o un título queda el link. Lo que ya era un link, una
dirección adentro de un texto más largo y los archivos de Coda no cambian.
[ Importar de Coda - direcciones sueltas ]

v0.068 :

La subida de archivos se quedaba clavada. Al importar un doc grande (unos 2300 archivos), la app dejaba de subir
del todo durante 5 a 9 minutos, sin ningún error y con la barra en 0 %. Los archivos se suben de a uno, y ningún
pedido al servidor de archivos tenía tiempo límite: uno que nunca contestaba dejaba la cola entera esperando.
Ahora el pedido que deja de moverse se corta y el archivo vuelve a la cola para más tarde, sin frenar a los demás.
Abrir la subida y preguntar cuánto llegó tienen un minuto; una parte se corta recién a los dos minutos sin que
salga ni un byte, así que una red lenta no se confunde con una subida colgada. Al retomar siempre se pregunta
primero qué llegó, para no subirlo dos veces. El original sigue guardado en el dispositivo.
[ Subida de archivos - cortar los pedidos que se traban ]

v0.067 :

Imprimir como se ve (colapsar, entrega 1b, primer paso). El PDF de una página con secciones colapsadas sale
siempre con todo abierto, para que las hojas coincidan con las marcas de la pantalla; Lega pidió poder imprimirla
también como se ve. Ahora, con algo colapsado en la página, el menú tiene la casilla "Imprimir como se ve": con
ella, el PDF sale sin las secciones colapsadas y pagina lo que queda (las hojas ya no coinciden con las marcas,
y el tooltip lo avisa). La casilla se guarda en el dispositivo y vale también para Ctrl/⌘+P y para imprimir
desde el menú del navegador. No cambia el documento ni lo que ven los demás.
[ Colapsar - imprimir como se ve ]

v0.066 :

Páginas embebidas de Coda. Una página que en Coda muestra otra página (de otro doc, por ejemplo) entraba vacía:
la API de Coda no dice qué muestra ni deja exportarla. Ahora, si la carpeta exportada trae `embeds.json` con la
dirección de cada una (la da el servidor MCP de Coda, que captura quien importa), el comando busca esa página en
su doc, baja su HTML y sus archivos y los deja como contenido de la página embebida, anotando de dónde salió. Una
dirección que no es de Coda queda como link. Si no hay permiso sobre el otro doc, la página queda vacía como
antes, con el motivo en la lista. Sin `embeds.json`, nada cambia.
[ Exportar de Coda - páginas embebidas ]

v0.065 :

Colores al importar de Coda. Al comparar un doc importado con Coda, un fondo verde muy claro (como el que Coda
pone en las celdas) quedaba amarillo en la app: el importador elige el color con nombre más cercano por tono, y
ese verde está a mitad de camino entre el amarillo y el verde del editor. Ahora todo tono entre 70° y 165° es
verde, como se ve en Coda, y un color escrito en hexadecimal también se reconoce. Además, al convertir una tabla,
el color de una celda es el que tiene en la tabla de su propia página; el de otra vista vale solo si ahí la
celda no tenía color (antes ganaba la última vista que se leía).
[ Importar de Coda - verdes claros y color de las celdas ]

v0.064 :

Tablas de Coda: fichas con datos de otra fila. Al convertir una tabla en fichas, el comando junta cada fila del
HTML (con las notas y fotos de las celdas) con su fila de la API. Aceptaba la fila de la misma posición si se
parecía en algo, así que dos filas con el mismo nombre visible se podían cruzar y una ficha terminaba con la
descripción o la nota de otra. Ahora una fila del HTML se junta solo con una fila de la API que coincide en todas
sus columnas comparables (texto, opciones, relaciones, números, personas). Si ninguna coincide en todo, la más
parecida sirve solo para ubicarla en la lista; su ficha sale de la API y queda una nota. Las menciones a personas
ya no rompen la comparación.
[ Exportar de Coda - cada fila con su fila exacta ]

v0.063 :

Tablas de Coda al exportar un doc. El comando bajaba solo las páginas: una tabla de Coda llegaba como la vista
que se veía en el HTML, con las fotos de las celdas debajo de la tabla y sin el detalle de cada fila. Ahora, si
el doc tiene tablas, el comando las baja por la API (columnas y todas las filas, también las que escondía un
filtro) y las convierte en páginas, como acordó Lega para docs cerrados: una ficha por fila con sus fotos, campos
y notas, un índice con links a las fichas donde estaba la tabla, una tarjeta por fila en las vistas de tarjetas
y los links entre filas como links entre páginas. Las tablas de maquetado se desarman y las chicas de texto
quedan igual, con las filas que escondía el filtro debajo. `--convert-only` repite la conversión sin red y `tables.config.json` elige el modo de cada tabla.
[ Exportar de Coda - tablas como páginas ]

v0.062 :

Comentarios de Coda en filas de una tabla. Al importar un doc con tablas, los comentarios de una fila de una
tabla que entra como tabla se anclan al texto de su primera celda. Un texto largo ya se encontraba adentro del
bloque de la tabla, pero uno corto (una palabra de menos de 8 letras) no se busca adentro de otro bloque, para no
confundir "ok" con "Plano 12: ok", y esos hilos quedaban en la página entera con una nota. Ahora el anclaje mira
también cada celda de las tablas: si ningún bloque tiene exactamente ese texto y una celda sí, el hilo queda en
el bloque de la tabla, sin nota, aunque sea corto. Lo demás del anclaje no cambia.
[ Importar de Coda - comentarios en celdas de tablas ]

v0.061 :

Links entre páginas y archivos repetidos al importar de Coda (pedidos para importar un doc con tablas). Un link
de una página de Coda a otra del mismo doc quedaba apuntando a Coda, y la app no tenía links internos: un link
a una página se abría en otra pestaña, recargando la app. Ahora la exportación marca esos links
(`coda-page:<id>`) y la importación crea primero todas las páginas y después escribe cada una, así cada link
pasa a la página creada (también en un ciclo A ↔ B y al seguir una importación cortada); uno a una página que
no está en la exportación queda como texto y anotado. En el editor, un clic en un link a una página de la app
la abre en la misma pestaña, sin recargar; Ctrl/⌘+clic, en otra. Además, el mismo archivo en varias páginas
de una importación se guarda y se sube al Drive una sola vez: las demás páginas usan la misma dirección.
[ Importar de Coda - links entre páginas y archivos compartidos ]

v0.060 :

Comentarios de Coda al importar. No pasaban a Shot Docs porque la API REST de Coda y su exportación HTML no los
dan. Ahora se capturan con el servidor MCP de Coda a `comments.json`, en la carpeta exportada, y la importación
los pone en la cola de comentarios página por página: cada hilo en el bloque que contiene el texto marcado en
Coda (o en la página entera, si ese texto ya no está), con su fecha original, y resuelto si lo estaba. Los de
personas sin cuenta en la app quedan con su nombre de Coda y la marca "from Coda": no se les crea cuenta ni se
les avisa nada. Los de quien importa quedan a su nombre. Seguir una importación cortada no los repite. Migración
`20260930200000_comentarios_importados.sql`: el autor importado y `import_comment`, que pide editar y crear
páginas.
[ Importar de Coda - comentarios ]

v0.059 :

El margen de cada bloque, como pidió Lega. Al pasar el mouse por un bloque aparecen tres puntos verticales,
redondos y gruesos (como en Coda), en vez de los seis de BlockNote, y ya no está el "+" de al lado. En un título
el orden es [puntos] [triángulo] [texto], con el mismo espacio entre cada cosa y todo centrado en el primer
renglón; en lo demás, solo los puntos, siempre a la izquierda de la casilla, el botón o la viñeta de las listas.
El triángulo de colapsar es más grande (crece con el título), gris, y con el mouse encima toma el color del
título (blanco en el tema oscuro, también si se cambia el tema en vivo); ahora se puede llegar a él: sigue a la
vista mientras el mouse va del título al margen, y los puntos van con él. En el teléfono todo entra en el margen
sin tapar el texto. Un clic en los puntos elige el bloque entero y abre la barra de formato entera (tipo de
bloque, negrita, colores del texto y del bloque, alinear, comentar) en vez del menú del tirador, que ya no tiene
"Borrar": un bloque elegido se borra con Retroceso, Supr o Cortar, y toda la página con Ctrl/⌘+A (un título
colapsado, con su sección entera, como antes; ver Doc_Colapsar.md). Arrastrar los puntos sigue moviendo el
bloque. Arreglado: después de borrar un bloque desde el menú hacía falta apretar Ctrl+Z varias veces, y los
primeros deshacían otras cosas. El foco quedaba afuera del editor y el deshacer propio del navegador cambiaba el
texto como si fuera una edición nueva; ahora ese deshacer hace el de la página (salvo con el foco en otro campo,
como el título, donde no toca la página), todo lo que saca bloques es un solo Ctrl+Z (aunque se haga enseguida
después de escribir) y los puntos dejan el foco en el editor.
[ Menú del bloque - tres puntos, barra entera y deshacer ]

v0.058 :

Fotos nítidas en la página. Las fotos se veían borrosas en la página (y bien en el carrete) porque la página
mostraba siempre la miniatura de 480 px, estirada al ancho de la foto (hasta ~1100 px, el doble en pantallas
Retina); no era la exportación de Coda, que baja los originales (en la base, de 2900 a 3840 px). Pasaba con
cualquier foto y en cualquier dispositivo. Ahora, cuando una foto se ve más grande que su miniatura, la página
la cambia por una imagen de hasta 2048 px (1024 si se ve chica, como en un teléfono) hecha en el dispositivo
("Exportar para web": reducida con buena calidad, WebP 0,8, o JPEG 0,8 en Safari; 130 a 350 KB): del original
si está en el dispositivo (también sin red) o del original bajado una sola vez por el portero, y queda
guardada (hasta 150 MB; si falta lugar, se borra primero). Solo las fotos a la vista o por verse, de a dos, lo
último que se vio primero; también cuando una foto se agranda. Videos, HEIC y originales de más de 25 MB (8 MB
en el teléfono) siguen con la miniatura; no se baja nada sin red, con ahorro de datos o con conexión lenta
(eso solo lo dice Chrome); lo que no se pudo no se repite en la sesión, y una bajada que falla espera cada vez
más. La foto no cambia de tamaño (las marcas de hoja y el PDF quedan iguales), el documento no cambia y las
versiones anteriores siguen mostrando la miniatura. El carrete empieza con la imagen nítida; imprimir desde otro
dispositivo sale con ella. El portero ahora deja leer a la app lo que sirve en `/m/` (CORS, solo para los
orígenes de la app): hace falta para bajar el original desde otro dispositivo; hasta que se publique, la
página sigue con la miniatura ahí y la app deja de intentar por media hora. Ver `Doc_Imagenes.md`, "Calidad
en la página", y `Doc_Portero.md`.
[ Fotos nítidas en la página ]

v0.057 :

Buscar: tres ajustes que encontró Lega probando. Ir a un resultado de la búsqueda del proyecto (Ctrl/⌘+K) ahora
lleva de verdad a la coincidencia, también en páginas largas con fotos y en hojas anchas como A3: se centra en
la parte que se desplaza de la app (y de costado si hace falta) y se sigue centrando unos segundos mientras la
página se acomoda (fotos que bajan, marcas de hoja), hasta que desplazás, tocás o escribís; antes se centraba
una sola vez y las fotos de arriba la empujaban fuera de la pantalla. El campo de la barra de buscar enfocado
tiene un solo borde fino (amarillo en el tema oscuro, un amarillo más oscuro en el claro para que se vea), sin el
marco blanco ni el contorno grueso. Con una hoja más ancha que la ventana, la barra de buscar se alinea con los
íconos de arriba y ya no queda cortada al borde de la hoja.
[ Buscar - ir al resultado y la barra en hojas anchas ]
v0.056 :

"Importar de Coda…" (selector de proyectos) queda solo para la cuenta de Lega: es una herramienta suya, no
una función de la app. Nadie más ve la entrada ni puede abrir el diálogo, que para los demás ni se monta.
Como el repositorio es público, el correo no está escrito en ningún lado: `src/import/codaOwner.ts` compara
el SHA-256 del correo del usuario que inició sesión (sin espacios alrededor y en minúsculas, con Web Crypto,
una vez por usuario) con una constante; la entrada aparece cuando el hash se resolvió. Las pruebas usan el
hash de un correo de prueba. Ver `Doc_Importar_Coda.md`.
[ Importar de Coda, solo para Lega ]

v0.055 :

Importar de Coda con fotos. Antes una página pasaba sin sus imágenes: el Markdown de Coda las descarta, y el
editor tira una <img> que está adentro de un párrafo o de un ítem de lista, que es como las exporta Coda.
Ahora `scripts/coda-export.mjs` baja el doc por la API en HTML, con cada foto y video a una carpeta, y
*Import from Coda…* (selector de proyectos) la importa a un proyecto nuevo: páginas con `tree.create`,
archivos con `media.add` (se suben al Drive por el portero, como al soltarlos) y cada foto como bloque propio,
dentro del ítem cuando estaba en una lista. Los colores pasan a los del editor y el guion a texto Script.
Una importación cortada (se cerró la app, una página que falló, sin espacio) se sigue en el mismo proyecto
sin repetir páginas ni archivos y sin pisar lo que se editó mientras tanto, y la app pide confirmación antes
de cerrarse, cerrar la sesión o ceder a otra ventana mientras importa. Los textos del diálogo, los errores
y la lista del final están en castellano e inglés; sin Drive conectado o en el iPad (no elige carpetas) el diálogo lo
dice de entrada, y muestra cuánto pesa lo que se va a guardar y cuánto espacio queda. Se revisa el manifest
(sin páginas, un error claro; páginas sin nombre o en círculo no cortan nada), y quedan anotadas las páginas
que no son texto, las fotos que no estaban guardadas en Coda (las https quedan enlazadas) y lo que anotó el
comando. El comando manda el token solo a la API de Coda y tiene `--refresh`.
Probado con MGTZD (35 páginas, 32 fotos). Ver `Doc_Importar_Coda.md`.
Además, `src/ui/carrete.ts` pasa a `carreteModel.ts` (y su prueba a `carreteModel.test.ts`): al lado de
`Carrete.tsx`, en un disco que no distingue mayúsculas (Windows, macOS) un import sin extensión podía
encontrar el módulo equivocado. Una prueba (`src/fileNames.test.ts`) revisa que no vuelva a pasar.
[ Importar de Coda con fotos ]

v0.054 :

Buscar en todo el proyecto (P.12, segunda entrega). Una lupa a la izquierda del "+" de "Páginas" en la barra
lateral (la ve cualquiera, también quien no puede crear páginas), o Ctrl/⌘+K desde cualquier lado, abre un panel
que busca en los títulos y el texto de todas las páginas del proyecto abierto que la persona ve, también en los
pies de las fotos y los nombres de los archivos; no en la papelera ni en los comentarios. Sin mayúsculas ni
tildes (la ñ vale como n) y con partes de palabras; cada palabra tiene que estar en algún lado de la página.
Los resultados salen por página, con el camino ("Brief › Uruguay") y hasta tres fragmentos con lo encontrado
resaltado; se recorren con ↑ ↓ y Enter, y Esc cierra. Elegir un resultado abre la página con la barra de
buscar ya puesta en esa coincidencia (Enter sigue por las demás), también en la misma página; un resultado del
título abre la página arriba. Busca en el dispositivo: anda sin red, un dispositivo nuevo encuentra páginas que
nunca abrió, y avisa si faltan páginas por bajar o alguna no se pudo leer entera. El panel lista también los
otros proyectos que coinciden: Ctrl/⌘+K ahora busca, y cambiar de proyecto sigue a dos teclas (el selector de
arriba se abre con un clic); si ninguno coincide (y ya no se está buscando), ofrece crear uno con ese nombre: se llega con las flechas y Enter. Una sola letra busca solo en
los títulos. Un resultado adentro de una sección colapsada la abre para vos al llegar. Con texto elegido en el editor, Ctrl/⌘+K sigue creando un link, salvo que lo elegido sea lo que dejó
Esc en la barra de buscar. En el teléfono el panel ocupa toda la pantalla y el cajón se cierra al ir al
resultado. En la Mac los atajos son siempre con ⌘ y nunca con Ctrl (también mandar un comentario, comentar e
imprimir). Con mil páginas, la primera búsqueda tarda unos milisegundos.
[ Buscar en el proyecto - segunda entrega ]

v0.053 :

Colapsar secciones por sus títulos (P.11, entrega 1a). Todo título tiene un triángulo a la izquierda (aparece
al pasar el mouse; colapsado se ve siempre; en pantallas táctiles, siempre y tenue): colapsar un título
esconde todo hasta el próximo título de su nivel o mayor, y los de adentro guardan su estado. Es **solo para
vos**: se guarda en el dispositivo y no cambia la página (los demás la ven igual; "para todos" con Shift+clic
llega en la entrega 2). Ctrl/⌘+Alt+Enter colapsa o abre la sección de la selección; "Colapsar todo" y "Abrir
todo" en el menú de la página. Editar al lado de lo escondido es seguro: borrar un título colapsado borra su
sección entera de una vez (también el último de la página; si la página queda vacía, queda un párrafo), con un
aviso y Ctrl+Z que trae todo; lo escondido se borra solo a propósito: con "Borrar", con el título elegido
entero (o toda la página con Ctrl+A) y borrarlo, cortarlo o pegar o escribir encima, o con una selección de
texto que cruza la sección entera (empieza arriba del título y termina después de lo escondido), y cortar
lleva justo lo que se borra; cualquier otra edición que borraría algo escondido (por ejemplo Shift+→ desde un
título colapsado y después Retroceso, o una tecla muerta de acento) no se hace, la sección se abre y la
selección queda vacía; juntar el título con otro bloque o borrar solo su texto no borra lo escondido (se
abre), y Supr justo arriba de un título colapsado no lo junta; mover un título colapsado (con el tirador o
Shift+Ctrl/⌘+flechas) deja ver lo que escondía hasta que mover la sección entera llegue en la entrega 1b;
Enter al final de un título colapsado crea un renglón después de la sección sin abrirla (y Retroceso en ese
renglón vuelve al título sin unirlo a lo escondido); Supr ahí no une lo escondido; ↓ y → lo saltan; si algo
que se veía fuera a quedar escondido por un cambio (propio o de otro), su sección se abre para vos; "Ir al
bloque" de los comentarios abre lo que lo esconde. Escribir en una página grande con todo colapsado no
recalcula lo escondido en cada tecla (unos pocos ms con miles de bloques), y Enter no rearma todas las marcas.
Hace falta un navegador con `:has()` en el CSS (Chrome 105, Safari e iOS 15.4, Firefox 121); en uno más viejo
no aparecen los triángulos y no se esconde nada. Las marcas de hoja se cuentan con todo abierto y el título
colapsado dice qué hojas tiene adentro ("Hojas 2–4 adentro"); el PDF sale todo abierto. Los "Encabezados
plegables" de BlockNote salen del menú "/" y del selector de tipo; los que ya existían se ven como títulos
comunes. Sin tipo de bloque ni propiedad nueva, sin migración. La búsqueda en la página (v0.051) encuentra lo
que está en secciones colapsadas y, al ir a una coincidencia escondida, abre para vos lo que la esconde;
"Reemplazar todo" y su deshacer no abren nada. Retroceso al principio de un título ya no lo pasa a párrafo:
"sube la línea" como cualquier renglón (se une al de arriba; un título colapsado que se une deja ver lo que
escondía, y sus hijos quedan como con un párrafo); justo después de escribir "## ", Retroceso lo deshace como
siempre, y funciona igual en un navegador sin colapsar.
[ Colapsar secciones - entrega 1a ]

v0.052 :

Editar a la vez sin perder texto (`Doc_Colaboracion.md`). Una investigación con el editor real encontró
pérdidas que no tenían por qué pasar, y quedan arregladas: con un bloque elegido entero (una foto tocada), un
cambio de otro dispositivo sobre ese bloque dejaba el editor mostrando lo de antes, y la próxima tecla
deshacía el cambio del otro para todos (también hacía que deshacer pareciera no andar); dos personas
escribiendo en el mismo párrafo vacío perdían texto, y eso pasaba en la primera línea de toda página nueva
abierta en dos dispositivos; y si los dos le cambiaban el tipo o la sangría al mismo renglón, el editor lo
borraba entero con sus hijos. Son dos parches a y-prosemirror (`patches/`, los aplica `patch-package` al
instalar; sin ellos la app no se construye), la semilla de las páginas nuevas con un texto vacío (la raíz es la
de siempre, así una versión vieja y una nueva siguen compartiéndola), una reparación de bloques en la misma
transacción que aplica lo que llega, y, si igual el editor no puede mostrar un cambio, se vuelve a dibujar
desde el documento antes de la próxima tecla. La prueba al azar por el camino de la app perdía texto en 26 de
cada 100 corridas; ahora en 0 de 500. Lo que sigue pudiendo pasar (si uno le cambia el tipo, la sangría o la
posición a un renglón mientras otro escribe en ese mismo renglón, lo del segundo se puede perder) es como
funciona la librería y está explicado en el documento. `min_app_version` sube a 0.052: las versiones
anteriores no tienen estos arreglos. Además, al cerrar la app se espera a que termine la sincronización en curso
(hasta 2 segundos) antes de cerrar la base, y las pruebas ya no dejan errores sueltos al cerrarla.
[ Sync - editar a la vez sin perder texto ]

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
