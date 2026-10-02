# Privacidad de lo borrado (D14)

**Estado: diseño, sin código ni migración aplicada** (roadmap B.18, 2026-10-02). Toca los permisos (quién recibe
qué bytes de una página) y el contrato de datos (qué viaja en `page_updates`), así que cada entrega va con sus pruebas
de permisos y su auditoría. Lo medido está en prototipos fuera del repo (sección "Cómo se midió").

## En corto

- **El problema, medido.** El contenido de una página viaja como filas de `page_updates`, y cada fila tiene el texto
  tal como se subió. Quien puede **ver** la página (también Comentar y los invitados) baja todas las filas con
  `pull_page_updates`, y con eso puede leer todo lo que alguna vez se escribió y después se borró: texto, links,
  nombres y epígrafes de fotos pisados, la dirección `sdmedia://` de fotos sacadas, bloques enteros. En la página real
  más editada (63 filas) hay 158 elementos borrados legibles; en una simulada de 2000 subidas, 10 368 letras. Además,
  hoy cualquiera que ve la página puede leer la columna `update` de la tabla directo por la API.
- **Desde v0.095 (B.16) es peor:** la subida se arma sin GC, así que también viaja lo que se tecleó y se borró antes
  de subir (una contraseña pegada por error y borrada al segundo), hasta 6 MB por subida. Simulado: el 100 % de lo
  que un dispositivo borra antes de subir llega al servidor (5683 de 5683 casos).
- **Quién recibe lo borrado:** solo quien ve el historial (D13): puede editar la página (Editar o Editar y crear
  páginas, el dueño y los admins con permiso) **y no es invitado**. Ver, Comentar y los invitados (aunque tengan
  Editar) reciben en su lugar **una cadena limpia**: una base (la página entera con lo borrado como hueco) y deltas (lo
  nuevo entre dos momentos, también con huecos). La arma el dispositivo de alguien que edita, como el snapshot de
  compactar (D5), y la base la guarda y la sirve con controles de forma.
- **Dos cambios, en este orden:**
  1. **Subida con GC selectivo** (solo app, sin migración): lo que un dispositivo borró él mismo antes de subirlo no
     sale nunca del dispositivo; lo propio que quedó adentro de algo que **otro** borró sigue subiendo con su texto
     (D15 intacto). Simulado en 500 corridas: 0 de 5704 borrados propios viajan, 1690 de 1690 textos "huérfanos"
     llegan, y las filas pesan un 7 % menos que hoy. Protege también a los editores, las copias de seguridad y el
     historial.
  2. **La cadena limpia para quien no ve el historial** (migración + app): `pull_page_updates` le sirve piezas
     limpias en vez de filas, la columna `update` deja de leerse directo, y al compartir una página con alguien nuevo
     la cadena arranca de cero. Simulado en 300 corridas con lectores, invitados que editan y cambios de permiso: 0
     textos recibidos que no estuvieran visibles en algún momento de armado después de compartir; con las mutantes
     (servir filas, o armar sin GC), más de 1400.
- **Lo que garantiza:** quien no edita recibe la página como estaba al compartírsela y después como estaba cada vez que
  un editor armó una pieza (unos 20 s después de que deja de escribir, o cada 2 minutos mientras escribe). Lo que se
  escribió y se borró antes de compartirla, o entre dos piezas, no le llega nunca.
- **Lo que no garantiza:** lo que un dispositivo ya bajó no se puede "desbajar" (los lectores de hoy, un editor que
  pasa a lector: se limpia lo guardado en el dispositivo, pero no se puede asegurar); los largos de lo borrado y los
  nombres de los atributos pisados siguen viajando (no el contenido); y quien edita ve todo, por diseño (D13).
- **Costo:** los editores suben deltas además de sus filas (entre 45 y 90 % más de bytes de subida, solo en páginas con
  algún lector); quien no edita baja menos que hoy (la base limpia pesa un 30 % menos que el snapshot completo). Armar
  un delta: 0,5 a 1,7 ms; una base de 10 000 subidas, 73 ms. Sin servicios nuevos: entra en el plan gratis de Supabase.
- **Una pregunta para Lega** (sección 13): aceptar que el cliente vea los cambios con esa demora en vez de letra por
  letra. Recomendación: sí.

**En términos simples:** hoy, si escribís una nota interna en una página y la borrás, el texto sigue viajando dentro de
la página a cualquiera que la pueda ver, también a un cliente invitado; no lo ve en la pantalla, pero está en su
navegador. El diseño hace dos cosas: lo que borrás antes de que se suba deja de salir de tu dispositivo, y a quien
solo ve se le manda una copia "pasada en limpio" de la página, armada por el dispositivo de alguien que edita, sin lo
borrado. El precio es que el cliente ve los cambios con unos segundos o un par de minutos de demora.

## Reglas que no se rompen

1. **Ninguna fila de `page_updates` se borra ni se modifica** (D4). La cadena limpia es una copia derivada: se puede
   tirar y volver a armar desde las filas en cualquier momento.
2. **El servidor decide quién recibe qué.** La regla vale aunque el dispositivo tenga una versión vieja de la app o
   alguien llame a la API a mano: por eso cambia `pull_page_updates` y se cierra la lectura directa de la tabla.
3. **Nada propio sin subir se pierde.** El GC selectivo descarta solo lo que el mismo dispositivo borró y nunca subió;
   la limpieza del dispositivo de alguien que pasa a lector espera a que no tenga nada sin subir.
4. **Sin servicios centrales ni claves nuevas** ("cada workspace es una isla", `Doc_Roadmap.md`): arman los
   dispositivos de quien edita; la base controla la forma.
5. **Nada de tipos de bloque nuevos** ni cambios en el documento: todo es cómo se arma y cómo se sirve lo que ya hay.

## 1. Qué pasa hoy

### 1.1 Por dónde viaja lo borrado

| Canal | Quién | Qué lleva |
|---|---|---|
| `pull_page_updates` (lo que usa la app para bajar) | Nivel 1 o más: Ver, Comentar, Editar, invitados | Todas las filas, con el texto tal como se subió |
| `select update from page_updates` directo por la API | Nivel 1 o más (política `page_updates_select`; la migración del historial dejó la columna `update` legible) | Lo mismo, sin pasar por la app |
| IndexedDB del dispositivo (`docUpdates`) | Cada dispositivo que bajó la página | Lo bajado tal cual (`applyRemote` guarda la unión de las filas) |
| Lo tecleado y borrado antes de subir (B.16, v0.095) | Todos los anteriores | Hasta 6 MB por subida (`NO_GC_MAX_BYTES`) |
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

