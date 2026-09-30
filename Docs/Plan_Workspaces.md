# Plan: workspaces, equipo, invitados y archivos

Todo lo que se va decidiendo sobre cómo se organiza la app para trabajar en equipo. Es la base de las
fases que siguen: se lee antes de tocar login, permisos, archivos o compartir. Lo que se implementa pasa
a los documentos de referencia y sale de acá. Decisiones: D-17 (archivos) y D-18 (workspaces). Lo que
queda por diseñar se dice en cada sección.

## 1. Qué es un workspace

- Un **workspace** es de un dueño, tiene un nombre (el de Lega: **Wanka**, su estudio) y varios
  proyectos adentro.
- Usa las cuentas de su dueño: **su Supabase** (login, textos, permisos), **su Drive** (fotos, videos,
  PDFs), **su Resend** (el correo con el código de entrada) y **su portero de archivos** (sección 6).
- **Cada workspace es una isla:** nada de uno pasa por los servidores de otro ni por los de Lega.
- La misma persona puede estar en varios workspaces (el de su estudio, el de un cliente) y tener el suyo.
  La cuenta es aparte en cada uno: se entra con el correo en cada workspace.
- **La app es una sola** (la dirección pública de Lega) y se conecta a cualquier workspace: nadie
  necesita publicar su propia copia. Quien quiera, puede. Los datos van directo del navegador al
  workspace; quien publica la app sirve el código, así que hay que confiar en esa publicación.
- El workspace de hoy (el Supabase de Lega, con el proyecto MGTZD) pasa a ser **Wanka**, sin migrar nada.
- **El dueño no ve en la app los proyectos privados de otros** (decisión de Lega: el proyecto personal de
  un empleado es suyo). Técnicamente siguen en su Supabase, su Drive y sus copias, y hay que decirlo en la
  guía.
- Nombres en la base: la tabla `workspaces` hoy guarda **proyectos** (historia de v0.013). Las tablas
  nuevas no usan "workspace" para no mezclar: `workspace_settings` (nombre del workspace, versión de la
  base, generación, dirección del portero), `members` (persona y rol), `grants` (permiso sobre un
  proyecto o una página), `invitations`.

## 2. Primera vez que se abre la app

Pantalla de bienvenida con dos caminos:

1. **Unirme a un workspace.** Se entra con el link de invitación (o se lo pega). El link lleva, después
   del `#` (esa parte no llega a ningún servidor), la dirección y la clave publicable del workspace y la
   página a la que va. La app pide el correo, manda el código y entra directo a lo compartido. Solo entra
   quien fue invitado: un control en la base (el hook "Before User Created" de Supabase) rechaza los
   correos que no están en `invitations`.
2. **Crear mi workspace.** Una guía paso a paso, con capturas, en inglés (con castellano cuando la app
   sea bilingüe, D-16). Hace falta un dominio propio para el correo; sin eso no se puede crear un
   workspace (decisión de Lega). Los pasos, sacados de lo que se hizo para Wanka:
   1. **Supabase** (gratis): crear el proyecto y correr **un comando** que aplica todo lo de la app con un
      token personal: tablas, permisos, el control de invitaciones, login por código de 8 dígitos,
      plantilla del correo solo con el código, el SMTP de Resend, límites de envío, Site URL y el correo
      del dueño precargado (si no, el primero que entra podría quedar como dueño). Anotar la dirección y
      la clave publicable.
   2. **Resend**: cuenta y dominio verificado (gratis: 1 dominio, 3.000 correos al mes y 100 por día).
   3. **Google Cloud**: activar la Drive API, pantalla de consentimiento externa **en "In production"**
      (en "Testing" la conexión con Drive vence a los 7 días) y un cliente web con la dirección de vuelta
      en el portero.
   4. **Cloudflare** (gratis): publicar el portero con sus secretos (dirección del Supabase, la clave de
      los pases, el cliente de Google), un espacio KV para la conexión con Drive, la dirección de la app
      permitida.
   5. **GitHub**: un repo privado con la tarea de copias de seguridad (sección 7) y sus dos secretos.
   6. Pegar en la app la dirección y la clave del Supabase, entrar como dueño y conectar el Drive.
   7. Probar: entrar con código, subir un archivo, hacer y restaurar una copia.
   - **No hace falta Vercel ni publicar la app.**
   - Un botón "Conectar Supabase" que haga el paso 1 solo exigiría un servidor central de Lega (la
     conexión de Supabase pide una clave secreta de la app): queda descartado. El comando alcanza.

Después de la primera vez, el selector de arriba muestra **Workspace › Proyecto**, y "Unirme" o
"Crear" quedan en ese menú.

## 3. Personas y roles

**Roles en el workspace:**

