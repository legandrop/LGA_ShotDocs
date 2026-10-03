# Historial de versiones de una página (P.18)

**Estado: entregas 1 (v0.098), 2 (v0.103) y 3 (v0.106) implementadas, más los restos de las auditorías ("Lo que
quedó de las entregas"); ver "Cómo quedó" de cada una, al final, que mandan sobre el diseño en lo que tocan. La migración de la entrega 1 (`20261007120000_historial.sql`) está aplicada
desde v0.098; la de la entrega 3 (`20261011120000_versiones_con_nombre.sql`), probada en `begin … rollback` contra la
base, SIN aplicar.** Pedido de Lega del 2026-10-01 (en el plan figuraba como fase 6). Toca la regla de no perder datos
(restaurar es una edición) y los permisos (el historial muestra lo borrado), así que cada entrega va con sus pruebas y
su auditoría. **Diseño auditado:** lo que encontró la auditoría independiente del diseño está corregido en el texto
("Correcciones de la auditoría"). Las cuatro preguntas, **decididas el 2026-10-01** con la recomendación (sección 15).

## En corto

- **Qué pide Lega:** como en Google Docs. Desde la página, ver quién la cambió y cuándo, ver cada versión con lo
  agregado y lo borrado marcado con el color de cada persona, y volver a una versión anterior.
- **No hace falta guardar nada nuevo para armar las versiones.** `page_updates` ya es solo agregado y cada fila
  tiene su autor (`created_by`, lo pone la base con `auth.uid()`: el dispositivo no lo puede elegir) y su hora
  (`created_at`). Aplicando las filas **en orden** en un `Y.Doc({ gc: false })` sale el documento en cualquier
  punto; el vector y los borrados de cada fila dan un `Y.snapshot` por versión sin integrar nada. Medido con las
  filas reales: las 63 versiones de la página más editada, iguales a aplicar las filas hasta ahí.
- **Una trampa medida:** armar el documento con `Y.mergeUpdates` de las filas (como el snapshot del diseño de
  compactar) **pierde texto borrado**: 26 de las 63 versiones de esa página salen distintas. Algunas filas viejas
  vuelven a subir el documento entero desde un dispositivo con GC, con lo borrado ya recolectado, y `mergeUpdates`
  se queda con esa copia. Aplicando en orden, gana la primera, que tiene el texto. Por eso el historial se arma
  siempre aplicando filas en orden (sección 3.2), y el diseño de compactar tiene que cambiar si sus snapshots van a
  servir de punto de partida (sección 12).
- **Quién hizo cada cambio:** el autor de cada letra es el de la primera fila que la trae; el de cada borrado, el
  de la primera fila que lo trae. Sale de las filas, con el autor que puso la base. No se usa `PermanentUserData`
  de Yjs (lo escribe el dispositivo, adentro del documento, y las versiones viejas no lo escriben).
- **Restaurar es una edición nueva por el editor** (la misma vía que escribir): deja la página como estaba en esa
  versión, no borra historia, se deshace con Ctrl/⌘+Z y queda como una versión más. Prototipo con el editor real:
  conserva los ids de los bloques (los comentarios vuelven a su lugar), no toca lo que no cambió, se deshace y
  rehace, la versión publicada abre el resultado igual, y 400 bloques se restauran en unos 20 ms.
- **Lo que hay que cuidar al restaurar:** solo con red y con la página sincronizada (si no, lo propio sin subir se
  revertiría antes de llegar al servidor y no quedaría en ninguna versión), y lo que otro escribe a la vez en un
  bloque que la restauración quita: sale de la página **y no aparece en ninguna versión** (medido). Peor: si el
  dispositivo del otro baja el borrado antes de subir lo suyo, **hoy ese texto no llega nunca al servidor** (la
  subida se arma con GC); queda solo en su dispositivo. Hace falta un cambio chico en la subida (armarla sin GC,
  sección 5.4) para que el historial lo pueda mostrar ("texto huérfano"), y un aviso en el dispositivo del otro.
- **Permisos:** propuesto, quien puede editar la página (nivel 3 o más). Para que sea de verdad, la migración saca
  la lectura directa de la tabla `page_updates` (hoy cualquiera que ve la página puede leer autor y hora de cada
  fila). Ojo: lo borrado **ya** llega hoy a cualquiera que ve la página, invitados incluidos, porque viaja en las
  filas que baja para sincronizar (sección 7).
- **Rendimiento:** con 10 000 subidas (después de B.15, 900 KB de filas) armar todo lleva unos 270 ms en una PC y
  abrir una versión 31 ms; la diferencia por persona de una sesión larga, 0,3 a 1,2 s. En el teléfono, estimado
  de 3 a 5 veces más. Se calcula en el dispositivo, en un Worker, con caché.
- **Primera entrega (chica y útil):** la lista de versiones con quién y cuándo, ver una versión tal como era y
  restaurarla. Las marcas de colores, nombrar versiones y el historial sin red, después.

## Reglas que no se rompen

1. **El historial nunca escribe ni borra filas.** Lee `page_updates` como está; restaurar es una edición más que
   sube por `push_page_update`.
2. **Restaurar nunca pierde nada.** Lo que había antes de restaurar es una versión del historial y se puede volver
   a ella; restaurar no corre con cambios propios sin subir; lo que otro escribe a la vez en lo que la restauración
   quita no desaparece en silencio: se le avisa a quien lo escribió (que todavía lo tiene en su dispositivo) y queda
   en el historial como texto huérfano (con el cambio en la subida de 5.4).
3. **Nada de tipos de bloque ni marcas nuevas.** Las marcas de colores son decoraciones de un visor de solo
   lectura; restaurar escribe por el editor de la app, con su esquema.
4. **El historial no muestra nada que la persona no pueda ver hoy:** solo la página donde está y sus fotos según
   los permisos de hoy. (Un link interno es texto con una dirección, como en la página: abrirlo pasa por los
   permisos de siempre.)
5. **Las versiones viejas de la app siguen andando** sin saber nada del historial.

## 1. Lo que ve la persona

### 1.1 Dónde se abre

- **Computadora:** en el menú de la página (⋯ de la barra de arriba), **Version history**, debajo de *Export PDF /
  Print*; atajo **Ctrl+Alt+Shift+H** (⌘⌥⇧H en la Mac, nunca Ctrl), el mismo de Google Docs, a confirmar contra el
  registro de atajos (`src/ui/shortcuts.ts`). La página pasa a **modo historial**: el contenido muestra la versión
  elegida, de solo lectura, y a la derecha (donde va el panel de comentarios, que se cierra) la lista de
  versiones. Arriba, una barra: la fecha de la versión, **Restore this version**, **Show changes** (casilla) y
  **Back to the page** (también Escape).
- **Teléfono:** el mismo ítem del menú abre una pantalla entera con la lista. Tocar una versión la abre a pantalla
  entera, con la barra de arriba: volver, la fecha, **Restore** y ⋯ (*Name this version*, *Show changes*). Las
  flechas de la barra (o deslizar) pasan a la versión anterior y la siguiente.
- Solo aparece si la persona puede editar la página (sección 7) y la base tiene la migración (sección 9); si no,
  no está el ítem.

### 1.2 La lista de versiones

- **Agrupada por día** (*Today*, *Yesterday*, el día de la semana en los últimos 7, después la fecha) y, adentro,
  **por sesión de edición**: subidas seguidas con menos de **30 minutos** entre una y otra. En la página más
  editada de la base (63 subidas en dos días) eso da 8 sesiones; con 5 minutos, 11; con 60, 7.
- Cada renglón: la hora en **hora local** del dispositivo (`Intl.DateTimeFormat`, 24 h o 12 h según el idioma),
  los nombres de quienes **cambiaron algo visible** en esa sesión con un punto de su color (el correo, como en los
  comentarios, y *You* para uno mismo), y el nombre de la versión si tiene (entrega 3). La primera es *Current
  version*. Una fila que vuelve a subir el documento entero (una versión vieja de la app, o todos los dispositivos
  después de restaurar una copia de seguridad) no agrega a nadie: sus tramos ya tenían dueño (4.2).
- **Una sesión sin cambios visibles** (solo subidas enteras repetidas, o solo el mapa de colapsar) no arma un
  renglón propio: se junta con la anterior. En la página de 63 filas, 1 de los 7 cortes de sesión deja la página
  igual a la anterior.
- Una sesión larga se despliega en sus partes (cortes de 2 minutos), como "expandir" en Google Docs.
- Arriba de todo, si el dispositivo tiene cambios de esta página sin subir: *Changes on this device not synced
  yet* (no se puede restaurar a ella ni desde ella; ver 3.2).
- Un filtro *Only named versions* (entrega 3).
- **La hora es la de llegada al servidor**, no la de la edición: lo escrito sin red figura a la hora en que subió.
  Se dice en la ayuda. Guardar la hora del dispositivo queda para más adelante (sección 13).

### 1.3 Ver una versión

- La página como era al final de esa sesión, con el editor de la app en solo lectura (mismo esquema, mismas
  fotos, mismo Script, preguntas y tarjetas de Drive), sin la barra de formato ni el menú del bloque.
- **Show changes** (prendido por defecto, entrega 2): contra la versión anterior de la lista,
  - lo agregado, subrayado con un fondo suave del color de quien lo escribió;
  - lo borrado, tachado en el color de quien lo borró, en el lugar donde estaba;
  - un bloque agregado o borrado entero, con una barra de su color a la izquierda (y el borrado, atenuado);
  - un bloque que cambió de tipo o de propiedades (párrafo a título, Script, color): un rótulo chico en el margen,
    *Changed to Heading 2*, en vez de mostrarlo borrado y agregado (sección 5.3);
  - al pasar el mouse (o tocar) sobre una marca: quién y cuándo (*Ana · 14:05*), con `data-tip`.
- Con **Show changes** apagado se ve la versión limpia, igual que se veía.
- **Colores:** una paleta de 8 colores que se leen en el tema claro y en el oscuro, asignados por orden de
  aparición en el historial de la página (la primera persona que editó, el primero): estable en esa página y sin
  repetidos hasta 8 personas. Las marcas no usan solo el color: subrayado y tachado se distinguen sin él.
- **Hojas (A4…):** la vista usa el formato de hoja de hoy (el formato vive en `pages.settings`, no tiene
  historial). Con los cambios apagados, la hoja y las marcas de corte como en la página. Con los cambios
  prendidos, la hoja sin las marcas de corte: lo borrado ocupa lugar y cortaría en otro lado.
- **Fotos en línea y foto-bloque:** con la miniatura de siempre (`MediaQueue.resolve`); una foto agregada, con un
  contorno de su color; una borrada, atenuada y tachada; una que hoy está en la papelera de Drive, como hoy en la
  página (*File deleted (in the Drive trash)*).
- **Secciones colapsadas:** en el historial todo se ve abierto (el colapsar es una vista, no contenido). Un cambio
  que solo colapsó o abrió secciones para todos (el `Y.Map` `collapsedHeadings`) no arma una versión propia en la
  lista: se suma a la sesión en que cayó.
- **Comentarios:** no tienen historial (viven en su tabla, no en el documento): en modo historial el panel y las
  marcas del margen no se muestran.
- **Copiar un pedazo:** seleccionar en la versión y Ctrl/⌘+C copia como en la página (con formato y fotos); en el
  margen de cada bloque, **Copy block**. Se pega en la página de siempre: las fotos `sdmedia://` vuelven a contar
  como usadas (`link_page_file`); una que estaba en la papelera de archivos sale sola de ella.

### 1.4 Restaurar

- **Restore this version** pide confirmación: *The page will look like this version. Nothing is lost: the current
  version stays in the history and you can undo.* Si la versión tiene fotos mandadas a la papelera de Drive
  (`purged_at`, pedido aunque Drive todavía no lo confirme, o `drive_trashed_at`), la confirmación las cuenta: *2
  photos in this version were deleted from Google Drive; they will show as deleted until the owner restores them
  from the Drive trash (30 days).*
- Después: se cierra el modo historial, la página queda como la versión y aparece un aviso con **Undo** (además
  de Ctrl/⌘+Z). El **Undo** del aviso deshace **la restauración** y nada más: desaparece con la próxima edición
  (si no, desharía lo último que se escribió). La lista suma *Restored from Sep 30, 14:05* (entrega 3; en la 1, la
  versión nueva sin rótulo).
- **Botón apagado, con el motivo** (`data-tip`), si: no hay red; la página tiene cambios sin subir (*Sync this
  page first*: un toque sincroniza y lo vuelve a habilitar); falta bajar algo de la página (está "a medio bajar");
  la versión tiene algo que esta versión de la app no conoce, o no pasa la comprobación de ida y vuelta (6.1); la
  app está por debajo de la versión mínima; la persona no puede editar; o la restauración sería demasiado grande
  (más de 4 MB, la mitad del tope de 8 MB de una subida: *This version is too large to restore in one step*; la
  fila más grande de hoy pesa 7 KB y la más pesada de la base, una tabla importada, 2 MB). Los permisos se vuelven
  a pedir a la base justo antes de restaurar (pueden haber cambiado con el historial abierto): una restauración
  que el servidor rechaza deja la página "rechazada" en el dispositivo.

### 1.5 Ayuda, atajos y tutorial

En la misma tanda que cada entrega (regla de P.13): la entrada en la ayuda (dónde se abre, qué muestra, que la hora
es la de subida, qué hace restaurar, que se deshace), el atajo en `src/ui/shortcuts.ts` y, si el tutorial muestra
el menú de la página, su paso. Textos en inglés con su traducción en `src/i18n/`.

## 2. Qué hay hoy en la base (medido el 2026-10-01, solo lectura)

| Qué | Valor |
|---|---|
| Filas en `page_updates` | 826, en 720 páginas |
| Bytes de los updates | 18,99 MB; la tabla ocupa 7,06 MB (Postgres comprime) |
| Filas sin autor (`created_by` nulo) | **0** |
| Personas distintas que subieron algo | 2; ninguna página tiene más de una |
| Páginas con 1 a 9 filas | 718; una con 17 (fotos, sin texto) y una con 63 (37,7 KB, del 29-09 al 30-09) |
| Filas que vuelven a subir a un autor de Yjs desde el reloj 0 (en la de 63) | 4: subidas viejas del documento entero |

- **Cada fila ya tiene lo necesario:** `created_by uuid default auth.uid()` y `created_at default now()`.
  `push_page_update` (security definer) no recibe el autor: el `insert` no lo nombra y lo pone la base con la sesión
  de quien llama. La API no deja insertar en la tabla (sin `grant insert`). Así que el autor **no lo puede
  falsear el dispositivo**, y lo viejo ya lo tiene: no hace falta columna nueva ni rellenar nada.
- `created_by` es `on delete set null`: si se borra la cuenta de alguien, sus cambios quedan como *Former member*.
- `created_at` es la hora del pedido de subida (sección 1.2).
- La política `page_updates_select` deja leer las filas a quien ve la página (nivel 1), y `pull_page_updates` las
  sirve a ese mismo nivel, con lo borrado adentro (sección 7).

## 3. Cómo se arma

### 3.1 Las piezas

| Pieza | Qué es | De dónde sale |
|---|---|---|
| **El documento del historial** | Un `Y.Doc({ gc: false })` con todas las filas aplicadas de a una, en orden de `seq` | `page_history` (sección 9) |
| **Metadatos por fila** | Hasta qué reloj llega cada autor de Yjs (`Y.parseUpdateMeta`) y qué borra (`Y.decodeUpdate(u).ds`) | Las mismas filas, sin integrarlas |
| **Una versión** | `Y.snapshot` = (vector, borrados) acumulados hasta la última fila de la sesión | Los metadatos |
| **El contenido de una versión** | `Y.createDocFromSnapshot(docHistorial, snapshot)` | Las dos de arriba |
| **Los autores** | Para cada tramo de relojes, la primera fila que lo trae y su `created_by` | Los metadatos y las filas |

**¿Hace falta guardar snapshots con nombre?** No. Con `page_updates` entera, cualquier versión se reconstruye
desde las filas. Guardar `Y.snapshot` en la base no ahorra nada (se calcula en milisegundos de las filas) y una
"versión con nombre" es solo un nombre apuntando a un `seq` (sección 9, `page_versions`, sin contenido). El plan
viejo tenía `page_versions.state BYTEA`: no hace falta.

### 3.2 GC: dónde está prendido y por qué no importa (salvo en un caso)

- **La app crea sus `Y.Doc` con GC prendido** (`new Y.Doc()` en `docs.ts`, el valor por defecto): al borrar, Yjs
  cambia el contenido por un hueco. La subida no sale del documento abierto: `readSaved` arma un `Y.Doc` nuevo, con
  GC, con `mergeUpdates` de todo lo guardado en el dispositivo (lo propio y lo bajado), y sube
  `encodeStateAsUpdate` contra `syncedSV` (con los borrados de B.15). Lleva lo nuevo, con el texto que todavía no
  está borrado **en ese momento en el dispositivo**.
- **Por eso cada fila tiene el texto que existía al subirla.** Lo escrito y borrado entre dos subidas (1,2 s de
  pausa) nunca llega al servidor: el historial tiene la resolución de las subidas, como Google Docs tiene la suya.
  La excepción importante es lo que el propio dispositivo escribió y **otro borró** antes de que se subiera
  (sección 5.4).
- **No hay que apagar el GC de la app**: el historial arma su propio documento sin GC desde las filas.
- **El caso que importa: las filas que vuelven a subir todo.** Una versión vieja de la app (y cualquier dispositivo
  después de restaurar una copia de seguridad, `resetForRestore`) sube el documento entero, armado con GC: lo que
  ya se había borrado viaja como hueco. Aplicando en orden no molesta (Yjs saltea lo que ya tiene, y la primera
  fila trajo el texto). **Con `Y.mergeUpdates` sí:** la mezcla se queda con el hueco. Medido en la página de 63
  filas:

| Cómo se arma el documento completo | Versiones iguales a aplicar las filas hasta ahí | Bloques (`ContentType`) / huecos (`GC`) |
|---|---|---|
| Aplicando las filas de a una, en orden | **63 de 63** | 110 / 14 |
| `Y.mergeUpdates` de todas | **37 de 63** | 95 / 86 |
| `mergeUpdates` incremental de a 10 (como compactar) | (igual de mal) | 98 / 89 |

  El documento de hoy sale igual por los tres caminos; lo que se pierde son versiones del medio. En la simulación
  (filas sin subidas enteras) `mergeUpdates` no falla: el problema aparece solo con las filas reales.

- **Lo propio sin subir, al restaurar:** si la persona escribió algo que todavía no subió y restaura, el editor lo
  borra antes de subirlo y, con GC, sube como hueco: **no quedaría en ninguna versión**. Por eso restaurar exige la
  página sincronizada (1.4 y 6.1).

### 3.3 Una versión sin integrar todo de nuevo

Aplicar las filas y sacar `Y.snapshot` después de cada una cuesta lo mismo que armar el documento, pero guardar un
snapshot por fila no: con 10 000 filas fueron 622 ms y 304 MB de memoria. En cambio:

1. Los metadatos de cada fila (`parseUpdateMeta` + el delete set), sin integrar: 43 ms para 10 000 filas.
2. El snapshot **solo al final de cada sesión**: el vector es el máximo acumulado por autor y los borrados la unión
   acumulada (`Y.mergeDeleteSets`). 23 ms para las 167 sesiones de 10 000 filas.
3. El documento del historial, aplicando todas las filas una vez: 180 ms.
4. Abrir una versión: `Y.createDocFromSnapshot` (31 ms con 10 000 filas; 0,7 ms en la página real).

Comprobado: el snapshot armado con los metadatos da el mismo contenido que `Y.snapshot` aplicando de a una en las 63
versiones de la página real (en la de 17 filas, un snapshot no es idéntico a `Y.snapshot`, con el mismo contenido) y en las
muestras de la simulación.

**Lo pendiente:** si una fila depende de algo que no llegó (raro en el servidor, ver `Doc_Compactar.md` 4.4), el
vector armado con metadatos la cuenta antes de que se integre. En esa versión se vería un poco antes; nunca se
pierde nada. Se compara en las pruebas.

### 3.4 Sesiones

Se ordenan las filas por `seq` y se corta donde hay más de 30 minutos entre una y la siguiente. Una sesión puede
tener varias personas (dos editando a la vez): se listan todas. La versión de la sesión es el estado después de
su última fila.

## 4. Quién hizo cada cambio

### 4.1 Las dos opciones

| | **Desde las filas** (elegida) | `PermanentUserData` de Yjs |
|---|---|---|
| Quién dice el autor | La base (`created_by` = `auth.uid()`) | El dispositivo, escribiendo su nombre en un `Y.Map` adentro del documento |
| Se puede falsear | No | Sí: cualquiera que edita escribe lo que quiera |
| Lo viejo | Ya tiene autor (0 filas sin autor) | Las 826 filas de hoy no lo tienen; las versiones viejas de la app nunca lo escriben |
| Peso | Nada nuevo | Una entrada por cada apertura de página (cada una es un autor de Yjs nuevo), más los borrados de cada uno, para siempre en el documento |
| Cambia el documento | No | Sí: un tipo raíz nuevo que viaja en cada subida |

### 4.2 Cómo se calcula

- **Lo agregado:** cada fila trae tramos de relojes `[desde, hasta)` por autor de Yjs. Se recorren las filas en
  orden y cada tramo que todavía no tiene dueño queda con la fila que lo trajo; una letra es de quien subió la
  primera fila que la trae. Las subidas enteras de después no cambian nada (sus tramos ya tienen dueño).
- **Lo borrado:** igual con los tramos del delete set de cada fila: el borrado es de quien subió la primera fila
  que lo trae. Las filas viejas (antes de B.15) repiten todos los borrados, pero la primera manda.
- **La semilla** (la raíz inicial y, desde v0.052, su texto vacío, con **dos** autores de Yjs fijos que salen del
  id de la página, `seedClientId` y `seedTextClientId`, iguales en todos los dispositivos): la sube quien hizo la
  primera edición, y figura como suya; no se marca (es estructura vacía).
- En la página real: 1864 letras visibles, todas con autor. En la simulación con dos personas: todas con autor.
- **Lo que no cubre:** si una copia de seguridad se restaura y un dispositivo sube de nuevo el documento entero
  antes que el autor original, lo que se perdió con la restauración queda a nombre de quien lo volvió a subir. Es
  raro y no cambia el contenido.
- **Dos personas con el mismo autor de Yjs** no existen, salvo la semilla (arriba): cada autor de Yjs es una
  apertura de página de un dispositivo con una sesión (más la probabilidad de 2^-32 de repetir uno al azar, la
  misma que ya acepta la sincronización).

## 5. La diferencia entre dos versiones

### 5.1 Las opciones

- **Yjs puro** (`XmlText.toDelta(snapshot, prevSnapshot, computeYChange)`): devuelve el texto de las dos versiones
  juntas, con cada tramo marcado como agregado o borrado y el id de Yjs del que sale el autor. Exacto letra por
  letra, y respeta lo que pasó de verdad (no adivina).
- **Comparar bloques por id** (el `id` de cada bloque de BlockNote) y, adentro, el texto con un algoritmo de
  diferencias: ve un cambio de tipo como un cambio, pero adivina dentro del texto y no sabe quién.
- **Elegida: Yjs, y los bloques por id para lo que y-prosemirror rehace.** y-prosemirror hace algunos cambios
  borrando el bloque y creándolo de nuevo con el mismo id (cambiar el tipo, sangrar, mover, unir;
  `Doc_Colaboracion.md`): con Yjs puro, cambiar un párrafo a título se vería como todo el texto borrado y vuelto a
  escribir. Así que primero se aparean, en el rango de la versión, los bloques borrados y agregados con el mismo
  id; esos se muestran como **un bloque que cambió** (el rótulo del tipo o la propiedad) y su texto se compara
  letra por letra (diferencia de texto), atribuido a quien rehízo el bloque. Todo lo demás, con Yjs.

### 5.2 Cómo se muestra sin tocar el esquema

y-prosemirror sabe dibujar una diferencia de snapshots, pero necesita una marca `ychange` en el esquema, y la regla
es no sumar marcas. En su lugar:

1. Se arma la **unión** de las dos versiones: los bloques visibles en alguna de las dos, en orden de documento
   (`Y.typeListToArraySnapshot` con cada snapshot, recorriendo la lista enlazada), y el texto de cada uno con
   `toDelta` (que incluye lo borrado).
2. Se convierte a bloques de BlockNote (lo borrado como texto común) y se anotan aparte los tramos: bloque, desde,
   hasta, agregado o borrado, persona.
3. Se muestra en un **editor de solo lectura sin Yjs** (no está ligado a ningún documento: no puede escribir nada),
   con un plugin de decoraciones de ProseMirror que pinta los tramos, como ya hacen las filas de fotos y las marcas
   de hoja.

El documento del historial nunca se monta en el editor de la página ni se sube.

### 5.3 Medido

| | Página real (63 filas) | Simulación, 2000 subidas | Simulación, 10 000 subidas |
|---|---|---|---|
| Filas | 37,7 KB | 175 KB | 901 KB |
| Metadatos + snapshots por sesión + documento + autores | 15 ms | 70 ms | 270 ms |
| Abrir una versión | 0,7 a 2 ms | 4,6 ms | 31 ms |
| Diferencia por persona, todo el documento | 0,5 ms | 38 ms | 1,16 s |
| Diferencia solo de lo que cambió | 0,3 ms | 22 ms | 0,30 s |

- La simulación: dos personas con el patrón de subida de la app después de B.15 (una subida por pausa, solo lo
  nuevo, un autor de Yjs nuevo cada 60 subidas, a veces las dos a la vez, cambios de tipo como los hace
  y-prosemirror), con pausas de una hora entre sesiones y el corte de 30 minutos. Los tiempos son de una PC con Node 20.
- "Solo lo que cambió": se buscan los items creados o borrados entre los dos snapshots y se diferencian solo esos
  bloques. En el prototipo da las mismas cuentas que la diferencia completa en 16 de 21 versiones; en las otras, 1
  a 5 letras borradas de diferencia (bloques borrados con su texto adentro). Se ajusta en la implementación con una
  prueba que lo compara contra el cálculo completo; mientras no dé igual, va el completo.

### 5.4 Texto huérfano: lo que otro escribió en algo que ya estaba borrado

Si A borra un bloque (o restaura una versión que no lo tiene) y B, sin verlo, escribe en ese bloque, lo de B llega
a un bloque borrado: Yjs lo integra ya borrado. **No se ve en la página ni en ninguna versión** (medido en el
prototipo: el item de B queda borrado, con el padre borrado). Es el mismo caso de la tabla de `Doc_Colaboracion.md`
("A borra, B escribe a la vez"), y deshacer una restauración mientras B escribe en lo que la restauración había
traído lo repite.

**¿Llega el texto de B al servidor? Hoy, no siempre** (lo encontró la auditoría y se comprobó con Yjs):

- Si B sube antes de bajar el borrado de A, su fila trae el texto.
- Si B baja el borrado antes de subir (en un mismo ciclo se sube y después se baja, así que pasa con lo escrito
  entre la subida y la bajada; y con todo lo de B si su subida vence y la bajada no, o si su app está por debajo de
  la versión mínima), `readSaved` arma la subida en un documento **con GC**: el texto de B ya está borrado ahí y
  viaja como hueco. **El texto queda solo en el IndexedDB de B** (lo guardado es el update de cada edición, con el
  texto), nunca en el servidor.

Por eso hacen falta dos cosas, las dos en la entrega 2:

1. **Un cambio en la subida** (ítem aparte del roadmap, con sus pruebas de sincronización): que `readSaved` arme
   el documento de la subida con `new Y.Doc({ gc: false })`. Es un documento descartable: el abierto y lo guardado
   no cambian. Así la primera subida de cada elemento lleva su texto aunque ya esté borrado. Costo: filas un poco
   más grandes, y lo escrito y borrado entre dos subidas también llega al servidor (agranda un poco lo de la
   sección 7). Se mide antes de decidir (pregunta 3); si no se hace, el historial dice que el texto huérfano se
   recupera solo a veces.
2. **El aviso en el dispositivo de quien escribió**, que es el único que siempre lo tiene: cuando un cambio que
   llega de otro borra (o borra el bloque de) algo que este dispositivo escribió en los últimos 10 minutos, aparece
   en la página *Some of what you wrote was removed by Ana* con **Show** y **Copy**: el texto sale de lo guardado
   en el dispositivo (los updates de cada edición, leídos en un documento sin GC). Vale también si el otro deshizo
   una restauración. Sin red el aviso aparece igual (el borrado ya llegó).

Con el cambio en la subida, el historial lo detecta (un item cuya fila es posterior al borrado de su bloque) y lo
muestra en la versión donde llegó, en una franja aparte: *Ana wrote in a part that had been removed* con el texto
y **Copy**.

## 6. Restaurar sin perder datos

### 6.1 Cómo

1. **Antes:** con red, se sincroniza la página (subir lo pendiente y bajar lo nuevo). Si queda algo sin subir o
   sin bajar, no se restaura (1.4). Se vuelve a armar la versión con lo último del servidor.
2. **Se arma la versión en memoria:** `createDocFromSnapshot`, después la reparación de estructura **solo en
   memoria** (`normalizeStructure(…, 'repair')`, para una versión de antes de la semilla con dos raíces) y la guarda
   contra lo desconocido (`findUnknownContent`): si la versión trae algo que este esquema no conoce, no se ofrece
   restaurar. Lo mismo para **ver** una versión, no solo para restaurar.
   **Comprobación de ida y vuelta:** y-prosemirror, cuando no puede armar un bloque, lo borra de su documento y
   sigue (`createNodeFromYElement` devuelve `null`): la reparación arregla los casos conocidos, pero uno desconocido
   desaparecería de la vista y de lo restaurado sin aviso. Por eso se comparan los ids de bloque y la cantidad de
   texto de la versión (en Yjs) con los del nodo de ProseMirror armado. Si no coinciden, la vista avisa *Part of
   this version can't be shown* y **Restore** queda apagado.
3. **Se escribe por el editor:** `yXmlFragmentToProseMirrorRootNode` con el esquema del editor y **una sola
   transacción** de ProseMirror que reemplaza el contenido de la página
   (`tr.replaceWith(0, doc.content.size, version.content)`), con `stopCapturing()` del `UndoManager` antes y
   después. y-prosemirror (con sus parches, también el de los huecos de las fotos en línea) la pasa a Yjs como
   pasa cualquier edición: compara con lo que hay y cambia lo necesario. Se guarda en el dispositivo y sube como
   una edición más.
4. **Lo que no se toca:** el `Y.Map` de colapsar para todos (es una vista; un título que vuelve recupera su estado
   si su id sigue ahí), el título de la página, el ícono y el formato (no viven en el documento).

**Por qué por el editor y no escribiendo Yjs directo:** es la misma vía que escribir, así que lo que guarda es lo
que el editor y sus parches esperan (las versiones viejas lo abren igual), entra en el deshacer del editor, y lo que
no cambió no se toca. Escribir Yjs a mano copiaría estructuras viejas tal cual (por ejemplo, huecos de fotos en
línea de antes de los huecos estables) y no se desharía con Ctrl+Z.

### 6.2 Medido con el editor real (prototipo en jsdom, esquema de la app)

| Caso | Resultado |
|---|---|
| Escribir, borrar un bloque, cambiar un tipo y agregar uno; restaurar la versión de antes | El texto y los **ids de los bloques**, iguales a la versión; el bloque que no cambió sigue siendo **el mismo item de Yjs** |
| Ctrl/⌘+Z después de restaurar | Vuelve a como estaba antes, en un paso; Ctrl/⌘+Shift+Z la vuelve a restaurar |
| La versión publicada (`fixtures/editorSchemaMain.ts`) abre lo restaurado | Igual, sin borrar nada |
| B escribe en un bloque que la versión conserva mientras A restaura | Lo de B queda, en los dos |
| B escribe en un bloque que la versión no tiene mientras A restaura | Sale de la página en los dos y no aparece en ninguna versión (5.4) |
| 400 bloques, 58 cambiados | Unos 20 ms (19 y 25 en dos corridas); la restauración sumó 12 structs en el caso chico (74 a 86) |

El prototipo es una prueba de vitest fuera del repo: el primer caso comprueba todo con `expect`; en los de B, que
los dos lados terminan iguales, y lo demás se leyó de lo que imprime. En la entrega 1 pasa a pruebas del repo con
comprobaciones en cada caso (sección 11).

### 6.3 Cada caso

- **Nunca borra historia:** sube filas nuevas; las de antes siguen. La versión de antes de restaurar es la primera
  de la lista y se puede restaurar.
- **Deshacer:** Ctrl/⌘+Z y el **Undo** del aviso (que deshace solo la restauración, 1.4).
- **Con otro editando a la vez:** lo que escribe en bloques que la versión conserva queda. Lo que escribe en bloques
  que la versión quita es el caso de 5.4. Para achicarlo: si en los últimos 2 minutos llegaron filas de otra
  persona, la confirmación lo dice (*Ana edited this page 1 minute ago; what she is writing now could be lost from
  the page*). Y lo principal: **el aviso le sale a quien escribió** (5.4, punto 2), en su dispositivo, que tiene el
  texto, aunque vuelva sin red mucho después. Con el cambio en la subida, quien restaura ve además el texto
  huérfano en el historial. Entrega 2.
- **Comentarios:** se anclan al id del bloque, y restaurar conserva los ids; un hilo de un bloque que la versión
  trae de vuelta deja de decir "el bloque ya no está". Uno de un bloque que la versión no tiene pasa a decirlo,
  como al borrar el bloque a mano.
- **Fotos de la versión que están en la papelera:**
  - en la papelera de archivos de la app (`files.trashed_at`, sin mandar a Drive): restaurar las vuelve a usar
    (`link_page_file` en la próxima sincronización) y la base las saca de la papelera sola. Nada que hacer.
  - mandadas a la papelera de Drive (`purged_at` / `drive_trashed_at`): la app no las trae de vuelta ("pedirlo es
    definitivo para la app", `Doc_Sincronizacion.md`). La confirmación lo dice (1.4) y se ven como borradas.
    Recuperarlas desde el historial (el portero las saca de la papelera de Drive) queda para más adelante.
  - imágenes viejas `sdfile://` (Supabase): no se borran nunca; vuelven a verse.
  - una foto que se agregó y se quitó antes de registrarse (nunca llegó a `files` ni a `page_files`): en la versión
    y al restaurar, los demás la ven como no disponible, igual que hoy si alguien pega ese bloque.
- **Versiones viejas de la app:** lo restaurado es una edición común con el esquema de siempre; una pestaña vieja la
  recibe como cualquier cambio. No hace falta subir `min_app_version`.
- **Una página que el editor no puede mostrar** (v0.0XX): el aviso de la página ofrece *Version history* y restaurar
  se hace sin el editor, sobre el documento (`restoreInDoc`), con la misma ida y vuelta; sin **Undo** en el aviso. Ver
  `Doc_Sincronizacion.md`, "Barreras de error".
- **Una página en la papelera:** no se abre el historial; primero se restaura la página. Las funciones de la base
  también lo rechazan (`page_in_trash`), no solo la interfaz.
- **Sin permiso de edición, o con la app por debajo de la mínima:** no se ofrece (el servidor lo rechazaría:
  `push_page_update` pide nivel 3 y la versión).

## 7. Permisos

(Desde la privacidad de lo borrado, `Doc_Privacidad_Borrado.md`, el mismo criterio decide quién recibe lo borrado:
`private.sees_deleted`. La columna `update` de `page_updates` tampoco se lee directo desde la API.)

- **Quién ve el historial, propuesto: quien puede editar la página** (nivel 3 o más: Editar, Editar y crear
  páginas, el dueño y los admins con permiso), como en Google Docs, donde quien solo ve o comenta no tiene
  historial. **Los invitados (`guest`), aunque tengan Editar, no**, hasta que Lega diga (pregunta 1). Lo comprueban
  las funciones nuevas en la base (`page_history`, `page_history_authors`) con `private.page_level`, que ya da 0 en
  un proyecto borrado, para un miembro sacado y sin membresía.
- **Para que el permiso sea de verdad hay que cerrar la tabla:** hoy `page_updates` tiene `grant select` a
  `authenticated` y la política `page_updates_select` (nivel 1), así que cualquiera que ve la página, invitados
  incluidos, puede pedir directo `seq, created_by, created_at, update` y armarse el historial con autor y hora. La
  migración saca ese `select` (`revoke select on public.page_updates from authenticated`). La app nunca leyó la tabla
  directo (solo por `pull_page_updates`; revisado en el código, la historia del repo y el portero); antes de
  aplicarla, revisar que ninguna prueba SQL la lea como `authenticated`. Lo borrado sigue llegando por
  `pull_page_updates` (abajo), pero quién y cuándo ya no.
- **Restaurar:** lo mismo que editar (nivel 3), porque es una edición.
- **Solo esta página:** el historial de P son las filas de P. Una página que se movió adentro de una compartida
  muestra todo su historial a quien hoy la puede editar, también lo de antes de compartirla (como Google Docs).
- **Nada de afuera:** las fotos se resuelven con los permisos de hoy (`can_view_file`: una de otro proyecto se ve
  como *Photo from another project*); un link interno es texto con una dirección, igual que en la página (abrirlo
  pasa por los permisos de siempre); los nombres, solo de quienes subieron algo a esta página
  (`page_history_authors`), con la misma regla que los comentarios (`comment_authors`).
- **Lo que ya pasa hoy y el historial no cambia (importante):** lo borrado de una página **ya llega** a cualquiera
  que la ve, invitados incluidos: `pull_page_updates` le sirve todas las filas para que su dispositivo arme el
  documento, y las filas tienen el texto tal como se subió, también lo que después se borró. No se ve en la app,
  pero está en su dispositivo y en la red. Ejemplo: una nota interna escrita y borrada antes de compartir la página
  con un cliente le llega al cliente. El permiso del historial es una barrera **de la interfaz**, no de los datos.
  Cerrarlo de verdad es otro trabajo (pregunta 2): que quien no edita baje, en vez de las filas viejas, un snapshot
  con GC que arme un editor (con los controles del diseño de compactar).

## 8. Rendimiento y dónde se calcula

- **Todo en el dispositivo**, en un **Web Worker** (Yjs anda igual ahí): bajar, aplicar, metadatos, snapshots,
  autores y diferencias. La pantalla recibe la lista y, al elegir una versión, sus bloques y sus tramos.
- **Qué se baja:** las filas con autor y hora (`page_history`, de a 500, con el mismo tope de tiempo y la misma
  reducción del lote que la bajada de hoy) y los correos de los autores. Después de B.15 una fila pesa unos 90 B
  de promedio (10 000 subidas, 900 KB). Las filas viejas, con todos los borrados repetidos, pesan más (la
  simulación de compactar daba 61 MB a las 10 000), pero hoy ninguna página pasa de 63 filas.
- **Una página con 10 000 subidas en el teléfono:** en la PC, 270 ms para armar todo, 31 ms por versión y de 0,3 a
  1,2 s por diferencia de una sesión larga, con 38 MB de memoria; en un teléfono, estimado de 3 a 5 veces (a medir
  en el iPhone en la entrega 1). Bajar 900 KB: unos 4 s con 250 KB/s. Se muestra la lista apenas llegan los
  metadatos y las versiones se arman cuando se piden.
- **Caché** (entrega 3): una base aparte, `<base local>:history` (como `:media` y `:comments`: la de siempre no
  cambia de versión), con, por página, hasta qué `seq` llegó, el documento del historial (`encodeStateAsUpdate` de
  un documento sin GC armado en orden: conserva lo borrado) y los metadatos por fila. La próxima vez baja solo lo
  posterior. Tope de 50 MB, se liberan las páginas menos abiertas; se borra junto con la base local.
  **Copias de seguridad restauradas:** después de restaurar una copia, el servidor vuelve a usar los mismos `seq`
  para filas distintas. La caché guarda la generación del workspace (`workspace_settings.generation`) y el `id` de
  `page_updates` de su última fila (`page_history` lo devuelve); si la generación cambió o esa fila ya no tiene ese
  `id`, se tira y se arma de cero.
- **Lo que no se usa:** la base local de la página (`docUpdates`). Mezcla lo propio sin subir con lo bajado y se
  compacta con `mergeUpdates` al pasar de 64 filas: no es un historial.

## 9. Migración (borrador, sin aplicar)

Va como `supabase/migrations/<fecha>_historial.sql`, con su prueba `supabase/tests/historial_permisos.sql`. No toca
`page_updates`, `push_page_update` ni `pull_page_updates`. Lleva su constante opcional en la app
(`HISTORY_SCHEMA_VERSION`, como la de comentarios): con la base sin migrar, el ítem del menú no aparece y no hay
aviso.

```sql
-- Historial de una página: las filas de page_updates con autor y hora. Solo a quien puede editar la página.
create function public.page_history(p_page_id uuid, p_after_seq bigint, p_limit int default 500)
returns table (id bigint, seq bigint, created_by uuid, created_at timestamptz, update text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.page_level(p_page_id) < 3 or private.history_denied_for_guest() then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.pages pg where pg.id = p_page_id and pg.deleted_at is not null) then
    raise exception 'page_in_trash' using errcode = 'P0001';
  end if;
  return query
    select u.id, u.seq, u.created_by, u.created_at, translate(encode(u.update, 'base64'), E'\n', '')
    from public.page_updates u
    where u.page_id = p_page_id and u.seq > p_after_seq
    order by u.seq
    limit least(greatest(p_limit, 1), 1000);
end; $$;

-- Quiénes subieron algo a esta página, con su correo (también si ya no son miembros).
create function public.page_history_authors(p_page_id uuid)
returns table (user_id uuid, email text) ...;   -- misma comprobación que page_history

-- Invitados: sin historial hasta que Lega diga (pregunta 1). Si dice que sí, esta función devuelve false.
-- El rol es de todo el workspace (private.workspace_role recibe el usuario, no una página).
create function private.history_denied_for_guest() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.workspace_role((select auth.uid())) = 'guest', false);
$$;
revoke all on function private.history_denied_for_guest() from public, anon, authenticated;

revoke all on function public.page_history(uuid, bigint, int) from public, anon;
revoke all on function public.page_history_authors(uuid) from public, anon;
grant execute on function public.page_history(uuid, bigint, int) to authenticated;
grant execute on function public.page_history_authors(uuid) to authenticated;

-- Quién y cuándo solo por page_history: nadie lee la tabla directo (la app usa pull_page_updates).
revoke select on public.page_updates from authenticated;

-- Versiones con nombre (entrega 3): un nombre que apunta a un seq. Sin contenido: se arma de las filas.
create table public.page_versions (
  id                uuid primary key,                       -- lo crea el dispositivo: reintentar no duplica
  page_id           uuid not null references public.pages (id) on delete cascade,
  seq               bigint not null check (seq > 0),
  update_id         bigint not null,                         -- page_updates.id de la fila seq: si después de
                                                             -- restaurar una copia esa fila es otra, no se muestra
  label             text not null check (char_length(label) between 1 and 100),
  kind              text not null default 'named' check (kind in ('named', 'restore')),
  restored_from_seq bigint,                                  -- kind = 'restore': de qué versión
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  removed_at        timestamptz,                             -- quitar el nombre: nunca borrado duro
  removed_by        uuid references auth.users (id) on delete set null
);
create index page_versions_page_idx on public.page_versions (page_id, seq);
alter table public.page_versions enable row level security;
revoke all on public.page_versions from anon, authenticated;   -- todo por funciones
-- list_page_versions(page): solo las que siguen válidas (la fila seq existe con ese update_id).
-- name_page_version(id, page, seq, label): seq <= pages.update_seq, guarda el update_id de esa fila; un id que ya
--   existe devuelve el mismo si es de la misma página y el mismo seq, y si no, 'version_conflict'.
-- rename_page_version(id, label) (quien la nombró o nivel 4), remove_page_version(id) (removed_at y removed_by).
-- Todas con la comprobación de page_history; revoke de public y anon, grant execute a authenticated.

update public.workspace_settings set schema_version = <la que siga> where id and schema_version < <la que siga>;
notify pgrst, 'reload schema';
```

## 10. Versiones viejas de la app, compactar y sin red

- **Versiones viejas:** no saben nada del historial; sus subidas son filas con autor como cualquiera, y una
  restauración les llega como una edición común (probado con el esquema publicado). No hace falta subir
  `min_app_version`: no hay propiedades ni tipos nuevos.
- **Compactar** (`Doc_Compactar.md`, rama `lega/compactar`): el historial depende de su regla 1, **nunca se borra
  una fila de `page_updates`**. No usa los snapshots: arma desde las filas. Lo que este diseño encontró y le toca a
  ese: sección 12.
- **Sin red:**
  - Entrega 1: el historial pide red; sin ella, *Version history needs a connection*.
  - Con la caché (entrega 3): se ve el historial hasta lo último que el dispositivo bajó, con el aviso *Offline:
    showing the history up to <hora>*, más *Changes on this device not synced yet*. Restaurar, no (pide red y la
    página al día).

## 11. Plan de pruebas

1. **El núcleo** (`src/sync/history.test.ts`, el prototipo pasado a vitest). Las filas salen de la subida de
   verdad (`PageDocs` con el servidor en memoria de `src/sync/testing.ts`, con `readSaved` y GC), no de updates
   crudos como en la simulación de este diseño:
   - con filas al azar de tres dispositivos, subidas enteras de un dispositivo viejo y restauraciones: cada versión
     armada (metadatos + `createDocFromSnapshot`) es igual a aplicar las filas hasta ahí;
   - **mutante:** armar el documento con `mergeUpdates` tiene que fallar con las filas que vuelven a subir todo
     (el caso medido en la página real);
   - autores: cada letra visible y cada borrado con el autor de la fila que lo trajo, en guiones donde se sabe
     quién hizo qué; la semilla; subidas enteras repetidas que no cambian el autor;
   - sesiones (cortes de 30 min y 2 min), lo pendiente, una página vacía, una con solo la semilla, una vieja con
     dos raíces;
   - la diferencia "solo de lo que cambió" igual a la completa en 500 casos al azar; cambios de tipo apareados por
     id; texto huérfano detectado.
2. **Con el editor real** (`src/ui/history.test.ts`, jsdom): los casos del prototipo (6.2), más fotos en línea y
   foto-bloque, Script, preguntas, tarjetas de Drive, el mapa de colapsar intacto, una versión con algo
   desconocido que no se deja restaurar, una con dos raíces reparada solo en memoria, y la versión publicada que
   abre lo restaurado (`fixtures/editorSchemaMain.ts`).
3. **Al azar con dos dispositivos y restaurar** (`PageDocs` y el servidor en memoria de `src/sync/testing.ts`):
   dos dispositivos escriben, borran, cambian tipos, se quedan sin red y vuelven; uno restaura versiones al azar,
   a veces deshace. En cada paso: restaurar no corre con algo pendiente; después de restaurar y sincronizar, la
   página es la versión más lo que el otro escribió en lo que la versión conserva; **toda letra escrita y subida
   aparece visible en alguna versión o en la lista de texto huérfano**, incluido el orden "B baja el borrado antes
   de subir" (con el cambio de 5.4; sin él, la prueba tiene que mostrar la pérdida), y el aviso le sale a B;
   deshacer vuelve a lo de antes; al final
   todos iguales y al servidor no le falta nada. Con la versión publicada (`fixtures/publishedDocs.ts`) como uno de
   los dispositivos.
4. **Permisos en SQL** (`supabase/tests/historial_permisos.sql`, en una transacción que se deshace): niveles 1 y 2
   no pueden pedir el historial ni los autores; 3 y 4 sí; un invitado no (según la pregunta 1); un proyecto borrado
   da 0; los correos son solo de quienes subieron a esa página; `page_versions` no se lee ni escribe directo;
   nombrar pide 3 y un `seq` de esa página; quitar el nombre no borra la fila; `pull_page_updates` sigue igual.
5. **Rendimiento:** la simulación de 2000 y 10 000 subidas en la PC y en el iPhone (en una página de prueba de un
   proyecto de prueba): abrir la lista, una versión y su diferencia, con tiempos tope.
6. **Sin red** (entrega 3): la caché se lee sin red, restaurar queda apagado, la caché se borra con la base.
7. **De punta a punta** (Playwright contra la base, lista para Lega): dos navegadores editan la misma página, el
   historial muestra los dos colores, uno restaura, el otro ve el resultado y lo deshace.

## 12. Lo que toca a otros diseños

- **Compactar (`Doc_Compactar.md`):** dice que el snapshot (`Y.mergeUpdates` de las filas) "es exactamente lo mismo
  que las filas que cubre" y que "sirve de punto de partida para armar versiones". Para bajar es cierto (el
  documento de hoy sale igual), **para el historial no**: con las filas reales, 26 de 63 versiones salen con texto
  borrado de menos (3.2). Si se quiere que un snapshot sirva al historial, armarlo **aplicando las filas en orden
  en un `Y.Doc({ gc: false })` y `encodeStateAsUpdate`** (gana la primera copia de cada item, la que tiene el
  texto), y que la comprobación de dos caminos compare también el contenido de lo borrado. Si no, el historial
  sigue leyendo filas y no cambia nada (pregunta 4).
- **Colaboración:** el texto huérfano (5.4) es la primera forma de recuperar lo que hoy se pierde cuando dos
  cambian el mismo bloque a la vez.
- **Papelera de archivos:** restaurar una versión con fotos de la papelera de la app las saca solas (6.3).

## 13. Riesgos

| Riesgo | Qué lo cubre |
|---|---|
| Armar versiones con `mergeUpdates` pierde texto borrado | Siempre aplicar filas en orden; la prueba mutante (11.1) |
| Restaurar con cambios propios sin subir los saca del historial | Restaurar exige red y la página sincronizada |
| Lo que otro escribe en un bloque que la restauración quita no se ve en ninguna versión | El aviso en el dispositivo de quien lo escribió (que lo tiene), el aviso antes de restaurar y el texto huérfano en el historial (5.4, 6.3) |
| Si quien escribió baja el borrado antes de subir, su texto no llega nunca al servidor (la subida se arma con GC) | Armar la subida sin GC (5.4, pregunta 3); mientras tanto, el aviso en su dispositivo |
| Quien ve la página puede leer `page_updates` directo, con autor y hora | La migración saca el `select` directo de la tabla (sección 7) |
| El permiso del historial no protege lo borrado: ya llega a quien ve | Dicho en la sección 7; ítem aparte (pregunta 2) |
| La hora es la de subida: lo escrito sin red aparece más tarde | Dicho en la ayuda; la hora del dispositivo, más adelante |
| Una página con miles de filas viejas (antes de B.15) pesa mucho para bajar | Hoy ninguna pasa de 63; bajar de a 500 con progreso y caché |
| Una versión con algo que esta app no conoce, o un bloque que y-prosemirror no puede armar | La guarda y la comprobación de ida y vuelta: se avisa y no se deja restaurar (6.1) |
| Una restauración enorme desde un teléfono, o que pase el tope de 8 MB de una subida | Una sola transacción (unos 20 ms con 400 bloques en la PC; medir en el iPhone); más de 4 MB no se ofrece (1.4) |
| Una copia de seguridad restaurada reusa los `seq` | La caché y los nombres de versión guardan el `id` de la fila y la generación (8, 9) |
| Una copia de seguridad restaurada deja huecos en el historial | Lo que vuelven a subir los dispositivos queda con su hora nueva; se dice en la ayuda |
| Fotos mandadas a la papelera de Drive no vuelven al restaurar | La confirmación lo dice; traerlas desde Drive, más adelante |

## 14. Entregas

1. **Quién y cuándo, y restaurar.** La migración (`page_history`, `page_history_authors`, el `revoke select` de
   `page_updates`; sin `page_versions` todavía), el ítem del menú y el atajo, la lista por día y sesión con hora
   local, nombres y colores, la versión tal como era (sin marcas; con hojas y fotos; con la reparación en memoria y
   la comprobación de ida y vuelta), **Restore this version** con su confirmación, sus condiciones y el aviso con
   **Undo**, copiar con la selección, la ayuda. Pruebas 1 (sin la diferencia), 2, 3 (sin el texto huérfano) y 4, y
   la medición en el iPhone. Copia de seguridad antes de migrar.
2. **Los cambios marcados por persona.** Antes, como ítem aparte con sus pruebas de sincronización, **la subida
   sin GC** (5.4, si Lega dice que sí). Después: **Show changes** con la unión y las decoraciones, los bloques
   apareados por id, el texto huérfano en el historial, **el aviso en el dispositivo de quien escribió**, el aviso
   de restaurar con otro editando, el Worker y la diferencia "solo de lo que cambió". Pruebas 1 y 3 completas.
3. **Nombrar y sin red.** `page_versions` (nombrar, renombrar, quitar el nombre, *Restored from…*, *Only named
   versions*), la caché `<base local>:history` y el historial sin red. Pruebas 4 (completa) y 6.
4. **Más adelante:** la hora del dispositivo para lo escrito sin red (una columna nueva que mande el dispositivo,
   solo informativa); historial del título, el ícono y el formato (hoy se pisan en `pages`); traer fotos desde la
   papelera de Drive al restaurar; que quien no edita no reciba lo borrado (pregunta 2).

Antes de cerrar cada entrega, la auditoría de siempre (funcionalidad, permisos y RLS, no perder datos, docs).

## 15. Preguntas para Lega (decididas el 2026-10-01)

Lega delegó la decisión: las cuatro van con la recomendación.

- **1, decidido:** lo ven quien puede editar la página, el dueño y los admins; los invitados no.
- **2, decidido:** lo borrado que ya llega a quien ve la página se encara aparte, después de la primera entrega.
- **3, decidido:** sí a la subida sin GC; la hace otra tanda (rama `lega/subida-sin-gc`).
- **4, decidido:** sí a que compactar conserve lo borrado: `Doc_Compactar.md` (rama `lega/compactar`) ya arma el
  snapshot aplicando las filas en orden.

Lo que se preguntó:

1. **¿Quién ve el historial?** Recomendación: **quien puede editar la página** (nivel 3 o más), el dueño y los
   admins; **los invitados no**, aunque tengan Editar, hasta que lo pidas. Es como Google Docs y no muestra a un
   cliente las notas internas borradas (en la pantalla: ver la pregunta 2).
2. **Lo borrado ya llega hoy al dispositivo de quien ve la página, invitados incluidos** (viaja en las filas que se
   bajan para sincronizar). ¿Se encara como ítem aparte? Recomendación: **sí, como ítem B del roadmap, después de
   la primera entrega del historial**; no la bloquea, y mientras tanto conviene no dejar notas internas borradas en
   páginas que se van a compartir con clientes.
3. **¿Armar la subida sin GC** (`readSaved` con `new Y.Doc({ gc: false })`), para que lo que alguien escribe en algo
   que otro borra a la vez llegue siempre al servidor? Recomendación: **sí, como ítem aparte, medido antes**: hoy ese
   texto puede quedar solo en un dispositivo (5.4); el costo son filas un poco más grandes y que lo escrito y
   borrado entre dos subidas también quede en el servidor. (Restaurar solo con red y con la página sincronizada no
   se pregunta: es lo único seguro, por la misma razón.)
4. **¿Ajustar el diseño de compactar para que sus snapshots conserven lo borrado** (aplicar en orden en vez de
   `mergeUpdates`)? Recomendación: **sí, antes de implementar compactar**; cuesta lo mismo y deja la puerta abierta
   para que el historial arranque de un snapshot en páginas enormes.

## Cómo se midió

- **La base:** consultas de solo lectura por la Management API (`begin read only` … `rollback`, el cliente de
  `scripts/lib/management.mjs` en modo dry-run): filas, bytes, autores, horas, filas por página. Para las dos
  páginas con más filas se bajaron sus filas a la carpeta de trabajo (fuera del repo) y se armaron con Yjs 13.6.33;
  no se imprimió ni se guardó en el repo ningún contenido, solo huellas y conteos.
- **El prototipo del núcleo** (Node 20): las versiones de cada fila por los dos caminos (aplicar en orden, y
  metadatos + `createDocFromSnapshot`), con `mergeUpdates` como tercer camino; autores por tramos; sesiones; la
  diferencia por persona con `toDelta`.
- **La simulación:** dos personas con el patrón de subida de la app después de B.15, 500 a 10 000 subidas, una
  semilla fija. **Límites** (los marcó la auditoría): sube los updates de cada edición tal cual, sin `readSaved` ni
  GC ni bajadas mezcladas en lo guardado, así que no reproduce las filas que vuelven a subir todo ni el caso de
  5.4; sirve para los tiempos, no para la corrección. Las páginas reales tienen un solo autor, y la de 17 filas
  son fotos sin texto: la atribución con varias personas se probó solo en la simulación. Las pruebas de la
  sección 11 usan la subida de verdad.
- **Restaurar:** una prueba de vitest en jsdom con el editor de la app (`collabHarness`), no versionada: los casos
  de 6.2. La auditoría la volvió a correr (4 de 4).

## Correcciones de la auditoría (ya incorporadas arriba)

Una auditoría independiente del diseño (contra la regla de no perder datos y los permisos, leyendo el código y las
migraciones) encontró:

| Hallazgo | Gravedad | Corrección |
|---|---|---|
| El texto que otro escribe en algo borrado a la vez no siempre llega al servidor: `readSaved` arma la subida con GC, y si el dispositivo bajó el borrado antes de subir, viaja como hueco (comprobado con Yjs). El diseño decía "las filas sí lo tienen" | Grave | 5.4: la subida sin GC como ítem aparte (pregunta 3), el aviso en el dispositivo de quien escribió, y la prueba al azar con ese orden |
| El permiso del historial no protegía ni el quién y el cuándo: la tabla `page_updates` se puede leer directo con nivel 1 | Media | La migración saca el `select` directo (7, 9); la prueba SQL lo comprueba |
| Lo medido no representa la subida real (sin GC ni `readSaved`); páginas reales de un solo autor | Media | Dicho en "Cómo se midió"; las pruebas del núcleo usan `PageDocs` y el servidor en memoria (11.1) |
| Quien pierde texto no se entera; deshacer una restauración repite el caso | Media | El aviso en su dispositivo, que tiene el texto (5.4, 6.3) |
| Un bloque que y-prosemirror no puede armar desaparece de la vista y de lo restaurado sin aviso; la reparación solo estaba pedida al restaurar | Media | Reparación en memoria también al ver y comprobación de ida y vuelta (6.1) |
| La caché y los nombres de versión no sabían de copias de seguridad restauradas (se reusan los `seq`) | Media | La generación y el `id` de la fila en la caché y en `page_versions` (8, 9) |
| Una restauración enorme pasa el tope de 8 MB y la página queda rechazada | Menor | Más de 4 MB no se ofrece (1.4) |
| Las subidas enteras repetidas suman autores y sesiones sin cambios | Menor | Solo autores con algo visible; sesiones sin cambios visibles se juntan (1.2) |
| SQL: `workspace_role` recibe el usuario, faltaban `revoke`/`grant`, la FK de `removed_by`, el conflicto de id y la papelera | Menor | Corregido el borrador (9) |
| Fotos: contar también `purged_at`; una foto nunca registrada | Menor | 1.4 y 6.3 |
| Links internos: no hay títulos escondidos (el link es texto) | Menor | Corregida la redacción (regla 4 y 7) |
| La semilla son dos autores de Yjs fijos compartidos | Menor | 4.2 |
| El **Undo** del aviso podía deshacer otra cosa; permisos que cambian con el historial abierto | Menor | El aviso desaparece con la próxima edición; los permisos se piden justo antes de restaurar (1.4) |

## Cómo quedó (entrega 1)

Manda sobre lo de arriba en lo que toca. **Quién y cuándo, ver una versión y restaurarla.**

**Dónde se abre.** En el menú de la página, *Version history* (debajo de *Export PDF / Print*; el tooltip dice solo el
atajo), y con **Ctrl+Alt+Shift+H** (⌘⌥⇧H en la Mac, nunca Ctrl; `isHistoryShortcut` en `src/ui/historyUi.ts`, en el
registro de atajos). Solo lo ve quien puede editar la página y no es invitado, con la base en la versión 11
(`canSeeHistory`). El mismo atajo, o Escape, lo cierra; cambiar de página lo cierra.

**La pantalla** (`src/ui/HistoryPanel.tsx`, se baja aparte con sus textos en `src/i18n/lazy/history.ts` y su CSS
`src/ui/history.css`): a pantalla entera, encima de la página (que sigue montada: restaurar la usa). A la derecha la
lista por día (*Today*, *Yesterday*, el día de la semana, la fecha) y sesión, la más nueva arriba como *Current
version*, con la hora local (el tooltip dice que es la de llegada al servidor) y quiénes cambiaron algo, con un punto
de color (paleta de 8, clara y oscura) y su correo, *You* o *Former member*. A la izquierda la versión elegida con el
editor de verdad en solo lectura, con el tamaño de hoja de hoy. En el teléfono, la lista a pantalla entera; tocar una
versión la abre, y *Back to the page* vuelve a la lista. Sin red, *Version history needs a connection* (y reintenta
sola al volver la red); sin permiso, *You can't see the history of this page*; en la papelera, que se restaure antes.
Avisos: cambios de la página sin subir en este dispositivo (no están en el historial y no dejan restaurar), filas que
esta versión no puede leer, y una versión que no se puede mostrar entera. Copiar: elegir y Ctrl/⌘+C, como en la página.

**El núcleo** (`src/sync/history.ts`): `PageHistory` aplica las filas en orden en un `Y.Doc` sin GC (una fila ilegible
se saltea y se cuenta), los metadatos de cada fila, los dueños de cada tramo (lo agregado y lo borrado), las sesiones
(corte de 30 minutos; una sin cambios en el contenido se junta con la anterior, y una fila que no trae nada nuevo del
contenido no suma autores) y los snapshots solo al final de cada sesión. `version(i)` arma la versión en memoria, con la
estructura reparada (solo ahí) y sin el mapa de colapsar. `loadPageHistory` baja de a 500 (50, 5, 1 si un lote vence).
Todo en el hilo principal: el Worker queda para la entrega 2 (con 10 000 subidas son unos 270 ms en la PC).

**Ver una versión sin escribir nada** (`src/ui/historyServices.ts`): como la página de práctica, el `BlockEditor` va
adentro de un `ServicesContext` con los servicios pisados: la cola de fotos ve (miniaturas, carrete) pero no escribe
(`ensureLinks` y lo demás no hacen nada: una foto de una versión vieja nunca se vuelve a colgar de la página), los demás
solo leen, sin comentarios, sin base local (colapsar queda en memoria). El editor de la versión lleva `preview`: no se
anota como el editor de la página (colapsar desde el menú, los bloques de los comentarios) y no muestra el margen de
comentarios. Muestra una **copia** de la versión: y-prosemirror puede tocar el documento que muestra.

**Restaurar** (`src/ui/historyRestore.ts`, el editor de la página se anota con `registerRestoreTarget` mientras se
puede editar):

1. *Restore this version* (no está en la versión actual) se apaga, con el motivo en el tooltip, sin red, sin permiso de
   editar, con la app por debajo de la mínima, con algo que esta versión no conoce, si no pasa la ida y vuelta, si pesa
   más de 4 MB, con cambios de la página sin subir o si falta bajar algo.
2. La confirmación dice que no se pierde nada, cuenta las fotos o archivos de la versión mandados a la papelera de
   Drive (`fetchMediaFiles`, `purged_at` o `drive_trashed_at`) y avisa si otra persona cambió la página en los últimos
   2 minutos.
3. Al confirmar: sincroniza, vuelve a comprobar (red, nada sin subir, nada por bajar, los permisos recién bajados, la
   versión mínima) y se lo pide al editor de la página.
4. El editor arma el nodo de la versión sobre una copia y compara la forma (ids de los bloques, texto y nodos; la marca
   de huecos estables de las fotos en línea no cuenta) con la de Yjs: si no coincide, no restaura. **Cambio respecto
   del diseño:** no reemplaza todo de una vez. Busca los bloques iguales (la subsecuencia común más larga, sobre los
   bloques de arriba) y reemplaza solo los tramos distintos, **cada uno en su propia transacción**, seguidas y sin
   cortar el deshacer (un solo Ctrl/⌘+Z). Con un único reemplazo, y-prosemirror conservaba el elemento de Yjs solo de
   los bloques del principio y del final, y rehacía los iguales del medio (lo que otro escribiera a la vez en ellos se
   perdía): lo mostró la prueba con fotos en línea.
5. Se cierra el historial y queda el aviso *Restored the version from …* con **Undo**, que deshace solo la
   restauración (se va con la próxima edición). Sube como cualquier edición.

**La migración** (`supabase/migrations/20261007120000_historial.sql`; aplicada desde v0.098): `page_history`,
`page_history_authors`, `private.check_history` (nivel 3, no invitado, ni la página ni una de arriba en la papelera),
`schema_version` 11. **Cambio respecto del diseño:** en vez de sacar todo el `select` de `page_updates`, `authenticated`
lee solo las columnas del contenido (`id, page_id, seq, client_update_id, update`): quién y cuándo ya no se leen directo,
y las pruebas de permisos de antes (que cuentan filas como `authenticated`) siguen pasando. Probada contra la base real
dentro de `begin … rollback` con la Management API: `historial_permisos.sql` da `ok`, las otras 14 pruebas de
`supabase/tests/` también con la migración puesta, cuatro mutantes de la migración (nivel 1, invitados, el `select`
entero, la papelera) hacen fallar la prueba, y después no quedó nada (la base sigue en `schema_version` 10, sin
`page_history`). **Para aplicarla:** copia de seguridad, `npm run db:migrate`, y publicar esta versión.

**El servidor en memoria** (`src/sync/testing.ts`): cada fila con `id`, `createdBy` y `createdAt` (con `server.now`),
`pageHistory` y `pageHistoryAuthors` con las mismas reglas, y `historyMissing` para una base sin la función.

**Pruebas:** `src/sync/history.test.ts` (9: versiones al azar con dos personas y subidas enteras con GC, contra lo que
tenía el servidor en cada punto; la mutante de `mergeUpdates`; una fila ilegible; autores de lo agregado y lo borrado;
sesiones y el colapsar; dos raíces; bajar de a lotes con un lote que vence; permisos), `src/ui/historyRestore.test.ts`
(8, con el editor real: ids, el mismo elemento de Yjs para lo que no cambió, deshacer en un paso, el Undo que no deshace
otra cosa, la versión publicada abre lo restaurado, una versión con un bloque imposible no se restaura, solo lectura no
restaura, otro editando a la vez) y `src/ui/historyPanel.test.tsx` (7: quién lo ve, la lista, sin red, Ver e invitado,
lo sin subir, restaurar con el aviso y el Undo, y el editor que no está). Más el registro de atajos, la ayuda y el
diccionario.

**Ayuda:** la entrada *Version history* en la sección *Trash and history* (que se llamaba *Trash*), con el atajo y
`since` en `0.098`.

**Lo que falta (entregas 2 y 3):** los cambios marcados por persona (*Show changes*), el texto huérfano y el aviso en el
dispositivo de quien escribió (con la subida sin GC de la otra rama), el Worker y la diferencia solo de lo tocado,
nombrar versiones (`page_versions`), *Restored from…* en la lista, la caché y el historial sin red, y medir en el iPhone.

## Correcciones de la auditoría de la entrega 1

Una auditoría independiente de la entrega 1 encontró tres bloqueantes en restaurar y la pantalla (la migración y los
permisos, bien). Corregidos; manda sobre "Cómo quedó (entrega 1)" en lo que toca:

| Hallazgo | Corrección |
|---|---|
| **B1.** Con secciones colapsadas, restaurar no hacía nada (o la mitad) y avisaba "Restored": colapsar (`collapseEditor.ts`, `hiddenLost`) descarta una transacción propia que borra bloques escondidos | Cada tramo va con `BACKGROUND_META` (colapsar no la descarta). Al final se comprueba que la página es la versión y que el deshacer creció en un paso; si no, se deshace lo que quedó y no se avisa "Restored" (`failed`) |
| **B2.** Con dos o más tramos que sacan bloques, el *Undo* del aviso deshacía solo una parte: la guarda del deshacer (`undoGuard.ts`) corta la pila en cada transacción que saca bloques | Los tramos van adentro de `asOneUndoStep`: un solo paso, también para Ctrl/⌘+Z |
| **B3.** Con el historial abierto por el atajo, el teclado seguía escribiendo en la página escondida (también Ctrl+A y Retroceso) | Al abrir, el foco pasa a la pantalla del historial y lo demás de la app queda `inert`; al cerrar, todo vuelve y el foco a donde estaba |
| O1. "Otra persona cambió la página" se miraba solo con lo bajado al abrir | Al confirmar, después de sincronizar, se piden las filas nuevas: si hay de otra persona, la lista se actualiza y se vuelve a preguntar con el aviso. El aviso de antes usa el reloj del dispositivo |
| O2. Restaurar una versión igual a la actual dejaba un *Undo* que deshacía otra cosa | Sin tramos, no se toca nada y el *Undo* no hace nada (B2) |
| O4. En el teléfono, el motivo de *Restore* apagado no se veía (solo tooltip) | En pantalla angosta, una línea debajo de la barra |
| O3. La lista no se actualiza sola con el historial abierto | Al roadmap (se actualiza al confirmar, O1) |
| O5. `npm run db:test` (`scripts/db-migrate.mjs --test`) aplica lo pendiente DE VERDAD antes de correr las pruebas | Para probar una migración sin aplicarla, un script propio con `begin … rollback` (como se hizo acá); nunca `db:test` |

Pruebas nuevas: `src/ui/historyRestorePage.test.ts` (las 6 de la auditoría, con las extensiones reales de la página:
sección colapsada, el mismo caso sin colapsar, dos tramos con *Undo* en un paso, versión igual a la actual, salto de hoja
y tabla, otro escribiendo en una sección colapsada) y en `historyPanel.test.tsx` el foco y `inert` (B3), el aviso al
confirmar (O1), `recentOther` y la línea del motivo (O4). Sacar `inert` o la nueva consulta al confirmar hace fallar su
prueba. Suite: 2184 pasan.

## Con la subida sin GC (B.16, v0.095)

Desde v0.095 la subida se arma sin GC: una fila trae también el texto de lo que ya estaba borrado en el dispositivo
(lo escrito en algo que otro borró llega al servidor; sección 5.4, punto 1). Las filas de antes y las de una versión
anterior de la app abierta todavía (que restaura una copia y vuelve a subir todo) siguen viniendo con huecos. El
historial no cambia: aplica las filas en orden y cada elemento queda con la primera que lo trae. Lo prueba
`src/sync/history.test.ts` ("filas de los dos tipos"): la versión publicada (`fixtures/mainDocs.ts`, con GC) y esta en
la misma página, al azar, con restauraciones y con texto escrito y borrado antes de subir; cada versión es igual a lo
que tenía el servidor. La mutante de `mergeUpdates` ahora usa la versión publicada para la subida entera con huecos:
con esta, que sube sin GC, ya no aparecen.

## Ajustes de la re-verificación

La re-verificación de la auditoría pasó sin bloqueantes, con tres ajustes: `src/ui/historyRestoreCheck.test.ts` (si un
plugin descarta un tramo, restaurar deshace lo aplicado y no dice "Restored"; con dos tramos, Ctrl/⌘+Z deshace todo en un
paso y rehacer lo vuelve a poner), una restauración que el editor intentó y deshizo dice *Couldn't restore this version.
Nothing changed.* (antes decía que la página no estaba abierta para editar), y la segunda confirmación (cuando otra
persona cambió la página mientras tanto) conserva la cuenta de fotos mandadas a la papelera de Drive.

## Cómo quedó (entrega 2)

Manda sobre lo de arriba en lo que toca. **Los cambios marcados por persona, el texto huérfano, el Worker y la lista que
se actualiza sola.** Sin migración: todo sale de las mismas filas de `page_history`.

**Show changes** (casilla en la barra, prendida por defecto; *Changes* en pantalla angosta; queda como la dejó la persona
mientras la app está abierta; sin atajo). Cada versión contra la anterior de la lista (la primera, contra la página
vacía). Se arma la **unión** (`src/sync/historyDiff.ts`, `versionChanges`): un documento nuevo, en memoria, con lo que se
ve en alguna de las dos versiones y, aparte, las marcas (cada una con la fila que la trajo: de ahí quién y cuándo):

- lo agregado y lo borrado dentro de un texto, con `toDelta` y los dos snapshots (exacto, sin adivinar);
- un bloque entero agregado o borrado (la barra a la izquierda; el borrado, atenuado);
- algo agregado o borrado adentro de un bloque que sigue (una foto en línea, una fila de tabla): un contorno;
- **bloques rehechos apareados por id:** y-prosemirror rehace el bloque (o su contenido) al cambiar el tipo, mover o
  sangrar. Un borrado y un agregado con el mismo id entre las dos versiones son **un** bloque que cambió: rótulo
  *Changed to Heading 2* (o *Formatting changed*, o *Moved* si solo cambió de lugar) y el texto comparado **por
  palabras** (letra por letra, "fija" → "en mano" se leía como letras sueltas). Uno con uno, en el orden de Yjs: dos
  dispositivos que rehacen el mismo bloque a la vez dejan dos con el mismo id, y el de más se muestra agregado;
- el formato o el nivel cambiado en el lugar (título 1 a 2, un color): el rótulo;
- la semilla (estructura vacía igual en todos los dispositivos) no se marca.

La pantalla muestra la unión con el editor de solo lectura y pinta las marcas con **decoraciones** de ProseMirror
(`src/ui/historyMarks.ts`), ubicadas con el mapa de y-prosemirror: el esquema y los documentos no cambian; una versión
vieja de la app no se entera. Colores: la paleta de la entrega 1, por orden de aparición; lo agregado subrayado con
fondo suave, lo borrado tachado (se distinguen sin el color). `data-tip` en cada marca: *Added by Ana · ayer, 14:05*. El
rótulo va al final del renglón (en un bloque sin texto, arriba a la derecha). Con hojas, sin las marcas de corte. Con
Show changes apagado, la versión limpia de la entrega 1. Si la unión trae algo que esta versión no conoce, se muestra
la limpia.

**Texto huérfano** (5.4, con la subida sin GC de v0.095): `PageHistory` anota, al sumar cada fila, el texto que trajo
adentro de algo que una fila **anterior** ya había borrado (sus ancestros), por texto de Yjs y con el id del bloque. Se
ve arriba de la versión de esa fila, en una franja con el color de la persona: *Ana wrote in a part that had already
been removed (it isn't on the page):*, el texto y **Copy**. Lo escrito y borrado en la misma subida no cuenta. Las filas
con GC (versiones anteriores) lo traen como hueco: ahí no hay texto que mostrar.

**El Worker** (`src/sync/history.worker.ts`, `historyCore.ts`, `historyClient.ts`): la pantalla baja las filas y se las
pasa; el Worker arma el historial y contesta la lista, cada versión y cada unión como updates de Yjs (transferidos).
Si el navegador no deja crear el Worker, su script no arranca en 10 s o se cae, se arma en la página con el mismo
código (vuelve a cargar las filas que ya tenía; ningún pedido se pierde). En el build, `history.worker-*.js` (100 KB,
con Yjs) sin el aviso de libheif (`vite.config.ts`).

**La diferencia solo de lo que cambió:** la unión se arma en **una sola transacción** sobre el documento del historial
(Yjs parte los elementos en los bordes de cada snapshot una vez, no en cada texto: era lo caro del prototipo), y con
`scope = 'changed'` solo los bloques que tocó alguna fila del medio (lo que agregaron o borraron por primera vez,
`PageHistory.fresh`) se comparan con los dos snapshots; el resto se copia como está. Un bloque o un grupo agregado o
borrado suma los de adentro, y algo del contenido fuera de un bloque (una raíz) pasa a la diferencia completa. Las
pruebas la comparan con la completa en los casos al azar y en los que la auditoría encontró distintos (ver abajo); no
está demostrado que dé igual siempre: si en algún caso diera distinto, es solo de presentación (el contenido de la
unión es el mismo).

**La lista se actualiza sola** (O3): después de cada sincronización se piden las filas posteriores a la última y se
suman (`PageHistory.append`, sin armar todo de nuevo). La versión elegida sigue elegida (por su `seq` o la sesión que
lo contiene si creció), con el mismo editor si no cambió; la lista no salta si la persona bajó. Al confirmar una
restauración se mira lo llegado desde que se mostró la confirmación (O1 sigue andando con la lista viva).

**Medido** (PC, Node 22, la simulación del diseño en `src/sync/historyMeasure.test.ts`, que corre solo con
`HIST_MEASURE=<archivo>`; es más liviana que la del diseño: 421 KB con 10 000 subidas, no 900):

| 10 000 subidas, 104 sesiones | Antes (entrega 1 / prototipo) | Ahora |
|---|---|---|
| Armar todo | 167 ms en el hilo de la pantalla | En el Worker; la pantalla copia las filas (5,6 ms) |
| Abrir una versión | 2 a 22 ms en la pantalla | En el Worker; la pantalla arma el documento recibido (0,7 a 7 ms, con la unión) |
| Diferencia de una sesión | 71 a 726 ms (`toDelta` por texto, cada uno con su transacción) | 5 a 21 ms la completa; **3 a 10 ms solo lo tocado** |
| Una fila nueva con el historial abierto | Armar todo otra vez (167 ms) | `append`: 16,6 ms |

Con 2000 subidas (84 KB): armar 32 ms; la diferencia, 16 a 19 ms antes y 2,7 a 5,2 ms ahora. El iPhone sigue sin medir.

**Pruebas nuevas:** `src/sync/historyDiff.test.ts` (6: por persona, rehecho con el mismo id, formato y mover, texto
huérfano, la diferencia por palabras, y al azar con tres personas y filas con GC de `fixtures/mainDocs.ts` mezcladas:
cada versión igual al servidor, la unión sin lo borrado igual a la versión y sin lo agregado igual a la anterior, solo
lo tocado igual a la completa en más de 500 casos, cada letra subida en la versión de su fila o en su texto huérfano;
sacar los bloques tocados hace fallar 4), `src/sync/historyClient.test.ts` (4: el Worker y la página dan lo mismo, con
los mensajes copiados como el navegador; un Worker que no arranca y uno que se cae), `src/ui/historyMarks.test.ts` (2:
las marcas sobre su texto con el editor de hoy y el publicado, sin escribir en la unión; la extensión dibuja clase,
color, tooltip y rótulo), `src/ui/historyRandom.test.ts` (la prueba 3: A restaura al azar con el editor de verdad y a
veces deshace, B escribe y C es la versión publicada; restaurar deja la versión y deshacer lo de antes; al final todos
iguales, al servidor no le falta nada, ninguna letra se pierde y quien quedó con texto huérfano tiene su aviso) y 3 más
en `historyPanel.test.tsx` (Show changes y apagarlo; la lista viva con la versión elegida; el texto huérfano). Sacar la
actualización de la lista hace fallar la suya.

**Lo que encontró la prueba 3 (anotado, no cambiado):** una versión con **dos bloques del mismo id** (dos dispositivos
rehicieron el mismo bloque a la vez) no se puede restaurar: el editor le cambia el id a uno, la comprobación final no da
y la restauración se deshace sola (*Couldn't restore this version. Nothing changed.*). No se pierde nada; arreglarlo es
tocar restaurar (fuera de esta entrega).

**Lo que falta:** la entrega 3 (nombrar versiones con `page_versions`, *Restored from…*, *Only named versions*, la caché
y el historial sin red) y medir en el iPhone (la migración de la entrega 1 ya estaba aplicada desde v0.098). Detalles que quedaron así: el
tooltip de un tramo largo de una misma apertura (un autor de Yjs) dice la hora de su primera fila; un cambio solo de
formato de texto (negrita) no se marca; en un bloque rehecho con fotos en línea, las fotos no se marcan.

## Correcciones de la auditoría de la entrega 2

Una auditoría independiente encontró dos bloqueantes y nueve observaciones (ninguna letra perdida en unas 100 000
versiones al azar). Corregido; manda sobre "Cómo quedó (entrega 2)" en lo que toca:

| Hallazgo | Corrección |
|---|---|
| **B1.** Con *Show changes* prendido, copiar llevaba lo borrado (y con el editor de solo lectura, el navegador copiaba los estilos de las marcas: al pegar entraba tachado y en color) | Copiar, cortar y arrastrar desde la vista se atienden antes que el editor: lo elegido sin lo marcado como borrado (un estado aparte sin esos tramos ni esos bloques, nunca despachado), serializado como lo hace BlockNote (`cleanClipboard` en `historyMarks.ts`). Con los cambios apagados, como siempre |
| **B2.** Con StrictMode (`npm run dev`) el historial no cargaba (el motor memorizado se destruía) y quedaba un Worker abierto | El motor se crea en el efecto y se cierra al desmontar; una prueba monta la pantalla en StrictMode y comprueba que todos los Workers se cierran |
| O1. "Solo lo tocado" a veces distinto de la completa (un bloque que deja de verse porque se borró uno de arriba, la raíz vieja de una página con dos raíces) | Un bloque o grupo tocado suma los de adentro; una raíz tocada pasa a la completa. Los 14 casos guardados por la auditoría dan igual; 4 quedan como prueba (`src/sync/fixtures/historyTouched/`). El doc ya no dice que da igual siempre |
| O3. Marcas de borrado sin fila (texto de un bloque borrado con su padre): tooltip sin hora | Sin borrado propio, la fila que borró lo más cercano de arriba |
| O4. Mutantes vivos: restaurar la unión en vez de la versión, el Worker que no se cierra, sin compensar el scroll | Pruebas nuevas en `historyPanel.test.tsx` y `historyClient.test.ts`; cada una falla con su mutante |
| O5. La ayuda decía "hover": en el teléfono no hay | Tocar una marca en el teléfono muestra quién y cuándo en un aviso; la ayuda lo dice |
| O6. La vista quedaba en blanco mientras se armaba la unión | *Loading the version…* también ahí |
| O7. La prueba de las letras huérfanas comparaba un carácter | El texto huérfano lleva sus tramos de Yjs y la prueba compara por id |
| O2, O8, O9 y los mutantes M5 y M10 | Al roadmap (P.18), con su detalle |
| R1 (re-verificación). Elegir solo lo borrado (un triple clic en un párrafo tachado) dejaba la copia al navegador, con los estilos de las marcas | Se copia ese texto como texto común (el documento no tiene tachado ni color: son decoraciones), sirve para recuperar un párrafo borrado |
| R2 (re-verificación). Sin prueba propia: la fila del borrado heredada del bloque de arriba (O3) y el aviso de carga de la unión (O6) | Una prueba cada una en `historyDiff.test.ts` y `historyPanel.test.tsx`; las dos fallan con su mutante |

## Cómo quedó (entrega 3)

Manda sobre lo de arriba en lo que toca. **Versiones con nombre, *Restored from…* y el historial sin red.**

**La migración** (`supabase/migrations/20261011120000_versiones_con_nombre.sql`, aplicada el 2026-10-02; prueba
`supabase/tests/versiones_con_nombre_permisos.sql`). `page_versions` como en la sección 9, con dos cambios: `kind`
`'named'` (con `label`) o `'restore'` (con `restored_from_seq` y sin `label`), atados por una restricción, y un índice
único parcial para que una versión tenga un solo nombre vigente. Sin acceso directo (RLS sin políticas, `revoke all`).
Funciones: `list_page_versions`, `name_page_version`, `rename_page_version`, `remove_page_version` y
`mark_page_restored`, todas con `private.check_history` (nivel 3, no invitado, no en la papelera, también una de arriba,
con la regla de v0.102). **Decisión a confirmar con Lega:** nombrar, cualquiera que ve el historial; renombrar y quitar,
quien lo puso o nivel 4 sobre la página (lo del borrador de la sección 9), porque un nombre lo usa quien lo puso para
encontrar esa versión; la marca de restauración, solo sobre una fila que subió quien llama, y no se renombra ni se
quita. Las que escriben miran la versión mínima de B.17 antes de escribir (repetir lo ya hecho no escribe y anda). Un
nombre solo se muestra si su fila sigue teniendo el `id` guardado (copia de seguridad restaurada). Sube
`schema_version` a 13 (`NAMED_VERSIONS_SCHEMA_VERSION` en `src/sync/history.ts`): con 11 o 12 el historial anda igual,
sin nombres ni filtro, y si la función no está (PGRST202) también.

**Las sesiones se cortan en los nombres** (`PageHistory.setBreaks`, `versionBreaks`): después de cada fila con nombre
(lo que se escriba después, aunque sea en la misma media hora, va a una versión nueva: la versión con nombre es
exactamente esa fila) y antes de cada fila de restauración (la versión de antes de restaurar queda en la lista, como
dice 6.3). El Worker recibe los cortes (`breaks`) y los guarda con lo demás para rearmarse en la página si se cae. Un
nombre se muestra en la sesión que contiene su fila (si una sesión sin cambios en el contenido se juntó con ella, el
contenido es el mismo).

**En la pantalla** (`HistoryPanel.tsx`): cada versión tiene un ⋯ (en la computadora aparece al pasar o en la elegida;
en el teléfono, siempre) con *Name this version*, o *Rename* y *Remove name*; el campo va en el renglón (Enter o salir
guarda, Escape deja como estaba sin cerrar el historial; un nombre vacío no cambia nada: quitarlo es *Remove name*). El
nombre va en el renglón y arriba, junto a la fecha. *Only named versions* deja las que tienen nombre y la actual. Un
nombre ajeno sin nivel 4 no muestra el ⋯. Si otro dispositivo nombró la misma versión, la lista se pone al día y lo
dice. Sin red, el ⋯ está apagado (*Naming versions needs a connection.*).

***Restored from <fecha>*** (`historyLoad.ts`, `markRestoreLater`): el `seq` de la restauración se sabe recién cuando
sube. Al restaurar se guarda una marca pendiente (en la caché) con la última fila que había; después de cada
sincronización, cuando la página no tiene nada sin subir, se busca la primera fila **propia** posterior y se marca
(`mark_page_restored`). Si la app se cierra antes, la termina la pantalla del historial la próxima vez que se abre esa
página (`settleRestores`; una semana de plazo). El *Undo* del aviso la deja de lado (la fila que suba podría traer la
restauración y el deshacer juntos). Es un rótulo: si se pierde, no se pierde nada de la página.

**La caché** (`src/sync/historyCache.ts`, base `<base local>:history`). **Cambio respecto del diseño:** guarda las filas
de `page_history` (y los correos y los nombres), no el documento armado y los metadatos: el historial se arma con el
mismo código que con red (sin un segundo camino que pueda dar distinto) y lo que se ahorra es bajarlas, que es lo lento.
Con red se baja solo lo posterior, pidiendo también la última guardada para comprobar su `id` (`loadPageHistory` con
`start`); si no coincide, o si cambió la generación del workspace (`tree.knownGeneration`), se tira y se baja todo. Sin
red, o si el servidor no contesta, se ve lo guardado con *Offline: showing the history up to <fecha>, the last time it
was downloaded.*; restaurar y nombrar quedan apagados con su motivo, y se vuelve a pedir cuando vuelve la red (o, si el
dispositivo creía tener red, después de la próxima sincronización: no en cada vuelta). Si la base dice `page_not_found`
o `page_in_trash`, se tira lo de esa página. Tope de 50 MB, liberando las páginas abiertas hace más tiempo (una que sola
pasa el tope no se guarda). Se borra al salir de la cuenta (el aviso `SIGNED_OUT`, también si Supabase invalida la
sesión; la base local queda, puede tener cambios sin subir) y con las bases del workspace al sacarlo del dispositivo
(`deleteWorkspaceDatabases`). Si el navegador no la deja abrir, el historial anda como en la entrega 2.

**Versiones viejas:** la app publicada (v0.102 a v0.105) no llama a nada de esto; con la migración aplicada sigue igual
(la prueba SQL comprueba que `page_history` y `pull_page_updates` no cambian). No hay tipos de bloque ni propiedades
nuevas.

**Pruebas:** `supabase/tests/versiones_con_nombre_permisos.sql` (en `begin … rollback` contra la base, con un script
propio: `ok`, y las otras 18 de `supabase/tests/` también con la migración puesta; 23 de 23 mutantes de la migración la
hacen fallar), `src/sync/historyCache.test.ts` (6), `src/sync/historyLoad.test.ts` (10: lo guardado y lo nuevo, sin red,
copia restaurada y generación, permiso perdido, sin migración, nombrar y los cortes, permisos y versión mínima en el
servidor en memoria, *Restored from…* con la fila de otra persona en el medio y el *Undo*, las marcas pendientes, y que
cortar en cualquier fila da lo que tenía el servidor), `src/ui/historyCacheCleanup.test.tsx` (2: salir de la cuenta y
sacar el workspace) y 7 más en `historyPanel.test.tsx` (nombrar, renombrar, quitar y el filtro; lo escrito después de un
nombre; nombre ajeno, base sin migrar y sin la función; sin red y otro dispositivo; *Restored from…*; sin red con lo
guardado y al volver la red; sin nada guardado), más el atajo del campo del nombre en el registro (Enter guarda,
Escape deja como estaba). Mutantes de la app: 25 de 26 hacen fallar alguna prueba; el que vive saca la espera a que la
página termine de subir antes de buscar la fila de la restauración, que solo ahorra pedidos (sin ella, la busca, no la
encuentra y espera a la sincronización siguiente). Suite, con main v0.105 unido y las correcciones de la auditoría: 2416 (2411 pasan, 5 salteadas).

**Lo que falta:** medir en el iPhone; aplicar la migración. Detalles que quedaron así: Ctrl/⌘+Z de la restauración (en
vez del *Undo* del aviso) no deja de lado la marca; en el filtro, la versión actual se ve siempre aunque no tenga
nombre. De la auditoría (abajo): renombrar pisa el nombre anterior sin dejar rastro (O3) y la ventana de una copia
restaurada que vuelve atrás el contador de `page_updates` (O7).

## Correcciones de la auditoría de la entrega 3

Una auditoría independiente dio «lista», sin bloqueantes, con ocho observaciones. Manda sobre «Cómo quedó (entrega 3)»
en lo que toca:

| Hallazgo | Corrección |
|---|---|
| **O1.** Dos pestañas con el historial de la misma página guardan a la vez: un guardado con menos filas después de uno con más bajaba la última guardada, lo guardado dejaba de cuadrar y se tiraba (solo la caché) | `save` nunca baja la última (`lastSeq`, `lastId`): si lo guardado es más nuevo que lo que llega, queda. Prueba: tres guardados a la vez (25, 40 y 30 filas) |
| **O2.** *Restored from…* iba en «la primera fila propia posterior»: si la restauración nunca subía (deshecha antes, perdida) o subía algo otro dispositivo de la misma persona, quedaba sobre otra edición | La restauración deja su **huella** (`RestoreTrace`: los tramos que agregó y borró, del paso de deshacer del editor) en la marca pendiente; se marca solo la primera fila propia que la trae (`rowHasTrace`, sin integrarla). Sin huella no se marca. Pruebas con una restauración que nunca subió, otro dispositivo de la misma persona y una que solo borra |
| **O4.** Reintentar nombrar con el id de un nombre que alguien sacó en el medio lo devolvía y la app lo volvía a mostrar | `name_page_version` da `version_not_found` (la pantalla pone la lista al día y lo dice) |
| **O5.** Huecos de la prueba SQL: un origen inexistente menor que la fila en `mark_page_restored`, y sacar dos veces con otra persona | Casos nuevos (origen 0; d con nivel 4 saca otra vez y no pisa quién ni cuándo; el reintento de O4), más algunos de la auditoría: nombres con comillas, saltos de línea, 100 y 101 «ñ», nulo, un `seq` que solo existe en otra página, quien lo puso y bajó a Ver. 27 de 27 mutantes de la migración la hacen fallar |
| **O6.** D13: la caché seguía en el dispositivo después de perder el permiso, hasta abrir ese historial con red o salir de la cuenta | `useHistoryCachePruning` (en la pantalla principal): con los permisos conocidos y la base en la versión del historial, cuando cambian los permisos o el árbol tira lo guardado de cada página cuyo historial ya no se ve (`canSeeHistory`; pasar a invitada tira todo). No crea la base si no existe |
| **O8.** Versiones y cuentas de los docs | `HISTORY_NAMES` en `'0.106'` (la pone quien publica), «las otras 18», la app publicada hasta v0.105 |
| O3. Renombrar pisa el nombre anterior sin rastro | Anotado: no es contenido de la página. Si hiciera falta, renombrar como «sacar + nombrar» (fila nueva) |
| O7. Si una copia restaurada vuelve atrás el contador de `page_updates`, el `id` de la última fila guardada puede coincidir con otra | Anotado: la defensa real de la caché es la **generación** (el script de restauración la sube). Queda una ventana: abrir el historial antes de que el dispositivo se entere de la generación nueva. Para cerrarla, que `loadHistory` lea la generación del servidor antes de usar lo guardado |

Mutantes de estas correcciones: 8 de 8 hacen fallar alguna prueba. Lo único sin prueba propia es que la pantalla
principal llame a `useHistoryCachePruning` (una línea).

## Lo que quedó de las entregas (después de v0.106)

Manda sobre lo de arriba en lo que toca. Sin migración. Lo que habían dejado anotado la prueba al azar y las auditorías
de las entregas 2 y 3:

- **Una versión con dos bloques del mismo id se restaura** (lo que encontró la prueba 3; ya pasaba en v0.098). Dos
  dispositivos que rehacen el mismo bloque a la vez dejan dos con el mismo id; el editor (la extensión `uniqueID` de
  BlockNote) no los acepta y le cambia el id al recibir la edición, así que la página no quedaba igual a la versión y la
  restauración se deshacía sola. Ahora `versionNode` (`src/ui/historyRestore.ts`), en su copia en memoria, le da un id
  nuevo al repetido con `uniqueBlockIds`: el segundo en el orden del documento de Yjs (también adentro de los hijos); el
  primero conserva el suyo y con él sus comentarios. La versión del historial no se toca. La prueba 3 ahora exige que
  esas versiones se restauren (en las seis semillas hay tres) y compara la página con la versión salvo esos ids.
- **O9. Al confirmar, una consulta empezada después de sincronizar.** `refreshRows(true)` espera la consulta de filas
  que estuviera en curso (pudo empezar antes de `syncNow` y no ver una fila de otra persona) y pide otra. La consulta
  siguiente arranca de lo último sumado aunque la pantalla todavía no se haya vuelto a dibujar.
- **O7. La generación del servidor antes de usar lo guardado.** Con algo guardado y red, `loadHistory` lee
  `workspace_settings.generation`; si no es la de lo guardado (restauraron una copia de seguridad y el dispositivo
  todavía no se enteró), lo tira y baja todo, aunque el `id` de la última fila guardada coincida con otra (una copia que
  vuelve atrás el contador de `page_updates`). Lo nuevo se guarda con la generación del servidor (`HistoryLoad.generation`,
  que la pantalla usa para guardar lo que llegue después). Sin la tabla, la del dispositivo; otro error, se baja todo;
  sin red, lo guardado como siempre. Es un pedido chico más al abrir el historial, solo si hay algo guardado.
- ***Restored from…* y Ctrl/⌘+Z.** El resultado de restaurar trae `onUndone`: avisa (una vez) cuando el deshacer de
  Yjs saca justo el paso de la restauración (`stack-item-popped` con ese paso), sea por el *Undo* del aviso o por el
  teclado. La pantalla deja de lado la marca pendiente y saca el aviso; mira hasta que la marca queda puesta o se deja de
  lado. Igual que con el *Undo* del aviso: si la restauración ya subió y quedó marcada, deshacerla no saca el rótulo; y
  rehacerla después de deshacerla no la vuelve a marcar (es un rótulo: no se pierde nada).
- **O2. Dos sangrías a la vez bajo el mismo bloque.** Dejan dos grupos de hijos, a veces con el mismo hijo en los dos.
  La página los junta sin repetirlo (`repairBlocks`); la unión ahora también: un bloque de un grupo de más que repite a
  uno de los anteriores (visible en las mismas versiones, el mismo id y el mismo contenido en cada una, `sameBlock`) no
  se muestra otra vez. Solo presentación. Prueba con las filas del caso de la auditoría
  (`src/sync/fixtures/historyDupGroups/`).
- **M5 y M10:** `mergeRows` descarta las filas que ya estaban y también las repetidas dentro del lote; una prueba lo
  mira. Otra elige la versión actual y hace llegar en un mismo lote una fila que la agranda y otra que abre una sesión
  nueva: la elegida sigue elegida (sacar la búsqueda por la sesión que contiene el `seq` la hace fallar).

**Lo que sigue anotado:** O3, renombrar pisa el nombre anterior sin rastro. Hacerlo desde la app como «sacar + nombrar»
son dos pedidos (si el segundo falla, el nombre se pierde) y el nombre nuevo pasaría a ser de quien renombra (cambia quién
lo puede tocar); hacerlo bien es una función nueva en la base, o sea una migración. No es contenido de la página: queda
en el roadmap. También siguen la marca que se pierde si la app se cierra antes de que la restauración suba y no se abre
ese historial en una semana, y medir en el iPhone.

**Pruebas nuevas:** `historyRestore.test.ts` (2: la versión con ids repetidos, arriba y en los hijos; `onUndone` con
Ctrl/⌘+Z, que no avisa por deshacer otra cosa ni dos veces), `historyPanel.test.tsx` (4: la consulta en curso al
confirmar, M5, M10 y Ctrl/⌘+Z antes de que suba), `historyLoad.test.ts` (2: el contador vuelto atrás con el mismo id,
y la generación que no se puede leer) y `historyDiff.test.ts` (1: O2). Cada una falla sin su arreglo (comprobado
sacándolo); la de M10 y la de M5, con su mutante.