- Hoy hay un solo miembro (el dueño) y ningún invitado: nadie recibió nada que no debía. Con el uso real (un cliente
  invitado a un desglose, reportes de rodaje corregidos todo el día) es distinto: en la simulación de 2000 subidas
  quedan **10 368 letras borradas legibles** en las filas, y 54 339 en la de 10 000.
- **El GC de Yjs saca todo el contenido** (prototipo P2, con la forma de BlockNote): un secreto puesto en el texto, en
  un link (`href`), en un formato, en el `url`, `caption` y `name` de una foto pisados, en un bloque borrado, en un
  hijo con sangría, en una celda de tabla y en el mapa de colapsar está en los bytes de las filas y **en ninguno** de
  los del snapshot limpio. Lo visible sale igual. Lo que queda: 13 huecos con su largo (126), quién y en qué reloj, y
  los nombres de los atributos pisados (`url`, `caption`, `name`) y las claves del mapa de colapsar (ids de bloque).

## 2. Quién recibe lo borrado y quién no

| Quién | Nivel | ¿Ve el historial? (D13) | Recibe | En su lugar |
|---|---|---|---|---|
| Dueño del proyecto | 4 | Sí | Las filas (todo) | — |
| Admin o miembro con Editar y crear páginas | 4 | Sí | Las filas | — |
| Miembro con Editar | 3 | Sí | Las filas | — |
| Miembro con Comentar | 2 | No | La cadena limpia | Base + deltas |
| Miembro con Ver | 1 | No | La cadena limpia | Base + deltas |
| Invitado (cualquier permiso, también Editar) | 1 a 4 | No | La cadena limpia | Base + deltas; si tiene Editar, sube sus filas como cualquiera |
| Sin permiso, sacado, sesión con contraseña | 0 | No | Nada | — |

- **La regla es la misma que la del historial**, `private.page_level(p) >= 3 and not guest`: quien ve el historial ve
  lo borrado de todos modos, así que mandarle las filas no le agrega nada; a quien no lo ve, mandárselas le daría por
  la red lo que la pantalla le niega. Una sola función (`private.sees_deleted`) para las dos cosas.
- **El invitado con Editar** escribe sobre la cadena limpia: Yjs funciona igual con lo borrado como hueco (es lo que
  hace cualquier documento con GC, como el que tiene abierto el editor). Sus filas suben como las de cualquiera.
- **"Ver" incluye los originales de las fotos** (decisión de Lega): eso no cambia. Lo que cambia es que una foto
  sacada de la página ya no deja su dirección `sdmedia://` ni su nombre en lo que baja el lector; poder abrirla sigue
  dependiendo de `can_view_file` (que pide que alguna página que ve la use).

## 3. Las alternativas

| | Qué es | Protege | Costo y qué rompe | Plan gratis / isla |
|---|---|---|---|---|
| **A. No hacer nada y decirlo** | Aviso al compartir y en la ayuda | Nada | Nada | Bien |
| **B. Filas "públicas" por fila** | El dispositivo sube cada fila dos veces: entera y con GC; el lector baja la segunda | Solo lo borrado **antes** de subir | El doble de subida. No protege lo que se borra **después** (el caso de la nota interna borrada antes de compartir) | Bien |
| **C1. Filtrar en Postgres** | Una función en plpgsql que decodifique Yjs y cambie el contenido borrado por huecos | Todo | Reescribir el formato de Yjs en SQL: frágil, lento en cada bajada, y no ve los huérfanos sin integrar el documento | Bien, pero inmantenible |
| **C2. Edge Function de Supabase** | JavaScript con Yjs y la clave de servicio arma lo limpio | Todo | Un componente que cada dueño publica aparte, con la clave que saltea los permisos; 2 s de CPU por pedido en el plan gratis | Rompe "todo se publica con el push" (misma razón que D5) |
| **C3. El portero** | El Worker del dueño arma lo limpio | Todo | No tiene ni debe tener clave de la base; con la sesión del lector solo vería lo mismo que el lector; un workspace puede no tenerlo | No |
| **D. Cifrado** | Las filas cifradas con una clave que tienen solo los editores | Lo guardado en el servidor | Los lectores igual necesitan una versión legible sin lo borrado (vuelve a B o F); repartir y rotar claves al cambiar permisos | Complejo, no resuelve |
| **E. Snapshot limpio cada tanto + filas después** | Un editor arma la página entera con GC; el lector baja eso y las filas siguientes | Lo borrado antes del último snapshot | Las filas que siguen llevan lo escrito y borrado desde entonces (si el editor cierra la app, toda su última sesión) | Bien |
| **F. Cadena limpia (base + deltas)** (elegida) | Como E, pero el lector nunca baja filas: solo piezas limpias; un delta es lo nuevo entre dos momentos, con GC | Todo lo borrado entre dos piezas, y todo lo de antes de compartir | La demora del lector (sección 4.3); los editores suben los deltas | Bien: lo arma el dispositivo de quien edita (D5) |
| **G. Subida con GC selectivo** (elegida, además) | Lo borrado por uno mismo antes de subir no sube | Lo tecleado y borrado al toque, para todos (editores y copias incluidos) | Revierte el efecto secundario de B.16, no su objetivo (D15) | Bien: solo app |

- **Por qué no E.** El caso que importa es "escribo una nota interna, la borro, comparto la página": E lo cubre solo si
  el snapshot es posterior al borrado. Con un lector que abre la página a la noche, recibe las filas desde el último
  snapshot, que pueden ser las de toda la tarde. Probado: si el servidor sirve filas al lector (mutante `raw` de P4),
  recibe 1423 textos que nunca estuvieron visibles en un momento de armado, 560 de ellos de antes de compartir.
- **Una variante descartada de E:** servir las filas siguientes solo hasta la primera con borrados (un dato que el
  dispositivo mandaría al subir). No sirve: la fila que **agrega** la nota se sirve y la que la borra queda retenida,
  así que el lector ve la nota en pantalla, en un estado viejo de la página.
- **Por qué G además de F.** F protege a los lectores; G protege lo que nadie debería recibir: lo tecleado y borrado
  en el mismo segundo no sirve para nada (el historial tiene la resolución de las subidas, `Doc_Historial.md` 3.2) y
  hoy queda para siempre en el servidor, en las copias de seguridad y en el dispositivo de cada editor.

## 4. El diseño

