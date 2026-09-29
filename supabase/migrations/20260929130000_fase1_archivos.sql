-- LGA Shot Docs · fase 1: imágenes de las páginas en Supabase Storage.
--
-- Cada archivo vive en `page-files/<page_id>/<file_id>.<ext>` y sigue los permisos de su página: quien
-- ve la página ve sus archivos y quien la edita puede subirle archivos. No se reemplazan ni se borran
-- desde la app.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('page-files', 'page-files', false, 26214400, array['image/*'])
on conflict (id) do nothing;

create function private.try_uuid(s text)
returns uuid
language plpgsql immutable
as $$
begin
  return s::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

revoke all on function private.try_uuid(text) from public, anon;
grant execute on function private.try_uuid(text) to authenticated;

create policy page_files_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'page-files'
    and private.can_view_page(private.try_uuid((storage.foldername(name))[1]))
  );

create policy page_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'page-files'
    and private.can_edit_page(private.try_uuid((storage.foldername(name))[1]))
  );
