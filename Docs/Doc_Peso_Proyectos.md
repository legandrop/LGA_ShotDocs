# Cuánto ocupa cada proyecto en el Drive (P.7), y la lista por peso (P.8)

Estado: **auditado antes de implementar** (2026-09-30). "Correcciones de la auditoría previa" manda sobre lo anterior. Pedido de Lega: "sería
bueno tener el peso en Drive de cada proyecto, de alguna forma que esté visible, tal vez al momento de elegir
proyectos… para que el usuario vea 'este proyecto me está ocupando 30 gigas en el Drive'. Más adelante (no
urgente) ver toda la media ordenada por peso, cliquear e ir a la página donde está, y decidir si la deja, la
borra o la reemplaza." En el roadmap, P.7 y P.8.

## Resumen

- **El número:** los bytes que la app subió al Drive y que no mandó a la papelera de Drive (incluye la
  papelera de la app, que sigue ocupando lugar). Suma de `files.size` por `files.project_id`, sin preguntarle a
  Drive (el portero sube exactamente ese peso: rechaza un tamaño que no coincide).
- **De dónde sale:** una función nueva, `public.project_sizes()`, security definer, que devuelve todos los
  proyectos de una vez. Migración nueva; `schema_version` 7.
- **Quién lo ve:** quien ya ve la papelera de archivos del proyecto (`private.can_see_file_trash`): el dueño,
  los admins con algún permiso sobre el proyecto entero y quien tiene "Editar y crear páginas" sobre el
  proyecto entero. Ver, Comentar, Editar e invitados, no.
- **Dónde:** en el renglón de cada proyecto del selector ("12 páginas · 3,4 GB · editado hoy"); en el diálogo de
  Google Drive (solo el dueño), una sección *Espacio en Drive* con el total, el detalle por proyecto y el
  desglose; y arriba de la pestaña Archivos de la papelera (sumado en el cliente).
- **Caché:** en la base local (`meta`, clave `projectSizes`), pedido como mucho cada 5 minutos; sin red, el
  último valor. Si la base no tiene la función, no se muestra nada.

## 1. Qué cuenta

| Estado del archivo | ¿Ocupa en Drive? | Cómo se cuenta |
|---|---|---|
| Subido (`drive_id`), fuera de la papelera | Sí | Número principal |
| Subido, en la papelera de la app (`trashed_at`, sin `drive_trashed_at`) | Sí | Número principal, y aparte "en la papelera: se puede liberar" |
| En la papelera de Drive hace menos de 30 días | Sí, hasta que Google la vacía | Solo en el detalle |
| En la papelera de Drive hace más de 30 días | No (Google ya lo borró) | No |
| Registrado y todavía sin subir | Todavía no | Solo en el detalle: "todavía subiendo desde los dispositivos" |

La papelera de Drive queda fuera del número principal para que el número baje al vaciar la papelera de la
app. Un uso de otro proyecto (`is_foreign`) no suma dos veces: se suma por el proyecto dueño del archivo. El
número no ve lo que se hizo a mano en Drive, los archivos de la vieja prueba de media ni las miniaturas (que
están en Supabase): lo dice una línea del diálogo.

## 2. De dónde sale

- **Descartado sumar desde el cliente:** PostgREST no suma (los agregados vienen apagados en Supabase), habría
  que bajar una fila por archivo, y la política de `files` calcula permisos por fila (recursión hasta la raíz
  de cada página): pesado para el plan gratis, y daría "lo que yo veo" en vez de "lo que ocupa".
- **Descartado un contador con triggers:** muchos caminos que mantener; la suma en vivo es barata.
- **Elegido `project_sizes()`**, como `trashed_files`: `search_path = ''`, sin `anon`, el permiso calculado una
  vez por proyecto y un recorrido de `files` agrupado por el índice que ya existe. Devuelve también los
  proyectos permitidos sin archivos (en cero) y, **solo para el dueño**, una fila sin proyecto con el total de
  los proyectos que no ve enteros (privados de otros, sin heredero), sin nombres (decisión 2).
- **Caché:** store sin React (`src/media/projectSizes.ts`), pedido una vez por apertura (después de la
  primera sincronización y solo si la persona ve alguna papelera), al abrir el selector si pasaron 5 minutos,
  siempre al abrir el diálogo de Drive y después de mandar archivos a la papelera de Drive. Nunca en cada
  render. Con `schemaVersion` menor que 7 no se pide; si igual falta la función (`PGRST202`), no se muestra y no
  se vuelve a probar por 10 minutos.

