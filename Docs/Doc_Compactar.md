# Compactar el contenido en el servidor (`page_snapshots`)

**Estado: entrega 1 implementada (LEER snapshots, v0.0XX; migración `20261019120000_compactar_leer.sql`, sin
aplicar, con los snapshots apagados; ver "Cómo quedó la entrega 1", al final). Las entregas 2 y 3 (crearlos y
prenderlos), sin implementar** (roadmap B.9, diseño del 2026-10-01). Toca la regla de no perder datos, así que va con
pruebas antes de cualquier código que escriba en la base. **Revisado el 2026-10-01 con el diseño del historial
(`Doc_Historial.md`, decisión de Lega):** el snapshot se arma aplicando las filas en orden, no con
`Y.mergeUpdates`, para que conserve lo borrado (sección 3). Nada de esto está aplicado: la migración de abajo es un
borrador.

## En corto

- **Qué es.** Un *snapshot* es el contenido de una página hasta el update `N` del servidor, en un solo update de
  Yjs: las filas `1..N` **aplicadas en orden** en un `Y.Doc({ gc: false })` y `encodeStateAsUpdate` (sin recolectar
  lo borrado, con el texto de la primera fila que trae cada elemento, o sea, la misma información que esas filas
  aplicadas). Un dispositivo que no tiene la página baja el snapshot y la cola (`N+1..`) en vez de todas las
  filas. Hasta el 2026-10-01 decía `Y.mergeUpdates`: pierde texto borrado de versiones del medio (sección 3).
- **Nunca se borra una fila de `page_updates`.** El snapshot es una copia para bajar más rápido, no un reemplazo:
  lo que no se usa más es solo "dejar de bajarlo". Lo único que se borra son snapshots viejos, que se pueden volver a
  armar desde `page_updates`.
- **Compacta un dispositivo con permiso de edición**, con un pedido de reserva a la base, y lo comprueba por dos
  caminos de Yjs distintos (incluido lo que queda pendiente) antes de subirlo. La base no sabe leer Yjs: sus
  controles son de forma (hasta qué fila, sobre qué snapshot anterior, tamaño, huella), y sirve el snapshot solo
  cuando está **confirmado** y sigue siendo válido. Si uno sale mal, se invalida con toda su cadena y los
  dispositivos que lo usaron vuelven a bajar filas.
- **Auditado:** una auditoría independiente del diseño encontró tres caminos para que un dispositivo nuevo viera una
  página con algo de menos; están corregidos (última sección).
- **Las versiones viejas de la app no se enteran:** siguen usando `pull_page_updates`, que no cambia, y bajan las
  filas como hoy. Degradan en velocidad, nunca en datos.
- **Hoy no hace falta:** la página con más updates tiene 63 (37 KB). Se vuelve necesario con el uso en rodaje: una
  página editada por dos o tres personas todo el día llega a miles de updates, y como cada subida lleva **todos**
  los borrados de la página, el peso crece con el cuadrado del uso (10 000 subidas simuladas: 61 MB en la base
  contra un snapshot de 390 KB).
- **Lo que el snapshot no arregla:** que un dispositivo nuevo haga un pedido por página (hoy 1022 páginas con
  contenido, 1,1 updates cada una). Que cada subida repita todos los borrados (el 96 % de los bytes de
  `page_updates` en la simulación) **ya está resuelto aparte**, en la subida (roadmap B.15: `syncedDS`, ver
  `Doc_Sincronizacion.md`, "Subir solo los borrados nuevos"). Los números de la sección 1 son de antes de B.15.

## Reglas que no se rompen

1. **Ninguna fila de `page_updates` se borra ni se modifica.** Son la fuente de verdad, el historial (fase 6) y lo
   que restauran las copias de seguridad.
2. **Un snapshot no se sirve hasta estar confirmado**, y deja de servirse en cuanto deja de ser válido (ver
   "Validez").
3. **Lo que no sabe de snapshots sigue andando igual**: versiones viejas de la app, la papelera de archivos, la
   copia de seguridad, el script de restaurar.
4. **`syncedSV` y `syncedDS` nunca dicen que el servidor tiene algo que no tiene** (`Doc_Sincronizacion.md`,
   punto 2 de "Contenido de las páginas" y "Subir solo los borrados nuevos"). Bajar un snapshot avanza el vector y
   la cuenta de borrados igual que bajar sus filas: por eso el snapshot conserva los borrados (sin recolectar).
5. **Nada de editor en el camino.** Compactar es Yjs puro (`Y.Doc` sin GC y `applyUpdate`): no pasa por BlockNote, ni por
   y-prosemirror, ni por la reparación de estructura, así que no puede borrar un bloque que no conoce.

## 1. Qué problema resuelve, con números

### Cómo se guarda hoy

