# Compactar el contenido en el servidor (`page_snapshots`)

**Estado: diseño, sin implementar** (roadmap B.9, 2026-10-01). Toca la regla de no perder datos, así que va con
pruebas antes de cualquier código que escriba en la base. Nada de esto está aplicado: la migración de abajo es un
borrador.

## En corto

- **Qué es.** Un *snapshot* es el contenido de una página hasta el update `N` del servidor, en un solo update de
  Yjs: `Y.mergeUpdates` de los updates `1..N` (sin recolectar lo borrado, o sea, la misma información que esas
  filas juntas). Un dispositivo que no tiene la página baja el snapshot y la cola (`N+1..`) en vez de todas las
  filas.
- **Nunca se borra una fila de `page_updates`.** El snapshot es una copia para bajar más rápido, no un reemplazo:
  lo que no se usa más es solo "dejar de bajarlo". Lo único que se borra son snapshots viejos, que se pueden volver a
  armar desde `page_updates`.
- **Compacta un dispositivo con permiso de edición**, con un pedido de reserva a la base, y lo comprueba por dos
  caminos de Yjs distintos antes de subirlo. La base no sabe leer Yjs: sus controles son de forma (hasta qué fila,
  sobre qué snapshot anterior, tamaño, huella), y sirve el snapshot solo cuando está **confirmado**.
- **Las versiones viejas de la app no se enteran:** siguen usando `pull_page_updates`, que no cambia, y bajan las
  filas como hoy. Degradan en velocidad, nunca en datos.
- **Hoy no hace falta:** la página con más updates tiene 63 (37 KB). Se vuelve necesario con el uso en rodaje: una
  página editada por dos o tres personas todo el día llega a miles de updates, y como cada subida lleva **todos**
  los borrados de la página, el peso crece con el cuadrado del uso (10 000 subidas simuladas: 61 MB en la base
  contra un snapshot de 390 KB).
- **Lo que el snapshot no arregla** (y conviene hacer aparte): que cada subida repita todos los borrados (el 96 %
  de los bytes de `page_updates` en la simulación) y que un dispositivo nuevo haga un pedido por página (hoy
  1022 páginas con contenido, 1,1 updates cada una).

## Reglas que no se rompen

1. **Ninguna fila de `page_updates` se borra ni se modifica.** Son la fuente de verdad, el historial (fase 6) y lo
   que restauran las copias de seguridad.
2. **Un snapshot no se sirve hasta estar confirmado**, y deja de servirse en cuanto deja de ser válido (ver
   "Validez").
3. **Lo que no sabe de snapshots sigue andando igual**: versiones viejas de la app, la papelera de archivos, la
   copia de seguridad, el script de restaurar.
4. **`syncedSV` nunca dice que el servidor tiene algo que no tiene** (`Doc_Sincronizacion.md`, punto 2 de
   "Contenido de las páginas"). Bajar un snapshot avanza el vector igual que bajar sus filas.
5. **Nada de editor en el camino.** Compactar es Yjs puro (`mergeUpdates`): no pasa por BlockNote, ni por
   y-prosemirror, ni por la reparación de estructura, así que no puede borrar un bloque que no conoce.

## 1. Qué problema resuelve, con números

### Cómo se guarda hoy

Cada subida de contenido es `Y.encodeStateAsUpdate(doc, syncedSV)`: lo nuevo desde lo confirmado **más el delete
set entero de la página** (Yjs no sabe cuáles borrados ya tiene el servidor). Sale una subida por pausa al escribir
(1,2 s después del último cambio, o en el ciclo de cada 10 s), y cada vez que se abre una página es un autor de Yjs
nuevo. Un dispositivo que baja una página pide las filas posteriores a su cursor, de a 500 por pedido.

### Medido en la base (2026-10-01, solo lectura)

| Qué | Valor |
|---|---|
| Filas en `page_updates` | 1128, en 1022 páginas (1,1 por página) |
| Bytes de los updates | 19,4 MB (25,9 MB en base64, como viajan); la tabla ocupa 7,5 MB (Postgres los comprime) |
| Base entera | 28 MB (el plan gratis de Supabase permite 500 MB) |
| Páginas con 64 updates o más | 0 (la que más tiene: 63 updates, 37 KB, en dos días de uso de un proyecto real) |
| Páginas con 10 o más | 2 |
| La página más pesada | 1 update de 2,07 MB (una tabla importada de Coda) |

Lo que daría un snapshot en las páginas reales (`Y.mergeUpdates` de sus filas; comprobado que da el mismo documento
que aplicarlas de a una):

| Página | Filas | Bytes hoy | Snapshot | Con GC (no se usa) |
|---|---|---|---|---|
| La de 63 updates | 63 | 37,7 KB | 11,0 KB | 8,8 KB |
| Una de prueba con 17 | 17 | 6,3 KB | 4,8 KB | 4,7 KB |
| Una importada con 8 | 8 | 30,8 KB | 30,5 KB | 30,5 KB |
| La más pesada | 1 | 2,07 MB | 2,07 MB | 2,07 MB |

**Cuánto tarda hoy.** La base tarda 1,5 ms en leer las 63 filas y 53 ms la fila de 2 MB (`explain analyze`). El
viaje desde Buenos Aires a Supabase es de unos 70 ms. Por el camino de la app, la página de 63 updates baja en un
pedido (unos 0,1 a 0,3 s) y la de 2 MB en 2 a 3 s con una conexión buena. Ninguna de las dos mejora con un
snapshot hoy: la primera ya es chica y la segunda tiene una sola fila.

