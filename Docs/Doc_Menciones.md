# Menciones en comentarios: «@persona»

**Estado: diseño, sin código ni migración** (roadmap P.21; pedido de Lega del 2026-10-02). Se diseñó contra `main`
v0.108, con la base en `schema_version` 13 y `min_app_version` 0.104. Toca permisos y la privacidad de quién ve a
quién: cada entrega va con sus pruebas de permisos (casos negativos y mutantes) y su auditoría independiente. Las
decisiones propuestas van numeradas ME1 a ME10 (sección 10); el número final lo pone quien las publique. **Auditado**
(2026-10-02, «aprobado con condiciones», 60 casos en `begin … rollback`) y corregido: ver «Correcciones de la
auditoría», al final. **Va después del link público** (su migración sube a 14; esta, a 15).

## En corto

- **El pedido.** En un comentario, escribir `@` y elegir a una persona; esa persona recibe un aviso **dentro de la
  app** ya, y **por correo** más adelante, cuando haya una clave de Resend (grupo C del roadmap).
- **A quién** (ME1): solo a quien **ya ve la página**. Un miembro ve en la lista al equipo que ve la página y a los
  clientes que ya comentaron en ella (lo seguro mientras Lega decide ME10). Un invitado ve una lista corta: quienes ya
  participan en los comentarios de esa página y quien le compartió algo (ME3). En la entrega 2, el dueño y los admins
  ven además a quien no ve la página y pueden compartírsela y mencionarla en un paso (ME2).
- **Cómo se guarda** (ME4): el texto del comentario sigue siendo texto plano con `@lega` escrito; **quién** fue
  mencionado va en una tabla aparte, `comment_mentions`. Una versión vieja de la app ve `@lega` como texto, sin perder
  nada: no hace falta subir la versión mínima.
- **El aviso** (ME5, ME6): una **campana** en la barra de arriba con el número de menciones sin leer; al tocarla, la
  lista (quién, en qué página, el comienzo del comentario); al abrir una, la app va a la página con el hilo abierto y
  la marca leída. La app pregunta **cada 60 segundos** con la app a la vista (sin Realtime).
- **Sin red:** se menciona con la lista guardada en el dispositivo; el comentario y su mención salen en la cola de
  siempre. La campana muestra lo último que bajó.
- **Visitantes del link público** (ME7): no mencionan ni se los menciona. Lo que escriban con `@` queda como texto.
- **Menciones importadas de Coda** (ME8): hoy se ven crudas (`@[Nombre](superhuman://users/<número>)`); se muestran
  como `@Nombre` resaltado, sin aviso y sin tocar la base.
- **Correo** (ME9, grupo C): lo manda el portero cuando la app de quien menciona se lo pide con su sesión; el portero
  sigue sin ninguna clave de la base.
- **Entregas:** 1 (base, `@` y lista, la campana, sin red, Coda), 2 (compartir desde la mención, marcas en el árbol y
  en el ícono de la app), 3 (correo, cuando Lega cargue la clave de Resend).

## Reglas que no se rompen

1. **Nunca lo de arriba.** Una mención no da acceso a nada: la persona mencionada ve el comentario solo si ve la
   página. Si deja de verla (le sacan el permiso, la página va a la papelera, la sacan del workspace), la mención
   desaparece de su lista sin mostrar el texto.
2. **Cada workspace es una isla.** Las menciones viven en el Supabase del workspace; la app pregunta solo al workspace
   abierto. Nada pasa por servidores de Lega.
3. **Nada se borra.** Sacar una mención al editar el comentario la marca (`removed_at`); borrar el comentario lo marca
   como siempre. Las filas quedan.
4. **Primero en el dispositivo.** La mención viaja con el comentario por la cola sin red, con el mismo reintento
   idempotente; la cola se vacía solo cuando el servidor confirma.
5. **Una versión vieja no rompe nada.** El texto del comentario no cambia de forma; nada nuevo entra al documento de
   la página (no hay tipos de bloque ni marcas nuevas).
6. **La base decide.** La lista de candidatos que muestra la app es una ayuda; quién queda mencionado lo decide la
   base con los permisos de ese momento.
7. **Importar nunca avisa.** Lo que entra de Coda no crea menciones ni manda nada a nadie (regla de la importación:
   nadie del doc de Coda se entera).

## 1. Qué hay hoy

Medido en el código de `main` v0.108 y en la base de Wanka (solo lectura, 2026-10-02):

- **Comentarios** (`20260930170000_comentarios.sql`, `20260930200000_comentarios_importados.sql`): tabla propia
  `comments`, anclada a un bloque o a la página, nunca dentro del documento. El texto (`body`) es **texto plano**
  (hasta 10 000 caracteres); el panel lo muestra tal cual (`<p className="comment-body">`). La API lee la tabla sin el
  texto; el texto sale por `list_comments(página, desde)`. Escriben solo `add_comment`, `edit_comment`,
  `delete_comment`, `resolve_thread` e `import_comment`, todas `security definer`, con la escala de `page_level`
  (1 ver, 2 comentar, 4 borrar ajenos o importar).
- **Versión mínima** (`20261008120000_version_minima_arbol.sql`): un trigger en `comments` rechaza con
  `app_outdated` (503) las escrituras de una versión anterior a la mínima.
- **Papelera y lectores** (`20261009120000_papelera_lectores.sql`): sobre una página en la papelera el nivel es 0 para
  Ver, Comentar y los invitados; eso alcanza a los comentarios.
- **Personas:** no hay nombres visibles; la app muestra el **correo** de cada autor (`comment_authors(página)`, que
  también se le da a un invitado: decisión de Lega). `list_members()` le da la lista entera **solo al dueño y a los
  admins**; a los demás, solo su propia fila. `list_access(proyecto, página)` dice quién ve una página, solo a quien
  puede compartirla (`private.can_share`).
- **La app** (`src/sync/comments.ts`): una cola en `<base local>:comments` (IndexedDB, versión 1, stores `meta`,
  `comments`, `outbox`, `authors`) con las operaciones `add`, `edit`, `delete`, `resolve` e `import`. La página abierta
  baja sus comentarios al abrirla y **cada 10 segundos** mientras está abierta. Los comentarios de las páginas que no
  están abiertas no se bajan: hoy nadie se entera de un comentario nuevo en otra página.
- **Una versión vieja y la cola:** una versión que no conoce una operación de la cola la da por subida sin mandarla.
  Para `import` se resolvió guardando cada una también en `meta` (`import:<id>`) hasta que el servidor la confirma
  (`Doc_Sincronizacion.md`, "Comentarios importados"). Las menciones usan el mismo recurso.
- **Realtime:** la app no lo usa. La publicación `supabase_realtime` de Wanka no tiene ninguna tabla.
- **Extensiones:** `pg_cron` y `pg_net` no están instaladas en Wanka; `supabase_vault`, sí.
- **Datos de Wanka:** 49 comentarios en 11 páginas, 47 importados de Coda; **18 tienen una `@`** y son menciones de
  Coda guardadas crudas, con la forma `@[Nombre](superhuman://users/<número>)` (ME8). Miembros activos: solo el dueño.

## 2. Lo que ve la persona

### 2.1 Escribir una mención

- En el campo de un comentario nuevo, una respuesta o una edición, escribir `@` al comienzo o después de un espacio
  abre una lista **debajo de donde se escribe** (arriba del teclado en el teléfono). Una `@` en medio de una palabra
  (`ana@wanka.tv`) no abre nada.
- La lista filtra mientras se escribe, por la parte del correo antes de la `@` y por el correo entero; muestra hasta 8
  personas: **el nombre corto en negrita** (`lega`) y el correo completo en gris. Con ↑ ↓ se elige, Enter o Tab la
  pone, Esc cierra la lista sin borrar lo escrito; con el mouse, un clic. Estas teclas van al registro
  `src/ui/shortcuts.ts` con su texto de ayuda, como pide la prueba del registro.
- Elegir a alguien escribe **`@lega `** (con un espacio) en el texto. El campo sigue siendo el `<textarea>` de hoy;
  detrás tiene una copia del texto que pinta cada mención elegida con el color de las menciones (la técnica de la capa
  de fondo), así se ve cuál quedó mencionada mientras se escribe.
- La app recuerda a quién se eligió y con qué rótulo. **Al mandar, queda mencionado solo quien sigue apareciendo como
  `@rótulo` en el texto**: borrar `@lega` del texto saca la mención. Escribir `@lega` a mano, sin elegirlo de la
  lista, es solo texto (no avisa).
