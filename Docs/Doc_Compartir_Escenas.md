# Compartir escenas con un vendor (*Share scenes*)

**Estado:** entrega **B-1 hecha en la v0.323** (D843): *Share scenes of “<proyecto>”*, la migración
`20261118120000_compartir_escenas.sql` (base 28, **aplicada** con la v0.323, 2026-11-06), la marca del árbol de
lo que ven personas de afuera, sus avisos y el freno en la base para que nada marcado entre en una escena compartida.
Pasó por dos auditorías (la de la propuesta y la de la entrega, las dos «aprobado con condiciones»; sección 8).
**B-2 hecha en la v0.324** (D847): pedir una escena desde su link (sección 10; migración
`20261119120000_pedir_escena.sql`, base 29, **aplicada** con la v0.324, 2026-11-06). **B-3 hecha el 2026-11-06:**
la privacidad de lo borrado (D14) está prendida, así que *Share scenes* y dar una escena pedida ya guardan. Falta
probarlo con una persona real (sección 9). **Desde la v0.331 (D852) se comparte con vendors** (sección 11): cada
proyecto tiene sus vendors, con correos y escenas asignadas, y la casilla *Can share scenes* deja hacerlo a un productor.
Lo que las secciones 2 a 9 dicen de «elegir una persona» es la ventana de la v0.323 a la v0.330; la base de entonces
(`set_page_shares`, `project_page_shares`) sigue andando, pero la ventana ya no la usa.

Pedido de Lega (2026-11-05): dentro de un proyecto, además de *Share “<proyecto>”*, **«Share scenes of “<proyecto>”»**.
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

**Dónde:** en el selector de proyectos, *Share scenes…* en el ⋯ de cada proyecto (desde la v0.333, D853; antes en el menú *Share* de la barra de abajo), y en el
Panorama, en *Scenes*, *Share scenes…* al lado de *Copy overview* (solo en la lista, no dentro de una escena).

**La ventana** (`src/ui/ShareScenesDialog.tsx`):

1. **Una persona por guardado.** Un campo de correo con sugerencias: primero quienes ya tienen páginas compartidas en el
   proyecto (con cuántas), después los miembros y los invitados pendientes del workspace, o un correo nuevo. Debajo dice
   quién es: *In the workspace · <rol>*, *Has a pending invitation…* o *New to the workspace…*.
2. **Nivel:** *View* (de fábrica) o *Comment*, dos botones con su ícono (ojo y globo). Nunca Editar.
3. **Las escenas del proyecto**, del registro de este dispositivo (`registerProject`: el mismo de *Overview › Scenes*;
   quien comparte ve el proyecto entero), en una **tabla** (v0.330, D851; `src/ui/shareScenesTable.ts`):
   - **Columnas:** *No.* (la forma de la post, `sceneLabel`), *Scene* (el título sin el número: desde D849 el título
     empieza con él), *Location*, *Set*, *INT/EXT*, *Pages* (las de adentro, que van con ella), *Outside* (cuántas
     personas de afuera ya la ven, con quiénes en el tooltip) y *Status* para la persona elegida: *Adding*, *Removing*,
     *Shared · View/Comment*, *Edit: change it in Share* o *Can't be shared*. Locación, decorado e INT/EXT salen del
     índice de relaciones (`sceneLive`, lo mismo que el índice de una carpeta de escenas): solo del proyecto abierto, así
     que compartiendo otro desde el selector (o antes de la primera pasada del índice) esas tres columnas no están.
   - **Orden:** un clic en el título de una columna ordena por ella y otro lo invierte; lo vacío va siempre al final y
     los empates van por número. De fábrica, por número.
   - **Filtros:** el buscador (número, escena, locación o decorado), los desplegables de locación y decorado, y las vistas
     de un clic: *All*, *Selected*, *Not selected*, *Seen from outside* y *Can't be shared* (las dos últimas solo si hay
     alguna). *Select shown* / *Clear shown* (y la casilla de los títulos, que queda a medias) marcan lo que se ve.
   - **Marcar:** la casilla o un clic en la fila; **Shift+clic** marca o desmarca el rango desde la última tocada, en el
     orden que se ve. Lo tocado queda resaltado (turquesa si se suma; rojo y tachado si se saca) y el pie dice `+n −m`.
   - **Quién más la ve de afuera** se dice **una vez**, arriba de la tabla («N escenas ya las ven de afuera del equipo
     a, b: se ven entre ellos los comentarios y los correos», M5), sin contar a la persona elegida. Antes se repetía en
     cada fila.
   - La ventana mide hasta 1040 px; la tabla es lo único que se desplaza y el pie (lo que cambia, *Close*, *Save*) queda
     fijo. En una pantalla angosta, sin las columnas de locación, decorado, INT/EXT, páginas y afuera: la locación y el
     decorado van bajo el nombre y se desplaza la ventana entera, con el pie pegado abajo.
