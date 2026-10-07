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
