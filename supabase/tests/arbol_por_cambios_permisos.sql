-- Pruebas de `pages.changed_at` (20261116120000_arbol_por_cambios.sql): se mueve con cualquier cambio de la fila,
-- también con los que no mueven `updated_at` (`update_seq`); no se escribe desde la API; se lee con el árbol; y la
-- lista por cambios (`changed_at >= x`) trae solo lo que cambió. Corre dentro de una transacción que se deshace al
-- final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con result = 'ok'.

begin;

select set_config('request.headers', '{"x-shotdocs-version": "9.999"}', true);

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-00000000000a', 'rls-a@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role) values ('00000000-0000-4000-8000-00000000000a', 'member');
insert into public.workspaces (id, owner_id) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a');

select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');

insert into public.pages (id, workspace_id, title, sort_key) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1', 'Uno', 'a0'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000e1', 'Dos', 'a1');

do $$
declare
  a1 constant uuid := '00000000-0000-4000-8000-0000000000a1';
  a2 constant uuid := '00000000-0000-4000-8000-0000000000a2';
  t0 timestamptz;
  t1 timestamptz;
  mark timestamptz;
begin
  t0 := (select changed_at from public.pages where id = a1);
  assert t0 is not null, 'una página nueva no tiene changed_at';

  begin
    update public.pages set changed_at = now() - interval '1 hour' where id = a1;
    raise exception 'FALLA: changed_at se puede escribir desde la API';
  exception when insufficient_privilege then null;
  end;

  -- Un cambio del árbol (el título) mueve la marca.
  update public.pages set title = 'Uno bis' where id = a1;
  t1 := (select changed_at from public.pages where id = a1);
  assert t1 > t0, 'cambiar el título no movió changed_at';

  -- Solo lo cambiado entra en la lista por cambios.
  mark := t1;
  update public.pages set settings = '{"split": false}' where id = a2;
  assert (select count(*) from public.pages where changed_at > mark) = 1, 'la lista por cambios no trae solo lo cambiado';
  assert (select id from public.pages where changed_at > mark) = a2, 'la lista por cambios no trae la página cambiada';
end;
$$;

-- `update_seq` lo mueve la base (el contenido nuevo), no la API: también mueve la marca, aunque `updated_at` no cambie.
select set_config('role', 'postgres', true);

do $$
declare
  a1 constant uuid := '00000000-0000-4000-8000-0000000000a1';
  before_changed timestamptz := (select changed_at from public.pages where id = a1);
  before_updated timestamptz := (select updated_at from public.pages where id = a1);
begin
  update public.pages set update_seq = update_seq + 1 where id = a1;
  assert (select changed_at from public.pages where id = a1) > before_changed, 'update_seq no movió changed_at';
  assert (select updated_at from public.pages where id = a1) = before_updated, 'update_seq movió updated_at';
  assert (select schema_version from public.workspace_settings where id) >= 26, 'schema_version no llegó a 26';
end;
$$;

rollback;

select 'ok' as result;