Hasta B.15, cada subida de contenido era `Y.encodeStateAsUpdate(doc, syncedSV)`: lo nuevo desde lo confirmado **más
el delete set entero de la página** (Yjs no sabe cuáles borrados ya tiene el servidor). Desde B.15 lleva solo los
borrados que el servidor no tiene (`syncedDS`); las filas ya subidas siguen como están, con los borrados repetidos. Sale una subida por pausa al escribir
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
rápido de lo que pesa el texto. El snapshot arregla lo primero. Lo segundo lo arregló dejar de repetir los borrados
en cada subida (B.15), que es otro cambio.

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
d = new Y.Doc({ gc: false })
applyUpdate(d, base); applyUpdate(d, u(a+1)); …; applyUpdate(d, u(N))   // base: el snapshot confirmado anterior (o nada)
snapshot(base, cola) = Y.encodeStateAsUpdate(d)
```

- **Sin GC y en orden.** Un `Y.Doc` con GC "recolectaría" el texto borrado (lo cambia por un hueco) y perdería lo
  que hace falta para el historial de versiones. Por eso el documento es sin GC, y las filas se aplican **en orden de
  `seq`**: Yjs saltea lo que ya tiene, así que cada elemento queda con el contenido de **la primera fila que lo
  trae**, que es la que tenía el texto.
- **Por qué no `Y.mergeUpdates`** (lo que decía este diseño hasta el 2026-10-01). Algunas filas vuelven a subir el
  documento entero desde un dispositivo con GC (una versión vieja de la app; cualquiera después de restaurar una
  copia, `resetForRestore`), con lo borrado ya como hueco, y `mergeUpdates` se queda con esa copia. El documento
  de hoy sale igual, pero las versiones del medio pierden texto. Medido con las 63 filas de la página real más
  editada (`Doc_Historial.md`, sección 3.2): armando el documento con `mergeUpdates`, **37 de 63** versiones salen
  iguales a aplicar las filas hasta ahí; con el snapshot aplicado en orden, **63 de 63**, también incremental (de a
  10 filas sobre el snapshot anterior), y los dos dan **los mismos bytes** que armarlo de una vez. Pesa un poco más
  (12,7 contra 11,0 KB en esa página): es el texto que `mergeUpdates` perdía.
- **Lo que depende de algo que falta.** Si una fila depende de otra que todavía no llegó al servidor (una subida
  demorada), Yjs la guarda como pendiente en el documento (`store.pendingStructs`, `pendingDs`) y
  `encodeStateAsUpdate` la incluye, así que el dispositivo que lo baja la integra cuando llega lo que falta, como
  hoy. El prototipo con `mergeUpdates` tenía 545 de 1850 snapshots con algo pendiente, todos correctos; **hay que
  repetir esa corrida con el armado nuevo** (prueba 1 de la sección 15) antes de implementarlo.
- **Determinista.** La misma base y la misma cola dan los mismos bytes (comprobado en la página real, también
  incremental contra desde cero; la corrida al azar de la prueba 1 lo vuelve a medir): dos dispositivos que
  compactan el mismo tramo sobre la misma base suben la misma huella (SHA-256), y si no, algo anda mal (ver
  "Subir").
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

`snapshot_seq` es solo una pista para no preguntar de más: la base decide siempre con el snapshot vigente de verdad
(`private.current_snapshot`, sección 4.7), no con la columna.

### 4.2 Reservar

`claim_page_compaction(page, app_version)` devuelve el tramo a compactar (`base_id`, `base_seq`, `up_to_seq`,
`last_update_id`) o nada. Anota la reserva en la página por 10 minutos: dos dispositivos no bajan lo mismo a la vez.
Si el dispositivo se cae, la reserva vence sola. La base es el snapshot vigente; si no hay ninguno (o se invalidó
la cadena, sección 12), nula: se compacta desde la fila 1.

**Una página que no se puede compactar no se reintenta en cada ciclo.** Si el snapshot pasa de 8 MB, una fila no
se puede leer o la comprobación falla, el dispositivo lo avisa (`skip_page_compaction(page, motivo)`) y la reserva
queda bloqueada 24 horas (`compaction_skip_until`), con el motivo, para mirarlo. Una comprobación que falla se anota
además en la consola, porque es la señal de un error del compactador.

### 4.3 Bajar

`pull_page_snapshot(base_id)` (la base) y `pull_page_updates(page, base_seq)` hasta `up_to_seq`: exactamente las
filas del servidor, no lo guardado en el dispositivo (que mezcla lo propio sin subir y está compactado en local).
**Nunca desde lo guardado en un dispositivo que fue lector** (privacidad de lo borrado, `Doc_Privacidad_Borrado.md`:
tiene bases con huecos, no las filas).
Cada fila se decodifica; **si una no se puede leer** (la escribió una versión más nueva), no se compacta.

### 4.4 Armar y comprobar

1. `snap`: la base y la cola aplicadas en orden en un `Y.Doc({ gc: false })`, y `Y.encodeStateAsUpdate` (sección 3).
2. **Comprobar por dos caminos:** un `Y.Doc({ gc: false })` con la base y las filas aplicadas de a una, contra otro
   con el snapshot. Tienen que ser **equivalentes**: el mismo vector de estado y el mismo delete set
   (`Y.equalSnapshots`), el mismo contenido, aplicar el estado completo de cada uno sobre una copia del otro no
   cambia nada (en los dos sentidos), y **lo pendiente igual** (abajo).
3. **Lo pendiente se compara aparte.** Lo que espera algo que no llegó (structs y borrados) no lo ven ni el vector,
   ni `Y.snapshot`, ni el evento `update`: la primera versión de esta comprobación daba por bueno un snapshot al que
   le faltaba una fila que dependía de algo ausente, y un dispositivo nuevo mostraba "hello" en vez de "hello WORLD"
   (lo encontró la auditoría). Se compara como tramos (autor, desde, hasta) unidos, decodificando
   `store.pendingStructs.update` y `store.pendingDs`, que Yjs guarda **en formato v2**. En la app lo pendiente en el
   servidor es raro (cada subida lleva todo lo que el servidor no confirmó, así que sus dependencias ya están o
   viajan con ella), pero aparece después de restaurar una copia o con una fila ilegible, y la comprobación lo cubre.
4. **No sirve comparar bytes.** `encodeStateAsUpdate` de los dos documentos da bytes distintos en 255 de 300
   casos al azar aunque sean el mismo documento: aplicar de a una parte los textos en otros lugares que el update
   fusionado. Comparar bytes daría falsas alarmas; comparar solo el texto visible no vería lo borrado.
5. Cada 10 snapshots de una página, además, se compara el nuevo contra todo desde cero (`1..N` sin base), siempre
   que esas filas pesen 16 MB o menos (si no, se salta y se anota). Si no da igual, se invalida la cadena entera
   (sección 12). Cada paso ya se comprueba contra lo que juntó, así que esto es una segunda red, contra un error de
   la propia comprobación o del dispositivo. Para las páginas más pesadas la segunda red no corre: es un riesgo que
   queda (sección 16) y que se achica mucho desde que las subidas no repiten los borrados (B.15), porque las filas
   nuevas pesan unas 25 veces menos (las viejas siguen igual).

```js
// El núcleo (lo probado en el prototipo).
function compact(base, tail) { // en orden y sin GC: conserva el texto de lo borrado (sección 3)
  const d = new Y.Doc({ gc: false });
  if (base) Y.applyUpdate(d, base);
  for (const u of tail) Y.applyUpdate(d, u);
  const out = Y.encodeStateAsUpdate(d); // incluye lo pendiente
  d.destroy();
  return out;
}
function absorbs(x, y) { // ¿aplicar todo lo de y sobre una copia de x cambia algo?
  const c = new Y.Doc({ gc: false });
  Y.applyUpdate(c, Y.encodeStateAsUpdate(x));
  let changed = false;
  c.on('update', () => (changed = true));
  Y.applyUpdate(c, Y.encodeStateAsUpdate(y));
  c.destroy();
  return !changed;
}
// Lo pendiente, como tramos unidos por autor: structs y borrados (Yjs lo guarda en v2).
const EMPTY_V2 = Y.encodeStateAsUpdateV2(new Y.Doc());
function pendingKey(x) {
  const u = Y.mergeUpdatesV2([x.store.pendingStructs?.update ?? EMPTY_V2, x.store.pendingDs ?? EMPTY_V2]);
  const d = Y.decodeUpdateV2(u);
  const structs = d.structs.filter((s) => !(s instanceof Y.Skip)).map((s) => [s.id.client, s.id.clock, s.id.clock + s.length]);
  const ds = [...d.ds.clients].flatMap(([client, items]) => items.map((i) => [client, i.clock, i.clock + i.len]));
  return tramos(structs) + '|' + tramos(ds); // tramos(): ordena y une los que se tocan, por autor
}
const same = (a, b) =>
  pendingKey(a) === pendingKey(b) && Y.equalSnapshots(Y.snapshot(a), Y.snapshot(b)) && absorbs(a, b) && absorbs(b, a);
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
- la fila `up_to_seq` existe con ese `id`, y `up_to_seq` es mayor que el del snapshot vigente (`current_snapshot`);
- `base_id` es el snapshot vigente (o los dos nulos): nunca se arma sobre una base vieja;
- tamaño entre 1 byte y 8 MB, y la huella SHA-256 coincide con lo que llegó;
- **la cadena:** cada snapshot hereda `chain_id` de su base (uno sin base empieza una cadena nueva, con su propio
  id) y `chain_min_version`, la versión más vieja de la app que armó un eslabón de la cadena;
