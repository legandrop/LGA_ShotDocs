-- LGA Shot Docs · bajar del árbol solo lo que cambió (Docs/Doc_Sincronizacion.md, «El árbol en cada vuelta»).
--
-- Cada vuelta de sincronización (cada 10 s con la app a la vista) bajaba la lista entera de páginas de todos los
-- proyectos: con ERSO y VLLF, 1.729 filas y casi 1 MB. Con varias pestañas y servidores de prueba abiertos, eso se llevó
-- en pocos días la cuota de tráfico de salida del plan gratis de Supabase (5 GB por mes).
--
-- `pages.changed_at` es la hora del último cambio de **cualquier** columna de la fila, también de `update_seq`,
-- `clean_seq`, `snapshot_seq` y `content_epoch`, que `updated_at` no mira (el contenido nuevo de una página se anuncia
-- en el árbol con `update_seq`). La app pide en cada vuelta solo las filas con `changed_at` reciente, y la lista entera
-- de vez en cuando: al abrir, cada 30 minutos, si cambian los proyectos, los permisos propios o la generación de la
-- base, y si el total de filas que ve deja de coincidir con su copia.
--
-- La pone un trigger con `clock_timestamp()`, la hora de la escritura y no la del comienzo de la transacción. Una
-- transacción que confirma tarde puede dejar una marca anterior a lo que la app ya pidió: por eso la app vuelve a pedir
-- desde un par de minutos antes de su última marca mientras es reciente, y la lista entera de cada tanto cubre lo que
-- quede.
--
-- No se escribe desde la API (`pages` no tiene `grant update` de esta columna) y se lee con el árbol (`grant select` de
-- tabla). Las filas que ya existen arrancan con una marca vieja (2000-01-01): con la hora de la migración, todas serían
-- "recientes" a la vez y la app las volvería a pedir en cada vuelta durante el solape. Sube `schema_version` a 26: la
-- app nueva pide por cambios solo desde esa versión; una app más vieja no pide la columna y sigue bajando la lista
-- entera.

alter table public.pages add column changed_at timestamptz not null default '2000-01-01 00:00:00+00';
alter table public.pages alter column changed_at set default now();

create function private.pages_changed_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.changed_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.pages_changed_at() from public, anon, authenticated;

-- Los triggers `before` de una tabla corren por orden alfabético: `zz_` lo deja último, después de los que pueden
-- tocar la fila.
create trigger zz_pages_changed_at
before insert or update on public.pages
for each row execute function private.pages_changed_at();

create index pages_workspace_changed_idx on public.pages (workspace_id, changed_at);

update public.workspace_settings set schema_version = 26 where id and schema_version < 26;

notify pgrst, 'reload schema';
