# Link público: «Anyone with the link»

**Estado: diseño, sin código ni migración** (roadmap P.19; pedido de Lega del 2026-10-02). Toca permisos, entrar sin
cuenta y abuso: riesgo alto. Cada entrega va con sus pruebas de permisos (casos negativos y mutantes) y su auditoría
independiente. Lo medido está en prototipos fuera del repo ("Cómo se midió", al final). Se diseñó contra `main` v0.103
más la privacidad de lo borrado (D14, entregas 0 y 1, v0.104), de la que depende.

## En corto

- **El pedido.** En *Share*, además de personas y correos, **Anyone with the link** con *Can view* (que siempre puede
  comentar, también en solo lectura) o *Can edit*. Se manda el link a cualquiera y entra sin cuenta. "Debería estar
  seguro."
- **Cómo entra sin cuenta: con el token del link, sin sesión de Supabase** (P1). El link lleva después del `#` (que no
  llega a ningún servidor ni al `Referer`) la dirección y la clave publicable del workspace y un token de 256 bits
  (`sdl_` + 43 caracteres). La app del visitante manda el token en un header propio (`x-shotdocs-link`) en cada pedido,
  con el rol `anon` de Supabase; funciones nuevas de la base (`link_*`) lo validan en cada pedido y deciden qué ve. No se
  crea ninguna cuenta y **no se toca la configuración de login**: el registro sigue cerrado (D-09).
- **Por qué no las sesiones anónimas de Supabase** (lo primero que se evaluó): con el registro cerrado **no andan**. El
  código de Supabase Auth corta el alta anónima con `Signups not allowed for this instance` si `disable_signup` está
  prendido; habría que abrir el registro (antes, el hook de invitaciones conectado y probado, que en Wanka no está),
  prender los anónimos para todo el proyecto (cualquiera con la clave publicable, que es pública, crea cuentas: 30 por
  hora por IP), sumar un captcha que también afecta al login por código, borrar a mano los anónimos viejos (Supabase no
  los limpia) y cuidar que un anónimo no se convierta en cuenta con correo salteando la invitación. Todo para ganar un
  `auth.uid()` que el link no necesita.
- **Qué ve.** El link vale para **su página y lo de abajo, nunca lo de arriba ni lo del costado**: el nivel se calcula
  en la base subiendo por los padres de cada página hasta encontrar la raíz del link. La raíz llega sin padre (el
  camino de arriba empieza en ella), un link interno a una página de afuera se ve sin título (no está en su árbol), no se
  ven el nombre del workspace ni el del proyecto, y lo que está en la papelera no llega (como a un invitado, D21).
- **Se trata como un invitado** (P4): recibe siempre **la base limpia** de D14 (nunca filas, nunca lo borrado), no ve el
  historial (D13) ni la papelera (D21), y las fotos sacadas de la página no le dan permiso. Por eso **un link solo se
  puede crear con el interruptor de D14 prendido** (P5).
- **Can view = Comentar** (P2): ve, baja archivos y comenta con un nombre que escribe la primera vez (guardado en su
  dispositivo y mostrado siempre con *(via link)*). **Can edit = Editar** (P3): escribe y sube archivos al Drive del
  dueño; no crea, mueve ni manda páginas a la papelera. Sus ediciones quedan en `page_updates` con el link y su nombre
  (el historial las muestra), y sin red se guardan primero en su dispositivo como las de cualquiera.
- **Revocar es instantáneo**: cada pedido vuelve a validar el token. *Reset link* crea uno nuevo y el viejo deja de andar
  en el acto; también deja de andar si vence, si se lo apaga, si la página va a la papelera o si quien lo creó pierde el
  permiso de compartir. Lo crea quien hoy puede compartir con personas (P6). Un pase del portero ya dado sirve hasta que
  vence (P17: 2 horas para los del link).
- **Abuso y plan gratis.** Sin cuentas no hay MAU. Lo que se gasta: egress de Supabase (5 GB al mes, más 5 GB
  cacheado) en el contenido y las miniaturas, y los 100 000 pedidos por día de Workers de la cuenta (el portero, compartido
  con todo el equipo). Medido en Wanka: una miniatura pesa 28 KB de promedio (49 KB el p95), una página 7 KB de mediana
  (64 KB el p95) y una página con fotos tiene hasta 27 (p95). Una visita a una página pesada cuesta ~0,8 MB de egress:
  alcanza para ~6000 visitas por mes; y si el visitante bajara cada original para la imagen nítida, como hoy un miembro,
  ~54 pedidos al portero: se agotaría con unas 1800 visitas por día. Por eso
  **topes por link y por día en la base** (P11: 300 aperturas, 3000 pases, 200 comentarios…), el **modo liviano** del
  visitante (P12: baja solo lo que abre) y el contador a la vista en *Share* para apagarlo.
- **Buscadores y filtraciones** (P13): toda la app con `X-Robots-Tag: noindex` y `robots.txt` cerrado (el contenido igual
  nunca está en el HTML), el token solo en el `#` y en un header (nunca en una dirección que pida la app), 256 bits
  (probar al azar es imposible: ~10^57 años a mil millones de intentos por segundo contra mil links vivos) y guardado con
  su huella SHA-256 para buscarlo.
- **Prototipo de permisos** (PGlite, Postgres 18 en memoria): 36 de 36 casos (raíz, hijas, arriba, costado, otro
  proyecto, papelera, proyecto borrado, mover adentro y afuera, vencido, revocado, link nuevo que invalida el viejo,
  creador sin permiso o sacado, invitado como creador, tokens mal formados, `anon` sin acceso a tablas ni funciones
  privadas, tope de aperturas). Seis mutantes de siete los detectan (el que sobrevive, sin el chequeo de formato, es una
  defensa extra: la huella igual rechaza). El nivel de una página cuesta lo mismo que el de hoy (`user_page_level`).
- **Entregas:** 0 = la prueba en la base real de que los headers llegan a la base y a Storage, y `noindex` (riesgo bajo);
  1 = *Can view* completo (ver, bajar y comentar; riesgo alto); 2 = *Can edit* (riesgo alto); 3 = medir y ajustar los
  topes, y el link de un proyecto entero si hace falta.

**En términos simples:** el link es como una llave larguísima que va pegada a la dirección, en la parte que el navegador
nunca le manda a nadie. Quien la tiene abre la app en el navegador, sin crear cuenta ni recibir un código; la app le
muestra la llave a la base en cada pedido y la base le deja ver solo esa página y sus subpáginas, nunca lo de arriba. No
se toca nada del login, así que el registro sigue cerrado. Si el link se escapa, en *Share* se ve cuántas veces se abrió
hoy y con *Reset link* la llave vieja deja de abrir en el acto. Quien entra así ve la página "pasada en limpio" como un
cliente invitado (nunca lo que se borró), comenta con el nombre que escriba (que se muestra siempre como "via link", para
que nadie se haga pasar por el equipo), y con *Can edit* puede escribir y subir fotos, con topes por día para que un link
que se viraliza no deje al equipo sin servicio.

