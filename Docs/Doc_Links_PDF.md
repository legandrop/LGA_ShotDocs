# Links a los archivos en el PDF y *Request access* (P.30)

**Estado: diseño auditado el 2026-10-03 ("aprobado con condiciones" en E1, E2 y E3) y corregido; E1 en programación.**
Pedido de Lega del 2026-10-03, diseñado contra `main` v0.158. Toca permisos, Row Level Security y privacidad, y suma una
tabla: **riesgo alto**. Las decisiones ya tomadas por Lega están en "Qué se pide"; las nuevas (LF1 a LF16, sección 10)
son propuestas con la recomendación tomada; LF17 a LF20 son de Lega, sobre los hallazgos de la auditoría. **Las
correcciones de la auditoría (sección 15) mandan sobre lo de arriba.**
La migración de la entrega 2 está en borrador (sección 7), probada contra la base real en una transacción que se
deshace (sección 9).

## En corto

- **Hoy:** en el PDF (exportar o imprimir) un adjunto, un video o una carpeta salen **solo como imagen, sin link**
  (`src/ui/printView.ts` cambia el `<video>` por su cuadro y no agrega ningún `<a>`; la tarjeta de un adjunto o de una
  carpeta es una imagen SVG con el nombre dibujado). `Doc_Exportar.md` decía lo contrario: corregido.
- **La dirección fija de cada archivo:** `https://shotdocs.lega.com.ar/f/<clave local>/<id>#ws=<servidor>`. El camino
  dice qué workspace (su clave local) y qué archivo; después del `#` (que no llega a ningún servidor) van la dirección y
  la clave publicable del Supabase de ese workspace, como en un link de invitación. Con eso cualquier dispositivo sabe a
  qué Supabase conectarse, sin ningún servicio central (LF1, LF2).
- **Qué pasa al abrirla:** con sesión y permiso, la foto o el video en el carrete, el PDF o el adjunto con *Open* y
  *Download*, la carpeta en su visor con *Download all*. Sin sesión, el login de ese workspace y de vuelta a la misma
  dirección (LF15). Con sesión y sin permiso, **«You don't have access to this file»** con **Request access**. «No
  existe», «sin acceso», «en la papelera» y «proyecto borrado» dan **la misma pantalla**, sin el nombre del archivo, del
  proyecto ni de la página (LF4).
- **En el PDF:** cada tarjeta de adjunto, cada carpeta y cada video llevan un link a esa dirección (el área entera de la
  tarjeta, medida en Chromium) y el nombre debajo como texto con link (LF5, LF6). Las fotos no llevan link. La tarjeta de
  un link de Drive pegado sigue como está.
- **Con un link público vivo** sobre la página, **solo desde la ventana *Export*** (nunca al imprimir con ⌘P/Ctrl+P,
  LF17), los links del PDF van con el token de ese link (`/f/<clave local>/<id>#link=…`), con un aviso que nombra la
  página y el nivel del link y una casilla (destildada si el link es *Can edit*, LF18): quien tiene el PDF abre como quien
  tiene el link. Revocarlo o *Reset link* los apaga; la pantalla del link muerto ofrece entrar con una cuenta (LF7, LF16).
- **Request access (entrega 2):** una tabla nueva, `access_requests`, cerrada con Row Level Security y sin políticas: solo
  la tocan tres funciones. Pedir responde lo mismo exista o no el archivo; tope de 20 pedidos nuevos por persona por día.
  Lo ven y lo deciden quienes pueden compartir alguna página viva que usa el archivo (dueño, admins con nivel 4, dueño
  del proyecto aunque sea miembro común, LF19), en la campana y en *Share* de la página; antes de mandar, quien pide
  sabe que esas personas van a ver su correo y su rol. Rechazar es un parámetro explícito (LF20). Aceptar da un permiso de los de siempre (`share()`) sobre una
  de esas páginas, *Can view* por defecto, y nunca baja uno que ya existe. Sin correo (B.8 queda como está).
- **Sin cuenta no se pide acceso:** el registro sigue cerrado (D-09). El login lo explica; para alguien de afuera sin
  cuenta, el camino es el link público (LF3).
- **Nada nuevo en el portero.** El archivo se abre con `POST /pass` y `/m/<pase>` de siempre, con la sesión de la
  persona o el header del link.
- **Entregas:** E1 = la dirección y los links en el PDF, sin migración (riesgo medio). E2 = *Request access* con la tabla
  (riesgo alto). E3 (opcional, bajo) = *Request access* también al abrir `/p/<id>` sin acceso.

**En términos simples:** cada archivo de una página pasa a tener una dirección propia que no vence. El PDF la lleva en
cada tarjeta y en cada video, así quien lo recibe hace clic y abre el archivo en Shot Docs si tiene permiso, igual que
si lo abriera desde la página. Si no lo tiene, ve un cartel que no dice nada del archivo y un botón para pedirlo; el
dueño ve el pedido en la campana y lo acepta dándole permiso a la página donde está el archivo. Si la página estaba
compartida con un link público, el PDF usa ese link, así el cliente sin cuenta también abre; y si se corta el link, se
cortan los del PDF.

## Qué se pide

Lega, 2026-10-03: hoy en el PDF los adjuntos, los videos y las carpetas salen solo como imagen. Quiere que quien recibe el
PDF pueda hacer clic y abrir el video, el PDF o la carpeta (y bajarla) si tiene acceso, y si no lo tiene, que pueda
pedirlo. Decidido por Lega (se respeta tal cual; donde el código pide un ajuste, está marcado):

1. **Dirección fija por archivo**, una ruta de la app (`/f/<workspace>/<id>`): con sesión y permiso abre la foto o el
   PDF, reproduce el video, y la carpeta abre en su visor con *Download all*; sin sesión, el login y después vuelve a esa
   ruta; con sesión y sin permiso, «You don't have access» con **Request access**.
2. **Cada tarjeta y cada video del PDF** llevan un link a esa ruta: la tarjeta entera cliqueable y abajo el nombre como
   texto de link. El link de la tarjeta de Drive pegada sigue como está.
3. **Request access:** un pedido en la base, tabla nueva con Row Level Security (quién, qué archivo o página, cuándo). El
   dueño y los admins lo ven en la app y lo aceptan dando un permiso con los grants que ya existen, o lo rechazan. Sin
   mail por ahora (va al roadmap).
4. **Con un link público activo** al exportar, los links del PDF van por el link público; si se revoca, dejan de andar.
5. **Privacidad:** el link no revela nada sin permiso. La ruta sin acceso no muestra ni el nombre del proyecto ni el de
   la página.
6. La ayuda y la nota corregida en `Doc_Exportar.md`.

**Ajustes marcados** (la alternativa más segura, con su porqué en la sección 10): el `<workspace>` del camino es la
**clave local** y la dirección del Supabase va además después del `#` (LF1); los pedidos los deciden **quienes pueden
compartir** una página que usa el archivo, no todos los admins (LF10); la tabla guarda pedidos de **archivos** y deja
lugar para páginas (E3).

## Reglas que no se rompen

1. **Lo decide la base, en cada pedido.** La pantalla de la app no decide si alguien ve un archivo: `media_file` (con
   sesión) o `plink_media_file` (con el link) lo dicen, y el portero lo vuelve a preguntar al dar el pase.
2. **La misma respuesta para «no existe» y «sin acceso»**, en la pantalla, en la base y en pedir acceso.
3. **Cada workspace es una isla.** La dirección dice a qué Supabase ir; ningún servidor de Lega ni de otro workspace
   interviene. Un servidor que el dispositivo no conoce se confirma antes de conectarse (como una invitación).
4. **El registro sigue cerrado** (D-09) y no se toca la configuración de login ni el correo.
5. **Los permisos son los de siempre:** aceptar un pedido es `share()` sobre una página; ninguna regla nueva de quién ve
   qué. Valen hacia abajo, nunca hacia arriba.
6. **Nada de tipos de bloque nuevos ni cambios en el documento:** los links existen solo en la copia de impresión.
7. **Un PDF ya exportado no cambia** (no tiene links). Uno nuevo suma la dirección de cada archivo y **el nombre de cada
   video** (el cuadro no lo tenía; el de un adjunto o una carpeta ya estaba dibujado en la tarjeta): sección 6.

## 1. Qué hay hoy (con el código)