**Un dispositivo nuevo** baja todas las páginas de todos los proyectos que ve: hoy 1022 pedidos (4 a la vez), unos
25 s de idas y vueltas más 26 MB (13 s con 2 MB/s; 100 s con 250 KB/s, un teléfono con mala señal). El snapshot no
cambia esto: casi todas las páginas tienen un solo update. Es otro trabajo (bajar varias páginas por pedido, ver
"Fuera de este diseño").

### Cómo crece una página editada (simulación)

Una página con el patrón de subida de la app (una subida por pausa, con el delete set entero; un autor nuevo cada 60
subidas, o sea, cada vez que se vuelve a abrir), escribiendo palabras, borrando letras, agregando y borrando
párrafos. El tiempo de bajar es un modelo: 0,1 s por pedido más los bytes en base64 a 2 MB/s (wifi) o 250 KB/s
(teléfono).

| Subidas | Bytes en `page_updates` | Promedio por subida | Snapshot | Bajar hoy (wifi / teléfono) | Con snapshot |
|---|---|---|---|---|---|
| 500 | 178 KB | 365 B | 20 KB | 0,3 s / 1,2 s | 0,2 s / 0,3 s |
| 2 000 | 2,4 MB | 1,3 KB | 78 KB | 2,2 s / 14 s | 0,3 s / 0,6 s |
| 5 000 | 15,2 MB | 3,2 KB | 195 KB | 12 s / 86 s | 0,3 s / 1,3 s |
| 10 000 | 60,8 MB | 6,4 KB | 390 KB | 45 s / 342 s | 0,5 s / 2,3 s |

Referencia de uso: con una subida cada pocos segundos de trabajo, una hora de edición activa son unas 300 a 1000
subidas; un reporte de rodaje que escriben dos o tres personas durante el día pasa las 2000 en una jornada.

- **Por qué crece con el cuadrado.** Cada subida repite todos los borrados de la página: la subida 10 000 pesa
  12,8 KB para unas pocas palabras. Sin repetir los borrados, las mismas 2000 subidas serían 92 KB en vez de 2,4 MB:
  **el 96 % de los bytes son borrados repetidos.**
- **El costo de armar el snapshot** (CPU, en una PC): 14 ms con 500 updates, 170 ms con 2000, 1,4 s con 5000 y
  6,7 s con 10 000, todo de una vez. Por eso los snapshots son incrementales (el anterior más la cola): cada uno
  junta unos pocos cientos de updates.

**En términos simples:** hoy no hay ningún problema que resolver; la base es chica y las páginas tienen pocos
cambios. El problema aparece con el uso real en rodaje: una página muy editada se vuelve lenta de abrir en un
dispositivo que no la tenía (un minuto y medio en un teléfono a las 5000 subidas), y la base se llena mucho más
rápido de lo que pesa el texto. El snapshot arregla lo primero. Lo segundo lo arregla mejor dejar de repetir los
borrados en cada subida, que es otro cambio.

## 2. Quién compacta

| Opción | A favor | En contra |
|---|---|---|
| **Una función de la base** (plpgsql) | Confiable: ningún usuario puede mentir | Postgres no sabe leer ni juntar updates de Yjs. plv8 (JavaScript en Postgres) está discontinuado en Supabase |
| **Una Edge Function de Supabase** con la clave de servicio | Confiable: solo ella escribe snapshots; mismo proyecto de Supabase | Un componente nuevo que cada dueño de workspace tiene que publicar aparte (hoy todo se publica con el push a `main`); tiene la clave que saltea los permisos; en el plan gratis, 2 s de CPU por pedido |
| **El portero** (Worker de Cloudflare) | Corre JavaScript; ya es del dueño | No tiene ni debe tener clave de la base: escribiría con la sesión de la persona, o sea, igual que el dispositivo. Mezcla el contenido con su trabajo (archivos de Drive) y un workspace puede no tenerlo |
| **El dispositivo con permiso de edición** (elegida) | Ya tiene Yjs y ya compacta en local; no suma nada que publicar; respeta "cada workspace es una isla" | La base no puede comprobar el contenido: confía en quien edita |

**Por qué el dispositivo.** Quien puede editar una página ya puede escribir cualquier cosa en ella (un update que
borre todo, por ejemplo); el snapshot no le da un poder nuevo sobre el contenido. Lo que sí cambia es que un
snapshot malo no deja rastro en `page_updates`: por eso nunca se borran las filas, el snapshot se comprueba por dos
caminos antes de subirse, la base controla todo lo que puede controlar sin leer Yjs, y cualquiera que edita puede
invalidarlo (ver "Si un snapshot sale mal"). El riesgo que queda es un editor malicioso que fabrica un snapshot al
que le falta algo: los dispositivos nuevos no lo verían, los demás sí, y se arregla invalidándolo. Si Lega quiere
cerrar también eso, la opción es la Edge Function (pregunta 2).

## 3. El snapshot

```
snapshot(base, cola) = Y.mergeUpdates([base, u(a+1), …, u(N)])     // base: el snapshot confirmado anterior (o nada)
```

