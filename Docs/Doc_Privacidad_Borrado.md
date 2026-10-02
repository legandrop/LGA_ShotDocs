# Privacidad de lo borrado (D14)

**Estado: diseño, sin código ni migración aplicada** (roadmap B.18; 2026-10-02, revisado el mismo día con la
auditoría independiente: ver "Correcciones de la auditoría", al final). Toca los permisos (quién recibe qué bytes de
una página) y el contrato de datos (qué viaja en `page_updates`), así que cada entrega va con sus pruebas de permisos y
su auditoría. Lo medido está en prototipos fuera del repo (sección "Cómo se midió").

## En corto

- **El problema, medido.** El contenido de una página viaja como filas de `page_updates`, y cada fila tiene el texto
  tal como se subió. Quien puede **ver** la página (también Comentar y los invitados) baja todas las filas con
  `pull_page_updates`, y con eso puede leer todo lo que alguna vez se escribió y después se borró: texto, links,
  nombres y epígrafes de fotos pisados, la dirección `sdmedia://` de fotos sacadas, bloques enteros. En la página real
  más editada (63 filas) hay 158 elementos borrados legibles; en una simulada de 2000 subidas, 10 368 letras. Además,
  la columna `update` de la tabla se lee directo por la API, y **las fotos y archivos sacados de la página** se siguen
  listando y abriendo (`can_view_file` y `file_level` no miran `removed_at`). Desde v0.095 (B.16, D15) también viaja lo
  tecleado y borrado antes de subir, hasta 6 MB por subida.
- **Quién recibe lo borrado:** solo quien ve el historial (D13): puede editar la página y **no es invitado**. Ver,
  Comentar y los invitados (aunque tengan Editar) reciben en su lugar **la última base limpia**: la página entera con
  lo borrado como hueco, armada por el dispositivo de alguien que edita (como el snapshot de compactar, D5). Nunca
  filas, nunca piezas viejas: siempre la última base.
- **"Solo bases" (D20) es la entrega principal.** Simulado en 300 corridas con lectores, un invitado que edita, un
  lector que pasa a editor, un editor que pasa a invitado, editores con la vista atrasada y un teléfono nuevo del
  cliente al final: todos terminan iguales y **0** textos recibidos por quien no edita que no estuvieran visibles en
  alguna base que recibió; el teléfono nuevo recibe **0** textos ya borrados (con la cadena de deltas de la primera
  versión: 5058 de 10 429). Las mutantes (servir filas, bases sin GC, aceptar una base anterior al compartir) dan entre
  374 y 20 348 fugas.
- **Lo que garantiza:** quien no edita recibe la página como estaba en el momento en que un editor armó la última
  base: al compartírsela (o después), unos 20 s después de que se deja de escribir, o cada 2 minutos mientras se
  escribe (más espaciado en páginas de más de 100 KB). Lo que estuvo en la página menos que eso no le llega nunca; lo
  que estuvo más le puede haber llegado, aunque después se borre. Un dispositivo nuevo recibe solo la última base.
- **Las fotos y archivos sacados** dejan de dar permiso a quien no ve lo borrado: `can_view_file`, `file_level` y la
  política de `page_files` ignoran los usos con `removed_at` para esa persona (la miniatura y el portero usan
  `file_level`).
- **Lo que no garantiza:** lo que un dispositivo ya bajó no se puede "desbajar"; los largos de lo borrado y los nombres
  de los atributos pisados viajan (no el contenido); las imágenes viejas `sdfile://` (bucket `page-files`, workspaces sin
  portero) siguen enteras; las páginas en la papelera (frente aparte); y quien edita ve todo, por diseño (D13).
- **La subida no cambia (D19).** El "GC selectivo" de la primera versión (que lo tecleado y borrado antes de subir no
  saliera del dispositivo) se descartó: la auditoría mostró que pierde texto que D15 manda conservar (entre 61 y 118
  letras con el editor real y 100 semillas), y con la base limpia los lectores quedan protegidos igual.
- **Costo:** quien no edita rebaja la página entera cada vez que cambia. Una página real típica pesa menos de 40 KB; un
  reporte de rodaje de 2000 subidas en un día: 5,2 MB en el día para el editor que arma y para cada lector con la
  página abierta. Una página de 10 000 subidas (555 KB): 45 MB con la cadencia por tamaño. Armar una base: 0,2 a 3 ms
  (incremental). Sin servicios nuevos: entra en el plan gratis de Supabase. Los deltas quedan como mejora si se mide
  que hacen falta.
- **Una pregunta para Lega** (sección 13): aceptar esa demora y esa garantía en vez de que el cliente vea letra por
  letra. Recomendación: sí.

**En términos simples:** hoy, si escribís una nota interna en una página y la borrás, el texto sigue viajando dentro de
la página a cualquiera que la pueda ver, también a un cliente invitado; no lo ve en la pantalla, pero está en su
navegador, y lo mismo pasa con las fotos que sacaste. Con el diseño, al cliente se le manda una copia de la página
"pasada en limpio" que arma el equipo de alguien que edita, cada vez que dejás de escribir un rato. Le llega cómo
estaba la página en esos momentos, no su pasado: si la nota estuvo un minuto, pudo llegarle; si la borraste en
segundos, no. El precio es que el cliente ve los cambios con unos segundos o un par de minutos de demora.

## Reglas que no se rompen

1. **Ninguna fila de `page_updates` se borra ni se modifica** (D4). La base limpia es una copia derivada: se puede
   tirar y volver a armar desde las filas en cualquier momento.
2. **El servidor decide quién recibe qué.** La regla vale aunque el dispositivo tenga una versión vieja de la app o
   alguien llame a la API a mano: por eso cambia `pull_page_updates`, se cierra la lectura directa de la columna y se
   corrigen los permisos de los archivos.
3. **La subida no cambia** (D15, D19): todo lo que un dispositivo escribe llega al servidor, como hoy.
4. **Sin servicios centrales ni claves nuevas** ("cada workspace es una isla", `Doc_Roadmap.md`): arman los
   dispositivos de quien edita; la base controla la forma.
5. **Nada de tipos de bloque nuevos** ni cambios en el documento: todo es cómo se arma y cómo se sirve lo que ya hay.

## 1. Qué pasa hoy

### 1.1 Por dónde viaja lo borrado

| Canal | Quién | Qué lleva |
|---|---|---|
| `pull_page_updates` (lo que usa la app para bajar) | Nivel 1 o más: Ver, Comentar, Editar, invitados | Todas las filas, con el texto tal como se subió |
| `select update from page_updates` directo por la API | Nivel 1 o más (política `page_updates_select`; la migración del historial dejó legible la columna) | Lo mismo, sin pasar por la app |
| IndexedDB del dispositivo (`docUpdates`) | Cada dispositivo que bajó la página | Lo bajado tal cual (`applyRemote` guarda la unión de las filas) |
| Lo tecleado y borrado antes de subir (B.16, v0.095) | Todos los anteriores | Hasta 6 MB por subida (`NO_GC_MAX_BYTES`) |
| Fotos y archivos sacados: `page_files` con `removed_at`, `files`, la miniatura (`thumbs`), el original por el portero | Nivel 1 o más: `can_view_file`, `file_level` y la política de `page_files` no miran `removed_at` | Nombre, tipo, peso, `drive_id`, miniatura y original |
| Imágenes viejas `sdfile://` (bucket `page-files`, sin portero) | Nivel 1 o más (la política mira la carpeta de la página) | Toda imagen que se subió a la página, también las sacadas |
| Páginas en la papelera | Nivel 1 o más (`user_page_level` mira solo si el proyecto está borrado) | Título y contenido (frente aparte, ver sección 6) |
| `page_history` (v0.098) | Nivel 3 o más, no invitado (D13) | Las filas con autor y hora: lo esperado |