| Pieza | Dónde | Qué hace hoy |
|---|---|---|
| La copia de impresión | `src/ui/printView.ts`, `cleanCopy` (líneas 162-220) | Copia el DOM del editor; saca reproductores, tiradores e iframes (`REMOVE`); cambia cada `<video>` por un `<img>` con su cuadro (212-219). **No agrega ningún `<a>`.** La usan las tres salidas: las marcas de hoja (`SheetBreaks.tsx`, `measure`), imprimir una página (`printPage.ts`) y el PDF de una rama (`exportEditor.tsx`, línea 243). |
| La tarjeta de un adjunto o una carpeta | `src/media/attachments.ts`, `attachmentCardUrl` y `folderCardUrl` (367, 407) | Una imagen SVG (`data:`) con el nombre, el peso y el tipo dibujados: en el PDF, el nombre es parte de la imagen, no texto. |
| Los links del PDF de una rama | `src/export/exportPdf.ts`, `rewriteLinks` (244-257) | Solo los links entre páginas: a una del PDF, link interno; a otra, el texto sin link. Nada para los archivos. |
| Ver un archivo | portero, `POST /pass` → `/m/<pase>` (`Doc_Portero.md`, "Rutas") | El pase está firmado y **vence a las 8 horas** (2 con un link público). No hay una dirección fija por archivo. |
| Quién ve un archivo | `public.media_file(id)` → `private.file_level` | El nivel más alto de las páginas vivas que lo usan (`page_files`, sin `is_foreign`); `null` si es 0, **sea porque no existe o porque no hay permiso** (leído de la base real). `authenticated` puede llamarla; `anon`, no. |
| Con un link público | `public.plink_media_file(id)` | Lo mismo con el token del header `x-shotdocs-link`; devuelve `project_name` vacío. |
| Las rutas de la app | `src/router.ts` | `/p/<id>`, `/trash`, `/practice`, `/privacy`, `/terms`, `/storage-test`, `/oauth/consent/<ref>`. Cualquier otra, el inicio. Cloudflare sirve `index.html` para toda dirección que no es un archivo (`wrangler.jsonc`, `single-page-application`). |
| Saber a qué Supabase ir | `src/ui/App.tsx`, `computeStart` (82-119); `src/workspaces.ts`, `resolveInvite` (374) | La lista de workspaces del dispositivo (en `localStorage`) y, al llegar con `#invite=` o `#link=`, la dirección y la clave publicable del `#`. Un servidor nuevo se pregunta antes (`JoinConfirm`, `LinkConfirm`). |
| El login | `src/ui/Login.tsx` (58-60) | Código de 8 dígitos o el link del mail; `emailRedirectTo` es el origen de la app (salvo la pantalla de permiso del MCP, que vuelve a su ruta). Las direcciones permitidas de Wanka incluyen `https://shotdocs.lega.com.ar/**` (`Doc_Supabase.md`, "Direcciones permitidas"). |
| Compartir | `public.share(persona, proyecto, página, nivel)`; `private.user_can_share_page` | Nivel 4 sobre la página, miembro vivo no invitado, y dueño o admin del workspace o dueño del proyecto. `share()` **pisa** el nivel de un permiso que ya existe sobre la misma página (también para bajarlo). |
| El visor de una carpeta | `src/ui/FolderViewer.tsx` | Recibe el id y el nombre; lista con el portero y trae *Download all*. |
| La campana | `src/ui/MentionsBell.tsx` | Las menciones sin leer; consulta cada 60 segundos; no está con un link público. |

**En la base real (2026-10-03):** 2 cuentas, 1 miembro vivo (el dueño), 1 permiso, 0 links públicos, 2453 archivos, 2758
usos en páginas (un archivo, en hasta 6 páginas), `schema_version` 20, `min_app_version` 0.151.

## 2. La dirección fija

### 2.1 La forma

```
https://shotdocs.lega.com.ar/f/<clave local>/<id del archivo>#ws=<base64url de {"u","k","l"}>
https://shotdocs.lega.com.ar/f/<clave local>/<id del archivo>#link=<el payload del link público, {"u","k","l","t"}>
```

- **El origen** es el de la app donde se exportó (`location.origin`): en Wanka, `https://shotdocs.lega.com.ar`.
- **`<clave local>`** (`workspace_settings.local_key`, `[a-z0-9_-]{4,64}`; la de Wanka es el ref de su Supabase): dice
  qué workspace del dispositivo abrir. **`<id>`**: el `files.id` (un uuid v4 al azar, 122 bits: no se puede adivinar ni
  recorrer).
- **`#ws=`** lleva la dirección del Supabase (`u`), la clave publicable (`k`) y la clave local (`l`), igual que
  `#invite=` pero **sin el nombre del workspace** ni página (como el link público, P10). La clave publicable es pública
  por diseño (ya va en cada invitación y en la app).
- **`#link=`**: el mismo payload del link público (`Doc_Link_Publico.md`, 3.1), sin cambios. La app ya lo sabe leer.
- Lo que va después del `#` no llega a Cloudflare ni a ningún servidor ni al `Referer`; la app lo lee y lo borra de la
  barra (`history.replaceState`), como hoy con `#invite=` y `#link=`.

### 2.2 Cómo sabe la app a qué Supabase ir (LF2)

Al abrir `/f/<clave>/<id>`, antes de crear ningún cliente de Supabase (en `computeStart`, `src/ui/App.tsx`), **en este
orden** (corregido por la auditoría, O2 y O3):

1. **Con `#link=`:** el modo link de siempre (`LinkApp`, sin usar ninguna sesión), que ahora mira la ruta y muestra el
   archivo en vez de la raíz del link.
2. **La ruta `/f/` va antes que el link de la pestaña y el último link abierto** (`tabLink`, `activeLink`): si no, un
   dispositivo sin workspaces que alguna vez abrió un link ignoraría el `#ws=` y abriría ese link.
3. **El dispositivo ya tiene un workspace con esa clave local:** si el `#ws=` no trae dirección o trae **la misma**, se
   abre ese y el `#` se ignora (la configuración del dispositivo manda). Si el `#ws=` trae **otra** dirección para esa
   clave, no se abre el del dispositivo en silencio (mostraría «sin acceso» en la isla equivocada): el mismo error que
   una invitación que choca (`wsError.localKeyClash`).
4. **No tiene esa clave y hay `#ws=`:** si la `l` del `#ws=` no es la clave del camino, *This link is incomplete*. Si no,
   se resuelve como una invitación sin página (`resolveInvite`): dirección `https://`, clave publicable con su forma,
   clave local que no choque. `checkWorkspace` busca primero **por dirección** (`findByUrl`): si el dispositivo ya tiene
   ese Supabase con otra clave, abre ese. Si es nuevo, la pantalla de confirmar (*Open a file from xyz.supabase.co?*, con
   el host, nunca un nombre que trae el link) y recién ahí se agrega y se pasa al login. Quien no tiene cuenta deja un
   workspace muerto en su lista (como hoy una invitación; se quita desde el selector).
5. **Ni una cosa ni la otra** (el `#` se perdió, por ejemplo un correo que reescribió el link): *This link is incomplete.
   Open it again from the document.*

Un PDF de **otro workspace** trae su propia dirección: el dispositivo se conecta a ese Supabase (preguntando antes si no
lo conoce) y nada pasa por Wanka ni por Lega. La app (los archivos estáticos) es la de siempre, una para todos (D-18).

### 2.3 Qué ve cada uno

La ruta nueva (`{ name: 'file', localKey, id }` en `router.ts`) se dibuja adentro de `Workspace` (con sesión o con el
link), así usa los mismos servicios que una página: el portero del workspace, el carrete, el visor de carpetas.

| Caso | Qué ve |
|---|---|
| Sin sesión (modo cuenta) | El login del workspace con una línea arriba: *Sign in to open this file.* Con el código, sigue en la misma pestaña y en la misma ruta; con el link del mail, `emailRedirectTo` es `<origen>/f/<clave>/<id>` (LF15). |
| Sin cuenta en ese workspace | Supabase no manda el código (registro cerrado); el login ya dice que hace falta una invitación. Se le suma: *If someone sent you this document, ask them to invite you.* |
| Sesión, miembro sacado o sin membresía | La pantalla de siempre (`RemovedScreen`); sin *Request access*. |
| Sesión y permiso, archivo borrado (`trashed_at`, `purged_at` o `drive_trashed_at`) | El estado de borrado de siempre (`deletedDisplay`), sin pedir el pase. |
| Sesión, `media_file(id)` nulo | **«You don't have access to this file»**, *Request access* (E2; si la base del workspace no tiene la migración, solo *Ask whoever shared the document with you*) y *Go to Shot Docs*. **Sin el nombre del archivo** (quien tiene solo la dirección no lo sabía), sin proyecto, sin página. El título de la pestaña: `Shot Docs`. |
| Sesión y permiso: foto o video | El carrete con ese solo archivo (reproduce por el pase del portero; lo que el navegador no puede reproducir muestra el cuadro y *Download*, como hoy). |
| Sesión y permiso: PDF u otro adjunto | La hoja del adjunto (`AttachmentSheet`): la tarjeta, *Open* y *Download* (LF8). |
| Sesión y permiso: carpeta | `FolderViewer` a pantalla completa con *Download all*. |
| Cerrar | Vuelve al inicio del workspace (o a donde estaba, si llegó desde la app). |
| Sin red | Si el dispositivo ya conocía el archivo (`fileInfo`) y tiene la copia, la abre; si no, *You're offline. Open this link again when you're connected.* Nunca la pantalla de «sin acceso» por estar sin red. |
| Errores del portero | Los de siempre (`drive_missing`, `not_uploaded`, `drive_not_connected`), que ya traen su texto. |

**Siempre se pregunta a la base estando en línea**, aunque el dispositivo tenga el archivo en su lista: a alguien que
perdió el permiso no se le muestra lo guardado como si siguiera teniéndolo. **Una sola fuente (O4):** la pantalla decide
**solo** con `media_file` (la misma que usa el portero para el pase), nunca con el `select` de `files` de la cola: su
política (`can_view_file`) deja ver al creador un archivo que no está en ninguna página y `file_level` no; la pantalla y
el pase no coincidirían.

### 2.4 «No existe» y «sin acceso» son lo mismo (LF4)

- **La respuesta:** `media_file` devuelve `null` en los dos casos (y también con el proyecto borrado, o con el archivo
  solo en páginas de la papelera para quien no las ve; quien edita, nivel 3 o más y no invitado, sí las ve, `sees_deleted`,
  y el archivo le abre: O5). La app no pide el pase si es `null`, así que el portero no se entera.
- **La pantalla:** la misma, sin datos del archivo.
- **Pedir acceso:** responde `sent` en los dos (sección 5.2), deja una fila en los dos y cuenta en el tope igual.
- **Recorrer ids:** imposible (uuid v4 al azar, 122 bits).
- **Tiempos (medido en la base real, sección 9):** `media_file` tarda **~0,27-0,32 ms** con un id que existe y no se ve
  y **~0,015-0,018 ms** con uno que no existe. Esa diferencia **ya existe hoy** en `POST /pass` del portero (pregunta
  `media_file`), no la agrega este diseño, y queda debajo de la variación de un pedido por internet (decenas de ms). Lo
  único que alguien podría sacar midiendo mucho es «este id es un archivo de este workspace», de un id que solo tiene
  porque está en un PDF que ya muestra el nombre. Se acepta y se anota. El camino de un pedido repetido no mira si el
  archivo existe (sección 5.2).

## 3. Los links en el PDF

