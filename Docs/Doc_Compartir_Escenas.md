# Compartir escenas con un vendor (*Share scenes*)

**Estado:** entrega **B-1 hecha en la v0.323** (D843): *Share scenes of “<proyecto>”…*, la migración
`20261118120000_compartir_escenas.sql` (base 28, **pendiente: se aplica al publicar la v0.323**), la marca del árbol de
lo que ven personas de afuera, sus avisos y el freno en la base para que nada marcado entre en una escena compartida.
Pasó por dos auditorías (la de la propuesta y la de la entrega, las dos «aprobado con condiciones»; sección 8).
**Pendientes:** B-2 (pedir una escena desde un link de PipeSync) y B-3 (prender la privacidad de lo borrado, D14),
sección 9. Hasta B-3, *Share scenes* está **frenado**: la base rechaza guardar (`clean_off`) y la ventana lo dice.

Pedido de Lega (2026-11-05): dentro de un proyecto, además de *Share “<proyecto>”…*, **«Share scenes of “<proyecto>”…»**.
Un vendor tiene asignadas algunas escenas: se elige a quién, aparecen las escenas con las que ya tiene marcadas, se marcan
o desmarcan, y al entrar al proyecto **solo ve lo de sus escenas**, en el Panorama y en todo lo demás. **Seguridad máxima
(material con NDA): compartir algo nunca puede dejar ver otra cosa.**

## 1. El modelo: una escena compartida es un permiso por página

- **Permisos en la base, por página** (`grants`; RLS de `pages`, `page_updates`, archivos y comentarios; `Plan_Workspaces.md`,
  `Doc_Supabase.md`). Un permiso sobre una página vale para ella y **todo lo de abajo**, nunca para lo de arriba ni para
  las hermanas. Todo lo que la app muestra de una página sale de lo que la base deja bajar.
- **El Panorama, las relaciones y los índices se arman en el dispositivo** con lo que el dispositivo ve (`registerProject`,
  `relationIndex`, `sceneMentions`; `Doc_Relaciones.md`). Quien ve solo dos escenas tiene en su dispositivo solo esas dos
  páginas y lo de adentro: la locación, los días y las otras escenas **no le llegan**, así que no hay nada que filtrar
  después.

Por eso **compartir una escena = un permiso de Ver o Comentar sobre la página de la escena**, el de siempre. **La RLS de
lectura no cambia.** Lo nuevo es darlos de a muchos a una persona con frenos propios (sección 3), que nada marcado como
otra entidad quede adentro de una escena compartida (ni al compartir ni después), y que quien comparte o edita vea qué
está a la vista de afuera (sección 5).

## 2. Qué ve quien comparte

**Quién:** solo el dueño y los admins del workspace que además pueden compartir el proyecto (`perms.canInvite` y
`canShareProject` en la app; la base vuelve a pedirlo), con la base en la versión 28.

**Dónde:** en el selector de proyectos, *Share scenes of “<proyecto>”…* (debajo de *Share “<proyecto>”…*), y en el
Panorama, en *Scenes*, *Share scenes…* al lado de *Copy overview* (solo en la lista, no dentro de una escena).

**La ventana** (`src/ui/ShareScenesDialog.tsx`):

1. **Una persona por guardado.** Un campo de correo con sugerencias: primero quienes ya tienen páginas compartidas en el
   proyecto (con cuántas), después los miembros y los invitados pendientes del workspace, o un correo nuevo. Debajo dice
   quién es: *In the workspace · <rol>*, *Has a pending invitation…* o *New to the workspace…*.
2. **Nivel:** *Can view* (de fábrica) o *Can comment*. Nunca Editar.
3. **Las escenas del proyecto**, del registro de este dispositivo (`registerProject`: el mismo de *Overview › Scenes*;
   quien comparte ve el proyecto entero), en orden de número con la forma de la post (`sceneLabel`), con buscador y
   *All* / *None* de lo filtrado. Cada una marcada si la persona ya la tiene; lo tocado queda resaltado y la cuenta
   (`+n −m`) va al lado de *Save*. Al lado de cada escena: cuántas páginas lleva adentro (sus fichas, que van con ella)
   y un aviso si la escena **ya la ve otra persona de afuera** (se ven los comentarios y los correos entre ellos, M5).