### 4.1 Subida con GC selectivo (entrega 1)

Hoy `readSaved(…, { keepDeleted: true })` arma la subida en un `Y.Doc({ gc: false })` con las filas guardadas en
orden. El cambio: un `Y.Doc` **con GC y un `gcFilter`** que recolecta un elemento solo si

- es **propio y nuevo**: su reloj no está en `syncedSV` (el servidor no lo tiene), y
- **este dispositivo lo borró a propósito**: su id está en el delete set de alguna fila guardada en `docUpdates`.

Por qué esa regla: cuando el dispositivo borra algo (un texto, un bloque), Yjs anota en esa edición el elemento y todo
lo que tenía adentro, y la edición se guarda. Cuando **otro** borra un bloque en el que este dispositivo escribía, el
borrado del otro nombra lo que el otro vio, y lo propio nuevo queda borrado **sin que ninguna fila guardada lo nombre**
(se integra borrado al armar la subida, porque cuelga de un bloque borrado). Es la misma distinción que ya usa el aviso
de B.16 (`findRemovedWriting`: "lo propio que quedó borrado sin que el borrado lo nombre").

```ts
// En readSaved, para subir (B.16 + D14). `stored`: la unión de los delete sets de las filas guardadas.
const sv = decodeStateVector(state.syncedSV);
const doc = new Y.Doc({
  gcFilter: (item) => item.id.clock >= (sv.get(item.id.client) ?? 0) && rangesHas(stored, item.id.client, item.id.clock),
});
applyRowsInOrder(doc, rows.map((r) => r.data), ORIGIN_LOAD); // una sola transacción: el GC corre al final, con todo
```

- **Si no se puede usar `syncedSV`** (estado de una versión anterior, generación distinta): sin GC, como hoy. Ante la
  duda gana no perder (D15).
- **Medido** (P3, 500 corridas de tres dispositivos, 150 pasos, borrar textos y bloques, subir y bajar en cualquier
  orden):

| Armado de la subida | Lo borrado por uno mismo que viajó | Huérfanos que llegaron (D15) | Lo vivo que faltó | Bytes de filas |
|---|---|---|---|---|
| Con GC (antes de B.16) | 0 de 5684 | **0 de 1711** (se perdían) | 0 | 740 KB |
| Sin GC (hoy) | **5683 de 5683** | 1680 de 1680 | 0 | 842 KB |
| **GC selectivo** | **0 de 5704** | **1690 de 1690** | 0 | 785 KB |

  En todas las corridas los tres dispositivos y el servidor terminan iguales. Una primera versión de la regla (no
  recolectar si algún bloque de arriba lo borró otro) dejaba viajar texto que el dispositivo borró él mismo y
  después otro borró el bloque entero (134 en 200 corridas). La regla de la tabla los cubre.
- **Costo:** juntar los delete sets de las filas guardadas tarda 9 ms con 2000 filas y 32 ms con 17 000 (una sesión
  muy editada sin reabrir); armar con el filtro, lo mismo que sin GC (46 contra 44 ms). Se puede guardar la unión por
  página y sumarle solo lo nuevo (las filas guardadas solo crecen, y compactar en local conserva el delete set).
- **El historial pierde algo que no mostraba:** lo tecleado y borrado entre dos subidas ya no está en ninguna fila. Las
  versiones y las marcas por persona comparan versiones (sesiones), así que nunca lo mostraban; el texto huérfano, que
  sí muestran, sigue llegando.

### 4.2 La cadena limpia (entrega 2)

**Las piezas.** Por página, una cadena en la tabla nueva `page_clean`:

- **Base:** las filas `1..N` como las tiene el dispositivo de un editor, en un `Y.Doc` con GC, y
  `Y.encodeStateAsUpdate`. Igual a la página en `N`, con todo lo borrado como hueco.
- **Delta `(M, N]`:** lo nuevo desde la pieza anterior: `buildUpload(docN, svM, dsM)` (la función de B.15) sobre el
  mismo documento con GC. Lleva los elementos creados después de `M` (los que en `N` ya están borrados, como hueco) y
  solo los borrados que no estaban en `M`.
- Cada pieza guarda hasta qué fila llega (`to_seq`, con el `page_updates.id` de esa fila, como compactar), su vector
  de estado y su delete set al final (`sv_after`, `ds_after`): el que arma el delta siguiente los necesita y la base
  los usa para comprobar que encadena.

**Quién arma.** El dispositivo de alguien que ve lo borrado (nivel 3, no invitado), con una versión de la app igual
o mayor que `clean_min_version`, y **solo si tiene la página al día**: el cursor llegó a `update_seq`, no tiene nada
sin subir, ni subida en vuelo, ni filas ilegibles. Así lo guardado en el dispositivo es exactamente lo que tiene el
servidor hasta `N`, y arma desde lo local, sin bajar nada.

**Cuándo** (lo pide `clean_work()`, una vez por ciclo de sincronización y solo si el dispositivo subió o bajó algo, o
cada 2 minutos; como mucho 20 páginas por vuelta):

| Pieza | Cuándo |
|---|---|
| Base | La página tiene algún lector y no hay cadena vigente (primera vez, después de compartir con alguien nuevo, de invalidar, o de restaurar una copia); o los deltas desde la última base pesan más que ella (un lector nuevo bajaría el doble) |
| Delta | Hay filas después de la última pieza y, o la última fila tiene más de **20 s** (dejó de escribir), o la última pieza tiene más de **2 minutos** (sigue escribiendo) |

"Tiene algún lector" lo calcula la base: alguien activo con nivel 1 o 2 sobre la página, o un invitado con nivel 1 o
más. Una página que solo ven editores (hoy, todas) no arma nada: cero costo.

**Al compartir.** `share()` y `create_invitation()` con Ver, Comentar o para un invitado marcan las páginas alcanzadas
(la página y su rama, o el proyecto entero) con `clean_reset_at = now()`: las cadenas de antes dejan de servirse y
hace falta una base nueva. Así la persona nueva recibe la página **como está al compartírsela**, nunca los estados
anteriores que una cadena vieja (de otro lector) todavía lleva. Mover una página adentro de una rama con lectores hace
lo mismo con la página movida (el trigger `pages_permissions`). La app, al compartir, arma enseguida las bases de las
páginas alcanzadas, con progreso (*Preparing 12 pages for ana@…*); si se corta, las que faltan las arma el próximo
editor que sincronice. Medido: una base de una página típica, menos de 1 ms; la importada de 2 MB, 71 ms.

