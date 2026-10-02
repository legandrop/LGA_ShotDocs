-- LGA Shot Docs · compactar el contenido, entrega 3: PRENDER los snapshots (Docs/Doc_Compactar.md, "Cómo quedó la
-- entrega 3").
--
-- Deja todo listo para prenderlos y los deja como estén (la entrega 1 los dejó apagados). Tres cambios, ninguno toca
-- datos ni tablas:
--
--   1. `pull_page_content(page, after, limit)` (sin versión: la llaman v0.127 a v0.133) deja de servir snapshots: devuelve
--      siempre las filas de `pull_page_updates` con la época. Esas versiones tienen el reinicio que vuelve a subir la
--      página entera cuando se invalida un snapshot (O1, v0.127 a v0.129) o guardan en memoria la marca del rearmado
--      (R-1, v0.133): si nunca reciben un snapshot, nunca pueden perder ni ocultar texto por uno. Con los snapshots
--      apagados (como hoy) devuelve lo mismo que antes.
--   2. `pull_page_content(page, after, limit, app_version)` (desde esta entrega): lo de antes, solo para una versión
--      que la base permite (`app_version_allowed`), y con la huella guardada del snapshot (`sha256`, hex). El
--      dispositivo comprueba la huella antes de aplicarlo: una copia corrupta en la base no se aplica nunca y quien ve
--      lo borrado la invalida; una que no se puede leer pero con la huella bien es de una versión más nueva (O-D).
--   3. `pull_page_snapshot_checked(id)`: como `pull_page_snapshot` (mismos controles: la llama), con la huella guardada.
--      Quien compacta la usa para la base: si la base no coincide con su huella, invalida la cadena en vez de saltear la
--      página 24 horas cada vez (O-D).
--
-- No sube `schema_version`: sin esta migración la app no encuentra la función con versión (PGRST202) y baja filas con
-- `pull_page_updates`, igual que con los snapshots apagados. Prenderlos (no lo hace esta migración):
--   update public.workspace_settings set snapshot_min_version = <versión de la entrega 3>,
--                                        min_app_version = greatest(coalesce(min_app_version, 0), <versión de la entrega 3>)
--   where id;

-- ---------------------------------------------------------------------------------------------------
-- 1. La de siempre (sin versión): solo filas
-- ---------------------------------------------------------------------------------------------------
create or replace function public.pull_page_content(p_page_id uuid, p_after_seq bigint, p_limit int default 200)
returns table (seq bigint, update text, snapshot_id uuid, content_epoch int)
language plpgsql stable security definer set search_path = ''
as $$
declare
  ep int;
begin
  if not private.can_view_page(p_page_id) then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  select pg.content_epoch into ep from public.pages pg where pg.id = p_page_id;
  -- Nunca un snapshot: las versiones que llaman sin versión bajan lo de siempre (también la base limpia).
  return query
    select r.seq, r.update, null::uuid, ep
    from public.pull_page_updates(p_page_id, coalesce(p_after_seq, 0), least(greatest(coalesce(p_limit, 200), 1), 1000)) r;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Con la versión de la app: el snapshot (si conviene) con su huella
-- ---------------------------------------------------------------------------------------------------
-- Como la de la entrega 1: si quien llama ve lo borrado, su versión está permitida y hay un snapshot vigente que llega
-- más allá de `p_after_seq` y pesa menos que las filas que reemplaza, primero el snapshot (con `seq = up_to_seq` y su
-- huella) y después las filas siguientes, hasta `p_limit` en total. Si no, las filas de `pull_page_updates`.
create function public.pull_page_content(p_page_id uuid, p_after_seq bigint, p_limit int, p_app_version text)
returns table (seq bigint, update text, snapshot_id uuid, content_epoch int, sha256 text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  s        public.page_snapshots;
  ep       int;
  from_seq bigint := coalesce(p_after_seq, 0);
  lim      int := least(greatest(coalesce(p_limit, 200), 1), 1000);
begin
  if not private.can_view_page(p_page_id) then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  select pg.content_epoch into ep from public.pages pg where pg.id = p_page_id;
  if private.sees_deleted(p_page_id) and private.app_version_allowed(p_app_version) then
    s := private.current_snapshot(p_page_id);
    if s.id is not null and s.up_to_seq > from_seq
       and s.state_bytes < (select coalesce(sum(octet_length(u.update)), 0) from public.page_updates u
                            where u.page_id = p_page_id and u.seq > from_seq and u.seq <= s.up_to_seq) then
      return query select s.up_to_seq, translate(encode(s.state, 'base64'), E'\n', ''), s.id, ep, encode(s.sha256, 'hex');
      lim := lim - 1;
      if lim = 0 then
        return;
      end if;
      return query
        select u.seq, translate(encode(u.update, 'base64'), E'\n', ''), null::uuid, ep, null::text
        from public.page_updates u
        where u.page_id = p_page_id and u.seq > s.up_to_seq
        order by u.seq
        limit lim;
      return;
    end if;
  end if;
  return query
    select r.seq, r.update, null::uuid, ep, null::text
    from public.pull_page_updates(p_page_id, from_seq, lim) r;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Un snapshot con su huella guardada (para quien compacta)
-- ---------------------------------------------------------------------------------------------------
-- Los controles son los de `pull_page_snapshot` (la llama primero: si no deja, el mismo error).
create function public.pull_page_snapshot_checked(p_id uuid)
returns table (state text, sha256 text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  st text;
begin
  st := public.pull_page_snapshot(p_id);
  return query select st, encode(ps.sha256, 'hex') from public.page_snapshots ps where ps.id = p_id;
end;
$$;

-- `create or replace` conserva los permisos de la de siempre; se repiten por si alguien la aplica sobre otra base.
revoke all on function public.pull_page_content(uuid, bigint, int) from public, anon;
revoke all on function public.pull_page_content(uuid, bigint, int, text) from public, anon;
revoke all on function public.pull_page_snapshot_checked(uuid) from public, anon;
grant execute on function public.pull_page_content(uuid, bigint, int) to authenticated;
grant execute on function public.pull_page_content(uuid, bigint, int, text) to authenticated;
grant execute on function public.pull_page_snapshot_checked(uuid) to authenticated;

notify pgrst, 'reload schema';
