# Supabase

Cómo está armado el backend y cómo se prepara un proyecto nuevo. Un workspace nuevo se prepara con el
comando `scripts/setup-workspace.mjs` ("Preparar un workspace nuevo", abajo), siguiendo la guía para
usuarios `Guide_Create_Workspace.md` (en inglés); lo que sigue explica qué hace y cómo rearmarlo a mano.

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
| `20260930140000_miembros.sql` | Paso 5 de `Plan_Workspaces.md`, sin cambios visibles. Tablas `members` (persona, rol y `removed_at`: sacar a alguien no borra la fila), `grants` (permiso de una persona sobre un proyecto o una página) e `invitations` (correo en minúsculas, rol, permisos que va a recibir, vencimiento a los 30 días y si se usó). Por ahora la API solo las lee: cada uno ve su fila y sus permisos; el dueño y los admins, todo. Funciones `private.workspace_role`, `private.page_level` y `private.project_level` (0 nada, 1 ver, 2 comentar, 3 editar, 4 editar y crear páginas: quien creó el proyecto tiene 4, los permisos valen para lo de abajo y gana el más alto; los de alguien sacado no cuentan). Las políticas de páginas, contenido y archivos no cambian. `ensure_workspace()` ya no crea "My project": devuelve el primer proyecto propio, o nada (lo compartido se suma en el paso 9, con las políticas que dejan verlo). Crear proyectos queda para quien ya tiene alguno o es dueño o admin (`private.can_create_project`). `workspace_settings` suma el nombre del workspace (`name`) y la clave local (`local_key`); en Wanka, "Wanka" y `znlvpuddswymxpffgvbz`, y `schema_version` pasa a 2. Las cuentas que ya existen entran como miembros: el dueño como `owner` y las demás con proyectos propios como `member`, con `edit_pages` sobre cada uno. `media_whoami()` suma el rol. |
| `20260930150000_archivos.sql` | Pasos 6 y 8 de `Plan_Workspaces.md`: los archivos de las páginas (fotos y videos que van al Drive del dueño por el portero). Tablas `files` (id creado en el dispositivo, proyecto, nombre, tipo en minúsculas, peso, ancho, alto, duración, id en Drive cuando termina la subida, `thumb_at` si ya hay miniatura, quién y cuándo, `uploaded_at` y `trashed_at` para la papelera del paso 11) y `page_files` (qué páginas usan cada archivo), de solo lectura desde la API y sin borrar nada. Se ve un archivo si se lo creó o si se ve alguna página que lo usa (`can_view_page`, como las páginas hasta el paso 9). `private.file_level` da el permiso sobre un archivo (el más alto sobre sus páginas, con `page_level`; quien lo creó tiene al menos editar mientras pueda editar alguna página de su proyecto, así que sacarlo del workspace le corta también sus archivos). Funciones `register_file` (en una página que se edita; reintentar no cambia nada), `link_page_file` (sumar a otra página del mismo proyecto; `file_not_found` si todavía no llegó), `media_file` (para el portero: el archivo, su proyecto y el permiso, o nada), `set_file_drive` (el id en Drive, una sola vez) y `set_file_thumb`. Bucket privado `thumbs` con las miniaturas (`<id del archivo>.jpg`, JPEG o WebP de hasta 512 KB): lee quien ve el archivo y sube quien lo edita; no se reemplazan ni se borran. `schema_version` pasa a 3. |
| `20260930160000_equipo.sql` | Paso 9 de `Plan_Workspaces.md` (la base). Las políticas de `pages`, `page_updates`, `page_files`, `files`, el bucket `page-files` y `workspaces`, y `push_page_update`/`pull_page_updates`, pasan a mirar `members` y `grants`: una página se ve con `page_level >= 1` y se edita (título, ícono, ajustes, contenido, imágenes) con 3; crear, mover (4 en la página y en el destino; el orden entre hermanas es del padre) y mandar a la papelera o restaurar piden 4 (trigger `pages_permissions`, con los errores `page_create_denied`, `page_move_denied` y `page_trash_denied`). Quien creó un proyecto tiene 4 solo mientras es miembro activo: sacar a alguien le corta todo, también sus archivos. Un proyecto se ve con permiso sobre él o sobre una página de adentro (para mostrar su nombre); lo crean solo el dueño y los admins y nace privado (el dueño del workspace no ve los privados de otros); lo renombra quien tiene 4. `ensure_workspace()` devuelve el propio más viejo, si no el primero con permiso de proyecto, si no el de una página compartida. Una sesión abierta con contraseña (un `amr` con `method = 'password'` en el token) no es miembro de nada (`private.session_allowed`): todos los niveles dan 0 y `accept_invitations` se niega; ver "Abrir el registro solo para invitados". Funciones del equipo: `create_invitation` (una invitación viva por correo: quien la hizo puede volver a invitar y se suma a la suya; si la viva es de otra persona, `invitation_exists`), `list_invitations`, `revoke_invitation` (la marca con `revoked_at`), `accept_invitations` (con el correo verificado; aplica cada permiso solo si quien invitó todavía tiene 4 sobre eso), `list_members`, `set_member_role`, `remove_member` (cada proyecto que la persona compartía pasa a un dueño o admin con permiso sobre el proyecto entero, primero `edit_pages`; si no hay, queda sin heredero y se informa: devuelve `{"transferred": [...], "without_heir": [...]}`), `share`, `unshare` y `list_access`. Nada se borra: un permiso sacado, y los de alguien sacado que vuelve con una invitación, quedan en `grants` con `revoked_at`, sin efecto. Para los hooks de Supabase, sin conectar (ver "Login"): `private.hook_before_user_created` (*Before User Created*) y `private.hook_custom_access_token` (*Custom Access Token*, opcional); `supabase_auth_admin` puede ejecutar solo esas dos y no tiene permisos sobre tablas. `schema_version` pasa a 4. Cambio de comportamiento: un `member` ya no crea proyectos (las dos cuentas de antes del paso 5 que no son del dueño siguen con todo lo suyo, pero no crean proyectos nuevos). |
| `20260930170000_comentarios.sql` | Paso 10 de `Plan_Workspaces.md`: los comentarios, en una tabla propia y no dentro del documento. Tabla `comments` (id creado en el dispositivo, página, `block_id` del bloque de BlockNote al que se ancla o nada para la página entera, `thread_id` del primer comentario del hilo en las respuestas, que tiene que ser de la misma página y les da su bloque, texto de 1 a 10000 caracteres, autor, `edited_at`, `resolved_at`/`resolved_by` en el primer comentario del hilo y `deleted_at`/`deleted_by`). Se ven los de las páginas que se ven (`page_level >= 1`); desde la API la tabla se lee sin la columna `body`, y el texto sale por la vista `comments_view` (con los permisos de quien consulta), que lo devuelve vacío si el comentario se borró: borrar marca y el texto queda en la base. Se escribe solo con funciones: `add_comment` (pide comentar; reintentar con el mismo id y el mismo contenido no hace nada, con otro es `comment_conflict`), `edit_comment` (solo quien lo escribió), `delete_comment` (quien lo escribió o quien tiene editar y crear páginas), `resolve_thread` (comentar; abre o resuelve el hilo) y `comment_authors` (id y correo de quienes escribieron, resolvieron o borraron comentarios en una página, a quien la ve: los invitados ven los nombres y correos del equipo, decisión de Lega). Los invitados no tienen reglas propias: valen los permisos por página del paso 9. `schema_version` pasa a 5. |
| `20260930180000_papelera_archivos.sql` | Paso 11 de `Plan_Workspaces.md` (la base): la papelera de archivos. Un archivo entra a la papelera (`files.trashed_at`, la fecha en que entró) cuando ninguna página viva lo usa (una página en la papelera de páginas, o adentro de una, no cuenta) y sale si vuelve a usarse; lo recalcula `private.refresh_file_trash` desde triggers de `page_files` y de `pages` (entrar o salir de la papelera, moverse). Dejar de usar un archivo es marcar su fila de `page_files` con `removed_at` (columna nueva) con `unlink_page_file` (pide editar la página; la app la llama cuando un bloque `sdmedia://` desaparece de la página); `link_page_file` y `register_file` la reactivan. `trashed_files(p_project)`: lo que está en la papelera del proyecto (id, nombre, tipo, peso, `thumb_at`, `trashed_at`, `days_left` para los 30 días y `purged_at`), para quien tiene editar y crear páginas sobre el proyecto entero y para el dueño y los admins con algún permiso sobre el proyecto entero. `purge_file` (solo dueño y admins con permiso sobre el proyecto, solo si está en la papelera) marca `purged_at`/`purged_by` sin borrar nada; el portero lo manda a la papelera de Drive y lo confirma con `media_purged` (`drive_trashed_at`). Pedirlo es definitivo para la app: un archivo con `purged_at` ya no sale de la papelera aunque se vuelva a usar. `media_file` suma `trashed_at`, `purged_at` y `drive_trashed_at` sin sacar nada. Borrado automático a los 30 días armado y **apagado**: `workspace_settings.auto_purge_files` (`false`) y `files_due_for_purge(p_project)`, que no devuelve nada mientras esté apagado. Nada borra filas. `schema_version` pasa a 6. |