- **El rótulo** es la parte del correo antes de la `@`, hasta 64 caracteres. Dos personas con la misma parte
  (`ana@wanka.tv` y `ana@cliente.com`) se distinguen en la lista por el correo y en el comentario por el tooltip
  (`data-tip`) con el correo; la base guarda a cada una por su id.
- Mencionarse a uno mismo no avisa (la base lo descarta).
- Tope: **20 personas por comentario**. La lista deja de ofrecer más y lo dice: *Up to 20 people per comment*.
- **Sin coincidencias:** *No one with access matches*. En la entrega 2, si quien escribe es dueño o admin y puede
  compartir la página, debajo aparece la segunda parte de ME2.

### 2.2 Cómo se ve en el comentario

- En el panel, cada `@rótulo` de una persona mencionada se pinta con el color de las menciones; el tooltip
  (`data-tip`) dice el correo. Si la mencionada es quien mira, más fuerte (como «te nombraron»).
- Si el autor mencionó a alguien que la base descartó (no ve la página, o un invitado que no lo tenía en su lista),
  **solo el autor** ve debajo del comentario: *lucia wasn't notified.* (sin decir por qué: para un invitado el motivo
  puede ser su lista corta y no la página).
- Un comentario editado por una versión vieja de la app puede haber perdido el `@rótulo` del texto: la mención sigue
  (el aviso ya se mandó) y simplemente no se pinta.

### 2.3 La campana

- **Dónde** (ME6): en la barra de arriba, a la derecha, antes del botón de buscar en la página; en el teléfono,
  también en la barra de arriba (la ruta de la página se achica primero). Está siempre, haya o no una página abierta.
- **El número:** un círculo con las menciones sin leer, de 1 a 9, y *9+* desde 10: la base cuenta **hasta 10** y no
  más (contar todas cuesta en proporción a lo sin leer: 186 ms con 1000; con el tope, 2,35 ms). Sin ninguna, la
  campana sola, sin círculo. El tooltip dice *Mentions* y, si hay, *3 unread* (o *9+ unread*); no repite el ícono.
- **La lista** (un panel que cae desde la campana; en el teléfono, una hoja como la de comentarios), de la más nueva a
  la más vieja:
  - quién (`lega`), el título de la página y, si es de otro proyecto, su nombre en gris;
  - el comienzo del comentario (hasta 280 caracteres, con las menciones pintadas);
  - cuándo (*5 min ago*) y un punto si no se leyó;
  - si el hilo está resuelto, *Resolved* en gris;
  - si la página está en la papelera (solo le pasa a quien edita: a los demás la mención les desaparece), *In trash*
    en gris, con el árbol local de la app.
- **Abrir una mención:** la app va a la página (cambia de proyecto si hace falta, como un link interno), abre el panel
  de comentarios en ese hilo (`showComments({ kind: 'thread', … })`) y la marca leída.
- **Marcar leídas:** abrir una la marca; ver el hilo en el panel marca las de ese hilo; *Mark all as read* arriba de
  la lista. No hay *Mark as unread* en la entrega 1.
- **El botón de comentarios de la página** suma un punto si en esa página hay una mención sin leer para quien mira.
- **Vacía:** *No mentions yet. When someone writes @ and your name in a comment, it shows up here.*
- **Abrir la campana no baja todo de nuevo:** pide lo cambiado desde la última vez y un índice liviano (sección 5.1).
- **Sin red:** la lista guardada, con *Offline · checked 10:42* arriba. Abrir una mención funciona si la página está
  en el dispositivo; marcar leídas se guarda y sale al volver la red.
- **Ayuda:** una entrada nueva en la ayuda (*Mention someone in a comment*) en inglés y castellano
  (`src/help/entries.ts`, `src/i18n/lazy/help.ts`), las teclas de la lista en el registro, y un paso o una línea en la
  recorrida si la recorrida muestra los comentarios.

## 3. Cómo se guarda

### 3.1 El texto: plano, sin marcas (ME4)

El comentario sigue guardando texto plano: `@lega fijate la toma 12`. Quién es `@lega` lo dice la tabla
`comment_mentions` (una fila por comentario y persona, con el rótulo que se usó). Así:

- **Una versión vieja de la app** muestra `@lega fijate la toma 12`, que se entiende. Puede editar el comentario
  (`edit_comment` no cambia) y responder; no puede crear menciones. No hace falta subir `min_app_version`.
- **No se descompone nada**: las menciones de Coda que hoy se ven crudas (`@[Nombre](superhuman://…)`) muestran lo
  que pasa con una marca dentro del texto: una versión que no la conoce la muestra tal cual.
- **Pintar** es buscar en el texto, para cada mención activa del comentario, `@` + rótulo seguido de un espacio, un
  signo o el final. Si no está, no se pinta (la mención igual existe).

### 3.2 La tabla `comment_mentions`

Una fila por comentario y persona mencionada: `comment_id`, `page_id` (el del comentario, con la misma clave compuesta
que usan las respuestas), `user_id` (la mencionada), `mentioned_by`, `label`, `created_at`, `updated_at`,
`removed_at` (se sacó al editar), `read_at` (la mencionada la leyó). Sin acceso directo desde la API: todo pasa por
funciones (sección 7).

- **Agregar o cambiar** las menciones de un comentario es una sola función que recibe **el conjunto entero**
  (`set_comment_mentions(comentario, [{user_id, label}])`): las nuevas se agregan, las que faltan se marcan
  `removed_at`, las que vuelven se reactivan conservando `read_at` (no se avisa dos veces). Repetir el mismo conjunto
  no cambia nada: es idempotente, como pide la cola.
- **Quién puede:** solo el autor del comentario, con Comentar (2) en la página, con el comentario sin borrar y con la
  versión de la app permitida. Cada persona del conjunto pasa por `private.mention_allowed` (sección 4); las que no
  pasan se descartan **sin error** y la función devuelve las aceptadas.
- **`list_comments`** suma al final la columna `mentions` (las activas, `[{user_id, label}]`; vacía si el comentario
  se borró) y `comment_authors` suma a las mencionadas en comentarios **sin borrar**, para mostrar su correo en el
  tooltip (a un invitado eso le muestra el correo de alguien del equipo que lo nombraron delante de él: ver ME3). Cambiar una mención sube
  el `updated_at` del comentario, así los demás dispositivos lo bajan con su sincronización de siempre.

### 3.3 La cola en el dispositivo

- Operación nueva **`mentions`** `{ id: comentario, pageId, mentions: [{ userId, label }], at }` en la cola de
  siempre, detrás del `add` o del `edit` del comentario. Antes de guardar, se junta con una `mentions` del mismo
  comentario que todavía no salió (queda la última). Cuenta como cambio pendiente.
- **Una versión vieja que toma la cola** daría la operación `mentions` por subida sin mandarla. Como con `import`,
  cada una queda también en `meta` (`mentions:<id del comentario>`) hasta que el servidor la confirma; al abrir, si lo
  guardado ahí no coincide con lo que bajó (`mentions` de `list_comments`) y ya no está en la cola, vuelve a la cola.
- La base local de comentarios **no cambia de versión** (una versión vieja no podría abrirla): todo lo nuevo va en
  stores que ya existen (`outbox`, `meta`).
- **Rechazos:** `comment_denied`, `not_allowed` y `app_outdated` se tratan como hoy (a la vista, con *Retry* y
  *Discard…*). `comment_not_found` y `comment_deleted` sobre una operación `mentions` se **descartan en silencio** (el
  comentario ya no está o no se ve: la persona no puede arreglar nada), y se borra su copia en `meta`. Que la base
  descarte a alguien no es un rechazo (2.2).
- **Un comentario que se borra antes de subir** se lleva su `mentions` y su copia en `meta` (si su alta no viaja,
  tampoco sus menciones). La copia en `meta` se borra siempre que el servidor confirma o descarta la operación, como
  `import`: así un descarte no la vuelve a poner en la cola en cada apertura.
- **Restaurar una copia:** lo propio que vuelve a la cola vuelve con su `mentions` (la de `meta`, o la que bajó antes).

## 4. A quién se puede mencionar

`private.mention_allowed(página, quien escribe, mencionada)` es la única regla, la usan la lista y la escritura:

1. La mencionada no es quien escribe, es **miembro activo** del workspace y **ve la página** (`user_page_level ≥ 1`,
   con la regla de la papelera): ME1.
2. Si quien escribe es **dueño o admin**: cualquiera que cumpla 1 (ya ven a todo el workspace con `list_members`).
3. Si quien escribe es **miembro**: el **equipo** (miembros, admins y el dueño) que cumple 1; un **invitado** solo si
   ya **participa en los comentarios de esa página** (escribió, resolvió o importó alguno sin borrar). Es lo seguro
   mientras Lega decide ME10: hoy un miembro que no puede compartir no sabe qué clientes ven una página (eso lo dice
   `list_access`, solo a quien puede compartirla), y la lista no se lo cuenta.