Los comentarios ya lo hacen bien: el texto de uno borrado no se sirve (`list_comments` devuelve `body` vacío) y la
columna no se lee directo. Es el modelo a seguir.

### 1.2 Medido con las filas reales (solo lectura, 2026-10-02)

Las 15 páginas con más filas (121 filas, 7,2 MB), armadas en un documento sin GC. No se imprimió contenido: solo
cuentas y nombres de atributos.

| Página (prefijo) | Filas | Elementos borrados legibles | Letras | Qué son |
|---|---|---|---|---|
| `3e7ad9ca` (la más editada) | 63 | 158 | 113 | 34 bloques enteros, 112 valores de atributos pisados (`caption` 7, `name` 3, `url` 3 con su `sdmedia://`, colores, `script`, `question`, `driveCard`…) |
| `55bf9243` | 5 | 35 | 10 | 7 bloques, 26 atributos (`name`, `url`, `caption` de fotos sacadas) |
| `e66eaf3e` | 17 | 7 | 0 | 7 nombres de archivo pisados |
| Otras 5 | 2 a 9 | 1 a 16 | 0 | anchos de fotos en fila (`previewWidth`, `rowWidth`), alineación |

- Hoy hay un solo miembro (el dueño) y ningún invitado: nadie recibió nada que no debía. Con el uso real es distinto:
  en la simulación de 2000 subidas quedan **10 368 letras borradas legibles** en las filas, y 54 339 en la de 10 000.
- **El GC de Yjs saca todo el contenido** (prototipo P2, con la forma de BlockNote): un secreto puesto en el texto, en
  un link (`href`), en un formato, en el `url`, `caption` y `name` de una foto pisados, en un bloque borrado, en un
  hijo con sangría, en una celda de tabla y en el mapa de colapsar está en los bytes de las filas y **en ninguno** de
  los de la base limpia. Lo visible sale igual. Lo que queda: 13 huecos con su largo (126), quién y en qué reloj, y
  los nombres de los atributos pisados (`url`, `caption`, `name`) y las claves del mapa de colapsar (ids de bloque).
- De las páginas reales, las que no son tablas importadas de Coda pesan menos de 40 KB; las tablas importadas, de 0,5 a
  2 MB, con una sola fila (no se editan).

## 2. Quién recibe lo borrado y quién no

| Quién | Nivel | ¿Ve el historial? (D13) | Recibe | Fotos y archivos sacados |
|---|---|---|---|---|
| Dueño del proyecto | 4 | Sí | Las filas (todo) | Sí (para restaurar del historial) |
| Admin o miembro con Editar y crear páginas | 4 | Sí | Las filas | Sí |
| Miembro con Editar | 3 | Sí | Las filas | Sí |
| Miembro con Comentar | 2 | No | La última base limpia | No |
| Miembro con Ver | 1 | No | La última base limpia | No |
| Invitado (cualquier permiso, también Editar) | 1 a 4 | No | La última base limpia; si tiene Editar, sube sus filas como cualquiera | No |
| Sin permiso, sacado, sesión con contraseña | 0 | No | Nada | No |

- **La regla es la misma que la del historial**, `private.page_level(p) >= 3 and not guest`: quien ve el historial ve
  lo borrado de todos modos, así que mandarle las filas no le agrega nada; a quien no lo ve, mandárselas le daría por
  la red lo que la pantalla le niega. Una sola función (`private.sees_deleted`) para todo.
- **El invitado con Editar** escribe sobre la última base: Yjs funciona igual con lo borrado como hueco (es lo que hace
  cualquier documento con GC, como el que tiene abierto el editor). Sus filas suben como las de cualquiera. Escribe
  sobre una copia con la misma demora que ve el lector, así que hay más ediciones "a la vez" (las fusiona Yjs, como
  siempre; `Doc_Colaboracion.md`).
- **Fotos y archivos** (sección 4.4): hoy un uso sacado (`page_files.removed_at`) sigue dando permiso. Con el diseño,
  para quien no ve lo borrado, un uso sacado no cuenta: no se lista, no da la miniatura ni el original. "Ver incluye
  bajar los originales" (decisión de Lega) sigue valiendo para lo que la página usa.

## 3. Las alternativas

| | Qué es | Protege | Costo y qué rompe | Plan gratis / isla |
|---|---|---|---|---|
| **A. No hacer nada y decirlo** | Aviso al compartir y en la ayuda | Nada | Nada | Bien |
| **B. Filas "públicas" por fila** | El dispositivo sube cada fila dos veces: entera y con GC | Solo lo borrado **antes** de subir | El doble de subida; no protege lo que se borra después (la nota interna borrada antes de compartir) | Bien |
| **C1. Filtrar en Postgres** | plpgsql que decodifique Yjs | Todo | Reescribir Yjs en SQL: frágil, lento en cada bajada; no ve los huérfanos sin integrar el documento | Bien, inmantenible |
| **C2. Edge Function** | Yjs con la clave de servicio | Todo | Un componente que cada dueño publica aparte, con la clave que saltea los permisos; 2 s de CPU por pedido | Rompe "todo se publica con el push" (como D5) |
| **C3. El portero** | El Worker del dueño arma lo limpio | Todo | No tiene ni debe tener clave de la base; con la sesión del lector vería lo mismo que él | No |
| **D. Cifrado** | Filas cifradas con clave de editores | Lo guardado en el servidor | Los lectores igual necesitan una versión legible sin lo borrado; repartir claves al cambiar permisos | Complejo |
| **E. Snapshot limpio + filas después** | El lector baja el snapshot y las filas siguientes | Lo borrado antes del snapshot | Las filas siguientes llevan lo escrito y borrado desde entonces | Bien |
| **F1. Solo bases** (elegida, D20) | El lector baja siempre la última base limpia, entera | Todo lo que vivió menos que una base, lo de antes de compartir, y un dispositivo nuevo recibe solo el presente | El lector rebaja la página entera cuando cambia | Bien: lo arma el dispositivo de quien edita |
| **F2. Base + deltas** (la primera versión; mejora futura) | Base y piezas con lo nuevo entre dos momentos | Lo que vivió menos que una pieza | Un dispositivo nuevo recibe todo lo que vivió una pieza desde la última base (B4 de la auditoría: 48 %); encadenado, `sv_after`, `ds_after`, conflictos | Bien |
| **G. Subida con GC selectivo** (descartada, D19) | Lo borrado por uno mismo antes de subir no sube | Lo tecleado y borrado al toque, para todos | **Pierde huérfanos** (B1 de la auditoría): compactar al abrir y las reparaciones guardan delete sets que nombran lo propio | Bien, pero rompe D15 |

