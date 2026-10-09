# Decisiones

Lo que solo Lega decide. Las abiertas siguen con la opción indicada en `Plan_ShotDocs.md` hasta que Lega
diga otra cosa.

## Estado técnico de D-13 y D-18 (v0.206, LF21 parcial)

Dentro de la autorización vigente para que cada workspace conserve su identidad, se implementó el tramo de editor y arranque: anchor propio con clave local sin cambiar el documento, selección normal explícita antes del cliente y guardado local antes de un clic del editor hacia otra cuenta. Es un avance técnico parcial de LF21 A; conserva el registro histórico de B y no añade una decisión de Lega ni completa O1/Request access. Clipboard rico, drag, hashes públicos antiguos, importación/exportación completa y aceptación con cuentas/RLS reales y dispositivos físicos siguen en el roadmap.

## Tomadas

- **D-01 · Nombre: LGA Shot Docs** (2026-09-29). Repo `legandrop/LGA_ShotDocs`; se llamaba
  `LGA_VFX_Docs` y se renombró antes del primer commit.
- **D-02 · Backend: Supabase, frontend en Cloudflare (antes Vercel)** (2026-09-29). Lega ya tiene
  cuentas de Aiven y de Neon, pero las dos son solo base de datos: con cualquiera de ellas habría que
  sumar un servicio de login, uno de archivos (los reportes de rodaje llevan muchas fotos) y uno de tiempo
  real. Supabase trae todo junto, aplica los permisos dentro de la base y le pide una sola cuenta a quien
  la autohostee. El frontend arrancó en Vercel y pasó a Cloudflare (D-05).
- **D-03 · Editor visual por bloques** (2026-09-29). Nadie ve Markdown: se usa solo para importar,
  exportar y hacer backups.
- **D-04 · Tiempo real al final** (2026-09-29). El modelo de datos lo contempla desde el principio, pero
  se implementa en la última fase.
- **D-05 · Hosting: Cloudflare** (2026-09-29). El plan Hobby de Vercel es solo para uso no comercial, y
  para usar la app en shows pagos hacía falta Vercel Pro u otro hosting. Lega eligió Cloudflare (Workers
  con archivos estáticos): gratis, con uso comercial y con la misma dirección propia
  (`Plan_Workspaces.md`, sección 9). Hecho en v0.020; Vercel quedó dado de baja.

- **D-10 · Ajustes por rama y por cuenta** (2026-09-29). Lo que depende del contenido se guarda en la
  página y lo heredan las de adentro, salvo que alguna defina lo suyo: el encabezado con los contenedores
  (cuántos niveles, o oculto) y la división de títulos por "|". Lo que depende de la persona se guarda en
  su cuenta y la sigue en todos sus dispositivos: tema (sistema, claro, oscuro), fuente (Default con
  Inter, Editorial con Instrument Serif en títulos), tamaño del texto y ancho de página. Los títulos de
  una lista se dividen solo si ninguno tiene un código (la parte antes del primer "|") de más de 7
  caracteres, para que la columna del código quede alineada; si no, la lista se ve con los títulos
  enteros. El encabezado muestra 2 niveles si nadie lo configuró.

- **D-09 · Registro cerrado, solo por invitación** (2026-09-29). Con el correo propio configurado,
  cualquiera con la dirección de la app podría crearse una cuenta y usar el almacenamiento del proyecto.
  Se cierra el registro: entran solo las cuentas que el dueño invita (desde el panel de Supabase hasta que
  la fase 2 lo haga desde la app). Con equipo e invitados (D-18) el control pasa a la base: el registro se
  abre en Supabase, pero un control previo rechaza todo correo que no esté en la lista de invitaciones del
  workspace. Sigue siendo solo por invitación.
- **D-11 · Correo con Resend y el dominio propio** (2026-09-29). Los mails de login salen por Resend desde
  una dirección del dominio de Lega, con el código de 8 dígitos y el link. Se descartó el SMTP de Gmail
  porque exige verificación en 2 pasos en la cuenta que manda.

- **D-12 · Proyectos** (2026-09-29). Lo que en Coda es un *doc* acá es un **proyecto**: un árbol de
  páginas propio. Son las filas de `workspaces` (cada usuario tiene los que quiera; el primero arranca
  como "My project" y se renombra; el de Lega es "MGTZD"). Se cambia de proyecto sin salir de la página,
  con un selector arriba de la barra lateral (la opción A de las que se diseñaron): un clic o Ctrl+K (desde
  v0.054, Ctrl/⌘+K abre la búsqueda del proyecto, que también lista los proyectos; ver `Doc_Buscar.md`),
  buscar, flechas y Enter; en el teléfono sube como hoja desde abajo. Crear y renombrar proyectos entra en
  la misma cola que las páginas, así que funciona sin red y un proyecto nuevo sube antes que sus páginas.
  Cada proyecto recuerda su última página abierta. Una página no se mueve entre proyectos. Con equipo
  (D-18) cambia quién los crea: solo el dueño y los admins del workspace, y un usuario nuevo ya no recibe
  "My project".
- **D-13 · Links legibles** (2026-09-29, para la fase 2). Las direcciones de página llevan el título y un
  pedazo del id (`/p/064-cubiertos-pegados-3f9c2a`); el id es lo que cuenta, así que renombrar no rompe
  un link compartido. Con varios workspaces (D-18), el link también tiene que decir de qué workspace es.

- **D-14 · Texto Script (Guion)** (2026-09-29). Un tipo de texto para pegar y escribir guiones: tipografía
  de guion (Courier Prime) y, en mayúsculas, marcas de color de fondo para el lugar (INT, EXT, INT/EXT,
  I/E), el día (DÍA, DAY: amarillo), la noche (NOCHE, NIGHT: azul) y las luces de transición (AMANECER,
  ATARDECER, ANOCHECER, DAWN, DUSK, SUNRISE, SUNSET: naranja). Se elige en el menú "/", en el selector de
  tipo de la barra de formato o con Ctrl+Alt+S; Enter sigue en Script y Enter en una línea vacía sale. En
  la interfaz en inglés se llama "Script" y en castellano va a ser "Guion" (D-16). **No es un tipo de
  bloque nuevo sino un párrafo con `script: true`**: una versión de la app que no lo conoce lo ve como
  párrafo común; si alguien edita esa línea en la versión vieja, la línea vuelve a ser párrafo para todos
  (el texto queda, se pierde solo el estilo). Un tipo de bloque desconocido se borraría del documento
  compartido al abrir la página en esa versión (lo encontró la auditoría) y el borrado llegaría a todos
  los dispositivos.
- **D-15 · Tooltips propios** (2026-09-29). Mismo estilo que las apps LGA en Qt (fondo `#242424`, borde
  `#3a3a3a`, flecha de 16×11 que apunta al control y se da vuelta si no entra, rótulos en negrita
  `#E8E8E8`, 600 ms de espera) y la misma regla: un tooltip nunca repite lo que el control ya dice; va solo
  cuando suma algo (un atajo, una segunda interacción, un título cortado). Nada de tooltips del navegador.
- **D-16 · App en castellano e inglés** (2026-09-29; implementado 2026-09-30, roadmap B.8). La interfaz
  está en los dos idiomas, y también las plantillas (cuando existan) y los tipos de texto (Script/Guion,
  Question/Pregunta). Cómo quedó:
  - **El idioma es una preferencia de la cuenta** (`language: 'en' | 'es'`, en `user_settings`), se elige en
    el menú de la cuenta junto al tema y la fuente y sigue a la persona en todos sus dispositivos. De
    fábrica, castellano si el navegador está en castellano (`es`, `es-AR`…); si no, inglés. Antes de entrar
    (login, bienvenida) se usa el último elegido en el dispositivo o el del navegador.
  - **Versiones viejas de la app:** no conocen la clave y la descartan al leer. Si una versión vieja cambia
    una preferencia, sube el objeto entero sin `language` y la clave se borra de la cuenta; no es grave: los
    dispositivos con la versión nueva siguen con el idioma que tenían (lo que la cuenta no trae no vuelve a
    lo de fábrica, también si la clave falta en la copia local que escribió una pestaña vieja) y uno nuevo
    arranca con el del navegador.
  - **Nada se sube antes de leer la cuenta** en cada sesión: se lee, se fusiona (solo ganan las claves
    cambiadas en el dispositivo y todavía sin subir, `dirtyKeys`) y recién ahí se escribe. Así un cambio
    hecho sin red, o mientras se leía, no pisa la cuenta con lo de fábrica.
  - **Nada de lo guardado cambia:** Script y pregunta siguen siendo párrafos con `script: true` y
    `question: true`; "Guion" y "Pregunta" son solo etiquetas del menú "/" y del selector de tipo. Los
    nombres por defecto que la app crea (un proyecto nuevo) salen en el idioma del momento.
  - **Castellano rioplatense y claro, con vos.** Términos fijos: página, proyecto, workspace (queda así),
    papelera, compartir, miembro, invitado, dueño, admin. Los permisos: Ver, Comentar, Editar, Editar y crear
    páginas.
  - **Quedan en inglés:** las páginas legales (`/privacy`, `/terms`: es el texto que revisa Google y el que
    vale; con la app en castellano muestran una nota que lo dice), la guía para crear un workspace y los
    mensajes que manda el portero (el informe técnico de *Media test* también, hasta que salió en v0.042). Los avisos que la app guarda en el
    dispositivo (el motivo de una subida detenida, de un comentario rechazado) se guardan en inglés y se
    traducen al mostrarlos (`localize`), así una versión vieja los sigue mostrando bien.
  - **Los textos de lo que se baja aparte viajan con esas partes** (`src/i18n/lazy/`: editor, carrete,
    panel de comentarios, miembros y compartir, Drive); la primera carga trae el
    resto, con los dos idiomas (unos 16 KB comprimidos).
- **D-17 · Archivos grandes en el Drive del dueño** (2026-09-29). El plan gratis de Supabase trae 1 GB
  de archivos: unas 300 fotos de teléfono o un video de rodaje. Detalle en la sección 5 de
  `Plan_Workspaces.md`. Hoy el portero está publicado y probado con *Media test* (v0.022 a v0.028); el
  uso en las páginas llega con los pasos 6 a 8 de ese plan:
  - Los originales van al **Drive del dueño del workspace**, también lo que suben miembros e invitados.
  - Una carpeta por proyecto y adentro por día de calendario. Renombrar el proyecto renombra su carpeta;
    las páginas apuntan al id del archivo, así que nada se rompe.
  - **El dueño elige dónde va la carpeta de la app** (la raíz de su Drive u otra carpeta suya); la app no
    decide por él. **Ningún nombre de carpeta que crea la app lleva espacios:** guiones bajos, y la de la app
    se llama `LGA_ShotDocs`, igual que el repo (pedido de Lega, 2026-09-30). **Tampoco las que suelta el
    usuario en una página** («Día 2 - Puerto» queda `Día_2_-_Puerto`, y sus subcarpetas): D3 → B, 2026-10-02.
    El 2026-10-01 Lega había delegado y quedó respetar el nombre (v0.089 a v0.127); lo cambió: ninguna carpeta
    que la app crea en el Drive lleva espacios, nunca (`Doc_Carpetas.md`).
  - **Los videos se reproducen adentro de la app** (teléfono, web y app instalada), y hay un **carrete**
    de fotos y videos de la página. Lo que el navegador no pueda reproducir muestra la miniatura y se baja.
  - Pegar un link de Drive ofrece mostrarlo como link, texto o tarjeta reproducible, como en Coda.
  - Papelera de archivos por proyecto, con miniaturas y peso. El dueño y los admins pueden vaciarla.
  - Un portero de archivos por workspace (en Cloudflare) chequea permisos y pasa los archivos de Drive;
    nadie más recibe la conexión con el Drive del dueño.
  - Carpeta por el día en que se subió. Cada archivo de la papelera se borra solo a los 30 días de haber
    entrado (se construye apagado hasta que Lega lo confirme: `Plan_Workspaces.md`, sección 11).
- **D-18 · Cada workspace es una isla** (2026-09-29). Detalle en `Plan_Workspaces.md`:
  - Un workspace es de un dueño, con varios proyectos y su equipo; usa el Supabase, el Drive, el Resend y
    el portero del dueño. El de Lega se llama **Wanka** (el Supabase de hoy).
  - La misma persona puede estar en varios workspaces y tener el suyo. Una sola app para todos.
  - Al abrir la app por primera vez: unirse a un workspace (con invitación) o crear uno con una guía paso
    a paso. Crear uno exige un dominio propio para el correo (Resend).
  - Roles: dueño, admin, miembro, invitado. Solo el dueño y los admins crean proyectos. Permisos por
    proyecto o página: ver, comentar, editar, editar y crear páginas.
  - Compartir con un cliente: por correo, con login, desde el navegador sin instalar, solo las páginas
    elegidas con sus subpáginas; comenta, responde preguntas y sube archivos según el permiso.
  - Copia de seguridad automática, antes que todo lo demás: repo privado de GitHub `z_shotdocs_backup`,
    cuatro veces por día, cifrada.
  - Sacar a alguien borra lo de ese workspace en su dispositivo la próxima vez que se conecta (solo con
    una señal explícita de la base, nunca por un error); lo que
    tuviera sin subir, mejor que no se pierda. Sus proyectos compartidos pasan a otro admin; los privados
    se van con él. Nadie ve los proyectos privados de otro, tampoco el dueño.
  - Los clientes pueden recibir un proyecto entero o páginas, y ven los nombres del equipo. Ver incluye
    bajar. La invitación, al principio, es un link que se copia.
  - Queda por diseñar al implementarlo: cómo no perder lo que tuviera sin subir alguien a quien se saca.
    Propuesta, a confirmar por Lega (`Plan_Workspaces.md`, paso 9 de la sección 11): antes de borrar lo
    del workspace en el dispositivo, si hay cambios sin subir, la app ofrece bajarlos como archivo.

- **D-19 · Las fotos van en línea, como un carácter del renglón** (2026-10-01). Lega: "como en Coda o en
  cualquier lado". El cursor se pone al lado de una foto, se escribe o se pega otra ahí, las fotos fluyen y
  bajan de renglón cuando no entran, Backspace sube una foto al renglón de arriba, y varias fotos seguidas se
  eligen como letras y se acomodan de una. Reemplaza el modelo de la foto como bloque (`Doc_Imagenes.md`). Sin
  esto no se importa ningún doc de Coda de forma definitiva. Diseño: `Doc_Fotos_En_Linea.md` (roadmap P.15).
- **D-20 · La app muestra las fotos HEIC** (2026-10-01). Las que se sueltan en el editor, además de las que
  convierte el comando de Coda (v0.072). Hecho en v0.075: se guardan tal cual al agregarlas y se pasan a JPEG en
  el dispositivo antes de registrarlas (`Doc_Imagenes.md`, "Fotos HEIC"). Lo que falta, en el roadmap B.13.
- **D-21 · Licencias de terceros: libheif (LGPL-3.0)** (2026-10-01). Lega: la app "nunca será comercial, será
  open source, aunque yo la use para mi trabajo". La app es MIT y, para convertir las fotos HEIC, usa
  `libheif-js` (libheif con el decodificador libde265, las dos LGPL-3.0). Se usa sin modificar, cargada como
  archivos aparte (el `.wasm` y su cargador, fuera del paquete de la app) y reemplazable: cualquiera instala
  otra versión y vuelve a armar la app. El aviso de licencia va en `THIRD_PARTY_NOTICES.md` (raíz del repo, en
  inglés), con link desde la sección *License* del README; la app publicada lo sirve igual, con los textos de la
  LGPL-3.0 y la GPL-3.0, en `/licenses/` (`public/licenses/`), y los archivos que llevan libheif empiezan con un
  comentario que apunta ahí. Ese archivo lista también lo demás que pide aviso:
  BlockNote (MPL-2.0) y las tipografías (SIL OFL 1.1); el resto de las dependencias de producción es MIT, ISC,
  BSD, Apache-2.0, 0BSD o CC0. Una dependencia nueva con otra licencia se suma ahí en la misma tanda.
  Patentes de HEVC: riesgo bajo para un proyecto open source no comercial; se vuelve a mirar solo si cambia
  el carácter del proyecto.
- **D-22 · Fotos en línea: cuatro detalles de la entrega 1b** (2026-10-01, Lega: "sí" a las propuestas). Espacio
  con una foto en línea elegida abre el carrete, como con la foto-bloque; la barra propia de la foto (ver,
  tamaños, acomodar) llega con la entrega 2 y hasta entonces sale la de texto; el texto plano al copiar a otro
  programa (`![nombre](sdmedia://…)`) se resuelve con la exportación de la entrega 3; el panel de comentarios
  muestra cada foto en línea como `[Image]`. `Doc_Fotos_En_Linea.md`, "Cómo quedó (entrega 1b)".
- **D-24 · Fotos en línea: paridad con la foto-bloque, sin leyenda, la barra por sectores** (2026-10-01, Lega, al
  probar la entrega 2 y rechazarla como estaba). (1) La foto en línea hace **todo** lo que hace la foto-bloque
  (tiradores que imantan a 1/1, 1/2, 1/3 y 1/4; la barra entera: ver, bajar, tamaños, alinear, que en la foto en
  línea alinea su renglón, *Arrange in rows*, comentar, *Replace image*, *Rename image*, *Delete image*; el carrete;
  primer clic elige y segundo abre; videos y adjuntos como hoy) más lo propio de en línea. El inventario, con lo
  hecho y lo que falta, en `Doc_Fotos_En_Linea.md`, "Paridad con la foto-bloque". (2) **Sin leyenda:** se saca
  *Edit caption* de la barra, también de la foto-bloque; una leyenda que ya existe se sigue mostrando (no se borra
  ni se esconde), solo no hay botón para crearla. (3) **La barra, por sectores con separador**, igual en las dos:
  [ver, bajar] | [tamaños y *Arrange in rows*] | [alinear izquierda, centro, derecha] | [comentar] y, a la derecha,
  [*Replace*, *Rename*, *Delete*]; todos los botones del mismo tamaño y el mismo relleno. (4) **Sin *Toggle preview*** en
  ninguna de las dos (Lega: "afuera, el nombre del archivo no importa").
- **D-26 · Convertir las fotos-bloque: función escondida, sin entrada en la interfaz** (2026-10-01, Lega). La app no
  tiene usuarios, las únicas fotos-bloque son de proyectos de prueba (que Lega va a borrar) y ERSO se reimporta con
  las fotos en línea (entrega 4): nunca va a haber fotos viejas para convertir. *Convert photos to inline* sale del
  menú de la página (con sus textos y su entrada de ayuda); el código (`convertPhotos.ts`) y sus pruebas quedan,
  sin nada que lo llame, por si alguna vez entra algo con fotos sueltas. `Doc_Fotos_En_Linea.md`, "Cómo quedó
  (entrega 3)".

- **D-23 · Archivar y borrar proyectos** (2026-10-01, Lega: "sí a todo" a las once propuestas del diseño,
  `Doc_Proyectos_Borrar.md`, sección "Decisiones de Lega"). (1) Archivan, borran y restauran quienes pueden
  compartir el proyecto entero; la casilla de Drive y el borrado definitivo, solo dueño y admins. (2) Un archivado
  se edita, con la marca a la vista. (3) Drive: la carpeta entera del proyecto, avisando que se lleva lo puesto a
  mano. (4) La casilla de Drive arranca destildada. (5) 30 días para restaurar; al vencer no pasa nada solo.
  (6) *Delete forever* existe (entrega 3), solo dueño y admins, después de los 30 días, como marca (ninguna fila se
  borra). (7) Íconos al pasar el mouse y con el foco; "⋯" en el teléfono; renombrar es el lápiz del renglón.
  (8) La palabra es la del idioma de la app (`delete` / `borrar`). (9) En *Deleted projects* lo ven todos los que lo
  veían; quién lo borró, dueño, admins y quien lo maneja; los números, solo quien lo maneja. (10) El último
  proyecto activo no se archiva ni se borra. (11) Se sube `min_app_version` antes del primer borrado.
- **D-25 · Espacio en el dispositivo y "Available offline"** (2026-10-01, P.10). Reemplaza la propuesta anterior
  de liberar solo a mano. (1) **Tope automático de 2 GB por dispositivo:** pasado eso, la app borra las copias
  ya confirmadas en el Drive que hace más que no se abren; la miniatura queda siempre; nunca se borra algo no
  confirmado en el Drive. (2) **Available offline** para una página (con sus subpáginas) o un proyecto entero:
  baja lo que falta para usarlo sin red y lo mantiene al día mientras haya red; lo marcado no cuenta para el tope
  y nunca se libera solo. (3) **Una ventana al marcar** con casillas y su peso: fotos en grande (2048 px) tildada,
  fotos originales destildada, adjuntos de hasta 50 MB tildada, videos destildada, carpetas del Drive destildada
  (P.9); pesos de todo, también de lo destildado, y el total de lo elegido, con un indicador circular mientras
  calcula; el espacio libre del dispositivo y no arranca si no entra; barra de progreso y aviso de listo.
  (4) **A mano**, "Espacio en este dispositivo" en el menú de la cuenta: cuánto ocupa, lo marcado, *Free up
  space* y desmarcar. Diseño: `Doc_Copias_Locales.md`.
  **Respuestas de Lega a las propuestas del diseño (2026-10-01), que ajustan lo anterior:** (a) **el tope lo pone la
  persona**: la ventana de "Available offline" y "Espacio en este dispositivo" muestran el tope y cuánto se está
  ocupando, "para decidir antes de activar"; se puede cambiar; de fábrica, **2 GB por workspace**. (b) **Esperar y
  avisar antes de liberar**: nunca se libera solo sin aviso previo ("this is taking X, free up space?"); lo marcado
  offline no se libera nunca solo; lo no marcado sí, con ese aviso. (c) "Lo marcado offline se mantiene siempre en la
  versión tildada" (de fábrica, fotos en 2048); los originales propios ya confirmados en el Drive son liberables,
  **siempre con aviso previo**; lo no subido nunca se toca, con o sin red. (d) Sin "Keep on this device" por archivo:
  offline es por página, página con subpáginas, o proyecto. (e) Se muestra cuánto se baja por la red. (f) Los
  comentarios de la rama marcada se bajan siempre; desmarcar borra las copias bajadas (con una casilla para dejarlas).
  (g) Con permiso quitado se borran las copias; al restaurar un proyecto o devolver el permiso "vuelve como online":
  no se vuelve a bajar solo, se vuelve a marcar si se quiere. (h) Sin internet la app dice claramente "Offline" junto
  con lo pendiente ("Offline · 700 to upload").
- **D226 · Tooltips con gesto o atajo** (2026-10-03, Lega). Todo tooltip que nombra un gesto (clic, Shift+clic,
  ⌥/Alt+clic, doble clic, arrastrar) o un atajo de teclado va en renglones, uno por acción: «**gesto o atajo**:
  acción» (*Click or ⌘⌥↩: collapse just for you*). Solo el gesto y el atajo en negrita (blancos); la acción en el gris
  del tooltip. Los atajos salen del registro (`src/ui/shortcuts.ts`) con la forma de cada plataforma (⌘ en la Mac,
  Ctrl en el resto), nunca escritos a mano. En una pantalla táctil, sin atajos de teclado ni gestos de mouse; quien
  no puede hacer una acción no ve su renglón (táctil se decide por el tipo de puntero, no por el ancho). **Ningún
  otro texto de un tooltip va en negrita** (los nombres de los botones, como *Download image*, van en el gris). Los
  arma `src/ui/tipRows.ts` y lo controla `src/ui/tipFormat.test.ts`; *Comment* y *Assistant* de la barra de formato
  también, y desde v0.163 los botones propios de BlockNote en esa barra (*Bold*, *Italic*, alinear…; `src/ui/toolbarTips.tsx`):
  con atajo, su renglón; sin atajo, el nombre (son íconos). Desde v0.165 también la barra de los links (*Open in new tab*,
  *Remove link*: el nombre; *Edit link*, sin globo porque es un botón con texto).
  Todo globo queda adentro de la ventana: abajo, arriba, a un costado o corrido (`Tooltip.tsx`).
- **D303 · Exportar espera solo lo que falta guardar en el dispositivo** (2026-10-06; tomada al arreglarlo, Lega la puede cambiar). Antes de armar el PDF o el
  zip, *Export* espera lo que todavía no llegó al dispositivo: el contenido, el título abierto y su sobrante, los cambios
  del árbol, un archivo a medio guardar y los comentarios. Una carpeta que se está subiendo no lo frena (vuelve a ser
  como antes de la espera de guardado local): lo de adentro va al Drive y no forma parte del PDF ni del zip, donde solo
  está la tarjeta de la carpeta con su link; si se exporta durante la subida, la tarjeta salía con la nota de avance de
  ese momento (*Uploading 3 of 10*) y desde v0.213 sale como va a quedar, con *Google Drive folder* y su peso. Una
  importación o un reemplazo en curso en el proyecto sí lo siguen frenando, porque se exportaría un proyecto a medio
  escribir; desde v0.213 se avisa con su causa y sin esperar.
  Cerrar la pestaña, recargar y cambiar de workspace no cambian: siguen contando también la subida (v0.210;
  `Doc_Exportar.md`, "Guardado local antes del PDF").