### 3.1 Qué lleva link (LF5)

| Bloque | En el PDF hoy | Con este diseño |
|---|---|---|
| Adjunto (PDF, zip…) | La tarjeta (imagen) | La tarjeta entera es un link a `/f/…`, y debajo el nombre como texto con el mismo link. |
| Carpeta | La tarjeta (imagen) | Igual. |
| Video | Su cuadro (imagen) | El cuadro entero es un link, y debajo el nombre. |
| Foto | La foto | Sin cambios (sin link). |
| Tarjeta de un link de Drive pegado | La tarjeta con su link a Drive | Sin cambios. |
| Link a otra página | Interno o solo texto (`rewriteLinks`) | Sin cambios. |
| Marcador de un archivo de otro proyecto (`foreign`), tarjeta de uno borrado, *not on this device* | La tarjeta o el marcador | Sin link (O6). |
| Video en línea (`.sd-photo`, también en una celda) | Su cuadro | Sin link en E1: el nombre debajo rompería el renglón y la celda; queda en el roadmap. |

### 3.2 Cómo se pone el link

- En `cleanCopy` (`printView.ts`), después de cambiar los `<video>` por su cuadro, una función nueva recorre los bloques
  `[data-content-type="image"][data-url^="sdmedia://"]` de la copia; para cada uno que es adjunto, carpeta o video
  (`fileInfo(id).kind` y `mime`; sin la info, la extensión del nombre del bloque, como `isAttachment`). **La vista de
  medir y la de imprimir deciden con la misma función** (si no, las marcas de hoja se corren; O6):
  - envuelve el contenedor de la imagen en `<a class="sd-media-link" href="…">` con **`display: block`**;
  - agrega debajo, dentro del mismo bloque, `<a class="sd-media-name" href="…">nombre</a>`: un solo renglón, letra de 12
    px, recortado con `…` si no entra (así su alto es fijo y predecible).
- **La dirección la da quien llama** (`buildPrintView(…, { mediaLinks })`): imprimir una página y el PDF de una rama le
  pasan la función que arma `/f/…`; en la vista de **medir** (`SheetBreaks`) se agrega el mismo renglón con un `href`
  vacío, así las marcas de hoja de la pantalla siguen coincidiendo con el PDF (LF6).
- El zip no cambia: su HTML ya lleva cada tarjeta con link al archivo dentro del zip.
- `rewriteLinks` no toca estos links (no son de páginas). Ningún link nuevo lleva `javascript:` ni nada que no sea
  `https://<origen>/f/…`.

**Medido en Chromium** (`page.pdf`, Playwright 1.63, prototipo fuera del repo; sección 9):

| Caso | Área del link en el PDF |
|---|---|
| Tarjeta de 320 px con `<a display:block>` | Un rectángulo de 240 × 135 pt: exactamente la imagen. |
| El nombre debajo | 54 × 11 pt, sobre el texto. |
| Cuadro de video con `<a>` sin `display: block` | La imagen **más una franja de 240 × 12 pt** (la caja del renglón): por eso va `display: block`. |
| Dos tarjetas en una fila (flex) | Una por tarjeta, de 150 × 85 pt cada una, sin pisarse. |
| Una tarjeta que se parte entre dos hojas | Un rectángulo en cada hoja (208 y 675 pt de alto), los dos con el link. |
| Lo que va después del `#` (`#ws=…`, `#link=…`) | Se conserva entero en el link del PDF (9 de 9). |

### 3.3 Con un link público (LF7)

- **Solo desde la ventana *Export* (LF17, decisión de Lega sobre B1 de la auditoría).** Imprimir una página (⌘P/Ctrl+P
  o el menú del navegador) arma **siempre** los links con `#ws=`: imprimir es sincrónico a propósito (el iPhone abre el
  diálogo en el mismo toque, `printPage.ts`; desde el menú del navegador la vista se arma en `beforeprint`), no hay dónde
  esperar un pedido a la base, y una credencial no entra en un PDF sin su aviso y su casilla. **Un visitante del link**
  que imprime usa su propio link (ya está en el dispositivo, sin pedido a la red): repartir ese PDF es como reenviar el
  link que ya tiene.
- **Cuál link (LF18, decisión de Lega sobre B2):** para cada página que sale se busca hacia arriba (ella misma o una de
  arriba) el link público **vivo** (sin revocar ni vencer) más cercano **de nivel *Can view***; uno *Can edit* solo si no
  hay ninguno *Can view*, y entonces la casilla viene **destildada**. Los archivos de esa página van con su `#link=`; los
  de una página sin link (o con la casilla destildada), con `#ws=`.
- **Cómo:** `get_public_link(página)` devuelve el token solo a quien puede compartir esa página; con `above` dice si hay
  uno arriba y en qué página, y se pide `get_public_link` de esa. Se resuelve **una vez por rama** (lo que cuelga de una
  página con link hereda su respuesta), no una vez por página (O10). **Quien exporta sin poder compartir** (un miembro
  con *Can view*, un invitado) no recibe el token y su PDF va con `#ws=`: no puede repartir un link que no puede ver.
- **La ventana *Export*** lo dice antes, nombrando la página y el nivel: *File links in this PDF use the public link of
  "<page>": anyone with the PDF can open that page and the pages inside it* (y *and edit them* si es *Can edit*; con la
  fecha si vence). Abajo: *Changing this link's level also changes what PDFs that use it can open. Reset link turns them
  off.* Con la casilla **Use the public link for file links** (tildada con *Can view*, destildada con *Can edit*);
  destildada, todo va con `#ws=`. La ayuda y *Share* suman la misma línea sobre cambiar el nivel.
- **Por qué nombrar página y nivel:** el token abre **la página del link y todo lo de adentro**, no solo los archivos
  (con un link de una página de arriba, más que la rama exportada); con *Can edit* deja editar; y `set_public_link`
  cambia el nivel **conservando el token**, así un PDF repartido con un link *Can view* pasa a editar si después se sube
  el link.
- **Hoy (D14 apagado) no se puede crear un link público en Wanka:** la parte del link de E1 se prueba con el servidor
  falso y la prueba de aceptación 3 espera a que se prenda el interruptor (O9).
- **Sin red al exportar** no se puede saber si hay link: los links van con `#ws=` y la ventana lo dice (v0.165): *No connection: file links in this PDF can't use the public link of the page, even if it has one. They ask to sign in.* Sale solo en la ventana del PDF, con archivos en Drive conectados, sin red (o con la red caída del navegador) y sin los links ya pedidos; un visitante del link no lo ve (usa el suyo). Prueba: `exportFileLinks.test.tsx`.
- **Revocar, *Reset link*, vencer, la página a la papelera o quien lo creó sin permiso de compartir:** el token deja de
  valer en el acto (lo valida la base en cada pedido); el link del PDF abre la pantalla del link muerto, que para una
  ruta `/f/` suma **Sign in instead** (LF16): convierte la dirección en la de miembro (`u`, `k`, `l` del mismo payload,
  sin el token) y sigue como en 2.2. Un pase del portero ya dado sirve hasta que vence (2 horas, como hoy).
- **El token queda escrito en el PDF:** es lo decidido («quien tiene el PDF abre igual que quien tiene el link»). Por eso
  el aviso y la casilla.

## 4. Login, registro cerrado y otros workspaces

- **Login que vuelve (LF15):** con el código (el camino de siempre, y el único en el iPhone) se queda en la misma
  pestaña y en la misma ruta: al entrar, `Workspace` dibuja la ruta `/f/`. Con el link del mail, `emailRedirectTo` pasa a
  ser `<origen>/f/<clave>/<id>` (sin el `#`). Wanka ya permite `https://shotdocs.lega.com.ar/**`; otro workspace que no
  la permita cae en su *Site URL* (anotado en `Doc_Supabase.md` cuando se programe). Además la app guarda la ruta
  pendiente por workspace (como `inviteTarget`), así un link del mail que cae en el inicio igual abre el archivo.
- **El link del mail abierto en otro dispositivo** (el correo en el teléfono): la ruta trae la clave local pero no el
  `#`; si ese dispositivo no tiene el workspace, *This link is incomplete…* (2.2, paso 4). El login lo previene: *Type the
  code here.*
- **Sin cuenta (LF3):** con el registro cerrado nadie crea una cuenta desde un PDF. Quien no tiene cuenta no puede pedir
  acceso: no hay a quién atarle el pedido sin abrir la base a `anon`. El camino para alguien de afuera es el link público
  (el PDF lo usa solo si la página tiene uno) o que lo inviten. Cuando el registro se abra para invitados (paso 9 del
  plan) y haya correo (B.8), un pedido sin cuenta podría ser un pedido de invitación: roadmap.

## 5. *Request access* (entrega 2)

### 5.1 La tabla

`public.access_requests` (borrador completo en la sección 7):

| Columna | Qué es |
|---|---|
| `id` | uuid. |
| `user_id` | Quién pide (`auth.users`, se borra con la cuenta). |
| `file_id` | Qué archivo. **Sin clave foránea a propósito:** un id que no existe también deja su fila, en estado `void`. |
| `state` | `pending`, `accepted`, `declined` o `void` (un pedido que no vale: el id no existe, el archivo no lo usa ninguna página viva, o lo rechazaron hace menos de 24 horas). |
| `times`, `created_at`, `asked_at` | Cuántas veces lo pidió, cuándo la primera y cuándo la última. |
| `decided_at`, `decided_by` | Quién y cuándo aceptó o rechazó. |
| `page_id`, `level` | Al aceptar: sobre qué página y con qué nivel se dio el permiso (el permiso vive en `grants`). |

- Índices: uno abierto por persona y archivo (`unique (user_id, file_id) where state in ('pending','void')`), los
  pendientes de un archivo y el tope por persona y día (`(user_id, created_at)`).
- **Row Level Security prendida y sin políticas**, y `revoke all` a `public`, `anon` y `authenticated`: nadie la lee ni la
  escribe directo (probado: `permission denied` para leer y para insertar). Solo las tres funciones `SECURITY DEFINER`.
