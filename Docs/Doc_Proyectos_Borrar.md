# Borrar y archivar proyectos (P.14)

Estado: **entregas 1 y 2 publicadas (v0.077 y v0.080, migraciones 9 y 10 aplicadas); una sola papelera en el selector
de proyectos (v0.162); entrega 3 (*Delete forever*) publicada (v0.167), con su migración aplicada**
(`20261101120000_proyectos_purgar.sql`, versión 23; ver "Cómo quedó" de cada una, al final). Lega aprobó todas las
propuestas ("sí a todo", sección "Decisiones de Lega"). La auditoría independiente del diseño dio "aprobado con cambios"
y, corregido, "aprobado" (sección "Correcciones de la auditoría"). Cuando se escribió el diseño (2026-10-01) ninguna de
las tres migraciones estaba aplicada; su SQL (secciones 1.3, 3.6 y 2.3) **se corrió con sus pruebas contra la base real
dentro de `begin; … rollback;`** y pasaba entero, con las once pruebas que ya existían y los casos negativos de la
auditoría (sección 9.3). Sale de leer
`main` en `19c7692` (v0.074): las migraciones de `supabase/migrations/`, `src/sync/` (árbol, motor, remoto,
permisos), `src/ui/ProjectSwitcher.tsx`, `src/ui/project.ts`, `src/ui/Workspace.tsx`, `src/ui/WorkspaceMenu.tsx`,
`src/ui/TrashView.tsx`, `src/media/` (papelera de archivos, peso) y `portero/src/`.

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
   estaba (los archivos que ya estaban en la papelera conservan su fecha). Un archivo de otro proyecto que solo
   usaba el borrado no se puede mandar a la papelera de Drive mientras tanto (`file_in_deleted_project`).
5. **Plazo: 30 días** (los mismos de la papelera de archivos y de la papelera de Drive). Al vencer **no pasa
   nada solo**: hoy no hay ningún proceso que purgue (la purga automática de archivos está armada y apagada) y
   no se agrega uno. El borrado definitivo (*Delete forever*) es una tercera entrega, a pedido y después de los
   30 días.
6. **Drive (segunda entrega):** con la casilla tildada, la **carpeta del proyecto** en el Drive del dueño
   (`LGA_ShotDocs/<Proyecto>`, la que lleva la marca `sdProject`) va entera a la papelera de Drive con **un solo
   pedido** al portero, y restaurar la saca de ahí con otro. Sin la casilla, los archivos quedan en el Drive en
   su carpeta. Requiere una prueba técnica con el Drive real antes de construirla. Si Drive ya no tiene la
   carpeta, restaurar sin ella deja una marca del proyecto que se deshace si la carpeta aparece: ningún archivo
   queda marcado para siempre.
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
10. **Migraciones, completas y probadas en rollback:** `20261001120000_proyectos_archivar_borrar.sql` (entrega 1,
    `schema_version` 9; secciones 1.3 y 1.4), la de Drive (entrega 2, versión 10; 3.6 y 3.7) y la de *Delete
    forever* (entrega 3, versión 11; 2.3). Borrar y restaurar el proyecto más grande de la base (640 páginas,
    2297 archivos) tarda entre 1,2 y 2 segundos.
11. **Entregas:** 1) archivar, borrar y restaurar; 2) la casilla de Drive (portero y migración 10, después de la
    prueba técnica); 3) *Delete forever*, recién después de los 30 días. **Plan: la 1 y la 2 salen juntas** si la
    prueba técnica de Drive pasa (sección 9.2).

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

### 0.1 Cómo queda cada condicionante

| Condicionante | Cómo queda | Dónde |
|---|---|---|
| El "primer proyecto" guardado en cada dispositivo (`services.ts:172-191`) que el árbol agrega siempre (`tree.ts:565-569`), y que además es el proyecto por defecto al crear una página sin proyecto (`tree.ts:243`) y al que cae `useCurrentProject` (`project.ts:69`) | **Resuelto en el diseño, a implementar:** el relleno solo mientras el dispositivo nunca bajó la lista; si la lista del servidor no lo trae, se reemplaza por el primero activo y se guarda. `tree.workspaceId` hoy es `readonly` (`tree.ts:93`): pasa a poder cambiarse (o a calcularse). En una versión vieja queda un "My project" vacío: lo acota subir `min_app_version`. | 6.4, 6.5 |
| `can_view_file` deja ver un archivo a su creador sin mirar niveles | **Resuelto y probado:** el creador lo ve solo si su proyecto no está borrado. La prueba lo mira para la dueña que creó f1 (`files` en 0, `media_file` nulo). | 1.3, 1.4 (C e I) |
| `accept_invitations` perdería el permiso de una invitación a un proyecto borrado | **Resuelto y probado:** revisa a quien invitó con los niveles "sin mirar el borrado"; el permiso queda guardado y vale al restaurar. | 1.3, 1.4 (F) |
| `project_sizes` da "no" con el proyecto borrado | **Resuelto y probado:** para un borrado, la puerta es `can_manage_project`; en la entrega 2 cuenta además la carpeta en la papelera de Drive. | 1.3, 3.6, pruebas B, C, J, K |
| Cada renglón del selector es un `<button>` (`ProjectSwitcher.tsx:244-275`): no admite íconos adentro | **Resuelto en el diseño, a implementar:** el renglón pasa a ser un contenedor con la zona que abre (la opción) y los íconos al lado. | 7.1 |
| Versiones viejas publicadas | **Resuelto donde importa:** la base decide (niveles en 0, política de `workspaces`, marcas no escribibles desde la API), así que una versión vieja no ve ni escribe un borrado; lo que tenga sin subir queda rechazado y a la vista. Lo que se ve raro (primer proyecto vacío, archivados como uno más) lo acota subir `min_app_version`. Una base de otro workspace sin migrar no corta la sincronización. | 6.5, 6.6, 6.7 |
| El portero recrea la carpeta del proyecto si está en la papelera de Drive (`core.ts:679-703`) | **Resuelto en el diseño:** con el proyecto borrado no se puede abrir ninguna subida (pide nivel 3), y restaurar exige traer la carpeta antes; los casos que quedan (una subida ya abierta, restaurar sin la carpeta) están en 3.8. | 3.8 |

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
| `private.page_alive` | Una página de un proyecto borrado no está viva. La cuenta de siempre queda en `page_alive_any` (sin mirar el proyecto), que usan los números de la ventana y de la papelera de proyectos. | Sus archivos entran a la papelera de archivos (de su proyecto, que nadie ve); un archivo de **otro** proyecto que solo se usaba ahí también entra, pero marcado `in_trashed_page` e `in_deleted_project`: queda fuera de "Vaciar", de la purga automática y del envío de a uno hasta que se restaure. |
| `public.purge_file`, `public.trashed_files` | `purge_file` rechaza (`file_in_deleted_project`, P0001) un archivo que usa una página de un proyecto borrado; `trashed_files` suma la columna `in_deleted_project` al final. | Quien maneja la papelera del otro proyecto (que ni ve la página) no puede romperle la foto al proyecto borrado: al restaurarlo, la foto sigue. La app lo dice ("lo usa una página de un proyecto borrado") y no muestra el botón. |
| `public.ensure_workspace` | Saltea los borrados y prefiere los no archivados, de cualquiera de sus tres caminos (propio, compartido entero, una página). | Un dispositivo nuevo nunca arranca en un proyecto borrado, ni en uno archivado si tiene otro. |
| `public.accept_invitations` | Revisa a quien invitó con los niveles "sin mirar el borrado". | Una invitación aceptada mientras el proyecto está borrado deja su permiso guardado (sin efecto); al restaurar, vale. |
| `public.project_sizes` | Para un proyecto borrado, la puerta es `can_manage_project`. | Quien puede restaurarlo sigue viendo su peso (la lista de borrados lo muestra). La app publicada lo suma en el total del diálogo de Drive, que es lo correcto: sigue ocupando el Drive. |
| Nuevas privadas | `could_view_project` (lo veía, sin mirar el borrado), `can_manage_project` (la regla de la sección 5), `refresh_project_files` (recalcula la papelera de archivos del proyecto), `page_alive_any`, `file_in_deleted_project`, `project_numbers` (los números de un proyecto, iguales activo o borrado). | Ninguna se puede llamar desde la API (`revoke` también a `authenticated`): solo las usan funciones `security definer`. |
| Nuevas públicas | `set_project_archived`, `delete_project`, `restore_project`, `trashed_projects`, `project_delete_info`. | Idempotentes: repetirlas no cambia nada. Errores: `project_not_found` (P0002) si no existe o la sesión no lo veía; `not_allowed` (42501) si lo ve pero no puede; `project_deleted` (P0001) al archivar uno borrado; `archived_invalid` (22023). `project_delete_info` y `trashed_projects` sacan sus números de `project_numbers`: la ventana y la lista de borrados muestran lo mismo, con el proyecto activo o borrado. `trashed_projects` muestra quién lo borró solo a quien lo maneja y al dueño y los admins, y los números (páginas, archivos) solo a quien lo maneja: a quien veía una sola página no le dice cuánto tenía el proyecto ni le da correos del equipo (como `list_members`). |
| Sin cambios | `workspaces_insert` (crear con el mismo id que uno borrado: `on conflict do nothing`, no da error y el proyecto sigue borrado), `remove_member` (los proyectos borrados que compartía pasan a un heredero como los demás: alguien podrá restaurarlos), `media_whoami`. | |

Archivar no toca ninguna política: los niveles no cambian.

### 1.3 La migración, completa

`supabase/migrations/20261001120000_proyectos_archivar_borrar.sql` (probada en rollback contra la base real, sección 9.3; sin aplicar):

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
-- Un archivo de otro proyecto usado en una página de un proyecto borrado no se manda a la papelera de Drive
-- (`purge_file` da `file_in_deleted_project`): restaurar ese proyecto lo tiene que encontrar.
--
-- Compatible con la app publicada: suma columnas y funciones; las que cambian conservan su firma y lo que
-- devuelven, salvo `trashed_files`, que suma una columna al final (la app lee las filas por nombre). Mientras
-- nadie borre nada, nada cambia para nadie.

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

-- Solo las llaman funciones `security definer` de este archivo: nadie más las necesita (y `could_view_project`
-- con un dueño inventado daría sí).
revoke all on function private.could_view_project(uuid, uuid) from public, anon, authenticated;
revoke all on function private.can_manage_project(uuid) from public, anon, authenticated;

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
-- La cuenta de siempre (la página y las de arriba fuera de la papelera de páginas), sin mirar el proyecto: la usan
-- los números de la ventana de borrar y de la papelera de proyectos, que tienen que dar lo mismo con el proyecto
-- activo o borrado.
create function private.page_alive_any(p uuid)
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
  select exists (select 1 from chain) and not exists (select 1 from chain c where c.deleted_at is not null);
$$;

