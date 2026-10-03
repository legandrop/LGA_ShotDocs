-- Pruebas del link público, entrega 2b: Can edit sube fotos, videos y archivos (20261030120000_link_archivos.sql,
-- Docs/Doc_Link_Publico.md, E2.5, E2.7, E2.11 y E2.14). El visitante (rol anon, el token en `x-shotdocs-link`) registra
-- un archivo nuevo en una página de su rama con los topes de E2.5 (lo rechazado no suma) y nunca vincula un id que ya
-- existe; el portero termina con `plink_set_file_drive` y la app marca la miniatura (`plink_set_file_thumb`, la política
-- `thumbs_insert_link`), las dos solo para un archivo de ese link. `plink_media_file` dice si el archivo es del link y la
-- huella del proyecto (nunca el proyecto); `link_media_allowed` acepta lo registrado por el link. Corre dentro de una
-- transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con result = 'ok'.

begin;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000' || s)::uuid;
$$;

create function pg_temp.as_user(s text, ver text default '9.999') returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', pg_temp.u(s), 'role', 'authenticated')::text, true),
         set_config('request.headers', json_build_object('x-shotdocs-version', ver)::text, true);
$$;

create function pg_temp.as_anon(tok text, ver text default '9.999') returns void language sql as $$
  select set_config('role', 'anon', true),
         set_config('request.jwt.claims', '{"role": "anon"}', true),
         set_config('request.headers',
                    jsonb_strip_nulls(jsonb_build_object('x-shotdocs-link', tok, 'x-shotdocs-device', 'devAAAAAAAAAAAAAAAAAAAA',
                                                         'x-shotdocs-version', ver))::text, true);
$$;

create function pg_temp.as_postgres() returns void language sql as $$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '', true),
         set_config('request.headers', '', true);
$$;

-- Corre `stmt` y devuelve 'ok' o 'error:<mensaje>[:<detail>]'.
create function pg_temp.try(stmt text) returns text language plpgsql as $$
declare
  d text;
  m text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  m := sqlerrm;
  if sqlstate = 'PGRST' then
    m := (sqlerrm::json ->> 'message');
    d := null;
  end if;
  return 'error:' || m || coalesce(':' || nullif(d, ''), '');
end;
$$;

create function pg_temp.check(got text, want text, what text) returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FALLA: % (dio %, se esperaba %)', what, got, want;
  end if;
end;
$$;

create temp table tk (name text primary key, id uuid, token text);
create function pg_temp.save(n text, j jsonb) returns void language sql security definer as $$
  insert into pg_temp.tk values (n, (j ->> 'id')::uuid, j ->> 'token')
  on conflict (name) do update set id = excluded.id, token = excluded.token;
$$;
create function pg_temp.tok(n text) returns text language sql security definer as $$
  select token from pg_temp.tk where name = n;
$$;
create function pg_temp.lid(n text) returns uuid language sql security definer as $$
  select id from pg_temp.tk where name = n;
$$;

-- Registrar como el visitante (la app: `plink_register_file`).
create function pg_temp.reg(tok text, page text, file text, size bigint default 1000, mime text default 'image/jpeg',
                            ver text default '9.999') returns text language plpgsql as $$
declare
  r text;
begin
  perform pg_temp.as_anon(tok, ver);
  r := pg_temp.try(format('select public.plink_register_file(%L, %L, %L, %L, %s, 10, 10, null, %L)',
                          pg_temp.u(file), pg_temp.u(page), 'foto.jpg', mime, size, ver));
  perform pg_temp.as_postgres();
  return r;
end;
$$;

-- Otra función del visitante, por SQL.
create function pg_temp.anon_try(tok text, stmt text) returns text language plpgsql as $$
declare
  r text;
begin
  perform pg_temp.as_anon(tok);
  r := pg_temp.try(stmt);
  perform pg_temp.as_postgres();
  return r;
end;
$$;

create function pg_temp.link_row(n text) returns public.public_links language sql security definer as $$
  select * from public.public_links where id = pg_temp.lid(n);
$$;
create function pg_temp.used(p_name text, p_kind text) returns text language sql security definer as $$
  select coalesce((select u.n || '/' || u.bytes from public.public_link_usage u
                   where u.link_id = pg_temp.lid(p_name) and u.day = current_date and u.kind = p_kind), '0/0');