**Comprobaciones antes de subir una pieza** (en el dispositivo; la base no lee Yjs):

1. **Privacidad:** se decodifica la pieza y cada elemento con contenido tiene que estar vivo en el documento del que
   salió (ni borrado ni colgando de algo borrado). Una pieza armada sin GC (mutante) no pasa.
2. **Forma:** el delta empieza donde termina la pieza anterior (`parseUpdateMeta`: su `from` es el `sv_after` de la
   anterior en cada autor que toca, y su `to` es el vector de `N`), y la unión de su delete set con el anterior da el
   de `N`.
3. **Contenido**, en la base: aplicada en un documento nuevo, lo visible y `Y.snapshot` (vector y borrados) iguales a
   los del documento del editor. Cada 10 deltas, además, el editor baja la cadena como la bajaría un lector y la
   compara con su página; si no da igual, la invalida (como la segunda red de compactar, `Doc_Compactar.md` 4.4).

**La base controla la forma** (`push_clean_piece`): que quien sube vea lo borrado; que la fila `to_seq` exista con ese
`id`; que un delta encadene con la pieza vigente (`from_seq` igual a su `to_seq` y el mismo `sv_after`); tamaño hasta
8 MB; la huella SHA-256. Reintentar con el mismo `id` devuelve lo mismo. Si dos editores arman a la vez, el segundo
recibe `clean_conflict`, vuelve a pedir trabajo y arma desde la pieza nueva.

### 4.3 Cómo baja quien no ve lo borrado

`pull_page_updates(page, after_seq, limit)` mantiene su firma (la usan todas las versiones). Con
`clean_min_version` puesto y si quien llama **no** ve lo borrado:

- si `after_seq` es el final de una pieza de la cadena vigente: los deltas siguientes;
- si no (dispositivo nuevo, cursor de antes, cadena reiniciada): la base vigente y sus deltas;
- si no hay cadena vigente: nada. La página está "en preparación".

Cada pieza sale como una fila más, con `seq = to_seq`: `applyRemote` la guarda y mueve el cursor como con cualquier
fila, `syncedSV` avanza con `serverReach` (la base trae cada autor desde el reloj 0) y `syncedDS` suma sus borrados.

**Lo que ve.** El árbol trae `clean_seq` (el final de la cadena vigente). Para quien no ve lo borrado, "al día" es
`cursor >= clean_seq`, no `update_seq`: lo usan `isMissingContent`, la lista de páginas por bajar del ciclo, *Available
offline* (`offline.ts`), el índice de búsqueda y reemplazar en el proyecto (`projectIndex.ts`, `projectReplace.ts`),
con una sola función (`serverSeqFor(row)`). Con `clean_seq = 0` y contenido en el servidor, la página muestra *The
editors haven't prepared this page for you yet. It will appear when one of them opens the app.*

**La demora.** El lector ve los cambios cuando un editor arma la pieza: unos 20 s después de que deja de escribir, o
cada 2 minutos mientras escribe; si el editor cierra la app enseguida, cuando un editor vuelva a sincronizar. Es la
pregunta 1.

**Medido** (P4, 300 corridas: dos editores escriben notas y las borran antes de compartir; al compartir se arma la
base; después escriben, borran, un lector baja, un invitado con Editar escribe sobre la cadena, un lector pasa a
editor a mitad y un editor pasa a invitado a dos tercios; un delta en el 6 % de los pasos y una base nueva en el 1 %):

| | Resultado |
|---|---|
| Todos iguales al final (editores, lector, invitado, los que cambiaron de permiso) | 300 de 300 |
| Textos recibidos por el lector que no estaban visibles en algún momento de armado posterior a compartir | **0** de 14 015 |
| Lo mismo para el invitado que edita (sin contar lo suyo) | **0** |
| Textos de antes de compartir, borrados antes de compartir, que le llegaron | **0** |
| Mutante: el servidor le sirve filas | 1423 / 1197 / 560 |
| Mutante: las piezas se arman sin GC | 1433 / 1188 / 547 |
| Con los editores subiendo sin GC (hoy, sin la entrega 1) | 0: la cadena limpia no depende de la entrega 1 |
| Bytes: filas de los editores / piezas / lo que bajó el lector / lo que bajó un editor | 703 / 708 (base 377 + deltas 330) / 617 / 703 KB |

### 4.4 Lo que pesa en una página muy editada (P5, una PC)

| Subidas | Filas | Snapshot completo (sin GC) | Base limpia | Deltas (de a 20 subidas) | Armar un delta | Comprobar privacidad |
|---|---|---|---|---|---|---|
| 2000 | 149 KB | 164 KB | 116 KB (9 ms) | 128 KB en total, el más grande 1,8 KB | 0,5 ms | 3 ms |
| 10 000 | 779 KB | 824 KB (174 ms) | 571 KB (73 ms) | 672 KB en total, el más grande 2 KB | 1,7 ms | 16 ms |

En el teléfono, estimado de 3 a 5 veces (como el historial). La base solo se rearma al compartir o cuando los deltas
la superan; lo de cada momento es un delta de 1 o 2 KB.

## 5. Cómo convive con lo demás

- **Historial (D13).** Mismo criterio (`sees_deleted` es `check_history` sin la papelera). `page_history` no cambia y
  sigue sirviendo las filas enteras a quien edita. Con la entrega 1, lo tecleado y borrado entre dos subidas deja de
  estar en las filas; el texto huérfano sigue (`Doc_Historial.md` 5.4 y "Con la subida sin GC" se actualizan al
  implementar). La caché del historial (entrega 3 de P.18) se borra de un dispositivo cuando su persona deja de ver el
  historial de esa página (abajo).
- **Compactar (D4, D5, D6, D16).** D4: las filas no se tocan; la cadena limpia es otra copia derivada. D5: la arma el
  dispositivo de quien edita, igual que el snapshot. D6 (B.15): el delta usa la misma `buildUpload`. D16: el snapshot
  completo conserva lo borrado, así que **solo se sirve a quien ve lo borrado**: `pull_page_content` y
  `pull_page_snapshot` de `Doc_Compactar.md` piden `sees_deleted` (su sección 10 dice "bajar, nivel 1": cambia a esto);
  quien no lo ve ya baja algo compacto, la cadena limpia. Conviene hacer primero la cadena limpia (hace falta para
  compartir con clientes; compactar no es urgente) y reusar en compactar su forma de validar (`to_seq` con el `id` de
  la fila, la vigencia, el reinicio).