- **Páginas (E3):** la decisión de Lega menciona «qué archivo o página». Esta entrega guarda archivos; para pedir una
  página (`/p/<id>` sin acceso) se suma `page_id` como objetivo con un `check` de uno de los dos, en E3.

### 5.2 Pedir: `request_access(archivo)`

- Solo un miembro vivo con sesión permitida (`workspace_role`): si no, `not_member`. `anon` no puede llamarla.
- Si ya lo ve (`file_level ≥ 1`): `has_access` (la persona ya lo sabe; no es un dato nuevo).
- **Repetido** (ya hay uno `pending` o `void` de esa persona y ese archivo): renueva la fila como mucho una vez por hora y
  responde `sent`. **Este camino no mira si el archivo existe**: repetir el mismo id mil veces no sirve para medir nada
  nuevo. Un `void` de hace más de un día se vuelve a mirar (por ejemplo, pasó el día del rechazo).
- **Nuevo:** si la persona ya creó **20 filas en 24 horas** (valgan o no), `rate_limited`. Si no, crea la fila: `pending`
  si el archivo lo usa una página viva (`private.page_alive`: ni ella ni una de arriba en la papelera, proyecto sin
  borrar) y no hubo un rechazo de ese archivo en 24 horas; `void` si no. Responde `sent` en los dos casos.
- Dos pestañas a la vez no pasan el tope (`pg_advisory_xact_lock` por persona).
- **Antes de mandar (LF19),** el botón dice qué va a pasar: *The people who can share this file will see your email and
  your role.* (**Request access** y *Cancel*.)
- **Quien pide no tiene cómo listar sus pedidos** (sería la misma pregunta por otro camino). La app guarda en el
  dispositivo cuándo lo pidió y lo muestra: *You asked for access on Oct 3.*

### 5.3 Quién los ve y los decide (LF10, LF12)

- `access_requests_pending()`: los pendientes de los **últimos 30 días**, de **miembros vivos** que **todavía no ven** el
  archivo, sobre archivos que usa **alguna página viva que quien llama puede compartir** (`user_can_share_page`). Cada
  uno trae el correo y el rol de quien pide (también a un miembro común dueño del proyecto, LF19), el nombre y el tipo del archivo, cuándo y cuántas veces, y **solo las
  páginas que quien llama puede compartir** (id y título). Un invitado nunca ve nada. Hasta 100.
- **Dónde:** la campana suma una sección *Access requests* arriba de las menciones (con el número en la campana), solo
  para quien puede compartir y con la base migrada; se consulta en el mismo ciclo de 60 segundos. Y *Share* de una
  página muestra arriba los pedidos de archivos de esa página.
- **Decidir** (una ventanita desde la campana o *Share*): *<correo> asks for access to <archivo>*; la página donde se da
  el permiso (si el archivo está en varias, una lista; por defecto la primera donde se agregó), el nivel (*Can view* por
  defecto; *Can comment*, *Can edit*, *Can edit and create pages*), y la línea *Gives access to this page and the pages
  inside it.* Botones **Give access** y **Decline**. A un invitado se le ofrecen los mismos niveles que en *Share* (hoy
  también *Can edit and create pages*, O17).
- `decide_access_request(pedido, aceptar, página, nivel)`: con `aceptar` en verdadero, acepta sobre esa página; en
  falso, rechaza; nulo, `decision_invalid` (LF20: rechazar es explícito, nunca una página que faltó). Comprueba que el pedido esté
  pendiente y que quien llama pueda compartir alguna página viva que usa el archivo (si no, `request_not_found`: el mismo
  error para «no existe», «ya decidido» y «no te toca»); que la página elegida use el archivo, esté viva y la pueda
  compartir (`page_invalid`); el nivel (`level_invalid`); y que quien pidió siga siendo miembro (`member_not_found`).
- **Nunca baja un permiso (LF11):** si la persona ya tiene ese nivel o más sobre la página (por esa página o por una de
  arriba), no se toca `grants` y el pedido queda aceptado; si no, `share()`. Probado: E tenía *Can edit* sobre la
  página, se aceptó su pedido con *Can view* y siguió con *Can edit*.
- **Quien pide se entera** al volver a abrir la dirección (ya ve el archivo) o porque la página aparece en su árbol. La
  pantalla de «sin acceso» abierta vuelve a preguntar cada 60 segundos mientras esté a la vista. Sin correo (B.8).

### 5.4 Casos

| Caso | Qué pasa |
|---|---|
| Pide de nuevo un pendiente | `sent`; la fila suma una vez (como mucho una por hora). No crea otra. |
| Pidió un archivo que todavía no estaba en ninguna página viva (`void`) y después se agrega a una | Se vuelve a mirar recién 24 horas después del pedido (O15): renovarlo antes no lo trae. |
| Le rechazaron y vuelve a pedir el mismo día | `sent`, pero queda `void` y no lo ve nadie. Al día siguiente, se puede volver a pedir. |
| El archivo va a la papelera (o su página, o se borra el proyecto) | Desaparece de la lista (ninguna página viva); si se restaura dentro de los 30 días, vuelve. Pedirlo con el archivo en la papelera deja un `void`. |
| Le dan acceso por otro lado (por ejemplo, *Share* de la página) | Desaparece de la lista (ya lo ve). |
| Sacan a quien pidió | Desaparece de la lista; aceptarlo da `member_not_found`. |
| Quien decide pierde el permiso de compartir | Deja de verlo; decidir da `request_not_found`. |
| Dos personas deciden a la vez | La fila se bloquea (`for update`); la segunda recibe `request_not_found`. |
| Un pedido de hace más de 30 días | No se muestra. Si la persona vuelve a pedir, se renueva y aparece de nuevo. |
| Tope | 20 filas nuevas por persona y día (probado: con 2 del día, frenó en el pedido 19). |

### 5.5 Abuso y plan gratis

- Solo miembros con sesión. Lo más que escribe uno: 20 filas por día más una actualización por hora y archivo abierto;
  cada fila pesa menos de 200 bytes.
- La lista de quien decide: **~20 ms** con 15 pendientes (medido; 20 llamadas en 296-399 ms, con `page_alive` y
  `user_can_share_page` por página). La campana la pide una vez por minuto.
- Nada de esto pasa por el portero ni gasta pedidos de Workers.
- La lista recorre todos los pendientes de 30 días y filtra después (O16): bien a esta escala; si crece, un índice
  `(asked_at) where state = 'pending'`.

## 6. Privacidad: qué lleva el PDF y qué muestra la dirección

- **El PDF lleva**, por cada archivo con link: el origen de la app, la clave local del workspace, el id del archivo y, en
  el `#`, la dirección del Supabase y la clave publicable (o el payload del link público con su token, solo si la página
  tiene uno y quien exporta lo dejó tildado). **Ningún nombre de proyecto, de página ni de workspace, ni correos.** El
  nombre de un adjunto o una carpeta ya estaba en el PDF (dibujado en la tarjeta); **el de un video es un dato nuevo**
  (el cuadro no lo tenía; O7).
- **Lo que reparte el `#ws=` (O8):** con la dirección y la clave publicable, quien tenga el PDF puede probar qué correos
  tienen cuenta (el login responde distinto con el registro cerrado, `signup_disabled`) y gastar el tope de 30 correos
  por hora del workspace. En Wanka ya es público (va en la app); en otro workspace hasta hoy lo tenían solo los
  invitados. Se acepta (LF1). El camino `/f/<clave>/<id>` llega a los registros del host de la app (como `/p/<id>` hoy);
  `Referrer-Policy: strict-origin-when-cross-origin` (`public/_headers`) lo deja afuera de Supabase y del portero.
- **La dirección sin acceso no muestra nada:** ni el nombre del archivo, ni del proyecto, ni de la página. El host del
  Supabase sí (en la pantalla de confirmar, como una invitación).
- **Con el link público,** el visitante ve lo que ve con el link: nada de afuera de su rama (`plink_media_file`).
- **El portero** sigue igual: `Referrer-Policy: no-referrer`, el pase solo en la dirección del archivo abierto.
- **Buscadores:** la app ya responde con `noindex` y `robots.txt` cerrado; `/f/` no tiene contenido en el HTML.

## 7. Migración (borrador, entrega 2)

Sin número fijo: el link 2b sube `schema_version` a 21 y quizás la papelera a 22. Quien la aplique le pone la fecha y el
siguiente libre (`:N`). Es exactamente lo que se probó (sección 9); la prueba
está fuera del repo, junto con lo medido.