- guarda la fila **sin confirmar**. Si ya hay una válida para el mismo tramo y la misma base: con la misma huella
  devuelve esa (reintentar no duplica); con otra huella y **la misma versión de la app**, guarda la nueva ya
  invalidada, **invalida la otra** y devuelve `snapshot_mismatch` (dos dispositivos calcularon distinto lo mismo:
  algo anda mal, mejor que nadie lo use); con otra versión de la app, devuelve `snapshot_exists` sin invalidar
  nada (otra versión de Yjs puede armar otros bytes para lo mismo). Lo único que no se repite es un snapshot
  **válido** por tramo (índice único parcial, `where invalid_at is null`): uno invalidado no impide volver a
  compactar el mismo tramo.

### 4.6 Confirmar

El mismo dispositivo baja lo que subió (`pull_page_snapshot`), comprueba la huella y que se decodifica, y llama a
`confirm_page_snapshot(id, sha256)`. La base comprueba otra vez que la base sigue siendo la vigente
(`current_snapshot`) y que la fila `up_to_seq` sigue con su `id`, marca `confirmed_at` y pone `pages.snapshot_seq`.
Desde ahí se sirve. Si el
dispositivo se cae entre subir y confirmar, el snapshot queda sin confirmar, no se sirve nunca y se limpia (ver
"¿Se borra algo?").

**Qué quiere decir "confirmado":** el snapshot se armó con las filas exactas del servidor, se comprobó por dos
caminos de Yjs, la base comprobó el tramo y la huella, y volvió entero de la base. Recién ahí reemplaza a sus filas
**para bajar**; las filas siguen ahí.

### 4.7 Validez

Un snapshot se sirve solo si está confirmado, no está invalidado, `up_to_seq <= pages.update_seq`, la fila
`up_to_seq` sigue teniendo `last_update_id` (cubre una copia restaurada que no trae esas filas, ver abajo) y su
`chain_min_version` es al menos `snapshot_min_version` (subir la versión mínima deja afuera toda cadena en la que
participó una versión con errores, aunque los eslabones nuevos sean de una versión buena).

## 5. Cómo baja un dispositivo

`pull_page_content(page, after_seq, limit)` reemplaza en la app a `pull_page_updates` (que queda igual para las
versiones viejas). Devuelve filas `(seq, update, snapshot_id, content_epoch)`:

- **Si hay un snapshot válido con `up_to_seq > after_seq` y pesa menos que las filas `after_seq+1..up_to_seq`**:
  primero el snapshot, con `seq = up_to_seq` y su `snapshot_id`, y después las filas posteriores, hasta `limit`.
- **Si no**, las filas como hoy.
- **Con los snapshots apagados**, siempre las filas: es el interruptor para volver atrás sin publicar nada.

Para el dispositivo, el snapshot es **un update más**: `applyRemote` lo junta con el resto, lo guarda en la misma
transacción que el cursor (que pasa a `up_to_seq`), avanza `syncedSV` con `serverReach` y su tope, y suma sus
borrados a `syncedDS` (B.15), como con cualquier fila. Casos:

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
- **Un snapshot que esta versión no puede leer** (lo armó una versión más nueva con algo que esta no decodifica):
  hoy `applyRemote` descarta un update ilegible y **avanza el cursor igual**, anotando `unreadable`. Con un snapshot
  eso saltearía las filas `1..up_to_seq` enteras, así que no: si la fila con `snapshot_id` no se decodifica, no se
  guarda nada de ese lote, el cursor no se mueve y esa página se vuelve a pedir con `pull_page_updates` (filas
  sueltas, como hoy) hasta la próxima vez que se abra la app.
- **Base sin la migración**: la app ve que la función no existe y vuelve a `pull_page_updates` por 10 minutos, como
  ya hace con `push_page_update` (`versionedPushMissingAt`). Va con su constante opcional
  (`SNAPSHOT_SCHEMA_VERSION`), como la papelera de archivos: no sube `DB_SCHEMA_VERSION` y no hay aviso. **El
  árbol** pide `snapshot_seq` y `content_epoch` solo si `workspace_settings.schema_version` llega a esa constante
  (como `PROJECT_STATES_SCHEMA_VERSION` en `remote.ts`), y si igual falta la columna reintenta sin ellas: pedir una
  columna que no existe dejaría al workspace sin árbol.

El dispositivo anota en `DocState` el último snapshot que aplicó (`snapshotId`) y la época de contenido de la
página que vino **en la misma respuesta** (`contentEpoch`, ver "Si un snapshot sale mal"): si la leyera del árbol,
podría anotar una época posterior al snapshot que bajó y no enterarse nunca de que lo invalidaron. Las versiones
anteriores, que leen y vuelven a escribir el mismo objeto, conservan esos campos.

## 6. Versiones viejas de la app

- **No conocen los snapshots y no les hace falta.** Siguen llamando a `pull_page_updates` y `push_page_update`, que no
  cambian, y como `page_updates` nunca pierde una fila, bajan todo como hoy: más lento, sin perder nada.
- **No pueden compactar**: no conocen las funciones nuevas.
- **No hace falta subir `min_app_version`.** Lo nuevo no cambia nada de lo guardado ni de cómo se sube; solo agrega
  una forma de bajar.
- **Una versión con un compactador con errores** se deja afuera subiendo `snapshot_min_version` por encima de ella:
  deja de servirse toda cadena en la que participó (`chain_min_version`, sección 4.7), y la próxima compactación de
  esas páginas arranca desde la fila 1.