- **Sin GC.** `mergeUpdates` no arma un documento: junta los updates tal cual, con lo borrado incluido. Armarlo con
  un `Y.Doc` y `encodeStateAsUpdate` "recolectaría" el texto borrado (lo cambia por un hueco): pesa un poco menos (8,8
  contra 11 KB en la página de 63 updates), pero pierde lo que hace falta para el historial de versiones (fase 6) y
  deja de ser la misma información que las filas. Con `mergeUpdates`, el snapshot es exactamente lo mismo que las
  filas que cubre.
- **Lo que depende de algo que falta.** Si una fila depende de otra que todavía no llegó al servidor (una subida
  demorada), `mergeUpdates` la guarda igual, como pendiente, y el dispositivo que lo baja la integra cuando llega lo
  que falta, como hoy. En el prototipo, 545 de 1850 snapshots tenían algo pendiente, todos correctos.
- **Determinista.** La misma base y la misma cola dan los mismos bytes (1850 de 1850 en el prototipo): dos
  dispositivos que compactan el mismo tramo sobre la misma base suben la misma huella (SHA-256), y si no, algo anda
  mal (ver "Subir").
- **Hasta dónde.** `up_to_seq` (la última fila cubierta) y `last_update_id` (el `page_updates.id` de esa fila).
  El `id` es un contador que nunca vuelve atrás, ni al restaurar una copia (el script lo protege), así que "la fila
  `up_to_seq` sigue teniendo ese `id`" prueba que las filas `1..up_to_seq` son las mismas que se compactaron.
- **Tamaño.** Hasta 8 MB, como un update. Si da más, esa página no se compacta (baja como hoy).
- **Formato.** Update de Yjs v1, igual que `page_updates`: para el dispositivo es un update más.

## 4. El algoritmo

### 4.1 Cuándo

Al final del ciclo de sincronización, después de bajar (como los comentarios: un error no corta el ciclo), **una
página por ciclo como mucho**, si se cumple todo:

- El workspace tiene los snapshots prendidos (`workspace_settings.snapshot_min_version` no es nulo) y esta versión
  de la app es esa o más nueva.
- La persona puede editar la página (nivel 3 o más), la página no está en la papelera, el dispositivo la tiene
  entera (`cursor == update_seq`) y no tiene nada rechazado.
- El árbol dice que hay cola: `update_seq - snapshot_seq >= 100` (columnas de `pages`).
- La base acepta la reserva (abajo), que además pide al menos 64 KB de cola y al menos la mitad de lo que pesa el
  snapshot vigente (así una página de 2 MB no se vuelve a compactar por 64 KB de cambios).

### 4.2 Reservar

`claim_page_compaction(page, app_version)` devuelve el tramo a compactar (`base_id`, `base_seq`, `up_to_seq`,
`last_update_id`) o nada. Anota la reserva en la página por 10 minutos: dos dispositivos no bajan lo mismo a la vez.
Si el dispositivo se cae, la reserva vence sola.

### 4.3 Bajar

`pull_page_snapshot(base_id)` (la base) y `pull_page_updates(page, base_seq)` hasta `up_to_seq`: exactamente las
filas del servidor, no lo guardado en el dispositivo (que mezcla lo propio sin subir y está compactado en local).
Cada fila se decodifica; **si una no se puede leer** (la escribió una versión más nueva), no se compacta.

### 4.4 Armar y comprobar

1. `snap = Y.mergeUpdates([base, ...cola])`.
2. **Comprobar por dos caminos:** un `Y.Doc({ gc: false })` con la base y las filas aplicadas de a una, contra otro
   con el snapshot. Tienen que ser **equivalentes**: el mismo vector de estado y el mismo delete set
   (`Y.equalSnapshots`), el mismo contenido, y aplicar el estado completo de cada uno sobre una copia del otro no
   cambia nada (en los dos sentidos).
3. **No sirve comparar bytes.** `encodeStateAsUpdate` de los dos documentos da bytes distintos en 255 de 300
   casos al azar aunque sean el mismo documento: aplicar de a una parte los textos en otros lugares que el update
   fusionado. Comparar bytes daría falsas alarmas; comparar solo el texto visible no vería lo borrado.
4. Cada 10 snapshots de una página, además, se compara contra todo desde cero (`1..N` sin base), siempre que lo
   cubierto pese 4 MB o menos (si no, se salta y se compara la próxima vez que se pueda): un error que se colara en
   un snapshot no pasa al siguiente.

```js
// El núcleo (lo probado en el prototipo).
const compact = (base, tail) => Y.mergeUpdates(base ? [base, ...tail] : tail);
function absorbs(x, y) { // ¿aplicar todo lo de y sobre una copia de x cambia algo?
  const c = new Y.Doc({ gc: false });
  Y.applyUpdate(c, Y.encodeStateAsUpdate(x));
  let changed = false;
  c.on('update', () => (changed = true));
  Y.applyUpdate(c, Y.encodeStateAsUpdate(y));
  c.destroy();
  return !changed;
}
const same = (a, b) => Y.equalSnapshots(Y.snapshot(a), Y.snapshot(b)) && absorbs(a, b) && absorbs(b, a);
function verify(base, tail, snap) {
  const a = new Y.Doc({ gc: false });
  if (base) Y.applyUpdate(a, base);
  for (const u of tail) Y.applyUpdate(a, u);
  const b = new Y.Doc({ gc: false });
  Y.applyUpdate(b, snap);
  return same(a, b); // (y el contenido de cada tipo raíz igual; destruir a y b)
}
```

