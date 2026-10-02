-- Pruebas de quién cambia la política del asistente (`set_assistant_policy`, 20261017120000_asistente_politica_ventana.sql;
-- Docs/Doc_Asistente.md, 7.3). Corre dentro de una transacción que se deshace al final: no deja usuarios ni datos.
-- Si todo pasa, devuelve una fila con result = 'ok'.

begin;

create function pg_temp.as_user(uid uuid, amr text default 'otp') returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated',
                                      'amr', json_build_array(json_build_object('method', amr)))::text, true),
         set_config('request.headers', '{"x-shotdocs-version":"9.999"}', true);
$$;

create function pg_temp.as_postgres() returns void language sql as $$
  select set_config('role', 'postgres', true);
$$;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-0000000000b1', 'politica-admin@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b2', 'politica-miembro@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b3', 'politica-invitado@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b4', 'politica-sacado@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b5', 'politica-nadie@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role, removed_at) values
  ('00000000-0000-4000-8000-0000000000b1', 'admin', null),
  ('00000000-0000-4000-8000-0000000000b2', 'member', null),
  ('00000000-0000-4000-8000-0000000000b3', 'guest', null),
  ('00000000-0000-4000-8000-0000000000b4', 'admin', now());

-- La prueba arranca en `on` (la base real puede tener otra; se deshace al final).
update public.workspace_settings set assistant_policy = 'on';

-- El dueño del workspace (el de la fila de miembros; la prueba lo usa solo dentro de esta transacción).
select set_config('test.owner', (select m.user_id::text from public.members m where m.role = 'owner' and m.removed_at is null limit 1), true);
do $$
begin
  assert current_setting('test.owner', true) is not null and current_setting('test.owner', true) <> '', 'la base no tiene dueño';
end;
$$;

-- El dueño la cambia a los tres valores.
select pg_temp.as_user(current_setting('test.owner')::uuid);
do $$
begin
  assert public.set_assistant_policy('off') = 'off', 'el dueño no la apaga';
  assert (select assistant_policy from public.workspace_settings) = 'off', 'no quedó en off';
  assert public.set_assistant_policy('local_only') = 'local_only', 'el dueño no pone local_only';
  assert public.set_assistant_policy('on') = 'on', 'el dueño no la prende';
  -- Un valor que no es de los tres, o null: nada cambia.
  begin
    perform public.set_assistant_policy('cualquiera');
    raise exception 'FALLA: acepta un valor desconocido';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.set_assistant_policy(null);
    raise exception 'FALLA: acepta null';
  exception when invalid_parameter_value then null;
  end;
  assert (select assistant_policy from public.workspace_settings) = 'on', 'un valor inválido cambió la política';
  -- La función no abre la fila: el dueño sigue sin poder escribirla directo.
  begin
    update public.workspace_settings set assistant_policy = 'off';
    raise exception 'FALLA: el dueño escribe la fila directo';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Un admin también.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1');
do $$
begin
  assert public.set_assistant_policy('off') = 'off', 'un admin no la apaga';
  assert (select assistant_policy from public.workspace_settings) = 'off', 'lo del admin no quedó';
end;
$$;

-- Los casos negativos: ninguno la cambia y queda en `off`.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b2');
do $$
begin
  perform public.set_assistant_policy('on');
  raise exception 'FALLA: un miembro cambia la política';
exception when insufficient_privilege then null;
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-0000000000b3');
do $$
begin
  perform public.set_assistant_policy('on');
  raise exception 'FALLA: un invitado cambia la política';
exception when insufficient_privilege then null;
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-0000000000b4');
do $$
begin
  perform public.set_assistant_policy('on');
  raise exception 'FALLA: un admin sacado del workspace cambia la política';
exception when insufficient_privilege then null;
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-0000000000b5');
do $$
begin
  perform public.set_assistant_policy('on');
  raise exception 'FALLA: alguien que no es miembro cambia la política';
exception when insufficient_privilege then null;
end;
$$;

-- Un admin que entró con contraseña (no es una sesión de la app): tampoco.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1', 'password');
do $$
begin
  perform public.set_assistant_policy('on');
  raise exception 'FALLA: una sesión con contraseña cambia la política';
exception when insufficient_privilege then null;
end;
$$;

-- Quien no entró no la puede llamar.
select set_config('role', 'anon', true);
do $$
begin
  perform public.set_assistant_policy('on');
  raise exception 'FALLA: anon cambia la política';
exception when insufficient_privilege then null;
end;
$$;

select pg_temp.as_postgres();
do $$
begin
  assert (select assistant_policy from public.workspace_settings) = 'off', 'un caso negativo cambió la política';
  -- Solo el dueño de la función y `authenticated` la ejecutan.
  assert not has_function_privilege('anon', 'public.set_assistant_policy(text)', 'execute'), 'anon puede ejecutarla';
  assert has_function_privilege('authenticated', 'public.set_assistant_policy(text)', 'execute'), 'authenticated no puede ejecutarla';
  assert (select prosecdef from pg_proc where oid = 'public.set_assistant_policy(text)'::regprocedure), 'no es security definer';
end;
$$;

rollback;

select 'ok' as result;