- **D304 · Un registro de importación de una versión anterior no bloquea** (2026-10-06; tomada al repararlo, Lega la puede cambiar). Una
  importación de Coda o de un archivo de Shot Docs que quedó sin terminar con v0.210 o anterior no se puede seguir:
  al elegir la carpeta o el zip no se ofrece *Resume*, se ofrece *Import*, que entra a un proyecto nuevo. El proyecto
  que había quedado a medias no se toca, y el registro viejo no se convierte ni se borra: pasa entero a una clave de
  archivo del dispositivo. **Por qué:** la app está en desarrollo, y seguir sobre el formato anterior exigía
  rediseñar (v0.211; `Doc_Importar_Coda.md`, "Si se corta: seguir donde quedó").
- **D305 · La importación es todo o nada por página, ante fallos que se pueden reintentar** (2026-10-06; tomada al repararlo, Lega la puede cambiar). Una
  página con un archivo que no se pudo guardar por algo que puede cambiar al probar de nuevo queda sin escribir hasta
  *Resume*, y ahí entra entera; antes entraba con el texto y las demás fotos y *Resume* la reescribía. Se pueden
  reintentar: el dispositivo sin dónde guardar archivos, un adjunto sin el Drive conectado, no entrar en la cuota,
  quedarse sin espacio al guardar, el tope de lo que se descomprime de una vez, un error al leer el archivo del disco
  y el registro de la importación que no se pudo guardar. **No aplica a lo definitivo** (sin cambios frente a lo
  publicado): un archivo vacío, uno que pasa el tope por archivo, uno dañado o que falta en el zip, o que no está en
  la carpeta, se anotan y la página entra con su texto y lo demás (en el zip, el nombre del archivo queda en su
  lugar). Si la persona escribió en una página que quedó para seguir, su texto queda arriba y lo importado va debajo;
  ya no existe «queda como la dejaste». **Por qué:** no se pierde nada (el texto y los archivos ya guardados esperan
  a *Resume*), y la paridad exacta con el estado intermedio anterior complicaba el guardado atómico de cada página
  para un caso raro (v0.211; mismo doc).
- **D306 · Una página que la carpeta de Coda ya no trae no impide terminar la importación** (2026-10-06; tomada al repararlo, Lega la puede cambiar). Si
  la carpeta se volvió a exportar sin una página entre el corte y *Resume*, la importación termina cuando están
  terminadas las páginas que la carpeta trae ahora. La que ya no está queda en el proyecto como estaba, anotada en
  el registro y nombrada en la lista del final; no se borra ni se manda a la papelera. **Por qué:** antes no cerraba
  nunca, y borrar algo ya importado por un cambio en la fuente es justo lo que la importación no hace (v0.213;
  `Doc_Importar_Coda.md`, "Si se corta: seguir donde quedó").
- **D307 · Del registro de importaciones se conserva el detalle de las tres terminadas más recientes** (2026-10-06; tomada al repararlo, Lega la puede cambiar). Por
  cada carpeta o zip, el dispositivo guarda una generación por importación. De las terminadas más viejas que las
  tres últimas queda solo la identidad (generación, proyecto, operación y nombre); sus páginas y archivos anotados
  se sueltan. Nunca se poda una sin terminar, ni la que vino de un registro de un solo diario, ni un registro
  archivado (D304). **Por qué:** una terminada no se sigue, así que su detalle no se usa; la identidad sí, para que
  una reserva nueva no repita un proyecto (v0.213; mismo doc).
- **D308 · Al cancelar o fallar un zip, el archivo del destino se borra solo si estaba vacío al elegirlo** (2026-10-06; tomada al repararlo, Lega la puede cambiar). El
  selector del navegador crea el `.zip` vacío al elegir el nombre; ese se saca. Uno que al elegirlo tenía contenido
  (se eligió reemplazar un zip anterior) no se borra. Si el navegador no dice el peso, tampoco. **Chrome y Edge
  (los únicos navegadores con ese selector) vacían el archivo existente en el momento de elegirlo**, antes de que la
  app haga nada: sale de leer el código de Chromium (al guardar, crea el archivo si no existe y lo trunca si existe);
  no se vio en un navegador. Entonces, hoy, elegir reemplazar un zip anterior lo pierde igual: queda en 0 bytes al
  elegirlo y, por estar vacío, se saca al cancelar. La regla solo evita llevarse un archivo con contenido en un
  navegador que no lo vacíe. Conservar el zip anterior pide otro diseño (`Doc_Roadmap.md`).
  **Por qué:** desde v0.204 no se borraba nada, para no llevarse un archivo de la persona, y quedaba un zip vacío;
  mirar si estaba vacío da las dos cosas (v0.213; `Doc_Exportar.md`, "Guardado local antes del PDF"). Sin verificar
  en un navegador real.
  Desde v0.216 la misma regla vale para *Download all* de una carpeta, incluido el zip de *Retry missing*
  (`Doc_Carpetas.md`).
- **D309 · *Folder* en el menú "/", solo en computadora** (2026-10-06; tomada al implementarlo, Lega la puede
  cambiar). Abre el selector de carpetas del sistema y sigue el mismo camino que una carpeta arrastrada. En un teléfono
  no se ofrece: ahí el selector de carpetas no está probado y se sigue pidiendo comprimir. No se ofrece sin permiso de
  editar, sin Drive conectado ni entrando por un link.
- **D310 · Quitar el workspace con una carpeta a medio subir avisa y no frena** (2026-10-06; tomada al implementarlo,
  Lega la puede cambiar). La ventana dice cuántos archivos faltan y que esa subida se corta. **Por qué:** los archivos
  siguen en el disco de la persona; lo que se pierde es la lista de trabajo, no un dato.
- **D311 · Al copiar o cortar, los links a páginas propias llevan el workspace solo en lo que se pega afuera de la
  app** (2026-10-06; tomada al implementarlo, Lega la puede cambiar). El documento y lo que se pega adentro no cambian.
  Entrando por un link público no se agrega nada (no se copia el acceso a escondidas), y el arrastre no se toca.
- **D312 · La lista de archivos por peso la ve quien ve el peso del proyecto, y cada uno ve lo que la base le deja
  leer** (2026-10-06; tomada al implementarlo, Lega la puede cambiar). La entrada está donde se ve el peso (quien ve
  la papelera de archivos del proyecto: el dueño, los admins con algún permiso sobre el proyecto entero y quien tiene
  "Editar y crear páginas" sobre el proyecto entero). La lista se lee de `files` y `page_files` con la sesión, sin
  función nueva ni migración. **Consecuencia:** un admin con solo *Ver* no recibe los archivos sacados de páginas que
  no edita ni los de páginas que están en la papelera; la lista le dice cuánto falta para llegar al número del
  proyecto. La alternativa es una función con la puerta de la papelera, que le mostraría todo
  (`Doc_Peso_Proyectos.md`, "Cómo quedó: la lista por peso").
- **D313 · La lista por peso muestra lo que ocupa lugar en el Drive y solo se lee** (2026-10-06; tomada al
  implementarlo, Lega la puede cambiar). Entra lo subido que no se mandó a la papelera de Drive, con lo de la papelera
  de la app marcado como sin uso; no entra lo que todavía no subió ni lo que ya está en la papelera de Drive. Se abre
  desde el pie del selector de proyectos (*Files by size*, arriba de *Trash*), con un desplegable para elegir el
  proyecto, el más pesado primero; no desde un ícono en cada renglón (le saca ancho al subtítulo, donde está el
  peso), ni desde el diálogo de Google Drive, ni desde la papelera. No borra ni reemplaza: el link abre la página.