### 4.5 Subir (pendiente)

`push_page_snapshot(page, base_id, up_to_seq, last_update_id, state, sv, sha256, app_version)`. La base, con la
fila de la página bloqueada (como `push_page_update`):

- nivel 3 o más, snapshots prendidos y versión de la app suficiente;
- la fila `up_to_seq` existe con ese `id`, y `up_to_seq` es mayor que el `snapshot_seq` vigente;
- `base_id` es el snapshot vigente (o los dos nulos): nunca se arma sobre una base vieja;
- tamaño entre 1 byte y 8 MB, y la huella SHA-256 coincide con lo que llegó;
- guarda la fila **sin confirmar**. Si ya hay una para el mismo tramo: con la misma huella devuelve esa (reintentar
  no duplica); con otra huella, **invalida las dos** y devuelve `snapshot_mismatch` (dos dispositivos calcularon
  distinto lo mismo: algo anda mal, mejor que nadie lo use).

### 4.6 Confirmar

El mismo dispositivo baja lo que subió (`pull_page_snapshot`), comprueba la huella y que se decodifica, y llama a
`confirm_page_snapshot(id, sha256)`. La base comprueba otra vez que la base sigue siendo la vigente y que la fila
`up_to_seq` sigue con su `id`, marca `confirmed_at` y sube `pages.snapshot_seq`. Desde ahí se sirve. Si el
dispositivo se cae entre subir y confirmar, el snapshot queda sin confirmar, no se sirve nunca y se limpia (ver
"¿Se borra algo?").

**Qué quiere decir "confirmado":** el snapshot se armó con las filas exactas del servidor, se comprobó por dos
caminos de Yjs, la base comprobó el tramo y la huella, y volvió entero de la base. Recién ahí reemplaza a sus filas
**para bajar**; las filas siguen ahí.

### 4.7 Validez

Un snapshot se sirve solo si está confirmado, no está invalidado, `up_to_seq <= pages.update_seq` y la fila
`up_to_seq` sigue teniendo `last_update_id`. Lo último cubre restaurar una copia de seguridad (ver abajo).

## 5. Cómo baja un dispositivo

`pull_page_content(page, after_seq, limit)` reemplaza en la app a `pull_page_updates` (que queda igual para las
versiones viejas). Devuelve filas `(seq, update, snapshot_id)`:

- **Si hay un snapshot válido con `up_to_seq > after_seq` y pesa menos que las filas `after_seq+1..up_to_seq`**:
  primero el snapshot, con `seq = up_to_seq` y su `snapshot_id`, y después las filas posteriores, hasta `limit`.
- **Si no**, las filas como hoy.
- **Con los snapshots apagados**, siempre las filas: es el interruptor para volver atrás sin publicar nada.

Para el dispositivo, el snapshot es **un update más**: `applyRemote` lo junta con el resto, lo guarda en la misma
transacción que el cursor (que pasa a `up_to_seq`) y avanza `syncedSV` con `serverReach` y su tope, como con
cualquier fila. Casos:

- **Dispositivo nuevo** (cursor 0): el snapshot y la cola. Medido arriba: de 86 s a 1,3 s en un teléfono a las 5000
  subidas.
- **Cursor viejo** (estuvo sin red o sin abrir el proyecto): si la cola que le falta pesa menos que el snapshot,
  la cola, como hoy; si no, el snapshot, que trae de nuevo cosas que ya tiene (Yjs no duplica nada).
- **Cursor viejo con ediciones propias sin subir**: no cambia nada de la subida. Lo propio sigue afuera de
  `syncedSV` (nunca vino del servidor) y sube igual; el snapshot lleva los relojes `[0, n)` de cada autor, así que
  el vector avanza hasta donde el servidor los tiene y no más. El prototipo lo prueba en 600 corridas: nada propio
  se pierde.
- **Al día**: no baja nada (no hay filas nuevas).
- **El lote y el tope de tiempo** quedan como hoy: si un lote vence, se pide uno más chico, hasta de a uno, que
  tiene el tope más largo (pensado para 8 MB, lo máximo de un snapshot).
- **Base sin la migración**: la app ve que la función no existe y vuelve a `pull_page_updates` por 10 minutos, como
  ya hace con `push_page_update` (`versionedPushMissingAt`). Va con su constante opcional
  (`SNAPSHOT_SCHEMA_VERSION`), como la papelera de archivos: no sube `DB_SCHEMA_VERSION` y no hay aviso.

El dispositivo anota en `DocState` el último snapshot que aplicó (`snapshotId`) y la época de contenido de la
página (`contentEpoch`, ver "Si un snapshot sale mal"). Las versiones anteriores, que leen y vuelven a escribir el
mismo objeto, conservan esos campos.

## 6. Versiones viejas de la app

- **No conocen los snapshots y no les hace falta.** Siguen llamando a `pull_page_updates` y `push_page_update`, que no
  cambian, y como `page_updates` nunca pierde una fila, bajan todo como hoy: más lento, sin perder nada.
- **No pueden compactar**: no conocen las funciones nuevas.
- **No hace falta subir `min_app_version`.** Lo nuevo no cambia nada de lo guardado ni de cómo se sube; solo agrega
  una forma de bajar.
- **Una versión con un compactador con errores** se deja afuera subiendo `snapshot_min_version` por encima de ella,
  e invalidando sus snapshots (cada fila guarda `app_version`).
