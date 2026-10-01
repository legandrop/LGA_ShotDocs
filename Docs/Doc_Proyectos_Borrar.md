# Borrar y archivar proyectos (P.14)

Estado: **diseño EN CURSO, incompleto; sin implementar** (2026-10-01). Están escritas todas las secciones, pero
el documento se cerró sin la relectura final ni la auditoría: ver "Lo que falta", al final. Faltan también las
respuestas de Lega a las preguntas. Nada de esto está en la base ni en la app: el SQL de las secciones 1 y 3 es una
propuesta **sin ejecutar** (no hay Postgres en la computadora de trabajo); antes de aplicarlo se corre con su
prueba dentro de `begin; … rollback;` contra la base, como manda la sección 11 de `Plan_Workspaces.md`. Sale
de leer `main` en `19c7692` (v0.074): las migraciones de `supabase/migrations/`, `src/sync/` (árbol, motor,
remoto, permisos), `src/ui/ProjectSwitcher.tsx`, `src/ui/project.ts`, `src/ui/Workspace.tsx`,
`src/ui/WorkspaceMenu.tsx`, `src/ui/TrashView.tsx`, `src/media/` (papelera de archivos, peso) y `portero/src/`.

## Qué se pide

Lega, 2026-10-01: poder **borrar** y **archivar** proyectos. En vez de una línea más en el selector (como
"Proyecto nuevo" o "Renombrar"), **un ícono de archivar y uno de borrar al lado de cada proyecto**. Archivar
pregunta "¿Querés archivarlo?" y con un sí se archiva. Borrar lleva más seguridad, "porque se van a borrar
cosas": una ventana más importante que pregunta si también se borra lo que el proyecto tiene en el Drive,
mostrando cuántos GB son, y que se confirma **escribiendo una palabra**: `delete` con la app en inglés,
`borrar` en castellano.

Lo que ya decía el roadmap (P.14): borrar es mandar el proyecto entero a una papelera (con sus páginas y sus
archivos) y poder restaurarlo, sin borrado duro desde la app; el definitivo, como el de los archivos, a pedido
y con su plazo. Archivar lo saca de la lista de todos los días y de la búsqueda, pero queda entero y se abre y
se desarchiva desde una lista de archivados.

## Reglas que no se rompen

- **Nunca perder datos.** Borrar un proyecto no borra ninguna fila: pone una marca (`workspaces.deleted_at`).
  Restaurar saca la marca y el proyecto queda **exactamente como estaba** (lo comprueba una huella en la prueba
  SQL, sección 1.4).
- **Lo que no se subió no se pierde:** un dispositivo con cambios de un proyecto que otro borró los conserva
  como rechazados (a la vista, se pueden bajar como archivo) y suben al restaurarlo.
- **La base decide**, con Row Level Security y funciones `security definer`, no la interfaz: una versión vieja
  de la app tampoco puede ver ni escribir un proyecto borrado.
- **Drive:** nada se borra en Drive; a lo sumo va a la **papelera de Drive** (Google lo guarda 30 días), y
  solo si la persona lo pide en la ventana de borrar.
- **Sin tipos de bloque ni propiedades nuevas en el editor:** no hace falta subir `min_app_version` por el
  documento (sección 6 explica por qué igual conviene subirla).

## Resumen

1. **Tres estados de un proyecto** en `workspaces`: activo, **archivado** (`archived_at`, `archived_by`) y
   **borrado** (`deleted_at`, `deleted_by`). Archivado y borrado son independientes: restaurar un proyecto
   que estaba archivado lo devuelve archivado.
2. **Archivar es solo orden:** no cambia permisos ni contenido. Sale de la lista principal del selector y del
   panel de Ctrl/⌘+K, y queda en *Archived projects*, donde se abre (editable, con una marca) y se desarchiva.
3. **Borrar es mandar a la papelera de proyectos:** para todos los niveles de permiso el proyecto pasa a 0
   (`private.user_page_level` y `private.user_project_level` dan 0 si el proyecto está borrado), así que deja
   de verse y de escribirse por todos los caminos que ya existen (páginas, contenido, comentarios, archivos,
   miniaturas, portero). Sus archivos entran a la papelera de archivos sola, porque una página de un proyecto
   borrado deja de estar "viva" (`private.page_alive`). Nada se borra.
4. **Restaurar** saca la marca y vuelve a calcular la papelera de archivos de ese proyecto: todo vuelve como
   estaba (los archivos que ya estaban en la papelera conservan su fecha).
5. **Plazo: 30 días** (los mismos de la papelera de archivos y de la papelera de Drive). Al vencer **no pasa
   nada solo**: hoy no hay ningún proceso que purgue (la purga automática de archivos está armada y apagada) y
   no se agrega uno. El borrado definitivo (*Delete forever*) es una tercera entrega, a pedido y después de los
   30 días.
6. **Drive (segunda entrega):** con la casilla tildada, la **carpeta del proyecto** en el Drive del dueño
   (`LGA_ShotDocs/<Proyecto>`, la que lleva la marca `sdProject`) va entera a la papelera de Drive con **un solo
   pedido** al portero, y restaurar la saca de ahí con otro. Sin la casilla, los archivos quedan en el Drive en
   su carpeta. Requiere una prueba técnica con el Drive real antes de construirla.
7. **Quién puede:** archivar, borrar y restaurar, quien puede compartir el proyecto entero: "Editar y crear
   páginas" sobre el proyecto y además ser dueño o admin del workspace, o quien lo creó
   (`private.can_manage_project`). La casilla de Drive y el borrado definitivo, solo el dueño y los admins.
8. **Solo con red:** archivar, borrar y restaurar son funciones de la base que se llaman en el momento (como
   mandar archivos a la papelera de Drive), no cambios en la cola. No se borra desde un dispositivo que tiene
   cambios de ese proyecto sin subir.
9. **Interfaz:** en el selector, al pasar el mouse (o con el foco) por un proyecto, tres íconos: renombrar,
   archivar y borrar; en el teléfono, un "⋯" por renglón. Al pie, *Archived projects (N)* y *Deleted
   projects*, que cambian el mismo selector a esas listas. La ventana de borrar muestra nombre, páginas,
   archivos, GB en Drive, con quiénes está compartido, el plazo y pide escribir `delete` / `borrar`.
10. **Migración** `20261001120000_proyectos_archivar_borrar.sql` (entrega 1, `schema_version` 9) completa en la
    sección 1.3, con su prueba SQL en la 1.4. La de Drive (entrega 2, versión 10) va como borrador en la 3.6.
11. **Entregas:** 1) archivar, borrar y restaurar sin tocar Drive; 2) la casilla de Drive (portero y migración
    10, después de la prueba técnica); 3) *Delete forever*.

## 0. Lo que hay hoy y condiciona el diseño

| Dónde | Qué hay | Qué implica |
|---|---|---|
| `supabase/migrations/20260929120000_fase1_esquema.sql:14-19`, `:173` | `workspaces` (cada fila es un **proyecto**; el workspace es `workspace_settings`) sin marcas de estado; la API solo puede escribir `name` (`grant update (name)`) y no puede borrar. | Las marcas nuevas no se pueden escribir desde la API: solo con funciones. |
| `20260930160000_equipo.sql:97-137` | `private.user_page_level` y `private.user_project_level`: todo permiso sale de acá (`page_level`, `project_level`, `can_view_page`, `can_edit_page`, `file_level`). | Hacer que den 0 en un proyecto borrado corta **todos** los caminos de una vez, también los de la app publicada. |
| `20260930160000_equipo.sql:212-223`, `:329-336` | `can_view_project_row` muestra un proyecto a su creador, a quien tiene permiso sobre él y a quien tiene permiso sobre una página de adentro; la política `workspaces_select` la usa. | La política suma `deleted_at is null`; el creador y los permisos por página no pasan por los niveles. |
| `20260930160000_equipo.sql:797-813` | `private.can_share`: compartir el proyecto entero pide 4 sobre él y ser dueño o admin, o su creador. | Es la regla propuesta para borrar y archivar (sección 5). |
| `20260930160000_equipo.sql:544-610` | `accept_invitations` aplica un permiso solo si quien invitó todavía tiene 4 sobre eso. | Con los niveles en 0, una invitación aceptada mientras el proyecto está borrado perdería su permiso: se cambia a los niveles "sin mirar el borrado" (sección 1.2). |
| `20260930180000_papelera_archivos.sql:72-85` | `private.page_alive`: una página está viva si ni ella ni una de arriba están en la papelera de páginas. Un archivo entra a la papelera cuando ninguna página viva lo usa (`refresh_file_trash`). | Sumar "y su proyecto no está borrado" manda los archivos del proyecto a su papelera y saca de "Vaciar" los de otros proyectos que usaba (`in_trashed_page`). |
| `20260930180000_papelera_archivos.sql:115-123` | `can_view_file` deja ver un archivo a quien lo creó (miembro activo) **sin mirar niveles**. | Sin cambio, el creador seguiría viendo las filas de `files` de un proyecto borrado: se corrige. |
| `20260930180000_papelera_archivos.sql:1-27`, `:421-444`, `:449-472` | Modelo de la papelera de archivos: entra sola, el dueño o un admin la manda a la papelera de Drive (`purge_file`, definitivo para la app), la purga a los 30 días está armada y **apagada** (`auto_purge_files`), ninguna fila se borra. | Es el modelo que sigue el borrado definitivo de proyectos (sección 2). |
| `20260930190000_peso_proyectos.sql:40-43` | `project_sizes()` calcula la puerta por proyecto con `can_see_file_trash`. | Con el proyecto borrado esa puerta da no: para los que pueden restaurarlo se usa `can_manage_project` (el peso de la papelera de proyectos). |
| `src/sync/remote.ts:433-441` | `fetchProjects` lee `id, name, created_at, owner_id` de `workspaces`. | La app publicada deja de ver el proyecto borrado sin cambiar nada (la política lo filtra). |
| `src/services.ts:172-191`, `src/sync/tree.ts:565-569`, `src/ui/project.ts:66-69` | El "primer proyecto" (`ensure_workspace`) se guarda **una vez** en `meta.workspaceId` y el árbol lo agrega siempre a la lista, aunque el servidor no lo mande, con el nombre de fábrica. | Si se borra ese proyecto, cada dispositivo que lo tiene como primero muestra un "My project" vacío. Ya pasa hoy si a alguien le dejan de compartir su primer proyecto. La app nueva lo reemplaza (sección 6.4); una versión vieja muestra ese renglón vacío (sección 6.5). |
| `src/sync/engine.ts:331-338`, `src/sync/tree.ts:357-367`, `src/media/queue.ts:186-207`, `Doc_Sincronizacion.md:613-615` | Lo que el servidor rechaza para siempre (cambios del árbol, contenido, fotos, comentarios) queda en el dispositivo, a la vista, y se puede bajar ("Download my unsynced changes"); una página que deja de compartirse sale del árbol pero su contenido sigue. | Un proyecto borrado se comporta para los demás dispositivos como uno que les dejaron de compartir: nada se pierde, y al restaurarlo "Retry" (o abrir la app) lo sube. |
| `src/ui/ProjectSwitcher.tsx:132`, `:244-275`, `:276-310` | El selector: cada proyecto es un `<button role="option">`; abajo, líneas *Share*, *New project*, *Import from Coda…* y *Rename* (estas dos últimas, del proyecto abierto). Modos `list`, `new`, `rename`. | Los íconos por renglón piden cambiar el renglón (no puede haber botones adentro de un botón). Las listas de archivados y borrados son modos nuevos del mismo selector. |
| `src/ui/ProjectSearch.tsx:147` | Comentario: "un proyecto no se puede borrar, así que no se ofrece [crear] mientras podría haber páginas que coinciden". | Sigue valiendo la prudencia, pero el comentario se actualiza al implementar. |
| `portero/src/core.ts:679-703`, `:894-932`, `:954-962` | La carpeta de cada proyecto se crea con la marca `sdProject` y el portero recuerda su id (`project:<id>`); si está en la papelera, crea otra. `/trash` manda **un archivo** a la papelera de Drive. | Mandar la carpeta entera es un pedido; archivo por archivo, 2300 pedidos para un proyecto como el de Coda (sección 3.4). |
| `src/import/codaImport.ts:336-340`, `Doc_Importar_Coda.md:128` | Una importación cortada se puede seguir si su proyecto sigue en el árbol; si no, se olvida. "El proyecto a medias queda: la app todavía no borra ni archiva proyectos". | Borrar es la forma de limpiar importaciones de prueba; el diario de la importación se conserva mientras el proyecto esté en la papelera (sección 8). |
| `Plan_Workspaces.md:213-216` | Los proyectos privados de alguien que se va "van a la papelera del workspace y nadie los ve en la app". | Esa "papelera del workspace" es esta papelera de proyectos. |

## 1. Modelo de datos y migración (entrega 1)

### 1.1 Las marcas

En `public.workspaces` (una fila por proyecto):

| Columna | Qué es |
|---|---|
| `archived_at`, `archived_by` | Cuándo y quién lo archivó. Nulas: no está archivado. |
| `deleted_at`, `deleted_by` | Cuándo y quién lo mandó a la papelera de proyectos. Nulas: no está borrado. |

- Restricciones: `archived_by` solo con `archived_at`; `deleted_by` solo con `deleted_at`.
- **Desde la API se leen** (la tabla tiene `grant select` entero) **y no se escriben**: el único permiso de
  escritura sigue siendo `update (name)`. Se cambian solo con las funciones de la sección 1.3.
- **Índices:** ninguno nuevo. `workspaces` tiene decenas de filas (Wanka: 7 proyectos); los recorridos que
  importan (las páginas y los archivos de un proyecto) ya tienen `pages_workspace_idx` y `files_project_idx`.
- **`schema_version` pasa a 9.** Como la papelera de archivos y el peso, la app usa su propia constante
  (`PROJECT_STATES_SCHEMA_VERSION = 9`) y **no sube `DB_SCHEMA_VERSION`** (`src/workspace.ts:10`): con la base
  sin migrar, los íconos y las listas nuevas no aparecen y no hay aviso.

### 1.2 Qué cambia en cada política y función