Reglas del esquema:

- Nada se borra desde la API: ni páginas (se mandan a la papelera con `deleted_at`) ni updates de
  contenido ni archivos ni comentarios (borrar un comentario lo marca con `deleted_at`). Dejar de usar un
  archivo marca su uso (`page_files.removed_at`), y mandarlo a la papelera de Drive deja la fila con
  `purged_at` y `drive_trashed_at`.
- Supabase Storage (`page-files`) guarda solo las imágenes pegadas en las páginas: JPEG, PNG, GIF, WebP,
  AVIF y HEIC/HEIF de hasta 25 MB, sin SVG. Los originales de fotos y videos van al Drive del dueño por el
  portero (`Doc_Portero.md`).
- `members`, `grants` e `invitations` se leen desde la API pero se escriben solo con las funciones del equipo
  (`create_invitation`, `revoke_invitation`, `accept_invitations`, `set_member_role`, `remove_member`,
  `share`, `unshare`). Tampoco se borran filas: un permiso o una invitación que dejan de valer quedan con
  `revoked_at`.
- `comments` se escribe solo con `add_comment`, `edit_comment`, `delete_comment` y `resolve_thread`, y se lee
  sin la columna `body` (pedirla, o `*`, da error): la app lee los comentarios de `comments_view`, que da el
  texto salvo en los borrados.
- `page_updates` solo se escribe con `push_page_update()`. Cada update tiene un `seq` correlativo por
  página, asignado con la fila de la página bloqueada: bajar "lo posterior a `seq` N" nunca se saltea nada.