4. Si quien escribe es **invitado** (`guest`): quien participa en los comentarios de esa página **o le compartió
   algo** (es `granted_by` de un permiso activo suyo, o le mandó la invitación con la que entró): ME3.

`mention_candidates(página)` devuelve a quienes cumplen eso, con su correo y su rótulo. Pide Comentar (2) en la página:
con Ver no se comenta, así que no hace falta la lista. **En la entrega 2**, al dueño y a los admins que pueden compartir
la página les suma a los miembros activos que **no** la ven (`has_access = false`) para ME2; nadie más los recibe, ni un
miembro común que sea dueño de un proyecto (ver la nota del borrador, sección 7).

Lo que ve cada uno:

| Quien escribe | Ve en la lista | Lo que no ve |
|---|---|---|
| Dueño o admin | Todos los que ven la página; en la entrega 2, también el resto del workspace (para compartir) | — |
| Miembro con Comentar o más | El equipo que ve la página y los clientes que ya comentaron en ella (ME10: lo seguro mientras tanto) | Los clientes de la página que no comentaron; los miembros que no la ven |
| Invitado | Los que participan en los comentarios de esa página y quien le compartió algo, si ven la página | El resto del equipo y los demás invitados |
| Visitante de un link | Nada: no hay lista (ME7) | — |

**Por qué el invitado no ve al resto:** un cliente no tiene por qué conocer al equipo entero ni a los otros clientes;
con lo que ya ve en la conversación alcanza para responderle a quien le habló. **Por qué un miembro no ve, por ahora, a
los clientes que no comentaron:** hoy no lo sabe, y contárselo es ampliar quién ve a quién; queda para Lega (ME10).

**Lo que la base no filtra:** un miembro que conoce el id de alguien puede llamar a `set_comment_mentions` y saber, por
la respuesta, si esa persona pasa la regla; es lo mismo que ya le dice la lista. A un invitado, toda persona fuera de
su lista se le descarta igual, la vea o no: la respuesta no le dice nada nuevo. Un miembro que menciona a un cliente
que no comentó recibe el mismo descarte, vea o no la página.

## 5. El aviso: cómo llega

### 5.1 Consulta cada 60 segundos, sin Realtime (ME5)

- `mentions_inbox(desde, tope)` devuelve, en una sola llamada, **el número de menciones sin leer que la persona puede
  ver, contado hasta 10** (la campana muestra *9+*), y las filas que cambiaron desde la fecha que manda la app
  (`updated_at`, con un margen como en `list_comments`; hasta 30, como mucho 50), más la hora del servidor para el
  próximo pedido. Una fila que ya no se ve llega solo con `id`, `gone` y `updated_at`.
- La app pregunta **al abrir, cada 60 segundos con la ventana a la vista, al volver a la ventana, al volver la red y
  después de subir un comentario propio**. Con la ventana oculta, no pregunta.
- **Lo que deja de verse** (le sacan el permiso, la página va a la papelera, se borra el comentario) no cambia la
  fila de la mención. Lo concilia `mentions_index()`: las últimas 200 menciones como `[id, gone, leída]`, sin texto
  (unos 10 KB). La app lo pide **cuando el número de la base no coincide con el suyo** (los dos contados hasta 10) y
  **al abrir el panel de la campana**; saca las `gone` y corrige las leídas. Abrir la campana **no** vuelve a bajar los
  textos: los tiene guardados, y pide solo lo cambiado. La lista con textos desde cero (`desde` nulo, 30 filas) se
  pide solo con la caché vacía (un dispositivo nuevo, después de salir de la cuenta).
- **Cuánto cuesta en el plan gratis:** una pregunta sin novedades devuelve unos 70 bytes de datos (medido; unos 600
  con los encabezados). Diez horas con la app a la vista son 600 preguntas, unos 360 KB por persona y por día; abrir la
  campana 10 veces, unos 100 KB más (el índice). 20 personas: unos 9 MB por día, **0,3 GB por mes**, contra 5 GB de
  egress. Una caché vacía baja 30 filas (unos 24 KB). En la base, la pregunta es una búsqueda por índice
  (`user_id, updated_at`) más el permiso de, como mucho, 10 filas sin leer: 2,35 ms aunque haya 1000 sin leer.
- **Por qué no Realtime:** la tabla no se lee desde la API (Postgres Changes necesita darle `select`), y Broadcast
  desde la base pide políticas en `realtime.messages`, una conexión abierta por cada app (200 a la vez en el plan
  gratis) y manejar reconexiones; para un aviso que puede tardar un minuto no se justifica. Si algún día hace falta, la
  tabla no cambia: se suma un Broadcast al final de `set_comment_mentions`.

### 5.2 Varios workspaces

La app pregunta solo al workspace abierto (cada uno es una isla, con su sesión). Al cambiar de workspace, pregunta al
nuevo enseguida. Avisar de otros workspaces sin abrirlos queda para el correo (entrega 3).

### 5.3 Leídas

- `mark_mentions_read(ids, hasta)` marca leídas las propias: las de la lista de ids, o todas las creadas hasta esa
  fecha (*Mark all as read*). Sube `updated_at`, así los demás dispositivos de la persona se enteran en su próxima
  pregunta.
- En el dispositivo, las marcas se guardan primero en `meta` (`inbox:read`) y salen cuando hay red; repetirlas no
  cambia nada. **No cuentan** en los cambios sin sincronizar: no son datos de nadie, y perderlas solo deja una mención
  sin leer.

### 5.4 Lo guardado para usar sin red

- `meta` `inbox`: hasta 200 menciones (id, comentario, página, hilo, quién, rótulo, comienzo del texto, título de la
  página, proyecto, fechas, leída), la fecha hasta la que bajó y la hora de la última pregunta.
- `meta` `mentionCandidates:<página>`: la lista de candidatos de cada página donde se abrió el campo, con la hora. Se
  refresca al abrir el panel con red (como mucho cada 5 minutos). **Sin red y sin lista guardada** se ofrecen los
  autores ya conocidos de esa página (`authors`), que la base vuelve a revisar al subir.
- Todo se borra al salir de la cuenta y al sacar el workspace, como el resto de la base de comentarios.

## 6. Visitantes del link público y comentarios importados

- **Visitantes** (`Doc_Link_Publico.md`, 3.7; ME7): comentan con un nombre y sin cuenta. No tienen lista de `@` (no
  conocen a nadie del equipo más que por lo que ven) y no se los puede mencionar (no tienen campana ni correo). Si
  escriben `@lega` queda como texto. La base lo asegura sola: las funciones `plink_*` no llaman a
  `set_comment_mentions` y `mention_allowed` exige un miembro activo.
- **El texto de un visitante** con `@rótulo` de alguien del equipo no se pinta (no hay mención), así nadie del link
  aparenta haber avisado a alguien.
- **Comentarios importados de Coda** (ME8): `import_comment` no crea menciones. Al mostrar un comentario importado, la
  forma `@[Nombre](superhuman://users/<número>)` se muestra como `@Nombre` con el color de las menciones y sin tooltip
  de correo. Es solo presentación: la base no cambia y una versión vieja la sigue viendo cruda, como hoy.

## 7. Migración (borrador, sin aplicar)

Nombre propuesto: `supabase/migrations/20261013120000_menciones.sql`. **Va después de la del link público** (rama
`lega/link-publico-impl`, que sube `schema_version` a 14 y desde ahí la app ofrece *Anyone with the link*): esta sube a
**15** y la app usa `MENTIONS_SCHEMA_VERSION = 15`, sin subir `DB_SCHEMA_VERSION`: con la base sin migrar, no muestra la
campana ni la lista y el `@` es texto. Si las dos compartieran el número, una app nueva prendería la campana sobre una
base sin menciones (o el link sobre una base sin `public_links`). Las dos cambian lo que devuelve `list_comments` con
`drop` y `create`: la de menciones se escribe **sobre el cuerpo del link público** (con `plink_id` y `plink_author`) y
suma `mentions` al final, repitiendo sus `grant`.