| Pieza | Cambio | Efecto con el proyecto borrado |
|---|---|---|
| `private.user_page_level`, `private.user_project_level` | Dan 0 si el proyecto está borrado. El cálculo de siempre queda en `user_page_level_any` y `user_project_level_any` (no se exponen). | `page_level`, `project_level`, `can_view_page`, `can_edit_page`, `can_create_page`, `can_share`, `can_see_file_trash`, `can_purge_files`, `file_level`, `can_edit_some_page` dan 0 o no. Con eso: `pages_select/insert/update`, `page_updates_select`, `push_page_update`, `pull_page_updates`, `page_files_select`, los buckets `page-files` y `thumbs`, `register_file`, `link_page_file`, `unlink_page_file`, `media_file` (el portero no da pases ni abre subidas), `set_file_drive`, `set_file_thumb`, `comments` y sus funciones, `share`, `unshare`, `list_access`, `create_invitation`, `trashed_files`, `purge_file`: todo como si la persona no tuviera acceso. |
| Política `workspaces_select` | Suma `deleted_at is null`. | El proyecto no se lista (tampoco a su creador ni a quien tiene una página compartida). `workspaces_update` ya pide nivel 4: renombrar uno borrado no hace nada. |
| `private.can_view_file` | El creador ve su archivo solo si el proyecto no está borrado. | Nadie ve filas de `files` del proyecto. |
| `private.page_alive` | Una página de un proyecto borrado no está viva. | Sus archivos entran a la papelera de archivos (de su proyecto, que nadie ve); un archivo de **otro** proyecto que solo se usaba ahí también entra, pero marcado `in_trashed_page`: queda fuera de "Vaciar" y de la purga automática hasta que se restaure. |
| `public.ensure_workspace` | Saltea los borrados y prefiere los no archivados. | Un dispositivo nuevo nunca arranca en un proyecto borrado. |
| `public.accept_invitations` | Revisa a quien invitó con los niveles "sin mirar el borrado". | Una invitación aceptada mientras el proyecto está borrado deja su permiso guardado (sin efecto); al restaurar, vale. |
| `public.project_sizes` | Para un proyecto borrado, la puerta es `can_manage_project`. | Quien puede restaurarlo sigue viendo su peso (la lista de borrados lo muestra). La app publicada lo suma en el total del diálogo de Drive, que es lo correcto: sigue ocupando el Drive. |
| Nuevas privadas | `could_view_project` (lo veía, sin mirar el borrado), `can_manage_project` (la regla de la sección 5), `refresh_project_files` (recalcula la papelera de archivos del proyecto). | |
| Nuevas públicas | `set_project_archived`, `delete_project`, `restore_project`, `trashed_projects`, `project_delete_info`. | Idempotentes: repetirlas no cambia nada. Errores: `project_not_found` (P0002) si no existe o la sesión no lo veía; `not_allowed` (42501) si lo ve pero no puede; `project_deleted` (P0001) al archivar uno borrado; `archived_invalid` (22023). |
| Sin cambios | `workspaces_insert` (crear con el mismo id que uno borrado: `on conflict do nothing`, no da error y el proyecto sigue borrado), `remove_member` (los proyectos borrados que compartía pasan a un heredero como los demás: alguien podrá restaurarlos), `media_whoami`. | |

Archivar no toca ninguna política: los niveles no cambian.

### 1.3 La migración, completa

`supabase/migrations/20261001120000_proyectos_archivar_borrar.sql` (propuesta; sin ejecutar):

```sql
-- LGA Shot Docs · archivar y borrar proyectos (P.14 del roadmap; Docs/Doc_Proyectos_Borrar.md), entrega 1.
--
-- Un proyecto (una fila de `workspaces`) puede estar archivado (`archived_at`) y/o borrado (`deleted_at`). Las dos
-- marcas se ponen y se sacan solo con las funciones de abajo; la API las lee y no las escribe. Nada se borra.
--
-- Archivar es solo orden: no cambia permisos ni contenido (la app lo saca de la lista de todos los días).
--
-- Borrar manda el proyecto a la papelera de proyectos: todos los niveles de permiso sobre él y sus páginas dan 0
-- (`private.user_page_level` y `private.user_project_level`), así que deja de verse y de escribirse por todos los
-- caminos (páginas, contenido, comentarios, archivos, miniaturas, portero), también para la app publicada. Sus
-- páginas dejan de estar vivas (`private.page_alive`): sus archivos entran a la papelera de archivos. Restaurar
-- saca la marca y vuelve a calcular esa papelera: el proyecto queda exactamente como estaba.
--
-- Quién: archivar, borrar y restaurar, quien puede compartir el proyecto entero (4 sobre él y dueño o admin, o
-- su creador), calculado sin mirar el borrado (`private.can_manage_project`).
--
-- Compatible con la app publicada: suma columnas y funciones; las que cambian conservan su firma y lo que
-- devuelven. Mientras nadie borre nada, nada cambia para nadie.

-- ---------------------------------------------------------------------------------------------------
-- Columnas
-- ---------------------------------------------------------------------------------------------------
alter table public.workspaces
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users (id) on delete set null,
  add column deleted_at  timestamptz,
  add column deleted_by  uuid references auth.users (id) on delete set null,
  add constraint workspaces_archived_by check (archived_by is null or archived_at is not null),
  add constraint workspaces_deleted_by  check (deleted_by is null or deleted_at is not null);

-- Desde la API la tabla se sigue escribiendo solo en `name` (`grant update (name)` de la fase 1): las columnas
-- nuevas se leen (la tabla tiene `grant select`) y no se escriben.

-- ---------------------------------------------------------------------------------------------------
-- Niveles: un proyecto borrado da 0
-- ---------------------------------------------------------------------------------------------------
-- El cálculo de siempre (migración del equipo) queda en las versiones `_any`, que no miran el borrado. Las usan
-- solo las funciones de este archivo: quién puede restaurar, quién lo veía y las invitaciones.

create function private.user_page_level_any(p uuid, uid uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  with recursive chain (id, parent_id, depth) as (
    select pg.id, pg.parent_id, 0 from public.pages pg where pg.id = p
    union all
    select pg.id, pg.parent_id, c.depth + 1
    from public.pages pg
    join chain c on pg.id = c.parent_id
    where c.depth < 10000
  ),
  target as (
    select pg.workspace_id, w.owner_id
    from public.pages pg
    join public.workspaces w on w.id = pg.workspace_id
    where pg.id = p
  )
  select case when uid is null or private.workspace_role(uid) is null then 0 else greatest(
    coalesce((select 4 from target t where t.owner_id = uid), 0),
    coalesce((
      select max(private.grant_level_value(g.level))
      from public.grants g
      where g.user_id = uid and g.revoked_at is null
        and (g.project_id = (select t.workspace_id from target t)
             or g.page_id in (select c.id from chain c))
    ), 0)) end;
$$;

create function private.user_project_level_any(ws uuid, uid uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select case when uid is null or private.workspace_role(uid) is null then 0 else greatest(
    coalesce((select 4 from public.workspaces w where w.id = ws and w.owner_id = uid), 0),
    coalesce((
      select max(private.grant_level_value(g.level))
      from public.grants g
      where g.user_id = uid and g.project_id = ws and g.revoked_at is null
    ), 0)) end;
$$;

revoke all on function private.user_page_level_any(uuid, uuid) from public, anon, authenticated;
revoke all on function private.user_project_level_any(uuid, uuid) from public, anon, authenticated;

-- Las de siempre: 0 si el proyecto está borrado. `page_level`, `project_level`, `can_view_page`, `can_edit_page`
-- y todo lo que las usa cambian con ellas.
create or replace function private.user_page_level(p uuid, uid uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.pages pg
      join public.workspaces w on w.id = pg.workspace_id
      where pg.id = p and w.deleted_at is not null) then 0
    else private.user_page_level_any(p, uid)
  end;
$$;

create or replace function private.user_project_level(ws uuid, uid uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select case
    when exists (select 1 from public.workspaces w where w.id = ws and w.deleted_at is not null) then 0
    else private.user_project_level_any(ws, uid)
  end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Quién veía un proyecto y quién lo maneja (sin mirar el borrado)
-- ---------------------------------------------------------------------------------------------------

-- Lo mismo que `can_view_project_row`, pero con el nivel que tenía la sesión antes de que lo borraran: su
-- creador (miembro activo), quien tiene permiso sobre el proyecto o sobre una página de adentro.
create function private.could_view_project(p_id uuid, p_owner_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.workspace_role() is not null and (
    p_owner_id = (select auth.uid())
    or private.user_project_level_any(p_id, (select auth.uid())) >= 1
    or exists (
      select 1 from public.grants g
      join public.pages pg on pg.id = g.page_id
      where g.user_id = (select auth.uid()) and g.revoked_at is null and pg.workspace_id = p_id));
$$;

-- Archivar, borrar y restaurar: la regla de compartir el proyecto entero (`private.can_share`), sin mirar el
-- borrado (así se puede restaurar): 4 sobre el proyecto y ser dueño o admin del workspace, o su creador.
create function private.can_manage_project(ws uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.user_project_level_any(ws, (select auth.uid())) >= 4
     and (coalesce(private.workspace_role() in ('owner', 'admin'), false)
          or exists (select 1 from public.workspaces w where w.id = ws and w.owner_id = (select auth.uid())));
$$;

revoke all on function private.could_view_project(uuid, uuid) from public, anon;
revoke all on function private.can_manage_project(uuid) from public, anon;
grant execute on function private.could_view_project(uuid, uuid) to authenticated;
grant execute on function private.can_manage_project(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Lo que se ve
-- ---------------------------------------------------------------------------------------------------

-- Un proyecto borrado no se lista. La puerta de siempre sigue decidiendo con los datos de la fila (crear con
-- `on conflict do nothing`: una fila nueva nunca está borrada).
drop policy workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
  for select to authenticated using (deleted_at is null and private.can_view_project_row(id, owner_id));

-- Un archivo: quien lo creó lo ve solo mientras sea miembro activo y su proyecto no esté borrado.
create or replace function private.can_view_file(p_file uuid, p_created_by uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (coalesce(p_created_by = (select auth.uid()), false)
          and private.workspace_role() is not null
          and not exists (
            select 1 from public.files f
            join public.workspaces w on w.id = f.project_id
            where f.id = p_file and w.deleted_at is not null))
      or exists (
        select 1 from public.page_files pf
        where pf.file_id = p_file and not pf.is_foreign and private.can_view_page(pf.page_id));
$$;

-- ---------------------------------------------------------------------------------------------------
-- Papelera de archivos: una página de un proyecto borrado no está viva
-- ---------------------------------------------------------------------------------------------------
create or replace function private.page_alive(p uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  with recursive chain (id, parent_id, deleted_at, depth) as (
    select pg.id, pg.parent_id, pg.deleted_at, 0 from public.pages pg where pg.id = p
    union all
    select pg.id, pg.parent_id, pg.deleted_at, c.depth + 1
    from public.pages pg
    join chain c on pg.id = c.parent_id
    where c.depth < 10000
  )
  select exists (select 1 from chain)
     and not exists (select 1 from chain c where c.deleted_at is not null)
     and not exists (
       select 1 from public.pages pg
       join public.workspaces w on w.id = pg.workspace_id
       where pg.id = p and w.deleted_at is not null);
$$;

-- Recalcula la papelera de archivos de todo lo que toca el proyecto: sus archivos y los de otros proyectos que
-- usan sus páginas. En orden de id, como `pages_file_trash` (dos a la vez no se bloquean en orden cruzado).
-- `refresh_file_trash` no toca los que ya se mandaron a la papelera de Drive y conserva la fecha de entrada de
-- los que ya estaban: por eso restaurar deja todo como estaba.
create function private.refresh_project_files(p_project uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  fid uuid;
begin
  for fid in
    select f.id from public.files f where f.project_id = p_project
    union
    select pf.file_id
    from public.page_files pf
    join public.pages pg on pg.id = pf.page_id
    where pg.workspace_id = p_project
    order by 1
  loop
    perform private.refresh_file_trash(fid);
  end loop;
end;
$$;

revoke all on function private.refresh_project_files(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Archivar, borrar y restaurar
-- ---------------------------------------------------------------------------------------------------
-- Errores: `project_not_found` (P0002) si no existe o la sesión no lo veía (no dice cuál de las dos);
-- `not_allowed` (42501) si lo ve pero no lo maneja; `project_deleted` (P0001) al archivar uno borrado;
-- `archived_invalid` (22023).

-- Archiva (`p_archived` true) o desarchiva. Repetirlo no cambia nada (queda quién y cuándo lo archivó primero).
create function public.set_project_archived(p_project uuid, p_archived boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  if p_archived is null then
    raise exception 'archived_invalid' using errcode = '22023';
  end if;
  select pr.owner_id, pr.archived_at, pr.deleted_at into w
  from public.workspaces pr where pr.id = p_project for update;
  if not found or not private.could_view_project(p_project, w.owner_id) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not private.can_manage_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'Archiving a project needs "edit and create pages" on the whole project, and being an owner or admin of the workspace or the creator of the project.';
  end if;
  if w.deleted_at is not null then
    raise exception 'project_deleted' using errcode = 'P0001';
  end if;
  if p_archived and w.archived_at is null then
    update public.workspaces set archived_at = now(), archived_by = auth.uid() where id = p_project;
  elsif not p_archived and w.archived_at is not null then
    update public.workspaces set archived_at = null, archived_by = null where id = p_project;
  end if;
end;
$$;

-- Manda el proyecto a la papelera de proyectos y devuelve cuándo. Si ya estaba, devuelve la fecha de entonces.
create function public.delete_project(p_project uuid)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  w     record;
  v_now timestamptz := now();
begin
  select pr.owner_id, pr.deleted_at into w
  from public.workspaces pr where pr.id = p_project for update;
  if not found or not private.could_view_project(p_project, w.owner_id) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not private.can_manage_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'Deleting a project needs "edit and create pages" on the whole project, and being an owner or admin of the workspace or the creator of the project.';
  end if;
  if w.deleted_at is not null then
    return w.deleted_at;
  end if;
  update public.workspaces set deleted_at = v_now, deleted_by = auth.uid() where id = p_project;
  perform private.refresh_project_files(p_project);
  return v_now;
end;
$$;

-- Lo saca de la papelera de proyectos. Si no estaba borrado, no hace nada. La marca de archivado no se toca.
create function public.restore_project(p_project uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.owner_id, pr.deleted_at into w
  from public.workspaces pr where pr.id = p_project for update;
  if not found or not private.could_view_project(p_project, w.owner_id) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not private.can_manage_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'Restoring a project needs the same permission as deleting it.';
  end if;
  if w.deleted_at is null then
    return;
  end if;
  update public.workspaces set deleted_at = null, deleted_by = null where id = p_project;
  perform private.refresh_project_files(p_project);
end;
$$;

-- La papelera de proyectos: los borrados que la sesión veía antes, lo último primero. `days_left`: cuántos días
-- faltan para los 30 (30 el día que entra, 0 si ya pasaron). `can_restore`: si la sesión lo puede restaurar.
-- `pages` (sin las que están en la papelera de páginas) y `files` (sin los que ya están en la papelera de Drive),
-- para mostrar. El peso sale de `project_sizes` (solo a quien puede restaurarlo).
create function public.trashed_projects()
returns table (id uuid, name text, archived_at timestamptz, deleted_at timestamptz, deleted_by uuid,
               deleted_by_email text, days_left int, can_restore boolean, pages int, files int)
language sql stable security definer set search_path = ''
as $$
  select w.id, w.name, w.archived_at, w.deleted_at, w.deleted_by, u.email::text,
         greatest(0, ceil(extract(epoch from (w.deleted_at + interval '30 days' - now())) / 86400))::int,
         private.can_manage_project(w.id),
         (select count(*)::int from public.pages pg where pg.workspace_id = w.id and pg.deleted_at is null),
         (select count(*)::int from public.files f where f.project_id = w.id and f.drive_trashed_at is null)
  from public.workspaces w
  left join auth.users u on u.id = w.deleted_by
  where w.deleted_at is not null
    and private.could_view_project(w.id, w.owner_id)
  order by w.deleted_at desc, w.id;
$$;

-- Lo que muestra la ventana de borrar, a quien puede borrarlo: páginas vivas y en la papelera de páginas,
-- archivos subidos fuera de la papelera de Drive y su peso (lo mismo que `drive_*` de `project_sizes`),
-- archivos todavía sin subir, archivos del proyecto que usan páginas vivas de otros proyectos (dejan de verse
-- ahí mientras esté borrado) y con cuántas personas activas está compartido (sin contar a quien pregunta).
create function public.project_delete_info(p_project uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  w record;
  r json;
begin
  select pr.owner_id into w from public.workspaces pr where pr.id = p_project;
  if not found or not private.could_view_project(p_project, w.owner_id) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not private.can_manage_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select json_build_object(
    'pages', (select count(*) from public.pages pg
              where pg.workspace_id = p_project and private.page_alive(pg.id)),
    'trashed_pages', (select count(*) from public.pages pg
                      where pg.workspace_id = p_project and not private.page_alive(pg.id)),
    'files', (select count(*) from public.files f
              where f.project_id = p_project and f.drive_id is not null and f.drive_trashed_at is null),
    'drive_bytes', (select coalesce(sum(f.size), 0)::bigint from public.files f
                    where f.project_id = p_project and f.drive_id is not null and f.drive_trashed_at is null),
    'pending_files', (select count(*) from public.files f
                      where f.project_id = p_project and f.drive_id is null and f.trashed_at is null),
    'used_elsewhere', (select count(distinct pf.file_id)
                       from public.page_files pf
                       join public.files f on f.id = pf.file_id
                       join public.pages pg on pg.id = pf.page_id
                       where f.project_id = p_project and pg.workspace_id <> p_project
                         and pf.removed_at is null and private.page_alive(pf.page_id)),
    'shared_with', (select count(distinct a.uid)
                    from (
                      select g.user_id as uid from public.grants g
                      where g.project_id = p_project and g.revoked_at is null
                      union
                      select g.user_id from public.grants g
                      join public.pages pg on pg.id = g.page_id
                      where pg.workspace_id = p_project and g.revoked_at is null
                      union
                      select w.owner_id
                    ) a
                    join public.members m on m.user_id = a.uid and m.removed_at is null
                    where a.uid is distinct from auth.uid()))
  into r;
  return r;
end;
$$;

revoke all on function public.set_project_archived(uuid, boolean) from public, anon;
revoke all on function public.delete_project(uuid) from public, anon;
revoke all on function public.restore_project(uuid) from public, anon;
revoke all on function public.trashed_projects() from public, anon;
revoke all on function public.project_delete_info(uuid) from public, anon;
grant execute on function public.set_project_archived(uuid, boolean) to authenticated;
grant execute on function public.delete_project(uuid) to authenticated;
grant execute on function public.restore_project(uuid) to authenticated;
grant execute on function public.trashed_projects() to authenticated;
grant execute on function public.project_delete_info(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- ensure_workspace: nunca uno borrado, y primero los no archivados
-- ---------------------------------------------------------------------------------------------------
create or replace function public.ensure_workspace()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  ws  uuid;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if private.workspace_role(uid) is null then
    return null;
  end if;

  select w.id into ws
  from public.workspaces w
  where w.owner_id = uid and w.deleted_at is null
  order by (w.archived_at is not null), w.created_at, w.id
  limit 1;
  if ws is not null then
    return ws;
  end if;

  select w.id into ws
  from public.grants g
  join public.workspaces w on w.id = g.project_id
  where g.user_id = uid and g.revoked_at is null and w.deleted_at is null
  order by (w.archived_at is not null), w.created_at, w.id
  limit 1;
  if ws is not null then
    return ws;
  end if;

  select w.id into ws
  from public.grants g
  join public.pages pg on pg.id = g.page_id
  join public.workspaces w on w.id = pg.workspace_id
  where g.user_id = uid and g.revoked_at is null and w.deleted_at is null
  order by (w.archived_at is not null), w.created_at, w.id
  limit 1;
  return ws;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- accept_invitations: quien invitó se revisa sin mirar el borrado
-- ---------------------------------------------------------------------------------------------------
-- Igual que en la migración del equipo, salvo las dos revisiones de quien invitó, que usan las versiones `_any`:
-- una invitación a un proyecto borrado guarda su permiso (sin efecto mientras esté borrado) y vale al restaurarlo.
create or replace function public.accept_invitations()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  em  text;
  inv public.invitations;
  cur public.members;
  el  jsonb;
  tgt uuid;
  n   int := 0;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.session_allowed() then
    raise exception 'session_not_allowed' using errcode = '42501',
      hint = 'Sign in with the code sent by email.';
  end if;
  select lower(u.email) into em from auth.users u where u.id = uid and u.email_confirmed_at is not null;
  if em is null then
    return 0;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('invitation:' || em, 0));

  for inv in select * from private.live_invitations(em) i order by i.created_at, i.id loop
    select * into cur from public.members m where m.user_id = uid for update;
    if not found then
      insert into public.members (user_id, role, added_by) values (uid, inv.role, inv.invited_by);
    elsif cur.removed_at is not null then
      update public.grants set revoked_at = now(), revoked_by = inv.invited_by
      where user_id = uid and revoked_at is null;
      update public.members set role = inv.role, removed_at = null, added_by = inv.invited_by
      where user_id = uid;
    elsif cur.role <> 'owner' and private.role_rank(inv.role) > private.role_rank(cur.role) then
      update public.members set role = inv.role where user_id = uid;
    end if;

    for el in select * from jsonb_array_elements(inv.grants) loop
      if el ? 'project_id' then
        tgt := (el ->> 'project_id')::uuid;
        continue when private.user_project_level_any(tgt, inv.invited_by) < 4;
        insert into public.grants as g (user_id, project_id, level, granted_by)
        values (uid, tgt, el ->> 'level', inv.invited_by)
        on conflict (user_id, project_id) where project_id is not null
        do update set level = excluded.level, granted_by = excluded.granted_by, revoked_at = null, revoked_by = null
        where g.revoked_at is not null
           or private.grant_level_value(excluded.level) > private.grant_level_value(g.level);
      else
        tgt := (el ->> 'page_id')::uuid;
        continue when private.user_page_level_any(tgt, inv.invited_by) < 4;
        insert into public.grants as g (user_id, page_id, level, granted_by)
        values (uid, tgt, el ->> 'level', inv.invited_by)
        on conflict (user_id, page_id) where page_id is not null
        do update set level = excluded.level, granted_by = excluded.granted_by, revoked_at = null, revoked_by = null
        where g.revoked_at is not null
           or private.grant_level_value(excluded.level) > private.grant_level_value(g.level);
      end if;
    end loop;

    update public.invitations set used_at = now(), used_by = uid where id = inv.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- project_sizes: el peso de los borrados, a quien puede restaurarlos
-- ---------------------------------------------------------------------------------------------------
-- Igual que en la migración del peso, salvo la puerta de un proyecto borrado (`can_see_file_trash` daría no):
-- `can_manage_project`. Mientras está borrado, sus archivos están en la papelera de la app (estado `trash`) y
-- siguen sumando en el número principal si están subidos: siguen ocupando el Drive.
create or replace function public.project_sizes()
returns table (project_id uuid,
               drive_bytes bigint, drive_files int,
               trash_bytes bigint, trash_files int,
               drive_trash_bytes bigint, drive_trash_files int,
               pending_bytes bigint, pending_files int)
language sql stable security definer set search_path = ''
as $$
  with gate as materialized (
    select w.id,
           case when w.deleted_at is null then private.can_see_file_trash(w.id)
                else private.can_manage_project(w.id) end as allowed
    from public.workspaces w
  ),
  me as materialized (
    select coalesce(private.workspace_role() = 'owner', false) as is_owner
  ),
  state as (
    select f.project_id, f.size, f.drive_id is not null as uploaded,
           case
             when f.drive_trashed_at is not null then
               case when f.drive_id is not null
                         and greatest(f.drive_trashed_at, f.uploaded_at) > now() - interval '30 days'
                    then 'drive_trash' end
             when f.trashed_at is not null then 'trash'
             when f.drive_id is null then 'pending'
             else 'live'
           end as st
    from public.files f
    join gate g on g.id = f.project_id
    where g.allowed or (select me.is_owner from me)
  ),
  per_project as (
    select s.project_id,
           coalesce(sum(s.size) filter (where s.st = 'live' or (s.st = 'trash' and s.uploaded)), 0)::bigint as drive_bytes,
           (count(*) filter (where s.st = 'live' or (s.st = 'trash' and s.uploaded)))::int as drive_files,
           coalesce(sum(s.size) filter (where s.st = 'trash'), 0)::bigint as trash_bytes,
           (count(*) filter (where s.st = 'trash'))::int as trash_files,
           coalesce(sum(s.size) filter (where s.st = 'drive_trash'), 0)::bigint as drive_trash_bytes,
           (count(*) filter (where s.st = 'drive_trash'))::int as drive_trash_files,
           coalesce(sum(s.size) filter (where s.st = 'pending'), 0)::bigint as pending_bytes,
           (count(*) filter (where s.st = 'pending'))::int as pending_files
    from state s
    group by s.project_id
  )
  select g.id,
         coalesce(p.drive_bytes, 0::bigint), coalesce(p.drive_files, 0),
         coalesce(p.trash_bytes, 0::bigint), coalesce(p.trash_files, 0),
         coalesce(p.drive_trash_bytes, 0::bigint), coalesce(p.drive_trash_files, 0),
         coalesce(p.pending_bytes, 0::bigint), coalesce(p.pending_files, 0)
  from gate g
  left join per_project p on p.project_id = g.id
  where g.allowed
  union all
  -- Los que no ve, todos juntos y sin nombres: solo el dueño.
  select null::uuid,
         coalesce(sum(p.drive_bytes), 0)::bigint, coalesce(sum(p.drive_files), 0)::int,
         coalesce(sum(p.trash_bytes), 0)::bigint, coalesce(sum(p.trash_files), 0)::int,
         coalesce(sum(p.drive_trash_bytes), 0)::bigint, coalesce(sum(p.drive_trash_files), 0)::int,
         coalesce(sum(p.pending_bytes), 0)::bigint, coalesce(sum(p.pending_files), 0)::int
  from gate g
  left join per_project p on p.project_id = g.id
  where not g.allowed and (select me.is_owner from me)
  having count(*) > 0;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Versión de la base
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 9 where id and schema_version < 9;

notify pgrst, 'reload schema';
```

