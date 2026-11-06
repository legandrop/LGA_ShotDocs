-- LGA Shot Docs · pedir acceso a una escena desde su link (Docs/Doc_Compartir_Escenas.md, entrega B-2, sección 9).
--
-- PipeSync linkea a la escena en el Panorama de un proyecto (`/map/scenes?project=…&scene=…`, Docs/Doc_Link_Escena.md).
-- Quien lo abre sin ver ese proyecto (o sin ver esa escena) cae en una pantalla que dice solo «You don't have access to
-- this. Request access?»; si lo pide, el pedido les llega al dueño y a los admins del workspace que pueden compartir el
-- proyecto, que deciden si le dan la escena (Ver o Comentar) con las reglas de *Share scenes* (`set_page_shares`). Hay
-- NDA: nadie sin acceso puede saber nada del proyecto, ni si existe.
--
-- - `request_scene_access(proyecto, texto, escena)`: un miembro vivo con sesión permitida (también un invitado: el
--   vendor). El proyecto va por **id** (lo pone *Copy link*) o, si el link trae un nombre, por su **texto normalizado**
--   (sin mayúsculas ni tildes, como `projectKey` de src/ui/project.ts). **Nunca resuelve nada al pedir**: guarda lo que
--   vino y responde siempre `sent`, exista o no el proyecto o la escena. Un pedido repetido (misma persona, mismo
--   proyecto o texto, misma escena) renueva su fila. El tope cuenta **todas las llamadas** (20 cada 24 horas por
--   persona, repetidas o no), así la llamada 21 da `rate_limited` exista o no lo pedido (A1 de la auditoría).
-- - `scene_access_requests_pending()`: solo dueño o admin del workspace (nunca un invitado, B2). Resuelve al leer: un id,
--   si el proyecto existe y no está borrado; un texto, entre los proyectos sin borrar, por el nombre entero o, si ninguno
--   se llama así, por la primera palabra (como `projectMatches`), siempre **entre los que quien mira puede compartir**
--   (`can_share`, antes de comparar: nada dice que existe un proyecto que no ve), una fila por proyecto, con el texto del
--   link y si salió por la primera palabra (entonces la app no elige la escena sola). No muestra el pedido de quien ya ve
--   el proyecto entero. La escena va como vino: la app de quien decide la busca entre las escenas del proyecto
--   (`resolveSceneParam`) y muestra el tipo de la página y cuántas lleva adentro antes de *Give access* (M6).
-- - `decide_scene_access_request(pedido, aceptar, proyecto, página, nivel)`: dueño o admin que puede compartir ese
--   proyecto, que tiene que ser uno de los que resuelve el pedido; rechazar es explícito. Dar acceso **llama a
--   `set_page_shares`** (20261118120000_compartir_escenas.sql) con esa sola página: el interruptor de lo borrado
--   (`clean_off`), nivel `view` o `comment`, la página marcada como escena de ese proyecto y viva (`page_invalid`), nada
--   adentro marcado como otra entidad (`scene_contains_entities`), el candado por correo y el permiso que nunca baja. No
--   se repite ninguna regla de seguridad acá (M6).
--
-- Tablas nuevas, cerradas con Row Level Security y sin políticas: nadie las lee ni las escribe directo. No toca
-- `access_requests` ni sus funciones. Compatible con las versiones publicadas: solo suma. Sube `schema_version` a 29: la
-- app ofrece pedir una escena y le muestra los pedidos a quien decide desde ahí.

-- ---------------------------------------------------------------------------------------------------
-- 1. Las tablas
-- ---------------------------------------------------------------------------------------------------
create table public.scene_access_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  -- Sin clave foránea a propósito: un id que no existe también deja su fila, así nada dice qué ids existen (A1).
  project_id      uuid,
  -- El nombre del link, normalizado (`private.project_text_key`), si el link no traía el id.
  project_text    text check (project_text is null or char_length(project_text) between 1 and 200),
  -- La escena como vino en el link (sin espacios de más); la resuelve la app de quien decide.
  scene_text      text not null check (char_length(scene_text) between 1 and 80),
  state           text not null default 'pending' check (state in ('pending', 'accepted', 'declined', 'void')),
  times           int not null default 1 check (times between 1 and 1000),
  created_at      timestamptz not null default now(),
  asked_at        timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      uuid references auth.users (id) on delete set null,
  -- Al decidir: el proyecto (de los que resolvía el pedido), y al aceptar, la página y el nivel (el permiso vive en `grants`).
  decided_project uuid references public.workspaces (id) on delete set null,
  page_id         uuid references public.pages (id) on delete set null,
  level           text check (level in ('view', 'comment')),
  constraint scene_access_requests_target check (num_nonnulls(project_id, project_text) = 1),
  constraint scene_access_requests_decided check ((state in ('accepted', 'declined')) = (decided_at is not null))
);
-- Uno abierto por persona, proyecto (o texto) y escena (sin mayúsculas); los pendientes por fecha.
create unique index scene_access_requests_open_key on public.scene_access_requests
  (user_id, (coalesce(project_id::text, 't:' || project_text)), (lower(scene_text)))
  where state in ('pending', 'void');
