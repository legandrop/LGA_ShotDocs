-- LGA Shot Docs · comentarios que vuelven de un archivo exportado (Docs/Doc_Exportar.md, sección 3; P.22, entrega 3).
--
-- Volver a Shot Docs desde el zip que arma la app (*Import Shot Docs archive…*) trae los comentarios con
-- `import_comment`, como los de Coda. La columna `imported_from` aceptaba solo `'coda'` ("uno nuevo se suma con su
-- migración"): se suma `'shotdocs'`. Nada más cambia: la función, los permisos y las vistas son los mismos.
--
-- Compatible con la app publicada: una versión que no conoce `'shotdocs'` muestra el comentario como importado con ese
-- nombre de origen, sin perder nada. La app nueva importa los comentarios de un archivo solo con la base en la versión
-- 18 o más (`ARCHIVE_COMMENTS_SCHEMA_VERSION`); con una base anterior los deja para seguir la importación después.

-- La restricción de la columna se creó sin nombre propio (`comments_imported_from_check`): se busca por lo que dice.
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.comments'::regclass and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%imported_from%'
      and pg_get_constraintdef(con.oid) like '%''coda''%'
      and con.conname <> 'comments_imported_from'
  loop
    execute format('alter table public.comments drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table public.comments drop constraint if exists comments_imported_from;
alter table public.comments
  add constraint comments_imported_from check (imported_from in ('coda', 'shotdocs'));

-- ---------------------------------------------------------------------------------------------------
-- Versión de la base
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 18 where id and schema_version < 18;

notify pgrst, 'reload schema';