- **D314 · La base limpia «(via link)» del nombre del visitante; no rechaza el pedido** (2026-10-06; tomada al
  implementarlo, Lega la puede cambiar). El roadmap decía "que la base rechace". Rechazar es un error definitivo: un
  comentario o una edición de una app anterior a v0.215 con el rótulo en el nombre quedarían sin entregar para siempre.
  Se guardan con el nombre limpio; si el nombre era solo el rótulo, queda `-`. La otra opción: rechazar
  (`author_invalid`) y aceptar esa pérdida (`Doc_Link_Publico.md`, "El nombre del visitante sin el rótulo, también en la
  base").
- **D315 · El nombre de un comentario importado puede seguir trayendo «(via link)»** (2026-10-06; tomada al
  implementarlo, Lega la puede cambiar). Al importar un archivo exportado, la app escribe `Ana (via link)` como autor de
  lo que se había comentado por un link, para que no se pierda de dónde vino. Por eso `import_comment` no limpia ese
  nombre, y quien puede importar en una página (Editar y crear páginas) puede escribirlo como autor: se ve con la
  marca de importado, no con el estilo de un visitante. La otra opción: que el archivo diga "vino por un link" en un
  campo aparte y la base saque el rótulo también ahí.
- **D316 · De qué link vino un comentario: una línea siempre a la vista, solo para quien comparte la página del link,
  y sin decir en qué página está** (2026-10-07; tomada al implementarlo, Lega la puede cambiar). Debajo del nombre del
  visitante va *Can view link · created by lega*, también cuando el link ya se apagó, se renovó o venció (*closed*,
  *expired*): el comentario queda, y saber que su link ya está cerrado es lo que evita ir a buscarlo. Quien comenta o
  edita sin poder compartir la página del link no ve nada (lo más conservador: la base no le contesta). La base no
  entrega la página raíz del link: en *Share* de la página del comentario ya figuran su link y el de más arriba. Las
  otras opciones: mostrarlo solo al pasar el mouse, ocultar el de un link cerrado, o sumar el título de la página del
  link (`Doc_Link_Publico.md`, "De qué link vino cada comentario (v0.222)").
- **D317 · El rótulo del link no se guarda en el dispositivo ni sale en lo exportado** (2026-10-07; tomada al
  implementarlo, Lega la puede cambiar). Se pide a la base y se recuerda solo mientras dura la sesión: sin red el
  comentario se ve sin rótulo, y otra cuenta en la misma pestaña no recibe nada de la anterior. El PDF y el zip siguen
  diciendo solo `Ana (via link)`: lo exportado lo lee gente que no administra el link. La otra opción: guardarlo en el
  dispositivo por cuenta, para verlo sin red.
- **D318 · Las listas largas le piden el total a la API en vez de hacer un pedido más** (2026-10-07; tomada al
  implementarlo, Lega la puede cambiar). Para no suponer cuántas filas entrega la API por pedido hay dos formas: pedir
  el total con el mismo pedido, o seguir hasta una página vacía. Se eligió el total: una sincronización hace los
  mismos pedidos que antes, a cambio de que la base revise dos veces los permisos de las filas (el árbol pasa de 8 a
  15 ms). Dos excepciones, donde contar sale caro y la lista no se pide en cada sincronización: los archivos por id
  (se vuelve a pedir lo que no llegó) y los archivos por peso (un pedido más, vacío, al final). La otra opción: la
  página vacía en todas, que no carga a la base y suma un pedido por lista (`Doc_Sincronizacion.md`, "Las listas
  largas").
- **D319 · Una lista de un pedido que la API recortó es un error, salvo donde un error deja peor que una parte**
  (2026-10-07; tomada al implementarlo, Lega la puede cambiar). El equipo, quién tiene acceso, los proyectos borrados
  y el peso de los proyectos: si no entran en el tope de filas del workspace, la pantalla dice *This list is longer
  than this workspace's database sends in one request…* en vez de mostrar una parte como si fuera todo. Las
  invitaciones y los nombres de versión llevan el mismo control, pero sus pantallas no muestran errores: no se ven.
  Con el tope de fábrica (1000) nada de eso pasa. **Sin el control, con lo que llega, como antes:** lo apartado de
  los links y la papelera de un proyecto en una base sin la función nueva (pasan de 1000 de verdad, y un error las
  dejaba vacías), los candidatos del `@` y lo que no entró de un link en una página (quien las pide se traga el
  error). Los correos de quienes comentaron o escribieron se piden por clave, enteros. La otra opción: paginar todas
  por su clave, que es más trabajo y queda anotado (`Doc_Sincronizacion.md`, "Las listas largas", la tabla).
- **D320 · Los comandos esperan a Supabase un minuto por un ajuste y diez por el SQL** (2026-10-07; tomada al
  implementarlo, Lega la puede cambiar). El tope es por pedido: una migración o una prueba larga que está respondiendo
  no se corta (la API corta por su cuenta cerca de los 100 segundos). Se cambian con `SUPABASE_API_TIMEOUT` y
  `SUPABASE_QUERY_TIMEOUT`, en segundos (`Doc_Supabase.md`).
- **D321 · Si el árbol de un link cambia mientras se baja, se empieza de nuevo hasta 3 veces; si no deja de cambiar,
  el visitante sigue con el árbol que tenía** (2026-10-07; tomada al implementarlo, Lega la puede cambiar). Con una
  rama más grande que el tope de filas de la API el árbol llega en varios pedidos, y todas sus filas tienen que ser
  del mismo estado (la misma firma). Si cambia a mitad, lo juntado se descarta. Después de 3 intentos el visitante
  sigue con el árbol que tenía, sin aviso (lo que escribió sube igual), y la bajada se vuelve a probar de a un
  intento: a los 20 segundos, después el doble cada vez, hasta cada 10 minutos. Solo si todavía no bajó ningún árbol
  desde que abrió la app ve un aviso, que se va solo. La otra opción: seguir intentando en cada sincronización (cada
  intento cuenta en el tope del día del link: se gastaba en minutos), o quedarse con una mezcla de dos estados
  (`Doc_Sincronizacion.md`, "Las listas largas", "El modo link").
- **D322 · Lo que no entró de un link en una página se pide entero, con una función nueva, y el aviso no dice «500 de
  N»** (2026-10-07; tomada al implementarlo, Lega la puede cambiar). El aviso de la página contaba y descargaba hasta
  500. Había dos formas: que la función de siempre dijera el total y el aviso mostrara «500 de N», o poder seguir desde
  la última fila. Se eligió seguir (`public_link_updates_page`): el aviso cuenta y *Download it* baja todo, sin un
  texto nuevo. La función de siempre queda igual para la app publicada. Con miles de filas en una página, el aviso
  hace un pedido cada 1000 al abrirla y como mucho una vez por minuto.
- **D323 · Las páginas con link y los pedidos de acceso siguen llegando con lo que entra en un pedido** (2026-10-07;
  tomada al implementarlo, Lega la puede cambiar). Para que `public_link_pages` pase del tope de fábrica hacen falta
  más de 1000 links vivos, y lo que faltaría es el ícono del árbol en algunas páginas o la dirección del link en un
  PDF. `access_requests_pending` muestra los 100 pedidos más nuevos y, al decidir uno, aparece el siguiente. Lo
  apartado de los links, en cambio, sí pasa a llegar entero: de ahí salen el ícono del árbol y la lista de *Share*.
  La otra opción: paginar las dos por su clave (`Doc_Sincronizacion.md`, "Las listas largas", "Lo que queda").
- **D324 · Cada pedido de más del árbol de un link cuenta el árbol entero en su tope del día** (2026-10-07; tomada
  al implementarlo, Lega la puede cambiar). Se arregló sin migración: la base cuenta cada pedido con los bytes de
  toda la lista. Solo pesa con una rama más grande que el tope de filas (que antes llegaba cortada), y ahí crece con
  el cuadrado de la rama: con el tope de fábrica, 1501 páginas son 56 bajadas del árbol por día, 5001 son 5, 10001 es
  una y desde unas 12.800 el link no carga; con un tope de 137, 1501 páginas son 10. Con el tope lleno nadie baja el
  árbol ni los comentarios nuevos de ese link hasta el día siguiente. **Hay que resolverlo antes de usar links sobre
  ramas de más de 1000 páginas.** La otra opción, anotada con su diseño: una función que entregue el árbol de a
  páginas y cuente lo que entrega, con migración (`Doc_Sincronizacion.md`, "Las listas largas", "Lo que cuesta: el
  cupo del día del link").
- **D325 · Al editar un comentario, la base compara el texto del que partió la persona, no la fecha de la última
  edición** (2026-10-07; tomada al implementarlo, Lega la puede cambiar). El roadmap proponía mandar el `edited_at`
  que el dispositivo tenía. Se manda el texto: un comentario nunca editado no es un caso aparte, no depende de cómo
  viaja una fecha ni de la hora de ningún dispositivo, y dos ediciones seguidas del mismo dispositivo se encadenan
  solas (la segunda parte del texto de la primera), sin que la app tenga que reescribir nada al confirmar. Lo que se
  pierde: si el comentario cambió y volvió a quedar igual que antes, la edición entra (el texto que la persona vio es
  el que está). La otra opción: `edited_at`, o un contador nuevo en la tabla, que pide cambiar lo que devuelven las
  listas de comentarios (`Doc_Sincronizacion.md`, "Dos ediciones del mismo comentario").
- **D326 · La edición que no entró queda apartada en el dispositivo, fuera de la cola, y cuenta con lo rechazado**
  (2026-10-07; tomada al implementarlo, Lega la puede cambiar). No es un rechazo más de la cola: lo rechazado se
  reintenta cada vez que abre la app, y una versión anterior de la app que tomara esa edición la mandaría sin base y
  pisaría. Queda guardada aparte, nada la manda sola, y lo que la persona hizo después sobre ese comentario, todavía
  no había salido y partía de ese texto va con ella (lo apartado es su último texto; sus menciones no se mandan sobre
  el texto de otro dispositivo). Hay un solo texto apartado por comentario y nada lo reemplaza sin que la persona lo
  haya visto: otra edición del mismo comentario que también choca y no partía de él (una rechazada vieja que se
  reintenta) queda en la cola como rechazada, con su texto, en vez de ocupar su lugar. En el estado suma a *N changes
  rejected by the server*, con su texto en el detalle, y va en el archivo de lo que no se subió; si todo lo rechazado
  son ediciones apartadas, el detalle no ofrece *Retry* y dice dónde se decide. La otra opción: un número aparte en
  el estado ("1 edit to review").
- **D327 · Lo que ve la persona: los dos textos con su rótulo y tres acciones, *Keep mine*, *Discard mine…* y *Copy
  mine*** (2026-10-07; tomada al implementarlo, Lega la puede cambiar). En el comentario, primero *Saved now, changed
  from somewhere else* con lo guardado y después *What you wrote on this device* con lo propio, y arriba una oración
  que dice que no se perdió nada. Hasta decidir no se ofrece *Edit* sobre ese comentario (borrarlo, sí). El roadmap
  decía *Keep the other*: se llama *Discard mine…* porque es lo que pasa (lo guardado ya está guardado; lo que se va
  es lo propio). No hay un cuadro para juntar los dos textos: se copia uno y se edita el otro. Si el cuadro de edición
  ya estaba abierto cuando llegó el conflicto, sigue abierto con un aviso, y lo que se guarda desde ahí pasa a ser lo
  propio que espera decisión (no se manda). En un hilo resuelto, los resueltos se abren solos. La otra opción: sumar
  *Edit mine*, que abre el cuadro con lo propio sobre lo guardado.
- **D328 · Descartar lo propio pide confirmación y no se puede deshacer; lo apartado se va solo únicamente si la base
  termina teniendo ese mismo texto** (2026-10-07; tomada al implementarlo, Lega la puede cambiar). *Keep mine* manda
  lo propio sobre lo que la persona está viendo como guardado; si la base volvió a cambiar mientras tanto, vuelve a
  quedar apartada (nunca pisa lo que no se vio). Si el comentario se borra después, lo apartado sigue a la vista en
  el comentario borrado, solo para copiarlo o descartarlo. "Se va solo" vale también cuando las menciones que
  quedaron en la base son otras que las de la edición apartada: el texto está guardado, y a quien ella nombraba no se
  le avisa. Fuera de ese caso, lo único que cambia lo apartado es la persona: decidir, o guardar otro texto desde un
  cuadro que ya tenía abierto con ese (pasa a ser lo apartado). La otra opción: vencerlo a los N días, que es perder
  texto sin que nadie lo pida.
- **D329 · `min_app_version` se sube a 0.227 al publicar** (2026-10-07; tomada al implementarlo; por la LEY 1 no
  espera a nadie). No hace falta para que ande: la app publicada sigue editando con la firma de dos argumentos, igual
  que hoy. Pero esa firma guarda lo que llega, así que mientras quede abierto un dispositivo con una versión anterior
  a la v0.227 su edición tardía sigue pisando en silencio. Con la mínima en 0.227 la base frena de verdad una edición
  nueva hecha desde una versión vieja (503 `app_outdated`: no escribe, y queda en su cola para reintentar).
  **Achica el hueco, no lo cierra:** lo que la versión vieja ya dejó en la cola no dice de qué texto partió; al
  actualizarse toma de base lo que el dispositivo tiene guardado, que acierta si no bajó nada en el medio y, si no,
  entra como antes. `plink_edit_comment` no cambia: el visitante de un link edita lo suyo solo desde el navegador con
  el que lo escribió, así que no hay dos dispositivos que choquen (dos pestañas de ese navegador siguen con «gana la
  última»).
- **D332 · El cuadro de edición que no puede guardar: lo dice, ofrece copiar lo escrito y *Cancel* pide
  confirmación** (2026-10-07; tomada al implementarlo, Lega la puede cambiar). Pasa cuando el cuadro está abierto
  sobre lo guardado y una edición rechazada de antes se reintenta, choca y queda esperando decisión: desde ese cuadro
  no se puede guardar. El aviso lo dice, el cuadro suma *Copy text* y *Cancel* pregunta antes de descartar (solo
  ahí; en los demás cuadros *Cancel* sigue sin preguntar). Van las dos cosas: copiar es la salida que conserva el
  texto, y la confirmación es lo que impide perderlo por un clic. *Save* no se apaga: si se toca, el error dice lo
  mismo. La otra opción: dejar guardar ese texto como una segunda edición apartada (rompe «un solo texto apartado
  por comentario», D326).
- **D333 · Salir de la cuenta pregunta también por lo rechazado y por las ediciones que esperan decisión**
  (2026-10-07; tomada al implementarlo, Lega la puede cambiar). La pregunta contaba solo lo pendiente. Ahora suma
  lo que el servidor rechazó (del árbol, de archivos y de comentarios) y las ediciones apartadas, con un solo número
  y las mismas palabras que el estado (*N changes were rejected by the server and are only on this device…*); con
  lo pendiente además, van las dos oraciones. No frena la salida: avisa. La otra opción: un número aparte para las
  ediciones que esperan decisión.
- **D334 · La lista de páginas atrasada de un link se dice en el detalle del estado, sin cambiar la insignia**
  (2026-10-07; tomada al implementarlo, Lega la puede cambiar). No cambia D321: sigue sin ser un error y sin frenar
  la subida. La insignia sigue diciendo «All synced» (lo del visitante está todo subido) y su detalle suma una
  línea que se va sola. La otra opción: cambiar el texto de la insignia («Updating the page list…»), más visible y
  más ruidosa para algo que el visitante no puede resolver.
- **D335 · Con varios textos rechazados del mismo comentario, el cartel los lista, cada uno con su *Copy text***
  (2026-10-07; tomada al implementarlo, Lega la puede cambiar). Mostraba y copiaba solo el primero. Cada texto va
  en un renglón, cortado con «…». *Retry* y *Discard…* siguen valiendo para todos juntos. Con uno solo, el cartel
  queda como estaba (no muestra el texto). La otra opción: descartar o reintentar cada uno por separado.
- **D336 · Un link revocado se nota por los comentarios de la página abierta; no se suma ningún pedido**
  (2026-10-07; tomada al implementarlo, Lega la puede cambiar). Mientras el árbol espera su próximo intento (hasta 10
  minutos, D321), lo único que el visitante le pide al link en cada ciclo son los comentarios de la página que tiene
  abierta: si esa respuesta dice que el link ya no anda, la pantalla lo muestra. No gasta nada del tope del día. La
  otra opción: un pedido propio por ciclo (`plink_open` cuenta en el tope de aperturas, 300 por día por link, y no
  alcanza para un visitante con la pestaña abierta varias horas).
- **D337 · Un hilo con un cuadro abierto se queda donde está; la respuesta a un hilo que se resolvió mientras tanto
  se puede mandar y no lo reabre** (2026-10-07; tomada al implementarlo, Lega la puede cambiar). Mientras hay una
  respuesta o una edición abierta en un hilo, el panel no lo cambia de lista aunque se resuelva o se reabra desde
  otro lado: un aviso discreto lo dice. Mandar la respuesta la guarda en el hilo, que **sigue resuelto** (la base ya
  lo aceptaba así); al cerrarse el cuadro el hilo pasa a los resueltos, que se abren para que se vea. Las otras
  opciones: que mandar una respuesta reabra el hilo (deshace lo que otra persona decidió, y un visitante de un link
  no puede reabrir), o no dejar mandar hasta reabrirlo a mano.
- **D338 · El cuadro de un comentario o un hilo que se borró desde otro lado no puede guardar** (2026-10-07; tomada
  al implementarlo, Lega la puede cambiar). Lo tipeado sigue a la vista con *Copy text*, *Save* / *Reply* quedan
  apagados y *Cancel* pide confirmación (el mismo cuadro de D332). La otra opción: dejar mandar (la base acepta una
  respuesta en un hilo cuyo primer comentario se borró, y una edición quedaría rechazada con su texto): más caminos
  y un hilo que reaparece con su primer comentario borrado.
- **D339 · Cambiar de página con un comentario a medio escribir no pregunta: deja un aviso con *Copy text***
  (2026-10-07; tomada al implementarlo, Lega la puede cambiar). El aviso dura 15 segundos (el de siempre) y sale
  cada vez que un cuadro con algo escrito se desmonta sin que la persona lo cierre: al cambiar de página, o si la
  página deja de verse. Cerrar o recargar el navegador sí pregunta. Las otras opciones: preguntar antes de cambiar
  de página (hoy nada frena un cambio de página; hay 45 llamadores de `navigate`, y el Atrás del navegador no se
  puede frenar), o guardar el borrador de cada cuadro y devolverlo al volver a la página (más interfaz: habría que
  mostrar que hay un borrador esperando).
- **D340 · Con varios textos rechazados del mismo comentario, los botones llevan la cantidad** (2026-10-07; tomada
  al implementarlo, Lega la puede cambiar). *Retry all 3*, *Discard all 3…* y *Discard all 3*, y la confirmación en
  plural; con uno solo, como siempre. Completa D335 (siguen valiendo para todos juntos). *Retry* reintenta además
  todo lo rechazado de la app, como siempre.
- **D341 · Salir de la cuenta y quitar el workspace del dispositivo preguntan también por un comentario a medio
  escribir, en la misma pregunta** (2026-10-07; tomada al implementarlo, Lega la puede cambiar). Completa D333: la
  pregunta de salir suma una oración (*A comment you are writing has not been sent and will be lost.*, con la
  cantidad si son varios) a lo pendiente y a lo rechazado, y la de quitar el workspace lleva la misma. Con un «no»,
  el cuadro sigue como estaba. La otra opción: una pregunta aparte antes de la de siempre (dos carteles seguidos,
  como hoy al cambiar de workspace).
- **D342 · Un comentario nuevo con algo escrito se queda cuando se le pide otra cosa al panel** (2026-10-07; tomada
  al implementarlo, Lega la puede cambiar). Abrir un hilo desde el margen o la campana, o tocar *Comment* en otro
  bloque, ya no lo cierra: puede haber un comentario nuevo en curso por bloque y uno de la página, cada uno hasta
  que se manda o se cancela; el vacío se va solo, como siempre. La otra opción: preguntar antes de reemplazarlo (un
  cartel para un gesto frecuente, como tocar la marca de otro hilo para leerlo mientras se escribe).
- **D343 · Varios cuadros con algo escrito que se cierran a la vez van en un solo aviso** (2026-10-07; tomada al
  implementarlo, Lega la puede cambiar). Completa D339: el aviso dice cuántos son y su botón, *Copy all 3*, copia
  todos los textos separados por una línea en blanco. La otra opción: listar cada texto en el aviso con su botón
  (como el cartel de D335), más alto que lo que entra abajo de la pantalla en un teléfono.
- **D344 · El rótulo de los resueltos cuenta los hilos resueltos de verdad** (2026-10-07; tomada al implementarlo,
  Lega la puede cambiar). Un hilo que se reabrió desde otro lado y sigue en esa lista por su cuadro abierto (D337)
  no cuenta: mientras sea el único ahí, el rótulo dice *0 resolved threads*. La otra opción: esconder el rótulo en
  ese caso (se pierde el botón de plegar la lista mientras dura el cuadro).
- **D345 · El cursor de los comentarios pide desde un minuto antes hasta quedar asentado, y el asentado se guarda**
  (2026-10-07; tomada al implementarlo, Lega la puede cambiar). Lo anotado era «pedir siempre con un minuto de
  margen». El minuto sale del tope de 8 segundos por sentencia, con lugar de sobra. No se pide así siempre porque los
  comentarios importados de una página entran todos en unos segundos: con el margen fijo, cada bajada (una cada 10
  segundos por página abierta) los traería a todos de nuevo para siempre, y en un link contra su tope del día. El
  margen va hasta una bajada con margen hecha un minuto después de la que movió el cursor; ahí el cursor queda
  asentado, se guarda con él, y desde entonces es una fila por bajada, como antes, también al abrir la app de nuevo.
  Con una página de 200 comentarios importados: 1.405 filas la primera vez que se abre en el dispositivo (antes, 211)
  y 12 cada vez que se vuelve a abrir (como antes). Las otras opciones: el margen fijo (más simple, más tráfico) o
  que `list_comments` devuelva la hora de la base, con migración (`Doc_Sincronizacion.md`, "El cursor y los cambios
  que confirman tarde").
- **D346 · El árbol pide el total solo mientras el dispositivo tiene menos de 1000 páginas** (2026-10-07; tomada
  al implementarlo, Lega la puede cambiar). De las dos formas anotadas se eligió «según el tamaño»: no pedir nunca el
  total sumaba un pedido a cada sincronización chica (la de hoy) para ahorrar en las grandes. El tamaño es lo que el
  dispositivo ya tiene; 1000 es desde donde contar cuesta más que una ida y vuelta. Si la base corta por tiempo un
  pedido que contaba, se repite sin contar. Los usos de archivos siguen contando: no tienen un tamaño anterior. La
  otra opción: confirmar siempre el final con un pedido por clave (`Doc_Sincronizacion.md`, "El costo de contar a
  escala").
- **D347 · En la papelera, el error del pedido que junta varios proyectos es una línea con un *Retry* que repite
  ese pedido** (2026-10-07; tomada al implementarlo, Lega la puede cambiar). La línea dice de cuántos proyectos y por
  qué, sin nombrarlos. *Retry* vuelve a hacer el pedido único, no uno por proyecto: si ese pedido no sale nunca, la
  papelera de cada proyecto se sigue viendo abriéndolo (*This project*). La otra opción: que *Retry* pida proyecto
  por proyecto, y que cada uno muestre su propio error.
- **D348 · Lo tipeado en un comentario cuando la app se reemplaza sola queda en un cartel fijo hasta copiarlo o
  descartarlo** (2026-10-07; tomada al implementarlo, Lega la puede cambiar). Otra pestaña que toma el control, sacar
  a la persona, quedarse sin proyectos, un error que frena la app o la sesión que se corta: el texto aparece arriba de
  la pantalla que quedó, entero, con *Copy text* y *Discard* (que pregunta si no se copió), y cerrar o recargar
  pregunta mientras no se copió. También queda en la pantalla de entrada si la sesión se cortó sin preguntar (vive en
  la memoria de esa ventana; salir de la cuenta diciendo que sí a perderlo no lo deja). Las otras opciones: el aviso
  de siempre con 15 segundos en esas pantallas (la persona puede no estar mirando), o guardar el borrador en el
  dispositivo (el diseño de D339, con sus preguntas abiertas). **Para que Lega lo revise:** en la pantalla de entrada,
  sin sesión, el cartel muestra lo de la última cuenta (lo puede ver quien esté frente a esa ventana); si entra otra
  cuenta, se descarta (D350).
- **D349 · Después de un «sí» de la app a perder un comentario a medio escribir, el navegador no pregunta de nuevo**
  (2026-10-07; tomada al implementarlo, Lega la puede cambiar). Vale para *Reload*, forzar la actualización, cambiar
  o quitar el workspace, y solo para lo escrito tal como estaba al contestar; si la salida no ocurre, deja de valer.
  Cambiar de workspace con un comentario y algo sin subir hace una sola pregunta con las dos cosas. La otra opción:
  dejar las dos preguntas (la de la app dice qué se pierde; la del navegador, genérica, no). El «sí» de salir de la
  cuenta se anota recién cuando la salida se ejecuta (cancelar la ventana de salir no deja nada anotado). Lo que quedó
  en el cartel sin copiar solo lo cubre un «sí» a una pregunta que lo contó (salir de la cuenta, cambiar o quitar el
  workspace) y tal como estaba: el de *Reload* o forzar la actualización cuenta solo los cuadros abiertos, así que con
  un cartel el navegador sigue preguntando. Salir de la cuenta descarta el cartel recién cuando la salida ocurrió.
- **D350 · Lo que quedó en el cartel es de la cuenta que lo escribió: entra otra y se descarta; salir de la cuenta lo
  cuenta** (2026-10-07; tomada al implementarlo, Lega la puede cambiar). Si entra otra cuenta en la misma ventana, los
  textos de la anterior se descartan (no se esconden: no quedan en memoria). Las salidas de la cuenta (el menú, la
  pantalla de «sacaron a la persona», la sin proyectos, el error del arranque) cuentan los textos sin copiar del cartel
  en la misma oración que un comentario a medio escribir, y con el «sí» lo descartan. La otra opción: esconderlos
  mientras está la otra cuenta y devolverlos si vuelve la primera (quedan en memoria a mano de otra cuenta).

- **D355 · Estructura estándar de un proyecto: escenas, locaciones y días relacionados** (2026-10-08; tomada al
  reorganizar un proyecto importado de Coda, Lega la puede cambiar). El árbol va por etapas (Mapa,
  Preproducción con desglose, locaciones y scoutings, y decorados; Rodaje con un día por página; Tablas y referencia;
  Archivo); la escena es el eje, con su número completo en el título y sus fichas de desglose adentro; el reporte es el
  día y no se parte; cada relación se escribe una vez donde nace y lo inverso es derivado; sin galerías ni `#` por
  ahora. Detalle y alternativas descartadas (páginas índice por día, la escena como contenedora de reportes partidos):
  `Doc_Estructura_Proyecto.md`, ES1 a ES10.
- **D356 · El aviso de un comentario cerrado con *Copy text* no lo saca ningún otro aviso** (2026-10-08; tomada al
  implementarlo, Lega la puede cambiar). Es lo único que queda de lo tipeado: los avisos que llegan mientras está a la
  vista esperan su turno y salen cuando vence o lo cierran (`keep` en `notice.ts`). La otra opción: mostrar dos avisos
  a la vez, uno encima del otro (más lugar tapado y más casos de superposición).
- **D357 · Un aviso sin botón que llega sobre uno con botón (*Undo*, *Redo*) sale enseguida, y el del botón vuelve
  después con lo que le quedaba (al menos 6 segundos)** (2026-10-08; tomada al implementarlo, Lega la puede cambiar).
  Un aviso sin botón suele ser la respuesta a lo que la persona acaba de hacer y no puede esperar 15 segundos. Uno con
  botón que llega sobre otro con botón lo reemplaza, y el anterior no vuelve (*Undo* y después *Redo*: vale el último).
  La otra opción, la que proponía el roadmap: que el aviso sin botón espere a que venza el que tiene uno.
- **D358 · Lo que espera detrás de un aviso de comentario cerrado vence y tiene tope** (2026-10-08; tomada al
  implementarlo, Lega la puede cambiar). Un aviso que esperó más de lo que iba a estar a la vista (6 o 15 segundos) ya
  no sale: era de otra página o de otra tecla. Esperan como mucho los últimos tres, sin contar otros avisos de
  comentarios cerrados, que esperan todos y no vencen. La otra opción: mostrar todos, en orden, por viejos que sean.
- **D359 · La pregunta de salir dice «A comment you wrote…» (antes «you are writing»)** (2026-10-08; tomada al
  implementarlo, Lega la puede cambiar). La misma oración cuenta los cuadros abiertos y los textos sin copiar del cartel
  (D350), que ya no se están escribiendo; «que escribiste» vale para los dos. Vale para salir de la cuenta, quitar y
  cambiar de workspace. La otra opción: dos oraciones distintas según qué se cuenta (más textos, y una pregunta más
  larga cuando hay de los dos).
- **D370 · El árbol que sigue a la página no le roba el desplazamiento a quien lo mueve a mano** (2026-10-08; tomada
  al implementarlo, Lega la puede cambiar). Si la persona movió la barra lateral (rueda, dedo, barra, teclado) en los
  últimos 200 ms, llevar la fila a la vista espera a que frene, y se rinde a los 5 s. La otra opción: desplazar igual,
  aunque la persona esté moviendo el árbol (el árbol se le escapa de la mano).
- **D371 · Hacia arriba, si la fila cabe en la primera pantalla, el árbol vuelve al principio** (2026-10-08; tomada al
  implementarlo, Lega la puede cambiar). Así reaparece el selector de proyectos arriba. La otra opción: el movimiento
  mínimo, con la fila pegada al borde de arriba (más quieto, pero el selector queda escondido).
- **D372 · Los días de rodaje se marcan solo con la carpeta de reportes (`dayReports`), nunca con `holds: 'day'`**
  (2026-10-08; tomada al implementar D369, Lega la puede cambiar). *Type* → *Shoot days* y *Use for day reports* escriben
  `dayReports` y sacan un `holds` de otro tipo; *Scenes*, *Locations*, *Nothing in particular* y *Stop using for day
  reports* lo dejan de usar (`dayReports: false`). Una carpeta de reportes deducida por sus reportes también es de días,
  y `holds: 'day'` se lee igual (salvo con `dayReports: false`). La otra opción: escribir las dos claves (se
  desincronizan: dejar de usarla para reportes dejaría vivo `holds: 'day'`).
- **D373 · La marca de una página nueva se escribe al tener título, no al crearla vacía** (2026-10-08; tomada al
  implementarlo, Lega la puede cambiar). El «+» no sabe si la página va a ser una escena o un grupo (`106 | Episodio 6`,
  `Bloque 3`); mientras no tiene título, la carpeta ya le da el tipo al leer. Crear con título (*New day report*) marca
  enseguida, y *Scene*/*Location* marcan al aplicarse. La otra opción: marcar al crear (un episodio nuevo quedaría escena).
- **D374 · Desmarcar una carpeta deja las marcas de sus páginas** (2026-10-08; tomada al implementarlo, Lega la puede
  cambiar). Una escena sigue siendo escena; se cambia de a una con *Type* → *None of these*. La otra opción: sacarlas
  (se pierde lo que sabe un invitado que ve la página sin su carpeta).
- **D375 · Mover adentro de una carpeta con tipo marca lo que no tenía marca; sacar no desmarca** (2026-10-08; tomada al
  implementarlo, Lega la puede cambiar). Con un episodio entero, también sus escenas. Nada automático pisa una marca de
  otro tipo ni «nada de esto». La otra opción: que la marca siga siempre a la carpeta (una escena archivada dejaría de
  serlo).
- **D376 · El número de escena sigue al título confirmado, esté donde esté la página** (2026-10-08; tomada al
  implementarlo, Lega la puede cambiar). Si el título trae otro número canónico se actualiza; si no trae ninguno, el
  guardado se queda (también al elegir *Scene* sobre una escena que ya lo es). La otra opción: actualizarlo solo adentro
  de la carpeta (afuera quedaría desactualizado).
- **D377 · Sin episodio no hay número de escena** (2026-10-08; tomada al implementarlo, Lega la puede cambiar). `074 |
  título` en un largo queda escena sin `code`: el contrato es `EP_NNN`. La otra opción: guardar `074` (un formato
  distinto que el motor tendría que distinguir); queda para cuando se mida un largo.
  Reemplazada por D383.
- **D378 · *Type* marca también la página misma** (2026-10-08; tomada al implementarlo, Lega la puede cambiar): *This
  page is: Scene / Location / Shoot day / None of these*, en el mismo submenú que *Pages created inside are*. Es la forma
  de corregir una página mal clasificada por su carpeta. La otra opción: solo la carpeta (sin arreglo para un caso
  suelto).
- **D379 · La tira de la página vacía ofrece las plantillas según el lugar** (2026-10-08; tomada al implementarlo, Lega
  la puede cambiar). *Scene* en una carpeta de escenas, *Location* en una de locaciones, *Tech scout* y *Creative scout*
  adentro de una locación, *On-Set Report* en una de días; en otro lado, las tres de siempre. *More…* muestra las siete.
  La otra opción: las siete siempre (una tira demasiado larga).
- **D380 · El rótulo de los días en castellano es «DÍAS»** (2026-10-08; tomada al implementarlo, Lega la puede
  cambiar). El árbol mide 288 px y el rótulo no se achica. La otra opción: «DÍAS DE RODAJE» (le come el nombre a la
  carpeta).
- **D381 · Un link público no sabe el tipo de las páginas** (2026-10-08; tomada al implementarlo, Lega la puede
  cambiar). `plink_tree` manda solo `header` y `format`; mostrarlo pide una migración que sume `entity`, y no hace falta
  para el primer hito. La otra opción: hacer la migración ahora.
- **D382 · El título escrito en la página cuenta para el tipo recién al confirmarlo** (2026-10-08; tomada en la
  corrección de la auditoría, Lega la puede cambiar). El título se guarda en cada pausa de 300 ms; la marca y el número
  se escriben con Enter, al salir del campo, al cambiar de página o al cerrar la app. Así un episodio tipeado con una
  pausa antes del número no queda escena, y no se suben números a medio escribir (`105_000`, `105_007`). La otra opción:
  corregir sola una marca puesta por la carpeta mientras la página no tenga hijos ni contenido (no distingue una marca
  puesta a mano).

- **D383 · Un proyecto sin episodios numera sus escenas con 3 cifras y su letra (`074`, `069A`)** (2026-10-08; tomada al
  implementar el motor de relaciones, E1; reemplaza a D377; Lega la puede cambiar). El lector las reconoce con
  «Escena/Esc/Sc/Scene» delante, como plano `ABC_074_010`, o primero en un título con ceros, con letra o seguidas de
  `|`, `-`, `:`, `.`, INT/EXT o nada; «plano 12», «toma 74» y un número suelto nunca. `kind.ts` saca `074` del título
  sin episodio de contexto (después de las formas con episodio) y lo acepta como código guardado; un número sin
  episodio no reemplaza uno guardado con episodio. Un título de solo `074` en la carpeta de escenas sigue siendo un
  grupo. La otra opción: largos sin número (no se reconocerían). Ajustada en la corrección de la auditoría (D391).
- **D391 · En un largo, lo primero de un título cuenta como escena solo con 3 cifras o seguido de INT/EXT**
  (2026-10-08; corrección de la auditoría de E1, B1; Lega la puede cambiar). Cuenta `074`, `074A` (con ceros, sigan con
  lo que sigan), `120 | Plaza` (3 cifras con un separador o nada después), `12 - INT. COCINA`, o con «Escena/Sc»
  delante; nunca una letra pegada a 1–2 cifras («3D Tracking», «4K Plates», «2D») ni una lista numerada («1. General»).
  `kind.ts` igual: sin episodio, 3 cifras o «Escena» delante; y en la carpeta de escenas de una serie no hay número sin
  episodio («100 | Notas» al lado de los episodios). Lo dibujado en un título decide de quién son las fotos de la sección.
  La otra opción: la regla de D383 (títulos comunes de VFX se volvían escenas con sus fotos).
- **D392 · «Esc» sin punto cuenta solo con un número de 2 cifras o más** (2026-10-08; corrección de la auditoría de E1,
  O3; Lega la puede cambiar). «Presioná Esc 2 veces» es la tecla; «Esc. 2» y «Esc 27» sí. La otra opción: pedir «Esc»
  al principio del bloque (deja afuera «ver Esc 27»).
- **D384 · El índice del proyecto se guarda entero en el dispositivo** (2026-10-08; E1, Lega la puede cambiar). El texto
  de cada bloque y lo de cada bloque para las relaciones, con la marca `version:cursor` de la página, en `meta`
  (`searchIndex:`); al abrir la app solo se lee lo que cambió, también para ⌘K. Una página con ediciones sin subir se
  relee igual. 7 MB para un proyecto como ERSO. La otra opción: guardar solo las referencias (cada inicio volvería a
  abrir todos los documentos para la búsqueda).
- **D385 · «Escena/Sc/plano/toma» cuentan como palabra entera delante del número** (2026-10-08; E1, Lega la puede
  cambiar). En la maqueta «disc 27» valía como «sc 27». En ERSO no cambia nada. La otra opción: la regla de la maqueta.
- **D386 · El progreso de la primera lectura se muestra solo con 20 páginas o más por leer** (2026-10-08; E1, Lega la
  puede cambiar). «Reading 340 of 921…» en un renglón después del árbol, pegado al borde de abajo de la barra lateral, chico y
  apagado, con un tooltip; se va solo. Una
  lectura chica no lo muestra (sería un parpadeo). La otra opción: mostrarlo siempre que lee.
- **D387 · `graph: false` saca una página y todo lo de adentro de las relaciones** (2026-10-08; E1, Lega la puede
  cambiar). Clave de `PageSettings`, no se hereda con `resolveSetting`, viaja al exportar e importar. Para `90 |
  Archivo` y los backups que repiten nombres. La otra opción: plegarlas como páginas índice (seguirían sumando ruido).
- **D388 · La ayuda explica la primera lectura** (2026-10-08; E1, Lega la puede cambiar). Entrada *Reading the project*
  en *Find*: el usuario ve el rótulo. La otra opción: sin entrada hasta que se vean las cabeceras (E3).
- **D389 · Cerrar el panel de buscar ya no corta la lectura del proyecto** (2026-10-08; E1, Lega la puede cambiar).
  Las relaciones la retienen. La otra opción: cortarla y que las relaciones la vuelvan a pedir.
- **D390 · Releer después de un cambio del árbol o una sincronización espera 300 ms; una edición, 500 ms** (2026-10-08;
  E1, Lega la puede cambiar). Un título que se escribe no relee el estado de todas las páginas por tecla. La otra opción:
  releer en el acto.
- **D393 · «Planned at» de una escena son las locaciones que nombra su propio desglose** (2026-10-08; E3, Lega la puede
  cambiar). La escena y sus fichas; se rotula «named in its breakdown». El motor no lee campos («Locación real»). La otra
  opción: esperar a leer campos de las fichas (sin dato hasta entonces).
- **D394 · En el teléfono la cabecera viva de escena y de locación arranca plegada en un renglón** (2026-10-08; E3, Lega
  la puede cambiar). Lo elegido se recuerda por tipo (escena / locación) en el dispositivo, también en la computadora. La
  otra opción: plegada solo la del día (C7 B2), abierta en escena y locación.
- **D395 · «No VFX» solo con un campo o una celda que lo dice entero, y para la escena entera solo si lo dice la escena
  o todas sus fichas con texto** (2026-10-08; E3, corregida al auditar la v0.238; Lega la puede cambiar). «No VFX» o
  «VFX…: No VFX»; una frase que lo nombra de pasada no cuenta. Una ficha «No VFX» al lado de otras con DMP o CG (ERSO
  105_062) dice «No VFX in 1 of 4 cards», no «No VFX»; una ficha sin texto no cuenta. La otra opción: una sola ficha
  marca la escena (afirmaba de más).
- **D396 · La tira de fotos de la cabecera muestra la cantidad, sin «All N · by source»** (2026-10-08; E3, Lega la puede
  cambiar). La vista por fuente y el carrete de varias páginas son de E8; tocar una foto lleva a su sección. La otra
  opción: un botón que todavía no hace nada.
- **D397 · Las páginas índice no aportan extractos, días ni fotos a la cabecera** (2026-10-08; E3, Lega la puede
  cambiar). Van plegadas en un botón «N index pages». La otra opción: listarlas con las demás (inundan la cabecera).
- **D398 · La locación de un día de rodaje es la que nombra su título** (2026-10-08; E3, Lega la puede cambiar). Vale
  para «filmada en» de la escena y para los días de la locación, y se rotula «per the day title» (C8 §7.2). La otra
  opción: una fila *Location* bajo cada sección (no existe todavía).
- **D399 · Ir al lugar exacto deja abierta, para vos, la sección colapsada** (2026-10-08; E3, Lega la puede cambiar).
  Como «Ir al bloque» de los comentarios; la búsqueda, en cambio, la vuelve a cerrar al terminar. La otra opción: abrirla
  solo mientras dura el resaltado.
- **D400 · Lo de adentro de un día que no es su reporte (un plan, una hoja de llamado) dice «planeada», nunca
  filmada** (2026-10-08; E3, Lega la puede cambiar). La cabecera de la escena lo muestra como «planned in «Plan | Día
  60»» y la locación no cuenta esa escena en ese día. En ERSO, los 35 plannings son «parte de» su día y nombran 115
  escenas. La otra opción: sumarlos como menciones del día (parecería filmada).
- **D401 · Quien no ve el proyecto entero lee las ausencias como «you can see»** (2026-10-08; corrección de la auditoría
  de E3, O1; Lega la puede cambiar). Un invitado a una rama (sin ser dueño, admin ni tener permiso sobre el proyecto)
  ve «No report section you can see» y «No report section you can see yet: …», con un tooltip que dice que un reporte
  que no ve puede tener la sección. La otra opción: no mostrar la ausencia (el invitado no sabría por qué está vacío).
- **D402 · Mientras el índice lee, el renglón plegado muestra solo lo que ya encontró y «Reading…»** (2026-10-08;
  corrección de la auditoría de E3, B2; Lega la puede cambiar). Nada de ceros ni de «No report section» hasta que la
  lectura termina; el punto «Reading…» va también en el renglón (el teléfono arranca plegado, D394). La otra opción:
  «Reading…» en lugar de cada cifra (un renglón largo que no dice nada).
- **D403 · En ERSO los días se marcan por bloque, no en `2 | Rodaje`** (2026-10-08; E4, Lega la puede cambiar).
  *Type* → *Shoot days* en `Bloque 1`, `Bloque 2` y `Europa`: en su primer nivel alcanza la fecha y salen los 73 días.
  Con `2 | Rodaje` los bloques son grupos y adentro de un grupo un día pide fecha y número: los 14 «Sin reporte» quedan
  afuera (59 de 73). *New day report* desde un día crea en su bloque. Revertir: *Nothing in particular* en cada bloque y
  *Shoot days* en `2 | Rodaje`.
- **D404 · Escenas y locaciones se marcan en la carpeta de arriba** (2026-10-08; E4, Lega la puede cambiar).
  `1.1 | Desglose` → *Scenes* (los cinco episodios quedan grupos solos) y `1.2 | Locaciones y scoutings` → *Locations*
  (los scoutings, «parte de» su locación). `1.3 | Decorados` no se marca: decorado no es locación (ES3).
- **D405 · Los títulos de escena de ERSO llevan `101_074`** (2026-10-08; E4, Lega la puede cambiar). Solo la tercera
  parte: `074 | título | 101-074` → `074 | título | 101_074`, 226 títulos. El motor no lo necesita (saca el número del
  corto y el episodio), pero lo visible va en la forma canónica (D368). El número guardado no cambia.
- **D406 · `graph: false` solo en `90 | Archivo`** (2026-10-08; E4, Lega la puede cambiar). El backup de BD Main
  duplicaría todo el desglose. BD Main, Rodaje Planning, `1.3 | Decorados` y los grupos EP quedan en el grafo como
  fuentes originales; la cabecera las pliega como páginas índice. Revertir: borrar la clave `graph` de la fila.
- **D407 · En la ficha de un día con reporte se van Escenas y Planning; quedan Fecha, Día y Locación** (2026-10-08; E4,
  Lega la puede cambiar). Escenas listaba también las planeadas y, como link en un día, el motor las contaba filmadas
  (99 falsas); Planning repite el árbol. Fecha, Día y Locación los lee *New day report*. En los 15 días generados se va la
  ficha entera y su nota.
- **D408 · Se borran las primeras líneas de identidad de escena y de locación** (2026-10-08; E4, Lega la puede
  cambiar). La de locación («Basavilbaso · también: Basavilbaso 1, Basavilbaso 2») relacionaba lugares que el armado
  separó. Los alias quedan en la reorganización para cuando la app tenga alias de locación. Efecto: ⌘K ya no encuentra
  la escena por `101-074` (roadmap R).
- **D409 · Lo generado se borra; lo escrito por alguien se queda** (2026-10-08; E4, Lega la puede cambiar). Fichas,
  secciones «Relacionado · generado», leyendas, índices de carpeta y `## Notas` vacío se van (3.223 bloques en 365
  páginas, 116 filas); un bloque que no tiene la forma exacta de lo generado corta la limpieza de su sección y se queda.
  Las escenas y locaciones quedan como página libre debajo de la cabecera viva.
- **D410 · Los renglones «→ Escena» de los reportes se conservan con el número `101_074`** (2026-10-08; E4, Lega la
  puede cambiar). 126 renglones, 139 links: se reescribe solo el texto del link, con el mismo destino.
- **D411 · `00 | Mapa` va a la papelera** (2026-10-08; E4, Lega la puede cambiar). Era una foto congelada del día de la
  importación; lo reemplaza el Mapa vivo (roadmap R). Se restaura desde la papelera.
- **D412 · Los 15 días sin reporte se quedan como páginas vacías** (2026-10-08; E4, Lega la puede cambiar). Son días
  planeados; la cabecera del día los va a llenar en vivo. La otra opción: mandarlos a la papelera.
- **D413 · La base real se toca con la app de desarrollo y el código de la app** (2026-10-08; E4, Lega la puede
  cambiar). Las marcas con clics en el menú *Type*; el renombre, la limpieza y el Mapa por el gancho de desarrollo
  (`__shotdocsDev`), una transacción de Yjs por página, siempre con ensayo antes; la verificación, desde un perfil de
  navegador nuevo que baja todo del servidor. La otra opción: escribir en la base por SQL (salta las reglas de la app).
- **D414 · ERSO pasa a vivo después de E1, E2 y E3 en `main`** (2026-10-08; E4). Sin el motor no hay verificación y sin
  la cabecera no se ve el resultado.
- **D415 · La foto de antes se toma después de las marcas; antes de escribir nada, la foto sin marcas y el ensayo**
  (2026-10-08; E4, al ejecutar). Sin marcas el motor no reconoce entidades y la comparación con la simulación no dice
  nada; para saber si ERSO había cambiado antes de escribir alcanzan el emparejado del árbol (921 de 921) y el ensayo de
  la limpieza, igual página por página (365 de 365). La foto con marcas dio 18 bien y 10 mal (la simulación, 17 y 11): el
  Mapa ya no tenía la frase «Todo lo demás lo arma el mapa», reemplazada por otra el mismo día, y se fue a la papelera.
- **D416 · Un paréntesis no da alias de locación; el nombre sin él, solo con dos palabras o más y sin compartir**
  (2026-10-08; corrección de la auditoría de E4, hallazgo 1; Lega la puede cambiar). Qué pasaba: el registro tomaba
  como alias lo de adentro del paréntesis y el nombre sin él. `Europa (plates)` volvía locación a «plates» (cualquier
  reporte de VFX: «2 plates de humo negro», «Plates ambulancia»), cinco «… (Europa)» compartían «Europa» y `Lübben
  (Europa)` tomaba el «Lübben» del guion. En ERSO, 36 pares página–locación sin respaldo: la escena 101_074 «planeada
  en Europa (plates)» y esa locación con 14 días ajenos. Medido sobre ERSO real contra la reorganización como única
  verdad: sin ningún alias del paréntesis, 0 falsos pero se pierden «La Arenera» y otros nombres (50 de 58 días con su
  lugar por el título); con el nombre sin paréntesis si no se comparte, 5 falsos («Lübben»); sumando el paréntesis
  único que no es palabra común, 6 («Claridge»). Elegí el nombre sin paréntesis solo con dos palabras o más y sin
  compartir: 0 falsos, 131 de 176 «planeada en» bien (antes 133, con 17 de más; ahora 6 de más, ninguna por alias).
  Una sola palabra suele ser la ciudad o el sustantivo de la historia; en el texto, «Inquilinato», «Brandemburgo» y
  «Lübben» solos no se reconocen hasta que existan los alias de locación (en el título de un día, sí: D417). Revertir:
  volver a sumar el paréntesis y el nombre sin él en `locationFromTitle` (`src/relations/register.ts`).
- **D417 · El nombre sin paréntesis de una sola palabra vale solo para el lugar de un día por su título** (2026-10-08;
  re-verificación de E4, R1; decidida sin Lega, la puede cambiar). Qué pasaba: con D416, tres días
  verdaderos según la reorganización perdieron su lugar (D398): «Día 73 | Inquilinato», «Día 78 | Lubben Puente y
  calle» y «Día 79 | Brandemburgo»; sus locaciones decían que ningún día las nombra en el título y sus escenas
  mostraban esos días sin lugar. Los falsos de «Lübben» que motivaron D416 venían del texto del guion, no de títulos de
  día. Opciones: dejarlo así (tres días sin lugar), volver a la regla de antes en todos lados (vuelven los falsos del
  texto) o aceptar la palabra sola solo en el título de un día. Elegí la última: si ninguna otra locación comparte ese
  nombre, cuenta en el título de un día (`dayTitleAliases` en el registro, `scan(…, { dayTitle: true })` en `dayRef`) y
  en ningún otro texto. Medido sobre ERSO real: de los 70 días con locación en la reorganización, 57 la reciben por su título y
  0 reciben una falsa (como antes de D416; los otros 13 usan otro nombre y esperan los alias), 0 pares nuevos
  sin respaldo (28 de 28). Revertir: sacar `dayTitle: true` en `dayRef` (`src/relations/liveView.ts`).
- **D419 · Un campo de una página es una fila de una tabla de dos columnas (cualquier rótulo), o un título o un
  renglón «Rótulo:» con un rótulo conocido** (2026-10-08; E3b, Lega la puede cambiar). Los rótulos conocidos están en
  `FIELD_LABELS` (`src/relations/fields.ts`), en castellano e inglés, sin tildes ni mayúsculas. Un renglón cuenta solo si
  empieza con el rótulo y dos puntos: «open question» en el medio de un texto no es un campo. La otra opción: cualquier
  título o «algo:» como campo (todo reporte con «Llamado 7:00» o «Escena 105_027» sumaría campos de mentira).
- **D420 · El valor de un título-campo llega hasta el próximo título o hasta un renglón que es otro campo**
  (2026-10-08; E3b, Lega la puede cambiar). Así «Consultas» con «Open question: …» abajo son dos preguntas. La otra
  opción: hasta el próximo título de su nivel o mayor, como las secciones (se tragaría los subtítulos de una ficha).
- **D421 · Las tablas guardan en el índice la fila y la columna de cada celda** (`BlockMeta.cells` y `cols`;
  2026-10-08; E3b). Sin eso una celda vacía corre los valores de toda la ficha. Sube `CACHE_FORMAT` a 2: la primera vez
  después de actualizar, el dispositivo relee cada página una vez (como la primera lectura; medido en ERSO: 4,6 s en
  la PC, ~23 s con la CPU ×4). Una versión vieja abierta (v0.238) y la nueva alternando sobre el mismo dispositivo se
  pisan la caché: cada una relee todo al recargar después de la otra (no se pierde nada; cada una descarta el formato
  ajeno); se termina cuando la vieja se actualiza, y `min_app_version` lo acota. La otra opción: emparejar las unidades
  de a dos (falla con la celda vacía de *Notas*, que ERSO tiene).
- **D422 · La pregunta abierta de la escena es la primera de su desglose (la escena, después sus fichas en el orden del
  árbol); dos fichas con el mismo primer renglón cuentan como una («in 2 cards»); tocarla abre la ficha con la pregunta
  resaltada** (2026-10-08; E3b, Lega la puede cambiar). Un valor «—», «n/a» o vacío no es una pregunta. La maqueta
  agrupaba por el texto entero y no la hacía tocable. Se revierte en `sceneLive` (`questions`) y `QuestionRow`.
- **D423 · Los decorados de una escena salen del campo *Locacion Guion* / *Sets* de la escena y de sus fichas**
  (2026-10-08; E3b, Lega la puede cambiar). Con link, el chip lleva a la página del decorado si la persona la ve; si no
  la ve (un invitado), muestra el texto del link (que está en la ficha que sí ve) y no lleva a ningún lado. Sin link,
  cada renglón del valor es un chip que no lleva a ningún lado.
- **D424 · Los decorados de una locación son su propio campo *Sets* y las páginas sueltas (sin tipo y fuera de escenas,
  locaciones y días) cuyo campo *Locacion Real* la nombra; esas páginas salen de «Also named in»** (2026-10-08; E3b, Lega
  la puede cambiar). Es la tabla «Decorados» de Coda. «La nombra» es por su nombre o por un alias que el registro
  reconoce y que no comparte otra locación (corrección de la auditoría, B1: en ERSO «Europa» le daba los 15 decorados
  de Europa a las seis locaciones «… (Europa)»); la regla de alias es la del registro, no se deriva del título. Un campo
  de lugar dice dónde se filma, como el título de un día: valen los alias de lugar del registro (`locDayTitleAlias`,
  D417), así «Locacion Real: Lübben» es de `Lübben (Europa)` si ninguna otra comparte «Lübben». La fila *Sets* aparece solo si hay alguno; la nota de la maqueta
  «no art photos or art links in ERSO» no va (habla de ERSO, no de la app).
- **D425 · INT/EXT de la escena: los valores distintos de su desglose, hasta 3, separados por coma** (2026-10-08; E3b,
  Lega la puede cambiar). La maqueta mostraba solo el de la primera ficha; con fichas INT y EXT eso diría algo falso.
- **D426 · *Where* de una locación: las primeras coordenadas escritas en la locación o en sus scoutings (o un campo
  *Coordenadas* que dice una), solo las coordenadas, y tocarlas lleva a donde están escritas** (2026-10-08; E3b, Lega la
  puede cambiar). Coordenada = grados con hemisferio o un par decimal con signo o hemisferio; un par sin signo, solo
  como valor de un campo de coordenadas. «Ubicación: Ruta 205 km 40» o «Formato 1.7778, 2.3900» no son *Where*
  (corrección de la auditoría, O1 y O2). La maqueta mostraba el renglón entero («PBA 34° 46'…»). La otra opción: abrir un mapa (sale de la app con
  la ubicación: queda para cuando Lega lo pida).
- **D427 · Una ficha en la etapa *Breakdown* se titula con su *Shot Name* y muestra su *Descripción*** (2026-10-08;
  E3b, Lega la puede cambiar), como la maqueta. Sin esos campos, el título de la ficha y sus primeros renglones sin las
  tablas (antes salía el texto de la tabla, «Shot Name ERSO_… INT/EXT…»).
- **D428 · Las filas que salen de campos aparecen solo cuando hay un valor, también mientras el índice lee**
  (2026-10-08; E3b). Nunca dicen «ninguno» ni «0 questions»: sería afirmar una ausencia que el dispositivo puede no
  saber todavía (D402) o que un invitado no puede ver (D401).
- **D429 · Las escenas de un día salen de los títulos de sección de su reporte: «shot» con algo escrito o fotos debajo,
  «prepared» si la sección sigue vacía, «shot · not in plan» si hay plan y no la nombra** (2026-10-08; E5, Lega la puede
  cambiar). Una fila por sección (la más externa de cada escena, con su parte); dos secciones vacías de la misma escena
  son una sola fila. Sin plan, nunca «not in plan». Una sección vacía nunca cuenta como filmada (§9.2 de la propuesta).
  La sección general del reporte («Info general», o la primera de arriba sin número) no es una fila: sus fotos son del
  día y van primero (como la maqueta; corrección de la auditoría, B1; vale también para el *Shoot* de la locación).
- **D430 · El plan de un día: su página *Plan* (lo de adentro del día, en el orden en que nombra las escenas) → las
  fichas con esa *Fecha Rodaje* (por número) → nada** (2026-10-08; E5). La maqueta ordenaba también el plan por número;
  el orden del plan es el del día de rodaje y es el que se usa para preparar. Las copias de fichas pegadas en el plan de
  otro día no cuentan (`cardFields`).
- **D431 · Una sección de arriba sin número y con fotos es una fila con aviso que lleva a la sección; sin *Assign***
  (2026-10-08; E5). Asignarle una escena es de E7 (el selector de `/`); el tooltip dice que escribir el número en el
  título la relaciona sola.
- **D432 · *Tomorrow* es el día siguiente por fecha entre los días que la persona ve; si no hay, no hay tarjeta**
  (2026-10-08; E5, Lega la puede cambiar). Crear el reporte de mañana desde la tarjeta queda en el roadmap. Un día se
  nombra corto en los botones y en la tarjeta: «Día 58», o su fecha («10/03») si el título no tiene número de día (los
  «Sin reporte» de ERSO), con el título entero en el tooltip solo entonces; en el teléfono, *Live* y *Collapse* quedan
  siempre a la vista (corrección de la auditoría, B2 y O10).
- **D433 · Lo que se saca o se suma a la lista de mañana se recuerda en el dispositivo, como diferencia con el plan**
  (2026-10-08; E5, Lega la puede cambiar). No va al documento ni a la base: es la preparación de quien prepara; si el
  plan cambia, lo ajustado se sigue aplicando encima. La otra opción: escribirlo en la página *Plan* (tocaría lo de otro).
- **D434 · El título que agrega *Prepare* usa la palabra y el nivel que ya usa el proyecto** (2026-10-08; E5): el de las
  secciones de escena de mañana, de hoy o del día anterior más cercano («Escena», título 1 en ERSO); si ninguno tiene,
  «Escena» o «Scene» por el idioma de la app y el nivel de los títulos de mañana. El número va como link a la escena
  (`/p/<id>`), sin el título de la escena.
- **D435 · *Prepare* agrega antes del renglón vacío del final (si lo hay) y solo para escenas con una página que la
  persona ve** (2026-10-08; E5). Una escena del plan sin página (pendiente) no se puede enlazar: se saltea.
- **D436 · Dos dispositivos que preparan a la vez sin red: al juntarse quedan títulos repetidos; *Prepare* de nuevo saca
  los títulos preparados y vacíos que sobran (deja el primero, o el que tiene algo escrito), solo el título, nunca solo**
  (2026-10-08; E5, Lega la puede cambiar). Yjs no puede fundir dos títulos insertados por separado. Solo cuenta el par:
  dos o más títulos con la forma de *Prepare* («Escena» + el número como link) de la misma escena; una sección escrita a
  mano («Escena 105_029a») nunca hace sacar nada, y el aviso de la tarjeta sale solo con ese par (corrección de la
  auditoría, B4). Se borra **solo el contenedor de cada título, directo en el Y.Doc** (por su id, verificado en el
  momento, en una transacción), nunca con el editor: `removeBlocks` pasa por y-prosemirror, que reutiliza contenedores y
  borraba el del renglón donde otro escribía (R2 de la re-verificación). El renglón vacío del repetido queda: si alguien
  escribe ahí sin red mientras otro limpia, su texto no se pierde (probado con una, dos y tres
  escenas y con el servidor de prueba), pero con varias escenas puede quedar debajo de la última sección de la tanda y
  no de la suya (auditoría, O-a; roadmap). La
  cabecera los cuenta una vez. Un título a mano idéntico al de *Prepare* (con el link) no se puede distinguir: dos de
  ellos vacíos de la misma escena se juntan igual. La otra opción: limpiar solo al abrir el reporte (borraría sin que
  nadie lo pida, quizás mientras otro escribe).
- **D437 · *Undo* de *Prepare* está en el aviso (15 s) y saca cada título agregado con su renglón solo si siguen iguales
  y vacíos; si lo agregado ya salió del dispositivo, saca solo los títulos** (2026-10-08; E5). Si queda alguno, el aviso
  lo dice. «Ya salió»: el servidor tiene algo de este dispositivo posterior a lo de antes de preparar, o hay una subida
  en camino (`syncedSV` y `pending` del estado de la página). Entonces otro dispositivo pudo recibirlo y estar
  escribiendo en ese renglón sin que llegue todavía: borrar el bloque se llevaría su texto (corrección de la auditoría,
  O1, con su prueba). El costo: renglones en blanco donde estaban las secciones, y el aviso lo dice. Sin red, *Undo*
  deja el reporte idéntico. Borra directo en el Y.Doc, bloque por bloque y verificando en el momento que cada uno sigue
  siendo lo agregado (mismo id, mismo texto, vacío): borrar con el editor perdía lo escrito bajo una sección que no era
  la última (R1). Si un título quedó adentro de otro bloque (la estructura no es la esperada), no borra nada y avisa. La maqueta mostraba además una franja con *Undo* en el
  reporte; sin una marca guardada de «preparado», la app no sabe después qué agregó *Prepare*.
- **D438 · Después de preparar, la app lleva al reporte de mañana con lo agregado resaltado** (2026-10-08; E5), como la
  maqueta.
- **D439 · En el editor de un reporte, al lado del link de un título que lleva a una escena, su título en vivo; debajo,
  la primera pregunta abierta de su desglose** (2026-10-08; E5, Lega la puede cambiar). Para cualquier título con link a
  una escena (no hay marca de «preparado» en el documento; los títulos sin link de ERSO no la muestran, como la
  maqueta). Son decoraciones: no se guardan, no se copian, no se imprimen; tocar la pregunta abre la ficha.
- **D440 · Las preguntas abiertas del día: hasta 3, con la ficha y la categoría** (2026-10-08; E5). La maqueta mostraba
  solo la categoría; la ficha dice de dónde sale (como la escena, D422).
- **D441 · El día se pliega por su tipo y en el teléfono arranca plegado** (2026-10-08; E5), como la escena y la
  locación (D394) y como pedía B2 de C7.
- **D442 · Sin permiso de editar el reporte de mañana, la tarjeta se ve sin *Prepare* y dice por qué** (2026-10-08;
  E5). Las ausencias, para quien no ve todo el proyecto, dicen «you can see» (D401).
- **D443 · *Prepare* no toca un reporte que no está entero en el dispositivo (intenta bajarlo 8 s) ni uno con contenido
  que esta versión no conoce** (2026-10-08; E5). Sin el reporte entero no se puede saber qué secciones ya tiene:
  duplicaría.
- **D444 · *Prepare* lee el reporte en el momento, no la foto del índice** (2026-10-08; E5). La foto puede tener medio
  segundo de atraso o no haber leído lo que llegó por sincronización: con ella, preparar dos veces seguidas duplicaría.
- **D445 · La barra *Today* sobre el teclado y la ficha-chip del link quedan para E6/E7** (2026-10-08; E5). E5 escribe
  el link con la marca `link` de siempre; cómo se dibuja un link a una escena es del subrayado y de `/`.
- **D446 · Volver link un subrayado: Ctrl+Alt+K (⌘⌥K en la Mac) y el botón *Make it a link* del adelanto** (2026-10-08;
  E6, Lega la puede cambiar). La maqueta usaba ⌘↵/Ctrl+↵, que es el salto de hoja; Tab es la sangría. ⌘⇧K duplica la
  pestaña en Edge y abre la consola en Firefox; ⌘⌥L abre las descargas en Chrome y Safari de la Mac. La K es la del link
  (⌘K). Atajo `relLink` del registro.
- **D447 · Lo que llega de otro dispositivo se subraya en el momento** (2026-10-08; E6). y-prosemirror reemplaza el
  documento entero con cada cambio de Yjs (también deshacer): corrido así, el subrayado desaparecía medio segundo (un
  parpadeo). Se arma de nuevo en el momento; en una página que tarda más de 12 ms, se corre por el tramo distinto y se
  relee a los 500 ms.
- **D448 · La página de una escena o una locación no subraya la suya** (2026-10-08; E6). Su adelanto sería la página que
  se está viendo y volverla link, un link a sí misma.
- **D449 · La ficha también para los links a una locación** (2026-10-08; E6), como la maqueta (el encargo nombraba la
  escena); el título en vivo, solo de las escenas y solo en un título.
- **D450 · El título en vivo de un link a una escena va al final del título, en cualquier página** (2026-10-08; E6; O4
  de la auditoría de E5). Antes iba pegado al link y solo en los días: lo escrito después del link se leía como parte
  del título de la escena.
- **D451 · Tocar con el teclado cerrado abre el adelanto sin abrir el teclado; un segundo toque sobre el mismo lo cierra y
  pone el cursor. Con el mouse, el adelanto es solo al pasar: el clic pone el cursor** (2026-10-08; E6). Con el teclado
  abierto, tocar solo pone el cursor (C7, B3).
- **D452 · La barra *Today*: las escenas del plan del día (si no hay plan, las que tienen sección), la locación, la cámara
  si el teléfono saca fotos y el micrófono del dictado; el botón redondo de dictar se esconde mientras está** (2026-10-08;
  E6, Lega la puede cambiar). El botón quedaba encima de la barra; la maqueta del flujo ya tenía el micrófono en ella.
- **D453 · Una letra de unidad pegada (`1080p`, `1080i`, `4050K`, `2030h`) no hace escena en el texto si no existe la
  escena con esa letra** (2026-10-08; E6; auditoría de la v0.237). Con el subrayado se vería en cualquier reporte de VFX.
  En ERSO no cambia nada.
- **D454 · El adelanto de un pendiente solo dice que no existe; *Create* y *Assign* quedan para E7** (2026-10-08; E6).
- **D455 · El adelanto con el mouse se abre solo después de un movimiento real del puntero** (2026-10-09; E6, B1 de su
  auditoría). Al dibujarse el subrayado a los 500 ms, debajo del puntero quieto, Chromium manda `pointerover` al elemento
  nuevo y el adelanto se abría solo mientras se escribía. Ahora cada tecla desarma el mouse y recién un `pointermove` a
  otra posición lo vuelve a armar; el toque y mantener apretado no cambian.
- **D456 · Con texto elegido no sale el adelanto del mouse, y uno abierto con el mouse se cierra** (2026-10-09; E6, O4).
  Con un doble clic sobre un subrayado salían a la vez la barra de formato y el adelanto. Elegir es para dar formato; el
  adelanto vuelve al pasar el mouse con el cursor sin elegir nada. Lo abierto por toque no se toca.
- **D457 · Lo que una edición de acá toca por dentro de un subrayado se saca hasta la relectura** (2026-10-09; E6, O5).
  Reemplazar con buscar «105_029» por «105_025» dejaba medio segundo el adelanto de 105_029. Escribir pegado a un
  subrayado, antes o después, no lo apaga.
- **D458 · Ctrl+Alt+K (⌘⌥K) donde no hay nada para volver link muestra un aviso corto** (2026-10-09; E6, O3): «Nothing
  to link here», «105_120 doesn’t exist yet: nothing to link to» o «It’s already a link». Responde a una tecla apretada a
  propósito, así que no molesta. En solo lectura y sin el subrayado (la exportación), nada.
- **D459 · ⌘⌥K se queda aunque Firefox de la Mac lo use para su consola** (2026-10-09; E6, O6; Lega la puede cambiar).
  No hay una combinación con K libre en los navegadores de la Mac (⌘⇧K y ⌘⌥L chocan en Edge, Chrome y Safari); en
  Firefox de la Mac queda el botón *Make it a link* del adelanto. Anotado en `Doc_Relaciones.md`, sección 14.
- **D460 · «la 5029h» (una parte con letra `p`, `i`, `k` o `h` sin escena propia) ya no se reconoce en el texto**
  (2026-10-09; E6, O7). Es el precio de D453: esas letras son mucho más a menudo unidades (`1080p`, `2030h`) que partes. Con «Escena»,
  «plano» o en un título se sigue reconociendo; si existe la escena con esa letra, también. En ERSO no cambia nada.
- **D466 · En la escena, una fuente por sección de reporte («Día 59 · Escena 105_027b»), no una por día** (2026-10-08;
  E8). La maqueta juntaba el día; el encargo pedía la sección, y una sección es un lugar exacto (el Día 76 tiene dos).
- **D467 · El carrete recibe todas las fotos de la galería aunque haya una fuente elegida** (2026-10-08; E8), empezando
  por la tocada; cada foto dice su fuente. Se revierte en `PhotoSources` (`entries`).
- **D468 · Cada foto del carrete lleva a su propio bloque; la fuente elegida, a la sección entera** (2026-10-08; E8).
- **D469 · En la locación, un grupo por día entero, uno por decorado-página y ninguno vacío** (2026-10-08; E8). La
  maqueta mostraba «Art (sets)» vacío con su explicación; la fila *Sets* de la cabecera ya lo dice.
- **D470 · Desde el carrete de varias páginas no se anota; las anotaciones se ven** (2026-10-08; E8), de una copia de
  lo guardado de cada página (solo lectura).
- **D471 · Las miniaturas de los renglones de día y de los extractos siguen yendo a su lugar** (2026-10-08; E8): el
  carrete se abre desde la tira y la galería. Se cambia en `Thumbs` y `ExcerptCard` (`LiveHeader.tsx`).
- **D472 · Técnico o creativo sale del título; la fecha, del campo *Date*/*Fecha* o del principio del título**
  (2026-10-08; E8). Sin tipo en el título, «Scouting».
- **D473 · Con más de una ficha con fotos, una fuente por ficha con su plano** (2026-10-08; E8; la maqueta: un solo
  «Breakdown»). En ERSO la 105_027 tiene dos fichas con una foto cada una.
- **D474 · Ir a una foto pasa el id por un módulo aparte (`photoTarget.ts`), no por el pedido de la búsqueda**
  (2026-10-09; corrección de E8, B1): así el editor y `ResultRequest` no cambian (los tocan otros frentes). La foto en
  línea se resalta sola y queda centrada aunque crezca al cargar.
- **D475 · Dos fuentes del mismo tipo con exactamente las mismas fotos son una sola** (2026-10-09; O1): la misma
  imagen en dos fichas era dos botones con la misma foto.
- **D476 · En la miniatura, el rótulo corto (el día; el tipo y la fecha del scouting); el entero, en el selector**
  (2026-10-09; O1). El arte de un decorado: «Art · Negocio de Telas» (O2).
- **D477 · En el teléfono el selector de fuentes es un renglón que se desliza de costado** (2026-10-09; O1): eran 6
  renglones a 390 px. La página no se desliza.
- **D486 · El mapa se abre desde una fila *Map* arriba de *Pages* en la barra lateral, en `/map/<pestaña>`**
  (2026-10-08; E9, Lega la puede cambiar). Como la maqueta; solo en un proyecto con escenas, locaciones o días (en uno
  sin tipos sería una pantalla vacía) y con «N pending» solo si hay alguno. Cada pestaña tiene su dirección (se puede
  volver con atrás y abrir aparte). La otra opción: un ítem del menú del proyecto (más escondido).
- **D487 · El mapa se arma en una sola pasada (`projectMap`) con las reglas de la cabecera viva** (2026-10-08; E9):
  «filmada» = una sección de un reporte; la locación de un día, la de su título (D398); «planeada en», lo que nombra su
  desglose (D393). Armar la cabecera de cada una de las 226 escenas y 52 locaciones repetía la pasada entera cada vez.
- **D488 · *Locations*: «N scenes» = las que planea su desglose más las que tienen sección en uno de sus días; punto
  lleno = el reporte tiene un renglón escrito que no es un título, o fotos** (2026-10-08; E9). Ordenadas por su primer
  día; las que no tienen días, al pie; un día sin fecha en el título no tiene punto. Con 0 escenas dice solo los días.
- **D489 · *Scenes* va por episodio; sin sección dice «in a plan» o «No report section», nunca «not shot»**
  (2026-10-08; E9). Las locaciones de cada escena, rotuladas «report» (un día suyo tiene una sección) o «planned».
- **D490 · *Pending* junta los números que no existen, las escenas en dos páginas y las secciones con fotos sin número;
  sin *Create* ni *Assign*** (2026-10-08; E9). Crear y asignar con guardas es de E7: cada fila (`PendingRow`) tiene una
  ranura `actions` vacía para eso. Las duplicadas van acá para que E7 no arme otra lista.
- **D491 · Mientras el índice lee, el mapa dice «Reading 340 of 921…» y no muestra ceros** (2026-10-08; E9), como la
  cabecera (D402): los números de las pestañas aparecen si no son cero o si ya está todo leído.
- **D492 · *Copy map* copia texto legible y *Copy JSON* el formato `shotdocs.map` versión 1; sin descargar un archivo**
  (2026-10-08; E9, Lega la puede cambiar). La maqueta tenía un botón que bajaba `erso_map.json`. El texto (48 KB en
  ERSO) es lo que se pega en un chat; el JSON (538 KB, compacto, páginas una vez con `pageUrl`) es para un programa o el
  MCP. Formato documentado en `Doc_Relaciones.md`, sección 12.
- **D493 · La lupa pone arriba *Scenes and locations*: escenas solo por su número (cualquier forma, con el lector),
  locaciones por nombre o parte, y un número que no existe solo si alguna página lo nombra** (2026-10-08; E9). El título
  de una escena no la sube al grupo: ya sale en *Pages* y empujaría la búsqueda de texto. «Escena 27»: el episodio de la
  página abierta primero, después los demás. Con una entidad no se ofrece «New project».
- **D494 · La búsqueda de escenas es una función pura en `src/relations/sceneSearch.ts`** (`searchScenes(src, q, { ep,
  near, limit, loose })`, `searchLocations`, `findEntities`; 2026-10-08; E9), la misma para la lupa y, desde E7, para el
  `/`, *Add scene* de *Tomorrow* y *Assign*: exacto por el lector, después los dígitos, después el título.
- **D495 · Con un link público no hay mapa** (2026-10-08; E9): el visitante no tiene tipos de página (D381); `/map` lleva
  a la página compartida.
- **D496 · El mapa no tiene atajo propio** (2026-10-08; E9): la fila de la barra lateral y la lupa alcanzan; no se suma
  nada al registro de atajos.
- **D497 · En la lupa, un número de 4 cifras solo se lee como la forma compacta** (2026-10-08; E9): lo escrito se lee como
  un título, así que `2025` es la escena `102_025` si existe; las páginas que dicen «2025» siguen abajo. La otra opción
  (pedir letra o «Escena») rompería `1074` y `5027`, que son lo que se escribe en los reportes.
- **D498 · Quien ve una parte del proyecto nunca lee que una escena «no existe»** (2026-10-08; E9, auditoría O1): el
  número nombrado que no está en su registro dice «isn’t in the pages you can see» en *Pending*, la cabecera del día y la
  lupa; el texto copiado lo pone bajo «Scene numbers named that are not in the pages I can see» y el JSON lleva
  `scope: "visible"`. Puede existir en una página que no ve (D401).
- **D499 · En la línea de tiempo, los días que se tocarían van juntos, uno al lado del otro** (2026-10-08; E9, O3): se
  mide el ancho de la línea (13 px por punto); cada día sigue siendo su propio link. Un día se suma al grupo si cae antes
  de donde termina el grupo ya dibujado, no solo cerca del día anterior (si no, a 390 px un grupo largo tapaba 2 de 58
  días). La otra opción (una pastilla con un menú) pide un clic más.
- **D500 · Los números de *Pending* van separados en el JSON y la fila *Map* usa el total de la pestaña** (2026-10-08;
  E9, O4): `counts.pending`, `duplicates` y `unnumbered`, cada uno el largo de su lista (antes `pending: 8` con
  `pending: []`); la barra lateral y la pestaña dicen el mismo número.
- **D501 · En la lupa, las locaciones por una parte del nombre solo desde 3 letras y por el principio de una palabra**
  (2026-10-08; E9, O5): con «la» o «de» subían media lista arriba de las páginas.
- **D506 · El `/` de escenas es el mismo menú `/` de siempre** (2026-10-09; E7): su lista cambia según lo escrito
  (`/e 027`); BlockNote ya lee lo de después de `/` con espacios. Nada de un segundo menú ni otro disparador (`@`, `[[`).
- **D507 · El `/` pasa a escenas solo con la palabra y un espacio, o pegada a cifras** (2026-10-09; E7): `/e 027`,
  `/e5027`. La palabra sola es el menú de siempre con *Scene* y *Location* al final: `/sc`↵ sigue siendo *Script*.
- **D508 · Las palabras** (2026-10-09; E7): escenas `e`, `sc`, `esc`, `sce`, `scen`, `scene`, `esce`, `escen`, `escena`;
  locaciones `l`, `lo`, `loc`… `location`, `locación`; sin tildes ni mayúsculas. `s` sola no. Una lista en
  `slashRelations.tsx`.
- **D509 · ↵ deja un link común con el número canónico** (`105_027`) o el nombre de la locación, y un espacio
  (2026-10-09; E7): la marca `link` de siempre (una versión vieja la ve igual) que el subrayado dibuja como ficha. No copia
  el título de la escena al documento.
- **D510 · El filtro es `searchScenes` de E9** (2026-10-09; E7): exacto por el lector con el episodio de la página,
  después las cifras y el título; tope 7. `/e ` sin nada: primero las escenas que nombra la página (en un día, también su
  plan), después las del episodio y por número.
- **D511 · Lo que no existe: *Create* o *Keep as text*, nunca un ↵ que borre** (2026-10-09; E7): el último ítem es
  *Create scene 105_120* si pasan las guardas; si no, *Keep 105_120 as text* con el motivo. *Create* escribe el número
  enseguida y lo vuelve link cuando la página existe: si crear falla, el número queda escrito y pendiente.
- **D512 · G1: crea solo quien ve el proyecto entero** (2026-10-09; E7, C8 B3): permisos conocidos y nivel sobre el
  proyecto (la cuenta de `private.project_level`). Un invitado a una carpeta, aunque sea *Edit & create*, no: puede no ver
  una escena con permiso aparte. Para él queda *Assign*.
- **D513 · G2: con el índice completo** (2026-10-09; E7): mientras lee (un teléfono nuevo, páginas sin bajar), no.
- **D514 · G3: con red, y una sincronización en el momento antes de crear** (2026-10-09; E7): además de «en línea con
  una sincronización buena en esta sesión», `createEntity` sincroniza (hasta 6 s) y vuelve a mirar las guardas con el
  árbol recién bajado (desvío del plan, que solo miraba el estado). La auditoría midió que no alcanza para dos
  dispositivos que crean casi a la vez (2 páginas con hasta 1,6 s de diferencia, 1 con 3 s: la fila del primero subía en
  el ciclo siguiente); con D546 la ventana es un viaje de ida y vuelta, y lo que quede lo cubre D520. El «+» del árbol
  sigue creando sin red, como siempre.
- **D515 · G4: mira todo el árbol, también la papelera, `graph: false` y las páginas sueltas** (2026-10-09; E7): por la
  marca y por el número del título. Una página suelta que empieza con el número («105_120 | notas») también frena: se
  prefiere no ofrecer crear a duplicar. En la papelera dice cuál restaurar; fuera de las relaciones, dónde está.
- **D516 · Ni la base ni otra letra** (2026-10-09; E7): con `105_120A`, `105_120` no se ofrece (y al revés); las letras
  se crean con el «+» del árbol, a propósito.
- **D517 · Dónde y cómo queda la escena creada** (2026-10-09; E7): la carpeta de las otras escenas de su episodio (si
  dos empatan, no se ofrece), si no su grupo de episodio en *Scenes*, si no la única *Scenes*; título = el código
  canónico; en orden por número si las hermanas lo están; marca de tipo explícita; la plantilla *Scene* (o la propia que
  salió de ella si hay una sola). Locación: el nombre escrito con mayúscula inicial, al final de su carpeta, *Location*.
- **D518 · Crear no te saca de donde escribís** (2026-10-09; E7): aviso «Created scene 105_120 in «105 | Episodio 5»» con
  *Open* y *Undo*. *Undo* la manda a la papelera solo si nadie la tocó (título, lugar, contenido, sin páginas adentro) y,
  si salió del `/`, le saca el link al número, que vuelve a ser pendiente.
- **D519 · *Create* en cuatro lugares, el mismo botón** (2026-10-09; E7): el `/`, el adelanto de un pendiente, la fila
  «doesn't exist» del día y cada número de *Map › Pending* (en la ranura `actions` de E9). Sin las guardas, un rótulo de
  borde punteado con el motivo en el tooltip.
- **D520 · Dos páginas de la misma escena: quedan las dos** (2026-10-09; E7): nada las funde ni las borra solo; *Map ›
  Pending* ya las lista (E9, «in 2 pages»), no se agregó otro renglón. Un *Merge* que solo agregue queda para después.
- **D521 · *Assign* en una sección sin número agrega « · 105_025» al final del título** (2026-10-09; E7, D431): con link,
  solo agregando, directo en el documento verificando el título; otra escena suma la suya. En el día y en *Map ›
  Pending*, con permiso de editar el día.
- **D522 · *Assign* de un número que no existe pone el link sobre lo escrito** (2026-10-09; E7): no cambia el texto.
  Desde la fila del día marca cada aparición de ese número en ese bloque (directo en el Y.Doc); desde el adelanto, la que
  se señaló, por el editor (⌘Z la deshace; el ancla de E6, no la posición vieja). Es el camino del invitado.
- **D523 · Sin atajo de teclas nuevo** (2026-10-09; E7): `/e ` y `/l ` van al registro como lo que se escribe, con su
  texto en la ayuda (*Link a scene or a location with /*).
- **D524 · Un solo filtro de escenas** (2026-10-09; E7): el `/`, *Assign* y *Add scene* de *Tomorrow* usan
  `searchScenes` de E9 (el selector `ScenePicker` reemplaza al de la cabecera del día).
- **D525 · *Create location* desde `/l`** (2026-10-09; E7): con G1–G3, desde 3 letras, y no si el nombre coincide sin
  tildes con el nombre, un alias o el nombre sin el paréntesis de otra locación (también en la papelera o fuera de las
  relaciones). Un nombre genérico o corto se crea igual y el ítem avisa que no se reconoce solo en el texto.
- **D546 · Crear sube la fila enseguida** (2026-10-09; E7, O1 de la auditoría): `createEntity` pide una sincronización
  apenas crea la página (sin esperarla): la ventana en que otro dispositivo todavía no la ve se achica del ciclo siguiente
  (2–3 s medidos) a un viaje de ida y vuelta.
- **D547 · *Undo* de *Create* sincroniza y compara antes de la papelera; sin red, no deshace** (2026-10-09; E7, O2): lo que
  otro dispositivo ya escribió en la página nueva llega antes de comparar; si no se puede sincronizar, el aviso dice que
  hace falta conexión (no se sabe si alguien escribe).
- **D548 · Una pregunta abierta sin nada después del rótulo no está abierta** (2026-10-09; E7, O11): «Director: » de la
  plantilla *Scene* aparecía como pregunta abierta en cada escena creada y en los días que la nombran. Se filtra al
  mostrar (`openQuestionText` en `fields.ts`), no al leer: el índice y su `CACHE_FORMAT` no cambian.
- **D549 · «En la papelera» a la vista** (2026-10-09; E7, O4): en vez del rótulo «Create scene» con el motivo en el
  tooltip, «In the trash · restore it», que lleva a la papelera.
- **D550 · El selector de *Assign* del adelanto va adentro de la tarjeta** (2026-10-09; E7, B1): en el lugar de la nota,
  con el campo arriba, la lista con su alto y primero las escenas de la página y del episodio del número (la tarjeta recorta
  lo que sale de ella; en el teléfono es una hoja). En la cabecera y el mapa, flotando, se corre lo justo para no salirse de
  la pantalla (O3).

**R6 · «Repartir por escenas» un reporte (2026-10-09, v0.246; D581–D588).** Plan y auditoría en el trabajo de relaciones;
lo que quedó escrito del diseño está en `Doc_Relaciones.md`, sección 16. D587 y D588 son reglas «si algún día…»: no
rigen hoy porque nada de eso se construye.

### D581 · «Repartir por escenas» no mueve ni copia texto: la escena muestra su parte
**Qué pasaba:** el roadmap (R.6) pedía repartir un reporte por escenas con prueba de conservación y deshacer. El punto
venía de la propuesta P2 (b6: mover cada sección a la escena) y de la especificación de ERSO (D-ERSO-10), y D355 (ES8: el
reporte no se parte) ya lo había descartado; el diseño aprobado muestra en la escena cada sección suya, en vivo.
**Las opciones:** A) mover cada sección a una subpágina de la escena y dejar un link; B) copiarla a la escena y dejar
el día; C) no escribir: la escena muestra su parte (cabecera viva, fotos por fuente y carrete, mapa) y R.6 se cierra.
**Elegí C** porque A pierde lo que otro dispositivo escribe sin red adentro de la sección movida (Yjs integra borrado lo
insertado en un bloque borrado; medido en E5), rompe el ancla de los comentarios, las fotos por página, el PDF y la
lectura del día, y no es atómico entre dos documentos; B duplica el texto, lo cuenta dos veces en el índice y envejece
(la lista congelada que Lega rechazó el 2026-10-08). C da lo que pide el pedido: ir de la escena a cada reporte y ver sus
fotos, sin tocar nada.
**Reemplaza** el punto R.6 del roadmap y a D-ERSO-10 (especificación de ERSO, «roadmap de la app»).
**Si preferís otra:** Lega puede cambiarlo cuando quiera. B es lo único razonable que escribe; su protocolo está en el
plan de R6, anexo A (24–34 h, riesgo alto).

### D582 · Los casos que «no se reparten solos» ya los resuelve el lector
**Qué pasaba:** el roadmap advertía que los encabezados con el número solo, las escenas en títulos de segundo nivel y las
secciones que no son de una escena no se reparten solos.
**Las opciones:** A) reglas nuevas para repartir esos casos; B) dejarlos a la vista, que ya los lee: número pelado en
títulos, secciones a cualquier nivel, y las sin número con fotos a *Map › Pending* con *Assign*.
**Elegí B** porque en ERSO son 18 títulos sin «Escena», 11 escenas en títulos de segundo nivel y 6 secciones sin escena con
72 fotos, y la vista los da bien (139/139 secciones; el mapa 131/131 escena × día, más 9 subtítulos reales; 0 falsos).
Faltaba una prueba que lo fije: D583.
**Si preferís otra:** A solo tiene sentido si Lega elige mover o copiar en D581.

### D583 · R6 se cierra con una prueba de cobertura, una línea de ayuda y la documentación
**Qué pasaba:** «con prueba de conservación» pedía asegurar que nada se pierde ni se duplica. Sin escritura, lo que se
puede perder es una sección que la vista no muestre, o una foto que cruce a una escena que no es la suya.
**Las opciones:** A) cerrar solo en los docs; B) docs + prueba + oración en la ayuda; C) además, R.6b ahora.
**Elegí B:** `src/relations/sectionCoverage.test.ts` fija, sobre un día sintético con los casos raros de ERSO, que cada
sección de escena aparece una vez en cada escena que nombra con el mismo lugar en la cabecera y en el mapa, que las fotos
son un **conjunto** (ninguna se pierde, ninguna de la parte general ni de una sección sin escena llega a una escena, y las
que llegan a dos son solo las previstas), que lo que no es de ninguna escena queda en *Pending* y que armar las vistas no
cambia el documento. No es una suma: `readPageRelations` anota cada foto en todas las secciones abiertas (la de un
subtítulo cuenta en el subtítulo y en la sección que lo contiene, a propósito). La oración de la ayuda («los reportes
quedan enteros», y las palabras *split* y *repartir* para encontrarla) evita que alguien busque cómo repartir y no
encuentre nada.
**Si preferís otra:** A ahorra unas 3 h; C suma 14–20 h (D584).

### D584 · «Read here» (leer la sección entera en la escena) va al roadmap como R.6b, diseñado y sin construir
**Qué pasaba:** lo único que el reparto daba y la vista no es leer la sección entera sin ir al día (el extracto corta a
280 caracteres).
**Las opciones:** A) construirlo ahora; B) dejarlo diseñado en el roadmap; C) descartarlo.
**Elegí B** porque en ERSO la mediana es 1 sección por escena y solo 18 de 117 escenas tienen secciones en dos días o
más: hoy un clic ya lleva al lugar exacto, abierto y resaltado. Vale la pena cuando un proyecto nuevo junte muchas partes
por escena; con el diseño escrito, construirlo no pide otra etapa de diseño.
**Si preferís otra:** A, con el diseño de `Doc_Relaciones.md` sección 16: 14–20 h, riesgo medio-bajo (solo lectura).

### D585 · «Read here» lee de una copia con el editor de solo lectura del historial
**Qué pasaba:** mostrar una parte de otro documento sin poder escribirlo.
**Las opciones:** A) `docs.snapshot` + los bloques de la sección en un `Y.Doc` en memoria + el editor con `preview` y los
servicios del historial; B) el HTML del exportador; C) el texto del índice.
**Elegí A** porque se ve igual que en el día (fotos con anotaciones, Script, tablas, carrete) y las versiones del
historial ya usan ese camino sin escribir. B pierde el carrete y las anotaciones; C pierde todo menos el texto.
**Si preferís otra:** B es la salida si el editor pesa demasiado en el teléfono con *Read all*.

### D586 · Desde la escena no se edita la sección: se edita en el día
**Qué pasaba:** con la sección a la vista, tienta escribir ahí.
**Las opciones:** A) solo lectura y *Edit in Día 59* al lugar exacto; B) un editor atado al documento del día que muestre
solo la sección.
**Elegí A** porque y-prosemirror ata un editor al fragmento entero; mostrar un tramo editable obliga a otro mecanismo de
vista parcial con colaboración, justo donde se pierden datos. Ir al día es un clic y abre la sección resaltada (D399).
**Si preferís otra:** B pide su propio diseño y prueba con dos dispositivos; no entra en R.6b.

### D587 · Si algún día se escribe, solo copiar y nunca borrar del reporte (regla «si algún día…», no vigente hoy)
**Qué pasaba:** dejar escrita la regla para que nadie retome «mover» desde el roadmap.
**Las opciones:** A) nunca mover: a lo sumo copiar con procedencia, verificado y deshacible por id; B) mover en dos fases
(copiar, verificar, borrar).
**Elegí A** porque ni con dos fases se salva lo que otro escribe sin red en lo borrado; copiar solo agrega y el reporte no
cambia.
**Si preferís otra:** B necesita un modo de «sección bloqueada» que no existe y que con offline no se puede garantizar.

### D588 · Un reporte escrito de corrido no se parte solo; si aparece, *Make it a section* solo inserta un título (regla «si aparece», no vigente hoy)
**Qué pasaba:** la otra cara de «repartir» es un reporte sin títulos de escena, con renglones que empiezan con el número.
La escena lo ve como «named in the text» (un renglón), sin las fotos de abajo. En ERSO hay 0 casos.
**Las opciones:** A) nada por ahora (*Prepare*, *Today* y `/e` ya dejan títulos); B) *Make it a section*: insertar un
título `Escena 105_027` (link) antes del renglón, solo inserta, como *Prepare*; C) convertir el renglón en título (cambia
el tipo de bloque: borra y crea, y pierde lo que otro escribe en él).
**Elegí A, con B anotado en el roadmap** porque no hay un caso real que lo pida; si aparece, B es seguro y C no.
**Si preferís otra:** B son 6–9 h reutilizando `prepareDay.ts`.

- **D526 · Los otros nombres de una locación se escriben en su página, como un campo** (2026-10-09; E10): un renglón
  «Otros nombres: Arenera, Estudio» o la fila «Also known as» / «Otros nombres» de su tabla, leído por `fields.ts`. Es
  texto del documento: se escribe en el teléfono, anda sin red, se sincroniza y se exporta; una versión vieja lo ve como un
  renglón. Descartado: un ajuste de la página (invisible en la página y en el `.md`) o una lista central del proyecto.
- **D527 · Rótulos y separadores** (2026-10-09; E10): `also known as`, `aka`, `a.k.a.`, `other names`, `alias`, `aliases`,
  `otros nombres`, `también conocida/o como`, `nombres alternativos`; se separan por coma, punto y coma, renglón, viñeta y
  « · » (`|` y `/` quedan adentro: «Estudio | Autos» es un nombre). Sin comillas ni `?` del final; se ignoran vacíos, «—»,
  menos de 2 letras, más de 60 caracteres, el nombre propio y repetidos; tope 40 por locación.
- **D528 · Solo cuenta la página de la locación misma** (2026-10-09; E10): no sus scoutings, ni una ficha o un decorado con
  una fila «Alias», ni plantillas, papelera o lo que está fuera de las relaciones.
- **D529 · Dónde vale cada nombre escrito** (2026-10-09; E10): dos palabras o más, en todos lados; una palabra, solo donde
  se espera un lugar, por palabra; una palabra genérica o corta en minúsculas, solo ahí y como parte entera. Es la regla de
  D416/D417 aplicada a lo que escribe la gente.
- **D530 · Dónde «se espera un lugar»** (2026-10-09; E10): el título de un día y el valor de un campo de locación
  (*Locacion Real*, *Location*, *Locación*; tabla, renglón o título) en cualquier página. *Locacion Guion* no: es el
  decorado de la historia. La mención sigue siendo de texto (`placeUnits`, clave de caché propia).
- **D531 · «Parte entera» para un genérico** (2026-10-09; E10): entre el borde o un separador (`|`, `,`, `;`, `/`, `+`,
  `·`, paréntesis, `:`, « - ») solo espacios o `?!.`. «Estudio | Autos», «Europa ?» sí; «Estudio UnFilm» no.
- **D532 · Las abreviaturas se resuelven solo con nombres escritos** (2026-10-09; E10): ninguna regla de parecido decide;
  una regla así solo ordenaría sugerencias en *Link to a location…* (D539).
- **D533 · Conflictos: nombre > escrito > derivado** (2026-10-09; E10): el nombre de una locación nunca se le da a otra; dos
  escritos iguales no cuentan para ninguna; un escrito tapa al derivado igual de otra (el nombre sin paréntesis, una parte
  del título). No depende del orden del árbol.
- **D534 · El conflicto se avisa en la cabecera de las dos locaciones** (2026-10-09; E10): un renglón apagado con un toque a
  la otra («“Europa” is also another name of Brandemburgo (Europa) — not used for either»). Pasivo: no salta nada al
  escribir.
- **D535 · Los genéricos suman su versión en inglés** (2026-10-09; E10): `studio, europe, center, centre, house`.
- **D536 · Los nombres escritos se ven en el Map, la lupa, el `/l` y «also written»** (2026-10-09; E10):
  `LocationEntry.aliases` (y `forms`) son todas las formas, valgan en el texto o solo en un lugar.
- **D537 · Lo que se está escribiendo se aplica a los 2 s** (2026-10-09; E10): cambiar los nombres obliga a reconocer todo
  el proyecto; mientras se tipea el renglón se usa lo aplicado antes y se aplica 2 s después del último cambio. Al abrir
  el proyecto, o la primera vez que se lee una locación, enseguida.
- **D538 · La plantilla *Location* trae la fila «Also known as» / «Otros nombres»** (2026-10-09; E10): primera fila de su
  tabla de datos; las versiones viejas la abren igual (una fila más).
- **D539 · *Link to a location…* desde un día sin lugar** (2026-10-09; E10): en la cabecera del día sin locación y en
  *Map › Shoot days*: selector con las parecidas arriba (la regla solo ordena), escribe con `addAliasesInDoc` en la
  locación elegida y avisa con *Open* y *Undo* (saca solo lo agregado y solo si sigue igual). Hecho en la misma tanda.
- **D540 · *Leave out of relations* en el menú ⋯, debajo de *Type*** (2026-10-09; E10): casilla con `canEditRow` y sin link
  público; escribe solo `settings.graph`. Aparece si el proyecto tiene escenas, locaciones o días, o si ya hay una marca;
  heredada de una carpeta: marcada, deshabilitada, «By folder».
- **D541 · Lo que queda afuera se nota** (2026-10-09; E10): rótulo `LEFT OUT` en el árbol (solo la página marcada) y, en
  una escena, locación o día de adentro, «Left out of relations · by “90 | Archivo”» donde iba la cabecera.
- **D542 · Qué nombres se cargan en ERSO** (2026-10-09; E10): solo los que hacen falta (20 en 14 locaciones), sacados de
  `mapa.json` con un guion, en castellano, primer renglón de cada página; «Centro CABA» no (la verdad dice que no es un
  lugar), «Mansión Rosenberg» sí (escrita «Rosenberg», D562).
- **D543 · ERSO se carga con la app, una sola vez y con copia antes** (2026-10-09; E10): ensayo en memoria sin escribir, copia de la
  base, escribir con `addAliasesInDoc` por el gancho de desarrollo y verificar desde un dispositivo nuevo.
- **D544 · Cuándo se da por bueno en ERSO** (2026-10-09; E10): faltan ≤ 1 «planeada en», 69 de 70 días con lugar,
  decorados como la verdad, 0 pares sin respaldo y 0 pares nuevos que la verdad no respalde (revisados uno por uno).
- **D545 · El subrayado usa el mismo contexto de lugar** (2026-10-09; E10): lo que cuenta en un campo de locación se
  subraya, y lo que se subraya cuenta.
- **D556 · «Location (planned)» también es un campo de lugar** (2026-10-09; E10): la plantilla *Scene* trae esa fila;
  `location planned` y `locacion planeada` se suman a los rótulos de locación, así lo escrito ahí da «planned at».
- **D557 · El subtítulo del `/l`** (2026-10-09; E10): con todas las formas (D536) podía ser largo; muestra «Location» y
  hasta dos formas, más «+N» si hay más.
- **D558 · Escribir los nombres va en su propio módulo** (2026-10-09; E10): `addAliasesInDoc` está en `aliasWrite.ts` y no
  en `aliases.ts`, para que el índice no cargue el editor. Agrega al renglón o a la celda de la fila (inserción de Yjs sin
  formato); un campo en forma de título con una lista abajo recibe un renglón nuevo arriba (nunca se reescribe la lista).
- **D559 · `registerProject` sigue devolviendo lo del título** (2026-10-09; E10): suma `titleLocations` y el índice resuelve
  ahí lo escrito (`resolveLocationNames`); sin nada escrito el resultado es idéntico al de antes (pruebas de E4 intactas).
- **D560 · «by» nombra la carpeta más alta que deja afuera** (2026-10-09; E10): como *Create* (G4), es donde se deshace; si
  la página y una carpeta de arriba tienen la marca, la casilla se ve heredada.
- **D561 · *Create location* tampoco crea un nombre en conflicto** (2026-10-09; E10): además de las formas, compara con los
  nombres escritos que no cuentan (D533): son de una locación que existe.
- **D562 · En ERSO se escribe «Rosenberg», no «Mansión Rosenberg»** (2026-10-09; E10, ensayo): «Mansión Rosenberg» es
  también el nombre de la historia (el decorado) en una ficha y en el reporte del Día 46; con dos palabras contaba en el
  texto y daba 3 pares falsos (C10). Con una palabra cuenta solo donde se espera un lugar (el título del Día 54).
- **D563 · *Link to a location…* solo con permiso de editar la locación** (2026-10-09; E10): el selector lista solo las
  locaciones cuya página la persona puede editar, y el botón no aparece si no puede editar ninguna (ni con un link
  público). El texto que se ofrece es la parte de lugar del título sin la fecha, el día ni lo de entre paréntesis.

- **D566 · *Undo* de *Assign* en su aviso: solo lo agregado y solo si sigue igual** (2026-10-09; E11, roadmap v0.245 (2)).
  Qué pasaba: *Assign* no se podía deshacer desde la fila del día ni del mapa (había que borrar « · 105_025» o el link a
  mano). Las opciones: el deshacer del editor (la fila no tiene editor y deshacería lo último escrito, no lo de *Assign*),
  sacar el bloque y volverlo a poner (se lleva lo que otro escribe, la lección de E5) o borrar exactamente lo agregado.
  Elegí lo último porque es lo único que no puede tocar lo de otro: al asignar se guardan anclas relativas de Yjs sobre los
  caracteres agregados (« · 105_025») o marcados (`105_120`); *Undo* los ubica, verifica que digan lo mismo con el mismo
  link y recién ahí borra esos caracteres o saca esa marca, en una transacción, todo o nada. Si alguien escribió en el
  medio, sacó el link o borró el bloque, no toca nada y lo dice. Desde el adelanto (que linkea por el editor) se miran
  los tramos que la edición linkeó y su aviso tiene el mismo *Undo* (⌘Z sigue andando). Si preferís otra: que *Undo*
  saque lo que pueda aunque algo haya cambiado (`undoAssignInDoc` en `assign.ts`, hoy todo o nada).
- **D567 · *Assign* en *Map › Pending* sobre un número que no existe: en todos los lugares que lo nombran** (2026-10-09;
  E11, roadmap v0.245 (3)). Qué pasaba: ahí solo estaba *Create*. Las opciones: un *Assign* por cada lugar (una fila por
  página), uno solo que linkea todos, o mandar a cada página. Elegí uno solo, en la ranura `actions`, porque el error de
  tipeo suele estar repetido y *Pending* lo muestra como una sola fila: linkea cada aparición en cada página que lo nombra
  **y la persona puede editar**, directo en cada Y.Doc (como desde el día); las que no pudo (no bajó entera, algo que esta
  versión no conoce, el número ya no está) se dicen en el aviso. *Undo* mira primero todas las páginas y deshace solo si
  en todas sigue igual. Si preferís otra: un botón por página (`AssignButton` con `kind: 'mention'` por cada lugar).
- **D568 · Lo que se tipea en el menú `/` de escenas no cuenta como pendiente mientras el menú está abierto** (2026-10-09;
  E11, O7 de la auditoría de E7). Qué pasaba: «/e 105_141» está escrito en el documento mientras se elige, el índice lo
  leía y *Map › Pending* y el número de la fila *Map* lo sumaban hasta elegir. Las opciones: que el lector ignore todo lo
  que empieza con «/e » (también lo que quedó escrito con Esc, que sí es texto), o anotar la consulta abierta. Elegí lo
  segundo: mientras el menú está abierto, este dispositivo anota qué números de qué bloque son la consulta
  (`slashDraft.ts`) y el mapa no los cuenta en ese bloque; al cerrarse el menú (elegir, Esc, tocar afuera) se borra y, si
  quedó escrito, vuelve a contar. No cambia el lector ni el índice. Queda: el subrayado gris de ese número mientras se
  tipea (es de `relUnderline.ts`, de otro frente) y otro dispositivo, que puede verlo un momento. Si preferís otra: que el
  lector tape «/palabra número» siempre.
- **D569 · `/e 105_027a`: la escena con letra si existe; si no, la base con la letra de la parte** (2026-10-09; E11, O6).
  Qué pasaba: con una parte (`105_027a`, sin escena `105_027A`) ↵ dejaba `105_027` y la letra se perdía. Las opciones:
  dejar el código canónico de la base, o el texto con la letra. Elegí: si existe `105_027A` va primero y se linkea esa; si
  no, el ítem dice «105_027a · part of 105_027» y deja `105_027a` (la letra como se escribió) con el link a `105_027`,
  como escribe el set las partes. `searchScenes` lleva la parte en la opción (`part`). Si preferís otra: siempre el código
  de la escena, sin la letra.
- **D570 · Sin episodio propio (un día), primero el plan y después el episodio del plan** (2026-10-09; E11, O8). Qué
  pasaba: en el selector de un día, `104_054A` salía antes que las escenas de 105 del plan, porque el día no tiene
  episodio y el resto iba por número. Elegí: primero las cercanas en su orden (el plan, las secciones del día, lo que nombra
  la página), después las de los episodios de esas cercanas, después el resto. El `/` de un día suma a las cercanas el plan
  del desglose (las fichas con su fecha), que antes solo contaba si una página lo nombraba. Si preferís otra: las cercanas
  por número, como antes (`pickerOptions` en `EntityActions.tsx`).
- **D571 · El fondo del subrayado bajo el mouse, solo con el mouse movido de verdad** (2026-10-09; E11, O9 de la auditoría
  de E6). Qué pasaba: el subrayado nuevo que se dibuja debajo del puntero quieto se pintaba con el fondo de `:hover`
  mientras se escribía. Elegí el mismo criterio que el adelanto (D455): el contenedor del editor lleva `data-rel-mouse`
  mientras el mouse se movió a otro lugar desde la última tecla, y el CSS lo pide. Va en `hoverGate.ts` con su propio
  `MouseGate` (sin tocar `relUnderline.ts`). Si preferís otra: el fondo siempre (sacar `[data-rel-mouse]` del CSS).
- **D572 · *Today* no deja un espacio antes de la puntuación** (2026-10-09; E11, O11 de E6): el espacio de después va solo
  si lo que sigue no es un espacio, puntuación o un cierre («… doble 101_001.», no «101_001 .»); al final del renglón queda
  (para seguir escribiendo).
- **D573 · Un día sin día siguiente tiene tarjeta *Tomorrow*: crear y preparar el reporte de mañana** (2026-10-09; E11,
  roadmap v0.241 (1)). Qué pasaba: sin un día siguiente no había tarjeta, y había que crear el reporte con *New day report*
  y después volver para prepararlo. Las opciones para la fecha: el día siguiente siempre, la de hoy en el dispositivo (lo
  que propone *New day report*) o la próxima que planea el desglose. Elegí la próxima fecha con escenas en el desglose
  dentro de una semana (un fin de semana o un franco en el medio) y, si no hay, el día siguiente, con su plan del desglose
  ajustable como en la otra tarjeta. Solo con el índice completo (si no, mañana puede existir sin estar leído) y para quien
  ve el proyecto entero (si no, mañana puede estar donde no ve). Si preferís otra: el día siguiente siempre
  (`proposeTomorrow` en `tomorrowNew.ts`, `LOOKAHEAD_DAYS`).
- **D574 · El título del reporte de mañana tiene la forma del de hoy, sin la locación** (2026-10-09; E11). Qué pasaba: *New
  day report* titula `2026-02-21 | Day 61` en el idioma de la app; los días de ERSO dicen `2026-04-06 | Día 81 | Farmacia
  Fanfarria`. Elegí la palabra, el separador y los ceros del de hoy (`2026-04-07 | Día 82`) y no copiar lo de después: es
  la locación de hoy, y el título es de donde la cabecera saca el lugar del día (D398); mañana puede ser otro. Sin esa
  forma, el de *New day report*. Si preferís otra: copiar la locación de hoy al título.
- **D575 · Crear el reporte de mañana con las garantías de *Prepare*** (2026-10-09; E11). Qué pasaba: crear en un paso
  podía duplicar el reporte (dos toques, dos dispositivos) y *New day report* crea sin red. Elegí: primero una
  sincronización buena en el momento (sin red no crea y lo dice: otro dispositivo pudo crearlo); si la carpeta ya tiene un
  reporte con esa fecha, prepara ese y no crea otro; dos toques seguidos dan uno solo; si no, la página como *New day
  report* (la plantilla de la carpeta o *On-Set Report*, la ficha llena con lo de ayer) en la carpeta del día de hoy, con la
  marca de día explícita y **sin tocar la marca de la carpeta**; *Prepare* la prepara antes de subirla y se sube enseguida.
  **Corregida por D579 y D580** (auditoría de E11, B2): la ventana real no era «un viaje» sino todo el trabajo del
  primero (2–3,5 s medidos en la base), y el segundo podía preparar la página del primero antes de que llegara su
  contenido y repetir las secciones. Si preferís otra: que cree sin red como *New day report*.
- **D576 · *Undo* del reporte de mañana: a la papelera solo si nadie lo tocó** (2026-10-09; E11). Elegí lo de *Create*
  (D547): sincroniza y, solo si el reporte sigue como quedó (título, lugar, contenido, sin páginas adentro), va a la
  papelera; si alguien escribió, queda y lo dice; sin red no deshace. Si el reporte ya existía, *Undo* es el de *Prepare*
  (saca solo lo agregado que sigue vacío).
- **D577 · Quién ve la tarjeta para crear** (2026-10-09; E11): quien ve el proyecto entero; sin permiso de crear en la
  carpeta del día, la tarjeta lo dice sin el botón (y se vuelve a mirar al crear, después de sincronizar). Un invitado a
  una parte no la ve.
- **D578 · Tipeando un número en un día, también primero el episodio del plan** (2026-10-09; corrección de E11, B1 de la
  auditoría). Qué pasaba: D570 ordenaba solo la lista vacía; al tipear `026` en un día de 105, el lector probaba los
  episodios en orden (101, 102…) y salían `101_026A` o `101_026` antes que `105_026` (en ERSO, `054` daba 101, 102 y
  104_054A antes que 105_054), y elegir el primero asignaba la escena equivocada. Las opciones: dejarlo (el número
  completo `105_026` igual funciona) o que la búsqueda exacta use el mismo orden que la lista. Elegí lo segundo: sin
  episodio propio, `exact()` prueba primero los episodios de las escenas cercanas (`nearEpisodes`: el plan, las secciones
  del día). Con el episodio de la página, manda ese; sin nada cerca, por número como antes. Si preferís otra: sacar
  `prefer` de `exact()` en `sceneSearch.ts`.
- **D579 · Nunca se prepara un reporte cuyo contenido todavía está llegando** (2026-10-09; corrección de E11, B2). Qué
  pasaba: la fila de un reporte nuevo llega al servidor antes que su contenido; otro dispositivo lo veía vacío, lo
  preparaba y, al llegar lo del primero, quedaban `Escena 105_026` y `Escena 105_029` dos veces. Las opciones: preparar
  igual y que *Prepare* de nuevo limpie (D436), esperar el contenido, o no tocarlo. Elegí: (1) el reporte de mañana se
  escribe **de una vez**, la plantilla y las secciones en un solo guardado (una sola subida: nadie ve la plantilla sin
  las secciones); (2) *Prepare* (también el de la tarjeta de siempre) no escribe en una página creada en otro dispositivo
  hace menos de 2 minutos que no tiene nada ni en el servidor ni en el dispositivo: espera hasta 10 s sincronizando y, si
  no llega, no toca nada y lo dice («se acaba de crear en otro dispositivo… probá en un momento»); (3) la tarjeta del
  último día, si encuentra así el reporte de esa fecha, no lo prepara: el otro dispositivo lo está preparando
  (`elsewhere`). Una página vacía de verdad (más de 2 minutos) se prepara como siempre. Si preferís otra: preparar
  igual y confiar en *Prepare* de nuevo (`isArriving` en `prepareDay.ts`).
- **D580 · Dos dispositivos que crean el mismo día a la vez: cede el de id mayor; si quedan dos, se ven** (2026-10-09;
  corrección de E11, B2). Qué pasaba: con 0–3,5 s de diferencia quedaban dos reportes del mismo día. Las opciones: una
  restricción en la base (fecha única por carpeta: no vale para una segunda unidad), dejar los dos o que uno ceda. Elegí:
  lo local (la carpeta, la plantilla) antes de sincronizar; la fila sola y subida apenas se crea; una lectura más
  empezada después de subirla; si aparece otro reporte con el mismo día y **id menor**, este dispositivo abandona su
  página **todavía vacía** (a la papelera) y queda el del otro. «Vacía» es seguro para quien la creó, no para un tercer
  dispositivo: si alguien abre esa copia en sus primeros segundos y escribe, su texto puede llegar después de la
  decisión y quedar en la página de la papelera (no se pierde: se ve con «Restaurar»; la re-verificación lo reprodujo con
  un tercero que la buscaba cada 100 ms). Mirar una última vez antes de la papelera queda en el roadmap. El de id
  menor nunca cede, así que siempre queda al menos uno. Si ninguno vio al otro, quedan los dos: el aviso lo dice y *Map ›
  Pending* lista los días con el mismo título (««2026-03-16 | Día 76» is in 2 pages», con ícono de día y su ayuda; una
  segunda unidad con el mismo título también sale, y puede quedar). Medido en la base real con la hora del toque fijada,
  0, 1, 2, 2,5, 3 y 3,5 s (dos tandas, 11 corridas): siempre un reporte, nunca secciones repetidas. El costo: el que crea
  espera una sincronización más (aviso a los 4,5–7 s en vez de 2–4). Si preferís otra: no ceder y dejar los dos listados.
  **Corregida por D626–D630** (E15): la copia que cede lleva una marca y vuelve sola de la papelera si alguien escribió en
  ella; el aviso de «quedaron dos» sale solo si quedaron.

- **D661 · El `data-tip` de la nota de un nombre que no cuenta, un texto por caso** (2026-10-09; E17, auditoría de la v0.247
  (6)). Qué pasaba: decía «cambialo en una de las dos» también cuando el nombre es el de otra locación, y ahí no hay dos
  páginas que cambiar. Ahora «es el nombre de otra locación… sacalo de esta página» y, para el nombre repetido en dos,
  «cambialo en una de las dos».
- **D662 · Lo que se escribe en «Otros nombres» es un nombre que el lector va a leer** (2026-10-09; E17, v0.247 (7)). Qué
  pasaba: *Link to a location…* escribía el texto del título tal cual; con comas se partía en varios nombres y con más de
  60 caracteres el lector lo ignoraba mientras el aviso decía «agregado». Las opciones: avisar después o no ofrecerlo.
  Elegí no ofrecerlo: `writableName` (`aliases.ts`) es la misma limpieza del lector (un solo nombre, comillas y `?` fuera,
  hasta 60 caracteres, dos letras); `titleFragment` lo usa y el botón no aparece si no pasa; `addAliasesInDoc` también la
  aplica (nada ignorado se escribe) y, si el texto es el nombre de la locación misma, el aviso dice que ya era un nombre.
  Un nombre ya presente no se repite (ya lo hacía `addAliasesInDoc`). Si preferís otra: ofrecerlo y partir en varios.
- **D663 · *Leave out of relations* no se ofrece con un link público: con prueba** (2026-10-09; E17, v0.247 (9)). El código
  ya lo cortaba (`if (link) return null`); la prueba pone una página que ya tiene la marca (si no, la casilla tampoco
  salía por falta de sesión) y falla sin la guarda.
- **D664 · El subrayado gris de pendiente salta la consulta abierta del `/`** (2026-10-09; E17, v0.248 (1)). Qué pasaba:
  mientras se tipea `/e 105_141` el número quedaba subrayado de pendiente. Ahora `buildUnderlines` lee `slashDraft` (que
  guarda también la consulta tal como está escrita, `query`) y no subraya los pendientes de esa consulta, en su bloque y
  desde el `/`; al cerrarse el menú sin tocar el documento (Esc) se vuelve a dibujar.
- **D665 · La consulta descuenta solo su mención** (2026-10-09; E17, v0.248 (9)). Qué pasaba: `withoutDraft` sacaba el
  bloque entero de las menciones del número, así que una mención escrita antes del `/` dejaba de contar. Ahora `noteDraft`
  mira el resto del bloque (`textWithout`, con los links a páginas tapados) y no anota como consulta un número que el
  bloque nombra también afuera.
- **D666 · *Assign* en *Pending* dice qué páginas no pudo tocar por permisos** (2026-10-09; E17, v0.248 (5)). El aviso suma
  «también está en «X», que no podés editar» con las páginas que nombran el número y la persona no edita (se saltean
  como siempre). Si ninguna se pudo editar, el botón no está (como antes).
- **D667 · Las fechas largas y cortas de la cabecera salen en el idioma de la app** (2026-10-09; E17, v0.248 (11)). Qué
  pasaba: `locale() === 'es'` nunca era cierto (`locale()` devuelve `es-AR`), así que salían siempre en inglés
  («Thu 19 Feb 2026») también con la app en castellano. Ahora `language()`: «jue 19 feb 2026».
- **D668 · «Dejar fuera de las relaciones» en un renglón** (2026-10-09; E17, v0.247 (8)). Elegí no partir el rótulo ni
  acortarlo (es el de D540, también citado en los avisos): `white-space: nowrap` y el menú ⋯ se coloca con el ancho real
  (`PAGE_MENU_WIDTH`, 290; antes 240 y se salía de la pantalla). En inglés el menú no cambia de ancho.
- **D669 · En el teléfono la nota de la tarjeta *Tomorrow* deja libre la columna del botón de dictar** (2026-10-09; E17,
  v0.248 (10)). Solo CSS de la tarjeta: `padding-right: 60px` en el renglón de la nota y el aviso, hasta 760 px (donde
  aparece el botón redondo). El botón sigue tapando lo que pasa por debajo mientras se desliza: es un botón fijo.
- **D670 · Borrar la última cifra de un número ya no deja la referencia vieja en el resto** (2026-10-09; E17, v0.244 (7),
  O10). `dropShrunk` saca lo dibujado cuyo tramo quedó más corto al correrlo con la edición; escribir al lado sigue sin
  apagarlo.
- **D651 · Un link a cualquier página de una escena repetida cuenta para la escena (parte E16-0)** (2026-10-09; E16, plan
  §1.4 y auditoría del plan, C1). Qué pasaba: con dos páginas del mismo número, el mapa de destinos de los links tenía solo
  la primera (`registration.scenes`); un link a la segunda tapaba su texto y no daba mención. Es el caso de la carrera de
  *Create*: el `/e` del segundo dispositivo apunta a su propia página. Las opciones: esperar al *Merge* o sumarlas al mapa.
  Elegí sumarlas: `RelationIndex` agrega cada página de `registration.duplicates` con el código de su escena y deja el
  mapa en la foto (`linkTargets`); `linkTargetOf` (la cabecera del día, *Prepare*) usa ese mismo mapa. Las que están fuera
  de las relaciones no están en `duplicates` y siguen sin contar. Si preferís otra: no hay; contar una mención no escribe
  nada.
- **D641–D660 · *Merge* (E16), con el alcance reducido de la auditoría del plan** (2026-10-09; plan
  `E16_plan.md`, auditoría `E16_auditoria_plan.md`, C1–C10). Quedan como en el plan: D641 (copiar al final de la que
  queda y mandar la otra entera a la papelera con un puntero), D642 (*Pending* y la cabecera viva de las dos; los días con
  el mismo componente), D643 (siempre con el adelanto), D644 (cuál queda, con M9), D645 (en el Y.Doc, al final, los mismos
  ids, separador título 1; el id del separador y los de B que A ya tenía, derivados, también anidados: C4), D646, D649,
  D650, D653, D657, D659 y D660. **Cambiadas:** D647 (sin funciones en la base: el orden de C3 en el dispositivo, anotado
  para seguir), D651 (los links a la unida cuentan para la de A por el puntero; la redirección automática de `/p/B#bloque`
  y en la exportación, al roadmap), D652 (M1 y una M8 local, C6), D654 (lo que llega tarde se lista en *Pending* con *Open*
  y *Dismiss*; no se trae), D655 (*Undo* solo en el aviso), D658 (dos reportes del mismo día se unen con el mismo
  *Merge*; ceder el reporte de mañana uniéndose no se hizo: D683). **No usadas:** D648 (los comentarios no se mueven:
  D676) y D656 (la versión con nombre «Before merging»: no hace falta sin mover nada de A; al roadmap).
- **D676 · Una página con comentarios no se va (M9)** (2026-10-09; E16, auditoría del plan, punto 2 y C7). Mover
  comentarios rompe `comment_mentions` (B1) y pide una función en la base. Elegí no unir si la que se va tiene alguno, en
  cualquier estado (la base, `comments_view`, más los de la cola del dispositivo): el adelanto propone como la que queda
  la que tiene comentarios, y si las dos tienen, el botón queda apagado con «Both pages have comments…». Se mira al abrir
  el adelanto, al empezar y otra vez justo antes de la papelera: uno que aparece en el medio frena ahí y A queda con la
  copia y B viva («Someone commented on «B» while merging…»). ERSO: 0 comentarios en páginas de escena.
- **D677 · Sin migración: el puntero es una pista** (2026-10-09; E16, auditoría del plan, punto 1). `settings.merged =
  { into, seq, at }` va por `patch_page_settings` (como cualquier ajuste) antes de mandar B a la papelera con `tree.trash`
  (sus políticas, triggers y versión mínima de siempre). Nadie en la base confía en él y la app lo valida al leerlo (C2):
  B en la papelera, el destino vivo, del mismo proyecto, visible, distinto de B, cadena de hasta 5.
- **D678 · M6 solo para la que se va** (2026-10-09; E16). Si la que se va está llegando de otro dispositivo (D579), se
  copiaría nada y su contenido llegaría a la papelera: no se une. La que queda puede estar llegando: su contenido se junta
  con la copia (Yjs, `mergeRootGroups`). Lo encontró la prueba con la app montada (una escena recién creada y vacía).
- **D679 · La que se va se lee sin abrirla en el editor** (2026-10-09; E16). `docs.indexSnapshot(B)` (un documento
  aparte): abrirla con `docs.open` puede escribirle una reparación, que sube su `update_seq` y haría aparecer en *Pending*
  un «changed after it was merged» falso (O1 de la auditoría).
- **D680 · *Undo*: qué es «intacto» y el separador** (2026-10-09; E16, C5). Intacto: el contenedor, cada valor de su mapa
  (y lo que tuvo antes) y cada item de su lista, a cualquier profundidad, son del autor de Yjs de la copia y caen enteros
  en su rango de relojes, y ninguno está borrado. El separador sale solo si salieron todos los bloques copiados (si alguno
  queda, el título le da contexto). Las anotaciones y los colapsados copiados quedan (claves sin bloque: no se ven).
- **D681 · Una unión que quedó a mitad sigue sola** (2026-10-09; E16, C3). `MergeResumer` (montado en el espacio de
  trabajo) la sigue con cada sincronización buena; *Pending* la lista en el dispositivo que la empezó («Merging «B» into
  «A» didn’t finish») con *Finish*. Otro dispositivo no la puede terminar (sin cerrojo en la base: E16b).
- **D682 · *Dismiss* anota también las subpáginas vistas** (2026-10-09; E16). Una página nueva adentro de B después de
  unir se lista igual que un cambio de texto; *Dismiss* sube `seq` al de ahora y guarda los ids de las subpáginas de ese
  momento (`kids`), así una nueva después vuelve a listarse.
- **D683 · Lo que no se hizo en esta tanda** (2026-10-09; E16). Ceder el reporte de mañana uniéndose (punto 7 de la
  auditoría del plan, roadmap v0.248 (0) y (14)): `tomorrowNew.ts` lo estaba cambiando E15 y el encargo pedía no tocarlo.
  B en la papelera en solo lectura (O5): no se hizo; lo que se escribe ahí se ve en *Pending*. Los dos, al roadmap.
- **D684 · Cada unión tiene su id** (2026-10-09; E16, recorrido en la base real). Qué pasaba: el id del separador salía
  solo de B; si una versión vieja restauraba B, alguien le escribía y se volvía a unir, A ya tenía ese separador, la copia
  se salteaba y lo nuevo quedaba solo en B, en la papelera, sin aviso (el puntero nuevo tenía el `seq` de ahora). Ahora
  el trabajo guarda un id propio (`nonce`) y el separador y los ids derivados salen de `B:nonce`: retomar la misma unión no
  duplica y otra unión de la misma página copia lo suyo, sin ids repetidos en A. La última mirada antes del puntero no
  frena por un puntero viejo de una página viva (solo por uno de después de empezar, a otra página).
- **D685 · *Restore* desde la app saca el puntero** (2026-10-09; E16). Si no, una página restaurada y mandada después a la
  papelera a mano se leería como unida (sus links contarían para la otra). Una versión vieja no lo saca: queda sin efecto
  mientras esté viva.
- **D686 · *Merge* y la copia que cede (E15) conviven** (2026-10-09; E16, al unir `main` v0.251). Las dos claves de
  `settings` (`merged`, `ceded`) son distintas y la base las fusiona por clave. Una copia cedida en la papelera no es una
  unida (no tiene `merged`) ni está en las repetidas (está en la papelera): no se ofrece para *Merge* ni cambia *Pending*.
  Si el vigía de E15 la devuelve, queda viva y repetida y se puede unir; su marca deja de valer (otra hora de papelera), así
  que una página unida nunca se lee como cedida ni la devuelve el vigía. Con prueba.
- **D687 · Un solo candado por página que se va** (2026-10-09; E16, B1 de la auditoría del resultado). Qué pasaba: la unión
  del adelanto no se anotaba como corriendo; el vigía (`MergeResumer`), que corre con cada sincronización, encontraba el
  trabajo y arrancaba otra corrida igual. La segunda no tenía el registro de la copia (`already`), así que no esperaba las
  fotos: B podía ir a la papelera sin sus usos en A (C3 roto, medido) y avisaba «… queda» con B ya en la papelera. Las
  opciones: que el vigía saltee lo anotado hace poco, o un candado. Elegí el candado, por dispositivo (`runningOf(docs)`),
  compartido por `runMerge` (tomado antes de la primera guarda), `resumeMerges` y *Finish*: si la página ya corre, el vigía
  la saltea sin avisar, *Pending* no ofrece *Finish* y otro *Merge* dice «ya se están uniendo». Además las fotos a confirmar
  se anotan en el trabajo antes de copiar (`photos`): no dependen de qué corrida copió. Pruebas: `mergeRace.test.ts` (la
  del auditor, que fallaba, y una corrida sin el registro de la copia) y la montada, sin un segundo aviso.
- **D688 · Cada guarda del trabajo, con un caso que falla sin ella** (2026-10-09; E16, O4 y O5). Contenido desconocido en la
  que se va o en la que queda, la que se va llegando de otro dispositivo (M6), la que se va atrás del servidor, la que queda
  en la papelera antes del puntero, un invitado con *Edit & create pages* y quien recibe base limpia. El informe anterior
  las daba por probadas y no lo estaban (la de M6 se vio en la app montada y no quedó como prueba).
- **D689 · La frontera del *Undo*, dicha entera** (2026-10-09; E16, O1). Una edición de otro dispositivo en un bloque copiado
  que llega después de la mirada del *Undo* (sin red, o con red en el viaje de ida y vuelta) queda en el historial de A, no a
  la vista. Es la de E5; achicarla (volver a mirar después de un viaje) va al roadmap.
- **D690 · Lo que la auditoría del resultado anotó y no entra en esta ronda** (2026-10-09; E16). Al roadmap: no copiar lo
  idéntico a la plantilla (la carrera de *Create* con texto en las dos duplica «Director:/Arte:» y la tabla, O3); el adelanto
  con el índice atrasado (O2); la segunda unión tras *Restore* repite lo de la primera (O6, se prefiere duplicar);
  `addsNothing` ignora mayúsculas y formato (O7); filas y avisos con el mismo título sin «· 1 / · 2» (O8).
- **D706 · Dos páginas con el mismo título se distinguen con algo que la persona entiende** (2026-10-09; E19, O8 de E15 y de
  E16). Qué pasaba: *Pending* (repetidas), el «Open “…”» de la copia que cede y los avisos de *Merge* mostraban dos
  páginas con el mismo título. Elegí dos formas según qué se pueda decir: **«· 1» / «· 2»** (el orden del árbol, el mismo
  del adelanto; con un `data-tip` que lo explica) y, en cada fila de repetidas, cuánto tiene escrito cada una (bloques y
  fotos, de lo que leyó el índice); y, para lo que habla de una unión (avisos, filas de después, el cartel de la unida),
  **«· la que se va» / «· la que queda»**, porque ahí el árbol ya no sirve (una está en la papelera). El cartel de la copia
  que cede dice «(la que quedó)». Solo se agrega cuando los títulos son iguales (menos el cartel de la que cedió, que lo
  son siempre). Si preferís otra: un contador solo, o la fecha de creación.
- **D707 · *Merge* copia solo lo que la que queda no tiene, decidido con los documentos** (2026-10-09; E19, O2, O3, O6 y O7
  de E16). Qué pasaba: B se copiaba entera: lo que las dos traían de la plantilla (la carrera de *Create*) y lo que una unión
  anterior ya había copiado (unir otra vez después de *Restore*) quedaban dos veces; y «no agrega nada» comparaba el texto en
  minúsculas y sin formato (B con el mismo texto en mayúsculas o en negrita iba a la papelera sin copiarse), con el índice,
  que puede ir atrasado. Elegí: una **firma** de cada bloque de primer nivel (tipo, atributos menos el id, texto con su
  formato y lo de adentro) y se copia lo de B cuya firma A no tiene, **contando cuántas veces**; los renglones en blanco del
  principio y del final no se copian, los de en medio sí. Nada se pierde: lo que no se copia está idéntico en A (o es un
  renglón en blanco), y B va entera a la papelera con *Restore*; una prueba con mezclas al azar lo verifica. El adelanto lo
  lee de los documentos (`planCopy`) y dice cuántos bloques se agregan. Si preferís otra: copiar siempre todo (más simple,
  duplica).
- **D708 · Mientras une, el adelanto solo dice si la red se cortó** (2026-10-09; E19, O10 de E16). Con la red cortada a mitad
  decía «Conectate para unir…» con el botón en «Uniendo…»; y lo demás que dice el adelanto cambia a medida que avanza la
  unión (B entra a la papelera: «ya no son dos»). Ahora, ocupado, calla salvo «Se cortó la red: la unión sigue sola cuando
  vuelva». La prueba montada (O9) también afirma que *Pending* no ofrece *Finish* mientras la unión corre.
- **D709 · La locación en el título del reporte de mañana, cuando todas las fichas de esa fecha dicen la misma** (2026-10-09;
  E19, la opción B de D631). Medido en `mapa.json` de ERSO (la verdad independiente; solo lectura): de 73 días, 12 tienen
  páginas con esa *Fecha Rodaje* (son los días «Sin reporte», los que se planean con el desglose) y en **11 de esos 12** las
  fichas dicen un solo lugar, igual al del título; el 12.º (15/03/2026) dice dos. Elegí hacerlo: `plannedPlace` pide que
  **todas** las páginas con esa fecha tengan un campo de locación, que cada valor sea una locación del registro y que sean
  la misma; si no, sin lugar. Y solo cuando el título de hoy lleva un lugar (la forma del proyecto: `2026-04-06 | Día 81 |
  Farmacia Fanfarria`): un proyecto cuyos días no llevan lugar no lo gana. La tarjeta lo muestra antes de crear. Si
  preferís otra: dejarlo como D574 (nunca la locación).
- **D710 · El menú ⋯ cabe en 320 px con «POR CARPETA»** (2026-10-09; E19, v0.250 (13)). El renglón más largo mide 341 px
  y a 320 se salía 43. Elegí: hasta 356 px de pantalla el rótulo baja a dos renglones (el estado no se parte), el menú de
  página nunca pasa del ancho de la pantalla menos 16 px (`max-width`), `menuBelow` lo coloca pegado al margen cuando no
  entra y `useFloating` lo vuelve a medir después de correrlo (al correrse se ensancha). Desde 357 px el renglón sigue en una
  línea. Medido en Chromium a 320, 340, 356, 357, 360, 375 y 390 px, en castellano e inglés.
- **D711 · Un lugar del título que no puede ser un nombre se muestra y dice por qué** (2026-10-09; E19, v0.250 (12)). Un día
  cuyo lugar lleva coma («Hall, Pasillo del Ministerio») no ofrece *Link to a location…* (D662) y no decía nada. Opciones:
  partirlo en varios nombres o explicar. Elegí **explicar**: partirlo pide una locación por cada parte y la persona sabe
  cuáles son; la cabecera y *Map › Days* muestran el texto apagado con un tooltip distinto para «varios lugares» (agregá cada
  uno como nombre propio en su locación) y para «demasiado largo» (más de 60 caracteres). Si preferís otra: un selector por
  cada parte.
- **D712 · Un aviso con botón no vence con el mouse o el foco encima** (2026-10-09; E19, v0.248 (6)). El *Undo* de *Assign*
  y del reporte de mañana vive solo en el aviso de 15 s, que seguía corriendo con el mouse encima del botón. Ahora el aviso
  se detiene mientras el mouse o el foco del teclado están encima y, al soltarlo, queda lo que le quedaba, con un mínimo de
  4 s (`RESUME_MS`) para llegar al botón; un `mouseleave` que no llega (el aviso se cerró con OK) no traba el siguiente. El
  aviso pasó a su componente (`NoticeBar.tsx`). La cola (D356–D359) no cambió. Corregida por D717 (el toque y el foco).
  Queda: el aviso sin botón que llega encima lo corre un rato (es D357).
- **D713 · Un título idéntico viaja con su sección** (2026-10-09; E19, ronda de corrección, B1 de la auditoría). Qué pasaba: D707
  saltaba el título de escena idéntico en las dos páginas pero copiaba lo que B había escrito debajo, que quedaba bajo el separador
  «General · merged from the other report»: el lector toma eso como la sección general y la escena dejaba de ver esa foto y ese
  texto; el adelanto prometía lo contrario. Elegí lo que sugería la auditoría: un título (`heading`) idéntico se saltea solo si
  **toda su sección** en B también se saltea (hasta el próximo título de su nivel o de uno más alto, contando los de adentro);
  si algo de debajo se copia, el título va con eso. Cuesta un título repetido cuando solo cambia una línea de su sección (también
  en la plantilla de una escena: «Notes»); lo idéntico de adentro igual no se copia. Si preferís otra: copiar siempre los títulos.
- **D714 · Antes de la papelera se vuelve a mirar que lo salteado siga en la que queda** (2026-10-09; E19, O2). Qué pasaba: si otro
  dispositivo borraba de A, mientras se unía, un renglón que B tenía idéntico (y por eso no se copió), ese renglón quedaba solo en
  B, en la papelera. Elegí lo más simple: el trabajo anota las firmas de lo salteado (`job.skipped`) y, después de la última
  sincronización y antes del puntero, cuenta que A todavía las tenga (`missingFrom`); si falta alguna, **se frena** como cuando
  aparece un comentario: A queda con la copia y B viva y repetida («… changed while merging…»), y unir otra vez copia solo lo que
  falta. Una edición de ese renglón en A también lo frena (no es el mismo bloque): se une otra vez y nada se pierde.
- **D715 · Una foto con anotaciones que A no tiene no es «idéntica»** (2026-10-09; E19, O1). Qué pasaba: la misma foto (pegada en las
  dos) anotada solo en B daba el mismo bloque, no se copiaba y las formas se quedaban en B. Elegí que un bloque con fotos solo se
  saltea si **cada forma de B** (su id y sus campos) ya está en A; si no, se copia el bloque y las formas pasan con las reglas de
  pegar. Si A tiene más anotaciones que B, o las mismas, se saltea.
- **D716 · «· 1 / · 2» estable con tres páginas y «la que se fue» en el aviso de después** (2026-10-09; E19, O3 y O5). El número
  de cada repetida sale del grupo entero (`MergePair.group`) y es el mismo en *Pending* y en el adelanto abierto desde la
  cabecera de la tercera («· 1» y «· 3»). El aviso de una unión hecha dice «la que se fue» (antes «la que se va», que queda para
  lo que todavía no pasó). El adelanto sigue con «· 1 / · 2» y los avisos con los papeles: son dos nombres para las mismas dos,
  elegidos en D706 (el árbol ya no sirve cuando una está en la papelera).
- **D717 · El aviso solo lo sostiene un mouse o el foco, cada uno por su lado** (2026-10-09; E19, O4). En una pantalla táctil un
  toque emulaba «mouse encima» y retenía el aviso hasta el próximo toque afuera; y el mouse y el foco compartían una bandera.
  Ahora solo cuenta un puntero de tipo mouse (`onPointerEnter`), el foco es otra bandera y soltar uno no libera si el otro sigue.
  En el teléfono el aviso sigue corriendo, como decían D712 y la ayuda. El foco que deja un clic o un toque en un botón del
  aviso no lo sostiene (si no, después de *OK* el aviso siguiente quedaba quieto hasta un clic afuera): solo el que llega
  con el teclado.

### D601 · Abrir una página en un dispositivo nuevo no vuelve a registrar las fotos que ya usa
**Qué pasaba:** en un dispositivo nuevo, abrir una página durante la primera sincronización ponía en la cola un aviso
«esta página usa esta foto» por cada foto del documento, antes de comparar la página con el servidor. En ERSO, el Día 59:
«Uploading 52 changes…», después «41 changes not uploaded», y 52 `link_page_file` que no cambiaban ninguna fila.
**Las opciones:** A) que la pastilla no los cuente (se seguirían mandando: mentiría el conteo); B) no anotarlos al abrir y
dejarlos a la comparación del motor (pierde la línea base: una foto borrada antes de la primera comparación nunca se
desvinculaba y el archivo no llegaba nunca a la papelera); C) anotarlos igual, pero **sin confirmar**: `pending` 0 y la
marca `unconfirmed`, ni contados ni mandados; la comparación (`reconcilePage`) los confirma con lo que el servidor ya tiene
(`serverUses`, B.14), los pone por mandar o los quita.
**Elegí C** porque corta la causa sin tocar cuándo se vacía la cola ni el orden de subida, y conserva la línea base para
mandar el `unlink`. Lo que la persona pega o agrega en el editor se sigue encolando en el acto. Todo uso que el servidor no
tenga lo encola la comparación en el primer ciclo completo con la página bajada (no con un error al guardar en el
dispositivo, que la frena, ni en un ciclo que se corta antes). Durante la primera bajada la pastilla dice «Syncing…».
**Si preferís otra:** A es una línea pero contradice la regla 6; B necesita otra forma de recordar qué tenía la página.

### D602 · Solo queda sin confirmar lo que vino del servidor
**Qué pasaba:** la marca de sin confirmar supone que el documento local es el del servidor.
**Las opciones:** A) marcar siempre al abrir; B) marcar solo si la página ya existe en el servidor, no tiene nada propio sin
guardar, sin subir ni rechazado (`PageDocs.hasOwnUnsent`) y guardar en el dispositivo no está fallando; si no, como antes.
**Elegí B** porque una página creada acá, duplicada o con una copia que entró sin el editor tiene usos que solo este
dispositivo conoce: esos se mandan en el acto y siguen frenando el `unlink` del mismo archivo en otra página
(`hasUnsentUse`). Las filas sin confirmar no frenan ese `unlink` (como las páginas que nunca se abrieron).
**Si preferís otra:** A dejaría esos usos esperando a la comparación, que no mira páginas sin crear en el servidor.

### D603 · Dos síntomas vecinos van al roadmap
**Qué pasaba:** al probar D601 quedan dos cosas parecidas que no son esta causa.
**Las opciones:** A) arreglarlas acá; B) anotarlas como frente aparte.
**Elegí B:** (1) con usos de verdad por mandar, la pastilla dice «N changes not uploaded» mientras la cola de archivos los
manda, porque el ciclo ya terminó (`syncing` en falso) y solo las subidas de archivos ponen `uploading`; (2) una página con
algo propio sin subir no usa la lectura de B.14 y encola todas sus fotos (escribir una letra en una página de 52 fotos
durante la primera bajada vuelve a mostrar 53). Las dos tocan el texto de la pastilla o la cola: piden su propia revisión.
**Si preferís otra:** (1) es un cambio de texto en `SyncBadge`; (2) pide decidir cuándo una lectura de usos sigue valiendo.

### D604 · La prueba con la versión anterior usa una copia de la cola publicada
**Qué pasaba:** la fila de usos gana un campo (`unconfirmed`); una versión anterior puede abrir la misma base.
**Las opciones:** A) razonar que la ignora; B) copiar `src/media/queue.ts` de v0.247 a `src/media/fixtures/v247/` y probar
con ella sobre la misma base, como las copias de `src/sync/fixtures/`.
**Elegí B:** la prueba confirma que la versión anterior no cuenta ni manda las sin confirmar, que manda el `unlink` si la
persona quitó la foto, y que la versión nueva las confirma después sin mandar nada.
**Si preferís otra:** A ahorra 3000 líneas de copia, pero la regla del repo pide la prueba con lo publicado.

### D626 · La copia que cede vuelve sola de la papelera si alguien escribió en ella
**Qué pasaba:** cuando dos dispositivos crean el reporte del mismo día a la vez, el de id mayor manda su página vacía a la
papelera (D580). Un tercero que la abrió en sus primeros segundos y escribió podía quedar con su texto en la papelera: lo
escrito sube 1–3 s después de tipear y la decisión ya estaba tomada (re-verificación de E11).
**Las opciones:** A) una última sincronización antes de la papelera (achica la ventana pero no la cierra: el texto puede
llegar después de cualquier mirada); B) no ceder nunca (quedan dos reportes, uno vacío, siempre que hay carrera); C) ceder
con una marca en la fila (`settings.ceded`: a cuál cedió y la hora de la papelera) y que **cualquier dispositivo** que vea
algo escrito en una copia así (lo suyo, subido o no, o lo que bajó) la saque de la papelera y le quite la marca.
**Elegí C**, más la mirada antes de ceder (sin nada en el servidor después de la última sincronización ni en el
dispositivo): el texto no depende de cuándo llega. La copia que vuelve queda como día repetido en *Map › Pending* (D520) y
quien la devolvió lo ve en un aviso. Si quien cede ve que ya escribieron, no cede y le agrega solo las secciones (antes
`writeNewPage` no escribía en una página con algo y el aviso decía «se agregaron 2» sin agregarlas). La marca vale solo con
esa hora de papelera: si alguien la restaura y la vuelve a borrar a mano, no vuelve. Abrirla sin escribir no se ve (no hay
presencia): queda en la papelera y su cartel lleva a la que quedó (D628).
**Si preferís otra:** B es sacar `cedeCopy` de `createTomorrow`; A sola deja el caso de la re-verificación abierto.

### D627 · El aviso de «quedaron dos reportes» sale solo si quedaron
**Qué pasaba:** el que no cede decía «si quedan dos reportes, *Pending* los lista» aunque el otro cediera segundos después.
**Las opciones:** A) sacar el aviso (*Pending* igual los lista); B) mirar unos segundos si los otros cedieron y avisar solo
si siguen vivos.
**Elegí B** (`twinsLeft`: hasta 4 sincronizaciones separadas 2,5 s, en segundo plano): el aviso de crear sale sin esa
frase y, si de verdad quedaron dos, llega uno aparte con el título.
**Si preferís otra:** A es borrar la llamada a `twinsLeft` en `DayHeader.tsx`.

### D628 · El cartel de la copia en la papelera dice por qué y lleva a la que quedó
**Qué pasaba:** quien abría la copia que cedió veía solo «Esta página está en la papelera · Restaurar».
**Las opciones:** A) dejarlo; B) un cartel propio: que otro dispositivo creó el mismo día a la vez, que si escribe ahí
vuelve, y un botón a la página que quedó (si existe y no está en la papelera).
**Elegí B:** es el único rastro que ve alguien que la abrió sin escribir.
**Si preferís otra:** A es sacar la rama `ceded` del cartel en `PageView.tsx`.

### D629 · Crear y *Prepare* dicen qué están haciendo mientras esperan
**Qué pasaba:** crear el reporte de mañana tarda 3,7–7,3 s y *Prepare* sobre un reporte que está llegando hasta 12 s, con
el botón apagado como única señal.
**Las opciones:** A) achicar las esperas: la segunda lectura después de subir la fila hace falta, porque el árbol se baja
por partes ordenadas por id y una fila nueva de otro dispositivo puede caer en una parte ya bajada; B) decirlo.
**Elegí B:** mientras crea, la tarjeta dice «Creating «…»… first it checks that no other device created it» (también la
tarjeta de siempre, que aparece apenas sube la fila, hasta que termina, y sin *Prepare* mientras tanto); mientras
*Prepare* espera, «Waiting for «…» to arrive from the device that just created it…». *Prepare* deja de esperar apenas esa
página va a la papelera (la copia que cedió).
**Si preferís otra:** una consulta propia de la carpeta en vez de la segunda sincronización entera (un cambio en `remote`
y en el servidor de prueba).

### D630 · La copia que cedió se ve en la papelera, reconocible
**Qué pasaba:** queda en la papelera, vacía, igual que cualquier página (roadmap v0.248 (14)).
**Las opciones:** A) no mostrarla; B) mostrarla con «Empty copy: another device created the same day at the same time».
**Elegí B:** esconderla sería esconder una página que alguien pudo haber abierto; con el rótulo no confunde. Se borra con
la papelera como todo.
**Si preferís otra:** A es filtrar `cededMark` en `TrashView.tsx`.

### D631 · La locación en el título del reporte de mañana: barata, pero se usa poco
**Qué pasaba:** D574 no copia la locación de hoy al título de mañana; se pidió evaluar si sumarla es barato.
**Las opciones:** A) dejarlo; B) ponerla solo cuando **todas** las escenas del plan de mañana tienen en su ficha la misma
*Locación real* y el registro la reconoce (≈40 líneas y sus pruebas, sin tocar el lector).
**Elegí A por ahora, sin hacerlo:** medido en `mapa.json` de ERSO, de 73 días solo 12 tienen fichas con esa fecha; en 11 las
fichas dan un solo lugar y coincide con el del título, y en 1 dan varios. Es correcto cuando hay dato pero sirve poco; queda
en el roadmap.
**Si preferís otra:** B, en `nextDayTitle` con un argumento más.

### D632 · El vigía de las copias cedidas corre solo después de una sincronización
**Qué pasaba:** corría también al arrancar, con el árbol guardado en el dispositivo. Un dispositivo cerrado con «copia en la
papelera, marca válida y texto» que arrancaba después de que otro la había sacado y la persona la había vuelto a mandar a
la papelera **a propósito**, la sacaba de nuevo (O1 de la auditoría de E15, prueba AUD-2).
**Las opciones:** A) correr solo cuando cambia `lastSyncAt` (el árbol ya se bajó de nuevo); B) además, que la base
restaure solo si `deleted_at` sigue siendo la hora de la marca.
**Elegí A:** una línea, y alcanza: con el árbol al día la marca de esa copia ya no vale. Lo escrito sin red no se pierde:
quien lo escribió la saca después de su primera sincronización. B queda en el roadmap.
**Si preferís otra:** B pide una función en la base.

### D633 · Un solo aviso cuando la copia vuelve
**Qué pasaba:** el que ganó podía recibir «… volvió de la papelera» y, unos segundos después, «… quedaron los dos» (O3).
**Elegí:** no mandar el segundo si este mismo dispositivo ya la sacó de la papelera (`wasRevivedHere`). Si la sacó otro, el
de «quedaron los dos» sigue saliendo: acá no se avisó nada.

### D634 · Los textos de la copia no prometen de más
**Qué pasaba:** el cartel decía «Si escribís acá, vuelve» y la papelera «Copia vacía», pero un invitado no la trae de vuelta
(D637) y un miembro sin permiso depende de otro dispositivo; «Mapa › Pendientes lista los dos» no se cumple si después se
deshizo el que ganó (O5).
**Elegí:** cartel «Esta copia fue a la papelera… Escribí en la que quedó; lo que se escriba acá la trae de vuelta cuando
sincroniza un dispositivo que puede restaurar páginas»; rótulo «Copia que cedió…»; aviso «Mientras estén los dos, Mapa ›
Pendientes los lista». Ayuda con el mismo matiz.

### D635 · *Deshacer* cuando el reporte se creó pero alguien ya había escrito
**Qué pasaba:** en ese camino (D626) el resultado traía `created: true` sin firma: *Deshacer* contestaba «cambió» y no sacaba
las secciones agregadas (O6).
**Elegí:** marcarlo (`joined`) y deshacer como *Prepare* (`undoPrepared`): saca solo las secciones agregadas que siguen
vacías; la página y lo escrito quedan.

### D636 · El vigía compara antes de leer
**Qué pasaba:** leía el contenido guardado de cada copia cedida (candado, guardado, IndexedDB) en cada sincronización antes
de mirar si algo había cambiado (O7).
**Elegí:** comparar primero `update_seq` y el estado guardado (`stateOf`: cursor y versión); el contenido se lee solo si
cambió algo desde la última vez que se vio vacía.

### D637 · Un invitado que escribe en la copia cedida no la trae de vuelta (límite documentado)
**Qué pasaba:** una página en la papelera le da nivel 0 a un invitado (`user_page_level`): `push_page_update` rechaza lo que
escribe y ningún otro dispositivo lo ve (O2). Lo escrito queda en su dispositivo como rechazado, sin perderse, y sube si
alguien restaura la página.
**Las opciones:** A) documentarlo (hace falta un invitado con permiso de editar que abra la copia en los segundos de una
carrera); B) aceptar en la base lo escrito en una copia cedida, o que su dispositivo pida restaurarla.
**Elegí A** por ahora (Doc_Relaciones, sección 19; roadmap v0.251 (8)); el cartel ya no le promete que vuelve (D634).
**Si preferís otra:** B toca permisos en la base: pide su propia auditoría de Row Level Security.

### D611 · Con algo propio sin subir, la lectura de usos vale para todo lo que no trae lo propio
**Qué pasaba:** un dispositivo nuevo que escribía una letra en una página de 52 fotos durante la primera bajada (lo típico
en el set: el ciclo sube antes de bajar, así que la letra llega sin subir a la comparación) mostraba 53 cambios y mandaba
52 `link_page_file` que no cambiaban nada: con algo propio sin subir, la comparación descartaba entera la lectura de usos
del servidor (B.14).
**Las opciones:** A) creerle solo para las filas sin confirmar (no cubre una copia sin el editor de una foto que otro
dispositivo quita al mismo tiempo, A2 de `trash.test.ts`, con la página abierta); B) esperar a que lo propio suba (un
ciclo más, y una página rechazada nunca); C) creerle salvo para las fotos que trae lo propio: la diferencia contra
`syncedSV`, la misma que arma la subida (`ownMediaIds` en `usage.ts`).
**Elegí C** porque es exactamente donde la lectura puede ser vieja. Una foto que este dispositivo tiene por lo ya
confirmado está en el servidor con su `seq`: un `unlink` de otro dispositivo que no la vio lo rechaza `p_seen_seq`, y si la
vio, su documento la tiene y no la quita. Lo único que el otro no puede ver es lo no subido, y en Yjs nada vuelve sin un
ítem nuevo (pegar, mover, deshacer reescriben el `url`). Sin `syncedSV`, sin lectura, o si el cálculo falla, se manda todo
como antes, página por página, sin cortar la comparación de las siguientes.
**Si preferís otra:** B es más simple pero deja los 52 contados un ciclo más.

### D612 · La pastilla dice «Uploading» también mientras la cola de archivos manda
**Qué pasaba:** con usos de verdad por mandar, decía «N changes not uploaded» mientras salían: la cola corre después del
ciclo y solo las subidas de archivos ponían `uploading`.
**Las opciones:** A) dejar `syncing` prendido hasta que termine la cola (mezcla los dos ciclos); B) un estado propio,
`mediaSending`, verdadero mientras hay una vuelta de la cola en curso.
**Elegí B,** sin texto nuevo. Se lee de la cola al publicar el conteo, no al empezarlo: un conteo lento que termina después
del último no deja un «Uploading» viejo. Sin red, con la app vieja o con un error de la cola (Drive sin conectar) ganan sus
avisos, como antes.
**Si preferís otra:** prenderlo recién al primer pedido evitaría un parpadeo de milisegundos en vueltas sin nada que mandar.

### D613 · La guarda `hasUnsentCreate` de `linkOnOpen` tiene su prueba
**Qué pasaba:** sacándola, ninguna prueba fallaba (la cubría de rebote `hasOwnUnsent`).
**Elegí** una prueba con dependencias de mentira (página sin crear en el servidor y sin nada propio → todo por mandar) y,
en el arnés, que el uso por mandar de la página nueva frena el `unlink` de la original hasta que se crea.

### D614 · Un solo recorrido de las filas sin confirmar con más de 32 páginas por mirar
**Qué pasaba:** la comparación leía las filas de cada página por separado: 0,14 ms cada una, 121–140 ms con 973 páginas
(medido en la auditoría de la v0.249) y unos segundos estimados en un teléfono cuando cambian todas las marcas a la vez.
**Elegí** `MediaQueue.pagesWithUnconfirmed`: hasta 32 páginas como antes; con más, un `getAll` de todas (14 ms). Solo lee.

### D615 · Una página con un archivo propio en espera no queda mirada
**Qué pasaba:** un archivo guardado acá que el documento nunca mostró (la página se cerró antes de ponerlo) se quita pasados
5 minutos, pero la comparación hecha dentro de esa espera daba la página por mirada y, si el documento no volvía a cambiar,
el uso que creó `register_file` quedaba activo para siempre y el archivo nunca llegaba a la papelera.
**Elegí** que `reconcilePage` avise (`onGraceWait`, con el mismo predicado que la espera) y el motor no marque la página:
se vuelve a mirar cada ciclo hasta que pase la espera. Si el archivo terminó en otra página, su `unlink` espera (`held`) a
que se confirme ese otro uso.

### D616 · La prueba con la versión anterior reutiliza la cola v0.247
**Qué pasaba:** D611 y D617 no cambian el formato de nada guardado; D617 crea filas sin confirmar en un caso nuevo.
**Elegí** probar con `src/media/fixtures/v247/queue.ts` (la que peor lee esas filas: las ve confirmadas) y no copiar otra
cola: una v0.249 solo manda de más (inofensivo). Subir `min_app_version` a la versión que publique esto cierra lo demás.

### D617 · Abrir una página con algo propio sin subir: sin confirmar lo que vino del servidor
**Qué pasaba:** `linkOnOpen` ponía por mandar todas las fotos si la página ya tenía algo propio (escrito sin el editor,
como *Assign*, o en otra pestaña): la segunda vía del síntoma de D611.
**Elegí** la misma regla: sin confirmar las fotos de lo guardado que no trae lo propio; por mandar las que sí, y las que el
editor muestra y todavía no están guardadas. Página sin crear en el servidor, error al guardar, sin `syncedSV` o cualquier
falla al leer: todo por mandar, nunca una foto sin fila.

### D618 · Borrar una foto sin el editor en una página nunca comparada queda en el roadmap
**Qué pasaba:** la auditoría de la propuesta encontró que, si durante la primera bajada algo que no es el editor (*Assign*,
repartir por escenas) quita una foto de una página que este dispositivo nunca abrió ni comparó, no queda fila y el archivo
nunca se desvincula (queda «en uso»; dirección segura, sin pérdida). Pasa igual antes y después de D611.
**Elegí** anotarlo en el roadmap (punto 28) y no arreglarlo acá.

### D691 · Lo propio que vuelve a poner una foto que la página ya tenía se confirma con el servidor después de subir
**Qué pasaba:** en una página ya comparada, un dispositivo sin red recuperaba una foto (deshacer un borrado, mover el
bloque, pegar una copia de la misma página) mientras otro la quitaba con red y mandaba el `unlink`. Al volver, subía la
página con la foto pero no mandaba el `link`: su fila seguía confirmada y la comparación solo le pregunta al servidor por
páginas nuevas o con filas sin confirmar. El archivo quedaba en la papelera de archivos con la foto en el documento hasta
que el otro volviera (roadmap 29).
**Las opciones:** A) anotar en memoria las fotos de lo subido y preguntar en la comparación de ese ciclo (se pierde si la
app se cierra entre subir y comparar); B) lo mismo, pero pasando las filas confirmadas a sin confirmar en la base del
dispositivo antes de subir; C) que la purga lea los documentos (Yjs en el portero, historiales enteros, y no cubre lo no
subido); D) leer los usos de toda página que cambió en cada ciclo (una lectura más por ciclo en cada dispositivo y más
carreras); E) marcar al editar (no ve lo escrito sin el editor ni lo que hace el deshacer).
**Elegí B:** `PageDocs.beforePush` justo antes de cada `pushUpdate` (también al reintentar un envío armado antes) saca los
`sdmedia://` del envío (`mediaIdsInUpdate`) y `MediaQueue.recheckUses` pasa a sin confirmar solo las filas confirmadas de
esas fotos en esa página. Lo demás ya existía (D601): la comparación del mismo ciclo, con el envío ya en el servidor, lee
los usos y manda el `link` de lo que el servidor quitó. Una página de 52 fotos movidas sin red cuesta una lectura y ningún
`link`. Si anotar falla, la subida sigue igual. Sin migración, sin tocar el portero y sin subir `min_app_version`: no
cambia nada guardado (`unconfirmed` existe desde la v0.249).
**Si preferís otra:** D cura desde cualquier dispositivo, no solo desde el que recuperó la foto, a cambio de una lectura por
ciclo en todos.

### D692 · Purgar mientras el que recuperó la foto sigue sin red queda para Lega
**Qué pasaba:** D691 actúa cuando el dispositivo vuelve. Mientras sigue sin red nadie más sabe que la foto volvió, y un
dueño o admin puede vaciar la papelera de archivos en cualquier momento (no hay plazo mínimo; la purga automática a los 30
días está apagada): el `link` que llega después no deshace `purged_at`. El original queda 30 días en la papelera de Drive.
**Elegí** dejarlo como punto propio del roadmap (sección C, punto 14) con una mitigación posible (no incluir en *Empty* lo
que entró hace poco), porque es una decisión de producto.

### D693 · Los dos restos de la auditoría de la v0.252
**Elegí** sumar la prueba de `linkOnOpen` cuando guardar empieza a fallar mientras se lee lo guardado (la mutación que
sobrevivía) y que el bucle de la prueba de filas sin confirmar en lote avance con `Math.max(1, UNCONFIRMED_SCAN_FROM)`, así
con el umbral en 0 falla en vez de colgarse.

### D694 · La versión mínima sube a 0.255 igual
**Qué pasaba:** D691 no necesita subir `min_app_version` para funcionar (no cambia nada guardado), pero el riesgo está
justamente en el dispositivo viejo que vuelve sin red con una foto recuperada: una 0.254 sube su envío sin marcar la fila
y el archivo queda en la papelera.
**Elegí** subir `workspace_settings.min_app_version` a 0.255 después de publicarla (2026-10-09, por SQL): el dispositivo
viejo se actualiza antes de subir, y lo que tenía guardado sin subir sale con el arreglo (el gancho corre también al
reintentar un envío armado antes). **Si preferís otra:** bajarla a 0.252 por SQL.

### D721 · Reordenar bloques del mismo grupo sin reutilizar el contenedor vecino
**Qué pasaba:** y-prosemirror reescribía los contenedores al reordenar: si un dispositivo movía sin red y otro borraba
el movido, podía desaparecer el vecino, que nadie tocó. Pasaba con fotos y texto, tanto con el teclado como arrastrando.
**Las opciones:** cubrir solo los gestos del teclado y arrastre, modificar el parche de la librería, migrar a Yjs 14,
o guardar todo reordenamiento del mismo grupo en dos pasadas desde la app.
**Elegí las dos pasadas:** antes de la traducción habitual se borra el lado de menor peso (incluye los hijos), y luego
se inserta en el orden final. Los borrados e inserciones se hacen directamente en Yjs por identidad: traducir un
documento intermedio tampoco conserva los contenedores cuando hay varios tramos separados. El serializador oficial
arma los nodos nuevos, clonados antes de insertarlos. En un grupo con inversión se reconcilian además sus bloques
nuevos y borrados intencionales, para que la traducción final reciba el orden completo; los grupos sin inversión
siguen por el camino habitual. Todo queda en una transacción de Yjs. Reemplaza el límite de la decisión 20 de
`Doc_Colapsar.md`: la pérdida silenciosa del vecino también ocurría al mover un bloque suelto.
**El costo:** lo que otro escribe a la vez en el bloque que se recrea se pierde; si esa persona sigue con la página
abierta en esa sesión, ve el aviso de B.16 con el texto para copiar. La ampliación del aviso tras reabrir se describe
en `Doc_Colaboracion.md`. Un borrado concurrente del lado recreado puede volver con la copia.

### D722 · Empate al elegir qué lado se conserva
**Elegí** conservar, entre subsecuencias de igual peso, la que tenga más bloques cuyo nodo del editor cambió: es la
huella del teclado de BlockNote y conserva lo movido. Si el arrastre conserva todos los nodos, se elige el menor
índice del último nodo conservado en el orden anterior; los óptimos intermedios usan la misma regla. El desempate es
fijo, sin depender de cuál dispositivo sincroniza primero.

### D723 · La guarda solo reconoce cambios de orden
**Elegí** no recrear bloques que desaparecen o cambian de id: con la corrección de ids repetidos, ampliar la guarda
a esos casos impedía converger a dos editores. Los borrados por id de Prepare y Merge (D436/D437) siguen vigentes.
Con ids repetidos o ausentes en un grupo se conserva la traducción habitual hasta que una edición deja ids únicos.

### D724 · Versión mínima 0.256 por comportamiento
**Elegí** subir `workspace_settings.min_app_version` a 0.256 al publicar. No hay esquema, tipo de bloque ni propiedad
nueva: una versión anterior lee los borrados e inserciones. El mínimo evita que una versión vieja siga generando la
reescritura al mover; no corrige movimientos que ya estaban guardados sin subir. Se hace durante el desarrollo
(LEY 1); en producción, un cambio de comportamiento por sí solo no justificaría expulsar versiones anteriores.

### D725 · Entrar en los hijos de un bloque borrado a la vez
**Qué pasa:** si un bloque entra en los hijos de otro que el otro dispositivo borra a la vez, se borra con su padre.
Es la misma regla de Yjs que al sangrar con Tab. No se extiende la guarda a cambios de grupo; el aviso de B.16 conserva
lo que este dispositivo escribió o movió cuando se puede reconocer como propio.

### D726 · Guarda en la app, sin otro parche a la librería
**Elegí** `src/ui/blockReorder.ts` y una extensión del editor. La instalación envuelve la traducción ya usada por
`blockMove.ts`, se suelta al destruir el editor y no cambia `node_modules` ni el formato guardado.

### D727 · El aviso después de reabrir queda pendiente por costo
**Qué pasa:** B.16 solo examina lo propio sin subir o escrito en esa sesión. Si A ya subió sus letras y cerró la app
antes de recibir el movimiento de B, no ve el aviso aunque esas letras queden dentro del contenedor borrado.
**Probado:** reconocer un `blockContainer` borrado cuyo id sigue vivo y usar los autores propios persistidos permite
avisar al rearmar el motor con el mismo IndexedDB, sin avisar por un borrado común. Pero el costo del prototipo en la
página más grande de ERSO por bytes fue 105,15 ms de media (20 revisiones tras dos de calentamiento, 2.072.235 bytes).
**Elegí** no activar esa ampliación: supera el límite de 50 ms fijado en C3 por la propuesta auditada. Queda como
residuo aceptado de esta entrega, con su punto del roadmap. El aviso durante la sesión y el guardado sin GC siguen.

### D736 · Respuesta inmediata del botón de actualización (2026-10-09)
**Qué pasaba:** Lega tocó *Update now* en la app instalada con Brave y parecía no hacer nada hasta que recargó más tarde.
**Elegí:** círculo de actividad y *Updating the app… Please wait* desde el clic; aviso fuera del detalle, botones de
actualizar y forzar deshabilitados durante el intento y una sola ejecución de cada acción repetida. El estado espera
también el guardado local antes de recargar y termina al cancelar o fallar. Se conserva la cantidad pendiente. No hay
porcentaje ficticio ni cambios en los datos, la instalación o la mínima requerida: sigue 0.256.

## Decididas en la implementación, a confirmar por Lega (2026-09-30)

Decisiones de diseño que el plan no fijaba, tomadas al implementar los pasos 5 a 13 de
`Plan_Workspaces.md` con la opción más simple que no cierra caminos. Siguen así hasta que Lega diga otra
cosa.

- **Crear proyectos:** con las políticas del equipo, solo el dueño y los admins. Las cuentas `member` que
  ya tenían proyectos conservan todo lo suyo pero no crean proyectos nuevos (se las puede pasar a admin).
- **Sacar a alguien:** su dispositivo no borra nada solo; ofrece bajar lo que no subió (un archivo con los
  cambios y cada original pendiente) y borra recién cuando la persona toca *Remove from this device*. Sus
  proyectos compartidos pasan a un dueño o admin con permiso sobre el proyecto entero; si no hay, quedan
  como están.
- **Invitaciones:** una sola viva por correo; invitar de nuevo suma permisos y conserva quién invitó;
  se pueden revocar. Un correo nuevo en *Share* entra como invitado (*Guest*) por defecto.
- **Sesiones con contraseña:** la base no les da acceso a nada (la app entra solo con código o link),
  para que abrir el registro a invitados no permita quedarse con la cuenta de otro.
- **Archivos:** con portero, también las fotos van a Drive. La carpeta del día es el día en que se agregó
  el archivo en el dispositivo. El original queda también en el dispositivo después de subir.
- **Papelera de archivos:** la ve quien tiene "editar y crear páginas" sobre el proyecto; mandar a la
  papelera de Drive, solo el dueño y los admins; una vez pedido no vuelve atrás desde la app (se recupera
  desde la papelera de Drive). Un archivo pegado en otro proyecto se ve como "Photo from another project"
  y nunca entra a la papelera mientras se use.
- **Comentarios:** atajo Ctrl/⌘+Alt+M; preguntas Ctrl/⌘+Alt+P; borrar un comentario lo marca (el texto
  queda en la base). Los invitados ven los correos de quienes comentan (D-18).
- **Varios workspaces:** cambiar de workspace recarga la app; el de la compilación (Wanka) no se puede
  quitar del dispositivo; un link cuya clave local ya usa otro workspace con otra dirección se rechaza.
- **Restaurar sobre el mismo proyecto:** nunca devuelve accesos quitados; las cuentas borradas después de
  la copia vuelven bloqueadas hasta que el dueño decida.

## Abiertas

- **D330 · Migrar el editor a `@blocknote/core/y` (Yjs 14, y-prosemirror 2)** (pendiente; planteada el 2026-10-07 con
  la evaluación de v0.225, `Doc_Evaluacion_BlockNote_Y.md`). Opción indicada: **esperar** y volver a medir cuando se
  cumplan tres condiciones (Yjs 14 e y-prosemirror 2 publicadas como estables; BlockNote la documenta, la usa sin
  parche propio y trae deshacer; Yjs 14 pasa los casos mínimos del deshacer o el parche del repo está rehecho). Lo
  medido hoy: no arregla lo que se esperaba, empeora el deshacer y el tiempo por tecla, y obliga a convertir todas las
  páginas guardadas sin vuelta atrás simple. Las otras opciones: empezar ahora por lo que no toca lo guardado (las
  pruebas con los dos bindings, el parche del deshacer sobre Yjs 14 y una capa propia sobre Yjs), o descartar B.10.
- **D331 · Mandar a Yjs los casos mínimos del deshacer (B.21, B.22 y B.26)** (pendiente; 2026-10-07). Es un reporte
  público con la cuenta de Lega en el repositorio de Yjs. Opción indicada: sí: Yjs 14 tiene los mismos tres errores
  (`Doc_Evaluacion_BlockNote_Y.md`, 3.3) y, si los arreglan ahí, el parche del repo deja de hacer falta el día que se
  migre. La otra opción: no reportar y seguir con el parche propio.
- **D-06 · Dónde se guarda la clave del asistente.** Opción indicada: solo en el dispositivo, sin pasar
  por el servidor; la app llama directo al proveedor. Es lo más privado, pero hay que cargarla en cada
  dispositivo. La alternativa es guardarla cifrada en Supabase (Vault) y llamar al proveedor desde una
  función del servidor: se carga una vez y funciona en todos lados.
  **Propuesta (2026-10-02, `Doc_Asistente.md`, IA1):** solo en el dispositivo, nunca en un servidor; se guarda cifrada,
  pero el cifrado solo evita verla en claro por accidente (quien usa ese navegador o un script de la app la puede usar),
  así que se recomienda un tope de gasto en el proveedor; el pedido va directo al proveedor (IA3).
  **Lega (2026-10-02, D72 → B):** además, una copia sincronizada entre sus dispositivos, cifrada con una frase que solo
  sabe la persona; diseño en `Doc_Clave_Sincronizada.md` (CS1 a CS9, propuestas).
- **D-07 · MCP.** Opción indicada: un servidor MCP en el portero de Cloudflare del workspace, que entra
  con la sesión del usuario y edita con sus permisos. Se hace en la fase 5, después del asistente de la
  app.
  **Propuesta (2026-10-02, `Doc_Asistente.md`, IA2):** en el portero, con el OAuth del Supabase del workspace, el token
  cerrado de fábrica y la base limpia de D14; con páginas reales pide, casi seguro, el plan pago de Workers del dueño
  (US$ 5 por mes); antes, la prueba técnica M0; si no, un MCP local.
  **Lega (2026-10-02, D77):** además de leer y escribir, mover y mandar a la papelera con confirmación explícita de la
  persona; compartir e invitar, nunca (`Doc_Asistente.md` 9.3 bis, IA11).
- **D-08 · Formato por defecto de un proyecto nuevo.** Opción indicada: libre. El formato no se guarda
  en el proyecto: se fija por proyecto en sus páginas raíz y lo heredan las de abajo
  (`pages.settings.format`, `Plan_ShotDocs.md`, sección 10).