- Las funciones auxiliares de permisos viven en el esquema `private`, que la API no expone.
- Cada migración que crea una tabla hace `revoke all` sobre ella y da solo los permisos que hacen falta.
- `workspace_settings` se cambia solo desde el SQL Editor (o la Management API), nunca desde la app:
  `update public.workspace_settings set min_app_version = 0.021;` pide esa versión o más para subir
  contenido; `set generation = …` después de restaurar una copia (lo hace el script de restauración);
  `set media_url = 'https://…'` cuando se publica el portero; `set auto_purge_files = true` prende el borrado
  automático de la papelera de archivos a los 30 días (apagado hasta que Lega lo confirme; ver el paso 11 de
  `Plan_Workspaces.md`).

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
| `miembros_permisos.sql` | Miembros, permisos e invitaciones: cada uno ve solo su fila y sus permisos, el dueño y los admins ven todo, alguien sacado no (y sus permisos no cuentan), y nadie escribe en las tres tablas desde la API; el permiso sobre una página con permisos en el proyecto, en la página y en una de arriba (vale hacia abajo, no hacia arriba, y gana el más alto); `ensure_workspace()` no crea proyectos y da nada a quien no tiene nada; crean proyectos solo el dueño y los admins (también reintentando el mismo id), y un miembro con un proyecto propio no crea otro; alguien sacado pierde también lo que creó, y ve solo su fila. |
| `archivos_permisos.sql` | Archivos: el dueño de un proyecto registra un archivo y lo ve; reintentar `register_file`, `link_page_file` y `set_file_drive` no cambia nada, y un id en Drive ya puesto no se cambia; ni `link_page_file` ni `register_file` cruzan proyectos; `media_file` da el json esperado al dueño y nada a quien no ve el archivo; otro usuario no ve, registra ni linkea los archivos ajenos; los permisos por página (ver, editar) y el piso de quien creó el archivo, que se pierde al dejar de editar el proyecto o al ser sacado; datos con forma inválida; nadie escribe ni borra en `files` y `page_files` desde la API; el bucket `thumbs`: nombres válidos, subir solo con permiso de edición, leer con permiso de ver, sin cambiar ni borrar, y sin sesión nada. |
| `equipo_permisos.sql` | Equipo: cada nivel sobre una página (ver y bajar; comentar; editar: contenido, título, ícono, ajustes, imágenes y archivos; editar y crear páginas: crear adentro, mover, papelera y restaurar), hacia abajo sí y hacia arriba no, y gana el más alto; mover entre ramas pide permiso en las dos (y reordenar, en el padre) y no arma ciclos; los roles: el dueño y los admins crean proyectos privados, nadie ve los privados de otros (tampoco el dueño), un miembro o una invitada no crean proyectos, quien tiene editar y crear sobre un proyecto lo renombra; `ensure_workspace` en cada caso; invitaciones (correo en minúsculas, solo el dueño invita admins, permisos solo sobre lo que quien invita tiene con 4, quien la hizo suma a la suya sin cambiar `invited_by`, nadie toca una ajena, `list_invitations` da solo las vivas, `revoke_invitation` la marca y la puede hacer el dueño o quien la hizo) y `accept_invitations` (con el correo verificado; no baja un rol ni cambia al dueño; saltea los permisos sobre lo que quien invitó ya no tiene con 4; alguien sacado vuelve sin sus permisos de antes, que quedan marcados); el hook acepta a los invitados y rechaza con `{"error": {"http_code": 403, "message"}}` al resto (sin invitación, vencida, usada, revocada, de una admin sacada, sin correo); el hook de token deja pasar código, link y renovaciones y rechaza la contraseña; `supabase_auth_admin` ejecuta solo los dos hooks y ninguna tabla; una sesión con contraseña (también con un segundo factor) no ve ni puede nada, y con código o link todo sigue igual; `list_members`, `set_member_role`, `share`, `unshare` (marca, y compartir de nuevo lo reactiva) y `list_access` con sus reglas; sacar a alguien (pierde todo al instante, su proyecto compartido pasa a la admin con `edit_pages` sobre el proyecto, los que solo tienen permisos sobre páginas sueltas quedan sin heredero y se informan (la dueña con "ver" sobre una página no hereda), el privado no lo ve nadie y nada se borra); nadie escribe en `members`, `grants` ni `invitations` desde la API, y sin sesión nada. |
| `comentarios_permisos.sql` | Comentarios: ver y comentar según el nivel sobre la página (ver no comenta ni resuelve; comentar, editar y editar y crear sí), hacia abajo sí y hacia arriba no; hilos (la respuesta toma el bloque del hilo; en otra página, a una respuesta, a un hilo que no existe o en otro bloque, rechazado); texto y bloque con forma inválida; reintentar el alta no duplica ni cambia nada y con otro contenido, en otra página o de otra persona es `comment_conflict`; editar solo el autor (el mismo texto no cambia `edited_at`, un borrado no se edita, el autor que pasa a ver no edita ni borra); borrar el autor o quien tiene editar y crear, dos veces no cambia nada y el texto queda en la base pero la vista no lo da; resolver y volver a abrir; alguien sacado no ve ni escribe, tampoco lo suyo; una invitada con comentar ve solo lo compartido, comenta, responde y resuelve pero no edita la página ni sube archivos, y con editar sube archivos pero no crea páginas; `comment_authors` da a la invitada los correos de quienes aparecen en esa página y nada de otras; nadie escribe directo en `comments` ni en `comments_view`, ni lee el texto en la tabla, y sin sesión nada. |
| `papelera_archivos_permisos.sql` | Papelera de archivos: un archivo entra al dejar de usarse en su única página y sale al volver a usarse (`link_page_file` y `register_file` reactivan el uso), también al mandar a la papelera la página (o una de arriba) y restaurarla, y al mover la página adentro o afuera de una que está en la papelera; un archivo que otra página viva usa no entra; la fecha de entrada no cambia mientras sigue adentro; `unlink_page_file` pide editar y reintentarlo no cambia nada; la papelera la ven la dueña, la admin con permiso sobre el proyecto y el miembro con editar y crear páginas, y no el miembro con editar, la invitada, la admin sin permiso sobre ese proyecto privado ni la sacada; `files_due_for_purge` vacío con el interruptor apagado (y que la app no lo prende); mandar a Drive solo la dueña y las admins, nunca algo en uso, pedirlo y confirmarlo dos veces no cambia nada, lo pedido no sale aunque se vuelva a usar y lo confirmado sale de la lista; ninguna fila de `files` ni de `page_files` se borra; nadie escribe el estado directo; sin sesión nada. |

