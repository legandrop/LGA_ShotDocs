# Supabase

Cómo está armado el backend y cómo se prepara un proyecto nuevo. Un workspace nuevo se prepara con el
comando `scripts/setup-workspace.mjs` ("Preparar un workspace nuevo", abajo), siguiendo la guía para
usuarios `Guide_Create_Workspace.md` (en inglés); lo que sigue explica qué hace y cómo rearmarlo a mano.

## Proyecto

- Al crearlo: **Data API** activada, **"expose new tables" desactivado** (cada migración da sus permisos a
  mano) y **RLS automático** activado.
- **CORS:** el navegador manda en cada pedido a la base el header `x-shotdocs-version` (la versión de la app, B.17).
  El proyecto de Supabase acepta cualquier header pedido; una base autohospedada (o una Edge Function, que escribe su
  propio CORS) tiene que aceptar `x-shotdocs-version`: si no, el navegador corta todos los pedidos de la app. Con un
  link público (`Doc_Link_Publico.md`) van además `x-shotdocs-link` y `x-shotdocs-device`, también a Storage.
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
| `20260930170000_comentarios.sql` | Paso 10 de `Plan_Workspaces.md`: los comentarios, en una tabla propia y no dentro del documento. Tabla `comments` (id creado en el dispositivo, página, `block_id` del bloque de BlockNote al que se ancla o nada para la página entera, `thread_id` del primer comentario del hilo en las respuestas, que tiene que ser de la misma página y les da su bloque, texto de 1 a 10000 caracteres, autor, `edited_at`, `resolved_at`/`resolved_by` en el primer comentario del hilo, `deleted_at`/`deleted_by` y `updated_at`, el último cambio, con índice por página). Se ven los de las páginas que se ven (`page_level >= 1`); desde la API la tabla se lee sin la columna `body`. La app los lee con `list_comments(página, desde)`, que calcula el permiso una sola vez (500 comentarios: unos 2 ms, contra 800 ms de la vista), da el texto vacío si el comentario se borró y, con una fecha, solo lo cambiado desde entonces (la app pide desde el último `updated_at` que tiene menos un margen); `page_not_found` si no ve la página. La vista `comments_view` (con los permisos de quien consulta) da lo mismo y queda para compatibilidad. Borrar marca y el texto queda en la base. Se escribe solo con funciones: `add_comment` (pide comentar; reintentar con el mismo id y el mismo contenido no hace nada, con otro es `comment_conflict`; el reintento se reconoce antes de mirar el permiso, así que da bien aunque después le hayan bajado el permiso o la hayan sacado), `edit_comment` (solo quien lo escribió; el mismo texto, igual), `delete_comment` (quien lo escribió o quien tiene editar y crear páginas; el reintento de un borrado propio, igual), `resolve_thread` (comentar; abre o resuelve el hilo) y `comment_authors` (id y correo de quienes escribieron, resolvieron o borraron comentarios en una página, a quien la ve: los invitados ven los nombres y correos del equipo, decisión de Lega). Los invitados no tienen reglas propias: valen los permisos por página del paso 9. `schema_version` pasa a 5. |
| `20260930180000_papelera_archivos.sql` | Paso 11 de `Plan_Workspaces.md` (la base): la papelera de archivos. Un archivo entra a la papelera (`files.trashed_at`, la fecha en que entró) cuando ninguna página viva lo usa (una página en la papelera de páginas, o adentro de una, no cuenta) y sale si vuelve a usarse; lo recalcula `private.refresh_file_trash` desde triggers de `page_files` y de `pages` (entrar o salir de la papelera, moverse). Dejar de usar un archivo es marcar su fila de `page_files` con `removed_at` (columna nueva) con `unlink_page_file(p_page_id, p_file_id, p_seen_seq)` (pide editar la página; la app la llama cuando un bloque `sdmedia://` desaparece de la página, con el `update_seq` del contenido que tenía: si el servidor ya tiene contenido más nuevo, no marca nada y devuelve false para que el dispositivo vuelva a comparar; sin `p_seen_seq`, marca siempre y devuelve true); `link_page_file` y `register_file` la reactivan y ahora devuelven `'ok'`. Un archivo de otro proyecto que la sesión ve, en una página que edita (una foto cortada de un proyecto y pegada en otro): `link_page_file` y `register_file` guardan el uso marcado `page_files.is_foreign` y devuelven el texto `'file_other_project'` sin error (con error, la fila se desharía en el mismo pedido); si no lo ve, el error de siempre y nada guardado. El uso de afuera cuenta para la papelera (mientras una página viva lo use no entra, y `purge_file` responde `file_not_trashed`) pero no da permisos: `file_level` y `can_view_file` no lo cuentan, y la fila solo la ve quien ve el archivo. `trashed_files(p_project)`: lo que está en la papelera del proyecto (id, nombre, tipo, peso, `thumb_at`, `trashed_at`, `days_left` para los 30 días, `purged_at`, e `in_trashed_page` con `trashed_page_title` si lo usa una página que está en la papelera de páginas, también de otro proyecto: restaurarla lo saca; el título solo si la sesión ve esa página), para quien tiene editar y crear páginas sobre el proyecto entero y para el dueño y los admins con algún permiso sobre el proyecto entero. `purge_file` (solo dueño y admins con permiso sobre el proyecto, solo si está en la papelera) marca `purged_at`/`purged_by` sin borrar nada; el portero lo manda a la papelera de Drive y lo confirma con `media_purged` (`drive_trashed_at`; la puede llamar también quien edita el archivo, para cuando la subida termina después de pedirlo). Pedirlo es definitivo para la app: un archivo con `purged_at` ya no sale de la papelera aunque se vuelva a usar. `media_file` suma `trashed_at`, `purged_at` y `drive_trashed_at` sin sacar nada. Borrado automático a los 30 días armado y **apagado**: `workspace_settings.auto_purge_files` (`false`) y `files_due_for_purge(p_project)`, que no devuelve nada mientras esté apagado y nunca devuelve los que usa una página en la papelera de páginas (quedan para mandarlos a mano). Nada borra filas. `schema_version` pasa a 6. |
| `20260930190000_peso_proyectos.sql` | P.7 del roadmap (`Doc_Peso_Proyectos.md`): cuánto ocupa cada proyecto en el Drive. Solo agrega `project_sizes()` (security definer, `search_path` vacío, sin `anon`): una fila por proyecto cuya papelera de archivos ve la sesión (`private.can_see_file_trash`, calculada una vez por proyecto en un CTE materializado), también los que no tienen archivos (en cero), con `drive_bytes/files` (el número principal: en uso más lo subido de la papelera de la app), `trash_bytes/files` (la papelera de la app: el mismo conjunto que `trashed_files`), `drive_trash_bytes/files` (en la papelera de Drive, subido, con `greatest(drive_trashed_at, uploaded_at)` de hace menos de 30 días) y `pending_bytes/files` (registrado y sin subir). Cada archivo cuenta en un solo estado, en ese orden: papelera de Drive (o nada, si pasaron 30 días o nunca se subió), papelera de la app, sin subir, en uso. Suma `files.size` por `files.project_id`, sin unir con `page_files` (un uso de otro proyecto no cuenta dos veces). Solo al dueño (`workspace_role() = 'owner'`, así que no con una sesión de contraseña), una fila más con `project_id` nulo: el total de los proyectos cuya papelera no ve, sin nombres. No cambia ninguna fila; la app publicada no la llama. `schema_version` pasa a 7. |
| `20260930200000_comentarios_importados.sql` | Comentarios importados de otra herramienta (hoy, Coda; `Doc_Importar_Coda.md`, "3. Comentarios"), también de personas sin cuenta en la app. `comments` suma `imported_from` (solo `'coda'`), `imported_author` y `imported_author_email` (el nombre y el correo que da la herramienta; con ellos, `author_id` va nulo) e `imported_by` (quien importó), con restricciones que los atan. `import_comment(id, página, bloque, hilo, texto, fecha original, resuelto, origen, nombre, correo)` pide editar y crear páginas (4) en la página (`import_denied`), guarda la fecha original en `created_at` (desde 2000 y no futura: `created_invalid`) y la de la importación en `updated_at`, acepta el hilo resuelto (sin quién; en una respuesta o fuera de fecha, `resolved_invalid`), con nombre nulo lo deja a nombre de quien importa, y es idempotente por id como `add_comment`; el mismo comentario importado de nuevo por la misma persona con otro bloque pasa el hilo (y sus respuestas) a ese bloque, y otra fecha, otro autor u otra persona es `comment_conflict`. `list_comments` (se borra y se crea de nuevo: cambia lo que devuelve) y `comments_view` suman las cuatro columnas al final, y `comment_authors` suma a quien importó; quien ve la página ve el nombre y el correo importados. Un importado de afuera no lo edita nadie y lo borra quien tiene 4. La app publicada ignora las columnas nuevas y lo muestra como de una cuenta borrada. `schema_version` pasa a 8. |
| `20261007120000_historial.sql` | **Aplicada (2026-10-01, v0.098).** El historial de versiones (P.18, `Doc_Historial.md`): `page_history(page, after_seq, limit)` (las filas de `page_updates` con autor y hora) y `page_history_authors(page)` (los correos), solo con nivel 3 o más, sin ser invitado y fuera de la papelera (`private.check_history`); el autor y la hora ya no se leen directo de la tabla (`authenticated` lee solo las columnas del contenido). Sube `schema_version` a 11 (`HISTORY_SCHEMA_VERSION`). |
| `20261006120000_version_minima_archivos.sql` | La versión mínima de la app también frena la cola de archivos (v0.090): `register_file`, `link_page_file` y `unlink_page_file` con `p_app_version` (la misma regla que el contenido), y las de siempre, que llaman solo las versiones anteriores, dejan de andar cuando la mínima es 0.090 o más (`private.files_version_allowed`). No sube `schema_version`. Ver `Doc_Sincronizacion.md`, "La versión mínima y los archivos". |
| `20261008120000_version_minima_arbol.sql` | **Aplicada (2026-10-02, v0.099).** La versión mínima también frena el árbol y los comentarios (B.17, v0.099): la app manda su versión en el header `x-shotdocs-version` y dos políticas restrictivas (insert y update) en `pages` y `workspaces`, un trigger en `comments` y adentro `set_project_archived`, `delete_project` y `restore_project` (mismas firmas) la comparan con la mínima (`private.require_write_version`); sin header, rechazan solo con la mínima en 0.099 o más (el número real lo pone quien publica). El rechazo es un 503 `app_outdated` (`raise sqlstate 'PGRST'`), que todas las versiones reintentan. No sube `schema_version`. Ver `Doc_Sincronizacion.md`, "La versión mínima, el árbol y los comentarios". |
| `20261011120000_versiones_con_nombre.sql` | **Aplicada el 2026-10-02** (v0.106; P.18, entrega 3; `Doc_Historial.md`). Las versiones con nombre: la tabla `page_versions` (un nombre, `kind = 'named'`, o la marca de una restauración, `kind = 'restore'` con `restored_from_seq`, que apunta a una fila de `page_updates` por su `seq` y guarda su `id` en `update_id`; sin contenido; `removed_at`/`removed_by` en vez de borrar), sin acceso directo desde la API (RLS sin políticas y `revoke all`). Funciones, todas con `private.check_history` (nivel 3, no invitado, ni la página ni una de arriba en la papelera): `list_page_versions(page)` (solo las vigentes cuya fila sigue teniendo ese `id`: después de restaurar una copia de seguridad, un `seq` reusado no hereda el nombre), `name_page_version(id, page, seq, label)` (id del dispositivo, idempotente; `version_conflict`, `version_named` si ya tiene nombre, `version_not_found`, `label_invalid`), `rename_page_version(id, label)` y `remove_page_version(id)` (quien lo puso o nivel 4 sobre la página; `not_allowed`; una marca de restauración, `version_not_named`), y `mark_page_restored(id, page, seq, from_seq)` (solo sobre una fila que subió quien llama). Las cuatro que escriben miran la versión mínima (`private.require_session_write_version`) antes de escribir. Sube `schema_version` a 13 (`NAMED_VERSIONS_SCHEMA_VERSION`; después de `20261010120000_privacidad_borrado.sql`, la 12). No toca `page_updates` ni las funciones de siempre. |
| `20261014120000_asistente_politica.sql` | **Sin aplicar** (A1 del asistente, v0.118; `Doc_Asistente.md`, 7.3). `workspace_settings.assistant_policy` (`on` de fábrica, `local_only` u `off`, con su `check`): la política del dueño sobre el asistente. La app la lee con el resto de la fila y sin la columna toma `on`; nadie la escribe desde la API (se cambia desde el SQL Editor hasta la ventana de A2). En la app es una regla, no una barrera; el MCP la va a mirar dentro de sus funciones. No sube `schema_version` (la app no necesita saber si está). Fechada después de las del link público y las menciones (en otras ramas): quien publica la renumera si hace falta. |
| `20261012120000_link_publico.sql` | **Sin aplicar** (v0.114; P.19, entregas 0 y 1; `Doc_Link_Publico.md`). El link público *Anyone with the link* con *Can view* (que comenta), sin cuenta: `public_links` (token `sdl_` + 43, buscado por su huella SHA-256; uno vivo por página; `revoked_at` en vez de borrar), `public_link_usage` y `public_link_usage_all` (cantidad y bytes por día), `private.db_guard` y `workspace_settings.link_limits` (vacío: los topes de `private.plink_limit`); `comments.plink_id`, `plink_author` y `plink_device_hash`. El visitante usa el rol `anon` con el header `x-shotdocs-link` (y `x-shotdocs-device`): `private.current_plink` lo valida en cada pedido (existe, no revocado ni vencido, y quien lo creó todavía puede compartir: `private.user_can_share_page`, la regla única que ahora llama `can_share`, que además nunca deja a un invitado) y `private.plink_page_level` da 2 solo en su página y lo de abajo, fuera de la papelera. Funciones del visitante (solo `anon`, `VOLATILE` las que cuentan): `plink_open`, `plink_tree` (columnas cerradas, el id del link en lugar del proyecto, sin cambios no devuelve ni cuenta), `plink_pull_page` (solo la base limpia de D14, nunca filas), `plink_media_files`, `plink_media_file` (el portero), `plink_list_comments` (sin correos ni ids) y `plink_add_comment` / `plink_edit_comment` / `plink_delete_comment` (con nombre; los propios por dispositivo; nunca resolver). Topes de cantidad y bytes por link, por día, de todos los links, del mes y de por vida, y la guarda del tamaño de todas las bases (350 MB) para todo lo que escribe un link. Quien comparte: `create_public_link` (pide el interruptor de D14: `clean_off`, D33; reinicia la rama), `set_public_link`, `reset_public_link`, `revoke_public_link`, `get_public_link`, `public_link_pages` y `delete_public_link_comments`. La política `thumbs_select_link` (anon, solo con el header y las miniaturas de la rama; `usage` de `private` y `execute` solo de `plink_token` y `plink_thumbs`). `remove_member` revoca los links de quien se va; `has_plain_readers` y `clean_work` cuentan los links; `list_comments` y `comments_view` suman `plink_id` y `plink_author` al final; `rls_auto_enable` sin `execute` para `anon`. Sube `schema_version` a 14 (`LINK_SCHEMA_VERSION`). |
| `20261015120000_menciones.sql` | **Sin aplicar** (v0.120; P.21, entrega 1; `Doc_Menciones.md`). Las menciones en comentarios: la tabla `comment_mentions` (una fila por comentario y persona, con el rótulo; `removed_at` y `read_at`, nada se borra; sin acceso desde la API), la regla `private.mention_allowed` (miembro activo que ve la página; un miembro a un invitado solo si ya participa; un invitado solo a quien participa, le compartió algo o lo invitó), `mention_candidates`, `set_comment_mentions` (el conjunto entero, idempotente, descarta sin error a quien no pasa la regla, mira la versión mínima), `mentions_inbox` (sin leer contadas hasta 10, lo cambiado desde una fecha; lo que ya no se ve llega solo con `id`, `gone` y `updated_at`), `mentions_index` y `mark_mentions_read`. `list_comments` y `comments_view` (por `private.comment_mentions_json`) suman `mentions` al final y `comment_authors`, a las mencionadas. `schema_version` 15. |
| `20261016120000_menciones_e2.sql` | **Sin aplicar** (v0.125; P.21, entrega 2, ME2; `Doc_Menciones.md`). `mention_candidates` suma las filas `has_access = false` (miembros activos que no ven la página) solo para el dueño y los admins que pueden compartirla, fuera de la papelera. `share_for_mention(página, persona)`: con esa misma condición, comparte con Comentar solo esa página (por `public.share`, con el reinicio de la privacidad de lo borrado); a quien ya la ve no le cambia nada (`{"shared": false}`); `page_in_trash`, `not_allowed`, `member_not_found`. `schema_version` 16. |
| `20261009120000_papelera_lectores.sql` | **Aplicada (2026-10-02, v0.102).** La papelera de páginas ya no se lee con Ver: `private.user_page_level` da 0 sobre una página en la papelera (o que cuelga de una) a quien tiene menos de 3 y a los invitados, y la política de lectura de `pages` (`can_view_page_row`, que con un permiso sobre el proyecto entero dejaba ver cualquier fila) aplica la misma regla. Las dos pasan a PL/pgSQL con una sola pasada por la cadena de padres (más rápidas que antes). No cambia firmas ni sube `schema_version`. Ver "La papelera de páginas y quién la ve". |

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
  sin la columna `body` (pedirla, o `*`, da error): la app lee los comentarios con `list_comments`, que da el
  texto salvo en los borrados (`comments_view` da lo mismo, más lento, y queda para compatibilidad).