```sql
create table public.access_requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  file_id    uuid not null,  -- sin clave foránea a propósito: un id que no existe también deja su fila ('void')
  state      text not null default 'pending' check (state in ('pending', 'accepted', 'declined', 'void')),
  times      int not null default 1 check (times between 1 and 1000),
  created_at timestamptz not null default now(),
  asked_at   timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  page_id    uuid references public.pages (id) on delete set null,
  level      text check (level in ('view', 'comment', 'edit', 'edit_pages')),
  constraint access_requests_decided check ((state in ('accepted', 'declined')) = (decided_at is not null))
);
create unique index access_requests_open_key on public.access_requests (user_id, file_id)
  where state in ('pending', 'void');
create index access_requests_pending_idx on public.access_requests (file_id) where state = 'pending';
create index access_requests_user_day_idx on public.access_requests (user_id, created_at);
alter table public.access_requests enable row level security;
revoke all on public.access_requests from public, anon, authenticated;

-- ¿Vale? Lo usa una página viva y no hubo un rechazo de ese archivo en 24 horas.
create function private.access_request_valid(uid uuid, p_file uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.page_files pf
                 where pf.file_id = p_file and pf.removed_at is null and not pf.is_foreign
                   and private.page_alive(pf.page_id))
     and not exists (select 1 from public.access_requests r
                     where r.user_id = uid and r.file_id = p_file and r.state = 'declined'
                       and r.decided_at > now() - interval '24 hours');
$$;
revoke all on function private.access_request_valid(uuid, uuid) from public, anon, authenticated;

create function public.request_access(p_file uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid   uuid := auth.uid();
  cur   public.access_requests;
  valid boolean;
  n     int;
begin
  if uid is null or private.workspace_role(uid) is null then
    raise exception 'not_member' using errcode = '42501';
  end if;
  if p_file is null then
    raise exception 'target_invalid' using errcode = '22023';
  end if;
  if private.file_level(p_file) >= 1 then
    return 'has_access';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('access_request:' || uid::text, 0));
  -- Repetido: el mismo camino valga o no (no mira si el archivo existe).
  select * into cur from public.access_requests r
  where r.user_id = uid and r.file_id = p_file and r.state in ('pending', 'void')
  for update;
  if found then
    if cur.asked_at < now() - interval '1 hour' then
      update public.access_requests set asked_at = now(), times = least(times + 1, 1000) where id = cur.id;
      if cur.state = 'void' and cur.created_at < now() - interval '24 hours' then
        update public.access_requests set state = 'pending'
        where id = cur.id and private.access_request_valid(uid, p_file);
      end if;
    end if;
    return 'sent';
  end if;
  select count(*) into n from public.access_requests r
  where r.user_id = uid and r.created_at > now() - interval '24 hours';
  if n >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  valid := private.access_request_valid(uid, p_file);
  insert into public.access_requests (user_id, file_id, state)
  values (uid, p_file, case when valid then 'pending' else 'void' end);
  return 'sent';
end;
$$;

create function public.access_requests_pending()
returns table (id uuid, user_id uuid, email text, role text, file_id uuid, file_name text, mime text,
               asked_at timestamptz, times int, pages jsonb)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
begin
  if uid is null or coalesce(private.workspace_role(uid), 'guest') = 'guest' then
    return;
  end if;
  return query
    select r.id, r.user_id, u.email::text, m.role, f.id, f.name, f.mime, r.asked_at, r.times, sp.pages
    from public.access_requests r
    join public.members m on m.user_id = r.user_id and m.removed_at is null
    join auth.users u on u.id = r.user_id
    join public.files f on f.id = r.file_id
    cross join lateral (
      select jsonb_agg(jsonb_build_object('page_id', pg.id, 'title', pg.title) order by pf.created_at) as pages
      from public.page_files pf join public.pages pg on pg.id = pf.page_id
      where pf.file_id = r.file_id and pf.removed_at is null and not pf.is_foreign
        and private.page_alive(pf.page_id) and private.user_can_share_page(pf.page_id, uid)
    ) sp
    where r.state = 'pending' and r.asked_at > now() - interval '30 days' and r.user_id <> uid
      and sp.pages is not null
      and not exists (select 1 from public.page_files pf2
                      where pf2.file_id = r.file_id and pf2.removed_at is null and not pf2.is_foreign
                        and private.user_page_level(pf2.page_id, r.user_id) >= 1)
    order by r.asked_at desc
    limit 100;
end;
$$;

-- p_accept explícito (LF20): un error de la app que pierde la página nunca rechaza un pedido.
create function public.decide_access_request(p_id uuid, p_accept boolean, p_page uuid default null,
                                             p_level text default 'view') returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r   public.access_requests;
begin
  select * into r from public.access_requests ar where ar.id = p_id for update;
  if not found or r.state <> 'pending' or not exists (
      select 1 from public.page_files pf
      where pf.file_id = r.file_id and pf.removed_at is null and not pf.is_foreign
        and private.page_alive(pf.page_id) and private.user_can_share_page(pf.page_id, uid)) then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  if p_accept is null then
    raise exception 'decision_invalid' using errcode = '22023';
  end if;
  if not p_accept then
    update public.access_requests set state = 'declined', decided_at = now(), decided_by = uid where id = p_id;
    return 'declined';
  end if;
  if p_level is null or p_level not in ('view', 'comment', 'edit', 'edit_pages') then
    raise exception 'level_invalid' using errcode = '22023';
  end if;
  if p_page is null or not exists (select 1 from public.page_files pf
                 where pf.file_id = r.file_id and pf.page_id = p_page and pf.removed_at is null and not pf.is_foreign)
     or not private.page_alive(p_page) or not private.user_can_share_page(p_page, uid) then
    raise exception 'page_invalid' using errcode = '22023';
  end if;
  if private.workspace_role(r.user_id) is null then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  -- share() pisa el nivel de un permiso sobre la misma página: solo se llama si sube.
  if private.user_page_level(p_page, r.user_id) < private.grant_level_value(p_level) then
    perform public.share(r.user_id, null, p_page, p_level);
  end if;
  update public.access_requests
  set state = 'accepted', decided_at = now(), decided_by = uid, page_id = p_page, level = p_level
  where id = p_id;
  return 'accepted';
end;
$$;

revoke all on function public.request_access(uuid) from public, anon;
revoke all on function public.access_requests_pending() from public, anon;
revoke all on function public.decide_access_request(uuid, boolean, uuid, text) from public, anon;
grant execute on function public.request_access(uuid) to authenticated;
grant execute on function public.access_requests_pending() to authenticated;
grant execute on function public.decide_access_request(uuid, boolean, uuid, text) to authenticated;

update public.workspace_settings set schema_version = :N where id and schema_version < :N;
```

- `private.page_alive` ya existe (migración de la papelera de archivos) y se usa tal cual.
- `remove_member` no necesita cambios: la lista filtra a quien ya no es miembro.
- Las copias de seguridad la llevan como cualquier tabla; el zip de exportar no (no es contenido de páginas).

## 8. Versiones viejas y PDF ya exportados

- **Un PDF exportado antes** no tiene links: no cambia nada.
- **Una app vieja que abre `/f/…`** (una pestaña sin recargar, una instalada que todavía no se actualizó): la ruta no la
  conoce y abre el inicio; con `#ws=` abre el workspace del dispositivo (o la bienvenida); con `#link=`, la raíz del link.
  Nadie pierde nada ni ve nada de más; la versión nueva llega al recargar.
- **E1 no necesita `min_app_version`:** no escribe nada nuevo en la base ni en el documento.
- **E2 tampoco:** una app vieja no llama a las funciones nuevas. La app nueva ofrece *Request access* y la sección de la
  campana **solo si la base del workspace tiene `schema_version ≥ N`** (otro workspace puede seguir con una base vieja:
  cada uno es una isla); si no, *Ask whoever shared the document with you*.
- **Portero viejo:** no se usa nada nuevo.

## 9. Pruebas

### 9.1 Lo comprobado al diseñar (2026-10-03)

**SQL en la base real, en una sola consulta `begin; …; rollback;`** por la Management API (nada quedó: después, la tabla
no existe y la base sigue con 2 cuentas y 2 miembros). Cuatro usuarios simulados dentro de la transacción (B invitado, C
y E miembros, D admin sin permisos, X sin membresía) y el dueño real; un archivo vivo F de la página P y otro G cuya
página se mandó a la papelera dentro de la prueba. **42 de 42 comprobaciones con el resultado esperado** (más 5 mediciones de tiempo; corrida tres veces, la última con el SQL exacto de la sección 7). Después de la auditoría, otra vez con `p_accept` (LF20): **44 de 44**, con `decision_invalid` para `p_accept` nulo y `page_invalid` para aceptar sin página:

| Qué | Resultado |
|---|---|
| `anon` puede pedir o listar; `authenticated` puede leer la tabla | No, no, no. RLS prendida. |
| X (sin membresía) pide | `not_member` |
| B: `media_file` de F (existe) y de un id al azar | `null` y `null` |
| B lee o inserta directo en la tabla | `permission denied` las dos |
| B pide F, otra vez, un id inexistente, otra vez, y G (en la papelera) | `sent` las cinco; filas: F `pending` (1 vez), inexistente `void`, G `void` |
| B y D (admin sin permisos) listan; B y D deciden | 0 y 0; `request_not_found` y `request_not_found` |
| El dueño lista | B, C y E, cada uno con 1 página (la de F) |
| El dueño rechaza a C; acepta a B en la página de G; con nivel `owner`; bien; otra vez | `declined`; `page_invalid`; `level_invalid`; `accepted`; `request_not_found` |
| El dueño le da *Can edit* a E y después acepta su pedido con *Can view* | La lista ya no lo muestra (ya ve); aceptado; E sigue con `edit` |
| B después de aceptado: `media_file(F)` y pedir F | nivel 1; `has_access` |
| C pide de nuevo el mismo día del rechazo | `sent`; sus filas: `declined`, `void`; la lista del dueño queda vacía |
| Tope: C pide ids al azar | Frenado en el pedido 19 (`rate_limited`): 2 filas del día + 18 = 20 |
| Tiempos de `media_file`, 1500 llamadas cada uno | Existe sin acceso: **0,27-0,32 ms**; no existe: **0,015-0,018 ms** (dos corridas) |
| `request_access`, primera vez, 15 cada uno | Reales (`pending`): ~1,1 ms; al azar (`void`): ~0,3-0,4 ms. Limitado a 20 por día |
| `request_access` repetido 200 veces | Real: 0,41 ms; no existe: 0,13 ms. La diferencia es la de `file_level` (la misma de `media_file`) |
| La lista del dueño con 15 pendientes, 20 veces | 296-399 ms (~15-20 ms cada una) |

**Los links en un PDF de Chromium** (`page.pdf`, la tabla de 3.2): 9 links, 2 hojas, el `#` entero en los 9.

### 9.2 Lo que hace falta al programar

- **E1, unidades:** `parseRoute` (`/f/<clave>/<uuid>`, claves y uuids mal formados, barra al final); el `#ws=` (bien,
  roto, `http://` de afuera, clave publicable secreta, clave local que choca, el dispositivo que ya tiene la clave local
  con otra dirección: manda el dispositivo); `computeStart` con `#ws=` y con `#link=` en `/f/`.
