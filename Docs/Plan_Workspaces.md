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
  nuevas no usan "workspace" para no mezclar. Ya existe `workspace_settings` (una fila: generación,
  versión mínima de la app, versión de la base, dueño, dirección del portero, nombre del workspace y
  clave local), `members` (persona y rol), `grants` (permiso sobre un proyecto o una página) e
  `invitations` (paso 5).

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
   3. **Google Cloud**: activar la Drive API y la Google Picker API, pantalla de consentimiento externa
      con el permiso `drive.file` **en "In production"** (en "Testing" la conexión con Drive vence a los 7
      días), un cliente web con la dirección de vuelta en el portero y una clave de API para el selector
      de carpetas.
   4. **Cloudflare** (gratis): publicar el portero (guarda la conexión con Drive en su propio Durable
      Object y genera solo la clave de los pases) con sus variables: dirección y clave publicable del
      Supabase, direcciones de la app permitidas, el cliente de Google y la clave del selector. Detalle
      en `Doc_Portero.md`.
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
- Desde el paso 5 un usuario nuevo ya no recibe "My project": crea proyectos quien ya tiene alguno o es
  dueño o admin; con las políticas del paso 9, solo el dueño y los admins.

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
  recuperarlo desde Drive). El borrado automático queda apagado hasta que Lega lo confirme (sección 11,
  paso 11).
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
- Más adelante, los correos de invitación (con la clave de Resend del dueño). Al principio la app copia
  el link.

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
- **Restaurar sobre el mismo proyecto de Supabase** (paso 5, v0.030): el script de copias tiene un modo
  que reemplaza los datos sin tocar el esquema (README del repo de copias), y el nombre de lo guardado en
  los dispositivos ya no sale de la dirección del Supabase sino de la clave local del workspace (fija para
  Wanka). Así, restaurar en el mismo proyecto o en uno nuevo no deja a los dispositivos con una base
  vieja sin subir. Igual, una restauración de verdad conviene hacerla con ayuda y probando antes en una
  base aparte.
- No cubre y hay que anotarlo en la guía: la configuración de login (sale del comando del paso 1 de la
  guía, sección 2), los secretos del portero y la conexión con Drive (se vuelven a cargar), las imágenes
  pegadas en las páginas (bucket `page-files` de Supabase: hoy solo las tienen los dispositivos que las
  bajaron) y las miniaturas (habría que regenerarlas desde Drive; todavía no hay nada que lo haga).
- Supabase Pro (25 USD al mes) guarda solo 7 días y no incluye los archivos: no hace falta.
- Más adelante, una copia legible (PDF de cada página) en el Drive.

## 8. Sacar a alguien

- Se le saca la membresía (no se borra la cuenta). Deja de tener acceso en el momento; un pase del
  portero que ya tenía sirve hasta que vence (8 horas).
- La app detecta que perdió el acceso y borra lo de ese workspace en su dispositivo la próxima vez que se
  conecta (decisión de Lega: alcanza). Solo con una señal explícita de la base (su membresía con
  `removed_at`), nunca por un error o una falla de red (sección 11, paso 9).
- Lo que tuviera sin subir: si se puede, que no se pierda (Lega). Propuesta, a confirmar por Lega: antes
  de borrar, si hay cambios sin subir, la app ofrece bajarlos como archivo y no borra hasta que la
  persona elija.
- **Proyectos de quien se va** (decisión de Lega): los que compartía siguen y pasan a otro admin que
  tenga acceso; los privados que no compartía con nadie se van con él: van a la papelera del workspace y
  nadie los ve en la app. El borrado definitivo (con su carpeta de Drive) choca con la regla de no borrar:
  no se hace solo, queda para cuando Lega lo confirme.

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
5. ✅ **Preparación sin cambios visibles** (v0.030). El workspace es un objeto en el código con su clave
   local (Wanka conserva sus nombres; `Doc_Sincronizacion.md`), tablas `members`, `grants` e
   `invitations` con sus funciones y pruebas (`Doc_Supabase.md`), `ensure_workspace()` ya no crea "My
   project" (sin proyectos, la app lo avisa), la versión de la base con aviso, el modo de restaurar sobre
   el mismo proyecto (repo de copias) y la configuración de login documentada entera.
