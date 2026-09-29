# Decisiones

Lo que solo Lega decide. Las abiertas siguen con la opción indicada en `Plan_ShotDocs.md` hasta que Lega
diga otra cosa.

## Tomadas

- **D-01 · Nombre: LGA Shot Docs** (2026-09-29). Repo `legandrop/LGA_ShotDocs`; se llamaba
  `LGA_VFX_Docs` y se renombró antes del primer commit.
- **D-02 · Backend: Supabase, frontend en Vercel** (2026-09-29; el frontend pasa a Cloudflare por D-05). Lega ya tiene cuentas de Aiven y de
  Neon, pero las dos son solo base de datos: con cualquiera de ellas habría que sumar un servicio de
  login, uno de archivos (los reportes de rodaje llevan muchas fotos) y uno de tiempo real. Supabase trae
  todo junto, aplica los permisos dentro de la base y le pide una sola cuenta a quien la autohostee. El frontend pasó a Cloudflare (D-05).
- **D-03 · Editor visual por bloques** (2026-09-29). Nadie ve Markdown: se usa solo para importar,
  exportar y hacer backups.
- **D-04 · Tiempo real al final** (2026-09-29). El modelo de datos lo contempla desde el principio, pero
  se implementa en la última fase.

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
  páginas propio. Son las filas de `workspaces` (cada usuario tiene los que quiera; el primero arranca como
  "My project" y se renombra; el de Lega es "MGTZD"). Se cambia de proyecto sin salir de la página, con un selector
  arriba de la barra lateral (la opción A de las que se diseñaron): un clic o Ctrl+K, buscar, flechas y Enter;
  en el teléfono sube como hoja desde abajo. Crear y renombrar proyectos entra en la misma cola que las
  páginas, así que funciona sin red y un proyecto nuevo sube antes que sus páginas. Cada proyecto recuerda
  su última página abierta. Una página no se mueve entre proyectos. Con equipo (D-18) cambia quién los
  crea: solo el dueño y los admins del workspace, y un usuario nuevo ya no recibe "My project".
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
  (el texto queda, se pierde solo el estilo). Un tipo de bloque desconocido se borraría del documento compartido al abrir la página en
  esa versión (lo encontró la auditoría) y el borrado llegaría a todos los dispositivos.
- **D-15 · Tooltips propios** (2026-09-29). Mismo estilo que las apps LGA en Qt (fondo `#242424`, borde
  `#3a3a3a`, flecha de 16×11 que apunta al control y se da vuelta si no entra, rótulos en negrita
  `#E8E8E8`, 600 ms de espera) y la misma regla: un tooltip nunca repite lo que el control ya dice; va solo
  cuando suma algo (un atajo, una segunda interacción, un título cortado). Nada de tooltips del navegador.
- **D-16 · App en castellano e inglés** (2026-09-29). La interfaz va a estar en los dos idiomas, y también
  las plantillas y los tipos de texto (Script/Guion, Questions/Dudas…). Se implementa más adelante
  (roadmap); por ahora la interfaz sigue en inglés.

## Abiertas

- **D-05 · Hosting para trabajos pagos.** El plan Hobby de Vercel es solo para uso no comercial. Para
  usar la app en shows pagos hace falta Vercel Pro u otro hosting. Mientras tanto, se desarrolla en Hobby.
  **Decidido por Lega (2026-09-29): Cloudflare** (Workers con archivos estáticos), gratis y con uso
  comercial, con la misma dirección propia (`Plan_Workspaces.md`, sección 9).
- **D-06 · Dónde se guarda la clave del asistente.** Opción indicada: solo en el dispositivo, sin pasar
  por el servidor; la app llama directo al proveedor. Es lo más privado, pero hay que cargarla en cada
  dispositivo. La alternativa es guardarla cifrada en Supabase (Vault) y llamar al proveedor desde una
  función del servidor: se carga una vez y funciona en todos lados.
- **D-07 · MCP.** Opción indicada: un servidor MCP en el portero de Cloudflare del workspace, que entra con la sesión del
  usuario y edita con sus permisos. Se hace en la fase 5, después del asistente de la app.
- **D-08 · Formato por defecto de un espacio nuevo.** Opción indicada: libre.
- **D-17 · Dónde van los archivos grandes.** El plan gratis de Supabase trae 1 GB de archivos: unas 300
  fotos de teléfono o un video de rodaje. Decidido por Lega (2026-09-29), con el detalle en
  `Plan_Workspaces.md`, sección 5:
  - Los originales van al **Drive del dueño del workspace**, también lo que suben miembros e invitados.
  - Una carpeta por proyecto y adentro por día de calendario. Renombrar el proyecto renombra su carpeta;
    las páginas apuntan al id del archivo, así que nada se rompe.
  - **Los videos se reproducen adentro de la app** (teléfono, web y app instalada), y hay un **carrete**
    de fotos y videos de la página. Lo que el navegador no pueda reproducir muestra la miniatura y se baja.
  - Pegar un link de Drive ofrece mostrarlo como link, texto o tarjeta reproducible, como en Coda.
  - Papelera de archivos por proyecto, con miniaturas y peso. El dueño y los admins pueden vaciarla.
  - Un portero de archivos por workspace (en Cloudflare) chequea permisos y pasa los archivos de Drive;
    nadie más recibe la conexión con el Drive del dueño.
  - Carpeta por el día en que se subió. Cada archivo de la papelera se borra solo a los 30 días de haber
    entrado.
- **D-18 · Cada workspace es una isla** (2026-09-29). Detalle en `Plan_Workspaces.md`. Decidido por Lega:
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
  - Sacar a alguien borra lo de ese workspace en su dispositivo la próxima vez que se conecta; lo que
    tuviera sin subir, mejor que no se pierda. Sus proyectos compartidos pasan a otro admin; los privados
    se van con él. Nadie ve los proyectos privados de otro, tampoco el dueño.
  - Los clientes pueden recibir un proyecto entero o páginas, y ven los nombres del equipo. Ver incluye
    bajar. La invitación, al principio, es un link que se copia.
  - Queda por diseñar al implementarlo: cómo no perder lo que tuviera sin subir alguien a quien se saca.