Notas para la auditoría:

- `create or replace` conserva los permisos de cada función que ya existía (`page_alive` sigue sin `execute`
  para `authenticated`; `user_page_level` y `user_project_level` también).
- Las funciones `sql` del esquema `private` se buscan por nombre al correr: `page_level` y `project_level`
  llaman a las versiones nuevas sin cambiarlas.
- `delete_project` y `restore_project` bloquean la fila del proyecto y después las de los archivos en orden de
  id (`refresh_project_files`), como el trigger `pages_file_trash`: un borrado y una página que entra a la
  papelera a la vez no se cruzan. Un `push_page_update` que ya pasó su control de permiso antes del borrado
  termina y queda guardado: no se pierde nada.
- **Tiempo:** `refresh_project_files` hace un `refresh_file_trash` por archivo (bloquea la fila y mira sus usos).
  Para un proyecto como la importación de Coda (unos 2300 archivos) son unos pocos miles de búsquedas por
  índice, bien adentro del tope de 8 s de las consultas de la API (`authenticated`), pero **hay que medirlo**
  en la prueba con la base real (sección 9). Con decenas de miles de archivos haría falta partirlo en tandas.

### 1.4 La prueba SQL, completa

`supabase/tests/proyectos_borrar_permisos.sql` (propuesta; sin ejecutar). Huella antes de borrar y después de
restaurar (la regla "exactamente como estaba"), cada persona con lo que ve y lo que no, la papelera de archivos
y el peso mientras está borrado, la invitación aceptada en el medio y que nada se escribe directo.

