# Link público: «Anyone with the link»

**Estado: entregas 0 y 1 implementadas (v0.114, *Can view*; migración aplicada, ver "Cómo quedó (entregas 0 y 1)"
al final); la 2 (*Can edit*) se rediseñó el 2026-10-02 contra v0.137 (sala de espera y admisión por un editor, ver
"Entrega 2: *Can edit* (rediseño 2026-10-02)", al final) y se auditó: aprobado con condiciones, corregido y aprobado en la re-verificación (E2.18).
**La 2a (escribir) está implementada (v0.151), con su migración aplicada y el interruptor `link_edit_min_version`
prendido en 0.151 (era nulo al implementarla): ver "Cómo quedó la 2a"; la barrera de error alrededor de `PageEditor` que se pedía antes de prenderlo (R4) ya está en `main`
(R4)** (roadmap P.19;
pedido de Lega del 2026-10-02). Corregido con la auditoría
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
  frenar su base limpia, y sin perder nada. Antes de programarla se vuelve a auditar solo eso. **Rediseñada el
  2026-10-02** ("Entrega 2: *Can edit* (rediseño 2026-10-02)"): con las copias resumidas, la cuarentena en cada
  dispositivo ya no alcanza; lo que escribe un link espera en una sala y entra a la página recién cuando el dispositivo
  de un editor lo prueba.
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
  nombre (así nadie del link se hace pasar por alguien del equipo). A quien puede compartir la página del link, además,
  una línea debajo dice qué link (*Can view link · created by lega*, y *closed*, *expired* o *not working* si ya no
  anda): hecho en v0.222, ver "De qué link vino cada comentario (v0.222)".
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

> **Reemplazado** por "Entrega 2: *Can edit* (rediseño 2026-10-02)", al final (E2.1 dice qué supuesto de acá dejó de
> valer y por qué). Queda como historia, igual que lo de la entrega 2 en 3.10 (*Compactar*), 3.15, 4, 5, 6 y 7.

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
- **Carpetas (P.9)** y ***Download all*** (v0.105): andan con los pases del listado. **Cada pedido de listado cuenta un
  pase** para el tope (el de la carpeta: el portero le pregunta a la base una vez por pedido, `plink_media_file`, y firma
  él los pases de hasta 100 archivos, que duran 2 horas); los archivos listados no cuentan de a uno. Bajar una carpeta
  de 1000 archivos gasta unos 10 pases de los 3000 del día, más los de sus subcarpetas (hasta 40 por pedido).
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

*Hoy: la migración real es `20261012120000_link_publico.sql`, aplicada (verificado en la base el 2026-10-06).*

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
| `portero/src/core.ts` | 1 (ver) y 2 (subir) | Las rutas de 3.9 con `plink_media_file`; pases de 2 horas (también en `/folder/list`); CORS con `x-shotdocs-link`, `x-shotdocs-device` y `x-shotdocs-version` (este último recién desde v0.218: ver "El portero no aceptaba la versión de la app"); sin reenviar `Authorization` con el link |
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
| **2** | *Can edit*: los topes por bytes y la guarda de la base, la cuarentena, escribir, subir archivos, la cola sin red con sus rechazos, el historial. **Antes de programarla, una auditoría solo de 3.8.1 y 3.8.2** (pedido de la auditoría). Se habilita *Can edit* en *Share* recién con `min_app_version` en esta versión. **Rediseñada: ver E2.13 (2a, 2b, 2c)** | 1 a 6 (las de escritura y la 3) | **Alto**: escrituras sin cuenta, la base y el Drive del dueño |
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

## Re-verificación de las correcciones (2026-10-02)

Una segunda auditoría independiente re-verificó B1, B2 y B3: corregidos (B1: el prototipo pasa 71 de 71 casos y detecta 14
de 16 mutantes; B2: con la cuarentena la base limpia se arma en 300 de 300 corridas, sin ella en 0; B3 se prueba en la
entrega 0). Lo que encontró va así:

- **Condiciones para programar la entrega 1** (*Can view*):
  - **N1.** Los comentarios de un link no tienen tope de bytes: 10 000 caracteres (hasta 40 KB) por comentario y 200 por
    día son unos 8 MB por día, y en unos 57 días la base del plan gratis queda en solo lectura. `plink_add_comment` y
    `plink_edit_comment` llevan la guarda `db_bytes()`, un tope de bytes por link y día (1 MB) y uno de por vida, en la
    tabla de 3.13 y en las pruebas de 6.1 con un mutante.
  - **N2.** `plink_tree` y `plink_list_comments` sin `since` devuelven datos sin contarlos: cuentan sus bytes como
    `plink_pull_page` (o al menos figuran en 3.13 como no contados), y `all_pull_bytes` lleva un tope mensual que deje
    margen en los 5 GB de egress.
  - La guarda mide como Supabase, la suma de todas las bases (`sum(pg_database_size(datname))`), no solo la actual.
- **Entrega 0:** la prueba de caché suma el caso de un token válido de otro link (400 o 404, nunca `HIT`), con los
  headers que manda supabase-js.
- **Para la re-auditoría de 3.8.1 y 3.8.2 antes de la entrega 2** (*Can edit*): N3 (una subida rechazada por tamaño traba
  lo que sigue en esa página desde ese dispositivo: el motor tiene un solo pendiente por página; la tabla de 3.8.3 dice
  otra cosa), N4 (un link puede llevar una página a más de 8 MB de contenido válido y frenar su base limpia: tope por
  página para lo que entra por links), N5 (la cuarentena prueba también `checkCleanBase`) y la idempotencia por
  `client_update_id` antes de los topes.

## Cómo quedó (entregas 0 y 1)

### Entrega 0: la base real (2026-10-02)

Con `curl` (en `fetch` de Node, con los headers que manda supabase-js: `apikey` y `Authorization` con la clave
publicable, `X-Client-Info`, `x-shotdocs-version`, `x-shotdocs-link`, `x-shotdocs-device`), una función, dos objetos y
tres políticas de prueba sobre `thumbs` (`zz_plink_probe*`), sacados al terminar (verificado: 0 objetos, 0 políticas, 0
funciones). Sin usuarios ni login.

| Prueba | Respuesta |
|---|---|
| RPC por `POST` con el header | 200; la función lee `x-shotdocs-link`, `x-shotdocs-device` y `x-shotdocs-version`; rol `anon`, `auth.uid()` nulo |
| Subir a `thumbs` con el token (política de `insert` que mira el header) / sin header | 200 / 400 (*new row violates row-level security policy*): el header llega a las políticas de Storage |
| `GET` de la miniatura con el token, tres veces | 200 `MISS`, 200 `HIT`, 200 `HIT` (`cache-control: public, max-age=3600`) |
| El mismo `GET` sin header, con un token válido de otro link, con uno al azar, solo con `apikey` | 400 `BYPASS` las cuatro veces |
| Revocar el token (la política pasa a otro) y repetir el `GET` con el viejo, dos veces | 400 `BYPASS` las dos |
| El token nuevo, sobre el objeto que estaba en caché | 200 `HIT` |
| `createSignedUrls` con el token / revocado / sin header (plan B) | firma solo lo que la política deja; lo demás, *Either the object does not exist or you do not have access to it* |

**Conclusión: plan A.** La caché de Storage (*Smart CDN*) es por objeto, pero cada pedido pasa por la política: un
`HIT` solo se sirve a quien la política deja, y un token revocado da 400 en el acto aunque el objeto siga en caché. La
política de `thumbs` para `anon` quedó en la migración. **Lo que no se pudo comprobar:** qué headers guardan los
registros de la API (el endpoint de registros de la Management API responde 410). La respuesta lleva
`cache-control: public`: un proxy compartido que abra el HTTPS (una red corporativa) podría guardar una miniatura;
acotado (son miniaturas de la rama) y anotado para la entrega 3.

**Tiempos en la base real** (en `begin … rollback`, con la rama más grande de los proyectos de Lega, 35 páginas, y 1923
objetos en `thumbs`): `current_plink` 0,98 ms; `plink_page_level` de la hoja más profunda 0,80 ms (el `user_page_level`
de la misma hoja, 0,08 ms); `plink_tree` 17,8 ms; listar `thumbs` con el link 29 ms (32 objetos) y sin header 0,46 ms
(0); una miniatura por nombre 6,1 ms; `plink_tree` con un token al azar 0,10 ms y sin header 0,07 ms; `db_bytes` 4,7 ms
la primera vez (45 MB, todas las bases) y 0,11 ms recordado.

**`noindex`:** `public/_headers` suma `X-Robots-Tag: noindex, nofollow` y `Referrer-Policy:
strict-origin-when-cross-origin` para toda la app, `public/robots.txt` con `Disallow: /`, e `index.html` la etiqueta
`robots`.

### Entrega 1: *Can view*

- **Migración `20261012120000_link_publico.sql` (aplicada, verificado en la base el 2026-10-06):** `public_links`, `public_link_usage`,
  `public_link_usage_all`, `private.db_guard` y `workspace_settings.link_limits` (vacío: valen los topes por defecto de
  `private.plink_limit`); `comments.plink_id`, `plink_author` y `plink_device_hash`; la regla única
  `private.user_can_share_page` (que `can_share` llama, ahora también "nunca un invitado": un dueño de proyecto pasado a
  invitado deja de compartir); `remove_member` revoca los links de quien se va; las funciones del visitante
  `plink_open`, `plink_tree`, `plink_pull_page`, `plink_media_files`, `plink_media_file`, `plink_list_comments`,
  `plink_add_comment`, `plink_edit_comment` y `plink_delete_comment` (solo `anon`, por `POST`; todas `VOLATILE`); las de quien comparte `create_public_link`, `set_public_link`, `reset_public_link`,
  `revoke_public_link`, `get_public_link`, `public_link_pages` y `delete_public_link_comments`; la política
  `thumbs_select_link`; `has_plain_readers` y `clean_work` cuentan los links; `list_comments` y `comments_view` suman
  `plink_id` y `plink_author` al final; `rls_auto_enable` sin `execute` para `anon`; `schema_version` 14.
- **N1 (bytes de los comentarios):** cada comentario y cada edición pasan por la guarda `db_bytes()` (todas las bases,
  como mide Supabase; 350 MB), 1 MB por link y día (`comment_bytes`) y 10 MB de por vida (`life_comment_bytes`).
- **N2 (lecturas contadas):** `plink_tree` recibe la firma de lo último que bajó y, si el árbol no cambió, no devuelve ni
  cuenta nada; si cambió, cuenta sus bytes como una bajada (`pull`). `plink_list_comments` cuenta sus bytes cuando
  devuelve algo. Las bajadas de todos los links tienen además un tope mensual (`all_month_pull_bytes`, 2 GB de los 5
  del plan). `plink_media_files` (las filas de los archivos, hasta 200 por pedido) cuenta como una bajada (ver las
  correcciones de la auditoría, abajo). Para el visitante, `update_seq` es `clean_seq` (o 1, "en preparación"): el árbol no cambia con cada tecla
  de un editor.
- **D33:** `create_public_link` y `reset_public_link` dan `clean_off` con el interruptor de D14 apagado; *Share* muestra
  *Anyone with the link* apagado con la línea que lo explica.
- **La app:** `src/linkMode.ts` (el link en la dirección, lo guardado en el dispositivo con un id de dispositivo por
  link, el cliente sin sesión con los headers), `src/sync/linkRemote.ts` (el servidor visto por `plink_*`: el visitante
  es un invitado con Comentar sobre la página del link) y `src/ui/LinkApp.tsx` (abrir, "este link ya no anda", el tope
  del día, el cartel con el dominio). En *Share*, `src/ui/LinkShare.tsx` (*General access*). El motor suma dos opciones
  (`intervalMs` y `pullOnly`, el modo liviano: solo se bajan las páginas ya bajadas o abiertas, un ciclo cada 30 s) y
  `sharpImages` no baja originales en modo link. Los comentarios del link se ven con *(via link)*; el visitante escribe
  su nombre una vez y no resuelve hilos.
- **El portero:** con `x-shotdocs-link` acepta solo `POST /pass`, `POST /verify`, `POST /folder/list` y
  `GET /drive/status` (lo demás, `403 link_denied`), pregunta `plink_media_file` con la clave publicable y el header,
  nunca reenvía un `Authorization` y da pases de 2 horas (también en `/folder/list`). CORS aceptaba solo
  `x-shotdocs-link` y `x-shotdocs-device`, y la app manda además `x-shotdocs-version`: por eso los pedidos al portero
  no pasaban en un navegador hasta la v0.218 ("El portero no aceptaba la versión de la app").
- **Pruebas:** `supabase/tests/link_publico_permisos.sql` (en `begin … rollback` contra la base real: pasa) y 48
  mutantes de la migración, 45 detectados; los 3 que no, son equivalentes: el chequeo de forma del token (la huella igual
  rechaza), la guarda del token en la política (rendimiento) y el proyecto borrado (`user_can_share_page` ya da falso).
  Las 19 pruebas SQL de antes pasan con la migración (dos ajustes: la cuenta de políticas de `thumbs` y
  `comments_view`). `src/sync/linkMode.test.ts` (el visitante con el motor de verdad: solo la rama, solo bases, modo
  liviano, comentarios con nombre, revocar, el creador que deja de compartir) y `portero/src/core.test.ts` (4 casos del
  link).
- **Decisiones propuestas** (el detalle, en el informe de la entrega): P14 simplificado (un `#link=` abre siempre el
  modo link, sin mirar si hay una sesión: nunca mezcla permisos); los links guardados viven en su propia lista
  (`shotdocs-links`) y no en el selector de workspaces; el ícono del árbol para las páginas con link y el detalle
  *Can view link, created by…* para el equipo quedan para después (la función `public_link_pages` ya está).
- **Para publicar** (hoy la migración está aplicada y `min_app_version` en 0.181; D14, `clean_min_version`, sigue apagado; verificado en la base el 2026-10-06): aplicar la migración (con la copia de seguridad), prender el interruptor de D14 y subir
  `min_app_version` a esta versión (recomendado: la publicada muestra un comentario de un link como de una cuenta
  borrada y no tiene *General access*; no se pierde nada).

### Correcciones de la auditoría (entregas 0 y 1)

Dos auditorías independientes (base y portero; app y motor) dijeron «no pasa»; se corrigió en una ronda:

- **Reset link (base, B1):** `reset_public_link` no reiniciaba la rama (`clean_reset`, como crear): quien recibía el link
  nuevo bajaba la base armada antes de que el editor borrara algo. Ahora la reinicia. Prueba en
  `link_publico_permisos.sql` (el editor sube una fila después de la base y resetea: el link nuevo no baja nada).
- **`plink_media_files` (base, B2):** calculaba la rama una vez por archivo y no contaba. Con 200 ids en una rama de 36
  páginas, medido en rollback sobre la base real: **614-658 ms antes, 8-15 ms ahora**. Calcula la rama una vez
  (`materialized`) y cuenta como una bajada (`pull`: un pedido y los bytes devueltos; se ve en los topes y en el contador
  de *Share*). Pasó a `VOLATILE`. El tiempo no se puede probar en el SQL de pruebas: se midió con
  `link-impl/corr/perf.mjs` (fuera del repo); la prueba cuida que cuente, que dé solo lo de la rama y el tope de 200.
- **Abrir sin red (app, B1):** `LinkApp` pedía `plink_open` antes de montar la página, y sin red mostraba «Could not open
  your workspace». Ahora la entrada guardada recuerda el id del link y de la página (`linkId`, `pageId`): si `plink_open`
  falla por red (o tarda más de 2 s) se muestra lo guardado, con el aviso *Couldn't reach the server…*, y el motor sigue
  intentando; el aviso se va cuando contesta. Con red, `plink_open` manda: un link revocado o vencido se corta sin mostrar
  nada. La primera vez sin red tiene su propio texto. Pruebas en `src/ui/linkApp.test.tsx`.
- **El cliente del link nunca usa una sesión (app, B2):** `src/linkSession.test.ts` guarda sesiones de cuenta en las tres
  claves posibles del navegador y comprueba que ningún pedido del cliente del link (RPC y Storage) las lleva ni las toca.
- **Recargar sigue en el link (app, O1):** el `#link=` se borra de la barra, así que recargar en un dispositivo con un
  workspace abría ese workspace. Ahora la pestaña recuerda su link (`sessionStorage`) y recargar o restaurar la pestaña
  sigue en el link; escribir la dirección o abrir otra pestaña abre la cuenta como siempre (`navigation type`).
- **Pruebas que faltaban:** las guardas de `set`, `reset` y `revoke` (sin permiso, Comentar, Editar, miembro común con 4,
  invitado), `clean_off` en *Reset*, y `plink_list_comments` solo de la rama. El nombre del visitante saca también U+061C,
  U+2028 y U+2029 (base y app, como el portero). 14 mutantes nuevos de la base y 9 de la app, todos detectados salvo uno
  equivalente.
- **Al roadmap:** el resto de las observaciones (ver `Doc_Roadmap.md`).

## Entrega 2: *Can edit* (rediseño 2026-10-02)

**Estado: la 2a está implementada (v0.151; ver "Cómo quedó la 2a", al final de esta sección), con el interruptor
apagado; la 2c también (v0.157, "Cómo quedó la 2c", migración aplicada); la 2b también (v0.164, "Cómo quedó
la 2b", migración aplicada).** El SQL de E2.11 queda como el borrador que se auditó; lo
que cambió al implementarlo está en "Cómo quedó la 2a".
Reemplaza a 3.8 (3.8.1 a 3.8.3), a la fila *Compactar* de 3.10, a lo de la entrega 2 en 3.15, 4, 5 y 6, y a la fila 2
de la sección 7: todo eso queda como historia. Se diseñó contra `main` v0.137 (copias resumidas listas y apagadas, D14
aplicada y apagada, menciones, anotaciones de fotos, plantillas, exportar, dictado V1, deshacer por orden de edición).
Lo comprobado, con sus números, está en E2.16. **Auditado el mismo día: aprobado con condiciones; los cinco bloqueantes
están corregidos en el texto (E2.18)**; la re-verificación del mismo día lo dio por **listo**, con la condición C1 ya aplicada.

### E2.0 En corto

- **El cambio principal (LE1): lo que escribe un link no entra directo a `page_updates`.** Va a una **sala de espera**
  (`public_link_updates`), con los topes por bytes de 3.8.1. El dispositivo de un editor que ya arma las bases limpias
  de D14 prueba cada fila en orden sobre las filas del servidor y se lo dice a la base (`plink_admit`): la base **copia
  los bytes de la sala a `page_updates`** (con `plink_id` y el nombre del visitante) o anota la fila como **apartada**
  con el motivo. Una sola decisión, guardada en la base, para todos los dispositivos.
- **Por qué cambia.** La cuarentena de 3.8.2 se pensó en `applyRemote` de cada editor, sobre filas sueltas de
  `pull_page_updates`. Desde entonces: los editores bajan por `pull_page_content`, que sirve **copias resumidas**
  (snapshots, v0.127 a v0.137): una fila mala adentro de un snapshot ya no se puede apartar, y el compactador tendría
  que repetir la cuarentena; lo que "no conoce" un editor depende del esquema de su versión, así que "todos los editores
  apartan lo mismo" valía solo con la misma versión; y cualquier versión anterior (también las que compactan, desde
  v0.133) aplicaría una fila sin probar. Con la sala, **ninguna versión de la app, ninguna copia resumida, ninguna base
  limpia ni el historial ven nunca una fila de un link sin probar**, y `applyRemote`, compactar y el historial no
  cambian.
- **La prueba de admisión** (E2.3), medida con las funciones reales de la app: la fila se lee; toca solo los tipos raíz
  que la app usa (el contenido, *colapsar para todos* y las anotaciones); no deja nada pendiente (structs ni borrados);
  no trae un bloque ni una marca que esa versión no conozca; las fotos que agrega son del link o las usa hoy su rama, y
  no trae imágenes externas; la base limpia que sale pasa `checkCleanBase` y pesa hasta 8 MB (N4 y N5 de la
  re-verificación); y, desde la auditoría, **la forma y los valores** (paso 8: nada que el editor no pueda dibujar).
  **Prototipo: 11 de 11 casos, 1286 filas honestas al azar y 0 apartadas; 3,6 ms por fila en una página de 77 KB y
  13,3 ms en una de 346 KB.** Además, una barrera de error alrededor de `PageEditor` para lo que nadie previó.
- **Hallazgo nuevo (fotos de afuera):** el dispositivo de un editor vincula a la página todo `sdmedia://` que encuentra
  en su documento (`MediaQueue.reconcilePage` → `link_page_file`, también de otras páginas del proyecto que el editor
  ve). Con 3.8, un visitante que conociera el id de una foto de afuera de su rama la escribía en la página, el editor la
  vinculaba y `plink_file_level` se la abría al link. La prueba lo aparta (`foreign_media`) y la base lo vuelve a
  comprobar al admitir.
- **Qué puede (D29, sin cambios):** escribir en las páginas de la rama (texto, tablas, anotaciones de fotos, colapsar
  para todos, una plantilla en una página vacía, reemplazar en la página, deshacer), comentar, y desde la 2b subir fotos
  y archivos al Drive del dueño. **No** crea, mueve, renombra ni manda páginas a la papelera, ni guarda plantillas, ni
  crea reportes del día, ni reemplaza en todo el proyecto, ni usa el asistente ni *Dictate to report*.
- ***Reset link* corta la escritura al instante:** el token viejo da `link_not_found` en el próximo pedido, y lo que
  quedó en la sala **no se admite**: al revocar o resetear pasa a apartado (`link_revoked`) en el acto; si el link solo
  dejó de andar por algo que puede volver (vencido, el permiso del creador, *Can view*, la página afuera o en la
  papelera), queda **retenido**. Las dos cosas, a la vista en *Share* y para bajar. Nunca se borra.
- **Un interruptor propio (LE6):** `workspace_settings.link_edit_min_version`. Apagado (hoy), *Can edit* no se puede
  elegir (`edit_off`), `plink_push_page_update` rechaza y `plink_open` le da *Can view* a una app más vieja que el
  interruptor. Requiere además el de D14 (sin él no hay links: hoy `clean_min_version` es nulo en Wanka).