- **Misma base con una versión anterior** (pestaña sin recargar): lo bajado como snapshot quedó guardado como una
  fila más de `docUpdates`; la versión anterior lo lee como cualquier otra.

## 7. Colaboración, y-prosemirror y el editor

- **El parche de y-prosemirror no interviene.** Compactar no abre el editor: junta updates de Yjs. Lo que escribe
  el parche (el texto de los huecos, la marca del renglón `lgaStableGaps`, los atributos `lgaGapText`) son
  elementos y atributos de Yjs como cualquier otro, y aplicarlos en un documento sin GC los conserva tal cual.
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
- **Historial de versiones (`Doc_Historial.md`):** las filas quedan con su autor y su hora. Los snapshots, armados
  en orden y sin GC, conservan el texto borrado de las versiones del medio, así que pueden servir de punto de
  partida para armar versiones de páginas enormes (con `mergeUpdates` no servían: 37 de 63). Hoy el historial lee
  solo filas.

## 9. Copias de seguridad y restaurar

- **La copia** (`z_shotdocs_backup`) lleva toda la base con `supabase db dump`: `page_snapshots` entra sola. Crece
  poco (uno o dos snapshots por página compactada).
- **Restaurar sobre el mismo proyecto: el script vacía siempre `page_snapshots`** y deja `pages.snapshot_seq` en 0
  (`restaurar_mismo_proyecto.sql`, repo privado; **es requisito para prenderlos**). Dos razones:
  - Si la copia trae snapshots y es anterior a una invalidación, el script los recarga con su `id` original y sin
    `invalid_at`, y pasan la validez (la fila `up_to_seq` es la misma): **un snapshot descartado volvería a
    servirse.**
  - Si la copia es anterior a la tabla, el script la conserva (regla 7: tablas más nuevas que la copia). No haría
    daño (la validez los descarta: o `up_to_seq` pasa de `update_seq`, o la fila `up_to_seq` tiene otro `id`, porque
    el contador no vuelve atrás), pero no hay razón para guardarlos.

  Vaciar no pierde nada: son copias de `page_updates`, que sí vuelve con la copia; la próxima compactación arranca
  desde la fila 1. `pages.content_epoch` queda en el mayor entre el de hoy y el de la copia (nunca vuelve atrás).
- **Los dispositivos** ven la generación nueva y hacen lo de siempre (`resetForRestore`: cursor, vector y envío a
  cero), que además borra `snapshotId` y `contentEpoch`. Bajan de cero: filas, hasta que haya un snapshot nuevo.

## 10. Permisos (Row Level Security)

- `page_snapshots`: **ningún permiso directo** para `authenticated` ni `anon` (RLS prendida y sin políticas). Todo
  pasa por funciones, que sirven solo lo confirmado y válido; si la tabla se pudiera leer, se verían también los sin
  confirmar e invalidados (hasta 8 MB cada uno). Lo que un snapshot muestra es lo mismo que las filas que cubre
  (también lo borrado), así que **solo se sirve a quien ve lo borrado** (`private.sees_deleted`, D14,
  `Doc_Privacidad_Borrado.md`, sección 5): los demás bajan lo de siempre por `pull_page_updates` (con la privacidad
  prendida, la base limpia).
- Escriben solo las funciones `security definer`: reservar, subir, confirmar e invalidar piden nivel 3 sobre la
  página (`page_level`); bajar, **`private.sees_deleted`** (el snapshot conserva lo borrado: quien no lo ve baja la
  base limpia, `Doc_Privacidad_Borrado.md`). Todas controlan que la página no esté en un proyecto borrado (como hoy
  `page_level`).
- Las funciones auxiliares (`private.current_snapshot`, `private.snapshots_allowed`) llevan `revoke all ... from
  public, anon, authenticated`, como las de `equipo.sql`: si no, Postgres deja ejecutarlas a `PUBLIC`.
- Columnas nuevas de `pages` (`snapshot_seq`, `content_epoch`, la reserva): sin permiso de `update` para
  `authenticated`; las cambian solo esas funciones (que corren como su dueño, así que el trigger
  `pages_permissions` no las frena y `updated_at` no se toca: no está en la lista de columnas que lo cambian).

## 11. ¿Se borra algo alguna vez?

**Propuesta: ninguna fila de `page_updates`, nunca.** Solo se deja de bajarlas. Razones: son el historial con autor
y hora (fase 6), lo que restauran las copias, y la red de seguridad si un snapshot sale mal; y ocupan poco
comparado con el límite (7,5 MB de 500 MB hoy). Lo que hacía crecer la tabla de verdad eran los borrados repetidos
en cada subida, y eso se arregló en la subida (B.15), no borrando.

**Lo que sí se borra, porque se puede volver a armar desde `page_updates`:**

- Al confirmar un snapshot, los de esa página anteriores a su base (quedan el vigente y el anterior). La cadena no
  se pierde: cada uno lleva `chain_id`, así que invalidar alcanza a todos los de la cadena aunque los del medio ya no
  estén.
- Los sin confirmar con más de un día (un dispositivo que se cayó entre subir y confirmar).
- Los invalidados con más de 30 días (se guardan ese tiempo para mirar qué pasó).

**Si algún día hiciera falta borrar filas de `page_updates`** (la base llegando al límite, por ejemplo), sería una
decisión de Lega con estas condiciones mínimas: un snapshot confirmado y comprobado desde cero que las cubra, con
más de 30 días; la fila presente en al menos una copia mensual (las que se guardan para siempre); y ningún
dispositivo de una versión sin snapshots activo en ese workspace (esas versiones bajan filas desde cero). Hoy no se
propone.

## 12. Si un snapshot sale mal

- **Invalidar:** `invalidate_page_snapshot(id, motivo)` (nivel 3). Invalida **la cadena entera** (todos los de su
  `chain_id`): un error en un eslabón pasa a los que se armaron encima, y si se invalidara solo el malo, el de más
  arriba seguiría sirviéndose con el mismo error. Pone `pages.snapshot_seq` en 0 y suma uno a `pages.content_epoch`;
  la próxima compactación arranca desde la fila 1. Lo llama la app cuando la comparación desde cero no da igual, y se
  puede llamar a mano desde el SQL Editor.