```sql
-- Pruebas de archivar y borrar proyectos (P.14, Docs/Doc_Proyectos_Borrar.md): quién archiva, borra y restaura;
-- que con el proyecto borrado nadie lo ve ni lo escribe por ningún camino (también quien creó un archivo); la
-- papelera de archivos y el peso mientras tanto; que restaurar deja todo exactamente como estaba (una huella
-- antes y después); una invitación aceptada mientras estaba borrado; y que las marcas no se escriben desde la
-- API. Corre dentro de una transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa,
-- devuelve una fila con result = 'ok'.

begin;

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Una sesión con su `amr` (cómo entró): con contraseña no es miembro de nada.
create function pg_temp.as_session(uid uuid, amr jsonb) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'amr', amr)::text, true);
$$;

-- Corre `stmt` y exige que falle con ese mensaje o ese código (sqlstate).
create function pg_temp.expect_error(stmt text, expected text, what text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm = expected or sqlstate = expected then
      return;
    end if;
    raise exception 'FALLA: % (dio % %)', what, sqlstate, sqlerrm;
  end;
  raise exception 'FALLA: %', what;
end;
$$;

-- Cuántas filas de `workspaces` ve la sesión con ese id.
create function pg_temp.sees(p uuid) returns int language sql as $$
  select count(*)::int from public.workspaces w where w.id = p;
$$;

-- El peso de un proyecto como lo ve la sesión: principal, papelera de la app, papelera de Drive y sin subir.
create function pg_temp.size_of(p uuid) returns text language sql as $$
  select format('%s/%s %s/%s %s/%s %s/%s', s.drive_bytes, s.drive_files, s.trash_bytes, s.trash_files,
                s.drive_trash_bytes, s.drive_trash_files, s.pending_bytes, s.pending_files)
  from public.project_sizes() s where s.project_id = p;
$$;

-- Todo lo de la prueba que restaurar tiene que dejar igual, en una huella (solo las filas de la prueba: la base
-- real puede cambiar mientras corre).
create function pg_temp.fingerprint() returns text language sql as $$
  select md5(concat_ws('|',
    (select string_agg(w::text, ',' order by w.id) from public.workspaces w
      where w.id::text like '00000000-0000-4000-8000-0000000d1%'),
    (select string_agg(pg::text, ',' order by pg.id) from public.pages pg
      where pg.id::text like '00000000-0000-4000-8000-0000000d2%'),
    (select string_agg(u::text, ',' order by u.id) from public.page_updates u
      where u.page_id::text like '00000000-0000-4000-8000-0000000d2%'),
    (select string_agg(f::text, ',' order by f.id) from public.files f
      where f.id::text like '00000000-0000-4000-8000-0000000d3%'),
    (select string_agg(pf::text, ',' order by pf.page_id, pf.file_id) from public.page_files pf
      where pf.file_id::text like '00000000-0000-4000-8000-0000000d3%'),
    (select string_agg(c::text, ',' order by c.id) from public.comments c
      where c.id::text like '00000000-0000-4000-8000-0000000d4%'),
    (select string_agg(g::text, ',' order by g.id) from public.grants g
      where g.user_id::text like '00000000-0000-4000-8000-0000000d0%'),
    (select string_agg(m::text, ',' order by m.user_id) from public.members m
      where m.user_id::text like '00000000-0000-4000-8000-0000000d0%')));
$$;

-- Personas (todas con correo @test.invalid):
--   ow   dueña del workspace; creó P y O           ad   admin con editar y crear páginas sobre P
--   av   admin con ver sobre P                      ep   miembro con editar y crear páginas sobre P
--   mc   miembro que creó M (con editar y crear sobre M, como las cuentas de antes del paso 5)
--   gu   invitada con ver la página p1              ad2  admin sin permiso sobre P
--   rx   miembro con editar y crear sobre P, sacada nu   invitada nueva (sin fila en members)
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000d0001', 'pb-ow@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000d0002', 'pb-ad@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000d0003', 'pb-av@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000d0004', 'pb-ep@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000d0005', 'pb-mc@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000d0006', 'pb-gu@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000d0007', 'pb-ad2@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000d0008', 'pb-rx@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000d0009', 'pb-nu@test.invalid', 'authenticated', 'authenticated', now());

-- Si la base ya tiene dueño, queda fuera de la prueba (se deshace al final): hay un solo dueño activo. Sin versión
-- mínima ni purga automática dentro de la prueba.
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
update public.workspace_settings
set owner_id = '00000000-0000-4000-8000-0000000d0001', min_app_version = null, auto_purge_files = false;

insert into public.members (user_id, role, removed_at) values
  ('00000000-0000-4000-8000-0000000d0001', 'owner', null),
  ('00000000-0000-4000-8000-0000000d0002', 'admin', null),
  ('00000000-0000-4000-8000-0000000d0003', 'admin', null),
  ('00000000-0000-4000-8000-0000000d0004', 'member', null),
  ('00000000-0000-4000-8000-0000000d0005', 'member', null),
  ('00000000-0000-4000-8000-0000000d0006', 'guest', null),
  ('00000000-0000-4000-8000-0000000d0007', 'admin', null),
  ('00000000-0000-4000-8000-0000000d0008', 'member', now());

-- P (el más viejo de la dueña), O y M.
insert into public.workspaces (id, owner_id, name, created_at) values
  ('00000000-0000-4000-8000-0000000d1001', '00000000-0000-4000-8000-0000000d0001', 'P', now() - interval '2 days'),
  ('00000000-0000-4000-8000-0000000d1002', '00000000-0000-4000-8000-0000000d0001', 'O', now() - interval '1 day'),
  ('00000000-0000-4000-8000-0000000d1003', '00000000-0000-4000-8000-0000000d0005', 'M', now() - interval '1 day');

-- p1 y su hija p2 en P; p3 en P, en la papelera de páginas; o1 en O; m1 en M.
insert into public.pages (id, workspace_id, parent_id, title, sort_key, deleted_at) values
  ('00000000-0000-4000-8000-0000000d2001', '00000000-0000-4000-8000-0000000d1001', null, 'p1', 'a0', null);
insert into public.pages (id, workspace_id, parent_id, title, sort_key, deleted_at) values
  ('00000000-0000-4000-8000-0000000d2002', '00000000-0000-4000-8000-0000000d1001',
   '00000000-0000-4000-8000-0000000d2001', 'p2', 'a0', null),
  ('00000000-0000-4000-8000-0000000d2003', '00000000-0000-4000-8000-0000000d1001', null, 'p3', 'a1',
   now() - interval '1 day'),
  ('00000000-0000-4000-8000-0000000d2004', '00000000-0000-4000-8000-0000000d1002', null, 'o1', 'a0', null),
  ('00000000-0000-4000-8000-0000000d2005', '00000000-0000-4000-8000-0000000d1003', null, 'm1', 'a0', null);

insert into public.grants (user_id, project_id, page_id, level) values
  ('00000000-0000-4000-8000-0000000d0002', '00000000-0000-4000-8000-0000000d1001', null, 'edit_pages'),
  ('00000000-0000-4000-8000-0000000d0003', '00000000-0000-4000-8000-0000000d1001', null, 'view'),
  ('00000000-0000-4000-8000-0000000d0004', '00000000-0000-4000-8000-0000000d1001', null, 'edit_pages'),
  ('00000000-0000-4000-8000-0000000d0005', '00000000-0000-4000-8000-0000000d1003', null, 'edit_pages'),
  ('00000000-0000-4000-8000-0000000d0006', null, '00000000-0000-4000-8000-0000000d2001', 'view'),
  ('00000000-0000-4000-8000-0000000d0008', '00000000-0000-4000-8000-0000000d1001', null, 'edit_pages');

-- Archivos (los pesos no se pisan: cada suma dice qué entró):
--   f1  de P, en uso en p1, subido, lo creó la dueña                          1.000
--   f2  de P, solo en p3 (papelera de páginas): ya estaba en la papelera     20.000
--   f3  de O, usado solo en p2 (uso de afuera), subido, lo creó la dueña  50.000.000
--   f4  de P, en uso en p2 y además en o1 (uso de afuera), subido           300.000
--   f5  de P, en uso en p1, todavía sin subir                             4.000.000
insert into public.files (id, project_id, name, mime, size, drive_id, uploaded_at, created_by) values
  ('00000000-0000-4000-8000-0000000d3001', '00000000-0000-4000-8000-0000000d1001', 'f1.jpg', 'image/jpeg', 1000,
   'drive_f1_xxxxxxxx', now() - interval '5 days', '00000000-0000-4000-8000-0000000d0001'),
  ('00000000-0000-4000-8000-0000000d3002', '00000000-0000-4000-8000-0000000d1001', 'f2.jpg', 'image/jpeg', 20000,
   'drive_f2_xxxxxxxx', now() - interval '5 days', null),
  ('00000000-0000-4000-8000-0000000d3003', '00000000-0000-4000-8000-0000000d1002', 'f3.jpg', 'image/jpeg', 50000000,
   'drive_f3_xxxxxxxx', now() - interval '5 days', '00000000-0000-4000-8000-0000000d0001'),
  ('00000000-0000-4000-8000-0000000d3004', '00000000-0000-4000-8000-0000000d1001', 'f4.jpg', 'image/jpeg', 300000,
   'drive_f4_xxxxxxxx', now() - interval '5 days', null),
  ('00000000-0000-4000-8000-0000000d3005', '00000000-0000-4000-8000-0000000d1001', 'f5.mov', 'video/quicktime', 4000000,
   null, null, null);
insert into public.page_files (page_id, file_id, is_foreign) values
  ('00000000-0000-4000-8000-0000000d2001', '00000000-0000-4000-8000-0000000d3001', false),
  ('00000000-0000-4000-8000-0000000d2003', '00000000-0000-4000-8000-0000000d3002', false),
  ('00000000-0000-4000-8000-0000000d2002', '00000000-0000-4000-8000-0000000d3003', true),
  ('00000000-0000-4000-8000-0000000d2002', '00000000-0000-4000-8000-0000000d3004', false),
  ('00000000-0000-4000-8000-0000000d2004', '00000000-0000-4000-8000-0000000d3004', true),
  ('00000000-0000-4000-8000-0000000d2001', '00000000-0000-4000-8000-0000000d3005', false);
-- f2 entró a la papelera al registrar su uso; se le da una fecha propia para ver que restaurar la conserva.
update public.files set trashed_at = now() - interval '3 days' where id = '00000000-0000-4000-8000-0000000d3002';

do $$
begin
  assert (select array_agg(f.id order by f.id) from public.files f
          where f.id::text like '00000000-0000-4000-8000-0000000d3%' and f.trashed_at is not null)
         = array['00000000-0000-4000-8000-0000000d3002']::uuid[],
    'preparación: la papelera de archivos no quedó como se esperaba';
end;
$$;

-- Contenido y un comentario en p1, como la dueña.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
select public.push_page_update('00000000-0000-4000-8000-0000000d2001', '00000000-0000-4000-8000-0000000d5001',
                               'AQ==', '9.999');
select public.add_comment('00000000-0000-4000-8000-0000000d4001', '00000000-0000-4000-8000-0000000d2001',
                          null, null, 'Un comentario en p1');
select set_config('role', 'postgres', true);

-- ---------------------------------------------------------------------------------------------------
-- A. Archivar: quién puede, que no cambia permisos, ensure_workspace
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$
begin
  perform pg_temp.expect_error($q$select public.set_project_archived('00000000-0000-4000-8000-0000000d1001', true)$q$,
    'not_allowed', 'un miembro con editar y crear (sin ser admin ni creador) archiva P');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0003');
do $$
begin
  perform pg_temp.expect_error($q$select public.set_project_archived('00000000-0000-4000-8000-0000000d1001', true)$q$,
    'not_allowed', 'una admin con ver archiva P');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0006');
do $$
begin
  perform pg_temp.expect_error($q$select public.set_project_archived('00000000-0000-4000-8000-0000000d1001', true)$q$,
    'not_allowed', 'la invitada archiva P');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0007');
do $$
begin
  perform pg_temp.expect_error($q$select public.set_project_archived('00000000-0000-4000-8000-0000000d1001', true)$q$,
    'project_not_found', 'una admin sin permiso sobre P lo archiva (o se entera de que existe)');
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
declare
  first_at timestamptz;
begin
  assert public.ensure_workspace() = '00000000-0000-4000-8000-0000000d1001', 'ensure_workspace no da P antes de archivar';
  perform public.set_project_archived('00000000-0000-4000-8000-0000000d1001', true);
  select w.archived_at into first_at from public.workspaces w where w.id = '00000000-0000-4000-8000-0000000d1001';
  assert first_at is not null, 'P no quedó archivado';
  perform public.set_project_archived('00000000-0000-4000-8000-0000000d1001', true);
  assert (select w.archived_at from public.workspaces w where w.id = '00000000-0000-4000-8000-0000000d1001') = first_at,
    'archivar dos veces cambió la fecha';
  assert (select w.archived_by from public.workspaces w where w.id = '00000000-0000-4000-8000-0000000d1001')
         = '00000000-0000-4000-8000-0000000d0001', 'archived_by no es la dueña';
  -- Prefiere un proyecto no archivado.
  assert public.ensure_workspace() = '00000000-0000-4000-8000-0000000d1002', 'ensure_workspace da el archivado';
  perform pg_temp.expect_error($q$select public.set_project_archived('00000000-0000-4000-8000-0000000d1001', null)$q$,
    'archived_invalid', 'archivar con null');
end;
$$;

-- Archivado no cambia permisos: el miembro con editar y crear lo ve y edita igual.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$
begin
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1001') = 1, 'archivado, el miembro no ve P';
  assert private.page_level('00000000-0000-4000-8000-0000000d2001') = 4, 'archivado, el miembro perdió permisos en p1';
  update public.pages set title = 'p1 editada' where id = '00000000-0000-4000-8000-0000000d2001';
  assert (select title from public.pages where id = '00000000-0000-4000-8000-0000000d2001') = 'p1 editada',
    'archivado, el miembro no edita p1';
  update public.pages set title = 'p1' where id = '00000000-0000-4000-8000-0000000d2001';
end;
$$;

-- El creador de un proyecto (miembro, sin ser admin) archiva y desarchiva el suyo.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0005');
do $$
begin
  perform public.set_project_archived('00000000-0000-4000-8000-0000000d1003', true);
  perform public.set_project_archived('00000000-0000-4000-8000-0000000d1003', false);
  assert (select w.archived_at from public.workspaces w where w.id = '00000000-0000-4000-8000-0000000d1003') is null,
    'el creador no desarchiva M';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- B. Antes de borrar: lo que muestra la ventana, la huella y quién puede borrar
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
declare
  i json := public.project_delete_info('00000000-0000-4000-8000-0000000d1001');
begin
  assert (i ->> 'pages')::int = 2 and (i ->> 'trashed_pages')::int = 1, format('páginas: %s', i);
  -- Subidos fuera de la papelera de Drive: f1, f2 (en la papelera de la app) y f4.
  assert (i ->> 'files')::int = 3 and (i ->> 'drive_bytes')::bigint = 321000, format('archivos: %s', i);
  assert (i ->> 'pending_files')::int = 1, format('sin subir: %s', i);
  -- f4 se usa también en o1.
  assert (i ->> 'used_elsewhere')::int = 1, format('usados en otros proyectos: %s', i);
  -- ad, av, ep y gu (rx está sacada; la dueña es quien pregunta).
  assert (i ->> 'shared_with')::int = 4, format('compartido con: %s', i);
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') = '321000/3 20000/1 0/0 4000000/1',
    format('peso de P antes: %s', pg_temp.size_of('00000000-0000-4000-8000-0000000d1001'));
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1002') = '50000000/1 0/0 0/0 0/0',
    format('peso de O antes: %s', pg_temp.size_of('00000000-0000-4000-8000-0000000d1002'));
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$
begin
  perform pg_temp.expect_error($q$select public.project_delete_info('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'un miembro sin manejar P lee la ventana de borrar');
end;
$$;

select set_config('role', 'postgres', true);
select set_config('borrar.antes', pg_temp.fingerprint(), true);

-- Quién no puede borrar P.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$ begin
  perform pg_temp.expect_error($q$select public.delete_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'un miembro con editar y crear borra P');
end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0003');
do $$ begin
  perform pg_temp.expect_error($q$select public.delete_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'una admin con ver borra P');
end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0006');
do $$ begin
  perform pg_temp.expect_error($q$select public.delete_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'la invitada borra P');
end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0007');
do $$ begin
  perform pg_temp.expect_error($q$select public.delete_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_not_found', 'una admin sin permiso sobre P lo borra');
end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0008');
do $$ begin
  perform pg_temp.expect_error($q$select public.delete_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_not_found', 'la sacada borra P');
end; $$;
select pg_temp.as_session('00000000-0000-4000-8000-0000000d0001', '[{"method": "password", "timestamp": 1790000000}]');
do $$ begin
  perform pg_temp.expect_error($q$select public.delete_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_not_found', 'la dueña con una sesión de contraseña borra P');
  assert (select count(*) from public.trashed_projects()) = 0, 'con contraseña ve la papelera de proyectos';
end; $$;

-- La dueña lo borra; repetirlo devuelve la misma fecha.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
select set_config('borrar.cuando', public.delete_project('00000000-0000-4000-8000-0000000d1001')::text, true);
do $$
begin
  assert public.delete_project('00000000-0000-4000-8000-0000000d1001') = current_setting('borrar.cuando')::timestamptz,
    'borrar dos veces dio otra fecha';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- C. Con P borrado
-- ---------------------------------------------------------------------------------------------------
-- La dueña (su creadora): no lo ve por ningún camino, ni lo escribe.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
declare
  n int;
  r record;
begin
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1001') = 0, 'la dueña ve P borrado';
  assert (select count(*) from public.pages pg where pg.workspace_id = '00000000-0000-4000-8000-0000000d1001') = 0,
    'la dueña ve páginas de P';
  assert (select count(*) from public.page_updates u where u.page_id = '00000000-0000-4000-8000-0000000d2001') = 0,
    'la dueña ve el contenido de p1';
  assert (select count(*) from public.comments c where c.page_id = '00000000-0000-4000-8000-0000000d2001') = 0,
    'la dueña ve los comentarios de p1';
  -- f1 lo creó ella: igual no lo ve.
  assert (select count(*) from public.files f where f.project_id = '00000000-0000-4000-8000-0000000d1001') = 0,
    'la dueña ve archivos de P';
  assert public.media_file('00000000-0000-4000-8000-0000000d3001') is null, 'media_file da f1 (el portero lo serviría)';
  assert private.page_level('00000000-0000-4000-8000-0000000d2001') = 0 and
         private.project_level('00000000-0000-4000-8000-0000000d1001') = 0, 'la dueña tiene nivel sobre P';
  perform pg_temp.expect_error($q$select * from public.pull_page_updates('00000000-0000-4000-8000-0000000d2001', 0)$q$,
    'page_not_found', 'baja el contenido de p1');
  perform pg_temp.expect_error($q$select public.push_page_update('00000000-0000-4000-8000-0000000d2001',
    gen_random_uuid(), 'AQ==', '9.999')$q$, 'page_not_found', 'sube contenido a p1');
  perform pg_temp.expect_error($q$select * from public.list_comments('00000000-0000-4000-8000-0000000d2001')$q$,
    'page_not_found', 'lee los comentarios de p1');
  perform pg_temp.expect_error($q$select public.add_comment(gen_random_uuid(), '00000000-0000-4000-8000-0000000d2001',
    null, null, 'otro')$q$, 'page_not_found', 'comenta en p1');
  perform pg_temp.expect_error($q$select public.register_file(gen_random_uuid(), '00000000-0000-4000-8000-0000000d2001',
    'x.jpg', 'image/jpeg', 10, null, null, null)$q$, 'page_not_found', 'registra un archivo en p1');
  perform pg_temp.expect_error($q$insert into public.pages (id, workspace_id, parent_id, title, sort_key)
    values (gen_random_uuid(), '00000000-0000-4000-8000-0000000d1001', null, 'nueva', 'b0')$q$,
    '42501', 'crea una página en P');
  update public.pages set title = 'cambiada' where id = '00000000-0000-4000-8000-0000000d2001';
  get diagnostics n = row_count;
  assert n = 0, 'cambia el título de p1';
  update public.workspaces set name = 'cambiado' where id = '00000000-0000-4000-8000-0000000d1001';
  get diagnostics n = row_count;
  assert n = 0, 'renombra P';
  perform pg_temp.expect_error($q$select * from public.trashed_files('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 've la papelera de archivos de P');
  perform pg_temp.expect_error($q$select public.share('00000000-0000-4000-8000-0000000d0004',
    '00000000-0000-4000-8000-0000000d1001', null, 'view')$q$, 'not_allowed', 'comparte P');
  assert public.ensure_workspace() = '00000000-0000-4000-8000-0000000d1002', 'ensure_workspace da P borrado';
  -- Crear con el mismo id (lo que hace la app vieja al reintentar): no falla y P sigue borrado.
  insert into public.workspaces (id, name) values ('00000000-0000-4000-8000-0000000d1001', 'P otra vez')
  on conflict (id) do nothing;

  -- La papelera de proyectos: P, que ella puede restaurar.
  select * into r from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1001';
  assert found and r.can_restore and r.deleted_by = '00000000-0000-4000-8000-0000000d0001'
         and r.deleted_by_email = 'pb-ow@test.invalid' and r.days_left = 30 and r.archived_at is not null
         and r.pages = 2 and r.files = 4, format('papelera de proyectos de la dueña: %s', r);

  -- El peso: f1 y f5 entraron a la papelera de la app (f5 sin subir: solo ahí); f4 sigue en uso por o1.
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') = '321000/3 4021000/3 0/0 0/0',
    format('peso de P borrado: %s', pg_temp.size_of('00000000-0000-4000-8000-0000000d1001'));
  -- f3 (de O) se usaba solo en p2: entra a la papelera de O, marcado como usado por una página que no está viva.
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1002') = '50000000/1 50000000/1 0/0 0/0',
    format('peso de O con P borrado: %s', pg_temp.size_of('00000000-0000-4000-8000-0000000d1002'));
  select * into r from public.trashed_files('00000000-0000-4000-8000-0000000d1002') t
  where t.id = '00000000-0000-4000-8000-0000000d3003';
  assert found and r.in_trashed_page and r.trashed_page_title is null,
    format('f3 en la papelera de O: %s', r);
end;
$$;

-- Fuera de "vaciar" y de la purga automática mientras P esté borrado, aunque tenga más de 30 días.
select set_config('role', 'postgres', true);
update public.files set trashed_at = now() - interval '40 days' where id = '00000000-0000-4000-8000-0000000d3003';
update public.workspace_settings set auto_purge_files = true;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
begin
  assert not exists (select 1 from public.files_due_for_purge('00000000-0000-4000-8000-0000000d1002') d
                     where d.id = '00000000-0000-4000-8000-0000000d3003'),
    'la purga automática toma un archivo usado por una página de un proyecto borrado';
end;
$$;
select set_config('role', 'postgres', true);
update public.workspace_settings set auto_purge_files = false;
do $$
begin
  -- Ninguna fila se borró y P sigue borrado con su nombre de antes.
  assert (select count(*) from public.pages where workspace_id = '00000000-0000-4000-8000-0000000d1001') = 3,
    'se borraron páginas';
  assert (select count(*) from public.files where id::text like '00000000-0000-4000-8000-0000000d3%') = 5,
    'se borraron archivos';
  assert (select w.name = 'P' and w.deleted_at is not null from public.workspaces w
          where w.id = '00000000-0000-4000-8000-0000000d1001'), 'el upsert cambió P';
end;
$$;

-- La admin con editar y crear: no lo ve, pero lo puede restaurar y ve su peso.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
do $$
begin
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1001') = 0, 'la admin ve P borrado';
  assert (select t.can_restore from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1001'),
    'la admin no puede restaurar P';
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') = '321000/3 4021000/3 0/0 0/0',
    'la admin no ve el peso de P borrado';
end;
$$;

-- Los que lo veían sin poder restaurarlo: lo ven en la papelera de proyectos, sin restaurar, y nada más.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0003');
do $$
begin
  assert (select not t.can_restore from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1001'),
    'la admin con ver no lo ve en la papelera de proyectos, o lo puede restaurar';
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') is null, 'la admin con ver ve el peso de P borrado';
  perform pg_temp.expect_error($q$select public.restore_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'la admin con ver restaura P');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$
begin
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1001') = 0, 'el miembro ve P borrado';
  assert private.page_level('00000000-0000-4000-8000-0000000d2001') = 0, 'el miembro tiene nivel sobre p1';
  assert (select not t.can_restore from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1001'),
    'el miembro no lo ve en la papelera de proyectos, o lo puede restaurar';
  assert public.ensure_workspace() is null, 'ensure_workspace da al miembro un proyecto borrado';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0006');
do $$
begin
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1001') = 0, 'la invitada ve P borrado';
  assert (select count(*) from public.pages pg where pg.id = '00000000-0000-4000-8000-0000000d2001') = 0,
    'la invitada ve p1';
  assert (select not t.can_restore from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1001'),
    'la invitada no lo ve en la papelera de proyectos, o lo puede restaurar';
end;
$$;
-- Los que nunca lo vieron: tampoco en la papelera de proyectos.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0007');
do $$
begin
  assert not exists (select 1 from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1001'),
    'la admin sin permiso ve P en la papelera de proyectos';
  perform pg_temp.expect_error($q$select public.restore_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_not_found', 'la admin sin permiso restaura P');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0008');
do $$
begin
  assert (select count(*) from public.trashed_projects()) = 0, 'la sacada ve la papelera de proyectos';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- D. Restaurar: todo exactamente como estaba
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$ begin
  perform pg_temp.expect_error($q$select public.restore_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'un miembro con editar y crear restaura P');
end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
select public.restore_project('00000000-0000-4000-8000-0000000d1001');
select public.restore_project('00000000-0000-4000-8000-0000000d1001');
select set_config('role', 'postgres', true);
do $$
begin
  assert pg_temp.fingerprint() = current_setting('borrar.antes'), 'restaurar no dejó todo como estaba';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$
begin
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1001') = 1, 'restaurado, el miembro no ve P';
  assert private.page_level('00000000-0000-4000-8000-0000000d2001') = 4, 'restaurado, el miembro no tiene 4 en p1';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0006');
do $$
begin
  assert (select count(*) from public.pages pg where pg.id = '00000000-0000-4000-8000-0000000d2001') = 1,
    'restaurado, la invitada no ve p1';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
begin
  assert (select count(*) from public.files f where f.project_id = '00000000-0000-4000-8000-0000000d1001') = 4,
    'restaurado, la dueña no ve los archivos de P';
  assert public.media_file('00000000-0000-4000-8000-0000000d3001') is not null, 'restaurado, media_file no da f1';
  assert (select count(*) from public.list_comments('00000000-0000-4000-8000-0000000d2001')) = 1,
    'restaurado, no está el comentario';
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') = '321000/3 20000/1 0/0 4000000/1',
    'restaurado, el peso de P no es el de antes';
  -- Sigue archivado (como estaba antes de borrarlo): ensure_workspace sigue dando O.
  assert public.ensure_workspace() = '00000000-0000-4000-8000-0000000d1002', 'restaurado, P dejó de estar archivado';
  -- E. Desarchivar.
  perform public.set_project_archived('00000000-0000-4000-8000-0000000d1001', false);
  assert public.ensure_workspace() = '00000000-0000-4000-8000-0000000d1001', 'desarchivado, ensure_workspace no da P';
end;
$$;

-- El creador (miembro) borra y restaura el suyo.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0005');
do $$
begin
  perform public.delete_project('00000000-0000-4000-8000-0000000d1003');
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1003') = 0, 'el creador ve M borrado';
  assert (select t.can_restore from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1003'),
    'el creador no puede restaurar M';
  perform public.restore_project('00000000-0000-4000-8000-0000000d1003');
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1003') = 1, 'el creador no recuperó M';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- F. Una invitación aceptada mientras el proyecto está borrado vale al restaurarlo
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
select public.create_invitation('pb-nu@test.invalid', 'guest',
  jsonb_build_array(jsonb_build_object('project_id', '00000000-0000-4000-8000-0000000d1001', 'level', 'view')));
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
select public.delete_project('00000000-0000-4000-8000-0000000d1001');
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0009');
do $$
begin
  assert public.accept_invitations() = 1, 'la invitada nueva no aplicó su invitación';
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1001') = 0, 'la invitada nueva ve P borrado';
end;
$$;
select set_config('role', 'postgres', true);
do $$
begin
  assert exists (select 1 from public.grants g
                 where g.user_id = '00000000-0000-4000-8000-0000000d0009'
                   and g.project_id = '00000000-0000-4000-8000-0000000d1001'
                   and g.level = 'view' and g.revoked_at is null),
    'el permiso de la invitación se perdió por estar P borrado';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
select public.restore_project('00000000-0000-4000-8000-0000000d1001');
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0009');
do $$
begin
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1001') = 1, 'restaurado, la invitada nueva no ve P';
  assert private.page_level('00000000-0000-4000-8000-0000000d2001') = 1, 'restaurado, la invitada nueva no ve p1';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- G. Las marcas no se escriben desde la API, y nada se borra
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
begin
  perform pg_temp.expect_error($q$update public.workspaces set deleted_at = now()
    where id = '00000000-0000-4000-8000-0000000d1001'$q$, '42501', 'marca el borrado directo');
  perform pg_temp.expect_error($q$update public.workspaces set archived_at = now()
    where id = '00000000-0000-4000-8000-0000000d1001'$q$, '42501', 'marca el archivado directo');
  perform pg_temp.expect_error($q$insert into public.workspaces (id, name, deleted_at)
    values ('00000000-0000-4000-8000-0000000d1009', 'X', now())$q$, '42501', 'crea un proyecto ya borrado');
  perform pg_temp.expect_error($q$delete from public.workspaces where id = '00000000-0000-4000-8000-0000000d1001'$q$,
    '42501', 'borra un proyecto desde la API');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- H. Sin sesión, nada; y cómo quedaron las funciones
-- ---------------------------------------------------------------------------------------------------
select set_config('role', 'anon', true);
select set_config('request.jwt.claims', '', true);
do $$
begin
  perform pg_temp.expect_error($q$select * from public.trashed_projects()$q$, '42501', 'anon ve la papelera de proyectos');
  perform pg_temp.expect_error($q$select public.delete_project('00000000-0000-4000-8000-0000000d1001')$q$,
    '42501', 'anon borra');
  perform pg_temp.expect_error($q$select public.restore_project('00000000-0000-4000-8000-0000000d1001')$q$,
    '42501', 'anon restaura');
  perform pg_temp.expect_error($q$select public.set_project_archived('00000000-0000-4000-8000-0000000d1001', true)$q$,
    '42501', 'anon archiva');
  perform pg_temp.expect_error($q$select public.project_delete_info('00000000-0000-4000-8000-0000000d1001')$q$,
    '42501', 'anon lee la ventana de borrar');
end;
$$;

select set_config('role', 'postgres', true);
do $$
declare
  fn text;
begin
  foreach fn in array array['public.delete_project(uuid)', 'public.restore_project(uuid)',
                            'public.set_project_archived(uuid,boolean)', 'public.trashed_projects()',
                            'public.project_delete_info(uuid)', 'private.can_manage_project(uuid)',
                            'private.could_view_project(uuid,uuid)', 'private.refresh_project_files(uuid)',
                            'private.user_page_level_any(uuid,uuid)', 'private.user_project_level_any(uuid,uuid)'] loop
    assert (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
            where p.oid = fn::regprocedure), format('%s no es security definer con search_path vacío', fn);
  end loop;
  assert not has_function_privilege('authenticated', 'private.refresh_project_files(uuid)', 'execute'),
    'authenticated puede recalcular la papelera de un proyecto';
  assert not has_function_privilege('authenticated', 'private.user_page_level_any(uuid,uuid)', 'execute'),
    'authenticated llama a user_page_level_any';
  assert (select schema_version from public.workspace_settings where id) >= 9, 'la versión de la base no es 9';
end;
$$;

rollback;

select 'ok' as result;
```