- **El equipo ve** lo del visitante en el historial como *Ana (via link)*; en *Share*, lo que espera, lo admitido hoy,
  lo apartado y lo retenido; y en la página, un aviso cuando algo se apartó, con *Download it*.
- **Entregas:** 2a escribir (la sala, la admisión, los topes, *Share* con *Can edit*, el interruptor, el historial),
  2b archivos (portero, miniaturas), 2c lo apartado a la vista (lista, historial, "volver a la página del equipo").

**En términos simples:** con 3.8, lo que escribía alguien con el link entraba directo a la página y cada dispositivo
del equipo tenía que darse cuenta solo de si era basura. Desde entonces la app aprendió a resumir las páginas en copias,
y una basura que se metiera en una copia ya no se podía sacar. Ahora lo que escribe el visitante espera en una "sala":
la app de alguien del equipo lo revisa (que se pueda leer, que no rompa nada, que no traiga fotos de otras páginas) y
recién ahí entra a la página, con el nombre del visitante. Si no pasa, queda aparte, sin perderse. Si el dueño corta el
link, lo que estaba esperando tampoco entra.

### E2.1 Contraste con el código de hoy

| Lo que suponía 3.8 | Lo que hay en `main` v0.137 | Qué cambia |
|---|---|---|
| Los editores bajan filas con `pull_page_updates` y la cuarentena va en `applyRemote` | Bajan con `pull_page_content` (`src/sync/remote.ts`), que puede servir un snapshot que junta las filas `1..N` (`Doc_Compactar.md`, apagado con `snapshot_min_version` nulo pero listo) | Una fila mala adentro de un snapshot no se aparta. La sala (LE1) hace que nunca llegue a `page_updates` |
| "Todos los editores apartan lo mismo" | `findUnknownContent` (`src/ui/unknownContent.ts`) compara con el esquema de **cada versión** | Un editor viejo apartaría lo que uno nuevo aplica: documentos distintos. La decisión queda en la base, y solo admite una versión igual o más nueva que la del visitante |
| Una fila ilegible marca `unreadable` | `applyRemote` la marca y desde ahí `buildCleanBase` saltea la página (`skip: 'unreadable'`) y compactar la saltea 24 h por vez (`skip_page_compaction`) | Igual que B2; con la sala no llega |
| Una fila con un tipo desconocido | Además, el editor del equipo **no abre la página** (`PageEditor` → *UnsupportedPage*): un visitante dejaba la página sin poder editarse para todo el equipo | La prueba la aparta (`unknown_content`) |
| `pending` y la versión mínima para las versiones viejas | Toda versión desde v0.133 compacta las filas que baja | Con la sala, una versión vieja solo ve filas probadas |
| N3: la tabla de rechazos de 3.8.3 | `pushPage` (`src/sync/docs.ts`): un rechazo permanente deja `rejected` y el mismo `pending`; `clearRejected` (al abrir) lo rearma con **todo** lo no confirmado, que vuelve a pesar lo mismo | Un pegado de más de 1 MB traba esa página en ese dispositivo. Salida medible: deshacer el pegado (con GC, lo borrado pesa casi nada) o *Download it* (E2.9) |
| N4 y N5 | `push_clean_base` rechaza más de 8 MB; `checkCleanBase` (`src/sync/clean.ts`) existe | La prueba arma la base y la comprueba |
| Fotos: el link registra y vincula | `reconcilePage` vincula todo `sdmedia://` del documento con la sesión del editor | Hallazgo `foreign_media` (E2.0) |
| Anotaciones y colapsar | Viven en `Y.Map` raíz propios (`photoMarkup`, `collapsedHeadings`) y el dibujo ya trata el mapa como entrada no confiable (`Doc_Anotar_Fotos.md`) | La prueba los permite y rechaza cualquier otro tipo raíz (`unknown_root`) |
| El historial muestra `created_by` | `page_updates.created_by` es `auth.uid()` por defecto; `page_history` no tiene columnas del link | La fila admitida va con `created_by` nulo, `plink_id` y `plink_author`; `page_history` suma `plink_author` al final |
| El portero sube con `upload.user` | Para un link `who.userId` es `'plink'` para todos los links | Defensa de más: `plink:<huella del token>` (el id de subida ya es de 192 bits) |
| `LinkRemote` no compacta | `canCompact(LinkRemote)` da verdadero (hereda de `SupabaseRemote`); no compacta porque sus ajustes no traen `snapshotMinVersion` | Cerrarlo explícito (como pide el roadmap para `share`, `namePageVersion`…) |
| Comentarios, menciones | Entrega 1 y ME7: el visitante comenta y no menciona | Sin cambios |
| Deshacer por orden, dictado, exportar | Locales; *Dictate to report* necesita la clave de una cuenta | El visitante deshace; dicta con el teclado del sistema; *Dictate to report*, no |
| Plantillas | Las de fábrica están en el código; las propias son páginas de *Templates* | Aplicar una en una página vacía de la rama es contenido: sí. Guardar y el reporte del día crean páginas: no |
| La base real | `public_links` aplicada (schema 17), **0 links, 0 bases limpias, 0 snapshots**, `clean_min_version` y `snapshot_min_version` nulos, `min_app_version` 0.129 | Todo se prueba con el servidor en memoria y SQL en `begin … rollback` |

### E2.2 Cómo escribe el visitante

1. **El motor de siempre** (IndexedDB primero, la cola se vacía solo con la confirmación, reintentos idempotentes, "N por
   subir"), con `LinkRemote.pushUpdate` sobre `plink_push_page_update(página, client_update_id, update, versión,
   nombre)`. El nombre es el de los comentarios (P8): sin nombre no sube; la app lo pide la primera vez que escribe.
2. **La base, en este orden y en una transacción** (lo rechazado no suma):
   1. el link anda y su nivel sobre la página es 3 (`link_page_level`: la rama, sin papelera, *Can edit*);
   2. **idempotencia antes de los topes** (pedido de la re-verificación): el mismo `(link, página, client_update_id)`
      devuelve lo mismo sin contar nada;
   3. la versión (`link_edit_version_allowed`: la mínima del workspace y el interruptor), el nombre;
   4. el tamaño: hasta **1 MB** (`push_max_bytes`; `update_size_invalid`);
   5. la guarda de la base (350 MB de todas las bases, `db_bytes()`);
   6. lo que espera sin decidir de ese link: hasta **20 MB** (`waiting_bytes`, nuevo: sin un editor conectado la sala
      no crece sin fin);
   7. los bytes de por vida del link (100 MB) y los del día: cantidad, bytes por link y del total de links (`plink_count`);
   8. guarda la fila en la sala con el autor, la huella del dispositivo y la versión.
3. **Devuelve 0**, no un `seq`: la fila todavía no está en la página. `pushPage` la confirma igual (sube `syncedSV`) y
   no mueve el cursor (`seq === cursor + 1` no se cumple). El visitante sigue siendo un lector de bases (D14): cuando la
   fila entra y un editor arma la base siguiente, la baja entera y Yjs no duplica nada (lo ya integrado se saltea).
   Esto simplifica lo de 4.3 de `Doc_Privacidad_Borrado.md` ("su cursor se adelanta a su propia fila"): el cursor del
   visitante solo se mueve con bases.
4. **La subida sin GC** (D15) en modo link: umbral 1 MB (como decía 3.8.1, LE13). Arriba de eso sube con GC: lo visible
   es lo mismo; se pierde solo el texto que el visitante tecleó y borró antes de subir.
5. **Cuánto esperó cada cosa:** `plink_push_status()` le dice al visitante, por página, cuántas de las suyas (este link
   y este dispositivo) esperan y cuántas se apartaron. **Cuenta como un pase** (`pass`, que tiene tope de cantidad por
   día; observación 7 y R2 de la re-verificación: como `pull` casi no limitaba, porque `pull` solo tiene tope de bytes).
   La app lo pide solo mientras tenga algo esperando, una vez por ciclo de 30 s, y un `link_rate_limited` del estado no
   se avisa como "el link no puede escribir": solo deja de pedirlo hasta el día siguiente.

### E2.3 La admisión

**Quién (LE2):** el dispositivo que ya arma las bases limpias: alguien que ve lo borrado en la página (nivel 3, no
invitado: `sees_deleted`), con una versión igual o mayor que `clean_min_version` y que `link_edit_min_version`. Un
invitado con Editar, un lector o una versión vieja no admiten: lo de la sala espera (seguro).

**Cuándo, en dos pasos (B2 de la auditoría):** en el mismo paso del ciclo que las bases (`engine.buildCleanBases`),
**antes** de armarlas:

1. `plink_admit_pages(versión)`: **sin bytes**, las páginas con algo para decidir (como `clean_work`): agrupado por
   (página, link) entre las filas sin decidir de links vigentes (sin revocar, sin vencer, *Can edit*), filtrado **antes
   del tope** por lo que la sesión ve con lo borrado y por `link_page_level(l, página) = 3`, con cuántas filas y bytes
   esperan; hasta 50 páginas. Cuesta una consulta chica por ciclo, como `clean_work`.
2. El motor se queda con las que tiene **listas**: al día y sin nada propio sin subir (lo mismo que pide
   `buildCleanBase`), así lo guardado en el dispositivo son exactamente las filas del servidor. Si el editor está
   escribiendo en una, la saltea hasta la pausa (20 s × f, como la base) y **no baja sus bytes**.
3. `plink_admit_work(versión, páginas)`: los bytes **solo de esas páginas** (hasta 20 páginas y 4 MB por pedido), en
   orden por (página, link), de versiones iguales o más viejas que la suya.
4. Prueba página por página y manda `plink_admit(página, versión, decisiones)`. **Si la base devuelve para una fila una
   decisión distinta de la que mandó** (otro editor la decidió antes), el motor corta esa página y la vuelve a probar en
   el ciclo siguiente: lo que sigue se probó sobre un estado que no es el real (observación 2).
5. Además, el dispositivo recuerda por id las filas que ya bajó y probó sin poder mandarlas (se cortó la red), para no
   volver a bajarlas: así cada fila de la sala se baja una vez por editor que la decide.

Si admitió algo, `update_seq` subió y la base sale con la cadencia de D14 (la fila admitida lleva la hora de la
admisión: 20 s × f después, o a los 2 minutos de la base anterior).

**Por qué en dos pasos y filtrado antes del tope (B1 y B2):** con un solo pedido con bytes, las filas de una página que
el dispositivo no puede probar todavía se volvían a bajar en cada ciclo (hasta 4 MB cada 10 s por dispositivo, ≈1,4 GB
por hora contra 5 GB por mes de egress), y un tope de filas aplicado **antes** de filtrar dejaba que 2000 filas
retenidas de una página trabaran la admisión de todo el workspace (reproducido por la auditoría en `begin … rollback`:
con 2000 retenidas, 0 filas para otra página; con 1999, 1).

**La prueba**, fila por fila, sobre una copia del documento (sin GC) armada con lo guardado y con lo que ya admitió en
esta vuelta:

| # | Qué mira | Motivo si falla |
|---|---|---|
| 1 | Se decodifica (`Y.decodeUpdate`) | `undecodable` |
| 2 | Ningún struct cuelga de un tipo raíz que la app no usa (solo `document-store`, `collapsedHeadings`, `photoMarkup`) | `unknown_root` |
| 3 | Se aplica sin error y **no agrega nada pendiente**: `pendingKey` (de `compact.ts`, structs y borrados como tramos) igual antes y después | `pending` |
| 4 | Si antes la página no tenía nada desconocido, después tampoco (`findUnknownContent`) | `unknown_content` |
| 5 | Cada `sdmedia://` nuevo es de un archivo que registró el link o que **una página de la rama usa hoy** (sin `removed_at` ni `is_foreign`; LE9-B, B4); y ninguna dirección nueva **no vacía** en un atributo `url` que no sea `sdmedia://` (una imagen externa le avisaría al visitante cuándo abre la página alguien del equipo; observación 8). **Una dirección vacía vale** (C1 de la re-verificación): el editor guarda `url: ""` en un bloque de imagen insertado sin archivo todavía (*/Image*), y apartarlo apartaría en cadena todo lo que el visitante escriba colgado de él | `foreign_media`, `external_url` |
| 6 | La base limpia que sale (`buildCleanBase` con la fila) pesa hasta 8 MB | `too_big` |
| 7 | Esa base pasa `checkCleanBase` (privacidad y contenido) | `clean_<motivo>` |
| 8 | **Forma y valores** (B3): en `document-store` solo hay `XmlElement` y `XmlText` (nada de `Y.Map`, `Y.Array` ni valores sueltos, en ningún nivel); cada atributo nuevo o cambiado de un nodo está en el `propSchema` de su tipo en el esquema de esta versión, con el tipo de su valor por defecto (texto, número o sí/no; un número puede llegar como texto de dígitos y se acepta si su valor es válido) y, si el esquema tiene `values`, uno de ellos (`level` del encabezado, `textAlignment`); los atributos que no son de bloque (`id` del `blockContainer`, los de la tabla y las fotos en línea), de su tipo, con `tableCell.colwidth` como lista de números o nulo (lo que guarda el editor al achicar una columna; R3); cada marca nueva con el tipo de valor que espera (`textColor`, `backgroundColor`, `link`: texto; las demás: sí/no). Se mira solo lo que la fila agrega o cambia | `bad_shape` |

- **El paso 8 (B3), por qué y cómo.** La auditoría armó a mano 19 filas hostiles que pasaban los pasos 1 a 7; 3 hacían
  tirar al editor real del equipo, al abrir la página y con la página abierta: un `Y.Map` adentro de un párrafo
  (`text.toDelta is not a function`) y el `level` de un encabezado como objeto o como `'x y'` (*"h[object Object]" is not
  a valid element local name*). Las otras 16 las absorben `normalizeStructure` o el editor sin perder texto del equipo.
  El paso 8 es Yjs puro (no carga el editor, como `unknownContent.ts`), en `src/sync/linkShape.ts`, con la lista de
  atributos y valores sacada del esquema de esta versión y una prueba que la compara con el esquema real (como
  `unknownContent.test.ts`): si el esquema cambia, la prueba falla hasta actualizarla. Las 19 filas van como casos a
  `src/sync/admit.test.ts` (las 3 que rompían se apartan con `bad_shape`; las 16, entran o se apartan, pero nunca rompen).
- **La barrera de error alrededor de `PageEditor` (B3).** Aunque la prueba ataje lo conocido, una forma que nadie
  previó no tiene que dejar en blanco la app de nadie. La barrera general de la app (un `ErrorBoundary` de React, que hoy
  no hay en `src/`) la hace otro frente; lo que el link necesita de ella es: (a) que envuelva a `PageEditor` (la página
  sola, no la app entera: el árbol y *Share* siguen andando para poder hacer *Reset link*); (b) que al tirar muestre
  *UnsupportedPage* con el historial a mano para quien lo ve (*Restore this version*, D13), así el equipo restaura la
  versión de antes sin tener que abrir la página en el editor; (c) que no reintente montar el editor en un bucle con el
  mismo documento; y (d) que anote en la consola el id de la página y el error, para encontrar la fila. En el visitante,
  la misma barrera muestra *This page can't be shown right now* sin historial. Sirve también hoy, para cualquier
  invitado con Editar.
- **En cadena:** si una fila del link se aparta, las siguientes de ese link en esa página que dependen de ella quedan
  pendientes y también se apartan (3). Las que no dependen, entran.
- **La versión:** el visitante abre siempre la versión publicada; un editor con una pestaña vieja **no decide** una
  fila escrita por una versión más nueva (`app_version` de la fila mayor que la suya): la deja para otro, y deja también
  las siguientes de ese link y esa página (el orden). Con la mínima que sube en cada publicación (LEY 1), espera poco.
- **Lo que la base controla** (`plink_admit`, con la fila de la página bloqueada como `push_page_update`): quien llama ve
  lo borrado y tiene la versión; la fila es de esa página y no está decidida (si otro editor ya la decidió, devuelve su
  decisión: dos editores a la vez no se pisan); **en orden** (nada anterior del mismo link y la misma página sin decidir,
  si no `admit_out_of_order`); la versión de la fila; el link sigue andando y editando esa página (si no, la fila queda
  **retenida** y se corta ahí); y vuelve a comprobar cada archivo de la lista que manda el editor (`link_media_allowed`:
  registrado por el link o usado hoy por una página de la rama; si uno no vale, la aparta con `foreign_media` aunque el
  editor diga que sí). Al admitir: `update_seq + 1`, inserta en
  `page_updates` los bytes **de la sala** (el editor nunca los vuelve a subir ni los puede cambiar) con `created_by`
  nulo, `plink_id`, `plink_author` y `plink_update_id`, y en la sala anota la decisión, el `seq` y pone `update` en nulo
  (los bytes **se mueven**, no se duplican: LE5).
- **Por qué alcanza con la versión de la base en ese momento:** la prueba se hizo con la página hasta `seq` N y la fila
  entra en M ≥ N. Las filas del medio no pueden hacer pendiente lo que no lo era (solo agregan), no vuelven desconocido lo
  conocido y no cambian qué archivos son de la rama para una foto que ya estaba. La base no mira N.
- **Lo que no cubre:** una fila válida que borra todo o escribe basura legible es una edición (la permite *Can edit*): la
  restaura el historial (*Restore this version*, D13) y *Reset link* la corta.
- **El costo:** se mide en E2.16 (3,6 ms por fila en 77 KB, 13,3 ms en 346 KB, armando todo de nuevo por fila; la
  implementación arma la copia una vez por página y prueba las filas seguidas). En el teléfono, 3 a 5 veces.

### E2.4 Qué puede y qué no

| Qué | *Can edit* por link | Por qué |
|---|---|---|
| Escribir, tablas, formato, fotos en línea ya en la rama | Sí | Es el pedido |
| Anotaciones de fotos (`photoMarkup`) | Sí (como Editar, `Doc_Anotar_Fotos.md`) | El dibujo ya valida el mapa como entrada no confiable |
| Colapsar para todos (`collapsedHeadings`) | Sí | Es contenido de la página |
| Deshacer (también el orden de edición, P.26) | Sí, local | No toca la base |
| Buscar; reemplazar en la página | Sí | Es una edición |
| Reemplazar en todo el proyecto | No | Es de quien edita el proyecto (3.10) |
| Aplicar una plantilla en una página vacía de la rama (de fábrica o propia, si está en la rama) | Sí | Agrega bloques; nada nuevo en la base. Una propia de afuera de la rama no la ve; si la tuviera, sus fotos se apartarían (`foreign_media`). Una propia de la rama con una imagen por dirección externa se apartaría entera al aplicarla (`external_url`): la ayuda lo dice, o la app la aplica sin esas imágenes (re-verificación) |
| Guardar como plantilla, reporte del día, crear, mover, renombrar, papelera | No (D29) | Crean o cambian filas de `pages` |
| Comentar y responder | Sí (entrega 1) | — |
| Mencionar | No (ME7) | — |
| Subir fotos, videos y archivos | Sí, desde la 2b, con topes | P15 |
| Soltar una carpeta (P.9) | No (LE7) | Miles de archivos y subcarpetas en el Drive del dueño |
| Sacar una foto | Sí, como edición (borra el bloque); el uso lo desvincula el dispositivo de un editor al reconciliar | El visitante no llama a `unlink_page_file` |
| Historial, papelera, versiones con nombre | No (P4) | — |
| Asistente, *Dictate to report*, MCP | No | No hay cuenta ni clave |
| Dictar con el teclado del sistema | Sí | Es escribir |
| Exportar a PDF lo que ve | Como *Can view* | — |
| *Available offline* | Sí, contra los topes (3.10) | — |

### E2.5 Topes

Los de 3.8.1 siguen, contados en la sala en el momento de escribir (`plink_count`, `public_links.push_bytes_total`);
se suman `waiting_bytes` y los de archivos de la 2b. Ajustables en `workspace_settings.link_limits` (P11).

| Qué | Valor | Por qué |
|---|---|---|
| Por subida | 1 MB | Las filas que no son la primera de una página pesan p99 6,6 KB y como mucho 7,2 KB en Wanka (E2.16); la primera (una plantilla aplicada, una importación) hasta 296 KB salvo las importaciones de Coda |
| Por link y día | 2000 subidas y 20 MB | Como antes |
| Todos los links por día | 50 MB | Como antes |
| De por vida por link | 100 MB | Como antes |
| **Esperando sin decidir, por link** | **20 MB** (nuevo) | Sin ningún editor conectado, la sala de un link no pasa de esto (`link_rate_limited`, detalle `waiting_bytes`: *Your changes are waiting for the team…*). Cuenta solo lo de las páginas donde el link edita hoy (`link_page_level = 3`, calculado una vez por página distinta): lo retenido de una página que salió de la rama no frena para siempre (observación 4) |
| Guarda de la base | 350 MB (todas las bases) | Hoy pesan 49,9 MB (E2.16) |
| Página entera | 8 MB de base limpia | La prueba (6): `too_big` |
| Archivos (2b) | 100 por día, 500 de por vida, 500 MB cada uno, 1 GB por día, 5 GB de por vida | Como 3.8.1 |

### E2.6 Copias resumidas, base limpia y versiones viejas

- **Copias resumidas (snapshots):** las arma quien edita (nivel 3, no invitado) con las filas exactas del servidor. Las
  filas admitidas son filas comunes: entran como cualquiera. Lo apartado y lo que espera nunca está en `page_updates`,
  así que nunca está en un snapshot. **El visitante no compacta** ni baja snapshots (sigue con `plink_pull_page`).
- **Base limpia (D14):** el link sigue recibiendo solo bases; las arma un editor, ahora con las filas admitidas del
  visitante adentro. Sin el interruptor de D14 no hay links (P5). Crear el link o pasarlo a *Can edit* no reinicia la
  rama (los dos niveles reciben solo bases).