- **Los dispositivos que lo usaron:** el árbol trae `content_epoch`. Si es **distinto** del que el dispositivo anotó
  (no "mayor": después de restaurar puede haber cambiado de cualquier forma) y el dispositivo aplicó algún snapshot de
  esa página (`DocState.snapshotId`), pone el cursor de esa página en 0 y la baja de nuevo (filas, porque la cadena ya
  no se sirve; Yjs no duplica lo que ya tiene). **Borra también `syncedSV` y `syncedDS` de esa página** (desde
  B.15): un snapshot al que solo le faltaba algo no pudo hacer avanzar ninguna de las dos cuentas de más, pero uno
  malo de otra forma (con un borrado o un elemento que las filas no tienen) suma a las dos al bajarlo, y con eso
  el dispositivo dejaría de subir un borrado propio igual al del snapshot, que después de invalidarlo el servidor
  no tiene. Sin las cuentas, la página vuelve a subir entera una vez (Yjs no duplica lo que el servidor ya tiene).
  Lo propio sin subir nunca se toca.
- **Apagar todo:** `snapshot_min_version = null` en `workspace_settings`. Desde el próximo pedido, todos bajan filas.

## 13. Migración (borrador, sin aplicar)

Va como `supabase/migrations/<fecha>_snapshots.sql` en la entrega 1, con su prueba de permisos
`supabase/tests/snapshots_permisos.sql`. Hace falta `pgcrypto` (`extensions.digest`), que Supabase ya trae.

```sql
-- Snapshots del contenido de una página: una copia de page_updates 1..up_to_seq en un solo update de Yjs
-- (las filas aplicadas en orden en un Y.Doc sin GC). Nunca reemplazan a page_updates: solo se bajan en su lugar.
create table public.page_snapshots (
  id             uuid primary key default gen_random_uuid(),
  page_id        uuid not null references public.pages (id) on delete cascade,
  up_to_seq      bigint not null check (up_to_seq > 0),
  last_update_id bigint not null,                 -- page_updates.id de la fila up_to_seq
  base_id        uuid,                            -- sin FK: la base se puede limpiar; la cadena la sigue chain_id
  chain_id       uuid not null,                   -- id del primer snapshot de la cadena (el que no tiene base)
  chain_min_version numeric(8, 3) not null,       -- la versión más vieja de la app que armó un eslabón
  state          bytea not null,
  state_sv       bytea not null,                  -- vector de estado (diagnóstico y comprobaciones)
  sha256         bytea not null,
  state_bytes    int generated always as (octet_length(state)) stored,
  app_version    numeric(8, 3) not null,
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  confirmed_at   timestamptz,
  invalid_at     timestamptz,
  invalid_reason text
);
-- Un solo snapshot VÁLIDO por tramo: uno invalidado no impide volver a compactar el mismo tramo.
create unique index page_snapshots_tramo_key on public.page_snapshots (page_id, up_to_seq)
  where invalid_at is null;
create index page_snapshots_chain_idx on public.page_snapshots (chain_id);

alter table public.pages
  add column snapshot_seq          bigint not null default 0,  -- pista para el árbol; la base decide con current_snapshot
  add column content_epoch         int    not null default 0,  -- sube al invalidar; nunca vuelve atrás
  add column compaction_claim_at   timestamptz,
  add column compaction_claim_by   uuid,
  add column compaction_skip_until timestamptz,                -- no se puede compactar (motivo abajo)
  add column compaction_skip_why   text;

alter table public.workspace_settings
  add column snapshot_min_version numeric(8, 3) check (snapshot_min_version >= 0);  -- null: apagados

-- Sin políticas ni grants: nadie lee ni escribe la tabla desde la API; todo pasa por las funciones.
alter table public.page_snapshots enable row level security;
revoke all on public.page_snapshots from anon, authenticated;
-- pages: sin grants nuevos (las columnas nuevas solo las tocan las funciones).

-- El snapshot vigente de una página, si es válido: confirmado, no invalidado, su última fila sigue igual y toda su
-- cadena es de una versión permitida. Null si los snapshots están apagados.
create function private.current_snapshot(p uuid)
returns public.page_snapshots
language sql stable security definer set search_path = ''
as $$
  select s.* from public.page_snapshots s
  join public.pages pg on pg.id = s.page_id
  cross join public.workspace_settings ws
  where s.page_id = p and s.confirmed_at is not null and s.invalid_at is null
    and ws.snapshot_min_version is not null and s.chain_min_version >= ws.snapshot_min_version
    and s.up_to_seq <= pg.update_seq
    and exists (select 1 from public.page_updates u
                where u.page_id = p and u.seq = s.up_to_seq and u.id = s.last_update_id)
  order by s.up_to_seq desc limit 1;
$$;
revoke all on function private.current_snapshot(uuid) from public, anon, authenticated;

-- ¿Prendidos y con versión suficiente para armar uno? (Como private.app_version_allowed.)
create function private.snapshots_allowed(p_app_version text) returns boolean ...;
revoke all on function private.snapshots_allowed(text) from public, anon, authenticated;

-- Bajar: el snapshot (si conviene) y las filas posteriores; si no, como pull_page_updates. Cada fila lleva la
-- época de contenido de la página, leída en la misma consulta.
create function public.pull_page_content(p_page_id uuid, p_after_seq bigint, p_limit int default 200)
returns table (seq bigint, update text, snapshot_id uuid, content_epoch int)
language plpgsql stable security definer set search_path = '' as $$
declare
  s     public.page_snapshots;
  ep    int;
  lim   int := least(greatest(p_limit, 1), 1000);
begin
  if not private.can_view_page(p_page_id) then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  select pg.content_epoch into ep from public.pages pg where pg.id = p_page_id;
  s := private.current_snapshot(p_page_id);
  if s.id is not null and s.up_to_seq > p_after_seq
     and s.state_bytes < (select coalesce(sum(octet_length(u.update)), 0) from public.page_updates u
                          where u.page_id = p_page_id and u.seq > p_after_seq and u.seq <= s.up_to_seq) then
    return query select s.up_to_seq, translate(encode(s.state, 'base64'), E'\n', ''), s.id, ep;
    p_after_seq := s.up_to_seq;
    lim := lim - 1;
    if lim = 0 then return; end if;
  end if;
  return query
    select u.seq, translate(encode(u.update, 'base64'), E'\n', ''), null::uuid, ep
    from public.page_updates u
    where u.page_id = p_page_id and u.seq > p_after_seq
    order by u.seq limit lim;
end; $$;

-- Reservar, subir, confirmar, bajar uno, saltear e invalidar: como se describe en las secciones 4 y 12. Todas
-- comparan contra private.current_snapshot(), nunca contra pages.snapshot_seq.
create function public.claim_page_compaction(p_page_id uuid, p_app_version text)
  returns table (base_id uuid, base_seq bigint, up_to_seq bigint, last_update_id bigint) ...;
create function public.push_page_snapshot(p_page_id uuid, p_base_id uuid, p_up_to_seq bigint,
  p_last_update_id bigint, p_state text, p_sv text, p_sha256 text, p_app_version text) returns uuid ...;
create function public.confirm_page_snapshot(p_id uuid, p_sha256 text) returns boolean ...;
create function public.pull_page_snapshot(p_id uuid) returns text ...;   -- nivel 1; también sin confirmar (la vuelta)
create function public.skip_page_compaction(p_page_id uuid, p_reason text) returns void ...;
create function public.invalidate_page_snapshot(p_id uuid, p_reason text) returns boolean ...;  -- toda la cadena
-- revoke de public y anon, grant execute a authenticated.
-- El árbol (remote.ts) pide snapshot_seq y content_epoch solo con schema_version >= SNAPSHOT_SCHEMA_VERSION.
notify pgrst, 'reload schema';
```