- `page_updates` solo se escribe con `push_page_update()`. Cada update tiene un `seq` correlativo por
  página, asignado con la fila de la página bloqueada: bajar "lo posterior a `seq` N" nunca se saltea nada.
- Las funciones auxiliares de permisos viven en el esquema `private`, que la API no expone.
- Cada migración que crea una tabla hace `revoke all` sobre ella y da solo los permisos que hacen falta.
- `workspace_settings` se cambia solo desde el SQL Editor (o la Management API), nunca desde la app:
  `update public.workspace_settings set min_app_version = 0.021;` pide esa versión o más para subir
  contenido y, desde la migración de v0.090, para registrar archivos y mandar sus usos (las versiones anteriores
  a 0.090 quedan frenadas solo con una mínima de 0.090 o más); `set generation = …` después de restaurar una copia (lo hace el script de restauración);
  `set media_url = 'https://…'` cuando se publica el portero; `set auto_purge_files = true` prende el borrado
  automático de la papelera de archivos a los 30 días (apagado hasta que Lega lo confirme; ver el paso 11 de
  `Plan_Workspaces.md`).

### La papelera de páginas y quién la ve

Una página en la papelera, o que cuelga de una que está, la ven **solo quienes pueden editarla (nivel 3 o 4) sin ser
invitados**, el dueño del proyecto incluido: así la encuentran en la Papelera (restaurar sigue pidiendo 4). Ver,
Comentar y los invitados (con cualquier nivel) no reciben nada de ella por ningún camino: la fila de `pages`, el
contenido, los comentarios, los archivos que solo usa ella, las miniaturas ni el portero. Restaurarla devuelve todo
(no se toca ningún permiso). Decisión del 2026-10-02 (migración `20261009120000_papelera_lectores.sql`); antes la
regla miraba solo si el proyecto estaba borrado y un cliente bajaba, por ejemplo, una nota interna que se mandó a la
papelera antes de compartirle la rama.