4. **Una escena con otra entidad adentro no se comparte** (sin opción para seguir): si en su rama (también en la papelera)
   hay una página que el registro reconoce como escena, locación, día o decorado, una con esa marca en sus ajustes o que
   guarda alguna (`settings.holds`), o una con título de escena (`sceneCode`), la fila queda apagada con el motivo
   (*Can't be shared: …*). Es el caso de un episodio («101 | Piloto») que el registro tomó por escena. *Select shown* no
   la marca.
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

**B-2:** hecha en la v0.324 (sección 10).

**B-3 (D14):** contar invitados y permisos Ver/Comentar vivos; **el orden de la restauración**: el script de restaurar
del repo privado tiene que cargar las páginas antes que los permisos y las invitaciones (o correr con
`session_replication_role = replica`, que apaga los triggers), porque si no `pages_scene_share_guard` frena una página
marcada adentro de una escena ya compartida o la escena compartida que cambia de ajustes; copia; `min_app_version`; prender el interruptor con un editor abierto.
**Hecho el 2026-11-06:** los dos scripts de restaurar cargan con los triggers apagados (verificado), copia de
seguridad antes, y `clean_min_version` = 0.319 (2 invitados, 3 permisos Ver/Comentar, 1128 páginas con lectores).
Falta la prueba de punta a punta con una persona real (un mail de prueba de Lega).

**Observación previa (no cambia con B-1):** *Share* (`share`) e invitar desde *Members* (`create_invitation`) sobre una
escena no pasan por `scene_contains_entities`: con ellos se puede compartir una escena que tiene adentro una locación o
un día, y ver esa rama. Una vez compartida, el trigger sí frena lo que se meta después. Para decidir con B-3.

**Bajo:** el aviso al crear por los otros caminos (plantillas, reporte del día, entidades nuevas, el asistente);
imágenes viejas `sdfile://` en escenas a compartir (B1: verificar que no haya); dos páginas con el mismo número de escena
(B4: se comparte la que se marcó). La fila de `pages` que baja un vendor trae `parent_id` (un id del padre que no ve),
`settings` y `created_by`: son ids y ajustes, no contenido; no se cambió.

## 10. B-2: pedir una escena desde su link (v0.324, D847)

Pedido de Lega: en PipeSync hay botones que linkean a una escena en el Panorama (`/map/scenes?project=…&scene=…`,
`Doc_Link_Escena.md`). Los reviewers ven el proyecto entero y entran directo. **Quien toca el link sin ver el proyecto (o
esa escena) cae en una página que dice «no tenés acceso a esto, ¿querés pedirlo?»; lo pide, y el dueño o los admins se
enteran y deciden si le dan acceso y a qué.** Hay NDA: nadie sin acceso puede saber nada del proyecto, ni si existe.

### 10.1 Quien pide

- **La pantalla** (`SceneRequestAccess` y `SceneNoAccess` en `src/ui/RequestAccess.tsx`): «You don't have access to this.
  Request access?» y *Request access*; después, «Request sent». **No muestra nada del link** (ni el proyecto ni la escena),
  y es la misma exista o no: el valor del link puede ser un texto armado para engañar (antes se mostraba recortado). Si
  ya lo pidió desde este dispositivo, «You asked for access on …» y *Ask again* (se anota por workspace y persona, como
  los pedidos de páginas). Sin red, con la base vieja, con un link público o sin saber de qué workspace es el link (sin
  `w=` y con más de un workspace en el dispositivo: el pedido iría a la base de otro), solo «You don't have access to
  this.» (y, en el último caso, el aviso de cambiar de workspace).
- **Dónde aparece:** (a) en el Panorama, cuando el `project=` no nombra ningún proyecto que la persona ve, después de la
  primera vuelta con el servidor (antes, «Opening project…»); reemplaza a «“X” isn’t a project you can see here»; (b) en
  la vista de la escena, cuando la persona ve **una parte** del proyecto (D401: un vendor con dos escenas) y la escena no
  está en lo que ve; reemplaza a «isn’t in the pages you can see». También si lo que ve del proyecto no tiene ninguna
  escena (antes caía en «This project has no scenes…» y no podía pedir); sin escena en el link, a esa persona la lista
  vacía le dice «Nothing you can see in this project has scenes…», nunca «no hay» (D401). «Ve una parte» es no tener
  permiso sobre el proyecto entero, **sin mirar el rol**: un admin con una sola escena también pide; (c) quien
  no ve ningún proyecto (`NoProjectsSceneAccess` en `src/ui/NoProjectsRoute.tsx`, desde `NoProjectsBoot` y
  `NoProjectsOpen`), en vez de «No projects yet». Quien ve el proyecto entero sigue leyendo «… isn’t a scene of …»: sabe
  que no existe. Un nombre que nombra dos proyectos que la persona ve sigue nombrándolos (los ve).
- **Lo que manda** (`sceneTarget` y `requestSceneAccess` en `src/sync/accessRequests.ts`): el proyecto como **id** si el
  link trae un id (*Copy link* pone el id desde la v0.317; PipeSync puede mandar un nombre), si no como **texto
  comparable** (`projectTextKey`: la regla exacta de `private.project_text_key`, letra por letra, que usa también el
  servidor en memoria; una prueba lee la migración y compara); y la escena como vino, sin espacios de más. Quien ve una
  parte del proyecto pide con el **id** solo si el link lo nombra sin dudas (trae su id o su nombre entero, o no trae
  proyecto); si acá coincidió solo por la primera palabra («ERSO» con «ERSO | Serie» a la vista), va **el texto del link**
  (`sceneRequestProject` en `src/ui/project.ts`): puede nombrar otro proyecto, uno que la persona no ve, y la base lo
  resuelve entre los de quien decide.
- **Sin cuenta:** el login de siempre. Con el código, la pestaña sigue en el link; el link del correo ahora también vuelve
  al link entero, con lo de después del `?` (`emailRedirectTo` en `src/ui/Login.tsx`). **No se pudo verificar** que
  Supabase acepte esa dirección con `?` en la lista de direcciones permitidas (si no la acepta, vuelve al inicio, como
  antes).

### 10.2 La base (`20261119120000_pedir_escena.sql`, versión 29)

- **Tablas** `scene_access_requests` (el pedido) y `scene_access_calls` (el tope), cerradas con RLS sin políticas y `revoke
  all`: solo las tocan las funciones. Aparte de `access_requests` (sus funciones publicadas no cambian).
- **`request_scene_access(p_project, p_project_text, p_scene)`** — cualquier miembro vivo con sesión permitida, también un
  invitado (el vendor que pide otra escena). **Nunca resuelve nada al pedir** (A1): guarda lo que vino y responde siempre
  `sent`, exista o no el proyecto o la escena; un id que no existe también deja su fila (sin clave foránea). Los únicos
  otros resultados no dependen de lo que hay en la base: `not_member`, `target_invalid` (lo mal formado) y `rate_limited`
  (solo por el tope de llamadas). **Nada de lo que decida quien decide cambia la respuesta**: sin tope de pedidos
  abiertos al pedir (un rechazo sacaba la fila de la cuenta y quien pide lo notaba al pasar de `rate_limited` a `sent`:
  oráculo de que el proyecto existe, re-verificación de B-2); un repetido rechazado da `sent` como uno pendiente. Al
  pedir se borran las filas propias creadas hace más de 30 días, en cualquier estado (depende solo de cuándo pidió la
  persona): la tabla no crece sin fin.
  **El tope cuenta todas las llamadas**, repetidas o no: 20 cada 24 horas por persona, en una fila por persona que se
  suma antes de mirar nada más; la 21 da `rate_limited` exista o no lo pedido (y el error deshace también la cuenta, así
  la ventana no crece). Un pedido repetido (persona, id o texto, escena sin mayúsculas) renueva su fila como mucho una
  vez por hora. Un rechazo de hace menos de un día deja el pedido nuevo en `void` (no se lista); pasado el día, al volver
  a pedir vuelve a `pending`. El mismo candado por persona que los pedidos de archivos y páginas.
- **`scene_access_requests_pending()`** — solo **dueño o admin** del workspace (B2, B3). **Resuelve al leer, y solo entre
  los proyectos que quien mira puede compartir** (`can_share` dentro de `scene_request_projects`, **antes** de comparar
  el nombre entero): un id, si el proyecto existe, no está borrado y lo puede compartir; un texto, entre los suyos sin
  borrar, por el nombre entero o, si ninguno de los suyos se llama así, por la primera palabra (como `projectMatches`).
  Si el filtro fuera después, «erso» no le llegaría a un admin que comparte «ERSO | Serie» porque existe otro «Érso» que
  no ve, y eso le diría que existe (oráculo, auditoría de B-2). Una fila por proyecto (un texto que nombra dos da dos
  filas, y decidir una cierra las dos). De cada persona, solo sus 20 pendientes más nuevos (`row_number()` por persona,
  antes de resolver el proyecto): el tope de abiertos vive acá, en lo que quien pide no ve. No muestra el pedido de quien ya ve ese proyecto entero, el de alguien sacado,
  los propios ni los de más de 30 días. Devuelve el id del proyecto (la app pone el nombre, que ya tiene), el texto del
  link (`project_text`: lo escribió quien pide, no dice nada que no sepa), si el proyecto salió por el id o el nombre
  entero o por la primera palabra (`exact`) y la escena como vino; nunca cuántos proyectos coinciden. Costo: por pedido
  pendiente, un `can_share` por proyecto vivo con texto (decenas) o uno con id.
- **`decide_scene_access_request(p_id, p_accept, p_project, p_page, p_level)`** — dueño o admin que puede compartir
  `p_project`, que tiene que ser uno de los que resuelve el pedido; si no (o el pedido no existe, ya se decidió, es de más
  de 30 días o es propio), el mismo `request_not_found`. Rechazar es explícito. **Dar acceso llama a `set_page_shares`**
  con esa sola página y el correo de quien pidió (M6): el interruptor de lo borrado (`clean_off`), nivel `view` o
  `comment`, la página **marcada como escena de ese proyecto** y viva (`page_invalid`), nada adentro marcado como otra
  entidad (`scene_contains_entities`), el candado por correo, el permiso que nunca baja y la base limpia de la rama.
  Ninguna regla de seguridad se repite. Antes: el nivel (`level_invalid`), la página (`page_invalid`) y que quien pidió
  siga siendo miembro (`member_not_found`: si no, `set_page_shares` lo invitaría como alguien nuevo), con la fila de su
  membresía bloqueada (`for share`) hasta el final, contra un `remove_member` a la vez. Quién puede decidir desde qué
  proyecto sale de la misma `scene_request_projects` que la lista.

### 10.3 Quien decide

- **La campana** suma los pedidos de escenas para dueño y admins con la base en la 29 (`sceneRequestsEnabled`,
  `AccessRequestsInbox.setScenes`): «<correo> asks for scene <lo del link> of <proyecto>», con el rol y cuándo.
- **La ventana** (`SceneRequestForm` en `src/ui/AccessRequests.tsx`): muestra lo que decía el link del proyecto («The
  link said “…”.») y busca la escena del link entre las del proyecto con el lector del Panorama (`resolveProjectScene`,
  que usa `resolveSceneParam`). Si aparece y el proyecto salió por el id o por el nombre entero, **la lista queda fija en
  ella**. Si no aparece («The link asked for “…”…»), o el proyecto salió solo por la primera palabra («The link said
  “mor”, which only matches the first word…»: puede ser otro proyecto, y la escena **no se elige sola**), se elige a mano
  y el primer *Give access* muestra «The link asked for “X”, you're giving Y. Give access?» con *Yes, give access*;
  cambiar la escena o el nivel lo vuelve a pedir. Se puede rechazar siempre. Las escenas salen de `projectSceneItems`
  (`src/ui/projectScenes.ts`), lo mismo que *Share scenes*: **antes de *Give access* dice qué es y cuántas páginas lleva
  adentro** («Scene · 3 pages inside», M6), y una escena con otra entidad adentro sale apagada y, elegida, con el motivo.
  Nivel *Can view* (de fábrica) o *Can comment*. Sin el interruptor de lo borrado, el aviso y *Give access* apagado
  (rechazar sí se puede). Dar acceso escribe la marca de escena si falta y espera a que suba (`markScenes`), pasa por la
  compuerta sin *Share anyway* y, después, arma las bases limpias y vuelve a pedir la marca del árbol. Los errores de
  `set_page_shares` se dicen con las frases de *Share scenes*.
- **B3, decidido sin Lega (D847):** los pedidos les llegan al **dueño y a los admins del workspace que pueden compartir
  el proyecto**, que son quienes pueden dar la escena (*Share scenes* es de dueño y admins, D843 (3)). Un dueño o admin
  **sin permiso sobre el proyecto no los recibe**: no ve el proyecto (la regla de NDA vale también para él: ni su nombre ni
  que existe) y no podría darla. Tampoco quien creó el proyecto siendo miembro común: puede compartirlo con *Share*, pero
  no darlo como escena. Un proyecto que solo puede compartir un miembro que lo creó no le llega a nadie; queda escrito.

### 10.4 Pruebas

- **SQL** (`supabase/tests/pedir_escena_permisos.sql`, en `begin … rollback`, termina en `select 'ok'`): las puertas y la
  normalización; pedir (siempre `sent`, quién, lo mal formado, el texto normalizado, los repetidos, **la 21 da lo mismo
  exista o no**, el tope por persona y su ventana); la lista (resolver el texto, el nombre entero gana, una palabra que
  nombra dos, quién la ve y quién no, quien ve el proyecto entero, sacado, 30 días); decidir (`clean_off`, quién no puede,
  un proyecto que no es del pedido, las reglas de la página de `set_page_shares`, dar una vez, nunca baja, «mor» desde
  uno, sacado, rechazar y el `void` del día). Después de la auditoría: la lista y decidir resuelven solo entre los
  proyectos de quien mira (con EX vivo, para `a` «erso» es PR y lo decide desde PR), el texto del link y `exact` en la
  lista, decidir uno propio, y el borrado de lo viejo al pedir; los chequeos de «no está en la
  lista» exigen una lista (un `error:…` ya no pasa por vacía). Corrió contra la base real en una transacción que se deshace
  en cada vuelta de auditoría (tres) y dio `ok`. Después
  de la re-verificación: con 20 abiertos, uno nuevo, uno repetido pendiente y uno repetido rechazado dan `sent`; el
  borrado por `created_at` en cualquier estado; la lista con 22 pendientes de una persona trae sus 20 más nuevos y los
  de los demás enteros. Tampoco corrió todavía.
- **App** (`src/ui/sceneRequests.test.tsx`, contra el servidor en memoria con las mismas reglas en `src/sync/testing.ts`):
  las reglas con **24 mutantes** (`SCENE_REQUEST_MUTANTS`: `member`, `sameAnswer`, `allCalls`, `dedup`, `listRole`,
  `listShare`, `listExact`, `shareFirst` —el filtro antes del nombre entero—, `projectText`, `listOwn` —segunda capa, con
  `listSees` también afuera—, `listSees`, `listRecent`, `listRemoved`, `decideRole`, `decideShare`, `decideCandidate`,
  `decideState`, `decideOwn`, `decideRecent`, `decideMember`, `reuse` —dar acceso pasa por `set_page_shares`—, `level`,
  segunda capa que se prueba con `reuse` también afuera, `openCap` —los 20 pendientes más nuevos por persona en la lista,
  con uno nuevo y uno rechazado que siguen dando `sent`— y `cleanup` —el borrado por `created_at`—), todos detectados; la normalización igual a la de
  la migración (la prueba lee el `translate` del archivo); el borrado de lo viejo al pedir; la pantalla sin acceso (igual exista o no, sin nada del link, *Request access*
  y «Request sent», el dispositivo que recuerda, el tope en palabras, la base vieja, sin proyectos, el invitado que ve una
  escena y pide otra por el id; el link por la primera palabra va como texto y por el nombre entero como id; un admin con
  una sola escena pide; quien ve una parte sin ninguna escena pide y no lee «no hay»); la ventana de decidir (la escena
  del link fija, qué es y cuántas lleva adentro, la marca escrita antes, el permiso dado; por la primera palabra, a mano
  y con la confirmación; una escena del link que no aparece; sin el interruptor; una escena con una locación adentro). `src/ui/loginFile.test.tsx`: el correo vuelve al link de la escena. `sceneLink.test.tsx` y
  `scenesSection.test.tsx`: ajustados a la pantalla nueva.

### 10.5 Lo que no se verificó y lo que queda

- **La prueba SQL corrió contra la base real** en una transacción que se deshace en cada vuelta de auditoría, y al
  aplicar la migración con la v0.324 (2026-11-06) las 50 pruebas de permisos dieron `ok`. No se midió el costo de la
  lista con la base real.
- La columna generada con el nombre normalizado en `workspaces` (opcional en la auditoría) no se hizo: `translate` no
  cambia de un nombre a otro y los proyectos son decenas; si la lista se pone lenta, es lo primero.
- **No se vio en el navegador con sesión real** (el pedido y la ventana, contra la base real, necesitan la 29).
- La dirección con `?` del link del correo de login en la lista de Supabase (10.1).
- **Sin paso en los recorridos** (como *Share scenes*, D843 (12)): pedir necesita un link de otro proyecto y la base, y
  decidir, otra persona; la página de práctica no tiene ninguno. Va en la ayuda (*Ask for a scene from its link*).
- Quien pide no sabe nunca si se le dio: el proyecto le aparece con la próxima sincronización y el link se abre (como los
  pedidos de páginas). Avisarle (un correo, la campana) queda para Lega.
- Dos pedidos de la misma persona por la misma escena en dos formas (`1066` y `101_066`) son dos filas: decidir una no
  cierra la otra, que queda pendiente hasta decidirla (dar de nuevo no cambia nada) o que pasen 30 días. Bajo.
- Una carrera de la inbox (pre-existente): una pregunta pedida justo cuando termina otra puede devolver la lista de antes;
  la próxima vuelta (60 s, o al abrir la campana) la corrige.

## 11. Vendors por proyecto y *Can share scenes* (v0.331, D852)

Pedido de Lega (2026-11-09): que un productor o coordinador de post con permiso de comentar pueda compartir escenas con
los vendors, y vendors por proyecto armados en la misma ventana, con color, más de un correo y escenas asignadas antes de
tener correo. Lega aprobó la maqueta (en `LGA_RepoTools`, `DISENO.md`) y las decisiones de D852.

### 11.1 El modelo

- **Un vendor** (`scene_vendors`): proyecto, nombre (1 a 80), código (0 a 4 letras o números; vacío: la app muestra las
  primeras letras del nombre), color (`#rrggbb`, la paleta de los proyectos), nivel **Ver o Comentar**, quién lo creó y,
  si se borró, cuándo y quién (borrar marca: la fila y lo asignado quedan).
- **Sus correos** (`scene_vendor_emails`): cero o más. **Un correo, un solo vendor vivo por proyecto.**
- **Sus escenas** (`scene_vendor_scenes`): páginas con la marca de escena del proyecto, vivas al asignarlas, sin otra
  entidad adentro. Una escena puede estar en varios vendors. **Una escena asignada que deja de cumplirlo** (le sacan la
  marca, la marcan como carpeta o le mueven una entidad adentro mientras el vendor no tiene correos, que es cuando nada
  lo frena) **no se le da a nadie** (`private.vendor_scene_ok`): ni a un miembro, ni al aceptar una invitación, ni la
  cuenta `project_page_shares`; la ventana la muestra bloqueada en el vendor (`ok` en la lista) y se puede sacar.
- Las filas de `scene_vendor_scenes` y `scene_vendor_emails` se borran al sacar una escena o un correo (son una
  asignación, no contenido de nadie); el vendor, en cambio, se marca como borrado.
- **Sin correos es solo planificación**: no comparte nada. **Cada correo ve todas las escenas de su vendor** con su nivel,
  y lo de adentro: es un permiso por página (sección 1), así que la lectura (RLS) no cambió.
- Las tres tablas están cerradas: solo las tocan las funciones de abajo. **Un vendor nunca ve la lista de vendors.**

### 11.2 Quién los maneja (`private.vendor_cap`)

- El **dueño o un admin que puede compartir el proyecto**: hasta Comentar.
- Quien tiene **Can share scenes** en un permiso vivo sobre el proyecto (también un invitado): hasta **su propio nivel**
  sobre el proyecto (con Ver, solo Ver), y solo escenas que ve. Tiene control total sobre **todos** los vendors del
  proyecto, también los que armó otro (D852 (2)). **No puede cargar su propio correo** (`own_email`): le quedarían
  escenas por vendor el día que le sacaran el permiso del proyecto. Ve los correos de todos los vendors y si cada uno ya
  entró (*in*): es lo que necesita para coordinar, y por eso puede saber si un correo es del equipo.
- La casilla (`grants.share_scenes`, solo sobre un permiso de proyecto) la ponen y la sacan el dueño y los admins que
  comparten el proyecto (`set_share_scenes`), en *Share “<proyecto>”*, en cada persona con permiso sobre el proyecto.
  Sacarla no toca lo que compartió (D852 (3)). Revocar el permiso la apaga, y volver a compartir no la devuelve.
- En la app: `Permissions.canShareScenes` y `vendorCap`; las entradas (el menú *Share* del selector y *Share scenes…* del
  Panorama) piden además la base 31. A quien tiene la casilla sin poder compartir el proyecto, el menú *Share* le trae
  solo *Share scenes*.

### 11.3 La base (`20261121120000_vendors.sql`, versión 31)

- `scene_vendors_list(p_project)`: para quien los maneja; `cap`, `admin`, los vendors vivos con sus correos (`joined`:
  miembro activo; `invited`: con una invitación viva de ese vendor; `expired`) y sus escenas (`alive`), y `others`: las
  páginas que ven personas de afuera **sin** vendor (permisos o invitaciones de antes, o *Share*).
- `save_scene_vendors(p_project, p_ops)`: hasta 100 operaciones `create` / `update` / `delete`, **todo o nada**. Valida
  quién guarda, el interruptor de lo borrado, la forma de la lista, cada vendor (del proyecto, vivo, una sola vez), los
  campos, **el nivel** (crear o subir por encima del propio, o sumar escenas o correos a un vendor de más nivel:
  `level_not_allowed`; bajar y sacar, siempre), cada escena que entra (del proyecto, viva, con la marca, que quien guarda
  puede compartir o ve, sin entidades adentro), los correos, los topes (100 vendors, 30 correos por vendor, 1000 cambios
  de escenas y 200 de correos por guardado) y **un correo en un solo vendor** (mirado al final: un correo pasa de un
  vendor a otro en un guardado). Después sincroniza cada correo tocado y devuelve `keys` (los ids de los nuevos), `reset`
  (lo que empieza a verse) y `pending` (correos de afuera con invitación viva).
- `private.vendor_sync_email`: deja lo que un correo ve por vendors igual a lo que dicen los vendors. A un **miembro
  activo**: permisos por página con `grants.vendor_id` (los saca, les cambia el nivel y suma los que faltan; no le da
  nada si ya ve más). **Un permiso propio de la persona** (de *Share* o de un pedido, sin vendor) **no se lo toma el
  vendor**: queda como estaba, aunque el vendor tenga más nivel, y sacarla del vendor no se lo lleva. A **alguien de afuera**: **una invitación de invitado por vendor** (`invitations.vendor_id`) sin
  páginas; **al aceptarla se dan las escenas que el vendor tiene en ese momento** (`accept_invitations`). Así lo que el
  vendor cambia vale también para quien todavía no entró, y no hay tope de 200 páginas por invitación.
- Las invitaciones de vendors no las hace un dueño o admin: valen mientras el vendor, el correo y el proyecto sigan
  (`private.invitation_live`). *Members* no las muestra (`list_invitations`); el registro las acepta (el hook); la marca
  del árbol, el sí o no de quien edita, el freno de movimientos y `project_page_shares` las cuentan.
- `grants_vendor_guard`: otro camino que revoca, revive o cambia el nivel de un permiso de vendor le saca el vendor (si
  no, el vendor después lo sacaría o lo bajaría sin ser suyo); revocar o revivir apaga *Can share scenes*.
- `list_access` suma `share_scenes`.
- **Conversión:** lo compartido antes a **invitados** persona por persona (permisos vivos de Ver o Comentar sobre
  escenas) pasa a un vendor por persona y proyecto, con su correo y el **nivel más bajo**: entran las escenas de ese
  nivel; las de más nivel quedan como permisos sueltos (un correo va en un solo vendor), así nadie gana ni pierde nada.
  Los miembros del equipo no se convierten (lo suyo vino de *Share*). En la base real no había nada para
  convertir (2026-11-09).

### 11.4 La ventana (`ShareScenesDialog.tsx`)

- A la izquierda, **los vendors** (color, nombre, código, Ver o Comentar, cuántas escenas y correos, lo que cambia) y
  **All vendors**, el reparto completo, sin casillas. *New vendor* abajo.
- Arriba, **la ficha del vendor elegido**: color (el mismo selector que el color del proyecto), nombre, código, Ver o
  Comentar (Comentar apagado si quien comparte solo ve; a un vendor con Comentar, quien solo ve no le suma escenas ni
  correos, y lo dice antes de guardar), borrar (con confirmación), y los correos con su estado (*in*,
  *invited*, *invitation expired* con *Invite again*, *invited on save*, *removed on save*). Un correo que ya está en
  otro vendor no se suma: lo dice.
- **La tabla de la v0.330** (sección 2) con la columna *Vendors*: un chip por vendor con su código (punteado: sin correo;
  tachado: se saca), el triángulo cuando dos vendors con correo ven la escena, y las personas de afuera sin vendor. Vistas:
  *All*, *Of <vendor>*, *No vendor*, *2+ vendors*, *Can't be shared*. El buscador también encuentra el código del vendor.
  Una escena sin la marca la escribe al guardar quien edita; para quien no edita, la fila queda apagada con el motivo.
- **Un solo *Save*** manda todo. Antes: la marca de escena (quien edita) y la compuerta de lo borrado, sin *Share anyway*,
  para lo que empieza a verse. Después: las bases de lo reiniciado (quien edita), la marca del árbol y, si se sumaron
  correos, el link de invitación copiado (uno sirve para todos).

### 11.5 Pruebas

- `supabase/tests/vendors_permisos.sql`: las puertas, quién maneja, crear y cambiar con los niveles, cada escena,
  correos, planificación, miembro e invitación, aceptar trae las escenas de ese momento, sacar, bajar y borrar revocan,
  el freno de movimientos, la casilla y `list_access`, el `vendor_id` que otro camino toca, y lo que encontró la
  auditoría: una escena que dejó de poder compartirse no se da, un permiso propio no se lo toma el vendor, uno no se
  carga a sí mismo con la casilla, y la invitación de un proyecto borrado no vale. Corrió contra la base real
  en una transacción que se deshace, con la migración adelante: `ok`; cae sin la migración y con los mutantes del tope,
  del nivel, del correo único, de la marca del árbol y del trigger (uno equivalente: el vendor vivo de la invitación, que
  la sincronización ya cubre). La conversión se probó aparte con datos de prueba.
- `src/sync/vendors.test.ts`: las mismas reglas en el servidor en memoria, con un mutante por chequeo
  (`VENDOR_MUTANTS`), y los permisos del cliente.
- `src/ui/shareScenes.test.tsx`: la ventana (crear, planificar, cargar un correo, invitar, dos vendors, un correo en otro
  vendor, Shift+clic, vistas, borrar y sacar, errores, la compuerta, sin red, el orden, con la casilla y Ver), la casilla
  en *Share* y las entradas.

### 11.6 Lo que queda

- **Sin paso en los recorridos**, por lo mismo que *Share scenes* (D843 (12)): necesita otra persona y la base 31. La
  ayuda (*Share scenes with vendors*) lo explica.
- El correo de entrada sigue saliendo por el SMTP con su tope de 30 por hora: si muchos vendors entran a la vez, alguno
  espera.
- El color del vendor se ve solo en esta ventana (no en la barra lateral ni en el Panorama).
- Separar los comentarios por vendor (que dos vendors de una escena no se vean) queda para otra tanda.
- Una pestaña con la v0.330 abierta todavía comparte persona por persona (`set_page_shares`), por fuera de los vendors:
  por eso `min_app_version` sube a 0.331 apenas se publica.
- Partir una escena por planos entre vendors, también.

## 12. El equipo de un vendor y sus artistas (v0.334, D854)

Pedido de Lega (2026-11-09): que un vendor (el productor o el coordinador de post a quien se le compartieron escenas)
pueda, desde el ⋯ del proyecto, compartirle **todo** a otra persona de su equipo, y **repartir sus escenas entre
artistas** (un 3D, dos compositores, uno de roto…), con artistas armados antes de tener correo, igual que los vendors.
El dueño ve todo lo que se armó debajo de cada vendor y lo puede sacar. Lega aprobó la maqueta (en `LGA_RepoTools`,
`DISENO.md`) y las decisiones de D854.

### 12.1 El modelo

- **El equipo de un vendor** son los correos del vendor (sección 11.1): cada uno ve todas sus escenas, como antes.
  **Lo que suma el equipo queda marcado** (`scene_vendor_emails.by_team`).
- **Un artista** es un vendor hijo (`scene_vendors.parent_id`), en la misma tabla: nombre, código, color, nivel, correos y
  escenas. Así reusa todo lo de los vendors: un correo en un solo lugar vivo del proyecto (vendor o artista), el acceso que
  se arma solo (`vendor_sync_email`), las invitaciones de vendor, la marca del árbol y el freno de movimientos.
- **Un artista**: solo escenas que el vendor tiene y que hoy se pueden dar; **nunca más nivel que el vendor**; sin correos
  es solo planificación; **no comparte nada** (no tiene equipo ni artistas). Hasta 100 por vendor.
- **Lo que le pasa al vendor arrastra a sus artistas** (`private.vendor_artists_follow`): sacarle una escena se la saca a
  sus artistas, bajarlo a Ver los baja a Ver y borrarlo los borra. Se hace en la base, en el mismo guardado; la ventana
  de vendors de la 0.331 a la 0.333 (que no ve a los artistas) lo arrastra igual.

### 12.2 Quién hace qué

- **El equipo** (quien tiene su correo confirmado en un vendor vivo, sin padre, de un proyecto vivo:
  `private.vendor_team_of`):
  - *Share all scenes…*: suma y saca correos del equipo. **Solo saca lo que sumó el equipo** (`email_locked`): lo que
    sumó el proyecto lleva candado. **Nunca se saca a sí mismo** ni se carga como artista (`own_email`). El nivel lo
    decide el proyecto.
  - *Share scenes with artists…*: crea, cambia y borra artistas de su vendor, con todo lo de arriba.
  - **Nunca ve los otros vendors** ni a quién más se compartió una escena: si un correo ya está en otro vendor o artista
    del proyecto, la base contesta `email_in_use` sin decir cuál (la app: «Ese correo ya está en otro vendor o artista de
    este proyecto. Pedile al proyecto que lo revise.»). Un correo que ya ve páginas por *Share*, o que es miembro del
    workspace, sí entra: pasa a ver también las escenas del vendor (como cuando lo carga el proyecto).
  - En su ⋯ del proyecto: *Available offline…* y estas dos. Color, renombrar, compartir, archivar y borrar ya no estaban
    (piden permisos que un vendor no tiene); *Export* aparece solo si además tiene un permiso sobre el proyecto entero.
- **Un artista** no tiene nada de esto: ve sus escenas y lo de adentro.
- **El proyecto** (sección 11.2: dueño, admin, o quien tiene *Can share scenes*) ve, debajo de cada vendor, sus artistas
  con sus correos y escenas, y los correos que sumó el equipo marcados *added by <vendor>*. **Puede borrar un artista o
  sacarle correos**; no le reparte escenas (eso lo arma el vendor). Tiene control total sobre el vendor, con el arrastre
  de arriba.

### 12.3 La base (`20261122120000_vendor_artistas.sql`, versión 32)

- `vendor_team(workspaces)`: columna calculada que viene con la lista de proyectos (`select=…,vendor_team`): si la
  sesión es del equipo de un vendor de ese proyecto. Con ella el ⋯ ofrece las dos entradas.
- `vendor_team_get(p_project)`: para el equipo; `me` (su correo), **su** vendor (nombre, código, color, nivel, correos
  con `by_team`, escenas con `alive` y `ok`) y sus artistas. Nada de los otros vendors.
- `save_vendor_team(p_project, p_ops, p_vendor)`: hasta 100 operaciones, **todo o nada**. De qué vendor es la sesión se
  mira **después** del candado del proyecto (el mismo de `save_scene_vendors`): así, si el proyecto borra el vendor al
  mismo tiempo, el equipo no deja un artista vivo debajo de un vendor borrado (lo encontró la auditoría). `p_vendor` es
  el vendor que la ventana tenía abierto: si la sesión ya es de otro, `vendor_changed` y no guarda nada. Operaciones: `team` (sumar, sacar, volver a
  invitar), y `create` / `update` / `delete` de un artista de su vendor. Valida quién guarda, el interruptor de lo
  borrado, la forma, los candados, el propio correo, el nivel, cada escena (del vendor y que hoy se puede dar: una sola
  respuesta, `page_invalid`, que no dice cuál), los topes y el correo único (mirado al final). Sincroniza cada correo
  tocado y devuelve lo mismo que `save_scene_vendors`.
- `scene_vendors_list` trae solo los vendors (sin padre), cada uno con `artists`, y cada correo con `by_team`.
- `save_scene_vendors`: sobre **un artista** el proyecto solo puede `delete` o `update` con `remove_emails` (otra cosa:
  `ops_invalid`); después de cada operación sobre un vendor, el arrastre. Un correo que suma el proyecto queda con
  `by_team` falso.

### 12.4 Las ventanas

- **`VendorTeamDialog.tsx`** (*Share all scenes of “<vendor>”*): el nivel (lo decide el proyecto), el equipo con su
  estado y quién lo sumó (candado en lo del proyecto; *you* en uno mismo), un campo para sumar, y *Save* / *Invite &
  save*, que copia el link de invitación.
- **`ShareScenesDialog.tsx` con `artists`** (*Share scenes of “<vendor>” with artists*): la misma ventana de los vendors,
  con solo las escenas del vendor, *Artists* en lugar de *Vendors*, sin lectores de afuera, y Comentar apagado si el
  vendor tiene Ver («Up to View: the access <proyecto> gave <vendor>.»).
- **En la ventana del proyecto**, la ficha de cada vendor suma el bloque *<vendor> artists*: chip, nombre y nivel,
  correos (con sacar y deshacer), sus escenas y borrar (con deshacer). La lista de vendors cuenta los artistas. Si se le
  saca al vendor una escena que tiene algún artista, o se lo baja a Ver con artistas que comentan, lo avisa antes de
  guardar; borrar un vendor con artistas lo dice en la confirmación.
- De paso: la rejilla de la ventana ya no se encoge por debajo de lo que tiene adentro (a un ancho mediano la tabla se
  le montaba a los avisos de abajo), y «falta que entren…, el link ya está copiado» se dice solo si ese guardado invitó y
  el link se copió.

### 12.5 Pruebas

- `supabase/tests/vendor_artistas_permisos.sql`: las puertas, quién es del equipo, el equipo suma y saca (candados,
  propio correo, correo de otro lado sin decir dónde), los artistas (escenas del vendor, nivel, planificación, correo
  único) y lo que ve y hace el proyecto (la lista con artistas, lo que puede tocar de un artista, el arrastre de
  escenas, nivel y borrado). Corrió contra la base real en una transacción que se deshace, con la migración adelante:
  `ok`; y la de vendors (`vendors_permisos.sql`) sigue en `ok` con la migración puesta.
- `src/sync/vendorArtists.test.ts`: las mismas reglas en el servidor en memoria, con un mutante por chequeo
  (`ARTIST_MUTANTS`: quién es del equipo, candados, propio correo, nivel y escenas del artista, lo que el proyecto le
  hace a un artista, la lista, y los tres arrastres), de punta a punta, y la lectura de las respuestas.
- `src/ui/shareScenes.test.tsx`: el ⋯ de quien es del equipo (y de un artista, y con la base 31), *Share all scenes*
  (candado, uno mismo, un artista, invitar y sacar), *Share scenes with artists* (solo las del vendor, un artista con
  una escena y un correo) con el tope de nivel, y lo que ve y hace el proyecto con los artistas.
- Con clics, en el arnés (`src/dev/barra-lateral.html?compartir` y `?equipo`): el ⋯ de Vera, las dos ventanas, sacarle a
  DNEG una escena que tiene una artista, borrar un artista y sacarle un correo; en escritorio, a ancho mediano y en el
  teléfono.

### 12.6 Lo que queda

- **El equipo puede saber si un correo ya es miembro del workspace**: sumándolo, ve *in* en lugar de *invited* (y lo
  puede volver a sacar, porque lo sumó él). Es lo mismo que ve el proyecto en la ventana de vendors; queda anotado para
  que Lega decida si al equipo hay que mostrarle menos.
- Cuando el equipo hace que una escena empiece a verse, la base reinicia su copia limpia, pero la arma recién el próximo
  editor que sincronice (el equipo no edita): mientras tanto el artista nuevo ve la escena preparándose.

- **Sin paso en los recorridos**, por lo mismo que *Share scenes*: lo usa un invitado que recibe escenas de un vendor
  (necesita otra persona y la base 32). La ayuda (*A vendor's team and its artists*) lo explica.
- Dos artistas de una misma escena se ven entre sí (comentarios y correos), y el resto del vendor también los ve: dentro
  de un vendor se aceptó (D854). Separar los comentarios sigue para otra tanda (sección 11.6).
- Con la v0.331 a la 0.333 abierta, el proyecto no ve a los artistas (sí el arrastre); `min_app_version` sube a la 0.334
  apenas se publica.

## 13. Importar vendors desde una planilla (v0.335, D855)

Desde la ventana de vendors, *Import from spreadsheet…* (debajo de *New vendor*, solo en la del proyecto) asigna escenas a
vendors desde un breakdown en Excel o CSV. Lo usan los mismos que manejan los vendors. No hay nada nuevo en la base: la
importación arma el borrador de la ventana y *Save* lo manda con `save_scene_vendors`, con todas sus reglas.

### 13.1 Leer la planilla (`vendorImport.ts`)

- **En el dispositivo, sin librería.** Un .xlsx es un zip de XML: se leen del archivo solo el final (el directorio
  central) y las partes que hacen falta (`workbook.xml`, sus relaciones, `sharedStrings.xml` y las hojas), con
  `Blob.slice`, y se descomprimen con `DecompressionStream('deflate-raw')`. Las imágenes nunca se leen: la planilla de
  ERSO pesa 323 MB por las miniaturas de cada plano y se lee en 0,3 s. Las hojas ocultas no se ofrecen. Un CSV (hasta
  50 MB) se parte con comillas y el separador que más aparece en el primer renglón. Un .xls viejo, un .numbers o un zip
  roto dan «guardalo como .xlsx o .csv»; ZIP64 (más de 4 GB) no se lee.
- **El encabezado** se busca en las primeras 40 filas: la que tiene una columna de shot (`SHOTNAME`, `Shot name`,
  `Shot`, `Plano`…) y una de vendor (`VENDOR`, `Proveedor`…); la letra, si hay una de clip (`SUBCLIP`, `Clip`). Se
  propone la primera hoja que lo tiene. Si no lo encuentra, se elige la fila del encabezado y las columnas a mano.

### 13.2 De cada plano, la escena y sus vendors

- **La escena sale del shot name**: `<prefijo>_<escena>_<plano>` (`ERSO_1016_0300` → 1016, `ERSO_1033A_0100` → 1033A,
  `PROY_074_010` → 074). Se cruza con la clave de cada escena del proyecto en la misma forma (`101_016A` → 1016A). La
  columna ESC de una planilla no se usa: en la de ERSO, 533 filas no coinciden (`1001.0`, `101.0` por 1001).
- **Dos episodios que terminan igual** (101_016 y 201_016 dan los dos 1016): la clave queda sin escena y el plano va a
  «No se pudo saber cuál», como hace el resto de la app (`episodeOfDigit`): no se adivina. Un episodio sin una sola
  cifra de post (110) no tiene clave.
- **La letra, del clip**, solo si el proyecto tiene esa escena con letra y no sin ella: `101_16A2-01-06` → 1016A (el
  número del clip tiene que ser el de la escena, y si el clip dice el episodio, también: `102_16A…` no es de la 1016).
  Si el clip no la dice, la escena va a «No se pudo saber cuál».
- **Los vendors**: la celda se parte por coma, punto y coma o barra.
- **El CSV**: el separador es el que está en más renglones de los primeros 40 (un renglón de resumen con una coma arriba
  de un CSV con punto y coma no lo cambia). El Excel se lee también con etiquetas con prefijo (`<x:row>`); una parte
  que descomprimida pasa los 256 MB se corta con «muy grande».
- Una fila cuyo shot name no tiene esa forma se saltea y se cuenta.

### 13.3 Los pasos

1. **Archivo**: la hoja, la fila del encabezado, las tres columnas y una muestra de hasta cinco planos distintos (uno
   exacto, uno con dos vendors, uno resuelto por la letra, uno sin página). *Next* pide que la columna de shot tenga al
   menos la mitad de shot names y que haya algún vendor.
2. **Vendors**: cada nombre de la planilla, con cuántos planos y escenas, se une a un vendor del proyecto, se crea (código
   propuesto: `Wanka` → WAN, `Boat` → BOAT, `Many-Worlds` → MW, `Net-Fx` → NFX; el primer color libre de la paleta de
   proyectos), se une a otro nombre de la planilla o se omite. Se propone unir a un vendor del proyecto que se escribe igual
   o a una letra (`similarNames`), y si no, a otro nombre más usado (o, empatados, el primero) que se escribe casi igual.
   Todo lo que no es el mismo nombre o código (`sameVendor`) lleva «sugerido», también un vendor del proyecto parecido
   (`Wanko` → *Wanka*), y la marca sigue al volver al paso. Una unión va siempre al nombre final, nunca en cadena. El código
   propuesto no repite el de otro vendor (`WAN` → `WAN2`). Cambiar la columna del plano o de la letra no borra lo elegido;
   la de vendor, sí. Cada vendor nuevo necesita nombre.
3. **Revisar**: cuatro números que filtran la lista (lo que se suma, lo que cambia de vendor, lo resuelto por la letra,
   lo que no tiene página) y el detalle: se suman (por vendor); cambian de vendor (la escena está en un vendor que la
   planilla ya no le da: marcada, se le saca; sin marcar, se queda y el nuevo se suma; vienen desmarcadas); resueltas por
   la letra; no se pudo saber cuál; no se pueden asignar (bloqueadas, sin la marca de escena y quien importa no edita, o un
   vendor en Comentar con quien importa en Ver); sin página («seguramente surgieron en post: no se importan»); sin vendor.
   Las escenas de la planilla son las únicas que se miran: las demás no se tocan, y ningún vendor se borra. Si el total pasa los
   1000 cambios de escenas de un *Save*, no deja aplicar y lo dice.

**Aplicar** cierra la ventana y deja todo en el borrador de la de vendors, como si se hubiera marcado a mano (los vendors
nuevos, sin correos, con el nivel más alto que da quien importa), con un aviso arriba de lo que se marcó, que se va al
guardar. Escape cierra solo la importación.

### 13.4 Pruebas

- `vendorImport.test.ts`: el zip (comprimido y guardado tal cual) con una hoja oculta, texto compartido, en línea y con
  formato; el CSV; los errores; el encabezado con filas de resumen arriba; la escena y la letra; los nombres parecidos y
  el empate; lo propuesto; el análisis con todos los casos; lo que cambia contra lo asignado.
- `vendorImport.test.ts`, «lo que encontró la auditoría»: 101 y 201, el episodio 110 y el del clip, el CSV con resumen
  arriba y comillas con espacio, `sameVendor`, sin cadenas de uniones, códigos sin repetir, entidades fuera de rango, `<t/>`
  vacío y etiquetas con prefijo.
- `shareScenes.test.tsx`, «importar desde una planilla»: de punta a punta contra el servidor en memoria (une, crea,
  reemplaza solo lo confirmado, nada se guarda hasta *Save*); e «importar sin poder editar»: la escena sin marca va a «No se
  pueden asignar», y Escape cierra solo la importación.
- Contra la planilla real de ERSO, a mano: 19 hojas visibles, `BREAKDOWN_SHOTS` elegida sola, 839 planos, 124
  asignaciones en 99 escenas, 1016 y 1038 por la letra, 27 escenas sin página.

### 13.5 Lo que queda

- **Sin paso en los recorridos**: hace falta una planilla de planos y la base 31; la ayuda (*Import vendors from a
  spreadsheet*) lo explica.
- No recuerda los nombres unidos de una importación a la otra: los vuelve a proponer por la escritura. Si un nombre no se
  parece (por ejemplo «NFX» para *Net-Fx* sin código NFX), hay que unirlo a mano.
- No crea páginas de escenas para las que no tienen: se listan y se importan de nuevo cuando existan.
