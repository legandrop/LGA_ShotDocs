-- LGA Shot Docs · ajustes: por rama (en cada página, heredados por las de adentro) y por cuenta.

-- Ajustes de una página que valen también para las páginas de adentro, salvo que alguna defina los suyos
-- (encabezado con los contenedores, títulos divididos por "|"). Es un objeto chico: la app lo reemplaza
-- entero en cada cambio.
alter table public.pages
  add column settings jsonb not null default '{}'::jsonb;
alter table public.pages
  add constraint pages_settings_shape
  check (jsonb_typeof(settings) = 'object' and length(settings::text) <= 2000);

grant insert (settings) on public.pages to authenticated;
grant update (settings) on public.pages to authenticated;

-- El trigger del árbol también marca `updated_at` cuando cambian los ajustes.
create or replace function private.pages_check_tree()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  cur   uuid := new.parent_id;
  depth int  := 0;
begin
  if tg_op = 'UPDATE' then
    new.workspace_id := old.workspace_id;
    new.created_by   := old.created_by;
    new.created_at   := old.created_at;
    if (new.title, new.icon, new.parent_id, new.sort_key, new.deleted_at, new.template_id, new.settings)
       is distinct from
       (old.title, old.icon, old.parent_id, old.sort_key, old.deleted_at, old.template_id, old.settings) then
      new.updated_at := now();
    end if;
  end if;

  if new.parent_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.parent_id is not distinct from old.parent_id then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('pages_tree:' || new.workspace_id::text, 0));

  if not exists (
    select 1 from public.pages where id = new.parent_id and workspace_id = new.workspace_id
  ) then
    raise exception 'page_parent_invalid' using errcode = '23503';
  end if;

  while cur is not null loop
    if cur = new.id then
      raise exception 'page_cycle' using errcode = '23514';
    end if;
    depth := depth + 1;
    if depth > 10000 then
      raise exception 'page_cycle' using errcode = '23514';
    end if;
    select parent_id into cur from public.pages where id = cur;
  end loop;
  return new;
end;
$$;

revoke all on function private.pages_check_tree() from public, anon, authenticated;

-- Preferencias de cada cuenta (tema, fuente, tamaño del texto, ancho de página): siguen al usuario en
-- todos sus dispositivos. Una fila por usuario; cada uno ve y cambia solo la suya.
create table public.user_settings (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  prefs      jsonb not null default '{}'::jsonb
             check (jsonb_typeof(prefs) = 'object' and length(prefs::text) <= 4000),
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy user_settings_select on public.user_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy user_settings_insert on public.user_settings
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy user_settings_update on public.user_settings
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.user_settings from anon, authenticated;
grant select on public.user_settings to authenticated;
grant insert (user_id, prefs) on public.user_settings to authenticated;
grant update (prefs) on public.user_settings to authenticated;

create function private.user_settings_touch()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.user_settings_touch() from public, anon, authenticated;

create trigger user_settings_touch
before update on public.user_settings
for each row execute function private.user_settings_touch();