6. **Cola de archivos nueva** (por partes, sin red), miniaturas y la lista de qué archivos usa cada
   página. En la práctica va junto con el 8: la cola sube al portero.
7. **Carrete** de fotos y videos. Hecho, falta la auditoría: `Doc_Carrete.md`.
8. **Drive y portero en producción:** permisos por página en el portero, carpetas por proyecto y día, el
   dueño elige dónde va la carpeta `LGA_ShotDocs` (sección 5) y el video arranca más rápido.
9. **Equipo en Wanka:** invitar, roles, permisos por proyecto y página, proyectos privados, sacar a
   alguien.
10. **Invitados (clientes):** compartir con su correo (la app copia el link de invitación), comentarios
    en tabla propia y preguntas.
11. **Papelera de archivos.**
12. **Varios workspaces:** pantalla de bienvenida, selector, guía y comando para crear uno (el comando, la
    guía y la app, hechos; falta auditar y probar a mano).
13. Pegar links de Drive; copia liviana de video si hace falta.

## 11. Cómo se hace cada paso

Reglas para todos los pasos:

- **Una tanda a la vez:** hacer, probar (pruebas de la app, de permisos en SQL y de punta a punta),
  auditar con alguien que no la escribió, corregir, documentar (changelog, este plan, los `Doc_*` y el
  README si cambia algo visible) y recién ahí publicar. Nunca en el mismo comando que una prueba.
- **Hay una sola base, la de producción.** Mientras se escribe una migración, se prueba siempre dentro de
  `begin; … rollback;` (la migración y sus pruebas en el mismo pedido), nunca con `db:migrate`, que
  aplica de verdad. **Recién con la tanda auditada:** correr a mano la copia de seguridad (repo
  `z_shotdocs_backup`, tarea *Copia de seguridad*, *Run workflow*) y esperar que termine bien; después
  `npm run db:migrate` y `npm run db:test`. Una migración aplicada no se edita: se corrige con otra nueva.
- **La migración va antes de publicar la app, y no puede romper la versión que está publicada:** lo que
  se agrega es compatible con la app de hoy, o la app vieja falla con un aviso sin perder nada.
- **El portero se publica con el mismo push que la app:** tiene que seguir andando con la app publicada y
  con las versiones que quedaron en los dispositivos. Nunca se cambia el nombre de la clase `Store` ni las
  `migrations` de `portero/wrangler.jsonc`: ahí vive la conexión con Drive.
- **Nunca un tipo de bloque nuevo en el editor** (D-14 y "Cambios en el editor" en
  `Doc_Sincronizacion.md`): lo nuevo va como propiedad o dirección de un bloque que ya existe. Una
  versión vieja lo tiene que mostrar raro, nunca borrarlo. **Una propiedad nueva sí se puede perder** si
  alguien edita ese bloque en una versión vieja (la guarda revisa tipos y marcas, no propiedades): solo se
  usa si perderla deja el contenido intacto (el texto, el link, la dirección), con una prueba con el
  esquema anterior, y después de publicar esa versión se sube `min_app_version` a ella.
- **Lo guardado en los dispositivos de Wanka no cambia de nombre:** la base local
  (`shotdocs:<ref>:<usuario>`), la sesión (`shotdocs-auth`), `shotdocs-last-user`, `shotdocs-prefs`,
  `shotdocs-project` y `shotdocs-last-pages`. Renombrarlos desloguea a Lega en todos sus dispositivos y,
  sin red, lo deja sin su base. Los workspaces nuevos usan nombres nuevos. **Nunca se cambia la semilla**
  de las páginas (`src/sync/structure.ts`).
- **Nada se borra solo.** Nada de lo que se haga esta etapa borra datos de producción ni archivos de Drive
  sin que una persona lo pida en la app; lo que el plan dice que se borra automáticamente queda armado y
  **apagado** hasta que Lega lo confirme.
- **El dueño no pierde nada:** después de cada cambio de permisos, una prueba en SQL (en rollback, con la
  sesión del dueño de `workspace_settings.owner_id`) confirma que sigue viendo y editando todas sus páginas
  (el proyecto MGTZD es trabajo real). Lo mismo para las otras cuentas que ya existen con proyectos propios.

**Paso 5 — Preparación sin cambios visibles.**