- **Por qué F1 y no F2 (D20).** F2 baja muchos menos bytes, pero cada delta lleva con texto lo que estaba vivo al
  armarlo, y la base se rearma poco: un teléfono nuevo del cliente que abre la página al día siguiente recibe todo lo
  que vivió más de 20 s desde la última base (auditoría, `a5_lector_tardio.mjs`: 5058 de 10 429 textos ya borrados al
  bajarlos). F1 lo resuelve sola (P7: 0 de 4988) y saca el encadenado, `sv_after`, `ds_after`, la comprobación de forma
  de los deltas y `clean_conflict`. Su costo (sección 4.5) alcanza para el escenario real: el primer cliente invitado
  (paso 9 y 10 de `Plan_Workspaces.md`, un brief o un reporte de pocas decenas de KB). Los deltas se suman cuando se
  mida una página compartida de más de 100 KB editada mucho por día (ver 4.5 y la entrega 4).
- **Por qué no E** (y su variante de retener las filas con borrados): el lector que abre la página a la noche recibe las
  filas de toda la tarde; si se retienen las filas con borrados, la fila que agrega la nota se sirve y la que la borra
  no, y el lector la ve en pantalla.
- **Por qué no G (D19).** La regla ("lo propio nuevo cuyo id está en el delete set de una fila guardada") supone que
  ninguna fila guardada nombra lo que otro borró; dos filas que la app guarda sí lo nombran: la compactación al abrir
  (`mergeRowsInOrder` guarda el delete set de todo el documento, con las cascadas) y las reparaciones con la página
  abierta (`ORIGIN_REPAIR`). Con el editor real y 100 semillas se perdieron entre 61 y 118 letras escritas por un
  dispositivo y borradas por otro, y el aviso de B.16 decía que estaban en el historial. Con F1, los lectores no
  dependen de la subida (P7 se corrió con la subida de hoy, sin GC: 0 fugas), así que G solo protegería del historial a
  los editores (que por D13 ven todo) y a las copias: no compensa el riesgo. Lo tecleado y borrado al toque sigue
  llegando al servidor y a los editores, como decidió D15; ya no llega a los lectores.

## 4. El diseño

### 4.1 La base limpia

Las filas `1..N` como las tiene el dispositivo de un editor, en un `Y.Doc` con GC, y `Y.encodeStateAsUpdate`: la
página en `N` con todo lo borrado como hueco. Se guarda **una por página** (tabla `page_clean_bases`): la vigente.
Tiene `to_seq` (hasta qué fila llega) y el `page_updates.id` de esa fila (`last_update_id`, como compactar: después
de restaurar una copia, otra fila puede tener ese `seq`).

**Quién arma.** El dispositivo de alguien que ve lo borrado (nivel 3, no invitado), con una versión de la app igual o
mayor que `clean_min_version`, y **solo si tiene la página al día**: el cursor llegó a `update_seq`, no tiene nada sin
subir, ni subida en vuelo, ni filas ilegibles. Arma desde lo guardado en el dispositivo, sin bajar nada (con GC no
importa que lo guardado mezcle copias con texto y con huecos: lo borrado se va igual). Un dispositivo que fue lector
y pasó a editor también puede armarla: tiene todo lo visible (su copia tiene huecos solo donde hay borrados).

**Cuándo** (lo pide `clean_work()`, una vez por ciclo de sincronización si el dispositivo subió o bajó algo, o cada 2
minutos; como mucho 20 páginas por vuelta):

- La página tiene algún lector (alguien activo con nivel 1 o 2, o un invitado con 1 o más) **y** no hay base vigente
  (primera vez, después de compartir con alguien nuevo, de restaurar una copia), **o** hay filas después de la base y:
  la última fila tiene más de **20 s** (se dejó de escribir) o la base tiene más de **2 minutos × max(1, tamaño de la
  base / 100 KB)** (se sigue escribiendo; una base de 555 KB espera 11 minutos).
- Una página que solo ven editores (hoy, todas) no arma nada: cero costo.

**Comprobaciones antes de subir** (en el dispositivo; la base no lee Yjs):

1. **Privacidad:** se decodifica la base y cada elemento con contenido tiene que estar vivo en el documento del que
   salió (ni borrado ni colgando de algo borrado). Una base armada sin GC (mutante) no pasa.
2. **Contenido:** aplicada en un documento nuevo, lo visible y `Y.snapshot` (vector y borrados) iguales a los del
   documento del editor.

**La base controla la forma** (`push_clean_base`, con la fila de la página bloqueada como en `push_page_update`):

- quien sube ve lo borrado; el interruptor está prendido y la versión alcanza;
- la fila `to_seq` existe con ese `id` y `to_seq <= update_seq`;
- **`to_seq >= clean_reset_seq`** (B3 de la auditoría: la base llega por lo menos hasta lo que había al compartir; una
  base armada con una vista atrasada, o un reintento de una base anterior, se rechaza con `clean_stale`);
- `to_seq` mayor que el de la base vigente (si no, `clean_old`: no hace nada; dos editores que arman a la vez no se
  pisan, gana la más nueva);
- tamaño hasta 8 MB y la huella SHA-256. Reintentar con el mismo `id` devuelve lo mismo.

Al aceptarla: reemplaza la base vigente y pone `pages.clean_seq = to_seq` y `clean_at = now()`.

### 4.2 Al compartir

`share()` y `create_invitation()` con Ver, Comentar o para un invitado, y mover una página adentro de una rama con
lectores (el trigger `pages_permissions`), ponen en las páginas alcanzadas (la página y su rama, o todo el proyecto)
**`clean_reset_seq = update_seq`** y `clean_seq = 0`: la base vigente deja de servirse hasta que un editor arme una que
llegue por lo menos a ese punto. La app, al compartir, arma enseguida las bases de las páginas alcanzadas, con
progreso (*Preparing 12 pages for ana@…*); si se corta o el dispositivo no está al día, las arma el próximo editor que
sincronice, y mientras tanto el lector ve la página "en preparación" (4.3).

**Al invitar, no al aceptar** (observación 6 de la auditoría). Con F1 da lo mismo para lo que recibe: cuando el
invitado entra, baja la base vigente, que es de después de invitarlo (`to_seq >= clean_reset_seq`) y es un solo estado
de la página, no los intermedios. Lo que estuvo en la página entre la invitación y la aceptación es lo que Lega decidió
compartir al invitar. Reiniciar también al aceptar dejaría al cliente viendo "en preparación" justo la primera vez
que abre el link, si ningún editor tiene la app abierta.

### 4.3 Cómo baja quien no ve lo borrado

`pull_page_updates(page, after_seq, limit)` mantiene su firma (la usan todas las versiones). Con `clean_min_version`
puesto y si quien llama **no** ve lo borrado:

- si hay base vigente (`to_seq >= clean_reset_seq`, su fila final con su `id`) y `to_seq > after_seq`: **una fila**,
  la base, con `seq = to_seq`;
- si no: nada.

`applyRemote` la guarda y mueve el cursor como con cualquier fila; `syncedSV` avanza con `serverReach` (la base trae
cada autor desde el reloj 0) y `syncedDS` suma sus borrados. **Para no acumular bases en IndexedDB** (cada una es la
página entera), al guardar una base, si la página no tiene nada sin subir, reemplaza en la misma transacción las filas
guardadas de esa página (es la página entera: no se pierde nada). Si tiene algo sin subir (un invitado que edita), se
suma como una fila más y la compactación al abrir las junta.