- **En la app:** la página sale del árbol del lector en la próxima sincronización, como cuando le sacan un permiso,
  sin errores. Lo que tenía sin subir no se pierde en silencio: un comentario queda rechazado con su texto
  (*The page is not on the server, or you can no longer see it.*) y el contenido de una invitada con Editar queda
  rechazado en el dispositivo (se puede bajar como archivo); restaurada la página, "reintentar" los sube
  (`src/sync/trashReaders.test.ts`).
- **Mandar a la papelera** sigue pidiendo 4, también a una invitada, que después deja de verla y no la puede
  restaurar (lo hace el dueño o quien edita y crea sin ser invitado).
- **Lo que no cubre:** lo que el dispositivo del lector ya había bajado sigue en su IndexedDB (la app no lo
  muestra: la búsqueda y la barra miran el árbol); un pase del portero ya entregado sirve hasta que vence (8 horas,
  igual que al sacar un permiso); el nombre del proyecto se sigue viendo; quien subió un archivo lo sigue viendo
  mientras pueda editar alguna página del proyecto.
- **Rendimiento** (base real, en una transacción deshecha, `explain analyze`, tres corridas): leer las 735 filas
  del árbol como dueño pasó de ~395 ms a ~107 ms; 700 filas de un proyecto como lector con Ver, de ~490 ms a
  ~125 ms; los comentarios de un proyecto como lector, de ~53 ms a ~14 ms; `page_level` de una hoja a 60 niveles,
  2 ms igual. La regla nueva necesita mirar los padres en cada fila, pero las dos funciones pasaron de SQL a
  PL/pgSQL (Postgres 17 vuelve a planificar en cada llamada una función SQL que no se puede expandir; PL/pgSQL guarda
  el plan en la sesión) y juntan permisos y papelera en una sola consulta.