La migración no toca `page_updates`, `push_page_update` ni `pull_page_updates`, y deja los snapshots apagados.

## 14. Cambios en la app

| Archivo | Qué cambia |
|---|---|
| `src/sync/remote.ts` | `pullContent` (con vuelta a `pullUpdates` si falta la función), `claimCompaction`, `pushSnapshot`, `pullSnapshot`, `confirmSnapshot`, `skipCompaction`, `invalidateSnapshot`; el árbol pide `snapshot_seq` y `content_epoch` según `schema_version`, con reintento sin ellas |
| `src/sync/types.ts` | `RemoteUpdate.snapshotId?` y `contentEpoch?`, `PageRow.snapshot_seq?`, `PageRow.content_epoch?` |
| `src/sync/docs.ts` | `pullPage` usa `pullContent`; `applyRemote` anota `snapshotId` y `contentEpoch`, y si el snapshot no se puede leer no guarda el lote ni mueve el cursor (vuelve a filas); el reinicio de una página por `content_epoch` (el cursor, `syncedSV` y `syncedDS`); `resetForRestore` borra también `snapshotId` y `contentEpoch` |
| `src/sync/compact.ts` (nuevo) | `compact`, `verify`, `same`, `pendingKey` y el que compacta una página (reservar, bajar, armar, comprobar, subir, confirmar, saltear) |
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
   **pruebas mutantes**: un snapshot al que le falta una fila, un borrado sobre algo integrado, **una fila pendiente o
   un borrado pendiente** (los casos de la auditoría) tiene que fallar la comprobación. Con la comparación de lo
   pendiente, el prototipo rechaza los cuatro y sigue sin falsas alarmas en 600 corridas. **Desde el 2026-10-01,
   además:** con filas que vuelven a subir el documento entero desde un dispositivo con GC, cada versión armada sobre
   el snapshot (con `Y.createDocFromSnapshot` y los snapshots del historial) es igual a aplicar las filas hasta ahí,
   y un snapshot armado con `mergeUpdates` tiene que fallar esa comparación (mutante).
2. **El dispositivo con el servidor en memoria** (`docs.test.ts`, `sync.test.ts`): dispositivo nuevo, cursor viejo,
   cursor viejo con ediciones sin subir, subida en vuelo mientras llega un snapshot, cerrar la app en cada punto de
   `applyRemote`, un snapshot ilegible (el cursor no se mueve), una invalidación con la época leída en la misma
   respuesta, una base sin la migración (el árbol sigue llegando); en cada paso, la revisión que ya existe de que
   `syncedSV` no diga de más, y la de B.15 de que `syncedDS` tampoco (`uploadDeletes.test.ts`); una invalidación
   borra las dos cuentas de la página.
3. **Al azar con varios dispositivos y versiones** (`localSaveRandom.test.ts` y las corridas de tres dispositivos de
   `docs.test.ts`): compactaciones en momentos al azar, reservas que vencen, confirmaciones que no llegan, una
   invalidación, una restauración, y **la versión publicada** (`fixtures/publishedDocs.ts`, que solo conoce
   `pull_page_updates`) sobre la misma base y como otro dispositivo. Al final: todos los dispositivos tienen lo mismo,
   igual a todas las filas del servidor aplicadas de a una, y nada escrito se perdió. `LOCAL_SAVE_SEEDS` para correr
   más.
4. **Con el editor real** (`editor.test.ts`, jsdom): una página con fotos en línea, script y preguntas, compactada y
   abierta en un dispositivo nuevo: el mismo documento que sin snapshot, sin reparaciones de más.
5. **Permisos en SQL** (`supabase/tests/snapshots_permisos.sql`, en una transacción que se deshace, contra la base):
   quien ve baja el snapshot y no puede subir; nadie lee la tabla directo; quien edita otra página no puede; tramo con
   otro `id`, base vieja, huella que no coincide, tamaño, versión vieja y apagados: rechazados; mismo tramo con la
   misma huella devuelve el mismo; con otra huella y la misma versión, invalida; con otra versión, `snapshot_exists`;
   invalidar un eslabón invalida la cadena; subir `snapshot_min_version` deja de servir las cadenas viejas; un
   snapshot de un proyecto borrado no se sirve; `pull_page_updates` devuelve lo mismo que antes.
6. **Restaurar** (el script del repo privado, en una base aparte): una copia anterior a la tabla, una con snapshots
   y una anterior a una invalidación; en los tres casos `page_snapshots` queda vacía, `content_epoch` no vuelve atrás y
   lo servido coincide con las filas.
7. **De punta a punta** (Playwright contra la base, en un proyecto de prueba): dos navegadores editan 300 veces, uno
   compacta, un tercero abre de cero y ve lo mismo; la versión publicada abre la misma página y baja filas.
8. **Medir en el navegador** el tiempo de abrir una página de 2000 y 5000 subidas en un dispositivo nuevo, con y sin
   snapshot, en la PC y en el iPhone.

## 16. Riesgos

| Riesgo | Qué lo cubre |
|---|---|
| Un error del compactador (o del navegador) arma un snapshot al que le falta algo | Comprobación por dos caminos, con lo pendiente, antes de subir; vuelta desde la base antes de confirmar; comparación desde cero cada 10; huella distinta entre dos dispositivos de la misma versión invalida; invalidar la cadena y `content_epoch`; las filas nunca se borran |
| En páginas cuyas filas pesan más de 16 MB no corre la comparación desde cero | Cada paso igual se comprueba contra lo que juntó; queda como riesgo. Se achica con no repetir los borrados (sección 18) |
| Un editor malicioso sube un snapshot fabricado | Lo mismo que puede hacer con un update; se invalida a mano. Para cerrarlo del todo: Edge Function (pregunta 2) |
| Un snapshot al que le falta un bloque con una foto hace que la papelera de archivos la marque sin uso | La marca no borra nada (la papelera de archivos guarda 30 días y el borrado automático está apagado); invalidar y volver a bajar la vuelve a usar |
| Restaurar una copia (anterior a los snapshots, o anterior a una invalidación) | El script vacía la tabla y no deja volver atrás `content_epoch` (requisito para prenderlos); la validez por `last_update_id` |
| Una página que no se puede compactar (más de 8 MB, algo ilegible) se reintenta en cada ciclo | `compaction_skip_until`: 24 horas, con el motivo |
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
3. **Prenderlos**: antes, el cambio del script de restaurar (vaciar `page_snapshots`, `content_epoch` que no vuelve
   atrás; repo privado, con su prueba 6). Probar de punta a punta en un proyecto de prueba (7) y medir (8); después
   `snapshot_min_version` a la versión de la entrega 2 en Wanka. Mirar los snapshots inválidos y las páginas
   salteadas (`compaction_skip_why`) la primera semana.
