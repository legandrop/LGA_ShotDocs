-- Versiones con nombre del historial de una página (P.18, entrega 3; Docs/Doc_Historial.md, secciones 1.2, 1.4 y 9).
--
-- Una versión con nombre es solo un nombre que apunta a una fila de `page_updates` (su `seq`): el contenido se sigue
-- armando de las filas en el dispositivo, no se guarda nada más. Agrega:
--
--   - `page_versions`: los nombres (`kind = 'named'`) y las marcas de restauración (`kind = 'restore'`: la fila que
--     subió una restauración y de qué versión venía, para mostrar "Restored from <fecha>"). Sin acceso directo desde
--     la API: todo por funciones. Nunca se borra una fila: sacar el nombre pone `removed_at`.
--   - `list_page_versions(page)`: los nombres y las marcas vigentes de una página.
--   - `name_page_version(id, page, seq, label)`, `rename_page_version(id, label)`, `remove_page_version(id)` y
--     `mark_page_restored(id, page, seq, from_seq)`.
--
-- Permisos: los del historial (`private.check_history`, 20261007120000_historial.sql): quien puede editar la página
-- (nivel 3 o más), no invitado (aunque tenga Editar), ni la página ni una de arriba en la papelera (con la regla de la
-- papelera de 20261009120000_papelera_lectores.sql). Renombrar y sacar un nombre: quien lo puso o quien tiene nivel 4
-- sobre la página. La marca de restauración solo sobre una fila que subió la misma persona.
--
-- Copias de seguridad restauradas: después de restaurar una copia, el servidor vuelve a usar los mismos `seq` para
-- filas distintas. Cada nombre guarda el `id` de su fila (`update_id`) y se muestra solo si esa fila sigue teniendo ese
-- `id`.
--
-- Versión mínima (B.17): las cuatro funciones que escriben miran el header `x-shotdocs-version`
-- (`private.require_session_write_version`, 20261008120000_version_minima_arbol.sql) antes de escribir; repetir algo
-- que ya está no escribe y no lo mira.
--
-- Compatible con la app y el portero publicados: no toca `page_updates`, `push_page_update`, `pull_page_updates`,
-- `page_history` ni ninguna fila; una versión anterior de la app no sabe de `page_versions` y sigue igual.
--
-- OJO al publicar: `schema_version` 13 da por hecho que 20261010120000_privacidad_borrado.sql (que sube a 12) sale
-- antes. La app lo compara con `NAMED_VERSIONS_SCHEMA_VERSION` (src/sync/history.ts): si cambia acá, cambia allá.

create table public.page_versions (
  -- Lo crea el dispositivo: reintentar no duplica.
  id                uuid primary key,
  page_id           uuid not null references public.pages (id) on delete cascade,
  seq               bigint not null check (seq > 0),
  -- `page_updates.id` de la fila `seq` al nombrarla: si después de restaurar una copia esa fila es otra, no se muestra.
  update_id         bigint not null,
  kind              text not null check (kind in ('named', 'restore')),
  -- El nombre (solo `named`).
  label             text,
  -- `restore`: el `seq` de la versión que se restauró.
  restored_from_seq bigint,
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  -- Sacar el nombre: nunca borrado duro.
  removed_at        timestamptz,
  removed_by        uuid references auth.users (id) on delete set null,
  constraint page_versions_shape check (
    (kind = 'named' and label is not null and char_length(label) between 1 and 100 and restored_from_seq is null)
    or (kind = 'restore' and label is null and restored_from_seq is not null and restored_from_seq < seq)
  )
);

create index page_versions_page_idx on public.page_versions (page_id, seq);
-- Un solo nombre vigente por versión (dos dispositivos que nombran la misma a la vez: el segundo recibe `version_named`).
create unique index page_versions_named_once on public.page_versions (page_id, seq)
  where kind = 'named' and removed_at is null;

-- Todo por funciones: ni la sesión ni anon leen o escriben la tabla directo.
alter table public.page_versions enable row level security;
revoke all on public.page_versions from public, anon, authenticated;