**Lo que ve.** El árbol trae `clean_seq`. Para quien no ve lo borrado, "al día" es `cursor >= clean_seq`, no
`update_seq`: lo usan `isMissingContent`, la lista de páginas por bajar del ciclo (`engine.ts`), *Available offline*
(`offline.ts`), el índice de búsqueda y reemplazar en el proyecto (`projectIndex.ts`, `projectReplace.ts`), con una sola
función (`serverSeqFor(row)`). Con `clean_seq = 0` y contenido en el servidor, la página muestra *The editors haven't
prepared this page for you yet. It will appear when one of them opens the app.*

**El invitado con Editar** sube sus filas, y `pushPage` mueve su cursor a la fila propia si era la siguiente
(observación 5): queda por delante de la base y no baja nada hasta que haya una base más nueva que su subida, que
recibe entera. No rompe nada (aplicar la base de nuevo no duplica); el costo está en P7 (`guestDown`).

**La demora.** El lector ve los cambios cuando un editor arma la base (4.1). Si el editor cierra la app enseguida,
cuando un editor vuelva a sincronizar (el motor baja todas las páginas en cada ciclo, así que con abrir la app
alcanza). Es la pregunta 1.

### 4.4 Fotos y archivos sacados

Para quien no ve lo borrado de la página, un uso con `removed_at` no cuenta:

- `private.can_view_file` y `private.file_level`: solo los usos con `removed_at is null or private.sees_deleted(page)`
  (de ahí salen la política de `files`, la de `thumbs` y lo que el portero pregunta con `media_file`);
- la política de `page_files`: no lista esos usos.

Quien edita sigue viendo todo (restaurar del historial vuelve a usar la foto y la base la saca de la papelera, como
hoy). **Límites:** el uso se marca con `removed_at` cuando un dispositivo de un editor nota que el bloque desapareció
(`unlink_page_file`); hasta entonces cuenta (la base limpia ya no trae su dirección, así que el lector no la conoce por
la página). Las imágenes viejas `sdfile://` del bucket `page-files` no tienen registro de uso: siguen legibles enteras
para quien ve la página (sección 6).

### 4.5 Lo medido

**Privacidad y convergencia** (P7, 300 corridas de 200 pasos: dos editores escriben notas y las borran antes de
compartir; al compartir, un editor arma la base con la vista atrasada de 0 a 3 filas; después escriben y borran, un
lector baja, un invitado con Editar escribe y baja, un lector pasa a editor a mitad, un editor pasa a invitado a dos
tercios, los editores arman una base en el 8 % de los pasos (a veces atrasada); al final, un teléfono nuevo del cliente.
La subida es la de hoy, sin GC):

| | Solo bases | `MUT=raw` (le sirve filas) | `MUT=nogc` (bases sin GC) | `MUT=noreset` (sin `to_seq >= clean_reset_seq`) |
|---|---|---|---|---|
| Todos iguales al final | 300 de 300 | 300 | 300 | 300 |
| Lector: textos no visibles en alguna base que recibió | **0** | 12 165 | 11 827 | 0 |
| Invitado con Editar (sin lo suyo) | **0** | 11 011 | 10 505 | 0 |
| Editor que pasó a invitado (desde que pasó) | **0** | 3766 | 10 001 | 0 |
| Notas de antes de compartir, borradas antes de compartir, que le llegaron al lector | **0** | 2037 | 1996 | **374** |
| Teléfono nuevo al final: textos ya borrados | **0** de 4988 | 20 348 | 20 169 | 0 |
| Bajadas del lector sin base vigente ("en preparación") | 1483 | — | — | 0 |

Para comparar, la cadena con deltas de la primera versión (P4, 300 × 200): 0 fugas del lector en vivo, pero el teléfono
nuevo recibe 5058 de 10 429 textos ya borrados (auditoría); sus mutantes dan 7784 (`raw`) y 7922 (`nogc`) textos y 2691 y
2693 notas de antes de compartir.

**Bytes** (las mismas 300 corridas): filas de los editores 699 KB; bases subidas 1,6 MB; lo que bajó el lector 1,5 MB
(con deltas, 617 KB); el invitado que edita, 1,2 MB.

**Una página muy editada** (P8, un editor con el patrón de subida de la app, una base cada 20 subidas, que es una pausa
de escritura; "en vivo" es un lector con la página abierta todo el tiempo):

| Subidas | Filas | Base final | Solo bases: sube el editor = baja el lector en vivo | Con la cadencia por tamaño | Con deltas (P5) |
|---|---|---|---|---|---|
| 500 (una hora de edición activa) | 37 KB | 22 KB | 0,3 MB | 0,3 MB | — |
| 2000 (un reporte de rodaje en un día) | 151 KB | 108 KB | 5,2 MB | 5,2 MB | 128 KB |
| 10 000 (varios días de la misma página) | 787 KB | 555 KB | 133 MB | 45 MB | 672 KB |

Armar una base incremental (el editor no la arma de cero: aplica las filas nuevas a su documento): 0,2 a 3 ms; de cero,
la de 10 000 subidas, 73 ms. Comprobar privacidad: 3 a 16 ms. En el teléfono, estimado de 3 a 5 veces.

**Qué quiere decir para el plan gratis** (5 GB de egress por mes): un cliente que mira todos los días un reporte de
2000 subidas por día baja unos 150 MB por mes; la página de 10 000 subidas con un lector en vivo, unos 9 MB por día de
edición con la cadencia por tamaño. Para el primer cliente alcanza de sobra. **Cuándo hacen falta los deltas:** cuando
una página compartida pase de 100 KB y se edite mucho todos los días con lectores en vivo; se mide con
`clean_at`/tamaño de las bases (entrega 4).

## 5. Cómo convive con lo demás

- **Historial (D13).** Mismo criterio (`sees_deleted` es `check_history` sin la papelera). `page_history` no cambia.
  La caché del historial (entrega 3 de P.18) se borra de un dispositivo cuando su persona deja de ver el historial de
  esa página (abajo).
- **Compactar (D4, D5, D6, D16).** D4: las filas no se tocan; la base limpia es otra copia derivada. D5: la arma el
  dispositivo de quien edita. D16: el snapshot completo conserva lo borrado, así que **solo se sirve a quien ve lo
  borrado**: `pull_page_content` y `pull_page_snapshot` de `Doc_Compactar.md` piden `sees_deleted` (su sección 10 dice
  "bajar, nivel 1": cambia a esto); quien no lo ve ya baja algo compacto. **Requisito para compactar** (observación 7):
  el snapshot completo se arma siempre con las filas bajadas del servidor (su 4.3 ya lo dice) y nunca desde lo guardado
  en un dispositivo que fue lector (tiene huecos); se anota en `Doc_Compactar.md` al implementarlo.
- **La subida sin GC (D15, D19).** No cambia. El aviso de B.16 tampoco. Para el invitado con Editar sigue andando con
  las bases: su borrado nombra lo mismo que nombraban las filas.
