# Supabase

Cómo está armado el backend y cómo se prepara un proyecto nuevo. La guía completa de autohosteo llega en
la fase 7; esto es lo que hace falta hoy.

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
| `20260929130000_fase1_archivos.sql` | Bucket privado `page-files` para las imágenes, con los permisos de la página a la que pertenece cada archivo. |
| `20260929140000_fase1_politica_filas_nuevas.sql` | La política de lectura de `pages` decide con los datos de la fila, para que crear una página con `upsert` funcione. |
| `20260929150000_fase1_auditoria.sql` | Correcciones de la auditoría: los cambios de padre de un espacio se aplican de a uno (dos movimientos simultáneos ya no arman un ciclo), topes de largo, el bucket acepta solo imágenes raster (sin SVG) y las tablas nuevas no dan TRUNCATE por defecto. |
| `20260929160000_ajustes.sql` | Columna `pages.settings` (ajustes por rama, un objeto JSON de hasta 2000 caracteres) y tabla `user_settings` con las preferencias de cada cuenta: cada usuario ve y cambia solo la suya, y no se borra desde la API. |
| `20260929170000_proyectos.sql` | Proyectos: cada usuario puede crear los suyos (`workspaces`, con el id generado en el dispositivo). El dueño es siempre quien lo crea y no se puede cambiar; un proyecto no se borra desde la API. |
| `20260929171000_proyectos_nombre.sql` | Los primeros proyectos que se seguían llamando "Mis documentos" pasan a "My project", el nombre de fábrica nuevo. |

Reglas del esquema:

- Nada se borra desde la API: ni páginas (se mandan a la papelera con `deleted_at`) ni updates de
  contenido ni archivos.
- `page_updates` solo se escribe con `push_page_update()`. Cada update tiene un `seq` correlativo por
  página, asignado con la fila de la página bloqueada: bajar "lo posterior a `seq` N" nunca se saltea nada.
- Las funciones auxiliares de permisos viven en el esquema `private`, que la API no expone.
- Cada migración que crea una tabla hace `revoke all` sobre ella y da solo los permisos que hacen falta.

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
dentro de una transacción que se deshace al final: no deja nada en el proyecto. Verifican que un usuario
no ve ni cambia (título, papelera, posición, upsert con el mismo id) las páginas, el contenido ni los
archivos de otro; que no se pueden borrar páginas, updates ni archivos; que no se arman ciclos; que
`update_seq` no se edita, y que reintentar un update no lo duplica. Dos casos no tienen prueba automática
en el repo y se verificaron a mano contra el proyecto real el 2026-09-29: que la API de Storage no deja
borrar un archivo, y que dos movimientos simultáneos que juntos arman un ciclo terminan con el segundo
rechazado.

## Login

- Proveedor **Email** activado; el resto, apagado.
- La app manda el mail con `signInWithOtp`. Se entra con el **código** de 8 dígitos (escrito en la app) o
  con el **link** del mail. En el iPhone hace falta el código: el link abre Safari, no la app instalada.
- En **Authentication → URL Configuration** van la dirección del deploy como *Site URL* y, en *Redirect
  URLs*, esa dirección, las de preview del hosting y `http://localhost:5173/**` para desarrollo.
- **Registro cerrado** (*Allow new users to sign up* apagado, D-09): solo entran cuentas que ya existen o
  que el dueño invita (Authentication → Users → *Invite user*). Un mail sin cuenta ve el aviso de pedir una
  invitación.

### Correo propio (SMTP)

Sin SMTP propio, Supabase manda unos pocos mails por hora, solo a miembros del proyecto, y no deja cambiar
las plantillas: el mail trae el link pero no el código. Para usar la app hace falta un SMTP. Con
[Resend](https://resend.com) (gratis hasta 3000 mails por mes):

1. En Resend, agregar el dominio propio (por ejemplo `ejemplo.com`) con el *return-path* `send` y **sin
   seguimiento de clics ni de aperturas** (reescribir los links rompe el de login). Cargar los registros
   DNS que pide (un TXT de DKIM y los de `send`; no tocan el correo que ya tenga el dominio) y esperar a que
   figure como verificado.
2. Crear una API key solo de envío para ese dominio.
3. En Supabase → Authentication → Emails → **SMTP Settings**: host `smtp.resend.com`, puerto `465`,
   usuario `resend`, contraseña = la API key, y un remitente del dominio (por ejemplo
   `shotdocs@ejemplo.com`). La clave se carga solo ahí.
4. En Authentication → Emails → **Templates**, agregar el código a *Magic Link* con `{{ .Token }}` (por
   ejemplo en el asunto: `Your Shot Docs code: {{ .Token }}`) y subir el límite de mails por hora
   (Authentication → Rate Limits).

El SMTP de Gmail o Google Workspace también sirve, pero exige verificación en 2 pasos y una contraseña de
aplicación en la cuenta que manda.