4. **Más adelante**: `verifyHistory` sobre el snapshot.

Antes de cerrar cada entrega, la auditoría de siempre (funcionalidad, permisos y RLS, no perder datos, docs).

## 18. Fuera de este diseño (y por qué importa)

- **No repetir los borrados en cada subida: hecho aparte (B.15).** Era lo que más pesaba (96 % de los bytes en la
  simulación). El dispositivo guarda qué borrados tiene el servidor (`syncedDS`, junto a `syncedSV`) y sube solo los
  nuevos; ver `Doc_Sincronizacion.md`, "Subir solo los borrados nuevos". Lo que toca a este diseño: el snapshot
  tiene que conservar los borrados (sin recolectar), y al invalidarse uno que el dispositivo usó se borran las dos
  cuentas de la página (sección 12).
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

**Decidido el 2026-10-01** (Lega delegó, con el diseño del historial): el snapshot conserva lo borrado, armado
aplicando las filas en orden en un documento sin GC en vez de `Y.mergeUpdates` (sección 3, y `Doc_Historial.md`,
pregunta 4).

## Cómo se midió

- **La base**: consultas de solo lectura por la Management API de Supabase (filas, bytes, tamaño de tabla y base,
  `explain analyze` de la lectura de `pull_page_updates`). El viaje a Supabase, con `auth/v1/health` (unos 70 ms).
- **Lo que daría un snapshot en páginas reales** (antes del cambio del 2026-10-01; con el armado nuevo, la página de 63
  filas da 12,7 KB en vez de 11,0): las filas bajadas por la misma API, juntadas con `Y.mergeUpdates`
  (Yjs 13.6.33) y comparadas contra aplicarlas de a una. No se guardó contenido.
- **El crecimiento**: una simulación en Node con el patrón de subida de la app (una semilla fija; los tiempos son de
  una PC).
- **El prototipo**: 600 corridas al azar (dos semillas, 300 cada una) de tres dispositivos con subidas demoradas y
  bajadas parciales, 1850 snapshots incrementales (545 con algo pendiente): 0 fallas de equivalencia (por los dos
  caminos, con lo pendiente, y contra todo desde cero), 1850 de 1850 deterministas, 600 dispositivos nuevos y 600 con
  cursor viejo y ediciones propias sin pérdida. Las cuatro mutantes (le falta una fila, un borrado integrado, una
  fila pendiente, un borrado pendiente) se rechazan.

## Correcciones de la auditoría (ya incorporadas arriba)

Una auditoría independiente del diseño encontró tres caminos por los que un dispositivo nuevo podía abrir una página
con algo de menos sin que nadie lo notara (nunca con pérdida en el servidor: `page_updates` queda entera), y varios
problemas menores. Todo quedó corregido en el texto:

| Hallazgo | Corrección |
|---|---|
| **Grave:** la comprobación no veía lo pendiente; un snapshot sin una fila que dependía de algo ausente pasaba | Se compara lo pendiente como tramos (en v2, como lo guarda Yjs); el prototipo rechaza esos casos (4.4) |
| **Grave:** invalidar un snapshot dejaba vivos los armados encima | Invalidar alcanza a toda la cadena (`chain_id`), que no se pierde al limpiar; la siguiente arranca desde la fila 1 (12) |
| **Grave:** restaurar una copia revivía snapshots invalidados y hacía volver atrás la época | El script vacía siempre la tabla y la época no vuelve atrás; `resetForRestore` borra los campos nuevos; la época se compara con "distinto" (9, 12) |
| `unique (page_id, up_to_seq)` no dejaba invalidar ni volver a compactar un tramo | Índice único solo sobre los válidos (13) |
| La época leída del árbol podía ser posterior al snapshot bajado | Viene en la misma respuesta de `pull_page_content` (5) |
| Un snapshot ilegible salteaba el historial entero | No se guarda el lote ni se mueve el cursor; esa página baja filas (5) |
| Pedir columnas nuevas en el árbol rompía un workspace sin migrar | Según `schema_version`, con reintento sin ellas (5) |
| `snapshot_seq` podía quedar viejo | Las funciones deciden con `current_snapshot()` (4.1, 13) |
| Una página que no se puede compactar se reintentaba en cada ciclo | `compaction_skip_until` con el motivo (4.2) |
| Versiones como texto, función auxiliar ejecutable por todos, tabla legible con lo no confirmado | `numeric(8,3)`, `revoke`, sin permisos directos sobre la tabla (10, 13) |
| El reinicio por época volvía a subir todo | Solo el cursor: un snapshot incompleto no pudo inflar `syncedSV` (12). **Revisado con B.15:** uno malo con algo de más sí infla `syncedSV` y `syncedDS`, así que el reinicio borra las dos cuentas y la página sube entera una vez (12) |
| Otra versión de Yjs puede dar otros bytes para lo mismo | Huellas distintas invalidan solo entre la misma versión de la app (4.5) |

## Cómo quedó la entrega 1 (LEER snapshots)

Implementada en v0.0XX. Nadie arma snapshots todavía: la app solo sabe bajarlos. **Sin filas en `page_snapshots`, o con
los snapshots apagados (como deja la migración), la app hace exactamente los mismos pedidos que antes** y baja lo
mismo (probado con el servidor en memoria y con el cliente de verdad contra un PostgREST de juguete). Se puede publicar
sola. No hace falta subir `min_app_version`: no cambia nada de lo guardado ni de cómo se sube.

**La base** (`supabase/migrations/20261019120000_compactar_leer.sql`, `schema_version` 17; la 16 es de menciones):

- `page_snapshots` como en la sección 13, con los `check` de tamaño (1 byte a 8 MB) y de la huella (32 bytes);
  `pages.snapshot_seq` y `pages.content_epoch` (se leen con el árbol, no se escriben desde la API); el interruptor
  `workspace_settings.snapshot_min_version` (nulo: apagados).