- **Misma base con una versión anterior** (pestaña sin recargar): lo bajado como snapshot quedó guardado como una
  fila más de `docUpdates`; la versión anterior lo lee como cualquier otra.

## 7. Colaboración, y-prosemirror y el editor

- **El parche de y-prosemirror no interviene.** Compactar no abre el editor: junta updates de Yjs. Lo que escribe
  el parche (el texto de los huecos, la marca del renglón `lgaStableGaps`, los atributos `lgaGapText`) son
  elementos y atributos de Yjs como cualquier otro, y `mergeUpdates` los copia byte por byte.
- **Tipos de bloque que esta versión no conoce:** tampoco intervienen. Una versión vieja que compacta una página con
  un bloque nuevo lo copia igual (no mira el esquema). Lo que la protege al **mostrar** sigue siendo la guarda
  (`unknownContent.ts`).
- **La semilla y la reparación** no cambian: el snapshot trae la misma semilla (con el mismo autor fijo) y lo que
  repara un dispositivo sigue siendo una edición local que sube como update.
- **Editar a la vez** (`Doc_Colaboracion.md`): la fusión la sigue haciendo Yjs en cada dispositivo; el snapshot es
  la misma información que las filas, así que fusiona igual.
- **Tiempo real (D-04, a futuro)** y **`@blocknote/core/y` con Yjs 14 (B.10):** el tiempo real no cambia nada. Yjs 14
  cambia el formato: ese día los snapshots se apagan (`snapshot_min_version` nulo) o se invalidan y se rearman con la
  migración de B.10.

## 8. Lo que usa `update_seq` y el historial

- **`pages.update_seq` no cambia al compactar** (el contenido no cambió). La papelera de archivos
  (`unlink_page_file` con `p_seen_seq`) y "a medio bajar" (`isMissingContent`) siguen igual.
- **`verifyHistory`** (la papelera de archivos comprueba que esta versión lea todo el historial antes de quitar un
  archivo por primera vez) sigue leyendo `page_updates`: no cambia en la primera entrega. Más adelante puede leer el
  snapshot (decodificarlo equivale a decodificar las filas que junta).
- **Historial de versiones (fase 6):** las filas quedan con su autor y su hora; los snapshots, sin GC, sirven
  además de puntos de partida para armar versiones.

## 9. Copias de seguridad y restaurar

- **La copia** (`z_shotdocs_backup`) lleva toda la base con `supabase db dump`: `page_snapshots` entra sola. Crece
  poco (uno o dos snapshots por página compactada).
- **Restaurar sobre el mismo proyecto:** `page_snapshots` es contenido, así que se reemplaza con lo de la copia
  junto con `page_updates`, y queda coherente. Si la copia es anterior a la tabla, el script la **conserva** (regla 7
  del script: tablas más nuevas que la copia): quedarían snapshots que cubren filas que la copia no tiene. No hace
  daño, porque **la validez** (sección 4.7) los descarta: o `up_to_seq` pasa de `update_seq`, o la fila
  `up_to_seq` es otra (un `id` nuevo, el contador no vuelve atrás). Igual conviene que el script vacíe `page_snapshots`
  cuando la copia no la trae (una línea en `restaurar_mismo_proyecto.sql`, repo privado) y que `pages.snapshot_seq`
  vuelva con la copia.
- **Los dispositivos** ven la generación nueva, borran cursor y vector y bajan de cero: reciben el snapshot de la
  copia (si es válido) y la cola.

## 10. Permisos (Row Level Security)

- `page_snapshots`: **solo lectura** para `authenticated` con `private.can_view_page(page_id)`, la misma regla que
  `page_updates` (un snapshot no muestra nada que las filas no muestren: también lleva lo borrado, igual que ellas).
  Sin `insert`, `update` ni `delete` desde la API.
- Escriben solo las funciones `security definer`: reservar, subir, confirmar e invalidar piden nivel 3 sobre la
  página (`page_level`); bajar, nivel 1. Todas controlan que la página no esté en un proyecto borrado (como hoy
  `page_level`).
- Columnas nuevas de `pages` (`snapshot_seq`, `content_epoch`, la reserva): sin permiso de `update` para
  `authenticated`; las cambian solo esas funciones (que corren como su dueño, así que el trigger
  `pages_permissions` no las frena y `updated_at` no se toca: no está en la lista de columnas que lo cambian).

## 11. ¿Se borra algo alguna vez?

**Propuesta: ninguna fila de `page_updates`, nunca.** Solo se deja de bajarlas. Razones: son el historial con autor
y hora (fase 6), lo que restauran las copias, y la red de seguridad si un snapshot sale mal; y ocupan poco
comparado con el límite (7,5 MB de 500 MB hoy). Lo que hace crecer la tabla de verdad son los borrados repetidos
en cada subida, y eso se arregla en la subida (ver "Fuera de este diseño"), no borrando.

**Lo que sí se borra, porque se puede volver a armar desde `page_updates`:**

- Al confirmar un snapshot, los de esa página anteriores a su base (quedan el vigente y el anterior).
- Los sin confirmar con más de un día (un dispositivo que se cayó entre subir y confirmar).
- Los invalidados con más de 30 días (se guardan ese tiempo para mirar qué pasó).

