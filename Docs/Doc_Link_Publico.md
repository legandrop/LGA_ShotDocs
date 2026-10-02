# Link público: «Anyone with the link»

**Estado: diseño, sin código ni migración** (roadmap P.19; pedido de Lega del 2026-10-02). Corregido con la auditoría
independiente del mismo día ("aprobado con condiciones"; ver "Correcciones de la auditoría", al final) y con las
decisiones D29 a D31 (sección 9). Toca permisos, entrar sin cuenta y abuso: riesgo alto. Cada entrega va con sus pruebas
de permisos (casos negativos y mutantes) y su auditoría independiente. Lo medido está en prototipos fuera del repo
("Cómo se midió"). Se diseñó contra `main` v0.105, con la privacidad de lo borrado (D14, v0.104), de la que depende.

## En corto

- **El pedido.** En *Share*, además de personas y correos, **Anyone with the link** con *Can view* (que siempre puede
  comentar, también en solo lectura) o *Can edit*. Se manda el link a cualquiera y entra sin cuenta. "Debería estar
  seguro."
- **Cómo entra sin cuenta: con el token del link, sin sesión de Supabase** (P1). El link lleva después del `#` (que no
  llega a ningún servidor ni al `Referer`) la dirección y la clave publicable del workspace y un token de 256 bits
  (`sdl_` + 43 caracteres). La app del visitante manda el token en un header propio (`x-shotdocs-link`) en cada pedido,
  con el rol `anon` de Supabase; funciones nuevas de la base (`plink_*`) lo validan en cada pedido y deciden qué ve.
  Ninguna tabla se abre a `anon`. No se crea ninguna cuenta y **no se toca la configuración de login**: el registro sigue
  cerrado (D-09).
- **Por qué no las sesiones anónimas de Supabase** (lo primero que se evaluó): con el registro cerrado **no andan**. El
  código de Supabase Auth corta el alta anónima con `Signups not allowed for this instance` si `disable_signup` está
  prendido; habría que abrir el registro (antes, el hook de invitaciones conectado y probado, que en Wanka no está),
  prender los anónimos para todo el proyecto (cualquiera con la clave publicable, que es pública, crea cuentas: 30 por
  hora por IP), sumar un captcha que también afecta al login por código, borrar a mano los anónimos viejos (Supabase no
  los limpia) y cuidar que un anónimo no se convierta en cuenta con correo salteando la invitación. Todo para ganar un
  `auth.uid()` que el link no necesita.
- **Qué ve.** El link vale para **su página y lo de abajo, nunca lo de arriba ni lo del costado**: el nivel se calcula
  en la base subiendo por los padres de cada página hasta encontrar la raíz del link. La raíz llega sin padre (el camino
  de arriba empieza en ella), un link interno a una página de afuera se ve sin título (no está en su árbol), no se ven el
  nombre del workspace ni el del proyecto, ni correos de nadie, y lo que está en la papelera no llega (como a un
  invitado, D21).
- **Se trata como un invitado** (P4): recibe siempre **la base limpia** de D14 (nunca filas, nunca lo borrado), no ve el
  historial (D13) ni la papelera (D21), y las fotos sacadas de la página no le dan permiso. Por eso **un link solo se
  puede crear con el interruptor de D14 prendido** (P5).
- **Can view = Comentar** (P2): ve, baja archivos y comenta con un nombre que escribe la primera vez (guardado en su
  dispositivo y mostrado siempre con *(via link)*). **Can edit = Editar** (D29): escribe y sube archivos al Drive del
  dueño; no crea, mueve, renombra ni manda páginas a la papelera. Va en una **entrega aparte** (la 2), con dos piezas que
  la auditoría pidió y que este documento diseña: **topes por bytes** (1 MB por subida, 20 MB por link y día, 100 MB de
  por vida, 50 MB por día entre todos los links y una guarda que corta las subidas de los links si la base pasa los
  350 MB de los 500 del plan gratis) y la **cuarentena**: una fila de un link que el dispositivo de un editor no puede
  aplicar limpia (basura, dependencias que nunca subieron, tipos desconocidos) se aparta sin marcar la página ilegible ni
  frenar su base limpia, y sin perder nada. Antes de programarla se vuelve a auditar solo eso.
- **Revocar es instantáneo**: cada pedido vuelve a validar el token. *Reset link* crea uno nuevo y el viejo deja de andar
  en el acto; también deja de andar si vence, si se lo apaga, si la página va a la papelera o si quien lo creó pierde el
  permiso de compartir (la misma regla que `can_share`, en vivo). **Sacar a alguien del workspace revoca sus links**: no
  reviven si vuelve. Un pase del portero ya dado sirve hasta que vence (P17: 2 horas para los del link).
- **Abuso y plan gratis.** Sin cuentas no hay MAU. Lo que se gasta: el egress de Supabase (5 GB al mes, más 5 GB
  cacheado), los 100 000 pedidos por día de Workers de la cuenta (el portero, compartido con todo el equipo), la base
  (500 MB: al pasarlos queda **en solo lectura para todos**) y el Drive del dueño. Medido en Wanka: una miniatura pesa
  28 KB de promedio (49 KB el p95), una página 7 KB de mediana (64 KB el p95) y una página con fotos tiene hasta 27 (p95);
  la base pesa 28 MB. Por eso **topes por link y por día contados en la base** (P11: aperturas, bajadas que devuelven
  contenido, pases, comentarios, subidas por cantidad y por bytes, archivos), topes del total de links, el **modo
  liviano** del visitante (P12: baja solo lo que abre) y el contador a la vista en *Share*. Lo que no se puede contar
  (las miniaturas que sirve Storage) queda acotado por el tamaño de la rama y se corta con *Reset link*.
- **Las miniaturas** (B3): Supabase cachea los buckets privados "por usuario" sin decir con qué clave, y todos los
  visitantes llegan con el mismo rol `anon`. La entrega 0 lo prueba con `curl` **antes** de escribir la política del
  bucket `thumbs`; si la caché no distingue el header, las miniaturas del link van por **URLs firmadas** (plan B) o por el
  portero (plan C).
- **Buscadores y filtraciones** (P13): toda la app con `X-Robots-Tag: noindex` y `robots.txt` cerrado (el contenido igual
  nunca está en el HTML), el token solo en el `#` y en un header (nunca en una dirección que pida la app), 256 bits
  (probar al azar es imposible: ~10^57 años a mil millones de intentos por segundo contra mil links vivos) y guardado con
  su huella SHA-256 para buscarlo. Un token rechazado cuesta lo mismo sea cual sea (0,17-0,18 ms en el prototipo): no se
  puede adivinar de a partes midiendo tiempos.
- **Prototipos.** Permisos (PGlite, Postgres 18 en memoria): **71 de 71** casos, con la regla real de compartir, sacar a
  alguien, la política de miniaturas, las funciones que cuentan en solo lectura, los topes de bytes y los comentarios sin
  correos; 14 de 16 mutantes detectados (los dos que no, son de rendimiento o defensa de más). Cuarentena (Yjs 13.6.33,
  300 corridas con 1760 filas malas de cinco tipos): la base limpia se arma en **300 de 300** (sin cuarentena, en 0),
  **0** filas honestas apartadas, 3197 de 3197 textos del visitante honesto en la base, dos editores apartan lo mismo y
  terminan iguales en 300 de 300.
- **Entregas:** 0 = la prueba en la base real de que los headers llegan a la base y a Storage, la de la caché de
  miniaturas, y `noindex` (riesgo bajo); 1 = *Can view* completo (ver, bajar y comentar; riesgo alto); 2 = *Can edit*
  (riesgo alto; se audita de nuevo su diseño antes de programarla); 3 = medir y ajustar los topes, y el link de un
  proyecto entero si hace falta.

**En términos simples:** el link es como una llave larguísima que va pegada a la dirección, en la parte que el navegador
nunca le manda a nadie. Quien la tiene abre la app en el navegador, sin crear cuenta ni recibir un código; la app le
muestra la llave a la base en cada pedido y la base le deja ver solo esa página y sus subpáginas, nunca lo de arriba. No
se toca nada del login, así que el registro sigue cerrado. Si el link se escapa, en *Share* se ve cuántas veces se abrió
hoy y con *Reset link* la llave vieja deja de abrir en el acto. Quien entra así ve la página "pasada en limpio" como un
cliente invitado (nunca lo que se borró) y comenta con el nombre que escriba (que se muestra siempre como "via link",
para que nadie se haga pasar por el equipo). Con *Can edit* también escribe y sube fotos, pero eso llega después y con
dos frenos: un tope de cuánto puede subir por día (para que nadie llene la base gratis y la deje bloqueada para el
equipo) y una "cuarentena" que deja de lado cualquier cambio roto que mande alguien con el link, sin trabar la página
para los demás.

## Reglas que no se rompen

1. **Lo decide la base, en cada pedido.** El token se valida en cada llamada (no se "canjea" por algo que dure); la app
   del visitante no decide nada que la base no confirme. Vale aunque llame a la API a mano.
2. **Nunca lo de arriba ni lo del costado.** El link vale para su página y las que cuelgan de ella hoy, recalculado en
   cada pedido (mover una página afuera le saca el acceso en el acto).
3. **El registro sigue cerrado (D-09)** y no se cambia nada de la configuración de login.
4. **Como un invitado:** base limpia (D14), sin historial (D13), sin papelera (D21), sin fotos sacadas.
5. **Lo que entra por un link no puede trabar al equipo:** ni llenar la base, ni frenar las bases limpias, ni agotar el
   portero. Todo lo que escribe un link tiene tope de cantidad y de bytes, y lo que no se puede aplicar se aparta.
6. **Nunca perder datos:** lo que escribe o sube un visitante se guarda primero en su dispositivo; si el link deja de
   andar o un tope lo frena con algo sin subir, no se borra: espera o se baja como archivo. Una fila apartada sigue en
   `page_updates` y en el dispositivo del editor.
7. **Cada workspace es una isla y sin claves nuevas:** todo vive en el Supabase y el portero del dueño; el portero sigue
   sin ninguna clave de la base.
8. **Nada de tipos de bloque nuevos** ni cambios en el documento.

## 1. Qué hay hoy

- `Plan_Workspaces.md`, sección 4: "Un link público (sin login) es otra cosa y queda para después; para material
  sensible, siempre con login". El plan preveía las funciones de links públicos en el portero (sección 9).
- Compartir hoy es con personas: `share()` (un miembro, nivel por proyecto o página) y `create_invitation()` (un correo,
  con su link `#invite=` que lleva la dirección y la clave publicable del workspace, su clave local y la página). Quien
  comparte: `private.can_share` (nivel 4 sobre lo compartido y ser dueño o admin del workspace, o dueño del proyecto).
- Los permisos viven en la base: `private.user_page_level(página, persona)` sube por los padres, junta los `grants` y
  aplica la papelera (v0.102); todo lo demás (filas, contenido, comentarios, archivos, buckets, el portero por
  `media_file`) sale de ahí. **Todo pide una persona** (`auth.uid()`) con una fila viva en `members`.
- Hoy `anon` no tiene nada: ninguna función de `public` ni de `private` (salvo `public.rls_auto_enable`, ver sección 12),
  ni `USAGE` sobre `private`, ni permisos de tabla, ni políticas (tampoco en `storage.objects`). Una función nueva en
  `public` no le da `EXECUTE` a `anon` por defecto: hay que darlo explícito (lectura del catálogo de la base real).
- La app entra solo con código o link de correo; `workspace_settings` no se lee sin sesión (`probeWorkspace` da
  `signInFirst`).
- Supabase Auth de Wanka (`Doc_Supabase.md`, "Login"): `disable_signup: true`, anónimos apagados
  (`external_anonymous_users_enabled: false`, con su límite `rate_limit_anonymous_users: 30` por hora por IP), hooks
  apagados (el de invitaciones existe en la base pero no está conectado), sin captcha.

