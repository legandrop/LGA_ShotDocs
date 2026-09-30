# Supabase

Cómo está armado el backend y cómo se prepara un proyecto nuevo a mano. La guía para crear un workspace
propio y el comando que prepara su Supabase de una vez están planeados para el paso 12 de
`Plan_Workspaces.md` (secciones 2 y 11); esto es lo que hace falta hoy.

## Proyecto

- Al crearlo: **Data API** activada, **"expose new tables" desactivado** (cada migración da sus permisos a
  mano) y **RLS automático** activado.
- La app solo usa la **URL del proyecto** y la **clave pública** (`sb_publishable_...`), como variables de
  entorno `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`. La clave secreta nunca va a la app: si se carga una
  por error, la compilación se corta.
- Para desarrollo local: copiar `.env.example` a `.env.local` y completarlo.

## Base de datos

Las migraciones están en `supabase/migrations/`, en orden:

| Migración | Qué hace |
|---|---|
| `20260929120000_fase1_esquema.sql` | Tablas `workspaces`, `pages` y `page_updates`, integridad del árbol (sin ciclos, el padre en el mismo espacio), Row Level Security, privilegios por columna y las funciones `ensure_workspace`, `push_page_update` y `pull_page_updates`. |
| `20260929130000_fase1_archivos.sql` | Bucket privado `page-files` para las imágenes pegadas, con un tope de 25 MB por archivo y los permisos de la página a la que pertenece cada archivo. |
| `20260929140000_fase1_politica_filas_nuevas.sql` | La política de lectura de `pages` decide con los datos de la fila, para que crear una página con `upsert` funcione. |
| `20260929150000_fase1_auditoria.sql` | Correcciones de la auditoría: los cambios de padre de un espacio se aplican de a uno (dos movimientos simultáneos ya no arman un ciclo), topes de largo, el bucket acepta solo imágenes raster (sin SVG) y las tablas nuevas no dan TRUNCATE por defecto. |
| `20260929160000_ajustes.sql` | Columna `pages.settings` (ajustes por rama, un objeto JSON de hasta 2000 caracteres) y tabla `user_settings` con las preferencias de cada cuenta: cada usuario ve y cambia solo la suya, y no se borra desde la API. |
| `20260929170000_proyectos.sql` | Proyectos: cada usuario puede crear los suyos (`workspaces`, con el id generado en el dispositivo). El dueño es siempre quien lo crea y no se puede cambiar; un proyecto no se borra desde la API. |
| `20260929171000_proyectos_nombre.sql` | Los primeros proyectos que se seguían llamando "Mis documentos" pasan a "My project", el nombre de fábrica nuevo. |
| `20260930100000_workspace_settings.sql` | Tabla `workspace_settings` (una fila, solo lectura para la app): la generación de la base (sube al restaurar una copia de seguridad), la versión mínima de la app que puede subir contenido y la versión de la base. `push_page_update` recibe la versión de la app y la compara con `private.app_version_allowed`; la de siempre (sin versión) queda para las versiones anteriores y deja de andar si hay versión mínima. Ver `Doc_Sincronizacion.md`. |
| `20260930120000_portero.sql` | `workspace_settings` suma el dueño del workspace (`owner_id`, arranca como el dueño del primer proyecto) y la dirección del portero de archivos (`media_url`, solo https). `media_whoami()` dice quién es la sesión y si es el dueño: la usa el portero (ver `Doc_Portero.md`). |

Reglas del esquema:

- Nada se borra desde la API: ni páginas (se mandan a la papelera con `deleted_at`) ni updates de
  contenido ni archivos.
- Supabase Storage (`page-files`) guarda solo las imágenes pegadas en las páginas: JPEG, PNG, GIF, WebP,
  AVIF y HEIC/HEIF de hasta 25 MB, sin SVG. Los originales de fotos y videos van al Drive del dueño por el
  portero (`Doc_Portero.md`).
- `page_updates` solo se escribe con `push_page_update()`. Cada update tiene un `seq` correlativo por
  página, asignado con la fila de la página bloqueada: bajar "lo posterior a `seq` N" nunca se saltea nada.
- Las funciones auxiliares de permisos viven en el esquema `private`, que la API no expone.
- Cada migración que crea una tabla hace `revoke all` sobre ella y da solo los permisos que hacen falta.
- `workspace_settings` se cambia solo desde el SQL Editor (o la Management API), nunca desde la app:
  `update public.workspace_settings set min_app_version = 0.021;` pide esa versión o más para subir
  contenido; `set generation = …` después de restaurar una copia (lo hace el script de restauración);
  `set media_url = 'https://…'` cuando se publica el portero.

### Aplicar las migraciones

Con un token personal de Supabase (supabase.com → Account → Access Tokens):

```sh
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ACCESS_TOKEN=sbp_... npm run db:migrate
```

El script aplica solo lo que falta y lo registra en `supabase_migrations.schema_migrations`, la misma tabla
que usa el CLI de Supabase, así que después también sirve `supabase db push`. Sin token, se puede pegar
cada archivo en el SQL Editor del proyecto, en orden.

**Las migraciones van antes de publicar la app.** La app se publica sola con cada push a `main`: si una
versión nueva usa una columna o una tabla que la base todavía no tiene, esa parte no funciona hasta
aplicar la migración. La app lo tolera sin perder nada (por ejemplo, sin `pages.settings` sigue bajando
el árbol y los cambios de ajustes quedan como rechazados en el dispositivo; después de migrar, la app lo
nota en unos minutos y se pueden reintentar), pero el
orden correcto es: migrar, probar (`npm run db:test`) y recién después hacer push.

