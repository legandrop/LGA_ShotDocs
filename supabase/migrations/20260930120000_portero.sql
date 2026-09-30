-- LGA Shot Docs · portero de archivos: quién es el dueño del workspace y dónde está su portero.
-- Ver Docs/Plan_Workspaces.md (secciones 5 y 6).

--   owner_id   El dueño del workspace: el único que conecta su Drive. Arranca como el dueño del primer
--              proyecto (en una base nueva queda vacío hasta que el comando de instalación lo complete).
--   media_url  La dirección del portero de archivos (un Worker de Cloudflare del dueño). Vacía: todavía no
--              hay portero.
alter table public.workspace_settings
  add column owner_id  uuid references auth.users (id) on delete set null,
  add column media_url text check (media_url is null or media_url ~ '^https://[^/?#]+$');

update public.workspace_settings
set owner_id = (select w.owner_id from public.workspaces w order by w.created_at limit 1)
where id and owner_id is null;

-- Quién es la sesión que llama y si es el dueño del workspace. La usa el portero con la sesión de cada
-- persona: así sabe quién pide algo sin tener ninguna clave de la base.
create function public.media_whoami()
returns json
language sql stable security definer set search_path = ''
as $$
  select json_build_object(
    'user_id', auth.uid(),
    'is_owner', coalesce((select s.owner_id = auth.uid() from public.workspace_settings s where s.id), false));
$$;

revoke all on function public.media_whoami() from public, anon;
grant execute on function public.media_whoami() to authenticated;

notify pgrst, 'reload schema';