create index scene_access_requests_pending_idx on public.scene_access_requests (asked_at) where state = 'pending';

alter table public.scene_access_requests enable row level security;
revoke all on public.scene_access_requests from public, anon, authenticated;

-- El tope: cuántas veces llamó cada persona desde que empezó su ventana de 24 horas. Una fila por persona (no crece).
create table public.scene_access_calls (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  window_start timestamptz not null,
  calls        int not null check (calls >= 0)
);

alter table public.scene_access_calls enable row level security;
revoke all on public.scene_access_calls from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 2. Las piezas de adentro
-- ---------------------------------------------------------------------------------------------------
-- Un nombre de proyecto comparable, como `projectKey` de src/ui/project.ts: sin tildes, sin espacios de más, en
-- minúsculas. (La app quita todas las marcas con NFD; acá, las letras con tilde del castellano y vecinas: un nombre con
-- otras marcas no coincide y el pedido no le llega a nadie, que es el lado seguro.)
create function private.project_text_key(t text)
returns text
language sql immutable set search_path = ''
as $$
  select lower(translate(btrim(regexp_replace(coalesce(t, ''), '[[:space:]]+', ' ', 'g')),
                         'ÁÀÂÄÃÅáàâäãåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖÕóòôöõÚÙÛÜúùûüÑñÇçÝýÿ',
                         'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCcYyy'));
$$;

-- La primera palabra de un nombre ya comparable: «erso | serie» → «erso» (`projectCode` de src/ui/project.ts).
create function private.project_text_code(k text)
returns text
language sql immutable set search_path = ''
as $$
  select coalesce((select s.x from regexp_split_to_table(k, '[[:space:]|·_/-]+') with ordinality as s(x, o)
                   where s.x <> '' order by s.o limit 1), '');
$$;

-- Los proyectos que nombra un pedido **entre los que quien llama puede compartir** (`can_share`, con su sesión): el del
-- id, si existe, no está borrado y lo puede compartir; o, por el texto, los suyos sin borrar que se llaman así enteros y,
-- si no hay ninguno, los suyos que empiezan con esa palabra. El filtro va antes de comparar el nombre entero: si fuera
-- después, que «erso» no le llegue a un admin como su «ERSO | Serie» le diría que existe otro proyecto «Érso» que no ve
-- (oráculo, auditoría de B-2). La columna `exact` dice si salió por el id o por el nombre entero (la app elige la escena
-- sola) o por la primera palabra (quien decide la elige a mano). Costo: con texto, una pasada por los proyectos (decenas).
create function private.scene_request_projects(p_project uuid, p_text text)
returns table (pid uuid, exact boolean)
language sql stable security definer set search_path = ''
as $$
  with live as (
    select w.id, private.project_text_key(w.name) as k
    from public.workspaces w
    where w.deleted_at is null and p_project is null and p_text is not null and private.can_share(w.id, null)
  ),
  whole as (select l.id from live l where l.k = p_text)
  select w.id, true from public.workspaces w
  where p_project is not null and w.id = p_project and w.deleted_at is null and private.can_share(w.id, null)
  union all
  select e.id, true from whole e
  union all
  select l.id, false from live l
  where not exists (select 1 from whole) and private.project_text_code(l.k) = p_text;
$$;

