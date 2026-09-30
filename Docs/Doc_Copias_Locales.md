# Liberar la copia de la app en el dispositivo (P.10)

Estado: **diseño, sin implementar**. Falta la auditoría previa y que Lega responda las decisiones del final.
Lo pidió Lega el 2026-09-30, al responder las decisiones de P.6 (`Doc_Adjuntos.md`): el archivo que el usuario
eligió **nunca se toca** (queda en su disco o en su carrete de fotos); lo que se puede liberar es **la copia que
la app guarda en el almacenamiento del navegador** después de que el archivo está confirmado en el Drive. El caso
típico: un video de 3 GB subido desde el iPhone, que queda ocupando 3 GB en el navegador para siempre. Sale de
leer `src/media/queue.ts`, `src/media/mediaDb.ts`, `src/ui/carreteLoader.ts`, `src/ui/attachmentOpen.ts`,
`src/ui/AttachmentSheet.tsx`, `src/ui/printPage.ts` y el portero en `main` (v0.051).

## Qué se pide

1. Liberar la copia del navegador de un archivo **ya confirmado en el Drive**, sola (con reglas) y a mano.
2. Decir con claridad qué se pierde: verlo **sin red en ese dispositivo**. La miniatura se queda.
3. Poder volver a tenerlo: se ve y se baja por el portero como cualquier archivo de otro dispositivo, y se puede
   volver a guardar en el dispositivo.

## Reglas que no se rompen

- **Nunca se libera algo que no está confirmado en el Drive** (sección 2). Ante la duda, no se libera.
- Solo se borra el original de `blobs`. **El registro, la miniatura, lo que se sabe del archivo y los usos
  quedan**: la página se ve igual.
- El archivo del usuario (su disco, su carrete) no se toca: la app no tiene cómo y no lo intenta.
- **Sin migración ni propiedades nuevas en el documento**; la base del dispositivo **no cambia de versión**
  (campos opcionales en `MediaRecord`).
- Nada de esto depende de la red para decidir que algo **no** se libera: sin red, no se libera nada.

## Resumen

- **Qué:** `blobs[id]` de un archivo agregado en este dispositivo, con `pending: 0`, `driveId` y la base
  diciendo que está en Drive; además, justo antes, el portero sirve un pedacito del archivo con el peso correcto.
- **Cuándo, sola:** copias de 100 MB o más, subidas hace 3 días o más y sin abrir en este dispositivo hace 14
  días; si el navegador se está quedando sin lugar, reglas más amplias, empezando por lo menos usado.
- **A mano:** "Espacio en este dispositivo" (menú de la cuenta) con los números y *Liberar*; por archivo, desde
  su hoja o su barra. Y "Mantener en este dispositivo" para lo que no se quiere liberar nunca.
- **Después:** abrir o bajar usa el pase del portero (ya es el camino de todo archivo que no está en el
  dispositivo); sin red, la miniatura con el aviso.

## 1. Qué guarda hoy la app en el dispositivo

Cada cuenta de cada workspace tiene su base `<base local>:media` (`mediaDbName`), con estos almacenes:

| Almacén | Qué tiene | Se escribe | Se borra |
|---|---|---|---|
| `files` | Un `MediaRecord` por archivo **agregado en este dispositivo** (nombre, tipo, peso, medidas, `pending`, `driveId`, error…). | Al agregar (`save`) y en cada paso de la cola. | Nunca. |
| `blobs` | **El original entero**, tal como lo entregó el navegador, solo de lo agregado acá. | En `save`, junto con el registro (todo o nada). | **Nunca.** Es lo que libera P.10. |
| `thumbs` | La miniatura JPEG (unos 20–60 KB): la hecha acá o la bajada del bucket `thumbs`. | `probeNow`, `display`, `refreshMissing`. | Nunca. |
| `known` | Lo que la base sabe de archivos de otros dispositivos (`KnownFile`), para mostrarlos sin red. | `fetchMeta`, `refreshMissing`. | Al restaurar una copia de la base. |
| `links`, `meta` | Usos por página y ajustes de la cola. | La cola. | — |

- **No hay "vistas previas" aparte**: lo que se ve en la página es la miniatura; lo grande (carrete, abrir,
  bajar, imprimir) es el original local o, si no está, el portero.
- **Los archivos de otros dispositivos nunca se guardan enteros** en el dispositivo: solo su miniatura y su fila.
  Lo que ocupa lugar es, casi todo, `blobs`.
- Las imágenes viejas `sdfile://` (Supabase, hasta 25 MB, en la base principal) quedan afuera de esta tanda.

## 2. Cómo se sabe que un archivo está en el Drive

