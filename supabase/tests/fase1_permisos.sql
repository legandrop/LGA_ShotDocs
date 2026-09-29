-- Pruebas de permisos de la fase 1. Corre entero dentro de una transacción que se deshace al final:
-- no deja usuarios ni datos. Si algo falla, corta con un error que dice qué. Si todo pasa, devuelve
-- una fila con result = 'ok'. Se corre con `node scripts/db-migrate.mjs --test`.

begin;

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-00000000000a', 'rls-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000b', 'rls-b@test.invalid', 'authenticated', 'authenticated');

-- Usuario A: su espacio, una raíz y una hija, y un update de contenido.
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select set_config('test.ws_a', public.ensure_workspace()::text, true);

insert into public.pages (id, workspace_id, title, sort_key) values
  ('00000000-0000-4000-8000-0000000000a1', current_setting('test.ws_a')::uuid, 'Raíz A', 'a0');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-0000000000a2', current_setting('test.ws_a')::uuid,
   '00000000-0000-4000-8000-0000000000a1', 'Hija A', 'a0');

-- Crear con upsert (así lo hace la app) y reintentar no falla.
insert into public.pages (id, workspace_id, title, sort_key) values
  ('00000000-0000-4000-8000-0000000000a3', current_setting('test.ws_a')::uuid, 'Upsert A', 'a1')
on conflict (id) do nothing;
insert into public.pages (id, workspace_id, title, sort_key) values
  ('00000000-0000-4000-8000-0000000000a3', current_setting('test.ws_a')::uuid, 'Upsert A', 'a1')
on conflict (id) do nothing
returning id;

do $$
declare
  a1 constant uuid := '00000000-0000-4000-8000-0000000000a1';
  a2 constant uuid := '00000000-0000-4000-8000-0000000000a2';
  c1 constant uuid := '00000000-0000-4000-8000-0000000000c1';
begin
  assert public.ensure_workspace() = current_setting('test.ws_a')::uuid,
    'ensure_workspace no es estable';

  assert public.push_page_update(a1, c1, encode('hola'::bytea, 'base64')) = 1, 'primer seq';
  assert public.push_page_update(a1, c1, encode('hola'::bytea, 'base64')) = 1,
    'reintentar con el mismo client_update_id duplicó el update';
  assert (select update_seq from public.pages where id = a1) = 1, 'update_seq no avanzó';
  assert public.push_page_update(a1, gen_random_uuid(), encode('chau'::bytea, 'base64')) = 2,
    'segundo seq';
  assert (select count(*) from public.pull_page_updates(a1, 0)) = 2, 'pull desde 0';
  assert (select update from public.pull_page_updates(a1, 1)) = encode('chau'::bytea, 'base64'),
    'pull desde 1';

  begin
    update public.pages set parent_id = a2 where id = a1;
    raise exception 'FALLA: se permitió un ciclo en el árbol';
  exception when check_violation then null;
  end;

  begin
    update public.pages set parent_id = a1 where id = a1;
    raise exception 'FALLA: una página quedó como su propio padre';
  exception when check_violation then null;
  end;

  begin
    update public.pages set update_seq = 99 where id = a1;
    raise exception 'FALLA: update_seq se puede editar desde la API';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.page_updates (page_id, seq, client_update_id, update)
    values (a1, 50, gen_random_uuid(), 'x');
    raise exception 'FALLA: page_updates acepta inserts directos';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.page_updates where page_id = a1;
    raise exception 'FALLA: page_updates acepta borrados';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.pages where id = a2;
    raise exception 'FALLA: se puede borrar una página desde la API';
  exception when insufficient_privilege then null;
  end;

  insert into storage.objects (bucket_id, name)
  values ('page-files', a1::text || '/00000000-0000-4000-8000-0000000000f1.png');
  assert (select count(*) from storage.objects where bucket_id = 'page-files') = 1,
    'A no ve su archivo';

  begin
    insert into storage.objects (bucket_id, name) values ('page-files', 'sin-pagina/x.png');
    raise exception 'FALLA: se sube un archivo fuera de una página';
  exception when insufficient_privilege then null;
  end;

  update public.pages set deleted_at = now() where id = a2;
  update public.pages set deleted_at = null, title = 'Hija A (restaurada)' where id = a2;
  assert (select title from public.pages where id = a2) = 'Hija A (restaurada)', 'renombrar';
end;
$$;

-- Usuario B: no ve ni toca nada de A.
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
select set_config('test.ws_b', public.ensure_workspace()::text, true);

do $$
declare
  a1   constant uuid := '00000000-0000-4000-8000-0000000000a1';
  ws_a constant uuid := current_setting('test.ws_a')::uuid;
  ws_b constant uuid := current_setting('test.ws_b')::uuid;
  n int;
begin
  assert ws_a <> ws_b, 'A y B comparten espacio';
  assert (select count(*) from public.workspaces) = 1, 'B ve espacios ajenos';
  assert (select count(*) from public.pages) = 0, 'B ve páginas de A';
  assert (select count(*) from public.page_updates) = 0, 'B ve updates de A';

  begin
    insert into public.pages (id, workspace_id, sort_key) values (gen_random_uuid(), ws_a, 'a0');
    raise exception 'FALLA: B crea páginas en el espacio de A';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.pages (id, workspace_id, parent_id, sort_key)
    values (gen_random_uuid(), ws_b, a1, 'a0');
    raise exception 'FALLA: B cuelga una página de una página de A';
  exception when foreign_key_violation then null;
  end;

  update public.pages set title = 'hackeada' where id = a1;
  get diagnostics n = row_count;
  assert n = 0, 'B renombra páginas de A';

  begin
    perform public.push_page_update(a1, gen_random_uuid(), encode('x'::bytea, 'base64'));
    raise exception 'FALLA: B escribe contenido en páginas de A';
  exception when no_data_found then null;
  end;

  assert (select count(*) from storage.objects where bucket_id = 'page-files') = 0,
    'B ve archivos de A';

  begin
    insert into storage.objects (bucket_id, name)
    values ('page-files', a1::text || '/00000000-0000-4000-8000-0000000000f2.png');
    raise exception 'FALLA: B sube archivos a páginas de A';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.pull_page_updates(a1, 0);
    raise exception 'FALLA: B lee contenido de páginas de A';
  exception when no_data_found then null;
  end;
end;
$$;

-- Sin sesión: nada.
select set_config('role', 'anon', true);

do $$
begin
  begin
    perform 1 from public.pages;
    raise exception 'FALLA: anon lee pages';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.ensure_workspace();
    raise exception 'FALLA: anon llama a ensure_workspace';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;

select 'ok' as result;