```sql
-- LGA Shot Docs · menciones en comentarios (P.21; Docs/Doc_Menciones.md). Va después del link público (schema 14).
--
-- Una mención es una fila de `comment_mentions`: quién fue mencionado en qué comentario, con el rótulo que se escribió
-- (`@lega`). El texto del comentario no cambia de forma: sigue siendo texto plano, y una versión vieja de la app ve
-- `@lega` como texto. Nadie lee ni escribe la tabla desde la API: todo pasa por funciones.
--
-- Permisos: la regla única es `private.mention_allowed` (miembro activo que ve la página; los invitados mencionados o
-- que mencionan, con condiciones: ver la sección 4 del doc). Escribe solo el autor del comentario, con Comentar. Cada
-- uno lee solo sus menciones, y solo mientras ve la página. Nada se borra.
--
-- Compatible con la app publicada: suma una tabla y funciones, y una columna al final de `list_comments` (que la app
-- publicada ignora).

create table public.comment_mentions (
  id           uuid primary key default gen_random_uuid(),
  comment_id   uuid not null,
  page_id      uuid not null references public.pages (id),
  user_id      uuid not null references auth.users (id) on delete cascade,
  mentioned_by uuid references auth.users (id) on delete set null,
  label        text not null check (char_length(label) between 1 and 64 and label !~ '[[:space:][:cntrl:]@]'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  removed_at   timestamptz,                       -- se sacó del comentario al editarlo
  read_at      timestamptz,                       -- la mencionada la leyó
  constraint comment_mentions_comment_fk foreign key (comment_id, page_id) references public.comments (id, page_id),
  constraint comment_mentions_once unique (comment_id, user_id)
);
create index comment_mentions_inbox_idx on public.comment_mentions (user_id, updated_at);
create index comment_mentions_unread_idx on public.comment_mentions (user_id, created_at)
  where read_at is null and removed_at is null;

alter table public.comment_mentions enable row level security;
revoke all on public.comment_mentions from public, anon, authenticated;
-- Sin políticas ni permisos: la API no la lee ni la escribe.

-- ¿`caller` puede mencionar a `target` en la página `p`? (Docs/Doc_Menciones.md, sección 4.)
--   - Siempre: miembro activo que ve la página, y no es uno mismo.
--   - Dueño o admin: a cualquiera que la vea (ya ven a todo el workspace con `list_members`).
--   - Miembro: al equipo que ve la página; a un invitado, solo si ya participa en sus comentarios (ME10, mientras
--     tanto).
--   - Invitado: a quien participa en los comentarios de la página o le compartió algo (ME3).
create function private.mention_allowed(p uuid, caller uuid, target uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  caller_role text := private.workspace_role(caller);   -- mira la sesión si caller es quien llama
  target_role text := private.workspace_role(target);
begin
  if target is null or caller is null or target = caller or caller_role is null or target_role is null
     or private.user_page_level(p, target) < 1 then
    return false;
  end if;
  if caller_role in ('owner', 'admin') or (caller_role <> 'guest' and target_role <> 'guest') then
    return true;
  end if;
  -- Queda: un miembro que menciona a un invitado, o un invitado que menciona a cualquiera.
  if exists (select 1 from public.comments c
             where c.page_id = p and c.deleted_at is null
               and target in (c.author_id, c.resolved_by, c.imported_by)) then
    return true;
  end if;
  return caller_role = 'guest' and (
    exists (select 1 from public.grants g
            where g.user_id = caller and g.revoked_at is null and g.granted_by = target)
    or exists (select 1 from public.invitations i where i.used_by = caller and i.invited_by = target));
end;
$$;
revoke all on function private.mention_allowed(uuid, uuid, uuid) from public, anon, authenticated;

-- El rótulo que propone la lista: la parte del correo antes de la @, sin lo que el rótulo no admite.
create function private.mention_label(email text)
returns text
language sql immutable set search_path = ''
as $$
  select coalesce(nullif(left(regexp_replace(split_part(email, '@', 1), '[[:space:][:cntrl:]"@]', '', 'g'), 64), ''),
                  'user');
$$;
revoke all on function private.mention_label(text) from public, anon, authenticated;

-- La lista del `@`: quienes `mention_allowed` deja. Pide Comentar. (La parte "sin acceso" de ME2 llega con la
-- entrega 2, solo para el dueño y los admins: ver la nota de abajo.)
create function public.mention_candidates(p_page_id uuid)
returns table (user_id uuid, email text, label text, has_access boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  lvl int := private.page_level(p_page_id);
begin
  if lvl < 1 then raise exception 'page_not_found' using errcode = 'P0002'; end if;
  if lvl < 2 then raise exception 'comment_denied' using errcode = '42501'; end if;
  return query
    select m.user_id, u.email::text, private.mention_label(u.email::text), true
    from public.members m join auth.users u on u.id = m.user_id
    where m.removed_at is null and private.mention_allowed(p_page_id, uid, m.user_id)
    order by 2;
end;
$$;

-- Las menciones de un comentario propio: el conjunto entero. Devuelve los ids aceptados.
-- Errores: `mentions_invalid` (22023), `comment_not_found` (P0002), `not_allowed` y `comment_denied` (42501),
-- `comment_deleted` (P0001), `app_outdated` (503, por la versión mínima).
create function public.set_comment_mentions(p_comment_id uuid, p_mentions jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid      uuid := auth.uid();
  cur      public.comments;
  lvl      int;
  e        jsonb;
  target   uuid;
  lbl      text;
  wanted   uuid[] := '{}';
  accepted uuid[] := '{}';
  changed  boolean := false;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_mentions is null or jsonb_typeof(p_mentions) <> 'array' or jsonb_array_length(p_mentions) > 20
     or length(p_mentions::text) > 4000 then
    raise exception 'mentions_invalid' using errcode = '22023';
  end if;
  -- La forma de cada una, también el rótulo (1 a 64, sin espacios, controles ni @), antes de escribir nada.
  for e in select x from jsonb_array_elements(p_mentions) x loop
    if jsonb_typeof(e) <> 'object' or (select count(*) from jsonb_object_keys(e)) <> 2
       or coalesce(e ->> 'user_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(e -> 'label') is distinct from 'string'
       or char_length(btrim(e ->> 'label')) not between 1 and 64
       or btrim(e ->> 'label') ~ '[[:space:][:cntrl:]@]' then
      raise exception 'mentions_invalid' using errcode = '22023';
    end if;
    wanted := wanted || (e ->> 'user_id')::uuid;
  end loop;

  select * into cur from public.comments c where c.id = p_comment_id;
  -- El reintento de algo que ya está (mismo conjunto activo) da bien antes de mirar el permiso, como `add_comment`.
  if found and cur.author_id = uid and cur.deleted_at is null and not exists (
       select 1 from public.comment_mentions m where m.comment_id = cur.id and m.removed_at is null
         and not (m.user_id = any (wanted)))
     and not exists (select 1 from unnest(wanted) w where w <> uid and not exists (
       select 1 from public.comment_mentions m where m.comment_id = cur.id and m.user_id = w and m.removed_at is null)) then
    return coalesce((select jsonb_agg(m.user_id) from public.comment_mentions m
                     where m.comment_id = cur.id and m.removed_at is null), '[]'::jsonb);
  end if;

  if found then lvl := private.page_level(cur.page_id); end if;
  if coalesce(lvl, 0) < 1 then raise exception 'comment_not_found' using errcode = 'P0002'; end if;
  if cur.author_id is distinct from uid then
    raise exception 'not_allowed' using errcode = '42501', hint = 'Only the author sets the mentions of a comment.';
  end if;
  if lvl < 2 then raise exception 'comment_denied' using errcode = '42501'; end if;
  if cur.deleted_at is not null then raise exception 'comment_deleted' using errcode = 'P0001'; end if;
  perform private.require_session_write_version();

  for e in select x from jsonb_array_elements(p_mentions) x loop
    target := (e ->> 'user_id')::uuid;
    lbl := btrim(e ->> 'label');
    continue when target = any (accepted) or not private.mention_allowed(cur.page_id, uid, target);
    insert into public.comment_mentions (comment_id, page_id, user_id, mentioned_by, label)
    values (cur.id, cur.page_id, target, uid, lbl)
    on conflict (comment_id, user_id) do update
      set removed_at = null, label = excluded.label, updated_at = now()
      where public.comment_mentions.removed_at is not null or public.comment_mentions.label <> excluded.label;
    changed := changed or found;
    accepted := accepted || target;
  end loop;

  update public.comment_mentions set removed_at = now(), updated_at = now()
  where comment_id = cur.id and removed_at is null and not (user_id = any (accepted));
  changed := changed or found;

  -- Los demás dispositivos bajan el comentario con su `mentions` nuevo.
  if changed then
    update public.comments set updated_at = now() where id = cur.id;
  end if;
  return to_jsonb(accepted);
end;
$$;

-- La campana: el número sin leer que la sesión puede ver, contado HASTA 10 (la campana muestra 9+), y lo cambiado
-- desde `p_since`, hasta `p_limit` filas (30 por defecto, 50 como mucho). Una fila que ya no se ve llega solo con
-- `id`, `gone` y `updated_at`.
create function public.mentions_inbox(p_since timestamptz default null, p_limit int default 30)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or private.workspace_role() is null then
    return jsonb_build_object('now', now(), 'unread', 0, 'rows', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'now', now(),
    'unread', (select count(*) from (
                 select 1 from public.comment_mentions m join public.comments c on c.id = m.comment_id
                 where m.user_id = uid and m.read_at is null and m.removed_at is null and c.deleted_at is null
                   and private.user_page_level(m.page_id, uid) >= 1
                 order by m.created_at desc
                 limit 10) t),
    'rows', coalesce((
      select jsonb_agg(r.j order by r.updated_at desc) from (
        select m.updated_at,
               case when v.gone then jsonb_build_object('id', m.id, 'gone', true, 'updated_at', m.updated_at)
               else jsonb_build_object(
                 'id', m.id, 'gone', false, 'updated_at', m.updated_at, 'created_at', m.created_at,
                 'read_at', m.read_at, 'comment_id', m.comment_id, 'page_id', m.page_id,
                 'thread_id', c.thread_id, 'block_id', c.block_id, 'label', m.label,
                 'mentioned_by', m.mentioned_by,
                 'mentioned_by_email', (select u.email::text from auth.users u where u.id = m.mentioned_by),
                 'snippet', left(c.body, 280),
                 'resolved', c.resolved_at is not null
                   or exists (select 1 from public.comments t where t.id = c.thread_id and t.resolved_at is not null),
                 'page_title', pg.title, 'project_id', pg.workspace_id)
               end as j
        from public.comment_mentions m
        join public.comments c on c.id = m.comment_id
        join public.pages pg on pg.id = m.page_id
        cross join lateral (select m.removed_at is not null or c.deleted_at is not null
                                   or private.user_page_level(m.page_id, uid) < 1 as gone) v
        where m.user_id = uid and (p_since is null or m.updated_at >= p_since)
        order by m.updated_at desc
        limit least(greatest(coalesce(p_limit, 30), 1), 50)) r), '[]'::jsonb));
end;
$$;

-- El índice liviano para conciliar lo guardado en el dispositivo: las últimas 200 menciones (por fecha de creación),
-- cada una como [id, gone, leída]. Sin texto ni títulos.
create function public.mentions_index()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or private.workspace_role() is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_array(r.id, r.gone, r.read) order by r.created_at desc) from (
      select m.id, m.created_at, m.read_at is not null as read,
             m.removed_at is not null or c.deleted_at is not null
               or private.user_page_level(m.page_id, uid) < 1 as gone
      from public.comment_mentions m join public.comments c on c.id = m.comment_id
      where m.user_id = uid
      order by m.created_at desc
      limit 200) r), '[]'::jsonb);
end;
$$;

-- Marca leídas las menciones propias: las de `p_ids` o todas hasta `p_up_to`. Devuelve cuántas cambió.
create function public.mark_mentions_read(p_ids uuid[], p_up_to timestamptz default null)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  if auth.uid() is null or private.workspace_role() is null then return 0; end if;
  if coalesce(cardinality(p_ids), 0) > 500 then raise exception 'ids_invalid' using errcode = '22023'; end if;
  update public.comment_mentions set read_at = now(), updated_at = now()
  where user_id = auth.uid() and read_at is null
    and (id = any (coalesce(p_ids, '{}')) or (p_up_to is not null and created_at <= p_up_to));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- `list_comments` suma `mentions` al final (cambia lo que devuelve: se borra y se crea en la misma transacción) y
-- `comment_authors` suma a las mencionadas. Cuerpos: los del link público (con `plink_id`, `plink_author`) con esto
-- agregado, y sus `grant` repetidos:
--   , case when c.deleted_at is null then coalesce((
--       select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'label', m.label) order by m.created_at)
--       from public.comment_mentions m where m.comment_id = c.id and m.removed_at is null), '[]'::jsonb) end
--   y en comment_authors: union select m.user_id from public.comment_mentions m
--                          join public.comments c on c.id = m.comment_id
--                          where m.page_id = p_page_id and m.removed_at is null and c.deleted_at is null

revoke all on function public.mention_candidates(uuid) from public, anon;
revoke all on function public.set_comment_mentions(uuid, jsonb) from public, anon;
revoke all on function public.mentions_inbox(timestamptz, int) from public, anon;
revoke all on function public.mentions_index() from public, anon;
revoke all on function public.mark_mentions_read(uuid[], timestamptz) from public, anon;
grant execute on function public.mention_candidates(uuid) to authenticated;
grant execute on function public.set_comment_mentions(uuid, jsonb) to authenticated;
grant execute on function public.mentions_inbox(timestamptz, int) to authenticated;
grant execute on function public.mentions_index() to authenticated;
grant execute on function public.mark_mentions_read(uuid[], timestamptz) to authenticated;

update public.workspace_settings set schema_version = 15 where id and schema_version < 15;
notify pgrst, 'reload schema';
```