$$;
create function pg_temp.limits(j text) returns void language sql security definer as $$
  update public.workspace_settings set link_limits = j::jsonb where id;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Datos
-- ---------------------------------------------------------------------------------------------------
-- Personas: o (dueña), a (miembro, crea P y comparte), e (Editar P: ve lo borrado y admite).
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
update public.workspace_settings
set min_app_version = 0.5, clean_min_version = 0.5, link_edit_min_version = 0.5, link_limits = '{}' where id;
insert into auth.users (id, email, aud, role) values
  (pg_temp.u('d3a0'), 'lf-o@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d3a1'), 'lf-a@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d3a6'), 'lf-e@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role) values
  (pg_temp.u('d3a0'), 'owner'), (pg_temp.u('d3a1'), 'member'), (pg_temp.u('d3a6'), 'member');
insert into public.workspaces (id, owner_id, name) values
  (pg_temp.u('d3e0'), pg_temp.u('d3a1'), 'P'),
  (pg_temp.u('d3e1'), pg_temp.u('d3a0'), 'Q');
-- P: R › S (la del link) › H, S › T (papelera); R › Sib. Q: QX.
insert into public.pages (id, workspace_id, parent_id, title, sort_key, settings) values
  (pg_temp.u('d3b0'), pg_temp.u('d3e0'), null, 'R', 'a0', '{}'),
  (pg_temp.u('d3b2'), pg_temp.u('d3e0'), pg_temp.u('d3b0'), 'S', 'a0', '{}'),
  (pg_temp.u('d3b3'), pg_temp.u('d3e0'), pg_temp.u('d3b2'), 'H', 'a0', '{}'),
  (pg_temp.u('d3b5'), pg_temp.u('d3e0'), pg_temp.u('d3b2'), 'T', 'a1', '{}'),
  (pg_temp.u('d3b7'), pg_temp.u('d3e0'), pg_temp.u('d3b0'), 'Sib', 'a1', '{}'),
  (pg_temp.u('d3b9'), pg_temp.u('d3e1'), null, 'QX', 'a0', '{}');
insert into public.grants (user_id, project_id, page_id, level) values
  (pg_temp.u('d3a6'), pg_temp.u('d3e0'), null, 'edit');
-- Archivos del equipo: f1 en S (todavía sin Drive), f7 en Sib (afuera de la rama), f9 de Q.
insert into public.files (id, project_id, name, mime, size, created_by) values
  (pg_temp.u('d3f1'), pg_temp.u('d3e0'), 'equipo.jpg', 'image/jpeg', 10, pg_temp.u('d3a1')),
  (pg_temp.u('d3f7'), pg_temp.u('d3e0'), 'costado.jpg', 'image/jpeg', 10, pg_temp.u('d3a1')),
  (pg_temp.u('d3f9'), pg_temp.u('d3e1'), 'ajeno.jpg', 'image/jpeg', 10, pg_temp.u('d3a0'));
insert into public.page_files (page_id, file_id) values
  (pg_temp.u('d3b2'), pg_temp.u('d3f1')), (pg_temp.u('d3b7'), pg_temp.u('d3f7')), (pg_temp.u('d3b9'), pg_temp.u('d3f9'));