| Rol | Qué puede |
|---|---|
| Dueño | Todo lo del workspace salvo los proyectos privados de otros. Paga las cuentas. Conecta Drive. |
| Admin | Crear proyectos, invitar y sacar gente, dar permisos, vaciar papeleras. No ve ni toca los proyectos privados de otros. |
| Miembro | Solo lo que se le comparta, con el permiso que se le dé. No crea proyectos. |
| Invitado | Alguien de afuera (un cliente): solo las páginas que se le compartan. |

**Permiso sobre un proyecto o una página** (vale para lo que tiene debajo, nunca para lo de arriba):

| Permiso | Qué puede |
|---|---|
| Ver | Leer y bajar archivos. |
| Comentar | Ver + dejar comentarios y responder preguntas. |
| Editar | Comentar + escribir y subir o borrar archivos. |
| Editar y crear páginas | Editar + crear, mover y borrar páginas adentro. |

- Si una persona tiene varios permisos sobre la misma página (uno por el proyecto, otro por la página),
  gana el más alto.
- Mover una página de una rama a otra pide permiso en las dos.
- **Proyectos privados:** un proyecto nuevo es privado; solo lo ven su creador y quien reciba permiso. Así Lega tiene sus proyectos personales dentro de Wanka sin que el equipo los vea. Protege del
  equipo, no de quien tenga las cuentas de Wanka: si algún día Wanka cambia de manos, lo personal se va
  con Wanka. Un workspace personal aparte es más limpio, pero gasta el segundo y último proyecto gratis
  de Supabase de Lega y se pausa si no se usa. Recomendación: privados dentro de Wanka por ahora.
- Hoy cada usuario nuevo recibe un proyecto "My project" (`ensure_workspace()`) y puede crear los suyos
  (D-12): con miembros e invitados eso se saca, porque solo el dueño y los admins crean proyectos.

## 4. Compartir con un cliente (invitado)

Caso típico: Lega arma un brief o un desglose, y se lo manda al cliente con preguntas.

- Lega elige una o varias páginas (cada una con sus subpáginas y nunca lo de arriba), escribe el correo
  del cliente y el permiso (por ejemplo, Comentar, o Editar para que suba archivos). Puede sumarle más
  páginas después.
- El cliente recibe el link y lo abre **en el navegador, sin instalar nada**. Entra con el código que le
  llega y cae directo en la página. No ve nada más del workspace. En el navegador sin instalar, sus
  comentarios y subidas necesitan red (Safari puede borrar lo guardado tras 7 días sin uso).
- La invitación, al principio: la app copia el link y Lega lo manda por donde quiera. El correo
  automático (lo mandaría el portero, que tiene la clave de Resend) queda para después.
- Puede comentar, responder preguntas y subir archivos (según el permiso). Los archivos van al Drive de
  Lega, como todo lo del workspace.
- **Comentarios:** en una tabla propia de la base (página, bloque, hilo, texto, autor, resuelto), con
  sus permisos, anclados al id del bloque. **No** se usan los comentarios que trae el editor: guardan una
  marca nueva dentro del texto, y una versión de la app que no la conoce borra el párrafo entero de todos
  los dispositivos (misma regla que los bloques nuevos, D-14). Además obligarían a que quien comenta
  pueda escribir el documento.
- **Preguntas:** un párrafo marcado como pregunta (como Script), y la respuesta es un hilo de
  comentarios debajo. Así el cliente contesta con el permiso Comentar.
- El cliente puede recibir un proyecto entero o solo páginas, y ve los nombres y correos del equipo en
  los comentarios (decisión de Lega).
- Ver incluye bajar los originales: no hay un permiso "ver sin bajar" (decisión de Lega).
- Un link público (sin login) es otra cosa y queda para después; para material sensible, siempre con
  login.

## 5. Archivos (D-17)

- Los originales van al **Drive del dueño del workspace**, también lo que suben miembros e invitados.
- **Dónde:** al conectar Drive, el dueño elige dónde va la carpeta de la app: la raíz de su Drive (*My
  Drive*) u otra carpeta suya, con el selector de carpetas de Google. La app no decide por él. Debería
  alcanzar con el permiso chico que ya usamos (`drive.file`): elegir una carpeta en ese selector le da a
  la app acceso a esa carpeta, para crear adentro (falta confirmarlo al hacerlo). Hace falta activar
  *Google Picker API* y crear una clave de API en el proyecto de Google Cloud, y el selector usa además
  el número del proyecto (paso 8). Hasta entonces, la carpeta de prueba va a la raíz.
- **Nombres sin espacios, nunca:** guiones bajos en todas las carpetas. La de la app se llama
  `LGA_ShotDocs`, igual que el repo; la del proyecto, su nombre con guiones bajos en vez de espacios; la
  del día, `AAAA-MM-DD`.