Lo que la prueba no cubre y queda para la de punta a punta (sección 9): el bucket `thumbs` y el portero con
un proyecto borrado (siguen a `file_level`, que la prueba sí mira con `media_file`), y el tiempo de
`refresh_project_files` con miles de archivos.

## 2. Borrar no es borrado duro: la papelera de proyectos

### 2.1 Cómo es hoy el borrado definitivo de los archivos (el modelo que se sigue)

Un archivo entra solo a la papelera de archivos cuando ninguna página viva lo usa, y sale solo si vuelve a
usarse. El dueño o un admin lo mandan **a pedido** a la papelera de Drive (`purge_file` + portero `/trash`):
desde ahí es definitivo para la app (no vuelve aunque se lo use de nuevo) y se recupera a mano desde la
papelera de Drive durante sus 30 días. La fila de `files` **nunca se borra**. La purga automática a los 30 días
está **armada y apagada** (`workspace_settings.auto_purge_files`, `files_due_for_purge`): la correría la app de un
dueño o admin al abrirse, no un servidor. **Hoy no hay ningún proceso que purgue nada:** ni cron en Supabase,
ni tareas en el portero, ni ninguna clave de servicio.

### 2.2 Lo mismo para los proyectos

| Paso | Qué pasa | Quién | Reversible |
|---|---|---|---|
| Borrar | `deleted_at`: sale de todas las listas y nadie lo ve; sus archivos entran a la papelera de archivos. | Quien maneja el proyecto | Sí: *Restore* lo deja como estaba. |
| Con la casilla de Drive (entrega 2) | Además, la carpeta del proyecto va a la papelera de Drive. | Dueño o admin que maneja el proyecto | Sí mientras Google la tenga (30 días desde ese momento, o hasta que el dueño vacíe la papelera de Drive). |
| Pasan 30 días | **Nada.** La lista lo marca "Pasaron los 30 días" y se sigue pudiendo restaurar (sus filas siguen ahí). | — | — |
| *Delete forever* (entrega 3) | `purged_at`: sale de la papelera de proyectos y ya no se restaura desde la app; si la carpeta todavía no estaba en la papelera de Drive, va. Las filas no se borran. | Dueño o admin que maneja el proyecto, con la palabra, **recién después de los 30 días** | Solo a mano (SQL del dueño de la base) para el texto; los archivos, desde la papelera de Drive mientras estén. |

- **El plazo: 30 días**, igual que la papelera de archivos y la de Drive (`TRASH_DAYS`, `src/media/fileTrash.ts:14`).
  Una sola constante para la app (`PROJECT_TRASH_DAYS = 30`) y la misma cuenta en la base (`days_left`).