## Reglas que no se rompen

1. **Lo decide la base, en cada pedido.** El token se valida en cada llamada (no se "canjea" por algo que dure); la app
   del visitante no decide nada que la base no confirme. Vale aunque llame a la API a mano.
2. **Nunca lo de arriba ni lo del costado.** El link vale para su página y las que cuelgan de ella hoy, recalculado en
   cada pedido (mover una página afuera le saca el acceso en el acto).
3. **El registro sigue cerrado (D-09)** y no se cambia nada de la configuración de login.
4. **Como un invitado:** base limpia (D14), sin historial (D13), sin papelera (D21), sin fotos sacadas.
5. **Nunca perder datos:** lo que escribe o sube un visitante se guarda primero en su dispositivo; si el link deja de
   andar con algo sin subir, no se borra: se puede bajar como archivo.
6. **Cada workspace es una isla y sin claves nuevas:** todo vive en el Supabase y el portero del dueño; el portero sigue
   sin ninguna clave de la base.
7. **Nada de tipos de bloque nuevos** ni cambios en el documento.

## 1. Qué hay hoy

- `Plan_Workspaces.md`, sección 4: "Un link público (sin login) es otra cosa y queda para después; para material
  sensible, siempre con login". El plan preveía las funciones de links públicos en el portero (sección 9).
- Compartir hoy es con personas: `share()` (un miembro, nivel por proyecto o página) y `create_invitation()` (un correo,
  con su link `#invite=` que lleva la dirección y la clave publicable del workspace, su clave local y la página). Quien
  comparte: `private.can_share` (nivel 4 sobre lo compartido y ser dueño, admin o dueño del proyecto).
- Los permisos viven en la base: `private.user_page_level(página, persona)` sube por los padres, junta los `grants` y
  aplica la papelera (v0.102); todo lo demás (filas, contenido, comentarios, archivos, buckets, el portero por
  `media_file`) sale de ahí. **Todo pide una persona** (`auth.uid()`) con una fila viva en `members`.
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
| **B. Token del link validado por la base** (elegido) | El token en un header, rol `anon`; funciones `link_*` lo validan en cada pedido | Anda: no crea cuentas | Nada | El link y un nombre que escribe el visitante | Sin MAU | **Elegido (P1)** |
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
  dejaría de ser cierto. Habría que estudiar cómo cerrarlo (manual linking, la confirmación de correo) y no quedó
  comprobado.
- Rol `authenticated` con el claim `is_anonymous`: toda política futura que mire solo "tiene sesión" quedaría abierta
  para cualquiera. Hoy todas miran `members`, pero es una trampa a mantener para siempre.

**Lo que A daría y B no:** un id de persona estable (autoría firme, sacar a un visitante puntual, el tiempo real de
Supabase en el futuro). Con B, sacar a una persona puntual se hace con *Reset link* (como en Google Docs, donde "cualquiera
con el link" tampoco se saca de a uno), y la autoría es "el link + el nombre que escribió" (como los comentarios importados
de Coda, que ya existen sin cuenta). **Cómo se revierte P1:** la tabla de links sirve igual para A; si algún día se quiere
A, `link_open` ataría además el `auth.uid()` anónimo al link y las funciones `link_*` seguirían valiendo.

### 2.3 Lo averiguado del camino B

- **PostgREST** pone los headers del pedido en `request.headers` (JSON, nombres en minúsculas):
  `current_setting('request.headers', true)::json ->> 'x-shotdocs-link'`. Sin `Authorization`, el rol es el anónimo
  (`anon` en Supabase); la app ya llama así con la clave publicable (`probeWorkspace`).
- **Supabase Storage** también: su código (`src/internal/database/postgres/scope.ts`) hace
  `set_config('request.headers', $6, true)` con los headers del pedido antes de evaluar las políticas de
  `storage.objects`. Así una política del bucket `thumbs` para `anon` puede validar el token.
- **CORS:** el proyecto de Supabase acepta cualquier header pedido (ya se usa `x-shotdocs-version`, B.17). Una base
  autohospedada tiene que aceptar `x-shotdocs-link` y `x-shotdocs-device` (anotarlo en `Doc_Supabase.md` junto al otro).
- **Falta comprobarlo contra Wanka** (entrega 0): que los dos headers lleguen a una función y a una política de Storage
  del proyecto real con la clave publicable, sin sesión. Sin crear usuarios ni entrar con login: alcanza con `curl`.

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
  vuelva a copiar desde *Share* (como en Google Docs); solo lo devuelve `get_share_link()` a quien puede compartir esa
  página. Las copias de seguridad lo llevan (están cifradas).
- **Un link vivo por página** (índice único parcial). Cambiar el nivel o el vencimiento conserva el token; *Reset link*
  revoca el vivo y crea otro.
- Solo **páginas** en la primera entrega (P16). El de un proyecto entero (todas sus raíces) queda para la entrega 3.

### 3.2 Cómo viaja

- Al abrir la dirección, la app lee el `#link=`, guarda el link en el dispositivo (la lista de workspaces, como una
  entrada de tipo *link*, con su propio nombre de base local) y **borra el `#` de la barra** (`history.replaceState`):
  no queda en la pantalla, en una captura ni en el historial del navegador. Volver a abrir desde el mismo dispositivo usa
  lo guardado.
- **Un cliente de Supabase propio del modo link**, sin sesión, con dos headers fijos en cada pedido (a la base y a
  Storage): `x-shotdocs-link: <token>` y `x-shotdocs-device: <id del dispositivo>` (32 bytes al azar, creados la primera
  vez y guardados; la base guarda solo su huella: sirve para "este comentario es mío", nunca da permisos). Más el
  `x-shotdocs-version` de siempre.
- El token **nunca va en una dirección** que pida la app (ni en `?query`), así que no queda en registros de pedidos ni en
  un `Referer`. Al portero va en el mismo header.

### 3.3 Cuándo vale un link

`private.current_link()` (en cada pedido; una búsqueda por la huella):

- el header tiene la forma `^sdl_[A-Za-z0-9_-]{43}$` (si no, ni se calcula la huella);
- la huella existe, `revoked_at` es nulo, y `expires_at` es nulo o futuro;
- **quien lo creó todavía puede compartir esa página** (`can_share` evaluado para esa persona: nivel 4 y ser dueño, admin o
  dueño del proyecto; miembro activo, no invitado). Si lo sacan del workspace o le bajan el permiso, el link se apaga solo;
  si se lo devuelven, vuelve a andar (P6). Un dueño o admin puede crear uno nuevo (*Reset link*) y queda como creador.