do $$
begin
  perform pg_temp.as_user('d3a1');
  perform pg_temp.save('S', public.create_public_link(pg_temp.u('d3c0'), pg_temp.u('d3b2'), 'edit'));
  perform pg_temp.save('Sib', public.create_public_link(pg_temp.u('d3c1'), pg_temp.u('d3b7'), 'edit'));
  perform pg_temp.save('H', public.create_public_link(pg_temp.u('d3c2'), pg_temp.u('d3b3'), 'comment'));
  perform pg_temp.as_postgres();
  update public.pages set deleted_at = now() where id = pg_temp.u('d3b5');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Registrar: dónde, quién y la versión
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  l public.public_links;
begin
  -- Dónde no: arriba, al costado, otro proyecto, la papelera; Can view; sin header o con un token al azar.
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b0', 'd310'), 'error:page_not_found', 'registra arriba');
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b7', 'd310'), 'error:page_not_found', 'registra al costado');
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b9', 'd310'), 'error:page_not_found', 'registra en otro proyecto');
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b5', 'd310'), 'error:page_not_found', 'registra en la papelera');
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('H'), 'd3b3', 'd310'), 'error:page_not_found', 'Can view registra');
  perform pg_temp.check(pg_temp.reg(null, 'd3b2', 'd310'), 'error:link_not_found', 'sin header registra');
  perform pg_temp.check(pg_temp.reg('sdl_' || repeat('Z', 43), 'd3b2', 'd310'), 'error:link_not_found', 'un token al azar registra');
  -- Versión: más vieja que el interruptor o sin versión.
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b2', 'd310', ver => '0.400'), 'error:app_outdated', 'registra con una versión vieja');
  update public.workspace_settings set link_edit_min_version = null where id;
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b2', 'd310'), 'error:app_outdated', 'registra con el interruptor apagado');
  update public.workspace_settings set link_edit_min_version = 0.5 where id;
  -- Carpetas, no (LE7); tamaños fuera de rango.
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b2', 'd310', 1, 'inode/directory'), 'error:folder_not_allowed', 'registra una carpeta');
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b2', 'd310', 0), 'error:file_too_big', 'registra 0 bytes');
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b2', 'd310', 524288001), 'error:file_too_big', 'registra más de 500 MB');
  -- Nada de lo rechazado sumó ni quedó.
  l := pg_temp.link_row('S');
  assert l.files_total = 0 and l.upload_bytes_total = 0, 'lo rechazado sumó de por vida';
  assert pg_temp.used('S', 'file') = '0/0' and pg_temp.used('S', 'upload') = '0/0', 'lo rechazado sumó en el día';
  assert not exists (select 1 from public.files where id = pg_temp.u('d310')), 'lo rechazado quedó en files';

  -- Bien: en S y en H (adentro de la rama), con el link, sin cuenta, y contado.
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b2', 'd310', 1000), 'ok', 'no registra en S');
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b3', 'd311', 500, 'Video/MP4 '), 'ok', 'no registra en H');
  assert (select plink_id = pg_temp.lid('S') and created_by is null and project_id = pg_temp.u('d3e0')
          from public.files where id = pg_temp.u('d310')), 'el archivo no quedó del link, sin cuenta y del proyecto';
  assert (select mime from public.files where id = pg_temp.u('d311')) = 'video/mp4', 'el tipo no quedó normalizado';
  assert exists (select 1 from public.page_files where page_id = pg_temp.u('d3b2') and file_id = pg_temp.u('d310')
                 and removed_at is null), 'el uso no quedó';
  l := pg_temp.link_row('S');
  assert l.files_total = 2 and l.upload_bytes_total = 1500, 'no sumó de por vida';
  assert pg_temp.used('S', 'file') = '2/0' and pg_temp.used('S', 'upload') = '2/1500', 'no sumó en el día';
  -- Idempotente: el mismo id, la misma página, el mismo link. No cuenta otra vez.
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b2', 'd310', 1000), 'ok', 'reintentar falla');
  assert (pg_temp.link_row('S')).files_total = 2 and pg_temp.used('S', 'file') = '2/0', 'reintentar contó';
  -- Un id que ya existe y no es de este link en esta página: nunca se vincula.
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b3', 'd310'), 'error:file_other_project', 'el mismo id en otra página');
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b2', 'd3f1'), 'error:file_other_project', 'el id de un archivo del equipo de S');
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b2', 'd3f7'), 'error:file_other_project', 'el id de un archivo de afuera');
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b2', 'd3f9'), 'error:file_other_project', 'el id de un archivo de otro proyecto');
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('Sib'), 'd3b7', 'd310'), 'error:file_other_project', 'el id de otro link');
  assert not exists (select 1 from public.page_files where file_id in (pg_temp.u('d3f7'), pg_temp.u('d3f9'), pg_temp.u('d310'))
                     and page_id in (pg_temp.u('d3b2'), pg_temp.u('d3b3'), pg_temp.u('d3b7'))
                     and not (page_id = pg_temp.u('d3b2') and file_id = pg_temp.u('d310'))
                     and not (page_id = pg_temp.u('d3b7') and file_id = pg_temp.u('d3f7'))),
    'un id ajeno quedó colgado de una página';
  assert (pg_temp.link_row('S')).files_total = 2, 'lo ajeno contó';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Los topes (E2.5): de por vida, del día y la guarda de la base; lo rechazado no suma
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.limits('{"life_files": 2}');
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b2', 'd320'), 'error:link_rate_limited:life_files', 'tope de archivos de por vida');
  perform pg_temp.limits('{"life_upload_bytes": 2000}');
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b2', 'd320', 501), 'error:link_rate_limited:life_upload_bytes', 'tope de bytes de por vida');
  perform pg_temp.limits('{"file": 2}');
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b2', 'd320'), 'error:link_rate_limited:file', 'tope de archivos del día');
  perform pg_temp.limits('{"upload_bytes": 2000}');
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b2', 'd320', 501), 'error:link_rate_limited:upload_bytes', 'tope de bytes del día');
  perform pg_temp.limits('{"file_max_bytes": 100}');
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b2', 'd320', 101), 'error:file_too_big', 'el tope por archivo ajustable');
  perform pg_temp.limits('{"db_guard_bytes": 1}');
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b2', 'd320'), 'error:link_rate_limited:db_guard', 'la guarda de la base');
  perform pg_temp.limits('{}');
  assert (select files_total = 2 and upload_bytes_total = 1500 from public.public_links where id = pg_temp.lid('S')),
    'lo rechazado sumó de por vida';
  assert pg_temp.used('S', 'file') = '2/0' and pg_temp.used('S', 'upload') = '2/1500', 'lo rechazado sumó en el día';
  assert not exists (select 1 from public.files where id = pg_temp.u('d320')), 'lo rechazado quedó';
  -- Con lugar otra vez, entra.
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b2', 'd320', 10), 'ok', 'no registra con lugar');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- El portero y la miniatura: solo un archivo de este link
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  j json;
begin
  -- plink_media_file: `mine` y la huella del proyecto, nunca el proyecto.
  perform pg_temp.as_anon(pg_temp.tok('S'));
  j := public.plink_media_file(pg_temp.u('d310'));
  assert (j ->> 'mine')::boolean and j ->> 'project_id' = pg_temp.lid('S')::text and j ->> 'project_name' = '',
    'plink_media_file no dice mine o da el proyecto';
  assert j ->> 'project_mark' = encode(extensions.digest('sdproject:' || pg_temp.u('d3e0')::text, 'sha256'), 'hex'),
    'la huella del proyecto no es la del portero';
  assert position(pg_temp.u('d3e0')::text in j::text) = 0, 'plink_media_file da el id del proyecto';
  j := public.plink_media_file(pg_temp.u('d3f1'));
  assert not (j ->> 'mine')::boolean and (j ->> 'level')::int = 3, 'un archivo del equipo de la rama dice mine';
  perform pg_temp.as_postgres();

  -- plink_set_file_drive.
  perform pg_temp.check(pg_temp.anon_try(pg_temp.tok('S'), format('select public.plink_set_file_drive(%L, %L)', pg_temp.u('d3f1'), 'driveTeam000001')),
    'error:file_not_found', 'el link confirma un archivo del equipo');
  perform pg_temp.check(pg_temp.anon_try(pg_temp.tok('Sib'), format('select public.plink_set_file_drive(%L, %L)', pg_temp.u('d310'), 'driveOther00001')),
    'error:file_not_found', 'otro link confirma un archivo de este');
  perform pg_temp.check(pg_temp.anon_try(pg_temp.tok('S'), format('select public.plink_set_file_drive(%L, %L)', pg_temp.u('d310'), 'x y')),
    'error:drive_id_invalid', 'un id de Drive mal formado');
  perform pg_temp.check(pg_temp.anon_try(pg_temp.tok('S'), format('select public.plink_set_file_drive(%L, %L)', pg_temp.u('d310'), 'driveLink000001')),
    'ok', 'no confirma lo suyo');
  perform pg_temp.check(pg_temp.anon_try(pg_temp.tok('S'), format('select public.plink_set_file_drive(%L, %L)', pg_temp.u('d310'), 'driveLink000001')),
    'ok', 'repetir el mismo falla');
  perform pg_temp.check(pg_temp.anon_try(pg_temp.tok('S'), format('select public.plink_set_file_drive(%L, %L)', pg_temp.u('d310'), 'driveLink000002')),
    'error:file_already_uploaded', 'cambia el Drive de lo ya confirmado');
  assert (select drive_id from public.files where id = pg_temp.u('d310')) = 'driveLink000001', 'el Drive no quedó';
  assert (select drive_id from public.files where id = pg_temp.u('d3f1')) is null, 'el link tocó el Drive del equipo';

  -- plink_set_file_thumb.
  perform pg_temp.check(pg_temp.anon_try(pg_temp.tok('S'), format('select public.plink_set_file_thumb(%L)', pg_temp.u('d3f1'))),
    'error:file_not_found', 'el link marca la miniatura del equipo');
  perform pg_temp.check(pg_temp.anon_try(pg_temp.tok('S'), format('select public.plink_set_file_thumb(%L)', pg_temp.u('d311'))),
    'ok', 'no marca su miniatura');
  assert (select thumb_at is not null from public.files where id = pg_temp.u('d311')), 'thumb_at no quedó';

  -- La miniatura en el bucket: la de un archivo suyo, sí; la del equipo, la de otro link o sin header, no.
  perform pg_temp.check(pg_temp.anon_try(pg_temp.tok('S'),
    format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'thumbs', pg_temp.u('d311')::text || '.jpg')),
    'ok', 'no sube la miniatura de lo suyo');
  assert pg_temp.anon_try(pg_temp.tok('S'),
    format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'thumbs', pg_temp.u('d3f1')::text || '.jpg')) like 'error:new row violates row-level security%',
    'sube la miniatura del equipo';
  assert pg_temp.anon_try(pg_temp.tok('Sib'),
    format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'thumbs', pg_temp.u('d310')::text || '.jpg')) like 'error:new row violates row-level security%',
    'otro link sube la miniatura de este';
  assert pg_temp.anon_try(null,
    format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'thumbs', pg_temp.u('d310')::text || '.jpg')) like 'error:new row violates row-level security%',
    'sin header sube una miniatura';
  assert pg_temp.anon_try(pg_temp.tok('S'),
    format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'page-files', pg_temp.u('d310')::text || '.jpg')) like 'error:new row violates row-level security%',
    'sube a otro bucket';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- link_media_allowed: lo registrado por el link (LE9-B, 2b), también si la página lo dejó de usar
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  l public.public_links;
begin
  update public.page_files set removed_at = now() where file_id = pg_temp.u('d311');
  l := pg_temp.link_row('S');
  assert private.link_media_allowed(l, pg_temp.u('d311')), 'lo registrado por el link y sacado no vale';
  assert private.link_media_allowed(l, pg_temp.u('d3f1')), 'lo que usa la rama no vale';
  assert not private.link_media_allowed(l, pg_temp.u('d3f7')), 'lo de afuera de la rama vale';
  assert not private.link_media_allowed(l, pg_temp.u('d3f9')), 'lo de otro proyecto vale';
  assert not private.link_media_allowed(pg_temp.link_row('Sib'), pg_temp.u('d311')), 'lo de otro link vale';
  assert not private.link_media_allowed(null::public.public_links, pg_temp.u('d311')), 'sin link vale';
  -- Sacado de la página, el portero ya no le da al link nivel para subirlo ni marcarlo, ni sube su miniatura.
  perform pg_temp.check(pg_temp.anon_try(pg_temp.tok('S'), format('select public.plink_set_file_thumb(%L)', pg_temp.u('d311'))),
    'error:file_not_found', 'marca la miniatura de lo sacado');
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b3', 'd322', 10), 'ok', 'no registra d322');
  update public.page_files set removed_at = now() where file_id = pg_temp.u('d322');
  assert pg_temp.anon_try(pg_temp.tok('S'),
    format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'thumbs', pg_temp.u('d322')::text || '.jpg'))
    like 'error:new row violates row-level security%', 'sube la miniatura de lo sacado';
  -- Pasado a Can view, el link no confirma ni sube la miniatura de lo suyo (vuelve a Can edit y sí).
  perform pg_temp.as_user('d3a1');
  perform public.set_public_link(pg_temp.u('d3b2'), 'comment');
  perform pg_temp.as_postgres();
  perform pg_temp.check(pg_temp.anon_try(pg_temp.tok('S'), format('select public.plink_set_file_drive(%L, %L)', pg_temp.u('d320'), 'driveLink000009')),
    'error:file_not_found', 'Can view confirma una subida');
  perform pg_temp.check(pg_temp.anon_try(pg_temp.tok('S'), format('select public.plink_set_file_thumb(%L)', pg_temp.u('d320'))),
    'error:file_not_found', 'Can view marca una miniatura');
  assert pg_temp.anon_try(pg_temp.tok('S'),
    format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'thumbs', pg_temp.u('d320')::text || '.jpg'))
    like 'error:new row violates row-level security%', 'Can view sube una miniatura';
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b2', 'd321'), 'error:page_not_found', 'Can view registra');
  perform pg_temp.as_user('d3a1');
  perform public.set_public_link(pg_temp.u('d3b2'), 'edit');
  perform pg_temp.as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Revocar y Reset (E2.7): el link viejo no registra ni confirma; lo registrado queda (nada se borra)
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  old_token text := pg_temp.tok('S');
  j jsonb;