- **Lo que hace una versión vieja:**

  | Versión | Qué pasa |
  |---|---|
  | Visitante con una app anterior a `link_edit_min_version` | `plink_open` le da *Can view* (no ve el editor habilitado); si igual intenta, `plink_push_page_update` da `app_outdated` y la app se actualiza (v0.097) |
  | Visitante con la app de la entrega 1 (sin escribir) | Lo mismo: *Can view* hasta actualizarse |
  | Editor anterior a la 2a | No admite: lo del link espera (topes de la sala). Ve las filas admitidas como de una cuenta borrada en el historial (`created_by` nulo) |
  | Editor anterior a v0.133 (sin compactar) | Igual: filas comunes |
  | Cualquier versión que borra tipos de bloque nuevos | No le llega ninguno: la prueba (4) aparta lo que el admisor no conoce, y el admisor no es más viejo que el visitante |

- **Al publicar la 2a:** se sube `min_app_version` a esa versión y se prende `link_edit_min_version` a la misma (LEY 1:
  sin preguntar). El orden importa poco: con el interruptor apagado, nada cambia. **Pero `link_edit_min_version` no se
  prende hasta que la barrera de error alrededor de `PageEditor` esté en `main`** (R4 de la re-verificación): el paso 8
  cubre lo conocido, y la barrera es para lo que nadie previó.

### E2.7 Revocar, *Reset link* y lo retenido

- **Al instante:** cada pedido valida el token (`current_plink`). Revocar, *Reset*, vencer, apagar *Can edit* o que el
  creador pierda el permiso de compartir corta `plink_push_page_update` en el próximo pedido.
- **Revocar y *Reset* lo apartan en el acto (B1):** `revoke_public_link`, `reset_public_link` y `remove_member` (que
  revoca los links de quien se va) pasan, en la misma transacción, todo lo que espera de ese link a **apartado** con el
  motivo `link_revoked` (`decided_by` = quien revocó). Revocar es final (un link revocado no vuelve) y *Reset* crea un
  link **nuevo**: lo del viejo no pasa al nuevo. Así lo de un link revocado nunca queda en la sala sin decidir, ni traba
  nada; sigue con sus bytes para bajar, como todo lo apartado.
- **Lo que puede volver queda retenido (LE4):** vencer, que el creador pierda el permiso de compartir, la página (o una
  de arriba) en la papelera, la página movida afuera de la rama o el link pasado a *Can view*. Eso no se decide:
  `plink_admit_pages` lo filtra **antes** de su tope (no traba a nadie), `plink_admit` lo vuelve a mirar, se cuenta en
  *Share* y un editor lo baja. Si el link vuelve a editar esa página, se admite como siempre.
- **El visitante con algo sin subir:** como 3.8.3: `link_not_found` deja de reintentar a ciegas y ofrece *Download
  them* (el mismo `unsyncedDownload.ts` de cuando sacan a alguien); con el link nuevo de la misma página, al abrirlo en
  el mismo dispositivo, ofrece mandarlo con el nuevo (los ids de subida son del dispositivo: si el viejo también tenía
  esa fila retenida y alguien la admite después, Yjs no duplica nada).

### E2.8 Qué ve el equipo

- **Historial (D13):** las filas admitidas, como *Ana (via link)* (`page_history` suma `plink_author`). Restaurar una
  versión de antes deshace lo del visitante como cualquier edición.
- ***Share*, en *General access*:** *Can edit* (con el interruptor prendido; si no, apagado con su línea), la línea de
  3.8.3 (*Changes made through the link reach other people when someone from your team opens the app.*) y, debajo del
  uso de hoy: *12 changes added today · 2 waiting · 1 set aside · 3 on hold*, con lo subido al Drive en la 2b (*on
  hold*: retenido, E2.7).
- **En la página:** si algo de un link se apartó, un aviso para quien la edita: *A change sent through the link couldn't
  be added to this page* con *Download it* (la fila tal cual, como "bajar lo pendiente") y el motivo en el detalle. Lo
  pide `public_link_updates_of(página)` (apartadas, retenidas y cuántas esperan), solo a quien ve lo borrado.
- **No hay autoría por párrafo** (no existe para nadie): quién escribió qué se ve en el historial.

### E2.9 Qué ve el visitante

- El editor habilitado (como un invitado con Editar), *Your name* la primera vez que escribe, y la línea de la ayuda
  *Opened with a link* con lo de *Can edit*: lo que escribe se guarda en este navegador, llega a los demás cuando alguien
  del equipo abre la app, y el link puede dejar de andar.
- **Estados** (la insignia de sincronización): *N to send* (en el dispositivo), *Sent, waiting for the team* (en la
  sala), y nada cuando entró. Si algo se apartó: *Some of your changes on this page couldn't be added* con *Download
  them*.
- **Los rechazos:**

  | Respuesta | Qué hace la app |
  |---|---|
  | `link_not_found` | Deja de reintentar; *This link no longer works. You have N unsent changes:* ***Download them*** |
  | `page_not_found` (la página salió de la rama o el link pasó a *Can view*) | Igual, por página |
  | `link_rate_limited` (día, vida, total, guarda, `waiting_bytes`) | Espera (al día siguiente, o a que el equipo admita) sin reintentar cada 10 s, lo dice y ofrece *Download them* |
  | `update_size_invalid` | La página queda trabada en ese dispositivo (N3): *This change is too big to send through a link. Undo it to keep going, or download it.* Deshacer solo no alcanza: la página queda salteada (`rejected`) hasta reabrir la app (observación 3). En modo link, la primera edición guardada de esa página después del rechazo le saca la marca (`clearRejected` de esa página) y vuelve a intentar: con el pegado deshecho, la subida (con GC) pesa poco. El aviso tiene además *Retry*. **Y en modo link una subida armada que pasa `push_max_bytes` no se manda** (R1 de la re-verificación): queda `rejected` en el dispositivo sin pedido, así seguir escribiendo sin deshacer no repite subidas de más de 1 MB que la base rechaza |
  | `app_outdated` | Se actualiza la app y sube |

### E2.10 Abuso y plan gratis

- **La base:** todas las bases pesan **49,9 MB** hoy (34,7 MB la del workspace; `page_updates` 9,6 MB en disco, 19 MB
  de updates). Hasta la guarda quedan ~300 MB: con los 50 MB por día de todos los links al máximo, la guarda corta a los
  6 días y deja 150 MB para el equipo. Lo apartado y lo retenido nunca se borra, pero está dentro de los 100 MB de por
  vida de su link.
- **Egress:** con los dos pasos (B2), el admisor baja los bytes de una fila solo cuando la página está lista para
  probarla, y recuerda lo ya bajado: en la práctica una vez por editor que decide (en base64, un tercio más). Con los
  topes, del orden de 50 MB por día entre todos los links, de los 5 GB del mes. `plink_admit_pages` no lleva bytes.
- **CPU de la base:** `plink_push_page_update` cuesta lo de `current_plink` (0,98 ms medidos en la entrega 0) más el
  nivel (0,80 ms), la guarda recordada (0,11 ms) y dos `upsert`. `plink_admit_pages` y `plink_admit_work` usan un índice
  parcial de lo que espera y calculan el nivel una vez por (página, link), no por fila; lo mismo `public_link_json` y
  `public_link_updates_of` (observación 6).
- **La sala solo crece** (observación 5): lo apartado y lo retenido guardan sus bytes para siempre, dentro de los
  100 MB de por vida de su link. Que el dueño pueda descartar algo apartado después de bajarlo va contra "no hay borrado
  duro": queda en el roadmap como decisión de Lega.
- **El Drive del dueño (2b):** 5 GB de por vida por link, 1 GB por día, con el aviso en *Share* al pasar 1 GB.
- **Lo que un visitante malicioso puede hacer y cuánto:** escribir basura legible hasta 20 MB por día (se ve en el
  historial y se restaura); basura ilegible que queda apartada (sin efecto en la página); trabar la sala de su link
  (20 MB esperando: solo frena a su propio link). Todo se corta con *Reset link*.

### E2.11 Migración (borrador, sin aplicar)

*Hoy: las migraciones reales son `20261028120000_link_editar.sql` y `20261030120000_link_archivos.sql`, aplicadas (verificado en la base el 2026-10-06).*

Va como `supabase/migrations/<fecha>_link_editar.sql` (2a) y `<fecha>_link_archivos.sql` (2b), con
`supabase/tests/link_editar_permisos.sql`. No toca `pull_page_updates`, `pull_page_content`, `push_page_update`,
`push_clean_base` ni nada de compactar.

```sql
-- LGA Shot Docs · link público, entrega 2a: Can edit (escribir). Diseño: Docs/Doc_Link_Publico.md, "Entrega 2".
-- Lo que escribe un link entra a una sala de espera (`public_link_updates`). El dispositivo de un editor que arma las
-- bases limpias lo prueba en orden y la base lo mueve a `page_updates` (`plink_admit`) o lo anota como apartado. Nada
-- se borra: lo apartado y lo retenido quedan en la sala con sus bytes.
-- Compatible con las versiones publicadas: no cambia ninguna función que usen para bajar o subir contenido; las filas
-- admitidas son filas comunes con `created_by` nulo. `page_history` suma una columna al final.

-- 1. El interruptor y la versión
alter table public.workspace_settings
  add column link_edit_min_version numeric(8,3) check (link_edit_min_version is null or link_edit_min_version > 0);

create function private.version_num(p_version text)
returns numeric
language sql immutable set search_path = ''
as $$
  select case when p_version ~ '^[0-9]{1,4}(\.[0-9]{1,3})?$' then p_version::numeric end;
$$;

-- ¿Esta versión puede escribir por un link, o admitir? La mínima del workspace y el interruptor de Can edit.
create function private.link_edit_version_allowed(p_version text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select s.link_edit_min_version is not null
       and private.app_version_allowed(p_version)
       and coalesce(private.version_num(p_version) >= s.link_edit_min_version, false)
    from public.workspace_settings s where s.id), false);
$$;

-- `private.plink_limit`: `create or replace` con el mismo cuerpo de la entrega 1 y dos claves más en los valores por
-- defecto: "waiting_bytes": 20971520 (lo que espera sin decidir, por link) y "file_max_bytes": 524288000 (2b).

-- 2. La sala de espera
create table public.public_link_updates (
  id               uuid primary key default gen_random_uuid(),
  n                bigint generated always as identity unique,           -- el orden de llegada
  link_id          uuid not null references public.public_links (id),
  page_id          uuid not null references public.pages (id),
  client_update_id uuid not null,
  update           bytea check (update is null or octet_length(update) between 1 and 8388608),
  bytes            int not null check (bytes > 0),
  author           text not null check (char_length(author) between 1 and 60),
  device_hash      bytea check (octet_length(device_hash) = 32),
  app_version      numeric(8,3) not null,
  created_at       timestamptz not null default now(),
  decided_at       timestamptz,
  decided_by       uuid references auth.users (id) on delete set null,
  decision         text check (decision in ('admitted', 'aside')),
  reason           text check (char_length(reason) between 1 and 40),
  admitted_seq     bigint,
  constraint plu_once unique (link_id, page_id, client_update_id),
  constraint plu_decided check ((decided_at is null) = (decision is null)),
  -- Admitida: los bytes se movieron a page_updates. Si no: siguen acá, para siempre.
  constraint plu_bytes check (case when decision = 'admitted' then update is null and admitted_seq is not null
                                   else update is not null end)
);
create index plu_waiting_idx on public.public_link_updates (page_id, link_id, n) where decided_at is null;
create index plu_link_waiting_idx on public.public_link_updates (link_id) where decided_at is null;
create index plu_aside_idx on public.public_link_updates (page_id) where decision = 'aside';
alter table public.public_link_updates enable row level security;
revoke all on public.public_link_updates from public, anon, authenticated;

-- La autoría de una fila admitida (como los comentarios del link): `created_by` nulo.
alter table public.page_updates
  add column plink_id        uuid references public.public_links (id),
  add column plink_author    text check (char_length(plink_author) between 1 and 60),
  add column plink_update_id uuid unique references public.public_link_updates (id),
  add constraint page_updates_plink check ((plink_id is null) = (plink_author is null)
                                           and (plink_id is null) = (plink_update_id is null)),
  add constraint page_updates_plink_no_author check (plink_id is null or created_by is null);

-- 3. El nivel de un link dado (sin el header): lo usan el visitante (con su link) y la admisión (con el de la fila)
create function private.link_page_level(l public.public_links, p uuid)
returns int
language plpgsql stable security definer set search_path = ''
as $$
declare
  under    boolean;
  in_trash boolean;
  pdel     boolean;
begin
  if l.id is null or p is null or l.revoked_at is not null
     or (l.expires_at is not null and l.expires_at <= now())
     or l.created_by is null or not private.user_can_share_page(l.page_id, l.created_by) then
    return 0;
  end if;
  with recursive chain (id, parent_id, deleted_at, depth) as (
    select pg.id, pg.parent_id, pg.deleted_at, 0 from public.pages pg where pg.id = p
    union all
    select pg.id, pg.parent_id, pg.deleted_at, c.depth + 1
    from public.pages pg join chain c on pg.id = c.parent_id
    where c.depth < 10000
  )
  select exists (select 1 from chain c where c.id = l.page_id),
         exists (select 1 from chain c where c.deleted_at is not null),
         (select w.deleted_at is not null
          from public.pages pg join public.workspaces w on w.id = pg.workspace_id where pg.id = p)
  into under, in_trash, pdel;
  if not coalesce(under, false) or in_trash or coalesce(pdel, true) then
    return 0;
  end if;
  return case l.level when 'edit' then 3 else 2 end;
end;
$$;

-- La de la entrega 1, sobre la regla única (mismo resultado: `current_plink` ya filtra lo que no anda).
create or replace function private.plink_page_level(p uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select private.link_page_level(private.current_plink(), p);
$$;

-- La rama de un link dado (la de la entrega 1, `plink_branch`, pasa a llamarla con `current_plink()`).
create function private.link_branch(l public.public_links)
returns setof uuid
language plpgsql stable security definer set search_path = ''
as $$
begin
  if l.id is null or private.link_page_level(l, l.page_id) = 0 then
    return;
  end if;
  return query
    with recursive sub (id, depth) as (
      select l.page_id, 0
      union
      select pg.id, s.depth + 1 from public.pages pg join sub s on pg.parent_id = s.id
      where pg.deleted_at is null and s.depth < 10000
    )
    select s.id from sub s;
end;
$$;

create or replace function private.plink_branch()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select private.link_branch(private.current_plink());
$$;

-- ¿El link puede poner este archivo en una fila? Lo usa HOY una página de su rama (sin `removed_at` ni `is_foreign`;
-- LE9-B). En la 2b, también lo que registró él (`files.plink_id`). Lo de afuera de la rama nunca, ni una foto sacada:
-- el editor que reconcilia la vincularía y `plink_file_level` se la abriría al link (B4 de la auditoría: el id de una
-- foto sacada con anotaciones queda en la base limpia, en la clave borrada de `photoMarkup`).
create function private.link_media_allowed(l public.public_links, f uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.page_files pf
    where pf.file_id = f and pf.removed_at is null and not pf.is_foreign
      and pf.page_id in (select private.link_branch(l)));
$$;

-- Lo que espera sin decidir de un link, solo en las páginas donde hoy edita (lo retenido de una página que salió de la
-- rama no frena para siempre). El nivel, una vez por página distinta.
create function private.link_waiting_bytes(l public.public_links)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(w.bytes), 0)::bigint
  from (select u.page_id, sum(u.bytes) as bytes
        from public.public_link_updates u
        where u.link_id = l.id and u.decided_at is null
        group by u.page_id) w
  where private.link_page_level(l, w.page_id) = 3;
$$;

-- Revocar y Reset: lo que espera de ese link pasa a apartado con `link_revoked`, en la misma transacción (B1). Lo llaman
-- `revoke_public_link`, `reset_public_link` y `remove_member` justo después de poner `revoked_at`.
create function private.plink_aside_revoked(p_link uuid)
returns void
language sql volatile security definer set search_path = ''
as $$
  update public.public_link_updates
  set decided_at = now(), decided_by = auth.uid(), decision = 'aside', reason = 'link_revoked'
  where link_id = p_link and decided_at is null;
$$;
-- Cambios en las funciones de la entrega 1 (`create or replace` con el mismo cuerpo más esto):
--   revoke_public_link: después del update, `perform private.plink_aside_revoked(pl.id)` por cada link revocado
--                       (`update … returning id` en un `for`).
--   reset_public_link:  después de revocar el viejo, `perform private.plink_aside_revoked(old.id);`
--   remove_member:      el update de `public_links` pasa a `for … returning id loop perform
--                       private.plink_aside_revoked(id); end loop;`

revoke all on function private.version_num(text) from public, anon, authenticated;
revoke all on function private.link_edit_version_allowed(text) from public, anon, authenticated;
revoke all on function private.link_page_level(public.public_links, uuid) from public, anon, authenticated;
revoke all on function private.link_branch(public.public_links) from public, anon, authenticated;
revoke all on function private.link_media_allowed(public.public_links, uuid) from public, anon, authenticated;
revoke all on function private.link_waiting_bytes(public.public_links) from public, anon, authenticated;
revoke all on function private.plink_aside_revoked(uuid) from public, anon, authenticated;

-- 4. Lo que llama el visitante
-- Escribir: a la sala, nunca a page_updates. Devuelve 0 (no hay seq todavía). Idempotente antes de cualquier tope.
create function public.plink_push_page_update(
  p_page_id uuid, p_client_update_id uuid, p_update text, p_app_version text, p_author text)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l    public.public_links := private.current_plink();
  name text := btrim(p_author);
  bin  bytea;
  over boolean;
begin
  if l.id is null then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  if p_client_update_id is null or private.link_page_level(l, p_page_id) < 3 then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  -- Dos pedidos iguales a la vez: el segundo espera y sale por la idempotencia.
  perform pg_advisory_xact_lock(hashtextextended('plink_push:' || l.id::text || p_page_id::text, 0));
  if exists (select 1 from public.public_link_updates u
             where u.link_id = l.id and u.page_id = p_page_id and u.client_update_id = p_client_update_id) then
    return 0;
  end if;
  if not private.link_edit_version_allowed(p_app_version) then
    raise exception 'app_outdated' using errcode = 'P0001',
      hint = 'This version of the app is too old for this workspace. Reload the app to update it.';
  end if;
  if name is null or char_length(name) not between 1 and 60
     or name ~ '[[:cntrl:]\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]' then
    raise exception 'author_invalid' using errcode = '22023';
  end if;
  bin := decode(p_update, 'base64');
  if length(bin) = 0 or length(bin) > private.plink_limit('push_max_bytes') then
    raise exception 'update_size_invalid' using errcode = '22023';
  end if;
  perform private.plink_db_guard();
  if private.link_waiting_bytes(l) + length(bin) > private.plink_limit('waiting_bytes') then
    raise exception 'link_rate_limited' using errcode = 'P0001', detail = 'waiting_bytes';
  end if;
  update public.public_links set push_bytes_total = push_bytes_total + length(bin)
  where id = l.id
  returning push_bytes_total > private.plink_limit('life_push_bytes') into over;
  if over then
    raise exception 'link_rate_limited' using errcode = 'P0001', detail = 'life_push_bytes';
  end if;
  perform private.plink_count('push', 1, length(bin));
  insert into public.public_link_updates (link_id, page_id, client_update_id, update, bytes, author, device_hash,
                                          app_version)
  values (l.id, p_page_id, p_client_update_id, bin, length(bin), name, private.plink_device_hash(),
          private.version_num(p_app_version));
  return 0;
end;
$$;

-- Cómo van las de este link y este dispositivo, por página: cuántas esperan y cuántas se apartaron. Cuenta como un pase
-- (`pass`, con tope de cantidad por día; observación 7 y R2 de la re-verificación). VOLATILE: escribe la cuenta.
create function public.plink_push_status()
returns table (page_id uuid, waiting int, aside int)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l   public.public_links := private.current_plink();
  dev bytea := private.plink_device_hash();
  out_rows jsonb;
begin
  if l.id is null then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('page_id', s.page_id, 'waiting', s.waiting, 'aside', s.aside)), '[]')
  into out_rows
  from (select u.page_id, (count(*) filter (where u.decided_at is null))::int as waiting,
               (count(*) filter (where u.decision = 'aside'))::int as aside
        from public.public_link_updates u
        where u.link_id = l.id and dev is not null and u.device_hash = dev
          and (u.decided_at is null or u.decision = 'aside')
        group by u.page_id
        limit 500) s;
  perform private.plink_count('pass', 1, octet_length(out_rows::text));
  return query
    select (r ->> 'page_id')::uuid, (r ->> 'waiting')::int, (r ->> 'aside')::int
    from jsonb_array_elements(out_rows) r;
end;
$$;

-- `public.plink_open`: `create or replace` con el cuerpo de la entrega 1 y un cambio en lo que devuelve: el nivel que
-- esta versión puede usar (una app más vieja que el interruptor, o con el interruptor apagado, ve Can view):
--   'level', case when l.level = 'edit' and private.link_edit_version_allowed(p_app_version) then 'edit' else 'comment' end,
--   'link_level', l.level,

revoke all on function public.plink_push_page_update(uuid, uuid, text, text, text) from public, authenticated;
revoke all on function public.plink_push_status() from public, authenticated;
grant execute on function public.plink_push_page_update(uuid, uuid, text, text, text) to anon;
grant execute on function public.plink_push_status() to anon;

-- 5. La admisión (authenticated: quien ve lo borrado y arma bases), en dos pasos (B2 de la auditoría)
-- Paso 1, sin bytes: las páginas con algo para decidir. Agrupa por (página, link) entre las filas sin decidir de links
-- vigentes y filtra el permiso y el nivel por grupo ANTES del tope (B1: el tope de filas antes de filtrar dejaba que lo
-- retenido de una página trabara a todo el workspace). Lo retenido (link vencido, sin permiso, página afuera o en la
-- papelera, Can view) no aparece y no ocupa lugar.
create function public.plink_admit_pages(p_app_version text)
returns table (page_id uuid, waiting int, bytes bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v numeric := private.version_num(p_app_version);
begin
  if private.workspace_role() is null or private.history_denied_for_guest()
     or not private.clean_version_allowed(p_app_version) or not private.link_edit_version_allowed(p_app_version) then
    return;
  end if;
  return query
    with g as (
      select u.page_id, u.link_id, count(*)::int as waiting, sum(u.bytes)::bigint as bytes,
             min(u.app_version) as first_version
      from public.public_link_updates u
      join public.public_links l on l.id = u.link_id
      where u.decided_at is null and l.revoked_at is null and l.level = 'edit'
        and (l.expires_at is null or l.expires_at > now())
      group by u.page_id, u.link_id
    )
    select g.page_id, sum(g.waiting)::int, sum(g.bytes)::bigint
    from g join public.public_links l on l.id = g.link_id
    where g.first_version <= v and private.sees_deleted(g.page_id) and private.link_page_level(l, g.page_id) = 3
    group by g.page_id
    order by min(g.first_version), g.page_id
    limit 50;
end;
$$;

-- Paso 2, con bytes: solo de las páginas que el motor tiene listas (al día y sin nada propio sin subir). En orden por
-- (página, link); si una fila no se puede decidir (versión, link retenido), tampoco las siguientes de su (página,
-- link). Hasta 20 páginas y unos 4 MB.
create function public.plink_admit_work(p_app_version text, p_pages uuid[])
returns table (id uuid, page_id uuid, link_id uuid, n bigint, data text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v       numeric := private.version_num(p_app_version);
  r       record;
  blocked text[] := '{}';
  allowed text[] := '{}';
  total   bigint := 0;
  k       text;
begin
  if private.workspace_role() is null or private.history_denied_for_guest()
     or not private.clean_version_allowed(p_app_version) or not private.link_edit_version_allowed(p_app_version)
     or coalesce(array_length(p_pages, 1), 0) = 0 then
    return;
  end if;
  if array_length(p_pages, 1) > 20 then
    raise exception 'too_many_pages' using errcode = '22023';
  end if;
  for r in
    select u.id, u.page_id, u.link_id, u.n, u.app_version, u.bytes, u.update, l as lk
    from public.public_link_updates u
    join public.public_links l on l.id = u.link_id
    where u.decided_at is null and u.page_id = any (p_pages)
      and l.revoked_at is null and l.level = 'edit' and (l.expires_at is null or l.expires_at > now())
    order by u.page_id, u.link_id, u.n
  loop
    k := r.page_id::text || r.link_id::text;
    continue when k = any (blocked);
    -- El permiso y el link, una vez por (página, link).
    if not k = any (allowed) then
      if not private.sees_deleted(r.page_id) or private.link_page_level(r.lk, r.page_id) < 3 then
        blocked := blocked || k;
        continue;
      end if;
      allowed := allowed || k;
    end if;
    if r.app_version > v then
      blocked := blocked || k;
      continue;
    end if;
    exit when total > 0 and total + r.bytes > 4194304;
    total := total + r.bytes;
    id := r.id; page_id := r.page_id; link_id := r.link_id; n := r.n;
    data := translate(encode(r.update, 'base64'), E'\n', '');
    return next;
    exit when total >= 4194304;
  end loop;
end;
$$;

-- Decidir, en orden, las filas de una página. `p_decisions`: [{"id", "ok": true|false, "reason", "media": [ids]}].
-- Devuelve [{"id", "decision": "admitted"|"aside"|"held", "seq"?, "reason"?}]; corta en la primera retenida.
create function public.plink_admit(p_page_id uuid, p_app_version text, p_decisions jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v   numeric := private.version_num(p_app_version);
  d   jsonb;
  u   public.public_link_updates;
  l   public.public_links;
  s   bigint;
  m   text;
  ok  boolean;
  why text;
  res jsonb := '[]'::jsonb;
begin
  if p_page_id is null or not private.sees_deleted(p_page_id) or not private.clean_version_allowed(p_app_version)
     or not private.link_edit_version_allowed(p_app_version) then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  perform private.require_write_version();
  if jsonb_typeof(p_decisions) is distinct from 'array' or jsonb_array_length(p_decisions) > 200 then
    raise exception 'decisions_invalid' using errcode = '22023';
  end if;
  -- Como push_page_update: la fila de la página bloqueada, el seq correlativo.
  perform 1 from public.pages where id = p_page_id for update;
  for d in select x from jsonb_array_elements(p_decisions) x loop
    select * into u from public.public_link_updates x where x.id = (d ->> 'id')::uuid and x.page_id = p_page_id for update;
    if not found then
      raise exception 'admit_not_found' using errcode = 'P0002';
    end if;
    if u.decided_at is not null then
      -- Otro editor ya la decidió: su decisión vale.
      res := res || jsonb_build_object('id', u.id, 'decision', u.decision, 'seq', u.admitted_seq, 'reason', u.reason);
      continue;
    end if;
    if exists (select 1 from public.public_link_updates x
               where x.page_id = u.page_id and x.link_id = u.link_id and x.n < u.n and x.decided_at is null) then
      raise exception 'admit_out_of_order' using errcode = 'P0001';
    end if;
    if u.app_version > v then
      raise exception 'admit_version' using errcode = 'P0001';
    end if;
    select * into l from public.public_links x where x.id = u.link_id;
    if private.link_page_level(l, u.page_id) < 3 then
      res := res || jsonb_build_object('id', u.id, 'decision', 'held');
      exit;
    end if;
    ok := coalesce((d ->> 'ok')::boolean, false);
    why := nullif(left(btrim(coalesce(d ->> 'reason', '')), 40), '');
    if ok then
      for m in select jsonb_array_elements_text(case when jsonb_typeof(d -> 'media') = 'array' then d -> 'media'
                                                     else '[]'::jsonb end) loop
        if m !~ '^[0-9a-f-]{36}$' or not private.link_media_allowed(l, m::uuid) then
          ok := false;
          why := 'foreign_media';
          exit;
        end if;
      end loop;
    end if;
    if ok then
      update public.pages set update_seq = update_seq + 1 where id = p_page_id returning update_seq into s;
      insert into public.page_updates (page_id, seq, client_update_id, update, created_by, plink_id, plink_author,
                                       plink_update_id)
      values (p_page_id, s, u.id, u.update, null, u.link_id, u.author, u.id);
      update public.public_link_updates
      set decided_at = now(), decided_by = auth.uid(), decision = 'admitted', admitted_seq = s, update = null
      where id = u.id;
      res := res || jsonb_build_object('id', u.id, 'decision', 'admitted', 'seq', s);
    else
      update public.public_link_updates
      set decided_at = now(), decided_by = auth.uid(), decision = 'aside', reason = coalesce(why, 'unspecified')
      where id = u.id;
      res := res || jsonb_build_object('id', u.id, 'decision', 'aside', 'reason', coalesce(why, 'unspecified'));
    end if;
  end loop;
  return res;
end;
$$;

-- Lo apartado, lo retenido y cuánto espera en una página, para quien la ve con lo borrado (el aviso de la página).
create function public.public_link_updates_of(p_page_id uuid)
returns table (id uuid, link_id uuid, author text, created_at timestamptz, bytes int, state text, reason text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.sees_deleted(p_page_id) then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  -- El nivel una vez por link de la página, no por fila (observación 6).
  return query
    with lv as (
      select l.id, private.link_page_level(l, p_page_id) as level
      from public.public_links l
      where l.id in (select distinct x.link_id from public.public_link_updates x
                     where x.page_id = p_page_id and x.decided_at is null)
    )
    select u.id, u.link_id, u.author, u.created_at, u.bytes,
           case when u.decision = 'aside' then 'aside'
                when coalesce((select lv.level from lv where lv.id = u.link_id), 0) < 3 then 'held'
                else 'waiting' end,
           u.reason
    from public.public_link_updates u
    where u.page_id = p_page_id and (u.decided_at is null or u.decision = 'aside')
    order by u.n
    limit 500;
end;
$$;

-- Los bytes de una fila apartada o retenida, para "Download it" (nunca se aplican).
create function public.public_link_update_bytes(p_id uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  u public.public_link_updates;
begin
  select * into u from public.public_link_updates x where x.id = p_id;
  if not found or u.update is null or not private.sees_deleted(u.page_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return translate(encode(u.update, 'base64'), E'\n', '');
end;
$$;

revoke all on function public.plink_admit_pages(text) from public, anon;
revoke all on function public.plink_admit_work(text, uuid[]) from public, anon;
revoke all on function public.plink_admit(uuid, text, jsonb) from public, anon;
revoke all on function public.public_link_updates_of(uuid) from public, anon;
revoke all on function public.public_link_update_bytes(uuid) from public, anon;
grant execute on function public.plink_admit_pages(text) to authenticated;
grant execute on function public.plink_admit_work(text, uuid[]) to authenticated;
grant execute on function public.plink_admit(uuid, text, jsonb) to authenticated;
grant execute on function public.public_link_updates_of(uuid) to authenticated;
grant execute on function public.public_link_update_bytes(uuid) to authenticated;

-- 6. Quien comparte: Can edit con el interruptor prendido
-- Lo que piden crear y cambiar: el nivel. 'edit' solo con el interruptor (`edit_off` si no).
create function private.public_link_level_ok(p_level text)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_level is null or p_level not in ('comment', 'edit') then
    raise exception 'level_invalid' using errcode = '22023';
  end if;
  if p_level = 'edit' and (select s.link_edit_min_version from public.workspace_settings s where s.id) is null then
    raise exception 'edit_off' using errcode = 'P0001',
      hint = 'Editing through a link is not turned on for this workspace yet.';
  end if;
end;
$$;

revoke all on function private.public_link_level_ok(text) from public, anon, authenticated;

-- create_public_link y set_public_link: el mismo cuerpo que la entrega 1 con un cambio cada una (y una observación del
-- roadmap de paso):
--   create_public_link: `if p_level is null or p_level <> 'comment' then raise 'level_invalid'`
--                       pasa a `perform private.public_link_level_ok(p_level);`
--   set_public_link:    lo mismo, y además, si el link estaba vencido (`expires_at <= now()`), `clean_reset(null,
--                       p_page)` antes de devolverlo (revivirlo no sirve la base de antes; observación del roadmap).
--   Pasar de 'edit' a 'comment' o al revés no reinicia nada: los dos niveles reciben solo bases.

-- `private.public_link_json`: `create or replace` con el cuerpo de la entrega 1, con `limited` que suma
--   or (u.kind = 'push' and (u.n >= private.plink_limit('push') or u.bytes >= private.plink_limit('push_bytes')))
-- y una clave más:
--   'edits', (select jsonb_build_object(
--       'waiting', coalesce(sum(x.n) filter (where x.state = 'waiting'), 0),
--       'held', coalesce(sum(x.n) filter (where x.state = 'held'), 0),
--       'aside', (select count(*) from public.public_link_updates a where a.link_id = l.id and a.decision = 'aside'),
--       'admitted_today', (select count(*) from public.public_link_updates a
--                          where a.link_id = l.id and a.decision = 'admitted' and a.decided_at >= current_date),
--       'push_bytes_total', l.push_bytes_total)
--     from (select case when private.link_page_level(l, w.page_id) = 3 then 'waiting' else 'held' end as state, w.n
--           from (select u.page_id, count(*) as n from public.public_link_updates u
--                 where u.link_id = l.id and u.decided_at is null group by u.page_id) w) x)
--   (el nivel, una vez por página distinta, no por fila: observación 6). Lo de un link revocado ya está apartado
--   (`link_revoked`, B1), así que `get_public_link` no necesita contar lo retenido de links viejos.

-- 7. El historial: quién escribió una fila del link (al final; la versión publicada lo ignora)
drop function public.page_history(uuid, bigint, int);

create function public.page_history(p_page_id uuid, p_after_seq bigint, p_limit int default 500)
returns table (id bigint, seq bigint, created_by uuid, created_at timestamptz, update text, plink_author text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.check_history(p_page_id);
  return query
    select u.id, u.seq, u.created_by, u.created_at, translate(encode(u.update, 'base64'), E'\n', ''), u.plink_author
    from public.page_updates u
    where u.page_id = p_page_id and u.seq > p_after_seq
    order by u.seq
    limit least(greatest(p_limit, 1), 1000);
end;
$$;

revoke all on function public.page_history(uuid, bigint, int) from public, anon;
grant execute on function public.page_history(uuid, bigint, int) to authenticated;

-- 19: la 18 ya la usa `20261026120000_comentarios_archivo.sql` (v0.141, B5 de la auditoría).
update public.workspace_settings set schema_version = 19 where id and schema_version < 19;
notify pgrst, 'reload schema';
```