- **Editar sin red.** El editor sin red no arma bases (no está al día); los lectores esperan. El invitado sin red
  escribe sobre la última base que bajó; al volver sube lo suyo y baja la base nueva.
- **Versiones viejas de la app abiertas.** El cambio de `pull_page_updates` es del servidor: una versión vieja que lee
  como lector recibe la base (un update de Yjs común) y no entiende `clean_seq`: pediría la página en cada ciclo y la
  vería "a medio bajar". Por eso el interruptor es `workspace_settings.clean_min_version` (nulo: apagado, todos bajan
  filas como hoy) y **antes de prenderlo se sube `min_app_version`** a esa versión: desde v0.097 una versión por debajo
  de la mínima no sube ni baja nada.
- **De lector a editor.** Desde su cursor (el `to_seq` de una base) baja las filas siguientes y el historial entero por
  `page_history`: ve todo lo borrado, también lo de antes de que le dieran permiso (como Google Docs, D13). Su copia
  local, con huecos, sirve para editar. Probado en P7.
- **De editor a lector (o a invitado).** Lo que ya bajó con las filas está en su dispositivo. Desde que deja de ver lo
  borrado recibe solo bases (P7: 0 fugas desde ese momento). La app, cuando una página deja de dar `sees_deleted` y
  **no tiene nada sin subir**, rearma lo guardado en una sola transacción (las filas se reemplazan por
  `encodeStateAsUpdate` de un documento con GC armado con ellas: mismo vector y mismos borrados, así que el cursor,
  `syncedSV` y `syncedDS` siguen valiendo) y borra la caché del historial de esa página; con algo sin subir, espera.
  Los avisos de B.16 (su propio texto) no se tocan. Es higiene: no se puede garantizar (sección 6), así que va al final
  (entrega 3).
- **No perder nada.** La base es derivada; tirarla solo hace que los lectores esperen otra. Reemplazar las filas
  guardadas de un lector por la base, y el rearmado de un ex editor, solo sin nada sin subir.
- **Copias de seguridad y restaurar.** La copia lleva `page_clean_bases` sola. El script de restaurar sobre el mismo
  proyecto (repo privado) tiene que vaciarla y dejar `clean_seq` en 0, y `clean_reset_seq` en el `update_seq` restaurado;
  es requisito para prender el interruptor. Los dispositivos, con la generación nueva, bajan de cero.
- **Tiempo real (D-04, a futuro).** Un canal en vivo de ediciones es solo para quien ve lo borrado.
- **El asistente y el servidor MCP (fase 5).** Leen con los permisos de la persona: reciben lo mismo que ella.
- **Dependencias (frentes aparte, no de este diseño):** las páginas en la papelera se leen con Ver (sección 6); y la
  prueba al azar del aviso de B.16 (`collabRemovedWriting.test.ts`) falla con 100 semillas en `main`: no la toca este
  diseño, pero el plan de pruebas la usa como red.

## 6. Qué no se puede garantizar y cómo se dice

| No se puede garantizar | Por qué | Qué se hace |
|---|---|---|
| Que lo que estuvo en la página no llegue | Si duró más que la cadencia, una base lo llevó | Se dice: "le llega cómo estaba la página, no lo que duró segundos" |
| Que un dispositivo "olvide" lo que ya bajó | El navegador ya lo tuvo; borrar de IndexedDB no es borrado seguro; capturas, exportaciones | Rearmar lo guardado (entrega 3) y decirlo en la ayuda |
| Que no se sepa nada de lo borrado | Los huecos llevan su largo, el autor de Yjs y el reloj; quedan los nombres de los atributos pisados y las claves del mapa de colapsar; `update_seq` y `updated_at` dicen que hubo cambios | Es metadato, no contenido; se dice en la ayuda |
| Las imágenes viejas `sdfile://` sacadas | El bucket `page-files` no tiene registro de uso | Workspaces con portero: no se suben más así; en Wanka son 60, de desarrollo. Para cerrarlo, registrarlas en `files`/`page_files` (ítem aparte) |
| Una foto sacada hasta que un editor la marca | `removed_at` lo pone un dispositivo de editor | La base ya no trae su dirección |
| Páginas en la papelera | `user_page_level` no mira la papelera de páginas (hallazgo de la auditoría, frente aparte) | Dependencia: hasta que se arregle, una subpágina mandada a la papelera se lee con Ver |
| Que quien edita no lo vea | Es el historial (D13) | Al compartir con Editar a un miembro, ve todo lo borrado |
| Que un editor malintencionado no muestre otra cosa | Puede subir una base que no corresponde | Lo mismo que puede hacer editando; la próxima base de otro editor la reemplaza |
| Lo que ya está en la base y en las copias | Las filas no se borran nunca (D4) | Lo tiene el dueño de la base; la regla es sobre quién lo recibe |

**En la app** (textos en inglés, con su traducción en `src/i18n/`):

- **Al compartir** con Ver, Comentar o con un invitado: *They'll get the page as it is when the editors' apps refresh
  it, not its history. Something that stayed on the page for a minute may reach them even if you delete it later.*
  Hasta la entrega 1 (entrega 0): *Text and photos deleted from these pages can still reach the people you share them
  with.*
- **La página en preparación** (4.3) y, en la ayuda, *Who can see what was deleted*: quién recibe qué (sección 2), la
  demora, que se ve el largo de lo borrado y no el contenido, y que lo que un dispositivo ya bajó no se puede borrar de
  otro.

## 7. Migración (borrador, sin aplicar)

Va como `supabase/migrations/<fecha>_privacidad_borrado.sql`, con su prueba
`supabase/tests/privacidad_borrado_permisos.sql`, en la entrega 1. Deja el interruptor apagado. Necesita `pgcrypto`
(`extensions.digest`), que Supabase ya trae.

