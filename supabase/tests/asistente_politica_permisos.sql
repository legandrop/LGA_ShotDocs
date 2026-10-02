-- Pruebas de la política del asistente (`workspace_settings.assistant_policy`, 20261014120000_asistente_politica.sql;
-- Docs/Doc_Asistente.md, 7.3). Corre dentro de una transacción que se deshace al final: no deja usuarios ni datos.
-- Si todo pasa, devuelve una fila con result = 'ok'.

begin;

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated')::text, true),
         set_config('request.headers', '{"x-shotdocs-version":"9.999"}', true);
$$;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'asistente-a@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role) values ('00000000-0000-4000-8000-0000000000a1', 'member');

-- De fábrica, `on` (también en la fila que ya existía).
do $$
begin
  assert (select assistant_policy from public.workspace_settings where id) = 'on', 'la política no arranca en on';
  assert (select column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'workspace_settings' and column_name = 'assistant_policy') = '''on''::text',
    'el valor de fábrica no es on';
end;
$$;

-- Solo los tres valores.
do $$
begin
  begin
    update public.workspace_settings set assistant_policy = 'cualquiera';
    raise exception 'FALLA: la política acepta un valor desconocido';
  exception when check_violation then null;
  end;
  begin
    update public.workspace_settings set assistant_policy = null;
    raise exception 'FALLA: la política acepta null';
  exception when not_null_violation then null;
  end;
  update public.workspace_settings set assistant_policy = 'local_only';
  update public.workspace_settings set assistant_policy = 'off';
  update public.workspace_settings set assistant_policy = 'on';
end;
$$;

-- Un miembro la lee con el resto de la fila (como la app: `select *`) y no la cambia desde la API.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
do $$
declare
  row public.workspace_settings;
begin
  select * into row from public.workspace_settings;
  assert row.assistant_policy = 'on', 'un miembro no lee la política';
  begin
    update public.workspace_settings set assistant_policy = 'off';
    raise exception 'FALLA: un miembro cambia la política';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Tampoco quien no entró.
select set_config('role', 'anon', true);
do $$
begin
  perform assistant_policy from public.workspace_settings;
  raise exception 'FALLA: anon lee la política';
exception when insufficient_privilege then null;
end;
$$;

rollback;

select 'ok' as result;
