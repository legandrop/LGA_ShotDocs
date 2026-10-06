-- LGA Shot Docs · los ajustes de una página se fusionan por clave (Docs/Doc_Plantillas.md, sección 8;
-- Docs/Doc_Sincronizacion.md, "Árbol de páginas").
--
-- `pages.settings` es un objeto con una clave por ajuste (formato de hoja, encabezado, títulos divididos, la marca de
-- plantilla, la carpeta de reportes…). Hasta acá la app subía el objeto entero en cada cambio: si dos dispositivos
-- cambiaban a la vez dos claves distintas de la misma página, quedaba el objeto del último que llegaba y la clave del
-- otro se perdía (la marca de la carpeta de reportes, por ejemplo).
--
-- `patch_page_settings(página, poner, sacar)` cambia solo las claves que el cambio tocó, sobre lo que la fila tenga en
-- ese momento: `settings = (settings || poner) - sacar`. Repetirla deja lo mismo.
--
-- Permisos: ninguno nuevo. La función corre con los permisos de quien la llama (no es `security definer`): el `update`
-- de adentro pasa por las mismas políticas de Row Level Security (editar la página: nivel 3), el mismo privilegio de
-- columna, los mismos triggers y la misma política de la versión mínima (`pages_app_version_update`) que el `update`
-- directo de la app. Quien no puede cambiar `settings` por la tabla tampoco puede por acá, y no cambia ninguna otra
-- columna. Sin fila tocada (la sesión no ve la página o no la puede editar) devuelve `null`, sin error: lo mismo que
-- el `update` directo, que no toca ninguna fila.
--
-- Compatible con la app y el portero publicados: no cambia tablas, políticas ni funciones; las versiones anteriores
-- siguen subiendo el objeto entero por la tabla, como siempre. No sube `schema_version`: la app nueva prueba la función
-- y, si la base no la tiene, sube el objeto entero.

create function public.patch_page_settings(p_page_id uuid, p_set jsonb, p_unset text[])
returns jsonb
language plpgsql set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_set is not null and jsonb_typeof(p_set) <> 'object' then
    raise exception 'settings_invalid' using errcode = '22023';
  end if;
  update public.pages p
     set settings = (p.settings || coalesce(p_set, '{}'::jsonb)) - coalesce(p_unset, '{}'::text[])
   where p.id = p_page_id
  returning p.settings into v;
  -- `null`: ninguna fila (la sesión no la ve o no la puede editar).
  return v;
end;
$$;

revoke all on function public.patch_page_settings(uuid, jsonb, text[]) from public, anon;
grant execute on function public.patch_page_settings(uuid, jsonb, text[]) to authenticated;

notify pgrst, 'reload schema';