### Lo borrado y quién lo recibe (bases limpias)

Migración `20261010120000_privacidad_borrado.sql` (aplicada el 2026-10-02, interruptor apagado; diseño y cómo quedó en `Doc_Privacidad_Borrado.md`).
Recibe lo borrado de una página quien ve su historial (`private.sees_deleted`: nivel 3 o más y no invitado). Con el
interruptor `workspace_settings.clean_min_version` prendido, a los demás (Ver, Comentar, invitados) `pull_page_updates`
les da solo la **base limpia** vigente (`page_clean_bases`, una por página, la arma y sube un editor con
`push_clean_base`; `clean_work` dice cuáles), o nada si no hay; apagado (`null`, como queda la migración), todos bajan
filas como siempre. `share`, `create_invitation` (con Ver, Comentar o a un invitado) y mover una página a una rama con
lectores ponen `clean_reset_seq = update_seq`: una base de antes no se sirve ni se acepta.

Valen desde que se aplica, con el interruptor apagado: la columna `update` de `page_updates` no se lee directo desde la
API (nadie: la app baja por funciones); un uso sacado de un archivo (`page_files.removed_at`) no da permiso a quien no
ve lo borrado de esa página (`can_view_file`, `file_level`, la política de `page_files`, y con ellas `files`, `thumbs`
y el portero); la papelera de archivos (`trashed_files`) no responde a invitados.

- **Prenderlo:** el script de restaurar del repo de copias tiene que vaciar `page_clean_bases` y dejar `clean_seq` en
  0 y `clean_reset_seq` en el `update_seq` restaurado; `min_app_version` en la versión que trae las bases; copia de
  seguridad; y `update public.workspace_settings set clean_min_version = <esa versión> where id`. El `check`
  `workspace_settings_clean_min_le_min_app` no deja prenderlo por encima de `min_app_version` (ni sin ella), ni bajar la
  mínima por debajo de él.
- **`clean_work`** junta solo páginas vivas de proyectos vivos alcanzadas por un permiso de lector, de los proyectos
  donde la sesión edita algo, y mira cada una (`sees_deleted`, `has_plain_readers`) antes de contarla en las 50.
- **Apagarlo** (`clean_min_version = null`) vuelve a servir filas a todos. No se borra nada en ningún sentido: las
  bases son copias derivadas.
- **Pruebas:** `supabase/tests/privacidad_borrado_permisos.sql` (corrida en `begin … rollback`).

### Compactar: los snapshots

Migración `20261019120000_compactar_leer.sql` (entrega 1 de `Doc_Compactar.md`; sin aplicar, `schema_version` 17).
Deja los snapshots **apagados** (`workspace_settings.snapshot_min_version` nulo): apagados, `pull_page_content` es
`pull_page_updates` con la época de la página, y nadie arma nada. No toca `page_updates`, `push_page_update` ni
`pull_page_updates`.

- `page_snapshots` (el contenido hasta `up_to_seq` en un solo update) y `page_compaction` (la reserva y el salteo): sin
  políticas ni permisos, todo por funciones. `pages.snapshot_seq` y `pages.content_epoch` se leen con el árbol.
- Un snapshot se sirve solo confirmado, no invalidado, con su fila final con el mismo `id`, sin pasar de `update_seq`,
  con su cadena de una versión permitida (`chain_min_version >= snapshot_min_version`) y **solo a quien ve lo
  borrado** (`private.sees_deleted`).
- **Invalidar a mano** un snapshot que salió mal (toda su cadena; los dispositivos que lo usaron vuelven a bajar la
  página): `select public.invalidate_page_snapshot('<id>', '<motivo>')` con una sesión que edita la página, o desde el
  SQL Editor `select private.invalidate_snapshot_chain(page_id, chain_id, '<motivo>') from public.page_snapshots where
  id = '<id>'`. **Apagar todo:** `snapshot_min_version = null`.
- **Prenderlos** (entrega 3): el script de restaurar del repo de copias tiene que vaciar `page_snapshots` y
  `page_compaction`, dejar `snapshot_seq` en 0 y no hacer volver atrás `content_epoch`; recién ahí
  `update public.workspace_settings set snapshot_min_version = <versión> where id`.
