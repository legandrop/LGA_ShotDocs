# Editar a la vez: qué puede pasar y qué se arregló

Estado: **hecho en v0.052** (rama `lega/sync-arreglos`). Sale de una investigación con el editor real
(BlockNote 0.55, y-prosemirror 1.3.7, Yjs 13.6) que encontró pérdidas de texto reales cuando dos personas (o
dos dispositivos de la misma persona) editan la misma página a la vez. Complementa `Doc_Sincronizacion.md`
("Contenido de las páginas", punto 5), que explica cómo se guarda y se sube cada cambio.

## En corto

- **Escribir a la vez en el mismo renglón, o en renglones distintos, funciona:** las letras de los dos quedan.
  Eso ya andaba y sigue igual.
- **Se arreglaron cuatro pérdidas** que no tenían por qué pasar (ver "Qué se arregló"). La prueba al azar por el
  camino real de la app (dos dispositivos escribiendo en una página nueva, subiendo y bajando en cualquier
  orden) perdía texto en **26 de cada 100** corridas; ahora en **0 de 500**.
- **Queda una regla de la librería que no se puede arreglar desde la app:** si una persona le cambia el tipo a
  un bloque, lo sangra, lo mueve o lo junta con otro, y **al mismo tiempo** otra escribe en ESE bloque, lo que
  escribió la segunda se puede perder (ver la tabla). Es raro (tiene que ser el mismo bloque, en los mismos
  segundos, o con uno de los dos sin red) y se ve enseguida.