### 3.4 El nivel del link sobre una página

`private.link_page_level(p)`: 2 (*Can view*: ver y comentar) o 3 (*Can edit*) si **la raíz del link está en la cadena
de `p` hacia arriba**, ni `p` ni ninguna de arriba está en la papelera y el proyecto no está borrado; si no, 0. Es la
misma recorrida por los padres que `user_page_level` (una sola pasada, PL/pgSQL): en el prototipo cuesta lo mismo que el
nivel de hoy (9,45 ms contra 9,39 ms en PGlite, en una hoja a 60 niveles; `user_page_level` mide ~2 ms en la base real).

- Mover una página adentro de la rama la suma al link en el acto; moverla afuera la saca (probado).
- La raíz del link en la papelera, o una de arriba: el link entero deja de andar (como un invitado, D21) y vuelve al
  restaurarla.
- **No se mezcla con los permisos de personas**: un visitante no tiene `members` ni `grants`; un miembro que abre el link
  sin sesión es un visitante más (3.14).

### 3.5 Qué ve el visitante

- **El árbol:** `link_tree()` devuelve la raíz (con `parent_id` nulo) y lo que cuelga de ella, sin lo que está en la
  papelera, con las mismas columnas que la app lee de `pages` (título, ícono, ajustes, orden, `update_seq`, `clean_seq`).
  La barra lateral muestra solo esa rama; el camino de arriba de la página empieza en la raíz.
- **Links internos** a páginas de afuera: no están en su árbol, así que se ven como hoy cualquier página sin acceso
  (sin título). Un link a una página de adentro anda.
- **El formato de hoja** se hereda por rama y se fija en las raíces del proyecto: `link_tree` devuelve en la raíz del link
  el formato efectivo (el que hereda), para que la página se vea y salga en PDF igual que para el equipo.
- **No se ven el nombre del workspace ni el del proyecto** (P10): arriba dice el título de la página compartida y un
  *Shared with a link* discreto. El selector de workspaces no aparece.
- **Los nombres del equipo** en los comentarios: la parte del correo antes de la `@` (`lega`), no el correo entero (P9).
  Lega decidió que un invitado ve los correos del equipo; un link puede reenviarse a cualquiera, así que se recomienda
  menos.
- **La ayuda y la recorrida** existen igual, con una entrada *Opened with a link* (qué puede hacer, que lo que escribe se
  guarda en este navegador y que el link puede dejar de andar).

### 3.6 El contenido: siempre la base limpia (D14)

- `link_pull_page(página, desde)` devuelve **la base limpia vigente** de la página (`private.current_clean_base`, la de
  D14) como una sola fila, nunca las filas de `page_updates`; sin base vigente, nada y la página dice *The editors
  haven't prepared this page for you yet…* (el mismo aviso de D14). "Al día" para el visitante es `clean_seq`.
- **Con el interruptor de D14 apagado no se puede crear un link** (`create_share_link` da `clean_off`, P5): con el
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
  suyos desde el mismo dispositivo (la huella de `x-shotdocs-device` guardada en el comentario).
- **El nombre:** la primera vez que comenta (o edita, con *Can edit*) la app le pide *Your name* (hasta 60 caracteres,
  sin controles ni marcas de dirección, las mismas que limpia el portero en los nombres de archivo) y lo guarda en el
  dispositivo para ese link (P8). Se puede cambiar; los comentarios ya hechos conservan el que tenían.
- **Cómo se muestra:** `Ana (via link)`, con un ícono de link y otro color; el sufijo no se puede sacar ni escribir en el
  nombre (así nadie del link se hace pasar por alguien del equipo). Al equipo, además, el detalle dice qué link
  (*Can view link, created by lega*).
- **En la base:** `comments.author_id` nulo (como los importados de Coda), `link_id`, `link_author` (el nombre) y
  `link_device_hash`. `list_comments` del equipo los devuelve con esos campos; la versión publicada los ignora y los
  muestra como de una cuenta borrada (ya pasa con los importados), así que se sube `min_app_version` con la entrega.