## 3. Dónde se muestra

- **Selector (principal):** subtítulo "páginas · peso · editado"; si no entra, el "…" corta la fecha y no el
  peso. Mismo color y tamaño. Sin peso si es cero o no hay permiso. Igual en la hoja del teléfono.
- **Diálogo de Google Drive (detalle, solo el dueño):** "Espacio en Drive: 34,2 GB en 1.203 archivos", los
  proyectos ordenados por peso (tocar uno cambia a ese proyecto), el desglose en letra chica (en la papelera,
  en la papelera de Drive, todavía subiendo, proyectos que no ves), la nota de qué cuenta y "Actualizado 14:32 ·
  Volver a calcular" (sin red: "último cálculo del…").
- **Papelera → Archivos:** "14 archivos · 2,1 GB" arriba, y la confirmación de vaciar dice cuánto libera.
  Barato de sumar: ordenar la lista por fecha o por peso.
- En el botón de la barra lateral no (ruido, lo ve todo el equipo).

## 4. Formato

`formatTotal(bytes)` junto a `formatSize` (`src/media/fileTrash.ts`): 0 no se muestra; "0,4 MB", "61,9 MB", "820
MB", "3,4 GB", "30 GB", "1,2 TB"; separadores del idioma; base 1024 como cuenta Google (a verificar a mano con un
archivo conocido). `formatSize` suma TB.

## 5. Media por peso (P.8, esbozo)

Una función `project_files_by_size(proyecto, límite, cursor)` con la misma puerta, que devuelve nombre, tipo,
peso, estado y la primera página viva que lo usa (con su título solo si la sesión la ve); una vista como la
papelera, "Archivos del proyecto", ordenada por peso; ir a la página y dejar elegido el bloque; y las tres
acciones: dejarlo, borrarlo (se saca el bloque; entra solo a la papelera) o reemplazarlo ("Reemplazar
archivo…" en su barra, que conserva el ancho y el pie). Con su migración, más adelante.

## 6. Migración

`supabase/migrations/20260930190000_peso_proyectos.sql`: solo agrega `public.project_sizes()` (devuelve por
proyecto `drive_bytes/files`, `trash_bytes/files`, `drive_trash_bytes/files`, `pending_bytes/files`) y sube
`schema_version` a 7. Prueba `supabase/tests/peso_proyectos_permisos.sql` en rollback con dueña, admin, admin
dueña de un proyecto privado, miembro con "Editar y crear páginas", miembro con "Editar", invitada, miembro
sacada, sesión con contraseña y `anon`, con archivos en cada estado (en uso con un uso ajeno, en la papelera,
en la papelera de Drive hoy y hace 40 días, sin subir); que llamarla no cambia nada; y que la dueña sigue
viendo y editando todo.

- La app publicada no la llama: no cambia nada.
- La app nueva sube `DB_SCHEMA_VERSION` a 7: un workspace sin migrar ve el aviso de siempre y el peso no se
  muestra; todo lo demás sigue.
- Sin propiedades nuevas en el editor ni cambios en el portero: no hace falta subir `min_app_version`.
- Aplicarla en producción pide autorización de Lega (copia de seguridad antes, `npm run db:migrate`,
  `npm run db:test`).

## 7. Implementación

Migración y prueba SQL; `ProjectSizeRow` en `src/sync/types.ts`; `projectSizes()` en `src/sync/remote.ts` (y
en el `FakeRemote` de pruebas); `src/media/projectSizes.ts`; `formatTotal`; el store en `src/services.ts`; el
subtítulo en `src/ui/ProjectSwitcher.tsx`; la sección en `src/ui/DriveDialog.tsx`; el total en
`src/ui/TrashView.tsx`; `DB_SCHEMA_VERSION = 7`; textos; docs. Pruebas: el store (vida de 5 minutos, sin red,
versión 6 no llama, `PGRST202`, respuesta sin un proyecto lo saca, la fila sin proyecto), `formatTotal` en los
dos idiomas, jsdom del selector, el diálogo y la papelera, y a mano el total de un proyecto contra la carpeta
en Drive.

## Decisiones (a confirmar por Lega)

1. El número principal es lo que está en Drive fuera de su papelera, incluida la papelera de la app.
2. El dueño ve, solo en el diálogo de Drive, el total sin nombres de los proyectos que no ve.
3. Ven el peso quienes ven la papelera de archivos del proyecto.
4. Se muestra en el selector, en el diálogo de Drive y en la papelera; no en el botón de la barra lateral.
5. Base 1024, como Google.

## Correcciones de la auditoría previa (mandan sobre lo de arriba)

1. **Estados excluyentes, en este orden:** (a) `drive_trashed_at` puesto: si está subido y
   `greatest(drive_trashed_at, uploaded_at)` es de hace menos de 30 días, "en la papelera de Drive" (solo en el
   detalle); si no, no cuenta. (b) `trashed_at` puesto: "en la papelera de la app" (el mismo conjunto que
   `trashed_files`, así coincide con el total de la papelera). (c) `drive_id` nulo: "sin subir (esperando a un
   dispositivo)". (d) El resto: en uso. **Número principal = (b) + (d).** Se suma solo `files` agrupado por
   `files.project_id` (sin unir con `page_files`: un uso de otro proyecto no cuenta dos veces).