Notas del borrador para quien lo programe:

- `mention_allowed` llama a `workspace_role(caller)`, que para la sesión mira `session_allowed` (una sesión con
  contraseña no menciona ni ve la campana).
- **La parte «sin acceso» de ME2 (entrega 2)** se suma a `mention_candidates` como un `union all` con
  `has_access = false` y la condición
  `private.workspace_role() in ('owner', 'admin') and private.can_share(null, p_page_id)`: **solo el dueño y los
  admins**, que ya ven a todo el workspace con `list_members`. `can_share` sola no alcanza: es verdadera para un
  miembro común que es dueño de un proyecto (pasa cuando a un admin que creó proyectos lo bajan a miembro), y le daría
  el correo de todo el workspace, que hoy no puede ver (lo encontró la auditoría).
- El reintento idempotente compara conjuntos **ignorando a uno mismo** (que se descarta siempre); si la primera vez se
  descartó a alguien por permisos, el reintento no es idéntico y pasa por los permisos de nuevo, que es lo correcto.
  El rótulo no entra en la comparación: con las mismas personas y otro rótulo, el reintento no lo cambia (solo es lo
  que se pinta, y el texto lo vuelve a decir).
- `mentioned_by_email` va en la campana para mostrar quién mencionó: es alguien que escribió en esa página, cuyo
  correo la persona ya ve por `comment_authors`.
- `mentions_inbox` y `mentions_index` son `stable` y no escriben. El conteo con tope cuesta 2,35 ms aunque haya 1000
  sin leer (sin tope, 186 ms; medido por la auditoría).
- La versión mínima se mira en `set_comment_mentions` (escribe sobre un comentario); `mark_mentions_read` no la mira
  (es el estado de la propia persona y no toca nada de otros).
- A quien sacan del workspace la campana le devuelve vacío (no `gone`); lo guardado en su dispositivo lo borra la
  limpieza de siempre al sacarlo, que incluye la base de comentarios.

## 8. Pruebas

### 8.1 Pruebas de permisos (`supabase/tests/menciones_permisos.sql`, en `begin … rollback`)

Con el header de versión (sin él, con la mínima de Wanka, hoy 0.104, la base rechaza con `app_outdated`). El
escenario de la auditoría sirve de base (dueña, admin, miembros con Ver, Comentar y Editar y crear, dos invitadas, un
miembro sin nada y un miembro común dueño de otro proyecto). Casos:

1. Un miembro con Comentar menciona a otro miembro que ve la página: se crea la fila; la campana de la mencionada da
   `unread = 1` con el texto y el título.
2. Mencionar a alguien que no ve la página: se descarta (no está en lo devuelto ni en la tabla).
3. Un invitado menciona a un miembro que ve la página pero no participa ni le compartió nada: descartado; a uno que
   comentó en la página: aceptado; a quien le compartió la página: aceptado; a otro invitado de la misma página que no
   comentó: descartado.
4. Un **miembro** menciona a una invitada que ve la página pero **nunca comentó**: descartada; a una que comentó:
   aceptada (ME10, lo seguro). El **dueño o un admin**, a la que nunca comentó: aceptada.
5. `mention_candidates`: un invitado recibe solo su lista corta; un miembro, el equipo que ve la página y las
   invitadas que comentaron (no la que nunca comentó); el dueño y los admins, todos los que la ven; **nadie** recibe
   filas `has_access = false` en la entrega 1, tampoco **un miembro común dueño de un proyecto** (que hoy recibe 1
   fila de `list_members`); con Ver, `comment_denied`; sin acceso, `page_not_found`. En la entrega 2: las filas
   `false` solo para el dueño y los admins que pueden compartir.