- **E1, la copia de impresión** (jsdom y `printView.test`): adjunto, carpeta y video con su `<a>` y su nombre; foto sin
  link; tarjeta de Drive y links de páginas sin cambios; la vista de medir con el mismo alto que la de imprimir; el
  esquema anterior (un bloque `image` con `sdmedia://` sin `fileInfo`) se decide por la extensión.
- **E1, la pantalla `/f/`** con el servidor falso (`src/sync/testing.ts`): `media_file` nulo da la misma pantalla para un
  id que existe y uno que no (comparar el HTML), sin el nombre; con permiso, el carrete, la hoja y el visor según el
  tipo; sin red; errores del portero; sin sesión, el login con `emailRedirectTo` a la ruta.
- **E1, el PDF:** el prototipo de 3.2 pasado a la prueba de `exportPdf` (contar los links en el PDF con pdf.js) y el
  aviso del link público en la ventana; con un link revocado, *Sign in instead*.
- **E2, SQL:** la prueba de 9.1 (fuera del repo) corrida otra vez sobre la migración final, más:
  sesión con contraseña (`session_allowed`), un dueño de proyecto que no es admin, un admin con nivel 4 en una sola
  página, dos decisiones a la vez, un archivo en dos páginas (solo las que se pueden compartir), un pedido de más de 30
  días, y **mutantes** (sacar el `user_can_share_page` de la lista, el `for update`, el «nunca baja», el `revoke`): cada
  uno tiene que hacer fallar algo. **Sumado por la auditoría (O18):** `anon` en las cinco puertas (pedir, listar, decidir,
  leer la tabla, `media_file`), `authenticated` sin `sub`, el miembro común dueño de otro proyecto (ve solo los de su
  proyecto y decide solo esos), un admin sin nada (lista vacía), un admin con nivel 4 en una de dos páginas (solo esa),
  aceptar sobre la página de arriba (`page_invalid`), un miembro sacado (lista, aceptar, pedir), 30 días (oculto y vuelve
  al renovar; renovar dos veces en la hora suma una), rechazo (mismo día `void`, 25 h después `pending`), un invitado con
  *edit_pages*, `p_accept` nulo (`decision_invalid`) y aceptar sin página (`page_invalid`); y los dos mutantes de la
  auditoría (la lista sin `user_can_share_page` le muestra 3 pedidos a un admin sin nada; decidir sin «nunca baja» deja
  `view` a quien tenía `edit`).
- **E2, app:** la campana con y sin pedidos, con base vieja (sin la sección), la ventana de decidir, *Share* con
  pedidos, el texto local *You asked for access on…*.
- **Recorrido (Lega, a mano):** sección 11.

## 10. Decisiones

### LF1 · La forma de la dirección

- **Qué pasaba:** Lega manda el reporte de rodaje en PDF a la productora; el coordinador lo abre en su notebook, que
  nunca abrió Shot Docs. Para abrir el video hay que saber a qué Supabase conectarse, y hoy eso vive solo en la lista de
  workspaces de cada dispositivo o en el `#` de una invitación.
- **Las opciones:**
  - **A.** `/f/<clave local>/<id>#ws=<dirección y clave publicable>`: el camino nombra el workspace y el archivo; el `#`
    lleva cómo conectarse.
  - **B.** `/f/<clave local>/<id>` solo: anda en un dispositivo que ya tiene el workspace; en uno nuevo, no.
  - **C.** Un servicio que traduzca la clave local a la dirección del Supabase: un servidor central, prohibido.
  - **D.** Reusar `#invite=` con un campo nuevo para el archivo: una versión vieja lo tomaría como invitación.
- **Elegí A porque** anda en cualquier dispositivo sin nada central, el `#` no llega a ningún servidor (como hoy las
  invitaciones y el link público) y la clave local del camino sirve sola en un dispositivo que ya tiene el workspace (si
  un correo le saca el `#`).
- **Si preferís otra:** B es más corta pero deja afuera a cualquiera en un dispositivo nuevo, que es justo el cliente del
  PDF. C y D no.

### LF2 · El dispositivo manda sobre el `#`

- **Qué pasaba:** un PDF viejo de Wanka trae en el `#` una dirección de Supabase que ya no es la de Wanka (si algún día
  se restaura en otro proyecto), o alguien arma a propósito una dirección con la clave local de Wanka y otro servidor.
- **Las opciones:** **A.** Si el dispositivo ya tiene un workspace con esa clave local, se abre ese y el `#` se ignora;
  si no, se confirma el servidor antes de agregarlo. **B.** Siempre el `#`.
- **Elegí A porque** la configuración del dispositivo ya fue confirmada por la persona; un `#` nunca puede cambiar a
  qué servidor va un workspace que ya está. Es la misma regla de las invitaciones (`checkWorkspace`).
- **Si preferís otra:** B no la recomiendo: un link armado podría mandar a la persona al login de otro servidor con la
  cara de su workspace.

### LF3 · Sin cuenta no se pide acceso

- **Qué pasaba:** el cliente sin cuenta recibe el PDF, toca el video y llega al login, que no le manda código porque el
  registro está cerrado.
- **Las opciones:** **A.** No puede pedir; el login le dice que pida una invitación a quien le mandó el documento.
  **B.** Un pedido sin cuenta con su correo, abierto a `anon`. **C.** Abrir el registro.
- **Elegí A porque** B abre una tabla a cualquiera con la clave publicable (que es pública) para escribir correos de
  afuera, sin forma de saber si son de verdad y sin correo para avisar; C rompe D-09. Para alguien de afuera sin cuenta
  ya existe el link público, y el PDF lo usa si la página tiene uno.
- **Si preferís otra:** B tiene sentido cuando exista el correo (B.8) y el registro abierto para invitados (paso 9):
  queda en el roadmap.

### LF4 · Una sola respuesta y el resto de tiempos

- **Qué pasaba:** alguien con un PDF ajeno prueba la dirección de cada archivo para saber cuáles existen.
- **Las opciones:** **A.** Misma pantalla, misma respuesta de la base, misma respuesta al pedir, una fila en los dos
  casos y el mismo tope; aceptar la diferencia de tiempo de `media_file` (~0,3 ms), que ya existe en el portero.
  **B.** Además igualar el tiempo de `media_file` (cambiar una función que usan el portero y la app).
- **Elegí A porque** los ids no se pueden adivinar, lo único que se aprendería midiendo es que existe un id que la
  persona ya tiene en un PDF con el nombre a la vista, y 0,3 ms queda tapado por la red. B toca una función central por
  un riesgo que hoy ya está.
- **Si preferís otra:** B es posible (calcular siempre la misma recorrida); pide su propia prueba del portero.

### LF5 · Qué lleva link

- **Qué pasaba:** en el PDF del reporte hay 40 fotos de set, dos videos y el plano en PDF.
- **Las opciones:** **A.** Adjuntos, carpetas y videos (lo pedido). **B.** También cada foto, al original.
- **Elegí A porque** es lo pedido, y la foto ya está en el PDF a 200 ppp; con link, cada toque en una foto (al
  desplazar en el teléfono) abriría el navegador.
- **Si preferís otra:** B es la misma función con una condición menos.

### LF6 · El nombre debajo también en la vista de medir

- **Qué pasaba:** el renglón del nombre debajo de cada tarjeta suma 16 px que la pantalla no muestra; las marcas de hoja
  del editor saldrían más abajo que los cortes del PDF.
- **Las opciones:** **A.** Agregar el renglón también en la vista con la que se miden las marcas. **B.** Ponerlo encima de
  la tarjeta (sin alto). **C.** Mostrarlo también en el editor.
- **Elegí A porque** las marcas siguen siendo ciertas sin tocar el editor; en pantalla, la hoja con tarjetas se ve un poco
  más corta que lo que entra, y en el PDF coincide.
- **Si preferís otra:** B tapa la parte de abajo de la tarjeta; C cambia cómo se ve el editor (otro pedido).

### LF7 · El link público en el PDF

- **Qué pasaba:** la página del reporte tiene un link público *Can view* que se le pasó al director; Lega exporta un
  PDF para el equipo interno.
- **Las opciones:** **A.** Automático, el link más cercano, solo si quien exporta puede verlo, con aviso y una casilla
  tildada para no usarlo. **B.** Automático sin casilla. **C.** Preguntar cada vez.
- **Elegí A porque** respeta lo decidido (va por el link) y deja ver que el PDF lleva una llave; el más cercano da el
  menor acceso; quien no puede compartir la página no ve el token y no lo reparte.
- **Si preferís otra:** B es lo literal; la casilla es un renglón y se puede sacar. **Corregida por LF17 y LF18:** solo
  desde *Export*, el link vivo más cercano *Can view* (no «el más cercano»: uno *Can edit* más cerca da más), y el aviso
  nombra página y nivel.

### LF8 · Abrir un PDF adjunto desde la dirección

- **Qué pasaba:** el plano del set es un PDF; desde el PDF del reporte, el clic abre la app.
- **Las opciones:** **A.** La hoja del adjunto con *Open* y *Download* (un clic más). **B.** Ir directo a `/m/<pase>` en la
  misma pestaña.
- **Elegí A porque** Safari no deja abrir una pestaña después de esperar el pase, y B deja el pase (una credencial por 8
  horas) en la barra de la pestaña, fácil de copiar y reenviar.
- **Si preferís otra:** B en la computadora es posible; en el teléfono, A igual.

### LF9 · Cómo se guarda un pedido

- **Qué pasaba:** un miembro aburrido pide acceso a mil ids al azar, o pide lo mismo cien veces.
- **Las opciones:** **A.** Una fila por pedido nuevo (también para un id que no existe, como `void`), renovar como mucho
  una vez por hora, tope de 20 filas por persona y día, y un rechazo frena 24 horas. **B.** Guardar solo los que valen.
- **Elegí A porque** B haría que el tope o la cantidad de filas dijeran qué ids existen; con A ni la respuesta ni el tope
  lo dicen, y el peor caso son 20 filas por miembro y día.