- **Workspace en el código:** un objeto con la dirección y la clave publicable del Supabase, el nombre y
  una **clave local**. De él sale el cliente de Supabase; nada usa un cliente global.
- **La clave local** dice cómo se llama lo guardado en el dispositivo. Vive en la lista de workspaces del
  dispositivo (paso 12), porque hace falta antes de entrar y sin red; hasta que exista esa lista, Wanka
  sigue con lo de hoy. **Para Wanka, la clave local son los nombres de hoy** (regla de arriba), con el
  ref de su proyecto de Supabase **fijo como texto** (`znlvpuddswymxpffgvbz`): ya no se saca de la
  dirección, así una copia restaurada en otro proyecto no le cambia el nombre a la base local. Un workspace nuevo recibe una clave nueva, que viaja en el link de
  invitación. `workspace_settings.local_key` guarda la del workspace para armar esos links y para que una
  copia restaurada en otro proyecto de Supabase la conserve.
- **Tablas nuevas** con Row Level Security y pruebas en `supabase/tests/` antes de usarlas:
  - `members`: persona y rol en el workspace (`owner`, `admin`, `member`, `guest`) y la fecha en que se
    la sacó (`removed_at`; sacar a alguien no borra la fila).
  - `grants`: permiso de una persona sobre un proyecto o una página (`view`, `comment`, `edit`,
    `edit_pages`). Vale para lo de abajo, nunca para lo de arriba; si hay varios, gana el más alto.
  - `invitations`: correo, rol, permisos que va a recibir, quién invitó, vencimiento y si se usó.
  - **Cuentas que ya existen:** el dueño de `workspace_settings` entra como `owner`. Cada otra cuenta con
    proyectos propios entra como `member` con `edit_pages` sobre esos proyectos, para que no pierda nada
    cuando lleguen las políticas nuevas del paso 9. Hoy hay dos: una persona de afuera con un proyecto y
    una cuenta de prueba vieja (`@shotdocs-test.invalid`). No se borra ninguna: eso lo decide Lega.
  - Funciones en `private` para preguntar el rol y el permiso sobre una página. Las políticas de lectura y
    escritura de hoy siguen igual hasta el paso 9.
- **Sin "My project" automático:** `ensure_workspace()` deja de crear un proyecto y devuelve el primero
  propio, o nada; lo compartido se suma en el paso 9 con las políticas que dejan verlo (las versiones viejas guardan lo que devuelve como proyecto: solo las usa
  gente que ya tiene proyectos). La app nueva, sin proyectos, muestra un aviso para pedir acceso. Crear
  proyectos queda para quien ya tiene alguno o es `owner`/`admin`; el corte completo (solo dueño y admins)
  entra con las políticas del paso 9. Para quien usa la app hoy no cambia nada.
- **Versión de la base:** `workspace_settings.schema_version` dice qué versión de la base tiene; la app
  avisa claro si necesita una más nueva.
- **Restaurar sobre el mismo proyecto:** un modo de `restore.sh` (repo `z_shotdocs_backup`) que reemplaza
  los datos sin tocar el esquema, probado en una base local aislada, nunca contra producción.
- **Configuración de login documentada:** lo que hoy está solo en el panel de Supabase (correo,
  plantillas, registro cerrado, direcciones permitidas) queda completo en `Doc_Supabase.md` (y si se
  escribe un `supabase/config.toml`, es solo de referencia: **nunca** `supabase config push` contra Wanka,
  pisaría el SMTP, las plantillas y el registro cerrado).

**Paso 6 — Cola de archivos** (junto con el 8).

- Tabla `files` (id creado en el dispositivo, proyecto, nombre, tipo, peso, ancho, alto, duración, id en
  Drive, miniatura, quién y cuándo, `trashed_at`) y `page_files` (qué páginas usan cada archivo). Permisos
  por página, como `pages`.
- **Primero en el dispositivo:** el archivo se guarda en IndexedDB y después sube por partes al portero,
  retomando lo que ya llegó (`src/media/portero.ts`). La cola se vacía solo cuando el portero confirma, y
  cuenta en los cambios pendientes. Sin red, espera.