- Carpetas: `<donde eligió el dueño> / LGA_ShotDocs / <Proyecto> / <día> / IMG_1234.HEIC`, con el día en
  que se subió. Renombrar el proyecto renombra su carpeta (si el dueño no la renombró a mano). Las páginas
  apuntan al id del archivo, así que moverlo o renombrarlo en Drive no rompe nada. Lo que se agregue a
  mano en Drive la app no lo ve: el Drive es el respaldo, no una carpeta que la app lea.
- En la página: una miniatura chica guardada en Supabase. La foto grande y el video vienen del Drive por
  el portero.
- **Carrete:** clic en una foto o video abre todas las de la página, en orden, con siguiente/anterior,
  zoom y play. Es parte central de la app.
- **Video:** se reproduce en la app lo que el navegador del dispositivo pueda (H.264 en todos lados;
  HEVC del iPhone en Apple y en la mayoría de las computadoras con Windows). Lo que no, siempre muestra la
  miniatura y ofrece bajarlo. ProRes no se ve en navegadores.
- **Pegar un link de Drive:** como link, texto o tarjeta reproducible (el reproductor de Drive, que anda
  si quien mira tiene acceso con su Google, como en Coda).
- **Papelera de archivos** por proyecto: un archivo que ninguna página usa aparece en la pestaña
  Archivos de la papelera (con miniatura, peso y fecha). **Cada archivo se borra solo a los 30 días de
  haber entrado a la papelera** (lo que entró hace dos días espera sus 30). El dueño y los admins pueden
  además borrar de a uno o vaciar antes. Al borrarse va a la papelera de Drive (30 días más para
  recuperarlo desde Drive).
- Sin red (en rodaje): la foto o el video se guarda en el dispositivo y sube por partes cuando hay red,
  con la app abierta.

## 6. El portero de archivos

- Un programa chico en la cuenta de Cloudflare del dueño (gratis). Guarda la conexión con el Drive del
  dueño; nadie más recibe esa llave (con ella se abre todo lo que la app subió, de todos los proyectos).
- Cada pedido trae la sesión de Supabase de la persona, y el portero le pregunta al Supabase del
  workspace, con esa sesión, quién es y qué puede (hoy: solo el dueño; con equipo, por página). Así no
  tiene ninguna clave de la base. Para ver un video o una foto entrega un pase firmado por él mismo, que
  vence a las 8 horas (más corto cortaría videos a la mitad): sacar a alguien le impide pedir pases
  nuevos enseguida; uno ya dado sirve hasta que vence.
- Hecho para la prueba del paso 4: `Doc_Portero.md`.
- Cloudflare y no Supabase porque Supabase gratis solo deja 5 GB de transferencia al mes; Cloudflare no
  la cobra.
- Manda los correos de invitación.

## 7. Copia de seguridad (antes de todo lo demás)

El plan gratis de Supabase no hace copias, y hay material sensible. Tiene que existir **antes** de los
cambios de permisos, que son el momento más riesgoso.

- **Wanka: repo privado de GitHub `z_shotdocs_backup`** (decisión de Lega). Una tarea de GitHub Actions
  copia la base entera **cuatro veces por día** con la CLI de Supabase (roles, esquema y datos, con los
  usuarios, que hacen falta para que los ids no cambien), la cifra con una frase que guarda Lega y la
  deja en la rama `copias` del repo. Se guardan todas las de los últimos 30 días y la primera de cada
  mes. Si una copia sale sin páginas o sin usuarios, la tarea falla y GitHub avisa. El repo de la app es
  público: las copias nunca van ahí. Hoy la base pesa unos 2 MB de datos, así que cuatro copias por día
  casi no gastan transferencia.
- Quien cree su propio workspace necesita también una cuenta de GitHub para sus copias (paso 5 de la
  guía).
- **Restaurar tiene una trampa:** después de volver a la copia de ayer, los dispositivos creen que el
  servidor ya tiene lo de hoy y no lo vuelven a subir. Por eso cada workspace lleva una **generación**
  (hecha en v0.021): si cambia, cada dispositivo vuelve a subir todo lo suyo y Yjs lo junta sin
  duplicar. Así los dispositivos cubren lo posterior a la copia.
- **Pendiente: restaurar sobre el mismo proyecto de Supabase.** Lo guardado en cada dispositivo lleva el
  proyecto en el nombre: si se restaura en un proyecto nuevo, los dispositivos arrancan de cero y lo
  posterior a la copia queda en su base vieja, sin subir. Hoy el script de copias restaura sobre una base
  vacía; falta el modo "sobre el mismo proyecto" (reemplazar los datos sin tocar el esquema), probado,
  y que el nombre de lo guardado dependa del workspace y no del proyecto (paso 5). Mientras tanto, una
  restauración se hace con ayuda y probando antes en una base aparte.