## 2. Cómo entra alguien sin cuenta

### 2.1 Los caminos

| | Qué es | Con el registro cerrado | Qué cambia en Auth | Identidad | Plan gratis | Veredicto |
|---|---|---|---|---|---|---|
| **A. Sesión anónima de Supabase** | `signInAnonymously()`: una cuenta sin correo (`is_anonymous: true`, rol `authenticated`); el link la ata a la página | **No anda** (ver 2.2) | Abrir el registro (con el hook de invitaciones conectado antes y adaptado a los anónimos), prender los anónimos, captcha recomendado | Un `auth.uid()` por dispositivo | Cuenta como MAU (50 000 gratis); `auth.users` crece sin límite | Descartado |
| **B. Token del link validado por la base** (elegido) | El token en un header, rol `anon`; funciones `plink_*` lo validan en cada pedido | Anda: no crea cuentas | Nada | El link y un nombre que escribe el visitante | Sin MAU | **Elegido (P1)** |
| **C. El portero canjea el token por una sesión** | El portero firma algo que la base acepte | — | La base solo acepta tokens firmados por Supabase; el portero no tiene (ni debe tener) esa clave | — | — | Imposible sin romper "el portero sin claves" |
| **D. El portero hace de intermediario de todo** | Toda lectura y escritura del visitante pasa por el portero | Anda | Nada | Como B | Gasta los 100 000 pedidos por día de Workers en contenido | Descartado: necesita una clave de la base o repetir B adentro |

### 2.2 Lo averiguado de las sesiones anónimas (camino A)

- **Con `disable_signup` no andan.** En el código de Supabase Auth (`internal/api/anonymous.go`, rama `master`,
  2026-10-02), lo primero que hace el alta anónima es:
  `if config.DisableSignup { return ... ErrorCodeSignupDisabled, "Signups not allowed for this instance" }`. Después
  llama al hook *Before User Created* (`triggerBeforeUserCreated`). O sea: para usarlas hay que abrir el registro, y para
  abrirlo sin que entre cualquiera con un correo, antes el hook de invitaciones conectado y probado (`Doc_Supabase.md`,
  "Abrir el registro solo para invitados", pasos 1 a 7, todavía no hechos en Wanka), y además cambiar el hook para que
  deje pasar a los anónimos.
- **Para todo el proyecto, no para un link.** Prender los anónimos habilita `POST /auth/v1/signup` sin correo para
  cualquiera que tenga la clave publicable (está en la app, es pública): 30 cuentas por hora por IP (límite de fábrica).
  La documentación de Supabase dice que "se recomienda enfáticamente" un captcha invisible o Turnstile; en Supabase el
  captcha vale para todos los ingresos, también el código por correo (habría que sumarlo al login de la app y crear el
  sitio de Turnstile en la cuenta de Lega).
- **No se limpian solos** ("Automatic cleanup of anonymous users is currently not available"): habría que borrar
  cuentas viejas a mano, y borrar una cuenta deja `created_by` en nulo en sus ediciones y comentarios (perder la autoría
  choca con la regla de no borrar).
- **Cuentan como MAU** (cada usuario que entra o renueva en el mes; 50 000 gratis): un link viralizado los consume.
- **Se pueden convertir en cuentas permanentes** con `updateUser({ email })` o `linkIdentity()`: el usuario ya existe, así
  que el hook de invitaciones no corre. Una cuenta así no tendría membresía (no vería nada), pero el "registro cerrado"
  dejaría de ser cierto. No quedó comprobado cómo cerrarlo.
- Rol `authenticated` con el claim `is_anonymous`: toda política futura que mire solo "tiene sesión" quedaría abierta
  para cualquiera. Hoy todas miran `members`, pero es una trampa a mantener para siempre.

**Lo que A daría y B no:** un id de persona estable (autoría firme, sacar a un visitante puntual, el tiempo real de
Supabase en el futuro). Con B, sacar a una persona puntual se hace con *Reset link* (como en Google Docs, donde "cualquiera
con el link" tampoco se saca de a uno), y la autoría es "el link + el nombre que escribió" (como los comentarios importados
de Coda, que ya existen sin cuenta). **Cómo se revierte P1:** la tabla de links sirve igual para A; si algún día se quiere
A, `plink_open` ataría además el `auth.uid()` anónimo al link y las funciones `plink_*` seguirían valiendo.

### 2.3 Lo averiguado del camino B

- **PostgREST** pone los headers del pedido en `request.headers` (JSON, nombres en minúsculas):
  `current_setting('request.headers', true)::json ->> 'x-shotdocs-link'`. Sin `Authorization`, el rol es el anónimo
  (`anon` en Supabase). En Wanka ya llega un header propio por ese camino (`x-shotdocs-version`, que lee
  `private.request_app_version`).
- **Supabase Storage** también: su código (`src/internal/database/postgres/scope.ts`) hace
  `set_config('request.headers', $6, true)` con los headers del pedido (sin filtrar) antes de evaluar las políticas de
  `storage.objects`; y supabase-js le manda a Storage los mismos headers globales del cliente.
- **Funciones que escriben:** PostgREST corre en una transacción de solo lectura las funciones `STABLE` e `IMMUTABLE`
  (también si se llaman por `GET`). Toda función `plink_*` que **cuenta** (escribe en el uso del día) es `VOLATILE` y se
  llama por `POST` (lo que hace supabase-js con `rpc()`). Probado: contar adentro de una transacción de solo lectura da
  `cannot execute INSERT in a read-only transaction`.
- **CORS:** el proyecto de Supabase acepta cualquier header pedido (ya se usa `x-shotdocs-version`, B.17). Una base
  autohospedada tiene que aceptar `x-shotdocs-link` y `x-shotdocs-device` (anotarlo en `Doc_Supabase.md` junto al otro).
- **Falta comprobarlo contra Wanka** (entrega 0): que los dos headers lleguen a una función y a una política de Storage
  del proyecto real con la clave publicable, sin sesión, y cómo se comporta la caché de Storage (3.9). Sin crear usuarios
  ni entrar con login: alcanza con `curl`.

## 3. El diseño

### 3.1 El link

```
https://shotdocs.lega.com.ar/#link=<base64url de {"u","k","l","t"}>
```

- `u`, `k`, `l`: la dirección y la clave publicable del Supabase y la clave local del workspace (como `#invite=`).
  **Sin** el nombre del workspace (P10). `t`: el token.
- **El token:** `sdl_` + 43 caracteres base64url = 32 bytes al azar = 256 bits. **Lo genera la base**
  (`gen_random_bytes`), no el dispositivo: nadie elige uno débil. El prefijo `sdl_` sirve para reconocerlo (y para que un
  escáner de secretos lo encuentre si aparece pegado en un repo).
- La base guarda el token y su huella (`sha256`) y busca por la huella. Guardar el token permite que quien comparte lo
  vuelva a copiar desde *Share* (como en Google Docs); solo lo devuelve `get_public_link()` a quien puede compartir esa
  página. Las copias de seguridad lo llevan (están cifradas).
- **Un link vivo por página** (índice único parcial). Cambiar el nivel o el vencimiento conserva el token; *Reset link*
  revoca el vivo y crea otro.
- Solo **páginas** en la primera entrega (P16). El de un proyecto entero (todas sus raíces) queda para la entrega 3.
- **Nombres:** tabla `public_links`; las funciones que llama el visitante, `plink_*`; las de quien comparte,
  `*_public_link`. No se usa el prefijo `link_`, que ya existe con otro sentido (`link_page_file`: vincular un archivo).

### 3.2 Cómo viaja

- Al abrir la dirección, la app lee el `#link=`, guarda el link en el dispositivo (la lista de workspaces, como una
  entrada de tipo *link*, con su propio nombre de base local) y **borra el `#` de la barra** (`history.replaceState`):
  no queda en la pantalla, en una captura ni en el historial del navegador. Volver a abrir desde el mismo dispositivo usa
  lo guardado.
- **Una dirección `u` que el dispositivo no conoce** es contenido de afuera (como un `#invite=` de otro workspace hoy):
  antes de pedir nada, la app muestra el dominio (*Open a page shared from xyz.supabase.co?*) y, una vez adentro, lo
  sigue mostrando en *Shared with a link · xyz.supabase.co*.
- **Un cliente de Supabase propio del modo link**, sin sesión y sin almacenamiento de sesión (`persistSession: false`,
  sin renovar tokens), que **nunca** agrega el `Authorization` de una cuenta, con dos headers fijos en cada pedido (a la
  base y a Storage): `x-shotdocs-link: <token>` y `x-shotdocs-device: <id>`. Más el `x-shotdocs-version` de siempre.
- **El id de dispositivo es uno por link** (por entrada de la lista), 32 bytes al azar creados al guardar el link: así un
  link armado con la dirección de otro Supabase no se entera del id que el mismo navegador usa con otro workspace. La base
  guarda solo su huella: sirve para "este comentario es mío", nunca da permisos ni frena a nadie (cambiarlo es gratis:
  lo que frena es el tope por link).
- El token **nunca va en una dirección** que pida la app (ni en `?query`), así que no queda en registros de pedidos ni en
  un `Referer`. Al portero va en el mismo header.

### 3.3 Cuándo vale un link

`private.current_plink()` (en cada pedido; una búsqueda por la huella):

- el header tiene la forma `^sdl_[A-Za-z0-9_-]{43}$` (si no, ni se calcula la huella);
- la huella existe, `revoked_at` es nulo, y `expires_at` es nulo o futuro;
- **quien lo creó todavía puede compartir esa página**, con **la misma regla que `can_share`**:
  `private.user_can_share_page(página, persona)` (nivel 4 sobre la página, miembro activo, y dueño o admin del workspace,
  o dueño del proyecto; un invitado nunca). Es **la única** definición: la migración reescribe `private.can_share` para
  que la llame con `auth.uid()` (más `session_allowed`), así no hay dos copias que se separen. Si al creador le bajan el
  permiso o el rol, el link se apaga solo y vuelve si se lo devuelven (cambios de permiso: en vivo).
- **Sacar a alguien del workspace revoca sus links** (`remove_member` les pone `revoked_at` y `revoked_by`): si vuelve
  meses después, sus links viejos no reviven sin aviso. Un dueño o admin puede crear uno nuevo (*Reset link*) y queda
  como creador.
- Todo lo que no vale da el mismo error (`link_not_found`), sin header, mal formado, inexistente, revocado o vencido, y
  cuesta lo mismo.

### 3.4 El nivel del link sobre una página

`private.plink_page_level(p)`: 2 (*Can view*: ver y comentar) o 3 (*Can edit*) si **la raíz del link está en la cadena
de `p` hacia arriba**, ni `p` ni ninguna de arriba está en la papelera y el proyecto no está borrado; si no, 0. Es la
misma recorrida por los padres que `user_page_level` (una sola pasada, PL/pgSQL), y cuesta lo mismo.

- Mover una página adentro de la rama la suma al link en el acto; moverla afuera la saca. Mover la raíz del link debajo
  de otra página viva no cambia nada (la nueva de arriba no se ve); debajo de una de la papelera, el link muere hasta que
  se la saca (probado).
- La raíz del link en la papelera, o una de arriba: el link entero deja de andar (como un invitado, D21) y vuelve al
  restaurarla.
- Dos links vivos en la misma rama (el de la madre y el de una hija) son independientes: cada token da solo su rama y su
  nivel (probado).
- **No se mezcla con los permisos de personas**: un visitante no tiene `members` ni `grants`; un miembro que abre el link
  sin sesión es un visitante más (3.14).

### 3.5 Qué ve el visitante