6. `set_comment_mentions` sobre un comentario ajeno: `not_allowed`; sobre uno borrado: `comment_deleted`; con 21
   personas, una forma mala o un rótulo con espacio, vacío o de más de 64: `mentions_invalid` (nunca 23514);
   mencionarse a uno mismo: descartado.
7. Repetir el mismo conjunto no cambia `updated_at` ni de la mención ni del comentario; el reintento con el permiso
   ya bajado (mismo conjunto) da bien.
8. Sacar a alguien del conjunto marca `removed_at` y su campana deja de contarla; volver a ponerlo la reactiva con
   `read_at` intacto.
9. Después de mencionar: sacarle el permiso a la mencionada, mover la página fuera de su rama, mandarla a la papelera
   (siendo invitada o con Ver): `unread = 0`, la fila llega solo con `id`, `gone` y `updated_at`, y
   `mentions_index` la da `gone`. Sacarla del workspace: campana vacía.
10. Borrar el comentario: `gone`; `list_comments` da `mentions` nulo; `comment_authors` ya no da a la mencionada por
    ese comentario.
11. Con 15 sin leer, `unread` da 10 (el tope).
12. `mark_mentions_read` con ids de otra persona no cambia nada; con `p_up_to`, solo las propias hasta esa fecha.
13. Nadie lee la tabla (`select` da 42501) ni la escribe; `anon` no ejecuta ninguna de las funciones.
14. `list_comments` devuelve las columnas del link público y después `mentions` con las activas; `comment_authors`
    incluye a las mencionadas en comentarios sin borrar.
15. Sin header y con la mínima en 0.104: `set_comment_mentions` da `app_outdated`; el reintento idéntico da bien sin
    escribir; `mark_mentions_read` anda.
16. `import_comment` no crea menciones aunque el texto tenga `@rótulo`.
17. Una sesión con contraseña: `mention_candidates` da `page_not_found` y la campana, vacía.
18. La rama de `invitations.invited_by`: una invitada que entró con la invitación de un miembro puede mencionarlo
    aunque él no le haya compartido nada después (la auditoría no la armó).

**Mutantes** (cada uno tiene que hacer fallar al menos una prueba): sacar la condición del invitado en
`mention_allowed` (3, 5); sacar la condición del miembro que menciona a una invitada (4, 5); sacar
`user_page_level(p, target)` (2); sacar el filtro de permiso en `mentions_inbox` o en `mentions_index` (9); sacar el
`limit 10` del conteo (11); sacar `user_id = auth.uid()` en `mark_mentions_read` (12); sacar la comparación de autor
en `set_comment_mentions` (6); sacar la validación del rótulo en el primer bucle (6); en la entrega 2, sacar
`workspace_role() in ('owner', 'admin')` de las filas sin acceso (5).

### 8.2 Pruebas de la app (vitest, con el servidor falso de `src/sync/testing.ts`)

- La cola: `mentions` detrás del `add`, se junta con la anterior sin mandar, cuenta como pendiente, sale en el orden
  correcto y se reintenta sin duplicar.
- **Versión vieja:** con la cola de la versión publicada (`src/sync/fixtures/v098/comments.ts`) que descarta la
  operación `mentions`, la versión nueva la recupera desde `meta` al abrir.
- El campo: `@` al comienzo y después de un espacio abre la lista; en `ana@wanka.tv`, no; ↑ ↓ Enter Tab Esc; borrar el
  `@rótulo` saca la mención; escribir el rótulo a mano no menciona; tope de 20.
- Pintar: un comentario con menciones activas, uno editado por una versión vieja (sin el rótulo), uno de un visitante
  con `@` (no se pinta) y uno importado con la forma de Coda (`@Nombre`).
- La campana: el número (con *9+*), la lista desde la caché sin red, el índice cuando el número no coincide y al
  abrirla (sin volver a bajar textos), leer una, *Mark all as read* sin red y su salida al volver la red, *In trash*.
- La cola: borrar un comentario sin subir se lleva su `mentions` y su copia en `meta`; `comment_not_found` y
  `comment_deleted` sobre `mentions` se descartan sin error a la vista y sin volver a la cola.
- Candidatos sin red: la lista guardada; sin lista guardada, los autores conocidos.
- El registro de atajos y la ayuda: las pruebas que ya existen (`src/ui/shortcuts.test.ts`, `src/help/help.test.tsx`)
  pasan con las teclas y la entrada nuevas.

## 9. Entregas

| # | Qué | Prueba de aceptación (Lega, a mano) |
|---|---|---|
| **1** | La migración y sus pruebas; `@` con la lista y el pintado; la cola `mentions` con su copia en `meta`; la campana con el número, la lista, leer y *Mark all as read*; el punto en el botón de comentarios; sin red; menciones de Coda como `@Nombre`; ayuda y atajos. | Ver abajo. |
| **2** | ME2: compartir desde la mención, **solo el dueño y los admins** que pueden compartir la página (las filas `has_access = false` de `mention_candidates` llegan en esta entrega, con su migración y sus pruebas), por `useShareGate`; un punto en el árbol de páginas para las que tienen menciones sin leer; el número en el ícono de la app instalada (`navigator.setAppBadge`) y en el título de la pestaña. | Mencionar a alguien que no ve la página, compartírsela desde la lista y que le llegue. |
| **3** | ME9: el correo, cuando Lega cargue la clave de Resend en el portero (grupo C, junto con el correo de invitaciones), con un tope propio por debajo del cupo que necesitan los códigos de login, y el pedido al portero como una operación más de la cola. Se vuelve a diseñar y auditar antes de programarla. | Mencionar y que llegue el correo con el link a la página. |

**Prueba de aceptación de la entrega 1** (Lega, con su cuenta y una cuenta de invitado de prueba que él crea):

1. Con la cuenta de Lega, abrir una página, compartirla con la cuenta de prueba como *Can comment*.
2. En esa página, abrir los comentarios, escribir `@` y ver la lista con la cuenta de prueba. Elegirla, escribir un
   texto y mandar. El `@rótulo` aparece pintado.
3. En otro navegador (o una ventana privada), entrar con la cuenta de prueba. En menos de un minuto la campana muestra
   *1*. Tocarla: aparece la mención con el título de la página. Tocar la mención: se abre la página con el hilo, y la
   campana vuelve a cero.
4. Con la cuenta de prueba, responder escribiendo `@`: la lista muestra solo a Lega (quien le compartió y comentó), no
   al resto del equipo.
5. (Si hay un miembro de prueba con Comentar en esa página.) Con el miembro, escribir `@`: la cuenta de prueba aparece
   **solo después** de que haya comentado en la página.
6. Con la cuenta de Lega, sacarle el permiso a la cuenta de prueba y mencionarla de nuevo: no aparece en la lista;
   en la otra ventana, la mención vieja desaparece de la campana en el próximo minuto.
7. Sin red (modo avión o la red cortada), escribir un comentario con una mención: queda pendiente; al volver la red,
   sube y la otra cuenta la recibe.
8. En una página importada de Coda con menciones, ver `@Nombre` pintado en vez de `@[Nombre](superhuman://…)`.

## 10. Decisiones propuestas

### ME1 · ¿A quién se puede mencionar?

**Qué pasaba:** en la página del plan de rodaje estás vos, Ana (equipo) y el cliente. Escribís `@` y la app tiene que
decidir a quién ofrecer. Si ofrece a Pedro, que no ve esa página, Pedro recibiría un aviso de algo que no puede abrir.