- **Si preferís otra:** el tope (20) y la ventana del rechazo (24 horas) son números en la función.

### LF10 · Quién decide

- **Qué pasaba:** Lega pidió que el dueño y los admins vean los pedidos. Un admin sin permiso sobre el proyecto privado de
  Lega no puede compartir esa página (`can_share`), y el dueño de un proyecto que no es admin sí puede.
- **Las opciones:** **A.** Quien puede compartir alguna página viva que usa el archivo. **B.** Todos los admins y el
  dueño, siempre.
- **Elegí A porque** es la misma regla que *Share*: un pedido que no se puede aceptar no se muestra, y un admin no se
  entera de que existe un archivo de un proyecto privado ajeno ni de su nombre.
- **Si preferís otra:** B mostraría pedidos que esa persona no puede resolver y nombres de archivos de proyectos
  privados. **Ajuste marcado (auditoría, O13):** A también **amplía** lo pedido: un miembro común dueño de un proyecto
  decide y ve correo y rol de quien pide. Lega lo confirmó con el aviso antes de mandar (LF19).

### LF11 · Aceptar: qué permiso

- **Qué pasaba:** el cliente pide el video de la escena 12, que está en la página de la escena; el permiso existe por
  página o por proyecto, no por archivo.
- **Las opciones:** **A.** Un permiso sobre una página que usa el archivo, elegida por quien decide (la primera donde se
  agregó, por defecto), *Can view* por defecto, sin bajar nunca uno que ya tiene. **B.** Sobre el proyecto. **C.** Un
  permiso nuevo «solo este archivo».
- **Elegí A porque** usa los permisos de siempre, da lo mínimo que hace falta y la ventana dice que vale para la página y
  lo de adentro. B da de más; C es un permiso nuevo en toda la base, el portero y el árbol.
- **Si preferís otra:** C queda anotado en el roadmap si alguna vez hace falta compartir un archivo suelto.

### LF12 · Dónde lo ve quien decide

- **Qué pasaba:** el pedido llega mientras Lega está en otra página.
- **Las opciones:** **A.** La campana (sección propia) y *Share* de la página. **B.** Solo *Share*. **C.** Un cartel arriba
  de la app.
- **Elegí A porque** la campana ya es el lugar de «alguien te necesita», ya consulta cada minuto y no se ve con un link
  público; *Share* es donde se dan los permisos.
- **Si preferís otra:** B obliga a abrir *Share* de la página justa para enterarse.

### LF13 · Sin página en la dirección

- **Qué pasaba:** el mismo archivo puede estar en dos páginas; la dirección podría decir de cuál vino.
- **Las opciones:** **A.** Solo el archivo; quien decide elige la página. **B.** `?p=<página>` en la dirección.
- **Elegí A porque** el PDF no saca ningún id de página (ya era la regla de `Doc_Exportar.md` para los links a páginas de
  afuera) y quien decide ve todas las que puede compartir.
- **Si preferís otra:** B solo cambiaría cuál viene elegida por defecto.

### LF14 · Pedidos viejos

- **Qué pasaba:** un pedido de hace tres meses que nadie miró.
- **Las opciones:** **A.** No mostrar los de más de 30 días; renovarlo lo trae de vuelta. **B.** Mostrarlos siempre.
- **Elegí A porque** la lista queda corta sin borrar nada (la regla de no borrar) y quien de verdad lo necesita lo pide
  de nuevo.
- **Si preferís otra:** el número es uno solo en la función.

### LF15 · Volver después del login

- **Qué pasaba:** el cliente toca el video, entra con el código y espera ver el video, no el inicio.
- **Las opciones:** **A.** El código en la misma pestaña (ya queda en la ruta) y `emailRedirectTo` a la ruta `/f/` para el
  link del mail, más la ruta guardada por workspace. **B.** Solo guardar la ruta.
- **Elegí A porque** usa lo que ya hace la pantalla de permiso del MCP y las direcciones permitidas ya incluyen `/**`.
- **Si preferís otra:** B anda igual con el código; con el link del mail cae primero en el inicio.

### LF16 · El link público muerto en un PDF

- **Qué pasaba:** Lega hizo *Reset link* porque el link se reenvió de más; el coordinador, que sí tiene cuenta, toca un
  video del PDF.
- **Las opciones:** **A.** La pantalla del link muerto suma *Sign in instead* para una ruta `/f/` (sigue como miembro con la
  misma dirección del Supabase). **B.** Solo *This link no longer works*.
- **Elegí A porque** el PDF sigue sirviendo a quien tiene permiso con su cuenta, sin revivir el link. *Sign in instead*
  borra el link de la pestaña (`setTabLink`): si no, recargar vuelve al link muerto (O2).
- **Si preferís otra:** B obliga a pedir un PDF nuevo.

### LF17 · El token del link público solo desde *Export* (decisión de Lega, 2026-10-03, sobre B1 de la auditoría)

- **Qué pasaba:** Lega está en la página del reporte, que tiene un link público, y aprieta ⌘P para mandarle el PDF a
  alguien del equipo. Imprimir arma la vista en el mismo toque (el iPhone lo exige) y no puede esperar a la base para
  saber si hay link; y un token terminaría en el PDF sin aviso.
- **Las opciones:** **A.** ⌘P/Ctrl+P siempre con `#ws=`; el token entra solo desde *Export*, con su aviso y su casilla.
  **B.** Recordar en el dispositivo si la página tiene link y usarlo al imprimir.
- **Decidido A (Lega)** porque imprimir sigue sincrónico y ninguna credencial entra en un PDF sin que quien lo arma lo
  vea. Un visitante del link que imprime usa su propio link (ya lo tiene en el dispositivo).

### LF18 · Qué dice el aviso de *Export* y qué link elige (decisión de Lega, 2026-10-03, sobre B2 de la auditoría)

- **Qué pasaba:** el aviso propuesto decía *anyone with the PDF can open those files*, pero el token abre la página del
  link y todo lo de adentro, con un link *Can edit* deja editar, y cambiar el nivel del link conserva el token: un PDF
  repartido con *Can view* pasaría a editar.
- **Las opciones:** **A.** El aviso nombra la página y el nivel del link; se prefiere el link vivo más cercano *Can view*;
  con uno *Can edit* la casilla viene destildada; el aviso dice que cambiar el nivel del link cambia lo que abren los PDF
  ya repartidos. **B.** El aviso de antes.
- **Decidido A (Lega)** porque quien exporta sabe exactamente qué reparte, y un permiso de escritura nunca sale en un PDF
  sin que lo tilde a mano.

### LF19 · El dueño de un proyecto también decide, y quien pide lo sabe (decisión de Lega, 2026-10-03, sobre O13)

- **Qué pasaba:** con LF10, un miembro común dueño de un proyecto ve los pedidos de los archivos de su proyecto, con el
  correo y el rol de quien pide. Lega había dicho «el dueño y los admins», y hoy un miembro común no ve correos ajenos
  (ME2).
- **Las opciones:** **A.** Decide también el miembro común dueño del proyecto, y *Request access* avisa antes de mandar:
  *The people who can share this file will see your email and your role.* **B.** Solo dueño y admins (quien no es admin
  no decide pedidos de su propio proyecto).
- **Decidido A (Lega)** porque el pedido es sobre un archivo de su proyecto y quien pide lo manda sabiendo quién lo va a
  ver.

### LF20 · Rechazar es explícito (decisión de Lega, 2026-10-03, sobre O14)

- **Qué pasaba:** `decide_access_request(id, null)` rechazaba: un error de la app que pierde la página elegida
  rechazaría el pedido sin querer.
- **Las opciones:** **A.** Un parámetro `p_accept` explícito (nulo = error). **B.** Dos funciones.
- **Decidido A (Lega).** La página solo cuenta al aceptar; aceptar sin página da `page_invalid`.

## 11. Entregas

| Entrega | Qué | Riesgo | Tamaño estimado |
|---|---|---|---|
| **E1** | La ruta `/f/` (router, `#ws=` en `computeStart`, la pantalla en `Workspace` y en `LinkApp`, *Sign in instead*, `emailRedirectTo`), los links en la copia de impresión (exportar, imprimir y medir), el link público al exportar con su aviso y casilla, la ayuda (*File links in PDFs*), `Doc_Exportar.md`. Sin migración ni portero. | Medio (privacidad de la pantalla y de lo que lleva el PDF; ningún permiso nuevo) | ~600-900 líneas con pruebas |
| **E2** | La migración de la sección 7 (con su `schema_version`), *Request access* en la pantalla, la sección de la campana, los pedidos en *Share*, la ventana de decidir, la ayuda (*Access requests*). | Alto (tabla nueva, RLS, permisos) | ~200 de SQL, ~500-700 de app, pruebas SQL con mutantes |
| **E3** (opcional) | *Request access* también en `/p/<id>` sin acceso, con **otra columna** para la página pedida (`target_page_id`; `page_id` ya es «donde se dio el permiso»), `file_id` sin `not null`, un `check` de uno de los dos y el índice único por objetivo (O19). | Bajo-medio | ~200 |

**Prueba de aceptación de cada entrega (Lega, a mano):**

1. E1: exportar un PDF de una página con un adjunto, un video y una carpeta; abrirlo en el visor de PDF del navegador; tocar
   la tarjeta del adjunto: abre la app en la hoja del adjunto; *Open* abre el PDF. Tocar el video: se reproduce. Tocar la
   carpeta: el visor con *Download all*.
2. E1: el mismo PDF en otro navegador sin sesión (ventana privada): pide entrar; con el código, abre el archivo.
3. E1: con una página con link público: exportar, ver el aviso; abrir un link del PDF en una ventana privada: abre sin
   cuenta. *Reset link*; el mismo link del PDF: *This link no longer works* con *Sign in instead*.
4. E2: con una cuenta de prueba invitada a otra página, abrir un link del PDF: *You don't have access*, *Request access*.
   En la cuenta del dueño, la campana muestra el pedido; *Give access* con *Can view*; en la de prueba, el archivo abre.