- **La reserva va en una tabla aparte, `page_compaction`** (`claim_at`, `claim_by`, `skip_until`, `skip_why`), sin
  permisos: en `pages` se leería con el árbol quién compacta qué. Cambio respecto de la sección 13.
- `private.current_snapshot`, `private.snapshots_allowed` y `private.invalidate_snapshot_chain` (sin `execute` para
  nadie de la API).
- `pull_page_content(page, after_seq, limit)`: si quien llama ve lo borrado y hay un snapshot vigente que pasa del
  cursor y pesa menos que las filas que reemplaza, el snapshot y las filas siguientes; si no, **llama a
  `pull_page_updates`** (misma respuesta, también la base limpia para quien no ve lo borrado) y le suma la época. Así,
  sin snapshots, no puede devolver otra cosa que lo de siempre.
- Las funciones de quien compacta, para la entrega 2: `claim_page_compaction` (ver lo borrado, prendidos y versión,
  fuera de la papelera, sin reserva de otro ni salteo vigente, 100 filas y 64 KB de cola y la mitad del vigente),
  `push_page_snapshot` (devuelve `(snapshot_id, result)` con `ok`, `snapshot_mismatch` o `snapshot_exists`: con
  `snapshot_mismatch` tiene que guardar e invalidar, así que no puede ser un error), `pull_page_snapshot` (el vigente,
  o uno propio sin confirmar), `confirm_page_snapshot` (solo quien lo subió, con su huella; limpia los anteriores a la
  base, los sin confirmar de más de un día y los invalidados de más de 30), `skip_page_compaction` e
  `invalidate_page_snapshot` (nivel 3, toda la cadena, `content_epoch` + 1).

**La app** (`src/sync/`):

- `remote.ts`: `pullContent` (con los snapshots apagados según los últimos ajustes, o sin la función, hace el mismo
  pedido de siempre a `pull_page_updates`; sin la función, por 10 minutos); el árbol pide `snapshot_seq` y
  `content_epoch` desde la versión 17 y, si faltan igual, reintenta sin ellas; `SNAPSHOT_SCHEMA_VERSION` (no sube
  `DB_SCHEMA_VERSION`). `linkRemote.ts`: el visitante del link sigue bajando por `plink_pull_page`.
- `docs.ts`: `pullPage` baja con `pullContent`; `applyRemote` anota en `DocState` el último snapshot aplicado y la
  época de la misma respuesta, en la misma transacción que lo guardado y el cursor. **Un snapshot ilegible** no guarda
  nada del lote ni mueve el cursor, y la página baja en filas hasta que se vuelve a abrir la app. **El reinicio por
  época** (si el dispositivo aplicó un snapshot y la época es otra, la del árbol o la de la misma respuesta): cursor a
  0, sin `syncedSV`, `syncedDS` ni envío pendiente, y si la persona puede escribir, la página vuelve a subir entera una
  vez; lo guardado no se toca. `resetForRestore` borra también los dos campos nuevos.
- `engine.ts`: el ciclo baja también las páginas al día cuya época cambió, y le pasa a cada una la época del árbol.
- `testing.ts`: el servidor en memoria con las mismas funciones y reglas (y `contentCalls`, los pedidos de contenido,
  para comparar con lo de antes).

**Lo que cambió respecto del diseño:** la reserva en `page_compaction`; `push_page_snapshot` devuelve una fila con el
resultado; `pull_page_content` y `pull_page_snapshot` piden `sees_deleted` (D14); el reinicio por época, que el plan
ponía en la entrega 2, va en esta porque es parte de leer: una versión que baja snapshots tiene que poder dejarlos; si
un snapshot vigente cambia de id en su fila final (copia restaurada sin el paso del script), se sirve el anterior de la
cadena que siga valiendo, no ninguno.

**Pruebas:**

- `supabase/tests/snapshots_permisos.sql` (prueba 5), corrida en `begin … rollback` contra la base real con la
  migración: apagados y prendidos sin snapshots, `pull_page_content` igual a `pull_page_updates` para todos; nadie lee
  las tablas ni llama a lo de `private`; quién reserva, sube, baja, confirma, saltea e invalida, con cada rechazo;
  quien no ve lo borrado nunca recibe el snapshot, tampoco con D14 prendido (recibe la base limpia); el peso y el lote;
  mismo tramo con la misma huella, con otra y la misma versión (invalida la cadena) y con otra versión; la cadena y su
  invalidación; subir `snapshot_min_version`; una fila final con otro id y `update_seq` menor; la limpieza al
  confirmar; un proyecto borrado; `page_updates` intacta. **60 mutantes de la migración: 56 detectados; los 4 que no,
  equivalentes.** Las otras 23 pruebas de `supabase/tests/` pasan con la migración puesta.
- `src/sync/snapshots.test.ts` (pruebas 2, 3 y 6): sin snapshots, los mismos pedidos y el mismo resultado; un
  dispositivo nuevo, uno atrasado (filas si pesan menos), uno atrasado con ediciones sin subir, una subida en vuelo,
  cerrar la app en cada punto de la bajada, un snapshot ilegible, quien solo ve y el invitado, la versión publicada
  v0.100 sobre la misma base, una base de una versión anterior que conserva los campos, la invalidación (un snapshot
  al que le falta una fila y otro con un borrado de más, la época de la misma respuesta, el ciclo), subir la versión
  mínima, restaurar una copia en tres momentos y sin el paso del script, el cliente de verdad (qué pide, según la
  versión y el interruptor) y la corrida al azar (tres dispositivos, la versión publicada, snapshots armados por el
  servidor en momentos al azar, invalidaciones, sin red, cerrar la app y dispositivos nuevos; `SNAPSHOT_SEEDS`, 6 por
  defecto; con 200: 86 snapshots servidos, 68 invalidados, todo igual al servidor y las cuentas sin decir de más).
  **23 mutantes del dispositivo y del servidor en memoria: 22 detectados**; el otro (el reinicio sin anotar la época)
  es equivalente: la bajada que sigue la anota.
- La prueba 6 se corrió con el servidor en memoria (el script de restaurar del repo privado no cambió: es requisito
  de la entrega 3, antes de prenderlos).

**Para prenderlos (entrega 3):** aplicar esta migración (con copia de seguridad), que el script de restaurar vacíe
`page_snapshots` y `page_compaction`, deje `snapshot_seq` en 0 y no haga volver atrás `content_epoch`; la entrega 2
publicada; y `update public.workspace_settings set snapshot_min_version = <versión de la entrega 2> where id`.
