# La clave del asistente en todos tus dispositivos (D72 → B)

**Estado: diseño, sin código** (roadmap P.24; pedido de Lega del 2026-10-02, que cambió D72 de A a B: "la clave
sincronizada entre tus dispositivos, cifrada con una frase que solo sabés vos"). Reemplaza la parte de IA1 de
`Doc_Asistente.md` que decía "se carga una vez por dispositivo"; todo lo demás de la sección 4 de ese documento (la
clave local, *Forget key*, la casilla al salir) sigue igual. Diseñado contra `main` v0.129. Las decisiones están
propuestas (CS1 a CS8, sección 14) y valen hasta que Lega diga otra cosa. Los tiempos están medidos en esta PC (sección
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
  Si se pierde un dispositivo, lo único que corta de verdad es **cambiar la clave en el proveedor** y actualizar la
  copia. Y una frase que se filtra no se "des-filtra": las copias de seguridad del dueño guardan la versión vieja
  cifrada; por eso, ante la duda, se cambia la clave en el proveedor.
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
3. Para seguir, la persona confirma: *I saved my passphrase* (casilla) → *Turn on sync*. La app cifra y sube; dice
   *Your key is synced in <workspace>.*

**Desbloquear en otro dispositivo** (el iPhone, sin clave cargada):

1. *Assistant…* (o el panel, que hoy dice *Set up the assistant*) muestra *Your key is synced. Enter your passphrase to
   use it on this device.*, el campo de la frase (el gestor de contraseñas la ofrece) y *Unlock*.
2. Con la frase correcta: la clave queda en el dispositivo como hoy (cifrada con la llave del dispositivo) y el panel
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
| El mismo dueño | — | Volver a poner una fila vieja (una clave anterior) o borrar la fila | No se puede impedir. Daño: el dispositivo nuevo abre una clave vieja (que, si se cambió en el proveedor, da *Key doesn't work*) o no encuentra la copia. No filtra nada |
| El mismo dueño | Los registros de la API de su Supabase | Saber cuándo un dispositivo nuevo pidió la fila | No se oculta. Es poco: no ve la frase ni si abrió |
| **Quien roba la base** (o una copia de seguridad) | Lo mismo que el dueño, de todas las personas | Lo mismo: adivinar sin conexión, una persona por vez (cada fila tiene su sal) | Igual que arriba |
| **Las copias de seguridad del dueño** (`z_shotdocs_backup`, cuatro por día) | Las versiones viejas del bloque cifrado, por el tiempo que se guarden | Abrir una copia vieja con una frase vieja que se filtró | Cambiar la frase no borra las copias viejas: si la frase se filtra, **se cambia la clave en el proveedor** (la vieja deja de servir). La ayuda lo dice |
| **Otro miembro, un invitado, un visitante del link público** | Nada | Leer la fila | RLS: solo `user_id = auth.uid()`; `anon` sin permisos |
| **Un cliente MCP conectado** (un tercero con un token de la persona, `Doc_Asistente.md` 9.2) | Nada | Leer la fila y adivinar la frase | El token cerrado de fábrica (rol propio o `db_pre_request`) y además la política exige `client_id` vacío |
| **El portero** | Nada | — | Nunca la pide ni la recibe |
| **Quien usa el dispositivo** con la sesión abierta | La clave local (como hoy) | Usarla | Lo mismo que hoy: *Forget key*, la casilla al salir, *Keep the key on this device* destildada en una computadora prestada, el tope de gasto en el proveedor |
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
  abierta la puede usar. El remedio es el del proveedor: **crear una clave nueva y borrar la vieja en su consola**,
  pegarla en *Assistant…* y *Update synced key* (pide la frase). Los demás dispositivos, al fallar la vieja, ven *Your
  synced key changed on another device. Enter your passphrase to update it here.* (S2). La ayuda lo explica paso a paso.
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
  las puntas. **La sal:** 16 bytes al azar, nueva en cada cifrado. **La llave:** PBKDF2-SHA256, 1 000 000 de vueltas,
  AES-GCM de 256 bits, **no exportable**, que se usa y se suelta (nunca se guarda).
- **Lo cifrado** (JSON): `{ provider, baseUrl, model, apiKey, savedAt }`, **relleno a 1 024 bytes** con espacios al
  final. Sin relleno el largo delata el proveedor (una clave de Gemini mide 39 caracteres; una de OpenAI, más de 150).
  Una dirección de más de 300 caracteres no se acepta (*That Base URL is too long to sync.*).
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
  de la EFF** (1 296 palabras en inglés, cortas y sin parecidos; licencia CC BY 3.0, se suma a
  `THIRD_PARTY_NOTICES.md`; unos 8 KB en la parte que se baja con el asistente). Separadas por guiones:
  `vapor-lunar-tile-anchor-sprout-yarn`.
- *New one* propone otra. *Copy* la copia. El campo es de contraseña con `autocomplete="new-password"` y un usuario
  oculto *Shot Docs assistant key*, para que el gestor de contraseñas la guarde con un nombre propio (la app entra con
  código, así que es la única "contraseña" del sitio).
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
  va **adentro del registro de siempre**, en campos opcionales: `sync?: { ref, userId, generation, unlockedAt }` (de qué
  workspace y qué versión de la copia vino la clave).
- Al desbloquear, la clave se guarda como hoy (`saveSettings` con la llave del dispositivo) y se anota `sync`. Con *Keep
  the key on this device* destildada (S2), la clave queda en una variable del módulo del asistente, solo en esa pestaña,
  y nada se escribe en la base (ni `sync`): al recargar no está. Es la única excepción a "la clave no queda en ninguna
  variable" de `Doc_Asistente.md` sección 4: una variable del módulo (nunca `window` ni el estado de React), que un
  script dentro de la app podría leer igual que hoy puede usar la clave guardada; no agrega exposición.
- La frase vive en el campo hasta tocar *Unlock*; se pasa a la derivación y se vacía el campo. La llave derivada se usa
  para abrir o cerrar y se suelta. **Nunca** se guarda ni la frase ni la llave derivada (CS6).

## 7. Dos dispositivos a la vez

- Cada cambio sube `generation` (el trigger). La app escribe con `update … where user_id = <id> and generation =
  <la que leyó>`; si no cambia ninguna fila, otro dispositivo cambió la copia en el medio: *Your synced key changed on
  another device. Reload it?* y no pisa nada. La primera vez, `insert`; si choca (`23505`), lo mismo.
- **Saber que cambió** (S2): al abrir *Assistant…* o el panel con red, una consulta de `generation` (una fila chica, sin
  el cifrado). Si es mayor que `sync.generation` del dispositivo, la ventana dice *Your synced key changed on another
  device. Enter your passphrase to update it here.*; hasta que la persona lo haga, la clave local sigue andando (regla
  5). Si la clave local da *Key doesn't work* (401) y hay una copia más nueva, el error suma ese mismo botón.

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
| Con copia, abierta en este dispositivo | *Synced in <workspace> · updated <fecha>.* · *Update synced key* (si la clave local es otra) · *Change passphrase…* (S2) · *Stop syncing* |
| Con copia, sin clave en este dispositivo | *Your key is synced. Enter your passphrase to use it on this device.* · campo *Passphrase* con *Paste* · *Keep the key on this device* (S2) · *Unlock* · *Forgot it? Paste your API key again and choose a new passphrase.* |
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
- **La ventana de salir:** la ayuda de la casilla suma *Your synced copy stays in this workspace, protected by your
  passphrase.* si hay copia.
- Tooltips con `data-tip` solo donde agregan algo (en *Keep the key on this device*: *Off on a borrowed computer: the
  key lives only in this tab.*). Sin atajos nuevos.

## 10. Ayuda

Una entrada nueva en "Writing", *Sync your assistant key*, en los dos idiomas: qué hace, dónde queda la copia y quién
la ve (cifrada), por qué la frase generada, qué pasa si se olvida, qué hacer si se pierde un dispositivo o se filtra la
frase (cambiar la clave en el proveedor) y *Keep the key on this device* en una computadora prestada. La entrada *Your
assistant key* de A1 cambia su frase "se carga en cada dispositivo".

## 11. Pruebas

**Vitest, sin red:**

1. El sobre: ida y vuelta; un vector fijo de PBKDF2-SHA256 (de RFC 7914, sección 11, con sus vueltas) para atar la
   derivación; frase equivocada, sal, iv, id, versión y un byte del cifrado cambiados → no abre; una versión
   desconocida → el mensaje de "versión más nueva"; NFKC y espacios de las puntas; el relleno da siempre 1 388
   caracteres (con una clave de Gemini y una de OpenAI); una dirección de más de 300 caracteres se rechaza.
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
   aviso; el aviso de "cambió en otro dispositivo"; el 401 con una copia más nueva suma el botón.
8. La interfaz: cada fila de la tabla de la sección 9 (con y sin red, sin la tabla, política *Off*), el panel sin clave
   con copia, la ventana de salir con copia.
9. Ayuda: la entrada nueva en los dos idiomas (la prueba de siempre de `src/help/`).

**SQL (`supabase/tests/`, en `begin … rollback`):**

10. La persona lee, crea, cambia y borra su fila; otra persona (miembro, admin, el dueño con su sesión de la app) no la
    ve ni la cambia; `anon` nada; un JWT con `client_id` nada (ni la suya); no se puede cambiar `user_id` ni escribir
    `generation`; los `check` de largo y de versión; el trigger sube `generation`. Mutantes: sacar la condición de
    `client_id`, sacar la de `user_id`, dar `update` a todas las columnas: cada uno tiene que hacer fallar una prueba.

**Recorrido en Chromium** (el arnés de A1 con la app real sobre el servidor en memoria y dos perfiles como "dos
dispositivos"): prender en uno, desbloquear en el otro, frase equivocada, *Stop syncing*, sin red, y el teléfono.

## 12. Entregas

| | Qué | Criterio de aceptación | Riesgo |
|---|---|---|---|
| **S1** | La migración con sus pruebas SQL; el sobre (`src/assistant/keySync.ts`) con la frase generada y la propia; en *Assistant…*: *Turn on sync…*, *Unlock*, *Update synced key* (con la escritura condicional por `generation` de la sección 7, para no pisar otro dispositivo), *Stop syncing*, los estados sin red, sin tabla y con *Off*; el panel sin clave con *Unlock your synced key*; la casilla de salir; la ayuda; la lista de la EFF con su aviso de licencia; la medición en el iPhone (sección 4.1) | Pruebas 1 a 6, 8, 9 y 10 y la parte de la prueba 7 que no pisa otro dispositivo, en verde, con sus mutantes muertos; el recorrido en Chromium; ningún texto en claro en la red ni en lo guardado; la auditoría independiente (nivel alto: seguridad de un secreto) | **Alto**: un secreto de la persona en la base de otro |
| **S2** | *Change passphrase…*, *Keep the key on this device*, el aviso de "cambió en otro dispositivo" y el botón en el 401, *Also sync in this workspace* | Pruebas 6 y 7 completas; el recorrido con dos dispositivos | Medio |

**Recorrido de Lega (S1)**, con su clave de verdad y la migración aplicada en Wanka:

1. En la PC: *Assistant…* → la clave guardada → *Sync across my devices* → *Turn on sync…* → *Copy* → guardarla en el
   gestor de contraseñas → *I saved my passphrase* → *Turn on sync*: dice *Your key is synced in Wanka.*
2. En el iPhone (sin clave cargada): *Assistant…* → *Your key is synced…* → pegar la frase → *Unlock*: tarda menos de un
   segundo y el panel corrige un texto.
3. En el iPhone, *Forget key*; *Unlock* con una frase equivocada: *That passphrase doesn't open your synced key.*; con la
   buena, abre.
4. Modo avión: la sección dice *Syncing your key needs internet.* y sus botones quedan apagados; al volver la red, el
   panel usa la clave ya abierta sin pedir nada.
5. En la PC: *Stop syncing* → *Delete copy*. En el iPhone, después de *Forget key*, *Assistant…* ya no ofrece *Unlock*.

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
| La frase o la clave quedan en algún lado | Nunca se guardan; prueba 5 busca en red, IndexedDB, `localStorage` y consola |
| Un cliente MCP lee la fila | La política exige `client_id` vacío, además del token cerrado de fábrica; prueba 10 |
| Una versión vieja se queda sin asistente | La base local no sube de versión; prueba 6 |
| Dos dispositivos se pisan | `generation` y la escritura condicional (7); prueba 7 |
| La persona olvida la frase | Se vuelve a pegar la clave; la clave local de cada dispositivo no se toca |
| En el iPhone tarda mucho | Medir en S1; si pasa de 1,5 s, versión con 600 000 vueltas |
| Una frase filtrada sigue abriendo copias viejas en las copias de seguridad | Dicho en la ayuda: ante la duda, cambiar la clave en el proveedor |

## 14. Decisiones (propuestas el 2026-10-02, valen hasta que Lega diga otra cosa)

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

**Las obvias** (valen salvo que digas otra cosa): con la política *Off* no se puede prender en ese workspace, pero sí
abrir o borrar una copia que exista; el modelo elegido viaja en la copia solo como valor inicial (después cada
dispositivo elige el suyo); no se sube `min_app_version`; la base local no sube de versión.

## 15. Lo que valida Lega y lo que no se pudo comprobar

- **Medir en su iPhone** cuánto tarda abrir (S1 trae una página de prueba). Si pasa de 1,5 s, se usa 600 000 vueltas.
- **Que el gestor de contraseñas** (el llavero de iCloud, el de Chrome) ofrezca la frase en el campo *Passphrase* del
  iPhone y de la PC.
- Las decisiones CS1 a CS8, sobre todo CS2 (solo donde la prendés) y CS4 (frase generada de fábrica).
- Que acepte que el dueño de un workspace **ve que existe la copia y cuándo cambió**, aunque no la pueda leer.
- No se midió: el iPhone real; cuántos intentos por segundo hace una placa de video (es una estimación de números
  públicos de `hashcat`).

## Cómo se midió

- **Derivación:** un script fuera del repo con Node 22.23 y
  Playwright 1.63 (`playwright-core`) sin ventana, Chromium 153 y WebKit 26.6, en una dirección `https` falsa servida por
  el propio script (WebCrypto pide un contexto seguro). PBKDF2 con `crypto.subtle.deriveKey` más un `encrypt` de
  prueba; Argon2id con `hash-wasm` (WebAssembly). Cinco corridas por fila, mediana y mínimo. PC: Intel Core i9-14900K,
  192 GB, Windows 11.
- **El sobre:** otro script fuera del repo (Node 22): cifrar, abrir y los seis casos que no tienen que abrir de la sección 4.3.
- **Adivinar:** la cuenta de la sección 4.2 usa unos 9 000 millones de vueltas de PBKDF2-SHA256 por segundo por placa,
  del orden de lo que publican los benchmarks de `hashcat` para las placas más rápidas de 2023-2024; no se midió acá.
