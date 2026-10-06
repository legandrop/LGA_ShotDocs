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