**2b (archivos), en su propia migración:**

```sql
-- LGA Shot Docs · link público, entrega 2b: Can edit sube fotos, videos y archivos al Drive del dueño (por el portero).
alter table public.files add column plink_id uuid references public.public_links (id),
  add constraint files_plink_no_author check (plink_id is null or created_by is null);

-- Lo que registró el link también lo puede poner en una fila.
create or replace function private.link_media_allowed(l public.public_links, f uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.files x where x.id = f and x.plink_id = l.id)
      or exists (select 1 from public.page_files pf
                 where pf.file_id = f and pf.removed_at is null and not pf.is_foreign
                   and pf.page_id in (select private.link_branch(l)));
$$;

-- Registrar un archivo nuevo en una página de la rama. Nunca uno que ya existe de otro (ni de otro proyecto): sin
-- esto, un id conocido se vincularía a la rama y el link lo vería. Idempotente con el mismo id, página y link.
create function public.plink_register_file(
  p_id uuid, p_page_id uuid, p_name text, p_mime text, p_size bigint,
  p_width int, p_height int, p_duration real, p_app_version text)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l    public.public_links := private.current_plink();
  cur  public.files;
  ws   uuid;
  over boolean;
begin
  if l.id is null then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  if p_id is null or private.link_page_level(l, p_page_id) < 3 then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  select * into cur from public.files f where f.id = p_id;
  if found then
    if cur.plink_id = l.id and exists (select 1 from public.page_files pf where pf.page_id = p_page_id and pf.file_id = p_id) then
      return 'ok';
    end if;
    raise exception 'file_other_project' using errcode = 'P0001';
  end if;
  if not private.link_edit_version_allowed(p_app_version) or not private.files_version_allowed(p_app_version) then
    raise exception 'app_outdated' using errcode = 'P0001';
  end if;
  if p_size is null or p_size <= 0 or p_size > private.plink_limit('file_max_bytes') then
    raise exception 'file_too_big' using errcode = '22023';
  end if;
  perform private.plink_db_guard();
  update public.public_links set files_total = files_total + 1, upload_bytes_total = upload_bytes_total + p_size
  where id = l.id
  returning files_total > private.plink_limit('life_files')
         or upload_bytes_total > private.plink_limit('life_upload_bytes') into over;
  if over then
    raise exception 'link_rate_limited' using errcode = 'P0001', detail = 'life_files';
  end if;
  perform private.plink_count('file', 1, 0);
  perform private.plink_count('upload', 1, p_size);
  select pg.workspace_id into ws from public.pages pg where pg.id = p_page_id;
  insert into public.files (id, project_id, name, mime, size, width, height, duration, created_by, plink_id)
  values (p_id, ws, left(p_name, 250), lower(btrim(p_mime)), p_size, p_width, p_height, p_duration, null, l.id);
  insert into public.page_files (page_id, file_id) values (p_page_id, p_id);
  return 'ok';
end;
$$;

-- El portero, al terminar la subida (con el header del link): solo un archivo de este link, una vez.
create function public.plink_set_file_drive(p_file_id uuid, p_drive_id text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l   public.public_links := private.current_plink();
  cur text;
begin
  if l.id is null then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.files f where f.id = p_file_id and f.plink_id = l.id)
     or private.plink_file_level(p_file_id) < 3 then
    raise exception 'file_not_found' using errcode = 'P0002';
  end if;
  if p_drive_id is null or p_drive_id !~ '^[A-Za-z0-9_-]{10,200}$' then
    raise exception 'drive_id_invalid' using errcode = '22023';
  end if;
  select f.drive_id into cur from public.files f where f.id = p_file_id for update;
  if cur is null then
    update public.files set drive_id = p_drive_id, uploaded_at = now() where id = p_file_id;
  elsif cur <> p_drive_id then
    raise exception 'file_already_uploaded' using errcode = 'P0001';
  end if;
end;
$$;

create function public.plink_set_file_thumb(p_file_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l public.public_links := private.current_plink();
begin
  if l.id is null then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.files f where f.id = p_file_id and f.plink_id = l.id)
     or private.plink_file_level(p_file_id) < 3 then
    raise exception 'file_not_found' using errcode = 'P0002';
  end if;
  update public.files set thumb_at = now() where id = p_file_id;
end;
$$;

-- La miniatura de un archivo que registró este link (512 KB y JPEG o WebP: los límites del bucket).
create function private.plink_thumb_insertable(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.files f, private.current_plink() l
    where l.id is not null and l.level = 'edit' and f.plink_id = l.id and f.id::text || '.jpg' = p_name
      and private.plink_file_level(f.id) >= 3);
$$;

revoke all on function private.plink_thumb_insertable(text) from public, anon, authenticated;
grant execute on function private.plink_thumb_insertable(text) to anon;
create policy thumbs_insert_link on storage.objects
  for insert to anon
  with check (bucket_id = 'thumbs' and private.plink_token() is not null and private.plink_thumb_insertable(name));

revoke all on function public.plink_register_file(uuid, uuid, text, text, bigint, int, int, real, text) from public, authenticated;
revoke all on function public.plink_set_file_drive(uuid, text) from public, authenticated;
revoke all on function public.plink_set_file_thumb(uuid) from public, authenticated;
grant execute on function public.plink_register_file(uuid, uuid, text, text, bigint, int, int, real, text) to anon;
grant execute on function public.plink_set_file_drive(uuid, text) to anon;
grant execute on function public.plink_set_file_thumb(uuid) to anon;
notify pgrst, 'reload schema';
```

### E2.12 Cambios en la app y el portero

| Dónde | Entrega | Qué |
|---|---|---|
| `src/sync/linkRemote.ts` | 2a | `pushUpdate` sobre `plink_push_page_update` (devuelve 0, manda la versión y el nombre); `pushStatus`; el nivel de `plink_open` (`level`) decide la vista; cerrar explícito lo de compactar, `share`, `namePageVersion`… (roadmap); `linkPageFile`/`unlinkPageFile` sin hacer nada (los vincula el editor) en vez de `readOnly` |
| `src/sync/admit.ts`, `src/sync/linkShape.ts` (nuevos) | 2a | La prueba de E2.3 (Yjs puro, sin el editor), sobre una copia armada una vez por página; el paso 8 con la lista de atributos y valores del esquema |
| `src/ui/PageEditor.tsx` | 2a (la barrera la hace otro frente) | Lo que el link necesita de la barrera de error (E2.3): envolver la página, *UnsupportedPage* con el historial, sin bucle, el id en la consola |
| `src/sync/engine.ts` | 2a | En `buildCleanBases`, antes de pedir el trabajo de bases: `plink_admit_pages`, quedarse con las páginas listas, `plink_admit_work(versión, páginas)`, probar con `docs`, `plink_admit` (cortar la página si la base devuelve otra decisión); recordar por id lo ya bajado; sus errores no cortan el ciclo. En modo link, sacar `rejected` de una página con la primera edición guardada después del rechazo |
| `src/sync/docs.ts` | 2a | Una lectura de lo guardado con las mismas condiciones que `buildCleanBase` (al día, nada sin subir, nada ilegible) para la prueba; `NO_GC_MAX_BYTES` de 1 MB en modo link |
| `src/sync/remote.ts` | 2a | `admitPages`, `admitWork`, `admit`, `linkUpdatesOf`, `linkUpdateBytes`; `page_history` con `plink_author` |
| Historial (`history.ts`, el Worker) | 2a | *Ana (via link)* con `plink_author` |
| `src/ui/LinkShare.tsx` | 2a | *Can edit* (apagado con `edit_off`), la línea de 3.8.3 y los números de E2.8 |
| `src/ui/LinkApp.tsx`, `SyncBadge` | 2a | *Your name* al escribir; *Sent, waiting for the team*; lo apartado con *Download them*; los rechazos de E2.9 |
| La página (editor del equipo) | 2a | El aviso de lo apartado con *Download it* (`unsyncedDownload.ts`) |
| Ayuda (`src/help/entries.ts`, `src/i18n/lazy/help.ts`) | 2a | *Opened with a link* y *Share with a link* con *Can edit* |
| `src/sync/testing.ts` | 2a y 2b | La sala, la admisión, los topes y lo retenido en el servidor en memoria |
| `src/media/queue.ts`, `src/media/portero.ts` | 2b | Registrar y subir en modo link (`plink_register_file`, `/upload` con el header), la miniatura |
| `portero/src/core.ts` | 2b | `POST /upload` y `PUT /upload/<id>` con el header (nivel 3 por `plink_media_file`); `plink_set_file_drive` en vez de `set_file_drive`; `who.userId` = `plink:<huella del token>`; carpetas (`/folder/*` de subir) siguen fuera (LE7) |
| `Doc_Supabase.md`, `Doc_Portero.md`, `Doc_Sincronizacion.md`, `Doc_Privacidad_Borrado.md` (4.3) | 2a y 2b | Al implementar |

### E2.13 Entregas

| | Qué | Tamaño estimado | Riesgo |
|---|---|---|---|
| **2a** | Escribir: la migración de E2.11 (sin la 2b), la prueba de admisión, el motor (admitir antes de armar bases), el visitante que escribe, *Share* con *Can edit*, el aviso de lo apartado, el historial, la ayuda | Migración ~650 líneas y su prueba SQL ~500; app ~1100 (admit y forma ~350, motor ~200, linkRemote ~100, docs ~80, UI ~300, i18n y ayuda ~70); pruebas vitest ~900. **~3200** (la auditoría estimó 3000 a 3300 con B1 a B3) | **Alto**: escrituras sin cuenta |
| **2b** | Archivos: `plink_register_file`, el portero, las miniaturas, la cola de fotos en modo link. **Hecha (v0.164, "Cómo quedó la 2b")** | Migración ~200 y prueba SQL ~200; portero ~120 y su prueba ~150; app ~200; pruebas ~250. **~1100** | **Alto**: el Drive del dueño |
| **2c** | Lo apartado a la vista: la lista en *Share*, *Set aside (via link)* en el historial (sin aplicarlas), "volver a la página como la ve el equipo" para el visitante (después de bajar lo suyo), el ícono del árbol. **Hecha (v0.157, "Cómo quedó la 2c")** | ~600 | Medio |