```sql
-- Privacidad de lo borrado (D14; Docs/Doc_Privacidad_Borrado.md). Quien no ve el historial no recibe filas: recibe la
-- última base limpia que arma un editor; y los usos sacados de fotos y archivos no le dan permiso. Nada se borra.

-- 1. El contenido de page_updates no se lee directo desde la API (nadie: la app baja por funciones).
revoke select (update) on public.page_updates from authenticated;

-- 2. ¿Esta persona recibe lo borrado de esta página? El criterio del historial (D13), sin mirar la papelera.
create function private.sees_deleted(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.page_level(p) >= 3 and not private.history_denied_for_guest();
$$;
revoke all on function private.sees_deleted(uuid) from public, anon, authenticated;

-- 3. ¿Alguien activo la ve sin ver lo borrado? Solo entre quienes tienen permisos sobre el proyecto o la rama.
create function private.has_plain_readers(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with chain (id, parent_id, depth) as (...),                       -- la página y las de arriba, como user_page_level
  cand as (select distinct g.user_id from public.grants g join public.pages pg on pg.id = p
           where g.revoked_at is null and (g.project_id = pg.workspace_id or g.page_id in (select id from chain)))
  select exists (select 1 from cand c join public.members m on m.user_id = c.user_id and m.removed_at is null
                 where private.user_page_level(p, c.user_id) between 1 and 2
                    or (m.role = 'guest' and private.user_page_level(p, c.user_id) >= 1));
$$;
revoke all on function private.has_plain_readers(uuid) from public, anon, authenticated;

-- 4. La base vigente, una por página.
create table public.page_clean_bases (
  page_id        uuid primary key references public.pages (id) on delete cascade,
  id             uuid not null,                   -- lo crea el dispositivo: reintentar no duplica
  to_seq         bigint not null check (to_seq > 0),
  last_update_id bigint not null,                 -- page_updates.id de la fila to_seq (copias restauradas)
  state          bytea not null check (octet_length(state) between 1 and 8388608),
  sha256         bytea not null,
  app_version    numeric(8, 3) not null,
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);
alter table public.page_clean_bases enable row level security;
revoke all on public.page_clean_bases from anon, authenticated;   -- todo por funciones

alter table public.pages
  add column clean_seq       bigint not null default 0,  -- to_seq de la base vigente ("al día" para quien no edita)
  add column clean_at        timestamptz,                -- cuándo se armó (la cadencia)
  add column clean_reset_seq bigint not null default 0;  -- update_seq al compartir: una base vale si llega hasta acá
alter table public.workspace_settings
  add column clean_min_version numeric(8, 3) check (clean_min_version >= 0);  -- null: apagado (todos bajan filas)

-- La base vigente: llega por lo menos al reinicio y su fila final sigue teniendo su id.
create function private.current_clean_base(p uuid) returns public.page_clean_bases
language sql stable security definer set search_path = '' as $$
  select b.* from public.page_clean_bases b join public.pages pg on pg.id = b.page_id
  where b.page_id = p and b.to_seq >= pg.clean_reset_seq and b.to_seq <= pg.update_seq
    and exists (select 1 from public.page_updates u where u.page_id = p and u.seq = b.to_seq and u.id = b.last_update_id);
$$;
revoke all on function private.current_clean_base(uuid) from public, anon, authenticated;

-- 5. Bajar: misma firma. Quien ve lo borrado (o con el interruptor apagado), las filas como hoy; si no, la base.
create or replace function public.pull_page_updates(p_page_id uuid, p_after_seq bigint, p_limit int default 200)
returns table (seq bigint, update text)
language plpgsql stable security definer set search_path = '' as $$
declare b public.page_clean_bases;
begin
  if not private.can_view_page(p_page_id) then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  if (select ws.clean_min_version is null from public.workspace_settings ws limit 1) or private.sees_deleted(p_page_id) then
    return query select u.seq, translate(encode(u.update, 'base64'), E'\n', '') from public.page_updates u
      where u.page_id = p_page_id and u.seq > p_after_seq order by u.seq limit least(greatest(p_limit, 1), 1000);
    return;
  end if;
  b := private.current_clean_base(p_page_id);
  if b.page_id is not null and b.to_seq > p_after_seq then
    return query select b.to_seq, translate(encode(b.state, 'base64'), E'\n', '');
  end if;   -- sin base vigente: nada (la página está en preparación)
end; $$;

-- 6. Armar: qué páginas y subir una base. Piden sees_deleted, el interruptor y la versión.
create function public.clean_work(p_app_version text)
  returns table (page_id uuid, update_seq bigint, clean_seq bigint, base_bytes int) ...;  -- la cadencia de 4.1
create function public.push_clean_base(p_id uuid, p_page_id uuid, p_to_seq bigint, p_last_update_id bigint,
  p_state text, p_sha256 text, p_app_version text) returns text ...;
  -- con la fila de la página bloqueada: 'ok' | 'clean_old' (no más nueva) | 'clean_stale' (to_seq < clean_reset_seq);
  -- errores por nivel, versión, fila final con otro id, to_seq > update_seq, tamaño y huella. Al aceptar: upsert,
  -- clean_seq = to_seq, clean_at = now(). Mismo id ya guardado: 'ok'.
-- revoke de public y anon, grant execute a authenticated.

-- 7. Compartir con alguien que no ve lo borrado reinicia lo alcanzado: share(), create_invitation() (la página y su
--    rama, o todo el proyecto) y pages_permissions() al mover una página a una rama con lectores.
--    update public.pages set clean_reset_seq = update_seq, clean_seq = 0 where ...;

-- 8. Fotos y archivos: un uso sacado no cuenta para quien no ve lo borrado de esa página.
create or replace function private.can_view_file(p_file uuid, p_created_by uuid) returns boolean ...
  -- igual que hoy, con: and (pf.removed_at is null or private.sees_deleted(pf.page_id))
create or replace function private.file_level(p_file uuid) returns int ...          -- lo mismo en su max()
drop policy page_files_select on public.page_files;
create policy page_files_select on public.page_files for select to authenticated
  using (private.can_view_page(page_id) and (not is_foreign or private.file_level(file_id) >= 1)
         and (removed_at is null or private.sees_deleted(page_id)));

-- 9. El árbol trae clean_seq (la app la pide según schema_version).
grant select (clean_seq) on public.pages to authenticated;
update public.workspace_settings set schema_version = <la que siga> where id and schema_version < <la que siga>;
notify pgrst, 'reload schema';
```

## 8. Cambios en la app

| Archivo | Entrega | Qué cambia |
|---|---|---|
| `src/sync/clean.ts` (nuevo) | 1 | Armar la base desde lo guardado (incremental, con el documento con GC en memoria mientras dura la sesión), las dos comprobaciones |
| `src/sync/remote.ts`, `types.ts` | 1 | `cleanWork`, `pushCleanBase`; `PageRow.clean_seq?` pedida según `schema_version`, con reintento sin ella |
| `src/sync/engine.ts` | 1 | `serverSeqFor(row)` en todo lo que hoy compara con `update_seq`; al final del ciclo, armar bases (sus errores no cortan el ciclo) |
| `src/sync/docs.ts` (`applyRemote`) | 1 | Una base reemplaza lo guardado de la página si no hay nada sin subir |
| `src/media/offline.ts`, `src/search/projectIndex.ts`, `projectReplace.ts` | 1 | `serverSeqFor` |
| Ventanas de compartir e invitar | 0 y 1 | La línea del aviso; armar las bases al compartir, con progreso |
| La página | 1 | El aviso "en preparación" |
| `src/sync/docs.ts` (rearmar lo guardado) | 3 | Al dejar de ver lo borrado, sin nada sin subir; borrar la caché del historial |
| `src/sync/testing.ts` | 1 | El servidor en memoria con la base, `sees_deleted`, el reinicio y el interruptor |
| Ayuda (`src/help/entries.ts`, `src/i18n/lazy/help.ts`) | 0 y 1 | *Who can see what was deleted* |
| `Doc_Sincronizacion.md`, `Doc_Historial.md`, `Doc_Compactar.md` (secciones 4.3 y 10), `Doc_Supabase.md` | 1 | Lo que cambia, al implementar |

## 9. Plan de pruebas

1. **La base (`src/sync/clean.test.ts`),** P7 pasado a vitest con `PageDocs` y el servidor en memoria: lectores, un
   invitado que edita (con el cursor que se adelanta al subir), un lector que pasa a editor, un editor que pasa a
   invitado, un dispositivo nuevo al final, editores con el árbol atrasado, dos editores que arman a la vez, sin red,
   una copia restaurada, y la versión publicada (`fixtures/publishedDocs.ts`) como editor. En cada paso, el invariante
   de tokens (lo que recibe quien no edita estuvo visible en alguna base que recibió; el dispositivo nuevo, solo la
   última) y, al final, todos iguales al servidor. **Mutantes:** servir filas, base sin GC, sin `to_seq >=
   clean_reset_seq`, sin reinicio al compartir.
