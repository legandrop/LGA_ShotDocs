-- LGA Shot Docs · renombrar una versión con nombre deja el nombre anterior guardado (Docs/Doc_Historial.md, "Lo que
-- quedó de las entregas", O3).
--
-- `rename_page_version` (20261011120000_versiones_con_nombre.sql) cambia `page_versions.label` en la misma fila: el
-- nombre anterior se perdía, también cuando quien renombra no es quien lo puso (nivel 4 sobre la página). En esta base
-- nada se borra: sacar un nombre deja la fila con `removed_at`; renombrar no dejaba nada.
--
-- Agrega `page_version_labels`: una fila por cada nombre reemplazado, con el nombre que tenía, quién lo cambió y
-- cuándo. La escribe un trigger de `page_versions` cuando cambia `label`, así que vale para cualquier camino que
-- renombre, hoy y más adelante. Quién había puesto cada nombre se deduce: el primero, `page_versions.created_by`; los
-- siguientes, quien hizo el cambio anterior.
--
-- Permisos: ninguno nuevo. La tabla no se lee ni se escribe desde la API (Row Level Security sin políticas y sin
-- privilegios, como `page_versions`); queda para consultarla desde la consola. El trigger corre con los permisos de su
-- dueño y nadie lo llama a mano.
--
-- Compatible con la app y el portero publicados: `rename_page_version` no cambia (misma firma, mismo cuerpo, mismo
-- resultado, mismo id de la versión y mismo dueño del nombre); ninguna función devuelve nada distinto. No sube
-- `schema_version`: la app no necesita saber si la base la tiene.

create table public.page_version_labels (
  id          bigint generated always as identity primary key,
  version_id  uuid not null references public.page_versions (id) on delete cascade,
  -- El nombre que tenía hasta este cambio.
  label       text not null,
  replaced_at timestamptz not null default now(),
  -- Quién lo cambió; nulo si fue desde la consola o si la cuenta ya no existe.
  replaced_by uuid references auth.users (id) on delete set null
);

create index page_version_labels_version_idx on public.page_version_labels (version_id, id);

-- Sin acceso desde la API: ni la sesión ni anon la leen o la escriben.
alter table public.page_version_labels enable row level security;
revoke all on public.page_version_labels from public, anon, authenticated;

create function private.page_versions_keep_label()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- Quien lo cambió, solo si su cuenta existe: una sesión de una cuenta que ya no está (o un `sub` cualquiera) deja el
  -- renombre sin persona en vez de hacerlo fallar por la clave foránea.
  insert into public.page_version_labels (version_id, label, replaced_by)
  values (old.id, old.label, (select u.id from auth.users u where u.id = (select auth.uid())));
  return null;
end;
$$;

revoke all on function private.page_versions_keep_label() from public, anon, authenticated;

-- Solo cuando el nombre cambia de verdad: repetir el mismo nombre, sacarlo o una marca de restauración (sin nombre) no
-- dejan fila.
create trigger page_versions_keep_label
  after update of label on public.page_versions
  for each row
  when (old.label is not null and old.label is distinct from new.label)
  execute function private.page_versions_keep_label();