create or replace function private.page_alive(p uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.page_alive_any(p)
     and not exists (
       select 1 from public.pages pg
       join public.workspaces w on w.id = pg.workspace_id
       where pg.id = p and w.deleted_at is not null);
$$;

-- ¿Lo usa (sin `removed_at`) alguna página de un proyecto borrado? Un archivo así no se manda a la papelera de
-- Drive (ni de a uno ni con "vaciar"): restaurar ese proyecto lo tiene que encontrar.
create function private.file_in_deleted_project(p_file uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.page_files pf
    join public.pages pg on pg.id = pf.page_id
    join public.workspaces w on w.id = pg.workspace_id
    where pf.file_id = p_file and pf.removed_at is null and w.deleted_at is not null);
$$;

revoke all on function private.page_alive_any(uuid) from public, anon, authenticated;
revoke all on function private.file_in_deleted_project(uuid) from public, anon, authenticated;

-- `purge_file` como en la migración de la papelera de archivos, más `file_in_deleted_project` (P0001): un archivo
-- de otro proyecto usado en una página de un proyecto borrado entra a la papelera de su proyecto, pero no se
-- puede mandar a la papelera de Drive mientras ese proyecto esté borrado (quien lo manda ni siquiera ve la
-- página). Pedirlo de nuevo sobre uno ya pedido sigue sin cambiar nada.
create or replace function public.purge_file(p_file uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  f record;
begin
  select fl.project_id, fl.trashed_at, fl.purged_at into f from public.files fl where fl.id = p_file for update;
  if not found or (private.file_level(p_file) < 1 and not private.can_see_file_trash(f.project_id)) then
    raise exception 'file_not_found' using errcode = 'P0002';
  end if;
  if not private.can_purge_files(f.project_id) then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'Only the owner or an admin of the workspace sends files to the Google Drive trash.';
  end if;
  if f.trashed_at is null then
    raise exception 'file_not_trashed' using errcode = 'P0001',
      hint = 'A page still uses this file: it is not in the trash.';
  end if;
  if f.purged_at is null then
    if private.file_in_deleted_project(p_file) then
      raise exception 'file_in_deleted_project' using errcode = 'P0001',
        hint = 'A page of a deleted project uses this file: it comes back if that project is restored.';
    end if;
    update public.files set purged_at = now(), purged_by = auth.uid() where id = p_file;
  end if;
end;
$$;

-- `trashed_files` como en la migración de la papelera de archivos, con una columna más al final:
-- `in_deleted_project` (lo usa una página de un proyecto borrado; la app lo dice y no ofrece mandarlo a Drive).
-- Cambia lo que devuelve: drop y create.
drop function public.trashed_files(uuid);
create function public.trashed_files(p_project uuid)
returns table (id uuid, name text, mime text, size bigint, thumb_at timestamptz, trashed_at timestamptz,
               days_left int, purged_at timestamptz, in_trashed_page boolean, trashed_page_title text,
               in_deleted_project boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_project is null or not private.can_see_file_trash(p_project) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return query
    select f.id, f.name, f.mime, f.size, f.thumb_at, f.trashed_at,
           greatest(0, ceil(extract(epoch from (f.trashed_at + interval '30 days' - now())) / 86400))::int,
           f.purged_at, tp.id is not null, tp.title, private.file_in_deleted_project(f.id)
    from public.files f
    left join lateral (
      -- El título solo si la sesión ve esa página (puede ser de otro proyecto): si no, null.
      select pg.id, case when private.page_level(pg.id) >= 1 then pg.title end as title
      from public.page_files pf
      join public.pages pg on pg.id = pf.page_id
      where pf.file_id = f.id and pf.removed_at is null and not private.page_alive(pf.page_id)
      order by private.page_level(pg.id) >= 1 desc, pg.title, pg.id
      limit 1
    ) tp on true
    where f.project_id = p_project and f.trashed_at is not null and f.drive_trashed_at is null
    order by f.trashed_at desc, f.id;
end;
$$;

revoke all on function public.trashed_files(uuid) from public, anon;
grant execute on function public.trashed_files(uuid) to authenticated;

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

-- Los números de un proyecto, iguales con el proyecto activo o borrado (los usan la ventana de borrar y la
-- papelera de proyectos, así las dos muestran lo mismo). Páginas: vivas y en la papelera de páginas, sin mirar el
-- proyecto (`page_alive_any`). Archivos: subidos y fuera de la papelera de Drive, con su peso (como `drive_*` de
-- `project_sizes`); sin subir (los que usa alguna página que no está en la papelera de páginas); del proyecto
-- usados en páginas vivas de otros proyectos (dejan de verse ahí mientras esté borrado); y de otros proyectos que
-- solo usan páginas de este (entran a la papelera de su proyecto mientras esté borrado).
create function private.project_numbers(p_project uuid)
returns json
language sql stable security definer set search_path = ''
as $$
  select json_build_object(
    'pages', (select count(*) from public.pages pg
              where pg.workspace_id = p_project and private.page_alive_any(pg.id)),
    'trashed_pages', (select count(*) from public.pages pg
                      where pg.workspace_id = p_project and not private.page_alive_any(pg.id)),
    'files', (select count(*) from public.files f
              where f.project_id = p_project and f.drive_id is not null and f.drive_trashed_at is null),
    'drive_bytes', (select coalesce(sum(f.size), 0)::bigint from public.files f
                    where f.project_id = p_project and f.drive_id is not null and f.drive_trashed_at is null),
    'pending_files', (select count(*) from public.files f
                      where f.project_id = p_project and f.drive_id is null and f.purged_at is null
                        and exists (select 1 from public.page_files pf
                                    where pf.file_id = f.id and pf.removed_at is null
                                      and private.page_alive_any(pf.page_id))),
    'used_elsewhere', (select count(distinct pf.file_id)
                       from public.page_files pf
                       join public.files f on f.id = pf.file_id
                       join public.pages pg on pg.id = pf.page_id
                       where f.project_id = p_project and pg.workspace_id <> p_project
                         and pf.removed_at is null and private.page_alive(pf.page_id)),
    'foreign_only_here', (select count(distinct pf.file_id)
                          from public.page_files pf
                          join public.files f on f.id = pf.file_id
                          join public.pages pg on pg.id = pf.page_id
                          where pg.workspace_id = p_project and f.project_id <> p_project
                            and f.drive_trashed_at is null
                            and pf.removed_at is null and private.page_alive_any(pf.page_id)
                            and not exists (
                              select 1 from public.page_files o
                              join public.pages op on op.id = o.page_id
                              where o.file_id = pf.file_id and op.workspace_id <> p_project
                                and o.removed_at is null and private.page_alive(o.page_id))));
$$;

revoke all on function private.project_numbers(uuid) from public, anon, authenticated;

-- La papelera de proyectos: los borrados que la sesión veía antes, lo último primero. `days_left`: cuántos días
-- faltan para los 30 (30 el día que entra, 0 si ya pasaron; después se sigue pudiendo restaurar). `can_restore`:
-- si la sesión lo puede restaurar. Quién lo borró (`deleted_by`, `deleted_by_email`): solo a quien lo maneja y al
-- dueño y los admins (los demás no ven correos del equipo: `list_members`). `pages` y `files` (los mismos números
-- que la ventana de borrar, `project_numbers`): solo a quien lo maneja (a quien veía una sola página no se le dice
-- cuánto tenía el proyecto). El peso sale de `project_sizes` (también solo a quien puede restaurarlo).
create function public.trashed_projects()
returns table (id uuid, name text, archived_at timestamptz, deleted_at timestamptz, deleted_by uuid,
               deleted_by_email text, days_left int, can_restore boolean, pages int, files int)
language sql stable security definer set search_path = ''
as $$
  select w.id, w.name, w.archived_at, w.deleted_at,
         case when m.can or m.staff then w.deleted_by end,
         case when m.can or m.staff then u.email::text end,
         greatest(0, ceil(extract(epoch from (w.deleted_at + interval '30 days' - now())) / 86400))::int,
         m.can,
         case when m.can then (n.j ->> 'pages')::int end,
         case when m.can then (n.j ->> 'files')::int end
  from public.workspaces w
  cross join lateral (
    select private.can_manage_project(w.id) as can,
           coalesce(private.workspace_role() in ('owner', 'admin'), false) as staff
  ) m
  cross join lateral (select case when m.can then private.project_numbers(w.id) end as j) n
  left join auth.users u on u.id = w.deleted_by
  where w.deleted_at is not null
    and private.could_view_project(w.id, w.owner_id)
  order by w.deleted_at desc, w.id;
$$;

-- Lo que muestra la ventana de borrar (y la lista de borrados al mandar sus archivos a Drive), a quien lo maneja:
-- `project_numbers` más con cuántas personas activas está compartido (sin contar a quien pregunta). Da lo mismo con
-- el proyecto activo o borrado.
create function public.project_delete_info(p_project uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.owner_id into w from public.workspaces pr where pr.id = p_project;
  if not found or not private.could_view_project(p_project, w.owner_id) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not private.can_manage_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return (private.project_numbers(p_project)::jsonb || jsonb_build_object(
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
                    where a.uid is distinct from auth.uid())))::json;
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
-- El mismo orden de siempre (el propio más viejo; si no, uno con permiso sobre el proyecto; si no, el de una página
-- compartida), pero un archivado va después de todos los no archivados, de cualquiera de los tres caminos.
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

  select c.id into ws
  from (
    select w.id, 1 as step, w.created_at, w.archived_at
    from public.workspaces w
    where w.owner_id = uid and w.deleted_at is null
    union all
    select w.id, 2, w.created_at, w.archived_at
    from public.grants g
    join public.workspaces w on w.id = g.project_id
    where g.user_id = uid and g.revoked_at is null and w.deleted_at is null
    union all
    select w.id, 3, w.created_at, w.archived_at
    from public.grants g
    join public.pages pg on pg.id = g.page_id
    join public.workspaces w on w.id = pg.workspace_id
    where g.user_id = uid and g.revoked_at is null and w.deleted_at is null
  ) c
  order by (c.archived_at is not null), c.step, c.created_at, c.id
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
- **Tiempo (medido, sección 9.3):** `refresh_project_files` hace un `refresh_file_trash` por archivo (bloquea la
  fila y mira sus usos). Con el proyecto más grande de la base (la importación de Coda: 640 páginas, 2297
  archivos, 2602 usos), `delete_project` tardó entre **1,2 y 2,1 s** y `restore_project` entre **1,3 y 1,4 s**
  (varias corridas), y `project_delete_info` unos 0,6 s (con los números nuevos de `project_numbers`): entre 0,5
  y 0,9 ms por archivo, adentro del tope de 8 s de las consultas de la API (`authenticated`). El límite cae cerca
  de los 9.000–12.000 archivos por proyecto; si alguna vez se acerca, `refresh_project_files` se parte en tandas
  (la app llama de nuevo hasta que termine).
- **Costo en lo de todos los días (medido por la auditoría):** contar como la dueña real `pages`, `workspaces`,
  `files` y `page_files` por las políticas pasó de unos 2,9 s a unos 3,3 s (+10 a 15 %, 719 páginas y 2451
  archivos): es el `exists` de más de `user_page_level` por fila. Aceptable; está en "Riesgos".

### 1.4 La prueba SQL, completa

`supabase/tests/proyectos_borrar_permisos.sql` (corrida contra la base real dentro de la transacción con la
migración: pasa; sección 9.3). Huella antes de borrar y después de restaurar (la regla "exactamente como estaba"),
cada persona con lo que ve y lo que no, la papelera de archivos y el peso mientras está borrado, la invitación
aceptada en el medio, que nada se escribe directo, que un archivo de otro proyecto usado solo en el borrado no se
manda a Drive (`file_in_deleted_project`, sección C), que la ventana da los mismos números con el proyecto
borrado, que `ensure_workspace` prefiere uno compartido sin archivar a uno propio archivado, y (sección I) todos los niveles y las filas que ve cada persona
—dueña, admin que lo maneja, miembro, invitada por una página, admin sin permiso, invitada nueva— en cero con el
proyecto borrado y otra vez iguales a los de antes al restaurarlo, también en los buckets `page-files` y `thumbs`.

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

-- El creador de un proyecto (miembro, sin ser admin) archiva y desarchiva el suyo. Con su único proyecto propio
-- archivado y otro compartido sin archivar, ensure_workspace da el compartido (el archivado va después de todos).
select set_config('role', 'postgres', true);
insert into public.grants (id, user_id, project_id, page_id, level) values
  ('00000000-0000-4000-8000-0000000d6001', '00000000-0000-4000-8000-0000000d0005', '00000000-0000-4000-8000-0000000d1002',
   null, 'view');
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0005');
do $$
begin
  assert public.ensure_workspace() = '00000000-0000-4000-8000-0000000d1003', 'ensure_workspace no da M a su creador';
  perform public.set_project_archived('00000000-0000-4000-8000-0000000d1003', true);
  assert public.ensure_workspace() = '00000000-0000-4000-8000-0000000d1002',
    'ensure_workspace prefiere el propio archivado a uno compartido sin archivar';
  perform public.set_project_archived('00000000-0000-4000-8000-0000000d1003', false);
end;
$$;
select set_config('role', 'postgres', true);
delete from public.grants where id = '00000000-0000-4000-8000-0000000d6001';
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0005');
do $$
begin
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
  -- f3 (de O) se usa solo en p2.
  assert (i ->> 'foreign_only_here')::int = 1, format('de otros proyectos usados solo acá: %s', i);
  perform set_config('borrar.info', i::text, true);
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
         and r.pages = 2 and r.files = 3, format('papelera de proyectos de la dueña: %s', r);
  -- La ventana da lo mismo con P borrado que antes (las mismas cuentas que la papelera de proyectos).
  assert public.project_delete_info('00000000-0000-4000-8000-0000000d1001')::jsonb = current_setting('borrar.info')::jsonb,
    format('ventana de P borrado: %s', public.project_delete_info('00000000-0000-4000-8000-0000000d1001'));

  -- El peso: f1 y f5 entraron a la papelera de la app (f5 sin subir: solo ahí); f4 sigue en uso por o1.
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') = '321000/3 4021000/3 0/0 0/0',
    format('peso de P borrado: %s', pg_temp.size_of('00000000-0000-4000-8000-0000000d1001'));
  -- f3 (de O) se usaba solo en p2: entra a la papelera de O, marcado como usado por una página que no está viva.
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1002') = '50000000/1 50000000/1 0/0 0/0',
    format('peso de O con P borrado: %s', pg_temp.size_of('00000000-0000-4000-8000-0000000d1002'));
  select * into r from public.trashed_files('00000000-0000-4000-8000-0000000d1002') t
  where t.id = '00000000-0000-4000-8000-0000000d3003';
  assert found and r.in_trashed_page and r.trashed_page_title is null and r.in_deleted_project,
    format('f3 en la papelera de O: %s', r);
  -- Nadie lo manda a la papelera de Drive mientras P esté borrado (la dueña de O no ve p2): al restaurar P vuelve.
  perform pg_temp.expect_error($q$select public.purge_file('00000000-0000-4000-8000-0000000d3003')$q$,
    'file_in_deleted_project', 'manda a Drive un archivo que usa una página de un proyecto borrado');
  select * into r from public.trashed_files('00000000-0000-4000-8000-0000000d1002') t
  where t.id = '00000000-0000-4000-8000-0000000d3003';
  assert r.purged_at is null, 'f3 quedó pedido para Drive';
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
  -- Una admin ve quién lo borró, pero no cuánto tenía (no lo maneja).
  assert (select t.deleted_by_email = 'pb-ow@test.invalid' and t.pages is null and t.files is null
          from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1001'),
    'la admin con ver: quién lo borró o los números de P no son los esperados';
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
  assert (select t.deleted_by_email is null and t.pages is null
          from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1001'),
    'el miembro ve quién borró P o cuánto tenía';
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
  -- Ni el correo de quien lo borró ni cuánto tenía el proyecto: solo veía una página.
  assert (select t.deleted_by is null and t.deleted_by_email is null and t.pages is null and t.files is null
          from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1001'),
    'la invitada ve quién borró P o cuánto tenía';
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
                            'private.user_page_level_any(uuid,uuid)', 'private.user_project_level_any(uuid,uuid)',
                            'private.page_alive_any(uuid)', 'private.file_in_deleted_project(uuid)',
                            'private.project_numbers(uuid)', 'public.purge_file(uuid)', 'public.trashed_files(uuid)'] loop
    assert (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
            where p.oid = fn::regprocedure), format('%s no es security definer con search_path vacío', fn);
  end loop;
  assert not has_function_privilege('authenticated', 'private.refresh_project_files(uuid)', 'execute'),
    'authenticated puede recalcular la papelera de un proyecto';
  assert not has_function_privilege('authenticated', 'private.user_page_level_any(uuid,uuid)', 'execute'),
    'authenticated llama a user_page_level_any';
  foreach fn in array array['private.could_view_project(uuid,uuid)', 'private.can_manage_project(uuid)',
                            'private.page_alive_any(uuid)', 'private.file_in_deleted_project(uuid)',
                            'private.project_numbers(uuid)'] loop
    assert not has_function_privilege('authenticated', fn, 'execute'), format('authenticated llama a %s', fn);
  end loop;
  assert has_function_privilege('authenticated', 'public.trashed_files(uuid)', 'execute'),
    'authenticated perdió trashed_files';
  assert (select schema_version from public.workspace_settings where id) >= 9, 'la versión de la base no es 9';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- I. Todos los niveles en 0 con el proyecto borrado, y de vuelta igual al restaurar (por persona), más los
--    buckets `page-files` y `thumbs`
-- ---------------------------------------------------------------------------------------------------
-- Todo lo que decide permisos sobre P, p1, p2 y f1, en un texto. Corre como la sesión.
create function pg_temp.levels() returns text language sql as $$
  select concat_ws(' ',
    'pl1=' || private.page_level('00000000-0000-4000-8000-0000000d2001'),
    'pl2=' || private.page_level('00000000-0000-4000-8000-0000000d2002'),
    'prl=' || private.project_level('00000000-0000-4000-8000-0000000d1001'),
    'vp=' || private.can_view_page('00000000-0000-4000-8000-0000000d2001'),
    'ep=' || private.can_edit_page('00000000-0000-4000-8000-0000000d2001'),
    'cp=' || private.can_create_page('00000000-0000-4000-8000-0000000d1001', null),
    'cpp=' || private.can_create_page('00000000-0000-4000-8000-0000000d1001', '00000000-0000-4000-8000-0000000d2001'),
    'sh=' || private.can_share('00000000-0000-4000-8000-0000000d1001', null),
    'shp=' || private.can_share(null, '00000000-0000-4000-8000-0000000d2001'),
    'ft=' || private.can_see_file_trash('00000000-0000-4000-8000-0000000d1001'),
    'pu=' || private.can_purge_files('00000000-0000-4000-8000-0000000d1001'),
    'fl=' || private.file_level('00000000-0000-4000-8000-0000000d3001'),
    'es=' || private.can_edit_some_page('00000000-0000-4000-8000-0000000d1001'),
    'w=' || (select count(*) from public.workspaces w where w.id = '00000000-0000-4000-8000-0000000d1001'),
    'pg=' || (select count(*) from public.pages pg where pg.workspace_id = '00000000-0000-4000-8000-0000000d1001'),
    'up=' || (select count(*) from public.page_updates u where u.page_id = '00000000-0000-4000-8000-0000000d2001'),
    'f=' || (select count(*) from public.files f where f.project_id = '00000000-0000-4000-8000-0000000d1001'),
    'pf=' || (select count(*) from public.page_files pf where pf.page_id = '00000000-0000-4000-8000-0000000d2001'),
    'c=' || (select count(*) from public.comments c where c.page_id = '00000000-0000-4000-8000-0000000d2001'),
    'st=' || (select count(*) from storage.objects o
              where (o.bucket_id = 'thumbs' and o.name = '00000000-0000-4000-8000-0000000d3001.jpg')
                 or (o.bucket_id = 'page-files' and o.name = '00000000-0000-4000-8000-0000000d2001/x.jpg')));
$$;

-- Lo que da todo cero.
create function pg_temp.zero() returns text language sql as $$
  select 'pl1=0 pl2=0 prl=0 vp=false ep=false cp=false cpp=false sh=false shp=false ft=false pu=false fl=0 es=false w=0 pg=0 up=0 f=0 pf=0 c=0 st=0';
$$;

select set_config('role', 'postgres', true);
-- Una miniatura de f1 y un archivo viejo de p1 en los buckets (filas solas: el contenido no importa).
insert into storage.objects (bucket_id, name) values
  ('thumbs', '00000000-0000-4000-8000-0000000d3001.jpg'),
  ('page-files', '00000000-0000-4000-8000-0000000d2001/x.jpg');

-- Antes de borrar: cada persona anota lo suyo.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001'); select set_config('borrar.lv1', pg_temp.levels(), true);
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002'); select set_config('borrar.lv2', pg_temp.levels(), true);
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004'); select set_config('borrar.lv4', pg_temp.levels(), true);
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0006'); select set_config('borrar.lv6', pg_temp.levels(), true);
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0007'); select set_config('borrar.lv7', pg_temp.levels(), true);
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0009'); select set_config('borrar.lv9', pg_temp.levels(), true);

do $$
begin
  -- Que la prueba mida algo: antes de borrar, la dueña ve todo, la invitada ve p1 y p2 por su permiso de
  -- página, y la admin sin permiso no ve nada.
  assert current_setting('borrar.lv1') like 'pl1=4 pl2=4 prl=4 vp=true ep=true cp=true cpp=true sh=true shp=true ft=true pu=true fl=4 es=true w=1 pg=3 up=1 f=4 pf=2 c=1 st=2',
    format('la dueña antes: %s', current_setting('borrar.lv1'));
  assert current_setting('borrar.lv6') like 'pl1=1 pl2=1 prl=0 vp=true ep=false % w=1 pg=2 %',
    format('la invitada antes: %s', current_setting('borrar.lv6'));
  assert current_setting('borrar.lv7') = pg_temp.zero(), format('la admin sin permiso antes: %s', current_setting('borrar.lv7'));
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
select public.delete_project('00000000-0000-4000-8000-0000000d1001');

-- Con P borrado: todo en cero para todos (dueña, admin que lo borró, miembro, invitada por página, sin permiso,
-- invitada nueva).
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$ begin assert pg_temp.levels() = pg_temp.zero(), format('dueña con P borrado: %s', pg_temp.levels()); end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
do $$ begin assert pg_temp.levels() = pg_temp.zero(), format('admin con P borrado: %s', pg_temp.levels()); end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$ begin assert pg_temp.levels() = pg_temp.zero(), format('miembro con P borrado: %s', pg_temp.levels()); end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0006');
do $$
begin
  assert pg_temp.levels() = pg_temp.zero(), format('invitada con P borrado: %s', pg_temp.levels());
  -- Tampoco por los caminos de la papelera de archivos ni del portero.
  assert public.media_file('00000000-0000-4000-8000-0000000d3001') is null, 'la invitada: media_file da f1';
  perform pg_temp.expect_error($q$select public.project_delete_info('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'la invitada lee la ventana de borrar de P borrado');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0007');
do $$
begin
  assert pg_temp.levels() = pg_temp.zero(), format('admin sin permiso con P borrado: %s', pg_temp.levels());
  perform pg_temp.expect_error($q$select public.project_delete_info('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_not_found', 'la admin sin permiso lee la ventana de borrar');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0009');
do $$ begin assert pg_temp.levels() = pg_temp.zero(), format('invitada nueva con P borrado: %s', pg_temp.levels()); end; $$;

-- Un proyecto borrado no se puede archivar; y la papelera la ve la invitada por página (sin restaurar).
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
begin
  perform pg_temp.expect_error($q$select public.set_project_archived('00000000-0000-4000-8000-0000000d1001', true)$q$,
    'project_deleted', 'archiva un proyecto borrado');
end;
$$;

-- Restaurar (la dueña): cada persona vuelve a tener exactamente lo de antes.
select public.restore_project('00000000-0000-4000-8000-0000000d1001');
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$ begin assert pg_temp.levels() = current_setting('borrar.lv1'), format('dueña restaurado: %s', pg_temp.levels()); end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
do $$ begin assert pg_temp.levels() = current_setting('borrar.lv2'), format('admin restaurado: %s', pg_temp.levels()); end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$ begin assert pg_temp.levels() = current_setting('borrar.lv4'), format('miembro restaurado: %s', pg_temp.levels()); end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0006');
do $$ begin assert pg_temp.levels() = current_setting('borrar.lv6'), format('invitada restaurado: %s', pg_temp.levels()); end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0007');
do $$ begin assert pg_temp.levels() = current_setting('borrar.lv7'), format('sin permiso restaurado: %s', pg_temp.levels()); end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0009');
do $$ begin assert pg_temp.levels() = current_setting('borrar.lv9'), format('invitada nueva restaurado: %s', pg_temp.levels()); end; $$;
select set_config('role', 'postgres', true);

rollback;

select 'ok' as result;
```

Lo que la prueba no cubre y queda para la de punta a punta (sección 9): el portero de verdad con un proyecto
borrado (decide con `media_file`, que la prueba mira: da nulo) y dos pedidos a la vez (un borrado mientras otra
sesión sube contenido: la prueba corre en una sola conexión). Los buckets se miran con filas de
`storage.objects` (sin el archivo: las políticas solo miran el nombre). El tiempo con miles de archivos se midió
aparte, con el proyecto más grande de la base (sección 9.3).

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

### 2.3 La migración de la entrega 3 (*Delete forever*)

**Decisión del diseño:** *Delete forever* existe, pero es una marca y no un borrado. Así se cumplen las dos
reglas a la vez: "no hay borrado duro" (ninguna fila se borra, nunca) y "se puede restaurar durante 30 días"
(la base no deja usarlo antes). Lo que hace de verdad, liberar el Drive, ya lo hace la casilla de la entrega 2;
*Delete forever* solo saca el proyecto de la papelera de proyectos y deja sus archivos marcados como mandados a
la papelera de Drive. Si Lega prefiere que no exista hasta pedirlo, la entrega 3 simplemente no se construye:
nada de las entregas 1 y 2 depende de ella.

Cómo se usa desde la app (lista de borrados, después de los 30 días, dueño o admin que maneja el proyecto, con
la palabra): si la carpeta todavía no está en la papelera de Drive, primero el portero la manda
(`POST /project/trash`, sección 3.8) y después `purge_project`. La base exige ese orden (`drive_trash_first`): un
proyecto con archivos subidos fuera de la papelera de Drive no se marca, para que el peso nunca diga que se
liberó algo que sigue ocupando.

`supabase/migrations/20261010120000_proyectos_borrar_definitivo.sql` (`schema_version` 11; probada en rollback
encima de la 9 y la 10, sección 9.3; sin aplicar). **Lo implementado** es `20261101120000_proyectos_purgar.sql`, con
`schema_version` 23, sobre la base de hoy y con lo que cambió desde este diseño (ver "Cómo quedó (entrega 3)"):

```sql
-- LGA Shot Docs · borrar un proyecto para siempre (P.14, entrega 3; Docs/Doc_Proyectos_Borrar.md, sección 2).
--
-- *Delete forever* no borra ninguna fila: marca el proyecto (`purged_at`, `purged_by`), que sale de la papelera de
-- proyectos y ya no se restaura desde la app. Sus archivos subidos quedan marcados como mandados a la papelera de
-- Drive (la carpeta tiene que haber ido antes: `drive_trash_first`). El texto, las páginas y los comentarios
-- siguen en la base y se recuperan solo a mano (SQL del dueño de la base); los archivos, desde la papelera de
-- Drive mientras Google los tenga.
--
-- Recién a los 30 días de borrado (`project_trash_not_due`): el plazo "se puede restaurar durante 30 días" se
-- cumple siempre. Solo dueño y admins que manejan el proyecto (`private.can_purge_project`). Nada automático.

alter table public.workspaces
  add column purged_at timestamptz,
  add column purged_by uuid references auth.users (id) on delete set null,
  add constraint workspaces_purged    check (purged_at is null or deleted_at is not null),
  add constraint workspaces_purged_by check (purged_by is null or purged_at is not null);

-- Errores: `project_not_found` (P0002) si no existe o la sesión no lo veía; `not_allowed` (42501);
-- `project_not_deleted` (P0001); `project_trash_not_due` (P0001) antes de los 30 días; `drive_trash_first`
-- (P0001) si tiene archivos subidos que no están en la papelera de Drive ni en una carpeta confirmada ahí (o que
-- el portero no encontró). Repetirlo no cambia nada.
create function public.purge_project(p_project uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.owner_id, pr.deleted_at, pr.drive_trash_requested_at, pr.drive_trashed_at, pr.drive_missing_at,
         pr.purged_at into w
  from public.workspaces pr where pr.id = p_project for update;
  if not found or not private.could_view_project(p_project, w.owner_id) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not private.can_purge_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'Only an owner or admin of the workspace who manages the project deletes it forever.';
  end if;
  if w.purged_at is not null then
    return;
  end if;
  if w.deleted_at is null then
    raise exception 'project_not_deleted' using errcode = 'P0001';
  end if;
  if w.deleted_at > now() - interval '30 days' then
    raise exception 'project_trash_not_due' using errcode = 'P0001',
      hint = 'A deleted project can be deleted forever 30 days after it was deleted.';
  end if;
  if exists (
       select 1 from public.files f
       where f.project_id = p_project and f.drive_id is not null and f.drive_trashed_at is null
         and not ((w.drive_trashed_at is not null or w.drive_missing_at is not null)
                  and coalesce(f.uploaded_at, '-infinity') <= w.drive_trash_requested_at)) then
    raise exception 'drive_trash_first' using errcode = 'P0001',
      hint = 'Send the project folder to the Google Drive trash first.';
  end if;
  perform private.project_files_purged(p_project);
  update public.workspaces set purged_at = now(), purged_by = auth.uid() where id = p_project;
end;
$$;

revoke all on function public.purge_project(uuid) from public, anon;
grant execute on function public.purge_project(uuid) to authenticated;

-- Un proyecto borrado para siempre no se restaura (`project_purged`). Lo demás, como en la entrega 2.
create or replace function public.restore_project(p_project uuid, p_without_drive boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.owner_id, pr.deleted_at, pr.drive_trash_requested_at, pr.drive_missing_at, pr.purged_at into w
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
  if w.purged_at is not null then
    raise exception 'project_purged' using errcode = 'P0001';
  end if;
  if w.drive_trash_requested_at is not null and w.drive_missing_at is null then
    if not coalesce(p_without_drive, false) then
      raise exception 'drive_untrash_first' using errcode = 'P0001',
        hint = 'Bring the project folder back from the Google Drive trash first, or restore it without its files.';
    end if;
    update public.workspaces set drive_missing_at = now(), drive_missing_by = auth.uid() where id = p_project;
  end if;
  update public.workspaces set deleted_at = null, deleted_by = null where id = p_project;
  perform private.refresh_project_files(p_project);
end;
$$;

-- La carpeta de un proyecto borrado para siempre no vuelve desde la app. Lo demás, como en la entrega 2.
create or replace function public.project_drive_untrashed(p_project uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.purged_at into w from public.workspaces pr where pr.id = p_project for update;
  if not found or not private.can_purge_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if w.purged_at is not null then
    raise exception 'project_purged' using errcode = 'P0001';
  end if;
  update public.workspaces
  set drive_trash_requested_at = null, drive_trash_requested_by = null, drive_trashed_at = null,
      drive_missing_at = null, drive_missing_by = null
  where id = p_project and drive_trash_requested_at is not null;
end;
$$;

-- La papelera de proyectos deja afuera los borrados para siempre. Misma firma que en la entrega 2.
create or replace function public.trashed_projects()
returns table (id uuid, name text, archived_at timestamptz, deleted_at timestamptz, deleted_by uuid,
               deleted_by_email text, days_left int, can_restore boolean, pages int, files int,
               drive_trash_requested_at timestamptz, drive_trashed_at timestamptz, drive_missing_at timestamptz,
               can_purge boolean)
language sql stable security definer set search_path = ''
as $$
  select w.id, w.name, w.archived_at, w.deleted_at,
         case when m.can or m.staff then w.deleted_by end,
         case when m.can or m.staff then u.email::text end,
         greatest(0, ceil(extract(epoch from (w.deleted_at + interval '30 days' - now())) / 86400))::int,
         m.can,
         case when m.can then (n.j ->> 'pages')::int end,
         case when m.can then (n.j ->> 'files')::int end,
         case when m.can then w.drive_trash_requested_at end,
         case when m.can then w.drive_trashed_at end,
         case when m.can then w.drive_missing_at end,
         m.can and private.can_purge_project(w.id)
  from public.workspaces w
  cross join lateral (
    select private.can_manage_project(w.id) as can,
           coalesce(private.workspace_role() in ('owner', 'admin'), false) as staff
  ) m
  cross join lateral (select case when m.can then private.project_numbers(w.id) end as j) n
  left join auth.users u on u.id = w.deleted_by
  where w.deleted_at is not null and w.purged_at is null
    and private.could_view_project(w.id, w.owner_id)
  order by w.deleted_at desc, w.id;
$$;

update public.workspace_settings set schema_version = 11 where id and schema_version < 11;

notify pgrst, 'reload schema';
```

Su prueba (`supabase/tests/proyectos_borrar_definitivo_permisos.sql`; en el archivo final lleva la preparación
de la 1.4, acá sigue a las pruebas de la entrega 2 con las mismas personas y datos): el plazo, el orden con
Drive, quién puede (el creador miembro no; la dueña no ve el privado de otro), que no se restaura ni se trae la
carpeta, el peso y que **ninguna fila se borró**.

```sql
-- Pruebas de la entrega 3 (borrar para siempre). Siguen a las de la entrega 2: O activo, con o1 y f3 (subido,
-- usado solo en p2 de P como uso de afuera).

select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
begin
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1002')$q$,
    'project_not_deleted', 'borra para siempre un proyecto activo');
  perform public.delete_project('00000000-0000-4000-8000-0000000d1002');
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1002')$q$,
    'project_trash_not_due', 'borra para siempre antes de los 30 días');
end;
$$;
-- Pasaron 31 días.
select set_config('role', 'postgres', true);
update public.workspaces set deleted_at = now() - interval '31 days' where id = '00000000-0000-4000-8000-0000000d1002';
select set_config('borrar.filas11', (select format('%s %s %s %s',
  (select count(*) from public.pages where id::text like '00000000-0000-4000-8000-0000000d2%'),
  (select count(*) from public.page_updates where page_id::text like '00000000-0000-4000-8000-0000000d2%'),
  (select count(*) from public.files where id::text like '00000000-0000-4000-8000-0000000d3%'),
  (select count(*) from public.comments where id::text like '00000000-0000-4000-8000-0000000d4%'))), true);

-- Quien no es dueño ni admin que lo maneja, no.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$ begin
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1002')$q$,
    'project_not_found', 'un miembro sin permiso sobre O lo borra para siempre');
end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0007');
do $$ begin
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1002')$q$,
    'project_not_found', 'la admin sin permiso borra O para siempre');
end; $$;

select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
begin
  assert (select t.days_left = 0 and t.can_purge from public.trashed_projects() t
          where t.id = '00000000-0000-4000-8000-0000000d1002'), 'O a los 31 días: days_left o can_purge';
  -- f3 está subido y la carpeta no se mandó: primero la carpeta.
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1002')$q$,
    'drive_trash_first', 'borra para siempre con archivos fuera de la papelera de Drive');
  perform public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1002');
  perform public.project_drive_trashed('00000000-0000-4000-8000-0000000d1002');
  perform public.purge_project('00000000-0000-4000-8000-0000000d1002');
  perform public.purge_project('00000000-0000-4000-8000-0000000d1002');
  assert not exists (select 1 from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1002'),
    'O borrado para siempre sigue en la papelera de proyectos';
  perform pg_temp.expect_error($q$select public.restore_project('00000000-0000-4000-8000-0000000d1002')$q$,
    'project_purged', 'restaura un proyecto borrado para siempre');
  perform pg_temp.expect_error($q$select public.restore_project('00000000-0000-4000-8000-0000000d1002', true)$q$,
    'project_purged', 'restaura sin Drive un proyecto borrado para siempre');
  perform pg_temp.expect_error($q$select public.project_drive_untrashed('00000000-0000-4000-8000-0000000d1002')$q$,
    'project_purged', 'trae la carpeta de un proyecto borrado para siempre');
  perform pg_temp.expect_error($q$select public.set_project_archived('00000000-0000-4000-8000-0000000d1002', false)$q$,
    'project_deleted', 'desarchiva un proyecto borrado para siempre');
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1002') = 0, 'la dueña ve O';
  -- f3 quedó como mandado a la papelera de Drive: su peso cuenta ahí (30 días) y no en el principal.
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1002') = '0/0 0/0 50000000/1 0/0',
    format('peso de O borrado para siempre: %s', pg_temp.size_of('00000000-0000-4000-8000-0000000d1002'));
end;
$$;

select set_config('role', 'postgres', true);
do $$
begin
  -- Ninguna fila se borró: O, su página, su archivo y todo lo demás siguen.
  assert (select count(*) from public.workspaces where id = '00000000-0000-4000-8000-0000000d1002') = 1, 'se borró O';
  assert (select format('%s %s %s %s',
    (select count(*) from public.pages where id::text like '00000000-0000-4000-8000-0000000d2%'),
    (select count(*) from public.page_updates where page_id::text like '00000000-0000-4000-8000-0000000d2%'),
    (select count(*) from public.files where id::text like '00000000-0000-4000-8000-0000000d3%'),
    (select count(*) from public.comments where id::text like '00000000-0000-4000-8000-0000000d4%')))
    = current_setting('borrar.filas11'), 'borrar para siempre borró filas';
  assert (select f.purged_at is not null and f.drive_trashed_at is not null from public.files f
          where f.id = '00000000-0000-4000-8000-0000000d3003'), 'f3 no quedó marcado';
  assert (select w.purged_at is not null and w.purged_by = '00000000-0000-4000-8000-0000000d0001'
                 and w.drive_trash_requested_at is null from public.workspaces w
          where w.id = '00000000-0000-4000-8000-0000000d1002'), 'las marcas de O no son las esperadas';
end;
$$;

-- El creador miembro de M no lo borra para siempre (no es dueño ni admin), ni con los 30 días cumplidos y sin
-- archivos.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0005');
select public.delete_project('00000000-0000-4000-8000-0000000d1003');
select set_config('role', 'postgres', true);
update public.workspaces set deleted_at = now() - interval '31 days' where id = '00000000-0000-4000-8000-0000000d1003';
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0005');
do $$ begin
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1003')$q$,
    'not_allowed', 'el creador miembro borra M para siempre');
end; $$;
-- La dueña no ve M (es privado de otro): para ella no existe.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$ begin
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1003')$q$,
    'project_not_found', 'la dueña borra para siempre un proyecto privado de otro');
end; $$;

select set_config('role', 'anon', true);
select set_config('request.jwt.claims', '', true);
do $$ begin
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1002')$q$, '42501', 'anon: borra para siempre');
end; $$;
select set_config('role', 'postgres', true);
do $$
begin
  assert (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
          where p.oid = 'public.purge_project(uuid)'::regprocedure), 'purge_project no es security definer';
  assert (select schema_version from public.workspace_settings where id) >= 11, 'la versión de la base no es 11';
end;
$$;
```

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

**Una marca en el proyecto, no en cada archivo.** Mientras la carpeta esté en la papelera de Drive, el estado vive
en columnas de `workspaces` (`drive_trash_requested_at`/`_by`, `drive_trashed_at` y, si se restauró sin la
carpeta, `drive_missing_at`/`_by`) y **los archivos no se tocan**. Restaurar con la carpeta de vuelta solo borra
esas marcas: los archivos quedan exactamente como estaban. Mientras haya marca, los archivos subidos hasta el
pedido se tratan como "en la papelera de Drive" (el peso los cuenta así y la app muestra *File deleted (in the
Drive trash)* con la misma regla que `project_sizes`: subido hasta `drive_trash_requested_at`); los subidos
después van a una carpeta nueva y son como cualquier otro.

Las marcas por archivo (`purged_at`, `drive_trashed_at`, el "definitivo" de hoy) se ponen **solo** cuando ya no
hay vuelta: *Delete forever* (entrega 3), o volver a mandar la carpeta de un proyecto que se había restaurado sin
ella (la marca vieja se cierra archivo por archivo antes de empezar el pedido nuevo: la carpeta nueva es otra).
Restaurar sin la carpeta **no** marca archivos: pone `drive_missing_at`, que se deshace si la carpeta aparece
(sección 3.4).

### 3.4 Los pasos

**Borrar con la casilla:** (1) `delete_project` (la base), (2) portero `POST /project/trash` (sección 3.8). Si el
paso 2 falla (Drive sin conectar, sin red), el proyecto queda borrado con sus archivos en el Drive, y la lista de
borrados ofrece *Send files to the Drive trash* para terminarlo. Nunca al revés: la carpeta no va a la papelera
de Drive de un proyecto que no está borrado (la base lo exige: `project_not_deleted`).

**Restaurar:** si el proyecto tiene la carpeta pedida o en la papelera de Drive (`trashed_projects` lo dice),
primero portero `POST /project/untrash` y después `restore_project`. La base exige ese orden
(`drive_untrash_first`). Si la app se cierra entre los dos, el proyecto sigue borrado con la carpeta ya fuera de
la papelera: consistente, y *Restore* de nuevo termina.

**Si Drive ya no tiene la carpeta:** *Restore without its files* se ofrece **solo** cuando el portero, con Drive
conectado **a la misma cuenta de Google con la que se mandó** (la guarda en su registro, sección 3.8), responde
`drive: 'missing'` (sin tocar la base). La app pregunta antes ("Google Drive ya no tiene la carpeta de este
proyecto: Google la borró para siempre o alguien la sacó de la papelera y la borró. ¿Restaurar las páginas y el
texto sin sus archivos?") y recién con un sí llama a `restore_project(project, p_without_drive => true)`: el
proyecto vuelve con la marca `drive_missing_at` y **ningún archivo se marca**. Si después la carpeta aparece
(alguien la recupera a mano de la papelera de Drive), *Look for its files again* en el proyecto llama a
`/project/untrash`, que la trae y borra la marca: todo vuelve a como estaba.

**Volver a tildar la casilla** en un proyecto restaurado sin la carpeta (con `drive_missing_at`) y borrado de nuevo
cierra la marca vieja archivo por archivo (sección 3.3): los archivos que no se encontraron la otra vez dejan de
poder recuperarse desde la app. La ventana lo dice antes de confirmar ("Los archivos que no se encontraron la vez
anterior dejan de poder recuperarse desde la app; se recuperan solo a mano desde Google Drive, si siguen ahí").

**Con Drive sin conectar, conectado a otra cuenta, el portero caído o sin red** no se ofrece restaurar sin los
archivos: la lista dice qué pasa (*Google Drive is not connected: the workspace owner has to connect it*, *Google
Drive is connected to another account*, *Could not reach the file server*) y la única acción es esperar o
reconectar. La conexión con Drive de Wanka vence cada 7 días (pantalla de consentimiento en modo Testing): sin
esta regla, un vencimiento de rutina terminaba en archivos perdidos para la app.

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
  `in_trashed_page` e `in_deleted_project`: queda fuera de *Empty*, de la purga automática **y del envío de a
  uno** (`purge_file` da `file_in_deleted_project`), y sale solo al restaurar P (está en la prueba SQL). La
  pestaña no lo muestra con el título vacío (*Untitled*) sino con un texto propio, *Used by a page of a deleted
  project*, sin el botón de mandarlo a Drive. La ventana de borrar P lo cuenta
  (`project_delete_info.foreign_only_here`).

### 3.6 La migración de la entrega 2

`supabase/migrations/20261005120000_proyectos_drive.sql` (`schema_version` 10; probada en rollback encima de la 9,
sección 9.3; sin aplicar). Cambia respecto del borrador: `trashed_projects` y `project_sizes` escritas enteras,
`restore_project` con su permiso después del `drop`, `project_drive_untrashed` que no toca nada si no había
marca, y `project_files_purged` que bloquea los archivos en orden de id.

```sql
-- LGA Shot Docs · la carpeta de un proyecto borrado en la papelera de Drive (P.14, entrega 2;
-- Docs/Doc_Proyectos_Borrar.md, sección 3).
--
-- Con la casilla de la ventana de borrar, la carpeta del proyecto en el Drive del dueño (`LGA_ShotDocs/<Proyecto>`,
-- la que lleva la marca `sdProject`) va entera a la papelera de Drive. Lo hace el portero con la sesión de la
-- persona (`POST /project/trash`); la base decide si puede y guarda el estado en el proyecto, no en cada archivo:
--   drive_trash_requested_at/_by  alguien pidió mandar la carpeta (el proyecto tiene que estar borrado).
--   drive_trashed_at              el portero confirmó que la mandó (o que Drive no la tenía).
--   drive_missing_at/_by          se restauró sin la carpeta: el portero, con Drive conectado a la misma cuenta, no
--                                 la encontró. Es reversible: si la carpeta aparece, `/project/untrash` la trae
--                                 y borra todas las marcas.
-- Mientras haya marca, los archivos subidos del proyecto hasta `drive_trash_requested_at` se tratan como "en la
-- papelera de Drive" (peso, app); los subidos después (a una carpeta nueva) no. Ningún archivo se marca uno por
-- uno salvo cuando ya no hay vuelta: borrar para siempre (entrega 3), o volver a mandar la carpeta de un proyecto
-- que tenía la marca de "sin la carpeta" (la marca vieja se cierra antes de abrir la nueva).
--
-- Quién: dueño o admin del workspace que maneja el proyecto (`private.can_purge_project`), como mandar archivos a
-- la papelera de Drive. Nada se borra: ni filas ni archivos de Drive (la papelera de Drive los guarda 30 días).
--
-- Compatible con la app de la entrega 1: `restore_project(p)` sigue andando igual (el segundo parámetro tiene
-- valor por defecto) y solo falla con `drive_untrash_first` si alguien mandó la carpeta con una app nueva.
-- `trashed_projects` suma columnas al final.

alter table public.workspaces
  add column drive_trash_requested_at timestamptz,
  add column drive_trash_requested_by uuid references auth.users (id) on delete set null,
  add column drive_trashed_at         timestamptz,
  add column drive_missing_at         timestamptz,
  add column drive_missing_by         uuid references auth.users (id) on delete set null,
  add constraint workspaces_drive_requested    check (drive_trash_requested_at is null or deleted_at is not null
                                                      or drive_missing_at is not null),
  add constraint workspaces_drive_requested_by check (drive_trash_requested_by is null or drive_trash_requested_at is not null),
  add constraint workspaces_drive_trashed      check (drive_trashed_at is null or drive_trash_requested_at is not null),
  add constraint workspaces_drive_missing      check (drive_missing_at is null or drive_trash_requested_at is not null),
  add constraint workspaces_drive_missing_by   check (drive_missing_by is null or drive_missing_at is not null);

-- ---------------------------------------------------------------------------------------------------
-- Quién manda o trae la carpeta
-- ---------------------------------------------------------------------------------------------------
create function private.can_purge_project(ws uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.workspace_role() in ('owner', 'admin'), false) and private.can_manage_project(ws);
$$;

-- Solo la llaman funciones `security definer`.
revoke all on function private.can_purge_project(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Para el portero
-- ---------------------------------------------------------------------------------------------------
-- El proyecto y su estado de Drive, si la sesión puede mandar o traer su carpeta; null si no (no dice si existe).
create function public.media_project(p_project uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  r json;
begin
  if p_project is null or not private.can_purge_project(p_project) then
    return null;
  end if;
  select json_build_object('id', w.id, 'name', w.name, 'deleted_at', w.deleted_at,
                           'drive_trash_requested_at', w.drive_trash_requested_at,
                           'drive_trashed_at', w.drive_trashed_at,
                           'drive_missing_at', w.drive_missing_at)
  into r from public.workspaces w where w.id = p_project;
  return r;
end;
$$;

-- Sin vuelta: cada archivo subido del proyecto hasta el pedido queda como mandado a la papelera de Drive (las
-- marcas de hoy, archivo por archivo) y el proyecto deja de tener las suyas. Lo usan borrar para siempre y volver a
-- mandar la carpeta de un proyecto que tenía la marca de "sin la carpeta". En orden de id, como
-- `refresh_project_files`. No llama a nadie de afuera.
create function private.project_files_purged(p_project uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.drive_trash_requested_at, pr.drive_trash_requested_by, pr.drive_trashed_at, pr.drive_missing_at into w
  from public.workspaces pr where pr.id = p_project;
  if w.drive_trash_requested_at is null then
    return;
  end if;
  perform 1 from public.files f
  where f.project_id = p_project and f.drive_id is not null
    and coalesce(f.uploaded_at, '-infinity') <= w.drive_trash_requested_at
  order by f.id for update;
  update public.files f
  set trashed_at       = coalesce(f.trashed_at, w.drive_trash_requested_at),
      purged_at        = coalesce(f.purged_at, w.drive_trash_requested_at),
      purged_by        = case when f.purged_at is null then w.drive_trash_requested_by else f.purged_by end,
      drive_trashed_at = coalesce(f.drive_trashed_at, w.drive_trashed_at, w.drive_missing_at, w.drive_trash_requested_at)
  where f.project_id = p_project and f.drive_id is not null
    and coalesce(f.uploaded_at, '-infinity') <= w.drive_trash_requested_at;
  update public.workspaces
  set drive_trash_requested_at = null, drive_trash_requested_by = null, drive_trashed_at = null,
      drive_missing_at = null, drive_missing_by = null
  where id = p_project;
end;
$$;

-- Pide mandar la carpeta (antes de tocar Drive). Solo con el proyecto borrado. Repetirlo no cambia nada. Si el
-- proyecto tenía la marca de "sin la carpeta" (se restauró sin ella y se volvió a borrar), esa marca se cierra
-- archivo por archivo y empieza un pedido nuevo: la carpeta nueva es otra.
create function public.request_project_drive_trash(p_project uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.deleted_at, pr.drive_trash_requested_at, pr.drive_missing_at into w
  from public.workspaces pr where pr.id = p_project for update;
  if not found or not private.can_purge_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'Only an owner or admin of the workspace who manages the project sends its folder to the Google Drive trash.';
  end if;
  if w.deleted_at is null then
    raise exception 'project_not_deleted' using errcode = 'P0001';
  end if;
  if w.drive_missing_at is not null then
    perform private.project_files_purged(p_project);
    w.drive_trash_requested_at := null;
  end if;
  if w.drive_trash_requested_at is null then
    update public.workspaces set drive_trash_requested_at = now(), drive_trash_requested_by = auth.uid()
    where id = p_project;
  end if;
end;
$$;

-- La confirma el portero después de mandar la carpeta (o de ver que Drive no la tiene). Repetirla no cambia nada.
create function public.project_drive_trashed(p_project uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.drive_trash_requested_at, pr.drive_trashed_at, pr.drive_missing_at into w
  from public.workspaces pr where pr.id = p_project for update;
  if not found or not private.can_purge_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if w.drive_trash_requested_at is null or w.drive_missing_at is not null then
    raise exception 'project_drive_not_requested' using errcode = 'P0001';
  end if;
  if w.drive_trashed_at is null then
    update public.workspaces set drive_trashed_at = now() where id = p_project;
  end if;
end;
$$;

-- La carpeta salió de la papelera de Drive, o apareció (Drive reconectado a la cuenta de antes): el proyecto
-- vuelve a tener sus archivos. La llama el portero después de traerla, con el proyecto borrado o ya restaurado
-- sin ella. Borra las marcas de Drive del proyecto; si no había, no hace nada.
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
  set drive_trash_requested_at = null, drive_trash_requested_by = null, drive_trashed_at = null,
      drive_missing_at = null, drive_missing_by = null
  where id = p_project and drive_trash_requested_at is not null;
end;
$$;

revoke all on function private.project_files_purged(uuid) from public, anon, authenticated;
revoke all on function public.media_project(uuid) from public, anon;
revoke all on function public.request_project_drive_trash(uuid) from public, anon;
revoke all on function public.project_drive_trashed(uuid) from public, anon;
revoke all on function public.project_drive_untrashed(uuid) from public, anon;
grant execute on function public.media_project(uuid) to authenticated;
grant execute on function public.request_project_drive_trash(uuid) to authenticated;
grant execute on function public.project_drive_trashed(uuid) to authenticated;
grant execute on function public.project_drive_untrashed(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Restaurar: con la carpeta pedida para la papelera de Drive, primero traerla
-- ---------------------------------------------------------------------------------------------------
-- `drive_untrash_first` (P0001) si la carpeta está pedida o en la papelera de Drive, salvo `p_without_drive`, que la
-- app usa solo cuando el portero, con Drive conectado a la misma cuenta, respondió que la carpeta no está
-- (`drive: 'missing'`). Entonces el proyecto vuelve con la marca `drive_missing_at` (reversible: ningún archivo se
-- marca) y el texto vuelve. Lo demás, como en la entrega 1.
drop function public.restore_project(uuid);
create function public.restore_project(p_project uuid, p_without_drive boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.owner_id, pr.deleted_at, pr.drive_trash_requested_at, pr.drive_missing_at into w
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
  if w.drive_trash_requested_at is not null and w.drive_missing_at is null then
    if not coalesce(p_without_drive, false) then
      raise exception 'drive_untrash_first' using errcode = 'P0001',
        hint = 'Bring the project folder back from the Google Drive trash first, or restore it without its files.';
    end if;
    update public.workspaces set drive_missing_at = now(), drive_missing_by = auth.uid() where id = p_project;
  end if;
  update public.workspaces set deleted_at = null, deleted_by = null where id = p_project;
  perform private.refresh_project_files(p_project);
end;
$$;

revoke all on function public.restore_project(uuid, boolean) from public, anon;
grant execute on function public.restore_project(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- La papelera de proyectos: el estado de Drive
-- ---------------------------------------------------------------------------------------------------
-- Como en la entrega 1, más: `drive_trash_requested_at`, `drive_trashed_at` y `drive_missing_at` (solo a quien lo
-- maneja) y `can_purge` (si la sesión puede mandar o traer la carpeta). Cambia lo que devuelve: drop y create.
drop function public.trashed_projects();
create function public.trashed_projects()
returns table (id uuid, name text, archived_at timestamptz, deleted_at timestamptz, deleted_by uuid,
               deleted_by_email text, days_left int, can_restore boolean, pages int, files int,
               drive_trash_requested_at timestamptz, drive_trashed_at timestamptz, drive_missing_at timestamptz,
               can_purge boolean)
language sql stable security definer set search_path = ''
as $$
  select w.id, w.name, w.archived_at, w.deleted_at,
         case when m.can or m.staff then w.deleted_by end,
         case when m.can or m.staff then u.email::text end,
         greatest(0, ceil(extract(epoch from (w.deleted_at + interval '30 days' - now())) / 86400))::int,
         m.can,
         case when m.can then (n.j ->> 'pages')::int end,
         case when m.can then (n.j ->> 'files')::int end,
         case when m.can then w.drive_trash_requested_at end,
         case when m.can then w.drive_trashed_at end,
         case when m.can then w.drive_missing_at end,
         m.can and private.can_purge_project(w.id)
  from public.workspaces w
  cross join lateral (
    select private.can_manage_project(w.id) as can,
           coalesce(private.workspace_role() in ('owner', 'admin'), false) as staff
  ) m
  cross join lateral (select case when m.can then private.project_numbers(w.id) end as j) n
  left join auth.users u on u.id = w.deleted_by
  where w.deleted_at is not null
    and private.could_view_project(w.id, w.owner_id)
  order by w.deleted_at desc, w.id;
$$;

revoke all on function public.trashed_projects() from public, anon;
grant execute on function public.trashed_projects() to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- project_sizes: los archivos de una carpeta en la papelera de Drive o que no está
-- ---------------------------------------------------------------------------------------------------
-- Como en la entrega 1, con un estado más mirado justo después de la marca por archivo: un archivo subido hasta el
-- pedido (`uploaded_at <= drive_trash_requested_at`) de un proyecto con la carpeta confirmada en la papelera de
-- Drive está "en la papelera de Drive" durante 30 días desde la confirmación (después Google ya lo borró y no
-- cuenta); con la marca de "sin la carpeta" no cuenta (no está en este Drive). Uno pedido sin confirmar sigue
-- contando como antes (puede que siga en Drive). Los subidos después del pedido van a otra carpeta: como siempre.
create or replace function public.project_sizes()
returns table (project_id uuid,
               drive_bytes bigint, drive_files int,
               trash_bytes bigint, trash_files int,
               drive_trash_bytes bigint, drive_trash_files int,
               pending_bytes bigint, pending_files int)
language sql stable security definer set search_path = ''
as $$
  with gate as materialized (
    select w.id, w.drive_trash_requested_at as requested_at, w.drive_trashed_at as folder_trashed_at,
           w.drive_missing_at as folder_missing_at,
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
             when f.drive_id is not null
                  and (g.folder_trashed_at is not null or g.folder_missing_at is not null)
                  and coalesce(f.uploaded_at, '-infinity') <= g.requested_at then
               case when g.folder_missing_at is null
                         and greatest(g.folder_trashed_at, f.uploaded_at) > now() - interval '30 days'
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

update public.workspace_settings set schema_version = 10 where id and schema_version < 10;

notify pgrst, 'reload schema';
```

Notas para la auditoría:

- `restore_project` cambia de firma (suma `p_without_drive` con valor por defecto): `drop` y `create`, y los
  permisos se vuelven a dar. La app de la entrega 1 llama `restore_project` con `{ p_project }` y sigue andando.
- `trashed_projects` cambia lo que devuelve (columnas nuevas al final): `drop` y `create`. La app de la entrega 1
  lee las columnas por nombre: las nuevas no le molestan.
- `project_sizes` conserva su firma. Un archivo subido hasta el pedido, de una carpeta confirmada en la papelera
  de Drive, cuenta en `drive_trash` 30 días desde la confirmación y después en nada (Google ya lo borró); con la
  marca de "sin la carpeta", en nada; mientras solo está pedida, como antes (puede que siga en Drive).
- Nada escribe en `files` salvo `project_files_purged`, que solo corre cuando ya no hay vuelta (*Delete forever*,
  o volver a mandar la carpeta de un proyecto restaurado sin ella), y solo sobre lo subido hasta el pedido.
- `project_drive_untrashed` sirve también con el proyecto ya restaurado sin la carpeta: es lo que hace reversible
  esa marca.
- `can_purge_project` no se puede llamar desde la API (solo la usan funciones `security definer`).

### 3.7 La prueba SQL de la entrega 2

`supabase/tests/proyectos_drive_permisos.sql`. En el archivo final lleva la preparación de la 1.4 (personas, P,
O, M, archivos); acá sigue a las pruebas de la entrega 1 con los mismos datos, que es como se corrió (sección
9.3): quién puede mandar y traer la carpeta (el creador miembro no, aunque borre y restaure su proyecto), que solo
con el proyecto borrado, los pasos del portero en orden, el peso pedido y confirmado, que restaurar pide traerla
primero, la huella igual después de traerla, restaurar sin la carpeta (una marca del proyecto, ningún archivo
marcado, y la huella igual cuando la carpeta aparece), volver a mandar la carpeta de un proyecto restaurado sin
ella con un archivo nuevo (la marca vieja se cierra solo en lo subido antes), ninguna fila borrada y sin sesión
nada.

```sql
-- Pruebas de la entrega 2 (la carpeta del proyecto en la papelera de Drive). Siguen a las de la entrega 1, con
-- las mismas personas y datos (P activo, sin archivar; f1, f2 y f4 subidos, f5 sin subir).

-- ---------------------------------------------------------------------------------------------------
-- J1. Quién puede, y solo con el proyecto borrado
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
begin
  assert (public.media_project('00000000-0000-4000-8000-0000000d1001') ->> 'deleted_at') is null,
    'media_project: P activo no da su fila a la dueña';
  perform pg_temp.expect_error($q$select public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_not_deleted', 'manda a Drive la carpeta de un proyecto activo');
end;
$$;

select set_config('role', 'postgres', true);
select set_config('borrar.antes10', pg_temp.fingerprint(), true);
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
select public.delete_project('00000000-0000-4000-8000-0000000d1001');

-- Un miembro con editar y crear (no lo maneja), la admin con ver, la invitada y la admin sin permiso: nada.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$
begin
  assert public.media_project('00000000-0000-4000-8000-0000000d1001') is null, 'media_project da P a un miembro';
  perform pg_temp.expect_error($q$select public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'un miembro manda la carpeta de P');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0003');
do $$
begin
  assert public.media_project('00000000-0000-4000-8000-0000000d1001') is null, 'media_project da P a la admin con ver';
  perform pg_temp.expect_error($q$select public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'la admin con ver manda la carpeta de P');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0006');
do $$
begin
  assert public.media_project('00000000-0000-4000-8000-0000000d1001') is null, 'media_project da P a la invitada';
  perform pg_temp.expect_error($q$select public.project_drive_untrashed('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'la invitada trae la carpeta de P');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0007');
do $$
begin
  assert public.media_project('00000000-0000-4000-8000-0000000d1001') is null, 'media_project da P a la admin sin permiso';
end;
$$;

-- El creador de un proyecto que no es dueño ni admin lo borra y lo restaura, pero no manda su carpeta.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0005');
do $$
begin
  perform public.delete_project('00000000-0000-4000-8000-0000000d1003');
  assert public.media_project('00000000-0000-4000-8000-0000000d1003') is null, 'media_project da M a su creador miembro';
  perform pg_temp.expect_error($q$select public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1003')$q$,
    'not_allowed', 'el creador miembro manda la carpeta de M');
  assert (select not t.can_purge from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1003'),
    'trashed_projects: el creador miembro puede mandar la carpeta de M';
  perform public.restore_project('00000000-0000-4000-8000-0000000d1003');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- J2. La dueña manda la carpeta (los pasos del portero), y restaurar pide traerla primero
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
declare
  r record;
  first_at timestamptz;
begin
  perform pg_temp.expect_error($q$select public.project_drive_trashed('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_drive_not_requested', 'confirma una carpeta que nadie pidió');
  perform public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1001');
  first_at := (public.media_project('00000000-0000-4000-8000-0000000d1001') ->> 'drive_trash_requested_at')::timestamptz;
  assert first_at is not null, 'media_project no muestra el pedido';
  perform public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1001');
  -- Pedida y sin confirmar: el peso sigue como con el proyecto borrado (puede que siga en Drive).
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') = '321000/3 4021000/3 0/0 0/0',
    format('peso de P con la carpeta pedida: %s', pg_temp.size_of('00000000-0000-4000-8000-0000000d1001'));
  perform public.project_drive_trashed('00000000-0000-4000-8000-0000000d1001');
  perform public.project_drive_trashed('00000000-0000-4000-8000-0000000d1001');
  -- Confirmada: lo subido (f1, f2, f4) está en la papelera de Drive; f5 (sin subir) sigue en la de la app.
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') = '0/0 4000000/1 321000/3 0/0',
    format('peso de P con la carpeta en la papelera de Drive: %s', pg_temp.size_of('00000000-0000-4000-8000-0000000d1001'));
  select * into r from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1001';
  assert found and r.can_purge and r.drive_trashed_at is not null and r.drive_trash_requested_at = first_at,
    format('trashed_projects de la dueña con la carpeta: %s', r);
  perform pg_temp.expect_error($q$select public.restore_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'drive_untrash_first', 'restaura sin traer la carpeta');
  -- Ningún archivo cambió: la marca es del proyecto.
  assert not exists (select 1 from public.files f where f.id::text like '00000000-0000-4000-8000-0000000d3%'
                     and (f.purged_at is not null or f.drive_trashed_at is not null)),
    'mandar la carpeta marcó archivos';
end;
$$;
-- Quien no maneja P no ve el estado de Drive.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$
begin
  assert (select t.drive_trashed_at is null and not t.can_purge from public.trashed_projects() t
          where t.id = '00000000-0000-4000-8000-0000000d1001'), 'el miembro ve el estado de Drive de P';
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') is null, 'el miembro ve el peso de P';
end;
$$;
-- La admin que maneja P (no la que lo mandó) lo trae y lo restaura: todo exactamente como estaba.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
select public.project_drive_untrashed('00000000-0000-4000-8000-0000000d1001');
select public.project_drive_untrashed('00000000-0000-4000-8000-0000000d1001');
select public.restore_project('00000000-0000-4000-8000-0000000d1001');
select set_config('role', 'postgres', true);
do $$
begin
  assert pg_temp.fingerprint() = current_setting('borrar.antes10'), 'traer la carpeta y restaurar no dejó todo como estaba';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- J3. Restaurar sin la carpeta (el portero, con Drive conectado a la misma cuenta, no la encontró): una marca del
--     proyecto, reversible, y ningún archivo marcado
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
select public.delete_project('00000000-0000-4000-8000-0000000d1001');
select public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1001');
select public.project_drive_trashed('00000000-0000-4000-8000-0000000d1001');
select public.restore_project('00000000-0000-4000-8000-0000000d1001', true);
do $$
begin
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1001') = 1, 'restaurado sin la carpeta, la dueña no ve P';
  assert (select w.drive_missing_at is not null and w.drive_missing_by = '00000000-0000-4000-8000-0000000d0001'
                 and w.drive_trash_requested_at is not null and w.drive_trashed_at is not null
          from public.workspaces w where w.id = '00000000-0000-4000-8000-0000000d1001'),
    'no quedó la marca de "sin la carpeta" en P';
  -- Ningún archivo cambió: la marca es del proyecto.
  assert not exists (select 1 from public.files f where f.id::text like '00000000-0000-4000-8000-0000000d3%'
                     and (f.purged_at is not null or f.drive_trashed_at is not null)),
    'restaurar sin la carpeta marcó archivos';
  -- Lo subido hasta el pedido (f1, f2, f4) no está en este Drive: no cuenta; f5 vuelve a estar en uso y sin subir.
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') = '0/0 0/0 0/0 4000000/1',
    format('peso de P restaurado sin la carpeta: %s', pg_temp.size_of('00000000-0000-4000-8000-0000000d1001'));
  -- No se puede confirmar una carpeta que no está.
  perform pg_temp.expect_error($q$select public.project_drive_trashed('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_drive_not_requested', 'confirma la carpeta de un proyecto restaurado sin ella');
end;
$$;
-- La carpeta aparece (Drive reconectado a la cuenta de antes): el portero la trae y todo vuelve a como estaba.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
select public.project_drive_untrashed('00000000-0000-4000-8000-0000000d1001');
select set_config('role', 'postgres', true);
do $$
begin
  assert pg_temp.fingerprint() = current_setting('borrar.antes10'), 'traer la carpeta después de restaurar sin ella no dejó todo como estaba';
end;
$$;

-- J3b. Restaurado sin la carpeta, con un archivo nuevo (a la carpeta nueva), se vuelve a borrar y a mandar la
--      carpeta: la marca vieja se cierra archivo por archivo (f1, f2, f4) y el archivo nuevo (f6) queda con la
--      carpeta nueva
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
select public.delete_project('00000000-0000-4000-8000-0000000d1001');
select public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1001');
select public.project_drive_trashed('00000000-0000-4000-8000-0000000d1001');
select public.restore_project('00000000-0000-4000-8000-0000000d1001', true);
select set_config('role', 'postgres', true);
insert into public.files (id, project_id, name, mime, size, drive_id, uploaded_at, created_by) values
  ('00000000-0000-4000-8000-0000000d3006', '00000000-0000-4000-8000-0000000d1001', 'f6.jpg', 'image/jpeg', 7000,
   'drive_f6_xxxxxxxx', now() + interval '1 hour', '00000000-0000-4000-8000-0000000d0001');
insert into public.page_files (page_id, file_id, is_foreign) values
  ('00000000-0000-4000-8000-0000000d2001', '00000000-0000-4000-8000-0000000d3006', false);
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
begin
  -- f6 (subido después, a otra carpeta) cuenta como siempre.
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') = '7000/1 0/0 0/0 4000000/1',
    format('peso de P con f6: %s', pg_temp.size_of('00000000-0000-4000-8000-0000000d1001'));
  perform public.delete_project('00000000-0000-4000-8000-0000000d1001');
  -- Borrado otra vez con la marca vieja, se vuelve a mandar la carpeta.
  perform public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1001');
end;
$$;
-- Lo que quedó (como dueño de la base: con P borrado la dueña no ve sus filas).
select set_config('role', 'postgres', true);
do $$
begin
  assert (select w.drive_missing_at is null and w.drive_trash_requested_at is not null and w.drive_trashed_at is null
          from public.workspaces w where w.id = '00000000-0000-4000-8000-0000000d1001'),
    'el pedido nuevo no reemplazó a la marca vieja';
  assert (select count(*) from public.files f where f.project_id = '00000000-0000-4000-8000-0000000d1001'
          and f.purged_at is not null and f.drive_trashed_at is not null) = 3,
    'la marca vieja no se cerró en f1, f2 y f4';
  assert (select f.purged_at is null and f.drive_trashed_at is null from public.files f
          where f.id = '00000000-0000-4000-8000-0000000d3006'), 'la marca vieja alcanzó a f6';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
begin
  perform public.project_drive_untrashed('00000000-0000-4000-8000-0000000d1001');
  perform public.restore_project('00000000-0000-4000-8000-0000000d1001');
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') = '7000/1 0/0 321000/3 4000000/1',
    format('peso de P al final: %s', pg_temp.size_of('00000000-0000-4000-8000-0000000d1001'));
end;
$$;
select set_config('role', 'postgres', true);
do $$
begin
  -- Ninguna fila se borró.
  assert (select count(*) from public.pages where workspace_id = '00000000-0000-4000-8000-0000000d1001') = 3,
    'se borraron páginas';
  assert (select count(*) from public.page_files where file_id::text like '00000000-0000-4000-8000-0000000d3%') = 7,
    'se borraron usos';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- J4. Sin sesión, nada; y cómo quedaron las funciones
-- ---------------------------------------------------------------------------------------------------
select set_config('role', 'anon', true);
select set_config('request.jwt.claims', '', true);
do $$
begin
  perform pg_temp.expect_error($q$select public.media_project('00000000-0000-4000-8000-0000000d1001')$q$, '42501', 'anon: media_project');
  perform pg_temp.expect_error($q$select public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1001')$q$, '42501', 'anon: pide');
  perform pg_temp.expect_error($q$select public.project_drive_trashed('00000000-0000-4000-8000-0000000d1001')$q$, '42501', 'anon: confirma');
  perform pg_temp.expect_error($q$select public.project_drive_untrashed('00000000-0000-4000-8000-0000000d1001')$q$, '42501', 'anon: trae');
  perform pg_temp.expect_error($q$select public.restore_project('00000000-0000-4000-8000-0000000d1001', true)$q$, '42501', 'anon: restaura');
end;
$$;
select set_config('role', 'postgres', true);
do $$
declare
  fn text;
begin
  foreach fn in array array['public.media_project(uuid)', 'public.request_project_drive_trash(uuid)',
                            'public.project_drive_trashed(uuid)', 'public.project_drive_untrashed(uuid)',
                            'public.restore_project(uuid,boolean)', 'public.trashed_projects()',
                            'private.can_purge_project(uuid)', 'private.project_files_purged(uuid)'] loop
    assert (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
            where p.oid = fn::regprocedure), format('%s no es security definer con search_path vacío', fn);
  end loop;
  assert not has_function_privilege('authenticated', 'private.project_files_purged(uuid)', 'execute'),
    'authenticated marca los archivos de un proyecto';
  assert not has_function_privilege('authenticated', 'private.can_purge_project(uuid)', 'execute'),
    'authenticated llama a can_purge_project';
  assert to_regprocedure('public.restore_project(uuid)') is null, 'quedó la firma vieja de restore_project';
  assert (select schema_version from public.workspace_settings where id) >= 10, 'la versión de la base no es 10';
end;
$$;
```

### 3.8 El portero: dos rutas nuevas

Las dos van con la sesión de la persona, como `/trash`, antes de la línea que deja pasar solo al dueño
(`core.ts:340`): la base decide con `media_project`. No cambian ninguna ruta existente, así que el portero nuevo
anda con la app de la entrega 1. Los errores llevan `code` fijo, como `/trash` (`Doc_Portero.md`): `bad_request`,
`not_found`, `project_not_deleted`, `nothing_to_untrash`, `drive_not_connected`, `drive_other_account`,
`drive_mismatch`, `drive_failed`, `db_error`, `db_outdated`, `session_expired`.

**Cuáles son las carpetas del proyecto.** La que el portero recuerda (`project:<id>`, `core.ts:683`) y, además,
las que Drive encuentra con su marca: `q = mimeType = 'application/vnd.google-apps.folder' and appProperties has
{ key = 'sdProject' and value = '<id>' }` (con el permiso `drive.file` Drive solo devuelve lo que creó la app). La
búsqueda cubre dos casos: que el portero haya perdido su registro, y que haya **dos** carpetas con la misma marca
porque el portero recreó una (abajo). Cada carpeta se toca solo si su `appProperties.sdProject` es el proyecto;
si la recordada no lo lleva, `403 drive_mismatch` y no se toca nada.

**El registro `projectTrash:<id>`** (en el Durable Object del portero): `{ email, requestedAt, folders: [ids] }`.
`email` es la cuenta de Google conectada al mandar; `folders`, todas las carpetas que el portero **intentó**
mandar. Se escribe **antes** de cada `PATCH` (la intención, no el resultado) y se **acumula**: cada intento suma
sus ids a los que ya estaban, nunca los reemplaza. Así, aunque Drive cumpla un `PATCH` y la respuesta se pierda
(corte de red, tope de tiempo del Worker), la carpeta queda anotada.

**`POST /project/trash { project }`:**

1. `media_project(project)`: nulo, `404 not_found` (no dice si existe); `deleted_at` nulo, `409
   project_not_deleted`; `drive_trashed_at` puesto, responde `done` sin ir a Drive (repetirlo no hace nada).
2. `driveReady()`: si no, `503 drive_not_connected` sin pedir nada a la base. Si el registro existe y su
   `email` no es la cuenta conectada ahora: `409 drive_other_account`, sin tocar nada.
3. `request_project_drive_trash(project)` (la base marca el pedido; con `drive_trash_requested_at` como fecha de
   corte).
4. Las carpetas del proyecto (arriba): las que **no** están en la papelera se mandan; las que ya están en la
   papelera con `trashedTime` ≥ `drive_trash_requested_at` menos unos minutos (5: el reloj de Google y el de la
   base pueden no coincidir; el registro las cubre igual) cuentan como **ya mandadas** (un intento anterior cuya
   respuesta se perdió). Para cada una por mandar: sumarla al registro, `PATCH { trashed: true }`.
5. `project_drive_trashed(project)`. Responde `{ status: 'done', project, drive: 'trashed' | 'missing' | 'none',
   folders }`: `trashed` si mandó o encontró ya mandada alguna; `none` si el proyecto nunca tuvo carpeta (no hay
   registro `project:<id>` ni la búsqueda encuentra nada); `missing` si la recordada da 404 y la búsqueda no
   encuentra otra. Si Drive falla en el medio: `502 drive_failed`; la base queda con el pedido sin confirmar, el
   registro con lo intentado, y repetir termina sin perder ninguna.

**`POST /project/untrash { project }`** (para restaurar, y para *Look for its files again* en un proyecto
restaurado sin la carpeta):

1. `media_project(project)`: nulo, `404`; sin `drive_trash_requested_at`, `409 nothing_to_untrash`.
2. `driveReady()`: si no, `503 drive_not_connected`. Si el registro existe y su `email` no es la cuenta conectada:
   `409 drive_other_account` (la app no ofrece restaurar sin los archivos: sección 3.4).
3. Las carpetas a traer: la **unión** de las del registro y las de la búsqueda por marca que están en la papelera
   con `trashedTime` ≥ `drive_trash_requested_at` menos el mismo margen de 5 minutos (así no trae una carpeta vieja que ya estaba en la papelera por
   otro motivo, y no depende de que el registro esté completo).
4. Cada una con la marca y en la papelera: `PATCH { trashed: false }`. Si alguna existe (en la papelera o no):
   `project_drive_untrashed(project)` y `drive: 'untrashed'`. Si no existe ninguna, con Drive conectado a la misma
   cuenta: `drive: 'missing'` **sin tocar la base** (la app pregunta, sección 3.4).

**El portero recrea la carpeta si está en la papelera** (`dayFolder`, `core.ts:679-703`: si la recordada está en
la papelera o no existe, crea otra con la marca). Cuándo puede pasar con un proyecto borrado:

| Caso | Qué pasa | Resultado |
|---|---|---|
| Subir un archivo nuevo a un proyecto borrado | `startUpload` pide nivel 3 sobre el archivo (`core.ts:780-781`) y `media_file` da nulo: `404`. Nunca llega a `dayFolder`. | No se crea nada. |
| Un pase nuevo (`/pass`) | `media_file` nulo: `404`. | Nada. Un pase ya dado sigue sirviendo hasta que vence (8 horas, `PASS_MS`), como hoy al dejar de compartir; con la carpeta en la papelera, depende de Drive (prueba técnica). |
| Una subida que ya estaba abierta cuando se borró | Las partes van a la sesión de Google sin volver a preguntar (`uploadChunk`); el archivo se crea en su carpeta del día. Si la carpeta ya está en la papelera, el archivo queda adentro (prueba técnica) y vuelve con ella. Al terminar, `set_file_drive` falla (nivel 0): el portero lo anota sin vincular y lo vincula en el próximo pedido de ese archivo, después de restaurar. | Nada se pierde. |
| Restaurar normal | La carpeta vuelve antes que el proyecto (la base lo exige): `dayFolder` la encuentra viva. | La misma carpeta. |
| Restaurar sin la carpeta, o después de que Google la borró | La próxima subida no encuentra viva la recordada y crea `LGA_ShotDocs/<Proyecto>` de nuevo, con la marca, y la recuerda. | Correcto: los archivos nuevos van a una carpeta viva. Quedan dos con la misma marca (la vieja en la papelera hasta que Google la vacíe); por eso `/project/untrash` trae solo las del registro y las mandadas desde el pedido (`trashedTime`), no una vieja. |

### 3.9 Prueba técnica antes de construir la entrega 2

Con un proyecto de prueba (tres archivos subidos), borrado desde la app de la entrega 1, en el Drive de Lega, con
una versión del portero con las dos rutas nuevas (solo actúan sobre proyectos borrados), antes de mostrar la
casilla en la app:

1. Que con el permiso `drive.file` la búsqueda por `appProperties` encuentre la carpeta del proyecto, y que el
   portero pueda mandarla a la papelera (`PATCH trashed`) y sacarla.
2. Que los archivos de adentro queden en la papelera (`trashed: true`, `explicitlyTrashed: false`) y vuelvan con
   la carpeta; y que uno mandado antes por su cuenta (`/trash`) **no** vuelva.
3. Que la carpeta en la papelera tenga `trashedTime` legible con `drive.file` (lo usan el reintento de
   `/project/trash` y `/project/untrash`).
4. **Una respuesta perdida:** cortar el portero (o simular el error) después de un `PATCH` que Drive cumplió; el
   reintento tiene que contarla como ya mandada y `/project/untrash` tiene que traerla. Lo mismo con dos carpetas
   y una falla en el medio.
5. **Otra cuenta:** con Drive reconectado a otra cuenta de Google, las dos rutas responden `drive_other_account`
   sin tocar nada.
6. Que un pase (`/m/<pase>`) de un archivo cuya carpeta está en la papelera siga sirviendo hasta que vence o deje
   de servir: cualquiera de las dos está bien, pero hay que saberlo.
7. Que una subida abierta antes de mandar la carpeta termine adentro de la carpeta en la papelera (y no en la
   raíz del Drive) y vuelva con ella.
8. Qué ve el dueño en su papelera de Drive (una carpeta con todo adentro) y que la fecha de borrado de Google
   cuente desde ese momento.
9. Que todos los archivos subidos del proyecto estén de verdad adentro de su carpeta (sus `parents`): uno que
   estuviera en otro lado no se iría con ella. No debería haber ninguno (los archivos se suben siempre a
   `LGA_ShotDocs/<Proyecto>/<día>`), pero se comprueba con el proyecto más grande antes de ofrecer la casilla.

## 4. Archivar

- **Qué es:** una marca (`archived_at`) que ve todo el equipo. Es orden, no candado: **no cambia permisos,
  contenido, archivos, comentarios ni el Drive**. Para los proyectos terminados.
- **Dónde deja de aparecer:** la lista principal del selector y la lista de proyectos del panel de Ctrl/⌘+K
  (`ProjectSearch.tsx`). La búsqueda de páginas ya es del proyecto abierto: adentro de un archivado, busca en
  él como siempre. Una búsqueda en todos los proyectos (pendiente en `Doc_Buscar.md`) lo dejaría afuera.
- **Dónde está:** *Archived projects (N)* al pie del selector, que cambia el selector a esa lista (con su
  propio filtro). Tocar uno lo abre; un ícono lo desarchiva.
- **Abierto, se edita** (decisión de Lega): con la marca *Archived* en el botón del selector ("12 pages ·
  Archived") y en el inicio del proyecto. Un candado de verdad (la base rechazando ediciones) dejaría rechazados
  los cambios sin subir de otros dispositivos al archivar.
- **Al archivar el proyecto abierto**, la app pasa al siguiente de la lista principal (sección 7.3).
- **Una versión vieja** lo sigue mostrando como un proyecto más: no hace daño.

## 5. Quién puede

| Acción | Quién | Dónde se aplica |
|---|---|---|
| Archivar y desarchivar | Quien maneja el proyecto: "Editar y crear páginas" sobre el proyecto entero **y** ser dueño o admin del workspace, o quien lo creó (miembro activo) | `private.can_manage_project` en `set_project_archived` |
| Borrar y restaurar | Igual | `delete_project`, `restore_project` |
| Casilla de Drive, mandar o traer la carpeta | Además, dueño o admin | `private.can_purge_project` en `media_project` y las tres funciones del portero (entrega 2) |
| *Delete forever* | Dueño o admin que maneja el proyecto, después de los 30 días | `purge_project` (entrega 3, sección 2.3) |
| Ver la papelera de proyectos | Quien veía el proyecto (su creador, permiso sobre el proyecto o sobre una página de adentro), con *Restore* solo para quien lo maneja. Quién lo borró: quien lo maneja, el dueño y los admins. Páginas, archivos, peso y estado de Drive: solo quien lo maneja | `trashed_projects` (`could_view_project`) |

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
  con una importación de Coda en curso hacia ese proyecto en este dispositivo. Una importación que corre en
  **otro** dispositivo no se ve desde acá: si se borra igual, lo que siga importando queda rechazado y guardado
  en ese dispositivo (no se pierde) y se sigue al restaurar (sección 8).
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
- Un caso confuso pero sin pérdida: si un dispositivo reenvía la creación de una página que **ya existía** en el
  servidor (se perdió el acuse) y el proyecto está borrado, la base responde `page_create_denied` y la app la
  muestra como "creación rechazada" aunque exista. Al restaurar, *Retry* la resuelve sin duplicar (la creación
  es `on conflict do nothing`).
- **Qué ve la persona (app nueva):** cuando un proyecto conocido deja de venir, la app pregunta una vez
  `trashed_projects()`. Si está ahí, avisa: "*ana@… mandó “MGTZD” a Proyectos borrados. Lo que tenías sin subir
  de ese proyecto quedó en este dispositivo.*" (con *Download my unsynced changes* si hay algo) y, si lo tenía
  abierto, pasa al siguiente proyecto. Si no está (le dejaron de compartir), el aviso de siempre. A quien la base
  no le dice quién lo borró (no lo maneja ni es dueño o admin), el aviso va sin el correo
  (`deletedList.goneNoticeNoEmail`).
- Un editor abierto en una página de ese proyecto: lo escrito ya está en el dispositivo (cada tecla se guarda
  en IndexedDB); la página pasa al aviso de arriba en vez de "Esta página no existe o no tenés acceso".

### 6.3 Las personas con quienes estaba compartido

- **Borrado:** desaparece de su lista. Lo ven en *Deleted projects* (sin *Restore*, salvo que lo manejen), con
  cuándo lo borraron (quién, solo si lo manejan o son dueño o admin). Si era el único proyecto que tenían, la app
  muestra la pantalla de "sin proyectos" que ya existe (`Workspace.tsx:430-488`), que vuelve a preguntar sola cada
  minuto. **Esa pantalla suma *Deleted projects*** cuando `trashed_projects()` trae alguno con `can_restore`: así
  quien se quedó sin proyectos (dos borrados a la vez, otro admin, otro dispositivo; la regla "el último activo no
  se borra" es de la interfaz y por persona) puede restaurar el suyo desde ahí. Sin ninguno restaurable, la
  pantalla es la de siempre.
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
- Qué toca en el código: `PageTree.workspaceId` es hoy `readonly` (`tree.ts:93`) y además de agregarse a la
  lista es el proyecto por defecto de `createPage` sin proyecto (`tree.ts:243`) y aquel al que cae
  `useCurrentProject` (`project.ts:69`). Pasa a cambiarse con un método (`replacePrimary`, que también escribe
  `meta.workspaceId`), y `useCurrentProject` cae al primero **activo** (no archivado) de la lista. El
  reemplazo no borra nada del dispositivo: las páginas del proyecto viejo siguen en la base local y vuelven si
  el proyecto vuelve.

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

### 6.6 Una base sin migrar (cada workspace es una isla)

Cada workspace tiene su propio Supabase, y la app publicada acepta bases desde `schema_version` 6
(`DB_SCHEMA_VERSION`, `src/workspace.ts:10`). `fetchProjects` (`src/sync/remote.ts:433-441`) está en el ciclo de
sincronización: si pidiera `archived_at` a una base sin la migración 9, el `42703` (columna inexistente) cortaría
**toda** la sincronización. Por eso:

- `fetchProjects` pide `archived_at` solo con `schema_version` ≥ 9 (y `drive_trash_requested_at`,
  `drive_trashed_at` y `drive_missing_at` solo con ≥ 10); además, ante un `42703` reintenta sin las columnas
  nuevas y lo recuerda un rato, como ya hace `fetchTreeOf` con `settings` (`PAGE_COLUMNS_WITHOUT_SETTINGS`,
  `remote.ts:417-423`). Con la base vieja, los íconos y las listas nuevas no aparecen y todo lo demás anda.
- Las funciones nuevas (`trashed_projects`, `project_delete_info`, …) se llaman solo con la versión que las
  tiene; un `PGRST202` (función inexistente) se trata como "la base todavía no lo tiene", sin aviso de error.
- Prueba unitaria con una base vieja (el `FakeServer` sin las columnas): la sincronización sigue y el selector no
  muestra los íconos.

### 6.7 Orden de publicación

1. La prueba técnica de Drive (sección 3.9), antes de construir: decide si las entregas 1 y 2 salen juntas
   (sección 9.2).
2. Probar las migraciones con sus pruebas en `begin; … rollback;` contra la base. Con la tanda auditada: copia
   de seguridad (repo `z_shotdocs_backup`, *Run workflow*, esperar el verde), `npm run db:migrate`, `npm run
   db:test`. Las migraciones son compatibles con la app publicada: mientras nadie borre nada, nada cambia.
3. El portero y la app **en el mismo push** a `main` (regla del plan; Cloudflare publica). El portero nuevo anda
   con la app vieja (las rutas son nuevas, no cambia ninguna).
4. Subir `min_app_version` a esa versión (SQL Editor), antes del primer borrado (decisión de Lega).
5. Entrega 3 (*Delete forever*, aprobada): la migración 11 igual que las otras y la app.

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
│ Deleted projects can be restored exactly as  │
│ they were. After 30 days too, until someone  │
│ deletes them forever. Their files stay in    │
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
  veían. A quien no lo maneja, el renglón muestra solo el nombre, cuándo se borró y los días que quedan (la base
  no le da quién lo borró, salvo al dueño y los admins, ni cuánto tenía: sección 1.2).
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
  confirma; Escape cancela. El foco arranca en el campo. El campo lleva `autocapitalize="off"`,
  `autocorrect="off"`, `autocomplete="off"` y `spellcheck={false}`: el iPhone no le pone mayúscula ni corrige
  "borrar".
- **La casilla** arranca destildada. Plan: sale con la entrega 1 si la prueba técnica de Drive pasa (sección 9.2);
  si la 1 tuviera que salir sola, en su lugar va una línea "Sus archivos quedan en Google Drive (1,2 GB)" y la
  casilla llega con la 2. Sin Drive conectado o sin ser dueño o admin, la casilla aparece apagada con el motivo.
- Los otros números de la ventana: los archivos de otros proyectos que solo usa este (`foreign_only_here`: "N
  archivos de otros proyectos se usan solo acá: quedan en la papelera de su proyecto mientras este esté
  borrado").
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
| `deletedList.hint` | Deleted projects can be restored exactly as they were. After 30 days too, until someone deletes them forever. Their files stay in Google Drive unless they were sent to its trash. | Los proyectos borrados se restauran tal como estaban. También después de los 30 días, mientras nadie los borre para siempre. Sus archivos siguen en Google Drive, salvo que se hayan mandado a su papelera. |
| `deleteProject.foreignOnlyHere` | {count} files from other projects are used only here: they stay in their project's trash while this one is deleted. (plural) | {count} archivos de otros proyectos se usan solo acá: quedan en la papelera de su proyecto mientras este esté borrado. |
| `fileTrash.inDeletedProject` | Used by a page of a deleted project. It comes back if that project is restored. | Lo usa una página de un proyecto borrado. Vuelve si restauran ese proyecto. |
| `deletedList.restoreWithoutFiles` | Restore without its files | Restaurar sin sus archivos |
| `deletedList.driveOtherAccount` | Google Drive is connected to another account: connect the one this project used to restore its files. | Google Drive está conectado a otra cuenta: conectá la que usaba este proyecto para restaurar sus archivos. |
| `project.lookForFiles` | Look for its files again | Buscar sus archivos de nuevo |
| `deletedList.by` | Deleted by {email} · {when} | Lo borró {email} · {when} |
| `deletedList.daysLeft` | {count} days left (plural) | Quedan {count} días |
| `deletedList.passed` | 30 days passed | Pasaron los 30 días |
| `deletedList.restore` | Restore | Restaurar |
| `deletedList.goneNotice` | {email} moved “{name}” to Deleted projects. | {email} mandó “{name}” a Proyectos borrados. |
| `deletedList.goneNoticeNoEmail` | “{name}” was moved to Deleted projects. | “{name}” se mandó a Proyectos borrados. |
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
  proyectos (restaurarlo y seguir la importación), y también **sin red** (cuando no se puede preguntar
  `trashed_projects`, el diario se conserva: solo se olvida si el servidor dice que el proyecto no existe ni está
  en la papelera).
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
  miran `ensure_workspace` y `project_sizes`). Lo mismo para las entregas 2 y 3 (secciones 3.7 y 2.3). Todo esto
  ya se corrió (sección 9.3); se vuelve a correr al implementar, con los archivos de prueba separados.
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
  borrado; repetir no hace nada de más. Y los tres casos de la auditoría (B2): un `PATCH` cumplido cuya respuesta
  se pierde (el reintento la cuenta como mandada y `/project/untrash` la trae); dos carpetas con una falla en el
  medio (el registro tiene las dos); el registro perdido (la búsqueda por marca y `trashedTime` la encuentra). Más
  Drive conectado a otra cuenta (`drive_other_account`, nada se toca) y `missing` solo con la misma cuenta.
- **A mano:** la prueba técnica de Drive (sección 3.9); borrar y restaurar en Wanka un proyecto de prueba con
  fotos y comentarios desde la computadora y ver el resultado en el iPhone.

### 9.2 Entregas

1. **Archivar, borrar y restaurar:** migración 9 y su prueba, la app (selector, ventana, listas, avisos, primer
   proyecto, pantalla sin proyectos, Ctrl/⌘+K, bases sin migrar), ayuda, docs y changelog. Lo más útil enseguida:
   limpiar importaciones de prueba y proyectos viejos sin perder nada.
2. **La casilla de Drive:** prueba técnica, migración 10, las dos rutas del portero (`Doc_Portero.md`), *Send files
   to the Drive trash* en la lista de borrados, restaurar trayendo la carpeta y *Look for its files again*.
3. ***Delete forever*** después de los 30 días (`purge_project`, dueño y admins), con su palabra (sección 2.3).

**Plan para la casilla (Lega la pidió en la ventana de borrar):** lo más simple que la cumple es hacer **primero
la prueba técnica de Drive** (sección 3.9: un portero de prueba con las dos rutas, sin tocar la app, unas horas) y,
si pasa, **construir y publicar las entregas 1 y 2 en la misma tanda**: las migraciones 9 y 10 en el mismo
`db:migrate` y el portero con la app en el mismo push. Si la prueba técnica encuentra algo que pide rediseñar, la 1
sale sola con la línea "Sus archivos quedan en Google Drive (1,2 GB)" y la casilla llega con la 2. La 3 va después,
en su propia tanda.

Cada tanda con su auditoría antes de publicar.

### 9.3 Cómo se probó el SQL (2026-10-01)

Contra la base real (`lga_shotdocs`, en etapa de desarrollo), por la Management API, el mismo camino que `npm run
db:migrate` (`scripts/lib/management.mjs`), **siempre dentro de `begin; … rollback;`**: nada quedó aplicado. Antes
y después de cada tanda se comprobó por una consulta de solo lectura que la base seguía en `schema_version` 8, sin
las columnas nuevas en `workspaces` y sin conexiones colgadas en una transacción. Todo se corrió dos veces: con el
diseño de la primera versión y, de nuevo, con las correcciones de la auditoría (los resultados de abajo son los de
la segunda).

| Corrida | Qué | Resultado |
|---|---|---|
| Entregas 1, 2 y 3 juntas | `begin`, migración 9, su prueba (1.4, secciones A a I), migración 10, su prueba (3.7), migración 11, su prueba (2.3), `rollback`. Armada solo con el SQL de este documento, para que lo versionado sea exactamente lo probado. | `ok` (4 s). |
| Las once pruebas de `supabase/tests/` | Cada una dentro de la misma transacción que las migraciones nuevas: con la 9 sola y con la 9, la 10 y la 11. | Las once `ok` en las dos. |
| Los casos negativos de la auditoría | Unos 60 casos (`negativos.sql` del auditor) sobre la migración 9 corregida y la preparación de la 1.4. | Iguales a los de la auditoría salvo lo corregido: `purge_file` de f3 con P borrado da `file_in_deleted_project` y, al restaurar P, f3 queda fuera de la papelera y sin pedir para Drive (antes: mandado a Drive para siempre); la ventana de P borrado da los mismos números que antes de borrarlo (antes: `pages: 0, trashed_pages: 3`). |
| Controles (mutantes) | La misma corrida con un cambio que rompe algo a propósito: (1) `user_page_level` sin mirar el borrado, (2) `restore_project` sin pedir traer la carpeta, (3) `purge_project` sin el plazo de 30 días, (4) `purge_file` sin `file_in_deleted_project`, (5) restaurar sin la carpeta marcando archivos (lo de antes), (6) volver a pedir la carpeta sin cerrar la marca vieja; y una aserción falsa agregada al final. | Todos fallan donde tienen que fallar. |
| Tiempo con el proyecto más grande | Migración 9 y, como su dueño, `project_delete_info`, `delete_project`, `trashed_projects`, `project_sizes` y `restore_project` sobre la importación de Coda (640 páginas, 2297 archivos, 2602 usos, 5,6 GB), con una huella de sus filas antes y después. | Ventana ~0,6 s, borrar 1,2–2,1 s, restaurar 1,3–1,4 s (tres corridas); la ventana da 640 páginas, 2297 archivos y 5.639.291.372 bytes; con el proyecto borrado los 2297 entran a la papelera de archivos y al restaurar la huella es idéntica. |

Casos de permisos que cubre (las personas son las de la 1.4, más las de la auditoría):

- **Sin ningún permiso** (admin sin permiso sobre P, sacada, sesión con contraseña, `anon`): no lo ve, no lo
  archiva, no lo borra ni lo restaura, no lo ve en la papelera de proyectos (`project_not_found`, sin decir si
  existe); `anon` no llama ninguna función (`42501`).
- **Con permiso de una página** (invitada con ver p1; en la auditoría, un miembro con editar y crear sobre p1):
  antes ve p1 y p2; con P borrado todos sus niveles dan 0 (`page_level`, `can_view_page`, `file_level`,
  `media_file`, las filas de `pages`, `page_updates`, `page_files`, `files`, `comments` y los buckets); ve P en la
  papelera de proyectos sin poder restaurarlo y sin saber quién lo borró ni cuánto tenía; no archiva, no borra, no
  restaura ni lee la ventana; al restaurar, todo igual que antes.
- **Con permiso sobre el proyecto sin manejarlo** (miembro con editar y crear, admin con ver): no archiva, no borra,
  no restaura, no manda la carpeta; con P borrado, todo en 0.
- **Quien lo maneja** (admin con editar y crear, creador miembro de M): borra y restaura; la admin además manda y
  trae la carpeta; el creador miembro no (no es dueño ni admin) ni borra para siempre.
- **La dueña:** antes, todo en 4 y `true`; con P borrado, **todo en 0 también para ella** (aunque creó P y f1); al
  restaurar, exactamente lo de antes (la huella de todas las filas de la prueba es la misma). No puede mandar a
  Drive un archivo de su proyecto O que solo usa P mientras P esté borrado.
- Que restaurar devuelve los niveles: la sección I guarda, para seis personas, todos sus niveles y las filas que
  ve, y compara después de restaurar.

Lo que **no** se pudo probar acá: el portero y Drive de verdad (las rutas no existen; sección 3.9), dos sesiones a la
vez (la prueba usa una sola conexión) y la app.

## Riesgos

1. **Los niveles cambian para todos:** `user_page_level` y `user_project_level` miran ahora el borrado. Probado:
   las once pruebas existentes pasan con la migración, y la sección I compara cada nivel antes y después.
2. **Costo en lo de todos los días** (medido por la auditoría): leer páginas, proyectos y archivos por las
   políticas tarda un 10 a 15 % más (de unos 2,9 a 3,3 s para todo lo de la dueña real) por la consulta de más de
   `user_page_level`. Aceptable; si algún día molesta, se puede cachear el estado del proyecto por consulta.
3. **El tiempo de `delete_project`** crece con los archivos del proyecto (0,5 a 0,9 ms por archivo, sección 9.3):
   un proyecto de más de unos 9.000 archivos podría pasar el tope de 8 s y habría que partirlo en tandas.
4. **Versiones viejas** con el primer proyecto borrado (sección 6.5): un renglón vacío y, si escriben ahí,
   rechazos con el contenido guardado. Lo acota subir `min_app_version` (decidido).
5. **La carpeta entera se lleva lo agregado a mano** y deja lo sacado a mano (sección 3.2). La confirmación lo
   dice; es el mismo criterio que P.9.
6. **Archivos de un proyecto borrado usados en otros proyectos** dejan de verse ahí, y con la casilla de Drive se
   van con la carpeta (sección 3.5). La ventana los cuenta.
7. **Un 404 de Drive al restaurar** puede ser otra cuenta de Google conectada: el portero compara la cuenta y la
   app ofrece restaurar sin los archivos solo con la misma cuenta; y aun así queda una marca reversible
   (sección 3.4).
8. **Restaurar una copia de seguridad** anterior a un borrado con la carpeta en la papelera de Drive (sección 8).
9. **Pases y direcciones firmadas ya dados** siguen sirviendo hasta que vencen (el pase, 8 horas) después de
   borrar, igual que hoy al dejar de compartir.
10. **Lo de Drive es una suposición** hasta la prueba técnica (sección 3.9): cómo se porta una carpeta en la
    papelera con el permiso `drive.file`, la búsqueda por `appProperties` y `trashedTime`.

## Decisiones de Lega (2026-10-01)

Lega respondió **"sí a todo"** a las once preguntas del diseño. Quedan decididas así:

1. **Quién archiva, borra y restaura:** quien puede compartir el proyecto entero ("Editar y crear páginas" sobre él
   y ser dueño o admin, o haberlo creado). La casilla de Drive y el borrado definitivo, solo dueño y admins.
2. **Un proyecto archivado se edita**, con la marca *Archived* a la vista (archivar es orden, no candado).
3. **Drive por carpeta entera:** un pedido al portero, se restaura entera; la confirmación avisa que se lleva
   también lo que se haya puesto a mano en esa carpeta.
4. **La casilla de Drive arranca destildada.**
5. **Plazo de 30 días** para restaurar; al vencer no pasa nada solo y se puede seguir restaurando.
6. ***Delete forever* existe** (entrega 3): solo dueño y admins, recién después de los 30 días, como una marca
   (ninguna fila se borra).
7. **Íconos al pasar el mouse y con el foco** (siempre en el renglón activo); en el teléfono, un "⋯" por renglón;
   renombrar pasa a ser el lápiz del renglón (sale la línea *Rename*). La auditoría señaló que el pedido, leído
   literal, decía "al lado de cada proyecto": Lega aprobó la propuesta de mostrarlos al pasar el mouse.
8. **La palabra de confirmación es la del idioma de la app:** `delete` o `borrar`, sin distinguir mayúsculas; no se
   acepta la del otro idioma.
9. **En *Deleted projects*** lo ven todos los que veían el proyecto; quién lo borró, solo el dueño, los admins y
   quien lo maneja; páginas, archivos y peso, solo quien lo maneja.
10. **El último proyecto activo no se archiva ni se borra** (íconos apagados con el motivo).
11. **Se sube `min_app_version`** a la versión que publique esto, antes del primer borrado.

Y un plan (no una pregunta, sección 9.2): la casilla de Drive sale con la entrega 1 si la prueba técnica de Drive
pasa; si no, la 1 sale con la línea "Sus archivos quedan en Google Drive" y la casilla llega con la 2.

## Correcciones de la auditoría del diseño (2026-10-01)

Una auditoría independiente reprodujo todo el SQL en rollback, le sumó unos 60 casos negativos y leyó el diseño
contra el código. Veredicto: **aprobado con cambios**. Lo que encontró y cómo quedó:

| Punto | Qué era | Cómo quedó |
|---|---|---|
| **B1** (bloqueante) | Un archivo de otro proyecto usado solo en una página del proyecto borrado se podía mandar a la papelera de Drive con el botón de a uno (quien lo mandaba ni veía la página) y al restaurar la foto quedaba rota para siempre. | `purge_file` lo rechaza (`file_in_deleted_project`), `trashed_files` suma `in_deleted_project` y la app lo explica sin botón; la ventana de borrar los cuenta (`foreign_only_here`). Con su caso en la prueba 1.4 (sección C) y en los negativos del auditor. Secciones 1.2, 1.3, 3.5, 7.6. |
| **B2** (bloqueante) | Un `/project/trash` reintentado después de una respuesta perdida podía dejar la carpeta en la papelera de Drive sin anotar, y al restaurar la app ofrecía restaurar sin los archivos. | El registro `projectTrash:<id>` se escribe antes de cada `PATCH` y se acumula; el reintento cuenta como mandadas las carpetas con la marca que ya están en la papelera desde el pedido; `/project/untrash` trae la unión del registro y de la búsqueda. Con sus casos en las pruebas del portero y en la prueba técnica. Secciones 3.8, 3.9, 9.1. |
| **B3** (bloqueante) | *Restore without its files* se ofrecía con Drive sin conectar (pasa cada 7 días en Wanka) y marcaba los archivos para siempre. | Se ofrece solo cuando el portero, con Drive conectado a la misma cuenta, responde `missing`; y restaurar sin la carpeta pone una marca del proyecto (`drive_missing_at`) que se deshace si la carpeta aparece: ningún archivo se marca. Probado (sección J3 y J3b de la prueba 3.7). Secciones 3.3, 3.4, 3.6. |
| Obs. 1 | `fetchProjects` pidiendo `archived_at` a una base sin migrar cortaría toda la sincronización. | Pide las columnas según `schema_version` y reintenta sin ellas ante `42703`. Sección 6.6. |
| Obs. 2 | La pantalla "sin proyectos" no dejaba restaurar. | Suma *Deleted projects* cuando hay alguno restaurable. Sección 6.3. |
| Obs. 3 y 4 | La casilla de Drive faltaba en la entrega 1; los íconos al pasar el mouse. | Plan: entregas 1 y 2 juntas si la prueba técnica pasa. Íconos: aprobados por Lega. Secciones 7.4, 9.2 y decisiones. |
| Obs. 5 y 6 | La ventana sobre un proyecto ya borrado daba `pages: 0`; la lista de borrados y la ventana contaban distinto. | Los dos sacan sus números de `project_numbers` (con `page_alive_any`), iguales activo o borrado. Probado en la sección C. |
| Obs. 7 | `ensure_workspace` prefería un propio archivado a uno compartido sin archivar. | Una sola consulta que deja los archivados para el final. Probado en la sección A. |
| Obs. 8 y 9 | El iPhone capitaliza y corrige la palabra; *Restore within 30 days* prometía un corte que no existe. | Atributos del campo (sección 7.4) y textos nuevos (sección 7.6). |
| Obs. 10 | El costo de la migración en lo de todos los días. | Medido (+10 a 15 %), en "Riesgos". |
| Obs. 11 | `grant execute` de más a funciones privadas. | Sacados (`could_view_project`, `can_manage_project`, `can_purge_project`); la prueba lo comprueba. |
| Obs. 12 y 13 | Una importación en curso en otro dispositivo; una creación de página reenviada se ve como rechazada. | Explicadas (secciones 6.1, 6.2 y 8): nada se pierde. |
| Obs. 14 | Pases ya dados siguen sirviendo. | En "Riesgos". |

## Cómo quedó (entrega 1, v0.077)

Implementada en la rama `lega/proyectos-borrar` (sin publicar). **La migración 9 está en el repo y no está aplicada**:
se aplica después de la auditoría del código y de la copia de seguridad (sección 6.7). Mientras la base no la tenga,
la app nueva se ve y anda como la anterior (sin íconos ni listas nuevas): todo depende de `schema_version` ≥ 9.

**Base** (`supabase/migrations/20261001120000_proyectos_archivar_borrar.sql`, la de la sección 1.3, y su prueba
`supabase/tests/proyectos_borrar_permisos.sql`, la de la 1.4): corridas otra vez en `begin; … rollback;` contra la
base real, con las once pruebas que ya existían y los casos negativos de la auditoría (sección 9.3).

**Sincronización** (`src/sync/`):

| Pieza | Qué hace |
|---|---|
| `remote.ts` | `fetchProjects(schemaVersion)` pide `archived_at` solo con la versión 9 o más y, ante un `42703`, sigue sin la columna diez minutos (como `settings` en `fetchTreeOf`): una base de otro workspace sin migrar no corta la sincronización. `ProjectStatesRemote`: `setProjectArchived`, `deleteProject`, `restoreProject`, `trashedProjects` (nulo sin la función), `projectDeleteInfo`. `trashedFiles` trae `in_deleted_project`. |
| `engine.ts` | Guarda la versión de la base en el estado (`schemaVersion`) y se la pasa a `fetchProjects`. |
| `tree.ts` | `activeProjects()`, `archivedProjects()`, `hasNoProjects()`; `markArchived` y `forgetProject` (la lista cambia enseguida, sin esperar a sincronizar; nada se borra del dispositivo). El primer proyecto (`workspaceId`) dejó de ser fijo: el de relleno sale solo mientras el dispositivo nunca bajó la lista, y si el servidor deja de mandarlo se reemplaza por el primero activo y se guarda en `meta` (sección 6.4). |
| `access.ts` | `canManageProject`: la misma regla que compartir el proyecto entero. |
| `projectStates.ts` | La palabra por idioma, lo sin subir de un proyecto en el dispositivo (cambios del árbol en la cola o rechazados, contenido, imágenes, fotos y videos, comentarios), a cuál se pasa después de archivar o borrar el abierto y el "último activo". |

**Interfaz:**

- **Selector** (`ProjectSwitcher.tsx`): cada renglón es un contenedor con la opción que abre el proyecto y, al lado,
  renombrar (lápiz), archivar y borrar, visibles al pasar el mouse, con el foco o en el renglón activo de las flechas;
  solo los que la persona puede usar. Tooltips con `data-tip` (*Rename*, *Archive*, *Delete…*; apagados, el motivo:
  sin red o "es tu único proyecto"). Archivar pregunta en el mismo renglón. Al pie: *Archived projects (N)* (la lista
  con su buscador, desarchivar y borrar) y *Deleted projects* (la papelera de proyectos con *Restore*). La línea
  *Rename “X”* salió. En el teléfono, un "⋯" por renglón despliega *Rename*, *Share…*, *Archive* y *Delete…* debajo.
- **Ventana de borrar** (`ProjectStatesPart.tsx`, se baja aparte): páginas, archivos y GB en Drive, con cuántas
  personas está compartido, el plazo, "Sus archivos quedan en Google Drive", los avisos de archivos usados en otros
  proyectos, la palabra `delete` / `borrar` (campo sin mayúscula ni corrector en el iPhone), y el bloqueo con lo sin
  subir de ese proyecto (con *Download my unsynced changes*) o con una importación de Coda en curso. En el teléfono
  ocupa la pantalla, con los botones abajo.
- **Pantalla "sin proyectos"** (`Workspace.tsx`): también cuando el servidor deja de mandar todos los proyectos de un
  dispositivo ya abierto; suma *Deleted projects* si hay alguno que la persona puede restaurar.
- **Papelera de archivos** (`TrashView.tsx`): un archivo con `in_deleted_project` dice "Lo usa una página de un
  proyecto borrado…" y no tiene el botón; *Empty* lo deja afuera.
- **Búsqueda** (Ctrl/⌘+K): sin los archivados en la lista vacía (el abierto, sí); escribiendo su nombre, aparecen marcados.
- **Portero:** `purge_file` con `file_in_deleted_project` responde `409 in_deleted_project` (antes, `502 db_error`):
  la app publicada antes, que todavía ofrece el botón, recibe un motivo claro. `Doc_Portero.md`.
- **Importación de Coda:** el diario de una importación cortada ya no se borra si su proyecto no está en el árbol:
  puede estar en la papelera de proyectos y volver (sección 8).

**Pruebas:** `src/sync/projectStates.test.ts` (14: archivar, quién puede, otro dispositivo con cambios sin subir que
los conserva y los sube al restaurar sin duplicar, nadie lo ve borrado, el primer proyecto reemplazado, sin
proyectos, el archivo de otro proyecto, lo sin subir por proyecto, a cuál se pasa, y la base sin migrar: versión 8,
`42703`, `PGRST202`), `src/ui/projectStates.test.tsx` (11: íconos y tooltips sin `title`, archivar en el renglón y la
lista de archivados, el último activo, quien no maneja, la base vieja, la ventana con la palabra en los dos idiomas y
los atributos del iPhone, el bloqueo por cambios sin subir, la lista de borrados con *Restore*, el teléfono con "⋯",
y la pantalla sin proyectos), uno más en `trashView.test.tsx` y en la prueba del portero. Suite completa, `tsc` y
`build` bien. Capturas en Chromium sin ventana contra el servidor de las pruebas (selector, íconos, tooltip,
confirmar, archivados, ventana en inglés y en castellano oscuro, borrados, teléfono): sin errores en la consola.

**Lo que se apartó del diseño o quedó para después:**

- *Deleted projects* se ofrece a todos con la base en la versión 9 (no solo a quien maneja algún proyecto o sabe de
  uno borrado, sección 7.2): la lista vacía dice "No deleted projects".
- El aviso de 6.2 ("ana@… mandó “X” a Proyectos borrados") no está: el proyecto sale de la lista en la próxima
  sincronización y, si estaba abierto, la app cae al primero activo. Tampoco la línea de `page.notFound`.
- El bloqueo por importación mira cualquier importación de Coda en curso en el dispositivo, no solo hacia ese
  proyecto (el trabajo de importación no sabe todavía a qué proyecto va hasta crearlo).
- En el teléfono, las acciones se despliegan debajo del renglón en vez de una hoja aparte.
- Subir `min_app_version` (decisión 11) es un paso de la publicación, no del código.

**Ayuda (regla de P.13):** la ayuda todavía no existe en el código (`Doc_Tutorial.md`, sin implementar). Su entrada,
lista para sumarla, en inglés (la interfaz) y en castellano:

> **Archive or delete a project.** Point at a project in the project menu (or tap "⋯" on the phone): the pencil
> renames it, the box archives it and the trash can deletes it. Archiving takes it out of your everyday list; it
> stays exactly as it is, still editable, under *Archived projects*. Deleting asks you to type *delete*: the project
> goes to *Deleted projects*, nobody sees it anymore, and it can be restored exactly as it was (after 30 days too,
> until someone deletes it forever). Nothing is erased, and its files stay in Google Drive. Your only active project
> cannot be archived or deleted, and a device with unsynced changes in that project has to upload them first.
>
> **Archivar o borrar un proyecto.** Pasá el mouse por un proyecto en el selector (o tocá "⋯" en el teléfono): el
> lápiz lo renombra, la caja lo archiva y el tacho lo borra. Archivar lo saca de tu lista de todos los días; queda
> tal como está, editable, en *Proyectos archivados*. Borrar pide escribir *borrar*: va a *Proyectos borrados*, nadie
> lo ve más y se puede restaurar tal como estaba (también después de los 30 días, mientras nadie lo borre para
> siempre). Nada se borra de verdad y sus archivos quedan en Google Drive. Tu único proyecto activo no se archiva ni
> se borra, y un dispositivo con cambios de ese proyecto sin subir tiene que subirlos antes.

No hay atajos de teclado nuevos (Enter confirma y Escape cierra, como en las otras ventanas).

### Correcciones de la auditoría del código (2026-10-01)

Veredicto: "se puede publicar corrigiendo". Lo corregido, cada punto con su prueba:

| Punto | Qué era | Cómo quedó |
|---|---|---|
| **B1** | Si la app arrancaba sin red (sin saber todavía la versión de la base), los archivados no aparecían en ningún lado. | *Archived projects (N)* sale de la copia del dispositivo, sin mirar la versión ni la red; desarchivar y borrar, adentro, siguen pidiendo las dos. En Ctrl/⌘+K los archivados no están en la lista vacía, pero se encuentran escribiendo su nombre, marcados *Archived*. |
| **B2** | La marca *Archived* solo se veía con el selector abierto. | También en el botón del selector ("Project · 12 pages · Archived") y en el inicio del proyecto, con una línea que dice cómo desarchivarlo. |
| Obs. 1 | La pantalla "sin proyectos" en un dispositivo ya abierto tapaba lo que tenía sin subir. | Lo cuenta, ofrece *Download my unsynced changes*, y *Sign out* pregunta como el menú de la cuenta. |
| Obs. 2 | Escape cerraba todo el selector. | En la confirmación del renglón vuelve al renglón; en la lista de archivados (con el foco en su buscador), a la principal. |
| Obs. 3 | Después de archivar con el teclado el foco caía en la página. | Vuelve al buscador del selector; después de borrar, al botón del selector. |
| Obs. 4 | Errores en crudo ("Could not do it: not_allowed"). | `project_not_found`, `not_allowed` y `project_deleted` con su frase, en los dos idiomas (`projectStateError`). |
| Obs. 5 | "Es tu único proyecto" aunque hubiera archivados. | Con archivados: "Es tu único proyecto activo: primero creá o desarchivá otro". |
| Obs. 6 | `useCurrentProject` podía caer en un archivado. | Sin uno elegido, si el primero del dispositivo está archivado, abre el primero activo. |
| Obs. 7 | "Create the first project" a quien tenía borrados para restaurar; "· Quedan 30 días" con mayúscula. | Texto propio ("Restaurá un proyecto borrado de abajo, o creá uno nuevo"); el plazo en minúscula después del "·" y con mayúscula si abre el renglón. |
| Obs. 8 | Una prueba de `pageView` pasa el tope de 5 s con la suite entera, 1 de cada 4 veces. | Viene de antes (falla igual en `main`); no se toca. |

## Cómo quedó (entrega 2)

Implementada en la rama `lega/proyectos-borrar-drive` (sin publicar). Se construyó antes de la prueba técnica, que
queda como un script para correr contra el portero publicado (abajo): Lega necesita la casilla ya, para borrar la
importación de prueba de ERSO (5,6 GB en su Drive) sin dejarla huérfana.

**Base** (`supabase/migrations/20261005120000_proyectos_drive.sql`, la de la sección 3.6, y su prueba
`supabase/tests/proyectos_drive_permisos.sql`, la de la 3.7 con la preparación de la 1.4): corridas en `begin; …
rollback;` contra la base real (versión 9) junto con las otras doce pruebas, todas `ok`. La prueba de la entrega 1
acepta las dos firmas de `restore_project` (la 10 le suma `p_without_drive`) y pasa con la migración y sin ella.
**La migración 10 no está aplicada.**

**Portero** (`portero/src/core.ts`, `Doc_Portero.md`): `POST /project/trash` y `POST /project/untrash` como en la
sección 3.8, con el registro acumulado antes de cada `PATCH`, la búsqueda por la marca, la unión al traer, el margen de
5 minutos, `drive_other_account` y los errores con `code`. Tres cosas que se agregaron al implementar:

- **La carpeta recordada se revisa antes de pedirle nada a la base:** si no lleva la marca (`drive_mismatch`), el
  proyecto queda sin pedido y se puede restaurar. Al traer, una carpeta sin la marca se deja afuera en vez de trabar
  la restauración.
- **Sin `trashedTime`** (Google lo documenta solo para unidades compartidas; lo dice la prueba técnica, punto 3), una
  carpeta con la marca en la papelera cuenta como del pedido: traer de más nunca pierde nada.
- **Restaurado mientras se mandaba:** si al confirmar la base dice que ya no hay pedido, lo mandado en ese pedido
  vuelve y la respuesta es `409 project_restored`. Mandar y traer del mismo proyecto van de a uno.

Y, solo para el dueño y para la prueba técnica: `GET /project/inspect` (solo mira) y los modos `test: 'lost_response'`
y `'lost_registry'`, que dejan el estado exacto de una respuesta perdida o de un registro perdido. Los modos están
**apagados** salvo con la variable `TEST_MODES=1` en el Worker, que se prende para la prueba técnica y se saca al
terminar (`Doc_Portero.md`).

**Corrección de la auditoría del código (B1):** *Look for its files again* podía decir "volvieron" sin que volviera
nada: si Google ya había borrado la carpeta y, después de restaurar sin ella, una foto nueva creaba otra carpeta con la
misma marca, `/project/untrash` contaba esa carpeta nueva como "existe" y la base borraba `drive_missing_at`. Ahora
cuentan solo las carpetas de ese pedido: las del registro, las que se traen de la papelera y una viva creada antes del
pedido (`createdTime`). Con la carpeta nueva sola, la respuesta es `missing` y la marca queda (prueba A1 en
`core.test.ts`, con los casos A3 a A5 del auditor).

**App:**

- **La ventana de borrar** (`ProjectStatesPart.tsx`): con la base en la versión 10 y portero, la casilla *Also send its
  files to the Google Drive trash (5.3 GB)*, **destildada** al abrir. Tildada, explica la carpeta
  (`LGA_ShotDocs/<Proyecto>`, también lo agregado a mano) y los 30 días de Google. Apagada con el motivo si quien borra
  no es dueño ni admin o si Drive no está conectado. Con el proyecto restaurado antes sin su carpeta, avisa que lo no
  encontrado esa vez deja de poder recuperarse desde la app. Primero borra (la base) y después manda la carpeta; si eso
  falla, el proyecto queda borrado y el aviso dice que se termina desde *Deleted projects*.
- **La lista de borrados:** "Files in the Google Drive trash until Oct 29" (o que el envío no terminó); *Send files to
  the Drive trash (782 MB)* para dueños y admins, que pregunta en el renglón (uno a medias se termina sin preguntar);
  *Restore* trae primero la carpeta. Si Drive, con la misma cuenta, ya no la tiene, pregunta en el renglón y *Restore
  without its files* restaura con la marca reversible. Con otra cuenta, sin conectar o sin red, solo el motivo. A quien
  maneja el proyecto sin ser dueño ni admin, *Restore* apagado con el porqué (traer la carpeta no le toca).
- **El inicio de un proyecto restaurado sin su carpeta:** lo dice y, a dueños y admins que lo manejan, *Look for its
  files again*.
- La sincronización pide `drive_trash_requested_at` y `drive_missing_at` solo con la versión 10 y, ante un `42703`,
  sigue sin ellas diez minutos (como `archived_at`). `restore_project` lleva el segundo parámetro solo cuando hace
  falta (una base de la versión 9 tiene uno).

**Pruebas:** portero, 21 nuevas (`core.test.ts`, Drive simulado con la papelera de las carpetas, `trashedTime`
opcional, respuestas perdidas y fallas a mitad: ida y vuelta, el orden del registro, un archivo mandado antes que no
vuelve, permisos, `drive_mismatch`, respuesta perdida, registro perdido con y sin `trashedTime`, dos carpetas con falla
en el medio, carpeta vieja, otra cuenta, carpeta que no existe, Google que la borró y reaparece, proyecto sin carpeta,
volver a mandar después de restaurar sin ella, restaurado mientras se mandaba, sin Drive, base sin migrar, CORS,
`inspect` y los modos de prueba). App: 11 de componente (`projectStates.test.tsx`) y 6 en `projectDrive.test.ts`.
Suite completa, `tsc` y `build` bien. Capturas en Chromium sin ventana contra el servidor de las pruebas, sin errores
en la consola.

**La prueba técnica (sección 3.9), lista para correr después de publicar:** un script de Node sin dependencias
(`prueba-drive.mjs`, en el depósito privado de pruebas) que entra con el código de 8 dígitos, se niega con ERSO o con
más de 20 archivos y pide escribir el nombre del proyecto. Con un proyecto de prueba de tres fotos (y una cuarta
mandada antes a la papelera de Drive) comprueba solo los puntos 1, 2, 3, 4, 6, 7 y 9 (el 9 también de solo lectura
sobre ERSO, `--check-parents`), pregunta el 8 y deja el 5 como opcional (`--other-account`: cambia la cuenta
conectada). Termina con el proyecto restaurado y su carpeta de vuelta. Se probó de punta a punta contra el portero de
verdad con Drive y base de mentira.

**Lo que se apartó del diseño o quedó para después:**

- La prueba técnica corre después de publicar, no antes (pedido de Lega). Si encuentra algo, se corrige con la casilla
  ya publicada; mientras tanto, nada va a la papelera de Drive sin la casilla tildada.
- Las fotos de un proyecto restaurado sin su carpeta se ven rotas en la página: la app todavía no muestra *File deleted
  (in the Drive trash)* con la regla de `project_sizes` (sección 3.3). El inicio lo explica.
- El pase de un archivo dado antes de mandar la carpeta (punto 6) sigue la regla de siempre: vale hasta que vence.
- **La app v0.077 no puede restaurar un proyecto con la carpeta en la papelera de Drive:** con la base en la versión
  10, su *Restore* llama a `restore_project(p)` sin traer la carpeta y la base responde `drive_untrash_first` ("Could
  not do it: drive_untrash_first"). No pierde nada: el proyecto sigue borrado y se restaura desde la app nueva. Lo acota
  `min_app_version` (hoy 0.078): al publicar esta entrega se sube a esta versión, antes del primer borrado con la
  casilla.

**Ayuda (regla de P.13):** la entrada de la entrega 1 suma un párrafo; está en `Doc_Tutorial.md`, "Entradas esperando
la ayuda".

## Cómo quedó: una sola papelera (v0.162)

**Qué pasaba.** Había dos papeleras: *Trash* abajo de la barra lateral, arriba del nombre de la cuenta (páginas y, en
otra pestaña, archivos), y *Deleted projects* adentro del selector de proyectos. Lega no entendía la diferencia (un
ejemplo real: borra un proyecto de prueba y después lo busca en *Trash*, donde no está). Pidió una sola (2026-10-03).

**Cómo quedó.** Una sola *Trash*, en el selector de proyectos, en el lugar de *Deleted projects* (la línea de abajo
de *Archived projects*). Abre el selector en un modo propio (como los archivados), más ancho en la compu (440 px) y la
hoja de abajo de siempre en el teléfono:

```
┌ ‹ Trash                                            ┐
│ [ All | Projects | Pages | Files ]                 │
│ [ This project | All projects ]                    │
│ Deleted projects, pages and files, newest first…   │
│ [BN] PROJECT                          [Restore]    │
│      Bosque Negro · Deleted by lega@… · today      │
│ [▣]  FILE · MGTZD                 [Send to Drive…] │
│      IMG_0042.JPG · 2 KB · Oct 3 · 30 days left    │
│ [📄] PAGE · MGTZD                     [Restore]    │
│      Escena vieja · 10/2/2026, 14:03               │
└────────────────────────────────────────────────────┘
```

- **La lista:** proyectos, páginas y archivos juntos, del más nuevo al más viejo (por la hora de borrado: la del
  dispositivo y la de la base se comparan como fechas, no como texto). Cada renglón dice qué es y de qué proyecto
  (*Page · MGTZD*); un proyecto borrado dice *Project*.
- **El filtro** *All / Projects / Pages / Files* (sin *Projects* con una base anterior a la versión 9; sin *Files* si
  la persona no ve ninguna papelera de archivos; con solo páginas, sin filtro). Cada filtro lleva su explicación de
  antes; *Files*, además, el total, el borrado automático, el aviso de lo sin sincronizar y *Empty*.
- **El alcance:** *This project* de entrada; *All projects* suma las páginas y los archivos de los demás proyectos
  del dispositivo (activos y archivados). Los proyectos borrados no son de ningún proyecto abierto: se ven con los
  dos alcances, y con el filtro *Projects* el alcance no aparece.
- **Cada tipo hace lo de antes:** páginas de la copia del dispositivo (anda sin red), *Restore* a quien puede
  manejarla y el título la abre (y cierra el selector); archivos con red, una consulta `trashed_files` por proyecto la
  primera vez que entra en el alcance, mandar a la papelera de Drive de a uno o *Empty* (solo dueño y admins, con sus
  confirmaciones); proyectos con red (`trashed_projects`), con *Restore*, *Restore without its files*, *Send files
  to the Drive trash* y las preguntas en el renglón, iguales (`useDeletedProjects` y `DeletedProjectItem` en
  `ProjectStatesPart.tsx`, que también usa la pantalla "sin proyectos").
- **Permisos:** sin cambios en la base y sin migración. Lo que se ve sale de las mismas consultas de antes: los
  proyectos borrados, de `trashed_projects` (quien no veía *Deleted projects* con alguno adentro, no ve ninguno); los
  archivos, solo de los proyectos con `canSeeFileTrash` y lo que la base devuelve; las páginas, de lo que la base ya
  le baja al dispositivo.
- **Sin red:** las páginas, con la línea *Deleted projects and files need an internet connection*; nada se pide. *Files*
  no se ofrece si no había archivos leídos, y *Projects* no dice además "No deleted projects".
- **El avance de *Empty*** ("Sending 2 of 4…") va arriba de la lista y se ve aunque se cambie de filtro o de alcance a
  mitad (el envío sigue).
- **La dirección vieja `/trash`** (un marcador): muestra el inicio del proyecto con el selector abierto en la papelera
  (`openProjectTrash`). Con un link público, va a la página compartida.
- **Lo que se fue:** el botón de la barra lateral y la vista `/trash` a pantalla entera. Los textos que decían
  *Deleted projects* como lugar ahora dicen *the Trash* (la ventana de borrar, los avisos, los errores, la ayuda).
- **Ayuda y recorrida:** la entrada *Trash* se reescribió (dónde está, el filtro, el alcance), con *Show me* al paso
  del selector y `since` nuevo (sale en *What's new*); el paso del selector de la recorrida dice que la papelera
  está ahí. Sin atajo nuevo (no había uno para la papelera).

**Decisiones tomadas en el camino** (Lega no estaba):

1. **Los proyectos borrados se ven con *This project*.** Qué pasaba: con el alcance de entrada, un proyecto borrado
   (que no es de ningún proyecto abierto) no habría aparecido nunca sin pasar a *All projects*; Lega borra un
   proyecto, abre la papelera y no lo ve. Opciones: (A) siempre; (B) solo con *All projects*; (C) un tercer alcance.
   Elegí A porque es lo que se busca primero y son pocos. Si preferís otra, es una línea en `TrashView.tsx`.
2. **`/trash` abre el selector en la papelera, sin cambiar la dirección.** Qué pasaba: un marcador viejo a `/trash`
   mostraba la papelera a pantalla entera. Opciones: (A) abrir el selector en la papelera sobre el inicio; (B) mandar
   al inicio sin más; (C) mantener la vista a pantalla entera. Elegí A porque el marcador sigue llevando a la papelera
   y no hay dos lugares. Si preferís B, se borra el efecto de `Workspace.tsx`.
3. ***Empty* solo con el filtro *Files*.** Qué pasaba: con *All*, un *Empty* parecería vaciar también páginas y
   proyectos, y eso no existe. Opciones: (A) solo en *Files*; (B) en *All* con otro nombre. Elegí A: es lo de antes
   (la pestaña Archivos) y no confunde. Si preferís B, se agrega el botón en el modo *All*.
4. **El selector se cierra al hacer clic afuera**, como siempre: un *Empty* en curso se corta ahí (lo mandado queda
   mandado, lo demás sigue en la papelera), igual que antes al salir de la vista `/trash`.
5. ***Empty* vacía solo la papelera de archivos del proyecto abierto (decisión de Lega, después de la auditoría).**
   La auditoría encontró que con *All projects* vaciaba las de todos los proyectos y la pregunta no lo decía. Ahora
   *Empty* se ofrece solo con *Files* y *This project* (con *All projects* no está), y la pregunta nombra el proyecto:
   *Empty the file trash of “MGTZD”: send all 4 files to the Google Drive trash?*. Es el mismo alcance que antes.

**Pruebas:** `src/ui/trashUnified.test.tsx` (16: el orden con horas escritas distinto, los filtros, la barra lateral
sin papelera, el selector con los tres tipos y su proyecto, *All projects*, cada filtro con su explicación, restaurar
y abrir una página, restaurar un proyecto, mandar a Drive un archivo de otro proyecto, castellano, un miembro que solo
ve (sin *Restore*, sin archivos, solo el borrado que veía y sin quién lo borró), quien no veía ninguno, sin red, una
base sin la versión 9, `openProjectTrash` con Escape y ‹, y el teléfono); las de `trashView.test.tsx` y
`projectStates.test.tsx` pasan a la papelera única. Después de la auditoría (ronda 1), 5 más: *Empty* solo del proyecto
abierto y nombrándolo (en los dos idiomas), su avance a la vista al cambiar de filtro, sin páginas de un proyecto que
salió de la lista, y *Send files to the Drive trash* solo con `can_purge`; y sin red, sin *Files* ni "No deleted
projects".

## Cómo quedó (entrega 3)

**Base** (`supabase/migrations/20261101120000_proyectos_purgar.sql`, `schema_version` 23, **aplicada** en v0.167, después de
la 22). Es el SQL de la sección 2.3 llevado a la base de hoy: `workspaces.purged_at` y `purged_by` (con su `check`: solo
un proyecto borrado; la API no los escribe) y `purge_project(p)`, que **no borra ninguna fila**: comprueba quién (dueño o
admin que maneja el proyecto, `can_purge_project`; quien no lo veía recibe `project_not_found`), que esté borrado, que
pasaron los 30 días, que la carpeta esté en la papelera de Drive si tenía archivos subidos (`drive_trash_first`) y la
versión mínima de la app; marca sus archivos subidos como mandados a la papelera de Drive (`project_files_purged`, de la
entrega 2) y pone la marca. Después, `restore_project`, `request_project_drive_trash` y `project_drive_untrashed` dan
`project_purged`; `trashed_projects` lo deja afuera para todos (misma firma); `media_project` suma `purged_at`.

**Portero:** sin rutas nuevas. `/project/trash` y `/project/untrash` responden `409 project_purged` sin tocar Drive ni la
base si el proyecto está borrado para siempre (`Doc_Portero.md`).

**App:** en la papelera única, el renglón de un proyecto borrado suma *Delete forever…* (en rojo, al lado de *Send files
to the Drive trash*) cuando pasaron los 30 días, la persona es dueña o admin que lo maneja (`can_purge`), la base está en
la 23 y hay red. Pregunta en el mismo renglón: qué pasa, la palabra (`delete` / `borrar`, la del idioma de la app, sin
mayúscula ni corrector en el iPhone) y *Delete forever*, que se habilita recién con ella; Enter confirma y Escape cierra
la pregunta. Si la base contesta `drive_trash_first`, el portero manda la carpeta y se vuelve a pedir; si Drive falla, lo
dice en el renglón y no marca nada. Si archivos de este proyecto se usan en páginas vivas de otros proyectos, la pregunta
lo avisa con su cuenta (`used_elsewhere`): esas páginas los pierden cuando Google vacíe su papelera. Al terminar, el renglón sale y queda el aviso "“X” was deleted forever". Nada del
dispositivo se borra. Textos en los dos idiomas (`src/i18n/lazy/projectStates.ts`, `project.errorPurged`) y la entrada
*Delete a project forever* de la ayuda (dueños y admins). Sin atajos nuevos.

**Pruebas:** SQL `supabase/tests/proyectos_purgar_permisos.sql` (con la preparación de la 1.4), corrida en `begin; …
rollback;` contra la base real junto con las otras 30 (todas `ok`), una aserción falsa de control y 17 mutantes de la
migración (los 17 fallan donde tienen que fallar). App: 10 de componente (`projectStates.test.tsx`: antes de los 30
días, la palabra en los dos idiomas, la carpeta antes, ya mandada, Drive que falla, Escape, base anterior a la 23, el
creador miembro, el aviso de los archivos usados afuera y el botón que lo espera), la búsqueda de la ayuda y 2 del portero (`core.test.ts`).

**Una versión vieja de la app** (con la base en la 23): `trashed_projects` ya no le da el proyecto borrado para siempre,
así que no lo muestra como restaurable; si tenía la papelera abierta de antes y aprieta *Restore*, la base responde
`project_purged` (lo ve como "Could not do it: project_purged") y no cambia nada. El proyecto ya había salido de su lista
al borrarlo. Lo que un dispositivo tenía sin subir de ese proyecto quedó rechazado y a la vista desde el borrado, y sigue
ahí (se baja con *Download my unsynced changes*). **No hace falta subir `min_app_version`** por esta entrega.

**Decisiones tomadas en el camino** (Lega no estaba):

1. **Dónde va *Delete forever*.** Qué pasaba: el diseño lo ponía en *Deleted projects*, que ya no existe (v0.162). Las
   opciones: (A) un botón en el renglón del proyecto en la papelera única; (B) en la ventana de borrar; (C) también en la
   pantalla "sin proyectos". Elegí A porque es donde está el proyecto borrado y su *Restore*, y la pantalla "sin
   proyectos" sirve para restaurar, no para borrar. Si preferís otra, es pasar `purgeReady` en `DeletedProjectsList`.
2. **Antes de los 30 días, el botón no está** (en vez de apagado con el motivo). Qué pasaba: un botón apagado en cada
   borrado suma ruido a todos. Las opciones: (A) no mostrarlo; (B) apagado con un globito. Elegí A porque el renglón ya
   dice "quedan N días" y la ayuda lo explica. Si preferís B, es un `data-tip` en `DeletedProjectItem`.
3. **La pregunta en el renglón, no una ventana.** Qué pasaba: las otras preguntas de un borrado (mandar la carpeta,
   restaurar sin los archivos) son en el renglón. Las opciones: (A) en el renglón con la palabra; (B) una ventana como la
   de borrar. Elegí A porque es lo mismo que ya hay en ese lugar y no tapa el selector. Si preferís B, la ventana de
   borrar se puede reusar casi entera.
4. **Primero la base, después el portero si hace falta.** Qué pasaba: el diseño mandaba la carpeta antes; un proyecto
   sin archivos subidos, o con la carpeta ya mandada, pediría Drive conectado sin necesidad. Las opciones: (A) pedir a la
   base y, solo con `drive_trash_first`, mandar la carpeta y volver a pedir; (B) siempre la carpeta antes. Elegí A porque
   la base decide igual (no marca nada si falta la carpeta) y anda sin Drive cuando no hace falta. Si preferís B, es una
   línea en `purge`.
5. **Los archivos de otros proyectos que solo usaba quedan libres.** Qué pasaba: un archivo de O usado solo en una página
   de P queda frenado mientras P está borrado (`file_in_deleted_project`, para que restaurar P lo encuentre); con P
   borrado para siempre quedaba frenado para siempre en la papelera de O. Las opciones: (A) que esos usos dejen de contar
   (`file_in_deleted_project`, `trashed_files` y `files_due_for_purge` miran `purged_at`); (B) dejarlo. Elegí A porque P
   ya no vuelve y el archivo es de O: se manda desde la papelera de O como cualquier otro. Si preferís B, se sacan las
   tres funciones de la migración.
6. **Pedir o traer la carpeta de uno borrado para siempre, no.** Qué pasaba: el diseño solo frenaba traerla. Las
   opciones: (A) también pedirla (`request_project_drive_trash`), y el portero responde `project_purged` antes de tocar
   Drive; (B) solo traerla. Elegí A porque un pedido nuevo sobre un proyecto que ya no se ve dejaría marcas que nadie
   puede cerrar. Si preferís B, se saca esa guarda.
7. **La versión mínima también frena *Delete forever*** (`require_session_write_version`, como borrar y restaurar desde
   la v0.099): una pestaña vieja no marca nada si el workspace pide una más nueva.
8. **El nombre y la versión de la migración** son los del encargo (`20261101120000`, 23), no los del diseño (`…10120000`,
   11), que quedaron ocupados por otras migraciones.
9. **La pregunta avisa de los archivos usados en otros proyectos** (auditoría, observación 1). Qué pasaba: los archivos de
   este proyecto que usan páginas vivas de otros proyectos van a la papelera de Drive con la carpeta, y esas páginas los
   pierden cuando Google la vacía; la ventana de borrar lo decía, pero 30 días antes. Las opciones: (A) la misma cuenta
   (`used_elsewhere` de `project_delete_info`) en la pregunta, con *Delete forever* esperando a leerla; (B) no avisar.
   Elegí A porque es el mismo criterio que la ventana de borrar y la última oportunidad de verlo. Si no se puede leer, no
   frena (la base decide igual). Si preferís B, se saca el aviso de `PurgeAsk`.

### Restos de la auditoría de la entrega 3 (v0.171)

- **El peso de uno borrado para siempre (O4).** `project_sizes` sumaba lo que el proyecto nunca subió en la papelera de
  la app o como "sin subir", para siempre y sin forma de sacarlo. La migración `20261103120000_purgados_peso_link_total.sql`
  (`schema_version` 25, aplicada) lo deja afuera: no ocupa el Drive y nadie lo va a subir (nadie ve el proyecto). Lo
  subido sigue contando donde está de verdad: en la papelera de Drive durante 30 días desde que se mandó, y después deja
  de contar solo, como cualquier archivo. Un borrado sin purgar sigue sumando todo (se puede restaurar). Ninguna fila se
  borra; la app no cambia (suma lo que da la base). Prueba: `supabase/tests/purgados_peso_link_total_permisos.sql` (y la
  de la 23, ajustada a este peso).
- **El servidor de las pruebas como la base (O3).** `purgeProject` de `src/sync/testing.ts` aceptaba la carpeta mandada
  para cualquier archivo; ahora la carpeta cubre solo lo subido hasta el pedido (`uploaded_at`, que el portero falso
  anota al confirmar; sin fecha, de antes), da `drive_trash_first` si hay algo subido después y marca con las fechas de
  la carpeta, como `project_files_purged`.

## Pendiente

- **Entrega 2** (publicada en v0.080, migración 10 aplicada): falta la prueba técnica con Drive de verdad (sección 3.9;
  prender `TEST_MODES=1`, correrla con un proyecto de prueba y sacar la variable); recién después borrar ERSO con la
  casilla.
- **Entrega 3** (*Delete forever*): publicada en v0.167, migración 23 aplicada. Auditada con observaciones; la 1
  corregida: la pregunta avisa de los archivos usados en otros proyectos.
- Las dos observaciones chicas de la auditoría de la entrega 3 (O3 y O4) quedaron hechas en v0.171 (arriba); falta
  aplicar su migración (la 25) con la tanda.