**Las opciones:**
- **A.** Solo a quien ya ve la página. Pedro no aparece (salvo lo de ME2).
- **B.** A cualquiera del equipo; si no ve la página, le llega el aviso pero sin el texto ("te mencionaron en una
  página que no podés ver").
- **C.** A cualquiera del equipo, y mencionarlo le comparte la página sola.

**Elegí A** porque una mención nunca da ni insinúa acceso ("nunca lo de arriba"), y el aviso siempre se puede abrir.
B filtra que la página existe; C comparte sin que nadie lo decida.

**Si preferís otra:** B es sumar filas "sin acceso" a la campana; C es llamar a `share()` desde la mención. Medio día.

### ME2 · Mencionar a alguien que no ve la página

**Qué pasaba:** querés que Pedro mire una toma, pero la página no está compartida con él. Hoy tendrías que ir a
*Share*, compartirla y volver al comentario.

**Las opciones:**
- **A.** Si sos dueño o admin y podés compartir esa página, la lista muestra a Pedro abajo, en gris (*Can't see this
  page*). Al elegirlo: *Pedro can't see this page. Share it with him (Can comment) and mention him?* → *Share and
  mention* / *Cancel*. Nadie más ve a gente de afuera de la página. Pide red. Entrega 2.
- **B.** Nunca se ofrece: primero se comparte por *Share*.
- **C.** Igual que A pero para cualquiera que comente, mandándole un pedido al dueño.

**Elegí A** porque es lo que hace Google Docs, y solo lo ve quien ya ve a todo el workspace (dueño y admins), con el
mismo aviso de "preparando la página" de la privacidad de lo borrado. (Corregido por la auditoría: con "quien puede
compartir", un miembro común dueño de un proyecto veía los correos de todo el workspace.)

**Si preferís otra:** B es no hacer la entrega 2 en esa parte. C necesita pedidos de acceso, que no existen. Abrirlo
a cualquiera que pueda compartir pide antes decidir si un miembro puede ver a todo el workspace.

### ME3 · Qué lista ve un invitado (cliente)

**Qué pasaba:** un cliente comenta en su página y escribe `@`. Si la lista le muestra a todos los que ven la página,
conoce los correos del equipo entero y de otros clientes de esa página, que hoy no ve.

**Las opciones:**
- **A.** Solo quienes ya participan en los comentarios de esa página y quien le compartió algo (si ven la página).
- **B.** Todos los que ven la página, como un miembro.
- **C.** Un invitado no menciona.

**Elegí A** porque le alcanza para responderle a quien le habló, y no le muestra a nadie que no vea ya en los
comentarios (los correos de los autores ya se le muestran, por decisión tuya).

**Ojo:** si alguien del equipo nombra a Pedro en un comentario que el cliente ve, el cliente pasa a ver el correo de
Pedro en el tooltip, aunque Pedro nunca haya escrito ahí (como ya pasa con los autores). Quien escribe decide a quién
nombra delante del cliente.

**Si preferís otra:** B es sacar una condición de `mention_allowed`; C, poner otra. Una línea cada una.

### ME4 · Cómo se guarda la mención

**Qué pasaba:** el comentario es texto plano. Hay que guardar "este `@lega` es Lega" sin que una versión vieja de la
app, abierta en otra pestaña o en el iPhone sin red, muestre algo roto. Los comentarios importados de Coda muestran hoy
lo que pasa con una marca dentro del texto: `@[Nombre](superhuman://users/123)`.

**Las opciones:**
- **A.** El texto queda `@lega` y quién es va en una tabla aparte. La versión vieja ve `@lega`.
- **B.** Una marca dentro del texto (`@[lega](user:<id>)`). La versión vieja la ve cruda, como hoy las de Coda.
- **C.** Guardarla dentro de la página (en el documento). Haría falta un tipo nuevo, que una versión vieja borra.

**Elegí A** porque no rompe nada en ninguna versión y no obliga a subir la versión mínima.

**Si preferís otra:** B es más simple de programar pero hay que subir la mínima; C no se recomienda.

### ME5 · Cómo se entera la app de una mención nueva

**Qué pasaba:** Ana te menciona en otra página. Hoy la app solo baja los comentarios de la página que tenés abierta,
cada 10 segundos.

**Las opciones:**
- **A.** Preguntar cada 60 segundos con la app a la vista (y al volver a la ventana o la red), con el número contado
  hasta 10 (*9+*) y abrir la campana sin volver a bajar los textos. Unos 0,3 GB por mes con 20 personas, contra 5 GB
  del plan gratis.
- **B.** Realtime de Supabase: el aviso llega en el acto, pero cada app abierta deja una conexión (200 a la vez en el
  plan gratis) y suma políticas y reconexiones.
- **C.** Preguntar solo al abrir la app.

**Elegí A** porque un aviso que tarda hasta un minuto alcanza para comentarios y casi no gasta. Si algún día hace
falta al instante, se suma B sin cambiar la tabla. (La auditoría midió que contar todas las no leídas cuesta 186 ms con
1000, y bajar la lista entera al abrir la campana, 157 KB: por eso el tope y el índice liviano.)

**Si preferís otra:** cambiar 60 por 30 segundos es una constante; B, dos o tres días.

### ME6 · Dónde aparece el aviso

**Qué pasaba:** tenés que ver que te mencionaron estés en la página que estés, también en el teléfono.

**Las opciones:**
- **A.** Una campana en la barra de arriba con el número sin leer; al tocarla, la lista; abrir una lleva al hilo y la
  marca leída. Además, un punto en el botón de comentarios de la página que tiene una sin leer.
- **B.** Una sección *Mentions* en la barra lateral, arriba del árbol.
- **C.** Solo el punto en el botón de comentarios de cada página.

**Elegí A** porque se ve siempre (la barra lateral en el teléfono está escondida) y es donde lo buscan todos (Notion,
Google Docs, Coda).

**Si preferís otra:** B mueve el mismo panel a la barra lateral; C no avisa de otras páginas.

### ME7 · Visitantes del link público

**Qué pasaba:** alguien entra por *Anyone with the link*, sin cuenta, con un nombre que escribió. Si pudiera mencionar,
podría mandarle avisos a todo el equipo desde un link reenviado.

**Las opciones:**
- **A.** No mencionan ni se los menciona; su `@` es texto.
- **B.** Pueden mencionar a quienes ya comentaron en esa página.
- **C.** Se los puede mencionar y les llega por correo si dejaron uno.

**Elegí A** porque un link se reenvía a cualquiera y no tiene campana ni correo; el equipo igual lee sus comentarios.

**Si preferís otra:** B es una función `plink_*` más, con su tope por día. C pide guardar correos de gente sin cuenta.

### ME8 · Las menciones que vinieron de Coda

**Qué pasaba:** en Wanka hay 18 comentarios importados que se ven así: `@[Nombre](superhuman://users/123) quedó
corregido`.

**Las opciones:**
- **A.** Mostrarlas como `@Nombre` pintado, sin aviso y sin tocar la base.
- **B.** Dejarlas como están.
- **C.** Convertirlas en menciones de verdad cuando el nombre coincide con alguien del workspace.

**Elegí A** porque se leen bien y no avisa a nadie (regla de la importación: nadie se entera de nada).

**Si preferís otra:** B es no hacerlo. C avisaría por comentarios viejos y pide adivinar quién es quién.

### ME9 · El correo (cuando haya clave de Resend)

**Qué pasaba:** si no abrís la app, no ves la campana. El portero es el único que va a tener la clave de Resend, y no
tiene ninguna clave de la base. Y la cuenta de Resend es **la misma que manda los códigos para entrar** (el SMTP de
Supabase): el plan gratis da 100 correos por día entre todo, así que un día de muchas menciones podría dejar a alguien
sin poder entrar.

**Las opciones:**
- **A.** Cuando sube una mención, la app de quien menciona le pide al portero *mandá el aviso de esta mención*, con su
  sesión. El portero le pregunta a la base (con esa sesión) a quién y qué texto mandar, marca la mención como mandada
  para no repetir, y manda el correo (*lega mentioned you in "Plan de rodaje"*, el comienzo del comentario y el link a
  la página). Cada persona puede apagarlo en su cuenta. **Tope propio de 40 por día** (el resto queda para los
  códigos de login, que tienen prioridad: pasado el tope, la mención queda solo en la campana). El pedido al portero
  es **una operación más de la cola**: si la app se cierra después de subir la mención, sale al volver a abrirla.
- **B.** Un resumen diario con lo no leído (necesita que la base llame al portero sola: `pg_cron` y `pg_net`, que hoy
  no están, y un secreto compartido guardado en la base).
- **C.** Correo solo si no la leyó en 10 minutos (lo mismo que B, con espera).

**Elegí A** porque usa lo que ya hay (portero sin claves de la base, sesión de quien escribe) y llega en el acto. Es
la dirección; la entrega 3 se vuelve a diseñar y auditar cuando haya clave.

**Si preferís otra:** B y C se pueden sumar después sobre la misma tabla (una columna `emailed_at`).

### ME10 · Qué lista ve un miembro del equipo (que no comparte la página)

**Qué pasaba:** Ana es miembro y comenta en la página del plan de rodaje, que también ve el cliente. Hoy Ana no sabe
qué clientes ven esa página (eso lo ve solo quien puede compartirla). Si la lista del `@` le muestra a todos los que la
ven, se entera de qué clientes la ven aunque nunca hayan escrito.

**Las opciones:**
- **A.** Todos los que ven la página, equipo y clientes. Sirve para nombrar al cliente que todavía no escribió, y para
  saber que el cliente está mirando antes de escribir algo interno.
- **B.** El equipo que ve la página, y los clientes solo si ya comentaron en ella. Es lo que queda programado mientras
  decidís.
- **C.** Solo quienes ya participan en los comentarios de la página.

**Elegí A** si te parece bien que el equipo sepa qué clientes ven una página; mientras no lo digas, se programa **B**,
que no le cuenta a nadie nada que hoy no sepa.

**Si preferís otra:** A es sacar una condición de `mention_allowed` (una línea) y sumar su prueba; C, agregar otra.

## 11. Riesgos

| Riesgo | Qué se hace |
|---|---|
| Una versión vieja toma la cola y descarta la operación `mentions` | Copia en `meta` (`mentions:<id>`) y se vuelve a poner al abrir, como `import` |
| Una versión vieja edita el comentario y borra el `@rótulo` | La mención sigue (el aviso ya salió); solo no se pinta. Ningún texto se pierde |
| Un invitado conoce al equipo por la lista | Lista corta (ME3); la base descarta a quien no esté en ella |
| Un miembro se entera de qué clientes ven una página | Mientras Lega decide ME10, ve solo a los clientes que ya comentaron (lo que ya ve) |
| Un miembro común dueño de un proyecto ve todo el workspace | Las filas «sin acceso» son solo para dueño y admins, y recién en la entrega 2 |
| Un cliente ve el correo de alguien del equipo que nombraron delante de él | Dicho en ME3: quien escribe decide a quién nombra |
| Las menciones agotan el cupo de Resend y nadie puede entrar | Tope propio de 40 por día, login con prioridad (ME9, entrega 3) |
| Spam de menciones | 20 por comentario; solo quien comenta (equipo e invitados); los visitantes no mencionan |
| La campana muestra algo que ya no se ve | El número de la base no coincide (o se abre la campana) y la app pide el índice liviano, que lo trae `gone`, sin texto |
| Muchas sin leer encarecen cada pregunta | El conteo se corta en 10 (*9+*): 2,35 ms con 1000 sin leer |
| Dos personas con el mismo rótulo | La lista muestra el correo; el tooltip también; la base guarda el id |
| Gasto en el plan gratis | Una pregunta por minuto con la app a la vista y el índice al abrir la campana; ~0,3 GB por mes con 20 personas |
| El link público y las menciones cambian `list_comments` y `schema_version` | Menciones va después: `schema_version` 15, y su `list_comments` sobre el cuerpo del link |
| Compartir desde la mención sin preparar la página (D14) | La entrega 2 pasa por el mismo `useShareGate` que *Share* |
| Varios workspaces: no se avisa de los que no están abiertos | Al abrir cada uno se pregunta; el correo (entrega 3) cubre el resto |

## 12. Fuera de este diseño

- Avisos del sistema operativo (Web Push): necesitan claves de push en el portero y permisos del navegador; se miran
  después del correo.
- Avisar por respuestas en hilos propios o por hilos resueltos (solo menciones, que es el pedido).
- Mencionar páginas (`@página`) o grupos (`@equipo`).
- Nombres visibles en vez del correo: cuando exista un perfil con nombre, el rótulo pasa a ser ese nombre sin cambiar
  la tabla (el rótulo ya se guarda por mención).

## 13. Cómo se comprobó

- **El código** de `main` v0.108: las migraciones de comentarios, equipo, versión mínima y papelera; `src/sync/comments.ts`
  (la cola, sus stores y el recurso de `meta` para `import`), `src/ui/CommentsPanel.tsx` (el texto se muestra plano) y
  la barra de arriba de `src/ui/Workspace.tsx`.
- **La base de Wanka, solo lectura** (2026-10-02): `schema_version` 13, mínima 0.099 en la primera lectura (0.104 cuando auditó la auditoría), interruptor de D14 apagado; la
  publicación `supabase_realtime` sin tablas; `pg_cron` y `pg_net` sin instalar; 49 comentarios, 47 importados, 18 con
  menciones de Coda crudas; un solo miembro activo.
- **El borrador de la sección 7 compila** en la base real dentro de `begin … rollback` (sin la parte de
  `list_comments`, que se escribe sobre el cuerpo vigente al programarla): como el dueño, `mention_candidates` y
  `mentions_inbox` corren, y leer `comment_mentions` da 42501. Después, la tabla no existe y `schema_version` sigue en
  13. Las pruebas de la sección 8.1 se escriben con la entrega 1 (necesitan cuentas de prueba dentro de la transacción).
- **Después de la auditoría** (2026-10-02), el borrador corregido se volvió a correr con el escenario y los casos del
  auditor (11 cuentas falsas creadas **dentro** de la transacción, `begin … rollback`): un miembro común ya no recibe
  a las invitadas que no comentaron, el miembro común dueño de un proyecto recibe una lista vacía en su página (antes,
  las 10 personas del workspace), el admin sigue viendo a todos, un rótulo malo da `mentions_invalid`, y las filas
  `gone` llegan solo con `id`, `gone` y `updated_at`. Medido con 300 sin leer: la pregunta sin novedades, 2,5 ms y 69
  bytes (`unread` = 10); la lista desde cero de 30 filas, 9 ms y 23,6 KB; el índice liviano de 200, 40 ms y 11,2 KB.
  Antes y después: la tabla no existe, `schema_version` 13, ninguna cuenta de prueba.

## Correcciones de la auditoría (2026-10-02)

Auditoría independiente: «aprobado con condiciones», 60 casos en la base real dentro de `begin … rollback`.

| Hallazgo | Corrección |
|---|---|
| **B1 (H1)** `schema_version` 14 choca con el link público, que ya sube a 14 | Menciones va **después** del link: `schema_version` 15, `MENTIONS_SCHEMA_VERSION = 15`, y su `list_comments` sobre el cuerpo del link (`plink_id`, `plink_author`, después `mentions`) (sección 7) |
| **B2 (H2)** La parte «sin acceso» de la lista le daba el workspace entero a un miembro común dueño de un proyecto (`can_share` verdadero) | Sale de la entrega 1; en la entrega 2, solo con `workspace_role() in ('owner', 'admin')` además de `can_share`, con su prueba y su mutante (secciones 4, 7, 8.1 y ME2) |
| **B3 (H3)** Premisa falsa: «un miembro ya ve los correos de los invitados de la página» (no ve a los que no comentaron) | Texto corregido; decisión nueva **ME10** para Lega; mientras tanto se programa lo seguro: un miembro ve al equipo que ve la página y a los clientes que ya comentaron (`mention_allowed`, secciones 4 y 10) |
| O1 Un rótulo malo daba 23514 | Se valida en el primer bucle y da `mentions_invalid`; la lista arma el rótulo con `private.mention_label` (saca comillas, espacios y `@`) |
| O2 El conteo de la campana costaba en proporción a lo sin leer (186 ms con 1000) | Se cuenta **hasta 10** y la campana muestra *9+* (2,5 ms con 300) |
| O3 Abrir la campana bajaba la lista entera (157 KB) | Abrir pide lo cambiado y el índice liviano `mentions_index()` (11 KB); la lista con textos, solo con la caché vacía (30 filas). Costo recalculado: ~0,3 GB por mes con 20 personas |
| O4 Una fila `gone` traía página, comentario, quién y rótulo | Llega solo con `id`, `gone` y `updated_at` |
| O5 `comment_authors` con las mencionadas le muestra al cliente el correo de alguien nombrado delante de él | Dicho en ME3; solo cuenta comentarios sin borrar |
| O6 La cola: borrar sin subir, y `comment_not_found`/`comment_deleted` sobre `mentions` | El borrado se lleva `mentions` y su copia en `meta`; esos dos errores se descartan en silencio y la copia se borra (sección 3.3) |
| O7 *«she can't see this page»* podía ser falso para un invitado | Texto neutro: *«lucia wasn't notified.»* |
| O8 Resend comparte el cupo (100 por día) con los códigos de login, y el pedido al portero se perdía si la app se cerraba | ME9: tope propio de 40 por día con prioridad del login, y el pedido como una operación de la cola; la entrega 3 se rediseña y audita |
| O9 La mínima de Wanka es 0.104, no 0.099 | Corregido en el encabezado y en las pruebas |
| O10 Quien edita ve en la campana menciones de páginas en la papelera | Se marcan *In trash* con el árbol local |
| O11 A quien sacan del workspace la campana le da vacío, no `gone` | Anotado: lo borra la limpieza de siempre al sacarlo |
| ME5 aprobada con condición (O2, O3) | Hecho en la sección 5.1 |
| No verificado por la auditoría: la rama de `invitations.invited_by` | Caso 18 de las pruebas 8.1 |