### Pruebas de permisos

`npm run db:test` aplica lo pendiente y corre `supabase/tests/*.sql`. Cada prueba crea usuarios y datos
dentro de una transacción que se deshace al final: no deja nada en el proyecto. Si algo falla, corta con
un error que dice qué; si todo pasa, devuelve una fila con `result = 'ok'`.

| Prueba | Qué verifica |
|---|---|
| `fase1_permisos.sql` | Páginas, contenido y archivos: un usuario no ve ni cambia (título, papelera, posición, upsert con el mismo id) las páginas, el contenido ni los archivos de otro; no se pueden borrar páginas, updates ni archivos; no se arman ciclos; `update_seq` no se edita; reintentar un update no lo duplica, y sin sesión no se lee nada. |
| `ajustes_permisos.sql` | Los ajustes por rama (`pages.settings`: solo objetos, con tope de tamaño) y las preferencias de cada cuenta (`user_settings`): cada uno ve y cambia solo las suyas, no las crea a nombre de otro ni les cambia el dueño, y no se borran desde la API. |
| `proyectos_permisos.sql` | Proyectos: crear uno con el id del dispositivo y reintentarlo, que el dueño sea siempre quien lo crea y no se cambie, que no se borre desde la API, que una página no pase a otro proyecto ni cuelgue de una página de otro, y que otro usuario no los vea ni se los quede reusando el id. |
| `workspace_settings_permisos.sql` | `workspace_settings`: todos la leen y nadie la cambia desde la API; la subida de contenido según la versión de la app (sin mínimo sube; con mínimo, se rechaza la función vieja, una versión menor, ilegible o ausente con `app_outdated`); `media_whoami()` dice bien quién es el dueño, nadie se hace dueño ni cambia la dirección del portero, y `media_url` no acepta `http`. |

Dos casos no tienen prueba automática en el repo y se verificaron a mano contra el proyecto real el
2026-09-29: que la API de Storage no deja borrar un archivo, y que dos movimientos simultáneos que juntos
arman un ciclo terminan con el segundo rechazado.

## Login

La configuración de login está solo en el panel de Supabase (Authentication), no en el repo. Se carga
a mano o con la Management API (`PATCH /v1/projects/<ref>/config/auth`). Lo que tiene que quedar:

- Proveedor **Email** activado; el resto, apagado.
- La app manda el mail con `signInWithOtp`. Se entra con el **código** (escrito en la app) o con el
  **link** del mail. En el iPhone hace falta el código: el link abre Safari, no la app instalada.
- **Código de 8 dígitos** (Supabase trae 6; la app acepta de 6 a 10, `src/ui/Login.tsx`) que **vence en
  1 hora**: *Sign In / Providers → Email*, o `mailer_otp_length = 8` y `mailer_otp_exp = 3600`.
- En **Authentication → URL Configuration** van la dirección del deploy como *Site URL* y, en *Redirect
  URLs*, esa dirección y la de `workers.dev` del hosting (también con `/**`), y `http://localhost:5173/**`
  y `http://localhost:4173/**` para desarrollo (`uri_allow_list` por la API).
- **Registro cerrado** (*Allow new users to sign up* apagado, `disable_signup`, D-09): solo entran cuentas
  que ya existen o que el dueño invita (Authentication → Users → *Invite user*). Un mail sin cuenta ve el
  aviso de pedir una invitación. Está planeado abrirlo en el paso 9 de `Plan_Workspaces.md`, pero solo
  con el hook *Before User Created* de Supabase conectado a una función que rechaza los correos que no
  están en `invitations`: **primero** el hook creado y probado, **después** el registro abierto. Al revés,
  el registro quedaría abierto para cualquiera.
- **Plantillas** (Authentication → Emails → *Templates*): *Magic Link* con el código grande y un botón
  con el link, asunto `Your Shot Docs code: {{ .Token }}`; e *Invite*, la del mail que llega al invitar
  desde el panel. Por la API son los campos `mailer_subjects_*` y `mailer_templates_*_content`.
- **Límite: 30 mails por hora** (Authentication → Rate Limits, o `rate_limit_email_sent`).

### Correo propio (SMTP)

Sin SMTP propio, Supabase manda unos pocos mails por hora, solo a miembros del proyecto, y no deja cambiar
las plantillas: el mail trae el link pero no el código. Para usar la app hace falta un SMTP. Wanka usa
[Resend](https://resend.com) (gratis hasta 3000 mails por mes):

1. En Resend, agregar el dominio propio (por ejemplo `ejemplo.com`) con el *return-path* `send` y **sin
   seguimiento de clics ni de aperturas** (reescribir los links rompe el de login). Cargar los registros
   DNS que pide (un TXT de DKIM y los de `send`; no tocan el correo que ya tenga el dominio) y esperar a que
   figure como verificado.
2. Crear una API key solo de envío para ese dominio.
3. En Supabase → Authentication → Emails → **SMTP Settings**: host `smtp.resend.com`, puerto `465`,
   usuario `resend`, contraseña = la API key, y un remitente del dominio (por ejemplo
   `shotdocs@ejemplo.com`, con nombre `LGA Shot Docs`). La clave se carga solo ahí.
4. Cargar las plantillas y el límite de mails de la sección anterior.

El SMTP de Gmail o Google Workspace también sirve, pero exige verificación en 2 pasos y una contraseña de
aplicación en la cuenta que manda.

La configuración de login no entra en las copias de seguridad de la base: al armar un proyecto de nuevo
se vuelve a cargar desde esta sección.
