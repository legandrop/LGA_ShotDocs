# Cuánto ocupa cada proyecto en el Drive (P.7), y la lista por peso (P.8)

Estado: **la lista por peso (P.8), primera entrega hecha (v0.220), sin migración** (ver "Cómo quedó: la lista por
peso", al final). El peso (P.7): **primera entrega hecha (v0.050)**; migración aplicada en Wanka el 2026-09-30 ~13:35 UTC, con la copia de seguridad en verde antes y las 10 pruebas SQL ok (ver "Cómo quedó", al final). "Correcciones de la auditoría previa" manda sobre lo anterior. Pedido de Lega: "sería
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
| En la papelera de la app sin haberse subido nunca | No | Solo en la papelera de la app (coincide con la papelera de archivos), no en el número principal |
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
  siempre al abrir el diálogo de Drive y una vez al terminar de vaciar la papelera (mandar un solo archivo a
  la papelera de Drive no pide; ver "Cómo quedó"). Nunca en cada
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

(Esbozo del 2026-09-30. La primera entrega salió sin función nueva y solo para leer: ver "Cómo quedó: la lista
por peso", al final.)

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
- ~~La app nueva sube `DB_SCHEMA_VERSION` a 7~~ (corrección 2): **`DB_SCHEMA_VERSION` queda en 6** y el peso
  usa su propia constante, `SIZES_SCHEMA_VERSION = 7`. Un workspace sin migrar no ve ningún aviso (el peso es
  opcional) y el peso no se muestra; todo lo demás sigue. Subir `DB_SCHEMA_VERSION` a 7 dejaría el aviso
  amarillo de "aplicar migraciones" en cada workspace sin migrar y el panel de comentarios diría, sin razón,
  que no se suben.
- Sin propiedades nuevas en el editor ni cambios en el portero: no hace falta subir `min_app_version`.
- Aplicarla en producción pide autorización de Lega (copia de seguridad antes, `npm run db:migrate`,
  `npm run db:test`).

## 7. Implementación

Migración y prueba SQL; `ProjectSizeRow` en `src/sync/types.ts`; `projectSizes()` en `src/sync/remote.ts` (y
en el `FakeRemote` de pruebas); `src/media/projectSizes.ts`; `formatTotal`; el store en `src/services.ts`; el
subtítulo en `src/ui/ProjectSwitcher.tsx`; la sección en `src/ui/DriveDialog.tsx`; el total en
`src/ui/TrashView.tsx`; ~~`DB_SCHEMA_VERSION = 7`~~ `SIZES_SCHEMA_VERSION = 7` (`DB_SCHEMA_VERSION` sigue en 6, ver
§6); textos; docs. Pruebas: el store (vida de 5 minutos, sin red,
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

## Cómo quedó (primera entrega, v0.050)

Lo de la corrección 7, con las correcciones aplicadas. Donde este texto y las secciones de arriba no
coinciden, vale este.

**La base** (`supabase/migrations/20260930190000_peso_proyectos.sql`, aplicada en Wanka el 2026-09-30).
`public.project_sizes()` devuelve `project_id`, `drive_bytes`/`drive_files` (el número principal: en uso más
lo subido de la papelera de la app; lo que fue a la papelera sin llegar a subirse no está en Drive y no suma), `trash_bytes`/`trash_files` (papelera de la app), `drive_trash_bytes`/`drive_trash_files`
(papelera de Drive, menos de 30 días) y `pending_bytes`/`pending_files` (sin subir). Bytes en `bigint`,
archivos en `int`. Los estados son excluyentes y en el orden de la corrección 1; se suma solo `files` por
`files.project_id`. La puerta (`private.can_see_file_trash`) va en un CTE materializado, una vez por proyecto;
para alguien sin permisos no se recorre ningún archivo. La fila sin proyecto sale solo para
`private.workspace_role() = 'owner'` y solo si hay algún proyecto cuya papelera no ve (un proyecto privado de
otro, o uno donde tiene permiso solo sobre páginas sueltas). `language sql`, `stable`, `security definer`,
`search_path = ''`, sin `public` ni `anon`, `schema_version` a 7 y `notify pgrst`.

**La prueba** (`supabase/tests/peso_proyectos_permisos.sql`) tiene los casos del diseño y de la corrección 9.
Como la base real ya tiene proyectos que la dueña de la prueba no ve, la fila sin proyecto se compara contra
lo que daba antes de crear los dos proyectos ocultos de la prueba. Corrida con la migración dentro de una
transacción que se deshace (Management API): `[{"result":"ok"}]`, y después `to_regproc('public.project_sizes')`
nulo y `schema_version` en 6.

**La app.**

- `ProjectSizeRow` en `src/sync/types.ts`; `projectSizes()` en `SupabaseRemote` (con su tope `timed()`,
  `Number()` en cada campo, `null` con `PGRST202`), en una interfaz aparte (`SizesRemote`) para no obligar al
  `FakeRemote`. En las pruebas, `FakeServer.sizes` responde lo que se le ponga (las reglas ya las prueba el SQL).
- `src/media/projectSizes.ts`: el store, sin React, con la última respuesta en `meta.projectSizes` (`{ rows, at }`).
  `SIZES_SCHEMA_VERSION = 7`; `DB_SCHEMA_VERSION` sigue en 6 (corrección 2). La sincronización le pasa la
  versión de la base en cada vuelta (`SyncEngine`, opción `sizes`; 0 si la base no tiene ajustes). Mientras no
  se sabe la versión (se abrió sin red) muestra lo guardado y deja el pedido para cuando se sepa; con una versión
  menor que 7 no pide y no muestra. Un `PGRST202` borra lo guardado y no vuelve a probar por 10 minutos. Los 5
  minutos del selector cuentan desde el último intento (también uno fallido); dos pedidos a la vez son uno.
  Sin red queda lo último y la vista lo dice.
- Pedidos: al abrir el selector si pasaron 5 minutos, siempre al abrir el diálogo de Drive y con "Volver a
  calcular", y una vez al terminar un vaciado de la papelera de archivos (aunque se haya cerrado la vista).
- `formatSize` (`src/media/fileTrash.ts`) es la única función de formato: base 1024, KB, MB, GB y TB, un decimal
  por debajo de 100 y ninguno desde 100, sin ",0"; pasa a la unidad de arriba cuando el número llegaría a 1000
  (nunca "1000 MB"); algo de menos de 0,1 KB se muestra como 0,1 KB. Acepta el idioma para las pruebas. Las
  tarjetas de adjuntos y la papelera ahora dicen "3 MB" en vez de "3,0 MB".
- Selector (`src/ui/ProjectSwitcher.tsx`): "páginas · peso · editado", el peso antes de la fecha (el "…" corta la
  fecha). Sin peso en cero, ni si los permisos del dispositivo dicen que la persona no ve la papelera de archivos
  de ese proyecto (un valor guardado viejo no se muestra).
- Diálogo de Google Drive (`src/ui/DriveDialog.tsx`, solo el dueño): "Espacio en Drive: 34,2 GB en 1203
  archivos" (suma todas las filas, también la de los proyectos que no ve: es lo que ocupa su Drive), "+ 2 GB en
  la papelera de Google Drive" al lado, el desglose en una línea (de eso en la papelera de la app, todavía
  subiendo con cuántos archivos, en proyectos que no ves), la nota de qué cuenta (corrección 8) y "Actualizado
  14:32 · Volver a calcular"; sin red, "Sin conexión: último cálculo del…". Con una base sin la función la
  sección no aparece. Los textos van en la parte que se baja con el diálogo (`src/i18n/lazy/drive.ts`).
- Papelera → Archivos (`src/ui/TrashView.tsx`; desde v0.162, el filtro *Files* de la papelera del selector de proyectos): "14 archivos · 2,1 GB" arriba (sumado en el cliente, todo lo de
  la lista) y la confirmación de vaciar suma solo lo que se va a mandar: "2,1 GB pasan a la papelera de Google
  Drive. El espacio en Drive se libera cuando Google vacía su papelera (a los 30 días), no enseguida."

**Pruebas de la app:** `src/media/projectSizes.test.ts` (el store: 5 minutos, sin red, abrir sin red, versión 6
no llama, `PGRST202` y sus 10 minutos, un proyecto que deja de venir, la fila sin proyecto, pedidos juntos; el
remoto de Supabase; `formatSize` en los dos idiomas), `src/ui/projectSizes.test.tsx` (jsdom: el selector, el
permiso en el dispositivo, el diálogo con el desglose, "Volver a calcular" y sin red, y sin la función) y una más
en `src/ui/trashView.test.tsx` (el total, la confirmación y el pedido al terminar de vaciar).

**Queda para después:** la lista por proyecto en el diálogo y el orden por peso (con P.8); verificar a mano
la base 1024 con un archivo conocido en el Drive de Lega y el total de un proyecto contra su carpeta; el hueco
de la corrección 10, en una tarea aparte. (La migración ya está aplicada en Wanka: copia de seguridad en verde
antes, `npm run db:migrate` y las 10 pruebas de `npm run db:test` ok. Dos pruebas viejas, `fase1_permisos.sql`
y `workspace_settings_permisos.sql`, suponían que la base no tiene versión mínima; ahora pasan una versión o la
sacan dentro de su transacción.)

**Auditoría de la implementación (independiente, 2026-09-30).** Nada bloqueante: la puerta, los permisos
(`anon` y `public` sin ejecutar, `search_path` vacío), la sesión con contraseña y la subida de `schema_version`
a 7 (ninguna versión de la app se traba con una base más nueva) están bien; migración y prueba corridas en
rollback contra la base real. Arreglado:
- El número principal contaba lo de la papelera de la app que nunca se subió (un video grande que se sacó
  antes de terminar de subir sumaba para siempre): ahora solo suma lo subido; la papelera de la app sigue
  entera (coincide con `trashed_files`).
- El diálogo decía "Todavía no se subió nada. + 2 GB en la papelera de Google Drive" cuando todo estaba en la
  papelera de Drive: ahora dice "Nada en Drive fuera de su papelera".
- Docs que decían que `DB_SCHEMA_VERSION` sube a 7 (§6 y §7), corregidos; el comentario de `src/workspace.ts` y
  `Doc_Sincronizacion.md` explican el patrón de las constantes propias.
- Pruebas nuevas: un archivo vaciado que el portero todavía no mandó a Drive (cuenta en la papelera de la app y
  en el principal), uno en la papelera de Drive hace 29 días (todavía cuenta) y el diálogo con todo en la
  papelera de Drive.

## Cómo quedó: la lista por peso (P.8, primera entrega, v0.220)

**Qué es.** *Files by size* (*Archivos por peso*): los archivos de un proyecto que ocupan lugar en el Drive, del
más pesado al más liviano, cada uno con su tipo (foto, video, carpeta o archivo), su peso y el link a las páginas
que lo usan. Solo lectura: no borra ni reemplaza nada.

**Dónde se abre.** En el selector de proyectos, que es donde se ve el peso de cada uno: un renglón *Files by
size* al pie de la lista, arriba de *Trash*, que aparece si algún proyecto muestra un peso. La lista se abre
adentro del mismo selector, como la papelera, con la flecha para volver y Escape. Abre el proyecto abierto o, si
ese no pesa, el más pesado; arriba hay un desplegable para elegir entre los proyectos que muestran un peso, del
más pesado al más liviano ("MGTZD · 3,4 GB"). Con uno solo, va su nombre sin desplegable.

La flecha de volver y el desplegable quedan fijos arriba al bajar por la lista (`position: sticky`, solo en esta
lista: la papelera no cambia).

No es un ícono más en el renglón de cada proyecto: los íconos del renglón reservan su ancho aunque no se vean (30
px cada uno), y uno más le saca 30 px al nombre y al subtítulo, que es donde P.7 dejó el peso a la vista. Medido en
un navegador (selector de 338 px, dueño, base en la versión 7, que da tres íconos y 92 px reservados): al subtítulo
del proyecto abierto, "11 páginas · 4,6 GB · editado hoy", le quedan 118 px de los 184 que necesita, y al de otro
proyecto 174 de 189. Ya se corta sin sumar nada; con la base al día el dueño tiene cinco íconos (60 px menos). Está
en el roadmap.

**Quién la ve (D312).** Quien ve el peso del proyecto: quien ve su papelera de archivos
(`Permissions.canSeeFileTrash`, la misma puerta del subtítulo). De la lista, cada uno ve **los archivos que la
base le deja leer**: no hay función nueva ni nada que salte permisos.

**De dónde sale (sin migración).** La lista son dos lecturas por tramo con la sesión, por las políticas que ya
existen:

- `files` del proyecto con `drive_id` puesto y sin `drive_trashed_at` (el mismo conjunto que suma el número del
  proyecto en `project_sizes`), ordenado por `size` descendente y por `id`. La política `files_select`
  (`private.can_view_file`) deja ver lo propio y lo que usa una página que la sesión ve.
- `page_files` de esos archivos, solo los usos activos (sin `removed_at`), para armar los links. La política
  `page_files_select` deja ver los usos de las páginas que la sesión ve.

Además, las miniaturas: una o más lecturas de `files` por id, por lote (los del tramo que tienen miniatura), y una
bajada del bucket `thumbs` por cada uno. Solo se piden las de los archivos con `thumb_at` (un zip, un PDF sin vista
previa o un video sin miniatura no piden nada); antes se pedía además la ficha de cada archivo sin miniatura.

Se descartó el esbozo de la sección 5 (una función `project_files_by_size` con la puerta de la papelera) porque
con las tablas y los permisos que hay alcanza. **El costo:** la base evalúa la política de `files` en cada archivo
del proyecto en cada tramo (no hay índice por peso: recorrido secuencial con `can_view_file` por fila). Medido en
la auditoría contra la base real, en una transacción que se deshace, con 2297 archivos en el proyecto: 454 a 549
ms el primer tramo para el dueño, 716 a 734 ms para un admin con solo *Ver*, y unos 25 ms la lectura de los usos.
Los tramos siguientes bajan, porque el filtro de peso se evalúa antes que el permiso y cada tramo recorre solo lo
que falta (21 ms desde la fila 2200 para el dueño, 78 ms desde la 2100 para el admin; por desplazamiento eran 459
ms). El peor caso es el primer tramo: el tope de una consulta de la sesión es de 8 s y a ese ritmo vencería cerca
de los 25.000 a 40.000 archivos por proyecto, y la lista lo mostraría como un error con *Retry*. Si pasa, el arreglo es esa función (una sola puerta
por proyecto), con su migración.

**Lo que no coincide con el número.** A quien ve el peso por ser admin con solo *Ver* sobre el proyecto, la base
no le deja leer los archivos que ya no usa ninguna página que él vea: los sacados de una página que no edita
(`private.sees_deleted`) y los de una página que está en la papelera. Están en el número y no en su lista. Con la lista entera cargada, si suma menos que el número del proyecto, abajo dice cuánto falta ("Hay
900 MB más en archivos que no podés ver desde acá"). El dueño y quien tiene *Editar y crear páginas* sobre el
proyecto entero ven todo, y a ellos el aviso no les sale.

Para que eso sea cierto en pantalla, el número con el que se compara tiene que ser el de ahora y no el guardado
(que puede tener hasta 5 minutos): **la lista pide el peso al abrirse**, como el diálogo de Google Drive, y
**mandar un archivo a la papelera de Drive desde Papelera › Archivos vuelve a pedirlo** (antes solo lo hacía
*Empty*). El aviso no sale mientras el peso se está pidiendo, ni si ese pedido falló, ni antes de tener la lista
entera. Sin esto, al dueño que mandaba un archivo a la papelera de Drive y volvía a la lista (el recorrido que la
misma lista recomienda) le decía que había archivos que no podía ver, por el peso de ese archivo.

**Qué lista (D313).** Lo que ocupa lugar: lo subido que no se mandó a la papelera de Drive. Incluye lo que está en
la papelera de la app, **marcado** ("No lo usa ninguna página (está en la papelera)", en otro color): es el
candidato a borrar, y lo dice la base (`files.trashed_at`), no el dispositivo. No lista lo que todavía no subió ni
lo que ya está en la papelera de Drive.

**Por tramos.** De a 100 archivos (`FILES_BATCH`), los más pesados primero, con *Show more* para el tramo que
sigue. PostgREST corta en 1000 filas por pedido: `filesBySize` nunca pide más de 1000 de una vez y sigue
pidiendo, y `fileUses` pide de a 100 archivos y de a 1000 filas (un archivo puede estar en muchas páginas). Un
tramo se muestra recién con sus usos; si alguno de los dos pedidos falla, se vuelve a pedir entero.

Cada tramo sigue **por clave y no por desplazamiento**: pide lo que viene después del último archivo recibido en
el orden (peso descendente, id), con el filtro `or=(size.lt.P,and(size.eq.P,id.gt.ID))`. `size` nunca es nulo y
el id desempata, así que el orden es total. Con un desplazamiento ("salteá 100"), un archivo que sale del conjunto
entre dos tramos (se mandó a la papelera de Drive) dejaba una fila salteada, y uno que entra, una repetida; por
clave no pasa ninguna de las dos. Los dos valores van escritos en el filtro: antes se revisa que sean un entero y
un uuid. Lo ya mostrado no se vuelve a pedir: un archivo que salió del conjunto sigue en la lista hasta cerrarla.

La lista no se guarda en el dispositivo: se arma al abrirla. Lo que sí queda es lo de las miniaturas, como en la
papelera: cada archivo cuya miniatura se pidió queda entre los conocidos del dispositivo (`known`) y su miniatura,
guardada.

**Las páginas.** Los títulos salen del árbol del dispositivo: primero las vivas, después las de la papelera ("Día
2 (en la papelera)"), y las de otro proyecto con su nombre. Hasta tres, y "+N páginas más". Un archivo en uso
cuyas páginas el dispositivo no conoce dice "En una página que no podés abrir desde este dispositivo". El link
abre la página y cierra el selector; no deja elegido el bloque. En una pantalla táctil cada link tiene unos 35 px
de alto (en el escritorio, los 15 de siempre).

**Nombres largos.** El nombre y los links se cortan con "…" y el peso queda siempre a la vista, a la derecha. El
nombre entero sale en el tooltip, solo cuando está cortado (`data-tip-overflow`; los nombres de cámara difieren al
final).

**El desborde de costado (arreglado en v0.220, también en la papelera).** `.trash-panel` era una grilla sin
columnas declaradas: la columna implícita tomaba el ancho del nombre más largo (los nombres van sin corte de
renglón), el panel se ensanchaba y lo de la derecha de cada renglón quedaba fuera de la vista. En esta lista era el
peso (panel de 407 px con contenido de 661); en **Papelera › Archivos, que ya estaba publicada**, el botón *Send to
Drive trash* (con un nombre largo: contenido de 898 px en un panel de 407, el botón en x = 919). Se arregla con
una línea, `grid-template-columns: minmax(0, 1fr)`: medido después, panel y contenido de 407 px en el escritorio
(peso y botón en x = 422) y de 349 px en un teléfono de 375 (peso en x = 356). **Límite de las pruebas:** jsdom no
calcula el layout, así que ninguna prueba automática lo cubre; está visto en un navegador, en la página de prueba
de la auditoría, a 440 y 375 px, en claro y oscuro, en inglés y castellano.

**Estados.** Cargando; sin red (no pide nada, lo dice, y al volver la red carga sola; con la lista entera no dice
nada, porque no falta pedir nada); un pedido que falla, con *Retry* (sin red, o el motivo que dio la base, tal
como lo manda: en inglés); un proyecto sin archivos en el Drive; y sin permiso (no pide nada).

**Código.** `SizedFileRow` (`src/sync/types.ts`); `FilesBySizeRemote`, `filesBySize` y `fileUses`
(`src/sync/remote.ts`; en las pruebas, `FakeRemote` con las mismas políticas); `src/media/filesBySize.ts` (la
lista, sin React); `src/ui/FilesBySize.tsx` (se baja aparte, con sus textos en `src/i18n/lazy/filesBySize.ts`); la
entrada en `src/ui/ProjectSwitcher.tsx` (modo `files`); la entrada `projectsFilesBySize` de la ayuda.

**Pruebas.** `src/media/filesBySize.test.ts`, con un cliente en memoria que imita a PostgREST (filtros, orden,
rango, el tope de 1000 filas y las políticas): el filtro y el orden, 2500 archivos pasado el tope, un archivo en
1500 páginas, lo que la política no deja ver, los errores, la lista tramo a tramo, el reintento sin saltear ni
repetir, el tramo que no se muestra a medias, y el paginado por clave (a igual peso, un archivo que sale del
conjunto o uno que entra entre dos tramos, y la revisión de lo que se escribe en el filtro).
`src/ui/filesBySize.test.tsx` (jsdom, contra el servidor en
memoria): la entrada donde se ve el peso, el orden, el tipo, el peso, el link que abre la página, elegir el
proyecto (y que no entre uno cuyo peso no se ve), Escape, la página de otro proyecto, el archivo sin uso, quién no
la ve, el admin que solo ve el proyecto, el peso viejo del dueño (se pide al abrir; sin aviso mientras llega, si
falla o antes de la lista entera), las miniaturas que no se piden, sin red, el error con *Retry*, el vacío y
*Show more*. En `src/ui/trashView.test.tsx`, que mandar uno a la papelera de Drive vuelve a pedir el peso.

**Queda.** Borrar o reemplazar desde la lista (hoy: abrir la página y hacerlo ahí; lo sacado se manda a la
papelera de Drive desde Papelera › Archivos); dejar elegido el bloque al abrir la página; un acceso a la lista
desde el diálogo de Google Drive; ordenar por peso la papelera de archivos; el recorrido en la app real con sesión
(un iPhone de verdad incluido); y ver el paginado por clave en un pedido real con sesión (la auditoría recorrió
el SQL equivalente contra la base real, con 2297 archivos y 38 empates de peso, sin repetir ni saltear, y la API
acepta la forma del filtro; falta el pedido de punta a punta). Al volver con Shift+Tab, un link puede quedar
debajo del encabezado fijo (le falta `scroll-padding-top` a la lista). Un archivo más pesado que se sube mientras
se lista queda antes de lo ya recibido: no aparece hasta reabrir y, con la lista entera, el aviso de lo que falta
saldría por su peso. Ninguna prueba fija que la papelera siga pidiendo sus miniaturas. En el teléfono cada fila
mide unos 85 px: 100 archivos son unos 8.500 px de scroll. Del lado de quien ve menos: el admin con solo *Ver* se entera
de lo que le falta recién al final de la lista (22 *Show more* con 2204 archivos) y la nota de arriba le indica
algo que no puede hacer (mandar a la papelera de Drive lo que no ve). El motivo de un error de la base sale crudo,
en inglés, adentro del texto en castellano.
