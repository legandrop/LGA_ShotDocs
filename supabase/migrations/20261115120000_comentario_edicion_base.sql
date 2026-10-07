-- LGA Shot Docs · editar un comentario sin pisar una edición posterior (Docs/Doc_Sincronizacion.md, "Comentarios y
-- preguntas": "Dos ediciones del mismo comentario").
--
-- `edit_comment(p_id, p_body)` guarda lo último que **llega**. Si la misma persona edita el mismo comentario en dos
-- dispositivos (solo quien lo escribió lo edita), una edición escrita antes pero subida después (un teléfono que estuvo
-- sin red) pisaba en silencio la posterior: el texto pisado no quedaba en ningún lado.
--
-- Esta migración suma una segunda firma, `edit_comment(p_id, p_body, p_base)`. `p_base` es **el texto que el
-- dispositivo tenía cuando la persona empezó a editar**. La base cambia el texto solo si el que tiene sigue siendo
-- ese; si ya es otro, **no escribe nada** y contesta `{"conflict": true, "body": <el texto de ahora>, "edited_at": …}`,
-- para que la app deje la edición propia a la vista, al lado de lo guardado, y la persona decida.
--
-- Por qué se compara el texto y no `edited_at`:
--   - un comentario nunca editado (`edited_at` nulo) no es un caso aparte;
--   - no depende de cómo viaja una fecha (los microsegundos de `timestamptz`) ni de la hora de ningún dispositivo;
--   - dos ediciones seguidas del mismo dispositivo se encadenan solas: la segunda lleva de base el texto de la
--     primera, que es el que la base tiene cuando la primera llegó;
--   - el reintento de una edición que llegó pero cuya respuesta se perdió encuentra su mismo texto: da bien, sin
--     escribir (como en la firma de dos argumentos), antes de mirar la base.
--
-- Todo lo demás es lo de la firma de dos argumentos, en el mismo orden: `comment_not_found` (P0002) si no existe o la
-- sesión no ve su página; `not_allowed` (42501) si no es quien lo escribió; `comment_denied` (42501) si ya no tiene
-- comentar; `comment_deleted` (P0001) si se borró. La comparación va **después** de esos controles: a quien no puede
-- editar el comentario la respuesta no le dice nada del texto. Resolver o reabrir el hilo no cambia el texto, así que
-- no da conflicto. `base_invalid` (22023) con `p_base` nulo: sin base se usa la firma de dos argumentos.
--
-- La versión mínima la sigue frenando el trigger de `comments` (`comments_write_version`), que corre cuando la función
-- escribe; un conflicto no escribe.
--
-- Compatible con la app publicada: **la firma de dos argumentos no se toca** (ni su cuerpo, ni sus atributos, ni sus
-- permisos). PostgREST elige la función por los nombres de los argumentos del pedido: `{p_id, p_body}` es la de
-- siempre y `{p_id, p_body, p_base}` la nueva, como ya pasa con `push_page_update` y su `p_app_version`. No sube
-- `schema_version`: la app nueva manda `p_base` y, con una base sin esta migración (`PGRST202`), sigue con la firma de
-- dos argumentos. Mismos atributos y permisos que la de siempre: `security definer`, `search_path` vacío, solo
-- `authenticated`.

create or replace function public.edit_comment(p_id uuid, p_body text, p_base text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  cur public.comments;
  lvl int;
begin
  -- `for update` es lo que sostiene el caso de dos ediciones simultáneas con la misma base: la segunda espera acá a
  -- que la primera termine, relee la fila ya cambiada y da conflicto. Ninguna prueba de una sola sesión lo ejercita.
  select * into cur from public.comments c where c.id = p_id for update;
  -- El mismo texto: nada que cambiar (el reintento de una edición que ya se hizo), antes de mirar el permiso.
  if found and cur.author_id = auth.uid() and cur.deleted_at is null and cur.body = p_body then
    return jsonb_build_object('conflict', false);
  end if;
  if found then
    lvl := private.page_level(cur.page_id);
  end if;
  if coalesce(lvl, 0) < 1 then
    raise exception 'comment_not_found' using errcode = 'P0002';
  end if;
  if cur.author_id is distinct from auth.uid() then
    raise exception 'not_allowed' using errcode = '42501', hint = 'Only the author edits a comment.';
  end if;
  if lvl < 2 then
    raise exception 'comment_denied' using errcode = '42501';
  end if;
  if cur.deleted_at is not null then
    raise exception 'comment_deleted' using errcode = 'P0001';
  end if;
  if p_base is null then
    raise exception 'base_invalid' using errcode = '22023';
  end if;
  -- El texto ya no es el que el dispositivo tenía: no se pisa. Solo llega hasta acá quien puede editarlo.
  if cur.body <> p_base then
    return jsonb_build_object('conflict', true, 'body', cur.body, 'edited_at', cur.edited_at);
  end if;
  update public.comments set body = p_body, edited_at = now(), updated_at = now() where id = p_id;
  return jsonb_build_object('conflict', false);
end;
$$;

revoke all on function public.edit_comment(uuid, text, text) from public, anon;
grant execute on function public.edit_comment(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
