-- Pruebas de permisos de los proyectos. Corre dentro de una transacción que se deshace al final: no deja
-- usuarios ni datos. Si todo pasa, devuelve una fila con result = 'ok'.

begin;

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-00000000000a', 'rls-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000b', 'rls-b@test.invalid', 'authenticated', 'authenticated');

-- A: su primer proyecto y uno nuevo creado con el id del dispositivo (dos veces, como un reintento).
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select set_config('test.ws_a', public.ensure_workspace()::text, true);

insert into public.workspaces (id, name) values ('00000000-0000-4000-8000-0000000000f1', 'Bosque Negro')
on conflict (id) do nothing;
insert into public.workspaces (id, name) values ('00000000-0000-4000-8000-0000000000f1', 'Bosque Negro')
on conflict (id) do nothing;

insert into public.pages (id, workspace_id, title, sort_key) values
  ('00000000-0000-4000-8000-0000000000a1', current_setting('test.ws_a')::uuid, 'Raíz del primero', 'a0'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000f1', 'Raíz del segundo', 'a0');

do $$
declare
  f1 constant uuid := '00000000-0000-4000-8000-0000000000f1';
begin
  assert (select count(*) from public.workspaces) = 2, 'A no ve sus dos proyectos';
  assert (select owner_id from public.workspaces where id = f1) = '00000000-0000-4000-8000-00000000000a',
    'el dueño del proyecto nuevo no es quien lo creó';
  assert (select name from public.workspaces where id = current_setting('test.ws_a')::uuid) = 'My project',
    'el primer proyecto no tiene el nombre de fábrica';

  update public.workspaces set name = 'MGTZD' where id = current_setting('test.ws_a')::uuid;
  assert (select name from public.workspaces where id = current_setting('test.ws_a')::uuid) = 'MGTZD',
    'A no puede renombrar su proyecto';

  begin
    insert into public.workspaces (id, name, owner_id)
    values (gen_random_uuid(), 'Ajeno', '00000000-0000-4000-8000-00000000000b');
    raise exception 'FALLA: se puede elegir el dueño de un proyecto';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.workspaces set owner_id = '00000000-0000-4000-8000-00000000000b' where id = f1;
    raise exception 'FALLA: se puede cambiar el dueño de un proyecto';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.workspaces where id = f1;
    raise exception 'FALLA: se puede borrar un proyecto desde la API';
  exception when insufficient_privilege then null;
  end;

  -- Una página no cambia de proyecto: ni moviéndola abajo de una página de otro ni tocando la columna.
  begin
    update public.pages set parent_id = '00000000-0000-4000-8000-0000000000a2'
    where id = '00000000-0000-4000-8000-0000000000a1';
    raise exception 'FALLA: una página pasó abajo de otra de otro proyecto';
  exception when foreign_key_violation then null;
  end;

  begin
    update public.pages set workspace_id = f1 where id = '00000000-0000-4000-8000-0000000000a1';
    raise exception 'FALLA: se puede cambiar el proyecto de una página';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- B: no ve los proyectos de A ni crea páginas en ellos.
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');

do $$
begin
  assert (select count(*) from public.workspaces) = 0, 'B ve proyectos de A';
  assert (select count(*) from public.pages) = 0, 'B ve páginas de A';

  begin
    insert into public.pages (id, workspace_id, title, sort_key)
    values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000f1', 'Intrusa', 'a0');
    raise exception 'FALLA: B crea una página en un proyecto de A';
  exception when insufficient_privilege then null;
  end;

  update public.workspaces set name = 'Robado' where id = '00000000-0000-4000-8000-0000000000f1';

  -- Reusar el id de un proyecto de A no le da acceso: el insert choca y no pasa nada.
  insert into public.workspaces (id, name) values ('00000000-0000-4000-8000-0000000000f1', 'Copia')
  on conflict (id) do nothing;
  assert (select count(*) from public.workspaces) = 0, 'B tomó un proyecto de A reusando su id';
end;
$$;

select set_config('role', 'postgres', true);

do $$
begin
  assert (select name from public.workspaces where id = '00000000-0000-4000-8000-0000000000f1') = 'Bosque Negro',
    'B renombró un proyecto de A';
end;
$$;

rollback;

select 'ok' as result;