## 12. Riesgos

| Riesgo | Cómo se cubre |
|---|---|
| El PDF con el token del link público se reenvía de más | Aviso y casilla al exportar; *Reset link* corta todo. |
| El PDF reparte la dirección y la clave publicable del Supabase (O8) | Aceptado: permite probar qué correos tienen cuenta y gastar el tope de correos; en Wanka ya es público. |
| Un `#ws=` armado a propósito | Se confirma el host antes de agregar; la clave local del dispositivo manda (LF2). |
| La pantalla de «sin acceso» dice algo del archivo | Sin nombre; prueba que compara el HTML de los dos casos. |
| Un admin se entera de archivos de proyectos privados | La lista sale de `user_can_share_page` (LF10); probado con un admin sin permisos (0 pedidos). |
| Aceptar baja el permiso de alguien | `share()` solo si sube; probado. |
| Spam de pedidos | 20 filas por persona y día, renovación por hora, rechazo de 24 horas, solo miembros. |
| Las marcas de hoja dejan de coincidir con el PDF | El renglón del nombre también en la vista de medir (LF6). |
| Otro navegador no conserva los links al imprimir | Medido solo con `page.pdf` de Chromium; falta el diálogo real de Chrome, Edge, Safari y Firefox (sección 13). |

## 13. Lo que no se pudo comprobar

- El diálogo real de imprimir (*Save as PDF*) de Chrome, Edge, Safari y Firefox: si conservan los links externos y su
  área (se midió con `page.pdf`, el mismo motor que Chrome y Edge).
- Que el visor de PDF de cada sistema (Acrobat, Vista Previa de la Mac, el del iPhone, Chrome) abra el link con el `#`
  entero (pdf.js lo lee entero).
- El login con el link del mail que vuelve a `/f/` en la base real (no se entra con login al diseñar).
- Los tiempos por internet (solo se midió adentro de la base).
- Un workspace distinto de Wanka (no hay otro).

## 14. Fuera de este diseño

- El correo al pedir y al aceptar (B.8).
- Pedir acceso sin cuenta (LF3) y un permiso «solo este archivo» (LF11).
- Links en el zip (ya lleva los archivos) y links al original de cada foto (LF5).

## 15. Correcciones de la auditoría (2026-10-03)

Auditoría independiente sobre `0e301b8`: **aprobado con condiciones** en E1, E2 y E3. El SQL de E2 pasó 62
comprobaciones en rollback y detectó 2 mutantes. Lo de abajo ya está aplicado en el texto y manda sobre cualquier línea
que diga otra cosa.

| Hallazgo | Corrección | Dónde |
|---|---|---|
| B1 · Imprimir no puede esperar a saber si hay link público | ⌘P/Ctrl+P siempre con `#ws=`; el token solo desde *Export* (LF17) | 3.3, En corto |
| B2 · El aviso no decía qué da el token | Nombra página y nivel; *Can view* preferido; *Can edit* destildado; cambiar el nivel cambia lo repartido (LF18) | 3.3 |
| O1 · `computeStart` está en `src/ui/App.tsx` | Corregido | 1, 2.2 |
| O2 · El orden de arranque | `/f/` antes de `tabLink`/`activeLink`; *Sign in instead* borra el link de la pestaña | 2.2, LF16 |
| O3 · Clave y dirección que no coinciden | `l` distinta de la del camino: *incomplete*; clave del dispositivo con otra dirección: `localKeyClash`; dirección conocida con otra clave: se abre esa | 2.2 |
| O4 · Una sola fuente | La pantalla decide solo con `media_file` | 2.3 |
| O5 · La papelera | Quien edita sí abre un archivo de una página en la papelera; un archivo borrado muestra su estado | 2.3, 2.4 |
| O6 · Qué tarjetas llevan link | Sin link: `foreign`, borrado, *not on this device*, video en línea; medir e imprimir con la misma función | 3.1, 3.2 |
| O7 · El nombre del video es nuevo en el PDF | Escrito | Reglas 7, 6 |
| O8 · Lo que reparte el `#ws=` | Escrito y aceptado | 6, 12 |
| O9 · D14 apagado: no hay links públicos en Wanka | La parte del link se prueba con el servidor falso | 3.3, 11 |
| O10 · Un `get_public_link` por página | Una vez por rama | 3.3 |
| O11 · Un workspace muerto en la lista de quien no tiene cuenta | Escrito (como una invitación) | 2.2 |
| O13 · LF10 suma al miembro común dueño de proyecto | LF19 y el aviso antes de mandar | 5.2, 5.3 |
| O14 · Rechazar con página nula | `p_accept` explícito (LF20) | 5.3, 7 |
| O15 · Un `void` se mira de nuevo a las 24 h | Escrito | 5.4 |
| O16 · La lista filtra después | Índice anotado para cuando crezca | 5.5 |
| O17 · Un invitado puede recibir *edit_pages* | Los mismos niveles que *Share* | 5.3 |
| O18 · Casos y mutantes de la auditoría | Sumados a 9.2 | 9.2 |
| O19 · E3 no puede reusar `page_id` | E3 con otra columna (`target_page_id`), `file_id` sin `not null`, `check` de uno de los dos e índice único por objetivo | 11 |

## 16. Cómo quedó la entrega 1 (v0.164)

| Pieza | Dónde |
|---|---|
| La dirección: `filePath`, `workspaceHash`, `linkHash`, `fileHref`, `parseWorkspaceHash`, `takeWorkspaceHash` | `src/fileLink.ts` |
| La ruta `{ name: 'file', localKey, id }` | `src/router.ts` |
| El arranque (`fileStart`, en el orden de 2.2: después de `#link=`, antes del link de la pestaña) | `src/ui/App.tsx` |
| La pantalla: decide solo `media_file` (o `plink_media_files` con un link); carrete, hoja del adjunto, visor de la carpeta; borrado; sin red; otra clave local | `src/ui/FileScreen.tsx` (se baja aparte), dibujada por `Shell` en `src/ui/Workspace.tsx` |
| Los links en la copia de impresión (la misma función para medir e imprimir) | `src/ui/mediaLinks.ts`, llamado desde `buildPrintView` (`src/ui/printView.ts`); estilos en `src/styles.css` |
| Qué tarjeta no lleva link (otro proyecto en esa página, borrado, sin el archivo) | `MediaQueue.linkable` (`src/media/queue.ts`) |
| El link público al exportar (el vivo más cercano *Can view*; *Can edit* solo si no hay otro, destildado) | `src/export/exportLinks.ts`, la ventana en `src/ui/ExportDialog.tsx`, `mediaHref` en `src/export/exportEditor.tsx` |
| *Sign in instead* con el link muerto | `src/ui/LinkApp.tsx` (`DeadLink`) |
| El login que vuelve | `src/ui/Login.tsx` (`emailRedirectTo` a la ruta, *Sign in to open this file.*, y el pedido de invitación si el correo no tiene cuenta) |
| La línea de *Share* sobre los PDF que usan el link | `src/ui/LinkShare.tsx` |
| La ayuda (*Links to files in a PDF*) | `src/help/entries.ts`, `src/i18n/lazy/help.ts` |

**Distinto de lo diseñado (decidido al programar):**

- La pantalla de confirmar un servidor nuevo es la de las invitaciones (*Join a workspace?* con el host, `JoinConfirm`):
  agregar el workspace al dispositivo es lo que pasa de verdad. Cancelar vuelve al inicio, nunca abre la dirección en otro
  workspace.
- No se guarda aparte la ruta pendiente por workspace: el código del login deja la pestaña en la ruta, y el link del correo
  vuelve a ella (`emailRedirectTo`).
- La bienvenida (un dispositivo sin workspaces) ahora muestra el aviso del link con que se abrió la app (antes se perdía,
  también con una invitación rota).
- Un dispositivo sin ningún proyecto visible (por ejemplo, un invitado al que le sacaron todo) ve la pantalla de "sin
  proyectos" en vez de la del archivo: la del archivo se dibuja adentro de la app.
- Se preguntan como mucho 40 links públicos por exportación (`MAX_LINK_LOOKUPS`).
- Sin red al exportar, la ventana no lo avisaba (3.3 decía que sí; observación O6 de la auditoría): no se piden links y el
  PDF va con la dirección de siempre (`#ws=`), que es lo seguro. **Hecho (v0.165):** ahora la ventana lo dice (3.3).

**Ronda 1 de la auditoría de E1** (aprobado con observaciones, sin bloqueantes): si la red se cortaba y volvía con la
ventana *Export* abierta, la casilla volvía a su valor de fábrica y un *Can view* destildado a mano podía salir con el
token; ahora lo que tocó la persona se respeta hasta que cambie qué se exporta. La fuente de los links de la app
(`appLinkSource`, `mediaLinks.ts`) y el armado de *Export* tienen pruebas propias (`exportFileLinks.test.tsx`: tildado,
destildado, *Can edit* y la red que vuelve), con sus mutantes detectados. La imagen de la tarjeta va como bloque en las
dos vistas: el área del link ya no suma el hueco de la línea base. README y documentos al día.

**Medido en Chromium** (Playwright 1.63, `page.pdf()`, la vista de impresión real con `styles.css`, en un arnés fuera del
repo): en una página con un adjunto, un video, una carpeta, una foto y un link de Drive salieron 7 links: la tarjeta del
adjunto y la de la carpeta (270 × 74 pt, el área de la tarjeta), el cuadro del video (240 × 137 pt), los tres nombres
(12 pt de alto) y el de Drive como estaba; la foto, ninguno. La vista de medir y la de imprimir midieron lo mismo (751 px).
En un perfil limpio, `/f/…#ws=` de un servidor desconocido mostró *Join a workspace?* con el host y **ningún pedido a ese
Supabase** antes de confirmar; *Not now* volvió a `/`; un `#ws=` roto volvió a `/` con el aviso.