**Si algún día hiciera falta borrar filas de `page_updates`** (la base llegando al límite, por ejemplo), sería una
decisión de Lega con estas condiciones mínimas: un snapshot confirmado y comprobado desde cero que las cubra, con
más de 30 días; la fila presente en al menos una copia mensual (las que se guardan para siempre); y ningún
dispositivo de una versión sin snapshots activo en ese workspace (esas versiones bajan filas desde cero). Hoy no se
propone.

## 12. Si un snapshot sale mal

- **Invalidar:** `invalidate_page_snapshot(id, motivo)` (nivel 3). Marca `invalid_at`, recalcula
  `pages.snapshot_seq` con el anterior válido (o 0) y suma uno a `pages.content_epoch`. Lo llama la app cuando una
  comprobación desde cero no da igual, y se puede llamar a mano desde el SQL Editor.
- **Los dispositivos que lo usaron:** el árbol trae `content_epoch`. Si es mayor que el que el dispositivo anotó y
  el dispositivo aplicó algún snapshot de esa página (`DocState.snapshotId`), hace con esa página lo mismo que al
  restaurar una copia: cursor y vector a cero, vuelve a subir todo lo suyo (Yjs no duplica) y baja de nuevo. Lo
  propio sin subir nunca se toca.
- **Apagar todo:** `snapshot_min_version = null` en `workspace_settings`. Desde el próximo pedido, todos bajan filas.

## 13. Migración (borrador, sin aplicar)

Va como `supabase/migrations/<fecha>_snapshots.sql` en la entrega 1, con su prueba de permisos
`supabase/tests/snapshots_permisos.sql`. Hace falta `pgcrypto` (`extensions.digest`), que Supabase ya trae.

```sql
-- Snapshots del contenido de una página: una copia de page_updates 1..up_to_seq en un solo update de Yjs
-- (Y.mergeUpdates, sin GC). Nunca reemplazan a page_updates: solo se bajan en su lugar.
create table public.page_snapshots (
  id             uuid primary key default gen_random_uuid(),
  page_id        uuid not null references public.pages (id) on delete cascade,
  up_to_seq      bigint not null check (up_to_seq > 0),
  last_update_id bigint not null,                 -- page_updates.id de la fila up_to_seq
  base_id        uuid references public.page_snapshots (id) on delete set null,
  state          bytea not null,
  state_sv       bytea not null,                  -- vector de estado (diagnóstico y comprobaciones)
  sha256         bytea not null,
  state_bytes    int generated always as (octet_length(state)) stored,
  app_version    text not null,
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  confirmed_at   timestamptz,
  invalid_at     timestamptz,
  invalid_reason text,
  unique (page_id, up_to_seq)
);
create index page_snapshots_page_idx on public.page_snapshots (page_id, up_to_seq desc)
  where confirmed_at is not null and invalid_at is null;

alter table public.pages
  add column snapshot_seq        bigint not null default 0,  -- up_to_seq del snapshot vigente
  add column content_epoch       int    not null default 0,  -- sube al invalidar un snapshot
  add column compaction_claim_at timestamptz,
  add column compaction_claim_by uuid;

alter table public.workspace_settings
  add column snapshot_min_version text;           -- null: apagados (no se aceptan ni se sirven)

alter table public.page_snapshots enable row level security;
create policy page_snapshots_select on public.page_snapshots
  for select to authenticated using (private.can_view_page(page_id));
revoke all on public.page_snapshots from anon, authenticated;
grant select on public.page_snapshots to authenticated;
-- pages: sin grants nuevos (snapshot_seq, content_epoch y la reserva solo los tocan las funciones).

-- El snapshot vigente de una página, si es válido (confirmado, no invalidado, y su última fila sigue igual).
create function private.current_snapshot(p uuid)
returns public.page_snapshots
language sql stable security definer set search_path = ''
as $$
  select s.* from public.page_snapshots s
  join public.pages pg on pg.id = s.page_id
  where s.page_id = p and s.confirmed_at is not null and s.invalid_at is null
    and s.up_to_seq <= pg.update_seq
    and exists (select 1 from public.page_updates u
                where u.page_id = p and u.seq = s.up_to_seq and u.id = s.last_update_id)
  order by s.up_to_seq desc limit 1;
$$;

-- ¿Prendidos y con versión suficiente? (app_version_allowed ya existe para min_app_version.)
create function private.snapshots_allowed(p_app_version text) returns boolean ...;

-- Bajar: el snapshot (si conviene) y las filas posteriores; si no, como pull_page_updates.
create function public.pull_page_content(p_page_id uuid, p_after_seq bigint, p_limit int default 200)
returns table (seq bigint, update text, snapshot_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare s public.page_snapshots; lim int := least(greatest(p_limit, 1), 1000);
begin
  if not private.can_view_page(p_page_id) then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  if (select snapshot_min_version from public.workspace_settings) is not null then
    s := private.current_snapshot(p_page_id);
  end if;
  if s.id is not null and s.up_to_seq > p_after_seq
     and s.state_bytes < (select coalesce(sum(octet_length(u.update)), 0) from public.page_updates u
                          where u.page_id = p_page_id and u.seq > p_after_seq and u.seq <= s.up_to_seq) then
    return query select s.up_to_seq, translate(encode(s.state, 'base64'), E'\n', ''), s.id;
    p_after_seq := s.up_to_seq;
    lim := lim - 1;
    if lim = 0 then return; end if;
  end if;
  return query
    select u.seq, translate(encode(u.update, 'base64'), E'\n', ''), null::uuid
    from public.page_updates u
    where u.page_id = p_page_id and u.seq > p_after_seq
    order by u.seq limit lim;
end; $$;

-- Reservar, subir, confirmar, bajar uno e invalidar: como se describe en las secciones 4 y 12.
create function public.claim_page_compaction(p_page_id uuid, p_app_version text)
  returns table (base_id uuid, base_seq bigint, up_to_seq bigint, last_update_id bigint) ...;
create function public.push_page_snapshot(p_page_id uuid, p_base_id uuid, p_up_to_seq bigint,
  p_last_update_id bigint, p_state text, p_sv text, p_sha256 text, p_app_version text) returns uuid ...;
create function public.confirm_page_snapshot(p_id uuid, p_sha256 text) returns boolean ...;
create function public.pull_page_snapshot(p_id uuid) returns text ...;          -- nivel 1, también sin confirmar
create function public.invalidate_page_snapshot(p_id uuid, p_reason text) returns boolean ...;
-- revoke de public y anon, grant execute a authenticated; private.* sin grants.
-- La consulta del árbol (remote.ts) suma snapshot_seq y content_epoch a las columnas que pide.
notify pgrst, 'reload schema';
```