begin
  perform pg_temp.as_user('d3a1');
  -- Share: cuántos archivos y cuánto pesan, de por vida, y el uso del día.
  j := public.get_public_link(pg_temp.u('d3b2')) -> 'link';
  assert (j -> 'files' ->> 'total')::int = 4 and (j -> 'files' ->> 'bytes')::bigint = 1520, 'Share no cuenta los archivos';
  assert (j -> 'usage_today' -> 'upload' ->> 'bytes')::bigint = 1520, 'Share no cuenta lo subido hoy';
  assert not (j ->> 'limited')::boolean, 'Share dice que llegó al tope';
  perform pg_temp.as_postgres();
  perform pg_temp.limits('{"file": 4}');
  perform pg_temp.as_user('d3a1');
  assert (public.get_public_link(pg_temp.u('d3b2')) -> 'link' ->> 'limited')::boolean, 'Share no ve el tope de archivos del día';
  perform pg_temp.save('S', public.reset_public_link(pg_temp.u('d3b2'), pg_temp.u('d3c9')));
  perform pg_temp.as_postgres();
  perform pg_temp.limits('{}');
  perform pg_temp.check(pg_temp.reg(old_token, 'd3b2', 'd330'), 'error:link_not_found', 'el link reseteado registra');
  perform pg_temp.check(pg_temp.anon_try(old_token, format('select public.plink_set_file_drive(%L, %L)', pg_temp.u('d320'), 'driveLink000003')),
    'error:link_not_found', 'el link reseteado confirma una subida');
  assert (select drive_id from public.files where id = pg_temp.u('d320')) is null, 'la subida del link reseteado quedó confirmada';
  -- El link nuevo no tiene como suyo lo del viejo.
  perform pg_temp.check(pg_temp.anon_try(pg_temp.tok('S'), format('select public.plink_set_file_drive(%L, %L)', pg_temp.u('d320'), 'driveLink000003')),
    'error:file_not_found', 'el link nuevo confirma lo del viejo');
  perform pg_temp.check(pg_temp.reg(pg_temp.tok('S'), 'd3b2', 'd320', 10), 'error:file_other_project', 'el link nuevo registra el id del viejo');
  -- Lo del viejo sigue: filas y usos.
  assert (select count(*) from public.files where plink_id = (select id from public.public_links where token = old_token)) = 4,
    'se perdió algo registrado por el link viejo';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- anon y la versión de la base
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  assert (select string_agg(p.proname || ':' || p.provolatile::text, ',' order by p.proname)
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in ('plink_register_file', 'plink_set_file_drive', 'plink_set_file_thumb'))
       = 'plink_register_file:v,plink_set_file_drive:v,plink_set_file_thumb:v', 'las del visitante no son VOLATILE';
  assert not has_function_privilege('authenticated', 'public.plink_register_file(uuid, uuid, text, text, bigint, int, int, real, text)', 'execute'),
    'una cuenta registra como link';
  assert not has_function_privilege('authenticated', 'public.plink_set_file_drive(uuid, text)', 'execute'), 'una cuenta confirma como link';
  assert has_function_privilege('anon', 'public.plink_register_file(uuid, uuid, text, text, bigint, int, int, real, text)', 'execute'),
    'anon no registra';
  assert not has_function_privilege('anon', 'public.register_file(uuid, uuid, text, text, bigint, int, int, real, text)', 'execute'),
    'anon registra como una cuenta';
  assert not has_function_privilege('anon', 'public.set_file_drive(uuid, text)', 'execute'), 'anon confirma como una cuenta';
  assert (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'thumbs_insert_link' and roles = array['anon']::name[] and cmd = 'INSERT') = 1,
    'la política de miniaturas del link';
  assert (select schema_version from public.workspace_settings where id) >= 21, 'schema_version';
end;
$$;

rollback;
select 'ok' as result;