**Pruebas de punta a punta** (no están en el repo): crean sus usuarios con la API de administración
(`auth.admin.createUser`, que no pasa por el hook *Before User Created*) y les insertan un proyecto por SQL.
Desde `20260930160000_equipo.sql`, quien creó un proyecto tiene permiso sobre él solo si es miembro activo,
así que cada usuario de prueba necesita además su fila en `members`, en el mismo SQL que crea el proyecto:

```sql
insert into public.members (user_id, role) values ('<id del usuario de prueba>', 'member')
on conflict (user_id) do update set removed_at = null;
```

Con `member` alcanza para todo lo de su proyecto. Si la prueba crea proyectos desde la app, el rol tiene que
ser `admin`.

Dos casos no tienen prueba automática en el repo y se verificaron a mano contra el proyecto real el
2026-09-29: que la API de Storage no deja borrar un archivo, y que dos movimientos simultáneos que juntos
arman un ciclo terminan con el segundo rechazado.

## Preparar un workspace nuevo

`scripts/setup-workspace.mjs` (paso 12 de `Plan_Workspaces.md`) prepara el Supabase de un workspace **nuevo**
con el token personal de su dueño (Management API, `https://api.supabase.com/v1/projects/<ref>/...`). Node 22
o más, sin dependencias (no hace falta `npm install`). La salida es en inglés porque la lee quien sigue la
guía. La lógica está en `scripts/lib/setup.mjs`; lo común con `db-migrate.mjs` (el cliente de la Management
API y las migraciones), en `scripts/lib/management.mjs` y `scripts/lib/migrations.mjs`.

```sh
SUPABASE_ACCESS_TOKEN=sbp_... node scripts/setup-workspace.mjs --ref <ref> --owner-email <correo del dueño> \
  --app-url https://shotdocs.lega.com.ar --smtp-from shotdocs@<dominio> --name "<nombre>" [--dry-run]
```

Opciones: `--ref` (obligatorio, siempre explícito: no se toma de `SUPABASE_URL`, que en esta carpeta apunta a
Wanka), `--owner-email`, `--app-url` (solo el origen, https), `--smtp-from` (remitente del dominio verificado
en Resend), `--name`, `--media-url` (el portero, solo el origen), `--redirect-url` (otra dirección permitida;
se repite), `--smtp-sender-name` (`LGA Shot Docs`), `--smtp-host` (`smtp.resend.com`), `--smtp-port` (`465`),
`--smtp-user` (`resend`), `--new-smtp-password`, `--dry-run`, `--open-invite-signup` y `--help`.
`npm run workspace:setup -- …` es lo mismo.

Qué hace, en orden, y solo lo que falta (se puede correr dos veces sin cambiar nada):

1. **Lee el estado**, sin escribir: `GET /config/auth` (los secretos se descartan apenas llegan: de la
   contraseña SMTP queda solo si hay una guardada) y consultas de una sola sentencia `select` envueltas en
   `begin read only; …; rollback;` (migraciones aplicadas, `workspace_settings`, la cuenta del dueño por su
   correo en `auth.users`, el dueño activo en `members`, los permisos de la función del hook).
2. **Seguros.** No escribe nada si el ref es el de Wanka (`znlvpuddswymxpffgvbz`) ni si el proyecto ya tiene
   `workspace_settings.owner_id` y su correo no es `--owner-email` (o si `members` ya tiene otro dueño
   activo): correrlo pisaría el SMTP (y su contraseña), las plantillas, el registro cerrado y la Site URL de
   ese workspace. En `--dry-run` los muestra y sigue mostrando el plan.
3. **Muestra el plan:** migraciones pendientes, un diff de la configuración de login actual contra la
   deseada (campo por campo; de las plantillas, solo el largo), de dónde sale la contraseña SMTP, si la
   cuenta del dueño existe o se lo invita, y qué cambia en `workspace_settings` y `members`. Con `--dry-run`
   termina acá.
4. **La contraseña SMTP** (la API key de Resend), antes de escribir nada: de `SMTP_PASSWORD`, o se pide por
   la terminal sin mostrarla. Si ya hay una guardada, no la pide (salvo `--new-smtp-password`). Nunca se
   acepta como opción (quedaría en el historial) ni se imprime.
5. **Migraciones** pendientes, con `applyPending` (lo mismo que `db:migrate`).
6. **Login:** un `PATCH /config/auth` solo con los campos que difieren (más `smtp_pass` si hay una nueva), y
   después vuelve a leer y compara. Los valores son los de Wanka ("Login", abajo) con las direcciones y el
   remitente de este workspace: código de 8 dígitos que vence en 1 hora; plantillas *Magic Link*, *Confirm
   signup* (el mismo HTML que *Magic Link*, con el código) e *Invite* con sus asuntos; límites; SMTP;
   `site_url` = `--app-url`; `uri_allow_list` suma `--app-url/**` y cada `--redirect-url/**` a las que ya
   estaban (no saca ninguna); todo otro proveedor apagado; **registro cerrado** (`disable_signup: true`),
   salvo que ya esté abierto para invitados con el hook conectado (no lo vuelve a cerrar). Si estaba abierto
   **sin** el hook, lo cierra. Nunca toca los campos del hook.