Se puede publicar la 2a sola (texto) y prender el interruptor; la 2b agrega el botón de subir en modo link.

### E2.14 Pruebas

1. **SQL** (`supabase/tests/link_editar_permisos.sql`, `begin … rollback` con un script propio; los headers con
   `set_config('request.headers', …)` y `set role anon`):
   - `plink_push_page_update`: con el link de otra página, de otro proyecto, vencido, revocado, reseteado, *Can view*,
     con la página afuera de la rama o en la papelera, sin nombre o con controles, sin el interruptor o con una versión
     vieja (`app_outdated`); el mismo `client_update_id` dos veces devuelve 0 y **no cuenta** (también con el tope ya
     lleno); 1 MB + 1 da `update_size_invalid`; día, vida, total, guarda y `waiting_bytes` dan `link_rate_limited` sin
     sumar; **nunca escribe en `page_updates`** (mutante).
   - `plink_admit_work`/`plink_admit`: un lector, un invitado con Editar, un miembro con Editar sin ver lo borrado de esa
     página, una versión más vieja que la fila o sin los interruptores: nada; fuera de orden (`admit_out_of_order`); la
     fila de otra página; dos decisiones de la misma fila (la segunda devuelve la primera); un link revocado entre la
     escritura y la admisión (`held`, no se decide); un archivo de afuera en `media` (`foreign_media` aunque `ok`); al
     admitir: `seq` correlativo, `created_by` nulo, `plink_author`, los bytes iguales a los de la sala y la sala con
     `update` nulo; lo apartado conserva sus bytes; `anon` no llama a ninguna de las dos.
   - `page_history` devuelve `plink_author`; `public_link_updates_of` y `public_link_update_bytes` solo a quien ve lo
     borrado; `plink_open` da `comment` a una versión vieja y con el interruptor apagado; `create`/`set_public_link`
     con `edit` y el interruptor apagado (`edit_off`); `set_public_link` sobre un link vencido reinicia la rama.
   - 2b: `plink_register_file` con un id existente (propio de otro link, del equipo, de otro proyecto): nunca lo
     vincula; topes de archivos; `plink_set_file_drive` de un archivo del equipo; la política de `thumbs` para un archivo
     de otro link.
   - **Las condiciones de la auditoría:** 2000 filas retenidas de un link en la página que ordena primero no traban la
     admisión de otra página (antes: 0 filas); revocar y *Reset* pasan lo que espera a `aside` con `link_revoked`, y
     `remove_member` también; `plink_admit_work` nunca devuelve bytes de una página que no se le pidió (ni de una pedida
     sin permiso); `plink_admit_pages` no lleva bytes; una foto sacada (`removed_at`) se aparta con `foreign_media`;
     `waiting_bytes` no cuenta lo retenido de una página que salió de la rama; `plink_push_status` cuenta.
   - Las pruebas de siempre de `supabase/tests/` pasan con la migración.
   - **Mutantes** (como mínimo): sin idempotencia antes de los topes, sin `waiting_bytes`, sin el orden, sin mirar el
     link al admitir, sin volver a mirar `media`, `created_by` del editor, no mover los bytes, `plink_push` que escribe en
     `page_updates`, `plink_open` sin bajar el nivel, `plink_register_file` que vincula un id existente, el tope de
     filas antes de filtrar, revocar sin apartar, `link_media_allowed` sin `removed_at`, `plink_admit_work` sin filtrar
     por `p_pages`.
2. **La prueba de admisión** (vitest, `src/sync/admit.test.ts`): los 11 casos del prototipo (E2.16) con las funciones
   reales, más una fila con el bloque `photo` en línea, una con `photoMarkup` y `collapsedHeadings` (entran), una con la
   marca `lgaStableGaps` (entra) y la corrida al azar (0 honestas apartadas); **las 19 filas hostiles de la auditoría**
   (`hostile.test.ts`, en jsdom con el editor real: ninguna que entre hace tirar al editor; las 3 que hoy lo rompen se
   apartan con `bad_shape`); una imagen externa (`external_url`); **un bloque de imagen vacío (`url: ""`, como lo inserta
   el editor) entra** (C1); **un caso honesto por cada propiedad propia de la app**: `script`, `question`, `driveCard`,
   `pageBreak`, `rowWidth`, `thumbHeight`, `isToggleable`, `checked`, `colwidth` (lista y nulo), `colspan` y `rowspan`
   (R3); la lista del paso 8 comparada con el esquema real; un mutante por cada paso de la tabla.
3. **El motor** con el servidor en memoria: el visitante escribe sin red y con red, la fila espera, un editor la admite y
   arma la base, el visitante la baja; dos editores admitiendo a la vez; un editor con una versión más vieja que la fila
   no decide; *Reset* con filas esperando (quedan apartadas con `link_revoked`, el visitante ve *This link no longer
   works* con *Download them*); vencer con filas esperando (quedan retenidas y entran si se le saca el vencimiento);
   una página que el editor no tiene lista no baja sus bytes (cuenta de pedidos con el servidor en memoria); dos
   editores con decisiones distintas (el segundo corta y vuelve a probar); `update_size_invalid` y deshacer el pegado lo
   destraba sin reabrir la app; dos visitantes en la misma página; la versión
   publicada (v0.137) como editor en la misma base no ve nada de la sala; y el invariante de D14 (lo que recibe un lector
   estuvo visible en alguna base) con un visitante que escribe.
4. **Con el editor real** (jsdom): un visitante con *Can edit* escribe, aplica una plantilla de fábrica en una página
   vacía y anota una foto; lo admitido se abre en el editor del equipo sin *UnsupportedPage*.
5. **El portero** (2b): las rutas de subir con el header, `plink:<huella>`, el link revocado a mitad de una subida, el
   tamaño declarado.
6. **De punta a punta contra la base real** (lista para Lega): con los dos interruptores prendidos, crear un link *Can
   edit*, abrirlo en incógnito, escribir, ver que aparece en la app del dueño y en el historial como *(via link)*,
   *Reset link* y ver que lo que estaba esperando queda apartado (*set aside*) y se puede bajar.

### E2.15 Propuestas

Todas con la recomendación elegida; valen hasta que Lega diga otra cosa.

| # | Propuesta | Opciones | Recomendación | Por qué | Cómo se revierte |
|---|---|---|---|---|---|
| **LE1** | Dónde entra lo que escribe un link | A) directo a `page_updates` con la cuarentena de 3.8.2 en cada dispositivo (y en el compactador, el historial y las bases); B) **sala de espera y admisión por un editor** | **B** | Con snapshots, A necesita repetir la cuarentena en cuatro lugares y que todas las versiones decidan igual; B no toca bajar, compactar ni el historial y deja una sola decisión en la base | Con B ya hecha, A sería mover la prueba al dispositivo que baja: no se propone |
| **LE2** | Quién admite | A) **quien arma bases** (ve lo borrado, versión con los dos interruptores); B) cualquiera con nivel 3; C) solo el dueño | **A** | Tiene las filas exactas del servidor y ya hace el paso de bases; un invitado no ve lo borrado | Cambiar la condición de `plink_admit_work` |
| **LE3** | La prueba | Los 8 pasos de E2.3 (el 8, forma y valores, sumado por la auditoría), con la regla de la versión, más la barrera de error alrededor de `PageEditor` | **Los 8 y la barrera** | Cubren B2, N4, N5, el editor que no abre la página, las fotos de afuera y las formas que hacían tirar al editor (B3); medidos | Sacar un paso (no se recomienda ninguno) |
| **LE4** | Lo que espera de un link que dejó de andar | A) admitirlo igual; B) retenerlo; C) apartarlo | **C al revocar o resetear (`link_revoked`, en el acto); B para lo que puede volver** (vencer, el permiso del creador, la papelera, la página afuera, *Can view*) — ajustado por la auditoría (B1) | *Reset link* es "cortar ya" y revocar es final; lo retenido no traba a nadie (se filtra antes del tope); nada se pierde | A: sacar la condición del link en `plink_admit` |
| **LE5** | Los bytes al admitir | A) **moverlos** (`update` nulo en la sala); B) dejar la copia | **A** | No duplica lo del link en la base del plan gratis; la fila queda en `page_updates`, que no se borra | Dejar de poner nulo |
| **LE6** | Cómo se prende | A) **un interruptor** (`link_edit_min_version`) además de la mínima; B) solo `min_app_version` | **A** | Es el patrón de D14 y de compactar: se publica apagado, se prende con un SQL, y una versión vieja del visitante recibe *Can view* | Ponerlo en nulo apaga *Can edit* (los links quedan en *Can view* de hecho) |
| **LE7** | Carpetas (P.9) por un link | A) **no**; B) sí, con los topes | **A** | Una carpeta son cientos de archivos y subcarpetas en el Drive del dueño; los archivos sueltos alcanzan | Abrir `/folder/prepare` y `/folder/sessions` al link con los topes |
| **LE8** | Plantillas | **Aplicar en una página vacía de la rama, sí** (de fábrica o propias de la rama); guardar y el reporte del día, no | Así | Aplicar es contenido; lo otro crea páginas (D29) | — |
| **LE9** | Qué fotos puede poner | A) las que registró el link y las que usa o usó la rama; B) **las que registró el link y las que la rama usa hoy** | **B** (corregido por la auditoría, B4) | Con A, el visitante leía en su base limpia el id de una foto sacada (la clave borrada de `photoMarkup` queda en la codificación, sin el texto), la escribía, un editor la volvía a vincular y el link la bajaba. El costo de B: deshacer el borrado de una foto que ya cruzó una admisión y una reconciliación queda apartado | A: sacar `removed_at is null` (no se recomienda) |
| **LE10** | Lo que espera sin decidir | **20 MB por link** (`waiting_bytes`) | Así | Sin editores conectados la sala no crece sin fin; frena solo a ese link | Cambiar `link_limits` |
| **LE11** | Qué ve el equipo | **Historial *(via link)*, los números en *Share* y el aviso de lo apartado en la página**; "Last edited through the link" en la página, después | Así | Lo mínimo para saber qué pasó y bajar lo apartado | — |
| **LE12** | El visitante con algo apartado | **Aviso y *Download them* (2a)**; "volver a la página como la ve el equipo" (2c) | Así | Nada se pierde y el visitante sabe qué pasó; volver a la base es borrar lo local, así que va después de bajarlo | — |
| **LE13** | La subida sin GC en modo link | A) **umbral 1 MB** (como 3.8.1); B) siempre con GC | **A** | Conserva lo que D15 conserva mientras entre en el tope | B: umbral 0 |

### E2.16 Lo comprobado y lo que no

**Comprobado (2026-10-02):**

- **El prototipo de la prueba de admisión** (vitest con las funciones reales `buildCleanBase`, `checkCleanBase`,
  `pendingKey`, `findUnknownContent` y `mediaIdsInDoc`; fuera del repo, en la carpeta de trabajo del frente): **11 de
  11** casos: honesto (entra), basura (`undecodable`), dependencia que nunca subió (`pending`), borrado de algo que no
  existe (`pending`), bloque desconocido y marca desconocida (`unknown_content`), mapa raíz nuevo (`unknown_root`),
  foto de afuera (`foreign_media`), página que se pasa del tope (`too_big`), el visitante que escribe adentro de un
  párrafo que el editor borró después de la base (entra) y una foto de la rama copiada a otra página (entra). **Al azar:
  60 semillas, 1286 filas honestas (con bases nuevas, borrados del editor y del visitante), 0 apartadas. Costo, armando
  todo de nuevo por fila: 3,6 ms en una página de 77 KB y 13,3 ms en una de 346 KB** (en la PC).
- **La base real** (solo lectura): `public_links` aplicada (`schema_version` 17), 0 links, 0 bases limpias, 0 snapshots,
  `clean_min_version` y `snapshot_min_version` nulos, `min_app_version` 0.129. Todas las bases pesan **49,9 MB** (la del
  workspace 34,7 MB; `page_updates` 9,6 MB en disco con 826 filas y 19 MB de updates). Las filas que no son la primera de
  su página (106): mediana 126 B, p95 630 B, **p99 6,6 KB, máximo 7,2 KB**: el tope de 1 MB no frena a nadie que
  escribe. Las 18 filas de más de 256 KB son todas la primera de su página (importaciones y plantillas aplicadas, varias
  de 296 KB); 3 pasan 1 MB (importaciones de Coda de 1,4 a 2,1 MB, que por un link no se hacen). Por página, mediana
  7,4 KB, p95 64 KB, máximo 2,07 MB. El bucket `thumbs` limita a 512 KB y JPEG o WebP.
- **En el código:** el rechazo que traba la página (N3, `pushPage` y `clearRejected`), el editor que no abre una página
  con algo desconocido, el vínculo automático de `sdmedia://` (`reconcilePage`), `upload.user = 'plink'` en el portero,
  `canCompact(LinkRemote)` y `page_updates.created_by` con `auth.uid()` por defecto.

**No se pudo comprobar:**

- El SQL del borrador no se compiló (no hay PostgreSQL local y no se escribe en la base real): lo compila y prueba la
  2a en `begin … rollback`, como las demás.
- La prueba con BlockNote de verdad (el prototipo usa bloques como los guarda el editor, sin montarlo) y en el teléfono.
- Que "deshacer el pegado" destrabe N3 con el editor real (con Yjs puro, un borrado con GC pesa decenas de bytes).
- El script de restaurar del repo privado de copias con las columnas nuevas de `page_updates` (son nulables; hay que
  mirarlo antes de publicar, como con compactar).
- Cuánto tarda la admisión con un editor en el teléfono y cuántas filas por día escribe un visitante real (entrega 3).
- Las correcciones de la auditoría (pasos de admisión en dos llamadas, apartar al revocar, el paso 8) no se compilaron
  ni se corrieron: van con la 2a y sus pruebas (E2.14).

### E2.17 Riesgos

| Riesgo | Qué lo cubre |
|---|---|
| Una fila de un link traba la base limpia, una copia resumida o el editor del equipo | Nunca llega a `page_updates` sin pasar la prueba (LE1, LE3 con el paso 8); la barrera de error alrededor de `PageEditor` para lo que nadie previó |
| Lo retenido traba la admisión de otros links | Se filtra antes de cualquier tope (`plink_admit_pages`); lo de un link revocado se aparta en el acto (B1) |
| La admisión se come el egress del plan gratis | Dos pasos: los bytes solo de las páginas listas, una vez (B2) |
| El visitante recupera una foto que el equipo sacó | Solo fotos que la rama usa hoy (LE9-B, B4) |
| Dos editores (o dos versiones) deciden distinto | Una sola decisión en la base; solo decide una versión igual o más nueva que la del visitante |
| Sin editores conectados lo del visitante no llega | Se dice en *Share* y en la ayuda; `waiting_bytes` acota la sala; nada se pierde |
| El link le abre al visitante fotos de afuera de su rama | La prueba (5) y `link_media_allowed` en `plink_admit`; `plink_register_file` nunca vincula un id existente |
| Un visitante llena la base | Topes de 3.8.1, `waiting_bytes` y la guarda de 350 MB, contados al escribir |
| Lo escrito por un link filtrado entra después del *Reset* | Retenido (LE4) |
| Un editor malicioso o con un error admite basura o aparta lo honesto | Ya puede escribir cualquier cosa; lo apartado queda con sus bytes y se baja; el historial restaura |
| Una versión vieja del visitante edita sin poder subir | `plink_open` le da *Can view* y la mínima la actualiza |
| La admisión cuesta en el teléfono | Una copia por página, solo filas de links (pocas y de hasta 1 MB), solo al día y sin nada sin subir |
| El SQL tiene un error | Se compila y se prueba con mutantes en la 2a (la auditoría ya compiló el borrador de la 2a y la 2b en `begin … rollback`) |

### E2.18 Correcciones de la auditoría del rediseño (2026-10-02)

Una auditoría independiente del rediseño dio **aprobado con condiciones**. Primero contrastó las premisas con `main`:
todas eran correctas. Después corrió el prototipo (11 de 11 casos; 1286 filas honestas y 0 apartadas). Compiló el SQL
de la 2a y la 2b y lo probó contra la base real en `begin … rollback`: escribir, idempotencia, admitir, `foreign_media`,
fuera de orden, retenida al resetear, `page_history`, `anon` sin admisión. Por último armó 19 filas hostiles contra el
editor real. Corregido en este documento:

| Hallazgo | Corrección |
|---|---|
| **B1.** `plink_admit_work` aplicaba el tope de 2000 filas antes de filtrar. 2000 filas retenidas de una página trababan la admisión de todo el workspace (reproducido: 0 filas para otra página; con 1999, 1) | Dos pasos: `plink_admit_pages` agrupa y filtra por (página, link) antes del tope; `plink_admit_work` se queda con las páginas pedidas y los links vigentes. Revocar, *Reset* y `remove_member` apartan lo que espera con `link_revoked` (`plink_aside_revoked`). Retener queda solo para lo que puede volver (E2.3, E2.7, LE4) |
| **B2.** Lo que el editor no podía probar todavía se volvía a bajar en cada ciclo (hasta 4 MB cada 10 s, ≈1,4 GB por hora) | `plink_admit_pages` sin bytes; los bytes solo de las páginas listas (`plink_admit_work(versión, páginas)`); se recuerda lo ya bajado (E2.3, E2.10) |
| **B3.** 3 de 19 filas hostiles pasaban los 7 pasos y hacían tirar al editor del equipo: un `Y.Map` en un párrafo y el `level` de un encabezado como objeto o `'x y'` | **Paso 8, forma y valores** (`bad_shape`), con su lista sacada del esquema y comparada con él en una prueba. Además, lo que el link necesita de la **barrera de error** alrededor de `PageEditor` (la hace otro frente). Las 19 filas pasan a ser casos de `admit.test.ts` (E2.3, E2.14) |
| **B4.** LE9-A le devolvía al link fotos que el equipo sacó: el id queda en la base limpia, en la clave borrada de `photoMarkup` | **LE9-B**: solo lo registrado por el link y lo que la rama usa hoy (`removed_at is null`), en la prueba y en `link_media_allowed` (2a y 2b) |
| **B5.** `schema_version` 18 ya la usa `20261026120000_comentarios_archivo.sql` (v0.141) | La 2a sube a **19**. La rama trae `main` (merge) |
| Obs. 2: dos admisores con decisiones distintas | Si la base devuelve otra decisión, el motor corta esa página y la vuelve a probar (E2.3) |
| Obs. 3: deshacer no destraba `update_size_invalid` | En modo link, la primera edición guardada después del rechazo saca `rejected` de esa página; *Retry* en el aviso (E2.9) |
| Obs. 4: `waiting_bytes` contaba lo retenido de páginas fuera de la rama | `link_waiting_bytes`: solo páginas con nivel 3 hoy (E2.5) |
| Obs. 6: el nivel por fila en *Share* y en el aviso | Una vez por página o por link (`public_link_json`, `public_link_updates_of`) |
| Obs. 7: `plink_push_status` sin contar | Cuenta como bajada (`pull`) y es `VOLATILE` (E2.2) |
| Obs. 8: imagen externa | La prueba (5) aparta un `url` nuevo que no sea `sdmedia://` (`external_url`) |
| Re-verificación (2026-10-02): **listo, con la condición C1** | **Diseño aprobado tras la re-verificación del 2026-10-02, con la condición C1 aplicada**: una dirección vacía vale en el paso 5 y la 2a prueba que un bloque de imagen vacío entra. R1 a R4 van a la lista de la 2a (E2.6, E2.9, E2.14) y al roadmap: no mandar una subida que pase `push_max_bytes`, el estado cuenta como `pass`, `tableCell.colwidth` como lista o nulo con un caso honesto por cada propiedad propia, y no prender `link_edit_min_version` sin la barrera de error en `main` |
| Obs. 1, 5, 9, 10 y 11 | Al roadmap (P.19): adelantar "volver a la página del equipo"; que el dueño pueda descartar lo apartado (decisión de Lega, va contra "no hay borrado duro"); `plink_set_file_drive` abierta a `anon` es inofensiva por `checkMark`; probar el script de restaurar; invitar al cliente con Editar ya cubre "el cliente escribe" sin superficie anónima. Y, para D14, que la base limpia lleva los ids de archivos de las anotaciones borradas (sin el contenido) |

### Cómo quedó la 2a (v0.151)

**Estado:** implementada en la rama, con la migración `20261028120000_link_editar.sql` (**aplicada**, verificado en la base el 2026-10-06) y el interruptor
**apagado al implementarla** (hoy `link_edit_min_version` está en 0.151; `link_edit_min_version` nulo: *Can edit* se ve apagado en *Share*, `plink_push_page_update` da
`app_outdated`, `plink_open` da *Can view* y nadie admite). Sube `schema_version` a **19**.

**La base** (`supabase/migrations/20261028120000_link_editar.sql`): todo E2.11 sin la 2b (la sala
`public_link_updates`, `page_updates.plink_id`, `plink_author` y `plink_update_id`, `link_page_level`, `link_branch`,
`link_media_allowed`, `link_waiting_bytes`, `plink_aside_revoked`, `plink_push_page_update`, `plink_push_status`, la
admisión en dos pasos, `public_link_updates_of`, `public_link_update_bytes`, `public_link_level_ok`, `page_history` con
`plink_author`) y los cuerpos completos de lo que la entrega 1 cambia (`plink_limit`, `plink_open`, `remove_member`,
`create_public_link`, `set_public_link` con el reinicio al revivir un link vencido, `reset_public_link`,
`revoke_public_link`, `public_link_json` con `edits` y el tope de subidas en `limited`, `get_public_link`).
**Lo que cambió respecto de E2.11:**