- **Moderar:** quien tiene 4 sobre la página los borra como cualquier comentario (`delete_comment`: hoy "quien lo
  escribió o quien tiene editar y crear"; un comentario sin `author_id` solo lo borra quien tiene 4). Para un spam
  masivo: *Reset link* corta los nuevos, y en *Share* un *Delete comments from this link…* (con confirmación) los marca
  borrados de una vez (nada se borra de la tabla: queda el texto, como siempre).
- **Topes:** 200 comentarios por link por día y 30 por dispositivo por hora (P11), y el largo de siempre (10 000).

### 3.8 Editar sin cuenta (*Can edit*)

- **Qué puede:** escribir en las páginas de la rama y subir o sacar fotos, videos y archivos (nivel 3). **No** crea,
  mueve, renombra ni manda páginas a la papelera (nivel 4), ni cambia el formato de la rama (P3): esos cambios van por las
  filas de `pages`, que el link no escribe.
- **La subida:** `link_push_page_update(página, client_update_id, update, versión, nombre)`, igual que
  `push_page_update` (la fila de la página bloqueada, el `seq` correlativo, idempotente por `client_update_id`, el tope
  de tamaño, la versión mínima), con el nivel del link. La fila guarda `created_by` nulo, `link_id` y `link_author`.
- **Sin red y offline-first:** el modo link usa el mismo motor (IndexedDB primero, la cola se vacía solo cuando la base
  confirma, reintentos idempotentes, "N por subir" a la vista), con una base local propia por link. Un navegador sin
  instalar puede perder lo guardado (Safari, a los 7 días sin uso): la app pide `navigator.storage.persist()` y lo dice
  en la ayuda, como a los invitados.
- **Si el link deja de andar con algo sin subir** (revocado, vencido, *Reset*): la base responde `link_not_found`; la app
  no borra nada, deja de reintentar a ciegas y muestra *This link no longer works. You have N unsent changes:*
  ***Download them*** (el mismo "bajar como archivo" de cuando sacan a alguien, `Plan_Workspaces.md`, sección 8). Si el
  dueño le manda el link nuevo, al abrirlo en el mismo dispositivo la app ofrece mandar lo pendiente con el nuevo **solo
  si es de la misma página** (la base lo vuelve a validar todo).
- **El historial (D13):** quien ve el historial ve las versiones del visitante como *Ana (via link)*; `page_history`
  devuelve `link_author` además de `created_by`. El visitante no ve el historial.
- **D14 con *Can edit*:** como el invitado con Editar: escribe sobre la última base; su cursor se adelanta a su propia
  fila y baja la base siguiente entera (`Doc_Privacidad_Borrado.md`, 4.3). Lo que él escribe y borra sí queda en sus
  filas, que ven los editores (como con cualquiera).
- **Topes:** 2000 subidas de contenido por link por día (una persona escribiendo un día entero sube unas 500 a 2000) y el
  tamaño de siempre por subida.

### 3.9 El portero y los archivos

- **Rutas que aceptan el link** (con `x-shotdocs-link` y sin `Authorization`): `POST /pass`, `POST /verify`,
  `POST /folder/list` (nivel 1) y, con *Can edit*, `POST /upload`, `PUT /upload/<id>`, `POST /folder/prepare` y
  `POST /folder/sessions` (nivel 3). **Nunca** las del dueño (`/drive/*` salvo `GET /drive/status`, `/trash`,
  `/project/*`).
- **Cómo pregunta:** como hoy con `media_file`, pero llamando a `link_media_file(archivo)` con la clave publicable (que el
  portero ya tiene) y el header del link reenviado. Devuelve lo mismo (proyecto, nombre, tipo, peso, Drive, nivel) con el
  nivel del link: el más alto de las páginas **vivas de la rama** que lo usan **sin `removed_at`** (las fotos sacadas no
  cuentan, D14), sin usos de otro proyecto. Sigue sin clave de la base.
- **El pase:** el mismo `/m/<pase>` firmado. Para un link vence a las **2 horas** (P17), no a las 8: revocar corta antes
  lo ya abierto. Un video de más de 2 horas abierto en el carrete pide otro pase al reanudar (la app ya pide pases nuevos
  al vencer).
- **La subida de un visitante:** el registro de la subida guarda `link:<id del link>:<huella del dispositivo>` donde hoy
  guarda la persona ("el que abrió la subida"). Al terminar, `link_set_file_drive` vuelve a validar el link: si se
  revocó mientras subía, el archivo queda en Drive y en la base sin `drive_id` confirmado, como una subida de alguien
  sacado (se ve en la papelera del portero; no se pierde).
- **Las miniaturas** (bucket `thumbs` de Supabase): una política para `anon` que lee el header
  (`private.link_file_level(<id del nombre>) >= 1` para leer, `>= 3` para subir la de un archivo nuevo).
- **Carpetas (P.9)** y ***Download all*** (D24): andan con los pases del listado; cada archivo listado cuenta como un pase
  para el tope.
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
| `can_share` | Crea, cambia y revoca links (P6), y el link vive mientras su creador lo siga teniendo. |
| Papelera (v0.102, D21) | Lo que está en la papelera no le llega; la raíz en la papelera apaga el link. |
| Privacidad de lo borrado (D14) | Siempre bases; crear el link reinicia; requiere el interruptor (P5). |
| Historial (D13) | No lo ve; sus ediciones aparecen con su nombre y *(via link)*. |
| Versión mínima (B.17) | Las escrituras `link_*` piden la versión (`p_app_version` y `x-shotdocs-version`) como las demás; `link_open` devuelve la mínima y la app se actualiza (v0.097) antes de escribir. |
| Compactar (B.9) | Nada: el link no recibe snapshots completos (solo bases). |
| Buscar y reemplazar en el proyecto (P.12) | Buscar, sí, en lo que tiene el dispositivo; reemplazar en todo, no (es de quien edita el proyecto; con *Can edit*, el reemplazo en la página sí). |
| *Available offline* (P.10) | Con *Can edit*, sí (marca la rama para usarla sin red, con los pases del link); con *Can view*, también, contra los topes. |
| Tiempo real (D-04, a futuro) | Un canal en vivo nunca para el link (lleva lo borrado, D14). |
| Asistente y MCP (fase 5) | El asistente del visitante no existe (no hay cuenta ni clave); el MCP no acepta links. |

### 3.11 *Share*: crear, cambiar, revocar

En *Share* de una página, debajo de las personas, una sección **General access** (los textos en inglés, con su
traducción en `src/i18n/`):

- *Restricted — Only people with access can open* (lo de hoy) o *Anyone with the link* con *Can view* / *Can edit*. Al
  prenderlo: la línea de D14 (*They'll get the page as it is when the editors' apps refresh it…*), *Preparing N pages for
  the link…* y el link copiado (*Link copied*).
- **Copy link**, **Reset link** (confirmación: *The current link will stop working for everyone who has it.*) y
  **Expires**: *Never* (por defecto), *In 1 day*, *In 7 days*, *In 30 days*, una fecha (P7).
- **Uso de hoy:** *Opened 12 times today · 3 comments* y, si llegó a un tope, *Daily limit reached: new visits are paused
  until tomorrow*, con *Reset link*.
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
  ~3,7 × 10^57 años: no hace falta limitar intentos para eso. Lo que sí se limita es el uso de un link válido (3.13).
  La app no tiene un límite por IP que pueda configurar en la API de Supabase; un pedido con un token falso cuesta una
  búsqueda por índice (2 ms en el prototipo).

### 3.13 Abuso y plan gratis

**Lo medido en Wanka** (solo lectura, 2026-10-02; `res_ro_stats.txt`): 1923 miniaturas, 28 KB de promedio (mediana
26 KB, p95 49 KB, máximo 77 KB); 487 páginas con archivos, mediana 1 por página, p95 27, máximo 100; contenido por página
(todas las filas) mediana 7,4 KB, p95 64 KB, máximo 2 MB (una tabla importada); originales de fotos 2,45 MB de promedio.

| Recurso (plan gratis) | Qué gasta una visita | Cuánto alcanza | Qué pasa si se agota |
|---|---|---|---|
| Egress de Supabase: 5 GB por mes (más 5 GB cacheado) | Contenido + miniaturas de lo que abre: página típica ~35 KB; pesada (p95) ~0,8 MB | ~6000 visitas pesadas o ~140 000 típicas por mes | Aviso y período de gracia; después, restricciones **para todo el workspace** |
| Pedidos de Workers: 100 000 por día **por cuenta** (el portero; la app es estática y no cuenta) | Con la imagen nítida de hoy, un `/pass` y un `/m/` por foto (54 en una página de 27 fotos); con el modo liviano (P12), solo lo que se abre en el carrete o se baja | ~1800 visitas pesadas por día sin el modo liviano | Error 1027: **el portero deja de andar para todo el equipo** hasta las 0 UTC |
| CPU de Workers: 10 ms por pedido | Un pase o un listado de carpeta | Igual que hoy | — |
| Drive del dueño | Bajar originales: sin costo; **subir** (*Can edit*): ocupa su Drive (15 GB gratis) | — | `drive_full` para todos |
| MAU de Supabase: 50 000 | Nada (no hay cuentas) | — | — |
| Base (CPU del plan Nano) | `link_tree` cada ciclo | Un ciclo cada 30 s del visitante (P12) | Lentitud para todos |

**Los topes** (P11), contados en la base por link y por día (`share_link_usage`), ajustables en
`workspace_settings.link_limits`:

| Qué | Tope por link y día | Por qué ese número |
|---|---|---|
| Aperturas (`link_open`) | 300 | Un equipo de rodaje o un cliente abren decenas; 300 son ~240 MB de egress en páginas pesadas |
| Pases del portero | 3000 | ~100 visitas a una página pesada; todos los links juntos, 20 000 (un 20 % de los pedidos de Workers del día) |
| Comentarios | 200 (y 30 por dispositivo por hora) | Un cliente activo deja decenas |
| Subidas de contenido | 2000 | Un día entero de escritura de una persona |
| Archivos subidos | 1 GB por día, hasta 500 MB por archivo | Un par de videos del celular |

- Al pasar un tope, la función da `link_rate_limited` y la app dice *This link has been used a lot today. Try again
  tomorrow, or ask for a new link.* Nada se pierde (lo de un *Can edit* queda en su cola). En *Share*, el contador.
- **Las lecturas no se cuentan una por una** (contar escribiría en cada lectura); las acota el tope de aperturas y el ciclo
  más lento del modo liviano (P12): el visitante baja **solo lo que abre** (la página y sus miniaturas), no la rama
  entera; un ciclo cada 30 s, parado con la pestaña oculta; *Available offline* baja la rama a pedido.
- **Si un link se viraliza:** a las 300 aperturas del día se corta solo; el dueño ve el contador y hace *Reset link*. Lo
  peor posible con un solo link en un día: ~240 MB de egress y 3000 pedidos al portero (lo que el equipo usa en un rato).
  Lo que no se puede cortar: alguien con el link que repite pedidos de lectura a mano (sin la app) hasta que se revoca.
  El *rate limiting* de Workers es aproximado y por ubicación (documentación de Cloudflare): no sirve como contador, a lo
  sumo como freno extra en el portero (no se propone en la entrega 1).

### 3.14 Un miembro con sesión que abre un link

Si el navegador tiene una sesión en ese workspace y **su cuenta ve la página**, la app la abre con la cuenta (con sus
permisos, que pueden ser más) y no guarda el link (P14). Si su cuenta no la ve (o no tiene sesión), abre el modo link en
su propia base local, **sin cerrar la sesión**: es otra entrada en la lista del dispositivo, y volver al workspace es
elegirlo en el selector (recarga, como cambiar de workspace).

### 3.15 Versiones viejas de la app

- **Una versión vieja que abre un `#link=`:** solo pasa en los dispositivos de quien ya usaba la app (un visitante nuevo
  baja la versión publicada). La versión de hoy solo lee `#invite=` (`src/invite.ts`): con `#link=` abre como siempre
  (el login o el último workspace) y no hace nada con el link; al actualizarse (v0.097), lo abre. No se pierde nada.
- **El servidor:** todas las funciones son nuevas; las de hoy no cambian de firma. `list_comments` y `page_history` suman
  columnas al final (la versión publicada las ignora: un comentario del link se vería como de una cuenta borrada), así
  que con cada entrega se sube `min_app_version`.
- **El modo link en una versión anterior a la mínima:** `link_open` devuelve la mínima; la app se actualiza antes de
  escribir, y las escrituras `link_*` rechazan con `app_outdated` (503) sin escribir nada, como las demás.

## 4. Migración (borrador, sin aplicar)

Va como `supabase/migrations/<fecha>_link_publico.sql`, con `supabase/tests/link_publico_permisos.sql`, en la entrega 1
(la escritura de contenido, en la 2). Necesita `pgcrypto` (`extensions.gen_random_bytes`, `extensions.digest`), que
Supabase ya trae.

```sql
-- Link público (P.19; Docs/Doc_Link_Publico.md). Un link da a quien lo tiene, sin cuenta, Comentar (Can view) o Editar
-- (Can edit) sobre una página y lo de abajo. El token viaja en el header x-shotdocs-link con el rol anon y se valida en
-- cada pedido. Nada se borra: un link revocado queda con revoked_at.

-- 1. Links, uso por día y los topes.
create table public.share_links (
  id          uuid primary key,                                    -- lo crea el dispositivo (reintentar no duplica)
  page_id     uuid not null references public.pages (id),
  token       text not null unique check (token ~ '^sdl_[A-Za-z0-9_-]{43}$'),
  token_hash  bytea not null unique check (octet_length(token_hash) = 32),
  level       text not null check (level in ('comment', 'edit')),
  created_by  uuid references auth.users (id) on delete set null,  -- nulo: el link no anda
  created_at  timestamptz not null default now(),
  expires_at  timestamptz check (expires_at is null or expires_at > created_at),
  revoked_at  timestamptz,
  revoked_by  uuid references auth.users (id) on delete set null
);
create unique index share_links_one_live on public.share_links (page_id) where revoked_at is null;
alter table public.share_links enable row level security;
revoke all on public.share_links from public, anon, authenticated;     -- todo por funciones

create table public.share_link_usage (
  link_id uuid not null references public.share_links (id),
  day     date not null,
  kind    text not null check (kind in ('open', 'pass', 'comment', 'push', 'upload_bytes')),
  n       bigint not null default 0,
  primary key (link_id, day, kind)
);
alter table public.share_link_usage enable row level security;
revoke all on public.share_link_usage from public, anon, authenticated;

alter table public.workspace_settings add column link_limits jsonb not null default
  '{"open": 300, "pass": 3000, "comment": 200, "push": 2000, "upload_bytes": 1073741824, "all_pass": 20000}';

-- Autoría sin cuenta (como los comentarios importados): created_by / author_id quedan nulos.
alter table public.page_updates add column link_id uuid references public.share_links (id),
                                add column link_author text check (char_length(link_author) between 1 and 60);
alter table public.comments add column link_id uuid references public.share_links (id),
                            add column link_author text check (char_length(link_author) between 1 and 60),
                            add column link_device_hash bytea check (octet_length(link_device_hash) = 32),
                            add constraint comments_link check ((link_id is null) = (link_author is null));
alter table public.files add column link_id uuid references public.share_links (id);

-- 2. El link del pedido.
create function private.link_token() returns text language sql stable set search_path = '' as $$
  select t from (select current_setting('request.headers', true)::json ->> 'x-shotdocs-link' as t) s
  where t ~ '^sdl_[A-Za-z0-9_-]{43}$';
$$;
create function private.current_link() returns public.share_links
language sql stable security definer set search_path = '' as $$
  select l.* from public.share_links l
  where l.token_hash = extensions.digest(private.link_token(), 'sha256')
    and l.revoked_at is null and (l.expires_at is null or l.expires_at > now())
    and l.created_by is not null and private.user_can_share_page(l.page_id, l.created_by);  -- can_share para esa persona
$$;
create function private.link_page_level(p uuid) returns int ...;   -- 3.4: 2 o 3 si la raíz está en la cadena, sin papelera
create function private.link_file_level(f uuid) returns int ...;   -- el más alto de las páginas vivas de la rama que lo
                                                                     -- usan sin removed_at y sin is_foreign
create function private.link_count(p_kind text, p_n bigint default 1) returns void ...;
  -- volátil: upsert en share_link_usage (link y día); si pasa el tope de link_limits, raise 'link_rate_limited' (P0001)
-- revoke all de public, anon, authenticated en todas las de private.

-- 3. Lo que llama el visitante (rol anon). Ninguna tabla se abre a anon.
create function public.link_open(p_app_version text) returns json ...;
  -- cuenta 'open'; {page, level, min_app_version, schema_version, format, limits_reached} o 'link_not_found' (P0002)
create function public.link_tree() returns table (...) ...;            -- 3.5; la raíz con parent_id nulo
create function public.link_pull_page(p_page_id uuid, p_after_seq bigint) returns table (seq bigint, update text) ...;
  -- 3.6: solo private.current_clean_base(p), con link_page_level >= 1; nunca page_updates
create function public.link_list_comments(p_page_id uuid, p_since timestamptz) returns table (...) ...;
  -- como list_comments: autores del equipo por la parte antes de la @, los del link por link_author, `mine` por la
  -- huella de x-shotdocs-device
create function public.link_add_comment(...) returns text ...;          -- 3.7; cuenta 'comment'; nunca resuelve
create function public.link_edit_comment(...) ...; create function public.link_delete_comment(...) ...;  -- solo los suyos
create function public.link_media_file(p_file uuid) returns json ...;   -- para el portero; cuenta 'pass'
-- Entrega 2 (Can edit): link_push_page_update, link_register_file, link_link_page_file, link_unlink_page_file,
-- link_set_file_drive, link_set_file_thumb (cuentan 'push' y 'upload_bytes'; piden versión mínima).
-- revoke de public y authenticated, grant execute a anon.

-- 4. Lo que llama quien comparte (authenticated, can_share).
create function public.create_share_link(p_id uuid, p_page uuid, p_level text, p_expires timestamptz) returns json ...;
  -- pide can_share y el interruptor de D14 (si no: 'clean_off'); genera el token con gen_random_bytes(32); reinicia la
  -- rama (clean_reset_seq = update_seq, clean_seq = 0); idempotente por p_id; devuelve {token, level, expires_at}
create function public.set_share_link(p_page uuid, p_level text, p_expires timestamptz) ...;  -- conserva el token
create function public.reset_share_link(p_page uuid) returns json ...;   -- revoca el vivo y crea otro
create function public.revoke_share_link(p_page uuid) ...;
create function public.get_share_link(p_page uuid) returns json ...;
  -- el link de la página o el de una de arriba (con su página), y el uso de hoy; el token solo si es de esta página
create function public.delete_link_comments(p_link uuid) returns int ...;   -- pide 4 sobre la raíz; marca deleted_at

-- 5. Lo que cambia de lo que ya existe.
--   private.has_plain_readers(p): or exists (un link vivo cuya raíz está en la cadena de p).
--   clean_work: las raíces de los links vivos entran en `reach`.
--   pages_permissions(): mover una página a una rama con link vivo reinicia su base (como con lectores).
--   page_history y list_comments: suman link_author (y link_id) al final.
--   Storage, bucket thumbs: políticas para anon con private.link_file_level(...) >= 1 (leer) y >= 3 (subir).
update public.workspace_settings set schema_version = <la que siga> where id and schema_version < <la que siga>;
notify pgrst, 'reload schema';
```

## 5. Cambios en la app y el portero

| Dónde | Entrega | Qué |
|---|---|---|
| `public/_headers`, `public/robots.txt` | 0 | `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy`, `Disallow: /` |
| `src/invite.ts`, `src/workspaces.ts` | 1 | Leer `#link=`; la entrada de tipo *link* en la lista del dispositivo (con su base local `shotdocs-link:<clave local>:<id del link>`); borrar el `#` de la barra |
| `src/sync/remote.ts` | 1 | `LinkRemote`: las mismas operaciones que usa el motor, sobre `link_*`, con el cliente sin sesión y los headers |
| `src/sync/engine.ts` | 1 | Modo liviano: bajar solo lo abierto, ciclo de 30 s, parado con la pestaña oculta; `serverSeqFor` = `clean_seq` |
| `src/ui/ShareDialog.tsx` (+ `shareGate.tsx`) | 1 | *General access* (3.11) |
| La página y la barra | 1 | Solo la rama, sin nombres de workspace ni proyecto, *Shared with a link* |
| Comentarios | 1 | *Your name*, *(via link)*, `mine`, sin resolver |
| `src/media/portero.ts` | 1 | Pases con el header; sin imagen nítida automática en modo link |
| `portero/src/core.ts` | 1 (ver) y 2 (subir) | Las rutas de 3.9 con `link_media_file`; pase de 2 horas; CORS con `x-shotdocs-link` y `x-shotdocs-device` |
| La cola sin red | 2 | `link_not_found` con algo sin subir: *Download them* |
| Historial | 2 | *Ana (via link)* |
| Ayuda (`src/help/entries.ts`, `src/i18n/lazy/help.ts`) | 1 y 2 | *Share with a link*, *Opened with a link* |
| `src/sync/testing.ts` | 1 | El servidor en memoria con links, el header y los topes |
| `Doc_Supabase.md`, `Doc_Portero.md`, `Doc_Sincronizacion.md`, `Plan_Workspaces.md` (sección 4) | 1 y 2 | Al implementar |

## 6. Pruebas

1. **Permisos en SQL** (`supabase/tests/link_publico_permisos.sql`, en `begin … rollback` con un script propio, nunca
   `npm run db:test`; los headers con `set_config('request.headers', …)` y `set role anon`), los casos del prototipo P1
   más: cada función `link_*` con el link de otra página, de otro proyecto, vencido, revocado, reemplazado, con el creador
   sin `can_share`, sacado o invitado, sin header, con el token en mayúsculas o con espacios, y con una página de la rama
   en la papelera; `link_pull_page` **nunca** devuelve bytes de `page_updates` (con y sin base vigente) ni con el
   interruptor apagado; `link_tree` no trae nada de arriba ni del costado (ni ids); `link_media_file` y la política de
   `thumbs` no dan una foto sacada (`removed_at`), de otro proyecto (`is_foreign`) ni de una página de la papelera; `anon`
   no lee ninguna tabla (`pages`, `page_updates`, `comments`, `files`, `page_files`, `share_links`, `share_link_usage`,
   `workspace_settings`) ni llama a las funciones de siempre (`pull_page_updates`, `list_comments`, `media_file`,
   `share`…); `create_share_link` rechazado sin `can_share`, a un invitado, con el interruptor apagado y en una página de
   la papelera; *Reset* invalida el viejo; los topes (el 301.º `link_open` da `link_rate_limited`, también con dos links
   de la misma página); los comentarios del link: no resuelven, no editan ni borran los de otros, sí los suyos con la
   misma huella de dispositivo y no con otra; quien tiene 4 los borra; las funciones de siempre siguen iguales para las
   cuentas (las pruebas de `supabase/tests/` pasan). **Mutantes:** los siete de P1, más `link_pull_page` que sirve filas,
   `link_file_level` sin `removed_at`, `current_link` sin el creador, `link_tree` que trae el padre de la raíz, la
   política de `thumbs` sin el header y `link_count` que no corta.
2. **El servidor en memoria** (`src/sync/testing.ts`) y pruebas del motor en modo link: abrir, bajar solo lo abierto,
   "en preparación", el reinicio al crear el link, *Can edit* sin red (la cola, la reconexión, el link revocado con algo
   sin subir: nada se borra y se puede bajar), dos dispositivos con el mismo link, el invariante de D14 (lo que recibe el
   visitante estuvo visible en alguna base: P7 de `Doc_Privacidad_Borrado.md` con un lector por link).
3. **El portero** (`portero/src/core.test.ts`, con Supabase simulado): cada ruta con el header (las del dueño lo
   rechazan), el pase de 2 horas, la subida atada al link y a la huella, el link revocado a mitad de una subida.
4. **Recorridos en Chromium sin login** (el modo link no tiene login): un arnés local con la app real sobre el servidor en
   memoria: abrir el link, el árbol solo de la rama, el camino de arriba desde la raíz, un link interno a una página de
   afuera sin título, comentar con nombre, *Can edit* escribe y sube una foto sin red y con red, *Reset link* desde otra
   pestaña y lo que ve el visitante, el `#` borrado de la barra.
5. **De punta a punta contra la base real** (lista para Lega o para quien publica): crear el link con la cuenta del dueño;
   abrirlo en una ventana de incógnito (sin cuenta, sin código); revisar en *Network* que ninguna respuesta tiene un
   texto borrado ni una página de afuera, que la dirección de la barra no tiene el token, y que *Reset link* corta en el
   próximo ciclo.

## 7. Entregas

| | Qué | Pruebas | Riesgo |
|---|---|---|---|
| **0** | La prueba técnica en la base real, sin usuarios ni login: una función y una política de prueba (que se sacan al terminar) para ver con `curl` y la clave publicable que `x-shotdocs-link` llega a `request.headers` en una RPC y en una política de Storage; medir `link_page_level` y `link_tree` con `explain analyze` en `begin … rollback`. Y `noindex` (`_headers`, `robots.txt`) | La respuesta de `curl` con y sin header; tiempos | Bajo |
| **1** | *Can view* completo: la migración (links, lectura, comentarios, archivos, topes), *Share*, el modo link (solo lectura con comentarios), el portero para ver. Requiere el interruptor de D14 prendido en Wanka | 1 a 5 | **Alto**: abre un camino sin cuenta a la base |
| **2** | *Can edit*: escribir, subir archivos, la cola sin red y el link revocado, el historial | 1 a 5 (las de escritura) | **Alto**: escrituras sin cuenta, el Drive del dueño |
| **3** | Medir el uso real (egress del mes, `share_link_usage`) y ajustar los topes; el link de un proyecto entero (P16) | — | Medio |

Antes de cerrar cada entrega, la auditoría independiente de siempre (funcionalidad, permisos y RLS, no perder datos,
documentación y las reglas del repo).

## 8. Riesgos

| Riesgo | Qué lo cubre |
|---|---|
| Un error en una función `link_*` da algo de arriba o del costado | Una sola función de nivel (`link_page_level`) que todas usan; ninguna tabla abierta a `anon`; pruebas negativas con mutantes |
| Lo borrado llega al visitante | Solo bases (D14), con el interruptor como requisito; `link_pull_page` nunca lee `page_updates` (mutante) |
| El link se reenvía o se publica | *Reset link* instantáneo; contador en *Share*; topes; `noindex`; la ayuda dice que no es para material sensible (`Plan_Workspaces.md`, sección 4) |
| Un link viral deja sin portero o sin egress al equipo | Topes por link y del total de links (P11), modo liviano (P12) |
| Spam de comentarios | Topes por link y por dispositivo, *Delete comments from this link*, *Reset link* |
| Un visitante con *Can edit* llena el Drive o borra contenido | Tope de bytes; borrar contenido es una edición: el historial la restaura (D13) |
| Alguien se hace pasar por el equipo | El nombre lleva siempre *(via link)*; el equipo ve qué link |
| Lo escrito por un visitante se pierde al revocar | Nada se borra del dispositivo; *Download them* |
| El token queda en el dispositivo del visitante | Igual que una sesión; revocar lo corta |
| Los registros de la API de Supabase guardan el header | A confirmar en la entrega 0 (qué headers guardan los *API logs*); si lo guardan, solo lo ve el dueño del proyecto, y revocar lo vuelve inútil |
| Un pase ya dado sigue abriendo el archivo | 2 horas para el link (P17) |
| Una versión vieja escribe mal | `min_app_version` con cada entrega; las escrituras `link_*` la piden |

## 9. Propuestas de decisión

| # | Propuesta | Recomendación | Por qué | Cómo se revierte |
|---|---|---|---|---|
| **P1** | Cómo entra sin cuenta | **Token del link validado por la base en cada pedido** (camino B), no sesiones anónimas | Con el registro cerrado los anónimos no andan; abrirlo pide el hook y cambia Auth para todo el proyecto; sin MAU ni cuentas que limpiar | La tabla de links sirve para A: `link_open` ataría el uid anónimo |
| **P2** | *Can view* | **Ver, bajar y comentar** (nivel 2), responder; sin resolver hilos ni borrar los de otros | Es lo que pidió Lega ("siempre puede comentar"); resolver es del equipo | Dejarlo resolver: una condición en `link_add_comment`/`resolve` |
| **P3** | *Can edit* | **Editar** (nivel 3): contenido y archivos; **no** crea, mueve, renombra ni borra páginas | Cambiar el árbol sin cuenta es lo más fácil de romper y lo más difícil de deshacer | Sumar nivel 4 al link (*Can edit and create pages*) |
| **P4** | Privacidad | **Como un invitado:** base limpia (D14), sin historial (D13), sin papelera (D21) | Un link se reenvía: nunca más que un invitado | — |
| **P5** | Interruptor de D14 | **No se crea un link con el interruptor apagado** | Sin bases no hay qué servir sin mandar lo borrado | Ninguno seguro: servir filas al link filtraría lo borrado |
| **P6** | Quién lo crea | **Quien hoy puede compartir** (`can_share`); el link anda mientras su creador lo siga pudiendo | Mismo criterio que compartir con personas; un empleado que se va no deja links vivos | Que dueño y admins "adopten" los links al sacar a alguien |
| **P7** | Vencimiento | **Opcional, *Never* por defecto**, con 1, 7, 30 días o una fecha | Un documento de rodaje se usa semanas; el corte rápido es *Reset* | Cambiar el valor por defecto en *Share* |
| **P8** | Nombre del visitante | **Lo pide al comentar o editar por primera vez**, guardado en el dispositivo, mostrado con *(via link)* | No frena a quien solo mira; el sufijo evita hacerse pasar por el equipo | Pedirlo al entrar |
| **P9** | Qué ve del equipo | **El nombre antes de la @**, no el correo entero | Un link puede llegar a cualquiera (a un invitado Lega le muestra los correos) | Mostrar el correo, como a los invitados |
| **P10** | Nombres del workspace y del proyecto | **No se muestran**; solo el título de la página compartida | "Nunca lo de arriba" vale también para los nombres | Mostrarlos |
| **P11** | Topes | **Por link y día:** 300 aperturas, 3000 pases (20 000 todos los links), 200 comentarios (30 por dispositivo y hora), 2000 subidas, 1 GB de archivos (500 MB por archivo); ajustables por workspace | Medido: con eso un link no puede agotar el portero ni el egress del mes en un día | Cambiar `workspace_settings.link_limits` |
| **P12** | Modo liviano | **El visitante baja solo lo que abre**, sin imagen nítida automática; ciclo de 30 s, parado oculto | Una visita gasta lo que abre, no la rama entera (que puede tener cientos de páginas) ni cada original | Modo completo como un invitado |
| **P13** | Buscadores | **`noindex` para toda la app** y `robots.txt` cerrado; `Referrer-Policy` explícito | La app no tiene nada que indexar; no hay landing pública | Sacar las líneas de `_headers` |
| **P14** | Miembro con sesión que abre un link | **Si su cuenta ve la página, entra con la cuenta**; si no, modo link aparte sin cerrar la sesión | No mezcla permisos; no desloguea | Abrir siempre en modo link |
| **P15** | Archivos subidos por un visitante | **Van al Drive del dueño** como los del equipo (`files.link_id`), con los topes de P11 | Es lo que pide *Can edit*; el dueño los ve y los puede mandar a la papelera | Que *Can edit* por link no suba archivos |
| **P16** | Alcance | **Solo páginas** en la entrega 1; un proyecto entero, en la 3 | Una página (con su rama) es el caso del pedido | Sumarlo antes |
| **P17** | Pases del portero para el link | **2 horas** (8 para las cuentas) | Revocar corta antes lo ya abierto | Volver a 8 |

## 10. Lo que solo Lega puede hacer o decidir

- **Decidir P1 a P17** (sobre todo P1, P3, P7 y P11).
- **Nada en el panel de Supabase Auth, de Google ni de DNS** si se elige P1: es su ventaja. Con el camino A haría falta,
  en este orden: conectar y probar el hook de invitaciones, cambiarlo para los anónimos, abrir el registro, prender los
  anónimos y crear un Turnstile (Cloudflare) para el captcha.
- **Prender el interruptor de D14 en Wanka** (con el cambio del script de restaurar del repo privado de copias, la
  versión mínima y la copia de seguridad): requisito de la entrega 1. Lo prepara quien publica; la copia la corre la tarea
  de GitHub.
- **La prueba de punta a punta** con su cuenta (crear el link) y una ventana de incógnito (abrirlo), y probarlo en el
  iPhone sin la app instalada.

## 11. Lo que no se pudo comprobar

- Que `x-shotdocs-link` llegue a `request.headers` **en el proyecto real** (PostgREST y Storage lo documentan y el código
  de Storage lo hace; falta el `curl` de la entrega 0, que necesita una función y una política de prueba en la base).
- Qué headers guardan los registros de la API de Supabase (*API Gateway logs*).
- Los tiempos en la base real: el prototipo corre en PGlite (Postgres 18 compilado a WebAssembly), unas 4 a 5 veces más
  lento que el `user_page_level` medido en Supabase; las cifras de arriba son relativas.
- Cómo se comporta el modo link en el iPhone sin instalar (Safari, 7 días sin uso).
- Si una cuenta anónima convertida con `updateUser({ email })` saltea el registro cerrado (camino A, descartado).
- El egress real de un cliente y cuántas veces se abre un link en un rodaje (entrega 3).

## Cómo se midió

Prototipos fuera del repo, en la carpeta de trabajo de la sesión (`link-publico/`), con sus resultados en `res_*.txt`.
No se creó ningún usuario, no se entró con login ni se tocó la configuración de Auth.

- **P1, permisos** (`p1_permisos.mjs`, PGlite 0.5.8 = Postgres 18.3 en memoria): un esquema reducido (`workspaces`,
  `members`, `grants`, `pages`, `share_links`, `share_link_usage`), las funciones de 3.3 y 3.4, `link_tree` y
  `link_open` con su tope, el rol `anon` y los headers puestos con `set_config('request.headers', …)`. 36 casos: 36 bien.
  **Mutantes** (`MUT=…`, `res_p1_mutantes.txt`): sin mirar la cadena hacia arriba (5 fallas), sin la papelera (3), sin el
  creador (3), sin el vencimiento (1), sin revocar (2), el árbol con la papelera (2); sin el chequeo de formato no falla
  ninguna (es una defensa de más: la huella igual rechaza). **Tiempos** (en PGlite): `current_link` 2,0 ms;
  `link_page_level` de una hoja a 60 niveles 9,45 ms (el `user_page_level` de hoy, en el mismo PGlite, 9,39 ms; en la base
  real, ~2 ms); de una página de afuera 2,6 ms; `link_tree` con 1990 páginas 182 ms.
- **Uso real** (`ro_stats.mjs`, solo lectura con el cliente de la Management API en modo `dryRun` y `readQuery`; no se
  imprimió contenido): tamaños de `storage.objects` del bucket `thumbs`, archivos por página en `page_files`, tipos y
  pesos de `files`, bytes de `page_updates` por página.
- **Documentación y código consultados (2026-10-02):** Supabase Auth `internal/api/anonymous.go` (el corte por
  `DisableSignup` y el hook), *Anonymous Sign-Ins* (rol, `is_anonymous`, 30 por hora por IP, captcha, sin limpieza),
  *Monthly Active Users* (50 000 gratis), *Egress* (5 GB + 5 GB cacheado), PostgREST *Transactions* (`request.headers`,
  rol anónimo), Supabase Storage `src/internal/database/postgres/scope.ts` (`set_config('request.headers', …)`),
  Cloudflare Workers *Limits* (100 000 pedidos por día, Error 1027, 10 ms de CPU) y *Rate Limiting* (aproximado, por
  ubicación).