- **La subida sin GC (D15).** La entrega 1 conserva lo que D15 pidió (lo propio dentro de algo que otro borró llega al
  servidor y avisa) y saca solo el efecto secundario. El aviso de B.16 (`removedWriting`) no cambia: lee lo guardado en
  el dispositivo. Para quien no ve lo borrado y escribe (invitado con Editar), el aviso sigue andando con los deltas:
  sus borrados nombran lo mismo que nombraban las filas.
- **Editar sin red.** El editor sin red no arma piezas (no está al día); los lectores esperan. El invitado sin red
  escribe sobre lo último que bajó; al volver sube lo suyo y baja las piezas. Un lector sin red ve la última pieza.
- **Versiones viejas de la app abiertas.** El cambio de `pull_page_updates` es del servidor: una versión vieja que lee
  como lector recibe piezas (son updates de Yjs comunes) y no entiende `clean_seq`: pediría la página en cada ciclo y
  la vería "a medio bajar". Por eso el interruptor es `workspace_settings.clean_min_version` (nulo: apagado, todos
  bajan filas como hoy) y **antes de prenderlo se sube `min_app_version`** a esa versión: desde v0.097 una versión por
  debajo de la mínima no sube ni baja nada. La entrega 1 no necesita subirla (las versiones anteriores siguen subiendo
  sin GC, como hoy), pero conviene, para que lo tecleado y borrado deje de llegar desde todas.
- **De lector a editor.** Desde su cursor (el final de una pieza) baja las filas siguientes, y el historial entero por
  `page_history`: ve todo lo borrado, también lo de antes de que le dieran permiso (como Google Docs, D13). Su copia
  local, con huecos, sirve para editar (es lo que tiene cualquier documento con GC). Probado en P4.
- **De editor a lector (o a invitado).** Lo que ya bajó con las filas está en su dispositivo. La app, cuando una
  página deja de dar `sees_deleted` para esa persona (lo sabe por los permisos que ya baja) y la página **no tiene nada
  sin subir**, rearma lo guardado en una sola transacción: las filas de `docUpdates` se reemplazan por
  `encodeStateAsUpdate` de un documento con GC armado con ellas (el mismo vector y los mismos borrados, así que el
  cursor, `syncedSV` y `syncedDS` siguen valiendo), y se borra la caché del historial de esa página. Si tiene algo sin
  subir, espera a subirlo. Los avisos de B.16 (`removedWriting`, su propio texto) no se tocan. Lo mismo hace, una vez,
  todo dispositivo de alguien que no ve lo borrado cuando se prende el interruptor (lo bajado antes con las filas).
- **No perder nada.** La cadena es derivada; invalidarla o tirarla solo hace que los lectores vuelvan a bajar una base.
  El GC selectivo descarta lo que la misma persona borró antes de subir (no es un dato suyo vigente; antes de B.16 ya
  era así). El rearmado del dispositivo espera a que no haya nada sin subir.
- **Copias de seguridad y restaurar.** La copia lleva `page_clean` sola. El script de restaurar sobre el mismo
  proyecto (repo privado) tiene que vaciar `page_clean` y dejar `clean_seq` en 0 (como compactar, por la misma razón: no
  revivir piezas invalidadas); es requisito para prender el interruptor. Los dispositivos, con la generación nueva,
  bajan de cero: los lectores, una base nueva.
- **Tiempo real (D-04, a futuro).** Si las ediciones viajan por un canal en vivo (Realtime), ese canal es solo para
  quien ve lo borrado; los lectores siguen con piezas. Va anotado como requisito.
- **El asistente y el servidor MCP (fase 5).** Leen con los permisos de la persona: usan las mismas funciones y
  reciben lo mismo que ella.

## 6. Qué no se puede garantizar y cómo se dice

| No se puede garantizar | Por qué | Qué se hace |
|---|---|---|
| Que un dispositivo "olvide" lo que ya bajó | El navegador ya lo tuvo; borrar de IndexedDB no es borrado seguro; puede haber copias del perfil, capturas o exportaciones | Rearmar lo guardado cuando deja de ver lo borrado (5) y decirlo en la ayuda |
| Que quien mira la página en vivo no vea algo que después se borra | Lo vio: estaba en la página cuando se armó la pieza | Es lo esperable; lo que dura menos que una pieza no le llega |
| Que no se sepa nada de lo borrado | Los huecos llevan su largo, el autor de Yjs y el reloj; quedan los nombres de los atributos pisados y las claves del mapa de colapsar (ids de bloque); `update_seq` y `updated_at` dicen que hubo cambios | Es metadato, no contenido; se dice en la ayuda ("how much was deleted, not what") |
| Que quien edita no lo vea | Es el historial (D13) | Al compartir con Editar a un miembro, ve todo lo borrado |
| Que un editor malintencionado no muestre otra cosa a los lectores | Puede subir una pieza que no corresponde a la página | Lo mismo que puede hacer editando; la comprobación cada 10 deltas de cualquier otro editor la invalida |
| Lo que ya está en la base y en las copias | Las filas no se borran nunca (D4) | Lo tiene el dueño de la base; la regla es sobre quién lo recibe |
| Lo que suben versiones anteriores a la entrega 1 | Arman sin GC | Subir `min_app_version` |

**En la app** (textos en inglés, con su traducción en `src/i18n/`):

- **Al compartir** con Ver, Comentar o con un invitado, una línea en la ventana: *They'll get this page as it is now,
  not its history or what was deleted from it.* Hasta que esté la entrega 2 (entrega 0): *Text deleted from these
  pages can still reach the people you share them with.*
- **La página en preparación** (4.3) y, en la ayuda, la entrada *Who can see what was deleted*: la tabla de la sección
  2 en dos líneas, la demora de los lectores, que se ve el largo de lo borrado y no el contenido, y que lo que un
  dispositivo ya bajó no se puede borrar de otro.

## 7. Migración (borrador, sin aplicar)

Va como `supabase/migrations/<fecha>_privacidad_borrado.sql`, con su prueba
`supabase/tests/privacidad_borrado_permisos.sql`, en la entrega 2. Deja el interruptor apagado. Necesita `pgcrypto`
(`extensions.digest`), que Supabase ya trae.

