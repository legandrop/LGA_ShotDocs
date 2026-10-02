-- La política del workspace sobre el asistente (Docs/Doc_Asistente.md, sección 7.3; decisión IA7, entrega A1).
--
-- `workspace_settings.assistant_policy`:
--   on          de fábrica: cada persona usa el asistente con su propia clave y el proveedor que quiera.
--   local_only  solo modelos locales (una dirección de la máquina o de una red privada): nada sale a un proveedor.
--   off         el asistente apagado para todos.
--
-- En la app es una regla, no una barrera: quien puede leer una página la puede copiar a mano a cualquier lado. La app la
-- lee con el resto de la fila (`select *`, como hoy) y, sin la columna (una base sin esta migración), toma `on`. El
-- servidor MCP (entregas M1 y M2) la va a mirar dentro de sus funciones, donde sí es una barrera.
--
-- Sin interfaz todavía: la ventana para cambiarla (dueño y admins) es de la entrega A2, con su función. Mientras tanto
-- se cambia solo desde el SQL Editor. Como el resto de la fila, nadie la escribe desde la API (`workspace_settings`
-- tiene solo `select` para `authenticated`).
--
-- No sube `schema_version`: la app no necesita saber si la columna está (sin ella vale `on`), y subirlo antes de que
-- estén aplicadas las migraciones con números anteriores haría creer a la app que ya están.
--
-- Compatible con la app y el portero publicados: una columna nueva con valor de fábrica; nadie la lee todavía.

alter table public.workspace_settings
  add column assistant_policy text not null default 'on'
    constraint workspace_settings_assistant_policy check (assistant_policy in ('on', 'local_only', 'off'));

comment on column public.workspace_settings.assistant_policy is
  'Asistente: on (de fábrica), local_only (solo modelos locales) u off. Docs/Doc_Asistente.md, 7.3.';

notify pgrst, 'reload schema';
