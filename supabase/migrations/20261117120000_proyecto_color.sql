-- LGA Shot Docs · el color de cada proyecto (Docs/Doc_Navegacion.md, «Color del proyecto»).
--
-- Cada proyecto tenía un recuadro amarillo con dos letras. Ahora es un punto de color que se elige con un picker (como
-- el de las apps de escritorio de LGA), y el mismo punto marca a qué proyecto pertenece cada tab.
--
-- `workspaces.color`: `#rrggbb` en minúsculas, o `null` (sin elegir: la app usa uno de su paleta según el id, siempre el
-- mismo). Lo cambia quien puede renombrar el proyecto (nivel 4, la política `workspaces_update` de siempre): se le da
-- `grant update` solo a esta columna, como a `name`. Lo leen todos los que ven el proyecto (`grant select` de tabla).
--
-- Sube `schema_version` a 27: la app nueva pide la columna y muestra el picker solo desde esa versión; una app más vieja
-- no la pide y sigue igual.

alter table public.workspaces
  add column color text,
  add constraint workspaces_color_hex check (color is null or color ~ '^#[0-9a-f]{6}$');

grant update (color) on public.workspaces to authenticated;

update public.workspace_settings set schema_version = 27 where id and schema_version < 27;

notify pgrst, 'reload schema';