- **El árbol:** `plink_tree()` devuelve la raíz (con `parent_id` nulo) y lo que cuelga de ella, sin lo que está en la
  papelera, **con una lista cerrada de columnas**: `id`, `parent_id`, `title`, `icon`, `sort_key`, `settings` (solo los
  ajustes de hoja y del encabezado), `update_seq`, `clean_seq`, `created_at`, `updated_at`, y en el lugar del proyecto
  (`workspace_id`) **el id del link**. Ningún id de afuera de la rama (ni el del proyecto, ni `template_id` ni nada que se
  sume a `pages` después sin pasar por esta lista).
- **Links internos** a páginas de afuera: no están en su árbol, así que se ven como hoy cualquier página sin acceso
  (sin título). Un link a una página de adentro anda.
- **El formato de hoja** se hereda por rama y se fija en las raíces del proyecto: `plink_tree` devuelve en la raíz del
  link el formato efectivo (el que hereda), para que la página se vea y salga en PDF igual que para el equipo.
- **No se ven el nombre del workspace ni el del proyecto** (P10): arriba dice el título de la página compartida y
  *Shared with a link · <dominio>* (3.2). El selector de workspaces no aparece.
- **Ningún correo** (P9): los del equipo se ven por la parte del correo antes de la `@` (`lega`); los comentarios
  importados de Coda, por el nombre que trajeron (`imported_author`), **nunca** `imported_author_email`; los del link, por
  su nombre con *(via link)*.
- **La ayuda y la recorrida** existen igual, con una entrada *Opened with a link* (qué puede hacer, que lo que escribe se
  guarda en este navegador y que el link puede dejar de andar).

### 3.6 El contenido: siempre la base limpia (D14)

- `plink_pull_page(página, desde)` (`VOLATILE`) devuelve **la base limpia vigente** de la página
  (`private.current_clean_base`, la de D14) como una sola fila, nunca las filas de `page_updates`; sin base vigente, nada
  y la página dice *The editors haven't prepared this page for you yet…* (el mismo aviso de D14). "Al día" para el
  visitante es `clean_seq`.
- **Cuenta los bytes solo cuando devuelve una base** (`pull_bytes`). El visitante normal casi nunca baja (su cursor ya
  está en `clean_seq`, la llamada no devuelve nada y no escribe nada); quien pide en bucle desde cero sí, y lo corta el
  tope de bytes por link y del total de links (P11).
- **Con el interruptor de D14 apagado no se puede crear un link** (`create_public_link` da `clean_off`, P5): con el
  interruptor apagado los editores no arman bases y no habría qué servir sin mandar filas. Prender el interruptor en Wanka
  es requisito de la entrega 1 (`Doc_Privacidad_Borrado.md`, sección 10).
- **Las bases se arman para las páginas con link:** `private.has_plain_readers(p)` suma "hay un link vivo que cubre `p`" y
  `clean_work` suma las raíces de los links vivos a las ramas con lectores. **Crear un link reinicia la rama**
  (`clean_reset_seq = update_seq`, `clean_seq = 0`), como `share()`; antes, la app de quien comparte sube lo pendiente y
  después arma las bases enseguida, con el mismo `useShareGate` de D14 (*Preparing N pages for the link…*). Mover una
  página a una rama con link la reinicia (el trigger `pages_permissions`, como con lectores).
- Cambiar *Can view* a *Can edit* o al revés no reinicia nada: los dos reciben solo bases.

### 3.7 Comentarios

- *Can view* y *Can edit* comentan y responden (P2). **No resuelven hilos ni borran los de otros**; editan y borran los
  suyos desde el mismo dispositivo (la huella de `x-shotdocs-device` guardada en el comentario). Todas las funciones que
  escriben (`plink_add_comment`, `plink_edit_comment`, `plink_delete_comment`) son `VOLATILE` y cuentan.
- **El nombre:** la primera vez que comenta (o edita, con *Can edit*) la app le pide *Your name* (hasta 60 caracteres,
  sin controles ni marcas de dirección, las mismas que limpia el portero en los nombres de archivo) y lo guarda en el
  dispositivo para ese link (P8). Se puede cambiar; los comentarios ya hechos conservan el que tenían.
- **Cómo se muestra:** `Ana (via link)`, con un ícono de link y otro color; el sufijo no se puede sacar ni escribir en el
  nombre (así nadie del link se hace pasar por alguien del equipo). Al equipo, además, el detalle dice qué link
  (*Can view link, created by lega*).
- **En la base:** `comments.author_id` nulo (como los importados de Coda), `plink_id`, `plink_author` (el nombre) y
  `plink_device_hash`. `list_comments` del equipo los devuelve con esos campos; la versión publicada los ignora y los
  muestra como de una cuenta borrada (ya pasa con los importados), así que se sube `min_app_version` con la entrega.
