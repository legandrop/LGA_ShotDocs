-- La ventana de la política del asistente (Docs/Doc_Asistente.md, sección 7.3; decisión IA7, entrega A2).
--
-- `workspace_settings.assistant_policy` existe desde 20261014120000_asistente_politica.sql (on, local_only u off) y
-- nadie la podía cambiar desde la API: la fila entera es de solo lectura para `authenticated`. Esta migración suma la
-- única puerta para escribirla: `set_assistant_policy(p_policy)`, que solo deja al dueño y a los admins del workspace
-- (el rol de `private.workspace_role()`, que ya pide una sesión de la app). Un miembro, un invitado, quien fue sacado
-- del workspace y quien no entró reciben `not_allowed` (42501); un valor que no es de los tres, `invalid_policy`
-- (22023). La función toca solo esa columna: la generación, la versión mínima y el resto de la fila siguen sin puerta.
--
-- En la app la política es una regla, no una barrera (quien lee una página la puede copiar a mano): lo que protege
-- esta función es quién puede cambiar la regla. El servidor MCP (M1, M2) la va a mirar en la base, donde sí es barrera.
--
-- No sube `schema_version`: la app no necesita saber si la función está (sin ella, la ventana dice que la base del
-- workspace necesita actualizarse y la política sigue como estaba).
--
-- Compatible con la app y el portero publicados: una función nueva que nadie llama todavía.

create function public.set_assistant_policy(p_policy text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  my_role text := private.workspace_role();
begin
  if my_role is null or my_role not in ('owner', 'admin') then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'Only the owner and the admins of the workspace change the assistant policy.';
  end if;
  if p_policy is null or p_policy not in ('on', 'local_only', 'off') then
    raise exception 'invalid_policy' using errcode = '22023';
  end if;
  update public.workspace_settings set assistant_policy = p_policy where id;
  return p_policy;
end;
$$;

comment on function public.set_assistant_policy(text) is
  'Asistente: el dueño y los admins cambian workspace_settings.assistant_policy. Docs/Doc_Asistente.md, 7.3.';

revoke all on function public.set_assistant_policy(text) from public, anon;
grant execute on function public.set_assistant_policy(text) to authenticated;

notify pgrst, 'reload schema';