2. **Con el editor real** (`src/ui/cleanEditor.test.ts`, jsdom): una página con fotos en línea, foto-bloque con
   epígrafe, Script, preguntas, tablas, tarjeta de Drive y colapsar para todos; se pisan y borran cosas con un secreto
   en cada lugar; la base no tiene ningún secreto en sus bytes, y la página que abre un lector es igual a la del editor
   (sin reparaciones de más).
3. **El dispositivo:** `serverSeqFor` (lector al día con `clean_seq`, "en preparación"), una base que reemplaza lo
   guardado (y que no lo reemplaza con algo sin subir), *Available offline* y el índice de búsqueda de un lector, el
   rearmado al pasar a lector (entrega 3).
4. **La subida no cambia:** las pruebas de B.16 (`uploadNoGc.test.ts`, `history.test.ts` "filas de los dos tipos") y
   la corrida al azar con el editor real (`collabRemovedWriting.test.ts`) pasan sin tocarlas; esta última, con 100
   semillas, cuando se arregle su frente aparte.
5. **Permisos en SQL** (`supabase/tests/privacidad_borrado_permisos.sql`, en `begin … rollback` con un script propio,
   nunca `npm run db:test`): con el interruptor apagado, todos bajan filas como hoy; prendido, Ver, Comentar y un
   invitado con Editar reciben solo la base (sus bytes no coinciden con ninguna fila) o nada si no hay base vigente;
   Editar, Editar y crear y el dueño, las filas; `select update from page_updates` da 42501 para todos;
   `push_clean_base` rechazado a nivel 1 y 2 y a invitados, con la fila final con otro `id`, `to_seq` mayor que
   `update_seq`, menor que `clean_reset_seq` (el caso B3: una base anterior a compartir), no más nueva, otra huella o
   más de 8 MB; compartir, invitar y mover reinician; un proyecto borrado no sirve nada; `has_plain_readers` con
   permisos por proyecto, por página y revocados; **fotos:** un uso con `removed_at` no se lista ni da `can_view_file`,
   `file_level` ni la miniatura a Ver, Comentar ni a un invitado con Editar, y sí al editor. **Mutantes de la
   migración:** sin la rama de lectores en `pull_page_updates`, con la columna `update` legible, `sees_deleted` sin el
   invitado, `current_clean_base` sin `clean_reset_seq`, `file_level` sin `removed_at`. Las demás pruebas de
   `supabase/tests/` siguen pasando con la migración puesta.
6. **Rendimiento:** P8 en el iPhone (armar una base de 2000 y 10 000 subidas, incremental y de cero) y lo que baja un
   lector en vivo durante una hora de edición.
7. **De punta a punta** (Playwright contra la base, lista para Lega): un editor escribe un secreto y lo borra, y saca
   una foto; comparte la página con Ver a una cuenta de prueba; esa cuenta abre la página: su IndexedDB y sus respuestas
   de red no tienen el secreto, y la foto sacada no se abre; el editor escribe algo que queda y otra cosa que borra en
   5 s sin parar de escribir: al lector le llega lo primero y no lo segundo.

## 10. Entregas y orden

0. **Ya (sin migración):** la línea en la ventana de compartir y la entrada de la ayuda que dicen lo que pasa hoy.
1. **La base limpia y los archivos sacados** (migración + app; pruebas 1 a 5 y 7). Se publica con el interruptor
   apagado (los permisos de archivos y la columna `update` valen desde que se aplica). Para prenderlo en Wanka: el
   cambio del script de restaurar (repo privado), `min_app_version` a la versión de esta entrega, copia de seguridad, y
   `clean_min_version`. **Antes de invitar al primer cliente de verdad.** Depende del frente de la papelera para cubrir
   las subpáginas borradas.
2. **Medir con el uso:** el peso y la frecuencia de las bases de las páginas compartidas (`page_clean_bases`,
   `clean_at`) y el egress del mes.
3. **Limpiar el dispositivo de quien deja de ver lo borrado** (app; prueba 3), y una vez en cada dispositivo de un
   lector al prender el interruptor; con la caché del historial (P.18, entrega 3), borrarla en el mismo paso.
4. **Más adelante, si 2 lo pide:** deltas entre bases (F2) para páginas grandes muy editadas, sin perder lo que da F1:
   que un dispositivo que no está en la cadena reciba siempre una base al día. Y el canal en vivo (D-04) solo para quien
   ve lo borrado.

Antes de cerrar cada entrega, la auditoría de siempre (funcionalidad, permisos y RLS, no perder datos, docs).

## 11. Riesgos

| Riesgo | Qué lo cubre |
|---|---|
| Una base con texto borrado (un error, un `keep` de Yjs) | La comprobación de privacidad antes de subir y su mutante; la prueba con secretos en cada lugar |
| Una base a la que le falta algo: el lector ve la página incompleta | La comprobación de contenido; la próxima base de cualquier editor la reemplaza; las filas siguen enteras (D4) |
| Una base de antes de compartir (vista atrasada, reintento) | `to_seq >= clean_reset_seq` en `push_clean_base` y en `current_clean_base`, con mutante (P7 `noreset`: 374 notas) |
| El lector espera a que un editor abra la app | La demora está acotada mientras alguien edita; "en preparación" lo dice; al compartir se arman las bases enseguida |
| Páginas grandes muy editadas con lectores en vivo gastan egress | La cadencia por tamaño; medir (entrega 2) y, si hace falta, deltas (entrega 4) |
| Una versión vieja como lector, sin entender `clean_seq` | El interruptor solo con `min_app_version` en la versión nueva |
| `has_plain_readers` caro en cada ciclo | Se pide solo si el dispositivo subió o bajó algo, o cada 2 minutos; solo entre quienes tienen permisos sobre la rama |
| Restaurar una copia revive una base | El script vacía `page_clean_bases` (requisito para prender) y la vigencia mira el `id` de la fila final |
| El rearmado del dispositivo o el reemplazo por la base pierde algo sin subir | Solo sin nada sin subir; prueba 3 |
| Un editor malintencionado | Mismo poder que editando; la próxima base de otro editor la reemplaza |

## 12. Decisiones

- **D19 (coordinador, 2026-10-02): se saca la entrega del "GC selectivo".** D15 queda como está: la subida no descarta
  lo borrado. Motivo: el bloqueante 1 de la auditoría (pierde texto huérfano por la compactación al abrir y por
  `ORIGIN_REPAIR`: entre 61 y 118 letras con el editor real y 100 semillas) y que con la base limpia los lectores quedan
  protegidos igual (P7 corre con la subida de hoy: 0 fugas). Queda como alternativa descartada (sección 3, G). Si algún
  día se quisiera, "lo borré yo a propósito" tendría que anotarse al guardar (una clave de `meta` por página que
  compactar no toque), no deducirse de los delete sets guardados.
