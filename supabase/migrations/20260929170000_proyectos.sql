-- LGA Shot Docs · proyectos: cada usuario puede tener varios.
--
-- Un proyecto es un `workspace`: tiene su propio árbol de páginas y más adelante se va a poder compartir
-- entero (fase 2). El dispositivo genera el id, igual que con las páginas, así que un proyecto se puede
-- crear sin red y sube antes que sus páginas.

-- El dueño es siempre quien lo crea: la columna no se puede escribir desde la API.
alter table public.workspaces alter column owner_id set default auth.uid();
alter table public.workspaces alter column name set default 'My project';

create policy workspaces_insert on public.workspaces
  for insert to authenticated with check (owner_id = (select auth.uid()));

grant insert (id, name) on public.workspaces to authenticated;