- **Pruebas:** `supabase/tests/snapshots_permisos.sql` (corrida en `begin … rollback`).
- **Entrega 2** (`20261020120000_compactar_crear.sql`, aplicada en v0.133, no sube `schema_version`): la app arma los
  snapshots con las mismas funciones; la migración solo hace que `invalidate_page_snapshot` pida ver lo borrado
  (`sees_deleted`), como las demás: un invitado con Editar ya no invalida. Invalidar a mano sigue igual, con una sesión
  que ve lo borrado o desde el SQL Editor.

### La clave del asistente sincronizada (`assistant_key_sync`)

- `20261023120000_clave_sincronizada.sql` (entrega S1 de `Doc_Clave_Sincronizada.md`; sin aplicar, la aplica quien
  publica; **no sube `schema_version`**): una fila por persona con el bloque cifrado en el dispositivo (versión, sal, iv
  y cifrado, de largos fijos). La lee, la crea, la cambia y la borra solo la persona, con una sesión de la app (sin
  contraseña) y sin `client_id` en el token; el id lo pone la base y `generation` la sube un trigger. Fuera de Realtime.
  El dueño la ve desde el panel de Supabase (es su base), cifrada.
- Sin la migración, la app dice *This workspace's database needs an update to sync your key.* y la clave local sigue.
- **Pruebas:** `supabase/tests/clave_sincronizada_permisos.sql` (corrida en `begin … rollback`).

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
| `archivos_permisos.sql` | Archivos: el dueño de un proyecto registra un archivo y lo ve; reintentar `register_file`, `link_page_file` y `set_file_drive` no cambia nada, y un id en Drive ya puesto no se cambia; entre proyectos, `link_page_file` y `register_file` no cambian el proyecto del archivo (guardan un uso de afuera y devuelven `'file_other_project'`); `media_file` da el json esperado al dueño y nada a quien no ve el archivo; otro usuario no ve, registra ni linkea los archivos ajenos; los permisos por página (ver, editar) y el piso de quien creó el archivo, que se pierde al dejar de editar el proyecto o al ser sacado; datos con forma inválida; nadie escribe ni borra en `files` y `page_files` desde la API; el bucket `thumbs`: nombres válidos, subir solo con permiso de edición, leer con permiso de ver, sin cambiar ni borrar, y sin sesión nada. |
| `equipo_permisos.sql` | Equipo: cada nivel sobre una página (ver y bajar; comentar; editar: contenido, título, ícono, ajustes, imágenes y archivos; editar y crear páginas: crear adentro, mover, papelera y restaurar), hacia abajo sí y hacia arriba no, y gana el más alto; mover entre ramas pide permiso en las dos (y reordenar, en el padre) y no arma ciclos; los roles: el dueño y los admins crean proyectos privados, nadie ve los privados de otros (tampoco el dueño), un miembro o una invitada no crean proyectos, quien tiene editar y crear sobre un proyecto lo renombra; `ensure_workspace` en cada caso; invitaciones (correo en minúsculas, solo el dueño invita admins, permisos solo sobre lo que quien invita tiene con 4, quien la hizo suma a la suya sin cambiar `invited_by`, nadie toca una ajena, `list_invitations` da solo las vivas, `revoke_invitation` la marca y la puede hacer el dueño o quien la hizo) y `accept_invitations` (con el correo verificado; no baja un rol ni cambia al dueño; saltea los permisos sobre lo que quien invitó ya no tiene con 4; alguien sacado vuelve sin sus permisos de antes, que quedan marcados); el hook acepta a los invitados y rechaza con `{"error": {"http_code": 403, "message"}}` al resto (sin invitación, vencida, usada, revocada, de una admin sacada, sin correo); el hook de token deja pasar código, link y renovaciones y rechaza la contraseña; `supabase_auth_admin` ejecuta solo los dos hooks y ninguna tabla; una sesión con contraseña (también con un segundo factor) no ve ni puede nada, y con código o link todo sigue igual; `list_members`, `set_member_role`, `share`, `unshare` (marca, y compartir de nuevo lo reactiva) y `list_access` con sus reglas; sacar a alguien (pierde todo al instante, su proyecto compartido pasa a la admin con `edit_pages` sobre el proyecto, los que solo tienen permisos sobre páginas sueltas quedan sin heredero y se informan (la dueña con "ver" sobre una página no hereda), el privado no lo ve nadie y nada se borra); nadie escribe en `members`, `grants` ni `invitations` desde la API, y sin sesión nada. |
| `comentarios_permisos.sql` | Comentarios: ver y comentar según el nivel sobre la página (ver no comenta ni resuelve; comentar, editar y editar y crear sí), hacia abajo sí y hacia arriba no; hilos (la respuesta toma el bloque del hilo; en otra página, a una respuesta, a un hilo que no existe o en otro bloque, rechazado); texto y bloque con forma inválida; reintentar el alta no duplica ni cambia nada y con otro contenido, en otra página o de otra persona es `comment_conflict`; los reintentos exactos de un alta, una edición o un borrado propios dan bien con el permiso ya bajado (o después de que la saquen) y los que no son exactos no; editar solo el autor (el mismo texto no cambia `edited_at`, un borrado no se edita, el autor que pasa a ver no edita ni borra); borrar el autor o quien tiene editar y crear, dos veces no cambia nada y el texto queda en la base pero la vista no lo da; resolver y volver a abrir; alguien sacado no ve ni escribe, tampoco lo suyo; una invitada con comentar ve solo lo compartido, comenta, responde y resuelve pero no edita la página ni sube archivos, y con editar sube archivos pero no crea páginas; `comment_authors` da a la invitada los correos de quienes aparecen en esa página y nada de otras; `list_comments` da lo mismo que la vista más `updated_at`, y con una fecha solo el alta, la edición, el borrado o el cambio de resuelto posteriores (lo que no cambia no toca `updated_at`); una sesión abierta con contraseña no ve ni comenta; nadie escribe directo en `comments` ni en `comments_view`, ni lee el texto en la tabla, y sin sesión nada (tampoco `list_comments` ni `private.comment_body`). |
| `papelera_archivos_permisos.sql` | Papelera de archivos: un archivo entra al dejar de usarse en su única página y sale al volver a usarse (`link_page_file` y `register_file` reactivan el uso), también al mandar a la papelera la página (o una de arriba) y restaurarla, y al mover la página adentro o afuera de una que está en la papelera; un archivo que otra página viva usa no entra; la fecha de entrada no cambia mientras sigue adentro; `unlink_page_file` pide editar y reintentarlo no cambia nada, y uno viejo (con un `p_seen_seq` menor que el `update_seq` de la página) devuelve false y no marca nada; `trashed_files` dice si lo usa una página en la papelera de páginas y su título (un uso marcado no cuenta); un archivo cortado de un proyecto y pegado en otro: el uso de afuera queda marcado, no deja entrar el archivo a la papelera mientras esa página viva lo use (ni mandarlo a Drive, tampoco a una admin sin acceso a ese proyecto), entra si esa página va a la papelera de páginas (sin mostrarle el título a quien no la ve y fuera de los vencidos), `unlink_page_file` lo marca y volver a pegarlo lo saca; quien solo edita la página de afuera no ve el archivo, la fila, la miniatura ni `media_file`, y no puede linkearlo, registrarlo ni mandarlo; la papelera la ven la dueña, la admin con permiso sobre el proyecto y el miembro con editar y crear páginas, y no el miembro con editar, la invitada, la admin sin permiso sobre ese proyecto privado ni la sacada; `files_due_for_purge` vacío con el interruptor apagado (y que la app no lo prende) y, prendido, sin los que usa una página en la papelera de páginas; mandar a Drive solo la dueña y las admins, nunca algo en uso, confirmar también quien edita (no quien solo ve), pedirlo y confirmarlo dos veces no cambia nada, lo pedido no sale aunque se vuelva a usar y lo confirmado sale de la lista; ninguna fila de `files` ni de `page_files` se borra; nadie escribe el estado directo; sin sesión nada. |
| `peso_proyectos_permisos.sql` | Peso de los proyectos (`project_sizes`): con un archivo en cada estado (en uso, en uso y además en otro proyecto, en la papelera de la app subido y pedido a Drive sin subir, en la papelera de Drive hoy, hace 40 días y sin haberse subido, subido después de ir a la papelera de Drive, sin subir), que cada uno cuente en su lugar y el uso de afuera no sume dos veces; un proyecto sin archivos en cero; que la papelera de la app coincida con `trashed_files`; las sumas son `bigint` (un archivo de 5 GB); ven el peso la dueña, la admin con ver y el miembro con editar y crear páginas, y no el miembro con editar, la invitada, la sacada ni la dueña con una sesión de contraseña; la admin sin permiso sobre el proyecto ve solo los suyos; la fila sin proyecto solo para la dueña, con un proyecto privado de otra y uno donde ella tiene permiso solo sobre una página (sumados a lo que ya había en la base); sin sesión nada; llamarla no cambia ninguna fila; la dueña sigue viendo y editando todo. |
| `proyectos_borrar_permisos.sql` | Archivar y borrar proyectos (P.14, `Doc_Proyectos_Borrar.md`): quién archiva, borra y restaura (quien comparte el proyecto entero; el miembro con editar y crear, la admin con ver, la invitada y la sacada no; la admin sin permiso ni se entera de que existe); archivar no cambia permisos y `ensure_workspace` prefiere los no archivados (también uno compartido a uno propio archivado); con el proyecto borrado nadie lo ve ni lo escribe por ningún camino, también su creadora (niveles, filas, contenido, comentarios, archivos, buckets y portero en 0, para seis personas, y de vuelta iguales al restaurar); la papelera de archivos y el peso mientras tanto; un archivo de otro proyecto usado solo en el borrado no se manda a Drive (`file_in_deleted_project`); la ventana da los mismos números con el proyecto borrado; una invitación aceptada en el medio vale al restaurar; la huella de todas las filas es la misma antes y después; las marcas no se escriben desde la API y nada se borra; sin sesión nada. |
| `comentarios_importados_permisos.sql` | Comentarios importados: `import_comment` pide editar y crear páginas (ver, comentar y editar no; sin membresía o en la página de arriba, `page_not_found`); el autor de afuera queda sin autor de la app, con el nombre recortado y el correo en minúsculas, la fecha original, `updated_at` del momento, resuelto sin quién e `imported_by`; una respuesta sin nombre queda a nombre de quien importa y toma el bloque del hilo; reintentar lo mismo no duplica; importarlo de nuevo con otro bloque pasa el hilo y su respuesta al bloque nuevo sin cambiar el texto, y un hilo borrado no se mueve; con otra fecha, otro autor, otra persona o sobre un comentario normal es `comment_conflict`; fechas futuras, anteriores a 2000 o ausentes, respuesta resuelta, a una respuesta, en otro bloque, a un hilo que no existe, otro origen, bloque, texto o nombre con forma inválida, rechazados; el de afuera no se edita y con editar no se borra, lo propio sí se edita, quien comenta responde y reabre, quien tiene 4 lo borra; `list_comments`, la vista, la tabla y `comment_authors` dan lo importado a quien ve; las restricciones de la tabla; nadie lo cambia directo y sin sesión no se importa. |
| `historial_permisos.sql` | El historial: quien edita (nivel 3 y 4) ve las filas en orden con autor, hora e id y los correos; Ver, Comentar, un invitado con Editar, sin permiso y sacado reciben `page_not_found` (y `pull_page_updates` les sigue andando); una página en la papelera o adentro de una, `page_in_trash`; un proyecto borrado, nada; desde la API, `created_by` y `created_at` dan 42501 y el contenido se lee como antes; las funciones auxiliares y anon, 42501; nada escribe. |
| `asistente_politica_permisos.sql` | La política del asistente: arranca en `on` (también la fila que ya existía), acepta solo `on`, `local_only` y `off` (ni otro valor ni null), un miembro la lee con el resto de la fila y no la cambia, y anon no la lee. |
| `asistente_politica_ventana_permisos.sql` | Quién cambia la política del asistente (`set_assistant_policy`, entrega A2): el dueño y un admin la cambian a los tres valores; un valor desconocido o `null` no cambia nada; la fila sigue sin poder escribirse directo; un miembro, un invitado, un admin sacado, alguien que no es miembro, una sesión con contraseña y `anon`, no; solo `authenticated` la ejecuta y es `security definer`. |
| `clave_sincronizada_permisos.sql` | La clave del asistente sincronizada (`assistant_key_sync`, `Doc_Clave_Sincronizada.md`, entrega S1): la persona crea, lee, cambia y borra su fila; el id lo pone la base y la generación arranca en 1 y la sube el trigger; una escritura con la generación vieja no cambia nada; no se escriben a mano la generación, la hora ni el id (tampoco al crear); los largos fijos y la versión; otro miembro, un admin y el dueño con su sesión de la app no ven, cambian ni borran la fila ajena; un token con `client_id` y una sesión con contraseña, ni la suya; `anon`, nada; borrar la cuenta borra la fila; fuera de Realtime. Con 12 mutantes de la migración, los 12 detectados. |
| `link_publico_permisos.sql` | El link público (`Doc_Link_Publico.md`, 6.1), con el rol `anon` y los headers como la app: crear pide `can_share` (sin permiso, con Editar, un miembro común con 4, un invitado y Comentar, no; en la papelera, `page_in_trash`; `edit`, vencido o con la app vieja, no) y el interruptor (`clean_off`, D33); uno vivo por página; el nivel solo en la página y lo de abajo (nunca arriba, al costado, la papelera ni otro proyecto); tokens malos, todos `link_not_found`; anon no lee ninguna tabla ni llama a las funciones de siempre ni a `private` salvo `plink_token` y `plink_thumbs`, y authenticated no llama a `plink_*`; las que cuentan son `VOLATILE`; `plink_open` y `plink_tree` sin nombres del proyecto ni correos, columnas exactas, la raíz sin padre y con su formato, sin cambios no cuenta; `plink_pull_page` solo la base (nunca filas), contada, nada con el interruptor apagado; mover, la papelera y el proyecto borrado; los pases y la política de `thumbs` (sin fotos sacadas, ajenas, de arriba ni de la papelera; sin header, nada); comentarios con nombre, ningún correo, los propios por link y dispositivo, el equipo con 4 los borra y Editar no; cada tope (aperturas, pases de todos, bajadas por link, de todos y del mes, comentarios por cantidad, bytes del día y de por vida, la guarda de la base, que mide todas las bases) y lo rechazado no suma; vencer, cambiar, *Reset* (idempotente) y revocar; el creador sin rol, sin permiso, invitado, dueño del proyecto pasado a invitado, y sacado (no revive); `has_plain_readers`, `clean_work` y mover adentro reinician. Con 48 mutantes de la migración (45 detectados; los 3 que no, equivalentes). |
| `menciones_permisos.sql` | Las menciones (`Doc_Menciones.md`, 8.1): un miembro con Comentar menciona a quien ve la página y la campana de la mencionada da 1 con el texto, el título y quién; a quien no la ve, descartado; un invitado menciona a quien participa, a quien le compartió y a quien lo invitó (`invitations.invited_by`), y no a un miembro que no participa ni a otra invitada; un miembro a una invitada solo si ya comentó, el dueño y un admin a cualquiera que vea la página; la lista del `@` de cada uno (invitado, miembro, dueño, admin, el miembro común dueño de un proyecto con su lista vacía en su página; desde la entrega 2, filas sin acceso solo para la dueña, que puede compartir; Ver, `comment_denied`; sin acceso, `page_not_found`); comentario ajeno, borrado o inexistente, 21 personas, formas y rótulos malos (`mentions_invalid`, nunca 23514), uno mismo descartado; el mismo conjunto no toca la fila ni el comentario (por `ctid`) y sumar a otra no toca a la que estaba; el reintento con el permiso ya bajado; sacar y volver con `read_at` intacto; permiso sacado, página movida, papelera (Ver e invitada no; quien edita sí) y sacada del workspace; borrar el comentario; el tope de 10 y de 50 filas; leídas solo las propias; nadie lee ni escribe la tabla y anon no llama a nada; `list_comments` termina en `plink_id`, `plink_author`, `mentions`; sin header, `app_outdated` salvo el reintento idéntico; importar no menciona; una sesión con contraseña no ve nada. `comments_view` da lo mismo que `list_comments` y quien no ve la página no recibe menciones por su función. Los rótulos con caracteres invisibles (ancho cero, cambio de dirección) dan `mentions_invalid`, la tabla tampoco los acepta y el rótulo propuesto los saca. Con 30 mutantes de la migración, todos detectados. |
| `menciones_e2_permisos.sql` | La entrega 2 de las menciones (`Doc_Menciones.md`, ME2): las filas sin acceso de la lista del `@` le llegan solo al dueño y a un admin que puede compartir la página (exactamente quienes no la ven: ni uno mismo ni quien sacaron del workspace; las con acceso primero); no a un admin que solo edita, ni a un miembro, ni a un miembro dueño de otro proyecto (tampoco en su página), ni a una invitada, ni en la papelera, ni con una sesión de contraseña. `share_for_mention`: los mismos no pueden (`not_allowed`, también con alguien que ya ve la página), ni en la papelera, ni con quien no es del workspace, y anon no la llama; la dueña comparte con Comentar solo esa página (la de abajo sí, la de arriba, la de al lado y el proyecto no), con el reinicio de lo borrado en la rama, y la mención pasa; repetir, o pedirlo para quien ya ve la página (Ver, Comentar, Editar y crear, uno mismo, la de abajo), no toca ningún permiso (por `ctid`); un permiso quitado vuelve con Comentar; un admin a una invitada. Con 19 mutantes de la migración, 18 detectados (el otro, equivalente). |
| `snapshots_permisos.sql` | Los snapshots de compactar (`Doc_Compactar.md`, entregas 1 y 2; desde la 2, el invitado con Editar no invalida): apagados, y prendidos sin snapshots, `pull_page_content` devuelve lo mismo que `pull_page_updates` (con la época) para Ver, Comentar, un invitado, Editar, Editar y crear y el dueño; nadie lee `page_snapshots` ni `page_compaction`, ni llama a lo de `private`, ni cambia `snapshot_seq` o `content_epoch`, y anon no llama a nada; reservar (ver lo borrado, versión, papelera, 100 filas, 64 KB, la reserva de otro que vence a los 10 minutos, el salteo de 24 horas); subir (quién, versión, huella, tamaño, base64, la fila final con otro id, más allá de `update_seq`, base vieja, reintento, `snapshot_mismatch` que invalida la cadena del otro y `snapshot_exists` con otra versión); bajar la vuelta y confirmar (solo quien lo subió, con su huella, sobre la base vigente); quien no ve lo borrado nunca recibe el snapshot, tampoco con la privacidad de lo borrado prendida; el snapshot y las filas siguientes, el lote, cuándo conviene por peso; la cadena (hereda `chain_id` y la versión más vieja) e invalidarla entera con la época que sube; subir `snapshot_min_version`; una fila final con otro id y `update_seq` menor; la limpieza al confirmar; un proyecto borrado; ninguna fila de `page_updates` cambia; `schema_version` 17. Con 60 mutantes de la migración (56 detectados; los 4 que no, equivalentes). |
| `versiones_con_nombre_permisos.sql` | Las versiones con nombre: Editar nombra (el nombre sin espacios de más; reintentar devuelve el mismo; el mismo id para otra versión o página, `version_conflict`; dos nombres vigentes para la misma versión, `version_named`; una fila que no existe, un nombre vacío o de más de 100, rechazados); el creador y Editar y crear lo ven; Ver, Comentar, un invitado con Editar y sin permiso no listan, nombran, marcan, renombran ni sacan (`page_not_found`); con Editar solo sobre la de abajo, nada en la de arriba y sí en la suya; con Editar arriba, la de abajo hereda; renombrar y sacar uno ajeno con Editar, `not_allowed`, con nivel 4 sí (también el de una cuenta borrada); sacar no borra la fila y deja quién; después de sacarlo se puede volver a nombrar; la marca de restauración solo sobre una fila propia y de una versión anterior, no se renombra ni se saca; en la papelera (la página o una de arriba), `page_in_trash` para quien edita y nada para quien ve; sin header o con una versión vieja (mínima 0.099), nombrar, renombrar, sacar y marcar dan el 503 `app_outdated` sin escribir, y leer y repetir lo ya hecho andan; con la fila de ese `seq` cambiada (copia restaurada), el nombre deja de mostrarse; la tabla no se lee ni se escribe directo, lo de `private` no se llama y anon no llama a nada; un proyecto borrado, nada; `page_history` y `pull_page_updates` no cambian; `schema_version` 13. |
| `version_minima_archivos_permisos.sql` | La versión mínima en la cola de archivos: sin mínima anda todo; con una mínima menor a 0.090, las funciones con versión comparan y las de siempre andan; con 0.090 o más, las de siempre y las versiones menores, ilegibles o ausentes dan `app_outdated` sin escribir nada; el permiso va antes que la versión; anon no llama a nada. |
| `version_minima_arbol_permisos.sql` | La versión mínima en el árbol y los comentarios: sin mínima anda todo; con una mínima menor a 0.099, sin header anda y con un header menor se rechaza; con 0.099 o más, sin header, vacío, ilegible o menor, crear (también reintentar una que ya está), renombrar, mover, papelera, ícono y formato, crear y renombrar proyectos, comentar, responder, editar, borrar, resolver e importar, y archivar, borrar y restaurar proyectos dan el 503 `app_outdated` sin escribir nada (repetir lo ya hecho anda), y leer sigue andando; la mínima y las mayores escriben todo sin duplicar; el permiso va antes; la consola no se frena; anon no llama a nada. |
| `papelera_lectores_permisos.sql` | La papelera de páginas para quien solo ve: con una página en la papelera, su hija y una raíz en la papelera compartida sola, Ver (sobre el proyecto, sobre la raíz de arriba y sobre la página misma), Comentar y una invitada con Editar no ven la fila ni el contenido (`pull_page_updates` y la tabla), los comentarios (`list_comments`, la tabla, `comment_authors`, comentar), el archivo que solo usa esa página (`file_level`, `media_file` del portero, `files`) ni su uso de un archivo compartido, y la invitada no escribe ni renombra; Editar, una admin con Editar y el dueño sí (Editar no restaura: pide 4); el dueño crea adentro de una página de la papelera; Editar solo sobre la hija ve la hija y no la madre; una invitada con crear que reintenta un alta con el id de una página de la papelera no la ve ni la pisa; una invitada con crear manda una página a la papelera, deja de verla y no la restaura; al restaurar, Ver ve todo de nuevo con contenido, comentarios y archivo, la invitada escribe y quien comenta comenta. |

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
   la terminal sin mostrarla. Si ya hay una guardada, no la pide ni la reescribe, aunque esté
   `SMTP_PASSWORD` (así correrlo de nuevo no cambia nada), salvo `--new-smtp-password`. Nunca se acepta como
   opción (quedaría en el historial) ni se imprime; un argumento que no es una opción tampoco se repite en el
   error (podría ser una clave pegada).
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
9. Imprime la dirección del proyecto y la clave publicable (`sb_publishable_…`, para la app y el portero). La
   `anon` vieja (un JWT) no la imprime: si es la única, avisa que hay que crear la publicable en el panel.

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
"Abrir el registro solo para invitados" (abajo), pasos 4, 5 y 7 (no conecta el hook opcional *Custom Access
Token* del paso 6: si fallara, no entraría nadie, y se prueba a mano). Pide que ya esté todo lo anterior (migraciones
al día, la función del hook con sus permisos `t`, `t`, `f`, dueño, SMTP y las plantillas con el código);
conecta el hook con el registro todavía cerrado, verifica que quedó conectado y que la función rechaza con
403 un correo sin invitación (una consulta de solo lectura), y **recién después** abre el registro. Si al
abrir el hook no quedó prendido, vuelve a cerrar el registro. Si ya está abierto con el hook, no hace nada.
La prueba desde la app (un correo sin invitación y uno invitado) queda a mano.

Pruebas: `scripts/setup-workspace.test.mjs` (entra en `npm test`): la configuración deseada, el diff, que los
secretos no salen, los seguros, que la clave local y el dueño no se pisan, que dry-run no escribe (con un
`fetch` falso que falla ante cualquier pedido que no sea `GET` o una consulta de solo lectura, también contra
un "Wanka" de mentira), que una corrida de verdad deja todo y la segunda no cambia nada (tampoco la
contraseña SMTP con `SMTP_PASSWORD` puesta), que no se imprime la clave `anon` vieja, que las migraciones se
encuentran desde una carpeta con espacios, y el orden del registro para invitados.

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
  nada (`private.session_allowed`, ver "Abrir el registro solo para invitados"). Quedan los valores de
  fábrica (`password_min_length: 6`, sin chequeo de contraseñas filtradas).
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
workspace nuevo, los pasos 4, 5 (una verificación automática; la prueba desde el panel queda a mano) y 7 los
hace `setup-workspace.mjs --open-invite-signup` ("Preparar un workspace nuevo"); el hook opcional del paso 6
no lo toca. En Wanka, todo a mano. Qué hace
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