2. **No se sube `DB_SCHEMA_VERSION`** (en un workspace sin migrar pondría el aviso amarillo para siempre y el
   panel de comentarios diría, en falso, que no se suben). Como la papelera: una constante
   `SIZES_SCHEMA_VERSION = 7` en el store, con la versión de la base expuesta por la sincronización. La migración
   igual pone `schema_version = 7`.
3. **La fila sin proyecto** solo con `private.workspace_role() = 'owner'` (una sesión con contraseña no la
   recibe). La puerta se calcula una vez por proyecto (CTE materializado), nunca por fila de `files`.
4. **SQL:** `language sql`, sumas `::bigint`, `notify pgrst, 'reload schema'`, `revoke` a `public` y `anon`.
5. **Papelera:** la confirmación de vaciar no dice "libera": "pasan a la papelera de Drive; el espacio se libera
   cuando Google la vacía (30 días)", con la suma de lo que se puede vaciar. El orden por peso, con P.8.
6. **Una sola función de formato:** `formatSize` con TB y una regla escrita (un decimal por debajo de 100, sin
   ",0").
7. **Primera entrega más chica:** migración, store, subtítulo del selector (filtrado también por el permiso en el
   dispositivo, para no mostrar un valor guardado viejo) y total de la papelera; en el diálogo de Drive solo el
   total, el desglose en una línea, "proyectos que no ves" y "Actualizado · Volver a calcular". La lista por
   proyecto, con P.8. Pedidos: al abrir el selector si pasaron 5 minutos, siempre al abrir el diálogo de Drive, al
   tocar "Volver a calcular" y una vez al terminar un vaciado (no "una vez por apertura").
8. **La nota de qué no cuenta** suma: copias de una subida duplicada, lo restaurado a mano desde la papelera de
   Drive, y que con otra cuenta de Google o una unidad compartida el número deja de ser la cuota del dueño ("lo
   que la app subió").
9. **Prueba SQL:** sumar la sesión con contraseña de la dueña, un admin sin permiso sobre el proyecto, la dueña
   con permiso solo por página (va a la fila oculta), un archivo purgado sin subir, `drive_trashed_at` sin
   `drive_id`, el uso de otro proyecto y que llamarla no cambia filas.
10. **Aparte:** si el portero no logra mandar a la papelera de Drive un archivo cuya purga se pidió durante la
    subida, queda vivo en Drive con `drive_trashed_at` puesto y ya no aparece en la papelera: un hueco que ya
    existe, para una tarea aparte.

Preguntas para Lega: si el número principal muestra además "+ X en la papelera de Drive"; si el peso lo ven
admins y "Editar y crear páginas" o solo la dueña; si va la fila de "proyectos que no ves"; y verificar la base
1024 con un archivo conocido en su Drive.

## Respuestas de Lega (2026-09-30)

Todo como se propuso: ven el peso quienes ven la papelera de archivos; el número principal sin la papelera de
Drive, que se muestra aparte ("+ 2 GB en la papelera de Drive"); la fila de "proyectos que no ves" en el diálogo
de Drive. **Autorizó aplicar la migración** en producción cuando esté lista y auditada (con la copia de
seguridad antes).
