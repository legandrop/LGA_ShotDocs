-- LGA Shot Docs · los proyectos favoritos de cada persona (Docs/Doc_Navegacion.md, «Proyectos favoritos»).
--
-- La estrella del selector de proyectos marca un proyecto como favorito y los favoritos se listan primero. En la v0.327
-- se guardaban en cada dispositivo; Lega pidió que se sincronicen entre sus dispositivos.
--
-- `project_favorites`: una fila por persona y proyecto. Cada persona ve, marca y desmarca solo las suyas, y solo puede
-- marcar un proyecto que ve (la subconsulta sobre `workspaces` corre con su RLS). Nadie más las lee: es una preferencia
-- personal, no dice nada del proyecto. La app las pide junto con la lista de proyectos (`workspaces` con
-- `project_favorites(project_id)` embebido: por la FK, PostgREST trae solo las filas que la RLS deja ver, las propias).
-- Si se borra la fila de un proyecto o de un usuario, se borran sus filas (cascade). *Delete forever* no borra la fila
-- del proyecto (pone `purged_at`): como un proyecto que la persona deja de ver, deja de venir en la lista y su fila
-- queda sin efecto (solo la ve quien la marcó, y solo con el id de un proyecto que ya conocía).
--
-- Sube `schema_version` a 30: la app nueva pide los favoritos solo desde esa versión; una más vieja no los pide y sigue
-- igual.

create table public.project_favorites (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.workspaces (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

create index project_favorites_project on public.project_favorites (project_id);

alter table public.project_favorites enable row level security;
revoke all on public.project_favorites from public, anon, authenticated;
grant select, insert, delete on public.project_favorites to authenticated;

create policy project_favorites_select on public.project_favorites
  for select to authenticated
  using (user_id = (select auth.uid()) and private.session_allowed());

create policy project_favorites_insert on public.project_favorites
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.session_allowed()
    and exists (select 1 from public.workspaces w where w.id = project_id)
  );

create policy project_favorites_delete on public.project_favorites
  for delete to authenticated
  using (user_id = (select auth.uid()) and private.session_allowed());

update public.workspace_settings set schema_version = 30 where id and schema_version < 30;

notify pgrst, 'reload schema';
