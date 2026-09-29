-- LGA Shot Docs · fase 1: espacios, árbol de páginas y contenido sincronizado.
--
-- Todo el acceso pasa por Row Level Security. Las funciones auxiliares viven en el esquema `private`,
-- que la API no expone. El contenido de cada página es una lista de updates de Yjs que solo se agrega:
-- nunca se reescribe ni se borra.

create schema if not exists private;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------------------------------

create table public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  name       text not null default 'Mis documentos',
  created_at timestamptz not null default now()
);
create index workspaces_owner_idx on public.workspaces (owner_id);

create table public.pages (
  id           uuid primary key default gen_random_uuid(), -- lo genera el dispositivo
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  parent_id    uuid references public.pages (id),
  title        text not null default '' check (length(title) <= 500),
  icon         text check (length(icon) <= 32),
  sort_key     text collate "C" not null,                  -- índice fraccionario, orden por bytes
  template_id  uuid,                                        -- la FK llega con las plantillas (fase 3)
  update_seq   bigint not null default 0,                   -- último `seq` de page_updates
  deleted_at   timestamptz,                                 -- papelera
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index pages_workspace_idx on public.pages (workspace_id);
create index pages_parent_idx on public.pages (parent_id);

-- Solo agregado. `seq` es correlativo por página y se asigna con la fila de la página bloqueada, así que
-- el orden de `seq` es el orden de commit: bajar "lo posterior a seq N" nunca se saltea nada.
create table public.page_updates (
  id               bigint generated always as identity primary key,
  page_id          uuid not null references public.pages (id) on delete cascade,
  seq              bigint not null,
  client_update_id uuid not null,
  update           bytea not null,
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (page_id, seq),
  unique (page_id, client_update_id)
);

-- ---------------------------------------------------------------------------------------------------
-- Permisos: funciones auxiliares
-- ---------------------------------------------------------------------------------------------------

create function private.is_workspace_owner(ws uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.workspaces w where w.id = ws and w.owner_id = (select auth.uid())
  );
$$;

-- En la fase 1 solo el dueño del espacio ve y edita. La fase 2 suma acá los shares de la página y de
-- sus ancestros; las políticas y las funciones que llaman a estas dos no cambian.
create function private.can_view_page(p uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.pages pg
    join public.workspaces w on w.id = pg.workspace_id
    where pg.id = p and w.owner_id = (select auth.uid())
  );
$$;

create function private.can_edit_page(p uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_view_page(p);
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Integridad del árbol
-- ---------------------------------------------------------------------------------------------------

-- El padre tiene que estar en el mismo espacio y el movimiento no puede armar un ciclo. Corre como
-- definer para recorrer los ancestros aunque el usuario no pueda verlos todos (fase 2).
create function private.pages_check_tree()
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
    if (new.title, new.icon, new.parent_id, new.sort_key, new.deleted_at, new.template_id)
       is distinct from
       (old.title, old.icon, old.parent_id, old.sort_key, old.deleted_at, old.template_id) then
      new.updated_at := now();
    end if;
  end if;

  if new.parent_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.parent_id is not distinct from old.parent_id then
    return new;
  end if;

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

create trigger pages_check_tree
before insert or update on public.pages
for each row execute function private.pages_check_tree();

-- ---------------------------------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.pages enable row level security;
alter table public.page_updates enable row level security;

create policy workspaces_select on public.workspaces
  for select to authenticated using (owner_id = (select auth.uid()));
create policy workspaces_update on public.workspaces
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy pages_select on public.pages
  for select to authenticated using (private.can_view_page(id));
create policy pages_insert on public.pages
  for insert to authenticated with check (private.is_workspace_owner(workspace_id));
create policy pages_update on public.pages
  for update to authenticated
  using (private.can_edit_page(id)) with check (private.can_edit_page(id));

create policy page_updates_select on public.page_updates
  for select to authenticated using (private.can_view_page(page_id));

-- Privilegios por columna: la app solo toca lo que el usuario puede cambiar. Nada se borra desde la
-- API y page_updates solo se escribe con push_page_update().
revoke all on public.workspaces, public.pages, public.page_updates from anon, authenticated;
grant select on public.workspaces to authenticated;
grant update (name) on public.workspaces to authenticated;
grant select on public.pages to authenticated;
grant insert (id, workspace_id, parent_id, title, icon, sort_key, template_id) on public.pages
  to authenticated;
grant update (parent_id, title, icon, sort_key, deleted_at, template_id) on public.pages
  to authenticated;
grant select on public.page_updates to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- API (RPC)
-- ---------------------------------------------------------------------------------------------------

-- Devuelve el espacio del usuario y lo crea la primera vez.
create function public.ensure_workspace()
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  ws  uuid;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ensure_workspace:' || uid::text, 0));
  select id into ws from public.workspaces where owner_id = uid order by created_at limit 1;
  if ws is null then
    insert into public.workspaces (owner_id) values (uid) returning id into ws;
  end if;
  return ws;
end;
$$;

-- Guarda un update de Yjs (en base64) y devuelve su `seq`. Reintentar con el mismo client_update_id
-- devuelve el mismo `seq` sin duplicar nada.
create function public.push_page_update(p_page_id uuid, p_client_update_id uuid, p_update text)
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

-- Devuelve los updates de una página posteriores a `p_after_seq`, en orden, en base64.
create function public.pull_page_updates(p_page_id uuid, p_after_seq bigint, p_limit int default 200)
returns table (seq bigint, update text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.can_view_page(p_page_id) then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  return query
    select u.seq, translate(encode(u.update, 'base64'), E'\n', '')
    from public.page_updates u
    where u.page_id = p_page_id and u.seq > p_after_seq
    order by u.seq
    limit least(greatest(p_limit, 1), 1000);
end;
$$;

revoke all on function public.ensure_workspace() from public, anon;
revoke all on function public.push_page_update(uuid, uuid, text) from public, anon;
revoke all on function public.pull_page_updates(uuid, bigint, int) from public, anon;
grant execute on function public.ensure_workspace() to authenticated;
grant execute on function public.push_page_update(uuid, uuid, text) to authenticated;
grant execute on function public.pull_page_updates(uuid, bigint, int) to authenticated;
