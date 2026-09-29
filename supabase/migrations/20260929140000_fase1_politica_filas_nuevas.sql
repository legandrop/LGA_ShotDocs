-- LGA Shot Docs · fase 1: crear páginas con upsert.
--
-- `insert ... on conflict do nothing` (así crea páginas la app, para que reintentar no falle) también
-- evalúa la política de lectura sobre la fila nueva. La política anterior buscaba la página por id en la
-- tabla, donde la fila nueva todavía no está, y rechazaba la creación. Ahora decide con los datos de la
-- propia fila: el dueño del espacio la ve siempre, y el resto de los permisos (fase 2) se sigue
-- resolviendo por id en can_view_page().

create function private.can_view_page_row(p_id uuid, p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_workspace_owner(p_workspace_id) or private.can_view_page(p_id);
$$;

revoke all on function private.can_view_page_row(uuid, uuid) from public, anon;
grant execute on function private.can_view_page_row(uuid, uuid) to authenticated;

drop policy pages_select on public.pages;
create policy pages_select on public.pages
  for select to authenticated using (private.can_view_page_row(id, workspace_id));