- **Desde v0.074, los renglones con fotos en línea** (nada las crea todavía) tienen su parte del parche ("El
  texto de los huecos") y su tabla, medida: escribir los dos en el mismo hueco no pierde nada; borrar o mover
  una foto, o partir el renglón, mientras el otro escribe pegado a ella sí puede.

## Lo que todavía puede pasar (y por qué)

El editor guarda cada página como un árbol de bloques en Yjs. y-prosemirror 1.x, la pieza que traduce entre el
editor y Yjs, hace ciertos cambios **borrando el bloque y creando uno nuevo** con el mismo texto, en vez de
modificarlo: cambiar el tipo (párrafo → título, lista…), sangrar o quitar la sangría, mover arriba o abajo, y
juntar dos bloques (Backspace al principio de un renglón). Si otra persona estaba escribiendo en ese bloque sin
haber visto el cambio, sus letras van al bloque viejo, que ya está borrado, y se pierden con él.

Qué pasa, en palabras de usuario (A y B cambian la misma página a la vez, sin verse; cada caso tiene su prueba en
`src/ui/collabSemantics.test.ts`):

| Lo que hace A | Lo que hace B a la vez | Resultado |
|---|---|---|
| Escribe en un renglón | Escribe en el mismo renglón | Quedan los dos textos. |
| Escribe en un renglón | Le cambia el color | Quedan el texto y el color. |
| Escribe en un renglón | Lo divide con Enter | Queda todo, repartido en los dos renglones. |
| Divide un renglón con Enter | Escribe al final | Queda todo. |
| Cambia el nivel de un título | Escribe en el título | Queda todo. |
| Escribe en un renglón | Lo borra | Se borra, con lo que escribió A (B quiso borrarlo). |
| Escribe en un renglón | Reemplaza todo su texto | Queda lo de A y lo nuevo de B; el texto viejo no. |
| Escribe en un renglón | Le cambia el tipo, lo sangra o lo junta con el de arriba | **Se pierde lo que escribió A**; el cambio de B queda. |
| Escribe en un renglón | Lo mueve arriba | Queda el texto de A, pero puede aparecer en el renglón vecino. |
| Borra de la mitad de un renglón a la mitad del siguiente | Escribe al final del segundo | **Se pierde lo de B** (el segundo renglón se juntó con el primero). |
| Sangra un renglón | Sangra, junta o mueve el renglón de abajo | **Se puede perder el renglón de abajo** (B lo movió adentro de un bloque que A recreó). |
| Le cambia el tipo a un renglón | Le cambia el tipo al mismo renglón | Queda uno de los dos tipos, con su texto (antes se borraba el renglón entero). |
| Sangra un renglón | Sangra el mismo renglón | Queda sangrado una vez (si el de arriba ya tenía hijos, puede quedar dos veces; nunca se pierde). |

**En un renglón con fotos en línea** (desde v0.074; nada las crea todavía, ver `Doc_Fotos_En_Linea.md`). Las
fotos son elementos entre los textos del renglón, y y-prosemirror borra y vuelve a crear lo que queda a la
derecha de un elemento que se saca, se mueve o se inserta. Medido con 300 agendas al azar por caso
(`src/ui/collabPhotos*.test.ts`; el número es la cantidad de agendas con algo de eso, en agendas hechas para
chocar: todos los pasos caen en el mismo renglón):

| Lo que hace A | Lo que hace B a la vez | Resultado |
|---|---|---|
| Escribe en un hueco (antes, entre o después de fotos) | Escribe en el mismo hueco | Quedan los dos textos (0 de 300). |
| Escribe en el renglón | Cambia el ancho de una foto, o agrega fotos en los huecos | Queda todo (0 de 300). |
| Escribe al final del renglón | Pone una foto en el medio del texto | Queda todo, pero lo de A aparece antes de la foto (0 de 300 perdido). |
| Escribe en un hueco vacío pegado a una foto | Borra esa foto | **Se pierde lo que escribió A** (205 de 300 en una fila de tres fotos; 206 con texto entre las fotos). |
| Escribe pegado a una foto | Mueve una foto del renglón | **Se puede perder lo de A** (74 de 300 en una fila de tres; 29 con texto entre las fotos). |
| Escribe pegado a una foto | Aprieta Enter pegado a una foto (parte el renglón) | **Se puede perder lo de A** si escribía en la parte que pasó al renglón nuevo (172 de 300). |
| Borra una foto | Borra otra foto del mismo renglón | El texto que había entre ellas **se puede perder (53 de 300) o quedar dos veces (139)**. |
| Une el renglón con el de arriba, o le cambia el tipo | Pega fotos en ese renglón | **Se pierden las fotos que pegó B** (227 y 261 de 300), como el texto en la tabla de arriba. |
| Une el renglón con el de arriba | Escribe pegado a sus fotos | **Se pierde lo que escribió B** (231 de 300), como en la tabla de arriba. |

Dos cosas más, sin pérdida de texto:

- **Ids repetidos.** Si por una fusión quedan dos bloques con el mismo id (por ejemplo, los dos sangraron el mismo
  renglón debajo de uno que ya tenía hijos), el editor les cambia el id cuando los dibuja y lo guarda con la
  próxima edición. Los comentarios anclados a ese bloque pueden quedar sueltos (se ven en el panel, sin su
  renglón) y el estado de colapsado de ese título se puede perder. Pasa muy poco.
- **Enter con una selección que empieza adentro de un bloque con sangría y termina afuera** tira un error de
  BlockNote y no hace nada. No toca el documento; no se arregló (es de BlockNote y no pierde nada).

Y una que sí puede perder texto, mientras queden páginas de antes: **los párrafos vacíos hechos con v0.053 o
antes** (cualquiera, no solo el primero de una página) no tienen texto adentro. Siguen expuestos al caso 2 de
abajo (dos personas escribiendo a la vez en ese mismo párrafo vacío) hasta que alguien escribe en él; desde ahí
ya tiene su texto y queda como los nuevos. Los párrafos vacíos que se crean desde v0.052 (Enter, un tipo nuevo,
una página nueva) ya nacen con su texto.

Y otra que ya pasaba y se midió en v0.074: **dos personas que escriben a la vez en el hueco entre dos saltos de
línea (Shift+Enter), o después del último**, donde no hay texto. Cada una crea su texto y después se juntan mal:
2 agendas con texto perdido y 1 con texto duplicado de 300 con saltos en el medio del párrafo; 4 y 12 con saltos
al principio y al final. Es lo mismo que se arregló para las fotos con el texto de los huecos; para los saltos
no se tocó, porque cambia cómo se guardan párrafos que las versiones de hoy sí abren (ver "El texto de los
huecos").

## Qué se arregló

1. **El editor que se quedaba con lo de antes y deshacía los cambios de los demás.** Con un bloque elegido
   entero (una foto tocada, o un bloque elegido con el menú de al lado), un cambio de otro que borrara, moviera o
   cambiara ese bloque hacía que y-prosemirror tirara un error al querer volver a elegir el bloque
   (`restoreRelativeSelection` elegía un bloque en una posición donde ya no había nada). El cambio quedaba en el
   documento pero el editor seguía mostrando lo de antes, y **con la próxima tecla escribía su versión vieja
   encima y deshacía el cambio del otro para todos**. También hacía que deshacer pareciera no andar. Arreglado
   con un parche a y-prosemirror (ver "Los parches").
2. **Dos personas escribiendo en el mismo párrafo vacío.** Un párrafo vacío no tenía texto adentro (ni vacío):
   cada dispositivo, al escribir, creaba su propio texto, y después y-prosemirror los juntaba copiando uno en el
   otro y borrando el segundo; lo que se escribía en el borrado mientras tanto se perdía (o quedaba dos veces).
   Arreglado con el otro parche: un párrafo vacío lleva un texto vacío, y los dos escriben en el mismo. Vale
   para los párrafos vacíos que se crean desde v0.052; los de antes, ver arriba.
3. **La primera línea de cada página nueva.** Las páginas nuevas arrancan con la "semilla" (`structure.ts`): un
   párrafo vacío que todos los dispositivos crean igual. Era justo el caso 2: toda página nueva abierta en dos
   dispositivos estaba expuesta. Ahora la semilla lleva el texto vacío, creado igual en todos los dispositivos
   (ver "La semilla").
4. **Dos cambios de estructura del mismo bloque a la vez.** Si los dos le cambian el tipo al mismo renglón (el
   bloque queda con dos contenidos) o los dos sangran el mismo renglón (el de arriba queda con dos grupos de
   hijos), el bloque queda de una forma que el editor no acepta, y y-prosemirror **lo borraba entero, con sus
   hijos**, y ese borrado llegaba a todos. Ahora la reparación de estructura lo arregla antes de que el editor lo
   vea (ver "La reparación").
5. **Por si algo igual falla al dibujar.** Si el editor tira un error al mostrar un cambio que llegó
   (`docs.ts`, `applyToLive`), la bajada ya no se corta: el cambio está guardado, y la página vuelve a dibujar el
   editor entero desde el documento en el momento, antes de la próxima tecla (`subscribeRenderFailed`,
   `src/ui/editorRecovery.ts`), y deja un cursor (no un tramo elegido, que después del cambio podría cubrir otro
   texto). Si ni eso anda, el editor queda en solo lectura y se vuelve a montar. Así un editor viejo nunca
   escribe encima. Solo se trata así un error **al dibujar**: si falla la reparación o el cambio mismo, la
   bajada falla (se ve en el estado de la sincronización), lo bajado queda guardado, y el documento abierto se
   marca para volver a armarse desde lo guardado (la página lo vuelve a abrir).

## Los parches de y-prosemirror

Están en `patches/y-prosemirror+1.3.7.patch` y los aplica `patch-package` al instalar (`postinstall` en
`package.json`), tanto en la máquina de cada uno como en Cloudflare (el build corre `npm ci`, que corre el
`postinstall`). Tocan `src/plugins/sync-plugin.js` (lo que usan Vite y las pruebas) y `dist/y-prosemirror.cjs`
(por si algo lo pide con `require`). Cada parte lleva la marca `LGA-SHOTDOCS-PATCH`.

- **`restoreRelativeSelection`**: vuelve a elegir un bloque entero solo si es **el mismo** bloque: que siga
  estando (el elemento de Yjs al que apuntaba la selección no se borró; si se borró, Yjs apunta al siguiente, o
  sea a otro bloque) y que tenga el mismo id (y-prosemirror reescribe bloques por posición, así que el mismo
  elemento puede tener ahora otro bloque). Si no, pone un cursor en el texto más cercano (si no queda ningún
  texto en la página, por ejemplo solo una foto, queda elegida esa). Usa solo posiciones que existen en el
  documento y nunca tira el error: si algo falla, deja un cursor.
- **`normalizePNodeContent`**: un bloque de texto vacío se representa con un texto vacío (`[[]]`), no con nada.
  Así el editor crea un texto vacío en cada párrafo vacío nuevo (Enter, un tipo nuevo), y lo compara bien con
  uno que ya lo tiene.
- **`normalizePNodeContent`, el texto de los huecos (v0.074)**: alrededor de un elemento en línea que lo pide
  (`needsGapText`: los que tienen `lgaGapText: true` en su esquema, hoy solo la foto en línea), donde no hay
  texto va un texto vacío. Ver "El texto de los huecos".

**Si los parches faltan, la app no se construye ni corren las pruebas**: `vite.config.ts`
(`assertYProsemirrorPatched`) revisa las marcas en los dos archivos (si falta un archivo, también corta) y corta con un mensaje (pasa si se instaló con
`--ignore-scripts`, o si se actualizó y-prosemirror y el parche no se volvió a hacer). `y-prosemirror` quedó
fijo en `1.3.7` en `package.json` para que una actualización sea a propósito. Desde v0.074 también busca la
parte de los huecos, y una prueba (`inlinePhoto.test.ts`) compara el nombre de la marca del nodo con el que lee
el parche.

### El texto de los huecos (v0.074)

Un renglón con fotos en línea se guarda como elementos hermanos: texto, foto, texto. Donde no hay texto (antes
de la primera foto, entre dos fotos, después de la última) y-prosemirror no guardaba nada, y cada persona que
escribía ahí creaba su propio texto; después los juntaba copiando uno en el otro y borrando el segundo (el caso
2 de "Qué se arregló", en otro lugar). Ahora en cada hueco hay un texto vacío y los dos escriben en el mismo:
`"" [foto] "" [foto] ""`.

- **A quién le toca.** Solo a los elementos que lo piden con `lgaGapText: true` en su esquema: la foto en línea
  (`src/ui/inlinePhoto.ts`, `extendNodeSchema`). Un salto de línea no lo pide: `[salto] [salto]` se guarda como
  siempre, y al lado de una foto el texto vacío va solo del lado de la foto (`[salto] "" [foto] ""`). Agregar
  una foto a un renglón que ya tiene texto o saltos no vuelve a crear nada de lo que había.
- **Por qué no los saltos de línea.** Ya existen en párrafos de los usuarios, y las versiones de hoy los abren.
  Una versión sin esta parte del parche que edita un párrafo guardado con textos vacíos junto a los saltos lo
  reescribe entero (borra los textos vacíos y vuelve a crear los saltos y el texto de la derecha), y con eso
  pierde lo que otro escriba a la vez. Con las fotos no pasa: la versión anterior no abre una página que las
  tenga (`unknownContent.ts`).
- **Versiones mezcladas.** Sin fotos, esta versión y la anterior escriben exactamente igual (la parte nueva no
  se ejecuta si el párrafo no tiene un elemento marcado): las mismas agendas con saltos de línea dan lo mismo
  con dos editores de esta versión, dos de la anterior o uno de cada una (`collabPhotosVersions.test.ts`). Y
  abrir una página no escribe nada (`inlinePhoto.test.ts`).
- **Las dos formas no se mezclan.** Un editor con el texto de los huecos y otro sin él en el mismo renglón con
  fotos no entran en un ida y vuelta (cada uno reescribe solo el párrafo que él mismo edita) y terminan
  iguales, pero pierden texto en 173 de 300 agendas (`collabPhotosNoGaps.test.ts`). No pasa en la app: toda
  versión que conoce la foto en línea tiene el parche entero.
- **Lo que arregla y lo que empeora** (300 agendas por caso; sin el texto de los huecos → con él): escribir los
  dos en el mismo hueco, de 21 perdido y 52 duplicado a 0 (`[foto][foto]`) y de 20 duplicado a 0 (con texto
  entre las fotos); mover una foto mientras el otro escribe pegado a ella, de 87 a 74 y de 166 a 29. **Empeora**
  borrar una foto mientras el otro escribe en un hueco vacío pegado a ella (de 40 a 205 en una fila de tres; de
  167 a 206 con texto entre las fotos) y Enter (de 139 a 172): antes, quien escribía en un hueco vacío creaba su
  propio texto, que sobrevivía a que el otro borrara la foto; ahora comparten el texto del hueco, y al borrar la
  foto y-prosemirror borra ese texto con lo que el otro escribió. Con todo mezclado dan parecido (103 contra 101
  con texto perdido). Queda para decidir antes de publicar la versión que crea fotos (`Doc_Fotos_En_Linea.md`,
  "Cómo quedó"); mientras tanto, sacarlo es quitar la marca del nodo.

### Al actualizar BlockNote o y-prosemirror

1. Cambiar la versión en `package.json` y correr `npm install`. Si `patch-package` dice que el parche no entra:
   mirar si la versión nueva ya trae el arreglo (buscar `restoreRelativeSelection` y `normalizePNodeContent` en
   `node_modules/y-prosemirror/src/plugins/sync-plugin.js`). Si no, aplicar los mismos cambios a mano en los dos
   archivos y regenerar con `npx patch-package y-prosemirror` (borrar el parche viejo). Si ya lo trae, borrar el
   parche y sacar la revisión de `vite.config.ts`. El texto de los huecos es de la app (ninguna versión de la
   librería lo va a traer): se vuelve a aplicar siempre. `patch-package` baja la librería original para comparar;
   sin red, se arma igual con `git diff` entre los dos archivos originales (se recuperan aplicando el parche al
   revés) y los cambiados, y se comprueba con `patch-package` sobre una copia.
2. Correr las pruebas de este documento: `npx vitest run src/ui/collab src/ui/inlinePhoto.test.ts
   src/sync/structure.test.ts`, y la grande al azar: `COLLAB_SEEDS=200 npx vitest run src/ui/collabRandom.test.ts`.
   Tienen que dar 0 pérdidas (las de `collabPhotosLimits` y `collabPhotosNoGaps` tienen que dar su número).
3. Si `collabSemantics.test.ts` falla, cambió cómo se fusionan dos cambios del mismo bloque: puede ser para bien
   (algo que se perdía ahora queda). Revisar el caso, actualizar la tabla de arriba y la prueba.
4. Correr la prueba de punta a punta `e2e.mjs` (dos dispositivos que se fusionan).

### A futuro: `@blocknote/core/y` (y-prosemirror 2, Yjs 14)

BlockNote ya trae una integración nueva (`@blocknote/core/y`, sobre y-prosemirror 2 y Yjs 14) que compara
bloques por su identidad en vez de por posición: por ejemplo, un cambio de tipo reemplaza el bloque entero como
un hermano, sin dejar dos contenidos en el mismo bloque. Podría resolver parte de la tabla de arriba. Cambia el
formato de lo guardado (Yjs 14), así que no es una actualización común: hay que evaluar la migración de las
páginas guardadas, la convivencia con versiones viejas (`min_app_version`) y volver a pasar todas estas pruebas.
Está en el roadmap (B.10).

## La semilla (v0.052)

La raíz de la semilla es **la misma de siempre** (versión 1, v0.008), byte por byte: mismo autor de Yjs (sale del
id de la página) y mismo contenido. Encima lleva una **capa de texto**: el texto vacío adentro del párrafo, escrito
con **otro autor fijo** que también sale del id de la página (`seedTextClientId`, `SEED_TEXT_VERSION = 1`). Las
dos partes se aplican juntas, en una sola transacción, y se guardan con la primera edición como antes.

Por qué así y no con una semilla "versión 2" entera:

- **Dos versiones nuevas a la vez:** crean la misma raíz y la misma capa (mismos autores, mismos números), así que
  Yjs las toma como un solo cambio. Los dos escriben en el mismo texto.
- **Una versión vieja y una nueva a la vez:** comparten la raíz (con una semilla 2 entera habría dos raíces, y la
  reparación de raíces copia bloques y puede duplicar o perder lo que se escribe mientras tanto). Si la vieja
  además escribe en el párrafo antes de ver la capa, el párrafo queda con dos textos: nada se duplica ni se
  pierde en ese momento, y queda la misma exposición de antes (caso 2) solo mientras convivan versiones.
- **Una página sembrada por una versión vieja** y abierta con la nueva: no está vacía, así que no se vuelve a
  sembrar y no cambia nada. Si su primer párrafo sigue vacío sin texto, queda expuesto al caso 2 hasta que
  alguien escriba en él (entonces ya tiene texto). Es poco probable: la semilla se guarda recién con la primera
  edición, que casi siempre es escribir en ese párrafo.
- **No hace falta subir `min_app_version` por la semilla**: una versión vieja entiende todo (un texto vacío en un
  párrafo es normal). Ver abajo por qué igual conviene.

`src/sync/structure.test.ts` fija que la raíz es byte por byte la de la versión 1 y prueba cada caso.

## La reparación (v0.052)

`normalizeStructure` (`structure.ts`) corre al abrir una página y con cada cambio que llega, en la misma
transacción que lo aplica (`docs.ts`, `applyToLive`): el editor nunca ve la estructura rota. Hace lo de antes
(juntar raíces sobrantes, `mergeRootGroups`) y además arregla los bloques que el editor no aceptaría:

- **Dos grupos de hijos en un bloque:** quedan en el primero; un hijo del segundo que ya está igual en el primero
  (el mismo bloque sangrado por los dos) no se copia.
- **Dos contenidos en un bloque:** queda el primero. Si el otro tiene el mismo texto (los dos cambiaron el tipo),
  se descarta: gana uno de los dos tipos. Si tiene otro texto, pasa a ser un bloque nuevo justo debajo.
- **Un grupo de hijos antes del contenido:** se mueve el contenido al principio (se copia y se borra el
  original), no el grupo: así lo que otro escriba a la vez en los hijos no se pierde, y si dos dispositivos
  reparan a la vez quedan dos copias del contenido con el mismo texto, que la vuelta siguiente junta en una.
- **Un texto suelto** adentro de un bloque o en una lista de bloques (el editor borraría el bloque o la lista
  entera): pasa a un bloque propio; si está vacío, se saca.
- Un bloque con hijos y sin contenido recibe un párrafo vacío; la raíz vacía recibe un párrafo vacío.
- Solo dice que reparó (y solo escribe) si de verdad cambió algo: un documento sano no se toca.

"El primero" es el primero en el orden de Yjs, que es el mismo en todos los dispositivos: dos dispositivos que
reparan a la vez descartan lo mismo y terminan iguales. Lo que se copia (Yjs no puede mover, solo copiar y
borrar) puede quedar dos veces si reparan a la vez: se prefiere duplicar a perder. Y lo que otro escriba en el
original justo mientras se copia puede no llegar a la copia; aun así es mucho mejor que el editor borre el bloque
entero.

**Lo que no hace, a propósito:** juntar dos bloques hermanos idénticos con el mismo id. Se probó, y la prueba al
azar mostró que el editor puede dejar dos bloques vacíos así por un momento mientras llegan cambios de otro;
borrar uno perdía lo que se escribía en él.

## Las pruebas

| Archivo | Qué prueba |
|---|---|
| `src/ui/collabRegression.test.ts` | Cada pérdida arreglada, con el editor real; todas fallaban antes: el bloque elegido entero contra cada cambio del otro (APP1 por el camino de la app, R1–R4, y 150 casos al azar donde la selección nunca pasa a otro bloque; `COLLAB_SELECTIONS` para más), deshacer con un bloque elegido (R2), un lote bajado como lo baja la app (R3), agendas al azar de dos dispositivos escribiendo en un párrafo vacío (en la semilla y en uno hecho por el editor), los dos cambiando el tipo o sangrando el mismo bloque (S8, S9b, también por PageDocs), el editor que se vuelve a dibujar si igual falla (con un cursor) y una reparación que falla (no se traga). |
| `src/ui/collabRandom.test.ts` | Dos dispositivos escribiendo a la vez en una página nueva por el camino real de la app (PageDocs, IndexedDB, servidor de prueba, respuestas de subida perdidas): ninguna marca falta ni queda dos veces. Antes: 17 a 26 de cada 100 con pérdidas; ahora 0 de 500. La segunda prueba suma cambios de estructura (de la auditoría) y exige que terminen iguales al servidor y cada editor al día. En CI, 24 semillas fijas; `COLLAB_SEEDS=100` (o más) para la grande. |
| `src/ui/collabFuzz.test.ts` | De la auditoría: dos editores con cambios de todo tipo al azar (también elegir bloques enteros), con la reparación: sin errores, sin ida y vuelta de reparaciones, iguales y cada editor al día. En CI, 40 corridas; `COLLAB_FUZZ=300` para la grande. |
| `src/ui/collabSemantics.test.ts` | La tabla de "Lo que todavía puede pasar" (escenas S1–S13 y C1–C9 de la investigación), en los dos modos de entrega. Documenta lo inherente: falla si cambia. |
| `src/sync/structure.test.ts` | La semilla (byte por byte la raíz de siempre, la capa de texto, versión vieja y nueva a la vez) y cada caso de la reparación, también dos dispositivos reparando a la vez (y un tercero escribiendo en los hijos) y textos sueltos. |
| `src/ui/collabHarness.ts` | Las ayudas de esas pruebas (no es una prueba). `connect` entrega lo de cada lado **en orden**, como el servidor. |
| `src/ui/collabPhotos.test.ts` | Fotos en línea (v0.074), lo que tiene que dar 0 en 300 agendas al azar por caso: los dos escriben en los huecos de `[foto][foto]` y de `"abc"[foto]"def"[foto]`, uno escribe y el otro cambia anchos o agrega fotos, los dos hacen todo eso, y el control solo con texto. `COLLAB_PHOTO_SCHEDULES` cambia la cantidad. |
| `src/ui/collabPhotosLimits.test.ts` | La tabla de los renglones con fotos: borrar, mover, Enter, poner una foto en el medio de un texto, unir y cambiar el tipo, y de todo un poco. Documenta el número de hoy de cada caso (300 agendas): falla si cambia. Siempre exige que terminen iguales y que nada quede yendo y viniendo. |
| `src/ui/collabPhotosNoGaps.test.ts` | Los mismos casos sin el texto de los huecos, para comparar (qué arregla el parche y qué empeora), y las dos formas mezcladas en el mismo renglón. |
| `src/ui/collabPhotosVersions.test.ts` | Saltos de línea con la versión anterior y esta: las mismas agendas dan lo mismo con cualquier combinación de las dos. |
| `src/ui/inlinePhoto.test.ts` | El nodo, cómo queda guardado cada caso (con y sin saltos de línea), que abrir una página no escribe nada, la versión anterior (no la abre; si la abriera, borraría las fotos) y deshacer. |
| `src/ui/photoHarness.ts` | Las ayudas de las pruebas de fotos (no es una prueba): las agendas, los casos con sus números, el esquema de la versión anterior y el de la foto sin la marca de los huecos. |

**Una recomendación para las pruebas de colapsar** (`collapseProperty.test.ts`, en la rama `lega/colapsar`):
la comparación "A y B coinciden" conviene hacerla sobre los documentos de Yjs (vector de estado y XML, como
`sameDocs` de `collabHarness.ts`) y, si se comparan los documentos del editor, sin los ids de los bloques (el
editor les cambia el id a los repetidos, ver arriba). Y la entrega de cambios entre A y B conviene hacerla en
orden por cada lado (como `connect`): entregar un cambio en el medio de otra entrega arma estados que la app
nunca ve (por ejemplo, un borrado de una reparación que llega antes que lo que la reparación dejó, y el editor
del otro lado borra el bloque que quedó vacío). Con este arreglo, lo que esa prueba cuenta aparte como
"`restoreRelativeSelection`" debería desaparecer.

## Versiones viejas y `min_app_version`

Nada de esto cambia el formato: una versión vieja lee todo. Pero una versión vieja **no tiene los arreglos**:
sigue pudiendo deshacer cambios de otros con un editor viejo (caso 1) y borrar el bloque entero en el caso 4, y
esos borrados le llegan a todos. **`min_app_version` sube a 0.052** al publicar esta
versión (hoy está en 0.045): una versión vieja deja de poder subir contenido hasta actualizarse. No hace falta
para no perder datos con la versión nueva; es para cerrar la puerta a las viejas.

**El texto de los huecos (v0.074) sí cambia lo guardado**, pero solo en los renglones con fotos en línea, que
una versión anterior no abre (`unknownContent.ts`, desde v0.021). Nada crea fotos en línea hasta que
`min_app_version` suba a la versión que las conoce (el orden está en `Doc_Fotos_En_Linea.md`, "Versiones
viejas"); esta entrega no lo sube.

## Huecos estables: en curso (pausado)

Trabajo a medias en la rama `lega/fotos-en-linea-1` (commit `feaf66f`), para que borrar, mover o partir junto a
una foto no pierda lo que otro escribe pegado a ella. **Sin medir, sin auditar y con pruebas que hoy fallan.**

- **Qué se analizó.** La pérdida viene de que y-prosemirror borra un `Y.XmlText` entero al juntar los dos textos
  vecinos de una foto borrada. Reescribir letras adentro de un texto no pierde lo que otro escribe; borrar el
  texto sí. Además, al dibujar, la librería junta dos textos seguidos si el segundo lo creó ese dispositivo (#160).
- **Enfoque elegido.** En un bloque con fotos, ningún texto se borra ni se recrea: borrar una foto saca solo su
  elemento y deja los textos seguidos. El contenido del renglón se compara como una secuencia de letras y fotos
  (prefijo y sufijo comunes; en el medio, la secuencia de cambios más corta, con tope de 512) y cada cambio va
  al texto que tiene esa posición. **Regla del borde:** lo que se escribe donde se tocan dos textos va al final
  del de la izquierda. Una foto puesta en el medio de un texto deja la parte izquierda donde está y crea un
  texto nuevo a la derecha. Un cambio de ancho actualiza la foto sin recrearla.
- **La marca.** Los textos de un bloque con fotos llevan el atributo `lgaGapText` (en el `Y.XmlText`), para que
  el bloque siga así cuando se borra su última foto. Sin foto y sin texto marcado, el bloque sigue el código de
  siempre: por eso dos textos seguidos junto a un salto de línea se siguen juntando como hoy.
- **Hecho.** En `src/plugins/sync-plugin.js` (está en el parche): la lectura sin juntar textos, la igualdad por
  contenido (`equalStableContent`), la escritura (`updateStableGapsChildren`) y la marca al crear un bloque.
  Con 60 agendas, `collabPhotos.test.ts` e `inlinePhoto.test.ts` pasan.
- **Falta.** Llevar lo mismo a `dist/y-prosemirror.cjs` y regenerar el parche; la guarda de `vite.config.ts`;
  medir las 300 agendas de cada caso y volver a fijar `limits` en `photoHarness.ts` (`collabPhotosLimits` y
  `collabPhotosNoGaps` hoy fallan, y `brokenGaps` todavía exige que no haya dos textos seguidos); las pruebas
  nuevas (ida y vuelta, un solo editor al azar contra lo reconstruido desde Yjs, los dos archivos de la
  librería dando lo mismo); confirmar que el control de texto y los saltos de línea dan lo de hoy; la suite,
  `tsc` y el build; actualizar las tablas de este documento y de `Doc_Fotos_En_Linea.md`, y el changelog.
- **Para revisar.** La reparación (`structure.ts`) copia con `clone()`, que no lleva la marca: un bloque
  reparado sin fotos vuelve al código de siempre. Y los comentarios nuevos del parche están en inglés, como el
  resto de ese archivo.
