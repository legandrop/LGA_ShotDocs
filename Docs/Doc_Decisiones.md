# Decisiones

Lo que solo Lega decide. Las abiertas siguen con la opción indicada en `Plan_ShotDocs.md` hasta que Lega
diga otra cosa.

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
    decide por él. **Ningún nombre de carpeta lleva espacios:** guiones bajos, y la de la app se llama
    `LGA_ShotDocs`, igual que el repo (pedido de Lega, 2026-09-30).
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

- **D-06 · Dónde se guarda la clave del asistente.** Opción indicada: solo en el dispositivo, sin pasar
  por el servidor; la app llama directo al proveedor. Es lo más privado, pero hay que cargarla en cada
  dispositivo. La alternativa es guardarla cifrada en Supabase (Vault) y llamar al proveedor desde una
  función del servidor: se carga una vez y funciona en todos lados.
- **D-07 · MCP.** Opción indicada: un servidor MCP en el portero de Cloudflare del workspace, que entra
  con la sesión del usuario y edita con sus permisos. Se hace en la fase 5, después del asistente de la
  app.
- **D-08 · Formato por defecto de un proyecto nuevo.** Opción indicada: libre. El formato no se guarda
  en el proyecto: se fija por proyecto en sus páginas raíz y lo heredan las de abajo
  (`pages.settings.format`, `Plan_ShotDocs.md`, sección 10).