-- Lo que devuelven las funciones (la misma forma en todas).
create type public.page_version_row as (
  id                uuid,
  seq               bigint,
  kind              text,
  label             text,
  restored_from_seq bigint,
  created_by        uuid,
  created_at        timestamptz
);

-- El `id` de la fila `seq` de esa página, o `null` si no existe.
create function private.page_update_id(p_page uuid, p_seq bigint)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select u.id from public.page_updates u where u.page_id = p_page and u.seq = p_seq;
$$;

-- Un nombre de versión: sin espacios de más; entre 1 y 100 letras.
create function private.version_label(p_label text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v text := btrim(regexp_replace(coalesce(p_label, ''), '\s+', ' ', 'g'));
begin
  if char_length(v) < 1 or char_length(v) > 100 then
    raise exception 'label_invalid' using errcode = '22023';
  end if;
  return v;
end;
$$;

-- ¿Puede cambiar o sacar este nombre? Quien lo puso, o nivel 4 sobre la página (además de ver el historial).
create function private.can_manage_version(p_page uuid, p_created_by uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(p_created_by = (select auth.uid()), false) or private.page_level(p_page) >= 4;
$$;

revoke all on function private.page_update_id(uuid, bigint) from public, anon, authenticated;
revoke all on function private.version_label(text) from public, anon, authenticated;
revoke all on function private.can_manage_version(uuid, uuid) from public, anon, authenticated;

-- Los nombres y las marcas de restauración vigentes de una página, en orden: solo los que apuntan a una fila que
-- sigue siendo la misma (`update_id`).
create function public.list_page_versions(p_page_id uuid)
returns setof public.page_version_row
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.check_history(p_page_id);
  return query
    select v.id, v.seq, v.kind, v.label, v.restored_from_seq, v.created_by, v.created_at
    from public.page_versions v
    join public.page_updates u on u.page_id = v.page_id and u.seq = v.seq and u.id = v.update_id
    where v.page_id = p_page_id and v.removed_at is null
    order by v.seq, v.created_at, v.id;
end;
$$;

-- Nombra la versión que termina en la fila `p_seq`. `p_id` lo crea el dispositivo: si ya existe y es el mismo pedido
-- (misma página, misma fila, un nombre), devuelve el que hay; si no, `version_conflict`.
create function public.name_page_version(p_id uuid, p_page_id uuid, p_seq bigint, p_label text)
returns public.page_version_row
language plpgsql security definer set search_path = ''
as $$
declare
  v      public.page_versions;
  lbl    text;
  upd_id bigint;
  res    public.page_version_row;
begin
  perform private.check_history(p_page_id);
  select * into v from public.page_versions where id = p_id;
  if found then
    if v.page_id is distinct from p_page_id or v.seq is distinct from p_seq or v.kind <> 'named' then
      raise exception 'version_conflict' using errcode = 'P0001';
    end if;
  else
    lbl := private.version_label(p_label);
    upd_id := private.page_update_id(p_page_id, p_seq);
    if upd_id is null then
      raise exception 'version_not_found' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.page_versions x
               where x.page_id = p_page_id and x.seq = p_seq and x.kind = 'named' and x.removed_at is null) then
      raise exception 'version_named' using errcode = 'P0001';
    end if;
    perform private.require_session_write_version();
    begin
      insert into public.page_versions (id, page_id, seq, update_id, kind, label)
      values (p_id, p_page_id, p_seq, upd_id, 'named', lbl)
      returning * into v;
    exception when unique_violation then
      raise exception 'version_named' using errcode = 'P0001';
    end;
  end if;
  res := (v.id, v.seq, v.kind, v.label, v.restored_from_seq, v.created_by, v.created_at);
  return res;
end;
$$;

-- Le cambia el nombre (quien lo puso o nivel 4).
create function public.rename_page_version(p_id uuid, p_label text)
returns public.page_version_row
language plpgsql security definer set search_path = ''
as $$
declare
  v   public.page_versions;
  lbl text;
  res public.page_version_row;
begin
  select * into v from public.page_versions where id = p_id for update;
  if not found then
    raise exception 'version_not_found' using errcode = 'P0002';
  end if;
  perform private.check_history(v.page_id);
  if v.removed_at is not null then
    raise exception 'version_not_found' using errcode = 'P0002';
  end if;
  if v.kind <> 'named' then
    raise exception 'version_not_named' using errcode = 'P0001';
  end if;
  if not private.can_manage_version(v.page_id, v.created_by) then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'Renaming a version needs to be who named it, or "edit and create pages" on the page.';
  end if;
  lbl := private.version_label(p_label);
  if lbl is distinct from v.label then
    perform private.require_session_write_version();
    update public.page_versions set label = lbl where id = p_id returning * into v;
  end if;
  res := (v.id, v.seq, v.kind, v.label, v.restored_from_seq, v.created_by, v.created_at);
  return res;
end;
$$;

-- Le saca el nombre (quien lo puso o nivel 4). La fila queda, con quién y cuándo. Repetirlo no hace nada.
create function public.remove_page_version(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v public.page_versions;
begin
  select * into v from public.page_versions where id = p_id for update;
  if not found then
    raise exception 'version_not_found' using errcode = 'P0002';
  end if;
  perform private.check_history(v.page_id);
  if v.kind <> 'named' then
    raise exception 'version_not_named' using errcode = 'P0001';
  end if;
  if not private.can_manage_version(v.page_id, v.created_by) then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'Removing a version name needs to be who named it, or "edit and create pages" on the page.';
  end if;
  if v.removed_at is not null then
    return;
  end if;
  perform private.require_session_write_version();
  update public.page_versions set removed_at = now(), removed_by = auth.uid() where id = p_id;
end;
$$;

-- Marca que la fila `p_seq` (subida por quien llama) es una restauración de la versión que terminaba en `p_from_seq`.
-- Repetir el mismo pedido devuelve la que hay.
create function public.mark_page_restored(p_id uuid, p_page_id uuid, p_seq bigint, p_from_seq bigint)
returns public.page_version_row
language plpgsql security definer set search_path = ''
as $$
declare
  v      public.page_versions;
  upd_id bigint;
  res    public.page_version_row;
begin
  perform private.check_history(p_page_id);
  select * into v from public.page_versions where id = p_id;
  if found then
    if v.page_id is distinct from p_page_id or v.seq is distinct from p_seq or v.kind <> 'restore'
       or v.restored_from_seq is distinct from p_from_seq then
      raise exception 'version_conflict' using errcode = 'P0001';
    end if;
  else
    if p_from_seq is null or p_seq is null or p_from_seq >= p_seq
       or private.page_update_id(p_page_id, p_from_seq) is null then
      raise exception 'version_not_found' using errcode = 'P0002';
    end if;
    select u.id into upd_id from public.page_updates u
    where u.page_id = p_page_id and u.seq = p_seq and u.created_by = (select auth.uid());
    if upd_id is null then
      raise exception 'version_not_found' using errcode = 'P0002';
    end if;
    perform private.require_session_write_version();
    insert into public.page_versions (id, page_id, seq, update_id, kind, restored_from_seq)
    values (p_id, p_page_id, p_seq, upd_id, 'restore', p_from_seq)
    returning * into v;
  end if;
  res := (v.id, v.seq, v.kind, v.label, v.restored_from_seq, v.created_by, v.created_at);
  return res;
end;
$$;

revoke all on function public.list_page_versions(uuid) from public, anon;
revoke all on function public.name_page_version(uuid, uuid, bigint, text) from public, anon;
revoke all on function public.rename_page_version(uuid, text) from public, anon;
revoke all on function public.remove_page_version(uuid) from public, anon;
revoke all on function public.mark_page_restored(uuid, uuid, bigint, bigint) from public, anon;
grant execute on function public.list_page_versions(uuid) to authenticated;
grant execute on function public.name_page_version(uuid, uuid, bigint, text) to authenticated;
grant execute on function public.rename_page_version(uuid, text) to authenticated;
grant execute on function public.remove_page_version(uuid) to authenticated;
grant execute on function public.mark_page_restored(uuid, uuid, bigint, bigint) to authenticated;

update public.workspace_settings set schema_version = 13 where id and schema_version < 13;

notify pgrst, 'reload schema';
