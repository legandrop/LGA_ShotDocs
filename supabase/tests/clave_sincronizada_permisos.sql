-- Pruebas de quién lee y escribe la clave sincronizada (`assistant_key_sync`, 20261023120000_clave_sincronizada.sql;
-- Docs/Doc_Clave_Sincronizada.md, sección 5). Corre dentro de una transacción que se deshace al final: no deja usuarios
-- ni datos. Si todo pasa, devuelve una fila con result = 'ok'.

begin;

create function pg_temp.as_user(uid uuid, amr text default 'otp', client_id text default null) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    (json_build_object('sub', uid, 'role', 'authenticated',
                                       'amr', json_build_array(json_build_object('method', amr)))::jsonb
                     || case when client_id is null then '{}'::jsonb else jsonb_build_object('client_id', client_id) end)::text,
                    true),
         set_config('request.headers', '{"x-shotdocs-version":"9.999"}', true);
$$;

create function pg_temp.as_postgres() returns void language sql as $$
  select set_config('role', 'postgres', true);
$$;

-- Un bloque cifrado de mentira con los largos de verdad (16 bytes de sal, 12 de iv, 1 040 de cifrado, en base64).
create function pg_temp.sealed(c text default 'c') returns table (salt text, iv text, ciphertext text) language sql as $$
  select repeat('a', 24), repeat('b', 16), repeat(c, 1388);
$$;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-0000000000c1', 'clave-persona@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000c2', 'clave-miembro@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000c3', 'clave-admin@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role, removed_at) values
  ('00000000-0000-4000-8000-0000000000c1', 'member', null),
  ('00000000-0000-4000-8000-0000000000c2', 'member', null),
  ('00000000-0000-4000-8000-0000000000c3', 'admin', null);

-- El dueño del workspace (el de la fila de miembros; la prueba lo usa solo dentro de esta transacción).
select set_config('test.owner', (select m.user_id::text from public.members m where m.role = 'owner' and m.removed_at is null limit 1), true);
do $$
begin
  assert current_setting('test.owner', true) is not null and current_setting('test.owner', true) <> '', 'la base no tiene dueño';
end;
$$;

-- La persona crea su copia: el id lo pone la base y la generación arranca en 1.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
do $$
declare
  g bigint;
  t timestamptz;
begin
  insert into public.assistant_key_sync (format, salt, iv, ciphertext) select 1, s.salt, s.iv, s.ciphertext from pg_temp.sealed() s;
  assert (select count(*) from public.assistant_key_sync) = 1, 'la persona no ve su copia';
  select generation, updated_at into g, t from public.assistant_key_sync;
  assert g = 1, 'la copia nueva no arranca en la generación 1';
  assert (select user_id from public.assistant_key_sync) = '00000000-0000-4000-8000-0000000000c1', 'el id no es el de la sesión';

  -- Cambiarla sube la generación (el trigger) y la hora.
  update public.assistant_key_sync set ciphertext = repeat('d', 1388) where user_id = auth.uid() and generation = 1;
  assert found, 'la persona no cambia su copia';
  assert (select generation from public.assistant_key_sync) = 2, 'el trigger no subió la generación';
  -- Con la generación vieja (otro dispositivo la cambió en el medio), no cambia nada.
  update public.assistant_key_sync set ciphertext = repeat('e', 1388) where user_id = auth.uid() and generation = 1;
  assert not found, 'una escritura con la generación vieja pisó la copia';
  assert (select left(ciphertext, 1) from public.assistant_key_sync) = 'd', 'la escritura vieja cambió el cifrado';

  -- Una segunda copia de la misma persona: no.
  begin
    insert into public.assistant_key_sync (format, salt, iv, ciphertext) select 1, s.salt, s.iv, s.ciphertext from pg_temp.sealed() s;
    raise exception 'FALLA: dos copias de la misma persona';
  exception when unique_violation then null;
  end;

  -- La generación, la hora y el id no se escriben a mano.
  begin
    update public.assistant_key_sync set generation = 99;
    raise exception 'FALLA: la persona escribe la generación';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.assistant_key_sync set updated_at = now() - interval '1 year';
    raise exception 'FALLA: la persona escribe la hora';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.assistant_key_sync set user_id = '00000000-0000-4000-8000-0000000000c2';
    raise exception 'FALLA: la persona cambia el id de su copia';
  exception when insufficient_privilege then null;
  end;

  -- Los largos fijos y la versión.
  begin
    update public.assistant_key_sync set format = 2;
    raise exception 'FALLA: acepta una versión desconocida';
  exception when check_violation then null;
  end;
  begin
    update public.assistant_key_sync set salt = repeat('a', 23);
    raise exception 'FALLA: acepta una sal de otro largo';
  exception when check_violation then null;
  end;
  begin
    update public.assistant_key_sync set iv = repeat('b', 17);
    raise exception 'FALLA: acepta un iv de otro largo';
  exception when check_violation then null;
  end;
  begin
    update public.assistant_key_sync set ciphertext = repeat('c', 1387);
    raise exception 'FALLA: acepta un cifrado de otro largo';
  exception when check_violation then null;
  end;
  assert (select generation from public.assistant_key_sync) = 2, 'un cambio rechazado subió la generación';
end;
$$;

-- Al crear, tampoco se eligen ni el id ni la generación.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
do $$
begin
  begin
    insert into public.assistant_key_sync (user_id, format, salt, iv, ciphertext)
      select '00000000-0000-4000-8000-0000000000c2', 1, s.salt, s.iv, s.ciphertext from pg_temp.sealed() s;
    raise exception 'FALLA: se elige el id al crear';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.assistant_key_sync (format, salt, iv, ciphertext, generation)
      select 1, s.salt, s.iv, s.ciphertext, 50 from pg_temp.sealed() s;
    raise exception 'FALLA: se elige la generación al crear';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Otro miembro no ve la copia de la persona ni la cambia ni la borra.