- **Moderar:** quien tiene 4 sobre la página los borra como cualquier comentario (`delete_comment`: hoy "quien lo
  escribió o quien tiene editar y crear"; un comentario sin `author_id` solo lo borra quien tiene 4). Para un spam
  masivo: *Reset link* corta los nuevos, y en *Share* un *Delete comments from this link…* (con confirmación) los marca
  borrados de una vez (nada se borra de la tabla: queda el texto, como siempre).
- **Topes:** 200 comentarios por link por día (P11) y el largo de siempre (10 000). Un tope "por dispositivo" no frena a
  nadie (el id de dispositivo lo inventa el visitante): no se propone.

### 3.8 Editar sin cuenta (*Can edit*, entrega 2)

**Qué puede** (D29): escribir en las páginas de la rama y subir o sacar fotos, videos y archivos (nivel 3). **No** crea,
mueve, renombra ni manda páginas a la papelera (nivel 4), ni cambia el formato de la rama: esos cambios van por las filas
de `pages`, que el link no escribe.

**Lo que la auditoría encontró y cómo se cierra.** Una fila de `page_updates` no se borra nunca y la base no lee Yjs:
sin frenos, un visitante con *Can edit* podía (B1) llenar la base del plan gratis con unas 60 subidas de 8 MB (al pasar
los 500 MB, Supabase la deja en solo lectura para todo el equipo, y salir pide borrar filas de una tabla que no se borra)
o (B2) subir una sola fila ilegible que hace que los dispositivos de los editores marquen la página `unreadable` y dejen
de armar su base limpia para siempre (los lectores, invitados y links quedan con una versión vieja o "en preparación").

#### 3.8.1 Topes por bytes (B1)

`plink_push_page_update(página, client_update_id, update, versión, nombre)` (`VOLATILE`), igual que `push_page_update`
(la fila de la página bloqueada, el `seq` correlativo, idempotente por `client_update_id`, la versión mínima), con el
nivel del link y estos frenos, en este orden (todo en la misma transacción: lo rechazado no suma):

| Freno | Valor | Por qué |
|---|---|---|
| Tamaño por subida | **1 MB** (`update_size_invalid`) | Una página entera pesa 64 KB en el p95; lo que se teclea sube en pocos KB. Las cuentas siguen con 8 MB |
| Guarda de la base | Si la base pesa más de **350 MB** (70 % de 500), ninguna subida de ningún link entra (`link_rate_limited`, detalle `db_guard`) | Lo único que protege de verdad el solo lectura del plan gratis, sumen lo que sumen los links. `pg_database_size` recordado 10 minutos en una fila (`private.db_bytes()`): 0,2 ms recordado, 1,7 a 3,4 ms al recalcular (prototipo) |
| Bytes de por vida del link | **100 MB** (`public_links.push_bytes_total`) | Sin esto, 20 MB por día llenan la base en tres semanas |
| Bytes por link y día | **20 MB** | Una persona escribiendo un día entero sube unos pocos MB con la subida sin GC de hoy (D15) |
| Bytes de todos los links por día | **50 MB** (`public_link_usage_all`) | Varios links a la vez no suman más que eso |
| Subidas por link y día | 2000 | Como antes |

- **Contarlo es barato:** un `upsert` por subida en la fila del día del link (`public_link_usage`, cantidad y bytes en la
  misma fila) y otro en la del total (`public_link_usage_all`), más el `update` de `push_bytes_total`. Las cuentas no
  pasan por nada de esto.
- **La subida sin GC (D15) en modo link:** hoy una subida lleva lo tecleado y borrado hasta 6 MB (`NO_GC_MAX_BYTES`) y
  pasa a GC arriba de eso. En modo link ese umbral es **1 MB**: una subida que con lo borrado pasaría el tope sube con GC
  (lo visible no cambia; se pierde solo el historial de lo que el visitante tecleó y borró antes de subir).
- **Si igual no entra** (un pegado de más de 1 MB ya con GC, o un tope del día): la subida queda en la cola del
  dispositivo, a la vista (*This change is too big to send through a link* o *This link has been used a lot today*), con
  *Download it*; nada se descarta.
- **Las miniaturas** que sube un visitante (bucket `thumbs`, hasta 512 KB cada una, 1 GB gratis en Storage) quedan
  acotadas por la cantidad de archivos que el link puede registrar: 100 por día y 500 de por vida.
- **El Drive del dueño** (15 GB gratis): 1 GB por día y **5 GB de por vida** por link (`upload_bytes`, contado en
  `plink_register_file` con el peso declarado y en las carpetas de P.9 al abrir cada subida), y en *Share* un aviso al
  pasar 1 GB (*This link has uploaded 1.2 GB to your Drive*).

#### 3.8.2 La fila que no se puede aplicar: cuarentena (B2)

- **Dónde se decide:** en el dispositivo del editor, que es quien lee Yjs. La base no puede (no lee Yjs) y el portero no
  sirve (la subida tendría que pasar por él y la base aceptarla solo si él la firmó: un secreto compartido nuevo).
- **Qué fila:** solo las que tienen `plink_id`. `pull_page_updates` (a quien ve lo borrado) suma la columna `plink_id`
  al final (la versión publicada la ignora). Las filas de cuentas siguen como hoy.
- **La prueba:** antes de guardarla con las demás, el dispositivo la decodifica y la aplica a una copia del documento
  armado con lo aceptado. **Va aparte** si no se decodifica, si deja algo pendiente (`pendingStructs`: depende de algo
  que nunca subió; `pendingDs`: borra algo que no existe) o si trae un tipo de bloque, una marca o un contenido que la app
  no conoce (la misma guarda de v0.021 que hoy no abre la página en el editor).
- **Ir aparte** es: guardarla en un almacén propio del dispositivo (`docQuarantine`: la fila tal cual, su `seq`, el link
  y por qué), **no** sumarla a `docUpdates`, avanzar el cursor, y **no** marcar la página `unreadable`. La página sigue
  armando su base limpia con todo lo demás (omitir una fila nunca filtra lo borrado). La fila sigue en `page_updates`
  para siempre (D4).
- **En cadena:** una fila del mismo link que depende de una apartada también queda pendiente, y también va aparte. Una
  fila honesta no depende nunca de una apartada: un visitante escribe sobre la última base (que solo tiene lo aceptado) y
  sobre sus propias filas anteriores.
- **Todos los editores apartan lo mismo:** la prueba depende solo de las filas anteriores en orden, que son las mismas
  para todos. Un dispositivo nuevo que baja de cero llega a lo mismo (probado).
- **El aviso:** al editor, en la página, *A change sent through the link "<página>" couldn't be applied and was set
  aside* con *Download it* (el archivo con la fila, como "bajar lo pendiente") y el nombre del link. En *Share*, la cuenta
  de filas apartadas del link. El historial (D13) las muestra como *Set aside (via link)* sin aplicarlas: la versión de
  `page_history` y el Worker del historial usan la misma prueba. Compactar (B.9), el día que exista, arma el snapshot sin
  ellas.
- **El costo:** la copia se arma solo para filas de un link (pocas, de hasta 1 MB): 2,3 ms por fila en una página de
  67 KB, 13,6 ms en una de 560 KB y 58 ms en una de 2 MB (en la computadora; en el teléfono, 3 a 5 veces). Varias filas
  seguidas del link se prueban sobre la misma copia.
- **Lo que no cubre:** una fila válida que borra todo o escribe basura legible es una edición como cualquiera (la permite
  *Can edit*): la restaura el historial (D13), y *Reset link* la corta.

#### 3.8.3 Lo demás de *Can edit*

- **Sin red y offline-first:** el modo link usa el mismo motor (IndexedDB primero, la cola se vacía solo cuando la base
  confirma, reintentos idempotentes, "N por subir" a la vista), con una base local propia por link. Un navegador sin
  instalar puede perder lo guardado (Safari, a los 7 días sin uso): la app pide `navigator.storage.persist()` y lo dice
  en la ayuda, como a los invitados.
- **Cuando la base rechaza algo de la cola,** nada se borra:

  | Respuesta | Qué hace la app |
  |---|---|
  | `link_not_found` (revocado, vencido, *Reset*, la raíz en la papelera) | Deja de reintentar a ciegas: *This link no longer works. You have N unsent changes:* ***Download them*** (el mismo "bajar como archivo" de cuando sacan a alguien, `Plan_Workspaces.md`, sección 8). Si el dueño le manda el link nuevo de la misma página, al abrirlo en el mismo dispositivo ofrece mandar lo pendiente con el nuevo |
  | `page_not_found` porque el link pasó de *Can edit* a *Can view* | Igual: *This link can no longer edit…* con *Download them*; si vuelve a *Can edit*, sube |
  | `link_rate_limited` | Espera al día siguiente (sin reintentar cada 10 s) y lo dice; *Download them* a mano |
  | `update_size_invalid` | Esa subida queda a la vista con *Download it*; las siguientes siguen |
  | `app_outdated` | Como hoy: se actualiza la app y sube |

- **El historial (D13):** quien ve el historial ve las versiones del visitante como *Ana (via link)*; `page_history`
  devuelve `plink_author` además de `created_by`. El visitante no ve el historial.
- **D14 con *Can edit*:** como el invitado con Editar: escribe sobre la última base; su cursor se adelanta a su propia
  fila y baja la base siguiente entera (`Doc_Privacidad_Borrado.md`, 4.3). Lo que él escribe y borra sí queda en sus
  filas, que ven los editores (como con cualquiera).
- **Sin un editor conectado** (O8 de la auditoría): dos visitantes, o el mismo en dos dispositivos, no ven lo que escribe
  el otro hasta que la app de un editor arma la base (D14). Un fin de semana sin nadie del equipo con la app abierta, días.
  No se pierde nada (Yjs lo junta), pero no es "como Google Docs". Se dice en *Share* al elegir *Can edit* (*Changes made
  through the link reach other people when someone from your team opens the app.*) y en la ayuda.

### 3.9 El portero y los archivos

- **Rutas que aceptan el link** (con `x-shotdocs-link` y sin `Authorization`): `POST /pass`, `POST /verify`,
  `POST /folder/list` (nivel 1) y, con *Can edit*, `POST /upload`, `PUT /upload/<id>`, `POST /folder/prepare` y
  `POST /folder/sessions` (nivel 3). **Nunca** las del dueño (`/drive/*` salvo `GET /drive/status`, `/trash`,
  `/project/*`). Con el header del link, el portero **no** reenvía ningún `Authorization` que venga en el pedido.
- **Cómo pregunta:** como hoy con `media_file`, pero llamando por `POST` a `plink_media_file(archivo)` (`VOLATILE`:
  cuenta `pass`) con la clave publicable (que el portero ya tiene) y el header del link reenviado. Devuelve lo mismo
  (proyecto, nombre, tipo, peso, Drive, nivel) con el nivel del link: el más alto de las páginas **vivas de la rama** que
  lo usan **sin `removed_at`** (las fotos sacadas no cuentan, D14), sin usos de otro proyecto. Sigue sin clave de la base.
  El pase lleva la marca `appProperties.sdFile` que el portero comprueba en Drive: un visitante no puede apuntar un
  archivo de la app a otro archivo del Drive del dueño.
- **Los pases del link vencen a las 2 horas** (P17), también los que trae `/folder/list` (hoy 8 horas para todos):
  revocar corta antes lo ya abierto. Un video de más de 2 horas abierto en el carrete pide otro pase al reanudar (la app
  ya pide pases nuevos al vencer).
- **La subida de un visitante:** el registro de la subida guarda `plink:<id del link>:<huella del dispositivo>` donde hoy
  guarda la persona ("el que abrió la subida"). Al terminar, `plink_set_file_drive` vuelve a validar el link: si se
  revocó mientras subía, el archivo queda en Drive y en la base sin `drive_id` confirmado, como una subida de alguien
  sacado (no se pierde). Cuenta en `upload_bytes` (3.8.1), también lo que abren `/folder/prepare` y `/folder/sessions`.
- **Las miniaturas** (bucket `thumbs` de Supabase), **solo después de la prueba de caché de la entrega 0** (B3):
  - **Por qué hace falta la prueba:** Supabase cachea los objetos de los buckets privados "por usuario" (*Storage CDN*,
    *Smart CDN*) sin decir con qué clave. Con el link, todos los visitantes llegan con el mismo `Authorization` (el de
    `anon`) y se distinguen solo por `x-shotdocs-link`. Si la clave de la caché no incluye ese header, una miniatura que
    bajó un visitante válido se le podría servir a cualquiera con la clave publicable (que es pública), sin token, y
    seguir sirviéndose después de *Reset link*.
  - **La prueba** (entrega 0, sección 7): un objeto de prueba y una política de prueba; `GET` con el header válido dos
    veces (mirando `cf-cache-status`), después el mismo `GET` sin el header y con un token revocado: tienen que dar 400 o
    404 y **nunca** `HIT`.
  - **Plan A, si la prueba da bien:** una política de lectura para `anon` en `storage.objects`:
    `bucket_id = 'thumbs' and private.plink_token() is not null and name = any ((select private.plink_thumbs())::text[])`.
    La guarda del token va primero (sin header, la política no hace nada más: 0,4 ms el listado de 1923 objetos en el
    prototipo), y el conjunto de miniaturas de la rama se calcula **una vez por consulta** (`(select …)`), no una vez por
    objeto: un listado del bucket con el link pasó de 8,5 s a 0,24-0,26 s en el prototipo (en la base real, unas 4,7
    veces menos). Permisos: `usage on schema private` y `execute` **solo** de `private.plink_token()` y
    `private.plink_thumbs()` a `anon` (como `sees_deleted` para `authenticated`); PostgREST no expone `private`, así que no
    se pueden llamar por la API, y `anon` sigue sin poder llamar a ninguna otra (probado). Para subir la miniatura de un
    archivo nuevo (*Can edit*): una política de `insert` con el archivo registrado por ese link.
  - **Plan B, si la caché no distingue el header:** **URLs firmadas**. El visitante pide `createSignedUrls` (un solo
    pedido para todas las miniaturas de la página) con el header: Storage evalúa la misma política al firmar, y cada URL
    lleva su propia firma (la caché es por URL: quien no tiene la URL no recibe nada). Vencen a las 2 horas, como los
    pases. Hay que comprobar en la misma entrega 0 que firmar evalúa la política con el header.
  - **Plan C, si tampoco:** las miniaturas del link por el portero (`/t/<pase>`, la miniatura de Drive, con los pases de
    `plink_media_file` pedidos de a muchos en un solo pedido). Gasta pedidos de Workers (uno por miniatura) y, en una
    dirección `*.workers.dev`, dos llamados a Drive por miniatura (sin caché de Cloudflare).
  - Hasta tener la prueba, **no se escribe la política de `thumbs` para `anon`**.
- **Carpetas (P.9)** y ***Download all*** (v0.105): andan con los pases del listado; cada archivo listado cuenta como un
  pase para el tope.
- **Las imágenes viejas `sdfile://`** (bucket `page-files`, sin registro de uso): no se abren para el link (se ven como
  imagen no disponible). En Wanka son 60, de desarrollo; abrirlas pediría registrarlas en `files` (ítem aparte de D14).
- **Tarjetas de Drive** (link, texto o tarjeta): como a cualquiera, el reproductor de Drive anda si el visitante tiene
  acceso con su Google.
- **Modo liviano** (P12): el visitante no hace la "imagen nítida" automática (bajar el original para la página,
  `Doc_Imagenes.md`): ve las miniaturas y abre el original en el carrete o al bajarlo. Ahorra pedidos al portero y a Drive.

### 3.10 Cómo convive con lo demás

| Pieza | Con el link |
|---|---|
| `members`, `grants`, invitados | Aparte: el link no es una persona. `user_page_level` no cambia. Un invitado no puede crear links (no comparte). |
| `can_share` | Una sola regla (`user_can_share_page`) para compartir con personas y para que un link siga vivo (P6). |
| Sacar a alguien (`remove_member`) | Revoca sus links. |
| Papelera (v0.102, D21) | Lo que está en la papelera no le llega; la raíz en la papelera apaga el link. |
| Privacidad de lo borrado (D14) | Siempre bases; crear el link reinicia; requiere el interruptor (P5). Las filas de un link que no se pueden aplicar no frenan las bases (3.8.2). |
| Historial (D13) | No lo ve; sus ediciones aparecen con su nombre y *(via link)*; las apartadas, como *Set aside*. |
| Versión mínima (B.17) | Las escrituras `plink_*` piden la versión (`p_app_version` y `x-shotdocs-version`) como las demás; `plink_open` devuelve la mínima y la app se actualiza (v0.097) antes de escribir. |
| Compactar (B.9) | El link no recibe snapshots completos (solo bases); el snapshot se arma sin las filas apartadas. |
| Buscar y reemplazar en el proyecto (P.12) | Buscar, sí, en lo que tiene el dispositivo; reemplazar en todo, no (es de quien edita el proyecto; con *Can edit*, el reemplazo en la página sí). |
| *Available offline* (P.10) | Con *Can edit*, sí (marca la rama para usarla sin red, con los pases del link); con *Can view*, también, contra los topes. |
| Tiempo real (D-04, a futuro) | Un canal en vivo nunca para el link (lleva lo borrado, D14). |
| Asistente y MCP (fase 5) | El asistente del visitante no existe (no hay cuenta ni clave); el MCP no acepta links. |

### 3.11 *Share*: crear, cambiar, revocar

En *Share* de una página, debajo de las personas, una sección **General access** (los textos en inglés, con su
traducción en `src/i18n/`):

- *Restricted — Only people with access can open* (lo de hoy) o *Anyone with the link* con *Can view* / *Can edit*. Al
  prenderlo: la línea de D14 (*They'll get the page as it is when the editors' apps refresh it…*), *Preparing N pages for
  the link…* y el link copiado (*Link copied*). Con *Can edit*, la línea de 3.8.3 (los cambios llegan a los demás cuando
  alguien del equipo abre la app).
- **Copy link**, **Reset link** (confirmación: *The current link will stop working for everyone who has it.*) y
  **Expires**: *Never* (por defecto, D30), *In 1 day*, *In 7 days*, *In 30 days*, una fecha.
- **Uso de hoy:** *Opened 12 times today · 3 comments* y, si llegó a un tope, *Daily limit reached: new visits are paused
  until tomorrow*, con *Reset link*. Con *Can edit*, lo subido al Drive en total y las filas apartadas.
- **Si una página de arriba ya tiene link**, esta lo muestra (*Anyone with the link to "Brief" can view this page*) con
  un botón para ir a esa: no se apaga desde acá (el link es de la de arriba). En el árbol, un ícono chico marca las
  páginas con link propio.
- Quien no puede compartir no ve la sección; un invitado tampoco.
- La ayuda suma *Share with a link* (qué ve, que no es para material sensible, cómo cortarlo) y los atajos, si hay, van
  al registro (`src/ui/shortcuts.ts`).

### 3.12 Buscadores, `Referer` y fuerza bruta

- **No indexar** (P13): `public/_headers` suma `/*  X-Robots-Tag: noindex, nofollow` para toda la app y
  `public/robots.txt` con `Disallow: /`. El contenido de una página nunca está en el HTML (llega por la API con el token),
  así que un buscador no lo vería aunque entrara; esto evita además que indexe el link pegado en algún lado.
- **`Referer`:** el `#` nunca viaja en el `Referer` ni llega al servidor. Igual se fija `Referrer-Policy:
  strict-origin-when-cross-origin` en `_headers` (lo que ya hacen los navegadores por defecto; explícito para que ninguna
  página lo cambie). No se pone `no-referrer` en toda la app: algunos reproductores embebidos necesitan el origen.
- **El token en el dispositivo:** en la lista de workspaces (`localStorage`) y en la base local, como hoy la sesión de una
  cuenta. Quien tiene acceso al navegador del visitante tiene el link (igual que con una sesión).
- **Fuerza bruta:** 256 bits. Aun a mil millones de intentos por segundo y con mil links vivos, encontrar uno tarda
  ~3,7 × 10^57 años: no hace falta limitar intentos para eso. Rechazar cuesta lo mismo sea cual sea el motivo (sin header,
  mal formado, al azar, revocado: 0,17-0,18 ms en el prototipo; válido, 0,29 ms): la búsqueda es por la huella, así que
  no se puede adivinar de a partes. La app no tiene un límite por IP que pueda configurar en la API de Supabase.

### 3.13 Abuso y plan gratis

**Lo medido en Wanka** (solo lectura, 2026-10-02): 1923 miniaturas, 28 KB de promedio (mediana 26 KB, p95 49 KB, máximo
77 KB); 487 páginas con archivos, mediana 1 por página, p95 27, máximo 100; contenido por página (todas las filas)
mediana 7,4 KB, p95 64 KB, máximo 2 MB (una tabla importada); originales de fotos 2,45 MB de promedio; la base entera,
28 MB (`page_updates`, 7,5 MB).

| Recurso (plan gratis) | Qué gasta una visita | Cuánto alcanza | Qué pasa si se agota |
|---|---|---|---|
| Base: 500 MB | Nada al leer; al escribir (*Can edit*), lo que sube | Topes de 3.8.1 y la guarda de 350 MB | **Solo lectura para todo el workspace** (SQLSTATE 25006) |
| Egress de Supabase: 5 GB por mes (más 5 GB cacheado) | Contenido + miniaturas de lo que abre: página típica ~35 KB; pesada (p95) ~0,8 MB | ~6000 visitas pesadas o ~140 000 típicas por mes | Aviso y período de gracia; después, restricciones **para todo el workspace** |
| Pedidos de Workers: 100 000 por día **por cuenta** (el portero; la app es estática y no cuenta) | Con la imagen nítida de hoy, un `/pass` y un `/m/` por foto (54 en una página de 27 fotos); con el modo liviano (P12), solo lo que se abre en el carrete o se baja | ~1800 visitas pesadas por día sin el modo liviano | Error 1027: **el portero deja de andar para todo el equipo** hasta las 0 UTC |
| CPU de Workers: 10 ms por pedido | Un pase o un listado de carpeta | Igual que hoy | — |
| Drive del dueño | Bajar originales: sin costo; **subir** (*Can edit*): ocupa su Drive (15 GB gratis) | 1 GB por día y 5 GB de por vida por link | `drive_full` para todos |
| Storage de Supabase: 1 GB | Miniaturas que sube un visitante | 500 archivos de por vida por link (a lo sumo 250 MB) | Las subidas de miniaturas fallan |
| MAU de Supabase: 50 000 | Nada (no hay cuentas) | — | — |
| Base (CPU del plan Nano) | `plink_tree` cada ciclo | Un ciclo cada 30 s del visitante (P12) | Lentitud para todos |

**Los topes** (P11), contados en la base, ajustables en `workspace_settings.link_limits`:

| Qué | Por link y día | Todos los links, por día | De por vida, por link |
|---|---|---|---|
| Aperturas (`plink_open`) | 300 | — | — |
| Bajadas que devuelven una base (`pull_bytes`) | 50 MB | 150 MB | — |
| Pases del portero (`plink_media_file`, archivos de `/folder/list`) | 3000 | 20 000 (un 20 % de los pedidos de Workers del día) | — |
| Comentarios | 200 | — | — |
| Subidas de contenido | 2000 y 20 MB (1 MB cada una) | 50 MB | 100 MB |
| Archivos registrados | 100 | — | 500 |
| Bytes de archivos al Drive (`upload_bytes`) | 1 GB (hasta 500 MB por archivo) | — | 5 GB |
| Guarda de la base | — | Ninguna subida de links con la base por encima de 350 MB | — |

- **Dónde se cuenta:** `public_link_usage` (link, día, tipo: cantidad y bytes en la misma fila) y
  `public_link_usage_all` (día, tipo) para los totales de todos los links; los de por vida, en la fila del link. Cada
  función que cuenta es `VOLATILE` (2.3). Un `upsert` por llamada que cuenta.
- Al pasar un tope, la función da `link_rate_limited` y la app dice *This link has been used a lot today. Try again
  tomorrow, or ask for a new link.* Nada se pierde (lo de un *Can edit* queda en su cola). En *Share*, el contador.
- **Las lecturas que no devuelven nada no se cuentan** (contar escribiría en cada lectura): el ciclo del visitante al día
  no escribe nada. El modo liviano (P12) baja **solo lo que abre** (la página y sus miniaturas), no la rama entera; un
  ciclo cada 30 s, parado con la pestaña oculta; *Available offline* baja la rama a pedido.
- **Lo que no se puede contar:** las miniaturas que sirve Storage (una política no puede escribir) y los pedidos `/m/`
  por rango de un video (cuentan en los 100 000 de Workers, no en el tope de pases; se mide en la entrega 3). Las
  miniaturas quedan acotadas por la rama (en Wanka, ~0,8 MB las de una página pesada) pero no por la cantidad de veces:
  quien repite pedidos a mano puede gastar egress hasta que se revoca el link. Si la entrega 3 mide que pasa, las
  miniaturas del link se pasan al plan B o C de 3.9.
- **Si un link se viraliza:** a las 300 aperturas del día se corta solo; el dueño ve el contador y hace *Reset link*. Lo
  contado de un solo link en un día queda acotado a ~240 MB de miniaturas en visitas normales, 50 MB de bajadas de bases,
  3000 pases y, con *Can edit*, 20 MB en la base; lo que no se cuenta (miniaturas pedidas a mano en bucle, rangos de
  video) dura hasta el *Reset*. El *rate limiting* de Workers es aproximado y por ubicación (documentación de Cloudflare):
  no sirve como contador, a lo sumo como freno extra en el portero (no se propone en la entrega 1).

### 3.14 Un miembro con sesión que abre un link

Si el navegador tiene una sesión en ese workspace y **su cuenta ve la página**, la app la abre con la cuenta (con sus
permisos, que pueden ser más) y no guarda el link (P14). Si su cuenta no la ve (o no tiene sesión), abre el modo link en
su propia base local, **sin cerrar la sesión** y sin usarla: es otra entrada en la lista del dispositivo, con su propio
cliente sin sesión (3.2), y volver al workspace es elegirlo en el selector (recarga, como cambiar de workspace).

### 3.15 Versiones viejas de la app

- **Una versión vieja que abre un `#link=`:** solo pasa en los dispositivos de quien ya usaba la app (un visitante nuevo
  baja la versión publicada). La versión de hoy solo lee `#invite=` (`src/invite.ts`): con `#link=` abre como siempre
  (el login o el último workspace) y no hace nada con el link; al actualizarse (v0.097), lo abre. No se pierde nada.
- **El servidor:** todas las funciones son nuevas; las de hoy no cambian de firma. `list_comments`, `page_history` y
  `pull_page_updates` (a quien ve lo borrado) suman columnas al final; la versión publicada las ignora (un comentario del
  link se vería como de una cuenta borrada; una fila de un link se aplicaría sin cuarentena), así que con cada entrega se
  sube `min_app_version`, y **la entrega 2 no se prende** (crear links *Can edit*) hasta que la mínima incluya la
  cuarentena.
- **El modo link en una versión anterior a la mínima:** `plink_open` devuelve la mínima; la app se actualiza antes de
  escribir, y las escrituras `plink_*` rechazan con `app_outdated` (503) sin escribir nada, como las demás.

## 4. Migración (borrador, sin aplicar)

Va como `supabase/migrations/<fecha>_link_publico.sql`, con `supabase/tests/link_publico_permisos.sql`, en la entrega 1
(la escritura de contenido y la cuarentena, en la 2). Necesita `pgcrypto` (`extensions.gen_random_bytes`,
`extensions.digest`), que Supabase ya trae.

```sql
-- Link público (P.19; Docs/Doc_Link_Publico.md). Un link da a quien lo tiene, sin cuenta, Comentar (Can view) o Editar
-- (Can edit) sobre una página y lo de abajo. El token viaja en el header x-shotdocs-link con el rol anon y se valida en
-- cada pedido. Nada se borra: un link revocado queda con revoked_at.

-- 1. Links, uso y topes.
create table public.public_links (
  id               uuid primary key,                                 -- lo crea el dispositivo (reintentar no duplica)
  page_id          uuid not null references public.pages (id),
  token            text not null unique check (token ~ '^sdl_[A-Za-z0-9_-]{43}$'),
  token_hash       bytea not null unique check (octet_length(token_hash) = 32),
  level            text not null check (level in ('comment', 'edit')),
  created_by       uuid references auth.users (id) on delete set null, -- nulo: el link no anda
  created_at       timestamptz not null default now(),
  expires_at       timestamptz check (expires_at is null or expires_at > created_at),
  revoked_at       timestamptz,
  revoked_by       uuid references auth.users (id) on delete set null,
  push_bytes_total bigint not null default 0,                         -- de por vida (3.8.1)
  files_total      int not null default 0,
  upload_bytes_total bigint not null default 0
);
create unique index public_links_one_live on public.public_links (page_id) where revoked_at is null;
alter table public.public_links enable row level security;
revoke all on public.public_links from public, anon, authenticated;     -- todo por funciones

create table public.public_link_usage (                                -- por link y día
  link_id uuid not null references public.public_links (id),
  day     date not null,
  kind    text not null check (kind in ('open', 'pull', 'pass', 'comment', 'push', 'file', 'upload')),
  n       bigint not null default 0,
  bytes   bigint not null default 0,
  primary key (link_id, day, kind)
);
create table public.public_link_usage_all (                            -- todos los links, por día
  day date not null, kind text not null, n bigint not null default 0, bytes bigint not null default 0,
  primary key (day, kind)
);
create table private.db_guard (id boolean primary key default true check (id), bytes bigint not null, at timestamptz not null);
-- (las tres con RLS prendido y sin permisos para anon ni authenticated)

alter table public.workspace_settings add column link_limits jsonb not null default '{
  "open": 300, "pull_bytes": 52428800, "all_pull_bytes": 157286400, "pass": 3000, "all_pass": 20000,
  "comment": 200, "push": 2000, "push_bytes": 20971520, "all_push_bytes": 52428800, "life_push_bytes": 104857600,
  "push_max_bytes": 1048576, "file": 100, "life_files": 500, "upload_bytes": 1073741824,
  "life_upload_bytes": 5368709120, "db_guard_bytes": 367001600}';

-- Autoría sin cuenta (como los comentarios importados): created_by / author_id quedan nulos.
alter table public.page_updates add column plink_id uuid references public.public_links (id),
                                add column plink_author text check (char_length(plink_author) between 1 and 60);
alter table public.comments add column plink_id uuid references public.public_links (id),
                            add column plink_author text check (char_length(plink_author) between 1 and 60),
                            add column plink_device_hash bytea check (octet_length(plink_device_hash) = 32),
                            add constraint comments_plink check ((plink_id is null) = (plink_author is null));
alter table public.files add column plink_id uuid references public.public_links (id);

-- 2. Quién comparte: UNA regla, para can_share y para el link.
create function private.user_can_share_page(p uuid, uid uuid) returns boolean ...;
  -- user_page_level(p, uid) >= 4 y (rol owner/admin activo, o dueño del proyecto); nunca un invitado
create or replace function private.can_share(p_project uuid, p_page uuid) returns boolean ...;
  -- la rama de página llama a user_can_share_page(p_page, auth.uid()) con session_allowed(); la de proyecto, igual que hoy
--   remove_member(): además, update public.public_links set revoked_at = now(), revoked_by = auth.uid()
--                    where created_by = p_user and revoked_at is null;

-- 3. El link del pedido.
create function private.plink_token() returns text language sql stable set search_path = '' as $$
  select t from (select current_setting('request.headers', true)::json ->> 'x-shotdocs-link' as t) s
  where t ~ '^sdl_[A-Za-z0-9_-]{43}$';
$$;
create function private.current_plink() returns public.public_links
language sql stable security definer set search_path = '' as $$
  select l.* from public.public_links l
  where l.token_hash = extensions.digest(private.plink_token(), 'sha256')
    and l.revoked_at is null and (l.expires_at is null or l.expires_at > now())
    and l.created_by is not null and private.user_can_share_page(l.page_id, l.created_by);
$$;
create function private.plink_page_level(p uuid) returns int ...;   -- 3.4
create function private.plink_file_level(f uuid) returns int ...;   -- páginas vivas de la rama que lo usan, sin
                                                                     -- removed_at ni is_foreign
create function private.plink_thumbs() returns text[] ...;          -- los nombres de miniaturas que el link puede leer
create function private.db_bytes() returns bigint ...;              -- VOLATILE: pg_database_size recordado 10 minutos
create function private.plink_count(p_kind text, p_n bigint default 1, p_bytes bigint default 0) returns void ...;
  -- VOLATILE: upsert en public_link_usage (link, día) y, si hay tope total, en public_link_usage_all; si pasa un tope
  -- de link_limits: raise 'link_rate_limited' (P0001). Lo rechazado no suma (la transacción entera se deshace).
revoke all on all functions in schema private from public, anon;   -- las nuevas, una por una
-- La política de thumbs (plan A) y nada más:
grant usage on schema private to anon;
grant execute on function private.plink_token(), private.plink_thumbs() to anon;

-- 4. Lo que llama el visitante (rol anon, por POST). Ninguna tabla se abre a anon.
create function public.plink_open(p_app_version text) returns json ...;              -- VOLATILE, cuenta 'open'
  -- {page, level, min_app_version, schema_version, format, limits_reached} o 'link_not_found' (P0002)
create function public.plink_tree() returns table (...) ...;                         -- STABLE; columnas de 3.5
create function public.plink_pull_page(p_page_id uuid, p_after_seq bigint)
  returns table (seq bigint, update text) ...;                                        -- VOLATILE; cuenta solo si
  -- devuelve la base (bytes); nunca page_updates
create function public.plink_list_comments(p_page_id uuid, p_since timestamptz) returns table (...) ...;  -- STABLE
  -- autores del equipo por la parte antes de la @; importados por imported_author (nunca imported_author_email); los
  -- del link por plink_author; `mine` por la huella de x-shotdocs-device
create function public.plink_add_comment(...) returns text ...;          -- VOLATILE, cuenta 'comment'; nunca resuelve
create function public.plink_edit_comment(...) ...; create function public.plink_delete_comment(...) ...;  -- VOLATILE
create function public.plink_media_file(p_file uuid) returns json ...;  -- VOLATILE, cuenta 'pass' (el portero, POST)
-- Entrega 2 (Can edit), todas VOLATILE: plink_push_page_update (3.8.1), plink_register_file (cuenta 'file' y
-- 'upload' con el peso), plink_link_page_file, plink_unlink_page_file, plink_set_file_drive, plink_set_file_thumb.
revoke all on function public.plink_open(text), ... from public, authenticated;
grant execute on function public.plink_open(text), ... to anon;         -- una por una, por firma completa

-- 5. Lo que llama quien comparte (authenticated, can_share).
create function public.create_public_link(p_id uuid, p_page uuid, p_level text, p_expires timestamptz) returns json ...;
  -- pide can_share y el interruptor de D14 (si no: 'clean_off'); genera el token con gen_random_bytes(32); reinicia la
  -- rama (clean_reset_seq = update_seq, clean_seq = 0); idempotente por p_id; devuelve {token, level, expires_at}
create function public.set_public_link(p_page uuid, p_level text, p_expires timestamptz) ...;  -- conserva el token
create function public.reset_public_link(p_page uuid) returns json ...;   -- revoca el vivo y crea otro
create function public.revoke_public_link(p_page uuid) ...;
create function public.get_public_link(p_page uuid) returns json ...;
  -- el link de la página o el de una de arriba (con su página), el uso de hoy, el total subido y las filas apartadas;
  -- el token solo si es de esta página
create function public.delete_public_link_comments(p_link uuid) returns int ...;   -- pide 4 sobre la raíz

-- 6. Lo que cambia de lo que ya existe.
--   private.has_plain_readers(p): or exists (un link vivo cuya raíz está en la cadena de p).
--   clean_work: las raíces de los links vivos entran en `reach`.
--   pages_permissions(): mover una página a una rama con link vivo reinicia su base (como con lectores).
--   pull_page_updates (rama de quien ve lo borrado), page_history y list_comments: suman plink_id / plink_author al final.
--   Storage, bucket thumbs (plan A, después de la prueba de caché): select para anon con
--     bucket_id = 'thumbs' and private.plink_token() is not null and name = any ((select private.plink_thumbs())::text[]);
--     insert para anon (entrega 2) con el archivo registrado por ese link.
update public.workspace_settings set schema_version = <la que siga> where id and schema_version < <la que siga>;
notify pgrst, 'reload schema';
```

## 5. Cambios en la app y el portero

| Dónde | Entrega | Qué |
|---|---|---|
| `public/_headers`, `public/robots.txt` | 0 | `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy`, `Disallow: /` |
| `src/invite.ts`, `src/workspaces.ts` | 1 | Leer `#link=`; la entrada de tipo *link* en la lista del dispositivo (con su base local `shotdocs-link:<clave local>:<id del link>` y su id de dispositivo); el cartel con el dominio; borrar el `#` de la barra |
| `src/sync/remote.ts` | 1 | `LinkRemote`: las mismas operaciones que usa el motor, sobre `plink_*`, con un cliente sin sesión y los headers |
| `src/sync/engine.ts` | 1 | Modo liviano: bajar solo lo abierto, ciclo de 30 s, parado con la pestaña oculta; `serverSeqFor` = `clean_seq` |
| `src/ui/ShareDialog.tsx` (+ `shareGate.tsx`) | 1 | *General access* (3.11) |
| La página y la barra | 1 | Solo la rama, sin nombres de workspace ni proyecto, *Shared with a link · <dominio>* |
| Comentarios | 1 | *Your name*, *(via link)*, `mine`, sin resolver |
| `src/media/portero.ts` | 1 | Pases con el header; sin imagen nítida automática en modo link; miniaturas según el plan que salga de la entrega 0 |
| `portero/src/core.ts` | 1 (ver) y 2 (subir) | Las rutas de 3.9 con `plink_media_file`; pases de 2 horas (también en `/folder/list`); CORS con `x-shotdocs-link` y `x-shotdocs-device`; sin reenviar `Authorization` con el link |
| `src/sync/docs.ts` | 2 | La cuarentena (3.8.2): `docQuarantine`, la prueba de las filas con `plink_id`, el aviso |
| La cola sin red | 2 | Los rechazos de 3.8.3 con *Download them*; umbral de la subida sin GC en 1 MB |
| Historial (Worker incluido) | 2 | *Ana (via link)* y *Set aside (via link)*, con la misma prueba |
| Ayuda (`src/help/entries.ts`, `src/i18n/lazy/help.ts`) | 1 y 2 | *Share with a link*, *Opened with a link* |
| `src/sync/testing.ts` | 1 y 2 | El servidor en memoria con links, el header, los topes y las filas de un link |
| `Doc_Supabase.md`, `Doc_Portero.md`, `Doc_Sincronizacion.md`, `Plan_Workspaces.md` (sección 4) | 1 y 2 | Al implementar |

## 6. Pruebas

1. **Permisos en SQL** (`supabase/tests/link_publico_permisos.sql`, en `begin … rollback` con un script propio, nunca
   `npm run db:test`; los headers con `set_config('request.headers', …)` y `set role anon`), los casos del prototipo P1
   (sección "Cómo se midió") más:
   - cada función `plink_*` con el link de otra página, de otro proyecto, vencido, revocado, reemplazado, con el creador
     sin `can_share` (también **un miembro común con nivel 4 que no es admin ni dueño del proyecto**), sacado (y vuelto a
     sumar: el link sigue revocado) o invitado, sin header, con el token en mayúsculas o con espacios, y con una página de
     la rama en la papelera;
   - `plink_pull_page` **nunca** devuelve bytes de `page_updates` (con y sin base vigente) ni con el interruptor apagado;
     al día no escribe nada; con base, cuenta los bytes;
   - `plink_tree` no trae nada de arriba ni del costado, ni ids de afuera (proyecto, `template_id`), y sus columnas son
     exactamente las de la lista de 3.5;
   - `plink_media_file` y la política de `thumbs` no dan una foto sacada (`removed_at`), de otro proyecto (`is_foreign`) ni
     de una página de la papelera; la política sin header no lee nada y el listado del bucket entero con el link se mide
     con todos los objetos;
   - `anon` no lee ninguna tabla (`pages`, `page_updates`, `comments`, `files`, `page_files`, `public_links`,
     `public_link_usage`, `public_link_usage_all`, `workspace_settings`) ni llama a las funciones de siempre
     (`pull_page_updates`, `list_comments`, `media_file`, `share`…) ni a ninguna de `private` salvo `plink_token` y
     `plink_thumbs`;
   - cada función que cuenta, llamada en una transacción de solo lectura, falla (es `VOLATILE`), y por `POST` anda;
   - `create_public_link` rechazado sin `can_share`, a un invitado, con el interruptor apagado y en una página de la
     papelera; *Reset* invalida el viejo;
   - los topes: el 301.º `plink_open` da `link_rate_limited`, también con dos links de la misma página; los totales de
     todos los links (`all_pass`, `all_pull_bytes`, `all_push_bytes`) con dos links;
   - los comentarios del link: no resuelven, no editan ni borran los de otros, sí los suyos con la misma huella de
     dispositivo y no con otra; quien tiene 4 los borra; `plink_list_comments` no devuelve ningún correo (ni del equipo ni
     `imported_author_email`);
   - las funciones de siempre siguen iguales para las cuentas (las pruebas de `supabase/tests/` pasan), y `can_share` da
     lo mismo que antes para cada caso de `equipo_permisos.sql`.
   - **Entrega 2:** la subida de 1 MB + 1 da `update_size_invalid`; la que pasa el tope del día, el de por vida, el total
     de links o la guarda de la base da `link_rate_limited`, y lo rechazado no suma; la autoría queda en la fila.
   - **Mutantes:** los de P1 (sin mirar hacia arriba, sin papelera, sin creador, sin el rol de `can_share`, sin vencer, sin
     revocar, sacar sin revocar, el árbol con la papelera, bajadas sin contar, sin tope por subida, sin bytes por día, sin
     guarda de la base, sin total de links, comentarios con correo), más `plink_pull_page` que sirve filas,
     `plink_file_level` sin `removed_at`, `plink_tree` que trae el padre de la raíz, la política de `thumbs` sin el header y
     `plink_count` que no corta.
2. **El servidor en memoria** (`src/sync/testing.ts`) y pruebas del motor en modo link: abrir, bajar solo lo abierto,
   "en preparación", el reinicio al crear el link, dos dispositivos con el mismo link, el invariante de D14 (lo que recibe
   el visitante estuvo visible en alguna base: P7 de `Doc_Privacidad_Borrado.md` con un lector por link), y que el
   cliente del modo link nunca manda el `Authorization` de una cuenta aunque el navegador tenga una sesión.
3. **Entrega 2, con el editor real** (jsdom): la cuarentena de P2 pasada a vitest con `PageDocs` (basura, dependencias que
   nunca subieron, borrados de algo que no existe, un tipo de bloque desconocido, una marca desconocida, y la fila honesta
   que sigue): la base limpia se arma y pasa su comprobación, ninguna fila honesta va aparte, dos editores (uno de a poco y
   otro de cero) apartan lo mismo, la página nunca queda `unreadable`, el historial no se traba, y el mutante sin
   cuarentena traba la base. Más *Can edit* sin red: la cola, la reconexión, y cada rechazo de 3.8.3 sin perder nada.
4. **El portero** (`portero/src/core.test.ts`, con Supabase simulado): cada ruta con el header (las del dueño lo
   rechazan), los pases de 2 horas (también los de `/folder/list`), que con el header del link no se reenvía ningún
   `Authorization`, la subida atada al link y a la huella, el link revocado a mitad de una subida.
5. **Recorridos en Chromium sin login** (el modo link no tiene login): un arnés local con la app real sobre el servidor en
   memoria: abrir el link (el cartel con el dominio), el árbol solo de la rama, el camino de arriba desde la raíz, un link
   interno a una página de afuera sin título, comentar con nombre, *Can edit* escribe y sube una foto sin red y con red,
   *Reset link* desde otra pestaña y lo que ve el visitante, el `#` borrado de la barra.
6. **De punta a punta contra la base real** (lista para Lega o para quien publica): crear el link con la cuenta del dueño;
   abrirlo en una ventana de incógnito (sin cuenta, sin código); revisar en *Network* que ninguna respuesta tiene un
   texto borrado ni una página de afuera, que la dirección de la barra no tiene el token, y que *Reset link* corta en el
   próximo ciclo.

## 7. Entregas

| | Qué | Pruebas | Riesgo |
|---|---|---|---|
| **0** | La prueba técnica en la base real, sin usuarios ni login, con una función, un objeto y una política de prueba que se sacan al terminar: (a) con `curl` y la clave publicable, que `x-shotdocs-link` llega a `request.headers` en una RPC y en una política de Storage; (b) **la caché de Storage**: `GET` de la miniatura de prueba con el header válido dos veces (`cf-cache-status`), y después sin el header y con un token revocado, que tienen que dar 400 o 404 y nunca `HIT`; si da `HIT`, lo mismo con `createSignedUrls` (plan B); (c) medir `plink_page_level`, `plink_tree` y el listado del bucket con la política (`explain analyze` en `begin … rollback`). Y `noindex` (`_headers`, `robots.txt`) | Las respuestas de `curl`; tiempos | Bajo |
| **1** | *Can view* completo: la migración (links, lectura, comentarios, archivos, topes de lectura), *Share*, el modo link (solo lectura con comentarios), el portero para ver, las miniaturas por el plan que salió de la 0. Requiere el interruptor de D14 prendido en Wanka | 1, 2, 4, 5, 6 | **Alto**: abre un camino sin cuenta a la base |
| **2** | *Can edit*: los topes por bytes y la guarda de la base, la cuarentena, escribir, subir archivos, la cola sin red con sus rechazos, el historial. **Antes de programarla, una auditoría solo de 3.8.1 y 3.8.2** (pedido de la auditoría). Se habilita *Can edit* en *Share* recién con `min_app_version` en esta versión | 1 a 6 (las de escritura y la 3) | **Alto**: escrituras sin cuenta, la base y el Drive del dueño |
| **3** | Medir el uso real (egress del mes, `public_link_usage`, los `/m/` de video en Workers) y ajustar los topes; el link de un proyecto entero (P16) | — | Medio |

Antes de cerrar cada entrega, la auditoría independiente de siempre (funcionalidad, permisos y RLS, no perder datos,
documentación y las reglas del repo).

## 8. Riesgos

| Riesgo | Qué lo cubre |
|---|---|
| Un error en una función `plink_*` da algo de arriba o del costado | Una sola función de nivel (`plink_page_level`) que todas usan; ninguna tabla abierta a `anon`; pruebas negativas con mutantes |
| Lo borrado llega al visitante | Solo bases (D14), con el interruptor como requisito; `plink_pull_page` nunca lee `page_updates` (mutante) |
| La caché de Storage le sirve una miniatura a quien no tiene el link | La prueba de la entrega 0 antes de la política; planes B y C |
| Un visitante llena la base y la deja en solo lectura | Tope por subida, por día, de por vida, del total de links y la guarda de 350 MB (3.8.1) |
| Una fila de un visitante traba la base limpia de la página | La cuarentena (3.8.2), con el mutante que la saca |
| El link se reenvía o se publica | *Reset link* instantáneo; contador en *Share*; topes; `noindex`; la ayuda dice que no es para material sensible (`Plan_Workspaces.md`, sección 4) |
| Un link viral deja sin portero o sin egress al equipo | Topes por link y del total de links (P11), modo liviano (P12); lo que no se cuenta, dicho en 3.13 |
| Spam de comentarios | Tope por link, *Delete comments from this link*, *Reset link* |
| Un visitante con *Can edit* llena el Drive o borra contenido | Topes de archivos por día y de por vida; borrar contenido es una edición: el historial la restaura (D13) |
| Alguien se hace pasar por el equipo | El nombre lleva siempre *(via link)*; el equipo ve qué link |
| Un link de un miembro que se fue revive al volver | `remove_member` lo revoca |
| Lo escrito por un visitante se pierde al revocar o al pasar un tope | Nada se borra del dispositivo; *Download them* |
| El token queda en el dispositivo del visitante | Igual que una sesión; revocar lo corta |
| Un `#link=` con la dirección de otro Supabase | El cartel con el dominio; el cliente del link nunca lleva una sesión; el id de dispositivo es uno por link |
| Los registros de la API de Supabase guardan el header | A confirmar en la entrega 0 (qué headers guardan los *API logs*); si lo guardan, solo lo ve el dueño del proyecto, y revocar lo vuelve inútil |
| Un pase ya dado sigue abriendo el archivo | 2 horas para el link (P17), también los de `/folder/list` |
| Una versión vieja escribe mal o aplica una fila mala | `min_app_version` con cada entrega; *Can edit* se habilita con la mínima que trae la cuarentena |

## 9. Decisiones y propuestas

**Tomadas el 2026-10-02:**

- **D29 · *Can edit* por link = contenido y archivos** (P3 aprobada): no crea, mueve, renombra ni borra páginas.
- **D30 · Vencimiento opcional, *Never* por defecto** (P7 aprobada), con 1, 7, 30 días o una fecha.
- **D31 · Las demás propuestas se adoptan con las condiciones de la auditoría:** P1, P2, P4, P5, P6 (con la regla única
  de `can_share` y sacar a alguien revoca sus links), P8, P9 (sin `imported_author_email`), P10, P11 (con los topes por
  bytes, las bajadas que devuelven base y los totales de todos los links), P12 a P14, P15 (con los topes de por vida y el
  conteo de las carpetas), P16 y P17 (también en `/folder/list`).

| # | Propuesta | Recomendación | Por qué | Cómo se revierte |
|---|---|---|---|---|
| **P1** (D31) | Cómo entra sin cuenta | **Token del link validado por la base en cada pedido** (camino B), no sesiones anónimas | Con el registro cerrado los anónimos no andan; abrirlo pide el hook y cambia Auth para todo el proyecto; sin MAU ni cuentas que limpiar | La tabla de links sirve para A: `plink_open` ataría el uid anónimo |
| **P2** (D31) | *Can view* | **Ver, bajar y comentar** (nivel 2), responder; sin resolver hilos ni borrar los de otros | Es lo que pidió Lega ("siempre puede comentar"); resolver es del equipo | Dejarlo resolver: una condición en `plink_add_comment` |
| **P3** (D29) | *Can edit* | **Editar** (nivel 3): contenido y archivos; **no** crea, mueve, renombra ni borra páginas | Cambiar el árbol sin cuenta es lo más fácil de romper y lo más difícil de deshacer | Sumar nivel 4 al link (*Can edit and create pages*) |
| **P4** (D31) | Privacidad | **Como un invitado:** base limpia (D14), sin historial (D13), sin papelera (D21) | Un link se reenvía: nunca más que un invitado | — |
| **P5** (D31) | Interruptor de D14 | **No se crea un link con el interruptor apagado** | Sin bases no hay qué servir sin mandar lo borrado | Ninguno seguro: servir filas al link filtraría lo borrado |
| **P6** (D31) | Quién lo crea | **Quien hoy puede compartir** (una sola regla con `can_share`); el link anda mientras su creador lo siga pudiendo; **sacar a alguien revoca sus links** | Mismo criterio que compartir con personas; un empleado que se va no deja links vivos, ni revividos si vuelve | Que dueño y admins "adopten" los links al sacar a alguien |
| **P7** (D30) | Vencimiento | **Opcional, *Never* por defecto**, con 1, 7, 30 días o una fecha | Un documento de rodaje se usa semanas; el corte rápido es *Reset* | Cambiar el valor por defecto en *Share* |
| **P8** (D31) | Nombre del visitante | **Lo pide al comentar o editar por primera vez**, guardado en el dispositivo, mostrado con *(via link)* | No frena a quien solo mira; el sufijo evita hacerse pasar por el equipo | Pedirlo al entrar |
| **P9** (D31) | Qué ve de las personas | **El nombre antes de la @** del equipo y el nombre de los importados; **ningún correo** | Un link puede llegar a cualquiera (a un invitado Lega le muestra los correos) | Mostrar el correo, como a los invitados |
| **P10** (D31) | Nombres del workspace y del proyecto | **No se muestran**; solo el título de la página compartida y el dominio | "Nunca lo de arriba" vale también para los nombres | Mostrarlos |
| **P11** (D31) | Topes | **Los de 3.13** (por link y día, del total de links y de por vida), ajustables por workspace, con la guarda de la base | Con eso un link no puede agotar el portero, el egress ni la base | Cambiar `workspace_settings.link_limits` |
| **P12** (D31) | Modo liviano | **El visitante baja solo lo que abre**, sin imagen nítida automática; ciclo de 30 s, parado oculto | Una visita gasta lo que abre, no la rama entera (que puede tener cientos de páginas) ni cada original | Modo completo como un invitado |
| **P13** (D31) | Buscadores | **`noindex` para toda la app** y `robots.txt` cerrado; `Referrer-Policy` explícito | La app no tiene nada que indexar; no hay landing pública | Sacar las líneas de `_headers` |
| **P14** (D31) | Miembro con sesión que abre un link | **Si su cuenta ve la página, entra con la cuenta**; si no, modo link aparte sin cerrar ni usar la sesión | No mezcla permisos; no desloguea | Abrir siempre en modo link |
| **P15** (D31) | Archivos subidos por un visitante | **Van al Drive del dueño** como los del equipo (`files.plink_id`), con los topes por día y de por vida, contando también las carpetas | Es lo que pide *Can edit*; el dueño los ve y los puede mandar a la papelera | Que *Can edit* por link no suba archivos |
| **P16** (D31) | Alcance | **Solo páginas** en la entrega 1; un proyecto entero, en la 3 | Una página (con su rama) es el caso del pedido | Sumarlo antes |
| **P17** (D31) | Pases del portero para el link | **2 horas** (8 para las cuentas), también en `/folder/list` | Revocar corta antes lo ya abierto | Volver a 8 |

## 10. Lo que solo Lega puede hacer o decidir

- **Nada en el panel de Supabase Auth, de Google ni de DNS** con P1: es su ventaja. Con el camino A haría falta, en este
  orden: conectar y probar el hook de invitaciones, cambiarlo para los anónimos, abrir el registro, prender los anónimos y
  crear un Turnstile (Cloudflare) para el captcha.
- **Prender el interruptor de D14 en Wanka** (con el cambio del script de restaurar del repo privado de copias, la
  versión mínima y la copia de seguridad): requisito de la entrega 1. Lo prepara quien publica; la copia la corre la tarea
  de GitHub.
- **Saber que *Can edit* no es "como Google Docs"** sin un editor conectado (3.8.3): los visitantes ven lo de los demás
  cuando alguien del equipo abre la app.
- **La prueba de punta a punta** con su cuenta (crear el link) y una ventana de incógnito (abrirlo), y probarlo en el
  iPhone sin la app instalada.

## 11. Lo que no se pudo comprobar

- Que `x-shotdocs-link` llegue a `request.headers` **en el proyecto real** por Storage (PostgREST ya lo hace con
  `x-shotdocs-version`; el código de Storage lo hace): entrega 0.
- **Cómo cachea Storage los buckets privados** con el rol `anon` y si firmar URLs evalúa la política con el header
  (entrega 0, B3).
- Qué headers guardan los registros de la API de Supabase (*API Gateway logs*).
- Los tiempos en la base real: los prototipos corren en PGlite (Postgres 18 compilado a WebAssembly), unas 4 a 5 veces más
  lento que el `user_page_level` medido en Supabase; las cifras son relativas.
- La cuarentena con el editor real (BlockNote, sus marcas y la guarda de v0.021): el prototipo usa Yjs con una lista de
  tipos permitidos; la entrega 2 la pasa a vitest con `PageDocs`.
- Cómo se comporta el modo link en el iPhone sin instalar (Safari, 7 días sin uso).
- Si una cuenta anónima convertida con `updateUser({ email })` saltea el registro cerrado (camino A, descartado).
- El egress real de un cliente y cuántas veces se abre un link en un rodaje (entrega 3).

## 12. Fuera de este diseño

- **`public.rls_auto_enable`** (O16 de la auditoría): `anon` la puede ejecutar (es `SECURITY DEFINER`). Por el nombre
  parece la función del disparador de eventos que agrega Supabase para prender RLS sola; no está en las migraciones del
  repo y una función de disparador no se puede llamar como RPC, así que el riesgo práctico es nulo. Para dejarlo limpio,
  en la migración de la entrega 1: mirarla y quitarle `execute` a `anon` si no hace falta.

## Correcciones de la auditoría (2026-10-02)

Una auditoría independiente dio "aprobado con condiciones": la entrega 0 y la 1 pueden avanzar con las condiciones C1 a
C6; la 2 quedaba bloqueada por B1 y B2. Todo corregido arriba:

| Hallazgo | Corrección |
|---|---|
| **B1.** Sin tope de bytes, un visitante con *Can edit* llenaba la base del plan gratis (500 MB, solo lectura para todos) con ~60 subidas de 8 MB | 3.8.1: 1 MB por subida, 20 MB por link y día, 100 MB de por vida, 50 MB entre todos los links, guarda de la base en 350 MB; umbral de la subida sin GC en 1 MB; miniaturas y Drive con topes de por vida |
| **B2.** Una fila ilegible de un link dejaba la página `unreadable` y sin base limpia para todos los lectores | 3.8.2: la cuarentena en el dispositivo del editor (P2: 300 de 300 bases, 0 honestas apartadas; sin cuarentena, 0 de 300); *Can edit* se vuelve a auditar antes de programarse |
| **B3.** La caché de Storage con `anon` | 3.9 y entrega 0: la prueba con `curl` antes de la política; planes B (URLs firmadas) y C (portero) |
| C2 / O1. El prototipo validaba al creador con nivel 4, no con `can_share` | Una sola regla (`user_can_share_page`) que también usa `can_share`; casos y mutante "sin el rol" en el prototipo |
| C3 / O2. La política de `thumbs` para `anon` necesitaba permisos que el borrador negaba | `usage` de `private` y `execute` solo de `plink_token` y `plink_thumbs`; la guarda del token primero; el conjunto una vez por consulta (8,5 s → 0,24 s el listado en el prototipo) |
| C4 / O3. Las funciones que cuentan iban en solo lectura | `VOLATILE` y `POST`, escrito en el borrador y probado |
| C5 / O4, O5. Lecturas sin contar y `all_pass` fuera del esquema | Cuenta las bajadas que devuelven base (`pull_bytes`); `public_link_usage_all`; 3.13 reescrito con lo que no se cuenta |
| O6. Volver a sumar al creador revivía sus links | `remove_member` los revoca (caso en el prototipo) |
| O7. El id de dispositivo | Uno por link; el tope por dispositivo se sacó (no frena a nadie) |
| O8. *Can edit* sin editores conectados | 3.8.3, *Share*, la ayuda y la sección 10 |
| O9. La cola con otros rechazos | La tabla de 3.8.3 |
| C6 / O10, O11. Correos de terceros y columnas del árbol | P9 sin ningún correo (caso en el prototipo); lista cerrada de columnas y el id del link en lugar del proyecto |
| O12. El prefijo `link_` chocaba con `link_page_file` | `plink_*`, `public_links`, `*_public_link` |
| O13. Pases de `/folder/list` | 2 horas también |
| O14. Los `/m/` de video | Dicho en 3.13; se mide en la entrega 3 |
| O15. El Drive del dueño | 5 GB de por vida por link y el aviso en *Share* |
| O16. `rls_auto_enable` | Sección 12 |
| O18. Un `#link=` con otra dirección | 3.2: el cartel con el dominio, el cliente sin sesión, pruebas 2 y 4 |

## Cómo se midió

Prototipos fuera del repo, con sus resultados en `res_*.txt`. No se creó ningún usuario, no se entró con login ni se tocó
la configuración de Auth.

- **P1, permisos** (`p1_permisos.mjs`, PGlite 0.5.8 = Postgres 18.3 en memoria): un esquema reducido (`workspaces`,
  `members`, `grants`, `pages`, `public_links`, `public_link_usage`, `public_link_usage_all`, `page_updates`, `comments`,
  la base limpia y un "bucket"), las funciones de 3.3 y 3.4 con `user_can_share_page`, `plink_tree`, `plink_open`,
  `plink_pull_page`, `plink_push_page_update` con sus topes, `plink_list_comments`, la política de miniaturas, el rol
  `anon` y los headers con `set_config('request.headers', …)`. **71 de 71** casos: raíz, hijas, arriba, costado, otro
  proyecto, papelera, proyecto borrado, mover adentro y afuera, mover la raíz (bajo otra página, a la papelera y de
  vuelta), dos links en la misma rama, vencido, revocado, link nuevo, la regla real de compartir (miembro común con 4: no;
  admin: sí; sin el permiso: no; sacado: no; vuelto a sumar: sigue revocado), invitado creador, tokens malos, `anon` sin
  tablas ni funciones privadas, la política con y sin header y con token revocado, contar en solo lectura, los topes de
  aperturas, de bajadas (al día no cuentan), de tamaño por subida, de bytes por día, de por vida, del total de links y la
  guarda de la base, la autoría en la fila y los comentarios sin correos. **Mutantes** (`res_p1_mutantes.txt`): 14 de 16
  detectados; los dos que no: el chequeo de formato (la huella igual rechaza) y la política sin el "una vez por consulta"
  (da lo mismo, pero el listado tarda 8,5 s en vez de 0,24 s). **Tiempos** (PGlite, unas 4,7 veces más lento que la base
  real): `current_plink` 1,3-1,9 ms; `plink_page_level` de una hoja a 60 niveles 7-11 ms (el `user_page_level` de hoy, en
  el mismo PGlite, 6-9 ms; en la base real, ~2 ms); `plink_tree` con ~2000 páginas 130-170 ms; listar 1923 miniaturas con
  el link 0,24-0,26 s y sin header 0,4-0,7 ms; una miniatura por nombre 0,3-0,4 ms; `pg_database_size` 1,7-3,4 ms. La
  primera versión del prototipo (36 casos, 6 de 7 mutantes) queda como `p1_permisos_v1.mjs`.
- **P2, la cuarentena** (`p2_cuarentena.mjs`, Yjs 13.6.33, el de la app; 300 corridas de 40 pasos): un editor, un
  visitante honesto que escribe sobre la última base y uno que molesta con cinco tipos de filas (basura, una que depende
  de algo que no subió, un borrado de algo que no existe, un bloque de tipo desconocido y la que sigue a una pendiente);
  la base se arma con la comprobación de D14 de `src/sync/clean.ts` (copiada igual). Resultado (`res_p2.txt`): 1760
  filas malas, 1727 apartadas (las otras 33 no dependían de nada y no rompían nada: se aplicaron y la base pasó igual);
  base armada **300 de 300**; filas honestas apartadas **0** de 4284; textos del visitante honesto en la base 3197 de
  3197; el visitante ve lo mismo que el editor 300 de 300; un editor de a poco y otro de cero apartan lo mismo y terminan
  iguales 300 de 300. **Mutante sin cuarentena** (lo de hoy, `res_p2_mutante.txt`): base armada **0 de 300**. **Costo**
  (`p2b_costo.mjs`): 2,3 ms por fila en una página de 67 KB, 13,6 ms en 560 KB, 58 ms en 2 MB. **Límite:** sin BlockNote
  (bloques y párrafos como `XmlElement`, una lista de tipos permitidos en vez de la guarda real).
- **Uso real** (`ro_stats.mjs`, solo lectura con el cliente de la Management API en modo `dryRun` y `readQuery`; no se
  imprimió contenido): tamaños de `storage.objects` del bucket `thumbs`, archivos por página en `page_files`, tipos y
  pesos de `files`, bytes de `page_updates` por página. El tamaño de la base (28 MB) y los permisos de `anon` en el
  catálogo, de la auditoría.
- **Documentación y código consultados (2026-10-02):** Supabase Auth `internal/api/anonymous.go` (el corte por
  `DisableSignup` y el hook), *Anonymous Sign-Ins* (rol, `is_anonymous`, 30 por hora por IP, captcha, sin limpieza),
  *Monthly Active Users* (50 000 gratis), *Egress* (5 GB + 5 GB cacheado), *Database size* (500 MB; al pasarlo, solo
  lectura), *Storage CDN* y *Smart CDN* (caché de buckets privados "por usuario"), PostgREST *Transactions*
  (`request.headers`, rol anónimo, solo lectura para `STABLE`), Supabase Storage `src/internal/database/postgres/scope.ts`
  (`set_config('request.headers', …)`), Cloudflare Workers *Limits* (100 000 pedidos por día, Error 1027, 10 ms de CPU)
  y *Rate Limiting* (aproximado, por ubicación).