Hoy: `markUploaded` pone `pending: 0` y `driveId` **solo después** de que la base confirma `files.drive_id`
(`confirmed()`, que lee `fetchMediaFiles`); el portero, a su vez, solo dice `linked: true` cuando la base se
enteró. O sea, `pending === 0 && driveId` ya es "confirmado". Para liberar se pide más, en este orden, y si
cualquier paso falla o no contesta, **no se libera** (se vuelve a probar otro día):

1. **En el dispositivo, en la misma transacción que borra** (`files` y `blobs`): el registro sigue con
   `pending: 0`, `driveId`, sin `blocked`, sin `uploadId`, sin `keep` (sección 5), y no es parte de una carpeta
   que se esté subiendo (P.9).
2. **La base** (`fetchMediaFiles`, de a muchos): `drive_id` igual al `driveId` del registro, y sin `purged_at` ni
   `drive_trashed_at` (lo pedido para la papelera de Drive se libera solo a mano: decisión 4).
3. **El portero:** un pase (`/pass`, que ya comprueba la marca `sdFile` del archivo en Drive) y un pedido de **un
   byte del medio del archivo** (`Range: bytes=N-N`): tiene que responder `206` con `Content-Range: …/<peso>` igual
   al del registro y **sin** `X-Portero-Cache` (la caché del arranque guarda las puntas de los videos; el medio
   siempre va a Drive). Así se sabe que Drive tiene hoy ese archivo, de ese peso. Un pedido por archivo.

El paso 1 se repite adentro de la transacción de borrado porque entre la comprobación y el borrado pudo pasar algo
(una restauración de la base vuelve todo a `pending: 1`).

## 3. Qué se libera y qué se queda

| | Después de liberar |
|---|---|
| La página | Igual: la miniatura (o la tarjeta del adjunto) sale de `thumbs` y del registro. |
| Carrete, abrir, bajar | Con red, por el portero (el mismo camino que un archivo de otro dispositivo). Sin red: la miniatura con un aviso nuevo, "La copia de este dispositivo se liberó: hace falta conexión". |
| Imprimir | Una foto liberada sale con su miniatura en vez del original achicado (`useOriginals` usa `localImage`). Por eso las fotos chicas no se liberan solas (decisión 3). |
| *Share* en el teléfono (`AttachmentSheet`) | Hoy solo con el original local. Después: el botón no aparece, o (entrega 2) la hoja lo baja mientras está abierta si pesa menos de 100 MB y lo ofrece. |
| Registro, usos, papelera | Igual. |
| Un video sin miniatura (el navegador no pudo abrirlo) | Queda el ícono, como lo ve cualquier otro dispositivo. |

## 4. Cuándo, sola

Un repaso **una vez por apertura** (después de la primera sincronización, con red, sin apuro, en la pestaña que
tiene la cola) y otro **cuando falta lugar**:

- **Reglas de siempre** (con el interruptor prendido, decisión 1): 100 MB o más, confirmado hace 3 días o más, y
  sin abrir en este dispositivo hace 14 días o más.
- **Con el navegador apretado** (`navigator.storage.estimate()`: quedan menos de 2 GB o menos del 20 % de la cuota):
  20 MB o más y confirmado hace 1 día o más, **del que hace más que no se abre al más reciente**, hasta volver a
  tener el 30 % libre. Si el interruptor está apagado, en vez de liberar se muestra un aviso con el botón.
- **Al agregar algo que no entra** (`checkRoom`, que hoy solo avisa y rechaza): el aviso dice cuánto se puede liberar
  ("Liberando copias de archivos ya subidos se recuperan 6,3 GB") con el botón; después de liberar, se vuelve a
  probar.
- **"Sin abrir":** un campo nuevo, `lastUsedAt`, que se anota cuando se usa el original (el carrete, abrir, bajar,
  compartir, imprimir); se escribe como mucho una vez por día por archivo. Sin el campo (registros de antes), vale
  `createdAt`.
- **Nunca solos:** lo marcado "Mantener en este dispositivo", lo que no pasa los tres pasos de la sección 2, las
  fotos de menos de 20 MB, lo que está en la papelera de Drive y lo de una carpeta que todavía se está subiendo.

## 5. A mano