- **Miniatura** hecha en el dispositivo al elegir el archivo (foto: reducida a unos 480 px; video: un
  cuadro del primer segundo), en un bucket privado de Supabase con los permisos de la página. Si el
  navegador no puede abrir el archivo (HEIC en Chrome de Windows), queda un ícono y se regenera en un
  dispositivo que sí pueda.
- **En la página: el bloque `image` de siempre con la dirección `sdmedia://<id del archivo>`.** La app
  mira el tipo en `files` y muestra foto o video. Una versión vieja debería mostrar una imagen rota y
  conservar la dirección (`url` es un campo que el bloque ya tiene): **a confirmar con una prueba con el
  esquema anterior** antes de publicarlo. Nada de bloque `video` o `file`: el esquema de hoy no los tiene
  y una versión vieja los borraría.
- Las imágenes de antes (`sdfile://`, en Supabase) siguen andando igual. Al copiar una imagen a otra
  página se registra también para esa página (Roadmap).

**Paso 7 — Carrete.** Pantalla completa con todas las fotos y videos de la página en orden;
anterior/siguiente con flechas y deslizando, zoom con pellizco y rueda, play, bajar el original y cerrar
con Escape. Mientras carga, la miniatura. Pensado primero para el teléfono.

**Paso 8 — Drive y portero en producción.**

- El portero pregunta al Supabase, con la sesión de la persona, si puede ver o subir en esa página (una
  función nueva, como `media_whoami`). Sigue sin tener ninguna clave de la base.
- Carpetas `<elegida> / LGA_ShotDocs / <Proyecto> / <AAAA-MM-DD>`, sin espacios (sección 5). Renombrar el
  proyecto renombra su carpeta si todavía tiene el nombre que le puso la app.
- **Elegir dónde va la carpeta:** el selector de Google (Picker) al conectar Drive. Necesita la variable
  `GOOGLE_API_KEY` en el portero (la crea Lega en Google Cloud), el número del proyecto de Google (es el
  principio del id del cliente) y un token de acceso en el navegador: el portero se lo da **solo al
  dueño** (que ya es dueño de ese Drive), de corta duración y solo con `drive.file`. Sin esa variable, la
  app ofrece solo la raíz.
- **Arranque del video:** medir con *Media test* dónde se van los 5 a 9 segundos. Probar que el portero
  pida a Drive el principio y el final del archivo de una vez (los videos del iPhone suelen tener el
  índice al final). Guardarlos un rato: la caché de Workers probablemente no ande en `*.workers.dev` (a
  confirmar); si no, en el almacenamiento del propio portero.

**Paso 9 — Equipo.**

- **Invitar:** la app crea la invitación y copia el link; el correo automático queda para después.
- **Entrar solo con invitación:** una función de la base conectada al hook *Before User Created* de
  Supabase rechaza los correos que no están en `invitations`. **Primero** se crea y se prueba el hook,
  **después** se abre el registro. Nunca al revés: se abriría el registro para cualquiera. A confirmar en
  la documentación de Supabase al hacerlo: el hook se activa por la Management API (`config/auth`, campos
  `hook_before_user_created_*`), no por migración; la función necesita `grant execute` a
  `supabase_auth_admin` y `revoke` al resto; y hay que ver si frena también a los usuarios que crean las
  pruebas de punta a punta.
- Las políticas de `pages`, `page_updates`, `files` y los buckets pasan a mirar `members` y `grants`. Un
  proyecto nuevo es privado. Pruebas en SQL de cada fila de la tabla de permisos (sección 3), con varios
  usuarios, y la del dueño de la regla de arriba.
- Pantalla de miembros (dueño y admins): invitar, cambiar el rol, dar permisos y sacar. Diálogo de
  compartir en el proyecto y en la página. Ágiles, en un modal, nunca una página nueva.
- **Sacar a alguien** (sección 8): la app borra lo de ese workspace en el dispositivo **solo** con una
  señal explícita de la base (su fila de `members` con `removed_at`), nunca por un error, una lista vacía
  o una falla de red. Antes, si hay cambios sin subir, ofrece bajarlos como archivo (propuesta de D-18, a
  confirmar por Lega) y no borra hasta que la persona elija.