revoke all on function private.project_text_key(text) from public, anon, authenticated;
revoke all on function private.project_text_code(text) from public, anon, authenticated;
revoke all on function private.scene_request_projects(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 3. Pedir
-- ---------------------------------------------------------------------------------------------------
-- Siempre `sent` (o `rate_limited` con el tope lleno, `not_member` para quien no es miembro, `target_invalid` con lo
-- pedido mal formado: ninguno de los tres depende de lo que hay en la base). No mira si el proyecto o la escena existen.
-- Un pedido rechazado a esa persona en las últimas 24 horas queda `void` (no se lista) hasta que pasa el día. Nada de lo
-- que haga quien decide cambia la respuesta: el único tope es el de llamadas (lo que hizo la persona), y el de pedidos
-- abiertos vive en la lista (los 20 más nuevos de cada persona), que quien pide no ve. Al pedir se borran las filas
-- propias creadas hace más de 30 días, en cualquier estado (depende solo de cuándo pidió), así la tabla no crece sin fin.
create function public.request_scene_access(p_project uuid, p_project_text text, p_scene text)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  uid     uuid := auth.uid();
  v_text  text := case when p_project_text is null then null else private.project_text_key(p_project_text) end;
  v_scene text := btrim(regexp_replace(coalesce(p_scene, ''), '[[:space:]]+', ' ', 'g'));
  v_key   text;
  v_calls int;
  v_void  boolean;
  cur     public.scene_access_requests;
begin
  if uid is null or private.workspace_role(uid) is null then
    raise exception 'not_member' using errcode = '42501';
  end if;
  -- Un proyecto (id o texto, no los dos) y una escena, con los largos de la tabla.
  if (p_project is null) = (v_text is null) or (v_text is not null and char_length(v_text) not between 1 and 200)
     or char_length(v_scene) not between 1 and 80 then
    raise exception 'target_invalid' using errcode = '22023';
  end if;
  -- Dos pestañas a la vez no pasan el tope (el mismo candado que los pedidos de archivos y páginas).
  perform pg_advisory_xact_lock(hashtextextended('access_request:' || uid::text, 0));
  -- El tope cuenta todas las llamadas, repetidas o no, antes de mirar nada más. Pasado el tope, el error deshace también
  -- esta cuenta: la ventana sigue llena hasta que pasan las 24 horas.
  insert into public.scene_access_calls as c (user_id, window_start, calls)
  values (uid, now(), 1)
  on conflict (user_id) do update
    set window_start = case when c.window_start <= now() - interval '24 hours' then now() else c.window_start end,
        calls = case when c.window_start <= now() - interval '24 hours' then 1 else c.calls + 1 end
  returning c.calls into v_calls;
  if v_calls > 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  delete from public.scene_access_requests r
  where r.user_id = uid and r.created_at < now() - interval '30 days';

  v_key := coalesce(p_project::text, 't:' || v_text);
  v_void := exists (select 1 from public.scene_access_requests r
                    where r.user_id = uid and coalesce(r.project_id::text, 't:' || r.project_text) = v_key
                      and lower(r.scene_text) = lower(v_scene)
                      and r.state = 'declined' and r.decided_at > now() - interval '24 hours');
  select * into cur from public.scene_access_requests r
  where r.user_id = uid and coalesce(r.project_id::text, 't:' || r.project_text) = v_key
    and lower(r.scene_text) = lower(v_scene) and r.state in ('pending', 'void')
  for update;
  if found then
    -- Repetido: renueva su fila como mucho una vez por hora; un `void` vuelve a `pending` pasado el día del rechazo.
    if cur.asked_at < now() - interval '1 hour' then
      update public.scene_access_requests set asked_at = now(), times = least(times + 1, 1000) where id = cur.id;
    end if;
    if cur.state = 'void' and not v_void then
      update public.scene_access_requests set state = 'pending' where id = cur.id;
    end if;
    return 'sent';
  end if;
  insert into public.scene_access_requests (user_id, project_id, project_text, scene_text, state)
  values (uid, p_project, v_text, v_scene, case when v_void then 'void' else 'pending' end);
  return 'sent';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Los pendientes de quien decide
-- ---------------------------------------------------------------------------------------------------
-- Los de 30 días, de miembros vivos, que quien llama (dueño o admin, nunca un invitado) puede decidir: una fila por
-- proyecto que resuelve el pedido entre los que quien llama puede compartir, sin los de quien ya ve ese proyecto entero.
-- De cada persona, solo sus 20 pendientes más nuevos (el tope de abiertos vive acá y no al pedir: quien pide no ve la
-- lista, así que un rechazo no le cambia ninguna respuesta). Hasta 100. Con el texto que escribió quien pide
-- (`project_text`, ya normalizado: no dice nada que quien pide no sepa) y si el proyecto salió por el id o el nombre entero (`exact`) o por la primera palabra. Nunca cuántos coinciden.
-- Costo: por cada pedido pendiente, `scene_request_projects` (con texto, una pasada por los proyectos) y un `can_share`.
create function public.scene_access_requests_pending()
returns table (id uuid, user_id uuid, email text, role text, project_id uuid, project_text text, exact boolean,
               scene_text text, asked_at timestamptz, times int)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
begin
  if uid is null or not coalesce(private.workspace_role(uid) in ('owner', 'admin'), false) then
    return;
  end if;
  return query
    select r.id, r.user_id, u.email::text, m.role, c.pid, r.project_text, c.exact, r.scene_text, r.asked_at, r.times
    from (select q.*, row_number() over (partition by q.user_id order by q.asked_at desc, q.id) as n
          from public.scene_access_requests q
          where q.state = 'pending' and q.asked_at > now() - interval '30 days' and q.user_id <> uid) r
    join public.members m on m.user_id = r.user_id and m.removed_at is null
    join auth.users u on u.id = r.user_id
    cross join lateral private.scene_request_projects(r.project_id, r.project_text) as c
    where r.n <= 20 and private.user_project_level(c.pid, r.user_id) < 1
    order by r.asked_at desc, r.id, c.pid
    limit 100;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Decidir
-- ---------------------------------------------------------------------------------------------------
-- «No existe», «ya decidido», «de hace más de 30 días», «no te toca» (no es dueño o admin, no puede compartir ese
-- proyecto, el proyecto no es de los que nombra el pedido) dan el mismo error (`request_not_found`). Dos que deciden a
-- la vez: la fila se bloquea y el segundo recibe `request_not_found`. Dar acceso es `set_page_shares` con esa sola
-- página: sus errores (`clean_off`, `level_invalid`, `page_invalid`, `scene_contains_entities`, `invitation_exists`…)
-- deshacen todo y el pedido sigue pendiente.
create function public.decide_scene_access_request(p_id uuid, p_accept boolean, p_project uuid,
                                                   p_page uuid default null, p_level text default 'view')
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  uid     uuid := auth.uid();
  r       public.scene_access_requests;
  v_email text;
begin
  select * into r from public.scene_access_requests sr where sr.id = p_id for update;
  if not found or r.state <> 'pending' or r.asked_at <= now() - interval '30 days'
     or uid is null or r.user_id = uid
     or not coalesce(private.workspace_role(uid) in ('owner', 'admin'), false)
     or p_project is null
     or not exists (select 1 from private.scene_request_projects(r.project_id, r.project_text) as c
                    where c.pid = p_project) then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  if p_accept is null then
    raise exception 'decision_invalid' using errcode = '22023';
  end if;
  if not p_accept then
    update public.scene_access_requests
    set state = 'declined', decided_at = now(), decided_by = uid, decided_project = p_project
    where id = p_id;
    return 'declined';
  end if;
  if p_level is null or p_level not in ('view', 'comment') then
    raise exception 'level_invalid' using errcode = '22023';
  end if;
  if p_page is null then
    raise exception 'page_invalid' using errcode = '22023';
  end if;
  -- Quien pidió sigue siendo miembro (sacado, `set_page_shares` lo invitaría como alguien nuevo). La fila de la
  -- membresía queda bloqueada hasta el final: un `remove_member` a la vez espera y no lo deja con permiso recién dado.
  select u.email::text into v_email
  from auth.users u
  join public.members m on m.user_id = u.id and m.removed_at is null
  where u.id = r.user_id
  for share of m;
  if v_email is null then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  -- Las reglas de *Share scenes*, todas: no se repiten acá.
  perform public.set_page_shares(p_project, v_email, array[p_page], '{}'::uuid[], p_level);
  update public.scene_access_requests
  set state = 'accepted', decided_at = now(), decided_by = uid, decided_project = p_project, page_id = p_page,
      level = p_level
  where id = p_id;
  return 'accepted';
end;
$$;

revoke all on function public.request_scene_access(uuid, text, text) from public, anon;
revoke all on function public.scene_access_requests_pending() from public, anon;
revoke all on function public.decide_scene_access_request(uuid, boolean, uuid, uuid, text) from public, anon;
grant execute on function public.request_scene_access(uuid, text, text) to authenticated;
grant execute on function public.scene_access_requests_pending() to authenticated;
grant execute on function public.decide_scene_access_request(uuid, boolean, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 6. Versión de la base: la app ofrece pedir una escena y muestra esos pedidos desde la 29.
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 29 where id and schema_version < 29;

notify pgrst, 'reload schema';