```sql
-- Privacidad de lo borrado (D14; Docs/Doc_Privacidad_Borrado.md). Quien no ve el historial no recibe filas: recibe
-- la cadena limpia que arman los editores. Nada se borra de page_updates.

-- 1. El contenido de page_updates no se lee directo desde la API (nadie: la app baja por funciones). Las demás
--    columnas siguen como dejó el historial (las pruebas de permisos cuentan filas).
revoke select (update) on public.page_updates from authenticated;

-- 2. ¿Esta persona recibe lo borrado de esta página? Lo mismo que el historial (D13), sin mirar la papelera.
create function private.sees_deleted(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.page_level(p) >= 3 and not private.history_denied_for_guest();
$$;
revoke all on function private.sees_deleted(uuid) from public, anon, authenticated;

-- 3. ¿Alguien activo la ve sin ver lo borrado? (nivel 1 o 2, o invitado con 1 o más)
create function private.has_plain_readers(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    where m.removed_at is null
      and private.user_page_level(p, m.user_id) >= 1
      and (private.user_page_level(p, m.user_id) < 3 or m.role = 'guest'));
$$;  -- (en la implementación: solo los user_id con grants sobre el proyecto o la rama, no todos los miembros)
revoke all on function private.has_plain_readers(uuid) from public, anon, authenticated;

-- 4. La cadena limpia.
create table public.page_clean (
  id             uuid primary key,                -- lo crea el dispositivo: reintentar no duplica
  page_id        uuid not null references public.pages (id) on delete cascade,
  kind           text not null check (kind in ('base', 'delta')),
  chain_id       uuid not null,                   -- el id de la base de la cadena
  from_seq       bigint not null check (from_seq >= 0),
  to_seq         bigint not null check (to_seq >= from_seq),
  last_update_id bigint not null,                 -- page_updates.id de la fila to_seq (copias restauradas)
  sv_after       bytea not null,                  -- vector de estado al final de la pieza
  ds_after       bytea not null,                  -- borrados al final (tramos, como encodeRanges de B.15)
  state          bytea not null check (octet_length(state) between 1 and 8388608),
  sha256         bytea not null,
  app_version    numeric(8, 3) not null,
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  invalid_at     timestamptz,
  invalid_reason text,
  check ((kind = 'base' and from_seq = 0 and chain_id = id) or (kind = 'delta' and to_seq > from_seq))
);
-- Una sola continuación válida por punto de la cadena.
create unique index page_clean_next on public.page_clean (chain_id, from_seq) where invalid_at is null and kind = 'delta';
create index page_clean_page on public.page_clean (page_id, kind, created_at desc);
alter table public.page_clean enable row level security;
revoke all on public.page_clean from anon, authenticated;   -- todo por funciones

alter table public.pages
  add column clean_seq      bigint not null default 0,  -- final de la cadena vigente ("al día" para quien no edita)
  add column clean_at       timestamptz,                -- cuándo se armó la última pieza (la cadencia de 2 minutos)
  add column clean_reset_at timestamptz;                -- compartir con alguien nuevo: las cadenas de antes no se sirven
alter table public.workspace_settings
  add column clean_min_version numeric(8, 3) check (clean_min_version >= 0);  -- null: apagado (todos bajan filas)

-- La cadena vigente: la última base válida posterior al reinicio, con sus deltas válidos en orden, cuya fila final
-- sigue teniendo su id. Vacía si no hay o si está apagado.
create function private.current_clean_chain(p uuid) returns setof public.page_clean
language sql stable security definer set search_path = '' as $$ ... $$;
revoke all on function private.current_clean_chain(uuid) from public, anon, authenticated;

-- 5. Bajar: misma firma de siempre. Quien ve lo borrado (o con el interruptor apagado), las filas como hoy.
create or replace function public.pull_page_updates(p_page_id uuid, p_after_seq bigint, p_limit int default 200)
returns table (seq bigint, update text)
language plpgsql stable security definer set search_path = '' as $$
declare on_ boolean := (select ws.clean_min_version is not null from public.workspace_settings ws limit 1);
begin
  if not private.can_view_page(p_page_id) then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  if not coalesce(on_, false) or private.sees_deleted(p_page_id) then
    return query select u.seq, translate(encode(u.update, 'base64'), E'\n', '') from public.page_updates u
      where u.page_id = p_page_id and u.seq > p_after_seq order by u.seq limit least(greatest(p_limit, 1), 1000);
    return;
  end if;
  -- Quien no ve lo borrado: piezas de la cadena vigente. Desde el final de una pieza, los deltas siguientes; si no,
  -- la base y todo lo que sigue. Sin cadena, nada (la página está en preparación).
  return query with c as (select * from private.current_clean_chain(p_page_id))
    select c.to_seq, translate(encode(c.state, 'base64'), E'\n', '') from c
    where (exists (select 1 from c x where x.to_seq = p_after_seq) and c.from_seq >= p_after_seq and c.kind = 'delta')
       or (not exists (select 1 from c x where x.to_seq = p_after_seq) and p_after_seq < (select max(to_seq) from c))
    order by c.to_seq limit least(greatest(p_limit, 1), 1000);
end; $$;

-- 6. Armar: qué páginas, subir una pieza, invalidar. Todas piden sees_deleted, el interruptor y la versión.
create function public.clean_work(p_app_version text)
  returns table (page_id uuid, chain_id uuid, to_seq bigint, sv_after text, ds_after text, needs_base boolean) ...;
create function public.push_clean_piece(p_id uuid, p_page_id uuid, p_kind text, p_chain_id uuid, p_from_seq bigint,
  p_to_seq bigint, p_last_update_id bigint, p_sv_before text, p_sv_after text, p_ds_after text, p_state text,
  p_sha256 text, p_app_version text) returns text ...;   -- 'ok' | 'clean_conflict'; pone clean_seq y clean_at;
                                                          -- limpia las cadenas no vigentes de más de un día
create function public.invalidate_clean_chain(p_page_id uuid, p_reason text) returns void ...;  -- clean_seq = 0
-- revoke de public y anon, grant execute a authenticated.

-- 7. Compartir con alguien que no ve lo borrado reinicia la cadena de lo alcanzado: share(), create_invitation()
--    (la página y su rama, o todas las páginas del proyecto) y pages_permissions() al mover una página.
--    update public.pages set clean_reset_at = now(), clean_seq = 0 where ...;

-- 8. El árbol trae clean_seq (grant select de la columna; la app la pide según schema_version).
grant select (clean_seq) on public.pages to authenticated;
update public.workspace_settings set schema_version = <la que siga> where id and schema_version < <la que siga>;
notify pgrst, 'reload schema';
```

## 8. Cambios en la app