La migración no toca `page_updates`, `push_page_update` ni `pull_page_updates`, y deja los snapshots apagados.

## 14. Cambios en la app

| Archivo | Qué cambia |
|---|---|
| `src/sync/remote.ts` | `pullContent` (con vuelta a `pullUpdates` si falta la función), `claimCompaction`, `pushSnapshot`, `pullSnapshot`, `confirmSnapshot`, `invalidateSnapshot`; el árbol pide `snapshot_seq` y `content_epoch` |
| `src/sync/types.ts` | `RemoteUpdate.snapshotId?`, `PageRow.snapshot_seq?`, `PageRow.content_epoch?` |
| `src/sync/docs.ts` | `pullPage` usa `pullContent`; `applyRemote` anota `snapshotId`; el reinicio de una página por `content_epoch` (lo mismo que `resetForRestore`, para una sola) |
| `src/sync/compact.ts` (nuevo) | `compact`, `verify`, `same` y el que compacta una página (reservar, bajar, armar, comprobar, subir, confirmar) |
| `src/sync/engine.ts` | Al final del ciclo, una página por vuelta; sus errores no cortan el ciclo |
| `src/sync/localDb.ts` | `DocState.snapshotId?`, `DocState.contentEpoch?` |
| `src/sync/testing.ts` | El servidor en memoria con las mismas funciones y reglas |
| `Docs/Doc_Sincronizacion.md`, `Doc_Supabase.md` | Lo que cambia, cuando se implemente |

Nada visible para el usuario: no suma ayuda ni atajos. El estado de sincronización no cambia.

## 15. Plan de pruebas

Antes de escribir en la base, en este orden:

1. **El núcleo** (`src/sync/compact.test.ts`, el prototipo pasado a vitest): equivalencia por los dos caminos con
   updates al azar de tres dispositivos, subidas demoradas (lo pendiente), snapshots incrementales y desde cero;
   determinismo; un update ilegible corta; una página vacía, una con solo la semilla, una vieja con dos raíces; y
   **pruebas mutantes**: un snapshot al que le falta una fila, o un borrado, tiene que fallar la comprobación (con
   una fila de menos, el prototipo da 461 fallas en 100 corridas: la comprobación lo ve).
2. **El dispositivo con el servidor en memoria** (`docs.test.ts`, `sync.test.ts`): dispositivo nuevo, cursor viejo,
   cursor viejo con ediciones sin subir, subida en vuelo mientras llega un snapshot, cerrar la app en cada punto de
   `applyRemote`; en cada paso, la revisión que ya existe de que `syncedSV` no diga de más.
3. **Al azar con varios dispositivos y versiones** (`localSaveRandom.test.ts` y las corridas de tres dispositivos de
   `docs.test.ts`): compactaciones en momentos al azar, reservas que vencen, confirmaciones que no llegan, una
   invalidación, una restauración, y **la versión publicada** (`fixtures/publishedDocs.ts`, que solo conoce
   `pull_page_updates`) sobre la misma base y como otro dispositivo. Al final: todos los dispositivos tienen lo mismo,
   igual a todas las filas del servidor aplicadas de a una, y nada escrito se perdió. `LOCAL_SAVE_SEEDS` para correr
   más.
4. **Con el editor real** (`editor.test.ts`, jsdom): una página con fotos en línea, script y preguntas, compactada y
   abierta en un dispositivo nuevo: el mismo documento que sin snapshot, sin reparaciones de más.
5. **Permisos en SQL** (`supabase/tests/snapshots_permisos.sql`, en una transacción que se deshace, contra la base):
   quien ve lee el snapshot y no puede subir; quien edita otra página no puede; tramo con otro `id`, base vieja,
   huella que no coincide, tamaño, versión vieja y apagados: rechazados; mismo tramo con la misma huella devuelve el
   mismo; con otra, invalida las dos; un snapshot de un proyecto borrado no se sirve; `pull_page_updates` devuelve lo
   mismo que antes.
6. **Restaurar** (el script del repo privado, en una base aparte): una copia anterior a la tabla y una con
   snapshots; en los dos casos, lo servido coincide con las filas.