7. **El dueño:** busca su cuenta por correo; si no existe, lo invita (`POST /auth/v1/invite` del proyecto, con
   la clave secreta que lee de `GET /v1/projects/<ref>/api-keys?reveal=true`, que no se guarda ni se
   imprime). Llega el mail de *Invite*: sirve para ver que el correo anda; el dueño entra después con el
   código. Si el hook ya está conectado, no invita (el hook rechazaría el alta) y pide crear la cuenta desde
   el panel.
8. **`workspace_settings` y `members`,** en una transacción: `name` si se pasó `--name`, `local_key` nueva y
   aleatoria (`ws_` y 20 letras y números) **solo si está vacía**, `owner_id` solo si está vacío, `media_url`
   si se pasó `--media-url`, y la fila del dueño en `members` como `owner` (si ya estaba, vuelve a `owner`
   activo). Adentro de la transacción vuelve a mirar que el dueño sea el esperado; si no, no escribe nada.
9. Imprime la dirección del proyecto y la clave publicable (para la app y el portero).

Si las migraciones están pendientes, parte del plan de `workspace_settings` depende de ellas (la de miembros,
por ejemplo, carga nombre y clave local en una instalación que ya tiene dueño): el dry-run lo dice, y la
corrida de verdad vuelve a leer después de migrar.

**`--dry-run` no escribe nada.** Además de que todas las ramas que escriben están después del corte, el
cliente (`lib/management.mjs`) frena cualquier pedido que no sea un `GET` o un `POST` a `/database/query` con
una consulta de solo lectura (`begin read only;`, una sola sentencia `select`/`with` sin `;`, `rollback;`):
Postgres rechaza cualquier escritura dentro de esa transacción, y el cliente corta antes de llegar a la red.
**Contra Wanka, solo `--dry-run`** (`Plan_Workspaces.md`, paso 12): de verdad, los seguros no lo dejan. Nunca
se crean proyectos de Supabase para probarlo; las pruebas usan un Supabase falso en memoria.

**`--open-invite-signup`** es un paso aparte (no hace el resto): abre el registro solo para invitados, como
"Abrir el registro solo para invitados" (abajo), pasos 4 a 6. Pide que ya esté todo lo anterior (migraciones
al día, la función del hook con sus permisos `t`, `t`, `f`, dueño, SMTP y las plantillas con el código);
conecta el hook con el registro todavía cerrado, verifica que quedó conectado y que la función rechaza con
403 un correo sin invitación (una consulta de solo lectura), y **recién después** abre el registro. Si al
abrir el hook no quedó prendido, vuelve a cerrar el registro. Si ya está abierto con el hook, no hace nada.
La prueba desde la app (un correo sin invitación y uno invitado) queda a mano.

Pruebas: `scripts/setup-workspace.test.mjs` (entra en `npm test`): la configuración deseada, el diff, que los
secretos no salen, los seguros, que la clave local y el dueño no se pisan, que dry-run no escribe (con un
`fetch` falso que falla ante cualquier pedido que no sea `GET` o una consulta de solo lectura, también contra
un "Wanka" de mentira), que una corrida de verdad deja todo y la segunda no cambia nada, y el orden del
registro para invitados.

## Login

La configuración de login vive en el panel de Supabase (Authentication), no en la base: no entra en las
migraciones ni en las copias de seguridad. Esta sección tiene todo lo necesario para rearmar un proyecto
igual. Los valores son los de Wanka, leídos del proyecto el 2026-09-30; cada uno lleva dónde está en el
panel y su nombre en la Management API (`/v1/projects/<ref>/config/auth`). Si se cambia algo en el panel,
se actualiza acá (y el HTML en `supabase/templates/` si es una plantilla).

Cómo entra la gente:

- La app manda el mail con `signInWithOtp`. Se entra con el **código** (escrito en la app) o con el
  **link** del mail. En el iPhone hace falta el código: el link abre Safari, no la app instalada.
- **Registro cerrado** (D-09): solo entran cuentas que ya existen o que el dueño invita (Authentication →
  Users → *Invite user*). Un mail sin cuenta ve el aviso de pedir una invitación. Se abre solo para
  invitados con el hook *Before User Created* conectado a `private.hook_before_user_created`, que rechaza
  los correos sin una invitación viva: **primero** el hook conectado y probado, **después** el registro
  abierto. Al revés, el registro quedaría abierto para cualquiera. Paso a paso: "Abrir el registro solo
  para invitados", abajo.

### Proveedores y registro

*Authentication → Sign In / Providers*:

- **Email** prendido (`external_email_enabled: true`).
- Todo lo demás apagado: teléfono (`external_phone_enabled`), usuarios anónimos
  (`external_anonymous_users_enabled`), Google, Apple, GitHub y el resto de los `external_*_enabled`,
  Web3, SAML (`saml_enabled`), passkeys (`passkey_enabled`) y el servidor OAuth (`oauth_server_enabled`).
- **Allow new users to sign up** apagado (`disable_signup: true`).
- **Confirm email** prendido (`mailer_autoconfirm: false`): una cuenta nueva confirma su correo antes de
  entrar, y no se entra con un correo sin verificar (`mailer_allow_unverified_email_sign_ins: false`).
- **Secure email change** prendido (`mailer_secure_email_change_enabled: true`, la doble confirmación):
  para cambiar el correo de una cuenta hay que confirmar desde la dirección vieja y desde la nueva.
- **Código de 8 dígitos** que **vence en 1 hora** (*Email → Email OTP Length / Expiration*,
  `mailer_otp_length: 8` y `mailer_otp_exp: 3600`). Supabase trae 6; la app acepta de 6 a 10
  (`src/ui/Login.tsx`).
- Contraseñas: la app no las usa y la base no las acepta: una sesión abierta con contraseña no ve ni puede
  nada (`private.session_allowed`, ver "Abrir el registro solo para invitados"). Quedan los valores de fábrica (`password_min_length: 6`, sin chequeo de
  contraseñas filtradas).