4. **Una escena con otra entidad adentro no se comparte** (sin opción para seguir): si en su rama (también en la papelera)
   hay una página que el registro reconoce como escena, locación, día o decorado, una con esa marca en sus ajustes o que
   guarda alguna (`settings.holds`), o una con título de escena (`sceneCode`), la fila queda apagada con el motivo
   (*Can't be shared: …*). Es el caso de un episodio («101 | Piloto») que el registro tomó por escena. *All* no la marca.
   La base lo vuelve a frenar (`scene_contains_entities`).
5. **Lo que la persona ya tiene además:** otras páginas compartidas en el proyecto (se nombran, sin tocarlas), el aviso si
   ve **el proyecto entero** («ya ve todo; se cambia en *Share*»), y **lo que tiene en la papelera** (la escena o una de
   arriba), en una lista aparte (*In trash · View*) para poder sacarlo. Un Editar sobre una escena se muestra marcado y
   bloqueado (*Edit: change it in Share*); a una invitación pendiente solo se le suma (lo que ya tiene, bloqueado).
6. **Sin el interruptor de lo borrado** (D14 apagado), un aviso arriba y *Save* apagado.
7. **Al guardar:** (a) escribe la marca de escena (`settings.entity = {kind:'scene', code}`, `setPageType`) en cada escena
   elegida que no la tenga y **espera a que suba** (si no subió: *The scene marks couldn't be uploaded yet…* y no comparte
   nada); (b) pasa por la compuerta de compartir (`shareGate`, con varias páginas): sube lo pendiente de cada escena y su
   rama, **sin *Share anyway*** (solo *Retry*); (c) llama a `set_page_shares`; (d) arma las bases limpias de lo compartido
   (`gate.after`) y vuelve a pedir la marca del árbol. Si invitó a alguien nuevo, copia el link de la invitación en el
   mismo gesto (como *Members*), o lo muestra para copiar a mano.
8. ***Retry* manda el formulario de ese momento**, y cambiar el correo, las escenas o el nivel borra el aviso de lo
   pendiente: el aviso era del pedido de antes. (Antes, *Retry* repetía el pedido viejo: compartía con la persona de antes
   aunque la ventana mostrara otra.) Lo mismo se arregló en *Share* (`ShareDialog`), *Members*, los pedidos de acceso
   (`AccessRequests`: la página y el nivel elegidos) y el link público (`LinkShare`: nivel y vencimiento); la pregunta de
   compartir desde una mención ya borraba el aviso al cambiar de persona.
9. **Después:** *Saved: <correo> has n pages of this project shared* (o *Invited…*) y ***Same scenes for another email…***,
   que deja marcado **lo agregado en el último guardado** (no todo lo que tenía la persona) y vacía el correo.
10. Los errores de la base se dicen en palabras (`teamErrorText` y los propios de la ventana): `invitation_exists` (de otra
   persona, o de un miembro que además tiene una invitación pendiente), `invitation_role`, `invitation_remove`,
   `too_many_pages`, `clean_off`, `scene_contains_entities`; `page_invalid` como «una de las escenas ya no se puede
   compartir».

## 3. La base (`20261118120000_compartir_escenas.sql`, versión 28)

Las cuatro funciones son `security definer`, `search_path` vacío, `revoke all … from public, anon` y `grant execute … to
authenticated`. No tocan `share`, `create_invitation` ni la RLS. Las piezas de adentro (`private.entity_marked`,
`page_outside_readers`, `chain_outside_readers`, `branch_has_entities`) no las ejecuta nadie de afuera.

### 3.1 `project_page_shares(p_project)` — quién tiene qué en un proyecto

Solo dueño o admin del workspace (`workspace_role() in ('owner','admin')`, que ya mira que no se haya entrado con
contraseña) que además puede compartir el proyecto (`can_share(p_project, null)`); si no, `not_allowed`. Una fila por:
permiso vivo de un miembro activo sobre el proyecto (`page_id` nulo) o sobre una página del proyecto (**también en la
papelera, con `in_trash`**, para poder sacarlo); y por cada proyecto o página viva del proyecto en una **invitación viva**
(sin usar, sin revocar, sin vencer, de un dueño o admin activo). Columnas: `row_key` (única: la app pide la lista entera
por esa clave), `email`, `user_id`, `role`, `page_id`, `level`, `grant_id`, `invitation_id`, `in_trash`. Nada de otros
proyectos.

### 3.2 `set_page_shares(p_project, p_email, p_add, p_remove, p_level)` — compartir y sacar, todo o nada

En este orden:

1. Dueño o admin activo que puede compartir el proyecto (`not_allowed`).
2. El interruptor de lo borrado prendido (`clean_off`, como `create_public_link` en `20261028120000_link_editar.sql`).
3. `p_level` en `view` / `comment` (`level_invalid`); un correo válido (`email_invalid`).
4. Las listas: algo que hacer, **hasta 200 páginas entre las dos**, sin nulos, sin repetidas, ninguna en las dos
   (`too_many_pages`, `pages_invalid`).
5. **Cada página una sola vez, antes de escribir nada:** existe, es de `p_project` y quien llama la puede compartir
   (`user_can_share_page`; quien comparte el proyecto la puede compartir también en la papelera). Si se agrega, además
   está viva (`page_alive`) y **tiene la marca de escena** (`settings->'entity'->>'kind' = 'scene'`: nunca una carpeta, un
   episodio, una ficha, una locación o un día). Si una falla, **un único `page_invalid`** que no dice cuál ni si existe.
   **Sacar anda con una página en la papelera** (ella o una de arriba).
6. **Solo esa escena:** ninguna página que se agrega tiene adentro (también en la papelera) otra marcada como escena,
   locación, día o decorado, ni una carpeta de entidades (`settings.holds`, un texto no vacío, o `settings.dayReports`, un
   objeto), ni es ella misma una carpeta de entidades (tenga algo adentro o no): si no, **`scene_contains_entities`**, sin
   decir cuál. `holds: false` («nada», a mano) no cuenta. Es lo que se mira **al volver a compartir** después de meter
   algo (3.5).
7. **El candado por correo** de `create_invitation` (`pg_advisory_xact_lock`), **antes de decidir** entre miembro e
   invitación, para los dos caminos.
8. **Miembro activo** (por su correo; uno sacado del workspace entra como alguien nuevo): si el correo tiene además una
   **invitación viva**, `invitation_exists` (al aceptarla le volvería lo que se saca acá). Agregar es **un upsert propio**
   (no `share`) **solo si sube su nivel** sobre esa página (`user_page_level` del miembro: un Editar sobre ella, sobre una de
   arriba o sobre el proyecto se queda), que tampoco baja la fila en una carrera (`where g.revoked_at is not null or
   grant_level_value(excluded.level) > grant_level_value(g.level)`, como `accept_invitations`), y reinicia la base limpia
   de la rama (`clean_reset`, como `share`). Sacar revoca (como `unshare`: marca, no borra) **solo un Ver o Comentar
   puesto sobre esa misma página**.
9. **No miembro:** una invitación de **invitado**, solo para agregar (`invitation_remove` si se pide sacar: «revocá la
   invitación y volvé a invitar»); una invitación viva de otra persona (`invitation_exists`) o con otro rol
   (`invitation_role`) no se toca; hasta 200 permisos en la invitación (`too_many_pages`). `create_invitation` vuelve a
   pedir dueño o admin y nivel 4 sobre cada página, suma sin bajar niveles y reinicia la base limpia.
10. Devuelve `{"result": "member"|"invited", "pages": n}`: cuántas páginas vivas del proyecto quedaron compartidas por
   página con esa persona.

### 3.3 `pages_with_outside_readers(p_project)` — la marca del árbol

Para quien puede compartir el proyecto (`can_share`) **y no es invitado** (un invitado que creó un proyecto tampoco).
Una fila por página viva del proyecto con un permiso vivo de un **invitado** (cualquier nivel) o de un miembro que la ve
**con Ver o Comentar** (su nivel real: un Ver tapado por un Editar de arriba no cuenta, como en `has_plain_readers`), o
con una invitación viva de invitado o de Ver o Comentar; `readers`, cuántas personas o invitaciones. Un permiso sobre el
proyecto entero no marca páginas (lo dice *Share* del proyecto).

**Costo:** un `user_page_level` (la cadena hacia arriba) por cada permiso sobre una página del proyecto, y un
`page_alive` por página marcada; nunca recorre el árbol. Con los permisos de hoy (decenas), del orden de
`has_plain_readers` por candidato: milisegundos. **No se pudo medir en esta entrega** (no hay base local); para medirlo al
aplicar, como dueña: `explain analyze select * from public.pages_with_outside_readers('<proyecto>');`. La app lo pide como
mucho cada 2 minutos por proyecto abierto, y al guardar en *Share scenes*.

### 3.4 `page_has_outside_readers(p_page)` — sí o no, para quien edita

Para quien puede **editar** la página (`can_edit_page`) y no es invitado: si la página o una de arriba la ven personas de
afuera, con el mismo criterio que la marca del árbol (un permiso o una invitación puestos sobre esas páginas). **Solo sí
o no**: ni quién, ni cuántos, ni por cuál de arriba. A cualquier otro (quien solo ve, un invitado, una sesión con
contraseña, una página que no existe o de un proyecto que no ve) le contesta siempre que no.

### 3.5 El trigger `pages_scene_share_guard` — una escena compartida no recibe nada de afuera

En `pages`, antes de insertar y antes de cambiar `parent_id` o `settings` (el `when` de insertar deja pasar sin hacer
nada lo que no tiene marca; el de cambiar, lo que no cambia de padre ni de ajustes). Una **escena compartida** es una
página con la marca de escena y un permiso o una invitación de afuera sobre ella; `nearest_shared_scene(página)` da la
más cercana hacia arriba (ella incluida).

- **Mover (la regla de los movimientos, D843):** se rechaza con **`moved_into_shared_scene`** si la escena compartida más
  cercana del destino no es la misma que la del origen (el padre de antes), **sea lo que sea lo que se mueve, con marca o
  sin ella**. Mover adentro de la misma escena compartida (una ficha adentro de otra), o sacar algo de ella, sí. Así no
  hace falta adivinar qué es una entidad sin marca (por su carpeta, por un grupo en el medio), ni se esquiva en dos pasos
  (primero a la raíz o a una página neutra). **Para meter algo:** dejar de compartir la escena, mover y volver a
  compartir; al volver a compartir, `scene_contains_entities` (3.2) y la ventana lo vuelven a mirar.
- **Crear** adentro una página marcada como escena, locación, día o decorado, o una carpeta de entidades (`holds` de texto
  o `dayReports`): **`entity_in_shared_scene`**. Sin marca, sí.
- **Marcar** estando adentro (la marca es nueva; cambiar los ajustes de una que ya la tenía no se frena: lo que ya estaba
  se queda): `entity_in_shared_scene`.
- **La escena compartida misma** (con un permiso o una invitación de afuera sobre ella): **no deja de ser escena** (si
  no, se la desmarca, se mete una locación, y se la vuelve a marcar), no pasa a ser carpeta de entidades, y una página
  que ven de afuera **no pasa a ser escena con entidades adentro**. Cambiar otros ajustes de la escena compartida, sí.

Vale para cualquiera que escriba (también una versión vieja de la app o la consola). **Solo frenan las escenas
compartidas**: una carpeta de locaciones compartida con *Share* sigue recibiendo locaciones (la app pregunta).
Costo de mover: la cadena hacia arriba del destino y, solo si hay una escena compartida en ella, la del origen.

### 3.6 Versión 28

La app ofrece *Share scenes* y la marca del árbol desde la 28 (`SCENE_SHARES_SCHEMA_VERSION`); con una base más vieja,
no aparecen. Solo suma funciones y un trigger que no cambia nada de lo que ya está: las versiones publicadas siguen
andando (un movimiento que el trigger rechaza queda en sus cambios que no subieron, como cualquier rechazo de la base).

## 4. Qué ve quien recibe

- **El proyecto aparece** en su lista (pasa con cualquier página compartida: se ve el nombre del proyecto).
- **La barra lateral** muestra sus escenas como raíces, con lo de adentro; **el Panorama** solo esas escenas y lo que esas
  páginas dicen (la marca de escena que se escribió antes de compartir es la que hace que el registro las reconozca sin la
  carpeta). **No ve la locación ni los días de sus escenas** (un día nombra otras escenas): es el límite dicho en la
  ayuda (M8). La cabecera viva de la escena tampoco los nombra.
- Lo que está escrito en la escena se ve: el texto de un link a otra página y los correos de quienes comentaron. Lo que
  ya bajó puede quedar en su dispositivo si se le saca una escena. Las dos cosas van en la ayuda.

## 5. Lo que ven personas de afuera: la marca del árbol y los avisos (condición 8)

- **Quien comparte el proyecto** (dueño o admin, o quien lo creó) tiene la lista entera (`pages_with_outside_readers`):
  **el ojo** (`src/ui/OutsideTreeMark.tsx`) en la fila de cada página que ven personas de afuera (invitados, o Ver o
  Comentar) y, más tenue, en lo de adentro. El tooltip propio (D226, `data-tip`) dice cuántos o por qué página.
- **Quien edita sin poder compartir el proyecto** pregunta por una página (`page_has_outside_readers`, sí o no): el ojo en
  la fila de **la página abierta** si la ven de afuera, con un tooltip sin quién ni cuántos, y la misma respuesta para los
  avisos de abajo (sobre el destino).
- **Al mover** (arrastrar en el árbol o *Move to…*) a una **escena compartida** desde afuera de ella, sea lo que sea: lo
  dice («The scene “…” is shared with people outside the team. To move a page into it, stop sharing it first.») y no
  mueve, sin opción de seguir (`confirmOutsideMove`, la misma regla que la base). Adentro de la misma escena, o afuera,
  no dice nada. A **otra rama que ven de afuera** (una carpeta compartida con *Share*), pregunta antes.
- **Al unir dos fichas** (*Merge*, `MergeAction`): lo mismo, con la que se va como origen. De una ficha de afuera a una
  de adentro de una escena compartida, avisa y no une nada; dos fichas de la misma escena, sí; a otra rama que ven de
  afuera, pregunta, porque su texto y sus subpáginas pasan ahí.
- **Quien edita sin compartir** solo sabe si al destino lo ven de afuera: si sí y hay una escena hacia arriba que no es la
  del origen, la toma por compartida y no mueve (ante la duda, no); adentro de la misma escena, pregunta.
- **Al crear** una página adentro, un aviso: «también van a ver esta página nueva». Lo dan el «+» del árbol y *New page
  inside* del menú ⋯. Los otros caminos que crean páginas (plantillas, reporte del día, *New location* o *New set*, el
  asistente) no avisan: la página nueva igual lleva el ojo para quien comparte, y si es una entidad la base la rechaza
  adentro de una escena compartida. Pendiente bajo.
- La lista vive en memoria por proyecto, y las respuestas por página también (`src/ui/outsideReaders.ts`): se piden al
  abrir el proyecto o la página, con las sincronizaciones como mucho cada 2 minutos y enseguida al guardar en *Share
  scenes*; sin red o con una base vieja, nada.

## 6. Pruebas

- **SQL** (`supabase/tests/compartir_escenas_permisos.sql`, en `begin … rollback`, termina en `select 'ok'`): las puertas
  (`anon`, `security definer`, `search_path`, el trigger no ejecutable); quién puede (dueña y admin que comparten el
  proyecto; no un miembro que lo creó, un invitado, **un invitado dueño de un proyecto** (B2), una cuenta sin membresía,
  una sesión con contraseña, un admin sin el proyecto o con permiso solo sobre una escena); `clean_off` sin el
  interruptor; nivel, correo, listas y 201 páginas; cada página que no vale, sola o con escenas que valen, sin escribir
  nada; **`scene_contains_entities`** (una escena con una locación, con un día en la papelera, con una carpeta de
  locaciones, un episodio marcado con una escena adentro), y que `page_invalid` gana; a un miembro (sube sin bajar, un
  Editar revocado vuelve como Ver, no toca Editar ni el proyecto, sacar revoca la fila, **sacar en la papelera**, con un
  ancestro en la papelera, **el miembro con una invitación viva**); a alguien nuevo (invitación de invitado que se suma,
  `invitation_remove`, la de otro y la de otro rol, el tope de 200); **un invitado con dos escenas no ve la tercera, ni la
  locación, ni el día, ni la carpeta o el episodio de arriba, ni sus filas de `page_updates`, `pull_page_updates` (que sin
  base limpia no baja nada: `= 0`), comentarios ni archivos**; `project_page_shares` (solo este proyecto, `in_trash`,
  miembros activos, invitaciones vivas); la marca del árbol; **`page_has_outside_readers`** (sí a quien edita; no a quien
  solo ve, a un invitado, con contraseña, sin página o de otro proyecto); **el trigger** (crear, mover y marcar adentro de
  una escena compartida, también como postgres; adentro de una página sin marca o sin lectores, sí; lo que ya estaba se
  puede seguir cambiando; una carpeta compartida con *Share* sigue recibiendo locaciones; **la regla de los
  movimientos**: nada de afuera entra, tampoco en dos pasos por la raíz o por una página neutra, ni de una escena
  compartida a otra; una ficha adentro de otra en una escena compartida que cuelga directo de la carpeta de escenas, sí;
  sacar, sí; crear sin marca adentro, sí; dejar de compartir, mover y volver a compartir; **las vueltas**: desmarcar la
  escena compartida o pasarla a locación o a carpeta, marcar como escena una página compartida con una locación adentro;
  compartir una escena que guarda locaciones, con algo adentro o vacía, y `holds: false`, que no es marca). **Corrida contra la base real**
  en rollback antes de aplicar (cuatro veces, una por vuelta de auditoría) y al aplicar con la v0.323 (2026-11-06), con las 49 pruebas de permisos en `ok`.
- **App** (`src/ui/shareScenes.test.tsx`, contra el servidor en memoria, que tiene las mismas reglas en
  `src/sync/testing.ts`, incluido el trigger en `updatePage`, el vencimiento de las invitaciones y las filas revocadas):
  la ventana (orden y forma de las escenas, páginas de adentro, sugerencias, marcar, guardar con la marca escrita antes,
  sacar, *Same scenes for another email…* con solo lo último agregado y la invitación con su link copiado, la invitación
  pendiente, el Editar bloqueado, el proyecto entero, **las escenas con otra entidad adentro apagadas**, los errores de la
  base sin escribir nada, una escena que pasó a la papelera mientras tanto, D14 apagado, la compuerta sin *Share anyway*,
  **Retry con el formulario de ese momento y el aviso que se borra al cambiar correo, escenas o nivel**, **lo que tiene en
  la papelera**, la marca que no sube sin red); las entradas (selector de proyectos con la 28 y sin ella, un miembro que
  no es admin, el Panorama); **el Panorama de un vendor con dos escenas** (el árbol del dispositivo, la lista de escenas,
  las otras pestañas y la cabecera viva: ni la locación, ni los días, ni las otras escenas); la marca del árbol con sus
  avisos (también el bloqueo de entidades y unir fichas) y **el ojo y los avisos de quien edita sin poder compartir**.
- **Mutantes:** 33 chequeos del servidor en memoria (`SCENE_SHARE_MUTANTS`), cada uno con su prueba, que pasa con el
  chequeo y falla sin él: `role`, `canShare`, `clean`, `level`, `cap`, `email`, `pagesList`, `project`, `alive`,
  `sharePage` (segunda capa: se prueba con `project` también afuera), `mark`, `entities`, `allOrNothing`, `lowers`,
  `upsert` (segunda capa: con `lowers` también afuera), `memberInvitation`, `removesHigher`, `removesProject`,
  `inviteOwner`, `inviteRole`, `inviteRemove`, `inviteCap`, `listProject`, `listAlive`, `listTrash`, `readersCanShare`,
  `readersProject`, `readersGuest`, `hasEdit`, `guard`, `guardUnmark` (la escena compartida no deja de serlo),
  `guardMove` (nada entra moviéndolo a una escena compartida), `entitiesSelf` (la escena que es carpeta de entidades).
  Todos detectados (33). El candado por correo no tiene mutante: en
  memoria no hay dos pedidos a la vez.

## 7. Decisiones tomadas sin Lega (D843; las puede cambiar)

1. Los **permisos por página** de siempre, no un tipo de permiso nuevo: nada nuevo que auditar en la RLS de lectura.
2. Nivel de fábrica **Ver**; se ofrece **Comentar**; nunca Editar desde esta ventana.
3. Alguien nuevo entra como **invitado (guest)**; sin correo automático (la app no manda correos): se copia el link.
4. **Una persona por guardado**, con *Same scenes for another email…* (solo lo último agregado).
5. **Solo dueño y admins**, aunque un miembro que creó el proyecto pueda compartirlo con *Share*.
6. La marca de escena **se escribe sola** antes de compartir (es un dato de la página que cualquiera con Editar podía
   poner con *Type*).
7. Sin paso en los recorridos: es de dueño y admins, necesita la base y otra persona; la página de práctica no tiene
   ninguna de las dos. Va en la ayuda (*Compartir escenas con un vendor*).
8. Sacar una escena a una invitación pendiente no se hace (se revoca y se vuelve a invitar).
9. **El trigger frena solo adentro de escenas compartidas** (no de cualquier página que ven de afuera): frenar en
   cualquier rama compartida rompería *Share* de una carpeta de locaciones o de días con un cliente. Y no frena lo que ya
   estaba (cambiar ajustes de algo marcado que ya estaba adentro).
10. **La ventana es más estricta que la base** al bloquear escenas: además de las marcas (lo único que ve la base), mira
   lo que el registro reconoce y los títulos con forma de escena.
11. **Quien edita sin compartir** sabe sí o no de la página abierta y del destino al crear o mover; no ve el ojo en las
   demás filas (preguntar por cada fila serían muchos pedidos).

## 8. Condiciones de las auditorías y cómo quedaron

**Auditoría de la propuesta (2026-11-05):**

| Condición | Cómo quedó |
|---|---|
| 1. D14 obligatorio (C1) | `clean_off` en `set_page_shares`; la ventana lo dice y apaga *Save*. `share` y `create_invitation` no se tocaron (hoy *Share* de una página a un invitado tiene la misma fuga: anotado para Lega en D843). |
| 2. Solo dueño y admins (M3, B2) | `workspace_role() in ('owner','admin')` además de `can_share` en las dos funciones de compartir; la entrada solo para ellos. |
| 3. Solo escenas marcadas (A3) | La app escribe la marca y espera a que suba; la base exige la marca en cada página de `p_add`. |
| 4. Nunca baja, solo saca Ver o Comentar (M1) | `user_page_level` antes y un upsert que no baja; sacar revoca solo `view`/`comment` sobre esa página. |
| 5. Invitaciones (M2) | Solo agregar, propia y de invitado, en el candado por correo; 200 por llamada y por invitación. |
| 6. Una persona por guardado | Sí, con *Same scenes for another email…*. |
| 7. La compuerta (M4) | `shareGate` con varias páginas, sin *Share anyway*. |
| 8. Lo que ven los de afuera (A2) | `pages_with_outside_readers`, `page_has_outside_readers`, el ojo del árbol, la pregunta al mover y al unir, y el aviso al crear. |
| 9. Dos vendors en la misma escena (M5) | La ventana avisa quién más de afuera la ve. Lo decide Lega. |
| 10. Topes y tiempo (M7) | Cada página se valida una vez; hasta 200 por llamada. |
| 11. Límite dicho (M8) | En la ayuda; para `PARA_LEGA.md`, en el informe de la entrega. |

**Auditorías de la entrega (base y app, 2026-11-06):**

| Punto | Cómo quedó |
|---|---|
| El candado antes de decidir; miembro con invitación viva | El candado va antes de mirar si es miembro; con una invitación viva para su correo, `invitation_exists`. |
| Sacar en la papelera | `p_remove` no pide `page_alive`; `project_page_shares` devuelve esos permisos con `in_trash` y la ventana los muestra aparte. |
| «Solo esa escena» en la base | `scene_contains_entities` al agregar y el trigger `pages_scene_share_guard` al crear, mover o marcar. |
| El upsert no baja en una carrera | Upsert propio con la condición de `accept_invitations`. |
| La marca no para invitados | `pages_with_outside_readers` pide que no sea invitado. |
| La prueba | `pull_page_updates` sin base limpia `= 0`; el invitado dueño de un proyecto; el miembro con invitación viva. |
| Sí o no para quien edita | `page_has_outside_readers`. |
| *Retry* con el pedido viejo | Corregido en *Share scenes*, *Share*, *Members*, los pedidos de acceso y el link público. |
| Un episodio compartido como escena | La fila queda apagada con el motivo. |
| El ojo y los avisos para quien edita | Con `page_has_outside_readers`. |
| Unir fichas | Pregunta como al mover. |
| *Same scenes* | Solo lo agregado en el último guardado. |
| El servidor en memoria | Las invitaciones vencen, sacar deja la fila revocada, y mutantes para los chequeos nuevos. |

**Re-verificación de la base (2026-11-06, sobre c0faaadb):**

| Punto | Cómo quedó |
|---|---|
| Desmarcar, mover y volver a marcar | La escena con lectores de afuera no deja de ser escena; una página que ven de afuera no pasa a escena con entidades adentro. |
| Entidades sin marca (por su carpeta, `dayReports`) | `folder_marked` cuenta `dayReports`; al mover, `entity_by_folder` sobre el padre de antes (o el abuelo); `branch_has_entities` cuenta lo de adentro de una carpeta de entidades. La app también toma `dayReports` como marca y, para quien solo edita, frena las entidades si el destino está en una escena. |
| `holds: false` | Solo cuenta un texto no vacío. |

**Segunda re-verificación (2026-11-06, sobre b9a048aa):** la regla de la carpeta se esquivaba en dos pasos (por la raíz
o una página neutra), la del abuelo frenaba mover fichas en una escena que cuelga directo de la carpeta de escenas, y una
escena que es carpeta de entidades sin nada adentro se compartía. **Decisión del coordinador (D843): la regla de los
movimientos** (3.5): nada entra moviéndolo a una escena compartida desde afuera de ella (`moved_into_shared_scene`), con
marca o sin ella; adentro de la misma o sacar, sí. Se sacó `entity_by_folder`. `set_page_shares` rechaza la escena que
es carpeta de entidades aunque esté vacía. La app (*Move to…*, arrastrar, unir fichas) aplica la misma regla y lo dice
sin opción de seguir.

## 9. Pendiente

**B-2 (versión aparte):** pedir una escena desde un link de PipeSync (`/map/scenes?project=…&scene=…`) sin acceso. El
pedido guarda el **id** del proyecto si la app lo resolvió, o el texto normalizado (columna propia), con deduplicado por
(persona, proyecto o texto, escena) y el mismo tope en los dos casos (sin oráculo de existencia, A1); se resuelve al leer
los pendientes, entre los proyectos que puede compartir quien mira. Decidir pide `can_share(proyecto)`, una página
**marcada como escena de ese proyecto** y nivel `view`/`comment` (M6). Los pedidos les llegan a quienes pueden compartir
el proyecto (B3: confirmar con Lega si también al dueño del workspace sin permiso).

**B-3 (D14):** contar invitados y permisos Ver/Comentar vivos; **el orden de la restauración**: el script de restaurar
del repo privado tiene que cargar las páginas antes que los permisos y las invitaciones (o correr con
`session_replication_role = replica`, que apaga los triggers), porque si no `pages_scene_share_guard` frena una página
marcada adentro de una escena ya compartida o la escena compartida que cambia de ajustes; copia; `min_app_version`; prender el interruptor con un editor abierto. Si algo falta, queda
para Lega y *Share scenes* sigue frenado.

**Observación previa (no cambia con B-1):** *Share* (`share`) e invitar desde *Members* (`create_invitation`) sobre una
escena no pasan por `scene_contains_entities`: con ellos se puede compartir una escena que tiene adentro una locación o
un día, y ver esa rama. Una vez compartida, el trigger sí frena lo que se meta después. Para decidir con B-3.

**Bajo:** el aviso al crear por los otros caminos (plantillas, reporte del día, entidades nuevas, el asistente);
imágenes viejas `sdfile://` en escenas a compartir (B1: verificar que no haya); dos páginas con el mismo número de escena
(B4: se comparte la que se marcó). La fila de `pages` que baja un vendor trae `parent_id` (un id del padre que no ve),
`settings` y `created_by`: son ids y ajustes, no contenido; no se cambió.