| Archivo | Entrega | Qué cambia |
|---|---|---|
| `src/sync/docs.ts` (`readSaved`) | 1 | El documento de la subida con GC y `gcFilter` (4.1); la unión de los delete sets guardados, con caché por página |
| `src/sync/clean.ts` (nuevo) | 2 | Armar la base y el delta desde lo guardado, las tres comprobaciones, la comparación cada 10 deltas |
| `src/sync/remote.ts`, `types.ts` | 2 | `cleanWork`, `pushCleanPiece`, `invalidateCleanChain`; `PageRow.clean_seq?` pedida según `schema_version`, con reintento sin ella |
| `src/sync/engine.ts` | 2 | `serverSeqFor(row)` en todo lo que hoy compara con `update_seq`; al final del ciclo, armar piezas (sus errores no cortan el ciclo) |
| `src/media/offline.ts`, `src/search/projectIndex.ts`, `projectReplace.ts` | 2 | `serverSeqFor` |
| Ventana de compartir y la de invitar | 0 y 2 | La línea del aviso; armar las bases al compartir, con progreso |
| La página | 2 | El aviso "en preparación" |
| `src/sync/docs.ts` (rearmar lo guardado) | 3 | Al dejar de ver lo borrado, sin nada sin subir; borrar la caché del historial |
| `src/sync/testing.ts` | 2 | El servidor en memoria con la cadena, `sees_deleted` y el interruptor |
| Ayuda (`src/help/entries.ts`, `src/i18n/lazy/help.ts`) | 0 y 2 | *Who can see what was deleted* |
| `Doc_Sincronizacion.md`, `Doc_Historial.md`, `Doc_Compactar.md` (sección 10), `Doc_Supabase.md` | 1 y 2 | Lo que cambia, al implementar |

## 9. Plan de pruebas

1. **La subida (entrega 1), `src/sync/uploadNoGc.test.ts` y una nueva `uploadPrivacy.test.ts`,** con `PageDocs` y el
   servidor en memoria: un texto pegado y borrado antes de subir no está en ninguna fila; el caso de la auditoría de
   B.16 (escribir en un bloque que otro borra, bajar antes de subir) sigue llegando con su texto; lo propio borrado y
   después borrado de nuevo por otro (el caso que dejaba pasar la primera regla) no viaja; sin `syncedSV` utilizable,
   sin GC. **Mutantes:** un filtro que recolecta todo hace fallar la prueba del huérfano; uno que no recolecta nada, la
   del texto pegado. La corrida al azar con el editor real (`src/ui/collabRemovedWriting.test.ts`) cambia su invariante:
   todo lo propio que **otro** borró está en el servidor con su texto, y lo que el mismo dispositivo borró antes de
   subir no está. Las del historial (`history.test.ts`, "filas de los dos tipos") siguen pasando.
2. **La cadena (entrega 2), `src/sync/clean.test.ts`:** P4 pasado a vitest con `PageDocs`: lectores, invitado que
   edita, un lector que pasa a editor, un editor que pasa a invitado, sin red, piezas que no llegan, dos editores que
   arman a la vez (`clean_conflict`), una cadena invalidada, una copia restaurada, la versión publicada
   (`fixtures/publishedDocs.ts`) como editor. En cada paso: el invariante de tokens (lo recibido estuvo visible en un
   momento de armado posterior a compartir) y, al final, todos iguales al servidor. Mutantes: servir filas, armar sin
   GC, un delta que no encadena.
3. **Con el editor real** (`src/ui/cleanEditor.test.ts`, jsdom): una página con fotos en línea, foto-bloque con
   epígrafe, Script, preguntas, tablas, tarjeta de Drive y colapsar para todos; se pisan y borran cosas con un secreto
   en cada lugar; la base y los deltas no tienen ningún secreto en sus bytes, y la página que abre un lector es igual a
   la del editor (sin reparaciones de más).
4. **El dispositivo:** `serverSeqFor` (lector al día con `clean_seq`, "en preparación"), *Available offline* y el
   índice de búsqueda de un lector, el rearmado al pasar a lector (espera lo sin subir; conserva cursor, `syncedSV`,
   `syncedDS` y los avisos de B.16; ninguna fila guardada tiene texto borrado después).
5. **Permisos en SQL** (`supabase/tests/privacidad_borrado_permisos.sql`, en `begin … rollback` con un script propio,
   nunca `npm run db:test`): con el interruptor apagado, todos bajan filas como hoy; prendido, Ver, Comentar y un
   invitado con Editar reciben solo piezas (los bytes no coinciden con ninguna fila) o nada si no hay cadena; Editar,
   Editar y crear y el dueño, las filas; `select update from page_updates` da 42501 para todos; `push_clean_piece`
   rechazado a nivel 1 y 2, a invitados, con la fila final con otro `id`, `to_seq` mayor que `update_seq`, un delta
   que no encadena, otra huella o más de 8 MB; compartir reinicia (la cadena vieja no se sirve más); un proyecto borrado
   no sirve nada; `has_plain_readers` con permisos por proyecto, por página y revocados. **Mutantes de la migración:**
   sin la rama de lectores en `pull_page_updates`, con la columna `update` legible, `sees_deleted` sin el invitado.
   Las 16 pruebas de `supabase/tests/` siguen pasando con la migración puesta.
6. **Rendimiento:** P5 en el iPhone (armar base y delta de 2000 y 10 000 subidas) y la subida con el filtro en la
   sesión muy editada de B.16.
7. **De punta a punta** (Playwright contra la base, lista para Lega): un editor escribe un secreto y lo borra; comparte
   la página con Ver a una cuenta de prueba; esa cuenta abre la página, y su IndexedDB y sus respuestas de red no
   tienen el secreto; el editor escribe algo que queda y otra cosa que borra en 5 s; al lector le llega lo primero y no
   lo segundo.

## 10. Entregas y orden

0. **Ya (sin migración):** la línea en la ventana de compartir y la entrada de la ayuda que dicen lo que pasa hoy. Es
   lo único que se puede hacer sin código de sincronización, y es lo que pide D14 mientras tanto.
1. **Subida con GC selectivo** (app, sin migración; pruebas 1 y 6). Después de publicarla, subir `min_app_version` a
   esa versión.
2. **La cadena limpia** (migración + app; pruebas 2 a 5 y 7). Se publica con el interruptor apagado. Para prenderlo
   en Wanka: el cambio del script de restaurar (repo privado), `min_app_version` a la versión de esta entrega, copia de
   seguridad, y `clean_min_version`. Antes de invitar al primer cliente de verdad.