**Paso 10 — Invitados.** Rol `guest`, solo las páginas compartidas. Se invita con el correo del cliente
y la app copia el link para mandárselo (sección 4). El link lleva después del `#` la dirección y la clave
publicable del workspace, su clave local y la página. Comentarios en una tabla propia (página, id del
bloque, hilo, texto, autor, resuelto), que funcionan también sin red con su cola. **Preguntas:** un
párrafo con la propiedad `question` (como Script), con la respuesta en un hilo de comentarios.

**Paso 11 — Papelera de archivos.** Un archivo entra (`trashed_at`) cuando ninguna página viva lo usa, y
sale solo si vuelve a usarse. Pestaña Archivos en la papelera, con miniatura, peso y fecha. Dueño y admins
pueden mandar a la papelera de Drive de a uno o todos, con confirmación. **El borrado automático a los 30
días** (cuando un dueño o admin abre la app, esta le pide al portero que mande a la papelera de Drive los
vencidos, confirmándolo con la base con la sesión de esa persona) **queda armado y apagado**
(`workspace_settings`) hasta que Lega lo confirme: `page_files` lo mantienen los dispositivos y puede no
ver usos que no llegaron a registrarse (una versión vieja que copió el bloque, un dispositivo sin red, una
página en la papelera de páginas).

**Paso 12 — Varios workspaces.** Lista de workspaces guardada en el dispositivo (dirección, clave
publicable, clave local, nombre); Wanka entra a esa lista con sus nombres de hoy. Pantalla de bienvenida
(unirme o crear), selector **Workspace › Proyecto** y sesión separada por workspace. Guía en inglés y un
comando (`scripts/`) que prepara un Supabase nuevo con el token personal de su dueño, que se puede correr
dos veces sin romper nada y tiene un modo que solo muestra lo que haría. **Contra Wanka, solo ese modo**:
correrlo de verdad pisaría el SMTP, las plantillas, el registro cerrado y la Site URL. No se crean
proyectos de Supabase para probarlo: a Lega le queda uno solo gratis.
Hecho: el comando (`scripts/setup-workspace.mjs`, con `--dry-run` y el paso aparte
`--open-invite-signup`; `Doc_Supabase.md`, "Preparar un workspace nuevo"), la guía
(`Guide_Create_Workspace.md`, en inglés; los nombres de la app coinciden: **Create my workspace**,
*Project URL*, *Publishable key*) y la app, que falta auditar y probar a mano. Detalle en
`Doc_Sincronizacion.md`, "Varios workspaces":
- Lista del dispositivo en `localStorage` (`shotdocs-workspaces`, `src/workspaces.ts`) con el último abierto.
  Wanka entra marcada como la de la compilación, con sus nombres de siempre (prueba en
  `src/workspaces.test.ts`), sigue la dirección de la compilación y no se puede quitar. Los nuevos usan
  `storageNamesFor(<clave local>)`.
- **Cambiar de workspace recarga la app** con el elegido: nunca hay dos clientes escribiendo a la vez.
- Bienvenida sin ningún workspace (*Join a workspace* / *Create my workspace*); unirse con un link de otro
  workspace revisa la dirección, la clave publicable y la clave local, rechaza una clave local que ya usa
  otro workspace del dispositivo con otra dirección, y pregunta "Join <nombre> at <host>?" (el link lleva
  ahora el nombre, opcional).
- Crear: enlaza la guía y lee `workspace_settings` con la clave publicable. **La base de hoy solo la deja
  leer con sesión**, así que en la práctica el workspace entra pendiente y se completa después de que el
  dueño entra (la sesión pasa a los nombres de su clave local). Si se quiere avisar antes de entrar que falta
  correr el comando, hace falta una migración que deje leer a `anon` solo `name`, `local_key` y
  `schema_version` (no está hecha: a decidir).
- Selector **Workspace › Proyecto** (con un solo workspace, igual que antes más una línea discreta) y quitar
  del dispositivo el workspace abierto, solo sin cambios sin subir o después de bajarlos, con confirmación.

**Paso 13 — Links de Drive.** Al pegar un link de Drive: dejarlo como link, como texto o como tarjeta
reproducible (el reproductor de Drive). La tarjeta es un párrafo con el link y una propiedad: si se pierde
la propiedad (regla de arriba), queda el link. La copia liviana de un video solo si hace falta (sin
servidor que convierta videos, se haría en el navegador).
