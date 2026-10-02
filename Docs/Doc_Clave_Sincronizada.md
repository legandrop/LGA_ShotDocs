# La clave del asistente en todos tus dispositivos (D72 → B)

**Estado: entregas S1 (v0.138) y S2 (v0.0XX) implementadas; ver "Cómo quedó S1" y "Cómo quedó S2", al final. S2 no
tiene migración** (roadmap P.24; pedido de Lega del 2026-10-02, que cambió D72 de A a B: "la clave
sincronizada entre tus dispositivos, cifrada con una frase que solo sabés vos"). Reemplaza la parte de IA1 de
`Doc_Asistente.md` que decía "se carga una vez por dispositivo"; todo lo demás de la sección 4 de ese documento (la
clave local, *Forget key*, la casilla al salir) sigue igual. Diseñado contra `main` v0.129. Las decisiones CS1 a CS9
(sección 14) están decididas (Lega pidió no preguntar; quedan en su lista para cambiarlas si quiere). Los tiempos están medidos en esta PC (sección
4.1 y "Cómo se midió"); los del iPhone son estimados y se miden en la entrega S1.

## En corto

- **Qué cambia para la persona.** Carga su clave una vez (por ejemplo en la PC del estudio), toca *Sync across my
  devices* y guarda la frase que le da la app en su gestor de contraseñas. Al otro día, en el iPhone, *Assistant…* le
  dice *Your key is synced. Enter your passphrase to use it on this device.*; pega la frase y listo. Sin la frase, nadie más puede
  usar la copia: ni el dueño del workspace, ni quien robe la base, ni Lega.
- **Dónde vive la copia (CS1, CS2):** en una tabla propia, `assistant_key_sync`, del Supabase **del workspace donde la
  persona prende la sincronización** (uno alcanza: en el dispositivo la clave es por correo y sirve para todos los
  workspaces). Una fila por persona; con Row Level Security la lee y la cambia solo ella, y nunca un token de un cliente
  MCP. El dueño de ese Supabase **ve la fila** (es su base): ve que existe, cuándo cambió y un bloque cifrado de largo
  fijo. Nada más: ni el proveedor, ni la dirección, ni la clave.
- **Cómo se cifra (CS3):** todo en el dispositivo, con WebCrypto. De la frase sale una llave con **PBKDF2-SHA256 de
  1 000 000 de vueltas** y una sal al azar; con esa llave, **AES-256-GCM** cifra proveedor, dirección, modelo y clave,
  rellenos a 1 KB. La cabecera (versión, sal, id de la persona) va atada al cifrado: si alguien la toca, no abre. La
  frase nunca sale del dispositivo ni se guarda. Medido: 0,1 s en Chromium en esta PC; estimado en el iPhone, 0,2 a
  0,5 s, una vez por dispositivo.
- **La frase (CS4):** la propone la app, **seis palabras al azar** de la lista corta de la EFF (unos 62 bits). Con una
  placa de video de las mejores, adivinarla llevaría millones de años. Se puede usar una propia de 20 caracteres o más,
  con el aviso de que una frase pensada por una persona es mucho más débil.
- **Frase olvidada:** no hay forma de recuperarla (es lo que la hace segura). Se vuelve a pegar la clave y se elige una
  frase nueva; los dispositivos que ya la tenían siguen andando.
- **Lo que no protege, dicho claro:** la copia **en cada dispositivo** queda como hoy (cifrada con la llave del
  dispositivo, sin frase): quien use ese navegador con la sesión abierta, o un script dentro de la app, la puede usar.
  Y ese dispositivo probablemente también tenga **la frase** en su gestor de contraseñas. Si se pierde un dispositivo,
  el orden es: **cerrar la sesión de los otros dispositivos** (*Sign out other devices*, nuevo en S1), **una frase
  nueva**, **una clave nueva en el proveedor** y recién ahí actualizar la copia (sección 3). Sin los dos primeros pasos,
  la sincronización le entregaría la clave nueva al dispositivo perdido. Y una frase que se filtra no se "des-filtra":
  las copias de seguridad del dueño guardan la versión vieja cifrada; por eso, ante la duda, se cambia la clave en el
  proveedor.
- **Una copia que cambia a dónde va la clave no se adopta en silencio** (S1): al abrirla, la app muestra el proveedor,
  el host y los últimos cuatro caracteres de la clave, y si el destino no es el que el dispositivo ya usaba, pregunta
  *Your synced key now goes to <host>. Use it?*. Así quien tenga la sesión y la frase no puede desviar el texto de las
  páginas a un servidor suyo sin que se vea.
- **Entregas:** S1 (prender, desbloquear y dejar de sincronizar) y S2 (mantener al día entre dispositivos, cambiar la
  frase, *Keep the key on this device*, varios workspaces). Sin tipos de bloque nuevos, sin tocar el editor, sin subir
  `min_app_version`.

## Reglas que no se rompen

1. **La frase y la clave en claro nunca salen del dispositivo.** Al Supabase llega solo el bloque cifrado. Nunca en un
   log, un error, la consola, la URL, la cola de sincronización, `localStorage`, un reporte ni el export.
2. **Cada workspace es una isla.** La copia vive en el Supabase de un workspace que la persona eligió; nada pasa por el
   portero, por servidores de Lega ni de un workspace a otro por un servidor. Si la persona quiere la copia en dos
   workspaces, la sube su dispositivo a cada uno.
3. **Los parámetros del cifrado los fija la app, nunca el servidor.** La fila dice solo la versión del formato; la app
   conoce de memoria qué vueltas y qué algoritmo corresponden a cada versión y rechaza cualquier otra. Así un dueño
   malicioso no puede "bajar" la protección.
4. **Lo que dice a dónde va la clave (proveedor y dirección) viaja cifrado.** Si fuera en claro, el dueño de la base
   podría cambiar la dirección a un servidor suyo y la app le mandaría la clave.
5. **Nunca se pierde la clave local por la sincronización.** Desbloquear, actualizar o dejar de sincronizar no borran
   la clave que el dispositivo ya tenía, salvo que la persona lo pida (*Forget key*).
6. **Nunca se adopta en silencio un destino nuevo.** Un sobre válido lo puede armar cualquiera que sepa la frase (el
   cifrado autenticado prueba que lo armó alguien con la frase, no que lo armó la persona): si cambia el proveedor o la
   dirección respecto de lo que el dispositivo usa, se pregunta (sección 2).
7. **Nunca se vuelve a cifrar con una frase sin comprobarla.** *Update synced key*, *Replace synced key…*, *Change
   passphrase…* y *Also sync in this workspace* abren primero la copia actual con la frase escrita (o, si no hay copia,
   la piden dos veces); si no abre, no escriben nada. Así un error de tipeo no deja una copia que nadie puede abrir.

## 1. Qué hay hoy

- La clave vive solo en el dispositivo (`src/assistant/keyStore.ts`, `Doc_Asistente.md` sección 4): IndexedDB
  `shotdocs-assistant` (versión 1), un registro por correo, la clave cifrada con AES-GCM y una llave del dispositivo no
  exportable. Se carga una vez por dispositivo.
- **La misma persona tiene una cuenta distinta en cada workspace** (`Plan_Workspaces.md`, sección 1): mismo correo,
  otro Supabase, otro id. En el dispositivo la clave es por correo, así que una vez cargada sirve en todos los
  workspaces que ese dispositivo abre con ese correo.
- Las preferencias que siguen a la cuenta (tema, fuente) viven en `user_settings.prefs`, que sincroniza
  `src/prefs.ts`. **No sirve para esto:** una versión vieja de la app reescribe `prefs` y saca lo que no conoce (está
  dicho en `prefs.ts`), y mezclaría un secreto con preferencias que se guardan en claro en `localStorage`.

## 2. El recorrido

**Prender la sincronización** (en la PC, con la clave ya guardada y *Test* → *Key works.*):

1. Menú de la cuenta → *Assistant…* → abajo, *Sync across my devices* → *Turn on sync…*.
2. La ventana muestra una frase de seis palabras (*Your passphrase*), con *Copy* y *New one*, y el texto: *Save it in
   your password manager. You'll need it once on each new device. If you lose it, nobody can recover it: you'll paste
   your API key again.* Debajo, *Use my own passphrase instead*.
3. Para seguir, la persona confirma: *I saved my passphrase* (casilla) → *Turn on sync*. La ventana es un formulario
   (4.4): al tocar *Turn on sync* el navegador ofrece guardar la frase en su gestor de contraseñas. La app cifra y
   sube; dice *Your key is synced in <workspace>.*

**Desbloquear en otro dispositivo** (el iPhone, sin clave cargada):

1. *Assistant…* (o el panel, que hoy dice *Set up the assistant*) muestra *Your key is synced. Enter your passphrase to
   use it on this device.*, el campo de la frase (el gestor de contraseñas la ofrece) y *Unlock*.
2. Con la frase correcta, la app muestra a dónde va la clave antes de guardarla: *Unlocked: Anthropic key ending in
   …a1B2.* (o *OpenAI-compatible at openrouter.ai, key ending in …*). Si el dispositivo ya tenía una clave con **otro**
   proveedor o **otra** dirección, pregunta *Your synced key now goes to <host>. Use it?* con el host completo, *Use it*
   / *Keep my current key*. La clave queda en el dispositivo como hoy (cifrada con la llave del dispositivo) y el panel
   anda. Con una equivocada: *That passphrase doesn't open your synced key.* Sin red: *Unlocking needs internet.*
3. Debajo de la frase, *Keep the key on this device* (tildada; S2). Destildada, la clave queda solo en la memoria de esa
   pestaña: al recargar se vuelve a pedir la frase. Para una computadora prestada.

**Dejar de sincronizar:** *Stop syncing* borra la copia de ese workspace (con confirmación). La clave del dispositivo
sigue.

## 3. Modelo de amenazas

Quién puede intentar qué, qué ve y qué lo frena:

| Quién | Qué ve o tiene | Qué podría intentar | Qué lo frena |
|---|---|---|---|
| **El dueño del Supabase del workspace** (que no es la persona: por ejemplo, el estudio de un cliente donde Lega es invitado) | La fila entera: que existe, cuándo cambió (`updated_at`, `generation`), la sal, el iv y el bloque cifrado de largo fijo | Adivinar la frase sin conexión, probando millones por segundo con placas de video | La frase de seis palabras (4.2) y las vueltas de PBKDF2. Con una frase propia débil, sí podría: por eso la app propone la generada y avisa |
| El mismo dueño | Puede escribir en su base | Cambiar la dirección para que la clave vaya a su servidor | La dirección y el proveedor van cifrados (regla 4) |
| El mismo dueño | — | Bajar las vueltas o cambiar el algoritmo en la fila | La fila no trae parámetros: los pone la app por versión (regla 3); una versión desconocida no se abre |
| El mismo dueño | — | Cambiar la sal, el iv o el id para que "abra" otra cosa | La cabecera va atada al cifrado (AAD): cualquier cambio da "no abre" |
| El mismo dueño | — | Volver a poner una fila vieja (una clave anterior) o borrar la fila | Para un dispositivo nuevo no se puede impedir (la AAD no ata `generation`): abre una clave vieja, que si se cambió en el proveedor da *Key doesn't work*, o no encuentra la copia. No filtra nada. Un dispositivo que ya abrió una vez guarda el `savedAt` de **adentro** del sobre (autenticado) y rechaza uno más viejo: *This synced copy is older than the one on this device.* (S2). Si la fila vieja cambia el destino, además se pregunta (regla 6) |
| El mismo dueño | Puede insertar con su clave de servicio una fila a nombre de la persona en **su** workspace | Que la persona, al ver *Your key is synced…* y no poder abrirla, use *Forgot it?* y suba su clave a esa base | La frase no abre una fila ajena (no filtra). El estado "copia sin clave" muestra la fecha de la copia; si el dispositivo sabe que la copia de la persona está en **otro** workspace (`sync.ref`), dice *Your key is synced in <otro>.* y no ofrece *Forgot it?* ahí. Subir la clave a esa base sigue siendo una decisión de la persona (CS2) |
| El mismo dueño | Los registros de la API de su Supabase | Saber cuándo un dispositivo nuevo pidió la fila | No se oculta. Es poco: no ve la frase ni si abrió |
| **Quien roba la base** (o una copia de seguridad) | Lo mismo que el dueño, de todas las personas | Lo mismo: adivinar sin conexión, una persona por vez (cada fila tiene su sal) | Igual que arriba |
| **Las copias de seguridad del dueño** (`z_shotdocs_backup`, cuatro por día) | Las versiones viejas del bloque cifrado, por el tiempo que se guarden | Abrir una copia vieja con una frase vieja que se filtró | Cambiar la frase no borra las copias viejas: si la frase se filtra, **se cambia la clave en el proveedor** (la vieja deja de servir). La ayuda lo dice |
| **Otro miembro, un invitado, un visitante del link público** | Nada | Leer la fila | RLS: solo `user_id = auth.uid()`; `anon` sin permisos |
| **Un cliente MCP conectado** (un tercero con un token de la persona, `Doc_Asistente.md` 9.2) | Nada | Leer la fila y adivinar la frase | El token cerrado de fábrica (rol propio o `db_pre_request`) y además la política exige `client_id` vacío |
| **El portero** | Nada | — | Nunca la pide ni la recibe |
| **Quien usa el dispositivo** con la sesión abierta | La clave local (como hoy) | Usarla | Lo mismo que hoy: *Forget key*, la casilla al salir, *Keep the key on this device* destildada en una computadora prestada, el tope de gasto en el proveedor |
| **Quien tiene un dispositivo perdido o robado**, con la sesión abierta y la frase en el gestor de contraseñas | La clave local, la sesión y la frase | (a) Recibir la clave nueva cuando la persona la cambie; (b) armar un sobre válido con la misma frase, con **su** clave y **su** dirección, para que los otros dispositivos de la persona le manden el texto de las páginas | (a) *Sign out other devices* y frase nueva **antes** de actualizar la copia (casos de abajo); (b) la regla 6: la app nunca adopta en silencio un destino distinto y muestra siempre el host y el final de la clave. Límite: el token de acceso del dispositivo perdido sigue sirviendo hasta que vence (1 hora de fábrica en Supabase) |
| **Un script dentro de la app** (una dependencia comprometida, algo inyectado) | Lo que se escribe en la página, también la frase al desbloquear | Leer la frase o la clave | Lo mismo que hoy (`Doc_Asistente.md` 10.4): la CSP, ningún script de afuera salvo el selector de Google. La frase no lo empeora: ese script ya podía usar la clave |
| **Quien publica la app** (Lega, o quien sirva una copia propia) | El código que corre | Cambiar el código para mandar la frase a otro lado | Es la misma confianza que ya pide la app (`Plan_Workspaces.md`, sección 1). No se resuelve acá |

**Casos de la persona:**

- **Frase olvidada.** No hay recuperación ni "pista". En *Assistant…*: *Forgot it? Paste your API key again and choose a
  new passphrase.* La fila nueva reemplaza a la vieja; los dispositivos que ya tenían la clave siguen igual.
- **Cambiar la frase** (S2, *Change passphrase…*): pide la frase actual y la nueva; vuelve a cifrar con una sal nueva.
  Pedir la actual evita un cambio por error, **no es una barrera**: quien tenga la sesión abierta puede usar *Forgot
  it?* y pisar la copia con otra clave y otra frase. El daño es que la persona no pueda abrir la copia en un dispositivo
  nuevo (lo ve y la vuelve a cargar), nunca que se filtre su clave: la copia nueva no se abre con su frase. Las copias
  de seguridad guardan la vieja (arriba).
- **Varios workspaces.** Con una copia alcanza (el dispositivo comparte la clave entre workspaces por correo). Si la
  persona la quiere en otro, *Also sync in this workspace* (S2) pide la frase y sube otra copia; cada una es
  independiente (ver CS2). La copia queda en manos del dueño de **ese** workspace: por eso no se reparte sola.
- **Cerrar sesión.** Como hoy: la casilla *Also forget my assistant key on this device* saca la clave **del
  dispositivo**; la copia sincronizada sigue en el workspace (protegida por la frase). El texto de la casilla lo suma.
- **Dispositivo perdido o robado.** La copia de ese dispositivo no tiene frase: quien lo desbloquee con la sesión
  abierta la puede usar, y probablemente tenga **también la frase** (el gestor de contraseñas del navegador o del
  sistema la autocompleta en ese mismo sitio). Por eso el orden importa:
  1. **Cerrar la sesión de los otros dispositivos** en el workspace de la copia: *Sign out other devices* en el menú de
     la cuenta (nuevo en S1; `signOut({ scope: 'others' })` de supabase-js, que revoca los refresh tokens de las otras
     sesiones de esa cuenta). Hoy la app solo cierra la sesión local. Límite: el token de acceso que el dispositivo
     perdido ya tiene sigue sirviendo hasta que vence (1 hora de fábrica). Las sesiones son por workspace: en otros
     workspaces hay que repetirlo (para la clave alcanza el de la copia).
  2. **Sacar el dispositivo del gestor de contraseñas** (la cuenta de Apple o de Google), o directamente **elegir una
     frase nueva** generada: *Replace synced key…* pide la frase actual (para abrir la copia, regla 7), la clave nueva y
     una frase nueva, en un solo paso.
  3. **Crear una clave nueva y borrar la vieja en la consola del proveedor.**
  4. Con eso, *Replace synced key…* (del paso 2). Los demás dispositivos, al fallar la vieja, ven *Your synced key
     changed on another device. Enter your passphrase to update it here.* (S2) y se les pone la frase nueva.

  Si el dispositivo perdido llegara a pisar la copia antes del paso 1 con un destino suyo, los otros dispositivos lo
  ven (regla 6). La ayuda lo explica paso a paso.
- **Sacan a la persona del workspace.** Su fila queda hasta que el dueño borre su cuenta de ese Supabase (se borra con
  ella, `on delete cascade`). No le sirve a nadie sin la frase.

## 4. El cifrado

### 4.1 Medido en esta PC (Intel Core i9-14900K, 2026-10-02)

Derivar la llave de la frase más un cifrado de prueba; mediana de 5 corridas, en milisegundos:

| | Node 22.23 | Chromium 153 | WebKit 26.6 (Playwright, Windows) |
|---|---|---|---|
| PBKDF2-SHA256, 100 000 vueltas | 10 | 11 | 42 |
| PBKDF2-SHA256, 310 000 | 31 | 32 | 129 |
| PBKDF2-SHA256, 600 000 (mínimo de OWASP) | 60 | 64 | 250 |
| **PBKDF2-SHA256, 1 000 000 (la elegida)** | **100** | **105** | **825** (mínimo 438) |
| PBKDF2-SHA256, 2 000 000 | 196 | 208 | 1 654 |
| Argon2id 19 MiB, t=2 (mínimo de OWASP) | 24 | 25 | 82 |
| Argon2id 46 MiB, t=1 | 39 | 34 | 97 |
| Argon2id 64 MiB, t=3 | 143 | 126 | 387 |
| Argon2id 128 MiB, t=3 | 444 | 429 | 771 |

Argon2id con `hash-wasm` (WebAssembly, 29 KB sin comprimir). El prototipo del sobre completo (sección 4.3): cifrar
113 ms y abrir 101 ms en Node 22.

**El iPhone, estimado (no medido).** El WebKit de Playwright en Windows no es el de iOS: tarda cuatro a ocho veces más que
Chromium, probablemente porque en Windows su WebCrypto se apoya en otra biblioteca. En iOS, PBKDF2 de WebCrypto lo hace el sistema
(CommonCrypto), con las instrucciones SHA-256 del procesador; un iPhone de los últimos años anda cerca de una PC en un
solo núcleo. Estimado para 1 000 000 de vueltas: **0,2 a 0,5 s**; el peor caso razonable es el de WebKit en Windows,
menos de 1 s. Pasa una vez por dispositivo (al desbloquear) y al cambiar la frase. La entrega S1 lo mide en el iPhone
de Lega con una página de prueba, y si pasa de 1,5 s se baja a 600 000 (el formato lo permite: es otra versión).

### 4.2 Qué tan difícil es adivinar la frase

Lo que hace segura la copia es la frase; las vueltas multiplican el costo de cada intento. Con números públicos de
`hashcat` (estimación, no medida acá): una placa de video de las mejores de 2023-2024 hace del orden de 9 000 millones
de vueltas de PBKDF2-SHA256 por segundo, o sea **unos 9 000 intentos por segundo** con 1 000 000 de vueltas.

| Frase | Combinaciones | Tiempo medio con una placa | Con 100 placas |
|---|---|---|---|
| **Seis palabras al azar de 1 296** (la generada) | 1 296⁶ ≈ 4,7 × 10¹⁸ (62 bits) | ~8 millones de años | ~80 000 años |
| Cinco palabras al azar | ≈ 3,7 × 10¹⁵ | ~6 500 años | ~65 años |
| Una frase pensada por una persona, de las que caen en 10 000 millones de intentos con diccionarios y reglas | 10¹⁰ | ~6 días | ~1,5 horas |

**En términos simples:** con la frase que da la app, robar la base no alcanza para nada práctico. Con una frase propia
"linda" (una cita, un nombre con la fecha), alguien decidido la saca en horas. Por eso la generada es la de fábrica.

**PBKDF2 contra Argon2id.** Argon2id usa mucha memoria por intento y frena mucho más a las placas de video (es lo que
recomienda OWASP hoy). Se descarta para la versión 1 porque: (a) WebCrypto no lo trae y habría que sumar una biblioteca
de WebAssembly de terceros que maneja la frase en claro, justo el riesgo de `Doc_Asistente.md` 10.4; (b) con 64 MiB, un
iPhone con poca memoria libre puede cortar la pestaña; (c) con una frase generada de 62 bits la diferencia no cambia
nada en la práctica. Donde sí ayudaría es con una frase propia débil. El formato lleva versión: Argon2id entra después
como versión 2 sin romper nada (CS3).

### 4.3 El sobre

- **La frase**, normalizada (NFKC: una tilde escrita de dos maneras da lo mismo, probado), recortados los espacios de
  las puntas. Si tiene la forma de la generada (seis palabras de letras separadas por guiones o espacios), se pasa a
  minúsculas y los espacios a guiones antes de derivar: el teclado del iPhone pone mayúscula a la primera letra y, sin
  esto, `Gift-zebra-…` no abre (lo encontró la auditoría). Una frase propia se usa tal cual. **La sal:** 16 bytes al azar, nueva en cada cifrado. **La llave:** PBKDF2-SHA256, 1 000 000 de vueltas,
  AES-GCM de 256 bits, **no exportable**, que se usa y se suelta (nunca se guarda).
- **Lo cifrado** (JSON): `{ provider, baseUrl, model, apiKey, savedAt }`, **relleno a 1 024 bytes** con espacios al
  final. Sin relleno el largo delata el proveedor (una clave de Gemini mide 39 caracteres; una de OpenAI, más de 150).
  La regla se mide **en bytes UTF-8 del JSON, no en caracteres**: si pasa de 1 024 no se sincroniza (*This key or Base
  URL is too long to sync.*). El peor caso que armó la auditoría (dirección de 300 caracteres con tildes, modelo de 120,
  clave de 200) da 716 bytes. La lista de modelos no viaja en el sobre (se vuelve a pedir al proveedor).
- **AES-256-GCM** con un iv de 12 bytes al azar y, como datos adicionales (AAD), la cabecera
  `{"v":1,"kdf":"pbkdf2-sha256","iter":1000000,"salt":"<sal>","uid":"<id de la persona en ese Supabase>"}`, armada por
  la app con sus constantes y los datos de la fila. Si el dueño cambia la sal, el id o la versión, el cifrado no abre;
  una fila de otra persona tampoco.
- **La fila** guarda: versión (1), sal, iv y el cifrado en base64 (1 388 caracteres siempre).
- **Frase equivocada** y **fila tocada** dan el mismo error de AES-GCM: la app dice *That passphrase doesn't open your
  synced key.* (no puede distinguirlos, y está bien: no da pistas).
- **Probado en el prototipo** (Node 22, un script fuera del repo): ida y vuelta igual; la fila no contiene ni
  la clave ni la dirección; frase equivocada, otro id, un byte del cifrado cambiado, otra sal y una versión desconocida
  no abren; una tilde compuesta o precompuesta abre igual; la fila mide 290 caracteres sin el relleno.

### 4.4 La frase que propone la app

- Seis palabras al azar (`crypto.getRandomValues`, sin sesgo: se descarta lo que no entra parejo) de la **lista corta
  1 de la EFF** (*EFF's Short Wordlist #1*: 1 296 palabras en inglés de 3 a 5 letras, sin parecidos; licencia CC BY
  3.0, se suma a `THIRD_PARTY_NOTICES.md`; unos 8 KB en la parte que se baja con el asistente). En minúsculas,
  separadas por guiones: seis palabras de 3 a 5 letras (el ejemplo real sale de la lista al implementar; no se inventa
  uno acá).
- *New one* propone otra. **Guardar en el gestor es lo recomendado**: la ventana es un formulario con un usuario oculto
  *Shot Docs assistant key* y el campo con `autocomplete="new-password"`; al tocar *Turn on sync* se envía (sin salir de
  la página), y así el navegador ofrece guardarla con nombre propio (la app entra con código, así que es la única
  "contraseña" del sitio). *Copy* existe, con el aviso *Copied passphrases can stay in your clipboard history.* (el
  historial de Windows, Win+V, y el portapapeles universal de Apple la guardan).
- **Los campos de la frase** son `input` **no controlados** (se leen por `ref` al tocar el botón y se vacían): un campo
  controlado por React dejaría la frase en su estado, visible en sus herramientas. Llevan `autocapitalize="none"`,
  `autocorrect="off"` y `spellcheck="false"`.
- **Una propia** (*Use my own passphrase instead*): 20 caracteres o más y al menos cuatro palabras; dos veces para
  confirmar; aviso fijo: *A passphrase you make up is much easier to guess than a generated one. Anyone who gets a copy
  of this workspace's database could try.* No se mide "la fuerza" con una biblioteca (pesaría cientos de KB): la regla
  es el largo y el aviso.

## 5. Dónde se guarda: la tabla y sus permisos

En el Supabase del workspace donde la persona prende la sincronización. Migración nueva (S1), borrador:

```sql
-- La clave del asistente sincronizada, cifrada en el dispositivo con una frase que solo sabe la persona
-- (Docs/Doc_Clave_Sincronizada.md). El servidor guarda solo el bloque cifrado; los parámetros los fija la app.
create table public.assistant_key_sync (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  format     smallint not null check (format = 1),
  salt       text not null check (length(salt) = 24),        -- 16 bytes en base64
  iv         text not null check (length(iv) = 16),          -- 12 bytes en base64
  ciphertext text not null check (length(ciphertext) = 1388), -- 1 024 + 16 bytes en base64
  generation bigint not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.assistant_key_sync enable row level security;

-- Solo la persona, y nunca con el token de un cliente MCP (Doc_Asistente.md 9.2).
create policy assistant_key_sync_own on public.assistant_key_sync
  for all to authenticated
  using (user_id = (select auth.uid()) and (select auth.jwt() ->> 'client_id') is null)
  with check (user_id = (select auth.uid()) and (select auth.jwt() ->> 'client_id') is null);

revoke all on public.assistant_key_sync from public, anon, authenticated;
grant select, delete on public.assistant_key_sync to authenticated;
grant insert (format, salt, iv, ciphertext) on public.assistant_key_sync to authenticated;
grant update (format, salt, iv, ciphertext) on public.assistant_key_sync to authenticated;

-- Cada cambio sube `generation` (la usan los otros dispositivos para saber que cambió y la app para no pisar
-- un cambio de otro dispositivo) y la hora. El id no cambia nunca.
create function private.assistant_key_sync_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.user_id := old.user_id;
  new.generation := old.generation + 1;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.assistant_key_sync_touch() from public, anon, authenticated;
create trigger assistant_key_sync_touch before update on public.assistant_key_sync
  for each row execute function private.assistant_key_sync_touch();
```

- **Fuera de Realtime** (no se suma a la publicación) y fuera del portero.
- **Borrado de verdad.** *Stop syncing* hace un `delete`. Es la excepción explícita a "no hay borrado duro", que es para
  el contenido: esto es un secreto de la persona y lo que quiere al borrarlo es que no esté. Las copias de seguridad
  del dueño lo guardan por su tiempo (sección 3).
- **Con `assistant_policy = off`** la app no ofrece *Turn on sync* en ese workspace (el dueño no quiere el asistente
  ahí), pero sí *Unlock* y *Stop syncing* de una copia que ya exista. Es regla de la app; la tabla no mira la política
  (guardar un bloque cifrado no manda contenido a nadie).
- **No sube `schema_version`** (como las migraciones del asistente): sin la tabla, PostgREST responde que no existe y la
  app dice *This workspace's database needs an update to sync your key.*
- Pruebas SQL en `supabase/tests/`, en `begin … rollback` (sección 11).

## 6. En el dispositivo

- La base `shotdocs-assistant` **sigue en la versión 1**: una versión vieja de la app la abre con `openDB(…, 1)`, y si
  la nueva la subiera a 2, la vieja fallaría con `VersionError` y se quedaría sin asistente en ese dispositivo. Lo nuevo
  va **adentro del registro de siempre**, en campos opcionales: `sync?: { ref, userId, generation, savedAt, unlockedAt }` (de
  qué workspace y qué versión de la copia vino la clave; `savedAt` es el de **adentro** del sobre, autenticado, para
  rechazar una copia más vieja, O3 de la auditoría).
- Al desbloquear, la clave se guarda como hoy (`saveSettings` con la llave del dispositivo) y se anota `sync`. Con *Keep
  the key on this device* destildada (S2), la clave queda en una variable del módulo del asistente, solo en esa pestaña,
  y nada se escribe en la base (ni `sync`): al recargar no está. Es la única excepción a "la clave no queda en ninguna
  variable" de `Doc_Asistente.md` sección 4: una variable del módulo (nunca `window` ni el estado de React), que un
  script dentro de la app podría leer igual que hoy puede usar la clave guardada; no agrega exposición.
- La frase vive en el campo (no controlado, 4.4) hasta tocar *Unlock*; se pasa a la derivación y se vacía el campo. La llave derivada se usa
  para abrir o cerrar y se suelta. **Nunca** se guarda ni la frase ni la llave derivada (CS6).

## 7. Dos dispositivos a la vez

- Cada cambio sube `generation` (el trigger). La app escribe con `update … where user_id = <id> and generation =
  <la que leyó>`; si no cambia ninguna fila, otro dispositivo cambió la copia en el medio: *Your synced key changed on
  another device. Reload it?* y no pisa nada. La primera vez, `insert`; si choca (`23505`), lo mismo.
- **Saber que cambió** (S2): al abrir *Assistant…* o el panel con red, una consulta de `generation` (una fila chica, sin
  el cifrado). Si es mayor que `sync.generation` del dispositivo, la ventana dice *Your synced key changed on another
  device. Enter your passphrase to update it here.*; hasta que la persona lo haga, la clave local sigue andando (regla
  5). Al abrirla: si su `savedAt` es **menor** que el de `sync.savedAt`, no se adopta (*This synced copy is older than
  the one on this device.*); si cambia el destino, se pregunta (regla 6). Si la clave local da *Key doesn't work* (401) y hay una copia más nueva, el error suma ese mismo botón.

## 8. Versiones viejas

- **De la app:** ignora la tabla y sigue con la clave local; no ve la sincronización. No hace falta subir
  `min_app_version` (no toca el editor ni el contenido).
- **Del registro local:** una versión vieja que guarda ajustes rehace el registro sin `sync`. La nueva lo lee como "una
  clave local sin copia de origen" y sigue andando; solo pierde el aviso de "cambió en otro dispositivo" hasta el
  próximo *Unlock*. Nada se pierde.
- **Del formato:** la versión 1 es PBKDF2 con 1 000 000 de vueltas. Una versión futura (Argon2id, o menos vueltas si el
  iPhone lo pide) es `format = 2`, con su `check` en la tabla; una app que no conoce un formato dice *This synced key
  was saved by a newer version of the app. Update the app to unlock it.* y no toca la fila.

## 9. Interfaz (textos en inglés, con su traducción en `src/i18n/`)

En *Assistant…*, debajo de *Forget key*, una sección **Sync across my devices**:

| Estado | Lo que se ve |
|---|---|
| Sin clave guardada y sin copia | *Save a key first to sync it across your devices.* |
| Con clave, sin copia | *Your key is only on this device.* · *Turn on sync…* |
| Con copia, abierta en este dispositivo | *Synced in <workspace> · updated <fecha>.* · *Update synced key* (si la clave local es otra; pide la frase y abre la copia antes, regla 7) · *Replace synced key…* (clave y frase nuevas, para un dispositivo perdido) · *Change passphrase…* (S2) · *Stop syncing* |
| Con copia, sin clave en este dispositivo | *Your key is synced (saved <fecha>). Enter your passphrase to use it on this device.* · campo *Passphrase* con *Paste* · *Keep the key on this device* (S2) · *Unlock* · *Forgot it? Paste your API key again and choose a new passphrase.* |
| Con copia en este workspace, pero el dispositivo sabe que la de la persona está en **otro** (`sync.ref`) | *Your key is synced in <otro>.* · *Unlock* (por si la persona sí la puso acá); **sin** *Forgot it?* |
| Al abrir una copia | *Unlocked: <provider> key ending in …<4>.* (con el host en uno compatible) |
| La copia abierta cambia el destino | *Your synced key now goes to <host>. Use it?* · *Use it* / *Keep my current key* |
| La copia abierta es más vieja que la del dispositivo (S2) | *This synced copy is older than the one on this device.* (no se adopta) |
| La copia cambió en otro dispositivo (S2) | *Your synced key changed on another device. Enter your passphrase to update it here.* |
| Sin red | *Syncing your key needs internet.* (los botones apagados) |
| Base sin la tabla | *This workspace's database needs an update to sync your key.* |
| Política *Off* | *The owner turned the assistant off in this workspace, so your key can't be synced here.* |

- **Ventana de *Turn on sync…*:** *Your passphrase*, la frase, *Copy*, *New one*, el texto del paso 2 de la sección 2, *Use my own
  passphrase instead*, *I saved my passphrase*, *Turn on sync* / *Cancel*. Debajo, chico: *Your key is encrypted on this
  device with your passphrase. <workspace> stores only the encrypted copy and can't read it.*
- ***Stop syncing*:** *Delete the synced copy from <workspace>? Your key stays on this device.* · *Delete copy* /
  *Cancel*.
- **El texto de siempre** (*Your key stays on this device and is sent only to <provider>.*) pasa a *Your key is sent
  only to <provider>. With sync on, an encrypted copy is stored in <workspace>.* cuando hay copia.
- **El panel sin clave:** *Set up the assistant* suma *Unlock your synced key* si hay copia.
- **Menú de la cuenta: *Sign out other devices*** (S1): *Sign out of <workspace> on all your other devices? They'll need
  a new code to get back in. A device that is already open can keep working for up to an hour.* · *Sign out others* /
  *Cancel*. Llama `signOut({ scope: 'others' })` del cliente del workspace. No depende del asistente: sirve para
  cualquier dispositivo perdido.
- **La ventana de salir:** la ayuda de la casilla suma *Your synced copy stays in this workspace, protected by your
  passphrase.* si hay copia.
- Tooltips con `data-tip` solo donde agregan algo (en *Keep the key on this device*: *Off on a borrowed computer: the
  key lives only in this tab.*). Sin atajos nuevos.

## 10. Ayuda

Una entrada nueva en "Writing", *Sync your assistant key*, en los dos idiomas: qué hace, dónde queda la copia y quién
la ve (cifrada), por qué la frase generada, guardarla en el gestor mejor que copiarla, qué pasa si se olvida, qué hacer
si se filtra la frase (cambiar la clave en el proveedor) y *Keep the key on this device* en una computadora prestada.
**Si perdiste un dispositivo**, los cuatro pasos en orden (sección 3): *Sign out other devices*, sacarlo del gestor o
elegir una frase nueva, clave nueva en el proveedor, *Replace synced key…*. La entrada *Your
assistant key* de A1 cambia su frase "se carga en cada dispositivo".

## 11. Pruebas

**Vitest, sin red:**

1. El sobre: ida y vuelta; un vector fijo de PBKDF2-SHA256 (de RFC 7914, sección 11, con sus vueltas) para atar la
   derivación; frase equivocada, sal, iv, id, versión y un byte del cifrado cambiados → no abre; una versión
   desconocida → el mensaje de "versión más nueva"; NFKC y espacios de las puntas; el relleno da siempre 1 388
   caracteres (con una clave de Gemini y una de OpenAI); un JSON de más de 1 024 **bytes** se rechaza (con una dirección
   con tildes que entra en caracteres y no en bytes); la frase generada con mayúscula inicial o con espacios abre igual,
   y una propia no se toca.
2. **Mutante del servidor que manda:** una fila con `iter` o `kdf` agregados, o con otra versión, no cambia lo que usa
   la app (las constantes); un mutante que lea las vueltas de la fila tiene que hacer fallar la prueba.
3. **Mutante de la dirección en claro:** una fila con un `baseUrl` agregado no cambia a dónde va la clave.
4. La frase generada: seis palabras de la lista, sin sesgo (un millón de sorteos con un `getRandomValues` falso y
   controlado), y la regla de la propia (20 caracteres, cuatro palabras).
5. **Nada en claro sale ni se guarda:** con `fetch` espiado y `fake-indexeddb`, en todo lo que sale a la red y en todo
   lo guardado (IndexedDB, `localStorage`, `sessionStorage`, la consola) no aparecen ni la frase ni la clave ni la
   dirección de prueba.
6. El dispositivo: la base sigue en la versión 1; abrirla con el código de `main` (`keyStore.ts` de v0.129) después de
   desbloquear anda y lee la clave; un registro sin `sync` (escrito por la versión vieja) sigue andando; *Keep the key
   on this device* destildada no escribe nada en IndexedDB y al "recargar" (módulo nuevo) no hay clave.
7. Dos dispositivos: con el servidor falso, dos `update` con la misma `generation` → el segundo no pisa y muestra el
   aviso; el aviso de "cambió en otro dispositivo"; el 401 con una copia más nueva suma el botón. **Regla 7:** *Update
   synced key*, *Replace synced key…*, *Change passphrase…* y *Also sync in this workspace* con una frase que no abre la
   copia actual no escriben nada (mutante: cifrar sin abrir antes). **Copia más vieja:** una copia con `savedAt` menor que
   `sync.savedAt` no se adopta.
8. La interfaz: cada fila de la tabla de la sección 9 (con y sin red, sin la tabla, política *Off*), el panel sin clave
   con copia, la ventana de salir con copia.
9. Ayuda: la entrada nueva en los dos idiomas (la prueba de siempre de `src/help/`).
10. **Regla 6, destino nuevo:** una copia válida, armada con la frase de la persona pero con otro proveedor
   u otra dirección que los del dispositivo, no se adopta sin *Use it* (mutante: adoptar en silencio); al abrir se
   muestran el host y los últimos cuatro caracteres; un dispositivo sin clave previa muestra igual el destino.
   *Sign out other devices* llama `signOut({ scope: 'others' })` del cliente del workspace (cliente falso). El estado con
   `sync.ref` de otro workspace no ofrece *Forgot it?*.

**SQL (`supabase/tests/`, en `begin … rollback`):**

11. La persona lee, crea, cambia y borra su fila; otra persona (miembro, admin, el dueño con su sesión de la app) no la
    ve ni la cambia; `anon` nada; un JWT con `client_id` nada (ni la suya); no se puede cambiar `user_id` ni escribir
    `generation`; los `check` de largo y de versión; el trigger sube `generation`. Mutantes: sacar la condición de
    `client_id`, sacar la de `user_id`, dar `update` a todas las columnas: cada uno tiene que hacer fallar una prueba.

**Recorrido en Chromium** (el arnés de A1 con la app real sobre el servidor en memoria y dos perfiles como "dos
dispositivos"): prender en uno, desbloquear en el otro, frase equivocada, *Stop syncing*, sin red, y el teléfono.

## 12. Entregas

| | Qué | Criterio de aceptación | Riesgo |
|---|---|---|---|
| **S1** | La migración con sus pruebas SQL; el sobre (`src/assistant/keySync.ts`) con la frase generada y la propia; en *Assistant…*: *Turn on sync…*, *Unlock* (mostrando el destino y **preguntando si cambia**, regla 6), *Update synced key* y *Replace synced key…* (abriendo antes la copia, regla 7, y con la escritura condicional por `generation` de la sección 7), *Stop syncing*, los estados sin red, sin tabla, con *Off* y con la copia en otro workspace; **_Sign out other devices_ en el menú de la cuenta**; el panel sin clave con *Unlock your synced key*; la casilla de salir; la ayuda con los pasos del dispositivo perdido; la lista de la EFF con su aviso de licencia; los campos no controlados; la medición en el iPhone (sección 4.1) | Pruebas 1 a 6 y 8 a 11, y de la 7 la escritura condicional y la regla 7 para *Update* y *Replace*, en verde, con sus mutantes muertos; el recorrido en Chromium; ningún texto en claro en la red ni en lo guardado; la auditoría independiente (nivel alto: seguridad de un secreto) | **Alto**: un secreto de la persona en la base de otro |
| **S2** | *Change passphrase…*, *Keep the key on this device*, el aviso de "cambió en otro dispositivo" y el botón en el 401, rechazar una copia más vieja (`savedAt`), *Also sync in this workspace* | Pruebas 6 y 7 completas; el recorrido con dos dispositivos | Medio |

**Recorrido de Lega (S1)**, con su clave de verdad y la migración aplicada en Wanka:

1. En la PC: *Assistant…* → la clave guardada → *Sync across my devices* → *Turn on sync…* → *I saved my passphrase* →
   *Turn on sync* → el navegador ofrece guardar la frase: *Save*. Dice *Your key is synced in Wanka.*
2. En el iPhone (sin clave cargada): *Assistant…* → *Your key is synced…* → pegar la frase → *Unlock*: tarda menos de 1,5 s
   (el umbral de la sección 4.1), dice *Unlocked: Anthropic key ending in …* y el panel corrige un texto.
3. En el iPhone, *Forget key*; *Unlock* con una frase equivocada: *That passphrase doesn't open your synced key.*; con la
   buena, abre.
4. Modo avión: la sección dice *Syncing your key needs internet.* y sus botones quedan apagados; al volver la red, el
   panel usa la clave ya abierta sin pedir nada.
5. En la PC: *Stop syncing* → *Delete copy*. En el iPhone, después de *Forget key*, *Assistant…* ya no ofrece *Unlock*.
6. Dispositivo perdido (simulado con la Mac): en la PC, menú de la cuenta → *Sign out other devices* → *Sign out
   others*; en la Mac, al rato (o al recargar después de una hora), la app pide el código otra vez. En la PC, *Replace
   synced key…* con la frase actual, una clave nueva y una frase nueva; en el iPhone, *Unlock* con la frase nueva.
7. Destino nuevo: en la PC, guardar una clave de otro proveedor y *Update synced key*; en el iPhone (que tenía la de
   Anthropic), al abrir la copia pregunta *Your synced key now goes to <host>. Use it?*; *Keep my current key* deja la
   de antes.

**Recorrido de Lega (S2):** cambiar la clave en la consola del proveedor, pegarla en la PC y *Update synced key*; en el
iPhone, el panel da *Key doesn't work* con *Enter your passphrase to update it here* → frase → anda. *Change
passphrase…* con la actual mal: no deja. En una ventana privada, *Unlock* con *Keep the key on this device*
destildada → anda; recargar → pide la frase.

## 13. Riesgos

| Riesgo | Qué lo cubre |
|---|---|
| El dueño de un workspace (o quien robe la base) adivina la frase | La frase generada de 62 bits, PBKDF2 de 1 000 000 de vueltas, el aviso de la frase propia (4.2) |
| El dueño redirige la clave a su servidor | Proveedor y dirección cifrados (regla 4); prueba 3 |
| El dueño baja la protección en la fila | Parámetros fijos por versión en la app (regla 3); prueba 2 |
| La frase o la clave quedan en algún lado | Nunca se guardan; campos no controlados; prueba 5 busca en red, IndexedDB, `localStorage` y consola |
| Dispositivo perdido con la sesión y la frase en su gestor: recibe la clave nueva | *Sign out other devices* y frase nueva antes de *Replace synced key…* (sección 3), la ayuda paso a paso; límite: hasta una hora con el token de acceso vigente |
| Quien tiene la sesión y la frase arma un sobre con su clave y su dirección para recibir el texto de las páginas | Regla 6: nunca se adopta un destino nuevo en silencio; se muestran el host y el final de la clave; prueba 10 |
| Una copia vieja repuesta por el dueño | `savedAt` autenticado en el dispositivo que ya abrió (S2); para uno nuevo, sin filtración |
| Una fila plantada por un dueño ajeno lleva a subir la clave a su base | La fecha de la copia y *Your key is synced in <otro>* sin *Forgot it?* (sección 9) |
| Un error de tipeo deja una copia que nadie abre | Regla 7: se abre la copia actual con la frase antes de volver a cifrar; prueba 7 |
| Un cliente MCP lee la fila | La política exige `client_id` vacío, además del token cerrado de fábrica; prueba 11 |
| Una versión vieja se queda sin asistente | La base local no sube de versión; prueba 6 |
| Dos dispositivos se pisan | `generation` y la escritura condicional (7); prueba 7 |
| La persona olvida la frase | Se vuelve a pegar la clave; la clave local de cada dispositivo no se toca |
| En el iPhone tarda mucho | Medir en S1; si pasa de 1,5 s, versión con 600 000 vueltas |
| Una frase filtrada sigue abriendo copias viejas en las copias de seguridad | Dicho en la ayuda: ante la duda, cambiar la clave en el proveedor |

## 14. Decisiones (tomadas el 2026-10-02, valen hasta que Lega diga otra cosa)

### CS1 · Dónde se guarda la copia cifrada

**Qué pasaba:** la clave tiene que estar en algún servidor para llegar del escritorio al iPhone. Cada workspace tiene su
propio Supabase, y la misma persona tiene una cuenta distinta en cada uno.
**Las opciones:**
- **A:** una tabla propia, `assistant_key_sync`, en el Supabase del workspace, una fila por persona, que solo ella lee.
- **B:** adentro de las preferencias que ya se sincronizan (`user_settings.prefs`).
- **C:** en el portero o en el Drive del dueño.

**Elegí A** porque una tabla aparte tiene sus propios permisos (ni el token de un cliente MCP la lee) y una versión
vieja de la app la ignora. B mezcla un secreto con preferencias que se guardan en claro en el dispositivo, y una versión
vieja borra de `prefs` lo que no conoce. C pone la copia en manos de un servicio que hoy no sabe nada de las personas.
**Si preferís otra:** B solo ahorra una tabla y trae los dos problemas; no la recomiendo.

### CS2 · En qué workspaces queda la copia

**Qué pasaba:** Lega es dueño de Wanka, pero puede ser invitado en el workspace de un cliente. Si la copia se reparte
sola, el cliente guarda en su base la clave cifrada de Lega.
**Las opciones:**
- **A:** solo en el workspace donde la persona la prende. Con una alcanza: en el dispositivo la clave sirve para todos
  los workspaces con ese correo. Si la quiere en otro, la sube a mano (*Also sync in this workspace*, S2).
- **B:** automática en todos los workspaces donde la persona está.

**Elegí A** porque cada copia queda en la base de otro dueño, y nadie tiene por qué tener la tuya sin que lo decidas.
Con A, Lega la sincroniza en Wanka y ningún cliente la recibe.
**Si preferís otra:** B es más cómoda para quien tiene dispositivos que abren solo el workspace de otro; se agrega como
casilla *Sync in all my workspaces* sin cambiar la tabla.

### CS3 · Cómo se convierte la frase en la llave

**Qué pasaba:** quien robe la base puede probar frases sin límite en su computadora. Cada intento tiene que costarle
caro, y abrir la copia en el iPhone tiene que tardar poco.
**Las opciones:**
- **A:** PBKDF2-SHA256 con 1 000 000 de vueltas (viene con el navegador). 0,1 s en esta PC; estimado 0,2 a 0,5 s en un
  iPhone.
- **B:** Argon2id con 64 MiB (frena más a las placas de video). Necesita una biblioteca de WebAssembly de terceros;
  0,13 s acá; más memoria en el iPhone.
- **C:** PBKDF2 con 600 000 vueltas (el mínimo que recomienda OWASP).

**Elegí A** porque no suma código de terceros que toque la frase, anda igual en todos los navegadores, y con la frase
generada la diferencia con B no cambia nada en la práctica (millones de años con las dos). El formato tiene versión: B
se suma después sin romper nada.
**Si preferís otra:** B si querés permitir frases propias sin el aviso (la ayuda frente a una frase débil es real, pero
no la vuelve segura). C si el iPhone tarda más de 1,5 s.

### CS4 · Qué frase

**Qué pasaba:** la frase es lo único que protege la copia en la base de otro. Una frase pensada por una persona ("Wanka
2026 rodaje!") cae en horas con un diccionario.
**Las opciones:**
- **A:** la app propone seis palabras al azar (para guardar en el gestor de contraseñas), y deja usar una propia de 20
  caracteres o más con un aviso.
- **B:** solo la generada.
- **C:** libre, con un mínimo de largo.

**Elegí A** porque la de fábrica es segura de verdad y sigue siendo una frase que solo sabés vos; la propia queda para
quien la quiera recordar, sabiendo el costo.
**Si preferís otra:** B es lo más seguro (sacar un botón). C no la recomiendo.

### CS5 · Qué pasa si se olvida la frase

**Qué pasaba:** si la app pudiera recuperar la frase, también podría hacerlo quien tenga la base.
**Las opciones:**
- **A:** sin recuperación: se vuelve a pegar la clave y se elige una frase nueva; los dispositivos que ya la tenían
  siguen andando.
- **B:** una segunda frase de recuperación.

**Elegí A** porque la clave siempre se puede volver a sacar de la consola del proveedor: perder la frase cuesta un
minuto. B duplica lo que hay que guardar y lo que se puede robar.
**Si preferís otra:** B se suma como un segundo sobre en la misma fila.

### CS6 · Si el dispositivo recuerda la frase

**Qué pasaba:** cada vez que la persona cambia la clave (o el proveedor) en un dispositivo, la copia sincronizada tiene
que volver a cifrarse, y para eso hace falta la frase.
**Las opciones:**
- **A:** pedir la frase cada vez que se actualiza la copia (pasa pocas veces). Nunca se guarda ni la frase ni la llave
  que sale de ella.
- **B:** guardar en el dispositivo la llave que sale de la frase (no exportable), para actualizar sin pedirla.

**Elegí A** porque así un dispositivo perdido no guarda nada que abra la copia del servidor (sí la clave local, como
hoy, que se corta cambiándola en el proveedor).
**Si preferís otra:** B ahorra pegar la frase una vez por cambio de clave.

### CS7 · Computadora prestada

**Qué pasaba:** en la computadora de un cliente o de un hotel, la persona quiere usar el asistente sin dejar la clave
guardada.
**Las opciones:**
- **A:** al desbloquear, la casilla *Keep the key on this device* (tildada de fábrica): destildada, la clave queda solo
  en esa pestaña y se pide la frase al recargar.
- **B:** siempre guardarla, y que la persona use *Forget key* o la casilla al salir.

**Elegí A** porque olvidarse de salir es lo común; con la casilla destildada no queda nada al cerrar la pestaña.
**Si preferís otra:** B es lo de hoy (la casilla al salir sigue en las dos).

### CS8 · Copia borrada de verdad

**Qué pasaba:** la regla de la app es que nada se borra de verdad (todo va a la papelera). Pero una copia de un secreto
que la persona pidió borrar no debería quedar.
**Las opciones:**
- **A:** *Stop syncing* borra la fila de verdad (excepción a la regla, solo para esta tabla).
- **B:** marcarla como borrada y dejarla.

**Elegí A** porque la regla protege el contenido de las páginas; acá lo que la persona quiere es que la copia no exista.
Las copias de seguridad del dueño la guardan por su tiempo, y la ayuda lo dice.
**Si preferís otra:** B no protege nada y deja un secreto viejo a mano.

### CS9 · El dueño del workspace ve que la copia existe

**Qué pasaba:** la copia vive en la base del dueño del workspace. Aunque no pueda leerla, el dueño ve en su base que la
persona tiene una copia, cuándo cambió y, en los registros de su Supabase, desde qué dirección IP se pidió. Ejemplo:
Lega sincroniza en el workspace de un cliente; el cliente ve que Lega usa el asistente y el día que cambió la clave.
**Las opciones:**
- **A:** aceptarlo y decirlo en la ventana y en la ayuda (*<workspace> stores only the encrypted copy and can't read
  it.*); con CS2, la copia está solo donde la persona eligió.
- **B:** esconderlo: copias falsas para todos, o guardar la copia fuera del Supabase del workspace.

**Elegí A** porque lo que se ve es poco (que existe y cuándo cambió; nunca el proveedor, ni la dirección, ni la clave,
gracias al relleno) y la persona elige dónde ponerla. B pide un servidor fuera de la isla del workspace o llenar todas
las bases de filas falsas, para esconder un dato que casi no dice nada.
**Si preferís otra:** si en algún workspace no querés que se vea ni eso, no la sincronices ahí (CS2): con una copia en
el tuyo alcanza.

**Las obvias** (valen salvo que digas otra cosa): con la política *Off* no se puede prender en ese workspace, pero sí
abrir o borrar una copia que exista; el modelo elegido viaja en la copia solo como valor inicial (después cada
dispositivo elige el suyo); no se sube `min_app_version`; la base local no sube de versión.

## 15. Lo que se mide en S1 y lo que no se pudo comprobar

- **Medir en el iPhone de Lega** cuánto tarda abrir (S1 trae una página de prueba). Si pasa de 1,5 s, se usan 600 000
  vueltas.
- **Que el gestor de contraseñas** (el llavero de iCloud, el de Chrome) ofrezca la frase en el campo *Passphrase* del
  iPhone y de la PC, y que guardarla con el formulario de *Turn on sync* funcione.
- CS1 a CS9 quedaron decididas sin preguntar (Lega pidió no preguntar); se cambian si Lega dice otra cosa.
- No se midió: el iPhone real; cuántos intentos por segundo hace una placa de video (es una estimación de números
  públicos de `hashcat`); que `signOut({ scope: 'others' })` corte de verdad un dispositivo con la app abierta (se ve en
  el recorrido de S1, paso 6).

## Correcciones de la auditoría (2026-10-02)

La auditoría independiente (nivel alto) dio "no aprobado" por un bloqueante de este documento (B2) y otro del MCP (B1,
en `Doc_Asistente.md`). El núcleo criptográfico, la tabla y su RLS (probados en `begin … rollback`) y lo de IndexedDB
quedaron confirmados. Corregido acá:

| Hallazgo | Corrección |
|---|---|
| **B2.** Un dispositivo perdido (con la sesión y la frase en su gestor) recibía la clave nueva al actualizar la copia; y con la frase podía armar un sobre con su dirección para recibir el texto de las páginas | "En corto", reglas 6 y 7, sección 3 (fila nueva y los cuatro pasos), *Sign out other devices* y *Replace synced key…* en S1, preguntar antes de adoptar un destino distinto y mostrar siempre host y final de la clave (2, 9), ayuda, pruebas 10 y 7, riesgos, recorrido de S1 pasos 6 y 7 |
| O3. Una copia vieja repuesta por el dueño abre | `savedAt` de adentro del sobre guardado en `sync` y rechazo de una más vieja (S2; 3, 6, 7, prueba 7) |
| O4. Actualizar con una frase mal tipeada dejaba una copia que nadie abre | Regla 7: abrir antes la copia con la frase; prueba 7 |
| O7. La mayúscula del teclado del iPhone no abría la frase generada | 4.3 y 4.4: minúsculas y guiones si tiene la forma de la generada; `autocapitalize="none"`; prueba 1 |
| O8. El relleno se medía en caracteres | 4.3: `bytes(JSON) ≤ 1 024`; prueba 1 |
| O9. La frase en el estado de React y en el portapapeles | 4.4 y 6: campos no controlados; guardar con el formulario del gestor antes que *Copy*, con aviso |
| O10. Una fila plantada por un dueño ajeno | 3 y 9: la fecha de la copia y *Your key is synced in <otro>* sin *Forgot it?* |
| O12. "Menos de un segundo" contra el umbral de 1,5 s; el ejemplo de la frase no era de la lista | Recorrido unificado a 1,5 s; la lista es la corta 1 de la EFF (3 a 5 letras), sin ejemplo inventado |
| Decisiones que quedaban para Lega | CS2, CS4 y CS9 decididas (Lega pidió no preguntar) |

## Re-verificación de las correcciones (2026-10-02): condiciones para implementar

Las correcciones quedaron aprobadas. Cuatro puntos nuevos, ninguno bloqueante para el diseño, que la implementación
tiene que cumplir:

- **R1 (condición de S1):** la normalización de la frase (O7) tiene que ser **una sola función, la misma al cifrar y al
  abrir**, con su prueba: si se cifra la frase tal cual y se abre normalizada, una frase propia de seis palabras con
  mayúsculas nunca abre en otro dispositivo.
- **R2 (condición de M2):** confirmar una acción desde la app vence igual que `confirm_action` (5 minutos) y pasa por las
  mismas comprobaciones (permisos, quién ve la página, topes).
- **R3:** donde quede escrito que con la casilla de invitados se puede mover adentro de una página con invitados, vale lo
  de B1: mover nunca cambia quién ve la página. Los títulos que devuelve `list_pages` cuentan como contenido no confiable
  (igual que el texto de las páginas).
- **R4:** las decisiones CS1 a CS9 e IA11 están decididas (Lega pidió no preguntar; quedan en su lista para cambiarlas si
  quiere), no «propuestas».

## Cómo se midió

- **Derivación:** un script fuera del repo con Node 22.23 y
  Playwright 1.63 (`playwright-core`) sin ventana, Chromium 153 y WebKit 26.6, en una dirección `https` falsa servida por
  el propio script (WebCrypto pide un contexto seguro). PBKDF2 con `crypto.subtle.deriveKey` más un `encrypt` de
  prueba; Argon2id con `hash-wasm` (WebAssembly). Cinco corridas por fila, mediana y mínimo. PC: Intel Core i9-14900K,
  192 GB, Windows 11.
- **El sobre:** otro script fuera del repo (Node 22): cifrar, abrir y los seis casos que no tienen que abrir de la sección 4.3.
- **Adivinar:** la cuenta de la sección 4.2 usa unos 9 000 millones de vueltas de PBKDF2-SHA256 por segundo por placa,
  del orden de lo que publican los benchmarks de `hashcat` para las placas más rápidas de 2023-2024; no se midió acá.

## Cómo quedó S1 (v0.138)

**Qué hay.** La migración `20261023120000_clave_sincronizada.sql` (la tabla de la sección 5, con una condición más:
la sesión tiene que ser de la app, `private.session_allowed()`, como en el resto de la base; no sube `schema_version`,
sin aplicar). En el dispositivo: el sobre (`src/assistant/keySync.ts`, con la lista de la EFF en `wordlist.ts`), la
tabla (`keySyncRemote.ts`), los pasos sin interfaz (`keySyncFlow.ts`) y la sección *Sync across my devices* de
*Assistant…* (`KeySyncSection.tsx`): *Turn on sync…* (frase generada o propia), *Unlock* (muestra el destino y el
final de la clave, y pregunta si cambia), *Update synced key*, *Replace synced key…*, *Stop syncing*, *Choose a new
passphrase…* (el *Forgot it?*), y los estados sin red, sin la tabla, con *Off* y con la copia en otro workspace. En el
menú de la cuenta, *Sign out other devices* (`SignOutOthersDialog.tsx`). El panel sin clave suma *Unlock your synced
key*; la ventana de salir, el aviso de la copia; la ayuda, *Sync your assistant key* con los cuatro pasos del
dispositivo perdido. La base `shotdocs-assistant` sigue en la versión 1: lo nuevo es el campo opcional `sync` del
registro (con dos campos más que los de la sección 6: `name`, para mostrar el workspace, y `localChanged`, que marca
que la clave del dispositivo cambió después de abrir o subir la copia y hace aparecer *Update synced key*).

**Lo que cambió del diseño al implementar:**

- **La lista tiene 1 295 palabras**, no 1 296: la de la EFF trae "yo-yo", que con guiones de separador no se distingue
  de dos palabras, y ya trae "yoyo". Sacarla deja 6 × log2(1 295) ≈ 62,0 bits, lo mismo en la práctica.
- **La forma de "la generada" es cualquier frase de seis palabras de letras** (separadas por guiones o espacios): se
  pasa a minúsculas con guiones. Una frase propia de seis palabras queda igual de normalizada al cifrar y al abrir (R1),
  así que en ella las mayúsculas no cuentan; una propia con otra forma se usa tal cual.
- ***Replace synced key…* sube la clave que está guardada en el dispositivo**, con la frase actual (que abre la copia,
  regla 7) y una nueva. La clave nueva se pega antes arriba, con *Save*: así hay un solo lugar donde se escribe una
  clave. La ayuda y la ventana lo dicen en ese orden.
- ***Stop syncing* también está cuando la copia no se abrió en este dispositivo** (para borrar una copia que no se puede
  abrir o que no es de la persona).
- **La medición del iPhone no tiene una página aparte:** *Unlock* es la medición (en Chromium de esta PC, perfil de
  teléfono, 170 ms). Si en el iPhone de Lega tarda más de 1,5 s, se agrega `format = 2` con 600 000 vueltas.

**Probado.** Vitest: el sobre (13 pruebas: ida y vuelta, Node abre sin el código de la app con PBKDF2 de 1 000 000 de
vueltas, los vectores de RFC 7914, lo que no abre, los parámetros y la dirección de la fila que no mandan, el relleno en
bytes, R1, NFKC, la generada sin sesgo con un millón de sorteos, la propia), los pasos (14: dos dispositivos, regla 6,
regla 7, la escritura condicional, *Forgot it?*, *Stop syncing*, nada en claro en lo que sale, lo guardado y la
consola, la base en la versión 1 leída como la lee `main`), la ventana (15: cada estado de la sección 9, prender con la
generada y con una propia, abrir con una frase mala y con la buena, preguntar ante un destino nuevo, *Update* con una
frase mala, el aviso de "cambió en otro dispositivo", *Stop syncing*, la ventana de salir, la ayuda), el panel (1) y
*Sign out other devices* desde el menú (2). 27 mutantes de la app, los 27 detectados. SQL en `begin … rollback`:
`clave_sincronizada_permisos.sql` pasa, las otras 25 pruebas pasan con la migración, y 12 mutantes (sin `client_id`,
sin `user_id`, sin la sesión de la app, `update` e `insert` a todas las columnas, el trigger sin generación o sin el id,
`anon` lee, los `check` de versión y de largo, sin `cascade`, en Realtime), los 12 detectados. Recorrido en Chromium
sin ventana con dos perfiles (la PC y un teléfono) sobre la app real, una tabla falsa compartida y un proveedor falso:
prender, abrir en el otro con una frase mala y con la buena (con mayúscula inicial), el panel corrige con la clave
abierta, sin red, la versión sin S1 (`keyStore.ts` de `main`) lee y usa la clave en el mismo perfil y la app nueva
sigue después, el destino nuevo (*Keep my current key* / *Use it*), *Sign out other devices*, *Stop syncing* y que la
frase y la clave no salen a la base ni a la consola: 37 de 37.

**Falta (S2 y lo que no se pudo probar acá):** *Change passphrase…*, *Keep the key on this device*, el aviso de
"cambió en otro dispositivo" (hoy un dispositivo que ya abrió la copia no se entera de una actualización: sigue con su
clave, regla 5), el botón en el 401, rechazar una copia más vieja (`savedAt`) y *Also sync in this workspace*. Sin
probar acá: el iPhone de verdad (tiempo y teclado), que el gestor de contraseñas ofrezca guardar y completar la frase,
y que `signOut({ scope: 'others' })` corte de verdad otro dispositivo (los tres en el recorrido de Lega, sección 12).

**Correcciones de la auditoría de S1** (aprobada con observaciones, ninguna bloqueante):

- **O1.** Un dispositivo que ya había abierto la copia no se enteraba de que cambió en otro (*Update* o *Replace*
  allá) y seguía diciendo *Synced in…*. Ahora, si la generación de la copia es mayor que la que abrió, la sección dice
  *Your synced key changed on another device. Enter your passphrase to update it here.* y pide la frase (el aviso
  liviano de S2, sin consultas aparte: se ve al abrir *Assistant…*). Hasta entonces la clave del dispositivo sigue
  (regla 5). La ayuda y el texto de *Replace synced key…* lo dicen.
- **O2.** Con el mismo destino, *Unlock* reemplazaba sin preguntar una clave del dispositivo distinta de la copia.
  Ahora pregunta *Replace the key on this device (…L0c4) with the synced one (…z1Z2)?*, salvo que la clave del
  dispositivo haya venido de esta misma copia y no se haya cambiado después (el caso de O1, donde la persona quiere la
  nueva).
- **O3.** Prueba de que la llave derivada es no exportable (al cifrar y al abrir). **O4.** *Sign out other devices*
  nombra el workspace por su host si no tiene nombre. **O5.** El mutante "sin `user_id` en el `with check`" es
  equivalente (los permisos por columna y el trigger ya lo impiden), anotado en la prueba SQL y en `Doc_Supabase.md`.

## Cómo quedó S2 (v0.0XX)

**Qué hay.** Sin migración ni cambios en la tabla, sin subir `schema_version` ni `min_app_version`; la base
`shotdocs-assistant` sigue en la versión 1.

- ***Change passphrase…*** (copia abierta): la frase actual abre la copia (regla 7) y lo mismo que tenía (clave, destino,
  modelo, la de *Voice*) se vuelve a cifrar con la nueva, con sal e iv nuevos. No sube la clave del dispositivo (para eso
  están *Update* y *Replace*). El dispositivo que la cambió sigue al día; los otros ven "cambió en otro dispositivo".
- ***Keep the key on this device*** (tildada de fábrica, con `data-tip`) debajo de *Unlock*. Destildada, la clave y la
  de *Voice* quedan en una variable de `keyStore.ts` y de `voiceSettings.ts`, que mientras existe manda sobre lo
  guardado: leer, cambiar el modelo y el aviso "cambió" andan, y la base no se toca. *Forget key* olvida solo la de la
  pestaña (si el dispositivo tenía una guardada de antes, vuelve a valer); la casilla de salir olvida las dos. La
  sección dice *This key is only in this tab…*, y *Stop syncing* avisa que la clave se va al recargar.
- **Una copia más vieja no se adopta:** `unlockSync` compara el `savedAt` de adentro del sobre con el que anotó el
  dispositivo para ESE workspace (*This synced copy is older than the one on this device.*). Cada sobre nuevo lleva un
  `savedAt` posterior a los conocidos (`nextSavedAt`: la copia abierta, la anotación, y en *Forgot it?* la hora de la
  fila), así un reloj atrasado no hace que los otros dispositivos rechacen la copia nueva.
- **El botón en el 401** (`SyncedKeyHint.tsx`): si el proveedor rechaza la clave y la copia de este workspace es más
  nueva que la anotada, el error del panel y el de *Dictate to report* suman *Enter your passphrase to update it here*
  (abre *Assistant…*); si el dispositivo nunca abrió la copia, *Unlock your synced key*. El panel cambia en tres líneas
  (el tipo del error, el `keyRejected` y el botón).
- ***Also sync in this workspace…*** (CS2): en un workspace sin copia, con la clave sincronizada en otro, la sección dice
  *Your key is synced in <otro>.* y ofrece subir otra copia con la misma frase escrita dos veces (regla 7: la de allá no
  se abre desde acá), o una frase nueva. El registro del dispositivo suma `moreSync` (las copias de los otros
  workspaces, cada una con su generación); `sync` sigue siendo la primera. Una clave nueva marca todas; *Update* actualiza
  la de ese workspace; *Stop syncing* saca solo esa anotación; abrir en un workspace una copia con otra clave marca las de
  los otros.
- **La observación de la re-verificación de S1:** con la copia cambiada en otro dispositivo, *Choose a new passphrase…*
  (y el *Forgot it?*) ya no aparece, aunque la clave de este dispositivo se haya cambiado alguna vez. Quien perdió la
  frase nueva usa *Stop syncing* y prende de nuevo, con la confirmación a la vista.
- **La clave de *Voice* viaja en el mismo sobre** (campo opcional `voice`, sin cambiar el formato: una versión con S1 lo
  ignora al abrir). Se sube si *Voice* usa una clave propia; al abrir se guarda en *Voice*. La regla 6 vale también para
  ella: si va a otro destino que el que usa hoy *Voice* (la propia o la del asistente), o al mismo con otra clave, se
  pregunta junto con lo demás. Cambiar la clave o el destino de *Voice* marca las copias para *Update*; el modelo solo,
  no. Una copia sin *Voice* no le saca la suya al dispositivo (regla 5).
- **La ventana de salir** dice cuántas notas de voz quedan sin ubicar en ese workspace (*You have 3 voice notes to place
  on this device.*) con la casilla destildada *Also delete them*; *Also forget my assistant key…* olvida también la de
  *Voice* (O5 del dictado). Se abre también sin clave del asistente si hay notas o clave de *Voice*.
- La ayuda suma *Change your passphrase, borrowed computers and other workspaces*.

**Decisiones de la implementación:**

- ***Change passphrase…* vuelve a cifrar el contenido de la copia, no la clave del dispositivo.** Si fuera la del
  dispositivo, cambiar la frase en uno desactualizado pisaría la clave nueva con la vieja (el mismo problema de la
  observación de S1).
- **Una sola anotación por workspace** (`sync` + `moreSync`) en vez de cambiar el campo `sync` a una lista: la versión
  con S1 lee `sync` y sigue andando; si guarda, saca `moreSync` (pierde solo el aviso de esas copias).
- ***Also sync* con la frase dos veces**, no abriendo la copia del otro workspace: desde un workspace no hay sesión del
  otro, y la regla 7 lo prevé ("si no hay copia, la piden dos veces").
- **La clave de *Voice* dentro del mismo sobre de 1 KB**, sin `format = 2`: una clave de Anthropic más una de OpenAI con
  sus modelos ocupan unos 500 bytes. Si una dirección muy larga no entra, la sección dice *This key or Base URL is too
  long to sync.* (no se sube sin *Voice* en silencio).

**Probado.** Vitest: 13 pruebas de los pasos (`keySyncS2.test.ts`) y 11 de la ventana (`keySyncS2Ui.test.tsx`), más las
de S1 sin cambios; la suite entera, 3545 con `main` v0.141 unido (con las correcciones de la auditoría). 22 mutantes de las guardas (Change passphrase sin abrir antes o subiendo la
clave del dispositivo, la copia más vieja, el `savedAt` sin los conocidos, *Keep the key* que guarda igual, las copias de
otros workspaces, *Also sync* sin comparar, *Forgot it?* con la copia cambiada, la regla 6 y la 5 en *Voice*, el 401
siempre, salir borrando sin la casilla, etc.), los 22 detectados. Recorrido sin ventana con dos perfiles, dos tablas
falsas y el proveedor falso: 36 de 36 en Chromium y 36 de 36 en WebKit. Lo que Lega prueba a
mano está en "Recorrido de Lega (S2)" (sección 12), más: *Also sync in this workspace* en un segundo workspace y salir
con notas de voz pendientes.

**Falta:** el iPhone de verdad (tiempo de *Unlock*, teclado, gestor de contraseñas) y `signOut({ scope: 'others' })`
contra otro dispositivo, que siguen en el recorrido de Lega. *Keep the key on this device* no tiene botón para pasar
después la clave de la pestaña al dispositivo (se vuelve a abrir con la casilla tildada).

**Correcciones de la auditoría de S2** (aprobada con observaciones, ninguna bloqueante):

- **O1.** En la computadora prestada, *Stop syncing* decía *Your key stays on this device.* Ahora dice que la clave está
  solo en la pestaña y que al recargar no va a estar en esa computadora (antes y después de borrar).
- **O2.** *Forget key* en modo pestaña borraba también la clave que el dispositivo tenía guardada de antes. Ahora olvida
  solo la de la pestaña (`forgetTabKey`) y la guardada vuelve a verse; la casilla de salir sigue olvidando todo.
- **O3.** *Choose a new passphrase…* aparecía con la copia cambiada si la clave local se había cambiado alguna vez (un
  pegado de hace semanas habilitaba pisar la copia nueva). Ya no aparece con la copia cambiada; queda *Stop syncing*.
- **O4.** Si lo único que se preguntaba era la clave de *Voice*, *Keep my current key* tampoco guardaba la del
  asistente y decía que la clave de ahora quedaba aunque no hubiera ninguna. Ahora el botón es *Keep my voice key*: toma
  la del asistente, deja la de *Voice* del dispositivo y lo dice.
- **O5.** Prueba de que *Change passphrase…* desde un dispositivo atrasado no lo anota como al día (mata el mutante M6).
- Queda para el roadmap el caso improbable de la auditoría: *Change passphrase…* no aplica el rechazo de la copia más
  vieja a lo que abre (haría falta un dueño que reponga una fila vieja con la misma generación que el dispositivo
  conoce; no filtra nada).

Mutantes después de las correcciones: 27, los 27 detectados.