7. **De punta a punta** (Playwright contra la base, en un proyecto de prueba): dos navegadores editan 300 veces, uno
   compacta, un tercero abre de cero y ve lo mismo; la versión publicada abre la misma página y baja filas.
8. **Medir en el navegador** el tiempo de abrir una página de 2000 y 5000 subidas en un dispositivo nuevo, con y sin
   snapshot, en la PC y en el iPhone.

## 16. Riesgos

| Riesgo | Qué lo cubre |
|---|---|
| Un error del compactador (o del navegador) arma un snapshot al que le falta algo | Comprobación por dos caminos antes de subir; vuelta desde la base antes de confirmar; comparación desde cero cada 10; huella distinta entre dos dispositivos invalida; invalidar y `content_epoch`; las filas nunca se borran |
| Un editor malicioso sube un snapshot fabricado | Lo mismo que puede hacer con un update; se invalida a mano. Para cerrarlo del todo: Edge Function (pregunta 2) |
| Un snapshot al que le falta un bloque con una foto hace que la papelera de archivos la marque sin uso | La marca no borra nada (la papelera de archivos guarda 30 días y el borrado automático está apagado); invalidar y volver a bajar la vuelve a usar |
| Restaurar una copia anterior a los snapshots | La validez por `last_update_id`; el script vacía la tabla |
| Dos dispositivos compactan a la vez | La reserva; si igual pasa, mismo tramo y misma base dan la misma huella |
| Un snapshot enorme que no baja en una red mala | Hasta 8 MB, con el tope de tiempo del lote de a uno (pensado para 8 MB); si es más grande, no se compacta |
| Yjs 14 (B.10) cambia el formato | Apagar o invalidar antes de esa migración |
| Las versiones viejas siguen bajando todo | Es lento pero correcto; desaparece cuando se actualizan |

## 17. Entregas

1. **Leer snapshots** (sin nadie que los cree): la migración (apagados), `pull_page_content` y el resto de las
   funciones, el servidor en memoria, `pullContent` en la app, las pruebas 2, 3 (sin compactar todavía), 5 y 6. Sin
   snapshots en la base, la app se comporta exactamente igual: se puede publicar sola. Copia de seguridad antes de
   migrar.
2. **Crear snapshots**: `compact.ts`, el paso en el ciclo, la confirmación, la invalidación y el reinicio por
   `content_epoch`; las pruebas 1, 3 completas y 4. Se publica con los snapshots apagados.
3. **Prenderlos**: probar de punta a punta en un proyecto de prueba (7) y medir (8); después
   `snapshot_min_version` a la versión de la entrega 2 en Wanka. Mirar los snapshots inválidos la primera semana.
4. **Más adelante**: `verifyHistory` sobre el snapshot; la línea del script de restaurar (repo privado).

Antes de cerrar cada entrega, la auditoría de siempre (funcionalidad, permisos y RLS, no perder datos, docs).

## 18. Fuera de este diseño (y por qué importa)

- **No repetir los borrados en cada subida.** Es lo que más pesa (96 % de los bytes en la simulación) y lo que
  hace crecer la base y cada subida. Hace falta guardar en el dispositivo qué borrados confirmó el servidor (un
  "`syncedDS`" junto a `syncedSV`) y mandar solo los nuevos; si se equivoca, un borrado no llega (el texto
  "revive"), nunca se pierde texto escrito. Merece su propio diseño y sus pruebas al azar.
- **Bajar varias páginas por pedido.** Un dispositivo nuevo hace hoy 1022 pedidos; con uno cada 50 páginas serían
  21. No depende de los snapshots.

## 19. Preguntas para Lega

1. **¿Nunca borrar filas de `page_updates`, solo dejar de bajarlas?** Recomendación: **sí**. Los snapshots viejos
   (que se pueden rearmar) sí se borran.
2. **¿Compacta el dispositivo de quien edita (recomendado) o una Edge Function de Supabase?** El dispositivo no suma
   nada que publicar y confía en quien edita, igual que hoy con cada update. La Edge Function cierra el caso de un
   editor malicioso, pero cada dueño de workspace tendría que publicarla aparte y tendría la clave de servicio.
3. **¿Hacer antes (o junto con la entrega 2) que las subidas no repitan los borrados?** Recomendación: **sí, como
   ítem aparte del roadmap**, porque es el 96 % del crecimiento de la base; los snapshots arreglan la bajada, eso
   arregla la base y la subida.

## Cómo se midió

- **La base**: consultas de solo lectura por la Management API de Supabase (filas, bytes, tamaño de tabla y base,
  `explain analyze` de la lectura de `pull_page_updates`). El viaje a Supabase, con `auth/v1/health` (unos 70 ms).
- **Lo que daría un snapshot en páginas reales**: las filas bajadas por la misma API, juntadas con `Y.mergeUpdates`
  (Yjs 13.6.33) y comparadas contra aplicarlas de a una. No se guardó contenido.
- **El crecimiento**: una simulación en Node con el patrón de subida de la app (una semilla fija; los tiempos son de
  una PC).
- **El prototipo**: 600 corridas al azar (dos semillas, 300 cada una) de tres dispositivos con subidas demoradas y
  bajadas parciales, 1850 snapshots incrementales: 0 fallas de equivalencia (por los dos caminos y contra todo desde
  cero), 1850 de 1850 deterministas, 600 dispositivos nuevos y 600 con cursor viejo y ediciones propias sin pérdida.