- **Por qué *Delete forever* recién después de los 30 días:** le da sentido al plazo ("se puede restaurar
  durante 30 días" se cumple siempre) y frena el error de borrar algo de más dos veces seguidas. Quien necesita
  espacio en Drive enseguida tiene la casilla de Drive (que no espera) y puede vaciar la papelera de Drive.
- **Nada automático.** Se podría armar (apagado) una purga a los 30 días como la de los archivos, pero no se
  propone: no libera nada que la casilla de Drive no libere y suma un proceso. Si Lega lo quiere, sigue el
  mismo patrón (`auto_purge_projects` en `workspace_settings`, la app de un dueño o admin al abrirse).
- **Borrar filas de verdad** (las páginas y su contenido de un proyecto purgado) queda fuera de la app: si
  algún día hace falta (la base gratis tiene 500 MB y hoy usa unos 2 MB), es un SQL a mano del dueño de la base,
  con la copia de seguridad antes.

## 3. Los archivos del Drive (entrega 2)

### 3.1 Qué significa cada opción de la ventana

- **Sin la casilla** (por defecto): los archivos quedan en el Drive del dueño, en su carpeta
  `LGA_ShotDocs/<Proyecto>`, y en la base como archivos de un proyecto borrado (en su papelera de archivos, que
  nadie ve mientras el proyecto esté borrado). Siguen ocupando: el peso los cuenta y la lista de borrados lo
  dice ("Sus archivos siguen en Google Drive: 31,4 GB"). Se pueden mandar después, desde esa lista.
- **Con la casilla:** la carpeta del proyecto en el Drive del dueño va **entera** a la papelera de Drive. Google
  la guarda 30 días (o hasta que el dueño vacíe su papelera) y después la borra para siempre. El espacio se
  libera cuando Google la vacía, no enseguida (lo mismo que dice hoy la papelera de archivos).

### 3.2 Por qué la carpeta entera y no archivo por archivo

| | Carpeta entera (propuesta) | Archivo por archivo (con el `/trash` de hoy) |
|---|---|---|
| Pedidos al portero para 2300 archivos | **1** para mandar y **1** para traer de vuelta (unos 7 llamados afuera cada uno: sesión, base, token, Drive) | **2300** para mandar (cada uno ~7 llamados) y 2300 más para traer de vuelta (una ruta nueva) |
| Tiempo | Un par de segundos | Unos 40 minutos de a uno, con la app abierta (o 10–15 con 3–4 a la vez), retomando si se cierra |
| Plan gratis de Cloudflare (100.000 pedidos por día al Worker y 100.000 al Durable Object, 50 llamados afuera por pedido; `Doc_Carpetas.md`, sección 12) | Nada | 2,3 % del día al mandar y otro tanto al restaurar: entra, pero sin necesidad |
| Qué se lleva | Todo lo que está en la carpeta, **también lo que el dueño haya agregado a mano** ahí (la confirmación lo dice; ya se aceptó esto para las carpetas de P.9, `Doc_Carpetas.md`, sección 11) | Solo los archivos de la app, uno por uno con su marca `sdFile` |
| Qué deja | Un archivo del proyecto que el dueño **sacó a mano** de esa carpeta queda en el Drive | Nada |
| Restaurar | Sacar la carpeta de la papelera de Drive trae todo lo que se fue con ella; un archivo que ya estaba en la papelera de Drive por su cuenta (mandado antes de a uno) se queda ahí, como corresponde | Uno por uno, y la marca "definitivo" de `purge_file` habría que deshacerla archivo por archivo |
| Cambios | Dos rutas nuevas en el portero y una migración chica | Casi nada en el portero para mandar; una ruta nueva para traer de vuelta |

La carpeta lleva desde siempre la marca `sdProject` (`portero/src/core.ts:700`) y el portero recuerda su id
(`project:<id>`), así que se puede comprobar que es la del proyecto antes de tocarla, como hoy con `sdFile` en
los archivos.

### 3.3 Cómo queda guardado (para que restaurar deje todo igual)

**Una marca en el proyecto, no en cada archivo.** Mientras la carpeta esté en la papelera de Drive y el
proyecto se pueda restaurar, el estado vive en tres columnas de `workspaces` (`drive_trash_requested_at`,
`drive_trash_requested_by`, `drive_trashed_at`) y **los archivos no se tocan**. Restaurar con la carpeta de
vuelta solo borra esas tres marcas: los archivos quedan exactamente como estaban. Las marcas por archivo
(`purged_at`, `drive_trashed_at`, el "definitivo" de hoy) se ponen solo cuando ya no hay vuelta: si Google ya
no tiene la carpeta, o si se restaura el proyecto sin sacarla de la papelera de Drive. Entonces cada archivo
subido queda como "mandado a la papelera de Drive" y las páginas muestran lo de hoy: *File deleted (in the
Drive trash)*.

### 3.4 Los pasos

**Borrar con la casilla:** (1) `delete_project` (la base), (2) portero `POST /project/trash`. Si el paso 2 falla
(Drive sin conectar, sin red), el proyecto queda borrado con sus archivos en el Drive, y la lista de borrados
ofrece *Send files to the Drive trash* para terminarlo. Nunca al revés: la carpeta no va a la papelera de Drive
de un proyecto que no está borrado (la base lo exige).

**`POST /project/trash { project }`** (con la sesión de la persona, como `/trash`):
1. `media_project(project)`: que la sesión lo pueda hacer (dueño o admin que maneja el proyecto) y que esté
   borrado. Si no, `403 not_allowed` o `409 project_not_deleted`.
2. Drive conectado (`driveReady`), si no `503 drive_not_connected` sin pedir nada a la base.
3. La carpeta: el id guardado en `project:<id>`. Sin carpeta (nunca se subió nada): se marca igual y responde
   `drive: 'none'`. Con carpeta: `GET` con `appProperties`; si no lleva `sdProject = <id>`, `403
   drive_mismatch` y no se toca; si Drive dice 404, `drive: 'missing'`.
4. `request_project_drive_trash(project)` (la base lo marca), Drive `PATCH { trashed: true }` a la carpeta, y
   `project_drive_trashed(project)`. Responde `{ status: 'done', project, drive: 'trashed' | 'missing' | 'none' }`.
   Repetirlo no hace nada de más.

**Restaurar:** si el proyecto tiene la carpeta en la papelera de Drive, primero portero `POST /project/untrash`
y después `restore_project`. Si la app se cierra entre los dos, el proyecto sigue borrado con la carpeta ya
fuera de la papelera: consistente, y *Restore* de nuevo termina.

**`POST /project/untrash { project }`:** `media_project`; Drive conectado; `GET` de la carpeta: si está en la
papelera, `PATCH { trashed: false }` y `project_drive_untrashed(project)` (borra las tres marcas); si no está en la
papelera, lo mismo sin el `PATCH`; si Drive dice 404, responde `drive: 'missing'` **sin tocar la base**. Un 404
puede ser "Google ya la borró" o "el Drive conectado ahora es otra cuenta de Google" (`core.ts:515-516`): la app
pregunta antes de seguir ("Google Drive ya no tiene la carpeta de este proyecto: o se borró para siempre, o el
Drive conectado es otra cuenta. ¿Restaurar las páginas y el texto sin sus archivos?") y recién con un sí llama a
`restore_project(project, p_without_drive => true)`, que pone las marcas por archivo y restaura.

**Restaurar sin Drive** (Drive sin conectar, portero caído): la lista ofrece *Restore without its files*, con la
misma pregunta. Los archivos quedan marcados como mandados a la papelera de Drive (se recuperan a mano desde
ahí mientras Google los tenga) y el texto vuelve.

### 3.5 Un archivo usado por páginas de otro proyecto

- **Un archivo es de un solo proyecto** (`files.project_id`). Desde la papelera de archivos (v0.035), pegarlo en
  otro proyecto guarda un **uso de afuera** (`page_files.is_foreign`): cuenta para la papelera pero no da
  permiso, y la página de afuera lo muestra solo a quien ve el proyecto dueño del archivo (*Photo from another
  project*). La deduplicación de v0.061 de la importación de Coda es **dentro** de un proyecto: no comparte
  archivos entre proyectos.
- **Archivo de P usado en una página de O, con P borrado:** nadie lo ve en O (su nivel sale de las páginas de
  P, que dan 0). No entra a la papelera mientras la página de O esté viva. **Con la casilla de Drive, se va con
  la carpeta de P**: si P se purga, la página de O lo pierde. La ventana de borrar lo cuenta y lo dice
  ("3 archivos de este proyecto se usan también en páginas de otros proyectos: dejan de verse ahí mientras esté
  borrado", `project_delete_info.used_elsewhere`). Mover el archivo al otro proyecto queda fuera de este diseño.
- **Archivo de O usado solo en una página de P, con P borrado:** entra a la papelera de archivos de O, marcado
  "lo usa una página que está en la papelera" (`in_trashed_page`): queda fuera de *Empty* y de la purga
  automática, y sale solo al restaurar P (está en la prueba SQL). La pestaña lo muestra con el título vacío
  (*Untitled*): conviene un texto propio, "una página de un proyecto borrado".

### 3.6 La migración de la entrega 2 (borrador)

`20261005120000_proyectos_drive.sql`, `schema_version` 10. **Borrador:** se escribe de nuevo, con su prueba SQL
completa, después de la prueba técnica de Drive (sección 3.7).

```sql
-- LGA Shot Docs · la carpeta de un proyecto borrado en la papelera de Drive (P.14, entrega 2). Borrador.
alter table public.workspaces
  add column drive_trash_requested_at timestamptz,
  add column drive_trash_requested_by uuid references auth.users (id) on delete set null,
  add column drive_trashed_at         timestamptz,
  add constraint workspaces_drive_requested    check (drive_trash_requested_at is null or deleted_at is not null),
  add constraint workspaces_drive_requested_by check (drive_trash_requested_by is null or drive_trash_requested_at is not null),
  add constraint workspaces_drive_trashed      check (drive_trashed_at is null or drive_trash_requested_at is not null);

-- Mandar la carpeta (o traerla de vuelta): dueño o admin que maneja el proyecto.
create function private.can_purge_project(ws uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_manage_project(ws) and coalesce(private.workspace_role() in ('owner', 'admin'), false);
$$;

-- Para el portero, con la sesión de la persona: el proyecto, si lo puede hacer. Null si no.
create function public.media_project(p_project uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  r json;
begin
  if not private.can_purge_project(p_project) then
    return null;
  end if;
  select json_build_object('id', w.id, 'name', w.name, 'deleted_at', w.deleted_at,
                           'drive_trash_requested_at', w.drive_trash_requested_at,
                           'drive_trashed_at', w.drive_trashed_at)
  into r from public.workspaces w where w.id = p_project;
  return r;
end;
$$;

create function public.request_project_drive_trash(p_project uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.deleted_at, pr.drive_trash_requested_at into w from public.workspaces pr where pr.id = p_project for update;
  if not found or not private.can_purge_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'Only an owner or admin of the workspace who manages the project sends its folder to the Google Drive trash.';
  end if;
  if w.deleted_at is null then
    raise exception 'project_not_deleted' using errcode = 'P0001';
  end if;
  if w.drive_trash_requested_at is null then
    update public.workspaces set drive_trash_requested_at = now(), drive_trash_requested_by = auth.uid()
    where id = p_project;
  end if;
end;
$$;

-- La confirma el portero después de mandar la carpeta (o de ver que Drive no la tiene).
create function public.project_drive_trashed(p_project uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.drive_trash_requested_at, pr.drive_trashed_at into w from public.workspaces pr where pr.id = p_project for update;
  if not found or not private.can_purge_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if w.drive_trash_requested_at is null then
    raise exception 'project_drive_not_requested' using errcode = 'P0001';
  end if;
  if w.drive_trashed_at is null then
    update public.workspaces set drive_trashed_at = now() where id = p_project;
  end if;
end;
$$;

-- La carpeta salió de la papelera de Drive (o no estaba en ella): el proyecto vuelve a tener sus archivos.
create function public.project_drive_untrashed(p_project uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.workspaces pr where pr.id = p_project for update;
  if not found or not private.can_purge_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.workspaces
  set drive_trash_requested_at = null, drive_trash_requested_by = null, drive_trashed_at = null
  where id = p_project;
end;
$$;

-- Sin vuelta: cada archivo subido del proyecto queda como mandado a la papelera de Drive (lo de hoy, archivo
-- por archivo) y el proyecto deja de tener la marca. Lo usa restaurar sin la carpeta.
create function private.project_files_purged(p_project uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.drive_trash_requested_at, pr.drive_trash_requested_by, pr.drive_trashed_at into w
  from public.workspaces pr where pr.id = p_project;
  if w.drive_trash_requested_at is null then
    return;
  end if;
  update public.files f
  set trashed_at       = coalesce(f.trashed_at, w.drive_trash_requested_at),
      purged_at        = coalesce(f.purged_at, w.drive_trash_requested_at),
      purged_by        = case when f.purged_at is null then w.drive_trash_requested_by else f.purged_by end,
      drive_trashed_at = coalesce(f.drive_trashed_at, w.drive_trashed_at, w.drive_trash_requested_at)
  where f.project_id = p_project and f.drive_id is not null;
  update public.workspaces
  set drive_trash_requested_at = null, drive_trash_requested_by = null, drive_trashed_at = null
  where id = p_project;
end;
$$;

-- Restaurar: con la carpeta en la papelera de Drive pide traerla primero (`drive_untrash_first`), salvo que se
-- elija restaurar sin ella. La app de la entrega 1 la sigue llamando igual (con el valor por defecto).
drop function public.restore_project(uuid);
create function public.restore_project(p_project uuid, p_without_drive boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.owner_id, pr.deleted_at, pr.drive_trash_requested_at into w
  from public.workspaces pr where pr.id = p_project for update;
  if not found or not private.could_view_project(p_project, w.owner_id) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not private.can_manage_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'Restoring a project needs the same permission as deleting it.';
  end if;
  if w.deleted_at is null then
    return;
  end if;
  if w.drive_trash_requested_at is not null then
    if not coalesce(p_without_drive, false) then
      raise exception 'drive_untrash_first' using errcode = 'P0001',
        hint = 'Bring the project folder back from the Google Drive trash first, or restore it without its files.';
    end if;
    perform private.project_files_purged(p_project);
  end if;
  update public.workspaces set deleted_at = null, deleted_by = null where id = p_project;
  perform private.refresh_project_files(p_project);
end;
$$;

-- `trashed_projects` suma el estado de Drive y si la sesión puede mandarla; `project_sizes` cuenta los
-- archivos subidos de un proyecto con la carpeta confirmada en la papelera de Drive como `drive_trash`
-- (30 días desde `workspaces.drive_trashed_at`). Se escriben enteras en la versión final (cambian lo que
-- devuelve `trashed_projects`: drop y create; `project_sizes` conserva su firma).

-- Permisos de siempre: revoke a public y anon, execute a authenticated; `project_files_purged` y
-- `can_purge_project`, solo para las funciones (revoke a authenticated en la primera).
update public.workspace_settings set schema_version = 10 where id and schema_version < 10;
notify pgrst, 'reload schema';
```

### 3.7 Prueba técnica antes de construir la entrega 2

Con un proyecto de prueba (tres archivos subidos), borrado desde la app de la entrega 1, en el Drive de Lega:

1. Que con el permiso `drive.file` el portero pueda mandar a la papelera la carpeta que creó (`PATCH trashed`)
   y sacarla.
2. Que los archivos de adentro queden en la papelera (`trashed: true`, `explicitlyTrashed: false`) y vuelvan
   con la carpeta; y que uno mandado antes por su cuenta (`/trash`) **no** vuelva.
3. Que un pase (`/m/<pase>`) de un archivo cuya carpeta está en la papelera siga sirviendo hasta que vence (8
   horas) o deje de servir: cualquiera de las dos está bien, pero hay que saberlo.
4. Qué ve el dueño en su papelera de Drive (una carpeta con todo adentro) y que la fecha de borrado de Google
   cuente desde ese momento.

Se prueba con una versión del portero con las dos rutas nuevas (solo actúan sobre proyectos borrados, que en
ese momento no existen fuera de la prueba), antes de mostrar la casilla en la app.

## 4. Archivar

- **Qué es:** una marca (`archived_at`) que ve todo el equipo. Es orden, no candado: **no cambia permisos,
  contenido, archivos, comentarios ni el Drive**. Para los proyectos terminados.
- **Dónde deja de aparecer:** la lista principal del selector y la lista de proyectos del panel de Ctrl/⌘+K
  (`ProjectSearch.tsx`). La búsqueda de páginas ya es del proyecto abierto: adentro de un archivado, busca en
  él como siempre. Una búsqueda en todos los proyectos (pendiente en `Doc_Buscar.md`) lo dejaría afuera.
- **Dónde está:** *Archived projects (N)* al pie del selector, que cambia el selector a esa lista (con su
  propio filtro). Tocar uno lo abre; un ícono lo desarchiva.
- **Abierto, ¿editable o de solo lectura?** Propuesta: **editable**, con la marca *Archived* en el botón del
  selector ("12 pages · Archived") y en el inicio del proyecto. Un candado de verdad (la base rechazando
  ediciones) dejaría rechazados los cambios sin subir de otros dispositivos al archivar; uno solo en la
  interfaz es posible y queda como alternativa en las preguntas.
- **Al archivar el proyecto abierto**, la app pasa al siguiente de la lista principal (sección 7.3).
- **Una versión vieja** lo sigue mostrando como un proyecto más: no hace daño.

## 5. Quién puede

| Acción | Quién | Dónde se aplica |
|---|---|---|
| Archivar y desarchivar | Quien maneja el proyecto: "Editar y crear páginas" sobre el proyecto entero **y** ser dueño o admin del workspace, o quien lo creó (miembro activo) | `private.can_manage_project` en `set_project_archived` |
| Borrar y restaurar | Igual | `delete_project`, `restore_project` |
| Casilla de Drive, mandar o traer la carpeta | Además, dueño o admin | `private.can_purge_project` (entrega 2) |
| *Delete forever* | Dueño o admin que maneja el proyecto, después de los 30 días | Entrega 3 |
| Ver la papelera de proyectos | Quien veía el proyecto (su creador, permiso sobre el proyecto o sobre una página de adentro), con *Restore* solo para quien lo maneja | `trashed_projects` (`could_view_project`) |

- Es **la misma regla que compartir el proyecto entero** (`private.can_share`, `equipo.sql:797-813`): quien
  puede decidir quién lo ve puede sacarlo de la vista de todos. Un miembro con "Editar y crear páginas" que no lo
  creó no lo borra: afectaría a todo el equipo.
- **El dueño del workspace no ve ni borra los proyectos privados de otros** (regla del plan): para él, uno
  privado de otro no existe, tampoco en la papelera de proyectos.
- Todo se calcula **sin mirar el borrado** (`user_project_level_any`): si no, nadie podría restaurar.
- En el dispositivo, `Permissions.canManageProject(id)` hace la misma cuenta que la base (como
  `canShareProject`, `src/sync/access.ts:301-307`) para no ofrecer lo que el servidor va a rechazar.

## 6. Los demás dispositivos, las otras personas y las versiones viejas

### 6.1 El dispositivo que borra

- **Solo con red**, como mandar a la papelera de Drive. Los íconos quedan apagados sin red, con el tooltip
  *Needs an internet connection* (la clave `fileTrash.needsInternet` ya existe).
- **No se borra con cambios de ese proyecto sin subir en este dispositivo.** Al abrir la ventana la app
  guarda lo pendiente y sincroniza (`docs.flush()`, `engine.syncNow()`) y cuenta lo que quede de ese proyecto:
  cambios del árbol en la cola o rechazados sobre sus páginas, contenido sin subir de sus páginas, fotos y
  videos pendientes de sus páginas, comentarios sin subir. Si hay algo, la ventana lo dice ("Este dispositivo
  tiene 3 cambios de este proyecto sin subir…") con *Download my unsynced changes* y el botón apagado. Tampoco
  con una importación de Coda en curso hacia ese proyecto.
- Al confirmar, la app llama a `delete_project` y **recién con la respuesta** cambia de proyecto y vuelve a
  sincronizar; si falla (sin red, sin permiso), no cambia nada y lo dice.

### 6.2 Otro dispositivo con el proyecto abierto o con cambios sin subir

- En su próxima sincronización el proyecto ya no viene (`fetchProjects`) y sus páginas tampoco: salen del árbol.
  **Nada se borra del dispositivo:** el contenido de las páginas, los originales de fotos y videos y los
  comentarios siguen en sus bases locales.
- Lo que tenía sin subir lo rechaza la base para siempre: contenido (`page_not_found`), cambios del árbol
  (`page_not_found`, o la política al crear), fotos y videos (detenidos), comentarios (`page_not_found`). Todo
  queda **a la vista como rechazado** y se puede bajar como archivo; una página creada sin red en ese proyecto
  nunca se descarta. Es lo mismo que pasa hoy cuando a alguien le dejan de compartir una página
  (`Doc_Sincronizacion.md:613-615`).
- **Al restaurar el proyecto**, el contenido rechazado se reintenta solo al abrir la app (`engine.ts:209-218`)
  o con *Retry*; los cambios del árbol y los comentarios rechazados, con *Retry*. Yjs junta todo sin duplicar.
- **Qué ve la persona (app nueva):** cuando un proyecto conocido deja de venir, la app pregunta una vez
  `trashed_projects()`. Si está ahí, avisa: "*ana@… mandó “MGTZD” a Proyectos borrados. Lo que tenías sin subir
  de ese proyecto quedó en este dispositivo.*" (con *Download my unsynced changes* si hay algo) y, si lo tenía
  abierto, pasa al siguiente proyecto. Si no está (le dejaron de compartir), el aviso de siempre.
- Un editor abierto en una página de ese proyecto: lo escrito ya está en el dispositivo (cada tecla se guarda
  en IndexedDB); la página pasa al aviso de arriba en vez de "Esta página no existe o no tenés acceso".

### 6.3 Las personas con quienes estaba compartido

- **Borrado:** desaparece de su lista. Lo ven en *Deleted projects* (sin *Restore*, salvo que lo manejen), con
  quién y cuándo lo borró. Si era el único proyecto que tenían, la app muestra la pantalla de "sin proyectos"
  que ya existe (`Workspace.tsx:430-488`), que vuelve a preguntar sola cada minuto.
- **Archivado:** pasa a su lista de archivados, con sus mismos permisos.
- **Restaurado:** vuelve a su lista en la próxima sincronización, con los mismos permisos (no se tocaron).

### 6.4 El "primer proyecto" de cada dispositivo

Cada dispositivo guarda una vez su primer proyecto (`meta.workspaceId`, `services.ts:172-191`) y el árbol lo
agrega siempre a la lista (`tree.ts:565-569`). Si ese proyecto se borra, sin cambios aparecería un renglón vacío
"My project". La app nueva:

- Agrega el de relleno solo mientras **nunca bajó la lista** de proyectos (la primera vez sin red, o una copia
  de una versión anterior).
- Si la lista del servidor no trae su primer proyecto (y no es uno creado en el dispositivo sin subir), lo
  cambia por el primero activo de la lista y lo guarda; si la lista está vacía, muestra la pantalla "sin
  proyectos". Esto arregla también el caso que ya existe hoy cuando le dejan de compartir el primero.

### 6.5 Una versión vieja de la app

- **No ve el proyecto borrado ni puede escribir en él:** lo decide la base (política de `workspaces` y niveles
  en 0), no la app. Lo que tenga sin subir queda rechazado y a la vista, como en 6.2. No puede borrar ni
  archivar (no tiene los íconos, y las marcas no se escriben desde la API).
- **Lo que se ve raro:** si el borrado era su primer proyecto, muestra un "My project" vacío (sección 6.4). Si
  alguien crea una página ahí, la creación queda rechazada **con su contenido guardado en el dispositivo** (no se
  pierde; se baja o sube al restaurar). Los errores aparecen con las palabras de siempre.
- **Un archivado** lo ve como un proyecto más.
- No hay tipos de bloque ni propiedades nuevas, así que `min_app_version` no hace falta por el documento.
  **Conviene igual subirla** a la versión de la entrega 1 apenas esté publicada, antes de borrar el primer
  proyecto: una pestaña vieja deja de subir contenido (queda en el dispositivo) y muestra "recargá la app", que
  es lo que la saca de los casos raros de arriba.

### 6.6 Orden de publicación

1. Probar la migración con su prueba en `begin; … rollback;` contra la base. Con la tanda auditada: copia de
   seguridad (repo `z_shotdocs_backup`, *Run workflow*, esperar el verde), `npm run db:migrate`, `npm run
   db:test`. La migración es compatible con la app publicada: mientras nadie borre nada, nada cambia.
2. Push de la app a `main` (Cloudflare publica).
3. Subir `min_app_version` a esa versión (SQL Editor), antes del primer borrado.
4. Entrega 2: la prueba técnica de Drive, la migración 10 igual que la 9, y el portero con la app **en el mismo
   push** (regla del plan); el portero nuevo tiene que seguir andando con la app de la entrega 1 (las rutas son
   nuevas, no cambia ninguna).

## 7. La interfaz

### 7.1 El selector de proyectos

Hoy cada proyecto es un botón y abajo hay líneas: *Share “X”…*, *New project*, *Import from Coda…* y *Rename
“X”* (estas dos del proyecto abierto). Propuesta: **las acciones de un proyecto van en su renglón**, como pidió
Lega, y abajo quedan las del workspace.

```
┌ Find a project…                              ┐
│ YOUR PROJECTS                                │
│ [MG] MGTZD                         Open      │
│      214 pages · 31.4 GB · edited today      │
│ [BN] Bosque Negro              [✎] [▣] [🗑]   │  ← al pasar el mouse, con el foco o con las flechas
│      12 pages · 820 MB · edited Sep 12       │
│ [ER] ERSO (import test)                      │
│      40 pages · 1.2 GB · edited yesterday    │
│ ──────────────────────────────────────────── │
│ ↗ Share “MGTZD”…                             │
│ + New project                                │
│ ⤓ Import from Coda…                          │
│ ▣ Archived projects (3)                      │
│ 🗑 Deleted projects                          │
│ ──────────────────────────────────────────── │
│ ⇅ Join or create a workspace…                │
└──────────────────────────────────────────────┘
```

- **Tres íconos por renglón:** renombrar (lápiz, `RenameIcon`), archivar (una caja, `ArchiveIcon` nuevo) y
  borrar (`TrashIcon`). Aparecen al pasar el mouse, con el foco y en el renglón activo de las flechas; en el
  proyecto abierto, a la derecha de *Open*. Solo los que la persona puede usar (renombrar: 4 sobre el proyecto,
  como hoy; archivar y borrar: `canManageProject`). Tooltips con `data-tip` (son íconos sin texto, así que el
  nombre de la acción suma): *Rename*, *Archive*, *Delete…*; apagados, el motivo (*Needs an internet
  connection*, *This is your only project: create another one first*).
- **Renombrar** abre el formulario de hoy (`NameForm`) para **ese** proyecto, no solo el abierto. La línea
  *Rename “X”* desaparece.
- **Share “X”…** queda como línea del proyecto abierto: es frecuente, abre su propio diálogo y su línea dice de
  qué proyecto es. En el teléfono también está en el "⋯" de cada renglón.
- **El renglón deja de ser un botón** (no puede haber botones adentro de un botón): un contenedor con la zona
  que abre el proyecto (la opción de la lista, `role="option"`, con el `aria-activedescendant` de hoy) y los
  íconos al lado, fuera de la opción, alcanzables con Tab y con su `aria-label` ("Archive “Bosque Negro”").
- **Archivar pregunta en el mismo renglón** (sin una ventana encima del selector):

```
│ [BN] Archive “Bosque Negro”?   [Archive] [Cancel] │
```

  Al confirmar, el renglón sale de la lista y queda un aviso corto: "“Bosque Negro” archivado. Está en
  Proyectos archivados." Escape o *Cancel* vuelven al renglón.
- **El último proyecto activo** no se archiva ni se borra (íconos apagados, con el tooltip de arriba): así
  nunca queda una sesión sin proyecto abierto. La base no lo controla (es "el último para esta persona").

### 7.2 Las listas de archivados y de borrados

Son modos del mismo selector (como hoy *New project* y *Rename*), con "‹" para volver: rápidos, nunca una
página nueva.

```
┌ ‹ Archived projects (3)                      ┐
│ Find an archived project…                    │
│ [OL] Old spot 2025                    [⇡] [🗑] │  ← desarchivar, borrar
│      88 pages · 12 GB · archived Aug 2        │
│ …                                            │
└──────────────────────────────────────────────┘

┌ ‹ Deleted projects                           ┐
│ Restore within 30 days. Their files stay in  │
│ Google Drive unless they were sent to its    │
│ trash.                                       │
│ [ER] ERSO (import test)          [Restore]   │
│      Deleted by lega@… · 2 days ago          │
│      40 pages · 1.2 GB in Drive · 28 days left│
│ [XX] Test 3                      [Restore]   │
│      Deleted by ana@… · 31 days ago          │
│      30 days passed · files in the Drive     │
│      trash until Oct 31           (entrega 2) │
└──────────────────────────────────────────────┘
```

- **Archivados:** lista local (anda sin red para abrir; desarchivar y borrar piden red). Tocar uno lo abre, con
  la marca *Archived*. Desarchivar no pregunta (se deshace con un clic).
- **Borrados:** solo con red (`trashed_projects()`, más el peso de `project_sizes` para quien lo puede
  restaurar). No se abren: un proyecto borrado no se ve. *Restore* no pregunta; en la entrega 2, si la carpeta
  está en la papelera de Drive, primero la trae (sección 3.4). La línea *Deleted projects* se muestra a los
  dueños y admins y a quien maneja algún proyecto; a los demás, solo si la app sabe de alguno borrado que
  veían.
- En la entrega 2, cada borrado con archivos en el Drive suma *Send files to the Drive trash (1.2 GB)* (dueño y
  admins); en la 3, *Delete forever…* después de los 30 días.

### 7.3 Borrar el proyecto abierto, y a cuál se pasa

Se puede. Después del borrado (o del archivado) la app pasa al **siguiente proyecto activo de la lista** (el de
abajo; si era el último, el de arriba) y abre su última página. *Restore* no vuelve a abrirlo solo.

### 7.4 La ventana de borrar

Una ventana de verdad (`modal-backdrop` y `modal`, como *Remove workspace from this device*), no la confirmación
del navegador:

```
┌──────────────────────────────────────────────────────────┐
│  Delete “ERSO (import test)”?                            │
│                                                          │
│  [ER]  40 pages · 2,318 files · 1.2 GB in Google Drive   │
│        Shared with 4 people.                             │
│                                                          │
│  It goes to Deleted projects: nobody sees it anymore,    │
│  and it can be restored exactly as it was for 30 days.   │
│                                                          │
│  ☐ Also send its files to the Google Drive trash (1.2 GB)│
│     The folder LGA_ShotDocs/ERSO goes to the Drive trash │
│     with everything in it. Google deletes it for good    │
│     after 30 days; restoring the project before that     │
│     brings it back.                          (entrega 2) │
│                                                          │
│  ⚠ 3 files of this project are also used in pages of     │
│    other projects: they stop showing there.              │
│                                                          │
│  Type delete to confirm                                  │
│  [ delete                       ]                        │
│                                                          │
│                         [Cancel]  [Delete project]       │
└──────────────────────────────────────────────────────────┘
```

- Los números salen de `project_delete_info` (una consulta al abrir; sin red, la ventana no se abre).
- **La palabra:** `delete` con la app en inglés y `borrar` en castellano, sin distinguir mayúsculas y sin
  espacios de más. El botón (rojo, `primary danger`) se habilita recién ahí. Enter con la palabra bien escrita
  confirma; Escape cancela. El foco arranca en el campo.
- **La casilla** arranca destildada. En la entrega 1 no está: en su lugar, una línea "Sus archivos quedan en
  Google Drive (1,2 GB)." Sin Drive conectado o sin ser dueño o admin, la casilla aparece apagada con el motivo.
- Con cambios sin subir de ese proyecto en el dispositivo, el bloque de la sección 6.1 reemplaza la palabra y
  el botón queda apagado.
- En el teléfono, la ventana ocupa la pantalla, con el botón abajo.

### 7.5 El teléfono

Sin mouse no hay "al pasar": cada renglón tiene un "⋯" (`MoreIcon`, siempre visible, la misma regla
`coarsePointer()` de `ProjectSwitcher.tsx:35`) que abre una hoja con *Rename*, *Share…*, *Archive* y *Delete…*
(y en los archivados *Unarchive* y *Delete…*). Archivar pregunta en la misma hoja.

### 7.6 Textos (inglés y castellano)

En `src/i18n/sidebar.ts` (los del selector) y en una parte que se baja con la ventana (`src/i18n/lazy/`), con las
pruebas de siempre (las dos lenguas, los mismos `{valores}`).

| Clave | Inglés | Castellano |
|---|---|---|
| `project.archive` | Archive | Archivar |
| `project.archiveConfirm` | Archive “{name}”? | ¿Archivar “{name}”? |
| `project.archived` | “{name}” archived. It is in Archived projects. | “{name}” archivado. Está en Proyectos archivados. |
| `project.archivedMark` | Archived | Archivado |
| `project.unarchive` | Unarchive | Desarchivar |
| `project.archivedList` | Archived projects ({count}) | Proyectos archivados ({count}) |
| `project.deletedList` | Deleted projects | Proyectos borrados |
| `project.deleteTip` | Delete… | Borrar… |
| `project.onlyOne` | This is your only project: create another one first | Es tu único proyecto: primero creá otro |
| `deleteProject.title` | Delete “{name}”? | ¿Borrar “{name}”? |
| `deleteProject.stats` | {pages} pages · {files} files · {size} in Google Drive | {pages} páginas · {files} archivos · {size} en Google Drive |
| `deleteProject.shared` | Shared with {count} people. (plural) | Compartido con {count} personas. |
| `deleteProject.where` | It goes to Deleted projects: nobody sees it anymore, and it can be restored exactly as it was for {days} days. | Va a Proyectos borrados: nadie lo ve más, y se puede restaurar tal como estaba durante {days} días. |
| `deleteProject.driveStays` | Its files stay in Google Drive ({size}). | Sus archivos quedan en Google Drive ({size}). |
| `deleteProject.driveOption` | Also send its files to the Google Drive trash ({size}) | Mandar también sus archivos a la papelera de Google Drive ({size}) |
| `deleteProject.driveHint` | The folder {folder} goes to the Drive trash with everything in it. Google deletes it for good after 30 days; restoring the project before that brings it back. | La carpeta {folder} va a la papelera de Drive con todo lo que tiene adentro. Google la borra para siempre a los 30 días; restaurar el proyecto antes la trae de vuelta. |
| `deleteProject.usedElsewhere` | {count} files of this project are also used in pages of other projects: they stop showing there. (plural) | {count} archivos de este proyecto se usan también en páginas de otros proyectos: dejan de verse ahí. |
| `deleteProject.unsynced` | This device has {count} changes in this project that are not uploaded yet. Let them upload, or download them, before deleting. | Este dispositivo tiene {count} cambios de este proyecto sin subir. Esperá a que suban, o bajalos, antes de borrarlo. |
| `deleteProject.typeWord` | Type {word} to confirm | Escribí {word} para confirmar |
| `deleteProject.word` | delete | borrar |
| `deleteProject.button` | Delete project | Borrar proyecto |
| `deleteProject.done` | “{name}” is in Deleted projects. It can be restored for {days} days. | “{name}” está en Proyectos borrados. Se puede restaurar durante {days} días. |
| `deletedList.hint` | Restore within 30 days. Their files stay in Google Drive unless they were sent to its trash. | Se restauran durante 30 días. Sus archivos siguen en Google Drive, salvo que se hayan mandado a su papelera. |
| `deletedList.by` | Deleted by {email} · {when} | Lo borró {email} · {when} |
| `deletedList.daysLeft` | {count} days left (plural) | Quedan {count} días |
| `deletedList.passed` | 30 days passed | Pasaron los 30 días |
| `deletedList.restore` | Restore | Restaurar |
| `deletedList.goneNotice` | {email} moved “{name}” to Deleted projects. | {email} mandó “{name}” a Proyectos borrados. |
| `deletedList.keptNotice` | What you had not uploaded from it is kept on this device. | Lo que tenías sin subir de ese proyecto quedó en este dispositivo. |
| `page.notFound` (se agrega) | …If it was in a deleted project, it comes back when the project is restored. | …Si era de un proyecto borrado, vuelve cuando lo restauren. |

### 7.7 Ayuda

Regla de P.13: la función suma su entrada en la ayuda (archivar, borrar, restaurar, la palabra, la casilla de
Drive y el plazo) en la misma tanda. No hay atajos nuevos.

## 8. Lo demás que toca

- **Búsqueda (P.12):** el panel de Ctrl/⌘+K lista `tree.activeProjects()` (sin archivados; el abierto siempre).
  Ofrecer crear un proyecto con lo escrito no cambia. Se actualiza el comentario de `ProjectSearch.tsx:147`.
  El índice de búsqueda es del proyecto abierto: no hay nada que filtrar.
- **Última página de cada proyecto** (`shotdocs-last-pages`, `project.ts`): no se borra al archivar ni al
  borrar; al restaurar, abrir el proyecto vuelve a su última página. Si el proyecto elegido en el dispositivo
  (`shotdocs-project`) ya no está, la app usa el primero activo (`useCurrentProject` ya cae al primero; se ajusta
  para que no caiga en uno archivado).
- **Links internos** (`/p/<id>`, `internalLinks.ts`) a una página de un proyecto borrado: la página no está en el
  árbol y se ve "Esta página no existe o no tenés acceso", con la línea nueva de la tabla de textos. A una de un
  proyecto archivado: abre la página (y con ella el proyecto) como siempre.
- **Importación de Coda** (crea un proyecto nuevo): borrar es la forma de limpiar importaciones de prueba (hoy
  "el proyecto a medias queda", `Doc_Importar_Coda.md:128`, que se actualiza). No se borra un proyecto con una
  importación en curso hacia él. `findResumable` (`codaImport.ts:336-340`) olvida el diario de la importación si
  el proyecto no está en el árbol: se cambia para conservarlo mientras el proyecto esté en la papelera de
  proyectos (restaurarlo y seguir la importación).
- **Peso (P.7):** el renglón de un archivado muestra su peso como siempre; los borrados muestran el suyo en la
  lista de borrados (para quien los puede restaurar). El diálogo de Google Drive suma todo, también los borrados
  (siguen ocupando hasta que Google vacíe la papelera). La futura lista de media por peso (P.8) deja afuera los
  borrados.
- **Comentarios:** quedan con el proyecto y vuelven al restaurarlo. Nada cambia en su tabla.
- **Copias de seguridad:** no cambia nada (las marcas son columnas y las copias llevan la base entera). Dos
  cosas a saber: restaurar una copia **anterior** a un borrado lo devuelve activo (es lo que dice la copia); y si
  en el medio su carpeta fue a la papelera de Drive (entrega 2), la copia no lo sabe y sus archivos se verían
  rotos hasta sacarla a mano de la papelera de Drive. Las copias nunca cubren el Drive (`Plan_Workspaces.md`,
  sección 7).
- **Sacar a alguien** (`remove_member`): sin cambios. Sus proyectos compartidos, también los borrados, pasan a
  un heredero: alguien los va a poder restaurar o purgar.

## 9. Pruebas y entregas

### 9.1 Pruebas

- **SQL** (`supabase/tests/proyectos_borrar_permisos.sql`, sección 1.4): quién archiva, borra y restaura; todo
  lo que deja de verse y de escribirse; la papelera de archivos y el peso; la huella antes y después; la
  invitación en el medio; las marcas no se escriben desde la API; sin sesión nada. Y la de siempre: que la dueña
  sigue viendo y editando todo después de restaurar. Las once pruebas de hoy tienen que seguir pasando (algunas
  miran `ensure_workspace` y `project_sizes`). **Medir** `delete_project` con un proyecto de prueba de unos 2500
  archivos dentro de la transacción.
- **Unitarias** (`src/sync/`): `PageTree` (`activeProjects`, `archivedProjects`, el primer proyecto que se
  reemplaza, sin relleno con la lista conocida), `Permissions.canManageProject` contra la tabla de la sección 5,
  lo sin subir de un proyecto (`unsyncedInProject`), y el `FakeServer` de `src/sync/testing.ts` con proyectos
  archivados y borrados (niveles en 0) para todo lo demás.
- **Dos dispositivos** (como `projects.test.ts` y `team.test.ts`): A borra mientras B tiene contenido, una página
  nueva, una foto y un comentario sin subir → B los conserva como rechazados y a la vista, con el aviso; A
  restaura; B reintenta → todo en el servidor, sin duplicados. Y el primer proyecto de B borrado → B pasa al
  siguiente sin el renglón vacío.
- **De componente** (jsdom, como `workspaces.test.tsx`): los íconos por renglón (al pasar el mouse, con el foco,
  solo si puede, apagados sin red y en el último proyecto); archivar en el renglón; la ventana de borrar con la
  palabra en los dos idiomas (mayúsculas y espacios), el botón apagado hasta escribirla, el bloqueo por cambios
  sin subir; las listas de archivados y borrados; borrar el abierto pasa al siguiente; el teléfono con "⋯".
- **Portero** (entrega 2, `portero/src/core.test.ts` con Drive simulado): la carpeta con la marca va y vuelve; sin
  la marca, `drive_mismatch` y nada se toca; 404; sin carpeta; quien no es dueño ni admin; un proyecto no
  borrado; repetir no hace nada de más.
- **A mano:** la prueba técnica de Drive (sección 3.7); borrar y restaurar en Wanka un proyecto de prueba con
  fotos y comentarios desde la computadora y ver el resultado en el iPhone.

### 9.2 Entregas

1. **Archivar, borrar y restaurar sin tocar Drive:** migración 9 y su prueba, la app (selector, ventana, listas,
   avisos, primer proyecto, Ctrl/⌘+K), ayuda, docs y changelog. Lo más útil enseguida: limpiar importaciones de
   prueba y proyectos viejos sin perder nada.
2. **La casilla de Drive:** prueba técnica, migración 10, las dos rutas del portero (`Doc_Portero.md`), *Send files
   to the Drive trash* en la lista de borrados y restaurar trayendo la carpeta.
3. ***Delete forever*** después de los 30 días (`purged_at`, dueño y admins), con su palabra.

Cada una con su auditoría antes de publicar.

## Riesgos

1. **SQL sin ejecutar.** Puede tener errores de escritura; la prueba en `begin; … rollback;` los encuentra antes
   de aplicar. La parte más delicada es que `user_page_level` y `user_project_level` cambian para todos: la
   prueba de siempre de la dueña y las once pruebas existentes tienen que pasar.
2. **El tiempo de `delete_project`** con muchos archivos (sección 1.3): medir.
3. **Versiones viejas** con el primer proyecto borrado (sección 6.5): un renglón vacío y, si escriben ahí,
   rechazos con el contenido guardado. Lo acota subir `min_app_version`.
4. **La carpeta entera se lleva lo agregado a mano** y deja lo sacado a mano (sección 3.2). La confirmación lo
   dice; es el mismo criterio que P.9.
5. **Archivos de un proyecto borrado usados en otros proyectos** dejan de verse ahí, y con la casilla de Drive se
   van con la carpeta (sección 3.5). La ventana los cuenta.
6. **Un 404 de Drive al restaurar** puede ser otra cuenta de Google conectada, no un borrado: por eso nunca marca
   nada sin preguntar (sección 3.4).
7. **Restaurar una copia de seguridad** anterior a un borrado con la carpeta en la papelera de Drive (sección 8).

## Preguntas para Lega

1. **Quién puede archivar, borrar y restaurar.** Propuesta: quien puede compartir el proyecto entero ("Editar y
   crear páginas" sobre él y ser dueño o admin, o haberlo creado); la casilla de Drive y el borrado definitivo,
   solo dueño y admins. ¿O solo dueño y admins para todo?
2. **Un proyecto archivado, ¿se edita?** Propuesta: sí, con la marca *Archived* a la vista (archivar es orden).
   Alternativa: abrirlo en solo lectura en la app (sin que la base rechace nada) hasta desarchivarlo.
3. **Drive: ¿la carpeta entera del proyecto?** Propuesta: sí (un pedido, se restaura entera), avisando que se
   lleva también lo que hayas puesto a mano en esa carpeta. Alternativa: archivo por archivo (unos 40 minutos
   para un proyecto como el de Coda).
4. **La casilla de Drive, ¿destildada por defecto?** Propuesta: sí, destildada.
5. **El plazo y el definitivo.** Propuesta: 30 días; al vencer no pasa nada solo; *Delete forever* (a mano, solo
   dueño y admins) recién después de los 30 días. ¿O el definitivo también antes?
6. **Los íconos, ¿al pasar el mouse o siempre?** Propuesta: al pasar el mouse y con el foco (siempre se ven en el
   renglón activo); en el teléfono, un "⋯" por renglón. Y renombrar pasa a ser el lápiz del renglón (sale la
   línea *Rename*).
7. **La palabra:** `delete` en inglés y `borrar` en castellano, sin distinguir mayúsculas. ¿Aceptar también la
   del otro idioma? Propuesta: no, solo la del idioma de la app (la ventana la muestra).

## Lo que falta (el documento se cerró antes de terminar)

- **Relectura final y auditoría independiente** de todo el documento: no se hicieron.
- **El SQL de las secciones 1.3, 1.4 y 3.6 nunca se ejecutó** (ni siquiera se revisó su sintaxis con un
  analizador): correrlo en `begin; … rollback;` antes de darlo por bueno. La 3.6 es un borrador y le faltan
  `trashed_projects` y `project_sizes` de la entrega 2 y su prueba SQL.
- **`Docs/index.md` y `Docs/Doc_Roadmap.md` (P.14) todavía no apuntan a este documento.**
- La entrega 3 (*Delete forever*, `purged_at`) está descrita (sección 2.2) pero sin SQL.
- La prueba técnica de Drive (sección 3.7) no se hizo: lo de la carpeta entera en la papelera de Drive es una
  suposición sobre cómo se porta Drive con el permiso `drive.file`.
- Lo encontrado en el código que condiciona el diseño está en la tabla de la sección 0, con archivo y línea.