- **"Espacio en este dispositivo"** (menú de la cuenta, en todos los dispositivos):
  - Arriba, lo del navegador: "La app usa 12,4 GB de 58 GB disponibles en este navegador" (`estimate()`; sin el
    dato, no se muestra).
  - Este workspace: **"Copias de archivos ya subidos: 9,8 GB (23 archivos) · Liberar"**, "Esperando subir: 1,1 GB (5
    archivos) · no se pueden liberar todavía" y "Miniaturas: 180 MB". Los números salen de sumar `size` de los
    registros con `blobs` presente (no del `estimate()`, que en Safari y Firefox tarda en bajar después de borrar).
  - La lista de las copias más grandes (nombre, peso, "abierto hace 3 días", la página donde está) con *Liberar* y
    *Mantener en este dispositivo* por fila; una carpeta de P.9 es una fila.
  - El interruptor "Liberar sola las copias grandes ya subidas", con las reglas en una línea.
  - Qué se pierde, en una línea: "Se siguen viendo; sin conexión, en este dispositivo solo la miniatura".
- **Por archivo:** en la hoja del adjunto y en el menú de la barra de la imagen, "Liberar la copia de este
  dispositivo" (si está y se puede) o "Guardar en este dispositivo" (si se liberó).
- **Confirmación:** liberar a mano pide confirmar con el total ("Liberar 9,8 GB. Los archivos siguen en el Drive").
  Si alguno no pasa la comprobación, se dice cuál y por qué ("todavía no está en Drive", "sin conexión").

## 6. Volver a tenerlo

- **Ver o bajar:** por el portero, sin hacer nada (el camino de hoy cuando `source().original` es `null`).
- **"Guardar en este dispositivo"** (para ver sin red, por ejemplo en un rodaje): baja el archivo entero con su pase
  (se reusa el de `carreteLoader`), comprueba el peso, lo guarda en `blobs` (con el mismo aviso de lugar) y pone
  `keep: true` y `freedAt: null`. Se puede cancelar.
- **Entrega 2:** lo mismo para archivos **de otros dispositivos** (hoy `source()` solo busca el original de los
  propios): hace falta que `source()` mire `blobs` también para `known`, y que esas copias entren en esta misma
  cuenta y en la liberación.

## 7. Cambios en la cola y en los caminos de abrir y bajar

- **`MediaRecord`** suma, opcionales: `freedAt` (cuándo se liberó), `lastUsedAt` y `keep`. Una versión vieja los
  conserva (todo se escribe con `{ ...registro, ...cambios }`).
- **`process()` sin original:** hoy, si falta `blobs[id]`, lo detiene con `originalMissing`. Con `freedAt`, y si el
  registro volvió a la cola (una restauración de la base lo pone en `pending: 1` y borra `driveId`), en vez de eso
  se le pregunta al portero **sin mandar bytes** (un `relink`: `POST /upload` con id, peso y día; el portero ya
  responde `done` si recuerda la subida, `rec.drive`, y le avisa a la base). Si en cambio abre una subida nueva, la
  app no la usa, la deja vencer y detiene el archivo con un aviso claro ("La copia de este dispositivo se liberó y
  el portero no recuerda este archivo: está en el Drive del dueño; avisale"). **Mejora del portero** (recomendada
  antes de liberar solo): antes de abrir una subida, buscar en Drive un archivo con la marca
  `appProperties.sdFile = <id>` y, si está, usarlo (así la restauración anda aunque el portero haya perdido su
  registro).
- **`resetForRestore` y `clearBlocked`** conservan `freedAt`.
- **`remember(id, …, local)`** hoy pone `local: true` para todo archivo propio: pasa a mirar si el original está.
  `fileInfo().local` es lo que usan la hoja y la barra para decidir.
- **`source()`** suma `freed: true` al `MediaSource`; `carreteLoader.ts` y `attachmentOpen.ts` lo usan solo para el
  texto del aviso sin red. `openTarget`, `downloadTarget`, `originalFor` y `localImage` no cambian: ya caen al pase
  cuando no hay original.
- **Una sola pestaña libera:** la que tiene la cola (la misma que sube); dos pestañas no se pisan.
- **Carpetas (P.9):** sus archivos son registros como los demás; la carpeta se libera entera cuando todos sus
  archivos están confirmados.

## 8. Varias cuentas y workspaces en el mismo dispositivo

- La app de un mismo origen (una dirección) comparte **una sola cuota** entre todas sus bases: cada cuenta de cada
  workspace tiene su `…:media`. El `estimate()` es de todas juntas.
- **Solo se libera lo del workspace y la cuenta abiertos**: comprobar que algo está en Drive pide la sesión y el
  portero de ese workspace.
- El diálogo muestra "Otros workspaces o cuentas en este dispositivo: unos 4,1 GB" (la diferencia con el
  `estimate()`, aproximada) con "abrilos para liberar lo suyo". Si el apuro viene de otro workspace, el aviso lo
  dice en vez de liberar de más en este.
- Sacar un workspace del dispositivo (`WorkspaceMenu.tsx`) sigue igual: borra sus bases enteras, con el aviso si
  queda algo sin subir.