- **D20 (coordinador, 2026-10-02, evaluado acá): "solo bases" es la entrega principal; los deltas, mejora futura.**
  Cubre el escenario real (el primer cliente invitado, pasos 9 y 10 de `Plan_Workspaces.md`: páginas de decenas de KB)
  con 5,2 MB por día en un reporte de 2000 subidas, y resuelve el bloqueante 4 (teléfono nuevo: 0 de 4988 textos ya
  borrados, contra 5058 de 10 429 con deltas) sacando el encadenado.
- **Quién recibe lo borrado: el mismo criterio que el historial (D13).** Si Lega abre el historial a quien comenta o a
  los invitados, esta regla cambia con él (una sola función), y también los permisos de los archivos sacados.
- **Al compartir, la base arranca de cero** (`clean_reset_seq`), **al invitar y no al aceptar** (4.2).
- **Sin base vigente, el lector no ve nada** ("en preparación") en vez de recibir las filas.
- **Cadencia: 20 s sin escribir, o 2 minutos por cada 100 KB de base mientras se escribe.** Es un parámetro de
  `clean_work`; se ajusta con lo que mida la entrega 2.
- **Al dejar de ver lo borrado, el dispositivo rearma lo suyo** cuando no tiene nada sin subir (entrega 3).

## 13. Pregunta para Lega

1. **¿Aceptás que quien solo ve o comenta (y los invitados) reciba la página como estaba la última vez que la app de
   un editor la "pasó en limpio", en vez de letra por letra?** Ejemplo: en el set escribís en el reporte «el actor llegó
   tarde por X». Si lo borrás a los 10 segundos sin dejar de escribir, al cliente **no le llega nunca**. Si lo dejás un
   minuto y después lo borrás, **le pudo llegar** (estuvo en una copia limpia) aunque ya no lo vea en pantalla; un
   teléfono nuevo del cliente que abra la página mañana **no** lo recibe. Lo que queda le aparece unos 20 segundos
   después de que dejás de escribir (cada 2 minutos si seguís escribiendo); si cerrás la app enseguida, cuando vos u
   otro editor la vuelvan a abrir, y mientras ningún editor la haya preparado la página le dice "en preparación". Un
   cliente con Editar escribe sobre esa copia con la misma demora (Yjs junta las ediciones como siempre). La
   alternativa, mandarle las ediciones al momento, le haría llegar también todo lo escrito y borrado, como hoy.
   **Recomendación: aceptar.**

## Correcciones de la auditoría (2026-10-02)

Una auditoría independiente rechazó la primera versión (cuatro bloqueantes) y aprobó la dirección. Todo quedó corregido
arriba:

| Hallazgo | Corrección |
|---|---|
| **B1.** El GC selectivo pierde lo escrito adentro de algo que otro borró: la compactación al abrir y las reparaciones (`ORIGIN_REPAIR`) guardan delete sets que nombran lo propio; 61 a 118 letras con el editor real y 100 semillas | D19: se saca la entrega; la subida queda como hoy (sección 3, G; sección 12) |
| **B2.** Los usos sacados de fotos y archivos siguen dando permiso a quien solo ve (`can_view_file`, `file_level`, `page_files`, `thumbs`, el portero); la sección 2 decía lo contrario | Sección 4.4 y migración, punto 8; la sección 2 corregida; prueba 5 con mutante; `sdfile://` nombrado en la sección 6 |
| **B3.** Una base armada con la vista atrasada (o un reintento) llega después de compartir con la nota viva | `clean_reset_seq = update_seq` al compartir y `to_seq >= clean_reset_seq` al subir y al servir; P7 `noreset`: 374 notas |
| **B4.** Un dispositivo nuevo del lector recibe lo borrado entre piezas desde la última base; la pregunta decía lo contrario | D20: solo bases (0 de 4988); pregunta y resumen reescritos con lo que de verdad garantiza |
| Obs. 3: la entrega 1 cambiaba D15 sin preguntar | D19 |
| Obs. 4: faltaba "solo bases" | D20 |
| Obs. 5: el invitado con Editar se sale de la cadena al subir | Sin cadena: espera la base siguiente; costo medido en P7 (4.3) |
| Obs. 6: reiniciar al aceptar | Se mantiene al invitar, con el motivo (4.2) |
| Obs. 7: compactar nunca desde un ex lector | Requisito anotado (sección 5) |
| Obs. 8: `history.test.ts` no seguía pasando | Sin GC selectivo no cambia (prueba 4) |
| Obs. 9: P4 no calculaba `demotedViolations` ni modelaba vista atrasada ni el cursor del invitado | P7 los calcula y los modela |
| Obs. 10: la pregunta no decía "en preparación" ni lo del invitado con Editar | Pregunta reescrita |
| Las mutantes no eran de "300 corridas" | Re-medidas con 300 × 200 (4.5) |
| Fuera de alcance: páginas en la papelera legibles con Ver; `collabRemovedWriting` con 100 semillas | Frentes aparte del coordinador; nombrados como dependencias (secciones 5, 6 y 10) |

## Cómo se midió

Prototipos en Node 20 con Yjs 13.6.33 (el de la app), fuera del repo, en la carpeta de trabajo de la sesión
(`privacidad/`, con sus resultados en `res_*.txt`; los de la auditoría, en `audit-privacidad/`). No se imprimió ni se
guardó en el repo contenido de la base.

- **P1, filas reales:** `ro.mjs` (cliente de la Management API en modo solo lectura, `readOnlySql`) bajó las filas de
  las 15 páginas con más filas; `p1_real.mjs` y `p1b.mjs` cuentan lo borrado legible y arman la base limpia (lo visible
  sale igual en las 15; borrado legible en la base: 0). La base también dio: 826 filas en 720 páginas, un solo
  miembro, un permiso.
- **P2, el GC con la forma de BlockNote:** `p2_gc.mjs`, un secreto en cada lugar donde algo se borra o se pisa.
- **P7, solo bases:** `p7_bases.mjs` sobre `sim.mjs` (dispositivos con el patrón de la app: el documento abierto con
  GC, cada edición guardada, la subida armada desde lo guardado en orden, `buildUpload` de B.15 portado a JS en
  `ds.mjs`), 300 corridas de 200 pasos, tokens únicos para saber qué viajó, y las mutantes `MUT=raw`, `nogc`,
  `noreset`. **Límites:** sin el editor real (párrafos con texto plano); las bases las arma el servidor de la
  simulación con las filas hasta `to` (en la app, un editor desde lo suyo, que al día es lo mismo); la cadencia es una
  probabilidad por paso, no tiempo.
- **P8, costo de solo bases:** `p8_costo_bases.mjs` (un editor, 500, 2000 y 10 000 subidas, una base cada 20, y con
  la cadencia por tamaño). P5 (`p5_costo.mjs`) da los números de los deltas.
- **De la primera versión, todavía válidos:** P4 (`p4_lector.mjs`, la cadena con deltas, re-medida con 300 × 200 para
  las mutantes) y P3/P6 (el GC selectivo, descartado).
- **Lo que no se midió:** el iPhone; el editor real (BlockNote en jsdom) sobre las bases; la migración contra la base
  (borrador, con partes en `...`: no se corrió ni en `begin … rollback`); `has_plain_readers` con muchos miembros; el
  egress real de un cliente.