do $$
begin
  assert (select count(*) from public.assistant_key_sync) = 0, 'otro miembro ve la copia de la persona';
  update public.assistant_key_sync set ciphertext = repeat('x', 1388) where user_id = '00000000-0000-4000-8000-0000000000c1';
  assert not found, 'otro miembro cambia la copia de la persona';
  delete from public.assistant_key_sync where user_id = '00000000-0000-4000-8000-0000000000c1';
  assert not found, 'otro miembro borra la copia de la persona';
  -- Su propia copia sí.
  insert into public.assistant_key_sync (format, salt, iv, ciphertext) select 1, s.salt, s.iv, s.ciphertext from pg_temp.sealed('m') s;
  assert (select count(*) from public.assistant_key_sync) = 1, 'otro miembro no ve su propia copia';
end;
$$;

-- Un admin y el dueño del workspace, con su sesión de la app: tampoco.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3');
do $$
begin
  assert (select count(*) from public.assistant_key_sync) = 0, 'un admin ve copias ajenas';
  update public.assistant_key_sync set ciphertext = repeat('x', 1388);
  assert not found, 'un admin cambia copias ajenas';
  delete from public.assistant_key_sync;
  assert not found, 'un admin borra copias ajenas';
end;
$$;
select pg_temp.as_user(current_setting('test.owner')::uuid);
do $$
begin
  assert (select count(*) from public.assistant_key_sync where user_id <> auth.uid()) = 0, 'el dueño ve copias ajenas desde la app';
  update public.assistant_key_sync set ciphertext = repeat('x', 1388) where user_id <> auth.uid();
  assert not found, 'el dueño cambia copias ajenas desde la app';
  delete from public.assistant_key_sync where user_id <> auth.uid();
  assert not found, 'el dueño borra copias ajenas desde la app';
end;
$$;

-- La persona con el token de un cliente MCP (`client_id`): ni la suya.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1', 'otp', 'cliente-mcp');
do $$
begin
  assert (select count(*) from public.assistant_key_sync) = 0, 'un token de un cliente MCP lee la copia';
  update public.assistant_key_sync set ciphertext = repeat('x', 1388);
  assert not found, 'un token de un cliente MCP cambia la copia';
  delete from public.assistant_key_sync;
  assert not found, 'un token de un cliente MCP borra la copia';
end;
$$;
-- …ni crearla (el miembro c2 ya tiene la suya; se prueba con el admin, que no tiene).
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3', 'otp', 'cliente-mcp');
do $$
begin
  begin
    insert into public.assistant_key_sync (format, salt, iv, ciphertext) select 1, s.salt, s.iv, s.ciphertext from pg_temp.sealed() s;
    raise exception 'FALLA: un token de un cliente MCP crea una copia';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- La persona con una sesión abierta con contraseña (no es una sesión de la app): tampoco.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1', 'password');
do $$
begin
  assert (select count(*) from public.assistant_key_sync) = 0, 'una sesión con contraseña lee la copia';
  update public.assistant_key_sync set ciphertext = repeat('x', 1388);
  assert not found, 'una sesión con contraseña cambia la copia';
end;
$$;

-- Quien no entró: nada.
select set_config('role', 'anon', true);
do $$
begin
  begin
    perform 1 from public.assistant_key_sync;
    raise exception 'FALLA: anon lee la tabla';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.assistant_key_sync (format, salt, iv, ciphertext) select 1, s.salt, s.iv, s.ciphertext from pg_temp.sealed() s;
    raise exception 'FALLA: anon crea una copia';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- La persona borra su copia (de verdad: CS8).
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
do $$
begin
  delete from public.assistant_key_sync where user_id = auth.uid();
  assert found, 'la persona no borra su copia';
  assert (select count(*) from public.assistant_key_sync) = 0, 'la copia sigue después de borrarla';
end;
$$;

select pg_temp.as_postgres();
do $$
begin
  -- Lo que hicieron los otros no tocó nada: queda solo la copia del miembro c2, intacta.
  assert (select count(*) from public.assistant_key_sync where user_id in (
    '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c3')) = 1,
    'quedaron copias de más o de menos';
  assert (select left(ciphertext, 1) from public.assistant_key_sync where user_id = '00000000-0000-4000-8000-0000000000c2') = 'm',
    'alguien cambió la copia del miembro';
  -- El id no cambia ni con permisos de sobra (el trigger lo deja como estaba).
  update public.assistant_key_sync set user_id = '00000000-0000-4000-8000-0000000000c3' where user_id = '00000000-0000-4000-8000-0000000000c2';
  assert exists (select 1 from public.assistant_key_sync where user_id = '00000000-0000-4000-8000-0000000000c2'), 'el id de una copia cambió';
  -- Borrar la cuenta borra su copia.
  delete from auth.users where id = '00000000-0000-4000-8000-0000000000c2';
  assert (select count(*) from public.assistant_key_sync where user_id = '00000000-0000-4000-8000-0000000000c2') = 0,
    'la copia sobrevive a la cuenta';
  -- Fuera de Realtime.
  assert not exists (select 1 from pg_publication_tables where tablename = 'assistant_key_sync'), 'la tabla está en una publicación';
  -- Los permisos de las columnas.
  assert not has_table_privilege('anon', 'public.assistant_key_sync', 'select'), 'anon puede leer';
  assert not has_column_privilege('authenticated', 'public.assistant_key_sync', 'generation', 'update'), 'se puede escribir la generación';
  assert not has_column_privilege('authenticated', 'public.assistant_key_sync', 'user_id', 'insert'), 'se puede elegir el id';
end;
$$;

rollback;

select 'ok' as result;
