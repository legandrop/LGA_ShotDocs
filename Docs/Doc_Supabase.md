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

### Pruebas de permisos

`npm run db:test` aplica lo pendiente y corre `supabase/tests/*.sql`. Cada prueba crea usuarios y datos
dentro de una transacción que se deshace al final: no deja nada en el proyecto. Verifican que un usuario
no ve ni cambia (título, papelera, posición, upsert con el mismo id) las páginas, el contenido ni los
archivos de otro; que no se pueden borrar páginas, updates ni archivos; que no se arman ciclos; que
`update_seq` no se edita, y que reintentar un update no lo duplica. Borrar un archivo por la API de
Storage y los movimientos simultáneos se probaron aparte, contra el proyecto real.

## Login

- Proveedor **Email** activado; el resto, apagado.
- La app manda el mail con `signInWithOtp`. Entra con el **link** del mail o con el **código** si el mail
  lo trae.
- En **Authentication → URL Configuration** tienen que estar las direcciones de la app en *Redirect URLs*
  (`http://localhost:5173/**` para desarrollo y la del deploy) y la del deploy como *Site URL*.
- **Límites del plan gratis sin servidor de correo propio (SMTP):** unos pocos mails por hora, solo a
  direcciones de miembros del proyecto, y las plantillas de los mails no se pueden cambiar. Por eso el mail
  trae solo el link. Para invitar a otras personas y para entrar desde la app instalada en el iPhone (el
  link abre Safari, no la app) hace falta configurar un SMTP (por ejemplo Resend) y agregar el código a
  las plantillas *Magic Link* y *Confirm signup* con `{{ .Token }}`.
- **Registro abierto:** hoy cualquiera con la dirección de la app puede crear una cuenta. Antes de
  configurar el SMTP hay que decidir si se cierra (D-09).
