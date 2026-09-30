-- LGA Shot Docs · ajustes del workspace: generación de la base, versión mínima de la app y versión de la
-- base. Ver Docs/Plan_Workspaces.md (secciones 7 y 10).

-- Una sola fila. La app la lee en cada sincronización; nadie la cambia desde la app.
--   generation      Sube cuando se restaura una copia de seguridad (lo hace scripts/restore.sh del repo de
--                   copias). Cada dispositivo que ve el cambio vuelve a subir todo lo suyo: los proyectos
--                   y páginas que el servidor ya no tiene, el contenido entero y las imágenes.
--   min_app_version Versión mínima de la app (como en el changelog: 0.021) que puede subir contenido.
--                   Null: cualquiera. Sirve para que una versión vieja, que borra lo que no conoce, no pueda
--                   mandar ese borrado a los demás.
--   schema_version  Versión de la base. Sube con las migraciones que cambian lo que la app necesita.
create table public.workspace_settings (
  id              boolean primary key default true check (id),
  generation      integer not null default 1 check (generation > 0),
  min_app_version numeric(8, 3) check (min_app_version >= 0),
  schema_version  integer not null default 1 check (schema_version > 0),
  updated_at      timestamptz not null default now()
);

insert into public.workspace_settings default values;

alter table public.workspace_settings enable row level security;

create policy workspace_settings_select on public.workspace_settings
  for select to authenticated using (true);

revoke all on public.workspace_settings from public, anon, authenticated;
grant select on public.workspace_settings to authenticated;

-- ¿Esta versión de la app puede subir contenido? Sin fila o sin mínimo, sí. Una versión que no se puede
-- leer (o ninguna, como mandan las versiones anteriores a esta migración) no, si hay mínimo.
create function private.app_version_allowed(p_version text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when not exists (select 1 from public.workspace_settings where id) then true
    else (
      select s.min_app_version is null
             or case when p_version ~ '^[0-9]{1,4}(\.[0-9]{1,3})?$'
                     then p_version::numeric >= s.min_app_version
                     else false end
      from public.workspace_settings s
      where s.id)
  end;
$$;

revoke all on function private.app_version_allowed(text) from public, anon;
grant execute on function private.app_version_allowed(text) to authenticated;

-- Guarda un update de Yjs (en base64) y devuelve su `seq`, como antes, pero sabiendo qué versión de la app
-- lo manda. Reintentar con el mismo client_update_id devuelve el mismo `seq` sin duplicar nada.
create function public.push_page_update(
  p_page_id uuid, p_client_update_id uuid, p_update text, p_app_version text)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  s   bigint;
  bin bytea;
begin
  if not private.can_edit_page(p_page_id) then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  if not private.app_version_allowed(p_app_version) then
    raise exception 'app_outdated' using errcode = 'P0001',
      hint = 'This version of the app is too old for this workspace. Reload the app to update it.';
  end if;

  perform 1 from public.pages where id = p_page_id for update;

  select seq into s from public.page_updates
  where page_id = p_page_id and client_update_id = p_client_update_id;
  if found then
    return s;
  end if;

  bin := decode(p_update, 'base64');
  if length(bin) = 0 or length(bin) > 8 * 1024 * 1024 then
    raise exception 'update_size_invalid' using errcode = '22023';
  end if;

  update public.pages set update_seq = update_seq + 1 where id = p_page_id returning update_seq into s;
  insert into public.page_updates (page_id, seq, client_update_id, update)
  values (p_page_id, s, p_client_update_id, bin);
  return s;
end;
$$;

-- La de siempre (la usan las versiones anteriores de la app): sin versión, así que deja de andar en cuanto
-- el workspace pide una mínima.
create or replace function public.push_page_update(p_page_id uuid, p_client_update_id uuid, p_update text)
returns bigint
language sql security definer set search_path = ''
as $$
  select public.push_page_update(p_page_id, p_client_update_id, p_update, null::text);
$$;

revoke all on function public.push_page_update(uuid, uuid, text, text) from public, anon;
grant execute on function public.push_page_update(uuid, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