## 9. Base de datos, portero y versión mínima

- **Base:** sin migración. Se usa `files.drive_id`, `purged_at` y `drive_trashed_at` que ya existen.
- **Portero:** alcanza con el publicado para liberar y volver a ver. La búsqueda por la marca (sección 7) es una
  mejora aparte, que conviene publicar antes de prender lo automático.
- **Sin subir `min_app_version`:** una versión vieja con un registro liberado muestra la miniatura y abre por el
  portero; si una restauración lo vuelve a la cola, lo detiene con "falta el original" a la vista (no pierde nada:
  está en Drive).

## Riesgos

- **Liberar algo que no estaba bien en Drive.** Lo evitan los tres pasos de la sección 2; lo que queda es que el
  dueño borre a mano el archivo en su Drive después (igual se perdería para todos, no solo acá).
- **Restauración de la base con copias liberadas:** depende de que el portero recuerde la subida o la encuentre por
  la marca. Sin la mejora del portero, puede quedar un archivo detenido que hay que resolver a mano.
- **Safari (iPhone):** puede borrar todo lo de un sitio que no se abrió en 7 días si la app no está instalada ni
  tiene `persist()`; eso incluye lo que todavía no se subió. Liberar baja el riesgo de que el navegador borre por
  falta de lugar, no el de los 7 días.
- **El número tarda en bajar** en algunos navegadores (compactan después): el diálogo usa la suma propia.
- **Rodajes sin red:** alguien que cuenta con ver un video sin red en el set y lo encuentra liberado. Por eso el
  "sin abrir hace 14 días", el "Mantener" y el aviso claro.
- **Imprimir:** una foto grande liberada imprime con la miniatura.

## Entregas y pruebas

1. **Entrega 1:** los campos nuevos, `lastUsedAt`, la comprobación de tres pasos, liberar a mano (diálogo y por
   archivo), `process()` sin original con el `relink`, avisos sin red, `fileInfo().local`, textos y docs. Lo
   automático, apagado.
2. **Entrega 1b, portero:** buscar por la marca antes de abrir una subida.
3. **Entrega 2:** lo automático (reglas y apuro), ofrecer liberar al agregar algo que no entra, "Guardar en este
   dispositivo" y compartir desde el teléfono sin copia local.
4. **Entrega 3 (opcional):** guardar sin red archivos de otros dispositivos.

Pruebas de unidad (`queue.test.ts` con el servidor y el portero en memoria): no se libera con `pending: 1`,
`blocked`, `uploadId`, sin `driveId`, con la base diciendo otro `drive_id` o `purged_at`, con el portero respondiendo
404, 409, otro peso o `X-Portero-Cache`, ni sin red; una restauración entre la comprobación y el borrado no borra;
después de liberar, `source()` sin original, `fileInfo().local` en `false`, la página muestra la miniatura, el
carrete y abrir usan el pase y, sin red, el aviso; `resetForRestore` con una copia liberada termina en `done` sin
mandar bytes (portero que recuerda) o detenida con el aviso (portero que no); `keep` nunca se libera; las reglas de
tiempo y peso, y el apuro con un `estimate()` simulado, del menos usado al más; `lastUsedAt` se escribe una vez por
día; solo se toca la base del workspace abierto. Portero (`core.test.ts`): la búsqueda por la marca. jsdom: el
diálogo con los números, la confirmación, el interruptor, liberar y volver a guardar uno. A mano: en el iPhone, subir
un video de 2 GB, esperar la confirmación, liberar, ver que baja el número, reproducirlo por el portero, y sin red
ver la miniatura con el aviso; lo mismo en Chrome de computadora y en Safari de Mac.

## Decisiones (a confirmar por Lega)

1. Liberar sola, **prendido por defecto**, con reglas conservadoras: 100 MB o más, subido hace 3 días o más, sin
   abrir acá hace 14 días o más. (La alternativa: apagado por defecto, solo a mano y con el aviso cuando falta lugar.)
2. Con el navegador apretado (menos de 2 GB o del 20 % libre), reglas más amplias (20 MB, 1 día), del menos usado al
   más.
3. Las fotos de menos de 20 MB no se liberan solas (imprimir y ver sin red).
4. Lo que está en la papelera de Drive no se libera solo (puede ser la última copia fuera de esa papelera); a mano
   sí, con aviso.
5. "Mantener en este dispositivo" por archivo.
6. Comprobar con el portero (un pedido de un byte por archivo) antes de liberar.
7. Al agregar algo que no entra, ofrecer liberar en el mismo aviso.
8. "Guardar en este dispositivo" para archivos de otros dispositivos, más adelante.