| Qué | Por qué |
|---|---|
| Las funciones de la admisión se llaman `link_admit_pages`, `link_admit_work` y `link_admit` (no `plink_admit*`) | En la entrega 1, `plink_*` son solo las del visitante (`anon`, todas `VOLATILE`), y su prueba lo exige; las de la admisión son de una cuenta y dos son `STABLE` |
| `link_admit` **corta** también en la primera fila cuya decisión no es la que pidió el editor: un archivo que no vale (`foreign_media` aunque el editor dijo que sí) o una fila que otro editor ya decidió distinto | Lo que sigue se probó con esa fila adentro (Yjs: lo de un mismo autor depende de lo anterior): admitirlo metería filas pendientes en la página. El motor también corta (E2.3, paso 4); la base no depende de que el motor lo haga |
| `get_public_link` suma `edit_on` | *Share* sabe si ofrecer *Can edit* sin probar y esperar `edit_off` |
| `plink_push_page_update` con `p_update` nulo da `update_size_invalid` | En el borrador llegaba a la restricción de la tabla (un 23514 en vez del error que la app entiende) |
| Un índice `plu_link_idx (link_id, decision)` | Los números de *Share* (apartado, admitido hoy) por link sin recorrer la sala |
| La prueba de la entrega 1 (`link_publico_permisos.sql`) cambia en dos lugares | `edit` con el interruptor apagado da `edit_off` (antes `level_invalid`), y la lista exacta de lo que ejecuta `anon` suma las dos funciones del visitante |

**La app:**

- `src/sync/admit.ts` (la prueba, una copia por página armada una vez y las filas seguidas; si una no entra, se rearma
  sin ella) y `src/sync/linkShape.ts` (el paso 8: la lista de nodos, atributos, valores y marcas, comparada con el
  esquema real en `linkShape.test.ts`).
- `src/sync/linkAdmit.ts` y `linkAdmitApi.ts`: la vuelta de la admisión (páginas sin bytes, las listas, los bytes solo
  de esas, probar, decidir, cortar si la base decide distinto, y recordar lo probado que no se pudo mandar). El motor
  (`engine.ts`) la corre en `buildCleanBases` antes de pedir `clean_work`, con los dos interruptores y la versión; sus
  errores no cortan las bases (sin red, sí). `docs.ts` suma `savedRows` (lo guardado con las condiciones de la base
  limpia) y `clearRejectedPage`.
- `src/sync/linkRemote.ts`: el visitante escribe con `plink_push_page_update` (devuelve 0), sin nombre no sube (queda en
  el dispositivo y el ciclo sigue), una subida de más de 1 MB no se manda (R1), el estado de lo mandado
  (`plink_push_status`, una vez por ciclo mientras algo espera; con su tope del día lleno deja de preguntar hasta
  mañana sin avisar nada, R2), y cierra explícito compactar, la admisión, el historial, las versiones con nombre y el
  equipo. `linkPageFile` y `unlinkPageFile` no hacen nada (los vincula el editor al reconciliar); subir archivos dice
  *Adding photos, videos and files through a link isn't available yet* (2b). La subida sin GC llega hasta 1 MB (LE13).
- **El visitante** (`LinkApp.tsx`, `LinkEditBar.tsx`, `SyncBadge.tsx`): la barra de abajo pide el nombre la primera vez
  que algo no sube por faltarle, y avisa *Some of your changes on a page couldn't be added* con *Download them*; la
  insignia dice *Sent, waiting for the team* mientras algo espera; un pegado de más de 1 MB lo explica en el detalle
  (*Undo it to keep going*), y la primera edición guardada de esa página la vuelve a intentar; con el link muerto, la
  pantalla dice cuántas páginas tienen algo sin mandar y lo baja (lo sin mandar y lo mandado que no entró, enteras).
- **El equipo:** *Share* con *Can edit* (apagado con *Editing through a link isn't turned on for this workspace yet*),
  la línea de 3.8.3 y *N changes added today · N waiting · N set aside · N on hold*; cambiar el vencimiento conserva el
  nivel. En la página (`LinkAsideNotice.tsx`, para quien ve lo borrado): *A change sent through the link couldn't be
  added to this page*, el motivo y *Download it* (lo apartado y lo retenido, tal cual, en un JSON), y una línea con lo
  retenido. En el historial, *Ana (via link)* (`createdBy` = `via-link:Ana`, que ninguna cuenta puede tener).
- **Solo el contenido** (E2.4): el acceso del visitante lleva `contentOnly` y los permisos de la app suman
  `canEditRow` (el título, la cabecera, la hoja, los títulos cortos, la carpeta de reportes: no se ofrecen) y `viaLink`
  (sin el asistente, sin *Dictate to report* ni su botón, sin reemplazar en todo el proyecto). Lo encontró el recorrido
  en el navegador: con Editar, el visitante veía editable el título y *Header for pages inside*, que su base rechaza.
- La ayuda: *Can edit with a link* y *Editing with a link*.

**Diferencias con el diseño (decididas al implementar):**

1. **"En cadena": lo que sigue del mismo autor de Yjs no entra nunca, dependa o no.** Yjs aplica lo de un autor en el
   orden de sus relojes: si una fila del visitante se aparta, todas las siguientes de esa sesión (el mismo `clientID`)
   quedan pendientes y se apartan con `pending`, aunque no toquen lo apartado. Solo lo de otra sesión (después de
   recargar) que no cuelgue de lo apartado entra. Es la observación 1 de la auditoría con su peso real: "volver a la
   página como la ve el equipo" (2c) es la salida; lo apartado se baja siempre.
2. **Paso 5:** una dirección que la página ya tenía (copiar una imagen de la misma página) vale aunque no sea
   `sdmedia://`; lo apartado es solo lo nuevo. Y `foreign_media` lo decide la base: la prueba manda la lista de
   archivos nuevos y, sin saber qué usa la rama, no aparta; si la base aparta, corta y la vuelta siguiente sigue.
3. **Paso 8:** `colwidth` acepta, además de una lista de números o nulo (R3), listas con huecos (`[150, null]`): es lo
   que guarda el editor en una celda que ocupa dos columnas (lo encontró la prueba con el editor real).
4. **La pausa** de una página que el editor está escribiendo es de 20 s fijos (sin el `× f` de la base): la admisión
   no sabe el peso de la base.
5. **Lo apartado se baja** como JSON con los bytes de Yjs en base64 (el equipo, de la sala; el visitante, su copia
   entera de cada página): no se aplica en ningún lado.
6. **El estado del visitante** (*Sent, waiting for the team*) se pregunta como mucho cada 30 s: después de que un editor
   admite, la insignia lo deja de decir en el ciclo siguiente del visitante.

**Pruebas:** la migración y su prueba (`supabase/tests/link_editar_permisos.sql`) en `begin … rollback` contra la base
real: pasa, con 30 mutantes de la migración, todos detectados; las 27 pruebas SQL de siempre (con el plan B del MCP aplicado) pasan con la migración
(con los dos ajustes de la tabla de arriba). En vitest: `admit.test.ts` (los 11 casos del prototipo, las 19 filas
hostiles contra el editor real, las 3 que tiraban apartadas por la forma, la imagen externa, la vacía de C1, las
anotaciones, colapsar, la foto en línea, la cadena, 60 semillas al azar con más de 1000 filas honestas y 0
apartadas, el costo), `linkShape.test.ts` (la lista contra el esquema real y cada propiedad propia de la app escrita por
el editor real), `linkEdit.test.ts` (el motor de E2.14.3 con el servidor en memoria), `linkEditEditor.test.ts` (el
visitante con el editor real: escribir, una plantilla de fábrica en una página vacía y una anotación; el equipo lo abre
sin *UnsupportedPage*) y `linkEdit.published.test.ts` (lo admitido abierto con la librería de las versiones
publicadas), `admitClean.test.ts` (el paso 7, forzado) y `linkEditUi.test.tsx` (*Share* con *Can edit*, el aviso de
lo apartado y *Ana (via link)* en el historial). Mutantes de la app: 29, uno por cada paso de E2.3 y por cada corrección de la auditoría, y los del motor y el
visitante, todos detectados (`mutants_app.mjs` en la carpeta de trabajo, fuera del repo). **En el navegador**
(Chromium sin ventana, la app real del visitante sobre el servidor en memoria con el interruptor prendido solo ahí, sin
login): el visitante escribe, la barra le pide el nombre, la sala recibe la fila con su nombre, la insignia dice *Sent,
waiting for the team*, un editor la admite, el equipo ve *Ana (via link)* en el historial, el visitante sigue viendo su
texto una sola vez, una fila hostil (un `Y.Map` en un párrafo) queda apartada con `bad_shape` sin tocar la página, y el
equipo ve el aviso con *Download it*; en el teléfono, sin scroll horizontal; sin errores en la consola.

**Para prenderlo** (hoy la migración está aplicada y `link_edit_min_version` en 0.151; verificado en la base el 2026-10-06; con la barrera de error de `PageEditor` ya en `main`, R4): aplicar la migración (con la copia de
seguridad), publicar, subir `min_app_version` a esta versión y
`update public.workspace_settings set link_edit_min_version = <esta versión> where id;` (el de D14 ya tiene que estar
prendido). Apagar es volver a ponerlo en nulo: los links quedan en *Can view* de hecho y lo que espera, esperando.

#### Correcciones de la auditoría de la 2a

Una auditoría independiente sobre `c50ed1d` dio **no aprobado**: la base, bien cerrada; el paso 8, no. Se corrigió en una
ronda (y la rama trae `main` v0.148, con la barrera de error de `PageEditor` y el plan B del MCP; la migración pasa a
`20261028120000_link_editar.sql`):

| Hallazgo | Corrección |
|---|---|
| **B1.** El editor real escribe `lgaGapText: true` en los textos de un renglón con fotos en línea (Enter, copiar o duplicar el renglón o una foto, Tab, pasarlo a encabezado); el paso 8 lo apartaba (`attribute outside a node`) y, en cadena, todo lo que seguía: 21 % de lo honesto al azar con una foto en la página | `TEXT_ATTRS`: un texto acepta solo `lgaGapText: true`. Prueba con el editor real (9 acciones en un párrafo y en una celda, y lo que sigue escribiendo) y la corrida al azar con fotos en línea, una tabla con fotos y listas (60 semillas, más de 600 filas honestas, 0 apartadas) |
| **B2.** Un nodo conocido donde el esquema no lo acepta (un párrafo adentro de otro, un bloque adentro de un encabezado, una imagen adentro de un párrafo) pasaba, y el editor del equipo borraba el bloque del equipo al abrir la página | `CHILDREN`: qué hijos acepta cada nodo, comparado en una prueba con el `contentMatch` del esquema real (recorriendo el autómata), y el orden de un bloque (`blockContent blockGroup?`). Los 8 casos del auditor, apartados |
| **B3.** `colspan: 100000000` (175 bytes) dejaba sin memoria al editor del equipo | Topes: `colspan`/`rowspan` enteros de 1 a 50, `colwidth` hasta 50 anchos de hasta 20 000 px, los px hasta 20 000, `rowWidth` y el ancho de una foto de 0 a 1, `start` de 0 a un millón |
| **B4.** Mil, tres mil u ocho mil niveles de sangría pasaban (8000: ~11 s en el hilo del editor que admite) y desbordaban la pila del editor y de `normalizeStructure` | La profundidad de la página entera, contada con una pila propia (sin recursión) justo después de aplicar la fila y antes de lo caro: hasta 100 grupos anidados y 400 nodos (`too_deep`). Ocho mil niveles se apartan en milisegundos |
| **O6.** Mutantes vivos | Pruebas nuevas: `link_admit` con la app vieja en el header (`app_outdated`), un uso de afuera (`is_foreign`) no da permiso, el creador que pierde el permiso deja lo suyo retenido; `savedRows` con algo propio sin subir; el motor ya no corta en el cliente (lo hace la base: era un mutante equivalente) y `ready` mira también lo no subido |
| **O8.** *Download it* del equipo traía solo Yjs | Suma `text`: lo tecleado en la fila (`insertedText`) |
| **O12.** La cadena | El aviso del visitante dice que lo que escriba después en esa página tampoco va a llegar, y ofrece la copia |
| **O7.** Con fotos en línea, la insignia del visitante decía *1 change not uploaded* para siempre | Era el registro de usos de archivos del editor del visitante (`ensureLinks`), que sin portero no sale nunca. Un link no registra usos (`MediaQueue` con `noUsage`, y el motor no reconcilia): los registra el editor que admite. Visto en el navegador: *Sent, waiting for the team* |
| **O1.** Fusión con el MCP | La lista de lo que ejecuta `anon` en `link_publico_permisos.sql` suma `private.mcp_pre_request` y las dos `plink_push_*`; las 28 pruebas SQL pasan en rollback sobre la base con el plan B aplicado |

**Quedan, al roadmap:** O3 (una versión inventada, `'9999'`, deja una fila que nadie decide y traba lo que manda
después ese link en esa página: solo lo frena a él y *Reset link* lo corta; arreglarlo pide un techo de versión que
la base no sabe hoy), O9 (después de recargar, la pantalla de link muerto no sabe de lo mandado y apartado:
lo tiene el equipo en la sala) y O4 (con D14 apagado igual se escribe en la sala; hoy no hay links sin D14).
**O5:** la app publicada (v0.146) cambia el vencimiento de un link con `'comment'` fijo y pasaría un *Can edit* a *Can
view*: por eso, **al publicar, subir `min_app_version` a la versión de la 2a** antes de prender el interruptor.
**O10:** quien publica completa `v0.151` en el changelog y `LINK_EDIT = '0.151'` en `src/help/entries.ts` a la vez.

**Falta:** nada de la entrega 2: la 2b y la 2c están hechas (abajo). Al roadmap, lo de la re-verificación que sigue
abierto (E2.18).

### Cómo quedó la 2b (v0.164)

**Estado:** publicada en v0.164, con la migración `20261030120000_link_archivos.sql` **aplicada** (sube
`schema_version` a **21**) y el portero con las rutas de subir para un link. La app ofrece subir por un link solo con la
base en la 21; con la 20, el aviso de siempre (*Adding photos, videos and files through a link isn't available yet*).

**La base** (detalle en `Doc_Supabase.md`, "Link público, entrega 2b"): `files.plink_id` (sin cuenta), el borrador de
E2.11 (`plink_register_file`, `plink_set_file_drive`, `plink_set_file_thumb`, la política `thumbs_insert_link`,
`link_media_allowed` con lo registrado) y, además: carpetas no (`folder_not_allowed`), el detalle de cada tope de por
vida (`life_files` o `life_upload_bytes`), un candado por id para dos registros iguales a la vez, `plink_media_file` con
`mine` y `project_mark`, y `public_link_json` con `files` y los topes de archivos del día en `limited`.

**El portero** (`Doc_Portero.md`, "Con un link público"): `POST /upload` (con `file`) y `PUT /upload/<id>` con el header,
solo de un archivo del link (`mine`) con nivel 3; `plink:<SHA-256 del token>`; cada parte vuelve a preguntar; al terminar
`plink_set_file_drive`; las carpetas (`/folder/*` y las subidas `f.…`), nunca.

**La app:** `LinkRemote` registra con `plink_register_file`, sube la miniatura (`thumbs`, con el header) y la marca con
`plink_set_file_thumb`; la cola de siempre sube el original por el portero con los headers del link (`services.ts`).
Un tope de archivos no apaga el link entero (solo `link_not_found` va a la pantalla): queda en el aviso del archivo
(*This link reached its limit for adding files…*, *Files added through a link can be up to 500 MB.*), con *Retry*. Un
archivo de más de 500 MB no se guarda; una carpeta soltada avisa *Folders can't be added through a link*. En *Share*,
*Files added through the link: 2 today · 3 in all (1.3 GB in your Drive)* y, desde 1 GB, *This link has uploaded 1.3 GB
to your Drive. Reset link if it went too far.* La ayuda suma *Photos and files through a link* y corrige *Can edit with a
link*.

**Revocar, *Reset link* y lo apartado (E2.7, LE9-B):** el link viejo no registra, no sube (la parte siguiente da
`link_not_found`) ni confirma (`plink_set_file_drive`); lo que subió queda en Drive sin confirmar o confirmado, y su fila y
su uso quedan (nada se borra). El link nuevo no tiene como suyo lo del viejo (`plink_id` es del viejo): no lo sube ni lo
confirma, y su visitante solo lo puede poner en una fila si una página de la rama lo usa hoy.

**Decisiones de esta entrega** (con la recomendación; valen hasta que Lega diga otra cosa):

1. **Lo escrito con un archivo que todavía no está registrado.** *Qué pasaba:* el diseño no dice qué pasa si la fila
   con el bloque de una foto llega a la sala antes de que el archivo se registre (la cola de archivos va después del
   texto en cada ciclo, y un HEIC o un video tardan en estar listos): la admisión la apartaría (`foreign_media`) y, en
   cadena, todo lo que siga de esa sesión en la página. *Opciones:* A) que la base retenga sin decidir una fila con un
   archivo que todavía no existe; B) que el dispositivo del visitante no mande lo escrito de una página mientras su
   documento muestre un archivo agregado ahí que la base no registró (`PageDocs.holdUpload`,
   `MediaQueue.unregistered`); C) nada. *Elegí B:* no toca la admisión ni la base, y con A un id inventado dejaría
   filas sin decidir que se vuelven a bajar en cada ciclo. Si el archivo no se puede registrar (un tope), la página espera
   con el aviso; sacar el bloque la destraba. *Si preferís otra:* A.
2. **Un link sube solo lo que registró él.** *Qué pasaba:* el diseño abre `/upload` al link con nivel 3, y con *Can edit*
   el link tiene nivel 3 sobre las fotos del equipo de su rama: para una foto del equipo que todavía no terminó de subir,
   el visitante podía mandar otros bytes, que el portero recuerda y le da a la base cuando la persona del equipo la sube.
   *Opciones:* A) como el diseño; B) solo `mine`. *Elegí B* (`plink_media_file` dice `mine`; `403 not_mine`).
3. **La carpeta en el Drive del dueño.** *Qué pasaba:* `plink_media_file` da el id del link como proyecto y un nombre
   vacío (P10): el portero habría creado una carpeta `Project` por cada link (y, con el id real y el nombre vacío,
   renombrado la del proyecto). *Opciones:* A) darle al link el id del proyecto; B) una huella del proyecto que el portero
   aprende de las subidas del equipo, con `Via_link` de respaldo; C) siempre `Via_link`. *Elegí B:* P10 se cumple y casi
   siempre va a la carpeta del día del proyecto. *Si preferís otra:* C es más simple y deja todo lo de los links junto.
4. **Revocar corta en la parte siguiente.** *Qué pasaba:* 3.9 valida el link al abrir la subida y al terminar; una subida
   de 500 MB abierta seguía mandando partes después de *Reset link*. *Elegí* volver a preguntar en cada parte (un pase
   cada 8 MiB: ~63 por un archivo de 500 MB, contra 3000 por día). *Si preferís otra:* solo al abrir y al terminar.
5. **El tope de 500 MB en la app es fijo.** La app no guarda un archivo de más de 500 MB por un link; si el dueño cambia
   `file_max_bytes` en `link_limits`, la base manda (un archivo entre los dos topes queda detenido con su aviso). *Si
   preferís otra:* que `plink_open` diga el tope.

**Lo que queda (al roadmap):** lo registrado por un link cuya fila quedó apartada (o que se reseteó antes de admitirla)
sigue usado por su página en `page_files` sin que ningún documento lo muestre: no pasa a la papelera de archivos y, si
llegó a subir, ocupa el Drive del dueño. **Lega decidió** (2026-10-03) que así quede, a la vista en *Share* (ver
"Correcciones de la auditoría de la 2b"). Tampoco se probó con el portero real ni con Drive (ver la lista de Lega).

**Pruebas:** la migración y `supabase/tests/link_archivos_permisos.sql` en `begin … rollback` contra la base real
(pasa; 25 mutantes de la migración, 24 detectados y 1 equivalente) y las 29 pruebas SQL de siempre con la migración
(pasan; `link_publico_permisos.sql` y `archivos_permisos.sql` con las funciones y la política nuevas). El portero:
`portero/src/core.test.ts` (6 casos nuevos: subir lo suyo con `plink:<huella>` y a `Via_link`, la carpeta del proyecto
por la huella sin renombrar nada, Can view, una foto del equipo (`not_mine`), afuera de la rama y el tamaño, revocado a
mitad, el token de *Reset*, revocado justo antes del final (en Drive sin confirmar) y la papelera con un link) y
`scripts/portero-smoke.mjs` (24 de 24). En vitest: `src/sync/linkFiles.test.ts` (el visitante con el motor de verdad, el
servidor y el portero en memoria: subir, admitir y verlo el equipo; registrar despierta al motor; lo escrito que espera
al archivo; sacar el bloque; los topes y las carpetas; cada guarda) y `src/ui/linkEditUi.test.tsx` (lo de *Share*).
Mutantes de la app y el portero: 26, 23 detectados, 2 equivalentes (esperar solo en la página del archivo: el documento
ya lo filtra; el servidor en memoria sin lo registrado: lo cubre la prueba SQL) y 1 que llevó a sacar una comprobación
repetida. **En el navegador** (Chromium sin ventana, la app real del visitante y *Share* real del equipo sobre el
servidor y el portero en memoria, sin login): el visitante suelta una foto, escribe su nombre, la foto se registra con el
link, sube su miniatura y el original por el portero, lo escrito llega a la sala recién después, el equipo lo admite y ve
el archivo; *Share* cuenta lo subido y avisa desde 1 GB; con el tope del día lleno la segunda foto no se registra, lo
escrito espera y el detalle lo dice; en el teléfono, sin scroll horizontal; sin errores en la consola (14 de 14).

#### Correcciones de la auditoría de la 2b

Una auditoría independiente sobre `f5051be` dio **no aprobado** por un bloqueante; lo demás (permisos, topes, archivos
ajenos, carpetas, revocar) quedó bien. Se corrigió en una ronda (y la rama trae `main` v0.162):

