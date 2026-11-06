-- Pruebas del color de los proyectos (20261117120000_proyecto_color.sql): lo cambia quien puede renombrar el proyecto
-- (nivel 4), no quien solo lo edita; solo acepta `#rrggbb` en minúsculas o null; lo leen todos los que ven el proyecto;
-- y no abre la escritura de otras columnas. Corre dentro de una transacción que se deshace al final: no deja usuarios ni
-- datos. Si todo pasa, devuelve una fila con result = 'ok'.

begin;

select set_config('request.headers', '{"x-shotdocs-version": "9.999"}', true);

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-00000000000a', 'rls-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000b', 'rls-b@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000c', 'rls-c@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000d', 'rls-d@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'admin'),
  ('00000000-0000-4000-8000-00000000000b', 'member'),
  ('00000000-0000-4000-8000-00000000000c', 'member'),
  ('00000000-0000-4000-8000-00000000000d', 'member');
insert into public.workspaces (id, owner_id, name) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a', 'Uno');
-- B edita el contenido de todo el proyecto (nivel 3: sin crear páginas ni renombrarlo); C no tiene nada.
insert into public.grants (user_id, project_id, page_id, level) values
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000e1', null, 'edit'),
  -- D no es dueño, pero crea páginas en todo el proyecto (nivel 4): lo puede renombrar, y cambiar su color.
  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-0000000000e1', null, 'edit_pages');

-- El dueño elige un color y lo vuelve a sacar.
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
do $$
declare
  e1 constant uuid := '00000000-0000-4000-8000-0000000000e1';
begin
  assert (select color from public.workspaces where id = e1) is null, 'un proyecto nuevo ya tiene color';
  update public.workspaces set color = '#2e5a8e' where id = e1;
  assert (select color from public.workspaces where id = e1) = '#2e5a8e', 'el dueño no pudo elegir el color';

  begin
    update public.workspaces set color = '#2E5A8E' where id = e1;
    raise exception 'FALLA: el color acepta mayúsculas';
  exception when check_violation then null;
  end;
  begin
    update public.workspaces set color = 'red' where id = e1;
    raise exception 'FALLA: el color acepta un nombre';
  exception when check_violation then null;
  end;
  begin
    update public.workspaces set color = '#2e5a8e; background:url(x)' where id = e1;
    raise exception 'FALLA: el color acepta texto de más';
  exception when check_violation then null;
  end;

  -- La columna nueva no abre otras: `owner_id` sigue sin poder escribirse.
  begin
    update public.workspaces set owner_id = '00000000-0000-4000-8000-00000000000b' where id = e1;
    raise exception 'FALLA: owner_id se puede escribir';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- B lo ve pero no lo puede cambiar (la política de nivel 4 deja la fila afuera del update: 0 filas).
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
do $$
declare
  e1 constant uuid := '00000000-0000-4000-8000-0000000000e1';
  n int;
begin
  assert (select color from public.workspaces where id = e1) = '#2e5a8e', 'quien ve el proyecto no ve su color';
  update public.workspaces set color = '#8e2e5a' where id = e1;
  get diagnostics n = row_count;
  assert n = 0, 'quien solo edita el proyecto pudo cambiar el color';
end;
$$;

-- D (nivel 4 sin ser dueño) sí lo cambia.
select pg_temp.as_user('00000000-0000-4000-8000-00000000000d');
do $$
declare
  e1 constant uuid := '00000000-0000-4000-8000-0000000000e1';
  n int;
begin
  update public.workspaces set color = '#443a91' where id = e1;
  get diagnostics n = row_count;
  assert n = 1, 'quien crea páginas en todo el proyecto no pudo cambiar el color';
  update public.workspaces set color = '#2e5a8e' where id = e1;
end;
$$;

-- C no lo ve ni lo cambia.
select pg_temp.as_user('00000000-0000-4000-8000-00000000000c');
do $$
declare
  e1 constant uuid := '00000000-0000-4000-8000-0000000000e1';
  n int;
begin
  assert (select count(*) from public.workspaces where id = e1) = 0, 'quien no tiene nada ve el proyecto';
  update public.workspaces set color = '#8e2e5a' where id = e1;
  get diagnostics n = row_count;
  assert n = 0, 'quien no tiene nada pudo cambiar el color';
end;
$$;

select set_config('role', 'postgres', true);
do $$
begin
  assert (select color from public.workspaces where id = '00000000-0000-4000-8000-0000000000e1') = '#2e5a8e',
    'el color cambió sin permiso';
  assert (select schema_version from public.workspace_settings where id) >= 27, 'schema_version no llegó a 27';
end;
$$;

rollback;

select 'ok' as result;