3. **Limpiar el dispositivo de quien deja de ver lo borrado** (app; prueba 4), y una vez en cada dispositivo de un
   lector al prender el interruptor. Con la caché del historial (P.18, entrega 3), borrarla en el mismo paso.
4. **Más adelante:** compactar reusa la validación de la cadena (5); el canal en vivo (D-04) solo para quien ve lo
   borrado.

Antes de cerrar cada entrega, la auditoría de siempre (funcionalidad, permisos y RLS, no perder datos, docs).

## 11. Riesgos

| Riesgo | Qué lo cubre |
|---|---|
| El GC selectivo descarta algo que no debía (un huérfano) | La regla usa lo que el dispositivo guardó, no suposiciones; sin `syncedSV` utilizable no filtra; la corrida al azar con el editor real y la mutante |
| Una pieza con texto borrado (un error, un `keep` de Yjs) | La comprobación de privacidad antes de subir y su mutante; la prueba con secretos en cada lugar |
| Una pieza a la que le falta algo: el lector ve la página incompleta | La comprobación de forma; la de contenido en la base y cada 10 deltas; invalidar reinicia; las filas siguen enteras (D4) |
| El lector espera a que un editor abra la app | La demora está acotada mientras alguien edita; "en preparación" lo dice; al compartir se arman las bases enseguida (pregunta 1) |
| Una versión vieja como lector, sin entender `clean_seq` | El interruptor solo con `min_app_version` en la versión nueva |
| Reiniciar al compartir obliga a todos los lectores de esa rama a bajar una base | Compartir es raro; una base es chica (la de 10 000 subidas, 571 KB) |
| `has_plain_readers` caro en cada ciclo | Se pide solo cuando el dispositivo subió o bajó algo, o cada 2 minutos; limitado a los usuarios con permisos sobre esa rama |
| Restaurar una copia revive piezas invalidadas | El script vacía `page_clean` (requisito para prender) y la vigencia mira el `id` de la fila final |
| El rearmado del dispositivo pierde algo sin subir | Solo sin nada sin subir; mismo vector y mismos borrados; prueba 4 |
| Un editor malintencionado | Mismo poder que editando; lo invalida la comparación de cualquier otro editor |

## 12. Decisiones que tomé (con la regla de no perder datos)

- **Quién recibe lo borrado: el mismo criterio que el historial (D13).** Si Lega abre el historial a quien comenta o a
  los invitados, esta regla cambia con él (es una sola función).
- **Lo tecleado y borrado antes de subir no sube más (entrega 1).** No es un dato vigente de nadie: lo borró la misma
  persona, antes de que nadie lo viera; el historial nunca lo mostraba, y antes de v0.095 tampoco subía. Lo que pidió
  D15 (lo propio adentro de algo que otro borró) sigue llegando. Si Lega quisiera conservarlo, se vuelve al armado sin
  GC (una línea) y la privacidad depende solo de la cadena limpia.
- **Al compartir, la cadena arranca de cero** para lo alcanzado: es lo que protege el ejemplo de la nota interna.
- **Sin cadena, el lector no ve nada** ("en preparación") en vez de recibir las filas: lo otro sería volver a lo de hoy
  justo en el caso que importa.
- **Al dejar de ver lo borrado, el dispositivo rearma lo suyo** sin esperar a nadie (cuando no tiene nada sin subir).

## 13. Preguntas para Lega

1. **¿Aceptás que quien solo ve o comenta (y los invitados) reciba los cambios con demora, en vez de letra por
   letra?** Ejemplo: en el set escribís en el reporte «el actor llegó tarde por X» y a los 30 segundos lo borrás. Con
   la recomendación, el cliente que tiene la página abierta **nunca recibe esa frase**; lo que sí queda le aparece unos
   20 segundos después de que dejás de escribir (o cada 2 minutos si seguís escribiendo), y si cerrás la app enseguida,
   cuando vos u otro editor la vuelvan a abrir. La alternativa es mandarle las ediciones al momento: lo vería casi en
   vivo, pero recibiría también lo escrito y borrado desde la última pieza (si cerrás la app al toque, toda tu última
   sesión). **Recomendación: aceptar la demora.**

## Cómo se midió

Prototipos en Node 20 con Yjs 13.6.33 (el de la app), fuera del repo, en la carpeta de trabajo de la sesión
(`privacidad/`, con sus resultados en `res_*.txt`). No se imprimió ni se guardó en el repo contenido de la base.

- **P1, filas reales:** `ro.mjs` (cliente de la Management API en modo solo lectura, `readOnlySql`) bajó las filas de
  las 15 páginas con más filas; `p1_real.mjs` y `p1b.mjs` cuentan lo borrado legible por tipo y por nombre de
  atributo, y arman el snapshot completo y el limpio (lo visible sale igual en las 15; borrado legible en el limpio:
  0). La base también dio: 826 filas en 720 páginas, un solo miembro (el dueño), un permiso.
- **P2, el GC con la forma de BlockNote:** `p2_gc.mjs`, un secreto en cada lugar donde algo se borra o se pisa.
- **P3, la subida:** `sim.mjs` (dispositivos con el patrón de la app: el documento abierto con GC, cada edición
  guardada, la subida armada desde lo guardado en orden y en una transacción, `buildUpload` de B.15 portado a JS en
  `ds.mjs`, `syncedSV` y `syncedDS`) y `p3_subida.mjs`, 500 corridas de 150 pasos con tokens únicos para saber qué
  viajó. **Límite:** sin el editor real ni y-prosemirror (párrafos con texto plano); la prueba 1 lo hace con el editor.
- **P4, la cadena:** `p4_lector.mjs` sobre la misma simulación, 300 corridas de 200 pasos, con las mutantes
  `MUT=raw` y `MUT=nogc` y los editores subiendo sin GC (`MODE=nogc`). **Límite:** las piezas las arma el servidor de la
  simulación con las filas (en la app las arma un editor desde lo suyo, que al día es lo mismo); no modela tiempos, así
  que la demora de 20 s y 2 min es un parámetro, no una medición.
- **P5 y P6, costos:** `p5_costo.mjs` (un editor, 2000 y 10 000 subidas, deltas de a 20) y `p6_filtro.mjs` (2000 y
  17 000 filas guardadas). Tiempos de una PC.
- **Lo que no se midió:** el iPhone; el editor real (BlockNote en jsdom) sobre la cadena; la migración contra la base
  (está en borrador, no se corrió ni en `begin … rollback`); `has_plain_readers` con muchos miembros.