| Hallazgo | Corrección |
|---|---|
| **B1.** Si el link muere (revocado, *Reset link*, vencido) con un archivo a medio subir, el original quedaba encerrado en el navegador del visitante: la pantalla del link muerto bajaba solo el texto, y con el link nuevo no sube nunca (es del viejo) | La pantalla del link muerto lista los originales que quedaron en este navegador sin llegar a Drive (`linkUnsentMedia`, de la base de archivos del link, sin la sincronización ni el portero) y los baja de a uno, el mismo archivo (*N photos or files you added didn't finish uploading*). Con el link vivo, el detalle de la insignia ofrece *Download it* en cada archivo detenido (la página salió de la rama, un tope). Prueba: `src/ui/linkDeadFiles.test.tsx` (el caso del auditor, un video cortado por *Reset link*, achicado a 3 MB) |
| **O1.** Un bloque recién soltado y copiado a otra página antes de registrar su archivo no esperaba ahí: se apartaba | Lo escrito espera mientras el documento muestre **cualquier** archivo propio sin registrar (`MediaQueue.unregistered`, sin filtrar por página); al registrarse entra en las dos y el editor que admite registra el uso en la otra |
| **O2, O4 y la decisión de Lega** (2026-10-03). Lo registrado por un link y que ninguna fila muestra era invisible para el equipo | **Los archivos de lo apartado no se borran ni van solos a la papelera:** siguen en el Drive del dueño y *Share* los lista (*N files were added through this page's link*), con nombre, peso, fecha, *earlier link*, *didn't finish uploading* o *in the trash*, y *Download* para lo que llegó al Drive. La lista sale de `public_link_files(página)` (de `files.plink_id` de todos los links de la página, también los reseteados, lo subido sin usar y lo registrado a mano), no de las filas apartadas; la ve quien ve lo borrado de la página. Cuando exista D184 (descartar lo apartado), descartar manda sus archivos a la papelera (roadmap). Que lectores e invitados no listen esos usos: roadmap (O4) |
| **O3.** *Share* decía "in your Drive" con lo registrado | `public_link_json.files.drive_bytes` (lo que llegó a Drive); el aviso de 1 GB también |
| **O5.** Mutantes vivos | Pruebas nuevas: justo hasta el tope de por vida entra; otro link cuya rama contiene la de S ve el archivo con `mine` falso; nombres de miniatura que empiezan con el id; el portero con una base sin `mine` da `not_mine`; lo escrito sale apenas el archivo se registra aunque el original no haya subido |
| **O6.** Docs | `Doc_Sincronizacion.md` (el visitante y sus archivos) y `Doc_Privacidad_Borrado.md` 4.4 (los usos de un link) |
| **O8.** Menores | El comentario suelto del servidor en memoria; la ayuda dice "de fábrica" para los topes; lo demás al roadmap |
| **O9.** Una corrida completa de la suite podía salir con código 1 por un rechazo suelto de `refreshCounts` con la base cerrada (también en `main`) | `poke` ignora ese rechazo (la cuenta es solo lo que se muestra) |
| **O7.** Sin tope de todos los links juntos para archivos | Roadmap (`link_limits.all_upload_bytes` ya funciona si se carga) |

**Pruebas de la ronda:** la prueba SQL suma lo de arriba y `public_link_files` (quién la ve, los links viejos, lo que no
subió, solo los links de esa página, `anon` no); las 30 pruebas SQL con la migración pasan en `begin … rollback`. 8
mutantes SQL nuevos, todos detectados (con los 25 de antes: 33, 32 detectados y 1 equivalente). 9 mutantes nuevos de la
app y el portero, todos detectados.

**Observaciones de la re-verificación de la ronda (hechas, v0.165):**

| Observación | Cómo quedó |
|---|---|
| **O-R1.** La prueba del link muerto (`linkDeadFiles.test.tsx`) tenía un solo archivo: «baja ese» y «baja el primero de la base» daban lo mismo (mutante b1b vivo) | Un caso con tres archivos de distinto largo y contenido: cada botón, en un orden que no es el de la lista, baja su propio original, byte por byte, y se puede bajar otra vez (no se borra nada). Mueren los mutantes «el primero de la base» y «el último» de `linkMediaBlob` |
| **O-R2.** El *Download it* del detalle de la insignia con el link vivo no tenía prueba automática | `linkBadgeDownload.test.tsx`: con la insignia real (`SyncBadge`), el link vivo y el tope del día en cero, dos archivos quedan sin registrar; el detalle los nombra con el motivo y cada *Download it* baja el original de su fila, con su nombre. Mueren: bajar el de otra fila, el nombre equivocado, sin botón y un blob distinto |
| **O-R3.** `public_link_files` corta en 500 y *Share* titulaba con la cantidad que llegó | **Sin tocar el SQL:** `PUBLIC_LINK_FILES_MAX` (500, el `limit` de la migración; una prueba lee el SQL y lo compara) y, con la lista en el tope, el título dice *500 or more files were added through this page's link* y la línea del resto aclara que hay anteriores sin listar (*and 480 more, plus older ones that aren't listed*). Con 499 dice la cantidad exacta. Pedir el total exacto necesitaría un cambio de SQL (cuenta aparte en `public_link_files`); no se hizo, y «o más» alcanza para lo que el equipo decide con ese número |

**El total exacto (v0.171, D279 B):** la migración aplicada `20261103120000_purgados_peso_link_total.sql` (`schema_version` 25)
crea otra vez `public_link_files` con la columna `total` al final (`count(*) over ()`, que se calcula antes del
`limit 500`): cada fila dice cuántos archivos registraron todos los links de la página. La lista, el orden, el tope y los
permisos no cambian, y la app publicada pide las columnas por nombre e ignora la nueva. Con `total`, *Share* titula con
la cantidad exacta (*503 files were added through this page's link*, *and 483 more*) y nunca dice «o más»; sin la
columna (base anterior a la 25), sigue como en O-R3. La prueba SQL es `supabase/tests/purgados_peso_link_total_permisos.sql`.

### Cómo quedó la 2c (v0.157)

**Estado:** implementada en la rama, con la migración `20261029120000_link_apartado.sql` (**aplicada**, verificado en la base el 2026-10-06; sube
`schema_version` a **20**). La app pide lo apartado solo con la base en la 20; con la 19 todo sigue como en la 2a.

**Lo que ve el equipo** (lo ve quien ve lo borrado de cada página; sale de `public_link_aside()`, una sola consulta sin
bytes, guardada en memoria y pedida como mucho cada 2 minutos con las sincronizaciones, y en el acto al abrir *Share* o
el historial; `src/ui/linkAside.ts`):

- **La lista en *Share***, debajo de *General access* (`LinkAsideList.tsx`): *N changes sent through this page's link
  were set aside*, con cada uno (la página, *Ana (via link)*, cuándo, el motivo en palabras y *earlier link* si vino por
  un link anterior, antes de *Reset link*), *Download it* por fila y *Download all*. Se ve aunque el link esté apagado
  (*Restricted*): lo de los links revocados sigue ahí. Muestra 20 y cuenta el resto; *Download all* baja todo.
- ***Set aside (via link)* en el historial** (`HistoryPanel.tsx`, `HistoryAside.tsx`): una entrada entre las versiones,
  por la hora en que llegó, con *Ana (via link)*. Elegirla muestra quién, el motivo, el texto que trae (leído de los
  bytes, sin aplicarlos a nada) y *Download it*. No es una versión: no se restaura ni se ve en *Only named versions*.
- **El ícono del árbol** (`LinkAsideTreeIcon.tsx`, una línea en `Sidebar.tsx`): un signo de atención en la fila de una
  página con algo apartado, con el tooltip *Changes sent through a link were set aside here*.
- **Los motivos en palabras** (también en el aviso de la página de la 2a): *the link was reset or turned off before it
  was added*, *it came after another change that couldn't be added*, *it uses a photo or an image from outside the
  shared pages*, *it would make the page too big* y, para lo demás, *the app couldn't add it safely*. El código queda en
  el archivo que se baja (el mismo JSON de la 2a, con la página de cada cambio).

**Lo que ve el visitante: volver a la página como la ve el equipo** (`LinkVisitorAsideNotice.tsx`,
`src/sync/linkStartOver.ts`, `PageDocs.replaceWithServer`). Con algo suyo apartado en una página, lo que siga
escribiendo ahí cuelga de lo apartado (el mismo autor de Yjs) y también se aparta (D235). En la página: *Some of your
changes on this page couldn't be added. What you write next here won't reach the team either…*, con *Download them* y
*Show the team's version*. Este último, después de confirmar:

1. mira cómo está guardada la página (las filas, la marca de lo sin subir y la versión);
2. **baja la copia** (lo de este navegador de esa página, entera); si la descarga falla, no sigue;
3. pide la base del equipo; **sin red, o sin base todavía** (la página tiene contenido y no hay base), no toca nada;
4. cambia lo guardado de la página por la base, **solo si sigue igual que en 1** (si se escribió algo en el medio:
   *The page changed while the copy was being prepared, so nothing was replaced*). Lo de antes no se tira: queda junto en
   el navegador (`meta`, `startedOver:<página>`, un update de Yjs que suma las vueltas) y sale en la próxima copia
   (`beforeStartingOver`, con su texto). La página se reabre con otro autor de Yjs: lo que escriba desde ahí entra;
5. el aviso deja de mostrarse para lo que ya había (lo apartado y lo que todavía esperaba de la sesión de antes, que se
   va a apartar en cadena), guardado con el link (`asideSeen`); si después se aparta algo más, vuelve. Las otras pestañas
   del mismo link (`BroadcastChannel`) vuelven a armar la página desde lo guardado.

**Además, de la auditoría de la 2a:**

| Qué | Cómo quedó |
|---|---|
| **O3.** Una versión inventada (`'9999'`) en una fila la dejaba sin decidir y trababa lo que mandaran después todos los visitantes de ese link en esa página | El orden de la admisión es por (página, link, **dispositivo**) en `link_admit_pages`, `link_admit_work` y `link_admit`: traba solo lo que sigue de ese dispositivo. Es seguro porque lo de otro dispositivo nunca depende de lo que este no tiene admitido (cada visitante escribe sobre bases). Se descartó un techo de versión: la base no sabe cuál es la publicada más nueva, así que o rechazaba a un visitante honesto apenas se publica, o dejaba pasar una versión inventada un poco más chica. Lo que queda: esas filas cuentan en los 20 MB de lo que espera de su link (*Reset link* las aparta) |
| **O9.** Después de recargar, la pantalla de link muerto no ofrecía lo mandado que no entró | El visitante recuerda con el link (`LinkEntry.sent`) las páginas donde mandó algo; se olvidan cuando el estado dice que ya no esperan ni tienen nada apartado sin ver. La pantalla de link muerto las suma a lo que ofrece bajar |
| **R1** de la re-verificación. Una página del equipo de más de 100 grupos anidados apartaba todo lo del link | El tope de profundidad mira lo que agrega la fila: se aparta si pasa el tope **y** deja la página más honda que antes (`depthProblem(doc, antes)`, `pageDepth`). Lo que no la ahonda entra; una página dentro del tope sigue sin poder pasarlo |

**Decisiones de esta entrega** (con la recomendación; valen hasta que Lega diga otra cosa):

- **Lo de antes de volver, guardado también en el navegador** (además de la copia que se baja): una descarga que el
  navegador no guardó no se lleva nada. Crece solo con lo que el visitante tenía en esa página.
- **La lista de *Share* muestra los links de la página, también los anteriores** (lo de *Reset link* es lo más común
  de lo apartado), y no lo de los links de las páginas de arriba (eso está en el *Share* de esas páginas).
- **El ícono del árbol, solo en la página** (no en una madre plegada, como las menciones): mínimo, porque otro frente
  cambia la fila del árbol (D233).
- **Sin descartar lo apartado:** sigue para siempre (va contra "no hay borrado duro"; queda en el roadmap como
  decisión de Lega).

**Pruebas:** la migración y `supabase/tests/link_apartado_permisos.sql` en `begin … rollback` contra la base real
(pasa; 8 mutantes: 7 detectados y 1 equivalente) y las 28 pruebas SQL de siempre con la migración (pasan, salvo
`link_publico_permisos.sql`, que ya falla sin ella: supone el interruptor de *Can edit* apagado y en la base está
prendido). En vitest: `linkAside.test.ts` (la lista con el reseteado y los permisos, el orden por dispositivo con el
motor, volver a la versión del equipo: el camino entero y que **nada apartado se pierde** sin haber bajado la copia, sin
red, sin base, con algo escrito en el medio y con dos pestañas; lo mandado recordado al recargar), `admitAudit.test.ts`
(R1), `linkAsideStore.test.ts` (cuándo pregunta) y `linkAsideUi.test.tsx` (*Share*, el historial, el árbol y el aviso del
visitante, montados). No toca el editor (ningún tipo de bloque ni propiedad nueva).

#### Correcciones de la auditoría de la 2c

Una auditoría independiente dio **aprobado con observaciones** (sin bloqueantes). Se corrigió antes de publicar:

| Hallazgo | Corrección |
|---|---|
| **O1.** Lo tecleado en el documento con lo de antes después del reemplazo (otra pestaña antes de enterarse, o esta en los milisegundos hasta reabrir) quedaba guardado pero pendiente en Yjs: no se veía, no salía en la copia ni se contaba | `keepLateWriting` (`src/sync/startedOver.ts`): si una página que volvió tiene en sus filas algo pendiente que sí se arma sobre lo de antes, lo pasa a lo de antes en la misma transacción en que lo saca de las filas, y anota el aviso (`startedOverLate:<página>`). Corre al abrir la página (después de guardar lo que esté en vuelo), antes de subirla en cada sincronización y al armar la copia. El visitante ve *Something you typed while this page changed to the team's version wasn't added. It's kept in this browser and comes in the copy you download*, con *Download them* y *Got it* (cerrar el aviso no toca lo guardado). Nunca hay una tecla escondida sin aviso: a lo sumo, hasta la próxima sincronización |
| **O2.** Al volver se daba por visto «apartado + esperando»: un apartado nuevo de algo que esperaba no se avisaba | Se da por visto solo lo apartado (nunca baja): cualquier apartado posterior vuelve a mostrar el aviso. Lo que esperaba de la sesión de antes y se aparta en cadena lo avisa otra vez (de más, nunca de menos) |
| **O3.** El tope de 1000 de `public_link_aside` era para todo el workspace | Hasta 200 por página (las más nuevas, `row_number() over (partition by page_id)`) |
| **O4.** `link_publico_permisos.sql` suponía el interruptor de *Can edit* apagado | Lo apaga al principio, como `link_editar_permisos.sql`: pasa con la base de hoy |
| **O6.** `link_page_id` iba a quien no ve la raíz del link | Nula para quien no la ve (`page_level`, una vez por link) |

La re-verificación encontró dos cosas más, corregidas en una ronda:

| Hallazgo | Corrección |
|---|---|
| **BN1.** Con ~2000 filas apartadas (un link reseteado), `public_link_aside` tardaba ~11 s y `authenticated` la corta a los 8 s: la lista de *Share*, el ícono del árbol y el historial quedaban vacíos para siempre | Las páginas con algo apartado y su permiso van `materialized` (el planificador metía `sees_deleted` fila por fila): ~0,1 s con 3000 filas. La prueba SQL lo mide y falla si pasa de 1 s |
| **ON1.** Una tecla tarde de la otra pestaña podía subir junto con lo nuevo de esta: la fila entera se apartaba y la sesión volvía a la cadena | Después de volver a la versión del equipo, **lo pendiente nunca sube**: se saca de lo que se sube en la misma lectura con que se arma (`pushPage`) y pasa a lo de antes, con su aviso. Además, lo pendiente de Yjs se leía con el formato 1 (está en el 2): en algunos casos tiraba y el barrido no pasaba nada, en silencio |

Queda al roadmap (O5): lo trabado por una versión inventada sigue contando en los 20 MB que esperan de su link, hasta
*Reset link*.

### Restos de las auditorías, en *Share* y en el visitante (v0.212)

- **El vencimiento en una fecha** de un link que ya existe se elige en un campo de fecha de la misma ventana (propone
  dentro de 7 días, no deja elegir un día pasado, *Set date* y *Cancel*), en lugar del cuadro `prompt()` del navegador.
  Una fecha pasada o vacía avisa *Pick a date in the future.* y no manda nada.
- **Volver a *Restricted* pregunta antes**, con el mismo texto que *Reset link*: apagar el link lo deja sin efecto para
  siempre (prenderlo otra vez crea otro). Sin confirmar, el selector vuelve a *Anyone with the link*.
- **El uso de hoy en singular y en plural** (*opened 1 time · 2 comments*, *abierto 1 vez · 2 comentarios*).
- **`LinkRemote` cierra también los proyectos:** archivar, borrar, restaurar y borrar para siempre tiran `link_read_only`
  sin mandar el pedido (la base ya los rechazaba para `anon`).

Pruebas en `linkShare.test.tsx` (3 más) y `linkMode.test.ts` (1 más). Siguen en el roadmap las demás observaciones.

### Restos del link (v0.215)

**Para el equipo:**

- **El ícono del árbol** (`LinkTreeIcon.tsx`, `src/ui/linkPages.ts`): un signo de link en la fila de cada página con un
  link vivo propio, con un tooltip que dice lo que el link deja hacer y quién lo creó (*Anyone with the link can edit ·
  created by lega*); si el link no anda sin haber vencido (quien lo creó ya no puede compartir la página), se ve en el
  color de aviso y manda a *Share*. **Un link vencido no lleva ícono** (la lista tampoco lo trae): que venció lo dice
  *Share*. **Lo ve solo quien puede abrir *Share* de esa página, y lo decide la base:** `public_link_pages()`
  dice dónde mirar (los ids) y cada página se confirma con `get_public_link`, la función de *Share*, que no contesta nada
  a quien no puede compartirla (desde v0.218 la lista ya contesta solo a quien comparte y trae lo del ícono: ver "La
  lista de páginas con link, solo para quien comparte"). Lo que la app calcula por su cuenta solo ahorra pedidos (un
  invitado no pregunta nada).
  La lista se pide como mucho cada 2 minutos (también después de un pedido que falló: un servidor caído no recibe uno por
  cada aviso de la sincronización) y cada página se vuelve a confirmar cada 10 (hasta 20 por vuelta); abrir
  *Share* actualiza el ícono en el acto con lo que acaba de leer. Del link se guarda el nivel, quién lo creó y si anda:
  nunca el token. Con la app abierta por un link, nada.
  **Lo guardado es de una sesión:** hay un store por cada armado de los servicios (su clave es el motor de
  sincronización, que nace y muere con ellos), no por cliente de Supabase, que es uno por workspace y pestaña y lo
  comparten todas las cuentas que entran sin recargar. Otra cuenta en la misma pestaña, o la misma después de rearmar los
  servicios (la pestaña que retoma, un reintento de arranque), arranca con uno vacío y pregunta de nuevo. Y si a la
  persona le bajan el rol a invitado o la sacan con la app abierta, se vacía en el acto (una vuelta en viaje ya no
  escribe nada).
- **Quién creó el link, en *Share*:** *Created by lega on 2/10/2026* debajo de las líneas del link (sin la cuenta, solo
  la fecha). El link de una página de arriba se dice con su nivel (*…can edit this page*; antes, siempre *can view*).
- **Los errores del link, en palabras:** si el link se apagó o se renovó en otro lado con la ventana abierta, *This link
  was turned off or reset somewhere else* y la ventana vuelve a leer cómo quedó (antes mostraba `link_not_found`); con la
  página en la papelera, que el link no anda y que restaurarla lo vuelve a prender; `link_invalid` es *Pick a date in the
  future.* solo cuando se mandó una fecha elegida a mano, y si no (un id repetido al crear o renovar), *The link couldn't
  be saved. Try again.* La ayuda (*Share with a link*) suma
  esa línea, el ícono y quién lo creó.
- **El campo de fecha** (las dos observaciones de la revisión de v0.212): se cierra cuando el link se apaga, se renueva o
  se crea otro, y Enter confirma como *Set date*.

**Para el visitante:**

- **Comentarios sin mandar cuando el link muere:** la pantalla *This link no longer works* los muestra enteros (el
  último texto de cada uno; no el que él mismo borró) con *Copy the text*. Copiar no saca nada de la cola.
- **Qué pedir:** en una página que el link no deja editar, *This link lets you read this page and comment on it. To
  change it, ask whoever shared it for a link that can edit*, en la página y en el menú (antes, «Ask for edit access»,
  que con un link no existe). Si el link ya es *Can edit* y la base se lo deja usar a esta app solo para leer y comentar
  (`plink_open` da `level` `comment` con `link_level` `edit`), no se lo manda a pedir otro: *This link can edit, but
  editing through a link isn't available right now (it may need a newer version of the app)…*. La app no sabe cuál de
  las dos causas es (editar con un link apagado en el workspace, o una app más vieja que la versión que lo prendió): para
  decirlo haría falta que `plink_open` lo cuente.
- **El nombre sin «(via link)»:** la app lo saca al guardarlo y al leerlo (también «(vía link)», con cualquier espacio
  o mayúscula): escrito en el nombre salía dos veces. **Desde v0.221 la base también lo saca** de lo que le llega
  ("El nombre del visitante sin el rótulo, también en la base"); no cambia quién puede hacerse pasar por quién, porque
  el rótulo lo pone siempre la app del equipo.

**El portero:** la prueba que faltaba de los pases de 2 horas en `/folder/list` con un link (una carpeta y varias, el
link revocado y lo que no ve), en `portero/src/folders.test.ts`. Y el texto de 3.9: el listado cuenta un pase por pedido,
no uno por archivo.

**Lo que queda, sabido:**

- **Una confirmación que llega tarde.** Si la respuesta de `get_public_link` de una vuelta viaja justo mientras *Share*
  crea o apaga ese mismo link, la respuesta vieja pisa la nueva y el ícono queda mal hasta la vuelta siguiente (entre 2 y
  10 minutos), que lo corrige sola. Arreglarlo es numerar los pedidos por página y descartar la respuesta de uno anterior
  al último `learn`.
- **`public_link_pages()` es también un tema de privacidad, no solo de pedidos.** La función contesta a cualquiera que ve
  la página, invitados incluidos, si la llaman a mano: les dice que esa página (que ya ven) tiene un link público. La app
  no se lo muestra a nadie que no comparta, pero la base lo entrega. **Hecho en v0.218** con el diseño con `can_share`
  de la tabla de abajo (sección siguiente).
- **La pantalla del link que ya no anda y la base local de comentarios.** Para leer la cola abre la base local de
  comentarios del link, y la crea vacía si no existía. Y un comentario que la base ya recibió pero cuyo acuse se perdió
  (sigue en la cola) figura como «no mandado»: quien lo copia y lo vuelve a mandar por otro lado lo duplica.

**Lo que sigue pidiendo la base (sin hacer, diseño):**

| Qué | Por qué no alcanza lo de hoy | Diseño |
|---|---|---|
| **Hecho en v0.222** (sección "De qué link vino cada comentario (v0.222)"; devuelve además `expired` y `alive`, y da `ids_invalid` con más de 200 ids). De qué link vino cada comentario (*Can view link, created by lega*, 3.7) | `list_comments` da `plink_id`, pero ninguna función dice el nivel ni el creador de un link por su id (`get_public_link` es por página y solo del link vivo; el de una página de arriba llega sin creador), y un comentario puede ser de un link ya renovado | Una función `public_link_labels(p_ids uuid[])` para `authenticated`, que devuelva `id`, `level`, `created_by_name` y `revoked` solo de los links cuya raíz la sesión puede compartir (`private.can_share(null, page_id)`), hasta 200 ids por pedido; el panel de comentarios la llama con los `plink_id` de la página y arma el detalle. Sin `can_share`, nada (ni existencia) |
| **Hecho en v0.218.** Que `public_link_pages()` conteste solo a quien comparte (privacidad), y que el ícono no dependa de dos pedidos | `public_link_pages()` lista a quien ve la página (nivel 1), no a quien la comparte: un invitado que la llama a mano se entera de que la página tiene link, y por eso la app confirma cada una con `get_public_link` | Cambiar su cuerpo a `private.can_share(null, pl.page_id)` y sumar `level`, `created_by_name` y `alive` al resultado (columnas al final: la app publicada lee solo `page_id`); el ícono pasa a un solo pedido |
| **Hecho en v0.221, limpiando en vez de rechazar** (sección de abajo). Que la base rechace «(via link)» en el nombre | `plink_add_comment` y `plink_push_page_update` limpian controles y marcas de dirección, no el rótulo | Donde las dos validan el nombre (hoy `btrim(p_author)` y el chequeo de largo y de caracteres), sacar `\(\s*v[ií]a\s+link\s*\)` (sin distinguir mayúsculas) antes del `btrim`; si queda vacío, `author_missing` como hoy |

### La lista de páginas con link, solo para quien comparte (v0.218)

Migración `20261107120000_link_paginas_quien_comparte.sql`. `public_link_pages()` deja de listar las páginas con link
que la sesión **ve** y pasa a listar las que **puede compartir** (`private.can_share(null, página)`, la regla de
`get_public_link`): quien ve la página sin poder compartirla (Ver, Comentar, Editar y crear sin ser admin ni dueño del
proyecto, un invitado, un admin que solo la ve) ya no recibe su fila, ni llamándola a mano. Devuelve, después de
`page_id`, lo que dice el ícono: `level`, `created_by_name` (la parte del correo antes de la @) y `alive` (quien lo creó
todavía puede compartir la página; lo vencido no se lista). Nunca el token.

- **La app publicada** lee solo `page_id` y confirma cada página con `get_public_link`, que ya contestaba solo a quien
  comparte: recibe las mismas páginas que terminaba mostrando. La exportación (`loadFileLinks`) usa la lista igual.
- **La app nueva** (`src/ui/linkPages.ts`, `getPublicLinkPages`): una fila que trae `level` se marca con lo que dice,
  sin pedir nada más; el ícono sale de **un pedido** cada 2 minutos en vez de uno más por página. Una fila que trae solo
  `page_id` es de una base sin la migración: ahí la lista sigue diciendo solo dónde mirar y cada página se confirma como
  antes. La app nunca decide sola: sin la marca de la base, pregunta. Lo que *Share* leyó mientras la lista viajaba
  sigue ganando (un link recién apagado no reaparece).
- **Lo que no cambia:** `anon` no la llama; quien recibe una fila ya podía leer lo mismo, y más, con `get_public_link`.
  No sube `schema_version`.
- **Pruebas:** `supabase/tests/link_paginas_quien_comparte_permisos.sql` (para cada persona, la lista coincide con lo
  que `get_public_link` le contesta página por página) y `src/ui/linkPagesList.test.ts`.

### El portero no aceptaba la versión de la app (v0.218)

**Estaba roto desde la primera versión del link público (v0.114).** La app abierta por un link manda tres headers en
cada pedido, también al portero (`linkHeaders` en `src/linkMode.ts`): `x-shotdocs-link`, `x-shotdocs-device` y
`x-shotdocs-version`. El CORS del portero aceptaba los dos primeros y no el tercero. Antes de un pedido así el navegador
hace una consulta previa (`OPTIONS`) y, si algún header no está en `Access-Control-Allow-Headers`, corta el pedido
entero. Resultado: quien entraba por un link veía la página, los comentarios y las miniaturas (salen de Supabase), pero
no podía abrir originales, videos ni adjuntos (`POST /pass`), ni listar una carpeta, ni subir con *Can edit*. Con una
cuenta no pasaba: la sesión no manda ese header al portero.

- **Cómo se verificó (2026-10-06):** la consulta previa al portero publicado no devolvía `x-shotdocs-version` entre los
  headers aceptados, y un pedido con ese header hecho desde un navegador quedó cortado antes de salir.
- **Por qué no se vio antes:** las pruebas llaman al portero directo, sin la consulta previa del navegador, y la única
  prueba del CORS miraba los dos headers del link, no los que la app manda de verdad.
- **El arreglo:** el portero acepta `x-shotdocs-version` (`portero/src/core.ts`, `cors`). Se publica con la app.
- **La prueba que lo ataja** (`portero/src/core.test.ts`, "el CORS acepta todo header que la app le manda"): toma las
  claves de `linkHeaders()` y los headers de cada pedido que hace el cliente del portero de la app (con sesión y por un
  link: estado, pases, subir por partes, papelera) y exige que todos estén en lo que el portero contesta a la consulta
  previa. Un header nuevo en la app sin su lugar en el CORS la hace fallar.
- **Falta:** probar un link con fotos, un video y una subida contra el portero real después de publicar.

### La lista de páginas con link, sin recorrer todos los links (v0.221)

Migración `20261111120000_link_paginas_sin_recorrer_todo.sql`. `public_link_pages()` miraba, por cada link vivo del
workspace, el permiso de la sesión sobre su página (la cadena de páginas de arriba) y, por cada uno que pasaba, lo mismo
para quien lo creó; la app la pide cada 2 minutos. **Contesta lo mismo a cada sesión**, con menos trabajo:

- Sin rol (o con contraseña) o invitado: nada, de entrada.
- Quien no es dueño ni admin del workspace: solo los links de los proyectos que creó (la regla pide una de las dos cosas).
- Los links de un proyecto borrado no se miran (nadie tiene nivel ahí).
- El permiso se mira **una vez por proyecto**: con nivel 4 sobre el proyecto entero lo tiene sobre cada página, también
  en la papelera. Solo cuando no alcanza (un admin con el permiso dado página por página) se mira la página con la regla
  de siempre (`private.user_can_share_page`). Lo mismo para si el link anda, una vez por persona y proyecto.

El atajo vale mientras `private.user_page_level` dé, a quien no es invitado, por lo menos su nivel sobre el proyecto
entero. **Quien cambie esa regla tiene que correr la prueba** `supabase/tests/link_paginas_sin_recorrer_todo_permisos.sql`:
compara, para trece personas y en cinco momentos (roles que cambian, la papelera, permisos por página, un proyecto
borrado), la lista con el cuerpo anterior mirado link por link, y cuenta cuántos permisos de página se miran. La prueba
de v0.218 (`link_paginas_quien_comparte_permisos.sql`) pasa sin tocarla.

**Medido** (608 links sembrados adentro de una transacción que se deshizo): quien comparte todo por proyecto, de 835 a
182 ms; una admin con la mitad dada página por página, de 863 a 291 ms; un miembro que no recibe nada, de 543 a 0,2 ms;
un invitado, de 264 a 0,1 ms. La auditoría, con 613 links: dueña o admin con el proyecto entero, de 760 a 80 ms; un
miembro que no comparte, de 540 a 2 ms; un invitado, de 240 a 0,1 ms. La firma, las columnas y los permisos no cambian;
no sube `schema_version`.

**Lo que queda:** un **admin sin «Editar y crear páginas» sobre el proyecto entero** (con Ver, Comentar o Editar, o con
el permiso dado página por página) todavía hace mirar el permiso link por link en ese proyecto: es el único caso donde
el proyecto no alcanza para decidir. Medido por la auditoría con 613 links: de 400 a entre 270 y 330 ms. Abaratarlo
pide resolver de una vez los permisos por página de la sesión (una consulta por proyecto en vez de una por link).

### El nombre del visitante sin el rótulo, también en la base (v0.221)

Migración `20261112120000_link_nombre_sin_rotulo.sql`. La app saca «(via link)» del nombre desde v0.215; la base lo
guardaba como llegaba (llamando a la API a mano, o con una app anterior, se veía dos veces). Ahora
`private.plink_author_name` limpia el nombre con la regla de la app en las dos funciones que lo guardan:
`plink_add_comment` (`comments.plink_author`) y `plink_push_page_update` (`public_link_updates.author`, que la admisión
copia a `page_updates.plink_author`). Saca «(via link)» y «(vía link)» con las mayúsculas, los espacios (también los de
ancho fijo) y los paréntesis (también los anchos) que sean, **las veces que haga falta** (sacar uno puede dejar armado
otro: «(via (via link) link)»; la app tenía ese mismo hueco y también se cerró) y deja un espacio donde quedaron varios.

- **Limpia, no rechaza (D314).** El roadmap pedía rechazar. Pero el error del nombre (`author_invalid`) es definitivo:
  un comentario o una edición de una app anterior a v0.215 con el rótulo en el nombre quedarían sin entregar para
  siempre. Se guardan con el nombre limpio. Si el nombre era solo el rótulo, queda `-`. Nada que antes se aceptara
  se rechaza ahora, y un nombre sin el rótulo se guarda exactamente como antes.
- **Lo que no cambia:** vacío, más de 60 (medido después de limpiar), controles y marcas de dirección: `author_invalid`.
  La firma, los errores y los permisos (`anon` con el token del link; una sesión no las ejecuta).
- **Lo que no cubre.** (1) `import_comment`: el nombre de un comentario importado puede traer el rótulo **a propósito**
  (al importar un archivo exportado, la app escribe `Ana (via link)` como autor de lo que se había comentado por un
  link); quien puede importar en una página puede entonces escribir ese texto como autor, con la marca de importado
  (D315). (2) Lo ya guardado no se reescribe (en la base de Wanka no había ninguna fila con el rótulo al
  2026-10-06). (3) **Los parecidos**, igual que en la app: una `í` escrita como `i` más el acento suelto (descompuesta),
  el separador de vocales mongol (U+180E) u otro invisible adentro, la `ı` sin punto, las letras de ancho completo, las
  letras cirílicas o griegas que se ven iguales, y otros paréntesis (`[via link]`, `{via link}`). Ninguno engaña al
  equipo sobre quién escribió (el rótulo de verdad lo pone la app, con su estilo); cerrarlos pide normalizar el nombre
  (NFKC y una tabla de parecidos) en la app y en la base a la vez.
- Pruebas: `supabase/tests/link_nombre_sin_rotulo_permisos.sql` y `src/sync/linkMode.test.ts`.

### Lo que quedó de v0.221

- **De qué link vino cada comentario.** **Hecho en v0.222** (sección siguiente). La parte de la base es la de la tabla
  de "Restos del link (v0.215)" (`public_link_labels`, solo lectura, para quien puede compartir la raíz del link). Al
  hacerlo se vio que el id del link **ya quedaba guardado** en el dispositivo (la fila de `list_comments` se guarda
  entera); lo que faltaba era declararlo, pasarlo a la vista del panel y pedirlo en la vista de compatibilidad.

### De qué link vino cada comentario (v0.222)

Migración `20261113120000_link_rotulo_comentarios.sql`. En el panel de comentarios, un comentario hecho por un link
sigue mostrando `Ana (via link)`; **quien puede compartir la página raíz de ese link** ve además, en una línea debajo,
de qué link vino: *Can view link · created by lega* (o *Can edit link*), y al final *closed* (se apagó o se renovó),
*expired* (venció) o *not working* (quien lo creó ya no puede compartir la página). Sirve para decidir qué link apagar
en *Share* si alguien se porta mal. Los demás (Ver, Comentar, Editar, Editar y crear sin ser admin ni dueño del
proyecto, un invitado, quien entró por un link) ven lo de siempre.

**La base.** `public_link_labels(p_ids uuid[])` (`stable`, `security definer`, `search_path` vacío, solo
`authenticated`): por cada id de link devuelve `id`, `level`, `created_by_name` (la parte del correo antes de la @),
`revoked`, `expired` y `alive` (la cuenta de `public_link_pages`: ni apagado ni vencido, y quien lo creó todavía
comparte la página). **Nunca el token ni la página.**

- **A quién:** solo los links cuya página raíz la sesión puede compartir: el resultado es, sesión por sesión, el de
  `private.can_share(null, página)` (la regla de `get_public_link`) mirado link por link. De un link que la sesión no
  comparte, o que no existe, no hay fila ni error: **las filas no dicen si el id existe**. Sin rol (o con contraseña) o
  invitado, nada de entrada (ese corte no es solo un atajo: un invitado que creó un proyecto tiene nivel 4 sobre todo el
  proyecto y no comparte nunca). `anon` no la ejecuta.
- **Cómo llega con poco trabajo:** el permiso se mira **una vez por proyecto**, como en `public_link_pages()` desde
  v0.221. Un proyecto borrado no se mira; tampoco uno donde la sesión no puede compartir nada (no lo creó y, si es dueña
  o admin del workspace, no tiene ningún «Editar y crear páginas» sobre el proyecto ni sobre una página suya); con nivel
  4 sobre el proyecto entero comparte todas sus páginas sin mirar ninguna; y solo cuando eso no alcanza (un admin con el
  permiso dado página por página) se mira la página, una vez por página (los links viejos de una página renovada cuestan
  una sola cuenta). `alive` se mira solo para el link sin apagar ni vencer (uno por página como mucho). Hasta 200 ids
  por pedido; con más, `ids_invalid` (código `22023`; depende solo de lo que se manda).
- **El tiempo ya no delata si un link existe a quien no comparte nada en ese proyecto.** La primera versión de la función miraba el permiso de la página de
  cada link que existía antes de saber si la sesión lo compartía: para quien no comparte, 200 ids ajenos tardaban
  ~115 ms y 200 inexistentes ~1 ms (lo encontró la auditoría). Con el permiso por proyecto, quien no comparte nada en
  un proyecto no hace mirar ningún permiso de página (la prueba lo cuenta). **Medido** (200 links en 200 páginas de
  otra persona, sembrados en una transacción que se deshizo; 40 pares intercalados, mediana): un miembro que solo
  comenta, 200 ids ajenos 1,02 ms contra 0,66 ms inexistentes, y con un id 0,55 contra 0,53; un admin sin permisos,
  0,84 contra 0,49 y 0,71 contra 0,66. La diferencia no es cero (queda el cruce con `pages` y `workspaces`): es del
  orden de 1 ms por pedido de 200 ids, y en cualquiera de los dos sentidos según el plan de la base (la
  re-verificación midió 0,52 ms los ajenos contra 2,05 ms los inexistentes para el mismo tipo de sesión). Un admin
  con algún «Editar y crear páginas» dado página por página en un proyecto sí hace mirar las páginas de los links de
  ese proyecto que pide, **y ahí el tiempo sí lo delata** (medido: 230 ms contra 2 ms con 200 ids; 3,75 contra 0,53
  ms con uno). Se acepta: ese admin ya comparte parte del proyecto, y lo único que aprende es que un id que ya tiene
  (los ids salen de comentarios que ya ve) es de un link de otra página del mismo proyecto; no cuál página, ni el
  nivel, ni quién lo creó. En la prueba, el conteo exacto de permisos mirados para quien comparte (6 y 9) depende
  de cuántas veces la regla llama por dentro a `user_page_level`: si un cambio inocente lo rompe, pasarlo a una cota.
- **Lo que le cuesta a quien comparte** crece con las páginas distintas: medido con 200 links en 200 páginas a 5 niveles
  de profundidad, 175 ms para quien comparte el proyecto entero (todo es `alive`: quien creó cada link, uno por uno) y
  255 ms para un admin con el permiso dado página por página; con 2 links, 2 a 4 ms. Una página común tiene de uno a
  tres links. Abaratarlo es mirar a quien creó los links una vez por persona y proyecto, como hace `public_link_pages()`.
- **La papelera y los proyectos borrados** siguen la regla de siempre: con la raíz en la papelera la sigue recibiendo
  quien la comparte (ve la papelera), y de un proyecto borrado nadie recibe nada. `alive` no mira la papelera (igual
  que el ícono del árbol): un link con la raíz en la papelera figura sin *closed* aunque no se pueda abrir.

**La app.**

- **El id viaja y se guarda:** `list_comments` ya traía `plink_id` y la fila se guardaba entera en el dispositivo;
  ahora está declarado (`CommentRow.plink_id`) y sale en la vista (`CommentView.linkId`, solo si la fila trae también
  el nombre del visitante). Un dato opcional: una fila guardada sin él se lee igual, y una versión anterior de la app lo
  ignora. La vista de compatibilidad (`comments_view`, cuando `list_comments` no está) pide también `plink_id` y
  `plink_author`; si la vista de esa base no los tiene (`42703`, una base anterior a los links), sigue sin ellos.
- **Cuándo se pide** (`src/ui/linkLabels.ts`): un pedido por el conjunto de links de los comentarios de la página
  abierta, no uno por comentario; lo ya pedido no se repite hasta pasados 2 minutos (el link pudo apagarse o vencer), y
  abrir *Share* lo vuelve a pedir en el acto. **Solo si la app sabe que la persona puede compartir esa página**
  (`canSharePage`; quien comparte la raíz comparte lo de abajo): si no, ni se pregunta. Lo que la app calcula solo
  ahorra pedidos; el rótulo sale únicamente de lo que la base contesta.
- **Lo recordado es de una sesión:** un store por motor de sincronización (no por cliente de Supabase, que es el mismo
  para todas las cuentas de la pestaña), como el del ícono del árbol. Otra cuenta arranca vacía; si el rol baja a
  invitado con la app abierta, se vacía. Nada se guarda en el dispositivo.
- **Cuando cambian los permisos de la persona** con la app abierta (le bajan el rol, le sacan un permiso), lo recordado
  se vuelve a pedir en el acto: lo que la base ya no contesta desaparece en esa misma sincronización, sin esperar los 2
  minutos; y a quien deja de compartir la página del comentario la línea se le va sin preguntar nada.
- De un comentario borrado no se pide el link.
- **Cuando no hay respuesta:** sin red, con una base sin la función (`PGRST202`; se vuelve a probar a los 10 minutos) o
  con un pedido que falla, el comentario se ve como antes, sin rótulo y sin error.
- La ayuda suma *Which link a comment came from* (Compartir).

**Decisiones** (`Doc_Decisiones.md`): D316 (la línea se ve siempre, también de un link cerrado o vencido, y no dice en
qué página está el link) y D317 (no se guarda en el dispositivo ni sale en lo exportado).

**Compatibilidad.** La app publicada contra la base nueva: es una función nueva y nada de lo que existe cambia de
firma, columnas, errores ni permisos. La app nueva contra una base sin la migración: `PGRST202`, sin rótulo. No sube
`schema_version` ni pide subir `min_app_version`.

**Pruebas:** `supabase/tests/link_rotulo_comentarios_permisos.sql` (veinte personas: la creadora del proyecto, admins
con el permiso sobre el proyecto, sobre una rama, sobre una hoja, con Editar sobre el proyecto entero con y sin la hoja,
solo con Ver, o solo sobre una página de otro proyecto; miembros con Editar y crear sobre el proyecto, una rama o una
página, uno que creó otro proyecto, Editar, Comentar, Ver, sin permiso; un invitado y uno que creó un proyecto; alguien
sacado, con contraseña, sin persona y `anon`; links vivos, vencidos, apagados, renovados, en la papelera y de un
proyecto borrado y purgado; para cada sesión la lista coincide con la regla mirada link por link y con lo que contesta
`get_public_link`, y se cuenta cuántos permisos de página hace mirar cada una: ninguno quien no comparte nada en el
proyecto), `src/sync/commentLinkId.test.ts` y `src/ui/linkLabels.test.tsx`.

**Lo que queda:**

- Probarlo en la app real con dos cuentas (una que comparte y una que solo comenta) después de aplicar la migración, y
  mirar la línea en el tema oscuro y en el teléfono. (El nombre largo de un visitante se midió en una página estática a
  375 px: ya no desborda el comentario.)
- El rótulo no dice en qué página está el link (D316): si hiciera falta, la función puede sumar el título de la raíz.
- El store no mira si la app quedó más vieja que la mínima del workspace: pide igual, como el ícono del árbol (es una
  lectura; la base no frena lecturas por versión).
- `alive` no mira la papelera y el costo para quien comparte crece con las páginas distintas (arriba).
- **Hecho en v0.224:** cuando se lee la vista de compatibilidad (`comments_view`, sin `list_comments`),
  `fetchComments` pide también `imported_*` y `mentions` (antes, un importado se veía como de una cuenta borrada y las
  menciones sin pintar hasta la bajada siguiente con `list_comments`). Si a la vista de una base anterior le falta
  alguna (`42703`), baja de a un escalón (sin las menciones, sin las del link, sin las de importar) y no las vuelve a
  pedir.

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
