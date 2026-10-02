-- LGA Shot Docs · compactar el contenido, entrega 2: CREAR snapshots (Docs/Doc_Compactar.md, secciones 4, 10 y 12).
--
-- La entrega 2 es casi toda de la app: el dispositivo de quien edita arma los snapshots y los sube con las funciones de
-- la entrega 1 (20261019120000_compactar_leer.sql), que no cambian. Esta migración cambia una sola cosa:
--
--   - `invalidate_page_snapshot` pide ver lo borrado (`private.sees_deleted`), como reservar, subir, bajar, confirmar y
--     saltear. Antes alcanzaba con poder editar la página, así que un invitado con Editar podía invalidar una cadena
--     (sin ver nunca un snapshot), y cada invalidación hace que los dispositivos que la usaron vuelvan a bajar la página
--     (auditoría de la entrega 1, O3). Quien ve lo borrado sigue pudiendo invalidar a mano.
--
-- No toca datos ni tablas, y deja los snapshots como estén (la entrega 1 los deja apagados). No sube `schema_version`:
-- la app no necesita saber si está (la app invalida solo con quien ve lo borrado), y una base sin ella sigue igual.

create or replace function public.invalidate_page_snapshot(p_id uuid, p_reason text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  s public.page_snapshots;
begin
  select * into s from public.page_snapshots ps where ps.id = p_id;
  if not found or not private.can_view_page(s.page_id) then
    raise exception 'snapshot_not_found' using errcode = 'P0002';
  end if;
  -- Ver lo borrado: Editar o más y no invitado (D14). Un invitado con Editar no recibe snapshots ni los invalida.
  if not private.sees_deleted(s.page_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform 1 from public.pages pg where pg.id = s.page_id for update;
  return private.invalidate_snapshot_chain(s.page_id, s.chain_id, p_reason) > 0;
end;
$$;

-- `create or replace` conserva los permisos de la entrega 1; se repiten por si alguien la aplica sobre otra base.
revoke all on function public.invalidate_page_snapshot(uuid, text) from public, anon;
grant execute on function public.invalidate_page_snapshot(uuid, text) to authenticated;

notify pgrst, 'reload schema';