- Verificación en dos pasos: vienen prendidos de fábrica los códigos de app autenticadora
  (`mfa_totp_enroll_enabled` y `mfa_totp_verify_enabled`), aunque la app no los ofrece; por teléfono y
  WebAuthn, apagados.
- Hooks: todos apagados (`hook_*_enabled: false`), incluidos *Before User Created*
  (`hook_before_user_created_enabled` y `hook_before_user_created_uri`) y *Custom Access Token*
  (`hook_custom_access_token_enabled` y `hook_custom_access_token_uri`); ver "Abrir el registro solo para
  invitados". Captcha apagado (`security_captcha_enabled: false`).

### Abrir el registro solo para invitados

Todavía no se hizo en Wanka. La función del hook viene con `20260930160000_equipo.sql`, pero conectarla es
configuración de login: se hace a mano, por la Management API, **en este orden y nunca al revés**. En un
workspace nuevo, los pasos 4 a 6 los hace `setup-workspace.mjs --open-invite-signup` ("Preparar un workspace
nuevo"); en Wanka, a mano. Qué hace
Supabase (documentación *Before User Created Hook* y código de Supabase Auth): antes de crear una cuenta
(registro con código o link, invitación desde el panel, proveedores externos, anónimos) llama a
`select "private"."hook_before_user_created"(evento)` como `supabase_auth_admin`, con el evento
`{"metadata": {...}, "user": {"email": ..., ...}}`. Si la función devuelve `{}`, sigue; si devuelve
`{"error": {"http_code": 403, "message": "..."}}`, no crea la cuenta y la app recibe ese mensaje (empieza
con "Signups not allowed", así que la app muestra el aviso de pedir una invitación). Crear usuarios con la
API de administración (`auth.admin.createUser`) no pasa por el hook. Con el registro cerrado, el registro
por código corta antes de llegar al hook; la invitación desde el panel no.

1. **La migración aplicada.** Control en el SQL Editor (tiene que dar `t`, `t`, `f`):

   ```sql
   select has_function_privilege('supabase_auth_admin', 'private.hook_before_user_created(jsonb)', 'execute'),
          has_schema_privilege('supabase_auth_admin', 'private', 'usage'),
          has_function_privilege('authenticated', 'private.hook_before_user_created(jsonb)', 'execute');
   ```
2. **La plantilla de alta con el código.** Una cuenta nueva que pide código no recibe *Magic Link* sino
   *Confirm signup* (`mailer_templates_confirmation_content`, asunto `mailer_subjects_confirmation`), y la
   de fábrica trae solo el link: en el iPhone no se podría entrar. Antes de abrir, cargarle el mismo
   contenido que a *Magic Link* (con `{{ .Token }}` y `{{ .ConfirmationURL }}`), por ejemplo con el `jq` de
   "Rearmar la configuración" (paso 3) sumando
   `mailer_templates_confirmation_content: $magic` y `mailer_subjects_confirmation: "Your Shot Docs code: {{ .Token }}"`.
3. **Una invitación de prueba** (con la sesión del dueño desde la app, o en el SQL Editor):

   ```sql
   insert into public.invitations (email, role, invited_by)
   values ('prueba@dominio-del-duenio', 'guest', (select owner_id from public.workspace_settings));
   ```
4. **Conectar el hook**, con el registro todavía cerrado. Guardar como `hook.json`:

   ```json
   {
     "hook_before_user_created_enabled": true,
     "hook_before_user_created_uri": "pg-functions://postgres/private/hook_before_user_created"
   }
   ```

   ```sh
   curl -sS -X PATCH "https://api.supabase.com/v1/projects/<ref>/config/auth" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
     --data @hook.json |
   jq '{hook_before_user_created_enabled, hook_before_user_created_uri, disable_signup}'
   ```

   Tiene que mostrar el hook prendido, la dirección de arriba y `disable_signup: true`.
5. **Probar el hook** desde el panel (*Authentication → Users → Invite user*, que pasa por el hook aunque el
   registro esté cerrado): un correo sin invitación tiene que dar el error "Signups not allowed for this
   email…" y no aparecer en la lista; el de la invitación de prueba tiene que crearse. Si algo falla, se
   apaga con `{"hook_before_user_created_enabled": false}` y el registro sigue cerrado. Desde que el hook
   está prendido, invitar desde el panel pide una invitación en `invitations` antes.
6. **Contraseñas: ya cubierto en la base, y opcionalmente también en el login.** Con el registro abierto
   Supabase no deja apagar el alta con contraseña del proveedor Email. Alguien que sepa un correo invitado
   podría crear esa cuenta con una contraseña suya (`POST /auth/v1/signup` con correo y contraseña: el hook
   la deja pasar porque el correo está invitado); cuando el invitado entra con el código, confirma esa misma
   cuenta, que conserva la contraseña. Por eso la base no acepta sesiones abiertas con contraseña: si el
   token trae en `amr` un `method` `password` (sigue ahí al renovarlo, aunque después haya un segundo
   factor), `workspace_role()` da null, todos los niveles dan 0, no se ve ni `members` ni `grants`,
   `media_whoami` no da dueño y `accept_invitations` responde `session_not_allowed`. La app entra solo con
   código o link (`otp`, `magiclink`, `email/signup`), que no cambian. Esto no depende de ningún hook.
   Además, si se quiere que esas sesiones ni siquiera reciban un token, está el hook *Custom Access Token*
   (gratis) con `private.hook_custom_access_token`: rechaza el ingreso con contraseña y la renovación de una
   sesión que se abrió así, y deja pasar todo lo demás sin tocar los claims. Corre en cada ingreso y en cada
   renovación de todos: si fallara, no entraría nadie. Se conecta igual que el otro, probándolo antes de
   abrir (entrar y salir con código en la app):

   ```json
   {
     "hook_custom_access_token_enabled": true,
     "hook_custom_access_token_uri": "pg-functions://postgres/private/hook_custom_access_token"
   }
   ```

   Se apaga con `{"hook_custom_access_token_enabled": false}`.
7. **Recién ahora, abrir el registro.** `signup.json`:

   ```json
   { "disable_signup": false }
   ```

   ```sh
   curl -sS -X PATCH "https://api.supabase.com/v1/projects/<ref>/config/auth" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
     --data @signup.json |
   jq '{hook_before_user_created_enabled, hook_before_user_created_uri, disable_signup}'
   ```
8. **Probar en la app:** pedir un código con un correo sin invitación (tiene que verse el aviso de pedir una
   invitación y no crearse la cuenta) y con uno invitado (llega el código, entra y la app aplica la
   invitación con `accept_invitations()`).
9. Actualizar esta sección y `login.json` de "Rearmar la configuración" (`disable_signup: false` y los
   campos de los hooks; al rearmar, igual van en `PATCH` separados y en este orden).

Para cerrar de nuevo, al revés: primero `{"disable_signup": true}`, después apagar el hook. Nunca el hook
apagado con el registro abierto.

### Direcciones permitidas

*Authentication → URL Configuration*:

- **Site URL**: `https://shotdocs.lega.com.ar` (`site_url`).
- **Redirect URLs** (`uri_allow_list`, una sola cadena separada por comas):
  - `https://shotdocs.lega.com.ar/**`
  - `https://shotdocs.cold-salad-d599.workers.dev/**` (la dirección del hosting)
  - `http://localhost:5173/**` y `http://localhost:4173/**` (desarrollo y vista previa)
- Un link de login que pide volver a una dirección que no está en la lista termina en la Site URL. Otro
  workspace pone acá sus propias direcciones.

### Sesiones

*Authentication → Sessions* (la duración del token está en la configuración de JWT del proyecto):

- El token de acceso dura **1 hora** (`jwt_exp: 3600`); la app lo renueva sola.
- **Rotación del refresh token** prendida (`refresh_token_rotation_enabled: true`), con **10 segundos**
  para reusar el anterior (`security_refresh_token_reuse_interval: 10`): cubre dos pestañas que renuevan
  a la vez.
- Sin vencimiento de sesión por tiempo ni por inactividad (`sessions_timebox: 0`,
  `sessions_inactivity_timeout: 0`) y con varias sesiones por cuenta (`sessions_single_per_user: false`):
  quien entró sigue adentro en cada dispositivo hasta que sale.

### Límites

*Authentication → Rate Limits* (y *Emails → SMTP Settings* para el último):

| Campo | Valor | Qué limita |
|---|---|---|
| `rate_limit_email_sent` | 30 | Mails por hora, en todo el proyecto. |
| `rate_limit_otp` | 30 | Pedidos de ingreso (mails de código) cada 5 minutos, por IP. |
| `rate_limit_verify` | 30 | Códigos o links verificados cada 5 minutos, por IP. |
| `rate_limit_token_refresh` | 150 | Renovaciones de sesión cada 5 minutos, por IP. |
| `rate_limit_anonymous_users` | 30 | Ingresos anónimos por hora, por IP (están apagados). |
| `rate_limit_sms_sent` | 30 | SMS por hora (no se usan). |
| `rate_limit_web3` | 30 | Ingresos Web3 cada 5 minutos, por IP (no se usan). |
| `smtp_max_frequency` | 60 | Segundos mínimos entre dos mails a la misma dirección: pedir otro código antes da error. |

### Plantillas

*Authentication → Emails → Templates*. Hay dos personalizadas; el HTML está en el repo:

| Plantilla | Asunto (`mailer_subjects_*`) | Cuerpo (`mailer_templates_*_content`) |
|---|---|---|
| *Magic Link* (`magic_link`) | `Your Shot Docs code: {{ .Token }}` | `supabase/templates/magic_link.html`: el código grande y un botón con el link; avisa que los dos vencen en 1 hora y sirven una vez. |
| *Invite* (`invite`) | `You are invited to LGA Shot Docs` | `supabase/templates/invite.html`: la del mail que llega al invitar desde el panel, con un botón para aceptar y crear la cuenta. |

- Las variables `{{ .Token }}` (el código) y `{{ .ConfirmationURL }}` (el link) las completa Supabase.
- Un workspace nuevo preparado con `setup-workspace.mjs` trae además *Confirm signup* con el HTML de
  `magic_link.html` y el asunto del código (hace falta para abrir el registro a invitados); en Wanka todavía no.
- Las demás plantillas quedan como vienen de fábrica, con sus asuntos de fábrica: *Confirm signup*
  (`Confirm your email address`), *Change email* (`Confirm your new email address`), *Reset password*
  (`Reset your password`) y *Reauthentication* (`{{ .Token }} is your verification code`).
- Los avisos de seguridad (correo, contraseña o teléfono cambiados, métodos de ingreso o de verificación
  agregados o quitados) están apagados (`mailer_notifications_*_enabled: false`).

### Correo propio (SMTP)

Sin SMTP propio, Supabase manda unos pocos mails por hora, solo a miembros del proyecto, y no deja cambiar
las plantillas: el mail trae el link pero no el código. Para usar la app hace falta un SMTP. Wanka usa
[Resend](https://resend.com) (gratis hasta 3000 mails por mes):

1. En Resend, agregar el dominio propio (por ejemplo `ejemplo.com`) con el *return-path* `send` y **sin
   seguimiento de clics ni de aperturas** (reescribir los links rompe el de login). Cargar los registros
   DNS que pide (un TXT de DKIM y los de `send`; no tocan el correo que ya tenga el dominio) y esperar a que
   figure como verificado.
2. Crear una API key solo de envío para ese dominio.
3. En Supabase → Authentication → Emails → **SMTP Settings**: host `smtp.resend.com` (`smtp_host`),
   puerto `465` (`smtp_port`), usuario `resend` (`smtp_user`), contraseña = la API key (`smtp_pass`), y
   un remitente del dominio con su nombre (`smtp_admin_email` y `smtp_sender_name`). En Wanka el
   remitente es `shotdocs@lega.com.ar`, con nombre `LGA Shot Docs`. La clave se carga solo ahí: nunca va
   al repo ni a un archivo.
4. Cargar el resto de la configuración (ver "Rearmar la configuración", abajo).

El SMTP de Gmail o Google Workspace también sirve, pero exige verificación en 2 pasos y una contraseña de
aplicación en la cuenta que manda.

### Rearmar la configuración

En un workspace nuevo lo hace `setup-workspace.mjs` ("Preparar un workspace nuevo"), también para rearmarlo:
se vuelve a correr con las mismas opciones. A mano, con un token personal de Supabase (el mismo de las
migraciones), en este orden:

1. **El dueño carga el SMTP completo a mano**, con la contraseña, como dice "Correo propio" (paso 3).
2. **Los valores**, con un `PATCH`. Es un cambio parcial: lo que no va en el JSON no se toca, así que la
   contraseña SMTP del paso 1 queda. Guardar esto como `login.json` (no lleva secretos), con las
   direcciones y el remitente del workspace que se arma:

   ```json
   {
     "site_url": "https://shotdocs.lega.com.ar",
     "uri_allow_list": "https://shotdocs.lega.com.ar/**,https://shotdocs.cold-salad-d599.workers.dev/**,http://localhost:5173/**,http://localhost:4173/**",
     "disable_signup": true,
     "external_email_enabled": true,
     "external_phone_enabled": false,
     "external_anonymous_users_enabled": false,
     "mailer_autoconfirm": false,
     "mailer_allow_unverified_email_sign_ins": false,
     "mailer_secure_email_change_enabled": true,
     "mailer_notifications_email_changed_enabled": false,
     "mailer_notifications_identity_linked_enabled": false,
     "mailer_notifications_identity_unlinked_enabled": false,
     "mailer_notifications_mfa_factor_enrolled_enabled": false,
     "mailer_notifications_mfa_factor_unenrolled_enabled": false,
     "mailer_notifications_password_changed_enabled": false,
     "mailer_notifications_phone_changed_enabled": false,
     "mfa_totp_enroll_enabled": true,
     "mfa_totp_verify_enabled": true,
     "mfa_phone_enroll_enabled": false,
     "mfa_phone_verify_enabled": false,
     "mfa_web_authn_enroll_enabled": false,
     "mfa_web_authn_verify_enabled": false,
     "password_min_length": 6,
     "sessions_timebox": 0,
     "sessions_inactivity_timeout": 0,
     "sessions_single_per_user": false,
     "mailer_otp_length": 8,
     "mailer_otp_exp": 3600,
     "jwt_exp": 3600,
     "refresh_token_rotation_enabled": true,
     "security_refresh_token_reuse_interval": 10,
     "rate_limit_email_sent": 30,
     "rate_limit_otp": 30,
     "rate_limit_verify": 30,
     "rate_limit_token_refresh": 150,
     "smtp_host": "smtp.resend.com",
     "smtp_port": "465",
     "smtp_user": "resend",
     "smtp_admin_email": "shotdocs@lega.com.ar",
     "smtp_sender_name": "LGA Shot Docs",
     "smtp_max_frequency": 60,
     "mailer_subjects_magic_link": "Your Shot Docs code: {{ .Token }}",
     "mailer_subjects_invite": "You are invited to LGA Shot Docs"
   }
   ```

   ```sh
   curl -sS -X PATCH "https://api.supabase.com/v1/projects/<ref>/config/auth" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
     --data @login.json
   ```

   Los otros proveedores ya vienen apagados en un proyecto nuevo; si no, se suman al JSON con `false`.
3. **Las plantillas**, leyendo los HTML del repo:

   ```sh
   jq -n --rawfile magic supabase/templates/magic_link.html --rawfile invite supabase/templates/invite.html \
     '{mailer_templates_magic_link_content: $magic, mailer_templates_invite_content: $invite}' |
   curl -sS -X PATCH "https://api.supabase.com/v1/projects/<ref>/config/auth" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data @-
   ```
4. **Control**: leer la configuración y mirar solo algunos campos. La respuesta del `GET` trae secretos
   (entre ellos la contraseña SMTP): siempre filtrada, nunca guardada entera ni pegada en ningún lado.

   ```sh
   curl -sS "https://api.supabase.com/v1/projects/<ref>/config/auth" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" |
   jq '{site_url, uri_allow_list, disable_signup, mailer_otp_length, mailer_otp_exp, rate_limit_email_sent, smtp_host, smtp_admin_email}'
   ```
5. Probar: pedir un código con una cuenta invitada, ver que llega con el asunto y el código de 8 dígitos,
   y que un correo sin cuenta recibe el aviso de pedir una invitación.

**Nunca `supabase config push` contra Wanka.** Ese comando sube la configuración de login de un
`supabase/config.toml` al proyecto y pisa lo que haya: se llevaría el SMTP (y su contraseña), las
plantillas y el registro cerrado. El repo no tiene `config.toml` a propósito; si alguna vez se escribe
uno, es solo de referencia.