- No cubre y hay que anotarlo en la guía: la configuración de login (sale del comando del paso 2), los
  secretos del portero y la conexión con Drive (se vuelven a cargar), las miniaturas (se regeneran desde
  Drive).
- Supabase Pro (25 USD al mes) guarda solo 7 días y no incluye los archivos: no hace falta.
- Más adelante, una copia legible (PDF de cada página) en el Drive.

## 8. Sacar a alguien

- Se le saca la membresía (no se borra la cuenta). Deja de tener acceso en el momento; un pase del
  portero que ya tenía sirve hasta que vence (8 horas).
- La app detecta que perdió el acceso y borra lo de ese workspace en su dispositivo la próxima vez que se
  conecta (decisión de Lega: alcanza).
- Lo que tuviera sin subir: si se puede, que no se pierda (Lega). Se diseña al implementarlo; una opción
  es que el dispositivo lo suba antes de que se efectivice la salida (sacar a alguien con aviso, o
  pedirle que sincronice antes).
- **Proyectos de quien se va** (decisión de Lega): los que compartía siguen y pasan a otro admin que
  tenga acceso; los privados que no compartía con nadie se van con él (van a la papelera del workspace y
  se borran a los 30 días, con su carpeta de Drive). Nadie los ve en la app.

## 9. Hosting de la app

- **Hecho (D-05, 2026-09-29): chau Vercel, la app está en Cloudflare** (Workers con archivos estáticos, lo que
  Cloudflare recomienda hoy en vez de Pages). Gratis, con uso comercial y previews por rama; el portero
  va a vivir en la misma cuenta. La app es solo archivos estáticos: de Vercel no se usa nada más.
- Misma dirección, `shotdocs.lega.com.ar` (el dominio ya está en Cloudflare). Lo guardado en cada
  dispositivo es por dirección; Lega no tiene nada que no se haya subido y la usa siempre desde su
  dominio, así que no se pierde nada.
- Las funciones que el plan preveía en Vercel (links públicos, MCP de D-07) pasan al portero.

## 10. Orden de trabajo

1. ✅ **Copia de seguridad de Wanka, cuatro por día** (sección 7) y la generación de la base (v0.021).
2. ✅ **Guarda contra lo desconocido** (v0.021): si una página trae un tipo de bloque, una marca o un contenido que
   esta versión no conoce, no se abre en el editor: muestra un aviso para actualizar, y nada se borra. Más
   la versión mínima por workspace.
3. ✅ **Mudar el hosting** a Cloudflare con la misma dirección, antes de mandar links a clientes.
4. ✅ **Prueba en el iPhone** (v0.026). Portero publicado (`Doc_Portero.md`), Drive conectado y la pantalla
   *Media test* (menú de la cuenta). Resultados:
   - **Windows, Chrome:** video H.264 4K de 25,7 MB subido en 9 s; listo para reproducir en 5,1 s.
   - **iPhone, Safari (iOS 18.7):** el selector entrega el **original**, `IMG_0666.mov` (`video/quicktime`,
     62 MB, 4K, 21 s; no lo convierte a H.264). Subió en 20 s (3,5 MB/s) sin reintentos, con la app
     manteniendo la pantalla encendida. Safari lo reproduce a 3840×2160: datos del video a los 6 s, listo
     a los 8,66 s.
- **Conclusiones para la cola (paso 6):** subir por partes anda bien en los dos; el iPhone manda el
     archivo tal cual (HEVC si la cámara está en Alta eficiencia), así que llega a Drive sin tocar y el
     carrete tiene que mostrar miniatura y ofrecer bajarlo donde el navegador no lo reproduzca. **El
     arranque del video es lento** (5 a 9 s): revisar antes del carrete (paso 7 u 8) si es el portero
     pidiendo a Drive, o el índice del video al final del archivo.
   - Queda para cuando haga falta: subir 1 GB y la app instalada en el iPhone (agregada a la pantalla de
     inicio).
5. **Preparación sin cambios visibles:** todo por workspace en el código y el dispositivo, tablas
   `workspace_settings`, `members`, `grants`, `invitations`, sacar "My project" automático y que solo
   dueño y admins creen proyectos, versión de la base por workspace.
6. **Cola de archivos nueva** (por partes, sin red), miniaturas y la lista de qué archivos usa cada
   página.
7. **Carrete** de fotos.
8. **Drive y portero;** videos en el carrete. Al conectar Drive, el dueño elige dónde va la carpeta
   `LGA_ShotDocs` (sección 5).
9. **Equipo en Wanka:** invitar, roles, permisos por proyecto y página, proyectos privados, sacar a
   alguien.
10. **Invitados (clientes):** compartir por correo, comentarios en tabla propia y preguntas.
11. **Papelera de archivos.**
12. **Varios workspaces:** pantalla de bienvenida, selector, guía y comando para crear uno.
13. Pegar links de Drive; copia liviana de video si hace falta.
