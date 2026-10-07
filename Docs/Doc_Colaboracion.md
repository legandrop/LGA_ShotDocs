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
- **Desde v0.074, los renglones con fotos en línea** (desde v0.078 las crean pegar, soltar y "/Image") tienen su parte del parche ("El
  texto de los huecos" y "Huecos estables") y su tabla, medida: escribir los dos en el mismo hueco, y borrar,
  mover o agregar una foto mientras el otro escribe pegado a ella, no pierden nada. Lo que queda es lo de los
  cambios de estructura (unir, cambiar el tipo; Enter deja algunas marcas con las letras desordenadas).

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

**En un renglón con fotos en línea** (desde v0.074; desde v0.078 las crean pegar, soltar y "/Image", ver `Doc_Fotos_En_Linea.md`). Las
fotos son elementos entre los textos del renglón. Con los huecos estables (ver "Huecos estables") ningún texto
de un renglón con fotos se borra ni se vuelve a crear: sacar, mover o insertar una foto toca solo la foto.
Medido con 300 agendas al azar por caso (`src/ui/collabPhotos*.test.ts`; el número es la cantidad de agendas
con algo de eso, en agendas hechas para chocar: todos los pasos caen en el mismo renglón). Entre paréntesis, lo
que daba antes de los huecos estables:

| Lo que hace A | Lo que hace B a la vez | Resultado |
|---|---|---|
| Escribe en un hueco (antes, entre o después de fotos) | Escribe en el mismo hueco | Quedan los dos textos (0 de 300). |
| Escribe en el renglón | Cambia el ancho de una foto, o agrega fotos en los huecos | Queda todo (0 de 300). |
| Escribe al final del renglón | Pone una foto en el medio del texto | Queda todo, pero lo de A aparece antes de la foto (0 de 300 perdido). |
| Escribe en un hueco vacío pegado a una foto | Borra esa foto | Queda todo (0 de 300; antes se perdía en 205 en una fila de tres fotos y en 206 con texto entre las fotos). |
| Escribe pegado a una foto | Mueve una foto del renglón | Queda todo (0 de 300; antes, 74 y 29 con alguna marca desordenada). |
| Borra una foto | Borra otra foto del mismo renglón | Queda todo (0 de 300; antes, el texto entre ellas se perdía en 53 y quedaba dos veces en 139). |
| Escribe pegado a una foto | Aprieta Enter pegado a una foto (parte el renglón) | No se pierde ninguna letra (antes se perdían en 166 de 300). En 41 de 300 una marca escrita queda **con las letras desordenadas** (`7}{A` por `{A7}`; ver abajo). |
| Une el renglón con el de arriba, o le cambia el tipo | Pega fotos en ese renglón | **Se pierden las fotos que pegó B** (227 y 261 de 300, igual que antes), como el texto en la tabla de arriba. |
| Une el renglón con el de arriba | Escribe pegado a sus fotos | **Se pierde lo que escribió B** (231 de 300, igual que antes), como en la tabla de arriba. |
| Pone una foto en el medio de un texto y la deshace (Ctrl+Z) | Escribe a la derecha de la foto, a la vez | **Se pierde lo de B** (20 de 70 en `stableGapsUndo.test.ts`, los "a la vez"): la parte de la derecha pasó a un texto nuevo de A, y deshacer borra lo que A creó, con lo que B escribió adentro. Es la regla del deshacer de Yjs: sin fotos pasa igual con Enter y deshacer (auditoría de la entrega 2). |
| Pone una foto en el medio de un texto | Borra o aprieta Enter a la derecha, a la vez | No se pierde nada, pero **lo borrado vuelve** o, con Enter, **la cola del renglón queda dos veces** (13 de 18 en la matriz de la auditoría): la parte de la derecha es una copia (un `Y.XmlText` no se parte). Igual con una versión anterior del otro lado. Se prefiere duplicar a perder. |

Con todo mezclado (los dos escriben, agregan, cambian anchos, borran, mueven y aprietan Enter): de 300
agendas, 7 con una marca desordenada y ninguna con letras perdidas (antes, 98 con letras perdidas); 6 con una
marca dos veces y 13 con texto que ya estaba dos veces, todas con los dos apretando Enter (cada uno se lleva el
mismo pedazo a su renglón nuevo; antes 19 y 61); ninguna foto perdida (antes 25) y **39 con una foto dos veces**
(antes 25), todas con una foto movida o un Enter de los dos lados a la vez: mover es sacar e insertar, y si los
dos mueven la misma foto (o uno la mueve y el otro parte el renglón) quedan dos. Se prefiere duplicar a perder.

**Las letras desordenadas.** El editor no le dice a la librería qué tecla se apretó: le da el renglón nuevo y la
librería compara letra por letra. Si A escribe `{A7}` justo antes de `{A0}`, la comparación ve que `{A` ya
estaba y guarda `7}{A` en el medio de `{A0}`. Si B, a la vez, se llevó `{A0}` a otro renglón (o lo borró),
queda `7}{A` (o, si después escribe algo más en el medio, `7}{A3}{A`). Pasaba igual antes y pasa igual en un renglón sin fotos (es la comparación de siempre de
y-prosemirror); en la vida real, escribiendo letra por letra, se nota solo con algo pegado de una vez. Las
pruebas lo cuentan aparte: `lost` (la marca no está tal cual) y `gone` (ni siquiera están sus letras, `lettersGone`).

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
- **Los huecos estables**: en un renglón con fotos (o cuyos textos llevan la marca), `updateYFragment` escribe
  con `updateStableGapsChildren` (nunca borra ni reemplaza un texto), `equalYTypePNode` compara con
  `equalStableContent` (varios textos seguidos valen como uno) y `createNodeFromYElement` no junta textos
  seguidos (el arreglo #160 de la librería). Ver "Huecos estables".
- **La marca del renglón (v0.078)**: el elemento vacío `lgaStableGaps` que lleva un renglón con fotos (o que las
  tuvo). `createTypeFromElementNode` y `updateStableGapsChildren` lo ponen, nadie lo borra, `createNodeFromYElement`
  no lo dibuja y `relativePositionToAbsolutePosition` (`src/lib.js`, la única parte del parche en ese archivo) no le
  cuenta tamaño. Ver "Versiones viejas y `min_app_version`".

**Si los parches faltan, la app no se construye ni corren las pruebas**: `vite.config.ts`
(`assertYProsemirrorPatched`) revisa las marcas en los dos archivos (si falta un archivo, también corta) y corta con un mensaje (pasa si se instaló con
`--ignore-scripts`, o si se actualizó y-prosemirror y el parche no se volvió a hacer). `y-prosemirror` quedó
fijo en `1.3.7` en `package.json` para que una actualización sea a propósito. Desde v0.074 también busca la
parte de los huecos y la de los huecos estables, y una prueba (`inlinePhoto.test.ts`) compara el nombre de la
marca del nodo, y el del atributo de los textos, con los que lee el parche. Otra (`stableGaps.test.ts`) le da
a los dos archivos la misma secuencia de documentos y exige los mismos cambios de Yjs, byte a byte.

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
- **Las dos formas no se mezclan.** Un editor con los huecos estables y otro sin el texto de los huecos en el
  mismo renglón con fotos no entran en un ida y vuelta (cada uno reescribe solo el párrafo que él mismo edita) y
  terminan iguales; como el primero nunca borra un texto, no se pierde nada en 300 agendas (antes de los huecos
  estables, 173), y los textos que escribe el otro quedan sin la marca (`collabPhotosNoGaps.test.ts`). No pasa
  en la app: toda versión que conoce la foto en línea tiene el parche entero.
- **Lo que arregla y lo que empeoraba** (300 agendas por caso; sin el texto de los huecos → con él): escribir los
  dos en el mismo hueco, de 21 perdido y 52 duplicado a 0 (`[foto][foto]`) y de 20 duplicado a 0 (con texto
  entre las fotos). Solo, el texto de los huecos **empeoraba** borrar una foto mientras el otro escribe en un
  hueco vacío pegado a ella (de 40 a 205) y Enter (de 139 a 172): al borrar la foto, y-prosemirror borraba
  también el texto del hueco, con lo que el otro escribió. Eso lo resuelven los huecos estables (abajo).

### Al actualizar BlockNote o y-prosemirror

1. Cambiar la versión en `package.json` y correr `npm install`. Si `patch-package` dice que el parche no entra:
   mirar si la versión nueva ya trae el arreglo (buscar `restoreRelativeSelection` y `normalizePNodeContent` en
   `node_modules/y-prosemirror/src/plugins/sync-plugin.js`). Si no, aplicar los mismos cambios a mano en los dos
   archivos y regenerar con `npx patch-package y-prosemirror` (borrar el parche viejo). Si ya lo trae, borrar el
   parche y sacar la revisión de `vite.config.ts`. El texto de los huecos y los huecos estables son de la app
   (ninguna versión de la librería los va a traer): se vuelven a aplicar siempre, en los dos archivos
   (`stableGaps.test.ts` comprueba que escriben igual). `patch-package` baja la librería original para comparar;
   sin red, se arma igual con `git diff` entre los dos archivos originales (se recuperan aplicando el parche al
   revés) y los cambiados, y se comprueba con `patch-package` sobre una copia.
2. Correr las pruebas de este documento: `npx vitest run src/ui/collab src/ui/inlinePhoto.test.ts
   src/ui/stableGaps src/sync/structure.test.ts` (incluye las de la librería publicada: si su armado dice que el
   parche de hoy no se puede sacar, `src/test/publishedYProsemirror.ts` necesita las huellas nuevas), y la grande al azar: `COLLAB_SEEDS=200 npx vitest run src/ui/collabRandom.test.ts`.
   Tienen que dar 0 pérdidas (las de `collabPhotosLimits` y `collabPhotosNoGaps` tienen que dar su número).
3. Si `collabSemantics.test.ts` falla, cambió cómo se fusionan dos cambios del mismo bloque: puede ser para bien
   (algo que se perdía ahora queda). Revisar el caso, actualizar la tabla de arriba y la prueba.
4. Correr la prueba de punta a punta `e2e.mjs` (dos dispositivos que se fusionan).

### Yjs también lleva un parche (v0.132)

`patches/yjs+13.6.33.patch` (Yjs fijo en 13.6.33): el deshacer sigue entera la copia que otro deshacer volvió a poner
(sin él dejaba restos y a veces se llevaba texto de antes), y desde v0.170 el ⌘Z con dos personas ya no tira
`TypeError` cuando la copia del renglón fue recolectada (B.22). Y desde v0.170 deshacer el borrado de un renglón ya no
deja a dos personas con **textos distintos para siempre** (B.26: Yjs ubicaba la letra que vuelve en un lugar en la
memoria de quien deshacía y en otro en los demás, cuando sus vecinos quedaban cruzados; pasaba también sin nuestros
parches). La causa, el arreglo y lo medido están en `Doc_Deshacer.md`, secciones 16, 20 y 21. Al actualizar Yjs: ver si
la versión nueva lo trae; si no, rehacerlo en `dist/yjs.mjs`, `dist/yjs.cjs` y `src` (marcas `LGA-SHOTDOCS-PATCH (B.21)`,
`(B.22)` y `(B.26)`), regenerar con `npx patch-package yjs` y correr `src/ui/yjsUndoRedone*.test.ts`,
`src/ui/yjsUndoGone.test.ts` y `src/ui/yjsUndoCrossed.test.ts`. `vite.config.ts` (`assertYjsPatched`) no deja correr nada sin el parche.

### A futuro: `@blocknote/core/y` (y-prosemirror 2, Yjs 14)

BlockNote ya trae una integración nueva (`@blocknote/core/y`, sobre y-prosemirror 2 y Yjs 14) que compara
bloques por su identidad en vez de por posición: por ejemplo, un cambio de tipo reemplaza el bloque entero como
un hermano, sin dejar dos contenidos en el mismo bloque. Podría resolver parte de la tabla de arriba. Cambia el
formato de lo guardado (Yjs 14), así que no es una actualización común: hay que evaluar la migración de las
páginas guardadas, la convivencia con versiones viejas (`min_app_version`) y volver a pasar todas estas pruebas.
Está en el roadmap (B.10).

**Evaluado en v0.225 (`Doc_Evaluacion_BlockNote_Y.md`).** Medido con dos editores: no resuelve la tabla de arriba
(el cambio de tipo, la sangría y juntar siguen borrando el bloque y lo que otro escribía en él), y lo que cambia no
es el formato binario de Yjs sino dónde vive el texto adentro de cada bloque. La decisión es de Lega (D330).

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
| `src/ui/collabPhotosLimits.test.ts` | La tabla de los renglones con fotos: borrar, mover, Enter, poner una foto en el medio de un texto, unir y cambiar el tipo, y de todo un poco. Documenta el número de hoy de cada caso (300 agendas), con las marcas perdidas y, aparte, las que perdieron letras: falla si cambia. Siempre exige que terminen iguales y que nada quede yendo y viniendo. |
| `src/ui/collabPhotosNoGaps.test.ts` | Los mismos casos sin el texto de los huecos, para comparar (qué arregla el parche), y las dos formas mezcladas en el mismo renglón. |
| `src/ui/stableGaps.test.ts` | Los huecos estables con un solo editor: borrar una foto deja los textos (los mismos objetos de Yjs) y se leen como uno; ida y vuelta Yjs → editor → Yjs sin cambios; la regla del borde; una foto en el medio de un texto; formatos que cruzan el borde; la marca; la reparación que copia; la versión anterior abriendo un renglón al que le borraron las fotos; 400 pasos al azar (con fotos: ningún texto se borra y abrir no escribe; sin fotos: sin marca); y las dos copias de la librería (`src` y `dist/*.cjs`) escribiendo los mismos cambios de Yjs, byte a byte. |
| `src/ui/collabPhotosVersions.test.ts` | Saltos de línea con el esquema anterior y este: las mismas agendas dan lo mismo con cualquier combinación de los dos. Ojo: usa la librería de HOY con el esquema anterior (la librería publicada la prueba el archivo de abajo). |
| `src/ui/collabPhotosVersions.published.test.ts` | Versiones mezcladas con la librería **publicada** de verdad (v0.052 a v0.075: la arma `src/test/publishedYProsemirror.ts` sin red ni git, desde `node_modules` y `src/test/fixtures/y-prosemirror-v0.052.patch`, y la pone el alias del proyecto `published` de `vite.config.ts`, también adentro de BlockNote): el renglón al que le borraron las fotos antes y después de la marca, uno con fotos, la cola de un viejo sin red, y sin fotos las dos librerías escribiendo lo mismo byte a byte (con un control que sí difiere). |
| `src/ui/stableGapsMarker.test.ts` | La marca del renglón: cuándo se pone, que no se dibuja ni se va, que abrir no escribe, deshacer la primera foto, y un renglón sin la marca que la recibe al editarlo. |
| `src/ui/inlinePhoto.test.ts` | El nodo, cómo queda guardado cada caso (con y sin saltos de línea), que abrir una página no escribe nada, la versión anterior (no la abre; si la abriera, borraría las fotos) y deshacer. |
| `src/ui/photoHarness.ts` | Las ayudas de las pruebas de fotos (no es una prueba): las agendas (con `trace` para mirar una paso a paso), los casos con sus números, la forma de los huecos (`brokenGaps`), las marcas que perdieron letras (`lettersGone`), el esquema de la versión anterior y el de la foto sin la marca de los huecos. |

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

**El texto de los huecos y los huecos estables (v0.076) sí cambian lo guardado**, pero solo en los renglones con
fotos en línea (o que las tuvieron), que una versión anterior no abre (`unknownContent.ts`, desde v0.021): desde
v0.078, por la foto o por la marca del renglón (abajo).

**El renglón al que le borraron todas las fotos (v0.078, propuesta para la auditoría: la marca del renglón).**
Con la v0.076, ese renglón quedaba con sus textos seguidos y marcados, sin nada que una versión anterior
desconociera, así que esas versiones lo abrían, y al editarlo lo reescribían en un solo texto (copiaban los otros
en el primero y los borraban). Medido con la librería publicada de verdad (`collabPhotosVersions.published.test.ts`,
7 posiciones por lado, cada dispositivo sin ver al otro): uno viejo y uno nuevo, **28 de 49 combinaciones perdían**
lo del nuevo; dos viejos, **las 49 dejaban el renglón entero dos veces**. Subir `min_app_version` no alcanzaba: una
versión vieja sin permiso para subir sigue bajando y editando en el dispositivo, y cuando se actualiza sube su cola
(la mezcla de Yjs no depende del orden: es la misma cuenta, con las mismas pérdidas).

Lo que cambia (**cambia la forma guardada** de los renglones con fotos): el renglón lleva, primero, un elemento
vacío `lgaStableGaps` ("la marca del renglón"). Lo pone el parche al darle a un renglón su primera foto, nunca
lo borra y el editor nunca lo dibuja (no cuenta para el cursor ni para las posiciones). Las versiones anteriores
(de la v0.052 a la v0.076) no conocen ese nombre: su resguardo (`unknownContent.ts`, desde v0.021) no abre la
página, aunque al renglón le hayan borrado todas las fotos. La de hoy lo conoce (`yjsOnly` en
`unknownContent.ts`). Un párrafo que nunca tuvo fotos no lo lleva y se guarda igual que antes, byte a byte
(probado contra la librería publicada con 40 agendas de 40 pasos al azar). **Deshacer tampoco lo saca** (el filtro de
borrado del deshacer, `src/plugins/undo-plugin.js` del parche): deshacer la primera foto deja el renglón con la marca
y su texto, como borrarla. Antes lo sacaba (lo encontró la auditoría de la entrega 2): con otro escribiendo en el
renglón, en 20 de 70 casos quedaba un renglón con dos textos y sin marca, que las versiones anteriores abrían y que dos
versiones de hoy escribiendo a la vez duplicaban entero (49 de 49). Ahora, 0 de 70 (`stableGapsUndo.test.ts`).

| Medido con la librería publicada (49 combinaciones por caso) | Antes (v0.076) | Con la marca |
|---|---|---|
| Viejo y nuevo en un renglón al que le borraron las fotos | 28 perdidas | **0** (el viejo no abre la página) |
| Dos viejos en ese renglón | 49 con el renglón dos veces | **0** |
| Dos nuevos en ese renglón | 0 | 0 |
| Viejo y nuevo en un renglón con fotos | el viejo no abre | el viejo no abre; 0 |
| Un viejo sin red que editó el renglón ANTES de que tuviera fotos y sube su cola después (8 ediciones × 13 del nuevo: fotos en cada lugar, borradas o no, y escribir pegado) | — | **0 letras perdidas**; en 9 de 104, lo que el viejo borró vuelve (el nuevo partió ese texto con una foto: la parte de la derecha es una copia) |

La otra salida medida, **juntar los textos en uno al borrar la última foto**, se descartó: entre dos versiones
nuevas pierde lo que el otro escribe a la vez en el segundo o el tercer texto (4 de 7 posiciones) y, si los dos
borran la última foto a la vez, el texto queda dos veces. Con la marca, eso sigue en 0.

**Orden de publicación.** Con la marca, ninguna versión anterior abre una página con fotos en línea (ni con un
renglón que las tuvo), así que no hace falta subir `min_app_version` antes de publicar la que las crea. Después de
publicarla, conviene subirlo a esa versión (0.078): las versiones viejas dejan de subir cambios de las demás páginas
y avisan que hay que actualizar.

## Huecos estables

Para que borrar, mover o agregar una foto no pierda lo que otro escribe pegado a ella. Parte del parche de
y-prosemirror (`updateStableGapsChildren` y lo que la rodea, en los dos archivos de la librería).

- **De dónde venía la pérdida.** Con el texto de los huecos, al borrar una foto y-prosemirror juntaba los dos
  textos vecinos: copiaba uno en el otro y **borraba un `Y.XmlText` entero**, con lo que otro hubiera escrito en
  él mientras tanto. Reescribir letras adentro de un texto no pierde lo que otro escribe; borrar el texto sí.
  Además, al dibujar, la librería junta dos textos seguidos si el segundo lo creó ese dispositivo (#160).
- **Cómo es ahora.** En un renglón con fotos, ningún texto se borra ni se vuelve a crear. Borrar una foto saca
  solo su elemento y deja los textos de los dos lados como hermanos seguidos (`"abc" "def"`); mover es sacar e
  insertar. Al leer, varios textos seguidos son un solo texto del editor, y no se juntan (ni el #160). Al
  escribir, el renglón se compara como una secuencia de letras y fotos (prefijo y sufijo comunes; en el medio,
  la secuencia de cambios más corta, con tope de 512 pasos) y cada cambio va al texto que tiene esa posición.
  Los textos vacíos no molestan y nunca se limpian.
- **Regla del borde.** Lo que se escribe donde se tocan dos textos va al final del de la izquierda (donde Yjs
  pone el cursor). Una foto puesta en el medio de un texto deja la parte izquierda donde está y pasa la derecha
  a un texto nuevo después de la foto (un `Y.XmlText` no se puede partir): lo que otro escriba a la vez en esa
  parte queda a la izquierda de la foto, no se pierde. Una foto puesta donde se tocan dos textos va entre los
  dos. Un cambio de ancho actualiza la foto sin volver a crearla.
- **La marca.** Los textos de un renglón con fotos llevan el atributo `lgaGapText: true` (en el `Y.XmlText`, el
  mismo nombre que la marca del nodo), que se pone al crear el bloque y al escribir en él. Así el renglón sigue
  así cuando se le borra la última foto. Desde v0.078 el renglón lleva además, primero, el elemento vacío
  `lgaStableGaps` (la marca del renglón), que las versiones anteriores no conocen (ver "Versiones viejas"). Sin fotos y sin textos marcados, el renglón va por el código de
  siempre: todo párrafo de hoy, también con saltos de línea.
- **La forma.** Cada foto tiene un texto (aunque sea vacío) a cada lado, y todos los textos del renglón llevan
  la marca (`brokenGaps` en `photoHarness.ts`). Puede haber varios textos seguidos. Si dos personas insertan a
  la vez una foto en el mismo lugar, las dos fotos pueden quedar pegadas, sin texto entre ellas (2 de 300 en
  "de todo un poco"): no se pierde nada (quien escriba ahí crea un texto que no se junta con nada) y la próxima
  edición de ese renglón vuelve a poner el texto vacío.

### Cómo quedó

300 agendas al azar por caso (las mismas semillas de siempre; `collabPhotos*.test.ts`, `limits` en
`photoHarness.ts`). "Antes" es el texto de los huecos solo (`fd600c2`); "sin huecos", sin el texto de los
huecos. El número es la cantidad de agendas con algo perdido (entre paréntesis, con letras perdidas de verdad, no
solo desordenadas):

| Caso | Sin huecos | Antes | Ahora |
|---|---|---|---|
| Los dos escriben en los huecos de `[foto][foto]` | 21 perdido, 52 dos veces | 0 | 0 |
| Los dos escriben en los huecos de `"abc"[foto]"def"[foto]` | 20 dos veces | 0 | 0 |
| A escribe a la derecha de una foto, B borra fotos (`[foto][foto][foto]`) | 40 (40) | 205 (205) | **0** |
| A escribe pegado a una foto, B borra fotos (texto entre fotos) | 167 (167) | 206 (206) | **0** |
| A escribe a la derecha de una foto, B mueve fotos (`[foto][foto][foto]`) | 87 (87) | 74 (0) | **0** |
| A escribe pegado a una foto, B mueve fotos (texto entre fotos) | 166 (166) | 29 (0) | **0** |
| A escribe pegado a una foto, B aprieta Enter pegado a una foto | 139 (139) | 172 (166) | **41 (0)** |
| Los dos borran fotos (texto entre fotos) | 53 perdido, 139 dos veces | igual | **0** |
| A une el renglón, B escribe pegado a sus fotos | 231 (231) | igual | igual |
| A une el renglón o le cambia el tipo, B pega fotos | 227 y 261 fotos | igual | igual |
| De todo un poco (los dos, todo) | 101 (101) | 103 (98) | **7 (0)**; 6 y 13 dos veces; 39 fotos dos veces |
| Control, solo texto | 0 | 0 | 0 |
| Saltos de línea (esta versión, la anterior y mezcladas) | — | 2 y 1; 4 y 12 | igual |
| Las dos formas mezcladas en un renglón | — | 173 | **0** |

La vara del encargo era: los huecos en 0; "borrar mientras el otro escribe pegado" en 40 o menos (objetivo 0);
Enter no peor que sin huecos (139); y los párrafos sin fotos igual que hoy. Da: 0, **0**, **41 sin ninguna letra
perdida** (las 41 son marcas desordenadas, ver "Lo que todavía puede pasar"), y el control y los saltos de
línea con los mismos números que antes, por el mismo camino de código. Lo que queda es de la estructura (unir,
cambiar el tipo: y-prosemirror vuelve a crear el bloque) y de copiar (dos Enter a la vez, o mover y Enter a la
vez, dejan cosas dos veces): no se pierde nada nuevo.

### Para el auditor

- **Dónde toca el camino de un párrafo sin fotos.** Tres lugares, todos detrás de una pregunta que con un
  párrafo de hoy da "no": `isStableGapsBlock` al principio de `updateYFragment` (después de los atributos) y en
  `equalYTypePNode`, y `yChildrenHaveStableGaps` en `createNodeFromYElement` (salta el #160 solo si el renglón
  tiene una foto o un texto marcado). `isStableGapsBlock` exige un `Y.XmlElement`, un nodo de texto del editor
  (`isTextblock`) y una foto o un texto marcado; recorre los hijos en cada comparación (costo lineal, sin
  escrituras). `createTypeFromElementNode` pone la marca solo si el nodo tiene una foto (`hasGapTextChild`).
  Lo comprueban: el control de solo texto y los saltos de línea con los mismos números que antes (también con el
  esquema anterior y mezclados), el editor al azar sin fotos (ningún texto con la marca) y "abrir una página no
  escribe nada" (`inlinePhoto.test.ts`, `stableGaps.test.ts`).
- **La reparación** (`structure.ts`) copiaba con `clone()` de Yjs, que no copia los atributos de un
  `Y.XmlText`: un renglón copiado sin fotos perdía la marca y volvía al código de siempre. Ahora copia con
  `copyType`, que los copia (prueba en `stableGaps.test.ts`).
- **Las dos copias de la librería.** `src/plugins/sync-plugin.js` (la que usan la app y las pruebas) y
  `dist/y-prosemirror.cjs` llevan el mismo código, con los nombres de módulo de cada una; `stableGaps.test.ts`
  les da la misma secuencia de 200 documentos y exige los mismos cambios de Yjs byte a byte (falla con la
  `.cjs` de antes). El parche regenerado con `npx patch-package y-prosemirror` reproduce los dos archivos exactos
  sobre la librería original (comprobado con `git apply` sobre `npm pack y-prosemirror@1.3.7`).
- Los comentarios nuevos del parche están en inglés, como el resto de ese archivo.
